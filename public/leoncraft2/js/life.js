/* ---------------------------------------------------------------------------
   Leoncraft 2 - dying and coming back, and the commands for effects and
   experience.

   survivalHooks(getGame, deps)  what survival.js asks the world round it:
                                 difficulty, game rules, rain, the player,
                                 and what to do on a death or a totem
   respawnPlayer(g, travel, deps)
       The game's respawn: the player's respawn point if it still works (a
       bed in a dimension where beds work, with room to stand beside it; a
       respawn anchor with a charge, which uses one; a /spawnpoint spot),
       otherwise "You have no home bed or charged respawn anchor, or it was
       obstructed" and the world spawn, somewhere on the ground within the
       spawnRadius rule (10) of it.

   Commands: /effect give|clear, /xp (add, set, query), /spawnpoint (the
   player's own respawn point, as the game's is).
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=107';
import { gameRule, register } from './commands.js?v=107';
import { DIMS } from './dims.js?v=107';
import { Y0 } from './world-const.js?v=107';
import { EFFECTS, effectId, effectName } from './effects.js?v=107';
import { xpForLevel } from './survival.js?v=107';
import { Account } from './net/account.js?v=107';

/* ---- what survival.js asks ---- */
export function survivalHooks(getGame, deps) {
  const g = () => getGame();
  return {
    difficulty: () => (deps.options && deps.options.get('difficulty')) || (g() && g().entry.difficulty) || 'normal',
    rule: name => gameRule(g(), name),
    mode: () => (g() ? g().mode : 'survival'),
    rainingAt: (x, y, z) => { const G = g(); return !!(G && G.sim && G.sim.weather && G.sim.weather.rainingAt(x, y, z)); },
    player: () => g() && g().player,
    riding: () => { const G = g(); return !!(G && G.entities && G.entities.riding); },
    // (your account's name: net/account.js)
    name: () => Account.name || 'Player',
    hardcore: () => !!(g() && g().entry.hardcore),
    // the death message goes to chat (the showDeathMessages rule)
    onDeath: message => { if (gameRule(g(), 'showDeathMessages') && deps.chat) { deps.chat.add(message, 0xFFFFFF); } },
    // the totem: a burst of green and gold round the player (the HUD shows the totem itself)
    onTotem: () => {
      const G = g(), P = G && G.player, parts = deps.renderer && deps.renderer.particles;
      if (!P || !parts) return;
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2, s = 0.15 + Math.random() * 0.35, up = 0.2 + Math.random() * 0.45;
        const c = Math.random() < 0.6 ? (Math.random() < 0.5 ? 0x9FE34F : 0x5FC93A) : (Math.random() < 0.5 ? 0xF2D64B : 0xE8B83A);
        parts.spawn(P.pos.x, P.pos.y + 1 + Math.random() * 0.6, P.pos.z, Math.cos(a) * s, up, Math.sin(a) * s,
          { colour: c, size: 0.12 + Math.random() * 0.06, life: 40 + Math.floor(Math.random() * 30), gravity: 0.35, friction: 0.92, physics: false });
      }
    },
  };
}

