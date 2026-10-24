/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the stronghold.

   Strongholds are not made from saved templates: the game lays them out in
   code (StrongholdPieces), room by room, with the structure's own random.
   This follows those rules: a spiral staircase down from the start, then
   corridors, turns, crossings, prison cells, libraries, fountain rooms and
   stairs, each picked by weight with a cap on how many, each joined to a
   free door of a piece already placed, until the portal room has been
   placed (the whole layout is thrown away and made again if it never is).
   With the same random calls in the same order, the rooms land where the
   game puts them.

   Blocks: stone bricks with cracked, mossy and infested ones mixed in, iron
   bars and doors, the library's shelves and chandeliers, the fountain, and
   the portal room: 12 end portal frames, each with a 1 in 10 chance of an
   eye already in it, the lava pool, and the silverfish spawner on the steps.
--------------------------------------------------------------------------- */
import { Box, Piece, Pieces, NORTH, EAST, SOUTH, WEST, HORIZONTAL } from './piece.js?v=107';
import { largeFeature, JRand } from './rand.js?v=107';

const OPENING = 0, WOOD_DOOR = 1, GRATES = 2, IRON_DOOR = 3;
export const DOOR_NAMES = ['OPENING', 'WOOD_DOOR', 'GRATES', 'IRON_DOOR'];

// the smooth stone selector: walls of mixed bricks, air inside
function bricks(r, wall) {
  if (!wall) return 'cave_air';
  const f = r.nextFloat();
  return f < 0.2 ? 'cracked_stone_bricks' : f < 0.5 ? 'mossy_stone_bricks' : f < 0.55 ? 'infested_stone_bricks' : 'stone_bricks';
}

/* ---- the weights: [kind, weight, how many at most (0 = any)] ---- */
const WEIGHTS = [
  ['Straight', 40, 0], ['PrisonHall', 5, 5], ['LeftTurn', 20, 0], ['RightTurn', 20, 0], ['RoomCrossing', 10, 6],
  ['StraightStairsDown', 5, 5], ['StairsDown', 5, 5], ['FiveCrossing', 5, 4], ['ChestCorridor', 5, 4],
  ['Library', 10, 2], ['PortalRoom', 20, 1],
];

/* The layout state, per attempt (the game keeps it in statics). */
class Layout {
  constructor() {
    this.weights = WEIGHTS.map(([kind, weight, max]) => ({ kind, weight, max, count: 0 }));
    this.imposed = null;
    this.total = 0;
  }
  doPlace(w, depth) {
    const ok = w.max === 0 || w.count < w.max;
    if (w.kind === 'Library') return ok && depth > 4;
    if (w.kind === 'PortalRoom') return ok && depth > 5;
    return ok;
  }
  update() {
    let any = false;
    this.total = 0;
    for (const w of this.weights) {
      if (w.max > 0 && w.count < w.max) any = true;
      this.total += w.weight;
    }
    return any;
  }
}

const okBox = b => b && b.y0 > 10;

