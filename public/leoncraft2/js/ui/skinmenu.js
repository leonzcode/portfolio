/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Skins and Capes menus (the title's Skins button, and
   Skin Customization's Skins...).

     SkinsScreen        what you wear, front and back, and the ways to change it:
                        the Skin Gallery (skins.js), a file of your own, a
                        Minecraft player's skin and cape by name, the skin
                        editor, the capes, the arm width, back to default
     UsernameScreen     a Minecraft player's skin and cape by their name, fetched
                        live from Mojang's servers through the mc server
                        (mlhub /mc/lc2/mcskin)
     SkinEditorScreen   the 64 x 64 skin picture, magnified, to draw on
     CapeScreen         None, our own capes (capes.js), a file of your own
     CapeEditorScreen   the cape picture, magnified, to draw on

   They only set options (skin, skinModel, skinName, cape, capeName,
   skinParts.cape); the game puts what they hold on the player and tells the
   server. A skin is kept as a PNG data URL, a cape as a 64 x 32 one.
--------------------------------------------------------------------------- */
import { Screen, Button, CycleButton, TextField, WHITE, GREY } from './gui.js?v=107';
import { SkinGalleryScreen } from './skins.js?v=107';
import { httpBase } from '../net/account.js?v=107';
import { CAPES, capeDataUrl, paintCape } from '../capes.js?v=107';

const DEFAULT_SKIN = new URL('../../textures/skin/default.png?v=107', import.meta.url).href;
const RED = 0xFF5555, GREEN = 0x55FF55;

/* ------------------------------ pictures ------------------------------ */

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('bad picture')); im.src = url; });
}
// a canvas copied onto itself with a face turned over (left to right)
function flipCopy(x, sx, sy, dx, dy, w, h) {
  x.save(); x.translate(dx + w, dy); x.scale(-1, 1); x.drawImage(x.canvas, sx, sy, w, h, 0, 0, w, h); x.restore();
}

/* A skin picture as a 64 x 64 canvas, or null if it is not a skin's size.
   The old 64 x 32 layout is made whole as the game does: the left arm and
   leg from the right ones, every face turned over and the two sides
   swapped; and a hat that covers every pixel of its square counts as none. */
export function skinCanvas(img) {
  if (!img || img.width !== 64 || (img.height !== 64 && img.height !== 32)) return null;
  const c = canvas(64, 64), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  if (img.height === 32) {
    // [from x, from y, to x, to y, w, h] inside a limb's 16 x 16 square
    const faces = [[4, 0, 4, 0, 4, 4], [8, 0, 8, 0, 4, 4], [0, 4, 8, 4, 4, 12], [4, 4, 4, 4, 4, 12], [8, 4, 0, 4, 4, 12], [12, 4, 12, 4, 4, 12]];
    for (const [su, sv, du, dv] of [[0, 16, 16, 48], [40, 16, 32, 48]]) for (const [a, b, cx, cy, w, h] of faces) flipCopy(x, su + a, sv + b, du + cx, dv + cy, w, h);
    const hat = x.getImageData(32, 0, 32, 16).data;
    let solid = true;
    for (let i = 3; i < hat.length; i += 4) if (hat[i] < 128) { solid = false; break; }
    if (solid) x.clearRect(32, 0, 32, 16);
  }
  return c;
}

/* A cape picture as a 64 x 32 canvas, or null. Mojang's capes are 64 x 32
   (or a whole multiple of it); a picture of only the cape's own part is
   22 x 17 (or 44 x 34, 88 x 68...), and with the wings 46 x 22. Larger ones
   are brought down to one pixel a pixel. */
export function capeScale(w, h) {
  for (let k = 1; k <= 32; k++) if ((w === 64 * k && h === 32 * k) || (w === 22 * k && h === 17 * k) || (w === 46 * k && h === 22 * k)) return k;
  return 0;
}
export function capeCanvas(img) {
  const k = img ? capeScale(img.width, img.height) : 0;
  if (!k) return null;
  const c = canvas(64, 32), x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0, img.width, img.height, 0, 0, img.width / k, img.height / k);
  return c;
}

// pictures by URL, made into skin or cape canvases once; the GUI redraws when one lands
const PICS = new Map();
let GUI = null;
function picture(url, kind) {
  if (!url) return null;
  const key = kind + '|' + url;
  let p = PICS.get(key);
  if (!p) {
    p = { c: null };
    PICS.set(key, p);
    if (PICS.size > 40) PICS.delete(PICS.keys().next().value);
    loadImage(url).then(im => { p.c = kind === 'cape' ? capeCanvas(im) : skinCanvas(im); if (GUI) GUI.markDirty(); }, () => {});
  }
  return p.c;
}
const skinUrlOf = o => { const s = o.get('skin'); return !s || s === 'default' ? DEFAULT_SKIN : s; };

/* The figure seen from the front or the back, drawn flat from the skin's own
   faces, 16 x 32 pixels times s: the head, the body, the arms (3 wide on
   the slim model) and the legs, with the outer layer over them where
   parts says so, and from the back the cape over it all. */
function drawFigure(ctx, skin, x, y, s, { back = false, slim = false, parts = null, cape = null } = {}) {
  if (!skin) return;
  const aw = slim ? 3 : 4, on = k => !parts || parts[k] !== false;
  const P = (sx, sy, w, h, dx, dy) => ctx.drawImage(skin, sx, sy, w, h, x + dx * s, y + dy * s, w * s, h * s);
  if (!back) {
    P(8, 8, 8, 8, 4, 0); P(20, 20, 8, 12, 4, 8); P(44, 20, aw, 12, 4 - aw, 8); P(36, 52, aw, 12, 12, 8); P(4, 20, 4, 12, 4, 20); P(20, 52, 4, 12, 8, 20);
    if (on('hat')) P(40, 8, 8, 8, 4, 0);
    if (on('jacket')) P(20, 36, 8, 12, 4, 8);
    if (on('rightSleeve')) P(44, 36, aw, 12, 4 - aw, 8);
    if (on('leftSleeve')) P(52, 52, aw, 12, 12, 8);
    if (on('rightPants')) P(4, 36, 4, 12, 4, 20);
    if (on('leftPants')) P(4, 52, 4, 12, 8, 20);
  } else {
    P(24, 8, 8, 8, 4, 0); P(32, 20, 8, 12, 4, 8); P(40 + aw, 52, aw, 12, 4 - aw, 8); P(48 + aw, 20, aw, 12, 12, 8); P(28, 52, 4, 12, 4, 20); P(12, 20, 4, 12, 8, 20);
    if (on('hat')) P(56, 8, 8, 8, 4, 0);
    if (on('jacket')) P(32, 36, 8, 12, 4, 8);
    if (on('leftSleeve')) P(56 + aw, 52, aw, 12, 4 - aw, 8);
    if (on('rightSleeve')) P(48 + aw, 36, aw, 12, 12, 8);
    if (on('leftPants')) P(12, 52, 4, 12, 4, 20);
    if (on('rightPants')) P(12, 36, 4, 12, 8, 20);
    if (cape && on('cape')) ctx.drawImage(cape, 1, 1, 10, 16, x + 3 * s, y + 8 * s, 10 * s, 16 * s);
  }
}
// the cape's outside alone, 10 x 16 times s
function drawCape(ctx, cape, x, y, s, inside) { if (cape) ctx.drawImage(cape, inside ? 12 : 1, 1, 10, 16, x, y, 10 * s, 16 * s); }

