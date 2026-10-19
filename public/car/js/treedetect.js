// Finding tree crowns in a satellite picture (no imports, so a worker can run it). The picture is cut into 1 m
// cells; a cell is canopy when it is green beyond grey and lumpy (lit tops, shaded sides), not a smooth lawn or
// blue-green shade on pavement, and not under a building, a road or water. Gaps inside a crown are closed, specks
// dropped, and crowns are placed greedily at the peaks of the distance to the canopy's edge, sized by it.
//
//   detect({ data, w, h, x0, z0, x1, z1 }, { buildings: [ring], water: [ring], roads: [{ pts, half }], core,
//           lean: [kx, kz], idBase, rough }) -> { list: [{ x, z, r, c, col }], canopyCells }

function hashf(n, salt = 0) {
  let h = (Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function detect(px, opts = {}) {
  const { data, w, h } = px;
  const sx = w / (px.x1 - px.x0), sz = h / (px.z1 - px.z0);
  const G = 1.0;
  const gw = Math.ceil((px.x1 - px.x0) / G), gh = Math.ceil((px.z1 - px.z0) / G), N = gw * gh;
  const lum = new Float32Array(N), lum2 = new Float32Array(N), gbS = new Float32Array(N), grS = new Float32Array(N), cnt = new Float32Array(N);
  const colOf = new Int32Array(w);
  for (let i = 0; i < w; i++) colOf[i] = Math.min(gw - 1, Math.floor(i / sx / G));
  for (let j = 0; j < h; j++) {
    const row = Math.min(gh - 1, Math.floor(j / sz / G)) * gw;
    for (let i = 0, k = j * w * 4; i < w; i++, k += 4) {
      const r = data[k], g = data[k + 1], b = data[k + 2];
      const c = row + colOf[i];
      const l = 0.3 * r + 0.59 * g + 0.11 * b, inv = 1 / (r + g + b + 30);
      gbS[c] += (g - b) * inv; grS[c] += (g - r) * inv; lum[c] += l; lum2[c] += l * l; cnt[c]++;
    }
  }
  // blocked cells: buildings, water, roads
  const blocked = new Uint8Array(N);
  const fillPoly = (ring) => {
    let z0 = Infinity, z1 = -Infinity;
    for (const p of ring) { if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
    const j0 = Math.max(0, Math.floor((z0 - px.z0) / G)), j1 = Math.min(gh - 1, Math.floor((z1 - px.z0) / G));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = px.z0 + (j + 0.5) * G; xs.length = 0;
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const p = ring[a], q = ring[b];
        if ((p[1] > z) !== (q[1] > z)) xs.push(p[0] + (z - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - px.x0) / G - 0.5)), i1 = Math.min(gw - 1, Math.floor((xs[k + 1] - px.x0) / G - 0.5));
        for (let i = i0; i <= i1; i++) blocked[j * gw + i] = 1;
      }
    }
  };
  for (const r of opts.buildings || []) if (r && r.length > 2) fillPoly(r);
  for (const r of opts.water || []) if (r && r.length > 2) fillPoly(r);
  for (const rd of opts.roads || []) {
    const half = rd.half, pts = rd.pts; if (!(half > 0) || !pts) continue;
    const rr = Math.ceil(half / G), h2 = (half / G) * (half / G);
    for (let k = 0; k + 1 < pts.length; k++) {
      const ax = pts[k][0], az = pts[k][1], bx = pts[k + 1][0], bz = pts[k + 1][1];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.7);
      for (let s = 0; s <= steps; s++) {
        const x = ax + (bx - ax) * s / steps, z = az + (bz - az) * s / steps;
        const ci = Math.floor((x - px.x0) / G), cj = Math.floor((z - px.z0) / G);
        if (ci < -rr || cj < -rr || ci >= gw + rr || cj >= gh + rr) continue;
        for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
          if (di * di + dj * dj > h2) continue;
          const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < gw && j < gh) blocked[j * gw + i] = 1;
        }
      }
    }
  }
  // canopy
  const can = new Uint8Array(N), L1 = new Float32Array(N);
  let nc = 0;
  for (let c = 0; c < N; c++) L1[c] = cnt[c] ? lum[c] / cnt[c] : 0;
  const rough = opts.rough ?? 6.5;
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    const c = j * gw + i;
    if (!cnt[c] || blocked[c]) continue;
    const n = cnt[c], l = L1[c], gb = gbS[c] / n, gr = grS[c] / n;
    if (!(l > 12 && l < 130 && gr > 0.02)) continue;
    const sd = Math.sqrt(Math.max(0, lum2[c] / n - l * l));
    let s1 = 0, s2 = 0;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const q = L1[c + b * gw + a]; s1 += q; s2 += q * q; }
    const nsd = Math.sqrt(Math.max(0, s2 / 9 - (s1 / 9) ** 2));
    let tree = false;
    if (gb > 0.07) tree = nsd > rough || (l < 60 && sd > 2.5 && gb > 0.095);
    // foliage in shade: the picture tints it blue, so ask for red well under green and real texture
    else if (gb > -0.08) tree = l < 80 && gr > 0.05 && sd > 4 && nsd > 4;
    if (tree) { can[c] = 1; nc++; }
  }
  // close small gaps (a crown seen in pieces between its own shadows): dilate twice, erode twice
  const morph = (src, grow) => {
    const out = new Uint8Array(N);
    for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
      const c = j * gw + i;
      out[c] = grow ? (src[c] | src[c - 1] | src[c + 1] | src[c - gw] | src[c + gw]) : (src[c] & src[c - 1] & src[c + 1] & src[c - gw] & src[c + gw]);
    }
    return out;
  };
  {
    let m = morph(morph(can, true), true);
    for (let c = 0; c < N; c++) if (blocked[c]) m[c] = 0;
    m = morph(morph(m, false), false);
    for (let c = 0; c < N; c++) can[c] |= m[c];
  }
  // drop specks, then the distance to the canopy's edge (chamfer), in metres
  const dist = new Float32Array(N);
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
    const c = j * gw + i; if (!can[c]) continue;
    const n = can[c - 1] + can[c + 1] + can[c - gw] + can[c + gw] + can[c - gw - 1] + can[c - gw + 1] + can[c + gw - 1] + can[c + gw + 1];
    if (n >= 3) dist[c] = 1e9;
  }
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const c = j * gw + i; if (!dist[c]) continue;
    let d = dist[c];
    d = i > 0 ? Math.min(d, dist[c - 1] + 1) : Math.min(d, 1);
    if (j > 0) { d = Math.min(d, dist[c - gw] + 1); if (i > 0) d = Math.min(d, dist[c - gw - 1] + 1.414); if (i < gw - 1) d = Math.min(d, dist[c - gw + 1] + 1.414); } else d = Math.min(d, 1);
    dist[c] = d;
  }
  for (let j = gh - 1; j >= 0; j--) for (let i = gw - 1; i >= 0; i--) {
    const c = j * gw + i; if (!dist[c]) continue;
    let d = dist[c];
    d = i < gw - 1 ? Math.min(d, dist[c + 1] + 1) : Math.min(d, 1);
    if (j < gh - 1) { d = Math.min(d, dist[c + gw] + 1); if (i < gw - 1) d = Math.min(d, dist[c + gw + 1] + 1.414); if (i > 0) d = Math.min(d, dist[c + gw - 1] + 1.414); } else d = Math.min(d, 1);
    dist[c] = d;
  }
  // crowns: greedy from the deepest cells
  const cand = [];
  for (let c = 0; c < N; c++) if (dist[c] >= 1.4) cand.push(c);
  cand.sort((a, b) => dist[b] - dist[a]);
  const out = [], grid = new Map(), GC = 8;
  for (const c of cand) {
    const i = c % gw, j = (c / gw) | 0;
    const x = px.x0 + (i + 0.5) * G, z = px.z0 + (j + 0.5) * G;
    const r = Math.min(dist[c] * G + 0.8, 5.0 + hashf(c, 3) * 2.5);
    let ok = true;
    const kx = Math.floor(x / GC), kz = Math.floor(z / GC);
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1 && ok; b++) {
      const l = grid.get((kx + a) * 100003 + (kz + b)); if (!l) continue;
      for (const t of l) if (Math.hypot(t.x - x, t.z - z) < (t.r + r) * 0.72) { ok = false; break; }
    }
    if (!ok) continue;
    const t = { x, z, r, c: (opts.idBase || 0) + c, col: null };
    const k = kx * 100003 + kz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(t);
    out.push(t);
  }
  const core = opts.core;
  const own = core ? out.filter(t => t.x >= core.x0 && t.x < core.x1 && t.z >= core.z0 && t.z < core.z1) : out;
  // each crown's mean colour in the picture (sRGB 0..1), from the pixels inside 70% of its radius
  for (const t of own) {
    let R = 0, Gs = 0, B = 0, n = 0;
    const rr = t.r * 0.7, i0 = Math.floor((t.x - rr - px.x0) * sx), i1 = Math.ceil((t.x + rr - px.x0) * sx), j0 = Math.floor((t.z - rr - px.z0) * sz), j1 = Math.ceil((t.z + rr - px.z0) * sz);
    const step = Math.max(1, Math.floor((i1 - i0) / 8));
    for (let j = Math.max(0, j0); j < Math.min(h, j1); j += step) for (let i = Math.max(0, i0); i < Math.min(w, i1); i += step) {
      const dx = (i / sx + px.x0) - t.x, dz = (j / sz + px.z0) - t.z; if (dx * dx + dz * dz > rr * rr) continue;
      const k = (j * w + i) * 4; R += data[k]; Gs += data[k + 1]; B += data[k + 2]; n++;
    }
    t.col = n ? [R / n / 255, Gs / n / 255, B / n / 255] : null;
  }
  // the picture shows a crown displaced by its height times the lean; put the trunk back under it
  const lean = opts.lean || [0, 0];
  for (const t of own) { const hc = 2.0 * t.r + 1.5; t.x -= lean[0] * hc; t.z -= lean[1] * hc; }
  return { list: own, canopyCells: nc };
}
