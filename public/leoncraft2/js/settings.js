/* ---------------------------------------------------------------------------
   Leoncraft 2 - Video Settings and Shader Packs, put into effect while you
   play.

   The screens (ui/video.js) only change Options; this hears every change and
   does what it means, at once and without loading anything again:

     the look              Shaders ON or OFF and the Shader Options (render/looks.js)
     the meshes            See-Through Leaves, Smooth Lighting, Biome Blend: every
                           column made again in the workers, the old one shown
                           until its new one is in (world.js setMeshing)
     Chunk Builder         world.builder
     textures              Mipmap Levels, Texture Filtering, Anisotropic Filtering
     distances             Simulation Distance, Entity Distance, Cloud Distance,
                           Weather Effect Radius
     the rest              Particles, Entity Shadows, Attack Indicator, Chunk
                           Fade, Glint Speed and Strength, Damage Tilt
     frames                Max Framerate, VSync, Reduce FPS when (hold())
     over the game         the vignette (Show Vignette) and "Saving world"
                           (Autosave Indicator)

   main.js makes one at start, gives it the renderer and the GUI (attach),
   asks it before every frame whether to draw one (hold) and calls frame()
   once a frame with the game.
--------------------------------------------------------------------------- */
import { shaderSettings, lookOf, setFiltering, loadNormalMaps } from './render/looks.js?v=16';
import { particleSetting } from './render/particles.js?v=16';

