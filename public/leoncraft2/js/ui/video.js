/* ---------------------------------------------------------------------------
   Leoncraft 2 - Video Settings, Shader Packs and Shader Options.

   Video Settings is the game's own screen as it is now (Java Edition 26):
   three sections, Display, Quality & Performance and Preferences, with the
   same buttons and sliders in the same order, the same names, values and
   tooltips. The Preset slider at the top of Quality & Performance sets all
   of that section at once (Fast, Fancy or Fabulous!, the game's own values
   for each), and reads Custom as soon as one of them is changed by hand.
   (View Bobbing, FOV Effects and the glint's speed and strength live in
   Accessibility Settings now, as they do in the game.)

   Shader Packs is where a shader mod would put it: Shaders ON or OFF, and
   Shader Options for ours, part by part, with Profiles (Low, Medium, High,
   Ultra) as shader packs have them.

   Nothing here does anything but change Options; settings.js puts each
   change into effect at once, while you play.
--------------------------------------------------------------------------- */
import { Button, Slider, CycleButton, WidgetRow, OptionsListScreen, onOff, WHITE } from './gui.js?v=17';
import { SHADER_DEFAULTS, SHADER_PRESET_NAMES, shaderSettings, presetOf, needsFullChain } from '../render/looks.js?v=17';

/* ------------------------------ helpers ------------------------------ */

const pct = v => Math.round(v * 100) + '%';
// a section's title in a list (Display, Quality & Performance...)
class Header {
  constructor(text) { this.text = text; }
  render(g, list, i, top) { g.centered(this.text, list.x + list.w / 2, top + 6, WHITE); }
}
const cycle = (label, values, value, format, onChange, tooltip) => new CycleButton(0, 0, 150, 20, label, { values, value, format, onChange, tooltip });
const toggle = (label, value, onChange, tip) => {
  const b = cycle(label, [false, true], !!value, onOff, onChange);
  if (tip) b.tooltip = tip;
  return b;
};
const slider = (o, extra) => new Slider(0, 0, 150, 20, o);
const off = (w, tip) => { w.active = false; if (tip) w.tooltip = tip; return w; };
const wide = w => { const r = new WidgetRow(w); return r; };

/* Fullscreen, as the game's own button. In a window the browser keeps Esc
   for itself: it lets go of the mouse, and will not give it back for a
   second and a quarter, nor at all for a key (Esc to leave the game menu)
   rather than a click. In fullscreen the page may keep Esc (the keyboard
   lock), so Esc opens and closes the game menu with the mouse taken back at
   once, as in the game; holding Esc leaves fullscreen. */
export function setFullscreen(on) {
  const d = document;
  if (on && !d.fullscreenElement && d.documentElement.requestFullscreen) {
    d.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      // Esc, and the keys played with Ctrl held to sprint (Ctrl+W would close the tab, Ctrl+1 change it)
      const keys = ['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'];
      for (let n = 1; n <= 9; n++) keys.push('Digit' + n);
      if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(keys).catch(() => {});
    }, () => {});
  } else if (!on && d.fullscreenElement) d.exitFullscreen().catch(() => {});
}

/* ------------------------------ the presets ------------------------------ */

/* What each Preset sets, as the game has it: [Fast, Fancy, Fabulous!].
   Biome Blend is the radius (1 is 3 x 3, 2 is 5 x 5). */
