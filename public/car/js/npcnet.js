// Earth Drive multiplayer: the same traffic and pedestrians for everyone near each other (mp.js makes this). The
// server picks, for each group of players close together, the page that runs them (the earliest joiner of the
// group: the "owner"); that page runs traffic.js and peds.js as in single player and sends what they are doing about
// 8 times a second (only what changed, everything every 2 s); the other pages near it draw the same cars and people
// from that ("puppets": a stand-in for traffic.js that only draws what it is sent, and peds.js with its own thinking
// swapped for following the owner's). What a puppet page does to them goes to the owner: a car taken (E), a car
// bumped, a person hit (thrown on this screen at once, and on the owner's, which tells everyone else). Crashes into
// traffic cars go to the whole room as damage.js impacts by the car's shared number (mp.js). When the owner leaves
// or drives away, the next page runs them, starting from the cars and people it was drawing.
import * as THREE from 'three';
import { People } from './people.js?v=47';
import { Person } from './person.js?v=47';

const SEND_MS = 125, FULL_MS = 2000, PED_EVERY = 2; // cars 8 a second, people 4 a second, everything every 2 s
const SEND_R = 360;                                  // what is sent: within this many metres of the owner
const DELAY = 160;
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;

// a ragdoll started on the page that runs the pedestrians is told to the others, with the throw that started it
let patched = false;
function patchRagdoll() {
  if (patched || !Person || !Person.prototype || !Person.prototype.ragdoll) return;
  patched = true;
  const orig = Person.prototype.ragdoll;
  Person.prototype.ragdoll = function (velocity, spin, opts = {}) {
    try { this._netRag = { t: performance.now(), v: velocity ? [r2(velocity.x), r2(velocity.y), r2(velocity.z)] : [0, 0, 0], s: spin ? [r2(spin.x), r2(spin.y), r2(spin.z)] : null, low: opts.low ?? null, sh: opts.shift ? [r2(opts.shift.x), r2(opts.shift.y), r2(opts.shift.z)] : null }; } catch (e) {}
    return orig.call(this, velocity, spin, opts);
  };
}

// ------------------------------------------------------------------------------------------------------------
// the traffic as drawn from another page's (duck-typed like traffic.js's Traffic for the rest of the game)

