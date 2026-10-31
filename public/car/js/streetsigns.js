// Street name signs at junctions, from the map's own names: a pole on the corner where two named streets meet and a
// blade along each street, readable from both sides. American style (green, white letters) in the US and Canada,
// white plates with dark letters elsewhere. All names are drawn into one picture, so all signs are two draw calls.
import * as THREE from 'three';

// (round 6, perf P: half the picture's size on the low tier, quality.js; 1024 square instead of 2048)
const SQ = (globalThis.__carQuality && globalThis.__carQuality.low) ? 0.5 : 1;
const COLS = 4, ROWS = 32, CW = 512 * SQ, CH = 64 * SQ;

export class StreetSigns {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group(); this.group.name = 'streetsigns'; this.group.matrixAutoUpdate = false; scene.add(this.group);
    this.canvas = document.createElement('canvas'); this.canvas.width = COLS * CW; this.canvas.height = ROWS * CH;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8; this.tex.flipY = false;
    this.bladeMat = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.55, metalness: 0.1 });
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0x7c8086, roughness: 0.5, metalness: 0.6 });
  }

  // roads: roads.js (its _debug() edges and junctions); us: American style
  build(roads, { collide, us = false, cx = 0, cz = 0, radius = 500, buildings = null } = {}) {
    this.clear();
    const S = roads && roads._debug ? roads._debug() : null;
    if (!S || !S.junctions) return;
    const g = this.canvas.getContext('2d');
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const slots = new Map();
    const slot = name => {
      if (slots.has(name)) return slots.get(name);
      const i = slots.size; if (i >= COLS * ROWS) return null;
      const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
      g.fillStyle = us ? '#0b6b3a' : '#f4f4f0'; g.fillRect(x, y, CW, CH);
      g.strokeStyle = us ? '#f2f2ee' : '#1e2a44'; g.lineWidth = 4 * SQ; g.strokeRect(x + 4 * SQ, y + 4 * SQ, CW - 8 * SQ, CH - 8 * SQ);
      g.fillStyle = us ? '#ffffff' : '#18223a';
      let size = 40 * SQ; g.font = `600 ${size}px "Roboto Condensed", "Arial Narrow", Arial, sans-serif`;
      while (g.measureText(name).width > CW - 36 * SQ && size > 18 * SQ) { size -= 2 * SQ; g.font = `600 ${size}px "Roboto Condensed", "Arial Narrow", Arial, sans-serif`; }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(name, x + CW / 2, y + CH / 2 + 2 * SQ);
      const s = { u0: x / this.canvas.width, v0: y / this.canvas.height, u1: (x + CW) / this.canvas.width, v1: (y + CH) / this.canvas.height, w: Math.min(1.9, Math.max(0.9, 0.11 * name.length + 0.45)) };
      slots.set(name, s);
      return s;
    };
    const pos = [], uv = [], idx = [], ppos = [], pidx = [];
    const quad = (cxq, cyq, czq, dx, dz, w, h, s, flip) => {
      // a vertical quad along (dx, dz) centred at (cxq, cyq, czq); flip shows the text the right way from the back
      const b = pos.length / 3, hx = dx * w / 2, hz = dz * w / 2;
      pos.push(cxq - hx, cyq - h / 2, czq - hz, cxq + hx, cyq - h / 2, czq + hz, cxq + hx, cyq + h / 2, czq + hz, cxq - hx, cyq + h / 2, czq - hz);
      const [ua, ub] = flip ? [s.u1, s.u0] : [s.u0, s.u1];
      uv.push(ua, s.v1, ub, s.v1, ub, s.v0, ua, s.v0);
      if (flip) idx.push(b, b + 2, b + 1, b, b + 3, b + 2); else idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const pole = (x, y, z, h) => {
      const b = ppos.length / 3, r = 0.045, n = 6;
      for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; ppos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r, x + Math.cos(a) * r, y + h, z + Math.sin(a) * r); }
      for (let k = 0; k < n; k++) { const a = b + k * 2, c = b + ((k + 1) % n) * 2; pidx.push(a, c, a + 1, c, c + 1, a + 1); }
    };
    // footprints by 32 m cells: a corner where the map's buildings reach the kerb has no room for a pole
    const G = 32, bidx = new Map();
    for (const b of buildings || []) {
      if (!b || b.part || b.open || !b.outer || b.outer.length < 3 || (b.minHeight || 0) > 1) continue;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of b.outer) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
      if (x1 - x0 > 1500 || z1 - z0 > 1500) continue;
      const r = { p: b.outer, x0: x0 - 0.5, z0: z0 - 0.5, x1: x1 + 0.5, z1: z1 + 0.5 };
      for (let i = Math.floor(r.x0 / G); i <= Math.floor(r.x1 / G); i++) for (let j = Math.floor(r.z0 / G); j <= Math.floor(r.z1 / G); j++) { const k = i + ',' + j; let l = bidx.get(k); if (!l) bidx.set(k, l = []); l.push(r); }
    }
    const inBuilding = (x, z) => {
      const l = bidx.get(Math.floor(x / G) + ',' + Math.floor(z / G)); if (!l) return false;
      for (const r of l) {
        if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
        let c = false, d2 = Infinity; const P = r.p;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const a = P[i], q = P[j];
          if ((a[1] > z) !== (q[1] > z) && x < (q[0] - a[0]) * (z - a[1]) / (q[1] - a[1]) + a[0]) c = !c;
          const ex = q[0] - a[0], ez = q[1] - a[1], L2 = ex * ex + ez * ez, t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / L2)) : 0;
          d2 = Math.min(d2, (a[0] + ex * t - x) ** 2 + (a[1] + ez * t - z) ** 2);
        }
        if (c || d2 < 0.25) return true; // inside, or the blades would touch the wall
      }
      return false;
    };
    let made = 0;
    for (const J of S.junctions) {
      if (!J.n || !J.E || J.E.length < 3) continue;
      if ((J.n.x - cx) ** 2 + (J.n.z - cz) ** 2 > radius * radius) continue;
      const legs = J.E.map(L => { const e = L.e || L; const t = e.way && e.way.tags; const name = t && t.name; const l = Math.hypot(L.dx, L.dz) || 1; return { name, dx: L.dx / l, dz: L.dz / l, hw: e.c ? e.c.hw : 4 }; }).filter(l => l.name);
      // two legs of different streets, the first pair round the junction
      let A = null, B = null;
      for (let i = 0; i < legs.length && !B; i++) for (let k = 0; k < legs.length && !B; k++) if (legs[i].name !== legs[k].name) { const dot = legs[i].dx * legs[k].dx + legs[i].dz * legs[k].dz; if (Math.abs(dot) < 0.6) { A = legs[i]; B = legs[k]; } }
      if (!A || !B) continue;
      const sa = slot(A.name), sb = slot(B.name);
      if (!sa || !sb) continue;
      // the corner of the block between the two streets, past the kerb
      const x = J.n.x + A.dx * (B.hw + 1.4) + B.dx * (A.hw + 1.4), z = J.n.z + A.dz * (B.hw + 1.4) + B.dz * (A.hw + 1.4);
      const sf = roads.surfaceAt(x, z);
      if (sf && sf.onRoad) continue;
      if (inBuilding(x, z)) continue;
      const y = sf && Number.isFinite(sf.h) ? sf.h : (Number.isFinite(J.n.h) ? J.n.h + 0.15 : 0);
      pole(x, y, z, 3.15);
      quad(x, y + 2.86, z, A.dx, A.dz, sa.w, 0.19, sa, false); quad(x, y + 2.86, z, A.dx, A.dz, sa.w, 0.19, sa, true);
      quad(x, y + 3.08, z, B.dx, B.dz, sb.w, 0.19, sb, false); quad(x, y + 3.08, z, B.dx, B.dz, sb.w, 0.19, sb, true);
      if (collide) collide.addCircle(x, z, 0.06, y - 0.5, y + 3.2, 'sign');
      made++;
    }
    this.tex.needsUpdate = true;
    if (!made) return;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); bg.setIndex(idx); bg.computeVertexNormals();
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3)); pg.setIndex(pidx); pg.computeVertexNormals();
    const blades = new THREE.Mesh(bg, this.bladeMat), poles = new THREE.Mesh(pg, this.poleMat);
    blades.castShadow = poles.castShadow = true; blades.receiveShadow = true;
    blades.matrixAutoUpdate = poles.matrixAutoUpdate = false; // (built in place: nothing to work out each frame; perf)
    this.group.add(blades, poles);
    this.count = made;
  }

  clear() {
    for (const m of [...this.group.children]) { this.group.remove(m); m.geometry.dispose(); }
    this.count = 0;
  }
}
