/* ---------------------------------------------------------------------------
   Leoncraft 2 multiplayer - what is seen and heard happen near the other
   players that changes no block: as on the game's servers, which send a
   sound, a block event or a level event to everyone near where it happened.

     sounds        every sound this machine plays for something that
                   happened here (your steps, hits, eating, a chest opening,
                   a lever, a piston, a note block, a creeper's hiss, an
                   explosion) is sent to the players near it, who play it
                   where it was. Not the ones each machine makes by itself
                   (the mobs' voices and steps, which come from the mobs
                   everyone has; fire, lava and water; a door swinging and a
                   block breaking, which every machine hears as the change
                   reaches it), and not the mining taps the game keeps to the
                   one mining.
     lids          a chest, ender chest or shulker box opened: its lid opens
                   on every screen until it is closed (a barrel's open top is
                   a state of the block, shared already). A bell's swing and a
                   decorated pot's wobble too.
     notes         a note block's note over it
     pistons       the blocks a piston pushes or pulls slide across on every
                   screen, as they do on the machine that moved them (the
                   blocks themselves come as changes like any other)
     TNT           lit: the lit block on every screen, flashing and swelling
                   on the same fuse, gone at the moment the one who lit it
                   sees it go off (the explosion itself is theirs)
     explosions    the flash and smoke, and the hurt and the push for your
                   player by the game's numbers (the blocks it broke come as
                   changes like any other)
     potions       a splash potion breaking: its colour, and what it does to
                   your player (a harmful one only where PvP is on)
     mining        the cracks on the block another player is mining, stage
                   by stage, as the game shows them (block destruction)
     particles     the hearts of animals fed or in love, a tamed wolf's or a
                   refused cat's, a villager's green sparks, the stars of a
                   critical hit, a firework's sparks: what the mobs your
                   machine runs and your hits make, at most 40 a second
     players       others sprinting (the dust of the ground at their feet),
                   eating (the bits of food), on fire (the game's flames
                   over them, as over a burning mob),
                   fishing (their line, from the rod in their hand to the
                   bobber where it floats)
--------------------------------------------------------------------------- */
import { Sound } from '../sound/sound.js?v=32';
import { MobSounds } from '../sound/mobsounds.js?v=32';
import { Ambience } from '../sound/ambient.js?v=32';
import { B, BLOCKS } from '../blocks.js?v=32';
import { selectionBoxes } from '../models.js?v=32';
import { exposure } from '../explosion.js?v=32';
import { Overlay } from '../render/overlay.js?v=32';
import { F } from './players.js?v=32';
import { Potion } from '../entities/projectiles.js?v=32';
import { splashPotion } from '../entities/mobfx.js?v=32';
import { POTIONS } from '../brewing.js?v=32';
const THREE = window.THREE;

let active = null, quiet = 0;
/* The sounds each machine makes by itself are not passed on: everything the
   mobs' voices (sound/mobsounds.js) and the world's own noises (fire, lava,
   water, the furnaces: sound/ambient.js) play is kept here. */
