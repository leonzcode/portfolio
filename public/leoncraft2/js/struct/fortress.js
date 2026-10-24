/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the nether fortress.

   Laid out in code by the game (NetherFortressPieces), the way the
   stronghold is: bridges and their crossings out from the start, then the
   castle: small corridors, turns with chests, corridor stairs, balconies,
   the nether wart rooms, and the blaze spawners on their thrones. Two lists
   of weighted pieces (bridge and castle), each with a cap, picked with the
   structure's own random, so the same seed gives the game's own fortress.

   It is generated as data here; the Nether's generator calls applyPieces
   for its chunks once the dimension exists.
--------------------------------------------------------------------------- */
import { Box, Piece, Pieces, NORTH, EAST, SOUTH, WEST, HORIZONTAL } from './piece.js?v=107';
import { largeFeature, JRand } from './rand.js?v=107';

const NB = 'nether_bricks', FENCE = 'nether_brick_fence', AIR = 'air';
const okBox = b => b && b.y0 > 10;

const BRIDGE = [['BridgeStraight', 30, 0, true], ['BridgeCrossing', 10, 4], ['RoomCrossing', 10, 4], ['StairsRoom', 10, 3], ['MonsterThrone', 5, 2], ['CastleEntrance', 5, 1]];
const CASTLE = [['CastleSmallCorridor', 25, 0, true], ['CastleSmallCorridorCrossing', 15, 5], ['CastleSmallCorridorRightTurn', 5, 10],
  ['CastleSmallCorridorLeftTurn', 5, 10], ['CastleCorridorStairs', 10, 3, true], ['CastleCorridorTBalcony', 7, 2], ['CastleStalkRoom', 5, 2]];
const weights = list => list.map(([kind, weight, max, row]) => ({ kind, weight, max, row: !!row, count: 0 }));

class NF extends Piece {
  constructor(type, depth, box) { super(type, depth, box); }
  static total(list) {
    let any = false, t = 0;
    for (const w of list) { if (w.max > 0 && w.count < w.max) any = true; t += w.weight; }
    return any ? t : -1;
  }
  pick(start, list, acc, r, x, y, z, dir, depth) {
    const t = NF.total(list);
    const go = t > 0 && depth <= 30;
    let j = 0;
    outer: while (j < 5 && go) {
      j++;
      let k = r.nextInt(t);
      for (const w of list) {
        if ((k -= w.weight) >= 0) continue;
        if (!(w.max === 0 || w.count < w.max) || (w === start.previous && !w.row)) continue outer;
        const p = KINDS[w.kind].create(acc, r, x, y, z, dir, depth);
        if (!p) continue;
        w.count++;
        start.previous = w;
        if (!(w.max === 0 || w.count < w.max)) list.splice(list.indexOf(w), 1);
        return p;
      }
    }
    return BridgeEndFiller.create(acc, r, x, y, z, dir, depth);
  }
  add(start, acc, r, x, y, z, dir, depth, castle) {
    if (Math.abs(x - start.box.x0) > 112 || Math.abs(z - start.box.z0) > 112) return BridgeEndFiller.create(acc, r, x, y, z, dir, depth);
    const p = this.pick(start, castle ? start.castle : start.bridge, acc, r, x, y, z, dir, depth + 1);
    if (p) { acc.add(p); start.pending.push(p); }
    return p;
  }
  forward(start, acc, r, ox, oy, castle) {
    const b = this.box;
    switch (this.dir) {
      case NORTH: return this.add(start, acc, r, b.x0 + ox, b.y0 + oy, b.z0 - 1, this.dir, this.depth, castle);
      case SOUTH: return this.add(start, acc, r, b.x0 + ox, b.y0 + oy, b.z1 + 1, this.dir, this.depth, castle);
      case WEST: return this.add(start, acc, r, b.x0 - 1, b.y0 + oy, b.z0 + ox, this.dir, this.depth, castle);
      case EAST: return this.add(start, acc, r, b.x1 + 1, b.y0 + oy, b.z0 + ox, this.dir, this.depth, castle);
    }
    return null;
  }
  left(start, acc, r, oy, oxz, castle) {
    const b = this.box;
    switch (this.dir) {
      case NORTH: case SOUTH: return this.add(start, acc, r, b.x0 - 1, b.y0 + oy, b.z0 + oxz, WEST, this.depth, castle);
      case WEST: case EAST: return this.add(start, acc, r, b.x0 + oxz, b.y0 + oy, b.z0 - 1, NORTH, this.depth, castle);
    }
    return null;
  }
  right(start, acc, r, oy, oxz, castle) {
    const b = this.box;
    switch (this.dir) {
      case NORTH: case SOUTH: return this.add(start, acc, r, b.x1 + 1, b.y0 + oy, b.z0 + oxz, EAST, this.depth, castle);
      case WEST: case EAST: return this.add(start, acc, r, b.x0 + oxz, b.y0 + oy, b.z1 + 1, SOUTH, this.depth, castle);
    }
    return null;
  }
  addChildren() {}
  legs(w, cb, x0, z0, x1, z1) { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.column(w, NB, x, -1, z, cb); }
}
function simple(type, ox, oy, oz, W, Hh, D, ctorRandom) {
  return class extends NF {
    constructor(depth, r, box, dir) { super(type, depth, box); this.setOrientation(dir); if (ctorRandom) ctorRandom(this, r); }
    static create(acc, r, x, y, z, dir, depth) {
      const b = Box.orient(x, y, z, ox, oy, oz, W, Hh, D, dir);
      return okBox(b) && !acc.collides(b) ? new this(depth, r, b, dir) : null;
    }
  };
}

