/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the abandoned mineshaft.

   Laid out in code by the game (MineshaftPieces): a dirt-floored room, and
   corridors, crossings and stairs branching out of it, each new piece
   joined straight on (depth first) until it runs out of room, gets more
   than 80 blocks out or 8 deep. Corridors have oak (dark oak in badlands)
   supports, some rails, cobwebs, now and then a chest minecart, and one in
   23 of those without rails is a cave spider nest with its spawner.
--------------------------------------------------------------------------- */
import { Box, Piece, Pieces, NORTH, EAST, SOUTH, WEST } from './piece.js?v=107';
import { largeFeature, JRand } from './rand.js?v=107';

const WOOD = { normal: { planks: 'oak_planks', log: 'oak_log', fence: 'oak_fence' }, mesa: { planks: 'dark_oak_planks', log: 'dark_oak_log', fence: 'dark_oak_fence' } };

class MS extends Piece {
  constructor(type, depth, kind, box) { super(type, depth, box); this.kind = kind; }
  addChildren() {}
  wood() { return WOOD[this.kind]; }
}

function randomPiece(acc, r, x, y, z, dir, depth, kind) {
  const i = r.nextInt(100);
  if (i >= 80) {
    const b = Crossing.find(acc, r, x, y, z, dir);
    if (b) return new Crossing(depth, b, dir, kind);
  } else if (i >= 70) {
    const b = Stairs.find(acc, r, x, y, z, dir);
    if (b) return new Stairs(depth, b, dir, kind);
  } else {
    const b = Corridor.find(acc, r, x, y, z, dir);
    if (b) return new Corridor(depth, r, b, dir, kind);
  }
  return null;
}
function addPiece(start, acc, r, x, y, z, dir, depth) {
  if (depth > 8) return null;
  if (Math.abs(x - start.box.x0) > 80 || Math.abs(z - start.box.z0) > 80) return null;
  const p = randomPiece(acc, r, x, y, z, dir, depth + 1, start.kind);
  if (p) { acc.add(p); p.addChildren(start, acc, r); }
  return p;
}

class Room extends MS {
  constructor(depth, r, x, z, kind) {
    const x1 = x + 7 + r.nextInt(6), y1 = 54 + r.nextInt(6), z1 = z + 7 + r.nextInt(6);
    super('msroom', depth, kind, new Box(x, 50, z, x1, y1, z1));
    this.entrances = [];
  }
  addChildren(start, acc, r) {
    const b = this.box, d = this.depth;
    let j = b.ys - 3 - 1;
    if (j <= 0) j = 1;
    let k = 0;
    while (k < b.xs) {
      if ((k += r.nextInt(b.xs)) + 3 > b.xs) break;
      const p = addPiece(start, acc, r, b.x0 + k, b.y0 + r.nextInt(j) + 1, b.z0 - 1, NORTH, d);
      if (p) { const q = p.box; this.entrances.push(new Box(q.x0, q.y0, b.z0, q.x1, q.y1, b.z0 + 1)); }
      k += 4;
    }
    k = 0;
    while (k < b.xs) {
      if ((k += r.nextInt(b.xs)) + 3 > b.xs) break;
      const p = addPiece(start, acc, r, b.x0 + k, b.y0 + r.nextInt(j) + 1, b.z1 + 1, SOUTH, d);
      if (p) { const q = p.box; this.entrances.push(new Box(q.x0, q.y0, b.z1 - 1, q.x1, q.y1, b.z1)); }
      k += 4;
    }
    k = 0;
    while (k < b.zs) {
      if ((k += r.nextInt(b.zs)) + 3 > b.zs) break;
      const p = addPiece(start, acc, r, b.x0 - 1, b.y0 + r.nextInt(j) + 1, b.z0 + k, WEST, d);
      if (p) { const q = p.box; this.entrances.push(new Box(b.x0, q.y0, q.z0, b.x0 + 1, q.y1, q.z1)); }
      k += 4;
    }
    k = 0;
    while (k < b.zs) {
      if ((k += r.nextInt(b.zs)) + 3 > b.zs) break;
      const p = addPiece(start, acc, r, b.x1 + 1, b.y0 + r.nextInt(j) + 1, b.z0 + k, EAST, d);
      if (p) { const q = p.box; this.entrances.push(new Box(b.x1 - 1, q.y0, q.z0, b.x1, q.y1, q.z1)); }
      k += 4;
    }
  }
  place(w, cb) {
    const b = this.box;
    this.fill(w, cb, b.x0, b.y0, b.z0, b.x1, b.y0, b.z1, 'dirt', 'dirt', true);
    this.air(w, cb, b.x0, b.y0 + 1, b.z0, b.x1, Math.min(b.y0 + 3, b.y1), b.z1);
    for (const e of this.entrances) this.air(w, cb, e.x0, e.y1 - 2, e.z0, e.x1, e.y1, e.z1);
    // the upper half of an ellipsoid over the room
    const x0 = b.x0, y0 = b.y0 + 4, z0 = b.z0, x1 = b.x1, y1 = b.y1, z1 = b.z1;
    const fx = x1 - x0 + 1, fy = y1 - y0 + 1, fz = z1 - z0 + 1, cx = x0 + fx / 2, cz = z0 + fz / 2;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const dx = (x - cx) / (fx * 0.5), dy = (y - y0) / fy, dz = (z - cz) / (fz * 0.5);
      if (dx * dx + dy * dy + dz * dz <= 1.05 && this.get(w, x, y, z, cb)) this.put(w, 'cave_air', x, y, z, cb);
    }
  }
}

