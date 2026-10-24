/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Advancements screen (L, or the game menu's button).

   Laid out as the game's: a 252 x 140 window in the middle of the screen,
   "Advancements" at its top left, the tree in the 234 x 113 inside (from
   9, 18), tabs of 28 x 32 along the top, 32 apart, each with its root's
   icon (only once there are two or more tabs). A tab's tree sits on its
   background tiled 16 x 16 (our own block pictures: stone, netherrack, end
   stone, sandstone and farmland); each advancement shown is its frame
   (task, goal or challenge, gold once made) 28 across and 27 down per step
   of the tree, with its icon in it; white lines with a black edge join each
   one to its parent. Dragging with the mouse, or the wheel, moves the tree
   (only as far as it reaches, and not at all on an axis where it fits);
   it opens centred. Over an advancement the tree darkens and a box shows
   its name on a bar (blue, gold once made, gold as far as its progress
   when it has several parts, with "n/m" at the end) and what it asks below
   (green, or purple for a challenge). With nothing to show yet: "There
   doesn't seem to be anything here..." and ":(".

   The frames, tabs and window are drawn here (pixels of our own), not
   taken from the game.
--------------------------------------------------------------------------- */
import { Screen } from '../ui/gui.js?v=107';
import { drawStack } from '../ui/inventory.js?v=107';
import { ADV } from './tracker.js?v=107';
import { iconStack } from './toast.js?v=107';

const WW = 252, WH = 140, IX = 9, IY = 18, IW = 234, IH = 113;
const BG = { stone: 'stone', nether: 'netherrack', end: 'end_stone', adventure: 'sandstone_top', husbandry: 'farmland' };
const DESC_COLOUR = { task: 0x55FF55, goal: 0x55FF55, challenge: 0xAA00AA };
let lastTab = null;             // the tab open last time (the game keeps it while it runs)
const tabState = new Map();     // root id -> { sx, sy, centred }

/* ---- the pictures, made once ---- */
const pic = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const d = x.createImageData(w, h); fn(d.data, w, h); x.putImageData(d, 0, 0); return c; };
const put = (d, w, x, y, c) => { const i = (y * w + x) * 4; d[i] = c >> 16 & 255; d[i + 1] = c >> 8 & 255; d[i + 2] = c & 255; d[i + 3] = 255; };
// how far each pixel of a shape is from its edge (0 the edge itself)
function depthOf(inside, n) {
  const dep = new Int16Array(n * n).fill(-1);
  const q = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!inside(x, y)) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const u = x + a, v = y + b; return u < 0 || v < 0 || u >= n || v >= n || !inside(u, v); });
    if (edge) { dep[y * n + x] = 0; q.push(x, y); }
  }
  for (let k = 0; k < q.length; k += 2) {
    const x = q[k], y = q[k + 1], v = dep[y * n + x];
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const u = x + a, w = y + b;
      if (u < 0 || w < 0 || u >= n || w >= n || !inside(u, w) || dep[w * n + u] >= 0) continue;
      dep[w * n + u] = v + 1; q.push(u, w);
    }
  }
  return dep;
}
const SHAPES = {
  // a square with its corners cut in two steps
  task: (x, y) => { const ax = Math.abs(x - 12.5), ay = Math.abs(y - 12.5); return ax <= 11.5 && ay <= 11.5 && ax + ay <= 21.5; },
  // a rounded square, its sides bowed (a squircle)
  goal: (x, y) => { const dx = (x - 12.5) / 12.6, dy = (y - 12.5) / 12.6; return dx ** 4 + dy ** 4 <= 1; },
  // a square with a point at each corner and a notch in each side
  challenge: (x, y) => {
    const ax = Math.abs(x - 12.5), ay = Math.abs(y - 12.5);
    const body = ax <= 10.5 && ay <= 10.5 && !(ax > 9 && ay > 9) && !(Math.min(ax, ay) < 2 && Math.max(ax, ay) > 9.5);
    const spike = Math.max(ax, ay) <= 12.5 && Math.abs(ax - ay) <= 1.5 && Math.min(ax, ay) >= 7;
    return body || spike;
  },
};
/* Shaded as the game shades its frames: a black edge, a one pixel bevel inside it (light along the
   top and left, dark along the bottom and right, a middle shade where the two meet on the other
   diagonal) and a flat face; gold once made, grey before */
