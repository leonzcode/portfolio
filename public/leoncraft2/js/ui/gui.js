/* ---------------------------------------------------------------------------
   Leoncraft 2 - the GUI framework.

   One full-window 2D canvas (#gui) sits over the WebGL canvas. It is sized in
   device pixels and drawn at the classic block-game GUI scale:

     scale = max(1, min(floor(W / 320), floor(H / 240)))   (W, H in device px)

   capped by the GUI Scale option (0 = Auto). Everything else works in GUI
   pixels (W / scale by H / scale), nearest-neighbour, so a 1-pixel line is
   always a whole number of screen pixels. The canvas is redrawn only when
   something changed: a click, a hover, a resize, a screen or HUD that says it
   animates, or the text caret blinking.

   Using it:

     const gui = new Gui(document.getElementById('gui'), {
       base: new URL('../../textures/gui/', import.meta.url).href,
       options: new Options(),
       hooks: { play, quitToTitle, resume, respawn, loadingProgress, quit },
     });
     await gui.load();
     gui.open(new TitleScreen());        // screens live in menus.js
     // every animation frame:
     gui.frame(performance.now());

   gui.open(screen) pushes a screen, gui.back() returns to the one under it
   (closing the GUI when none is left), gui.closeAll() clears them all,
   gui.replace(screen) swaps the top one. gui.screen is the open screen.
   gui.isOpen() / gui.wantsPointer() say whether menus own the mouse; the
   canvas only takes pointer events while a screen is open.

   State the game sets: gui.inGame (a world is running: menus darken and blur
   the world instead of the title panorama), gui.panorama (the game draws a
   view behind the title screen; false falls back to the tiled background),
   gui.lowEnd (no CSS blur), gui.hideHud (F1), gui.hud = { draw(g),
   animates?, isDirty?() } drawn under any screen while in game, and
   gui.overlays = [{ draw(g), animates? }] drawn over everything (or,
   with under: true, with the HUD, under any screen).

   Drawing helpers (g is the Gui itself, in GUI pixels):
     g.blit(sheet, sx, sy, sw, sh, dx, dy, dw?, dh?)   sheet = name or image
     g.text(str, x, y, rgb = 0xFFFFFF, shadow = true)  -> x after the text
     g.textWidth(str), g.centered(str, cx, y, rgb, shadow = true)
     g.fill(x0, y0, x1, y1, argb), g.gradient(x0, y0, x1, y1, topArgb, bottomArgb)
     g.tooltip(lines, x, y), g.setTooltip(lines) (drawn after the screen)
     g.sheet(name) -> image or null while it loads (names like 'widgets' or
     'container/inventory'), g.scissor(x0, y0, x1, y1) / g.endScissor(),
     g.button(x, y, w, h, state 0 disabled / 1 normal / 2 hover), g.font, g.ctx.

   Art: Pixel Perfection CE's GUI sheets (CC BY-SA 4.0), copied into
   textures/gui/. The pack leaves button interiors see-through, so a
   translucent fill goes under them for legible text over the world.
--------------------------------------------------------------------------- */
import { Font, cssRGB } from './font.js?v=107';

/* ------------------------------ options ------------------------------ */

export const DEFAULT_KEYS = {
  forward: 'KeyW', left: 'KeyA', back: 'KeyS', right: 'KeyD',
  jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  attack: 'Mouse0', use: 'Mouse2', pickBlock: 'Mouse1',
  inventory: 'KeyE', drop: 'KeyQ', perspective: 'F5', swapOffhand: 'KeyF',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3', hotbar4: 'Digit4', hotbar5: 'Digit5',
  hotbar6: 'Digit6', hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
  hideGui: 'F1', debug: 'F3', advancements: 'KeyL',
};

// a second key for any action (the Key Binds screen's second column): G breaks and H places, as the mouse's buttons do
export const DEFAULT_KEYS2 = { attack: 'KeyG', use: 'KeyH' };

export const DEFAULT_OPTIONS = {
  fov: 70,                 // degrees, 30-110
  sensitivity: 0.5,        // 0-1, 0.5 shows as 100%
  invertY: false,
  rawInput: true,          // the mouse's own movement while it is held, no pointer acceleration (the game's Raw Input)
  autoJump: false,
  // Video Settings, as the game's own (ui/video.js). The Preset sets the Quality & Performance ones.
  graphicsPreset: 'fancy', // fast fancy fabulous custom
  deviceTuned: false,      // a Chromebook or other small machine was put on Fast once (Options.tuneForDevice)
  renderDistance: 16,      // chunks, 2-32
  simulationDistance: 12,  // chunks, 5-32
  chunkBuilder: 'semi',    // threaded semi full
  smoothLighting: true,
  biomeBlend: 2,           // 0 (OFF) to 7 (15 x 15)
  particles: 'all',        // all decreased minimal
  mipmapLevels: 4,         // 0-4
  entityShadows: true,
  entityDistance: 1,       // 0.5-5
  cloudDistance: 64,       // chunks, 2-128
  cutoutLeaves: true,      // See-Through Leaves
  improvedTransparency: false,
  textureFiltering: 'rgss', // none rgss anisotropic
  maxAnisotropy: 2,        // 2 4 8
  weatherRadius: 10,       // blocks, 3-10
  vsync: true,
  inactivityFpsLimit: 'afk', // afk minimized
  autosaveIndicator: true,
  vignette: true,
  attackIndicator: 'crosshair', // off crosshair hotbar
  chunkFade: 0.75,         // seconds, 0-1
  glintSpeed: 0.5,         // 0-1
  glintStrength: 0.75,     // 0-1
  damageTilt: 1,           // 0-1
  // Shaders, the one extra button in Video Settings (ui/video.js, render/looks.js): off low medium high rip
  shaderLevel: 'off',
  // the shader settings from before that button, read once to carry a choice made then over (carryShaders)
  shaders: null,           // true, false, or null (never chosen: on, the old default)
  shaderPreset: 'medium',  // low medium high ultra custom
  shader: {},              // what differed from the preset
  quality: 'auto',         // the old Graphics setting (Detailed / Fast): read once, to carry it over
  renderScale: 'auto',     // 'auto' or 0.4-1
  guiScale: 0,             // 0 = auto
  brightness: 0.5,         // 0 moody - 1 bright
  // Fullbright (the game menu and Video Settings, as the Fullbright mods: caves and night lit as by day; settings.js)
  fullbright: false,
  // the minimap (ui/minimap.js, after Xaero's Minimap's defaults): on/off, its size, zoom, Lock North,
  // the coordinates under it, the entity radar, cave mode (auto/off), the biome line and its lighting
  minimap: false,
  minimapSize: 'auto',     // 'auto' or the mod's units across (70 - 250)
  minimapZoom: 1,          // 1 - 6, the mod's zoom: half a unit a block at 1
  minimapNorth: false,
  minimapCoords: true,
  minimapEntities: true,
  minimapCave: 'auto',     // auto (a 3x3 ceiling) or off
  minimapBiome: false,
  minimapLighting: true,
  bobbing: true,
  clouds: 'fancy',         // fancy fast off
  menuBlur: 5,             // 0-10
  fovEffects: 1,           // 0-1
  maxFps: 120,             // 0 = unlimited
  difficulty: 'normal',
  textBgOpacity: 0.5,
  hideSplash: false,
  mainHand: 'right',
  advancedTooltips: false, // F3 + H: durability and the item's id under its name
  skin: 'default',         // or a 64 x 64 PNG data URL
  skinModel: 'classic',    // classic slim
  skinName: '',            // the Skin Gallery's name for the skin in use ('' for the default or a file of your own)
  skinParts: { hat: true, jacket: true, leftSleeve: true, rightSleeve: true, leftPants: true, rightPants: true, cape: true },
  cape: '',                // a 64 x 32 PNG data URL of the cape worn, or '' for none
  capeName: '',            // its name (one of ours, a player's from a username search, or '' for one of your own)
  keys: DEFAULT_KEYS,
  keys2: DEFAULT_KEYS2,
  // Music & Sounds (js/sound): each category's slider (0-1, 1 where unset), Closed Captions, Directional Audio (HRTF),
  // Music Frequency (default frequent constant), Music Toast (never pause toast)
  soundVolumes: {},
  subtitles: false,
  directionalAudio: false,
  musicFrequency: 'default',
  musicToast: 'never',
};