class SH extends Piece {
  constructor(type, depth, box) { super(type, depth, box); this.entryDoor = OPENING; }
  randomDoor(r) {
    switch (r.nextInt(5)) { case 2: return WOOD_DOOR; case 3: return GRATES; case 4: return IRON_DOOR; default: return OPENING; }
  }
  door(w, cb, r, type, x, y, z) {
    switch (type) {
      case OPENING: this.air(w, cb, x, y, z, x + 2, y + 2, z); break;
      case WOOD_DOOR:
        for (const [a, b] of [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]]) this.put(w, 'stone_bricks', x + a, y + b, z, cb);
        this.put(w, 'oak_door', x + 1, y, z, cb, { f: NORTH });
        this.put(w, 'oak_door', x + 1, y + 1, z, cb, { f: NORTH, upper: true });
        break;
      case GRATES:
        this.put(w, 'cave_air', x + 1, y, z, cb); this.put(w, 'cave_air', x + 1, y + 1, z, cb);
        for (const [a, b] of [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]]) this.put(w, 'iron_bars', x + a, y + b, z, cb);
        break;
      case IRON_DOOR:
        for (const [a, b] of [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0]]) this.put(w, 'stone_bricks', x + a, y + b, z, cb);
        this.put(w, 'iron_door', x + 1, y, z, cb, { f: NORTH });
        this.put(w, 'iron_door', x + 1, y + 1, z, cb, { f: NORTH, upper: true });
        this.put(w, 'stone_button', x + 2, y + 1, z + 1, cb, { f: NORTH });
        this.put(w, 'stone_button', x + 2, y + 1, z - 1, cb, { f: SOUTH });
        break;
    }
  }
  forward(L, start, acc, r, ox, oy) {
    const b = this.box;
    switch (this.dir) {
      case NORTH: return addPiece(L, start, acc, r, b.x0 + ox, b.y0 + oy, b.z0 - 1, this.dir, this.depth);
      case SOUTH: return addPiece(L, start, acc, r, b.x0 + ox, b.y0 + oy, b.z1 + 1, this.dir, this.depth);
      case WEST: return addPiece(L, start, acc, r, b.x0 - 1, b.y0 + oy, b.z0 + ox, this.dir, this.depth);
      case EAST: return addPiece(L, start, acc, r, b.x1 + 1, b.y0 + oy, b.z0 + ox, this.dir, this.depth);
    }
    return null;
  }
  left(L, start, acc, r, oy, oxz) {
    const b = this.box;
    switch (this.dir) {
      case NORTH: case SOUTH: return addPiece(L, start, acc, r, b.x0 - 1, b.y0 + oy, b.z0 + oxz, WEST, this.depth);
      case WEST: case EAST: return addPiece(L, start, acc, r, b.x0 + oxz, b.y0 + oy, b.z0 - 1, NORTH, this.depth);
    }
    return null;
  }
  right(L, start, acc, r, oy, oxz) {
    const b = this.box;
    switch (this.dir) {
      case NORTH: case SOUTH: return addPiece(L, start, acc, r, b.x1 + 1, b.y0 + oy, b.z0 + oxz, EAST, this.depth);
      case WEST: case EAST: return addPiece(L, start, acc, r, b.x0 + oxz, b.y0 + oy, b.z1 + 1, SOUTH, this.depth);
    }
    return null;
  }
  addChildren() {}
}

/* ------------------------------------------------------------ pieces -- */
class Straight extends SH {
  constructor(depth, r, box, dir) {
    super('shs', depth, box); this.setOrientation(dir);
    this.entryDoor = this.randomDoor(r);
    this.leftChild = r.nextInt(2) === 0;
    this.rightChild = r.nextInt(2) === 0;
  }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -1, -1, 0, 5, 5, 7, dir);
    return okBox(b) && !acc.collides(b) ? new Straight(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) {
    this.forward(L, start, acc, r, 1, 1);
    if (this.leftChild) this.left(L, start, acc, r, 1, 2);
    if (this.rightChild) this.right(L, start, acc, r, 1, 2);
  }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 4, 4, 6, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 1, 1, 0);
    this.door(w, cb, r, OPENING, 1, 1, 6);
    this.maybe(w, cb, r, 0.1, 1, 2, 1, 'wall_torch', { f: EAST });
    this.maybe(w, cb, r, 0.1, 3, 2, 1, 'wall_torch', { f: WEST });
    this.maybe(w, cb, r, 0.1, 1, 2, 5, 'wall_torch', { f: EAST });
    this.maybe(w, cb, r, 0.1, 3, 2, 5, 'wall_torch', { f: WEST });
    if (this.leftChild) this.air(w, cb, 0, 1, 2, 0, 3, 4);
    if (this.rightChild) this.air(w, cb, 4, 1, 2, 4, 3, 4);
  }
}

class ChestCorridor extends SH {
  constructor(depth, r, box, dir) { super('shcc', depth, box); this.setOrientation(dir); this.entryDoor = this.randomDoor(r); }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -1, -1, 0, 5, 5, 7, dir);
    return okBox(b) && !acc.collides(b) ? new ChestCorridor(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) { this.forward(L, start, acc, r, 1, 1); }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 4, 4, 6, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 1, 1, 0);
    this.door(w, cb, r, OPENING, 1, 1, 6);
    this.box1(w, cb, 3, 1, 2, 3, 1, 4, 'stone_bricks');
    this.put(w, 'stone_brick_slab', 3, 1, 1, cb); this.put(w, 'stone_brick_slab', 3, 1, 5, cb);
    this.put(w, 'stone_brick_slab', 3, 2, 2, cb); this.put(w, 'stone_brick_slab', 3, 2, 4, cb);
    for (let i = 2; i <= 4; i++) this.put(w, 'stone_brick_slab', 2, 1, i, cb);
    this.chest(w, cb, r, 3, 2, 3, 'stronghold_corridor');
  }
}

