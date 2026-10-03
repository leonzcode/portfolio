/* ---------------------------------------------------------------------------
   Leoncraft 2 - the inventory and its two screens.

   Inventory is the model: 36 slots (0-8 the hotbar, 9-35 the rest), four
   armour slots (head, chest, legs, feet), the off hand, the 2 x 2 crafting
   grid and its result, the stack on the mouse while a screen is open, and
   which hotbar slot is selected. A stack is { id, count } or null; ids are
   block ids. In creative, blocks never run out.

     const inv = new Inventory({ mode: 'creative' });
     inv.on('held', id => renderer.setHeld(id, BLOCKS));   // the selected stack changed
     inv.on('change', () => ...);                           // anything changed
     inv.on('drop', stack => ...);                          // thrown out of a screen
     gui.open(inventoryScreen(inv, icons));                 // E: creative or survival

   CreativeInventoryScreen and InventoryScreen work like the game's: click to
   pick up and put down, right click to halve or place one, shift-click to
   move across, a double click to gather, drag to spread (left evenly, right
   one each), 1-9 over a slot to swap with the hotbar, F for the off hand,
   middle click (creative) for a full stack. The creative screen has the
   game's tab rows, a scrolling 9 x 5 grid, a search box and the Survival
   Inventory tab with its destroy-item slot.

   Slot positions and sheet coordinates are the game's (176 x 166 survival,
   195 x 136 creative, 18-pixel slots); the art is Pixel Perfection CE's.
--------------------------------------------------------------------------- */
import { BLOCKS, B } from '../blocks.js?v=6';
import { Screen, TextField, WHITE } from './gui.js?v=6';

const LABEL_GREY = 0x404040;          // the dark grey of container titles
const HIGHLIGHT = 0x80FFFFFF;         // a hovered slot
const YELLOW = 0xFFFF55;

/* ------------------------------ the model ------------------------------ */

const same = (a, b) => a && b && a.id === b.id;
const copy = s => (s ? { id: s.id, count: s.count } : null);
export function maxStack(id) { const d = BLOCKS[id]; return d && d.stack ? d.stack : 64; }
export function displayName(id) {
  const d = BLOCKS[id];
  if (!d) return '';
  return d.display || d.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
// which armour slot a block can be worn in (0 head), or -1
export function armourSlotOf(id) {
  const d = BLOCKS[id];
  if (!d) return -1;
  return d.name === 'carved_pumpkin' || /_(head|skull)$/.test(d.name) ? 0 : -1;
}

export class Inventory {
  constructor(opts = {}) {
    this.mode = opts.mode === 'survival' ? 'survival' : 'creative';
    this.slots = new Array(36).fill(null);
    this.armor = [null, null, null, null];
    this.offhand = null;
    this.craft = [null, null, null, null];
    this.craftResult = null;          // no recipes yet: always empty
    this.carried = null;              // on the mouse in a screen
    this.selected = 0;
    /* The integrator's hook for the figure in the inventory box:
       drawPlayer(g, x, y, w, h, mx, my), all in GUI pixels. Unset, the box stays empty. */
    this.drawPlayer = null;
    this._on = { change: [], held: [], drop: [] };
    this._heldId = 0;
  }

  /* ---- events ---- */
  on(type, fn) {
    const list = this._on[type];
    if (!list) throw new Error('no such inventory event: ' + type);
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  }
  emit(type, arg) { for (const fn of this._on[type].slice()) { try { fn(arg, this); } catch (e) { console.error(e); } } }
  // call after changing slots by hand; fires 'change', and 'held' when the selected block is different
  changed() {
    this.emit('change');
    const h = this.heldId();
    if (h !== this._heldId) { this._heldId = h; this.emit('held', h); }
  }

  /* ---- reading ---- */
  get held() { return this.slots[this.selected]; }
  heldId() { const s = this.slots[this.selected]; return s ? s.id : 0; }
  offhandId() { return this.offhand ? this.offhand.id : 0; }
  get(i) { return this.slots[i]; }
  count(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n; }
  findSlot(id) { for (let i = 0; i < 36; i++) if (this.slots[i] && this.slots[i].id === id) return i; return -1; }

  /* ---- changing ---- */
  setMode(mode) { this.mode = mode === 'survival' ? 'survival' : 'creative'; this.changed(); }
  select(i) { i = ((i % 9) + 9) % 9; if (i !== this.selected) { this.selected = i; this.changed(); } }
  // the wheel: down (positive) moves right, as in the game
  scroll(delta) { if (delta) this.select(this.selected + (delta > 0 ? 1 : -1)); }
  set(i, stack) { this.slots[i] = stack && stack.count > 0 && stack.id ? { id: stack.id, count: Math.min(stack.count, maxStack(stack.id)) } : null; this.changed(); }

  /* Puts count of a block into the inventory the way the game does: onto a
     matching stack with room (the selected one first, then the off hand, then
     slot order), then into the first empty slot. Returns what did not fit. */
  add(id, count = 1) {
    if (!id || count <= 0) return 0;
    const max = maxStack(id);
    let left = count;
    const fill = s => { const n = Math.min(max - s.count, left); s.count += n; left -= n; };
    const sel = this.slots[this.selected];
    if (sel && sel.id === id && sel.count < max) fill(sel);
    if (left && this.offhand && this.offhand.id === id && this.offhand.count < max) fill(this.offhand);
    for (let i = 0; i < 36 && left; i++) { const s = this.slots[i]; if (s && s.id === id && s.count < max) fill(s); }
    for (let i = 0; i < 36 && left; i++) {
      if (!this.slots[i]) { const n = Math.min(max, left); this.slots[i] = { id, count: n }; left -= n; }
    }
    if (left !== count) this.changed();
    return left;
  }
  // a stack back into the inventory (closing a screen); what does not fit is dropped
  placeBack(stack) {
    if (!stack || !stack.count) return;
    const left = this.add(stack.id, stack.count);
    if (left > 0) this.emit('drop', { id: stack.id, count: left });
  }
  /* One (or n) from the selected stack, after placing a block. Creative
     never runs out. Returns false when there was nothing to take. */
  takeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return false;
    if (this.mode === 'creative') return true;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
    return true;
  }
  /* Pick block (middle click on the world), as the game does it: already in
     the hotbar selects it; elsewhere in the inventory swaps it into the
     hotbar; in creative, missing, it goes into the hotbar (an empty slot
     from the selected one on, else the selected slot, moving what was there
     into the inventory if there is room). Returns true when it did anything. */
  pickBlock(id) {
    if (!id) return false;
    const at = this.findSlot(id);
    if (at >= 0 && at < 9) { this.selected = at; this.changed(); return true; }
    const hs = this._suitableHotbarSlot();
    if (at >= 9) {
      const t = this.slots[hs]; this.slots[hs] = this.slots[at]; this.slots[at] = t;
      this.selected = hs; this.changed(); return true;
    }
    if (this.mode !== 'creative') return false;
    const old = this.slots[hs];
    if (old) { for (let i = 9; i < 36; i++) if (!this.slots[i]) { this.slots[i] = old; break; } }
    this.slots[hs] = { id, count: 1 };
    this.selected = hs;
    this.changed();
    return true;
  }
  _suitableHotbarSlot() {
    for (let k = 0; k < 9; k++) { const i = (this.selected + k) % 9; if (!this.slots[i]) return i; }
    return this.selected;
  }
  clear() {
    this.slots.fill(null); this.armor.fill(null); this.offhand = null; this.craft.fill(null); this.carried = null;
    this.changed();
  }

  /* Saved by block name, so a save survives the block list being renumbered. */
  toJSON() {
    const out = s => (s ? [BLOCKS[s.id] ? BLOCKS[s.id].name : '', s.count] : null);
    return { v: 1, mode: this.mode, selected: this.selected, slots: this.slots.map(out), armor: this.armor.map(out), offhand: out(this.offhand), craft: this.craft.map(out) };
  }
  fromJSON(o) {
    if (!o || typeof o !== 'object') return this;
    const inn = a => {
      if (!Array.isArray(a)) return null;
      const id = B[a[0]];
      return id ? { id, count: Math.max(1, Math.min(maxStack(id), a[1] | 0)) } : null;
    };
    if (o.mode) this.mode = o.mode === 'survival' ? 'survival' : 'creative';
    this.selected = Math.max(0, Math.min(8, o.selected | 0));
    for (let i = 0; i < 36; i++) this.slots[i] = o.slots ? inn(o.slots[i]) : null;
    for (let i = 0; i < 4; i++) this.armor[i] = o.armor ? inn(o.armor[i]) : null;
    this.offhand = inn(o.offhand);
    for (let i = 0; i < 4; i++) this.craft[i] = o.craft ? inn(o.craft[i]) : null;
    this.carried = null;
    this.changed();
    return this;
  }
}

