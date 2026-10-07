/* ---------------------------------------------------------------------------
   Leoncraft 2 - commands, typed into chat after a slash.

   The game's own commands with its own replies, for worlds with Allow
   Commands on (creative worlds by default, as in the game). Coordinates take
   ~ (relative) and ^ (local, along where you look); targets take @s, @p and
   the player's name. Other parts of the game add their own commands with
   register() (mobs add /summon, structures /locate, and so on).

   Each command gets a context: ctx.game (the world being played), and
   ctx.say(text, colour) for the reply.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from './blocks.js?v=22';
import { Y0 } from './world-const.js?v=22';

const REG = new Map();
export function register(name, def) { REG.set(name, def); for (const a of def.aliases || []) REG.set(a, def); }
export function commandNames() { return [...new Set([...REG.keys()])].sort(); }
// a command as registered (net/net.js builds the server's versions of a few on them)
export const commandDef = name => REG.get(name);

const RED = 0xFF5555, GREY = 0xAAAAAA;
class CommandError extends Error {}
const fail = msg => { throw new CommandError(msg); };

/* ---- reading arguments ---- */
// one coordinate: a number, ~ relative to base, ~5 offset
function coord(s, base, isY) {
  if (s === undefined) fail('Incomplete command');
  if (s.startsWith('~')) { const r = s.slice(1); return base + (r ? num(r) : 0); }
  const v = num(s);
  // whole numbers stand for the middle of the block across (as the game does), not up
  return !isY && /^-?\d+$/.test(s) ? v + 0.5 : v;
}
function num(s) { const v = Number(s); if (!isFinite(v)) fail('Expected a number: ' + s); return v; }
function int(s, min = -Infinity, max = Infinity) {
  const v = num(s); if (!Number.isInteger(v)) fail('Expected an integer: ' + s);
  if (v < min) fail(`Integer must not be less than ${min}, found ${v}`);
  if (v > max) fail(`Integer must not be more than ${max}, found ${v}`);
  return v;
}
// x y z in world terms (y as the player sees it, -64..319); ^ ^ ^ is left, up, forward from the eye
function position(args, i, p) {
  if (args[i] && args[i].startsWith('^')) {
    const l = +(args[i].slice(1) || 0), u = +(args[i + 1].slice(1) || 0), f = +(args[i + 2].slice(1) || 0);
    const yaw = p.yaw, pitch = p.pitch;
    const fx = -Math.sin(yaw) * Math.cos(pitch), fy = Math.sin(pitch), fz = -Math.cos(yaw) * Math.cos(pitch);
    const lx = -Math.cos(yaw), lz = Math.sin(yaw);
    const ux = -Math.sin(yaw) * -Math.sin(pitch), uy = Math.cos(pitch), uz = -Math.cos(yaw) * -Math.sin(pitch);
    const ey = p.pos.y + 1.62;
    return [p.pos.x + fx * f + lx * l + ux * u, ey + fy * f + uy * u + Y0, p.pos.z + fz * f + lz * l + uz * u];
  }
  return [coord(args[i], p.pos.x, false), coord(args[i + 1], p.pos.y + Y0, true), coord(args[i + 2], p.pos.z, false)];
}
function blockPos(args, i, p) {
  const [x, y, z] = position(args, i, p);
  return [Math.floor(x), Math.floor(y), Math.floor(z)];
}
// a block by name, with or without minecraft:
function blockId(s) {
  if (!s) fail('Incomplete command');
  const name = s.replace(/^minecraft:/, '').replace(/\[.*$/, '');
  if (name === 'air') return 0;
  const id = B[name];
  if (id === undefined) fail(`Unknown block type '${s}'`);
  return id;
}
function self(s, ctx) {
  if (s === undefined || s === '@s' || s === '@p' || s === '@a' || s.toLowerCase() === ctx.playerName.toLowerCase()) return ctx.game.player;
  if (s === '@e' || s === '@r') return ctx.game.player;
  fail('No player was found');
}
const titleCase = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export function displayName(id) { const d = BLOCKS[id]; return d ? (d.display || titleCase(d.name)) : 'Air'; }

/* ---- running a line ---- */
export function execute(line, ctx) {
  const args = line.trim().replace(/^\//, '').split(/\s+/).filter(Boolean);
  const name = (args.shift() || '').replace(/^minecraft:/, '');
  const def = REG.get(name);
  if (!def) { ctx.say('Unknown or incomplete command, see below for error', RED); ctx.say(line + '<--[HERE]', RED); return false; }
  if (!ctx.cheats && !def.always) { ctx.say('You do not have permission to use this command', RED); return false; }
  try {
    def.run(args, ctx);
    return true;
  } catch (e) {
    if (e instanceof CommandError) ctx.say(e.message, RED);
    else { console.error(e); ctx.say('An unexpected error occurred trying to execute that command', RED); }
    return false;
  }
}
// what Tab offers for the word being typed
export function complete(line) {
  const words = line.replace(/^\//, '').split(' ');
  if (words.length === 1) return commandNames().filter(n => n.startsWith(words[0])).map(n => '/' + n);
  const def = REG.get(words[0]);
  if (!def || !def.suggest) return [];
  const opts = def.suggest(words.length - 2, words.slice(1)) || [];
  const last = words[words.length - 1];
  return opts.filter(o => o.startsWith(last)).map(o => '/' + words.slice(0, -1).concat(o).join(' '));
}

/* ---- the commands ---- */
const MODE_NAMES = { survival: 'Survival Mode', creative: 'Creative Mode', adventure: 'Adventure Mode', spectator: 'Spectator Mode' };
const MODE_SHORT = { s: 'survival', c: 'creative', a: 'adventure', sp: 'spectator', 0: 'survival', 1: 'creative', 2: 'adventure', 3: 'spectator' };

register('help', {
  always: true, aliases: ['?'],
  run(args, ctx) { for (const n of commandNames()) ctx.say('/' + n + (REG.get(n).usage ? ' ' + REG.get(n).usage : ''), GREY); },
});
register('gamemode', {
  usage: '<survival|creative|adventure|spectator>',
  suggest: i => i === 0 ? ['survival', 'creative', 'adventure', 'spectator'] : ['@s'],
  run(args, ctx) {
    const m = MODE_SHORT[args[0]] || args[0];
    if (!MODE_NAMES[m]) fail(`Unknown game mode '${args[0] || ''}'`);
    self(args[1], ctx);
    // already in it: nothing changes and nothing is said, as in the game
    if (ctx.game.mode === m) return;
    ctx.setMode(m);
    ctx.say(`Set own game mode to ${MODE_NAMES[m]}`);
  },
});
register('defaultgamemode', {
  usage: '<mode>', suggest: () => ['survival', 'creative', 'adventure', 'spectator'],
  run(args, ctx) { const m = MODE_SHORT[args[0]] || args[0]; if (!MODE_NAMES[m]) fail(`Unknown game mode '${args[0] || ''}'`); ctx.game.entry.mode = m; ctx.say(`The default game mode is now ${MODE_NAMES[m]}`); },
});
register('time', {
  usage: '<set|add|query> <value>',
  suggest: i => i === 0 ? ['set', 'add', 'query'] : ['day', 'noon', 'night', 'midnight', 'daytime', 'gametime', 'day'],
  run(args, ctx) {
    const g = ctx.game, op = args[0];
    const named = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
    const ticks = s => { if (named[s] !== undefined) return named[s]; const m = /^(-?[\d.]+)([dst]?)$/.exec(s || ''); if (!m) fail('Invalid time: ' + s); return Math.round(+m[1] * (m[2] === 'd' ? 24000 : m[2] === 's' ? 20 : 1)); };
    if (op === 'set') { const t = ticks(args[1]); g.time = Math.floor(g.time / 24000) * 24000 + t; ctx.say(`Set the time to ${t}`); }
    else if (op === 'add') { const t = ticks(args[1]); g.time += t; ctx.say(`Set the time to ${g.time % 24000}`); }
    else if (op === 'query') {
      const w = args[1] || 'daytime';
      const v = w === 'gametime' ? (g.ticks || g.time) : w === 'day' ? Math.floor(g.time / 24000) : g.time % 24000;
      ctx.say(`The time is ${v}`);
    } else fail('Incomplete command');
  },
});
register('tp', {
  usage: '<x> <y> <z>', aliases: ['teleport'],
  run(args, ctx) {
    const p = ctx.game.player;
    if (args.length === 4 || (args.length === 1 && args[0].startsWith('@'))) { self(args[0], ctx); args = args.slice(1); }
    if (args.length < 3) fail('Incomplete command');
    const [x, y, z] = position(args, 0, p);
    ctx.teleport(x, y - Y0, z);
    if (args[3] !== undefined) p.yaw = -num(args[3]) * Math.PI / 180;
    if (args[4] !== undefined) p.pitch = -num(args[4]) * Math.PI / 180;
    ctx.say(`Teleported ${ctx.playerName} to ${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)}`);
  },
});
register('give', {
  usage: '<player> <item> [count]',
  suggest: (i, w) => i === 0 ? ['@s'] : i === 1 ? ctx_itemNames().filter(n => n.startsWith(w[1] || '')).slice(0, 40) : ['1', '16', '64'],
  run(args, ctx) {
    self(args[0], ctx);
    const name = (args[1] || '').replace(/^minecraft:/, '');
    const count = args[2] ? int(args[2], 1, 6400) : 1;
    const r = ctx.give(name, count);
    if (!r) fail(`Unknown item '${args[1] || ''}'`);
    ctx.say(`Gave ${count} [${r}] to ${ctx.playerName}`);
  },
});
let itemNamesFn = () => BLOCKS.filter(d => d && d.name && d.item !== false).map(d => d.name);
export function setItemNames(fn) { itemNamesFn = fn; }
function ctx_itemNames() { return itemNamesFn(); }
register('clear', {
  usage: '[player] [item]',
  run(args, ctx) { self(args[0], ctx); const n = ctx.clearInventory(args[1] ? args[1].replace(/^minecraft:/, '') : null); if (!n) fail(`No items were found on player ${ctx.playerName}`); ctx.say(`Removed ${n} item(s) from player ${ctx.playerName}`); },
});
register('kill', {
  usage: '[target]',
  run(args, ctx) { self(args[0], ctx); ctx.kill(); ctx.say(`Killed ${ctx.playerName}`); },
});
register('seed', {
  always: true,
  run(args, ctx) { ctx.say(`Seed: [${ctx.seed()}]`, 0x55FF55); },
});
register('setblock', {
  usage: '<x> <y> <z> <block>',
  run(args, ctx) {
    const [x, y, z] = blockPos(args, 0, ctx.game.player);
    const id = blockId(args[3]);
    if (y < Y0 || y >= Y0 + 384) fail('Cannot place block outside of the world');
    const w = ctx.game.world;
    if (w.get(x, y - Y0, z) === id) fail('Could not set the block');
    w.set(x, y - Y0, z, id, 0);
    ctx.blockChanged(x, y - Y0, z);
    ctx.say(`Changed the block at ${x}, ${y}, ${z}`);
  },
});
register('fill', {
  usage: '<from> <to> <block>',
  run(args, ctx) {
    const p = ctx.game.player;
    const a = blockPos(args, 0, p), b = blockPos(args, 3, p);
    const id = blockId(args[6]);
    const mode = args[7] || 'replace';
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.max(Y0, Math.min(a[1], b[1])), y1 = Math.min(Y0 + 383, Math.max(a[1], b[1])), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
    const vol = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (vol > 32768) fail(`Too many blocks in the specified area (maximum 32768, specified ${vol})`);
    const w = ctx.game.world;
    let n = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
      let want = id;
      if (mode === 'hollow') want = edge ? id : 0;
      else if (mode === 'outline') { if (!edge) continue; }
      else if (mode === 'keep') { if (w.get(x, y - Y0, z)) continue; }
      if (w.get(x, y - Y0, z) === want) continue;
      w.set(x, y - Y0, z, want, 0);
      n++;
    }
    if (!n) fail('No blocks were filled');
    ctx.blockChanged(x0, y0 - Y0, z0);
    ctx.say(`Successfully filled ${n} block(s)`);
  },
});
register('weather', {
  usage: '<clear|rain|thunder> [duration]',
  suggest: i => i === 0 ? ['clear', 'rain', 'thunder'] : [],
  run(args, ctx) {
    const w = args[0];
    if (!['clear', 'rain', 'thunder'].includes(w)) fail('Incomplete command');
    ctx.setWeather(w, args[1] ? int(args[1], 0) * 20 : null);
    ctx.say({ clear: 'Set the weather to clear', rain: 'Set the weather to rain', thunder: 'Set the weather to rain & thunder' }[w]);
  },
});
register('difficulty', {
  usage: '[peaceful|easy|normal|hard]',
  suggest: () => ['peaceful', 'easy', 'normal', 'hard'],
  run(args, ctx) {
    const g = ctx.game, d = args[0];
    if (!d) { ctx.say(`The difficulty is ${titleCase(g.entry.difficulty || 'normal')}`); return; }
    if (!['peaceful', 'easy', 'normal', 'hard'].includes(d)) fail(`Invalid difficulty '${d}'`);
    if (g.entry.difficulty === d) fail(`The difficulty did not change; it is already set to ${titleCase(d)}`);
    ctx.setDifficulty(d);
    ctx.say(`The difficulty has been set to ${titleCase(d)}`);
  },
});
register('spawnpoint', {
  usage: '[player] [x y z]',
  run(args, ctx) {
    const p = ctx.game.player;
    if (args[0] && args[0].startsWith('@')) args = args.slice(1);
    const [x, y, z] = args.length >= 3 ? blockPos(args, 0, p) : [Math.floor(p.pos.x), Math.floor(p.pos.y + Y0), Math.floor(p.pos.z)];
    ctx.game.spawn = { x, z, y: y - Y0 };
    ctx.say(`Set spawn point to ${x}, ${y}, ${z} [0.0] in minecraft:${ctx.dimension()} for ${ctx.playerName}`);
  },
});
register('setworldspawn', {
  usage: '[x y z]',
  run(args, ctx) {
    const p = ctx.game.player;
    const [x, y, z] = args.length >= 3 ? blockPos(args, 0, p) : [Math.floor(p.pos.x), Math.floor(p.pos.y + Y0), Math.floor(p.pos.z)];
    ctx.game.entry.spawn = { x, z };
    ctx.say(`Set the world spawn point to ${x}, ${y}, ${z} [0.0]`);
  },
});
const RULES = {
  doDaylightCycle: true, doWeatherCycle: true, keepInventory: false, doMobSpawning: true, mobGriefing: true, doFireTick: true,
  doImmediateRespawn: false, naturalRegeneration: true, fallDamage: true, drowningDamage: true, fireDamage: true, freezeDamage: true,
  doTileDrops: true, doMobLoot: true, doEntityDrops: true, randomTickSpeed: 3, spawnRadius: 10, playersSleepingPercentage: 100,
  showDeathMessages: true, announceAdvancements: true, doInsomnia: true, doPatrolSpawning: true, doTraderSpawning: true, maxEntityCramming: 24,
};
export function gameRule(game, name) { const r = game && game.rules; return r && r[name] !== undefined ? r[name] : RULES[name]; }
register('gamerule', {
  usage: '<rule> [value]',
  suggest: i => i === 0 ? Object.keys(RULES) : ['true', 'false'],
  run(args, ctx) {
    const g = ctx.game, name = args[0];
    if (!(name in RULES)) fail(`Incorrect argument for command`);
    g.rules = g.rules || {};
    if (args[1] === undefined) { ctx.say(`Gamerule ${name} is currently set to: ${gameRule(g, name)}`); return; }
    const v = typeof RULES[name] === 'boolean' ? (args[1] === 'true' ? true : args[1] === 'false' ? false : fail(`Invalid boolean, expected 'true' or 'false' but found '${args[1]}'`)) : int(args[1]);
    g.rules[name] = v;
    ctx.say(`Gamerule ${name} is now set to: ${v}`);
  },
});
register('say', { usage: '<message>', run(args, ctx) { ctx.say(`[${ctx.playerName}] ${args.join(' ')}`, 0xFFFFFF); } });
register('me', { always: true, usage: '<action>', run(args, ctx) { ctx.say(`* ${ctx.playerName} ${args.join(' ')}`, 0xFFFFFF); } });
register('xp', {
  usage: '<add|set|query> <player> <amount> [points|levels]', aliases: ['experience'],
  suggest: i => i === 0 ? ['add', 'set', 'query'] : i === 1 ? ['@s'] : i === 3 ? ['points', 'levels'] : [],
  run(args, ctx) {
    const op = args[0];
    self(args[1], ctx);
    if (!ctx.xp) fail('Experience is not available');
    if (op === 'query') { const v = ctx.xp('query', 0, args[2] === 'levels'); ctx.say(`${ctx.playerName} has ${v} experience ${args[2] === 'levels' ? 'levels' : 'points'}`); return; }
    const n = int(args[2]), levels = args[3] === 'levels';
    ctx.xp(op, n, levels);
    ctx.say(op === 'add' ? `Gave ${n} experience ${levels ? 'levels' : 'points'} to ${ctx.playerName}` : `Set ${n} experience ${levels ? 'levels' : 'points'} on ${ctx.playerName}`);
  },
});
