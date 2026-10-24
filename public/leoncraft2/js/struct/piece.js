/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: pieces, boxes and the chunk they are built into.

   A structure is a list of pieces, each a box in the world with a facing.
   Its blocks are written in the piece's own frame (x across, y up, z away
   from the entrance) and turned into the world the way the game's
   StructurePiece does: north and south keep x and run z backwards or
   forwards, east and west swap the axes, and block states (stairs, doors,
   ladders, torches) are mirrored and turned to match.

   A chunk is generated on its own, so every piece only writes the part of
   itself inside that chunk (the clip box): a structure crossing chunk
   borders comes out whole once all its chunks are made.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';
import { CH, H, Y0, idx } from '../world-const.js?v=107';

export const NORTH = 0, EAST = 1, SOUTH = 2, WEST = 3;
export const HORIZONTAL = [NORTH, EAST, SOUTH, WEST];        // Direction.Plane.HORIZONTAL, in the game's order
const DX = [0, 1, 0, -1], DZ = [-1, 0, 1, 0];
export const opposite = d => (d + 2) & 3;
// a direction as the game stores it in a piece (Direction.get2DDataValue)
export const DATA2D = [2, 3, 0, 1];

/* ================================================================ Box == */
export class Box {
  constructor(x0, y0, z0, x1, y1, z1) {
    // the game swaps an inverted box round rather than keeping it empty
    this.x0 = Math.min(x0, x1); this.y0 = Math.min(y0, y1); this.z0 = Math.min(z0, z1);
    this.x1 = Math.max(x0, x1); this.y1 = Math.max(y0, y1); this.z1 = Math.max(z0, z1);
  }
  static orient(x, y, z, ox, oy, oz, w, h, d, dir) {
    switch (dir) {
      case SOUTH: return new Box(x + ox, y + oy, z + oz, x + w - 1 + ox, y + h - 1 + oy, z + d - 1 + oz);
      case WEST: return new Box(x - d + 1 + oz, y + oy, z + ox, x + oz, y + h - 1 + oy, z + w - 1 + ox);
      case EAST: return new Box(x + oz, y + oy, z + ox, x + d - 1 + oz, y + h - 1 + oy, z + w - 1 + ox);
      default: return new Box(x + ox, y + oy, z - d + 1 + oz, x + w - 1 + ox, y + h - 1 + oy, z + oz);
    }
  }
  // StructurePiece.makeBoundingBox: a w x h x d box from a corner, turned to face dir
  static make(x, y, z, dir, w, h, d) {
    return dir === NORTH || dir === SOUTH ? new Box(x, y, z, x + w - 1, y + h - 1, z + d - 1) : new Box(x, y, z, x + d - 1, y + h - 1, z + w - 1);
  }
  intersects(o) { return this.x1 >= o.x0 && this.x0 <= o.x1 && this.z1 >= o.z0 && this.z0 <= o.z1 && this.y1 >= o.y0 && this.y0 <= o.y1; }
  intersectsXZ(x0, z0, x1, z1) { return this.x1 >= x0 && this.x0 <= x1 && this.z1 >= z0 && this.z0 <= z1; }
  inside(x, y, z) { return x >= this.x0 && x <= this.x1 && z >= this.z0 && z <= this.z1 && y >= this.y0 && y <= this.y1; }
  move(dx, dy, dz) { this.x0 += dx; this.x1 += dx; this.y0 += dy; this.y1 += dy; this.z0 += dz; this.z1 += dz; return this; }
  encapsulate(o) {
    this.x0 = Math.min(this.x0, o.x0); this.y0 = Math.min(this.y0, o.y0); this.z0 = Math.min(this.z0, o.z0);
    this.x1 = Math.max(this.x1, o.x1); this.y1 = Math.max(this.y1, o.y1); this.z1 = Math.max(this.z1, o.z1);
    return this;
  }
  get xs() { return this.x1 - this.x0 + 1; }
  get ys() { return this.y1 - this.y0 + 1; }
  get zs() { return this.z1 - this.z0 + 1; }
  centre() { return [this.x0 + ((this.x1 - this.x0 + 1) >> 1), this.y0 + ((this.y1 - this.y0 + 1) >> 1), this.z0 + ((this.z1 - this.z0 + 1) >> 1)]; }
  toArray() { return [this.x0, this.y0, this.z0, this.x1, this.y1, this.z1]; }
}