export const PRESET_VALUES = {
  biomeBlend: [1, 2, 2], renderDistance: [8, 16, 32], chunkBuilder: ['threaded', 'semi', 'semi'], simulationDistance: [6, 12, 12],
  smoothLighting: [false, true, true], clouds: ['fast', 'fancy', 'fancy'], particles: ['decreased', 'all', 'all'], mipmapLevels: [2, 4, 4],
  entityShadows: [false, true, true], entityDistance: [0.75, 1, 1.25], menuBlur: [2, 5, 5], cloudDistance: [32, 64, 128],
  cutoutLeaves: [false, true, true], improvedTransparency: [false, false, true], textureFiltering: ['none', 'rgss', 'anisotropic'],
  maxAnisotropy: [2, 2, 4], weatherRadius: [5, 10, 10],
};
export const PRESETS = ['fast', 'fancy', 'fabulous'];
const PRESET_NAMES = { fast: 'Fast', fancy: 'Fancy', fabulous: 'Fabulous!', custom: 'Custom' };
const PRESET_TIPS = {
  fast: 'Fast graphics reduces the amount of visible rain and snow.\nTransparency effects are disabled for various blocks such as leaves.',
  fancy: 'Fancy graphics balances performance and quality for the majority of machines.\nWeather, clouds, and particles may not appear behind translucent blocks or water.',
  fabulous: 'Fabulous! graphics uses screen shaders for drawing weather, clouds, and particles behind translucent blocks and water.\nThis may severely impact performance for portable devices and 4K displays.',
};
// the farthest render distance there is (the game's: 32, or 16 with little memory)
export function maxRenderDistance() { return navigator.deviceMemory && navigator.deviceMemory < 2 ? 16 : 32; }
// which preset the settings match now, or 'custom'
export function presetNow(o) {
  const rdMax = maxRenderDistance();
  for (let i = 0; i < PRESETS.length; i++) {
    let same = true;
    for (const k in PRESET_VALUES) {
      const want = k === 'renderDistance' ? Math.min(rdMax, PRESET_VALUES[k][i]) : PRESET_VALUES[k][i];
      if (o.get(k) !== want) { same = false; break; }
    }
    if (same) return PRESETS[i];
  }
  return 'custom';
}
export function applyPreset(o, name) {
  const i = PRESETS.indexOf(name);
  if (i < 0) return;
  const rdMax = maxRenderDistance();
  for (const k in PRESET_VALUES) o.set(k, k === 'renderDistance' ? Math.min(rdMax, PRESET_VALUES[k][i]) : PRESET_VALUES[k][i]);
  o.set('graphicsPreset', name);
}

const BLEND = ['OFF (Fastest)', '3x3 (Fast)', '5x5 (Normal)', '7x7 (High)', '9x9 (Very High)', '11x11 (Extreme)', '13x13 (Showoff)', '15x15 (Maximum)'];
const BUILDER = { threaded: 'Threaded', semi: 'Semi Blocking', full: 'Fully Blocking' };
const BUILDER_TIPS = {
  threaded: 'Nearby chunks are compiled in parallel threads. This may result in brief visual holes when blocks are destroyed.',
  semi: 'Some actions within a chunk will recompile the chunk immediately. This includes block placing & destroying.',
  full: 'Nearby chunks are always compiled immediately. This may impact game performance when blocks are placed or destroyed.',
};
const FILTER = { none: 'None', rgss: 'RGSS', anisotropic: 'Anisotropic' };
const FILTER_TIPS = {
  none: 'Textures are displayed without any filtering. Blocks may look blurry when viewed at an angle.',
  rgss: '(Rotated Grid Super Sampling)\nA shader based filtering method that improves texture quality with a moderate performance impact.',
  anisotropic: 'A hardware based filtering method, but impacts performance and significantly impacts video memory usage. May not be supported on all hardware.',
};
const CLOUDS = { fancy: 'Fancy', fast: 'Fast', off: 'OFF' };
const PARTICLES = { all: 'All', decreased: 'Decreased', minimal: 'Minimal' };
const ATTACK = { off: 'OFF', crosshair: 'Crosshair', hotbar: 'Hotbar' };
const AFK = { afk: 'AFK', minimized: 'Minimized' };
const AFK_TIPS = {
  afk: 'Limits framerate to 30 when the game is not getting any player input for more than a minute. Further limits it to 10 after 9 more minutes.',
  minimized: 'Limits framerate only when the game window is minimized.',
};