// a PNG from the player's computer: { url, img }
function pickPicture() {
  return new Promise((res, rej) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => loadImage(r.result).then(img => res({ url: r.result, img }), () => rej(new Error('That file could not be read as a PNG picture.')));
      r.onerror = () => rej(new Error('That file could not be read.'));
      r.readAsDataURL(f);
    };
    inp.click();
  });
}
// what wearing a picture as a skin or a cape says, or '' when it is fine
function skinProblem(img) { return img.width === 64 && (img.height === 64 || img.height === 32) ? '' : 'A skin has to be a 64 x 64 (or 64 x 32) PNG. That one is ' + img.width + ' x ' + img.height + '.'; }
function capeProblem(img) { return capeScale(img.width, img.height) ? '' : 'A cape has to be a 64 x 32 PNG (or 22 x 17). That one is ' + img.width + ' x ' + img.height + '.'; }

const skinLabel = o => o.get('skin') === 'default' || !o.get('skin') ? 'Default' : o.get('skinName') || 'Your own';
const capeLabel = o => !o.get('cape') ? 'None' : o.get('capeName') || 'Your own';

// a box to put a preview in
const panel = (g, x, y, w, h) => g.fill(x, y, x + w, y + h, 0x60000000);

/* ------------------------------ Skins ------------------------------ */

export class SkinsScreen extends Screen {
  constructor() { super('Skins'); this.msg = ''; this.msgColour = RED; }
  init() {
    const W = this.width, H = this.height, g = this.gui, o = this.options;
    GUI = g;
    const bw = 150, n = 7;
    this.pw = 120; this.ph = n * 22 - 2;
    this.px = Math.floor((W - (this.pw + 10 + bw)) / 2);
    this.py = Math.max(26, Math.floor((H - 34 - this.ph) / 2) + 4);
    const bx = this.px + this.pw + 10;
    let y = this.py;
    const add = (label, fn, tip) => { const b = this.add(new Button(bx, y, bw, 20, label, fn, tip)); y += 22; return b; };
    add('Skin Gallery...', () => g.open(new SkinGalleryScreen()), 'Skins other players drew and shared, to wear');
    add('Upload Skin...', () => this.upload(), 'A 64 x 64 (or old 64 x 32) PNG skin from your computer');
    add('Minecraft Username...', () => g.open(new UsernameScreen()), 'Wear the skin and cape of a Minecraft player');
    add('Edit Skin...', () => g.open(new SkinEditorScreen()), 'Draw on your skin, pixel by pixel');
    add('Capes...', () => g.open(new CapeScreen()), 'Pick one of our capes, or upload or draw your own');
    this.add(new CycleButton(bx, y, bw, 20, 'Model', { values: ['classic', 'slim'], value: o.get('skinModel') === 'slim' ? 'slim' : 'classic', format: v => v === 'slim' ? 'Slim' : 'Classic', onChange: v => o.set('skinModel', v), tooltip: () => 'Classic arms are 4 pixels wide, slim arms 3.' }));
    y += 22;
    const reset = add('Reset to Default', () => { o.set('skin', 'default'); o.set('skinModel', 'classic'); o.set('skinName', ''); this.msg = ''; g._initScreen(this); }, 'Back to the default skin (your cape stays)');
    reset.active = o.get('skin') !== 'default' || o.get('skinModel') !== 'classic';
    this.add(new Button(W / 2 - 100, H - 27, 200, 20, 'Done', () => g.back()));
  }
  // a skin file from your computer (also for tests: useFile(dataUrl))
  upload() { pickPicture().then(({ url, img }) => this.useFile(url, img), e => this.say(e.message)); }
  async useFile(url, img) {
    try { img = img || await loadImage(url); } catch (e) { this.say('That file could not be read as a PNG picture.'); return; }
    const bad = skinProblem(img);
    if (bad) { this.say(bad); return; }
    const o = this.options;
    o.set('skin', url); o.set('skinName', '');
    this.say('Wearing your own skin.', GREEN);
    if (this.gui.screen === this) this.gui._initScreen(this);
  }
  say(text, colour = RED) { this.msg = text; this.msgColour = colour; this.gui.markDirty(); }
  render(g, mx, my, dt) {
    GUI = g;
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 10, WHITE);
    const o = this.options, c = g.ctx, { px, py, pw, ph } = this;
    panel(g, px, py, pw, ph);
    const skin = picture(skinUrlOf(o), 'skin'), cape = picture(o.get('cape'), 'cape');
    const slim = o.get('skinModel') === 'slim', parts = o.get('skinParts');
    const fx = px + Math.floor(pw / 2) - 52, fy = py + 6;
    drawFigure(c, skin, fx, fy, 3, { slim, parts });
    drawFigure(c, skin, fx + 56, fy, 3, { back: true, slim, parts, cape });
    g.centered('Front', fx + 24, fy + 99, GREY);
    g.centered('Back', fx + 80, fy + 99, GREY);
    const cap = !o.get('cape') ? 'None' : capeLabel(o) + (parts && parts.cape === false ? ' (hidden)' : '');
    g.text(g.font.trim('Skin: ' + skinLabel(o), pw - 8), px + 4, py + ph - 22, WHITE);
    g.text(g.font.trim('Cape: ' + cap, pw - 8), px + 4, py + ph - 11, WHITE);
    if (this.msg) {
      const lines = g.font.wrap(this.msg, this.width - 20).slice(0, 2);
      lines.forEach((l, i) => g.centered(l, this.width / 2, this.height - 30 - (lines.length - i) * 10, this.msgColour));
    }
  }
}

/* ------------------------------ by username ------------------------------ */

