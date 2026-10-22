// Landmarks the map data can only give as boxes, built here to their real dimensions for the open map (Google's
// mesh has them itself): the Eiffel Tower (iron lattice, four legs to the first floor, the shaft to the top) and
// the Arc de Triomphe (limestone, the great arch through it). The footprints the map draws there are left out, so
// what stands is the landmark; its legs and piers are solid.
import * as THREE from 'three';
import { project } from './geo.js?v=19';

const SITES = [
  { id: 'eiffel', lat: 48.85826, lon: 2.29448, clear: 80, heading: 39 },
  { id: 'arc', lat: 48.87380, lon: 2.29504, clear: 32, heading: 112 },
];

// the footprints to leave out (their middles within a landmark's clearing)
export function filterBuildings(list) {
  const near = SITES.map(s => { const [x, z] = project(s.lat, s.lon); return { x, z, r: s.clear }; }).filter(s => Math.hypot(s.x, s.z) < 8000);
  if (!near.length || !list) return list;
  return list.filter(b => {
    if (!b.outer || !b.outer.length) return true;
    let cx = 0, cz = 0; for (const p of b.outer) { cx += p[0]; cz += p[1]; } cx /= b.outer.length; cz /= b.outer.length;
    return !near.some(s => Math.hypot(cx - s.x, cz - s.z) < s.r);
  });
}

let LATTICE = null;
function latticeTexture() {
  if (LATTICE) return LATTICE;
  // criss-crossed iron: a frame and two diagonals a panel, with a finer lattice inside the members' gaps
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#fff'; g.lineCap = 'square';
  g.lineWidth = 9; g.strokeRect(4, 4, S - 8, S - 8);
  g.lineWidth = 6; g.beginPath(); g.moveTo(0, 0); g.lineTo(S, S); g.moveTo(S, 0); g.lineTo(0, S); g.stroke();
  g.lineWidth = 2; g.beginPath();
  for (let k = -S; k < S * 2; k += 16) { g.moveTo(k, 0); g.lineTo(k + S, S); g.moveTo(k, S); g.lineTo(k + S, 0); }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return (LATTICE = t);
}

