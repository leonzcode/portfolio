// Earth Drive multiplayer (round 5): the connection to the game server (mlhub apps/mc/earthdrive.js, ?mode=ed), and
// the session in a room: this page's car and person sent about 12 times a second, the other players drawn from what
// the server passes on (their car from cars.loadCar, posed between their last two snapshots, about 120 ms behind so
// they glide; their person from people.js walking, running, getting in and out, sitting at the wheel), name tags,
// the player list (Tab), the chat (T or Enter), crashes passed on as damage.js impacts (applied to everyone's copy of
// that car, and to a late joiner from the log the server keeps), hits between players felt on both screens, taking
// another player's car (E beside it: their page is asked, their person thrown out, the car with its dents becomes
// yours), and teleport requests (/tpa). The traffic and pedestrians are shared by npcnet.js.
//
// Everyone in a room drops at the room's place, so every page's frame (geo.js) has the same origin and positions go
// as local metres.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js?v=44';
import { seatsOf } from './occupants.js?v=44';

const Q = new URLSearchParams(location.search);
const LOCAL_PAGE = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(location.hostname);
// the game server; a page served from this computer may point at a local one (?mp=ws://127.0.0.1:8850/mc/ws). On the
// live site the address in the URL is never used: nothing is sent anywhere a link says.
export function serverUrl() {
  const mp = Q.get('mp');
  const base = LOCAL_PAGE && mp && /^wss?:\/\/[^\s]+$/.test(mp) ? mp : 'wss://apps.leonzhao.dev/mc/ws';
  return base + (base.includes('?') ? '&' : '?') + 'mode=ed';
}

const SEND_MS = 83, SEND_STILL_MS = 400; // about 12 a second, 2.5 a second standing still
const DELAY = 140;                       // drawn this far behind the newest snapshot (sent 12 a second, relayed 20 a second)
const MAX_DRAWN = 10;                    // other players' cars drawn (the nearest)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const F_ = new THREE.Vector3(0, 0, -1);
const r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 10000) / 10000;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ------------------------------------------------------------------------------------------------------------
// the connection

export class Net {
  constructor() { this.ws = null; this.h = new Map(); this.id = 0; this.name = ''; this.room = null; this.open = false; }
  on(t, f) { if (!this.h.has(t)) this.h.set(t, []); this.h.get(t).push(f); return () => { const a = this.h.get(t); const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); }; }
  emit(m) { for (const f of (this.h.get(m.t) || []).slice()) { try { f(m); } catch (e) { console.warn('net', m.t, e); } } }
  connect() {
    if (this.ws && this.open) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((res, rej) => {
      let ws;
      try { ws = new WebSocket(serverUrl()); } catch (e) { this.connecting = null; rej(e); return; }
      this.ws = ws;
      const to = setTimeout(() => { try { ws.close(); } catch (e) {} rej(new Error('The game server did not answer.')); }, 9000);
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch (er) { return; }
        if (m.t === 'welcome') { this.id = m.id; this.open = true; clearTimeout(to); this.connecting = null; res(); }
        this.rx = (this.rx || 0) + e.data.length;
        this.emit(m);
      };
      ws.onclose = () => { clearTimeout(to); const was = this.open; this.open = false; this.ws = null; this.connecting = null; this.room = null; if (!was) rej(new Error('Could not reach the game server.')); this.emit({ t: 'closed', was }); };
      ws.onerror = () => {};
    });
    return this.connecting;
  }
  send(o) { if (this.ws && this.open && this.ws.readyState === 1) { const s = JSON.stringify(o); this.tx = (this.tx || 0) + s.length; this.ws.send(s); return true; } return false; }
  // a request and its answer: the first message of one of the types asked, or an error for it
  ask(o, ok, what, ms = 8000) {
    return new Promise((res, rej) => {
      const offs = [];
      const done = () => { offs.forEach(f => f()); clearTimeout(t); };
      for (const k of ok) offs.push(this.on(k, m => { done(); res(m); }));
      offs.push(this.on('err', m => { if (m.what === what) { done(); rej(new Error(m.text)); } }));
      offs.push(this.on('closed', () => { done(); rej(new Error('The connection to the game server was lost.')); }));
      const t = setTimeout(() => { done(); rej(new Error('The game server did not answer.')); }, ms);
      if (!this.send(o)) { done(); rej(new Error('Not connected to the game server.')); }
    });
  }
  async hello(name) { await this.connect(); const m = await this.ask({ t: 'hello', name }, ['hi'], 'name'); this.name = m.name; return m; }
  async rooms() { await this.connect(); return (await this.ask({ t: 'list' }, ['rooms'], 'list')).list; }
  async create(o) { const m = await this.ask({ t: 'create', ...o }, ['joined'], 'create'); this.room = m.room; return m; }
  async join(o) { const m = await this.ask({ t: 'join', ...o }, ['joined'], 'join'); this.room = m.room; return m; }
  leave() { this.send({ t: 'leave' }); this.room = null; }
  close() { try { if (this.ws) this.ws.close(); } catch (e) {} }
}

// ------------------------------------------------------------------------------------------------------------
// one other player, drawn

class Remote {
  constructor(S, info) {
    this.S = S; this.id = info.id; this.name = info.name; this.seq = info.seq; this.look = info.look || null;
    this.dmg = Array.isArray(info.dmg) ? info.dmg.slice() : [];
    this.buf = []; this.off = undefined; this.st = null;
    this.carId = null; this.col = null; this.rig = null; this.loadTicket = 0;
    this.spin = [0, 0, 0, 0]; this.person = null; this.making = false; this.anim = null; this.mode = 'car';
    this.pos = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.fpos = new THREE.Vector3(); this.fyaw = 0; this.vel = new THREE.Vector3();
    this.has = false; this.drawn = false; this.d = Infinity;
    this.proxy = { remote: this, rig: null, x: 0, y: 0, z: 0, yaw: 0, offYaw: 0, v: 0, push: new THREE.Vector2(), spinV: 0, hitT: 0, len: 4.6 };
    this.tag = document.createElement('div'); this.tag.className = 'mp-tag'; this.tag.textContent = this.name;
    S.tagsEl.appendChild(this.tag);
  }

  push(s, now) {
    // the sender's clock to ours: the smallest gap seen (the least delayed packet), let drift up slowly
    const o = now - s.ts;
    this.off = this.off === undefined ? o : Math.min(o, this.off + 0.5);
    if (this.buf.length && s.ts <= this.buf[this.buf.length - 1].ts) return;
    this.buf.push(s); if (this.buf.length > 24) this.buf.shift();
    this.st = s;
    this.lcList = s.lc || null;
  }

  // the cars this player left standing (drawn where their page has them; solid, not driven here)
  syncLeft() {
    const want = this.lcList || [], have = this.left || (this.left = []);
    const D = this.S.drive, C = D.mods.cars;
    for (let i = 0; i < Math.max(want.length, have.length); i++) {
      const w = want[i], h = have[i], key = w ? w[0] + ':' + w[1] : null;
      if (h && h.key !== key) { if (h.rig) { try { if (D.damage) D.damage.reset(h.rig); } catch (e) {} h.rig.dispose(); } h.dead = true; have[i] = null; }
      if (w && !have[i] && C && C.CARS.find(c => c.id === w[0])) {
        const L = have[i] = { key, rig: null, w };
        C.loadCar(w[0], { npc: true, color: w[1] }).then(rig => {
          if (L.dead || this.dead) { rig.dispose(); return; }
          if (D.carEnv && rig.setEnvMap) rig.setEnvMap(D.carEnv);
          L.rig = rig; D.scene.add(rig.object);
        }).catch(() => {});
      }
      if (have[i]) have[i].w = w;
    }
    have.length = want.length;
    for (const L of have) if (L && L.rig && L.w) {
      const w = L.w, o = L.rig.object; o.position.set(w[2], w[3], w[4]); o.quaternion.set(w[5], w[6], w[7], w[8]);
      o.visible = Math.hypot(w[2] - this.S.camera.position.x, w[4] - this.S.camera.position.z) < 400;
      if (!L.posed) { L.posed = true; try { L.rig.update(0, { speed: 0, wheelSpin: [0, 0, 0, 0], steer: 0, steeringWheel: 0, susp: [0, 0, 0, 0], brake: 0, reverse: false, signal: 0, headlights: false }); } catch (e) {} }
    }
  }

  // the pose at the drawing time, between two snapshots (or a little past the newest along its velocity)
  sample(now) {
    const B = this.buf; if (!B.length) return false;
    const T = now - this.off - DELAY;
    let i = B.length - 1;
    while (i > 0 && B[i].ts > T) i--;
    const a = B[i], b = B[i + 1];
    const carry = (s) => { this.pos.set(s.x, s.y, s.z); if (s.q) this.q.set(s.q[0], s.q[1], s.q[2], s.q[3]); if (s.f) { this.fpos.set(s.f.x, s.f.y, s.f.z); this.fyaw = s.f.yaw; } };
    if (!b) {
      carry(a);
      const ex = Math.min(0.25, Math.max(0, (T - a.ts) / 1000));
      if (a.v && ex > 0) { this.pos.x += a.v[0] * ex; this.pos.y += a.v[1] * ex; this.pos.z += a.v[2] * ex; }
    } else {
      const k = Math.min(1, Math.max(0, (T - a.ts) / Math.max(1, b.ts - a.ts)));
      this.pos.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
      if (a.q && b.q) { _q.set(a.q[0], a.q[1], a.q[2], a.q[3]); _q2.set(b.q[0], b.q[1], b.q[2], b.q[3]); this.q.copy(_q).slerp(_q2, k); }
      if (a.f && b.f) {
        this.fpos.set(a.f.x + (b.f.x - a.f.x) * k, a.f.y + (b.f.y - a.f.y) * k, a.f.z + (b.f.z - a.f.z) * k);
        let d = b.f.yaw - a.f.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.fyaw = a.f.yaw + d * k;
      } else if (b.f) { this.fpos.set(b.f.x, b.f.y, b.f.z); this.fyaw = b.f.yaw; }
    }
    const s = B[B.length - 1];
    if (s.v) this.vel.set(s.v[0], s.v[1], s.v[2]);
    this.has = true;
    return true;
  }

