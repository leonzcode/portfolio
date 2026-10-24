/* ---------------------------------------------------------------------------
   Leoncraft 2 - explosions, the way the Minecraft Wiki describes them.

   Blocks: 1352 rays leave the centre, towards every point on the surface of
   a 16 x 16 x 16 cube. Each starts with a strength of power x (0.7 to 1.3)
   and steps 0.3 blocks at a time; every block it passes through takes
   (blast resistance + 0.3) x 0.3 off it, and a further 0.225 goes with each
   step. A block the ray still has strength left at is destroyed. Water and
   lava have a resistance of 100, so an explosion in water breaks nothing.
   Blocks blown up drop with a chance of 1 / power when the game rule for
   that kind says so (../explosion.js dropDecay: mobExplosionDropDecay for
   creepers, fireballs and the wither, tntExplosionDropDecay for a TNT
   minecart), gathered into stacks of up to 16 of a kind as the game does.
   Items and orbs lying in the blast are hurt first (drops.js blast).

   Entities: everything within twice the power. Its "exposure" is the share
   of a grid of points over its box that can see the centre. The impact is
   (1 - distance / (2 x power)) x exposure; the damage is
   (impact^2 + impact) / 2 x 7 x 2 x power + 1, and it is pushed away from
   the centre by the impact (towards its eyes, for the living).
--------------------------------------------------------------------------- */
import { BLOCKS, FLUID, B } from '../blocks.js?v=107';
import { blastResistance } from './terrain.js?v=107';
import { breakAt } from '../place.js?v=107';
import { BLAST_FILTER, dropDecay, exposure as seenBy } from '../explosion.js?v=107';
import { WORLD_FX } from '../world.js?v=107';
import { dropOf } from '../survival.js?v=107';
import { Living } from './entity.js?v=107';

const R = () => Math.random();
// the 1352 ray directions, made once
const RAYS = (() => {
  const out = [];
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
    if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
    let x = i / 15 * 2 - 1, y = j / 15 * 2 - 1, z = k / 15 * 2 - 1;
    const l = Math.hypot(x, y, z);
    out.push(x / l, y / l, z / l);
  }
  return new Float64Array(out);
})();

// what share of points over a box can see (cx, cy, cz)
export function exposure(T, x0, y0, z0, x1, y1, z1, cx, cy, cz) {
  const sx = 1 / ((x1 - x0) * 2 + 1), sy = 1 / ((y1 - y0) * 2 + 1), sz = 1 / ((z1 - z0) * 2 + 1);
  if (sx < 0 || sy < 0 || sz < 0) return 0;
  const ox = (1 - Math.floor(1 / sx) * sx) / 2, oz = (1 - Math.floor(1 / sz) * sz) / 2;
  let seen = 0, all = 0;
  for (let a = 0; a <= 1; a += sx) for (let b = 0; b <= 1; b += sy) for (let c = 0; c <= 1; c += sz) {
    const px = x0 + (x1 - x0) * a + ox, py = y0 + (y1 - y0) * b, pz = z0 + (z1 - z0) * c + oz;
    if (T.sees(px, py, pz, cx, cy, cz)) seen++;
    all++;
  }
  return all ? seen / all : 0;
}

