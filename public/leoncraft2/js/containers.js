/* ---------------------------------------------------------------------------
   Leoncraft 2 - blocks that hold things.

   Each one's contents live here by block position, saved with the world
   (save.js); what they held spills onto the ground when the block goes
   (broken, blown up), except a shulker box, which drops itself with its
   contents inside (the Minecraft Wiki's pages for each block, Java Edition):

     chest, trapped chest,  27 slots; two side by side facing the same way
     copper chests          join into a large chest of 54 when the second is
                            placed (not while sneaking); its top three rows
                            are the half on your left as you face it. A
                            chest under a conductive block will not open.
                            Copper chests join each other whatever their
                            oxidation, never a plain chest.
     barrel                 27 slots, opens whatever is above it
     shulker box            27 slots, keeps them when broken; no shulker box
                            goes inside another
     furnace                input, fuel, output; each recipe's own time (200)
     smoker, blast furnace  their own recipes, 100 ticks, fuel burns twice as fast
     hopper                 5 slots; push, then pull or collect, then 8 ticks of
                            cooldown; a redstone signal locks it
     dispenser, dropper     9 slots; a rising signal fires them 4 ticks later
     crafter                a 3 x 3 grid whose slots can be turned off; a
                            rising signal crafts one 4 ticks later
     brewing stand          (brewing.js)

   A furnace: with something it can cook and room in the output, it burns a
   fuel item and cooks; a finished item goes to the output and its
   experience is kept until a player takes anything out of the output (all
   of it then) or the furnace is broken. Without fuel the progress runs back
   two ticks a tick; lit but unable to cook, it starts again from nothing. A
   lava bucket leaves its bucket in the fuel slot, and a wet sponge dried
   over an empty bucket fills it with water.

   Chest halves are kept in the chest's meta, bits 2-3: 0 not known (an old
   save or a structure: it pairs with a chest beside it), 1 the left of the
   pair seen from behind it (its partner is clockwise of its facing), 2 the
   right (partner anticlockwise; this one holds the top rows), 3 single.
--------------------------------------------------------------------------- */
import { B, BLOCKS, OPAQUE } from './blocks.js?v=95';
import { I, ITEMS, fuelTicks, maxStack, sameItem, withCount, stackToJSON, stackFromJSON } from './items.js?v=95';
import { brewingTick, isPotion, isIngredient, brewResult } from './brewing.js?v=95';
import { cookingRecipe, remainderOf } from './crafting.js?v=95';
import { fire } from './dispense.js?v=95';
import { MAPS, fillPreview } from './maps.js?v=95';

export const SIZES = { chest: 27, trapped_chest: 27, copper_chest: 27, barrel: 27, shulker_box: 27, furnace: 3, smoker: 3, blast_furnace: 3,
  dispenser: 9, dropper: 9, crafter: 9, hopper: 5, brewing_stand: 5 };
const KIND = new Array(BLOCKS.length).fill(null);
for (const d of BLOCKS) {
  if (!d) continue;
  if (SIZES[d.name] && d.name !== 'copper_chest') KIND[d.id] = d.name;
  else if (/shulker_box$/.test(d.name)) KIND[d.id] = 'shulker_box';
  else if (/^(waxed_)?((exposed|weathered|oxidized)_)?copper_chest$/.test(d.name)) KIND[d.id] = 'copper_chest';
}
// the kind of container a block is, or null
export function containerKind(b) { return KIND[b] || null; }
export function isWorkstation(b) { const d = BLOCKS[b]; return !!d && d.name === 'crafting_table'; }
const isChestKind = k => k === 'chest' || k === 'trapped_chest' || k === 'copper_chest';
export const isShulkerBox = id => { const it = ITEMS[id]; return !!it && /shulker_box$/.test(it.name); };
const COOKER = { furnace: 1, smoker: 1, blast_furnace: 1 };

/* ---- cooking ---- */
// what an item cooks into in this kind of furnace: [output id, xp] or null (kept for the screens and tests)
export function smeltResult(id, kind) { const r = cookingRecipe(id, kind); return r ? [r.id, r.xp] : null; }
// the fuel a furnace of this kind gets from an item (a smoker and a blast furnace burn it twice as fast)
export function burnTicks(id, kind) { const t = fuelTicks(id); return kind === 'furnace' ? t : Math.floor(t / 2); }

/* ---- facing ---- */
const DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];   // north, east, south, west, up, down
export const facingVec = f => DIRS[f] || DIRS[0];
const cw = f => (f + 1) & 3, ccw = f => (f + 3) & 3;

/* ---- the redstone signal a block gets (droppers, dispensers, crafters, hoppers) ----
   The simulation's redstone answers when it can (sim.redstone.hasNeighborSignal);
   otherwise the power sources right beside it count, as do solid blocks a
   lever, button, repeater or torch powers. */
