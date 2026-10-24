/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: block states.

   A vanilla block state ("minecraft:snow[layers=2]", { Name, Properties }
   or 26.3's { id, properties }) to this game's block id and meta byte.
--------------------------------------------------------------------------- */
import { B } from '../blocks.js?v=107';

const strip = s => (typeof s === 'string' && s.startsWith('minecraft:') ? s.slice(10) : s);
const FACING = { north: 0, east: 1, south: 2, west: 3 };
const STATE = new Map();

export function stateOf(s) {
  let name, props = null;
  if (typeof s === 'string') {
    const i = s.indexOf('[');
    name = strip(i < 0 ? s : s.slice(0, i));
    if (i >= 0) { props = {}; for (const kv of s.slice(i + 1, -1).split(',')) { const [k, v] = kv.split('='); props[k] = v; } }
  } else if (s.id !== undefined) { name = strip(s.id); props = s.properties || null; }
  else { name = strip(s.Name); props = s.Properties || null; }
  const key = name + (props ? JSON.stringify(props) : '');
  let st = STATE.get(key);
  if (st) return st;
  let id = B[name];
  if (id === undefined) id = B.stone;
  let meta = 0;
  if (props) {
    if (props.axis) meta = props.axis === 'x' ? 1 : props.axis === 'z' ? 2 : 0;
    if (props.layers) meta = (+props.layers - 1) & 7;
    if (props.level && (name === 'water' || name === 'lava')) { const l = +props.level; meta = l >= 8 ? 8 | (l - 8) : l; }
    if (props.facing && FACING[props.facing] !== undefined && !props.axis) meta = FACING[props.facing];
    if (props.half === 'upper') meta |= 8;
    // cave vines: bit 0 glow berries, the tip's age above it (sim/states.js)
    if (name === 'cave_vines' || name === 'cave_vines_plant') meta = (props.berries === 'true' ? 1 : 0) | (name === 'cave_vines' ? (Math.min(25, +props.age || 0) << 1) : 0);
  }
  st = { id, meta, name, props };
  STATE.set(key, st);
  return st;
}
