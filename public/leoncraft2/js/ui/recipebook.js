/* ---------------------------------------------------------------------------
   Leoncraft 2 - the recipe book (the green book on the survival inventory
   and the crafting table), laid out as the game's: a panel 147 x 166 left
   of the screen, which moves right to make room (on a screen too narrow for
   both, the book takes the middle and the screen behind it is hidden); a
   search field and the Showing All / Showing Craftable button along its
   top; tabs down its left side (Search, Equipment, Building Blocks,
   Miscellaneous, Redstone); twenty recipes a page, five across, with page
   arrows under them. T (the chat key) jumps to the search field.

   It shows the recipes you have unlocked (js/recipes.js: a recipe is
   unlocked once you have carried any of its ingredients, with a New Recipes
   Unlocked! toast; /recipe gives and takes them) that fit the grid (2 x 2 in
   the inventory). One you have everything for sits on grey, one you have
   not on red; the craftable ones come first. Click one and its ingredients
   go into the grid from your inventory (what was in the grid goes back
   first); with Shift, as many sets as make a stack. One you cannot make
   shows faint in the grid instead, until something goes in it. As in the
   game, only plain stacks are used (nothing worn, enchanted or renamed).
   The drawing is our own; the book button is the one on our own sheet.
--------------------------------------------------------------------------- */
import { allRecipes } from '../crafting.js?v=107';
import { I, maxStack, withCount, displayName } from '../items.js?v=107';
import { known } from '../recipes.js?v=107';

const PW = 147, PH = 166;
const TABS = [
  { cat: null, title: 'Search', icons: ['compass'] },
  { cat: 'equipment', title: 'Equipment', icons: ['iron_axe', 'golden_sword'] },
  { cat: 'building', title: 'Building Blocks', icons: ['bricks'] },
  { cat: 'misc', title: 'Miscellaneous', icons: ['lava_bucket', 'apple'] },
  { cat: 'redstone', title: 'Redstone', icons: ['redstone'] },
];
// open or shut, the tab and the filter are remembered (for the inventory and the crafting table apart, as in the game)
const STORE = 'lc2_recipe_book';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { saved = {}; }
const store = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) { /* storage off */ } };

// stacks the book may use: nothing worn, enchanted or renamed
const plain = st => !!st && !st.dmg && !st.ench && !st.name && !st.trim;
// how many of each item, in plain stacks, the inventory (and the grid) hold
function counts(inv, grid) {
  const m = new Map();
  for (const st of inv.slots) if (plain(st)) m.set(st.id, (m.get(st.id) || 0) + st.count);
  if (grid) for (const st of grid) if (plain(st)) m.set(st.id, (m.get(st.id) || 0) + st.count);
  return m;
}
// the item each cell of a recipe takes (the most plentiful that fits), `times` over; null when there is not enough
function plan(r, avail, times = 1) {
  const left = new Map(avail), ids = [];
  for (const cell of r.cells) {
    if (!cell) { ids.push(0); continue; }
    let best = 0, bc = 0;
    for (const id of cell) { const c = left.get(id) || 0; if (c > bc) { bc = c; best = id; } }
    if (!best || bc < times) return null;
    left.set(best, bc - times);
    ids.push(best);
  }
  return ids;
}
const fits = (r, w) => (r.w ? r.w <= w && r.h <= w : r.n <= w * w);
// where cell j of a recipe goes in a grid w wide (shaped recipes from the top left)
const cellPos = (r, j, w) => (r.w ? Math.floor(j / r.w) * w + (j % r.w) : j);

