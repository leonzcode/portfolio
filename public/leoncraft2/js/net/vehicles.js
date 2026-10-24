/* ---------------------------------------------------------------------------
   Leoncraft 2 multiplayer - boats and minecarts everyone shares.

   A boat or a minecart put down on a server is everyone's, as in the game:
   the server numbers it and keeps it with the world (lc2.js vehicleMsg), and
   every machine near it has a copy in its own entity list. One machine moves
   it, with the game's own boat and minecart code: the one steering it (its
   front seat), or when nobody is, the last one that did, so an empty boat
   drifts to a stop. That machine sends where it is on each tick it moves;
   the others play those positions back a tick at a time (a ghost: its own
   physics off), so it glides as it does for the one in it.

   Seats are the server's to give, so two players getting in at once end up
   one in each. Another player in a seat is a stand-in in the vehicle's list
   of passengers, which is what puts everyone in the right seat (a boat's
   front and back) and draws them sitting in it on every screen (players.js
   seatOf). Getting out of the front seat moves the one behind up to steer.
   Anyone can break one; a chest boat's chest goes to the others whenever it
   changes. Mobs riding in one stay on the machine they are on.
--------------------------------------------------------------------------- */
import { Boat } from '../entities/boat.js?v=107';
import { Minecart } from '../entities/minecart.js?v=107';
import { wrap } from '../entities/entity.js?v=107';
import { stackToJSON, stackFromJSON } from '../items.js?v=107';

const THREE = window.THREE;

const r3 = v => Math.round(v * 1000) / 1000;
// a boat of any wood or kind, and a plain minecart (the carts with a chest, a hopper or a furnace stay on the machine they are on)
const shareable = e => e instanceof Boat || (e instanceof Minecart && e.type === 'minecart');
const jsonOf = e => { const o = Object.getPrototypeOf(e).toJSON.call(e); delete o.pr; delete o.ps; return o; };

export class Vehicles {
  constructor(net) {
    this.net = net;
    this.recs = new Map();       // number -> { id, d, j, s: [x, y, z, yaw, rowing], n, by, seats: [player ids], e, q }
    this.byKey = new Map();      // what this machine put down, until the server numbers it
    this.key = 0;
    this.out = [];
    this.riding = new Map();     // another player's number -> { v, s }: what they sit in, and where
    this.stands = new Map();     // another player's number -> their stand-in in a vehicle's passengers
    this.applying = false;
    this.unloading = false;
    this.t = 0;
  }
  init(m) {
    for (const o of m.vehicles || []) this.keep(o);
  }
  keep(o) {
    if (!o || !(o.id > 0) || !o.j || !Array.isArray(o.s)) return null;
    const rec = { id: o.id, d: o.d | 0, j: o.j, s: o.s, n: o.n === 1 ? 1 : 2, by: o.by | 0, seats: Array.isArray(o.seats) ? o.seats.slice() : [], e: null, q: [] };
    this.recs.set(o.id, rec);
    rec.seats.forEach((p, i) => { if (p && p !== this.net.id) this.riding.set(p, { v: rec.id, s: i }); });
    return rec;
  }

