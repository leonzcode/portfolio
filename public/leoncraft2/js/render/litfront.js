/* ---------------------------------------------------------------------------
   Leoncraft 2 - lit furnaces, smokers and blast furnaces: their fronts with
   the fire going, drawn in code from our own unlit fronts (no game files).

   A furnace burning shows fire in its lower mouth, a smoker fire in its
   lower mouth and a glow in the upper one, flickering over three frames (the
   game's 4 ticks a frame), and a blast furnace the slots of its grate
   glowing orange, brighter and dimmer over 40 ticks (the game fades two
   frames into each other every 10 ticks; we step it in four). Each picture
   is the unlit front with only its dark mouth pixels replaced, so it follows
   whatever our front looks like. The fire pixels glow with the shaders on.

     const lit = litFronts(add);     // dim/art.js addDimArt: the layers, empty
     lit.fill(albedoStrip);          // once the strip is loaded: the pixels
--------------------------------------------------------------------------- */

/* where each front's fire goes: dark pixels (lum below dark) in the box
   [x0, y0, x1, y1] (inclusive, picture pixels from the top left); glow: the
   same in a second box, dimmer */
const FRONTS = {
  furnace: { box: [3, 9, 12, 15], dark: 64, frames: 1, ft: 1 },
  smoker: { box: [3, 9, 12, 14], dark: 64, glow: [3, 3, 12, 7], frames: 3, ft: 4 },
  blast_furnace: { box: [4, 6, 11, 10], dark: 112, frames: 4, ft: 5 },
};
const lum = (d, o) => d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114;
function h2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// fire, by how hot (0 the dark red at the top of the flames .. 1 the white-yellow at their root)
const FIRE = [[96, 22, 6], [176, 52, 8], [228, 110, 18], [246, 170, 40], [255, 222, 110], [255, 246, 196]];
function fire(t) {
  t = Math.max(0, Math.min(1, t)) * (FIRE.length - 1);
  const i = Math.min(FIRE.length - 2, Math.floor(t)), f = t - i, a = FIRE[i], b = FIRE[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/* the lit picture of one front, frame k of n, from its unlit pixels (16 x 16 RGBA) */
function light(src, spec, kind, k) {
  const F = FRONTS[kind], out = new Uint8ClampedArray(src), em = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) em.set([40, 10, 0, 0], i * 4);
  if (spec) em.set(spec);
  const paint = (box, dim) => {
    const [x0, y0, x1, y1] = box;
    // the mouth's own top and bottom rows (only its dark pixels count)
    let top = 99, bot = -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (lum(src, (y * 16 + x) * 4) < F.dark) { top = Math.min(top, y); bot = Math.max(bot, y); }
    if (bot < 0) return;
    for (let y = top; y <= bot; y++) for (let x = x0; x <= x1; x++) {
      const o = (y * 16 + x) * 4;
      if (lum(src, o) >= F.dark) continue;
      let c;
      if (kind === 'blast_furnace') {
        // the grate's slots: an even orange, the whole furnace breathing brighter and dimmer
        const b = [1, 0.86, 0.72, 0.86][k % 4] * (0.9 + h2(x, y, 7) * 0.1);
        c = [236 * b, 128 * b, 28 * b];
      } else {
        // flames: hottest at the floor of the mouth, tongues of colour reaching up by the frame
        const up = bot > top ? (bot - y) / (bot - top) : 0;
        const tongue = h2(x, k, 31) * 0.55 + h2(x + 1, k, 31) * 0.2;
        let t = 1 - up * 1.05 + tongue * 0.6 - 0.25 + (h2(x, y, k + 3) - 0.5) * 0.3;
        if (dim) t = t * 0.45 + 0.05;
        c = t < 0.05 ? [src[o] + 26, src[o + 1] + 8, src[o + 2]] : fire(t);
      }
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      // glowing with the shaders on, the brighter the hotter
      em[o + 3] = Math.round(Math.min(1, (c[0] + c[1]) / 420) * 200);
    }
  };
  paint(F.box, false);
  if (F.glow) paint(F.glow, true);
  return [out, em];
}

/* The layers, added through dim/art.js's add (empty for now: filled once the strip is in) */
export function litFronts(add) {
  const made = [];
  for (const kind in FRONTS) {
    const F = FRONTS[kind], frames = [];
    for (let k = 0; k < F.frames; k++) frames.push(new Uint8ClampedArray(16 * 16 * 4));
    const ems = frames.map(() => new Uint8Array(16 * 16 * 4));
    add(kind + '_front_on', frames, F.ft, ems);
    made.push({ kind, frames, ems });
  }
  return {
    /* the pixels, from the albedo strip (an image, 16 wide, one layer every 16 rows) and the
       unlit front's layer in it (manifest.textures[kind + '_front']) */
    fill(strip, T) {
      if (!strip) return;
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const g = c.getContext('2d', { willReadFrequently: true });
      for (const m of made) {
        const e = T[m.kind + '_front'];
        if (!e) continue;
        g.clearRect(0, 0, 16, 16);
        g.drawImage(strip, 0, e.layer * 16, 16, 16, 0, 0, 16, 16);
        const src = g.getImageData(0, 0, 16, 16).data;
        for (let k = 0; k < m.frames.length; k++) {
          const [rgba, em] = light(src, null, m.kind, k);
          m.frames[k].set(rgba);
          m.ems[k].set(em);
        }
      }
    },
  };
}
