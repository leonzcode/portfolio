/* Leon Freeski's offline copy (2026-11-16, for "make games like leonski and others with single player options available
   offline to play as well without server connection needed").

   A service worker for /ski/ only (its scope is this folder: no other page of the site goes through it). It keeps the
   game's own files in the Cache Storage, so after one visit with a connection the game opens and rides with none.

   - The page (/ski/, /ski/?map=...): the network first, the copy here if no answer comes in HTML_MS or there is no
     connection. So an update is always seen on a visit with a connection.
   - The game's code with a stamp (js/x.js?v=33, the css, three.js's ?v=ski33): kept by its whole address, answered
     from the copy at once and asked of the network behind (a new stamp is a new address, so it comes fresh; a file
     changed without a new stamp is picked up for the next visit, as the browser's own cache did). The page
     (js/offline.js) drops older stamps' copies once a new stamp has loaded.
   - Everything else of ours (models, pictures, sounds, data, three.js's unstamped files): the network first, kept by
     its path (the host ignores the query), the copy here if no answer comes in FILE_MS or there is no connection.
   - Fonts from Google: the copy here, refreshed behind.
   - The game server (apps.leonzhao.dev) and every other site (map tiles, place search): never touched here.
   What gets saved ahead of use (every run's files) is the page's work: js/offline.js fetches them through this worker.

   Ways out, if this ever goes wrong:
   - /ski/?nosw: this worker lets that page through untouched, removes itself and its copy (js/offline.js does too);
   - KILL = true below, deployed: every browser's worker empties its copy and stands aside at its next update check
     (any visit with a connection); set ON = false in js/offline.js as well, so the page stops registering it.
   The caches Any mountain keeps itself (ski-dem-v1, ski-land-v1, leonski2-osm) are left alone. */
const KILL = false;
const PREFIX = 'ski-offline-';
const CACHE = PREFIX + 'v1';
const SCOPE = new URL('./', self.location.href);         // https://leonzhao.dev/ski/
const HTML_MS = 4000, FILE_MS = 6000;
const CODE = /\.(m?js|css|wasm)$/i;
const FONT_HOSTS = /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/;
const NEVER = /(^|\.)(apps|ml)\.leonzhao\.dev$/;
let gone = KILL;

async function removeSelf() {
  gone = true;
  for (const n of await caches.keys()) if (n.startsWith(PREFIX)) await caches.delete(n);
  await self.registration.unregister();
}
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    if (KILL) {
      await removeSelf();
      for (const c of await self.clients.matchAll({ type: 'window' })) { try { c.navigate(c.url); } catch (err) {} }
      return;
    }
    for (const n of await caches.keys()) if (n.startsWith(PREFIX) && n !== CACHE) await caches.delete(n);
    await self.clients.claim();
  })());
});

// a request's place in the copy: code with a stamp by its whole address, the page and everything else of ours by path
function keyOf(u) {
  if (u.searchParams.has('v') && CODE.test(u.pathname)) return u.href;
  let p = u.pathname;
  if (p.endsWith('/index.html')) p = p.slice(0, -10);
  return u.origin + p;
}
const wait = ms => new Promise(res => setTimeout(() => res('timeout'), ms));

// keep a response, unless the copy already has this very file (same validator), so a visit does not rewrite it all
async function keep(cache, key, res) {
  if (gone || !res || res.status !== 200 || res.type !== 'basic') return;
  try {
    const old = await cache.match(key);
    if (old) {
      const a = res.headers, b = old.headers, tag = a.get('etag');
      if (tag && tag === b.get('etag')) return;
      if (!tag && a.get('last-modified') && a.get('last-modified') === b.get('last-modified') && a.get('content-length') === b.get('content-length')) return;
    }
    // (a response that came through a redirect cannot answer a page's own address: kept as a plain one)
    await cache.put(key, res.redirected ? new Response(await res.blob(), { status: 200, headers: res.headers }) : res);
  } catch (err) {}
}

/* the network first; the copy if the network fails, or says nothing in ms and the copy has it. A page asked for is
   tried twice when the first try fails at once (a connection dropped on the way). (Every waitUntil is called while
   respondWith's answer is still pending, as the service worker rules ask.) */
/* While the network has just failed or said nothing in time (slowUntil), files the copy has are answered from it at
   once, the network still asked behind: a network that answers nothing (as a filtered one may) then costs one wait,
   not one for every file. */
let slowUntil = 0;
async function networkFirst(e, req, key, ms) {
  const cache = await caches.open(CACHE);
  let stored = null;
  const t0 = Date.now(), get = () => fetch(req);
  const tries = req.mode === 'navigate' ? get().catch(err => (Date.now() - t0 < 1500 ? get() : Promise.reject(err))) : get();
  const net = tries.then(res => { slowUntil = 0; if (res.ok) stored = keep(cache, key, res.clone()); return res; });
  e.waitUntil(net.then(() => stored, () => {}));
  if (Date.now() < slowUntil) { const kept = await cache.match(key); if (kept) return kept; }
  const first = await Promise.race([net.catch(() => 'failed'), wait(ms)]);
  if (first !== 'failed' && first !== 'timeout') return first;
  slowUntil = Date.now() + 30000;
  const kept = await cache.match(key);
  return kept || net;              // (nothing kept: the network's own answer, or its failure)
}
// the copy at once, the network behind it (kept for next time); with nothing kept, the network
async function staleWhileRevalidate(e, req, key, store) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(key);
  let stored = null;
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') stored = store(cache, key, res.clone()); return res; });
  e.waitUntil(net.then(() => stored, () => {}));
  return kept || net;
}
const putAny = (cache, key, res) => (gone ? null : cache.put(key, res).catch(() => {}));

self.addEventListener('fetch', e => {
  if (gone) return;
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  let u; try { u = new URL(req.url); } catch (err) { return; }
  if (NEVER.test(u.hostname)) return;
  if (u.origin === self.location.origin) {
    if (req.mode === 'navigate' && !u.pathname.startsWith(SCOPE.pathname)) return;
    if (req.mode === 'navigate' && u.searchParams.has('nosw')) { e.waitUntil(removeSelf()); return; }
    const key = keyOf(u), code = key === u.href;
    // (anything going wrong in here, the Cache Storage refused for one, falls back to the plain network)
    e.respondWith((code ? staleWhileRevalidate(e, req, key, keep) : networkFirst(e, req, key, req.mode === 'navigate' ? HTML_MS : FILE_MS)).catch(() => fetch(req)));
    return;
  }
  if (FONT_HOSTS.test(u.hostname)) e.respondWith(staleWhileRevalidate(e, req, req, putAny).catch(() => fetch(req)));
});
