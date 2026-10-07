/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Advancements and Statistics screens of the game menu
   (the progress itself is js/advancements.js).

   Advancements: the game's window (252 x 140) with a tab for each of its
   five trees above it (Minecraft, Nether, The End, Adventure, Husbandry);
   inside, the tree laid out from its root on the left, each advancement in
   its frame (a square for a task, rounded for a goal, spiked for a
   challenge; gold when done), lines from each to its parent; drag to move
   about, hover for its name, its line of description and how far along it
   is. Only what you have done and what follows from it shows, as in the
   game (hidden ones once done).

   Statistics: General (time played, distances, jumps, deaths, kills, damage
   taken...), Items (mined, used, picked up) and Mobs (killed, killed by),
   the game's three pages, with Done.
--------------------------------------------------------------------------- */
import { Screen, Button, ScrollList, WHITE, GREY } from './gui.js?v=24';
import { ADVANCEMENTS } from '../advdata.js?v=24';
import { progress, TABS, itemIdOf } from '../advancements.js?v=24';

const WW = 252, WH = 140, IW = 234, IH = 113, NODE = 26, STEP_X = 30, STEP_Y = 27;
const icons = () => { const L = typeof window !== 'undefined' ? window.__lc2 : null; return L && L.hands && L.hands.icons; };

// a tab's tree laid out: depth across, leaves one after another down, a parent level with the middle of its children
function layout(tab, P) {
  const list = ADVANCEMENTS.filter(a => a.id.startsWith(tab + '/') && P.visible(a));
  const kids = new Map(), byId = new Map(list.map(a => [a.id, a]));
  let root = null;
  for (const a of list) {
    if (!a.parent || !byId.has(a.parent)) { if (!a.parent) root = a; continue; }
    (kids.get(a.parent) || kids.set(a.parent, []).get(a.parent)).push(a);
  }
  const pos = new Map();
  let slot = 0;
  const place = (a, depth) => {
    const ch = kids.get(a.id) || [];
    if (!ch.length) { pos.set(a.id, [depth * STEP_X, slot * STEP_Y]); slot++; return; }
    for (const c of ch) place(c, depth + 1);
    const ys = ch.map(c => pos.get(c.id)[1]);
    pos.set(a.id, [depth * STEP_X, (Math.min(...ys) + Math.max(...ys)) / 2]);
  };
  if (root) place(root, 0);
  return { list: list.filter(a => pos.has(a.id)), pos };
}