const clone = v => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;

/* The player's settings, kept in localStorage. get/set by key; set saves and
   tells every listener (key, value). Objects (keys, skinParts) come back as
   the live object: change them with setKey / setPart, or set a new object. */
// a Chromebook, or a machine with little memory or two cores
export function lowEndDevice() {
  const n = navigator;
  return /CrOS/.test(n.userAgent || '') || (n.deviceMemory && n.deviceMemory <= 4) || (n.hardwareConcurrency && n.hardwareConcurrency <= 2);
}
export class Options {
  constructor(storageKey = 'lc2_options') {
    this.storageKey = storageKey;
    this.listeners = [];
    this.data = clone(DEFAULT_OPTIONS);
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && typeof saved === 'object') {
        for (const k in saved) {
          if (!(k in DEFAULT_OPTIONS)) continue;
          if (k === 'keys' || k === 'keys2' || k === 'skinParts') Object.assign(this.data[k], saved[k]);
          else this.data[k] = saved[k];
        }
        if (!('graphicsPreset' in saved)) this.carryOver(saved);
        if (!('shaderLevel' in saved)) this.carryShaders();
      }
      this.tuneForDevice();
    } catch (e) { /* private window or bad JSON: defaults */ }
  }
  /* A Chromebook or another small machine starts on the game's Fast preset (video.js PRESET_VALUES' first
     column), once: a new player, or one whose Preset is still the Fancy they never changed. */
  tuneForDevice() {
    const d = this.data;
    if (d.deviceTuned || d.graphicsPreset !== 'fancy' || !lowEndDevice()) return;
    Object.assign(d, { graphicsPreset: 'fast', biomeBlend: 1, renderDistance: 8, chunkBuilder: 'threaded', simulationDistance: 6, smoothLighting: false,
      clouds: 'fast', particles: 'decreased', mipmapLevels: 2, entityShadows: false, entityDistance: 0.75, menuBlur: 2, cloudDistance: 32,
      cutoutLeaves: false, improvedTransparency: false, textureFiltering: 'none', maxAnisotropy: 2, weatherRadius: 5, deviceTuned: true });
    this.save();
  }
  /* Settings saved before Video Settings became the game's own: as the game
     does for players who update, the Preset is Custom so nothing they chose
     changes (the render distance and clouds they had stay, the rest is what
     they saw before), and the old Graphics choice becomes Shaders ON (Detailed)
     or OFF (Fast). */
  carryOver(saved) {
    const d = this.data;
    d.graphicsPreset = 'custom';
    d.renderDistance = saved.renderDistance || 8;
    d.maxFps = saved.maxFps || 0;
    d.simulationDistance = 8;
    d.cutoutLeaves = true; d.smoothLighting = true; d.biomeBlend = 2;
    d.entityDistance = 2.5; d.cloudDistance = Math.max(2, d.renderDistance * 2);
    d.chunkBuilder = 'semi'; d.textureFiltering = 'anisotropic'; d.maxAnisotropy = 8; d.mipmapLevels = 4;
    const q = saved.quality;
    if (q === 'fast' || q === 'potato') d.shaders = false;
    else if (q && q !== 'auto') d.shaders = true;
    else d.shaders = null;       // the game picks, as it did (main.js)
    d.weatherRadius = d.shaders === false ? 5 : 10;
    this.save();
  }
  /* Settings saved before the one Shaders button. Shaders are Off by default
     now: settings that only had the old default (on, never chosen) start Off,
     and a choice the player made themselves (Shaders ON in Shader Packs, or
     Detailed in the older Graphics button) carries over to the nearest level:
     the full shader chain (Ultra, or parts of it chosen by hand) is High, the
     rest Medium, Low stays Low. The render resolution went with the old
     Shader Options screen, so it goes back to following the frame rate. */
  carryShaders() {
    const d = this.data;
    let level = 'off';
    if (d.shaders === true) {
      const p = d.shaderPreset, own = d.shader || {};
      const full = p === 'ultra' || (p === 'custom' && (own.bloom && own.bloom !== 'off' || own.lightShafts && own.lightShafts !== 'off' ||
        own.clouds === 'volumetric' || own.water === 'reflections' || !!own.normalMaps));
      level = full ? 'high' : p === 'low' ? 'low' : 'medium';
    }
    d.shaderLevel = level;
    d.renderScale = 'auto';
    this.save();
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    if (this.data[k] === v && typeof v !== 'object') return;
    this.data[k] = v;
    this.save();
    for (const fn of this.listeners) { try { fn(k, v, this); } catch (e) { console.error(e); } }
  }
  reset(k) { this.set(k, clone(DEFAULT_OPTIONS[k])); }
  setKey(action, code) { const keys = Object.assign({}, this.data.keys); keys[action] = code; this.set('keys', keys); }
  setPart(part, on) { const p = Object.assign({}, this.data.skinParts); p[part] = on; this.set('skinParts', p); }
  // the action bound to an event code ('KeyW', 'Mouse0'), or null
  setKey2(action, code) { const keys = Object.assign({}, this.data.keys2); keys[action] = code; this.set('keys2', keys); }
  actionFor(code) {
    const keys = this.data.keys; for (const a in keys) if (keys[a] === code) return a;
    const k2 = this.data.keys2 || {}; for (const a in k2) if (k2[a] === code) return a;
    return null;
  }
  onChange(fn) { this.listeners.push(fn); return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1); }; }
  save() { try { localStorage.setItem(this.storageKey, JSON.stringify(this.data)); } catch (e) { /* storage full or blocked */ } }
}