export class RecipeBook {
  /* screen: a ContainerScreen with a grid; SearchField: the creative search box's class (ui/inventory.js);
     button(left, top, height): where the book button goes, as [x, y] */
  constructor(screen, SearchField, button) {
    this.s = screen;
    this.kind = screen.gridW === 2 ? 'inventory' : 'crafting';
    this.buttonAt = button;
    this.page = 0; this.pages = 1;
    this.ghost = null;
    this.list = [];
    this.sig = '';
    const st = saved[this.kind] || {};
    this.isOpen = !!st.open; this.tab = st.tab | 0; this.craftable = !!st.craftable;
    if (this.tab < 0 || this.tab >= TABS.length) this.tab = 0;
    this.search = new SearchField(0, 0, 76, 9, { maxLength: 50, onChange: () => { this.page = 0; this.sig = ''; } });
  }
  remember() { saved[this.kind] = { open: this.isOpen, tab: this.tab, craftable: this.craftable }; store(); }
  // after the screen's own init: where everything goes (the screen moves right while the book is open)
  layout() {
    const s = this.s, w = s.width;
    this.narrow = w < 379;
    if (this.isOpen && !this.narrow) {
      s.left = 177 + Math.floor((w - s.imageWidth - 200) / 2);
      s.slots = s.makeSlots();
    }
    this.x = Math.floor((w - PW) / 2) - (this.narrow ? 0 : 86);
    this.y = Math.floor((s.height - PH) / 2);
    this.search.x = this.x + 27; this.search.y = this.y + 16;
    this.search.gui = s.gui;
    const [bx, by] = this.buttonAt(s.left, s.top, s.height);
    this.bx = bx; this.by = by;
    this.sig = '';
  }
  covers() { return this.isOpen && this.narrow; }
  typing() { return !!(this.s.gui && this.s.gui.textFocus === this.search); }
  toggle() {
    this.isOpen = !this.isOpen;
    this.remember();
    if (!this.isOpen) this.close();
    if (this.s.gui) this.s.gui._initScreen(this.s);
  }
  close() { if (this.typing()) this.s.gui._blurText(); this.ghost = null; }

  // the recipes on show: unlocked, in the tab, fitting the grid, matching the search, craftable if asked
  refresh() {
    const s = this.s, K = known(), un = K ? K.unlockedRecipes() : null, avail = counts(s.inv, s.grid);
    const tab = TABS[this.tab], q = this.search.value.trim().toLowerCase();
    const out = [];
    if (un) for (const r of allRecipes()) {
      if (!r.id || !un.has(r) || !fits(r, s.gridW)) continue;
      if (tab.cat && r.cat !== tab.cat) continue;
      if (q && displayName(r.id).toLowerCase().indexOf(q) < 0) continue;
      const ok = !!plan(r, avail);
      if (this.craftable && !ok) continue;
      out.push({ r, ok });
    }
    out.sort((a, b) => (b.ok - a.ok) || (a.r.index - b.r.index));
    this.list = out;
    this.pages = Math.max(1, Math.ceil(out.length / 20));
    if (this.page >= this.pages) this.page = this.pages - 1;
  }
  // worked out again only when something it depends on has changed
  check() {
    const s = this.s, K = known();
    let k = this.tab + ':' + this.craftable + ':' + this.search.value + ':' + (K ? K.recipeCount() : 0) + '|';
    for (const st of s.inv.slots) k += st ? st.id + 'x' + st.count + ',' : ',';
    if (s.grid) for (const st of s.grid) k += st ? st.id + 'x' + st.count + ',' : ',';
    if (k !== this.sig) { this.sig = k; this.refresh(); }
  }

