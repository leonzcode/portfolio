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
  constructor({ scene, camera, makeRig, onTrick, onChat, onStatus }) {
    Object.assign(this, { scene, camera, makeRig, onTrick, onChat, onStatus });
    this.ws = null; this.id = 0; this.code = ''; this.remotes = new Map(); this.sendT = 0; this.open = false;
    this.tags = document.getElementById('tags');
  }
  get inRoom() { return !!this.code; }
  connect(name, rider, { code = '', priv = false } = {}) {
    this.close();
    this.want = { name, rider, code, priv };
    let ws;
    try { ws = this.ws = new WebSocket(serverUrl()); } catch (e) { this.onStatus('Could not reach the park server.'); return; }
    this.onStatus('Connecting...');
    ws.onopen = () => { this.open = true; ws.send(JSON.stringify({ type: 'join', name, rider, code, priv })); };
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
    else if (m.type === 'trick') { const r = this.remotes.get(m.id); if (r) this.onTrick(r.name, m.name, m.pts); }
    else if (m.type === 'chat') this.onChat({ name: m.name, text: m.text, me: m.id === this.id });
    else if (m.type === 'nope') { this.onStatus(m.why); this.want = null; }
  }
  status() { this.onStatus(`${this.priv ? 'Private room' : 'Public park'} ${this.code}: ${this.remotes.size + 1} rider${this.remotes.size ? 's' : ''}`); }
  add(p) {
    if (this.remotes.has(p.id)) return;
    const tag = document.createElement('div'); tag.className = 'ntag'; tag.textContent = p.name; this.tags.appendChild(tag);
    const r = { id: p.id, name: p.name, rider: p.rider, buf: [], rig: null, tag, t: 0 };
    this.remotes.set(p.id, r);
    if (p.s) this.push(r, p.s);
    this.makeRig(p.rider).then(rig => { if (!this.remotes.has(p.id)) return; r.rig = rig; this.scene.add(rig.root); }).catch(() => {});
  }
  remove(id) { const r = this.remotes.get(id); if (!r) return; if (r.rig) this.scene.remove(r.rig.root); r.tag.remove(); this.remotes.delete(id); }
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
      this.send({ type: 's', p: sk.p.toArray().map(r3), q: sk.q.toArray().map(r3), v: sk.v.toArray().map(r3), st: ST.indexOf(sk.state),
        c: r3(sk.crouch), e: r3(sk.edge), tk: r3(sk.tuck), pr: r3(sk.press), b: r3(sk.balance || 0), br: r3(sk.brake), sw: sk.sw, g: sk.grab || null, po: sk.pose || null });
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
      const s = (k < 0.5 ? a : c).s;
      if (r.rig && r.rig.ready) {
        r.rig.update({ p, q, state: ST[s.st] || 'ground', edge: s.e, crouch: s.c, tuck: s.tk, brake: s.br, press: s.pr, grab: s.g, pose: s.po,
          sw: s.sw, speed: c.v.length(), vel: c.v, balance: s.b, t: time }, dt);
        for (const o of r.rig.root.children) if (o !== r.rig.body) o.updateMatrixWorld(true);
      }
      // the name over the helmet
      v.copy(p); v.y += 2.1; v.project(this.camera);
      const on = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      r.tag.style.display = on ? '' : 'none';
      if (on) r.tag.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(0)}px, ${((1 - v.y) / 2 * h).toFixed(0)}px) translate(-50%, -100%)`;
    }
  }
  trick(name, pts) { if (this.code) this.send({ type: 'trick', name, pts }); }
  chat(text) { if (this.code) this.send({ type: 'chat', text }); }
}
