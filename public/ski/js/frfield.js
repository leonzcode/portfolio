/* Freeride's rock field, worked out in a module worker (2026-11-07): how steep the snow is at each texel of the snow
   shader's rock map (materials.js), from Freeride's snow without its rock faces, with the land's own say in how rocky
   each place is (frland.js rockNy). Sent the windows ({ N, r, x0, z0 } each), it posts back each one's texels as it
   finishes it: { i, data }. The same sums as materials.js bakeRockField, which the page falls back on.
   (2026-11-11, for "make the freeride map even better with better graphics for the entire mountain") and the light the
   mountain itself lets through, in three more channels of the same texels, so the snow, the rock and the trees read it
   with the lookup they already make:
     r  how steep the snow is (as before)
     g  how much of the sky a place sees (a gully, a couloir, the foot of a cliff see less of it: soft blue shade there)
     b  whether the sun reaches it past the mountain (a ridge's, a rib's, a cliff's shadow across the snow), softened
        at the edges by how near the ray passed; worked out again for each new sun ({ sun: [x, y, z] }), posted as
        { i, b } (that channel alone)
     a  how exposed it is to the wind (a crest, a lip, a rib: 1; a hollow: 0; flat: about 0.5), for the snow's wind
        texture
   Every sum runs on the heights at the texels' middles (the land with its rock, land.at), kept here between suns.
   The trees (sent once the forest is planted, { trees: [x, z, size, ...] }) shade the snow too, in the finest window:
   less sky under each crown (g, posted again as { i, g }), and each crown's shadow laid on the snow away from the sun,
   as long as the sun is low (b). At 4 m a texel these are soft patches of shade, not a tree's outline: the shadow map
   round the rider draws the near trees' own shadows on the tiers that have it. */
import { Land } from './frland.js?v=23';

let land = null, levels = null, grids = null, sun = null, light = false, T0 = 0, trees = null;
onmessage = e => {
  const m = e.data;
  if (m.levels) {
    T0 = performance.now();
    land = new Land(); levels = m.levels; light = !!m.light;
    // the steepness first (the rock field), as soon as it was before the light was added (sky 1, sun 1, wind 0.5 meanwhile)
    levels.forEach((L, i) => {
      const { N, r, x0, z0 } = L, M = N + 2, hs = new Float32Array(M * M), C = light ? 4 : 1, data = new Uint8Array(N * N * C);
      // the heights at the texels' middles and one ring round them
      for (let j = 0; j < M; j++) { const z = z0 + (j - 0.5) * r; for (let k = 0; k < M; k++) hs[j * M + k] = land.snowAt(x0 + (k - 0.5) * r, z); }
      // the normal's y from the slope across two texels either way, then the land's own say
      for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
        const q = (j + 1) * M + k + 1, gx = (hs[q + 1] - hs[q - 1]) / (2 * r), gz = (hs[q + M] - hs[q - M]) / (2 * r);
        const ny = land.rockNy(x0 + (k + 0.5) * r, z0 + (j + 0.5) * r, 1 / Math.sqrt(1 + gx * gx + gz * gz));
        const t = (j * N + k) * C;
        data[t] = Math.round(255 * Math.max(0, Math.min(1, ny)));
        if (light) { data[t + 1] = 255; data[t + 2] = 255; data[t + 3] = 128; }
      }
      postMessage({ i, data, ms: performance.now() - T0 }, [data.buffer]);
    });
    if (light) {
      // then the light's heights, every window's (so the sums for one window can look out into the next), the sky and
      // the wind, each window posted as { i, ga } (the sky and the wind, two bytes a texel)
      grids = levels.map(L => {
        const { N, r, x0, z0 } = L, h = new Float32Array(N * N);
        for (let j = 0; j < N; j++) { const z = z0 + (j + 0.5) * r; for (let k = 0; k < N; k++) h[j * N + k] = land.at(x0 + (k + 0.5) * r, z); }
        let top = -Infinity; for (let t = 0; t < h.length; t++) if (h[t] > top) top = h[t];
        return { N, r, x0, z0, h, top };
      });
      levels.forEach((L, i) => {
        const N = L.N, D = new Uint8Array(N * N * 4);
        sky(i, D); wind(i, D);
        const g = grids[i].g = new Uint8Array(N * N);      // (the sky without the trees)
        for (let t = 0; t < N * N; t++) g[t] = D[t * 4 + 1];
        if (trees) treeSky(i, D, 4);
        const ga = new Uint8Array(N * N * 2);
        for (let t = 0; t < N * N; t++) { ga[t * 2] = D[t * 4 + 1]; ga[t * 2 + 1] = D[t * 4 + 3]; }
        postMessage({ i, ga, ms: performance.now() - T0 }, [ga.buffer]);
      });
      if (sun) shade();
    }
  }
  if (m.trees) {
    trees = m.trees;
    if (light && grids && grids.every(Boolean)) { const g = treeSky(0, null, 1); postMessage({ i: 0, g }, [g.buffer]); if (sun) shade(); }
  }
  if (m.sun) { sun = m.sun; if (light && grids && grids.every(Boolean)) shade(); }
};
/* the sky under the trees (the finest window only): each crown takes some of the sky from the snow under and round it,
   the more the bigger the tree, written into out (stride C, at the sky's place) from the sky without them */