class PrisonHall extends SH {
  constructor(depth, r, box, dir) { super('shph', depth, box); this.setOrientation(dir); this.entryDoor = this.randomDoor(r); }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -1, -1, 0, 9, 5, 11, dir);
    return okBox(b) && !acc.collides(b) ? new PrisonHall(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) { this.forward(L, start, acc, r, 1, 1); }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 8, 4, 10, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 1, 1, 0);
    this.air(w, cb, 1, 1, 10, 3, 3, 10);
    this.fillSel(w, cb, 4, 1, 1, 4, 3, 1, false, r, bricks);
    this.fillSel(w, cb, 4, 1, 3, 4, 3, 3, false, r, bricks);
    this.fillSel(w, cb, 4, 1, 7, 4, 3, 7, false, r, bricks);
    this.fillSel(w, cb, 4, 1, 9, 4, 3, 9, false, r, bricks);
    for (let i = 1; i <= 3; i++) {
      this.put(w, 'iron_bars', 4, i, 4, cb); this.put(w, 'iron_bars', 4, i, 5, cb); this.put(w, 'iron_bars', 4, i, 6, cb);
      this.put(w, 'iron_bars', 5, i, 5, cb); this.put(w, 'iron_bars', 6, i, 5, cb); this.put(w, 'iron_bars', 7, i, 5, cb);
    }
    this.put(w, 'iron_bars', 4, 3, 2, cb); this.put(w, 'iron_bars', 4, 3, 8, cb);
    this.put(w, 'iron_door', 4, 1, 2, cb, { f: WEST }); this.put(w, 'iron_door', 4, 2, 2, cb, { f: WEST, upper: true });
    this.put(w, 'iron_door', 4, 1, 8, cb, { f: WEST }); this.put(w, 'iron_door', 4, 2, 8, cb, { f: WEST, upper: true });
  }
}

class Turn extends SH {
  constructor(type, depth, r, box, dir) { super(type, depth, box); this.setOrientation(dir); this.entryDoor = this.randomDoor(r); }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 4, 4, 4, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 1, 1, 0);
    const ne = this.dir === NORTH || this.dir === EAST;
    const leftSide = this.type === 'shlt' ? ne : !ne;
    if (leftSide) this.air(w, cb, 0, 1, 1, 0, 3, 3); else this.air(w, cb, 4, 1, 1, 4, 3, 3);
  }
}
class LeftTurn extends Turn {
  constructor(depth, r, box, dir) { super('shlt', depth, r, box, dir); }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -1, -1, 0, 5, 5, 5, dir);
    return okBox(b) && !acc.collides(b) ? new LeftTurn(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) {
    if (this.dir === NORTH || this.dir === EAST) this.left(L, start, acc, r, 1, 1); else this.right(L, start, acc, r, 1, 1);
  }
}
class RightTurn extends Turn {
  constructor(depth, r, box, dir) { super('shrt', depth, r, box, dir); }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -1, -1, 0, 5, 5, 5, dir);
    return okBox(b) && !acc.collides(b) ? new RightTurn(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) {
    if (this.dir === NORTH || this.dir === EAST) this.right(L, start, acc, r, 1, 1); else this.left(L, start, acc, r, 1, 1);
  }
}

