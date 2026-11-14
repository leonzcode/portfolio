/* (W, round 10) Any mountain on Earth: the built-in resorts and a place's id, small enough for the home screen to load
   on every map (wsearch.js) without the rest of the world's code. */

export const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Leonski 2's list, where it puts each (its baked OpenStreetMap answers are in /legacy/leonski2data/<slug>.json)
export const PRESETS = [
  { name: 'Zermatt', sub: 'Matterhorn, Switzerland', lat: 46.0050, lon: 7.7600, id: 'zermatt', region: 'Alps' },
  { name: 'Verbier', sub: 'Valais, Switzerland', lat: 46.0960, lon: 7.2400, id: 'verbier', region: 'Alps' },
  { name: 'Chamonix', sub: 'Grands Montets, France', lat: 45.9620, lon: 6.9490, id: 'chamonix', region: 'Alps' },
  { name: 'Val Thorens', sub: 'Three Valleys, France', lat: 45.2970, lon: 6.5800, id: 'valthorens', region: 'Alps' },
  { name: 'St. Anton', sub: 'Arlberg, Austria', lat: 47.1280, lon: 10.2680, id: 'stanton', region: 'Alps' },
  { name: 'Cortina', sub: 'Dolomites, Italy', lat: 46.5400, lon: 12.1300, id: 'cortina', region: 'Alps' },
  { name: 'Whistler Blackcomb', sub: 'British Columbia, Canada', lat: 50.0585, lon: -122.9480, id: 'whistler', region: 'North America' },
  { name: 'Revelstoke', sub: 'British Columbia, Canada', lat: 50.9580, lon: -118.1630, id: 'revelstoke', region: 'North America' },
  { name: 'Jackson Hole', sub: 'Wyoming, USA', lat: 43.5940, lon: -110.8460, id: 'jackson', region: 'North America' },
  { name: 'Mammoth', sub: 'California, USA', lat: 37.6310, lon: -119.0320, id: 'mammoth', region: 'North America' },
  { name: 'Palisades Tahoe', sub: 'California, USA', lat: 39.1875, lon: -120.2480, id: 'palisades', region: 'North America' },
  { name: 'Kirkwood', sub: 'Lake Tahoe, USA', lat: 38.6847, lon: -120.0654, id: 'kirkwood', region: 'North America' },
  { name: 'Heavenly', sub: 'Lake Tahoe, USA', lat: 38.9400, lon: -119.9350, id: 'heavenly', region: 'North America' },
  { name: 'Northstar', sub: 'Lake Tahoe, USA', lat: 39.2700, lon: -120.1250, id: 'northstar', region: 'North America' },
  { name: 'Diamond Peak', sub: 'Lake Tahoe, Nevada, USA', lat: 39.2600, lon: -119.9210, id: 'diamondpeak', region: 'North America' },
  { name: 'Niseko', sub: 'Hokkaido, Japan', lat: 42.8600, lon: 140.6870, id: 'niseko', region: 'Japan' },
  { name: 'Portillo', sub: 'Andes, Chile', lat: -32.8350, lon: -70.1310, id: 'portillo', region: 'South America' },
].map(p => Object.assign(p, { preset: slug(p.name) }));
export const MAMMOTH = PRESETS.find(p => p.id === 'mammoth');

/* the place's id for the rooms: w_ and the preset's short name, or w_ and the place's grid square (0.01 degree) for a
   searched place (the relay takes 16 letters, digits and underscores). A searched place's origin is that square's corner,
   so everyone who picks it rides in the same frame. */
export function presetOf(place) { return place && place.preset ? PRESETS.find(p => p.preset === place.preset) || null : null; }
export function worldId(place) {
  if (!place) return 'w_none';
  const pre = presetOf(place);
  if (pre) return 'w_' + pre.id;
  const a = Math.round((place.lat + 90) * 100), b = Math.round((place.lon + 180) * 100);
  return 'w_' + a.toString(36) + '_' + b.toString(36);
}
export function originOf(place) {
  const pre = presetOf(place);
  if (pre) return { lat: pre.lat, lon: pre.lon };
  return { lat: Math.round((place.lat + 90) * 100) / 100 - 90, lon: Math.round((place.lon + 180) * 100) / 100 - 180 };
}
// a place as kept in opts.place (only what is needed again)
export function keepPlace(p) {
  const pre = presetOf(p);
  return pre ? { name: pre.name, sub: pre.sub, lat: pre.lat, lon: pre.lon, preset: pre.preset } : { name: String(p.name || 'A mountain').slice(0, 80), sub: String(p.sub || '').slice(0, 120), lat: +p.lat, lon: +p.lon };
}
