/* ---------------------------------------------------------------------------
   Leoncraft 2 - the trading screen.

   The game's (276 x 166; the sheet is ours, tools/leoncraft2/build_stations.py):
   the villager's trades down the left, seven at a time with a scroll bar;
   two payment slots and the result on the right, over the inventory; the
   villager's profession and level at the top, and its experience bar
   (with the part the chosen trade would add).

     clicking a trade      puts back what is in the payment slots and fills
                           them from the inventory with what it costs (main
                           rows first, then the hotbar), a stack at most each
     Space                 does that again for the chosen trade
     the result            appears when the payment slots hold what a trade
                           asks (the chosen one first), and is taken like a
                           crafting result; shift-click trades for as long as
                           the payment lasts
     sold out              the trade's arrow turns red and a red cross covers
                           the big arrow; it comes back when the villager works
     a lower price         the old count, struck through, and the new one beside it

   The screen closes if the villager is hurt, dies or is left behind.
--------------------------------------------------------------------------- */
import { ContainerScreen, slot, range, TO_PLAYER_REVERSED, drawStack, stackTooltip } from './inventory.js?v=107';
import { withCount, sameItem, maxStack } from '../items.js?v=107';
import * as T from '../trading.js?v=107';

const LABEL_GREY = 0x404040;
const SHEET = 'container/villager';
const SHOWN = 7;
// the inventory in the order the game fills payments from it: the three rows, then the hotbar
const FROM_INV = range(9, 36).concat(range(0, 9));

export class MerchantScreen extends ContainerScreen {
  /* v: the villager (entities/merchant.js); hooks: { player (its position), hero() (Hero of the Village level) } */
  constructor(inv, icons, v, hooks) {
    super(inv, icons, 276, 166);
    this.v = v; this.h = hooks || {};
    this.grid = [null, null]; this.gridW = 2;
    this.sel = -1; this.scrollOff = 0; this.active = null; this.dragging = false;
    this.hp = v.health;
    this.animates = true;                // the villager is watched every frame (hurt, gone, too far)
    v.startTrading(this.h.player || true);
  }
  get offers() { return this.v.offers; }
  hero() { return this.h.hero ? this.h.hero() : 0; }
  price(o) { return T.costA(o, this.v.rep(), this.hero()); }
  makeSlots() {
    const L = this.left, T0 = this.top, out = [slot(L + 136, T0 + 37, 'craft', 0), slot(L + 162, T0 + 37, 'craft', 1), slot(L + 220, T0 + 37, 'result')];
    for (let j = 9; j < 36; j++) out.push(slot(L + 108 + (j % 9) * 18, T0 + 84 + Math.floor((j - 9) / 9) * 18, 'inv', j));
    for (let i = 0; i < 9; i++) out.push(slot(L + 108 + i * 18, T0 + 142, 'inv', i));
    return out;
  }

  /* ---- what the payment buys ---- */
  // does a stack pay for a cost? (the item, and a potion's kind; the rest of what it carries does not matter)
  pays(st, cost) { return !!st && !!cost && st.id === cost.id && (!cost.potion || (st.potion || 'water') === cost.potion) && st.count >= cost.count; }
  satisfied(o, a, b) {
    if (!this.pays(a, this.price(o))) return false;
    return o.b ? this.pays(b, o.b) : !b;
  }
  find(a, b) {
    const L = this.offers;
    if (this.sel > 0 && this.sel < L.length) return this.satisfied(L[this.sel], a, b) ? L[this.sel] : null;
    for (const o of L) if (this.satisfied(o, a, b)) return o;
    return null;
  }
  updateResult() {
    let a = this.grid[0], b = this.grid[1];
    if (!a) { a = b; b = null; }
    this.active = null; this.result = null;
    if (!a) return;
    let o = this.find(a, b);
    if ((!o || T.outOfStock(o)) && b) o = this.find(b, a);
    if (o && !T.outOfStock(o)) { this.active = o; this.result = { stack: withCount(o.out, o.out.count) }; }
  }
  craftOnce() {
    const o = this.active;
    if (!o || T.outOfStock(o)) return null;
    const g = this.grid;
    let ia = 0, ib = 1;
    if (!this.satisfied(o, g[0], g[1])) { ia = 1; ib = 0; if (!this.satisfied(o, g[1], g[0])) return null; }
    const out = withCount(o.out, o.out.count);
    g[ia].count -= this.price(o).count; if (g[ia].count <= 0) g[ia] = null;
    if (o.b) { g[ib].count -= o.b.count; if (g[ib].count <= 0) g[ib] = null; }
    this.v.traded(o);
    this.updateResult();
    return out;
  }