/* ------------------------------------------------------------ bridges -- */
class BridgeStraight extends simple('nebs', -1, -3, 0, 5, 10, 19) {
  addChildren(start, acc, r) { this.forward(start, acc, r, 1, 3, false); }
  place(w, cb) {
    this.box1(w, cb, 0, 3, 0, 4, 4, 18, NB);
    this.air(w, cb, 1, 5, 0, 3, 7, 18);
    this.box1(w, cb, 0, 5, 0, 0, 5, 18, NB); this.box1(w, cb, 4, 5, 0, 4, 5, 18, NB);
    this.box1(w, cb, 0, 2, 0, 4, 2, 5, NB); this.box1(w, cb, 0, 2, 13, 4, 2, 18, NB);
    this.box1(w, cb, 0, 0, 0, 4, 1, 3, NB); this.box1(w, cb, 0, 0, 15, 4, 1, 18, NB);
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) { this.column(w, NB, i, -1, j, cb); this.column(w, NB, i, -1, 18 - j, cb); }
    for (const x of [0, 4]) {
      this.box1(w, cb, x, 1, 1, x, 4, 1, FENCE); this.box1(w, cb, x, 3, 4, x, 4, 4, FENCE);
      this.box1(w, cb, x, 3, 14, x, 4, 14, FENCE); this.box1(w, cb, x, 1, 17, x, 4, 17, FENCE);
    }
  }
}
class BridgeEndFiller extends NF {
  constructor(depth, r, box, dir) { super('nebef', depth, box); this.setOrientation(dir); this.selfSeed = r.nextInt(); }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -1, -3, 0, 5, 10, 8, dir);
    return okBox(b) && !acc.collides(b) ? new BridgeEndFiller(depth, r, b, dir) : null;
  }
  place(w, cb) {
    const r = new JRand(BigInt(this.selfSeed));
    for (let i = 0; i <= 4; i++) for (let j = 3; j <= 4; j++) { const k = r.nextInt(8); this.box1(w, cb, i, j, 0, i, j, k, NB); }
    let i = r.nextInt(8); this.box1(w, cb, 0, 5, 0, 0, 5, i, NB);
    i = r.nextInt(8); this.box1(w, cb, 4, 5, 0, 4, 5, i, NB);
    for (i = 0; i <= 4; i++) { const j = r.nextInt(5); this.box1(w, cb, i, 2, 0, i, 2, j, NB); }
    for (i = 0; i <= 4; i++) for (let j = 0; j <= 1; j++) { const k = r.nextInt(3); this.box1(w, cb, i, j, 0, i, j, k, NB); }
  }
}
class BridgeCrossing extends NF {
  constructor(depth, box, dir, type) { super(type || 'nebcr', depth, box); this.setOrientation(dir); }
  static create(acc, r, x, y, z, dir, depth) {
    const b = Box.orient(x, y, z, -8, -3, 0, 19, 10, 19, dir);
    return okBox(b) && !acc.collides(b) ? new BridgeCrossing(depth, b, dir) : null;
  }
  addChildren(start, acc, r) {
    this.forward(start, acc, r, 8, 3, false);
    this.left(start, acc, r, 3, 8, false);
    this.right(start, acc, r, 3, 8, false);
  }
  place(w, cb) {
    this.box1(w, cb, 7, 3, 0, 11, 4, 18, NB); this.box1(w, cb, 0, 3, 7, 18, 4, 11, NB);
    this.air(w, cb, 8, 5, 0, 10, 7, 18); this.air(w, cb, 0, 5, 8, 18, 7, 10);
    this.box1(w, cb, 7, 5, 0, 7, 5, 7, NB); this.box1(w, cb, 7, 5, 11, 7, 5, 18, NB);
    this.box1(w, cb, 11, 5, 0, 11, 5, 7, NB); this.box1(w, cb, 11, 5, 11, 11, 5, 18, NB);
    this.box1(w, cb, 0, 5, 7, 7, 5, 7, NB); this.box1(w, cb, 11, 5, 7, 18, 5, 7, NB);
    this.box1(w, cb, 0, 5, 11, 7, 5, 11, NB); this.box1(w, cb, 11, 5, 11, 18, 5, 11, NB);
    this.box1(w, cb, 7, 2, 0, 11, 2, 5, NB); this.box1(w, cb, 7, 2, 13, 11, 2, 18, NB);
    this.box1(w, cb, 7, 0, 0, 11, 1, 3, NB); this.box1(w, cb, 7, 0, 15, 11, 1, 18, NB);
    for (let i = 7; i <= 11; i++) for (let j = 0; j <= 2; j++) { this.column(w, NB, i, -1, j, cb); this.column(w, NB, i, -1, 18 - j, cb); }
    this.box1(w, cb, 0, 2, 7, 5, 2, 11, NB); this.box1(w, cb, 13, 2, 7, 18, 2, 11, NB);
    this.box1(w, cb, 0, 0, 7, 3, 1, 11, NB); this.box1(w, cb, 15, 0, 7, 18, 1, 11, NB);
    for (let i = 0; i <= 2; i++) for (let j = 7; j <= 11; j++) { this.column(w, NB, i, -1, j, cb); this.column(w, NB, 18 - i, -1, j, cb); }
  }
}
class RoomCrossing extends simple('nerc', -2, 0, 0, 7, 9, 7) {
  addChildren(start, acc, r) { this.forward(start, acc, r, 2, 0, false); this.left(start, acc, r, 0, 2, false); this.right(start, acc, r, 0, 2, false); }
  place(w, cb) {
    this.box1(w, cb, 0, 0, 0, 6, 1, 6, NB); this.air(w, cb, 0, 2, 0, 6, 7, 6);
    for (const [a, b, c, d] of [[0, 0, 1, 0], [5, 0, 6, 0], [0, 6, 1, 6], [5, 6, 6, 6]]) this.box1(w, cb, a, 2, b, c, 6, d, NB);
    for (const [a, b, c, d] of [[0, 0, 0, 1], [0, 5, 0, 6], [6, 0, 6, 1], [6, 5, 6, 6]]) this.box1(w, cb, a, 2, b, c, 6, d, NB);
    for (const y of [5, 6]) {
      this.box1(w, cb, 2, y, 0, 4, y, 0, FENCE); this.box1(w, cb, 2, y, 6, 4, y, 6, FENCE);
      this.box1(w, cb, 0, y, 2, 0, y, 4, FENCE); this.box1(w, cb, 6, y, 2, 6, y, 4, FENCE);
    }
    this.box1(w, cb, 0, 7, 0, 6, 7, 6, NB);
    this.air(w, cb, 1, 7, 1, 5, 7, 5);
    this.legs(w, cb, 0, 0, 6, 6);
  }
}
class StairsRoom extends simple('nesr', -2, 0, 0, 7, 11, 7) {
  addChildren(start, acc, r) { this.right(start, acc, r, 6, 2, false); }
  place(w, cb) {
    this.box1(w, cb, 0, 0, 0, 6, 1, 6, NB); this.air(w, cb, 0, 2, 0, 6, 10, 6);
    this.box1(w, cb, 0, 2, 0, 1, 8, 0, NB); this.box1(w, cb, 5, 2, 0, 6, 8, 0, NB);
    this.box1(w, cb, 0, 2, 1, 0, 8, 6, NB); this.box1(w, cb, 6, 2, 1, 6, 8, 6, NB);
    this.box1(w, cb, 1, 2, 6, 5, 8, 6, NB);
    this.box1(w, cb, 0, 3, 2, 0, 5, 4, FENCE); this.box1(w, cb, 6, 3, 2, 6, 5, 2, FENCE); this.box1(w, cb, 6, 3, 4, 6, 5, 4, FENCE);
    this.put(w, NB, 5, 2, 5, cb);
    this.box1(w, cb, 4, 2, 5, 4, 3, 5, NB); this.box1(w, cb, 3, 2, 5, 3, 4, 5, NB);
    this.box1(w, cb, 2, 2, 5, 2, 5, 5, NB); this.box1(w, cb, 1, 2, 5, 1, 6, 5, NB);
    this.box1(w, cb, 1, 7, 1, 5, 7, 4, NB); this.box1(w, cb, 6, 8, 2, 6, 8, 4, AIR);
    this.box1(w, cb, 2, 6, 0, 4, 8, 0, NB); this.box1(w, cb, 2, 5, 0, 4, 5, 0, FENCE);
    this.legs(w, cb, 0, 0, 6, 6);
  }
}
class MonsterThrone extends simple('nemt', -2, 0, 0, 7, 8, 9) {
  place(w, cb) {
    this.air(w, cb, 0, 2, 0, 6, 7, 7);
    this.box1(w, cb, 1, 0, 0, 5, 1, 7, NB); this.box1(w, cb, 1, 2, 1, 5, 2, 7, NB);
    this.box1(w, cb, 1, 3, 2, 5, 3, 7, NB); this.box1(w, cb, 1, 4, 3, 5, 4, 7, NB);
    this.box1(w, cb, 1, 2, 0, 1, 4, 2, NB); this.box1(w, cb, 5, 2, 0, 5, 4, 2, NB);
    this.box1(w, cb, 1, 5, 2, 1, 5, 3, NB); this.box1(w, cb, 5, 5, 2, 5, 5, 3, NB);
    this.box1(w, cb, 0, 5, 3, 0, 5, 8, NB); this.box1(w, cb, 6, 5, 3, 6, 5, 8, NB);
    this.box1(w, cb, 1, 5, 8, 5, 5, 8, NB);
    this.put(w, FENCE, 1, 6, 3, cb); this.put(w, FENCE, 5, 6, 3, cb);
    this.box1(w, cb, 0, 6, 3, 0, 6, 8, FENCE); this.box1(w, cb, 6, 6, 3, 6, 6, 8, FENCE);
    this.box1(w, cb, 1, 6, 8, 5, 7, 8, FENCE); this.box1(w, cb, 2, 8, 8, 4, 8, 8, FENCE);
    this.spawner(w, cb, 3, 5, 5, 'blaze');
    this.legs(w, cb, 0, 0, 6, 6);
  }
}
class CastleEntrance extends simple('nece', -5, -3, 0, 13, 14, 13) {
  addChildren(start, acc, r) { this.forward(start, acc, r, 5, 3, true); }
  place(w, cb) {
    this.box1(w, cb, 0, 3, 0, 12, 4, 12, NB); this.air(w, cb, 0, 5, 0, 12, 13, 12);
    this.box1(w, cb, 0, 5, 0, 1, 12, 12, NB); this.box1(w, cb, 11, 5, 0, 12, 12, 12, NB);
    this.box1(w, cb, 2, 5, 11, 4, 12, 12, NB); this.box1(w, cb, 8, 5, 11, 10, 12, 12, NB);
    this.box1(w, cb, 5, 9, 11, 7, 12, 12, NB); this.box1(w, cb, 2, 5, 0, 4, 12, 1, NB);
    this.box1(w, cb, 8, 5, 0, 10, 12, 1, NB); this.box1(w, cb, 5, 9, 0, 7, 12, 1, NB);
    this.box1(w, cb, 2, 11, 2, 10, 12, 10, NB);
    this.box1(w, cb, 5, 8, 0, 7, 8, 0, FENCE);
    for (let i = 1; i <= 11; i += 2) {
      this.box1(w, cb, i, 10, 0, i, 11, 0, FENCE); this.box1(w, cb, i, 10, 12, i, 11, 12, FENCE);
      this.box1(w, cb, 0, 10, i, 0, 11, i, FENCE); this.box1(w, cb, 12, 10, i, 12, 11, i, FENCE);
      this.put(w, NB, i, 13, 0, cb); this.put(w, NB, i, 13, 12, cb); this.put(w, NB, 0, 13, i, cb); this.put(w, NB, 12, 13, i, cb);
      if (i !== 11) {
        this.put(w, FENCE, i + 1, 13, 0, cb); this.put(w, FENCE, i + 1, 13, 12, cb);
        this.put(w, FENCE, 0, 13, i + 1, cb); this.put(w, FENCE, 12, 13, i + 1, cb);
      }
    }
    // the lava well in the middle of the courtyard
    this.box1(w, cb, 4, 2, 4, 8, 2, 8, NB);
    this.box1(w, cb, 5, 5, 5, 7, 5, 7, NB);
    this.box1(w, cb, 4, 5, 4, 8, 5, 4, NB); this.box1(w, cb, 4, 5, 8, 8, 5, 8, NB);
    this.box1(w, cb, 4, 5, 5, 4, 5, 7, NB); this.box1(w, cb, 8, 5, 5, 8, 5, 7, NB);
    this.put(w, 'lava', 6, 5, 6, cb);
    for (let i = 4; i <= 8; i++) for (let j = 0; j <= 2; j++) { this.column(w, NB, i, -1, j, cb); this.column(w, NB, i, -1, 12 - j, cb); }
    for (let i = 0; i <= 2; i++) for (let j = 4; j <= 8; j++) { this.column(w, NB, i, -1, j, cb); this.column(w, NB, 12 - i, -1, j, cb); }
  }
}
class CastleStalkRoom extends simple('necsr', -5, -3, 0, 13, 14, 13) {
  addChildren(start, acc, r) { this.forward(start, acc, r, 5, 3, true); this.forward(start, acc, r, 5, 11, true); }
  place(w, cb) {
    this.box1(w, cb, 0, 3, 0, 12, 4, 12, NB); this.air(w, cb, 0, 5, 0, 12, 13, 12);
    this.box1(w, cb, 0, 5, 0, 1, 12, 12, NB); this.box1(w, cb, 11, 5, 0, 12, 12, 12, NB);
    this.box1(w, cb, 2, 5, 11, 4, 12, 12, NB); this.box1(w, cb, 8, 5, 11, 10, 12, 12, NB);
    this.box1(w, cb, 5, 9, 11, 7, 12, 12, NB); this.box1(w, cb, 2, 5, 0, 4, 12, 1, NB);
    this.box1(w, cb, 8, 5, 0, 10, 12, 1, NB); this.box1(w, cb, 5, 9, 0, 7, 12, 1, NB);
    this.box1(w, cb, 2, 11, 2, 10, 12, 10, NB);
    for (let i = 1; i <= 11; i += 2) {
      this.box1(w, cb, i, 10, 0, i, 11, 0, FENCE); this.box1(w, cb, i, 10, 12, i, 11, 12, FENCE);
      this.box1(w, cb, 0, 10, i, 0, 11, i, FENCE); this.box1(w, cb, 12, 10, i, 12, 11, i, FENCE);
    }
    // the stairs up to the back door
    for (let k = 0; k <= 6; k++) {
      const z = 4 + k;
      for (let x = 5; x <= 7; x++) this.put(w, 'nether_brick_stairs', x, 5 + k, z, cb, { f: NORTH });
      if (z >= 5 && z <= 8) this.box1(w, cb, 5, 5, z, 7, 4 + k, z, NB);
    }
    this.box1(w, cb, 4, 12, 9, 8, 12, 10, AIR);
    // the soul sand beds with nether wart
    this.box1(w, cb, 3, 4, 5, 3, 4, 9, 'soul_sand'); this.box1(w, cb, 9, 4, 5, 9, 4, 9, 'soul_sand');
    this.box1(w, cb, 3, 5, 5, 3, 5, 9, 'nether_wart', { m: 3 }); this.box1(w, cb, 9, 5, 5, 9, 5, 9, 'nether_wart', { m: 3 });
    this.box1(w, cb, 4, 4, 4, 4, 4, 9, 'soul_sand'); this.box1(w, cb, 8, 4, 4, 8, 4, 9, 'soul_sand');
    this.box1(w, cb, 4, 5, 4, 4, 5, 9, 'nether_wart', { m: 3 }); this.box1(w, cb, 8, 5, 4, 8, 5, 9, 'nether_wart', { m: 3 });
    for (let i = 4; i <= 8; i++) for (let j = 0; j <= 2; j++) { this.column(w, NB, i, -1, j, cb); this.column(w, NB, i, -1, 12 - j, cb); }
    for (let i = 0; i <= 2; i++) for (let j = 4; j <= 8; j++) { this.column(w, NB, i, -1, j, cb); this.column(w, NB, 12 - i, -1, j, cb); }
  }
}

