/* ---------------------------------------------------------------------------
   Leoncraft 2 - cave vines with glow berries on them: the vine's own picture
   with berries painted over it in code (our own pixels, no game files).

   Three berries a picture, a little round cluster each (a dark rim, a warm
   orange body and a pale yellow highlight up and to the left), sat on the
   vine where it has pixels, one high, one in the middle and one low, so a
   whole hanging vine reads as dotted with them. The berries glow a little
   with the shaders on (their material picture); the block's own light 14
   lights the rest, shaders on or off.

     const lit = litBerries(add);    // dim/art.js addDimArt: the layers, empty
     lit.fill(albedoStrip, T);       // once the strip is loaded: the pixels
--------------------------------------------------------------------------- */

const KINDS = ['cave_vines', 'cave_vines_plant'];
// a berry, 3 x 3: rim (r), body (b) and highlight (h); corners left as the vine is
const BERRY = ['.rr', 'rhb', 'rbr'];
const COL = { r: [176, 88, 18], b: [244, 146, 40], h: [255, 222, 120] };
function h2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* the picture with berries, and its material picture, from the vine's own pixels (16 x 16 RGBA) */
function paint(src, seed) {
  const out = new Uint8ClampedArray(src), em = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) em.set([40, 10, 0, 0], i * 4);
  const solid = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && src[(y * 16 + x) * 4 + 3] > 0;
  for (const [y0, y1] of [[1, 4], [6, 9], [11, 13]]) {
    // a spot in this band with vine under the middle of the berry, picked the same way every time
    const spots = [];
    for (let y = y0; y <= y1; y++) for (let x = 1; x <= 13; x++) if (solid(x + 1, y + 1)) spots.push([x, y]);
    if (!spots.length) continue;
    const [bx, by] = spots[Math.floor(h2(y0, seed, 5) * spots.length)];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const k = BERRY[j][i];
      if (k === '.') continue;
      const o = ((by + j) * 16 + bx + i) * 4, c = COL[k];
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      // (a faint glow only: more takes the orange to white through the shaders' tone curve)
      em[o + 3] = k === 'r' ? 0 : 48;
    }
  }
  return [out, em];
}

/* The layers, added through dim/art.js's add (empty for now: filled once the strip is in) */
export function litBerries(add) {
  const made = [];
  for (const kind of KINDS) {
    const rgba = new Uint8ClampedArray(16 * 16 * 4), em = new Uint8Array(16 * 16 * 4);
    add(kind + '_lit', [rgba], 1, [em]);
    made.push({ kind, rgba, em });
  }
  return {
    fill(strip, T) {
      if (!strip) return;
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true });
      made.forEach((m, i) => {
        const e = T[m.kind];
        if (!e) return;
        g.clearRect(0, 0, 16, 16);
        g.drawImage(strip, 0, e.layer * 16, 16, 16, 0, 0, 16, 16);
        const [rgba, em] = paint(g.getImageData(0, 0, 16, 16).data, i + 1);
        m.rgba.set(rgba); m.em.set(em);
      });
    },
  };
}
