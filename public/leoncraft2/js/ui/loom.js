/* ---------------------------------------------------------------------------
   Leoncraft 2 - the loom.

   As in the game (Minecraft Wiki, Loom; Java Edition): a banner, a dye and,
   if wanted, a banner pattern item go in on the left. With a banner in, the
   patterns show in the middle, four across and four down with a scroll bar
   (each drawn white on a grey banner); a pattern item shows only its own.
   Choosing one, with a dye in, puts the banner with that layer on top in
   the result slot and its picture on the right. Taking it uses the banner
   and the dye; the pattern item stays. A banner with six layers takes no
   more (a red cross). The sheet is ours (tools/leoncraft2/build_stations.py).
--------------------------------------------------------------------------- */
import { ContainerScreen, slot, range, TO_PLAYER } from './inventory.js?v=107';
import { withCount } from '../items.js?v=107';
import { isBanner, isDye, dyeOf, bannerColour, patternOfItem, LOOM_PATTERNS, MAX_LAYERS, drawFace } from '../banners.js?v=107';

const LABEL_GREY = 0x404040, SHEET = 'container/loom';
const MAIN = range(9, 36), HOT = range(0, 9);

export class LoomScreen extends ContainerScreen {
  constructor(inv, icons) {
    super(inv, icons, 176, 166);
    this.title = 'Loom';
    this.grid = [null, null, null]; this.gridW = 3;     // banner, dye, pattern item
    this.sel = -1; this.scroll = 0; this.dragging = false; this.lastBanner = 0; this.lastItem = null;
  }
  makeSlots() {
    const L = this.left, T = this.top, out = [slot(L + 13, T + 26, 'craft', 0), slot(L + 33, T + 26, 'craft', 1), slot(L + 23, T + 45, 'craft', 2), slot(L + 143, T + 58, 'result')];
    for (let j = 9; j < 36; j++) out.push(slot(L + 8 + (j % 9) * 18, T + 84 + Math.floor((j - 9) / 9) * 18, 'inv', j));
    for (let i = 0; i < 9; i++) out.push(slot(L + 8 + i * 18, T + 142, 'inv', i));
    return out;
  }
  mayPlace(s, st) {
    if (s.kind === 'craft' && st) return s.i === 0 ? isBanner(st) : s.i === 1 ? isDye(st) : !!patternOfItem(st);
    return super.mayPlace(s, st);
  }
  // the patterns on offer: a pattern item's own, or every one that needs none
  patterns() {
    if (!this.grid[0]) return [];
    const p = patternOfItem(this.grid[2]);
    return p ? [p] : LOOM_PATTERNS;
  }
  full() { const b = this.grid[0]; return !!b && (b.patterns || []).length >= MAX_LAYERS; }
  updateResult() {
    const b = this.grid[0], d = this.grid[1], list = this.patterns();
    // a new pattern item (or none) chooses again; with only one on offer it is chosen
    const item = this.grid[2] ? patternOfItem(this.grid[2]) : null;
    if (item !== this.lastItem) { this.lastItem = item; this.sel = item ? 0 : -1; this.scroll = 0; }
    if (!b) { this.sel = item ? 0 : -1; }
    this.result = null;
    if (!b || !d || this.sel < 0 || this.sel >= list.length || this.full()) return;
    const out = withCount(b, 1);
    out.patterns = (b.patterns || []).map(x => x.slice()).concat([[list[this.sel], dyeOf(d)]]);
    this.result = { stack: out };
  }
  craftOnce() {
    if (!this.result) return null;
    const out = withCount(this.result.stack, 1);
    for (const k of [0, 1]) { this.grid[k].count--; if (this.grid[k].count <= 0) this.grid[k] = null; }
    this.updateResult();
    return out;
  }
  quickMove(s) {
    if (s.kind === 'result') { this.shiftResult(); return; }
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'craft') this.moveInto(st, TO_PLAYER);
    else if (s.kind === 'inv') {
      const k = isBanner(st) ? 0 : isDye(st) ? 1 : patternOfItem(st) ? 2 : -1;
      const have = k >= 0 ? this.grid[k] : null;
      if (k >= 0 && (!have || (have.id === st.id && !have.patterns && !st.patterns))) {
        const n = Math.min(st.count, (have ? 64 - have.count : 64), k === 2 ? 1 : 64);
        if (n > 0) { this.grid[k] = withCount(st, (have ? have.count : 0) + n); st.count -= n; }
      } else this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    }
    if (!st.count) this.setStack(s, null);
  }

  /* ---- the pattern list ---- */
  rows() { return Math.ceil(this.patterns().length / 4); }
  maxScroll() { return Math.max(0, this.rows() - 4); }
  patternAt(mx, my) {
    const x0 = this.left + 60, y0 = this.top + 13;
    if (mx < x0 || my < y0 || mx >= x0 + 56 || my >= y0 + 56) return -1;
    const i = (this.scroll + Math.floor((my - y0) / 14)) * 4 + Math.floor((mx - x0) / 14);
    return i < this.patterns().length ? i : -1;
  }
  extraClick(mx, my, button) {
    if (button !== 0) return false;
    const i = this.patternAt(mx, my);
    if (i >= 0) { this.sel = i; this.updateResult(); return true; }
    if (mx >= this.left + 119 && mx < this.left + 131 && my >= this.top + 13 && my < this.top + 69 && this.maxScroll() > 0) { this.dragging = true; this.scrollTo(my); return true; }
    return false;
  }
  scrollTo(my) { const t = Math.max(0, Math.min(1, (my - this.top - 13 - 7.5) / 41)); this.scroll = Math.round(t * this.maxScroll()); }
  mouseDragged(mx, my) { if (this.dragging) { this.scrollTo(my); return; } super.mouseDragged(mx, my); }
  mouseReleased(mx, my, button) { if (this.dragging) { this.dragging = false; return; } super.mouseReleased(mx, my, button); }
  mouseScrolled(mx, my, d) { if (this.maxScroll() <= 0) return false; this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll - Math.sign(d))); return true; }

  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit(SHEET, 0, 0, 176, 166, L, T);
    g.text(this.title, L + 8, T + 4, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    // the banner as it will be (or as it is)
    const b = this.grid[0];
    if (b) {
      const shown = this.result ? this.result.stack : b;
      drawFace(g.ctx, bannerColour(shown), shown.patterns, L + 141, T + 9, 1, 20, 40);
    }
    if (this.full()) g.blit(SHEET, 176, 16, 28, 21, L + 137, T + 19);
    // the patterns
    const list = this.patterns(), over = this.patternAt(mx, my);
    const rows = this.maxScroll();
    g.blit(SHEET, rows > 0 ? 176 : 188, 0, 12, 15, L + 119, T + 13 + (rows > 0 ? Math.floor(this.scroll / rows * 41) : 0));
    for (let k = 0; k < 16; k++) {
      const i = this.scroll * 4 + k;
      if (i >= list.length) break;
      const x = L + 60 + (k % 4) * 14, y = T + 13 + Math.floor(k / 4) * 14;
      g.blit(SHEET, 0, i === this.sel ? 180 : i === over ? 194 : 166, 14, 14, x, y);
      drawFace(g.ctx, 'gray', [[list[i], 'white']], x + 4, y + 1, 1, 6, 12);
    }
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}