// a tapered square section from y0 (half width w0, centre c0) to y1 (w1, c1), its four faces; uv in metres / panel
function frustum(pos, uv, idx, x0, z0, w0, y0, x1, z1, w1, y1, panel) {
  const corners = (x, z, w, y) => [[x - w, y, z - w], [x + w, y, z - w], [x + w, y, z + w], [x - w, y, z + w]];
  const A = corners(x0, z0, w0, y0), B = corners(x1, z1, w1, y1);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, b = pos.length / 3;
    const a0 = A[i], a1 = A[j], b1 = B[j], b0 = B[i];
    pos.push(...a0, ...a1, ...b1, ...b0);
    const wB = Math.hypot(a1[0] - a0[0], a1[2] - a0[2]), wT = Math.hypot(b1[0] - b0[0], b1[2] - b0[2]), vv = (y1 - y0) / panel;
    uv.push(0, 0, wB / panel, 0, wT / panel, vv, 0, vv);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

function eiffel() {
  const pos = [], uv = [], idx = [];
  // four legs from the corners of a 125 m square, leaning in to meet the first floor at 57 m, in steps that curve
  const legSteps = [[0, 62.5, 7.5], [20, 50, 6.8], [40, 39.5, 6.0], [57, 31, 5.4]];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (let k = 0; k + 1 < legSteps.length; k++) {
      const [ya, da, wa] = legSteps[k], [yb, db, wb] = legSteps[k + 1];
      frustum(pos, uv, idx, sx * (da - wa), sz * (da - wa), wa, ya, sx * (db - wb), sz * (db - wb), wb, yb, 6);
    }
  }
  // the shaft: from the first floor (about 65 m across the legs' tops) to the top, curving in
  const shaft = [[57, 26], [80, 21], [115, 15.5], [160, 10.5], [210, 7.0], [250, 5.2], [276, 4.2]];
  for (let k = 0; k + 1 < shaft.length; k++) {
    const [ya, wa] = shaft[k], [yb, wb] = shaft[k + 1];
    frustum(pos, uv, idx, 0, 0, wa, ya, 0, 0, wb, yb, 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const iron = new THREE.MeshStandardMaterial({ color: 0x6a4f38, roughness: 0.8, metalness: 0.35, alphaMap: latticeTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  const grp = new THREE.Group(); grp.name = 'landmark:eiffel';
  const lattice = new THREE.Mesh(g, iron); lattice.castShadow = true; lattice.receiveShadow = true; grp.add(lattice);
  // the platforms and the arches under the first floor, solid
  const deck = new THREE.MeshStandardMaterial({ color: 0x5c4532, roughness: 0.75, metalness: 0.3 });
  for (const [y, w, t] of [[57, 34, 4.5], [115, 20, 3.5], [276, 6, 3]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * 2, t, w * 2), deck); m.position.y = y; m.castShadow = true; grp.add(m);
  }
  for (const r of [0, Math.PI / 2]) {
    // the decorative arches between the legs on each face, their feet on the legs' inner faces
    const arch = new THREE.Mesh(new THREE.TorusGeometry(42, 1.4, 6, 24, Math.PI), deck);
    arch.rotation.y = r; arch.position.y = 6; arch.castShadow = true;
    for (const s of [-1, 1]) { const a = arch.clone(); if (r) a.position.x = s * 48; else a.position.z = s * 48; grp.add(a); }
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.4, 54, 8), deck); mast.position.y = 276 + 27; grp.add(mast);
  // solid: the four legs where they stand
  const solid = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const cx = sx * (62.5 - 7.5), cz = sz * (62.5 - 7.5), w = 8.5;
    solid.push([[cx - w, cz - w], [cx + w, cz - w], [cx + w, cz + w], [cx - w, cz + w]]);
  }
  return { grp, solid, height: 330 };
}

function arc() {
  // the front: 45 m wide, 50 m tall, the great arch 14.6 m wide and 29.2 m high (a round head), 22 m deep
  const W = 45, H = 50, D = 22, aw = 14.6, ah = 29.2, r = aw / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2, 0); shape.lineTo(W / 2, 0); shape.lineTo(W / 2, H); shape.lineTo(-W / 2, H); shape.lineTo(-W / 2, 0);
  const hole = new THREE.Path();
  hole.moveTo(-r, 0); hole.lineTo(-r, ah - r); hole.absarc(0, ah - r, r, Math.PI, 0, true); hole.lineTo(r, 0); hole.lineTo(-r, 0);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 20 });
  geo.translate(0, 0, -D / 2);
  const stone = new THREE.MeshStandardMaterial({ color: 0xc9b998, roughness: 0.9, metalness: 0 });
  const grp = new THREE.Group(); grp.name = 'landmark:arc';
  const m = new THREE.Mesh(geo, stone); m.castShadow = true; m.receiveShadow = true; grp.add(m);
  // the cornice and the attic's top edge
  const band = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 1.4, D + 1.2), stone); band.position.y = 37; band.castShadow = true; grp.add(band);
  const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 1.0, D + 0.8), stone); top.position.y = H - 0.5; grp.add(top);
  // solid: the two piers either side of the arch
  const solid = [];
  for (const s of [-1, 1]) { const x0 = s * r, x1 = s * W / 2; solid.push([[Math.min(x0, x1), -D / 2], [Math.max(x0, x1), -D / 2], [Math.max(x0, x1), D / 2], [Math.min(x0, x1), D / 2]]); }
  return { grp, solid, height: H };
}

export class Landmarks {
  constructor(scene) { this.scene = scene; this.group = new THREE.Group(); this.group.name = 'landmarks'; scene.add(this.group); this.built = new Map(); this.handles = []; }

  // put the landmarks within reach of (cx, cz) on the ground; ground(x, z) -> height
  build({ cx = 0, cz = 0, collide, ground }) {
    for (const s of SITES) {
      const [x, z] = project(s.lat, s.lon);
      if (Math.hypot(x - cx, z - cz) > 6000) { const old = this.built.get(s.id); if (old) { this.group.remove(old); this.built.delete(s.id); } continue; }
      let L = this.built.get(s.id);
      const made = !L ? (s.id === 'eiffel' ? eiffel() : arc()) : null;
      if (made) { L = made.grp; L.userData.solid = made.solid; this.built.set(s.id, L); this.group.add(L); }
      // the ground: the lowest of the corners and the middle, so no foot hangs in the air
      let y = Infinity;
      for (const [dx, dz] of [[0, 0], [40, 40], [-40, 40], [40, -40], [-40, -40]]) { const g = ground(x + dx * (s.id === 'arc' ? 0.4 : 1), z + dz * (s.id === 'arc' ? 0.4 : 1)); if (g != null && Number.isFinite(g)) y = Math.min(y, g); }
      if (!Number.isFinite(y)) y = 0;
      L.position.set(x, y, z); L.rotation.y = -s.heading * Math.PI / 180; L.updateMatrixWorld(true);
      if (collide && collide.addPolygon) {
        const c = Math.cos(-s.heading * Math.PI / 180), sn = Math.sin(-s.heading * Math.PI / 180);
        for (const poly of L.userData.solid) {
          // Object3D rotation about y: x' = x cos + z sin, z' = -x sin + z cos
          const world = poly.map(([px, pz]) => [x + px * c + pz * sn, z - px * sn + pz * c]);
          try { collide.addPolygon(world, y - 1, y + 60, 'building'); } catch (e) {}
        }
      }
    }
  }

  dispose() { this.scene.remove(this.group); }
}