export function explode(m, cx, cy, cz, power, source, o = {}) {
  const T = m.t, W = m.world;
  const hit = new Map();
  const breaks = o.breakBlocks !== false && !(source && source.mob && m.mobGriefing === false);
  if (breaks) {
    for (let r = 0; r < RAYS.length; r += 3) {
      const dx = RAYS[r] * 0.3, dy = RAYS[r + 1] * 0.3, dz = RAYS[r + 2] * 0.3;
      let s = power * (0.7 + R() * 0.6), x = cx, y = cy, z = cz;
      while (s > 0) {
        const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
        if (!T.loaded(bx, bz)) break;
        const b = T.get(bx, by, bz);
        // (what a minigame keeps: the blast stops there, explosion.js BLAST_FILTER)
        if (b && BLAST_FILTER.fn && !BLAST_FILTER.fn(bx, by, bz)) break;
        if (b) {
          s -= (blastResistance(b) + 0.3) * 0.3;
          if (s > 0 && !FLUID[b]) hit.set(bx + ',' + by + ',' + bz, [bx, by, bz]);
        }
        x += dx; y += dy; z += dz;
        s -= 0.22500001;
      }
    }
  }
  // the entities
  const r2 = power * 2;
  const P = m.player;
  const push = (e, isP) => {
    const ex = e.pos.x, ey = e.pos.y, ez = e.pos.z;
    const d = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2 + (ez - cz) ** 2) / r2;
    if (d > 1) return;
    const eye = ey + (e.eyeH !== undefined ? e.eyeH : 1.62);
    let vx = ex - cx, vy = eye - cy, vz = ez - cz;
    const l = Math.hypot(vx, vy, vz);
    if (l < 1e-6) return;
    vx /= l; vy /= l; vz /= l;
    const hw = e.hw !== undefined ? e.hw : 0.3, h = e.h || 1.8;
    const ex2 = exposure(T, ex - hw, ey, ez - hw, ex + hw, ey + h, ez + hw, cx, cy, cz);
    const imp = (1 - d) * ex2;
    const dmg = Math.floor((imp * imp + imp) / 2 * 7 * r2 + 1);
    const src = { type: 'explosion', attacker: source && source.attacker, x: cx, z: cz, noKnock: true, explosion: true };
    if (isP) { m.hurtPlayer(dmg, src); m.player.push(vx * imp, vy * imp, vz * imp); }
    else {
      if (e.hurt) e.hurt(dmg, src);
      const k = imp * (1 - (e.kbResist || 0) * (e.constructor.EXPLOSION_KB_RESIST ? 1 : 0));
      e.vel.x += vx * k; e.vel.y += vy * k; e.vel.z += vz * k;
    }
  };
  if (P && P.alive() && !P.creative()) push(P, true);
  m.forNear(cx, cz, r2 + 2, e => { if (!e.removed && e !== (source && source.attacker)) push(e, false); });
  // the items and orbs lying in it, before the blocks go (so what it breaks out is not blown up by it)
  const L = window.__lc2, D = L && L.game && L.game.drops;
  if (D && D.blast && power > 0) D.blast(cx, cy, cz, power, box => seenBy(W, cx, cy, cz, box));
  // the blocks go, some dropping (RIP Computer: bursting into pieces, with a flash and smoke: render/realism.js)
  if (WORLD_FX.blast) WORLD_FX.blast(cx, cy, cz, power);
  // (a TNT minecart is TNT; anything else that comes here, creepers, fireballs a ghast threw, the wither, is a mob's)
  const chance = dropDecay(source && source.tnt ? 'tnt' : 'mob') ? 1 / power : 1;
  // what the blocks drop, gathered into stacks of up to 16 of a kind (the game's addOrAppendStack), thrown out after
  const got = [];
  const gather = (name, x, y, z) => {
    for (const g of got) if (g.name === name && g.n < 16) { g.n++; return; }
    got.push({ name, n: 1, x, y, z });
  };
  /* TNT in the blast is lit with a short fuse (the game's TntBlock.wasExploded: 10 to 29 ticks), owned by the
     blast's indirect source as ServerExplosion.getIndirectSourceEntity has it: the creeper or the wither itself,
     a fireball's living shooter; a TNT minecart is not living, so its chain is no one's */
  const sim = m.sim, att = source && source.attacker;
  const owner = att && (att instanceof Living || att.isPlayer) ? att : null;
  for (const [x, y, z] of hit.values()) {
    const b = W.get(x, y, z);
    if (!b) continue;
    if (b === B.tnt && sim && sim.primeTnt) { W.set(x, y, z, 0, 0); sim.primeTnt(x, y, z, owner, 10 + Math.floor(R() * 20)); continue; }
    for (const [gx, gy, gz] of breakAt(W, x, y, z)) {
      const gb = W.get(gx, gy, gz);
      if (!gb) continue;
      if (R() < chance && o.drops !== false && !(BLAST_FILTER.noDrops && BLAST_FILTER.noDrops())) { const d = dropOf(gb); if (d && BLOCKS[d]) gather(BLOCKS[d].name, gx + 0.5, gy + 0.5, gz + 0.5); }
      W.set(gx, gy, gz, 0, 0);
      if (BLOCKS[gb] && BLOCKS[gb].waterlogged) W.set(gx, gy, gz, B.water, 0);
      if (m.fluids) m.fluids.around(gx, gy, gz);
    }
    if (o.fire && R() < 1 / 3 && !W.get(x, y, z) && BLOCKS[W.get(x, y - 1, z)] && BLOCKS[W.get(x, y - 1, z)].solid && B.fire !== undefined) W.set(x, y, z, B.fire, 0);
  }
  for (const g of got) m.dropItemAt(g.x, g.y, g.z, g.name, g.n, true);
  // the flash and the smoke
  m.particles(power >= 2 && breaks ? 'explosion_big' : 'explosion', cx, cy, cz, 1, 0);
  m.particles('explosion', cx, cy, cz, Math.round(power * 4), power * 0.6);
  if (m.onExplode) m.onExplode(cx, cy, cz, power, source);
  return hit.size;
}