/* ------------------------------ creative tabs ------------------------------ */

export const TABS = [
  { key: 'building', name: 'Building Blocks', icon: ['bricks'], col: 0, top: true },
  { key: 'colored', name: 'Colored Blocks', icon: ['cyan_wool', 'white_wool'], col: 1, top: true },
  { key: 'natural', name: 'Natural Blocks', icon: ['grass_block'], col: 2, top: true },
  { key: 'functional', name: 'Functional Blocks', icon: ['oak_sign', 'crafting_table'], col: 3, top: true },
  { key: 'redstone', name: 'Redstone Blocks', icon: ['redstone_wire', 'redstone_block'], col: 4, top: true },
  { key: 'search', name: 'Search Items', icon: ['lodestone', 'spyglass', 'glass'], col: 5, top: true, right: true, search: true },
  { key: 'inventory', name: 'Survival Inventory', icon: ['chest'], col: 5, top: false, right: true, inventory: true },
];
const TAB_KEYS = ['building', 'colored', 'natural', 'functional', 'redstone'];
let lastTab = 0;                       // the game remembers the tab between openings

// a creative tab for blocks the generated list has not placed yet
function guessTab(d) {
  if (d.shape === 'cross' || d.leaves || d.log || d.fluid || /_ore$|^(dirt|grass_block|sand|gravel|clay|snow|ice|stone|deepslate)$/.test(d.name)) return 'natural';
  return 'building';
}
let itemsCache = null, itemsFor = -1;
// the blocks in each creative tab, in tab order; .all is the search tab's list
export function creativeItems() {
  if (itemsCache && itemsFor === BLOCKS.length) return itemsCache;
  const lists = {};
  for (const k of TAB_KEYS) lists[k] = [];
  for (const d of BLOCKS) {
    if (!d || !d.id || d.item === false || d.lower || d.shape === 'none' && d.iconLayer === undefined && !d.icon) continue;
    if (d.tab === null) continue;
    const tab = d.tab === undefined ? guessTab(d) : d.tab;
    if (lists[tab]) lists[tab].push(d);
  }
  const out = { all: [], tabOf: new Map() };
  for (const k of TAB_KEYS) {
    lists[k].sort((a, b) => (a.order ?? 1e6 + a.id) - (b.order ?? 1e6 + b.id));
    out[k] = lists[k].map(d => d.id);
    for (const id of out[k]) { out.all.push(id); out.tabOf.set(id, k); }
  }
  itemsCache = out; itemsFor = BLOCKS.length;
  return out;
}
const tabIconId = t => { for (const n of t.icon) if (B[n] !== undefined) return B[n]; return B.stone || 1; };

