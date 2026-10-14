/* ---------------------------------------------------------------------------
   Leoncraft 2 multiplayer - the fight in the End, one fight for everyone.

   The dragon and its crystals are not mobs of the entity manager (dim/
   endfight.js, dim/dragon.js), so they are shared here. One machine runs the
   fight: of the players in the End, the one with the lowest number (every
   machine works out the same one; when they leave, the next takes over
   where the dragon is). It sends where the dragon is every third tick, its
   health, what it is doing and how far into dying, and the fight's record
   (killed, alive, which pillars have their crystal, which gateways are
   left, the portal: kept by the server as a detail at 0, 0, 0 of the End,
   so whoever comes to the End later finds the fight as it is).

   Everyone else draws that dragon: eased to each position over three
   ticks, red when hit, rising and bursting as it dies; its wings and head
   still knock and hurt your player, and its fireballs fly and its breath
   lies on every screen (the breath hurts whoever stands in it). A hit on it, an arrow, an explosion
   or a crystal you break is passed to the machine running the fight, which
   takes it as its own; a crystal going off there goes off on every screen,
   with its blast. The exit portal, the egg and the gateway the death opens
   are blocks, shared like any other; its experience falls as orbs anyone
   can pick up (mobs.js Orbs).

   An end crystal a player puts down (in the End to bring the dragon back,
   or anywhere as a blast) is put down on every screen; whoever breaks it
   sets it off on their machine, and it goes off on the others' with its
   blast. The machine running the fight starts a respawn when the four are
   on the portal, whoever put them there.
--------------------------------------------------------------------------- */
import { F } from './players.js?v=56';
import { EndCrystal, DragonFireball, BreathCloud } from '../dim/entities.js?v=56';

const PHASES = ['holding', 'strafe', 'approach', 'landing', 'scanning', 'roar', 'flame', 'takeoff', 'charge', 'dying'];
const KEY = '0,0,0';
const wrapA = a => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

export class EndSync {
  constructor(net) {
    this.net = net;
    this.F = null;            // the End's fight on this machine, when you are there
    this.running = null;      // whether this machine runs it (null: not worked out yet)
    this.got = null;          // the newest of the dragon from the machine running the fight
    this.seen = null;         // the record last taken from the server
    this.sig = '';
    this.t = 0;
    this.applying = false;
  }
  // the fight's record as the server keeps it
  get state() { const M = this.net.dt && this.net.dt[2], o = M && M.get(KEY); return o && o.k === 'ef' && o.s && typeof o.s === 'object' ? o.s : null; }
  send(e) { if (this.net.events) this.net.events.send(e); }

  /* ---- the realms (dim/realms.js): the End's fight made from the shared record ---- */
  hook(RL) {
    if (!RL || RL.__netEnd) return;
    RL.__netEnd = true;
    const me = this, entered = RL.entered;
    RL.entered = function () {
      const s = me.state;
      if (this.dim === 'the_end' && s) this.fightState = JSON.parse(JSON.stringify(s));
      const r = entered.apply(this, arguments);
      me.attach(this.fight);
      return r;
    };
    // an end crystal put down here: on the others' screens too
    const add = RL.add;
    RL.add = function (e) {
      const r = add.apply(this, arguments);
      if (e instanceof EndCrystal && e.pillar < 0 && !me.applying) me.send(['xput', e.pos.x, e.pos.y, e.pos.z]);
      // the dragon's fireballs and its breath, from the machine running the fight
      const r2 = v => Math.round(v * 100) / 100;
      if (e instanceof DragonFireball && !me.applying) me.send(['dfb', r2(e.pos.x), r2(e.pos.y), r2(e.pos.z), r2(e.dir.x), r2(e.dir.y), r2(e.dir.z)]);
      if (e instanceof BreathCloud && !me.applying) me.send(['dbr', r2(e.pos.x), r2(e.pos.y), r2(e.pos.z), r2(e.radius), Math.round(e.grow * 1e5), e.life | 0, e.damage | 0]);
      return r;
    };
    // one broken here (not a pillar's: whoever runs the fight has those): set off here, and gone with its blast for the others
    const destroyed = RL.crystalDestroyed;
    RL.crystalDestroyed = function (c, source) {
      if (c.pillar < 0) { if (me.applying) return; me.send(['xboom', c.pos.x, c.pos.y, c.pos.z]); }
      return destroyed.apply(this, arguments);
    };
    // (already in the End as you join: the fight made from this browser's record is put right)
    if (RL.fight) { me.attach(RL.fight); const s = me.state; if (s) { me.seen = null; me.take(s); } }
  }
  attach(F) {
    this.F = F || null; this.running = null; this.got = null; this.sig = '';
    if (!F || F.__net) return;
    F.__net = true;
    const me = this, net = this.net;
    // not running it: only its start here (the crystals and the dragon as the record has them), never a respawn of its own
    const tick = F.tick;
    F.tick = function () {
      if (me.running !== false) return tick.apply(this, arguments);
      const r = this.s.respawn;
      this.s.respawn = null;
      try { return tick.apply(this, arguments); } finally { this.s.respawn = r; }
    };
    // a crystal broken here: by whoever runs the fight
    const destroyed = F.crystalDestroyed;
    F.crystalDestroyed = function (c, source) {
      if (me.running === false && !me.applying && c.pillar >= 0) {
        this.s.crystals[c.pillar] = false; me.send(['xhit', c.pos.x, c.pos.y, c.pos.z, c.pillar]);
        return;
      }
      const r = destroyed.apply(this, arguments);
      if (c.pillar >= 0 && !me.applying) me.send(['xtal', c.pos.x, c.pos.y, c.pos.z, c.pillar]);
      return r;
    };
    // its experience as orbs everyone shares (drops.js, mobs.js Orbs)
    const dropXp = F.dropXp;
    F.dropXp = function (pos, n) {
      const g = net.game, D = g && g.drops;
      if (D && net.orbs && net.orbs.on) { D.xp(pos.x + (Math.random() - 0.5) * 2, pos.y + 1, pos.z + (Math.random() - 0.5) * 2, n); return; }
      return dropXp.apply(this, arguments);
    };
  }
  // whether this machine runs the fight: the lowest numbered player alive in the End
  runner() {
    const net = this.net, list = net.players && net.players.list;
    if (!list) return true;
    for (const r of list.values()) { const s = r.st; if (s && s.d === 2 && !(s.f & (F.DEAD | F.SPEC)) && r.id < net.id) return false; }
    return true;
  }

