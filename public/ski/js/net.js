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
    else if (m.type === 'look') { const r = this.remotes.get(m.id); if (r) this.relook(r, m.rider || r.rider, m.look || {}); }
    else if (m.type === 'trick') { const r = this.remotes.get(m.id); if (r) this.onTrick(r.name, m.name, m.pts); }
    else if (m.type === 'chat') this.onChat({ name: m.name, text: m.text, me: m.id === this.id });
    else if (m.type === 'nope') { this.onStatus(m.why); this.want = null; }
  }
  status() { this.onStatus(`${this.priv ? 'Private room' : 'Public park'} ${this.code}: ${this.remotes.size + 1} rider${this.remotes.size ? 's' : ''}`); }
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
          sw: s.sw, speed: c.v.length(), vel: c.v, balance: s.b, t: time, tweak: s.tw || '', shift: s.sh || 0, skate: s.sk || 0, absorb: s.ab || 0, railAng: s.ra || 0, railPress: s.rp || 0, lookBack: !!s.lb, liftSit: lk ? lk.sit : 0, liftFeet: lk ? lk.feet : null, act: xa, actT: xt, actN: xa ? s.x.rc || 0 : 0, actNext: !!(xa && s.x.rn) }, dt);
        for (const o of r.rig.root.children) if (o !== r.rig.body) o.updateMatrixWorld(true);
      }
      // the name over the helmet
      v.copy(p); v.y += 2.1; v.project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      r.tag.style.display = on ? '' : 'none';
      if (on) r.tag.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(0)}px, ${((1 - v.y) / 2 * h).toFixed(0)}px) translate(-50%, -100%)`;
    }
  }
  // (L) the state's open bag: whatever the modules put in it, or nothing
  xOut(sk) { if (!this.xFns.length) return undefined; const x = {}; for (const f of this.xFns) f(x, sk); for (const k in x) return x; return undefined; }
  trick(name, pts) { if (this.code) this.send({ type: 'trick', name, pts }); }
  chat(text) { if (this.code) this.send({ type: 'chat', text }); }
}