  /* ---- the entity manager of the dimension you are in ---- */
  hook(E) {
    const V = this, net = this.net;
    this.E = E;
    for (const rec of this.recs.values()) rec.e = null;
    // what this browser kept from before (its own boats, in its entity store) is not the server's: gone
    this.applying = true;
    try {
      for (const e of E.list.slice()) if (shareable(e) && !e.nv) { if (E.riding === e) E.dismount(); e.remove(); }
      for (const [k, a] of E.stored) E.stored.set(k, a.filter(o => !/(^boat$|_boat$|_raft$|^minecart$)/.test(o.t)));
    } finally { this.applying = false; }
    const spawn = E.spawn;
    E.spawn = function (type, x, y, z, o) {
      const e = spawn.call(this, type, x, y, z, o);
      if (e && !V.applying && !net.closed && shareable(e)) V.made(e);
      return e;
    };
    const mount = E.mount, dismount = E.dismount;
    E.mount = function (v) {
      const rec = v && v.nv ? V.recs.get(v.nv) : null;
      if (!rec || V.applying) return mount.call(this, v);
      if (!mount.call(this, v)) return false;
      // the front seat if nobody else is in it (it steers), else the one behind; the server says which in the end
      const s = rec.seats[0] && rec.seats[0] !== net.id ? 1 : 0;
      V.seat(rec, net.id, s, s === 0 ? net.id : rec.by);
      net.send({ t: 'vr', id: rec.id, s });
      return true;
    };
    E.dismount = function () {
      const v = this.riding, rec = v && v.nv ? V.recs.get(v.nv) : null;
      const r = dismount.apply(this, arguments);
      if (rec && !V.applying) { V.unseat(rec, net.id); net.send({ t: 'vr', id: 0 }); }
      return r;
    };
    // (what goes out of reach is put away, not broken)
    const chunks = E.chunks;
    E.chunks = function () { V.unloading = true; try { return chunks.apply(this, arguments); } finally { V.unloading = false; } };
    const render = E.render;
    E.render = function (a) { V.alpha = a; return render.apply(this, arguments); };
  }
  // put down on this machine: sent at the end of the tick, when its wood and chest are set
  made(e) {
    e.nk = ++this.key;
    e.toJSON = undefined;              // (not kept in this browser's entity store: the server keeps it)
    this.byKey.set(e.nk, e);
    this.out.push(e);
  }
  // a record made into an entity here, as the server has it
  adopt(e, rec) {
    const V = this;
    rec.e = e; rec.q = []; e.nv = rec.id; e.nk = 0;
    e.toJSON = undefined;
    // broken here (by a hit, lava, a fall): broken for everyone; put away out of reach: only forgotten here
    e.remove = function () {
      Object.getPrototypeOf(this).remove.call(this);
      if (rec.e !== this) return;
      rec.e = null;
      if (V.unloading || V.applying || !V.E || V.E.gone || V.net.closed) return;
      V.recs.delete(rec.id);
      V.net.send({ t: 'v-', id: rec.id });
    };
    if (rec.by !== this.net.id) this.ghost(rec);
    this.seats(rec);
  }
  /* Someone else's to move: each tick, the next of the positions they sent
     (a tick or two in hand; more than four behind, it catches up). It still
     takes hits and carries whoever sits in it. */
  ghost(rec) {
    const e = rec.e;
    if (!e || e.ghost) return;
    e.ghost = true;
    e.tick = function () {
      this.prev.copy(this.pos); this.prevYaw = this.yaw;
      if (this.prevPaddle) { this.prevPaddle[0] = this.paddle[0]; this.prevPaddle[1] = this.paddle[1]; }
      this.age++;
      if (this.hurtTime > 0) this.hurtTime--;
      if (this.damage > 0) this.damage--;
      const q = rec.q;
      while (q.length > 4) q.shift();
      const s = q.length ? q.shift() : null;
      this.yawDelta = 0;
      if (s) {
        this.vel.set(s[0] - this.pos.x, s[1] - this.pos.y, s[2] - this.pos.z);
        this.pos.set(s[0], s[1], s[2]);
        this.yawDelta = wrap(s[3] - this.yaw); this.yaw = s[3];
        if (this.paddle) { const w = s[4] | 0; this.rowing[0] = !!(w & 1); this.rowing[1] = !!(w & 2); }
      } else this.vel.set(0, 0, 0);
      if (this.paddle) for (let i = 0; i < 2; i++) this.paddle[i] = this.rowing[i] ? this.paddle[i] + Math.PI / 8 : 0;
    };
  }
  // yours to move now (you steer it, or the one who did got out and you are the one behind)
  unghost(rec) {
    const e = rec.e;
    if (!e || !e.ghost) return;
    e.ghost = false;
    delete e.tick;
    e.vel.set(0, 0, 0);
  }

