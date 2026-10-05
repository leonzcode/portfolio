/* ---------------------------------------------------------------------------
   Leoncraft 2 - more mobs, and the shapes of things that are not mobs
   (arrows, thrown balls).
--------------------------------------------------------------------------- */
import { MODELS } from './mobmodels.js?v=15';
import { addArt } from './mobart.js?v=15';

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

/* ---- things held in a humanoid's right hand: a flat picture on the arm's bone ----
   The layer has the humanoid's six parts (so it shares their bones) with a
   single plane on the right arm, edge on to the arm, past the fist. */
function heldLayer(name, base, box) {
  const b = MODELS[base];
  model(name, b.parts.map((p, i) => ({ name: p.name, pivot: p.pivot.slice(), rot: p.rot.slice(), parent: p.parent, boxes: i === b.index.rightArm ? [box] : [] })));
}
heldLayer('held_bow', 'skeleton', [0, 6, -7, 0, 7, 14, 0, 0]);
addArt('held_items', [64, 32], p => {
  // a bow seen side on: the limbs curving forward from the grip, the string straight behind
  const wood = 0x7a5530, dark = 0x4e3519, str = 0xd8d8d8;
  for (const ox of [0, 14]) {
    for (let i = 0; i < 14; i++) {
      const t = (i - 6.5) / 6.5;
      const row = Math.round(1 + 4.2 * (1 - t * t));
      p.px(ox + i, 14 + Math.min(6, row), Math.abs(t) > 0.85 ? dark : wood);
      if (row > 1) p.px(ox + i, 14 + Math.min(6, row) - 1, Math.abs(t) < 0.3 ? 0x5a3c20 : wood);
      p.px(ox + i, 14, str);
    }
  }
});