const PALETTE = {
  made: { edge: 0x000000, light: 0xDBA213, dark: 0x493606, mid: 0xB98F2C, inner: 0xAA7E0F },
  open: { edge: 0x000000, light: 0xFFFFFF, dark: 0x555555, mid: 0xC6C6C6, inner: 0xC6C6C6 },
};
const FRAMES = {};
function frame(kind, made) {
  const k = kind + (made ? 1 : 0);
  if (FRAMES[k]) return FRAMES[k];
  const shape = SHAPES[kind] || SHAPES.task, P = made ? PALETTE.made : PALETTE.open;
  const dep = depthOf(shape, 26), at = (x, y) => (x < 0 || y < 0 || x > 25 || y > 25 ? -1 : dep[y * 26 + x]);
  FRAMES[k] = pic(26, 26, (d, w) => {
    for (let y = 0; y < 26; y++) for (let x = 0; x < 26; x++) {
      const v = dep[y * 26 + x];
      if (v < 0) continue;
      let c = P.inner;
      if (v === 0) c = P.edge;
      else if (v === 1) {
        const lit = at(x, y - 1) === 0 || at(x - 1, y) === 0, shade = at(x, y + 1) === 0 || at(x + 1, y) === 0;
        c = lit && !shade ? P.light : shade && !lit ? P.dark : x + y < 25 ? P.light : x + y > 25 ? P.dark : P.mid;
      }
      put(d, w, x, y, c);
    }
  });
  return FRAMES[k];
}
/* The classic grey panel's edge, as the game cuts it: two steps off the top left and bottom right
   corners, three off the other two; a black line, then two pixels of light (top, left) and of shade
   (bottom, right), a pixel of each tucked into its inner corner, and plain grey where they meet. */
function panelPixel(x, y, w, h, face) {
  const tl = x + y, tr = (w - 1 - x) + y, bl = x + (h - 1 - y), br = (w - 1 - x) + (h - 1 - y);
  if (tl < 2 || tr < 3 || bl < 3 || br < 2) return -1;
  if (tl === 2 || tr === 3 || bl === 3 || br === 2 || x === 0 || y === 0 || x === w - 1 || y === h - 1) return 0x000000;
  const light = x <= 2 || y <= 2 || (x === 3 && y === 3), dark = x >= w - 3 || y >= h - 3 || (x === w - 4 && y === h - 4);
  return light && dark ? face : light ? 0xFFFFFF : dark ? 0x555555 : face;
}
/* A tab above the window, 28 x 32 drawn 28 over its top: a closed one shows 25 of that, darker,
   standing on the window's edge; the open one is 4 taller and runs into the window */
