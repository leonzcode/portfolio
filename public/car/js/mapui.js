// The map you pick a place on (a look-alike of the Google Maps web app, on Leaflet with keyless tiles) and the
// Street View style overlay shown while driving (address card top left, minimap bottom left).
//
//   const ui = createMapUI(document.getElementById('ui'), { onDrop, onBack });
//   ui.showPicker(opts?)    full-screen map over the game. opts: { lat, lon, zoom, layer: 'satellite'|'map' }
//   ui.hidePicker()
//   ui.startDrive({ lat, lon, heading, label? })   switches to the in-drive overlay
//   ui.updateCar({ lat, lon, heading, speed })     call every frame (or less); drawing is coalesced to one a frame
//   ui.endDrive()
//   ui.destroy()
//
// onDrop({ lat, lon, heading, label }) fires when the user drops the figure on a road, or picks "Drive here".
// lat/lon is the nearest point on the centre line of an OSM road you can drive, heading (degrees clockwise from
// north) runs along that road. onBack() fires from the back arrow on the address card.
//
// Sources: Esri World Topo Map (map), Esri World Imagery + Esri reference layers (satellite), Photon (suggestions
// while typing), Nominatim (Enter and reverse lookups, at most one request a second, as its policy asks; its
// policy forbids type-ahead, which is why suggestions come from Photon), Overpass (roads you can drive).

const CSS_HREF = new URL('../css/mapui.css?v=23', import.meta.url).href;

const TILES = {
  // CARTO's keyless raster basemaps now answer every request with an "API key required" picture (checked
  // 2026-10-19), so the road map is Esri's World Topo Map: the closest keyless look to Google's road map.
  map: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    opts: { maxNativeZoom: 19, maxZoom: 21 },
    credit: 'Map © Esri, HERE, Garmin, USGS, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  },
  sat: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxNativeZoom: 19, maxZoom: 21 },
    credit: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  satRoads: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
    opts: { maxNativeZoom: 19, maxZoom: 21 },
  },
  satPlaces: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    opts: { maxNativeZoom: 19, maxZoom: 21 },
    credit: 'Labels © Esri, HERE, Garmin, © OpenStreetMap contributors',
  },
};

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
// An endpoint of your own goes first: ?overpass=<url> or localStorage car_overpass (a caching proxy, say).
function overpassUrls() {
  const own = [];
  try { const q = new URLSearchParams(location.search).get('overpass'); if (q) own.push(q); } catch {}
  try { const l = localStorage.getItem('car_overpass'); if (l) own.push(l); } catch {}
  return [...new Set([...own, ...OVERPASS])];
}
const DRIVABLE_CLASS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'raceway']);
const DRIVABLE = '^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|track)(_link)?$';
const ROAD_MIN_ZOOM = 15;     // roads are drawn from this zoom up
const CARD_MIN_ZOOM = 16;     // a click on a road shows a card from this zoom up
const TZ = 14;                // road data is fetched and cached in tiles of this zoom (about 2 km)
const VTILES = 'https://tiles.openfreemap.org/planet';   // TileJSON of OpenFreeMap's OpenMapTiles vector tiles
const SEG_CELL = 0.0015;      // degrees, the snapping index
const M_PER_DEG = 111320;

const PLACES = [
  { label: 'Golden Gate Bridge', icon: 'bridge', lat: 37.8199, lon: -122.4783, zoom: 16 },
  { label: 'Times Square', icon: 'city', lat: 40.7580, lon: -73.9855, zoom: 17 },
  { label: 'Shibuya Crossing', icon: 'city', lat: 35.6595, lon: 139.7005, zoom: 17 },
  { label: 'Champs-Élysées', icon: 'city', lat: 48.8718, lon: 2.3011, zoom: 16 },
  { label: 'Monaco', icon: 'road', lat: 43.7395, lon: 7.4266, zoom: 16 },
  { label: 'Stelvio Pass', icon: 'road', lat: 46.5286, lon: 10.4531, zoom: 15 },
  { label: 'Big Sur', icon: 'road', lat: 36.3717, lon: -121.9014, zoom: 15 },
];

// ---------------------------------------------------------------------------------------------------------------
// Icons (all drawn here, nothing taken from Google)

const ICON = {
  menu: '<svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M19 13H5v-2h14v2z"/></svg>',
  locate: '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>',
  zoomTo: '<svg viewBox="0 0 24 24"><path d="M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="m11.99 18.54-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>',
  road: '<svg viewBox="0 0 24 24"><path d="M11 4h2v3h-2zm0 6h2v4h-2zm0 7h2v3h-2zM3 20 7.5 4H9L5.5 20zm18 0h-2.5L15 4h1.5z"/></svg>',
  city: '<svg viewBox="0 0 24 24"><path d="M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z"/></svg>',
  bridge: '<svg viewBox="0 0 24 24"><path d="M7 14v-2.88a7.05 7.05 0 0 1-2-1.1V14h2zm12-3.98a7.1 7.1 0 0 1-2 1.1V14h2v-3.98zM15 14v-2.5a8.9 8.9 0 0 1-2 .3V14h2zm-4 0v-2.2a8.9 8.9 0 0 1-2-.3V14h2zM2 15v2h3v3h2v-3h10v3h2v-3h3v-2H2zm0-9v2c2.6 1.9 5.9 3 10 3s7.4-1.1 10-3V6c-2.6 2-5.9 3-10 3S4.6 8 2 6z"/></svg>',
  help: '<svg viewBox="0 0 24 24"><path d="M11 18h2v-2h-2v2zm1-16a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-14a4 4 0 0 0-4 4h2a2 2 0 1 1 4 0c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 0 0-4-4z"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>',
  expand: '<svg viewBox="0 0 24 24"><path d="M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z"/></svg>',
  shrink: '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>',
};

// Compass: a needle, red half to the north.
const COMPASS = `<svg viewBox="0 0 24 24" class="mu-compass-svg"><path d="M12 2.5 15 12H9z" fill="#e94335"/><path d="M12 21.5 9 12h6z" fill="#9aa0a6"/><circle cx="12" cy="12" r="1.3" fill="#fff"/></svg>`;

// The figure you drag onto a road. Our own drawing: a round head, a body in one piece with the arms, two legs.
const FIG_FILL = '#fbbc04', FIG_SHADE = '#f29900', FIG_LINE = '#b26a00';
// Limbs are capsules: a dark stroke under a lighter one, so they get an outline with round ends.
const limb = (x1, y1, x2, y2, fill) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${FIG_LINE}" stroke-width="5.6" stroke-linecap="round"/><path d="M${x1} ${y1}L${x2} ${y2}" stroke="${fill}" stroke-width="3.4" stroke-linecap="round"/>`;
const FIGURE_STAND = `<svg viewBox="0 0 28 44" class="mu-fig">
  ${limb(11.6, 27, 11.6, 40.6, FIG_SHADE)}${limb(16.4, 27, 16.4, 40.6, FIG_FILL)}
  ${limb(8.4, 16.5, 7.4, 26.5, FIG_SHADE)}${limb(19.6, 16.5, 20.6, 26.5, FIG_FILL)}
  <rect x="8.3" y="13" width="11.4" height="16.4" rx="3.2" fill="${FIG_FILL}" stroke="${FIG_LINE}" stroke-width="1.1"/>
  <circle cx="14" cy="7.4" r="5" fill="${FIG_FILL}" stroke="${FIG_LINE}" stroke-width="1.1"/>
  <path d="M10.8 6.3a3.6 3.6 0 0 1 2.4-2.6" stroke="#fff3c4" stroke-width="1.2" fill="none" stroke-linecap="round"/>
</svg>`;
const FIGURE_FLY = `<svg viewBox="0 0 44 52" class="mu-fig">
  ${limb(19.6, 32, 17.4, 46.4, FIG_SHADE)}${limb(24.4, 32, 26.6, 46.4, FIG_FILL)}
  ${limb(17.4, 18.6, 10.4, 10.2, FIG_SHADE)}${limb(26.6, 18.6, 33.6, 10.2, FIG_FILL)}
  <rect x="16.2" y="15.2" width="11.6" height="18.6" rx="3.2" fill="${FIG_FILL}" stroke="${FIG_LINE}" stroke-width="1.1"/>
  <circle cx="22" cy="9.6" r="5" fill="${FIG_FILL}" stroke="${FIG_LINE}" stroke-width="1.1"/>
  <path d="M18.8 8.5a3.6 3.6 0 0 1 2.4-2.6" stroke="#fff3c4" stroke-width="1.2" fill="none" stroke-linecap="round"/>
</svg>`;

// A red map pin with a dark centre, our own path.
const PIN = `<svg viewBox="0 0 27 43" class="mu-pin-svg"><path d="M13.5 1.2C6.6 1.2 1.2 6.5 1.2 13.2c0 4.3 2.1 7.6 4.6 10.6 2.9 3.4 5.6 6.3 6.7 17.6.1.6.5.9 1 .9s.9-.3 1-.9c1.1-11.3 3.8-14.2 6.7-17.6 2.5-3 4.6-6.3 4.6-10.6C25.8 6.5 20.4 1.2 13.5 1.2z" fill="#ea4335" stroke="#a50e0e" stroke-width="1.2"/><circle cx="13.5" cy="13.2" r="4.4" fill="#a50e0e"/></svg>`;

// The car on the minimap: a heading cone and a navigation arrow.
const CAR = `<div class="mu-car"><svg viewBox="-60 -60 120 120" class="mu-car-svg">
  <defs><radialGradient id="mu-cone-g" cx="0" cy="0" r="58" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#4285f4" stop-opacity=".55"/><stop offset="1" stop-color="#4285f4" stop-opacity="0"/></radialGradient></defs>
  <path d="M0 0 L-30 -50 A58 58 0 0 1 30 -50 Z" fill="url(#mu-cone-g)"/>
  <circle r="11" fill="#fff" opacity=".9"/>
  <path d="M0 -10 L7.5 8 L0 4.2 L-7.5 8 Z" fill="#1a73e8" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
</svg></div>`;

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const fmt = (v) => (Math.round(v * 1e5) / 1e5).toFixed(5);
const lang = () => (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']).join(',');

function bearing(lat1, lon1, lat2, lon2) {
  const d = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * d) * Math.cos(lat2 * d);
  const x = Math.cos(lat1 * d) * Math.sin(lat2 * d) - Math.sin(lat1 * d) * Math.cos(lat2 * d) * Math.cos((lon2 - lon1) * d);
  return ((Math.atan2(y, x) / d) + 360) % 360;
}
function distM(lat1, lon1, lat2, lon2) {
  const c = Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const dx = (lon2 - lon1) * M_PER_DEG * c, dy = (lat2 - lat1) * M_PER_DEG;
  return Math.hypot(dx, dy);
}
const COMPASS_WORDS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const compassWord = (h) => COMPASS_WORDS[Math.round((((h % 360) + 360) % 360) / 45) % 8];