class Corridor extends MS {
  constructor(depth, r, box, dir, kind) {
    super('mscorridor', depth, kind, box);
    this.setOrientation(dir);
    this.hasRails = r.nextInt(3) === 0;
    this.spiderCorridor = !this.hasRails && r.nextInt(23) === 0;
    this.sections = dir === NORTH || dir === SOUTH ? (box.zs / 5) | 0 : (box.xs / 5) | 0;
    /* Where a spider corridor's spawner stands. The game puts it in the first
       section of the first chunk it builds the corridor into, which hangs on
       the order chunks happen to be made in; here it is fixed by the corridor
       itself (a section and a step along it from its box), so it comes out
       the same however the chunks round it are made, or made again. */
    if (this.spiderCorridor) {
      const h = Math.imul(box.x0 * 73856093 ^ box.y0 * 19349663 ^ box.z0 * 83492791, 0x9e3779b1) >>> 0;
      this.spiderAt = 2 + (h % this.sections) * 5 - 1 + ((h >>> 16) % 3);
    }
  }
  static find(acc, r, x, y, z, dir) {
    for (let i = r.nextInt(3) + 2; i > 0; i--) {
      const j = i * 5;
      let b;
      switch (dir) {
        case SOUTH: b = new Box(0, 0, 0, 2, 2, j - 1); break;
        case WEST: b = new Box(-(j - 1), 0, 0, 0, 2, 2); break;
        case EAST: b = new Box(0, 0, 0, j - 1, 2, 2); break;
        default: b = new Box(0, 0, -(j - 1), 2, 2, 0);
      }
      b.move(x, y, z);
      if (acc.collides(b)) continue;
      return b;
    }
    return null;
  }
  addChildren(start, acc, r) {
    const d = this.depth, j = r.nextInt(4), b = this.box;
    switch (this.dir) {
      case SOUTH:
        if (j <= 1) addPiece(start, acc, r, b.x0, b.y0 - 1 + r.nextInt(3), b.z1 + 1, this.dir, d);
        else if (j === 2) addPiece(start, acc, r, b.x0 - 1, b.y0 - 1 + r.nextInt(3), b.z1 - 3, WEST, d);
        else addPiece(start, acc, r, b.x1 + 1, b.y0 - 1 + r.nextInt(3), b.z1 - 3, EAST, d);
        break;
      case WEST:
        if (j <= 1) addPiece(start, acc, r, b.x0 - 1, b.y0 - 1 + r.nextInt(3), b.z0, this.dir, d);
        else if (j === 2) addPiece(start, acc, r, b.x0, b.y0 - 1 + r.nextInt(3), b.z0 - 1, NORTH, d);
        else addPiece(start, acc, r, b.x0, b.y0 - 1 + r.nextInt(3), b.z1 + 1, SOUTH, d);
        break;
      case EAST:
        if (j <= 1) addPiece(start, acc, r, b.x1 + 1, b.y0 - 1 + r.nextInt(3), b.z0, this.dir, d);
        else if (j === 2) addPiece(start, acc, r, b.x1 - 3, b.y0 - 1 + r.nextInt(3), b.z0 - 1, NORTH, d);
        else addPiece(start, acc, r, b.x1 - 3, b.y0 - 1 + r.nextInt(3), b.z1 + 1, SOUTH, d);
        break;
      default:
        if (j <= 1) addPiece(start, acc, r, b.x0, b.y0 - 1 + r.nextInt(3), b.z0 - 1, this.dir, d);
        else if (j === 2) addPiece(start, acc, r, b.x0 - 1, b.y0 - 1 + r.nextInt(3), b.z0, WEST, d);
        else addPiece(start, acc, r, b.x1 + 1, b.y0 - 1 + r.nextInt(3), b.z0, EAST, d);
    }
    if (d < 8) {
      if (this.dir === NORTH || this.dir === SOUTH) {
        for (let k = b.z0 + 3; k + 3 <= b.z1; k += 5) {
          const l = r.nextInt(5);
          if (l === 0) addPiece(start, acc, r, b.x0 - 1, b.y0, k, WEST, d + 1);
          else if (l === 1) addPiece(start, acc, r, b.x1 + 1, b.y0, k, EAST, d + 1);
        }
      } else {
        for (let k = b.x0 + 3; k + 3 <= b.x1; k += 5) {
          const l = r.nextInt(5);
          if (l === 0) addPiece(start, acc, r, k, b.y0, b.z0 - 1, NORTH, d + 1);
          else if (l === 1) addPiece(start, acc, r, k, b.y0, b.z1 + 1, SOUTH, d + 1);
        }
      }
    }
  }
  support(w, cb, x0, y0, z, y1, x1, r) {
    const W = this.wood();
    if (!this.get(w, x0, y1 + 1, z, cb) || !this.get(w, x1, y1 + 1, z, cb)) return;   // nothing to hold up
    this.box1(w, cb, x0, y0, z, x0, y1 - 1, z, W.fence);
    this.box1(w, cb, x1, y0, z, x1, y1 - 1, z, W.fence);
    if (r.nextInt(4) === 0) { this.put(w, W.planks, x0, y1, z, cb); this.put(w, W.planks, x1, y1, z, cb); }
    else this.box1(w, cb, x0, y1, z, x1, y1, z, W.planks);
  }
  place(w, cb, r) {
    const m = this.sections * 5 - 1, W = this.wood();
    this.air(w, cb, 0, 0, 0, 2, 1, m);
    this.maybeFill(w, cb, r, 0.8, 0, 2, 0, 2, 2, m, 'cave_air', 'cave_air', false, false);
    if (this.spiderCorridor) this.maybeFill(w, cb, r, 0.6, 0, 0, 0, 2, 1, m, 'cobweb', 'cave_air', false, true);
    for (let n = 0; n < this.sections; n++) {
      const o = 2 + n * 5;
      this.support(w, cb, 0, 0, o, 2, 2, r);
      for (const [p, x, z] of [[0.1, 0, o - 1], [0.1, 2, o - 1], [0.1, 0, o + 1], [0.1, 2, o + 1], [0.05, 0, o - 2], [0.05, 2, o - 2], [0.05, 0, o + 2], [0.05, 2, o + 2]])
        if (this.get(w, x, 2, z, cb) === 0 && r.nextFloat() < p) this.put(w, 'cobweb', x, 2, z, cb);
      if (r.nextInt(100) === 0) this.minecart(w, cb, r, 2, 0, o - 1);
      if (r.nextInt(100) === 0) this.minecart(w, cb, r, 0, 0, o + 1);
      if (this.spiderCorridor && this.spiderAt >= o - 1 && this.spiderAt <= o + 1) this.spawner(w, cb, 1, 0, this.spiderAt, 'cave_spider');
    }
    // a floor of planks where the corridor crosses a gap
    for (let x = 0; x <= 2; x++) for (let z = 0; z <= m; z++) {
      const X = this.wx(x, z), Y = this.wy(-1), Z = this.wz(x, z);
      if (cb.inside(X, Y, Z) && w.get(X, Y, Z) === 0) this.put(w, W.planks, x, -1, z, cb);
    }
    if (this.hasRails) for (let z = 0; z <= m; z++) {
      const X = this.wx(1, z), Y = this.wy(-1), Z = this.wz(1, z);
      if (cb.inside(X, Y, Z) && w.get(X, Y, Z) && r.nextFloat() < 0.7) this.put(w, 'rail', 1, 0, z, cb);
    }
  }
  // a chest minecart on a rail: the cart is an entity (left for the entities to make), its loot is kept here
  // (the game draws the rail's way, north-south or east-west, and then the cart's loot seed, a long kept as text)
  minecart(w, cb, r, x, y, z) {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    if (!cb.inside(X, Y, Z) || w.get(X, Y, Z) !== 0 || !w.get(X, Y - 1, Z)) return;
    r.nextBoolean();
    this.put(w, 'rail', x, y, z, cb);
    w.entity('chest_minecart', X + 0.5, Y, Z + 0.5, { loot: 'abandoned_mineshaft', seed: String(r.nextLong()) });
  }
}

