/* ---------------------------------------------------------------------------
   Leoncraft 2 multiplayer - the mobs, and the orbs of experience, everyone
   shares.

   On a server the mobs are the world's, as on the game's own servers: the
   cow you see is the cow the others see. No machine runs them all. The
   server (lc2.js mobPass) gives each one to the machine of the player
   nearest to it, which runs it with the game's own code as in
   singleplayer (it walks, eats, chases that player, breeds, despawns) and
   sends, every other tick it moves, where it is and which way it looks
   (with flags for a hit, a swing, dying, burning), and, when they change,
   its record (the save's own: colour, saddle, health, what it holds) and
   how its parts move (a creeper swelling, a skeleton drawing its bow). The
   other machines draw it from those: a puppet, its own mind and physics
   off, played back a little behind the newest position so it glides.

   Doing anything to a puppet (hitting it, feeding it, riding it, a lead, a
   name tag, a trade, an arrow or an explosion of yours reaching it) makes
   it yours to run at once, so it flashes red and is knocked back on your
   screen with no wait, and the server is told (mc), which hands it to you
   for a while and tells the machine that had it. Riding it or leading it
   keeps it yours. When it dies, its drops are items like any other (shared
   already) and its experience comes out as orbs everyone sees; the first
   player to reach an orb is the one the server gives it to.

   New mobs come about only where this machine runs things: natural
   spawning only in the chunks no other player is nearer to, and the
   animals that come with new ground (and a village's people and golems)
   only in chunks the server says nobody has had yet (pop). A mob that
   walks out of everyone's reach is put away on the server, as the game
   keeps the mobs of unloaded chunks, and comes back with its ground.
--------------------------------------------------------------------------- */
import { Living, wrap } from '../entities/entity.js?v=107';
import { TYPES } from '../entities/mobs.js?v=107';
import { F } from './players.js?v=107';

const THREE = window.THREE;
// besides the living (animals, monsters, villagers, golems, armour stands): paintings, the knots of leads, sand and gravel falling, fireworks,
// and the minecarts with a chest, a hopper, a furnace or TNT (a plain one is a seat: vehicles.js)
const EXTRA = new Set(['painting', 'leash_knot', 'falling_block', 'firework_rocket', 'chest_minecart', 'hopper_minecart', 'furnace_minecart', 'tnt_minecart']);
// (the dragon belongs to the End's fight, dim/realms.js: shared by endfight.js)
const NOT = new Set(['ender_dragon']);
export const shareable = e => !!e && !e.isPlayer && !NOT.has(e.type) && (e instanceof Living || EXTRA.has(e.type));
const shareableType = t => { const C = TYPES[t]; return !!C && !NOT.has(t) && (C.prototype instanceof Living || EXTRA.has(t)); };
// its record as a save keeps it (its own toJSON is taken away while it is shared: the server keeps it, not this browser)
const jsonOf = e => Object.getPrototypeOf(e).toJSON.call(e);
// what changes every tick and would send the record over and over: left out of the comparison
const VOLATILE = new Set(['p', 'v', 'y', 'f', 'age', 'l', 'air', 'by', 'hy']);  // (by, hy: the body's and head's turns, which the positions carry)
const sigOf = j => { let s = ''; for (const k in j) if (!VOLATILE.has(k)) s += k + ':' + JSON.stringify(j[k]) + ';'; return s; };
// the flags in a position
const F_GROUND = 1, F_HURT = 2, F_DEAD = 4, F_FIRE = 8, F_SWING = 16, F_RIDDEN = 32;
const DELAY = 220;            // ms behind the newest position a puppet is drawn (they come every third tick, with time to spare for a late one)
const SEEN = 160;             // blocks: a mob another player is within this of is sent every sixth tick
const CLOSE = 48;             // and within this, every third
const KEY = 20;               // every twentieth position of a mob is the whole of it, not a change
const q100 = v => Math.round(v * 100);
// an angle in 256ths of a turn, as the game sends them, and back
const TURN = 2 * Math.PI;
const q256 = a => ((Math.round(a / TURN * 256) % 256) + 256) % 256;
const wrap256 = v => ((v + 128) & 255) - 128;
// how its parts move (the per-kind animation a mob's anim() sets up for drawing), without what the drawing works out itself
const MOTION = { walk: 1, amt: 1, age: 1, yaw: 1, pitch: 1, attack: 1, riding: 1 };
function animOf(e) {
  if (typeof e.anim !== 'function') return null;
  const A = { walk: e.walk || 0, amt: e.walkAmt || 0, age: e.age || 0, yaw: 0, pitch: 0, attack: 0, aggressive: false, aiming: false, eating: 0, flap: 0, swell: 0,
    riding: !!e.vehicle, shake: false, angry: false, carry: 0, sitting: !!e.sitting };
  try { e.anim(A, 1); } catch (err) { return null; }
  let out = null;
  for (const k in A) {
    if (MOTION[k] || !/^[A-Za-z]{1,16}$/.test(k)) continue;
    const v = A[k];
    if (v === true) (out || (out = {}))[k] = true;
    else if (typeof v === 'number' && Number.isFinite(v) && Math.round(v * 10) !== 0) (out || (out = {}))[k] = Math.round(v * 10) / 10;
  }
  return out;
}