// A minimal Mapbox Vector Tile reader: only the "transportation" layer's drivable lines, clipped to the tile
// (tiles carry a buffer past their edge), in tile units 0..1.
function mvtRoads(buf) {
  let p = 0;
  const varint = () => { let r = 0, m = 1, b; do { b = buf[p++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; };
  const skip = (w) => { if (w === 0) varint(); else if (w === 1) p += 8; else if (w === 2) { const n = varint(); p += n; } else if (w === 5) p += 4; };
  const td = new TextDecoder();
  const out = [];
  while (p < buf.length) {
    const tag = varint(), f = Math.floor(tag / 8), w = tag & 7;
    if (f !== 3 || w !== 2) { skip(w); continue; }
    const len = varint(), end = p + len;
    let name = '', extent = 4096;
    const keys = [], vals = [], feats = [];
    while (p < end) {
      const t2 = varint(), f2 = Math.floor(t2 / 8), w2 = t2 & 7;
      if (f2 === 1 && w2 === 2) { const n = varint(); name = td.decode(buf.subarray(p, p + n)); p += n; if (name !== 'transportation') { p = end; break; } }
      else if (f2 === 2 && w2 === 2) { const n = varint(); feats.push([p, p + n]); p += n; }
      else if (f2 === 3 && w2 === 2) { const n = varint(); keys.push(td.decode(buf.subarray(p, p + n))); p += n; }
      else if (f2 === 4 && w2 === 2) {
        const n = varint(), ve = p + n;
        let v = null;
        while (p < ve) {
          const t3 = varint(), f3 = Math.floor(t3 / 8), w3 = t3 & 7;
          if (f3 === 1) { const m = varint(); v = td.decode(buf.subarray(p, p + m)); p += m; }
          else if (f3 === 2) { v = new DataView(buf.buffer, buf.byteOffset + p, 4).getFloat32(0, true); p += 4; }
          else if (f3 === 3) { v = new DataView(buf.buffer, buf.byteOffset + p, 8).getFloat64(0, true); p += 8; }
          else if (f3 === 4 || f3 === 5) v = varint();
          else if (f3 === 6) { const z = varint(); v = z % 2 ? -(z + 1) / 2 : z / 2; }
          else if (f3 === 7) v = !!varint();
          else skip(w3);
        }
        vals.push(v);
      }
      else if (f2 === 5 && w2 === 0) extent = varint();
      else skip(w2);
    }
    p = end;
    if (name !== 'transportation') continue;
    const save = p;
    for (const [fs, fe] of feats) {
      p = fs;
      let type = 0, tags = null, geom = null;
      while (p < fe) {
        const t4 = varint(), f4 = Math.floor(t4 / 8), w4 = t4 & 7;
        if (f4 === 2 && w4 === 2) { const n = varint(), e = p + n; tags = []; while (p < e) tags.push(varint()); }
        else if (f4 === 3) type = varint();
        else if (f4 === 4 && w4 === 2) { const n = varint(); geom = [p, p + n]; p += n; }
        else skip(w4);
      }
      if (type !== 2 || !tags || !geom) continue;
      const props = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
      if (!DRIVABLE_CLASS.has(props.class)) continue;
      if (props.access === 'no') continue;
      // Geometry: MoveTo starts a line, LineTo extends it.
      p = geom[0];
      const lines = [];
      let x = 0, y = 0, cur = null;
      while (p < geom[1]) {
        const c = varint(), id = c & 7, cnt = c >> 3;
        if (id === 7) continue;
        for (let k = 0; k < cnt; k++) {
          const dx = varint(), dy = varint();
          x += dx % 2 ? -(dx + 1) / 2 : dx / 2;
          y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
          if (id === 1) { cur = [[x, y]]; lines.push(cur); } else if (cur) cur.push([x, y]);
        }
      }
      for (const l of lines) for (const run of clipRun(l, extent)) {
        out.push({ pts: run.map(([a, b]) => [a / extent, b / extent]), cls: props.class === 'minor' ? 'residential' : props.class, name: props.name || '', oneway: props.oneway === 1 ? 1 : props.oneway === -1 ? -1 : 0 });
      }
    }
    p = save;
  }
  return out;
}
// Cut a polyline to the box 0..max (Liang-Barsky on each segment), keeping the pieces inside.
function clipRun(pts, max) {
  const out = [];
  let cur = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1, ok = true;
    const P = [-dx, dx, -dy, dy], Q = [x0, max - x0, y0, max - y0];
    for (let k = 0; k < 4 && ok; k++) {
      if (P[k] === 0) { if (Q[k] < 0) ok = false; }
      else { const r = Q[k] / P[k]; if (P[k] < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else { if (r < t0) ok = false; else if (r < t1) t1 = r; } }
    }
    if (!ok) { cur = null; continue; }
    if (!cur || t0 > 0) { cur = [[x0 + dx * t0, y0 + dy * t0]]; out.push(cur); }
    cur.push([x0 + dx * t1, y0 + dy * t1]);
    if (t1 < 1) cur = null;
  }
  return out.filter((r) => r.length >= 2);
}

// Nominatim allows one request a second from a whole app. Every call goes through this queue.
let nomLast = 0, nomChain = Promise.resolve();
function nominatim(path, params, signal) {
  const run = async () => {
    const wait = nomLast + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
    nomLast = Date.now();
    const q = new URLSearchParams({ format: 'jsonv2', 'accept-language': lang(), ...params });
    const r = await fetch(`https://nominatim.openstreetmap.org/${path}?${q}`, { signal, headers: { 'Accept-Language': lang() } });
    if (!r.ok) throw new Error('nominatim ' + r.status);
    return r.json();
  };
  const p = nomChain.then(run, run);
  nomChain = p.catch(() => {});
  return p;
}

// Reverse lookup into { title, sub } as Street View shows it: the street, then the town and region.
async function reverse(lat, lon, signal) {
  const j = await nominatim('reverse', { lat: fmt(lat), lon: fmt(wrapLon(lon)), zoom: '17', addressdetails: '1' }, signal);
  const a = j.address || {};
  const street = a.road || a.pedestrian || a.footway || a.path || a.square || j.name || '';
  const num = a.house_number ? a.house_number + ' ' : '';
  const town = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || a.county || '';
  const region = a.state || a.region || a.province || a.country || '';
  const title = street ? num + street : (town || (j.display_name || '').split(',')[0] || 'Unnamed road');
  const sub = [street ? town : '', region].filter(Boolean).join(', ') || a.country || '';
  return { title, sub, country: a.country_code || '' };
}

// ---------------------------------------------------------------------------------------------------------------

export function createMapUI(root, { onDrop = () => {}, onBack = () => {} } = {}) {
  const L = window.L;
  if (!L) throw new Error('mapui: Leaflet (global L) is not loaded');
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => /css\/mapui\.css/.test(l.href))) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  const touchFirst = matchMedia('(hover: none)').matches;
  const el = document.createElement('div');
  el.className = 'mu';
  el.innerHTML = `
  <div class="mu-picker" hidden>
    <div class="mu-map"></div>
    <div class="mu-progress"></div>
    <div class="mu-top">
      <div class="mu-search" role="search">
        <div class="mu-search-row">
          <button class="mu-ib mu-menu-btn" type="button" aria-label="Menu" data-tip="Menu">${ICON.menu}</button>
          <input class="mu-input" type="text" placeholder="Search places" aria-label="Search places" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" role="combobox" aria-expanded="false" aria-controls="mu-sugg">
          <button class="mu-ib mu-go" type="button" aria-label="Search">${ICON.search}</button>
          <button class="mu-ib mu-clear" type="button" aria-label="Clear search" hidden>${ICON.close}</button>
        </div>
        <div class="mu-sugg" id="mu-sugg" role="listbox"></div>
      </div>
      <div class="mu-chips">${PLACES.map((p, i) => `<button class="mu-chip" type="button" data-i="${i}"><span class="mu-chip-ic">${ICON[p.icon]}</span>${esc(p.label)}</button>`).join('')}</div>
    </div>
    <div class="mu-place" hidden></div>
    <div class="mu-hint" hidden></div>
    <div class="mu-layers" role="button" tabindex="0" aria-label="Switch layer">
      <div class="mu-layers-map"></div>
      <div class="mu-layers-label">${ICON.layers}<span>Satellite</span></div>
    </div>
    <div class="mu-rail">
      <button class="mu-btn mu-compass" type="button" aria-label="Reset north" data-tip="North is up">${COMPASS}</button>
      <button class="mu-btn mu-locate" type="button" aria-label="Show your location" data-tip="Show your location">${ICON.locate}</button>
      <button class="mu-btn mu-peg" type="button" aria-label="Drag onto a road to drive" data-tip="Drag onto a road to drive">${FIGURE_STAND}</button>
      <div class="mu-zoom">
        <button class="mu-zbtn mu-zin" type="button" aria-label="Zoom in" data-tip="Zoom in">${ICON.plus}</button>
        <div class="mu-zsep"></div>
        <button class="mu-zbtn mu-zout" type="button" aria-label="Zoom out" data-tip="Zoom out">${ICON.minus}</button>
      </div>
    </div>
    <div class="mu-foot"><span class="mu-credit"></span><span class="mu-scale"><span class="mu-scale-t"></span><span class="mu-scale-bar"></span></span></div>
    <div class="mu-ctx" role="menu" hidden></div>
    <div class="mu-card" hidden></div>
    <div class="mu-drawer-scrim" hidden></div>
    <nav class="mu-drawer" aria-label="Menu" hidden>
      <div class="mu-drawer-head"><span class="mu-brand">Earth Drive</span><button class="mu-ib mu-drawer-x" type="button" aria-label="Close menu">${ICON.close}</button></div>
      <button class="mu-dr-item" type="button" data-k="sat">${ICON.layers}<span>Satellite</span><i class="mu-switch"></i></button>
      <button class="mu-dr-item" type="button" data-k="labels">${ICON.city}<span>Labels on satellite</span><i class="mu-switch"></i></button>
      <button class="mu-dr-item" type="button" data-k="roads">${ICON.road}<span>Roads you can drive</span><i class="mu-switch"></i></button>
      <div class="mu-dr-sep"></div>
      <button class="mu-dr-item" type="button" data-k="locate">${ICON.locate}<span>Your location</span></button>
      <button class="mu-dr-item" type="button" data-k="last" hidden>${ICON.history}<span>Back to your last drive</span></button>
      <div class="mu-dr-sep"></div>
      <button class="mu-dr-item" type="button" data-k="gkey" aria-expanded="false">${ICON.gear}<span>Google 3D city (API key)</span><i class="mu-dr-state"></i></button>
      <form class="mu-gkey" hidden autocomplete="off">
        <label class="mu-gkey-l" for="mu-gkey-in">Map Tiles API key</label>
        <input id="mu-gkey-in" class="mu-gkey-in" type="password" spellcheck="false" autocomplete="off" placeholder="Paste your key">
        <p class="mu-gkey-p">With a key, your next drop uses Google's photorealistic 3D city. The key stays in this browser. Leave it empty to use the open map.</p>
        <p class="mu-gkey-p">To get one: in Google Cloud, turn on the Map Tiles API and create an API key (<a href="https://developers.google.com/maps/documentation/tile/get-api-key" target="_blank" rel="noopener">Google's steps</a>). Google may charge past its free monthly use.</p>
        <div class="mu-gkey-row"><button class="mu-gkey-clear" type="button">Remove key</button><button class="mu-gkey-save" type="submit">Save</button></div>
      </form>
      <div class="mu-dr-sep"></div>
      <div class="mu-dr-help">${ICON.help}<div><b>How to drop in</b><p>Drag the yellow figure onto a road. Or right-click the map${touchFirst ? ' (press and hold on a phone)' : ''} and pick Drive here. Or search for a place and press Drive here.</p></div></div>
    </nav>
    <div class="mu-toast" role="status" aria-live="polite"></div>
  </div>
  <div class="mu-drive" hidden>
    <div class="mu-addr">
      <button class="mu-ib mu-back" type="button" tabindex="-1" aria-label="Back to the map">${ICON.back}</button>
      <div class="mu-addr-text"><div class="mu-addr-t">Finding the street</div><div class="mu-addr-s"></div><div class="mu-addr-m"></div></div>
    </div>
    <div class="mu-mini">
      <div class="mu-mini-map"></div>
      <button class="mu-mini-x" type="button" tabindex="-1" aria-label="Bigger map">${ICON.expand}</button>
    </div>
  </div>
  <div class="mu-drag" hidden><div class="mu-drag-target"></div><div class="mu-drag-fig">${FIGURE_FLY}</div></div>`;
  root.appendChild(el);

  const $ = (s) => el.querySelector(s);
  const pickerEl = $('.mu-picker'), mapEl = $('.mu-map'), input = $('.mu-input'), searchEl = $('.mu-search');
  const suggEl = $('.mu-sugg'), clearBtn = $('.mu-clear'), placeEl = $('.mu-place'), hintEl = $('.mu-hint');
  const layersEl = $('.mu-layers'), layersLabel = $('.mu-layers-label span'), ctxEl = $('.mu-ctx'), cardEl = $('.mu-card');
  const toastEl = $('.mu-toast'), dragEl = $('.mu-drag'), dragFig = $('.mu-drag-fig'), dragTarget = $('.mu-drag-target');
  const pegBtn = $('.mu-peg'), creditEl = $('.mu-credit'), scaleT = $('.mu-scale-t'), scaleBar = $('.mu-scale-bar');
  const drawer = $('.mu-drawer'), scrim = $('.mu-drawer-scrim');
  const driveEl = $('.mu-drive'), addrT = $('.mu-addr-t'), addrS = $('.mu-addr-s'), addrM = $('.mu-addr-m');
  const miniEl = $('.mu-mini'), miniMapEl = $('.mu-mini-map'), miniX = $('.mu-mini-x');

  const ac = new AbortController();           // every listener added on window/document goes away with destroy()
  const on = (t, type, fn, o = {}) => t.addEventListener(type, fn, { ...o, signal: ac.signal });

  // State
  let map = null, baseMap = null, baseSat = null, satRoads = null, satPlaces = null, thumbMap = null, thumbLayer = null;
  let layer = 'sat', labels = true, roadsOn = false, roadsShown = false;
  let pinMarker = null, clickMarker = null, dropMarker = null, meMarker = null, meCircle = null;
  let lastDrop = null, lastCar = null, mode = 'idle';
  let toastTimer = 0;

  // ------------------------------------------------------------------ toast and hint
  function toast(msg, ms = 3200) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('on'), ms);
  }
  function hint(msg) {
    if (!msg) { hintEl.hidden = true; return; }
    hintEl.textContent = msg; hintEl.hidden = false;
  }

  // ------------------------------------------------------------------ the map
  function ensureMap() {
    if (map) return;
    map = L.map(mapEl, {
      zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: 2, maxZoom: 21,
      zoomSnap: 1, wheelPxPerZoomLevel: 100, tapHold: true, boxZoom: true,
    }).setView([25, 5], 3);
    map.createPane('mu-roads').style.zIndex = 380;
    map.createPane('mu-labels').style.zIndex = 390;
    map.getPane('mu-labels').style.pointerEvents = 'none';
    map.getPane('mu-roads').style.pointerEvents = 'none';
    baseMap = L.tileLayer(TILES.map.url, TILES.map.opts);
    baseSat = L.tileLayer(TILES.sat.url, TILES.sat.opts);
    satRoads = L.tileLayer(TILES.satRoads.url, { ...TILES.satRoads.opts, pane: 'mu-labels', opacity: 0.6 });
    satPlaces = L.tileLayer(TILES.satPlaces.url, { ...TILES.satPlaces.opts, pane: 'mu-labels' });
    roads.init();
    setLayer(layer, true);

    map.on('move', syncThumb);
    map.on('zoomend moveend', () => { updateScale(); updateZoomButtons(); });
    map.on('moveend', () => scheduleViewRoads());
    map.on('zoomend', () => { roads.restyle(); refreshHint(); });
    map.on('movestart', () => closeCtx());
    map.on('click', onMapClick);
    map.on('contextmenu', onContext);
    updateScale(); updateZoomButtons();

    thumbMap = L.map($('.mu-layers-map'), {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, touchZoom: false, tapHold: false, zoomSnap: 0, inertia: false,
    }).setView(map.getCenter(), Math.max(1, map.getZoom() - 1));
    setThumb();
  }

  function setLayer(k, first) {
    layer = k;
    if (k === 'sat') {
      if (map.hasLayer(baseMap)) map.removeLayer(baseMap);
      baseSat.addTo(map);
      if (labels) { satRoads.addTo(map); satPlaces.addTo(map); }
    } else {
      [baseSat, satRoads, satPlaces].forEach((l) => map.hasLayer(l) && map.removeLayer(l));
      baseMap.addTo(map);
    }
    pickerEl.classList.toggle('mu-is-sat', k === 'sat');
    layersLabel.textContent = k === 'sat' ? 'Map' : 'Satellite';
    layersEl.setAttribute('aria-label', k === 'sat' ? 'Show the map' : 'Show satellite');
    creditEl.innerHTML = k === 'sat' ? TILES.sat.credit + (labels ? '. ' + TILES.satPlaces.credit : '') : TILES.map.credit;
    if (!first) setThumb();
    roads.restyle();
    syncDrawer();
  }
  function setLabels(v) {
    labels = v;
    if (layer === 'sat') setLayer('sat');
    syncDrawer();
  }
  function setThumb() {
    if (!thumbMap) return;
    if (thumbLayer) thumbMap.removeLayer(thumbLayer);
    thumbLayer = layer === 'sat' ? L.tileLayer(TILES.map.url, TILES.map.opts) : L.tileLayer(TILES.sat.url, TILES.sat.opts);
    thumbLayer.addTo(thumbMap);
    syncThumb();
  }
  function syncThumb() {
    if (!thumbMap || !map) return;
    thumbMap.setView(map.getCenter(), Math.max(1, map.getZoom() - 1), { animate: false });
  }

  function updateScale() {
    const c = map.getCenter();
    const mpp = 40075016.686 * Math.cos(c.lat * Math.PI / 180) / (256 * Math.pow(2, map.getZoom()));
    const maxM = mpp * 90;
    const pow = Math.pow(10, Math.floor(Math.log10(maxM)));
    const n = maxM / pow >= 5 ? 5 : maxM / pow >= 2 ? 2 : 1;
    const m = n * pow;
    scaleT.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
    scaleBar.style.width = Math.round(m / mpp) + 'px';
  }
  function updateZoomButtons() {
    $('.mu-zin').disabled = map.getZoom() >= map.getMaxZoom();
    $('.mu-zout').disabled = map.getZoom() <= map.getMinZoom();
  }
  function metersPerPixel() {
    const c = map.getCenter();
    return 40075016.686 * Math.cos(c.lat * Math.PI / 180) / (256 * Math.pow(2, map.getZoom()));
  }

  // ------------------------------------------------------------------ roads you can drive
  const roads = (() => {
    const cells = new Map();     // z14 tile 'x,y' -> 'pending' | 'done'
    const ways = new Map();      // id -> { id, pts: [[lat, lon]...], hw, name, oneway }
    const segs = new Map();      // seg cell key -> [[way, i]...]
    let group = null, inFlight = null, queued = false, failAt = 0;
    const batches = [];          // [{ outline, fill }]

    const ckey = (a, b) => a + ',' + b;
    function widthFor(z) { return z >= 21 ? 14 : z >= 20 ? 12 : z >= 19 ? 9.5 : z >= 18 ? 7.5 : z >= 17 ? 5.5 : z >= 16 ? 4 : 3; }
    function style(outline) {
      const w = widthFor(map ? map.getZoom() : 16);
      return outline
        ? { color: '#185abc', weight: w + 2.5, opacity: 0.55, lineCap: 'round', lineJoin: 'round', interactive: false }
        : { color: '#5e9ef7', weight: w, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false };
    }

    function init() {
      const renderer = L.canvas({ pane: 'mu-roads', padding: 0.4 });
      group = L.layerGroup([], { pane: 'mu-roads' });
      group._muRenderer = renderer;
    }
    function restyle() {
      for (const b of batches) { b.outline.setStyle(style(true)); b.fill.setStyle(style(false)); }
    }
    function show(v) {
      v = !!v;
      if (v === roadsShown || !map) return;
      roadsShown = v;
      if (v) { group.addTo(map); viewChanged(); } else map.removeLayer(group);
      refreshHint();
    }

    function addWays(list) {
      const fresh = [];
      for (const way of list) {
        if (ways.has(way.id) || way.pts.length < 2) continue;
        const pts = way.pts;
        ways.set(way.id, way);
        fresh.push(way);
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const y0 = Math.floor(Math.min(a[0], b[0]) / SEG_CELL), y1 = Math.floor(Math.max(a[0], b[0]) / SEG_CELL);
          const x0 = Math.floor(Math.min(a[1], b[1]) / SEG_CELL), x1 = Math.floor(Math.max(a[1], b[1]) / SEG_CELL);
          if ((y1 - y0 + 1) * (x1 - x0 + 1) > 400) continue;
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const k = ckey(y, x);
            let arr = segs.get(k);
            if (!arr) segs.set(k, arr = []);
            arr.push(way, i);
          }
        }
      }
      if (fresh.length && group) {
        const lls = fresh.map((w) => w.pts);
        const outline = L.polyline(lls, { ...style(true), renderer: group._muRenderer });
        const fill = L.polyline(lls, { ...style(false), renderer: group._muRenderer });
        batches.push({ outline, fill });
        group.addLayer(outline); group.addLayer(fill);
      }
      return fresh.length;
    }

    async function overpass(query, signal) {
      let lastErr;
      for (const url of overpassUrls()) {
        try {
          const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal });
          if (!r.ok) throw new Error('overpass ' + r.status);
          return await r.json();
        } catch (e) { if (e.name === 'AbortError') throw e; lastErr = e; }
      }
      throw lastErr;
    }

    // Road data comes in z14 tiles: OpenFreeMap's vector tiles first (keyless, on a CDN), Overpass for a tile
    // whose vector tile will not load.
    const N = Math.pow(2, TZ);
    const tileXY = (lat, lon) => {
      const la = clamp(lat, -85, 85) * Math.PI / 180;
      return [(wrapLon(lon) + 180) / 360 * N, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * N];
    };
    const tileLon = (x) => x / N * 360 - 180;
    const tileLat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / N))) * 180 / Math.PI;
    const wrapX = (x) => ((x % N) + N) % N;

    function viewCells() {
      const b = map.getBounds().pad(0.1), c = map.getCenter();
      const [x0, y0] = tileXY(b.getNorth(), b.getWest()), [x1, y1] = tileXY(b.getSouth(), b.getEast());
      const [cx, cy] = tileXY(c.lat, c.lng);
      const out = [], seen = new Set();
      const xe = Math.floor(b.getEast() - b.getWest() >= 360 ? x0 + N : (x1 < x0 ? x1 + N : x1));
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let x = Math.floor(x0); x <= xe; x++) {
        const k = ckey(wrapX(x), y);
        if (!seen.has(k)) { seen.add(k); out.push([wrapX(x), y]); }
      }
      out.sort((p, q) => Math.hypot(p[0] + 0.5 - cx, p[1] + 0.5 - cy) - Math.hypot(q[0] + 0.5 - cx, q[1] + 0.5 - cy));
      return out.slice(0, 9);   // a dense city tile is about 330 KB gzipped; more come as the map moves
    }

    let tileUrl = null;
    function vectorUrl() {
      if (!tileUrl) tileUrl = fetch(VTILES).then((r) => { if (!r.ok) throw new Error('tilejson ' + r.status); return r.json(); })
        .then((j) => j.tiles[0]).catch((e) => { tileUrl = null; throw e; });
      return tileUrl;
    }
    async function vectorTile(x, y) {
      const url = (await vectorUrl()).replace('{z}', TZ).replace('{x}', x).replace('{y}', y);
      const r = await fetch(url);
      if (!r.ok) throw new Error('tile ' + r.status);
      const lines = mvtRoads(new Uint8Array(await r.arrayBuffer()));
      return lines.map((l, i) => ({
        id: `v${x}/${y}/${i}`, hw: l.cls, name: l.name, oneway: l.oneway,
        pts: l.pts.map(([px, py]) => [tileLat(y + py), tileLon(x + px)]),
      }));
    }
    async function overpassTiles(list) {
      const parts = list.map(([x, y]) => `way["highway"~"${DRIVABLE}"](${tileLat(y + 1).toFixed(5)},${tileLon(x).toFixed(5)},${tileLat(y).toFixed(5)},${tileLon(x + 1).toFixed(5)});`);
      const j = await overpass(`[out:json][timeout:25];(${parts.join('')});out geom qt;`);
      const out = [];
      for (const w of j.elements || []) {
        if (w.type !== 'way' || !w.geometry) continue;
        const t = w.tags || {};
        if (t.area === 'yes') continue;
        out.push({
          id: w.id, hw: t.highway, name: t.name || t.ref || '',
          oneway: t.oneway === 'yes' || t.oneway === '1' ? 1 : t.oneway === '-1' ? -1 : (t.junction === 'roundabout' ? 1 : 0),
          pts: w.geometry.filter(Boolean).map((g) => [g.lat, g.lon]),
        });
      }
      return out;
    }

    async function fetchCells(list) {
      const need = list.filter(([x, y]) => !cells.has(ckey(x, y)));
      if (!need.length) return 0;
      need.forEach(([x, y]) => cells.set(ckey(x, y), 'pending'));
      let added = 0;
      const failed = [];
      await Promise.all(need.map(async ([x, y]) => {
        try {
          added += addWays(await vectorTile(x, y));
          cells.set(ckey(x, y), 'done');
        } catch (e) { failed.push([x, y]); }
      }));
      if (failed.length) {
        try {
          added += addWays(await overpassTiles(failed));
          failed.forEach(([x, y]) => cells.set(ckey(x, y), 'done'));
        } catch (e) {
          failed.forEach(([x, y]) => cells.delete(ckey(x, y)));
          failAt = Date.now();
          if (!added) throw e;
        }
      }
      return added;
    }

    // Load the view's roads when they are shown, or quietly at click-card zoom. One load at a time.
    function viewChanged() {
      if (!map || mode !== 'picker') return;
      const z = map.getZoom();
      if (z < ROAD_MIN_ZOOM) return;
      if (!roadsShown && z < CARD_MIN_ZOOM) return;
      if (inFlight) { queued = true; return; }
      if (Date.now() - failAt < 4000) return;
      const list = viewCells();
      if (list.every(([x, y]) => cells.has(ckey(x, y)))) return;
      pickerEl.classList.add('mu-loading-roads');
      inFlight = fetchCells(list)
        .catch(() => { if (roadsShown) toast('Roads did not load. Try again in a moment.'); })
        .finally(() => {
          inFlight = null;
          pickerEl.classList.remove('mu-loading-roads');
          if (queued) { queued = false; viewChanged(); }
        });
    }

    // Make sure roads near one point are loaded (for a drop or a "Drive here" anywhere).
    async function ensureAround(lat, lon, rM) {
      const dLat = rM / M_PER_DEG, dLon = rM / (M_PER_DEG * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
      const [x0, y0] = tileXY(lat + dLat, lon - dLon), [x1, y1] = tileXY(lat - dLat, lon + dLon);
      const list = [];
      const xe = x1 < x0 ? x1 + N : x1;
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let x = Math.floor(x0); x <= Math.floor(xe); x++) list.push([wrapX(x), y]);
      if (list.every(([x, y]) => cells.get(ckey(x, y)) === 'done')) return;
      const missing = list.filter(([x, y]) => !cells.has(ckey(x, y)));
      if (missing.length) await fetchCells(missing.slice(0, 12));
      // Another load may still hold some of these tiles; wait for it.
      for (let i = 0; i < 80 && list.some(([x, y]) => cells.get(ckey(x, y)) === 'pending'); i++) await new Promise((r) => setTimeout(r, 250));
    }
    const loadedAt = (lat, lon) => { const [x, y] = tileXY(lat, lon); return cells.get(ckey(Math.floor(x), Math.floor(y))) === 'done'; };

    // Nearest point on a road within rM metres: { lat, lon, dist, way, heading } or null.
    function nearest(lat, lon, rM, pref) {
      const cos = Math.cos(lat * Math.PI / 180);
      const dLat = rM / M_PER_DEG, dLon = rM / (M_PER_DEG * Math.max(0.05, cos));
      const y0 = Math.floor((lat - dLat) / SEG_CELL), y1 = Math.floor((lat + dLat) / SEG_CELL);
      const x0 = Math.floor((lon - dLon) / SEG_CELL), x1 = Math.floor((lon + dLon) / SEG_CELL);
      let best = null, bestD = rM;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const arr = segs.get(ckey(y, x));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 2) {
          const way = arr[k], i = arr[k + 1], a = way.pts[i], b = way.pts[i + 1];
          const ax = (a[1] - lon) * M_PER_DEG * cos, ay = (a[0] - lat) * M_PER_DEG;
          const bx = (b[1] - lon) * M_PER_DEG * cos, by = (b[0] - lat) * M_PER_DEG;
          const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
          const t = L2 > 0 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0;
          const px = ax + dx * t, py = ay + dy * t, d = Math.hypot(px, py);
          // Big roads win a near tie over service lanes and tracks.
          const minor = /^(service|track)$/.test(way.hw) ? 4 : 0;
          if (d + minor < bestD) {
            bestD = d + minor;
            best = { lat: lat + py / M_PER_DEG, lon: lon + px / (M_PER_DEG * cos), dist: d, way, i, h: bearing(a[0], a[1], b[0], b[1]) };
          }
        }
      }
      if (!best) return null;
      // Which way along the road: one-way roads go their way; otherwise the way the user was moving, else
      // the one nearer north (or the hint heading).
      let h = best.h;
      if (best.way.oneway === -1) h = (h + 180) % 360;
      else if (!best.way.oneway) {
        const want = pref ?? 0;
        const diff = Math.abs(((h - want + 540) % 360) - 180);
        if (diff > 90) h = (h + 180) % 360;
      }
      best.heading = Math.round(h * 10) / 10;
      return best;
    }

    return { init, restyle, show, viewChanged, ensureAround, loadedAt, nearest, get count() { return ways.size; }, get busy() { return !!inFlight; } };
  })();

  function refreshHint() {
    if (!map) return;
    const dragging = drag.active;
    if ((roadsShown || dragging) && map.getZoom() < ROAD_MIN_ZOOM) hint('Zoom in to see the roads you can drive');
    else hint('');
  }

  // Snap a point to the nearest road, loading roads there first if needed. Returns null if none is near.
  async function snapTo(lat, lon, { radiusPx = 36, pref } = {}) {
    lon = wrapLon(lon);
    const mpp = metersPerPixel();
    const r = Math.max(25, radiusPx * mpp);
    if (!roads.loadedAt(lat, lon)) await roads.ensureAround(lat, lon, Math.min(Math.max(r, 250), 1500));
    let s = roads.nearest(lat, lon, Math.min(r, 1500), pref);
    if (!s) s = roads.nearest(lat, lon, Math.min(Math.max(r * 3, 120), 1500), pref);
    return s;
  }

  // ------------------------------------------------------------------ dropping in
  let dropping = false;
  async function driveAt(lat, lon, { label, pref, radiusPx } = {}) {
    if (dropping) return;
    dropping = true;
    pickerEl.classList.add('mu-busy');
    try {
      const s = await snapTo(lat, lon, { radiusPx, pref });
      if (!s) { toast('No road you can drive near here. Try closer to a road.'); return false; }
      const name = label || s.way.name || '';
      lastDrop = { lat: s.lat, lon: wrapLon(s.lon), heading: s.heading, label: name };
      placeDropMarker(s.lat, s.lon);
      closeCard(); closeCtx(); closePlace(false);
      onDrop({ ...lastDrop });
      // If the host keeps the map up while the world loads, close in on the spot.
      if (mode === 'picker' && !pickerEl.hidden) map.flyTo([s.lat, s.lon], Math.max(map.getZoom(), 18), { duration: 0.8 });
      return true;
    } catch (e) {
      toast('Roads did not load here. Check your connection and try again.');
      return false;
    } finally {
      dropping = false;
      pickerEl.classList.remove('mu-busy');
    }
  }
  function placeDropMarker(lat, lon) {
    if (dropMarker) map.removeLayer(dropMarker);
    dropMarker = L.marker([lat, lon], {
      icon: L.divIcon({ className: 'mu-dropped', html: `<div class="mu-dropped-fig">${FIGURE_STAND}</div><div class="mu-dropped-dot"></div>`, iconSize: [28, 52], iconAnchor: [14, 48] }),
      interactive: false, keyboard: false,
    }).addTo(map);
  }

  // ------------------------------------------------------------------ the figure drag
  const drag = {
    active: false, x: 0, y: 0, lastX: 0, vx: 0, ang: 0, angV: 0, raf: 0, t: 0, snap: null, offY: 0, moveX: 0, moveY: 0,
    pointerId: null, startX: 0, startY: 0, started: false, checkAt: 0,
  };
  function figDown(e) {
    if (mode !== 'picker' || e.button > 0 || dropping) return;
    e.preventDefault();
    drag.pointerId = e.pointerId; drag.started = false;
    drag.startX = e.clientX; drag.startY = e.clientY;
    drag.offY = e.pointerType === 'touch' ? -64 : 0;
    on(window, 'pointermove', figMove);
    on(window, 'pointerup', figUp);
    on(window, 'pointercancel', figCancel);
    roads.show(true);
  }
  function figBegin(e) {
    drag.active = true; drag.started = true;
    drag.x = e.clientX; drag.y = e.clientY + drag.offY; drag.lastX = drag.x; drag.vx = 0; drag.ang = 0; drag.angV = 0;
    drag.t = performance.now(); drag.snap = null; drag.moveX = 0; drag.moveY = 0;
    closeCtx(); closeCard(); closeSugg();
    dragEl.hidden = false;
    pegBtn.classList.add('mu-peg-out');
    pickerEl.classList.add('mu-dragging');
    refreshHint();
    drag.raf = requestAnimationFrame(figFrame);
  }
  function figMove(e) {
    if (e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
      figBegin(e);
    }
    const nx = e.clientX, ny = e.clientY + drag.offY;
    drag.moveX = drag.moveX * 0.8 + (nx - drag.x) * 0.2;
    drag.moveY = drag.moveY * 0.8 + (ny - drag.y) * 0.2;
    drag.x = nx; drag.y = ny;
  }
  function figFrame(now) {
    if (!drag.active) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - drag.t) / 1000));
    drag.t = now;
    // Swing: the figure hangs from its head. Sideways speed leans it back, a spring brings it upright.
    const vx = (drag.x - drag.lastX) / dt;
    drag.lastX = drag.x;
    drag.vx = drag.vx * 0.75 + vx * 0.25;
    const target = clamp(drag.vx * 0.045, -38, 38);
    drag.angV += ((target - drag.ang) * 90 - drag.angV * 9) * dt;
    drag.ang += drag.angV * dt;
    dragFig.style.transform = `translate(${drag.x}px, ${drag.y}px) rotate(${drag.ang.toFixed(2)}deg)`;

    // Edge pan, as the real thing does when you carry the figure to the side of the map.
    const r = mapEl.getBoundingClientRect(), edge = 36;
    let px = 0, py = 0;
    if (drag.x < r.left + edge) px = -1; else if (drag.x > r.right - edge) px = 1;
    if (drag.y < r.top + edge) py = -1; else if (drag.y > r.bottom - edge) py = 1;
    if (px || py) { map.panBy([px * 600 * dt, py * 600 * dt], { animate: false }); scheduleViewRoads(); }

    // Where the figure would land: magnet to the nearest road within 28 px.
    let tx = drag.x, ty = drag.y, onRoad = false;
    if (now > drag.checkAt && overMap(drag.x, drag.y)) {
      drag.checkAt = now + 30;
      const ll = map.containerPointToLatLng([drag.x - r.left, drag.y - r.top]);
      const s = map.getZoom() >= ROAD_MIN_ZOOM ? roads.nearest(ll.lat, wrapLon(ll.lng), 28 * metersPerPixel(), headingOfMove()) : null;
      drag.snap = s;
    } else if (!overMap(drag.x, drag.y)) drag.snap = null;
    if (drag.snap) {
      const p = map.latLngToContainerPoint([drag.snap.lat, drag.snap.lon]);
      tx = p.x + r.left; ty = p.y + r.top; onRoad = true;
    }
    dragTarget.style.transform = `translate(${tx}px, ${ty}px)`;
    dragEl.classList.toggle('mu-on-road', onRoad);
    dragEl.classList.toggle('mu-off-map', !overMap(drag.x, drag.y));
    drag.raf = requestAnimationFrame(figFrame);
  }
  let viewRoadsTimer = 0;
  function scheduleViewRoads() { clearTimeout(viewRoadsTimer); viewRoadsTimer = setTimeout(() => roads.viewChanged(), 400); }
  function headingOfMove() {
    if (Math.hypot(drag.moveX, drag.moveY) < 2) return undefined;
    return ((Math.atan2(drag.moveX, -drag.moveY) * 180 / Math.PI) + 360) % 360;
  }
  function overMap(x, y) {
    const hit = document.elementFromPoint(x, y);
    return !!hit && mapEl.contains(hit);
  }
  function figEndListeners() {
    window.removeEventListener('pointermove', figMove);
    window.removeEventListener('pointerup', figUp);
    window.removeEventListener('pointercancel', figCancel);
  }
  function figStop() {
    drag.active = false;
    cancelAnimationFrame(drag.raf);
    dragEl.hidden = true;
    pegBtn.classList.remove('mu-peg-out');
    pickerEl.classList.remove('mu-dragging');
    refreshHint();
    if (!roadsOn) roads.show(false);
  }
  function figCancel() {
    figEndListeners();
    drag.pointerId = null;
    if (drag.started) figStop(); else if (!roadsOn && !pegHover) roads.show(false);
  }
  async function figUp(e) {
    if (e.pointerId !== drag.pointerId) return;
    figEndListeners();
    drag.pointerId = null;
    if (!drag.started) {   // a plain click on the button: say what it does
      if (!roadsOn && !pegHover) roads.show(false);
      toast('Drag the figure onto a road to start driving there');
      return;
    }
    const x = drag.x, y = drag.y, snap = drag.snap, pref = headingOfMove();
    const okSpot = overMap(x, y);
    figStop();
    if (!okSpot) return;
    const r = mapEl.getBoundingClientRect();
    const ll = snap ? L.latLng(snap.lat, snap.lon) : map.containerPointToLatLng([x - r.left, y - r.top]);
    await driveAt(ll.lat, ll.lng, { pref: snap ? snap.heading : pref });
  }
  let pegHover = false;

  // ------------------------------------------------------------------ search
  const search = { timer: 0, ctrl: null, items: [], sel: -1, lastQ: '', lastAt: 0, cache: new Map() };
  function openSugg() { searchEl.classList.add('mu-open'); input.setAttribute('aria-expanded', 'true'); }
  function closeSugg() { searchEl.classList.remove('mu-open'); input.setAttribute('aria-expanded', 'false'); search.sel = -1; }
  function renderSugg(q, done) {
    const items = search.items;
    if (!items.length) {
      suggEl.innerHTML = done && q.trim().length >= 2 ? `<div class="mu-sugg-empty">No places match. Press Enter to search everywhere.</div>` : '';
    } else {
      const ql = q.trim().toLowerCase();
      const mark = (s) => {
        const i = ql ? s.toLowerCase().indexOf(ql) : -1;
        return i < 0 ? esc(s) : esc(s.slice(0, i)) + '<b>' + esc(s.slice(i, i + ql.length)) + '</b>' + esc(s.slice(i + ql.length));
      };
      suggEl.innerHTML = items.map((it, i) => `<div class="mu-sugg-row${i === search.sel ? ' mu-sel' : ''}" role="option" data-i="${i}" aria-selected="${i === search.sel}">
        <span class="mu-sugg-ic">${it.recent ? ICON.history : ICON.pin}</span><span class="mu-sugg-txt"><span class="mu-sugg-main">${mark(it.name)}</span><span class="mu-sugg-sub">${esc(it.sub)}</span></span></div>`).join('');
    }
    if (suggEl.innerHTML) openSugg(); else closeSugg();
  }
  function fromPhoton(f) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || p.country || 'Place';
    const sub = [p.name && p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : '', p.city !== name ? p.city : '', p.state, p.country]
      .filter((v, i, a) => v && a.indexOf(v) === i && v !== name).join(', ');
    const ext = p.extent ? [[p.extent[3], p.extent[0]], [p.extent[1], p.extent[2]]] : null;
    return { name, sub, lat, lon, bounds: ext, kind: (p.osm_value || '').replace(/_/g, ' ') };
  }
  function fromNominatim(r) {
    const parts = (r.display_name || '').split(', ');
    const name = r.name || parts[0] || 'Place';
    const sub = parts.filter((p) => p !== name && !/^[\d\s-]+$/.test(p)).slice(0, 3).join(', ');
    const bb = r.boundingbox ? r.boundingbox.map(Number) : null;
    return { name, sub, lat: +r.lat, lon: +r.lon, bounds: bb ? [[bb[0], bb[2]], [bb[1], bb[3]]] : null, kind: (r.type || '').replace(/_/g, ' ') };
  }
  function parseCoords(q) {
    const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { name: `${fmt(lat)}, ${fmt(lon)}`, sub: 'Coordinates', lat, lon, bounds: null, kind: 'point', zoom: 17 };
  }
  function suggest() {
    const q = input.value;
    clearBtn.hidden = !q;
    clearTimeout(search.timer);
    if (q.trim().length < 2) { if (!q.trim()) showRecent(); else { search.items = []; renderSugg(q); } return; }
    const coords = parseCoords(q);
    if (coords) { search.items = [coords]; search.sel = 0; renderSugg(q); return; }
    const key = q.trim().toLowerCase();
    if (search.cache.has(key)) { search.items = search.cache.get(key); search.sel = -1; renderSugg(q, true); return; }
    // Debounced 400 ms, and never more than one request a second.
    const wait = Math.max(400, search.lastAt + 1000 - Date.now());
    search.timer = setTimeout(async () => {
      if (search.ctrl) search.ctrl.abort();
      const ctrl = search.ctrl = new AbortController();
      search.lastAt = Date.now();
      const c = map.getCenter();
      const lg = (navigator.language || 'en').slice(0, 2);
      const params = new URLSearchParams({ q: q.trim(), limit: '6' });
      if (['en', 'de', 'fr'].includes(lg)) params.set('lang', lg);
      if (map.getZoom() >= 5) { params.set('lat', c.lat.toFixed(3)); params.set('lon', wrapLon(c.lng).toFixed(3)); params.set('zoom', String(Math.round(map.getZoom()))); params.set('location_bias_scale', '0.3'); }
      try {
        const r = await fetch('https://photon.komoot.io/api/?' + params, { signal: ctrl.signal });
        if (!r.ok) throw new Error('photon ' + r.status);
        const j = await r.json();
        const seen = new Set();
        const items = (j.features || []).map(fromPhoton).filter((it) => { const k = it.name + '|' + it.sub; if (seen.has(k)) return false; seen.add(k); return true; });
        search.cache.set(key, items);
        // (a late answer after Enter or a pick must not reopen the list over the place card)
        if (input.value === q && document.activeElement === input) { search.items = items; search.sel = -1; search.ctrl = null; renderSugg(q, true); }
      } catch (e) {
        if (e.name !== 'AbortError') { search.ctrl = null; search.items = []; renderSugg(q, false); }
      } finally { if (search.ctrl === ctrl) search.ctrl = null; }
    }, wait);
  }
  async function runSearch() {
    const q = input.value.trim();
    if (!q) return;
    clearTimeout(search.timer);
    if (search.ctrl) { search.ctrl.abort(); search.ctrl = null; }
    if (search.sel >= 0 && search.items[search.sel]) { choose(search.items[search.sel]); return; }
    const coords = parseCoords(q);
    if (coords) { choose(coords); return; }
    closeSugg();
    pickerEl.classList.add('mu-busy');
    try {
      const j = await nominatim('search', { q, limit: '5', addressdetails: '0' });
      if (j && j.length) choose(fromNominatim(j[0]));
      else if (search.items.length) choose(search.items[0]);
      else toast(`No results for “${q}”`);
    } catch (e) {
      if (search.items.length) choose(search.items[0]);
      else toast('Search is not answering. Try again in a moment.');
    } finally { pickerEl.classList.remove('mu-busy'); }
  }
  const RECENT = 'car_recent';
  function readRecent() {
    try { return (JSON.parse(localStorage.getItem(RECENT) || '[]') || []).filter((r) => r && isFinite(r.lat) && isFinite(r.lon) && r.name); } catch { return []; }
  }
  function pushRecent(it) {
    const list = readRecent().filter((r) => !(r.name === it.name && Math.abs(r.lat - it.lat) < 1e-4));
    list.unshift({ name: it.name, sub: it.sub || '', lat: it.lat, lon: it.lon, bounds: it.bounds || null, kind: it.kind || '', zoom: it.zoom });
    try { localStorage.setItem(RECENT, JSON.stringify(list.slice(0, 6))); } catch {}
  }
  function showRecent() {
    search.items = readRecent().map((r) => ({ ...r, recent: true }));
    search.sel = -1;
    renderSugg('');
  }
  function choose(it) {
    pushRecent(it);
    closeSugg();
    input.value = it.name;
    clearBtn.hidden = false;
    input.blur();
    putPin(it.lat, it.lon);
    if (it.bounds && distM(it.bounds[0][0], it.bounds[0][1], it.bounds[1][0], it.bounds[1][1]) > 150) {
      map.flyToBounds(it.bounds, { maxZoom: 17, duration: 1.4, paddingTopLeft: [innerWidth > 640 ? 420 : 0, 0] });
    } else map.flyTo([it.lat, it.lon], it.zoom || 17, { duration: 1.4 });
    showPlace(it);
  }
  function putPin(lat, lon) {
    if (pinMarker) map.removeLayer(pinMarker);
    pinMarker = L.marker([lat, lon], { icon: L.divIcon({ className: 'mu-pin', html: PIN, iconSize: [27, 43], iconAnchor: [13.5, 42] }), keyboard: false }).addTo(map);
  }

  // The place card under the search box (a bottom sheet on a phone).
  function showPlace(it) {
    placeEl.innerHTML = `<button class="mu-ib mu-place-x" type="button" aria-label="Close">${ICON.close}</button>
      <div class="mu-place-hero">${satImage(it.lat, it.lon, 440, 160, 17)}<span class="mu-card-thumb-dot"></span></div>
      <div class="mu-place-title">${esc(it.name)}</div>
      ${it.kind && !/^(yes|administrative|unclassified|point|residential|primary|secondary|tertiary)$/.test(it.kind) ? `<div class="mu-place-kind">${esc(it.kind[0].toUpperCase() + it.kind.slice(1))}</div>` : ''}
      <div class="mu-place-sub">${esc(it.sub)}</div>
      <div class="mu-actions">
        <button class="mu-act mu-act-primary" type="button" data-a="drive"><span>${ICON.car}</span>Drive here</button>
        <button class="mu-act" type="button" data-a="zoom"><span>${ICON.zoomTo}</span>Zoom in</button>
        <button class="mu-act" type="button" data-a="copy"><span>${ICON.share}</span>Copy</button>
      </div>
      <div class="mu-place-coord">${fmt(it.lat)}, ${fmt(it.lon)}</div>`;
    placeEl.hidden = false;
    if (!it.sub) reverse(it.lat, it.lon).then((r) => {
      const sub = placeEl.querySelector('.mu-place-sub');
      if (sub && placeEl.dataset.at === `${it.lat},${it.lon}`) sub.textContent = [r.title !== it.name ? r.title : '', r.sub].filter(Boolean).join(', ');
    }).catch(() => {});
    placeEl.dataset.at = `${it.lat},${it.lon}`;
    placeEl.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('mu-place-x')) { closePlace(true); return; }
      const a = b.dataset.a;
      if (a === 'drive') driveAt(it.lat, it.lon, { label: it.name, radiusPx: 400 });
      else if (a === 'zoom') map.flyTo([it.lat, it.lon], 18, { duration: 1 });
      else if (a === 'copy') copy(`${fmt(it.lat)}, ${fmt(it.lon)}`);
    };
  }
  function closePlace(clearPin) {
    placeEl.hidden = true;
    if (clearPin && pinMarker) { map.removeLayer(pinMarker); pinMarker = null; input.value = ''; clearBtn.hidden = true; }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied ' + text); } catch { toast(text); }
  }

  // ------------------------------------------------------------------ context menu (right-click, long press)
  let ctxAt = null;
  function onContext(e) {
    if (drag.active) return;
    const ll = e.latlng.wrap();
    ctxAt = ll;
    ctxEl.innerHTML = `<button class="mu-ctx-i mu-ctx-coord" type="button" role="menuitem" data-a="copy">${fmt(ll.lat)}, ${fmt(ll.lng)}</button>
      <button class="mu-ctx-i mu-ctx-strong" type="button" role="menuitem" data-a="drive">Drive here</button>
      <button class="mu-ctx-i" type="button" role="menuitem" data-a="what">What's here?</button>
      <button class="mu-ctx-i" type="button" role="menuitem" data-a="center">Center map here</button>
      <button class="mu-ctx-i" type="button" role="menuitem" data-a="zoom">Zoom in here</button>`;
    ctxEl.hidden = false;
    const pr = pickerEl.getBoundingClientRect(), w = ctxEl.offsetWidth, h = ctxEl.offsetHeight;
    let x = e.containerPoint.x + 2, y = e.containerPoint.y + 2;
    if (x + w > pr.width - 8) x = Math.max(8, x - w - 4);
    if (y + h > pr.height - 8) y = Math.max(8, y - h - 4);
    ctxEl.style.left = x + 'px'; ctxEl.style.top = y + 'px';
  }
  let ctxClosedAt = 0;
  function closeCtx() { ctxEl.hidden = true; }
  ctxEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !ctxAt) return;
    const ll = ctxAt;
    closeCtx();
    const a = b.dataset.a;
    if (a === 'copy') copy(`${fmt(ll.lat)}, ${fmt(ll.lng)}`);
    else if (a === 'drive') driveAt(ll.lat, ll.lng, { radiusPx: 60 });
    else if (a === 'what') showCard(ll.lat, ll.lng, null);
    else if (a === 'center') map.panTo(ll);
    else if (a === 'zoom') map.flyTo(ll, Math.min(map.getZoom() + 2, 21), { duration: 0.8 });
  });

  // ------------------------------------------------------------------ click on a road: the small card
  let cardCtrl = null, cardSpot = null;
  async function onMapClick(e) {
    if (!ctxEl.hidden) { closeCtx(); return; }
    if (Date.now() - ctxClosedAt < 500) return;
    if (searchEl.classList.contains('mu-open')) { closeSugg(); input.blur(); return; }
    if (map.getZoom() < CARD_MIN_ZOOM) { closeCard(); return; }
    const ll = e.latlng.wrap();
    if (!roads.loadedAt(ll.lat, ll.lng)) {
      try { await roads.ensureAround(ll.lat, ll.lng, 150); } catch { closeCard(); return; }
    }
    const s = roads.nearest(ll.lat, ll.lng, 14 * metersPerPixel() + 4);
    if (!s) { closeCard(); return; }
    showCard(s.lat, s.lon, s);
  }
  // A satellite picture of w x h pixels centred on a point, made of Esri tiles at zoom z.
  function satImage(lat, lon, w, h, z) {
    const n = Math.pow(2, z), la = lat * Math.PI / 180;
    const px = (wrapLon(lon) + 180) / 360 * n * 256, py = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n * 256;
    const x0 = Math.floor((px - w / 2) / 256), x1 = Math.floor((px + w / 2) / 256);
    const y0 = Math.floor((py - h / 2) / 256), y1 = Math.floor((py + h / 2) / 256);
    let imgs = '';
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const url = TILES.sat.url.replace('{z}', z).replace('{x}', ((tx % n) + n) % n).replace('{y}', ty);
      imgs += `<img alt="" src="${url}" style="left:${(tx * 256 - px + w / 2).toFixed(1)}px;top:${(ty * 256 - py + h / 2).toFixed(1)}px">`;
    }
    return `<div class="mu-sat" style="width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px">${imgs}</div>`;
  }
  function showCard(lat, lon, snap) {
    cardSpot = { lat, lon, snap };
    if (clickMarker) map.removeLayer(clickMarker);
    clickMarker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#5f6368', fillOpacity: 1, interactive: false }).addTo(map);
    const title = snap && snap.way.name ? snap.way.name : 'Dropped pin';
    cardEl.innerHTML = `<div class="mu-card-thumb">${satImage(lat, lon, 96, 96, 18)}<span class="mu-card-thumb-dot"></span></div>
      <div class="mu-card-body">
        <div class="mu-card-t">${esc(title)}</div>
        <div class="mu-card-s">${snap ? 'Looking up the address' : ''}</div>
        <button class="mu-card-c" type="button" title="Copy coordinates">${fmt(lat)}, ${fmt(lon)}</button>
      </div>
      <button class="mu-act mu-act-primary mu-card-go" type="button"><span>${ICON.car}</span>Drive here</button>
      <button class="mu-ib mu-card-x" type="button" aria-label="Close">${ICON.close}</button>`;
    cardEl.hidden = false;
    if (cardCtrl) cardCtrl.abort();
    const ctrl = cardCtrl = new AbortController();
    reverse(lat, lon, ctrl.signal).then((r) => {
      if (cardSpot && cardSpot.lat === lat && cardSpot.lon === lon) {
        if (r.title) cardEl.querySelector('.mu-card-t').textContent = r.title;
        cardEl.querySelector('.mu-card-s').textContent = r.sub;
        cardSpot.label = r.title;
      }
    }).catch(() => { const s = cardEl.querySelector('.mu-card-s'); if (s && cardSpot && cardSpot.lat === lat) s.textContent = ''; });
  }
  function closeCard() {
    cardEl.hidden = true; cardSpot = null;
    if (cardCtrl) { cardCtrl.abort(); cardCtrl = null; }
    if (clickMarker) { map.removeLayer(clickMarker); clickMarker = null; }
  }
  cardEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !cardSpot) return;
    if (b.classList.contains('mu-card-x')) closeCard();
    else if (b.classList.contains('mu-card-c')) copy(`${fmt(cardSpot.lat)}, ${fmt(cardSpot.lon)}`);
    else if (b.classList.contains('mu-card-go')) {
      const s = cardSpot.snap;
      driveAt(cardSpot.lat, cardSpot.lon, { label: cardSpot.label || (s && s.way.name) || '', pref: s ? s.heading : undefined, radiusPx: 30 });
    }
  });

  // ------------------------------------------------------------------ my location
  function locate() {
    if (!navigator.geolocation) { toast('This browser cannot share your location'); return; }
    $('.mu-locate').classList.add('mu-wait');
    navigator.geolocation.getCurrentPosition((p) => {
      $('.mu-locate').classList.remove('mu-wait');
      $('.mu-locate').classList.add('mu-has');
      const ll = [p.coords.latitude, p.coords.longitude];
      if (meMarker) { map.removeLayer(meMarker); map.removeLayer(meCircle); }
      meCircle = L.circle(ll, { radius: Math.min(p.coords.accuracy || 50, 2000), color: '#4285f4', weight: 1, opacity: 0.35, fillColor: '#4285f4', fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker(ll, { icon: L.divIcon({ className: 'mu-me', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, keyboard: false }).addTo(map);
      map.flyTo(ll, Math.max(map.getZoom(), 16), { duration: 1.2 });
    }, (err) => {
      $('.mu-locate').classList.remove('mu-wait');
      toast(err.code === 1 ? 'Location is off for this site. Turn it on in your browser to use this.' : 'Your location could not be found');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  // ------------------------------------------------------------------ the drawer (menu)
  function openDrawer() { drawer.hidden = false; scrim.hidden = false; requestAnimationFrame(() => { drawer.classList.add('on'); scrim.classList.add('on'); }); syncDrawer(); }
  function closeDrawer() { drawer.classList.remove('on'); scrim.classList.remove('on'); setTimeout(() => { if (!drawer.classList.contains('on')) { drawer.hidden = true; scrim.hidden = true; } }, 200); }
  function syncDrawer() {
    const set = (k, v) => { const b = drawer.querySelector(`[data-k="${k}"]`); if (b) b.classList.toggle('mu-on', v); };
    set('sat', layer === 'sat'); set('labels', labels); set('roads', roadsOn);
    drawer.querySelector('[data-k="labels"]').disabled = layer !== 'sat';
    drawer.querySelector('[data-k="last"]').hidden = !lastCar && !lastDrop;
    drawer.querySelector('.mu-dr-state').textContent = readKey() ? 'On' : 'Off';
  }
  drawer.addEventListener('click', (e) => {
    const b = e.target.closest('.mu-dr-item');
    if (!b) { if (e.target.closest('.mu-drawer-x')) closeDrawer(); return; }
    const k = b.dataset.k;
    if (k === 'sat') setLayer(layer === 'sat' ? 'map' : 'sat');
    else if (k === 'labels') setLabels(!labels);
    else if (k === 'roads') { roadsOn = !roadsOn; roads.show(roadsOn); syncDrawer(); if (roadsOn && map.getZoom() < ROAD_MIN_ZOOM) toast('Zoom in to see the roads you can drive'); }
    else if (k === 'locate') { closeDrawer(); locate(); }
    else if (k === 'last') { closeDrawer(); const p = lastCar || lastDrop; map.flyTo([p.lat, p.lon], 17, { duration: 1.2 }); }
    else if (k === 'gkey') {
      const open = gkeyForm.hidden;
      gkeyForm.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      if (open) { gkeyIn.value = readKey(); gkeyIn.focus(); }
    }
  });
  // Google 3D tiles key, kept in localStorage car_gkey; the world reads it at the next drop.
  const gkeyForm = drawer.querySelector('.mu-gkey'), gkeyIn = drawer.querySelector('.mu-gkey-in');
  function readKey() { try { return localStorage.getItem('car_gkey') || ''; } catch { return ''; } }
  function writeKey(v) {
    v = (v || '').trim();
    try { if (v) localStorage.setItem('car_gkey', v); else localStorage.removeItem('car_gkey'); }
    catch { toast('This browser will not store the key (storage is blocked)'); return; }
    syncDrawer();
    toast(v ? 'Key saved. Your next drop uses Google 3D city.' : 'Key removed. Drops use the open map.');
  }
  gkeyForm.addEventListener('submit', (e) => { e.preventDefault(); writeKey(gkeyIn.value); gkeyIn.blur(); });
  drawer.querySelector('.mu-gkey-clear').addEventListener('click', () => { gkeyIn.value = ''; writeKey(''); });
  for (const t of ['keydown', 'keyup', 'keypress']) gkeyIn.addEventListener(t, (e) => {
    e.stopPropagation();
    if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); gkeyIn.blur(); }
  });
  scrim.addEventListener('click', closeDrawer);

  // ------------------------------------------------------------------ wiring the picker
  input.addEventListener('input', suggest);
  input.addEventListener('focus', () => {
    searchEl.classList.add('mu-focus');
    if (!input.value.trim()) showRecent();
    else if (search.items.length && input.value.trim().length >= 2) renderSugg(input.value);
  });
  input.addEventListener('blur', () => { searchEl.classList.remove('mu-focus'); setTimeout(() => { if (document.activeElement !== input) closeSugg(); }, 150); });
  // Keys typed here are ours: never let them reach the game. Escape only blurs.
  for (const t of ['keydown', 'keyup', 'keypress']) input.addEventListener(t, (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeSugg(); input.blur(); return; }
    if (e.key === 'Enter') { e.preventDefault(); runSearch(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!search.items.length) return;
      e.preventDefault();
      const n = search.items.length;
      search.sel = e.key === 'ArrowDown' ? (search.sel + 1) % n : (search.sel <= 0 ? n - 1 : search.sel - 1);
      renderSugg(input.value);
    }
  });
  suggEl.addEventListener('pointerdown', (e) => e.preventDefault());   // keep focus in the box until the click lands
  suggEl.addEventListener('click', (e) => {
    const row = e.target.closest('.mu-sugg-row');
    if (row) choose(search.items[+row.dataset.i]);
  });
  clearBtn.addEventListener('click', () => { input.value = ''; search.items = []; closeSugg(); clearBtn.hidden = true; closePlace(true); input.focus(); });
  $('.mu-go').addEventListener('click', () => { if (input.value.trim()) runSearch(); else input.focus(); });
  $('.mu-menu-btn').addEventListener('click', openDrawer);
  $('.mu-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.mu-chip');
    if (!b) return;
    const p = PLACES[+b.dataset.i];
    choose({ name: p.label, sub: '', lat: p.lat, lon: p.lon, bounds: null, kind: '', zoom: p.zoom });
  });
  const toggleLayer = () => setLayer(layer === 'sat' ? 'map' : 'sat');
  layersEl.addEventListener('click', toggleLayer);
  layersEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleLayer(); } });
  $('.mu-zin').addEventListener('click', () => map.zoomIn());
  $('.mu-zout').addEventListener('click', () => map.zoomOut());
  $('.mu-locate').addEventListener('click', locate);
  $('.mu-compass').addEventListener('click', (e) => {
    const b = e.currentTarget;
    b.classList.remove('mu-spin'); void b.offsetWidth; b.classList.add('mu-spin');
  });
  pegBtn.addEventListener('pointerdown', figDown);
  pegBtn.addEventListener('pointerenter', () => { pegHover = true; if (mode === 'picker') roads.show(true); });
  pegBtn.addEventListener('pointerleave', () => { pegHover = false; if (!drag.active && drag.pointerId == null && !roadsOn) roads.show(false); });
  pegBtn.addEventListener('click', (e) => e.preventDefault());
  pegBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {   // keyboard: drop at the middle of the map
      e.preventDefault(); e.stopPropagation();
      const c = map.getCenter();
      driveAt(c.lat, c.lng, { radiusPx: 80 });
    }
  });
  on(document, 'keydown', (e) => {
    if (mode !== 'picker' || e.key !== 'Escape' || (e.target && e.target.closest && e.target.closest('input'))) return;
    const busy = drag.active || !ctxEl.hidden || !cardEl.hidden || !drawer.hidden;
    if (drag.active) { figEndListeners(); drag.pointerId = null; figStop(); }
    closeCtx(); closeCard();
    if (!drawer.hidden) closeDrawer();
    if (busy) e.stopPropagation();   // it closed something of ours; the game need not hear it
  });
  on(document, 'pointerdown', (e) => {
    if (mode !== 'picker') return;
    if (!ctxEl.hidden && !ctxEl.contains(e.target)) { closeCtx(); ctxClosedAt = Date.now(); }
  }, { capture: true });
  on(window, 'resize', () => { if (map && mode === 'picker') map.invalidateSize(); });

  // ------------------------------------------------------------------ driving overlay
  let mini = null, miniCar = null, miniZoom = 17, carState = null, carRaf = 0, lastFrameT = 0, disp = null, textAt = 0;
  let geo = { at: null, t: 0, ctrl: null };
  function ensureMini() {
    if (mini) return;
    mini = L.map(miniMapEl, {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, touchZoom: false, tapHold: false, zoomSnap: 0, inertia: false, fadeAnimation: false,
    }).setView([0, 0], 18);
    L.tileLayer(TILES.map.url, { ...TILES.map.opts, updateWhenZooming: false, keepBuffer: 3 }).addTo(mini);
    miniCar = L.marker([0, 0], { icon: L.divIcon({ className: 'mu-car-ic', html: CAR, iconSize: [120, 120], iconAnchor: [60, 60] }), interactive: false, keyboard: false }).addTo(mini);
    const credit = document.createElement('div');
    credit.className = 'mu-mini-credit';
    credit.innerHTML = '© Esri, © OpenStreetMap';
    miniEl.appendChild(credit);
  }
  // Runs every frame while driving. Updates may come only a few times a second, so the car on the minimap is
  // carried on from the last report by its speed and heading, and eased onto it, so it glides.
  function drawCar(now) {
    carRaf = 0;
    if (mode !== 'drive' || !carState) return;
    carRaf = requestAnimationFrame(drawCar);
    // About 30 updates a second is plenty for a small map, and leaves the frame to the game.
    if (lastFrameT && now - lastFrameT < 30) return;
    const dt = lastFrameT ? Math.min(0.25, (now - lastFrameT) / 1000) : 0;
    lastFrameT = now;
    const s = carState, speed = s.speed, h0 = s.heading;
    const age = Math.min(0.6, Math.max(0, (now - s.t) / 1000));
    const hr = h0 * Math.PI / 180, cosLat = Math.max(0.05, Math.cos(s.lat * Math.PI / 180));
    const pLat = s.lat + Math.cos(hr) * speed * age / M_PER_DEG;
    const pLon = s.lon + Math.sin(hr) * speed * age / (M_PER_DEG * cosLat);
    if (!disp || distM(disp.lat, disp.lon, pLat, pLon) > 300) disp = { lat: pLat, lon: pLon, h: h0 };
    const k = 1 - Math.exp(-dt * 9);
    disp.lat += (pLat - disp.lat) * k;
    disp.lon += (pLon - disp.lon) * k;
    disp.h = (disp.h + ((((h0 - disp.h) % 360) + 540) % 360 - 180) * k + 360) % 360;
    const lat = disp.lat, lon = disp.lon, heading = disp.h;
    // The map's zoom follows speed: street level when slow, wider at motorway speed.
    const target = clamp(17 - Math.log2(Math.max(Math.abs(speed), 10) / 10), 14, 17);
    miniZoom += (target - miniZoom) * Math.min(1, dt * 0.9);
    mini.setView([lat, lon], Math.round(miniZoom * 8) / 8, { animate: false });
    miniCar.setLatLng([lat, lon]);
    const inner = miniCar.getElement() && miniCar.getElement().firstElementChild;
    if (inner) inner.style.transform = `rotate(${heading}deg)`;
    if (now - textAt > 250) { textAt = now; addrM.textContent = `Heading ${compassWord(heading)} · ${fmt(lat)}, ${fmt(wrapLon(lon))}`; }
    // The address every few seconds, once the car has moved.
    if (!geo.ctrl && (!geo.at || (Date.now() - geo.t > 4000 && distM(geo.at[0], geo.at[1], lat, lon) > 30))) {
      geo.at = [lat, lon]; geo.t = Date.now();
      const ctrl = geo.ctrl = new AbortController();
      reverse(lat, lon, ctrl.signal).then((r) => {
        if (mode !== 'drive') return;
        addrT.textContent = r.title || (carState && carState.road) || 'Unnamed road';
        addrS.textContent = r.sub;
      }).catch(() => {
        // no answer (offline, refused): say so rather than "Finding the street" for the rest of the drive
        if (mode === 'drive' && !ctrl.signal.aborted && addrT.textContent === 'Finding the street') addrT.textContent = (carState && carState.road) || 'Address not available';
      }).finally(() => { if (geo.ctrl === ctrl) geo.ctrl = null; });
    }
  }
  function updateCar(s) {
    if (mode !== 'drive' || !s || !isFinite(s.lat) || !isFinite(s.lon)) return;
    carState = { lat: +s.lat, lon: +s.lon, heading: +s.heading || 0, speed: +s.speed || 0, road: s.road || '', t: performance.now() };
    lastCar = { lat: carState.lat, lon: carState.lon, heading: carState.heading };
    if (!carRaf) carRaf = requestAnimationFrame(drawCar);
  }
  const keepFocusOut = (e) => e.preventDefault();   // buttons in the drive overlay never take focus (Space is the game's)
  $('.mu-back').addEventListener('pointerdown', keepFocusOut);
  $('.mu-back').addEventListener('click', (e) => { e.currentTarget.blur(); onBack(); });
  miniX.addEventListener('pointerdown', keepFocusOut);
  miniX.addEventListener('click', (e) => { e.stopPropagation(); setMiniBig(!miniEl.classList.contains('mu-big')); });
  miniEl.addEventListener('pointerdown', keepFocusOut);
  miniEl.addEventListener('click', () => { if (touchFirst) setMiniBig(!miniEl.classList.contains('mu-big')); });
  function setMiniBig(v) {
    miniEl.classList.toggle('mu-big', v);
    miniX.innerHTML = v ? ICON.shrink : ICON.expand;
    miniX.setAttribute('aria-label', v ? 'Smaller map' : 'Bigger map');
  }

  function blurOurs() {
    const a = document.activeElement;
    if (a && el.contains(a)) a.blur();
  }

  // ------------------------------------------------------------------ public
  function showPicker(opts = {}) {
    if (mode === 'drive') endDrive();
    mode = 'picker';
    pickerEl.hidden = false;
    ensureMap();
    map.invalidateSize();
    if (opts.layer) setLayer(opts.layer === 'map' ? 'map' : 'sat');
    if (dropMarker) { map.removeLayer(dropMarker); dropMarker = null; }
    if (isFinite(opts.lat) && isFinite(opts.lon)) map.setView([opts.lat, opts.lon], opts.zoom ?? 17, { animate: false });
    else if (lastCar) map.setView([lastCar.lat, lastCar.lon], 17, { animate: false });
    syncThumb(); updateScale(); syncDrawer();
    roads.viewChanged();
  }
  function hidePicker() {
    if (drag.active) { figEndListeners(); figStop(); }
    blurOurs();
    closeCtx(); closeSugg();
    if (map) map.stop();
    pickerEl.hidden = true;
    if (mode === 'picker') mode = 'idle';
  }
  function startDrive({ lat, lon, heading = 0, label } = {}) {
    hidePicker();
    mode = 'drive';
    driveEl.hidden = false;
    ensureMini();
    mini.invalidateSize();
    setMiniBig(false);
    miniZoom = 17; lastFrameT = 0; disp = null; carState = null; textAt = 0;
    geo = { at: null, t: 0, ctrl: null };
    const name = label || (lastDrop && Math.abs(lastDrop.lat - lat) < 1e-4 ? lastDrop.label : '');
    addrT.textContent = name || 'Finding the street';
    addrS.textContent = '';
    if (isFinite(lat) && isFinite(lon)) updateCar({ lat, lon, heading, speed: 0 });
    blurOurs();
  }
  function endDrive() {
    if (geo.ctrl) geo.ctrl.abort();
    if (carRaf) cancelAnimationFrame(carRaf);
    carRaf = 0; carState = null;
    driveEl.hidden = true;
    blurOurs();
    if (mode === 'drive') mode = 'idle';
  }
  function destroy() {
    hidePicker(); endDrive();
    ac.abort();
    clearTimeout(search.timer); clearTimeout(toastTimer); clearTimeout(viewRoadsTimer);
    if (search.ctrl) search.ctrl.abort();
    if (map) map.remove();
    if (thumbMap) thumbMap.remove();
    if (mini) mini.remove();
    el.remove();
    mode = 'dead';
  }

  const api = { showPicker, hidePicker, startDrive, updateCar, endDrive, destroy };
  // For tests: not part of the interface.
  Object.defineProperty(api, '_debug', { value: { get map() { return map; }, get mini() { return mini; }, roads, snapTo, get mode() { return mode; } } });
  return api;
}