  /* ---- each tick, in the End ---- */
  tick() {
    const net = this.net, g = net.game, F = this.F;
    if (!g || g.dim !== 'the_end' || !F || !net.events || !net.events.on) return;
    this.t++;
    const run = this.runner();
    this.running = run;
    // (a dragon made here since, or a change of who runs the fight: run here or drawn, as it should be)
    if (F.dragon && !!F.dragon.__puppet !== !run) this.dragonMode();
    if (run) {
      // the dragon, every third tick
      const d = F.dragon;
      if (d && !d.dead && this.t % 3 === 0) {
        const r2 = v => Math.round(v * 100) / 100;
        this.send(['drg', r2(d.pos.x), r2(d.pos.y), r2(d.pos.z), Math.round(wrapA(d.yaw) * 1000) / 1000, Math.round(d.health * 10) / 10, Math.max(0, PHASES.indexOf(d.phase)), d.deathTime | 0, d.hurtTime > 0 ? 1 : 0]);
      }
      // the record, when it changed
      if (this.t % 20 === 0) {
        const s = F.state(), str = JSON.stringify(s);
        if (str !== this.sig) {
          this.sig = str;
          const o = { k: 'ef', s: JSON.parse(str) };
          if (net.dt && net.dt[2]) net.dt[2].set(KEY, o);
          net.send({ t: 'dt', d: 2, p: [0, 0, 0], o });
        }
      }
    } else if (this.t % 10 === 0) {
      const s = this.state;
      if (s && s !== this.seen) this.take(s);
    }
  }
  // the record from the machine running the fight, put into this one's
  take(s) {
    const F = this.F;
    this.seen = s;
    if (!F) return;
    this.applying = true;
    try {
      const keep = F.started;
      Object.assign(F.s, JSON.parse(JSON.stringify(s)));
      if (keep) {
        F.crystals.forEach((c, i) => { if (c && !c.dead && !F.s.crystals[i]) c.dead = true; });
        // (a respawn put the pillars' crystals back: one the record had gone and has again; not one only just broken here)
        const was = this.lastCrystals;
        F.s.crystals.forEach((on, i) => { const c = F.crystals[i]; if (on && was && was[i] === false && (!c || c.dead) && F.spikes[i]) F.spawnCrystal(i); });
        if (!F.s.alive && F.dragon) { F.dragon.dead = true; F.dragon = null; }
        else if (F.s.alive && !F.dragon && F.started) { F.spawnDragon(F.s.health); this.dragonMode(); }
      }
    } finally { this.applying = false; }
    this.lastCrystals = Array.isArray(s.crystals) ? s.crystals.slice() : null;
  }
  // the dragon here: run by this machine, or drawn from the one that runs the fight
  dragonMode() {
    const d = this.F && this.F.dragon, me = this;
    if (!d) return;
    if (this.running !== false) { if (d.__puppet) { d.__puppet = false; delete d.tick; delete d.hurt; } return; }
    if (d.__puppet) return;
    d.__puppet = true;
    const proto = Object.getPrototypeOf(d), base = Object.getPrototypeOf(proto);
    d.tick = function () {
      base.tick.call(this);
      this.prevYaw = this.yaw;
      if (this.hurtTime > 0) this.hurtTime--;
      const s = me.got;
      if (s) {
        // eased to the newest over the ticks till the next, as the game moves what the server sends
        if (s.steps > 0) {
          const k = 1 / s.steps;
          this.pos.x += (s.x - this.pos.x) * k; this.pos.y += (s.y - this.pos.y) * k; this.pos.z += (s.z - this.pos.z) * k;
          this.yaw += wrapA(s.yaw - this.yaw) * k;
          s.steps--;
        }
        this.health = s.health;
        const ph = PHASES[s.phase] || 'holding';
        if (ph !== this.phase) { this.phase = ph; this.phaseT = 0; if (ph === 'dying') this.beams.visible = true; }
        if (ph === 'dying') {
          this.deathTime = Math.max(this.deathTime | 0, s.deathTime);
          if (this.deathTime % 4 === 0) { const b = this.partBoxes()[2].box; this.R.burst((b[0] + b[3]) / 2 + (Math.random() - 0.5) * 8, b[1] + Math.random() * 4, (b[2] + b[5]) / 2 + (Math.random() - 0.5) * 8, 2); }
          this.deathTime++;
          return;
        }
      }
      // its wings and head still knock and hurt you (contact: your player only)
      this.contact();
    };
    // your hit on it: for the machine that runs the fight to take (red here at once)
    d.hurt = function (amount, part, source) {
      if (this.phase === 'dying' || this.dead || !(amount > 0)) return false;
      me.send(['dhit', this.pos.x, this.pos.y, this.pos.z, Math.round(amount * 1000) / 1000, part ? String(part) : '', String(source || 'player')]);
      if (this.invul <= 10) { this.hurtTime = 10; this.invul = 20; }
      return true;
    };
  }