class PuppetTraffic {
  constructor(N) {
    this.N = N; const D = N.D; this.D = D;
    this.scene = D.scene; this.C = D.mods.cars; this.carEnv = D.carEnv;
    this.list = []; this.byNid = new Map(); this.pool = new Map(); this.taken = new Set();
    this.group = new THREE.Group(); this.group.name = 'traffic-puppets'; D.scene.add(this.group);
    this.puppet = true; this.dead = false; this.off = undefined;
  }
  // from the owner's message: each car [nid, model, colour, x, y, z, yaw, pitch, speed, signal, brake]
  take(m, now) {
    const o = now - m.ts; this.off = this.off === undefined ? o : Math.min(o, this.off + 0.5);
    const seen = m.full ? new Set() : null;
    for (const a of m.c || []) {
      const nid = a[0]; if (this.taken.has(nid)) continue;
      if (seen) seen.add(nid);
      let c = this.byNid.get(nid);
      if (!c) { c = this.make(nid, a[1], a[2]); if (!c) continue; }
      c.buf.push({ ts: m.ts, x: a[3], y: a[4], z: a[5], yaw: a[6], pitch: a[7], v: a[8] });
      if (c.buf.length > 16) c.buf.shift();
      c.signal = a[9] || 0; c.brake = a[10] || 0; c.seenAt = now;
    }
    for (const nid of m.x || []) { const c = this.byNid.get(nid); if (c) this.drop(c); }
    if (seen) for (const c of [...this.byNid.values()]) if (!seen.has(c.nid)) this.drop(c);
  }
  make(nid, model, color) {
    if (!this.C || !this.C.CARS.find(c => c.id === model)) return null;
    const c = { nid, model, color, rig: null, buf: [], x: 0, y: 0, z: 0, yaw: 0, offYaw: 0, pitch: 0, v: 0, push: new THREE.Vector2(), off: new THREE.Vector2(), spinV: 0, hitT: 0, len: 4.6, spin: 0, signal: 0, brake: 0, puppet: true, seenAt: 0 };
    this.byNid.set(nid, c);
    this.getRig(model, color).then(rig => {
      if (this.dead || this.byNid.get(nid) !== c) { if (rig) this.freeRig(rig); return; }
      c.rig = rig; c.len = rig.dims ? rig.dims.length : 4.6;
      this.group.add(rig.object);
      this.list.push(c);
    }).catch(e => { console.warn('puppet car', model, e); });
    return c;
  }
  async getRig(model, color) {
    const k = model + ':' + color, free = this.pool.get(k);
    if (free && free.length) return free.pop();
    const rig = await this.C.loadCar(model, { npc: true, color });
    if (this.carEnv && rig.setEnvMap) rig.setEnvMap(this.carEnv);
    rig.modelId = model; rig.poolKey = k;
    return rig;
  }
  freeRig(rig) {
    this.group.remove(rig.object);
    if (rig.onFree) { try { rig.onFree(); } catch (e) {} }
    const k = rig.poolKey || rig.modelId;
    if (!this.pool.has(k)) this.pool.set(k, []);
    this.pool.get(k).push(rig);
  }
  drop(c) {
    this.byNid.delete(c.nid);
    const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1);
    if (c.rig) this.freeRig(c.rig);
    c.rig = null;
  }
  update(dt) {
    if (this.dead) return;
    const now = performance.now(), T = now - (this.off || 0) - DELAY;
    for (const c of [...this.byNid.values()]) {
      if (!c.rig) continue;
      // taken by this page's player (onfoot.js took it out of the list): the owner is told, and it is ours now
      if (!this.list.includes(c)) { this.byNid.delete(c.nid); this.taken.add(c.nid); this.N.send('take', { id: c.nid }); continue; }
      // someone is at its door (E): it stops here, and the owner lets it go
      if (c.held) { if (!c.heldSent) { c.heldSent = true; this.N.send('take', { id: c.nid }); } c.v = 0; continue; }
      if (now - c.seenAt > 4000) { this.drop(c); continue; }
      const B = c.buf; if (!B.length) continue;
      let i = B.length - 1; while (i > 0 && B[i].ts > T) i--;
      const a = B[i], b = B[i + 1];
      if (b) {
        const k = Math.min(1, Math.max(0, (T - a.ts) / Math.max(1, b.ts - a.ts)));
        c.x = a.x + (b.x - a.x) * k; c.y = a.y + (b.y - a.y) * k; c.z = a.z + (b.z - a.z) * k;
        let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); c.yaw = a.yaw + dy * k;
        c.pitch = a.pitch + (b.pitch - a.pitch) * k; c.v = a.v + (b.v - a.v) * k;
      } else {
        const ex = Math.min(0.3, Math.max(0, (T - a.ts) / 1000));
        c.x = a.x + Math.sin(a.yaw) * a.v * ex; c.y = a.y; c.z = a.z - Math.cos(a.yaw) * a.v * ex; c.yaw = a.yaw; c.pitch = a.pitch; c.v = a.v;
      }
      const o = c.rig.object, d = Math.hypot(c.x - this.D.camera.position.x, c.z - this.D.camera.position.z);
      o.visible = d < 170;
      if (!o.visible) continue;
      o.position.set(c.x, c.y, c.z);
      _e.set(c.pitch, -c.yaw, 0, 'YXZ'); o.quaternion.setFromEuler(_e);
      c.spin = (c.spin + c.v * dt / ((c.rig.wheels && c.rig.wheels[2] && c.rig.wheels[2].radius) || 0.33)) % (Math.PI * 2);
      const st = b ? Math.max(-0.6, Math.min(0.6, -Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) / Math.max(0.05, (b.ts - a.ts) / 1000) / Math.max(1, c.v) * 2.7)) : 0;
      c.rig.update(dt, { speed: c.v, wheelSpin: [c.spin, c.spin, c.spin, c.spin], steer: st, steeringWheel: st * 14, susp: [0, 0, 0, 0], brake: c.brake, reverse: false, signal: c.signal, headlights: false });
    }
  }
  // two circles a car for the player's collisions (as traffic.js)
  colliders() {
    const out = [];
    for (const c of this.list) {
      if (!c.rig || !c.rig.object.visible) continue;
      const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw), o = c.len * 0.27, r = 0.95, vx = fx * c.v, vz = fz * c.v;
      if (c.len > 6.5 && c.rig.dims) {
        const d = c.rig.dims, R = d.width / 2 * 0.95, oc = ((d.front ?? d.length / 2) - (d.rear ?? d.length / 2)) / 2, n = Math.ceil(d.length / (R * 1.3)) + 1;
        for (let i = 0; i < n; i++) { const t = oc - (d.length / 2 - R) + (d.length - 2 * R) * i / (n - 1); out.push({ x: c.x + fx * t, z: c.z + fz * t, r: R, vx, vz, obj: c }); }
        continue;
      }
      out.push({ x: c.x + fx * o, z: c.z + fz * o, r, vx, vz, obj: c }, { x: c.x - fx * o, z: c.z - fz * o, r, vx, vz, obj: c });
    }
    if (this.extraColliders) { try { this.extraColliders(out); } catch (e) {} }
    return out;
  }
  // this page's car hit one: the owner pushes it (what it does next comes back in its messages)
  bumped(c, hit) {
    if (!c || !c.nid) return;
    const now = performance.now(); if (now - (c.bumpT || 0) < 200) return; c.bumpT = now;
    this.N.send('bump', { id: c.nid, nx: r3(hit.nx || 0), nz: r3(hit.nz || 0), j: Math.round(hit.j || 0), sp: r2(hit.speed || 0) });
  }
  clearNear() {} rebind() {} relink() {}
  dispose() {
    this.dead = true;
    for (const c of this.byNid.values()) if (c.rig) this.freeRig(c.rig);
    this.byNid.clear(); this.list.length = 0;
    for (const a of this.pool.values()) for (const rig of a) { try { rig.dispose(); } catch (e) {} }
    this.pool.clear();
    this.scene.remove(this.group);
  }
}