/* ---- respawning ---- */
const solid = b => !!b && !!BLOCKS[b] && BLOCKS[b].solid;
const free = b => !b || (!!BLOCKS[b] && !BLOCKS[b].solid && !FLUID[b] && BLOCKS[b].name !== 'lava');
// a two-high gap with something to stand on, beside (x, y, z): the nearest ring first, the same level first
export function standUpNear(w, x, y, z) {
  for (let r = 1; r <= 2; r++) for (const dy of [0, 1, -1]) {
    let best = null, bd = 1e9;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const a = x + dx, b = y + dy, c = z + dz;
      const below = w.get(a, b - 1, c);
      if (!solid(below) || !free(w.get(a, b, c)) || !free(w.get(a, b + 1, c))) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = { x: a + 0.5, y: b + (BLOCKS[below].shape === 'bed' ? -0.4375 : BLOCKS[below].shape === 'slab' ? -0.5 : 0), z: c + 0.5 }; }
    }
    if (best) {
      // facing the bed or anchor
      best.yaw = Math.atan2(-(x + 0.5 - best.x), -(z + 0.5 - best.z));
      return best;
    }
  }
  return null;
}
// where a respawn point puts you in its world, or null if it no longer works
export function respawnSpot(w, sp, creative) {
  const dim = DIMS[w.dim || 'overworld'] || DIMS.overworld;
  const b = w.get(sp.x, sp.y, sp.z), d = BLOCKS[b];
  if (sp.kind === 'bed') {
    if (!d || d.shape !== 'bed' || !dim.bedsWork) return null;
    return standUpNear(w, sp.x, sp.y, sp.z);
  }
  if (sp.kind === 'anchor') {
    if (b !== B.respawn_anchor || !dim.anchorsWork) return null;
    const charges = w.meta(sp.x, sp.y, sp.z) & 7;
    if (charges <= 0) return null;
    const at = standUpNear(w, sp.x, sp.y, sp.z);
    if (at && !sp.forced) w.set(sp.x, sp.y, sp.z, B.respawn_anchor, charges - 1);
    return at;
  }
  // a /spawnpoint: that very spot, if there is room
  if (free(w.get(sp.x, sp.y, sp.z)) && free(w.get(sp.x, sp.y + 1, sp.z))) return { x: sp.x + 0.5, y: sp.y, z: sp.z + 0.5 };
  return sp.forced ? standUpNear(w, sp.x, sp.y, sp.z) : null;
}
// the world spawn: a random spot on solid, dry ground within the spawnRadius rule of it
export function worldSpawnSpot(w, g, groundY) {
  const r = Math.max(0, gameRule(g, 'spawnRadius') | 0), sx = g.spawn.x, sz = g.spawn.z;
  for (let k = 0; k < (r > 0 ? 24 : 0); k++) {
    const x = sx + Math.floor(Math.random() * (2 * r + 1)) - r, z = sz + Math.floor(Math.random() * (2 * r + 1)) - r;
    const y = groundY(w, x, z);
    if (y <= 0) continue;
    const under = w.get(x, y - 1, z);
    if (!solid(under) || FLUID[under] || BLOCKS[under].leaves || !free(w.get(x, y, z)) || !free(w.get(x, y + 1, z))) continue;
    return { x: x + 0.5, y, z: z + 0.5 };
  }
  const y = groundY(w, sx, sz);
  return { x: sx + 0.5, y: y > 0 ? y : 120, z: sz + 0.5 };
}
/* The whole respawn: survival's numbers back (keepInventory keeps the
   experience), then the respawn point, or the world spawn. travel(dim,
   resolve, near) is main.js's way of going to a place (in this dimension or
   another). */
export async function respawnPlayer(g, travel, deps) {
  const sv = g.survival, sp = sv.spawnPoint;
  if (sp && DIMS[sp.dim]) {
    const ok = await travel(sp.dim, w => respawnSpot(w, sp, g.mode === 'creative'), { x: sp.x, z: sp.z });
    if (ok) return true;
    sv.spawnPoint = null;
    if (deps.say) deps.say('You have no home bed or charged respawn anchor, or it was obstructed');
  }
  return travel('overworld', w => worldSpawnSpot(w, g, deps.groundY), g.spawn);
}

/* ---- commands ---- */
const RED = 0xFF5555;
class CmdError extends Error {}
const fail = m => { throw new CmdError(m); };
const isSelf = (s, ctx) => s === undefined || /^@[spare]$/.test(s) || s.toLowerCase() === ctx.playerName.toLowerCase();
function int(s, lo, hi) {
  const v = Number(s);
  if (!Number.isInteger(v)) fail('Expected an integer: ' + s);
  if (v < lo) fail(`Integer must not be less than ${lo}, found ${v}`);
  if (v > hi) fail(`Integer must not be more than ${hi}, found ${v}`);
  return v;
}
const run = fn => (args, ctx) => { try { fn(args, ctx); } catch (e) { if (e instanceof CmdError) ctx.say(e.message, RED); else throw e; } };

