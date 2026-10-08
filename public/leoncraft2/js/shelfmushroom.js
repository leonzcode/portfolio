/* ---------------------------------------------------------------------------
   Leoncraft 2 - shelf mushrooms (26.3): the game's two models, small (age 0)
   and large (age 1), as it writes them facing north (against the block to
   the south of them). Both workers and the page read this.

   Each face shows its own piece of the size's picture (Pixel Perfection
   Legacy's, 32 x 32, laid out as the game's). The pieces are cut into layers
   of their own at start-up (render/shelfmushroom.js) under the names below,
   and sim/states.js puts the names on the block, so the mesher in the
   workers finds them as d.L[shelfKey(...)].

   Meta: bits 0-2 the face of its cell it hangs on (as a button's), bit 3
   large.
--------------------------------------------------------------------------- */

// per size, its two boxes: from, to, and each face's rectangle in the game's units (16 across the picture)
export const SHELF_MODELS = [
  [[[3, 9, 9], [13, 11, 16], { north: [5, 2, 10, 3], east: [5, 0, 8.5, 1], south: [5, 3, 10, 4], west: [5, 1, 8.5, 2], up: [5, 3.5, 0, 0], down: [5, 3.5, 0, 7] }],
    [[5, 8, 12], [11, 9, 16], { north: [5, 5, 8, 5.5], east: [5, 4, 7, 4.5], south: [5, 5.5, 8, 6], west: [5, 4.5, 7, 5], up: [3, 9, 0, 7], down: [3, 9, 0, 11] }]],
  [[[1, 8, 6], [15, 11, 16], { north: [7, 3, 14, 4.5], east: [7, 0, 12, 1.5], south: [7, 4.5, 14, 6], west: [7, 1.5, 12, 3], up: [7, 5, 0, 0], down: [7, 5, 0, 10] }],
    [[4, 6, 10], [12, 8, 16], { north: [4, 12, 8, 13], east: [4, 10, 7, 11], south: [4, 13, 8, 14], west: [4, 11, 7, 12], up: [4, 13, 0, 10], down: [4, 13, 0, 16] }]],
];
// the block's key for a face's layer, and the layer's name in the texture list
export const shelfKey = (size, box, face) => 'sm' + size + box + face;
export const shelfLayer = (size, box, face) => 'lc2_shelf_mushroom_' + size + box + face;
// the piece of the 32 x 32 picture a face shows, in pixels: [x, y, w, h]
export function shelfPiece(r) {
  const x = Math.min(r[0], r[2]) * 2, y = Math.min(r[1], r[3]) * 2;
  return [x, y, Math.abs(r[2] - r[0]) * 2, Math.abs(r[3] - r[1]) * 2];
}
// every face's layer name, by the block's key (sim/states.js addTex)
export const SHELF_TEX = {};
SHELF_MODELS.forEach((boxes, s) => boxes.forEach(([, , faces], b) => { for (const f in faces) SHELF_TEX[shelfKey(s, b, f)] = shelfLayer(s, b, f); }));