/* A list of pieces being laid out (StructurePieceAccessor / StructurePiecesBuilder). */
export class Pieces {
  constructor() { this.list = []; }
  add(p) { this.list.push(p); }
  collides(box) { for (const p of this.list) if (p.box.intersects(box)) return p; return null; }
  bounds() {
    if (!this.list.length) return null;
    const b = new Box(...this.list[0].box.toArray());
    for (const p of this.list) b.encapsulate(p.box);
    return b;
  }
  shift(dy) { for (const p of this.list) p.box.move(0, dy, 0); }
  // StructurePiecesBuilder.moveBelowSeaLevel
  moveBelowSeaLevel(sea, minY, random, off) {
    const i = sea - off, b = this.bounds();
    let j = b.ys + minY + 1;
    if (j < i) j += random.nextInt(i - j);
    const k = j - b.y1;
    this.shift(k);
    return k;
  }
  // StructurePiecesBuilder.moveInsideHeights
  moveInsideHeights(random, lo, hi) {
    const b = this.bounds();
    const i = hi - lo + 1 - b.ys;
    const j = i > 1 ? lo + random.nextInt(i) : lo;
    const k = j - b.y0;
    this.shift(k);
    return k;
  }
}

/* ============================================================ blocks == */
const ids = new Map();
const warned = new Set();
// a block id by name (falling back to something solid, once warned, if this game has no such block)
export function id(name) {
  let v = ids.get(name);
  if (v === undefined) {
    v = B[name];
    if (v === undefined) {
      if (!warned.has(name)) { warned.add(name); console.warn('structures: no block', name); }
      v = name.includes('stairs') || name.includes('slab') ? B.cobblestone : name.includes('glass') ? B.glass : B.stone;
    }
    ids.set(name, v);
  }
  return v;
}
// how a block's state is kept in the meta byte, by its shape (see models.js)
export function kindOf(b) {
  const d = BLOCKS[b];
  if (!d) return '';
  if (d.shape === 'stairs') return 'stairs';
  if (d.shape === 'door') return 'door';
  if (d.shape === 'trapdoor') return 'trapdoor';
  if (d.shape === 'ladder' || d.shape === 'wall_torch' || d.shape === 'button' || d.shape === 'wall_sign') return 'wall';
  if (d.shape === 'bed') return 'bed';
  if (d.shape === 'gate' || d.shape === 'chest' || d.shape === 'anvil' || d.shape === 'campfire' || d.shape === 'lectern' || d.shape === 'grindstone' || d.orient === 'horizontal') return 'facing';
  if (d.orient === 'facing' || d.shape === 'hopper') return 'facing6';
  if (d.orient === 'axis' || d.log) return 'axis';
  return '';
}
// the face of a cell a wall block hangs from, given the way it faces (it hangs on the block behind it)
const HANG = [4, 1, 5, 0];         // facing north hangs on the south face (+z), east on the west (-x)...

/* ============================================================== Piece == */
export class Piece {
  constructor(type, depth, box) {
    this.type = type;
    this.depth = depth;
    this.box = box;
    this.dir = null;
    this.mirror = 0;      // 0 none, 1 left-right (north and south swap), 2 front-back
    this.rot = 0;         // quarter turns clockwise
  }
  setOrientation(dir) {
    this.dir = dir;
    if (dir === null) { this.rot = 0; this.mirror = 0; return; }
    switch (dir) {
      case SOUTH: this.mirror = 1; this.rot = 0; break;
      case WEST: this.mirror = 1; this.rot = 1; break;
      case EAST: this.mirror = 0; this.rot = 1; break;
      default: this.mirror = 0; this.rot = 0;
    }
  }
  wx(x, z) {
    switch (this.dir) {
      case NORTH: case SOUTH: return this.box.x0 + x;
      case WEST: return this.box.x1 - z;
      case EAST: return this.box.x0 + z;
      default: return x;
    }
  }
  wy(y) { return this.dir === null ? y : y + this.box.y0; }
  wz(x, z) {
    switch (this.dir) {
      case NORTH: return this.box.z1 - z;
      case SOUTH: return this.box.z0 + z;
      case WEST: case EAST: return this.box.z0 + x;
      default: return z;
    }
  }
  // a direction in the piece's frame, turned into the world's
  face(f) {
    if (this.mirror === 1 && (f === NORTH || f === SOUTH)) f = opposite(f);
    else if (this.mirror === 2 && (f === EAST || f === WEST)) f = opposite(f);
    return (f + this.rot) & 3;
  }
  // a block's meta, from its state in the piece's frame: { f: facing, top: upper half / upside down, axis: 'x'|'y'|'z', ... }
  metaOf(b, s) {
    if (!s) return 0;
    if (typeof s === 'number') return s;
    const k = kindOf(b);
    const f = s.f !== undefined ? this.face(s.f) : 0;
    switch (k) {
      case 'stairs': return f | (s.top ? 4 : 0);
      case 'door': return f | (s.open ? 4 : 0) | (s.upper ? 8 : 0) | (s.right ? 16 : 0);
      case 'trapdoor': return f | (s.open ? 4 : 0) | (s.top ? 8 : 0);
      case 'wall': return s.floor ? 3 : HANG[f];
      case 'bed': return f | (s.head ? 8 : 0);
      case 'facing': return f | (s.eye ? 4 : 0);
      case 'facing6': return s.up ? 4 : s.down ? 5 : f;
      case 'axis': {
        if (!s.axis || s.axis === 'y') return 0;
        const ax = s.axis === 'x' ? 1 : 2;
        return this.rot & 1 ? 3 - ax : ax;
      }
    }
    if (s.slab !== undefined) return s.slab;
    return s.m || 0;
  }

