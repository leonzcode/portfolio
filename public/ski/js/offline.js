/* Leon Freeski with no connection (2026-11-16, for "make games like leonski and others with single player options
   available offline to play as well without server connection needed").

   The service worker (../sw.js, for /ski/ only) keeps every file the game asks for. This page module:
   - registers it (or, with ?nosw in the address or ON = false, removes it and its copy: the way out if it misbehaves);
   - once the game has loaded, drops the copies of older stamps' code, and, with a connection, fetches every file of
     every run (data/offline.json, made by tools/ski/gen_offline.cjs) through the worker, a few at a time, so the
     runs not ridden yet work offline too (about 12 MB on this device, once; Any mountain's places are kept only as
     they are ridden);
   - says on the home screen how it stands, in plain words (#offline).
   Riding on your own never waits for any of this. */
const ON = true;
const V = new URL(import.meta.url).searchParams.get('v') || '0';
const PREFIX = 'ski-offline-';
const CODE = /\.(m?js|css|wasm)$/i;
const SW = navigator.serviceWorker;
const here = new URL('../', import.meta.url);                // https://leonzhao.dev/ski/
const qs = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAPS = 'Jump Line, Freeride, Schilthorn 2023, Buttermilk 2024 and Genting 2022';
const OFF_WORDS = 'Offline. Riding on your own works; riding online and new places on Any mountain come back with the connection.';

// the same place in the copy as the worker gives a file (sw.js keyOf)
function keyOf(u) {
  if (u.searchParams.has('v') && CODE.test(u.pathname)) return u.href;
  let p = u.pathname;
  if (p.endsWith('/index.html')) p = p.slice(0, -10);
  return u.origin + p;
}
const stampOf = u => { const v = u.searchParams.get('v'); const m = v && /(\d+)$/.exec(v); return m ? +m[1] : null; };

let line = null;
function say(text, kind) {
  line = line || $('offline');
  if (!line) return;
  line.textContent = text || ''; line.hidden = !text; line.dataset.kind = kind || '';
}

async function removeAll() {
  try { for (const r of await SW.getRegistrations()) if (r.scope.startsWith(here.href)) await r.unregister(); } catch (e) {}
  try { for (const n of await caches.keys()) if (n.startsWith(PREFIX)) await caches.delete(n); } catch (e) {}
}

// the game has loaded (or could not): wait for it, so none of this shares the line with the game's own start
async function gameLoaded() {
  for (let i = 0; i < 2400; i++) {
    const B = window.__skiBoot;
    if (B && (B.done || B.failed)) return !!B.done;
    await sleep(250);
  }
  return false;
}

// older stamps' code (ours and three.js's): dropped once this stamp has loaded
async function dropOlder() {
  const v = +V.replace(/\D/g, ''); if (!v) return;
  for (const n of await caches.keys()) {
    if (!n.startsWith(PREFIX)) continue;
    const c = await caches.open(n);
    for (const req of await c.keys()) {
      const u = new URL(req.url), s = stampOf(u);
      if (s != null && s < v && CODE.test(u.pathname) && (u.pathname.startsWith(here.pathname) || u.pathname.startsWith('/car/vendor/three/'))) await c.delete(req);
    }
  }
}

async function manifest() {
  const r = await fetch(new URL('data/offline.json?v=' + V, here));
  if (!r.ok) throw new Error('offline list ' + r.status);
  const m = await r.json(), urls = [];
  for (const p of m.code || []) urls.push(new URL(p + '?v=' + V, here).href);
  for (const p of m.files || []) urls.push(new URL(p, here).href);
  for (const p of m.three || []) urls.push(new URL(p.replace('{V}', V), here).href);
  urls.push(here.href);
  // (and every file the page itself names: its scripts and styles, /others/presence.js among them; on a first visit they
  // came before the worker, and a deferred script with no copy holds the page up when the network answers nothing)
  for (const el of document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href], link[rel="preload"][href]')) {
    const u = new URL(el.src || el.href, location.href);
    if (u.origin === location.origin && !urls.includes(u.href)) urls.push(u.href);
  }
  return { urls, bytes: (m.bytes.code || 0) + (m.bytes.files || 0) + (m.bytes.three || 0) };
}
async function missing(urls) {
  const out = [];
  for (const h of urls) if (!(await caches.match(keyOf(new URL(h))))) out.push(h);
  return out;
}

function mb(b) { return (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + ' MB'; }
function savedWords() { return `Saved on this device: ${MAPS} work with no connection. Any mountain needs one, except places you have already ridden here.`; }

async function run() {
  if (!SW || typeof caches === 'undefined' || !window.isSecureContext) return;
  // (the worker stands aside for a ?nosw page and removes itself; anything it kept meanwhile goes once the game is in)
  if (!ON || qs.has('nosw')) { await removeAll(); if (await gameLoaded()) { await sleep(2000); await removeAll(); } return; }
  SW.register(new URL('sw.js', here).href, { scope: here.pathname, updateViaCache: 'none' }).catch(e => console.warn('offline', e));
  const ok = await gameLoaded();
  if (navigator.onLine === false) { say(ok ? OFF_WORDS : '', 'off'); return; }
  if (!ok) return;
  try { await dropOlder(); } catch (e) {}
  // the worker must be answering this page's requests, so what is fetched below is kept (the first visit: it takes
  // over a moment after it starts)
  try { await SW.ready; } catch (e) { return; }
  for (let i = 0; i < 40 && !SW.controller; i++) await sleep(250);
  if (!SW.controller) return;
  let list;
  try { list = await manifest(); } catch (e) { console.warn('offline', e); return; }
  let todo = await missing(list.urls);
  if (!todo.length) { say(savedWords(), 'ok'); return; }
  // a few at a time, in the page's quiet moments; a file that fails is tried on the next visit
  const total = todo.length;
  let done = 0, failed = 0;
  say(`Saving the game for offline use (${mb(list.bytes)})...`, 'busy');
  const idle = () => new Promise(r => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 50)));
  const worker = async () => {
    while (todo.length) {
      const h = todo.shift();
      await idle();
      try { const r = await fetch(h, { cache: 'no-cache' }); if (r.ok) await r.arrayBuffer(); else if (r.status !== 404) failed++; } catch (e) { failed++; }
      done++;
      if (done % 4 === 0) say(`Saving the game for offline use: ${Math.round(100 * done / total)}%`, 'busy');
      if (navigator.onLine === false) { todo.length = 0; failed++; }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await sleep(500);                                          // (the worker writes each file a moment after the page has it)
  const left = await missing(list.urls);
  if (!left.length) say(savedWords(), 'ok');
  else say(`Saved most of the game for offline use. ${left.length} file${left.length > 1 ? 's' : ''} will be saved on your next visit with a connection.`, 'busy');
  window.__skiOffline = { total, failed, left: left.length, bytes: list.bytes };
}

addEventListener('offline', () => say(OFF_WORDS, 'off'));
addEventListener('online', () => { if (line && line.dataset.kind === 'off') say(''); });
run().catch(e => console.warn('offline', e));