export function hasSignal(world, x, y, z) {
  const L = typeof window !== 'undefined' ? window.__lc2 : null, rs = L && L.sim && L.sim.redstone;
  if (rs) for (const f of ['hasNeighborSignal', 'powered', 'isPowered']) if (typeof rs[f] === 'function') return !!rs[f](x, y, z);
  for (let k = 0; k < 6; k++) {
    const [dx, dy, dz] = DIRS[k], nx = x + dx, ny = y + dy, nz = z + dz;
    if (emits(world, nx, ny, nz, x, y, z)) return true;
    const nb = world.get(nx, ny, nz);
    if (nb && OPAQUE[nb] && BLOCKS[nb].solid && strongly(world, nx, ny, nz, x, y, z)) return true;
  }
  return false;
}
// does the block at (x,y,z) send power into (tx,ty,tz)?
function emits(world, x, y, z, tx, ty, tz) {
  const b = world.get(x, y, z);
  if (!b) return false;
  const d = BLOCKS[b], n = d.name, m = world.meta(x, y, z);
  if (n === 'redstone_block') return true;
  if (n === 'lever' || /_button$/.test(n)) return !!(m & 8);
  if (/pressure_plate$/.test(n)) return /weighted/.test(n) ? (m & 15) > 0 : !!(m & 1);
  if (n === 'redstone_torch') return !(m & 8) && !(tx === x && ty === y - 1 && tz === z);
  if (n === 'redstone_wall_torch') { if (m & 8) return false; const s = wallOf(m); return !(tx === x + s[0] && ty === y && tz === z + s[2]); }
  if (n === 'redstone_wire') return (m & 15) > 0 && ty >= y;
  if (n === 'repeater' || n === 'comparator') { if (!(m & (n === 'repeater' ? 16 : 8))) return false; const o = DIRS[m & 3]; return tx === x + o[0] && tz === z + o[2] && ty === y; }
  if (n === 'observer') { if (!(m & 8)) return false; const o = DIRS[m & 7] || DIRS[0]; return tx === x - o[0] && ty === y - o[1] && tz === z - o[2]; }
  if (n === 'daylight_detector' || n === 'target') return (m & 15) > 0;
  return false;
}
// the side a wall-hung thing's wall is on (lever and torch faces: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z of its own cell)
function wallOf(m) { const f = m & 7; return [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][f] || [0, -1, 0]; }
// a solid block powered by a lever or button on it, a repeater into it, a torch under it, or dust on it
function strongly(world, x, y, z, fx, fy, fz) {
  for (let k = 0; k < 6; k++) {
    const [dx, dy, dz] = DIRS[k], nx = x + dx, ny = y + dy, nz = z + dz;
    if (nx === fx && ny === fy && nz === fz) continue;
    const b = world.get(nx, ny, nz);
    if (!b) continue;
    const n = BLOCKS[b].name, m = world.meta(nx, ny, nz);
    if ((n === 'lever' || /_button$/.test(n)) && (m & 8)) { const s = wallOf(m); if (nx + s[0] === x && ny + s[1] === y && nz + s[2] === z) return true; }
    if ((n === 'repeater' || n === 'comparator') && (m & (n === 'repeater' ? 16 : 8))) { const o = DIRS[m & 3]; if (nx + o[0] === x && nz + o[2] === z && ny === y) return true; }
    if (n === 'redstone_torch' && !(m & 8) && nx === x && ny === y - 1 && nz === z) return true;
    if (n === 'redstone_wire' && (m & 15) > 0 && ny === y + 1 && nx === x && nz === z) return true;
  }
  return false;
}