  /* ---- seats ---- */
  seat(rec, pid, s, by) {
    for (let i = 0; i < rec.seats.length; i++) if (rec.seats[i] === pid) rec.seats[i] = 0;
    rec.seats[s] = pid;
    rec.by = by;
    if (pid !== this.net.id) this.riding.set(pid, { v: rec.id, s });
    if (rec.by === this.net.id) this.unghost(rec); else this.ghost(rec);
    this.seats(rec);
  }
  unseat(rec, pid) {
    for (let i = 0; i < rec.seats.length; i++) if (rec.seats[i] === pid) rec.seats[i] = 0;
    this.riding.delete(pid);
    this.seats(rec);
  }
  // the vehicle's passengers as the seats say: you, stand-ins for the others, then any mob in it
  seats(rec) {
    const e = rec.e, E = this.E;
    if (!e || e.removed || !E) return;
    const me = E.player, mobs = e.passengers.filter(p => !p.remoteRider && p !== me), list = [];
    for (const pid of rec.seats) {
      if (!pid) continue;
      if (pid === this.net.id) { if (E.riding === e) list.push(me); }
      else list.push(this.standIn(pid, e));
    }
    if (E.riding === e && list.indexOf(me) < 0) list.unshift(me);
    for (const p of e.passengers) if (p.remoteRider && list.indexOf(p) < 0) p.vehicle = null;
    e.passengers.length = 0;
    e.passengers.push(...list, ...mobs);
  }
  standIn(pid, e) {
    let s = this.stands.get(pid);
    if (!s) {
      s = { remoteRider: pid, isPlayer: false, type: 'player', w: 0.6, h: 1.8, hw: 0.3, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(),
        yaw: 0, bodyYaw: 0, headYaw: 0, passengers: [], removed: false, dead: false, vehicle: null, setPos(x, y, z) { this.pos.set(x, y, z); } };
      this.stands.set(pid, s);
    }
    s.vehicle = e;
    if (!s.placed) { s.pos.copy(e.pos); s.placed = true; }
    return s;
  }
  /* Where another player sits, for drawing them (players.js): their seat in
     this machine's copy of what they ride, moved on with it to this frame. */
  seatOf(r) {
    const on = this.riding.get(r.id), rec = on && this.recs.get(on.v), e = rec && rec.e, s = this.stands.get(r.id);
    if (!e || e.removed || !s || s.vehicle !== e || e.passengers.indexOf(s) < 0) return null;
    const a = this.alpha === undefined ? 1 : this.alpha;
    const out = this.seatOut || (this.seatOut = { x: 0, y: 0, z: 0, v: null });
    out.x = e.prev.x + (e.pos.x - e.prev.x) * a + (s.pos.x - e.pos.x);
    // (a player sits 0.6 into their seat: the stand-in is put at the seat itself)
    out.y = e.prev.y + (e.pos.y - e.prev.y) * a + (s.pos.y - e.pos.y) - 0.6;
    out.z = e.prev.z + (e.pos.z - e.prev.z) * a + (s.pos.z - e.pos.z);
    out.v = e;
    return out;
  }
  // a player who left the server: out of their seat
  left(pid) {
    for (const rec of this.recs.values()) if (rec.seats.indexOf(pid) >= 0) this.unseat(rec, pid);
    this.stands.delete(pid);
  }

  /* ---- each tick ---- */
  tick(dim) {
    const net = this.net, E = this.E;
    if (!E || E.gone) return;
    // what you put down this tick, to the server
    for (const e of this.out) {
      if (e.removed || !e.nk) continue;
      const j = jsonOf(e);
      net.send({ t: 'v+', k: e.nk, d: dim, j, s: [r3(e.pos.x), r3(e.pos.y), r3(e.pos.z), r3(e.yaw), 0], n: e.seats !== undefined ? e.seats : 1 });
    }
    this.out.length = 0;
    const P = net.game.player.pos, far = Math.max(64, (net.ctx.renderer.opts.renderDist || 8) * 16);
    const look = ++this.t % 10 === 0, chest = this.t % 20 === 0;
    for (const rec of this.recs.values()) {
      if (rec.d !== dim) continue;
      const e = rec.e;
      if (!e || e.removed) {
        // one near enough, in ground that is there: made here
        if (look && Math.abs(rec.s[0] - P.x) < far && Math.abs(rec.s[2] - P.z) < far && net.game.world.loaded(Math.floor(rec.s[0]), Math.floor(rec.s[2]))) this.make(rec);
        continue;
      }
      // yours to move: where it is, when it moved
      if (rec.by === net.id && !e.ghost) {
        const w = e.rowing ? (e.rowing[0] ? 1 : 0) | (e.rowing[1] ? 2 : 0) : 0;
        const s = [r3(e.pos.x), r3(e.pos.y), r3(e.pos.z), r3(e.yaw), w];
        if (s.some((v, i) => v !== rec.s[i])) { rec.s = s; net.send({ t: 'vs', id: rec.id, s }); }
      }
      // a chest boat's chest, when it changed here
      if (chest && e.slots && e.chest) {
        const i = e.slots.map(stackToJSON), sig = JSON.stringify(i);
        if (rec.slotSig === undefined) rec.slotSig = sig;
        else if (sig !== rec.slotSig) { rec.slotSig = sig; net.send({ t: 'vj', id: rec.id, i }); }
      }
    }
  }
  make(rec) {
    const E = this.E;
    let e = null;
    this.applying = true;
    try { e = E.spawn(rec.j.t, rec.s[0], rec.s[1], rec.s[2], { json: rec.j, natural: false }); } catch (err) { e = null; } finally { this.applying = false; }
    if (!e) return;
    e.setPos(rec.s[0], rec.s[1], rec.s[2]); e.prev.copy(e.pos);
    e.yaw = e.prevYaw = rec.s[3] || 0;
    e.vel.set(0, 0, 0);
    if (e.slots && e.chest) rec.slotSig = JSON.stringify(e.slots.map(stackToJSON));
    this.adopt(e, rec);
  }