/* ------------------------------ Video Settings ------------------------------ */

export class VideoSettingsScreen extends OptionsListScreen {
  constructor() { super('Video Settings'); }
  // a Quality & Performance setting changed by hand: the Preset says which it matches now (Custom, mostly)
  touched() {
    const o = this.options, p = presetNow(o);
    if (o.get('graphicsPreset') !== p) o.set('graphicsPreset', p);
    if (this.presetW) { this.presetW.value = PRESETS.indexOf(p) >= 0 ? PRESETS.indexOf(p) : this.presetW.value; this.gui.markDirty(); }
  }
  // the whole list again (a preset changes most of what it shows), keeping where it was scrolled to
  refresh() { this.gui._initScreen(this); this.gui.markDirty(); }
  // Control and the wheel: the GUI Scale, a step at a time, as in the game
  mouseScrolled(mx, my, d) {
    if (!this.gui.wheelCtrl) return super.mouseScrolled(mx, my, d);
    const o = this.options, max = this.gui.maxScale;
    let v = (o.get('guiScale') | 0) || this.gui.scale;
    v = Math.max(0, Math.min(max, v + (d > 0 ? 1 : -1)));
    // (the GUI lays itself out again for the new scale: gui.js)
    o.set('guiScale', v);
    return true;
  }
  rows(list) {
    const o = this.options, g = this.gui;
    const set = (k, v) => { o.set(k, v); this.touched(); };
    const rdMax = maxRenderDistance();

    /* ---- Display ---- */
    const res = off(slider({ min: 0, max: 1, step: 1, value: 0, label: () => 'Fullscreen Resolution: Current' }),
      'The browser keeps your screen at its own resolution.');
    const fps0 = o.get('maxFps');
    const fps = slider({
      min: 10, max: 260, step: 10, value: fps0 ? Math.min(260, fps0) : 260,
      label: v => 'Max Framerate: ' + (v >= 260 ? 'Unlimited' : v + ' fps'),
      onChange: v => o.set('maxFps', v >= 260 ? 0 : v),
    });
    const vsync = toggle('VSync', o.get('vsync') !== false, v => o.set('vsync', v),
      'The browser shows whole frames only, in step with the screen. OFF keeps one frame fewer waiting for the graphics card, so the game answers your hand a little sooner.');
    const afk = cycle('Reduce FPS when', ['afk', 'minimized'], o.get('inactivityFpsLimit') || 'afk', v => AFK[v], v => o.set('inactivityFpsLimit', v), v => AFK_TIPS[v]);
    const gs = slider({
      min: 0, max: g.maxScale, step: 1, value: Math.min(o.get('guiScale') | 0, g.maxScale),
      label: v => 'GUI Scale: ' + (v ? v : 'Auto'),
      // applied when the handle is let go, so the screen does not jump under the pointer
      onRelease: v => o.set('guiScale', v),
    });
    const full = toggle('Fullscreen', !!document.fullscreenElement, v => setFullscreen(v),
      'In fullscreen Esc goes to the game menu and back at once. Hold Esc to leave fullscreen.');
    const excl = off(toggle('Exclusive Fullscreen', false, null), 'A web page can only use the screen as the browser gives it.');
    const br = slider({
      min: 0, max: 1, step: 0.01, value: o.get('brightness'),
      label: v => 'Brightness: ' + (v <= 0 ? 'Moody' : v >= 1 ? 'Bright' : Math.abs(v - 0.5) < 0.005 ? 'Default' : Math.round(v * 100) + '%'),
      onChange: v => o.set('brightness', Math.abs(v - 0.5) < 0.005 ? 0.5 : v),
    });
    const api = off(cycle('Graphics API', ['default'], 'default', () => 'Default'), 'The browser draws the game with WebGL 2.');

    /* ---- Quality & Performance ---- */
    const p0 = o.get('graphicsPreset');
    const preset = this.presetW = slider({
      min: 0, max: 2, step: 1, value: Math.max(0, PRESETS.indexOf(p0 === 'custom' ? 'fancy' : p0)),
      label: () => 'Preset: ' + PRESET_NAMES[o.get('graphicsPreset')] ,
      onChange: v => { applyPreset(o, PRESETS[v]); this.refresh(); },
    });
    preset.tooltip = 'Sets "Quality & Performance" settings to reasonable defaults corresponding to the desired quality.';
    Object.defineProperty(preset, 'tooltip', { get: () => {
      const p = o.get('graphicsPreset');
      return 'Sets "Quality & Performance" settings to reasonable defaults corresponding to the desired quality.' + (PRESET_TIPS[p] ? '\n\n' + PRESET_TIPS[p] : '');
    }, set: () => {} });
    const blend = slider({ min: 0, max: 7, step: 1, value: o.get('biomeBlend'), label: v => 'Biome Blend: ' + BLEND[v], onChange: v => set('biomeBlend', v) });
    const rd = slider({
      min: 2, max: rdMax, step: 1, value: Math.min(rdMax, o.get('renderDistance') || 8),
      label: v => 'Render Distance: ' + v + ' Chunks', onChange: v => set('renderDistance', v),
    });
    const builder = cycle('Chunk Builder', ['threaded', 'semi', 'full'], o.get('chunkBuilder'), v => BUILDER[v], v => set('chunkBuilder', v), v => BUILDER_TIPS[v]);
    const sim = slider({
      min: 5, max: 32, step: 1, value: o.get('simulationDistance'),
      label: v => 'Simulation Distance: ' + v + ' Chunks', onChange: v => set('simulationDistance', v),
    });
    const smooth = toggle('Smooth Lighting', o.get('smoothLighting'), v => set('smoothLighting', v));
    const clouds = cycle('Clouds', ['off', 'fast', 'fancy'], o.get('clouds'), v => CLOUDS[v], v => set('clouds', v));
    const parts = cycle('Particles', ['all', 'decreased', 'minimal'], o.get('particles'), v => PARTICLES[v], v => set('particles', v));
    const mip = slider({ min: 0, max: 4, step: 1, value: o.get('mipmapLevels'), label: v => 'Mipmap Levels: ' + (v ? v : 'OFF'), onChange: v => set('mipmapLevels', v) });
    const shadows = toggle('Entity Shadows', o.get('entityShadows'), v => set('entityShadows', v));
    const ed = slider({ min: 0.5, max: 5, step: 0.25, value: o.get('entityDistance'), label: v => 'Entity Distance: ' + pct(v), onChange: v => set('entityDistance', v) });
    const blur = slider({ min: 0, max: 10, step: 1, value: o.get('menuBlur'), label: v => 'Menu Background Blur: ' + (v ? v : 'OFF'), onChange: v => set('menuBlur', v) });
    blur.tooltip = 'Changes the blurriness of menu backgrounds.';
    const cd = slider({ min: 2, max: 128, step: 1, value: o.get('cloudDistance'), label: v => 'Cloud Distance: ' + v + ' Chunks', onChange: v => set('cloudDistance', v) });
    const leaves = toggle('See-Through Leaves', o.get('cutoutLeaves'), v => set('cutoutLeaves', v),
      'Allows you to see through gaps in leaves. Disabling improves performance.');
    const it = toggle('Improved Transparency', o.get('improvedTransparency'), v => set('improvedTransparency', v),
      'An experimental approach that uses screen shaders for drawing weather, clouds, and particles behind translucent blocks and water.\nThis will impact GPU performance.');
    const aniso = slider({
      min: 1, max: 3, step: 1, value: Math.max(1, Math.round(Math.log2(o.get('maxAnisotropy') || 2))),
      label: v => 'Anisotropic Filtering: ' + Math.pow(2, v) + 'x', onChange: v => set('maxAnisotropy', Math.pow(2, v)),
    });
    aniso.tooltip = 'Each level significantly improves how smooth textures look, but impacts performance and significantly impacts video memory usage. Requires Texture Filtering to be set to Anisotropic.';
    aniso.active = o.get('textureFiltering') === 'anisotropic';
    const filt = cycle('Texture Filtering', ['none', 'rgss', 'anisotropic'], o.get('textureFiltering'), v => FILTER[v],
      v => { set('textureFiltering', v); aniso.active = v === 'anisotropic'; }, v => FILTER_TIPS[v]);
    const weather = slider({ min: 3, max: 10, step: 1, value: o.get('weatherRadius'), label: v => 'Weather Effect Radius: ' + v + ' Blocks', onChange: v => set('weatherRadius', v) });
    weather.tooltip = 'Radius of the area where rain and snow effects are visible. Very low performance impact.';

    /* ---- Preferences ---- */
    const autosave = toggle('Autosave Indicator', o.get('autosaveIndicator'), v => o.set('autosaveIndicator', v));
    const vig = toggle('Show Vignette', o.get('vignette'), v => o.set('vignette', v),
      'This is a subtle texture over the game screen used for reducing brightness towards the edges of the screen and warning about the world border.');
    const atk = cycle('Attack Indicator', ['off', 'crosshair', 'hotbar'], o.get('attackIndicator'), v => ATTACK[v], v => o.set('attackIndicator', v));
    const fade = slider({
      min: 0, max: 1, step: 0.05, value: o.get('chunkFade'),
      label: v => v <= 0 ? 'Chunk Fade: None' : 'Chunk Fade: ' + (+v.toFixed(2)) + ' second(s)', onChange: v => o.set('chunkFade', v),
    });
    fade.tooltip = 'How long in seconds chunks should fade in when they\'re first rendered, if at all.';

    list.entries = [
      new Header('Display'),
      wide(res),
      new WidgetRow(fps, vsync),
      new WidgetRow(afk, gs),
      new WidgetRow(full, excl),
      new WidgetRow(br, api),
      new Header('Quality & Performance'),
      wide(preset),
      new WidgetRow(blend, rd),
      new WidgetRow(builder, sim),
      new WidgetRow(smooth, clouds),
      new WidgetRow(parts, mip),
      new WidgetRow(shadows, ed),
      new WidgetRow(blur, cd),
      new WidgetRow(leaves, it),
      new WidgetRow(filt, aniso),
      new WidgetRow(weather),
      new Header('Preferences'),
      new WidgetRow(autosave, vig),
      new WidgetRow(atk, fade),
    ];
    // a lone half-width button stays half width, as the game lays it out
    list.entries[16].children[0].wide = false;
  }
  footer() {
    const W = this.width, H = this.height;
    this.add(new Button(W / 2 - 155, H - 27, 150, 20, 'Shader Packs...', () => this.gui.open(new ShaderPacksScreen())));
    this.add(new Button(W / 2 + 5, H - 27, 150, 20, 'Done', () => this.gui.back()));
  }
}

