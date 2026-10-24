/* ---------------------------------------------------------------------------
   Leoncraft 2 - the menu screens.

   Laid out with the classic block game's 1.21 numbers (button sizes, rows
   24 apart, the title menu a quarter of the way down, the options grid in two
   150-wide columns), drawn with the GUI framework in gui.js.

     TitleScreen, SelectWorldScreen, CreateWorldScreen, EditWorldScreen,
     ConfirmScreen, NoticeScreen, MessageScreen, OptionsScreen and its pages
     (Video, Controls, Mouse, Key Binds, Skin, Music & Sounds, Accessibility,
     Language, Credits), PauseScreen, LoadingScreen, DeathScreen.

   The game talks to them through gui.hooks:
     play(world, { isNew })   start (or create) a world from the world list
     deleteWorld(world)       a world was deleted (drop its saved chunks)
     quitToTitle()            Save and Quit to Title / Title Screen
     resume()                 Back to Game
     respawn()                Respawn on the death screen
     loadingProgress()        -> { text, progress 0-1, chunks: [[dx, dz, state]] }
     quit()                   Quit Game on the title screen
   Worlds are kept in localStorage 'lc2_worlds' (see Worlds below).

   The LEONCRAFT wordmark is drawn here at load from the game's own stone
   texture (Pixel Perfection CE, CC BY-SA 4.0) and our own letter shapes.
--------------------------------------------------------------------------- */
import {
  Screen, Button, IconButton, Slider, CycleButton, TextField, Checkbox, TextLink, ScrollList,
  WidgetRow, Tabs, OptionsListScreen, DEFAULT_KEYS, DEFAULT_KEYS2, keyLabel, onOff, WHITE, GREY,
} from './gui.js?v=107';
import { Packs } from './pack.js?v=107';
import { Account } from '../net/account.js?v=107';
import { withAccount, AccountScreen, AdminScreen, LoginScreen, logOut } from './account.js?v=107';
import { packArtSummary } from '../entities/packart.js?v=107';
import { LanScreen } from './lan.js?v=107';
import { parseSeed } from '../gen/random.js?v=107';
import { SOUND_CREDITS } from '../sound/credits.js?v=107';
import { PAINTING_ART } from '../paintingdata.js?v=107';
import { SkinGalleryScreen, skinCredits } from './skins.js?v=107';
import { SkinsScreen } from './skinmenu.js?v=107';
import { FlatCustomizeScreen } from './flat.js?v=107';
import { DEFAULT_FLAT, flatGenerator } from '../gen/flat.js?v=107';

const PI = Math.PI;

/* ------------------------------ worlds ------------------------------ */

