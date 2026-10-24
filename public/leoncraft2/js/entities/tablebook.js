/* ---------------------------------------------------------------------------
   Leoncraft 2 - the book over an enchanting table, and the runes that fly
   to it from the bookshelves.

   As in the game: a book floats above every enchanting table, bobbing
   gently. With nobody within 3 blocks it is shut and turns slowly round;
   when you come near it turns to face you, opens, and its pages flip now
   and then. Now and again a rune lifts off each bookshelf that powers the
   table (js/enchanting.js countShelves) and drifts into the table.

   The book is a small model drawn with the mobs (two covers, the seam
   between them, two blocks of pages and two loose pages; our own art), so
   it takes the world's light like they do. Its parts, pivots, turns and
   texture places are the game's own BookModel, and it is set over the
   table and turned as the game's EnchantTableRenderer does it: open, its
   pages face you with the spine running away from you, tipped 10 degrees
   your way. Books are found by looking over the area round you one layer
   a tick, and are not saved: they come back with their tables.

   A lectern holding a book (meta bit 2, details.js) shows the same book
   lying open on its slope, its spine running up the lectern and the pages
   towards whoever reads it, as the game's LecternRenderer draws it; put
   on, it shows at once (wantBook), and it goes when the book is taken or
   the lectern broken.
--------------------------------------------------------------------------- */
import { Entity } from './entity.js?v=109';
import { register } from './mobs.js?v=109';
import { model } from './mobs2.js?v=109';
import { addArt } from './mobart.js?v=109';
import { B, BLOCKS } from '../blocks.js?v=109';

const THREE = window.THREE;
const R = () => Math.random();
const PI = Math.PI;

/* ---- the book's shape: the game's BookModel, part for part ----
   The covers (lids) turn about their own edges at the seam, the pages about a line a little out from it that moves out
   as they open (sin of the opening), the loose pages about the same line. The game's covers, seam and loose pages are
   0.005 of a pixel thick with their backs culled; our mobs are drawn from both sides, so faces that close together
   would fight for the depth buffer a few blocks off. So each cover and the seam is two one-faced sheets SEP apart, the
   outer one where the game's outside is (the outline is the game's) and the inner one moved in towards the pages, and
   the faces of the page blocks that are never seen (the backs against the covers, the ends against the seam) are clear
   in the texture and so never drawn. A loose page is one sheet, the same picture both sides. */
const SEP = 0.1;
// a one-faced sheet [x, y, z, w, h, u, v]: its face looks the model's -z way; mirrored, it reads right from the +z side
const sheet = (x, y, z, w, h, u, v, mirror) => [x, y, z, w, h, 0, u, v, 0, !!mirror, 0, true];
const ROT_Y = 4, SCALE = 6;
model('enchant_book', [
  { name: 'leftLid', pivot: [0, 24, -1], boxes: [sheet(-6, -5, -SEP, 6, 10, 0, 0), sheet(-6, -5, 0, 6, 10, 6, 0, true)] },
  { name: 'rightLid', pivot: [0, 24, 1], boxes: [sheet(0, -5, -SEP, 6, 10, 16, 0), sheet(0, -5, 0, 6, 10, 22, 0, true)] },
  { name: 'seam', pivot: [0, 24, 0], rot: [0, PI / 2, 0], boxes: [sheet(-1, -5, 0, 2, 10, 12, 0), sheet(-1, -5, SEP, 2, 10, 14, 0, true)] },
  { name: 'leftPages', pivot: [0, 24, 0], boxes: [[0, -4, -0.99, 5, 8, 1, 0, 10]] },
  { name: 'rightPages', pivot: [0, 24, 0], boxes: [[0, -4, -0.01, 5, 8, 1, 12, 10]] },
  { name: 'flip1', pivot: [0, 24, 0], boxes: [sheet(0, -4, 0, 5, 8, 24, 10)] },
  { name: 'flip2', pivot: [0, 24, 0], boxes: [sheet(0, -4, 0, 5, 8, 24, 10)] },
], (m, P, A) => {
  // how far open: the game's (sin(time * 0.02) * 0.1 + 1.25) * open, so an open book breathes a little
  const I = m.index, o = (Math.sin((A.bookTime || 0) * 0.02) * 0.1 + 1.25) * (A.open || 0), s = Math.sin(o);
  const f1 = A.flip1 || 0, f2 = A.flip2 || 0;
  P[I.leftLid * 7 + ROT_Y] = PI + o; P[I.rightLid * 7 + ROT_Y] = -o;
  P[I.leftPages * 7 + ROT_Y] = o; P[I.rightPages * 7 + ROT_Y] = -o;
  // the loose pages go over from the left pages (0) to the right (1)
  P[I.flip1 * 7 + ROT_Y] = o - o * 2 * f1; P[I.flip2 * 7 + ROT_Y] = o - o * 2 * f2;
  for (const i of [I.leftPages, I.rightPages, I.flip1, I.flip2]) P[i * 7] = s;
  // a loose page lying flat is inside its block of pages in the game (out of sight): here it is not drawn at all,
  // rather than lie a hair under the pages' face
  if (f1 <= 0 || f1 >= 1) P[I.flip1 * 7 + SCALE] = 0;
  if (f2 <= 0 || f2 >= 1) P[I.flip2 * 7 + SCALE] = 0;
});
/* The texture is laid out as the game's book texture is (64 x 32), the pixels our own. Top row: the left cover's inside
   (0) and outside (6), the seam's outside (12) and inside (14), the right cover's inside (16) and outside (22). Under
   them the two blocks of pages (0 and 12, a box of 5 x 8 x 1 each: their open faces at 7 and 13) and the loose page
   (24). On the outsides of the covers the spine is at columns 6 and 27; on the pages at 11 and 13, and at 24 on the
   loose page. The reader sees every piece turned half round: the far end of the book (the top of a page) is the last
   row of each piece, and a line starts at its right-hand end in the texture. (The "left" pages lie on the reader's
   right.) A pivot's 24 is our mobs' ground line, here the book's middle. */
