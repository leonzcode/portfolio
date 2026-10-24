/* ---------------------------------------------------------------------------
   Leoncraft 2 - chat.

   The game's chat: lines in the bottom left over a half-dark band, each
   fading out ten seconds after it arrived (the last second a fade), the
   last ten shown while you play and the last twenty with chat open. T opens
   it, / opens it with a slash already typed; Enter sends, Esc closes, Up and
   Down walk back through what you sent. A command gets the game's
   suggestions as it is typed (ChatScreen).
--------------------------------------------------------------------------- */
import { Screen, TextField } from './gui.js?v=107';
import { execute, suggestions, commandDef } from '../commands.js?v=107';

const LINE = 9, KEEP = 100, WIDTH = 320;
const ROWS = 10;           // suggestions shown at once (the list scrolls past that)

export class Chat {
  constructor() {
    this.lines = [];        // newest last: { text, colour, at }
    this.sent = [];         // what you typed, for Up and Down
    this.open = false;
    this.dirty = true;
    this.under = true;      // part of the HUD: a screen (the inventory, a chest) covers it, as in the game
  }
  /* extra.hover: { text, lines } a part of the line with a tooltip under the mouse while chat is open (an advancement's name)
     extra.click: [{ text, run, tip }] parts of the line that run a command when clicked with chat open (the game's
     run_command click event: a teleport request's /tpaccept and /tpdeny), tip the tooltip shown over them */
  add(text, colour = 0xFFFFFF, extra) {
    const click = extra && Array.isArray(extra.click) ? extra.click.filter(c => c && typeof c.text === 'string' && typeof c.run === 'string' && c.run.startsWith('/')) : null;
    for (const part of String(text).split('\n')) this.lines.push({ text: part, colour, at: performance.now(), hover: extra && extra.hover || null, click: click && click.length ? click : null });
    if (this.lines.length > KEEP) this.lines.splice(0, this.lines.length - KEEP);
    this.dirty = true;
  }
  // a line wrapped to the chat's width, each row starting in the colour the row before it ended in
  wrapped(f, text) {
    const parts = f.wrap(text, WIDTH);
    let code = '';
    return parts.map((p, i) => {
      const row = i && code && !p.startsWith('§') ? code + p : p;
      const m = p.match(/§[0-9a-hr]/gi);
      if (m) code = m[m.length - 1].toLowerCase() === '§r' ? '' : m[m.length - 1];
      return row;
    });
  }
  // the rows open chat shows, newest first: [row text, the line it is part of, its bottom y] (as draw lays them)
  openRows(g) {
    const f = g.font, out = [];
    let y = g.height - 40;
    for (let i = this.lines.length - 1; i >= 0 && out.length < 20; i--) {
      const l = this.lines[i], parts = this.wrapped(f, l.text);
      for (let k = parts.length - 1; k >= 0 && out.length < 20; k--, y -= LINE) out.push([parts[k], l, y]);
    }
    return out;
  }
  // the part of a row under the mouse: [part, row] for a hover or click part, or null
  partAt(g, mx, my, key) {
    const f = g.font;
    for (const [row, l, y] of this.openRows(g)) {
      if (my < y - LINE || my >= y) continue;
      const list = key === 'hover' ? (l.hover ? [l.hover] : []) : l.click || [];
      for (const p of list) {
        const at = row.indexOf(p.text);
        if (at < 0) continue;
        const x0 = 2 + f.width(row.slice(0, at)), x1 = x0 + f.width(p.text);
        if (mx >= x0 && mx < x1) return p;
      }
      return null;
    }
    return null;
  }
  // with chat open: the command a click at the mouse runs, if it is over one
  clickAt(g, mx, my) { const p = this.partAt(g, mx, my, 'click'); return p ? p.run : null; }
  // redrawn when a line comes in and while one is fading (its last second); for the nine
  // seconds in between nothing about it changes, so the HUD is not drawn again for it
  get animates() {
    const now = performance.now();
    for (let i = this.lines.length - 1; i >= 0 && i >= this.lines.length - 10; i--) { const age = now - this.lines[i].at; if (age >= 8950 && age < 10100) return true; }
    if (this.dirty) { this.dirty = false; return true; }
    return false;
  }
  // with chat open: the tooltip of the part of a line under the mouse, if it has one
  hoverAt(g, mx, my) {
    const f = g.font;
    // (the rows as draw lays them, 40 above the bottom: this once counted from 16, a row and a half below the lines)
    const p = this.partAt(g, mx, my, 'hover') || this.partAt(g, mx, my, 'click');
    if (!p) return null;
    const lines = p.lines || (p.tip ? [p.tip] : null);
    if (!lines) return null;
    // (wrapped as the game wraps hover text: half the screen, or 200 at least; each line keeps its colour)
    return lines.flatMap(s => { const c = /^§./.test(s) ? s.slice(0, 2) : ''; return f.wrap(s, Math.max(g.width / 2, 200)).map((q, j) => (j && c && !q.startsWith('§') ? c + q : q)); });
  }
  draw(g) {
    if (!this.lines.length || (g.hideHud && !this.open)) return;
    // under a menu that darkens and blurs the world (the game menu, the advancements) the chat is part of what it hides
    const s = g.screen;
    if (s && !this.open && g.inGame && g.backgroundKind && g.backgroundKind(s.background) === 'world') return;
    const f = g.font, now = performance.now();
    // 40 above the bottom, open or not (the game's lines stay put; the line you type covers the hotbar's foot)
    const bottom = g.height - 40;
    const max = this.open ? 20 : 10;
    const ctx = g.ctx;
    let y = bottom;
    // long lines wrap onto more than one row, as in the game
    const rows = [];
    for (let i = this.lines.length - 1; i >= 0 && rows.length < max; i--) {
      const l = this.lines[i];
      const age = (now - l.at) / 50;     // in ticks
      let a = 1;
      if (!this.open) { a = Math.max(0, Math.min(1, (1 - age / 200) * 10)); a *= a; }
      if (a <= 0.02) { if (!this.open) break; else continue; }
      const parts = this.wrapped(f, l.text);
      for (let k = parts.length - 1; k >= 0 && rows.length < max; k--) rows.push([parts[k], l.colour, a]);
    }
    for (const [t, c, a] of rows) {
      ctx.globalAlpha = a * 0.5;
      g.fill(0, y - LINE, WIDTH + 8, y, 0xFF000000);
      ctx.globalAlpha = a;
      g.text(t, 2, y - LINE + 1, c);
      y -= LINE;
    }
    ctx.globalAlpha = 1;
    // the hover of the part under the mouse, over the lines (ChatScreen finds it)
    if (this.open && this.tip) g.tooltip(this.tip.lines, this.tip.x, this.tip.y);
  }
}

