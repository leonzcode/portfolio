/* ---------------------------------------------------------------------------
   Leoncraft 2 - the world as the mobs see it.

   Blocks, light and collision boxes, looked up without making garbage: the
   last chunk asked for is remembered (most lookups in a row land in the same
   one), so a mob walking about costs no strings and no objects.

   Light comes from the mesher: each meshed chunk keeps its sky and block
   light (sky * 16 + block). A chunk loaded but not meshed (beyond the render
   distance) has none, so it is estimated: open sky above is 15, anything
   else 0, and no block light.

   Collision is the player's (player.js), for a box of any size: every solid
   box near the move is gathered into one flat array, and the move is cut
   short along y, then x, then z, at the first one in the way; walking into
   something no higher than the step lifts the box onto it.
--------------------------------------------------------------------------- */
import { BLOCKS, SOLID, FLUID, OPACITY, B } from '../blocks.js?v=107';
import { collisionBoxes } from '../models.js?v=107';
import { H } from '../world-const.js?v=107';

const EPS = 1e-7;
// full solid cubes, which a box can rest on without looking at shapes
const FULL = new Uint8Array(4096);
for (const d of BLOCKS) if (d && d.solid && d.shape === 'cube' && d.name !== 'honey_block') FULL[d.id] = 1;
// a honey block is a sixteenth in from each side and 15/16 tall for mobs too (models.js collisionBoxes)
const HONEY = B.honey_block;

