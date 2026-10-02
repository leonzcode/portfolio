/* ---------------------------------------------------------------------------
   Leon Kart - cosmetics.

   Everything you can wear, and how the bits that are not geometry are drawn.
   The ids and tiers here are the same list the server keeps (mlhub
   apps/mc/kartprofile.js): the server decides what you have won, this decides
   what it looks like. Anything not in TIERED is free to everybody.

   How fancy a thing is follows how hard it was to win:
     common      a multiplayer race win
     rare        a top ten time trial on a track
     epic        a ranked win
     legendary   the top time on a track, or every third ranked win
   and the legendary ones move: the skins are animated, the auras glow, the
   drivers shine.

   Paint is a shader rather than a texture. The bodies are merged meshes with
   their colours in the vertices and no UVs to hang a picture on, so a skin is
   worked out from where on the car each pixel is, and applied only where the
   vertex colour is the kart's own paint. That puts stripes on a formula car,
   a log and a toaster alike, and costs one material per look.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

export const TIER_NAME = { free: 'Free', common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };
export const TIER_COLOUR = { free: '#8a93a6', common: '#7fbf5a', rare: '#3f8cff', epic: '#a35cff', legendary: '#ffb300' };
export const HOW_TO_WIN = {
  common: 'Win a multiplayer race',
  rare: 'Set a top ten time trial on a track',
  epic: 'Win a ranked battle',
  legendary: 'Set the fastest time trial on a track, or win three ranked battles',
};

/* kind, id, name, tier. The id's prefix is its slot. */
const L = (kind, id, name, tier) => ({ kind, id, name, tier });
export const CATALOG = [
  // kart skins
  L('skin', 'skin_stripes', 'Racing stripes', 'common'),
  L('skin', 'skin_checker', 'Checker', 'common'),
  L('skin', 'skin_dots', 'Polka dots', 'common'),
  L('skin', 'skin_camo', 'Camo', 'common'),
  L('skin', 'skin_flames', 'Flames', 'rare'),
  L('skin', 'skin_zebra', 'Zebra', 'rare'),
  L('skin', 'skin_carbon', 'Carbon fibre', 'rare'),
  L('skin', 'skin_tiger', 'Tiger', 'rare'),
  L('skin', 'skin_galaxy', 'Galaxy', 'epic'),
  L('skin', 'skin_lava', 'Lava', 'epic'),
  L('skin', 'skin_circuit', 'Circuit board', 'epic'),
  L('skin', 'skin_rainbow', 'Rainbow', 'legendary'),
  L('skin', 'skin_gold', 'Solid gold', 'legendary'),
  L('skin', 'skin_aurora', 'Aurora', 'legendary'),
  // themed bodies, all still on four wheels
  L('body', 'body_log', 'Log', 'common'),
  L('body', 'body_boat', 'Boat', 'common'),
  L('body', 'body_pencil', 'Pencil', 'common'),
  L('body', 'body_hotdog', 'Hot dog', 'rare'),
  L('body', 'body_bathtub', 'Bathtub', 'rare'),
  L('body', 'body_toaster', 'Toaster', 'rare'),
  L('body', 'body_house', 'House', 'epic'),
  L('body', 'body_shark', 'Shark', 'epic'),
  L('body', 'body_cake', 'Cake', 'epic'),
  L('body', 'body_rocket', 'Rocket', 'legendary'),
  // hats
  L('hat', 'hat_cap', 'Cap', 'free'),
  L('hat', 'hat_beanie', 'Beanie', 'common'),
  L('hat', 'hat_chef', 'Chef hat', 'common'),
  L('hat', 'hat_cowboy', 'Cowboy hat', 'rare'),
  L('hat', 'hat_party', 'Party hat', 'rare'),
  L('hat', 'hat_headphones', 'Headphones', 'rare'),
  L('hat', 'hat_tophat', 'Top hat', 'epic'),
  L('hat', 'hat_propeller', 'Propeller hat', 'epic'),
  L('hat', 'hat_viking', 'Viking helmet', 'epic'),
  L('hat', 'hat_wizard', 'Wizard hat', 'epic'),
  L('hat', 'hat_crown', 'Crown', 'legendary'),
  L('hat', 'hat_halo', 'Halo', 'legendary'),
  // on the face
  L('face', 'sunglasses', 'Sunglasses', 'free'),
  // gliders, for when a jump throws you high
  L('glider', 'glider_paper', 'Paper plane', 'common'),
  L('glider', 'glider_umbrella', 'Umbrella', 'rare'),
  L('glider', 'glider_parachute', 'Parachute', 'rare'),
  L('glider', 'glider_balloons', 'Balloons', 'epic'),
  L('glider', 'glider_batwings', 'Bat wings', 'epic'),
  L('glider', 'glider_dragon', 'Dragon wings', 'legendary'),
  // bolted on the back
  L('decor', 'decor_cone', 'Traffic cone', 'common'),
  L('decor', 'decor_duck', 'Rubber duck', 'common'),
  L('decor', 'decor_flower', 'Sunflower', 'common'),
  L('decor', 'decor_flag', 'Antenna flag', 'rare'),
  L('decor', 'decor_antlers', 'Antlers', 'rare'),
  L('decor', 'decor_satellite', 'Satellite dish', 'rare'),
  L('decor', 'decor_spoiler', 'Big spoiler', 'epic'),
  L('decor', 'decor_horns', 'Bull horns', 'epic'),
  L('decor', 'decor_fins', 'Tail fins', 'epic'),
  L('decor', 'decor_trophy', 'Trophy', 'legendary'),
  // number plates
  L('plate', 'plate_name', 'Your name plates', 'rare'),
  // a whole different driver
  L('driver', 'driver_robot', 'Robot', 'epic'),
  L('driver', 'driver_alien', 'Alien', 'epic'),
  L('driver', 'driver_golden', 'Golden', 'legendary'),
  L('driver', 'driver_ghost', 'Ghost', 'legendary'),
  // something round the whole car
  L('aura', 'aura_sparkle', 'Sparkles', 'epic'),
  L('aura', 'aura_gold', 'Golden glow', 'legendary'),
  L('aura', 'aura_rainbow', 'Rainbow aura', 'legendary'),
];
/* ---- prizes ----------------------------------------------------------------
   Held for a place (on each track, across all tracks, in ranked) and lost
   with it, or kept for a number of ranked wins. The server decides who holds
   what (mlhub apps/mc/kartprofile.js PLACE_SETS and MILESTONES); these are
   the same ids. `src` groups them on the inventory page and `need` is what it
   takes, in the few words a tile has room for. */