  /* ---- drawing ---- */
  drawButton(g, mx, my) {
    const x = this.bx, y = this.by, over = mx >= x && my >= y && mx < x + 20 && my < y + 18;
    g.blit('container/inventory', 178, over ? 19 : 0, 20, 18, x, y);
  }
  render(g, mx, my) {
    if (!this.isOpen) return;
    this.check();
    const x = this.x, y = this.y, icons = this.s.icons, carried = !!this.s.inv.carried;
    // the tabs down the left, the chosen one pulled out
    TABS.forEach((t, i) => {
      const sel = i === this.tab, tx = x - 30 - (sel ? 2 : 0), ty = y + 3 + i * 27;
      g.fill(tx, ty, tx + 33, ty + 26, 0xFF000000);
      g.fill(tx + 1, ty + 1, tx + 33, ty + 25, sel ? 0xFFC6C6C6 : 0xFF8B8B8B);
      g.fill(tx + 1, ty + 1, tx + 33, ty + 3, sel ? 0xFFFFFFFF : 0xFFA8A8A8);
      g.fill(tx + 1, ty + 1, tx + 3, ty + 25, sel ? 0xFFFFFFFF : 0xFFA8A8A8);
      const two = t.icons.length > 1;
      t.icons.forEach((n, k) => { if (I[n] !== undefined && icons) icons.draw(g, I[n], tx + (two ? 4 + k * 10 : 9), ty + 5); });
      if (!carried && mx >= tx && my >= ty && mx < tx + 33 && my < ty + 26) g.setTooltip([t.title]);
    });
    // the panel
    g.fill(x, y, x + PW, y + PH, 0xFF000000);
    g.fill(x + 1, y + 1, x + PW - 1, y + PH - 1, 0xFFC6C6C6);
    g.fill(x + 1, y + 1, x + PW - 2, y + 3, 0xFFFFFFFF); g.fill(x + 1, y + 1, x + 3, y + PH - 2, 0xFFFFFFFF);
    g.fill(x + 3, y + PH - 3, x + PW - 1, y + PH - 1, 0xFF555555); g.fill(x + PW - 3, y + 3, x + PW - 1, y + PH - 1, 0xFF555555);
    // the search field
    const focused = this.typing();
    g.fill(x + 24, y + 13, x + 106, y + 28, focused ? 0xFFFFFFFF : 0xFFA0A0A0);
    g.fill(x + 25, y + 14, x + 105, y + 27, 0xFF000000);
    if (this.search.value || focused) this.search.draw(g);
    else g.text('Search...', x + 27, y + 16, 0x808080, false);
    // Showing All / Showing Craftable
    const fx = x + 110, fy = y + 12, over = mx >= fx && my >= fy && mx < fx + 26 && my < fy + 16;
    g.fill(fx, fy, fx + 26, fy + 16, 0xFF000000);
    g.fill(fx + 1, fy + 1, fx + 25, fy + 15, this.craftable ? (over ? 0xFF5FA84A : 0xFF4C8B3A) : (over ? 0xFFA8A8A8 : 0xFF8B8B8B));
    g.fill(fx + 1, fy + 1, fx + 25, fy + 2, 0xFFFFFFFF);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.fill(fx + 7 + i * 4, fy + 3 + j * 4, fx + 10 + i * 4, fy + 6 + j * 4, this.craftable ? 0xFFFFFFFF : 0xFFE0E0E0);
    if (over && !carried) g.setTooltip([this.craftable ? 'Showing Craftable' : 'Showing All']);
    // the recipes
    let hover = null;
    this.list.slice(this.page * 20, this.page * 20 + 20).forEach((e, i) => {
      const bx = x + 11 + (i % 5) * 25, by = y + 31 + Math.floor(i / 5) * 25;
      const o = mx >= bx && my >= by && mx < bx + 25 && my < by + 25;
      g.fill(bx, by, bx + 25, by + 25, 0xFF373737);
      g.fill(bx + 1, by + 1, bx + 24, by + 24, e.ok ? (o ? 0xFFBDBDBD : 0xFFA5A5A5) : (o ? 0xFFC46A6A : 0xFFA94F4F));
      g.fill(bx + 1, by + 1, bx + 24, by + 2, e.ok ? 0xFFE2E2E2 : 0xFFD08A8A);
      g.fill(bx + 1, by + 1, bx + 2, by + 24, e.ok ? 0xFFE2E2E2 : 0xFFD08A8A);
      if (icons) icons.draw(g, e.r.id, bx + 4, by + 4);
      if (e.r.count > 1) { const t = String(e.r.count); g.text(t, bx + 21 - g.textWidth(t), by + 13, 0xFFFFFF, true); }
      if (o) hover = e;
    });
    if (!this.list.length) g.centered(this.craftable ? 'Nothing you can make' : 'No recipes yet', x + PW / 2, y + 78, 0x404040, false);
    // the pages
    if (this.pages > 1) {
      g.centered((this.page + 1) + '/' + this.pages, x + 73, y + 141, 0xFFFFFF, true);
      if (this.page > 0) arrow(g, x + 38, y + 137, -1, mx, my);
      if (this.page < this.pages - 1) arrow(g, x + 93, y + 137, 1, mx, my);
    }
    if (hover && !carried) g.setTooltip([displayName(hover.r.id)]);
  }
  // a recipe that could not be made, faint in the grid until something goes in
  drawGhost(g) {
    const gh = this.ghost, s = this.s, icons = s.icons;
    if (!gh || !s.grid || !icons) return;
    if (s.grid.some(Boolean)) { this.ghost = null; return; }
    const pick = cell => { const a = [...cell]; return a[Math.floor(performance.now() / 1000) % a.length]; };
    gh.cells.forEach((cell, j) => {
      if (!cell) return;
      const sl = s.slots.find(o => o.kind === 'craft' && o.i === cellPos(gh, j, s.gridW));
      if (!sl) return;
      g.fill(sl.x, sl.y, sl.x + 16, sl.y + 16, 0x30FF0000);
      icons.draw(g, pick(cell), sl.x, sl.y);
      g.fill(sl.x, sl.y, sl.x + 16, sl.y + 16, 0x80C6C6C6);
    });
    const res = s.slots.find(o => o.kind === 'result');
    if (res) {
      g.fill(res.x - 4, res.y - 4, res.x + 20, res.y + 20, 0x30FF0000);
      icons.draw(g, gh.id, res.x, res.y);
      g.fill(res.x, res.y, res.x + 16, res.y + 16, 0x80C6C6C6);
    }
  }