export class UsernameScreen extends Screen {
  constructor() { super('Minecraft Username'); this.res = null; this.err = ''; this.note = ''; this.busy = false; this.seq = 0; this.name = ''; }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    GUI = g;
    this.field = this.add(new TextField(W / 2 - 99, 27, 136, 18, {
      value: this.name, maxLength: 16, hint: 'Username', filter: v => /^[A-Za-z0-9_]*$/.test(v),
      onChange: v => { this.name = v; }, onEnter: () => this.search(),
    }));
    this.add(new Button(W / 2 + 42, 26, 58, 20, 'Search', () => this.search()));
    this.py = 52; this.ph = Math.max(80, H - 52 - 66);
    this.wearSkin = this.add(new Button(W / 2 - 100, H - 51, 98, 20, 'Wear Skin', () => this.wear('skin')));
    this.wearCape = this.add(new Button(W / 2 + 2, H - 51, 98, 20, 'Wear Cape', () => this.wear('cape')));
    this.add(new Button(W / 2 - 100, H - 27, 200, 20, 'Back', () => g.back()));
    if (!this.res) g.focusText(this.field);
  }
  async search() {
    const name = this.name.trim();
    if (!name) { this.err = 'Type a Minecraft username first.'; this.res = null; this.gui.markDirty(); return; }
    const seq = ++this.seq;
    this.busy = true; this.err = ''; this.note = ''; this.res = null; this.gui.markDirty();
    let j = null;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctl && ctl.abort(), 15000);
    try {
      const r = await fetch(httpBase() + '/lc2/mcskin?name=' + encodeURIComponent(name), { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      j = await r.json().catch(() => null);
      if (!j) j = { ok: false, error: r.ok ? 'The skin server sent back something odd.' : 'The skin server is not answering right now.' };
    } catch (e) { j = { ok: false, error: "Can't reach the skin server. Try again later." }; }
    clearTimeout(timer);
    if (seq !== this.seq) return;
    this.busy = false;
    if (j && j.ok && j.skin) this.res = j;
    else this.err = String((j && j.error) || 'No Minecraft player has that name.');
    if (this.gui) this.gui.markDirty();
  }
  wear(what) {
    const o = this.options, r = this.res;
    if (!r) return;
    if (what === 'skin') {
      o.set('skin', r.skin); o.set('skinModel', r.slim ? 'slim' : 'classic'); o.set('skinName', r.name);
      this.note = 'Wearing ' + r.name + "'s skin.";
    } else if (r.cape) {
      o.set('cape', r.cape); o.set('capeName', r.name + "'s cape"); o.setPart('cape', true);
      this.note = 'Wearing ' + r.name + "'s cape.";
    }
    this.gui.markDirty();
  }
  render(g, mx, my, dt) {
    GUI = g;
    this.wearSkin.active = !!this.res;
    this.wearCape.active = !!(this.res && this.res.cape);
    this.wearCape.tooltip = this.res && !this.res.cape ? 'This player has no cape' : null;
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 10, WHITE);
    const W = this.width, c = g.ctx, px = Math.floor(W / 2) - 100, { py, ph } = this;
    panel(g, px, py, 200, ph);
    const cy = py + Math.floor(ph / 2);
    if (this.busy) g.centered('Searching...', W / 2, cy - 4, GREY);
    else if (this.err) g.font.wrap(this.err, 188).slice(0, 3).forEach((l, i) => g.centered(l, W / 2, cy - 8 + i * 10, RED));
    else if (!this.res) g.font.wrap('Type a Minecraft player\'s name to wear their skin and cape.', 180).forEach((l, i) => g.centered(l, W / 2, cy - 8 + i * 10, GREY));
    else {
      const r = this.res, s = Math.max(2, Math.min(4, Math.floor((ph - 18) / 32)));
      const skin = picture(r.skin, 'skin'), cape = r.cape ? picture(r.cape, 'cape') : null;
      const w = 32 * s + 8 + (cape ? 10 * s + 8 : 0);
      let x = Math.floor(W / 2 - w / 2);
      const y = py + 4;
      drawFigure(c, skin, x, y, s, { slim: !!r.slim });
      drawFigure(c, skin, x + 16 * s + 8, y, s, { back: true, slim: !!r.slim, cape });
      if (cape) drawCape(c, cape, x + 32 * s + 16, y + 8 * s, s);
      g.centered(r.name + (cape ? '' : ' (no cape)'), W / 2, py + ph - 11, WHITE);
    }
    if (this.note) g.centered(this.note, W / 2, py + ph + 3, GREEN);
    else g.centered("Skins and capes come from Mojang's servers.", W / 2, py + ph + 3, 0x808080);
  }
}

/* ------------------------------ capes ------------------------------ */

