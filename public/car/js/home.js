// Earth Drive's home screen (round 5): Singleplayer (the map, as before) or Multiplayer (a name, then the rooms: the
// public ones with their place and how many are in, a room of your own (public, or private with a code) on a place
// chosen on the map, or a room joined by its code). Everyone in a room drops at the room's place (mp.js runs the
// room). In the page's own Google Maps look; a link with ?lat= drops straight in and never shows this.
import { Net, Session } from './mp.js?v=47';

const CSS = `
.mph { position: fixed; inset: 0; z-index: 40; overflow: hidden; background: #1b1d1f; font-family: Roboto, 'Segoe UI', Arial, sans-serif; color: #1f1f1f; -webkit-font-smoothing: antialiased; }
.mph[hidden] { display: none; }
.mph-sat { position: absolute; left: 50%; top: 50%; width: 1920px; height: 1600px; margin: -800px 0 0 -960px; display: grid; grid-template-columns: repeat(6, 320px); grid-auto-rows: 320px; animation: mph-drift 140s ease-in-out infinite alternate; }
.mph-sat img { width: 320px; height: 320px; display: block; }
@keyframes mph-drift { from { transform: translate(90px, 40px) scale(1.06); } to { transform: translate(-110px, -60px) scale(1.12); } }
.mph-shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10,12,14,.55) 0, rgba(10,12,14,.2) 520px, rgba(10,12,14,0) 900px); }
.mph-card { position: absolute; left: 24px; top: 50%; transform: translateY(-50%); width: 400px; max-height: calc(100vh - 48px); overflow: auto; background: #fff; border-radius: 24px; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); padding: 28px 24px 20px; box-sizing: border-box; }
.mph-mark { display: flex; align-items: center; gap: 12px; }
.mph-mark svg { width: 40px; height: 40px; flex: none; }
.mph h1 { margin: 0; font: 400 30px/36px 'Google Sans', Roboto, sans-serif; letter-spacing: 0; color: #1f1f1f; }
.mph h2 { margin: 0 0 2px; font: 400 22px/28px 'Google Sans', Roboto, sans-serif; color: #1f1f1f; }
.mph-lede { margin: 10px 0 20px; color: #444746; font-size: 15px; line-height: 22px; }
.mph button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mph :focus { outline: none; }
.mph :focus-visible { outline: 2px solid #0b57d0; outline-offset: 2px; }
.mph-opt { display: flex; align-items: center; gap: 16px; width: 100%; text-align: left; padding: 14px 16px; border-radius: 16px; border: 1px solid #e3e3e3 !important; margin-bottom: 10px !important; transition: background .12s, border-color .12s; box-sizing: border-box; }
.mph-opt:hover { background: #f3f6fc; border-color: #c2d4f4 !important; }
.mph-ico { width: 44px; height: 44px; border-radius: 50%; flex: none; display: grid; place-items: center; background: #d3e3fd; color: #041e49; }
.mph-ico svg { width: 24px; height: 24px; fill: currentColor; }
.mph-opt b { display: block; font: 500 16px/22px 'Google Sans', Roboto, sans-serif; color: #1f1f1f; }
.mph-opt span { display: block; color: #444746; font-size: 14px; line-height: 20px; }
.mph-foot { margin-top: 14px; color: #70757a; font-size: 12px; line-height: 16px; }
.mph-back { display: inline-flex; align-items: center; gap: 6px; color: #0b57d0; font: 500 14px 'Google Sans', Roboto, sans-serif; margin: -6px 0 12px -6px !important; padding: 6px !important; border-radius: 18px; }
.mph-back svg { width: 20px; height: 20px; fill: currentColor; }
.mph-field { display: flex; gap: 8px; margin: 8px 0; }
.mph-field input { flex: 1; min-width: 0; height: 44px; border: 1px solid #747775; border-radius: 8px; padding: 0 14px; font: 400 16px Roboto, sans-serif; color: #1f1f1f; background: #fff; box-sizing: border-box; }
.mph-field input:focus { border: 2px solid #0b57d0; padding: 0 13px; outline: none; }
.mph-pri { height: 40px; padding: 0 22px !important; border-radius: 20px; background: #0b57d0 !important; color: #fff !important; font: 500 14px 'Google Sans', Roboto, sans-serif; white-space: nowrap; }
.mph-pri:hover { background: #0842a0 !important; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
.mph-pri:disabled { background: #e3e3e3 !important; color: #8e918f !important; box-shadow: none; cursor: default; }
.mph-sec { height: 40px; padding: 0 18px !important; border-radius: 20px; border: 1px solid #747775 !important; color: #0b57d0 !important; font: 500 14px 'Google Sans', Roboto, sans-serif; white-space: nowrap; }
.mph-sec:hover { background: #f3f6fc !important; }
.mph-sec.on { background: #c2e7ff !important; border-color: #c2e7ff !important; color: #001d35 !important; }
.mph-err { color: #b3261e; font-size: 14px; line-height: 20px; min-height: 0; margin: 4px 0; }
.mph-err:empty { display: none; }
.mph-sect { margin-top: 18px; padding-top: 14px; border-top: 1px solid #e3e3e3; }
.mph-sect h3 { margin: 0 0 6px; font: 500 14px/20px 'Google Sans', Roboto, sans-serif; color: #1f1f1f; }
.mph-who { color: #444746; font-size: 14px; margin-bottom: 8px; }
.mph-who button { color: #0b57d0; font-weight: 500; margin-left: 6px; }
.mph-rooms { margin: 4px -8px 0; }
.mph-room { display: flex; align-items: center; gap: 12px; padding: 10px 8px; border-radius: 12px; }
.mph-room:hover { background: #f8f9fa; }
.mph-pin { width: 36px; height: 36px; flex: none; border-radius: 50%; background: #e8f0fe; display: grid; place-items: center; color: #d93025; }
.mph-pin svg { width: 20px; height: 20px; fill: currentColor; }
.mph-rt { flex: 1; min-width: 0; }
.mph-rt div:first-child { font-weight: 500; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mph-rt div + div { color: #70757a; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mph-empty { color: #70757a; font-size: 14px; padding: 8px; }
.mph-chips { display: flex; gap: 8px; margin: 8px 0 10px; }
.mph-attr { position: absolute; right: 8px; bottom: 6px; color: rgba(255,255,255,.75); font-size: 11px; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.mph-pick { position: fixed; left: 50%; top: 76px; transform: translateX(-50%); z-index: 45; background: #fff; border-radius: 24px; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); padding: 10px 10px 10px 20px; display: flex; align-items: center; gap: 14px; font: 400 14px/20px Roboto, sans-serif; color: #1f1f1f; max-width: calc(100vw - 32px); box-sizing: border-box; }
.mph-pick button { font: 500 14px 'Google Sans', Roboto, sans-serif; color: #0b57d0; background: none; border: 1px solid #747775; border-radius: 18px; padding: 6px 14px; cursor: pointer; }
@media (max-width: 520px) {
  .mph-card { left: 16px; right: 16px; width: auto; top: auto; bottom: 16px; transform: none; padding: 22px 18px 16px; max-height: calc(100vh - 32px); }
  .mph-shade { background: linear-gradient(0deg, rgba(10,12,14,.55) 0, rgba(10,12,14,0) 70%); }
  .mph h1 { font-size: 26px; }
  .mph-attr { top: 6px; bottom: auto; }
}
@media (prefers-reduced-motion: reduce) { .mph-sat { animation: none; } }
`;
const ICON = {
  mark: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#1a73e8"/><path d="M16 38l4-10c1-3 3-4 6-4h12c3 0 5 1 6 4l4 10v8h-4v-4H20v4h-4z" fill="#fff"/></svg>',
  one: '<svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>',
  many: '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z"/></svg>',
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

export class Home {
  constructor(G) {
    this.G = G; this.net = null; this.session = null;
    if (!document.getElementById('mph-css')) { const s = document.createElement('style'); s.id = 'mph-css'; s.textContent = CSS; document.head.appendChild(s); }
    const el = this.el = document.createElement('div'); el.className = 'mph';
    // the Golden Gate from above, drifting (Esri's World Imagery, as the map's satellite layer)
    let tiles = '';
    for (let y = 6327; y < 6332; y++) for (let x = 2615; x < 2621; x++) tiles += '<img alt="" draggable="false" src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/14/' + y + '/' + x + '">';
    el.innerHTML = '<div class="mph-sat" aria-hidden="true">' + tiles + '</div><div class="mph-shade"></div><div class="mph-card" role="dialog" aria-label="Earth Drive"></div><div class="mph-attr">Imagery: Esri, Maxar, Earthstar Geographics</div>';
    document.body.appendChild(el);
    this.card = el.querySelector('.mph-card');
    el.addEventListener('keydown', e => e.stopPropagation());
    G.home = this;
    // leaving a drive in a room (the map's back arrow): out of the room and back here
    G.onLeaveDrive = () => { if (!this.session) return false; this.leaveRoom(); this.show('rooms'); return true; };
  }

  show(view = 'start') {
    this.el.hidden = false; this.G.paused = true;
    this.view = view;
    clearInterval(this.refresh);
    if (view === 'start') this.start();
    else if (view === 'name') this.nameView();
    else this.rooms();
  }
  hide() { this.el.hidden = true; clearInterval(this.refresh); }

  start() {
    this.card.innerHTML = '<div class="mph-mark">' + ICON.mark + '<h1>Earth Drive</h1></div>'
      + '<p class="mph-lede">Drive anywhere on the real map, from satellite photos and OpenStreetMap.</p>'
      + '<button class="mph-opt" data-go="one"><div class="mph-ico">' + ICON.one + '</div><div><b>Singleplayer</b><span>Pick any place on the map and drive</span></div></button>'
      + '<button class="mph-opt" data-go="many"><div class="mph-ico">' + ICON.many + '</div><div><b>Multiplayer</b><span>Drive with other people in a room, with chat</span></div></button>'
      + '<div class="mph-foot">' + (matchMedia('(pointer: coarse)').matches ? 'Drive with the buttons on the screen. E gets you out of the car.' : 'W A S D to drive, E to get out, H for all the keys.') + '</div>';
    this.card.querySelector('[data-go="one"]').onclick = () => { this.hide(); this.G.openMap(); };
    this.card.querySelector('[data-go="many"]').onclick = () => this.show(store.get('car_mpname') ? 'rooms' : 'name');
    setTimeout(() => { const b = this.card.querySelector('button'); if (b) b.focus(); }, 0);
  }

  nameView(err = '') {
    const nm = store.get('car_mpname') || '';
    this.card.innerHTML = '<button class="mph-back" data-back>' + ICON.back + 'Back</button><h2>Your name</h2>'
      + '<p class="mph-lede" style="margin:4px 0 8px">Other players see it over your car and in the chat.</p>'
      + '<div class="mph-field"><input maxlength="16" autocomplete="nickname" aria-label="Your name" placeholder="Name" value="' + esc(nm) + '"><button class="mph-pri" data-ok>Continue</button></div><div class="mph-err">' + esc(err) + '</div>';
    const inp = this.card.querySelector('input'), ok = this.card.querySelector('[data-ok]');
    this.card.querySelector('[data-back]').onclick = () => this.show('start');
    const go = async () => {
      const v = inp.value.trim();
      if (v.length < 2) { this.card.querySelector('.mph-err').textContent = 'Use at least 2 letters or numbers.'; return; }
      ok.disabled = true; ok.textContent = 'Checking';
      try { await this.connect(); const m = await this.net.hello(v); store.set('car_mpname', m.name); this.show('rooms'); }
      catch (e) { ok.disabled = false; ok.textContent = 'Continue'; this.card.querySelector('.mph-err').textContent = e.message; }
    };
    ok.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    setTimeout(() => inp.focus(), 0);
  }

  async connect() {
    if (!this.net) {
      this.net = new Net(); this.G.net = this.net;
      this.net.on('closed', () => { if (this.view === 'rooms' && !this.el.hidden) this.rooms('The connection to the game server was lost. Trying again...'); });
    }
    await this.net.connect();
    if (!this.net.name && store.get('car_mpname')) await this.net.hello(store.get('car_mpname'));
  }

  async rooms(err = '') {
    const pub = store.get('car_mppub') !== '0';
    this.card.innerHTML = '<button class="mph-back" data-back>' + ICON.back + 'Back</button><h2>Multiplayer</h2>'
      + '<div class="mph-who">Playing as <b>' + esc(store.get('car_mpname') || '') + '</b><button data-rename>Change</button></div>'
      + '<div class="mph-err">' + esc(err) + '</div>'
      + '<div class="mph-sect" style="margin-top:8px"><h3>Public rooms</h3><div class="mph-rooms"><div class="mph-empty">Looking for rooms...</div></div></div>'
      + '<div class="mph-sect"><h3>Join with a code</h3><div class="mph-field"><input maxlength="4" aria-label="Room code" placeholder="ABCD" style="text-transform:uppercase;letter-spacing:3px"><button class="mph-sec" data-code>Join</button></div></div>'
      + '<div class="mph-sect"><h3>Make a room</h3><div class="mph-field"><input maxlength="32" aria-label="Room name" placeholder="Room name" value="' + esc(store.get('car_mproom') || '') + '"></div>'
      + '<div class="mph-chips" role="radiogroup" aria-label="Who can join"><button class="mph-sec' + (pub ? ' on' : '') + '" data-pub="1" role="radio" aria-checked="' + pub + '">Public</button><button class="mph-sec' + (!pub ? ' on' : '') + '" data-pub="0" role="radio" aria-checked="' + !pub + '">Private, with a code</button></div>'
      + '<button class="mph-pri" data-make>Choose the place on the map</button></div>';
    const C = this.card;
    C.querySelector('[data-back]').onclick = () => this.show('start');
    C.querySelector('[data-rename]').onclick = () => this.show('name');
    C.querySelectorAll('[data-pub]').forEach(b => b.onclick = () => { store.set('car_mppub', b.dataset.pub); C.querySelectorAll('[data-pub]').forEach(o => { o.classList.toggle('on', o === b); o.setAttribute('aria-checked', String(o === b)); }); });
    const codeIn = C.querySelectorAll('.mph-field input')[0], nameIn = C.querySelectorAll('.mph-field input')[1];
    const joinCode = () => { const c = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); if (c.length !== 4) { this.err('A room code has 4 letters.'); return; } this.joinRoom({ code: c }); };
    C.querySelector('[data-code]').onclick = joinCode; codeIn.onkeydown = e => { if (e.key === 'Enter') joinCode(); };
    C.querySelector('[data-make]').onclick = () => { store.set('car_mproom', nameIn.value.trim()); this.pickPlace({ name: nameIn.value.trim(), pub: store.get('car_mppub') !== '0' }); };
    try { await this.connect(); } catch (e) { this.err(e.message + ' Check the connection and try again.'); return; }
    const load = async () => {
      if (this.el.hidden || this.view !== 'rooms') return;
      let list; try { list = await this.net.rooms(); } catch (e) { return; }
      const box = C.querySelector('.mph-rooms'); if (!box) return;
      if (!list.length) { box.innerHTML = '<div class="mph-empty">No public rooms right now. Make one below and others can join it.</div>'; return; }
      box.innerHTML = list.map(r => '<div class="mph-room"><div class="mph-pin">' + ICON.pin + '</div><div class="mph-rt"><div>' + esc(r.name) + '</div><div>' + r.n + ' of ' + r.max + ' · ' + esc(r.place.label || (r.place.lat.toFixed(3) + ', ' + r.place.lon.toFixed(3))) + '</div></div><button class="mph-sec" data-room="' + esc(r.id) + '"' + (r.n >= r.max ? ' disabled' : '') + '>' + (r.n >= r.max ? 'Full' : 'Join') + '</button></div>').join('');
      box.querySelectorAll('[data-room]').forEach(b => b.onclick = () => this.joinRoom({ id: b.dataset.room }));
    };
    load();
    this.refresh = setInterval(load, 5000);
  }
  err(t) { const e = this.card.querySelector('.mph-err'); if (e) e.textContent = t; }

  // a room of our own: its place picked on the map (search, or right-click and Drive here), then made and driven
  async pickPlace(opts) {
    this.hide();
    const G = this.G;
    const bar = document.createElement('div'); bar.className = 'mph-pick';
    bar.innerHTML = '<span>Choose your room\'s place: search, or right-click the map and pick <b>Drive here</b>.</span><button>Cancel</button>';
    document.body.appendChild(bar);
    const end = () => { bar.remove(); G.beforeDrop = null; };
    bar.querySelector('button').onclick = () => { end(); if (G.mapui) G.mapui.hidePicker(); this.show('rooms'); };
    G.beforeDrop = async ({ lat, lon, heading }) => {
      end();
      let label = '';
      try { label = await placeName(lat, lon); } catch (e) {}
      try {
        const m = await this.net.create({ name: opts.name, pub: opts.pub, place: { lat, lon, h: Math.round(heading || 0), label } });
        this.begin(m);
        return true;
      } catch (e) { this.show('rooms'); this.err(e.message); return false; }
    };
    await G.openMap();
  }

  async joinRoom(o) {
    try {
      await this.connect();
      const m = await this.net.join(o);
      this.hide();
      this.begin(m);
      const p = m.room.place;
      await this.G.dropTo(p.lat, p.lon, p.h || 0);
    } catch (e) { if (!this.session) { this.show('rooms'); this.err(e.message); } else console.warn('join', e); }
  }

  // in a room: the session made now (its messages kept), started once the drop has loaded (main.js afterDrop)
  begin(m) {
    if (this.session) this.session.dispose();
    const S = this.session = new Session(this.G, this.net, m);
    this.G.afterDrop = () => { if (this.session === S) S.dropped(); };
    this.offClose = this.net.on('closed', () => { if (this.session === S) setTimeout(() => this.reconnectNote(), 0); });
  }
  reconnectNote() { /* the session says so in the chat; the drive goes on alone */ }
  leaveRoom() {
    if (this.session) { this.session.dispose(); this.session = null; }
    if (this.offClose) { this.offClose(); this.offClose = null; }
    this.G.afterDrop = null;
    if (this.net) this.net.leave();
  }
}

// a short name for a place (the town or the district), for the room list
async function placeName(lat, lon) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=' + lat.toFixed(5) + '&lon=' + lon.toFixed(5), { signal: ctl.signal, headers: { 'Accept-Language': navigator.language || 'en' } });
    const j = await r.json(), a = j.address || {};
    const parts = [a.suburb || a.neighbourhood || a.quarter || a.village || a.town, a.city || a.town || a.county, a.country].filter(Boolean);
    return [...new Set(parts)].slice(0, 2).join(', ').slice(0, 60);
  } finally { clearTimeout(t); }
}
