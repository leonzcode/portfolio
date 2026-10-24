/* ---------------------------------------------------------------------------
   Leoncraft 2 - blocks whose look follows their state.

   Read by the mesher in the workers and by the game. A block keeps its state
   in the world's meta byte; this module says how each state is drawn (a
   wheat stage, a lit lamp, the colour of dust at each power level) and how
   much light it gives, and adds the models redstone needs (repeaters and
   comparators with their little torches, levers, pressed buttons and plates,
   dust that joins up the way the game's does, piston heads).

   The meta layouts (the game's block states, packed):
     crops, stems, berries, wart   bits 0-2 age
     cocoa                         bits 0-2 the face it hangs on, bits 3-4 age
     cave vines                    bit 0 glow berries; the tip bits 1-5 age (it grows while under 25)
     shelf mushroom                bits 0-2 the face it hangs on (as a button's), bit 3 large
     farmland                      bits 0-2 moisture
     leaves                        bit 7 persistent (put there by a player: never decays)
     saplings                      bit 0 stage
     sugar cane, cactus            bits 0-3 age;  kelp bits 0-4 age
     redstone_wire                 bits 0-3 power, bit 4 a dot (no sides)
     redstone torch                bit 3 unlit (wall torch: bits 0-2 its wall)
     repeater                      bits 0-1 the way it outputs, bits 2-3 delay - 1, bit 4 powered, bit 5 locked
     comparator                    bits 0-1 output, bit 2 subtract, bit 3 powered
     lever, buttons                bits 0-2 the face it is on, bit 3 powered; on a floor or a ceiling
                                   bits 4-5 the way it faces
     pressure plates               bit 0 pressed; weighted ones bits 0-3 power
     redstone_lamp                 bit 0 lit
     furnace, smoker, blast furnace bits 0-1 facing, bit 2 lit (burning: containers.js showLit)
     piston, sticky piston         bits 0-2 facing, bit 3 extended;  piston_head bits 0-2 facing, bit 3 sticky
     observer                      bits 0-2 facing (where it looks), bit 3 powered
     dispenser, dropper            bits 0-2 facing, bit 3 triggered
     note_block                    bits 0-4 the note, bit 5 powered
     daylight_detector             bits 0-3 power, bit 4 inverted
     target                        bits 0-3 power
     rails                         bit 3 powered (powered, detector and activator rails)
     doors, trapdoors              bit 5 powered;  fence gates bit 3 powered
     respawn_anchor                bits 0-2 charges
     fire                          bits 0-3 age
     bed                           bit 2 occupied (as well as facing and the head bit)
     hopper                        bits 0-2 facing, bit 3 locked (powered)
     lightning rod                 bits 0-2 facing, bit 3 powered
     redstone ore                  bit 0 lit;  copper bulb bit 0 lit, bit 1 powered
     bell                          bit 0 hanging, bit 4 powered
     sculk sensors                 bits 0-1 phase (0 waiting, 1 active, 2 cooling down), bits 2-3 facing
                                   (calibrated), bits 4-7 the power it gives while active
     sculk shrieker                bit 0 shrieking, bit 1 can summon a warden
     chiseled bookshelf            bits 0-1 facing, bits 2-7 which of its six slots hold a book
     lectern                       bits 0-1 facing, bit 2 holds a book, bit 3 powered
     vault                         bits 0-1 facing, bit 3 ominous, bits 4-5 waiting, active (someone near
                                   it may unlock it), unlocking, throwing out its reward (details.js)
     comparator output             kept in the simulation's state, not the meta
--------------------------------------------------------------------------- */
import { B, BLOCKS, MAX_ID } from '../blocks.js?v=107';
import { SHAPES, MODEL_SHAPES, turn, rotate, faceUV, sheet, buttonModel, element } from '../models.js?v=107';

export const STATEFUL = new Uint8Array(MAX_ID);    // its look depends on its meta
export const SLIGHT = new Uint8Array(MAX_ID);      // so does its light

const has = n => B[n] !== undefined;
const def = n => BLOCKS[B[n]];
// extra named textures on a block, picked up by resolveTextures (every key of a tex object becomes d.L[key])
function addTex(name, extra) {
  const d = def(name);
  if (!d) return;
  const t = typeof d.tex === 'string' ? { all: d.tex } : Object.assign({}, d.tex || {});
  Object.assign(t, extra);
  d.tex = t;
  STATEFUL[d.id] = 1;
}
const stages = (prefix, n) => { const o = {}; for (let i = 0; i < n; i++) o['s' + i] = prefix + i; return o; };