export class CapeScreen extends Screen {
  constructor() { super('Capes'); this.hover = -1; this.scroll = 0; this.msg = ''; this.msgColour = RED; }
  entries() {
    const o = this.options, list = [{ kind: 'none', name: 'None' }];
    // a cape that is not one of ours (a player's, or your own) keeps its place in the list
    if (o.get('cape') && !CAPES.some(c => c.name === o.get('capeName'))) list.push({ kind: 'mine', name: o.get('capeName') || 'Your own' });
    for (const c of CAPES) list.push({ kind: 'ours', name: c.name, id: c.id });
    return list;
  }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    GUI = g;
    this.add(new Button(W / 2 - 151, H - 27, 98, 20, 'Upload Cape...', () => this.upload(), 'A 64 x 32 PNG cape from your computer'));
    this.add(new Button(W / 2 - 49, H - 27, 98, 20, 'Edit Cape...', () => g.open(new CapeEditorScreen()), 'Draw on the cape you wear, or a plain one'));
    this.add(new Button(W / 2 + 53, H - 27, 98, 20, 'Done', () => g.back()));
    this.layout();
  }
  layout() {
    const W = this.width, H = this.height;
    this.list = this.entries();
    this.pw = 96; this.cw = 26; this.ch = 38;
    this.cols = Math.max(3, Math.min(9, Math.floor((W - 16 - this.pw - 10) / this.cw)));
    this.x0 = Math.floor((W - (this.pw + 10 + this.cols * this.cw)) / 2);
    this.gx = this.x0 + this.pw + 10; this.gy = 28; this.gh = H - 34 - this.gy - (this.msg ? 10 : 0);
    this.maxScroll = Math.max(0, Math.ceil(this.list.length / this.cols) * this.ch - this.gh);
    this.scroll = Math.min(this.scroll, this.maxScroll);
  }
  cellAt(mx, my) {
    if (mx < this.gx || my < this.gy || my >= this.gy + this.gh) return -1;
    const c = Math.floor((mx - this.gx) / this.cw), r = Math.floor((my - this.gy + this.scroll) / this.ch);
    if (c >= this.cols) return -1;
    const i = r * this.cols + c;
    return i < this.list.length ? i : -1;
  }
  isWorn(e) {
    const o = this.options;
    if (e.kind === 'none') return !o.get('cape');
    if (e.kind === 'mine') return true;
    return !!o.get('cape') && o.get('capeName') === e.name;
  }
  capeOf(e) { return e.kind === 'none' ? null : e.kind === 'mine' ? picture(this.options.get('cape'), 'cape') : picture(capeDataUrl(e.id), 'cape'); }
  choose(e) {
    const o = this.options;
    if (e.kind === 'none') { o.set('cape', ''); o.set('capeName', ''); }
    else if (e.kind === 'ours') { o.set('cape', capeDataUrl(e.id)); o.set('capeName', e.name); o.setPart('cape', true); }
    this.msg = '';
    this.layout();
    this.gui.markDirty();
  }
  upload() { pickPicture().then(({ url, img }) => this.useFile(url, img), e => this.say(e.message)); }
  async useFile(url, img) {
    try { img = img || await loadImage(url); } catch (e) { this.say('That file could not be read as a PNG picture.'); return; }
    const bad = capeProblem(img);
    if (bad) { this.say(bad); return; }
    const o = this.options;
    o.set('cape', capeCanvas(img).toDataURL('image/png')); o.set('capeName', ''); o.setPart('cape', true);
    this.say('Wearing your own cape.', GREEN);
  }
  say(text, colour = RED) { this.msg = text; this.msgColour = colour; this.layout(); this.gui.markDirty(); }
  mouseClicked(mx, my, button) {
    const hit = super.mouseClicked(mx, my, button);
    if (hit) return hit;
    const i = this.cellAt(mx, my);
    if (i < 0 || button !== 0) return null;
    this.choose(this.list[i]);
    return true;
  }
  mouseScrolled(mx, my, d) {
    if (super.mouseScrolled(mx, my, d)) return true;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + (d > 0 ? -1 : 1) * this.ch));
    this.gui.markDirty();
    return true;
  }
  render(g, mx, my, dt) {
    GUI = g;
    this.layout();
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 10, WHITE);
    const o = this.options, c = g.ctx;
    this.hover = this.cellAt(mx, my);
    // the grid: each cape's outside, twice the size
    g.scissor(this.gx - 2, this.gy, this.gx + this.cols * this.cw, this.gy + this.gh);
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i], x = this.gx + (i % this.cols) * this.cw, y = this.gy + Math.floor(i / this.cols) * this.ch - this.scroll;
      if (y + this.ch < this.gy || y > this.gy + this.gh) continue;
      const on = this.isWorn(e), hov = i === this.hover;
      g.fill(x, y, x + this.cw - 2, y + this.ch - 2, on ? 0x80FFFFFF : hov ? 0x40FFFFFF : 0x30000000);
      const cx = x + 2, cy = y + 2;
      if (e.kind === 'none') {
        g.fill(cx, cy, cx + 20, cy + 32, 0x60000000);
        for (let k = 0; k < 14; k++) { g.fill(cx + 3 + k, cy + 9 + k, cx + 4 + k, cy + 10 + k, 0xFFC03030); g.fill(cx + 16 - k, cy + 9 + k, cx + 17 - k, cy + 10 + k, 0xFFC03030); }
      } else {
        const cape = this.capeOf(e);
        if (cape) drawCape(c, cape, cx, cy, 2);
      }
    }
    g.endScissor();
    if (this.maxScroll > 0) {
      const sx = this.gx + this.cols * this.cw, th = Math.max(16, Math.floor(this.gh * this.gh / (this.gh + this.maxScroll)));
      const ty = this.gy + Math.floor(this.scroll / this.maxScroll * (this.gh - th));
      g.fill(sx, this.gy, sx + 4, this.gy + this.gh, 0xFF000000); g.fill(sx, ty, sx + 4, ty + th, 0xFFC0C0C0);
    }
    // the preview: you from behind in the cape under the pointer, or the one you wear
    const px = this.x0, py = this.gy, pw = this.pw;
    const ph = Math.min(this.gh, 130);
    panel(g, px, py, pw, ph);
    const e = this.hover >= 0 ? this.list[this.hover] : this.list.find(x => this.isWorn(x));
    const skin = picture(skinUrlOf(o), 'skin');
    drawFigure(c, skin, px + pw / 2 - 24, py + 6, 3, { back: true, slim: o.get('skinModel') === 'slim', parts: Object.assign({}, o.get('skinParts'), { cape: true }), cape: e ? this.capeOf(e) : null });
    if (e) g.centered(g.font.trim(e.name, pw - 4), px + pw / 2, py + 106, WHITE);
    if (e && this.isWorn(e)) g.centered('Worn', px + pw / 2, py + 117, GREY);
    else if (e && this.hover >= 0) g.centered('Click to wear', px + pw / 2, py + 117, GREY);
    if (o.get('cape') && o.get('skinParts').cape === false) g.centered('Capes are hidden in Skin Customization.', this.width / 2, this.height - 40, GREY);
    else if (this.msg) g.centered(g.font.trim(this.msg, this.width - 8), this.width / 2, this.height - 40, this.msgColour);
  }
}

/* ------------------------------ the editors ------------------------------ */

function toHsv(c) {
  const r = (c >> 16 & 255) / 255, gr = (c >> 8 & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((gr - b) / d + 6) % 6 : mx === gr ? (b - r) / d + 2 : (r - gr) / d + 4;
  return [h / 6, mx ? d / mx : 0, mx];
}
function fromHsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}
const hex = c => '#' + c.toString(16).toUpperCase().padStart(6, '0');
const SWATCHES = [0xFFFFFF, 0xC6C6C6, 0x7F7F7F, 0x3F3F3F, 0x141414, 0x7A4A2A, 0xEBB48C, 0xB4785A,
  0xD93A3A, 0xF08A24, 0xF5D33C, 0x7FCC33, 0x2E8B3A, 0x3CC8D8, 0x3A5FD9, 0x8A3AD9];
const TOOLS = [['pencil', 'Pencil', 'Draw pixels (P)'], ['eraser', 'Eraser', 'Make pixels see-through (E)'],
  ['fill', 'Fill', 'Fill the touching pixels of one colour on that face (F)'], ['pick', 'Pick', 'Take a colour from the picture (I, or right click)']];

