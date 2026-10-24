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

   Layouts are the game's (176 wide, the smithing table's since 1.20); the
   sheets are our own (tools/leoncraft2/build_stations.py).
--------------------------------------------------------------------------- */
import { ContainerScreen, SearchField, slot, range, TO_PLAYER, TO_PLAYER_REVERSED, stackTooltip, drawOutline } from './inventory.js?v=107';
import { I, ITEMS, withCount, displayName } from '../items.js?v=107';
import { tableOffers3, anvilResult, grindResult, grindable, enchName, enchantability } from '../enchanting.js?v=107';
import { isPotion, potionName } from '../brewing.js?v=107';
import { stonecutterRecipes } from '../crafting.js?v=107';
import { LegacyRandom } from '../gen/random.js?v=107';

const LABEL_GREY = 0x404040;
const MAIN = range(9, 36), HOT = range(0, 9);
function playerSlots(L, T, y) {
  const out = [];
  for (let j = 9; j < 36; j++) out.push(slot(L + 8 + (j % 9) * 18, T + y + Math.floor((j - 9) / 9) * 18, 'inv', j));
  for (let i = 0; i < 9; i++) out.push(slot(L + 8 + i * 18, T + y + 58, 'inv', i));
  return out;
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

// the words the table's runes spell (our own list): three or four of them a slot, cut to fit
const GLYPHS = 'the elder scrolls klaatu berata niktu xyzzy squeamish ossifrage free cthulhu ftaghn fhtagn baguette ruby qwerty grumble bunny ' +
  'ember quill lantern brook vellum moss thistle harrow gleam tallow wisp cinder loam marrow rune sigil';
export class EnchantScreen extends StationScreen {
  /* hooks: { level(), spend(levels), seed(), reseed(), shelves } */
  constructor(inv, icons, hooks) {
    super(inv, icons, 176, 166, 2, hooks);
    this.title = 'Enchant';
    this.offers = [null, null, null];
    this.key = '';
    this.animates = true;
    this.book = { open: 0, flip: 0, flipTo: 0, t: 0 };
  }
  /* The book above the slots: shut until something to enchant goes in, then
     open, its pages turning now and then (drawn flat here, our own). */
  drawBook(g, dt) {
    const b = this.book, it = this.grid[0], k = Math.min(1, (dt || 16) / 50);
    b.open += ((it ? 1 : 0) - b.open) * 0.2 * k;
    if (it && b.open > 0.5 && Math.random() < 0.02 * k) b.flipTo += Math.random() < 0.5 ? 1 : -1;
    b.flip += Math.max(-0.08, Math.min(0.08, (b.flipTo - b.flip) * 0.3)) * k;
    const cx = this.left + 33, cy = this.top + 30, o = Math.sin(b.open * Math.PI / 2);
    const ctx = g.ctx, quad = (pts, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); ctx.fill(); };
    const W = 13, H = 8, lean = 4;
    if (o < 0.05) {
      // shut: the cover, a little turned
      quad([cx - 7, cy - H, cx + 7, cy - H - 2, cx + 7, cy + H - 2, cx - 7, cy + H], '#6e3a1e');
      quad([cx - 7, cy - H, cx - 5, cy - H, cx - 5, cy + H, cx - 7, cy + H], '#55291a');
      quad([cx - 4, cy - H + 2, cx + 5, cy - H, cx + 5, cy - H + 1, cx - 4, cy - H + 3], '#d8b04a');
      return;
    }
    const w = W * o, up = lean * o;
    // the covers, then the pages on them, then the page in the air
    quad([cx, cy - H - 1, cx - w - 1, cy - H - 1 + up, cx - w - 1, cy + H + 1 + up, cx, cy + H + 1], '#6e3a1e');
    quad([cx, cy - H - 1, cx + w + 1, cy - H - 1 + up, cx + w + 1, cy + H + 1 + up, cx, cy + H + 1], '#6e3a1e');
    quad([cx, cy - H, cx - w, cy - H + up, cx - w, cy + H + up, cx, cy + H], '#eee6cf');
    quad([cx, cy - H, cx + w, cy - H + up, cx + w, cy + H + up, cx, cy + H], '#e6dcc2');
    ctx.fillStyle = '#8a7f6a';
    for (let r = -H + 3; r < H - 1; r += 3) { ctx.fillRect(cx - w * 0.8, cy + r + up * 0.5, w * 0.6, 1); ctx.fillRect(cx + w * 0.2, cy + r + up * 0.5, w * 0.6, 1); }
    const f = b.flip - Math.floor(b.flip), pw = w * Math.cos(f * Math.PI);
    if (Math.abs(pw) > 0.5 && f > 0.02 && f < 0.98) quad([cx, cy - H, cx + pw, cy - H + up - 2, cx + pw, cy + H + up - 2, cx, cy + H], '#f6f0de');
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
    // one random seeded with the enchantment seed spells the slots in turn, as in the game
    const r = new LegacyRandom((this.st.seed ? this.st.seed() : 1) | 0);
    this.words = this.offers.map(o => o ? gibberish(r) : '');
  }
  canTake(i) {
    const o = this.offers[i];
    if (!o || !o.ench.length) return false;
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
  render(g, mx, my, dt) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/enchanting_table', 0, 0, 176, 166, L, T);
    this.drawBook(g, dt);
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
      runes(g, this.words[i], x + 20, y + 2, room, ok ? (hover === i ? 0xFFFF80 : 0x685E4A) : 0x342F25);
      g.text(lv, x + 20 + 86 - lw, y + 9, ok ? 0x80FF20 : 0x407F10, true);
    }
    const prev = this.drawSlots(g, mx, my);
    if (hover >= 0 && this.offers[hover] && this.offers[hover].hint && !this.inv.carried) {
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
// the name an item shows now: its own, a potion's, or the item's
function shownName(st) { return st.name || (isPotion(st) ? potionName(st) : displayName(st.id)); }
function gibberish(r) {
  const w = GLYPHS.split(' '), out = [];
  for (let i = 0, n = r.nextInt(2) + 3; i < n; i++) out.push(w[r.nextInt(w.length)]);
  return out.join(' ');
}
/* The runes the table writes in: a galactic alphabet drawn here, a few pixels a
   letter (our own shapes, one row string a pixel row, top down). */
const RUNES = {
  a: ['#....', '#....', '#####', '....#', '....#'], b: ['####', '...#', '...#', '..##', '..#.'], c: ['.###', '#...', '#.#.', '.###'],
  d: ['####', '#...', '#.#.', '#..#', '#...'], e: ['#####', '#.#.#', '#.#.#'], f: ['#####', '.....', '#.#.#'], g: ['....#', '....#', '#####', '....#', '....#'],
  h: ['#####', '.....', '#####', '..#..', '..#..'], i: ['#', '#', '.', '#', '#'], j: ['#', '.', '#', '.', '#'], k: ['#..#', '#.#.', '##..', '#.#.', '#..#'],
  l: ['#...', '#...', '#...', '####'], m: ['#.#.#', '#.#.#', '#.#.#', '#####'], n: ['#..#', '#..#', '...#', '..#.', '.#..'], o: ['####', '...#', '.###', '...#', '####'],
  p: ['#.#', '#.#', '#..', '..#', '#.#'], q: ['####', '#..#', '#..#'], r: ['#.#', '...', '#.#'], s: ['#.#.#', '#...#', '#####'], t: ['####', '...#', '...#', '...#', '.#..'],
  u: ['#####', '.....', '##.##'], v: ['..#..', '..#..', '#####', '.....', '#####'], w: ['..#..', '.....', '#...#'], x: ['...#', '..#.', '.#..', '#...'],
  y: ['#.#', '#.#', '#.#', '#.#'], z: ['#####', '#...#', '#...#', '#...#'],
};
const runeW = ch => (ch === ' ' ? 4 : RUNES[ch] ? RUNES[ch][0].length + 1 : 0);
function runes(g, str, x, y, room, rgb) {
  const col = 0xFF000000 | rgb;
  let w = 0;
  for (const ch of str) {
    const a = runeW(ch);
    if (w + a - 1 > room) break;
    const rows = RUNES[ch];
    if (rows) for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== '#') continue;
        let e = c; while (e < row.length && row[e] === '#') e++;
        g.fill(x + w + c, y + 1 + r, x + w + e, y + 2 + r, col);
        c = e;
      }
    }
    w += a;
  }
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
      this.nameField.setValue(shownName(left));
    } else if (!left) { this.lastLeft = null; if (this.nameField.value) this.nameField.setValue(''); }
    this.calc = left ? anvilResult(left, this.grid[1], this.nameField.value, this.isCreative, shownName(left)) : null;
    this.result = this.calc && this.calc.result ? { stack: this.calc.result } : null;
  }
  affordable() { return !!(this.result && (this.isCreative || (this.level >= this.calc.cost && this.calc.cost > 0))); }
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
    // the red cross over the arrow: something in, nothing to take
    if ((this.grid[0] || this.grid[1]) && !this.result) g.blit('container/anvil', 176, 0, 28, 21, L + 99, T + 45);
    g.text(this.title, L + 60, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const c = this.calc;
    if (c && c.cost > 0 && (c.tooExpensive || this.result)) {
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
    if (s.kind === 'craft' && st) return grindable(st);
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
/* The faint pictures in the empty slots, as in the game: the template slot
   shows the two kinds of template in turn; with a template in, the base slot
   shows what it takes (armour for a trim; armour and tools for the netherite
   upgrade) and the addition slot what goes with it, a new one every second
   and a half. Drawn here (our own shapes). */
const GHOSTS = {
  trim: ['', '', '...##########', '...#........#', '...#.######.#', '...#.#....#.#', '...#.#.##.#.#', '...#.#.##.#.#', '...#.#....#.#', '...#.######.#', '...#........#', '...##########'],
  upgrade: ['', '', '...##########', '...#........#', '...#...##...#', '...#..####..#', '...#.##..##.#', '...#...##...#', '...#...##...#', '...#........#', '...##########'],
  sword: ['', '', '............###', '...........###', '..........###', '.........###', '........###', '..##...###', '...##.###', '....####', '....###', '...##.##', '..##', '.##'],
  pickaxe: ['', '', '....########', '...##########', '..###..##..###', '..##...##...##', '.......##', '.......##', '.......##', '.......##', '.......##', '.......##', '.......##'],
  axe: ['', '', '......####', '.....######', '....#######', '....###.##', '.......##', '.......##', '.......##', '.......##', '.......##', '.......##'],
  hoe: ['', '', '.....######', '.....######', '..........#', '..........##', '.........##', '........##', '.......##', '......##', '.....##', '....##'],
  shovel: ['', '', '..........###', '.........#####', '.........#####', '..........###', '.........##', '........##', '.......##', '......##', '.....##', '....##'],
  ingot: ['', '', '', '', '', '', '......######', '....##########', '..##############', '.##############', '..############'],
  dust: ['', '', '', '', '', '.......#', '......###..#', '...#..####.##', '..####.######', '.############', '..##########'],
  gem: ['', '', '', '....########', '...##########', '..############', '...##########', '....########', '.....######', '......####', '.......##'],
  shard: ['', '', '.......##', '......####', '......####', '.....######', '.....######', '....########', '....########', '.....######', '......####'],
};
const ARMOUR = [0, 1, 2, 3];      // helmet, chestplate, leggings, boots (the inventory's outlines)
export class SmithingScreen extends StationScreen {
  constructor(inv, icons) { super(inv, icons, 176, 166, 3); this.title = 'Upgrade Gear'; this.ghostT = 0; }
  ghost(g, x, y, k) {
    if (typeof k === 'number') { drawOutline(g, k, x, y); return; }
    const rows = GHOSTS[k];
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === '#') g.fill(x + c, y + r, x + c + 1, y + r + 1, 0x2CFFFFFF);
  }
  drawGhosts(g) {
    const now = performance.now(), t = Math.floor(now / 1500), L = this.left, T = this.top, tpl = this.grid[0];
    // drawn again when the next picture is due (not every frame)
    if (!this.ghostT) this.ghostT = setTimeout(() => { this.ghostT = 0; if (this.gui) this.gui.markDirty(); }, 1500 - (now % 1500) + 5);
    const tn = tpl && ITEMS[tpl.id] ? ITEMS[tpl.id].name : '';
    const up = tn === 'netherite_upgrade_smithing_template', trim = /_armor_trim_smithing_template$/.test(tn);
    if (!tpl) this.ghost(g, L + 8, T + 48, ['trim', 'upgrade'][t % 2]);
    if (!this.grid[1] && (up || trim)) {
      const list = up ? [0, 'sword', 1, 'pickaxe', 2, 'axe', 3, 'hoe', 'shovel'] : ARMOUR;
      this.ghost(g, L + 26, T + 48, list[t % list.length]);
    }
    if (!this.grid[2] && (up || trim)) {
      const list = up ? ['ingot'] : ['ingot', 'dust', 'gem', 'gem', 'shard', 'gem', 'shard'];
      this.ghost(g, L + 44, T + 48, list[t % list.length]);
    }
  }
  makeSlots() {
    const L = this.left, T = this.top;
    return [slot(L + 8, T + 48, 'craft', 0), slot(L + 26, T + 48, 'craft', 1), slot(L + 44, T + 48, 'craft', 2), slot(L + 98, T + 48, 'result')].concat(playerSlots(L, T, 84));
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
    // the red cross: all three in, and nothing they make
    if (this.grid[0] && this.grid[1] && this.grid[2] && !this.result) g.blit('container/smithing', 176, 0, 28, 21, L + 65, T + 46);
    this.drawGhosts(g);
    g.text(this.title, L + 44, T + 15, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ stonecutter ------------------------------ */

// the game lists the cuts by their results' translation keys: blocks (block.minecraft.*) before items, then by name
const transKey = id => (ITEMS[id] && ITEMS[id].block ? 'block.' : 'item.') + (ITEMS[id] ? ITEMS[id].name : '');
const byTranslationKey = list => list.slice().sort((a, b) => (transKey(a.id) < transKey(b.id) ? -1 : transKey(a.id) > transKey(b.id) ? 1 : 0));
export class StonecutterScreen extends StationScreen {
  constructor(inv, icons) { super(inv, icons, 176, 166, 1); this.title = 'Stonecutter'; this.recipes = []; this.sel = -1; this.scroll = 0; this.lastIn = 0; }
  makeSlots() {
    const L = this.left, T = this.top;
    return [slot(L + 20, T + 33, 'craft', 0), slot(L + 143, T + 33, 'result')].concat(playerSlots(L, T, 84));
  }
  updateResult() {
    const inp = this.grid[0];
    const id = inp ? inp.id : 0;
    if (id !== this.lastIn) { this.lastIn = id; this.recipes = id ? byTranslationKey(stonecutterRecipes(id)) : []; this.sel = -1; this.scroll = 0; }
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
    if (over >= 0 && !this.inv.carried) g.setTooltip(stackTooltip(this.recipes[over], this.advancedTips, this.isCreative));
    this.drawCarried(g, mx, my, prev);
  }
}