// ------------------------------------------------------------------------------------------------------------

export class NpcNet {
  constructor(S) {
    this.S = S; this.D = S.drive; this.role = undefined; this.nid = 1;
    this.sendT = 0; this.fullT = 0; this.sendN = 0; this.last = new Map(); this.looks = new Map(); this.pedBuf = new Map(); this.off = undefined;
    this.offs = [];
    patchRagdoll();
    this.offs.push(S.net.on('npc', m => this.onNpc(m)));
    this.offs.push(S.net.on('npcdo', m => this.onDo(m)));
    this.stats = { sent: 0, bytes: 0, got: 0 };
    window.__mpnpc = this;
  }
  send(k, d) { this.S.net.send({ t: 'npcdo', k, d }); }

  setRole(of) {
    if (of === this.role) return;
    const was = this.role;
    this.role = of;
    this.owner = of;
    if (of === null) { if (was !== undefined) this.becomeOwner(); }
    else {
      // (from one owner to another: what the first sent is dropped, their numbers are their own)
      if (was !== undefined && was !== null && was !== of) {
        const D = this.D;
        if (D.traffic && D.traffic.puppet) { try { D.traffic.dispose(); } catch (e) {} D.traffic = new PuppetTraffic(this); }
        for (const id of [...this.pedBuf.keys()]) this.dropPed(id);
        this.looks.clear(); this.off = undefined;
      }
      this.becomePuppet();
    }
  }