function treeSky(i, out, C) {
  const g = grids[i], { N, r, x0, z0 } = g, a = new Float32Array(N * N);
  if (i === 0) for (let t = 0; t < trees.length; t += 3) {
    const x = trees[t], z = trees[t + 1], s = trees[t + 2], R = 2.5 + s * 0.28;
    const k0 = Math.max(0, Math.floor((x - R - x0) / r)), k1 = Math.min(N - 1, Math.floor((x + R - x0) / r));
    const j0 = Math.max(0, Math.floor((z - R - z0) / r)), j1 = Math.min(N - 1, Math.floor((z + R - z0) / r));
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const d = Math.hypot(x0 + (k + 0.5) * r - x, z0 + (j + 0.5) * r - z) / R;
      if (d < 1) a[j * N + k] += 0.3 * (1 - d * d) * Math.min(1, s / 12);
    }
  }
  const o = out || new Uint8Array(N * N);
  for (let t = 0; t < N * N; t++) o[t * C + (C === 4 ? 1 : 0)] = Math.round(g.g[t] * Math.max(0.45, 1 - a[t]));
  return o;
}

// the height at a place from the finest window that holds it (bilinear between the texels' middles)
function hAt(x, z) {
  for (let i = 0; i < grids.length; i++) {
    const g = grids[i], fx = (x - g.x0) / g.r - 0.5, fz = (z - g.z0) / g.r - 0.5;
    if (fx < 0 || fz < 0 || fx >= g.N - 1 || fz >= g.N - 1) continue;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, N = g.N, h = g.h, k = iz * N + ix;
    const a = h[k] + (h[k + 1] - h[k]) * tx, b = h[k + N] + (h[k + N + 1] - h[k + N]) * tx;
    return a + (b - a) * tz;
  }
  return -1e9;
}
/* how much of the sky each texel sees: in eight directions, the highest the land rises over the texel's own slope
   (the horizon above its tangent plane, out to 25 texels), as horizon-based ambient occlusion has it. A flat field or an
   even slope sees all of it (1); a gully, a chute, the foot of a cliff less */
function sky(i, data) {
  const g = grids[i], { N, r, x0, z0 } = g, D = 8, steps = [1, 1.6, 2.5, 3.6, 5, 7, 10, 14, 19, 25];
  for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const x = x0 + (k + 0.5) * r, z = z0 + (j + 0.5) * r, y = g.h[j * N + k];
    const gx = (hAt(x + r, z) - hAt(x - r, z)) / (2 * r), gz = (hAt(x, z + r) - hAt(x, z - r)) / (2 * r);
    let s = 0;
    for (let d = 0; d < D; d++) {
      const a = d / D * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), t0 = -(gx * dx + gz * dz);   // (the slope's own rise that way)
      let best = 0;
      for (const st of steps) {
        const L = st * r, hh = hAt(x + dx * L, z + dz * L); if (hh < -1e8) break;
        const e = (hh - y) / L + t0; if (e > best) best = e;
      }
      s += 1 - best / Math.sqrt(1 + best * best);     // (1 - the sine of the horizon's angle over the slope)
    }
    data[(j * N + k) * 4 + 1] = Math.round(255 * Math.max(0, Math.min(1, s / D)));
  }
}
// how exposed each texel is to the wind: the land's curvature over about two texels (a crest +, a hollow -)
function wind(i, data) {
  const g = grids[i], { N, r, x0, z0 } = g, d = r * 3;
  for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
    const x = x0 + (k + 0.5) * r, z = z0 + (j + 0.5) * r, y = g.h[j * N + k];
    const lap = (hAt(x + d, z) + hAt(x - d, z) + hAt(x, z + d) + hAt(x, z - d) - 4 * y) / (d * d);
    data[(j * N + k) * 4 + 3] = Math.round(255 * Math.max(0, Math.min(1, 0.5 - lap * 1.2 * d)));
  }
}
/* whether the sun reaches each texel: a ray from just over the snow towards the sun, over the land, its steps growing
   with the distance (finer near), to where it is higher than the highest land; soft at the edge by how near it passed
   (the closer the ray skims the land, the darker, over a few metres: the sun is not a point) */
