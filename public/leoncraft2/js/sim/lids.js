/* ---------------------------------------------------------------------------
   Leoncraft 2 - the parts of blocks that move, as the game's block entity
   renderers move them:

     chests          (and trapped, ender and copper chests, and both halves
                     of a large chest) open their lid while anyone has them
                     open and let it fall shut after: the openness goes up or
                     down by a tenth a tick and the lid stands at
                     90 degrees x (1 - (1 - openness)^3), hinged along the back
     shulker boxes   the lid lifts half a block out of the box and turns
                     270 degrees as it goes, a tenth of the way a tick
     barrels         show their open top while open (the block's meta bit 3,
                     a state of the block, as in the game)
     bells           swing for 50 ticks when they ring, sin(t / pi) / (4 + t / 3)
                     radians, away from the side they were struck on
     decorated pots  wobble when something goes in (a twist, 7 ticks) or will
                     not go in (a rock from side to side, 10 ticks)

   While a part moves, the block's own mesh is made without it
   (world.setMoving: the mesher draws those cells from models.js movingDef)
   and the part is a small mesh of its own here, in the world's block
   textures, lit by the light in its cell and drawn between ticks. When the
   lid is shut again the block takes it back, and the moving one is kept a
   few frames more, so there is never a moment with no lid.
--------------------------------------------------------------------------- */
import { BLOCKS } from '../blocks.js?v=107';
import { SHAPES, chestParts, fixUV, turn, rotate } from '../models.js?v=107';
import { intAttribute } from '../render/blockmesh.js?v=107';
const THREE = window.THREE;

let ACTIVE = null;                 // the dimension being played (each has its own simulation)
const key = (x, y, z) => x + ',' + y + ',' + z;
const PI = Math.PI;

/* A container screen was opened on a block: its lid opens until the screen closes. */
export function boxOpened(x, y, z, screen, partner) {
  const L = ACTIVE;
  if (!L) return;
  const spots = [[x, y, z]].concat(partner ? [partner] : []);
  for (const [a, b, c] of spots) L.open(a, b, c);
  if (!screen) return;
  const prev = screen.onClosed;
  screen.onClosed = () => { if (prev) prev(); for (const [a, b, c] of spots) L.close(a, b, c); };
}
// a bell rang, struck by the player from the side whose face (0-5, as models.js numbers them) was hit; the
// simulation hears it as it hears a powered one (sim.onBell: its sound), then it swings
export function bellRang(x, y, z, face) {
  const L = ACTIVE;
  if (!L) return;
  const s = L.sim;
  if (s.onBell) s.onBell(x, y, z);
  s.lastBell = { x, y, z, at: s.n };
  L.ring(x, y, z, face);
}
// something went into a decorated pot (ok), or it would not take it
export function potWobbled(x, y, z, ok) { if (ACTIVE) ACTIVE.wobble(x, y, z, ok); }

const FACES_N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE_TB = [[[2, -1], [1, -1]], [[2, 1], [1, -1]], [[0, 1], [2, 1]], [[0, 1], [2, -1]], [[0, 1], [1, -1]], [[0, -1], [1, -1]]];
const CORNERS = [[0, 1], [1, 1], [1, 0], [0, 0]];
/* Boxes in sixteenths (models.js form) as a mesh in the world's block vertex format, the block's own corner
   at the origin. Every face is drawn (the part moves away from what hid it). */