  /* ---- writing, in the piece's frame, clipped to the chunk ---- */
  get(w, x, y, z, cb) {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    return cb.inside(X, Y, Z) ? w.get(X, Y, Z) : 0;
  }
  put(w, name, x, y, z, cb, state) {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    if (!cb.inside(X, Y, Z)) return;
    if (w.protected(X, Y, Z)) return;
    const b = typeof name === 'number' ? name : id(name);
    w.set(X, Y, Z, b, this.metaOf(b, state));
  }
  // generateBox with an edge and an inside block; skipAir leaves open air (caves) alone
  fill(w, cb, x0, y0, z0, x1, y1, z1, edge, inner, skipAir, state) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (skipAir && this.get(w, x, y, z, cb) === 0) continue;
      const e = y === y0 || y === y1 || x === x0 || x === x1 || z === z0 || z === z1;
      this.put(w, e ? edge : inner, x, y, z, cb, state);
    }
  }
  box1(w, cb, x0, y0, z0, x1, y1, z1, name, state) { this.fill(w, cb, x0, y0, z0, x1, y1, z1, name, name, false, state); }
  air(w, cb, x0, y0, z0, x1, y1, z1) { this.fill(w, cb, x0, y0, z0, x1, y1, z1, 'air', 'air', false); }
  // generateBox with a block selector (the stronghold's mix of cracked, mossy and infested bricks)
  fillSel(w, cb, x0, y0, z0, x1, y1, z1, skipAir, rand, sel) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (skipAir && this.get(w, x, y, z, cb) === 0) continue;
      this.put(w, sel(rand, y === y0 || y === y1 || x === x0 || x === x1 || z === z0 || z === z1), x, y, z, cb);
    }
  }
  maybe(w, cb, rand, p, x, y, z, name, state) {
    if (cb.inside(this.wx(x, z), this.wy(y), this.wz(x, z)) && rand.nextFloat() < p) this.put(w, name, x, y, z, cb, state);
  }
  // generateMaybeBox
  maybeFill(w, cb, rand, p, x0, y0, z0, x1, y1, z1, edge, inner, skipAir, needNonAir) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      if (rand.nextFloat() > p) continue;
      if (skipAir && this.get(w, x, y, z, cb) === 0) continue;
      if (needNonAir && !this.isInterior(w, x, y, z, cb)) continue;
      const e = y === y0 || y === y1 || x === x0 || x === x1 || z === z0 || z === z1;
      this.put(w, e ? edge : inner, x, y, z, cb);
    }
  }
  isInterior(w, x, y, z, cb) {
    const X = this.wx(x, z), Y = this.wy(y + 1), Z = this.wz(x, z);
    return cb.inside(X, Y, Z) && Y < w.surface(X, Z);
  }
  // fill down from a point until something solid (the legs under a bridge)
  column(w, name, x, y, z, cb) {
    const X = this.wx(x, z), Z = this.wz(x, z);
    let Y = this.wy(y);
    if (!cb.inside(X, Y, Z)) return;
    const b = id(name);
    while (Y > w.minY + 1) {
      const c = w.get(X, Y, Z);
      if (c && !BLOCKS[c].fluid && !BLOCKS[c].replaceable) break;
      w.set(X, Y, Z, b, 0);
      Y--;
    }
  }
  chest(w, cb, rand, x, y, z, table, facing) {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    if (!cb.inside(X, Y, Z) || w.get(X, Y, Z) === id('chest')) return false;
    // face away from a wall, as the game's reorient does
    let f = facing === undefined ? -1 : this.face(facing);
    if (f < 0) {
      for (const d of HORIZONTAL) { const nb = w.get(X + DX[d], Y, Z + DZ[d]); if (nb && BLOCKS[nb].solid && BLOCKS[nb].shape === 'cube') { f = opposite(d); } }
      if (f < 0) f = SOUTH;
    }
    w.set(X, Y, Z, id('chest'), f);
    // the loot seed, as the game's createChest draws it (a long, kept as text)
    w.chest(X, Y, Z, table, String(rand.nextLong()));
    return true;
  }
  spawner(w, cb, x, y, z, mob) {
    const X = this.wx(x, z), Y = this.wy(y), Z = this.wz(x, z);
    if (!cb.inside(X, Y, Z)) return false;
    w.set(X, Y, Z, id('spawner'), 0);
    w.spawner(X, Y, Z, mob);
    return true;
  }
  worldPos(x, y, z) { return [this.wx(x, z), this.wy(y), this.wz(x, z)]; }
}