// a box's six faces on the picture, as the game lays them out: [name, x, y, w, h]
function boxFaces(u, v, w, h, d) {
  return [['top', u + d, v, w, d], ['bottom', u + d + w, v, w, d], ['right side', u, v + d, d, h],
    ['front', u + d, v + d, w, h], ['left side', u + d + w, v + d, d, h], ['back', u + 2 * d + w, v + d, w, h]];
}

/* What both editors share: a picture (tw x th) shown magnified (only the
   view part of it), parts outlined and named, the tools, the colour, undo,
   a live preview, Save and Cancel. A subclass gives regions() (each { name,
   short, layer 1 or 2, rect: [x, y, w, h], faces }), clearable(layer),
   preview(g, x, y, w, h), rowButtons() and save(). */
class PixelEditor extends Screen {
  constructor(title, tw, th, view, maxS) {
    super(title);
    this.tw = tw; this.th = th; this.view = view; this.maxS = maxS;
    this.tex = canvas(tw, th); this.tc = this.tex.getContext('2d', { willReadFrequently: true });
    this.img = this.tc.getImageData(0, 0, tw, th);
    this.tool = 'pencil'; this.colour = 0x3A5FD9; this.hsv = toHsv(this.colour);
    this.undos = []; this.drag = null; this.changed = false; this.ready = false;
    this.note = ''; this.noteUntil = 0;
  }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    GUI = g;
    const [, , vw, vh] = this.view;
    this.ps = H >= 330 && W >= 560 ? 3 : 2;
    const rw = this.rw = this.ps === 3 ? 200 : 176;
    const avW = W - rw - 16, avH = H - 18 - 72;
    this.s = Math.max(1, Math.min(this.maxS, Math.floor(Math.min(avW / vw, avH / vh))));
    const tW = vw * this.s;
    this.x0 = Math.max(4, Math.floor((W - (tW + 8 + rw)) / 2)); this.y0 = 18;
    this.rx = this.x0 + tW + 8;
    const ph = 32 * this.ps, pvw = 36 * this.ps;
    this.pv = [this.rx, this.y0, pvw, ph];
    this.hue = [this.rx + rw - 8, this.y0, 8, ph];
    this.sv = [this.rx + pvw + 6, this.y0, rw - pvw - 6 - 12, ph];
    const ty = this.y0 + ph + 6, bw = Math.floor((rw - 6) / 4);
    this.tools = TOOLS.map(([id, label, tip], i) => { const b = this.add(new Button(this.rx + i * (bw + 2), ty, bw, 20, label, () => { this.tool = id; }, tip)); b.tool = id; return b; });
    this.sw0 = ty + 26;
    // the editor's own buttons in a row, then Save and Cancel
    const row = this.rowButtons();
    const n = row.length, rbw = Math.min(98, Math.floor((Math.min(W - 8, 404) - (n - 1) * 4) / n));
    let x = Math.floor(W / 2 - (n * rbw + (n - 1) * 4) / 2);
    for (const [label, fn, tip] of row) { const b = this.add(new Button(x, H - 50, rbw, 20, label, fn, tip)); x += rbw + 4; if (label === 'Undo') this.undoB = b; }
    this.add(new Button(W / 2 - 100, H - 26, 98, 20, 'Save', () => this.save()));
    this.add(new Button(W / 2 + 2, H - 26, 98, 20, 'Cancel', () => g.back()));
    if (!this.masks) this.rebuild();
  }
  rowButtons() { return [['Undo', () => this.undo(), 'Ctrl+Z']]; }
  clearable() { return true; }
  // the picture's parts, which pixel belongs to which, the checks under see-through pixels, the dimmed unused parts
  rebuild() {
    const { tw, th } = this;
    this.parts = this.regions();
    this.used = new Uint8Array(tw * th);
    for (const r of this.parts) for (const f of r.faces) for (let y = f[2]; y < f[2] + f[4]; y++) for (let x = f[1]; x < f[1] + f[3]; x++) this.used[y * tw + x] = r.layer;
    const bg = this.masks = canvas(tw, th), dim = this.dim = canvas(tw, th);
    const b = bg.getContext('2d'), d = dim.getContext('2d');
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const u = this.used[y * tw + x];
      b.fillStyle = !u ? '#1c1c1c' : (x + y) & 1 ? '#9c9c9c' : '#7c7c7c';
      b.fillRect(x, y, 1, 1);
      if (!u) { d.fillStyle = 'rgba(0,0,0,0.72)'; d.fillRect(x, y, 1, 1); }
    }
  }
  // put a picture (canvas or image) in as the one being drawn
  setPicture(src) {
    this.tc.clearRect(0, 0, this.tw, this.th);
    if (src) this.tc.drawImage(src, 0, 0);
    this.img = this.tc.getImageData(0, 0, this.tw, this.th);
    this.fixPicture();
    this.commit();
    this.ready = true;
  }
  fixPicture() {}
  commit() { this.tc.putImageData(this.img, 0, 0); if (this.gui) this.gui.markDirty(); }
  snapshot() { this.undos.push(new Uint8ClampedArray(this.img.data)); if (this.undos.length > 60) this.undos.shift(); }
  undo() {
    const s = this.undos.pop();
    if (!s) return false;
    this.img.data.set(s); this.changed = true; this.commit();
    return true;
  }
  say(text) { this.note = text; this.noteUntil = performance.now() + 2500; this.gui.markDirty(); }
  get(x, y) { const i = (y * this.tw + x) * 4, d = this.img.data; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; }
  set(x, y, r, g, b, a) {
    const i = (y * this.tw + x) * 4, d = this.img.data;
    if (d[i] === r && d[i + 1] === g && d[i + 2] === b && d[i + 3] === a) return;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a; this.stroked = true;
  }
  layerAt(x, y) { return x >= 0 && y >= 0 && x < this.tw && y < this.th ? this.used[y * this.tw + x] : 0; }
  // the part and face under a pixel
  faceAt(x, y) {
    for (const r of this.parts) for (const f of r.faces) if (x >= f[1] && y >= f[2] && x < f[1] + f[3] && y < f[2] + f[4]) return { part: r, face: f };
    return null;
  }
  pixelAt(mx, my) {
    const [vx, vy, vw, vh] = this.view, s = this.s;
    const x = Math.floor((mx - this.x0) / s), y = Math.floor((my - this.y0) / s);
    return x >= 0 && y >= 0 && x < vw && y < vh ? [vx + x, vy + y] : null;
  }
  inBox(r, mx, my) { return mx >= r[0] && my >= r[1] && mx < r[0] + r[2] && my < r[1] + r[3]; }
  swatch(i) { return [this.rx + 24 + (i % 8) * 11, this.sw0 + Math.floor(i / 8) * 11, 10, 10]; }
  setColour(c) { this.colour = c; this.hsv = toHsv(c); this.gui.markDirty(); }
  pickSv(mx, my) {
    const r = this.sv, s = Math.max(0, Math.min(1, (mx - r[0]) / (r[2] - 1))), v = Math.max(0, Math.min(1, 1 - (my - r[1]) / (r[3] - 1)));
    this.hsv = [this.hsv[0], s, v]; this.colour = fromHsv(this.hsv[0], s, v); this.gui.markDirty();
  }
  pickHue(my) {
    const r = this.hue, h = Math.max(0, Math.min(0.999, (my - r[1]) / r[3]));
    this.hsv = [h, this.hsv[1] || 1, this.hsv[2] || 1]; this.colour = fromHsv(h, this.hsv[1], this.hsv[2]); this.gui.markDirty();
  }
  // the tool on one pixel
  dot(x, y) {
    const L = this.layerAt(x, y);
    if (!L) return;
    if (this.tool === 'eraser') {
      if (!this.clearable(L)) { this.say("The first layer can't be see-through. Paint over it."); return; }
      this.set(x, y, 0, 0, 0, 0);
    } else { const c = this.colour; this.set(x, y, c >> 16 & 255, c >> 8 & 255, c & 255, 255); }
  }
  line(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (let n = 0; n < 256; n++) {
      this.dot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  // the touching pixels of one colour, inside the face clicked on
  fill(x, y) {
    const at = this.faceAt(x, y);
    if (!at) return;
    const [, fx, fy, fw, fh] = at.face, want = this.get(x, y).join(','), c = this.colour;
    const col = [c >> 16 & 255, c >> 8 & 255, c & 255, 255];
    if (want === col.join(',')) return;
    const seen = new Set(), todo = [[x, y]];
    while (todo.length) {
      const [a, b] = todo.pop(), k = a + ',' + b;
      if (seen.has(k) || a < fx || b < fy || a >= fx + fw || b >= fy + fh) continue;
      seen.add(k);
      if (this.get(a, b).join(',') !== want) continue;
      this.set(a, b, col[0], col[1], col[2], 255);
      todo.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
    }
  }
  pick(x, y) {
    const [r, g, b, a] = this.get(x, y);
    if (!this.layerAt(x, y)) return;
    if (!a) { this.say('That pixel is see-through.'); return; }
    this.setColour((r << 16) | (g << 8) | b);
    if (this.tool === 'pick') this.tool = 'pencil';
  }
  begin() { this.snapshot(); this.stroked = false; }
  end() {
    if (this.stroked) { this.changed = true; this.commit(); } else this.undos.pop();
    this.stroked = false;
  }
  mouseClicked(mx, my, button) {
    const hit = super.mouseClicked(mx, my, button);
    if (hit) return hit;
    if (button === 0) {
      for (let i = 0; i < SWATCHES.length; i++) if (this.inBox(this.swatch(i), mx, my)) { this.setColour(SWATCHES[i]); return true; }
      if (this.inBox(this.sv, mx, my)) { this.drag = 'sv'; this.pickSv(mx, my); return true; }
      if (this.inBox(this.hue, mx, my)) { this.drag = 'hue'; this.pickHue(my); return true; }
    }
    const p = this.pixelAt(mx, my);
    if (!p || !this.ready) return null;
    if (button === 2 || this.tool === 'pick') { this.pick(p[0], p[1]); return true; }
    if (button !== 0) return true;
    this.begin();
    if (this.tool === 'fill') { this.fill(p[0], p[1]); this.end(); return true; }
    this.drag = 'paint'; this.last = p;
    this.dot(p[0], p[1]); this.commit();
    return true;
  }
  mouseDragged(mx, my, button) {
    if (this.drag === 'paint') {
      const p = this.pixelAt(mx, my);
      if (p) { this.line(this.last[0], this.last[1], p[0], p[1]); this.last = p; this.commit(); }
      return;
    }
    if (this.drag === 'sv') { this.pickSv(mx, my); return; }
    if (this.drag === 'hue') { this.pickHue(my); return; }
    super.mouseDragged(mx, my, button);
  }
  mouseReleased(mx, my, button) {
    if (this.drag === 'paint') this.end();
    this.drag = null;
    super.mouseReleased(mx, my, button);
  }
  keyPressed(e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { this.undo(); return true; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = { p: 'pencil', b: 'pencil', e: 'eraser', f: 'fill', i: 'pick' }[(e.key || '').toLowerCase()];
      if (t) { this.tool = t; this.gui.markDirty(); return true; }
    }
    return super.keyPressed(e);
  }
  render(g, mx, my, dt) {
    GUI = g;
    for (const b of this.tools) b.active = this.tool !== b.tool;
    if (this.undoB) this.undoB.active = this.undos.length > 0;
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 5, WHITE);
    const c = g.ctx, s = this.s, [vx, vy, vw, vh] = this.view, X = this.x0, Y = this.y0;
    // the picture, magnified: checks under see-through pixels, the parts it does not use dimmed
    g.fill(X - 1, Y - 1, X + vw * s + 1, Y + vh * s + 1, 0xFF000000);
    c.drawImage(this.masks, vx, vy, vw, vh, X, Y, vw * s, vh * s);
    c.drawImage(this.tex, vx, vy, vw, vh, X, Y, vw * s, vh * s);
    c.drawImage(this.dim, vx, vy, vw, vh, X, Y, vw * s, vh * s);
    if (s >= 5) {
      for (let i = 1; i < vw; i++) g.fill(X + i * s, Y, X + i * s + 1, Y + vh * s, 0x22000000);
      for (let i = 1; i < vh; i++) g.fill(X, Y + i * s, X + vw * s, Y + i * s + 1, 0x22000000);
    }
    const p = this.pixelAt(mx, my), over = p ? this.faceAt(p[0], p[1]) : null;
    // every face lightly outlined, each part more strongly, the second layer in yellow; names where they fit
    const box = (x, y, w, h, argb) => {
      const a = X + (x - vx) * s, b = Y + (y - vy) * s, w2 = w * s, h2 = h * s;
      g.fill(a, b, a + w2, b + 1, argb); g.fill(a, b + h2 - 1, a + w2, b + h2, argb);
      g.fill(a, b + 1, a + 1, b + h2 - 1, argb); g.fill(a + w2 - 1, b + 1, a + w2, b + h2 - 1, argb);
    };
    for (const r of this.parts) for (const f of r.faces) box(f[1], f[2], f[3], f[4], r.layer === 2 ? 0x30FFE070 : 0x30FFFFFF);
    for (const r of this.parts) box(r.rect[0], r.rect[1], r.rect[2], r.rect[3], r.layer === 2 ? 0x90FFE070 : 0x90FFFFFF);
    c.globalAlpha = 0.75;
    for (const r of this.parts) {
      if (over && over.part === r) continue;
      const w = r.rect[2] * s - 4, h = r.rect[3] * s;
      const name = r.label === false ? null : [r.name, r.short].find(n => n && g.textWidth(n) <= w);
      if (name && h >= 10) g.text(name, X + (r.rect[0] - vx) * s + 2, Y + (r.rect[1] - vy) * s + 2, r.layer === 2 ? 0xFFE070 : WHITE);
    }
    c.globalAlpha = 1;
    if (p) {
      const a = X + (p[0] - vx) * s, b = Y + (p[1] - vy) * s;
      g.fill(a - 1, b - 1, a + s + 1, b, 0xFFFFFFFF); g.fill(a - 1, b + s, a + s + 1, b + s + 1, 0xFFFFFFFF);
      g.fill(a - 1, b, a, b + s, 0xFFFFFFFF); g.fill(a + s, b, a + s + 1, b + s, 0xFFFFFFFF);
    }
    // under the picture: what is under the pointer, or the last thing said
    const sy = Y + vh * s + 4, maxW = vw * s;
    if (this.note && performance.now() < this.noteUntil) { g.font.wrap(this.note, maxW).slice(0, 3).forEach((l, i) => g.text(l, X, sy + i * 10, 0xFFFF55)); this.animates = true; }
    else {
      this.animates = false;
      if (over) g.font.wrap(over.part.name + (over.part.layer === 2 && this.layerNames ? ' (second layer)' : '') + (over.part.faces.length > 1 ? ', ' + over.face[0] : '') + ' at ' + p[0] + ', ' + p[1], maxW).slice(0, 2).forEach((l, i) => g.text(l, X, sy + i * 10, GREY));
      else if (p) g.text(p[0] + ', ' + p[1] + ': not used', X, sy, 0x707070);
    }
    // the preview
    panel(g, ...this.pv);
    this.preview(g, ...this.pv);
    // any colour: saturation across, brightness down, the hue strip beside it
    const [sx, sy2, sw, sh] = this.sv, [hx, hy, hw, hh] = this.hue, [H0, S0, V0] = this.hsv;
    c.fillStyle = hex(fromHsv(H0, 1, 1)); c.fillRect(sx, sy2, sw, sh);
    let gr = c.createLinearGradient(sx, 0, sx + sw, 0); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(sx, sy2, sw, sh);
    gr = c.createLinearGradient(0, sy2, 0, sy2 + sh); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)'); c.fillStyle = gr; c.fillRect(sx, sy2, sw, sh);
    gr = c.createLinearGradient(0, hy, 0, hy + hh);
    ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].forEach((col, i) => gr.addColorStop(i / 6, col));
    c.fillStyle = gr; c.fillRect(hx, hy, hw, hh);
    const kx = Math.round(sx + S0 * (sw - 1)), ky = Math.round(sy2 + (1 - V0) * (sh - 1)), ring = V0 > 0.6 && S0 < 0.4 ? 0xFF000000 : 0xFFFFFFFF;
    g.fill(kx - 2, ky - 2, kx + 3, ky - 1, ring); g.fill(kx - 2, ky + 2, kx + 3, ky + 3, ring); g.fill(kx - 2, ky - 1, kx - 1, ky + 2, ring); g.fill(kx + 2, ky - 1, kx + 3, ky + 2, ring);
    const hyk = Math.round(hy + H0 * hh); g.fill(hx - 1, hyk - 1, hx + hw + 1, hyk + 1, 0xFFFFFFFF);
    // the colour in hand, its number, and the swatches
    const wy = this.sw0;
    g.fill(this.rx, wy, this.rx + 21, wy + 21, 0xFFA0A0A0); g.fill(this.rx + 1, wy + 1, this.rx + 20, wy + 20, 0xFF000000 | this.colour);
    SWATCHES.forEach((col, i) => { const [x, y, w, h] = this.swatch(i); if (col === this.colour) g.fill(x - 1, y - 1, x + w + 1, y + h + 1, 0xFFFFFFFF); g.fill(x, y, x + w, y + h, 0xFF000000 | col); });
    g.text(hex(this.colour), this.rx + 24 + 8 * 11 + 3, wy + 7, GREY);
    const hint = this.hint || 'Right click takes a colour. Ctrl+Z undoes.';
    g.font.wrap(hint, this.rw).forEach((l, i) => { if (wy + 28 + i * 10 < this.height - 60) g.text(l, this.rx, wy + 28 + i * 10, 0x808080); });
    if (!this.ready) g.centered('Loading...', X + vw * s / 2, Y + vh * s / 2 - 4, WHITE);
  }
}

