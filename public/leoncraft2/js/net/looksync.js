/* ---------------------------------------------------------------------------
   Leoncraft 2 - your look and your settings kept with your account
   (2026-10-28, for "a players skin does not save to their account"; the
   settings and key binds 2026-11-03, for "make it so your settings and
   keybinds and skin always saves").

   Three groups of options follow the account (lc2accounts.js in mlhub):
     look      the skin, its model, its gallery name, the cape and which parts
               show (/mc/lc2/account/look)
     settings  everything else a player sets for themselves: controls and key
               binds, mouse, sounds, accessibility, the HUD, the minimap...
               (/mc/lc2/account/settings)
     device    the video settings, kept once for each computer (a hash of its
               system, cores, memory and graphics chip), so a Chromebook and a
               gaming computer each keep their own
   Never sent: the world's difficulty, and old settings read once at start.

   Logging in takes what the account keeps; a change here is sent a moment
   after. What has not reached the server yet is written down (localStorage
   lc2_sync_pending: the account it belongs to and which options changed),
   so a failed send is tried again (after 4 s, then longer, up to a minute,
   and as the browser comes back online), a page closed before its send goes
   with a keepalive request, and the next start sends what is still waiting
   instead of taking the account's older copy over it. Options changed here
   win over the account's copy one by one: a change made on another computer
   to something else is still taken.

   An account with no look kept yet takes this browser's look if it was last
   this account's, or nobody's yet; one that was another account's is not
   handed on (the default instead). An account with no settings kept takes
   this browser's. A change made with nobody logged in (the title's Skins
   button needs no account) goes to the next account to log in here only if
   that one has nothing kept or was the last one here (lc2_look_owner): a
   lapsed session's player keeps it, another player's account does not get
   it. Guests keep theirs in the browser, as before.
--------------------------------------------------------------------------- */
import { Account, httpBase } from './account.js?v=122';
import { DEFAULT_OPTIONS } from '../ui/gui.js?v=122';

const LOOK = ['skin', 'skinModel', 'skinName', 'cape', 'capeName', 'skinParts'];
const DEVICE = ['graphicsPreset', 'deviceTuned', 'renderDistance', 'simulationDistance', 'chunkBuilder', 'smoothLighting', 'biomeBlend',
  'particles', 'mipmapLevels', 'entityShadows', 'entityDistance', 'cloudDistance', 'cutoutLeaves', 'improvedTransparency', 'textureFiltering',
  'maxAnisotropy', 'weatherRadius', 'vsync', 'inactivityFpsLimit', 'chunkFade', 'shaderLevel', 'renderScale', 'guiScale', 'maxFps', 'clouds', 'menuBlur'];
const LOCAL = ['difficulty', 'shaders', 'shaderPreset', 'shader', 'quality'];
const SETTINGS = Object.keys(DEFAULT_OPTIONS).filter(k => LOOK.indexOf(k) < 0 && DEVICE.indexOf(k) < 0 && LOCAL.indexOf(k) < 0);
const GROUPS = { look: LOOK, settings: SETTINGS, device: DEVICE };
const groupOf = k => LOOK.indexOf(k) >= 0 ? 'look' : DEVICE.indexOf(k) >= 0 ? 'device' : SETTINGS.indexOf(k) >= 0 ? 'settings' : '';

const OWNER = 'lc2_look_owner', PENDING = 'lc2_sync_pending';
const DEFAULT_LOOK = { skin: 'default', skinModel: 'classic', skinName: '', cape: '', capeName: '',
  skinParts: { hat: true, jacket: true, leftSleeve: true, rightSleeve: true, leftPants: true, rightPants: true, cape: true } };
const owner = () => { try { return localStorage.getItem(OWNER) || ''; } catch (e) { return ''; } };
const setOwner = n => { try { localStorage.setItem(OWNER, n); } catch (e) {} };
/* what waits to be sent: { group: { n: account ('' for a change made with nobody logged in), k: [options],
   all: true when the whole group goes (an account with nothing kept yet) } } */
function pending() {
  try { const p = JSON.parse(localStorage.getItem(PENDING) || 'null'); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; }
}
function keepPending(p) { try { if (Object.keys(p).length) localStorage.setItem(PENDING, JSON.stringify(p)); else localStorage.removeItem(PENDING); } catch (e) {} }

