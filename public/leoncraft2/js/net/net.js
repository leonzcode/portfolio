/* ---------------------------------------------------------------------------
   Leoncraft 2 - playing on a server.

   The server (the mc server's ?mode=lc2, lc2.js in mlhub) keeps each world's
   seed, everything that changed in it, the clock and the weather, and passes
   on what every player does. Everything else happens here, on your machine,
   as in singleplayer, so nothing you do waits for the network:

     the ground   made from the seed by the workers, with the server's
                  changes put in as each chunk is made (the same edit maps
                  singleplayer keeps: MpSave below stands in for save.js)
     your blocks  every block set in your world (by you, or by the world
                  simulating itself round you: water, redstone, crops) goes
                  in at once and is sent at the end of the frame, by name, so
                  a server never depends on this version's block numbers.
                  Until the server answers (ack) a change of yours, nobody
                  else's change to that block can overwrite it: the server
                  took theirs first, so yours is the one that stands. One it
                  turns down (rej) is put back as it was.
     theirs       put in quietly: the block simulation does not react to it
                  (no spilled chests, no water flowing), because the player
                  who made it has already worked all that out and sent it.
                  Random ticks (crops growing, grass spreading) are done for
                  each chunk by the player nearest to it only, so two players
                  side by side do not grow a farm twice as fast.
     chests       what is in a chest, furnace or hopper, and what is written
                  on a sign or held in a frame, travels as the whole record
                  whenever it changes (containers.js changed, details.js
                  changed)
     moving       your own movement is never corrected or delayed: you send
                  where you are on each tick something changed, with your
                  clock's time; the others draw you from those (players.js)
     the clock    the server's: a time set here (a command, a bed) is asked
                  for and the server's answer is what the clock shows
     the weather  the server's too; this game only eases the rain in and out

     items        whatever lies on the ground (dropped, thrown, spilled at a
                  death, out of a broken block or a mob) is everyone's: the
                  server numbers each one, every machine lets it fall and
                  float as the game does, and a pick-up is asked of the
                  server, so only the first to reach it gets it
     fighting     your hit on another player is worked out here as the game
                  works it out (Net.hitPlayer, shotPlayer) and taken by their
                  game with their armour and shield (Net.struck); what you
                  shoot or throw flies on everyone's screen (shareShots) but
                  only yours can hit anyone. A death names who did it.
     commands     the server's own (/list, /op, /kick, /ban, /whitelist,
                  /difficulty, /gamerule) are answered by it; one aimed at
                  another player is run by their game (ranAs)

     vehicles     boats and minecarts are everyone's: numbered by the server,
                  moved by the machine of whoever steers, ridden two to a
                  boat, broken by anyone (vehicles.js)
     mobs         everyone's too: each run by the machine of the player
                  nearest it (or of whoever last hit, fed or rode it) and
                  drawn from what that machine sends everywhere else; the
                  orbs of experience go to whoever reaches them first
                  (mobs.js); the dragon and its crystals are one fight run
                  by one machine (endfight.js)
     the rest     what is seen and heard near another player: the sounds
                  they and their part of the world make, chest lids, bells,
                  explosions, the cracks on the block they mine (events.js)
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=117';
import { idx, H } from '../world-const.js?v=117';
import { DIMS, DIM_IDS } from '../dims.js?v=117';
import { Save } from '../save.js?v=117';
import { itemName, stackToJSON, stackFromJSON, maxStack, sameItem } from '../items.js?v=117';
import { glints } from '../render/armor.js?v=117';
import { containerKind } from '../containers.js?v=117';
import { getSkinSettings } from '../render/avatar.js?v=117';
import { RemotePlayers, PlayerList, F, USE_KINDS, playerSize, nameRule } from './players.js?v=117';
import { register, commandDef, execute, gameRule, homeBed, fail, moveSelf, setPlayerNames } from '../commands.js?v=117';
import { Y0 } from '../world-const.js?v=117';
import { weaponOf, enchOf, enchantBonus, wearPerHit, smashBonus } from '../combat/weapons.js?v=117';
import { Projectile } from '../entities/projectiles.js?v=117';
import { Combat } from '../combat/combat.js?v=117';
import { Vehicles } from './vehicles.js?v=117';
import { Mobs, Orbs } from './mobs.js?v=117';
import { Events } from './events.js?v=117';
import { EndSync } from './endfight.js?v=117';
import { Hub } from './hub.js?v=117';
import { Account, wsBase, httpBase } from './account.js?v=117';
import { rankTag } from './players.js?v=117';
export { wsBase, httpBase };

/* ---- who you are, and where the server is ---- */
export function deviceId() {
  try {
    let d = localStorage.getItem('lc2_device');
    if (!d) { d = 'd' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('lc2_device', d); }
    return d;
  } catch (e) { return 'd' + Math.random().toString(36).slice(2, 12); }
}
// your name is your account's (net/account.js): the same on every server and in singleplayer
export function playerName() { return Account.name || 'Player'; }
export const cleanName = s => String(s || '').replace(/[^A-Za-z0-9_]/g, '').trim().slice(0, 16);
/* Why the server could not be reached, in words for the player:
     down  nothing answers (the server stopped, restarting after an update, or
           no network): the page asked and heard nothing, or the proxy in
           front of it said the server behind it is not there (502, 503, 504)
     old   the server answers, but as the mc server did before it had
           Leoncraft 2 on it (plain text where the list should be, or another
           game's welcome on the socket): it has not been updated yet */
export const SERVER_DOWN = 'down', SERVER_OLD = 'old';
export const FAIL_TEXT = {
  down: ["Can't connect to server", 'The multiplayer server is not answering. It may be restarting, so try again in a minute.'],
  old: ['Outdated server!', 'The multiplayer server has not been updated for Leoncraft 2 yet.'],
};
async function answer(r) {
  if (!r.ok) throw { kind: SERVER_DOWN, status: r.status };
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { throw { kind: SERVER_OLD }; }
}
// (with your session, so the server knows who asks; and this browser, for a server made before accounts)
async function post(path, body) {
  let r;
  try { r = await fetch(httpBase() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ device: deviceId(), token: Account.token }, body)) }); }
  catch (e) { return { error: FAIL_TEXT.down[1] }; }
  try { return await answer(r); } catch (e) { return { error: FAIL_TEXT[e.kind || SERVER_DOWN][1] }; }
}
// the server list, and how long the server took to answer it (the ping shown beside each); throws { kind } when it cannot be had
export async function listServers() {
  const t0 = performance.now();
  let r;
  try { r = await fetch(httpBase() + '/lc2/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: Account.token, device: deviceId() }), cache: 'no-store' }); }
  catch (e) { throw { kind: SERVER_DOWN }; }
  const j = await answer(r);
  if (!j || !Array.isArray(j.servers)) throw { kind: SERVER_OLD };
  return { servers: j.servers, me: j.me || null, ping: Math.round(performance.now() - t0) };
}
export const createServer = o => post('/lc2/create', o);
export const editServer = o => post('/lc2/edit', o);
export const deleteServer = id => post('/lc2/delete', { id });
// server requests (Create Server for anyone but an admin or a mod asks for one): your own and, for an admin or a mod, every one waiting; and a decision
export const srvRequests = () => post('/lc2/srvrequests', {});
export const srvReview = (id, approve, note) => post('/lc2/srvreview', { id, approve: !!approve, note: note || '' });
// Leon Network's Map Requests (mods and admins): the players' maps waiting for approval, and a decision on one
export const mapRequests = () => post('/lc2/hub/requests', {});
export const mapReview = (game, id, ok, why) => post('/lc2/hub/review', { game, id, ok, why: why || '' });

const dimCode = name => (DIMS[name] || DIMS.overworld).code;
const key3 = (x, y, z) => x + ',' + y + ',' + z;
// what a cell holds when nothing solid is there (a break leaves one of these)
const EMPTY = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'fire', 'soul_fire']);
// the details that hold an item (packDetail's kinds: frame, jukebox, decorated pot, chiseled bookshelf, lectern)
const HOLDS = new Set(['f', 'j', 'p', 'cb', 'le']);
const flat = a => a.slice();

/* What a world keeps in place of save.js, per dimension: the edits and the
   chests and signs come from the server (and stay up to date with it), and
   so does your own record (where you are, your inventory, health, game mode:
   PLAYER_KEYS; and your advancements, statistics and recipes, as the game
   keeps them per player), kept by the server under your name as the game's
   servers keep playerdata, so it is there from any browser. The rest (maps,
   what the simulation was in the middle of) is kept in this browser. */
const PLAYER_KEYS = ['player', 'inventory', 'survival', 'mode', 'hands', 'dimension', 'lastDeath', 'advancements', 'stats', 'recipes'];
class MpSave {
  constructor(net, d, id) { this.net = net; this.d = d; this.dirty = new Set(); this.local = new Save(id); }
  async init() { await this.local.init(); }
  async loadEdits() { return this.net.edits[this.d]; }
  async flush() { this.dirty.clear(); }
  async readExtra(name) {
    if (name === 'containers') return [...this.net.ct[this.d].values()];
    if (name === 'details') return [...this.net.dt[this.d].values()];
    return this.local.readExtra(name);
  }
  async writeExtra(name, v) { if (name !== 'containers' && name !== 'details') return this.local.writeExtra(name, v); }
  readState() {
    const net = this.net, local = this.local.readState();
    if (net.watch) return Object.assign({}, local || {}, { mode: 'spectator' }, net.spawn && !local ? { spawn: { x: net.spawn.x, z: net.spawn.z } } : {});
    // (a server without records has none to give: what this browser kept is all there is; one that has none for you yet takes this browser's, once)
    let st = net.pdata ? Object.assign({}, local || {}, net.pdata) : local;
    // the world spawn is the server's
    if (st && net.spawn) st.spawn = { x: net.spawn.x, z: net.spawn.z };
    // and so is your game mode (not what a record, this browser's or the server's, last said)
    if (st && net.gm) st = Object.assign({}, st, { mode: net.gm });
    return st;
  }
  writeState(s) { if (this.net.watch) return; this.local.writeState(s); if (s) this.net.savePlayer(s); }
}

// /list: who is on, as the game answers it (no commands needed; on a server, the server's own count)
register('list', {
  usage: '',
  always: true,
  run(args, ctx) {
    const net = ctx.game && ctx.game.net;
    if (net) { net.send({ t: 'cmd', line: 'list' }); return; }
    ctx.say(`There are 1 of a max of 1 players online: ${ctx.playerName || 'Player'}`);
  },
});
/* The commands only a server has (its operators': the one who made it and
   whoever they /op), answered by the server in the game's words. Not on a
   server: unknown, as in singleplayer. */
const SERVER_ONLY = {
  op: '<targets>', deop: '<targets>', kick: '<targets> [reason]', ban: '<targets> [reason]', 'ban-ip': '<target> [reason]',
  pardon: '<targets>', 'pardon-ip': '<target>', banlist: '', whitelist: '<on|off|add|remove|list|reload>', 'save-all': '',
};
for (const name in SERVER_ONLY) {
  register(name, {
    usage: SERVER_ONLY[name], always: true,
    // (not in a world of your own: not in the list Tab shows, and unknown, as said below)
    hidden: ctx => !!(ctx && ctx.game && !ctx.game.net),
    suggest: (i, w) => {
      if (name === 'whitelist') return i === 0 ? ['on', 'off', 'add', 'remove', 'list', 'reload'] : i === 1 ? onlineNames() : [];
      return i === 0 && SERVER_ONLY[name] ? onlineNames() : [];
    },
    run(args, ctx) {
      const net = ctx.game && ctx.game.net;
      if (!net) { ctx.say('Unknown or incomplete command, see below for error', 0xFF5555); ctx.say('/' + [name].concat(args).join(' ') + '<--[HERE]', 0xFF5555); return; }
      net.send({ t: 'cmd', line: [name].concat(args).join(' ') });
    },
  });
}
// the names Tab offers for a player (everyone on the server you are on)
let activeNet = null;
function onlineNames() { const n = activeNet; return n ? [n.name].concat(n.players ? [...n.players.list.values()].map(r => r.name) : []) : []; }
// (and for every command's player argument: '@s' in its suggestions, commands.js)
setPlayerNames(ctx => (activeNet && ctx && ctx.game && ctx.game.net ? onlineNames() : ctx && ctx.playerName ? [ctx.playerName] : []));

/* ---- commands aimed at other players ----
   /gamemode creative Bob, /give Bob diamond, /kill Bob, /tp Bob Cara... As
   the game does it, the command reaches Bob: here, the server passes it to
   Bob's game, which runs it on Bob as if Bob had typed it and sends back
   what it said (net.ranAs). Selectors: @s (you), @p (the nearest player,
   you), @a (everyone), @r (one at random), or a name. Only with the right to
   use commands, which the server checks again. */
const TARGET_ARG = { gamemode: 1, give: 0, clear: 0, kill: 0, xp: 1, experience: 1, effect: 1, enchant: 0, spawnpoint: 0 };
function targetsOf(net, ctx, s) {
  const me = ctx.playerName, others = net.players ? [...net.players.list.values()] : [];
  if (s === undefined || s === '@s' || s === '@p' || s.toLowerCase() === me.toLowerCase()) return null;
  if (s === '@a' || s === '@e') return [me].concat(others.map(r => r.name));
  if (s === '@r') { const all = [me].concat(others.map(r => r.name)); return [all[Math.floor(Math.random() * all.length)]]; }
  if (s.startsWith('@')) return null;
  const r = others.find(q => q.name.toLowerCase() === s.toLowerCase());
  return r ? [r.name] : [];
}
for (const name in TARGET_ARG) {
  const def = commandDef(name);
  if (!def) continue;
  const at = TARGET_ARG[name];
  register(name, Object.assign({}, def, {
    suggest: (i, w, ctx) => (i === at ? ['@s'] : def.suggest ? def.suggest(i, w, ctx) : []),
    run(args, ctx) {
      const net = ctx.game && ctx.game.net;
      const sub = name === 'effect' ? args[0] : null;
      // (/effect give <target> ..., /effect clear [target]: the target is the second word)
      const i = name === 'effect' && sub !== 'give' && sub !== 'clear' ? -1 : at;
      const list = net && i >= 0 ? targetsOf(net, ctx, args[i]) : null;
      if (!list) return def.run(args, ctx);
      if (!list.length) { ctx.say('No player was found', 0xFF5555); return; }
      const mine = list.some(n => n.toLowerCase() === ctx.playerName.toLowerCase());
      const rest = list.filter(n => n.toLowerCase() !== ctx.playerName.toLowerCase());
      const a = args.slice(); a[i] = '@s';
      if (mine) def.run(a.slice(), ctx);
      if (rest.length) net.send({ t: 'as', to: rest, line: name + ' ' + a.join(' ') });
    },
  }));
}

/* ---- the commands a server adds to, as the game has them ---- */
// /msg, /tell, /w: a whisper to one player (no commands needed)
register('msg', {
  usage: '<targets> <message>', aliases: ['tell', 'w'], always: true,
  suggest: i => (i === 0 ? ['@s'] : []),
  run(args, ctx) {
    const net = ctx.game && ctx.game.net, to = args[0], text = args.slice(1).join(' ');
    if (!to || !text) { ctx.say('Unknown or incomplete command, see below for error', 0xFF5555); return; }
    if (!net || to === '@s' || to.toLowerCase() === ctx.playerName.toLowerCase()) {
      ctx.say(`You whisper to ${ctx.playerName}: ${text}`, 0xAAAAAA);
      ctx.say(`${ctx.playerName} whispers to you: ${text}`, 0xAAAAAA);
      return;
    }
    net.send({ t: 'pm', to, text });
  },
});
// /me (anyone) and /say (commands allowed): to everyone on a server
const sayDef = commandDef('say'), meDef = commandDef('me'), tpDef = commandDef('tp');
for (const [name, def] of [['me', meDef], ['say', sayDef]]) {
  if (!def) continue;
  register(name, Object.assign({}, def, {
    run(args, ctx) {
      const net = ctx.game && ctx.game.net;
      if (!net) return def.run(args, ctx);
      if (args.length) net.send({ t: 'emote', k: name, text: args.join(' ') });
    },
  }));
}
/* /tp on a server: the same command (commands.js) told who is on. Another player is moved by their own page:
   the line goes to them with the place worked out here (your ~ and your dimension, or the player they go to,
   wherever that is) as `tp @s x y z yaw pitch #in=<dimension> #q`, ~ ~ keeping their own facing; this page
   says the game's one line for all of them. */