class Crossing extends MS {
  constructor(depth, box, dir, kind) { super('mscrossing', depth, kind, box); this.facing = dir; this.twoFloors = box.ys > 3; }
  static find(acc, r, x, y, z, dir) {
    const i = r.nextInt(4) === 0 ? 6 : 2;
    let b;
    switch (dir) {
      case SOUTH: b = new Box(-1, 0, 0, 3, i, 4); break;
      case WEST: b = new Box(-4, 0, -1, 0, i, 3); break;
      case EAST: b = new Box(0, 0, -1, 4, i, 3); break;
      default: b = new Box(-1, 0, -4, 3, i, 0);
    }
    b.move(x, y, z);
    return acc.collides(b) ? null : b;
  }
  addChildren(start, acc, r) {
    const d = this.depth, b = this.box;
    switch (this.facing) {
      case SOUTH:
        addPiece(start, acc, r, b.x0 + 1, b.y0, b.z1 + 1, SOUTH, d); addPiece(start, acc, r, b.x0 - 1, b.y0, b.z0 + 1, WEST, d); addPiece(start, acc, r, b.x1 + 1, b.y0, b.z0 + 1, EAST, d);
        break;
      case WEST:
        addPiece(start, acc, r, b.x0 + 1, b.y0, b.z0 - 1, NORTH, d); addPiece(start, acc, r, b.x0 + 1, b.y0, b.z1 + 1, SOUTH, d); addPiece(start, acc, r, b.x0 - 1, b.y0, b.z0 + 1, WEST, d);
        break;
      case EAST:
        addPiece(start, acc, r, b.x0 + 1, b.y0, b.z0 - 1, NORTH, d); addPiece(start, acc, r, b.x0 + 1, b.y0, b.z1 + 1, SOUTH, d); addPiece(start, acc, r, b.x1 + 1, b.y0, b.z0 + 1, EAST, d);
        break;
      default:
        addPiece(start, acc, r, b.x0 + 1, b.y0, b.z0 - 1, NORTH, d); addPiece(start, acc, r, b.x0 - 1, b.y0, b.z0 + 1, WEST, d); addPiece(start, acc, r, b.x1 + 1, b.y0, b.z0 + 1, EAST, d);
    }
    if (this.twoFloors) {
      if (r.nextBoolean()) addPiece(start, acc, r, b.x0 + 1, b.y0 + 3 + 1, b.z0 - 1, NORTH, d);
      if (r.nextBoolean()) addPiece(start, acc, r, b.x0 - 1, b.y0 + 3 + 1, b.z0 + 1, WEST, d);
      if (r.nextBoolean()) addPiece(start, acc, r, b.x1 + 1, b.y0 + 3 + 1, b.z0 + 1, EAST, d);
      if (r.nextBoolean()) addPiece(start, acc, r, b.x0 + 1, b.y0 + 3 + 1, b.z1 + 1, SOUTH, d);
    }
  }
  place(w, cb) {
    const b = this.box, W = this.wood();
    if (this.twoFloors) {
      this.air(w, cb, b.x0 + 1, b.y0, b.z0, b.x1 - 1, b.y0 + 3 - 1, b.z1);
      this.air(w, cb, b.x0, b.y0, b.z0 + 1, b.x1, b.y0 + 3 - 1, b.z1 - 1);
      this.air(w, cb, b.x0 + 1, b.y1 - 2, b.z0, b.x1 - 1, b.y1, b.z1);
      this.air(w, cb, b.x0, b.y1 - 2, b.z0 + 1, b.x1, b.y1, b.z1 - 1);
      this.air(w, cb, b.x0 + 1, b.y0 + 3, b.z0 + 1, b.x1 - 1, b.y0 + 3, b.z1 - 1);
    } else {
      this.air(w, cb, b.x0 + 1, b.y0, b.z0, b.x1 - 1, b.y1, b.z1);
      this.air(w, cb, b.x0, b.y0, b.z0 + 1, b.x1, b.y1, b.z1 - 1);
    }
    for (const [x, z] of [[b.x0 + 1, b.z0 + 1], [b.x0 + 1, b.z1 - 1], [b.x1 - 1, b.z0 + 1], [b.x1 - 1, b.z1 - 1]])
      if (this.get(w, x, b.y1 + 1, z, cb)) this.box1(w, cb, x, b.y0, z, x, b.y1, z, W.planks);
    for (let x = b.x0; x <= b.x1; x++) for (let z = b.z0; z <= b.z1; z++)
      if (this.get(w, x, b.y0 - 1, z, cb) === 0) this.put(w, W.planks, x, b.y0 - 1, z, cb);
  }
}

