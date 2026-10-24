/* ---------------------------------------------------------------------------
   Leoncraft 2 - the skin gallery (Skin Customization -> Skin Gallery...).

   Skins other people drew and shared under open licences, from the Minetest
   skin database (skinsdb.terraqueststudios.net; picked by hand for original
   designs: no famous characters, real people or edits of the game's own
   skins). Each is the old 64 x 32 layout, which the player model reads as
   the game does. Picking one keeps it as the skin option (a data URL, as a
   skin file is kept), so a server shows it to everyone. Their authors and
   licences are in textures/skin/gallery/gallery.json, textures/LICENSE.txt
   and the Credits screen (SKIN_CREDITS).
--------------------------------------------------------------------------- */
import { Screen, Button, WHITE, GREY } from './gui.js?v=107';

// [file, name, author, licence, number in the database]
export const SKINS = [
  ['flower_girl', 'Flower Girl', 'julito', 'CC BY-SA 3.0', 1028],
  ['super_nerd', 'Super Nerd', 'julito', 'CC BY-SA 3.0', 1029],
  ['mermaid', 'Mermaid', 'loupicate', 'CC BY-SA 4.0', 1036],
  ['space_noob', 'Space Noob', 'Fedora P', 'CC BY-SA 3.0', 1037],
  ['good_bot', 'Good Bot', 'julito', 'CC BY-SA 3.0', 1054],
  ['scientist', 'Scientist', 'Néoprene', 'CC BY-SA 3.0', 1138],
  ['ice_boy', 'Ice Boy', 'ElMehdiBen', 'CC BY-SA 3.0', 1210],
  ['trader', 'Trader', 'TenPlus1', 'CC BY-SA 3.0', 1258],
  ['pastel_girl', 'Pastel Girl', 'Rin0002', 'CC BY 3.0', 1271],
  ['elf_princess', 'Elf Princess', 'Rin0002', 'CC BY 3.0', 1273],
  ['green_sweater', 'Green Sweater', 'Rin0002', 'CC BY 3.0', 1275],
  ['candy_girl', 'Candy Girl', 'Belen1', 'CC0 1.0', 1290],
  ['king_gerold', 'King Gerold', 'Extex', 'CC BY-SA 3.0', 1434],
  ['the_green_wizard', 'The Green Wizard', 'Extex', 'CC BY-SA 3.0', 1435],
  ['plaid_cat', 'Plaid Cat', '0ssd', 'CC0 1.0', 1486],
  ['rpg_kid', 'RPG Kid', 'Hugues Ross', 'CC BY-SA 4.0', 1509],
  ['t_rex', 'T Rex', 'Kefka.', 'CC BY-SA 3.0', 1539],
  ['carrot_man', 'Carrot Man', 'piesock', 'CC BY-SA 3.0', 1579],
  ['frog_girl', 'Frog Girl', 'Illa', 'CC0 1.0', 2256],
  ['knighted_girl', 'Knighted Girl', 'Celtina', 'CC0 1.0', 2335],
  ['explorer', 'Explorer', 'Davizinho', 'CC BY-SA 3.0', 189],
  ['red_knight', 'Red Knight', 'Sam_0', 'CC BY 4.0', 2036],
  ['pilot', 'Pilot', 'yotuderconnect', 'CC BY 4.0', 2124],
  ['knight', 'Knight', 'me', 'CC BY-SA 3.0', 1166],
  ['blue_tnt_mouse', 'Blue TNT Mouse', 'Enrico', 'CC BY-SA 3.0', 1420],
  ['shadow_ninja', 'Shadow Ninja', 'ShadowNinja', 'CC BY-SA 4.0', 158],
  ['ghost', 'Ghost', 'BlockMen', 'CC BY-SA 4.0', 1969],
  ['camouflaged_wizard', 'Camouflaged Wizard', 'nm0i', 'CC BY-SA 4.0', 696],
  // (worn by Leon Network's Chameleon seekers)
  ['swat_agent', 'SWAT Agent', 'Rhys', 'CC BY-SA 3.0', 437],
];
export const skinUrl = file => new URL('../../textures/skin/gallery/' + file + '.png?v=107', import.meta.url).href;