const dimName = code => Object.keys(DIMS).find(k => DIMS[k].code === code) || 'overworld';
function netWorld(net, ctx) {
  const me = ctx.playerName, low = s => String(s).toLowerCase();
  const others = () => (net.players ? [...net.players.list.values()] : []);
  return {
    list(sel) {
      if (sel === undefined) fail('Incomplete command');
      const t = targetsOf(net, ctx, sel);
      if (t === null) { if (sel.startsWith('@') && !/^@[sp](\[|$)/.test(sel) && /^@[ae]/.test(sel)) return [me].concat(others().map(r => r.name)); return [me]; }
      if (!t.length) fail('No entity was found');
      return t;
    },
    where(name) {
      const P = ctx.game.player;
      if (low(name) === low(me)) return { name: me, x: P.pos.x, y: P.pos.y, z: P.pos.z, dim: ctx.game.dim, yaw: P.yaw, pitch: P.pitch, eye: 1.62 };
      const r = others().find(q => low(q.name) === low(name)), s = r && r.st;
      if (!s) fail('No entity was found');
      return { name: r.name, x: s.x, y: s.y, z: s.z, dim: dimName(s.d), yaw: s.yaw, pitch: s.pitch, eye: 1.62 };
    },
    move(name, d) {
      if (low(name) === low(me)) { moveSelf(ctx, d); return; }
      const deg = v => (Number.isFinite(v) ? v : null);
      const yaw = deg(d.yaw) === null ? '~' : String(+(((180 - d.yaw * 180 / Math.PI) % 360 + 540) % 360 - 180).toFixed(3));
      const pitch = deg(d.pitch) === null ? '~' : String(+(-d.pitch * 180 / Math.PI).toFixed(3));
      net.send({ t: 'as', to: [name], line: `tp @s ${+d.x.toFixed(4)} ${+(d.y + Y0).toFixed(4)} ${+d.z.toFixed(4)} ${yaw} ${pitch} #in=${d.dim || ctx.game.dim} #q` });
    },
  };
}
if (tpDef) {
  register('tp', Object.assign({}, tpDef, {
    run(args, ctx) {
      const net = ctx.game && ctx.game.net;
      if (net) ctx.tpWorld = netWorld(net, ctx);
      return tpDef.run(args, ctx);
    },
  }));
}

/* /difficulty, /gamerule and /defaultgamemode on a server are the server's,
   for everyone: asked of it, and what it says goes to everyone (a rule's
   value is asked here, from the rules the server sent; pvp is one of them).
   The server's owner (and an admin) has them, and /setworldspawn, with their
   own OP on or off, as a server's console does: the server checks again. */
const mayRun = (ctx, net) => (net ? net.canCheat() || net.powers : ctx.cheats);
const denied = ctx => ctx.say('You do not have permission to use this command', 0xFF5555);
for (const name of ['difficulty', 'gamerule', 'defaultgamemode']) {
  const def = commandDef(name);
  if (!def) continue;
  register(name, Object.assign({}, def, {
    always: true,
    suggest: (i, w) => (name === 'gamerule' && i === 0 ? (def.suggest ? def.suggest(i, w) : []).concat(['pvp']) : def.suggest ? def.suggest(i, w) : []),
    run(args, ctx) {
      const net = ctx.game && ctx.game.net;
      if (!mayRun(ctx, net)) return denied(ctx);
      if (!net) return def.run(args, ctx);
      if (name === 'gamerule' && args[0] && args[1] === undefined) {
        const v = args[0] === 'pvp' ? net.server.pvp !== false : gameRule(ctx.game, args[0]);
        if (v === undefined) { ctx.say('Incorrect argument for command', 0xFF5555); return; }
        ctx.say(`Gamerule ${args[0]} is currently set to: ${v}`);
        return;
      }
      if (name === 'gamerule' && args[0] !== 'pvp' && gameRule(ctx.game, args[0]) === undefined) { ctx.say('Incorrect argument for command', 0xFF5555); return; }
      net.send({ t: 'cmd', line: [name].concat(args).join(' ') });
    },
  }));
}

// /setworldspawn on a server: the world's spawn is the server's, for everyone
const spawnDef = commandDef('setworldspawn');
if (spawnDef) {
  register('setworldspawn', Object.assign({}, spawnDef, {
    always: true,
    run(args, ctx) {
      const net = ctx.game && ctx.game.net;
      if (!mayRun(ctx, net)) return denied(ctx);
      spawnDef.run(args, ctx);
      const sp = ctx.game.entry.spawn;
      if (net && sp) net.send({ t: 'spawn', x: sp.x, z: sp.z, force: true });
    },
  }));
}

/* /tpa, /tpahere, /tpaccept, /tpdeny, /tpacancel, /sethome, /home, /homes and
   /delhome on a server are the server's, as an EssentialsX server's are:
   the line goes there, the server answers in Essentials' words and moves
   whoever goes ('go', handled below), and keeps your homes for your account
   on that server. Tab finishes the names it sent (your homes, who asked you)
   and the players on. /home bed is your own respawn point, so it stays here. */
const ESS_NET = ['tpa', 'tpahere', 'tpaccept', 'tpdeny', 'tpacancel', 'sethome', 'home', 'homes', 'delhome'];
for (const name of ESS_NET) {
  const def = commandDef(name);
  if (!def) continue;
  const extra = name === 'tpaccept' || name === 'tpdeny' ? (i => (i === 0 ? pendingNames().concat(['*']) : []))
    : name === 'tpa' || name === 'tpahere' || name === 'tpacancel' ? (i => (i === 0 ? onlineNames().filter(n => !activeNet || n !== activeNet.name) : []))
    : name === 'home' ? (i => (i === 0 ? homeList().concat(['bed']) : []))
    : name === 'delhome' ? (i => (i === 0 ? homeList() : [])) : null;
  register(name, Object.assign({}, def, {
    always: true,
    // (Leon Network has none of them, but for an admin: the server refuses them too)
    hidden: ctx => { const net = ctx && ctx.game && ctx.game.net; return !!(net && net.hub && !net.admin); },
    suggest: (i, w, ctx) => (ctx && ctx.game && ctx.game.net && extra ? extra(i, w) : def.suggest ? def.suggest(i, w, ctx) : []),
    run(args, ctx) {
      const net = ctx.game && ctx.game.net;
      if (!net) return def.run(args, ctx);
      if (name === 'home' && args.length && args[0].toLowerCase() === 'bed') return homeBed(ctx);
      net.send({ t: 'cmd', line: [ctx.label || name].concat(args).join(' ') });
    },
  }));
}
// (what Tab offers: your homes on this server, and who has asked you something in the last 120 seconds)
function homeList() { return activeNet && activeNet.homes ? activeNet.homes.slice() : []; }
function pendingNames() { const n = activeNet, now = performance.now(); return n && n.tpq ? n.tpq.filter(q => q[1] > now).map(q => q[0]) : []; }

/* a container's record, as containers.js saves one */
function packContainer(c) {
  const o = { k: c.kind, p: [c.x, c.y, c.z], s: c.slots.map(stackToJSON) };
  // (a copy of the furnace's experience: the same object would go on changing in the record kept as sent, so the
  // next change's check (b) stopped matching the server's and every take after an item cooked was a clash, the
  // furnace put back as the server had it to cook the same items again)
  if ('burn' in c) Object.assign(o, { b: c.burn, bm: c.burnMax, c: c.cook, cm: c.cookMax, u: Object.assign({}, c.used) });
  if (c.kind === 'brewing_stand') Object.assign(o, { f: c.fuel, w: c.brew, g: c.ingredient });
  if (c.off) o.off = c.off.map(v => (v ? 1 : 0));
  if (c.kind === 'hopper') o.cd = c.cool;
  return o;
}
/* and a sign, frame, jukebox or campfire's, as details.js saves one (a
   vault's reward is each player's own, as in the game: not shared) */
function packDetail(e) {
  if (e.k === 'sign') return { k: 's', p: [e.x, e.y, e.z], f: e.front, b: e.back, w: e.waxed ? 1 : 0 };
  if (e.k === 'frame') return { k: 'f', p: [e.x, e.y, e.z], i: e.item ? stackToJSON(e.item) : null, r: e.rot, gl: e.glow ? 1 : 0 };
  if (e.k === 'jukebox') return { k: 'j', p: [e.x, e.y, e.z], i: e.disc ? stackToJSON(e.disc) : null, t: e.t | 0 };
  if (e.k === 'campfire') return { k: 'c', p: [e.x, e.y, e.z], i: e.items.map(s => (s ? stackToJSON(s) : null)), t: e.t, n: e.total };
  // a beacon's powers (sim/beacon.js), so everyone near it gets them
  if (e.k === 'bc') return { k: 'bc', p: [e.x, e.y, e.z], a: e.a || 0, b: e.b || 0 };
  /* and what a decorated pot, a chiseled bookshelf and a lectern hold (they were kept by nobody: lost at a rejoin, a shelf
     filled on another page gave a plain book and spilled its own copy when broken) */
  if (e.k === 'decorated_pot') return { k: 'p', p: [e.x, e.y, e.z], i: e.item ? stackToJSON(e.item) : null };
  if (e.k === 'shelf') return { k: 'cb', p: [e.x, e.y, e.z], i: e.items.map(s => (s ? stackToJSON(s) : null)), l: e.last };
  if (e.k === 'lectern') return { k: 'le', p: [e.x, e.y, e.z], i: e.book ? stackToJSON(e.book) : null, g: e.page | 0 };
  return undefined;
}

export class Net {
  /* Connect, and wait for the world: resolves with the Net once the server
     has sent it, or rejects with { reason, password } (a wrong password asks again). */
  /* What a failed join says (the Failed to connect to the server screen):
       turned away     the server's own reason (wrong password, full, banned)
       no answer       the socket never opened: the server is down (FAIL_TEXT.down)
       another game    it opened, but the mc server answered as it did before it
                       had Leoncraft 2 (FAIL_TEXT.old)
       closed early    it opened and shut without a word: refused
       30 seconds      Timed out, as the game says it */
  static connect(server, password, watch, hidden) {
    return new Promise((resolve, reject) => {
      /* (who you are is your session: the server takes the name from your
         account. The session token and the server's password go in the first
         message, not the address, which a proxy or a log could keep) */
      const url = wsBase() + '?mode=lc2&pv=4&server=' + encodeURIComponent(server) + '&device=' + encodeURIComponent(deviceId());
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject({ reason: FAIL_TEXT.down[1], kind: SERVER_DOWN }); return; }
      const net = new Net(ws);
      // (kept for connecting again by itself if the line goes without a kick: lost, ui/multiplayer.js ReconnectScreen)
      net.again = { id: server, pw: password || '', watch: !!watch, hidden: !!hidden };
      let done = false, opened = false;
      const end = (ok, v) => { if (done) return; done = true; clearTimeout(timer); ok ? resolve(v) : reject(v); };
      /* (a page held up past the 30 seconds, by a busy machine, can have the
         world waiting in its queue behind this timer: a moment more for it
         before giving up) */
      const timer = setTimeout(() => setTimeout(() => { if (done) return; try { ws.close(); } catch (e) {} end(false, { reason: 'Timed out' }); }, 1500), 30000);
      ws.onopen = () => { opened = true; try { ws.send(JSON.stringify({ t: 'hello', tok: Account.token, pw: password || '', guest: Account.guest ? Account.name : '', watch: !!watch, hidden: !!hidden })); } catch (e) {} };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!done) {
          if (m.t === 'init') { net.onInit(m); end(true, net); }
          else if (m.t === 'refused') { if (m.session) Account.expired(); end(false, { reason: m.reason, password: !!m.password, session: !!m.session }); }
          // another game's welcome ({ type: ... }): the server has not been updated for this one
          else if (m.type && !m.t) { end(false, { reason: FAIL_TEXT.old[0] + ' ' + FAIL_TEXT.old[1], kind: SERVER_OLD }); try { ws.close(); } catch (e) {} }
          return;
        }
        net.receive(m);
      };
      ws.onclose = () => {
        if (!done) end(false, opened ? { reason: 'Connection refused' } : { reason: FAIL_TEXT.down[0] + '. ' + FAIL_TEXT.down[1], kind: SERVER_DOWN });
        else net.lost(net.kickReason || 'Connection lost');
      };
      ws.onerror = () => {};
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.inbox = [];                 // what changes the world, worked through on the next tick
    this.seq = 0;                    // the last batch of changes sent
    this.pending = new Map();        // "d:x,y,z" (or "c"/"t" + d:x,y,z for chests and signs) -> { s, prev }
    this.outB = [[], [], []];        // blocks to send, per dimension
    this.outO = [[], [], []];        // with each, the solid block it took away (a break), else '': the server's check
    this.broke = new Map();          // "d:x,y,z" -> when: blocks this page broke in the last moment, for what falls out of them
    this.dtMine = new Map();         // "d:x,y,z" -> { prev, sent, s }: a pot's, frame's, shelf's... change, until the server takes it
    this.outC = new Map();           // "d:x,y,z" -> [d, container or null]
    this.ctMine = new Map();         // "d:x,y,z" -> { hd, s }: what your hands moved in a container, until the server takes it
    this.xpHeld = new Map();         // "d:x,y,z" -> [{ xp, s }]: a furnace's experience you took, paid once the server keeps the take
    this.hopperAsks = new Map();     // item number -> put(stack): shared items a hopper here asked the server for (D.askFor)
    this.handOut = new Map();        // "d:x,y,z" -> Map(item key -> count): what your hands took out (minus what they put in) this frame
    this.handSnap = new Map();       // container record -> its tally at the end of the last tick, for those a screen shows
    this.outT = new Map();           // "d:x,y,z" -> [d, detail entry or null]
    this.outFx = [];                 // blocks you broke by hand, for their pieces on the others' screens
    this.items = [new Map(), new Map(), new Map()];   // the items lying about, per dimension: number -> record
    this.itemKey = 0; this.byKey = new Map(); this.outIt = [];
    this.applying = false;           // putting in someone else's change: not to be sent back
    this.rtt = 0; this.pings = []; this.itemTick = 0;
    this.game = null;
    this.dead = false;
    this.sent = { at: -1e9, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, f: -1, d: -1, n: -1 };
    this.bases = new Map();          // each other player's position as last sent, in millimetres (what the changes go on top of)
    this.eqSig = ''; this.eqTick = 0;
    this.timeExpect = null;
    this.stats = { sentB: 0, gotB: 0, sentP: 0, gotP: 0 };
    this.op = 0;                     // what you may do here: 4 an operator, 2 commands allowed, 0 neither
    this.shots = [];                 // what you shot or threw this tick, for the others to see fly
    this.pvpHit = null;              // the last hit another player gave you: { name, k, item, age }
    this.veh = new Vehicles(this);   // the boats and minecarts everyone shares (vehicles.js)
    this.recHash = recHash; this.tallyStacks = tallyStacks;   // (for vehicles.js: a chest boat's chest is checked as a chest is)
    this.mobs = new Mobs(this); this.orbs = new Orbs(this);   // the mobs and orbs everyone shares (mobs.js)
    this.events = new Events(this);  // the sounds, lids, explosions and cracks seen near the others (events.js)
    this.end = new EndSync(this);    // one fight in the End for everyone (endfight.js)
    this.qsT = 0; this.wasDead = false; this.invSig = '';
  }
  // whether you may use the commands that change the world (an operator, or Allow Commands)
  canCheat() { return this.op >= 2; }

  /* ---- the world the server sent ---- */
  onInit(m) {
    this.id = m.id; this.name = m.name; this.server = m.server;
    // Leon Network: the minigames' own part of the page (net/hub.js)
    this.hub = m.server && m.server.hub ? new Hub(this) : null;
    // (an older server sends no level: its Allow Commands is all there is)
    this.op = m.op !== undefined ? m.op | 0 : m.server && m.server.cheats ? 2 : 0;
    // the owner's powers (every command a server's owner has, its settings) and your rank tag, as the server decides them
    this.powers = !!m.powers; this.admin = !!m.admin; this.tag = m.tag || '';
    // watching (in as a spectator with no password): nothing you do is kept or sent, and you stay a spectator
    this.watch = !!m.watch; this.guest = !!m.guest;
    // joined hidden (an admin: the server tells nobody else anything of you; a /msg you send is all that reaches anyone)
    this.hidden = !!m.hidden;
    // the game mode the server gives you (mlhub lc2.js modeFor), not the one your record last said
    this.gm = typeof m.gm === 'string' ? m.gm : null; this.sentGm = this.gm;
    this.rules = m.rules || null;
    // spawn protection: how far round the world spawn you may not change anything (0: none for you, or none here)
    this.prot = m.prot | 0;
    if (this.rules && this.rules.pvp !== undefined) this.server.pvp = !!this.rules.pvp;
    this.time = m.time; this.timeAt = performance.now(); this.wx = m.wx || { r: false, th: false }; this.spawn = m.spawn || null;
    // the world's block names to this version's numbers (a name this version does not know is left as generated)
    const ids = (m.palette || []).map(n => (B[n] !== undefined ? B[n] : -1));
    this.edits = []; this.ct = []; this.dt = [];
    for (let d = 0; d < 3; d++) {
      const src = (m.dims || [])[d] || {}, edits = new Map(), ct = new Map(), dt = new Map();
      for (const k in src.chunks || {}) {
        const a = src.chunks[k], mm = new Map();
        for (let i = 0; i + 1 < a.length; i += 2) { const id = ids[a[i + 1] >> 8]; if (id >= 0) mm.set(a[i], id * 256 + (a[i + 1] & 255)); }
        if (mm.size) edits.set(k, mm);
      }
      for (const o of src.ct || []) if (o && Array.isArray(o.p)) ct.set(key3(o.p[0], o.p[1], o.p[2]), o);
      for (const o of src.dt || []) if (o && Array.isArray(o.p)) dt.set(key3(o.p[0], o.p[1], o.p[2]), o);
      this.edits.push(edits); this.ct.push(ct); this.dt.push(dt);
    }
    this.initPlayers = m.players || [];
    this.veh.init(m);
    this.mobs.init(m); this.orbs.init(m); this.events.init(m);
    // your own record on this server (MpSave.readState), or null the first time you come
    this.pdata = m.pdata && typeof m.pdata === 'object' ? m.pdata : null;
    // your homes here, for Tab (the server keeps them: /sethome, /home)
    this.homes = m.homes && Array.isArray(m.homes.n) ? m.homes.n.map(String) : []; this.homeLimit = m.homes ? m.homes.lim | 0 : 0; this.tpq = [];
    for (const o of m.items || []) this.keepItem(o);
    this.serverNow = m.now;
    this.ping();
    this.pingTimer = setInterval(() => this.ping(), 2000);
  }
  // the world as the game's list of worlds holds one (main.js startGame)
  entry() {
    const s = this.server, net = this;
    // (cheats is asked each time a command is typed: an /op or /deop counts at once)
    // (lc1: a server brought over from the first Leoncraft, made partly by its generator: lc1/mixed.js)
    return { id: 'mp-' + s.id, name: s.name, seed: s.seed, generator: s.generator || 'vanilla', mode: this.gm || s.mode, difficulty: s.difficulty,
      lc1: s.lc1 && typeof s.lc1 === 'object' && s.lc1.key ? s.lc1 : undefined,
      get cheats() { return net.canCheat(); }, set cheats(v) {}, spawn: this.spawn || undefined, mp: this, created: 0, lastPlayed: Date.now() };
  }
  // save.js's stand-in for each dimension (main.js asks by the save's id)
  save(id) {
    const d = id.endsWith(DIMS.the_nether.suffix) ? 1 : id.endsWith(DIMS.the_end.suffix) ? 2 : 0;
    return new MpSave(this, d, id + '~' + this.name.toLowerCase());
  }

  /* ---- the game has started (main.js), with what this needs of it ---- */
  attach(game, ctx) {
    this.game = game; this.ctx = ctx;
    activeNet = this;
    this.players = new RemotePlayers(ctx.renderer, ctx.gui.font);
    this.players.sized = true;   // (the people on Leon Network's stands keep their size)
    // the puff of smoke a player leaves when they die
    this.players.onPoof = (x, y, z) => { const E = this.game && this.game.entities; if (E && E.particles) E.particles('poof', x, y + 0.9, z, 20, 0.4); };
    for (const p of this.initPlayers) this.players.add(p);
    // someone sitting in a boat or minecart is drawn in its seat in this machine's copy of it
    this.players.seatOf = r => this.veh.seatOf(r) || this.mobs.seatOf(r, this.veh.alpha);
    this.initPlayers = null;
    // the server's game rules and difficulty, for everyone
    if (this.rules) this.applyRules(this.rules);
    if (this.watch && ctx.chat) ctx.chat.add('You are watching as a spectator. Join with the password to play.', 0xAAAAAA);
    // you: your name in death messages, which go to everyone
    const hooks = game.survival.hooks;
    if (hooks) {
      hooks.name = () => this.name;
      // (said by the server to everyone, you too: not put in your chat here as well)
      hooks.onDeath = (message, src) => {
        message = this.deathText(message, src);
        if (game.survival) game.survival.deathMessage = message;
        if (this.ctx.rule('showDeathMessages')) this.send({ t: 'death', text: message });
      };
    }
    // your arm swinging, for everyone else's picture of you
    const av = ctx.renderer.avatar, swing = av.startSwing.bind(av);
    av.startSwing = () => { swing(); if (this.game) this.send({ t: 'sw', h: 0 }); };
    this.unswing = () => { av.startSwing = swing; };
    // Tab held: who is on (players.js PlayerList)
    this.list = new PlayerList(this);
    ctx.gui.overlays.push(this.list);
    // hidden: a word in the corner the whole time, and what it means once
    if (this.hidden) {
      this.hiddenMark = { under: true, animates: false, draw: g => { if (g.hideHud) return; const t = 'Hidden'; g.text(t, g.width - g.textWidth(t) - 2, 2, 0x00AAAA, true); } };
      ctx.gui.overlays.push(this.hiddenMark);
      ctx.chat.add('§3You joined hidden. §7Nobody else is told you are here or can see you: not in the world, the Tab list, the server list or /list. Other hidden admins see you, and you them, marked (hidden). Your chat, deaths and advancements reach only them; a /msg you send reaches its player, and they can answer it. You cannot hit players.', 0xFFFFFF);
    }
    this.onKey = e => {
      if (e.code !== 'Tab') return;
      const down = e.type === 'keydown' && !ctx.gui.isOpen();
      if (down !== this.list.shown) { this.list.shown = down; ctx.gui.markDirty(); }
      if (e.type === 'keydown' && !ctx.gui.isOpen()) e.preventDefault();
    };
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('keyup', this.onKey);
    this.sendSkin();
    this.events.attach();
    // (after the death hook above: a death on the network is its own)
    if (this.hub) this.hub.attach(game, ctx);
    // the world's spawn, found by the first player to arrive
    if (!this.spawn && game.spawn) this.send({ t: 'spawn', x: game.spawn.x, z: game.spawn.z });
    game.time = this.serverTime();
    this.timeExpect = game.time;
    if (this.dead) setTimeout(() => this.lost(this.lostReason || 'Connection lost'), 0);
  }

  /* ---- talking to the server ---- */
  send(m) { if (this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(m)); } catch (e) {} } }
  ping() { this.send({ t: 'ping', c: performance.now() }); }
  chat(text) { this.send({ t: 'chat', text }); }
  // the clock as the server last said, run on since
  serverTime() { return this.time + Math.round((performance.now() - this.timeAt) / 50); }
  /* Every record of a mob, cart or chest boat changed here that has not gone yet, now: as you leave, as the page goes,
     before the server restarts and with every save of your own record. They went every second at most (every thirty
     seconds with nobody near), so taking a donkey's or a cart's things and quitting at once kept them both in your
     inventory and in the server's record of it. */
  flushEntities() {
    if (this.closed || this.flushing || !this.game || !this.ws || this.ws.readyState !== 1) return;
    this.flushing = true;
    try { if (this.mobs && this.mobs.flushAll) this.mobs.flushAll(); if (this.veh && this.veh.flushChests) this.veh.flushChests(); }
    catch (e) { console.warn('flush', e); }
    finally { this.flushing = false; }
  }
  close() {
    if (this.closed) return;
    this.flushEntities();
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.ws.close(); } catch (e) {}
    this.detach();
  }
  detach() {
    if (activeNet === this) activeNet = null;
    if (this.players) { this.players.dispose(); this.players = null; }
    if (this.list) { const o = this.ctx.gui.overlays, i = o.indexOf(this.list); if (i >= 0) o.splice(i, 1); this.list = null; }
    if (this.hiddenMark) { const o = this.ctx.gui.overlays, i = o.indexOf(this.hiddenMark); if (i >= 0) o.splice(i, 1); this.hiddenMark = null; }
    if (this.onKey) { document.removeEventListener('keydown', this.onKey); document.removeEventListener('keyup', this.onKey); this.onKey = null; }
    if (this.unswing) { this.unswing(); this.unswing = null; }
    this.events.detach();
    if (this.hub) this.hub.detach();
    this.game = null;
  }
  // the connection went (the server stopped, the network, kicked): back to the title with the reason
  lost(reason) {
    if (this.closed) return;
    this.dead = true; this.lostReason = reason;
    if (!this.game) return;
    const ctx = this.ctx;
    this.close();
    ctx.disconnected(reason, this.kickReason ? null : this.rejoinTo());
  }
  /* Where to connect again when the line went without a kick (the server restarting
     for an update, a connection that dropped): this server again, or Leonpixel from
     one of its Death Swap worlds, which a restart deletes. */
  rejoinTo() {
    const a = this.again, s = this.server || {};
    if (!a) return null;
    const ds = !!s.hub && a.id !== 'hub';
    return { id: ds ? 'hub' : a.id, pw: ds ? '' : a.pw, watch: ds ? false : a.watch, hidden: ds ? false : !!a.hidden, name: ds ? 'Leonpixel' : s.name, restart: !!this.restarting };
  }

  /* ---- what arrives ---- */
  receive(m) {
    /* a position, as a short array: [0, id, ts, x, y, z, yaw, pitch, flags, dim, use, useT, useTotal],
       or what changed since the last: [1, id, dts, dx, dy, dz, dyaw, dpitch, flags, dim, use...] in
       ms, millimetres and thousandths of a radian, a number left off the end unchanged (lc2.js moveFor) */
    if (Array.isArray(m)) {
      // the mobs others run: where they are (mobs.js)
      if (m[0] === 3 || m[0] === 4) { this.mobs.receive(m); return; }
      let b = this.bases.get(m[1]);
      if (m[0] === 0) {
        b = { ts: m[2], X: Math.round(m[3] * 1000), Y: Math.round(m[4] * 1000), Z: Math.round(m[5] * 1000), YAW: Math.round(m[6] * 1000), PITCH: Math.round(m[7] * 1000), f: m[8] | 0, d: m[9] | 0 };
        this.bases.set(m[1], b);
      } else if (m[0] === 1 && b) {
        b.ts += m[2] | 0; b.X += m[3] | 0; b.Y += m[4] | 0; b.Z += m[5] | 0; b.YAW += m[6] | 0; b.PITCH += m[7] | 0;
        if (m[8] !== undefined) { b.f = m[8] | 0; b.d = m[9] | 0; }
      } else return;
      const s = { t: 'p', id: m[1], ts: b.ts, x: b.X / 1000, y: b.Y / 1000, z: b.Z / 1000, yaw: b.YAW / 1000, pitch: b.PITCH / 1000, f: b.f, d: b.d };
      if (m[10]) { s.u = m[10]; s.ut = m[11]; s.uT = m[12]; }
      m = s;
    }
    switch (m.t) {
      // the other players: straight away, with when each position got here
      case 'p': this.stats.gotP++; if (this.players) this.players.state(m.id, m, performance.now()); else this.early(m); return;
      case 'op': this.op = m.level | 0; if (m.powers !== undefined) this.powers = !!m.powers; if (m.admin !== undefined) this.admin = !!m.admin; return;
      // a rank tag changed (the server was given to another owner)
      case 'tag': if (m.id === this.id) this.tag = m.tag || ''; else if (this.players) this.players.setTag(m.id, m.tag || ''); else { const p = this.initPlayers && this.initPlayers.find(q => q.id === m.id); if (p) p.tag = m.tag || ''; } if (this.ctx) this.ctx.gui.markDirty(); return;
      case 'prot': this.prot = m.r | 0; return;
      // (a line may carry parts to click, [text, colour, { click: [{ text, run, tip }] }]: a teleport request's /tpaccept)
      case 'out': if (this.ctx) for (const l of m.lines || []) if (Array.isArray(l)) this.ctx.chat.add(String(l[0]), l[1] === undefined ? 0xFFFFFF : l[1], l[2] && typeof l[2] === 'object' ? l[2] : undefined); return;
      // your homes on this server and how many you may have (-1: no limit), and who has asked you to teleport, with how long each has left
      case 'homes': this.homes = Array.isArray(m.n) ? m.n.map(String) : []; this.homeLimit = m.lim | 0; return;
      case 'tpq': { const now = performance.now(); this.tpq = Array.isArray(m.q) ? m.q.filter(Array.isArray).map(q => [String(q[0]), now + (+q[1] || 0)]) : []; return; }
      case 'join': if (this.players) { this.players.add(m.p); } else this.initPlayers.push(m.p); return;
      case 'v=': case 'v+': case 'vs': case 'vc': case 'vr': case 'vj': case 'v-': this.veh.receive(m); return;
      case 'leave': this.veh.left(m.id); this.events.left(m.id); this.bases.delete(m.id); if (this.players) this.players.remove(m.id); else this.initPlayers = this.initPlayers.filter(p => p.id !== m.id); return;
      case 'skin': if (this.players) this.players.setSkin(m.id, m.skin, m.slim, m.cape); else this.early(m); return;
      case 'eq': if (this.players) this.players.setEquip(m.id, m.eq); else this.early(m); return;
      case 'sw': if (this.players) this.players.swing(m.id, m.h); return;
      case 'hurt': if (this.players) this.players.hurt(m.id); return;
      case 'lat': this.lat = m.l; if (this.list && this.list.shown) this.ctx.gui.markDirty(); return;
      case 'pong': {
        const rtt = performance.now() - m.c;
        this.pings.push(rtt); if (this.pings.length > 5) this.pings.shift();
        this.rtt = Math.min(...this.pings);
        if (this.pings.length === 1 || this.pings.length === 5) this.send({ t: 'lat', ms: Math.round(this.rtt) });
        return;
      }
      case 'kicked': this.kickReason = m.reason; return;
      /* the server is stopping to restart (an update going in): your record sent now, not
         at the next save, and the page connects again by itself once the line goes (lost) */
      case 'restart':
        this.restarting = true;
        if (this.ctx && this.ctx.chat) this.ctx.chat.add('§eLeon has updated the game! §7The server is restarting: you will be back in a few seconds.', 0xFFFFFF);
        if (this.game && this.game.ready) this.quickSave(true);
        return;
      case 'fx': if (this.game && this.game.ready) this.effects(m); return;
      case 'ev': this.events.receive(m); return;
      // the mobs' news in the order it came, with their positions (which go straight to the puppets)
      case 'm=': case 'm+': case 'mo': case 'mj': case 'ma': case 'm-': case 'pop': this.mobs.receive(m); return;
      // blocks, chests and signs go in the moment they arrive, not at the next tick: they show a frame sooner
      case 'b': case 'ct': case 'dt': if (this.game && this.game.ready && !this.inbox.length) { this.handle(m); return; } this.inbox.push(m); return;
      default: this.inbox.push(m);
    }
  }
  // a player's news before the game is ready to draw them: kept on their record for when it is
  early(m) {
    const p = this.initPlayers && this.initPlayers.find(q => q.id === m.id);
    if (!p) return;
    if (m.t === 'p') p.st = m; else if (m.t === 'skin') { p.skin = m.skin; p.slim = m.slim; p.cape = m.cape; } else if (m.t === 'eq') p.eq = m.eq;
  }

  /* ---- each game tick (main.js, at the end of the tick, with the tick's time) ---- */
  tick(stamp) {
    const g = this.game;
    if (!g || this.closed) return;
    this.hook();
    // the clock: a time set here (a command, a bed, the [ and ] keys) is asked of the server
    if (this.timeExpect !== null && Math.abs(g.time - this.timeExpect) > 2) {
      this.send({ t: 'time', time: g.time, sleep: !!(this.slept || (g.sim && g.sim.sleeping)) });
    }
    this.slept = false;
    for (let n = 0; this.inbox.length && n < 2000; n++) this.handle(this.inbox.shift());
    this.timeExpect = g.time + 1;
    // a change of game mode here (a command, F3 + F4) is told to the server, which keeps it or sends back the mode it gives you
    if (this.gm && g.mode !== this.sentGm) { this.sentGm = g.mode; this.send({ t: 'gm', m: g.mode }); }
    this.pushTick();
    this.veh.tick(dimCode(g.dim));
    this.mobs.tick(dimCode(g.dim), stamp);
    this.end.tick();
    this.events.tick(dimCode(g.dim));
    if (this.hub) this.hub.tick();
    this.shareShots();
    this.sendState(stamp);
    if (++this.eqTick % 5 === 0 || this.eqTick === 1 || g.inv.heldId() !== this.lastHeld) this.sendEquip();
    this.quickSave();
    if (g.survival.hurtTime === 10 && !this.hurtSent) { this.hurtSent = true; this.send({ t: 'hurt' }); }
    if (g.survival.hurtTime !== 10) this.hurtSent = false;
    this.flush();
  }
  // every frame: the others drawn where they are now, and anything changed since the last tick sent
  frame(now, dt, eye) {
    const g = this.game;
    if (!g || this.closed) return;
    this.flush();
    if (this.players) {
      const R = this.ctx.renderer;
      nameRule.hidden = !!this.ctx.gui.hideHud;
      this.players.frame(now, dt, g.world, dimCode(g.dim), eye, Math.max(48, (R.opts.renderDist || 8) * 16), g.mode === 'spectator');
    }
    this.events.players(dt);
    if (this.hub) this.hub.frame(now, dt, eye);
    if (this.mobs) this.mobs.boosts();
    // a new skin chosen while playing goes to everyone
    if ((this.skinCheck = (this.skinCheck || 0) + dt) > 2) { this.skinCheck = 0; this.sendSkin(); }
  }

  /* Whatever was made since the last look (a new dimension's world, its
     chests and signs, its simulation): listened to. */
  hook() {
    const g = this.game, net = this;
    const w = g.world;
    if (w && w !== this.hw) {
      this.hw = w;
      const set = w.set;
      w.set = function (x, y, z, b, m, quiet) {
        if (net.applying || net.closed) return set.call(this, x, y, z, b, m, quiet);
        const ob = this.get(x, y, z), om = this.meta(x, y, z);
        const r = set.call(this, x, y, z, b, m, quiet);
        if (r) net.local(this, x, y, z, b, m || 0, ob * 256 + om);
        return r;
      };
    }
    const C = g.containers;
    if (C && C !== this.hc) {
      this.hc = C;
      const changed = C.changed, remove = C.remove, tick = C.tick;
      C.changed = function (c) {
        changed.call(this, c);
        if (net.applying || !c) return;
        if (this.byHand > 0) net.handMoved(c);
        net.queueC(c.x, c.y, c.z, c, this.byHand > 0);
      };
      /* A hopper moves things on one page only, the one whose chunk it is (the player nearest): run on every page
         near it, a page a moment behind moved what another had already moved, and a hopper's record going from
         empty to holding one item and back to empty looked unchanged to the server's check (ctClash), so the item
         came out twice. */
      const hopperTick = C.hopperTick;
      C.hopperTick = function (h) { return net.ownsAt(h.x, h.z) ? hopperTick.call(this, h) : false; };
      /* What a furnace's output brings is paid once the server keeps the take (its ack), not as you take it: a take
         turned down (someone else took the same output a moment before, net.container's lost) is undone, and so are
         its points, so two players never both get the same experience. */
      const takeXp = C.takeXp;
      C.takeXp = function (c) {
        const xp = takeXp.call(this, c);
        if (xp > 0 && c && !net.applying) {
          const k = dimCode(net.game.dim) + ':' + key3(c.x, c.y, c.z);
          let l = net.xpHeld.get(k);
          if (!l) net.xpHeld.set(k, l = []);
          l.push({ xp, s: net.seq + 1 });
          return 0;
        }
        return xp;
      };
      /* What a furnace, smoker, blast furnace or brewing stand does by itself (an item cooked, fuel burnt, a potion
         brewed) goes to the server from the page that owns its chunk, as a hopper's moves do: it used to be sent by
         nobody, so the server kept each one as it was at its last click, and whenever it was loaded again (coming
         back to it, joining, another player arriving) it was back to that: the ore in, the ingots gone, the arrow
         at the start. Every page near still works it out (the same sums from the same record); the owner's record
         puts them right. */
      const slotSig = c => { let s = ''; for (const x of c.slots) s += x ? x.id + ':' + x.count + ',' : ','; return s; };
      // (what each container an open screen shows held once a tick's furnaces and hoppers are done)
      C.tick = function () {
        const before = net.applying ? null : new Map();
        if (before) for (const c of this.lit) before.set(c, slotSig(c));
        const r = tick.apply(this, arguments), snap = new Map();
        if (before) for (const [c, s0] of before) {
          if (slotSig(c) !== s0 && this.map.get(this.key(c.x, c.y, c.z)) === c && net.ownsAt(c.x, c.z)) net.queueC(c.x, c.y, c.z, c, false);
        }
        for (const s of net.ctx.gui.stack) for (const c of s.records || []) snap.set(c, tallyStacks(c.slots));
        net.handSnap = snap;
        return r;
      };
      C.remove = function (x, y, z) { const out = remove.call(this, x, y, z); if (!net.applying) net.queueC(x, y, z, null); return out; };
    }
    const D = g.details;
    if (D && D !== this.hd) {
      this.hd = D;
      const changed = D.changed, broken = D.broken;
      D.changed = function (e) { changed.call(this, e); if (!net.applying && e) net.queueT(e.x, e.y, e.z, e); };
      D.broken = function (x, y, z) { const had = this.map.has(key3(x, y, z)); broken.call(this, x, y, z); if (!net.applying && had) net.queueT(x, y, z, null); };
      // a disc put in or taken out, food put on a campfire (details.js marks these dirty without changed())
      const after = (fn, at) => function (...a) {
        const r = fn.apply(this, a), p = at(a);
        if (!net.applying && p) { const e = this.map.get(key3(p.x, p.y, p.z)); net.queueT(p.x, p.y, p.z, e && (e.k === 'jukebox' || e.k === 'campfire') ? e : null); }
        return r;
      };
      D.jukebox = after(D.jukebox, a => a[1]);
      D.campfire = after(D.campfire, a => a[1]);
      D.ejectDisc = after(D.ejectDisc, a => a[0]);
      /* A campfire's food is cooked on the machine of the player nearest to
         it only, who sends what came of it: cooked twice, it would be two
         pieces of food for one. */
      const tick = D.tick;
      D.tick = function () {
        const away = [], mine = [];
        for (const e of this.map.values()) {
          if (e.k !== 'campfire') continue;
          if (net.ownsAt(e.x, e.z)) mine.push([e, e.items.map(v => (v ? v.id : 0)).join()]);
          else { away.push([e, e.items, e.t]); e.items = [null, null, null, null]; e.t = e.t.slice(); }
        }
        try { tick.call(this); }
        finally {
          for (const [e, items, t] of away) { e.items = items; e.t = t; }
          for (const [e, sig] of mine) if (this.map.get(key3(e.x, e.y, e.z)) === e && e.items.map(v => (v ? v.id : 0)).join() !== sig) net.queueT(e.x, e.y, e.z, e);
        }
      };
    }
    // a block you break by hand: its pieces fly on the others' screens too, as the game shows them
    const I = g.inter;
    if (I && I !== this.hi) {
      this.hi = I;
      I.locked = (x, y, z) => this.protectedAt(x, z);
      const onBreak = I.onBreak;
      I.onBreak = function (x, y, z, b, boxes) {
        if (onBreak) onBreak.call(this, x, y, z, b, boxes);
        if (net.closed || !BLOCKS[b] || net.outFx.length >= 64) return;
        const o = { p: [x, y, z], b: BLOCKS[b].name };
        if (boxes && boxes.length && boxes.length <= 8) o.x = [].concat(...boxes.map(v => v.slice(0, 6).map(n => Math.round(n * 1000) / 1000)));
        net.outFx.push(o);
      };
    }
    if (g.drops && g.drops !== this.hdr) this.hookDrops(g.drops);
    if (g.realms && g.realms !== this.hrl && this.events.on) { this.hrl = g.realms; this.end.hook(g.realms); }
    const E = g.entities;
    if (E && E !== this.he) {
      this.he = E;
      this.veh.hook(E);
      if (this.mobs.on) this.mobs.hook(E);
      this.events.hookEntities(E);
      // the crosshair finds the other players too, in front of any mob or block (for hitting them)
      const pickFor = E.pickFor;
      E.pickFor = function (eye, blockT) { return net.pickPlayer(this, eye, blockT, pickFor.call(this, eye, blockT)); };
      // what you shoot or throw, for the others to see fly (shareShots, at the end of the tick, once its owner is set)
      const spawn = E.spawn;
      E.spawn = function (type, x, y, z, o) {
        const e = spawn.call(this, type, x, y, z, o);
        if (e && !net.applying && !(o && o.json) && e instanceof Projectile && net.shots.length < 32) net.shots.push(e);
        return e;
      };
    }
    const S = g.sim;
    if (S && S !== this.hs) {
      this.hs = S;
      this.events.hookSim(S);
      // random ticks only in the chunks you are the nearest player to
      S.skip = c => !this.owns(c);
      // the weather is the server's: the rain eases in and out here
      const W = S.weather;
      if (W) {
        W.cycle = false;
        this.applyWeather();
        W.set = (kind, ticks) => this.send({ t: 'wx', kind, ticks: ticks || 0 });
        W.clearBySleep = () => {};
      }
      // a bed: the night passes only once everyone in the Overworld is asleep (sim/beds.js)
      // (as the game counts it: everyone asleep, and each of them for 100 ticks or more, before the night passes)
      S.othersAwake = t => {
        if (!this.players) return false;
        let n = 1, asleep = 1, long = true;
        for (const r of this.players.list.values()) {
          const s = r.st;
          // (spectators do not count; someone on the death screen does, and is awake: the game's SleepStatus)
          if (!s || s.d !== 0 || (s.f & F.SPEC)) continue;
          n++;
          if (s.f & F.SLEEP) { asleep++; if (!(s.f & F.SLEPT)) long = false; }
        }
        if (asleep >= n && long) return false;
        if (t % 20 === 0 && S.msg) S.msg.show(asleep + '/' + n + ' players sleeping', 30);
        return true;
      };
      const wake = S.wake;
      if (wake) S.wake = skipped => { if (skipped) this.slept = true; return wake(skipped); };
    }
  }
  applyWeather() {
    const W = this.game && this.game.sim && this.game.sim.weather;
    if (!W) return;
    W.rainingFlag = !!this.wx.r; W.thunderingFlag = !!this.wx.th;
    W.clearTime = 0; W.rainTime = 1; W.thunderTime = 1;
  }
  ownsAt(x, z) { return this.owns({ cx: Math.floor(x / 16), cz: Math.floor(z / 16) }); }
  dimNow() { return this.game ? dimCode(this.game.dim) : 0; }
  // within the server's spawn protection (the Overworld only, as the game has it)
  protectedAt(x, z) {
    const s = this.spawn;
    return this.prot > 0 && !!s && !!this.game && this.game.dim === 'overworld' && Math.max(Math.abs(x - s.x), Math.abs(z - s.z)) <= this.prot;
  }
  // whether no other player in this dimension is nearer to a chunk (the lower number wins a tie)
  owns(c) {
    const g = this.game;
    if (!this.players || !g) return true;
    const mx = c.cx * 16 + 8, mz = c.cz * 16 + 8, P = g.player.pos, D = dimCode(g.dim);
    const mine = (P.x - mx) ** 2 + (P.z - mz) ** 2;
    for (const r of this.players.list.values()) {
      const s = r.st;
      if (!s || s.d !== D || (s.f & F.DEAD)) continue;
      const d2 = (s.x - mx) ** 2 + (s.z - mz) ** 2;
      if ((d2 < mine || (d2 === mine && r.id < this.id)) && d2 < 128 * 128) return false;
      // (joined hidden, nobody else knows you are there to leave it to you: anyone near has it)
      if (this.hidden && d2 < 128 * 128) return false;
    }
    return true;
  }

  /* ---- hitting another player ----
     The crosshair's ray against each player's box (0.6 wide, 1.8 tall, 1.5
     sneaking) within reach and short of whatever else it found. What comes
     back stands in for them in the combat code (combat/combat.js attack): its
     hurt() is the hit, worked out here as the game does (the charge, a
     critical when falling, a sprint's extra knockback) and sent to the
     server, which checks the reach and passes it on; their own game takes
     the damage, with their armour, and knocks them back. */
  pickPlayer(E, eye, blockT, found) {
    if (!this.players || !this.server.pvp || this.closed || this.game.mode === 'spectator') return found;
    const g = this.game, P = g.player, D = dimCode(g.dim);
    const dx = -Math.sin(P.yaw) * Math.cos(P.pitch), dy = Math.sin(P.pitch), dz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    let lim = Math.min(E.combat.reach(), blockT === undefined ? Infinity : blockT);
    if (found) { const h = E.raycast(eye, { x: dx, y: dy, z: dz }, lim); if (h) lim = h.t; }
    let best = null;
    for (const r of this.players.list.values()) {
      if (!this.hittable(r, D)) continue;
      const f = r.feet, h = heightOf(r.st, r.id);
      const hw = 0.3 * playerSize.of(r.id), t = rayBox(eye.x, eye.y, eye.z, dx, dy, dz, f.x - hw, f.y, f.z - hw, f.x + hw, f.y + h, f.z + hw);
      if (t < lim) { lim = t; best = r; }
    }
    return best ? this.proxyOf(best) : found;
  }
  // a player who can be hit here: in this dimension, drawn, alive, not a spectator
  hittable(r, D) {
    const s = r.st;
    return !!(s && r.feet && s.d === D && !(s.f & (F.DEAD | F.SPEC)) && r.av && r.av.started);
  }
  /* What stands in for another player in the combat code and for what you
     shoot (combat/combat.js attack, entities/projectiles.js): its box, and its
     hurt(), which works out the hit as the game does and sends it. (No
     customName: their name is drawn over them already, players.js.) */
  proxyOf(r) {
    if (r.proxy) { r.proxy.name = r.name; r.proxy.h = heightOf(r.st, r.id); return r.proxy; }
    const net = this;
    r.proxy = {
      remotePlayer: true, type: 'player', id: 'p' + r.id, name: r.name, get pos() { return r.feet; }, get hw() { return 0.3 * playerSize.of(r.id); }, get w() { return 0.6 * playerSize.of(r.id); }, h: heightOf(r.st, r.id),
      removed: false, dead: false, vel: { x: 0, y: 0, z: 0 }, fire: 0, kbResist: 0,
      dist2(x, y, z) { const f = r.feet; return (f.x - x) ** 2 + (f.y - y) ** 2 + (f.z - z) ** 2; },
      hurt(amount, src, info) { return src && (src.type === 'arrow' || src.type === 'trident' || src.type === 'thrown' || src.type === 'wind_charge') ? net.shotPlayer(r, amount, src) : net.hitPlayer(r, amount, info); },
      // a flaming arrow's fire, said with the hit that follows it
      setFire(s) { this.fire = Math.max(this.fire, s | 0); },
      // a tipped or spectral arrow's effects, after its hit
      addEffect(n, lv, t, by, inst) { net.send({ t: 'hit', id: r.id, k: 'arrow', dmg: 0, ef: [[n, lv | 0, t | 0, inst === undefined ? 1 : +inst]] }); return true; },
      knockback() {},
      /* a push that hurts nothing (a mace's shockwave, a fishing rod's pull, a wind charge's burst): added to
         their velocity on their machine, less by their knockback resistance (struck) */
      push(x, y, z) { const q = v => Math.round(v * 1000) / 1000; net.send({ t: 'hit', id: r.id, k: 'push', dmg: 0, v: [q(x), q(y), q(z)] }); },
    };
    return r.proxy;
  }
  /* Your hit on another player, as the game's Player.attack works it out:
     the cooldown's share (combat.js passes base, bonus and charge), a
     critical (falling, not sprinting) x1.5 on the base, a sprint's extra
     knock, a mace's smash, a sword's sweep (everyone within a block of them
     takes 1 and Sweeping Edge's share), Fire Aspect. The weapon wears and the
     hit is tiring. Their game takes it with their armour and shield. */
  hitPlayer(r, amount, info) {
    const g = this.game, P = g.player, E = g.entities, C = E && E.combat;
    if (!C || g.mode === 'spectator' || !this.server.pvp) return false;
    const inv = g.inv, st = inv.slots[inv.selected], id = st ? st.id : 0, w = weaponOf(id), fx = (g.survival && g.survival.effects) || {};
    const c = info ? info.c : 1, strong = c > 0.9, spin = !!(info && info.spin);
    let base = info ? info.base : amount;
    const bonus = info ? info.bonus : 0;
    if (!(base > 0 || bonus > 0)) return false;
    const sprint = P.sprinting && strong;
    let smash = false;
    if (w.kind === 'mace' && !spin && P.fallDistance > 1.5 && !P.flying && !P.gliding) { base += smashBonus(P.fallDistance, enchOf(st, 'density')); smash = true; }
    const crit = strong && P.fallDistance > 0 && !P.onGround && !P.climbing && !P.inWater && !(E.riding) && !P.flying && !P.sprinting && !fx.blindness && !fx.slow_falling && w.kind !== 'spear';
    if (crit) base *= 1.5;
    const mx = P.pos.x - P.prev.x, mz = P.pos.z - P.prev.z, slow = 0.1 * (1 + 0.2 * (fx.speed ? fx.speed.level || 1 : 0)) * 2.5;
    const sweep = strong && !crit && !sprint && P.onGround && mx * mx + mz * mz < slow * slow && w.kind === 'sword' && !spin && !C.legacy;
    const kb = enchOf(st, 'knockback') + (sprint ? 1 : 0);
    if (kb > 0) { P.vel.x *= 0.6; P.vel.z *= 0.6; P.sprinting = false; }
    const item = st && st.name ? String(st.name).slice(0, 50) : undefined;
    const br = enchOf(st, 'breach');
    this.send({ t: 'hit', id: r.id, k: smash ? 'smash' : spin ? 'spin' : 'melee', dmg: Math.round((base + bonus) * 1000) / 1000, kb, crit, fire: enchOf(st, 'fire_aspect') * 4, axe: w.kind === 'axe' ? 1 : 0, item, br: br || undefined });
    const pr = this.proxyOf(r), sn = Math.sin(P.yaw), cs = Math.cos(P.yaw);
    if (sweep) {
      // the others beside them, and the mobs (combat.js sweep)
      const ratio = enchOf(st, 'sweeping_edge') / (enchOf(st, 'sweeping_edge') + 1), f = r.feet, D = dimCode(g.dim);
      for (const q of this.players.list.values()) {
        if (q === r || !this.hittable(q, D)) continue;
        const o = q.feet;
        if (Math.abs(o.x - f.x) > 1.6 || Math.abs(o.z - f.z) > 1.6 || o.y + heightOf(q.st, q.id) < f.y - 0.25 || o.y > f.y + pr.h + 0.25) continue;
        if ((o.x - P.pos.x) ** 2 + (o.y - P.pos.y) ** 2 + (o.z - P.pos.z) ** 2 >= 9) continue;
        this.send({ t: 'hit', id: q.id, k: 'sweep', dmg: Math.round((1 + ratio * info.base + enchantBonus(st, null)) * c * 1000) / 1000, kb: 0.8, item });
      }
      C.sweep(pr, st, info.base, c, sn, cs);
    }
    if (smash) C.smashed(pr, st);
    if (crit && E.particles) E.particles('crit', r.feet.x, r.feet.y + 0.9, r.feet.z, 12, 0.3);
    if (bonus > 0 && E.particles) E.particles('magic', r.feet.x, r.feet.y + 0.9, r.feet.z, 12, 0.3, [0.45, 0.75, 1]);
    if (g.mode !== 'creative') { const wr = spin ? 0 : wearPerHit(id); if (wr) C.wearHeld(wr); if (g.survival) g.survival.exhaust(0.1); }
    this.lastPvp = { to: r.name, k: smash ? 'smash' : 'melee', dmg: base + bonus, crit, sweep, kb, c, fall: Math.round(P.fallDistance * 100) / 100, ground: !!P.onGround, at: Math.round(performance.now()) };
    return true;
  }
  // your arrow, trident or snowball reached another player (on your screen): the hit goes to them
  shotPlayer(r, amount, src) {
    const d = src.direct, g = this.game, inv = g.inv, st = inv.slots[inv.selected];
    if (!this.server.pvp || !d) return false;
    // (a wind charge's 1 goes as a thrown thing's hit; its burst's push follows, Proxy.push)
    const k = src.type === 'wind_charge' ? 'thrown' : src.type, pr = this.proxyOf(r), r3 = v => Math.round(v * 1000) / 1000;
    this.send({ t: 'hit', id: r.id, k, dmg: amount < 0.01 ? amount : Math.round(amount * 1000) / 1000, dir: [r3(d.vel.x), r3(d.vel.y), r3(d.vel.z)], at: [r3(d.pos.x), r3(d.pos.y), r3(d.pos.z)],
      punch: d.knock || 0, fire: pr.fire || 0, pierce: d.pierce > 0 ? 1 : 0, crit: !!d.crit, item: st && st.name ? String(st.name).slice(0, 50) : undefined });
    pr.fire = 0;
    this.lastPvp = { to: r.name, k, dmg: amount };
    return true;
  }
  /* A hit from another player, taken here as the game takes one: their
     damage, through your shield (an axe puts it down for 5 seconds), armour
     and protection, the half second a hit protects for; knocked 0.4 away from
     them and their weapon's extra along their look, or along an arrow's
     flight (and Punch); set alight; a tipped arrow's effects. They are named
     in your death message if you die of it, or of anything in the next 5
     seconds (a fall, the fire). */
  struck(m) {
    const g = this.game, E = g.entities, sv = g.survival;
    if (!E || !E.combat || !sv || sv.dead) return;
    const r = this.players && this.players.list.get(m.from), s = r && r.st, P = g.player;
    const from = r && r.feet ? r.feet : s ? { x: s.x, y: s.y, z: s.z } : P.pos;
    const attacker = { customName: m.name, pos: from, remotePlayer: true,
      // pushed back off your raised shield (combat.js blocked): the game's knockback of that strength away from you, on their machine
      knockback: (s, dx, dz) => { if (r && m.from) this.send({ t: 'hit', id: m.from, k: 'push', dmg: 0, kb: s, v: [Math.round(dx * 1000) / 1000, 0, Math.round(dz * 1000) / 1000] }); } };
    // a tipped arrow's potion (after its hit)
    for (const e of Array.isArray(m.ef) ? m.ef : []) {
      const [n, lv, t, inst] = e, k = Math.max(0, Math.min(1, +inst || 1));
      if (g.mode === 'creative' || g.mode === 'spectator') break;
      if (n === 'instant_health') sv.heal(Math.floor(k * (4 << (lv - 1)) + 0.5));
      else if (n === 'instant_damage') sv.hurtEffect(Math.floor(k * (6 << (lv - 1)) + 0.5), 'magic');
      else if (E.effectPlayer) E.effectPlayer(n, t, lv);
    }
    // a push from them: added (less by knockback resistance), or with kb a knock away from where it came from
    if (m.k === 'push' && Array.isArray(m.v) && g.mode !== 'spectator') {
      if (m.kb > 0) E.combat.knockPlayer(m.kb, m.v[0], m.v[2]);
      else { const k = 1 - E.combat.knockbackResistance(); P.vel.x += m.v[0] * k; P.vel.y += m.v[1] * k; P.vel.z += m.v[2] * k; if (m.v[1] > 0) P.onGround = false; }
    }
    if (!(m.dmg > 0)) return;
    const proj = m.k === 'arrow' || m.k === 'trident' || m.k === 'thrown';
    const src = { type: proj ? m.k : m.k === 'smash' ? 'mace_smash' : 'player', attacker, x: from.x, z: from.z, knock: proj ? 0 : m.kb, yaw: s ? s.yaw : 0, axe: !!m.axe, breach: m.br | 0 };
    if (proj && Array.isArray(m.dir)) src.direct = { vel: { x: m.dir[0], y: m.dir[1], z: m.dir[2] }, pos: Array.isArray(m.at) ? { x: m.at[0], y: m.at[1], z: m.at[2] } : from, pierce: m.pierce ? 1 : 0 };
    // named in a death in the next 5 seconds (survival.js dying)
    sv.attacker = attacker; sv.attackerAge = sv.age;
    this.striking = m;
    let ok;
    try { ok = E.combat.hurtPlayer(m.dmg, src); } finally { this.striking = null; }
    if (!ok) return;
    this.pvpHit = { name: m.name, k: m.k, item: m.item, age: sv.age };
    // Punch: a push along the flight, 0.6 a level (less by knockback resistance), and 0.1 up
    if (m.punch > 0 && src.direct) {
      const v = src.direct.vel, l = Math.hypot(v.x, v.z) || 1, k = m.punch * 0.6 * (1 - E.combat.knockbackResistance());
      P.vel.x += v.x / l * k; P.vel.y += 0.1; P.vel.z += v.z / l * k;
    }
    if (m.fire && E.setPlayerFire) E.setPlayerFire(m.fire);
  }
  // your death message, as the game words it when another player did it ("X was slain by Y using [Z]")
  deathText(message) {
    const m = this.striking;
    if (!m) return message;
    const w = { arrow: ['was shot by', 'using'], trident: ['was impaled by', 'with'], thrown: ['was pummeled by', 'using'], smash: ['was smashed by', 'with'] }[m.k] || ['was slain by', 'using'];
    return `${this.name} ${w[0]} ${m.name}` + (m.item ? ` ${w[1]} [${m.item}]` : '');
  }

  /* ---- what you shoot and throw, seen by everyone ----
     Each machine flies its own: yours is sent as it leaves your hand (where
     it is and how fast), and the others fly a copy of it that touches
     nothing (it vanishes on whatever it meets, and an arrow or trident sticks
     where it lands). Whether it hit someone is your machine's to say. So are
     the shots of the mobs your machine runs (a skeleton's arrows, a blaze's
     or a ghast's fireballs). A fishing line is not a shot: events.js draws
     another player's. */
  shareShots() {
    if (!this.shots.length) return;
    const g = this.game, P = g.entities && g.entities.player, r3 = v => Math.round(v * 1000) / 1000, out = [];
    for (const e of this.shots) {
      const ow = e.owner;
      // (yours, a mob's your machine runs, or nobody's: a dispenser's arrow or fire charge here)
      if (!P || !(!ow || ow === P || (ow.nm && !ow.puppet)) || e.ghost || e.type === 'fishing_bobber' || out.length >= 16) continue;
      const o = { ty: e.type, p: [r3(e.pos.x), r3(e.pos.y), r3(e.pos.z)], v: [r3(e.vel.x), r3(e.vel.y), r3(e.vel.z)] };
      if (e.item) o.it = e.item;
      if (e.crit) o.c = 1;
      out.push(o);
    }
    this.shots.length = 0;
    if (out.length) this.send({ t: 'fx', d: dimCode(g.dim), k: 'shot', e: out });
  }
  ghostShots(m) {
    const g = this.game, E = g.entities, P = g.player;
    if (!E || dimCode(g.dim) !== m.d) return;
    for (const o of m.e) {
      if (!o || !Array.isArray(o.p) || !Array.isArray(o.v) || (o.p[0] - P.pos.x) ** 2 + (o.p[2] - P.pos.z) ** 2 > 128 * 128) continue;
      let e;
      this.applying = true;
      try { e = E.spawn(o.ty, o.p[0], o.p[1], o.p[2], { natural: false }); } catch (err) { e = null; } finally { this.applying = false; }
      if (!e || !(e instanceof Projectile)) { if (e) e.remove(); continue; }
      e.ghost = true; e.owner = null; e.pickup = 0;
      this.stats.ghosts = (this.stats.ghosts || 0) + 1;
      if (o.it) e.item = o.it;
      if (o.c) e.crit = true;
      e.vel.set(o.v[0], o.v[1], o.v[2]);
      e.yaw = e.prevYaw = Math.atan2(-o.v[0], -o.v[2]); e.pitch = e.prevPitch = Math.atan2(o.v[1], Math.hypot(o.v[0], o.v[2]));
      // it touches nothing: gone on whatever it meets; an arrow or trident stays stuck where it lands a while
      const sticks = e.type === 'arrow' || e.type === 'trident';
      e.hitEntity = function () { this.remove(); return true; };
      e.hitBlock = function (x, y, z) {
        if (!sticks) { if (this.m.particles) this.m.particles('poof', this.pos.x, this.pos.y, this.pos.z, 8, 0.1, [1, 1, 1]); this.remove(); return; }
        this.stuck = true; this.life = 0; this.vel.set(0, 0, 0); this.stuckAt = [x, y, z]; this.shake = 7;
      };
      e.stuckTick = function () { if (this.shake > 0) this.shake--; if (++this.life > (this.type === 'trident' ? 200 : 1200)) this.remove(); };
    }
  }
  // each tick: you are pushed off the other players you stand in, as the game pushes two entities apart
  pushTick() {
    const g = this.game, P = g.player, E = g.entities;
    if (!this.players || P.flying || g.mode === 'spectator' || (g.survival && g.survival.dead) || P.riding || (E && E.riding) || (g.sim && g.sim.sleeping)) return;
    const D = dimCode(g.dim), myH = P.h || 1.8;
    for (const r of this.players.list.values()) {
      const near = (P.halfW || 0.3) + 0.3 * playerSize.of(r.id);
      const s = r.st, f = r.feet;
      if (!s || !f || s.d !== D || (s.f & (F.DEAD | F.SPEC | F.SLEEP | F.RIDE))) continue;
      if (Math.abs(f.x - P.pos.x) >= near || Math.abs(f.z - P.pos.z) >= near || f.y >= P.pos.y + myH || f.y + heightOf(s, r.id) <= P.pos.y) continue;
      // (the game's Entity.push: along the larger of the two gaps, 0.05 a tick, harder the closer)
      let dx = f.x - P.pos.x, dz = f.z - P.pos.z, d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d < 0.01) continue;
      d = Math.sqrt(d); dx /= d; dz /= d;
      const k = Math.min(1, 1 / d) * 0.05;
      P.vel.x -= dx * k; P.vel.z -= dz * k;
    }
  }
  /* ---- the server's rules and difficulty, and commands run for someone else ---- */
  applyRules(rules) {
    this.rules = rules;
    if (rules.pvp !== undefined && this.server) this.server.pvp = !!rules.pvp;
    const g = this.game;
    if (g) g.rules = Object.assign(g.rules || {}, rules);
  }
  /* An operator's command aimed at you (/gamemode creative You, /give You
     ...): run here as if you had typed it, and what it said sent back to
     them; a change of game mode is told to you as the game tells it. Only
     the commands that act on a player, whatever the server passes on. */
  ranAs(m) {
    const g = this.game, ctx = this.ctx;
    if (!g || !ctx.commandCtx || typeof m.line !== 'string') return;
    const word = (m.line.trim().split(/\s+/)[0] || '').replace(/^\//, '').toLowerCase();
    if (!AS_OK.has(word)) return;
    const out = [];
    const c = Object.assign(ctx.commandCtx(), { cheats: true, say: (t, col) => out.push([String(t), col === undefined ? 0xFFFFFF : col]) });
    execute(m.line, c);
    const back = [];
    for (const [t, col] of out) {
      const gm = /^Set own game mode to (.*)$/.exec(t);
      if (gm) { ctx.chat.add(`Your game mode has been updated to ${gm[1]}`); back.push([`Set ${this.name}'s game mode to ${gm[1]}`, col]); }
      else back.push([t, col]);
    }
    this.send({ t: 'asr', to: m.fid, lines: back });
  }

  /* ---- your changes, sent at the end of the frame ---- */
  /* (a block you put down or broke yourself goes at once, when what the click did is done, not at the end of the
     frame: interact.js marks the world urgent while it works; the game's client sends the packet in the tick of the
     click. The whole click goes in one message: both halves of a door or a bed, a chest and its contents.) */
  local(w, x, y, z, b, m, prev) {
    const d = dimCode(w.dim), k = d + ':' + key3(x, y, z);
    const p = this.pending.get(k);
    this.pending.set(k, { s: this.seq + 1, prev: p ? p.prev : prev });
    const name = BLOCKS[b] ? BLOCKS[b].name : 'air';
    this.outB[d].push(x, y, z, name, m & 255);
    /* (a solid block taken away goes with its name: the server keeps the break only if that is still the block it
       has, so two players breaking one block at the same moment do not both get what it drops, mlhub lc2.js) */
    const was = BLOCKS[prev >> 8] ? BLOCKS[prev >> 8].name : 'air', broke = EMPTY.has(name) && !EMPTY.has(was);
    this.outO[d].push(broke ? was : '');
    // (and remembered a moment: a chest's contents spill from the simulation's own update, a send or two later)
    if (broke) this.broke.set(k, performance.now());
    if (w.urgent && !this.flushSoon) { this.flushSoon = true; queueMicrotask(() => { this.flushSoon = false; if (this.ws && this.game) this.flush(); }); }
  }
  queueC(x, y, z, c, hand) {
    const d = dimCode(this.game.dim), k = d + ':' + key3(x, y, z), was = this.outC.get(k);
    /* (a container gone and a new one put in its place before the next send: both go, the removal first; folded
       into one, the new record went with the old one's check, the server had already dropped that one with its
       block, and it answered gone: the new chest or furnace was dropped too) */
    const cut = !!c && !!was && (was[4] === null || !!was[6]);
    this.outC.set(k, [d, x, y, z, c, !!hand || !!(was && was[5]), cut]);
    this.pending.set('c' + k, { s: this.seq + 1 });
  }
  queueT(x, y, z, e) {
    const d = dimCode(this.game.dim), k = d + ':' + key3(x, y, z);
    this.outT.set(k, [d, x, y, z, e]);
    this.pending.set('t' + k, { s: this.seq + 1 });
  }
  flush() {
    if (this.outFx.length) { this.send({ t: 'fx', d: dimCode(this.game.dim), k: 'break', e: this.outFx }); this.outFx = []; }
    /* (your own record first, whenever what goes now is something your hands did to the world: a chest changed by a
       click, something dropped. It went every two seconds at most, so a second login, a dropped line or a closed
       browser right after putting things into a chest gave them back to you from the older record.) */
    if (this.pdata && !this.watch && (this.outIt.length || [...this.outC.values()].some(x => x[5]))) this.quickSave(true);
    /* What fell out of a block changed in this send (an ore's drop, a chest's spill, a frame's item, a disc) goes after
       the change, marked with its cell (bk): if the server turns the change down (someone else broke or emptied it a
       moment before), it turns those items down too and they go (numbered -1). Things thrown and a death's spill
       are never tied. */
    const tied = [];
    if (this.outIt.length) {
      const cells = new Set([...this.outC.keys(), ...this.outT.keys()]), now = performance.now();
      for (let d = 0; d < 3; d++) for (let i = 0, e = this.outB[d]; i < e.length; i += 5) cells.add(d + ':' + key3(e[i], e[i + 1], e[i + 2]));
      for (const [k, t] of this.broke) { if (now - t > 1500) this.broke.delete(k); else cells.add(k); }
      if (cells.size) {
        const free = [];
        for (const o of this.outIt) {
          const got = this.byKey.get(o.k), it = got && got[0];
          const fx = Math.floor(o.p[0]), fy = Math.floor(o.p[1]), fz = Math.floor(o.p[2]);
          const at = cells.has(o.d + ':' + key3(fx, fy, fz)) ? fy : cells.has(o.d + ':' + key3(fx, fy - 1, fz)) ? fy - 1 : null;
          if (at === null || o.dth || (it && it.thrown)) { free.push(o); continue; }
          o.bk = [fx, at, fz];
          tied.push(o);
        }
        this.outIt = free;
      }
    }
    // (256 a message at most, the server's limit: a bigger one was thrown away whole, and its items were never numbered)
    while (this.outIt.length) this.send({ t: 'it+', e: this.outIt.splice(0, 256) });
    if (!this.outC.size && !this.outT.size && !this.outB[0].length && !this.outB[1].length && !this.outB[2].length) return;
    const s = ++this.seq, msgs = [];
    for (let d = 0; d < 3; d++) {
      const e = this.outB[d];
      if (!e.length) continue;
      this.stats.sentB += e.length / 5;
      // a long run goes in parts the server takes in one go
      for (let i = 0; i < e.length; i += 5 * 8192) {
        const msg = { t: 'b', d, e: e.slice(i, i + 5 * 8192) }, o = this.outO[d].slice(i / 5, i / 5 + 8192);
        if (o.some(Boolean)) msg.o = o;
        msgs.push(msg);
      }
      this.outB[d] = []; this.outO[d] = [];
    }
    for (const [, [d, x, y, z, c, hand, cut]] of this.outC) {
      const k = key3(x, y, z);
      if (cut && this.ct[d].has(k)) { msgs.push({ t: 'ct', d, p: [x, y, z], o: null, b: recHash(this.ct[d].get(k)) }); this.ct[d].delete(k); }
      const o = c ? packContainer(c) : null, prev = this.ct[d].get(k);
      if (o) this.ct[d].set(k, o); else this.ct[d].delete(k);
      /* (with the check of what it was made from, the record as this page last had it: the server keeps a change
         only if that is what it keeps now, mlhub lc2.js ctClash; one made by hand is remembered until it is taken,
         to be undone if it is not) */
      const msg = { t: 'ct', d, p: [x, y, z], o, b: prev ? recHash(prev) : '' }, moved = this.handOut.get(d + ':' + k);
      this.handOut.delete(d + ':' + k);
      if (hand && moved) {
        const hd = [...moved].filter(e => e[1]);
        if (hd.length) { msg.h = hd; this.ctMine.set(d + ':' + k, { hd, s }); }
      }
      msgs.push(msg);
    }
    this.outC.clear();
    for (const [, [d, x, y, z, e]] of this.outT) {
      const o = e ? packDetail(e) : null, k = key3(x, y, z);
      if (o === undefined) continue;
      const prev = this.dt[d].get(k);
      if (o) this.dt[d].set(k, o); else this.dt[d].delete(k);
      const msg = { t: 'dt', d, p: [x, y, z], o };
      /* (what holds an item, with the check of the record it was made from, as a chest's: two players punching
         one frame or taking one book at once do not both get it; the loser's change is undone, detail()) */
      if (HOLDS.has((o || prev || {}).k)) { msg.b = prev ? recHash(prev) : ''; this.dtMine.set(d + ':' + k, { prev: prev || null, sent: o, s }); }
      msgs.push(msg);
    }
    this.outT.clear();
    // the last one carries the number: the server answers it once it has taken them all
    msgs[msgs.length - 1].s = s;
    for (const m of msgs) this.send(m);
    while (tied.length) this.send({ t: 'it+', e: tied.splice(0, 256) });
  }

  /* ---- where you are, on each tick that something changed (and once a second regardless) ---- */
  sendState(stamp) {
    const g = this.game, P = g.player, S = this.sent;
    const sv = g.survival, dead = !!(sv && sv.dead);
    const fx = sv && sv.effects;
    let f = (P.sneaking ? F.SNEAK : 0) | (P.sprinting ? F.SPRINT : 0) | (P.flying ? F.FLY : 0) | (P.pose === 'swim' ? F.SWIM : 0) |
      (P.onGround ? F.GROUND : 0) | (g.sim && g.sim.sleeping ? F.SLEEP | (g.sim.sleeping.t >= 100 ? F.SLEPT : 0) : 0) | (dead ? F.DEAD : 0) | (P.gliding ? F.GLIDE : 0) | (P.riding ? F.RIDE : 0) |
      (g.mode === 'spectator' ? F.SPEC : 0) | (fx && fx.invisibility ? F.INVIS : 0) | (fx && fx.glowing ? F.GLOW : 0) | (g.entities && g.entities.pFire > 0 && !dead ? F.FIRE : 0) | (P.spinning && !dead ? F.SPIN : 0);
    const d = dimCode(g.dim);
    // (a millimetre and a twentieth of a degree: finer than any screen shows, in fewer characters)
    const r3 = v => Math.round(v * 1000) / 1000;
    // (a Leonpixel hider watching the others: the body they left is what everyone sees and hits, standing on its spot)
    const B = this.bodyAt;
    if (B) f = (f & ~(F.FLY | F.SNEAK | F.SPRINT | F.SWIM)) | F.GROUND;
    const x = r3(B ? B.x : P.pos.x), y = r3(B ? B.y : P.pos.y), z = r3(B ? B.z : P.pos.z), yaw = r3(B ? B.yaw : P.yaw), pitch = r3(B ? B.pitch : P.pitch);
    // what the use button is doing with your hands (render/avatar.js useNow): a bow drawn, food, a shield up
    const U = this.ctx.renderer.avatar.useNow, k = U ? USE_KINDS.indexOf(U.kind) : -1;
    const u = k >= 0 ? (k + 1) | ((U.side | 0) ? 16 : 0) : 0, ut = u ? Math.round((U.t || 0) * 10) / 10 : 0, uT = u ? U.total | 0 : 0;
    if (x === S.x && y === S.y && z === S.z && yaw === S.yaw && pitch === S.pitch && f === S.f && d === S.d && u === S.u && ut === S.ut && stamp - S.at < 1000) return;
    const ts = Math.round(stamp), q = [ts, Math.round(x * 1000), Math.round(y * 1000), Math.round(z * 1000), Math.round(yaw * 1000), Math.round(pitch * 1000)];
    let m;
    /* [0, ts, x, y, z, yaw, pitch, flags, dim, use, useT, useTotal] (lc2.js position()) the first
       time and every fortieth (two seconds), and between, to a server that reads them, what changed
       ([1, dts, dx, dy, dz, dyaw, dpitch, flags, dim, use...]: lc2.js position()) */
    if (!(this.server.pv >= 3) || ++S.n % 40 === 0 || !S.q) {
      m = [0, ts, x, y, z, yaw, pitch, f, d];
      if (u) m.push(u, ut, uT);
      S.n = 0;
    } else {
      m = [1];
      for (let i = 0; i < 6; i++) m.push(q[i] - S.q[i]);
      const tail = f !== S.f || d !== S.d || u;
      if (!tail) while (m.length > 2 && m[m.length - 1] === 0) m.pop();
      else { m.push(f, d); if (u) m.push(u, ut, uT); }
    }
    Object.assign(S, { at: stamp, x, y, z, yaw, pitch, f, d, u, ut, q });
    this.stats.sentP++;
    this.send(m);
  }
  sendEquip() {
    const inv = this.game.inv, h = inv.slots[inv.selected], o = inv.offhand;
    this.lastHeld = inv.heldId();
    const a = inv.armor ? inv.armor.map(s => (s ? stackToJSON(s) : null)) : null;
    const eq = { h: h ? itemName(h.id) : '', o: o ? itemName(o.id) : '', hg: glints(h), og: glints(o), a };
    // a loaded crossbow: what it is loaded with ("a" an arrow, "r" a firework rocket), drawn so on their screens
    const ch = s => s && s.charged && s.charged.length ? (s.charged[0][0] === 'firework_rocket' ? 'r' : 'a') : undefined;
    if (ch(h)) eq.hc = ch(h);
    if (ch(o)) eq.oc = ch(o);
    const sig = JSON.stringify(eq);
    if (sig === this.eqSig) return;
    this.eqSig = sig;
    this.send(Object.assign({ t: 'eq' }, eq));
  }
  /* Between those saves: as you die (what you had is on the ground now), and
     within two seconds of your inventory changing (something thrown, picked
     up, put in a chest), so a page that closes without a word cannot leave
     the server holding things that are also lying on the ground. */
  quickSave(now) {
    const g = this.game, sv = g.survival, dead = !!(sv && sv.dead);
    const due = now || dead !== this.wasDead || (++this.qsT % 40 === 0 && g.inv.toJSON && JSON.stringify(g.inv.toJSON()) !== this.invSig);
    this.wasDead = dead;
    if (!due || !this.pdata || !g.inv.toJSON) return;
    const P = g.player, inventory = g.inv.toJSON();
    this.invSig = JSON.stringify(inventory);
    this.savePlayer(Object.assign({}, this.pdata, { inventory, survival: sv.toJSON(), mode: g.mode, dimension: g.dim, hands: g.hands ? g.hands.toJSON() : this.pdata.hands,
      player: { x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: P.yaw, pitch: P.pitch, flying: P.flying } }));
  }
  // your own record to the server (main.js saves every ten seconds, as you leave, and when the page is hidden): only when it changed
  savePlayer(s) {
    // (the chests of mobs, carts and chest boats changed here go first: your record after them, never the other way)
    this.flushEntities();
    const o = {};
    for (const k of PLAYER_KEYS) if (s[k] !== undefined) o[k] = s[k];
    const str = JSON.stringify(o);
    if (str === this.pdSent || str.length > 250000) return;
    this.pdSent = str;
    this.pdata = o;
    if (this.ws.readyState === 1) { try { this.ws.send('{"t":"pd","s":' + str + '}'); } catch (e) {} }
  }
  sendSkin() {
    const s = getSkinSettings();
    // (Chameleon's painted skin stands in for yours while the game lasts: net/hub.js)
    const own = this.skinOverride || (typeof s.skin === 'string' && s.skin.startsWith('data:image/png') ? s.skin : '');
    const skin = own, slim = this.skinOverride ? false : !!s.slim;
    // the cape (none while a game paints you over: it would give you away)
    const cape = !this.skinOverride && typeof s.cape === 'string' && s.cape.startsWith('data:image/png') && s.cape.length <= 16000 ? s.cape : '';
    const sig = skin.length + ':' + skin.slice(-64) + slim + ':' + cape.length + cape.slice(-48);
    if (sig === this.skinSig) return;
    this.skinSig = sig;
    this.send({ t: 'skin', skin: skin.length <= 24000 ? skin : '', slim, cape });
  }

  /* ---- the server's news that changes the world, on a tick ---- */
  handle(m) {
    const g = this.game;
    switch (m.t) {
      case 'b': this.stats.gotB += m.e.length / 5; this.blocks(m.d, m.e); return;
      case 'ack': for (const [k, p] of this.pending) if (p.s <= m.s) this.pending.delete(k); for (const [k, p] of this.ctMine) if (p.s <= m.s) this.ctMine.delete(k); for (const [k, p] of this.dtMine) if (p.s <= m.s) this.dtMine.delete(k); if (this.xpHeld.size) this.payXp(m.s); return;
      case 'rej': this.rejected(m.d, m.e, m.q); return;
      case 'ct': this.container(m.d, m.p, m.o, m.gone || m.clash); return;
      // a change of yours by hand that was lost: the chest was destroyed from how it was before it (the server's ctGone)
      case 'ctundo': this.undoHand(m.hd); return;
      case 'dt': this.detail(m.d, m.p, m.o, m.lost); return;
      case 'chat':
        if (m.system) this.ctx.chat.add(m.text, m.colour !== undefined ? m.colour : 0xFFFF55);
        // (a rank tag before the name, as servers show it: [ADMIN] red, [OWNER] gold)
        // (and (hidden) after the name of an admin who joined hidden: only the hidden players get their lines)
        else this.ctx.chat.add('<' + rankTag(m.tag) + m.name + (m.hid ? ' §3(hidden)§r' : '') + '> ' + m.text);
        return;
      case 'time': {
        // the server's clock, moved on by half the time the message took
        const t = m.time + Math.round(this.rtt / 100);
        this.time = t; this.timeAt = performance.now();
        if (Math.abs(g.time - t) > 1) g.time = t;
        // the night slept through (by whoever's machine got there first): everyone in a bed gets up, as the game wakes them all
        if (m.wake && g.sim && g.sim.sleeping && g.sim.wake) g.sim.wake(true);
        return;
      }
      case 'wx': this.wx = { r: !!m.r, th: !!m.th }; this.applyWeather(); return;
      case 'spawn': this.spawn = m.spawn; if (m.spawn) g.spawn = { x: m.spawn.x, z: m.spawn.z }; return;
      case 'hit': this.struck(m); return;
      case 'rules': this.applyRules(m.rules || {}); return;
      case 'diff': this.server.difficulty = m.d; if (this.ctx.setDifficulty) this.ctx.setDifficulty(m.d); return;
      // the mode the server gives you (a change of yours it did not keep, or the server's default changing)
      case 'gm': {
        if (typeof m.m !== 'string' || !this.gm) return;
        this.gm = this.sentGm = m.m;
        const c = this.ctx.commandCtx && this.ctx.commandCtx();
        if (c && c.setMode && g.mode !== m.m) c.setMode(m.m);
        return;
      }
      case 'as': this.ranAs(m); return;
      case 'hub': if (this.hub) this.hub.receive(m); return;
      // the server sends you somewhere (/home, an accepted /tpa): a place in a dimension, or the world spawn
      case 'go': {
        const c = this.ctx.commandCtx && this.ctx.commandCtx();
        if (!c) return;
        if (m.spawn) { if (c.goSpawn) c.goSpawn(); return; }
        if (c.goTo && DIM_IDS[m.d | 0]) c.goTo(DIM_IDS[m.d | 0], +m.x, +m.y, +m.z, +m.yaw, +m.pitch);
        return;
      }
      case 'it+': for (const o of m.e || []) { const rec = this.keepItem(o); if (rec && rec.d === dimCode(g.dim)) this.showItem(rec); } return;
      case 'it=': this.numbered(m.e || []); return;
      case 'it-': case 'itno': this.hopperAsks.delete(m.id); this.itemGone(m.id, m.by); return;
      case 'itok': this.granted(m.id, m.s); return;
      case 'itc': this.itemCount(m.id, m.s, m.ag); return;
      case 'o=': case 'o+': case 'o-': case 'ono': case 'ook': this.orbs.receive(m); return;
      case 'pm':
        if (m.err) this.ctx.chat.add(m.err, 0xFF5555);
        else if (m.to) this.ctx.chat.add(`You whisper to ${m.to}: ${m.text}`, 0xAAAAAA);
        else this.ctx.chat.add(`${m.from} whispers to you: ${m.text}`, 0xAAAAAA);
        return;
    }
  }
  /* ---- the items lying about ----
     Every item this machine makes (drops.js spawn: thrown, spilled, out of a
     block, a mob's) is sent to the server, which numbers it and passes it on;
     the others make it with the same push. Each machine moves its own copy
     (the same ground, so the same path). Picking one up is asked of the
     server by number (the first to ask gets it); until it answers the item
     stays where it is. One that burns, falls out of the world or lies its
     five minutes goes on everyone's machine by itself; the player nearest to
     it tells the server. Items of the same kind lying together are joined
     by the server, not here (each machine would join them differently): it
     says which one grew ('itc') and which went. The server also says when
     an item's five minutes are up, counting only the ticks it lay near a
     player, as the game counts an item's age only in a ticked chunk. One a
     blast here blew up is told to everyone by this machine, whoever is
     nearest it; a death's spill is marked, so the server keeps it even when
     the world is full. */
  hookDrops(D) {
    const net = this;
    this.hdr = D;
    // what this browser kept from before (a dimension's drops, the last session's) is not the server's: gone
    this.applying = true;
    try { for (const e of D.items.slice()) if (!e.nid && !e.nk) D._remove(e, -1); } finally { this.applying = false; }
    const spawn = D.spawn, remove = D._remove, tick = D.tick, toJSON = D.toJSON;
    D.spawn = function (x, y, z, stack, opts) {
      const e = spawn.call(this, x, y, z, stack, opts);
      if (e && !net.applying && !net.closed) net.shareItem(e);
      return e;
    };
    D._remove = function (e, i) {
      const had = !e.gone;
      remove.call(this, e, i);
      if (!had || net.applying || net.closed || e.taken || e.quiet) return;
      // (burnt, fallen out of the world, taken by a hopper: said by the player nearest it; blown up: by whoever's blast it was)
      if (e.nid && (e.blown || net.ownsAt(e.pos.x, e.pos.z))) { net.send({ t: 'it-', id: e.nid }); net.items[dimCode(net.game.dim)].delete(e.nid); }
    };
    D._merge = function () {};
    /* A hopper or a hopper cart on this page wants a shared item: asked for as a player asks (it-, take), and put in
       when the server gives it, the rest dropped again as an item of its own, so the server's count stays right.
       (Taken here alone, part of a stack shrank on this page and the server still held the whole stack, given whole
       to the next player to walk into it.) */
    D.askFor = function (e, put) {
      if (!e.nid || net.closed) return false;
      const now = performance.now();
      if (e.asked && now - e.asked < 2000) return false;
      e.asked = now;
      net.hopperAsks.set(e.nid, put);
      net.send({ t: 'it-', id: e.nid, take: 1 });
      return true;
    };
    D.toJSON = function () { const o = toJSON.call(this); o.items = []; return o; };
    D.tick = function (player, collector) {
      // a shared item is never picked up here directly: its own count-down is kept, and the server asked (pickups)
      for (const e of this.items) if ((e.nid || e.nk) && e.fly <= 0) { if (e.wait === undefined) e.wait = e.delay; e.delay = 2; }
      tick.call(this, player, collector);
      if (!net.closed) net.pickups(this, player, collector);
    };
    for (const rec of this.items[dimCode(this.game.dim)].values()) { rec.e = null; this.showItem(rec); }
    // and the orbs of experience (mobs.js)
    this.orbs.hook(D);
  }
  keepItem(o) {
    if (!o || !(o.id > 0) || !(o.d >= 0 && o.d < 3) || !Array.isArray(o.p)) return null;
    const rec = { id: o.id, d: o.d, s: o.s, p: o.p, v: o.v || [0, 0, 0], dl: o.dl | 0, ag: o.ag | 0, at: performance.now(), e: null };
    this.items[o.d].set(o.id, rec);
    return rec;
  }
  // a record made into an item in this dimension's drops, with the age and push it has now
  showItem(rec) {
    const D = this.game && this.game.drops;
    if (!D || (rec.e && !rec.e.gone)) return;
    const st = stackFromJSON(rec.s);
    if (!st) return;
    const ago = Math.floor((performance.now() - rec.at) / 50), fresh = ago < 3;
    // (the time it waited counts towards its age only where this machine ticks the world, as the server counts it)
    const aged = !D._awake || D._awake(rec.p[0], rec.p[2]) ? ago : 0;
    this.applying = true;
    let e;
    try { e = D.spawn(rec.p[0], rec.p[1], rec.p[2], st, { vel: fresh ? rec.v : [0, 0, 0], delay: Math.max(0, rec.dl - ago), age: rec.ag + aged, pop: false }); }
    finally { this.applying = false; }
    if (!e) return;
    e.nid = rec.id; e.wait = Math.max(0, rec.dl - ago);
    rec.e = e;
  }
  shareItem(e) {
    const d = dimCode(this.game.dim), k = ++this.itemKey;
    e.nk = k; e.wait = e.delay;
    this.byKey.set(k, [e, d]);
    const r3 = v => Math.round(v * 1000) / 1000;
    // (mx: how many of it make a full stack, for the server's joining; dth: a death's spill)
    const o = { k, d, p: [r3(e.pos.x), r3(e.pos.y), r3(e.pos.z)], v: [r3(e.vel.x), r3(e.vel.y), r3(e.vel.z)], s: stackToJSON(e.stack), dl: e.delay | 0, ag: e.age | 0, mx: maxStack(e.stack.id) };
    if (e.keep) o.dth = 1;
    this.outIt.push(o);
  }
  // two stacks lying together joined on the server: this one is now the stack s (the other one goes with an 'it-')
  itemCount(id, s, ag) {
    const st = stackFromJSON(s);
    for (const M of this.items) {
      const rec = M.get(id);
      if (!rec || !st) continue;
      rec.s = s;
      if (Number.isInteger(ag)) rec.ag = ag;
      if (rec.e && !rec.e.gone) { rec.e.stack.count = st.count; if (Number.isInteger(ag)) rec.e.age = ag; }
    }
  }
  // the server's numbers for the items this machine made ([key, number, ...]; 0: not kept, so it stays this machine's own)
  numbered(a) {
    for (let i = 0; i + 1 < a.length; i += 2) {
      const got = this.byKey.get(a[i]);
      if (!got) continue;
      this.byKey.delete(a[i]);
      const [e, d] = got, id = a[i + 1] | 0;
      e.nk = 0;
      // (out of a change the server turned down, flush(): it never was)
      if (id < 0) { const D = this.game && this.game.drops; if (D && !e.gone) { this.applying = true; try { D._remove(e, -1); } finally { this.applying = false; } } continue; }
      if (!id) { e.delay = e.wait || 0; e.wait = undefined; continue; }
      e.nid = id;
      const rec = { id, d, s: stackToJSON(e.stack), p: [e.pos.x, e.pos.y, e.pos.z], v: [0, 0, 0], dl: 0, ag: e.age, at: performance.now(), e };
      this.items[d].set(id, rec);
      // gone already (burnt at once, taken by a hopper): gone for everyone
      if (e.gone) { this.items[d].delete(id); this.send({ t: 'it-', id }); }
    }
  }
  itemGone(id, by) {
    for (const M of this.items) {
      const rec = M.get(id);
      if (!rec) continue;
      M.delete(id);
      const e = rec.e, D = this.game && this.game.drops;
      if (!e || e.gone || !D || e.taken) continue;
      // picked up by someone you can see: it flies to them, halfway up, as the game shows it
      const r = by && this.players && this.players.list.get(by);
      if (r && D.flyIn) {
        e.taken = true;
        D.flyIn(e, out => {
          const pl = this.players, q = pl && r.rt !== undefined && pl.list.get(by) === r ? pl.at(r, r.rt) : null;
          return q ? out.set(q.x, q.y + 0.81, q.z) : null;
        });
        continue;
      }
      this.applying = true; try { D._remove(e, -1); } finally { this.applying = false; }
    }
  }
  // each tick: shared items counted down, and the ones you walk into asked for; where they came to rest, now and then
  pickups(D, player, collector) {
    const P = player && player.pos, now = performance.now(), d = dimCode(this.game.dim);
    const alive = collector && collector.alive && !(this.game.survival && this.game.survival.dead) && this.game.mode !== 'spectator';
    for (const e of D.items) {
      if (e.gone || e.fly > 0 || (!e.nid && !e.nk)) continue;
      if (e.wait > 0) e.wait--;
      if (!e.nid || e.wait > 0 || !P || !alive) continue;
      if (e.asked && now - e.asked < 2000) continue;
      const dx = Math.abs(e.pos.x - P.x), dz = Math.abs(e.pos.z - P.z);
      if (!(dx < 0.3 + 1 + 0.125 && dz < 0.3 + 1 + 0.125 && e.pos.y + 0.25 > P.y - 0.5 && e.pos.y < P.y + 1.8 + 0.5)) continue;
      if (collector.inv.roomFor(e.stack) <= 0) continue;
      // (a minigame may keep something out of a player's hands: Murder Mystery's murderer never takes up a bow, net/hub.js)
      if (this.mayTake && !this.mayTake(e.stack)) continue;
      e.asked = now;
      this.send({ t: 'it-', id: e.nid, take: 1 });
    }
    // once a second: where this machine's items lie, for the records (and for anyone arriving later)
    if (++this.itemTick % 20) return;
    const out = [];
    for (const rec of this.items[d].values()) {
      const e = rec.e;
      if (!e || e.gone) continue;
      rec.p = [e.pos.x, e.pos.y, e.pos.z]; rec.v = [0, 0, 0]; rec.dl = e.wait | 0; rec.ag = e.age; rec.at = now;
      if (e.onGround && (e.sentX !== e.pos.x || e.sentY !== e.pos.y || e.sentZ !== e.pos.z) && this.ownsAt(e.pos.x, e.pos.z) && out.length < 2000) {
        e.sentX = e.pos.x; e.sentY = e.pos.y; e.sentZ = e.pos.z;
        out.push(rec.id, Math.round(e.pos.x * 100) / 100, Math.round(e.pos.y * 100) / 100, Math.round(e.pos.z * 100) / 100);
      }
    }
    if (out.length) this.send({ t: 'itp', e: out });
  }
  // the server gave you an item you walked into: into the inventory, flying to you as the game draws it
  granted(id, s) {
    const g = this.game, rec = this.items.map(M => M.get(id)).find(Boolean);
    for (const M of this.items) M.delete(id);
    const st = stackFromJSON(s);
    if (!st || !g) return;
    const e = rec && rec.e, D = g.drops, inv = g.collector.inv;
    // (one a hopper here asked for: into it, the rest dropped again where it lay)
    const put = this.hopperAsks.get(id);
    if (put) {
      this.hopperAsks.delete(id);
      if (e && !e.gone && D) { this.applying = true; try { D._remove(e, -1); } finally { this.applying = false; } }
      try { put(st); } catch (err) { console.warn('hopper', err); }
      if (st.count > 0 && D) { const p = e ? e.pos : g.player.pos; D.spawn(p.x, p.y, p.z, st, { pop: false, delay: 10 }); }
      return;
    }
    const count = st.count, left = inv.addStack(st);
    if (left < count && D && D.onPickup) D.onPickup(st);
    if (e && !e.gone) { e.taken = true; e.fly = 3; e.flyFrom = e.pos.clone(); e.delay = 1e9; }
    // what did not fit (the inventory filled up meanwhile) stays on the ground
    if (left > 0 && D) {
      const p = e ? e.pos : g.player.pos;
      D.spawn(p.x, p.y, p.z, Object.assign(st, { count: left }), { pop: false, delay: 0 });
    }
  }

  // another player broke blocks by hand: the pieces, where they are within sight (64 blocks, as the game sends them)
  effects(m) {
    const g = this.game, Pa = this.ctx.renderer.particles, P = g.player;
    if (m.k === 'shot' && Array.isArray(m.e)) { this.ghostShots(m); return; }
    if (!Pa || dimCode(g.dim) !== m.d || !Array.isArray(m.e)) return;
    for (const o of m.e) {
      const b = o && B[o.b], p = o && o.p;
      if (b === undefined || !Array.isArray(p) || (p[0] + 0.5 - P.pos.x) ** 2 + (p[1] + 0.5 - P.pos.y) ** 2 + (p[2] + 0.5 - P.pos.z) ** 2 > 64 * 64) continue;
      const boxes = Array.isArray(o.x) && o.x.length ? Array.from({ length: o.x.length / 6 }, (_, i) => o.x.slice(i * 6, i * 6 + 6)) : null;
      Pa.blockBreak(p[0], p[1], p[2], b, boxes);
    }
  }
  // put a block in without it counting as yours, and without the simulation reacting to it
  put(w, x, y, z, b, m) {
    const sim = this.game.sim, s0 = sim ? sim.silent : false, e0 = w.onSetE;
    this.applying = true;
    if (sim) sim.silent = true;
    w.onSetE = null;
    try { w.set(x, y, z, b, m); }
    finally { this.applying = false; if (sim) sim.silent = s0; w.onSetE = e0; }
  }
  blocks(d, e) {
    const g = this.game, w = g.world, here = dimCode(g.dim) === d && w && !w.dead;
    const C = here ? g.containers : null;
    /* Another player's few blocks next to you (a bridge, a wall going up, a bed broken) are made again and drawn at
       once, as your own are: the columns round you to the edit worker straight away, rather than at the end of the
       frame in turn with everything else, and each block drawn on its own until its column's mesh is in
       (quickblocks.js). A big change (TNT, a /fill, a map put back) goes the usual way. */
    const quick = here && e.length <= 5 * 48 && w.near ? w.quick : null;
    let urgent = false;
    for (let i = 0; i < e.length; i += 5) {
      const x = e[i], y = e[i + 1], z = e[i + 2], b = B[e[i + 3]], m = e[i + 4] & 255;
      if (b === undefined || y < 0 || y >= H) continue;
      // a change of yours the server has not answered yet is newer than this one
      if (this.pending.has(d + ':' + key3(x, y, z))) continue;
      // (a container's record goes with its block from what is kept for this dimension too, or it came back the next
      // time the dimension was put together, in a chest put down there later: what was spilled, twice)
      if (!containerKind(b)) this.ct[d].delete(key3(x, y, z));
      if (here && w.loaded(x, z)) {
        const ob = w.get(x, y, z);
        const near = !!quick && w.near(Math.floor(x / 16), Math.floor(z / 16));
        if (near) { w.urgent = true; urgent = true; }
        try { this.put(w, x, y, z, b, m); } finally { if (near) w.urgent = false; }
        if (near) quick.put(x, y, z, w.get(x, y, z), w.meta(x, y, z));
        // a chest or furnace that went with its block, without spilling (whoever broke it has the items)
        if (C && ob !== b && containerKind(ob) && containerKind(b) !== containerKind(ob)) dropContainer(C, x, y, z);
      } else {
        const ck = Math.floor(x / 16) + ',' + Math.floor(z / 16);
        let mm = this.edits[d].get(ck);
        if (!mm) this.edits[d].set(ck, mm = new Map());
        mm.set(idx(x & 15, y, z & 15), b * 256 + m);
      }
    }
    if (urgent && w.flushUrgent) w.flushUrgent();
  }
  // the server turned changes down (past the border, a full world): back as they were
  // (q: a break that came second, someone else's or another page's simulation having taken the block first: no warning)
  rejected(d, e, q) {
    const g = this.game, w = g.world, here = dimCode(g.dim) === d;
    for (let i = 0; i < e.length; i += 3) {
      const x = e[i], y = e[i + 1], z = e[i + 2], k = d + ':' + key3(x, y, z), p = this.pending.get(k);
      if (!p) continue;
      this.pending.delete(k);
      if (here && w.loaded(x, z)) { this.put(w, x, y, z, p.prev >> 8, p.prev & 255); if (w.quick) w.quick.put(x, y, z, w.get(x, y, z), w.meta(x, y, z)); }
    }
    if (!q && !this.warnedRej) { this.warnedRej = true; this.ctx.chat.add('The server could not keep some of your changes.', 0xFF5555); }
  }
  /* (lost: the server turned a change of yours down, the chest being gone or changed by someone else at the same
     moment; what it keeps comes with it, and beats your own change, which is undone if you made it by hand) */
  container(d, p, o, lost) {
    if (!Array.isArray(p)) return;
    const [x, y, z] = p, k = key3(x, y, z);
    if (lost) {
      this.pending.delete('c' + d + ':' + k);
      const mine = this.ctMine.get(d + ':' + k);
      if (mine) { this.ctMine.delete(d + ':' + k); this.undoHand(mine.hd); }
      this.handOut.delete(d + ':' + k);
      // (and the experience that take would have brought: it stays in the furnace as the server keeps it)
      this.xpHeld.delete(d + ':' + k);
    }
    if (this.pending.has('c' + d + ':' + k)) return;
    const g = this.game, C = g.containers, here = dimCode(g.dim) === d && C && g.world && !g.world.dead;
    // a record for a block that is not that container here (a change sent just before the chest went on another
    // page): nothing to keep it in, so it is not kept (a chest put down there later would have it)
    if (o && here && g.world.loaded(x, z) && containerKind(g.world.get(x, y, z)) !== o.k) { this.ct[d].delete(k); dropContainer(C, x, y, z); return; }
    if (o) this.ct[d].set(k, o); else this.ct[d].delete(k);
    if (!here) return;
    this.applying = true;
    try {
      if (!o) dropContainer(C, x, y, z);
      else {
        let c = C.map.get(k);
        if (!c || c.kind !== o.k) { if (c) dropContainer(C, x, y, z); c = C.fresh(o.k, x, y, z); C.map.set(k, c); }
        const sl = (o.s || []).map(stackFromJSON);
        // (a furnace or brewing stand whose record holds what this page's already does: the owner's news of an item it
        // also cooked here, a moment late; its own progress is kept, or the arrow went back by however late it was)
        const sameSlots = 'burn' in c && c.slots.every((x, i) => (x ? x.id + ':' + x.count : '') === (sl[i] ? sl[i].id + ':' + sl[i].count : ''));
        const kept = sameSlots ? { burn: c.burn, burnMax: c.burnMax, cook: c.cook, cookMax: c.cookMax } : null;
        // in place: a chest someone has open shows the change at once
        for (let i = 0; i < c.slots.length; i++) c.slots[i] = sl[i] || null;
        if (this.handSnap.has(c)) this.handSnap.set(c, tallyStacks(c.slots));
        C.looted.add(k);
        if ('burn' in c) { Object.assign(c, kept || { burn: o.b | 0, burnMax: o.bm | 0, cook: o.c | 0, cookMax: o.cm || 200 }, { lastInput: c.slots[0] ? c.slots[0].id : 0 }); c.used = o.u && typeof o.u === 'object' ? Object.assign({}, o.u) : {}; C.lit.add(c); }
        if (o.k === 'brewing_stand') { Object.assign(c, { fuel: o.f | 0, brew: o.w | 0, ingredient: o.g | 0 }); C.lit.add(c); }
        if (o.k === 'hopper') c.cool = o.cd | 0;
        if (c.off && Array.isArray(o.off)) for (let i = 0; i < c.off.length; i++) c.off[i] = !!o.off[i];
      }
    } finally { this.applying = false; }
    if (this.ctx.gui.isOpen()) this.ctx.gui.markDirty();
  }
  // the furnace experience of takes the server has kept (up to batch s), as orbs at your feet
  payXp(s) {
    const g = this.game, P = g.player, D = g.drops;
    for (const [k, l] of this.xpHeld) {
      let n = 0;
      while (l.length && l[0].s <= s) n += l.shift().xp;
      if (!l.length) this.xpHeld.delete(k);
      if (n > 0 && D && P) D.xp(P.pos.x, P.pos.y + 0.5, P.pos.z, n);
    }
  }
  /* A change you made to a container by hand that the server could not keep (someone else changed it, or it was
     destroyed, at the same moment): what you took out goes back out of what you carry, what you put in comes back to
     you (dropped at your feet if there is no room), so nothing is had twice and nothing is lost. */
  undoHand(hd) {
    const inv = this.game && this.game.inv;
    if (!inv || !Array.isArray(hd)) return;
    let any = false;
    for (const e of hd.slice(0, 64)) {
      if (!Array.isArray(e) || typeof e[0] !== 'string' || !Number.isInteger(e[1]) || !e[1]) continue;
      let a;
      try { a = JSON.parse(e[0]); } catch (err) { continue; }
      if (!Array.isArray(a)) continue;
      a.splice(1, 0, Math.min(Math.abs(e[1]), 64 * 54));
      const st = stackFromJSON(a);
      if (!st) continue;
      any = true;
      // (more than one stack's worth goes back a stack at a time)
      if (e[1] > 0) takeBack(inv, st);
      else for (let left = st.count, max = maxStack(st.id); left > 0; left -= max) inv.placeBack(Object.assign({}, st, { count: Math.min(max, left) }));
    }
    if (any) { inv.changed(); if (this.ctx.gui.isOpen()) this.ctx.gui.markDirty(); }
  }
  undoDetail({ prev, sent }) {
    const held = r => (!r ? [] : r.k === 'cb' ? r.i || [] : r.i ? [r.i] : []).map(a => (a ? stackFromJSON(a) : null));
    const was = tallyStacks(held(prev)), now = tallyStacks(held(sent)), kind = (sent || prev || {}).k;
    const creative = this.game && this.game.mode === 'creative', hd = [];
    for (const key of new Set([...was.keys(), ...now.keys()])) {
      const n = (was.get(key) || 0) - (now.get(key) || 0);
      // (taken out: a book off a shelf or a lectern came to you; a frame's item or a disc dropped, and goes with its tie)
      if (n > 0 && (kind === 'cb' || kind === 'le')) hd.push([key, n]);
      // (put in: given back, unless nothing was used up)
      if (n < 0 && !creative) hd.push([key, n]);
    }
    if (hd.length) this.undoHand(hd);
  }
  // a click's own change to a container: its tally against the one at the end of the last tick (or as last sent)
  handMoved(c) {
    const d = dimCode(this.game.dim), k = d + ':' + key3(c.x, c.y, c.z), now = tallyStacks(c.slots);
    const was = this.handSnap.get(c) || tallyStacks(((this.ct[d].get(key3(c.x, c.y, c.z)) || {}).s || []).map(stackFromJSON));
    let acc = this.handOut.get(k);
    if (!acc) this.handOut.set(k, acc = new Map());
    for (const key of new Set([...was.keys(), ...now.keys()])) {
      const n = (was.get(key) || 0) - (now.get(key) || 0);
      if (n) acc.set(key, (acc.get(key) || 0) + n);
    }
    this.handSnap.set(c, now);
  }
  /* (lost: a change of yours turned down, the server's record coming back in its place; what your hands moved with
     it is undone: an item put in comes back to you, a book taken goes back, an item knocked out goes with its tie) */
  detail(d, p, o, lost) {
    if (!Array.isArray(p)) return;
    const [x, y, z] = p, k = key3(x, y, z);
    if (lost) {
      this.pending.delete('t' + d + ':' + k);
      const mine = this.dtMine.get(d + ':' + k);
      if (mine) { this.dtMine.delete(d + ':' + k); this.undoDetail(mine); }
    }
    if (this.pending.has('t' + d + ':' + k)) return;
    if (o) this.dt[d].set(k, o); else this.dt[d].delete(k);
    const g = this.game, D = g.details;
    if (dimCode(g.dim) !== d || !D) return;
    this.applying = true;
    try {
      const old = D.map.get(k);
      if (!o) { if (old) { D.map.delete(k); D._unshow(old); } return; }
      if (D.loadExtra && D.loadExtra(o)) return;
      const kind = { s: 'sign', f: 'frame', j: 'jukebox', c: 'campfire', p: 'decorated_pot', cb: 'shelf', le: 'lectern' }[o.k];
      if (!kind) return;
      const e = D.entry(x, y, z, kind);
      if (o.k === 'p') e.item = o.i ? stackFromJSON(o.i) : null;
      else if (o.k === 'cb') { e.items = [0, 1, 2, 3, 4, 5].map(i => (o.i && o.i[i] ? stackFromJSON(o.i[i]) : null)); e.last = o.l === undefined ? -1 : o.l | 0; }
      else if (o.k === 'le') { e.book = o.i ? stackFromJSON(o.i) : null; e.page = o.g | 0; }
      else if (o.k === 'j') {
        if (!o.i) { D.map.delete(k); D._unshow(e); return; }
        e.disc = stackFromJSON(o.i); e.t = o.t | 0;
      } else if (o.k === 's') {
        const side = v => ({ lines: (v && Array.isArray(v.lines) ? v.lines : []).concat(['', '', '', '']).slice(0, 4).map(String), colour: (v && v.colour) || 'black', glow: !!(v && v.glow) });
        e.front = side(o.f); e.back = side(o.b); e.waxed = !!o.w;
      } else if (o.k === 'f') {
        e.item = o.i ? stackFromJSON(o.i) : null; e.rot = (o.r | 0) & 7; if (o.gl) e.glow = true;
      } else {
        e.items = (o.i || []).concat([null, null, null, null]).slice(0, 4).map(a => (a ? stackFromJSON(a) : null));
        e.t = flat((o.t || [0, 0, 0, 0]).slice(0, 4)); e.total = flat((o.n || [600, 600, 600, 600]).slice(0, 4));
      }
      D._show(e);
    } finally { this.applying = false; }
  }
}
// a player's height by their pose: 1.8, 1.5 sneaking, 0.6 swimming or crawling
const heightOf = (s, id) => (s && s.f & F.SNEAK ? 1.5 : s && s.f & F.SWIM ? 0.6 : 1.8) * playerSize.of(id);
// the commands an operator's /command <you> runs on your machine (ranAs)
const AS_OK = new Set(['gamemode', 'give', 'clear', 'kill', 'xp', 'experience', 'effect', 'enchant', 'spawnpoint', 'tp', 'teleport']);
// where a ray first enters a box, or Infinity
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, a, b] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < a || o > b) return Infinity; continue; }
    let ta = (a - o) / d, tb = (b - o) / d;
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return Infinity;
  }
  return t0;
}
/* What you shoot or throw meets the other players too: while one of your own
   projectiles moves, the entity manager's forNear also visits the other
   players (as their stand-ins, Net.proxyOf). A copy of someone else's
   (Net.ghostShots) changes nothing in the world where it lands. */