addArt('enchant_book', [64, 32], p => {
  const leather = 0x6e3a1e, dark = 0x4e2614, inner = 0x7f4b2b, innerD = 0x5e341d, page = 0xeee6cf, gutter = 0xd8cfb6, edge = 0xd6ccae, ink = 0x8a7f6a, gold = 0xd8b04a;
  // the covers' outsides: leather, darker where it folds at the spine, gold on the outer corners and a small gold mark
  for (const [u, spine, fore] of [[6, 6, 11], [22, 27, 22]]) {
    p.fill(u, 0, 6, 10, leather, 0.07);
    p.fill(spine, 0, 1, 10, dark, 0.05);
    const step = fore > spine ? -1 : 1;
    for (const r of [0, 9]) { p.fill(fore, r, 1, 1, gold, 0.05); p.fill(fore + step, r, 1, 1, gold, 0.05); }
    p.fill(fore, 1, 1, 1, gold, 0.05); p.fill(fore, 8, 1, 1, gold, 0.05);
    const mid = Math.min(spine, fore) + 2;
    p.fill(mid, 4, 2, 2, gold, 0.06); p.fill(mid + (step > 0 ? 0 : 1), 3, 1, 1, gold, 0.05); p.fill(mid + (step > 0 ? 1 : 0), 6, 1, 1, gold, 0.05);
  }
  // the covers' insides (a frame round the pages when it is open), darker at the spine
  p.fill(0, 0, 6, 10, inner, 0.06); p.fill(5, 0, 1, 10, innerD, 0.05);
  p.fill(16, 0, 6, 10, inner, 0.06); p.fill(16, 0, 1, 10, innerD, 0.05);
  // the seam: dark leather with two raised gold bands outside, plain inside
  p.fill(12, 0, 2, 10, dark, 0.06); p.fill(12, 1, 2, 1, gold, 0.05); p.fill(12, 8, 2, 1, gold, 0.05);
  p.fill(14, 0, 2, 10, innerD, 0.05);
  // the blocks of pages: the edges cream, the backs and the spine ends clear (never drawn)
  p.box(0, 10, 5, 8, 1, { top: edge, bottom: edge, left: edge }, 0.04);
  p.box(12, 10, 5, 8, 1, { top: edge, bottom: edge, left: edge }, 0.04);
  p.clear(0, 11, 6, 8); p.clear(12, 11, 1, 8); p.clear(19, 11, 5, 8);
  // their open faces and the loose page: cream, a little shade in the gutter, three lines of writing under a margin,
  // the last one short (start: the column a line starts from, step: the way a line runs in the texture)
  const leaf = (u, v, spine, start, step) => {
    p.fill(u, v, 5, 8, page, 0.03);
    p.fill(spine, v, 1, 8, gutter, 0.03);
    for (const [r, n] of [[6, 3], [4, 3], [2, 2]]) for (let k = 0; k < n; k++) p.fill(start + k * step, v + r, 1, 1, ink, 0.08);
  };
  leaf(7, 11, 11, 10, -1); leaf(13, 11, 13, 16, -1); leaf(24, 10, 24, 27, -1);
});

