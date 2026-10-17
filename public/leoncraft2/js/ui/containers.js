/* ---------------------------------------------------------------------------
   Leoncraft 2 - the crafting table, chest and furnace screens.

   All three are the shared ContainerScreen (inventory.js), so every click
   works as in the survival inventory: pick up and put down, halve, place
   one, drag to spread, double click to gather, 1-9 to swap with the hotbar,
   Q to throw, shift-click to move across:

     crafting table   result -> inventory (hotbar first, from the right),
                      grid -> inventory, inventory <-> hotbar
     chest, barrel    chest -> inventory (hotbar first, from the right),
                      inventory -> chest
     furnace          output and slots -> inventory; from the inventory,
                      what it can smelt -> input, fuel -> fuel, else
                      inventory <-> hotbar

   Layouts and sheets are the game's (176 wide, 18-pixel slots); the art is
   Pixel Perfection CE's.
--------------------------------------------------------------------------- */
import { ContainerScreen, SearchField, press, slot, range, TO_PLAYER, TO_PLAYER_REVERSED } from './inventory.js?v=79';
import { RecipeBook } from './recipebook.js?v=79';
import { I, ITEMS, fuelTicks } from '../items.js?v=79';
import { isShulkerBox, smeltResult } from '../containers.js?v=79';
import { cookingRecipe, matchGrid } from '../crafting.js?v=79';
import { isPotion, isIngredient } from '../brewing.js?v=79';

const LABEL_GREY = 0x404040;
const MAIN = range(9, 36), HOT = range(0, 9);

// the player's 27 + 9 slots, with their top-left at (x, y) of the screen
function playerSlots(L, T, y) {
  const out = [];
  for (let j = 9; j < 36; j++) out.push(slot(L + 8 + (j % 9) * 18, T + y + Math.floor((j - 9) / 9) * 18, 'inv', j));
  for (let i = 0; i < 9; i++) out.push(slot(L + 8 + i * 18, T + y + 58, 'inv', i));
  return out;
}

/* ------------------------------ crafting table ------------------------------ */