  // ---- drawing another page's ----------------------------------------------------------------------------------
  becomePuppet() {
    const D = this.D;
    if (!(D.traffic && D.traffic.puppet)) {
      if (D.traffic && D.traffic.dispose) { try { D.traffic.dispose(); } catch (e) {} }
      D.traffic = new PuppetTraffic(this);
    }
    this.last.clear();
    const P = D.peds;
    if (P && !P.netPuppet) {
      P.netPuppet = true;
      this.pedOrig = P._update;
      for (let i = P.list.length - 1; i >= 0; i--) { try { P.remove(i); } catch (e) {} }
      P._update = dt => { try { this.pedStep(dt); } catch (e) { if (!this.pedErr) { this.pedErr = true; console.warn('puppet peds', e); } } };
    }
    this.S.line('', 'The traffic and people round you are shared with ' + (this.S.remotes.get(this.owner) || { name: 'another player' }).name + '.', 'sys');
  }

  // ---- running them for the others (after drawing another page's: carried on from where they were) ------------
  becomeOwner() {
    const D = this.D, T = D.traffic;
    if (T && T.puppet) {
      const was = T.list.filter(c => c.rig);
      // the cars it was drawing go on as real traffic: each on the lane under it going its way
      D.traffic = null;
      try { D.makeTraffic(); } catch (e) { console.warn('traffic', e); }
      const N = D.traffic;
      for (const c of was) {
        const ok = N && N.lanes && D.laneFacing ? D.laneFacing(c.x, c.z, ((c.yaw * 180 / Math.PI) % 360 + 360) % 360, 5, L => L.kind === 'road' || L.kind === 'junction') : null;
        if (!ok || !ok.lane) continue;
        T.group.remove(c.rig.object); T.byNid.delete(c.nid);
        const rig = c.rig; rig.modelId = rig.modelId || c.model;
        const car = { rig, L: ok.lane, s: ok.s, v: c.v, vWant: ok.lane.speed * 0.9, len: c.len, path: [], x: c.x, y: c.y, z: c.z, yaw: c.yaw, spin: 0, signal: c.signal, brake: 0,
          stopDone: null, wait: 0, hitT: 0, push: new THREE.Vector2(), off: new THREE.Vector2(), offYaw: 0, spinV: 0, stuck: 0, nid: c.nid };
        try { N.extendPath(car); N.list.push(car); N.group.add(rig.object); N.place(car, 0); } catch (e) { console.warn('adopt car', e); }
      }
      if (N && was.length) N.first = false;
      // (our own numbers go on from the ones carried over, so the others never see two cars under one)
      for (const c of was) this.nid = Math.max(this.nid, (c.nid || 0) + 1);
      T.dispose();
    }
    const P = D.peds;
    if (P && P.netPuppet) {
      P.netPuppet = false;
      if (this.pedOrig) P._update = this.pedOrig;
      // the people it was drawing walk on from where they stand
      for (const Q of P.list) {
        const r = P.nearestPath(Q.x, Q.z, 4);
        if (!r || !['walk', 'stand'].includes(Q.state)) { Q.drop = true; continue; }
        Object.assign(Q, { path: r.path, s: r.s, dir: Math.random() < 0.5 ? 1 : -1, lat: 0, speed: 1.2 + Math.random() * 0.35, state: 'walk', t: 0, gy: -1, gyT: 0, mad: null, look: null, lookT: 0, bubble: null });
        try { Q.p.play('walk', { fade: 0.3, speed: Q.speed / 1.3 }); } catch (e) {}
      }
      for (let i = P.list.length - 1; i >= 0; i--) if (P.list[i].drop) { try { P.remove(i); } catch (e) {} }
      for (const Q of P.list) this.nid = Math.max(this.nid, (Q.nid || 0) + 1);
      this.pedBuf.clear();
    }
    this.S.line('', 'You are now running the traffic and people for the players near you.', 'sys');
  }