const keepQuiet = (proto, name) => {
  const d = Object.getOwnPropertyDescriptor(proto, name), fn = d && d.value;
  if (typeof fn !== 'function' || fn.__quiet) return;
  const q = function () { quiet++; try { return fn.apply(this, arguments); } finally { quiet--; } };
  q.__quiet = true;
  proto[name] = q;
};
keepQuiet(MobSounds.prototype, 'tick');
for (const k of Object.getOwnPropertyNames(Ambience.prototype)) if (k !== 'constructor') keepQuiet(Ambience.prototype, k);
if (!Sound.play.__net) {
  const play = Sound.play;
  Sound.play = function (event, x, y, z, volume = 1, pitch = 1, cat = 'block') {
    if (active && !quiet) { try { active.heard(event, x, y, z, volume, pitch, cat); } catch (e) { /* the sound still plays */ } }
    return play.call(this, event, x, y, z, volume, pitch, cat);
  };
  Sound.play.__net = true;
}
// a splash potion that breaks here (thrown by you, or by a witch your machine runs): for the players near it
if (!Potion.prototype.splat.__net) {
  const splat = Potion.prototype.splat;
  Potion.prototype.splat = function () {
    const r = splat.apply(this, arguments);
    if (active && !this.ghost && !active.busy) { const p = this.pos, r2 = v => Math.round(v * 100) / 100; active.send(['splash', r2(p.x), r2(p.y), r2(p.z), String(this.potion || 'water'), this.lingering ? 1 : 0]); }
    return r;
  };
  Potion.prototype.splat.__net = true;
}
// what a splash potion may do to another player where PvP is off (the game's harmful ones do nothing to them)
const HARMFUL = /harming|poison|weakness|slowness|wither|infested|oozing|weaving|wind_charged|turtle_master/;
// the particles passed on (the rest each machine makes by itself, or come with what is shared already)
const FX = { heart: 1, angry: 1, smoke: 1, sparkle: 1, magic: 1, crit: 1 };
const rgb = c => (Array.isArray(c) ? ((Math.round(c[0] * 255) & 255) << 16) | ((Math.round(c[1] * 255) & 255) << 8) | (Math.round(c[2] * 255) & 255) : null);
// heard by every machine anyway, or only by the one making it
const NOT_SENT = /^block\..*\.(break|hit)$|(door|trapdoor|fence_gate)\.(open|close)$|^block\.(sponge\.absorb|wet_sponge\.dries|composter\.ready|respawn_anchor\.(charge|deplete)|candle\.extinguish|end_gateway\.spawn)$/;
const SENT_CATS = { block: 1, player: 1, neutral: 1, hostile: 1, record: 1 };
const LIDS = { chest: 1, shulker: 1, bell: 1, pot: 1 };

export class Events {
  constructor(net) {
    this.net = net;
    this.out = [];
    this.on = false;
    this.opened = new Map();      // another player's number -> the lids they have open ("x,y,z")
    this.cracks = new Map();      // another player's number -> { ov, x, y, z, s, at }
    this.mine = null;
    this.bobs = new Map();        // another player's number -> their bobber: { x, y, z, line, mesh }
    this.slides = [];             // another machine's blocks in motion, drawn sliding here (sim/pistons.js view)
    this.fxLeft = 0;              // particles that may still be passed on this tick
    this.t = 0;
  }
  init(m) { this.on = !!m.mobs; }
  attach() { if (this.on) active = this; }
  detach() {
    if (active === this) active = null;
    for (const c of this.cracks.values()) this.dropCrack(c);
    this.cracks.clear();
    for (const b of this.bobs.values()) this.dropBob(b);
    this.bobs.clear();
  }
  get busy() { const n = this.net; return n.applying || n.closed || (n.mobs && n.mobs.applying) || (n.orbs && n.orbs.applying) || (n.veh && n.veh.applying); }
  send(e) { if (this.out.length < 48) this.out.push(e); }
  // a sound played here: for the others near it
  heard(event, x, y, z, v, p, cat) {
    if (this.busy || !this.net.game || !SENT_CATS[cat] || typeof event !== 'string' || NOT_SENT.test(event) || !/^[a-z0-9_.:]{1,64}$/.test(event)) return;
    const r2 = v2 => Math.round(v2 * 100) / 100;
    this.send(['s', r2(x), r2(y), r2(z), event, r2(v), r2(p), cat]);
  }