// how a key code reads on the Key Binds screen
export function keyLabel(code) {
  if (!code) return 'Not Bound';
  const named = {
    Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Control',
    ControlRight: 'Right Control', AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Win', MetaRight: 'Right Win',
    Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'Caps Lock', Escape: 'Escape',
    ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow', ArrowLeft: 'Left Arrow', ArrowRight: 'Right Arrow',
    Mouse0: 'Left Button', Mouse1: 'Middle Button', Mouse2: 'Right Button', Mouse3: 'Button 4', Mouse4: 'Button 5',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down',
  };
  if (named[code]) return named[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Keypad ' + code.slice(6);
  return code;
}

/* ------------------------------ colours ------------------------------ */

const argbCache = new Map();
export function cssARGB(argb) {
  let s = argbCache.get(argb);
  if (!s) {
    const a = ((argb >>> 24) & 255) / 255;
    s = 'rgba(' + ((argb >> 16) & 255) + ',' + ((argb >> 8) & 255) + ',' + (argb & 255) + ',' + a.toFixed(3) + ')';
    argbCache.set(argb, s);
  }
  return s;
}

// under the pack's see-through button middles
const BUTTON_FILL = 'rgba(62,50,46,0.84)';
export const WHITE = 0xFFFFFF, GREY = 0xA0A0A0, HOVER_YELLOW = 0xFFFFA0, LABEL = 0xE0E0E0;

// whether Shift was held at the last press (Shift+click steps a cycle button back)
const input = { shift: false };

const SHEETS = ['widgets', 'icons', 'options_background', 'accessibility', 'world_selection', 'checkbox', 'font_ascii'];

/* ------------------------------ the GUI ------------------------------ */

export class Gui {
  constructor(canvas, { base, options, hooks, version } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = base || new URL('../../textures/gui/', import.meta.url).href;
    if (!this.base.endsWith('/')) this.base += '/';
    this.version = version || '?v=107';
    this.options = options || new Options();
    this.hooks = hooks || {};
    this.sheets = new Map();
    this.loading = new Set();
    this.stack = [];
    this.hud = null;
    this.overlays = [];
    this.inGame = false;
    this.panorama = true;
    this.lowEnd = false;
    this.hideHud = false;
    this.scale = 1; this.width = 320; this.height = 240;
    this.mx = -1; this.my = -1;
    this.dirty = true;
    this.now = 0;
    this._last = 0;
    this._tooltip = null;
    this._clip = 0;
    this._blur = '';
    this._caret = -1;
    this.textFocus = null;
    this.touch = null;

    const st = canvas.style;
    st.position = 'fixed'; st.left = '0'; st.top = '0'; st.width = '100%'; st.height = '100%';
    st.touchAction = 'none'; st.pointerEvents = 'none';
    st.imageRendering = 'pixelated';
    if (!st.zIndex) st.zIndex = '5';

    // a hidden input does the typing for text fields: mobile keyboards, IME, paste, selection
    const inp = this.input = document.createElement('input');
    inp.type = 'text';
    inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('autocorrect', 'off');
    inp.setAttribute('aria-hidden', 'true');
    Object.assign(inp.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', border: '0', padding: '0', fontSize: '16px', pointerEvents: 'none' });
    document.body.appendChild(inp);
    const sync = () => { if (this.textFocus) this.textFocus._syncFrom(inp); };
    inp.addEventListener('input', sync);
    inp.addEventListener('keyup', sync);
    inp.addEventListener('select', sync);
    document.addEventListener('selectionchange', sync);
    inp.addEventListener('blur', () => { if (this.textFocus && !this._refocusing) this.dirty = true; });
    // Ctrl+V: the paste event brings the text (no clipboard permission asked), put in the box with its rules
    document.addEventListener('paste', e => {
      if (!this.textFocus) return;
      e.preventDefault();
      this._pasteWait = 0;
      const d = e.clipboardData;
      this.insertText(d ? d.getData('text/plain') || d.getData('text') : '');
    }, true);

    this._bind();
    this.resize();
  }

  async load() {
    const names = SHEETS.map(n => this.loadSheet(n));
    await Promise.all(names);
    this.font = new Font(this.sheets.get('font_ascii'));
    this.dirty = true;
  }

  loadSheet(name) {
    if (this.sheets.has(name)) return Promise.resolve(this.sheets.get(name));
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { this.sheets.set(name, img); this.loading.delete(name); this.dirty = true; res(img); };
      img.onerror = () => { this.loading.delete(name); rej(new Error('GUI sheet failed: ' + name)); };
      this.loading.add(name);
      img.src = this.base + name + '.png' + this.version;
    });
  }

  // a sheet from a resource pack the player opened, in place of ours (see pack.js)
  setSheet(name, img) {
    this.sheets.set(name, img);
    if (name === 'font_ascii') this.font = new Font(img);
    this.dirty = true;
  }
  // a sheet by name, or null while it is still on its way (it redraws when it lands)
  sheet(name) {
    const s = this.sheets.get(name);
    if (s) return s;
    if (!this.loading.has(name)) this.loadSheet(name).catch(e => console.warn(e.message));
    return null;
  }

  /* ---- screens ---- */
  get screen() { return this.stack.length ? this.stack[this.stack.length - 1] : null; }
  isOpen() { return this.stack.length > 0; }
  wantsPointer() { return this.stack.length > 0; }
  open(screen) {
    const prev = this.screen;
    if (prev) this._blurText();
    screen.parent = prev;
    this.stack.push(screen);
    this._initScreen(screen);
    this._pointerState();
    this.dirty = true;
    return screen;
  }
  replace(screen) {
    const top = this.stack.pop();
    if (top) { this._blurText(); top.onClose(); }
    return this.open(screen);
  }
  back() {
    const top = this.stack.pop();
    if (top) { this._blurText(); top.onClose(); }
    const s = this.screen;
    if (s) this._initScreen(s); // re-layout: options may have changed the scale
    else if (this.hooks.closed) this.hooks.closed();
    this._pointerState();
    this.dirty = true;
  }
  closeAll() {
    this._blurText();
    while (this.stack.length) this.stack.pop().onClose();
    this._pointerState();
    this.dirty = true;
    if (this.hooks.closed) this.hooks.closed();
  }
  // drop every screen and open this one (title screen after quitting, say)
  setRoot(screen) {
    this._blurText();
    while (this.stack.length) this.stack.pop().onClose();
    return this.open(screen);
  }
  _initScreen(s) {
    s.gui = this;
    s.width = this.width; s.height = this.height;
    s.widgets = [];
    s.init();
  }
  _pointerState() {
    this.canvas.style.pointerEvents = this.stack.length ? 'auto' : 'none';
    if (!this.stack.length) this._setBlur('');
  }
  markDirty() { this.dirty = true; }

  /* ---- size ---- */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(window.innerWidth * dpr));
    const H = Math.max(1, Math.round(window.innerHeight * dpr));
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    this.maxScale = Math.max(1, Math.min(Math.floor(W / 320), Math.floor(H / 240)));
    const want = this.options.get('guiScale') | 0;
    this.scale = want > 0 ? Math.min(want, this.maxScale) : this.maxScale;
    this.width = Math.ceil(W / this.scale);
    this.height = Math.ceil(H / this.scale);
    this.dpr = dpr;
    for (const s of this.stack) { s.width = this.width; s.height = this.height; }
    const top = this.screen;
    if (top) this._initScreen(top);
    this.dirty = true;
  }

  /* ---- input ---- */
  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / (r.width || 1) / this.scale;
    return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
  }
  _bind() {
    const c = this.canvas;
    window.addEventListener('resize', () => this.resize());
    this.options.onChange(k => { if (k === 'guiScale') this.resize(); else this.dirty = true; });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      const s = this.screen;
      if (!s) return;
      e.preventDefault();
      const [mx, my] = this._pos(e);
      this.mx = mx; this.my = my; this.dirty = true;
      input.shift = e.shiftKey;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      if (e.pointerType === 'touch') {
        // a touch inside a list waits to see whether it is a tap or a scroll
        const list = s.listAt ? s.listAt(mx, my) : null;
        if (list && !list.onScrollbar(mx)) { this.touch = { x0: mx, y0: my, list, scroll0: list.scroll, mode: 0 }; return; }
      }
      this.touch = null;
      this._press(mx, my, e.button);
    });
    window.addEventListener('pointermove', e => {
      const s = this.screen;
      if (!s) return;
      const [mx, my] = this._pos(e);
      this.mx = mx; this.my = my; this.dirty = true;
      const t = this.touch;
      if (t) {
        const dx = mx - t.x0, dy = my - t.y0;
        if (t.mode === 0 && Math.abs(dx) + Math.abs(dy) > 4) {
          // sideways on a slider drags it, anything else scrolls the list
          if (Math.abs(dx) > Math.abs(dy)) { t.mode = 2; this._press(t.x0, t.y0, 0); }
          else t.mode = 1;
        }
        if (t.mode === 1) t.list.setScroll(t.scroll0 - dy);
        else if (t.mode === 2) s.mouseDragged(mx, my, 0);
        return;
      }
      if (e.buttons) s.mouseDragged(mx, my, e.button < 0 ? 0 : e.button);
    });
    const up = e => {
      const s = this.screen;
      if (!s) return;
      const [mx, my] = this._pos(e);
      const t = this.touch;
      this.touch = null;
      if (t && t.mode === 0) { this._press(t.x0, t.y0, 0); s.mouseReleased(mx, my, 0); }
      else s.mouseReleased(mx, my, e.button);
      if (e.pointerType === 'touch') { this.mx = -1; this.my = -1; }
      this.dirty = true;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', e => { this.touch = null; up(e); });
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !e.buttons) { this.mx = -1; this.my = -1; this.dirty = true; } });
    c.addEventListener('wheel', e => {
      const s = this.screen;
      if (!s) return;
      e.preventDefault();
      const [mx, my] = this._pos(e);
      // one notch is one step, whatever the browser's pixel delta
      const steps = e.deltaMode === 0 ? e.deltaY / 100 : e.deltaY / 3;
      // (Control held: Video Settings changes the GUI Scale with the wheel, as the game does)
      this.wheelCtrl = e.ctrlKey || e.metaKey;
      s.mouseScrolled(mx, my, -Math.max(-3, Math.min(3, steps)));
      this.dirty = true;
    }, { passive: false });
    // capture phase, so the game never sees a key while a menu is up
    window.addEventListener('keydown', e => {
      const s = this.screen;
      if (!s) return;
      e.stopImmediatePropagation();
      if (this.textFocus && this._editKey(e)) { this.dirty = true; return; }
      // (Ctrl+A with no box to type in would select the whole page)
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyA' || e.key === 'a' || e.key === 'A')) e.preventDefault();
      if (s.keyPressed(e)) e.preventDefault();
      this.dirty = true;
    }, true);
  }
  /* Ctrl+A, Ctrl+C, Ctrl+X and Ctrl+V in the focused box, as the game's edit box has them (Cmd on a Mac).
     Copy goes through navigator.clipboard (the old copy command where there is none); paste is left to the
     browser's paste event (above), and if none comes (nothing focused to paste into) the clipboard is read.
     A password box copies nothing. Shift with the arrows, Home and End, and typing over a selection are the
     hidden input's own. */
  _editKey(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    const is = (code, ch) => e.code === code || (e.key || '').toLowerCase() === ch;
    const f = this.textFocus, inp = this.input;
    const a = Math.min(f.cursor, f.selEnd), b = Math.max(f.cursor, f.selEnd);
    if (document.activeElement !== inp) inp.focus({ preventScroll: true });
    if (is('KeyA', 'a')) {
      e.preventDefault();
      try { inp.setSelectionRange(0, f.value.length, 'forward'); } catch (err) { /* hidden */ }
      f._syncFrom(inp);
      return true;
    }
    if (is('KeyC', 'c') || is('KeyX', 'x')) {
      e.preventDefault();
      if (b > a && !f.password) {
        this.copyText(f.value.slice(a, b));
        if (is('KeyX', 'x')) this.insertText('', true);
      }
      return true;
    }
    if (is('KeyV', 'v')) {
      // (not prevented: the browser's paste event is what brings the text)
      const id = this._pasteWait = (this._pasteWait | 0) + 1;
      setTimeout(() => {
        if (this._pasteWait !== id) return;
        this._pasteWait = 0;
        const c = navigator.clipboard;
        if (c && c.readText) c.readText().then(t => this.insertText(t), () => {});
      }, 80);
      return true;
    }
    return false;
  }
  copyText(t) {
    const old = () => {
      const put = ev => { ev.clipboardData.setData('text/plain', t); ev.preventDefault(); };
      document.addEventListener('copy', put, true);
      try { document.execCommand('copy'); } catch (err) { /* not allowed */ }
      document.removeEventListener('copy', put, true);
    };
    const c = navigator.clipboard;
    if (c && c.writeText) c.writeText(t).catch(old); else old();
  }
  // text put in the focused box over its selection: one line, no control characters, as much as fits
  insertText(t, cut) {
    const f = this.textFocus;
    if (!f || (!t && !cut)) return;
    t = String(t || '').replace(/\r\n?|\n/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
    const a = Math.min(f.cursor, f.selEnd), b = Math.max(f.cursor, f.selEnd);
    t = t.slice(0, Math.max(0, f.maxLength - (f.value.length - (b - a))));
    if (!t && !cut) return;
    const inp = this.input;
    // (from the hidden input's own text, which a box may keep in its own form: the book's line breaks)
    const base = inp.value.length === f.value.length ? inp.value : f.value;
    inp.value = base.slice(0, a) + t + base.slice(b);
    try { inp.setSelectionRange(a + t.length, a + t.length); } catch (err) { /* hidden */ }
    f._syncFrom(inp);
    this.dirty = true;
  }
  _press(mx, my, button) {
    const s = this.screen;
    if (!s) return;
    const before = this.textFocus;
    const hit = s.mouseClicked(mx, my, button);
    // clicking off a text field takes the focus away, as in the game
    if (before && this.textFocus === before && !(hit && hit === before)) {
      if (!before.isMouseOver(mx, my)) this._blurText();
    }
    if (this.textFocus) { this._refocusing = true; this.input.focus({ preventScroll: true }); this._refocusing = false; }
  }

  /* ---- text focus ---- */
  focusText(field) {
    if (this.textFocus === field) return;
    if (this.textFocus) this.textFocus.focused = false;
    this.textFocus = field;
    field.focused = true;
    field.focusTime = performance.now();
    const inp = this.input;
    inp.type = field.password ? 'password' : 'text';
    inp.maxLength = field.maxLength;
    inp.value = field.value;
    inp.focus({ preventScroll: true });
    try { inp.setSelectionRange(field.cursor, field.cursor); } catch (e) { /* hidden */ }
    this.dirty = true;
  }
  _blurText() {
    if (!this.textFocus) return;
    this.textFocus.focused = false;
    this.textFocus = null;
    this.input.blur();
    this.dirty = true;
  }

  /* ---- the frame ---- */
  // call every animation frame; returns true when it drew
  frame(now) {
    this.now = now;
    const s = this.screen;
    let redraw = this.dirty;
    if (s && (s.animates || this._moving)) redraw = true;
    const f = this.textFocus;
    if (f) {
      const ph = ((now - f.focusTime) / 300 | 0) & 1;
      if (ph !== this._caret) { this._caret = ph; redraw = true; }
    }
    const hudOn = this.hud && this.inGame && !this.hideHud;
    if (hudOn && (this.hud.animates || (this.hud.isDirty && this.hud.isDirty()))) redraw = true;
    for (let i = 0; i < this.overlays.length; i++) if (this.overlays[i].animates) redraw = true;
    if (!redraw) return false;
    this.dirty = false;
    const dt = this._last ? Math.min(250, now - this._last) : 16;
    this._last = now;
    this._draw(dt);
    return true;
  }

  _draw(dt) {
    const ctx = this.ctx, s = this.screen;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (!this.font) return;
    const hudOn = this.hud && this.inGame && !this.hideHud;
    if (hudOn) this.hud.draw(this);
    // what the game draws as part of its HUD, under any screen (the chat: an inventory covers it)
    for (let i = 0; i < this.overlays.length; i++) if (this.overlays[i].under) this.overlays[i].draw(this);
    if (hudOn || (s && this.inGame)) {
      // under a menu the game blurs the HUD along with the world (Menu Background Blur)
      const hb = s && this.backgroundKind(s.background) === 'world' ? this._blurPx() : 0;
      if (hb) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = 'blur(' + (hb * 1.2 * (this.dpr || 1)).toFixed(1) + 'px)';
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(this.canvas, 0, 0);
        ctx.restore();
      }
    }
    if (s) {
      this._background(s.background);
      this._tooltip = null;
      this._moving = false;
      const mx = this.touch && this.touch.mode === 1 ? -1 : this.mx, my = this.touch && this.touch.mode === 1 ? -1 : this.my;
      s.render(this, mx, my, dt);
      while (this._clip > 0) this.endScissor();
      ctx.globalAlpha = 1;
      if (this._tooltip) this.tooltip(this._tooltip, mx, my);
    } else this._setBlur('');
    for (let i = 0; i < this.overlays.length; i++) if (!this.overlays[i].under) this.overlays[i].draw(this);
  }

  _blurPx() {
    const b = +this.options.get('menuBlur') || 0;
    if (b <= 0 || this.lowEnd || this.options.get('quality') === 'potato') return 0;
    return b;
  }
  _setBlur(v) {
    if (v === this._blur) return;
    this._blur = v;
    this.canvas.style.backdropFilter = v;
    this.canvas.style.webkitBackdropFilter = v;
  }
  // what a screen's background looks like right now
  backgroundKind(kind) {
    if (kind === 'menu' || kind === 'world') {
      if (this.inGame) return 'world';
      return this.panorama ? 'blurred' : 'dirt';
    }
    if (kind === 'panorama' && !this.panorama && !this.inGame) return 'dirt';
    return kind;
  }
  _background(kind) {
    const k = this.backgroundKind(kind);
    const W = this.width, H = this.height;
    const blur = this._blurPx();
    if (k === 'world') {
      this._setBlur(blur ? 'blur(' + (blur * 1.2).toFixed(1) + 'px)' : '');
      /* the in-game darkening: over the blur, the game's in-world menu
         background, black at a quarter (it was half, which hid the world) */
      if (blur) this.fill(0, 0, W, H, 0x40000000);
      else this.gradient(0, 0, W, H, 0xC0101010, 0xD0101010);
    } else if (k === 'blurred') {
      this._setBlur(blur ? 'blur(' + (blur * 1.2).toFixed(1) + 'px)' : '');
      this.fill(0, 0, W, H, 0x48000000);
    } else if (k === 'dirt') {
      this._setBlur('');
      this.tiled(0, 0, W, H, 0, 0.25);
    } else if (k === 'death') {
      this._setBlur('');
      this.gradient(0, 0, W, H, 0x60500000, 0xA0803030);
    } else this._setBlur('');
  }

  /* ---- drawing helpers ---- */
  blit(sheet, sx, sy, sw, sh, dx, dy, dw, dh) {
    const img = typeof sheet === 'string' ? this.sheet(sheet) : sheet;
    if (!img) return;
    this.ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw === undefined ? sw : dw, dh === undefined ? sh : dh);
  }
  text(str, x, y, rgb = WHITE, shadow = true) { return this.font.draw(this.ctx, String(str), x, y, rgb, shadow); }
  textWidth(str) { return this.font.width(String(str)); }
  centered(str, cx, y, rgb = WHITE, shadow = true) { str = String(str); return this.font.draw(this.ctx, str, Math.floor(cx - this.font.width(str) / 2), y, rgb, shadow); }
  /* Text centred in a box. Too long to fit, it slides back and forth inside
     the box the way the game's buttons do (and keeps the GUI redrawing). */
  boxText(str, x0, y0, x1, y1, rgb) {
    str = String(str);
    const w = this.font.width(str), room = x1 - x0;
    const ty = Math.floor((y0 + y1 - 9) / 2) + 1;
    if (w > room) {
      const over = w - room;
      const t = this.now / 1000, period = Math.max(over * 0.5, 3);
      const k = Math.sin(Math.PI / 2 * Math.cos(Math.PI * 2 * t / period)) / 2 + 0.5;
      this.scissor(x0, y0, x1, y1);
      this.font.draw(this.ctx, str, Math.round(x0 - k * over), ty, rgb, true);
      this.endScissor();
      this._moving = true;
      return;
    }
    this.font.draw(this.ctx, str, Math.floor(x0 + (room - w) / 2), ty, rgb, true);
  }
  fill(x0, y0, x1, y1, argb) {
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
    this.ctx.fillStyle = cssARGB(argb);
    this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  gradient(x0, y0, x1, y1, top, bottom) {
    const g = this.ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, cssARGB(top));
    g.addColorStop(1, cssARGB(bottom));
    this.ctx.fillStyle = g;
    this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  // options_background tiled at 32 GUI pixels, darkened to `bright` (0.25 is the classic menu)
  tiled(x0, y0, x1, y1, scroll, bright) {
    const img = this.sheet('options_background');
    const ctx = this.ctx;
    if (img) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
      const oy = -((scroll | 0) % 32);
      for (let y = y0 + oy - 32; y < y1; y += 32) for (let x = x0; x < x1; x += 32) ctx.drawImage(img, 0, 0, img.width, img.height, x, y, 32, 32);
      ctx.restore();
    }
    this.fill(x0, y0, x1, y1, ((Math.round((1 - bright) * 255) & 255) << 24) >>> 0);
  }
  scissor(x0, y0, x1, y1) {
    this.ctx.save();
    this.ctx.beginPath(); this.ctx.rect(x0, y0, x1 - x0, y1 - y0); this.ctx.clip();
    this._clip++;
  }
  endScissor() { if (this._clip > 0) { this._clip--; this.ctx.restore(); } }
  setTooltip(lines) { this._tooltip = lines; }

  /* The vanilla tooltip box: a near-black body with a purple gradient frame,
     placed right of and above the pointer and kept on screen. lines may be a
     string (wrapped at 170 px) or an array. */
  tooltip(lines, mx, my) {
    if (typeof lines === 'string') lines = this.font.wrap(lines, 170);
    if (!lines || !lines.length) return;
    let w = 0;
    for (const l of lines) w = Math.max(w, this.font.width(l));
    const h = lines.length === 1 ? 8 : 8 + (lines.length - 1) * 10 + 2;
    let x = mx + 12, y = my - 12;
    if (x + w > this.width) x = Math.max(mx - 24 - w, 4);
    if (y + h + 3 > this.height) y = this.height - h - 3;
    if (y < 4) y = 4;
    x = Math.floor(x); y = Math.floor(y);
    const bg = 0xF0100010;
    this.fill(x - 3, y - 4, x + w + 3, y - 3, bg);
    this.fill(x - 3, y + h + 3, x + w + 3, y + h + 4, bg);
    this.fill(x - 3, y - 3, x + w + 3, y + h + 3, bg);
    this.fill(x - 4, y - 3, x - 3, y + h + 3, bg);
    this.fill(x + w + 3, y - 3, x + w + 4, y + h + 3, bg);
    this.gradient(x - 3, y - 2, x - 2, y + h + 2, 0x505000FF, 0x5028007F);
    this.gradient(x + w + 2, y - 2, x + w + 3, y + h + 2, 0x505000FF, 0x5028007F);
    this.fill(x - 3, y - 3, x + w + 3, y - 2, 0x505000FF);
    this.fill(x - 3, y + h + 2, x + w + 3, y + h + 3, 0x5028007F);
    let ty = y;
    for (let i = 0; i < lines.length; i++) {
      this.text(lines[i], x, ty, i === 0 ? WHITE : 0xA8A8A8);
      ty += i === 0 ? 12 : 10;
    }
  }

  /* A button frame from widgets.png: rows y = 46 (disabled), 66 (normal),
     86 (hover), 200 x 20. Any size up to 400 x 40 is cut from the four
     corners of the sprite, the way the classic game stretches its buttons. */
  button(x, y, w, h, state) {
    const img = this.sheet('widgets');
    if (!img) return;
    const ctx = this.ctx;
    if (state !== 0) { ctx.fillStyle = BUTTON_FILL; ctx.fillRect(x + 1, y + 1, w - 2, h - 2); }
    const sy = 46 + state * 20;
    if (w <= 400 && h <= 40) {
      const lw = w >> 1, rw = w - lw, th = h >> 1, bh = h - th;
      ctx.drawImage(img, 0, sy, lw, th, x, y, lw, th);
      ctx.drawImage(img, 200 - rw, sy, rw, th, x + lw, y, rw, th);
      ctx.drawImage(img, 0, sy + 20 - bh, lw, bh, x, y + th, lw, bh);
      ctx.drawImage(img, 200 - rw, sy + 20 - bh, rw, bh, x + lw, y + th, rw, bh);
    } else this.nineSlice(img, 0, sy, 200, 20, 4, x, y, w, h);
  }
  nineSlice(img, sx, sy, sw, sh, b, x, y, w, h) {
    const ctx = this.ctx, iw = sw - 2 * b, ih = sh - 2 * b, ow = w - 2 * b, oh = h - 2 * b;
    ctx.drawImage(img, sx, sy, b, b, x, y, b, b);
    ctx.drawImage(img, sx + sw - b, sy, b, b, x + w - b, y, b, b);
    ctx.drawImage(img, sx, sy + sh - b, b, b, x, y + h - b, b, b);
    ctx.drawImage(img, sx + sw - b, sy + sh - b, b, b, x + w - b, y + h - b, b, b);
    ctx.drawImage(img, sx + b, sy, iw, b, x + b, y, ow, b);
    ctx.drawImage(img, sx + b, sy + sh - b, iw, b, x + b, y + h - b, ow, b);
    ctx.drawImage(img, sx, sy + b, b, ih, x, y + b, b, oh);
    ctx.drawImage(img, sx + sw - b, sy + b, b, ih, x + w - b, y + b, b, oh);
    ctx.drawImage(img, sx + b, sy + b, iw, ih, x + b, y + b, ow, oh);
  }
  // the darker box a list scrolls in, with the separator lines above and below it
  listBackground(x0, y0, x1, y1, scroll) {
    if (this.backgroundKind('menu') === 'dirt') {
      this.tiled(x0, y0, x1, y1, scroll, 0.125);
      this.gradient(x0, y0, x1, y0 + 4, 0xFF000000, 0x00000000);
      this.gradient(x0, y1 - 4, x1, y1, 0x00000000, 0xFF000000);
    } else this.fill(x0, y0, x1, y1, 0x50000000);
  }
  headerSeparator(x0, x1, y) { this.fill(x0, y, x1, y + 1, 0x40FFFFFF); this.fill(x0, y + 1, x1, y + 2, 0xBF000000); }
  footerSeparator(x0, x1, y) { this.fill(x0, y, x1, y + 1, 0xBF000000); this.fill(x0, y + 1, x1, y + 2, 0x40FFFFFF); }
}

