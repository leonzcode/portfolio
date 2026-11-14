// Riding online (M, 2026-11-10, for "multiplayer is another option as well and you can join multiplayer on either of the
// maps and there are distinct multiplayer buttons on screen ... under the regular join buttons and they also show how
// many people are online and you can also spectate people as well").
//
// - The home screen's online board (index.html #online): for each map a Ride online and a Watch button and how many
//   ride and watch there, asked of the relay (GET /mc/ski/count, net.js countUrl) every 5 s while the menu is up. One
//   press joins that map's public park; a map other than the one loaded is a reload, the choice kept in sessionStorage
//   ('ski_go') and done once the new map has loaded.
// - Watching: in a room as a watcher (the relay never sends you to the others), the camera on one of its riders through
//   the game's own cameras (chase, far, first person, filmer), the next or previous rider, their name, Ride to start
//   riding in the same room, Leave. From the home screen, or from the pause menu while riding in a room.
import * as THREE from 'three';
import { countUrl } from './net.js?v=26';
import { height } from './terrain.js?v=26';

const MAP_NAMES = { jumpline: 'Jump Line', freeride: 'Freeride' };
const CAM_NAMES = { chase: 'Chase', far: 'Far chase', pov: 'First person', film: 'Filmer' };
const GO = 'ski_go', POLL_MS = 5000;
const $ = id => document.getElementById(id);
const _cp = new THREE.Vector3(), _ct = new THREE.Vector3();

export class Online {
  /* o: { net, opts, save, hud, cams, camera, lift, sound, play(), toStart(), rig() (the page's own rig), start ({ x, z,
     yaw }: where the overview looks from when nobody rides) } */
  constructor(o) {
    Object.assign(this, o);
    this.watching = false; this.from = ''; this.follow = 0; this.fRig = null; this.loaded = false; this.pending = null;
    this.list = []; this.shown = ''; this.statusText = ''; this.counts = undefined; this.t = 0;
    this.over = { p: new THREE.Vector3(), v: new THREE.Vector3(), com: new THREE.Vector3(), state: 'ground', crouch: 0.3, edge: 0, balance: 0, brake: 0 };
    // a choice made before a reload into another map
    try {
      const g = JSON.parse(sessionStorage.getItem(GO) || 'null');
      sessionStorage.removeItem(GO);
      if (g && Date.now() - g.at < 60000 && g.map === this.opts.map) this.pending = { act: g.act, auto: true };
    } catch (e) {}
    this.board();
    this.bar();
    // the net's status line also says how things stand here (the watch bar's line, the pause menu's Watch button)
    const os = this.net.onStatus;
    this.net.onStatus = t => { os(t); this.statusText = t; this.sync(); };
    this.net.onMode = (watching, why) => {
      if (why) { this.hud.flash(why, 2200); if (!this.watching && watching) this.startWatch(this.from || 'room', true); }
    };
    addEventListener('keydown', e => this.key(e), true);
  }

