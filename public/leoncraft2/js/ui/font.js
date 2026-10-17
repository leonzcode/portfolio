/* Leoncraft 2 - the GUI font.

   A bitmap font read from textures/gui/font_ascii.png: Pixel Perfection CE's
   font sheet (CC BY-SA 4.0), recoloured to white so it can be tinted to any
   colour. 16 x 16 cells of 8 x 8 pixels in code page 437 order, the layout the
   pack's sheet uses. Each glyph's width is measured from its own pixels (the
   rightmost column with ink), and a glyph advances its width plus one, a
   space four, which is how the classic block-game font spaces its letters.

   Text is drawn in GUI pixels on a 2D context whose transform already holds
   the GUI scale, so every glyph lands on whole device pixels.

   Colour codes: "§" + one of 0-9 a-f sets the colour, l bold, n underline,
   r resets, as in the chat format players know.
--------------------------------------------------------------------------- */

// code page 437 from 128 up, so accented letters and a few symbols find their cell
const CP437_HI =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αβΓπΣσμτΦΘΩδ∞∅∈∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export const FORMAT_COLOURS = [
  0x000000, 0x0000AA, 0x00AA00, 0x00AAAA, 0xAA0000, 0xAA00AA, 0xFFAA00, 0xAAAAAA,
  0x555555, 0x5555FF, 0x55FF55, 0x55FFFF, 0xFF5555, 0xFF55FF, 0xFFFF55, 0xFFFFFF,
  // two of our own after the game's sixteen: g bronze and h silver (Leonpixel's leaderboard titles)
  0xCD7F32, 0xC9D1DA,
];
const CODES = '0123456789abcdefgh';

const cssCache = new Map();
export function cssRGB(rgb) {
  let s = cssCache.get(rgb);
  if (!s) { s = '#' + (rgb & 0xFFFFFF).toString(16).padStart(6, '0'); cssCache.set(rgb, s); }
  return s;
}

