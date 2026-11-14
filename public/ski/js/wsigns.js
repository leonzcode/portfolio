/* (W, round 10) Any mountain on Earth: the runs as they are marked on a real mountain.
   - Edge poles down the groomed runs' sides, every 40 m on alternate sides, in the run's colour (the slopes' own signs:
     green, blue, black in the Americas and Oceania; green, blue, red, black elsewhere; orange in the parks): one instanced
     mesh, only the poles near the camera written into it (within 300 m, 220 on the low tier), refreshed every 8 m.
   - A sign at the top of every named run (its colour's shape and its name), beside the run, facing up it: every sign in
     one merged mesh with one small picture holding all the names (one draw call). */
import * as THREE from 'three';
import { ground } from './terrain.js?v=26';
import { trailColours } from './wtrail.js?v=26';
import { originOf } from './wplaces.js?v=26';

export function makeSigns(scene, W, q) {
  const o = originOf(W.place), cols = trailColours(o.lat, o.lon).map(c => new THREE.Color(c)), low = q.tier === 'low';
  const inA = (x, z) => W.land.elev.inFine(x, z, 40);
  // ---- the poles: every 40 m along each groomed run's edges, alternate sides
  const P = [];
  for (const p of W.data.pistes) {
    if (!p.groom || p.area || p.pts.length < 2) continue;
    let acc = 0, side = 1;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i], b = p.pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z); if (l < 0.5) continue;
      const ux = (b.x - a.x) / l, uz = (b.z - a.z) / l, off = p.w / 2 + 1.2;
      for (let s = (40 - acc % 40) % 40; s < l; s += 40) {
        const x = a.x + ux * s - uz * off * side, z = a.z + uz * s + ux * off * side; side = -side;
        if (!inA(x, z) || W.land.cliff(x, z)) continue;
        P.push(x, ground(x, z) - 0.15, z, p.diff);
      }
      acc += l;
    }
  }
  const nP = P.length / 4;
  const pole = new THREE.CylinderGeometry(0.035, 0.045, 1.9, 5, 1, true); pole.translate(0, 0.95, 0); pole.deleteAttribute('uv');
  const cap = Math.min(nP, low ? 220 : 420);
  const poles = new THREE.InstancedMesh(pole, new THREE.MeshLambertMaterial({ color: 0xffffff }), Math.max(1, cap));
  poles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3);
  poles.instanceMatrix.setUsage(THREE.DynamicDrawUsage); poles.instanceColor.setUsage(THREE.DynamicDrawUsage);
  poles.count = 0; poles.frustumCulled = false; poles.matrixAutoUpdate = false; poles.castShadow = false; poles.name = 'run poles';
  scene.add(poles);
  const R = low ? 220 : 300, at = new THREE.Vector3(1e9, 0, 0), m = new THREE.Matrix4();
  const update = cam => {
    if ((cam.x - at.x) ** 2 + (cam.z - at.z) ** 2 < 64) return;
    at.set(cam.x, 0, cam.z);
    let n = 0; const a = poles.instanceMatrix.array, c = poles.instanceColor.array;
    for (let i = 0; i < nP && n < cap; i++) {
      const x = P[i * 4], y = P[i * 4 + 1], z = P[i * 4 + 2];
      if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > R * R) continue;
      m.makeTranslation(x, y, z); m.toArray(a, n * 16);
      const k = cols[P[i * 4 + 3]] || cols[2]; c[n * 3] = k.r; c[n * 3 + 1] = k.g; c[n * 3 + 2] = k.b; n++;
    }
    poles.count = n; poles.instanceMatrix.needsUpdate = true; poles.instanceColor.needsUpdate = true;
  };
  // ---- the signs: one per named run, at its top (the highest point in the built area), beside it, facing up it
  const signs = [], seen = new Set();
  for (const p of W.data.pistes) {
    if (!p.name || seen.has(p.name) || p.pts.length < 2) continue;
    let best = -1, by = -Infinity;
    for (let i = 0; i < p.pts.length; i++) { const t = p.pts[i]; if (!inA(t.x, t.z)) continue; const y = ground(t.x, t.z); if (y > by) { by = y; best = i; } }
    if (best < 0) continue;
    seen.add(p.name);
    const t = p.pts[best], nb = p.pts[best > 0 ? best - 1 : best + 1];
    // down the run from its top: towards the lower neighbour
    let dx = t.x - nb.x, dz = t.z - nb.z; if (ground(nb.x, nb.z) < by) { dx = -dx; dz = -dz; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;      // (dx, dz: up the run)
    const off = p.w / 2 + 2.5, x = t.x - dz * off - dx * 4, z = t.z + dx * off - dz * 4;
    signs.push({ x, z, y: ground(x, z), face: Math.atan2(dx, dz), name: p.name.slice(0, 26), diff: p.diff, d: Math.hypot(x - W.starts[0].x, z - W.starts[0].z) });
  }
  signs.sort((a, b) => a.d - b.d);
  const S = signs.slice(0, low ? 48 : 96);
  if (S.length) {
    // the picture: a cell of 256 x 64 a sign (8 across), the last cell a plain grey for the posts
    const C = 8, rows = Math.ceil((S.length + 1) / C), cv = document.createElement('canvas'); cv.width = 256 * C; cv.height = 64 * rows;
    const x2 = cv.getContext('2d'), NA = cols[2].getHex() === 0x1f5fb8;
    const shape = (cx, cy, diff) => {
      x2.fillStyle = '#' + cols[diff].getHexString();
      if (diff === 6) { x2.beginPath(); x2.roundRect(cx - 18, cy - 12, 36, 24, 12); x2.fill(); return; }
      if (NA && diff <= 1 || !NA && diff === 0) { x2.beginPath(); x2.arc(cx, cy, 15, 0, 7); x2.fill(); return; }
      if (diff >= 3 && NA) { const two = diff >= 4; for (const ox of two ? [-11, 11] : [0]) { x2.save(); x2.translate(cx + ox, cy); x2.rotate(Math.PI / 4); x2.fillRect(-10, -10, 20, 20); x2.restore(); } return; }
      x2.fillRect(cx - 14, cy - 14, 28, 28);
    };
    S.forEach((s, i) => {
      const cx = (i % C) * 256, cy = Math.floor(i / C) * 64;
      x2.fillStyle = '#f4f7fa'; x2.fillRect(cx, cy, 256, 64);
      x2.fillStyle = '#0d1b2a'; x2.fillRect(cx, cy + 58, 256, 6);
      shape(cx + 32, cy + 30, s.diff);
      x2.fillStyle = '#0d1b2a'; x2.font = 'italic 800 30px "Barlow Condensed", "Arial Narrow", sans-serif'; x2.textBaseline = 'middle';
      let txt = s.name.toUpperCase(); while (x2.measureText(txt).width > 190 && txt.length > 4) txt = txt.slice(0, -2) + '.';
      x2.fillText(txt, cx + 58, cy + 31);
    });
    const gi = S.length, gx = (gi % C) * 256, gy = Math.floor(gi / C) * 64; x2.fillStyle = '#5b636b'; x2.fillRect(gx, gy, 256, 64);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const pos = [], uv = [], nor = [], idx = [];
    const U = (i, u, v) => [((i % C) + u) / C, 1 - (Math.floor(i / C) + v) / rows];
    const quad = (pts, n, uvs) => { const b = pos.length / 3; for (let k = 0; k < 4; k++) { pos.push(...pts[k]); nor.push(...n); uv.push(...uvs[k]); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    const gu = [U(gi, 0.5, 0.5), U(gi, 0.5, 0.5), U(gi, 0.5, 0.5), U(gi, 0.5, 0.5)];
    S.forEach((s, i) => {
      const c = Math.cos(s.face), sn = Math.sin(s.face), w = 1.4, h = 0.35, y0 = s.y + 1.55;
      // across the run's way: (c, -sn); the board faces up the run, +(sn, c)
      const ax = c, az = -sn, fx = sn, fz = c, X = s.x, Z = s.z;
      const p = (u, v, f = 0) => [X + ax * u + fx * f, y0 + v, Z + az * u + fz * f];
      quad([p(-w, -h), p(w, -h), p(w, h), p(-w, h)], [fx, 0, fz], [U(i, 0, 1), U(i, 1, 1), U(i, 1, 0), U(i, 0, 0)]);   // (read from up the run: its left end at -w)
      quad([p(-w, -h, -0.02), p(w, -h, -0.02), p(w, h, -0.02), p(-w, h, -0.02)], [-fx, 0, -fz], gu);
      // the post: four thin faces from the snow up to the board
      for (const [a, b2] of [[[1, 0], [0, 1]], [[0, 1], [-1, 0]], [[-1, 0], [0, -1]], [[0, -1], [1, 0]]]) {
        const r = 0.05, q1 = [X + (a[0] * ax + a[1] * fx) * r, s.y - 0.3, Z + (a[0] * az + a[1] * fz) * r], q2 = [X + (b2[0] * ax + b2[1] * fx) * r, s.y - 0.3, Z + (b2[0] * az + b2[1] * fz) * r];
        quad([q1, q2, [q2[0], y0 + h, q2[2]], [q1[0], y0 + h, q1[2]]], [(a[0] + b2[0]) * ax + (a[1] + b2[1]) * fx, 0, (a[0] + b2[0]) * az + (a[1] + b2[1]) * fz], gu);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    mesh.matrixAutoUpdate = false; mesh.name = 'run signs'; mesh.castShadow = false;
    scene.add(mesh);
  }
  return { update, poles: nP, signs: S.length };
}