/* ------------------------------------------------------------- castle -- */
function corridorShell(p, w, cb) {
  p.box1(w, cb, 0, 0, 0, 4, 1, 4, NB);
  p.air(w, cb, 0, 2, 0, 4, 5, 4);
  p.box1(w, cb, 0, 6, 0, 4, 6, 4, NB);
}
class CastleSmallCorridor extends simple('nesc', -1, 0, 0, 5, 7, 5) {
  addChildren(start, acc, r) { this.forward(start, acc, r, 1, 0, true); }
  place(w, cb) {
    corridorShell(this, w, cb);
    this.box1(w, cb, 0, 2, 0, 0, 5, 4, NB); this.box1(w, cb, 4, 2, 0, 4, 5, 4, NB);
    for (const x of [0, 4]) { this.box1(w, cb, x, 3, 1, x, 4, 1, FENCE); this.box1(w, cb, x, 3, 3, x, 4, 3, FENCE); }
    this.legs(w, cb, 0, 0, 4, 4);
  }
}
class CastleSmallCorridorCrossing extends simple('nescsc', -1, 0, 0, 5, 7, 5) {
  addChildren(start, acc, r) { this.forward(start, acc, r, 1, 0, true); this.left(start, acc, r, 0, 1, true); this.right(start, acc, r, 0, 1, true); }
  place(w, cb) {
    corridorShell(this, w, cb);
    for (const [x, z] of [[0, 0], [4, 0], [0, 4], [4, 4]]) this.box1(w, cb, x, 2, z, x, 5, z, NB);
    this.legs(w, cb, 0, 0, 4, 4);
  }
}
// (the chest's spot is in one chunk only, so it is put there whenever that chunk is made: the game's
// "placed it already" flag would leave it out of a chunk made a second time)
const needChest = (p, r) => { p.needChest = r.nextInt(3) === 0; };
class CastleSmallCorridorRightTurn extends simple('nescrt', -1, 0, 0, 5, 7, 5, needChest) {
  addChildren(start, acc, r) { this.right(start, acc, r, 0, 1, true); }
  place(w, cb, r) {
    corridorShell(this, w, cb);
    this.box1(w, cb, 0, 2, 0, 0, 5, 4, NB); this.box1(w, cb, 1, 2, 4, 4, 5, 4, NB);
    this.box1(w, cb, 0, 3, 1, 0, 4, 1, FENCE); this.box1(w, cb, 0, 3, 3, 0, 4, 3, FENCE);
    this.box1(w, cb, 1, 3, 4, 1, 4, 4, FENCE); this.box1(w, cb, 3, 3, 4, 3, 4, 4, FENCE);
    this.box1(w, cb, 4, 2, 0, 4, 5, 0, NB);
    if (this.needChest) this.chest(w, cb, r, 1, 2, 3, 'nether_bridge');
    this.legs(w, cb, 0, 0, 4, 4);
  }
}
class CastleSmallCorridorLeftTurn extends simple('nesclt', -1, 0, 0, 5, 7, 5, needChest) {
  addChildren(start, acc, r) { this.left(start, acc, r, 0, 1, true); }
  place(w, cb, r) {
    corridorShell(this, w, cb);
    this.box1(w, cb, 4, 2, 0, 4, 5, 4, NB); this.box1(w, cb, 0, 2, 4, 3, 5, 4, NB);
    this.box1(w, cb, 4, 3, 1, 4, 4, 1, FENCE); this.box1(w, cb, 4, 3, 3, 4, 4, 3, FENCE);
    this.box1(w, cb, 1, 3, 4, 1, 4, 4, FENCE); this.box1(w, cb, 3, 3, 4, 3, 4, 4, FENCE);
    this.box1(w, cb, 0, 2, 0, 0, 5, 0, NB);
    if (this.needChest) this.chest(w, cb, r, 3, 2, 3, 'nether_bridge');
    this.legs(w, cb, 0, 0, 4, 4);
  }
}
class CastleCorridorStairs extends simple('neccs', -1, -7, 0, 5, 14, 10) {
  addChildren(start, acc, r) { this.forward(start, acc, r, 1, 0, true); }
  place(w, cb) {
    for (let i = 0; i <= 9; i++) {
      const j = Math.max(1, 7 - i), k = Math.min(Math.max(j + 5, 14 - i), 13);
      this.box1(w, cb, 0, 0, i, 4, j, i, NB);
      this.air(w, cb, 1, j + 1, i, 3, k - 1, i);
      if (i <= 6) for (let x = 1; x <= 3; x++) this.put(w, 'nether_brick_stairs', x, j + 1, i, cb, { f: NORTH });
      this.box1(w, cb, 0, k, i, 4, k, i, NB);
      this.box1(w, cb, 0, j + 1, i, 0, k - 1, i, NB); this.box1(w, cb, 4, j + 1, i, 4, k - 1, i, NB);
      if ((i & 1) === 0) { this.box1(w, cb, 0, j + 2, i, 0, j + 3, i, FENCE); this.box1(w, cb, 4, j + 2, i, 4, j + 3, i, FENCE); }
      for (let x = 0; x <= 4; x++) this.column(w, NB, x, -1, i, cb);
    }
  }
}
class CastleCorridorTBalcony extends simple('nectb', -3, 0, 0, 9, 7, 9) {
  addChildren(start, acc, r) {
    let i = 1;
    if (this.dir === WEST || this.dir === NORTH) i = 5;
    const a = r.nextInt(8) > 0;
    this.left(start, acc, r, 0, i, a);
    const b = r.nextInt(8) > 0;
    this.right(start, acc, r, 0, i, b);
  }
  place(w, cb) {
    this.box1(w, cb, 0, 0, 0, 8, 1, 8, NB); this.air(w, cb, 0, 2, 0, 8, 5, 8);
    this.box1(w, cb, 0, 6, 0, 8, 6, 5, NB);
    this.box1(w, cb, 0, 2, 0, 2, 5, 0, NB); this.box1(w, cb, 6, 2, 0, 8, 5, 0, NB);
    this.box1(w, cb, 1, 3, 0, 1, 4, 0, FENCE); this.box1(w, cb, 7, 3, 0, 7, 4, 0, FENCE);
    this.box1(w, cb, 0, 2, 4, 8, 2, 8, NB); this.box1(w, cb, 1, 1, 4, 2, 2, 4, AIR); this.box1(w, cb, 6, 1, 4, 7, 2, 4, AIR);
    this.box1(w, cb, 1, 3, 8, 7, 3, 8, FENCE);
    this.box1(w, cb, 0, 3, 6, 0, 3, 7, FENCE); this.box1(w, cb, 8, 3, 6, 8, 3, 7, FENCE);
    this.box1(w, cb, 0, 3, 4, 0, 5, 5, NB); this.box1(w, cb, 8, 3, 4, 8, 5, 5, NB);
    this.box1(w, cb, 1, 3, 5, 2, 5, 5, NB); this.box1(w, cb, 6, 3, 5, 7, 5, 5, NB);
    this.box1(w, cb, 1, 4, 5, 1, 5, 5, FENCE); this.box1(w, cb, 7, 4, 5, 7, 5, 5, FENCE);
    this.legs(w, cb, 0, 0, 8, 5);
  }
}