export class Containers {
  constructor(world) {
    this.world = world;
    this.map = new Map();            // "x,y,z" -> { kind, slots, ...furnace }
    this.lit = new Set();            // furnaces and brewing stands that are doing something
    // a stack dropped beside a block (what a brewing stand's dragon's breath leaves)
    this.dropAt = (x, y, z, st) => { if (this.drops) this.drops.spawn(x, y, z, st); };
    this.hoppers = new Set();
    this.looted = new Set();         // structure chests whose loot has been rolled (or that never had any)
    this.drops = null;               // (drops.js) so hoppers can take items lying on them, and what spills
    this.entityAt = null;            // (x, y, z) -> a container that is an entity in that block (a chest boat: js/entities), or null
    this.dirty = false;
    this.ticks = 0;
    this.onLit = null;               // (c, lit) a furnace lit up or went out
  }
  key(x, y, z) { return x + ',' + y + ',' + z; }
  // the container at a position (made empty on first use), or null when the block holds nothing
  at(x, y, z) {
    const kind = containerKind(this.world.get(x, y, z));
    if (!kind) return null;
    const k = this.key(x, y, z);
    let c = this.map.get(k);
    if (!c || c.kind !== kind) {
      c = this.fresh(kind, x, y, z);
      this.map.set(k, c);
      this.rollLoot(c);
    }
    return c;
  }
  fresh(kind, x, y, z) {
    const c = { kind, slots: new Array(SIZES[kind] || 27).fill(null), x, y, z };
    if (COOKER[kind]) Object.assign(c, { burn: 0, burnMax: 0, cook: 0, cookMax: 200, used: {} });
    if (kind === 'hopper') { c.cool = 0; c.lastTick = -1; this.hoppers.add(c); }
    if (kind === 'brewing_stand') Object.assign(c, { fuel: 0, brew: 0, ingredient: 0 });
    if (kind === 'crafter') c.off = new Array(9).fill(false);
    return c;
  }
  // a structure's chest holds a loot table until it is first opened (struct/loot.js): rolled once, then never again
  // (asStacks: hand back the stacks instead of filling the container, for a chest broken unopened)
  // (filled at once when the loot code is in, so a chest never opens empty; otherwise as soon as it is, and the
  // screen showing it is drawn again: onLoot)
  rollLoot(c, asStacks) {
    const k = this.key(c.x, c.y, c.z);
    if (this.looted.has(k)) return null;
    const L = typeof window !== 'undefined' ? window.__lc2 : null, S = L && L.structures;
    // (no structures to ask yet: asked again the next time, not marked as rolled)
    if (!S || typeof S.lootAt !== 'function') return null;
    this.looted.add(k); this.dirty = true;
    const fill = list => {
      const out = [];
      if (!list || !list.length) return out;
      for (const e of list) {
        // an explorer map: made once the structure it leads to is found (the ask goes to the generator)
        if (e.map) {
          explorerMap(e, c.x, c.z).then(st => {
            if (!st) return;
            if (asStacks) spill(this.drops, c.x, c.y, c.z, [st]);
            else if (e.slot >= 0 && e.slot < c.slots.length && !c.slots[e.slot]) { c.slots[e.slot] = st; this.changed(c); if (L.gui && L.gui.markDirty) L.gui.markDirty(); }
          });
          continue;
        }
        const st = lootStack(e);
        if (!st) continue;
        if (asStacks) out.push(st);
        else if (e.slot >= 0 && e.slot < c.slots.length && !c.slots[e.slot]) c.slots[e.slot] = st;
      }
      if (!asStacks) {
        this.changed(c);
        // a screen already showing it (the loot came late) is drawn again
        if (this.onLoot) this.onLoot(c); else if (L.gui && L.gui.markDirty) L.gui.markDirty();
      }
      return out;
    };
    let now;
    try { now = S.lootNow ? S.lootNow(c.x, c.y, c.z, c.slots.length) : undefined; } catch (e) { now = null; }
    if (now !== undefined) { const out = fill(now); return asStacks ? Promise.resolve(out) : null; }
    let p;
    try { p = S.lootAt(c.x, c.y, c.z, c.slots.length); } catch (e) { return null; }
    if (!p || !p.then) return null;
    return p.then(fill, () => []);
  }
  // a block was placed: the contents a shulker box item carried go in; hoppers start working
  placed(x, y, z, stack) {
    const k = containerKind(this.world.get(x, y, z));
    if (!k) return;
    const key = this.key(x, y, z);
    // a block placed by a player never had a structure's loot (a chest it joins keeps what it holds)
    if (stack && !this.map.has(key)) this.looted.add(key);
    if (k === 'hopper' || (stack && stack.items && k === 'shulker_box')) {
      const c = this.at(x, y, z);
      if (stack && stack.items && k === 'shulker_box') for (let i = 0; i < 27; i++) c.slots[i] = stack.items[i] ? withCount(stack.items[i], stack.items[i].count) : null;
      this.changed(c);
    }
  }
  peek(x, y, z) { return this.map.get(this.key(x, y, z)) || null; }

  /* ---- chests that make a large chest ---- */
  // the chest beside this one that makes a large chest with it, or null
  partner(x, y, z) {
    const w = this.world, b = w.get(x, y, z), kind = containerKind(b);
    if (!isChestKind(kind)) return null;
    const m = w.meta(x, y, z), f = m & 3, type = (m >> 2) & 3;
    const ok = (px, pz, want) => {
      const pb = w.get(px, y, pz), pm = w.meta(px, y, pz);
      return containerKind(pb) === kind && (pm & 3) === f && ((pm >> 2) & 3) === want ? [px, y, pz] : null;
    };
    if (type === 3) return null;
    if (type === 1) { const o = DIRS[cw(f)]; return ok(x + o[0], z + o[2], 2); }
    if (type === 2) { const o = DIRS[ccw(f)]; return ok(x + o[0], z + o[2], 1); }
    // not known (an old save, a structure): a chest beside it facing the same way that is not known either
    for (const s of [cw(f), ccw(f)]) { const o = DIRS[s]; const p = ok(x + o[0], z + o[2], 0); if (p) return p; }
    return null;
  }
  // a large chest as [top half, bottom half] (the half on your left as you face it holds the top rows), or null
  large(x, y, z) {
    const p = this.partner(x, y, z);
    if (!p) return null;
    const f = this.world.meta(x, y, z) & 3, o = DIRS[cw(f)];
    // the partner is the left one (seen from the front) when it lies clockwise of the facing
    const partnerLeft = p[0] === x + o[0] && p[2] === z + o[2];
    const a = this.at(x, y, z), b = this.at(p[0], p[1], p[2]);
    return partnerLeft ? [b, a] : [a, b];
  }
  // the meta a chest gets when placed: which half it is, and the partner's new meta ([x, y, z, meta]) if it joins one
  chestPlacement(x, y, z, id, facing, clicked, sneaking) {
    const w = this.world, kind = containerKind(id);
    const single = (px, pz) => {
      const pb = w.get(px, y, pz);
      if (containerKind(pb) !== kind) return -1;
      const pm = w.meta(px, y, pz);
      const t = (pm >> 2) & 3;
      if (t === 1 || t === 2) return -1;
      if (t === 0 && this.partner(px, y, pz)) return -1;
      return pm & 3;
    };
    // sneaking on the side of a single chest: join that one, taking its facing
    if (sneaking && clicked && clicked[1] === 0) {
      const px = x - clicked[0], pz = z - clicked[2], pf = single(px, pz);
      if (pf >= 0 && (DIRS[pf][0] !== 0) !== (clicked[0] !== 0)) {
        // the partner is anticlockwise of its facing -> it is our clockwise side
        const toPartner = [px - x, pz - z];
        const isCw = DIRS[cw(pf)][0] === toPartner[0] && DIRS[cw(pf)][2] === toPartner[1];
        return { meta: pf | ((isCw ? 1 : 2) << 2), partner: [px, y, pz, pf | ((isCw ? 2 : 1) << 2), w.get(px, y, pz)] };
      }
    }
    if (!sneaking) {
      for (const [side, type] of [[cw(facing), 1], [ccw(facing), 2]]) {
        const o = DIRS[side], px = x + o[0], pz = z + o[2];
        if (single(px, pz) === facing) return { meta: facing | (type << 2), partner: [px, y, pz, facing | ((3 - type) << 2), w.get(px, y, pz)] };
      }
    }
    return { meta: facing | (3 << 2), partner: null };
  }
  // can it be opened? (a chest under a conductive block, a shulker box with its lid blocked, cannot)
  blocked(x, y, z) {
    const w = this.world, kind = containerKind(w.get(x, y, z));
    const conductive = (bx, by, bz) => { const b = w.get(bx, by, bz); return !!b && !!OPAQUE[b] && !!BLOCKS[b].solid; };
    if (isChestKind(kind)) {
      if (conductive(x, y + 1, z)) return true;
      const p = this.partner(x, y, z);
      return !!p && conductive(p[0], p[1] + 1, p[2]);
    }
    if (kind === 'shulker_box') {
      // the lid needs the half block in front of it clear (a top slab over a box that opens up is fine)
      const f = w.meta(x, y, z) & 7, o = DIRS[f] || DIRS[4];
      const b = w.get(x + o[0], y + o[1], z + o[2]);
      if (!b || !BLOCKS[b].solid) return false;
      const d = BLOCKS[b], m = /_slab$/.test(BLOCKS[b].name) ? w.meta(x + o[0], y + o[1], z + o[2]) : 0;
      if (d.shape === 'slab' && m !== 2) return f === 4 ? m === 0 : f === 5 ? m === 1 : true;
      return true;
    }
    return false;
  }