const WORLDS_KEY = 'lc2_worlds';
// whether the first Leoncraft's solo world is in this browser (its key: lc1/spimport.js LC1_KEYS)
function hasLc1Save() { try { const j = JSON.parse(localStorage.getItem('leoncraft_sp_world') || 'null'); return !!j && typeof j.seed === 'number'; } catch (e) { return false; } }
export const Worlds = {
  list() {
    try { const a = JSON.parse(localStorage.getItem(WORLDS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  },
  saveAll(list) { try { localStorage.setItem(WORLDS_KEY, JSON.stringify(list)); } catch (e) { /* blocked */ } },
  get(id) { return this.list().find(w => w.id === id) || null; },
  add(w) { const l = this.list(); l.push(w); this.saveAll(l); return w; },
  update(id, patch) { const l = this.list(); const w = l.find(x => x.id === id); if (w) { Object.assign(w, patch); this.saveAll(l); } return w; },
  remove(id) { this.saveAll(this.list().filter(w => w.id !== id)); },
  // a folder-style name, made unique the way the game adds " (1)"
  folderName(name) {
    let base = (name || 'World').replace(/[\\/:*?"<>|.]/g, '_').trim() || 'World';
    const used = new Set(this.list().map(w => w.folder || w.name));
    let f = base, n = 1;
    while (used.has(f)) f = base + ' (' + n++ + ')';
    return f;
  },
};

// text seeds hash the way Java's String.hashCode does, so a seed word always gives the same world
export function seedFrom(text) {
  const t = String(text || '').trim();
  if (!t) return (Math.random() * 4294967296 | 0);
  if (/^-?\d{1,19}$/.test(t)) { const n = Number(t); if (Number.isFinite(n)) return n; }
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return h;
}

const fmtDate = ms => {
  try { return new Date(ms).toLocaleString('en-US', { year: '2-digit', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
};
const MODES = { survival: 'Survival', hardcore: 'Hardcore', creative: 'Creative', adventure: 'Adventure', spectator: 'Spectator' };

/* ------------------------------ the wordmark ------------------------------ */

// our own letter shapes, 5 cells wide and 6 tall
const LETTERS = {
  L: ['##...', '##...', '##...', '##...', '##...', '#####'],
  E: ['#####', '##...', '####.', '##...', '##...', '#####'],
  O: ['.###.', '##.##', '##.##', '##.##', '##.##', '.###.'],
  N: ['##..#', '###.#', '#####', '##.##', '##..#', '##..#'],
  C: ['.####', '##...', '##...', '##...', '##...', '.####'],
  R: ['####.', '##.##', '##.##', '####.', '##.#.', '##.##'],
  A: ['.###.', '##.##', '##.##', '#####', '##.##', '##.##'],
  F: ['#####', '##...', '####.', '##...', '##...', '##...'],
  T: ['#####', '.##..', '.##..', '.##..', '.##..', '.##..'],
};
let logoPromise = null;

/* Builds the 256 x 44 LEONCRAFT logo and the 128 x 14 BROWSER EDITION plate:
   stone faces lit from above, a darker stone side going down, a near-black
   outline, like a block-carved title. Done once; later calls share it. */
// a resource pack's own logo and edition plate (see pack.js), drawn instead of ours
export function setLogoArt(art) { if (art) logoPromise = Promise.resolve(art); }
export function loadLogo(gui) {
  if (logoPromise) return logoPromise;
  logoPromise = new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(buildLogo(img, gui.font));
    img.onerror = () => resolve(buildLogo(null, gui.font));
    img.src = new URL('../terrain_albedo.png', gui.base).href + gui.version;
  });
  return logoPromise;
}

function buildLogo(terrain, font) {
  // the stone layer (layer 0, the top 16 x 16 of the strip)
  let stone = null;
  if (terrain) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(terrain, 0, 0, 16, 16, 0, 0, 16, 16);
    try { stone = g.getImageData(0, 0, 16, 16).data; } catch (e) { stone = null; }
  }
  // the stone toned down to a calm grey, so the letters read before the texture does
  let mean = 128;
  if (stone) { let t = 0; for (let i = 0; i < 256; i++) t += stone[i * 4] * 0.3 + stone[i * 4 + 1] * 0.59 + stone[i * 4 + 2] * 0.11; mean = t / 256; }
  const tone = [0, 0, 0];
  const stc = (x, y) => {
    let v = 140;
    if (stone) { const o = (((y & 15) * 16) + (x & 15)) * 4; v = 140 + ((stone[o] * 0.3 + stone[o + 1] * 0.59 + stone[o + 2] * 0.11) - mean) * 0.6; }
    tone[0] = v; tone[1] = v; tone[2] = v * 1.03;
    return tone;
  };

  const W = 256, H = 44, CW = 5, CH = 6, GAP = 3, DEPTH = 4;
  const word = 'LEONCRAFT';
  const face = new Uint8Array(W * H), top = new Int16Array(W * H).fill(-1);
  const total = word.length * 5 * CW + (word.length - 1) * GAP;
  const ox = Math.floor((W - total) / 2), oy = 1;
  for (let i = 0; i < word.length; i++) {
    const rows = LETTERS[word[i]];
    const lx = ox + i * (5 * CW + GAP);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) {
      if (rows[r][c] !== '#') continue;
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        const px = lx + c * CW + x, py = oy + r * CH + y;
        face[py * W + px] = 1;
        top[py * W + px] = r * CH + y;
      }
    }
  }
  const at = (a, x, y) => x >= 0 && y >= 0 && x < W && y < H ? a[y * W + x] : 0;
  // the side: straight down from the face, DEPTH deep
  const side = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (face[y * W + x]) continue;
    for (let d = 1; d <= DEPTH; d++) if (at(face, x, y - d)) { side[y * W + x] = d; break; }
  }
  const logo = document.createElement('canvas'); logo.width = W; logo.height = H;
  const lg = logo.getContext('2d');
  const out = lg.createImageData(W, H), p = out.data;
  const put = (x, y, rgb, k) => {
    const o = (y * W + x) * 4;
    p[o] = Math.min(255, rgb[0] * k); p[o + 1] = Math.min(255, rgb[1] * k); p[o + 2] = Math.min(255, rgb[2] * k); p[o + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (face[i]) {
      let k = 1.2 - 0.3 * (top[i] / 35);
      if (!at(face, x, y - 1)) k = 1.55;
      else if (!at(face, x - 1, y)) k *= 1.15;
      else if (!at(face, x + 1, y)) k *= 0.8;
      else if (!at(face, x, y + 1)) k *= 0.85;
      put(x, y, stc(x, y), k);
    } else if (side[i]) {
      put(x, y, stc(x + 7, y + 3), 0.5 - 0.05 * side[i]);
    } else {
      // a one-pixel outline round the carved shape
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (at(face, x + dx, y + dy) || at(side, x + dx, y + dy)) { near = true; break; }
      if (near) { const o = i * 4; p[o] = 18; p[o + 1] = 16; p[o + 2] = 16; p[o + 3] = 255; }
    }
  }
  lg.putImageData(out, 0, 0);

  // BROWSER EDITION: the GUI font in bold, light grey with a dark outline and a darker lower lip
  const EW = 128, EH = 14;
  const tmp = document.createElement('canvas'); tmp.width = EW; tmp.height = EH;
  const tg = tmp.getContext('2d', { willReadFrequently: true });
  const label = '§lBROWSER EDITION';
  font.draw(tg, label, Math.floor((EW - font.width(label)) / 2), 3, 0xFFFFFF, false);
  const mask = tg.getImageData(0, 0, EW, EH).data;
  const m = (x, y) => x >= 0 && y >= 0 && x < EW && y < EH && mask[(y * EW + x) * 4 + 3] > 0;
  const edition = document.createElement('canvas'); edition.width = EW; edition.height = EH;
  const eg = edition.getContext('2d');
  const eo = eg.createImageData(EW, EH), q = eo.data;
  for (let y = 0; y < EH; y++) for (let x = 0; x < EW; x++) {
    const o = (y * EW + x) * 4;
    if (m(x, y)) {
      const v = Math.min(255, stc(x, y)[0] * (m(x, y - 1) ? 1.55 - (y - 3) * 0.05 : 1.8));
      q[o] = v; q[o + 1] = v; q[o + 2] = v; q[o + 3] = 255;
    } else if (m(x, y - 1)) {
      q[o] = 70; q[o + 1] = 70; q[o + 2] = 72; q[o + 3] = 255;
    } else {
      let near = false;
      for (let dy = -2; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (m(x + dx, y + dy)) { near = true; break; }
      if (near) { q[o] = 18; q[o + 1] = 16; q[o + 2] = 16; q[o + 3] = 255; }
    }
  }
  eg.putImageData(eo, 0, 0);
  return { logo, edition };
}

/* ------------------------------ title ------------------------------ */

// our own splash lines (never the original game's list)
export const SPLASHES = [
  'Every block!', 'Runs on a Chromebook!', 'Made by Leon!', 'Now in your browser!', 'No install needed!',
  'Shaders included!', 'Volumetric!', 'Look at those clouds!', 'Water that reflects!', 'Grass that sways!',
  'Try the cherry groves!', 'Also try Leon Kart!', 'One block at a time!', 'Sixteen by sixteen!', 'Pixel Perfection inside!',
  'Shared textures, shared love!', 'Twenty ticks a second!', 'Infinite-ish!', 'Mountains to 240!', 'Dig carefully!',
  'Fresh from the workers!', 'WebGL2!', 'Hand-placed pixels!', 'Sunsets included!', 'Snowboard not included!',
  'Now with flowing water!', 'Press F3 for numbers!', 'Bring a torch!', 'Best viewed at sunrise!', 'Zero ads!',
  'Homemade!', 'Also try the Games tab!', 'Seeds welcome!', 'Coded after school!', 'Smooth on a potato!',
  'Watch out for caves!', 'Stacks to 64!', 'Ray-marched clouds!', 'Try typing a seed!', 'Keep exploring!',
  'Soft shadows!', 'Leon approved!',
];

export class TitleScreen extends Screen {
  constructor(opts = {}) {
    super('');
    this.background = 'panorama';
    this.closeOnEsc = false;
    this.animates = true;
    this.splash = SPLASHES[Math.random() * SPLASHES.length | 0];
    this.fadeIn = !!opts.fadeIn;
    this.t0 = -1;
    this.art = null;
  }
  init() {
    const g = this.gui, W = this.width, H = this.height;
    if (!this.art) loadLogo(g).then(a => { this.art = a; g.markDirty(); });
    const l = Math.floor(H / 4) + 48;
    // (the play buttons ask you to log in first: ui/account.js)
    this.add(new Button(W / 2 - 100, l, 200, 20, 'Singleplayer', () => withAccount(g, () => {
      // (with no worlds yet the game goes straight to Create New World; a Leoncraft 1 world to bring over keeps the list, where its button is)
      g.open(Worlds.list().length || hasLc1Save() ? new SelectWorldScreen() : new CreateWorldScreen());
    })));
    const mp = this.add(new Button(W / 2 - 100, l + 24, 200, 20, 'Multiplayer', () => withAccount(g, () => (this.hooks.multiplayer ? this.hooks.multiplayer() : g.open(new NoticeScreen('Multiplayer', 'Multiplayer is not available in Leoncraft 2 yet.'))))));
    // (offline, with only the kept session: no servers to reach)
    if (Account.offline && !Account.checked) { mp.active = false; mp.tooltip = "Can't reach the login server"; }
    // who you are, top left (Account: change your password), Log Out and, for an admin, Admin top right
    this.acctSig = Account.name + '|' + Account.ready + '|' + Account.offline + '|' + Account.admin;
    if (Account.guest) {
      const who = 'Playing as ' + Account.name + ' (guest)', ww = g.textWidth(who);
      this.add(new TextLink(2, 2, ww, who, () => g.open(new LoginScreen(null)), WHITE));
      this.add(new Button(W - 64, 4, 60, 20, 'Log In', () => g.open(new LoginScreen(null))));
    } else if (Account.session) {
      const who = 'Logged in as ' + Account.name, ww = g.textWidth(who);
      this.add(new TextLink(2, 2, ww, who, () => g.open(new AccountScreen()), WHITE));
      this.add(new Button(W - 64, 4, 60, 20, 'Log Out', () => logOut(g)));
      if (Account.admin) this.add(new Button(W - 128, 4, 60, 20, 'Admin', () => withAccount(g, () => g.open(new AdminScreen()))));
    }
    // (Skins beside Realms: what you wear, any time, no account needed)
    this.add(new Button(W / 2 - 100, l + 48, 98, 20, 'Skins', () => g.open(new SkinsScreen()), 'Change your skin and cape'));
    const realms = this.add(new Button(W / 2 + 2, l + 48, 98, 20, 'Leoncraft Realms', null, 'Not available in Leoncraft'));
    realms.active = false;
    this.add(new IconButton(W / 2 - 124, l + 84, 'language', () => g.open(new LanguageScreen()), 'Language'));
    this.add(new Button(W / 2 - 100, l + 84, 98, 20, 'Options...', () => g.open(new OptionsScreen())));
    this.add(new Button(W / 2 + 2, l + 84, 98, 20, 'Quit Game', () => {
      if (this.hooks.quit) this.hooks.quit();
      else if (history.length > 1) history.back(); else location.href = '/';
    }));
    this.add(new IconButton(W / 2 + 104, l + 84, 'accessibility', () => g.open(new AccessibilitySettingsScreen()), 'Accessibility Settings'));
    const credit = 'Made by Leon Zhao. Not affiliated with Mojang.';
    const cw = g.textWidth(credit);
    this.add(new TextLink(W - cw - 2, H - 10, cw, credit, () => g.open(new CreditsScreen())));
  }
  render(g, mx, my, dt) {
    const ctx = g.ctx, W = this.width, H = this.height;
    if (this.t0 < 0) this.t0 = g.now;
    let a = 1;
    if (this.fadeIn) {
      // as in the game: a second of picture, then the menu fades in over a second
      const f = (g.now - this.t0) / 1000;
      a = Math.max(0, Math.min(1, f - 1));
      if (f < 1) g.fill(0, 0, W, H, (Math.round((1 - f) * 255) << 24) >>> 0);
      if (a <= 0) return;
    }
    ctx.globalAlpha = a;
    if (this.art) {
      const L = this.art.logo, E = this.art.edition;
      // a pack's logo is drawn at four times the size: let it filter down rather than drop rows
      ctx.imageSmoothingEnabled = L.width > 256 * g.scale;
      g.blit(L, 0, 0, L.width, L.height, Math.floor(W / 2 - 128), 30, 256, 44);
      if (E) g.blit(E, 0, 0, E.width, E.height, Math.floor(W / 2 - 64), 30 + 44 - 7, 128, 14);
      ctx.imageSmoothingEnabled = false;
    }
    if (!this.options.get('hideSplash') && this.splash) {
      ctx.save();
      ctx.translate(W / 2 + 123, 69);
      ctx.rotate(-20 * PI / 180);
      let f = 1.8 - Math.abs(Math.sin((g.now % 1000) / 1000 * PI * 2) * 0.1);
      f = f * 100 / (g.textWidth(this.splash) + 32);
      ctx.scale(f, f);
      // drawn once into its own padded canvas: rotating glyphs straight from the
      // font sheet would pick up stray pixels from the neighbouring cells
      if (!this.splashArt) {
        const c = this.splashArt = document.createElement('canvas');
        const tw = g.textWidth(this.splash);
        c.width = tw + 3; c.height = 11;
        const cg = c.getContext('2d');
        g.font.draw(cg, this.splash, 1, 1, 0xFFFF00, true);
        this.splashX = -Math.floor(tw / 2) - 1;
      }
      ctx.drawImage(this.splashArt, this.splashX, -9);
      ctx.restore();
    }
    g.text('Leoncraft 2', 2, H - 10, WHITE);
    if (Account.session && Account.offline && !Account.checked) g.text("Offline: can't reach the login server", 2, 12, 0xA0A0A0);
    // (logged in or out since this was laid out, while it was on top: laid out again)
    const sig = Account.name + '|' + Account.ready + '|' + Account.offline + '|' + Account.admin;
    if (sig !== this.acctSig && this.gui && this.gui.screen === this) { this.gui._initScreen(this); this.gui.markDirty(); }
    super.render(g, mx, my, dt);
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------ world list ------------------------------ */

class WorldEntry {
  constructor(world) { this.world = world; }
  render(g, list, i, top, left, width, h, mx, my, hovered) {
    const w = this.world;
    g.text(w.name || 'World', left + 35, top + 1, WHITE, false);
    g.text(g.font.trim((w.folder || w.name) + ' (' + fmtDate(w.lastPlayed || w.created) + ')', width - 40), left + 35, top + 12, 0x808080, false);
    // (a hardcore world says so in red, as in the game)
    const modeText = w.hardcore ? '§cHardcore Mode§7' : (MODES[w.mode] || 'Survival') + ' Mode';
    g.text(g.font.trim(modeText + (w.seed !== undefined ? ', Seed: ' + w.seed : ''), width - 40), left + 35, top + 21, 0x808080, false);
    // the world's picture if the game saved one, otherwise a dirt tile
    if (w.icon) {
      if (!this.icon) { this.icon = new Image(); this.icon.onload = () => g.markDirty(); this.icon.src = w.icon; }
      if (this.icon.complete && this.icon.naturalWidth) { g.ctx.imageSmoothingEnabled = true; g.blit(this.icon, 0, 0, this.icon.naturalWidth, this.icon.naturalHeight, left, top, 32, 32); g.ctx.imageSmoothingEnabled = false; }
    } else {
      g.fill(left, top, left + 32, top + 32, 0xFF5B3F2B);
      g.fill(left, top, left + 32, top + 8, 0xFF5E8C32);
      g.fill(left, top + 8, left + 32, top + 10, 0xFF4A7027);
      g.fill(left + 4, top + 16, left + 8, top + 20, 0xFF7A5639);
      g.fill(left + 20, top + 22, left + 24, top + 26, 0xFF46301F);
      g.fill(left + 12, top + 26, left + 14, top + 28, 0xFF7A5639);
    }
    if (hovered || list.selected === this) {
      if (hovered) {
        g.fill(left, top, left + 32, top + 32, 0xA0909090);
        const onIcon = mx - left < 32;
        g.blit('world_selection', 0, onIcon ? 32 : 0, 32, 32, left, top);
      }
    }
  }
  mouseClicked(mx, my, button, list) {
    // a click on the picture plays straight away
    if (button === 0 && mx - list.rowLeft < 32 && list.onActivate) { list.setSelected(this); list.onActivate(this); return true; }
    return false;
  }
}

export class SelectWorldScreen extends Screen {
  constructor() {
    super('Select World');
    this.search = new TextField(0, 22, 200, 20, { maxLength: 64, hint: 'Search...', onChange: () => this.refresh() });
    this.selectedId = null;
  }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.search.x = W / 2 - 100;
    this.add(this.search);
    this.list = this.add(new ScrollList(0, 48, W, H - 112, 36, {
      rowWidth: 270, selectable: true,
      onSelect: e => { this.selectedId = e ? e.world.id : null; this.updateButtons(); },
      onActivate: e => this.play(e.world),
    }));
    this.playB = this.add(new Button(W / 2 - 154, H - 52, 150, 20, 'Play Selected World', () => { const w = this.sel(); if (w) this.play(w); }));
    this.add(new Button(W / 2 + 4, H - 52, 150, 20, 'Create New World', () => g.open(new CreateWorldScreen())));
    this.editB = this.add(new Button(W / 2 - 154, H - 28, 72, 20, 'Edit', () => { const w = this.sel(); if (w) g.open(new EditWorldScreen(w)); }));
    this.delB = this.add(new Button(W / 2 - 76, H - 28, 72, 20, 'Delete', () => {
      const w = this.sel();
      if (!w) return;
      g.open(new ConfirmScreen('Are you sure you want to delete this world?',
        "'" + w.name + "' and everything built in it will be gone for good.", 'Delete', 'Cancel', yes => {
          if (yes) { Worlds.remove(w.id); this.selectedId = null; if (this.hooks.deleteWorld) this.hooks.deleteWorld(w); }
          g.back();
        }));
    }));
    this.reB = this.add(new Button(W / 2 + 4, H - 28, 72, 20, 'Re-Create', () => { const w = this.sel(); if (w) g.open(new CreateWorldScreen({ from: w })); }));
    /* The first Leoncraft's solo world, on this same site, in this browser (lc1/spimport.js): brought over as a new
       world of its own. The search field makes room for the button only when there is one to bring over. */
    if (hasLc1Save()) {
      this.search.x = W / 2 - 154; this.search.w = 150;
      this.lc1B = this.add(new Button(W / 2 + 4, 22, 150, 20, 'Import from Leoncraft 1', () => this.importLc1(),
        'Make a new world from your Leoncraft 1 world: its builds, signs and paintings, its own terrain where you built'));
    }
    this.add(new Button(W / 2 + 82, H - 28, 72, 20, 'Cancel', () => g.back()));
    this.refresh();
  }
  sel() { const e = this.list.selected; return e ? e.world : null; }
  importLc1() {
    if (this.importing) return;
    this.importing = true; this.lc1B.active = false; this.lc1B.message = 'Importing...'; this.gui.markDirty();
    const done = msg => { this.importing = false; if (this.lc1B) { this.lc1B.active = true; this.lc1B.message = 'Import from Leoncraft 1'; } this.gui.markDirty(); if (msg) this.gui.open(new NoticeScreen('Import from Leoncraft 1', msg)); };
    import('../lc1/spimport.js?v=107').then(m => {
      const saves = m.lc1Saves();
      if (!saves.length) return done('There is no Leoncraft 1 world in this browser.');
      return m.importLC1(saves[0].key, Worlds).then(r => {
        this.selectedId = r.entry.id; this.refresh();
        window.__lc2lc1 = r;
        const hang = r.check.importer.length, old = r.check.lc1.length;
        done("'" + r.entry.name + "' is in the list: " + (r.report.cells[0] + r.report.cells[1]) + ' blocks, ' + r.report.signs + ' signs, ' + r.report.paintings + ' paintings.'
          + (old ? ' ' + old + ' things hang on nothing in Leoncraft 1 too.' : '') + (hang ? ' ' + hang + ' things could not be put back as they were.' : ''));
      });
    }).catch(e => { console.error('import from Leoncraft 1', e); done('That Leoncraft 1 world could not be read.'); });
  }
  refresh() {
    const q = this.search.value.trim().toLowerCase();
    const worlds = Worlds.list().sort((a, b) => (b.lastPlayed || b.created || 0) - (a.lastPlayed || a.created || 0));
    this.list.entries = worlds.filter(w => !q || (w.name || '').toLowerCase().includes(q) || (w.folder || '').toLowerCase().includes(q)).map(w => new WorldEntry(w));
    this.list.selected = this.list.entries.find(e => e.world.id === this.selectedId) || null;
    this.list.setScroll(this.list.scroll);
    this.updateButtons();
    this.gui.markDirty();
  }
  updateButtons() {
    const on = !!this.list.selected;
    this.playB.active = this.editB.active = this.delB.active = this.reB.active = on;
  }
  play(w) {
    Worlds.update(w.id, { lastPlayed: Date.now() });
    if (this.hooks.play) this.hooks.play(Worlds.get(w.id) || w, { isNew: false });
  }
  keyPressed(e) {
    if (super.keyPressed(e)) return true;
    const L = this.list, n = L.entries.length;
    if (!n) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      let i = L.entries.indexOf(L.selected);
      i = e.key === 'ArrowDown' ? Math.min(n - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      L.setSelected(L.entries[i]); L.ensureVisible(L.entries[i]);
      return true;
    }
    if (e.key === 'Enter' && L.selected) { this.play(L.selected.world); return true; }
    return false;
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 8, WHITE);
  }
}

/* ------------------------------ create world ------------------------------ */

const DIFFS = ['peaceful', 'easy', 'normal', 'hard'];
const DIFF_NAMES = { peaceful: 'Peaceful', easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const MODE_INFO = {
  survival: 'Gather what you need, craft, and look after your health and hunger',
  creative: 'Every block at hand, free flight, and blocks that break at once',
  hardcore: 'Survival at the hardest difficulty, and only one life',
};

export class CreateWorldScreen extends Screen {
  constructor(opts = {}) {
    super('Create New World');
    const from = opts.from || null;
    this.mode = from ? (from.hardcore ? 'hardcore' : from.mode || 'survival') : 'survival';
    this.difficulty = from ? from.difficulty || 'normal' : 'normal';
    this.cheats = from && from.cheats !== undefined ? !!from.cheats : this.mode === 'creative';
    // a world made again keeps its type (and a Superflat world its layers)
    if (from && from.generator) {
      const fl = /^flat:([^|]*)\|?(.*)$/.exec(from.generator);
      this.worldType = fl ? 'flat' : from.generator === 'classic' ? 'classic' : 'vanilla';
      if (fl) this.flat = { code: fl[1], structures: fl[2] ? fl[2].split(',') : [] };
    }
    this.tab = 0;
    this.nameField = new TextField(0, 0, 208, 20, { value: from ? from.name : 'New World', maxLength: 32, onEnter: () => this.create() });
    this.seedField = new TextField(0, 0, 308, 20, { value: from ? String(from.seed) : '', maxLength: 32, hint: 'Leave blank for a random seed', onEnter: () => this.create() });
  }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.tabs = this.add(new Tabs(['Game', 'World', 'More'], this.tab, i => { this.tab = i; g._blurText(); g._initScreen(this); }));
    this.tabs.layout(W);
    const areaTop = 24, areaBottom = H - 33;
    const place = (contentH) => areaTop + Math.max(0, Math.floor((areaBottom - areaTop - contentH) / 6));
    this.labels = [];
    if (this.tab === 0) {
      const x = Math.floor(W / 2 - 105);
      let y = place(119);
      this.labels.push(['World Name', x + 1, y]);
      this.nameField.x = x + 1; this.nameField.y = y + 14;
      this.add(this.nameField);
      y += 35 + 8;
      this.add(new CycleButton(x, y, 210, 20, 'Game Mode', {
        values: ['survival', 'hardcore', 'creative'], value: this.mode, format: v => MODES[v],
        tooltip: v => MODE_INFO[v], onChange: v => { this.mode = v; this.cheats = v === 'creative'; g._initScreen(this); },
      }));
      y += 28;
      // hardcore: the hardest difficulty, and no commands, both fixed (as in the game)
      const hard = this.mode === 'hardcore';
      const diff = this.add(new CycleButton(x, y, 210, 20, 'Difficulty', {
        values: DIFFS, value: hard ? 'hard' : this.difficulty, format: v => DIFF_NAMES[v], onChange: v => { this.difficulty = v; },
        tooltip: () => 'How hard the world is. Only Peaceful and Normal play differently for now.',
      }));
      if (hard) diff.active = false;
      y += 28;
      const cmd = this.add(new CycleButton(x, y, 210, 20, 'Allow Commands', { values: [false, true], value: hard ? false : this.cheats, format: onOff, onChange: v => { this.cheats = v; } }));
      cmd.tooltip = 'Whether to allow commands like /gamemode, /experience';
      if (hard) cmd.active = false;
    } else if (this.tab === 1) {
      const x = Math.floor(W / 2 - 154);
      let y = place(20 + 8 + 13 + 20 + 8 + 20 + 8 + 20);
      // Default: Minecraft's own worlds from a real seed (js/gen); Superflat: layers and one biome (gen/flat.js, its
      // presets and layers under Customize, ui/flat.js); Classic: the first generator
      const type = this.add(new CycleButton(x, y, 150, 20, 'World Type', { values: ['vanilla', 'flat', 'classic'], value: this.worldType || 'vanilla',
        format: v => v === 'classic' ? 'Classic' : v === 'flat' ? 'Superflat' : 'Default', onChange: v => { this.worldType = v; g._initScreen(this); } }));
      type.tooltip = 'Default builds the same world as Minecraft from the seed; Superflat is flat layers of blocks; Classic is the first Leoncraft generator';
      const cust = this.add(new Button(x + 158, y, 150, 20, 'Customize', () => {
        const f = this.flat || { code: DEFAULT_FLAT.code, structures: DEFAULT_FLAT.structures };
        g.open(new FlatCustomizeScreen(f.code, f.structures, (code, structures) => { this.flat = { code, structures }; }));
      }));
      cust.active = this.worldType === 'flat';
      y += 28;
      this.labels.push(['Seed for the World Generator', x + 1, y, GREY]);
      this.seedField.x = x + 1; this.seedField.y = y + 13; this.seedField.w = 306;
      this.add(this.seedField);
      y += 13 + 20 + 8;
      const gs = this.switchRow(x, y, 'Generate Structures', this.structures !== false, 'Villages, Shipwrecks, etc.');
      gs.active = true; gs.o.onChange = v => { this.structures = v; };
      y += 28;
      const bonus = this.switchRow(x, y, 'Bonus Chest', !!this.bonusChest, 'A chest of things to start with near where you begin');
      bonus.active = true; bonus.o.onChange = v => { this.bonusChest = v; };
    } else {
      const x = Math.floor(W / 2 - 105);
      let y = place(20 * 3 + 8 * 2);
      for (const name of ['Game Rules', 'Experiments', 'Data Packs']) {
        const b = this.add(new Button(x, y, 210, 20, name, null, 'Not in Leoncraft 2 yet'));
        b.active = false;
        y += 28;
      }
    }
    this.add(new Button(W / 2 - 154, H - 27, 150, 20, 'Create New World', () => this.create()));
    this.add(new Button(W / 2 + 4, H - 27, 150, 20, 'Cancel', () => g.back()));
  }
  // a label on the left and a small ON / OFF button on the right, the 1.21 switch row
  switchRow(x, y, label, value, tip) {
    this.labels.push([label, x + 1, y + 6, GREY]);
    const b = this.add(new CycleButton(x + 308 - 44, y, 44, 20, label, { values: [false, true], value, format: onOff, valueOnly: true }));
    b.active = false; b.tooltip = tip;
    return b;
  }
  /* The world this screen would make: Minecraft's seeds (a number that fits
     a long is that long, other text its hash), and for a blank seed the
     random one drawn ahead (main.js nextSeed), so the world being made in
     the background while you choose is the one you get. */
  chosen() {
    // (a Superflat world takes its seed as the first generator does: its structures are placed by it)
    const generator = this.worldType === 'classic' || this.worldType === 'flat' ? 'classic' : 'vanilla', text = this.seedField.value.trim();
    const seed = text ? (generator === 'classic' ? seedFrom(text) : parseSeed(text))
      : this.hooks.nextSeed ? this.hooks.nextSeed(generator) : generator === 'classic' ? seedFrom('') : parseSeed('');
    if (this.worldType === 'flat') { const f = this.flat || DEFAULT_FLAT; return { seed, generator: flatGenerator(f.code, f.structures) }; }
    return { seed, generator };
  }
  // started ahead (main.js prepare) once the seed and type have stayed the same a moment
  prepareAhead() {
    const key = this.worldType + '|' + this.seedField.value.trim() + (this.worldType === 'flat' && this.flat ? '|' + this.flat.code : '');
    if (key === this.preparedKey || !this.hooks.prepare) return;
    this.preparedKey = key;
    clearTimeout(this.prepareT);
    this.prepareT = setTimeout(() => { if (this.gui && this.gui.screen === this) this.hooks.prepare(this.chosen()); }, this.prepareT === undefined ? 0 : 400);
  }
  create() {
    clearTimeout(this.prepareT);
    const name = this.nameField.value.trim() || 'New World';
    const now = Date.now();
    const { seed, generator } = this.chosen();
    const world = {
      id: 'w' + now.toString(36) + (Math.random() * 1e6 | 0).toString(36),
      // made by the vanilla generator from now on, unless Classic is chosen
      name, folder: Worlds.folderName(name),
      seed, generator,
      mode: this.mode === 'hardcore' ? 'survival' : this.mode, difficulty: this.mode === 'hardcore' ? 'hard' : this.difficulty,
      cheats: this.mode === 'hardcore' ? false : this.cheats, created: now, lastPlayed: now,
    };
    if (this.bonusChest) world.bonusChest = true;
    if (this.structures === false) world.structures = false;
    if (this.mode === 'hardcore') world.hardcore = true;
    Worlds.add(world);
    if (this.hooks.play) this.hooks.play(world, { isNew: true });
  }
  render(g, mx, my, dt) {
    const W = this.width, H = this.height;
    this.prepareAhead();
    g.headerSeparator(0, W, 22);
    g.footerSeparator(0, W, H - 35);
    for (const [t, x, y, c] of this.labels) g.text(t, x, y, c || WHITE);
    super.render(g, mx, my, dt);
  }
  keyPressed(e) {
    if (e.ctrlKey && e.key === 'Tab') { this.tab = (this.tab + (e.shiftKey ? 2 : 1)) % 3; this.gui._blurText(); this.gui._initScreen(this); return true; }
    return super.keyPressed(e);
  }
}

export class EditWorldScreen extends Screen {
  constructor(world) {
    super('Edit World');
    this.world = world;
    this.nameField = new TextField(0, 0, 200, 20, { value: world.name, maxLength: 32, onEnter: () => this.save() });
  }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    const x = W / 2 - 100;
    let y = Math.max(28, Math.floor(H / 4) - 8);
    this.top = y;
    this.nameField.x = x; this.nameField.y = y + 13;
    this.add(this.nameField);
    y += 13 + 20 + 12;
    const icon = this.add(new Button(x, y, 200, 20, 'Reset Icon', () => { Worlds.update(this.world.id, { icon: null }); this.world.icon = null; icon.active = false; }));
    icon.active = !!this.world.icon;
    y += 24;
    for (const name of ['Make Backup', 'Optimize World']) { const b = this.add(new Button(x, y, 200, 20, name, null, 'Not in Leoncraft 2 yet')); b.active = false; y += 24; }
    y += 8;
    this.add(new Button(x, y, 98, 20, 'Save', () => this.save()));
    this.add(new Button(x + 102, y, 98, 20, 'Cancel', () => g.back()));
  }
  save() {
    const n = this.nameField.value.trim();
    if (n) Worlds.update(this.world.id, { name: n });
    this.gui.back();
  }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, this.top - 20, WHITE);
    g.text('World Name', this.width / 2 - 100, this.top, GREY);
    super.render(g, mx, my, dt);
  }
}

/* ------------------------------ simple screens ------------------------------ */

/* A question with two answers: the title, the message wrapped below it, and
   the buttons under that (the game's confirm screen). callback(yes). */
export class ConfirmScreen extends Screen {
  constructor(title, message, yes, no, callback) {
    super(title);
    this.message = message; this.yes = yes || 'Yes'; this.no = no || 'No'; this.callback = callback;
  }
  layout() {
    const g = this.gui, W = this.width, H = this.height;
    this.lines = this.message ? g.font.wrap(this.message, W - 50) : [];
    const mh = this.lines.length * 9;
    this.titleTop = Math.max(10, Math.min(80, Math.floor((H - mh) / 2) - 20 - 9));
    this.msgTop = this.titleTop + 20;
    return Math.max(Math.floor(H / 6) + 96, Math.min(H - 24, this.msgTop + mh + 20));
  }
  init() {
    const by = this.layout(), W = this.width;
    this.add(new Button(W / 2 - 155, by, 150, 20, this.yes, () => this.callback(true)));
    this.add(new Button(W / 2 + 5, by, 150, 20, this.no, () => this.callback(false)));
  }
  onEscape() { this.callback(false); }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, this.titleTop, WHITE);
    for (let i = 0; i < this.lines.length; i++) g.centered(this.lines[i], this.width / 2, this.msgTop + i * 9, WHITE);
    super.render(g, mx, my, dt);
  }
}