  // what the owner sends: cars and people that changed, everything now and then, a few events
  ownerFrame(now) {
    const D = this.D, T = D.traffic, P = D.peds;
    if (now - this.sendT < SEND_MS) return;
    // every car its number from the start, so its people (occupants.js, picked from the number) are the ones the other
    // pages will pick for it when they come near
    if (T && T.list && !T.puppet) for (const c of T.list) if (!c.nid) c.nid = this.nid++;
    // (nobody near enough to draw them: nothing sent)
    const me = D.onfoot && D.onfoot.active ? D.onfoot.focus() : D.car.vehicle.pos;
    let any = false; for (const R of this.S.remotes.values()) if (R.has && Math.hypot(R.pos.x - me.x, R.pos.z - me.z) < 450) { any = true; break; }
    if (!any) return;
    this.sendT = now; this.sendN++;
    const full = now - this.fullT > FULL_MS; if (full) this.fullT = now;
    const m = { t: 'npc', ts: Math.round(now), c: [], h: [] };
    if (full) m.full = 1;
    const seen = new Set();
    if (T && T.list && !T.puppet) for (const c of T.list) {
      if (!c.rig || Math.hypot(c.x - me.x, c.z - me.z) > SEND_R) continue;
      if (!c.nid) c.nid = this.nid++;
      seen.add(c.nid);
      _e.setFromQuaternion(c.rig.object.quaternion, 'YXZ');
      const o = c.rig.object.position;
      const a = [c.nid, c.rig.modelId || c.rig.id, c.rig.paintColor ?? 0, r2(o.x), r2(o.y), r2(o.z), r3(-_e.y), r3(_e.x), r2(c.v), c.signal || (c.hitT > 0 ? 2 : 0), c.brake ? 1 : 0];
      const key = 'c' + c.nid, l = this.last.get(key);
      if (!full && l && Math.abs(l[3] - a[3]) < 0.02 && Math.abs(l[5] - a[5]) < 0.02 && Math.abs(l[8] - a[8]) < 0.05 && l[9] === a[9] && l[10] === a[10]) continue; // (the speed too: a car that has just stopped says so)
      this.last.set(key, a); m.c.push(a);
    }
    if (P && P.list && !P.netPuppet && (full || this.sendN % PED_EVERY === 0)) {
      const looks = full ? {} : null;
      for (const Q of P.list) {
        if (Math.hypot(Q.x - me.x, Q.z - me.z) > 150) continue;
        if (!Q.nid) Q.nid = this.nid++;
        seen.add(-Q.nid);
        const p = Q.p, a = [Q.nid, r2(Q.x), r2(Q.y), r2(Q.z), r3(-p.object.rotation.y), p.currentName || 'idle', p.current ? r2(p.current.timeScale) : 1, Q.state === 'down' ? 1 : Q.state === 'getup' ? 2 : 0];
        if (looks) looks[Q.nid] = p.look || null;
        // a person just thrown (by anyone's car): the throw, so the others throw theirs the same way
        const rag = p._netRag;
        if (rag && rag.t > (Q.ragSent || 0)) { Q.ragSent = rag.t; (m.e || (m.e = [])).push({ k: 'rag', id: Q.nid, v: rag.v, s: rag.s, low: rag.low, sh: rag.sh }); }
        if (Q.bubble && Q.bubble.text && Q.bubble.text !== Q.saidNet) { Q.saidNet = Q.bubble.text; (m.e || (m.e = [])).push({ k: 'say', id: Q.nid, text: Q.bubble.text }); }
        const key = 'h' + Q.nid, l = this.last.get(key);
        if (!full && l && Math.abs(l[1] - a[1]) < 0.02 && Math.abs(l[3] - a[3]) < 0.02 && l[5] === a[5] && l[7] === a[7]) continue;
        this.last.set(key, a); m.h.push(a);
      }
      if (looks) m.L = looks;
    }
    // gone since the last time
    if (!full) { const x = []; for (const k of this.last.keys()) { const id = k[0] === 'c' ? +k.slice(1) : -k.slice(1); if (!seen.has(id) && (k[0] === 'c' || full || this.sendN % PED_EVERY === 0)) { x.push(id); this.last.delete(k); } } if (x.length) m.x = x; }
    else for (const k of [...this.last.keys()]) { const id = k[0] === 'c' ? +k.slice(1) : -k.slice(1); if (!seen.has(id)) this.last.delete(k); }
    // (the looks ride in the message's own field, which the server does not pass on: they go as an event)
    if (m.L) { (m.e || (m.e = [])).push({ k: 'looks', L: m.L }); delete m.L; }
    this.S.net.send(m);
    this.stats.sent++;
  }

