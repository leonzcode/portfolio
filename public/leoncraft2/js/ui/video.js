/* ---------------------------------------------------------------------------
   Leoncraft 2 - Video Settings.

   Video Settings is the game's own screen as it is now (Java Edition 26):
   three sections, Display, Quality & Performance and Preferences, with the
   same buttons and sliders in the same order, the same names, values and
   tooltips. The Preset slider at the top of Quality & Performance sets all
   of that section at once (Fast, Fancy or Fabulous!, the game's own values
   for each), and reads Custom as soon as one of them is changed by hand.
   (View Bobbing, FOV Effects and the glint's speed and strength live in
   Accessibility Settings now, as they do in the game.)

   The one button the game does not have sits beside Done, where a shader mod
   puts its own: Shaders, cycled like the game's buttons through Off, Low,
   Medium, High and RIP Computer (render/looks.js says what each one is).
   Off, the default, is the game as it draws itself.

   Nothing here does anything but change Options; settings.js puts each
   change into effect at once, while you play.
--------------------------------------------------------------------------- */
import { Button, Slider, CycleButton, WidgetRow, OptionsListScreen, onOff, WHITE } from './gui.js?v=107';
import { SHADER_LEVELS } from '../render/looks.js?v=107';
import { MinimapSettingsScreen } from './minimap.js?v=107';

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
    // (no tooltip, as in the game: ON shows whole frames in step with the screen, OFF keeps one frame fewer waiting for the graphics card)
    const vsync = toggle('VSync', o.get('vsync') !== false, v => o.set('vsync', v));
    const afk = cycle('Reduce FPS when', ['afk', 'minimized'], o.get('inactivityFpsLimit') || 'afk', v => AFK[v], v => o.set('inactivityFpsLimit', v), v => AFK_TIPS[v]);
    const gs = slider({
      min: 0, max: g.maxScale, step: 1, value: Math.min(o.get('guiScale') | 0, g.maxScale),
      label: v => 'GUI Scale: ' + (v ? v : 'Auto'),
      // applied when the handle is let go, so the screen does not jump under the pointer
      onRelease: v => o.set('guiScale', v),
    });
    // (no tooltip, as in the game; the browser says itself to hold Esc to leave fullscreen)
    const full = toggle('Fullscreen', !!document.fullscreenElement, v => setFullscreen(v));
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

    // ours, as the mods add them: Fullbright, and the minimap's settings (ui/minimap.js)
    const fb = fullbrightButton(0, 0, 150, o);
    const mm = new Button(0, 0, 150, 20, 'Minimap Settings...', () => g.open(new MinimapSettingsScreen()));

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
      new WidgetRow(fb, mm),
    ];
    // a lone half-width button stays half width, as the game lays it out
    list.entries[16].children[0].wide = false;
  }
  footer() {
    const W = this.width, H = this.height;
    this.add(shadersButton(W / 2 - 155, H - 27, 150, this.options));
    this.add(new Button(W / 2 + 5, H - 27, 150, 20, 'Done', () => this.gui.back()));
  }
}

/* ------------------------------ Fullbright ------------------------------ */

/* Fullbright, here and in the game menu, as the Fullbright mods do it: the
   game's gamma pushed to 1500%, so caves and the night are lit as by day,
   in every dimension and at every Shaders level, and nothing else changes
   (render/vanilla.js makeLightmap, dim/look.js; settings.js puts it on). */
export function fullbrightButton(x, y, w, o) {
  return new CycleButton(x, y, w, 20, 'Fullbright', {
    values: [false, true], value: !!o.get('fullbright'), format: onOff,
    tooltip: () => 'Lights caves and the night as if by day, as the Fullbright mods do.',
    onChange: v => o.set('fullbright', v),
  });
}

/* ------------------------------ Shaders ------------------------------ */

// the Shaders cycle button, here and in the game menu (Esc): each click puts the level on at once
export function shadersButton(x, y, w, o) {
  const now = SHADER_LEVELS.includes(o.get('shaderLevel')) ? o.get('shaderLevel') : 'off';
  return new CycleButton(x, y, w, 20, 'Shaders', {
    values: SHADER_LEVELS, value: now, format: v => SHADER_NAMES[v], tooltip: v => SHADER_TIPS[v],
    onChange: v => o.set('shaderLevel', v),
  });
}

const SHADER_NAMES = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High', rip: 'RIP Computer' };
const SHADER_TIPS = {
  off: 'No shaders: the game as it draws itself. The fastest.',
  low: 'Light shaders: hard shadows from the sun and moon, a real sky, the sky in the water and grass in the wind. Nearly as fast as no shaders.',
  medium: 'Soft shadows from the sun and moon, waves on the water, and plants and leaves in the wind. Runs well on most computers.',
  high: 'The full shader look: bloom, light shafts through the leaves, deep clouds and their shadows, the world reflected in the water, bumpy block surfaces and soft shadows far out. Needs a strong graphics card.',
  rip: 'Everything at its most: the sharpest shadows reaching furthest, the finest light shafts, clouds and reflections, and stronger bloom. Only for the most powerful graphics cards.',
};
