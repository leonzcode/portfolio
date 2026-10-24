/* ---------------------------------------------------------------------------
   Leoncraft 2 - droppers, dispensers and crafters firing.

   containers.js hears the redstone (a rising signal, then 4 ticks) and calls
   fire(). What each does (the Minecraft Wiki's Dropper, Dispenser and
   Crafter pages, Java Edition):

     dropper    one item from a random slot that has something: into the
                container in front of it (a large chest is one), or nothing
                happens if it will not go in; with no container, thrown out
                of its face
     dispenser  the same random slot, but the item is used: arrows, snowballs,
                eggs and splash potions are shot; buckets of water and lava
                are emptied in front of it and an empty bucket fills from a
                source there; bone meal grows what is in front; flint and
                steel lights a fire; TNT is lit; a shulker box is placed;
                armour goes onto the player standing in front; a glass bottle
                fills from water; boats, minecarts and spawn eggs make their
                entity. Anything else is thrown out like a dropper's.
     crafter    crafts once from its grid, as a crafting table would; the
                result goes into the container in front of it if it fits,
                else out of its face, and what the recipe leaves behind (a
                bucket, a bottle) after it

   An item thrown out leaves from 0.7 of a block in front of the middle of
   the block, at 0.2-0.3 blocks a tick along the facing, spread a little.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=107';
import { I, ITEMS, withCount, armorOf, maxDamage } from './items.js?v=107';
import { matchGrid, remainderOf } from './crafting.js?v=107';
import { containerKind, facingVec, isShulkerBox } from './containers.js?v=107';

const nameOf = id => (ITEMS[id] ? ITEMS[id].name : '');
// the game's triangle distribution: centre + (rand - rand) * spread
const tri = (c, s) => c + s * (Math.random() - Math.random());

// a stack thrown out of the block's face (the game's spawnItem)
export function eject(D, x, y, z, f, st) {
  if (!D || !st) return null;
  const [dx, dy, dz] = facingVec(f);
  const px = x + 0.5 + dx * 0.7, pz = z + 0.5 + dz * 0.7;
  const py = y + 0.5 + dy * 0.7 - (dy !== 0 ? 0.125 : 0.15625);
  const sp = Math.random() * 0.1 + 0.2;
  return D.spawn(px, py, pz, st, { vel: [tri(dx * sp, 0.0172275 * 6), tri(0.2, 0.0172275 * 6), tri(dz * sp, 0.0172275 * 6)], delay: 10 });
}
// a random slot that has something in it, every one as likely
function randomSlot(c) {
  let pick = -1, n = 0;
  for (let i = 0; i < c.slots.length; i++) if (c.slots[i] && Math.random() * ++n < 1) pick = i;
  return pick;
}
// the side of the container in front an item arrives at
const sideFrom = f => (f === 5 ? 'up' : f === 4 ? 'down' : 'side');

export function fire(sim, C, x, y, z) {
  if (!C) return false;
  const w = sim.w, b = w.get(x, y, z), kind = containerKind(b);
  if (kind !== 'dispenser' && kind !== 'dropper' && kind !== 'crafter') return false;
  const c = C.at(x, y, z), f = w.meta(x, y, z) & 7;
  const [dx, dy, dz] = facingVec(f), fx = x + dx, fy = y + dy, fz = z + dz;
  if (kind === 'crafter') return craft(sim, C, c, x, y, z, f, fx, fy, fz);
  const i = randomSlot(c);
  if (i < 0) { sound(sim, 'click_fail', x, y, z); return false; }
  const st = c.slots[i];
  if (kind === 'dropper') {
    const to = C.slotRefs(fx, fy, fz);
    if (to) {
      if (!C.insertOne(to, st, sideFrom(f))) return false;
    } else {
      eject(C.drops, x, y, z, f, withCount(st, 1));
      sound(sim, 'click', x, y, z);
    }
    st.count--; if (st.count <= 0) c.slots[i] = null;
    C.changed(c);
    return true;
  }
  // a dispenser uses the item
  const left = dispense(sim, C, c, i, st, x, y, z, f, fx, fy, fz);
  if (left !== undefined) c.slots[i] = left && left.count > 0 ? left : null;
  C.changed(c);
  return true;
}

/* What a dispenser does with the item in slot i. Returns what stays in the
   slot (undefined: the stack, one fewer). */