export class Mobs {
  constructor(net) {
    this.net = net;
    this.recs = new Map();       // number -> { id, d, j, o: the player whose machine runs it, x, y, z, a: its parts, e, buf }
    this.byKey = new Map();      // made here, until the server numbers it
    this.key = 0;
    this.out = [];               // made this tick, to be sent at its end
    this.gone = []; this.kept = [];
    this.clocks = new Map();     // another machine's clock against ours: { win, prev, at, est }
    this.popAsk = []; this.popWait = new Map();
    this.riders = new Map();     // another player's number -> the mob they ride (one their machine runs)
    this.applying = false; this.unloading = false;
    this.t = 0;
    this.on = false;             // a server that shares mobs (an older one leaves them on each machine)
  }
  init(m) { this.on = !!m.mobs; }

  /* ---- the entity manager of the dimension you are in ---- */
  hook(E) {
    const M = this, net = this.net;
    this.E = E;
    for (const rec of this.recs.values()) rec.e = null;
    // what this browser kept from before (its own animals, in its entity store) is not the server's: gone
    this.applying = true;
    try {
      for (const e of E.list.slice()) if (shareable(e) && !e.nm) { if (E.riding === e) E.dismount(); e.remove(); }
      for (const [k, a] of E.stored) E.stored.set(k, a.filter(o => !shareableType(o.t)));
      // (which chunks have had their animals is the server's to say)
      E.populated.clear();
      this.popWait.clear(); this.popAsk.length = 0;
    } finally { this.applying = false; }
    const spawn = E.spawn;
    E.spawn = function (type, x, y, z, o) {
      // a spawner block's mobs, a patrol, a wandering trader: made only by the machine whose player is nearest, as one server would make them once
      if (o && (o.spawner || o.patrol || o.wandering) && !M.applying && !net.applying && !net.ownsAt(x, z)) return null;
      const e = spawn.call(this, type, x, y, z, o);
      if (e && !M.applying && !net.applying && !net.closed && shareable(e)) M.made(e);
      return e;
    };
    const chunks = E.chunks;
    E.chunks = function () { M.unloading = true; try { return chunks.apply(this, arguments); } finally { M.unloading = false; } };
    // a mob despawns by the nearest player, as the game has it, whoever's machine runs it
    const despawnCheck = E.despawnCheck;
    E.despawnCheck = function (e) {
      const P = this.P.pos, d = net.dimNow();
      let best = null, bd = (e.pos.x - P.x) ** 2 + (e.pos.y - P.y) ** 2 + (e.pos.z - P.z) ** 2;
      if (net.players) for (const r of net.players.list.values()) {
        const s = r.st;
        if (!s || s.d !== d || (s.f & (F.DEAD | F.SPEC))) continue;
        const d2 = (e.pos.x - s.x) ** 2 + (e.pos.y - s.y) ** 2 + (e.pos.z - s.z) ** 2;
        if (d2 < bd) { bd = d2; best = s; }
      }
      if (!best) return despawnCheck.call(this, e);
      return despawnCheck.call(Object.create(this, { P: { value: { pos: { x: best.x, y: best.y, z: best.z } } } }), e);
    };
    // anything done to someone else's mob makes it yours first
    const interact = E.interact;
    E.interact = function (e) { if (e && e.puppet) M.claim(e); return interact.apply(this, arguments); };
    const S = E.spawner;
    if (S) {
      // natural spawning only where no other player is nearer (lc2.js, as the game spawns round each player)
      const tryChunk = S.tryChunk;
      S.tryChunk = function (c, cat) { return net.owns(c) ? tryChunk.call(this, c, cat) : 0; };
      // a chunk's own animals and a structure's people: asked of the server, which says yes to the first page only
      const populate = S.populate, structureMobs = S.structureMobs;
      M.popRun = (cx, cz, c) => { populate.call(S, cx, cz); if (c) structureMobs.call(S, c); };
      S.populate = function (cx, cz) { M.askPop(cx, cz); };
      S.structureMobs = function () { return 0; };
    }
  }
  askPop(cx, cz) {
    const k = cx + ',' + cz;
    if (this.popWait.has(k)) return;
    this.popWait.set(k, performance.now());
    this.popAsk.push(k);
  }
  // the server's yes for chunks nobody had: their animals and people made here (and so shared)
  popped(m) {
    const E = this.E, net = this.net;
    for (const k of m.k || []) this.popWait.delete(k);
    if (!E || E.gone || m.d !== net.dimNow() || !this.popRun) return;
    for (const k of m.k || []) {
      const c = net.game.world.chunks.get(k);
      if (!c) continue;
      try { this.popRun(c.cx, c.cz, c); } catch (err) { console.warn(err); }
    }
  }