const projTick = Projectile.prototype.tick;
Projectile.prototype.tick = function () {
  const net = activeNet, m = this.m;
  if (this.ghost) {
    const opb = m.onProjectileBlock;
    m.onProjectileBlock = null;
    try { return projTick.call(this); } finally { m.onProjectileBlock = opb; }
  }
  if (this.stuck || this.owner !== m.player) return projTick.call(this);
  return withPlayers(m, () => projTick.call(this));
};
/* fn run with the entity manager's forNear also visiting the other players
   (their stand-ins) on a server with PvP: your projectiles' flight, and your
   own fight's reach outside a click (Combat spinTick: Riptide's spin;
   chargeTick: a spear's charge; smashed: a mace's shockwave) */
function withPlayers(m, fn) {
  const net = activeNet;
  if (!net || !net.players || !net.server.pvp || !net.game || !m || m.withPlayers) return fn();
  const own = Object.prototype.hasOwnProperty.call(m, 'forNear'), f0 = m.forNear, D = dimCode(net.game.dim);
  m.forNear = function (x, z, r, cb) {
    f0.call(this, x, z, r, cb);
    for (const q of net.players.list.values()) if (net.hittable(q, D) && Math.abs(q.feet.x - x) <= r + 1 && Math.abs(q.feet.z - z) <= r + 1) cb(net.proxyOf(q));
  };
  m.withPlayers = true;
  try { return fn(); } finally { m.withPlayers = false; if (own) m.forNear = f0; else delete m.forNear; }
}
for (const k of ['spinTick', 'chargeTick', 'smashed']) {
  const f = Combat.prototype[k];
  Combat.prototype[k] = function () { const a = arguments; return withPlayers(this.m, () => f.apply(this, a)); };
}
// a container gone with its block on someone else's machine: forgotten here, nothing spilled
/* A short check of a container's record, FNV-1a over its JSON (the same as mlhub lc2.js recHash): what a change was
   made from goes with it */
function recHash(o) {
  const s = JSON.stringify(o);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
// how many of each item (by everything but its count) a list of stacks holds
function tallyStacks(list) {
  const m = new Map();
  for (const s of list || []) {
    if (!s) continue;
    const a = stackToJSON(s), key = JSON.stringify([a[0]].concat(a.slice(2)));
    m.set(key, (m.get(key) || 0) + a[1]);
  }
  return m;
}
// up to st.count of that item out of what you carry: the stack on the mouse first, then the inventory, the off hand
function takeBack(inv, st) {
  let left = st.count;
  const from = (get, set) => { const s = get(); if (!left || !s || !sameItem(s, st)) return; const n = Math.min(left, s.count); s.count -= n; left -= n; if (s.count <= 0) set(null); };
  from(() => inv.carried, v => { inv.carried = v; });
  for (let i = inv.slots.length - 1; i >= 0 && left; i--) from(() => inv.slots[i], v => { inv.slots[i] = v; });
  from(() => inv.offhand, v => { inv.offhand = v; });
}
function dropContainer(C, x, y, z) {
  const k = key3(x, y, z), c = C.map.get(k);
  if (!c) return;
  C.map.delete(k); C.lit.delete(c); C.hoppers.delete(c);
  C.looted.add(k);
}