/* ------------------------------ widgets ------------------------------ */

// the button click (sound/game.js sets it): a widget's press, as the game's playDownSound; a slider's on letting go
let uiSound = null;
export function setUiSound(fn) { uiSound = fn; }

export class Widget {
  constructor(x, y, w, h, message) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.message = message || '';
    this.active = true; this.visible = true;
    this.tooltip = null;   // string or lines, shown on hover even when disabled
    this.hovered = false;
  }
  isMouseOver(mx, my) { return this.visible && mx >= this.x && my >= this.y && mx < this.x + this.w && my < this.y + this.h; }
  render(g, mx, my, dt) {
    if (!this.visible) return;
    this.hovered = this.isMouseOver(mx, my);
    this.draw(g, mx, my, dt);
    if (this.hovered && this.tooltip) g.setTooltip(this.tooltip);
  }
  draw() {}
  mouseClicked(mx, my, button) {
    if (!this.active || !this.visible || button !== 0 || !this.isMouseOver(mx, my)) return false;
    this.onClick(mx, my);
    if (uiSound && !(this instanceof Slider) && !(this instanceof TextField)) uiSound();
    return true;
  }
  onClick() {}
  mouseDragged() {}
  mouseReleased() {}
  mouseScrolled() { return false; }
  keyPressed() { return false; }
}