// a message with one Back button (the multiplayer notice, a bad skin file)
export class NoticeScreen extends ConfirmScreen {
  constructor(title, message, button = 'Back', onDone = null) {
    super(title, message, button, null, null);
    this.onDone = onDone;
  }
  init() {
    const by = this.layout();
    this.add(new Button(this.width / 2 - 100, by, 200, 20, this.yes, () => this.done()));
  }
  done() { if (this.onDone) this.onDone(); else this.gui.back(); }
  onEscape() { this.done(); }
}

// one line of text, nothing to press ("Saving world")
export class MessageScreen extends Screen {
  constructor(title) { super(title); this.closeOnEsc = false; }
  render(g, mx, my, dt) { g.centered(this.title, this.width / 2, 70, WHITE); super.render(g, mx, my, dt); }
}

/* ------------------------------ options ------------------------------ */

const pct = v => Math.round(v * 100) + '%';
const fovLabel = v => v === 70 ? 'FOV: Normal' : v === 110 ? 'FOV: Quake Pro' : 'FOV: ' + v;

function optSlider(o, key, min, max, step, label, extra = {}) {
  return new Slider(0, 0, 150, 20, Object.assign({ min, max, step, value: o.get(key), label, onChange: v => o.set(key, v) }, extra));
}
function optToggle(o, key, label, tip) {
  const b = new CycleButton(0, 0, 150, 20, label, { values: [false, true], value: !!o.get(key), format: onOff, onChange: v => o.set(key, v) });
  if (tip) b.tooltip = tip;
  return b;
}
const off = (w, tip) => { w.active = false; if (tip) w.tooltip = tip; return w; };

