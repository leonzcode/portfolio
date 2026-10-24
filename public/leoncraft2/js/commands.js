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
import { B, BLOCKS, FLUID } from './blocks.js?v=107';
import { Y0 } from './world-const.js?v=107';
import { ENCHANTS } from './itemdata.js?v=107';
import { stateOf } from './gen/states.js?v=107';

const REG = new Map();
export function register(name, def) { REG.set(name, def); for (const a of def.aliases || []) REG.set(a, def); }
export function commandNames() { return [...new Set([...REG.keys()])].sort(); }
// a command this place does not have (def.hidden(ctx): Leon Network's teleports and homes for everyone but an admin) is unknown there
const shown = (n, ctx) => { const d = REG.get(n); return !!d && !(d.hidden && d.hidden(ctx)); };
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
  const def = shown(name, ctx) ? REG.get(name) : null;
  if (!def) { ctx.say('Unknown or incomplete command, see below for error', RED); ctx.say(line + '<--[HERE]', RED); return false; }
  if (!ctx.cheats && !def.always) { ctx.say('You do not have permission to use this command', RED); return false; }
  // (the name as typed, for the help that names it: /removehome, not /delhome)
  ctx.label = name;
  const report = e => {
    if (e instanceof CommandError) ctx.say(e.message, RED);
    else { console.error(e); ctx.say('An unexpected error occurred trying to execute that command', RED); }
    return false;
  };
  try {
    const r = def.run(args, ctx);
    if (r && typeof r.then === 'function') r.catch(report);
    return true;
  } catch (e) {
    return report(e);
  }
}
/* ---- Tab: what the chat suggests, as the game's (1.13+) command suggestions ----
   suggestions(line, cursor, ctx) -> { start, list }: the word from start to the
   cursor is the one being typed, and each entry of list would take its place.
   A command's suggest(i, words, ctx) gives what may stand at word i; here they
   are matched the game's way (SharedSuggestionProvider): any capitals, at the
   start or after an underscore (plank finds oak_planks), and an id with
   minecraft: by its own name too. '@s' in a list stands for any player: the
   selectors and everyone on (net/net.js says who, setPlayerNames). */