  // made on this machine: sent at the end of the tick, when its colour, age and the like are set
  made(e) {
    e.nk = ++this.key;
    e.toJSON = undefined;
    this.byKey.set(e.nk, e);
    this.out.push(e);
  }
  keep(o) {
    if (!o || !(o.id > 0) || !o.j || typeof o.j.t !== 'string') return null;
    let rec = this.recs.get(o.id);
    const p = Array.isArray(o.p) ? o.p : o.j.p || [0, 0, 0];
    if (!rec) { rec = { id: o.id, d: o.d | 0, j: o.j, o: o.o | 0, x: +p[0], y: +p[1], z: +p[2], a: o.a || null, e: null, buf: [], hold: 0, q: null, n: 0 }; this.recs.set(o.id, rec); }
    else { rec.j = o.j; rec.o = o.o | 0; rec.x = +p[0]; rec.y = +p[1]; rec.z = +p[2]; if (o.a !== undefined) rec.a = o.a || null; }
    // (the last of where it is as the server has it: the changes that follow go on top of it)
    if (Array.isArray(o.q) && o.q.length === 7) { rec.q = o.q.slice(); if (rec.e && rec.e.puppet) this.addPos(rec, performance.now() - DELAY, o.f | 0); }
    return rec;
  }
  // a record made into an entity here: run here, or a puppet of another machine's
  adopt(e, rec) {
    const M = this, net = this.net;
    rec.e = e; e.nm = rec.id; e.nk = 0;
    e.toJSON = undefined;
    rec.ht = e.hurtTime | 0;
    e.remove = function () {
      Object.getPrototypeOf(this).remove.call(this);
      M.unlead(this);
      if (rec.e !== this) return;
      rec.e = null;
      if (M.applying || !M.E || M.E.gone || net.closed) return;
      // someone else's, gone from here only (out of reach, or Peaceful): made again later if it is still about
      if (this.puppet || rec.o !== net.id) { rec.hold = performance.now() + 4000; return; }
      // left behind as its ground unloads: the server keeps it till someone is near (a monster that would despawn anyway just goes, as the game has it)
      if (M.unloading && !(this.constructor.HOSTILE && !this.persistent)) { rec.j = jsonOf(this); rec.o = 0; M.kept.push(rec.id, rec.j); return; }
      // gone for good: killed, despawned, turned into another kind, scooped into a bucket
      M.recs.delete(rec.id);
      M.gone.push(rec.id);
    };
    if (rec.o === net.id) this.live(rec, false); else this.puppet(rec);
  }
  // one just told of, made at once where its ground is here (a firework lives a second and a half: the next look would be too late)
  soon(rec) {
    const E = this.E, g = this.net.game;
    if (!E || E.gone || !g || !g.ready || rec.d !== this.net.dimNow() || performance.now() < rec.hold || !g.world.loaded(Math.floor(rec.x), Math.floor(rec.z))) return;
    this.make(rec);
  }
  make(rec) {
    const E = this.E, j = rec.j, C = TYPES[j.t];
    if (!C) return;
    // (monsters are not kept on Peaceful)
    if (C.HOSTILE && E.difficulty === 'peaceful') return;
    let e = null;
    this.applying = true;
    try { e = E.spawn(j.t, rec.x, rec.y, rec.z, { json: j, natural: false }); } catch (err) { e = null; } finally { this.applying = false; }
    if (!e) return;
    e.setPos(rec.x, rec.y, rec.z);
    e.vel.set(0, 0, 0);
    rec.buf.length = 0;
    this.adopt(e, rec);
  }
  /* Someone else's: drawn where its machine says, a little behind, between
     the positions it sent. Its own mind, physics and despawning are off; a
     hit or any other use of it claims it (claim). */
  puppet(rec) {
    const e = rec.e, M = this;
    if (!e) return;
    e.puppet = true;
    // (its lead is drawn here, to whoever holds it: lead(); as its own, it would be drawn to you, and snap and drop a lead here)
    e.leash = null;
    if (!rec.buf.length) rec.buf.push({ ts: performance.now() - DELAY, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, body: e.bodyYaw || e.yaw, head: e.headYaw || e.yaw, pitch: e.pitch, f: e.onGround ? F_GROUND : 0 });
    e.tick = function () { M.puppetTick(rec, this); };
    e.hurt = function () { M.claim(this); return this.puppet ? false : this.hurt.apply(this, arguments); };
    // (and so does a potion of yours reaching it, splashed or a cloud: its effect is had where it is run)
    if (typeof e.addEffect === 'function') e.addEffect = function () { if (!M.applying && !M.net.applying) M.claim(this); return this.puppet ? false : this.addEffect.apply(this, arguments); };
    e.anim = function (A) { const s = rec.a; if (s) for (const k in s) A[k] = s[k]; };
  }
  // this machine runs it now (it is yours to move, or you just did something to it)
  live(rec, wasPuppet) {
    const e = rec.e;
    if (!e) return;
    if (e.puppet) {
      e.puppet = false;
      delete e.tick; delete e.hurt; delete e.anim; delete e.addEffect;
      this.unlead(e);
      // (a lead tied to a fence goes on being its own; one in someone else's hand stays theirs)
      if (rec.j && Array.isArray(rec.j.lsh)) e.leash = { knot: rec.j.lsh.slice() };
      // carries on the way it was going
      e.vel.set(e.pos.x - e.prev.x, 0, e.pos.z - e.prev.z);
      if (e.dead) { e.deathTime = Math.min(e.deathTime | 0, 19); }
    }
    rec.buf.length = 0;
    // (what the server has of it is what the next change is told against)
    rec.sent = null; rec.sig = rec.j ? sigOf(rec.j) : undefined; rec.asig = undefined;
    e.noActionTime = 0;
    void wasPuppet;
  }
  puppetTick(rec, e) {
    e.prev.copy(e.pos); e.prevYaw = e.yaw; e.prevPitch = e.pitch;
    if (e.prevBodyYaw !== undefined) { e.prevBodyYaw = e.bodyYaw; e.prevHeadYaw = e.headYaw; }
    e.age++;
    if (e.hurtTime > 0) e.hurtTime--;
    if (e.invul > 0) e.invul--;
    // (one sent less often is drawn a little further behind, so it never waits for the next)
    const s = this.sample(rec, performance.now() - Math.max(DELAY, (rec.gap || 0) + 90));
    if (s) {
      e.pos.set(s.x, s.y, s.z);
      e.yaw = s.yaw; e.pitch = s.pitch;
      if (e.bodyYaw !== undefined) { e.bodyYaw = s.body; e.headYaw = s.head; }
      e.onGround = !!(s.f & F_GROUND);
      e.fire = s.f & F_FIRE ? Math.max(e.fire, 2) : 0;
    }
    // a rocket carrying its owner's player stays with them (boosts() each frame); any rocket leaves its sparkle trail, as tick() does
    if (rec.j && rec.j.t === 'firework_rocket') {
      if (rec.j.bo) this.boostOne(rec, e);
      if (e.age % 2 === 0 && e.m && e.m.particles) e.m.particles('sparkle', e.pos.x, e.pos.y - 0.2, e.pos.z, 1, 0.05);
    }
    e.vel.subVectors(e.pos, e.prev);
    if (e.dead) e.deathTime = Math.min(19, (e.deathTime | 0) + 1);
    if (e.animTick) e.animTick();
    this.lead(rec, e);
  }
  /* Every frame: another machine's rocket boosting its player is put on
     that player as drawn here (feet + 0.5, as the game keeps it), not drawn
     220 ms behind on its own */
  boosts() {
    for (const rec of this.recs.values()) {
      const e = rec.e;
      if (e && e.puppet && rec.j && rec.j.bo) this.boostOne(rec, e);
    }
  }
  boostOne(rec, e) {
    const r = this.net.players && this.net.players.list.get(rec.o), f = r && r.feet;
    if (!f) return false;
    e.pos.set(f.x, f.y + 0.5, f.z); e.prev.copy(e.pos);
    return true;
  }
  /* A puppet's lead, as the game draws one: from its neck to the hand of the
     player holding it (the one whose machine runs it), or to the knot on a
     fence, sagging less the tighter it is */
  lead(rec, e) {
    const L = rec.j && rec.j.lsh;
    let hx, hy, hz;
    if (L === 1) {
      const r = this.net.players && this.net.players.list.get(rec.o), f = r && r.feet;
      if (!f || !r.st || !r.av || !r.av.mesh.visible) { this.unlead(e); return; }
      const sn = Math.sin(r.st.yaw), cs = Math.cos(r.st.yaw);
      hx = f.x - cs * 0.35 - sn * 0.5; hy = f.y + 1.1; hz = f.z + sn * 0.35 - cs * 0.5;
    } else if (Array.isArray(L)) { hx = L[0] + 0.5; hy = L[1] + 0.5; hz = L[2] + 0.5; }
    else { this.unlead(e); return; }
    if (!e.netLead) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 12), 3));
      e.netLead = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x6a4a2a }));
      e.netLead.frustumCulled = false;
      if (this.E && this.E.group) this.E.group.add(e.netLead);
    }
    const a = e.netLead.geometry.attributes.position.array, sx = e.pos.x, sy = e.pos.y + e.h * 0.8, sz = e.pos.z;
    const d = Math.hypot(hx - sx, hy - sy, hz - sz);
    for (let i = 0; i < 12; i++) {
      const t = i / 11, sag = Math.sin(t * Math.PI) * Math.max(0, 0.6 - d * 0.05);
      a[i * 3] = sx + (hx - sx) * t; a[i * 3 + 1] = sy + (hy - sy) * t - sag; a[i * 3 + 2] = sz + (hz - sz) * t;
    }
    e.netLead.geometry.attributes.position.needsUpdate = true;
  }
  unlead(e) {
    const l = e.netLead;
    if (!l) return;
    if (l.parent) l.parent.remove(l);
    l.geometry.dispose(); l.material.dispose();
    e.netLead = null;
  }
  // where it was at time t (this page's clock), between the two positions either side
  sample(rec, t) {
    const b = rec.buf;
    if (!b.length) return null;
    while (b.length > 2 && b[1].ts < t - 500) b.shift();
    if (t <= b[0].ts) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1], c = b[i];
      if (t < a.ts) continue;
      if (t >= c.ts) return c;
      const k = (t - a.ts) / (c.ts - a.ts), o = rec.tmp || (rec.tmp = {});
      // (more than 8 blocks in one step is a teleport: no sliding across)
      if (Math.abs(c.x - a.x) + Math.abs(c.y - a.y) + Math.abs(c.z - a.z) > 8) return k < 0.5 ? a : c;
      o.x = a.x + (c.x - a.x) * k; o.y = a.y + (c.y - a.y) * k; o.z = a.z + (c.z - a.z) * k;
      o.yaw = a.yaw + wrap(c.yaw - a.yaw) * k; o.body = a.body + wrap(c.body - a.body) * k; o.head = a.head + wrap(c.head - a.head) * k;
      o.pitch = a.pitch + (c.pitch - a.pitch) * k; o.f = k < 0.5 ? a.f : c.f;
      return o;
    }
    return b[b.length - 1];
  }
  /* Something you did to someone else's mob: yours to run from now (the
     server hands it over and tells the machine that had it) */
  claim(e) {
    const rec = e && e.nm ? this.recs.get(e.nm) : null;
    if (!rec || !this.on) return;
    this.net.send({ t: 'mc', id: rec.id });
    rec.claimAt = performance.now();
    if (rec.o !== this.net.id || e.puppet) { rec.o = this.net.id; this.live(rec, true); }
  }

  /* ---- each tick, after the mobs' own ---- */
  tick(dim, stamp) {
    const net = this.net, E = this.E;
    if (!E || E.gone || !this.on) return;
    this.t++;
    // what came about here this tick, to the server
    if (this.out.length) {
      const e = [];
      for (const x of this.out) if (!x.removed && x.nk && e.length < 128) e.push({ k: x.nk, d: dim, j: jsonOf(x) });
      this.out.length = 0;
      if (e.length) net.send({ t: 'm+', e });
    }
    if (this.gone.length) { net.send({ t: 'm-', e: this.gone }); this.gone = []; }
    if (this.kept.length) {
      const ids = [], js = [];
      for (let i = 0; i < this.kept.length; i += 2) { ids.push(this.kept[i]); js.push(this.kept[i + 1]); }
      net.send({ t: 'm-', e: ids, keep: 1, j: js });
      this.kept = [];
    }
    if (this.popAsk.length) { net.send({ t: 'pop', d: dim, k: this.popAsk.splice(0, 256) }); }
    // (an answer lost on the way: asked again after ten seconds)
    if (this.t % 200 === 0) { const now = performance.now(); for (const [k, at] of this.popWait) if (now - at > 10000) this.popWait.delete(k); }
    const P = net.game.player.pos, W = net.game.world;
    const near = [];
    if (net.players) for (const r of net.players.list.values()) { const s = r.st; if (s && s.d === dim) near.push(s); }
    // how near the nearest other player is to a spot (blocks, the larger of the two distances across)
    const nearest = (x, z) => { let d = Infinity; for (const s of near) d = Math.min(d, Math.max(Math.abs(s.x - x), Math.abs(s.z - z))); return d; };
    const moveTick = this.t % 3 === 0, farTick = this.t % 6 === 0, slowTick = this.t % 60 === 0, look = this.t % 20 === 0, jsonTick = this.t % 10 === 0;
    const now = performance.now(), whole = [], moves = [], recs = [], anims = [], far = Math.max(64, (net.ctx.renderer.opts.renderDist || 8) * 16);
    for (const rec of this.recs.values()) {
      if (rec.d !== dim) continue;
      const e = rec.e;
      if (!e || e.removed) {
        if (look && now > rec.hold && Math.abs(rec.x - P.x) < far && Math.abs(rec.z - P.z) < far && W.loaded(Math.floor(rec.x), Math.floor(rec.z))) this.make(rec);
        continue;
      }
      if (e.puppet) continue;
      // yours: a hit or a swing since the last position is said with the next
      if ((e.hurtTime | 0) > (rec.ht | 0)) rec.hurtNow = true;
      rec.ht = e.hurtTime | 0;
      if (e.swinging && e.swingT === 0) rec.swingNow = true;
      // riding it, leading it or trading with it keeps it yours (asked again before the server's hold runs out), and so does a mob
      // fighting back at you for your hit, a monster or an angry wolf or golem (the game's keeps after whoever hurt it; otherwise a
      // monster goes to the machine of the player nearest it)
      if ((E.riding === e || (e.leash && e.leash.player) || e.customer || (e.target && e.target === E.player && e.hurtBy === E.player)) &&
        now - (rec.claimAt || 0) > 5000) { rec.claimAt = now; net.send({ t: 'mc', id: rec.id }); }
      // every third tick near another player, every sixth further off, every third second where nobody else is
      const dn = nearest(e.pos.x, e.pos.z), seen = dn < SEEN;
      if (moveTick && (dn < CLOSE || (seen && farTick) || slowTick)) {
        const f = (e.onGround ? F_GROUND : 0) | (rec.hurtNow ? F_HURT : 0) | (e.dead ? F_DEAD : 0) | (e.fire > 0 ? F_FIRE : 0) | (rec.swingNow ? F_SWING : 0) |
          (e.passengers.indexOf(E.player) >= 0 ? F_RIDDEN : 0);
        const body = e.bodyYaw !== undefined ? e.bodyYaw : e.yaw, head = e.headYaw !== undefined ? e.headYaw : e.yaw;
        const q = [q100(e.pos.x), q100(e.pos.y), q100(e.pos.z), q256(e.yaw), q256(body), q256(head), q256(e.pitch || 0)];
        const s = rec.sent;
        // the whole of it the first time and now and then; between, what changed (lc2.js mobMoves)
        if (!s || ++rec.n >= KEY || Math.abs(q[0] - s[0]) > 3000 || Math.abs(q[1] - s[1]) > 3000 || Math.abs(q[2] - s[2]) > 3000) {
          whole.push(rec.id, ...q, f); rec.n = 0;
          rec.sent = q; rec.hurtNow = false; rec.swingNow = false;
        } else if (f !== rec.sf || q.some((v, i) => v !== s[i])) {
          moves.push(rec.id, q[0] - s[0], q[1] - s[1], q[2] - s[2], wrap256(q[3] - s[3]), wrap256(q[4] - s[4]), wrap256(q[5] - s[5]), wrap256(q[6] - s[6]), f);
          rec.sent = q; rec.hurtNow = false; rec.swingNow = false;
        } else rec.n--;
        rec.sf = f & ~(F_HURT | F_SWING);
        rec.x = e.pos.x; rec.y = e.pos.y; rec.z = e.pos.z;
        // how its parts move, when that changed
        if (seen) {
          const a = animOf(e), sig = a ? JSON.stringify(a) : '';
          if (sig !== rec.asig) { rec.asig = sig; anims.push([rec.id, a]); }
        }
      }
      // its record, when it changed (a hit's health at once; the rest at most once a second)
      if (jsonTick && (seen || this.t % 600 === 0)) {
        const j = jsonOf(e);
        if (e.tamed) j.own = net.name;
        const sig = sigOf(j);
        if (sig !== rec.sig && (j.h !== rec.j.h || now - (rec.jAt || 0) > 1000 || rec.sig === undefined)) {
          if (rec.sig !== undefined) recs.push([rec.id, j]);
          rec.sig = sig; rec.j = j; rec.jAt = now;
        }
      }
    }
    if (whole.length) net.send([3, dim, Math.round(stamp), ...whole]);
    if (moves.length) net.send([4, dim, Math.round(stamp), ...moves]);
    if (anims.length) net.send({ t: 'ma', e: anims });
    if (recs.length) net.send({ t: 'mj', e: recs });
    // your sight, for which mobs the server tells you of
    if (this.t % 100 === 1) { const r = Math.round(far); if (r !== this.viewSent) { this.viewSent = r; net.send({ t: 'view', r }); } }
  }

  /* ---- what the server says ---- */
  receive(m) {
    const net = this.net;
    if (Array.isArray(m)) { this.moves(m); return; }
    switch (m.t) {
      case 'm=': {
        const a = m.e || [];
        for (let i = 0; i + 1 < a.length; i += 2) {
          const e = this.byKey.get(a[i]);
          if (!e) continue;
          this.byKey.delete(a[i]);
          const id = a[i + 1] | 0;
          // (not kept: the server is full, so it stays this machine's own)
          if (!id) { delete e.toJSON; e.nk = 0; continue; }
          const rec = this.keep({ id, d: net.dimNow(), j: jsonOf(e), o: net.id, p: [e.pos.x, e.pos.y, e.pos.z] });
          if (e.removed) { this.recs.delete(id); this.gone.push(id); continue; }
          this.adopt(e, rec);
        }
        return;
      }
      case 'm+': for (const o of m.e || []) { const rec = this.keep(o); if (rec && rec.e && !rec.e.removed) this.retake(rec); else if (rec) this.soon(rec); } return;
      case 'mo': {
        let rec = this.recs.get(m.id);
        if (m.m) {
          // given to you: with its record as the server last had it (yours is newer if you just claimed it)
          if (!rec) rec = this.keep(m.m);
          else if (rec.o !== net.id || !rec.e) { rec.j = m.m.j; if (Array.isArray(m.m.p) && !rec.e) { rec.x = m.m.p[0]; rec.y = m.m.p[1]; rec.z = m.m.p[2]; } }
        }
        if (!rec) return;
        rec.o = m.o | 0;
        if (rec.e && !rec.e.removed) this.retake(rec); else this.soon(rec);
        return;
      }
      case 'mj': for (const a of m.e || []) { const rec = this.recs.get(a[0]); if (rec && a[1] && a[1].t === rec.j.t) { rec.j = a[1]; if (rec.e && rec.e.puppet) this.apply(rec); } } return;
      case 'ma': for (const a of m.e || []) { const rec = this.recs.get(a[0]); if (rec && rec.o !== net.id) rec.a = a[1] || null; } return;
      case 'm-': {
        for (const id of m.e || []) {
          const rec = this.recs.get(id);
          if (!rec) continue;
          this.recs.delete(id);
          const e = rec.e;
          if (!e || e.removed) continue;
          // killed: the puff of smoke as it goes (a despawn, or one gone out of sight, just goes)
          // (RIP Computer: its body lies here a while instead: entities/manager.js corpse)
          if (e.dead && !m.far && this.E && !(this.E.corpse && this.E.corpse(e))) this.E.poof(e);
          // a firework gone off: its sparks here too (what it hurt is the business of the machine it flew on)
          if (e.type === 'firework_rocket' && !m.far && e.burst) {
            const real = e.m;
            e.m = Object.create(real, { forNear: { value: () => {} }, player: { value: { alive: () => false, dist2: () => 1e9 } } });
            this.applying = true;
            try { e.burst(); } catch (err) { /* only sparks */ } finally { e.m = real; this.applying = false; }
          }
          this.applying = true;
          try { if (this.E && this.E.riding === e) this.E.dismount(); e.remove(); } finally { this.applying = false; }
        }
        return;
      }
      case 'pop': this.popped(m); return;
    }
  }
  /* Another player riding a mob their machine runs: drawn in its saddle as
     this machine draws the mob (the two are sent apart, and drawn a little
     behind each by its own delay), by where they sat on it in the newest of each */
  seatOf(r, alpha) {
    const rec = this.riders.get(r.id), e = rec && rec.e, s = r.st, b = rec && rec.buf[rec.buf.length - 1];
    if (!e || e.removed || !e.puppet || !s || !b || rec.rider !== r.id) return null;
    const dx = s.x - b.x, dy = s.y - b.y, dz = s.z - b.z;
    if (dx * dx + dy * dy + dz * dz > 16) return null;
    const a = alpha === undefined ? 1 : alpha, out = this.seatOut || (this.seatOut = { x: 0, y: 0, z: 0, v: null });
    out.x = e.prev.x + (e.pos.x - e.prev.x) * a + dx; out.y = e.prev.y + (e.pos.y - e.prev.y) * a + dy; out.z = e.prev.z + (e.pos.z - e.prev.z) * a + dz;
    out.v = e;
    return out;
  }
  // where rec.q says it is, at time t (this page's clock), into its puppet's list of positions
  addPos(rec, t, f) {
    const q = rec.q, x = q[0] / 100, y = q[1] / 100, z = q[2] / 100;
    rec.x = x; rec.y = y; rec.z = z;
    const b = rec.buf, last = b[b.length - 1];
    if (last && t <= last.ts) { if (t < last.ts - 3000) b.length = 0; else return false; }
    // standing still sends nothing: it stood where it was until a tick before this
    if (last && t - last.ts > 200) b.push(Object.assign({}, last, { ts: t - 150 }));
    // (how far apart they come, smoothed: a mob sent every sixth tick is drawn further behind)
    if (last && t - last.ts < 400) rec.gap = rec.gap === undefined ? t - last.ts : rec.gap + (t - last.ts - rec.gap) * 0.2;
    b.push({ ts: t, x, y, z, yaw: q[3] / 256 * TURN, body: q[4] / 256 * TURN, head: q[5] / 256 * TURN, pitch: wrap256(q[6]) / 256 * TURN, f });
    if (b.length > 40) b.splice(0, b.length - 40);
    return true;
  }
  // its record or its owner changed: run here or drawn as a puppet, as it should be now
  retake(rec) {
    const e = rec.e, net = this.net;
    if (!e || e.removed) return;
    if (rec.o === net.id) {
      if (!e.puppet) return;
      // handed over (you are the nearest now): from the record, where it is on your screen
      this.apply(rec);
      if (e.leash && e.leash.player) e.leash = null;
      this.live(rec, true);
    } else if (!e.puppet) this.puppet(rec);
    else this.apply(rec);
  }
  // a puppet's record put in (its colour, saddle, health...), keeping where it is drawn
  apply(rec) {
    const e = rec.e;
    if (!e) return;
    const p = e.pos.clone(), pv = e.prev.clone(), y = e.yaw, py = e.prevYaw, b = e.bodyYaw, hy = e.headYaw, pb = e.prevBodyYaw, ph = e.prevHeadYaw, pt = e.pitch;
    this.applying = true;
    try { e.fromJSON(rec.j); } catch (err) { console.warn(err); } finally { this.applying = false; }
    e.pos.copy(p); e.prev.copy(pv); e.yaw = y; e.prevYaw = py; e.pitch = pt;
    if (b !== undefined) { e.bodyYaw = b; e.headYaw = hy; e.prevBodyYaw = pb; e.prevHeadYaw = ph; }
    if (e.puppet) e.leash = null;
  }
  /* [3, d, ts, owner, id, x, y, z, yaw, body, head, pitch, flags, id, ...]: where the mobs another
     machine runs are ([4, ...]: what changed since the last), on its clock, put on this page's
     clock by the quickest any of its messages took */
  moves(m) {
    const d = m[1], ts = m[2], oid = m[3], now = performance.now(), delta = m[0] === 4;
    let c = this.clocks.get(oid);
    if (!c) this.clocks.set(oid, c = { win: Infinity, prev: Infinity, at: now, est: null });
    const off = now - ts;
    if (now - c.at > 2000) { c.prev = c.win; c.win = Infinity; c.at = now; }
    if (off < c.win) c.win = off;
    const est = Math.min(c.win, c.prev);
    // (the estimate eases rather than jumps, unless the clocks are far apart)
    c.est = c.est === null || Math.abs(est - c.est) > 250 ? est : c.est + (est - c.est) * 0.1;
    const t = ts + c.est;
    for (let i = 4; i + 8 < m.length; i += 9) {
      const rec = this.recs.get(m[i]);
      if (!rec || rec.d !== d || rec.o === this.net.id) continue;
      const f = m[i + 8] | 0;
      if (delta) {
        const q = rec.q;
        if (!q) continue;
        q[0] += m[i + 1]; q[1] += m[i + 2]; q[2] += m[i + 3];
        for (let k = 3; k < 7; k++) q[k] = (q[k] + m[i + 1 + k]) & 255;
      } else rec.q = [m[i + 1], m[i + 2], m[i + 3], m[i + 4], m[i + 5], m[i + 6], m[i + 7]];
      if (!this.addPos(rec, t, f)) continue;
      // ridden by the player whose machine runs it: they are drawn in its saddle (seatOf)
      if (f & F_RIDDEN) { rec.rider = oid; this.riders.set(oid, rec); } else if (rec.rider) { if (this.riders.get(rec.rider) === rec) this.riders.delete(rec.rider); rec.rider = 0; }
      const e = rec.e;
      if (!e || !e.puppet) continue;
      // a hit and a swing show at once; dying starts it falling over
      if (f & F_HURT) { e.hurtTime = 10; e.invul = 20; }
      if (f & F_SWING && e.swing) e.swing();
      if (f & F_DEAD && !e.dead) { e.dead = true; e.health = 0; e.deathTime = 0; }
    }
  }
}