function partGeometry(list, d) {
  const P = [], A = [], Lt = [], C = [], idx = [];
  const tinted = d.tint ? 64 : 0;
  for (const bx of list) {
    if (bx.q || bx.hide) continue;
    const faces = bx.faces || d.faces;
    for (let f = 0; f < 6; f++) {
      if (bx.skip && (bx.skip & (1 << f))) continue;
      const n = FACES_N[f], [[kt, st], [kb, sb]] = FACE_TB[f], k = n.findIndex(v => v !== 0);
      const r = bx.uv && bx.uv[f];
      const v0 = P.length / 4;
      for (const [u, v] of CORNERS) {
        const p = [0, 0, 0];
        p[k] = n[k] > 0 ? bx.t[k] : bx.f[k];
        p[kt] = (st > 0) === (u === 1) ? bx.t[kt] : bx.f[kt];
        p[kb] = (sb > 0) === (v === 1) ? bx.t[kb] : bx.f[kb];
        let tu = st > 0 ? p[kt] : 16 - p[kt], tv = sb > 0 ? p[kb] : 16 - p[kb];
        if (r) { if (r[4]) { tu = v ? r[2] : r[0]; tv = u ? r[3] : r[1]; } else { tu = u ? r[2] : r[0]; tv = v ? r[3] : r[1]; } }
        P.push(Math.round((p[0] / 16 + 8) * 32), Math.round(p[1] / 16 * 32), Math.round((p[2] / 16 + 8) * 32), faces[f]);
        A.push(Math.round(tu), Math.round(tv), f, 3 | tinted);
        Lt.push(255, 0, 0, 0);
        C.push(255, 255, 255, 255);
      }
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('aPos', intAttribute(new Uint16Array(P)));
  g.setAttribute('aA', intAttribute(new Uint8Array(A)));
  g.setAttribute('aL', intAttribute(new Uint8Array(Lt)));
  g.setAttribute('aC', intAttribute(new Uint8Array(C)));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, 0.5), 2);
  return g;
}

// the turn of a north-facing model to facing f (0-3), as models.js turn() does it: (x, z) -> (16 - z, x) a quarter
const TURN = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0]];
const turnPoint = (p, f) => { const [a, b, c, e] = TURN[f & 3], x = p[0] - 8, z = p[2] - 8; return [8 + a * x + b * z, p[1], 8 + c * x + e * z]; };
const turnVec = (v, f) => { const [a, b, c, e] = TURN[f & 3]; return [a * v[0] + b * v[2], v[1], c * v[0] + e * v[2]]; };
// the game's turns that stand a shulker box the way it faces (as models.js LOOKS.ends): x then y quarter turns
const ENDS = [[1, 0], [1, 1], [1, 2], [1, 3], [0, 0], [2, 0]];
const FACING_VEC = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];