// ---- the textures each state uses ----
addTex('wheat', stages('wheat_stage', 8));
addTex('carrots', stages('carrots_stage', 4));
addTex('potatoes', stages('potatoes_stage', 4));
addTex('beetroots', stages('beetroots_stage', 4));
addTex('nether_wart', stages('nether_wart_stage', 3));
addTex('cocoa', stages('cocoa_stage', 3));
addTex('sweet_berry_bush', stages('sweet_berry_bush_stage', 4));
// cave vines with glow berries on them (meta bit 0; the pictures are ours, render/litberries.js)
addTex('cave_vines', { lit: 'cave_vines_lit' });
addTex('cave_vines_plant', { lit: 'cave_vines_plant_lit' });
addTex('farmland', { moist: 'farmland_moist' });
addTex('redstone_lamp', { on: 'redstone_lamp_on' });
// (the lit fronts are our own, drawn from the unlit ones: render/litfront.js)
for (const n of ['furnace', 'smoker', 'blast_furnace']) addTex(n, { frontOn: n + '_front_on' });
addTex('redstone_torch', { off: 'redstone_torch_off' });
addTex('redstone_wall_torch', { off: 'redstone_torch_off' });
addTex('repeater', { on: 'repeater_on', torch: 'redstone_torch', torchOff: 'redstone_torch_off' });
addTex('comparator', { on: 'comparator_on', torch: 'redstone_torch', torchOff: 'redstone_torch_off' });
addTex('observer', { backOn: 'observer_back_on' });
addTex('piston', { inner: 'piston_inner' });
addTex('sticky_piston', { inner: 'piston_inner' });
addTex('piston_head', { sticky: 'piston_top_sticky', pside: 'piston_side' });
addTex('daylight_detector', { inv: 'daylight_detector_inverted_top' });
addTex('powered_rail', { on: 'powered_rail_on' });
addTex('detector_rail', { on: 'detector_rail_on' });
addTex('activator_rail', { on: 'activator_rail_on' });
addTex('tripwire_hook', { wood: 'oak_planks' });
addTex('vault', { frontOn: 'vault_front_on', sideOn: 'vault_side_on', frontEject: 'vault_front_ejecting', topEject: 'vault_top_ejecting' });
addTex('chiseled_bookshelf', { occupied: 'chiseled_bookshelf_occupied' });
addTex('sculk_sensor', { tendril: 'sculk_sensor_tendril_inactive', tendrilOn: 'sculk_sensor_tendril_active' });
addTex('calibrated_sculk_sensor', { tendril: 'sculk_sensor_tendril_inactive', tendrilOn: 'sculk_sensor_tendril_active',
  input: 'calibrated_sculk_sensor_input_side', amethyst: 'calibrated_sculk_sensor_amethyst' });
addTex('sculk_shrieker', { inner: 'sculk_shrieker_inner_top', innerOn: 'sculk_shrieker_can_summon_inner_top' });
addTex('respawn_anchor', { lit: 'respawn_anchor_top', c1: 'respawn_anchor_side1', c2: 'respawn_anchor_side2', c3: 'respawn_anchor_side3', c4: 'respawn_anchor_side4' });
for (const n of ['redstone_wire', 'melon_stem', 'pumpkin_stem']) if (has(n)) STATEFUL[B[n]] = 1;

for (const n of ['redstone_lamp', 'redstone_torch', 'redstone_wall_torch', 'respawn_anchor', 'redstone_ore', 'deepslate_redstone_ore', 'furnace', 'smoker', 'blast_furnace']) if (has(n)) SLIGHT[B[n]] = 1;
for (const d of BLOCKS) if (d && /copper_bulb$/.test(d.name)) SLIGHT[d.id] = 1;
for (const n of ['cave_vines', 'cave_vines_plant']) if (has(n)) SLIGHT[B[n]] = 1;
// campfires give no light once put out; candles and candle cakes only while lit (3 a candle)
for (const d of BLOCKS) if (d && (d.shape === 'campfire' || d.shape === 'candle' || /candle_cake$/.test(d.name))) SLIGHT[d.id] = 1;