function dispense(sim, C, c, i, st, x, y, z, f, fx, fy, fz) {
  const w = sim.w, n = nameOf(st.id), L = typeof window !== 'undefined' ? window.__lc2 : null, E = L && L.entities;
  const [dx, dy, dz] = facingVec(f);
  const front = w.get(fx, fy, fz), fd = front ? BLOCKS[front] : null;
  const one = () => { st.count--; return st.count > 0 ? st : null; };
  const throwOne = () => { eject(C.drops, x, y, z, f, withCount(st, 1)); sound(sim, 'click', x, y, z); return one(); };
  const shoot = (type, speed, inacc, setup) => {
    if (!E || typeof E.spawn !== 'function') return throwOne();
    const e = E.spawn(type, x + 0.5 + dx * 0.7, y + 0.5 + dy * 0.7 - (dy === 0 ? 0.1 : 0), z + 0.5 + dz * 0.7, { natural: false });
    if (!e) return throwOne();
    if (setup) setup(e);
    e.shoot(dx, dy + (dy === 0 ? 0.1 : 0), dz, speed, inacc);
    return one();
  };
  // arrows, snowballs, eggs, splash potions: shot along the facing
  if (n === 'arrow' || n === 'tipped_arrow' || n === 'spectral_arrow') return shoot('arrow', 1.1, 6, a => { a.pickup = 1; a.item = n; if (st.potion) a.potion = st.potion; });
  if (n === 'snowball' || n === 'egg') return shoot(n, 1.1, 6);
  if (n === 'splash_potion' || n === 'lingering_potion') return shoot('potion', 1.375, 3, p => { p.potion = st.potion || 'water'; p.lingering = n === 'lingering_potion'; });
  // a fire charge: a blaze's small fireball out of the front, a little off line (the game's triangle of 0.11485 each way)
  if (n === 'fire_charge' && E && typeof E.spawn === 'function') {
    const e = E.spawn('small_fireball', x + 0.5 + dx * 0.7, y + 0.5 + dy * 0.7 - (dy === 0 ? 0.15 : 0), z + 0.5 + dz * 0.7, { natural: false });
    if (!e) return throwOne();
    const off = () => (Math.random() - Math.random()) * 0.11485;
    e.aim(dx + off(), dy + off(), dz + off());
    return one();
  }
  // buckets
  const replaceable = !front || (fd && fd.replaceable);
  if (n === 'water_bucket' || n === 'lava_bucket') {
    const fluid = n === 'water_bucket' ? B.water : B.lava;
    if (!replaceable || FLUID[front]) return throwOneAsBucket();
    w.set(fx, fy, fz, fluid, 0);
    if (sim.fluids) sim.fluids.around(fx, fy, fz);
    return { id: I.bucket, count: 1 };
  }
  if (n === 'bucket') {
    const k = FLUID[front];
    if (!k || !(sim.fluids && sim.fluids.isSource ? sim.fluids.isSource(fx, fy, fz, k) : w.meta(fx, fy, fz) === 0)) return throwOne();
    w.set(fx, fy, fz, 0, 0);
    if (sim.fluids) sim.fluids.around(fx, fy, fz);
    const full = { id: I[k === 1 ? 'water_bucket' : 'lava_bucket'], count: 1 };
    if (st.count === 1) return full;
    st.count--;
    if (!C.insertOne({ refs: c.slots.map((_, k2) => [c, k2]), kind: c.kind, c }, full, 'side')) eject(C.drops, x, y, z, f, full);
    return st;
  }
  if (n === 'glass_bottle') {
    if (FLUID[front] !== 1) return throwOne();
    const water = { id: I.potion, count: 1, potion: 'water' };
    if (st.count === 1) return water;
    st.count--;
    if (!C.insertOne({ refs: c.slots.map((_, k2) => [c, k2]), kind: c.kind, c }, water, 'side')) eject(C.drops, x, y, z, f, water);
    return st;
  }
  if (n === 'bone_meal') {
    if (sim.boneMeal && sim.boneMeal(fx, fy, fz)) return one();
    sound(sim, 'click_fail', x, y, z);
    return st;
  }
  if (n === 'flint_and_steel') {
    // the game's order: fire in the air in front where a fire can stand, else a campfire or candle lit, else TNT lit
    const fm = w.meta(fx, fy, fz), fname = fd ? fd.name : '';
    if ((!front || fname === 'cave_air') && sim.lightFire && sim.lightFire(fx, fy, fz, 0)) {}
    else if (fd && fd.shape === 'campfire' && (fm & 4)) w.set(fx, fy, fz, front, fm & ~4);
    else if (fd && /candle$|candle_cake$/.test(fname) && !(fm & 4)) w.set(fx, fy, fz, front, fm | 4);
    else if (front === B.tnt && sim.primeTnt) { w.set(fx, fy, fz, 0, 0); sim.primeTnt(fx, fy, fz, null, 80); }
    else { sound(sim, 'click_fail', x, y, z); return st; }
    // a point of wear (with Unbreaking only 1 time in level + 1)
    const ub = st.ench ? st.ench.unbreaking | 0 : 0;
    if (!ub || Math.random() < 1 / (ub + 1)) st.dmg = (st.dmg | 0) + 1;
    return st.dmg >= maxDamage(st.id) ? null : st;
  }
  if (n === 'tnt' && sim.primeTnt) {
    if (front && !replaceable) return throwOne();
    sim.primeTnt(fx, fy, fz, null, 80);
    return one();
  }
  // a shulker box goes in front; facing up when something is under it, else the dispenser's way
  if (isShulkerBox(st.id)) {
    if (!replaceable) return throwOne();
    const under = w.get(fx, fy - 1, fz);
    w.set(fx, fy, fz, st.id, under ? 4 : f);
    C.placed(fx, fy, fz, st);
    return one();
  }
  // armour onto the player standing in front of it
  const ar = armorOf(st.id);
  if (ar && L && L.player && L.inv) {
    const p = L.player.pos;
    if (p.x > fx - 0.3 && p.x < fx + 1.3 && p.z > fz - 0.3 && p.z < fz + 1.3 && p.y > fy - 1.8 && p.y < fy + 1) {
      if (!L.inv.armor[ar.slot]) { L.inv.armor[ar.slot] = withCount(st, 1); L.inv.changed(); return one(); }
    }
  }
  /* a boat: 1.25 out from the middle of its face (1.125 up or down), facing
     the way the dispenser does (east, from one facing up or down); a block
     higher when there is water in front, and only into water or into air
     over water (else thrown out) */
  if (E && E.placeBoatAt && /_boat$|_raft$/.test(n)) {
    const wet = id => !!id && (FLUID[id] === 1 || !!(BLOCKS[id] && BLOCKS[id].waterlogged));
    let up = 0;
    if (wet(front)) up = 1;
    else if (front || !wet(w.get(fx, fy - 1, fz))) return throwOne();
    if (!E.placeBoatAt(n, x + 0.5 + dx * 1.25, y + 0.5 + dy * 1.125 + up, z + 0.5 + dz * 1.25, dy ? -Math.PI / 2 : Math.atan2(-dx, -dz))) return throwOne();
    sound(sim, 'click', x, y, z);
    return one();
  }
  // a minecart of any kind: onto a rail in front (or one a block down there), else thrown out
  if (E && E.placeCartAt && /^(\w+_)?minecart$/.test(n)) {
    const rail = id => !!id && !!BLOCKS[id] && BLOCKS[id].shape === 'rail';
    const at = rail(front) ? fy : rail(w.get(fx, fy - 1, fz)) ? fy - 1 : null;
    if (at === null || !E.placeCartAt(n, fx, at, fz)) return throwOne();
    sound(sim, 'click', x, y, z);
    return one();
  }
  // mobs from spawn eggs
  if (E && /_spawn_egg$/.test(n)) {
    const e = E.spawn(n.slice(0, -10), fx + 0.5, fy, fz + 0.5, { natural: true });
    if (e) { e.persistent = true; return one(); }
  }
  return throwOne();
  function throwOneAsBucket() { return throwOne(); }
}