// the Credits screen's lines for them
export function skinCredits() {
  const out = [['Player Skins', 0xFFFF55], ['The Skin Gallery\'s skins (Meccha Chameleon\'s seekers wear one), from the Minetest skin database:'],
    ['skinsdb.terraqueststudios.net', 0, 'https://skinsdb.terraqueststudios.net/']];
  for (const [, name, by, lic, n] of SKINS) out.push(['"' + name + '" by ' + by + ', ' + lic + ' (#' + n + ')']);
  out.push(['Used unchanged. CC BY-SA 3.0: creativecommons.org/licenses/by-sa/3.0', 0, 'https://creativecommons.org/licenses/by-sa/3.0/']);
  out.push(['']);
  return out;
}

/* The figure seen from the front and from the back, drawn from the skin's
   own pixels (the old layout's left arm and leg are the right ones turned
   over): a 32 x 32 picture, front on the left half, back on the right. */
const PICS = new Map();
function figure(file) {
  let p = PICS.get(file);
  if (p) return p.ready ? p.canvas : null;
  p = { ready: false, canvas: document.createElement('canvas') };
  PICS.set(file, p);
  const im = new Image();
  im.onload = () => {
    const c = p.canvas; c.width = 32; c.height = 32;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    const part = (sx, sy, w, h, dx, dy, flip) => {
      if (!flip) { x.drawImage(im, sx, sy, w, h, dx, dy, w, h); return; }
      x.save(); x.translate(dx + w, dy); x.scale(-1, 1); x.drawImage(im, sx, sy, w, h, 0, 0, w, h); x.restore();
    };
    // front: head and hat, body, the right arm and leg on the viewer's left, the left ones turned over on the right
    part(8, 8, 8, 8, 4, 0); part(40, 8, 8, 8, 4, 0);
    part(20, 20, 8, 12, 4, 8); part(44, 20, 4, 12, 0, 8); part(44, 20, 4, 12, 12, 8, true);
    part(4, 20, 4, 12, 4, 20); part(4, 20, 4, 12, 8, 20, true);
    // back
    part(24, 8, 8, 8, 20, 0); part(56, 8, 8, 8, 20, 0);
    part(32, 20, 8, 12, 20, 8); part(52, 20, 4, 12, 28, 8); part(52, 20, 4, 12, 16, 8, true);
    part(12, 20, 4, 12, 24, 20); part(12, 20, 4, 12, 20, 20, true);
    p.ready = true;
    if (p.gui) p.gui.markDirty();
  };
  im.src = skinUrl(file);
  return null;
}