/* ------------------------------ the empty-slot outlines ------------------------------ */

// drawn for Leoncraft (not the game's sprites): head, chest, legs, feet, then the off hand's shield
const OUTLINES = [
  ['', '', '', '....########', '...##########', '..############', '..############', '..####....####', '..###......###', '..###......###'],
  ['', '', '...###....###', '..#####..#####', '..############', '..############', '...##########', '....########', '....########', '....########', '....########', '....########', '....########'],
  ['', '', '....########', '....########', '....########', '....###..###', '....###..###', '....###..###', '....###..###', '....###..###', '....###..###', '....###..###'],
  ['', '', '', '', '', '', '...###....###', '...###....###', '...###....###', '...###....###', '..####...####', '..####...####', '.#####..#####'],
  ['', '', '...##########', '...##########', '...##########', '...##########', '...##########', '...##########', '....########', '....########', '.....######', '......####', '.......##'],
];
function drawOutline(g, kind, x, y) {
  const rows = OUTLINES[kind];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    let c = 0;
    while (c < row.length) {
      if (row[c] !== '#') { c++; continue; }
      let e = c;
      while (e < row.length && row[e] === '#') e++;
      g.fill(x + c, y + r + 1, x + e, y + r + 2, 0x2CFFFFFF);
      c = e;
    }
  }
}

/* ------------------------------ drawing a stack ------------------------------ */

// an item and its count, the count in the slot's bottom-right corner as in the game
export function drawStack(g, icons, st, x, y, countText, countColour) {
  if (!st) return;
  icons.draw(g, st.id, x, y);
  const text = countText !== undefined ? countText : st.count > 1 ? String(st.count) : '';
  if (text) g.text(text, x + 19 - 2 - g.textWidth(text), y + 6 + 3, countColour || WHITE, true);
}

/* ------------------------------ the shared container screen ------------------------------ */

/* A slot on a screen: x, y (GUI pixels, the 16 x 16 item area), kind
   ('inv' i 0-35, 'armor' i 0-3, 'offhand', 'craft' i 0-3, 'result',
   'grid' i 0-44, 'destroy'), an empty outline to draw, and a stack limit. */
const slot = (x, y, kind, i, extra) => Object.assign({ x, y, kind, i: i || 0 }, extra || null);

// the last pointer press, read before the GUI handles it (shift-click, which button)
const press = { shift: false, ctrl: false };
const hooked = new WeakSet();
function watchPointer(canvas) {
  if (hooked.has(canvas)) return;
  hooked.add(canvas);
  canvas.addEventListener('pointerdown', e => { press.shift = e.shiftKey; press.ctrl = e.ctrlKey || e.metaKey; }, true);
}

class ContainerScreen extends Screen {
  constructor(inv, icons, imageWidth, imageHeight) {
    super('');
    this.inv = inv; this.icons = icons;
    this.imageWidth = imageWidth; this.imageHeight = imageHeight;
    this.background = 'none';
    this.slots = [];
    this.hover = null;
    this.drag = null;                  // { button, slots: [] } while spreading a stack
    this.dbl = false; this.lastSlot = null; this.lastTime = 0; this.lastButton = -1;
    this._anim = false;
  }
  // keep redrawing while icons are still being made
  get animates() { return this._anim || !!(this.icons && this.icons.pending); }
  set animates(v) { this._anim = v; }
  get creative() { return this.inv.mode === 'creative'; }

  init() {
    this.left = Math.floor((this.width - this.imageWidth) / 2);
    this.top = Math.floor((this.height - this.imageHeight) / 2);
    if (this.gui) watchPointer(this.gui.canvas);
    this.slots = this.makeSlots();
  }
  makeSlots() { return []; }

  /* ---- slot contents ---- */
  getStack(s) {
    const inv = this.inv;
    switch (s.kind) {
      case 'inv': return inv.slots[s.i];
      case 'armor': return inv.armor[s.i];
      case 'offhand': return inv.offhand;
      case 'craft': return inv.craft[s.i];
      case 'result': return inv.craftResult;
      default: return null;
    }
  }
  setStack(s, st) {
    if (st && st.count <= 0) st = null;
    const inv = this.inv;
    switch (s.kind) {
      case 'inv': inv.slots[s.i] = st; break;
      case 'armor': inv.armor[s.i] = st; break;
      case 'offhand': inv.offhand = st; break;
      case 'craft': inv.craft[s.i] = st; break;
      case 'result': inv.craftResult = st; break;
    }
  }
  mayPlace(s, st) {
    if (!st) return true;
    if (s.kind === 'result' || s.kind === 'grid' || s.kind === 'destroy') return false;
    if (s.kind === 'armor') return armourSlotOf(st.id) === s.i;
    return true;
  }
  limit(s, id) { return Math.min(maxStack(id), s.kind === 'armor' ? 1 : 64); }
  setCarried(st) { this.inv.carried = st && st.count > 0 ? st : null; }