/* ---- the book ---- */
const wrapPI = a => { while (a >= PI) a -= PI * 2; while (a < -PI) a += PI * 2; return a; };
// a loose page's way over, from its share of the flip (the game's frac(f) * 1.6 - 0.3, held to 0..1)
const flipOf = t => Math.max(0, Math.min(1, (t - Math.floor(t)) * 1.6 - 0.3));
/* The model's numbers are the game's, in the game's own frame for a block's renderer (y up, not turned over as a mob
   is); our mobs' frame is turned half round x from that (manager.js drawOne, render/entitymesh.js), so the root turns
   it back after the game's own turns. */
const UNTURN = new THREE.Matrix4().makeScale(1, -1, -1);
const TILT = 80 * PI / 180;
export class TableBook extends Entity {
  static W = 0.4; static H = 0.4; static STEP = 0; static NOT_PICKABLE = true; static NO_PUSH = true; static MODEL = 'enchant_book'; static TEX = 'enchant_book';
  constructor(m, type) {
    super(m, type);
    this.noPhysics = true; this.gravity = 0;
    // the game's EnchantingTableBlockEntity's numbers: rot is the way the book faces, as a turn from +x towards +z
    // (tRot the way it is turning to); the yaw it is drawn by is worked out from it each tick
    this.open = 0; this.prevOpen = 0; this.rot = 0; this.tRot = 0;
    this.flip = 0; this.prevFlip = 0; this.flipT = 0; this.flipA = 0;
    this.yaw = this.prevYaw = -PI;
    this.table = null;
  }
  tick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw; this.age++;
    this.prevOpen = this.open;
    // (as the game's nearest player within 3 blocks of the table's middle: a spectator does not count)
    const P = this.m.player, [x, y, z] = this.table;
    const dx = P.pos.x - (x + 0.5), dz = P.pos.z - (z + 0.5), near = P.alive() && this.m.mode !== 'spectator' && dx * dx + (P.pos.y - y - 0.5) ** 2 + dz * dz < 9;
    if (near) {
      // face whoever is near; open; now and then a page goes over
      this.tRot = Math.atan2(dz, dx);
      this.open += 0.1;
      if (this.open < 0.5 || R() < 1 / 40) { const was = this.flipT; do this.flipT += Math.floor(R() * 4) - Math.floor(R() * 4); while (this.flipT === was); }
    } else { this.tRot += 0.02; this.open -= 0.1; }
    this.rot = wrapPI(this.rot); this.tRot = wrapPI(this.tRot);
    this.rot += wrapPI(this.tRot - this.rot) * 0.4;
    this.open = Math.max(0, Math.min(1, this.open));
    this.prevFlip = this.flip;
    const v = Math.max(-0.2, Math.min(0.2, (this.flipT - this.flip) * 0.4));
    this.flipA += (v - this.flipA) * 0.9;
    this.flip += this.flipA;
    // (drawn turned by yaw + 180 degrees: manager.js drawOne)
    this.yaw = -this.rot - PI;
    // bobbing a little above the table
    this.pos.set(x + 0.5, y + 0.75 + 0.1 + Math.sin(this.age * 0.1) * 0.01, z + 0.5);
  }
  anim(A, a) {
    A.open = this.prevOpen + (this.open - this.prevOpen) * a;
    const f = this.prevFlip + (this.flip - this.prevFlip) * a;
    A.flip1 = flipOf(f + 0.25); A.flip2 = flipOf(f + 0.75);
    A.bookTime = this.age + a;
  }
  // the game's turn: about the vertical by its rot (above), then tipped 80 degrees over, so an open book lies back
  // towards whoever it faces with its spine pointing away from them
  rootPose(root, t) { root.multiply(t.makeRotationZ(TILT)); root.multiply(UNTURN); }
  remove() { super.remove(); if (this.table && this.m.books) this.m.books.delete(this.table.join()); }
}
TableBook.prototype.toJSON = undefined;
register('table_book', TableBook);