  changed(c) {
    this.dirty = true;
    if (c && (COOKER[c.kind] || c.kind === 'brewing_stand')) this.lit.add(c);
    if (c && c.kind === 'brewing_stand') this.bottles(c);
  }
  // a brewing stand shows a bottle on each arm whose slot holds one (meta bits 0-2, the game's has_bottle_0-2)
  bottles(c) {
    const w = this.world, b = w.get(c.x, c.y, c.z);
    if (containerKind(b) !== 'brewing_stand') return;
    const m = w.meta(c.x, c.y, c.z), want = (c.slots[0] ? 1 : 0) | (c.slots[1] ? 2 : 0) | (c.slots[2] ? 4 : 0);
    if ((m & 7) !== want) w.set(c.x, c.y, c.z, b, (m & ~7) | want);
  }
  // the block is gone: what it held, to be dropped (a furnace's stored experience goes with xpOf before this)
  remove(x, y, z) {
    const k = this.key(x, y, z), c = this.map.get(k);
    if (!c) {
      if (containerKind(this.world.get(x, y, z))) this.unopened(x, y, z);
      return [];
    }
    this.looted.add(k);
    this.map.delete(k);
    this.lit.delete(c);
    this.hoppers.delete(c);
    this.dirty = true;
    return c.slots.filter(Boolean);
  }
  // a structure's chest broken before it was ever opened: its loot is rolled and spills
  // (kind: what it was, when the block is already gone)
  unopened(x, y, z, kind) {
    if (this.looted.has(this.key(x, y, z))) return;
    kind = kind || containerKind(this.world.get(x, y, z)) || 'chest';
    const r = this.rollLoot({ kind, slots: new Array(SIZES[kind] || 27).fill(null), x, y, z }, true);
    if (r) r.then(st => spill(this.drops, x, y, z, st || []));
  }
  // what a shulker box block holds, as the item's own list of 27 (null when empty), taking it out of here
  takeShulker(x, y, z) {
    const c = this.map.get(this.key(x, y, z));
    if (!c) return null;
    this.remove(x, y, z);
    return c.slots.some(Boolean) ? c.slots.map(s => (s ? withCount(s, s.count) : null)) : null;
  }

  /* ---- once a tick ---- */
  tick() {
    this.ticks++;
    if (this.lit.size) this.dirty = true;          // their progress is saved too
    for (const c of this.lit) {
      if (this.map.get(this.key(c.x, c.y, c.z)) !== c) { this.lit.delete(c); continue; }
      if (!(c.kind === 'brewing_stand' ? brewingTick(c, this.dropAt) : this.furnaceTick(c))) this.lit.delete(c);
    }
    for (const h of this.hoppers) {
      if (containerKind(this.world.get(h.x, h.y, h.z)) !== 'hopper' || this.map.get(this.key(h.x, h.y, h.z)) !== h) { this.hoppers.delete(h); continue; }
      h.lastTick = this.ticks;
      h.cool--;
      if (h.cool > 0) continue;
      h.cool = 0;
      if (hasSignal(this.world, h.x, h.y, h.z)) continue;      // locked
      if (this.hopperTick(h)) { h.cool = 8; this.dirty = true; }
    }
  }