/* This computer's name for its video settings: a hash of its system, cores, memory and graphics chip (gpu, the
   WebGL renderer's name main.js reads anyway), so a cleared browser on the same computer finds its own again. */
export function deviceId(gpu) {
  const ua = navigator.userAgent || '';
  const os = /CrOS/.test(ua) ? 'cros' : /Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Windows/.test(ua) ? 'win'
    : /Mac OS X|Macintosh/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'other';
  const text = [os, navigator.hardwareConcurrency || 0, navigator.deviceMemory || 0, gpu || ''].join('|');
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193) >>> 0; b = Math.imul(b ^ c, 0x5bd1e995) >>> 0; }
  return os + a.toString(36) + b.toString(36);
}

export function startLookSync(options, { gpu = '' } = {}) {
  const device = deviceId(gpu);
  let applying = false, pulling = '', pullFails = 0, pullTimer = 0;
  // the account each group's copy was read for (a group is sent only after that)
  const ready = {};
  const G = {};
  for (const g in GROUPS) G[g] = { timer: 0, fails: 0, busy: false, again: false, sent: '' };
  const who = () => { const s = Account.session; return s && !s.guest && s.token && Account.checked ? s.name.toLowerCase() : ''; };
  const now = g => { const o = {}; for (const k of GROUPS[g]) { const v = options.stored(k); o[k] = v && typeof v === 'object' ? Object.assign({}, v) : v; } return o; };
  const route = g => g === 'look' ? '/lc2/account/look' : '/lc2/account/settings';
  // (settings and video settings go as the options changed, merged by the server; the look goes whole)
  const body = (g, data) => g === 'look' ? { look: data } : g === 'settings' ? { settings: data, merge: true } : { device: { id: device, data }, merge: true };
  const what = (g, p) => { const all = now(g); if (g === 'look' || p.all) return all; const o = {}; for (const k of p.k) if (k in all) o[k] = all[k]; return o; };
  // the account's copy put into the options (but those changed here and not sent yet: skip)
  function put(g, data, skip) {
    applying = true;
    try {
      for (const k of GROUPS[g]) {
        if (!(k in data) || (skip && skip.indexOf(k) >= 0)) continue;
        let v = data[k];
        const d = DEFAULT_OPTIONS[k];
        if (d && typeof d === 'object') { if (!v || typeof v !== 'object' || Array.isArray(v)) continue; v = Object.assign(JSON.parse(JSON.stringify(d)), v); }
        else if (v !== null && typeof v === 'object') continue;
        if (JSON.stringify(options.stored(k)) !== JSON.stringify(v)) options.apply(k, v);
      }
    } finally { applying = false; }
  }
  const later = (g, ms) => { clearTimeout(G[g].timer); G[g].timer = setTimeout(() => send(g), ms); };
  async function send(g) {
    const s = G[g];
    clearTimeout(s.timer); s.timer = 0;
    const n = who();
    // (nobody to send for, or the account's copy not read yet: the pull sends what waits)
    if (!n || ready[g] !== n) return;
    const p = pending()[g];
    if (!p || p.n !== n) return;
    if (s.busy) { s.again = true; return; }
    const data = what(g, p), sig = n + JSON.stringify(data);
    s.busy = true;
    const r = sig === s.sent ? { ok: true } : await Account.post(route(g), body(g, data));
    s.busy = false;
    if (r && r.ok) {
      s.sent = sig; s.fails = 0;
      setOwner(n);
      // what was sent no longer waits (but an option changed again while it was on its way, or since)
      const q = pending(), w = q[g];
      if (w && w.n === n) {
        const cur = now(g), same = k => JSON.stringify(cur[k]) === JSON.stringify(data[k]);
        if (p.all && GROUPS[g].every(same)) w.all = false;
        w.k = w.k.filter(k => !(k in data && same(k)));
        if (!w.all && !w.k.length) delete q[g]; else s.again = true;
        keepPending(q);
      }
    } else if (r && (r.code === 'session' || r.code === 'bad')) {
      // (the session went bad, or the server will not keep this: kept waiting, for the next log in or change)
    } else {
      // no answer, too many at once, or refused: tried again later, still written down for the next start
      s.fails++;
      later(g, r && r.code === 'rate' ? 30000 : Math.min(60000, 4000 * Math.pow(2, Math.min(4, s.fails - 1))));
    }
    if (s.again) { s.again = false; later(g, 300); }
  }
  options.onChange(k => {
    if (applying || options.from === 'tab') return;
    const g = groupOf(k);
    if (!g) return;
    const n = who(), p = pending();
    if (!p[g] || (n && p[g].n !== n)) p[g] = { n, k: [], all: false };
    if (p[g].k.indexOf(k) < 0) p[g].k.push(k);
    keepPending(p);
    if (n) later(g, g === 'look' ? 800 : 1500);
  });

  // logging in: what the account keeps, then what waits here sent over it
  async function pull(n) {
    pulling = n;
    const want = {};
    for (const g in GROUPS) want[g] = ready[g] !== n;
    const [rl, rs] = await Promise.all([want.look ? Account.post('/lc2/account/look', {}) : null,
      want.settings || want.device ? Account.post('/lc2/account/settings', { deviceId: device }) : null]);
    pulling = '';
    if (who() !== n) return;
    const answer = { look: rl, settings: rs, device: rs };
    const p = pending(), was = owner();
    let again = false, any = false;
    for (const g in GROUPS) {
      if (!want[g]) continue;
      const r = answer[g];
      // (no answer: tried again; a server from before settings were kept never answers that part, the look still goes)
      if (!r || !r.ok) { if (!r || r.code !== 'session') again = true; continue; }
      const kept = g === 'look' ? r.look : g === 'settings' ? r.settings : r.device;
      /* what changed here and waits: this account's, or made with nobody logged in, which goes to an account with
         nothing kept, or to the one this browser last kept things for (a session that lapsed: the same player) */
      const mine = p[g] && (p[g].n === n || (p[g].n === '' && (!kept || !was || was === n))) ? p[g] : null;
      if (kept) put(g, kept, mine && mine.k);
      else if (g === 'look' && !mine && was && was !== n) put(g, DEFAULT_LOOK);
      any = true;
      // what is sent: anything changed here, or all of it for an account with nothing kept yet
      if (mine || !kept) p[g] = { n, k: mine ? mine.k : [], all: !kept };
      else delete p[g];
      if (!p[g]) G[g].sent = n + JSON.stringify(now(g));
      ready[g] = n;
    }
    keepPending(p);
    if (any) setOwner(n);
    for (const g in GROUPS) if (want[g] && ready[g] === n && p[g]) send(g);
    if (again) {
      pullFails++;
      clearTimeout(pullTimer);
      pullTimer = setTimeout(check, Math.min(60000, 4000 * Math.pow(2, Math.min(4, pullFails - 1))));
    } else pullFails = 0;
  }
  function check() {
    const n = who();
    if (!n) { if (!Account.session) for (const g in GROUPS) delete ready[g]; return; }
    if (n === pulling || Object.keys(GROUPS).every(g => ready[g] === n)) return;
    pull(n);
  }
  Account.onChange(check);
  check();

  // back online, or back to the tab: anything still waiting is tried at once
  const retry = () => { check(); const n = who(); if (!n) return; const p = pending(); for (const g in GROUPS) if (ready[g] === n && p[g] && p[g].n === n && !G[g].busy) send(g); };
  try { addEventListener('online', retry); } catch (e) {}
  /* the page going away: a send still waiting goes now, as a keepalive request (the browser finishes it after the
     page has gone; a look of over 64 KB is too big for one, and waits for the next start like anything else) */
  function flush(keep) {
    const n = who();
    if (!n) return;
    const p = pending();
    for (const g in GROUPS) {
      if (ready[g] !== n || !p[g] || p[g].n !== n) continue;
      if (!keep) { send(g); continue; }
      clearTimeout(G[g].timer); G[g].timer = 0;
      try {
        fetch(httpBase() + route(g), { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, cache: 'no-store',
          body: JSON.stringify(Object.assign({ token: Account.token }, body(g, what(g, p[g])))) }).catch(() => {});
      } catch (e) {}
    }
  }
  try {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(false); else retry(); });
    addEventListener('pagehide', () => flush(true));
  } catch (e) {}
  return { device, pending, flush };
}