export class Button extends Widget {
  constructor(x, y, w, h, message, onPress, tooltip) {
    super(x, y, w, h, message);
    this.onPress = onPress;
    if (tooltip) this.tooltip = tooltip;
  }
  draw(g) {
    const hov = this.hovered && this.active;
    g.button(this.x, this.y, this.w, this.h, !this.active ? 0 : hov ? 2 : 1);
    // disabled buttons sit a shade darker than a slider's track
    if (!this.active) g.fill(this.x, this.y, this.x + this.w, this.y + this.h, 0x48000000);
    g.boxText(this.message, this.x + 2, this.y, this.x + this.w - 2, this.y + this.h, !this.active ? GREY : WHITE);
  }
  onClick() { if (this.onPress) this.onPress(this); }
}

// the 20 x 20 language (globe) and accessibility buttons beside the title menu
export class IconButton extends Widget {
  constructor(x, y, kind, onPress, tooltip) {
    super(x, y, 20, 20, '');
    this.kind = kind; this.onPress = onPress;
    if (tooltip) this.tooltip = tooltip;
  }
  draw(g) {
    const hov = this.hovered && this.active ? 1 : 0;
    if (this.kind === 'language') g.blit('widgets', 0, 106 + hov * 20, 20, 20, this.x, this.y);
    else g.blit('accessibility', 0, hov * 20, 20, 20, this.x, this.y);
  }
  onClick() { if (this.onPress) this.onPress(this); }
}

