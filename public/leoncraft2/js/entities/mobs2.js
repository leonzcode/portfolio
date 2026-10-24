/* ---------------------------------------------------------------------------
   Leoncraft 2 - more mobs, and the shapes of things that are not mobs
   (arrows, thrown balls).
--------------------------------------------------------------------------- */
import { MODELS } from './mobmodels.js?v=107';
import { addArt } from './mobart.js?v=107';

export function model(name, parts, animate) {
  const m = { name, parts: parts.map(p => Object.assign({ pivot: [0, 0, 0], rot: [0, 0, 0], boxes: [], parent: -1 }, p)), animate };
  m.index = {}; m.parts.forEach((p, i) => { m.index[p.name] = i; });
  for (const p of m.parts) if (typeof p.parent === 'string') p.parent = m.index[p.parent];
  MODELS[name] = m;
  return m;
}

/* ---- an arrow: a thin shaft with a head and flights, pointing along -z ---- */
model('arrow', [
  { name: 'shaft', pivot: [0, 24, 0], boxes: [[-0.5, -0.5, -8, 1, 1, 16, 0, 0], [-1.5, -1.5, -8, 3, 3, 2, 0, 18], [0, -2.5, 4, 0, 5, 4, 20, 0], [-2.5, 0, 4, 5, 0, 4, 20, 10]] },
]);
addArt('arrow', [64, 32], p => {
  p.box(0, 0, 1, 1, 16, 0x7a5a3a, 0.08);
  p.box(0, 18, 3, 3, 2, 0x9a9a9a, 0.06);
  p.box(20, 0, 0, 5, 4, 0xe8e8e8, 0.04);
  p.box(20, 10, 5, 0, 4, 0xe8e8e8, 0.04);
});
/* ---- a thrown ball (snowball, egg, potion): a small cube ---- */
model('ball', [{ name: 'ball', pivot: [0, 22, 0], boxes: [[-2, -2, -2, 4, 4, 4, 0, 0]] }]);
addArt('snowball', [64, 32], p => { p.box(0, 0, 4, 4, 4, 0xf4f8ff, 0.06); });
addArt('egg', [64, 32], p => { p.box(0, 0, 4, 4, 4, 0xe8dcc0, 0.06); });
addArt('splash_potion', [64, 32], p => { p.box(0, 0, 4, 4, 4, 0x6a2a8a, 0.1); });

/* (what mobs hold is the item itself, drawn by render/mobheld.js) */
