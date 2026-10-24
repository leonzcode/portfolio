/* ---------------------------------------------------------------------------
   Leoncraft 2 - writing on a sign: the game's "Edit Sign Message" screen.

   The sign is drawn large in the middle of the screen with its four lines;
   typing goes into the line with the caret, Enter or the down arrow moves to
   the next line and the up arrow back, and a line takes only as much as fits
   on the board (90 of the font's pixels, 60 on a hanging sign). Done (or Escape) keeps the text.
--------------------------------------------------------------------------- */
import { Screen, Button, TextField, WHITE } from './gui.js?v=107';

let terrain = null;
function terrainImage(gui) {
  if (!terrain) {
    terrain = new Image();
    terrain.src = new URL('../terrain_albedo.png', gui.base).href + gui.version;
    terrain.onload = () => { gui.dirty = true; };
  }
  return terrain.complete && terrain.naturalWidth ? terrain : null;
}

const MAX_W = 90;

// one line of the sign: no box, the text centred and dark on the wood
class SignLine extends TextField {
  constructor(x, y, w, opts) { super(x, y, w, 10, Object.assign({ maxLength: 80 }, opts)); this.colour = opts.colour || 0; }
  draw(g) {
    this.gui = g;
    const f = g.font, v = this.value;
    const tx = Math.round(this.x + (this.w - f.width(v)) / 2), ty = this.y + 1;
    g.text(v, tx, ty, this.colour, false);
    const on = this.focused && (((g.now - this.focusTime) / 300 | 0) & 1) === 0;
    if (on) {
      const cx = tx + f.width(v.slice(0, this.cursor));
      if (this.cursor < v.length) g.fill(cx, ty - 1, cx + 1, ty + 9, 0xFF000000 | this.colour);
      else g.text('_', cx, ty, this.colour, false);
    }
  }
}

export class SignEditScreen extends Screen {
  /* opts: { lines: [4], colour (0xRRGGBB, the side's dark text colour), layer (the sign's texture layer),
     hanging, wall, done(lines) } */
  constructor(opts) {
    super('Edit Sign Message');
    this.o = opts;
    this.background = 'world';
    this.animates = true;
    this.lines = (opts.lines || ['', '', '', '']).slice(0, 4);
    while (this.lines.length < 4) this.lines.push('');
    this.row = 0;
    this.saved = false;
  }
  init() {
    const cx = this.width / 2, top = this.boardTop();
    const font = () => this.gui.font;
    this.fields = this.lines.map((v, i) => this.add(new SignLine(cx - 50, top + 26 + i * 10, 100, {
      value: v, colour: this.o.colour || 0,
      filter: s => font().width(s) <= (this.o.hanging ? 60 : MAX_W),
      onChange: s => { this.lines[i] = s; },
      onEnter: () => this.focus(Math.min(3, i + 1)),
    })));
    this.add(new Button(cx - 100, Math.min(this.height - 24, top + 120), 200, 20, 'Done', () => this.finish()));
    this.focus(this.row);
  }
  boardTop() { return Math.max(30, Math.floor(this.height / 2 - 70)); }
  focus(i) {
    this.row = i;
    const f = this.fields[i];
    if (!f || !this.gui) return;
    this.gui.focusText(f);
    f.cursor = f.selEnd = f.value.length;
    try { this.gui.input.setSelectionRange(f.cursor, f.cursor); } catch (e) { /* hidden */ }
  }
  keyPressed(e) {
    if (e.key === 'ArrowUp') { this.focus((this.row + 3) % 4); return true; }
    if (e.key === 'ArrowDown') { this.focus((this.row + 1) % 4); return true; }
    if (e.key === 'Enter') { this.focus((this.row + 1) % 4); return true; }
    if (e.key === 'Escape') { this.finish(); return true; }
    return super.keyPressed(e);
  }
  mouseClicked(mx, my, button) {
    const hit = super.mouseClicked(mx, my, button);
    const i = this.fields.indexOf(hit);
    if (i >= 0) this.row = i;
    return hit;
  }
  finish() {
    if (!this.saved) { this.saved = true; if (this.o.done) this.o.done(this.lines.slice()); }
    this.gui.back();
  }
  onClose() { if (!this.saved) { this.saved = true; if (this.o.done) this.o.done(this.lines.slice()); } }
  render(g, mx, my, dt) {
    this.drawTitle(g, Math.max(8, this.boardTop()));
    // the board, from the sign's own texture (its top half: the board, 16 by 8), drawn 6.25 times the size
    const cx = this.width / 2, top = this.boardTop(), W = 100, H = 50;
    const img = terrainImage(g), L = this.o.layer;
    const x0 = Math.round(cx - W / 2), y0 = top + 18;
    if (img && L !== undefined) {
      g.ctx.imageSmoothingEnabled = false;
      const sy = L * 16 + (this.o.wall ? 4 : 0);
      g.ctx.drawImage(img, 0, sy, 16, 8, x0, y0, W, H);
      // and the post under a standing sign
      if (!this.o.wall && !this.o.hanging) g.ctx.drawImage(img, 7, L * 16 + 8, 2, 8, Math.round(cx - 6), y0 + H, 12, 40);
    } else g.fill(x0, y0, x0 + W, y0 + H, 0xFF9C7A48);
    super.render(g, mx, my, dt);
  }
}
export { WHITE };