  /* ---- moving items between containers (hoppers, droppers, crafters) ----
     A side is where the item comes from as seen by the container: 'up' (from
     above), 'down' (from below) or 'side'. */
  // the slots of the container at a position as [record, slot] pairs (a large chest is one), or null
  slotRefs(x, y, z) {
    const c = this.at(x, y, z);
    if (!c) {
      // no block that holds things: a chest boat in that block, as the game's hoppers and droppers find one
      const e = this.entityAt ? this.entityAt(x, y, z) : null;
      return e ? { kind: 'chest_boat', c: e, refs: e.slots.map((_, i) => [e, i]) } : null;
    }
    if (isChestKind(c.kind)) {
      const two = this.large(x, y, z);
      if (two) return { kind: c.kind, c, refs: two[0].slots.map((_, i) => [two[0], i]).concat(two[1].slots.map((_, i) => [two[1], i])) };
    }
    return { kind: c.kind, c, refs: c.slots.map((_, i) => [c, i]) };
  }
  // may this stack go into this slot from that side?
  canInsert(c, i, st, side) {
    const n = ITEMS[st.id] ? ITEMS[st.id].name : '';
    switch (c.kind) {
      case 'shulker_box': return !isShulkerBox(st.id);
      case 'furnace': case 'smoker': case 'blast_furnace':
        // from above anything goes into the input; from the sides and below, fuel into the fuel slot
        if (side === 'up') return i === 0;
        return i === 1 && (fuelTicks(st.id) > 0 || (st.id === I.bucket && !(c.slots[1] && c.slots[1].id === I.bucket)));
      case 'brewing_stand':
        if (side === 'up') return i === 3 && isIngredient(st);
        if (n === 'blaze_powder') return i === 4;
        return i <= 2 && (isPotion(st) || st.id === I.glass_bottle);
      case 'crafter': return !c.off[i];
      default: return true;
    }
  }
  // may a hopper below take what is in this slot?
  canExtract(c, i, st) {
    if (COOKER[c.kind]) return i === 2 || (i === 1 && (st.id === I.bucket || st.id === I.water_bucket));
    if (c.kind === 'brewing_stand') return i <= 2;
    return true;
  }
  /* One item of a stack into the container at (x,y,z) from a side; true when it went in. A crafter
     fills its first empty slot that is on, then the smallest stack of the same item. */
  insertOne(target, st, side) {
    const T = target.refs ? target : this.slotRefs(target.x, target.y, target.z);
    if (!T) return false;
    const refs = T.refs;
    if (T.kind === 'crafter') {
      const c = T.c;
      for (let i = 0; i < 9; i++) if (!c.off[i] && !c.slots[i]) { c.slots[i] = withCount(st, 1); this.changed(c); return true; }
      let best = -1;
      for (let i = 0; i < 9; i++) { const s = c.slots[i]; if (!c.off[i] && s && sameItem(s, st) && s.count < maxStack(s.id) && (best < 0 || s.count < c.slots[best].count)) best = i; }
      if (best < 0) return false;
      c.slots[best].count++; this.changed(c); return true;
    }
    for (const [c, i] of refs) {
      const t = c.slots[i];
      if (!t || !sameItem(t, st) || t.count >= maxStack(t.id) || !this.canInsert(c, i, st, side)) continue;
      t.count++; this.changed(c); return true;
    }
    for (const [c, i] of refs) {
      if (c.slots[i] || !this.canInsert(c, i, st, side)) continue;
      const wasEmpty = c.kind === 'hopper' && !c.slots.some(Boolean);
      c.slots[i] = withCount(st, 1);
      this.changed(c);
      // an empty hopper that is fed waits its cooldown before passing it on
      if (wasEmpty) c.cool = c.lastTick === this.ticks ? 7 : 8;
      return true;
    }
    return false;
  }

  /* ---- hoppers ---- */
  hopperTick(h) {
    let moved = false;
    // out: down (meta 4 or 5) or to the side it points; never into an ender chest (it is no container here)
    const m = this.world.meta(h.x, h.y, h.z) & 7;
    const [ox, oy, oz] = m >= 4 ? [0, -1, 0] : DIRS[m & 3];
    const to = this.slotRefs(h.x + ox, h.y + oy, h.z + oz);
    if (to && h.slots.some(Boolean)) {
      const side = oy < 0 ? 'up' : 'side';
      for (let i = 0; i < h.slots.length && !moved; i++) {
        const s = h.slots[i];
        if (!s) continue;
        if (this.insertOne(to, s, side)) {
          s.count--; if (s.count <= 0) h.slots[i] = null;
          moved = true;
        }
      }
    }
    // in: from a container above (the first slot that has something that fits), else whatever lies in or on it
    const from = this.slotRefs(h.x, h.y + 1, h.z);
    if (from) {
      const self = { refs: h.slots.map((_, k) => [h, k]), kind: 'hopper', c: h };
      for (const [c, i] of from.refs) {
        const s = c.slots[i];
        if (!s || !this.canExtract(c, i, s)) continue;
        if (this.insertOne(self, s, 'up')) {
          s.count--; if (s.count <= 0) c.slots[i] = null;
          this.changed(c);
          moved = true;
          break;
        }
      }
    } else if (this.drops) {
      const ab = this.world.get(h.x, h.y + 1, h.z), solidAbove = !!ab && !!BLOCKS[ab].solid && OPAQUE[ab];
      for (const e of this.drops.items) {
        if (e.gone || e.fly > 0) continue;
        const p = e.pos;
        if (p.x < h.x - 0.125 || p.x >= h.x + 1.125 || p.z < h.z - 0.125 || p.z >= h.z + 1.125 || p.y < h.y + 0.6875 - 0.25 || p.y > (solidAbove ? h.y + 1 : h.y + 2)) continue;
        // as much of the stack as fits, all at once
        let took = 0;
        const self = { refs: h.slots.map((_, k) => [h, k]), kind: 'hopper', c: h };
        while (e.stack.count > 0 && this.insertOne(self, e.stack, 'up')) { e.stack.count--; took++; }
        if (took) { moved = true; if (e.stack.count <= 0) this.drops._remove(e, -1); break; }
      }
    }
    return moved;
  }