const SELECTORS = ['@a', '@e', '@p', '@r', '@s'];
let namesFn = ctx => (ctx && ctx.playerName ? [ctx.playerName] : []);
export function setPlayerNames(fn) { namesFn = fn; }
// the players a command may name: everyone on (you alone in your own world)
export function playerNames(ctx) { try { return namesFn(ctx) || []; } catch (e) { return []; } }
const matchesSub = (input, s) => {
  let i = 0;
  while (!s.startsWith(input, i)) { i = s.indexOf('_', i); if (i < 0) return false; i++; }
  return true;
};
export function matches(typed, option) {
  const t = typed.toLowerCase(), o = option.toLowerCase();
  if (!t) return true;
  const colon = o.indexOf(':');
  if (colon > 0 && !/\s/.test(o) && !t.includes(':')) {
    const ns = o.slice(0, colon), path = o.slice(colon + 1);
    return matchesSub(t, ns) || (ns === 'minecraft' && matchesSub(t, path));
  }
  return matchesSub(t, o);
}
// coordinates keep the order posSuggest gives them; the rest go in the game's order (alphabetical, any capitals)
const isPlace = s => /^[~^\-\d.]/.test(s);
function order(list) {
  const seen = new Set(), place = [], rest = [];
  for (const s of list) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    (isPlace(s) ? place : rest).push(s);
  }
  rest.sort((a, b) => { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
  return place.concat(rest);
}
export function suggestions(line, cursor = line.length, ctx = null) {
  const text = line.slice(0, cursor);
  if (!text.startsWith('/')) return { start: cursor, list: [] };
  const words = text.slice(1).split(' ');
  const start = cursor - words[words.length - 1].length;
  const typed = words[words.length - 1];
  if (words.length === 1) {
    const list = commandNames().filter(n => n.toLowerCase().startsWith(typed.toLowerCase()) && shown(n, ctx));
    return { start, list };
  }
  const name = words[0].replace(/^minecraft:/, '');
  const def = shown(name, ctx) ? REG.get(name) : null;
  if (!def || !def.suggest) return { start, list: [] };
  let opts;
  try { opts = def.suggest(words.length - 2, words.slice(1), ctx) || []; } catch (e) { opts = []; }
  if (opts.includes('@s')) opts = opts.filter(o => o !== '@s').concat(SELECTORS, playerNames(ctx));
  return { start, list: order(opts.filter(o => typeof o === 'string' && o && matches(typed, o))) };
}
// (the older form: whole lines, each with one suggestion put in)
export function complete(line, ctx) {
  const { start, list } = suggestions(line, line.length, ctx);
  return list.map(s => line.slice(0, start) + s);
}

/* ---- the commands ---- */
const MODE_NAMES = { survival: 'Survival Mode', creative: 'Creative Mode', adventure: 'Adventure Mode', spectator: 'Spectator Mode' };
const MODE_SHORT = { s: 'survival', c: 'creative', a: 'adventure', sp: 'spectator', 0: 'survival', 1: 'creative', 2: 'adventure', 3: 'spectator' };

register('help', {
  always: true, aliases: ['?'],
  run(args, ctx) { for (const n of commandNames()) if (shown(n, ctx)) ctx.say('/' + n + (REG.get(n).usage ? ' ' + REG.get(n).usage : ''), GREY); },
});
register('gamemode', {
  usage: '<survival|creative|adventure|spectator>',
  suggest: i => i === 0 ? ['survival', 'creative', 'adventure', 'spectator'] : i === 1 ? ['@s'] : [],
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
  suggest: (i, w) => i === 0 ? ['set', 'add', 'query'] : i === 1 && w[0] === 'set' ? ['day', 'noon', 'night', 'midnight'] : i === 1 && w[0] === 'query' ? ['daytime', 'gametime', 'day'] : [],
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
/* /tp and /teleport, as the game has them:
     /tp <destination>                      you, to a player
     /tp <location>                         you, to x y z
     /tp <targets> <destination>            them, to a player (taking that player's facing)
     /tp <targets> <location> [<yaw> <pitch>]
     /tp <targets> <location> facing <x y z>
     /tp <targets> <location> facing entity <player> [eyes|feet]
   Coordinates and a ~ facing are worked out from you, who typed it, whoever goes; a place is in your dimension,
   a player wherever they are. Facing as the game counts it (yaw 0 south, 90 west; pitch down positive), which is
   180 minus ours. Who can be named comes from ctx.tpWorld (a server's players, net/net.js) or just you. Two
   tokens only a server sends on (another player's page runs the line): #in=<dimension> and #q (say nothing). */
const isCoord = a => a !== undefined && /^([~^]|[-+]?(\d|\.\d))/.test(a);
const gameYaw = r => { let d = (180 - r * 180 / Math.PI) % 360; if (d < -180) d += 360; if (d >= 180) d -= 360; return d; };
const ourYaw = d => (180 - d) * Math.PI / 180;
const fmt = v => v.toFixed(6);
function rotation(s, base, isPitch) {
  if (s === undefined) fail('Incomplete command');
  const v = s.startsWith('~') ? base + (s.length > 1 ? num(s.slice(1)) : 0) : num(s);
  return isPitch ? Math.max(-90, Math.min(90, v)) : v;
}
// you alone: single player (any selector or your own name)
function soloWorld(ctx) {
  const P = ctx.game.player;
  return {
    list(sel) {
      if (sel === undefined) fail('Incomplete command');
      if (sel.startsWith('@') || sel.toLowerCase() === ctx.playerName.toLowerCase()) return [ctx.playerName];
      fail('No entity was found');
    },
    where() { return { name: ctx.playerName, x: P.pos.x, y: P.pos.y, z: P.pos.z, dim: ctx.game.dim, yaw: P.yaw, pitch: P.pitch, eye: P.eyeHeight || 1.62 }; },
    move(name, d) { moveSelf(ctx, d); },
  };
}
// you, somewhere: near at once, another dimension through the loading screen; yaw and pitch kept when not given
export function moveSelf(ctx, d) {
  const g = ctx.game, P = g.player;
  if (d.dim && d.dim !== g.dim && ctx.goTo) { ctx.goTo(d.dim, d.x, d.y, d.z, d.yaw, d.pitch); return; }
  ctx.teleport(d.x, d.y, d.z);
  if (Number.isFinite(d.yaw)) P.yaw = d.yaw;
  if (Number.isFinite(d.pitch)) P.pitch = d.pitch;
}
register('tp', {
  usage: '<targets> <location|destination> [yaw pitch | facing ...]', aliases: ['teleport'],
  suggest: (i, w, ctx) => {
    // ('@s' is every player and selector: suggestions() puts them in)
    const names = ['@s'];
    if (i === 0) return posSuggest(0, ctx).concat(names);
    // where the place starts: at once (/tp x y z) or after the targets (/tp Bob x y z)
    const lead = isCoord(w[0]) ? 0 : 1;
    if (lead === 1 && i === 1) return posSuggest(0, ctx).concat(names);
    if (!isCoord(w[lead])) return [];
    const k = i - lead;
    if (k < 3) return posSuggest(k, ctx);
    if (k === 3) return ['facing', '~ ~'];
    if (w[lead + 3] !== 'facing') return [];
    if (k === 4) return ['entity'].concat(posSuggest(0, ctx));
    if (w[lead + 4] === 'entity') return k === 5 ? names : k === 6 ? ['eyes', 'feet'] : [];
    return k < 7 ? posSuggest(k - 4, ctx) : [];
  },
  run(args0, ctx) {
    let args = joinArgs(args0);
    // (the server's tokens: another player's page moving them)
    let inDim = null, quiet = false;
    while (args.length && args[args.length - 1].startsWith('#')) {
      const t = args.pop();
      if (t === '#q') quiet = true; else if (t.startsWith('#in=')) inDim = t.slice(4);
    }
    const say = t => { if (!quiet) ctx.say(t); };
    const W = ctx.tpWorld || soloWorld(ctx), P = ctx.game.player, me = ctx.playerName;
    if (!args.length) fail('Incomplete command');
    const one = sel => { const l = W.list(sel); if (l.length > 1) fail('Only one entity is allowed, but the provided selector allows more than one'); return l[0]; };
    const who = list => list.length === 1 ? list[0] : `${list.length} entities`;
    // /tp <destination>
    if (args.length === 1 && !isCoord(args[0])) {
      const d = W.where(one(args[0]));
      W.move(me, { x: d.x, y: d.y, z: d.z, dim: d.dim, yaw: d.yaw, pitch: d.pitch });
      say(`Teleported ${me} to ${d.name}`);
      return;
    }
    let targets, i;
    if (isCoord(args[0])) { targets = [me]; i = 0; }
    else { targets = W.list(args[0]); i = 1; }
    // /tp <targets> <destination>
    if (!isCoord(args[i])) {
      if (args.length !== i + 1) fail('Incorrect argument for command');
      const d = W.where(one(args[i]));
      for (const t of targets) W.move(t, { x: d.x, y: d.y, z: d.z, dim: d.dim, yaw: d.yaw, pitch: d.pitch });
      say(`Teleported ${who(targets)} to ${d.name}`);
      return;
    }
    // a place, from where you are (and in your dimension)
    if (args.length < i + 3) fail('Incomplete command');
    const [x, yw, z] = position(args, i, P);
    if (yw < Y0 - 512 || yw > Y0 + 384 + 512 || !Number.isFinite(x + yw + z) || Math.abs(x) > 3e7 || Math.abs(z) > 3e7) fail('Invalid position for teleport');
    const y = yw - Y0, dim = inDim || ctx.game.dim;
    let yaw, pitch, face = null;
    const k = i + 3;
    if (args[k] === 'facing') {
      if (args[k + 1] === 'entity') {
        if (args[k + 2] === undefined) fail('Incomplete command');
        const anchor = args[k + 3] || 'feet';
        if (anchor !== 'eyes' && anchor !== 'feet') fail('Incorrect argument for command');
        if (args.length > k + 4) fail('Incorrect argument for command');
        const e = W.where(one(args[k + 2]));
        face = [e.x, e.y + (anchor === 'eyes' ? e.eye || 1.62 : 0), e.z];
      } else {
        if (args.length !== k + 4) fail(args.length < k + 4 ? 'Incomplete command' : 'Incorrect argument for command');
        const f = position(args, k + 1, P);
        face = [f[0], f[1] - Y0, f[2]];
      }
    } else if (args[k] !== undefined) {
      if (args.length !== k + 2) fail(args.length < k + 2 ? 'Incomplete command' : 'Incorrect argument for command');
      yaw = ourYaw(rotation(args[k], gameYaw(P.yaw), false));
      pitch = -rotation(args[k + 1], -P.pitch * 180 / Math.PI, true) * Math.PI / 180;
    }
    if (face) {
      const dx = face[0] - x, dy = face[1] - (y + 1.62), dz = face[2] - z;
      yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    for (const t of targets) W.move(t, { x, y, z, dim, yaw, pitch });
    say(`Teleported ${who(targets)} to ${fmt(x)}, ${fmt(yw)}, ${fmt(z)}`);
  },
});
register('give', {
  usage: '<player> <item>[components] [count]',
  suggest: i => i === 0 ? ['@s'] : i === 1 ? ids(ctx_itemNames()) : [],
  run(args, ctx) {
    self(args[0], ctx);
    // an item's components in brackets may hold spaces: the words up to the closing bracket are one argument
    let item = args[1] || '', k = 2;
    while (item.indexOf('[') >= 0 && depth(item) > 0 && k < args.length) item += ' ' + args[k++];
    const m = /^([a-z0-9_:.\-]+)(?:\[(.*)\])?$/i.exec(item);
    if (!m) fail(`Unknown item '${item}'`);
    const name = m[1].replace(/^minecraft:/, '');
    const extra = m[2] !== undefined ? components(m[2]) : null;
    const count = args[k] ? int(args[k], 1, 6400) : 1;
    const r = ctx.give(name, count, extra);
    if (!r) fail(`Unknown item '${m[1]}'`);
    ctx.say(`Gave ${count} [${r}] to ${ctx.playerName}`);
  },
});
const depth = s => { let d = 0; for (const c of s) { if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--; } return d; };
/* Item components as /give takes them, the ones that mean something here:
   enchantments={sharpness:5,unbreaking:3} (or the older {levels:{"minecraft:sharpness":5}}),
   stored_enchantments (a book's, kept as its enchantments) and damage=N. */
function components(text) {
  const out = {};
  for (const part of splitTop(text)) {
    const eq = part.indexOf('=');
    if (eq < 0) fail(`Expected '=' in ${part}`);
    const key = part.slice(0, eq).trim().replace(/^minecraft:/, ''), val = part.slice(eq + 1).trim();
    if (key === 'enchantments' || key === 'stored_enchantments') {
      let body = val.replace(/^\{|\}$/g, '').trim();
      const lv = /^levels\s*:\s*\{(.*)\}/.exec(body);
      if (lv) body = lv[1];
      const ench = out.ench || {};
      for (const e of splitTop(body)) {
        const mm = /^\s*"?(?:minecraft:)?([a-z_]+)"?\s*:\s*(\d+)\s*$/.exec(e);
        if (!mm) fail(`Malformed enchantments: ${val}`);
        if (!ENCHANTS.some(x => x[0] === mm[1])) fail(`Can't find element 'minecraft:${mm[1]}' of type 'minecraft:enchantment'`);
        const n = Math.min(255, +mm[2]);
        if (n > 0) ench[mm[1]] = n;
      }
      if (Object.keys(ench).length) out.ench = ench;
    } else if (key === 'damage') out.dmg = int(val, 0);
  }
  return out;
}
// split at top-level commas
function splitTop(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s) {
    if (c === '{' || c === '[') d++; else if (c === '}' || c === ']') d--;
    if (c === ',' && d === 0) { if (cur.trim()) out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
let itemNamesFn = () => BLOCKS.filter(d => d && d.name && d.item !== false).map(d => d.name);
export function setItemNames(fn) { itemNamesFn = fn; }
function ctx_itemNames() { return itemNamesFn(); }
// names as the game suggests them: with their minecraft: (matched without it too)
const ids = list => list.map(n => (n.startsWith('#') || n.includes(':') ? n : 'minecraft:' + n));
register('clear', {
  usage: '[player] [item]',
  suggest: i => i === 0 ? ['@s'] : i === 1 ? ids(ctx_itemNames()) : [],
  run(args, ctx) { self(args[0], ctx); const n = ctx.clearInventory(args[1] ? args[1].replace(/^minecraft:/, '') : null); if (!n) fail(`No items were found on player ${ctx.playerName}`); ctx.say(`Removed ${n} item(s) from player ${ctx.playerName}`); },
});
register('kill', {
  usage: '[target]', suggest: i => i === 0 ? ['@s'] : [],
  run(args, ctx) { self(args[0], ctx); ctx.kill(); ctx.say(`Killed ${ctx.playerName}`); },
});
register('seed', {
  always: true,
  run(args, ctx) { ctx.say(`Seed: [${ctx.seed()}]`, 0x55FF55); },
});
/* ---- block arguments, as the game reads them ----
   A block: name[state=value,...]{nbt} (the nbt is read past). The state gives
   the meta byte the way js/models.js reads it: gen/states.js for facing, axis,
   layers and a door's half, then stairs upside down, slabs' halves, doors,
   trapdoors, gates, beds, lanterns, and wall torches, ladders and wall signs
   by the side they hang from. A filter (for /fill ... replace) is a block or
   a #tag, and its states only have to match the ones written. */
const FACE4 = { north: 0, east: 1, south: 2, west: 3 }, FACING_FACE = [5, 0, 4, 1];
// a word with brackets or braces that the chat split at spaces, put back together
function joinArgs(args) {
  const out = [];
  for (const a of args) { if (out.length && depth(out[out.length - 1]) > 0) out[out.length - 1] += ' ' + a; else out.push(a); }
  return out;
}
function propsOf(s, text) {
  const props = {};
  const body = s.trim();
  if (!body) return props;
  for (const kv of body.split(',')) {
    const i = kv.indexOf('=');
    if (i < 0) fail(`Expected value for property '${kv.trim()}' on block ${text}`);
    const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (!k) fail(`Expected value for property on block ${text}`);
    if (/\s/.test(k) || /\s/.test(v)) fail(`Expected closing ] for block state properties`);
    if (props[k] !== undefined) fail(`Property '${k}' can only be set once for block ${text}`);
    props[k] = v;
  }
  return props;
}
function metaFor(id, props) {
  const d = BLOCKS[id];
  if (!d || !props) return 0;
  const base = stateOf({ Name: 'minecraft:' + d.name, Properties: Object.keys(props).length ? props : null }).meta | 0;
  const f = FACE4[props.facing] !== undefined ? FACE4[props.facing] : base & 3;
  switch (d.shape) {
    case 'stairs': return f | (props.half === 'top' ? 4 : 0);
    case 'slab': return /_slab$/.test(d.name) ? (props.type === 'double' ? 2 : props.type === 'top' ? 1 : 0) : base;
    case 'door': return f | (props.open === 'true' ? 4 : 0) | (props.half === 'upper' ? 8 : 0) | (props.hinge === 'right' ? 16 : 0);
    case 'trapdoor': return f | (props.open === 'true' ? 4 : 0) | (props.half === 'top' ? 8 : 0);
    case 'gate': return f | (props.open === 'true' ? 4 : 0);
    case 'bed': return f | (props.part === 'head' ? 8 : 0);
    case 'lantern': return props.hanging === 'true' ? 1 : 0;
    case 'wall_torch': case 'ladder': case 'wall_sign': return props.facing ? FACING_FACE[(f + 2) & 3] : base;
  }
  return base;
}
const AIRS = new Set(['air', 'cave_air', 'void_air']);
function blockArg(s) {
  if (!s) fail('Incomplete command');
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[([^\]]*)\])?(\{.*\})?$/.exec(s);
  if (!m) fail(`Unknown block type '${s}'`);
  const name = m[1];
  const props = m[2] !== undefined ? propsOf(m[2], 'minecraft:' + name) : null;
  if (AIRS.has(name)) return { id: 0, meta: 0, props };
  const id = B[name];
  if (id === undefined) fail(`Unknown block type 'minecraft:${name}'`);
  return { id, meta: metaFor(id, props), props };
}
// the block tags, from the generator's data (loaded only when a tag is asked for)
let TAGS = null;
const loadTags = () => import('./gen/vdata.js?v=107').then(m => { TAGS = m.VDATA.block_tags || {}; });
function tagIds(name, seen = new Set()) {
  const key = name.replace(/^minecraft:/, '');
  const list = TAGS[key];
  if (!list) fail(`Unknown block tag 'minecraft:${key}'`);
  const out = new Set();
  if (seen.has(key)) return out;
  seen.add(key);
  for (const e of list) {
    const v = typeof e === 'string' ? e : e.id;
    if (!v) continue;
    if (v.startsWith('#')) { try { for (const i of tagIds(v.slice(1), seen)) out.add(i); } catch (err) { if (!(typeof e === 'object' && e.required === false)) throw err; } }
    else { const n = v.replace(/^minecraft:/, ''); if (AIRS.has(n)) out.add(0); else if (B[n] !== undefined) out.add(B[n]); }
  }
  return out;
}
const VOCAB = {
  facing: ['north', 'east', 'south', 'west', 'up', 'down'], half: ['top', 'bottom', 'upper', 'lower'], type: ['top', 'bottom', 'double'],
  axis: ['x', 'y', 'z'], hinge: ['left', 'right'], part: ['head', 'foot'], layers: ['1', '2', '3', '4', '5', '6', '7', '8'],
  open: ['true', 'false'], hanging: ['true', 'false'], berries: ['true', 'false'],
};
// a filter: test(id, meta). Its states are matched on the meta bits they set (a state this game does not keep matches anything)
function filterArg(s) {
  if (!s) fail('Incomplete command');
  if (s.startsWith('#')) {
    const m = /^#((?:minecraft:)?[a-z0-9_/]+)(?:\[([^\]]*)\])?(\{.*\})?$/.exec(s);
    if (!m) fail(`Unknown block tag '${s}'`);
    const ids = tagIds(m[1]);
    const props = m[2] !== undefined ? propsOf(m[2], s) : null;
    return (id, meta) => ids.has(id) && (!props || matchProps(id, meta, props));
  }
  const bl = blockArg(s);
  return (id, meta) => id === bl.id && (!bl.props || matchProps(id, meta, bl.props));
}
function matchProps(id, meta, props) {
  if (!id) return true;
  const want = metaFor(id, props);
  let mask = 0;
  for (const k in props) for (const v of VOCAB[k] || []) mask |= metaFor(id, Object.assign({}, props, { [k]: v })) ^ want;
  return (meta & mask) === (want & mask);
}
const blockNames = () => ['air'].concat(BLOCKS.filter(d => d && d.name && d.id).map(d => d.name));
function inWorld(y) { if (y < Y0 || y >= Y0 + 384) fail('That position is out of this world!'); }
function loaded(w, x, z) { if (w.chunkAt && !w.chunkAt(x, z)) fail('That position is not loaded'); }
// one block changed for a command: replace, destroy (what was there drops, as broken by the world), strict (nothing told)
function putBlock(ctx, x, y, z, bl, how) {
  const g = ctx.game, w = g.world, sim = g.sim;
  let broke = false;
  if (how === 'destroy' && w.get(x, y, z)) {
    if (sim) sim.destroy(x, y, z, true); else w.set(x, y, z, 0, 0);
    broke = true;
  }
  if (w.get(x, y, z) === bl.id && w.meta(x, y, z) === bl.meta) return broke;
  if (how === 'strict' && sim) { sim.silentSet(x, y, z, bl.id, bl.meta); return true; }
  w.set(x, y, z, bl.id, bl.meta);
  return true;
}
/* Tab on a position: the block you are looking at (the outlined one), as the game suggests it, the rest of the
   three numbers first (and a space after, so the next Tab goes on to the next word), then fewer; ~ with nothing
   in reach. k: which of the three this word is (0 x, 1 y, 2 z). */
function posSuggest(k, ctx) {
  const g = ctx && ctx.game, t = g && g.inter && g.inter.target;
  const v = t && Number.isFinite(t.x) ? [String(t.x), String(t.y + Y0), String(t.z)] : ['~', '~', '~'];
  const rest = v.slice(k), out = [rest.join(' ') + ' '];
  for (let n = rest.length - 1; n >= 1; n--) out.push(rest.slice(0, n).join(' '));
  return out;
}
const SET_MODES = ['destroy', 'keep', 'replace', 'strict'];
register('setblock', {
  usage: '<pos> <block> [destroy|keep|replace|strict]',
  suggest: (i, w, ctx) => i < 3 ? posSuggest(i, ctx) : i === 3 ? ids(blockNames()) : i === 4 ? SET_MODES : [],
  run(args0, ctx) {
    const args = joinArgs(args0);
    const [x, y, z] = blockPos(args, 0, ctx.game.player);
    const bl = blockArg(args[3]);
    const mode = args[4] || 'replace';
    if (!SET_MODES.includes(mode)) fail('Incorrect argument for command');
    if (args.length > 5) fail('Incorrect argument for command');
    inWorld(y);
    const w = ctx.game.world;
    loaded(w, x, z);
    const yy = y - Y0;
    if (mode === 'keep' && w.get(x, yy, z)) fail('Could not set the block');
    if (!putBlock(ctx, x, yy, z, bl, mode)) fail('Could not set the block');
    if (mode !== 'strict' && ctx.game.fluids) ctx.game.fluids.around(x, yy, z);     // water and lava next to it (or put down) flow, as after any block change
    ctx.blockChanged(x, yy, z);
    ctx.say(`Changed the block at ${x}, ${y}, ${z}`);
  },
});
/* /fill <from> <to> <block> [destroy|hollow|keep|outline|replace|strict]
   /fill <from> <to> <block> replace <filter> [destroy|hollow|outline|strict]
   As the game: replace (the default) sets every block, air too; destroy breaks
   what was there first, so it drops; hollow puts the block round the outside
   and air inside; outline only the outside, the inside left alone; keep only
   where there was air; strict sets them without telling any neighbour
   (nothing falls, flows or pops off). A filter only changes the blocks it
   matches. At most commandModificationBlockLimit blocks (32768). */
const FILL_MODES = ['destroy', 'hollow', 'keep', 'outline', 'replace', 'strict'];
const FILTER_MODES = ['destroy', 'hollow', 'outline', 'strict'];
register('fill', {
  usage: '<from> <to> <block> [destroy|hollow|keep|outline|replace|strict]',
  suggest: (i, w, ctx) => {
    if (i < 6) return posSuggest(i % 3, ctx);
    if (i === 6) return ids(blockNames());
    if (i === 7) return FILL_MODES;
    if (i === 8 && w[7] === 'replace') return ids(blockNames());
    if (i === 9 && w[7] === 'replace') return FILTER_MODES;
    return [];
  },
  run(args0, ctx) {
    const args = joinArgs(args0);
    // a #tag in the filter waits for the tag table once
    if (!TAGS && args[7] === 'replace' && args[8] && args[8].startsWith('#')) return loadTags().then(() => this.run(args0, ctx));
    const p = ctx.game.player;
    if (args.length < 7) fail('Incomplete command');
    const a = blockPos(args, 0, p), b = blockPos(args, 3, p);
    const bl = blockArg(args[6]);
    let mode = 'replace', filter = null;
    if (args[7] !== undefined) {
      if (!FILL_MODES.includes(args[7])) fail('Incorrect argument for command');
      mode = args[7];
      if (mode === 'replace' && args[8] !== undefined) {
        if (FILTER_MODES.includes(args[8])) fail('Incorrect argument for command');
        filter = filterArg(args[8]);
        if (args[9] !== undefined) { if (!FILTER_MODES.includes(args[9])) fail('Incorrect argument for command'); mode = args[9]; }
        if (args.length > 10) fail('Incorrect argument for command');
      } else if (args.length > 8) fail('Incorrect argument for command');
    }
    inWorld(a[1]); inWorld(b[1]);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
    const vol = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    const limit = gameRule(ctx.game, 'commandModificationBlockLimit');
    if (vol > limit) fail(`Too many blocks in the specified area (maximum ${limit}, specified ${vol})`);
    // (where a place lets someone fill only part of the world, net/hub.js's Map Editor: its reason not to, or nothing)
    if (ctx.fillLimit) { const why = ctx.fillLimit(x0, y0 - Y0, z0, x1, y1 - Y0, z1, vol); if (why) fail(why); }
    const w = ctx.game.world;
    for (let cx = x0 >> 4; cx <= x1 >> 4; cx++) for (let cz = z0 >> 4; cz <= z1 >> 4; cz++) loaded(w, cx * 16, cz * 16);
    const AIR = { id: 0, meta: 0 };
    const changed = [];
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const yy = y - Y0;
      const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
      if (filter && !filter(w.get(x, yy, z), w.meta(x, yy, z))) continue;
      let want = bl;
      if (mode === 'hollow') want = edge ? bl : AIR;
      else if (mode === 'outline') { if (!edge) continue; }
      else if (mode === 'keep') { if (w.get(x, yy, z)) continue; }
      if (putBlock(ctx, x, yy, z, want, mode)) changed.push(x, yy, z, edge ? 1 : 0);
    }
    if (!changed.length) fail('No blocks were filled');
    // then the water and lava round what changed flow, as after any block change (not for strict)
    if (mode !== 'strict' && ctx.game.fluids) for (let i = 0; i < changed.length; i += 4) {
      if (changed[i + 3] || FLUID[bl.id]) ctx.game.fluids.around(changed[i], changed[i + 1], changed[i + 2]);
    }
    ctx.blockChanged(x0, y0 - Y0, z0);
    ctx.say(`Successfully filled ${changed.length / 4} block(s)`);
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
  suggest: (i, w, ctx) => i === 0 ? ['@s'] : i < 4 ? posSuggest(i - 1, ctx) : [],
  run(args, ctx) {
    const p = ctx.game.player;
    if (args[0] && args[0].startsWith('@')) args = args.slice(1);
    const [x, y, z] = args.length >= 3 ? blockPos(args, 0, p) : [Math.floor(p.pos.x), Math.floor(p.pos.y + Y0), Math.floor(p.pos.z)];
    ctx.game.spawn = { x, z, y: y - Y0 };
    ctx.say(`Set spawn point to ${x}, ${y}, ${z} [0.0] in minecraft:${ctx.dimension()} for ${ctx.playerName}`);
  },
});
register('setworldspawn', {
  usage: '[x y z]', suggest: (i, w, ctx) => i < 3 ? posSuggest(i, ctx) : [],
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
  showDeathMessages: true, announceAdvancements: true, doInsomnia: true, doPatrolSpawning: true, doTraderSpawning: true, maxEntityCramming: 24, commandModificationBlockLimit: 32768,
  // what an explosion's blocks lose of their drops (explosion.js dropDecay keeps the same defaults; the game has TNT's off)
  blockExplosionDropDecay: true, mobExplosionDropDecay: true, tntExplosionDropDecay: true,
};
// for commands other parts register (enchanting.js /enchant): the same errors and arguments
export { fail, int, self };
export function gameRule(game, name) { const r = game && game.rules; return r && r[name] !== undefined ? r[name] : RULES[name]; }
register('gamerule', {
  usage: '<rule> [value]',
  suggest: (i, w) => i === 0 ? Object.keys(RULES) : i === 1 && typeof RULES[w[0]] === 'boolean' ? ['true', 'false'] : [],
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

/* ---- teleport requests and homes, as EssentialsX has them ----
   On a server these are the server's (net/net.js sends them there and
   lc2.js answers, keeping each account's homes per server). Here, in a world
   of your own, the homes are kept with the world (game.homes, saved with the
   rest of your state) and there is nobody to send a request to. The words
   are Essentials' own (its messages.properties), in its colours: gold for
   the text, red for names and commands, dark red for what went wrong, each
   error after a red "Error:". Without commands allowed, as on a server where
   every player has them. */
const P = '§6', S = '§c', D = '§4';
export const ESS = {
  error: m => `${S}Error:${D} ${m}`,
  playerNotFound: 'Player not found.',
  noPendingRequest: 'You do not have a pending request.',
  homeSet: `${P}Home set to current location.`,
  teleportHome: n => `${P}Teleporting to ${S}${n}${P}.`,
  homes: list => `${P}Homes:§r ${list.join(', ')}`,
  noHomeSetPlayer: `${P}Player has not set a home.`,
  invalidHome: n => `${D}Home${S} ${n} ${D}doesn't exist!`,
  deleteHome: n => `${P}Home${S} ${n} ${P}has been removed.`,
  invalidHomeName: 'Invalid home name!',
  bedMissing: 'Your bed is either unset, missing or blocked.',
};
// the command help Essentials shows when something is missing (verbose-command-usages, its default)
export const ESS_HELP = {
  tpa: ['Request to teleport to the specified player.', [[`/tpa §e<player>§f`, 'Requests to teleport to the specified player']]],
  tpahere: ['Request that the specified player teleport to you.', [[`/tpahere §e<player>§f`, 'Requests for the specified player to teleport to you']]],
  home: ['Teleport to your home.', [[`/home §e<name>§f`, 'Teleports you to your home with the given name'], [`/home §e<player>§f:§e<name>§f`, "Teleports you to the specified player's home with the given name"]]],
  delhome: ['Removes a home.', [[`/delhome §e<name>§f`, 'Deletes your home with the given name'], [`/delhome §e<player>§f:§e<name>§f`, "Deletes the specified player's home with the given name"]]],
};
export function essHelp(cmd, label) {
  const [desc, uses] = ESS_HELP[cmd];
  const out = [`${P}Command Help: §f/${label}`, `${P}Description: §f${desc}`, `${P}Usage(s);`];
  for (const [u, d] of uses) out.push(`§f${u.replace('/' + cmd, '/' + label)} ${P}- ${d}`);
  return out;
}
// a home's name as Essentials keeps it (StringUtil.safeString: lower case, anything but a-z, 0-9 and - made _)
export const homeName = s => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '_').slice(0, 32);
// (bed and numbers, as Essentials refuses them; and the one name an object's own keys cannot hold)
const badHomeName = n => n === 'bed' || n === '__proto__' || /^-?\d+$/.test(n);
const hasHome = (homes, n) => Object.prototype.hasOwnProperty.call(homes, n);
const WHITE = 0xFFFFFF;
const essSay = (ctx, t, extra) => ctx.say(t, WHITE, extra);
const essFail = (ctx, m) => essSay(ctx, ESS.error(m));
const homesOf = ctx => (ctx.game.homes || (ctx.game.homes = {}));
// where you stand, as a home keeps it
function here(ctx) {
  const p = ctx.game.player;
  return { d: ctx.game.dim || 'overworld', x: +p.pos.x.toFixed(3), y: +p.pos.y.toFixed(3), z: +p.pos.z.toFixed(3), yaw: +p.yaw.toFixed(4), pitch: +p.pitch.toFixed(4) };
}
const label = (ctx, cmd) => ctx.label || cmd;
// /home bed: the respawn point (a bed, a respawn anchor, a /spawnpoint), the same alone and on a server
export function homeBed(ctx) {
  if (!ctx.goBed || !ctx.goBed()) { essFail(ctx, ESS.bedMissing); return; }
  essSay(ctx, ESS.teleportHome('bed'));
}
register('sethome', {
  always: true, usage: '[name]', aliases: ['createhome'],
  run(args, ctx) {
    let name = 'home';
    if (args.length) { const parts = args[0].split(':'); name = homeName(parts.length > 1 ? parts[1] : parts[0]); }
    // (alone in your world you have the server owner's unlimited homes)
    if (badHomeName(name) || !name) { essFail(ctx, ESS.invalidHomeName); return; }
    homesOf(ctx)[name] = here(ctx);
    essSay(ctx, ESS.homeSet);
  },
});
register('home', {
  always: true, usage: '[name]',
  suggest: (i, w, ctx) => (i === 0 && ctx && ctx.game ? Object.keys(homesOf(ctx)).concat(['bed']) : []),
  run(args, ctx) {
    const homes = homesOf(ctx), names = Object.keys(homes);
    const name = args.length ? homeName(args[0].split(':')[0]) : '';
    if (name === 'bed') { homeBed(ctx); return; }
    const go = n => { const h = homes[n]; ctx.goTo(h.d, h.x, h.y, h.z, h.yaw, h.pitch); essSay(ctx, ESS.teleportHome(n)); };
    if (name && hasHome(homes, name)) { go(name); return; }
    // no name, or one that is no home: as Essentials, the spawn with no homes yet (spawn-if-no-home), the one home, or the list
    if (!names.length) { if (ctx.goSpawn) ctx.goSpawn(); return; }
    if (names.length === 1) { go(names[0]); return; }
    essSay(ctx, ESS.homes(names));
  },
});
register('homes', {
  always: true, usage: '',
  run(args, ctx) {
    const names = Object.keys(homesOf(ctx));
    if (!names.length) { essFail(ctx, ESS.noHomeSetPlayer); return; }
    essSay(ctx, ESS.homes(names));
  },
});
register('delhome', {
  always: true, usage: '<name>', aliases: ['removehome', 'remhome', 'rmhome'],
  suggest: (i, w, ctx) => (i === 0 && ctx && ctx.game ? Object.keys(homesOf(ctx)) : []),
  run(args, ctx) {
    if (!args.length) { for (const l of essHelp('delhome', label(ctx, 'delhome'))) essSay(ctx, l); return; }
    const homes = homesOf(ctx), name = homeName(args[0].split(':')[0]);
    if (name === 'bed') { essFail(ctx, ESS.invalidHomeName); return; }
    const del = n => { if (hasHome(homes, n)) { delete homes[n]; essSay(ctx, ESS.deleteHome(n)); } else essSay(ctx, ESS.invalidHome(n)); };
    if (args[0] === '*') { for (const n of Object.keys(homes)) del(n); return; }
    del(name);
  },
});
// the requests need someone else: alone, every name is nobody, as Essentials finds no such player
for (const [name, aliases] of [['tpa', ['tpask']], ['tpahere', []]]) {
  register(name, {
    always: true, usage: '<player>', aliases,
    run(args, ctx) {
      if (!args.length || args[0].toLowerCase() === String(ctx.playerName).toLowerCase()) { for (const l of essHelp(name, label(ctx, name))) essSay(ctx, l); return; }
      essFail(ctx, ESS.playerNotFound);
    },
  });
}
for (const [name, aliases] of [['tpaccept', ['tpyes']], ['tpdeny', ['tpno']], ['tpacancel', []]]) {
  register(name, {
    always: true, usage: name === 'tpacancel' ? '[player]' : '[player|*]', aliases,
    run(args, ctx) { essFail(ctx, ESS.noPendingRequest); },
  });
}