function shade() {
  const t0 = performance.now();
  const sx = sun[0], sy = sun[1], sz = sun[2], hl = Math.hypot(sx, sz);
  const top = Math.max(...grids.map(g => g.top));
  grids.forEach((g, i) => {
    const { N, r, x0, z0 } = g, b = new Uint8Array(N * N);
    if (sy <= 0.01 || hl < 1e-6) { b.fill(sy > 0 ? 255 : 0); postMessage({ i, b }, [b.buffer]); return; }
    const ux = sx / hl, uz = sz / hl, rise = sy / hl;
    /* the trees' shadows (finest window): each crown, a cone from a tenth of its height to its top, laid on the snow away
       from the sun as an ellipse, as long as its height over the sun's rise (at most 40 m) and as wide as the crown,
       darker the denser (several crowns' shade adds up, at most 0.65 of the sun taken) */
    const tc = i === 0 && trees ? new Float32Array(N * N) : null;
    if (tc) for (let t = 0; t < trees.length; t += 3) {
      const x = trees[t], z = trees[t + 1], s = trees[t + 2], w = 0.3 * s + 0.6, ri = Math.max(rise, 0.05);
      const L = Math.min(40, 0.9 * s / ri), off = Math.min(46, 0.1 * s / ri + L * 0.5);
      const cx = x - ux * off, cz = z - uz * off, R = L * 0.5 + w;
      const k0 = Math.max(0, Math.floor((cx - R - x0) / r)), k1 = Math.min(N - 1, Math.floor((cx + R - x0) / r));
      const j0 = Math.max(0, Math.floor((cz - R - z0) / r)), j1 = Math.min(N - 1, Math.floor((cz + R - z0) / r));
      for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const px = x0 + (k + 0.5) * r - cx, pz = z0 + (j + 0.5) * r - cz, along = px * -ux + pz * -uz, across = -px * -uz + pz * -ux;
        const e = (along * along) / ((L * 0.5 + w * 0.5) ** 2) + (across * across) / (w * w);
        if (e < 1) tc[j * N + k] += 0.55 * (1 - e) * Math.min(1, w * w / (r * r));
      }
    }
    for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const x = x0 + (k + 0.5) * r, z = z0 + (j + 0.5) * r, y = g.h[j * N + k] + 0.4;
      let vis = 1, t = r * 0.75;
      while (t < 6000) {
        const yr = y + t * rise; if (yr > top) break;
        const hh = hAt(x + ux * t, z + uz * t); if (hh < -1e8) break;
        // (the penumbra: about 1.3 degrees of the sun's and the sky's glow, so a shadow 100 m out softens over 2 m)
        const v = (yr - hh) / (t * 0.022) ; if (v < vis) { vis = v; if (vis <= 0) { vis = 0; break; } }
        t += Math.max(r * 0.5, t * 0.035);
      }
      vis = Math.max(0, Math.min(1, vis)); vis = vis * vis * (3 - 2 * vis);
      if (tc) vis *= 1 - Math.min(0.65, tc[j * N + k]);
      b[j * N + k] = Math.round(255 * vis);
    }
    postMessage({ i, b, ms: performance.now() - t0 }, [b.buffer]);
  });
}