  /* ---- furnaces: true while there is something to do ---- */
  furnaceTick(c) {
    const s = c.slots, wasLit = c.burn > 0;
    if (c.burn > 0) c.burn--;
    const r = s[0] ? cookingRecipe(s[0].id, c.kind) : null;
    if (s[0] && c.lastInput !== s[0].id) { c.lastInput = s[0].id; c.cook = 0; if (r) c.cookMax = r.ticks; }
    const canCook = !!r && (!s[2] || (sameItem(s[2], { id: r.id }) && s[2].count + r.count <= maxStack(r.id)));
    if (c.burn > 0 || (s[1] && s[0])) {
      if (c.burn <= 0 && canCook) {
        const t = burnTicks(s[1].id, c.kind);
        c.burn = c.burnMax = t;
        if (t > 0) {
          const rem = remainderOf(s[1].id);
          s[1].count--;
          if (s[1].count <= 0) s[1] = rem ? { id: rem, count: 1 } : null;
          this.dirty = true;
        }
      }
      if (c.burn > 0 && canCook) {
        c.cook++;
        if (c.cook >= c.cookMax) {
          c.cook = 0;
          c.cookMax = r.ticks;
          if (s[2]) s[2].count += r.count; else s[2] = { id: r.id, count: r.count };
          // a wet sponge dried over an empty bucket fills the bucket
          if (ITEMS[s[0].id] && ITEMS[s[0].id].name === 'wet_sponge' && s[1] && s[1].id === I.bucket && s[1].count === 1 && I.water_bucket !== undefined) s[1] = { id: I.water_bucket, count: 1 };
          s[0].count--;
          if (s[0].count <= 0) { s[0] = null; c.lastInput = 0; }
          const k = String(r.xp);
          c.used[k] = (c.used[k] || 0) + 1;
          this.dirty = true;
        }
      } else c.cook = 0;
    } else if (c.cook > 0) c.cook = Math.max(0, c.cook - 2);
    // the block follows (also the first tick after loading: a save from before the lit bit, or one
    // whose chunk was not in yet, is put right then)
    const lit = c.burn > 0;
    if (c.shown !== lit) c.shown = this.showLit(c, lit) ? lit : undefined;
    if (wasLit !== lit && this.onLit) this.onLit(c, lit);
    return c.burn > 0 || c.cook > 0 || (canCook && !!s[1] && fuelTicks(s[1].id) > 0);
  }
  /* the block shows it too, as the game's lit state: meta bit 2 of a furnace,
     smoker or blast furnace (its front drawn with the fire going and light 13:
     sim/states.js) */
  showLit(c, lit) {
    const w = this.world;
    if (!w || !w.get) return false;
    const b = w.get(c.x, c.y, c.z), d = BLOCKS[b];
    if (!d || d.name !== c.kind) return false;
    const m = w.meta(c.x, c.y, c.z), n = lit ? m | 4 : m & ~4;
    if (n !== m) w.set(c.x, c.y, c.z, b, n);
    return true;
  }
  // the experience a furnace holds: each recipe's xp times how many were made, the whole points and the rest by chance
  xpOf(c, take = true) {
    if (!c || !c.used) return 0;
    let n = 0;
    for (const k in c.used) {
      const total = Math.fround(+k * c.used[k]);
      let i = Math.floor(total);
      const f = total - i;
      if (f > 0 && Math.random() < f) i++;
      n += i;
    }
    if (take) { c.used = {}; this.dirty = true; }
    return n;
  }
  // a player took something out of the output: all the experience it holds
  takeXp(c) { return this.xpOf(c, true); }

