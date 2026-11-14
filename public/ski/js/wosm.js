/* (W, round 10) Any mountain on Earth: the pistes, lifts, parks and places from OpenStreetMap (ODbL, (c) OpenStreetMap
   contributors), asked for as Leonski 2 asks (its Overpass query, a 12 km half box round the place), from:
   1. the built-in resorts' answers baked with the site (public/legacy/leonski2data/<slug>.json, Leonski 2's own);
   2. this browser's Cache Storage (leonski2-osm, the same keys Leonski 2 uses, so a place opened there opens here at once);
   3. the Overpass mirrors, raced, each with a time limit (the public ones take 20 to 50 s; overpass-api.de and some
      others fail from some networks, maps.mail.ru answers browsers).
   Everything has a time limit and a progress line; nothing found is a bare mountain, still rideable. */
import { Frame } from './wdem.js?v=26';

const MIRRORS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const CACHE = 'leonski2-osm';
export const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const okOsm = j => j && Array.isArray(j.elements) && j.elements.length ? j : null;

// Leonski 2's query: pistes, snow parks, aerialways, eating and sleeping places, closed runs, the ski area's boundary
export function query(lat, lon, half = 12000) {
  const cosC = Math.cos(lat * Math.PI / 180), D = 111320;
  const bb = `${lat - half / D},${lon - half / (D * cosC)},${lat + half / D},${lon + half / (D * cosC)}`;
  return `[out:json][timeout:25];(`
    + `way["piste:type"="downhill"](${bb});`
    + `way["piste:type"="snow_park"](${bb});`
    + `way["aerialway"](${bb});`
    + `nw["amenity"~"restaurant|cafe|bar|fast_food|biergarten"](${bb});`
    + `nw["tourism"~"alpine_hut|wilderness_hut|hotel|hostel|chalet|guest_house"](${bb});`
    + `nw["amenity"="shelter"]["shelter_type"="ski_lodge"](${bb});`
    + `nw["building"="ski_lodge"](${bb});`
    + `way["disused:piste:type"](${bb});`
    + `way["abandoned:piste:type"](${bb});`
    + `way["piste:type"="downhill"]["piste:status"="closed"](${bb});`
    + `way["landuse"="winter_sports"](${bb});`
    + `);out geom;`;
}

// one mirror, with a time limit; an empty answer (a mirror that is out of breath answers 200 with nothing) counts as none
function ask(url, q, ms, signal) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  const stop = () => ac.abort(); if (signal) signal.addEventListener('abort', stop);
  return fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ac.signal })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)))
    .then(j => { if (!okOsm(j)) throw new Error('empty'); return j; })
    .finally(() => { clearTimeout(t); if (signal) signal.removeEventListener('abort', stop); });
}
// all the mirrors at once, the first real answer wins (null if none in ms)
export function overpass(q, ms = 50000, signal) {
  return new Promise(res => {
    let left = MIRRORS.length, done = false;
    for (const u of MIRRORS) ask(u, q, ms, signal).then(j => { if (!done) { done = true; res(j); } }, () => {}).finally(() => { if (--left === 0 && !done) { done = true; res(null); } });
  });
}

/* the answer for a place: { osm, from } where from says where it came from ('site', 'cache', 'overpass' or 'none');
   say(text) is told what is going on */
export async function loadOsm(place, say = () => {}, signal) {
  const key = 'https://leonski2.cache/osm?c=' + place.lat.toFixed(3) + ',' + place.lon.toFixed(3);
  if (place.preset) {
    say('Reading the pistes and lifts');
    try {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000);
      const r = await fetch('/legacy/leonski2data/' + place.preset + '.json', { signal: ac.signal }); clearTimeout(t);
      if (r.ok) { const j = okOsm(await r.json()); if (j) return { osm: j, from: 'site' }; }
    } catch (e) { console.warn('baked osm', e); }
  }
  try { const c = await caches.open(CACHE), r = await c.match(key); if (r) { const j = okOsm(await r.json()); if (j) return { osm: j, from: 'cache' }; } } catch (e) {}
  say('Asking OpenStreetMap for the pistes and lifts (this can take up to a minute)');
  let j = await overpass(query(place.lat, place.lon), 50000, signal);
  if (!j && !(signal && signal.aborted)) { say('Asking OpenStreetMap again'); j = await overpass(query(place.lat, place.lon), 40000, signal); }
  if (j) { try { const c = await caches.open(CACHE); await c.put(key, new Response(JSON.stringify({ elements: j.elements }), { headers: { 'Content-Type': 'application/json' } })); } catch (e) {} return { osm: j, from: 'overpass' }; }
  return { osm: null, from: 'none' };
}