export class OptionsScreen extends Screen {
  constructor() { super('Options'); }
  init() {
    const W = this.width, H = this.height, g = this.gui, o = this.options;
    const x0 = Math.floor(W / 2 - 154), x1 = Math.floor(W / 2 + 4);
    const fov = this.add(optSlider(o, 'fov', 30, 110, 1, fovLabel));
    fov.x = x0; fov.y = 29;
    if (g.inGame) {
      this.add(new CycleButton(x1, 29, 150, 20, 'Difficulty', { values: DIFFS, value: o.get('difficulty'), format: v => DIFF_NAMES[v], onChange: v => o.set('difficulty', v) }));
    } else off(this.add(new Button(x1, 29, 150, 20, 'Online...', null)), 'Not available in Leoncraft');
    const y0 = Math.min(61 + 30, H - 33 - 120);
    const items = [
      ['Skin Customization...', () => new SkinCustomizationScreen()],
      ['Music & Sounds...', () => new MusicSoundsScreen()],
      ['Video Settings...', () => new VideoSettingsScreen()],
      ['Controls...', () => new ControlsScreen()],
      ['Language...', () => new LanguageScreen()],
      ['Chat Settings...', null],
      ['Resource Packs...', () => new ResourcePacksScreen()],
      ['Accessibility Settings...', () => new AccessibilitySettingsScreen()],
      ['Telemetry Data...', null],
      ['Credits & Attribution...', () => new CreditsScreen()],
    ];
    items.forEach(([label, make], i) => {
      const b = this.add(new Button(i % 2 ? x1 : x0, y0 + (i >> 1) * 24, 150, 20, label, make ? () => g.open(make()) : null));
      if (!make) off(b, 'Not in Leoncraft 2 yet');
    });
    this.add(new Button(W / 2 - 100, H - 27, 200, 20, 'Done', () => g.back()));
  }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, 12, WHITE);
    super.render(g, mx, my, dt);
  }
}

// Video Settings (the game's own, with the one Shaders button) live in ui/video.js
export { VideoSettingsScreen } from './video.js?v=107';
import { VideoSettingsScreen, shadersButton, fullbrightButton } from './video.js?v=107';
import { minimapButtons } from './minimap.js?v=107';

export class ControlsScreen extends OptionsListScreen {
  constructor() { super('Controls'); }
  rows(list) {
    const g = this.gui, o = this.options;
    list.entries = [
      new WidgetRow(new Button(0, 0, 150, 20, 'Mouse Settings...', () => g.open(new MouseSettingsScreen())),
        new Button(0, 0, 150, 20, 'Key Binds...', () => g.open(new KeyBindsScreen()))),
      new WidgetRow(optToggle(o, 'autoJump', 'Auto-Jump'),
        off(new CycleButton(0, 0, 150, 20, 'Sneak', { values: ['hold'], value: 'hold', format: () => 'Hold' }), 'Hold only for now')),
    ];
  }
}