  async wantCar(id, col) {
    if (id === this.carId && (col == null || col === this.col)) return;
    this.carId = id; this.col = col;
    const t = ++this.loadTicket;
    this.dropRig();
    if (!id) return;
    const D = this.S.drive, C = D.mods.cars;
    if (!C || !C.CARS.find(c => c.id === id)) return;
    try {
      const rig = await C.loadCar(id, { npc: true, color: col ?? undefined });
      if (t !== this.loadTicket || this.dead) { rig.dispose(); return; }
      if (D.carEnv && rig.setEnvMap) rig.setEnvMap(D.carEnv);
      // (no wait for its shaders: gate.js holds a new mesh out of the drawing until they are built in the background,
      // and the traffic's models, which most players drive, have theirs already)
      this.setRig(rig, id);
    } catch (e) { console.warn('remote car', id, e); }
  }
  // a rig to draw this player's car with (loaded, or handed over: a car that was taken)
  setRig(rig, id) {
    this.dropRig();
    const D = this.S.drive;
    this.rig = rig; this.carId = id; this.proxy.rig = rig; this.proxy.len = rig.dims ? rig.dims.length : 4.6;
    this.doorOk = {}; this.doorAsk = {}; this.doors = [];
    rig.netRemote = this;
    if (!rig.object.parent) D.scene.add(rig.object);
    this.applyDamage();
  }
  // a car this player has just taken (its rig, dents and all, handed over from its owner's copy): left standing where
  // it is until their own snapshots say they are in it (until then they still drive or stand by their old one)
  takePending(rig, id) {
    if (this.pending && this.pending.rig !== rig) { try { this.pending.rig.dispose(); } catch (e) {} }
    this.pending = { rig, id, at: performance.now() };
    rig.netRemote = this;
    if (!rig.object.parent) this.S.drive.scene.add(rig.object);
    rig.object.visible = true;
  }
  dropRig() {
    const rig = this.rig;
    if (!rig) return;
    this.rig = null; this.proxy.rig = null;
    this.unseat();
    const D = this.S.drive;
    try { const R = D.occupants && D.occupants.rec(rig); if (R) D.occupants.release(R, this.person); } catch (e) {}
    if (rig.netRemote === this) rig.netRemote = null;
    try { if (D.damage) D.damage.reset(rig); } catch (e) {}
    if (rig.dispose) rig.dispose(); else if (rig.object.parent) rig.object.parent.remove(rig.object);
  }
  // the crashes so far on this car, then each as it comes
  applyDamage() {
    const D = this.S.drive;
    if (!this.rig || !D.damage) return;
    // (counted on the rig: a rig handed from one player to another keeps the dents it already has)
    const rig = this.rig; let n = rig._netApplied || 0;
    while (n < this.dmg.length) this.S.applyImpact(rig, this.dmg[n++]);
    rig._netApplied = n;
  }

  async ensurePerson() {
    if (this.person || this.making) return;
    const D = this.S.drive, occ = D.occupants;
    if (!occ) return;
    this.making = true;
    try {
      const h = await occ.ready;
      if (!h || this.dead) return;
      const look = this.look || h.randomLook({});
      const p = await h.create(look, { lod: 'auto' });
      if (this.dead) { if (p.dispose) p.dispose(); return; }
      this.person = p; p.netRemote = this;
      D.scene.add(p.object);
      this.anim = null;
    } catch (e) { console.warn('remote person', e); }
    finally { this.making = false; }
  }
  relook(look) {
    this.look = look;
    const p = this.person; if (!p) return;
    if (p.setLook) { try { p.setLook(look); } catch (e) {} return; }
    this.unseat(); if (p.dispose) p.dispose(); this.person = null; this.ensurePerson();
  }
  unseat() {
    const p = this.person; if (!p || !this.seated) return;
    const D = this.S.drive, occ = D.occupants;
    try { const R = this.seated; R.people = R.people.filter(o => o.person !== p); occ.shade(p, 1); } catch (e) {}
    this.seated = null;
    if (p.setSeated) try { p.setSeated(false); } catch (e) {}
    p.ik && (p.ik.handL = p.ik.handR = p.ik.footL = p.ik.footR = null);
    p.shadow = true;
    D.scene.attach(p.object);
    this.anim = null;
  }

  frame(dt, now) {
    if (!this.sample(now)) { this.hideAll(); return; }
    const s = this.st, D = this.S.drive;
    this.mode = s.m || 'car';
    const Pd = this.pending;
    if (Pd) {
      if ((s.car || null) === Pd.id) { this.pending = null; this.loadTicket++; if (this.rig !== Pd.rig) this.setRig(Pd.rig, Pd.id); this.carId = Pd.id; this.col = Pd.rig.paintColor ?? s.col ?? null; }
      else if (now - Pd.at > 30000) { this.pending = null; if (Pd.rig !== this.rig) { try { if (D.damage) D.damage.reset(Pd.rig); } catch (e) {} Pd.rig.dispose(); } }
    }
    // the car: loaded when it changes, posed and its parts moved
    if ((s.car || null) !== this.carId || (s.col != null && s.col !== this.col && s.car === this.carId && !(this.rig && this.rig._dmg && this.rig._dmg.damaged))) this.wantCar(s.car || null, s.col ?? null);
    const rig = this.rig, cam = this.S.camera.position;
    this.d = Math.hypot(this.pos.x - cam.x, this.pos.z - cam.z);
    if (rig) {
      const show = this.drawRank < MAX_DRAWN && this.d < 900;
      rig.object.visible = show;
      if (show) {
        rig.object.position.copy(this.pos); rig.object.quaternion.copy(this.q);
        const L = s.lk || {};
        const r = (rig.wheels && rig.wheels[2] && rig.wheels[2].radius) || 0.33;
        const sp = L.sp || 0;
        for (let i = 0; i < 4; i++) this.spin[i] = (this.spin[i] + sp * dt / r) % (Math.PI * 2);
        const look = this.look_ || (this.look_ = { wheelSpin: this.spin, susp: [0, 0, 0, 0] });
        look.speed = sp; look.steer = L.st || 0; look.steeringWheel = (L.st || 0) * 15;
        if (L.su) for (let i = 0; i < 4; i++) look.susp[i] = L.su[i]; else look.susp.fill(0);
        look.brake = L.br ? 1 : 0; look.reverse = !!L.rv; look.signal = L.sg || 0; look.headlights = !!L.hl; look.dt = dt;
        // aircraft (agent A's rigs): the rotor's or propeller's turns a second, the gear, and anything else they send
        if (L.ro !== undefined) look.rotor = L.ro; if (L.ge !== undefined) look.gear = L.ge; if (L.th !== undefined) look.throttle = L.th;
        look.flying = !!L.fl;
        if (L.x) Object.assign(look, L.x);
        try { rig.update(dt, look); } catch (e) {}
        // doors as they are on the other page (open while getting in or out); a door is cut out of the body in the
        // background first (damage.js prepareDoor: cut at once it held the frame a few tenths of a second)
        if (L.dr && rig.setDoor && D.damage && D.damage.prepareDoor) for (let i = 0; i < L.dr.length; i++) {
          const k = L.dr[i], ok = this.doorOk || (this.doorOk = {}), ask = this.doorAsk || (this.doorAsk = {}), cur = this.doors || (this.doors = []);
          if (!ok[i]) { if (k > 0.01 && !ask[i]) { ask[i] = true; D.damage.prepareDoor(rig, i).then(y => { if (this.rig === rig) ok[i] = y; }).catch(() => {}); } continue; }
          if (cur[i] === undefined || Math.abs(cur[i] - k) > 0.01) { cur[i] = k; try { rig.setDoor(i, k); } catch (e) {} }
        }
      }
      const P = this.proxy, fw = _v.copy(F_).applyQuaternion(this.q);
      P.x = this.pos.x; P.y = this.pos.y; P.z = this.pos.z; P.yaw = Math.atan2(fw.x, -fw.z); P.v = Math.max(0, (s.lk && s.lk.sp) || 0);
    }
    // the person: in the scene when out of the car, at the wheel when in it (occupy, from occupants.js)
    const out = this.mode !== 'car' && s.f;
    if ((out || (rig && this.d < 70)) && !this.person) this.ensurePerson();
    const p = this.person;
    if (p) {
      if (out) {
        if (this.seated) this.unseat();
        p.object.visible = this.d < 300;
        p.object.position.copy(this.fpos);
        p.object.rotation.set(0, -this.fyaw, 0);
        const a = s.f.rg ? 'lie_back' : (s.f.a || 'idle');
        if (a !== this.anim) { this.anim = a; try { p.play(a, { fade: 0.25, speed: s.f.as || 1, force: true }); } catch (e) {} }
        else if (p.current && s.f.as) p.current.timeScale = s.f.as;
        if (p.object.visible) { try { p.update(dt); } catch (e) {} }
      } else if (!this.seated) p.object.visible = false;
    }
    if (((this.S.fn || 0) + this.id) % 20 === 0) this.syncLeft();
    // the name over them
    const head = out ? _w.copy(this.fpos).setY(this.fpos.y + 2.05) : _w.copy(this.pos).setY(this.pos.y + ((rig && rig.dims && rig.dims.height) || 1.5) + 0.7);
    this.S.placeTag(this.tag, head, this.d);
  }
  hideAll() { if (this.rig) this.rig.object.visible = false; if (this.person && !this.seated) this.person.object.visible = false; this.tag.style.display = 'none'; }