  // the slot under the pointer (the 18 x 18 square around its item)
  slotAt(mx, my) {
    for (const s of this.slots) if (mx >= s.x - 1 && mx < s.x + 17 && my >= s.y - 1 && my < s.y + 17 && this.slotShown(s)) return s;
    return null;
  }
  slotShown() { return true; }
  isOutside(mx, my) { return mx < this.left || my < this.top || mx >= this.left + this.imageWidth || my >= this.top + this.imageHeight; }

  /* ---- clicks: the game's rules ---- */
  // a plain left (0) or right (2) click on a slot
  click(s, button) {
    const st = this.getStack(s), c = this.inv.carried;
    if (s.kind === 'result') {
      if (!c && st) { this.setCarried(st); this.setStack(s, null); }
      return;
    }
    if (button === 0) {
      if (!c) { if (st) { this.setCarried(st); this.setStack(s, null); } }
      else if (!st) {
        if (!this.mayPlace(s, c)) return;
        const n = Math.min(c.count, this.limit(s, c.id));
        this.setStack(s, { id: c.id, count: n }); c.count -= n;
        if (c.count <= 0) this.setCarried(null);
      } else if (same(st, c)) {
        const n = Math.min(this.limit(s, c.id) - st.count, c.count);
        if (n > 0) { st.count += n; c.count -= n; if (c.count <= 0) this.setCarried(null); }
      } else if (this.mayPlace(s, c) && c.count <= this.limit(s, c.id)) {
        this.setStack(s, c); this.setCarried(st);
      }
    } else if (button === 2) {
      if (!c) {
        if (st) {
          const take = Math.ceil(st.count / 2);
          this.setCarried({ id: st.id, count: take }); st.count -= take;
          if (st.count <= 0) this.setStack(s, null);
        }
      } else if (!st) {
        if (!this.mayPlace(s, c)) return;
        this.setStack(s, { id: c.id, count: 1 }); c.count--;
        if (c.count <= 0) this.setCarried(null);
      } else if (same(st, c)) {
        if (st.count < this.limit(s, c.id)) { st.count++; c.count--; if (c.count <= 0) this.setCarried(null); }
      } else if (this.mayPlace(s, c) && c.count <= this.limit(s, c.id)) {
        this.setStack(s, c); this.setCarried(st);
      }
    }
  }
  // merge a stack into inventory slots (indices), matching stacks first, then the first empty one
  moveInto(st, indices) {
    const max = maxStack(st.id), inv = this.inv;
    for (const i of indices) {
      const t = inv.slots[i];
      if (t && t.id === st.id && t.count < max) { const n = Math.min(max - t.count, st.count); t.count += n; st.count -= n; if (!st.count) return; }
    }
    for (const i of indices) if (!inv.slots[i]) { inv.slots[i] = { id: st.id, count: st.count }; st.count = 0; return; }
  }
  // shift-click: the survival inventory's quick move
  quickMove(s) {
    const st = this.getStack(s);
    if (!st) return;
    const MAIN = range(9, 36), HOT = range(0, 9);
    if (s.kind === 'craft' || s.kind === 'armor' || s.kind === 'offhand' || s.kind === 'result') this.moveInto(st, MAIN.concat(HOT));
    else if (s.kind === 'inv') {
      const a = armourSlotOf(st.id);
      if (a >= 0 && !this.inv.armor[a]) { this.inv.armor[a] = { id: st.id, count: 1 }; st.count--; }
      else this.moveInto(st, s.i >= 9 ? HOT : MAIN);
    }
    if (!st.count) this.setStack(s, null);
  }
  // a double click: gather every matching stack onto the mouse, part stacks first
  pickAll() {
    const c = this.inv.carried;
    if (!c) return;
    const max = maxStack(c.id);
    for (let pass = 0; pass < 2 && c.count < max; pass++) {
      for (const s of this.slots) {
        if (s.kind === 'result' || s.kind === 'grid' || s.kind === 'destroy' || !this.slotShown(s)) continue;
        const st = this.getStack(s);
        if (!same(st, c) || (pass === 0 && st.count >= max)) continue;
        const n = Math.min(max - c.count, st.count);
        c.count += n; st.count -= n;
        if (!st.count) this.setStack(s, null);
        if (c.count >= max) break;
      }
    }
  }
  // 1-9 over a slot: trade places with that hotbar slot
  swapHotbar(s, n) {
    const hs = { kind: 'inv', i: n };
    const a = this.getStack(s), b = this.inv.slots[n];
    if (s.kind === 'result') { if (a && !b) { this.inv.slots[n] = a; this.setStack(s, null); } return; }
    if (b && !this.mayPlace(s, b)) return;
    if (b && b.count > this.limit(s, b.id)) return;
    this.setStack(s, b); this.setStack(hs, a);
  }
  swapOffhand(s) {
    if (s.kind === 'offhand' || s.kind === 'result') return;
    const a = this.getStack(s), b = this.inv.offhand;
    if (b && !this.mayPlace(s, b)) return;
    this.setStack(s, b); this.inv.offhand = a;
  }
  // what can be spread over by a drag
  canDrag(s) {
    const c = this.inv.carried;
    if (!c || !this.mayPlace(s, c) || s.kind === 'result' || s.kind === 'grid' || s.kind === 'destroy') return false;
    const st = this.getStack(s);
    return !st || same(st, c);
  }
  // how many each slot gets: left evenly, right one each, middle (creative) a full stack
  dragShare(d) {
    const c = this.inv.carried;
    if (!c) return 0;
    if (d.button === 0) return Math.floor(c.count / d.slots.length);
    if (d.button === 2) return 1;
    return maxStack(c.id);
  }
  // the counts the dragged-over slots would end with, and what stays on the mouse
  dragPreview() {
    const d = this.drag, c = this.inv.carried;
    if (!d || d.slots.length < 2 || !c) return null;
    const share = this.dragShare(d);
    let left = c.count;
    const counts = new Map();
    for (const s of d.slots) {
      const st = this.getStack(s), have = st ? st.count : 0, lim = this.limit(s, c.id);
      const n = Math.min(lim, have + share);
      counts.set(s, { count: n, capped: have + share > lim });
      if (d.button !== 1) left -= n - have;
    }
    return { counts, left: Math.max(0, left) };
  }
  spread() {
    const p = this.dragPreview(), c = this.inv.carried;
    if (!p) return;
    for (const [s, v] of p.counts) this.setStack(s, { id: c.id, count: v.count });
    if (this.drag.button !== 1) { c.count = p.left; if (!c.count) this.setCarried(null); }
  }
  drop(button) {
    const c = this.inv.carried;
    if (!c) return;
    const n = button === 2 ? 1 : c.count;
    this.inv.emit('drop', { id: c.id, count: n });
    c.count -= n;
    if (!c.count) this.setCarried(null);
  }

