/* ---------------------------------------------------------------------------
   Leoncraft 2 - the enchanting table, anvil, grindstone, smithing table
   and stonecutter screens.

   Each is a ContainerScreen (inventory.js) whose input slots are its grid
   (given back when the screen closes) and whose result slot is worked out
   by its own rules (js/enchanting.js, js/crafting.js); every other click is
   the inventory's.

     enchanting table  an item and lapis; three offers by the bookshelves
                       round the table; one costs 1-3 lapis and as many levels
     anvil             two items (or an item and its material, or a book)
                       and a new name; the cost in levels; Too Expensive at 40
     grindstone        one or two items: the enchantments off, experience back
     smithing table    template, base, addition: netherite gear and trims
     stonecutter       one block in, pick what to cut it into

   Sheets and layouts are the game's (176 wide); the art is Pixel Perfection
   CE's. The smithing table's template slot is drawn over the older sheet.
--------------------------------------------------------------------------- */
import { ContainerScreen, SearchField, slot, range, TO_PLAYER, TO_PLAYER_REVERSED, stackTooltip } from './inventory.js?v=13';
import { I, ITEMS, withCount, displayName } from '../items.js?v=13';
import { tableOffers3, anvilResult, grindResult, enchName, enchantability } from '../enchanting.js?v=13';
import { stonecutterRecipes } from '../crafting.js?v=13';

const LABEL_GREY = 0x404040;
const MAIN = range(9, 36), HOT = range(0, 9);
function playerSlots(L, T, y) {
  const out = [];
  for (let j = 9; j < 36; j++) out.push(slot(L + 8 + (j % 9) * 18, T + y + Math.floor((j - 9) / 9) * 18, 'inv', j));
  for (let i = 0; i < 9; i++) out.push(slot(L + 8 + i * 18, T + y + 58, 'inv', i));
  return out;
}
// a slot frame drawn by hand: dark above and left, light below and right
function slotFrame(g, x, y) {
  g.fill(x - 1, y - 1, x + 17, y + 17, 0xFF8B8B8B);
  g.fill(x - 1, y - 1, x + 17, y, 0xFF373737); g.fill(x - 1, y - 1, x, y + 17, 0xFF373737);
  g.fill(x - 1, y + 16, x + 17, y + 17, 0xFFFFFFFF); g.fill(x + 16, y - 1, x + 17, y + 17, 0xFFFFFFFF);
}

/* Shared: inputs in this.grid, a result by station rules; shift-click from the
   inventory into the first input that takes the item. */
class StationScreen extends ContainerScreen {
  constructor(inv, icons, w, h, inputs, hooks) {
    super(inv, icons, w, h);
    this.grid = new Array(inputs).fill(null); this.gridW = inputs;
    this.st = hooks || {};
  }
  get level() { return this.st.level ? this.st.level() : 0; }
  get isCreative() { return this.inv.mode === 'creative'; }
  quickMove(s) {
    if (s.kind === 'result') { this.shiftResult(); return; }
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'craft') this.moveInto(st, TO_PLAYER);
    else if (s.kind === 'inv') {
      let moved = false;
      for (const t of this.slots) {
        if (t.kind !== 'craft' || !this.mayPlace(t, st)) continue;
        const have = this.grid[t.i];
        if (!have) { const n = Math.min(st.count, this.limit(t, st.id)); this.grid[t.i] = withCount(st, n); st.count -= n; moved = true; break; }
      }
      if (!moved) this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    }
    if (!st.count) this.setStack(s, null);
  }
}

/* ------------------------------ enchanting table ------------------------------ */