  /* ---- what the server says ---- */
  receive(m) {
    const net = this.net;
    switch (m.t) {
      case 'v=': {
        const e = this.byKey.get(m.k);
        if (!e) return;
        this.byKey.delete(m.k);
        if (!m.id) { delete e.toJSON; e.nk = 0; return; }   // (not kept: it stays this machine's own)
        const rec = this.keep({ id: m.id, d: net.dimNow(), j: jsonOf(e), s: [r3(e.pos.x), r3(e.pos.y), r3(e.pos.z), r3(e.yaw), 0], n: e.seats !== undefined ? e.seats : 1, by: net.id, seats: [] });
        if (e.removed) { this.recs.delete(m.id); net.send({ t: 'v-', id: m.id }); return; }
        this.adopt(e, rec);
        // (got into it before the number came back: the seat asked for now)
        if (this.E && this.E.riding === e) { this.seat(rec, net.id, 0, net.id); net.send({ t: 'vr', id: rec.id, s: 0 }); }
        return;
      }
      case 'v+': this.keep(m.v); return;
      case 'vs': {
        const rec = this.recs.get(m.id);
        if (!rec || !Array.isArray(m.s)) return;
        rec.s = m.s;
        // (a page not ticking, hidden, keeps only the newest few)
        if (rec.e && rec.e.ghost) { rec.q.push(m.s); if (rec.q.length > 8) rec.q.shift(); }
        return;
      }
      case 'vc': {
        const rec = this.recs.get(m.id);
        if (rec) { rec.by = m.by | 0; if (rec.by !== net.id) this.ghost(rec); }
        return;
      }
      case 'vr': {
        const pid = m.p | 0, rec = m.id ? this.recs.get(m.id) : null;
        if (pid === net.id) {
          if (!rec) return;
          // turned away (full): back out, without asking again
          if (m.s < 0) {
            if (this.E && this.E.riding === rec.e) { this.applying = true; try { this.E.dismount(); } finally { this.applying = false; } }
            this.unseat(rec, pid);
            rec.by = m.by | 0;
            if (rec.by !== net.id) this.ghost(rec);
            return;
          }
          this.seat(rec, pid, m.s | 0, m.by | 0);
          return;
        }
        for (const r of this.recs.values()) if (r.seats.indexOf(pid) >= 0 && r !== rec) this.unseat(r, pid);
        if (!rec) { this.riding.delete(pid); return; }
        this.seat(rec, pid, m.s | 0, m.by | 0);
        return;
      }
      case 'vj': {
        const rec = this.recs.get(m.id);
        if (!rec || !Array.isArray(m.i)) return;
        rec.j = Object.assign({}, rec.j, { items: m.i });
        const e = rec.e;
        if (e && e.slots) { for (let i = 0; i < e.slots.length; i++) e.slots[i] = stackFromJSON(m.i[i]); rec.slotSig = JSON.stringify(e.slots.map(stackToJSON)); if (net.ctx.gui.isOpen()) net.ctx.gui.markDirty(); }
        return;
      }
      case 'v-': {
        const rec = this.recs.get(m.id);
        if (!rec) return;
        this.recs.delete(m.id);
        const e = rec.e, E = this.E;
        if (!e || e.removed || !E) return;
        this.applying = true;
        try {
          if (E.riding === e) E.dismount();
          if (E.particles) E.particles('poof', e.pos.x, e.pos.y + 0.3, e.pos.z, 10, 0.6);
          e.remove();
        } finally { this.applying = false; }
        return;
      }
    }
  }
}