export class CraftingScreen extends ContainerScreen {
  constructor(inv, icons) {
    super(inv, icons, 176, 166);
    this.title = 'Crafting';
    this.grid = new Array(9).fill(null); this.gridW = 3;
  }
  // the recipe book (ui/recipebook.js); its button sits at the game's place
  init() {
    super.init();
    if (!this.book) this.book = new RecipeBook(this, SearchField, (L, T, H) => [L + 5, Math.floor(H / 2) - 49]);
    this.book.layout();
  }
  extraClick(mx, my, button) { return this.book ? this.book.mouse(mx, my, button, press.shift) : false; }
  slotShown() { return !(this.book && this.book.covers()); }
  keyPressed(e) { const k = this.book ? this.book.key(e) : null; return k === null ? super.keyPressed(e) : k; }
  onClose() { if (this.book) this.book.close(); super.onClose(); }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    out.push(slot(L + 124, T + 35, 'result'));
    for (let i = 0; i < 9; i++) out.push(slot(L + 30 + (i % 3) * 18, T + 17 + Math.floor(i / 3) * 18, 'craft', i));
    return out.concat(playerSlots(L, T, 84));
  }
  quickMove(s) {
    if (s.kind === 'result') { this.shiftResult(); return; }
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'craft') this.moveInto(st, TO_PLAYER);
    else if (s.kind === 'inv') this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    if (!st.count) this.setStack(s, null);
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    const book = this.book;
    if (book.covers()) { book.render(g, mx, my); book.drawButton(g, mx, my); this.drawCarried(g, mx, my, null); return; }
    book.render(g, mx, my);
    g.blit('container/crafting_table', 0, 0, 176, 166, L, T);
    book.drawButton(g, mx, my);
    g.text(this.title, L + 29, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    book.drawGhost(g);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ chests ------------------------------ */

export class ChestScreen extends ContainerScreen {
  /* box: the slots (27, or 54 for a double chest: the two chests' arrays
     joined, written back through onChange) */
  constructor(inv, icons, box, title, onChange) {
    const rows = Math.ceil(box.length / 9);
    super(inv, icons, 176, 114 + rows * 18);
    this.rows = rows;
    this.box = box;
    this.title = title || 'Chest';
    this.onChange = onChange || null;
    this.onClosed = null;
  }
  boxChanged(i) { if (this.onChange) this.onChange(i); }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    for (let i = 0; i < this.box.length; i++) out.push(slot(L + 8 + (i % 9) * 18, T + 18 + Math.floor(i / 9) * 18, 'box', i));
    return out.concat(playerSlots(L, T, this.rows * 18 + 31));
  }
  quickMove(s) {
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'box') { this.moveInto(st, TO_PLAYER_REVERSED); this.setStack(s, st.count ? st : null); return; }
    this.moveIntoBox(st, range(0, this.box.length));
    if (!st.count) this.setStack(s, null);
  }
  onClose() { super.onClose(); if (this.onClosed) this.onClosed(); }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top, h = this.rows * 18 + 17;
    g.blit('container/generic_54', 0, 0, 176, h, L, T);
    g.blit('container/generic_54', 0, 126, 176, 96, L, T + h);
    g.text(this.title, L + 8, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + this.imageHeight - 94, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ a mount's own screen ------------------------------ */

/* A horse's, donkey's, mule's, llama's or camel's screen (sneak and use a
   tamed one, or the inventory key while riding it): its saddle (not a
   llama's), its armour (a horse's or zombie horse's horse armour, a llama's
   carpet), and a donkey's, mule's or llama's chest once it carries one (5
   columns of 3, a llama as many columns as its strength). The mob (js/
   entities/mobs4.js mountSlots) hands over its parts as an array and is told
   when one changes. */
export class MountScreen extends ContainerScreen {
  constructor(inv, icons, mob) {
    super(inv, icons, 176, 166);
    this.mob = mob;
    const k = mob.mountSlots();
    this.box = k.box; this.kinds = k.kinds; this.cols = k.cols;
    this.title = mob.displayName ? mob.displayName() : mob.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  boxChanged(i) { this.mob.mountChanged(i, this.box[i]); }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    this.kinds.forEach((k, i) => {
      if (k === 'saddle') out.push(slot(L + 8, T + 18, 'box', i));
      else if (k === 'armor' || k === 'carpet') out.push(slot(L + 8, T + 36, 'box', i));
      else { const j = i - this.kinds.indexOf('chest'); out.push(slot(L + 80 + Math.floor(j / 3) * 18, T + 18 + (j % 3) * 18, 'box', i)); }
    });
    return out.concat(playerSlots(L, T, 84));
  }
  mayPlace(s, st) {
    if (s.kind !== 'box' || !st) return super.mayPlace(s, st);
    const n = ITEMS[st.id] ? ITEMS[st.id].name : '', k = this.kinds[s.i];
    if (k === 'saddle') return n === 'saddle';
    if (k === 'armor') return (this.mob.armorKind || /_horse_armor$/).test(n);
    if (k === 'carpet') return /_carpet$/.test(n);
    return true;
  }
  limit(s, id) { return s.kind === 'box' && this.kinds[s.i] !== 'chest' ? 1 : super.limit(s, id); }
  quickMove(s) {
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'box') { this.moveInto(st, TO_PLAYER_REVERSED); this.setStack(s, st.count ? st : null); return; }
    // saddle and armour to their own slots first, then the chest
    const k = this.kinds.findIndex((kk, i) => kk !== 'chest' && !this.box[i] && this.mayPlace({ kind: 'box', i }, st));
    if (k >= 0) { this.box[k] = Object.assign({}, st, { count: 1 }); st.count--; this.boxChanged(k); }
    else { const chest = []; this.kinds.forEach((kk, i) => { if (kk === 'chest') chest.push(i); }); if (chest.length) this.moveIntoBox(st, chest); }
    if (!st.count) this.setStack(s, null);
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/horse', 0, 0, 176, 166, L, T);
    // the slots that are there for this animal (the sheet has the saddle's and the armour's; a chest's are drawn here)
    if (this.kinds.indexOf('saddle') < 0) g.fill(L + 7, T + 17, L + 25, T + 35, 0xFFC6C6C6);
    if (this.kinds.indexOf('armor') < 0 && this.kinds.indexOf('carpet') < 0) g.fill(L + 7, T + 35, L + 25, T + 53, 0xFFC6C6C6);
    for (let c = 0; c < this.cols; c++) for (let r = 0; r < 3; r++) g.blit('container/horse', 0, 166, 18, 18, L + 79 + c * 18, T + 17 + r * 18);
    // the animal in the black box, turned to the mouse (render/mobfigure.js): 17 pixels a block, a quarter block low
    if (this.inv.drawMob) this.inv.drawMob(g, L + 26, T + 18, 52, 52, mx, my, this.mob, 17, 0.25);
    g.text(this.title, L + 8, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ shulker boxes ------------------------------ */

// a chest's screen on the shulker box sheet; no shulker box goes inside another
export class ShulkerScreen extends ChestScreen {
  mayPlace(s, st) { if (s.kind === 'box' && st && isShulkerBox(st.id)) return false; return super.mayPlace(s, st); }
  quickMove(s) {
    const st = this.getStack(s);
    if (st && s.kind !== 'box' && isShulkerBox(st.id)) return;
    super.quickMove(s);
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/shulker_box', 0, 0, 176, 166, L, T);
    g.text(this.title, L + 8, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ dispensers and droppers ------------------------------ */

export class DispenserScreen extends ChestScreen {
  constructor(inv, icons, box, title, onChange) { super(inv, icons, box, title, onChange); this.imageHeight = 166; }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    for (let i = 0; i < 9; i++) out.push(slot(L + 62 + (i % 3) * 18, T + 17 + Math.floor(i / 3) * 18, 'box', i));
    return out.concat(playerSlots(L, T, 84));
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/dispenser', 0, 0, 176, 166, L, T);
    g.centered(this.title, L + 88, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ crafters ------------------------------ */

/* The crafter's 3 x 3 grid, the result it would make, and its slots turned
   off and on by clicking them empty-handed (a slot turned off takes nothing).
   c: the crafter's record ({ slots, off }); hooks: { changed(), powered() } */
export class CrafterScreen extends ContainerScreen {
  constructor(inv, icons, c, hooks) {
    super(inv, icons, 176, 166);
    this.c = c; this.box = c.slots; this.fh = hooks || {};
    this.title = 'Crafter';
    this.animates = true;
  }
  boxChanged() { if (this.fh.changed) this.fh.changed(); }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    for (let i = 0; i < 9; i++) out.push(slot(L + 26 + (i % 3) * 18, T + 17 + Math.floor(i / 3) * 18, 'box', i));
    out.push(slot(L + 134, T + 35, 'preview'));
    return out.concat(playerSlots(L, T, 84));
  }
  getStack(s) { return s.kind === 'preview' ? this.preview() : super.getStack(s); }
  preview() {
    const m = matchGrid(this.c.slots.map((st, i) => (this.c.off[i] ? null : st)), 3);
    return m ? m.result : null;
  }
  special(s) { return s.kind === 'preview' || super.special(s); }
  mayPlace(s, st) {
    if (s.kind === 'preview') return false;
    if (s.kind === 'box' && st && this.c.off[s.i]) return false;
    return super.mayPlace(s, st);
  }
  click(s, button) {
    if (s.kind === 'preview') return;
    // an empty slot clicked with nothing on the mouse turns off (or back on)
    if (s.kind === 'box' && !this.inv.carried && !this.c.slots[s.i]) { this.c.off[s.i] = !this.c.off[s.i]; this.boxChanged(); return; }
    super.click(s, button);
  }
  canDrag(s) { return s.kind !== 'preview' && super.canDrag(s); }
  swapHotbar(s, n) { if (s.kind !== 'preview') super.swapHotbar(s, n); }
  quickMove(s) {
    if (s.kind === 'preview') return;
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'box') { this.moveInto(st, TO_PLAYER); this.setStack(s, st.count ? st : null); return; }
    this.moveIntoBox(st, range(0, 9).filter(i => !this.c.off[i]));
    if (!st.count) this.setStack(s, null);
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/crafter', 0, 0, 176, 166, L, T);
    // a slot that is off: dark, with a cross
    for (let i = 0; i < 9; i++) {
      if (!this.c.off[i]) continue;
      const x = L + 26 + (i % 3) * 18, y = T + 17 + Math.floor(i / 3) * 18;
      g.fill(x, y, x + 16, y + 16, 0xFF5A5A5A);
      for (let k = 2; k < 14; k++) { g.fill(x + k, y + k, x + k + 1, y + k + 1, 0xFF3A3A3A); g.fill(x + 15 - k, y + k, x + 16 - k, y + k + 1, 0xFF3A3A3A); }
    }
    // the arrow turns red while a signal reaches it
    if (this.fh.powered && this.fh.powered()) g.fill(L + 95, T + 40, L + 113, T + 45, 0xFFC81414);
    g.centered(this.title, L + 88, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    if (this.hover && this.hover.kind === 'box' && !this.inv.carried && !this.c.slots[this.hover.i]) g.setTooltip([this.c.off[this.hover.i] ? 'Click to enable slot' : 'Click to disable slot']);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ hoppers ------------------------------ */

export class HopperScreen extends ChestScreen {
  constructor(inv, icons, box, onChange) { super(inv, icons, box, 'Item Hopper', onChange); this.imageHeight = 133; }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    for (let i = 0; i < 5; i++) out.push(slot(L + 44 + i * 18, T + 20, 'box', i));
    return out.concat(playerSlots(L, T, 51));
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/hopper', 0, 0, 176, 133, L, T);
    g.text(this.title, L + 8, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 39, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ brewing stand ------------------------------ */

const BUBBLES = [29, 24, 20, 16, 11, 6, 0];
export class BrewingScreen extends ContainerScreen {
  /* c: the stand's record ({ slots: 3 bottles, ingredient, blaze powder; fuel, brew }); hooks: { changed() } */
  constructor(inv, icons, c, hooks) {
    super(inv, icons, 176, 166);
    this.c = c; this.box = c.slots; this.fh = hooks || {};
    this.title = 'Brewing Stand';
    this.animates = true;
  }
  boxChanged() { if (this.fh.changed) this.fh.changed(); }
  makeSlots() {
    const L = this.left, T = this.top;
    return [slot(L + 56, T + 51, 'box', 0), slot(L + 79, T + 58, 'box', 1), slot(L + 102, T + 51, 'box', 2), slot(L + 79, T + 17, 'box', 3), slot(L + 17, T + 17, 'box', 4)]
      .concat(playerSlots(L, T, 84));
  }
  isBottle(st) { return isPotion(st) || st.id === I.glass_bottle; }
  mayPlace(s, st) {
    if (s.kind === 'box' && st) {
      if (s.i <= 2) return this.isBottle(st);
      if (s.i === 3) return isIngredient(st);
      return ITEMS[st.id] && ITEMS[st.id].name === 'blaze_powder';
    }
    return super.mayPlace(s, st);
  }
  limit(s, id) { return s.kind === 'box' && s.i <= 2 ? 1 : super.limit(s, id); }
  quickMove(s) {
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'box') { this.moveInto(st, TO_PLAYER_REVERSED); this.setStack(s, st.count ? st : null); return; }
    if (ITEMS[st.id] && ITEMS[st.id].name === 'blaze_powder' && (!this.box[4] || this.box[4].id === st.id)) this.moveIntoBox(st, [4]);
    else if (isIngredient(st)) this.moveIntoBox(st, [3]);
    else if (this.isBottle(st)) {
      for (let i = 0; i < 3 && st.count; i++) if (!this.box[i]) { this.box[i] = { ...st, count: 1 }; st.count--; this.boxChanged(i); }
    } else this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    if (!st.count) this.setStack(s, null);
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top, c = this.c;
    g.blit('container/brewing_stand', 0, 0, 176, 166, L, T);
    const fw = Math.max(0, Math.min(18, Math.floor((18 * c.fuel + 19) / 20)));
    if (fw > 0) g.blit('container/brewing_stand', 176, 29, fw, 4, L + 60, T + 44);
    if (c.brew > 0) {
      const h = Math.floor(28 * (1 - c.brew / 400));
      if (h > 0) g.blit('container/brewing_stand', 176, 0, 9, h, L + 97, T + 16);
      const b = BUBBLES[Math.floor(c.brew / 2) % 7];
      if (b > 0) g.blit('container/brewing_stand', 185, 29 - b, 12, b, L + 63, T + 14 + 29 - b);
    }
    g.centered(this.title, L + 88, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ furnaces ------------------------------ */

const FURNACE_TITLE = { furnace: 'Furnace', smoker: 'Smoker', blast_furnace: 'Blast Furnace' };

export class FurnaceScreen extends ContainerScreen {
  /* c: the furnace's record from containers.js ({ kind, slots, burn, burnMax, cook, cookMax });
     hooks: { changed(), tookXp(count) } */
  constructor(inv, icons, c, hooks) {
    super(inv, icons, 176, 166);
    this.c = c;
    this.box = c.slots;
    this.fh = hooks || {};
    this.title = FURNACE_TITLE[c.kind] || 'Furnace';
    this.animates = true;                  // the flame and the arrow move
  }
  boxChanged() { if (this.fh.changed) this.fh.changed(); }
  makeSlots() {
    const L = this.left, T = this.top;
    return [
      slot(L + 56, T + 17, 'box', 0),
      slot(L + 56, T + 53, 'box', 1, { fuel: true }),
      slot(L + 116, T + 35, 'box', 2, { output: true }),
    ].concat(playerSlots(L, T, 84));
  }
  mayPlace(s, st) {
    // fuel, or an empty bucket (where a lava bucket's bucket goes, or a wet sponge's water)
    if (s.fuel && st) return fuelTicks(st.id) > 0 || st.id === I.bucket;
    return super.mayPlace(s, st);
  }
  tookOutput(s, n) { if (this.fh.tookXp) this.fh.tookXp(n); }
  quickMove(s) {
    const st = this.getStack(s);
    if (!st) return;
    if (s.kind === 'box') {
      const before = st.count;
      this.moveInto(st, s.output ? TO_PLAYER_REVERSED : TO_PLAYER);
      if (s.output && before - st.count > 0) this.tookOutput(s, before - st.count);
      this.setStack(s, st.count ? st : null);
      return;
    }
    // from the inventory: what this furnace can cook to the input, fuel to the fuel slot, else across the inventory
    if (cookingRecipe(st.id, this.c.kind)) this.moveIntoBox(st, [0]);
    else if (fuelTicks(st.id) > 0) this.moveIntoBox(st, [1]);
    else this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    if (!st.count) this.setStack(s, null);
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top, c = this.c;
    const sheet = 'container/' + (c.kind === 'smoker' ? 'smoker' : c.kind === 'blast_furnace' ? 'blast_furnace' : 'furnace');
    g.blit(sheet, 0, 0, 176, 166, L, T);
    // the flame burns down from the top, the arrow fills to the right
    if (c.burn > 0 && c.burnMax > 0) {
      const k = Math.ceil(c.burn / c.burnMax * 13);
      g.blit(sheet, 176, 12 - k, 14, k + 1, L + 56, T + 36 + 12 - k);
    }
    if (c.cook > 0) {
      const w = Math.floor(c.cook * 24 / c.cookMax);
      g.blit(sheet, 176, 14, w + 1, 16, L + 79, T + 34);
    }
    g.centered(this.title, L + 88, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}
