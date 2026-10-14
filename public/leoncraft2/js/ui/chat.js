/* ---------------------------------------------------------------------------
   Leoncraft 2 - chat.

   The game's chat: lines in the bottom left over a half-dark band, each
   fading out ten seconds after it arrived (the last second a fade), the
   last ten shown while you play and the last twenty with chat open. T opens
   it, / opens it with a slash already typed; Enter sends, Esc closes, Up and
   Down walk back through what you sent, Tab finishes a command's name.
--------------------------------------------------------------------------- */
import { Screen } from './gui.js?v=57';
import { execute, complete } from '../commands.js?v=57';

const LINE = 9, KEEP = 100, WIDTH = 320;

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
      const m = p.match(/§[0-9a-fr]/gi);
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
   running behind it (no menu background). */
export class ChatScreen extends Screen {
  constructor(chat, ctxOf, start = '') {
    super('Chat');
    this.chat = chat; this.ctxOf = ctxOf;
    this.background = 'none';
    this.value = start;
    this.histAt = chat.sent.length;
    this.suggestions = [];
    this.animates = true;
  }
  init() {
    const g = this.gui, inp = g.input;
    this.chat.open = true;
    // the hidden input does the typing, as for the game's other text boxes
    this.field = { maxLength: 256, value: this.value, cursor: this.value.length, selEnd: this.value.length, focused: true, focusTime: performance.now(),
      _syncFrom: i => { this.value = i.value.slice(0, 256); this.field.value = this.value; this.field.cursor = i.selectionEnd ?? this.value.length; this.suggest(); g.dirty = true; },
      keyPressed: () => false, isMouseOver: () => true };
    g.textFocus = null;
    g.focusText(this.field);
    inp.value = this.value;
    try { inp.setSelectionRange(this.value.length, this.value.length); } catch (e) { /* hidden */ }
    this.suggest();
  }
  suggest() {
    let ctx = null;
    try { ctx = this.value.includes(' ') ? this.ctxOf() : null; } catch (e) { ctx = null; }
    this.suggestions = this.value.startsWith('/') ? complete(this.value, ctx).slice(0, 10) : [];
  }
  // a click on a part of a line that runs a command (a teleport request's /tpaccept): chat closes and it runs
  mouseClicked(mx, my, button) {
    if (button === 0) {
      const run = this.chat.clickAt(this.gui, mx, my);
      if (run) { this.gui.back(); execute(run, this.ctxOf()); return true; }
    }
    return super.mouseClicked(mx, my, button);
  }
  setValue(v) {
    this.value = v; this.field.value = v; this.field.cursor = v.length;
    const inp = this.gui.input; inp.value = v;
    try { inp.setSelectionRange(v.length, v.length); } catch (e) { /* hidden */ }
    this.suggest();
    this.gui.dirty = true;
  }
  keyPressed(e) {
    if (e.key === 'Escape') { this.gui.back(); return true; }
    if (e.key === 'Enter') {
      const v = this.value.trim();
      this.gui.back();
      if (v) this.send(v);
      return true;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const s = this.chat.sent;
      this.histAt = Math.max(0, Math.min(s.length, this.histAt + (e.key === 'ArrowUp' ? -1 : 1)));
      this.setValue(this.histAt < s.length ? s[this.histAt] : '');
      return true;
    }
    if (e.key === 'Tab') {
      if (this.suggestions.length) this.setValue(this.suggestions[0] + (this.suggestions.length === 1 ? ' ' : ''));
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
    const W = this.width, H = this.height, f = g.font;
    g.fill(2, H - 14, W - 2, H - 2, 0x80000000);
    const tip = this.chat.hoverAt && this.chat.hoverAt(g, mx, my);
    this.chat.tip = tip ? { lines: tip, x: mx, y: my } : null;
    const shown = f.trim(this.value, W - 12, true);
    const x = g.text(shown, 4, H - 12, 0xFFFFFF);
    if ((((g.now - this.field.focusTime) / 300) | 0) % 2 === 0) g.text('_', x, H - 12, 0xFFFFFF);
    // what Tab would finish, listed above the line
    if (this.suggestions.length > 1 || (this.suggestions.length === 1 && this.suggestions[0] !== this.value.trim())) {
      const w = Math.max(...this.suggestions.map(s => f.width(s))) + 4;
      let y = H - 16 - this.suggestions.length * 12;
      for (let i = 0; i < this.suggestions.length; i++, y += 12) {
        g.fill(2, y, 2 + w, y + 12, 0xD0000000);
        g.text(this.suggestions[i], 4, y + 2, i === 0 ? 0xFFFF55 : 0xAAAAAA);
      }
    }
  }
}
