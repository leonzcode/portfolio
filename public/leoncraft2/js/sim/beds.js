/* ---------------------------------------------------------------------------
   Leoncraft 2 - beds and respawn anchors (Minecraft Wiki, Java Edition).

   Using a bed, in the game's order:
     - where beds do not work (the Nether, the End) it blows up: power 5,
       with fire, at the head;
     - "This bed is occupied" if someone is in it;
     - "You may not rest now; the bed is too far away" beyond 3 blocks across
       or 2 up and down; "This bed is obstructed" under a solid block;
     - the respawn point is set there ("Respawn point set");
     - "You can sleep only at night and during thunderstorms" by day (the
       sky's light not yet 4 down: clear nights 12 542-23 459, rainy
       12 010-23 991, any time in a storm);
     - "You may not rest now; there are monsters nearby" with a monster
       within 8 blocks across and 5 up or down (survival);
     - otherwise you lie down. After 100 ticks asleep the night is skipped to
       the next morning (time to the next multiple of 24 000) and the rain
       stops. Sneaking gets you up.
   Dying with a bed sends you back beside it; if it has gone, "You have no
   home bed or charged respawn anchor, or it was obstructed" and the world's
   spawn.

   A respawn anchor takes glowstone (up to 4 charges). Used without
   glowstone in the Nether it sets the respawn point; anywhere else it blows
   up like a bed. Respawning at one uses a charge.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];      // north east south west, as the bed's facing bits
export const bedsWork = dim => !dim || dim === 'overworld';
// hostile, but not the game's monsters, so they let you sleep
const NOT_MONSTERS = new Set(['slime', 'magma_cube', 'ghast', 'happy_ghast', 'phantom', 'shulker', 'hoglin']);
export const anchorsWork = dim => dim === 'nether' || dim === 'the_nether';

/* The player's respawn point (one for the whole game, kept by survival.js):
   true when it moved. */
function setSpawn(sim, x, y, z, kind) {
  const g = sim.game, sv = g && g.survival;
  if (!sv) return true;
  const dim = g.dim || 'overworld', was = sv.spawnPoint;
  sv.spawnPoint = { dim, x, y, z, kind };
  return !was || was.dim !== dim || was.x !== x || was.y !== y || was.z !== z;
}