class RoomCrossing extends SH {
  constructor(depth, r, box, dir) {
    super('shrc', depth, box); this.setOrientation(dir);
    this.entryDoor = this.randomDoor(r);
    this.kind = r.nextInt(5);
  }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -4, -1, 0, 11, 7, 11, dir);
    return okBox(b) && !acc.collides(b) ? new RoomCrossing(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) {
    this.forward(L, start, acc, r, 4, 1);
    this.left(L, start, acc, r, 1, 4);
    this.right(L, start, acc, r, 1, 4);
  }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 10, 6, 10, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 4, 1, 0);
    this.air(w, cb, 4, 1, 10, 6, 3, 10);
    this.air(w, cb, 0, 1, 4, 0, 3, 6);
    this.air(w, cb, 10, 1, 4, 10, 3, 6);
    switch (this.kind) {
      case 0:   // a pillar with torches round it
        this.put(w, 'stone_bricks', 5, 1, 5, cb); this.put(w, 'stone_bricks', 5, 2, 5, cb); this.put(w, 'stone_bricks', 5, 3, 5, cb);
        this.put(w, 'wall_torch', 4, 3, 5, cb, { f: WEST }); this.put(w, 'wall_torch', 6, 3, 5, cb, { f: EAST });
        this.put(w, 'wall_torch', 5, 3, 4, cb, { f: SOUTH }); this.put(w, 'wall_torch', 5, 3, 6, cb, { f: NORTH });
        for (const [x, z] of [[4, 4], [4, 5], [4, 6], [6, 4], [6, 5], [6, 6], [5, 4], [5, 6]]) this.put(w, 'smooth_stone_slab', x, 1, z, cb);
        break;
      case 1:   // the fountain
        for (let i = 0; i < 5; i++) {
          this.put(w, 'stone_bricks', 3, 1, 3 + i, cb); this.put(w, 'stone_bricks', 7, 1, 3 + i, cb);
          this.put(w, 'stone_bricks', 3 + i, 1, 3, cb); this.put(w, 'stone_bricks', 3 + i, 1, 7, cb);
        }
        this.put(w, 'stone_bricks', 5, 1, 5, cb); this.put(w, 'stone_bricks', 5, 2, 5, cb); this.put(w, 'stone_bricks', 5, 3, 5, cb);
        this.put(w, 'water', 5, 4, 5, cb);
        break;
      case 2:   // two floors, with a chest up the ladder
        for (let i = 1; i <= 9; i++) { this.put(w, 'cobblestone', 1, 3, i, cb); this.put(w, 'cobblestone', 9, 3, i, cb); }
        for (let i = 1; i <= 9; i++) { this.put(w, 'cobblestone', i, 3, 1, cb); this.put(w, 'cobblestone', i, 3, 9, cb); }
        for (const [x, y, z] of [[5, 1, 4], [5, 1, 6], [5, 3, 4], [5, 3, 6], [4, 1, 5], [6, 1, 5], [4, 3, 5], [6, 3, 5]]) this.put(w, 'cobblestone', x, y, z, cb);
        for (let i = 1; i <= 3; i++) {
          this.put(w, 'cobblestone', 4, i, 4, cb); this.put(w, 'cobblestone', 6, i, 4, cb);
          this.put(w, 'cobblestone', 4, i, 6, cb); this.put(w, 'cobblestone', 6, i, 6, cb);
        }
        this.put(w, 'torch', 5, 3, 5, cb);
        for (let i = 2; i <= 8; i++) {
          this.put(w, 'oak_planks', 2, 3, i, cb); this.put(w, 'oak_planks', 3, 3, i, cb);
          if (i <= 3 || i >= 7) { this.put(w, 'oak_planks', 4, 3, i, cb); this.put(w, 'oak_planks', 5, 3, i, cb); this.put(w, 'oak_planks', 6, 3, i, cb); }
          this.put(w, 'oak_planks', 7, 3, i, cb); this.put(w, 'oak_planks', 8, 3, i, cb);
        }
        for (let y = 1; y <= 3; y++) this.put(w, 'ladder', 9, y, 3, cb, { f: WEST });
        this.chest(w, cb, r, 3, 4, 8, 'stronghold_crossing');
        break;
    }
  }
}

class StraightStairsDown extends SH {
  constructor(depth, r, box, dir) { super('shssd', depth, box); this.setOrientation(dir); this.entryDoor = this.randomDoor(r); }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -1, -7, 0, 5, 11, 8, dir);
    return okBox(b) && !acc.collides(b) ? new StraightStairsDown(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) { this.forward(L, start, acc, r, 1, 1); }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 4, 10, 7, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 1, 7, 0);
    this.door(w, cb, r, OPENING, 1, 1, 7);
    for (let i = 0; i < 6; i++) {
      for (let x = 1; x <= 3; x++) this.put(w, 'cobblestone_stairs', x, 6 - i, 1 + i, cb, { f: SOUTH });
      if (i < 5) for (let x = 1; x <= 3; x++) this.put(w, 'stone_bricks', x, 5 - i, 1 + i, cb);
    }
  }
}

