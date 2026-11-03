/* ---------------------------------------------------------------------------
   Leoncraft 2 - a clock tells the time wherever it is.

   The clock's 64 faces (js/dials.js) are pictures in the item strip that only
   the inventory and the hotbar drew: the texture array the world is drawn
   from allows 2048 layers and the blocks, the items and the dimensions' art
   take 2019 of them, so the faces stay out of it, and a clock in a hand, in
   an item frame or on the ground showed one fixed face. Every clock in a
   world shows the same time, though, so here the clock's own layer is
   painted with the face the dials show now (all five sizes of its 16 x 16
   picture written straight in, no rebuild of the array's other layers), and
   every clock drawn in the world shows the time: yours, another player's, a
   mob's, one in a frame or lying on the ground.

     startLiveClock(renderer, icons, getAlbedo)
                       renderer: three's; icons: ui/icons.js (its px is the
                       strip's pixels, a resource pack's included); getAlbedo:
                       the albedo array now (it is swapped once the textures
                       land)
     updateLiveClock(frameName)
                       once a tick with dials.js's 'frame_clock_NN'; paints
                       when the face changed, the array was replaced, or
                       every five seconds (a resource pack repaints items)
--------------------------------------------------------------------------- */
import { textureLayer, gpuLayer } from '../items.js?v=119';

let R = null, ICONS = null, ALBEDO = null;
let shown = null, shownOn = null, ticks = 0;

export function startLiveClock(renderer, icons, getAlbedo) { R = renderer; ICONS = icons; ALBEDO = getAlbedo; shown = null; }

// a picture half the size: each pixel the mean of four, the colour weighted by how opaque each is
function half(src, w) {
  const h = w >> 1, out = new Uint8Array(h * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const i = ((y * 2 + dy) * w + x * 2 + dx) * 4, al = src[i + 3];
      r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al;
    }
    const o = (y * h + x) * 4;
    if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = a / 4;
  }
  return out;
}

export function updateLiveClock(frameName) {
  if (!R || !ICONS || !frameName) return;
  const tex = ALBEDO && ALBEDO();
  ticks++;
  if (frameName === shown && tex === shownOn && ticks < 100) return;
  ticks = 0;
  const layer = gpuLayer('clock'), from = textureLayer(frameName), px = ICONS.px;
  if (layer < 0 || from < 0 || !px || !tex || !tex.image || tex.image.depth <= layer) return;
  const props = R.properties.get(tex);
  if (!props || !props.__webglTexture) return;
  const o = from * 1024;
  if (px.length < o + 1024) return;
  let pic = new Uint8Array(px.buffer.slice(px.byteOffset + o, px.byteOffset + o + 1024));
  const gl = R.getContext();
  R.state.bindTexture(gl.TEXTURE_2D_ARRAY, props.__webglTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  // the array has every size down to 1 x 1 (16, 8, 4, 2, 1)
  for (let level = 0, w = 16; w >= 1; level++, w >>= 1) {
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, 0, 0, layer, w, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, pic);
    if (w > 1) pic = half(pic, w);
  }
  R.state.unbindTexture();
  shown = frameName; shownOn = tex;
}