/* ------------------------------ Shader Packs ------------------------------ */

// our one pack, as a shader mod's list shows a pack: its name and what it does
class PackRow {
  constructor(on) { this.on = on; }
  render(g, list, i, top, left, width) {
    const x0 = Math.floor(list.x + (list.w - list.rowWidth) / 2), x1 = Math.floor(list.x + (list.w + list.rowWidth) / 2);
    g.fill(x0, top - 2, x1, top + 34, this.on() ? 0xFFFFFFFF : 0xFF808080);
    g.fill(x0 + 1, top - 1, x1 - 1, top + 33, 0xFF000000);
    g.text('Leoncraft Shaders', left + 4, top + 2, this.on() ? 0xFFFFFF : 0xA0A0A0);
    g.text('Sun shadows, a real sky, water that shines,', left + 4, top + 13, 0x808080);
    g.text('plants in the wind, bloom and light shafts', left + 4, top + 23, 0x808080);
  }
}
export class ShaderPacksScreen extends OptionsListScreen {
  constructor() { super('Shader Packs'); this.itemHeight = 25; }
  refresh() { this.gui._initScreen(this); this.gui.markDirty(); }
  rows(list) {
    const o = this.options;
    const on = () => o.get('shaders') === null || o.get('shaders') === undefined ? !!(this.gui.hooks.shadersOn && this.gui.hooks.shadersOn()) : !!o.get('shaders');
    const sw = new CycleButton(0, 0, 310, 20, 'Shaders', {
      values: [false, true], value: on(), format: onOff, onChange: v => { o.set('shaders', v); this.refresh(); },
      tooltip: v => v ? 'Our shader: shadows from the sun and moon, a real sky, water with the sky in it, plants and leaves in the wind, and more in Shader Options.'
        : 'No shaders: the game as it draws itself.',
    });
    const optsB = new Button(0, 0, 310, 20, 'Shader Options...', () => this.gui.open(new ShaderOptionsScreen()));
    if (!on()) off(optsB, 'Turn Shaders ON to change them.');
    const pack = new PackRow(on);
    list.entries = [new WidgetRow(sw), pack, { render() {} }, new WidgetRow(optsB)];
  }
}