export const MAP_PRIZES = [
  ['meadow', 'Sunfield Loop', ['Sunflower aura', 'Sunfield fields paint', 'Straw farmer hat', 'Sunfield pennant']],
  ['dunes', 'Redrock Dunes', ['Sandstorm aura', 'Sandstone paint', 'Explorer helmet', 'Redrock pennant']],
  ['frost', 'Glacier Pass', ['Snowfall aura', 'Glacier ice paint', 'Trapper hat', 'Glacier pennant']],
  ['neon', 'Neon Mile', ['Neon glow aura', 'Neon grid paint', 'Cyber visor', 'Neon Mile pennant']],
  ['ember', 'Ember Hollow', ['Ember sparks aura', 'Magma rock paint', 'Obsidian horned helm', 'Ember pennant']],
];
const SET_KINDS = [['aura', 'p1', '1st', 'legendary'], ['skin', 'p2', '2nd', 'epic'], ['hat', 'p3', '3rd', 'rare'], ['decor', 't10', 'Top 10', 'common']];
for (const [m, mapName, names] of MAP_PRIZES) {
  const ids = ['aura_' + m, 'skin_' + m, 'hat_' + m, 'decor_' + m + 'flag'];
  SET_KINDS.forEach(([kind, , place, tier], i) =>
    CATALOG.push({ kind, id: ids[i], name: names[i], tier, src: 'map:' + m, srcName: mapName, need: place,
                   how: (place === 'Top 10' ? 'Be in the top 10' : 'Hold ' + place) + ' on ' + mapName + ' (race or time trial)' }));
}
const SETS = [
  ['all', 'All tracks', ['aura_champion', 'skin_chrome', 'hat_laurel', 'decor_laurels'], ['Champion aura', 'Chrome paint', 'Laurel crown', 'Grand Prix laurels'],
   'across all tracks (race or time trial)'],
  ['ranked', 'Ranked', ['aura_rkcrown', 'skin_rkdiamond', 'hat_rkhelm', 'decor_rkshield'], ['Ranked crown aura', 'Diamond plate paint', 'Knight helm', 'Ranked shield'],
   'in ranked'],
];
for (const [src, srcName, ids, names, where] of SETS) {
  SET_KINDS.forEach(([kind, , place, tier], i) =>
    CATALOG.push({ kind, id: ids[i], name: names[i], tier, src, srcName, need: place,
                   how: (place === 'Top 10' ? 'Be in the top 10 ' : 'Hold ' + place + ' ') + where }));
}
export const MILESTONES = [
  [1, 'decor', 'decor_star', 'Star antenna', 'common'], [5, 'hat', 'hat_headband', 'Winner headband', 'common'],
  [10, 'skin', 'skin_bronze', 'Bronze paint', 'rare'], [25, 'glider', 'glider_jet', 'Jet wings', 'rare'],
  [50, 'hat', 'hat_goldhelm', 'Gold racing helmet', 'epic'], [75, 'skin', 'skin_platinum', 'Platinum paint', 'epic'],
  [100, 'aura', 'aura_centurion', 'Centurion aura', 'legendary'], [150, 'glider', 'glider_phoenix', 'Phoenix wings', 'legendary'],
  [200, 'body', 'body_trophy', 'Trophy kart', 'legendary'],
];
for (const [n, kind, id, name, tier] of MILESTONES) {
  CATALOG.push({ kind, id, name, tier, src: 'wins', srcName: 'Ranked wins', need: n + (n === 1 ? ' win' : ' wins'),
                 how: 'Win ' + n + ' ranked ' + (n === 1 ? 'battle' : 'battles') + ' (kept for good)' });
}
// the order the prizes are shown in, a row each
export const PRIZE_ROWS = [
  ...MAP_PRIZES.map(([m, name]) => ({ src: 'map:' + m, name, note: 'Held while you are in the top 10 on this track' })),
  { src: 'all', name: 'All tracks', note: 'Held while you are in the top 10 across every track' },
  { src: 'ranked', name: 'Ranked', note: 'Held while you are in the top 10 of the ranked board' },
  { src: 'wins', name: 'Ranked wins', note: 'Kept for good' },
];