  /* ---- input ---- */
  // the screen's own controls (tabs, scrollbar); true when it took the click
  extraClick() { return false; }
  gridClick() {}

  mouseClicked(mx, my, button) {
    const shift = press.shift;
    const s = this.slotAt(mx, my);
    const now = performance.now();
    this.dbl = !!s && s === this.lastSlot && button === this.lastButton && now - this.lastTime < 250;
    this.lastSlot = s; this.lastTime = now; this.lastButton = button;
    this.pressButton = button;
    this.drag = null;
    const hit = this.extraClick(mx, my, button);
    if (hit) { this.inv.changed(); return hit; }
    if (!s) {
      if (this.isOutside(mx, my) && this.inv.carried && button !== 1) this.drop(button);
      this.inv.changed();
      return this.keepFocus();
    }
    const c = this.inv.carried;
    if (s.kind === 'grid') this.gridClick(s, button, shift);
    else if (s.kind === 'destroy') this.destroyClick(shift);
    else if (button === 1) {
      // middle: a full stack of it on the mouse, in creative; or spread full stacks
      if (this.creative && !c) { const st = this.getStack(s); if (st) this.setCarried({ id: st.id, count: maxStack(st.id) }); }
      else if (this.creative && c && this.canDrag(s)) this.drag = { button: 1, slots: [s] };
    } else if (shift && !c) this.shiftClick(s);
    else if (c) this.drag = { button, slots: this.canDrag(s) ? [s] : [] };
    else this.click(s, button);
    this.inv.changed();
    return this.keepFocus();
  }
  keepFocus() { return true; }
  shiftClick(s) { this.quickMove(s); }
  destroyClick() {}
  mouseDragged(mx, my) {
    const d = this.drag, c = this.inv.carried;
    if (!d || !c) return;
    const s = this.slotAt(mx, my);
    if (s && d.slots.indexOf(s) < 0 && this.canDrag(s) && (d.button === 1 || d.slots.length < c.count)) d.slots.push(s);
  }
  mouseReleased(mx, my, button) {
    const d = this.drag;
    this.drag = null;
    if (!d) {
      // a double click that picked a stack up on its second press gathers the rest on release
      const s = this.slotAt(mx, my);
      if (this.dbl && button === 0 && this.inv.carried && s && s.kind !== 'grid' && s.kind !== 'destroy' && s.kind !== 'result') { this.pickAll(); this.dbl = false; this.inv.changed(); }
      return;
    }
    if (this.dbl && d.button === 0) { this.pickAll(); this.dbl = false; }
    else if (d.slots.length > 1) { this.drag = d; this.spread(); this.drag = null; }
    else {
      const s = d.slots[0] || this.slotAt(mx, my);
      if (s && d.button !== 1) this.click(s, d.button);
    }
    this.inv.changed();
  }
  keyPressed(e) {
    if (e.key === 'Escape') { this.gui.back(); return true; }
    const keys = this.options.get('keys') || {};
    if (e.code === keys.inventory) { this.gui.back(); return true; }
    const s = this.slotAt(this.gui.mx, this.gui.my);
    if (!this.inv.carried && s) {
      for (let n = 1; n <= 9; n++) {
        if (e.code === keys['hotbar' + n]) { this.numberKey(s, n - 1); this.inv.changed(); return true; }
      }
      if (e.code === (keys.swapOffhand || 'KeyF')) { if (s.kind !== 'grid' && s.kind !== 'destroy') this.swapOffhand(s); this.inv.changed(); return true; }
      if (keys.drop && e.code === keys.drop) { this.throwFrom(s, e.ctrlKey || e.metaKey); this.inv.changed(); return true; }
    }
    return false;
  }
  numberKey(s, n) { if (s.kind !== 'grid' && s.kind !== 'destroy') this.swapHotbar(s, n); }
  throwFrom(s, all) {
    const st = this.getStack(s);
    if (!st || s.kind === 'grid' || s.kind === 'destroy') return;
    const n = all ? st.count : 1;
    this.inv.emit('drop', { id: st.id, count: n });
    st.count -= n;
    if (!st.count) this.setStack(s, null);
  }
  // closing: what was on the mouse and in the crafting grid goes back into the inventory
  onClose() {
    const inv = this.inv;
    if (inv.carried) { const c = inv.carried; inv.carried = null; inv.placeBack(c); }
    for (let i = 0; i < 4; i++) if (inv.craft[i]) { const c = inv.craft[i]; inv.craft[i] = null; inv.placeBack(c); }
    this.drag = null;
    inv.changed();
  }

