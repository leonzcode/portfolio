/* ---------------------------------------------------------------------------
   Leoncraft 2 - banner patterns: what they are called and what they look like.

   The game's patterns (Minecraft Wiki, Banner/Patterns, Java Edition): a
   banner carries up to six layers, each a pattern in one of the sixteen dye
   colours, the last one added on top. A banner stack keeps them in
   `patterns`: [[pattern, colour], ...]. The loom adds them (ui/loom.js); the
   tooltip lists them ("Red Chief", "Lime Creeper Charge").

   The pictures are drawn here, our own: each pattern is a mask over the
   banner's 20 x 40 face, from a rule (stripes, halves, triangles, a
   roundel, a gradient...) or a small picture of our own (the charges: a
   creeper's face, a skull, a flower, a globe...). Ten need a banner pattern
   item in the loom; the rest need only a dye.
--------------------------------------------------------------------------- */
import { ITEMS, I } from './items.js?v=107';
import { dyeColour } from './crafting.js?v=107';

export const FW = 20, FH = 40;
export const COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const title = s => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
// pattern -> its name in the game
export const PATTERN_NAMES = {
  base: 'Field', stripe_bottom: 'Base', stripe_top: 'Chief', stripe_left: 'Pale Dexter', stripe_right: 'Pale Sinister', stripe_center: 'Pale', stripe_middle: 'Fess',
  stripe_downright: 'Bend', stripe_downleft: 'Bend Sinister', small_stripes: 'Paly', cross: 'Saltire', straight_cross: 'Cross', diagonal_left: 'Per Bend Sinister',
  diagonal_right: 'Per Bend', diagonal_up_left: 'Per Bend Inverted', diagonal_up_right: 'Per Bend Sinister Inverted', half_vertical: 'Per Pale',
  half_vertical_right: 'Per Pale Inverted', half_horizontal: 'Per Fess', half_horizontal_bottom: 'Per Fess Inverted', square_bottom_left: 'Base Dexter Canton',
  square_bottom_right: 'Base Sinister Canton', square_top_left: 'Chief Dexter Canton', square_top_right: 'Chief Sinister Canton', triangle_bottom: 'Chevron',
  triangle_top: 'Inverted Chevron', triangles_bottom: 'Base Indented', triangles_top: 'Chief Indented', circle: 'Roundel', rhombus: 'Lozenge', border: 'Bordure',
  curly_border: 'Bordure Indented', bricks: 'Field Masoned', gradient: 'Gradient', gradient_up: 'Base Gradient', creeper: 'Creeper Charge', skull: 'Skull Charge',
  flower: 'Flower Charge', mojang: 'Thing', globe: 'Globe', piglin: 'Snout', flow: 'Flow', guster: 'Guster',
};
// the banner pattern items and the pattern each gives
export const PATTERN_ITEMS = { flower_banner_pattern: 'flower', creeper_banner_pattern: 'creeper', skull_banner_pattern: 'skull', mojang_banner_pattern: 'mojang',
  globe_banner_pattern: 'globe', piglin_banner_pattern: 'piglin', flow_banner_pattern: 'flow', guster_banner_pattern: 'guster',
  field_masoned_banner_pattern: 'bricks', bordure_indented_banner_pattern: 'curly_border' };
const NEEDS_ITEM = new Set(Object.values(PATTERN_ITEMS));
// the loom's list with no pattern item, in the game's order
export const LOOM_PATTERNS = Object.keys(PATTERN_NAMES).filter(p => p !== 'base' && !NEEDS_ITEM.has(p));
export const MAX_LAYERS = 6;

export const isBanner = st => !!st && !!ITEMS[st.id] && /_banner$/.test(ITEMS[st.id].name) && !/_pattern$/.test(ITEMS[st.id].name);
export const bannerColour = st => { const n = ITEMS[st.id].name.replace(/_banner$/, ''); return COLOURS.indexOf(n) >= 0 ? n : 'white'; };
export const isDye = st => !!st && !!ITEMS[st.id] && /_dye$/.test(ITEMS[st.id].name) && COLOURS.indexOf(ITEMS[st.id].name.replace(/_dye$/, '')) >= 0;
export const dyeOf = st => ITEMS[st.id].name.replace(/_dye$/, '');
export const patternOfItem = st => (st && ITEMS[st.id] ? PATTERN_ITEMS[ITEMS[st.id].name] || null : null);
// a banner's tooltip lines: each layer, the first six
export function patternLines(st) {
  return (st.patterns || []).slice(0, 6).map(([p, c]) => '§7' + title(c) + ' ' + (PATTERN_NAMES[p] || title(p)));
}