class StairsDown extends SH {
  constructor(depth, r, box, dir, type) {
    super(type || 'shsd', depth, box); this.setOrientation(dir);
    this.isSource = false;
    if (r) this.entryDoor = this.randomDoor(r);
  }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -1, -7, 0, 5, 11, 5, dir);
    return okBox(b) && !acc.collides(b) ? new StairsDown(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) {
    if (this.isSource) L.imposed = 'FiveCrossing';
    this.forward(L, start, acc, r, 1, 1);
  }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 4, 10, 4, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 1, 7, 0);
    this.door(w, cb, r, OPENING, 1, 1, 4);
    // a spiral round the middle column, a step down each quarter
    const S = [[2, 6, 1], [1, 5, 1], [1, 6, 1, 1], [1, 5, 2], [1, 4, 3], [1, 5, 3, 1], [2, 4, 3], [3, 3, 3], [3, 4, 3, 1],
      [3, 3, 2], [3, 2, 1], [3, 3, 1, 1], [2, 2, 1], [1, 1, 1], [1, 2, 1, 1], [1, 1, 2], [1, 1, 3, 1]];
    for (const [x, y, z, slab] of S) this.put(w, slab ? 'smooth_stone_slab' : 'stone_bricks', x, y, z, cb);
    for (let y = 1; y <= 6; y++) this.put(w, 'stone_bricks', 2, y, 2, cb);
  }
}

class FiveCrossing extends SH {
  constructor(depth, r, box, dir) {
    super('sh5c', depth, box); this.setOrientation(dir);
    this.entryDoor = this.randomDoor(r);
    this.leftLow = r.nextBoolean(); this.leftHigh = r.nextBoolean(); this.rightLow = r.nextBoolean(); this.rightHigh = r.nextInt(3) > 0;
  }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -4, -3, 0, 10, 9, 11, dir);
    return okBox(b) && !acc.collides(b) ? new FiveCrossing(depth, r, b, dir) : null;
  }
  addChildren(L, start, acc, r) {
    let i = 3, j = 5;
    if (this.dir === WEST || this.dir === NORTH) { i = 8 - i; j = 8 - j; }
    this.forward(L, start, acc, r, 5, 1);
    if (this.leftLow) this.left(L, start, acc, r, i, 1);
    if (this.leftHigh) this.left(L, start, acc, r, j, 7);
    if (this.rightLow) this.right(L, start, acc, r, i, 1);
    if (this.rightHigh) this.right(L, start, acc, r, j, 7);
  }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 9, 8, 10, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 4, 3, 0);
    if (this.leftLow) this.air(w, cb, 0, 3, 1, 0, 5, 3);
    if (this.rightLow) this.air(w, cb, 9, 3, 1, 9, 5, 3);
    if (this.leftHigh) this.air(w, cb, 0, 5, 7, 0, 7, 9);
    if (this.rightHigh) this.air(w, cb, 9, 5, 7, 9, 7, 9);
    this.air(w, cb, 5, 1, 10, 7, 3, 10);
    this.fillSel(w, cb, 1, 2, 1, 8, 2, 6, false, r, bricks);
    this.fillSel(w, cb, 4, 1, 5, 4, 4, 9, false, r, bricks);
    this.fillSel(w, cb, 8, 1, 5, 8, 4, 9, false, r, bricks);
    this.fillSel(w, cb, 1, 4, 7, 3, 4, 9, false, r, bricks);
    this.fillSel(w, cb, 1, 3, 5, 3, 3, 6, false, r, bricks);
    this.box1(w, cb, 1, 3, 4, 3, 3, 4, 'smooth_stone_slab');
    this.box1(w, cb, 1, 4, 6, 3, 4, 6, 'smooth_stone_slab');
    this.fillSel(w, cb, 5, 1, 7, 7, 1, 8, false, r, bricks);
    this.box1(w, cb, 5, 1, 9, 7, 1, 9, 'smooth_stone_slab');
    this.box1(w, cb, 5, 2, 7, 7, 2, 7, 'smooth_stone_slab');
    this.box1(w, cb, 4, 5, 7, 4, 5, 9, 'smooth_stone_slab');
    this.box1(w, cb, 8, 5, 7, 8, 5, 9, 'smooth_stone_slab');
    this.box1(w, cb, 5, 5, 7, 7, 5, 9, 'smooth_stone_slab', { slab: 2 });
    this.put(w, 'wall_torch', 6, 5, 6, cb, { f: SOUTH });
  }
}

