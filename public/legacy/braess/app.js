'use strict';
/* =====================================================================
 * Braess's Paradox simulator: the page.
 *
 * Search or click anywhere, and the page fetches that area's streets and
 * land use from OpenStreetMap, simulates its traffic for the chosen time on
 * every core (engine.js in Web Workers) and shows the roads whose closure
 * would make traffic faster. The traffic map is drawn as soon as the first
 * equilibrium is in; the Braess roads follow as the closures are tested.
 *
 * Popular places (hotspots.json) were simulated ahead of time; their streets
 * ship with the page (data/<id>.json), so opening one needs no download from
 * OpenStreetMap at all.
 * ===================================================================== */
(function () {
const E = window.BraessEngine;
const V = '?v=2';
const $ = id => document.getElementById(id);
const clamp = E.clamp;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v, d = 2) => (v * 100).toFixed(d) + '%';
const hhmm = h => String(Math.floor(h) % 24).padStart(2, '0') + ':' + String(Math.round((h - Math.floor(h)) * 60)).padStart(2, '0');
const ampm = h => { const k = Math.floor(h) % 24; return (k % 12 || 12) + (k < 12 ? 'a' : 'p'); };
const frame = () => new Promise(r => requestAnimationFrame(() => r()));
const D2R = Math.PI / 180;
const params = new URLSearchParams(location.search);

const I = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  pin: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  play: 'M8 5v14l11-7z',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z',
  focus: 'M5 15H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zM12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
  radius: 'M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10 10-4.49 10-10S17.51 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3-8c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3z',
  people: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  fire: 'M19.48 12.35c-1.57-4.08-7.16-4.3-5.81-10.23.1-.44-.37-.78-.75-.55C9.29 3.71 6.68 8 8.87 13.62c.18.46-.36.89-.75.59-1.81-1.37-2-3.34-1.84-4.75.06-.52-.62-.77-.91-.34C4.69 10.16 4 11.84 4 14.37c.38 5.6 5.11 7.32 6.81 7.54 2.43.31 5.06-.14 6.95-1.87 2.08-1.93 2.84-5.01 1.72-7.69z',
  speed: 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z',
  block: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.9 7.9 0 0 1 20 12c0 4.42-3.58 8-8 8z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  sun: 'M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91l-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7l1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91l1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z',
  moon: 'M9.37 5.51A7.35 7.35 0 0 0 9.1 7.5c0 4.08 3.32 7.4 7.4 7.4.68 0 1.35-.09 1.99-.27A7.01 7.01 0 0 1 12 19c-3.86 0-7-3.14-7-7 0-2.93 1.81-5.45 4.37-6.49zM12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z',
  calendar: 'M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z',
  car: 'M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z',
  route: 'M19 15.18V7c0-2.21-1.79-4-4-4s-4 1.79-4 4v10c0 1.1-.9 2-2 2s-2-.9-2-2V8.82A2.996 2.996 0 0 0 5 3a2.996 2.996 0 0 0-1 5.82V17c0 2.21 1.79 4 4 4s4-1.79 4-4V7c0-1.1.9-2 2-2s2 .9 2 2v8.18A2.996 2.996 0 0 0 17 21a2.996 2.996 0 0 0 1-5.82z',
  list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  quote: 'M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z',
  globe: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
};
const svg = (d, cls) => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''}><path d="${d}"/></svg>`;
const PIN_SVG = '<svg viewBox="0 0 27 43"><path d="M13.5 0C6 0 0 6 0 13.5 0 23.6 13.5 43 13.5 43S27 23.6 27 13.5C27 6 21 0 13.5 0z" fill="#ea4335"/><path d="M13.5 1C6.6 1 1 6.6 1 13.5c0 9.4 12.5 27.7 12.5 27.7S26 22.9 26 13.5C26 6.6 20.4 1 13.5 1z" fill="none" stroke="#b31412" stroke-width="1"/><circle cx="13.5" cy="13.5" r="4.6" fill="#7d0b0b"/></svg>';
const TRAFFIC = { fast: '#4cb860', med: '#ffa040', slow: '#ec3a2c', jam: '#8a1d18' };
const vcColor = vc => vc < 0.6 ? TRAFFIC.fast : vc < 0.85 ? TRAFFIC.med : vc < 1.1 ? TRAFFIC.slow : TRAFFIC.jam;
const vcWord = vc => vc < 0.6 ? 'Light traffic' : vc < 0.85 ? 'Moderate traffic' : vc < 1.1 ? 'Heavy traffic' : 'Stop-and-go traffic';
const HW_NAME = { motorway: 'Motorway', trunk: 'Major highway', primary: 'Main road', secondary: 'Through road', tertiary: 'Local through road', unclassified: 'Minor road',
  residential: 'Residential street', living_street: 'Shared street', motorway_link: 'Motorway ramp', trunk_link: 'Highway ramp', primary_link: 'Slip road', secondary_link: 'Slip road', tertiary_link: 'Slip road' };

/* ------------------------------- state ------------------------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('braess_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('braess_' + k, JSON.stringify(v)); } catch {} },
};
const S = {
  place: null,          // { lat, lng, title, sub, kind, hot }
  radius: 1200, hour: 17.5, prof: 'wd', mult: 1.3,
  net: null, netKey: '', res: null, resKey: '', busy: null, running: false, run: 0, pool: null,
  tab: 'overview', sort: 'popular', hot: [], selRoad: null,
  opt: Object.assign({ sat: false, traffic: true, cars: true, sweep: true }, store.get('opt', {})),
};
const offsetOf = lng => Math.round(lng / 15);   // the local clock, estimated from longitude
function localNow(lng) {
  const d = new Date(), h = d.getUTCHours() + d.getUTCMinutes() / 60 + offsetOf(lng);
  return ((h % 24) + 24) % 24;
}
function dayTypeAt(lng) {
  const d = new Date(Date.now() + offsetOf(lng) * 3600e3).getUTCDay();
  return d === 0 || d === 6 ? 'we' : 'wd';
}

/* -------------------------------- map -------------------------------- */
const map = new maplibregl.Map({
  container: 'map', style: window.BRAESS_MAP_STYLE, center: [10, 28], zoom: 1.7, minZoom: 1, maxZoom: 19.5,
  attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, renderWorldCopies: true,
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation && map.keyboard.disableRotation();
const ready = new Promise(r => map.on('load', r));
const BEFORE = 'water-name';      // the first label layer: our lines go under every label
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
ready.then(() => {
  map.addSource('area', { type: 'geojson', data: emptyFC() });
  map.addSource('net', { type: 'geojson', data: emptyFC() });
  map.addSource('braess', { type: 'geojson', data: emptyFC() });
  map.addSource('sel', { type: 'geojson', data: emptyFC() });
  map.addSource('sweep', { type: 'geojson', data: emptyFC() });
  const width = k => ['interpolate', ['exponential', 1.6], ['zoom'], 11, ['*', ['get', 'w'], 0.45 * k], 14, ['*', ['get', 'w'], 1.0 * k], 17, ['*', ['get', 'w'], 2.3 * k], 19, ['*', ['get', 'w'], 4 * k]];
  const add = l => map.addLayer(l, BEFORE);
  add({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.05 } });
  add({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': '#1a73e8', 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } });
  add({ id: 'net-off', type: 'line', source: 'net', filter: ['==', ['get', 'a'], 0], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#9aa0a6', 'line-width': width(0.5), 'line-opacity': 0.55 } });
  add({ id: 'net-wait', type: 'line', source: 'net', filter: ['all', ['==', ['get', 'a'], 1], ['==', ['get', 'r'], 0]], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#8ab4f8', 'line-width': width(0.75), 'line-opacity': 0.6 } });
  add({ id: 'sweep', type: 'line', source: 'sweep', filter: ['<', ['get', 'k'], 0], layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': width(1), 'line-opacity': 0.95 } });
  add({ id: 'traffic', type: 'line', source: 'net', filter: ['all', ['==', ['get', 'a'], 1], ['==', ['get', 'r'], 1]], layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'vc'] },
    paint: { 'line-color': ['step', ['get', 'vc'], TRAFFIC.fast, 0.6, TRAFFIC.med, 0.85, TRAFFIC.slow, 1.1, TRAFFIC.jam], 'line-width': width(1), 'line-opacity': ['interpolate', ['linear'], ['get', 'fl'], 0, 0.35, 30, 0.95] } });
  add({ id: 'sel', type: 'line', source: 'sel', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': width(2.6), 'line-opacity': 0.35 } });
  add({ id: 'braess-glow', type: 'line', source: 'braess', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#a142f4', 'line-width': width(4.2), 'line-opacity': 0.32, 'line-blur': 3 } });
  add({ id: 'braess-base', type: 'line', source: 'braess', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': width(1.9) } });
  add({ id: 'braess', type: 'line', source: 'braess', layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#8430ce', 'line-width': width(1.6), 'line-dasharray': [0, 4, 3] } });
  // wide, invisible lines that take the clicks
  add({ id: 'hit', type: 'line', source: 'net', filter: ['==', ['get', 'a'], 1], paint: { 'line-color': '#000', 'line-opacity': 0, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 8, 17, 22] } });
  setSat(S.opt.sat);
  showTraffic(S.opt.traffic);
  animateDash();
});
// the Braess lines' dashes march along them
const DASHES = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0], [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];
function animateDash() {
  let i = 0, last = 0;
  const step = t => {
    requestAnimationFrame(step);
    if (t - last < 70 || !map.getLayer('braess') || !S.res || !S.res.braess.length) return;
    last = t; i = (i + 1) % DASHES.length;
    map.setPaintProperty('braess', 'line-dasharray', DASHES[i]);
  };
  requestAnimationFrame(step);
}
function setSat(on) {
  S.opt.sat = on; store.set('opt', S.opt);
  if (!map.getLayer('satellite')) return;
  map.setLayoutProperty('satellite', 'visibility', on ? 'visible' : 'none');
  for (const l of map.getStyle().layers) {
    if (/^(landuse|landcover|park|water$|waterway|building|aeroway)/.test(l.id)) map.setLayoutProperty(l.id, 'visibility', on ? 'none' : 'visible');
    if (/^road-.*case$/.test(l.id) || /^road-(service|minor|major|primary|trunk|motorway|path)$/.test(l.id)) map.setPaintProperty(l.id, 'line-opacity', on ? 0.35 : 1);
  }
  drawLayersThumb();
}
function showTraffic(on) {
  S.opt.traffic = on; store.set('opt', S.opt);
  for (const id of ['traffic', 'net-wait', 'net-off']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  updateLegend();
}

/* ------------------------- tiles for pictures ------------------------ */
const SAT = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
// <img> tiles laid so the point sits in the middle of a box of w x h
function tilesHTML(lat, lng, z, w, h) {
  const n = 2 ** z, px = (lng + 180) / 360 * n * 256;
  const s = Math.sin(lat * D2R), py = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256;
  const x0 = Math.floor((px - w / 2) / 256), x1 = Math.floor((px + w / 2) / 256), y0 = Math.floor((py - h / 2) / 256), y1 = Math.floor((py + h / 2) / 256);
  let out = '';
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (ty < 0 || ty >= n) continue;
    const wx = ((tx % n) + n) % n;
    out += `<img alt="" loading="lazy" src="${SAT(z, wx, ty)}" style="left:${Math.round(tx * 256 - px)}px;top:${Math.round(ty * 256 - py)}px">`;
  }
  return out;
}
// (MapLibre's zoom counts 512-pixel tiles)
const zoomForRadius = (r, lat, px) => clamp(Math.log2(40075016 * Math.cos(lat * D2R) * px / (2 * r * 512 * 1.12)), 3, 18);

/* ------------------------------- markers ------------------------------ */
let centerMarker = null, braessMarkers = [], hotMarkers = [];
function setCenterMarker(p) {
  if (!centerMarker) {
    const el = document.createElement('div');
    el.className = 'pin'; el.innerHTML = PIN_SVG; el.title = 'Drag to move the study point';
    centerMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
    centerMarker.on('dragend', () => { const ll = centerMarker.getLngLat(); openPoint(ll.lat, ll.lng, true); });
  } else centerMarker.setLngLat([p.lng, p.lat]);
}
function drawArea() {
  ready.then(() => {
    const src = map.getSource('area');
    if (!S.place) return src.setData(emptyFC());
    const { lat, lng } = S.place, r = S.radius, pts = [];
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * 2 * Math.PI;
      pts.push([lng + r * Math.cos(a) / (111320 * Math.cos(lat * D2R)), lat + r * Math.sin(a) / 110574]);
    }
    src.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} });
  });
}
function drawHotMarkers() {
  for (const m of hotMarkers) m.remove();
  hotMarkers = [];
  for (const h of S.hot) {
    const el = document.createElement('button');
    el.className = 'hpin'; el.type = 'button';
    el.innerHTML = `<i>${svg(I.fire)}</i>${esc(h.city)}`;
    el.title = `${h.name}, ${h.city}`;
    el.addEventListener('click', e => { e.stopPropagation(); openHot(h); });
    hotMarkers.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([h.lon, h.lat]).addTo(map));
  }
  syncHotMarkers();
}
function syncHotMarkers() {
  const show = map.getZoom() < 11.5;
  for (const m of hotMarkers) m.getElement().style.display = show ? '' : 'none';
}
map.on('zoom', syncHotMarkers);

/* ------------------------------- search ------------------------------- */
const searchBox = $('search'), q = $('q'), sugg = $('sugg');
let suggItems = [], suggSel = -1, suggCtl = null, suggTimer = 0;
function openSugg(on) { searchBox.classList.toggle('open', on); }
function renderSugg() {
  if (!suggItems.length) { sugg.innerHTML = q.value.trim() ? '<div class="sugg-empty">No places found.</div>' : ''; openSugg(!!q.value.trim()); return; }
  sugg.innerHTML = suggItems.map((s, i) => `<div class="sugg-row${i === suggSel ? ' sel' : ''}" role="option" data-i="${i}">
    <span class="sugg-ic${s.hot ? ' hot' : ''}">${svg(s.hot ? I.fire : I.pin)}</span>
    <span class="sugg-txt"><span class="sugg-main">${s.mainHTML}</span><span class="sugg-sub">${esc(s.sub)}</span></span></div>`).join('');
  openSugg(true);
}
const bold = (text, query) => {
  const t = esc(text), i = text.toLowerCase().indexOf(query.toLowerCase());
  return i < 0 || !query ? t : esc(text.slice(0, i)) + '<b>' + esc(text.slice(i, i + query.length)) + '</b>' + esc(text.slice(i + query.length));
};
function hotMatches(text) {
  const t = text.toLowerCase();
  return S.hot.filter(h => (h.name + ' ' + h.city + ' ' + h.country).toLowerCase().includes(t)).slice(0, 3)
    .map(h => ({ hot: h, mainHTML: bold(h.name + ', ' + h.city, text), sub: 'Braess hotspot · ' + h.country }));
}
async function suggest() {
  const text = q.value.trim();
  $('clearQ').hidden = !text;
  if (suggCtl) suggCtl.abort();
  if (!text) { suggItems = []; renderSugg(); return; }
  const hot = hotMatches(text);
  suggItems = hot; suggSel = -1; renderSugg();
  if (text.length < 2) return;
  suggCtl = new AbortController();
  try {
    const r = await fetch('https://photon.komoot.io/api/?' + new URLSearchParams({ q: text, limit: '6', lang: 'en' }), { signal: suggCtl.signal });
    const j = await r.json();
    const seen = new Set();
    const places = (j.features || []).map(f => {
      const p = f.properties || {}, c = f.geometry.coordinates;
      const name = p.name || p.street || p.city || text;
      const sub = [p.street && p.name !== p.street ? p.street : '', p.city !== name ? p.city : '', p.state, p.country].filter(Boolean).join(', ');
      return { lat: c[1], lng: c[0], name, sub, kind: p.osm_value ? p.osm_value.replace(/_/g, ' ') : '', mainHTML: bold(name, text), extent: p.extent };
    }).filter(s => { const k = s.name + s.sub; if (seen.has(k)) return false; seen.add(k); return true; });
    suggItems = hot.concat(places); suggSel = -1; renderSugg();
  } catch (e) { if (e.name !== 'AbortError') renderSugg(); }
}
async function searchNow() {
  const text = q.value.trim();
  if (!text) return;
  if (suggItems.length) return pickSugg(suggSel >= 0 ? suggSel : 0);
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q: text, format: 'jsonv2', limit: '1' }), { headers: { 'Accept-Language': 'en' } });
    const j = await r.json();
    if (!j.length) return toast('No place called "' + text + '" was found.');
    const d = j[0];
    openSugg(false); q.blur();
    openPlace({ lat: +d.lat, lng: +d.lon, title: d.name || d.display_name.split(',')[0], sub: d.display_name.split(',').slice(1, 4).join(',').trim(), kind: (d.type || '').replace(/_/g, ' ') });
  } catch { toast('Search is not answering. Try again in a moment.'); }
}
function pickSugg(i) {
  const s = suggItems[i];
  if (!s) return;
  openSugg(false); q.blur();
  if (s.hot) { q.value = s.hot.name + ', ' + s.hot.city; return openHot(s.hot); }
  q.value = s.name;
  openPlace({ lat: s.lat, lng: s.lng, title: s.name, sub: s.sub, kind: s.kind });
}
q.addEventListener('input', () => { clearTimeout(suggTimer); suggTimer = setTimeout(suggest, 220); });
q.addEventListener('focus', () => { if (q.value.trim()) suggest(); });
q.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!suggItems.length) return;
    suggSel = (suggSel + (e.key === 'ArrowDown' ? 1 : -1) + suggItems.length) % suggItems.length;
    renderSugg();
  } else if (e.key === 'Enter') { e.preventDefault(); searchNow(); }
  else if (e.key === 'Escape') { openSugg(false); q.blur(); }
});
sugg.addEventListener('mousedown', e => { const r = e.target.closest('.sugg-row'); if (r) { e.preventDefault(); pickSugg(+r.dataset.i); } });
document.addEventListener('mousedown', e => { if (!searchBox.contains(e.target)) openSugg(false); });
$('goQ').onclick = searchNow;
$('clearQ').onclick = () => { q.value = ''; $('clearQ').hidden = true; suggItems = []; renderSugg(); q.focus(); };
$('runTop').onclick = () => { if (S.place) simulate(); else toast('Search for a place or click the map first.'); };

/* -------------------------------- chips ------------------------------- */
function renderChips() {
  const chips = [
    ['hot', I.fire, 'Paradox hotspots', !S.place],
    ['am', I.sun, 'Morning rush', S.place && S.hour === 8 && S.prof === 'wd'],
    ['pm', I.car, 'Evening rush', S.place && S.hour === 17.5 && S.prof === 'wd'],
    ['now', I.clock, 'Now', false],
    ['we', I.calendar, 'Weekend', S.place && S.prof === 'we'],
  ];
  $('chips').innerHTML = chips.map(([id, ic, t, on]) => `<button class="chip${on ? ' on' : ''}${id === 'hot' ? ' hot' : ''}" data-c="${id}">${svg(ic)}${t}</button>`).join('');
}
$('chips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const c = b.dataset.c;
  if (c === 'hot') return goHome(true);
  if (!S.place) return toast('Pick a place first, then choose a time.');
  if (c === 'am') { S.hour = 8; S.prof = 'wd'; }
  if (c === 'pm') { S.hour = 17.5; S.prof = 'wd'; }
  if (c === 'we') S.prof = S.prof === 'we' ? 'wd' : 'we';
  if (c === 'now') { S.hour = Math.round(localNow(S.place.lng) * 4) / 4; S.prof = dayTypeAt(S.place.lng); }
  renderChips(); renderPlace(); simulate();
});

/* -------------------------------- panel ------------------------------- */
const panel = $('panel'), pscroll = $('pscroll');
function openPanel(on) {
  panel.classList.toggle('closed', !on);
  document.body.classList.toggle('panel-open', on);
  document.body.classList.toggle('closed-sheet', !on);
}
$('collapse').onclick = () => openPanel(panel.classList.contains('closed'));
$('grab').onclick = () => {
  if (panel.classList.contains('closed')) return openPanel(true);
  if (!panel.classList.contains('tall')) panel.classList.add('tall'); else { panel.classList.remove('tall'); openPanel(false); }
};
function setBusy(on) { panel.classList.toggle('busy', on); }

// home: the popular places
function goHome(open) {
  stopRun();
  S.place = null; S.selRoad = null;
  clearResult();
  if (centerMarker) { centerMarker.remove(); centerMarker = null; }
  drawArea();
  q.value = '';
  $('clearQ').hidden = true;
  renderChips();
  renderHome();
  if (open) openPanel(true);
  setURL();
  fitHot(true);
}
// the whole world's hotspots in view, beside the panel
function fitHot(animate) {
  if (!S.hot.length) return;
  const lons = S.hot.map(h => h.lon), lats = S.hot.map(h => h.lat);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: innerWidth > 720 ? { left: 408 + 60, right: 60, top: 90, bottom: 60 } : { top: 120, bottom: innerHeight * 0.62 + 20, left: 30, right: 30 }, maxZoom: 4, duration: animate ? 900 : 0 });
}
function hotScore(h) { return h.best ? h.best.imp + Math.max(0, h.best.odImp) * 0.05 : -1; }
function renderHome() {
  pscroll.classList.remove('flush');
  const list = S.hot.slice();
  if (S.sort === 'popular') list.sort((a, b) => b.poi - a.poi);
  else if (S.sort === 'strong') list.sort((a, b) => hotScore(b) - hotScore(a));
  else list.sort((a, b) => a.city.localeCompare(b.city));
  pscroll.innerHTML = `
    <div class="home-head">
      <h1>Popular places with Braess roads</h1>
      <p>We simulated the weekday rush hours in ${fmt(S.hotTotal || list.length)} busy city centres around the world. In these ${list.length}, closing a road made traffic faster. The busiest come first: ranked by how many shops, offices, schools and restaurants OpenStreetMap has within ${fmt((S.hotRadius || 1200) / 1000, 1)} km.</p>
      <div class="sortrow">
        <button class="pill${S.sort === 'popular' ? ' on' : ''}" data-sort="popular">Most popular</button>
        <button class="pill${S.sort === 'strong' ? ' on' : ''}" data-sort="strong">Strongest paradox</button>
        <button class="pill${S.sort === 'az' ? ' on' : ''}" data-sort="az">A to Z</button>
      </div>
    </div>` +
    (list.length ? list.map((h, i) => {
      const b = h.best;
      return `<div class="res" data-hot="${esc(h.id)}" role="button" tabindex="0">
        <div class="res-body">
          <div class="res-title"><span class="rk">${i + 1}.</span> ${esc(h.name)}</div>
          <div class="res-line">${esc(h.city)}, ${esc(h.country)} · ${fmt(h.poi)} places nearby</div>
          <div class="res-status">${h.roads} Braess road${h.roads === 1 ? '' : 's'} <span>· ${esc(h.when || '')}</span></div>
          ${b ? `<div class="res-quote">${svg(I.block)}<span>Closing ${esc(b.name)}: ${b.imp > 0 ? `total travel time <b class="good">−${pct(b.imp)}</b>` : `some trips <b class="good">${pct(b.odImp, 1)} faster</b>`}</span></div>` : ''}
        </div>
        <div class="res-thumb"><div class="tiles">${tilesHTML(h.lat, h.lon, 15, 84, 84)}</div><span class="dot"></span></div>
      </div>`;
    }).join('') : '<div class="note">The popular places have not loaded. Search for any city to simulate it.</div>') +
    `<div class="home-foot">Or search any place on Earth, or click the map, to simulate its traffic. The roads, speed limits and lanes come from OpenStreetMap; how many people travel is a model built from where they live and work, not live sensor data.</div>`;
}
pscroll.addEventListener('click', e => {
  const sort = e.target.closest('[data-sort]');
  if (sort) { S.sort = sort.dataset.sort; return renderHome(); }
  const hot = e.target.closest('[data-hot]');
  if (hot) { const h = S.hot.find(x => x.id === hot.dataset.hot); if (h) openHot(h); return; }
});
pscroll.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-hot]')) e.target.click(); });

/* -------------------------------- places ------------------------------ */
function openHot(h) {
  S.hour = h.best ? h.best.hour : 17.5; S.prof = 'wd'; S.mult = h.mult || 1.3; S.radius = h.radius;
  openPlace({ lat: h.lat, lng: h.lon, title: h.name, sub: h.city + ', ' + h.country, kind: 'City centre', hot: h }, { run: true, keepTime: true });
}
async function openPoint(lat, lng, keepTime, run) {
  openPlace({ lat, lng, title: 'Dropped pin', sub: lat.toFixed(5) + ', ' + lng.toFixed(5), kind: '' }, { keepTime, run });
  nameOf(lat, lng);
}
async function nameOf(lat, lng) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({ lat: lat.toFixed(6), lon: lng.toFixed(6), format: 'jsonv2', zoom: '16' }), { headers: { 'Accept-Language': 'en' } });
    const j = await r.json();
    if (!S.place || S.place.lat !== lat || S.place.lng !== lng || !j || !j.address) return;
    const a = j.address;
    S.place.title = a.road || a.pedestrian || a.neighbourhood || a.suburb || j.name || 'Dropped pin';
    S.place.sub = [a.suburb || a.neighbourhood, a.city || a.town || a.village, a.country].filter(Boolean).filter(x => x !== S.place.title).join(', ');
    renderPlace();
  } catch {}
}
function openPlace(p, o) {
  o = o || {};
  stopRun();
  S.place = p; S.selRoad = null; S.tab = 'overview';
  if (!o.keepTime) { S.hour = Math.round(localNow(p.lng) * 4) / 4; S.prof = dayTypeAt(p.lng); if (!p.hot) S.radius = clamp(store.get('radius', 1200), 400, 4000); }
  clearResult();
  setCenterMarker(p);
  drawArea();
  const z = zoomForRadius(S.radius, p.lat, viewPx());
  map.flyTo({ center: [p.lng, p.lat], zoom: z, duration: 1100, padding: padding() });
  renderChips(); renderPlace(); openPanel(true);
  setURL();
  if (o.run) simulate();
}
// the size of the map you can see beside the panel (or above the sheet)
function viewPx() { return innerWidth > 720 ? Math.min(innerWidth - 408, innerHeight) : Math.min(innerWidth, innerHeight * 0.38 - 60); }
function padding() { return innerWidth > 720 ? { left: document.body.classList.contains('panel-open') || true ? 408 : 0, top: 60, right: 40, bottom: 40 } : { top: 110, bottom: innerHeight * 0.62, left: 10, right: 10 }; }
map.on('click', e => {
  if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest && e.originalEvent.target.closest('.maplibregl-marker')) return;
  const r = 6, f = map.getLayer('hit') ? map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['braess', 'hit'] }) : [];
  if (f.length && S.net) { const si = f[0].properties.si; return showRoad(si); }
  if (S.running) return toast('The simulation is running. Wait for it to finish, then pick another spot.');
  openPoint(e.lngLat.lat, e.lngLat.lng, !!S.place);
});
// right click: the point's coordinates (click to copy) and Simulate here, as the map apps' own menus have
const ctx = document.createElement('div');
ctx.className = 'ctx'; ctx.hidden = true; ctx.setAttribute('role', 'menu');
document.body.appendChild(ctx);
map.on('contextmenu', e => {
  const { lat, lng } = e.lngLat;
  ctx.innerHTML = `<button class="ctx-i ctx-c" data-x="copy">${lat.toFixed(5)}, ${lng.toFixed(5)}</button><button class="ctx-i ctx-s" data-x="sim">Simulate here</button><button class="ctx-i" data-x="pin">Drop a pin here</button>`;
  const x = Math.min(e.point.x, innerWidth - 220), y = Math.min(e.point.y, innerHeight - 140);
  ctx.style.left = x + 'px'; ctx.style.top = y + 'px'; ctx.hidden = false;
  ctx.onclick = ev => {
    const k = ev.target.closest('[data-x]');
    if (!k) return;
    ctx.hidden = true;
    if (k.dataset.x === 'copy') navigator.clipboard.writeText(lat.toFixed(5) + ', ' + lng.toFixed(5)).then(() => toast('Coordinates copied.'), () => {});
    if (k.dataset.x === 'sim' || k.dataset.x === 'pin') openPoint(lat, lng, !!S.place, k.dataset.x === 'sim');
  };
});
for (const ev of ['movestart', 'click']) map.on(ev, () => { ctx.hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { ctx.hidden = true; $('lmenu').hidden = true; if ($('drawer').classList.contains('on')) drawer(false); } });
map.on('mousemove', e => {
  if (!map.getLayer('hit') || !S.net) return;
  const r = 5, f = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['hit'] });
  map.getCanvas().style.cursor = f.length ? 'pointer' : '';
});

function renderPlace() {
  const p = S.place;
  if (!p) return renderHome();
  pscroll.classList.add('flush');
  const res = S.res, nb = res ? res.braessRoads.length : 0;
  const ringPx = 2 * S.radius / (40075016 * Math.cos(p.lat * D2R) / (256 * 2 ** 15));
  const status = S.running ? '<span class="wait">Simulating…</span>'
    : res ? (nb ? `<span class="ok">${nb} Braess road${nb > 1 ? 's' : ''}</span> · ${hhmm(S.hour)} ${S.prof === 'wd' ? 'weekday' : 'weekend'}`
      : `<span class="no">No Braess roads</span> · ${hhmm(S.hour)} ${S.prof === 'wd' ? 'weekday' : 'weekend'}`)
    : '<span class="wait">Not simulated yet</span>';
  pscroll.innerHTML = `
    <div class="hero"><div class="tiles">${tilesHTML(p.lat, p.lng, 15, 420, 240)}</div>
      <div class="hero-ring" style="width:${ringPx.toFixed(0)}px;height:${ringPx.toFixed(0)}px"></div>
      <div class="hero-pin">${PIN_SVG}</div>
      <button class="ib hero-back" data-a="home" aria-label="Back to popular places">${svg(I.back)}</button></div>
    <div class="ptitle"><h1>${esc(p.title)}</h1>
      <div class="kind">${esc([p.kind && p.kind[0].toUpperCase() + p.kind.slice(1), p.sub].filter(Boolean).join(' · '))}</div>
      <div class="status">${status}</div></div>
    <div class="actions">
      <button class="act primary" data-a="run"${S.running ? ' disabled' : ''}><span>${svg(I.play)}</span>${res ? 'Run again' : 'Simulate'}</button>
      <button class="act" data-a="rush"><span>${svg(I.car)}</span>Rush hour</button>
      <button class="act" data-a="fit"><span>${svg(I.focus)}</span>Zoom in</button>
      <button class="act" data-a="share"><span>${svg(I.share)}</span>Share</button>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="overview" aria-selected="${S.tab === 'overview'}">Overview</button>
      <button class="tab" role="tab" data-tab="roads" aria-selected="${S.tab === 'roads'}">Braess roads${res ? `<span class="n">(${nb})</span>` : ''}</button>
      <button class="tab" role="tab" data-tab="about" aria-selected="${S.tab === 'about'}">About</button>
    </div>
    <div id="tabBody"></div>`;
  renderTab();
}
function renderTab() {
  const box = $('tabBody');
  if (!box) return;
  if (S.tab === 'overview') box.innerHTML = overviewHTML();
  else if (S.tab === 'roads') box.innerHTML = roadsHTML();
  else box.innerHTML = aboutHTML();
  if (S.tab === 'overview') drawTimes();
}
function settingsHTML() {
  const off = offsetOf(S.place.lng);
  return `<div class="rows">
    <div class="row">${svg(I.clock)}<div class="row-body">
      <div class="row-main">${hhmm(S.hour)} local time <button class="link" data-a="now">Now</button></div>
      <div class="row-sub">Clock estimated from longitude (UTC${off >= 0 ? '+' : ''}${off}) · demand at ${Math.round(E.demandFactor(S.hour, S.prof) * 100)}% of the daily peak</div>
      <input class="slider" type="range" min="0" max="23.75" step="0.25" value="${S.hour}" data-k="hour" aria-label="Time of day">
      <div class="seg"><button data-prof="wd" aria-pressed="${S.prof === 'wd'}">Weekday</button><button data-prof="we" aria-pressed="${S.prof === 'we'}">Weekend</button></div>
    </div></div>
    <div class="row">${svg(I.radius)}<div class="row-body">
      <div class="row-main">${fmt(S.radius / 1000, 1)} km around the pin</div>
      <div class="row-sub">A bigger area takes longer to download and simulate</div>
      <input class="slider" type="range" min="400" max="4000" step="100" value="${S.radius}" data-k="radius" aria-label="Radius">
    </div></div>
    <div class="row">${svg(I.people)}<div class="row-body">
      <div class="row-main">Traffic demand ×${S.mult.toFixed(1)}</div>
      <div class="row-sub">How many more people drive than the model's usual day</div>
      <input class="slider" type="range" min="0.5" max="2.5" step="0.1" value="${S.mult}" data-k="mult" aria-label="Traffic demand">
    </div></div>
  </div>`;
}
function overviewHTML() {
  const res = S.res;
  let h = '';
  if (S.running || S.err) h += `<div class="prog"><div class="prog-t" id="progT">${esc(S.err || S.progText || 'Starting')}</div>${S.err ? '' : `<div class="prog-track"><div class="prog-fill" id="progF" style="width:${(S.progF || 0) * 100}%"></div></div><div class="prog-sub" id="progS">${esc(S.progSub || '')}</div>`}</div>`;
  const hot = S.place.hot;
  if (hot && !res) {
    // (what the world scan found here, until this run has its own answer)
    const at = (hot.rush || []).filter(r => r.roads.length);
    h += `<div class="section"><h2>Found in the world scan</h2><div class="hint">${at.map(r => `At ${hhmm(r.hour)}: ${r.roads.length} Braess road${r.roads.length > 1 ? 's' : ''}, the strongest ${esc(r.roads[0].name)}${r.roads[0].imp > 0 ? ` (total travel time −${pct(r.roads[0].imp)} if closed)` : ''}.`).join(' ')}</div></div>`;
  }
  if (hot && hot.note) h += `<div class="section"><h2>A real Braess story</h2><div class="hint">${esc(hot.note)}</div></div>`;
  if (res) {
    const top = res.braessRoads[0];
    h += `<div class="section"><h2>What the simulation found</h2>` + (top
      ? `<div class="hint">At ${hhmm(S.hour)} on a ${S.prof === 'wd' ? 'weekday' : 'weekend'}, ${res.braessRoads.length === 1 ? 'one road makes' : res.braessRoads.length + ' roads make'} traffic slower by being open. Closing <b>${esc(top.name)}</b> ${top.best.imp > 0 ? `would cut total travel time by <b class="good">${pct(top.best.imp)}</b>` : `would leave the area as a whole no slower and make some trips <b class="good">${pct(top.best.odImp, 1)} faster</b>`}.</div>`
        + (res.combined && res.braessRoads.length > 1 ? `<div class="kv"><span>Closing all of them together</span><b class="good">−${pct(res.combined.imp)} travel time</b></div>` : '')
        + `<button class="pill" style="margin-top:10px" data-tab="roads">See the roads</button>`
      : `<div class="hint">No road here makes traffic faster by being closed at ${hhmm(S.hour)}. The paradox needs a particular mix of congestion and route choices: try the morning or evening rush, more demand, or another area.${res.nearMiss ? ` The closest was ${esc(S.net.segs[res.nearMiss.si].name)} (${res.nearMiss.imp >= 0 ? '−' : '+'}${pct(Math.abs(res.nearMiss.imp), 3)} if closed).` : ''}</div>`) + `</div>`;
  }
  h += `<div class="section"><h2>Traffic by hour <select data-k="profSel" aria-label="Day"><option value="wd"${S.prof === 'wd' ? ' selected' : ''}>Weekdays</option><option value="we"${S.prof === 'we' ? ' selected' : ''}>Weekends</option></select></h2>
    <div class="times"><div class="times-live" id="timesLive"></div><div class="bars" id="bars"></div><div class="bar-lbl">${[6, 9, 12, 15, 18, 21].map(h => `<span style="left:${((h - 6 + 0.5) / 18 * 100).toFixed(2)}%">${ampm(h)}</span>`).join('')}</div>
    <div class="times-key"><span><i></i>Extra travel time from congestion</span>${S.place && S.place.hot ? '<span><i class="px"></i>Braess roads found</span>' : ''}</div></div></div>`;
  h += settingsHTML();
  if (res) {
    const net = S.net;
    h += `<div class="section"><h2>The network at ${hhmm(S.hour)}</h2>
      <div class="kv"><span>Average speed</span><b>${fmt(res.avgSpeed, 1)} km/h</b></div>
      <div class="kv"><span>Total travel time</span><b>${fmt(res.baseT, 1)} vehicle-hours each hour</b></div>
      <div class="kv"><span>Trips</span><b>${fmt(res.totDemand)} vehicles an hour</b></div>` +
      (res.waste != null ? `<div class="kv"><span>Time lost to selfish route choice</span><b>${pct(res.waste, 1)}</b></div>` : '') + `
      <div class="kv"><span>Junctions and road pieces</span><b>${fmt(net.n)} · ${fmt(net.segs.filter(s => s.active).length)}</b></div>
      <div class="kv"><span>Closures tested</span><b>${fmt(res.tested)} of ${fmt(res.candidates)} busy roads, ${res.scanLog.length} checked closely</b></div>
      <div class="kv"><span>Equilibrium gap</span><b>${(res.gap * 100).toFixed(4)}%</b></div>
      <div class="kv"><span>Computed in</span><b>${fmt(S.secs, 1)} s on ${S.threads} thread${S.threads > 1 ? 's' : ''}</b></div></div>`;
  }
  return h;
}
function roadsHTML() {
  const res = S.res;
  if (!res) return `<div class="note">${S.running ? 'The roads appear here as soon as the closures have been tested.' : 'Press Simulate to test which roads make traffic slower by being open.'}</div>`;
  if (!res.braessRoads.length) return `<div class="note">No Braess roads at ${hhmm(S.hour)}. Every road tested makes traffic at least as fast by being open.</div>`;
  return res.braessRoads.map((g, i) => {
    const b = g.best, s = S.net.segs[b.si];
    const parts = [];
    if (b.kind === 'tstt') parts.push(`total travel time <b class="good">−${pct(b.imp)}</b> (${fmt(b.saved, 1)} vehicle-hours saved each hour)`);
    else parts.push(`the area as a whole no slower (${b.imp >= 0 ? '−' : '+'}${pct(Math.abs(b.imp), 3)})`);
    if (b.odImp >= 0.015) parts.push(`${tripsWord(b)} <b class="good">${pct(b.odImp, 1)} faster</b>`);
    return `<div class="broad${S.selRoad === b.si ? ' sel' : ''}" data-road="${b.si}" role="button" tabindex="0"><span class="bpin"><b>${i + 1}</b></span><div>
      <div class="broad-name">${esc(g.name)}</div>
      <div class="broad-line">${esc(HW_NAME[s.hw] || s.hw)}${g.sis.length > 1 ? ` · ${g.sis.length} pieces` : ''}</div>
      <div class="broad-line">If closed: ${parts.join(', ')}</div></div></div>`;
  }).join('') + `<div class="note">A road counts when closing it cuts the total travel time of everyone in the area, or makes some trips at least 1.5% faster without slowing the area down. Every one listed here was checked with a precise solve.</div>`;
}
function aboutHTML() {
  return `<div class="about">
    <h3>Braess's paradox</h3>
    <p>In 1968 Dietrich Braess showed that adding a road to a network can make every driver's trip slower, because each driver picks the route that is fastest for them alone. The reverse also holds: closing the right road can make traffic faster for everyone.</p>
    <h3>How this simulation works</h3>
    <ul>
      <li>The roads, lanes, speed limits and one-way streets come live from OpenStreetMap.</li>
      <li>Trips start and end where people live and work: homes from the density of residential streets, jobs and errands from the shops, offices, schools and hospitals mapped there, on a grid tied to the ground. Their number follows weekday or weekend hourly patterns, towards work in the morning and home in the evening, with through traffic where main roads cross the edge.</li>
      <li>Drivers settle into a user equilibrium (Wardrop's: nobody can switch to a faster route), solved by conjugate Frank-Wolfe with BPR road delays.</li>
      <li>Every busy road is then closed in turn and the equilibrium solved again. The few that look like they help are solved again precisely, and any close call a third time even more precisely.</li>
    </ul>
    <h3>Speed and accuracy</h3>
    <p>The closures are independent, so they run on every core of your computer at once. The number tested depends only on the size of the network, never on how fast your computer is, so a slow computer finds the same roads as a fast one. On downtown San Francisco and central Paris, the roads this flags matched exactly the ones found by solving every candidate to a relative gap of one in a million.</p>
    <h3>What it cannot tell you</h3>
    <ul>
      <li>How many people drive is a model grounded in land use, not a live traffic feed: no free worldwide feed of real trips exists.</li>
      <li>Traffic lights and turn bans are not modelled, and the clock is estimated from longitude.</li>
      <li>It shows the theory working on real streets. It is a teaching tool, not an engineering study.</li>
    </ul>
    <h3>Data</h3>
    <p>Roads and land use © OpenStreetMap contributors, through the Overpass API. Base map: OpenFreeMap, OpenMapTiles. Satellite pictures: Esri. Place search: Photon and Nominatim.</p>
  </div>`;
}
pscroll.addEventListener('click', e => {
  const a = e.target.closest('[data-a]');
  const t = e.target.closest('[data-tab]');
  const pr = e.target.closest('[data-prof]');
  const rd = e.target.closest('[data-road]');
  const bar = e.target.closest('.bar');
  if (a) {
    const k = a.dataset.a;
    if (k === 'home') return goHome(true);
    if (k === 'run') return simulate();
    if (k === 'rush') { S.hour = S.hour < 13 ? 8 : 17.5; S.prof = 'wd'; renderChips(); renderPlace(); return simulate(); }
    if (k === 'fit') return fitArea();
    if (k === 'share') return share();
    if (k === 'now') { S.hour = Math.round(localNow(S.place.lng) * 4) / 4; S.prof = dayTypeAt(S.place.lng); renderChips(); renderPlace(); return simulate(); }
  }
  if (t && S.place) { S.tab = t.dataset.tab; return renderPlace(); }
  if (pr) { S.prof = pr.dataset.prof; renderChips(); renderPlace(); return simulate(); }
  if (rd) return showRoad(+rd.dataset.road, true);
  if (bar && bar.dataset.h) { S.hour = +bar.dataset.h; renderChips(); renderPlace(); return simulate(); }
});
pscroll.addEventListener('input', e => {
  const k = e.target.dataset.k;
  if (!k || !S.place) return;
  const v = +e.target.value;
  const main = e.target.closest('.row-body').querySelector('.row-main');
  if (k === 'hour') main.firstChild.textContent = hhmm(v) + ' local time ';
  if (k === 'radius') { main.textContent = fmt(v / 1000, 1) + ' km around the pin'; S.radius = v; drawArea(); }
  if (k === 'mult') main.textContent = 'Traffic demand ×' + v.toFixed(1);
});
pscroll.addEventListener('change', e => {
  const k = e.target.dataset.k;
  if (!k || !S.place) return;
  if (k === 'profSel') { S.prof = e.target.value; renderChips(); renderPlace(); return simulate(); }
  const v = +e.target.value;
  if (k === 'hour') S.hour = v;
  if (k === 'radius') { S.radius = v; store.set('radius', v); }
  if (k === 'mult') S.mult = v;
  renderChips(); renderPlace(); simulate();
});
function fitArea() {
  if (!S.place) return;
  const p = S.place;
  map.flyTo({ center: [p.lng, p.lat], zoom: zoomForRadius(S.radius, p.lat, viewPx()) + 0.3, padding: padding(), duration: 700 });
}
// "trips from the north to the south-west", or "trips within the south-west" when both ends are on one side
function tripsWord(b, cap) {
  const a = compass(b.odFrom), z = compass(b.odTo);
  const t = a === z ? `trips within the ${a}` : `trips from the ${a} to the ${z}`;
  return cap ? t[0].toUpperCase() + t.slice(1) : t;
}
function compass(node) {
  const net = S.net, dy = net.lat[node] - net.cLat, dx = (net.lon[node] - net.cLon) * Math.cos(net.cLat * D2R);
  return ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][Math.round(((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360) / 45) % 8];
}

/* ------------------------------ map data ------------------------------ */
const OVERPASS = params.get('overpass') ? [params.get('overpass')] : [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
/* One query to the first server; if it has not answered in 8 s another is
   asked as well (and so on), and the first good answer wins. */
function overpass(query, signal) {
  return new Promise((resolve, reject) => {
    let i = 0, fails = 0, done = false;
    const ctls = [];
    const finish = (ok, v) => { if (done) return; done = true; clearTimeout(timer); for (const c of ctls) c.abort(); ok ? resolve(v) : reject(v); };
    const one = () => {
      if (done || i >= OVERPASS.length) return;
      const ep = OVERPASS[i++], c = new AbortController();
      ctls.push(c);
      fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: c.signal })
        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(j => { if (j.remark && /error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark); finish(true, j); })
        .catch(e => { if (done || e.name === 'AbortError') return; if (++fails >= OVERPASS.length) finish(false, new Error('Every OpenStreetMap server refused or timed out. Try again in a minute.')); else { clearTimeout(timer); one(); arm(); } });
    };
    let timer = 0;
    const arm = () => { clearTimeout(timer); if (i < OVERPASS.length) timer = setTimeout(() => { one(); arm(); }, 8000); };
    if (signal) signal.addEventListener('abort', () => finish(false, new Error('cancelled')));
    one(); arm();
  });
}
// answers kept in this browser for two weeks, so a place visited again opens at once
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('braess', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('osm');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => { const t = db.transaction('osm', mode), st = t.objectStore('osm'); const q = fn(st); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }));
  return {
    async get(k) { try { const v = await tx('readonly', st => st.get(k)); return v && Date.now() - v.t < 14 * 864e5 ? v.d : null; } catch { return null; } },
    async put(k, d) { try { await tx('readwrite', st => st.put({ t: Date.now(), d }, k)); } catch {} },
  };
})();
async function cachedQuery(query, signal) {
  const hit = await idb.get(query);
  if (hit) return hit;
  const j = await overpass(query, signal);
  idb.put(query, j);
  return j;
}
async function getData(p, radius, signal) {
  const h = p.hot;
  if (h && radius === h.radius) {
    const r = await fetch('data/' + h.id + '.json' + V, { signal });
    if (r.ok) { const j = E.unpackData(await r.json()); return { roads: j.roads, acts: j.acts, bundled: true }; }
  }
  const center = { lat: p.lat, lng: p.lng };
  const [roads, act] = await Promise.all([
    cachedQuery(E.roadsQuery(center, radius), signal),
    cachedQuery(E.activityQuery(center, radius), signal).catch(() => null),
  ]);
  return { roads, acts: act ? E.parseActivity(act) : null };
}

/* ----------------------------- simulation ----------------------------- */
let runCtl = null;
function stopRun() {
  if (runCtl) runCtl.abort();
  runCtl = null;
  if (S.pool) { S.pool.close(); S.pool = null; }
  S.running = false; S.run++;
  setBusy(false); stopSweep();
}
function clearResult() {
  S.res = null; S.resKey = ''; S.busy = null; S.err = ''; S.selRoad = null;
  for (const m of braessMarkers) m.remove();
  braessMarkers = [];
  $('card').hidden = true;
  stopCars();
  ready.then(() => { for (const id of ['net', 'braess', 'sel', 'sweep']) map.getSource(id).setData(emptyFC()); });
  updateLegend();
}
function progress(f, text, sub) {
  S.progF = f; S.progText = text; S.progSub = sub || '';
  const a = $('progF'), b = $('progT'), c = $('progS');
  if (a) a.style.width = (f * 100).toFixed(1) + '%';
  if (b) b.textContent = text;
  if (c) c.textContent = S.progSub;
}
async function workersFor(net, demand) {
  const n = clamp((navigator.hardwareConcurrency || 4) - 1, 1, 8);
  const ws = [];
  try {
    for (let i = 0; i < n; i++) {
      const w = new Worker('engine.js' + V);
      ws.push({ n: i, w, post: m => w.postMessage(m), listen: fn => w.addEventListener('message', e => fn(e.data)), end: () => w.terminate() });
    }
    const pool = E.makePool(ws, net, demand);
    const failed = new Promise((_, rej) => { for (const x of ws) x.w.addEventListener('error', () => rej(new Error('worker'))); setTimeout(() => rej(new Error('slow')), 6000); });
    await Promise.race([pool.ready, failed]);
    return pool;
  } catch {
    for (const x of ws) x.w.terminate();
    return E.localPool(net, demand);   // (workers are not allowed here, e.g. opened from a file)
  }
}
async function simulate() {
  const p = S.place;
  if (!p) return;
  stopRun();
  const run = ++S.run, ctl = runCtl = new AbortController();
  clearResult();
  S.running = true; S.err = '';
  setBusy(true); renderPlace();
  const t0 = performance.now();
  const alive = () => run === S.run;
  try {
    const key = p.lat.toFixed(5) + ',' + p.lng.toFixed(5) + ',' + S.radius;
    let net = S.netKey === key ? S.net : null;
    if (!net) {
      progress(0.02, p.hot && S.radius === p.hot.radius ? 'Loading the streets' : 'Downloading the streets and land use from OpenStreetMap', 'Roads and places people go, at the same time');
      const data = await getData(p, S.radius, ctl.signal);
      if (!alive()) return;
      progress(0.06, 'Building the road network');
      await frame();
      net = E.buildNetwork(data.roads);
      E.buildDemandModel(net, { lat: p.lat, lng: p.lng }, S.radius, data.acts);
      S.net = net; S.netKey = key;
    }
    drawNetwork(net, null);
    E.buildOD(net, S.hour, S.prof);
    const factor = Math.max(E.demandFactor(S.hour, S.prof), 0.03), demand = 0.9 * factor * S.mult / net.unitRefVC;
    progress(0.08, 'Starting ' + ((navigator.hardwareConcurrency || 4) - 1) + ' workers');
    const pool = S.pool = await workersFor(net, demand);
    if (!alive()) { pool.close(); return; }
    S.threads = pool.size;
    if (S.opt.sweep) startSweep(net);
    const res = await E.analyze(net, demand, pool, (f, text) => {
      if (!alive()) return;
      const m = /\((\d+) of (\d+)\)/.exec(text) || /(\d+) of (\d+)/.exec(text);
      progress(0.1 + 0.88 * f, text.replace(/\s*\(.*\)$/, ''), m ? `${m[1]} of ${m[2]} done on ${pool.size} thread${pool.size > 1 ? 's' : ''}` : '');
    }, {
      onBase: b => { if (!alive()) return; stopSweep(); drawNetwork(net, b.segStats); startCars(net, b.flows, b.cost); updateLegend(true); },
    });
    if (!alive()) return;
    S.secs = (performance.now() - t0) / 1000;
    S.res = res; S.resKey = key + ',' + S.hour + ',' + S.prof + ',' + S.mult;
    drawNetwork(net, res.segStats);
    startCars(net, res.flows, res.cost);
    drawBraess(net, res);
    S.running = false; setBusy(false);
    renderPlace(); renderChips(); updateLegend(true);
    setURL();
    // the hourly chart: the same network, each hour's demand
    busyTimes(net, pool, run).catch(() => {}).finally(() => { if (S.pool === pool) { pool.close(); S.pool = null; } });
  } catch (e) {
    if (!alive() || e.message === 'cancelled') return;
    console.error(e);
    S.running = false; setBusy(false);
    S.err = e.message || String(e);
    renderPlace();
    if (S.pool) { S.pool.close(); S.pool = null; }
  }
}
async function busyTimes(net, pool, run) {
  const hours = [];
  for (let h = 6; h <= 23; h++) hours.push(h);
  const keep = { od: net.odOrigins, numOD: net.numOD, ref: net.unitRefVC };
  const jobs = hours.map(h => {
    E.buildOD(net, h, S.prof);
    const demand = 0.9 * Math.max(E.demandFactor(h, S.prof), 0.03) * S.mult / net.unitRefVC;
    return { kind: 'busy', od: net.odOrigins, demand, maxIter: 120, tol: 1e-3 };
  });
  net.odOrigins = keep.od; net.numOD = keep.numOD; net.unitRefVC = keep.ref;
  const out = await pool.run(jobs);
  if (run !== S.run) return;
  S.busy = { prof: S.prof, hours, d: out.map(r => r && r.ok ? r.t / r.t0 - 1 : 0) };
  if (S.tab === 'overview') drawTimes();
}
function drawTimes() {
  const bars = $('bars'), live = $('timesLive');
  if (!bars) return;
  const hot = S.place && S.place.hot, hotHours = new Set(hot ? (hot.found || []).map(f => Math.floor(f.hour)) : []);
  const b = S.busy && S.busy.prof === S.prof ? S.busy : null;
  const max = b ? Math.max(...b.d, 1e-6) : 1;
  const now = S.place ? Math.floor(localNow(S.place.lng)) : -1;
  let html = '';
  for (let h = 6; h <= 23; h++) {
    const v = b ? b.d[h - 6] : 0;
    const ht = b ? Math.max(4, 100 * v / max) : 8 + 30 * E.demandFactor(h, S.prof);
    html += `<div class="bar${b ? '' : ' empty'}${Math.floor(S.hour) === h ? ' sel' : ''}${h === now && S.prof === dayTypeAt(S.place.lng) ? ' now' : ''}" data-h="${h}" style="height:${ht.toFixed(0)}%" title="${ampm(h)}${b ? ': trips take ' + Math.round(v * 100) + '% longer than on empty roads' : ''}">${hotHours.has(h) ? '<span class="px"></span>' : ''}</div>`;
  }
  bars.innerHTML = html;
  if (live) {
    const sel = Math.floor(S.hour);
    if (b && sel >= 6) live.innerHTML = `<b>${ampm(sel)}:</b> trips take ${Math.round(b.d[sel - 6] * 100)}% longer than on empty roads${sel === now ? ' <span class="lv">NOW</span>' : ''}`;
    else live.textContent = S.running ? 'Working out each hour…' : 'Simulate to see how busy each hour gets. Click a bar to simulate that hour.';
  }
}

/* ------------------------------ drawing ------------------------------- */
let netFeatures = null, netFor = null;
function drawNetwork(net, stats) {
  if (netFor !== net) {
    netFor = net;
    netFeatures = net.segs.map((s, si) => ({ type: 'Feature', properties: { si, w: s.w, a: s.active ? 1 : 0, r: 0, vc: 0, fl: 0 }, geometry: { type: 'LineString', coordinates: s.pts.map(p => [p[1], p[0]]) } }));
  }
  for (const f of netFeatures) {
    const st = stats && stats[f.properties.si];
    f.properties.r = st ? 1 : 0;
    f.properties.vc = st ? Math.round(st.vc * 100) / 100 : 0;
    f.properties.fl = st ? Math.round(st.flow) : 0;
  }
  ready.then(() => map.getSource('net').setData({ type: 'FeatureCollection', features: netFeatures }));
}
function drawBraess(net, res) {
  const feats = [];
  res.braessRoads.forEach((g, i) => { for (const si of g.sis) feats.push({ type: 'Feature', properties: { si, rank: i + 1, w: net.segs[si].w }, geometry: { type: 'LineString', coordinates: net.segs[si].pts.map(p => [p[1], p[0]]) } }); });
  ready.then(() => map.getSource('braess').setData({ type: 'FeatureCollection', features: feats }));
  for (const m of braessMarkers) m.remove();
  braessMarkers = res.braessRoads.map((g, i) => {
    const s = net.segs[g.best.si], mid = s.pts[Math.floor(s.pts.length / 2)];
    const el = document.createElement('button');
    el.className = 'mpin'; el.type = 'button'; el.title = g.name;
    el.innerHTML = `<span class="bpin"><b>${i + 1}</b></span>`;
    el.addEventListener('click', e => { e.stopPropagation(); showRoad(g.best.si, false); });
    return new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -2] }).setLngLat([mid[1], mid[0]]).addTo(map);
  });
}
function braessOf(si) {
  if (!S.res) return null;
  for (const g of S.res.braessRoads) if (g.sis.includes(si)) return S.res.braess.find(b => b.si === si) || g.best;
  return null;
}
function showRoad(si, fly) {
  const net = S.net, s = net && net.segs[si];
  if (!s) return;
  S.selRoad = si;
  const st = S.res ? S.res.segStats[si] : null, br = braessOf(si);
  ready.then(() => map.getSource('sel').setData({ type: 'Feature', properties: { w: s.w }, geometry: { type: 'LineString', coordinates: s.pts.map(p => [p[1], p[0]]) } }));
  const kmh = st ? (s.lenM / 1000) / Math.max(st.tMax, 1e-9) : s.speed;
  let h = `<button class="ib card-x" aria-label="Close">${svg(I.close)}</button>
    <div class="card-t">${esc(s.name)}</div>
    <div class="card-s">${esc(HW_NAME[s.hw] || s.hw)} · ${fmt(s.lenM)} m · limit ${fmt(s.speed)} km/h${s.oneway ? ' · one way' : ''}</div>`;
  if (st && s.active) h += `<div class="card-l"><span class="tchip" style="background:${vcColor(st.vc)}"></span><b>${vcWord(st.vc)}</b> · ${fmt(kmh)} km/h now · ${fmt(st.flow)} vehicles an hour, ${Math.round(st.vc * 100)}% of what it can carry</div>`;
  else if (!s.active) h += `<div class="card-l">Not part of the connected road network the traffic can use.</div>`;
  if (br) {
    h += `<div class="card-b"><b>Braess road.</b> ` + (br.kind === 'tstt'
      ? `Closing it cuts total travel time in the area by <b>${pct(br.imp)}</b> (${fmt(br.saved, 1)} vehicle-hours saved each hour).`
      : `Closing it leaves the area as a whole no slower.`) +
      (br.odImp >= 0.015 ? ` ${tripsWord(br, true)} get <b>${pct(br.odImp, 1)} faster</b>.` : '') + `</div>`;
  }
  const card = $('card');
  card.innerHTML = h; card.hidden = false;
  card.querySelector('.card-x').onclick = () => { card.hidden = true; S.selRoad = null; ready.then(() => map.getSource('sel').setData(emptyFC())); if (S.tab === 'roads') renderTab(); };
  if (fly) {
    const lons = s.pts.map(p => p[1]), lats = s.pts.map(p => p[0]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: Object.assign(padding(), { top: 120, bottom: 220 }), maxZoom: 16.5, duration: 700 });
  }
  if (S.tab === 'roads') renderTab();
  braessMarkers.forEach((m, i) => m.getElement().classList.toggle('sel', S.res && S.res.braessRoads[i] && S.res.braessRoads[i].sis.includes(si)));
}
function updateLegend(force) {
  $('legend').hidden = !(S.opt.traffic && (S.res || force) && S.place);
}

/* ------------------------- the route search sweep ---------------------- */
let sweepRAF = 0;
function startSweep(net) {
  stopSweep();
  const src = E.nearestNode(net, S.place.lat, S.place.lng);
  if (src < 0) return;
  // one Dijkstra from the pin at free-flow times, the order each street is first reached
  const dist = new Float64Array(net.n).fill(Infinity), done = new Uint8Array(net.n), seen = new Uint8Array(net.segs.length), order = [];
  const heap = new E.MinHeap(net.m + 8);
  dist[src] = 0; heap.push(0, src);
  while (heap.n) {
    const v = heap.pop();
    if (done[v]) continue;
    done[v] = 1;
    for (let i = net.adjStart[v]; i < net.adjStart[v + 1]; i++) {
      const e = net.adjEdge[i], si = net.eSeg[e];
      if (!seen[si]) { seen[si] = 1; order.push(si); }
      const u = net.eTo[e], nd = dist[v] + net.eT0[e];
      if (nd < dist[u]) { dist[u] = nd; heap.push(nd, u); }
    }
  }
  const feats = order.map((si, k) => ({ type: 'Feature', properties: { k, w: net.segs[si].w, c: `hsl(${(205 + 60 * k / order.length).toFixed(0)},85%,${(52 + 10 * k / order.length).toFixed(0)}%)` },
    geometry: { type: 'LineString', coordinates: net.segs[si].pts.map(p => [p[1], p[0]]) } }));
  ready.then(() => {
    map.getSource('sweep').setData({ type: 'FeatureCollection', features: feats });
    const total = order.length, dur = clamp(total * 3, 1800, 5000);
    let t0 = performance.now();
    const step = t => {
      const f = (t - t0) / dur;
      if (f > 1.25) t0 = t;
      map.setFilter('sweep', ['<', ['get', 'k'], Math.round(clamp(f, 0, 1) * total)]);
      sweepRAF = requestAnimationFrame(step);
    };
    sweepRAF = requestAnimationFrame(step);
  });
}
function stopSweep() {
  cancelAnimationFrame(sweepRAF); sweepRAF = 0;
  if (map.getLayer('sweep')) { map.setFilter('sweep', ['<', ['get', 'k'], 0]); map.getSource('sweep').setData(emptyFC()); }
}

/* ----------------------------- moving cars ----------------------------- */
const cv = $('cars'), cx = cv.getContext('2d');
let cars = [], carEdges = null, carCum = null, carTot = 0, carNet = null, carCost = null, carFlows = null;
function sizeCars() { const d = devicePixelRatio || 1; cv.width = innerWidth * d; cv.height = innerHeight * d; cx.setTransform(d, 0, 0, d, 0, 0); }
addEventListener('resize', sizeCars); sizeCars();
function startCars(net, flows, cost) {
  carNet = net; carCost = cost; carFlows = flows; cars = [];
  const ed = [], w = [];
  let tot = 0;
  for (let e = 0; e < net.m; e++) { const veh = flows[e] * cost[e]; if (veh > 1e-4) { ed.push(e); w.push(veh); tot += veh; } }
  if (!ed.length) return;
  carEdges = Int32Array.from(ed); carCum = new Float64Array(w.length);
  let acc = 0;
  for (let i = 0; i < w.length; i++) { acc += w[i]; carCum[i] = acc; }
  carTot = acc;
  const N = clamp(Math.round(tot * Math.min(1, innerWidth * innerHeight / (1440 * 900))), 60, 900);
  for (let i = 0; i < N; i++) cars.push(spawnCar());
}
function stopCars() { cars = []; carNet = null; }
function spawnCar() {
  const r = Math.random() * carTot;
  let lo = 0, hi = carCum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (carCum[mid] < r) lo = mid + 1; else hi = mid; }
  const e = carEdges[lo], s = carNet.segs[carNet.eSeg[e]];
  return { e, d: Math.random() * s.lenM, v: Math.max((carNet.eLen[e] / Math.max(carCost[e], 1e-9)) / 3.6, 0.4) };
}
function along(seg, d) {
  const { pts, cum } = seg;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const t = clamp((d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), 0, 1);
  return [pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t, pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t];
}
let lastT = 0;
function drawCars(t) {
  requestAnimationFrame(drawCars);
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  cx.clearRect(0, 0, innerWidth, innerHeight);
  if (!carNet || !cars.length || !S.opt.cars || !S.opt.traffic || map.isZooming()) return;
  const z = map.getZoom();
  if (z < 12.5) return;
  const small = innerWidth <= 720, rad = (z >= 16 ? 3 : z >= 14.5 ? 2.4 : 1.8) * (small ? 0.7 : 1);
  cx.beginPath();
  for (const c of cars) {
    c.d += c.v * dt * 14;
    const seg = carNet.segs[carNet.eSeg[c.e]];
    if (c.d >= seg.lenM) { Object.assign(c, spawnCar()); continue; }
    const ll = along(seg, carNet.eFwd[c.e] ? c.d : seg.lenM - c.d), pt = map.project(ll);
    if (pt.x < -5 || pt.y < -5 || pt.x > innerWidth + 5 || pt.y > innerHeight + 5) continue;
    cx.moveTo(pt.x + rad, pt.y); cx.arc(pt.x, pt.y, rad, 0, 6.2832);
  }
  cx.fillStyle = '#ffffff'; cx.fill();
  cx.lineWidth = 1.1; cx.strokeStyle = 'rgba(32,33,36,.85)'; cx.stroke();
}
requestAnimationFrame(t => { lastT = t; requestAnimationFrame(drawCars); });

/* ------------------------- controls, layers, drawer -------------------- */
$('zin').onclick = () => map.zoomIn();
$('zout').onclick = () => map.zoomOut();
$('locate').onclick = () => {
  if (!navigator.geolocation) return toast('This browser cannot share your location.');
  $('locate').classList.add('has');
  navigator.geolocation.getCurrentPosition(pos => openPoint(pos.coords.latitude, pos.coords.longitude, false), () => { $('locate').classList.remove('has'); toast('Your location is not available.'); }, { timeout: 10000 });
};
const DEFAULT_SWATCH = `<svg viewBox="0 0 56 56" width="56" height="56"><rect width="56" height="56" fill="#f3f3f1"/><path d="M-4 40 C 14 30, 30 44, 60 26" stroke="#9ccdf3" stroke-width="7" fill="none"/><rect x="34" y="4" width="16" height="14" fill="#c8e8c4"/><path d="M0 18 H56 M20 0 V56 M0 46 L56 8" stroke="#fff" stroke-width="3.5"/><path d="M0 18 H56" stroke="#fcd47a" stroke-width="2.5"/></svg>`;
function drawLayersThumb() {
  const c = map.getCenter();
  $('layersThumb').innerHTML = S.opt.sat ? `<div style="position:absolute;left:-36px;top:-36px">${DEFAULT_SWATCH.replace(/56"/g, '72"')}</div>` : tilesHTML(c.lat, c.lng, clamp(Math.round(map.getZoom()) + 1, 3, 17), 72, 72);
}
map.on('moveend', () => { if (!S.opt.sat) drawLayersThumb(); drawScale(); });
function renderLayersMenu() {
  const c = map.getCenter(), z = clamp(Math.round(map.getZoom()) + 1, 3, 17);
  const opt = (k, t) => `<button class="lopt${S.opt[k] ? ' on' : ''}" data-o="${k}">${t}<span class="switch"></span></button>`;
  $('lmenu').innerHTML = `<h3>Map type</h3><div class="ltypes">
    <button class="ltype${S.opt.sat ? '' : ' on'}" data-t="map"><span class="sw">${DEFAULT_SWATCH}</span>Default</button>
    <button class="ltype${S.opt.sat ? ' on' : ''}" data-t="sat"><span class="sw"><span class="tiles" style="position:absolute;left:50%;top:50%">${tilesHTML(c.lat, c.lng, z, 56, 56)}</span></span>Satellite</button></div>
    <h3>Map details</h3>${opt('traffic', 'Simulated traffic')}${opt('cars', 'Moving cars')}${opt('sweep', 'Show the route search')}`;
}
$('layersBtn').onclick = e => { e.stopPropagation(); const m = $('lmenu'); m.hidden = !m.hidden; if (!m.hidden) renderLayersMenu(); };
$('lmenu').addEventListener('click', e => {
  e.stopPropagation();
  const t = e.target.closest('[data-t]'), o = e.target.closest('[data-o]');
  if (t) setSat(t.dataset.t === 'sat');
  if (o) { const k = o.dataset.o; S.opt[k] = !S.opt[k]; store.set('opt', S.opt); if (k === 'traffic') showTraffic(S.opt.traffic); if (k === 'sweep' && !S.opt.sweep) stopSweep(); }
  renderLayersMenu();
});
document.addEventListener('click', e => { if (!$('lmenu').hidden && !$('lmenu').contains(e.target) && e.target !== $('layersBtn')) $('lmenu').hidden = true; });
function renderDrawer() {
  $('drawer').innerHTML = `<div class="drawer-head"><span class="brand"><b>Braess</b> simulator</span><button class="ib" data-d="close" aria-label="Close menu">${svg(I.close)}</button></div>
    <button class="dr-item" data-d="home">${svg(I.fire)}<span>Popular places</span></button>
    <button class="dr-item" data-d="about">${svg(I.info)}<span>How it works</span></button>
    <button class="dr-item" data-d="share">${svg(I.share)}<span>Share this view</span></button>
    <div class="dr-sep"></div>
    <button class="dr-item" data-d="sat">${svg(I.globe)}<span>${S.opt.sat ? 'Default map' : 'Satellite'}</span></button>
    <div class="dr-sep"></div>
    <div class="dr-note">Roads and places © OpenStreetMap contributors. Base map by OpenFreeMap and OpenMapTiles, satellite pictures by Esri, search by Photon and Nominatim. Traffic is a model, not live data.</div>`;
}
function drawer(on) {
  if (on) renderDrawer();
  $('drawer').classList.toggle('on', on);
  const sc = $('scrim');
  if (on) { sc.hidden = false; requestAnimationFrame(() => sc.classList.add('on')); } else { sc.classList.remove('on'); setTimeout(() => { sc.hidden = true; }, 200); }
}
$('menuBtn').onclick = () => drawer(true);
$('scrim').onclick = () => drawer(false);
$('drawer').addEventListener('click', e => {
  const d = e.target.closest('[data-d]');
  if (!d) return;
  const k = d.dataset.d;
  drawer(false);
  if (k === 'home') goHome(true);
  if (k === 'about') {
    if (S.place) { S.tab = 'about'; renderPlace(); }
    else { pscroll.classList.remove('flush'); pscroll.innerHTML = `<div class="home-head"><button class="pill" data-sort="${S.sort}">${svg(I.back).replace('<svg', '<svg width="18" height="18"')}Popular places</button></div>` + aboutHTML(); }
    openPanel(true);
  }
  if (k === 'share') share();
  if (k === 'sat') setSat(!S.opt.sat);
});
let toastTimer = 0;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 3800); }
function drawScale() {
  const c = map.getCenter(), mpp = 40075016.686 * Math.cos(c.lat * D2R) / (512 * 2 ** map.getZoom());
  const target = mpp * 90, p = 10 ** Math.floor(Math.log10(target)), n = [1, 2, 5].map(k => k * p).filter(v => v <= target).pop() || p;
  const px = n / mpp, label = n >= 1000 ? (n / 1000) + ' km' : n + ' m';
  $('foot').innerHTML = `<span>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>${S.opt.sat ? ' · Imagery © Esri' : ''}</span><span class="scalebar">${label}<i style="width:${px.toFixed(0)}px"></i></span>`;
}