  /* ---- what this machine's parts do, listened to (net.js hook, when each is made) ---- */
  hookSim(S) {
    const ev = this, L = S && S.lids;
    if (!L || L.__net) return;
    L.__net = true;
    for (const k of ['open', 'close']) {
      const fn = L[k];
      L[k] = function (x, y, z) {
        const r = fn.apply(this, arguments);
        const e = this.list.get(x + ',' + y + ',' + z);
        if (!ev.busy && e && e.kind !== 'barrel') ev.send(['lid', x, y, z, k === 'open' ? 1 : 0]);
        return r;
      };
    }
    const ring = L.ring, wobble = L.wobble;
    L.ring = function (x, y, z, face) { const r = ring.apply(this, arguments); if (!ev.busy) ev.send(['ring', x, y, z, face | 0]); return r; };
    L.wobble = function (x, y, z, ok) { const r = wobble.apply(this, arguments); if (!ev.busy) ev.send(['pot', x, y, z, ok ? 1 : 0]); return r; };
    // a note block's note (its sound goes with the others)
    const note = S.onNote;
    S.onNote = function (x, y, z, inst, n) { const r = note ? note.apply(this, arguments) : undefined; if (!ev.busy) ev.send(['note', x, y, z, n | 0]); return r; };
    // TNT lit here: lit on the others' screens too, the same way (sim/bodies.js prime)
    const BD = S.bodies;
    if (BD && BD.prime) {
      const prime = BD.prime;
      BD.prime = function (x, y, z, by, fuse) {
        const e = prime.apply(this, arguments);
        if (e && !ev.busy) ev.send(['tnt', x, y, z, e.fuse | 0, Math.round(Math.atan2(-e.vx, -e.vz) * 1000) / 1000]);
        return e;
      };
      // another player's lit TNT is only a picture here: it goes when its fuse runs out, and their machine makes the explosion
      const tick = BD.tick;
      BD.tick = function () {
        let gone = false;
        for (const e of this.list) if (e.ghost && e.fuse <= 1) { e.dead = true; this.drop(e); gone = true; }
        if (gone) this.list = this.list.filter(e => !e.dead);
        return tick.apply(this, arguments);
      };
      // (nor is it kept with the simulation when you change dimension)
      const toJSON = BD.toJSON;
      BD.toJSON = function () { const all = this.list; this.list = all.filter(e => !e.ghost); try { return toJSON.apply(this, arguments); } finally { this.list = all; } };
    }
    // an explosion from the world's own blocks (TNT, a bed, an anchor: explosion.js)
    const boom = S.onExplosion;
    S.onExplosion = function (x, y, z, power) { const r = boom ? boom.apply(this, arguments) : undefined; if (!ev.busy) ev.boomOut(x, y, z, power); return r; };
  }
  hookEntities(E) {
    const ev = this;
    if (!E || E.__netEv) return;
    E.__netEv = true;
    // the particles of what this machine runs, and of your hits
    const r2 = v => Math.round(v * 100) / 100;
    const particles = E.particles;
    E.particles = function (kind, x, y, z, n, spread, col) {
      const r = particles.apply(this, arguments);
      if (FX[kind] && ev.fxLeft > 0 && !ev.busy) { ev.fxLeft--; ev.send(['px', r2(x), r2(y), r2(z), kind, Math.min(64, n | 0) || 1, r2(spread || 0), rgb(col)]); }
      return r;
    };
    const PP = E.particlesP;
    if (PP && PP.emit) {
      const emit = PP.emit;
      PP.emit = function (kind, e) {
        const r = emit.apply(this, arguments);
        if (FX[kind] && e && e.pos && ev.fxLeft > 0 && !ev.busy) { ev.fxLeft--; ev.send(['px', r2(e.pos.x), r2(e.pos.y + (e.h || 1) * 0.5), r2(e.pos.z), kind, 12, r2((e.w || 0.6) * 0.5), null]); }
        return r;
      };
    }
    // an explosion of a mob's (a creeper, a ghast's fireball: entities/explosion.js)
    const boom = E.onExplode;
    E.onExplode = function (x, y, z, power) { const r = boom ? boom.apply(this, arguments) : undefined; if (!ev.busy) ev.boomOut(x, y, z, power); return r; };
  }
  boomOut(x, y, z, power) { const r2 = v => Math.round(v * 100) / 100; this.send(['boom', r2(x), r2(y), r2(z), r2(power || 4)]); }