  /* ---- drawing ---- */
  // the in-game darkening the game puts behind container screens (no blur)
  drawBackdrop(g) { g.gradient(0, 0, this.width, this.height, 0xC0101010, 0xD0101010); }
  drawSlots(g, mx, my) {
    const prev = this.dragPreview();
    this.hover = this.slotAt(mx, my);
    for (const s of this.slots) {
      if (!this.slotShown(s)) continue;
      const st = this.slotStack(s);
      const pv = prev && prev.counts.get(s);
      if (pv) {
        drawStack(g, this.icons, { id: this.inv.carried.id, count: pv.count }, s.x, s.y, pv.capped ? '§e' + pv.count : pv.count > 1 ? String(pv.count) : '');
        g.fill(s.x, s.y, s.x + 16, s.y + 16, HIGHLIGHT);
        continue;
      }
      if (!st && s.outline !== undefined) drawOutline(g, s.outline, s.x, s.y);
      if (st) drawStack(g, this.icons, st, s.x, s.y);
      if (s === this.hover) g.fill(s.x, s.y, s.x + 16, s.y + 16, HIGHLIGHT);
    }
    if (this.hover && !this.inv.carried) {
      const st = this.slotStack(this.hover);
      if (st) g.setTooltip(this.tooltipFor(st, this.hover));
    }
    return prev;
  }
  slotStack(s) { return this.getStack(s); }
  tooltipFor(st) { return [displayName(st.id)]; }
  // the stack on the mouse, over everything
  drawCarried(g, mx, my, prev) {
    const c = this.inv.carried;
    if (!c || mx < 0) return;
    if (prev) drawStack(g, this.icons, c, mx - 8, my - 8, prev.left === 0 ? '§e0' : prev.left > 1 ? String(prev.left) : '');
    else drawStack(g, this.icons, c, mx - 8, my - 8);
  }
}
const range = (a, b) => { const r = []; for (let i = a; i < b; i++) r.push(i); return r; };

/* ------------------------------ survival inventory ------------------------------ */

export class InventoryScreen extends ContainerScreen {
  constructor(inv, icons) { super(inv, icons, 176, 166); this.title = 'Crafting'; }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    out.push(slot(L + 154, T + 28, 'result'));
    for (let i = 0; i < 4; i++) out.push(slot(L + 98 + (i % 2) * 18, T + 18 + (i >> 1) * 18, 'craft', i));
    for (let i = 0; i < 4; i++) out.push(slot(L + 8, T + 8 + i * 18, 'armor', i, { outline: i }));
    for (let j = 9; j < 36; j++) out.push(slot(L + 8 + (j % 9) * 18, T + 84 + Math.floor((j - 9) / 9) * 18, 'inv', j));
    for (let i = 0; i < 9; i++) out.push(slot(L + 8 + i * 18, T + 142, 'inv', i));
    out.push(slot(L + 77, T + 62, 'offhand', 0, { outline: 4 }));
    return out;
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top;
    g.blit('container/inventory', 0, 0, 176, 166, L, T);
    // the recipe book button (the book itself is not in this preview)
    const bx = L + 104, by = Math.floor(this.height / 2) - 22;
    const overBook = mx >= bx && my >= by && mx < bx + 20 && my < by + 18;
    g.blit('container/inventory', 178, overBook ? 19 : 0, 20, 18, bx, by);
    if (this.inv.drawPlayer) this.inv.drawPlayer(g, L + 26, T + 8, 49, 70, mx, my);
    g.text(this.title, L + 97, T + 8, LABEL_GREY, false);
    const prev = this.drawSlots(g, mx, my);
    this.drawCarried(g, mx, my, prev);
  }
}

/* ------------------------------ creative inventory ------------------------------ */

// the creative search box: no frame of its own (the sheet has one), white text
class SearchField extends TextField {
  draw(g) {
    const { x, y, w } = this;
    this.gui = g;
    const f = g.font;
    if (this.cursor < this.first) this.first = this.cursor;
    while (this.first < this.cursor && f.width(this.value.slice(this.first, this.cursor)) > w) this.first++;
    const shown = f.trim(this.value.slice(this.first), w);
    g.text(shown, x, y, WHITE);
    const cx = x + f.width(this.value.slice(this.first, this.cursor));
    if (this.selEnd !== this.cursor) {
      const s0 = Math.max(this.first, Math.min(this.cursor, this.selEnd)), s1 = Math.min(this.first + shown.length, Math.max(this.cursor, this.selEnd));
      if (s1 > s0) {
        const a = x + f.width(this.value.slice(this.first, s0)), b = x + f.width(this.value.slice(this.first, s1));
        g.ctx.globalCompositeOperation = 'difference';
        g.fill(a, y - 1, b, y + 9, 0xFFFFFFFF);
        g.ctx.globalCompositeOperation = 'source-over';
      }
    }
    if (this.focused && (((g.now - this.focusTime) / 300 | 0) & 1) === 0) {
      if (this.cursor < this.value.length || this.value.length >= this.maxLength) g.fill(cx, y - 1, cx + 1, y + 9, 0xFFD0D0D0);
      else g.text('_', cx, y, WHITE);
    }
  }
  mouseClicked(mx, my) {
    if (!this.visible || !this.isMouseOver(mx, my)) return false;
    const g = this.gui;
    if (g) {
      const f = g.font, rel = mx - this.x;
      let i = this.first;
      while (i < this.value.length && f.width(this.value.slice(this.first, i + 1)) <= rel) i++;
      this.cursor = this.selEnd = i;
      g.focusText(this);
      try { g.input.setSelectionRange(i, i); } catch (e) { /* hidden */ }
      this.focusTime = performance.now();
    }
    return true;
  }
}

