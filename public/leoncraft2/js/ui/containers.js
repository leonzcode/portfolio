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
import { ContainerScreen, slot, range, TO_PLAYER, TO_PLAYER_REVERSED } from './inventory.js?v=8';
import { I, ITEMS, fuelTicks } from '../items.js?v=8';
import { smeltResult } from '../containers.js?v=8';
import { isPotion, isIngredient } from '../brewing.js?v=8';

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
    g.blit('container/crafting_table', 0, 0, 176, 166, L, T);
    g.text(this.title, L + 28, T + 6, LABEL_GREY, false);
    g.text('Inventory', L + 8, T + 72, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
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
    // fuel, or an empty bucket (where a lava bucket's bucket goes)
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
    if (smeltResult(st.id, this.c.kind)) this.moveIntoBox(st, [0]);
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
