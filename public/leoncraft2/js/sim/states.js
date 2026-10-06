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
     farmland                      bits 0-2 moisture
     leaves                        bit 7 persistent (put there by a player: never decays)
     saplings                      bit 0 stage
     sugar cane, cactus            bits 0-3 age;  kelp bits 0-4 age
     redstone_wire                 bits 0-3 power, bit 4 a dot (no sides)
     redstone torch                bit 3 unlit (wall torch: bits 0-2 its wall)
     repeater                      bits 0-1 the way it outputs, bits 2-3 delay - 1, bit 4 powered, bit 5 locked
     comparator                    bits 0-1 output, bit 2 subtract, bit 3 powered
     lever, buttons                bits 0-2 the face it is on, bit 3 powered
     pressure plates               bit 0 pressed; weighted ones bits 0-3 power
     redstone_lamp                 bit 0 lit
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
     comparator output             kept in the simulation's state, not the meta
--------------------------------------------------------------------------- */
import { B, BLOCKS, MAX_ID } from '../blocks.js?v=19';
import { SHAPES, MODEL_SHAPES, turn } from '../models.js?v=19';

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
addTex('farmland', { moist: 'farmland_moist' });
addTex('redstone_lamp', { on: 'redstone_lamp_on' });
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
addTex('respawn_anchor', { lit: 'respawn_anchor_top', c1: 'respawn_anchor_side1', c2: 'respawn_anchor_side2', c3: 'respawn_anchor_side3', c4: 'respawn_anchor_side4' });
for (const n of ['redstone_wire', 'melon_stem', 'pumpkin_stem']) if (has(n)) STATEFUL[B[n]] = 1;

for (const n of ['redstone_lamp', 'redstone_torch', 'redstone_wall_torch', 'respawn_anchor', 'redstone_ore', 'deepslate_redstone_ore']) if (has(n)) SLIGHT[B[n]] = 1;
for (const d of BLOCKS) if (d && /copper_bulb$/.test(d.name)) SLIGHT[d.id] = 1;
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
    case 'farmland': return (m & 7) === 7 && ok(d, 'moist') ? variant(d, { faces: [d.faces[0], d.faces[1], L.moist, d.faces[3], d.faces[4], d.faces[5]] }) : null;
    case 'redstone_lamp': return m & 1 && ok(d, 'on') ? variant(d, { faces: all6(L.on) }) : null;
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
  }
  return null;
}

/* ------------------------------------------------------------- models */
const box = (x0, y0, z0, x1, y1, z1, extra) => Object.assign({ f: [x0, y0, z0], t: [x1, y1, z1] }, extra || {});
const DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
const FACE_OF_FACING = [5, 0, 4, 1, 2, 3];          // facing (n e s w up down) -> the face it points out of
// a sprite standing up: two crossed planes centred at (cx, cz), y0 to y1, w wide
function sprite(cx, cz, y0, y1, w, layer, uv) {
  const h = w / 2;
  uv = uv || [0, 0, 16, 16];
  return [
    { q: [[cx - h, y0, cz - h], [cx + h, y0, cz + h], [cx + h, y1, cz + h], [cx - h, y1, cz - h]], uv, layer },
    { q: [[cx - h, y0, cz + h], [cx + h, y0, cz - h], [cx + h, y1, cz - h], [cx - h, y1, cz + h]], uv, layer },
  ];
}
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
function repeaterModel(d, m) {
  const out = m & 3, delay = (m >> 2) & 3, on = !!(m & 16), locked = !!(m & 32);
  const L = d.L || {}, top = on && L.on ? L.on : d.faces[2];
  const side = d.faces[0], bottom = d.faces[3];
  const list = [box(0, 0, 0, 16, 2, 16, { faces: [side, side, side, bottom, side, side], skip: 1 << 2 }), flatQuad(top, 2, 0)];
  const tl = torchLayer(d, on);
  list.push(...sprite(8, 3, 1, 9, 5, tl));                            // the torch by the output
  if (locked) list.push(box(2, 2, 6 + delay * 2, 14, 4, 8 + delay * 2, { faces: all6(d.faces[3]) }));   // the bar that locks it
  else list.push(...sprite(8, 7 + delay * 2, 1, 9, 5, tl));          // the one that moves with the delay
  return turn(list, out);
}
function comparatorModel(d, m) {
  const out = m & 3, sub = !!(m & 4), on = !!(m & 8);
  const L = d.L || {}, top = on && L.on ? L.on : d.faces[2];
  const side = d.faces[0], bottom = d.faces[3];
  const list = [box(0, 0, 0, 16, 2, 16, { faces: [side, side, side, bottom, side, side], skip: 1 << 2 }), flatQuad(top, 2, 0)];
  list.push(...sprite(8, 3, 1, sub ? 9 : 7, 5, torchLayer(d, sub)));
  list.push(...sprite(4, 12, 1, 9, 5, torchLayer(d, on)), ...sprite(12, 12, 1, 9, 5, torchLayer(d, on)));
  return turn(list, out);
}
// the piston head: the plate at the front and the arm back into the base
function pistonHead(d, m) {
  const f = Math.min(5, m & 7), F = FACE_OF_FACING[f];
  const L = d.L || {};
  const front = m & 8 && L.sticky ? L.sticky : d.faces[2], side = L.pside !== undefined ? L.pside : d.faces[0];
  const plate = slab(F, 0, 4), arm = rodTo(F, 4, 16);
  const pf = all6(side); pf[F] = front; pf[F ^ 1] = d.faces[2];
  return [Object.assign(plate, { faces: pf }), Object.assign(arm, { faces: all6(side) })];
}
// the box from depth a to depth b in from face F
function slab(F, a, b) {
  switch (F) {
    case 0: return box(16 - b, 0, 0, 16 - a, 16, 16);
    case 1: return box(a, 0, 0, b, 16, 16);
    case 2: return box(0, 16 - b, 0, 16, 16 - a, 16);
    case 3: return box(0, a, 0, 16, b, 16);
    case 4: return box(0, 0, 16 - b, 16, 16, 16 - a);
    default: return box(0, 0, a, 16, 16, b);
  }
}
function rodTo(F, a, b) {
  const s = slab(F, a, b), ax = F >> 1;
  for (let k = 0; k < 3; k++) if (k !== ax) { s.f[k] = 6; s.t[k] = 10; }
  return s;
}
// an extended piston's base: twelve pixels, the inside showing where the head came out
SHAPES.pistonbase = function (d, m) {
  const f = Math.min(5, m & 7), F = FACE_OF_FACING[f], L = d.L || {};
  const fc = all6(d.faces[0]);
  fc[F] = L.inner !== undefined ? L.inner : d.faces[0];
  fc[F ^ 1] = d.back !== undefined ? d.back : d.faces[0];
  return [Object.assign(slab(F, 4, 16), { faces: fc })];
};
MODEL_SHAPES.add('pistonbase');