export class CreativeInventoryScreen extends ContainerScreen {
  constructor(inv, icons) {
    super(inv, icons, 195, 136);
    this.tab = lastTab;
    this.scroll = 0;
    this.scrolling = false;
    this.items = [];
    this.search = new SearchField(0, 0, 88, 9, { maxLength: 50, onChange: () => this.refresh() });
    this.pressTab = -1;
  }
  get T() { return TABS[this.tab]; }
  init() {
    super.init();
    this.search.x = this.left + 82; this.search.y = this.top + 6;
    this.search.gui = this.gui;
    this.refresh(true);
    if (this.T.search) this.gui.focusText(this.search);
  }
  makeSlots() {
    const L = this.left, T = this.top, out = [];
    // the item grid and hotbar of the block tabs
    for (let i = 0; i < 45; i++) out.push(slot(L + 9 + (i % 9) * 18, T + 18 + Math.floor(i / 9) * 18, 'grid', i, { tab: 'items' }));
    for (let i = 0; i < 9; i++) out.push(slot(L + 9 + i * 18, T + 112, 'inv', i, { tab: 'any' }));
    // the Survival Inventory tab
    for (let k = 0; k < 4; k++) out.push(slot(L + 54 + (k >> 1) * 54, T + 6 + (k & 1) * 27, 'armor', k, { tab: 'inv', outline: k }));
    out.push(slot(L + 35, T + 20, 'offhand', 0, { tab: 'inv', outline: 4 }));
    for (let j = 9; j < 36; j++) out.push(slot(L + 9 + (j % 9) * 18, T + 54 + Math.floor((j - 9) / 9) * 18, 'inv', j, { tab: 'inv' }));
    out.push(slot(L + 173, T + 112, 'destroy', 0, { tab: 'inv' }));
    return out;
  }
  slotShown(s) {
    if (s.tab === 'any') return true;
    return this.T.inventory ? s.tab === 'inv' : s.tab === 'items';
  }

  /* ---- the tab's items and scrolling ---- */
  refresh(keepScroll) {
    const all = creativeItems();
    const t = this.T;
    if (t.search) {
      const q = this.search.value.trim().toLowerCase();
      this.items = q ? all.all.filter(id => {
        const d = BLOCKS[id];
        return displayName(id).toLowerCase().indexOf(q) >= 0 || d.name.replace(/_/g, ' ').indexOf(q) >= 0 || d.name.indexOf(q) >= 0;
      }) : all.all;
    } else if (t.inventory) this.items = [];
    else this.items = all[t.key] || [];
    if (!keepScroll) this.scroll = 0;
    if (this.gui) this.gui.markDirty();
  }
  get rows() { return Math.ceil(this.items.length / 9); }
  canScroll() { return !this.T.inventory && this.rows > 5; }
  rowOffset() { const extra = this.rows - 5; return extra > 0 ? Math.max(0, Math.floor(this.scroll * extra + 0.5)) : 0; }
  gridItem(i) { const k = this.rowOffset() * 9 + i; return k < this.items.length ? this.items[k] : 0; }
  slotStack(s) {
    if (s.kind === 'grid') { const id = this.gridItem(s.i); return id ? { id, count: 1 } : null; }
    return this.getStack(s);
  }
  getStack(s) { return s.kind === 'grid' ? this.slotStack(s) : super.getStack(s); }
  mouseScrolled(mx, my, d) {
    if (!this.canScroll()) return false;
    this.scroll = Math.max(0, Math.min(1, this.scroll - d / (this.rows - 5)));
    return true;
  }
  inScrollbar(mx, my) {
    const x0 = this.left + 175, y0 = this.top + 18;
    return mx >= x0 && my >= y0 && mx < x0 + 14 && my < y0 + 112;
  }
  scrollTo(my) {
    const y0 = this.top + 18, y1 = y0 + 112;
    this.scroll = Math.max(0, Math.min(1, (my - y0 - 7.5) / (y1 - y0 - 15)));
  }

  /* ---- tabs ---- */
  tabX(t) { return this.left + (t.right ? this.imageWidth - 28 * (6 - t.col) : 28 * t.col + t.col); }
  tabY(t) { return t.top ? this.top - 28 : this.top + this.imageHeight - 4; }
  tabAt(mx, my) {
    for (let i = 0; i < TABS.length; i++) {
      const t = TABS[i], x = this.tabX(t), y = this.tabY(t);
      if (mx >= x && mx <= x + 28 && my >= y && my <= y + 32) return i;
    }
    return -1;
  }
  selectTab(i) {
    if (i === this.tab) return;
    const g = this.gui;
    const was = this.T;
    this.tab = lastTab = i;
    this.drag = null;
    if (was.search && g.textFocus === this.search) g._blurText();
    if (this.T.search) { this.search.setValue(''); g.focusText(this.search); }
    this.refresh();
  }
  isOutside(mx, my) { return super.isOutside(mx, my) && this.tabAt(mx, my) < 0; }

