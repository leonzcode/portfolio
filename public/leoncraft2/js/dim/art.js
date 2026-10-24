/* ---------------------------------------------------------------------------
   Leoncraft 2 - our own art for the other dimensions, drawn in code.

   No Mojang files: the nether portal's swirl (16 frames), the eye of ender
   sitting in an end portal frame, the End's speckled sky, and the icons of
   flint and steel, the fire charge, the eye of ender and the end crystal are
   all made here, pixel by pixel, at start-up. The terrain texture arrays get
   a few extra layers for them (addDimArt, before the arrays are made), the
   pixels go in once the arrays are on the GPU (upload), and the icon strip
   gets the same layers (extendStrip).
--------------------------------------------------------------------------- */
import { litFronts } from '../render/litfront.js?v=107';
import { litBerries } from '../render/litberries.js?v=107';
import { bambooLayers } from '../render/bamboo.js?v=107';
import { shelfLayers } from '../render/shelfmushroom.js?v=107';
const THREE = window.THREE;

// a small seeded hash for the art (the same picture every time)
function h2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function img() { return new Uint8ClampedArray(16 * 16 * 4); }
function px(a, x, y, c, al) {
  if (x < 0 || y < 0 || x > 15 || y > 15) return;
  const o = (y * 16 + x) * 4;
  a[o] = (c >> 16) & 255; a[o + 1] = (c >> 8) & 255; a[o + 2] = c & 255; a[o + 3] = al === undefined ? 255 : al;
}
const mixc = (c1, c2, t) => {
  const r = ((c1 >> 16) & 255) + ((((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * t);
  const g = ((c1 >> 8) & 255) + ((((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * t);
  const b = (c1 & 255) + (((c2 & 255) - (c1 & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
};

/* The portal: purple streaks wheeling round two slowly drifting centres,
   seamless across blocks (the pattern wraps every 16 pixels), see-through. */
function portalFrames() {
  const out = [];
  const ramp = [0x2a0650, 0x4b0f8c, 0x6a1bc4, 0x8a3df0, 0xb27bff, 0xe0c0ff];
  for (let f = 0; f < 16; f++) {
    const a = img(), t = f / 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let v = 0;
      for (const [cx, cy, k, dir] of [[4, 5, 3, 1], [12, 11, 2, -1]]) {
        // the shortest way round the wrap, so neighbouring blocks join up
        let dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        dx -= Math.round(dx / 16) * 16; dy -= Math.round(dy / 16) * 16;
        const r = Math.hypot(dx, dy), an = Math.atan2(dy, dx);
        v += Math.sin(an * k + r * 0.9 - dir * t * Math.PI * 2) * Math.exp(-r / 9);
      }
      v += (h2(x, y, f >> 2) - 0.5) * 0.5;
      const s = clamp(v * 0.45 + 0.5, 0, 0.999);
      const c = ramp[Math.floor(s * ramp.length)];
      px(a, x, y, c, 170 + Math.round(s * 70));
    }
    out.push(a);
  }
  return out;
}

// the same swirl for the screen while you stand in a portal (dim/realms.js), made once
let swirl = null;
export function portalSwirl() { return swirl || (swirl = portalFrames()); }

/* The eye in a frame: rows 0-3 the eye's band seen from the side, rows 4-11
   (columns 4-11) the eye from above, a dark slit across a green iris. */
function frameEye() {
  const a = img();
  for (let x = 4; x < 12; x++) for (let y = 0; y < 3; y++) px(a, x, y, y === 0 ? 0x2f7d5c : h2(x, y, 9) < 0.3 ? 0x1d5a43 : 0x24684e);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
    const dx = x - 7.5, dy = y - 7.5, r = Math.hypot(dx, dy);
    let c = r > 3.6 ? 0x1f5c45 : r > 2.6 ? 0x2f8a63 : 0x4fc28c;
    if (Math.abs(dx) < 0.9 && Math.abs(dy) < 2.6) c = 0x0c1f16;
    if (h2(x, y, 3) < 0.12 && r < 3.6) c = mixc(c, 0x9fe8c2, 0.4);
    px(a, x, y, c);
  }
  return a;
}

/* ---- item icons ---- */
function flintAndSteel() {
  const a = img();
  // the steel: a grey C, open to the lower left
  const steel = [[7, 2], [8, 2], [9, 2], [10, 2], [11, 3], [12, 4], [12, 5], [12, 6], [11, 7], [10, 8], [6, 3], [5, 4], [5, 5]];
  for (const [x, y] of steel) { px(a, x, y, 0x9aa0a8); px(a, x + 1, y + 1, 0x5c6168); }
  for (const [x, y] of [[8, 3], [9, 3], [10, 3], [11, 4], [11, 5], [11, 6]]) px(a, x, y, 0xd6dbe0);
  // the flint: a dark chipped stone, lower left
  for (let y = 8; y < 14; y++) for (let x = 2; x < 8; x++) {
    const d = Math.abs(x - 4.5) + Math.abs(y - 10.8);
    if (d > 3.2) continue;
    px(a, x, y, d < 1.4 ? 0x5b5a58 : h2(x, y, 1) < 0.4 ? 0x3a3937 : 0x2a2928);
  }
  px(a, 3, 9, 0x7c7a77); px(a, 4, 9, 0x6c6a67);
  return a;
}
function fireCharge() {
  const a = img();
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
    const r = Math.hypot(x - 7.5, y - 7.5);
    if (r > 5.6) continue;
    const crack = Math.abs(Math.sin(x * 1.3 + y * 0.7) + Math.cos(y * 1.1 - x * 0.4)) < 0.35;
    const c = crack ? (r < 3 ? 0xffd040 : 0xff7a10) : r > 4.6 ? 0x1c1410 : h2(x, y, 5) < 0.3 ? 0x3a2418 : 0x2b1b12;
    px(a, x, y, c);
  }
  return a;
}
function enderEye() {
  const a = img();
  for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
    const dx = x - 7.5, dy = y - 7.5, r = Math.hypot(dx, dy);
    if (r > 5.8) continue;
    let c = r > 4.8 ? 0x1b5240 : r > 3.6 ? 0x2b7f5e : r > 2.2 ? 0x4cbc89 : 0x7ce0b0;
    if (Math.abs(dx) < 0.9 && Math.abs(dy) < 3.4) c = 0x0b1a13;
    if (dx < -1 && dy < -1 && r < 4.6 && r > 2.6) c = mixc(c, 0xd8ffe8, 0.45);
    px(a, x, y, c);
  }
  return a;
}
function endCrystal() {
  const a = img();
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
    if (d > 7) continue;
    const edge = d > 5.8;
    const core = Math.abs(x - 7.5) < 2 && Math.abs(y - 7.5) < 2;
    px(a, x, y, edge ? 0x6d4a7a : core ? 0xff9fe0 : h2(x, y, 7) < 0.25 ? 0xe6c8f2 : 0xc49ad6, edge ? 255 : 220);
  }
  return a;
}

/* The End's sky: a fine violet grain, every pixel its own (no blotches),
   wrapping, 128 to a side; drawn at 40/255, sixteen to a side of the sky's
   box, as the game draws its own. Our own noise, made to the look of the
   game's sky: a mean of about (115, 88, 156), the lightness spread so a
   twentieth of the pixels are under two thirds of it and a twentieth over a
   third more, a little more red in the light ones and blue in the dark, the
   green spread wider than the others (the game's picture spreads its red,
   green and blue by about 25, 24 and 28 of 255: measured from a local copy,
   which is never shipped or copied). It was a grey speckle in soft patches,
   which read as fog, not the End. */
export function endSkyTexture() {
  const N = 128, d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // three draws averaged: a bell round 1, most of it from 0.65 to 1.35
    const v = 1 + ((h2(x, y, 11) + h2(x, y, 12) + h2(x, y, 13)) / 3 - 0.5) * 1.15;
    const tint = (h2(x, y, 14) - 0.5) * 0.12;
    const o = (y * N + x) * 4;
    d[o] = clamp(Math.round(115 * v * (1 + tint)), 0, 255);
    d[o + 1] = clamp(Math.round(88 * (1 + (v - 1) * 1.45)), 0, 255);
    d[o + 2] = clamp(Math.round(156 * v * (1 - tint * 0.5)), 0, 255);
    d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/* Extra layers on the end of the terrain arrays: changes the manifest (call
   before resolveTextures and before the arrays are made) and returns what
   to upload once they exist. */
export function addDimArt(manifest) {
  const T = manifest.textures;
  const layers = [];          // [layer, rgba, emissive]
  let next = manifest.layers;
  const add = (name, frames, frametime, emissive) => {
    T[name] = { layer: next };
    if (frames.length > 1) { T[name].frames = frames.length; T[name].frametime = frametime; }
    // emissive: true (the whole picture glows), or one material picture per frame
    frames.forEach((f, i) => layers.push([next++, f, Array.isArray(emissive) ? emissive[i] : emissive]));
  };
  add('nether_portal', portalFrames(), 2, true);
  add('end_portal_frame_eye', [frameEye()], 1, false);
  add('lc2_flint_and_steel', [flintAndSteel()], 1, false);
  add('lc2_fire_charge', [fireCharge()], 1, false);
  add('lc2_ender_eye', [enderEye()], 1, false);
  add('lc2_end_crystal', [endCrystal()], 1, false);
  // lit furnaces, smokers and blast furnaces (render/litfront.js), filled from the strip in upload
  const lit = litFronts(add);
  // cave vines with glow berries (render/litberries.js), the same way
  const berries = litBerries(add);
  // a shelf mushroom's faces, small and large (render/shelfmushroom.js), filled at once
  shelfLayers(add);
  // bamboo's stalk and leaves (render/bamboo.js), our own pixels, filled at once
  bambooLayers(add);
  manifest.layers = next;
  return {
    layers,
    // the pixels into the arrays (albedo, and a flat normal and a plain or glowing material where those arrays exist)
    // (strip: the albedo strip as loaded, for the pictures made from our own: the lit fronts)
    upload(r, textures, strip) {
      lit.fill(strip, T);
      berries.fill(strip, T);
      const gl = r.getContext();
      const flat = new Uint8Array(16 * 16 * 4), spec = new Uint8Array(16 * 16 * 4), glow = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < 256; i++) { flat.set([128, 128, 255, 255], i * 4); spec.set([40, 10, 0, 0], i * 4); glow.set([40, 10, 0, 140], i * 4); }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      const put = (tex, layer, data) => {
        if (!tex || !tex.image || tex.image.depth <= layer) return;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.properties.get(tex).__webglTexture);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 16, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
      };
      for (const [layer, rgba, em] of layers) {
        put(textures.albedo, layer, new Uint8Array(rgba.buffer));
        put(textures.normal, layer, flat);
        put(textures.spec, layer, em && em.length ? em : em ? glow : spec);
      }
      for (const t of [textures.albedo, textures.normal, textures.spec]) {
        if (!t || !t.image || t.image.depth <= 1) continue;
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.properties.get(t).__webglTexture);
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      r.resetState();
    },
    // the icon strip (one 16 x 16 cell a layer, top to bottom) with the new layers drawn in
    extendStrip(alb) {
      const c = document.createElement('canvas');
      c.width = 16; c.height = next * 16;
      // kept on the CPU: the item icons read it straight back
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(alb, 0, 0);
      for (const [layer, rgba] of layers) g.putImageData(new ImageData(new Uint8ClampedArray(rgba), 16, 16), 0, layer * 16);
      return c;
    },
  };
}