export class AdvancementsScreen extends Screen {
  constructor() { super('Advancements'); this.tab = 0; this.sx = 0; this.sy = 0; this.drag = null; this.animates = false; }
  init() {
    this.add(new Button(this.width / 2 - 100, this.height / 2 + WH / 2 + 8, 200, 20, 'Done', () => this.gui.back()));
    this.relayout();
  }
  relayout() {
    this.L = layout(TABS[this.tab].id, progress());
    this.sx = 0; this.sy = 0;
  }
  get wx() { return Math.floor(this.width / 2 - WW / 2); }
  get wy() { return Math.floor(this.height / 2 - WH / 2); }
  mouseClicked(mx, my, button) {
    // the tabs along the top of the window
    for (let i = 0; i < TABS.length; i++) {
      const tx = this.wx + i * 32, ty = this.wy - 28;
      if (mx >= tx && mx < tx + 28 && my >= ty && my < ty + 28) { this.tab = i; this.relayout(); this.gui.markDirty(); return true; }
    }
    const ix = this.wx + 9, iy = this.wy + 18;
    if (mx >= ix && mx < ix + IW && my >= iy && my < iy + IH) { this.drag = [mx, my, this.sx, this.sy]; return true; }
    return super.mouseClicked(mx, my, button);
  }
  mouseDragged(mx, my, button) {
    if (this.drag) { this.sx = this.drag[2] + (mx - this.drag[0]); this.sy = this.drag[3] + (my - this.drag[1]); this.gui.markDirty(); return; }
    super.mouseDragged(mx, my, button);
  }
  mouseReleased(mx, my, button) { this.drag = null; super.mouseReleased(mx, my, button); }
  mouseScrolled(mx, my, d) { this.sy += d * 16; this.gui.markDirty(); return true; }
  render(g, mx, my, dt) {
    const P = progress(), x0 = this.wx, y0 = this.wy, ix = x0 + 9, iy = y0 + 18, tab = TABS[this.tab];
    // the tabs: the chosen one joined to the window
    TABS.forEach((t, i) => {
      const tx = x0 + i * 32, ty = y0 - 28, on = i === this.tab;
      g.fill(tx, ty, tx + 28, ty + 28 + (on ? 2 : 0), 0xFF000000);
      g.fill(tx + 1, ty + 1, tx + 27, ty + 28 + (on ? 2 : -1), on ? 0xFFC6C6C6 : 0xFF8B8B8B);
      const ic = icons(), id = itemIdOf(t.icon);
      if (ic && id) ic.draw(g, id, tx + 6, ty + 7);
    });
    // the window and its inside
    g.fill(x0, y0, x0 + WW, y0 + WH, 0xFF000000);
    g.fill(x0 + 1, y0 + 1, x0 + WW - 1, y0 + WH - 1, 0xFFC6C6C6);
    g.fill(ix - 1, iy - 1, ix + IW + 1, iy + IH + 1, 0xFF555555);
    g.fill(ix, iy, ix + IW, iy + IH, tab.bg);
    g.text(tab.title, x0 + 8, y0 + 6, 0x404040, false);
    const L = this.L;
    // how far it may move: the tree within the window
    let maxX = 0, maxY = 0;
    for (const [, p] of L.pos) { maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
    this.sx = Math.max(Math.min(0, IW - (maxX + NODE + 8)), Math.min(0, this.sx));
    this.sy = Math.max(Math.min(0, IH - (maxY + NODE + 8)), Math.min(0, this.sy));
    const ox = ix + 6 + this.sx, oy = iy + 6 + this.sy;
    g.scissor(ix, iy, ix + IW, iy + IH);
    // a faint grid, as the game's tiled background
    for (let x = ix + (this.sx % 16) - 16; x < ix + IW; x += 16) for (let y = iy + (this.sy % 16) - 16; y < iy + IH; y += 16)
      if (((x - ix - this.sx) / 16 + (y - iy - this.sy) / 16) & 1) g.fill(x, y, x + 16, y + 16, 0x14FFFFFF);
    // lines to each parent: out of the parent's right, down or up, into the child's left
    for (const pass of [0, 1]) for (const a of L.list) {
      if (!a.parent || !L.pos.has(a.parent)) continue;
      const [cx, cy] = L.pos.get(a.id), [px, py] = L.pos.get(a.parent);
      const x1 = ox + px + NODE, y1 = oy + py + NODE / 2, x2 = ox + cx, y2 = oy + cy + NODE / 2, xm = Math.floor((x1 + x2) / 2);
      const col = pass ? (P.done[a.id] ? 0xFFFFFFFF : 0xFFA0A0A0) : 0xFF000000, w = pass ? 0 : 1;
      g.fill(x1, y1 - w, xm + 1 + w, y1 + 1 + w, col);
      g.fill(xm - w, Math.min(y1, y2) - w, xm + 1 + w, Math.max(y1, y2) + 1 + w, col);
      g.fill(xm - w, y2 - w, x2, y2 + 1 + w, col);
    }
    let hover = null;
    for (const a of L.list) {
      const [px, py] = L.pos.get(a.id), x = ox + px, y = oy + py;
      frame(g, x, y, a.frame, !!P.done[a.id]);
      const ic = icons(), id = itemIdOf(a.icon);
      if (ic && id) ic.draw(g, id, x + 5, y + 5);
      if (mx >= x && mx < x + NODE && my >= y && my < y + NODE && mx >= ix && mx < ix + IW && my >= iy && my < iy + IH) hover = [a, x, y];
    }
    g.endScissor();
    if (hover) tip(g, hover[0], hover[1], hover[2], P);
    g.centered('Advancements', this.width / 2, y0 - 40, WHITE);
    super.render(g, mx, my, dt);
  }
}
// an advancement's frame: square (task), rounded (goal) or spiked (challenge); gold when done
function frame(g, x, y, kind, done) {
  const edge = done ? 0xFFE0B030 : 0xFF7A7A7A, inner = done ? 0xFF6E5414 : 0xFF3A3A3A, hi = done ? 0xFFFFE27A : 0xFFA8A8A8;
  // a box inset by i, its corners cut by r (a goal's are rounded)
  const box = (i, r, c) => {
    if (!r) { g.fill(x + i, y + i, x + NODE - i, y + NODE - i, c); return; }
    g.fill(x + i + r, y + i, x + NODE - i - r, y + NODE - i, c);
    g.fill(x + i, y + i + r, x + NODE - i, y + NODE - i - r, c);
    g.fill(x + i + 1, y + i + 1, x + NODE - i - 1, y + NODE - i - 1, c);
  };
  const r = kind === 'goal' ? 2 : 0;
  box(0, r, 0xFF000000); box(1, r, edge); box(3, r ? 1 : 0, inner);
  g.fill(x + 1 + r, y + 1, x + NODE - 1 - r, y + 2, hi);
  // a challenge's spikes at the corners
  if (kind === 'challenge') for (const [cx, cy] of [[x - 2, y - 2], [x + NODE - 1, y - 2], [x - 2, y + NODE - 1], [x + NODE - 1, y + NODE - 1]]) {
    g.fill(cx, cy, cx + 3, cy + 3, 0xFF000000);
    g.fill(cx + 1, cy + 1, cx + 2, cy + 2, edge);
  }
}
// the name in a bar across the frame (blue, gold once done), the description under it
function tip(g, a, x, y, P) {
  const done = !!P.done[a.id], [n, of] = P.progress(a);
  const lines = String(a.desc || '').split('\n'), title = a.title + (of > 1 && !done ? '  ' + n + '/' + of : '');
  const w = Math.max(g.textWidth(title) + 36, ...lines.map(l => g.textWidth(l) + 12), 120);
  g.fill(x - 3, y + NODE, x - 3 + w, y + NODE + 4 + lines.length * 10, 0xEE101010);
  lines.forEach((l, i) => g.text(l, x + 3, y + NODE + 2 + i * 10, done ? 0xFFFF55 : 0x55FF55, false));
  g.fill(x - 3, y + 3, x - 3 + w, y + NODE - 3, 0xFF000000);
  g.fill(x - 2, y + 4, x - 4 + w, y + NODE - 4, done ? 0xFFC79A26 : 0xFF0B5A8C);
  frame(g, x, y, a.frame, done);
  const ic = icons(), id = itemIdOf(a.icon);
  if (ic && id) ic.draw(g, id, x + 5, y + 5);
  g.text(title, x + NODE + 4, y + 9, 0xFFFFFF, true);
}

/* ------------------------------------------------------------ statistics -- */
const GENERAL = [
  ['play_time', 'Time Played', 'time'], ['walk_one_cm', 'Distance Walked', 'dist'], ['sprint_one_cm', 'Distance Sprinted', 'dist'],
  ['crouch_one_cm', 'Distance Crouched', 'dist'], ['swim_one_cm', 'Distance Swum', 'dist'], ['walk_under_water_one_cm', 'Distance Walked under Water', 'dist'],
  ['fly_one_cm', 'Distance Flown', 'dist'], ['fall_one_cm', 'Distance Fallen', 'dist'], ['boat_one_cm', 'Distance by Boat', 'dist'],
  ['minecart_one_cm', 'Distance by Minecart', 'dist'], ['horse_one_cm', 'Distance by Horse', 'dist'], ['pig_one_cm', 'Distance by Pig', 'dist'],
  ['strider_one_cm', 'Distance by Strider', 'dist'], ['jump', 'Jumps'], ['damage_taken', 'Damage Taken', 'tenth'], ['deaths', 'Number of Deaths'],
  ['mob_kills', 'Mob Kills'], ['animals_bred', 'Animals Bred'], ['sleep_in_bed', 'Times Slept in a Bed'],
];
function fmt(v, kind) {
  v = v || 0;
  if (kind === 'time') {
    const s = v / 20;
    return s < 60 ? s.toFixed(2) + ' s' : s < 3600 ? (s / 60).toFixed(2) + ' min' : s < 86400 ? (s / 3600).toFixed(2) + ' h' : (s / 86400).toFixed(2) + ' d';
  }
  if (kind === 'dist') { const m = v / 100; return m < 1000 ? m.toFixed(2) + ' m' : (m / 1000).toFixed(2) + ' km'; }
  if (kind === 'tenth') return (v / 10).toFixed(1);
  return String(v);
}
const title = n => n.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
class Row {
  constructor(left, right, icon) { this.left = left; this.right = right; this.icon = icon; }
  render(g, list, i, y, x, w) {
    if (i & 1) g.fill(x - 2, y - 1, x + w - 2, y + 11, 0x22FFFFFF);
    let tx = x + 2;
    if (this.icon) { const ic = icons(), id = itemIdOf(this.icon); if (ic && id) ic.draw(g, id, x, y - 4); tx = x + 20; }
    g.text(this.left, tx, y + 1, WHITE, true);
    for (let k = 0; k < this.right.length; k++) { const t = this.right[k], cx = x + w - 8 - (this.right.length - 1 - k) * 56; g.text(t, cx - g.textWidth(t), y + 1, WHITE, true); }
  }
}
export class StatisticsScreen extends Screen {
  constructor() { super('Statistics'); this.page = 0; }
  init() {
    const W = this.width, H = this.height, P = progress(), st = P.stats || {};
    this.list = this.add(new ScrollList(0, 32, W, H - 96, this.page === 1 ? 20 : 12, { rowWidth: 280 }));
    if (this.page === 0) this.list.entries = GENERAL.map(([k, name, kind]) => new Row(name, [fmt(st[k], kind)]));
    else if (this.page === 1) {
      const names = new Set([...Object.keys(st.mined || {}), ...Object.keys(st.used || {}), ...Object.keys(st.picked_up || {})]);
      this.list.entries = [...names].sort().map(n => new Row(title(n), [String((st.mined || {})[n] || '-'), String((st.used || {})[n] || '-'), String((st.picked_up || {})[n] || '-')], n));
    } else {
      const kills = st.killed || {};
      this.list.entries = Object.keys(kills).sort().map(n => new Row(title(n), ['You killed ' + kills[n]]));
      if (st.deaths) this.list.entries.push(new Row('Deaths', [String(st.deaths)]));
    }
    const b = (x, label, i) => { const btn = this.add(new Button(x, H - 52, 98, 20, label, () => { this.page = i; this.gui._initScreen(this); })); btn.active = this.page !== i; };
    b(W / 2 - 152, 'General', 0); b(W / 2 - 49, 'Items', 1); b(W / 2 + 54, 'Mobs', 2);
    this.add(new Button(W / 2 - 100, H - 28, 200, 20, 'Done', () => this.gui.back()));
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    this.drawTitle(g, 12);
    if (this.page === 1) for (const [k, t] of [[2, 'Mined'], [1, 'Used'], [0, 'Picked Up']]) { const cx = this.width / 2 + 140 - 8 - k * 56; g.text(t, cx - g.textWidth(t), 22, GREY, true); }
    if (!this.list.entries.length) g.centered('Nothing yet', this.width / 2, this.height / 2 - 10, GREY);
  }
}
