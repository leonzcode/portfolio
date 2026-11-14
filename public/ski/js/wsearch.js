/* (W, round 10) Any mountain on Earth: the home screen's tile and its place picker. Loaded on every map, on its own
   (index.html), so it works even when the game did not start (a place that could not be built: pick another).
   - The search asks Photon (typing ahead, typo tolerant) and Nominatim (whole phrases) together, as Leonski 2 does:
     at most one Nominatim request a second (its usage policy), half a second after the typing stops, nothing about you
     sent but the words typed. The answers are merged, near-duplicates dropped, ranked by how well the name fits, ski
     areas a little higher.
   - The built-in resorts are listed by region; their pistes and lifts ship with the site, so they open fastest.
   Picking a place keeps it (ski_opts: map 'world', place) and starts the game again there. */
import { PRESETS, presetOf, keepPlace, worldId } from './wplaces.js?v=26';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[-'’.,]+/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let row = new Array(n + 1); for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) { let prev = row[0], cur = i; const ca = a.charCodeAt(i - 1); for (let j = 1; j <= n; j++) { const t = row[j]; cur = Math.min(row[j] + 1, cur + 1, prev + (ca === b.charCodeAt(j - 1) ? 0 : 1)); row[j] = cur; prev = t; } row[n] = cur; }
  return row[n];
}
// how well a query fits a name: the whole, its start, a word's start, inside it, then the start with a typo or two
function fit(q, text) {
  q = norm(q); const t = norm(text); if (!q || !t) return 0;
  if (t === q) return 1000; if (t.startsWith(q)) return 900; if (q.startsWith(t) && t.length >= 4) return 880;
  if ((' ' + t).includes(' ' + q)) return 820; if (t.includes(q)) return 700;
  const head = t.slice(0, q.length + 1), sim = 1 - lev(q, head) / Math.max(q.length, head.length);
  let best = sim >= 0.74 ? 520 * sim : 0;
  for (const w of t.split(' ')) { if (w.length < 3) continue; const wp = w.slice(0, q.length + 1), s = 1 - lev(q, wp) / Math.max(q.length, wp.length); if (s >= 0.76) best = Math.max(best, 480 * s); }
  return best;
}
const SKI = /ski|piste|aerialway|winter|resort|snow/;
async function photon(q, signal) {
  const r = await fetch('https://photon.komoot.io/api/?limit=12&lang=en&q=' + encodeURIComponent(q), { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.features || []).map((f, i) => {
    const pr = f.properties || {}, c = (f.geometry && f.geometry.coordinates) || [];
    const name = pr.name || pr.city || pr.county || pr.state || '';
    const parts = [pr.city || pr.county || pr.district, pr.state, pr.country].filter(Boolean), sub = parts.filter((v, k) => parts.indexOf(v) === k && v !== name).join(', ');
    const tags = ((pr.osm_key || '') + ' ' + (pr.osm_value || '') + ' ' + (pr.type || '') + ' ' + name).toLowerCase();
    return { name, sub, lat: +c[1], lon: +c[0], ski: SKI.test(tags), score: fit(q, name) + fit(q, sub) * 0.25 + (12 - i) * 4 };
  }).filter(g => g.name && isFinite(g.lat) && isFinite(g.lon));
}
let nomAt = 0;
async function nominatim(q, signal) {
  // (its usage policy: one request a second at most)
  const wait = 1100 - (Date.now() - nomAt); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  if (signal.aborted) return [];
  nomAt = Date.now();
  const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&namedetails=1&dedupe=1&limit=10&q=' + encodeURIComponent(q), { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) return [];
  const a = await r.json();
  return (a || []).map(p => {
    const name = (p.namedetails && p.namedetails.name) || (p.display_name || '').split(',')[0];
    const sub = (p.display_name || '').split(',').slice(1, 4).join(',').trim();
    const tags = ((p.type || '') + ' ' + (p.class || '') + ' ' + (p.display_name || '')).toLowerCase();
    return { name, sub, lat: +p.lat, lon: +p.lon, ski: SKI.test(tags), score: fit(q, name) + fit(q, sub) * 0.25 + (p.importance || 0) * 120 };
  }).filter(g => g.name && isFinite(g.lat) && isFinite(g.lon));
}

// ---- the panel ---------------------------------------------------------------------------------------------------------
function readOpts() { try { return JSON.parse(localStorage.getItem('ski_opts') || '{}'); } catch (e) { return {}; } }
function go(place) {
  const o = readOpts();
  o.map = 'world'; o.place = keepPlace(place);
  try { localStorage.setItem('ski_opts', JSON.stringify(o)); } catch (e) {}
  // (a test or a link with ?map= keeps it)
  const u = new URL(location.href);
  if (u.searchParams.has('map')) { u.searchParams.set('map', 'world'); location.replace(u.href); } else location.reload();
}
function init() {
  const tile = document.querySelector('[data-wmap]'), panel = $('wpanel');
  if (!tile || !panel) return;
  const o = readOpts(), qm = new URLSearchParams(location.search).get('map'), onWorld = (qm || o.map) === 'world';
  const place = o.place || null;
  const mark = on => { tile.setAttribute('aria-checked', String(on)); if (on) document.querySelectorAll('[data-map]').forEach(b => b.setAttribute('aria-checked', 'false')); };
  // the place being ridden (or the last one picked)
  const now = $('wnow');
  if (place) { now.querySelector('b').textContent = place.name; now.querySelector('small').textContent = place.sub || ''; now.hidden = false; }
  else now.hidden = true;
  $('wnowlab').textContent = onWorld ? 'Riding' : 'Last picked';
  { const op = $('onplace'); if (op) op.textContent = place ? 'At ' + place.name + (onWorld ? '' : ' (opens it)') : 'Opens Mammoth (pick another above)'; }
  if (onWorld) { mark(true); panel.classList.remove('hidden'); }
  tile.onclick = () => { const open = panel.classList.contains('hidden'); panel.classList.toggle('hidden', !open); if (open) { mark(true); setTimeout(() => $('wq').focus(), 0); } else if (!onWorld) { tile.setAttribute('aria-checked', 'false'); main(); } };
  // (put back the tile that is really loaded when the panel is closed without picking)
  const main = () => { const m = (qm || o.map) || 'jumpline'; document.querySelectorAll('[data-map]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.map === m))); };
  // (the other tiles, if the game itself did not start and so never wired them)
  document.querySelectorAll('[data-map]').forEach(b => b.addEventListener('click', () => {
    if (window.__ski) return;
    const o2 = readOpts(); if (o2.map === b.dataset.map && !onWorld) return;
    o2.map = b.dataset.map; try { localStorage.setItem('ski_opts', JSON.stringify(o2)); } catch (e) {}
    const u = new URL(location.href); if (u.searchParams.has('map')) { u.searchParams.set('map', b.dataset.map); location.replace(u.href); } else location.reload();
  }));
  // ---- the built-in resorts, by region
  const pre = $('wpre'), cur = place ? worldId(place) : '';
  const regions = [...new Set(PRESETS.map(p => p.region))];
  pre.innerHTML = regions.map(r => `<div class="wreg"><span class="wreglab">${esc(r)}</span>${PRESETS.filter(p => p.region === r).map(p =>
    `<button type="button" class="wres" data-pre="${esc(p.preset)}"${onWorld && cur === worldId(p) ? ' aria-current="true"' : ''}><b>${esc(p.name)}</b><small>${esc(p.sub)}</small></button>`).join('')}</div>`).join('');
  pre.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => go(PRESETS.find(p => p.preset === b.dataset.pre)));
  // ---- the search
  const q = $('wq'), list = $('wsug'), state = $('wqstate');
  let items = [], sel = -1, timer = 0, ac = null, last = '';
  const hide = () => { list.classList.add('hidden'); q.setAttribute('aria-expanded', 'false'); sel = -1; };
  const show = () => {
    if (!items.length) { hide(); return; }
    list.innerHTML = items.map((it, i) => it.note ? `<li class="wnote" role="option" aria-disabled="true">${esc(it.note)}</li>` :
      `<li role="option" id="wsug${i}" data-i="${i}"${i === sel ? ' aria-selected="true"' : ''}><span class="wpin${it.ski ? ' ski' : ''}" aria-hidden="true"></span><span class="wtxt"><b>${esc(it.name)}</b><small>${esc(it.sub || '')}${it.preset ? ' &middot; built in' : ''}</small></span></li>`).join('');
    list.classList.remove('hidden'); q.setAttribute('aria-expanded', 'true');
    if (sel >= 0) q.setAttribute('aria-activedescendant', 'wsug' + sel); else q.removeAttribute('aria-activedescendant');
    list.querySelectorAll('[data-i]').forEach(li => li.onclick = () => pick(+li.dataset.i));
  };
  const pick = i => { const it = items[i]; if (!it || it.note) return; q.value = it.name; hide(); state.textContent = 'Loading ' + it.name + '...'; go(it.preset ? presetOf(it) : it); };
  const search = async text => {
    if (ac) ac.abort(); ac = new AbortController(); const signal = ac.signal;
    // the built-in resorts first (no waiting), typos forgiven
    const mine = PRESETS.map(p => ({ name: p.name, sub: p.sub, lat: p.lat, lon: p.lon, ski: true, preset: p.preset, score: Math.max(fit(text, p.name), fit(text, p.sub) * 0.6) + 400 })).filter(p => p.score >= 700).sort((a, b) => b.score - a.score);
    items = mine.slice(0, 5); sel = -1; show();
    state.textContent = 'Searching...';
    const to = setTimeout(() => ac.abort(), 9000);
    const words = text.split(/\s+/).filter(Boolean);
    const jobs = [photon(text, signal).catch(() => []), nominatim(text, signal).catch(() => [])];
    if (words.length >= 3) jobs.push(photon(words.slice(0, 2).join(' '), signal).catch(() => []));
    const res = await Promise.all(jobs); clearTimeout(to);
    if (q.value.trim() !== text) return;
    const seen = mine.map(p => ({ key: norm(p.name), lat: p.lat, lon: p.lon })), out = [...mine];
    for (const c of res.flat()) {
      const key = norm(c.name); if (!key) continue;
      if (seen.some(p => (p.key === key && Math.abs(p.lat - c.lat) < 0.05 && Math.abs(p.lon - c.lon) < 0.05) || (Math.abs(p.lat - c.lat) < 0.003 && Math.abs(p.lon - c.lon) < 0.003))) continue;
      seen.push({ key, lat: c.lat, lon: c.lon }); out.push(c);
    }
    out.sort((a, b) => (b.score + (b.ski ? 50 : 0)) - (a.score + (a.ski ? 50 : 0)));
    const answered = res.some(r => r.length);
    items = out.length ? out.slice(0, 10) : [{ note: answered || mine.length ? 'Nothing by that name. Try a nearby town or the mountain itself.' : 'The place search is not answering right now. Pick a built-in resort, or try again in a moment.' }];
    state.textContent = signal.aborted && !answered ? 'The search took too long. Try again, or pick a built-in resort.' : '';
    sel = -1; show();
  };
  q.addEventListener('input', () => {
    const t = q.value.trim(); clearTimeout(timer);
    if (t.length < 2) { hide(); state.textContent = ''; if (ac) ac.abort(); return; }
    timer = setTimeout(() => { if (t !== last || list.classList.contains('hidden')) { last = t; search(t); } }, 450);
  });
  q.addEventListener('keydown', e => {
    e.stopPropagation();                                  // (the game's keys never see what is typed here)
    if (e.key === 'Escape') { hide(); return; }
    if (list.classList.contains('hidden')) { if (e.key === 'Enter' && q.value.trim().length >= 2) { clearTimeout(timer); search(q.value.trim()); } return; }
    const n = items.length;
    if (e.key === 'ArrowDown') { sel = Math.min(n - 1, sel + 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); show(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(sel >= 0 ? sel : items.findIndex(i => !i.note)); e.preventDefault(); }
  });
  q.addEventListener('keyup', e => e.stopPropagation());
  document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('.wsearch')) hide(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