/* -------------------------------- sharing ------------------------------ */
function setURL() {
  const u = new URLSearchParams();
  if (params.get('overpass')) u.set('overpass', params.get('overpass'));
  if (S.place) {
    if (S.place.hot) u.set('p', S.place.hot.id);
    else { u.set('lat', S.place.lat.toFixed(5)); u.set('lng', S.place.lng.toFixed(5)); }
    u.set('r', S.radius); u.set('t', S.hour); u.set('d', S.prof); u.set('m', S.mult);
  }
  const s = u.toString();
  history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
}
async function share() {
  setURL();
  try { await navigator.clipboard.writeText(location.href); toast('Link copied.'); } catch { toast(location.href); }
}

/* --------------------------------- boot -------------------------------- */
async function boot() {
  renderChips(); drawScale(); drawLayersThumb();
  try {
    const r = await fetch('hotspots.json' + V);
    if (r.ok) { const j = await r.json(); S.hot = j.places || []; S.hotTotal = j.scanned; S.hotRadius = j.radius; }
  } catch {}
  await ready;
  drawHotMarkers();
  const pid = params.get('p'), lat = +params.get('lat'), lng = +params.get('lng');
  const fromURL = () => {
    if (params.get('r')) S.radius = clamp(+params.get('r') || 1200, 400, 4000);
    if (params.get('t')) S.hour = clamp(+params.get('t') || 0, 0, 23.75);
    if (params.get('d')) S.prof = params.get('d') === 'we' ? 'we' : 'wd';
    if (params.get('m')) S.mult = clamp(+params.get('m') || 1.3, 0.5, 2.5);
  };
  const h = pid && S.hot.find(x => x.id === pid);
  if (h) { openHot(h); fromURL(); if (params.get('t')) { renderPlace(); simulate(); } }
  else if (isFinite(lat) && isFinite(lng) && params.get('lat')) { fromURL(); openPoint(lat, lng, true, true); }
  else { renderHome(); openPanel(true); fitHot(false); }
}
window.__braess = { S, map, simulate, openHot, openPlace, goHome };
boot();
})();