const TABS = {};
function tabPic(selected) {
  const k = selected ? 1 : 0;
  if (TABS[k]) return TABS[k];
  TABS[k] = pic(28, 32, (d, w) => {
    for (let y = 0; y < 32; y++) for (let x = 0; x < 28; x++) {
      let c;
      if (selected) {
        // (its last rows join the window: its light runs into the window's, its shade turns the corner)
        if (y <= 28) c = panelPixel(x, y, 28, 64, 0xC6C6C6);
        else if (y === 31) c = 0xC6C6C6;
        else c = x <= 2 || x >= (y === 29 ? 27 : 26) ? 0xFFFFFF : x >= 25 ? 0x555555 : 0xC6C6C6;
      } else {
        if (y < 4 || y > 28) continue;
        c = y === 28 ? 0x000000 : panelPixel(x, y - 4, 28, 64, 0x8B8B8B);
      }
      if (c >= 0) put(d, w, x, y, c);
    }
  });
  return TABS[k];
}
// the window: the classic grey panel, and a sunken edge round the inside (dark above and left, pale below and right)
let WINDOW = null;
function windowPic() {
  if (WINDOW) return WINDOW;
  WINDOW = pic(WW, WH, (d, w) => {
    for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) {
      const inner = x >= IX && x < IX + IW && y >= IY && y < IY + IH;
      if (inner) continue;
      let c = panelPixel(x, y, WW, WH, 0xC6C6C6);
      if (c < 0) continue;
      const top = y === IY - 1 && x >= IX - 1 && x <= IX + IW, left = x === IX - 1 && y >= IY - 1 && y <= IY + IH;
      const bottom = y === IY + IH && x >= IX - 1 && x <= IX + IW, right = x === IX + IW && y >= IY - 1 && y <= IY + IH;
      if ((top && right) || (left && bottom)) c = 0x575757;
      else if (top || left) c = 0x202020;
      else if (bottom || right) c = 0x939393;
      put(d, w, x, y, c);
    }
  });
  return WINDOW;
}
// the tab backgrounds: 16 x 16 tiles cut from our own block pictures (the strip the terrain is drawn with)
const TILES = {};
let tileLoad = null;
function loadTiles(gui) {
  if (tileLoad) return tileLoad;
  const base = new URL('../../textures/', import.meta.url).href;
  tileLoad = Promise.all([fetch(base + 'manifest.json?v=107').then(r => r.json()), new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = base + 'terrain_albedo.png?v=107'; })])
    .then(([m, img]) => {
      for (const k in BG) {
        const t = m.textures[BG[k]];
        if (!t) continue;
        const c = document.createElement('canvas'); c.width = 16; c.height = 16;
        c.getContext('2d').drawImage(img, 0, t.layer * 16, 16, 16, 0, 0, 16, 16);
        TILES[k] = c;
      }
      if (gui) gui.markDirty ? gui.markDirty() : (gui.dirty = true);
    }).catch(e => console.warn('advancement backgrounds', e));
  return tileLoad;
}

/* the description over lines about as wide as the bar, as the game picks them: wrapped at the
   bar's width, then 10 and 25 narrower and wider, the first whose widest line is within 10 of the
   bar's width, or else the nearest */
function linesOf(font, text, want) {
  let best = null, bd = Infinity;
  for (const off of [0, 10, -10, 25, -25]) {
    const lines = text.split('\n').flatMap(p => font.wrap(p, Math.max(1, want - off)));
    const d = Math.abs(Math.max(0, ...lines.map(l => font.width(l))) - want);
    if (d <= 10) return lines;
    if (d < bd) { bd = d; best = lines; }
  }
  return best;
}
// the name as the game shows it in the box: cut to 163 wide
function titleOf(font, t) {
  if (font.width(t) <= 163) return t;
  let s = t;
  while (s.length && font.width(s) > 163) s = s.slice(0, -1);
  return s;
}