export class MouseSettingsScreen extends OptionsListScreen {
  constructor() { super('Mouse Settings'); }
  rows(list) {
    const o = this.options;
    const sens = optSlider(o, 'sensitivity', 0, 1, 0.005, v => 'Sensitivity: ' + (v <= 0 ? '*yawn*' : v >= 1 ? 'HYPERSPEED!!!' : Math.round(v * 200) + '%'));
    list.entries = [new WidgetRow(sens, optToggle(o, 'invertY', 'Invert Mouse')), new WidgetRow(optToggle(o, 'rawInput', 'Raw Input'))];
  }
}

/* Key binds: categories, each action's name on the left, the key button
   (75 wide) and Reset (50) on the right. Click a key button, then press a key
   or a mouse button; Escape leaves it unbound. Clashes show in red. */
const BINDS = [
  ['Movement', [['jump', 'Jump'], ['sneak', 'Sneak'], ['sprint', 'Sprint'], ['left', 'Strafe Left'], ['right', 'Strafe Right'], ['back', 'Walk Backwards'], ['forward', 'Walk Forwards']]],
  ['Gameplay', [['attack', 'Attack/Destroy'], ['pickBlock', 'Pick Block'], ['use', 'Use Item/Place Block']]],
  ['Inventory', [['drop', 'Drop Selected Item'], ['swapOffhand', 'Swap Item With Offhand']].concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => ['hotbar' + n, 'Hotbar Slot ' + n]), [['inventory', 'Open/Close Inventory']])],
  ['Miscellaneous', [['advancements', 'Advancements'], ['debug', 'Debug Screen'], ['hideGui', 'Hide GUI'], ['perspective', 'Toggle Perspective']]],
];

class CategoryRow {
  constructor(name) { this.name = name; }
  render(g, list, i, top, left, width, h) { g.centered(this.name, list.x + list.w / 2, top + h - 9 - 1 + 4, WHITE); }
}
// (two keys an action: the main one and a second, so two keys can do the same thing, as G with the left button)
class KeyRow {
  constructor(screen, action, name) {
    this.screen = screen; this.action = action; this.name = name;
    this.change = new Button(0, 0, 60, 20, '', () => { screen.waiting = action; screen.slot = 1; });
    this.change2 = new Button(0, 0, 60, 20, '', () => { screen.waiting = action; screen.slot = 2; });
    this.reset = new Button(0, 0, 36, 20, 'Reset', () => { screen.options.setKey(action, DEFAULT_KEYS[action]); screen.options.setKey2(action, DEFAULT_KEYS2[action] || null); });
    this.children = [this.change, this.change2, this.reset];
  }
  render(g, list, i, top, left, width, h, mx, my) {
    const o = this.screen.options, keys = o.get('keys'), keys2 = o.get('keys2') || {};
    const cx = Math.floor(list.x + list.w / 2);
    this.reset.x = cx + 155 - 36; this.reset.y = top - 2;
    this.change2.x = this.reset.x - 3 - 60; this.change2.y = top - 2;
    this.change.x = this.change2.x - 3 - 60; this.change.y = top - 2;
    const clashes = code => {
      if (!code) return false;
      for (const a in keys) if (a !== this.action && keys[a] === code) return true;
      for (const a in keys2) if (a !== this.action && keys2[a] === code) return true;
      return false;
    };
    let anyClash = false;
    for (const [b, code, slot] of [[this.change, keys[this.action], 1], [this.change2, keys2[this.action] || null, 2]]) {
      const clash = clashes(code), label = slot === 2 && !code ? '-' : keyLabel(code);
      if (this.screen.waiting === this.action && this.screen.slot === slot) b.message = '§e> §f§n' + label + '§r§e <';
      else b.message = clash ? '§c' + label : label;
      if (clash) anyClash = true;
    }
    this.reset.active = keys[this.action] !== DEFAULT_KEYS[this.action] || (keys2[this.action] || null) !== (DEFAULT_KEYS2[this.action] || null);
    g.text(this.name, cx - 155, top + ((h - 8) >> 1), WHITE);
    if (anyClash) g.fill(this.change.x - 6, top - 2, this.change.x - 3, top + 18, 0xFFFF5555);
    this.change.render(g, mx, my);
    this.change2.render(g, mx, my);
    this.reset.render(g, mx, my);
  }
}

export class KeyBindsScreen extends OptionsListScreen {
  constructor() { super('Key Binds'); this.itemHeight = 20; this.waiting = null; }
  rows(list) {
    list.entries = [];
    for (const [cat, acts] of BINDS) {
      list.entries.push(new CategoryRow(cat));
      for (const [a, n] of acts) list.entries.push(new KeyRow(this, a, n));
    }
  }
  footer() {
    const W = this.width, H = this.height, o = this.options;
    this.resetAll = this.add(new Button(W / 2 - 155, H - 27, 150, 20, 'Reset Keys', () => { o.set('keys', Object.assign({}, DEFAULT_KEYS)); o.set('keys2', Object.assign({}, DEFAULT_KEYS2)); this.waiting = null; }));
    this.add(new Button(W / 2 + 5, H - 27, 150, 20, 'Done', () => this.gui.back()));
  }
  bind(code) { if (this.slot === 2) this.options.setKey2(this.waiting, code); else this.options.setKey(this.waiting, code); this.waiting = null; }
  keyPressed(e) {
    if (this.waiting) { this.bind(e.code === 'Escape' ? null : e.code); return true; }
    return super.keyPressed(e);
  }
  mouseClicked(mx, my, button) {
    if (this.waiting) { this.bind('Mouse' + button); return true; }
    return super.mouseClicked(mx, my, button);
  }
  render(g, mx, my, dt) {
    const keys = this.options.get('keys'), keys2 = this.options.get('keys2') || {};
    let changed = false;
    for (const a in DEFAULT_KEYS) if (keys[a] !== DEFAULT_KEYS[a] || (keys2[a] || null) !== (DEFAULT_KEYS2[a] || null)) { changed = true; break; }
    this.resetAll.active = changed;
    super.render(g, mx, my, dt);
  }
}

export class SkinCustomizationScreen extends OptionsListScreen {
  constructor() { super('Skin Customization'); }
  rows(list) {
    const o = this.options, g = this.gui;
    const part = (key, label) => new CycleButton(0, 0, 150, 20, label, { values: [true, false], value: o.get('skinParts')[key] !== false, format: onOff, onChange: v => o.setPart(key, v) });
    const hand = new CycleButton(0, 0, 150, 20, 'Main Hand', { values: ['left', 'right'], value: o.get('mainHand'), format: v => v === 'left' ? 'Left' : 'Right', onChange: v => o.set('mainHand', v) });
    const model = new CycleButton(0, 0, 150, 20, 'Model', { values: ['classic', 'slim'], value: o.get('skinModel'), format: v => v === 'slim' ? 'Slim' : 'Classic', onChange: v => o.set('skinModel', v) });
    model.tooltip = 'Classic arms are 4 pixels wide, slim arms 3.';
    const choose = new Button(0, 0, 150, 20, 'Choose Skin File...', () => this.pick());
    choose.tooltip = 'A 64 x 64 PNG skin, kept in this browser.';
    const reset = new Button(0, 0, 150, 20, 'Reset to Default', () => { o.set('skin', 'default'); o.set('skinModel', 'classic'); o.set('skinName', ''); g._initScreen(this); });
    const gallery = new Button(0, 0, 310, 20, 'Skin Gallery...', () => g.open(new SkinGalleryScreen()));
    gallery.tooltip = 'Skins other players drew and shared, to wear';
    const skins = new Button(0, 0, 150, 20, 'Skins...', () => g.open(new SkinsScreen()), 'Upload, edit or search for a skin, and pick a cape');
    reset.active = o.get('skin') !== 'default';
    list.entries = [
      new WidgetRow(part('hat', 'Hat'), part('jacket', 'Jacket')),
      new WidgetRow(part('leftSleeve', 'Left Sleeve'), part('rightSleeve', 'Right Sleeve')),
      new WidgetRow(part('leftPants', 'Left Pants Leg'), part('rightPants', 'Right Pants Leg')),
      new WidgetRow(part('cape', 'Cape'), skins),
      new WidgetRow(hand, model),
      new WidgetRow(gallery),
      new WidgetRow(choose, reset),
    ];
  }
  pick() {
    const g = this.gui, o = this.options;
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/png';
    inp.onchange = () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          if (img.width === 64 && (img.height === 64 || img.height === 32)) { o.set('skin', r.result); o.set('skinName', ''); g._initScreen(this); g.markDirty(); }
          else g.open(new NoticeScreen('Skin not used', 'A skin has to be a 64 x 64 (or 64 x 32) PNG. That file is ' + img.width + ' x ' + img.height + '.'));
        };
        img.onerror = () => g.open(new NoticeScreen('Skin not used', 'That file could not be read as a PNG picture.'));
        img.src = r.result;
      };
      r.readAsDataURL(f);
    };
    inp.click();
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    const s = this.options.get('skin');
    g.centered(s === 'default' ? 'Skin: Default' : this.options.get('skinName') ? 'Skin: ' + this.options.get('skinName') : 'Skin: Your own file', this.width / 2, 22, GREY);
  }
}

/* Music & Sounds, as the game's: Master Volume across the top, the ten
   category sliders in pairs (OFF at 0%), the output device, Closed Captions
   and Directional Audio, Music Frequency and Music Toast; and Leoncraft's
   one addition, which sounds to play: Leoncraft's own (openly licensed
   recordings) or the player's own Minecraft's, read from their computer
   (js/sound/packs.js). */
const SOUND_SLIDERS = [['music', 'Music'], ['record', 'Jukebox/Note Blocks'], ['weather', 'Weather'], ['block', 'Blocks'],
  ['hostile', 'Hostile Mobs'], ['neutral', 'Friendly Mobs'], ['player', 'Players'], ['ambient', 'Ambient/Environment'], ['voice', 'Voice/Speech'], ['ui', 'UI']];