  /* ---- each tick: what happened here, sent; the cracks of the block you mine ---- */
  tick(dim) {
    if (!this.on) return;
    const g = this.net.game, I = g.inter;
    this.t++;
    this.fxLeft = 2;
    // the cracks: the stage of the block you are mining, when it changes (the game's 0 to 9)
    const m = I && I.mining;
    let st = -1;
    if (m && m.total > 0 && m.t > 0 && !I.creative) st = Math.min(9, Math.floor(m.t / m.total * 10));
    const was = this.mine;
    if (st >= 0 && (!was || was.x !== m.x || was.y !== m.y || was.z !== m.z || was.s !== st)) { this.mine = { x: m.x, y: m.y, z: m.z, s: st }; this.send(['mine', m.x, m.y, m.z, st]); }
    else if (st < 0 && was) { this.mine = null; this.send(['mine', was.x, was.y, was.z, -1]); }
    // your bobber, where it is every other tick it moves (and when it is reeled in)
    const bob = g.entities && g.entities.bobber, r2 = v => Math.round(v * 100) / 100;
    if (bob && !bob.removed) {
      const b = [r2(bob.pos.x), r2(bob.pos.y), r2(bob.pos.z)], s0 = this.bobSent;
      if (this.t % 2 === 0 && (!s0 || b[0] !== s0[0] || b[1] !== s0[1] || b[2] !== s0[2])) { this.bobSent = b; this.send(['bob', b[0], b[1], b[2], 1]); }
    } else if (this.bobSent) { const b = this.bobSent; this.bobSent = null; this.send(['bob', b[0], b[1], b[2], 0]); }
    // blocks your pistons set moving this tick: sliding on the others' screens too
    const rs = g.sim && g.sim.redstone;
    if (rs && rs.moving && rs.moving.size) for (const e of rs.moving.values()) {
      if (e.netSent || e.ghost || !BLOCKS[e.b]) continue;
      e.netSent = true;
      this.send(['slide', e.x, e.y, e.z, BLOCKS[e.b].name, e.m | 0, e.facing | 0, e.ext ? 1 : 0, e.src ? 1 : 0]);
    }
    // and the others' slide on here, half a block a tick, as the game moves them
    if (this.slides.length) {
      const V = rs && rs.pistonView;
      this.slides = this.slides.filter(e => {
        e.po = e.p;
        if (e.po >= 1) { if (V) V.done(e); return false; }
        e.p = Math.min(1, e.p + 0.5);
        return true;
      });
    }
    if (this.out.length) { this.net.send({ t: 'ev', d: dim, e: this.out }); this.out = []; }
    // a crack nobody has said anything of for 20 seconds goes, as the game's do
    if (this.t % 20 === 0) { const now = performance.now(); for (const [pid, c] of this.cracks) if (now - c.at > 20000) { this.dropCrack(c); this.cracks.delete(pid); } }
  }