export class Terrain {
  constructor(world) {
    this.w = world;
    this.lcx = 1e9; this.lcz = 1e9; this.lc = null;
    this.bx = new Float64Array(6 * 512); this.nb = 0;     // gathered boxes
    // a neighbour lookup for shaped blocks (fences join, stairs turn), reused
    this.nbx = 0; this.nby = 0; this.nbz = 0;
    this.nbFn = (dx, dy, dz) => {
      const b = this.get(this.nbx + dx, this.nby + dy, this.nbz + dz);
      return b ? { d: BLOCKS[b], m: this.meta(this.nbx + dx, this.nby + dy, this.nbz + dz) } : null;
    };
    this.out = [0, 0, 0];
    // solid entities (boats: the manager keeps the list), and the one moving now, which does not meet itself
    this.solids = null; this.mover = null; this.except = null;
  }
  // forget the remembered chunk (chunks come and go between ticks)
  reset() { this.lcx = 1e9; this.lc = null; }
  chunk(x, z) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    if (cx === this.lcx && cz === this.lcz) return this.lc;
    this.lcx = cx; this.lcz = cz;
    this.lc = (this.w.chunkXZ ? this.w.chunkXZ(cx, cz) : this.w.chunks.get(cx + ',' + cz)) || null;
    return this.lc;
  }
  loaded(x, z) { return !!this.chunk(x, z); }
  get(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunk(x, z);
    if (!c) return 0;
    return c.blocks[(y << 8) | ((z - c.cz * 16) << 4) | (x - c.cx * 16)];
  }
  meta(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunk(x, z);
    if (!c) return 0;
    return c.meta[(y << 8) | ((z - c.cz * 16) << 4) | (x - c.cx * 16)];
  }
  // sky light 0..15 at a block
  sky(x, y, z) {
    if (y >= H) return 15;
    if (y < 0) return 0;
    const c = this.chunk(x, z);
    if (!c) return 15;
    const lx = x - c.cx * 16, lz = z - c.cz * 16;
    if (c.light) return y >= c.lightH ? 15 : c.light[(y << 8) | (lz << 4) | lx] >> 4;
    // not meshed: open to the sky or not
    for (let yy = y + 1; yy <= c.top; yy++) if (OPACITY[c.blocks[(yy << 8) | (lz << 4) | lx]] >= 15) return 0;
    return 15;
  }
  block(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const c = this.chunk(x, z);
    if (!c || !c.light || y >= c.lightH) return 0;
    return c.light[(y << 8) | ((z - c.cz * 16) << 4) | (x - c.cx * 16)] & 15;
  }
  // the highest block that is not air in a column, +1 (Minecraft's WORLD_SURFACE heightmap)
  surface(x, z) {
    const c = this.chunk(x, z);
    if (!c) return -1;
    const lx = x - c.cx * 16, lz = z - c.cz * 16;
    for (let y = Math.min(H - 1, c.top + 1); y >= 0; y--) if (c.blocks[(y << 8) | (lz << 4) | lx]) return y + 1;
    return 0;
  }
  // the highest block that blocks motion or is fluid, +1 (MOTION_BLOCKING)
  motionTop(x, z) {
    const c = this.chunk(x, z);
    if (!c) return -1;
    const lx = x - c.cx * 16, lz = z - c.cz * 16;
    for (let y = Math.min(H - 1, c.top + 1); y >= 0; y--) { const b = c.blocks[(y << 8) | (lz << 4) | lx]; if (b && (SOLID[b] || FLUID[b])) return y + 1; }
    return 0;
  }
  fluid(x, y, z) { return FLUID[this.get(x, y, z)]; }
  // the surface height of the water in a cell (1 for a source or falling water, less for flowing)
  fluidHeight(x, y, z) {
    const b = this.get(x, y, z);
    if (!FLUID[b]) return 0;
    if (FLUID[this.get(x, y + 1, z)] === FLUID[b]) return 1;
    const m = this.meta(x, y, z);
    if (m & 8) return 1;
    return (8 - (m & 7)) / 9;
  }
  slip(x, y, z) {
    const b = this.get(x, y, z);
    return (BLOCKS[b] && BLOCKS[b].slippery) || 0.6;
  }
  solid(x, y, z) { return SOLID[this.get(x, y, z)] === 1; }

  /* ---- collision ---- */
  // every solid box overlapping a region, into this.bx (this.nb of them)
  gather(x0, y0, z0, x1, y1, z1) {
    let n = 0, bx = this.bx;
    const push = (a, b, c, d, e, f) => {
      if (n * 6 + 6 > bx.length) { const g = new Float64Array(bx.length * 2); g.set(bx); this.bx = bx = g; }
      const o = n * 6; bx[o] = a; bx[o + 1] = b; bx[o + 2] = c; bx[o + 3] = d; bx[o + 4] = e; bx[o + 5] = f; n++;
    };
    const X0 = Math.floor(x0), X1 = Math.floor(x1), Z0 = Math.floor(z0), Z1 = Math.floor(z1);
    const Y0 = Math.floor(y0) - 1, Y1 = Math.floor(y1);
    for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
      const c = this.chunk(x, z);
      if (!c) { push(x, Y0, z, x + 1, Y1 + 1, z + 1); continue; }    // the edge of the loaded world is a wall
      const lx = x - c.cx * 16, lz = z - c.cz * 16;
      for (let y = Math.max(0, Y0); y <= Y1 && y < H; y++) {
        const b = c.blocks[(y << 8) | (lz << 4) | lx];
        if (!b || !SOLID[b]) continue;
        const d = BLOCKS[b];
        if (d.shape === 'cube' && b !== HONEY) { push(x, y, z, x + 1, y + 1, z + 1); continue; }
        this.nbx = x; this.nby = y; this.nbz = z;
        const boxes = collisionBoxes(d, c.meta[(y << 8) | (lz << 4) | lx], this.nbFn, x, z);
        if (boxes) for (const q of boxes) push(x + q[0], y + q[1], z + q[2], x + q[3], y + q[4], z + q[5]);
      }
    }
    /* boats are solid: stood on and walked into by everything but themselves,
       what rides them and what they ride */
    const S = this.solids, mv = this.mover;
    if (S && S.length) for (let i = 0; i < S.length; i++) {
      const e = S[i];
      if (e.removed || e === mv || e === this.except || (mv && (mv.vehicle === e || e.vehicle === mv))) continue;
      const p = e.pos;
      if (p.x + e.hw < x0 || p.x - e.hw > x1 + 1 || p.z + e.hw < z0 || p.z - e.hw > z1 + 1 || p.y + e.h < y0 - 1 || p.y > y1 + 1) continue;
      push(p.x - e.hw, p.y, p.z - e.hw, p.x + e.hw, p.y + e.h, p.z + e.hw);
    }
    this.nb = n;
    return n;
  }
  // feet exactly on top of full cubes under every corner (the common case of a mob at rest)
  restsOn(x, y, z, hw) {
    if (y !== Math.floor(y)) return false;
    const by = y - 1;
    const a = this.get(Math.floor(x - hw), by, Math.floor(z - hw)), b = this.get(Math.floor(x + hw - 1e-6), by, Math.floor(z - hw));
    const c = this.get(Math.floor(x - hw), by, Math.floor(z + hw - 1e-6)), d = this.get(Math.floor(x + hw - 1e-6), by, Math.floor(z + hw - 1e-6));
    return FULL[a] === 1 && FULL[b] === 1 && FULL[c] === 1 && FULL[d] === 1 && this.loaded(x, z);
  }
  // how far a box can go along one axis before a gathered box stops it
  clip(axis, d, x0, y0, z0, x1, y1, z1) {
    if (d === 0) return 0;
    const bx = this.bx, n = this.nb;
    const lo0 = axis === 0 ? x0 : axis === 1 ? y0 : z0, hi0 = axis === 0 ? x1 : axis === 1 ? y1 : z1;
    // the other two axes
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    const lo1 = a1 === 0 ? x0 : a1 === 1 ? y0 : z0, hi1 = a1 === 0 ? x1 : a1 === 1 ? y1 : z1;
    const lo2 = a2 === 0 ? x0 : a2 === 1 ? y0 : z0, hi2 = a2 === 0 ? x1 : a2 === 1 ? y1 : z1;
    for (let i = 0; i < n * 6; i += 6) {
      if (bx[i + a1 + 3] <= lo1 + EPS || bx[i + a1] >= hi1 - EPS) continue;
      if (bx[i + a2 + 3] <= lo2 + EPS || bx[i + a2] >= hi2 - EPS) continue;
      if (d > 0 && bx[i + axis] >= hi0 - EPS) d = Math.min(d, bx[i + axis] - hi0);
      else if (d < 0 && bx[i + axis + 3] <= lo0 + EPS) d = Math.max(d, bx[i + axis + 3] - lo0);
    }
    return d;
  }
  // does a box overlap anything solid?
  boxHits(x0, y0, z0, x1, y1, z1, except) {
    this.except = except || null;
    const n = this.gather(x0, y0, z0, x1, y1, z1), bx = this.bx;
    this.except = null;
    for (let i = 0; i < n * 6; i += 6)
      if (bx[i] < x1 - EPS && bx[i + 3] > x0 + EPS && bx[i + 1] < y1 - EPS && bx[i + 4] > y0 + EPS && bx[i + 2] < z1 - EPS && bx[i + 5] > z0 + EPS) return true;
    return false;
  }
  // any fluid (1 water, 2 lava) in a box?
  boxFluid(x0, y0, z0, x1, y1, z1, kind) {
    for (let y = Math.floor(y0); y <= Math.floor(y1 - EPS); y++)
      for (let z = Math.floor(z0); z <= Math.floor(z1 - EPS); z++)
        for (let x = Math.floor(x0); x <= Math.floor(x1 - EPS); x++) {
          const f = FLUID[this.get(x, y, z)] || (kind === 1 && BLOCKS[this.get(x, y, z)] && BLOCKS[this.get(x, y, z)].waterlogged ? 1 : 0);
          if (f === kind && y + this.fluidHeight(x, y, z) > y0) return true;
        }
    return false;
  }
  /* How deep in a fluid a box is: the highest fluid surface over its
     footprint, less its feet (0 when it is in none). */
  fluidDepth(x0, y0, z0, x1, y1, z1, kind) {
    let best = 0;
    for (let z = Math.floor(z0); z <= Math.floor(z1 - EPS); z++)
      for (let x = Math.floor(x0); x <= Math.floor(x1 - EPS); x++)
        for (let y = Math.floor(y0); y <= Math.floor(y1 - EPS) + 1; y++) {
          const b = this.get(x, y, z);
          if (FLUID[b] !== kind && !(kind === 1 && BLOCKS[b] && BLOCKS[b].waterlogged)) continue;
          const top = y + (FLUID[b] ? this.fluidHeight(x, y, z) : 1);
          if (top > y0 && top - y0 > best) best = top - y0;
        }
    return best;
  }

  /* Move a box (feet centre px, py, pz, half width hw, height h) by d, as the
     game does: y, x, z, then a step up and back down if that gets further.
     Returns the move made in this.out, and fills e's collision flags. */
  move(e, dx, dy, dz) {
    this.mover = e;
    const o = this.moveBox(e, dx, dy, dz);
    this.mover = null;
    return o;
  }
  moveBox(e, dx, dy, dz) {
    const hw = e.hw, h = e.h, p = e.pos, step = e.stepH;
    // standing still on full blocks: nothing to work out
    if (dx === 0 && dz === 0 && dy <= 0 && dy > -0.2 && e.onGround && this.restsOn(p.x, p.y, p.z, hw)) {
      e.hCollide = false; e.vCollide = dy !== 0; if (dy !== 0) e.vel.y = 0;
      const o = this.out; o[0] = 0; o[1] = 0; o[2] = 0;
      return o;
    }
    // the boxes the move could meet: the box swept by the move, and lifted by a step
    this.gather(p.x - hw + Math.min(0, dx) - 0.01, p.y + Math.min(0, dy) - 0.01, p.z - hw + Math.min(0, dz) - 0.01,
      p.x + hw + Math.max(0, dx) + 0.01, p.y + h + Math.max(0, dy) + step + 0.01, p.z + hw + Math.max(0, dz) + 0.01);
    let x0 = p.x - hw, y0 = p.y, z0 = p.z - hw, x1 = p.x + hw, y1 = p.y + h, z1 = p.z + hw;
    const my = this.clip(1, dy, x0, y0, z0, x1, y1, z1); y0 += my; y1 += my;
    // the larger horizontal move first, as the game does
    let mx, mz;
    if (Math.abs(dx) < Math.abs(dz)) {
      mz = this.clip(2, dz, x0, y0, z0, x1, y1, z1); z0 += mz; z1 += mz;
      mx = this.clip(0, dx, x0, y0, z0, x1, y1, z1); x0 += mx; x1 += mx;
    } else {
      mx = this.clip(0, dx, x0, y0, z0, x1, y1, z1); x0 += mx; x1 += mx;
      mz = this.clip(2, dz, x0, y0, z0, x1, y1, z1); z0 += mz; z1 += mz;
    }
    let fy = my;
    const landed = dy < 0 && my !== dy;
    if (e.stepH > 0 && (e.onGround || landed) && (mx !== dx || mz !== dz)) {
      // try the same move lifted by a step
      const up = this.clip(1, e.stepH, p.x - hw, p.y, p.z - hw, p.x + hw, p.y + h, p.z + hw);
      let sx0 = p.x - hw, sy0 = p.y + up, sz0 = p.z - hw, sx1 = p.x + hw, sy1 = p.y + up + h, sz1 = p.z + hw;
      const sx = this.clip(0, dx, sx0, sy0, sz0, sx1, sy1, sz1); sx0 += sx; sx1 += sx;
      const sz = this.clip(2, dz, sx0, sy0, sz0, sx1, sy1, sz1); sz0 += sz; sz1 += sz;
      if (sx * sx + sz * sz > mx * mx + mz * mz + 1e-9) {
        const down = this.clip(1, -up, sx0, sy0, sz0, sx1, sy1, sz1);
        mx = sx; mz = sz; fy = up + down;
      }
    }
    p.x += mx; p.y += fy; p.z += mz;
    e.hCollide = mx !== dx || mz !== dz;
    e.vCollide = fy !== dy && !(fy > 0 && dy <= 0);
    if (fy !== dy) { if (dy < 0) e.onGround = true; e.vel.y = 0; }
    else if (dy !== 0) e.onGround = false;
    if (mx !== dx) e.vel.x = 0;
    if (mz !== dz) e.vel.z = 0;
    const o = this.out; o[0] = mx; o[1] = fy; o[2] = mz;
    return o;
  }

  /* A ray through the blocks (a voxel walk, then the shaped blocks' boxes).
     Returns the distance to the first solid block, or max. Used for arrows,
     line of sight and explosions. */
  ray(ox, oy, oz, dx, dy, dz, max, hitFluid) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
    let tx = dx ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
    let ty = dy ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
    let tz = dz ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
    let t = 0;
    this.rayFace = -1;
    for (let n = 0; n < 512 && t <= max; n++) {
      const b = this.get(x, y, z);
      if (b && (SOLID[b] || (hitFluid && FLUID[b]))) {
        const d = BLOCKS[b];
        if (d.shape === 'cube' || FLUID[b]) { this.rayX = x; this.rayY = y; this.rayZ = z; return t; }
        this.nbx = x; this.nby = y; this.nbz = z;
        const boxes = collisionBoxes(d, this.meta(x, y, z), this.nbFn, x, z);
        if (boxes) {
          let best = Infinity;
          for (const q of boxes) {
            const tt = rayBox(ox, oy, oz, dx, dy, dz, x + q[0], y + q[1], z + q[2], x + q[3], y + q[4], z + q[5]);
            if (tt < best) best = tt;
          }
          if (best <= max) { this.rayX = x; this.rayY = y; this.rayZ = z; return best; }
        }
      }
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; this.rayFace = sx > 0 ? 1 : 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; this.rayFace = sy > 0 ? 3 : 2; }
      else { z += sz; t = tz; tz += tdz; this.rayFace = sz > 0 ? 5 : 4; }
    }
    return max;
  }
  // can a point see another (nothing solid between)?
  sees(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l = Math.hypot(dx, dy, dz);
    if (l < 1e-6) return true;
    return this.ray(ax, ay, az, dx / l, dy / l, dz / l, l) >= l - 1e-4;
  }
}