export class AdvancementsScreen extends Screen {
  constructor(progress, icons) {
    super('Advancements');
    this.p = progress; this.icons = icons;
    this.background = 'menu';
    this.fade = 0;
    this.drag = null;
    this.hoverId = null;
  }
  get animates() { return (this.hoverId ? this.fade < 0.3 : this.fade > 0) || !!(this.icons && this.icons.pending); }
  set animates(v) { }
  init() {
    this.left = Math.floor((this.width - WW) / 2);
    this.top = Math.floor((this.height - WH) / 2);
    loadTiles(this.gui);
    const tabs = this.p.tabs();
    if (!this.tab || !tabs.includes(this.tab)) this.tab = tabs.find(t => t.id === lastTab) || tabs[0] || null;
  }
  // the advancements of a tab now shown, with where each goes
  shown(root) {
    const vis = this.p.visibility(), out = [];
    const walk = a => { if (vis.get(a.id)) out.push(a); for (const c of a.children) walk(c); };
    walk(root);
    return out;
  }
  bounds(list) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const a of list) { const x = Math.floor(a.x * 28), y = Math.floor(a.y * 27); x0 = Math.min(x0, x); x1 = Math.max(x1, x + 28); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 27); }
    return { x0, x1, y0, y1 };
  }
  state(root) {
    let s = tabState.get(root.id);
    if (!s) { s = { sx: 0, sy: 0, centred: false }; tabState.set(root.id, s); }
    return s;
  }
  // move the tree by (dx, dy), as far as it reaches
  scroll(dx, dy) {
    if (!this.tab) return;
    const b = this.bounds(this.shown(this.tab)), s = this.state(this.tab);
    if (b.x1 - b.x0 > IW) s.sx = Math.max(-(b.x1 - IW), Math.min(-b.x0, s.sx + dx));
    if (b.y1 - b.y0 > IH) s.sy = Math.max(-(b.y1 - IH), Math.min(-b.y0, s.sy + dy));
  }
  tabAt(mx, my) {
    const tabs = this.p.tabs();
    if (tabs.length < 2) return null;
    for (let i = 0; i < tabs.length; i++) {
      // (the whole 28 x 32 of its picture, as the game takes it, the 4 over the window's edge too)
      const x = this.left + 32 * i, y = this.top - 28;
      if (mx >= x && mx < x + 28 && my >= y && my < y + 32) return tabs[i];
    }
    return null;
  }
  mouseClicked(mx, my, button) {
    const t = this.tabAt(mx, my);
    if (t && button === 0) { if (t !== this.tab) { this.tab = t; lastTab = t.id; this.gui.dirty = true; if (this.gui.hooks && this.gui.hooks.click) this.gui.hooks.click(); } return true; }
    const ix = this.left + IX, iy = this.top + IY;
    if (button === 0 && mx >= ix && mx < ix + IW && my >= iy && my < iy + IH) { this.drag = { x: mx, y: my }; this.dragging = { mouseDragged: () => {}, mouseReleased: () => {} }; return true; }
    return false;
  }
  mouseDragged(mx, my) {
    if (!this.drag) return;
    this.scroll(mx - this.drag.x, my - this.drag.y);
    this.drag = { x: mx, y: my };
  }
  mouseReleased() { this.drag = null; this.dragging = null; }
  mouseScrolled(mx, my, d) {
    if (!this.tab) return false;
    if (this.gui.wheelShift) this.scroll(d * 16, 0); else this.scroll(0, d * 16);
    return true;
  }
  keyPressed(e) {
    if (this.options && this.options.actionFor && this.options.actionFor(e.code) === 'advancements') { this.gui.back(); return true; }
    return super.keyPressed(e);
  }
  onClose() { if (this.tab) lastTab = this.tab.id; }

  render(g, mx, my, dt) {
    const L = this.left, T = this.top, tabs = this.p.tabs();
    if (this.tab && !tabs.includes(this.tab)) this.tab = tabs[0] || null;
    if (!this.tab && tabs.length) this.tab = tabs.find(t => t.id === lastTab) || tabs[0];
    const ix = L + IX, iy = T + IY;
    // the tree (or nothing yet)
    let hover = null, list = null, s = null;
    if (!this.tab) {
      g.fill(ix, iy, ix + IW, iy + IH, 0xFF000000);
      g.centered("There doesn't seem to be anything here...", ix + IW / 2, iy + 56 - 4, 0xFFFFFF);
      g.centered(':(', ix + IW / 2, iy + IH - 9, 0xFFFFFF);
    } else {
      list = this.shown(this.tab);
      s = this.state(this.tab);
      const b = this.bounds(list);
      if (!s.centred) { s.sx = Math.floor(IW / 2 - (b.x1 + b.x0) / 2); s.sy = Math.floor(IH / 2 - (b.y1 + b.y0) / 2); s.centred = true; this.scroll(0, 0); }
      const ox = ix + Math.floor(s.sx), oy = iy + Math.floor(s.sy);
      g.scissor(ix, iy, ix + IW, iy + IH);
      const tile = TILES[this.tab.bg || 'stone'];
      if (tile) {
        const m = ((Math.floor(s.sx) % 16) + 16) % 16, n = ((Math.floor(s.sy) % 16) + 16) % 16;
        for (let j = -1; j < 9; j++) for (let i = -1; i < 16; i++) g.ctx.drawImage(tile, ix + m + 16 * i, iy + n + 16 * j);
      } else g.fill(ix, iy, ix + IW, iy + IH, 0xFF000000);
      const pos = a => [ox + Math.floor(a.x * 28), oy + Math.floor(a.y * 27)];
      const shownSet = new Set(list);
      // the lines: their black edges first, then the white
      for (const pass of [0, 1]) for (const a of list) {
        const par = a.parent ? ADV.get(a.parent) : null;
        if (!par || !shownSet.has(par)) continue;
        const [px, py] = pos(par), [cx, cy] = pos(a);
        const x0 = px + 13, j = px + 26 + 4, y0 = py + 13, x1 = cx + 13, y1 = cy + 13;
        if (pass === 0) {
          g.fill(Math.min(x0, j), y0 - 1, Math.max(x0, j) + 1, y0 + 2, 0xFF000000);
          g.fill(Math.min(j - 1, x1), y1 - 1, Math.max(j - 1, x1) + 1, y1 + 2, 0xFF000000);
          g.fill(j - 1, Math.min(y0, y1), j + 2, Math.max(y0, y1) + 1, 0xFF000000);
        } else {
          g.fill(Math.min(x0, j), y0, Math.max(x0, j) + 1, y0 + 1, 0xFFFFFFFF);
          g.fill(Math.min(j, x1), y1, Math.max(j, x1) + 1, y1 + 1, 0xFFFFFFFF);
          g.fill(j, Math.min(y0, y1), j + 1, Math.max(y0, y1) + 1, 0xFFFFFFFF);
        }
      }
      // the advancements
      const inside = mx >= ix && mx < ix + IW && my >= iy && my < iy + IH;
      for (const a of list) {
        const [x, y] = pos(a);
        if (x > ix + IW || y > iy + IH || x + 30 < ix || y + 26 < iy) continue;
        g.ctx.drawImage(frame(a.frame, this.p.isMade(a.id)), x + 3, y);
        const st = iconStack(a);
        if (st) drawStack(g, this.icons, st, x + 8, y + 5);
        if (inside && mx >= x && mx <= x + 26 && my >= y && my <= y + 26) hover = a;
      }
      g.endScissor();
      // over one: the tree darkens, and its box
      this.hoverId = hover ? hover.id : null;
      const step = (dt || 16) / 1000;
      this.fade = hover ? Math.min(0.3, this.fade + step * 1.2) : Math.max(0, this.fade - step * 2.4);
      if (this.fade > 0) {
        g.scissor(ix, iy, ix + IW, iy + IH);
        g.fill(ix, iy, ix + IW, iy + IH, (Math.round(this.fade * 255) << 24) >>> 0);
        g.endScissor();
      }
    }
    // the window over it, its title, the tabs
    g.ctx.drawImage(windowPic(), L, T);
    g.text('Advancements', L + 8, T + 6, 0x404040, false);
    if (tabs.length > 1) {
      for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i], sel = t === this.tab, x = L + 32 * i, y = T - 28;
        g.ctx.drawImage(tabPic(sel), x, y);
        const st = iconStack(t);
        if (st) drawStack(g, this.icons, st, x + 6, y + 9);
      }
      const ht = this.tabAt(mx, my);
      if (ht) g.setTooltip([ht.title]);
    }
    if (hover) this.drawHover(g, hover, list, s, ix, iy);
  }

  /* The box over an advancement, as the game lays it out: a bar with its icon, name and progress, and a
     dark box with what it asks, under the bar (over it when there is no room below in the window),
     reaching right (or left when it would run off the screen); it may go past the window's edge. */
  drawHover(g, a, list, s, ix, iy) {
    const f = g.font, made = this.p.isMade(a.id), prog = this.p.progressText(a.id), pct = made ? 1 : this.p.percent(a.id);
    const title = titleOf(f, a.title), pw = prog ? f.width(prog) : 0;
    // (room kept for the progress at its widest: two spaces, the count's digits twice and the slash)
    const n = a.req.length, room = n > 1 ? f.width('  ') + f.width('0') * String(n).length * 2 + f.width('/') : 0;
    let want = 29 + f.width(title) + room;
    const lines = a.desc ? linesOf(f, a.desc, want) : [];
    for (const l of lines) want = Math.max(want, f.width(l));
    const width = want + 3 + 5;
    const x = ix + Math.floor(s.sx) + Math.floor(a.x * 28), y = iy + Math.floor(s.sy) + Math.floor(a.y * 27);
    const flip = x + width + 26 >= g.width;
    const left = flip ? x - width + 32 : x;
    const descH = 32 + lines.length * 9;
    const up = y + descH >= iy + IH;
    // the dark box for the description
    if (lines.length) {
      const by = up ? y + 26 - descH : y;
      box(g, left, by, width, descH, 0xFF000000, 0xFF555555, 0xFF555555, 0xFF212121);
      const colour = DESC_COLOUR[a.frame] || 0x55FF55;
      let ty = up ? by + 7 : y + 26;
      for (const l of lines) { g.text(l, left + 5, ty, colour, false); ty += 9; }
    }
    // the bar: gold as far as the progress, blue for the rest
    // (all gold when done or nearly, all blue under two pixels' worth, otherwise split there)
    const split = Math.floor(pct * width), gold = pct >= 1 || split > width - 2 ? 2 : split < 2 ? 0 : 1;
    const GOLD = [0xFF000000, 0xFFDBA213, 0xFF493606, 0xFFB98F2C], BLUE = [0xFF000000, 0xFF0489C1, 0xFF012E40, 0xFF036A96];
    if (gold !== 1) box(g, left, y, width, 26, ...(gold ? GOLD : BLUE));
    else {
      g.scissor(left, y, left + split, y + 26); box(g, left, y, width, 26, ...GOLD); g.endScissor();
      g.scissor(left + split, y, left + width, y + 26); box(g, left, y, width, 26, ...BLUE); g.endScissor();
    }
    g.ctx.drawImage(frame(a.frame, pct >= 1), x + 3, y);
    const st = iconStack(a);
    if (st) drawStack(g, this.icons, st, x + 8, y + 5);
    if (!flip) {
      g.text(title, x + 32, y + 9, 0xFFFFFF);
      if (prog) g.text(prog, x + width - pw - 5, y + 9, 0xFFFFFF);
    } else {
      g.text(title, left + 5, y + 9, 0xFFFFFF);
      if (prog) g.text(prog, x - pw, y + 9, 0xFFFFFF);
    }
  }
}
/* The game's bar and box: 3 clear rows above and below, then a black edge with its corners cut,
   a one pixel bevel (light along the top and left, dark along the bottom and right) and the face */
function box(g, x, y, w, h, edge, light, dark, face) {
  const t = y + 3, b = y + h - 3;
  g.fill(x + 2, t, x + w - 2, b, edge); g.fill(x + 1, t + 1, x + w - 1, b - 1, edge); g.fill(x, t + 2, x + w, b - 2, edge);
  g.fill(x + 2, t + 1, x + w - 2, t + 2, light); g.fill(x + 1, t + 2, x + 2, b - 2, light);
  g.fill(x + 2, b - 2, x + w - 2, b - 1, dark); g.fill(x + w - 2, t + 2, x + w - 1, b - 2, dark);
  g.fill(x + 2, t + 2, x + w - 2, b - 2, face);
}
