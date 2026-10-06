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

   Not shared yet: the mobs and the orbs of experience. Each player has their
   own, and what a mob does to the world (a creeper's hole, a farmer's crops,
   what it drops) is shared like anything else.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=19';
import { idx, H } from '../world-const.js?v=19';
import { DIMS, DIM_IDS } from '../dims.js?v=19';
import { Save } from '../save.js?v=19';
import { itemName, stackToJSON, stackFromJSON } from '../items.js?v=19';
import { glints } from '../render/armor.js?v=19';
import { containerKind } from '../containers.js?v=19';
import { getSkinSettings } from '../render/avatar.js?v=19';
import { RemotePlayers, PlayerList, F, USE_KINDS } from './players.js?v=19';
import { register, commandDef } from '../commands.js?v=19';

/* ---- who you are, and where the server is ---- */
export function deviceId() {
  try {
    let d = localStorage.getItem('lc2_device');
    if (!d) { d = 'd' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('lc2_device', d); }
    return d;
  } catch (e) { return 'd' + Math.random().toString(36).slice(2, 12); }
}
export function playerName() {
  let n = '';
  try { n = localStorage.getItem('lc2_name') || ''; } catch (e) {}
  if (!n) { n = 'Player' + (100 + Math.floor(Math.random() * 900)); setPlayerName(n); }
  return n;
}
export function setPlayerName(n) { try { localStorage.setItem('lc2_name', n); } catch (e) {} }
export const cleanName = s => String(s || '').replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 16);
// ?mp=ws://host:port/mc/ws points the game at another server (a local one while testing)
export function wsBase() {
  const q = new URLSearchParams(location.search).get('mp');
  if (q) return q;
  const h = location.hostname || 'localhost';
  if (h.endsWith('leonzhao.dev')) return 'wss://apps.leonzhao.dev/mc/ws';
  return 'ws://' + h + ':8600/mc/ws';
}
export const httpBase = () => wsBase().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/ws$/, '');
async function post(path, body) {
  const r = await fetch(httpBase() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ device: deviceId() }, body)) });
  return r.json();
}
// the server list, and how long the server took to answer it (the ping shown beside each)
export async function listServers() {
  const t0 = performance.now();
  const r = await fetch(httpBase() + '/lc2/servers?device=' + encodeURIComponent(deviceId()), { cache: 'no-store' });
  const j = await r.json();
  return { servers: j.servers || [], ping: Math.round(performance.now() - t0) };
}
export const createServer = o => post('/lc2/create', o);
export const editServer = o => post('/lc2/edit', o);
export const deleteServer = id => post('/lc2/delete', { id });

const dimCode = name => (DIMS[name] || DIMS.overworld).code;
const key3 = (x, y, z) => x + ',' + y + ',' + z;
const flat = a => a.slice();

/* What a world keeps in place of save.js, per dimension: the edits and the
   chests and signs come from the server (and stay up to date with it), the
   rest (where you were, your inventory, maps) is kept in this browser. */
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
  readState() { return this.local.readState(); }
  writeState(s) { this.local.writeState(s); }
}

// /list: who is on, as the game answers it (no commands needed)
register('list', {
  usage: '',
  always: true,
  run(args, ctx) {
    const net = ctx.game && ctx.game.net;
    const names = net ? [net.name].concat(net.players ? [...net.players.list.values()].map(r => r.name) : []) : [ctx.playerName || 'Player'];
    ctx.say(`There are ${names.length} of a max of ${net ? 20 : 1} players online: ${names.join(', ')}`);
  },
});

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
// /tp <player>, /tp <player> <player>: to where another player is
if (tpDef) {
  register('tp', Object.assign({}, tpDef, {
    run(args, ctx) {
      const net = ctx.game && ctx.game.net;
      const isName = a => a && !/^[~^@0-9.+-]/.test(a);
      const last = args[args.length - 1];
      if (net && (args.length === 1 || args.length === 2) && isName(last) && last.toLowerCase() !== ctx.playerName.toLowerCase()) {
        if (args.length === 2 && !(args[0] === '@s' || args[0].toLowerCase() === ctx.playerName.toLowerCase())) { ctx.say('Only you can be moved here', 0xFF5555); return; }
        const r = net.players && [...net.players.list.values()].find(q => q.name.toLowerCase() === last.toLowerCase());
        const s = r && r.st;
        if (!s) { ctx.say('No player was found', 0xFF5555); return; }
        if (s.d !== dimCode(ctx.game.dim)) { ctx.say(`${r.name} is in another dimension`, 0xFF5555); return; }
        ctx.teleport(s.x, s.y, s.z);
        ctx.game.player.yaw = s.yaw; ctx.game.player.pitch = s.pitch;
        ctx.say(`Teleported ${ctx.playerName} to ${r.name}`);
        return;
      }
      return tpDef.run(args, ctx);
    },
  }));
}