/* The open chat: the line you are typing at the very bottom, the game still
   running behind it (no menu background).

   A command gets the game's suggestions (1.13+): a box over the line from
   the word being typed, the chosen one yellow and the rest grey, ten at a
   time, with a row of dots when more are above or below; what the chosen one
   would add shows in dark grey after the cursor. Tab puts the chosen one in
   (again: the next one, Shift+Tab the one before), Up and Down choose, the
   wheel scrolls, a click puts one in, Esc hides the box (a second Esc closes
   chat). A line from the history keeps the box shut, so Up goes on walking
   back. With nothing to suggest, the command's usage shows instead. */
export class ChatScreen extends Screen {
  constructor(chat, ctxOf, start = '') {
    super('Chat');
    this.chat = chat; this.ctxOf = ctxOf;
    this.background = 'none';
    this.value = start;
    this.cursor = start.length;
    this.histAt = chat.sent.length;
    this.sugg = null;        // { start, list, sel, top, orig, at }: at is where the cursor was in orig
    this.hidden = false;     // Esc or the history put the box away until the next edit
    this.cycling = false;    // Tab already put one in: the next Tab moves on
    this.keep = false;
    this.usage = '';
    this.animates = true;
  }
  init() {
    const g = this.gui, inp = g.input;
    this.chat.open = true;
    // the game's edit box, drawn here as the chat's line (the hidden input does the typing, selection and clipboard)
    const fl = this.field = new TextField(0, this.height - 12, this.width - 4, 10, { value: this.value, maxLength: 256 });
    fl.gui = g;
    fl.cursor = fl.selEnd = Math.min(this.cursor, this.value.length);
    // (a click anywhere keeps the line's focus, as the game's chat does)
    fl.isMouseOver = () => true;
    const sync = fl._syncFrom.bind(fl);
    fl._syncFrom = i => {
      const v0 = fl.value, c0 = fl.cursor;
      sync(i);
      this.value = fl.value; this.cursor = fl.cursor;
      if (fl.value !== v0 || fl.cursor !== c0) this.edited(fl.value !== v0);
    };
    g.textFocus = null;
    g.focusText(fl);
    inp.value = this.value;
    try { inp.setSelectionRange(fl.cursor, fl.cursor); } catch (e) { /* hidden */ }
    this.refresh();
  }
  // the line changed (or the cursor moved): suggestions for where it is now
  edited(typed) {
    if (this.keep) return;
    this.cycling = false;
    if (typed) this.hidden = false;
    this.refresh();
  }
  refresh() {
    this.sugg = null; this.usage = '';
    const v = this.value;
    if (!v.startsWith('/')) return;
    let ctx = null;
    try { ctx = this.ctxOf(); } catch (e) { ctx = null; }
    let r;
    try { r = suggestions(v, this.cursor, ctx); } catch (e) { console.error(e); return; }
    if (r.list.length && !this.hidden) this.sugg = { start: r.start, list: r.list, sel: 0, top: 0, orig: v, at: this.cursor };
    else if (!r.list.length && v.includes(' ')) {
      const name = v.slice(1).split(' ')[0], d = commandDef(name);
      if (d && d.usage) this.usage = '/' + name + ' ' + d.usage;
    }
    if (this.gui) this.gui.dirty = true;
  }
  // what the chosen suggestion would make of the line
  applied(i = this.sugg.sel) { const s = this.sugg; return s.orig.slice(0, s.start) + s.list[i] + s.orig.slice(s.at); }
  choose(d) {
    const s = this.sugg, n = s.list.length;
    s.sel = ((s.sel + d) % n + n) % n;
    if (s.sel < s.top) s.top = s.sel;
    if (s.sel >= s.top + ROWS) s.top = s.sel - ROWS + 1;
    this.gui.dirty = true;
  }
  // put the chosen one in; the box stays (Tab again moves on), unless it ends in a space (a whole position): then the next word's
  use() {
    const s = this.sugg, word = s.list[s.sel];
    this.keep = true;
    this.setValue(this.applied(), s.start + word.length);
    this.keep = false;
    this.cycling = true;
    if (word.endsWith(' ')) { this.cycling = false; this.refresh(); }
  }
  // a click on a suggestion puts it in; on a part of a line that runs a command (a teleport request's /tpaccept), chat closes and it runs
  mouseClicked(mx, my, button) {
    const row = this.rowAt(mx, my);
    if (row >= 0 && button === 0) { this.sugg.sel = row; this.use(); return this.field; }
    if (button === 0) {
      const run = this.chat.clickAt(this.gui, mx, my);
      if (run) { this.gui.back(); execute(run, this.ctxOf()); return true; }
    }
    // (the caret goes under a click on the line)
    if (my >= this.height - 14 && this.field.mouseClicked(mx, my, button)) return this.field;
    return null;
  }
  mouseScrolled(mx, my, d) {
    const s = this.sugg;
    if (!s || s.list.length <= ROWS) return false;
    s.top = Math.max(0, Math.min(s.list.length - ROWS, s.top - Math.sign(d)));
    this.gui.dirty = true;
    return true;
  }
  // the box: where it is (x, y of its top, width, rows shown)
  box() {
    const s = this.sugg;
    if (!s) return null;
    const f = this.gui.font, fl = this.field, inner = this.width - 12;
    const w = Math.max(...s.list.map(t => f.width(t))) + 1;
    const n = Math.min(ROWS, s.list.length);
    const at = 4 + (s.start >= fl.first ? f.width(fl.value.slice(fl.first, s.start)) : 0);
    const x = Math.max(1, Math.min(at, 4 + inner - w)) - 1;
    return { x, y: this.height - 15 - n * 12, w: w + 1, n };
  }
  // which suggestion the mouse is on (-1 for none)
  rowAt(mx, my) {
    const b = this.box();
    if (!b || mx < b.x || mx >= b.x + b.w || my < b.y || my >= b.y + b.n * 12) return -1;
    return this.sugg.top + Math.floor((my - b.y) / 12);
  }
  setValue(v, cursor = v.length) {
    v = v.slice(0, 256);
    this.value = v; this.cursor = Math.min(cursor, v.length);
    const fl = this.field;
    fl.value = v; fl.cursor = fl.selEnd = this.cursor; fl.focusTime = performance.now();
    const inp = this.gui.input; inp.value = v;
    try { inp.setSelectionRange(this.cursor, this.cursor); } catch (e) { /* hidden */ }
    if (!this.keep) { this.cycling = false; this.refresh(); }
    this.gui.dirty = true;
  }
  keyPressed(e) {
    const s = this.sugg;
    if (e.key === 'Escape') {
      if (s) { this.sugg = null; this.hidden = true; this.gui.dirty = true; return true; }
      this.gui.back(); return true;
    }
    if (e.key === 'Enter') {
      const v = this.value.trim();
      this.gui.back();
      if (v) this.send(v);
      return true;
    }
    if (e.key === 'Tab') {
      if (!this.sugg) { this.hidden = false; this.refresh(); }
      if (!this.sugg) return true;
      if (this.cycling) this.choose(e.shiftKey ? -1 : 1);
      this.use();
      return true;
    }
    if (s && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      this.choose(e.key === 'ArrowUp' ? -1 : 1);
      this.cycling = false;
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const h = this.chat.sent;
      this.histAt = Math.max(0, Math.min(h.length, this.histAt + (e.key === 'ArrowUp' ? -1 : 1)));
      this.hidden = true;
      this.setValue(this.histAt < h.length ? h[this.histAt] : '');
      return true;
    }
    return false;
  }
  send(v) {
    const chat = this.chat;
    if (chat.sent[chat.sent.length - 1] !== v) chat.sent.push(v);
    const ctx = this.ctxOf();
    if (v.startsWith('/')) execute(v, ctx);
    else if (ctx.sendChat) ctx.sendChat(v);
    else chat.add(`<${ctx.playerName}> ${v}`);
  }
  onClose() { this.chat.open = false; this.chat.tip = null; this.chat.dirty = true; this.gui._blurText && this.gui._blurText(); }
  render(g, mx, my, dt) {
    const W = this.width, H = this.height, f = g.font, fl = this.field, val = fl.value;
    g.fill(2, H - 14, W - 2, H - 2, 0x80000000);
    const tip = this.chat.hoverAt && this.chat.hoverAt(g, mx, my);
    this.chat.tip = tip ? { lines: tip, x: mx, y: my } : null;
    // the part of the line that fits, the cursor always in it
    const inner = W - 12, tx = 4, ty = H - 12;
    if (fl.cursor < fl.first) fl.first = fl.cursor;
    while (fl.first < fl.cursor && f.width(val.slice(fl.first, fl.cursor)) > inner) fl.first++;
    const shown = f.trim(val.slice(fl.first), inner);
    const end = g.text(shown, tx, ty, 0xFFFFFF);
    // what is selected (Shift with the arrows, Home or End, Ctrl+A), as the game's edit box shows it
    if (fl.selEnd !== fl.cursor) {
      const s0 = Math.max(fl.first, Math.min(fl.cursor, fl.selEnd)), s1 = Math.min(fl.first + shown.length, Math.max(fl.cursor, fl.selEnd));
      if (s1 > s0) {
        const a = tx + f.width(val.slice(fl.first, s0)), b = tx + f.width(val.slice(fl.first, s1));
        g.ctx.globalCompositeOperation = 'difference';
        g.fill(a, ty - 1, b, ty + 9, 0xFFFFFFFF);
        g.ctx.globalCompositeOperation = 'source-over';
      }
    }
    const s = this.sugg;
    // the rest of the chosen suggestion, after the cursor at the end of the line
    if (s && fl.cursor === val.length && fl.first + shown.length === val.length) {
      const a = this.applied();
      if (a.length > val.length && a.startsWith(val)) g.text(f.trim(a.slice(val.length), Math.max(0, W - 4 - end)), end, ty, 0x808080);
    }
    if ((((g.now - fl.focusTime) / 300) | 0) % 2 === 0) {
      const cx = tx + f.width(val.slice(fl.first, fl.cursor));
      if (fl.cursor < val.length) g.fill(cx, ty - 1, cx + 1, ty + 9, 0xFFD0D0D0);
      else g.text('_', cx, ty, 0xFFFFFF);
    }
    if (s) {
      const b = this.box();
      // (the mouse moving onto a row chooses it, as in the game)
      const over = this.rowAt(mx, my);
      if (over >= 0 && (mx !== this.lastMx || my !== this.lastMy)) s.sel = over;
      this.lastMx = mx; this.lastMy = my;
      g.fill(b.x, b.y, b.x + b.w, b.y + b.n * 12, 0xD0000000);
      if (s.top > 0) for (let k = 0; k < b.w; k += 2) g.fill(b.x + k, b.y - 1, b.x + k + 1, b.y, 0xFFFFFFFF);
      if (s.top + ROWS < s.list.length) for (let k = 0; k < b.w; k += 2) g.fill(b.x + k, b.y + b.n * 12, b.x + k + 1, b.y + b.n * 12 + 1, 0xFFFFFFFF);
      for (let r = 0; r < b.n; r++) {
        const i = s.top + r;
        g.text(s.list[i], b.x + 1, b.y + 2 + r * 12, i === s.sel ? 0xFFFF00 : 0xAAAAAA);
      }
    } else if (this.usage) {
      const t = f.trim(this.usage, W - 8), w = f.width(t) + 2;
      g.fill(3, H - 27, 3 + w, H - 15, 0xD0000000);
      g.text(t, 4, H - 25, 0xAAAAAA);
    }
  }
}