export class Font {
  constructor(img) {
    this.img = img;
    this.lineHeight = 9;
    this.cell = img.width / 16;
    // unicode -> cell index, and each cell's advance (0 = empty cell)
    this.map = new Map();
    for (let i = 32; i < 127; i++) this.map.set(i, i);
    for (let i = 0; i < CP437_HI.length; i++) this.map.set(CP437_HI.charCodeAt(i), 128 + i);
    this.adv = new Uint8Array(256);
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    /* A cross (✘) where the sheet has none, drawn in the empty × cell, for the
       minigames' scoreboards (net/hub.js); ✔ is the sheet's own √. */
    const xc = 128 + CP437_HI.indexOf('×'), n0 = img.width / 16;
    if (xc >= 128) {
      const CROSS = ['X.....X', 'XX...XX', '.XX.XX.', '..XXX..', '.XX.XX.', 'XX...XX', 'X.....X'];
      const cx0 = (xc & 15) * n0, cy0 = (xc >> 4) * n0, k = n0 / 8;
      let empty = true;
      const cell = g.getImageData(cx0, cy0, n0, n0).data;
      for (let i = 3; i < cell.length; i += 4) if (cell[i]) { empty = false; break; }
      if (empty) {
        g.fillStyle = '#fff';
        CROSS.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === 'X') g.fillRect(cx0 + x * k, cy0 + y * k, k, k); });
        img = c;
      }
      this.map.set(0x2718, xc); this.map.set(0x2717, xc);
      this.map.set(0x2714, 128 + CP437_HI.indexOf('√')); this.map.set(0x2713, 128 + CP437_HI.indexOf('√'));
    }
    this.img = img;
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const n = this.cell;
    for (let ch = 0; ch < 256; ch++) {
      const cx = (ch & 15) * n, cy = (ch >> 4) * n;
      let right = -1;
      for (let x = n - 1; x >= 0 && right < 0; x--) {
        for (let y = 0; y < n; y++) if (px[((cy + y) * img.width + cx + x) * 4 + 3] > 0) { right = x; break; }
      }
      this.adv[ch] = right < 0 ? 0 : right + 2;
    }
    this.adv[32] = 4;
    this.adv[0xa0] = 4;
    this.tints = new Map();
    this.white = this.tinted(0xFFFFFF);
  }

  // the cell for a character, '?' when the sheet has nothing for it
  glyph(code) {
    const i = this.map.get(code);
    if (i === undefined || (this.adv[i] === 0 && i !== 32)) return 63;
    return i;
  }

  // a copy of the sheet in one colour, made once per colour
  tinted(rgb) {
    let t = this.tints.get(rgb);
    if (t) return t;
    t = document.createElement('canvas');
    t.width = this.img.width; t.height = this.img.height;
    const g = t.getContext('2d');
    g.drawImage(this.img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#' + (rgb & 0xFFFFFF).toString(16).padStart(6, '0');
    g.fillRect(0, 0, t.width, t.height);
    this.tints.set(rgb, t);
    return t;
  }

  width(str) {
    let w = 0, bold = false;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code === 0xa7 && i + 1 < str.length) {
        const f = str[++i].toLowerCase();
        if (f === 'l') bold = true; else if (f === 'r' || CODES.indexOf(f) >= 0) bold = false;
        continue;
      }
      w += this.adv[this.glyph(code)] + (bold ? 1 : 0);
    }
    return w;
  }

  // the longest start of str that fits in maxW pixels
  trim(str, maxW, fromEnd) {
    if (this.width(str) <= maxW) return str;
    if (fromEnd) { let i = 0; while (i < str.length && this.width(str.slice(i)) > maxW) i++; return str.slice(i); }
    let n = str.length;
    while (n > 0 && this.width(str.slice(0, n)) > maxW) n--;
    return str.slice(0, n);
  }

  // word wrap to lines no wider than maxW
  wrap(str, maxW) {
    const out = [];
    for (const para of String(str).split('\n')) {
      const words = para.split(' ');
      let line = '';
      for (const w of words) {
        const next = line ? line + ' ' + w : w;
        if (this.width(next) <= maxW || !line) {
          if (!line && this.width(w) > maxW) {
            // a single word wider than the box: break it by letters
            let rest = w;
            while (this.width(rest) > maxW) { const part = this.trim(rest, maxW) || rest[0]; out.push(part); rest = rest.slice(part.length); }
            line = rest;
          } else line = next;
        } else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  }

  /* Draws str with its top-left at (x, y) in GUI pixels. rgb is 0xRRGGBB.
     The shadow is the colour at a quarter brightness, one pixel down and right. */
  draw(ctx, str, x, y, rgb, shadow) {
    if (shadow) this._run(ctx, str, x + 1, y + 1, rgb, true);
    return this._run(ctx, str, x, y, rgb, false);
  }

  _run(ctx, str, x, y, rgb, isShadow) {
    const n = this.cell;
    let colour = rgb, bold = false, under = false;
    let sheet = this.tinted(isShadow ? (colour & 0xFCFCFC) >> 2 : colour);
    let cx = x;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code === 0xa7 && i + 1 < str.length) {
        const f = str[++i].toLowerCase();
        const k = CODES.indexOf(f);
        if (k >= 0) { colour = FORMAT_COLOURS[k]; bold = false; under = false; }
        else if (f === 'r') { colour = rgb; bold = false; under = false; }
        else if (f === 'l') bold = true;
        else if (f === 'n') under = true;
        sheet = this.tinted(isShadow ? (colour & 0xFCFCFC) >> 2 : colour);
        continue;
      }
      const gi = this.glyph(code);
      const adv = this.adv[gi] + (bold ? 1 : 0);
      if (gi !== 32) {
        const sx = (gi & 15) * n, sy = (gi >> 4) * n;
        ctx.drawImage(sheet, sx, sy, n, n, cx, y, n, n);
        if (bold) ctx.drawImage(sheet, sx, sy, n, n, cx + 1, y, n, n);
      }
      if (under) { ctx.fillStyle = cssRGB(isShadow ? (colour & 0xFCFCFC) >> 2 : colour); ctx.fillRect(cx - 1, y + 8, adv + 1, 1); }
      cx += adv;
    }
    return cx;
  }
}