  /* ---- saving ---- */
  toJSON() {
    const out = [];
    for (const c of this.map.values()) {
      const used = c.used && Object.keys(c.used).length;
      const off = c.off && c.off.some(Boolean);
      if (!c.slots.some(Boolean) && !used && !off && c.kind !== 'hopper') continue;
      const o = { k: c.kind, p: [c.x, c.y, c.z], s: c.slots.map(stackToJSON) };
      if (COOKER[c.kind]) Object.assign(o, { b: c.burn, bm: c.burnMax, c: c.cook, cm: c.cookMax, u: c.used });
      if (c.kind === 'brewing_stand') Object.assign(o, { f: c.fuel, w: c.brew, g: c.ingredient });
      if (off) o.off = c.off.map(v => (v ? 1 : 0));
      if (c.kind === 'hopper') o.cd = c.cool;
      out.push(o);
    }
    if (this.looted.size) out.push({ k: '#looted', l: [...this.looted] });
    return out;
  }
  fromJSON(list) {
    this.map.clear(); this.lit.clear(); this.hoppers.clear(); this.looted.clear();
    if (!Array.isArray(list)) return;
    for (const o of list) {
      if (o.k === '#looted') { for (const k of o.l || []) this.looted.add(k); continue; }
      const [x, y, z] = o.p;
      const c = this.fresh(o.k, x, y, z);
      const sl = (o.s || []).map(stackFromJSON);
      for (let i = 0; i < c.slots.length; i++) c.slots[i] = sl[i] || null;
      this.looted.add(this.key(x, y, z));
      if (COOKER[o.k]) {
        Object.assign(c, { burn: o.b | 0, burnMax: o.bm | 0, cook: o.c | 0, cookMax: o.cm || 200, lastInput: c.slots[0] ? c.slots[0].id : 0 });
        c.used = o.u && typeof o.u === 'object' ? o.u : {};
        // an older save kept the experience as one number
        if (o.x) c.used[String(o.x)] = (c.used[String(o.x)] || 0) + 1;
        this.lit.add(c);
      }
      if (o.k === 'hopper') c.cool = o.cd | 0;
      if (o.k === 'brewing_stand') { Object.assign(c, { fuel: o.f | 0, brew: o.w | 0, ingredient: o.g | 0 }); this.lit.add(c); }
      if (o.k === 'crafter' && Array.isArray(o.off)) c.off = o.off.map(Boolean);
      this.map.set(this.key(x, y, z), c);
    }
  }
}

// a structure loot entry as a stack: its count, wear, potion
/* An exploration map from a loot table (the game's exploration_map): a filled
   map at the table's zoom (2 unless it says), centred on the nearest
   structure of its kind from the chest, that place marked. When none is
   found the map is thrown away, as the game's tables say (resolves null). */
const MAP_KIND = {
  on_treasure_maps: 'buried_treasure', on_ocean_explorer_maps: 'monument', on_woodland_explorer_maps: 'mansion', on_woodland_mansion_maps: 'mansion',
  on_ancient_city_maps: 'ancient_city', on_trial_chambers_maps: 'trial_chambers', on_buried_trial_chambers_maps: 'trial_chambers', on_mineshaft_maps: 'mineshaft',
  on_desert_pyramid_maps: 'desert_pyramid', on_jungle_pyramid_maps: 'jungle_pyramid', on_jungle_explorer_maps: 'jungle_pyramid', on_swamp_explorer_maps: 'swamp_hut',
  on_ocean_ruin_warm_maps: 'ocean_ruin_warm', on_ocean_ruin_cold_maps: 'ocean_ruin_cold',
};
// the names the game gives its explorer maps
export const MAP_TITLE = { buried_treasure: 'Buried Treasure Map', monument: 'Ocean Explorer Map', mansion: 'Woodland Explorer Map', trial_chambers: 'Trial Explorer Map',
  jungle_pyramid: 'Jungle Explorer Map', swamp_hut: 'Swamp Explorer Map', village_plains: 'Plains Village Map', village_savanna: 'Savanna Village Map',
  village_taiga: 'Taiga Village Map', village_desert: 'Desert Village Map', village_snowy: 'Snowy Village Map' };
export function explorerMap(e, x, z) {
  const L = typeof window !== 'undefined' ? window.__lc2 : null, S = L && L.structures;
  const kind = MAP_KIND[e.map] || (/^on_abandoned_camp_/.test(e.map) ? e.map.replace(/^on_/, '') : null);
  if (!S || !S.locate || !kind || I.filled_map === undefined) return Promise.resolve(null);
  return S.locate(kind, x, z).then(f => {
    if (!f || f.x === undefined) return null;
    const w = L.world, m = MAPS.create(f.x, f.z, e.zoom !== undefined ? e.zoom : 2, (w && w.dim) || 'overworld');
    m.marks = [{ x: f.x, z: f.z, type: e.deco || 'red_x' }];
    fillPreview(m, w);
    const st = { id: I.filled_map, count: 1, map: m.id };
    if (MAP_TITLE[kind]) st.title = MAP_TITLE[kind];
    return st;
  }, () => null);
}
export function lootStack(e) {
  const id = I[e.item];
  if (id === undefined || !(e.count > 0)) return null;
  const st = { id, count: Math.min(e.count, maxStack(id)) };
  const it = ITEMS[id];
  if (e.damage !== undefined && it && it.dur) { const d = Math.round((1 - e.damage) * it.dur); if (d > 0) st.dmg = Math.min(it.dur - 1, d); }
  if (e.potion) st.potion = String(e.potion).replace(/^minecraft:/, '');
  if (e.ench && Object.keys(e.ench).length) st.ench = Object.assign({}, e.ench.set || e.ench);
  if (e.stew) st.stew = e.stew.slice();
  if (e.amp !== undefined) st.amp = e.amp;
  if (e.instrument) st.instrument = e.instrument;
  return st;
}

