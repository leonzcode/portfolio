/* ---------------------------------------------------------------------------
   Leoncraft 2 - armour on the mobs that wear it.

   A zombie, a skeleton, a piglin... wears what its equipment says (head,
   chest, legs, feet: item names, or stacks). Each piece is one more layer on
   the mob's own bones (manager.js drawOne): a model made once per mob model
   and piece, with the mob's parts and only the armour boxes, on the parts
   named as a humanoid's are (render/armor.js), and the armour pictures in
   the mob atlas, a 64 x 64 slot per material (layer 1 over layer 2) and one
   for leather's undyed overlay, copied from the armour sheet when it changes. Leather keeps its dye, enchanted
   pieces shimmer, and armour does not flash red when the mob is hurt, as in
   the game.
--------------------------------------------------------------------------- */
import { MODELS } from './mobmodels.js?v=107';
import { addArt, SLOTS } from './mobart.js?v=107';
import { ARMOR_MATS, PIECE_BOXES, OVERLAY_ROW, armorSheet, pieceLook } from '../render/armor.js?v=107';
import { itemId } from '../items.js?v=107';

const SLOT_NAMES = ['head', 'chest', 'legs', 'feet'];
// a slot in the atlas for each material (and leather's undyed overlay), left empty here and filled from the sheet
for (const m of ARMOR_MATS) addArt('armor_' + m, [64, 64], () => {});
addArt('armor_overlay', [64, 64], () => {});

/* the armour model for one piece on one mob model: the mob's parts (so the
   mob's bones move it), with only the armour boxes, every box tinted so
   leather can take its dye; null for a model with no humanoid parts */
function armorModel(name, piece) {
  const key = 'armor' + piece + '@' + name;
  if (MODELS[key] !== undefined) return MODELS[key];
  const src = MODELS[name], boxes = PIECE_BOXES[piece];
  let any = false;
  const parts = src.parts.map(p => {
    const b = boxes[p.name] || [];
    if (b.length) any = true;
    return { name: p.name, pivot: p.pivot, rot: p.rot, parent: p.parent, boxes: b.map(x => [x[0], x[1], x[2], x[3], x[4], x[5], x[6], x[7], x[8], !!x[9], 1]) };
  });
  const m = any ? { name: key, size: [64, 64], parts, index: src.index, animate: null } : null;
  MODELS[key] = m;
  return m;
}

// a worn thing's look, by item name (cached) or from a stack (dye, enchantments)
const byName = new Map();
function lookOf(it) {
  if (typeof it === 'string') {
    if (!byName.has(it)) byName.set(it, pieceLook({ id: itemId(it), count: 1 }));
    return byName.get(it);
  }
  return it && it.id ? pieceLook(it) : null;
}

// the atlas's copy of the sheet: once per atlas, and again whenever a file lands in the sheet
function patchAtlas(mgr) {
  const sh = armorSheet();
  if (mgr.armorV === sh.version || !mgr.atlas || !mgr.meshes) return;
  mgr.armorV = sh.version;
  const g = mgr.atlas.getContext('2d');
  ARMOR_MATS.concat(['overlay']).forEach((m, i) => {
    const s = SLOTS['armor_' + m];
    if (!s) return;
    g.clearRect(s[0], s[1], 64, 64);
    g.drawImage(sh.canvas, 0, (m === 'overlay' ? OVERLAY_ROW : i) * 64, 64, 64, s[0], s[1], 64, 64);
  });
  mgr.meshes.atlas.needsUpdate = true;
}

/* The layers for what e wears, onto out as [model, texture, colour, glint,
   no hurt flash]; name is the model e is drawn with. */
export function armorLayers(mgr, e, name, out) {
  const eq = e.equip;
  if (!eq || !(eq.head || eq.chest || eq.legs || eq.feet)) return;
  const src = MODELS[name];
  if (!src || src.index.body === undefined || src.index.head === undefined) return;
  patchAtlas(mgr);
  for (let i = 0; i < 4; i++) {
    const it = eq[SLOT_NAMES[i]];
    if (!it) continue;
    const look = lookOf(it);
    if (!look) continue;
    const m = armorModel(name, i);
    if (!m) continue;
    out.push([m.name, 'armor_' + look.material, look.tint, look.glint, true]);
    // leather's undyed parts, over the dyed piece as they are
    if (look.overlay >= 0) out.push([m.name, 'armor_overlay', 0xffffff, false, true]);
  }
}