  dispose() {
    this.dead = true;
    this.dropRig();
    if (this.pending) { try { this.pending.rig.dispose(); } catch (e) {} this.pending = null; }
    for (const L of this.left || []) if (L) { L.dead = true; if (L.rig) L.rig.dispose(); }
    this.left = [];
    if (this.person) { this.unseat(); if (this.person.dispose) this.person.dispose(); else if (this.person.object.parent) this.person.object.parent.remove(this.person.object); this.person = null; }
    this.tag.remove();
  }
}

// ------------------------------------------------------------------------------------------------------------
// the session in a room

const CSS = `
.mp-tags { position: fixed; inset: 0; pointer-events: none; z-index: 3; overflow: hidden; }
.mp-tag { position: absolute; left: 0; top: 0; transform-origin: 50% 100%; padding: 3px 9px; border-radius: 12px; background: rgba(255,255,255,.92); color: #1f1f1f; font: 500 13px/18px 'Google Sans', Roboto, system-ui, sans-serif; white-space: nowrap; box-shadow: 0 1px 3px rgba(60,64,67,.3); will-change: transform; display: none; }
.mp-tag::after { content: ''; position: absolute; left: 50%; bottom: -5px; margin-left: -5px; border: 5px solid transparent; border-bottom: 0; border-top-color: rgba(255,255,255,.92); }
.mp-chat { position: fixed; left: 12px; bottom: 184px; width: min(420px, calc(100vw - 32px)); z-index: 6; pointer-events: none; font: 400 14px/19px Roboto, system-ui, sans-serif; }
.mp-lines { display: flex; flex-direction: column; gap: 3px; max-height: 40vh; overflow: hidden; justify-content: flex-end; }
.mp-line { align-self: flex-start; max-width: 100%; background: rgba(32,33,36,.72); color: #fff; padding: 4px 10px; border-radius: 12px; overflow-wrap: anywhere; transition: opacity .6s; }
.mp-line b { font-weight: 500; color: #a8c7fa; margin-right: 6px; }
.mp-line.sys { background: rgba(32,33,36,.55); color: #e8eaed; font-style: italic; }
.mp-line.tpa { background: rgba(11,87,208,.88); font-style: normal; }
.mp-line.fade { opacity: 0; }
.mp-chat.typing .mp-line { opacity: 1 !important; }
.mp-line button { pointer-events: auto; font: 500 13px/18px 'Google Sans', Roboto, sans-serif; border: 0; border-radius: 12px; padding: 2px 10px; margin-left: 8px; cursor: pointer; background: #fff; color: #0b57d0; }
.mp-line button.no { background: rgba(255,255,255,.18); color: #fff; }
.mp-in { display: none; margin-top: 6px; pointer-events: auto; }
.mp-chat.typing .mp-in { display: flex; }
.mp-in input { flex: 1; min-width: 0; height: 40px; border: 0; border-radius: 20px; padding: 0 16px; font: 400 15px Roboto, system-ui, sans-serif; color: #1f1f1f; background: #fff; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); outline: none; }
.mp-list { position: fixed; left: 50%; top: 72px; transform: translateX(-50%); width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 160px); overflow: auto; z-index: 7; background: #fff; color: #1f1f1f; border-radius: 16px; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); font: 400 14px/20px Roboto, system-ui, sans-serif; display: none; }
.mp-list.on { display: block; }
.mp-list h3 { margin: 0; padding: 16px 20px 4px; font: 400 18px/24px 'Google Sans', Roboto, sans-serif; }
.mp-list .mp-sub { padding: 0 20px 10px; color: #444746; font-size: 13px; }
.mp-row { display: flex; align-items: center; gap: 12px; padding: 10px 20px; border-top: 1px solid #e8eaed; }
.mp-dot { width: 32px; height: 32px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #fff; font: 500 14px 'Google Sans', Roboto, sans-serif; }
.mp-who { flex: 1; min-width: 0; }
.mp-who div:first-child { font-weight: 500; }
.mp-who div + div { color: #70757a; font-size: 13px; }
.mp-row button { font: 500 14px 'Google Sans', Roboto, sans-serif; color: #0b57d0; background: none; border: 1px solid #c4c7c5; border-radius: 18px; padding: 6px 14px; cursor: pointer; white-space: nowrap; }
.mp-row button:hover { background: #f2f2f2; }
.mp-row button:focus-visible { outline: 2px solid #0b57d0; outline-offset: 2px; }
.mp-hint { position: fixed; left: 50%; bottom: 150px; transform: translateX(-50%); background: rgba(32,33,36,.86); color: #fff; padding: 8px 16px; border-radius: 18px; font: 400 14px Roboto, system-ui, sans-serif; z-index: 6; pointer-events: none; display: none; }
.mp-hint.on { display: block; }
.mp-tb { position: fixed; right: 16px; top: 72px; z-index: 6; display: flex; flex-direction: column; gap: 10px; }
.mp-tb button { width: 44px; height: 44px; border-radius: 50%; border: 0; background: #fff; color: #444746; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); display: grid; place-items: center; cursor: pointer; }
.mp-tb svg { width: 22px; height: 22px; fill: currentColor; }
@media (prefers-reduced-motion: reduce) { .mp-line { transition: none; } }
`;
const COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#007b83', '#c5221f', '#b06000', '#3c4043', '#a142f4', '#12b5cb', '#f538a0', '#5f6368', '#1e8e3e', '#ea8600', '#4285f4'];

export class Session {
  constructor(G, net, joined) {
    this.G = G; this.net = net; this.drive = G.drive; this.camera = G.camera;
    this.room = joined.room; this.me = joined.you; this.remotes = new Map();
    this.sendT = 0; this.lastSent = null; this.role = undefined; this.hostId = joined.room.host;
    this.offs = []; this.undo = [];
    this.myDmg = []; this.myRig = null;
    this.pendingRigs = new Map(); // player id -> a rig handed over (our car, taken by them)
    if (!document.getElementById('mp-css')) { const s = document.createElement('style'); s.id = 'mp-css'; s.textContent = CSS; document.head.appendChild(s); }
    this.tagsEl = document.createElement('div'); this.tagsEl.className = 'mp-tags'; document.body.appendChild(this.tagsEl);
    this.makeChat(); this.makeList();
    this.hint = document.createElement('div'); this.hint.className = 'mp-hint'; document.body.appendChild(this.hint);
    // touch screens have no T or Tab: a chat button and a players button
    if (matchMedia('(pointer: coarse)').matches || /[?&]touch/.test(location.search)) {
      const tb = this.tb = document.createElement('div'); tb.className = 'mp-tb';
      tb.innerHTML = '<button aria-label="Chat"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></button><button aria-label="Players"><svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg></button>';
      const [cb, pb] = tb.querySelectorAll('button');
      cb.onclick = () => this.openChat(); pb.onclick = () => this.toggleList();
      document.body.appendChild(tb);
    }
    for (const p of joined.players) this.addRemote(p);
    const on = (t, f) => this.offs.push(net.on(t, f));
    on('p', m => { const now = performance.now(); for (const s of m.l) { const R = this.remotes.get(s.id); if (!R) continue; if (s.gone) { R.buf.length = 0; R.st = null; R.has = false; continue; } R.push(s, now); } });
    on('pj', m => { this.addRemote(m.player); });
    on('pl', m => { const R = this.remotes.get(m.id); if (R) { R.dispose(); this.remotes.delete(m.id); } this.hostId = m.host; this.renderList(); });
    on('look', m => { const R = this.remotes.get(m.id); if (R) R.relook(m.look); });
    on('chat', m => this.line(m.name, m.text, ''));
    on('sys', m => this.line('', m.text, m.k === 'tpa' ? 'sys tpa' : 'sys'));
    on('ev', m => this.onEvent(m));
    on('bump', m => this.onBump(m));
    on('role', m => { this.role = m.of; this.hostId = m.host; if (this.npc) this.npc.setRole(m.of); });
    on('where', m => { this.where = m.l; if (this.listOn) this.renderList(); });
    on('stealReq', m => this.onStealReq(m));
    on('given', m => this.onGiven(m));
    on('tpReq', m => this.onTpReq(m));
    on('tpGo', m => this.onTpGo(m));
    on('closed', () => { if (this.dead) return; this.lost = true; this.line('', 'Lost the connection to the game server. Trying to get back in...', 'sys'); this.reconnect(); });
    window.__mp = this;
  }