/* An option slider: the disabled-button track with an 8-wide handle.
   opts: { min, max, step, value, label(v) -> text, onChange(v), onRelease(v) } */
export class Slider extends Widget {
  constructor(x, y, w, h, opts) {
    super(x, y, w, h, '');
    this.o = opts;
    this.value = opts.value;
    this.dragging = false;
  }
  get t() { const o = this.o; return o.max === o.min ? 0 : (this.value - o.min) / (o.max - o.min); }
  setFromMouse(mx) {
    const o = this.o;
    let t = Math.max(0, Math.min(1, (mx - (this.x + 4)) / (this.w - 8)));
    let v = o.min + t * (o.max - o.min);
    if (o.step) v = Math.round((v - o.min) / o.step) * o.step + o.min;
    v = Math.max(o.min, Math.min(o.max, +v.toFixed(6)));
    if (v !== this.value) { this.value = v; if (o.onChange) o.onChange(v); }
  }
  draw(g) {
    const hov = (this.hovered || this.dragging) && this.active;
    g.button(this.x, this.y, this.w, this.h, 0);
    const hx = this.x + Math.round(this.t * (this.w - 8));
    if (this.active) {
      const st = hov ? 2 : 1;
      const img = g.sheet('widgets');
      if (img) {
        g.ctx.fillStyle = BUTTON_FILL; g.ctx.fillRect(hx + 1, this.y + 1, 6, this.h - 2);
        g.blit(img, 0, 46 + st * 20, 4, 20, hx, this.y, 4, this.h);
        g.blit(img, 196, 46 + st * 20, 4, 20, hx + 4, this.y, 4, this.h);
      }
    }
    const text = this.o.label ? this.o.label(this.value) : String(this.value);
    g.boxText(text, this.x + 2, this.y, this.x + this.w - 2, this.y + this.h, !this.active ? GREY : WHITE);
  }
  onClick(mx) { this.dragging = true; this.setFromMouse(mx); }
  mouseDragged(mx) { if (this.dragging) this.setFromMouse(mx); }
  mouseReleased() { if (this.dragging) { this.dragging = false; if (this.o.onRelease) this.o.onRelease(this.value); if (uiSound) uiSound(); } }
}

/* 'Label: Value' that steps through values on click (Shift+click or the
   wheel goes back). opts: { values, value, format(v), onChange(v),
   tooltip(v), valueOnly } */
export class CycleButton extends Button {
  constructor(x, y, w, h, label, opts) {
    super(x, y, w, h, '', null);
    this.label = label; this.o = opts;
    this.value = opts.value;
    this._msg();
  }
  _msg() {
    const v = this.o.format ? this.o.format(this.value) : String(this.value);
    this.message = this.o.valueOnly || !this.label ? v : this.label + ': ' + v;
    if (this.o.tooltip) this.tooltip = this.o.tooltip(this.value);
  }
  step(d) {
    const vals = this.o.values;
    let i = vals.indexOf(this.value);
    i = (i + d + vals.length) % vals.length;
    this.value = vals[i];
    this._msg();
    if (this.o.onChange) this.o.onChange(this.value);
  }
  onClick() { this.step(input.shift ? -1 : 1); }
  mouseScrolled(mx, my, d) { if (!this.active) return false; this.step(d > 0 ? -1 : 1); return true; }
}
export const onOff = v => v ? 'ON' : 'OFF';

/* The edit box: black with a grey border (white when focused), the caret
   blinking every 300 ms, typing through the GUI's hidden input.
   opts: { value, maxLength = 32, hint, filter(str) -> bool, onChange(str), onEnter() } */