export class VideoSettings {
  constructor(options, guessShaders) {
    this.o = options;
    // with no choice made, the shaders are on unless there is no graphics chip at all
    this.guessed = guessShaders;
    this.lastInput = performance.now();
    this.vig = 0;
    this.saveFlash = -1e9;
    this.playTicks = 0;
    for (const ev of ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart']) window.addEventListener(ev, () => { this.lastInput = performance.now(); }, { passive: true, capture: true });
    particleSetting.level = options.get('particles') || 'all';
  }
  shadersOn() { const v = this.o.get('shaders'); return v === null || v === undefined ? this.guessed : !!v; }
  shader() { return shaderSettings(this.o.get('shaderPreset') || 'medium', this.o.get('shader')); }
  // everything the renderer is told about the look: the shader's (or the game's own) and the Video Settings that reach it
  look() {
    const o = this.o;
    return Object.assign(lookOf(this.shader(), this.shadersOn()), {
      rgss: o.get('textureFiltering') === 'rgss', improvedTransparency: !!o.get('improvedTransparency'),
      cloudDist: o.get('cloudDistance'), weatherRadius: o.get('weatherRadius'), chunkFade: o.get('chunkFade'),
    });
  }
  worldOpts() {
    const o = this.o;
    return { fastLeaves: !o.get('cutoutLeaves'), blend: o.get('biomeBlend'), flatLight: !o.get('smoothLighting'), builder: o.get('chunkBuilder') };
  }

  /* ---- once the renderer and the GUI are there ---- */
  attach({ renderer, gui, normalsUrl, blockLayers, packed }) {
    this.R = renderer; this.gui = gui;
    this.normalsUrl = normalsUrl; this.blockLayers = blockLayers; this.packed = packed;
    this.filtering();
    this.normals();
    this.R.U.uGlint.value.set(this.o.get('glintSpeed'), this.o.get('glintStrength'));
    // no blur behind the menus only with no graphics chip at all (Menu Background Blur works with or without shaders)
    gui.lowEnd = !this.guessed;
    // "Saving world", bottom right, as the game shows it when it saves by itself
    gui.overlays.push(this.saveOverlay = {
      video: this,
      get animates() { return performance.now() - this.video.saveFlash < 2600; },
      draw(g) { this.video.drawSaving(g); },
    });
    this.o.onChange((k, v) => this.changed(k, v));
  }
  filtering() {
    const o = this.o;
    setFiltering(this.R, o.get('mipmapLevels'), o.get('textureFiltering') === 'anisotropic' ? o.get('maxAnisotropy') : 1);
  }
  // normal maps: fetched the first time a look wants them (and never with a resource pack's textures in)
  normals() {
    if (!this.R.opts.normals || this.R.normalsLoaded || !this.normalsUrl || this.packed) return;
    loadNormalMaps(this.R, this.normalsUrl, this.blockLayers);
  }
  relook() {
    this.R.setLook(this.look());
    this.normals();
  }

  /* ---- an option changed ---- */
  changed(k, v) {
    const R = this.R, g = this.game;
    switch (k) {
      case 'shaders': case 'shaderPreset': case 'shader': case 'improvedTransparency': case 'textureFiltering':
        this.relook();
        if (k === 'textureFiltering') this.filtering();
        break;
      case 'quality':
        // the old Graphics setting, for anything that still sets it: Fast is Shaders OFF, anything else ON
        if (v === 'fast' || v === 'potato') this.o.set('shaders', false); else if (v && v !== 'auto') this.o.set('shaders', true);
        break;
      case 'mipmapLevels': case 'maxAnisotropy': this.filtering(); break;
      case 'cloudDistance': R.opts.cloudDist = v; break;
      case 'weatherRadius': R.opts.weatherRadius = v; break;
      case 'chunkFade': R.opts.chunkFade = v; break;
      case 'brightness': R.U.uBrightD.value = v - 0.5; break;
      case 'particles': particleSetting.level = v; break;
      case 'glintSpeed': case 'glintStrength': R.U.uGlint.value.set(this.o.get('glintSpeed'), this.o.get('glintStrength')); break;
      case 'cutoutLeaves': case 'smoothLighting': case 'biomeBlend': case 'chunkBuilder':
        for (const w of this.worlds()) { w.builder = this.o.get('chunkBuilder'); w.setMeshing(this.worldOpts()); }
        break;
      case 'simulationDistance': case 'entityDistance': case 'entityShadows': case 'attackIndicator':
        this.parts = null;      // put on the game's parts in the next frame()
        break;
    }
    if (g && g.hud && k === 'attackIndicator') g.hud.markDirty && g.hud.markDirty();
  }
  // the worlds there are: the one played, and the title screen's
  worlds() { return (this.worldsFn ? this.worldsFn() : []).filter(Boolean); }

  /* ---- before every frame: is this one drawn? ----
     Max Framerate (0 unlimited), and Reduce FPS when: AFK, 30 a second after
     a minute with no input and 10 after ten minutes. (Minimized: the browser
     stops drawing a page that is not on screen by itself.) A frame is drawn
     when its time has come, a little early rather than late, since the screen
     only shows whole frames anyway. */
  hold(now) {
    let fps = this.o.get('maxFps') || 0;
    if (this.o.get('inactivityFpsLimit') !== 'minimized' && this.inWorld) {
      const idle = now - this.lastInput;
      if (idle > 600000) fps = fps ? Math.min(fps, 10) : 10;
      else if (idle > 60000) fps = fps ? Math.min(fps, 30) : 30;
    }
    if (!fps || fps >= 260) { this.due = now; return false; }
    // drawn on a steady beat (each frame due one interval after the last was due), so the screen's
    // own uneven rhythm never costs a whole extra frame of waiting; half a screen frame early is on time
    const step = 1000 / fps;
    if (now < (this.due || 0) - 8) return true;
    this.due = Math.max((this.due || 0) + step, now - step);
    return false;
  }
  // VSync: frames left with the graphics card at once (two keeps it busy and smooth; one answers your hand a frame sooner)
  inFlight() { return this.o.get('vsync') === false ? 1 : 2; }

  /* ---- once a frame ---- */
  frame(game, dt) {
    this.game = game;
    this.inWorld = !!game;
    const o = this.o;
    if (game) {
      // the parts of a world (made again on every trip between dimensions): their settings
      const key = game.entities;
      if (this.parts !== key) {
        this.parts = key;
        if (game.sim) game.sim.simDist = o.get('simulationDistance');
        if (game.entities) { game.entities.entityDistance = o.get('entityDistance'); game.entities.entityShadows = !!o.get('entityShadows'); }
      }
      // the game saves by itself every five minutes of play (and shows it)
      this.playTicks += dt * 20;
      if (this.playTicks >= 6000) { this.playTicks -= 6000; if (o.get('autosaveIndicator')) this.saveFlash = performance.now(); }
    }
    this.vignette(game, dt);
  }
  // the attack indicator's place: 'crosshair', 'hotbar' or 'off' (main.js and ui/hud.js)
  attackMode() { return this.o.get('attackIndicator') || 'crosshair'; }
  // Damage Tilt (Accessibility): how much a hit tips the view
  tilt() { const v = this.o.get('damageTilt'); return v === undefined ? 1 : v; }

  /* ---- Show Vignette ----
     The edges of the screen darkened the darker it is where you stand, easing
     over slowly as the game's does; our own soft gradient, under the HUD,
     gone with F1. */
  vignette(game, dt) {
    const on = !!game && this.o.get('vignette') && !(this.gui && this.gui.hideHud);
    if (!this.vigEl) {
      if (!on) return;
      const el = this.vigEl = document.createElement('div');
      Object.assign(el.style, { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '3',
        background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.42) 85%, rgba(0,0,0,0.62) 100%)', opacity: '0' });
      document.body.appendChild(el);
    }
    let target = 0;
    if (on && this.R && this.R.avatar && this.R.avatar.uLight) {
      const L = this.R.avatar.uLight.value, t = ((game.time % 24000) + 24000) % 24000;
      const day = game.dim && game.dim !== 'overworld' ? 0.3 : Math.min(1, Math.max(0.2, 0.5 + 2 * Math.cos(2 * Math.PI * (t / 24000 - 0.25))));
      target = 1 - Math.max(0, Math.min(1, Math.max(L.x * day, L.y)));
    }
    this.vig += (target - this.vig) * Math.min(1, dt * 0.6);
    const a = on ? Math.round(this.vig * 100) / 100 : 0;
    if (a !== this.vigShown) { this.vigShown = a; this.vigEl.style.opacity = String(a); }
  }

  /* ---- "Saving world" ---- */
  drawSaving(g) {
    if (!this.inWorld || (this.gui && this.gui.hideHud)) return;
    const t = performance.now() - this.saveFlash;
    if (t >= 2600) return;
    const a = t < 300 ? t / 300 : t > 2000 ? (2600 - t) / 600 : 1;
    const text = 'Saving world', w = g.textWidth(text);
    g.ctx.save();
    g.ctx.globalAlpha = Math.max(0, Math.min(1, a));
    g.text(text, g.width - w - 6, g.height - 14, 0xFFFFFF);
    g.ctx.restore();
  }
}