// blocks dust joins up with (the game's "signal sources")
const SOURCES = ['redstone_torch', 'redstone_wall_torch', 'lever', 'redstone_block', 'repeater', 'comparator', 'observer',
  'daylight_detector', 'target', 'tripwire_hook', 'trapped_chest', 'lectern', 'detector_rail', 'sculk_sensor',
  'calibrated_sculk_sensor', 'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate', 'redstone_wire'];
for (const d of BLOCKS) {
  if (!d) continue;
  if (SOURCES.includes(d.name) || /_button$|_pressure_plate$|lightning_rod$/.test(d.name)) d.redstone = true;
}

/* the light a block gives off in a state */
export function lightOf(b, m) {
  const d = BLOCKS[b];
  switch (d.name) {
    case 'redstone_lamp': return m & 1 ? 15 : 0;
    case 'redstone_torch': case 'redstone_wall_torch': return m & 8 ? 0 : 7;
    case 'respawn_anchor': return [0, 3, 7, 11, 15][Math.min(4, m & 7)];
    case 'redstone_ore': case 'deepslate_redstone_ore': return m & 1 ? 9 : 0;
    // burning, 13
    case 'furnace': case 'smoker': case 'blast_furnace': return m & 4 ? 13 : 0;
    // glow berries on a cave vine: 14
    case 'cave_vines': case 'cave_vines_plant': return m & 1 ? 14 : 0;
  }
  if (d.shape === 'campfire') return m & 4 ? 0 : d.light || 0;
  if (d.shape === 'candle') return m & 4 ? 3 * ((m & 3) + 1) : 0;
  if (/candle_cake$/.test(d.name)) return m & 4 ? 3 : 0;
  // copper bulbs, lit: 15, 12, 8 or 4 as the copper ages
  if (/copper_bulb$/.test(d.name)) return m & 1 ? (/oxidized/.test(d.name) ? 4 : /weathered/.test(d.name) ? 8 : /exposed/.test(d.name) ? 12 : 15) : 0;
  return d.light || 0;
}

// the colour of redstone dust at each power level (the game's own formula)
export const DUST = [];
for (let p = 0; p < 16; p++) {
  const f = p / 15, c = v => Math.round(Math.max(0, Math.min(1, v)) * 255);
  DUST.push((c(f * 0.6 + (f > 0 ? 0.4 : 0.3)) << 16) | (c(f * f * 0.7 - 0.5) << 8) | c(f * f * 0.6 - 0.7));
}
const STEM = []; for (let a = 0; a < 8; a++) STEM.push(((a * 32) << 16) | ((255 - a * 8) << 8) | (a * 4));

const CARROT = [0, 0, 1, 1, 2, 2, 2, 3];
const ok = (d, k) => d.L && d.L[k] !== undefined && d.L[k] > 0;    // layer 0 means the texture was never built: keep the plain look
const all6 = l => [l, l, l, l, l, l];

/* The block as it is drawn in this state: a copy of its def with other
   faces (made once per state and kept). */
