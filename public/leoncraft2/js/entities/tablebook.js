/* ---------------------------------------------------------------------------
   Leoncraft 2 - the book over an enchanting table, and the runes that fly
   to it from the bookshelves.

   As in the game: a book floats above every enchanting table, bobbing
   gently. With nobody within 3 blocks it is shut and turns slowly round;
   when you come near it turns to face you, opens, and its pages flip now
   and then. Now and again a rune lifts off each bookshelf that powers the
   table (js/enchanting.js countShelves) and drifts into the table.

   The book is a small model drawn with the mobs (two covers, their pages,
   two loose pages and the spine; our own art), so it takes the world's
   light like they do. Books are found by looking over the area round you
   one layer a tick, and are not saved: they come back with their tables.
--------------------------------------------------------------------------- */
import { Entity } from './entity.js?v=18';
import { register } from './mobs.js?v=18';
import { model } from './mobs2.js?v=18';
import { addArt } from './mobart.js?v=18';
import { B, BLOCKS } from '../blocks.js?v=18';

const R = () => Math.random();
const PI = Math.PI;

/* ---- the book's shape: both halves turn about the spine (open: each turns its share) ---- */
model('enchant_book', [
  { name: 'left', pivot: [0, 24, 0] },
  { name: 'right', pivot: [0, 24, 0] },
  { name: 'leftCover', parent: 'left', boxes: [[0, -5, -1, 6, 10, 0, 0, 0]] },
  { name: 'leftPages', parent: 'left', boxes: [[0, -4, -1, 5, 8, 1, 0, 10]] },
  { name: 'rightCover', parent: 'right', boxes: [[0, -5, 1, 6, 10, 0, 12, 0]] },
  { name: 'rightPages', parent: 'right', boxes: [[0, -4, 0, 5, 8, 1, 14, 10]] },
  { name: 'flip1', pivot: [0, 24, 0], boxes: [[0, -4, 0, 5, 8, 0, 28, 0]] },
  { name: 'flip2', pivot: [0, 24, 0], boxes: [[0, -4, 0, 5, 8, 0, 28, 10]] },
  { name: 'spine', pivot: [0, 24, 0], boxes: [[0, -5, -1, 0, 10, 2, 40, 0]] },
], (m, P, A) => {
  const I = m.index, open = A.open || 0, th = open * 1.25;
  const at = (i, ry) => { P[i * 7 + 4] = ry; };
  at(I.left, th); at(I.right, -th);
  // the loose pages lie between the halves, turning across as the flip goes
  const f1 = A.flip1 || 0, f2 = A.flip2 || 0;
  at(I.flip1, th - th * 2 * f1); at(I.flip2, th - th * 2 * f2);
  P[I.spine * 7 + 4] = 0;
});
addArt('enchant_book', [64, 32], p => {
  const leather = 0x6e3a1e, leatherD = 0x55291a, inner = 0x8a5634, page = 0xeee6cf, ink = 0x8a7f6a, gold = 0xd8b04a;
  // covers: outside leather with a gold edge, inside lighter
  p.box(0, 0, 6, 10, 0, { front: leather, back: inner }, 0.06);
  p.box(12, 0, 6, 10, 0, { front: inner, back: leather }, 0.06);
  for (const x of [0, 18]) { p.fill(x, 0, 6, 1, gold); p.fill(x, 9, 6, 1, gold); p.fill(x + (x ? 5 : 0), 0, 1, 10, leatherD); }
  // the pages: cream, with lines of writing on the open faces
  p.box(0, 10, 5, 8, 1, page, 0.04);
  p.box(14, 10, 5, 8, 1, page, 0.04);
  for (const [u, v] of [[7, 11], [15, 11]]) for (let r = 1; r < 8; r += 2) p.fill(u + 1, v + r, 3, 1, ink);
  p.box(28, 0, 5, 8, 0, page, 0.03); p.box(28, 10, 5, 8, 0, page, 0.03);
  for (const v of [0, 10]) for (let r = 1; r < 8; r += 2) { p.fill(29, v + r, 3, 1, ink); p.fill(34, v + r, 3, 1, ink); }
  p.box(40, 0, 0, 10, 2, leatherD, 0.06);
});

