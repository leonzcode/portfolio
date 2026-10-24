/* ---------------------------------------------------------------------------
   Leoncraft 2 - the item pictures in the terrain texture array.

   textures/items.png is one 16 x 16 picture per item that is not a block
   (see tools/leoncraft2/build_items.py). At start-up they go into the same
   texture array as the blocks, after the last block layer, so an item in
   your hand or lying on the ground is drawn by the same shader as a torch
   or a door: the albedo from the strip, a flat normal map and a plain
   material map. The terrain files themselves are never changed.

     const items = await loadItemStrip(base, '?v=107');
     addItemPieces(items, manifest.layers, albPieces, nrmPieces, spcPieces);
     setItemLayers(manifest.layers);        // js/items.js

   The frames at the end of the strip (a compass needle's 32, a clock's 64,
   a bow's while drawn...) are only ever drawn by the inventory and the
   hotbar, which read the strip's pixels themselves, so they stay out of the
   texture array: GPUs allow 2048 layers in one, and the blocks, the
   dimensions' art and every frame together would pass that, leaving the
   whole array unmade and the world black.
--------------------------------------------------------------------------- */
import { ITEM_TEX } from './itemdata.js?v=107';
const RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
const PIECE = 128;
// how many pictures of the strip go into the texture array: everything before the first frame
const FIRST_FRAME = ITEM_TEX.findIndex(n => n.startsWith('frame_'));
// ...and, after them, the bow's and crossbow's own pictures (drawn back, loaded), which a hand in the world shows:
// the last of the strip, eight layers (items.js gpuLayer finds them there)
const HELD_FRAME = ITEM_TEX.indexOf('frame_bow_pulling_0');

export async function loadItemStrip(base, ver) {
  try {
    const blob = await (await fetch(base + 'items.png' + (ver || ''))).blob();
    const bmp = await createImageBitmap(blob, RAW);
    const layers = Math.floor(bmp.height / 16);
    return { bmp, layers, gpu: FIRST_FRAME >= 0 ? Math.min(layers, FIRST_FRAME) : layers };
  } catch (e) {
    console.warn('item pictures', e);
    return { bmp: null, layers: 0 };
  }
}

/* n layers all one colour, for the normal and material maps, as bytes: a
   canvas here (as it was) took the graphics card a fifth of a second to hand
   over, every page open. A canvas keeps its colours multiplied by their
   alpha, so a colour with none came through as nothing at all: the same
   nothing here, so the item layers look as they always have. */
function plain(n, rgba) {
  const v = rgba[3] === 0 ? [0, 0, 0, 0] : rgba, a = new Uint8Array(16 * 16 * 4 * n);
  for (let i = 0; i < a.length; i += 4) a.set(v, i);
  return a;
}

/* Adds the strip's pieces (in the [layer, count, bitmap] form main.js
   uploads) to the albedo, normal and material lists, from layer `first`. */
export async function addItemPieces(strip, first, alb, nrm, spc) {
  if (!strip.bmp) return 0;
  const total = strip.gpu !== undefined ? strip.gpu : strip.layers;
  for (let z = 0; z < total; z += PIECE) {
    const n = Math.min(PIECE, total - z);
    alb.push([first + z, n, await createImageBitmap(strip.bmp, 0, z * 16, 16, n * 16, RAW)]);
    if (nrm) nrm.push([first + z, n, plain(n, [128, 128, 255, 255])]);
    if (spc) spc.push([first + z, n, plain(n, [40, 10, 0, 0])]);
  }
  const held = HELD_FRAME >= 0 && strip.gpu !== undefined && strip.layers > HELD_FRAME ? strip.layers - HELD_FRAME : 0;
  if (held) {
    alb.push([first + total, held, await createImageBitmap(strip.bmp, 0, HELD_FRAME * 16, 16, held * 16, RAW)]);
    if (nrm) nrm.push([first + total, held, plain(held, [128, 128, 255, 255])]);
    if (spc) spc.push([first + total, held, plain(held, [40, 10, 0, 0])]);
  }
  return total + held;
}