/* a container's record, as containers.js saves one */
function packContainer(c) {
  const o = { k: c.kind, p: [c.x, c.y, c.z], s: c.slots.map(stackToJSON) };
  if ('burn' in c) Object.assign(o, { b: c.burn, bm: c.burnMax, c: c.cook, cm: c.cookMax, u: c.used });
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
  return undefined;
}

export class Net {
  /* Connect, and wait for the world: resolves with the Net once the server
     has sent it, or rejects with { reason, password } (a wrong password asks again). */
  static connect(server, password, name) {
    return new Promise((resolve, reject) => {
      const url = wsBase() + '?mode=lc2&server=' + encodeURIComponent(server) + '&pw=' + encodeURIComponent(password || '') +
        '&name=' + encodeURIComponent(name) + '&device=' + encodeURIComponent(deviceId());
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject({ reason: 'Could not reach the server.' }); return; }
      const net = new Net(ws);
      let done = false;
      const end = (ok, v) => { if (done) return; done = true; clearTimeout(timer); ok ? resolve(v) : reject(v); };
      const timer = setTimeout(() => { try { ws.close(); } catch (e) {} end(false, { reason: 'Timed out' }); }, 20000);
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!done) {
          if (m.t === 'init') { net.onInit(m); end(true, net); }
          else if (m.t === 'refused') end(false, { reason: m.reason, password: !!m.password });
          return;
        }
        net.receive(m);
      };
      ws.onclose = () => { if (!done) end(false, { reason: 'Connection refused' }); else net.lost(net.kickReason || 'Connection lost'); };
      ws.onerror = () => {};
    });
  }

  constructor(ws) {
    this.ws = ws;
    this.inbox = [];                 // what changes the world, worked through on the next tick
    this.seq = 0;                    // the last batch of changes sent
    this.pending = new Map();        // "d:x,y,z" (or "c"/"t" + d:x,y,z for chests and signs) -> { s, prev }
    this.outB = [[], [], []];        // blocks to send, per dimension
    this.outC = new Map();           // "d:x,y,z" -> [d, container or null]
    this.outT = new Map();           // "d:x,y,z" -> [d, detail entry or null]
    this.outFx = [];                 // blocks you broke by hand, for their pieces on the others' screens
    this.items = [new Map(), new Map(), new Map()];   // the items lying about, per dimension: number -> record
    this.itemKey = 0; this.byKey = new Map(); this.outIt = [];
    this.applying = false;           // putting in someone else's change: not to be sent back
    this.rtt = 0; this.pings = []; this.itemTick = 0;
    this.game = null;
    this.dead = false;
    this.sent = { at: -1e9, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, f: -1, d: -1 };
    this.eqSig = ''; this.eqTick = 0;
    this.timeExpect = null;
    this.stats = { sentB: 0, gotB: 0, sentP: 0, gotP: 0 };
  }

  /* ---- the world the server sent ---- */
  onInit(m) {
    this.id = m.id; this.name = m.name; this.server = m.server;
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
    for (const o of m.items || []) this.keepItem(o);
    this.serverNow = m.now;
    this.ping();
    this.pingTimer = setInterval(() => this.ping(), 2000);
  }
  // the world as the game's list of worlds holds one (main.js startGame)
  entry() {
    const s = this.server;
    return { id: 'mp-' + s.id, name: s.name, seed: s.seed, generator: s.generator || 'vanilla', mode: s.mode, difficulty: s.difficulty,
      cheats: !!s.cheats, spawn: this.spawn || undefined, mp: this, created: 0, lastPlayed: Date.now() };
  }
  // save.js's stand-in for each dimension (main.js asks by the save's id)
  save(id) {
    const d = id.endsWith(DIMS.the_nether.suffix) ? 1 : id.endsWith(DIMS.the_end.suffix) ? 2 : 0;
    return new MpSave(this, d, id + '~' + this.name.toLowerCase());
  }

  /* ---- the game has started (main.js), with what this needs of it ---- */
  attach(game, ctx) {
    this.game = game; this.ctx = ctx;
    this.players = new RemotePlayers(ctx.renderer, ctx.gui.font);
    for (const p of this.initPlayers) this.players.add(p);
    this.initPlayers = null;
    // you: your name in death messages, which go to everyone
    const hooks = game.survival.hooks;
    if (hooks) {
      hooks.name = () => this.name;
      hooks.onDeath = message => { if (this.ctx.rule('showDeathMessages')) this.send({ t: 'death', text: message }); };
    }
    // your arm swinging, for everyone else's picture of you
    const av = ctx.renderer.avatar, swing = av.startSwing.bind(av);
    av.startSwing = () => { swing(); if (this.game) this.send({ t: 'sw', h: 0 }); };
    this.unswing = () => { av.startSwing = swing; };
    // Tab held: who is on (players.js PlayerList)
    this.list = new PlayerList(this);
    ctx.gui.overlays.push(this.list);
    this.onKey = e => {
      if (e.code !== 'Tab') return;
      const down = e.type === 'keydown' && !ctx.gui.isOpen();
      if (down !== this.list.shown) { this.list.shown = down; ctx.gui.markDirty(); }
      if (e.type === 'keydown' && !ctx.gui.isOpen()) e.preventDefault();
    };
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('keyup', this.onKey);
    this.sendSkin();
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
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    try { this.ws.close(); } catch (e) {}
    this.detach();
  }
  detach() {
    if (this.players) { this.players.dispose(); this.players = null; }
    if (this.list) { const o = this.ctx.gui.overlays, i = o.indexOf(this.list); if (i >= 0) o.splice(i, 1); this.list = null; }
    if (this.onKey) { document.removeEventListener('keydown', this.onKey); document.removeEventListener('keyup', this.onKey); this.onKey = null; }
    if (this.unswing) { this.unswing(); this.unswing = null; }
    this.game = null;
  }
  // the connection went (the server stopped, the network, kicked): back to the title with the reason
  lost(reason) {
    if (this.closed) return;
    this.dead = true; this.lostReason = reason;
    if (!this.game) return;
    const ctx = this.ctx;
    this.close();
    ctx.disconnected(reason);
  }

  /* ---- what arrives ---- */
  receive(m) {
    switch (m.t) {
      // the other players: straight away, with when each position got here
      case 'p': this.stats.gotP++; if (this.players) this.players.state(m.id, m, performance.now()); else this.early(m); return;
      case 'join': if (this.players) { this.players.add(m.p); } else this.initPlayers.push(m.p); return;
      case 'leave': if (this.players) this.players.remove(m.id); else this.initPlayers = this.initPlayers.filter(p => p.id !== m.id); return;
      case 'skin': if (this.players) this.players.setSkin(m.id, m.skin, m.slim); else this.early(m); return;
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
      case 'fx': if (this.game && this.game.ready) this.effects(m); return;
      // blocks, chests and signs go in the moment they arrive, not at the next tick: they show a frame sooner
      case 'b': case 'ct': case 'dt': if (this.game && this.game.ready && !this.inbox.length) { this.handle(m); return; } this.inbox.push(m); return;
      default: this.inbox.push(m);
    }
  }
  // a player's news before the game is ready to draw them: kept on their record for when it is
  early(m) {
    const p = this.initPlayers && this.initPlayers.find(q => q.id === m.id);
    if (!p) return;
    if (m.t === 'p') p.st = m; else if (m.t === 'skin') { p.skin = m.skin; p.slim = m.slim; } else if (m.t === 'eq') p.eq = m.eq;
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
    this.sendState(stamp);
    if (++this.eqTick % 5 === 0 || this.eqTick === 1 || g.inv.heldId() !== this.lastHeld) this.sendEquip();
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
      this.players.frame(now, dt, g.world, dimCode(g.dim), eye, Math.max(48, (R.opts.renderDist || 8) * 16));
    }
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
      const changed = C.changed, remove = C.remove;
      C.changed = function (c) { changed.call(this, c); if (!net.applying && c) net.queueC(c.x, c.y, c.z, c); };
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
    const E = g.entities;
    if (E && E !== this.he) {
      this.he = E;
      // the crosshair finds the other players too, in front of any mob or block (for hitting them)
      const pickFor = E.pickFor;
      E.pickFor = function (eye, blockT) { return net.pickPlayer(this, eye, blockT, pickFor.call(this, eye, blockT)); };
    }
    const S = g.sim;
    if (S && S !== this.hs) {
      this.hs = S;
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
      S.othersAwake = t => {
        if (!this.players) return false;
        let n = 1, asleep = 1;
        for (const r of this.players.list.values()) { const s = r.st; if (!s || s.d !== 0 || (s.f & F.DEAD)) continue; n++; if (s.f & F.SLEEP) asleep++; }
        if (asleep >= n) return false;
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
    if (!this.players || !this.server.pvp || this.closed) return found;
    const g = this.game, P = g.player, D = dimCode(g.dim);
    const dx = -Math.sin(P.yaw) * Math.cos(P.pitch), dy = Math.sin(P.pitch), dz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    let lim = Math.min(E.combat.reach(), blockT === undefined ? Infinity : blockT);
    if (found) { const h = E.raycast(eye, { x: dx, y: dy, z: dz }, lim); if (h) lim = h.t; }
    let best = null;
    for (const r of this.players.list.values()) {
      const s = r.st, f = r.feet;
      if (!s || !f || s.d !== D || (s.f & F.DEAD) || !r.av || !r.av.mesh.visible) continue;
      const h = s.f & F.SNEAK ? 1.5 : s.f & F.SWIM ? 0.6 : 1.8;
      const t = rayBox(eye.x, eye.y, eye.z, dx, dy, dz, f.x - 0.3, f.y, f.z - 0.3, f.x + 0.3, f.y + h, f.z + 0.3);
      if (t < lim) { lim = t; best = r; }
    }
    if (!best) return found;
    const r = best;
    // (no customName: their name is drawn over them already, players.js, not a second time as a named mob's)
    if (!r.proxy) r.proxy = { remotePlayer: true, id: r.id, get pos() { return r.feet; }, hw: 0.3, w: 0.6, h: 1.8, removed: false, dead: false, hurt: amount => this.hitPlayer(r, amount) };
    r.proxy.name = r.name;
    return r.proxy;
  }
  hitPlayer(r, amount) {
    const g = this.game, P = g.player, E = g.entities;
    if (!(amount > 0)) return false;
    const inv = g.inv, st = inv.slots[inv.selected], ench = (st && st.ench) || {};
    const c = E ? E.combat.cooldown() : 1, strong = c > 0.9;
    const sprint = P.sprinting && strong;
    const crit = strong && P.fallDistance > 0 && !P.onGround && !P.climbing && !P.inWater && !P.flying && !sprint;
    if (crit) amount *= 1.5;
    const kb = (ench.knockback | 0) + (sprint ? 1 : 0);
    if (kb > 0) { P.vel.x *= 0.6; P.vel.z *= 0.6; P.sprinting = false; }
    this.send({ t: 'hit', id: r.id, dmg: Math.round(amount * 100) / 100, kb, crit, fire: (ench.fire_aspect | 0) * 4 });
    if (crit && E && E.particles) E.particles('crit', r.feet.x, r.feet.y + 0.9, r.feet.z, 12, 0.3);
    return true;
  }
  // a hit from another player: taken here as the game takes one, armour and all, knocked back away from them
  struck(m) {
    const g = this.game, E = g.entities;
    if (!E || !E.combat) return;
    const r = this.players && this.players.list.get(m.from), s = r && r.st, P = g.player;
    E.combat.hurtPlayer(m.dmg, { type: 'player', attacker: { customName: m.name, pos: r && r.feet }, x: s ? s.x : P.pos.x, z: s ? s.z : P.pos.z, knock: m.kb, yaw: s ? s.yaw : 0 });
    if (m.fire && E.setPlayerFire) E.setPlayerFire(m.fire);
  }

  /* ---- your changes, sent at the end of the frame ---- */
  local(w, x, y, z, b, m, prev) {
    const d = dimCode(w.dim), k = d + ':' + key3(x, y, z);
    const p = this.pending.get(k);
    this.pending.set(k, { s: this.seq + 1, prev: p ? p.prev : prev });
    const name = BLOCKS[b] ? BLOCKS[b].name : 'air';
    this.outB[d].push(x, y, z, name, m & 255);
  }
  queueC(x, y, z, c) {
    const d = dimCode(this.game.dim), k = d + ':' + key3(x, y, z);
    this.outC.set(k, [d, x, y, z, c]);
    this.pending.set('c' + k, { s: this.seq + 1 });
  }
  queueT(x, y, z, e) {
    const d = dimCode(this.game.dim), k = d + ':' + key3(x, y, z);
    this.outT.set(k, [d, x, y, z, e]);
    this.pending.set('t' + k, { s: this.seq + 1 });
  }
  flush() {
    if (this.outFx.length) { this.send({ t: 'fx', d: dimCode(this.game.dim), k: 'break', e: this.outFx }); this.outFx = []; }
    if (this.outIt.length) { this.send({ t: 'it+', e: this.outIt }); this.outIt = []; }
    if (!this.outC.size && !this.outT.size && !this.outB[0].length && !this.outB[1].length && !this.outB[2].length) return;
    const s = ++this.seq, msgs = [];
    for (let d = 0; d < 3; d++) {
      const e = this.outB[d];
      if (!e.length) continue;
      this.stats.sentB += e.length / 5;
      // a long run goes in parts the server takes in one go
      for (let i = 0; i < e.length; i += 5 * 8192) msgs.push({ t: 'b', d, e: e.slice(i, i + 5 * 8192) });
      this.outB[d] = [];
    }
    for (const [, [d, x, y, z, c]] of this.outC) {
      const o = c ? packContainer(c) : null, k = key3(x, y, z);
      if (o) this.ct[d].set(k, o); else this.ct[d].delete(k);
      msgs.push({ t: 'ct', d, p: [x, y, z], o });
    }
    this.outC.clear();
    for (const [, [d, x, y, z, e]] of this.outT) {
      const o = e ? packDetail(e) : null, k = key3(x, y, z);
      if (o === undefined) continue;
      if (o) this.dt[d].set(k, o); else this.dt[d].delete(k);
      msgs.push({ t: 'dt', d, p: [x, y, z], o });
    }
    this.outT.clear();
    // the last one carries the number: the server answers it once it has taken them all
    msgs[msgs.length - 1].s = s;
    for (const m of msgs) this.send(m);
  }

  /* ---- where you are, on each tick that something changed (and once a second regardless) ---- */
  sendState(stamp) {
    const g = this.game, P = g.player, S = this.sent;
    const sv = g.survival, dead = !!(sv && sv.dead);
    const f = (P.sneaking ? F.SNEAK : 0) | (P.sprinting ? F.SPRINT : 0) | (P.flying ? F.FLY : 0) | (P.pose === 'swim' ? F.SWIM : 0) |
      (P.onGround ? F.GROUND : 0) | (g.sim && g.sim.sleeping ? F.SLEEP : 0) | (dead ? F.DEAD : 0) | (P.gliding ? F.GLIDE : 0) | (P.riding ? F.RIDE : 0);
    const d = dimCode(g.dim);
    const r4 = v => Math.round(v * 10000) / 10000;
    const x = r4(P.pos.x), y = r4(P.pos.y), z = r4(P.pos.z), yaw = r4(P.yaw), pitch = r4(P.pitch);
    // what the use button is doing with your hands (render/avatar.js useNow): a bow drawn, food, a shield up
    const U = this.ctx.renderer.avatar.useNow, k = U ? USE_KINDS.indexOf(U.kind) : -1;
    const u = k >= 0 ? (k + 1) | ((U.side | 0) ? 16 : 0) : 0, ut = u ? Math.round((U.t || 0) * 10) / 10 : 0, uT = u ? U.total | 0 : 0;
    if (x === S.x && y === S.y && z === S.z && yaw === S.yaw && pitch === S.pitch && f === S.f && d === S.d && u === S.u && ut === S.ut && stamp - S.at < 1000) return;
    Object.assign(S, { at: stamp, x, y, z, yaw, pitch, f, d, u, ut });
    this.stats.sentP++;
    const m = { t: 'p', ts: Math.round(stamp * 10) / 10, x, y, z, yaw, pitch, f, d };
    if (u) { m.u = u; m.ut = ut; m.uT = uT; }
    this.send(m);
  }
  sendEquip() {
    const inv = this.game.inv, h = inv.slots[inv.selected], o = inv.offhand;
    this.lastHeld = inv.heldId();
    const a = inv.armor ? inv.armor.map(s => (s ? stackToJSON(s) : null)) : null;
    const eq = { h: h ? itemName(h.id) : '', o: o ? itemName(o.id) : '', hg: glints(h), og: glints(o), a };
    const sig = JSON.stringify(eq);
    if (sig === this.eqSig) return;
    this.eqSig = sig;
    this.send(Object.assign({ t: 'eq' }, eq));
  }
  sendSkin() {
    const s = getSkinSettings();
    const skin = typeof s.skin === 'string' && s.skin.startsWith('data:image/png') ? s.skin : '';
    const sig = skin.length + ':' + skin.slice(-64) + s.slim;
    if (sig === this.skinSig) return;
    this.skinSig = sig;
    this.send({ t: 'skin', skin: skin.length <= 24000 ? skin : '', slim: !!s.slim });
  }

  /* ---- the server's news that changes the world, on a tick ---- */
  handle(m) {
    const g = this.game;
    switch (m.t) {
      case 'b': this.stats.gotB += m.e.length / 5; this.blocks(m.d, m.e); return;
      case 'ack': for (const [k, p] of this.pending) if (p.s <= m.s) this.pending.delete(k); return;
      case 'rej': this.rejected(m.d, m.e); return;
      case 'ct': this.container(m.d, m.p, m.o); return;
      case 'dt': this.detail(m.d, m.p, m.o); return;
      case 'chat':
        if (m.system) this.ctx.chat.add(m.text, m.colour !== undefined ? m.colour : 0xFFFF55);
        else this.ctx.chat.add('<' + m.name + '> ' + m.text);
        return;
      case 'time': {
        // the server's clock, moved on by half the time the message took
        const t = m.time + Math.round(this.rtt / 100);
        this.time = t; this.timeAt = performance.now();
        if (Math.abs(g.time - t) > 1) g.time = t;
        return;
      }
      case 'wx': this.wx = { r: !!m.r, th: !!m.th }; this.applyWeather(); return;
      case 'spawn': this.spawn = m.spawn; if (m.spawn) g.spawn = { x: m.spawn.x, z: m.spawn.z }; return;
      case 'hit': this.struck(m); return;
      case 'it+': for (const o of m.e || []) { const rec = this.keepItem(o); if (rec && rec.d === dimCode(g.dim)) this.showItem(rec); } return;
      case 'it=': this.numbered(m.e || []); return;
      case 'it-': case 'itno': this.itemGone(m.id); return;
      case 'itok': this.granted(m.id, m.s); return;
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
     it tells the server. Items of the same kind lying together are not
     joined into one on a server: each machine would join them differently. */
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
      if (!had || net.applying || net.closed || e.taken) return;
      // (burnt, lain its time, fallen out of the world, taken by a hopper: said by the player nearest it)
      if (e.nid && net.ownsAt(e.pos.x, e.pos.z)) { net.send({ t: 'it-', id: e.nid }); net.items[dimCode(net.game.dim)].delete(e.nid); }
    };
    D._merge = function () {};
    D.toJSON = function () { const o = toJSON.call(this); o.items = []; return o; };
    D.tick = function (player, collector) {
      // a shared item is never picked up here directly: its own count-down is kept, and the server asked (pickups)
      for (const e of this.items) if ((e.nid || e.nk) && e.fly <= 0) { if (e.wait === undefined) e.wait = e.delay; e.delay = 2; }
      tick.call(this, player, collector);
      if (!net.closed) net.pickups(this, player, collector);
    };
    for (const rec of this.items[dimCode(this.game.dim)].values()) { rec.e = null; this.showItem(rec); }
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
    this.applying = true;
    let e;
    try { e = D.spawn(rec.p[0], rec.p[1], rec.p[2], st, { vel: fresh ? rec.v : [0, 0, 0], delay: Math.max(0, rec.dl - ago), age: rec.ag + ago, pop: false }); }
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
    this.outIt.push({ k, d, p: [r3(e.pos.x), r3(e.pos.y), r3(e.pos.z)], v: [r3(e.vel.x), r3(e.vel.y), r3(e.vel.z)], s: stackToJSON(e.stack), dl: e.delay | 0, ag: e.age | 0 });
  }
  // the server's numbers for the items this machine made ([key, number, ...]; 0: not kept, so it stays this machine's own)
  numbered(a) {
    for (let i = 0; i + 1 < a.length; i += 2) {
      const got = this.byKey.get(a[i]);
      if (!got) continue;
      this.byKey.delete(a[i]);
      const [e, d] = got, id = a[i + 1] | 0;
      e.nk = 0;
      if (!id) { e.delay = e.wait || 0; e.wait = undefined; continue; }
      e.nid = id;
      const rec = { id, d, s: stackToJSON(e.stack), p: [e.pos.x, e.pos.y, e.pos.z], v: [0, 0, 0], dl: 0, ag: e.age, at: performance.now(), e };
      this.items[d].set(id, rec);
      // gone already (burnt at once, taken by a hopper): gone for everyone
      if (e.gone) { this.items[d].delete(id); this.send({ t: 'it-', id }); }
    }
  }
  itemGone(id) {
    for (const M of this.items) {
      const rec = M.get(id);
      if (!rec) continue;
      M.delete(id);
      const e = rec.e, D = this.game && this.game.drops;
      if (e && !e.gone && D && !e.taken) { this.applying = true; try { D._remove(e, -1); } finally { this.applying = false; } }
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
    for (let i = 0; i < e.length; i += 5) {
      const x = e[i], y = e[i + 1], z = e[i + 2], b = B[e[i + 3]], m = e[i + 4] & 255;
      if (b === undefined || y < 0 || y >= H) continue;
      // a change of yours the server has not answered yet is newer than this one
      if (this.pending.has(d + ':' + key3(x, y, z))) continue;
      if (here && w.loaded(x, z)) {
        const ob = w.get(x, y, z);
        this.put(w, x, y, z, b, m);
        // a chest or furnace that went with its block, without spilling (whoever broke it has the items)
        if (C && ob !== b && containerKind(ob) && containerKind(b) !== containerKind(ob)) dropContainer(C, x, y, z);
      } else {
        const ck = Math.floor(x / 16) + ',' + Math.floor(z / 16);
        let mm = this.edits[d].get(ck);
        if (!mm) this.edits[d].set(ck, mm = new Map());
        mm.set(idx(x & 15, y, z & 15), b * 256 + m);
      }
    }
  }
  // the server turned changes down (past the border, a full world): back as they were
  rejected(d, e) {
    const g = this.game, w = g.world, here = dimCode(g.dim) === d;
    for (let i = 0; i < e.length; i += 3) {
      const x = e[i], y = e[i + 1], z = e[i + 2], k = d + ':' + key3(x, y, z), p = this.pending.get(k);
      if (!p) continue;
      this.pending.delete(k);
      if (here && w.loaded(x, z)) this.put(w, x, y, z, p.prev >> 8, p.prev & 255);
    }
    if (!this.warnedRej) { this.warnedRej = true; this.ctx.chat.add('The server could not keep some of your changes.', 0xFF5555); }
  }
  container(d, p, o) {
    if (!Array.isArray(p)) return;
    const [x, y, z] = p, k = key3(x, y, z);
    if (this.pending.has('c' + d + ':' + k)) return;
    if (o) this.ct[d].set(k, o); else this.ct[d].delete(k);
    const g = this.game, C = g.containers;
    if (dimCode(g.dim) !== d || !C) return;
    this.applying = true;
    try {
      if (!o) dropContainer(C, x, y, z);
      else {
        let c = C.map.get(k);
        if (!c || c.kind !== o.k) { if (c) dropContainer(C, x, y, z); c = C.fresh(o.k, x, y, z); C.map.set(k, c); }
        const sl = (o.s || []).map(stackFromJSON);
        // in place: a chest someone has open shows the change at once
        for (let i = 0; i < c.slots.length; i++) c.slots[i] = sl[i] || null;
        C.looted.add(k);
        if ('burn' in c) { Object.assign(c, { burn: o.b | 0, burnMax: o.bm | 0, cook: o.c | 0, cookMax: o.cm || 200, lastInput: c.slots[0] ? c.slots[0].id : 0 }); c.used = o.u && typeof o.u === 'object' ? o.u : {}; C.lit.add(c); }
        if (o.k === 'brewing_stand') { Object.assign(c, { fuel: o.f | 0, brew: o.w | 0, ingredient: o.g | 0 }); C.lit.add(c); }
        if (o.k === 'hopper') c.cool = o.cd | 0;
        if (c.off && Array.isArray(o.off)) for (let i = 0; i < c.off.length; i++) c.off[i] = !!o.off[i];
      }
    } finally { this.applying = false; }
    if (this.ctx.gui.isOpen()) this.ctx.gui.markDirty();
  }
  detail(d, p, o) {
    if (!Array.isArray(p)) return;
    const [x, y, z] = p, k = key3(x, y, z);
    if (this.pending.has('t' + d + ':' + k)) return;
    if (o) this.dt[d].set(k, o); else this.dt[d].delete(k);
    const g = this.game, D = g.details;
    if (dimCode(g.dim) !== d || !D) return;
    this.applying = true;
    try {
      const old = D.map.get(k);
      if (!o) { if (old) { D.map.delete(k); D._unshow(old); } return; }
      if (o.k !== 's' && o.k !== 'f' && o.k !== 'j' && o.k !== 'c') return;
      const kind = o.k === 's' ? 'sign' : o.k === 'f' ? 'frame' : o.k === 'j' ? 'jukebox' : 'campfire';
      const e = D.entry(x, y, z, kind);
      if (o.k === 'j') {
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
// a container gone with its block on someone else's machine: forgotten here, nothing spilled
function dropContainer(C, x, y, z) {
  const k = key3(x, y, z), c = C.map.get(k);
  if (!c) return;
  C.map.delete(k); C.lit.delete(c); C.hoppers.delete(c);
  C.looted.add(k);
}
