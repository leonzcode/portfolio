/* ---------------------------------------------------------------------------
   Leoncraft 2 - your account.

   You play as an account: a name (3 to 16 letters, digits and _, as the
   game's names are) and a password, kept by the mc server (lc2accounts.js
   in mlhub). Logging in gives a session token, kept in this browser
   (localStorage lc2_session) so the game logs in by itself next time; the
   server renews it each time it is used and lets it lapse after 30 days
   without. The account's name is your name everywhere: on servers, in chat,
   in death messages, over your head.

   When the server cannot be reached, a session this browser already had is
   trusted for singleplayer (offline: a small note on the title screen);
   multiplayer needs the server anyway.

   This file is small and imports nothing, so the title screen can have it
   before the game's own parts are in (js/parts.js).
--------------------------------------------------------------------------- */
const KEY = 'lc2_session';

/* ?mp=ws://host:port/mc/ws points the game at another server (a local one
   while testing). Only on a page served from this machine: the session token
   and any password typed go wherever this points, so a link to the live site
   with ?mp= must never send them elsewhere. */
const LOCAL_PAGE = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/;
export function wsBase() {
  const h = location.hostname || 'localhost';
  if (LOCAL_PAGE.test(h)) {
    const q = new URLSearchParams(location.search).get('mp');
    if (q && /^wss?:\/\//.test(q)) return q;
  }
  if (h.endsWith('leonzhao.dev')) return 'wss://apps.leonzhao.dev/mc/ws';
  return 'ws://' + h + ':8600/mc/ws';
}
export const httpBase = () => wsBase().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/ws$/, '');

// the game's own words for what went wrong (the server sends its own; these are for when nothing answers)
export const NO_CONNECTION = 'Authentication servers are down. Please try again later, sorry!';
export const NAME_RULE = /^[A-Za-z0-9_]{3,16}$/;

function read() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s.name === 'string' && typeof s.token === 'string') return s; } catch (e) {}
  return null;
}
function write(s) { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch (e) {} }

async function call(path, body) {
  let r;
  try { r = await fetch(httpBase() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), cache: 'no-store' }); }
  catch (e) { return { error: NO_CONNECTION, code: 'down' }; }
  if (!r.ok) return { error: NO_CONNECTION, code: 'down' };
  try { return await r.json(); } catch (e) { return { error: NO_CONNECTION, code: 'down' }; }
}

const listeners = new Set();
export const Account = {
  /* where things stand:
       session  { name, token, admin } kept in this browser, or null
       checked  the server said this session is good (this visit)
       offline  the server could not be reached; the kept session is trusted for singleplayer */
  session: read(),
  checked: false,
  offline: false,
  get name() { return this.session ? this.session.name : ''; },
  get token() { return this.session ? this.session.token : ''; },
  get admin() { return !!(this.session && this.session.admin); },
  // playing as a guest: no account, a name of Guest_ and four digits (a server may give another if that one is in use)
  get guest() { return !!(this.session && this.session.guest); },
  playAsGuest() {
    let name = '';
    try { name = localStorage.getItem('lc2_guest') || ''; } catch (e) {}
    if (!/^Guest_\d{4}$/.test(name)) { name = 'Guest_' + (1000 + Math.floor(Math.random() * 9000)); try { localStorage.setItem('lc2_guest', name); } catch (e) {} }
    this.session = { name, token: '', guest: true, admin: false, at: Date.now() };
    write(this.session); this.checked = true; this.offline = false; this.changed();
  },
  // whether the title's play buttons work
  get ready() { return !!this.session && (this.checked || this.offline); },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  changed() { for (const fn of listeners) { try { fn(this); } catch (e) { console.error(e); } } },
  keep(r) {
    this.session = { name: r.name, token: r.token, admin: !!r.admin, at: Date.now() };
    write(this.session); this.checked = true; this.offline = false; this.changed();
  },
  forget() { this.session = null; write(null); this.checked = false; this.offline = false; this.changed(); },

  /* At start-up: is the kept session still good? true (logged in), false
     (no session, or the server says it is no good: log in again), or
     'offline' (no answer; the kept one stands for singleplayer). */
  check() {
    const p = this.checking = this._check();
    p.then(() => { if (this.checking === p) this.checking = null; }, () => { if (this.checking === p) this.checking = null; });
    return p;
  },
  checking: null,
  async _check() {
    const s = this.session = read();
    if (!s) { this.checked = false; this.changed(); return false; }
    if (s.guest) { this.checked = true; this.offline = false; this.changed(); return true; }
    const r = await call('/lc2/account/me', { token: s.token });
    if (r.ok) { this.session = Object.assign({}, s, { name: r.name, admin: !!r.admin }); write(this.session); this.checked = true; this.offline = false; this.changed(); return true; }
    if (r.code === 'down') { this.offline = true; this.changed(); return 'offline'; }
    // stale, forged, banned or deleted: log in again (a ban is said on the login screen)
    this.forget();
    this.lastError = r.code === 'banned' ? r.error + (r.reason ? ' Reason: ' + r.reason : '') : '';
    return false;
  },
  async login(name, password) {
    const r = await call('/lc2/account/login', { name: String(name || '').trim(), password: String(password || '') });
    if (r.ok) this.keep(r);
    return r;
  },
  async create(name, password) {
    name = String(name || '').trim();
    if (!NAME_RULE.test(name)) return { error: 'Invalid username! A name is 3 to 16 characters: letters, numbers and _ only.', code: 'badname' };
    const r = await call('/lc2/account/create', { name, password: String(password || '') });
    if (r.ok) this.keep(r);
    return r;
  },
  async logout() {
    const t = this.token;
    if (this.guest) { this.forget(); return; }
    this.forget();
    if (t) await call('/lc2/account/logout', { token: t });
  },
  async changePassword(old, password) { return call('/lc2/account/password', { token: this.token, old, password }); },
  // the admin's powers (lc2accounts.js adminOp): accounts, ban, unban, reset, delete, servers, owner, sdelete
  admin_(op, o) { return call('/lc2/admin', Object.assign({ token: this.token, op }, o || {})); },
  // anything else that needs to know who asks (the server list, making and changing servers)
  post(path, body) { return call(path, Object.assign({ token: this.token }, body || {})); },
  // the session went bad while playing (a server said so): log in again
  expired() { this.forget(); },
};
