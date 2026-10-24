/* ---------------------------------------------------------------------------
   Leoncraft 2 - the game's sound calls, as the game makes them.

   Small helpers the rest of the code calls where something happens (a block
   broken, a door swinging), each with the game's own volume and pitch:

     blockSound(kind, id, x, y, z)   'brk' 'place' 'hit' 'fall' 'step' for a
                                     block, by its sound type (blocksounds.js)
     doorSound(id, open, x, y, z)    doors, trapdoors, fence gates, by material
     voice()                         a mob's voice pitch: 1 +- 0.2, 1.5 for a baby
     at(event, x, y, z, v, p, cat)   any other event in the world
--------------------------------------------------------------------------- */
import { Sound } from './sound.js?v=107';
import { soundType } from './blocksounds.js?v=107';
import { BLOCKS } from '../blocks.js?v=107';

const R = Math.random;
// (r - r): the game's spread, from -1 to 1 and most often near 0
export const spread = () => R() - R();
export const voice = baby => spread() * 0.2 + (baby ? 1.5 : 1.0);

// the event, or the stone one of the same kind where the packs have none (a newer block than the sounds)
function ev(t, kind) {
  const e = t[kind];
  if (Sound.has(e)) return e;
  const s = soundType(1);   // stone
  return s[kind];
}

/* A block's sound. vol multiplies the game's own (a muffled step is 0.05 / 0.15 of one). */
export function blockSound(kind, id, x, y, z, vol = 1, pitchMul = 1) {
  if (!id || !BLOCKS[id]) return null;
  const t = soundType(id);
  let v, p;
  if (kind === 'brk' || kind === 'place') { v = (t.v + 1) / 2; p = t.p * 0.8; }
  else if (kind === 'hit') { v = (t.v + 1) / 8; p = t.p * 0.5; }
  else if (kind === 'fall') { v = t.v * 0.5; p = t.p * 0.75; }
  else { v = t.v * 0.15; p = t.p; }
  return Sound.play(ev(t, kind), x, y, z, v * vol, p * pitchMul, 'block');
}

/* Doors, trapdoors and fence gates open and shut with their set's sounds:
   wood, cherry, bamboo, the nether woods, iron and copper. Volume 1, pitch
   0.9-1 (the game's random.nextFloat() * 0.1 + 0.9). */
export function doorSound(id, open, x, y, z) {
  const d = BLOCKS[id];
  if (!d) return;
  const n = d.name, s = d.shape;
  const set = /^iron_/.test(n) ? 'iron' : /copper/.test(n) ? 'copper' : /^cherry_/.test(n) ? 'cherry_wood' : /^bamboo_/.test(n) ? 'bamboo_wood'
    : /^(crimson|warped)_/.test(n) ? 'nether_wood' : 'wooden';
  let e;
  if (s === 'door') e = set === 'iron' ? 'block.iron_door' : set === 'copper' ? 'block.copper_door' : 'block.' + set + '_door';
  else if (s === 'trapdoor') e = set === 'iron' ? 'block.iron_trapdoor' : set === 'copper' ? 'block.copper_trapdoor' : 'block.' + set + '_trapdoor';
  else if (s === 'gate') e = set === 'wooden' ? 'block.fence_gate' : 'block.' + set + '_fence_gate';
  else return;
  e += open ? '.open' : '.close';
  if (!Sound.has(e)) e = s === 'gate' ? 'block.fence_gate' + (open ? '.open' : '.close') : s === 'door' ? 'block.wooden_door' + (open ? '.open' : '.close') : 'block.wooden_trapdoor' + (open ? '.open' : '.close');
  Sound.play(e, x + 0.5, y + 0.5, z + 0.5, 1, R() * 0.1 + 0.9, 'block');
}

export const at = (e, x, y, z, v = 1, p = 1, cat = 'block') => Sound.play(e, x, y, z, v, p, cat);
