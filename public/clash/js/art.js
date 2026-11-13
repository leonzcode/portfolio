/* Leon Clash: sprites. Units come from atlases built by tools/clash/build_sprites.py
   (assets/units.json + .webp). Each sprite has animations walk / attack / death,
   four directions (rows up, left, down, right), frames trimmed with offsets.
   Anything without a sprite yet is drawn as a token so the game always runs. */

const V = "?v=1";
export const art = {
  ready: false,
  sheets: {},        // key -> { img, meta }
  cards: null,       // card portraits sheet { img, meta }
  env: null,         // trees, rocks, ice
};

function loadImg(src) {
  return new Promise(function (res) {
    const i = new Image();
    i.onload = function () { res(i); };
    i.onerror = function () { res(null); };
    i.src = src;
  });
}

export async function loadArt(base) {
  try {
    const r = await fetch(base + "assets/atlas.json" + V);
    if (!r.ok) throw new Error("no atlas");
    const meta = await r.json();
    const imgs = await Promise.all(meta.images.map(function (n) { return loadImg(base + "assets/" + n + V); }));
    if (imgs.some(function (i) { return !i; })) throw new Error("atlas page missing");
    art.imgs = imgs;
    for (const key in meta.sprites) art.sheets[key] = { meta: meta.sprites[key] };
    if (meta.cards) art.cards = { meta: meta.cards };
    if (meta.env) art.env = { meta: meta.env };
    art.ready = true;
  } catch (e) {
    art.ready = false;
  }
  return art;
}

// LPC rows: 0 up, 1 left, 2 down, 3 right. Sim faces: 0 down, 1 left, 2 right, 3 up.
const ROW = [2, 1, 3, 0];
export function rowFor(face, flipView) {
  let f = face;
  if (flipView) f = f === 0 ? 3 : f === 3 ? 0 : f === 1 ? 2 : 1;
  return ROW[f];
}

/* draw one frame of a sprite with its feet at (x, y); returns false when the
   sprite is missing so the caller can fall back to a token */
export function drawSprite(ctx, key, anim, row, phase, x, y, scale, tint) {
  const sh = art.sheets[key];
  if (!sh) return false;
  const A = sh.meta.anims[anim] || sh.meta.anims.walk;
  if (!A) return false;
  const rows = A.f;
  let r = row;
  let mirror = false;
  if (rows.length === 1) r = 0;
  else if (!rows[r] || !rows[r].length) {
    // sheets without a right row: mirror the left one
    if (r === 3 && rows[1] && rows[1].length) { r = 1; mirror = true; }
    else r = 2;
  }
  const fr = rows[r];
  if (!fr || !fr.length) return false;
  let i = Math.floor(phase * fr.length);
  if (i >= fr.length) i = fr.length - 1;
  if (i < 0) i = 0;
  const f = fr[i];            // [sx, sy, sw, sh, ox, oy, page]
  const img = art.imgs[f[6] || 0];
  const s = scale * (sh.meta.scale || 1);
  const ax = sh.meta.ax, ay = sh.meta.ay;
  const dw = f[2] * s, dh = f[3] * s;
  let dx = x + (f[4] - ax) * s, dy = y + (f[5] - ay) * s;
  if (mirror) {
    ctx.save();
    ctx.translate(x, 0);
    ctx.scale(-1, 1);
    dx = (f[4] - ax) * s;
    ctx.drawImage(img, f[0], f[1], f[2], f[3], dx, dy, dw, dh);
    if (tint) { ctx.globalAlpha = tint; ctx.globalCompositeOperation = "lighter"; ctx.drawImage(img, f[0], f[1], f[2], f[3], dx, dy, dw, dh); }
    ctx.restore();
    return true;
  }
  ctx.drawImage(img, f[0], f[1], f[2], f[3], dx, dy, dw, dh);
  if (tint) {
    const ga = ctx.globalAlpha, gc = ctx.globalCompositeOperation;
    ctx.globalAlpha = tint; ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(img, f[0], f[1], f[2], f[3], dx, dy, dw, dh);
    ctx.globalAlpha = ga; ctx.globalCompositeOperation = gc;
  }
  return true;
}
export function spriteHeight(key, scale) {
  const sh = art.sheets[key];
  if (!sh) return 40 * scale;
  return (sh.meta.h || 48) * scale * (sh.meta.scale || 1);
}
export function animLen(key, anim) {
  const sh = art.sheets[key];
  if (!sh) return 0;
  const A = sh.meta.anims[anim];
  return A ? A.f[0].length || (A.f[2] && A.f[2].length) || 0 : 0;
}

// card portrait into a canvas context at (x, y, w, h)
export function drawCardArt(ctx, id, x, y, w, h) {
  if (!art.cards) return false;
  const c = art.cards.meta.cells[id];
  if (!c) return false;
  ctx.drawImage(art.imgs[c[4] || 0], c[0], c[1], c[2], c[3], x, y, w, h);
  return true;
}
export function envSprite(name) {
  if (!art.env) return null;
  const c = art.env.meta.cells[name];
  return c ? { img: art.imgs[c[4] || 0], c: c } : null;
}