/* ------------------------------ Shader Options ------------------------------ */

const LEVELS = { off: 'OFF', low: 'Low', medium: 'Medium', high: 'High' };
const PROFILE_NAMES = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', custom: 'Custom' };
const PROFILE_TIPS = {
  low: 'No shadows, gentle grass, still leaves and still water: the quickest shader look.',
  medium: 'Soft sun shadows near you, plants and leaves in the wind, the sky in the water. Nearly as smooth as no shaders.',
  high: 'Sharper shadows reaching further.',
  ultra: 'Everything: light worked out per pixel with normal maps, bloom, light shafts, volumetric clouds and their shadows, and reflections of the world in the water. Needs a strong graphics card.',
  custom: 'Your own choice of each part.',
};
const FULL = ' Needs the full shader pipeline, which costs more.';
const SUN = { warm: 'Warm', natural: 'Natural', cool: 'Cool' };
const WATER = { vanilla: 'Vanilla', sheen: 'Sheen', reflections: 'Reflections' };
const CLOUD_STYLE = { blocks: 'Blocks', volumetric: 'Volumetric', off: 'OFF' };
const AA = { off: 'OFF', fxaa: 'FXAA' };
const TONE = { agx: 'AgX', aces: 'ACES', reinhard: 'Reinhard' };
const TONE_TIPS = {
  agx: 'Keeps the colour of bright light, and fades the brightest to white gently. The default.',
  aces: 'The film curve: deeper shadows and richer colour, with more punch.',
  reinhard: 'Soft and even: lighter shadows, paler bright light.',
};