export function installBeds(sim) {
  const msg = t => sim.msg.show(t);
  const isBed = b => b && BLOCKS[b].shape === 'bed';
  // the head of the bed a cell belongs to
  const headOf = (x, y, z) => {
    const b = sim.get(x, y, z), m = sim.meta(x, y, z);
    if (m & 8) return [x, y, z, m];
    const [dx, dz] = DIRS[m & 3];
    if (sim.get(x + dx, y, z + dz) === b) return [x + dx, y, z + dz, sim.meta(x + dx, y, z + dz)];
    return [x, y, z, m | 8];
  };
  const footOf = (hx, hy, hz, m) => { const [dx, dz] = DIRS[m & 3]; return [hx - dx, hy, hz - dz]; };
  const monstersNear = (x, y, z) => {
    const L = window.__lc2;
    if (!L || !L.entities) return false;
    const E = L.entities;
    if (typeof E.monstersNear === 'function') return !!E.monstersNear(x, y, z, 8, 5);
    if (typeof E.forNear !== 'function') return false;
    // (a monster whose box reaches within 8 across and 5 up or down of the bed's foot; a zombified piglin only when it is cross with you)
    const cx = x + 0.5, cz = z + 0.5;
    let found = false;
    E.forNear(cx, cz, 10, e => {
      if (found || e.removed || e.dead || e.constructor.CATEGORY !== 'monster' || NOT_MONSTERS.has(e.type)) return;
      if (e.type === 'zombified_piglin' && !(e.angerT > 0 && e.angryAt && e.angryAt.isPlayer)) return;
      const hw = e.hw || 0.3, h = e.h || 1.8;
      if (e.pos.x + hw > cx - 8 && e.pos.x - hw < cx + 8 && e.pos.z + hw > cz - 8 && e.pos.z - hw < cz + 8 && e.pos.y + h > y - 5 && e.pos.y < y + 5) found = true;
    });
    return found;
  };
  const suffocating = b => b && BLOCKS[b].solid && BLOCKS[b].shape === 'cube';
  const inReach = (x, y, z) => {
    const p = sim.player.pos;
    return Math.abs(p.x - (x + 0.5)) <= 3.5 && Math.abs(p.y - y) <= 2.5 && Math.abs(p.z - (z + 0.5)) <= 3.5;
  };

  sim.onAll(d => d.shape === 'bed', {
    use(s, x, y, z) {
      const [hx, hy, hz, hm] = headOf(x, y, z);
      const [fx, , fz] = footOf(hx, hy, hz, hm);
      if (!bedsWork(s.dimension())) {
        s.set(hx, hy, hz, 0, 0);
        if (isBed(s.get(fx, hy, fz))) s.set(fx, hy, fz, 0, 0);
        s.explode(hx + 0.5, hy + 0.5, hz + 0.5, 5, { fire: true, decay: 'block', source: 'bad_respawn_point' });
        return true;
      }
      if (hm & 4) { msg('This bed is occupied'); return true; }
      if (!inReach(hx, hy, hz) && !inReach(fx, hy, fz)) { msg('You may not rest now; the bed is too far away'); return true; }
      if (suffocating(s.get(hx, hy + 1, hz))) { msg('This bed is obstructed'); return true; }
      const was = s.spawnBed;
      s.spawnBed = { x: hx, y: hy, z: hz, kind: 'bed' };
      if (setSpawn(s, hx, hy, hz, 'bed')) msg('Respawn point set');
      if (s.skyDarken() < 4) { setTimeout(() => msg('You can sleep only at night and during thunderstorms'), was && was.x === hx && was.y === hy && was.z === hz ? 0 : 900); return true; }
      if (!s.creative && monstersNear(hx, hy, hz)) { msg('You may not rest now; there are monsters nearby'); return true; }
      s.sleep(hx, hy, hz, hm);
      return true;
    },
    removed(s, x, y, z) { if (s.sleeping && s.sleeping.x === x && s.sleeping.y === y && s.sleeping.z === z) s.wake(); },
    exploded(s, x, y, z) { s.set(x, y, z, 0, 0); },
    loot(s, b, m) { return m & 8 ? [[BLOCKS[b].name, 1]] : []; },
  });

  /* ---- sleeping ---- */
  sim.sleep = (hx, hy, hz, hm) => {
    const p = sim.player;
    sim.sleeping = { x: hx, y: hy, z: hz, t: 0, from: [p.pos.x, p.pos.y, p.pos.z] };
    sim.quietSet(hx, hy, hz, sim.get(hx, hy, hz), hm | 4);
    p.pos.set(hx + 0.5, hy + 0.5625, hz + 0.5); p.prev.copy(p.pos); p.vel.set(0, 0, 0);
    p.sleeping = true;
  };
  sim.wake = (skipped) => {
    const z = sim.sleeping;
    if (!z) return;
    sim.sleeping = null;
    const p = sim.player;
    p.sleeping = false;
    const b = sim.get(z.x, z.y, z.z);
    if (isBed(b)) sim.quietSet(z.x, z.y, z.z, b, sim.meta(z.x, z.y, z.z) & ~4);
    // up beside the bed
    const spot = sim.standUpNear(z.x, z.y, z.z) || z.from;
    p.pos.set(spot[0], spot[1], spot[2]); p.prev.copy(p.pos); p.vel.set(0, 0, 0);
    sim.wakeFade = 20;
  };
  // somewhere to stand beside a bed or anchor: a free two-high space on something solid
  sim.standUpNear = (x, y, z) => {
    const free = (a, b, c) => { const k = sim.get(a, b, c); return !k || !BLOCKS[k].solid; };
    for (let r = 1; r <= 2; r++) for (let dy = 0; dy <= 1; dy++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const a = x + dx, b = y + dy - (dy ? 0 : 0), c = z + dz;
      const below = sim.get(a, b - 1, c);
      if (below && BLOCKS[below].solid && free(a, b, c) && free(a, b + 1, c)) return [a + 0.5, b + (BLOCKS[below].shape === 'bed' ? -0.4375 : 0), c + 0.5];
    }
    return null;
  };
  (sim.tickers = sim.tickers || []).push(() => {
    const z = sim.sleeping, p = sim.player;
    if (sim.wakeFade > 0) { sim.wakeFade--; sim.msg.dark = sim.wakeFade / 20 * 0.7; }
    if (!z) return;
    // lying still in the bed; sneaking gets you up
    p.pos.set(z.x + 0.5, z.y + 0.5625, z.z + 0.5); p.vel.set(0, 0, 0);
    if (p.keys && p.keys.shift) { sim.wake(false); return; }
    for (const k in p.keys || {}) p.keys[k] = false;
    z.t++;
    sim.msg.dark = Math.min(1, z.t / 100) * 0.7;
    // (on a server, only once everyone in the Overworld is asleep: net/net.js)
    if (z.t >= 100 && !(sim.othersAwake && sim.othersAwake(z.t))) {
      // the night passes: the next morning, and the rain stops
      const t = sim.time + 24000;
      sim.time = t - (t % 24000);
      if (sim.weather.raining || sim.weather.rainingFlag) sim.weather.clearBySleep();
      sim.weather.now(false);
      sim.wake(true);
    }
  });

  /* ---- dying wakes you; where you come back is the player's respawn point (life.js) ---- */
  (sim.tickers = sim.tickers || []).push(() => {
    const g = sim.game;
    if (g && g.survival && g.survival.dead && sim.sleeping) sim.wake(false);
  });

  /* ---- respawn anchors ---- */
  if (B.respawn_anchor !== undefined) sim.on('respawn_anchor', {
    use(s, x, y, z, m, held) {
      const charges = m & 7;
      if (held === 'glowstone' && charges < 4) { s.set(x, y, z, B.respawn_anchor, charges + 1); if (!s.creative) s.usedHeld = true; return true; }
      if (charges === 0) return false;
      if (!anchorsWork(s.dimension())) {
        s.set(x, y, z, 0, 0);
        // water beside it stops the blast breaking blocks (the game's own exception)
        let wet = false;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (s.get(x + dx, y + dy, z + dz) === B.water) wet = true;
        s.explode(x + 0.5, y + 0.5, z + 0.5, 5, { fire: !wet, decay: 'block', breaks: !wet, source: 'bad_respawn_point' });
        return true;
      }
      s.spawnBed = { x, y, z, kind: 'anchor' };
      if (setSpawn(s, x, y, z, 'anchor')) msg('Respawn point set');
      return true;
    },
  });
  sim.bedsWork = bedsWork; sim.anchorsWork = anchorsWork;
}
