/* ---------------------------------------------------------------------------
   Leoncraft 2 - the item pictures in the terrain texture array.

   textures/items.png is one 16 x 16 picture per item that is not a block
   (see tools/leoncraft2/build_items.py). At start-up they go into the same
   texture array as the blocks, after the last block layer, so an item in
   your hand or lying on the ground is drawn by the same shader as a torch
   or a door: the albedo from the strip, a flat normal map and a plain
   material map. The terrain files themselves are never changed.

     const items = await loadItemStrip(base, '?v=12');
     addItemPieces(items, manifest.layers, albPieces, nrmPieces, spcPieces);
     setItemLayers(manifest.layers);        // js/items.js
--------------------------------------------------------------------------- */
const RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
const PIECE = 128;

export async function loadItemStrip(base, ver) {
  try {
    const blob = await (await fetch(base + 'items.png' + (ver || ''))).blob();
    const bmp = await createImageBitmap(blob, RAW);
    return { bmp, layers: Math.floor(bmp.height / 16) };
  } catch (e) {
    console.warn('item pictures', e);
    return { bmp: null, layers: 0 };
  }
}

// a canvas of n layers all one colour, for the normal and material maps
function plain(n, rgba) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = n * 16;
  const g = c.getContext('2d');
  const img = g.createImageData(16, n * 16);
  for (let i = 0; i < img.data.length; i += 4) img.data.set(rgba, i);
  g.putImageData(img, 0, 0);
  return c;
}

/* Adds the strip's pieces (in the [layer, count, bitmap] form main.js
   uploads) to the albedo, normal and material lists, from layer `first`. */
export async function addItemPieces(strip, first, alb, nrm, spc) {
  if (!strip.bmp) return 0;
  for (let z = 0; z < strip.layers; z += PIECE) {
    const n = Math.min(PIECE, strip.layers - z);
    alb.push([first + z, n, await createImageBitmap(strip.bmp, 0, z * 16, 16, n * 16, RAW)]);
    if (nrm) nrm.push([first + z, n, plain(n, [128, 128, 255, 255])]);
    if (spc) spc.push([first + z, n, plain(n, [40, 10, 0, 0])]);
  }
  return strip.layers;
}