/* ---- the book ---- */
export class TableBook extends Entity {
  static W = 0.4; static H = 0.4; static STEP = 0; static NOT_PICKABLE = true; static NO_PUSH = true; static MODEL = 'enchant_book'; static TEX = 'enchant_book';
  constructor(m, type) {
    super(m, type);
    this.noPhysics = true; this.gravity = 0;
    this.open = 0; this.prevOpen = 0; this.want = R() * PI * 2;
    this.flip = 0; this.prevFlip = 0; this.flipTo = 0; this.flipV = 0;
    this.table = null;
  }
  tick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw; this.age++;
    this.prevOpen = this.open; this.prevFlip = this.flip;
    const P = this.m.player, [x, y, z] = this.table;
    const dx = P.pos.x - (x + 0.5), dz = P.pos.z - (z + 0.5), near = P.alive() && dx * dx + (P.pos.y - y - 0.5) ** 2 + dz * dz <= 9;
    if (near) {
      // face whoever is near; open; now and then a page goes over
      this.want = Math.atan2(-dx, -dz);
      this.open = Math.min(1, this.open + 0.1);
      if (this.open < 0.5 || R() < 1 / 40) { const was = this.flipTo; while (this.flipTo === was) this.flipTo += Math.floor(R() * 4) - Math.floor(R() * 4); }
    } else { this.want += 0.02; this.open = Math.max(0, this.open - 0.1); }
    let d = this.want - this.yaw;
    while (d > PI) d -= PI * 2;
    while (d < -PI) d += PI * 2;
    this.yaw += d * 0.4;
    const v = Math.max(-0.2, Math.min(0.2, (this.flipTo - this.flip) * 0.4));
    this.flipV += (v - this.flipV) * 0.9;
    this.flip += this.flipV;
    // bobbing a little above the table
    this.pos.set(x + 0.5, y + 0.75 + 0.1 + Math.sin(this.age * 0.1) * 0.01, z + 0.5);
  }
  anim(A, a) {
    A.open = this.prevOpen + (this.open - this.prevOpen) * a;
    const f = this.prevFlip + (this.flip - this.prevFlip) * a;
    const frac = t => { const k = t - Math.floor(t); return Math.max(0, Math.min(1, k * 1.6 - 0.3)); };
    A.flip1 = frac(f + 0.25); A.flip2 = frac(f + 0.75);
  }
  // lying back on the air (tipped over most of the way), facing its yaw
  rootPose(root, t) { root.multiply(t.makeRotationZ(-80 * PI / 180)); }
  remove() { super.remove(); if (this.table && this.m.books) this.m.books.delete(this.table.join()); }
}
TableBook.prototype.toJSON = undefined;
register('table_book', TableBook);

/* ---- finding the tables, and the runes ---- */
const OFFSETS = [];
for (let oy = 0; oy <= 1; oy++) for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) if (Math.abs(ox) === 2 || Math.abs(oz) === 2) OFFSETS.push([ox, oy, oz]);
const passes = b => { const d = BLOCKS[b]; return !d || d.replaceable || d.fluid; };
export function tableBooks(m) {
  if (B.enchanting_table === undefined) return;
  const books = m.books || (m.books = new Map());
  const T = m.t, P = m.P, px = Math.floor(P.pos.x), py = Math.floor(P.pos.y), pz = Math.floor(P.pos.z);
  // one layer of the 33 x 17 x 33 blocks round you a tick
  const ly = py - 8 + (m.age % 17);
  for (let z = pz - 16; z <= pz + 16; z++) for (let x = px - 16; x <= px + 16; x++) {
    if (T.get(x, ly, z) !== B.enchanting_table) continue;
    const k = x + ',' + ly + ',' + z;
    if (books.has(k)) continue;
    const e = m.spawn('table_book', x + 0.5, ly + 0.85, z + 0.5, { natural: false });
    if (e) { e.table = [x, ly, z]; books.set(k, e); }
  }
  for (const [k, e] of books) {
    const [x, y, z] = e.table;
    if (e.removed) { books.delete(k); continue; }
    if (T.get(x, y, z) !== B.enchanting_table || (x - P.pos.x) ** 2 + (z - P.pos.z) ** 2 > 48 * 48) { e.remove(); continue; }
    // now and then (as often as the game shows its tables), runes from the shelves that power it
    if (R() < 0.021 && (x - P.pos.x) ** 2 + (z - P.pos.z) ** 2 < 256) {
      for (const [ox, oy, oz] of OFFSETS) {
        if (R() >= 1 / 16 || T.get(x + ox, y + oy, z + oz) !== B.bookshelf || !passes(T.get(x + Math.trunc(ox / 2), y + oy, z + Math.trunc(oz / 2)))) continue;
        rune(m, x + ox + 0.5 + (R() - 0.5) * 0.6, y + oy + 1 + R() * 0.6, z + oz + 0.5 + (R() - 0.5) * 0.6, x + 0.5, y + 1.15, z + 0.5);
      }
    }
  }
}
// a rune from (sx, sy, sz) drifting up and over into (tx, ty, tz)
function rune(m, sx, sy, sz, tx, ty, tz) {
  const P = m.particlesP;
  const before = P.n;
  P.add('enchant', sx, sy, sz, 1, 0);
  if (P.n === before) return;
  const i = P.n - 1, o = i * 3, life = P.life[i * 2 + 1];
  P.vel[o] = (tx - sx) / life; P.vel[o + 2] = (tz - sz) / life;
  // up first, then down into the book: a little lift against the pull the kind has
  P.vel[o + 1] = (ty - sy) / life + P.info[i * 6 + 3] * life / 2;
}