  // back into the room after the connection went (a deploy restarts the server: the room is made again by its code)
  async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const t0 = performance.now(), name = (() => { try { return localStorage.getItem('car_mpname'); } catch (e) { return null; } })() || this.me.name;
    while (!this.dead && performance.now() - t0 < 180000) {
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));
      if (this.dead) break;
      try {
        await this.net.connect();
        await this.net.hello(name);
        const m = await this.net.ask({ t: 'rejoin', code: this.room.code, room: { name: this.room.name, pub: this.room.pub, place: this.room.place } }, ['joined'], 'join');
        this.rejoined(m);
        this.reconnecting = false;
        return;
      } catch (e) { /* the server is not back yet: again in a moment */ }
    }
    this.reconnecting = false;
    if (!this.dead) this.line('', 'Could not get back into the room. You can keep driving on your own.', 'sys');
  }
  rejoined(m) {
    this.room = m.room; this.me = m.you; this.lost = false; this.hostId = m.room.host;
    this.net.room = m.room;
    for (const R of this.remotes.values()) R.dispose();
    this.remotes.clear();
    for (const p of m.players) this.addRemote(p);
    this.lookSent = null; this.lcKey = null; this.sendLook();
    // our car's dents again (a restarted server has no log of them)
    for (const d of this.myDmg.slice(-25)) this.net.send({ t: 'ev', k: 'imp', d });
    this.line('', 'Back in the room.', 'sys');
  }

  addRemote(info) {
    if (!info || info.id === this.me.id || this.remotes.has(info.id)) return;
    const R = new Remote(this, info);
    this.remotes.set(info.id, R);
    if (info.at) R.pos.set(info.at[0], info.at[1], info.at[2]);
    this.renderList();
  }
  colorOf(id) { const ids = [this.me.id, ...[...this.remotes.keys()]].sort((a, b) => a - b); return COLORS[Math.max(0, ids.indexOf(id)) % COLORS.length]; }

  // ---- hooks into the drive (all undone by dispose) ----------------------------------------------------------
  attach() {
    if (this.attached) return;
    this.attached = true;
    const D = this.drive, G = this.G;
    D.net = this;
    // the frame: after the drive's own update, before the world is drawn
    const prev = G.onFrame;
    // (how long the multiplayer part of a frame takes, for tests: this.ms an average, this.msMax the worst lately)
    G.onFrame = dt => { if (prev) prev(dt); const t0 = performance.now(); try { this.frame(dt); } catch (e) { if (!this.frameErr) { this.frameErr = true; console.warn('mp frame', e); } } const ms = performance.now() - t0; this.ms = this.ms === undefined ? ms : this.ms * 0.98 + ms * 0.02; this.msMax = Math.max(ms, (this.msMax || 0) * 0.995); };
    this.undo.push(() => { G.onFrame = prev; });
    // other players' cars are solid to ours, as the traffic is
    const F = D.onfoot;
    if (F && F.others) {
      const orig = F.others;
      F.others = (t) => { const out = orig.call(F, t); try { this.colliders(out); } catch (e) {} return out; };
      this.undo.push(() => { F.others = orig; });
    }
    // the traffic we run slows and queues behind other players' cars (and the ones they left), and stops for them on foot
    if (F && F.aheadHook) {
      const orig = F.aheadHook;
      F.aheadHook = (c, gap, lv) => { let r = orig.call(F, c, gap, lv); try { r = this.aheadRemote(c, r.gap, r.lv); } catch (e) {} return r; };
      this.undo.push(() => { F.aheadHook = orig; });
    }
    // crashes: ours sent to everyone; another player's car is dented only by what its own page says happened
    const Dm = D.damage;
    // (our hits on other players, every physics step: damage.step runs after each)
    if (Dm && Dm.step) {
      const orig = Dm.step;
      Dm.step = (v, dt, env) => { const r = orig.call(Dm, v, dt, env); try { if (D.car && v === D.car.vehicle) this.stepHits(v); } catch (e) {} return r; };
      this.undo.push(() => { Dm.step = orig; });
    }
    if (Dm && Dm.impact) {
      const orig = Dm.impact;
      Dm.impact = (rd, imp, o = {}) => {
        const rig = rd && rd.rig;
        // (damage.js's trafficHit put it on its list of dented traffic, which it resets beyond ten: not this car)
        if (rig && rig.netRemote && !imp._net) { const k = Dm.trafficDamaged ? Dm.trafficDamaged.indexOf(rd) : -1; if (k >= 0) Dm.trafficDamaged.splice(k, 1); return null; }
        const res = orig.call(Dm, rd, imp, o);
        try { if (!imp._net) this.sentImpact(rd, imp, o); } catch (e) { console.warn('mp impact', e); }
        return res;
      };
      this.undo.push(() => { Dm.impact = orig; });
    }
    // a new car of our own (1 to 0, or a respawn with R): the others start it new
    const kd = e => { if (e.code === 'KeyR' && !e.repeat && D.active && !(e.target && e.target.tagName === 'INPUT') && D.onfoot && D.onfoot.mode === 'car') { this.myDmg = []; this.net.send({ t: 'ev', k: 'rst' }); } };
    addEventListener('keydown', kd); this.undo.push(() => removeEventListener('keydown', kd));
    // the chat's and the list's keys (caught before the game's, so typing does not drive)
    const keys = e => this.key(e);
    addEventListener('keydown', keys, true); this.undo.push(() => removeEventListener('keydown', keys, true));
    // our look for the others (a player who never chose one gets a look of their own, so two players are not twins)
    (async () => {
      try {
        if (!localStorage.getItem('car_look') && D.occupants) {
          const h = await D.occupants.ready;
          if (h && h.randomLook && !localStorage.getItem('car_look')) { localStorage.setItem('car_look', JSON.stringify(h.randomLook({}))); if (D.onfoot && D.onfoot.relook) await D.onfoot.relook(); }
        }
      } catch (e) {}
      this.sendLook();
    })();
    const sl = setInterval(() => this.sendLook(), 4000); this.undo.push(() => clearInterval(sl));
    // the traffic and the pedestrians shared (npcnet.js)
    import('./npcnet.js?v=44').then(M => { if (this.dead) return; this.npc = new M.NpcNet(this); if (this.role !== undefined) this.npc.setRole(this.role); }).catch(e => console.warn('npcnet', e));
  }

  // where this player starts in the room: the room's place, a few car lengths along the road per player before
  dropped() {
    const D = this.drive;
    this.attach();
    try {
      const k = (this.me.seq || 0) % 8, v = D.car && D.car.vehicle;
      if (k && v && D.roadsObj) {
        const h = v.heading * Math.PI / 180, o = v.origin(), d = 11 * k;
        const p = D.roadSpot(o.x + Math.sin(h) * d, o.z - Math.cos(h) * d, v.heading);
        if (p && Math.hypot(p.x - o.x, p.z - o.z) < 160) D.spawn(p.x, p.z, p.heading, p.y ?? null);
      }
    } catch (e) { console.warn('mp spawn', e); }
    this.myRig = D.car && D.car.rig;
    this.line('', 'You are in ' + this.room.name + (this.room.pub ? '' : ' (code ' + this.room.code + ')') + '. T to chat, Tab for the players.', 'sys');
  }

  sendLook() {
    try {
      const F = this.drive.onfoot, look = F && F.look ? F.look : JSON.parse(localStorage.getItem('car_look') || 'null');
      const s = look ? JSON.stringify(look) : '';
      if (s && s !== this.lookSent) { this.lookSent = s; this.net.send({ t: 'look', look }); }
    } catch (e) {}
  }

  // ---- every frame -----------------------------------------------------------------------------------------
  frame(dt) {
    const D = this.drive;
    if (!D.active || !D.car || this.dead) return;
    const now = performance.now();
    // a new car of ours (or the old one handed on): the others start from new
    if (D.car.rig !== this.myRig) {
      const was = this.myRig; this.myRig = D.car.rig;
      if (!this.adopting || this.adopting.rig !== D.car.rig) { this.myDmg = []; this.net.send({ t: 'ev', k: 'rst' }); }
      else this.adopting = null;
      void was;
    }
    this.fn = (this.fn || 0) + 1;
    this.sendState(now);
    // the others, nearest drawn first
    const cam = this.camera.position, list = [...this.remotes.values()];
    for (const R of list) R.d = Math.hypot(R.pos.x - cam.x, R.pos.z - cam.z);
    list.sort((a, b) => a.d - b.d).forEach((R, i) => { R.drawRank = i; });
    this.camera.updateMatrixWorld();
    this.vp = (this.vp || new THREE.Matrix4()).multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    for (const R of list) { try { R.frame(dt, now); } catch (e) { if (!R.err) { R.err = true; console.warn('remote', e); } } }
    this.footHits(now);
    if (this.npc) { try { this.npc.frame(dt, now); } catch (e) { if (!this.npcErr) { this.npcErr = true; console.warn('npc net', e); } } }
    this.chatStep(now);
    if (this.stealing && now - this.stealing.at > 5000) { this.stealing = null; this.showHint(''); D.hud.flash('No answer, so the car stays theirs'); }
    this.stealStep(now);
  }

  // this page's car and person, about 12 times a second while anything moves
  sendState(now) {
    const D = this.drive, F = D.onfoot, car = D.car, v = car.vehicle, rig = car.rig;
    const mode = F ? F.mode : 'car';
    const moving = v.speed > 0.05 || mode !== 'car' || (F && F.vel && F.vel.lengthSq() > 0.001);
    if (now - this.sendT < (moving ? SEND_MS : SEND_STILL_MS)) return;
    this.sendT = now;
    const o = rig.object, s = { t: 's', ts: Math.round(now), m: mode };
    if (car.ghost) { s.car = null; const P = F && F.pos; s.x = P ? r2(P.x) : 0; s.y = P ? r2(P.y) : 0; s.z = P ? r2(P.z) : 0; }
    else {
      s.x = r2(o.position.x); s.y = r2(o.position.y); s.z = r2(o.position.z);
      s.q = [r4(o.quaternion.x), r4(o.quaternion.y), r4(o.quaternion.z), r4(o.quaternion.w)];
      s.v = [r2(v.v.x), r2(v.v.y), r2(v.v.z)];
      s.car = car.id || null; if (rig.paintColor != null) s.col = rig.paintColor;
      const L = v.look();
      const lk = { sp: r2(L.speed || 0), st: Math.round((L.steer || 0) * 1000) / 1000, su: L.susp ? L.susp.map(x => Math.round(x * 1000) / 1000) : undefined, sg: D.signal || 0 };
      if (L.brake) lk.br = 1; if (L.reverse) lk.rv = 1; if (D.headlights) lk.hl = 1;
      // aircraft (agent A): whatever the vehicle says its moving parts are
      if (v.netLook) { try { const n = v.netLook(); if (n) { if (n.rotor !== undefined) lk.ro = n.rotor; if (n.gear !== undefined) lk.ge = n.gear; if (n.throttle !== undefined) lk.th = n.throttle; const x = {}; let k = 0; for (const key in n) if (!['rotor', 'gear', 'throttle'].includes(key) && typeof n[key] === 'number' && k++ < 10) x[key] = n[key]; if (k) lk.x = x; } } catch (e) {} }
      if (D.flight && D.flight.flying) lk.fl = 1;
      // the doors while getting in or out
      if (mode !== 'car' && F && F.doorOpen) { try { const n = (rig.spec && rig.spec.doors ? rig.spec.doors.length : 0); if (n) { lk.dr = []; for (let i = 0; i < Math.min(4, n); i++) lk.dr.push(Math.round((F.doorOpen(rig, i) || 0) * 100) / 100); } } catch (e) {} }
      s.lk = lk;
    }
    // the cars we left standing about (onfoot.js), when they change (the server keeps them with our state)
    if (F && F.parked && now - (this.lcT || 0) > 1500) {
      this.lcT = now;
      const me = mode !== 'car' ? F.pos : o.position, lc = [];
      for (const e of F.parked) {
        if (!e.rig || !e.rig.object || typeof e.id !== 'string' || e.rig === rig) continue;
        const p2 = e.rig.object.position, q2 = e.rig.object.quaternion;
        lc.push([e.id, e.rig.paintColor ?? 0, r2(p2.x), r2(p2.y), r2(p2.z), r4(q2.x), r4(q2.y), r4(q2.z), r4(q2.w), (p2.x - me.x) ** 2 + (p2.z - me.z) ** 2]);
      }
      lc.sort((a, b) => a[9] - b[9]);
      const out = lc.slice(0, 3).map(a => a.slice(0, 9)), key = JSON.stringify(out);
      if (key !== this.lcKey) { this.lcKey = key; s.lc = out; }
    }
    if (mode !== 'car' && F && F.person) {
      const p = F.person;
      p.object.getWorldPosition(_v); p.object.getWorldQuaternion(_q);
      const fw = _w.copy(F_).applyQuaternion(_q);
      const f = { x: r2(_v.x), y: r2(_v.y), z: r2(_v.z), yaw: Math.round(Math.atan2(fw.x, -fw.z) * 1000) / 1000, a: p.currentName || 'idle', as: p.current ? Math.round(p.current.timeScale * 100) / 100 : 1 };
      if (p.isRagdoll) { f.rg = 1; if (p.bonePos) { try { p.bonePos('hips', _v); f.x = r2(_v.x); f.y = r2(_v.y - 0.15); f.z = r2(_v.z); } catch (e) {} } }
      s.f = f;
    }
    this.net.send(s);
  }

  // name tags: a white label over each player, fixed size near, smaller far
  placeTag(el, p, d) {
    if (d > 400 || this.G.paused) { el.style.display = 'none'; return; }
    _v.copy(p).applyMatrix4(this.vp);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > 1.2 || Math.abs(_v.y) > 1.2) { el.style.display = 'none'; return; }
    const x = (_v.x * 0.5 + 0.5) * innerWidth, y = (-_v.y * 0.5 + 0.5) * innerHeight, k = Math.max(0.6, Math.min(1, 40 / Math.max(1, d)));
    el.style.display = 'block';
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${k.toFixed(2)})`;
    el.style.opacity = d > 250 ? ((400 - d) / 150).toFixed(2) : '1';
  }

  // ---- collisions --------------------------------------------------------------------------------------------
  colliders(out) {
    const D = this.drive, my = D.car && D.car.vehicle; if (!my) return;
    const y0 = my.pos.y;
    for (const R of this.remotes.values()) {
      const rig = R.rig; if (!rig || !rig.dims || !R.has || !rig.object.visible || R.d > 120) continue;
      // (only at the same height: a plane overhead or a car on the bridge above is not in the way)
      if (Math.abs(R.pos.y - y0) > 3.5) continue;
      const P = R.proxy, d = rig.dims, fx = Math.sin(P.yaw), fz = -Math.cos(P.yaw), vx = R.vel.x, vz = R.vel.z;
      if (d.length > 6.5) {
        const Rr = d.width / 2 * 0.95, oc = ((d.front ?? d.length / 2) - (d.rear ?? d.length / 2)) / 2, n = Math.ceil(d.length / (Rr * 1.3)) + 1;
        for (let i = 0; i < n; i++) { const t = oc - (d.length / 2 - Rr) + (d.length - 2 * Rr) * i / (n - 1); out.push({ x: P.x + fx * t, z: P.z + fz * t, r: Rr, vx, vz, obj: P }); }
      } else {
        const o = d.length * 0.27, r = Math.max(0.85, d.width / 2 * 0.98);
        out.push({ x: P.x + fx * o, z: P.z + fz * o, r, vx, vz, obj: P }, { x: P.x - fx * o, z: P.z - fz * o, r, vx, vz, obj: P });
      }
    }
    // the cars they left standing (and one just taken, not yet driven off): solid where they stand
    for (const R of this.remotes.values()) for (const L of R.pending ? [...(R.left || []), R.pending] : (R.left || [])) {
      if (!L || !L.rig || !L.rig.dims || !L.rig.object.visible) continue;
      const o = L.rig.object.position; if (Math.abs(o.y - y0) > 3.5 || (o.x - my.pos.x) ** 2 + (o.z - my.pos.z) ** 2 > 3600) continue;
      const fw = _v.copy(F_).applyQuaternion(L.rig.object.quaternion), yaw = Math.atan2(fw.x, -fw.z), fx = Math.sin(yaw), fz = -Math.cos(yaw), d = L.rig.dims, k = d.length * 0.27, r = Math.max(0.85, d.width / 2 * 0.98);
      out.push({ x: o.x + fx * k, z: o.z + fz * k, r, vx: 0, vz: 0, obj: null }, { x: o.x - fx * k, z: o.z - fz * k, r, vx: 0, vz: 0, obj: null });
    }
  }

  // other players' semis, for their trailers (trailer.js)
  semis() {
    const out = this._semis || (this._semis = []); out.length = 0;
    for (const R of this.remotes.values()) if (R.rig && R.rig.id === 'semi' && R.has) out.push({ rig: R.rig, brake: !!(R.st && R.st.lk && R.st.lk.br) });
    return out;
  }

  // other players' cars as boxes for our person on foot (onfoot.js moveBy)
  carBoxes(box, x, z) {
    const each = (rig) => {
      if (!rig || !rig.dims || !rig.object.visible) return;
      const o = rig.object.position; if (Math.abs(o.x - x) > 7 || Math.abs(o.z - z) > 7) return;
      const fw = _v.copy(F_).applyQuaternion(rig.object.quaternion);
      box(rig, o.x, o.z, Math.atan2(fw.x, -fw.z), o.y);
    };
    for (const R of this.remotes.values()) { each(R.rig); if (R.pending) each(R.pending.rig); for (const L of R.left || []) if (L) each(L.rig); }
  }

  aheadRemote(c, gap, lv) {
    const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const test = (x, z, len, v) => {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz > 3600) return;
      const lon = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (lon > 0 && lon < 50 && lat < 2.1) { const g = lon - c.len / 2 - len / 2 - 1.2; if (g < gap) { gap = Math.max(0, g); lv = Math.max(0, v); } }
    };
    for (const R of this.remotes.values()) {
      if (!R.has) continue;
      if (R.rig && R.rig.object.visible) test(R.pos.x, R.pos.z, R.proxy.len, R.vel.x * fx + R.vel.z * fz);
      if (R.mode !== 'car' && R.st && R.st.f) test(R.fpos.x, R.fpos.z, 0.6, 0);
      for (const L of R.pending ? [...(R.left || []), R.pending] : (R.left || [])) if (L && L.rig && L.rig.dims) { const o = L.rig.object.position; test(o.x, o.z, L.rig.dims.length, 0); }
    }
    return { gap, lv };
  }

  // our hits on them in one physics step (damage.step is called after every step): told to them, so they feel it too;
  // the first hit of a crash at once, a harder one in the next fifth of a second again
  stepHits(v) {
    if (!v.hits || !v.hits.length) return;
    const now = performance.now();
    for (const h of v.hits) {
      const P = h.other && h.other.obj; if (!P || !P.remote) continue;
      const R = P.remote, sp = h.speed || 0;
      const fresh = now - (R.lastHitT || 0) >= 300;
      R.lastHitSp = fresh ? sp : Math.max(R.lastHitSp || 0, sp);
      R.lastHitJ = (fresh ? 0 : (R.lastHitJ || 0)) + (h.j || 0); // (the push our own physics gave us from them)
      R.lastHitT = now;
      if (sp < 0.8) continue;
      if (now - (R.bumpSent || 0) < 220 && sp < (R.bumpSp || 0) * 1.5) continue;
      R.bumpSent = now; R.bumpSp = sp;
      this.net.send({ t: 'bump', id: R.id, nx: r4(h.nx || 0), nz: r4(h.nz || 0), j: Math.round(h.j || 0), sp: r2(sp), px: r2(h.px ?? v.pos.x), pz: r2(h.pz ?? v.pos.z), vx: r2(v.v.x), vz: r2(v.v.z) });
    }
  }

  // another player's car hit ours: felt here (a push, the bump on the screen, the sound, the dent) unless our own
  // physics already met their car in the same moment
  onBump(m) {
    const D = this.drive, R = this.remotes.get(m.from); if (!D.car || D.car.ghost || !R) return;
    const F = D.onfoot;
    if (m.kind === 'foot' || (F && F.mode === 'foot')) {
      // (they drove into us on foot)
      if (F && F.mode === 'foot' && F.knockDown && m.sp > 2) { F.knockDown(new THREE.Vector3(m.vx * 1.05, 2 + m.sp * 0.18, m.vz * 1.05)); D.hud.flash(R.name + ' ran you over'); }
      return;
    }
    // (our own physics may have met their car in the same moment, a little before or after on this screen: we take
    // whatever of their page's push it did not give us, and the dent only if it was not a real hit here)
    const recent = performance.now() - (R.lastHitT || 0) < 300;
    const gotJ = recent ? (R.lastHitJ || 0) : 0, hitHere = recent && (R.lastHitSp || 0) >= m.sp * 0.6;
    const v = D.car.vehicle, mass = v.mass || (v.p && v.p.mass) || 1500;
    const k = Math.min(8, Math.max(0, (m.j || 0) - gotJ) / mass);
    if (k > 0.01) { v.v.x -= m.nx * k; v.v.z -= m.nz * k; if (recent) R.lastHitJ = (R.lastHitJ || 0) + k * mass; }
    if (hitHere) return;
    if (m.sp > 4) D.hud.bump(m.sp);
    if (m.sp > 1.5) try { D.sound.hit(m.sp); } catch (e) {}
    // our own dent, as if our physics had met them (damage.js works out the crush)
    try {
      if (D.damage && D.damage.playerHit && m.sp > 2) {
        const rd = D.damage.of(D.car.rig);
        D.damage.playerHit(rd, v, { nx: -m.nx, nz: -m.nz, px: m.px, pz: m.pz, speed: m.sp, j: m.j, other: { obj: R.proxy } }, { ground: (x, z, y) => D.ground(x, z, y), collide: D.collide, others: null });
      }
    } catch (e) { console.warn('bump damage', e); }
  }

  // our car into another player on foot: their page knocks them over
  footHits(now) {
    const D = this.drive, v = D.car && !D.car.ghost && D.car.vehicle, rig = D.car && D.car.rig;
    if (!v || !rig || !rig.dims || v.speed < 2.5 || !(D.onfoot && D.onfoot.mode === 'car')) return;
    const o = rig.object.position, fw = _v.copy(F_).applyQuaternion(rig.object.quaternion), yaw = Math.atan2(fw.x, -fw.z), s = Math.sin(yaw), c = Math.cos(yaw);
    for (const R of this.remotes.values()) {
      if (R.mode === 'car' || !R.st || !R.st.f || R.st.f.rg || now - (R.footHit || 0) < 1500) continue;
      const dx = R.fpos.x - o.x, dz = R.fpos.z - o.z;
      if (dx * dx + dz * dz > 49 || Math.abs(R.fpos.y - o.y) > 2) continue;
      const lf = dx * s - dz * c, lr = dx * c + dz * s;
      if (Math.abs(lf) > rig.dims.length / 2 + 0.3 || Math.abs(lr) > rig.dims.width / 2 + 0.3) continue;
      R.footHit = now;
      this.net.send({ t: 'bump', id: R.id, kind: 'foot', nx: 0, nz: 0, j: 0, sp: r2(v.speed), px: r2(R.fpos.x), pz: r2(R.fpos.z), vx: r2(v.v.x), vz: r2(v.v.z) });
      try { D.sound.hit(Math.min(8, v.speed * 0.6)); } catch (e) {}
    }
  }

  // ---- crash damage ------------------------------------------------------------------------------------------
  // an impact damage.js worked out for one of our cars (or a traffic car we hit), as plain numbers
  sentImpact(rd, imp, o) {
    const D = this.drive, rig = rd.rig;
    const pack = v3 => v3 ? [r4(v3.x), r4(v3.y), r4(v3.z)] : null, fin = x => Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null;
    const d = { P: pack(imp.P), N: pack(imp.N), sp: fin(imp.speed), k: imp.kind || 'flat', r: fin(imp.r), t0: fin(imp.t0), t1: fin(imp.t1), b0: fin(imp.b0), b1: fin(imp.b1), e: fin(imp.edge), y: fin(imp.yMid), ro: imp.rollover ? 1 : 0, Dm: fin(imp.Dmul), ms: fin(o.mSelf), mo: fin(o.mOther), mu: fin(o.mul) };
    if (!d.P || !d.N) return;
    if (D.car && rig === D.car.rig && !D.car.ghost) { this.myDmg.push(d); if (this.myDmg.length > 60) this.myDmg.shift(); this.net.send({ t: 'ev', k: 'imp', d }); return; }
    // a traffic car (ours if we run them, or one we draw for another page): by its shared number
    const c = rd.trafficCar, nid = c && c.nid;
    if (nid && this.npc) this.net.send({ t: 'ev', k: 'nimp', id: nid, d });
  }
  applyImpact(rig, d) {
    const Dm = this.drive.damage; if (!Dm || !rig || !d || !d.P || !d.N) return;
    const rd = Dm.of(rig);
    rig.object.updateWorldMatrix(true, false);
    const M = rig.object.matrixWorld, q = rig.object.getWorldQuaternion(new THREE.Quaternion());
    const P = new THREE.Vector3().fromArray(d.P), N = new THREE.Vector3().fromArray(d.N);
    const inf = (x, dflt) => x === null || x === undefined ? dflt : x;
    const imp = { _net: true, P, N, speed: d.sp || 0, kind: d.k || 'flat', r: inf(d.r, 0.15), t0: inf(d.t0, -Infinity), t1: inf(d.t1, Infinity), b0: inf(d.b0, -Infinity), b1: inf(d.b1, Infinity), edge: d.e ?? undefined, yMid: inf(d.y, P.y), rollover: !!d.ro };
    if (d.Dm) imp.Dmul = d.Dm;
    imp.world = P.clone().setY(imp.yMid).applyMatrix4(M);
    imp.normal = N.clone().applyQuaternion(q);
    try { Dm.impact(rd, imp, { mSelf: inf(d.ms, 1500), mOther: inf(d.mo, Infinity), mul: inf(d.mu, 1) }); } catch (e) { console.warn('remote impact', e); }
  }

  onEvent(m) {
    const R = this.remotes.get(m.from);
    if (m.k === 'imp' && R) { R.dmg.push(m.d); if (R.dmg.length > 60) { R.dmg.shift(); if (R.rig) R.rig._netApplied = Math.max(0, (R.rig._netApplied || 0) - 1); } R.applyDamage(); return; }
    if (m.k === 'rst' && R) { R.dmg = []; if (R.rig) { R.rig._netApplied = 0; if (this.drive.damage) { try { this.drive.damage.reset(R.rig); } catch (e) {} } } return; }
    if (m.k === 'nimp') { if (this.npc) this.npc.impact(m.id, m.d); return; }
    if (m.k === 'adopt' && R) {
      // they took another player's car: its dents (and on our screen the very same model) go with them
      const O = this.remotes.get(m.of);
      if (O) {
        R.dmg = O.dmg.slice(); O.dmg = [];
        if (O.rig) { const rig = O.rig; O.rig = null; O.proxy.rig = null; O.carId = null; O.loadTicket++; O.unseat(); rig._netApplied = R.dmg.length; R.takePending(rig, rig.id); }
      } else if (m.of === this.me.id) { R.dmg = (this.givenDmg || []).slice(); if (R.pending) R.pending.rig._netApplied = R.dmg.length; }
      return;
    }
  }

  // ---- taking another player's car ---------------------------------------------------------------------------
  // the cars onfoot.target may pick (kind 'remote'): another player's, stopped or slow, near enough
  carTargets(consider) {
    for (const R of this.remotes.values()) {
      const rig = R.rig; if (!rig || !rig.object.visible || !R.has || R.d > 30) continue;
      consider('remote', rig, R, Math.abs((R.st && R.st.lk && R.st.lk.sp) || 0));
    }
  }
  steal(t) {
    const R = t.ref, D = this.drive, F = D.onfoot;
    if (!R || this.stealing) return;
    // a door we can open first (asked for, the owner would be thrown out of a car we then could not get into)
    try {
      const rig = t.rig, drv = F.doorOf(rig, 0), other = F.otherSeat ? F.otherSeat(rig) : null;
      let room = !!drv && F.doorRoom(rig, drv);
      if (!room && other !== null) room = F.doorRoom(rig, F.doorOf(rig, other));
      if (!room) { D.hud.flash('No room to open the doors'); return; }
    } catch (e) {}
    this.stealing = { R, at: performance.now() };
    this.net.send({ t: 'steal', id: R.id });
    this.showHint('Taking ' + R.name + "'s car...");
  }
  onGiven(m) {
    const S = this.stealing; this.stealing = null; this.showHint('');
    const D = this.drive, F = D.onfoot, R = this.remotes.get(m.from);
    if (!m.ok || !R) { D.hud.flash(m.why || "You can't take that car now"); return; }
    const rig = R.rig;
    if (!rig || !F) { D.hud.flash('That car is not here yet'); return; }
    // their car, with its dents, becomes one of ours standing there, and the person goes to its door
    R.rig = null; R.proxy.rig = null; R.carId = null; R.loadTicket++;
    R.unseat();
    rig.netRemote = null;
    const o = rig.object, fw = _v.copy(F_).applyQuaternion(o.quaternion), hd = (Math.atan2(fw.x, -fw.z) * 180 / Math.PI + 360) % 360;
    const veh = new Vehicle(rig, F.physOf(m.car || rig.id));
    const g = D.ground(o.position.x, o.position.z, o.position.y + 0.5);
    veh.place(o.position.x, g ?? o.position.y, o.position.z, hd);
    const e = F.addLeft({ rig, vehicle: veh, id: m.car || rig.id, npc: !!rig.npc, kind: 'left' });
    this.adopting = { rig };
    this.myDmg = Array.isArray(m.dmg) ? m.dmg.slice() : [];
    this.net.send({ t: 'ev', k: 'adopt', from: m.from });
    try { F.startEnter({ kind: 'left', rig, ref: e, d: 0, speed: 0, upY: 1 }); } catch (er) { console.warn('steal enter', er); }
    // (if the walk to the door does not get there, the car is ours anyway: stealStep puts us at the wheel)
    this.stolen = { e, rig, at: performance.now() };
    void S;
  }
  // a car we were given and could not walk into (something in the way, or the walk was given up): at the wheel at once
  stealStep(now) {
    const T = this.stolen; if (!T) return;
    const D = this.drive, F = D.onfoot;
    if (!F || (D.car && D.car.rig === T.rig) || now - T.at > 60000) { this.stolen = null; return; }
    if (F.mode !== 'foot' || F.seq || now - T.at < 1200 || !F.parked.includes(T.e)) return;
    this.stolen = null;
    try { F.takeWheel({ target: { kind: 'left', rig: T.rig, ref: T.e } }); D.hud.flash('You got in'); } catch (e) { console.warn('steal wheel', e); }
  }

  // someone wants our car: out of it we go (thrown onto the road by the driver's door), and it is theirs
  onStealReq(m) {
    const D = this.drive, F = D.onfoot, T = this.remotes.get(m.from);
    const no = why => this.net.send({ t: 'give', to: m.from, ok: 0, why });
    if (!D.car || D.car.ghost || !F || !T) return no('You cannot take that car now');
    if (F.mode === 'enter' && F.seq && F.seq.target && F.seq.target.kind === 'mine') return no(m.name + ' is getting into it');
    const car = D.car, rig = car.rig;
    try {
      if (F.mode === 'car' || F.mode === 'exit') {
        F.seq = null;
        F.occ.unseatPlayer();
        const p = F.person;
        if (p) {
          F.scene.attach(p.object);
          rig.object.updateWorldMatrix(true, false);
          const w = F.doorPoint(rig, 0, new THREE.Vector3()).applyMatrix4(rig.object.matrixWorld);
          p.object.position.copy(w); F.pos.copy(w);
          const away = w.clone().sub(rig.object.position).setY(0).normalize();
          F.knockDown(new THREE.Vector3(away.x * 2.6, 1.6, away.z * 2.6));
        } else F.mode = 'foot';
      }
    } catch (e) { console.warn('pulled out', e); }
    this.net.send({ t: 'give', to: m.from, ok: 1, car: car.id, col: rig.paintColor ?? null });
    this.givenDmg = this.myDmg.slice(); this.myDmg = [];
    // our car on our screen is now theirs (dents and all): left where it is until their snapshots say they are in it
    rig._netApplied = this.givenDmg.length; T.dmg = this.givenDmg.slice();
    T.takePending(rig, car.id);
    D.car = this.ghostCar(rig);
    this.myRig = D.car.rig; this.adopting = { rig: D.car.rig };
    D.hud.flash(m.name + ' took your car');
  }
  // nothing to drive: the drive keeps a hidden stand-in (drive.js skips its physics), until a car is chosen or taken
  ghostCar(was) {
    const D = this.drive, F = D.onfoot;
    const object = new THREE.Group(); object.visible = false;
    const rig = { object, ghost: true, wheels: [0, 1, 2, 3].map(i => ({ pos: new THREE.Vector3(i % 2 ? 0.8 : -0.8, 0.34, i < 2 ? -1.4 : 1.4), radius: 0.34, steer: i < 2 })),
      dims: { length: 4.6, width: 1.85, height: 1.5, wheelbase: 2.8, track: 1.6, front: 2.3, rear: 2.3 }, spec: { id: 'ghost', seats: [{ x: 0, y: 0.5, z: 0 }] },
      mounts: { driver: new THREE.Vector3(-0.37, 1.2, 0.15), hood: new THREE.Vector3(0, 1.15, -0.6), bumper: new THREE.Vector3(0, 0.55, -2.35), chase: new THREE.Vector3(0, 2, 6) },
      update() {}, setPaint() {}, dispose() {}, _beams: [] };
    const veh = new Vehicle(rig, {});
    const P = F && F.pos ? F.pos : was.object.position;
    veh.place(P.x + 9000, P.y, P.z, 0);
    return { rig, vehicle: veh, id: null, ghost: true };
  }

  // ---- teleport requests --------------------------------------------------------------------------------------
  tpa(who) {
    const R = typeof who === 'number' ? this.remotes.get(who) : [...this.remotes.values()].find(r => r.name.toLowerCase() === String(who).toLowerCase().trim());
    if (!R && typeof who === 'string') { this.net.send({ t: 'tpa', name: who }); return; }
    if (!R) return;
    this.net.send({ t: 'tpa', id: R.id });
  }
  onTpReq(m) {
    const el = this.line('', '', 'sys tpa', true);
    el.innerHTML = '<b>' + esc(m.name) + '</b>wants to come to you.';
    const yes = document.createElement('button'); yes.textContent = 'Accept';
    const no = document.createElement('button'); no.textContent = 'Deny'; no.className = 'no';
    const done = () => { yes.remove(); no.remove(); };
    yes.onclick = () => { this.net.send({ t: 'tpaccept', id: m.from }); done(); };
    no.onclick = () => { this.net.send({ t: 'tpdeny', id: m.from }); done(); };
    el.append(yes, no);
    el.dataset.until = String(performance.now() + Math.min(m.ms || 120000, 120000));
    this.drive.hud.flash(m.name + ' wants to come to you (T then /tpaccept, or click Accept)');
  }
  async onTpGo(m) {
    const D = this.drive, F = D.onfoot, st = m.st;
    if (!st || !D.active) return;
    const theyOut = st.m !== 'car' && st.f;
    const tx = theyOut ? st.f.x : st.x, ty = theyOut ? st.f.y : st.y, tz = theyOut ? st.f.z : st.z;
    let hd = 0;
    if (st.q && !theyOut) { _q.set(st.q[0], st.q[1], st.q[2], st.q[3]); const fw = _v.copy(F_).applyQuaternion(_q); hd = (Math.atan2(fw.x, -fw.z) * 180 / Math.PI + 360) % 360; }
    else if (theyOut) hd = ((st.f.yaw * 180 / Math.PI) % 360 + 360) % 360;
    this.line('', 'Going to ' + m.name + '...', 'sys tpa');
    // (getting in or out, or picking ourselves up: that finishes first, 8 s at most)
    for (let i = 0; i < 80 && F && (F.mode === 'exit' || F.mode === 'enter' || F.mode === 'down'); i++) await new Promise(r => setTimeout(r, 100));
    try {
      // far away: the streets there first (the car waits where it is meanwhile)
      const A = D.areaAt, far = !A || Math.hypot(tx - A.x, tz - A.z) > 200;
      if (far) {
        for (let i = 0; i < 100 && D.loadingArea; i++) await new Promise(r => setTimeout(r, 100));
        D.loadingArea = true;
        D.hud.loading('Going to ' + m.name, 0.4);
        try { await D.loadArea(tx, tz); } finally { D.loadingArea = false; }
        try { if (D.world.heights && D.world.heights.want) { const { toLatLon } = await import('./geo.js?v=44'); const g = toLatLon(new THREE.Vector3(tx, 0, tz)); await D.world.heights.want(g.lat, g.lon, 600); } } catch (e) {}
        D.hud.loading(null);
      }
      // (in the air only if they are flying and what we drive flies too: a car comes down on the road under them)
      const C = D.mods.cars, spec = D.car && C ? C.CARS.find(c => c.id === D.car.id) : null;
      const flying = (!!st.fly || !!(st.lk && (st.lk.fl || (st.lk.x && st.lk.x.air)))) && !!(spec && (spec.air || spec.fly));
      const inCar = !F || F.mode === 'car';
      if (inCar && D.car && !D.car.ghost) {
        let spot = null;
        if (flying) {
          // beside them in the air (a car that cannot fly comes down where they are)
          const h = hd * Math.PI / 180;
          spot = { x: tx + Math.cos(h) * 9, z: tz + Math.sin(h) * 9, heading: hd, y: ty };
          D.car.vehicle.place(spot.x, spot.y, spot.z, hd);
          D.prevPos = D.car.vehicle.pos.clone(); D.prevQ = D.car.vehicle.q.clone(); D.acc = 0; D.cam.ready = false;
        } else {
          // on the nearest lane going their way, a few car lengths behind them, never in a building
          const L = D.laneFacing(tx, tz, hd, 40, L => L.kind === 'road');
          if (L && L.lane) {
            for (const back of [10, 16, 22, -10, 6, 30]) {
              const q = lanePoint(L.lane, Math.max(1, Math.min(L.lane.len - 1, L.s - back)));
              if (!D.wallAhead(q.x, q.z, q.heading, q.y, 3) && !D.wallAhead(q.x, q.z, q.heading, q.y, -3) && Math.hypot(q.x - tx, q.z - tz) > 4) { spot = q; break; }
            }
          }
          if (!spot) spot = D.roadSpot(tx, tz, hd);
          if (spot) D.spawn(spot.x, spot.z, spot.heading, spot.y ?? null);
          else D.spawn(tx + 6, tz, hd, ty);
        }
      } else if (F && F.person) {
        // on foot: beside them, on the ground, on the side that is clear
        const h = hd * Math.PI / 180, side = theyOut ? 1.4 : 2.8;
        let ok = null;
        for (const s of [1, -1]) {
          const x = tx + Math.cos(h) * side * s, z = tz + Math.sin(h) * side * s;
          if (!F.clearAt || F.clearAt(x, z, ty, 0.3)) { ok = { x, z }; break; }
        }
        if (!ok) ok = { x: tx - Math.sin(h) * 3, z: tz + Math.cos(h) * 3 };
        if (F.mode !== 'foot') { F.seq = null; F.mode = 'foot'; }
        F.placePerson(ok.x, ok.z, ty + 0.8);
        F.face = Math.atan2(Math.sin(h), -Math.cos(h)) || F.face;
        if (F.camOwned === false && F.startCam) F.startCam();
      }
      this.line('', 'You are with ' + m.name + '.', 'sys tpa');
    } catch (e) { console.warn('teleport', e); this.line('', 'Could not get there, sorry.', 'sys'); D.hud.loading(null); }
  }

  // ---- the chat ----------------------------------------------------------------------------------------------
  makeChat() {
    const c = this.chat = document.createElement('div'); c.className = 'mp-chat';
    c.innerHTML = '<div class="mp-lines"></div><div class="mp-in"><input maxlength="160" placeholder="Say something, or /tpa name" aria-label="Chat message" enterkeyhint="send"></div>';
    document.body.appendChild(c);
    this.lines = c.querySelector('.mp-lines'); this.input = c.querySelector('input');
    this.input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); const t = this.input.value.trim(); this.input.value = ''; this.closeChat(); if (t) this.say(t); }
      else if (e.key === 'Escape') { e.preventDefault(); this.input.value = ''; this.closeChat(); }
    });
    this.input.addEventListener('keyup', e => e.stopPropagation());
  }
  openChat() { this.chat.classList.add('typing'); this.drive.keys.clear(); setTimeout(() => this.input.focus(), 0); }
  closeChat() { this.chat.classList.remove('typing'); this.input.blur(); }
  say(t) {
    if (t[0] === '/') {
      const [cmd, ...rest] = t.slice(1).split(/\s+/), arg = rest.join(' ');
      const c = cmd.toLowerCase();
      if (c === 'tpa' || c === 'tpask') { if (!arg) this.line('', 'Type /tpa and a player\'s name.', 'sys'); else this.tpa(arg); return; }
      if (c === 'tpaccept' || c === 'tpyes') { const R = arg && [...this.remotes.values()].find(r => r.name.toLowerCase() === arg.toLowerCase()); this.net.send({ t: 'tpaccept', id: R ? R.id : 0 }); return; }
      if (c === 'tpdeny' || c === 'tpno') { const R = arg && [...this.remotes.values()].find(r => r.name.toLowerCase() === arg.toLowerCase()); this.net.send({ t: 'tpdeny', id: R ? R.id : 0 }); return; }
      if (c === 'list' || c === 'players') { this.toggleList(true); return; }
      this.line('', 'Commands: /tpa name, /tpaccept, /tpdeny, /list', 'sys');
      return;
    }
    if (!this.net.send({ t: 'chat', text: t })) this.line('', 'Not connected, so nobody saw that.', 'sys');
  }
  line(name, text, cls, keep) {
    const el = document.createElement('div'); el.className = 'mp-line ' + (cls || '');
    el.innerHTML = (name ? '<b>' + esc(name) + '</b>' : '') + esc(text);
    el.dataset.t = String(performance.now());
    if (keep) el.dataset.until = String(performance.now() + 120000);
    this.lines.appendChild(el);
    while (this.lines.children.length > 40) this.lines.firstChild.remove();
    return el;
  }
  chatStep(now) {
    if (((this.cs = (this.cs || 0) + 1) & 15) !== 0) return;
    for (const el of this.lines.children) {
      const until = +(el.dataset.until || 0), t = +el.dataset.t;
      el.classList.toggle('fade', now > Math.max(until, t + 12000));
      if (until && now > until) el.querySelectorAll('button').forEach(b => b.remove());
    }
  }
  key(e) {
    const D = this.drive;
    if (!D.active || this.dead) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'KeyT' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === '/') {
      if (e.repeat) return;
      e.preventDefault(); e.stopImmediatePropagation();
      this.openChat();
      if (e.key === '/') this.input.value = '/';
      return;
    }
    if (e.code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) this.toggleList(); return; }
    if (e.code === 'Escape' && this.listOn) { this.toggleList(false); }
  }

  // ---- the player list (Tab) ---------------------------------------------------------------------------------
  makeList() {
    const el = this.listEl = document.createElement('div'); el.className = 'mp-list'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Players in this room');
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-tp]'); if (b) { this.tpa(+b.dataset.tp); b.textContent = 'Asked'; b.disabled = true; return; }
      if (e.target.closest('button[data-close]')) this.toggleList(false);
    });
  }
  toggleList(on) { this.listOn = on ?? !this.listOn; this.listEl.classList.toggle('on', this.listOn); if (this.listOn) this.renderList(); }
  renderList() {
    if (!this.listOn || !this.listEl) return;
    const C = this.drive.mods.cars, where = new Map((this.where || []).map(w => [w[0], w]));
    const me = this.drive.car && this.drive.car.vehicle ? (this.drive.onfoot && this.drive.onfoot.mode !== 'car' ? this.drive.onfoot.pos : this.drive.car.vehicle.pos) : null;
    const carName = id => (C && C.CARS.find(c => c.id === id) || {}).name || '';
    const dist = (x, z) => { if (!me) return ''; const d = Math.hypot(x - me.x, z - me.z); return d < 1000 ? Math.round(d) + ' m away' : (d / 1000).toFixed(1) + ' km away'; };
    let h = '<h3>' + esc(this.room.name) + '</h3><div class="mp-sub">' + (this.room.place && this.room.place.label ? esc(this.room.place.label) + ' · ' : '') + (this.remotes.size + 1) + ' of 16 players' + (this.room.pub ? ' · public' : ' · private, code <b>' + esc(this.room.code) + '</b>') + '</div>';
    const row = (id, name, sub, btn) => '<div class="mp-row"><div class="mp-dot" style="background:' + this.colorOf(id) + '">' + esc(name.slice(0, 1).toUpperCase()) + '</div><div class="mp-who"><div>' + esc(name) + (id === (this.role === null ? this.me.id : this.role) ? ' <span style="color:#70757a;font-weight:400">· runs the traffic here</span>' : '') + '</div><div>' + esc(sub) + '</div></div>' + (btn || '') + '</div>';
    h += row(this.me.id, this.me.name + ' (you)', this.drive.car && this.drive.car.id ? carName(this.drive.car.id) : 'On foot', '');
    for (const R of this.remotes.values()) {
      const w = where.get(R.id), x = w ? w[1] : R.pos.x, z = w ? w[2] : R.pos.z;
      const what = R.mode && R.mode !== 'car' ? 'On foot' : (carName(R.carId || (w && w[3])) || 'Driving');
      h += row(R.id, R.name, what + (w || R.has ? ' · ' + dist(x, z) : ''), '<button data-tp="' + R.id + '" aria-label="Ask to go to ' + esc(R.name) + '">Ask to go there</button>');
    }
    h += '<div class="mp-row" style="justify-content:flex-end"><span style="flex:1;color:#70757a;font-size:13px">Tab closes this list</span><button data-close="1">Close</button></div>';
    this.listEl.innerHTML = h;
  }

  showHint(t) { this.hint.textContent = t; this.hint.classList.toggle('on', !!t); }

  // a person to put at the wheel of another player's car (called by occupants.js each frame)
  occupy(occ, want) {
    for (const R of this.remotes.values()) {
      const rig = R.rig, p = R.person;
      if (!rig || !p || R.mode !== 'car' || !rig.object.visible || R.d > 80) { if (R.seated && (R.mode !== 'car' || !rig)) R.unseat(); continue; }
      const Rec = occ.ensure(rig, rig, 'player');
      if (!Rec.netFilled) { Rec.netFilled = true; Rec.fill.fill(false); }
      if (!Rec.people.some(o => o.person === p)) {
        Rec.people = Rec.people.filter(o => o.seat !== 0);
        if (!seatsOf(rig).length) continue;
        occ.seat(Rec, 0, p, { player: true });
        R.seated = Rec;
      }
      want.add(Rec);
    }
  }

  dispose() {
    this.dead = true;
    for (const f of this.offs) f(); this.offs = [];
    for (const f of this.undo.reverse()) { try { f(); } catch (e) {} } this.undo = [];
    if (this.npc) { try { this.npc.dispose(); } catch (e) {} this.npc = null; }
    for (const R of this.remotes.values()) R.dispose();
    this.remotes.clear();
    if (this.drive.net === this) this.drive.net = null;
    this.tagsEl.remove(); this.chat.remove(); this.listEl.remove(); this.hint.remove(); if (this.tb) this.tb.remove();
    if (window.__mp === this) window.__mp = null;
  }
}

// a point and heading some metres along a lane (as drive.js's own lanePoint)
function lanePoint(L, s) {
  const c = L.cum, p = L.pts, n = p.length;
  let i = 1; while (i < n - 1 && c[i] < s) i++;
  const a = p[i - 1], b = p[i], t = Math.max(0, Math.min(1, (s - c[i - 1]) / Math.max(1e-6, c[i] - c[i - 1])));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, heading: (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180 / Math.PI + 360) % 360, lane: L };
}