class StartPiece extends BridgeCrossing {
  constructor(r, x, z) {
    const dir = HORIZONTAL[r.nextInt(4)];
    super(0, Box.make(x, 64, z, dir, 19, 10, 19), dir);
    this.previous = null;
    this.bridge = weights(BRIDGE);
    this.castle = weights(CASTLE);
    this.pending = [];
  }
}

const KINDS = { BridgeStraight, BridgeCrossing, RoomCrossing, StairsRoom, MonsterThrone, CastleEntrance, CastleSmallCorridor,
  CastleSmallCorridorCrossing, CastleSmallCorridorRightTurn, CastleSmallCorridorLeftTurn, CastleCorridorStairs, CastleCorridorTBalcony, CastleStalkRoom };

/* The fortress starting in chunk (cx, cz) (NetherFortressStructure.generatePieces). */
export function fortressPieces(seed, cx, cz) {
  const r = largeFeature(new JRand(0), seed, cx, cz);
  const acc = new Pieces();
  const start = new StartPiece(r, cx * 16 + 2, cz * 16 + 2);
  acc.add(start);
  start.addChildren(start, acc, r);
  const list = start.pending;
  while (list.length) {
    const i = r.nextInt(list.length);
    list.splice(i, 1)[0].addChildren(start, acc, r);
  }
  acc.moveInsideHeights(r, 48, 70);
  return acc.list;
}