const BY_ID = {};
for (const c of CATALOG) BY_ID[c.id] = c;
export const itemById = id => BY_ID[id] || null;
export const isFree = id => !BY_ID[id] || BY_ID[id].tier === 'free';
export const owns = (inv, id) => !id || isFree(id) || !!(inv && inv[id]);
export const KINDS = [
  { id: 'skin', name: 'Kart skins', slot: ['kart', 'skin'] },
  { id: 'body', name: 'Themed karts', slot: ['kart', 'body'] },
  { id: 'hat', name: 'Hats', slot: ['char', 'hat'] },
  { id: 'face', name: 'Face', slot: ['char', 'face'] },
  { id: 'driver', name: 'Unique drivers', slot: ['char', 'driver'] },
  { id: 'glider', name: 'Gliders', slot: ['kart', 'glider'] },
  { id: 'decor', name: 'Decorations', slot: ['kart', 'decor'] },
  { id: 'plate', name: 'Number plates', slot: ['kart', 'plate'] },
  { id: 'aura', name: 'Auras', slot: ['kart', 'aura'] },
];

/* The character, by default: skin tones to pick from, and colours for the
   shirt and the trousers. */
export const SKIN_TONES = [0xffe0c4, 0xf3c9a0, 0xe0a878, 0xc68650, 0x9a5f38, 0x6e4228, 0x4a2c1c, 0x2f1c12];
export const CLOTH = [0xe8402a, 0xff8a1f, 0xffd233, 0x43d94f, 0x1fb6a6, 0x2b56d6, 0x7a3fb0, 0xff5fa2,
                      0xffffff, 0x9aa3b5, 0x3a3f4a, 0x17223b, 0x6b4a2e, 0x2b3a67];