const cache = new Map();
export function stateDef(d, m) {
  const key = d.id * 256 + m;
  let v = cache.get(key);
  if (v) return v;
  v = make(d, m) || d;
  cache.set(key, v);
  return v;
}
// the states kept above let go, for when the blocks' textures are worked out again (worker.js prepare)
export function forgetStates() { cache.clear(); }
function variant(d, o) { return Object.assign(Object.create(d), o); }
function make(d, m) {
  const L = d.L || {};
  switch (d.name) {
    case 'wheat': case 'beetroots': case 'nether_wart': case 'sweet_berry_bush': {
      const s = 's' + Math.min(m & 7, d.name === 'wheat' ? 7 : d.name === 'nether_wart' ? 2 : 3);
      const st = d.name === 'nether_wart' ? 's' + [0, 1, 1, 2][Math.min(3, m & 7)] : s;
      return ok(d, st) ? variant(d, { faces: all6(L[st]) }) : null;
    }
    case 'carrots': case 'potatoes': { const s = 's' + CARROT[m & 7]; return ok(d, s) ? variant(d, { faces: all6(L[s]) }) : null; }
    case 'cocoa': { const s = 's' + Math.min(2, (m >> 3) & 3); return ok(d, s) ? variant(d, { faces: all6(L[s]) }) : null; }
    case 'cave_vines': case 'cave_vines_plant': return m & 1 && ok(d, 'lit') ? variant(d, { faces: all6(L.lit) }) : null;
    case 'farmland': return (m & 7) === 7 && ok(d, 'moist') ? variant(d, { faces: [d.faces[0], d.faces[1], L.moist, d.faces[3], d.faces[4], d.faces[5]] }) : null;
    case 'redstone_lamp': return m & 1 && ok(d, 'on') ? variant(d, { faces: all6(L.on) }) : null;
    case 'furnace': case 'smoker': case 'blast_furnace': return m & 4 && ok(d, 'frontOn') ? variant(d, { front: L.frontOn }) : null;
    case 'redstone_torch': case 'redstone_wall_torch': return m & 8 && ok(d, 'off') ? variant(d, { faces: all6(L.off) }) : null;
    case 'observer': return m & 8 && ok(d, 'backOn') ? variant(d, { back: L.backOn }) : null;
    case 'daylight_detector': return m & 16 && ok(d, 'inv') ? variant(d, { faces: [d.faces[0], d.faces[1], L.inv, d.faces[3], d.faces[4], d.faces[5]] }) : null;
    case 'powered_rail': case 'detector_rail': case 'activator_rail': return m & 8 && ok(d, 'on') ? variant(d, { faces: all6(L.on) }) : null;
    case 'respawn_anchor': {
      const c = Math.min(4, m & 7);
      if (!c) return null;
      const side = ok(d, 'c' + c) ? L['c' + c] : d.faces[0], top = ok(d, 'lit') ? L.lit : d.faces[2];
      return variant(d, { faces: [side, side, top, d.faces[3], side, side] });
    }
    case 'redstone_wire': return variant(d, { rgb: DUST[m & 15] });
    case 'melon_stem': case 'pumpkin_stem': return variant(d, { rgb: STEM[m & 7] });
    case 'piston': case 'sticky_piston': return m & 8 ? variant(d, { shape: 'pistonbase', asModel: true }) : null;
    // a vault lit up while someone near it may unlock it, its front open while it gives out its reward
    case 'vault': {
      const st = (m >> 4) & 3;
      if (!st || !ok(d, 'frontOn')) return null;
      const side = L.sideOn, front = st === 1 ? L.frontOn : L.frontEject;
      return variant(d, { front, faces: [side, side, d.faces[2], d.faces[3], side, side], L: Object.assign({}, L, st === 3 && ok(d, 'topEject') ? { top: L.topEject } : {}) });
    }
    // a chiseled bookshelf is a full block to everything else, drawn as its model (models.js chiseled)
    case 'chiseled_bookshelf': return variant(d, { shape: 'chiseled', asModel: true });
  }
  return null;
}

/* ------------------------------------------------------------- models */
const box = (x0, y0, z0, x1, y1, z1, extra) => Object.assign({ f: [x0, y0, z0], t: [x1, y1, z1] }, extra || {});
const DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
// a picture lying flat at height y, turned a quarter at a time (rot 0: the top of the picture to the north)
function flatQuad(layer, y, rot) {
  const c = [[0, y, 0], [16, y, 0], [16, y, 16], [0, y, 16]];
  const r = [0, 1, 2, 3].map(i => c[(i + rot) & 3]);
  return { q: [r[3], r[2], r[1], r[0]], uv: [0, 0, 16, 16], layer, up: true };
}