class Library extends SH {
  constructor(depth, r, box, dir) {
    super('shli', depth, box); this.setOrientation(dir);
    this.entryDoor = this.randomDoor(r);
    this.tall = box.ys > 6;
  }
  static create(acc, r, x, y, z, dir, depth) {
    let b = Box.orient(x, y, z, -4, -1, 0, 14, 11, 15, dir);
    if (!okBox(b) || acc.collides(b)) {
      b = Box.orient(x, y, z, -4, -1, 0, 14, 6, 15, dir);
      if (!okBox(b) || acc.collides(b)) return null;
    }
    return new Library(depth, r, b, dir);
  }
  place(w, cb, r) {
    const h = this.tall ? 11 : 6;
    this.fillSel(w, cb, 0, 0, 0, 13, h - 1, 14, true, r, bricks);
    this.door(w, cb, r, this.entryDoor, 4, 1, 0);
    this.maybeFill(w, cb, r, 0.07, 2, 1, 1, 11, 4, 13, 'cobweb', 'cobweb', false, false);
    for (let l = 1; l <= 13; l++) {
      if ((l - 1) % 4 === 0) {
        this.box1(w, cb, 1, 1, l, 1, 4, l, 'oak_planks'); this.box1(w, cb, 12, 1, l, 12, 4, l, 'oak_planks');
        this.put(w, 'wall_torch', 2, 3, l, cb, { f: EAST }); this.put(w, 'wall_torch', 11, 3, l, cb, { f: WEST });
        if (this.tall) { this.box1(w, cb, 1, 6, l, 1, 9, l, 'oak_planks'); this.box1(w, cb, 12, 6, l, 12, 9, l, 'oak_planks'); }
        continue;
      }
      this.box1(w, cb, 1, 1, l, 1, 4, l, 'bookshelf'); this.box1(w, cb, 12, 1, l, 12, 4, l, 'bookshelf');
      if (this.tall) { this.box1(w, cb, 1, 6, l, 1, 9, l, 'bookshelf'); this.box1(w, cb, 12, 6, l, 12, 9, l, 'bookshelf'); }
    }
    for (let l = 3; l < 12; l += 2) {
      this.box1(w, cb, 3, 1, l, 4, 3, l, 'bookshelf'); this.box1(w, cb, 6, 1, l, 7, 3, l, 'bookshelf'); this.box1(w, cb, 9, 1, l, 10, 3, l, 'bookshelf');
    }
    if (this.tall) {
      this.box1(w, cb, 1, 5, 1, 3, 5, 13, 'oak_planks'); this.box1(w, cb, 10, 5, 1, 12, 5, 13, 'oak_planks');
      this.box1(w, cb, 4, 5, 1, 9, 5, 2, 'oak_planks'); this.box1(w, cb, 4, 5, 12, 9, 5, 13, 'oak_planks');
      this.put(w, 'oak_planks', 9, 5, 11, cb); this.put(w, 'oak_planks', 8, 5, 11, cb); this.put(w, 'oak_planks', 9, 5, 10, cb);
      this.box1(w, cb, 3, 6, 3, 3, 6, 11, 'oak_fence'); this.box1(w, cb, 10, 6, 3, 10, 6, 9, 'oak_fence');
      this.box1(w, cb, 4, 6, 2, 9, 6, 2, 'oak_fence'); this.box1(w, cb, 4, 6, 12, 7, 6, 12, 'oak_fence');
      this.put(w, 'oak_fence', 3, 6, 2, cb); this.put(w, 'oak_fence', 3, 6, 12, cb); this.put(w, 'oak_fence', 10, 6, 2, cb);
      for (let l = 0; l <= 2; l++) {
        this.put(w, 'oak_fence', 8 + l, 6, 12 - l, cb);
        if (l !== 2) this.put(w, 'oak_fence', 8 + l, 5, 10 - l, cb);
      }
      for (let y = 1; y <= 7; y++) this.put(w, 'ladder', 10, y, 13, cb, { f: SOUTH });
      // the chandelier
      for (const [x, y, z] of [[6, 9, 7], [7, 9, 7], [6, 8, 7], [7, 8, 7], [6, 7, 7], [7, 7, 7], [5, 7, 7], [8, 7, 7], [6, 7, 6], [6, 7, 8], [7, 7, 6], [7, 7, 8]])
        this.put(w, 'oak_fence', x, y, z, cb);
      for (const [x, y, z] of [[5, 8, 7], [8, 8, 7], [6, 8, 6], [6, 8, 8], [7, 8, 6], [7, 8, 8]]) this.put(w, 'torch', x, y, z, cb);
    }
    this.chest(w, cb, r, 3, 3, 5, 'stronghold_library');
    if (this.tall) {
      this.put(w, 'cave_air', 12, 9, 1, cb);
      this.chest(w, cb, r, 12, 8, 1, 'stronghold_library');
    }
  }
}