/* The unique drivers: colours for every part of the character, and a few of
   them change the material too. */
export const DRIVER_STYLE = {
  driver_robot: { skin: 0xc9ced8, shirt: 0x7d8594, pants: 0x4a505c, hair: 0x2a2e36, metal: 0.3 },
  driver_alien: { skin: 0x6fdc5a, shirt: 0x7a3fb0, pants: 0x2b2244, hair: 0x2f8c2a },
  driver_golden: { skin: 0xffcc33, shirt: 0xffd966, pants: 0xe0a800, hair: 0xffe680, metal: 0.35, glow: 0.35 },
  driver_ghost: { skin: 0xf0f4ff, shirt: 0xdfe6ff, pants: 0xc9d3f5, hair: 0xffffff, ghost: 0.55, glow: 0.25 },
};

/* ---- the paint ------------------------------------------------------------
   One uniform clock for every animated skin, ticked by the game loop. */
export const paintClock = { value: 0 };
export function tickCosmetics(t) { paintClock.value = t; }

// pattern number, fed to the shader
const PATTERN = {
  none: 0, grad: 1, skin_stripes: 2, skin_checker: 3, skin_dots: 4, skin_camo: 5, skin_flames: 6,
  skin_zebra: 7, skin_carbon: 8, skin_tiger: 9, skin_galaxy: 10, skin_lava: 11, skin_circuit: 12,
  skin_rainbow: 13, skin_gold: 14, skin_aurora: 15,
  skin_meadow: 16, skin_dunes: 17, skin_frost: 18, skin_neon: 19, skin_ember: 20,
  skin_chrome: 21, skin_rkdiamond: 22, skin_bronze: 23, skin_platinum: 24,
};
const GRAD_AXIS = { front: 0, side: 1, top: 2 };
const PAINT_GLSL = /* glsl */`
uniform vec3 uPaint;
uniform vec3 uPaint2;
uniform vec3 uTrim;
uniform int uPattern;
uniform int uGradAxis;
uniform float uTime;
varying vec3 vObj;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
vec3 paintAt(vec3 p, vec3 base) {
  // the paint's own two colours, the second running along the chosen axis
  float a = uGradAxis == 0 ? clamp(0.5 - p.z * 0.33, 0.0, 1.0) : uGradAxis == 1 ? clamp(0.5 + p.x * 0.7, 0.0, 1.0) : clamp((p.y - 0.25) * 0.9, 0.0, 1.0);
  vec3 c = uPattern == 1 ? mix(base, uPaint2, smoothstep(0.0, 1.0, a)) : base;
  if (uPattern == 2) { float s = step(abs(abs(p.x) - 0.14), 0.07); c = mix(c, uTrim, s); }
  else if (uPattern == 3) { float k = mod(floor(p.x * 3.0) + floor(p.z * 3.0) + floor(p.y * 3.0), 2.0); c = mix(c, vec3(0.92), k); }
  else if (uPattern == 4) { vec3 q = fract(p * 3.2) - 0.5; c = mix(c, uTrim, step(length(q.xz), 0.2)); }
  else if (uPattern == 5) { float n = noise3(p * 2.2) + 0.5 * noise3(p * 4.7); c = n < 0.55 ? c * 0.55 : n < 0.85 ? mix(c, vec3(0.32, 0.38, 0.2), 0.7) : vec3(0.42, 0.33, 0.2); }
  else if (uPattern == 6) { float f = p.z + 0.35 * sin(p.x * 9.0 + p.y * 4.0) + 0.25 * noise3(p * 5.0);
    c = f < -0.6 ? mix(vec3(1.0, 0.85, 0.2), vec3(1.0, 0.3, 0.05), smoothstep(-1.6, -0.6, f)) : c; }
  else if (uPattern == 7) { float s = sin((p.x * 1.5 + p.z) * 9.0 + sin(p.y * 6.0 + p.z * 3.0) * 1.6); c = s > 0.0 ? vec3(0.95) : vec3(0.06); }
  else if (uPattern == 8) { vec3 q = floor(p * 18.0); float k = mod(q.x + q.z + q.y, 2.0); c = mix(vec3(0.07), vec3(0.16), k) + c * 0.12; }
  else if (uPattern == 9) { float s = sin(p.z * 10.0 + sin(p.x * 7.0) * 1.8 + noise3(p * 3.0) * 2.0); c = s > 0.55 ? vec3(0.05) : vec3(1.0, 0.5, 0.08); }
  else if (uPattern == 10) { vec3 q = p * 5.0; float st = step(0.985, hash3(floor(q * 3.0))) * (0.6 + 0.4 * sin(uTime * 3.0 + hash3(floor(q)) * 20.0));
    float neb = noise3(p * 1.6 + uTime * 0.05);
    c = mix(vec3(0.05, 0.02, 0.14), vec3(0.45, 0.12, 0.6), neb) + vec3(0.2, 0.3, 0.9) * pow(noise3(p * 3.1), 3.0) + st; }
  else if (uPattern == 11) { float n = noise3(p * 3.0 + vec3(0.0, 0.0, uTime * 0.25)); float crack = smoothstep(0.08, 0.0, abs(n - 0.5));
    c = mix(vec3(0.12, 0.08, 0.07), vec3(1.0, 0.45, 0.05) * (1.2 + 0.3 * sin(uTime * 4.0)), crack); }
  else if (uPattern == 12) { vec3 q = fract(p * 4.0); float line = step(q.x, 0.07) + step(q.z, 0.07); float pad = step(length(q.xz - 0.5), 0.1);
    c = mix(vec3(0.03, 0.25, 0.12), vec3(0.95, 0.75, 0.25), clamp(line * step(0.5, hash3(floor(p * 4.0))) + pad, 0.0, 1.0)); }
  else if (uPattern == 13) { c = hue(fract(p.z * 0.22 + p.y * 0.1 + uTime * 0.25)) * 0.95 + 0.05; }
  else if (uPattern == 14) { float sh = 0.75 + 0.35 * sin(p.z * 4.0 + p.y * 6.0 - uTime * 2.0); c = vec3(1.0, 0.76, 0.2) * sh; }
  else if (uPattern == 15) { float w = sin(p.z * 2.0 + uTime * 0.9 + sin(p.x * 3.0 + uTime * 0.6)); c = mix(vec3(0.1, 0.9, 0.55), vec3(0.55, 0.2, 0.95), 0.5 + 0.5 * w) * (0.8 + 0.3 * noise3(p * 2.0 + uTime * 0.2)); }
  // Sunfield: rows of field, green and gold, with a sunflower here and there
  else if (uPattern == 16) { float row = fract(p.z * 1.4 + sin(p.x * 2.5) * 0.15);
    c = mix(vec3(0.22, 0.62, 0.2), vec3(0.95, 0.78, 0.2), step(0.55, row));
    vec3 q = fract(p * 2.6) - 0.5; float fl = step(length(q.xz), 0.16) * step(0.72, hash3(floor(p * 2.6)));
    c = mix(c, vec3(1.0, 0.85, 0.1), fl); c = mix(c, vec3(0.35, 0.2, 0.08), fl * step(length(q.xz), 0.07)); }
  // Redrock: sandstone in layers
  else if (uPattern == 17) { float band = p.y * 5.0 + noise3(p * 1.7) * 1.4 + sin(p.z * 1.3) * 0.4;
    float k = fract(band); c = k < 0.33 ? vec3(0.78, 0.36, 0.18) : k < 0.66 ? vec3(0.93, 0.62, 0.36) : vec3(0.98, 0.86, 0.66); }
  // Glacier: cracked ice, a glint running along it
  else if (uPattern == 18) { float n = noise3(p * 3.4); float crack = smoothstep(0.06, 0.0, abs(n - 0.5));
    float glint = pow(max(0.0, sin(p.z * 1.5 - uTime * 1.6)), 18.0);
    c = mix(vec3(0.72, 0.88, 0.98), vec3(0.95, 0.99, 1.0), noise3(p * 1.3)) - crack * vec3(0.3, 0.18, 0.05) + glint * 0.6; }
  // Neon Mile: black with a pink and cyan grid that pulses
  else if (uPattern == 19) { vec3 q = fract(p * 3.0); float lx = step(q.x, 0.06), lz = step(q.z, 0.06), ly = step(q.y, 0.06);
    float pulse = 0.7 + 0.3 * sin(uTime * 3.0 + p.z * 2.0);
    c = vec3(0.04, 0.03, 0.08) + (lx + ly) * vec3(1.0, 0.2, 0.75) * pulse + lz * vec3(0.1, 0.95, 1.0) * pulse; }
  // Ember Hollow: obsidian with glowing seams and embers
  else if (uPattern == 20) { float n = noise3(p * 2.4 + vec3(0.0, uTime * 0.12, 0.0)); float seam = smoothstep(0.05, 0.0, abs(n - 0.5));
    float ember = step(0.97, hash3(floor(p * 9.0 + vec3(0.0, floor(uTime * 2.0), 0.0))));
    c = vec3(0.07, 0.05, 0.06) + seam * vec3(1.0, 0.42, 0.06) * (1.1 + 0.4 * sin(uTime * 3.0)) + ember * vec3(1.0, 0.7, 0.2); }
  // chrome: a bright mirror with light sweeping along it
  else if (uPattern == 21) { float s = 0.55 + 0.45 * sin(p.y * 7.0 + p.z * 1.5 - uTime * 2.2); c = mix(vec3(0.62, 0.66, 0.72), vec3(1.0), s * s); }
  // ranked diamond plate in purple, catching the light
  else if (uPattern == 22) { vec2 q = fract(vec2(p.x + p.z, p.x - p.z) * 3.0) - 0.5; float d = step(abs(q.x) + abs(q.y), 0.22);
    float glint = pow(max(0.0, sin((p.x + p.z) * 2.0 - uTime * 2.5)), 12.0);
    c = mix(vec3(0.28, 0.12, 0.48), vec3(0.62, 0.4, 0.9), d) + glint * vec3(0.9, 0.8, 1.0); }
  // bronze, brushed
  else if (uPattern == 23) { float streak = noise3(vec3(p.x * 40.0, p.y * 2.0, p.z * 2.0)); c = vec3(0.72, 0.45, 0.2) * (0.8 + 0.35 * streak); }
  // platinum, with sparkles
  else if (uPattern == 24) { float sp = step(0.985, hash3(floor(p * 14.0))) * (0.5 + 0.5 * sin(uTime * 5.0 + hash3(floor(p * 14.0)) * 30.0));
    c = vec3(0.86, 0.88, 0.92) * (0.85 + 0.2 * sin(p.z * 2.0 - uTime)) + sp; }
  return c;
}
`;
const cache = new Map();
/* The material for a car, given the racer's two colours and the look. Null
   means the plain shared material will do. `paint` is the colour the body's
   bodywork was merged with: only pixels whose vertex colour has the same hue
   (and roughly the same brightness, which kit bodies vary) are repainted. */