const thinBase = SHAPES.thin;
SHAPES.thin = function (d, m, nb) {
  if (d.name === 'repeater') return repeaterModel(d, m);
  if (d.name === 'comparator') return comparatorModel(d, m);
  if (d.name === 'piston_head') return pistonHead(d, m);
  return thinBase(d, m, nb);
};
function torchLayer(d, lit) { const L = d.L || {}; return lit ? (L.torch || d.faces[2]) : (L.torchOff || L.torch || d.faces[2]); }
// a redstone torch on a repeater or comparator, as the game draws it: a little box two pixels square, h tall
function diodeTorch(x, z, h, layer) {
  const s = [7, 6, 9, 6 + h];
  return box(x - 1, 2, z - 1, x + 1, 2 + h, z + 1, { faces: all6(layer), skip: 1 << 3, uv: [s, s, [7, 6, 9, 8], [7, 6, 9, 8], s, s] });
}
// the slab under a repeater or comparator: its sides the bottom band of the smooth stone, its top the diode's picture
function diodeBase(d, top) {
  const bottom = d.faces[3], side = bottom, s = [0, 14, 16, 16];
  return [box(0, 0, 0, 16, 2, 16, { faces: [side, side, side, bottom, side, side], skip: 1 << 2, uv: [s, s, [0, 0, 16, 16], [0, 0, 16, 16], s, s] }), flatQuad(top, 2, 0)];
}
function repeaterModel(d, m) {
  const out = m & 3, delay = (m >> 2) & 3, on = !!(m & 16), locked = !!(m & 32);
  const L = d.L || {}, top = on && L.on ? L.on : d.faces[2];
  const list = diodeBase(d, top);
  const tl = torchLayer(d, on);
  list.push(diodeTorch(8, 3, 5, tl));                                  // the torch by the output
  if (locked) {
    // the bar that locks it (the game draws it in bedrock's picture: here the bottom of the slab)
    const b = d.faces[3];
    list.push(box(2, 2, 6 + delay * 2, 14, 4, 8 + delay * 2, { faces: all6(b), skip: 1 << 3, uv: [[6, 7, 8, 9], [6, 7, 8, 9], [2, 7, 14, 9], [2, 7, 14, 9], [2, 7, 14, 9], [2, 7, 14, 9]] }));
  } else list.push(diodeTorch(8, 7 + delay * 2, 5, tl));             // the one that moves with the delay
  return turn(list, out);
}
function comparatorModel(d, m) {
  const out = m & 3, sub = !!(m & 4), on = !!(m & 8);
  const L = d.L || {}, top = on && L.on ? L.on : d.faces[2];
  const list = diodeBase(d, top);
  // the front torch is lit in subtract mode (and stands two pixels taller, as the game's does)
  list.push(diodeTorch(8, 3, sub ? 5 : 3, torchLayer(d, sub)));
  list.push(diodeTorch(5, 12, 5, torchLayer(d, on)), diodeTorch(11, 12, 5, torchLayer(d, on)));
  return turn(list, out);
}
// the game's turns that point a model built facing north the way a piston faces (north, east, south, west, up, down)
const POINT = [[0, 0], [0, 1], [0, 2], [0, 3], [3, 0], [1, 0]];
/* The piston head (the game's model, built pointing north): the plate, its face the platform (sticky or not),
   the back of it the plain platform, the sides the edge of the piston's side picture; and the arm, which runs
   on four pixels into the base's open front. */
function pistonHead(d, m) {
  const f = Math.min(5, m & 7), L = d.L || {}, g = faceUV;
  const front = m & 8 && L.sticky ? L.sticky : d.faces[2], back = d.faces[2], side = L.pside !== undefined ? L.pside : d.faces[0];
  const plate = box(0, 0, 0, 16, 16, 4, { faces: [side, side, side, side, back, front],
    uv: [g([0, 0, 16, 4], 90), g([0, 0, 16, 4], 270), [0, 0, 16, 4], g([0, 0, 16, 4], 180), [0, 0, 16, 16], [0, 0, 16, 16]] });
  const arm = box(6, 6, 4, 10, 10, 20, { faces: all6(side), skip: 48, uv: [[0, 0, 16, 4], [16, 4, 0, 0], g([0, 0, 16, 4], 270), g([0, 0, 16, 4], 90), [0, 0, 0, 0], [0, 0, 0, 0]] });
  return rotate([plate, arm], POINT[f][0], POINT[f][1]);
}
// an extended piston's base: twelve pixels, the inside showing where the head came out (the game's model)
SHAPES.pistonbase = function (d, m) {
  const f = Math.min(5, m & 7), L = d.L || {}, g = faceUV, S = d.faces[0];
  const inner = L.inner !== undefined ? L.inner : S, back = d.back !== undefined ? d.back : S;
  const b = box(0, 0, 4, 16, 16, 16, { faces: [S, S, S, S, back, inner],
    uv: [g([0, 4, 16, 16], 90), g([0, 4, 16, 16], 270), [0, 4, 16, 16], g([0, 4, 16, 16], 180), [0, 0, 16, 16], [0, 0, 16, 16]] });
  return rotate([b], POINT[f][0], POINT[f][1]);
};
MODEL_SHAPES.add('pistonbase');

const buttonBase = SHAPES.button;
SHAPES.button = function (d, m, nb) {
  const on = !!(m & 8);
  if (d.name === 'lever') return leverModel(d, m, on);
  if (d.name === 'tripwire_hook') return hookModel(d, m, on);
  // (bit 3 is a shelf mushroom's size, not a press)
  if (!on || d.name === 'shelf_mushroom') return buttonBase(d, m, nb);
  // pressed: half as deep
  return buttonModel(m, true);
};
/* The game's lever: a cobblestone base six by eight and three high, and the handle, a stick two pixels square
   and ten long, leaning 45 degrees from its foot: towards the way the lever faces when it is on, away when off.
   Built on the floor facing north, then turned as the game's block states turn it (floor, ceiling or wall,
   and which way: on a floor or ceiling the meta's bits 4-5, on a wall away from the wall). */
