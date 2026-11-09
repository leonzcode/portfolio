// Riding with others: the park lobby on mlhub (?mode=ski). Every page rides its own skier and sends where it is
// and how it stands 12 times a second; the others are drawn from that, 150 ms behind so they move smoothly, each
// with its name over the helmet. Tricks and chat go to the room.
import * as THREE from 'three';

const SEND_HZ = 12, DELAY = 0.15;
const ST = ['ground', 'air', 'rail', 'crash'];

function serverUrl() {
  const q = new URLSearchParams(location.search).get('mp');
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (q && local) return q + (q.includes('?') ? '&' : '?') + 'mode=ski';
  if (local) return 'ws://127.0.0.1:8851/ws?mode=ski';
  return 'wss://apps.leonzhao.dev/mc/ws?mode=ski';
}

export class Net {
  constructor({ scene, camera, makeRig, onTrick, onChat, onStatus, getLook }) {
    Object.assign(this, { scene, camera, makeRig, onTrick, onChat, onStatus, getLook });
    this.ws = null; this.id = 0; this.code = ''; this.remotes = new Map(); this.sendT = 0; this.open = false;
    this.tags = document.getElementById('tags');
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
  connect(name, rider, { code = '', priv = false } = {}) {
    this.close();
    this.want = { name, rider, code, priv };
    let ws;
    try { ws = this.ws = new WebSocket(serverUrl()); } catch (e) { this.onStatus('Could not reach the park server.'); return; }
    this.onStatus('Connecting...');
    // (look: how this rider looks to the others, e.g. ride: 'ski' | 'board' and stance; the relay passes it on as it is)
    ws.onopen = () => { this.open = true; ws.send(JSON.stringify({ type: 'join', name, rider, code, priv, look: this.getLook ? this.getLook() : undefined })); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } this.message(m); };
    ws.onclose = () => {
      const was = this.code; this.open = false; this.code = ''; this.clearRemotes();
      if (this.ws === ws) { this.onStatus(was ? 'Lost the connection to the park.' : 'Could not reach the park server.'); if (was && this.want) this.retry = setTimeout(() => this.connect(this.want.name, this.want.rider, { code: was, priv: this.want.priv }), 2500); }
    };
    ws.onerror = () => {};
  }
  close() { clearTimeout(this.retry); if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch (e) {} } this.code = ''; this.clearRemotes(); }
  leave() { this.want = null; this.close(); this.onStatus(''); }
  send(m) { if (this.ws && this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  message(m) {
    if (m.type === 'init') {
      this.id = m.id; this.code = m.code; this.priv = m.priv;
      for (const p of m.players) this.add(p);
      this.status();
    } else if (m.type === 'join') { this.add(m.player); this.status(); this.onChat({ sys: true, text: m.player.name + ' joined the park' }); }
    else if (m.type === 'leave') { const r = this.remotes.get(m.id); if (r) { this.onChat({ sys: true, text: r.name + ' left' }); this.remove(m.id); this.status(); } }
    else if (m.type === 's') { const r = this.remotes.get(m.id); if (r) this.push(r, m.s); }
    else if (m.type === 'look') { const r = this.remotes.get(m.id); if (r) { this.relook(r, m.rider || r.rider, m.look || {}); this.status(); } }
    else if (m.type === 'trick') { const r = this.remotes.get(m.id); if (r) this.onTrick(r.name, m.name, m.pts); }
    else if (m.type === 'chat') this.onChat({ name: m.name, text: m.text, me: m.id === this.id });
    else if (m.type === 'nope') { this.onStatus(m.why); this.want = null; }
  }
  status() {
    let here = 1; for (const r of this.remotes.values()) if (!(this.map && r.look.map && r.look.map !== this.map)) here++;
    const all = this.remotes.size + 1;
    this.onStatus(`${this.priv ? 'Private room' : 'Public park'} ${this.code}: ${all} rider${all > 1 ? 's' : ''}${here < all ? `, ${here} on this map` : ''}`);
  }
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
      r.rig = rig; this.scene.add(rig.root);
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
    if (!this.code) return;
    this.sendT += dt;
    if (this.sendT >= 1 / SEND_HZ) {
      this.sendT = 0;
      const r3 = v => Math.round(v * 1000) / 1000;
      this.send({ type: 's', p: sk.p.toArray().map(r3), q: sk.q.toArray().map(r3), v: sk.v.toArray().map(r3), st: sk.state === 'lift' ? 0 : ST.indexOf(sk.state),   // (L: on the chairlift x.lf says so; st is ignored then)
        c: r3(sk.crouch), e: r3(sk.edge), tk: r3(sk.tuck), pr: r3(sk.press), b: r3(sk.balance || 0), br: r3(sk.brake), sw: sk.sw, g: sk.grab || null, po: sk.pose || null,
        tw: sk.tweak || '', sh: r3(sk.shift || 0), sk: r3(sk.skate || 0), ab: r3(sk.absorb || 0), ra: r3(sk.railAng || 0), rp: r3(sk.railPress || 0), lb: !!sk.lookBack, x: this.xOut(sk) });
    }
    const now = performance.now() / 1000 - DELAY;
    const w = innerWidth, h = innerHeight, v = new THREE.Vector3();
    for (const r of this.remotes.values()) {
      const b = r.buf; if (!b.length) continue;
      // (a rider on another map is in the room but not on this mountain: not drawn here, their tricks still in the feed)
      const away = !!(this.map && r.look.map && r.look.map !== this.map);
      if (r.rig) r.rig.root.visible = !away;
      if (away) { r.tag.style.display = 'none'; continue; }
      let a = b[0], c = b[b.length - 1], k = 0;
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= now && b[i + 1].t >= now) { a = b[i]; c = b[i + 1]; k = (now - a.t) / Math.max(1e-3, c.t - a.t); break; }
      const p = new THREE.Vector3(), q = new THREE.Quaternion();
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
      // the name over the helmet
      v.copy(p); v.y += 2.1; v.project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      r.tag.style.display = on ? '' : 'none';
      if (on) r.tag.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(0)}px, ${((1 - v.y) / 2 * h).toFixed(0)}px) translate(-50%, -100%)`;
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
