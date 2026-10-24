/* ---------------------------------------------------------------------------
   Leoncraft 2 - books: writing in a book and quill, signing it, reading a
   written book (the game's BookEditScreen and BookViewScreen).

   A page is 114 of the font's pixels wide and 14 lines tall, its number at
   the top right ("Page 1 of 3"); the arrows under the text turn the pages,
   and the forward arrow on the last page of a book being written adds a new
   one (up to 100). Enter starts a new line. Sign asks for a title (up to 32
   letters) and turns the book into a written book "by" its author, which can
   no longer be changed. The page itself is drawn here (a cream sheet with a
   darker edge), not taken from the game's art.

   A book on a lectern opens the same way to read (the game's LecternScreen):
   it opens at the page the lectern is on, every page turned tells the
   lectern (its redstone pulse, what a comparator reads), and Take Book
   beside Done takes it off.
--------------------------------------------------------------------------- */
import { Screen, Button, TextField, Widget, WHITE } from './gui.js?v=107';

const PAGE_W = 114, LINES = 14, MAX_PAGES = 100, MAX_CHARS = 1024;
const BLACK = 0x000000;

// a page's text in lines no wider than the page, breaking at spaces where it can (and at each new line)
export function wrapPage(font, text) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    const words = para.split(/(\s+)/);
    for (const w of words) {
      if (!w) continue;
      if (font.width(line + w) <= PAGE_W) { line += w; continue; }
      if (line.trim()) { out.push(line); line = ''; }
      if (/^\s+$/.test(w)) continue;
      // a word longer than a line is cut where it reaches the edge
      let rest = w;
      while (font.width(rest) > PAGE_W) {
        let k = rest.length;
        while (k > 1 && font.width(rest.slice(0, k)) > PAGE_W) k--;
        out.push(rest.slice(0, k)); rest = rest.slice(k);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

// the arrows under the page
class PageArrow extends Widget {
  constructor(x, y, forward, onPress) { super(x, y, 23, 13, ''); this.forward = forward; this.onPress = onPress; }
  draw(g, mx, my) {
    const hot = this.isMouseOver(mx, my), c = hot ? 0xFF5A3C1E : 0xFF8B6B45;
    const { x, y } = this;
    // a fat arrow: a bar and a point, drawn a pixel row at a time
    for (let r = 0; r < 13; r++) {
      const half = 6 - Math.abs(r - 6);
      if (this.forward) { if (r >= 4 && r <= 8) g.fill(x + 2, y + r, x + 15, y + r + 1, c); g.fill(x + 14, y + r, x + 15 + half, y + r + 1, c); }
      else { if (r >= 4 && r <= 8) g.fill(x + 8, y + r, x + 21, y + r + 1, c); g.fill(x + 8 - half, y + r, x + 9, y + r + 1, c); }
    }
  }
  mouseClicked(mx, my) { if (!this.visible || !this.isMouseOver(mx, my)) return false; if (this.onPress) this.onPress(); return true; }
}

// the page being written: the gui's hidden text box drives it, Enter is a new line (kept in the box as a pilcrow,
// since a one-line box drops line breaks)
const ENC = v => v.replace(/\n/g, '¶'), DEC = v => v.replace(/¶/g, '\n');
class PageField extends TextField {
  _syncFrom(inp) {
    super._syncFrom({
      get value() { return DEC(inp.value); }, set value(v) { inp.value = ENC(v); },
      get selectionStart() { return inp.selectionStart; }, get selectionEnd() { return inp.selectionEnd; }, get selectionDirection() { return inp.selectionDirection; },
      setSelectionRange: (a, b) => inp.setSelectionRange(a, b),
    });
  }
  mouseClicked(mx, my, button) {
    const r = super.mouseClicked(mx, my, button);
    const inp = this.gui && this.gui.input;
    if (r && inp) { inp.value = ENC(this.value); try { inp.setSelectionRange(this.cursor, this.cursor); } catch (e) { /* hidden */ } }
    return r;
  }
  constructor(screen) { super(screen.left + 36, 32, PAGE_W, LINES * 9, { maxLength: MAX_CHARS }); this.screen = screen; this.visible = true; }
  draw(g) { this.gui = g; }
  keyPressed(e) {
    if (!this.focused) return false;
    if (e.key === 'Enter') {
      const v = this.value, c = this.cursor, next = v.slice(0, c) + '\n' + v.slice(c);
      if (this.screen.fits(next)) {
        this.value = next; this.cursor = this.selEnd = c + 1;
        const inp = this.screen.gui && this.screen.gui.input;
        if (inp) { inp.value = ENC(next); try { inp.setSelectionRange(c + 1, c + 1); } catch (er) { /* hidden */ } }
        this.screen.changed(next);
      }
      return true;
    }
    return false;
  }
}

export class BookScreen extends Screen {
  /* opts: { pages: [..], title, author, written (read only), done(pages) for a book being written,
     sign(title, pages) to sign it, player (the author's name); on a lectern also page (where it opens),
     onPage(page) as it turns and take() for the Take Book button } */
  constructor(opts) {
    super('');
    this.o = opts;
    this.background = 'world';
    this.animates = !opts.written;
    this.pages = (opts.pages && opts.pages.length ? opts.pages : ['']).slice(0, MAX_PAGES).map(String);
    this.page = Math.max(0, Math.min(this.pages.length - 1, opts.page | 0));
    this.signing = false;
    this.titleText = '';
    this.saved = false;
  }
  get left() { return Math.floor((this.width - 192) / 2); }
  fits(text) { return text.length <= MAX_CHARS && wrapPage(this.gui.font, text).length <= LINES; }
  changed(v) { this.pages[this.page] = v; }
  init() {
    const L = this.left, cx = this.width / 2;
    this.widgets.length = 0;
    if (this.signing) {
      this.titleField = this.add(new TextField(L + 36, 50, 114, 12, { value: this.titleText, maxLength: 32, onChange: v => { this.titleText = v; } }));
      this.titleField.draw = () => {};
      this.add(new Button(cx - 100, 196, 98, 20, 'Sign and Close', () => { if (this.titleText.trim()) this.finishSign(); }));
      this.add(new Button(cx + 2, 196, 98, 20, 'Cancel', () => { this.signing = false; this.init(); }));
      this.gui.focusText(this.titleField);
      return;
    }
    if (this.o.take) {
      this.add(new Button(cx - 100, 196, 98, 20, 'Done', () => this.gui.back()));
      this.add(new Button(cx + 2, 196, 98, 20, 'Take Book', () => { this.gui.back(); this.o.take(); }));
    } else if (this.o.written) this.add(new Button(cx - 100, 196, 200, 20, 'Done', () => this.gui.back()));
    else {
      this.add(new Button(cx - 100, 196, 98, 20, 'Sign', () => { this.signing = true; this.init(); }));
      this.add(new Button(cx + 2, 196, 98, 20, 'Done', () => this.gui.back()));
    }
    this.back = this.add(new PageArrow(L + 43, 159, false, () => this.turn(-1)));
    this.fwd = this.add(new PageArrow(L + 116, 159, true, () => this.turn(1)));
    if (!this.o.written) {
      this.field = this.add(new PageField(this));
      this.field.filter = v => this.fits(v);
      this.field.onChange = v => this.changed(v);
      this.showPage();
    }
  }
  showPage() {
    if (!this.field) return;
    this.field.setValue(this.pages[this.page] || '');
    this.gui.focusText(this.field);
    const inp = this.gui.input;
    if (inp) { inp.value = ENC(this.field.value); try { inp.setSelectionRange(this.field.cursor, this.field.cursor); } catch (e) { /* hidden */ } }
  }
  turn(d) {
    let p = this.page + d;
    if (p < 0) return;
    if (p >= this.pages.length) {
      if (this.o.written || this.pages.length >= MAX_PAGES) return;
      this.pages.push('');
    }
    this.page = p;
    if (this.o.onPage) this.o.onPage(p);
    this.showPage();
  }
  keyPressed(e) {
    if (!this.signing && (e.key === 'PageUp' || e.key === 'PageDown')) { this.turn(e.key === 'PageUp' ? -1 : 1); return true; }
    if (this.signing && e.key === 'Enter') { if (this.titleText.trim()) this.finishSign(); return true; }
    return super.keyPressed(e);
  }
  // the pages left empty at the end are dropped, as the game does
  trimmed() { const p = this.pages.slice(); while (p.length > 1 && !p[p.length - 1]) p.pop(); return p; }
  finishSign() {
    if (this.saved) return;
    this.saved = true;
    if (this.o.sign) this.o.sign(this.titleText.trim(), this.trimmed());
    this.gui.back();
  }
  onClose() { if (!this.saved && !this.o.written && this.o.done) { this.saved = true; this.o.done(this.trimmed()); } }
  render(g, mx, my, dt) {
    const L = this.left, f = g.font;
    // the page: cream, a darker edge, the binding down its left
    g.fill(L + 20, 2, L + 168, 184, 0xFF6B4A2A);
    g.fill(L + 21, 3, L + 167, 183, 0xFFF3E8CC);
    g.fill(L + 21, 3, L + 24, 183, 0xFFD9C9A3);
    if (this.signing) {
      g.centered('Enter Book Title:', L + 96, 34, BLACK, false);
      const t = this.titleText, on = (((g.now - (this.titleField ? this.titleField.focusTime : 0)) / 300 | 0) & 1) === 0;
      g.centered(t + (on ? '_' : ' '), L + 96, 50, BLACK, false);
      g.centered('by ' + (this.o.player || 'Player'), L + 96, 60, 0x444444, false);
      const note = wrapPage(f, 'Note! When you sign the book, it will no longer be editable.');
      note.forEach((l, i) => g.centered(l, L + 96, 82 + i * 9, BLACK, false));
      super.render(g, mx, my, dt);
      return;
    }
    const n = this.pages.length, label = `Page ${this.page + 1} of ${n}`;
    g.text(label, L + 148 - f.width(label), 16, BLACK, false);
    const text = this.pages[this.page] || '', lines = wrapPage(f, text);
    lines.slice(0, LINES).forEach((l, i) => g.text(l, L + 36, 32 + i * 9, BLACK, false));
    // the caret, at the end of what is written before it
    if (this.field && this.field.focused && (((g.now - this.field.focusTime) / 300 | 0) & 1) === 0) {
      const before = wrapPage(f, text.slice(0, this.field.cursor)), row = Math.max(0, before.length - 1);
      const cx = L + 36 + f.width(before[row] || '');
      if (this.field.cursor < text.length) g.fill(cx, 32 + row * 9 - 1, cx + 1, 32 + row * 9 + 9, 0xFF000000);
      else g.text('_', cx, 32 + row * 9, BLACK, false);
    }
    if (this.back) this.back.visible = this.page > 0;
    if (this.fwd) this.fwd.visible = this.o.written ? this.page < n - 1 : n < MAX_PAGES || this.page < n - 1;
    super.render(g, mx, my, dt);
  }
}
export { WHITE };