/* ======================================================= ChunkWriter ==
   The chunk being generated, in world coordinates (y from -64), plus what
   the structures leave in it for the game: chests to fill and spawners. */
export class ChunkWriter {
  constructor(blocks, meta, cx, cz) {
    this.blocks = blocks; this.meta = meta;
    this.x0 = cx * CH; this.z0 = cz * CH;
    this.minY = Y0; this.maxY = Y0 + H - 1;
    this.box = new Box(this.x0, Y0, this.z0, this.x0 + 15, Y0 + H - 1, this.z0 + 15);
    this.chests = []; this.spawners = []; this.entities = [];
    this.keep = null;            // cells a structure has claimed (spawners, chests, frames are never overwritten)
    this._surf = null;
    this.mask = null;            // when given, every block a structure writes is marked here (the generator's features keep off them)
  }
  get(x, y, z) {
    const lx = x - this.x0, lz = z - this.z0, ly = y - Y0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= H) return 0;
    return this.blocks[idx(lx, ly, lz)];
  }
  getMeta(x, y, z) {
    const lx = x - this.x0, lz = z - this.z0, ly = y - Y0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= H) return 0;
    return this.meta[idx(lx, ly, lz)];
  }
  set(x, y, z, b, m) {
    const lx = x - this.x0, lz = z - this.z0, ly = y - Y0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= H) return;
    const i = idx(lx, ly, lz);
    this.blocks[i] = b; this.meta[i] = m || 0;
    if (this.mask) this.mask[i] = 1;
    if (b === SPAWNER || b === CHEST || b === FRAME || b === BEDROCK) (this.keep || (this.keep = new Set())).add(i);
    this._surf = null;
  }
  // blocks a later piece may not replace (the game's features_cannot_replace)
  protected(x, y, z) {
    if (!this.keep) return false;
    const lx = x - this.x0, lz = z - this.z0, ly = y - Y0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || ly < 0 || ly >= H) return false;
    return this.keep.has(idx(lx, ly, lz));
  }
  chest(x, y, z, table, seed) { this.chests.push({ x, y, z, table, seed }); }
  spawner(x, y, z, mob) {
    for (let i = this.spawners.length - 1; i >= 0; i--) { const s = this.spawners[i]; if (s.x === x && s.y === y && s.z === z) this.spawners.splice(i, 1); }
    this.spawners.push({ x, y, z, mob });
  }
  entity(type, x, y, z, data) { this.entities.push(Object.assign({ type, x, y, z }, data || {})); }
  // the y just above the highest solid block in a column of this chunk (for "is this underground")
  surface(x, z) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return this.maxY;
    for (let ly = H - 1; ly >= 0; ly--) {
      const b = this.blocks[idx(lx, ly, lz)];
      if (b && BLOCKS[b].solid) return ly + Y0 + 1;
    }
    return this.minY;
  }
  // the highest block of any kind (WORLD_SURFACE) or solid, non-fluid (OCEAN_FLOOR) in a column
  top(x, z, floor) {
    const lx = x - this.x0, lz = z - this.z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15) return null;
    for (let ly = H - 1; ly >= 0; ly--) {
      const b = this.blocks[idx(lx, ly, lz)];
      if (!b) continue;
      const d = BLOCKS[b];
      if (floor ? d.solid && !d.fluid && !d.leaves && !d.log : !(d.shape === 'cross' || d.leaves || d.log)) return ly + Y0;
    }
    return this.minY;
  }
}
const SPAWNER = B.spawner, CHEST = B.chest, FRAME = B.end_portal_frame, BEDROCK = B.bedrock;