export class TextField extends Widget {
  constructor(x, y, w, h, opts = {}) {
    super(x, y, w, h, '');
    this.value = opts.value || '';
    this.maxLength = opts.maxLength || 32;
    this.hint = opts.hint || '';
    this.filter = opts.filter || null;
    this.onChange = opts.onChange || null;
    this.onEnter = opts.onEnter || null;
    // (a password is drawn as stars)
    this.password = !!opts.password;
    this.cursor = this.value.length;
    this.selEnd = this.cursor;
    this.first = 0;
    this.focused = false;
    this.focusTime = 0;
    this.gui = null;
  }
  setValue(v) { this.value = String(v).slice(0, this.maxLength); this.cursor = this.selEnd = this.value.length; this.first = 0; }
  _syncFrom(inp) {
    let v = inp.value;
    if (v.length > this.maxLength) v = v.slice(0, this.maxLength);
    if (this.filter && v !== this.value && !this.filter(v)) {
      // refuse the edit: put the box back as it was
      inp.value = this.value;
      try { inp.setSelectionRange(this.cursor, this.cursor); } catch (e) { /* hidden */ }
      return;
    }
    const a = inp.selectionStart ?? v.length, b = inp.selectionEnd ?? v.length;
    const back = inp.selectionDirection === 'backward';
    const changed = v !== this.value;
    const cur = back ? a : b, other = back ? b : a;
    if (!changed && cur === this.cursor && other === this.selEnd) return;
    this.value = v;
    this.cursor = cur; this.selEnd = other;
    this.focusTime = performance.now();
    if (this.gui) this.gui.dirty = true;
    if (changed && this.onChange) this.onChange(v);
  }
  get shownValue() { return this.password ? '*'.repeat(this.value.length) : this.value; }
  draw(g) {
    const { x, y, w, h } = this;
    const val = this.shownValue;
    this.gui = g;
    g.fill(x - 1, y - 1, x + w + 1, y + h + 1, this.focused ? 0xFFFFFFFF : 0xFFA0A0A0);
    g.fill(x, y, x + w, y + h, 0xFF000000);
    const inner = w - 8, tx = x + 4, ty = y + ((h - 8) >> 1);
    const f = g.font;
    if (this.cursor < this.first) this.first = this.cursor;
    while (this.first < this.cursor && f.width(val.slice(this.first, this.cursor)) > inner) this.first++;
    const shown = f.trim(val.slice(this.first), inner);
    const colour = this.active ? LABEL : 0x707070;
    if (!this.value && !this.focused && this.hint) g.text(f.trim(this.hint, inner), tx, ty, 0x808080);
    g.text(shown, tx, ty, colour);
    const cx = tx + f.width(val.slice(this.first, this.cursor));
    if (this.selEnd !== this.cursor) {
      const s0 = Math.max(this.first, Math.min(this.cursor, this.selEnd)), s1 = Math.min(this.first + shown.length, Math.max(this.cursor, this.selEnd));
      if (s1 > s0) {
        const a = tx + f.width(val.slice(this.first, s0)), b = tx + f.width(val.slice(this.first, s1));
        g.ctx.globalCompositeOperation = 'difference';
        g.fill(a, ty - 1, b, ty + 9, 0xFFFFFFFF);
        g.ctx.globalCompositeOperation = 'source-over';
      }
    }
    const on = this.focused && (((g.now - this.focusTime) / 300 | 0) & 1) === 0;
    if (on) {
      if (this.cursor < val.length || val.length >= this.maxLength) g.fill(cx, ty - 1, cx + 1, ty + 9, 0xFFD0D0D0);
      else g.text('_', cx, ty, colour);
    }
  }
  mouseClicked(mx, my, button) {
    if (!this.visible || !this.isMouseOver(mx, my)) return false;
    if (!this.active) return true;
    const g = this.gui;
    if (g) {
      // put the caret under the pointer
      const f = g.font, rel = mx - (this.x + 4), val = this.shownValue;
      let i = this.first;
      while (i < val.length && f.width(val.slice(this.first, i + 1)) <= rel) i++;
      this.cursor = this.selEnd = i;
      g.focusText(this);
      try { g.input.setSelectionRange(i, i); } catch (e) { /* hidden */ }
      this.focusTime = performance.now();
    }
    return true;
  }
  keyPressed(e) {
    if (!this.focused) return false;
    if (e.key === 'Enter') { if (this.onEnter) this.onEnter(); return true; }
    return false;
  }
}

// a 20 x 20 tick box from checkbox.png, label to its right
export class Checkbox extends Widget {
  constructor(x, y, label, checked, onChange) {
    super(x, y, 20, 20, label);
    this.checked = !!checked; this.onChange = onChange;
    this.labelW = -1;
  }
  draw(g) {
    if (this.labelW < 0) { this.labelW = g.textWidth(this.message); this.w = 24 + this.labelW; }
    if (!this.active) g.ctx.globalAlpha = 0.5;
    g.blit('checkbox', 0, this.checked ? 20 : 0, 20, 20, this.x, this.y);
    g.ctx.globalAlpha = 1;
    g.text(this.message, this.x + 24, this.y + 6, this.active ? LABEL : GREY);
  }
  onClick() { this.checked = !this.checked; if (this.onChange) this.onChange(this.checked); }
}

// plain text that can carry a tooltip or be clicked (the credits line on the title screen)
export class TextLink extends Widget {
  constructor(x, y, w, message, onPress, colour = WHITE) {
    super(x, y, w, 10, message);
    this.onPress = onPress; this.colour = colour; this.alpha = 1;
  }
  draw(g) {
    g.text(this.message, this.x, this.y, this.colour);
    if (this.hovered && this.onPress) g.fill(this.x, this.y + 9, this.x + this.w, this.y + 10, 0xFF000000 | this.colour);
  }
  onClick() { if (this.onPress) this.onPress(this); }
}

/* A scrolling list: the world list, the options lists, key binds.
   Rows are itemHeight tall and rowWidth wide, centred; the scrollbar sits
   to the right. An entry is any object with
     render(g, list, index, top, left, width, height, mx, my, hovered)
   and optionally children (widgets, laid out by the entry in render),
   mouseClicked(mx, my, button, list), and height-free data.
   opts: { rowWidth = 220, selectable, onSelect(entry), onActivate(entry), background = true } */
export class ScrollList {
  constructor(x, y, w, h, itemHeight, opts = {}) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.itemHeight = itemHeight;
    this.rowWidth = opts.rowWidth || 220;
    this.selectable = !!opts.selectable;
    this.onSelect = opts.onSelect || null;
    this.onActivate = opts.onActivate || null;
    this.background = opts.background !== false;
    this.entries = [];
    this.selected = null;
    this.scroll = 0;
    this.dragBar = false;
    this.focused = true;
    this.visible = true;
    this._lastClick = 0; this._lastEntry = null;
  }
  get rowLeft() { return Math.floor(this.x + this.w / 2 - this.rowWidth / 2 + 2); }
  get scrollbarX() { return Math.floor(this.x + this.w / 2 + this.rowWidth / 2 + 14); }
  get maxScroll() { return Math.max(0, this.entries.length * this.itemHeight - (this.h - 4)); }
  setScroll(v) { this.scroll = Math.max(0, Math.min(this.maxScroll, v)); }
  rowTop(i) { return this.y + 4 - Math.round(this.scroll) + i * this.itemHeight; }
  isMouseOver(mx, my) { return mx >= this.x && my >= this.y && mx < this.x + this.w && my < this.y + this.h; }
  onScrollbar(mx) { return this.maxScroll > 0 && mx >= this.scrollbarX && mx < this.scrollbarX + 6; }
  entryAt(mx, my) {
    if (!this.isMouseOver(mx, my)) return -1;
    const half = this.rowWidth / 2, cx = this.x + this.w / 2;
    if (mx < cx - half || mx > cx + half) return -1;
    const i = Math.floor((my - this.y + Math.round(this.scroll) - 4) / this.itemHeight);
    return i >= 0 && i < this.entries.length ? i : -1;
  }
  setSelected(e) { this.selected = e; if (this.onSelect) this.onSelect(e); }
  // keep a row in view (keyboard selection)
  ensureVisible(e) {
    const i = this.entries.indexOf(e);
    if (i < 0) return;
    const top = this.rowTop(i), bottom = top + this.itemHeight;
    if (top < this.y + 4) this.setScroll(this.scroll - (this.y + 4 - top));
    else if (bottom > this.y + this.h - 4) this.setScroll(this.scroll + bottom - (this.y + this.h - 4));
  }
  render(g, mx, my) {
    if (!this.visible) return;
    const top = this.y, bottom = this.y + this.h;
    this.setScroll(this.scroll);
    if (this.background) g.listBackground(this.x, top, this.x + this.w, bottom, this.scroll);
    const inside = this.isMouseOver(mx, my);
    const hoverI = inside ? this.entryAt(mx, my) : -1;
    const lmx = inside ? mx : -1, lmy = inside ? my : -1;
    g.scissor(this.x, top, this.x + this.w, bottom);
    const left = this.rowLeft, h = this.itemHeight - 4;
    for (let i = 0; i < this.entries.length; i++) {
      const rt = this.rowTop(i);
      if (rt + this.itemHeight < top || rt > bottom) continue;
      const e = this.entries[i];
      if (this.selectable && e === this.selected) {
        const x0 = Math.floor(this.x + (this.w - this.rowWidth) / 2), x1 = Math.floor(this.x + (this.w + this.rowWidth) / 2);
        g.fill(x0, rt - 2, x1, rt + h + 2, this.focused ? 0xFFFFFFFF : 0xFF808080);
        g.fill(x0 + 1, rt - 1, x1 - 1, rt + h + 1, 0xFF000000);
      }
      e.render(g, this, i, rt, left, this.rowWidth, h, lmx, lmy, i === hoverI);
    }
    g.endScissor();
    if (this.background) {
      g.headerSeparator(this.x, this.x + this.w, top - 2);
      g.footerSeparator(this.x, this.x + this.w, bottom);
    }
    const max = this.maxScroll;
    if (max > 0) {
      const sx = this.scrollbarX, total = this.entries.length * this.itemHeight;
      const th = Math.max(32, Math.min(this.h - 8, Math.floor(this.h * this.h / total)));
      const ty = Math.floor(this.scroll * (this.h - th) / max) + top;
      g.fill(sx, top, sx + 6, bottom, 0xFF000000);
      g.fill(sx, ty, sx + 6, ty + th, 0xFF808080);
      g.fill(sx, ty, sx + 5, ty + th - 1, 0xFFC0C0C0);
    }
  }
  mouseClicked(mx, my, button) {
    if (!this.visible || !this.isMouseOver(mx, my)) return false;
    if (button === 0 && this.onScrollbar(mx)) { this.dragBar = true; this._dragFrom(my); return true; }
    const i = this.entryAt(mx, my);
    if (i < 0) return true;
    const e = this.entries[i];
    if (e.children) {
      for (const c of e.children) if (c.mouseClicked(mx, my, button)) { this.dragging = c; return c; }
    }
    if (e.mouseClicked && e.mouseClicked(mx, my, button, this)) return true;
    if (this.selectable && button === 0) {
      const now = performance.now();
      const dbl = this._lastEntry === e && now - this._lastClick < 250;
      this.setSelected(e);
      this._lastClick = now; this._lastEntry = e;
      if (dbl && this.onActivate) this.onActivate(e);
    }
    return true;
  }
  _dragFrom(my) {
    const max = this.maxScroll;
    if (max <= 0) return;
    const total = this.entries.length * this.itemHeight;
    const th = Math.max(32, Math.min(this.h - 8, Math.floor(this.h * this.h / total)));
    this.setScroll((my - this.y - th / 2) / (this.h - th) * max);
  }
  mouseDragged(mx, my, button) {
    if (this.dragBar) { this._dragFrom(my); return; }
    if (this.dragging) this.dragging.mouseDragged(mx, my, button);
  }
  mouseReleased(mx, my, button) {
    this.dragBar = false;
    if (this.dragging) { this.dragging.mouseReleased(mx, my, button); this.dragging = null; }
  }
  mouseScrolled(mx, my, d) {
    if (!this.isMouseOver(mx, my)) return false;
    // a cycle button under the pointer takes the wheel first, as in the game
    const i = this.entryAt(mx, my);
    if (i >= 0 && this.entries[i].children) {
      for (const c of this.entries[i].children) if (c instanceof CycleButton && c.isMouseOver(mx, my) && c.mouseScrolled(mx, my, d)) return true;
    }
    this.setScroll(this.scroll - d * this.itemHeight / 2);
    return true;
  }
}