// a gallery skin as the skin option keeps one (a data URL, so it goes to a server like a chosen file)
async function asDataUrl(file) {
  const blob = await (await fetch(skinUrl(file))).blob();
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

export class SkinGalleryScreen extends Screen {
  constructor() { super('Skin Gallery'); this.hover = -1; this.msg = ''; this.scroll = 0; }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.add(new Button(W / 2 - 100, H - 27, 200, 20, 'Done', () => g.back()));
    this.layout();
  }
  layout() {
    const W = this.width, H = this.height;
    // the preview on the left, the grid of figures on the right
    this.pw = Math.min(120, Math.floor(W * 0.32));
    this.cw = 22; this.ch = 38;
    this.gx = this.pw + 16;
    this.cols = Math.max(1, Math.floor((W - this.gx - 8) / this.cw));
    this.gy = 30; this.gh = H - 36 - this.gy;
    this.rows = Math.ceil(SKINS.length / this.cols);
    this.maxScroll = Math.max(0, this.rows * this.ch - this.gh);
  }
  cellAt(mx, my) {
    if (mx < this.gx || my < this.gy || my >= this.gy + this.gh) return -1;
    const c = Math.floor((mx - this.gx) / this.cw), r = Math.floor((my - this.gy + this.scroll) / this.ch);
    if (c >= this.cols) return -1;
    const i = r * this.cols + c;
    return i < SKINS.length ? i : -1;
  }
  chosen() { return this.options.get('skinName') || ''; }
  mouseClicked(mx, my, button) {
    const hit = super.mouseClicked(mx, my, button);
    if (hit) return hit;
    const i = this.cellAt(mx, my);
    if (i < 0 || button !== 0) return null;
    const [file, name] = SKINS[i], o = this.options, g = this.gui;
    asDataUrl(file).then(url => { o.set('skin', url); o.set('skinModel', 'classic'); o.set('skinName', name); this.msg = ''; g.markDirty(); },
      () => { this.msg = 'That skin could not be loaded.'; g.markDirty(); });
    return true;
  }
  mouseScrolled(mx, my, d) {
    if (super.mouseScrolled(mx, my, d)) return true;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + (d > 0 ? 1 : -1) * this.ch));
    this.gui.markDirty();
    return true;
  }
  render(g, mx, my, dt) {
    this.layout();
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 10, WHITE);
    const chosen = this.chosen();
    this.hover = this.cellAt(mx, my);
    // the grid
    const c = g.ctx, sm = c.imageSmoothingEnabled;
    c.save();
    c.beginPath(); c.rect(this.gx - 2, this.gy, this.width - this.gx, this.gh); c.clip();
    c.imageSmoothingEnabled = false;
    for (let i = 0; i < SKINS.length; i++) {
      const x = this.gx + (i % this.cols) * this.cw, y = this.gy + Math.floor(i / this.cols) * this.ch - this.scroll;
      if (y + this.ch < this.gy || y > this.gy + this.gh) continue;
      const on = SKINS[i][1] === chosen, hov = i === this.hover;
      if (on || hov) g.fill(x, y, x + this.cw - 2, y + this.ch - 2, on ? 0x80FFFFFF : 0x40FFFFFF);
      const f = figure(SKINS[i][0]);
      if (f) c.drawImage(f, 0, 0, 16, 32, x + 2, y + 2, 16, 32);
      else PICS.get(SKINS[i][0]).gui = this.gui;
    }
    c.restore();
    c.imageSmoothingEnabled = sm;
    // the preview: the one under the mouse, or the one in use; front and back, twice the size
    const k = this.hover >= 0 ? this.hover : SKINS.findIndex(s => s[1] === chosen);
    const px = 8, py = this.gy;
    g.fill(px, py, px + this.pw, py + 108, 0x60000000);
    if (k >= 0) {
      const [file, name, by, lic] = SKINS[k], f = figure(file);
      if (f) { c.imageSmoothingEnabled = false; c.drawImage(f, 0, 0, 16, 32, px + this.pw / 2 - 36, py + 6, 32, 64); c.drawImage(f, 16, 0, 16, 32, px + this.pw / 2 + 4, py + 6, 32, 64); c.imageSmoothingEnabled = sm; }
      g.centered(g.font.trim(name, this.pw - 4), px + this.pw / 2, py + 76, WHITE);
      g.centered(g.font.trim('by ' + by, this.pw - 4), px + this.pw / 2, py + 86, GREY);
      g.centered(lic, px + this.pw / 2, py + 96, GREY);
    } else g.centered('Pick a skin', px + this.pw / 2, py + 50, GREY);
    g.text(g.font.trim(chosen ? 'In use: ' + chosen : 'In use: ' + (this.options.get('skin') === 'default' ? 'Default' : 'Your own file'), this.pw), px, py + 114, GREY);
    if (this.msg) g.centered(this.msg, this.width / 2, this.height - 40, 0xFF5555);
  }
}