/* A tripwire hook (the game's tripwire_hook models, built on the south wall): the plank it is nailed to, the stick
   out from it and the ring, hanging down at rest and drawn level when it is tripped (bit 3). */
function hookModel(d, m, on) {
  const L = d.L || {}, H = d.faces[0], W = L.wood !== undefined ? L.wood : H, rx = (o, a) => ({ axis: 'x', angle: a, origin: o });
  const dy = on ? 0.4 : 0, dz = on ? -1.2 : 0, ring = on ? null : rx([8, 6, 5.2], -45);
  const list = [
    ...element([6.2, 3.8 + dy, 7.9 + dz], [9.8, 4.6 + dy, 11.5 + dz], { down: [[5, 3, 11, 9], H], up: [[5, 3, 11, 9], H], north: [[5, 3, 11, 4], H],
      south: [[5, 8, 11, 9], H], west: [[5, 8, 11, 9], H], east: [[5, 3, 11, 4], H] }, ring),
    ...element([7.4, 3.8 + dy, 10.3 + dz], [8.6, 4.6 + dy, 10.3 + dz], { north: [[7, 8, 9, 9], H] }, ring),
    ...element([7.4, 3.8 + dy, 9.1 + dz], [8.6, 4.6 + dy, 9.1 + dz], { south: [[7, 3, 9, 4], H] }, ring),
    ...element([7.4, 3.8 + dy, 9.1 + dz], [7.4, 4.6 + dy, 10.3 + dz], { east: [[7, 8, 9, 9], H] }, ring),
    ...element([8.6, 3.8 + dy, 9.1 + dz], [8.6, 4.6 + dy, 10.3 + dz], { west: [[7, 3, 9, 4], H] }, ring),
    ...element([7.4, 5.2, 10], [8.8, 6.8, 14], { down: [[7, 9, 9, 14], W], up: [[7, 2, 9, 7], W], north: [[7, 9, 9, 11], W], south: [[7, 9, 9, 11], W],
      west: [[2, 9, 7, 11], W], east: [[9, 9, 14, 11], W] }, rx([8, 6, 14], on ? -22.5 : 45)),
    ...element([6, 1, 14], [10, 9, 16], { down: [[6, 14, 10, 16], W], up: [[6, 0, 10, 2], W], north: [[6, 7, 10, 15], W], south: [[6, 7, 10, 15], W],
      west: [[0, 7, 2, 15], W], east: [[14, 7, 16, 15], W] }),
  ];
  return rotate(list, 0, ({ 5: 0, 0: 1, 4: 2, 1: 3 }[m & 7] + 2) & 3);
}
const LEVER_TILT = Math.PI / 4;
function leverModel(d, m, on) {
  const L = d.L || {}, lever = L.lever !== undefined ? L.lever : d.faces[2], f = m & 7;
  const base = box(5, 0, 4, 11, 3, 12, { uv: [[4, 0, 12, 3], [4, 0, 12, 3], [5, 4, 11, 12], [5, 4, 11, 12], [5, 0, 11, 3], [5, 0, 11, 3]] });
  // the handle's faces as sheets, tipped about the line through (8, 1, 8) along x
  const a = on ? -LEVER_TILT : LEVER_TILT, c = Math.cos(a), s = Math.sin(a);
  const tip = ([x, y, z]) => [x, 1 + (y - 1) * c - (z - 8) * s, 8 + (y - 1) * s + (z - 8) * c];
  const side = [7, 6, 9, 16], hf = [7, 1, 7], ht = [9, 11, 9];
  const handle = [0, 1, 2, 4, 5].map(k => sheet(hf, ht, k, k === 2 ? [7, 6, 9, 8] : side, lever)).map(q => Object.assign(q, { q: q.q.map(tip) }));
  const list = [base, ...handle];
  if (f === 3) return rotate(list, 0, (m >> 4) & 3);
  if (f === 2) return rotate(list, 2, (((m >> 4) & 3) + 2) & 3);
  return rotate(list, 1, ({ 5: 0, 0: 1, 4: 2, 1: 3 }[f] + 2) & 3);
}