  // ---- on a puppet page: the owner's message -----------------------------------------------------------------
  onNpc(m) {
    if (this.role === null || this.role === undefined || m.from !== this.owner) return;
    const now = performance.now();
    this.stats.got++;
    const T = this.D.traffic;
    // (cars: in c; people: in h; gone: in x, people's ids negative)
    if (T && T.puppet) T.take({ ts: m.ts, full: m.full, c: m.c, x: (m.x || []).filter(id => id > 0) }, now);
    const o = now - m.ts; this.off = this.off === undefined ? o : Math.min(o, this.off + 0.5);
    for (const e of m.e || []) if (e.k === 'looks') for (const id in e.L) if (e.L[id]) this.looks.set(+id, e.L[id]);
    const P = this.D.peds; if (!P || !P.netPuppet) return;
    const seen = m.full ? new Set() : null;
    for (const a of m.h || []) {
      if (seen) seen.add(a[0]);
      let B = this.pedBuf.get(a[0]); if (!B) this.pedBuf.set(a[0], B = { buf: [], Q: null });
      B.buf.push({ ts: m.ts, x: a[1], y: a[2], z: a[3], yaw: a[4], anim: a[5], as: a[6], st: a[7] }); if (B.buf.length > 12) B.buf.shift();
      B.seenAt = now;
    }
    for (const id of (m.x || [])) if (id < 0) this.dropPed(-id);
    if (seen) for (const id of [...this.pedBuf.keys()]) if (!seen.has(id)) this.dropPed(id);
    for (const e of m.e || []) {
      const B = this.pedBuf.get(e.id), Q = B && B.Q;
      if (e.k === 'rag' && Q && !Q.p.isRagdoll && Q.state !== 'down') {
        const v = new THREE.Vector3().fromArray(e.v), s = e.s ? new THREE.Vector3().fromArray(e.s) : null;
        try { Q.p.ragdoll(v, s, { low: e.low ?? 0.3, shift: e.sh ? new THREE.Vector3().fromArray(e.sh) : undefined }); } catch (er) {}
        Q.state = 'down'; Q.t = 0; Q.downT = 0; Q.mad = { speed: v.length() };
      }
      if (e.k === 'say' && Q) { try { P.say(Q, e.text, 3); } catch (er) {} }
    }
  }
  dropPed(id) {
    const B = this.pedBuf.get(id); this.pedBuf.delete(id);
    const P = this.D.peds; if (!B || !B.Q || !P) return;
    const i = P.list.indexOf(B.Q); if (i >= 0) { try { P.remove(i); } catch (e) {} }
  }