export class Lids {
  constructor(sim) {
    this.sim = sim;
    this.w = sim.world;
    this.list = new Map();             // "x,y,z" -> the moving part
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    const r = sim.renderer;
    if (r && r.scene) r.scene.add(this.group);
    this.lastTick = performance.now();
    this.m4 = new THREE.Matrix4(); this.t4 = new THREE.Matrix4();
    ACTIVE = this;
    (sim.tickers || (sim.tickers = [])).push(() => this.tick());
    // (a powered bell is rung by sim/rsparts.js, straight through sim.lids, so whatever else listens on
    // sim.onBell, the sound, can take that hook over)
    const frame = () => {
      if (this.dead) return;
      if (this.list.size) this.frame(Math.min(1, (performance.now() - this.lastTick) / 50));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  dispose() {
    this.dead = true;
    for (const e of this.list.values()) this.drop(e, true);
    this.list.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
    if (ACTIVE === this) ACTIVE = null;
  }

  /* ---- what moves ---- */
  entry(x, y, z) {
    const k = key(x, y, z);
    let e = this.list.get(k);
    if (e) return e;
    const b = this.w.get(x, y, z);
    if (!b) return null;
    const d = BLOCKS[b], m = this.w.meta(x, y, z);
    const kind = d.shape === 'chest' ? 'chest' : /shulker_box$/.test(d.name) ? 'shulker' : d.name === 'barrel' ? 'barrel' : d.shape === 'bell' ? 'bell'
      : d.shape === 'vase' ? 'pot' : null;
    if (!kind) return null;
    e = { k, x, y, z, b, d, m, kind, viewers: 0, open: 0, prev: 0, ticks: 0, face: 0, mesh: null, keep: 0, shown: false };
    this.list.set(k, e);
    return e;
  }
  open(x, y, z) {
    const e = this.entry(x, y, z);
    if (!e) return;
    e.viewers++;
    // (heard by sculk sensors, as the game's container_open)
    if (this.sim.sculk) this.sim.sculk.vibrate(x + 0.5, y + 0.5, z + 0.5, 15, true);
    // a barrel: its open top is a state of the block
    if (e.kind === 'barrel') { const m = this.w.meta(x, y, z); if (!(m & 8)) this.w.set(x, y, z, e.b, m | 8); return; }
    this.show(e);
  }
  close(x, y, z) {
    const e = this.list.get(key(x, y, z));
    if (!e) return;
    e.viewers = Math.max(0, e.viewers - 1);
    if (this.sim.sculk) this.sim.sculk.vibrate(x + 0.5, y + 0.5, z + 0.5, 14, true);
    if (e.kind === 'barrel' && !e.viewers) {
      const m = this.w.meta(x, y, z);
      if (this.w.get(x, y, z) === e.b && (m & 8)) this.w.set(x, y, z, e.b, m & ~8);
      this.list.delete(e.k);
    }
  }
  ring(x, y, z, face) {
    const e = this.entry(x, y, z);
    if (!e || e.kind !== 'bell') return;
    e.ticks = 0; e.ringing = true; e.face = face;
    this.show(e);
  }
  // a decorated pot: a twist when something goes in, a shake of the head when it will not take it
  wobble(x, y, z, ok) {
    const e = this.entry(x, y, z);
    if (!e || e.kind !== 'pot') return;
    e.ticks = 0; e.ringing = true; e.ok = ok;
    this.show(e);
  }
  // the moving part's own mesh, and the block meshed without it
  show(e) {
    if (e.mesh) { e.keep = 0; if (!e.shown) { e.shown = true; this.w.setMoving(e.x, e.y, e.z, true); } return; }
    const r = this.sim.renderer;
    if (!r || !r.mats) return;
    const d = e.d, m = e.m;
    let list;
    if (e.kind === 'chest') list = turn(chestParts(d, m | 512).map(fixUV), m & 3);
    else if (e.kind === 'shulker') { const [rx, ry] = ENDS[Math.min(5, m & 7)]; list = rotate(SHAPES.shulker(Object.assign(Object.create(d), { shape: 'shulker' }), m | 512), rx, ry); }
    else if (e.kind === 'pot') list = SHAPES.vase(d, m | 512);
    else list = SHAPES.bell(d, m | 512);
    const cut = d.pass !== 'opaque';
    e.mesh = new THREE.Mesh(partGeometry(list, d), cut ? r.mats.cutout : r.mats.opaque);
    e.mesh.frustumCulled = false; e.mesh.matrixAutoUpdate = false;
    this.group.add(e.mesh);
    this.light(e);
    e.shown = true;
    this.w.setMoving(e.x, e.y, e.z, true);
    this.place(e, 0);
  }
  drop(e, now) {
    if (e.shown) { e.shown = false; this.w.setMoving(e.x, e.y, e.z, false); }
    if (!now) return;
    if (e.mesh) { this.group.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh = null; }
  }
  // the light in the block's cell (a shulker box is a whole block, dark inside: the cell its lid opens into), into the part's vertices
  light(e) {
    let x = e.x, y = e.y, z = e.z;
    if (e.kind === 'shulker') { const v = FACING_VEC[Math.min(5, e.m & 7)]; x += v[0]; y += v[1]; z += v[2]; }
    const c = this.w.chunkAt(x, z);
    let s = 15, bl = 0;
    if (c && c.light && y >= 0 && y < c.lightH) { const v = c.light[(y << 8) | ((z - c.cz * 16) << 4) | (x - c.cx * 16)]; s = v >> 4; bl = v & 15; }
    const lv = (s << 4) | bl;
    if (lv === e.lv || !e.mesh) return;
    e.lv = lv;
    const L = e.mesh.geometry.attributes.aL;
    for (let i = 0; i < L.count; i++) { L.array[i * 4] = s * 17; L.array[i * 4 + 1] = bl * 17; }
    L.needsUpdate = true;
  }

  /* ---- each tick: how far open ---- */
  tick() {
    this.lastTick = performance.now();
    for (const e of [...this.list.values()]) {
      // the block was broken or changed: whatever moved goes with it
      if (this.w.get(e.x, e.y, e.z) !== e.b) { this.drop(e, true); this.list.delete(e.k); continue; }
      if (e.kind === 'barrel') continue;
      e.prev = e.open;
      if (e.kind === 'bell' || e.kind === 'pot') {
        if (e.ringing && ++e.ticks >= (e.kind === 'bell' ? 50 : e.ok ? 7 : 10)) { e.ringing = false; e.ticks = 0; }
      } else e.open = Math.max(0, Math.min(1, e.open + (e.viewers > 0 ? 0.1 : -0.1)));
      if (e.mesh) this.light(e);
      const still = e.kind === 'bell' || e.kind === 'pot' ? !e.ringing : e.viewers === 0 && e.open === 0 && e.prev === 0;
      if (still) {
        // shut: the block takes its part back; the moving one stays a few ticks while the block's mesh is made
        if (e.shown) this.drop(e, false);
        if (++e.keep > 4) { this.drop(e, true); this.list.delete(e.k); }
      }
    }
  }
  /* ---- each frame: where the part is, between the last tick and this one ---- */
  frame(a) {
    for (const e of this.list.values()) if (e.mesh) this.place(e, a);
  }
  place(e, a) {
    const M = this.m4.makeTranslation(e.x, e.y, e.z), T = this.t4;
    const pivot = (p, axis, ang, off) => {
      M.multiply(T.makeTranslation(p[0] / 16, p[1] / 16, p[2] / 16));
      if (off) M.multiply(T.makeTranslation(off[0], off[1], off[2]));
      if (ang) M.multiply(T.makeRotationAxis(new THREE.Vector3(axis[0], axis[1], axis[2]), ang));
      M.multiply(T.makeTranslation(-p[0] / 16, -p[1] / 16, -p[2] / 16));
    };
    const t = e.prev + (e.open - e.prev) * a;
    if (e.kind === 'chest') {
      // hinged along the back of the lid, at its foot (y 9), the front rising
      const f = 1 - (1 - t) * (1 - t) * (1 - t), F = e.m & 3;
      pivot(turnPoint([8, 9, 15], F), turnVec([1, 0, 0], F), f * PI / 2);
    } else if (e.kind === 'shulker') {
      // out along the way it faces, half a block, turning about that line
      const v = FACING_VEC[Math.min(5, e.m & 7)];
      pivot([8, 8, 8], v, t * PI * 1.5, [v[0] * t * 0.5, v[1] * t * 0.5, v[2] * t * 0.5]);
    } else if (e.kind === 'bell' && e.ringing) {
      // about its top, away from the side that was struck
      const s = e.ticks + a, j = Math.sin(s / PI) / (4 + s / 3), n = FACES_N[e.face] || [0, 0, -1];
      // struck on a side with normal n: it swings about the level line across n, its foot first away from the blow
      const axis = [-n[2], 0, n[0]];
      if (axis[0] || axis[2]) pivot([8, 12, 8], axis, -j);
    } else if (e.kind === 'pot' && e.ringing) {
      // on its foot: a quick twist about its middle that dies away, or a rock from side to side
      const s = (e.ticks + a) / (e.ok ? 7 : 10);
      if (e.ok) pivot([8, 0, 8], [0, 1, 0], Math.sin(-s * PI * 3) * 0.125 * (1 - s));
      else { pivot([8, 0, 8], [1, 0, 0], Math.sin(s * PI * 2) * 0.06 * (1 - s)); pivot([8, 0, 8], [0, 0, 1], Math.sin(s * PI * 4) * 0.04 * (1 - s)); }
    }
    e.mesh.matrix.copy(M);
    e.mesh.matrixWorldNeedsUpdate = true;
  }
}