/* ---- what the world does with these blocks (sim/sim.js calls this) ----
   Chest halves go back to single when their partner goes; what a container
   held spills when it is removed by anything but the player's hand (which
   hands.js handles first); dispensers, droppers and crafters fire on a
   rising signal, 4 ticks later (js/dispense.js does the firing). */
export function installContainers(sim) {
  const C = () => sim.game && sim.game.containers;
  /* Placing: a chest joins the single chest beside it facing the same way
     (or, sneaking, the one whose side was clicked); a shulker box opens
     away from the face it was put on; a crafter faces you like a dispenser. */
  (sim.placers || (sim.placers = [])).push((list, hit, id) => {
    const k = containerKind(id), cs = C();
    if (!k || !cs || !list.length) return list;
    const [x, y, z, b, m] = list[0];
    if (b !== id) return list;
    const n = hit && hit.face ? hit.face : [0, 1, 0];
    if (isChestKind(k)) {
      const p = cs.chestPlacement(x, y, z, id, m & 3, n, !!(sim.player && sim.player.sneaking));
      const out = [[x, y, z, id, p.meta]];
      if (p.partner) out.push(p.partner.slice(0, 3).concat([p.partner[4], p.partner[3]]));
      return out.concat(list.slice(1));
    }
    if (k === 'shulker_box') {
      const f = n[1] === 1 ? 4 : n[1] === -1 ? 5 : n[2] === -1 ? 0 : n[0] === 1 ? 1 : n[2] === 1 ? 2 : 3;
      return [[x, y, z, id, f]].concat(list.slice(1));
    }
    if (k === 'crafter' && sim.player) {
      const P = sim.player, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
      const look = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 1 : 3) : (fz > 0 ? 2 : 0);
      return [[x, y, z, id, P.pitch < -0.8 ? 4 : P.pitch > 0.8 ? 5 : (look + 2) & 3]].concat(list.slice(1));
    }
    return list;
  });
  const chests = d => isChestKind(KIND[d.id]);
  sim.onAll(chests, {
    neighbor(s, x, y, z, m) {
      const t = (m >> 2) & 3;
      if (t !== 1 && t !== 2) return;
      const f = m & 3, o = DIRS[t === 1 ? cw(f) : ccw(f)], b = s.get(x, y, z);
      const pb = s.get(x + o[0], y, z + o[2]), pm = s.meta(x + o[0], y, z + o[2]);
      if (containerKind(pb) !== containerKind(b) || (pm & 3) !== f || ((pm >> 2) & 3) !== 3 - t) s.quietSet(x, y, z, b, f | (3 << 2));
    },
  });
  for (const d of BLOCKS) {
    if (!d || !KIND[d.id]) continue;
    const id = d.id, kind = KIND[id];
    sim.on(id, {
      // the block was replaced by something else (an explosion, a command, fire...): what it held comes out
      removed(s, x, y, z, om, nb) {
        const cs = C();
        if (!cs || containerKind(nb)) return;
        const c = cs.peek(x, y, z);
        if (!c) { cs.unopened(x, y, z, kind); return; }
        const D = cs.drops;
        if (kind === 'shulker_box') {
          // a shulker box always drops itself, its contents inside
          const items = cs.takeShulker(x, y, z), st = { id, count: 1 };
          if (items) st.items = items;
          if (D) D.spawn(x + 0.5, y + 0.25, z + 0.5, st, { vel: [(Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2] });
          return;
        }
        if (COOKER[kind] && D) { const xp = cs.xpOf(c); if (xp) D.xp(x + 0.5, y + 0.5, z + 0.5, xp); }
        spill(D, x, y, z, cs.remove(x, y, z));
      },
      // (the box itself comes from removed above, never from the world's own loot)
      loot: kind === 'shulker_box' ? () => [] : undefined,
    });
  }
  for (const name of ['dispenser', 'dropper', 'crafter']) {
    sim.on(name, {
      neighbor(s, x, y, z, m) {
        // droppers and dispensers also hear a signal meant for the block above them (quasi-connectivity); crafters do not
        const on = hasSignal(s.w, x, y, z) || (name !== 'crafter' && hasSignal(s.w, x, y + 1, z));
        const was = !!(m & 8);
        if (on && !was) { s.schedule(x, y, z, 4); s.quietSet(x, y, z, s.get(x, y, z), m | 8); }
        else if (!on && was) s.quietSet(x, y, z, s.get(x, y, z), m & ~8);
      },
      tick(s, x, y, z) { fire(s, C(), x, y, z); },
    });
  }
}
// a container's contents thrown out the way the game does it: parts of 10-30 from random points inside the block
export function spill(D, x, y, z, stacks) {
  if (!D) return;
  for (const s of stacks) {
    let left = s.count;
    while (left > 0) {
      const n = Math.min(left, 10 + Math.floor(Math.random() * 21));
      left -= n;
      D.spawn(x + 0.15 + Math.random() * 0.7, y + 0.15 + Math.random() * 0.7, z + 0.15 + Math.random() * 0.7, withCount(s, n),
        { vel: [(Math.random() - 0.5) * 0.1, 0.2 * Math.random() + 0.05, (Math.random() - 0.5) * 0.1] });
    }
  }
}
