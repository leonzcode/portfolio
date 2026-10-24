/* ---------------------------------------------------------------------------
   Leoncraft 2 - dispensers and droppers (Minecraft Wiki; Java Edition).

   Powered (from any side, or by what would power the block above it), one
   waits 4 ticks and then acts once, with one item from a random slot that
   holds something; empty, it only clicks. Power has to go and come back for
   the next go.

     dropper      the item goes into a container in front of it (a chest, a
                  hopper, the right slot of a furnace...), or falls out
     dispenser    does what the item would do: arrows and snowballs are
                  shot, buckets of water or lava are poured (an empty one
                  takes a source back), flint and steel lights a fire or
                  TNT, TNT comes out lit, bone meal grows what is in front,
                  spawn eggs hatch, a minecart goes onto a rail, armour goes
                  onto the player standing in front; anything else falls out

   An item falls out the game's way: from 0.7 out of the middle, a little
   lower, at 0.2 to 0.3 blocks a tick forward and 0.2 up, spread by a
   triangle of 0.1 either way.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { LEVEL, FALLING } from '../world-const.js?v=107';
import { F6, FACE6 } from './redstone.js?v=107';
import { I, ITEMS, armorOf, withCount } from '../items.js?v=107';
import { containerKind } from '../containers.js?v=107';
import { placeMinecart } from '../entities/minecart.js?v=107';

const tri = (r, a, b) => a + b * (r() - r());

export function installDispensers(sim) {
  const rs = sim.redstone, S = sim;
  for (const name of ['dispenser', 'dropper']) {
    const id = B[name];
    if (id === undefined) continue;
    sim.on(id, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        if (kind === 2) return;
        const p = rs.powered(x, y, z) || rs.powered(x, y + 1, z), t = !!(m & 8);
        if (p && !t) { s.schedule(x, y, z, 4); rs.setState(x, y, z, id, m | 8); rs.go(); }
        else if (!p && t) { rs.setState(x, y, z, id, m & ~8); rs.go(); }
      },
      tick(s, x, y, z, m) { fire(name, x, y, z, m); },
    });
  }

  function fire(kind, x, y, z, m) {
    const C = S.game && S.game.containers;
    if (!C) return;
    const c = C.at(x, y, z);
    // a random slot of those holding something
    let slot = -1, j = 1;
    for (let k = 0; k < c.slots.length; k++) if (c.slots[k] && c.slots[k].count > 0 && Math.floor(S.rng() * j++) === 0) slot = k;
    if (slot < 0) { click(x, y, z, false); return; }
    const st = c.slots[slot], facing = Math.min(5, m & 7), f = FACE6[facing], v = F6[f];
    const fx = x + v[0], fy = y + v[1], fz = z + v[2];
    const take = () => { st.count--; if (st.count <= 0) c.slots[slot] = null; C.changed(c); };
    if (kind === 'dropper') {
      const to = containerKind(S.get(fx, fy, fz)) ? C.at(fx, fy, fz) : null;
      if (to) { if (C.insertOne(to, st, C.slotsIn(to, v[1] < 0 ? 'up' : 'side', st))) { take(); C.changed(to); } return; }
      drop(x, y, z, v, withCount(st, 1)); take(); click(x, y, z, true);
      return;
    }
    const it = ITEMS[st.id], n = it ? it.name : '';
    const r = behave(n, st, x, y, z, v, fx, fy, fz, c, slot);
    if (r === 'drop') { drop(x, y, z, v, withCount(st, 1)); take(); click(x, y, z, true); }
    else if (r === 'used') { take(); click(x, y, z, true); }
    else if (r === 'kept') click(x, y, z, true);
    else click(x, y, z, false);
  }
  // an item thrown out of the front
  function drop(x, y, z, v, stack) {
    const D = S.game && S.game.drops;
    if (!D) return;
    const px = x + 0.5 + 0.7 * v[0], py = y + 0.5 + 0.7 * v[1] - (v[1] ? 0.125 : 0.15625), pz = z + 0.5 + 0.7 * v[2];
    const sp = S.rng() * 0.1 + 0.2, r = S.rng, spread = 0.0172275 * 6;
    D.spawn(px, py, pz, stack, { vel: [tri(r, v[0] * sp, spread), tri(r, 0.2, spread), tri(r, v[2] * sp, spread)] });
  }
  function click(x, y, z, ok) {
    if (ok) {
      const P = S.renderer && S.renderer.particles;
      if (P && P.spawn) for (let i = 0; i < 4; i++) P.spawn(x + 0.5 + (S.rng() - 0.5) * 0.6, y + 0.9, z + 0.5 + (S.rng() - 0.5) * 0.6, 0, 0.02, 0, { colour: 0x8a8a8a, size: 0.1, life: 12, gravity: 0, physics: false });
    }
    S.lastDispense = { x, y, z, ok, at: S.n };
    if (S.onDispense) S.onDispense(x, y, z, ok);
  }
  /* What the dispenser does with an item: 'drop' (falls out), 'used' (one is
     used up), 'kept' (it worked and the item changed in its slot), or false
     (nothing happened). */
  function behave(n, st, x, y, z, v, fx, fy, fz, c, slot) {
    const E = S.game && S.game.entities;
    const fb = S.get(fx, fy, fz), fd = BLOCKS[fb];
    // things shot out: from 0.7 out of the middle, a little upwards
    const shoot = (type, speed, inacc) => {
      if (!E) return 'drop';
      const e = E.spawn(type, x + 0.5 + 0.7 * v[0], y + 0.5 + 0.7 * v[1], z + 0.5 + 0.7 * v[2], { natural: false });
      if (!e) return 'drop';
      if (type === 'arrow') { e.pickup = 1; e.item = n; if (st.potion) e.potion = st.potion; }
      // a thrown potion carries what was in the bottle
      if (type === 'potion') { e.potion = st.potion || 'water'; e.lingering = n === 'lingering_potion'; }
      e.shoot(v[0], v[1] + 0.1, v[2], speed, inacc);
      return 'used';
    };
    if (n === 'arrow' || n === 'spectral_arrow' || n === 'tipped_arrow') return shoot('arrow', 1.1, 6);
    if (n === 'snowball' || n === 'egg') return shoot(n, 1.1, 6);
    if (n === 'splash_potion' || n === 'lingering_potion') return shoot('potion', 1.375, 3);
    if (n === 'tnt') { if (S.primeTnt) S.primeTnt(fx, fy, fz, null, 80); return 'used'; }
    if (n === 'flint_and_steel') {
      if (fb === B.tnt) { S.set(fx, fy, fz, 0, 0); S.primeTnt(fx, fy, fz, null, 80); }
      else if ((!fb || fd.name === 'cave_air') && S.lightFire && S.lightFire(fx, fy, fz, 0)) {}
      else return false;
      st.dmg = (st.dmg || 0) + 1;
      const max = ITEMS[st.id] && ITEMS[st.id].dur;
      if (max && st.dmg >= max) c.slots[slot] = null;
      return 'kept';
    }
    if (n === 'bone_meal') return S.boneMeal && S.boneMeal(fx, fy, fz) ? 'used' : false;
    if (n === 'water_bucket' || n === 'lava_bucket' || n === 'powder_snow_bucket') {
      const into = n === 'water_bucket' ? B.water : n === 'lava_bucket' ? B.lava : B.powder_snow;
      if (fb && !(fd.replaceable && !FLUID[fb]) && !(FLUID[fb] && (S.meta(fx, fy, fz) & (LEVEL | FALLING)))) return false;
      S.set(fx, fy, fz, into, 0);
      if (S.fluids) S.fluids.around(fx, fy, fz);
      c.slots[slot] = { id: I.bucket, count: 1 };
      return 'kept';
    }
    if (n === 'bucket') {
      if (!FLUID[fb] || (S.meta(fx, fy, fz) & (LEVEL | FALLING))) return false;
      const full = FLUID[fb] === 1 ? 'water_bucket' : 'lava_bucket';
      S.set(fx, fy, fz, 0, 0);
      if (S.fluids) S.fluids.around(fx, fy, fz);
      const filled = { id: I[full], count: 1 };
      if (st.count <= 1) { c.slots[slot] = filled; return 'kept'; }
      st.count--;
      const C = S.game.containers;
      if (!C.insertOne(c, filled, c.slots.map((_, i) => i).filter(i => !c.slots[i]))) drop(x, y, z, v, filled);
      return 'kept';
    }
    if (/_spawn_egg$/.test(n) && E) {
      const type = n.slice(0, -10);
      const e = E.spawn(type, fx + 0.5, fy, fz + 0.5, { natural: true });
      if (!e) return 'drop';
      e.persistent = true;
      return 'used';
    }
    if (/^(\w+_)?minecart$/.test(n) && E) {
      if (fd && fd.shape === 'rail') { placeMinecart(E, fx, fy, fz, n); return 'used'; }
      return 'drop';
    }
    const ar = armorOf(st.id);
    if (ar && !(it => it && it.block)(ITEMS[st.id])) {
      const P = S.player, inv = S.inv;
      if (P && inv && P.pos.x + 0.3 > fx && P.pos.x - 0.3 < fx + 1 && P.pos.z + 0.3 > fz && P.pos.z - 0.3 < fz + 1 && P.pos.y < fy + 1 && P.pos.y + 1.8 > fy && !inv.armor[ar.slot]) {
        inv.armor[ar.slot] = withCount(st, 1); inv.changed();
        return 'used';
      }
      return 'drop';
    }
    if (/shulker_box$/.test(n) && (!fb || fd.replaceable)) { S.set(fx, fy, fz, st.id, 0); return 'used'; }
    return 'drop';
  }
  rs.dispenseFrom = (x, y, z) => { const b = S.get(x, y, z); fire(BLOCKS[b].name, x, y, z, S.meta(x, y, z)); };
}