class PortalRoom extends SH {
  constructor(depth, box, dir) { super('shpr', depth, box); this.setOrientation(dir); }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -4, -1, 0, 11, 8, 16, dir);
    return okBox(b) && !acc.collides(b) ? new PortalRoom(depth, b, dir) : null;
  }
  addChildren(L, start) { if (start) start.portalRoom = this; }
  place(w, cb, r) {
    this.fillSel(w, cb, 0, 0, 0, 10, 7, 15, false, r, bricks);
    this.door(w, cb, r, GRATES, 4, 1, 0);
    const i = 6;
    this.fillSel(w, cb, 1, i, 1, 1, i, 14, false, r, bricks);
    this.fillSel(w, cb, 9, i, 1, 9, i, 14, false, r, bricks);
    this.fillSel(w, cb, 2, i, 1, 8, i, 2, false, r, bricks);
    this.fillSel(w, cb, 2, i, 14, 8, i, 14, false, r, bricks);
    this.fillSel(w, cb, 1, 1, 1, 2, 1, 4, false, r, bricks);
    this.fillSel(w, cb, 8, 1, 1, 9, 1, 4, false, r, bricks);
    this.box1(w, cb, 1, 1, 1, 1, 1, 3, 'lava');
    this.box1(w, cb, 9, 1, 1, 9, 1, 3, 'lava');
    this.fillSel(w, cb, 3, 1, 8, 7, 1, 12, false, r, bricks);
    this.box1(w, cb, 4, 1, 9, 6, 1, 11, 'lava');
    for (let j = 3; j < 14; j += 2) { this.box1(w, cb, 0, 3, j, 0, 4, j, 'iron_bars'); this.box1(w, cb, 10, 3, j, 10, 4, j, 'iron_bars'); }
    for (let j = 2; j < 9; j += 2) this.box1(w, cb, j, 3, 15, j, 4, 15, 'iron_bars');
    this.fillSel(w, cb, 4, 1, 5, 6, 1, 7, false, r, bricks);
    this.fillSel(w, cb, 4, 2, 6, 6, 2, 7, false, r, bricks);
    this.fillSel(w, cb, 4, 3, 7, 6, 3, 7, false, r, bricks);
    for (let k = 4; k <= 6; k++) {
      this.put(w, 'stone_brick_stairs', k, 1, 4, cb, { f: NORTH });
      this.put(w, 'stone_brick_stairs', k, 2, 5, cb, { f: NORTH });
      this.put(w, 'stone_brick_stairs', k, 3, 6, cb, { f: NORTH });
    }
    // the frames: each eye is its own 1 in 10, from the room's own seed so
    // every chunk the room crosses agrees on them
    const er = new JRand(this.eyeSeed);
    let all = true;
    const eyes = [];
    for (let l = 0; l < 12; l++) { eyes[l] = er.nextFloat() > 0.9; all = all && eyes[l]; }
    const F = [[NORTH, 4, 8], [NORTH, 5, 8], [NORTH, 6, 8], [SOUTH, 4, 12], [SOUTH, 5, 12], [SOUTH, 6, 12],
      [EAST, 3, 9], [EAST, 3, 10], [EAST, 3, 11], [WEST, 7, 9], [WEST, 7, 10], [WEST, 7, 11]];
    F.forEach(([f, x, z], l) => this.put(w, 'end_portal_frame', x, 3, z, cb, { f, eye: eyes[l] }));
    if (all) for (let x = 4; x <= 6; x++) for (let z = 9; z <= 11; z++) this.put(w, 'end_portal', x, 3, z, cb);
    this.spawner(w, cb, 5, 3, 6, 'silverfish');
  }
}