export class ShaderOptionsScreen extends OptionsListScreen {
  constructor() { super('Shader Options'); }
  refresh() { this.gui._initScreen(this); this.gui.markDirty(); }
  rows(list) {
    const o = this.options;
    const s = shaderSettings(o.get('shaderPreset') || 'medium', o.get('shader'));
    // one part changed: the settings become the player's own, unless they match a profile again
    const set = (k, v, redo) => {
      const next = Object.assign({}, s, { [k]: v });
      s[k] = v;
      const p = presetOf(next);
      if (p === 'custom') { const own = {}; for (const key in SHADER_DEFAULTS) own[key] = next[key]; o.set('shader', own); }
      o.set('shaderPreset', p);
      if (this.profileW) { this.profileW.value = p; this.profileW._msg(); }
      if (redo) this.refresh(); else this.gui.markDirty();
    };
    const lv = (label, k, values, names, tips, redo) => cycle(label, values, s[k], v => names[v], v => set(k, v, redo), tips ? (typeof tips === 'function' ? tips : () => tips) : null);
    const sl = (k, min, max, step, label, tip) => { const w = slider({ min, max, step, value: s[k], label: v => label(v), onChange: v => set(k, v) }); if (tip) w.tooltip = tip; return w; };
    const tg = (label, k, tip, redo) => toggle(label, s[k], v => set(k, v, redo), tip);

    const prof = this.profileW = cycle('Profile', SHADER_PRESET_NAMES, o.get('shaderPreset') === 'custom' ? 'custom' : o.get('shaderPreset') || 'medium', v => PROFILE_NAMES[v],
      v => { o.set('shaderPreset', v); o.set('shader', {}); this.refresh(); }, v => PROFILE_TIPS[v] + (v === 'custom' ? '' : '\n\nThe pipeline: ' + (needsFullChain(shaderSettings(v)) ? 'full (post-processing)' : 'light (one pass)') + '.'));
    // Custom is shown, never picked from the button
    if (o.get('shaderPreset') === 'custom') { prof.value = 'custom'; prof._msg(); }

    const shadowsOn = s.shadows !== 'off';
    const sh = lv('Shadows', 'shadows', ['off', 'low', 'medium', 'high'], LEVELS,
      v => v === 'off' ? 'No shadow map: places under a roof are shaded by their light level alone.' : 'Shadows from the sun and moon, from a ' + { low: 512, medium: 1024, high: 2048 }[v] + ' pixel map: sharper the higher it goes.', true);
    const shd = sl('shadowDistance', 32, 160, 16, v => 'Shadow Distance: ' + v + ' Blocks', 'How far from you the shadows reach. Further makes them less sharp.');
    const shs = sl('shadowSoftness', 0, 1, 0.05, v => 'Shadow Softness: ' + (v <= 0 ? 'Hard' : pct(v)), 'How soft the edges of shadows are.');
    if (!shadowsOn) { shd.active = false; shs.active = false; }
    const cls = tg('Cloud Shadows', 'cloudShadows', 'Shadows of the clouds drifting over the ground.');

    const ao = sl('ao', 0, 1, 0.05, v => 'Ambient Occlusion: ' + (v <= 0 ? 'OFF' : pct(v)), 'How dark the corners and the ground beside blocks are.');
    const hl = tg('Hand Light', 'heldLight', 'A torch, lantern or glowstone in your hand lights what is round you.');
    const sunc = lv('Sun Colour', 'sunColour', ['warm', 'natural', 'cool'], SUN, 'The colour of sunlight: a golden afternoon, the default, or a cooler white.');
    const sunb = sl('sunBrightness', 0.5, 1.5, 0.05, v => 'Sun Brightness: ' + pct(v), 'How strong the sun and moon light is.');
    const skyl = sl('skyLight', 0.5, 1.5, 0.05, v => 'Sky Light: ' + pct(v), 'How much light the sky gives in the shade.');
    const skyc = sl('skyColour', 0, 1.5, 0.05, v => 'Sky Colour: ' + (v <= 0 ? 'Grey' : pct(v)), 'How deep the blue of the sky, and of the fog and water that take its colour, is.');
    const nm = tg('Normal Maps', 'normalMaps', 'Bumps on every block\'s surface, lit per pixel.' + FULL, true);

    const wt = lv('Water', 'water', ['vanilla', 'sheen', 'reflections'], WATER,
      v => v === 'vanilla' ? 'The water\'s own texture, as the game draws it, lit by the shader.' : v === 'sheen' ? 'Clear water with the sky in it and the sun\'s glint on the waves.' : 'The world on the shore reflected in the water as well as the sky.' + FULL, true);
    const rf = lv('Reflections', 'reflections', ['low', 'high'], { low: 'Low', high: 'High' }, 'How far into the picture a reflection looks for what to show.');
    if (s.water !== 'reflections') off(rf, 'Only with Water: Reflections.');
    const wv = lv('Waves', 'waves', ['off', 'low', 'high'], LEVELS,
      v => v === 'off' ? 'Still water: no waves, the cheapest.' : v === 'low' ? 'Gentle waves, half as high, and a little cheaper.' : 'Waves running over the water, and the surface rising and falling with them.');

    const wp = lv('Waving Plants', 'wavingPlants', ['off', 'low', 'high'], LEVELS, 'Grass, flowers, crops and kelp moving in the wind and out of your way.');
    const wl = lv('Waving Leaves', 'wavingLeaves', ['off', 'low', 'high'], LEVELS, 'Leaves moving in the wind.');

    const cl = lv('Clouds', 'clouds', ['blocks', 'volumetric', 'off'], CLOUD_STYLE,
      v => v === 'blocks' ? 'The game\'s blocks of cloud, lit by the shader (Clouds in Video Settings says Fancy or Fast).' : v === 'volumetric' ? 'Soft, deep clouds, marched through.' + FULL : 'No clouds.', true);
    const fog = sl('fog', 0, 2, 0.05, v => 'Fog: ' + (v <= 0 ? 'OFF' : pct(v)), 'How thick the haze over the distance is. The edge of the world always melts into the sky.');
    const ls = lv('Light Shafts', 'lightShafts', ['off', 'low', 'high'], LEVELS, 'Sunbeams through the leaves and the air. High: stronger beams, more finely drawn.' + FULL, true);
    const bl = lv('Bloom', 'bloom', ['off', 'low', 'high'], LEVELS, 'A soft glow round bright things.' + FULL, true);

    const tm = lv('Tone Mapping', 'tone', ['agx', 'aces', 'reinhard'], TONE, v => TONE_TIPS[v] + ' Costs nothing either way.');
    const ex = sl('exposure', -2, 2, 0.1, v => 'Exposure: ' + (v > 0 ? '+' : '') + v.toFixed(1), 'Brighter or darker, in stops.');
    const ct = sl('contrast', 0.5, 1.5, 0.05, v => 'Contrast: ' + pct(v), 'How far apart the darks and the brights are.');
    const sat = sl('saturation', 0, 2, 0.05, v => 'Saturation: ' + pct(v), 'How strong the colours are.');
    const aa = lv('Anti-aliasing', 'antialiasing', ['off', 'fxaa'], AA, 'Smooths jagged edges (the full pipeline only), a little blurrier.');
    if (!needsFullChain(s)) off(aa, 'Only in the full pipeline (bloom, light shafts, volumetric clouds, reflections or normal maps).');

    const rs0 = o.get('renderScale');
    const rs = slider({
      min: 35, max: 100, step: 5, value: rs0 === 'auto' ? 35 : Math.round(rs0 * 100),
      label: v => v <= 35 ? 'Render Resolution: Auto' : 'Render Resolution: ' + v + '%',
      onChange: v => o.set('renderScale', v <= 35 ? 'auto' : v / 100),
    });
    rs.tooltip = 'How many pixels the 3D view draws. Lower is faster and blurrier. Auto follows the frame rate.';

    list.entries = [
      wide(prof),
      new Header('Shadows'),
      new WidgetRow(sh, shd), new WidgetRow(shs, cls),
      new Header('Lighting'),
      new WidgetRow(ao, hl), new WidgetRow(sunc, sunb), new WidgetRow(skyl, skyc), new WidgetRow(nm),
      new Header('Water'),
      new WidgetRow(wt, rf), new WidgetRow(wv),
      new Header('Wind'),
      new WidgetRow(wp, wl),
      new Header('Sky and Atmosphere'),
      new WidgetRow(cl, fog), new WidgetRow(ls, bl),
      new Header('Camera'),
      new WidgetRow(tm, ex), new WidgetRow(ct, sat), new WidgetRow(aa),
      new Header('Performance'),
      new WidgetRow(rs),
    ];
    for (const e of list.entries) if (e.children && e.children.length === 1 && e !== list.entries[0]) e.children[0].wide = false;
  }
}