// ---- reading the answer ----------------------------------------------------------------------------------------------
const NOT_LIFTS = new Set(['station', 'goods', 'zip_line', 'explosive', 'pylon', 'canopy', 'yes']);
const DIFF = { novice: 0, easy: 1, intermediate: 2, advanced: 3, expert: 4, freeride: 5, extreme: 5 };
export const DIFF_NAME = ['Novice', 'Easy', 'Intermediate', 'Advanced', 'Expert', 'Freeride', 'Terrain park'];
const PARK_NAME = /\b(snow ?park|terrain ?park|fun ?park|park\b|freestyle|jib|kicker|halfpipe|half pipe|superpipe|boardercross|border ?cross|skicross)/i;
const num = v => { const n = parseFloat(String(v || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
// a run's width: tagged (piste:width, width), else what runs of its difficulty usually are
const WIDTH = [30, 32, 28, 24, 20, 18, 34];

/* parse(osm, frame): everything in local metres.
   pistes: { pts: [{x, z}], diff (0..6, 6 a park), name, ref, groom (true: corduroy), w (metres), area, gladed, lit,
             oneway, closed }
   lifts:  { pts, kind (chair_lift, gondola, t-bar...), name, ref, occupancy, capacity, duration, detachable, heating, bubble }
   places: { x, z, name, kind } (huts, restaurants, lodges, hotels)
   bounds: { pts, name } (the ski area's boundary) */
export function parse(osm, frame) {
  const out = { pistes: [], lifts: [], places: [], bounds: [], closed: [] };
  if (!osm) return out;
  const P = (g) => { const a = []; for (const p of g) { const l = frame.toLocal(p.lat, p.lon); if (!a.length || Math.hypot(l.x - a[a.length - 1].x, l.z - a[a.length - 1].z) > 0.5) a.push(l); } return a; };
  for (const el of osm.elements) {
    const t = el.tags || {};
    if (t.amenity || t.tourism || t.building === 'ski_lodge') {
      const name = t.name; if (!name) continue;
      let lat, lon;
      if (el.type === 'node' && el.lon != null) { lat = el.lat; lon = el.lon; }
      else if (el.geometry && el.geometry.length) { let a = 0, b = 0; for (const g of el.geometry) { a += g.lat; b += g.lon; } lat = a / el.geometry.length; lon = b / el.geometry.length; }
      else continue;
      const l = frame.toLocal(lat, lon);
      const kind = /alpine_hut|wilderness_hut/.test(t.tourism || '') ? 'hut' : /hotel|hostel|chalet|guest_house/.test(t.tourism || '') ? 'hotel' : t.building === 'ski_lodge' || t.shelter_type === 'ski_lodge' ? 'lodge' : t.amenity || 'dining';
      out.places.push({ x: l.x, z: l.z, name, kind });
      continue;
    }
    if (!el.geometry || el.geometry.length < 2) continue;
    if (t.aerialway) {
      if (NOT_LIFTS.has(t.aerialway)) continue;
      const pts = P(el.geometry); if (pts.length < 2) continue;
      out.lifts.push({ pts, kind: t.aerialway, name: t.name || '', ref: t.ref || '', occupancy: num(t['aerialway:occupancy']), capacity: num(t['aerialway:capacity']), duration: num(t['aerialway:duration']), detachable: t['aerialway:detachable'], heating: t['aerialway:heating'], bubble: t['aerialway:bubble'], id: el.id });
      continue;
    }
    if (t.landuse === 'winter_sports') { out.bounds.push({ pts: P(el.geometry), name: t.name || '' }); continue; }
    const closed = !!(t['disused:piste:type'] || t['abandoned:piste:type'] || t['piste:status'] === 'closed');
    const pt = t['piste:type'];
    if (!closed && pt !== 'downhill' && pt !== 'snow_park') continue;
    const pts = P(el.geometry); if (pts.length < 2) continue;
    const name = t.name || t['piste:name'] || '', ref = t.ref || t['piste:ref'] || '';
    const g = String(t['piste:grooming'] || '').toLowerCase();
    let diff = DIFF[t['piste:difficulty'] || t['disused:piste:difficulty']] ?? 2;
    const park = pt === 'snow_park' || (PARK_NAME.test(name) && !/parking/i.test(name));
    if (park) diff = 6;
    // groomed: as tagged; untagged, the marked runs are groomed, the expert, freeride and gladed ones left as they are
    const groom = g ? !/mogul|^no|backcountry/.test(g) : !(t.gladed === 'yes' || diff >= 4 && diff < 6);
    const area = el.geometry.length > 3 && el.geometry[0].lat === el.geometry[el.geometry.length - 1].lat && el.geometry[0].lon === el.geometry[el.geometry.length - 1].lon && (t.area === 'yes' || pt === 'snow_park');
    const w = num(t['piste:width']) || num(t.width) || WIDTH[diff];
    const rec = { pts, diff, name, ref, groom: groom && !closed, w: Math.max(8, Math.min(120, w)), area, park, gladed: t.gladed === 'yes', lit: t.lit === 'yes' || t['piste:lit'] === 'yes', oneway: t['piste:oneway'] || t.oneway, id: el.id, closed };
    (closed ? out.closed : out.pistes).push(rec);
  }
  return out;
}

/* where the riding is: the middle and size of the pistes and lifts (their 5th to 95th percentile, so a run or two far off
   does not stretch it), in local metres; null for none */
export function skiExtent(d) {
  const xs = [], zs = [];
  for (const L of [d.pistes, d.lifts]) for (const r of L) for (const p of r.pts) { xs.push(p.x); zs.push(p.z); }
  if (xs.length < 4) return null;
  xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
  const q = (a, f) => a[Math.floor(f * (a.length - 1))];
  return { x0: q(xs, 0.05), x1: q(xs, 0.95), z0: q(zs, 0.05), z1: q(zs, 0.95), cx: q(xs, 0.5), cz: q(zs, 0.5), n: xs.length };
}
export { Frame };