function craft(sim, C, c, x, y, z, f, fx, fy, fz) {
  const grid = c.slots.map((s, i) => (c.off[i] ? null : s));
  const m = matchGrid(grid, 3);
  if (!m) { sound(sim, 'click_fail', x, y, z); return false; }
  const out = withCount(m.result, m.result.count);
  // the ingredients: one of each, and what each leaves behind thrown out after the result
  const left = [];
  for (let i = 0; i < 9; i++) {
    const s = c.slots[i];
    if (!s || c.off[i]) continue;
    const rem = remainderOf(s.id);
    s.count--;
    if (s.count <= 0) c.slots[i] = null;
    if (rem) left.push({ id: rem, count: 1 });
  }
  C.changed(c);
  const to = C.slotRefs(fx, fy, fz);
  for (const st of [out].concat(left)) {
    if (to) while (st.count > 0 && C.insertOne(to, st, sideFrom(f))) st.count--;
    if (st.count > 0) eject(C.drops, x, y, z, f, st);
  }
  sound(sim, 'craft', x, y, z, m.result);
  return true;
}

// (what a crafter made goes with its sound: the advancements want to know, adv/game.js)
function sound(sim, kind, x, y, z, made) {
  const L = typeof window !== 'undefined' ? window.__lc2 : null;
  if (L && L.onBlockSound) try { L.onBlockSound(kind, x, y, z, made); } catch (e) {}
}