export function paintMaterial(base, paint, trim, kart) {
  const skin = kart && kart.skin && PATTERN[kart.skin] ? kart.skin : null;
  const grad = kart && kart.paint2 !== undefined && kart.paint2 !== null && kart.grad && kart.grad !== 'none';
  if (!skin && !grad) return null;
  const pattern = skin ? PATTERN[skin] : PATTERN.grad;
  const key = [pattern, paint, trim, grad ? kart.paint2 : -1, grad ? kart.grad : ''].join('|');
  if (cache.has(key)) return cache.get(key);
  const m = base.clone();
  m.userData.paintKey = key;
  if (skin === 'skin_gold') { m.metalness = 0.85; m.roughness = 0.28; }
  if (skin === 'skin_carbon') { m.roughness = 0.35; }
  if (skin === 'skin_chrome') { m.metalness = 0.9; m.roughness = 0.12; }
  if (skin === 'skin_bronze') { m.metalness = 0.7; m.roughness = 0.35; }
  if (skin === 'skin_platinum') { m.metalness = 0.8; m.roughness = 0.2; }
  if (skin === 'skin_rkdiamond' || skin === 'skin_frost') { m.metalness = 0.4; m.roughness = 0.25; }
  const U = {
    uPaint: { value: new THREE.Color(paint) },
    uPaint2: { value: new THREE.Color(grad ? kart.paint2 : paint) },
    uTrim: { value: new THREE.Color(trim) },
    uPattern: { value: pattern },
    uGradAxis: { value: GRAD_AXIS[grad ? kart.grad : 'front'] || 0 },
    uTime: paintClock,
  };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
    sh.fragmentShader = PAINT_GLSL + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  // the kart's own paint, matched by hue so a shaded panel still counts
  vec3 vc = vColor.rgb + 1e-4, pc = uPaint + 1e-4;
  float hueOk = 1.0 - smoothstep(0.03, 0.09, distance(normalize(vc), normalize(pc)));
  float lum = dot(vc, vec3(0.3333)) / max(1e-4, dot(pc, vec3(0.3333)));
  float isPaint = hueOk * step(0.55, lum) * step(lum, 1.45);
  vec3 shade = vColor.rgb / max(pc, vec3(1e-3));
  float k = clamp(dot(shade, vec3(0.3333)), 0.5, 1.4);
  diffuseColor.rgb = mix(diffuseColor.rgb, paintAt(vObj, uPaint) * k, isPaint);
}`);
  };
  m.customProgramCacheKey = () => 'leonkart-paint';
  cache.set(key, m);
  return m;
}

/* ---- auras ----------------------------------------------------------------
   Points round the car that drift and twinkle. One small point cloud a car,
   moved in a vertex shader so it costs nothing on the CPU. */
const AURA = {
  aura_sparkle: { n: 26, size: 0.32, colours: [0xffffff, 0xfff1a8, 0xbfe6ff], radius: 1.7, rise: 1.2 },
  aura_gold: { n: 46, size: 0.5, colours: [0xffd233, 0xffb300, 0xfff6c8], radius: 2.1, rise: 1.8, ring: true },
  aura_rainbow: { n: 60, size: 0.5, colours: [0xff4d4d, 0xffa64d, 0xffff4d, 0x4dff88, 0x4db8ff, 0xb84dff], radius: 2.3, rise: 2.0, ring: true },
  // the tracks' own, for 1st on one
  aura_meadow: { n: 40, size: 0.5, colours: [0xffd233, 0x8bdc4a, 0xfff1a8, 0xff8fb0], radius: 2.0, rise: 1.5, ring: true },
  aura_dunes: { n: 44, size: 0.45, colours: [0xe58a3a, 0xf4c27a, 0xffe2b0], radius: 2.1, rise: 1.0, ring: true },
  aura_frost: { n: 44, size: 0.45, colours: [0xffffff, 0xbfe6ff, 0x8fd3ff], radius: 2.0, rise: 1.8, ring: true },
  aura_neon: { n: 44, size: 0.5, colours: [0xff3fb4, 0x2ef2ff, 0xb84dff], radius: 2.1, rise: 1.6, ring: true },
  aura_ember: { n: 50, size: 0.45, colours: [0xff6a00, 0xffb000, 0xff2a00], radius: 1.9, rise: 2.6, ring: true },
  // across all tracks, in ranked, and a hundred wins: the biggest there are
  aura_champion: { n: 80, size: 0.62, colours: [0xffd233, 0xffffff, 0xffb300, 0xfff1a8], radius: 2.7, rise: 2.6, ring: true },
  aura_rkcrown: { n: 66, size: 0.56, colours: [0xa35cff, 0xffd233, 0xe0c8ff], radius: 2.5, rise: 2.2, ring: true },
  aura_centurion: { n: 70, size: 0.58, colours: [0xff3b30, 0xffd233, 0xffffff], radius: 2.6, rise: 2.4, ring: true },
};
export function makeAura(id) {
  const A = AURA[id];
  if (!A) return null;
  const pos = new Float32Array(A.n * 3), col = new Float32Array(A.n * 3), seed = new Float32Array(A.n);
  const c = new THREE.Color();
  for (let i = 0; i < A.n; i++) {
    const a = (i / A.n) * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * A.radius; pos[i * 3 + 1] = 0.2 + (i % 5) * 0.25; pos[i * 3 + 2] = Math.sin(a) * A.radius * 1.3;
    c.setHex(A.colours[i % A.colours.length]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: paintClock, uSize: { value: A.size * 60 }, uRise: { value: A.rise } },
    vertexShader: `attribute float seed; varying vec3 vC; varying float vA; uniform float uTime; uniform float uSize; uniform float uRise;
      void main() {
        vC = color;
        float t = fract(seed + uTime * (0.25 + seed * 0.2));
        vec3 p = position;
        float a = uTime * (0.6 + seed) + seed * 6.283;
        p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz * (0.85 + 0.15 * sin(uTime * 2.0 + seed * 9.0));
        p.y += t * uRise;
        vA = sin(t * 3.14159) * (0.6 + 0.4 * sin(uTime * 7.0 + seed * 30.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (0.6 + seed) / max(1.0, -mv.z) * 6.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main() { vec2 q = gl_PointCoord - 0.5; float d = length(q); if (d > 0.5) discard;
        float star = max(1.0 - d * 2.0, 0.0); gl_FragColor = vec4(vC * (1.0 + star), vA * star); }`,
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  pts.name = 'aura';
  if (A.ring) {
    // and a glowing ring on the road under it, for the ones worth showing off
    const ring = new THREE.Mesh(new THREE.RingGeometry(A.radius * 0.8, A.radius * 1.05, 40),
      new THREE.MeshBasicMaterial({ color: A.colours[0], transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.name = 'auraRing';
    pts.add(ring);
  }
  return pts;
}

/* The whole look, in one tidy object, from whatever the profile or the page
   has: missing pieces become the defaults. */
export function normaliseStyle(s) {
  const o = s || {};
  const ch = o.char || {}, k = o.kart || {};
  return {
    char: { skin: num(ch.skin), shirt: num(ch.shirt), pants: num(ch.pants), hat: str(ch.hat), face: str(ch.face), driver: str(ch.driver) },
    kart: { paint: num(k.paint), paint2: num(k.paint2), grad: str(k.grad) || 'none', skin: str(k.skin), body: str(k.body),
            decor: str(k.decor), glider: str(k.glider), plate: str(k.plate), aura: str(k.aura) },
    name: str(o.name),
  };
}
function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function str(v) { return typeof v === 'string' && v ? v : null; }
// a short key that changes whenever anything visible about the look does
export function styleKey(s) { return JSON.stringify(s || null); }