  // ---- the home screen's board ----------------------------------------------------------------------------------------
  board() {
    const el = this.el = $('online'); if (!el) return;
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => this.go(b.dataset.act, b.closest('[data-online]').dataset.online));
    this.poll();
    setInterval(() => this.poll(), POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poll(); });
  }
  menuUp() { const m = $('menu'); return m && !m.classList.contains('hidden'); }
  async poll() {
    if (document.hidden || !this.menuUp() || this.polling) return;
    this.polling = true;
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 4000);
    let c = null;
    try { const r = await fetch(countUrl(), { cache: 'no-store', signal: ac.signal }); if (r.ok) c = await r.json(); else if (r.status === 429) c = this.counts; }
    catch (e) {}
    clearTimeout(to); this.polling = false;
    this.show(c && c.maps ? c : null);
  }
  show(c) {
    this.counts = c;
    const el = this.el; if (!el) return;
    for (const tile of el.querySelectorAll('[data-online]')) {
      // (W, round 10: Any mountain's tile counts every place's riders, maps w_...)
      const m = c ? (tile.dataset.online === 'world' ? Object.keys(c.maps).filter(k => /^w_/.test(k)).reduce((t, k) => ({ ride: t.ride + (c.maps[k].ride | 0), watch: t.watch + (c.maps[k].watch | 0) }), { ride: 0, watch: 0 }) : c.maps[tile.dataset.online] || { ride: 0, watch: 0 }) : null, n = m ? m.ride | 0 : 0, w = m ? m.watch | 0 : 0;
      const html = m ? `<b data-n="ride">${n}</b> riding${w ? ` &middot; <b data-n="watch">${w}</b> watching` : ''}` : 'No count right now';
      const box = tile.querySelector('.oncount'); if (box.innerHTML !== html) box.innerHTML = html;
      tile.classList.toggle('busy', n > 0);
    }
    const tot = $('ontotal');
    if (!c) { tot.textContent = 'The park server is not answering right now'; el.classList.add('down'); return; }
    el.classList.remove('down');
    tot.textContent = c.ride ? `${c.ride} riding now${c.watch ? `, ${c.watch} watching` : ''}` : c.watch ? `Nobody riding, ${c.watch} watching` : 'Nobody riding yet';
  }
  // (no name: the relay gives one, "Rider" and a number, so the watch bar can tell riders apart)
  name() { const v = ($('mpname').value || '').trim(); this.opts.name = v; this.save(); return v; }
  /* (2026-11-12) a line on the board, over the maps: why a room closed (nobody in it was active). Gone at the next press
     on the board. */
  notice(text) {
    const el = this.el; if (!el) return;
    let n = this.noteEl;
    if (!n && text) {
      n = this.noteEl = document.createElement('p'); n.className = 'onnote'; n.setAttribute('role', 'status');
      n.style.cssText = 'margin:0 0 8px;padding:6px 9px;background:rgba(255,138,42,.16);border-left:3px solid #ff8a2a;color:#ffe6cf;font-size:13px;line-height:1.35';
      el.insertBefore(n, el.querySelector('.onmaps'));
    }
    if (n) { n.textContent = text || ''; n.hidden = !text; }
  }
  // a press on the board: ride or watch the map's public park (another map: a reload first)
  go(act, map) {
    this.notice('');
    const nm = this.name();
    if (map !== this.opts.map) {
      try { sessionStorage.setItem(GO, JSON.stringify({ act, map, at: Date.now() })); } catch (e) {}
      this.opts.map = map; this.save();
      const u = new URL(location.href);
      if (u.searchParams.has('map')) { u.searchParams.set('map', map); location.replace(u.href); } else location.reload();
      return;
    }
    if (!this.loaded) { this.pending = { act }; const b = this.el.querySelector(`[data-online="${map}"] [data-act="${act}"]`); if (b) b.textContent = 'Loading...'; return; }
    this.run(act, nm);
  }
  run(act, nm = this.name()) {
    const net = this.net;
    net.map = this.netMap || this.opts.map;   // (W, round 10: Any mountain's place, main.js)
    const here = net.inRoom && !net.priv;     // (already in this map's public park: no need to join it again)
    if (act === 'watch') {
      if (!(here && net.watching)) { if (here) net.setWatch(true); else net.connect(nm, this.opts.rider, { watch: true }); }
      this.startWatch(here && !net.watching ? 'room' : 'home', true);   // (room: Ride goes back to where you were)
      return;
    }
    if (this.watching) this.stopWatch('ride', true);
    if (here) { if (net.watching) net.setWatch(false); }
    else net.connect(nm, this.opts.rider);
    this.play();
  }
  // the map has loaded (main.js): a choice made before the reload is done now
  booted() {
    this.loaded = true;
    for (const b of this.el ? this.el.querySelectorAll('[data-act]') : []) b.textContent = b.dataset.act === 'ride' ? 'Ride online' : 'Watch';
    const p = this.pending; this.pending = null;
    if (!p) return;
    try { this.run(p.act); } catch (e) { console.warn('online', e); }
    // (after a reload nothing has been pressed on this page yet: the sound and the mouse's hold wait for a first click)
    if (p.auto) {
      addEventListener('pointerdown', () => this.sound.start(), { once: true, capture: true });
      if (p.act === 'ride' && this.opts.scheme === 'mouse') this.hud.flash('Click to steer with the mouse', 3000);
    }
  }

  // ---- watching -------------------------------------------------------------------------------------------------------
  bar() {
    const b = this.barEl = $('watchbar'); if (!b) return;
    $('wbprev').onclick = () => this.step(-1);
    $('wbnext').onclick = () => this.step(1);
    $('wbcam').onclick = () => this.nextCam();
    $('wbride').onclick = () => this.stopWatch('ride');
    $('wbleave').onclick = () => this.stopWatch('leave');
    const tw = $('towatch'); if (tw) tw.onclick = () => this.startWatch('room');
  }
  // the pause menu's Watch button: only while riding in a room
  sync() { const tw = $('towatch'); if (tw) tw.classList.toggle('hidden', !(this.net.inRoom && !this.net.watching)); this.shown = ''; }
  startWatch(from, already) {
    if (!this.watching) { this.camWas = this.cams.mode; this.from = from; }
    this.watching = true;
    if (!already) this.net.setWatch(true);
    $('menu').classList.add('hidden'); $('pause').classList.add('hidden');
    this.hud.show(true); $('hud').classList.add('watching'); this.barEl.classList.remove('hidden');
    document.exitPointerLock?.();
    const r = this.rig(); if (r) r.root.visible = false;
    if (!CAM_NAMES[this.cams.mode]) this.cams.set('chase');
    this.cams.first = true; this.shown = '';
  }
  stopWatch(to, quiet) {
    if (!this.watching) return;
    this.watching = false;
    this.unfollow(); this.net.noTag = 0;
    $('hud').classList.remove('watching', 'nobody'); this.barEl.classList.add('hidden'); this.had = undefined;
    const r = this.rig(); if (r) r.root.visible = true;
    this.cams.set(this.camWas || 'chase');
    if (to === 'ride') {
      if (!quiet) this.net.setWatch(false);
      if (this.from === 'home') this.toStart();
      if (!quiet) this.play();
    } else {
      this.net.leave();
      this.hud.show(false);
      if (this.from === 'room') $('play').textContent = 'Keep riding';
      $('menu').classList.remove('hidden');
      this.poll();
    }
  }
  unfollow() { if (this.fRig && this.fRig.setFirstPerson) this.fRig.setFirstPerson(false); this.fRig = null; }
  // the riders that can be watched here: in, posed, on this map
  riders() {
    const L = this.list; L.length = 0;
    for (const r of this.net.remotes.values()) if (r.rig && r.rig.ready && r.view && r.view.shown) L.push(r);
    L.sort((a, b) => a.id - b.id);
    return L;
  }
  step(d) {
    const L = this.riders(); if (!L.length) return;
    const i = L.findIndex(r => r.id === this.follow);
    this.follow = L[((i < 0 ? 0 : i + d) % L.length + L.length) % L.length].id;
    this.cams.first = true;
  }
  nextCam() { const m = this.cams.next(); this.opts.cam = m; this.save(); this.cams.first = true; this.shown = ''; }
  key(e) {
    if (!this.watching) return;
    const chat = $('chatin'), inChat = e.target === chat;
    if (inChat) {
      if (e.code !== 'Enter') return;                    // (Esc in the chat is the chat's own)
      const t = chat.value.trim(); if (t) this.net.chat(t);
      chat.value = ''; chat.classList.add('hidden'); chat.blur();
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const c = e.code;
    let done = true;
    if (c === 'ArrowLeft' || c === 'KeyA') this.step(-1);
    else if (c === 'ArrowRight' || c === 'KeyD') this.step(1);
    else if (c === 'KeyC' || c === 'KeyQ') this.nextCam();
    else if (c === 'KeyR') this.stopWatch('ride');
    else if (c === 'Escape') this.stopWatch('leave');
    else if ((c === 'Enter' || c === 'KeyT') && this.net.inRoom) { chat.classList.remove('hidden'); chat.focus(); }
    else done = false;
    if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  /* one frame while watching (main.js, in place of the page's own rider and cameras): the others posed, the camera on
     the rider followed, and that rider as the speed, the sound and the shadows read a skier. With nobody to watch, a
     slow look down the run from over the start. */
  frame(dt, time) {
    this.t += dt;
    this.net.pose(dt, time);
    const L = this.riders();
    let r = L.find(x => x.id === this.follow);
    if (!r && L.length) { r = L[0]; this.follow = r.id; this.cams.first = true; }
    if (!r) this.follow = 0;
    if (this.fRig && (!r || this.fRig !== r.rig)) this.unfollow();
    let V;
    if (r) {
      this.fRig = r.rig; V = r.view;
      if (V.state === 'lift' || this.cams.orbit) this.cams.lookRound(0, dt);
      this.cams.update(dt, V, r.rig);
      if (this.lift) this.lift.camera(dt, this.camera, this.cams, V);
      this.net.noTag = this.cams.mode === 'pov' ? r.id : 0;
    } else {
      // high over the start (clear of a lift's top station there), looking 80 m down the run, swinging slowly either way
      const S = this.start, a = (S.yaw || 0) + 0.28 * Math.sin(this.t * 0.12), fx = Math.sin(a), fz = Math.cos(a);
      const cam = this.camera;
      cam.position.set(S.x + fx * 6, 0, S.z + fz * 6); cam.position.y = Math.max(height(S.x, S.z) + 22, height(cam.position.x, cam.position.z) + 8);
      _ct.set(S.x + fx * 80, 0, S.z + fz * 80); _ct.y = height(_ct.x, _ct.z);
      cam.up.set(0, 1, 0); cam.lookAt(_ct); cam.fov = 60; cam.near = 0.15; cam.updateProjectionMatrix();
      cam.layers.enable(1);
      V = this.over; V.p.copy(_ct); V.com.copy(_ct);
      this.cams.first = true; this.net.noTag = 0;
    }
    if (!!r !== this.had) { this.had = !!r; $('hud').classList.toggle('nobody', !r); }   // (no speed with nobody to watch)
    this.label(L, r);
    return V;
  }
  // the bar's words, written only when they change
  label(L, r) {
    const map = MAP_NAMES[this.opts.map] || this.mapName || this.opts.map,   /* (W: a place's name) */ i = r ? L.indexOf(r) : -1, w = this.net.watchN;
    const name = r ? r.name : this.net.inRoom ? 'Nobody riding yet' : 'Joining the park...';
    const meta = r ? `${map} · ${i + 1} of ${L.length}${w > 1 ? ` · ${w} watching` : ''}` : this.net.inRoom ? `${map} · riders show up here as they drop in` : this.statusText || map;
    const cam = CAM_NAMES[this.cams.mode] || 'Chase', key = name + '|' + meta + '|' + cam + '|' + (L.length > 1);
    if (key === this.shown) return;
    this.shown = key;
    $('wbname').textContent = name; $('wbmeta').textContent = meta; $('wbcam').textContent = cam;
    $('wbprev').disabled = $('wbnext').disabled = L.length < 2;
  }
}