/* ---- the masks: 0..1 for each pixel of the 20 x 40 face ---- */
const cx = (FW - 1) / 2, cy = (FH - 1) / 2;
// small pictures, centred on the face (# full, + half)
const PICS = {
  creeper: ['..####....####..', '..####....####..', '..####....####..', '..####....####..', '......####......', '......####......', '....########....', '....########....', '....########....', '....##....##....', '....##....##....'],
  skull: ['.....######.....', '....########....', '...##########...', '...##..##..##...', '...##..##..##...', '...##########...', '....###..###....', '.....######.....', '.....#.##.#.....', '.##..........##.', '...##......##...', '.....##..##.....', '.......##.......', '.....##..##.....', '...##......##...', '.##..........##.'],
  flower: ['......####......', '.....######.....', '..##..####..##..', '.####..##..####.', '.#####....#####.', '..####.##.####..', '......####......', '......####......', '..####.##.####..', '.#####....#####.', '.####..##..####.', '..##..####..##..', '.....######.....', '......####......'],
  mojang: ['......####......', '....##....##....', '...#..####..#...', '..#..#....#..#..', '..#.#..##..#.#..', '.#..#.####.#..#.', '.#..#.####.#..#.', '..#.#..##..#.#..', '..#..#....#..#..', '...#..####..#...', '....##....##....', '......####......'],
  globe: ['.....######.....', '...##++++++##...', '..#++###+++++#..', '.#+++####++++##.', '.#++++###+++###.', '#+++++##++++++##', '#++++++++##++++#', '#+++++++####+++#', '#++###++####+++#', '.#+####+++##++#.', '.#++###+++++++#.', '..#++##++++++#..', '...##++++++##...', '.....######.....'],
  piglin: ['................', '...##########...', '..############..', '.##############.', '.###..####..###.', '.###..####..###.', '.##############.', '..############..', '...##########...'],
  flow: ['...#########....', '..#.........#...', '.#..#######..#..', '.#.#.......#.#..', '.#.#..###..#.#..', '.#.#.#...#.#.#..', '.#.#.#.#.#.#.#..', '.#.#.#..##.#.#..', '.#.#..#....#.#..', '.#..#..####..#..', '..#..#......#...', '...#..######....', '....#...........', '.....######.....'],
  guster: ['....########....', '..##........##..', '.#..######....#.', '#..#......#...#.', '#.#..####..#..#.', '#.#.#....#.#..#.', '#.#.#.##.#.#..#.', '#.#..#..#..#.#..', '#..#..##..#..#..', '.#..##..##..#...', '..##......##....', '....######......'],
};
function picMask(rows) {
  const h = rows.length, w = rows[0].length, ox = Math.floor((FW - w) / 2), oy = Math.floor((FH - h) / 2) - 2;
  return (x, y) => { const r = rows[y - oy]; if (!r) return 0; const ch = r[x - ox]; return ch === '#' ? 1 : ch === '+' ? 0.45 : 0; };
}
const tooth = (x, w) => { const k = x % w; return Math.min(k, w - 1 - k); };
const RULES = {
  base: () => 1,
  stripe_bottom: (x, y) => y >= 27, stripe_top: (x, y) => y < 13, stripe_left: x => x < 6, stripe_right: x => x >= 14, stripe_center: x => x >= 8 && x < 12,
  stripe_middle: (x, y) => y >= 17 && y < 23,
  stripe_downright: (x, y) => Math.abs(x / FW - y / FH) < 0.13, stripe_downleft: (x, y) => Math.abs((FW - 1 - x) / FW - y / FH) < 0.13,
  small_stripes: x => x % 4 < 2,
  cross: (x, y) => Math.abs(x / FW - y / FH) < 0.1 || Math.abs((FW - 1 - x) / FW - y / FH) < 0.1,
  straight_cross: (x, y) => (x >= 8 && x < 12) || (y >= 18 && y < 22),
  diagonal_left: (x, y) => (x + 0.5) / FW + (y + 0.5) / FH < 1, diagonal_up_right: (x, y) => (x + 0.5) / FW + (y + 0.5) / FH >= 1,
  diagonal_right: (x, y) => (x + 0.5) / FW >= (y + 0.5) / FH, diagonal_up_left: (x, y) => (x + 0.5) / FW < (y + 0.5) / FH,
  half_vertical: x => x < 10, half_vertical_right: x => x >= 10, half_horizontal: (x, y) => y < 20, half_horizontal_bottom: (x, y) => y >= 20,
  square_bottom_left: (x, y) => x < 7 && y >= 27, square_bottom_right: (x, y) => x >= 13 && y >= 27,
  square_top_left: (x, y) => x < 7 && y < 13, square_top_right: (x, y) => x >= 13 && y < 13,
  triangle_bottom: (x, y) => y >= FH - 1 - (10 - Math.abs(x - cx)), triangle_top: (x, y) => y <= 10 - Math.abs(x - cx),
  triangles_bottom: (x, y) => y >= FH - 4 + tooth(x, 5) - 1 || y >= FH - 1, triangles_top: (x, y) => y <= 3 - tooth(x, 5) || y < 1,
  circle: (x, y) => (x - cx) ** 2 + ((y - cy) * 1) ** 2 <= 30,
  rhombus: (x, y) => Math.abs(x - cx) / 7 + Math.abs(y - cy) / 11 <= 1,
  border: (x, y) => x < 2 || x >= FW - 2 || y < 2 || y >= FH - 2,
  curly_border: (x, y) => { const d = Math.min(x, FW - 1 - x, y, FH - 1 - y), along = x < 3 || x >= FW - 3 ? y : x; return d < 1 + (along % 4 < 2 ? 2 : 1); },
  bricks: (x, y) => y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 3) % 6 === 0,
  gradient: (x, y) => Math.max(0, 1 - y / (FH - 1)), gradient_up: (x, y) => Math.max(0, y / (FH - 1)),
};
for (const k in PICS) RULES[k] = picMask(PICS[k]);
const MASKS = {};
export function mask(p) {
  if (MASKS[p]) return MASKS[p];
  const f = RULES[p] || RULES.base, m = new Float32Array(FW * FH);
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) m[y * FW + x] = +f(x, y) || 0;
  return (MASKS[p] = m);
}