const plateBase = SHAPES.plate;
SHAPES.plate = function (d, m, nb) { return m & 15 ? [box(1, 0, 1, 15, 0.5, 15)] : plateBase(d, m, nb); };

/* Dust, joining up the way the game's does: to dust beside it, up the side of
   a block (unless something solid sits on top of this one), down over an
   edge, and into anything that gives a signal (a repeater only end on, an
   observer only at its back). On its own it is a cross, unless it was made a
   dot; joined on one side only, it runs straight through. */
const conductor = n => !!n && n.d.shape === 'cube' && n.d.pass === 'opaque' && n.d.solid;
export function wireLinks(nb) {
  const above = nb(0, 1, 0), upOpen = !conductor(above);
  const out = [0, 0, 0, 0];           // 0 none, 1 side, 2 up the block
  for (let k = 0; k < 4; k++) {
    const [dx, , dz] = DIRS[k];
    const n = nb(dx, 0, dz);
    if (upOpen) { const u = nb(dx, 1, dz); if (u && u.d.name === 'redstone_wire' && n && n.d.solid) { out[k] = 2; continue; } }
    if (connectsTo(n, k)) { out[k] = 1; continue; }
    if (!conductor(n)) { const dn = nb(dx, -1, dz); if (dn && dn.d.name === 'redstone_wire') out[k] = 1; }
  }
  return out;
}
export function connectsTo(n, k) {
  if (!n) return false;
  const nm = n.d.name;
  if (nm === 'redstone_wire') return true;
  if (nm === 'repeater') return ((n.m & 3) & 1) === (k & 1);
  if (nm === 'observer') return (n.m & 7) === k;
  return !!n.d.redstone;
}
export function wireShape(links, m) {
  const c = links.map(l => l > 0);
  const n = c.filter(Boolean).length;
  if (n === 0) return m & 16 ? [false, false, false, false] : [true, true, true, true];
  if (n === 1) { for (let k = 0; k < 4; k++) if (c[k]) c[(k + 2) & 3] = true; }
  return c;
}
const wireBase = SHAPES.wire;      // tripwire keeps the plain one
SHAPES.wire = function (d, m, nb) {
  if (d.name !== 'redstone_wire') return wireBase(d, m, nb);
  const L = d.L || {};
  const dot = L.dot !== undefined ? L.dot : d.faces[2], line = L.line !== undefined ? L.line : dot;
  const links = wireLinks(nb), c = wireShape(links, m), y = 0.25;
  const r = [];
  if (c[0] && c[2] && !c[1] && !c[3]) r.push(flatQuad(line, y, 0));
  else if (c[1] && c[3] && !c[0] && !c[2]) r.push(flatQuad(line, y, 1));
  else {
    r.push(flatQuad(dot, y, 0));
    const halves = [[0, 0, 16, 8], [8, 0, 16, 16], [0, 8, 16, 16], [0, 0, 8, 16]];
    for (let k = 0; k < 4; k++) {
      if (!c[k]) continue;
      const [x0, z0, x1, z1] = halves[k];
      // (a half step above the dot: the mesh keeps heights in half pixels, and in one plane the two flickered)
      const yl = y + (k & 1 ? 1 : 0.5);      // (east and west a step over north and south, which they cross)
      if (!(k & 1)) r.push({ q: [[x0, yl, z1], [x1, yl, z1], [x1, yl, z0], [x0, yl, z0]], uv: [0, z0, 16, z1], layer: line, up: true });
      else r.push({ q: [[x0, yl, z1], [x0, yl, z0], [x1, yl, z0], [x1, yl, z1]], uv: [0, x0, 16, x1], layer: line, up: true });
    }
  }
  // up the side of the block it climbs
  for (let k = 0; k < 4; k++) {
    if (links[k] !== 2) continue;
    const e = 0.25;
    const q = [[[0, 0, e], [16, 0, e], [16, 16, e], [0, 16, e]], [[16 - e, 0, 0], [16 - e, 0, 16], [16 - e, 16, 16], [16 - e, 16, 0]],
      [[16, 0, 16 - e], [0, 0, 16 - e], [0, 16, 16 - e], [16, 16, 16 - e]], [[e, 0, 16], [e, 0, 0], [e, 16, 0], [e, 16, 16]]][k];
    r.push({ q, uv: [0, 0, 16, 16], layer: line });
  }
  return r;
};