export class MusicSoundsScreen extends OptionsListScreen {
  constructor() { super('Music & Sound Options'); }
  rows(list) {
    const o = this.options;
    const vol = k => { const v = o.get('soundVolumes') || {}; return typeof v[k] === 'number' ? v[k] : 1; };
    const s = (k, label) => new Slider(0, 0, 150, 20, { min: 0, max: 1, step: 0.01, value: vol(k), label: v => label + ': ' + (v <= 0 ? 'OFF' : pct(v)),
      onChange: v => o.set('soundVolumes', Object.assign({}, o.get('soundVolumes') || {}, { [k]: v })) });
    const rows = [new WidgetRow(s('master', 'Master Volume'))];
    for (let i = 0; i < SOUND_SLIDERS.length; i += 2) rows.push(new WidgetRow(s(...SOUND_SLIDERS[i]), s(...SOUND_SLIDERS[i + 1])));
    rows.push(new WidgetRow(off(new Button(0, 0, 310, 20, 'Device: System Default', null), 'The browser plays through the system\'s own device.')));
    rows.push(new WidgetRow(optToggle(o, 'subtitles', 'Closed Captions', 'Shows a line of text for every sound you hear.'),
      optToggle(o, 'directionalAudio', 'Directional Audio', 'Head-related (HRTF) sound, which places sounds around you. Best with headphones.')));
    const freq = new CycleButton(0, 0, 150, 20, 'Music Frequency', { values: ['default', 'frequent', 'constant'], value: o.get('musicFrequency') || 'default',
      format: v => v === 'frequent' ? 'Frequent' : v === 'constant' ? 'Constant' : 'Default', onChange: v => o.set('musicFrequency', v),
      tooltip: v => v === 'constant' ? 'Music plays one track after another.' : v === 'frequent' ? 'Music plays every 5 to 10 minutes.' : 'Music plays every 10 to 20 minutes.' });
    const toast = new CycleButton(0, 0, 150, 20, 'Music Toast', { values: ['never', 'pause', 'toast'], value: o.get('musicToast') || 'never',
      format: v => v === 'pause' ? 'Pause Menu' : v === 'toast' ? 'Pause Menu and Toast' : 'Never', onChange: v => o.set('musicToast', v),
      tooltip: () => 'Shows the name of the music playing.' });
    rows.push(new WidgetRow(freq, toast));
    rows.push(new WidgetRow(this.packButton()));
    list.entries = rows;
  }
  // which sounds play: Leoncraft's, or your own Minecraft's (picked from your computer, kept in this browser)
  packButton() {
    const P = this.gui.soundPacks;
    const state = P ? P.state : 'leoncraft';
    const label = state === 'minecraft' ? 'Sounds: Your Minecraft' + (P.mc && P.mc.version ? ' (' + P.mc.version + ')' : '')
      : state === 'waiting' ? 'Sounds: Your Minecraft (click anywhere to allow)' : 'Use My Minecraft Sounds...';
    const b = new Button(0, 0, 310, 20, label, () => this.pickPack());
    b.tooltip = state === 'minecraft' ? 'Playing the sounds and music of your own Minecraft, read from your computer. Click to go back to Leoncraft\'s own sounds.'
      : 'Pick your .minecraft folder, and Leoncraft plays your own game\'s exact sounds and music. Nothing is uploaded; only this browser remembers the folder.';
    if (!P || !P.supported) { b.active = false; b.tooltip = 'This browser cannot read a folder from your computer.'; }
    return b;
  }
  pickPack() {
    const P = this.gui.soundPacks, g = this.gui;
    if (!P) return;
    if (P.state === 'minecraft') { P.forget().then(() => g._initScreen(this)); return; }
    P.choose(err => {
      if (err) g.open(new NoticeScreen('Sounds not changed', err));
      else g._initScreen(this);
    });
  }
  render(g, mx, my, dt) {
    // the button follows the packs (the folder opening after a click elsewhere)
    const P = this.gui.soundPacks;
    if (P && this._state !== P.state) { const first = this._state === undefined; this._state = P.state; if (!first) { this.gui._initScreen(this); return; } }
    super.render(g, mx, my, dt);
  }
}

export class AccessibilitySettingsScreen extends OptionsListScreen {
  constructor() { super('Accessibility Settings'); }
  rows(list) {
    const o = this.options;
    const na = 'Not in Leoncraft 2 yet';
    const text = optSlider(o, 'textBgOpacity', 0, 1, 0.01, v => 'Text Background Opacity: ' + pct(v));
    const fe = optSlider(o, 'fovEffects', 0, 1, 0.01, v => 'FOV Effects: ' + (v <= 0 ? 'OFF' : pct(v)));
    const blur = optSlider(o, 'menuBlur', 0, 10, 1, v => 'Menu Background Blur: ' + (v ? v : 'OFF'));
    blur.tooltip = 'Changes the blurriness of menu backgrounds.';
    fe.tooltip = 'Controls how much the field of view can change with gameplay effects.';
    // moved here from Video Settings, as in the game
    const gsp = optSlider(o, 'glintSpeed', 0, 1, 0.01, v => 'Glint Speed: ' + (v <= 0 ? 'OFF' : pct(v)));
    gsp.tooltip = 'Controls how fast the visual glint shimmers across enchanted items.';
    const gst = optSlider(o, 'glintStrength', 0, 1, 0.01, v => 'Glint Strength: ' + (v <= 0 ? 'OFF' : pct(v)));
    gst.tooltip = 'Controls how transparent the visual glint is on enchanted items.';
    const tilt = optSlider(o, 'damageTilt', 0, 1, 0.01, v => 'Damage Tilt: ' + (v <= 0 ? 'OFF' : pct(v)));
    tilt.tooltip = 'The amount of camera shake caused by being hurt.';
    list.entries = [
      new WidgetRow(off(new CycleButton(0, 0, 150, 20, 'Narrator', { values: [false], value: false, format: onOff }), na),
        optToggle(o, 'subtitles', 'Closed Captions', 'Shows a line of text for every sound you hear.')),
      new WidgetRow(text, off(new CycleButton(0, 0, 150, 20, 'High Contrast', { values: [false], value: false, format: onOff }), na)),
      new WidgetRow(optToggle(o, 'autoJump', 'Auto-Jump'), optToggle(o, 'bobbing', 'View Bobbing')),
      new WidgetRow(fe, tilt),
      new WidgetRow(gsp, gst),
      new WidgetRow(optToggle(o, 'hideSplash', 'Hide Splash Texts', 'Hides the yellow line on the title screen.'), blur),
    ];
  }
  footer() {
    const W = this.width, H = this.height;
    off(this.add(new Button(W / 2 - 155, H - 27, 150, 20, 'Accessibility Guide', null)), 'Not in Leoncraft 2 yet');
    this.add(new Button(W / 2 + 5, H - 27, 150, 20, 'Done', () => this.gui.back()));
  }
}

class TextRow {
  constructor(text, colour = WHITE, url = null, centred = true) { this.text = text; this.colour = colour; this.url = url; this.centred = centred; }
  render(g, list, i, top, left, width, h, mx, my, hovered) {
    const cx = list.x + list.w / 2;
    const w = g.textWidth(this.text);
    const x = this.centred ? Math.floor(cx - w / 2) : left;
    const hot = this.url && hovered && mx >= x && mx < x + w;
    g.text(this.text, x, top, this.url ? 0x7FB0FF : this.colour);
    if (hot) g.fill(x, top + 9, x + w, top + 10, 0xFF7FB0FF);
  }
  mouseClicked(mx, my, button) {
    if (this.url && button === 0) { window.open(this.url, '_blank', 'noopener'); return true; }
    return false;
  }
}

export class LanguageScreen extends OptionsListScreen {
  constructor() { super('Language'); this.itemHeight = 18; this.rowWidth = 220; }
  rows(list) {
    list.selectable = true;
    const en = new TextRow('English (US)');
    list.entries = [en];
    list.selected = en;
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    g.centered('(More languages may come later)', this.width / 2, this.height - 33 - 12, 0x808080);
  }
}

const CREDITS = [
  ['Leoncraft 2', 0xFFFF55], ['Made by Leon Zhao.'], [''],
  ['Textures', 0xFFFF55],
  ['Block textures, GUI art and the font:'],
  ['Pixel Perfection by XSSheep, in its Community Edition,'], ['by XSSheep and contributors.'],
  ['github.com/Athemis/PixelPerfectionCE', 0, 'https://github.com/Athemis/PixelPerfectionCE'],
  ['Newer blocks, many items, the leggings and the trim colours:'], ['Pixel Perfection Legacy, by Nova_Wostra.'],
  ['modrinth.com/resourcepack/pixel-perfection-legacy', 0, 'https://modrinth.com/resourcepack/pixel-perfection-legacy'],
  ['Items, armour and many blocks: REFI Textures, by MysticTempest,'], ['and Bauniclonia, by Mirtilo.'],
  ['github.com/MysticTempest/REFI_Textures', 0, 'https://github.com/MysticTempest/REFI_Textures'],
  ['codeberg.org/mirtilo/Bauniclonia', 0, 'https://codeberg.org/mirtilo/Bauniclonia'],
  ['A few items: Pixel ImPerfection, by bramaudi, and Refined Textures, by awuuwa.'],
  ['codeberg.org/mineclonia/pixel_imperfection', 0, 'https://codeberg.org/mineclonia/pixel_imperfection'],
  ['content.luanti.org/packages/awuuwa/refined_textures', 0, 'https://content.luanti.org/packages/awuuwa/refined_textures/'],
  ['All six are licensed CC BY-SA 4.0:'],
  ['creativecommons.org/licenses/by-sa/4.0', 0, 'https://creativecommons.org/licenses/by-sa/4.0/'],
  ['Leoncraft packs, recolours and extends them, and shares'], ['those changes under the same licence.'],
  ['The title logo is drawn from the pack\'s stone texture.'], [''],
  ['@sounds'],
  ['@paintings'],
  ['@skins'],
  ['Maps', 0xFFFF55],
  ['Leonpixel\'s Prop Hunt map, Hillside: from "Hide and Seek Minigame"'], ['by Tert, GNU GPL version 3 (joined, cut and changed for the game).'],
  ['curseforge.com/minecraft/worlds/hide-and-seek-minigame', 0, 'https://www.curseforge.com/minecraft/worlds/hide-and-seek-minigame'],
  ['gnu.org/licenses/gpl-3.0', 0, 'https://www.gnu.org/licenses/gpl-3.0.html'],
  ['Leonpixel\'s maps from CurseForge, cut and converted for the game:'],
  ['Prop Hunt: Frost, End, Nether and Desert Arena, from "Prop Hunt: 4'], ['Themed Arena" by seaboiii, Public Domain.'],
  ['Murder Mystery: Bread Hotel, from "Murder Mystery Hotel" by'], ['bread4tabread (MIT); Botello Manor, from "SoS: The Botello Manor"'],
  ['by GreatOrator (MIT); Modern House, from "Ultra Modern House" by'], ['JobKay (Public Domain); Houseville, by noxgame1230 (ISC).'],
  ['The lobby, from "Floating Island Server Spawn" by mrmagicblox'], ['(Public Domain), with our own sign and pedestals.'],
  ['Bed Wars and SkyWars maps by the NetherGames Network (CC BY 4.0), cut'], ['and converted for the game, our own waiting room over each:'],
  ['Bed Wars: Amarris, Utopia (Chr7st, epicniklas10 & SrySkillaura), Castaway'], ['(CloudySheets & LargeKnome), Sandy, Oblivion (iPyro15), Fungal (Pwetster),'],
  ['Harmony (LargeKnome), Elementar, Giants, Cytree and Town. SkyWars:'], ['Lighthouse and Pollution (JangoMango), Saga (Epicniklas10), Morass'],
  ['(Bdoggy617), Seafloor, Scaffolds and Buried (Prop11th), Toys, Town, Narra'], ['(TheLaoring). NetherGames does not endorse Leonpixel.'],
  ['github.com/NetherGamesMC/assets', 0, 'https://github.com/NetherGamesMC/assets'],
  ['creativecommons.org/licenses/by/4.0', 0, 'https://creativecommons.org/licenses/by/4.0/'],
  ['Meccha Chameleon plays on the first Leoncraft’s Mecha maps (Purpular, Fortress and Classroom by carver and Leon, the rest by Leon).'],
  ['The rest of Leonpixel\'s maps are our own.'], [''],
  ['Code', 0xFFFF55],
  ['three.js, MIT License'],
  ['threejs.org', 0, 'https://threejs.org/'],
  ['Player model: skinview3d, MIT License'],
  ['github.com/bs-community/skinview3d', 0, 'https://github.com/bs-community/skinview3d'],
  ['Block list and hardness: minecraft-data, MIT License'],
  ['github.com/PrismarineJS/minecraft-data', 0, 'https://github.com/PrismarineJS/minecraft-data'],
  ['RIP Computer\'s wind, plants pushed aside and puddles: after Photon Shaders by SixthSurge, under the Photon Shaders License (shaders/PHOTON-LICENSE.txt).'],
  ['github.com/sixthsurge/photon', 0, 'https://github.com/sixthsurge/photon'],
  ['The player skin, the grey buttons, the effect pictures, the frost'], ['and a few textures are original drawings.'],
  ['The capes in the Capes menu are our own, drawn in code.'],
  ['Everything else: written for Leoncraft by Leon Zhao.'], [''],
  ['Not an official Minecraft product.', 0xA0A0A0],
  ['Not approved by or associated with Mojang or Microsoft.', 0xA0A0A0],
];

