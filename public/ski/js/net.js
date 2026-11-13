// Riding with others: the park lobby on mlhub (?mode=ski). Every page rides its own skier and sends where it is
// and how it stands 12 times a second; the others are drawn from that, 150 ms behind so they move smoothly, each
// with its name over the helmet. Tricks and chat go to the room.
// (M, 2026-11-10) Each map has public parks of its own (join's map), a page may join to watch instead of ride (join's
// watch, or setWatch: nothing is sent and the others do not draw it), and countUrl() is where the home screen asks how
// many ride and watch on each map (online.js).
import * as THREE from 'three';

const SEND_HZ = 12, DELAY = 0.15;
const _tv = new THREE.Vector3();
const ST = ['ground', 'air', 'rail', 'crash'];
/* (2026-11-12, for "rooms ... close after 10 minutes of afk") the relay closes a room nobody has done anything in for
   10 minutes (skipark.js): it says why ({ type: 'closed', why: 'idle', text }) and closes the socket with IDLE_CODE. A
   page says now and then (act, at most every ACT_MS, or a quarter of the relay's limit) that its player pressed a key,
   clicked or touched the screen since the last time; its own states never count (a rider left alone slides down the
   slope, crashes and is put back by itself). */
export const IDLE_CODE = 4001;
const IDLE_WORDS = 'This room closed after 10 minutes with nobody active.', ACT_MS = 20000;

function serverUrl() {
  const q = new URLSearchParams(location.search).get('mp');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (q && local) return q + (q.includes('?') ? '&' : '?') + 'mode=ski';
  if (local) return 'ws://127.0.0.1:8851/ws?mode=ski';
  return 'wss://apps.leonzhao.dev/mc/ws?mode=ski';
}
// (M) the relay's GET /mc/ski/count, from the same place as the socket
export function countUrl() {
  const u = new URL(serverUrl());
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'; u.pathname = '/mc/ski/count'; u.search = '';
  return u.href;
}

