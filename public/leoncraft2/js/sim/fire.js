/* ---------------------------------------------------------------------------
   Leoncraft 2 - fire, by the game's rules (Minecraft Wiki, Java Edition).

   Fire ticks every 30-39 ticks. Each time it ages (0-15), may go out in the
   rain (20% + 3% an age), goes out with nothing flammable beside it unless it
   stands on something solid and is young, and at age 15 on something that
   cannot burn. It eats its neighbours by their flammability (a 1 in 300
   roll beside it, 250 above and below, 50 less in humid biomes), the burnt
   block becoming fire or air, TNT being lit. It jumps into air within 3x6x3
   (more unlikely the higher above) by the encouragement of what is round
   that air: (encouragement + 40 + 7 x difficulty) / (age + 30) out of 100.
   Netherrack and magma burn for ever. Soul fire sits on soul sand and soul
   soil and never spreads. Lava lights flammable blocks round it on its own
   random ticks. With doFireTick off a fire neither spreads, burns nor goes
   out by itself.

   Flint and steel (or a fire charge) lights a fire in the air beside the
   face you click, where a fire can stand: on a top face that holds it, or
   against a block that burns (so on the side of planks or a log, with
   nothing under it, drawn against that side: models.js). Anywhere else
   it does nothing, as in the game. It lights TNT; campfires and candles
   are details.js's, portals dim/realms.js's.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { catchOf, burnOf } from '../flame.js?v=107';

const RI = (s, n) => Math.floor(s.rng() * n);
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
// the biomes where fire burns out sooner and spreads half as well (26.x: the biomes with the
// increased_fire_burnout attribute; sparse jungle is not one of them, the snowy peaks are)
const HUMID = new Set(['jungle', 'bamboo_jungle', 'swamp', 'mangrove_swamp', 'mushroom_fields', 'snowy_slopes', 'frozen_peaks', 'jagged_peaks']);

// what burns and how readily (the wiki's table in flame.js, shared with the fire's model in models.js)
export const burns = b => burnOf(BLOCKS[b]);
export const catches = b => catchOf(BLOCKS[b]);
export const flammable = b => catchOf(BLOCKS[b]) > 0;

export function installFire(sim) {
  const fire = B.fire, soul = B.soul_fire;
  const isAir = b => !b || BLOCKS[b].name === 'cave_air' || BLOCKS[b].name === 'void_air';
  // a top face that holds a fire up: a full block, a top or double slab, upside-down stairs (the game's isFaceSturdy up)
  const sturdyTopAt = (x, y, z) => {
    const b = sim.get(x, y, z), d = b && BLOCKS[b];
    if (!d || !d.solid) return false;
    if (d.shape === 'cube') return true;
    if (d.shape === 'slab') return (sim.meta(x, y, z) & 3) >= 1;
    if (d.shape === 'stairs') return (sim.meta(x, y, z) & 4) !== 0;
    return false;
  };
  const nextToFuel = (x, y, z) => { for (const [dx, dy, dz] of NB6) if (flammable(sim.get(x + dx, y + dy, z + dz))) return true; return false; };
  // the game's difficulty as a number (0 peaceful .. 3 hard), for the spread
  const difficulty = s => {
    if (typeof s.difficulty === 'number') return s.difficulty;
    const E = s.game && s.game.entities, n = E && E.difficulty;
    return n === 'peaceful' ? 0 : n === 'easy' ? 1 : n === 'hard' ? 3 : 2;
  };
  const fireTicks = s => { const r = s.game && s.game.rules; return !(r && r.doFireTick === false); };
  const infiniburn = b => b === B.netherrack || b === B.magma_block || (/end$/.test(sim.dimension()) && b === B.bedrock);
  const soulBase = b => b === B.soul_sand || b === B.soul_soil;
  // can a fire stand here?
  sim.fireCanStay = (x, y, z) => sturdyTopAt(x, y - 1, z) || nextToFuel(x, y, z);
  // the odds a fire jumps into this air: the best encouragement of what is round it
  const igniteOdds = (x, y, z) => {
    if (!isAir(sim.get(x, y, z))) return 0;
    let o = 0;
    for (const [dx, dy, dz] of NB6) o = Math.max(o, catches(sim.get(x + dx, y + dy, z + dz)));
    return o;
  };
  const nearRain = (x, y, z) => sim.weather.rainingAt(x, y, z) || sim.weather.rainingAt(x - 1, y, z) || sim.weather.rainingAt(x + 1, y, z)
    || sim.weather.rainingAt(x, y, z - 1) || sim.weather.rainingAt(x, y, z + 1);
  // put a fire down (soul fire on soul sand), with its first tick 30-39 ticks off
  sim.lightFire = (x, y, z, age) => {
    const below = sim.get(x, y - 1, z);
    const id = soulBase(below) ? soul : fire;
    if (id === fire && !sim.fireCanStay(x, y, z)) return false;
    sim.set(x, y, z, id, age || 0);
    return true;
  };
  const burnOut = (x, y, z, chance, age) => {
    const b = sim.get(x, y, z);
    if (RI(sim, chance) >= burns(b)) return;
    const wasTnt = b === B.tnt;
    if (RI(sim, age + 10) < 5 && !sim.weather.rainingAt(x, y, z)) {
      const j = Math.min(age + Math.floor(RI(sim, 5) / 4), 15);
      sim.set(x, y, z, fire, j);
    } else sim.set(x, y, z, 0, 0);
    if (wasTnt && sim.primeTnt) sim.primeTnt(x, y, z, null, 80);
  };
  sim.on('fire', {
    // a fire that appears (lit, spread, or placed) starts ticking; one put where it cannot stand goes at once, and one
    // on soul sand or soul soil is soul fire (the game's onPlace and getState, so a fireball or a dispenser's is right too)
    onPlace(s, x, y, z) {
      // (in an obsidian frame it lights the portal instead: dim/realms.js)
      const R = s.game && s.game.realms;
      if (R && R.fireAt && R.fireAt(x, y, z)) return;
      if (!s.fireCanStay(x, y, z)) { s.set(x, y, z, 0, 0); return; }
      if (soul !== undefined && soulBase(s.get(x, y - 1, z))) { s.set(x, y, z, soul, 0); return; }
      s.schedule(x, y, z, 30 + RI(s, 10));
    },
    tick(s, x, y, z, m) {
      if (!fireTicks(s)) { s.schedule(x, y, z, 30 + RI(s, 10)); return; }
      if (!s.fireCanStay(x, y, z)) { s.set(x, y, z, 0, 0); return; }
      const below = s.get(x, y - 1, z), inf = infiniburn(below);
      const age = m & 15;
      if (!inf && s.weather.raining && nearRain(x, y, z) && s.rng() < 0.2 + age * 0.03) { s.set(x, y, z, 0, 0); return; }
      const na = Math.min(15, age + Math.floor(RI(s, 3) / 2));
      if (na !== age) { s.quietSet(x, y, z, fire, na); }
      if (!inf) {
        if (!nextToFuel(x, y, z)) {
          if (!sturdyTopAt(x, y - 1, z) || age > 3) s.set(x, y, z, 0, 0);
          else s.schedule(x, y, z, 30 + RI(s, 10));
          return;
        }
        if (age === 15 && RI(s, 4) === 0 && !flammable(below)) { s.set(x, y, z, 0, 0); return; }
      }
      const humid = HUMID.has(s.biomeAt(x, z).name), k = humid ? -50 : 0;
      burnOut(x + 1, y, z, 300 + k, age); burnOut(x - 1, y, z, 300 + k, age);
      burnOut(x, y - 1, z, 250 + k, age); burnOut(x, y + 1, z, 250 + k, age);
      burnOut(x, y, z - 1, 300 + k, age); burnOut(x, y, z + 1, 300 + k, age);
      const diff = difficulty(s);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 4; dy++) {
        if (!dx && !dy && !dz) continue;
        let l = 100;
        if (dy > 1) l += (dy - 1) * 100;
        const odds = igniteOdds(x + dx, y + dy, z + dz);
        if (odds <= 0) continue;
        let j = Math.floor((odds + 40 + diff * 7) / (age + 30));
        if (humid) j = Math.floor(j / 2);
        if (j > 0 && RI(s, l) <= j && !(s.weather.raining && nearRain(x + dx, y + dy, z + dz))) {
          s.set(x + dx, y + dy, z + dz, fire, Math.min(15, age + Math.floor(RI(s, 5) / 4)));
        }
      }
      if (s.get(x, y, z) === fire) s.schedule(x, y, z, 30 + RI(s, 10));
    },
    neighbor(s, x, y, z) { if (!s.fireCanStay(x, y, z)) s.set(x, y, z, 0, 0); },
    loot() { return []; },
  });
  if (soul !== undefined) sim.on('soul_fire', {
    neighbor(s, x, y, z) { if (!soulBase(s.get(x, y - 1, z))) s.set(x, y, z, 0, 0); },
    loot() { return []; },
  });

  /* ---- lava lights what is round it ---- */
  sim.on('lava', {
    random(s, x, y, z) {
      if (!fireTicks(s)) return;
      const i = RI(s, 3);
      if (i > 0) {
        let px = x, py = y, pz = z;
        for (let j = 0; j < i; j++) {
          px += RI(s, 3) - 1; py += 1; pz += RI(s, 3) - 1;
          if (!s.w.loaded(px, pz)) return;
          const b = s.get(px, py, pz);
          if (isAir(b)) { if (nextToFuel(px, py, pz)) { s.set(px, py, pz, fire, 0); return; } }
          else if (BLOCKS[b].solid) return;
        }
      } else {
        for (let k = 0; k < 3; k++) {
          const px = x + RI(s, 3) - 1, pz = z + RI(s, 3) - 1;
          if (!s.w.loaded(px, pz)) return;
          if (isAir(s.get(px, y + 1, pz)) && flammable(s.get(px, y, pz))) s.set(px, y + 1, pz, fire, 0);
        }
      }
    },
  });

  /* ---- flint and steel, fire charges ---- */
  const prev = sim.useItem;
  sim.useItem = (held, hit, heldId, sneaking) => {
    if (prev && prev(held, hit, heldId, sneaking)) return true;
    if (held !== 'flint_and_steel' && held !== 'fire_charge') return false;
    const b = sim.get(hit.x, hit.y, hit.z), n = b ? BLOCKS[b].name : '';
    // a fire charge is used up; flint and steel wears by 1 (interact.js passes wornHeld to the hand)
    // (the TNT's owner is the player entity, as the game's PrimedTnt owner is: net/events.js credits the blast to it)
    if (n === 'tnt') { sim.set(hit.x, hit.y, hit.z, 0, 0); sim.primeTnt(hit.x, hit.y, hit.z, (sim.game && sim.game.entities && sim.game.entities.player) || sim.player, 80); if (held === 'fire_charge') sim.usedHeld = true; else sim.wornHeld = 1; return true; }
    const f = hit.face, x = hit.x + f[0], y = hit.y + f[1], z = hit.z + f[2];
    if (!isAir(sim.get(x, y, z))) return false;
    if (!sim.lightFire(x, y, z, 0)) return false;
    if (held === 'fire_charge') sim.usedHeld = true; else sim.wornHeld = 1;
    return true;
  };

  /* a burning arrow or a fireball that hits TNT lights it; an unlit campfire or candle it hits is lit (rsparts.js
     tells of the hit; the game's onProjectileHit for each). TNT lit this way is owned by the projectile's
     owner when that is a living thing (TntBlock.onProjectileHit: the player who shot, a skeleton, a blaze) */
  sim.projectileFire = (x, y, z, owner) => {
    const b = sim.get(x, y, z), d = b && BLOCKS[b];
    if (!d) return;
    const m = sim.meta(x, y, z);
    if (b === B.tnt) { sim.set(x, y, z, 0, 0); if (sim.primeTnt) sim.primeTnt(x, y, z, owner && typeof owner === 'object' && typeof owner.hurt === 'function' && !owner.kind ? owner : null, 80); }
    else if (d.shape === 'campfire' && (m & 4)) sim.set(x, y, z, b, m & ~4);
    else if (/candle$|candle_cake$/.test(d.name) && !(m & 4)) sim.set(x, y, z, b, m | 4);
  };

  /* standing in fire hurts the player, and sets them burning: survival.js (with every other block that hurts) */
}