  /* ---- choosing a trade ---- */
  choose(i) {
    const o = this.offers[i];
    if (!o) return;
    this.sel = i;
    // what is in the payment slots goes back first; if it cannot, nothing more happens
    for (let k = 0; k < 2; k++) {
      const st = this.grid[k];
      if (!st) continue;
      this.moveInto(st, TO_PLAYER_REVERSED);
      this.grid[k] = st.count > 0 ? st : null;
    }
    if (this.grid[0] || this.grid[1]) return;
    this.fill(0, this.price(o));
    if (o.b) this.fill(1, o.b);
  }
  fill(k, cost) {
    const inv = this.inv;
    for (const i of FROM_INV) {
      const s = inv.slots[i];
      if (!s || s.id !== cost.id || (cost.potion && (s.potion || 'water') !== cost.potion)) continue;
      const cur = this.grid[k];
      if (cur && !sameItem(withCount(cur, 1), withCount(s, 1))) continue;
      const max = maxStack(s.id), have = cur ? cur.count : 0, n = Math.min(max - have, s.count);
      if (n <= 0) break;
      this.grid[k] = withCount(s, have + n);
      s.count -= n;
      if (!s.count) inv.slots[i] = null;
      if (have + n >= max) break;
    }
  }

  /* ---- input ---- */
  buttonAt(mx, my) {
    const x = this.left + 5;
    if (mx < x || mx >= x + 88) return -1;
    const k = Math.floor((my - this.top - 18) / 20);
    if (my < this.top + 18 || k < 0 || k >= SHOWN) return -1;
    const i = this.scrollOff + k;
    return i < this.offers.length ? i : -1;
  }
  maxScroll() { return Math.max(0, this.offers.length - SHOWN); }
  inScrollbar(mx, my) { return mx >= this.left + 94 && mx < this.left + 100 && my >= this.top + 18 && my < this.top + 157; }
  extraClick(mx, my, button) {
    if (button !== 0) return false;
    const i = this.buttonAt(mx, my);
    if (i >= 0) { this.choose(i); return true; }
    if (this.inScrollbar(mx, my) && this.maxScroll() > 0) { this.dragging = true; this.scrollTo(my); return true; }
    return false;
  }
  scrollTo(my) {
    const n = this.maxScroll();
    const t = Math.max(0, Math.min(1, (my - this.top - 18 - 13.5) / (139 - 27)));
    this.scrollOff = Math.round(t * n);
  }
  mouseDragged(mx, my) { if (this.dragging) { this.scrollTo(my); return; } super.mouseDragged(mx, my); }
  mouseReleased(mx, my, button) { if (this.dragging) { this.dragging = false; return; } super.mouseReleased(mx, my, button); }
  mouseScrolled(mx, my, d) {
    if (this.maxScroll() <= 0) return false;
    this.scrollOff = Math.max(0, Math.min(this.maxScroll(), this.scrollOff - Math.sign(d)));
    return true;
  }
  keyPressed(e) {
    if (e.code === 'Space' && this.sel >= 0) { this.choose(this.sel); this.after(); return true; }
    return super.keyPressed(e);
  }
  onClose() { super.onClose(); this.v.stopTrading(); }