class Stairs extends MS {
  constructor(depth, box, dir, kind) { super('msstairs', depth, kind, box); this.setOrientation(dir); }
  static find(acc, r, x, y, z, dir) {
    let b;
    switch (dir) {
      case SOUTH: b = new Box(0, -5, 0, 2, 2, 8); break;
      case WEST: b = new Box(-8, -5, 0, 0, 2, 2); break;
      case EAST: b = new Box(0, -5, 0, 8, 2, 2); break;
      default: b = new Box(0, -5, -8, 2, 2, 0);
    }
    b.move(x, y, z);
    return acc.collides(b) ? null : b;
  }
  addChildren(start, acc, r) {
    const d = this.depth, b = this.box;
    switch (this.dir) {
      case SOUTH: addPiece(start, acc, r, b.x0, b.y0, b.z1 + 1, SOUTH, d); break;
      case WEST: addPiece(start, acc, r, b.x0 - 1, b.y0, b.z0, WEST, d); break;
      case EAST: addPiece(start, acc, r, b.x1 + 1, b.y0, b.z0, EAST, d); break;
      default: addPiece(start, acc, r, b.x0, b.y0, b.z0 - 1, NORTH, d);
    }
  }
  place(w, cb) {
    this.air(w, cb, 0, 5, 0, 2, 7, 1);
    this.air(w, cb, 0, 0, 7, 2, 2, 8);
    for (let i = 0; i < 5; i++) this.air(w, cb, 0, 5 - i - (i < 4 ? 1 : 0), 2 + i, 2, 7 - i, 2 + i);
  }
}

/* The mineshaft starting in chunk (cx, cz) (MineshaftStructure), and how far
   it was moved up or down (which is where the game checks its biome). */
export function mineshaftPieces(seed, cx, cz, kind, groundAt) {
  const r = largeFeature(new JRand(0), seed, cx, cz);
  r.nextDouble();
  const acc = new Pieces();
  const room = new Room(0, r, cx * 16 + 2, cz * 16 + 2, kind);
  acc.add(room);
  room.addChildren(room, acc, r);
  let dy;
  if (kind === 'mesa') {
    const [mx, my, mz] = acc.bounds().centre();
    const j = groundAt ? groundAt(mx, mz) : 63;
    const k = j <= 63 ? 63 : r.between(63, j);
    dy = k - my;
    acc.shift(dy);
  } else dy = acc.moveBelowSeaLevel(63, -64, r, 10);
  // the room's doorways move with it (the game's room moves its entrance boxes too); left behind they
  // cut a hole of air into the ground or the sea floor sixty blocks above every mineshaft
  for (const e of room.entrances) e.move(0, dy, 0);
  return { pieces: acc.list, dy };
}