// the famous paintings every painting shows (js/paintingdata.js, written by tools/leoncraft2/build_paintings.py)
function paintingCredits() {
  const out = [['Paintings', 0xFFFF55], ['Every painting shows a famous painting in the public domain, photographed, from Wikimedia Commons (each marked public domain there), cropped to the game\'s sizes for its paintings:']];
  for (const [title, by, year] of Object.values(PAINTING_ART)) out.push([title + ', ' + by + ' (' + year + ')']);
  out.push(['Where each picture came from: textures/PAINTINGS.txt.']);
  out.push(['commons.wikimedia.org', 0, 'https://commons.wikimedia.org/']);
  out.push(['']);
  return out;
}
// the recordings Leoncraft's own sounds and music are made from (js/sound/credits.js, written by tools/leoncraft2/build_sounds.py)
function soundCredits() {
  const out = [['Sounds and Music', 0xFFFF55], ['Made from these openly licensed recordings (cut, pitched and levelled for the game):']];
  for (const [title, by, lic, page] of SOUND_CREDITS) {
    out.push(['"' + title + '" by ' + by + ', ' + lic]);
    out.push([page.replace(/^https?:\/\//, '').replace(/%E2%80%93/g, '-').slice(0, 60), 0, page]);
  }
  out.push(['CC0: creativecommons.org/publicdomain/zero/1.0', 0, 'https://creativecommons.org/publicdomain/zero/1.0/']);
  out.push(['CC BY 3.0: creativecommons.org/licenses/by/3.0', 0, 'https://creativecommons.org/licenses/by/3.0/']);
  out.push(['The note block\'s instruments are made by Leoncraft\'s own sound script.']);
  out.push(['With "Use My Minecraft Sounds" your own game\'s sounds play, read from your computer.']);
  out.push(['']);
  return out;
}
/* Which mobs wear the skins of the packs in use, and which keep Leoncraft's own: a model of ours built differently
   from the game's keeps its picture rather than wear one cut for another shape (entities/packart.js). */
export class MobSkinsScreen extends OptionsListScreen {
  constructor() { super('Mob Skins'); this.itemHeight = 12; this.rowWidth = 300; }
  rows(list) {
    list.entries = [];
    const g = this.gui, s = packArtSummary(), W = Math.min(300, this.width - 20);
    const say = (t, c) => { for (const line of g.font.wrap(t, W)) list.entries.push(new TextRow(line, c || WHITE, null)); };
    const names = a => a.map(n => n.replace(/_/g, ' ')).join(', ');
    if (!s) { say('No resource pack is in use: every mob wears Leoncraft\'s own skin.', 0xA0A0A0); return; }
    say('From your packs (' + s.took.length + ')', 0xFFFF55);
    say(s.took.length ? names(s.took) : 'none');
    say('');
    say('Kept as Leoncraft draws them (' + s.kept.length + ')', 0xFFFF55);
    say('These are shaped differently here than in the game, or the packs have no picture for them, so they keep their own skin.', 0xA0A0A0);
    say(s.kept.length ? names(s.kept) : 'none');
  }
}

export class CreditsScreen extends OptionsListScreen {
  constructor() { super('Credits & Attribution'); this.itemHeight = 12; this.rowWidth = 300; }
  rows(list) {
    list.entries = [];
    const g = this.gui;
    for (const [t, c, url] of CREDITS) {
      if (t === '@skins') { for (const r of skinCredits()) for (const line of r[2] ? [r[0]] : g.font.wrap(r[0], Math.min(300, this.width - 20))) list.entries.push(new TextRow(line, r[1] || WHITE, r[2] || null)); continue; }
      if (t === '@paintings') { for (const r of paintingCredits()) for (const line of r[2] ? [r[0]] : g.font.wrap(r[0], Math.min(300, this.width - 20))) list.entries.push(new TextRow(line, r[1] || WHITE, r[2] || null)); continue; }
      if (t === '@sounds') { for (const r of soundCredits()) for (const line of r[2] ? [r[0]] : g.font.wrap(r[0], Math.min(300, this.width - 20))) list.entries.push(new TextRow(line, r[1] || WHITE, r[2] || null)); continue; }
      for (const line of url ? [t] : g.font.wrap(t, Math.min(300, this.width - 20))) list.entries.push(new TextRow(line, c || WHITE, url || null));
    }
  }
}

/* ------------------------------ resource packs ------------------------------
   The game's Select Resource Packs screen: Available on the left, Selected
   (top wins) on the right, Open Pack Folder and Done below. Here the packs
   come from the player's own computer (a resource pack .zip, or their own
   Minecraft .jar for the original look) and stay in this browser; see
   pack.js. Done reloads, as the game reloads its resources. */
class PackEntry {
  constructor(pack, side, screen) { this.pack = pack; this.side = side; this.screen = screen; }
  render(g, list, i, top, left, width, h, mx, my, hovered) {
    const p = this.pack, s = this.screen;
    const icon = s.icons.get(p.id);
    if (icon) { g.ctx.imageSmoothingEnabled = true; g.blit(icon, 0, 0, icon.width, icon.height, left, top, 32, 32); g.ctx.imageSmoothingEnabled = false; }
    else { g.fill(left, top, left + 32, top + 32, 0xFF3A3A3A); g.centered('?', left + 16, top + 12, 0xA0A0A0); }
    g.text(g.font.trim(p.name, width - 44), left + 35, top + 1, p.builtin ? 0xA0A0A0 : WHITE, false);
    const lines = g.font.wrap(p.desc || (p.builtin ? 'Leoncraft\'s own textures (CC BY-SA)' : ''), width - 44).slice(0, 2);
    lines.forEach((l, k) => g.text(l, left + 35, top + 12 + k * 9, 0x808080, false));
    if (!hovered || p.builtin) return;
    // the arrows over the picture, as in the game
    g.fill(left, top, left + 32, top + 32, 0xA0909090);
    const lx = mx - left, ly = my - top;
    const arrow = (txt, x, y, on) => g.text(txt, x, y, on ? 0xFFFFA0 : WHITE);
    if (this.side === 'available') arrow('>', left + 13, top + 12, lx < 32);
    else {
      arrow('<', left + 4, top + 12, lx < 16);
      const k = s.selected.indexOf(p);
      if (k > 0) arrow('^', left + 20, top + 3, lx >= 16 && ly < 16);
      if (k < s.selected.length - 1) arrow('v', left + 20, top + 19, lx >= 16 && ly >= 16);
    }
    if (this.side === 'available') g.text('x', left + width - 10, top + 1, mx > left + width - 14 && my < top + 10 ? 0xFF5555 : 0x808080, false);
  }
  mouseClicked(mx, my, button, list) {
    if (button !== 0 || this.pack.builtin) return true;
    const i = list.entries.indexOf(this), top = list.rowTop(i), left = list.rowLeft;
    const lx = mx - left, ly = my - top, s = this.screen;
    if (this.side === 'available') {
      if (mx > left + list.rowWidth - 14 && ly < 10) { s.forget(this.pack); return true; }
      s.move(this.pack, true);
      return true;
    }
    if (lx < 16 && lx >= 0) s.move(this.pack, false);
    else if (lx < 32 && ly < 16) s.shift(this.pack, -1);
    else if (lx < 32) s.shift(this.pack, 1);
    return true;
  }
}

export class ResourcePacksScreen extends Screen {
  constructor() {
    super('Select Resource Packs');
    this.icons = new Map();
    this.changed = false;
    this.packs = Packs.list();
    this.message = '';
  }
  get selected() { return this.packs.filter(p => p.enabled); }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    this.left = this.add(new ScrollList(W / 2 - 204, 48, 200, H - 48 - 82, 36, { rowWidth: 200 - 22 }));
    this.right = this.add(new ScrollList(W / 2 + 4, 48, 200, H - 48 - 82, 36, { rowWidth: 200 - 22 }));
    // the game's own look, from the player's own copy of it (see useGameFiles), and which mobs took it
    this.add(new Button(W / 2 - 154, H - 72, 202, 20, 'Use My Minecraft Files...', () => this.useGameFiles()));
    this.add(new Button(W / 2 + 52, H - 72, 102, 20, 'Mob Skins...', () => g.open(new MobSkinsScreen())));
    this.add(new Button(W / 2 - 154, H - 48, 150, 20, 'Open Pack Folder', () => this.pick()));
    this.add(new Button(W / 2 + 4, H - 48, 150, 20, 'Done', () => this.done()));
    this.refresh();
    for (const p of this.packs) if (!this.icons.has(p.id)) { this.icons.set(p.id, null); Packs.icon(p.id).then(i => { if (i) { this.icons.set(p.id, i); g.markDirty(); } }); }
    // files dropped on the window are added too
    if (!this.onDrop) {
      this.onDragOver = e => { e.preventDefault(); };
      this.onDrop = e => { e.preventDefault(); this.addFiles([...(e.dataTransfer && e.dataTransfer.files || [])]); };
      window.addEventListener('dragover', this.onDragOver);
      window.addEventListener('drop', this.onDrop);
    }
  }
  onClose() {
    if (this.onDrop) { window.removeEventListener('dragover', this.onDragOver); window.removeEventListener('drop', this.onDrop); this.onDrop = null; }
  }
  refresh() {
    const sel = this.selected, avail = this.packs.filter(p => !p.enabled);
    this.left.entries = avail.map(p => new PackEntry(p, 'available', this));
    this.right.entries = sel.map(p => new PackEntry(p, 'selected', this))
      .concat([new PackEntry({ id: 'builtin', name: 'Default', desc: 'Leoncraft\'s own art, CC BY-SA', builtin: true }, 'selected', this)]);
    this.gui.markDirty();
  }
  save() { Packs.save(this.packs); this.changed = true; this.refresh(); }
  move(p, on) {
    p.enabled = on;
    // a pack switched on goes to the top
    if (on) { this.packs.splice(this.packs.indexOf(p), 1); this.packs.unshift(p); }
    this.save();
  }
  shift(p, d) {
    const sel = this.selected, k = sel.indexOf(p), other = sel[k + d];
    if (!other) return;
    const a = this.packs.indexOf(p), b = this.packs.indexOf(other);
    this.packs[a] = other; this.packs[b] = p;
    this.save();
  }
  forget(p) {
    this.gui.open(new ConfirmScreen('Remove this pack from Leoncraft?', "'" + p.name + "' will be deleted from this browser (not from your computer).", 'Remove', 'Cancel', async yes => {
      if (yes) { await Packs.remove(p.id); this.packs = Packs.list(); this.changed = true; }
      this.gui.back();
    }));
  }
  pick(accept) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept || '.zip,.jar'; inp.multiple = !accept;
    inp.onchange = () => this.addFiles([...inp.files]);
    inp.click();
  }
  /* Leoncraft ships only openly licensed art; the game's own textures, paintings, mobs and screens can only
     come from the player's own copy of the game. Its client .jar is read like any pack (pack.js) and goes to
     the top of the Selected list. */
  useGameFiles() {
    this.gui.open(new ConfirmScreen('Use My Minecraft Files',
      'Leoncraft comes with openly licensed art of its own. To see the game\'s original look (its blocks, items, ' +
      'paintings, mobs, chests, beds and screens), choose the game file from your own copy of Minecraft: Java Edition.\n\n' +
      'It is in your .minecraft folder, under versions, for example versions/26.1.2/26.1.2.jar ' +
      '(on Windows, %APPDATA%\\.minecraft\\versions).\n\n' +
      'The file is read here and kept in this browser on this computer. It is never uploaded, and you can remove it on this screen at any time.',
      'Choose .jar File...', 'Cancel', yes => {
        // (the file dialog has to open from the click itself)
        if (yes) this.pick('.jar');
        this.gui.back();
      }));
  }
  async addFiles(files) {
    for (const f of files) {
      if (!/\.(zip|jar)$/i.test(f.name)) { this.message = f.name + ' is not a .zip or .jar'; continue; }
      this.message = 'Reading ' + f.name + '...';
      this.gui.markDirty();
      try { const id = await Packs.add(f); this.message = f.name + ' added'; this.changed = true; Packs.icon(id).then(i => { if (i) { this.icons.set(id, i); this.gui.markDirty(); } }); }
      catch (e) { this.message = e.message || 'That file could not be read'; }
    }
    this.packs = Packs.list();
    this.refresh();
  }
  done() {
    if (this.changed && this.hooks.reloadResources) this.hooks.reloadResources();
    else this.gui.back();
  }
  onEscape() { this.done(); return true; }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    const W = this.width;
    g.centered(this.title, W / 2, 8, WHITE);
    g.centered(this.message || 'Drag and drop files into this window to add packs', W / 2, 20, 0xA0A0A0);
    g.centered('§l§nAvailable', W / 2 - 104, 38, WHITE);
    g.centered('§l§nSelected', W / 2 + 104, 38, WHITE);
    g.centered('Packs stay on this computer and are never uploaded.', W / 2, this.height - 20, 0x808080);
  }
}

