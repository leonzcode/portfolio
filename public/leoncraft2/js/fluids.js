/* ---------------------------------------------------------------------------
   Leoncraft 2 - water and lava that flow, by Minecraft's rules.

   A fluid cell is a source (level 0) or flowing (levels 1-7, how far from
   its source), or falling (a column pouring down). Every 5 ticks for water
   and 30 for lava (10 in the Nether, where lava also runs as far as water),
   cells that might change are looked at:

     - a flowing cell takes its level from its highest neighbour (one more
       than it; two more for lava), turns to a source if two sources flank it
       over something solid (water only), and dries up if nothing feeds it;
     - it pours down if it can; if it cannot, it spreads sideways, towards the
       nearest place within reach it could fall (as the game looks for a
       slope), or every way when there is none;
     - lava and water meeting make obsidian, cobblestone or stone;
     - flowing into a torch, redstone dust or a plant that does not stand in
       water washes it away: water drops it as an item, lava just burns it.

   Generated water sits still until something next to it changes, as in the
   game. Cells are looked at only when a neighbour changes, so a still sea
   costs nothing.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID, SOLID } from './blocks.js?v=107';
import { LEVEL, FALLING } from './world-const.js?v=107';
import { blockDrops } from './loot.js?v=107';
import { dropStack } from './drops.js?v=107';

// what a flow washes away (the game's: no collision, not a door, sign, ladder, sugar cane or a block that holds water)
const WASH = new Uint8Array(4096);
for (const d of BLOCKS) {
  if (!d || d.solid || d.fluid || d.waterlogged) continue;
  if (/coral|dripstone|amethyst|sea_pickle|kelp|seagrass|sugar_cane|bamboo|cobweb|cocoa|vines|roots|dripleaf|spore_blossom|hanging_moss|_portal$|^fire$|^soul_fire$/.test(d.name)) continue;
  if (d.shape === 'torch' || d.shape === 'wall_torch' || d.shape === 'wire' || d.shape === 'crop' || d.shape === 'cross') WASH[d.id] = 1;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Fluids {
  constructor(world, onChange) {
    this.w = world;
    this.onChange = onChange || (() => {});
    this.pending = new Map();         // "x,y,z" -> tick it is due
    this.tick = 0;
  }
  key(x, y, z) { return x + ',' + y + ',' + z; }
  schedule(x, y, z, delay) {
    const k = this.key(x, y, z);
    const at = this.tick + delay;
    const cur = this.pending.get(k);
    if (cur === undefined || cur > at) this.pending.set(k, at);
  }
  // a block changed: it and everything next to it may need a look
  around(x, y, z) {
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const b = this.w.get(x + dx, y + dy, z + dz);
      if (FLUID[b]) this.schedule(x + dx, y + dy, z + dz, FLUID[b] === 2 ? (this.w.dim === 'the_nether' ? 10 : 30) : 5);
    }
  }
  kindAt(x, y, z) { return FLUID[this.w.get(x, y, z)]; }
  isSource(x, y, z, kind) { return this.kindAt(x, y, z) === kind && (this.w.meta(x, y, z) & (LEVEL | FALLING)) === 0; }
  levelOf(x, y, z, kind) {
    // how far from a source, 0 for a source or a falling column
    if (this.kindAt(x, y, z) !== kind) return 99;
    const m = this.w.meta(x, y, z);
    if (m & FALLING) return 0;
    return m & LEVEL;
  }
  open(x, y, z) {
    const b = this.w.get(x, y, z);
    if (!b) return true;
    const d = BLOCKS[b];
    return !d.solid && !d.fluid && (d.replaceable || WASH[b] === 1);
  }
  place(x, y, z, kind, level, falling) {
    const b = kind === 1 ? B.water : B.lava;
    const cur = this.w.get(x, y, z);
    // what flows into lava or water decides what is made
    const other = FLUID[cur];
    if (other && other !== kind) {
      const into = this.w.meta(x, y, z) === 0 ? (other === 2 ? B.obsidian : B.stone) : B.cobblestone;
      this.w.set(x, y, z, into, 0);
      this.onChange(x, y, z, 0);
      return;
    }
    const m = (falling ? FALLING : 0) | (level & LEVEL);
    // a torch or a flower in the way: water drops it as an item (and the top of a tall plant with it)
    if (cur && WASH[cur] && kind === 1) {
      const out = blockDrops(this.w, x, y, z, cur, this.w.meta(x, y, z), { popped: true });
      for (const s of out.items || []) dropStack(x + 0.5, y + 0.25, z + 0.5, s);
      const up = this.w.get(x, y + 1, z), ud = BLOCKS[up];
      if (up && ud && (ud.lower && B[ud.lower] === cur || (BLOCKS[cur].tall && up === cur))) this.w.set(x, y + 1, z, 0, 0);
    }
    if (this.w.set(x, y, z, b, m)) {
      this.onChange(x, y, z, kind);
      this.around(x, y, z);
    }
  }

  step() {
    this.tick++;
    if (!this.pending.size) return;
    const due = [];
    for (const [k, t] of this.pending) if (t <= this.tick) due.push(k);
    if (due.length > 1500) due.length = 1500;        // never too much in one tick
    for (const k of due) this.pending.delete(k);
    for (const k of due) {
      const [x, y, z] = k.split(',').map(Number);
      if (!this.w.loaded(x, z)) continue;
      this.update(x, y, z);
    }
  }

  update(x, y, z) {
    const kind = this.kindAt(x, y, z);
    if (!kind) return;
    // Nether lava drops a level a block and looks four blocks for a slope, as water does
    const far = kind === 1 || this.w.dim === 'the_nether';
    const drop = far ? 1 : 2, reach = far ? 4 : 2, max = far ? 7 : 6;
    let meta = this.w.meta(x, y, z);
    const source = (meta & (LEVEL | FALLING)) === 0;
    // lava meeting water at its side or top
    if (kind === 2) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        if (this.kindAt(x + dx, y + dy, z + dz) === 1) {
          this.w.set(x, y, z, source ? B.obsidian : B.cobblestone, 0);
          this.onChange(x, y, z, 0);
          this.around(x, y, z);
          return;
        }
      }
    }
    if (!source) {
      // where does this cell's level come from now?
      // (the game's order: two sources beside it over something solid or a source make a new source,
      // even under a falling column; then water from above; then one level past its highest neighbour)
      let want, best = 99, sources = 0;
      for (const [dx, dz] of DIRS) {
        const l = this.levelOf(x + dx, y, z + dz, kind);
        if (l < best) best = l;
        if (this.isSource(x + dx, y, z + dz, kind)) sources++;
      }
      const below = this.w.get(x, y - 1, z);
      if (kind === 1 && sources >= 2 && (SOLID[below] || this.isSource(x, y - 1, z, kind))) want = 0;
      else if (this.kindAt(x, y + 1, z) === kind) want = FALLING;
      else want = best + drop <= max ? best + drop : -1;
      if (want === -1) {
        this.w.set(x, y, z, 0, 0);
        this.onChange(x, y, z, 0);
        this.around(x, y, z);
        return;
      }
      if (want !== meta) {
        this.w.set(x, y, z, kind === 1 ? B.water : B.lava, want);
        meta = want;
        this.onChange(x, y, z, kind);
        this.around(x, y, z);
      }
    }
    // pour down if it can
    const level = (meta & FALLING) ? 0 : (meta & LEVEL);
    if (y > 0 && (this.open(x, y - 1, z) || (this.kindAt(x, y - 1, z) && this.kindAt(x, y - 1, z) !== kind))) {
      this.place(x, y - 1, z, kind, 0, true);
      if (!source) return;
    } else if (y > 0 && this.kindAt(x, y - 1, z) === kind && !source) {
      return;                                // already pouring into more of itself (a falling column never spreads over its own pool)
    }
    // otherwise across, towards the nearest way down
    const next = level + drop;
    if (next > max) return;
    const ways = [];
    let bestD = 99;
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!this.open(nx, y, nz) && !(this.kindAt(nx, y, nz) === kind && this.levelOf(nx, y, nz, kind) > next)) continue;
      const d = this.distToDrop(nx, y, nz, reach, -dx, -dz);
      if (d < bestD) { bestD = d; ways.length = 0; }
      if (d === bestD) ways.push([nx, nz]);
    }
    for (const [nx, nz] of ways) this.place(nx, y, nz, kind, next, false);
  }
  // how many steps from here to somewhere it could fall (99 if none in reach)
  distToDrop(x, y, z, reach, fromX, fromZ) {
    if (this.open(x, y - 1, z) || this.kindAt(x, y - 1, z)) return 0;
    let frontier = [[x, z, fromX, fromZ]], seen = new Set([x + ',' + z]);
    for (let d = 1; d <= reach; d++) {
      const nxt = [];
      for (const [cx, cz] of frontier) for (const [dx, dz] of DIRS) {
        const nx = cx + dx, nz = cz + dz, k = nx + ',' + nz;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!this.open(nx, y, nz) && !this.kindAt(nx, y, nz)) continue;
        if (this.open(nx, y - 1, nz) || (this.kindAt(nx, y - 1, nz) && !this.isSource(nx, y - 1, nz, this.kindAt(nx, y - 1, nz)))) return d;
        nxt.push([nx, nz]);
      }
      frontier = nxt;
    }
    return 99;
  }
}