  /* ---- input ---- */
  // a click: the book button, or anything in the book; false when it was not the book's
  mouse(mx, my, button, shift) {
    if (mx >= this.bx && my >= this.by && mx < this.bx + 20 && my < this.by + 18) { this.toggle(); click(); return true; }
    if (!this.isOpen) return false;
    const x = this.x, y = this.y;
    for (let i = 0; i < TABS.length; i++) {
      const tx = x - 32, ty = y + 3 + i * 27;
      if (mx >= tx && mx < tx + 35 && my >= ty && my < ty + 26) {
        if (i !== this.tab) { this.tab = i; this.page = 0; this.remember(); this.sig = ''; click(); }
        return true;
      }
    }
    if (mx < x || my < y || mx >= x + PW || my >= y + PH) return this.covers();
    if (mx >= x + 24 && my >= y + 13 && mx < x + 106 && my < y + 28) {
      if (!this.search.mouseClicked(mx, my, button)) this.s.gui.focusText(this.search);
      return this.search;
    }
    if (mx >= x + 110 && my >= y + 12 && mx < x + 136 && my < y + 28) { this.craftable = !this.craftable; this.page = 0; this.remember(); this.sig = ''; click(); return true; }
    if (this.pages > 1 && my >= y + 137 && my < y + 154) {
      if (mx >= x + 36 && mx < x + 50 && this.page > 0) { this.page--; click(); return true; }
      if (mx >= x + 91 && mx < x + 105 && this.page < this.pages - 1) { this.page++; click(); return true; }
    }
    if (mx >= x + 11 && mx < x + 136 && my >= y + 31 && my < y + 131 && button === 0) {
      const i = Math.floor((mx - x - 11) / 25) + 5 * Math.floor((my - y - 31) / 25);
      const e = this.list[this.page * 20 + i];
      if (e && !this.s.inv.carried) { this.place(e.r, !!shift); click(); }
    }
    return true;
  }
  /* A key: true (used), false (left to the search field), null (the screen's own) */
  key(e) {
    if (e.key === 'Escape') return null;
    if (this.typing()) return false;
    if (!this.isOpen) return null;
    const o = this.s.gui && this.s.gui.options, keys = (o && o.get('keys')) || {};
    if (e.code === (keys.chat || 'KeyT') && !e.ctrlKey && !e.metaKey && !e.altKey) { this.s.gui.focusText(this.search); return true; }
    return null;
  }

  /* The recipe into the grid: what the grid held goes back first; then a set of its ingredients (with
     `all`, as many sets as make a stack) from the inventory; or the ghost when there is not enough. */
  place(r, all) {
    const s = this.s, inv = s.inv, grid = s.grid;
    if (!grid) return;
    for (let i = 0; i < grid.length; i++) if (grid[i]) { const st = grid[i]; grid[i] = null; inv.placeBack(st); }
    const avail = counts(inv, null), ids = plan(r, avail);
    this.ghost = null;
    if (!ids) { this.ghost = r; s.updateResult(); inv.changed(); return; }
    let times = 1;
    if (all) {
      let most = 64;
      for (const id of ids) if (id) most = Math.min(most, maxStack(id));
      for (times = most; times > 1 && !plan(r, avail, times); times--);
    }
    const want = plan(r, avail, times);
    want.forEach((id, j) => {
      if (!id) return;
      let need = times, got = null;
      for (let k = 0; k < inv.slots.length && need > 0; k++) {
        const st = inv.slots[k];
        if (!st || st.id !== id || !plain(st)) continue;
        const n = Math.min(need, st.count);
        if (!got) got = withCount(st, 0);
        got.count += n; need -= n; st.count -= n;
        if (st.count <= 0) inv.slots[k] = null;
      }
      if (got) grid[cellPos(r, j, s.gridW)] = got;
    });
    s.updateResult();
    inv.changed();
    this.sig = '';
  }
}

// a page arrow, drawn in pixels: light grey, white under the pointer
function arrow(g, x, y, dir, mx, my) {
  const over = mx >= x - 2 && mx < x + 12 && my >= y && my < y + 17, c = over ? 0xFFFFFFFF : 0xFFD0D0D0;
  for (let i = 0; i < 7; i++) {
    const h = 13 - i * 2, cx = dir > 0 ? x + 2 + i : x + 8 - i;
    g.fill(cx, y + 2 + i, cx + 1, y + 2 + i + h, c);
  }
}
// the widgets' click
const click = () => {
  const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound;
  if (S) try { S.near('ui.button.click', 0.25, 1, 'ui'); } catch (e) { /* no sound */ }
};