/* ------------------------------ in game ------------------------------ */

/* The pause menu: a 212-wide grid a quarter of the way down, Save and Quit
   across both columns, 98-wide pairs above it. The top pair is Back to Game
   and our one extra, the Shaders button from Video Settings (it takes effect
   at once, behind the menu). Under it a pair of our own, as mods add them:
   Fullbright, and the Minimap with its settings ("...") beside it. */
export class PauseScreen extends Screen {
  constructor() { super('Game Menu'); this.background = 'world'; this.openedAt = performance.now(); }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    const top = Math.floor((H - 190) * 0.25);
    const xl = Math.floor(W / 2 - 102), xr = Math.floor(W / 2 + 4);
    this.add(new Button(xl, top + 50, 98, 20, 'Back to Game', () => this.resume()));
    this.add(shadersButton(xr, top + 50, 98, this.options));
    this.add(fullbrightButton(xl, top + 74, 98, this.options));
    for (const b of minimapButtons(xr, top + 74, 98, this.options, g)) this.add(b);
    const row = (y, a, b) => {
      for (const [x, [label, fn]] of [[xl, a], [xr, b]]) {
        const btn = this.add(new Button(x, y, 98, 20, label, fn));
        if (!fn) off(btn, 'Not in Leoncraft 2 yet');
      }
    };
    row(top + 98, ['Advancements', this.hooks.advancements ? () => this.hooks.advancements() : null], ['Statistics', this.hooks.statistics ? () => this.hooks.statistics() : null]);
    row(top + 122, ['Send Feedback', null], ['Report Bugs', null]);
    // Open to LAN (ui/lan.js): greyed out once the world is open; on a server the game has Player Reporting there
    const lan = this.hooks.lan && this.hooks.lan();
    const online = !!(this.hooks.online && this.hooks.online());
    row(top + 146, ['Options...', () => g.open(new OptionsScreen())], online ? ['Player Reporting', null] : ['Open to LAN', lan && !lan.open ? () => g.open(new LanScreen()) : null]);
    if (lan && lan.open && !online) this.widgets[this.widgets.length - 1].tooltip = '';
    // on a server it is Disconnect, as in the game
    this.add(new Button(xl, top + 170, 204, 20, online ? 'Disconnect' : 'Save and Quit to Title', () => { if (this.hooks.quitToTitle) this.hooks.quitToTitle(); }));
  }
  resume() { this.gui.closeAll(); if (this.hooks.resume) this.hooks.resume(); }
  // the Esc that let the mouse go (and so opened this menu) must not close it again at once
  // (and Esc stays in the menu when the browser would not give the mouse back for a key: main.js keyMayLock)
  onEscape() { if (performance.now() - this.openedAt > 400 && (!this.hooks.keyResumes || this.hooks.keyResumes())) this.resume(); }
  render(g, mx, my, dt) {
    g.centered(this.title, this.width / 2, 40, WHITE);
    super.render(g, mx, my, dt);
  }
}

// the world-loading screen's chunk colours, empty to done
export const CHUNK_COLOURS = [0x545454, 0x999999, 0x80B252, 0xD1D1D1, 0x726809, 0x21C600, 0xFFE0A0, 0xFFFFFF];

/* World loading: the percentage over a grid of chunk squares, each coloured
   by how far along it is (state 0 empty ... 7 done, or an 0xRRGGBB colour). */
export class LoadingScreen extends Screen {
  constructor(text = 'Loading terrain...') {
    super(text);
    this.animates = true;
    this.closeOnEsc = false;
  }
  render(g, mx, my, dt) {
    const p = (this.hooks.loadingProgress && this.hooks.loadingProgress()) || {};
    const cx = Math.floor(this.width / 2), cy = Math.floor(this.height / 2);
    const prog = Math.max(0, Math.min(1, p.progress || 0));
    g.centered(p.text || this.title, cx, cy - 4 - 30 - 12, WHITE);
    g.centered(Math.floor(prog * 100) + '%', cx, cy - 4 - 30, WHITE);
    const ch = p.chunks;
    if (ch && ch.length) {
      let r = 0;
      for (let i = 0; i < ch.length; i++) r = Math.max(r, Math.abs(ch[i][0]), Math.abs(ch[i][1]));
      const size = (2 * r + 1) * 2, x0 = cx - (size >> 1), y0 = cy + 30 - (size >> 1);
      g.fill(x0 - 1, y0 - 1, x0 + size + 1, y0 + size + 1, 0xFF000000);
      const ctx = g.ctx;
      for (let i = 0; i < ch.length; i++) {
        const c = ch[i], s = c[2];
        const rgb = s > 255 ? s : CHUNK_COLOURS[Math.max(0, Math.min(CHUNK_COLOURS.length - 1, s | 0))];
        ctx.fillStyle = '#' + rgb.toString(16).padStart(6, '0');
        ctx.fillRect(x0 + (c[0] + r) * 2, y0 + (c[1] + r) * 2, 2, 2);
      }
    } else {
      // no chunk list: a plain bar
      g.fill(cx - 50, cy + 28, cx + 50, cy + 30, 0xFF808080);
      g.fill(cx - 50, cy + 28, cx - 50 + Math.round(100 * prog), cy + 30, 0xFF80FF80);
    }
    super.render(g, mx, my, dt);
  }
}

export class DeathScreen extends Screen {
  constructor(opts = {}) {
    // hardcore worlds end here
    super(opts.hardcore ? 'Game Over!' : 'You Died!');
    this.background = 'death';
    this.closeOnEsc = false;
    this.cause = opts.message || '';
    this.score = opts.score || 0;
    this.t0 = -1;
    this.animates = true;
  }
  init() {
    const W = this.width, H = this.height, g = this.gui;
    const hc = this.title === 'Game Over!';
    this.buttons = [
      // (in hardcore there is no coming back: only watching)
      hc ? this.add(new Button(W / 2 - 100, Math.floor(H / 4) + 72, 200, 20, 'Spectate World', () => { g.closeAll(); if (this.hooks.spectate) this.hooks.spectate(); }))
        : this.add(new Button(W / 2 - 100, Math.floor(H / 4) + 72, 200, 20, 'Respawn', () => { g.closeAll(); if (this.hooks.respawn) this.hooks.respawn(); })),
      this.add(new Button(W / 2 - 100, Math.floor(H / 4) + 96, 200, 20, 'Title Screen', () => { if (this.hooks.quitToTitle) this.hooks.quitToTitle(); })),
    ];
    for (const b of this.buttons) b.active = this.t0 >= 0 && this.gui.now - this.t0 >= 1000;
  }
  render(g, mx, my, dt) {
    if (this.t0 < 0) this.t0 = g.now;
    // the buttons wake after a second, as in the game, so a held click does not respawn by accident
    if (this.animates && g.now - this.t0 >= 1000) { for (const b of this.buttons) b.active = true; this.animates = false; }
    const ctx = g.ctx;
    ctx.save(); ctx.scale(2, 2);
    g.centered(this.title, this.width / 4, 30, WHITE);
    ctx.restore();
    if (this.cause) g.centered(this.cause, this.width / 2, 85, WHITE);
    g.centered('Score: §e' + this.score, this.width / 2, 100, WHITE);
    super.render(g, mx, my, dt);
  }
}