register('effect', {
  usage: 'give|clear <targets> [<effect>] [<seconds>|infinite] [<amplifier>] [<hideParticles>]',
  suggest: i => i === 0 ? ['give', 'clear'] : i === 1 ? ['@s'] : i === 2 ? Object.keys(EFFECTS).map(n => 'minecraft:' + n) : i === 3 ? ['30', 'infinite'] : i === 5 ? ['true', 'false'] : [],
  run: run((args, ctx) => {
    const op = args[0], sv = ctx.game && ctx.game.survival;
    if (op !== 'give' && op !== 'clear') fail('Incomplete command');
    if (!isSelf(args[1], ctx)) fail('No entity was found');
    if (op === 'clear') {
      if (args[2] === undefined) {
        if (!sv.clearEffects()) fail('Target has no effects to remove');
        ctx.say(`Removed every effect from ${ctx.playerName}`);
        return;
      }
      const n = effectId(args[2]);
      if (!n) fail(`Unknown effect: ${args[2]}`);
      if (!sv.removeEffect(n)) fail('Target doesn\'t have the requested effect');
      ctx.say(`Removed effect ${effectName(n, 1)} from ${ctx.playerName}`);
      return;
    }
    const n = effectId(args[2]);
    if (!args[2]) fail('Incomplete command');
    if (!n) fail(`Unknown effect: ${args[2]}`);
    const def = EFFECTS[n];
    let ticks;
    if (args[3] === 'infinite') ticks = -1;
    else if (args[3] !== undefined) ticks = int(args[3], 1, 1000000) * 20;
    else ticks = def.instant ? 1 : 600;
    const amp = args[4] !== undefined ? int(args[4], 0, 255) : 0;
    const hide = args[5] === 'true';
    if (ctx.game.mode === 'creative' || ctx.game.mode === 'spectator') { /* creative players take effects too */ }
    if (!sv.addEffect(n, amp + 1, ticks, { hideParticles: hide })) fail('Unable to apply this effect (target is either immune to effects, or has something stronger)');
    ctx.say(`Applied effect ${effectName(n, 1)} to ${ctx.playerName}`);
  }),
});
register('spawnpoint', {
  usage: '[<targets>] [<pos>] [<angle>]',
  run: run((args, ctx) => {
    const g = ctx.game, p = g.player;
    if (args[0] !== undefined && !/^[~^\-\d]/.test(args[0])) { if (!isSelf(args[0], ctx)) fail('No player was found'); args = args.slice(1); }
    const c = (s, base, isY) => { if (s === undefined) fail('Incomplete command'); if (s.startsWith('~')) return base + (s.length > 1 ? Number(s.slice(1)) : 0); const v = Number(s); if (!isFinite(v)) fail('Expected a number: ' + s); return v; };
    const [x, y, z] = args.length >= 3 ? [Math.floor(c(args[0], p.pos.x)), Math.floor(c(args[1], p.pos.y + Y0, true)), Math.floor(c(args[2], p.pos.z))]
      : [Math.floor(p.pos.x), Math.floor(p.pos.y + Y0), Math.floor(p.pos.z)];
    g.survival.spawnPoint = { dim: g.dim || 'overworld', x, y: y - Y0, z, kind: 'point', forced: true };
    ctx.say(`Set spawn point to ${x}, ${y}, ${z} [0.0] in minecraft:${g.dim || 'overworld'} for ${ctx.playerName}`);
  }),
});

register('xp', {
  usage: '(add|set|query) <targets> [<amount>] [points|levels]', aliases: ['experience'],
  suggest: i => i === 0 ? ['add', 'set', 'query'] : i === 1 ? ['@s'] : i === 3 ? ['points', 'levels'] : [],
  run: run((args, ctx) => {
    const op = args[0], sv = ctx.game && ctx.game.survival, P = ctx.playerName;
    if (!['add', 'set', 'query'].includes(op)) fail('Incomplete command');
    if (!isSelf(args[1], ctx)) fail('No player was found');
    if (op === 'query') {
      const lv = args[2] === 'levels';
      if (args[2] !== undefined && args[2] !== 'levels' && args[2] !== 'points') fail('Incorrect argument for command');
      ctx.say(`${P} has ${lv ? sv.level : sv.xpPoints()} experience ${lv ? 'levels' : 'points'}`);
      return;
    }
    if (args[2] === undefined) fail('Incomplete command');
    const n = int(args[2], op === 'set' ? 0 : -2147483648, 2147483647), lv = args[3] === 'levels';
    if (args[3] !== undefined && args[3] !== 'levels' && args[3] !== 'points') fail('Incorrect argument for command');
    if (op === 'add') {
      if (lv) sv.addLevels(n); else sv.addXp(n);
      ctx.say(`Gave ${n} experience ${lv ? 'levels' : 'points'} to ${P}`);
      return;
    }
    if (lv) sv.level = n;
    else {
      if (n > xpForLevel(sv.level)) fail('Unable to set experience points above the maximum points for the player\'s current level');
      sv.xpProgress = n / xpForLevel(sv.level);
    }
    ctx.say(`Set ${n} experience ${lv ? 'levels' : 'points'} on ${P}`);
  }),
});