  /* ---- clicks ---- */
  extraClick(mx, my, button) {
    const ti = this.tabAt(mx, my);
    if (ti >= 0) { this.pressTab = ti; return this.keepFocus(); }
    this.pressTab = -1;
    if (button === 0 && this.canScroll() && this.inScrollbar(mx, my)) { this.scrolling = true; this.scrollTo(my); return this.keepFocus(); }
    if (this.T.search && this.search.mouseClicked(mx, my, button)) return this.search;
    return false;
  }
  // on the search tab the box keeps the focus, whatever is clicked, as in the game
  keepFocus() { return this.T.search ? this.search : true; }
  gridClick(s, button, shift) {
    const id = this.gridItem(s.i), c = this.inv.carried;
    const max = id ? maxStack(id) : 64;
    if (button === 1) { if (!c && id) this.setCarried({ id, count: max }); return; }
    if (c && id && c.id === id) {
      if (button === 0) { if (shift) c.count = max; else if (c.count < max) c.count++; }
      else { c.count--; if (!c.count) this.setCarried(null); }
    } else if (id && !c) {
      if (shift) {
        // a full stack straight into the hotbar: onto the same block, else the first empty slot
        const hot = this.inv.slots;
        let at = -1;
        for (let i = 0; i < 9 && at < 0; i++) if (hot[i] && hot[i].id === id) at = i;
        for (let i = 0; i < 9 && at < 0; i++) if (!hot[i]) at = i;
        if (at >= 0) hot[at] = { id, count: max };
        else this.setCarried({ id, count: max });
      } else this.setCarried({ id, count: 1 });
    } else if (button === 0) this.setCarried(null);        // clicking the grid with something else throws it away
    else if (c) { c.count--; if (!c.count) this.setCarried(null); }
  }
  shiftClick(s) {
    // on a block tab, shift-clicking the hotbar row clears that slot, as in the game
    if (!this.T.inventory && s.kind === 'inv') { this.setStack(s, null); return; }
    this.quickMove(s);
  }
  destroyClick(shift) {
    if (shift) { const inv = this.inv; inv.slots.fill(null); inv.armor.fill(null); inv.offhand = null; return; }
    this.setCarried(null);
  }
  numberKey(s, n) {
    if (s.kind === 'grid') { const id = this.gridItem(s.i); if (id) this.inv.slots[n] = { id, count: maxStack(id) }; return; }
    super.numberKey(s, n);
  }
  mouseDragged(mx, my, button) {
    if (this.scrolling) { this.scrollTo(my); return; }
    super.mouseDragged(mx, my, button);
  }
  mouseReleased(mx, my, button) {
    if (this.scrolling) { this.scrolling = false; return; }
    if (this.pressTab >= 0) {
      const ti = this.tabAt(mx, my);
      if (ti === this.pressTab) this.selectTab(ti);
      this.pressTab = -1;
      return;
    }
    super.mouseReleased(mx, my, button);
  }
  keyPressed(e) {
    if (e.key === 'Escape') { this.gui.back(); return true; }
    // the search box takes every key while it has the focus
    if (this.T.search && this.gui.textFocus === this.search) return false;
    // T (the chat key) jumps to the search tab
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey && !e.altKey) { this.selectTab(TABS.findIndex(t => t.search)); return true; }
    return super.keyPressed(e);
  }
  tooltipFor(st, s) {
    const lines = [displayName(st.id)];
    if (s && s.kind === 'grid' && this.T.search) {
      const k = creativeItems().tabOf.get(st.id);
      const t = TABS.find(x => x.key === k);
      if (t) lines.push('§9' + t.name);
    }
    return lines;
  }
  onClose() { super.onClose(); if (this.gui && this.gui.textFocus === this.search) this.gui._blurText(); }

  /* ---- drawing ---- */
  drawTab(g, i, mx, my) {
    const t = TABS[i], sel = i === this.tab;
    const x = this.tabX(t), y = this.tabY(t);
    const sy = t.top ? (sel ? 32 : 0) : (sel ? 96 : 64);
    g.blit('container/creative_inventory/tabs', t.col * 28, sy, 28, 32, x, y);
    this.icons.draw(g, tabIconId(t), x + 6, y + 8 + (t.top ? 1 : -1));
  }
  render(g, mx, my) {
    this.drawBackdrop(g);
    const L = this.left, T = this.top, t = this.T;
    for (let i = 0; i < TABS.length; i++) if (i !== this.tab) this.drawTab(g, i, mx, my);
    const sheet = t.inventory ? 'tab_inventory' : t.search ? 'tab_item_search' : 'tab_items';
    g.blit('container/creative_inventory/' + sheet, 0, 0, 195, 136, L, T);
    if (t.search) this.search.draw(g);
    if (!t.inventory) {
      const can = this.canScroll();
      g.blit('container/creative_inventory/tabs', can ? 232 : 244, 0, 12, 15, L + 175, T + 18 + Math.floor(95 * (can ? this.scroll : 0)));
    }
    this.drawTab(g, this.tab, mx, my);
    if (!t.inventory) g.text(t.name, L + 8, T + 6, LABEL_GREY, false);
    else if (this.inv.drawPlayer) this.inv.drawPlayer(g, L + 73, T + 6, 32, 43, mx, my);
    const prev = this.drawSlots(g, mx, my);
    if (this.hover && this.hover.kind === 'destroy' && !this.inv.carried) g.setTooltip(['Destroy Item']);
    // a tab under the pointer names itself
    const ti = this.tabAt(mx, my);
    if (ti >= 0 && !this.inv.carried) g.setTooltip([TABS[ti].name]);
    this.drawCarried(g, mx, my, prev);
  }
}

// the inventory screen for the inventory's mode: creative tabs or the survival one
export function inventoryScreen(inv, icons) {
  return inv.mode === 'creative' ? new CreativeInventoryScreen(inv, icons) : new InventoryScreen(inv, icons);
}