  /* ---- what came from the others ---- */
  receive(m) {
    const g = this.net.game;
    if (!g || !g.ready || !Array.isArray(m.e) || m.d !== this.net.dimNow()) return;
    quiet++;
    const n0 = this.net.applying;
    this.net.applying = true;
    try {
      for (const e of m.e) { try { this.one(m.id, e); } catch (err) { console.warn(err); } }
    } finally { this.net.applying = n0; quiet--; }
  }
  one(pid, e) {
    const g = this.net.game, k = e[0], x = e[1], y = e[2], z = e[3];
    const L = g.sim && g.sim.lids;
    switch (k) {
      case 's': Sound.play(e[4], x, y, z, +e[5] || 1, +e[6] || 1, e[7] || 'block'); return;
      case 'lid': {
        if (!L) return;
        const key = x + ',' + y + ',' + z, mine = this.opened.get(pid) || new Set();
        this.opened.set(pid, mine);
        if (e[4]) { if (mine.has(key)) return; mine.add(key); L.open(x, y, z); }
        else { if (!mine.delete(key)) return; L.close(x, y, z); }
        return;
      }
      case 'ring': if (L) L.ring(x, y, z, e[4] | 0); return;
      case 'pot': if (L) L.wobble(x, y, z, !!e[4]); return;
      case 'note': {
        const P = this.net.ctx.renderer.particles, f = (e[4] | 0) / 24;
        const c = v => Math.max(0, Math.min(255, Math.round((Math.max(0, Math.sin((f + v) * Math.PI * 2) * 0.65 + 0.35)) * 255)));
        if (P && P.spawn) P.spawn(x + 0.5, y + 1.2, z + 0.5, 0, 0.06, 0, { colour: (c(0) << 16) | (c(1 / 3) << 8) | c(2 / 3), size: 0.18, life: 6, gravity: 0, physics: false });
        return;
      }
      case 'boom': this.boom(x, y, z, +e[4] || 4); return;
      case 'px': {
        const E = g.entities, c = e[7];
        if (E && FX[e[4]]) E.particles(e[4], x, y, z, Math.min(64, e[5] | 0) || 1, +e[6] || 0, typeof c === 'number' ? [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255] : undefined);
        return;
      }
      case 'splash': {
        const E = g.entities, name = String(e[4] || 'water');
        if (!E) return;
        const c = (POTIONS[name] || POTIONS.water || { colour: 0x385dc6 }).colour;
        E.particles('magic', x, y, z, 24, 0.5, [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]);
        E.particles('poof', x, y, z, 6, 0.2, [0.9, 0.9, 0.95]);
        // its colour, and what it does to you (not to the mobs here: their machines had it already; not to the blocks either)
        const harm = HARMFUL.test(name) && !(this.net.server && this.net.server.pvp);
        const m = Object.create(E, { forNear: { value: () => {} }, world: { value: null } });
        if (!e[5] && !harm && g.mode !== 'creative' && g.mode !== 'spectator') { try { splashPotion(m, x, y, z, name, null, null); } catch (err) { console.warn(err); } }
        return;
      }
      case 'tnt': {
        const BD = g.sim && g.sim.bodies, a = +e[5] || 0;
        if (BD && B.tnt !== undefined) BD.add({ kind: 'tnt', b: B.tnt, m: 0, x: x + 0.5, y, z: z + 0.5, vx: -Math.sin(a) * 0.02, vy: 0.2, vz: -Math.cos(a) * 0.02, fuse: Math.max(1, e[4] | 0), ghost: true });
        return;
      }
      case 'mine': this.crack(pid, x, y, z, e[4] | 0); return;
      // the fight in the End (endfight.js)
      case 'drg': case 'dhit': case 'xhit': case 'xtal': case 'xput': case 'xboom': case 'dfb': case 'dbr': if (this.net.end) this.net.end.one(e); return;
      case 'slide': {
        const V = g.sim && g.sim.redstone && g.sim.redstone.pistonView, b = B[e[4]];
        if (!V || b === undefined || this.slides.length > 256) return;
        const s = { x, y, z, b, m: e[5] | 0, facing: e[6] | 0, ext: !!e[7], src: !!e[8], p: 0, po: 0, ghost: true };
        V.add(s);
        this.slides.push(s);
        return;
      }
      case 'bob': {
        let b = this.bobs.get(pid);
        if (!e[4]) { if (b) { this.dropBob(b); this.bobs.delete(pid); } return; }
        if (!b) this.bobs.set(pid, b = { x, y, z, px: x, py: y, pz: z, line: null, mesh: null });
        b.px = b.x; b.py = b.y; b.pz = b.z; b.x = x; b.y = y; b.z = z; b.at = performance.now();
        return;
      }
    }
  }
  /* Someone else's explosion: its flash and smoke, and your share of it, by
     the game's numbers (the same as explosion.js: what of your box can see
     the centre, the hurt and the push by how near you are) */
  boom(x, y, z, power) {
    const g = this.net.game, E = g.entities, P = g.player;
    if (E) {
      E.particles(power >= 2 ? 'explosion_big' : 'explosion', x, y, z, 1, 0);
      E.particles('explosion', x, y, z, Math.round(power * 4), power * 0.6);
    }
    if (!E || g.mode === 'creative' || g.mode === 'spectator' || (g.survival && g.survival.dead)) return;
    const reach = power * 2, p = P.pos;
    const dist = Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2) / reach;
    if (dist > 1) return;
    let dx = p.x - x, dy = p.y + 1.62 - y, dz = p.z - z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl === 0) return;
    dx /= dl; dy /= dl; dz /= dl;
    const seen = exposure(g.world, x, y, z, [p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.y + 1.8, p.z + 0.3]);
    const impact = (1 - dist) * seen;
    const dmg = Math.floor((impact * impact + impact) / 2 * 7 * reach + 1);
    E.hurtPlayer(dmg, { type: 'explosion', x, z, noKnock: true, explosion: true });
    if (!P.flying) { P.vel.x += dx * impact; P.vel.y += dy * impact; P.vel.z += dz * impact; }
  }
  // another player's cracks on a block (stage -1: they stopped)
  crack(pid, x, y, z, s) {
    let c = this.cracks.get(pid);
    if (s < 0) { if (c) { this.dropCrack(c); this.cracks.delete(pid); } return; }
    const R = this.net.ctx.renderer, main = R.overlay, w = this.net.game.world;
    if (!main) return;
    if (!c) {
      const textures = {};
      main.stages.forEach((layer, i) => { textures['destroy_stage_' + i] = { layer }; });
      const ov = new Overlay(R.U, { textures });
      main.scene.add(ov.crack);
      c = { ov };
      this.cracks.set(pid, c);
      this.patchOverlay(main);
    }
    Object.assign(c, { x, y, z, s, at: performance.now() });
    const b = w.get(x, y, z), d = BLOCKS[b];
    if (!d) { c.ov.crack.visible = false; return; }
    const nb = (dx, dy, dz) => { const n = w.get(x + dx, y + dy, z + dz); return n ? { d: BLOCKS[n], m: w.meta(x + dx, y + dy, z + dz) } : null; };
    c.ov.set(x, y, z, selectionBoxes(d, w.meta(x, y, z), nb), s);
    c.ov.outline.visible = false;
  }
  dropCrack(c) {
    const ov = c.ov;
    if (ov.crack.parent) ov.crack.parent.remove(ov.crack);
    ov.crack.geometry.dispose(); ov.outline.geometry.dispose(); ov.outline.material.dispose(); ov.crackMat.dispose();
  }
  // the block outline's own pass draws the others' cracks too, whether or not you look at a block
  patchOverlay(main) {
    if (main.__net) return;
    main.__net = true;
    const render = main.render, ev = this;
    main.render = function (r, cam) {
      if (!this.crack.visible && !this.outline.visible && active === ev && ev.cracks.size) { r.render(this.scene, cam); return; }
      return render.call(this, r, cam);
    };
  }
  // a player gone: their lids shut and their cracks go
  left(pid) {
    const g = this.net.game, L = g && g.sim && g.sim.lids, mine = this.opened.get(pid);
    if (mine && L) { this.net.applying = true; try { for (const k of mine) { const [x, y, z] = k.split(',').map(Number); L.close(x, y, z); } } finally { this.net.applying = false; } }
    this.opened.delete(pid);
    const c = this.cracks.get(pid);
    if (c) { this.dropCrack(c); this.cracks.delete(pid); }
    const b = this.bobs.get(pid);
    if (b) { this.dropBob(b); this.bobs.delete(pid); }
  }
  dropBob(b) {
    for (const m of [b.line, b.mesh]) if (m) { if (m.parent) m.parent.remove(m); m.geometry.dispose(); m.material.dispose(); }
    b.line = b.mesh = null;
  }
  /* Another player's fishing line: a dark line from the tip of the rod in
     their hand, sagging a little, to their bobber (red over white, as the
     game's), eased between the positions they send */
  fishing(r, b, s) {
    const R = this.net.ctx.renderer;
    if (!b.line) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 9), 3));
      b.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
      b.line.frustumCulled = false;
      const mg = new THREE.BoxGeometry(0.16, 0.16, 0.16), col = new Float32Array(24 * 3);
      for (let i = 0; i < 24; i++) { const top = mg.attributes.position.getY(i) > 0; col.set(top ? [0.8, 0.1, 0.1] : [0.95, 0.95, 0.95], i * 3); }
      mg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      b.mesh = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ vertexColors: true }));
      R.scene.add(b.line, b.mesh);
    }
    const k = Math.min(1, (performance.now() - (b.at || 0)) / 100), bx = b.px + (b.x - b.px) * k, by = b.py + (b.y - b.py) * k, bz = b.pz + (b.z - b.pz) * k;
    b.mesh.position.set(bx, by + 0.08, bz);
    const f = r.feet, yaw = s.yaw, sn = Math.sin(yaw), cs = Math.cos(yaw), side = r.offId && !r.heldId ? -1 : 1;
    const tx = f.x - sn * 0.8 + cs * 0.35 * side, ty = f.y + (s.f & F.SNEAK ? 1.25 : 1.55), tz = f.z - cs * 0.8 - sn * 0.35 * side;
    const P = b.line.geometry.attributes.position;
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      P.setXYZ(i, tx + (bx - tx) * u, ty + (by - ty) * u - Math.sin(u * Math.PI) * 0.25, tz + (bz - tz) * u);
    }
    P.needsUpdate = true;
  }

  /* ---- every frame: the others eating and burning ---- */
  players(dt) {
    const net = this.net, g = net.game, list = net.players && net.players.list;
    if (!list || !g) return;
    // on fire: the game's flames over them, every frame, as over a burning mob
    const Pb = net.ctx.renderer.particles;
    if (Pb && Pb.burn) for (const r of list.values()) {
      const s = r.st, f = r.feet;
      if (s && f && s.f & F.FIRE && r.av && r.av.mesh.visible && !(s.f & F.INVIS)) Pb.burn(f.x, f.y, f.z, 0.6, s.f & F.SNEAK ? 1.5 : s.f & F.SWIM ? 0.6 : 1.8);
    }
    // their fishing lines, every frame (a line seen while its player is not drawn is hidden)
    for (const [pid, b] of this.bobs) {
      const r = list.get(pid), on = !!(r && r.st && r.feet && r.av && r.av.mesh.visible);
      if (on) this.fishing(r, b, r.st);
      if (b.line) b.line.visible = b.mesh.visible = on;
    }
    this.acc = (this.acc || 0) + dt;
    if (this.acc < 0.05) return;
    this.acc = 0;
    this.pt = (this.pt || 0) + 1;
    const D = g.drops, E = g.entities, Pa = net.ctx.renderer.particles;
    for (const r of list.values()) {
      const s = r.st, f = r.feet;
      if (!s || !f || !r.av || !r.av.mesh.visible) continue;
      const U = r.useNow;
      // the bits of food from their mouth, every fourth tick after the first seven (the game's)
      if (U && U.kind === 'eat' && (U.t || 0) > 7 && this.pt % 4 === 0 && D && D.crumbs) {
        const id = U.side ? r.offId : r.heldId, yaw = s.yaw, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
        if (id) D.crumbs(f.x + dx * 0.35, f.y + (s.f & F.SNEAK ? 1.15 : 1.45), f.z + dz * 0.35, id, 5, dx, dz);
      }
      // sprinting on the ground: a speck of what they run on, kicked back, each tick (the game's sprint particle)
      if ((s.f & (F.SPRINT | F.GROUND)) === (F.SPRINT | F.GROUND) && !(s.f & (F.SNEAK | F.SWIM | F.FLY)) && r.P && Pa && Pa.spawn) {
        const w = g.world, b = w && w.get(Math.floor(f.x), Math.floor(f.y - 0.2), Math.floor(f.z)), v = r.P.vel;
        if (b && BLOCKS[b] && BLOCKS[b].solid && (v.x * v.x + v.z * v.z) > 0.01) Pa.spawn(f.x + (Math.random() - 0.5) * 0.6, f.y + 0.1, f.z + (Math.random() - 0.5) * 0.6, -v.x * 0.6, 0.15, -v.z * 0.6, { block: b });
      }
    }
  }
}