/* A row of one or two option widgets for the options lists: 150 wide each at
   centre - 155 and centre + 5, or one 310 wide. */
export class WidgetRow {
  constructor(a, b) { this.children = b ? [a, b] : [a]; }
  render(g, list, i, top, left, width, h, mx, my) {
    const cx = Math.floor(list.x + list.w / 2);
    const [a, b] = this.children;
    if (b) { a.x = cx - 155; b.x = cx + 5; a.y = b.y = top; a.w = b.w = 150; }
    else { a.x = cx - 155; a.y = top; if (a.wide !== false) a.w = 310; }
    for (const c of this.children) c.render(g, mx, my);
  }
}

/* Create World's tab bar: tabs centred across the top, 24 high, each
   (min(400, width) - 28) / count wide, rounded to an even number. */
export class Tabs extends Widget {
  constructor(names, selected, onSelect) {
    super(0, 0, 0, 24, '');
    this.names = names; this.selected = selected; this.onSelect = onSelect;
  }
  layout(width) {
    const n = this.names.length;
    this.tw = Math.round((Math.min(400, width) - 28) / n / 2) * 2;
    this.w = this.tw * n;
    this.x = Math.floor((width - this.w) / 2);
    this.y = 0;
  }
  draw(g, mx, my) {
    for (let i = 0; i < this.names.length; i++) {
      const x = this.x + i * this.tw, sel = i === this.selected;
      const hov = mx >= x && mx < x + this.tw && my >= this.y && my < this.y + 24;
      if (sel) g.button(x, this.y, this.tw, 24, 2);
      else g.button(x, this.y + 2, this.tw, 22, hov ? 2 : 1);
      if (!sel) g.fill(x + 1, this.y + 3, x + this.tw - 1, this.y + 23, 0x40000000);
      const name = this.names[i], tw = g.textWidth(name);
      const tx = Math.floor(x + (this.tw - tw) / 2), ty = this.y + (sel ? 8 : 9);
      g.text(name, tx, ty, sel ? WHITE : hov ? HOVER_YELLOW : GREY);
      if (sel) g.fill(tx, ty + 10, tx + tw, ty + 11, 0xFFFFFFFF);
    }
  }
  mouseClicked(mx, my, button) {
    if (button !== 0 || !this.isMouseOver(mx, my)) return false;
    const i = Math.floor((mx - this.x) / this.tw);
    if (i !== this.selected) { this.selected = i; if (this.onSelect) this.onSelect(i); }
    return true;
  }
}

/* ------------------------------ screens ------------------------------ */

/* A screen: init() lays out widgets from this.width / this.height (run again
   on every resize), render() draws, the input hooks pass to the widgets.
   background: 'panorama' (draw nothing: the game's turning view shows),
   'menu' (blurred panorama before a world, the darkened world in game, or the
   tiled background when there is neither), 'world', 'dirt', 'death', 'none'.
   Set animates = true while something moves, so the GUI redraws every frame. */
export class Screen {
  constructor(title = '') {
    this.title = title;
    this.widgets = [];
    this.background = 'menu';
    this.animates = false;
    this.closeOnEsc = true;
    this.gui = null; this.parent = null;
    this.width = 320; this.height = 240;
    this.focused = null;
    this.dragging = null;
  }
  get options() { return this.gui.options; }
  get hooks() { return this.gui.hooks; }
  add(w) { this.widgets.push(w); return w; }
  init() {}
  render(g, mx, my, dt) {
    for (let i = 0; i < this.widgets.length; i++) this.widgets[i].render(g, mx, my, dt);
  }
  listAt(mx, my) {
    for (const w of this.widgets) if (w instanceof ScrollList && w.visible && w.isMouseOver(mx, my)) return w;
    return null;
  }
  mouseClicked(mx, my, button) {
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      const hit = w.mouseClicked(mx, my, button);
      if (hit) {
        this.dragging = w;
        this.focused = hit instanceof Widget || hit instanceof ScrollList ? hit : w;
        return hit === true ? w : hit;
      }
    }
    return null;
  }
  mouseDragged(mx, my, button) { if (this.dragging) this.dragging.mouseDragged(mx, my, button); }
  mouseReleased(mx, my, button) { if (this.dragging) { this.dragging.mouseReleased(mx, my, button); this.dragging = null; } }
  mouseScrolled(mx, my, d) {
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (w.visible === false) continue;
      if (w instanceof ScrollList) { if (w.mouseScrolled(mx, my, d)) return true; }
      else if (w.isMouseOver(mx, my) && w.mouseScrolled(mx, my, d)) return true;
    }
    return false;
  }
  keyPressed(e) {
    const f = this.gui.textFocus;
    if (e.key === 'Escape') { this.onEscape(); return true; }
    if (f && f.keyPressed(e)) return true;
    if (e.key === 'Tab') return true;
    return false;
  }
  onEscape() { if (this.closeOnEsc) this.gui.back(); }
  onClose() {}
  // the title line most screens draw: white, centred
  drawTitle(g, y = 15) { if (this.title) g.centered(this.title, this.width / 2, y, WHITE); }
}


/* Screens with a header, a scrolling list of options and a Done button: the
   1.21 options sub-screens. Header 33 high (title at y 12), list from 33 to
   height - 33, footer with Done (200 wide). Subclasses fill this.rows(list). */
export class OptionsListScreen extends Screen {
  constructor(title) { super(title); this.headerH = 33; this.footerH = 33; this.itemHeight = 25; this.rowWidth = 310; }
  init() {
    const keep = this.list ? this.list.scroll : 0;
    this.list = this.add(new ScrollList(0, this.headerH, this.width, this.height - this.headerH - this.footerH, this.itemHeight, { rowWidth: this.rowWidth }));
    this.rows(this.list);
    this.list.setScroll(keep);
    this.footer();
  }
  rows() {}
  footer() {
    this.add(new Button(this.width / 2 - 100, this.height - this.footerH + 6, 200, 20, 'Done', () => this.gui.back()));
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    g.centered(this.title, this.width / 2, 12, WHITE);
  }
}