const buttonBase = SHAPES.button;
SHAPES.button = function (d, m, nb) {
  const f = m & 7, on = !!(m & 8);
  if (d.name === 'lever') return leverModel(d, f, on);
  if (!on || d.name === 'tripwire_hook') return buttonBase(d, m, nb);
  // pressed: half as deep
  if (f === 3) return [box(5, 0, 6, 11, 1, 10)];
  if (f === 2) return [box(5, 15, 6, 11, 16, 10)];
  return turn([box(5, 6, 0, 11, 10, 1)], { 5: 0, 0: 1, 4: 2, 1: 3 }[f] || 0);
};
function leverModel(d, f, on) {
  const L = d.L || {}, lever = L.lever !== undefined ? L.lever : d.faces[2];
  // built on the floor: the cobblestone base and the handle leaning one way or the other
  const base = box(5, 0, 4, 11, 3, 12);
  const tilt = on ? 1 : -1, s = Math.sin(Math.PI / 4) * 8, c = Math.cos(Math.PI / 4) * 8;
  const B0 = [8, 2, 8], T = [8, 2 + c, 8 + tilt * s];
  const h = 1;
  const handle = [
    { q: [[B0[0] - h, B0[1], B0[2]], [B0[0] + h, B0[1], B0[2]], [T[0] + h, T[1], T[2]], [T[0] - h, T[1], T[2]]], uv: [7, 6, 9, 16], layer: lever },
    { q: [[B0[0], B0[1], B0[2] - h], [B0[0], B0[1], B0[2] + h], [T[0], T[1], T[2] + h], [T[0], T[1], T[2] - h]], uv: [7, 6, 9, 16], layer: lever },
  ];
  const list = [base, ...handle];
  if (f === 3) return list;
  if (f === 2) return list.map(b => b.q ? Object.assign({}, b, { q: b.q.map(([x, y, z]) => [x, 16 - y, z]) }) : box(b.f[0], 16 - b.t[1], b.f[2], b.t[0], 16 - b.f[1], b.t[2]));
  // on a wall: the floor model stood against the wall (y -> z), then turned to it
  const up = list.map(b => b.q ? Object.assign({}, b, { q: b.q.map(([x, y, z]) => [x, 16 - z, y]) })
    : box(b.f[0], 16 - b.t[2], b.f[1], b.t[0], 16 - b.f[2], b.t[1]));
  return turn(up, { 5: 0, 0: 1, 4: 2, 1: 3 }[f] || 0);
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
      if (!(k & 1)) r.push({ q: [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], uv: [0, z0, 16, z1], layer: line, up: true });
      else r.push({ q: [[x0, y, z1], [x0, y, z0], [x1, y, z0], [x1, y, z1]], uv: [0, x0, 16, x1], layer: line, up: true });
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