  // the pedestrians on a puppet page: made from the owner's looks, placed between its last two messages, thrown
  // here at once when this page's car hits them
  pedStep(dt) {
    const P = this.D.peds, now = performance.now(), T = now - (this.off || 0) - DELAY - 120;
    P.frame++;
    const cars = P.cars(), mine = cars.filter(c => c.player);
    for (const [id, B] of this.pedBuf) {
      if (now - (B.seenAt || 0) > 4000) { this.dropPed(id); continue; }
      let Q = B.Q;
      if (!Q) {
        const look = this.looks.get(id); if (!look || !P.looks) continue;
        let p; try { p = People.createPerson(look, { lod: 'auto', far: 130 }); } catch (e) { continue; }
        const s0 = B.buf[B.buf.length - 1];
        Q = B.Q = { p, nid: id, x: s0.x, y: s0.y, z: s0.z, yaw: s0.yaw, state: 'walk', t: 0, gy: -1, gyT: 0, id: p.id, anim: null };
        p.object.position.set(Q.x, Q.y, Q.z); p.object.rotation.set(0, -Q.yaw, 0);
        P.group.add(p.object); P.list.push(Q);
      }
      if (Q.state === 'down' || Q.state === 'getup') {
        // thrown here: this page's own ragdoll until they are up (peds.js's own way down and up)
        if (Q.state === 'down') { try { P.down(Q, dt); } catch (e) {} }
        Q.p.update(dt);
        if (Q.state !== 'down' && Q.state !== 'getup' && !Q.p.isRagdoll) Q.anim = null;
        continue;
      }
      // a car on them: thrown on this screen now, and on the owner's (which tells the rest)
      const hit = mine.length ? P.contact(Q, mine) : null;
      if (hit && hit.speed >= 1.6) {
        const c = hit.car;
        try { P.hit(Q, hit); } catch (e) { console.warn('puppet hit', e); }
        this.send('ped', { id, sp: r2(hit.speed), lf: r2(hit.lf), lr: r2(hit.lr), x: r2(c.x), y: r2(c.y), z: r2(c.z), yaw: r3(c.yaw), len: r2(c.len), wid: r2(c.wid), hgt: r2(c.hgt), vx: r2(c.vx), vz: r2(c.vz) });
        continue;
      }
      const Bf = B.buf; let i = Bf.length - 1; while (i > 0 && Bf[i].ts > T) i--;
      const a = Bf[i], b = Bf[i + 1];
      if (b) {
        const k = Math.min(1, Math.max(0, (T - a.ts) / Math.max(1, b.ts - a.ts)));
        Q.x = a.x + (b.x - a.x) * k; Q.y = a.y + (b.y - a.y) * k; Q.z = a.z + (b.z - a.z) * k;
        let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); Q.yaw = a.yaw + dy * k;
      } else { Q.x = a.x; Q.y = a.y; Q.z = a.z; Q.yaw = a.yaw; }
      const s = b || a;
      if (s.anim !== Q.anim) { Q.anim = s.anim; try { Q.p.play(s.anim, { fade: 0.3, speed: s.as || 1 }); } catch (e) {} }
      const ob = Q.p.object; ob.position.set(Q.x, Q.y, Q.z); ob.rotation.set(0, -Q.yaw, 0);
      Q.p.update(dt);
    }
    P.bubbles.update(dt, this.D.camera);
  }

  // ---- on the owner's page: what a puppet page did --------------------------------------------------------------
  onDo(m) {
    if (this.role !== null) return;
    const D = this.D, d = m.d || {};
    if (m.k === 'take' || m.k === 'bump') {
      const T = D.traffic; if (!T || T.puppet) return;
      const c = T.list.find(c => c.nid === d.id); if (!c) return;
      if (m.k === 'take') { const i = T.list.indexOf(c); if (i >= 0) T.list.splice(i, 1); T.freeRig(c.rig); this.last.delete('c' + c.nid); return; }
      try { T.bumped(c, { nx: d.nx, nz: d.nz, j: d.j, speed: d.sp }); } catch (e) {}
      return;
    }
    if (m.k === 'ped') {
      const P = D.peds; if (!P || P.netPuppet) return;
      const Q = P.list.find(q => q.nid === d.id); if (!Q || Q.state === 'down' || Q.state === 'getup') return;
      const car = { x: d.x, y: d.y, z: d.z, yaw: d.yaw, len: d.len, wid: d.wid, hgt: d.hgt, vx: d.vx, vz: d.vz, ref: null, player: false };
      // (where the person stands on this page: the hit is worked out from its place against that car)
      try { P.hit(Q, { car, speed: d.sp, lf: d.lf, lr: d.lr }); } catch (e) { console.warn('owner ped hit', e); }
    }
  }

  // a crash into a traffic car, from another page: the same dent on our copy of it
  impact(nid, d) {
    const T = this.D.traffic; if (!T) return;
    const c = T.puppet ? T.byNid.get(nid) : T.list.find(c => c.nid === nid);
    if (!c || !c.rig) return;
    try { const Dm = this.D.damage; if (Dm) { const rd = Dm.of(c.rig); rd.trafficCar = c; if (!Dm.trafficDamaged.includes(rd)) Dm.trafficDamaged.push(rd); } } catch (e) {}
    this.S.applyImpact(c.rig, d);
  }

  frame(dt, now) {
    if (this.role === null && this.D.car) { this.anchorStep(now); this.ownerFrame(now); }
  }

  // the owner runs the traffic and the people round the middle of its group, not round itself alone, so a player
  // 250 m away still has cars about (at most 120 m off for the cars, 50 m for the people, who are drawn less far)
  anchorStep(now) {
    const D = this.D, T = D.traffic, P = D.peds;
    if (now - (this.anchorT || 0) > 1000) {
      this.anchorT = now;
      const me = D.onfoot && D.onfoot.active ? D.onfoot.focus() : D.car.vehicle.pos;
      let x = me.x, z = me.z, n = 1;
      for (const R of this.S.remotes.values()) if (R.has && Math.hypot(R.pos.x - me.x, R.pos.z - me.z) < 300) { x += R.pos.x; z += R.pos.z; n++; }
      x /= n; z /= n;
      const dx = x - me.x, dz = z - me.z, d = Math.hypot(dx, dz) || 1;
      const kT = Math.min(1, 120 / d), kP = Math.min(1, 50 / d);
      this.anchor = n > 1 ? { tx: me.x + dx * kT, tz: me.z + dz * kT, px: me.x + dx * kP, pz: me.z + dz * kP } : null;
    }
    if (T && !T.puppet && !Object.prototype.hasOwnProperty.call(T, 'update')) {
      const orig = Object.getPrototypeOf(T).update;
      T.update = (dt, pl) => { const a = this.anchor; if (a && this.role === null && pl) { pl.x = a.tx; pl.z = a.tz; } return orig.call(T, dt, pl); };
    }
    if (P && !Object.prototype.hasOwnProperty.call(P, 'anchor')) {
      const orig = Object.getPrototypeOf(P).anchor, v = new THREE.Vector3();
      P.anchor = () => { const o = orig.call(P), a = this.anchor; if (!a || this.role !== null || P.netPuppet) return o; return v.set(a.px, o.y, a.pz); };
    }
  }

  dispose() {
    for (const f of this.offs) f(); this.offs = [];
    const D = this.D;
    try { if (D.traffic && Object.prototype.hasOwnProperty.call(D.traffic, 'update')) delete D.traffic.update; if (D.peds && Object.prototype.hasOwnProperty.call(D.peds, 'anchor')) delete D.peds.anchor; } catch (e) {}
    this.anchor = null;
    // back to single player: the traffic and people run here again
    if (D.traffic && D.traffic.puppet || (D.peds && D.peds.netPuppet)) { this.role = null; try { this.becomeOwnerQuiet(); } catch (e) {} }
    if (window.__mpnpc === this) window.__mpnpc = null;
  }
  becomeOwnerQuiet() { const line = this.S.line; this.S.line = () => {}; try { this.becomeOwner(); } finally { this.S.line = line; } }
}