// the distance along a ray (unit direction) to where it enters a box, or Infinity
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = Infinity;
  if (Math.abs(dx) < 1e-12) { if (ox < x0 || ox > x1) return Infinity; }
  else { let a = (x0 - ox) / dx, b = (x1 - ox) / dx; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return Infinity; }
  if (Math.abs(dy) < 1e-12) { if (oy < y0 || oy > y1) return Infinity; }
  else { let a = (y0 - oy) / dy, b = (y1 - oy) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return Infinity; }
  if (Math.abs(dz) < 1e-12) { if (oz < z0 || oz > z1) return Infinity; }
  else { let a = (z0 - oz) / dz, b = (z1 - oz) / dz; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return Infinity; }
  return t0;
}

/* Blast resistance, from the Minecraft Wiki's block pages. Blocks not named
   here take their hardness (which is what most blocks have). */
const BLAST = {
  stone: 6, cobblestone: 6, mossy_cobblestone: 6, stone_bricks: 6, mossy_stone_bricks: 6, cracked_stone_bricks: 6, chiseled_stone_bricks: 6,
  smooth_stone: 6, bricks: 6, granite: 6, polished_granite: 6, diorite: 6, polished_diorite: 6, andesite: 6, polished_andesite: 6,
  deepslate: 6, cobbled_deepslate: 6, polished_deepslate: 6, deepslate_bricks: 6, deepslate_tiles: 6, tuff: 6, calcite: 0.75,
  blackstone: 6, basalt: 4.2, smooth_basalt: 4.2, end_stone: 9, netherrack: 0.4, terracotta: 4.2, prismarine: 6,
  obsidian: 1200, crying_obsidian: 1200, ancient_debris: 1200, netherite_block: 1200, respawn_anchor: 1200, enchanting_table: 1200,
  anvil: 1200, reinforced_deepslate: 1200, ender_chest: 600, bedrock: 3600000, barrier: 3600000, end_portal_frame: 3600000,
  command_block: 3600000, water: 100, lava: 100, iron_block: 6, gold_block: 6, diamond_block: 6, emerald_block: 6, lapis_block: 3,
  coal_block: 6, copper_block: 6, oak_planks: 3, iron_door: 5, iron_bars: 6, iron_trapdoor: 5, chest: 2.5, furnace: 3.5,
};
const BLAST_TABLE = new Float32Array(4096).fill(-1);
export function blastResistance(b) {
  if (BLAST_TABLE[b] >= 0) return BLAST_TABLE[b];
  const d = BLOCKS[b];
  let r = 0;
  if (d) {
    const n = d.name;
    if (BLAST[n] !== undefined) r = BLAST[n];
    else if (/_planks$|_fence$|_fence_gate$|_door$|_trapdoor$|_stairs$|_slab$/.test(n) && /oak|spruce|birch|jungle|acacia|cherry|mangrove|bamboo|crimson|warped/.test(n)) r = 3;
    else if (/(stone|brick|deepslate|blackstone|tuff|andesite|diorite|granite|cobble|prismarine|purpur|quartz_bricks)/.test(n) && !/ore|button|plate|redstone/.test(n)) r = 6;
    else if (/terracotta/.test(n)) r = 4.2;
    else if (/_ore$/.test(n)) r = 3;
    else r = d.hardness < 0 ? 3600000 : (d.hardness || 0);
  }
  BLAST_TABLE[b] = r;
  return r;
}