/* ---- the skin editor: the 64 x 64 skin, both layers ---- */
export class SkinEditorScreen extends PixelEditor {
  constructor(startUrl) {
    super('Edit Skin', 64, 64, [0, 0, 64, 64], 6);
    this.start = startUrl || null; this.model = null; this.layerNames = true;
    this.hint = 'White outlines: the first layer. Yellow: the second layer over it, which can be see-through. Right click takes a colour.';
  }
  init() {
    const o = this.options;
    const first = this.model === null;
    if (first) this.model = o.get('skinModel') === 'slim' ? 'slim' : 'classic';
    super.init();
    if (first) this.loadFrom(this.start || skinUrlOf(o));
  }
  loadFrom(url) {
    return loadImage(url).then(im => skinCanvas(im), () => null).then(c => {
      if (c) { this.setPicture(c); return; }
      // not a skin we can read: start from the default
      return loadImage(DEFAULT_SKIN).then(im => this.setPicture(skinCanvas(im)), () => this.blank(false));
    });
  }
  regions() {
    const aw = this.model === 'slim' ? 3 : 4;
    const part = (name, short, layer, u, v, w, h, d) => ({ name, short, layer, rect: [u, v, 2 * d + 2 * w, d + h], faces: boxFaces(u, v, w, h, d) });
    return [
      part('Head', '', 1, 0, 0, 8, 8, 8), part('Body', '', 1, 16, 16, 8, 12, 4),
      part('Right Arm', 'R Arm', 1, 40, 16, aw, 12, 4), part('Right Leg', 'R Leg', 1, 0, 16, 4, 12, 4),
      part('Left Arm', 'L Arm', 1, 32, 48, aw, 12, 4), part('Left Leg', 'L Leg', 1, 16, 48, 4, 12, 4),
      part('Hat', '', 2, 32, 0, 8, 8, 8), part('Jacket', '', 2, 16, 32, 8, 12, 4),
      part('Right Sleeve', 'R Sleeve', 2, 40, 32, aw, 12, 4), part('Right Pants Leg', 'R Pants', 2, 0, 32, 4, 12, 4),
      part('Left Sleeve', 'L Sleeve', 2, 48, 48, aw, 12, 4), part('Left Pants Leg', 'L Pants', 2, 0, 48, 4, 12, 4),
    ];
  }
  clearable(layer) { return layer === 2; }
  // the first layer is never see-through, as the game draws it
  fixPicture() {
    const d = this.img.data;
    for (let i = 0; i < this.used.length; i++) if (this.used[i] === 1) d[i * 4 + 3] = 255;
  }
  rowButtons() {
    return [
      ['Blank', () => this.blank(true), 'Start again from plain grey, the second layer empty'],
      ['Default', () => { this.snapshot(); this.model = 'classic'; this.rebuild(); this.gui._initScreen(this); this.loadFromDefault(); }, 'Start again from the default skin'],
      ['Undo', () => this.undo(), 'Ctrl+Z'],
      ['Model: ' + (this.model === 'slim' ? 'Slim' : 'Classic'), b => { this.model = this.model === 'slim' ? 'classic' : 'slim'; b.message = 'Model: ' + (this.model === 'slim' ? 'Slim' : 'Classic'); this.rebuild(); this.gui.markDirty(); }, 'Classic arms are 4 pixels wide, slim arms 3.'],
    ];
  }
  loadFromDefault() { loadImage(DEFAULT_SKIN).then(im => { this.setPicture(skinCanvas(im)); this.changed = true; }, () => this.say('The default skin could not be loaded.')); }
  blank(undoable) {
    if (undoable) this.snapshot();
    const d = this.img.data;
    for (let i = 0; i < this.used.length; i++) {
      const on = this.used[i] === 1;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = on ? 0xB8 : 0; d[i * 4 + 3] = on ? 255 : 0;
    }
    this.changed = true; this.ready = true; this.commit();
  }
  preview(g, x, y, w, h) {
    const ps = this.ps, slim = this.model === 'slim', c = g.ctx;
    const cape = picture(this.options.get('cape'), 'cape');
    const fx = x + Math.floor((w - 32 * ps - 4 * ps) / 2);
    drawFigure(c, this.tex, fx, y, ps, { slim });
    drawFigure(c, this.tex, fx + 16 * ps + 4 * ps, y, ps, { back: true, slim, cape, parts: { cape: this.options.get('skinParts').cape } });
  }
  save() {
    const o = this.options;
    o.set('skin', this.tex.toDataURL('image/png')); o.set('skinModel', this.model); o.set('skinName', '');
    this.gui.back();
  }
}