class FillerCorridor extends SH {
  constructor(depth, box, dir) {
    super('shfc', depth, box); this.setOrientation(dir);
    this.steps = dir === NORTH || dir === SOUTH ? box.zs : box.xs;
  }
  static findBox(acc, r, x, y, z, dir) {
    let b = Box.orient(x, y, z, -1, -1, 0, 5, 5, 4, dir);
    const p = acc.collides(b);
    if (!p) return null;
    if (p.box.y0 === b.y0) {
      for (let i = 2; i >= 0; i--) {
        b = Box.orient(x, y, z, -1, -1, 0, 5, 5, i, dir);
        if (p.box.intersects(b)) continue;
        return Box.orient(x, y, z, -1, -1, 0, 5, 5, i + 1, dir);
      }
    }
    return null;
  }
  place(w, cb, r) {
    for (let i = 0; i < this.steps; i++) {
      for (let x = 0; x <= 4; x++) this.put(w, 'stone_bricks', x, 0, i, cb);
      for (let j = 1; j <= 3; j++) {
        this.put(w, 'stone_bricks', 0, j, i, cb);
        for (let x = 1; x <= 3; x++) this.put(w, 'cave_air', x, j, i, cb);
        this.put(w, 'stone_bricks', 4, j, i, cb);
      }
      for (let x = 0; x <= 4; x++) this.put(w, 'stone_bricks', x, 4, i, cb);
    }
  }
}

class StartPiece extends StairsDown {
  constructor(r, x, z) {
    const dir = HORIZONTAL[r.nextInt(4)];
    super(0, null, Box.make(x, 64, z, dir, 5, 11, 5), dir, 'shstart');
    this.isSource = true;
    this.entryDoor = OPENING;
    this.previous = null;
    this.portalRoom = null;
    this.pending = [];
  }
}

const KINDS = { Straight, PrisonHall, LeftTurn, RightTurn, RoomCrossing, StraightStairsDown, StairsDown, FiveCrossing, ChestCorridor, Library, PortalRoom };

function fromSmallDoor(L, start, acc, r, x, y, z, dir, depth) {
  if (!L.update()) return null;
  if (L.imposed) {
    const p = KINDS[L.imposed].create(acc, r, x, y, z, dir, depth);
    L.imposed = null;
    if (p) return p;
  }
  let tries = 0;
  outer: while (tries < 5) {
    tries++;
    let n = r.nextInt(L.total);
    for (const w of L.weights) {
      if ((n -= w.weight) >= 0) continue;
      if (!L.doPlace(w, depth) || w === start.previous) continue outer;
      const p = KINDS[w.kind].create(acc, r, x, y, z, dir, depth);
      if (!p) continue;
      w.count++;
      start.previous = w;
      if (!(w.max === 0 || w.count < w.max)) L.weights.splice(L.weights.indexOf(w), 1);
      return p;
    }
  }
  const b = FillerCorridor.findBox(acc, r, x, y, z, dir);
  if (b && b.y0 > 1) return new FillerCorridor(depth, b, dir);
  return null;
}
function addPiece(L, start, acc, r, x, y, z, dir, depth) {
  if (depth > 50) return null;
  if (Math.abs(x - start.box.x0) > 112 || Math.abs(z - start.box.z0) > 112) return null;
  const p = fromSmallDoor(L, start, acc, r, x, y, z, dir, depth + 1);
  if (p) { acc.add(p); start.pending.push(p); }
  return p;
}

/* The whole layout for a stronghold starting in chunk (cx, cz), as the
   game's StrongholdStructure.generatePieces makes it. */
export function strongholdPieces(seed, cx, cz) {
  const r = new JRand(0);
  let acc, start, i = 0;
  do {
    acc = new Pieces();
    largeFeature(r, seed + BigInt(i++), cx, cz);
    const L = new Layout();
    start = new StartPiece(r, cx * 16 + 2, cz * 16 + 2);
    acc.add(start);
    start.addChildren(L, start, acc, r);
    const list = start.pending;
    while (list.length) {
      const j = r.nextInt(list.length);
      const p = list.splice(j, 1)[0];
      p.addChildren(L, start, acc, r);
    }
    acc.moveBelowSeaLevel(63, -64, r, 10);
  } while (!acc.list.length || !start.portalRoom);
  // a seed of its own for the portal room's eyes (the game uses the chunk's random; any fixed one will do)
  start.portalRoom.eyeSeed = BigInt(r.nextInt()) ^ seed;
  return acc.list;
}