/* ---- the book on a lectern: open and still on the slope, its spine running up the slope and the pages either
   side of it, facing whoever reads it (the lectern's front, which is the low edge). The game's LecternRenderer:
   1.0625 up, turned by the facing's clockwise neighbour, tipped 67.5 degrees, 0.125 down that way, opened 1.2 with
   the loose pages at 0.1 and 0.9 and its clock at 0. ---- */
// our facings 0 north, 1 east, 2 south, 3 west: the game's yRot of the next one clockwise (east 270, south 0, west 90, north 180)
const LECTERN_ROT = [270, 0, 90, 180].map(d => d * PI / 180);
const LEAN = 67.5 * PI / 180;
export class LecternBook extends TableBook {
  tick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw; this.age++;
    const [x, y, z] = this.table, f = this.m.t.meta(x, y, z) & 3;
    this.open = this.prevOpen = 1.2; this.flip = this.prevFlip = 0.1;
    this.yaw = this.prevYaw = -LECTERN_ROT[f] - PI;
    this.pos.set(x + 0.5, y + 1.0625, z + 0.5);
    if (this.age === 1) this.prev.copy(this.pos);
  }
  // (the two loose pages each lifted a little off their side)
  anim(A) { A.open = 1.2; A.flip1 = 0.1; A.flip2 = 0.9; A.bookTime = 0; }
  rootPose(root, t) { root.multiply(t.makeRotationZ(LEAN)); root.multiply(t.makeTranslation(0, -0.125, 0)); root.multiply(UNTURN); }
}
LecternBook.prototype.toJSON = undefined;
register('lectern_book', LecternBook);
// a book was just put on a lectern: shown at the next tick rather than when the search comes by
const WANT = [];
export function wantBook(x, y, z) { WANT.push([x, y, z]); }

/* ---- finding the tables, and the runes ---- */
const OFFSETS = [];
for (let oy = 0; oy <= 1; oy++) for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) if (Math.abs(ox) === 2 || Math.abs(oz) === 2) OFFSETS.push([ox, oy, oz]);
const passes = b => { const d = BLOCKS[b]; return !d || d.replaceable || d.fluid; };
const LECTERN = B.lectern;
const lecternWithBook = (T, x, y, z) => T.get(x, y, z) === LECTERN && (T.meta(x, y, z) & 4) !== 0;
export function tableBooks(m) {
  if (B.enchanting_table === undefined) return;
  const books = m.books || (m.books = new Map());
  const T = m.t, P = m.P, px = Math.floor(P.pos.x), py = Math.floor(P.pos.y), pz = Math.floor(P.pos.z);
  const add = (kind, x, y, z) => {
    const k = x + ',' + y + ',' + z;
    if (books.has(k)) return;
    const e = m.spawn(kind, x + 0.5, y + (kind === 'table_book' ? 0.85 : 1), z + 0.5, { natural: false });
    if (e) { e.table = [x, y, z]; books.set(k, e); }
  };
  while (WANT.length) { const [x, y, z] = WANT.pop(); if (lecternWithBook(T, x, y, z)) add('lectern_book', x, y, z); }
  // one layer of the 33 x 17 x 33 blocks round you a tick
  const ly = py - 8 + (m.age % 17);
  for (let z = pz - 16; z <= pz + 16; z++) for (let x = px - 16; x <= px + 16; x++) {
    const b = T.get(x, ly, z);
    if (b === B.enchanting_table) add('table_book', x, ly, z);
    else if (b === LECTERN && LECTERN !== undefined && (T.meta(x, ly, z) & 4)) add('lectern_book', x, ly, z);
  }
  for (const [k, e] of books) {
    const [x, y, z] = e.table;
    if (e.removed) { books.delete(k); continue; }
    const there = e instanceof LecternBook ? lecternWithBook(T, x, y, z) : T.get(x, y, z) === B.enchanting_table;
    if (!there || (x - P.pos.x) ** 2 + (z - P.pos.z) ** 2 > 48 * 48) { e.remove(); continue; }
    if (e instanceof LecternBook) continue;
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