/* ---- the cape editor: the cape's own part of the 64 x 32 picture ---- */
export class CapeEditorScreen extends PixelEditor {
  constructor(startUrl) {
    super('Edit Cape', 64, 32, [0, 0, 22, 17], 12);
    this.start = startUrl || null;
    this.hint = 'The outside is seen from behind, the inside is the lining; the thin strips round them are the edges. Right click takes a colour.';
  }
  init() {
    super.init();
    if (!this.begun) {
      this.begun = true;
      const url = this.start || this.options.get('cape');
      if (url) loadImage(url).then(im => capeCanvas(im), () => null).then(c => { if (c) this.setPicture(c); else { this.blank(); this.changed = false; } });
      else { this.blank(); this.changed = false; }
    }
  }
  regions() {
    // (the edges are one pixel thin: named under the picture when the pointer is on one, not on it)
    const one = (name, short, x, y, w, h) => ({ name, short, layer: 2, label: w > 1 && h > 1, rect: [x, y, w, h], faces: [[name.toLowerCase(), x, y, w, h]] });
    return [
      one('Outside', 'Out', 1, 1, 10, 16), one('Inside', 'In', 12, 1, 10, 16),
      one('Top edge', '', 1, 0, 10, 1), one('Bottom edge', '', 11, 0, 10, 1),
      one('Right edge', '', 0, 1, 1, 16), one('Left edge', '', 11, 1, 1, 16),
    ];
  }
  rowButtons() {
    return [
      ['Blank', () => { this.snapshot(); this.blank(); }, 'Start again from a plain grey cape'],
      ['Copy to Inside', () => this.mirror(), 'Copy the outside onto the inside, turned over as if seen through the cloth'],
      ['Match Edges', () => this.edges(), "Colour the edges from the outside's border, a shade darker"],
      ['Undo', () => this.undo(), 'Ctrl+Z'],
    ];
  }
  blank() {
    const c = canvas(64, 32);
    paintCape(c.getContext('2d'), () => 0xB8B8B8, 0x8C8C8C);
    this.setPicture(c);
    this.changed = true;
  }
  mirror() {
    this.begin();
    for (let y = 1; y <= 16; y++) for (let x = 0; x < 10; x++) { const [r, g, b, a] = this.get(1 + (9 - x), y); this.set(12 + x, y, r, g, b, a); }
    this.end();
  }
  edges() {
    this.begin();
    const dark = (x, y, k) => { const [r, g, b, a] = this.get(x, y); return [Math.round(r * k), Math.round(g * k), Math.round(b * k), a]; };
    for (let x = 0; x < 10; x++) { this.set(1 + x, 0, ...dark(1 + x, 1, 0.85)); this.set(11 + x, 0, ...dark(1 + x, 16, 0.85)); }
    for (let y = 1; y <= 16; y++) { this.set(0, y, ...dark(1, y, 0.8)); this.set(11, y, ...dark(10, y, 0.8)); }
    this.end();
  }
  preview(g, x, y, w) {
    const ps = this.ps, o = this.options, c = g.ctx;
    const skin = picture(skinUrlOf(o), 'skin');
    const fx = x + Math.floor((w - 26 * ps - 6) / 2);
    drawFigure(c, skin, fx, y, ps, { back: true, slim: o.get('skinModel') === 'slim', cape: this.tex, parts: Object.assign({}, o.get('skinParts'), { cape: true }) });
    drawCape(c, this.tex, fx + 16 * ps + 6, y + 8 * ps, ps, true);
    g.text('Inside', fx + 16 * ps + 6, y + 2, GREY);
  }
  save() {
    const o = this.options;
    o.set('cape', this.tex.toDataURL('image/png')); o.set('capeName', ''); o.setPart('cape', true);
    this.gui.back();
  }
}
