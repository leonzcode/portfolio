/* ---------------------------------------------------------------------------
   Leoncraft 2 - the cartography table.

   As in the game (Minecraft Wiki, Cartography Table; Java Edition): a filled
   map goes in the top slot and paper, an empty map or a glass pane in the
   bottom one:
     paper         zoomed out one level (to 4 at most; not a locked map):
                   a new map of the larger square, empty until explored
     empty map     two of the map (copies share what they show)
     glass pane    a locked copy, which no longer changes
   The middle shows the map as it will be. The sheet is ours
   (tools/leoncraft2/build_stations.py), the maps js/maps.js.
--------------------------------------------------------------------------- */
import { ContainerScreen, slot, range, TO_PLAYER } from './inventory.js?v=107';
import { ITEMS, withCount } from '../items.js?v=107';
import { MAPS, isFilledMap, drawMap } from '../maps.js?v=107';

const LABEL_GREY = 0x404040, SHEET = 'container/cartography_table';
const MAIN = range(9, 36), HOT = range(0, 9);
const nameOf = st => (st && ITEMS[st.id] ? ITEMS[st.id].name : '');

export class CartographyScreen extends ContainerScreen {
  constructor(inv, icons) {
    super(inv, icons, 176, 166);
    this.title = 'Cartography Table';
    this.grid = [null, null]; this.gridW = 2;
    this.op = null;
  }
  makeSlots() {
    const L = this.left, T = this.top, out = [slot(L + 15, T + 15, 'craft', 0), slot(L + 15, T + 52, 'craft', 1), slot(L + 145, T + 39, 'result')];
    for (let j = 9; j < 36; j++) out.push(slot(L + 8 + (j % 9) * 18, T + 84 + Math.floor((j - 9) / 9) * 18, 'inv', j));
    for (let i = 0; i < 9; i++) out.push(slot(L + 8 + i * 18, T + 142, 'inv', i));
    return out;
  }
  mayPlace(s, st) {
    if (s.kind === 'craft' && st) return s.i === 0 ? isFilledMap(st) : /^(paper|map|glass_pane)$/.test(nameOf(st));
    return super.mayPlace(s, st);
  }
  // what the two slots make: 'zoom', 'copy' or 'lock' (and whether it can be made)
  updateResult() {
    const m = this.grid[0], a = this.grid[1];
    this.op = null; this.result = null;
    if (!m || !a) return;
    const d = MAPS.get(m.map), n = nameOf(a);
    if (n === 'paper') this.op = 'zoom';
    else if (n === 'map') this.op = 'copy';
    else if (n === 'glass_pane') this.op = 'lock';
    if (!d) return;
    if (this.op === 'zoom' && (d.locked || d.scale >= 4)) return;
    if (this.op === 'lock' && d.locked) return;
    const out = withCount(m, this.op === 'copy' ? 2 : 1);
    this.result = { stack: out };
  }
  craftOnce() {
    if (!this.result) return null;
    const out = withCount(this.result.stack, this.result.stack.count);
    // a zoomed or locked map is a new map; a copy is the same one twice
    if (this.op === 'zoom') { const z = MAPS.zoomed(out.map); if (!z) return null; out.map = z.id; }
    else if (this.op === 'lock') { const c = MAPS.lockedCopy(out.map); if (!c) return null; out.map = c.id; }
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
      const k = isFilledMap(st) ? 0 : /^(paper|map|glass_pane)$/.test(nameOf(st)) ? 1 : -1;
      const have = k >= 0 ? this.grid[k] : null;
      if (k >= 0 && (!have || (have.id === st.id && have.map === st.map))) {
        const n = Math.min(st.count, 64 - (have ? have.count : 0));
        if (n > 0) { this.grid[k] = withCount(st, (have ? have.count : 0) + n); st.count -= n; }
      } else this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    }
    if (!st.count) this.setStack(s, null);
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit(SHEET, 0, 0, 176, 166, L, T);
    g.text(this.title, L + 8, T + 4, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const m = this.grid[0], d = m ? MAPS.get(m.map) : null;
    const ctx = g.ctx;
    if (d) {
      const paper = (x, y, s) => { g.fill(x - 1, y - 1, x + s + 1, y + s + 1, 0xFF5B4A33); g.fill(x, y, x + s, y + s, 0xFFE3D6B0); };
      if (this.op === 'copy' && this.result) {
        // two of them, one over the other
        paper(L + 69, T + 15, 50); drawMap(ctx, d, L + 72, T + 18, 44);
        paper(L + 81, T + 27, 50); drawMap(ctx, d, L + 84, T + 30, 44);
      } else if (this.op === 'zoom' && this.result) {
        // the map small in the middle of a bigger sheet
        paper(L + 69, T + 15, 62); drawMap(ctx, d, L + 85, T + 31, 30);
      } else {
        paper(L + 69, T + 15, 62); drawMap(ctx, d, L + 72, T + 18, 56);
        if (this.op === 'lock' && this.result) g.blit(SHEET, 176, 52, 28, 28, L + 103, T + 47);
      }
    }
    if (this.grid[0] && this.grid[1] && !this.result) g.blit(SHEET, 176, 0, 28, 21, L + 36, T + 34);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}