const GLYPHS = 'the elder scrolls klaatu berata niktu xyzzy squeamish ossifrage free cthulhu ftaghn fhtagn baguette ruby qwerty grumble bunny';
export class EnchantScreen extends StationScreen {
  /* hooks: { level(), spend(levels), seed(), reseed(), shelves } */
  constructor(inv, icons, hooks) {
    super(inv, icons, 176, 166, 2, hooks);
    this.title = 'Enchant';
    this.offers = [null, null, null];
    this.key = '';
    this.animates = true;
  }
  makeSlots() {
    const L = this.left, T = this.top;
    return [slot(L + 15, T + 47, 'craft', 0), slot(L + 35, T + 47, 'craft', 1, { outline: -1 })].concat(playerSlots(L, T, 84));
  }
  mayPlace(s, st) {
    if (s.kind === 'craft' && st) {
      if (s.i === 1) return st.id === I.lapis_lazuli;
      return enchantability(st.id) > 0 && !(st.ench && Object.keys(st.ench).length);
    }
    return super.mayPlace(s, st);
  }
  limit(s, id) { return s.kind === 'craft' && s.i === 0 ? 1 : super.limit(s, id); }
  updateResult() {
    const it = this.grid[0];
    const key = it ? it.id + ':' + (this.st.seed ? this.st.seed() : 0) : '';
    if (key === this.key) return;
    this.key = key;
    this.offers = it && !(it.ench && Object.keys(it.ench).length) ? tableOffers3(it.id, this.st.shelves || 0, this.st.seed ? this.st.seed() : 1) : [null, null, null];
    this.words = this.offers.map((o, i) => o ? gibberish((this.st.seed ? this.st.seed() : 1) + i * 31) : '');
  }
  canTake(i) {
    const o = this.offers[i];
    if (!o) return false;
    if (this.isCreative) return true;
    const lapis = this.grid[1] ? this.grid[1].count : 0;
    return this.level >= o.level && this.level >= i + 1 && lapis >= i + 1;
  }
  buttonAt(mx, my) {
    for (let i = 0; i < 3; i++) { const x = this.left + 60, y = this.top + 14 + 19 * i; if (mx >= x && my >= y && mx < x + 108 && my < y + 19) return i; }
    return -1;
  }
  extraClick(mx, my, button) {
    const i = this.buttonAt(mx, my);
    if (i < 0 || button !== 0) return false;
    if (!this.canTake(i)) return true;
    const o = this.offers[i], it = this.grid[0];
    const out = it.id === I.book ? { id: I.enchanted_book, count: 1 } : withCount(it, 1);
    out.ench = Object.assign({}, out.ench || {});
    for (const [k, lv] of o.ench) out.ench[k] = lv;
    this.grid[0] = out;
    if (!this.isCreative) {
      this.grid[1].count -= i + 1;
      if (this.grid[1].count <= 0) this.grid[1] = null;
      if (this.st.spend) this.st.spend(i + 1);
    }
    if (this.st.reseed) this.st.reseed();
    this.key = '';
    return true;
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/enchanting_table', 0, 0, 176, 166, L, T);
    g.text(this.title, L + 12, T + 5, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const hover = this.buttonAt(mx, my);
    for (let i = 0; i < 3; i++) {
      const o = this.offers[i], x = L + 60, y = T + 14 + 19 * i;
      if (!o) { g.blit('container/enchanting_table', 0, 185, 108, 19, x, y); continue; }
      const ok = this.canTake(i);
      g.blit('container/enchanting_table', 0, ok ? (hover === i ? 204 : 166) : 185, 108, 19, x, y);
      g.blit('container/enchanting_table', 16 * i, ok ? 223 : 239, 16, 16, x + 1, y + 1);
      const lv = String(o.level), lw = g.textWidth(lv);
      const room = 86 - lw;
      g.text(g.font.trim(this.words[i], room), x + 20, y + 2, ok ? (hover === i ? 0xFFFF80 : 0x685E4A) : 0x342F25, false);
      g.text(lv, x + 20 + 86 - lw, y + 9, ok ? 0x80FF20 : 0x407F10, true);
    }
    const prev = this.drawSlots(g, mx, my);
    if (hover >= 0 && this.offers[hover] && !this.inv.carried) {
      const o = this.offers[hover], lines = ['§f' + enchName(o.hint[0], o.hint[1]) + ' . . . ?'];
      if (!this.isCreative) {
        const lapis = this.grid[1] ? this.grid[1].count : 0;
        if (this.level < o.level) lines.push('', '§cLevel Requirement: ' + o.level);
        else {
          lines.push('', (lapis >= hover + 1 ? '§7' : '§c') + (hover + 1) + ' Lapis Lazuli');
          lines.push('§7' + (hover + 1) + ' Enchantment Level' + (hover ? 's' : ''));
        }
      }
      g.setTooltip(lines);
    }
    this.drawCarried(g, mx, my, prev);
  }
}
function gibberish(seed) {
  const w = GLYPHS.split(' ');
  let s = seed >>> 0, out = [];
  for (let i = 0; i < 3 + (s % 3); i++) { s = (s * 1103515245 + 12345) >>> 0; out.push(w[(s >>> 8) % w.length]); }
  return out.join(' ');
}

/* ------------------------------ anvil ------------------------------ */

export class AnvilScreen extends StationScreen {
  /* hooks: { level(), spend(levels), used() (the anvil may wear), title } */
  constructor(inv, icons, hooks) {
    super(inv, icons, 176, 166, 2, hooks);
    this.title = (hooks && hooks.title) || 'Repair & Name';
    this.nameField = new SearchField(0, 0, 103, 12, { maxLength: 50, onChange: () => { this.dirtyName = true; this.updateResult(); } });
    this.calc = null;
  }
  init() {
    super.init();
    this.nameField.x = this.left + 62; this.nameField.y = this.top + 24;
    this.nameField.gui = this.gui;
  }
  makeSlots() {
    const L = this.left, T = this.top;
    return [slot(L + 27, T + 47, 'craft', 0), slot(L + 76, T + 47, 'craft', 1), slot(L + 134, T + 47, 'result')].concat(playerSlots(L, T, 84));
  }
  updateResult() {
    const left = this.grid[0];
    if (left && this.lastLeft !== left) {
      // a new item: its name goes in the box
      this.lastLeft = left;
      this.nameField.setValue(left.name || displayName(left.id));
    } else if (!left) { this.lastLeft = null; if (this.nameField.value) this.nameField.setValue(''); }
    const nm = this.nameField.value.trim();
    const want = left && nm !== (left.name || displayName(left.id)) ? nm : '';
    this.calc = left ? anvilResult(left, this.grid[1], want, this.isCreative) : null;
    this.result = this.calc && !(this.calc.tooExpensive) ? { stack: this.calc.result } : null;
  }
  affordable() { return this.calc && (this.isCreative || (this.level >= this.calc.cost && this.calc.cost > 0)); }
  craftOnce() {
    if (!this.result || !this.affordable()) return null;
    const c = this.calc, out = withCount(c.result, c.result.count);
    this.grid[0] = null;
    if (this.grid[1] && c.used) { this.grid[1].count -= c.used; if (this.grid[1].count <= 0) this.grid[1] = null; }
    if (!this.isCreative && this.st.spend) this.st.spend(c.cost);
    if (this.st.used) this.st.used();
    this.lastLeft = null;
    this.updateResult();
    return out;
  }
  extraClick(mx, my, button) { return this.nameField.mouseClicked(mx, my, button) ? this.nameField : false; }
  keyPressed(e) {
    if (e.key === 'Escape') { this.gui.back(); return true; }
    if (this.gui.textFocus === this.nameField) return false;
    return super.keyPressed(e);
  }
  onClose() { super.onClose(); if (this.gui && this.gui.textFocus === this.nameField) this.gui._blurText(); }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/anvil', 0, 0, 176, 166, L, T);
    g.blit('container/anvil', 0, this.grid[0] ? 166 : 182, 110, 16, L + 59, T + 20);
    this.nameField.draw(g);
    if (this.grid[0] && this.grid[1] && !this.result) g.blit('container/anvil', 176, 0, 28, 21, L + 99, T + 45);
    g.text(this.title, L + 60, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const c = this.calc;
    if (c && c.cost > 0) {
      const tooMuch = c.tooExpensive;
      const text = tooMuch ? 'Too Expensive!' : 'Enchantment Cost: ' + c.cost;
      const colour = tooMuch || !this.affordable() ? 0xFF6060 : 0x80FF20;
      const w = g.textWidth(text), x = L + 176 - 8 - w - 2;
      g.fill(x - 2, T + 67, L + 176 - 8, T + 79, 0x4F000000);
      g.text(text, x, T + 69, colour, true);
    }
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ grindstone ------------------------------ */

export class GrindstoneScreen extends StationScreen {
  /* hooks: { xp(points) } */
  constructor(inv, icons, hooks) { super(inv, icons, 176, 166, 2, hooks); this.title = 'Repair & Disenchant'; this.calc = null; }
  makeSlots() {
    const L = this.left, T = this.top;
    return [slot(L + 49, T + 19, 'craft', 0), slot(L + 49, T + 40, 'craft', 1), slot(L + 129, T + 34, 'result')].concat(playerSlots(L, T, 84));
  }
  mayPlace(s, st) {
    if (s.kind === 'craft' && st) { const it = ITEMS[st.id]; return !!it && (!!it.dur || it.name === 'enchanted_book'); }
    return super.mayPlace(s, st);
  }
  updateResult() {
    this.calc = grindResult(this.grid[0], this.grid[1]);
    this.result = this.calc ? { stack: this.calc.result } : null;
  }
  craftOnce() {
    if (!this.calc) return null;
    const out = withCount(this.calc.result, this.calc.result.count);
    if (this.st.xp && this.calc.xp) this.st.xp(this.calc.xp);
    this.grid[0] = null; this.grid[1] = null;
    this.updateResult();
    return out;
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/grindstone', 0, 0, 176, 166, L, T);
    if ((this.grid[0] || this.grid[1]) && !this.result) g.blit('container/grindstone', 176, 0, 28, 21, L + 92, T + 31);
    g.text(this.title, L + 8, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ smithing table ------------------------------ */

const TRIM_MATERIALS = { amethyst_shard: 'amethyst', copper_ingot: 'copper', diamond: 'diamond', emerald: 'emerald', gold_ingot: 'gold', iron_ingot: 'iron',
  lapis_lazuli: 'lapis', netherite_ingot: 'netherite', quartz: 'quartz', redstone: 'redstone', resin_brick: 'resin' };
export class SmithingScreen extends StationScreen {
  constructor(inv, icons) { super(inv, icons, 176, 166, 3); this.title = 'Upgrade Gear'; }
  makeSlots() {
    const L = this.left, T = this.top;
    return [slot(L + 8, T + 48, 'craft', 0), slot(L + 27, T + 48, 'craft', 1), slot(L + 76, T + 48, 'craft', 2), slot(L + 134, T + 48, 'result')].concat(playerSlots(L, T, 84));
  }
  updateResult() {
    const [t, b, a] = this.grid;
    this.result = null;
    if (!t || !b || !a) return;
    const tn = ITEMS[t.id].name, bn = ITEMS[b.id].name, an = ITEMS[a.id].name;
    if (tn === 'netherite_upgrade_smithing_template' && an === 'netherite_ingot' && /^diamond_/.test(bn)) {
      const to = I[bn.replace(/^diamond_/, 'netherite_')];
      if (to !== undefined) { const out = withCount(b, 1); out.id = to; this.result = { stack: out }; }
    } else if (/_armor_trim_smithing_template$/.test(tn) && ITEMS[b.id].armor && ITEMS[b.id].armor.points && TRIM_MATERIALS[an]) {
      const out = withCount(b, 1);
      out.trim = [tn.replace(/_armor_trim_smithing_template$/, ''), TRIM_MATERIALS[an]];
      this.result = { stack: out };
    }
  }
  craftOnce() {
    if (!this.result) return null;
    const out = withCount(this.result.stack, 1);
    for (let i = 0; i < 3; i++) { this.grid[i].count--; if (this.grid[i].count <= 0) this.grid[i] = null; }
    this.updateResult();
    return out;
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/smithing', 0, 0, 176, 166, L, T);
    // the template slot (newer than the sheet)
    slotFrame(g, L + 8, T + 48);
    g.text(this.title, L + 44, T + 15, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ stonecutter ------------------------------ */

export class StonecutterScreen extends StationScreen {
  constructor(inv, icons) { super(inv, icons, 176, 166, 1); this.title = 'Stonecutter'; this.recipes = []; this.sel = -1; this.scroll = 0; this.lastIn = 0; }
  makeSlots() {
    const L = this.left, T = this.top;
    return [slot(L + 20, T + 33, 'craft', 0), slot(L + 143, T + 33, 'result')].concat(playerSlots(L, T, 84));
  }
  updateResult() {
    const inp = this.grid[0];
    const id = inp ? inp.id : 0;
    if (id !== this.lastIn) { this.lastIn = id; this.recipes = id ? stonecutterRecipes(id) : []; this.sel = -1; this.scroll = 0; }
    const r = this.sel >= 0 && inp ? this.recipes[this.sel] : null;
    this.result = r ? { stack: { id: r.id, count: r.count } } : null;
  }
  craftOnce() {
    if (!this.result) return null;
    const out = withCount(this.result.stack, this.result.stack.count);
    this.grid[0].count--;
    if (this.grid[0].count <= 0) this.grid[0] = null;
    this.updateResult();
    return out;
  }
  recipeAt(mx, my) {
    const x0 = this.left + 52, y0 = this.top + 15;
    if (mx < x0 || my < y0 || mx >= x0 + 64 || my >= y0 + 54) return -1;
    const i = this.scroll * 4 + Math.floor((mx - x0) / 16) + Math.floor((my - y0) / 18) * 4;
    return i < this.recipes.length ? i : -1;
  }
  extraClick(mx, my, button) {
    const i = this.recipeAt(mx, my);
    if (i < 0) return false;
    this.sel = i;
    this.updateResult();
    return true;
  }
  mouseScrolled(mx, my, d) {
    const rows = Math.ceil(this.recipes.length / 4) - 3;
    if (rows <= 0) return false;
    this.scroll = Math.max(0, Math.min(rows, this.scroll - Math.sign(d)));
    return true;
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/stonecutter', 0, 0, 176, 166, L, T);
    const rows = Math.ceil(this.recipes.length / 4) - 3;
    g.blit('container/stonecutter', rows > 0 ? 176 : 188, 0, 12, 15, L + 119, T + 15 + (rows > 0 ? Math.floor(this.scroll / rows * 39) : 0));
    const over = this.recipeAt(mx, my);
    for (let k = 0; k < 12; k++) {
      const i = this.scroll * 4 + k;
      if (i >= this.recipes.length) break;
      const x = L + 52 + (k % 4) * 16, y = T + 15 + Math.floor(k / 4) * 18;
      g.blit('container/stonecutter', 0, i === this.sel ? 184 : i === over ? 202 : 166, 16, 18, x, y);
      this.icons.draw(g, this.recipes[i].id, x, y + 1);
    }
    g.text(this.title, L + 8, T + 4, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    if (over >= 0 && !this.inv.carried) g.setTooltip(stackTooltip(this.recipes[over], this.advancedTips));
    this.drawCarried(g, mx, my, prev);
  }
}