export class Net {
  constructor({ scene, camera, makeRig, onTrick, onChat, onStatus, getLook }) {
    Object.assign(this, { scene, camera, makeRig, onTrick, onChat, onStatus, getLook });
    this.ws = null; this.id = 0; this.code = ''; this.remotes = new Map(); this.sendT = 0; this.open = false;
    // (M) watching instead of riding (the room's riders are drawn, ours is not sent), how many watch in the room, the
    // rider whose name tag is hidden (followed in first person), and hooks for online.js: onInit(m), onMode(watching)
    this.watching = false; this.watchN = 0; this.noTag = 0; this.onInit = null; this.onMode = null; this._posed = false;
    this.tags = document.getElementById('tags');
    // (the player's last key, click or touch, and the last act sent; onClosed(text): a room closed for idleness)
    this.inputAt = performance.now(); this.actAt = 0; this.idleMs = 0; this.onClosed = null;
    const seen = () => { this.inputAt = performance.now(); };
    for (const t of ['keydown', 'pointerdown', 'touchstart', 'wheel']) addEventListener(t, seen, { capture: true, passive: true });
    // (L) what fills the state's open bag x: functions fn(x, skier) (the relay passes up to 24 short keys), and the
    // chairlift, so a rider on a chair is drawn on this page's own chair
    this.xFns = []; this.lift = null;
    // (X) the extra rides' timed tricks (a tailwhip, a bar spin, a briflip...) go in it too: ra the trick, rt how far into
    // this round (s); the others' pages carry the time on from the snapshot, so the part turns smoothly there
    this.xFns.push((x, sk) => { if (sk.act) { x.ra = sk.act; x.rt = Math.round(sk.actT * 1000) / 1000; if (sk.actN) x.rc = sk.actN; if (sk.actNext) x.rn = true; } });
    // (P, 2026-11-08) what the poses read from the physics, sent only while it changes the look: one foot (of: x the side
    // stood on), feet together (tg), the push (pt phase, pu how much), the takeoff (tp pop, tc crouch, ti pitch) in the air,
    // the landing (lh how hard, lo the travel off the skis) for 1.5 s after it, the crash's kind (fk), the order of tricks
    // (sq, the last few joined by commas) and what S or N held will land into (lz; li is F's, the lift)
    this.xFns.push((x, sk) => {
      const r2 = v => Math.round(v * 100) / 100;
      if (sk.oneFoot > 0.02) x.of = r2(sk.oneFoot * (sk.oneSide || 1));
      if (sk.together > 0.02) x.tg = r2(sk.together);
      if (sk.pushing > 0.02) { x.pt = r2(sk.pushT); x.pu = r2(sk.pushing); }
      if (sk.state === 'air' && sk.lastTakeoff) { const T = sk.lastTakeoff; x.tp = r2(T.pop); x.tc = r2(T.crouch); x.ti = r2(T.pitch); }
      if (sk.state !== 'air' && sk.landT < 1.5 && sk.landHit) { x.lh = r2(sk.landHit); x.lo = r2(sk.landOff); }
      if (sk.state === 'crash' && sk.fallKind) x.fk = sk.fallKind;
      const sq = sk.state === 'air' ? sk.airSeq : sk.trickSeq;
      if (sq && sq.length && (sk.state !== 'ground' || sk.landT < 1.5)) { let o = ''; for (let i = sq.length - 1; i >= 0; i--) { const t = sq[i] + (o ? ',' + o : ''); if (t.length > 24) break; o = t; } if (o) x.sq = o; }
      if (sk.landInto) x.lz = sk.landInto;
    });
  }
  get inRoom() { return !!this.code; }
  connect(name, rider, { code = '', priv = false, watch = false } = {}) {
    this.close();
    this.want = { name, rider, code, priv, watch };
    let ws;
    try { ws = this.ws = new WebSocket(serverUrl()); } catch (e) { this.onStatus('Could not reach the park server.'); return; }
    this.onStatus('Connecting...');
    // (look: how this rider looks to the others, e.g. ride: 'ski' | 'board' and stance; the relay passes it on as it is)
    // (M: map, the map's own public park; watch, in to watch)
    // (act: this page sends act messages and reads closed, 2026-11-12)
    ws.onopen = () => { this.open = true; this.actAt = 0; ws.send(JSON.stringify({ type: 'join', name, rider, code, priv, map: this.map || 'jumpline', watch: !!watch, act: true, look: this.getLook ? this.getLook() : undefined })); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } this.message(m); };
    ws.onclose = e => {
      const was = this.code; this.open = false; this.code = ''; this.clearRemotes();
      if (this.ws !== ws) return;
      // (closed by the relay because nobody was active in the room: no reconnecting; the closed message says why, this is
      // in case it did not come)
      if (e && e.code === IDLE_CODE) { this.ws = null; this.idleClosed({ text: IDLE_WORDS }); return; }
      this.onStatus(was ? 'Lost the connection to the park.' : 'Could not reach the park server.'); if (was && this.want) this.retry = setTimeout(() => this.connect(this.want.name, this.want.rider, { code: was, priv: this.want.priv, watch: this.watching }), 2500);
    };
    ws.onerror = () => {};
  }
  close() { clearTimeout(this.retry); if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch (e) {} } this.code = ''; this.watchN = 0; this.watching = false; this.clearRemotes(); }
  leave() { this.want = null; this.close(); this.onStatus(''); }
  send(m) { if (this.ws && this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  message(m) {
    if (m.type === 'init') {
      // (M: an init on the same socket is a new room, a watcher put in another park to ride: the old room's riders go)
      if (this.code && this.code !== m.code) this.clearRemotes();
      this.id = m.id; this.code = m.code; this.priv = m.priv; this.watching = !!m.watch; this.watchN = m.watching || 0;
      if (this.want) this.want.watch = this.watching;
      for (const p of m.players) this.add(p);
      this.status();
      if (this.onInit) this.onInit(m);
    } else if (m.type === 'join') { this.add(m.player); this.status(); this.onChat({ sys: true, text: m.player.name + ' joined the park' }); }
    else if (m.type === 'leave') { const r = this.remotes.get(m.id); if (r) { this.onChat({ sys: true, text: r.name + (m.watch ? ' is watching now' : ' left') }); this.remove(m.id); this.status(); } }
    else if (m.type === 'watchers') { this.watchN = m.n | 0; this.status(); }
    else if (m.type === 'mode') { this.watching = !!m.watch; if (this.want) this.want.watch = this.watching; this.status(); if (this.onMode) this.onMode(this.watching); }
    else if (m.type === 's') { const r = this.remotes.get(m.id); if (r) this.push(r, m.s); }
    else if (m.type === 'look') { const r = this.remotes.get(m.id); if (r) { this.relook(r, m.rider || r.rider, m.look || {}); this.status(); } }
    else if (m.type === 'trick') { const r = this.remotes.get(m.id); if (r) this.onTrick(r.name, m.name, m.pts); }
    else if (m.type === 'chat') this.onChat({ name: m.name, text: m.text, me: m.id === this.id });
    else if (m.type === 'nope') { this.onStatus(m.why); if (!m.keep) this.want = null; else if (this.onMode) this.onMode(this.watching, m.why); }   // (keep: still in the room)
    else if (m.type === 'hello') this.idleMs = m.idle || 0;
    else if (m.type === 'closed') this.idleClosed(m);
  }
  // the room closed because nobody in it was active: out of it for good (no reconnecting), the status says why, and
  // main.js (onClosed) takes the page back to the menu
  idleClosed(m) {
    const text = (m && m.text) || IDLE_WORDS;
    this.want = null; this.close();
    this.onStatus(text);
    if (this.onClosed) { try { this.onClosed(text); } catch (e) { console.warn('closed', e); } }
  }
  status() {
    let here = 1; for (const r of this.remotes.values()) if (!(this.map && r.look.map && r.look.map !== this.map)) here++;
    // (M: a watcher is not one of the riders; how many watch, when anyone does)
    const me = this.watching ? 0 : 1, all = this.remotes.size + me; here -= 1 - me;
    const w = this.watchN ? `, ${this.watchN} watching` : '';
    this.onStatus(`${this.watching ? (this.priv ? 'Watching the private room' : 'Watching the public park') : this.priv ? 'Private room' : 'Public park'} ${this.code}: ${all} rider${all !== 1 ? 's' : ''}${here < all ? `, ${here} on this map` : ''}${w}`);
  }
  // (M) watch (true) or ride (false) in the room you are in; the server answers with a mode (or a new room)
  setWatch(on) { if (this.code) this.send({ type: 'watch', on: !!on }); }
  add(p) {
    if (this.remotes.has(p.id)) return;
    const tag = document.createElement('div'); tag.className = 'ntag'; tag.textContent = p.name; this.tags.appendChild(tag);
    const r = { id: p.id, name: p.name, rider: p.rider, look: p.look || {}, buf: [], rig: null, tag, t: 0, gen: 0 };
    this.remotes.set(p.id, r);
    if (p.s) this.push(r, p.s);
    this.relook(r, p.rider, r.look);
  }
  // (re)build a rider's rig for how they look now (a new ride, stance or outfit); the old one stays until the new is in
  relook(r, rider, look) {
    r.rider = rider; r.look = look || {};
    const gen = ++r.gen;
    this.makeRig(rider, r.look).then(rig => {
      if (!this.remotes.has(r.id) || gen !== r.gen) return;
      if (r.rig) { this.scene.remove(r.rig.root); if (r.rig.dispose) r.rig.dispose(); }   // (R: the old one freed)
      r.rig = rig; rig.root.visible = false; this.scene.add(rig.root);   // (C: shown once posed, in pose())
    }).catch(() => {});
  }
  // tell the room how we look now (sent again on a change)
  sendLook(rider) { if (this.code) this.send({ type: 'look', rider, look: this.getLook ? this.getLook() : {} }); }
  remove(id) { const r = this.remotes.get(id); if (!r) return; if (r.rig) { this.scene.remove(r.rig.root); if (r.rig.dispose) r.rig.dispose(); } r.tag.remove(); this.remotes.delete(id); }
  clearRemotes() { for (const id of [...this.remotes.keys()]) this.remove(id); }
  push(r, s) {
    const now = performance.now() / 1000;
    r.buf.push({ t: now, p: new THREE.Vector3().fromArray(s.p), q: new THREE.Quaternion().fromArray(s.q).normalize(), v: new THREE.Vector3().fromArray(s.v || [0, 0, 0]), s });
    if (r.buf.length > 12) r.buf.shift();
  }
  // send ours, draw theirs
  update(dt, sk, time) {
    const posed = this._posed; this._posed = false;     // (M: posed already this frame, by online.js)
    if (!this.code) return;
    this.sendT += dt;
    if (this.sendT >= 1 / SEND_HZ && !this.watching) {   // (M: a watcher sends nothing)
      this.sendT = 0;
      const r3 = v => Math.round(v * 1000) / 1000;
      this.send({ type: 's', p: sk.p.toArray().map(r3), q: sk.q.toArray().map(r3), v: sk.v.toArray().map(r3), st: sk.state === 'lift' ? 0 : ST.indexOf(sk.state),   // (L: on the chairlift x.lf says so; st is ignored then)
        c: r3(sk.crouch), e: r3(sk.edge), tk: r3(sk.tuck), pr: r3(sk.press), b: r3(sk.balance || 0), br: r3(sk.brake), sw: sk.sw, g: sk.grab || null, po: sk.pose || null,
        tw: sk.tweak || '', sh: r3(sk.shift || 0), sk: r3(sk.skate || 0), ab: r3(sk.absorb || 0), ra: r3(sk.railAng || 0), rp: r3(sk.railPress || 0), lb: !!sk.lookBack, x: this.xOut(sk) });
    }
    // (2026-11-12) the player at the keys since the last time: said now and then (a watcher's keys keep no room open)
    if (!this.watching) {
      const now = performance.now(), every = Math.max(1000, Math.min(ACT_MS, (this.idleMs || 600000) / 4));
      if (this.inputAt > this.actAt && now - this.actAt >= every) { this.actAt = now; this.send({ type: 'act' }); }
    }
    if (!posed) this.pose(dt, time);
    // the names over the helmets, through this frame's camera
    const w = innerWidth, h = innerHeight, v = _tv;
    for (const r of this.remotes.values()) {
      const V = r.view;
      if (!V || !V.shown || r.id === this.noTag) { if (r.tagOn !== false) { r.tag.style.display = 'none'; r.tagOn = false; } continue; }
      v.copy(V.p); v.y += 2.1; v.project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      if (on !== r.tagOn) { r.tag.style.display = on ? '' : 'none'; r.tagOn = on; }
      if (on) r.tag.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(0)}px, ${((1 - v.y) / 2 * h).toFixed(0)}px) translate(-50%, -100%)`;
    }
  }
  /* (M) the others posed for this frame: each between its two snapshots either side of 150 ms ago, its rig updated, and
     r.view kept: where it is and how it rides as the cameras read a skier (p, q, v, com, state, crouch...), and shown
     (false for a rider on another map). update() calls it, or online.js does first when the camera follows one of them. */
  pose(dt, time) {
    this._posed = true;
    if (!this.code) return;
    const now = performance.now() / 1000 - DELAY;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      /* (C, 2026-11-11, for "head sometimes disappears especialyl in multiplayer") a rider with no place heard yet (just
         joined, or their page has not sent one) is not drawn: never posed, their rig stood at the middle of the world in
         its resting shape, with its helmet and goggles at its feet, since those are put on the head by the pose */
      if (!b.length) { if (r.rig) r.rig.root.visible = false; if (r.view) r.view.shown = false; continue; }
      const V = r.view || (r.view = { p: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), com: new THREE.Vector3(), state: 'ground', shown: false });
      // (a rider on another map is in the room but not on this mountain: not drawn here, their tricks still in the feed)
      const away = !!(this.map && r.look.map && r.look.map !== this.map);
      if (r.rig) r.rig.root.visible = !away && !!r.rig.ready;
      V.shown = !away;
      if (away) continue;
      let a = b[0], c = b[b.length - 1], k = 0;
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= now && b[i + 1].t >= now) { a = b[i]; c = b[i + 1]; k = (now - a.t) / Math.max(1e-3, c.t - a.t); break; }
      const p = V.p, q = V.q;
      if (now > c.t) { p.copy(c.p).addScaledVector(c.v, Math.min(0.25, now - c.t)); q.copy(c.q); }
      else { p.lerpVectors(a.p, c.p, k); q.slerpQuaternions(a.q, c.q, k); }
      const snap = now > c.t ? c : k < 0.5 ? a : c, s = snap.s;      // (X: past the last snapshot, the last one's state, not the oldest's)
      const xa = s.x && s.x.ra ? s.x.ra : null, xt = xa ? Math.max(0, (s.x.rt || 0) + (now - snap.t)) : 0;   // (X)
      // (L) a rider on the chairlift sits on this page's own chair of that number, so they ride it exactly
      const lk = s.x && s.x.lf && this.lift ? this.lift.remoteSeat(s.x, p, q, r.lk || (r.lk = {})) : null;
      if (r.rig && r.rig.ready) {
        r.rig.update({ p, q, state: lk ? 'lift' : s.x && s.x.lf ? 'ground' : ST[s.st] || 'ground', edge: s.e, crouch: s.c, tuck: s.tk, brake: s.br, press: s.pr, grab: s.g, pose: s.po,
          sw: s.sw, speed: c.v.length(), vel: c.v, balance: s.b, t: time, tweak: s.tw || '', shift: s.sh || 0, skate: s.sk || 0, absorb: s.ab || 0, railAng: s.ra || 0, railPress: s.rp || 0, lookBack: !!s.lb, liftSit: lk ? lk.sit : 0, liftFeet: lk ? lk.feet : null, liftKind: lk ? lk.kind || 'chair' : '', tbar: lk ? lk.tbar || null : null, /* (J: on the T-bar, tbar.js remoteSeat) */ act: xa, actT: xt, actN: xa ? s.x.rc || 0 : 0, actNext: !!(xa && s.x.rn), ...this.pOf(r, s, ST[s.st] || 'ground', now) }, dt);   // (P: one foot, the push, takeoff, landing, crash, the order of tricks)
        for (const o of r.rig.root.children) if (o !== r.rig.body) o.updateMatrixWorld(true);
      }
      // (M) as the cameras and the speed read a skier: the body's middle over the feet, the state and the pose numbers
      V.state = lk ? 'lift' : s.x && s.x.lf ? 'ground' : ST[s.st] || 'ground';
      V.liftKind = lk ? lk.kind || 'chair' : '';
      V.v.copy(c.v); V.crouch = s.c || 0; V.edge = s.e || 0; V.balance = s.b || 0; V.brake = s.br || 0; V.grab = s.g || null; V.pose = s.po || null; V.act = xa;
      V.com.set(0, 0.92 * (1 - V.crouch * 0.35), 0).applyQuaternion(q).add(p);
    }
  }
  /* (P) the physics' pose fields from another rider's x (see the xFns above), the same names as main.js poseState: the
     times (takeoff.t, landT, fallT) are counted here from when their state changed */
  pOf(r, s, st, now) {
    const x = s.x || {}, P = r.P || (r.P = { takeoff: { pop: 0, crouch: 0, speed: 0, pitch: 0, t: 9, how: '' }, trickSeq: [], airSeq: [], landT: 9 });
    if (st !== r.pst) { if (st === 'air') r.airAt = now; if (st === 'crash') r.crashAt = now; if (r.pst === 'air' && (st === 'ground' || st === 'rail')) r.landAt = now; r.pst = st; }
    P.oneFoot = Math.abs(x.of || 0); P.oneSide = (x.of || 0) < 0 ? -1 : 1; P.together = x.tg || 0;
    P.pushing = x.pu || 0; P.pushT = x.pu ? x.pt || 0 : 0;
    const T = P.takeoff; if (x.tp !== undefined) { T.pop = x.tp; T.crouch = x.tc || 0; T.pitch = x.ti || 0; } T.t = r.airAt !== undefined ? now - r.airAt : 9;
    P.landHit = x.lh || 0; P.landOff = x.lo || 0; P.landT = r.landAt !== undefined ? now - r.landAt : 9;
    P.fallKind = x.fk || ''; P.fallT = st === 'crash' && r.crashAt !== undefined ? now - r.crashAt : 0;
    if (x.sq !== r.sqs) { r.sqs = x.sq; P.trickSeq = x.sq ? x.sq.split(',') : []; }
    P.airSeq = st === 'air' ? P.trickSeq : P.airSeq;
    P.landInto = x.lz || null;
    return P;
  }
  // (L) the state's open bag: whatever the modules put in it, or nothing
  xOut(sk) { if (!this.xFns.length) return undefined; const x = {}; for (const f of this.xFns) f(x, sk); for (const k in x) return x; return undefined; }
  trick(name, pts) { if (this.code) this.send({ type: 'trick', name, pts }); }
  chat(text) { if (this.code) this.send({ type: 'chat', text }); }
}