  /* ---- what came from the others (events.js) ---- */
  one(e) {
    const F = this.F, k = e[0], RL = this.net.game && this.net.game.realms;
    if (k === 'xput' && RL) {
      // another player's end crystal: here too (and with four on the portal, the machine running the fight brings the dragon back)
      if (RL.entities.some(c => c instanceof EndCrystal && !c.dead && Math.abs(c.pos.x - e[1]) < 0.5 && Math.abs(c.pos.y - e[2]) < 0.5 && Math.abs(c.pos.z - e[3]) < 0.5)) return;
      const c = new EndCrystal(RL, { base: false });
      c.at(e[1], e[2], e[3]);
      this.applying = true;
      try { RL.add(c); } finally { this.applying = false; }
      if (F && this.running) F.tryRespawn();
      return;
    }
    if ((k === 'dfb' || k === 'dbr') && RL && this.net.game.dim === 'the_end') {
      // the dragon's fireball (it flies here, but bursts into nothing: the breath it leaves comes from the machine running the fight) and its breath
      let x;
      if (k === 'dfb') { x = new DragonFireball(RL, new window.THREE.Vector3(+e[4] || 0, +e[5] || 0, +e[6] || 0)); x.burst = function () { this.dead = true; }; }
      else x = new BreathCloud(RL, { radius: +e[4] || 3, grow: (+e[5] || 0) / 1e5, life: e[6] | 0, damage: e[7] | 0 });
      x.at(e[1], e[2], e[3]);
      this.applying = true;
      try { RL.add(x); } finally { this.applying = false; }
      return;
    }
    if (k === 'xboom' && RL) {
      const c = RL.entities.find(c => c instanceof EndCrystal && !c.dead && c.pillar < 0 && Math.abs(c.pos.x - e[1]) < 0.5 && Math.abs(c.pos.y - e[2]) < 0.5 && Math.abs(c.pos.z - e[3]) < 0.5);
      if (c) c.dead = true;
      if (this.net.events) this.net.events.boom(e[1], e[2] + 1, e[3], 6);
      if (RL.burst) RL.burst(e[1], e[2] + 1, e[3], 4.8);
      return;
    }
    if (!F) return;
    if (k === 'drg') {
      if (this.running !== false) return;
      this.got = { x: e[1], y: e[2], z: e[3], yaw: +e[4] || 0, health: +e[5] || 0, phase: e[6] | 0, deathTime: e[7] | 0, steps: 3 };
      if (!F.dragon && F.started && (+e[5] > 0)) { F.spawnDragon(+e[5]); this.dragonMode(); const d = F.dragon; if (d) { d.pos.set(e[1], e[2], e[3]); d.prev.copy(d.pos); } }
      if (F.dragon && e[8]) { F.dragon.hurtTime = Math.max(F.dragon.hurtTime, 9); }
      return;
    }
    if (k === 'dhit') {
      // a hit from another player: taken here, as if it were yours
      const d = F.dragon;
      if (this.running !== false && d && !d.dead && !d.__puppet) d.hurt(+e[4] || 0, e[5] ? String(e[5]) : null, String(e[6] || 'player'));
      return;
    }
    if (k === 'xhit') {
      const c = F.crystals[e[4] | 0];
      if (this.running !== false && c && !c.dead) c.hurt(1, 'player');
      return;
    }
    if (k === 'xtal') {
      // a crystal gone off on the machine running the fight: gone here too, with its blast for you
      const i = e[4] | 0, c = F.crystals[i];
      if (this.running !== false) return;
      F.s.crystals[i] = false;
      if (c && !c.dead) c.dead = true;
      if (this.net.events) this.net.events.boom(e[1], e[2] + 1, e[3], 6);
      if (this.F.R && this.F.R.burst) this.F.R.burst(e[1], e[2] + 1, e[3], 4.8);
    }
  }
}