  /* ---- drawing ---- */
  render(g, mx, my) {
    // the villager gone, hurt or left behind: the screen closes
    const v = this.v, p = this.h.player;
    if (v.dead || v.removed || v.health < this.hp || (p && (p.pos.x - v.pos.x) ** 2 + (p.pos.y - v.pos.y) ** 2 + (p.pos.z - v.pos.z) ** 2 > 64)) { this.gui.back(); return; }
    this.drawBackdrop(g);
    const L = this.left, T0 = this.top;
    g.blit(SHEET, 0, 0, 276, 166, L, T0);
    // the titles
    const title = v.isTrader ? 'Wandering Trader' : (T.TITLES[v.profession] || 'Villager') + (v.vlevel >= 1 && v.vlevel <= 5 ? ' - ' + T.LEVEL_NAMES[v.vlevel - 1] : '');
    g.text(title, L + 187 - Math.floor(g.textWidth(title) / 2), T0 + 6, LABEL_GREY, false);
    g.text('Trades', L + 53 - Math.floor(g.textWidth('Trades') / 2), T0 + 6, LABEL_GREY, false);
    g.text('Inventory', L + 107, T0 + 72, LABEL_GREY, false);
    this.drawXp(g);
    const sel = this.offers[this.sel];
    if (sel && T.outOfStock(sel)) g.blit(SHEET, 280, 12, 28, 21, L + 182, T0 + 35);
    // the trades
    const over = this.buttonAt(mx, my);
    let tip = null;
    for (let k = 0; k < SHOWN; k++) {
      const i = this.scrollOff + k, o = this.offers[i];
      if (!o) break;
      const bx = L + 5, by = T0 + 18 + 20 * k;
      g.button(bx, by, 88, 20, i === over || i === this.sel ? 2 : 1);
      const iy = by + 1, price = this.price(o);
      this.drawPrice(g, price, o.a, L + 10, iy);
      if (o.b) drawStack(g, this.icons, o.b, L + 40, iy);
      g.blit(SHEET, T.outOfStock(o) ? 292 : 280, 0, 10, 9, L + 60, iy + 3);
      drawStack(g, this.icons, o.out, L + 73, iy);
      if (i === over && !this.inv.carried) tip = mx < L + 30 ? price : mx < L + 56 ? o.b : mx >= L + 70 ? o.out : null;
    }
    this.drawScroller(g);
    const prev = this.drawSlots(g, mx, my);
    if (tip) g.setTooltip(stackTooltip(tip, this.advancedTips, this.inv && this.inv.mode === 'creative'));
    else if (sel && T.outOfStock(sel) && mx >= L + 186 && mx < L + 208 && my >= T0 + 35 && my < T0 + 56) g.setTooltip(['Villagers restock up to two times per day.']);
    this.drawCarried(g, mx, my, prev);
  }
  // a price that moved: the old count struck through, the new one beside it
  drawPrice(g, now, base, x, y) {
    if (now.count === base.count) { drawStack(g, this.icons, now, x, y); return; }
    drawStack(g, this.icons, now, x, y, '');
    const old = String(base.count), w = g.textWidth(old);
    g.text(old, x + 17 - w, y + 9, 0xFFFFFF, true);
    g.fill(x + 7, y + 12, x + 16, y + 14, 0xFFE02020);
    const n = String(now.count), nw = g.textWidth(n);
    g.text(n, x + 14 + 17 - nw, y + 9, 0xFFFFFF, true);
  }
  // the villager's experience: what it has towards the next level, and what the chosen trade adds
  drawXp(g) {
    const v = this.v, lv = v.vlevel;
    if (v.isTrader || lv >= 5) return;
    const L = this.left, T0 = this.top;
    g.blit(SHEET, 280, 40, 102, 5, L + 136, T0 + 16);
    const lo = T.LEVEL_XP[lv - 1], hi = T.LEVEL_XP[lv];
    if (v.vxp < lo) return;
    const f = 102 / (hi - lo), w = Math.min(Math.floor(f * (v.vxp - lo)), 102);
    if (w > 0) g.blit(SHEET, 280, 46, w, 5, L + 136, T0 + 16);
    const fut = this.active ? this.active.xp : 0;
    if (fut > 0) {
      const k = Math.min(Math.floor(fut * f), 102 - w);
      if (k > 0) g.blit(SHEET, 280 + w, 52, k, 5, L + 136 + w, T0 + 16);
    }
  }
  drawScroller(g) {
    const L = this.left, T0 = this.top, n = this.offers.length + 1 - SHOWN;
    if (n > 1) {
      const span = 139 - 27, y = this.scrollOff >= n - 1 ? span : Math.min(span, Math.floor(this.scrollOff * span / (n - 1)));
      g.blit(SHEET, 400, 0, 6, 27, L + 94, T0 + 18 + y);
    } else g.blit(SHEET, 408, 0, 6, 27, L + 94, T0 + 18);
  }
}
