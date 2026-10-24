/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: our own designs.

   The game builds villages, temples, outposts, bastions, end cities and the
   rest from saved templates. Those files are Mojang's, so none of them are
   used: each structure here is drawn by a small function of ours with the
   same size, materials and layout, so it reads as the same place.

   A Build is one box of such a design, in a plain frame: x across (0..w-1),
   z deep (0..d-1), y up (0..h-1), origin at the box's corner, turned a
   number of quarter turns clockwise (seen from above) about its footprint.
   Facings in the frame: NORTH is -z, EAST +x, SOUTH +z, WEST -x.

   draw(g) gets a pen in that frame:
     g.set(x, y, z, name, state)       one block (state: { f, top, upper, open, right, axis, slab, eye, floor, m })
     g.fill(x0, y0, z0, x1, y1, z1, name, state)   a solid box
     g.hollow(x0, y0, z0, x1, y1, z1, wall, inside) walls of one block, inside (default air)
     g.air(x0, y0, z0, x1, y1, z1)
     g.get(x, y, z)                    the block id there now (0 = air)
     g.is(x, y, z, name)
     g.down(x, y, z, name)             fill from y down to the first solid block (foundations, legs)
     g.chest(x, y, z, lootTable, f)    a chest with loot (f: the way its front faces)
     g.barrel(x, y, z, lootTable)      a barrel with loot
     g.spawner(x, y, z, mob)
     g.entity(type, x, y, z, data)     an entity to make once the mobs exist (villagers, golems...)
     g.r                               a random (JRand) for small choices: the same for every chunk the box crosses
     g.w, g.h, g.d                     the box size
   Everything outside the chunk being generated is skipped quietly.
--------------------------------------------------------------------------- */
import { Box, Piece, NORTH, EAST, SOUTH, WEST, id } from './piece.js?v=107';
import { JRand, hash32 } from './rand.js?v=107';
import { B, BLOCKS } from '../blocks.js?v=107';

export { NORTH, EAST, SOUTH, WEST };

export class Build extends Piece {
  // x0, y0, z0: the world corner the turned box starts at (its smallest x and z); w, h, d: the size before turning
  constructor(type, x0, y0, z0, w, h, d, rot, draw, opts) {
    rot &= 3;
    const W = rot & 1 ? d : w, D = rot & 1 ? w : d;
    super(type, 0, new Box(x0, y0, z0, x0 + W - 1, y0 + h - 1, z0 + D - 1));
    this.w = w; this.h = h; this.d = d;
    this.rot = rot; this.mirror = 0; this.dir = -1;
    this.draw = draw;
    this.opts = opts || {};
    this.seed = hash32(x0, y0, z0, w * 131 + h * 7 + d, rot);
  }
  wx(x, z) {
    const b = this.box;
    switch (this.rot) { case 1: return b.x0 + (this.d - 1 - z); case 2: return b.x0 + (this.w - 1 - x); case 3: return b.x0 + z; default: return b.x0 + x; }
  }
  wy(y) { return this.box.y0 + y; }
  wz(x, z) {
    const b = this.box;
    switch (this.rot) { case 1: return b.z0 + x; case 2: return b.z0 + (this.d - 1 - z); case 3: return b.z0 + (this.w - 1 - x); default: return b.z0 + z; }
  }
  face(f) { return (f + this.rot) & 3; }
  place(w, cb) {
    const r = new JRand(BigInt(this.seed));
    this.draw(new Pen(this, w, cb, r), this.opts);
  }
}

class Pen {
  constructor(p, w, cb, r) { this.p = p; this.wr = w; this.cb = cb; this.r = r; this.w = p.w; this.h = p.h; this.d = p.d; }
  set(x, y, z, name, state) { this.p.put(this.wr, name, x, y, z, this.cb, state); }
  fill(x0, y0, z0, x1, y1, z1, name, state) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) this.p.put(this.wr, name, x, y, z, this.cb, state);
  }
  hollow(x0, y0, z0, x1, y1, z1, wall, inside) { this.p.fill(this.wr, this.cb, x0, y0, z0, x1, y1, z1, wall, inside || 'air', false); }
  air(x0, y0, z0, x1, y1, z1) { this.fill(x0, y0, z0, x1, y1, z1, 'air'); }
  get(x, y, z) { return this.p.get(this.wr, x, y, z, this.cb); }
  is(x, y, z, name) { return this.get(x, y, z) === id(name); }
  inside(x, y, z) { return this.cb.inside(this.p.wx(x, z), this.p.wy(y), this.p.wz(x, z)); }
  down(x, y, z, name) { this.p.column(this.wr, name, x, y, z, this.cb); }
  // each chest draws its loot seed from a random of its own place, so two chests of one design never hold the same
  // (the pen's random starts again in every chunk the box crosses)
  chest(x, y, z, table, f) { return this.p.chest(this.wr, this.cb, this.own(x, y, z), x, y, z, table, f); }
  own(x, y, z) { return new JRand(BigInt(hash32(this.p.seed, this.p.wx(x, z), this.p.wy(y), this.p.wz(x, z)))); }
  barrel(x, y, z, table) {
    const X = this.p.wx(x, z), Y = this.p.wy(y), Z = this.p.wz(x, z);
    if (!this.cb.inside(X, Y, Z)) return false;
    this.wr.set(X, Y, Z, id('barrel'), 4);
    this.wr.chest(X, Y, Z, table, String(this.own(x, y, z).nextLong()));
    return true;
  }
  spawner(x, y, z, mob) { return this.p.spawner(this.wr, this.cb, x, y, z, mob); }
  entity(type, x, y, z, data) {
    const X = this.p.wx(x, z), Y = this.p.wy(y), Z = this.p.wz(x, z);
    if (this.cb.inside(X, Y, Z)) this.wr.entity(type, X + 0.5, Y, Z + 0.5, data);
  }
  // the world position of a frame cell (for things that need it)
  world(x, y, z) { return [this.p.wx(x, z), this.p.wy(y), this.p.wz(x, z)]; }
}