/* ---- the orbs of experience (drops.js keeps them): numbered by the server,
   each machine moves its own copy towards its own player, and the one
   whose player reaches it first asks for it and is given it ---- */
export class Orbs {
  constructor(net) {
    this.net = net;
    this.list = new Map();      // number -> { id, d, n, p, v, at, o: the orb in drops.js }
    this.byKey = new Map(); this.key = 0; this.out = [];
    this.on = false;
  }
  init(m) {
    this.on = Array.isArray(m.orbs);
    for (const o of m.orbs || []) this.keep(o);
  }
  keep(o) {
    if (!o || !(o.id > 0) || !Array.isArray(o.p)) return null;
    const rec = { id: o.id, d: o.d | 0, n: o.n | 0, p: o.p, v: o.v || [0, 0, 0], at: performance.now(), o: null };
    this.list.set(o.id, rec);
    return rec;
  }
  hook(D) {
    const O = this, net = this.net;
    this.D = D;
    if (!this.on) return;
    // what this browser kept from before is not the server's
    D.orbs.slice().forEach((o, i) => D._removeOrb(o, i));
    const xp = D.xp;
    D.xp = function (x, y, z, amount) {
      const n0 = this.orbs.length;
      const r = xp.apply(this, arguments);
      if (!O.applying && !net.closed) for (let i = n0; i < this.orbs.length; i++) O.share(this.orbs[i]);
      return r;
    };
    // (one a blast here blew up: gone for everyone, said by this machine)
    const removeOrb = D._removeOrb;
    D._removeOrb = function (o, i) {
      const had = !o.gone;
      removeOrb.call(this, o, i);
      if (had && o.blown && o.nid && !O.applying && !net.closed) { net.send({ t: 'o-', id: o.nid }); O.list.delete(o.nid); }
    };
    const tick = D.tick;
    D.tick = function (player, collector) {
      // never taken here directly: the server is asked (take)
      this.takeXpDelay = Math.max(this.takeXpDelay, 2);
      // the others in this dimension, where you see them, alive and not spectating: an orb goes to the nearest of you all
      const others = this.others || (this.others = []), d = net.dimNow();
      others.length = 0;
      if (net.players && this.orbs.length) for (const r of net.players.list.values()) {
        const s = r.st;
        if (!s || s.d !== d || (s.f & (F.DEAD | F.SPEC))) continue;
        others.push(r.feet && r.av && r.av.mesh.visible ? r.feet : s);
      }
      const r = tick.call(this, player, collector);
      O.take(this, player, collector);
      return r;
    };
    for (const rec of this.list.values()) { rec.o = null; if (rec.d === net.dimNow()) this.show(rec); }
  }
  share(o) {
    const k = ++this.key, r3 = v => Math.round(v * 1000) / 1000;
    o.nk = k;
    this.byKey.set(k, o);
    this.out.push({ k, d: this.net.dimNow(), n: o.value, p: [r3(o.pos.x), r3(o.pos.y), r3(o.pos.z)], v: [r3(o.vel.x), r3(o.vel.y), r3(o.vel.z)] });
  }
  show(rec) {
    const D = this.D;
    if (!D || (rec.o && !rec.o.gone)) return;
    this.applying = true;
    try { D.xp(rec.p[0], rec.p[1], rec.p[2], rec.n); } finally { this.applying = false; }
    const o = D.orbs[D.orbs.length - 1];
    if (!o) return;
    const fresh = performance.now() - rec.at < 150;
    o.value = rec.n; o.nid = rec.id;
    if (fresh) o.vel.set(rec.v[0], rec.v[1], rec.v[2]); else o.vel.set(0, 0, 0);
    rec.o = o;
  }
  // each tick: the orbs your player is touching asked for, one every two ticks as the game takes them
  take(D, player, collector) {
    if (this.out.length) { this.net.send({ t: 'o+', e: this.out.splice(0, 256) }); }
    const P = player && player.pos;
    // (the connection gone this tick: the game is let go of before the frame ends)
    if (!P || !collector || !collector.alive || !this.net.game || this.net.game.mode === 'spectator') return;
    const now = performance.now();
    if (this.wait > now) return;
    for (const o of D.orbs) {
      if (o.gone || o.fly > 0 || !o.nid || (o.asked && now - o.asked < 1500)) continue;
      if (Math.abs(o.pos.x - P.x) < 1.425 && Math.abs(o.pos.z - P.z) < 1.425 && o.pos.y + 0.25 > P.y - 0.5 && o.pos.y < P.y + 2.3) {
        o.asked = now; this.wait = now + 100;
        this.net.send({ t: 'o-', id: o.nid, take: 1 });
        return;
      }
    }
  }
  receive(m) {
    const net = this.net, D = this.D;
    switch (m.t) {
      case 'o=': {
        const a = m.e || [];
        for (let i = 0; i + 1 < a.length; i += 2) {
          const o = this.byKey.get(a[i]);
          if (!o) continue;
          this.byKey.delete(a[i]);
          const id = a[i + 1] | 0;
          // (not kept: it stays this machine's own, and is picked up here as in singleplayer)
          if (!id) { o.own = true; continue; }
          o.nid = id;
          this.list.set(id, { id, d: net.dimNow(), n: o.value, p: [o.pos.x, o.pos.y, o.pos.z], v: [0, 0, 0], at: performance.now(), o });
          if (o.gone) net.send({ t: 'o-', id });
        }
        return;
      }
      case 'o+': for (const x of m.e || []) { const rec = this.keep(x); if (rec && rec.d === net.dimNow()) this.show(rec); } return;
      case 'o-': case 'ono': {
        const rec = this.list.get(m.id);
        this.list.delete(m.id);
        if (rec && rec.o && !rec.o.gone && D) D._removeOrb(rec.o, -1);
        return;
      }
      case 'ook': {
        // yours: its points (mending first, as the game does), the ding, and it flies into you
        const rec = this.list.get(m.id), g = net.game, c = g && g.collector;
        this.list.delete(m.id);
        if (rec && rec.o && !rec.o.gone && D) { if (D.flyIn) D.flyIn(rec.o); else D._removeOrb(rec.o, -1); }
        if (!c || !(m.n > 0)) return;
        let pts = m.n;
        if (c.mendingRepair) pts = c.mendingRepair(pts);
        if (pts > 0) c.addXp(pts);
        if (D && D.onXp) D.onXp(m.n);
        return;
      }
    }
  }
}