/* ---- the picture: the face's colours, the cloth's grain over them ---- */
const GRAIN = new Float32Array(FW * FH);
for (let i = 0; i < GRAIN.length; i++) { const h = Math.imul(i + 7, 2654435761) >>> 0; GRAIN[i] = 0.9 + ((h >>> 24) / 255) * 0.1 - ((i % FW === 0 || i % FW === FW - 1) ? 0.05 : 0); }
// [r, g, b] for each pixel of a banner of this base colour with these layers
export function faceRGB(base, layers) {
  const out = new Float32Array(FW * FH * 3);
  const c0 = dyeColour(base);
  for (let i = 0; i < FW * FH; i++) { out[i * 3] = (c0 >> 16) & 255; out[i * 3 + 1] = (c0 >> 8) & 255; out[i * 3 + 2] = c0 & 255; }
  for (const [p, col] of layers || []) {
    const m = mask(p), c = dyeColour(col) || 0xffffff, r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    for (let i = 0; i < FW * FH; i++) {
      const a = m[i];
      if (!a) continue;
      out[i * 3] += (r - out[i * 3]) * a; out[i * 3 + 1] += (g - out[i * 3 + 1]) * a; out[i * 3 + 2] += (b - out[i * 3 + 2]) * a;
    }
  }
  return out;
}
// drawn on a 2D context at (x, y), each face pixel s x s (or into w x h)
const canvases = new Map();
export function drawFace(ctx, base, layers, x, y, s = 1, w, h) {
  const key = base + '|' + JSON.stringify(layers || []);
  let c = canvases.get(key);
  if (!c) {
    if (canvases.size > 256) canvases.clear();
    c = document.createElement('canvas'); c.width = FW; c.height = FH;
    const g = c.getContext('2d'), img = g.createImageData(FW, FH), rgb = faceRGB(base, layers);
    for (let i = 0; i < FW * FH; i++) { const k = GRAIN[i]; img.data[i * 4] = rgb[i * 3] * k; img.data[i * 4 + 1] = rgb[i * 3 + 1] * k; img.data[i * 4 + 2] = rgb[i * 3 + 2] * k; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    canvases.set(key, c);
  }
  ctx.drawImage(c, 0, 0, FW, FH, x, y, w || FW * s, h || FH * s);
}
// a banner with patterns as an inventory picture: the bar, and the face hanging from it
export function drawBannerIcon(g, st, x, y) {
  const ctx = g.ctx;
  g.fill(x + 3, y + 0, x + 13, y + 1, 0xFF6B4A2A);
  drawFace(ctx, bannerColour(st), st.patterns, x + 4, y + 1, 1, 8, 15);
  g.fill(x + 4, y + 1, x + 12, y + 2, 0x30000000);
}
export const bannerItem = col => I[col + '_banner'];
