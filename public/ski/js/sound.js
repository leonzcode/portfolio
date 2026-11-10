// Sound: real recordings (sounds/, Freesound CC0 and CC BY, see CREDITS.md) played through Web Audio. Loops (wind by
// speed, the hiss of a carving edge, a skid's scrape, powder, a rail's grind, a box's plastic slide, the air round the
// park, the chairlift's drive) run all the time at the level the riding asks for; one-shots for the pop, landings, a
// crash, meeting a rail or box, the "schat" of a swap and the chairlift's clack. The files load when you first ride;
// until they have come the old sounds made on the fly stand in.
import { ENV } from './env.js?v=21';

const LOOPS = ['wind', 'carve', 'skid', 'powder', 'rail_grind', 'box_slide', 'ambience', 'lift_hum'];
const SHOTS = ['pop', 'land', 'land_soft', 'crash', 'rail_hit', 'box_hit', 'schat', 'lift_clack'];
// what each rail kind is made of: steel rails, plastic tubes and box tops, wooden benches
const METAL = { rail: 1, down: 1, kink: 1, rainbow: 1, dd: 1, c: 1, flatdown: 1 };
const isMetal = k => !!METAL[k] || !k;

export class Sound {
  constructor() { this.ctx = null; this.on = true; this.buf = {}; this.man = null; this.loops = {}; this.ready = false; this.lift = 0; this.slideKind = ''; window.__skiSound = this; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.7 : 0; this.master.connect(ctx.destination);
    // the stand-ins made on the fly (noise through filters), until the recordings have loaded
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = noise;
    const src = (f, q, type = 'bandpass') => {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.master); s.start(); return { g, fl, s };
    };
    this.syn = { wind: src(500, 0.4, 'lowpass'), carve: src(3200, 1.2), skid: src(900, 0.8), grind: src(2400, 9) };
    this.load();
  }
  async load() {
    try {
      this.man = await (await fetch('./sounds/manifest.json')).json();
      const names = [...LOOPS, ...SHOTS].filter(n => this.man[n]);
      await Promise.all(names.map(async n => {
        const ab = await (await fetch('./sounds/' + this.man[n].file)).arrayBuffer();
        this.buf[n] = await new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej));
      }));
      // every loop starts now, silent, and only its level changes from then on
      const t = this.ctx.currentTime;
      for (const n of LOOPS) {
        if (!this.buf[n]) continue;
        const m = this.man[n], s = this.ctx.createBufferSource(); s.buffer = this.buf[n]; s.loop = true;
        if (m.loopEnd) { s.loopStart = m.loopStart; s.loopEnd = m.loopEnd; }
        const g = this.ctx.createGain(); g.gain.value = 0;
        s.connect(g); g.connect(this.master);
        s.start(t, (m.loopStart || 0) + Math.random() * ((m.loopEnd || m.dur) - (m.loopStart || 0)));
        this.loops[n] = { s, g, base: m.gain ?? 0.5, want: 0, rate: 1 };
      }
      this.ready = true;
      for (const k in this.syn) this.syn[k].g.gain.setTargetAtTime(0, t, 0.05);
    } catch (e) { console.warn('sounds', e); }
  }
  setOn(on) { this.on = on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.05); }
  // a one-shot: gain 0..1.5, rate the playback speed (pitch), at a delay
  play(n, gain = 1, rate = 1, delay = 0) {
    if (!this.ctx || !this.on) return false;
    const b = this.buf[n]; if (!b) return false;
    const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = Math.min(1.5, gain) * (this.man[n].gain ?? 0.8);
    s.connect(g); g.connect(this.master); s.start(this.ctx.currentTime + delay);
    return true;
  }
  // a landing (power: how hard, m/s into the snow)
  thump(power) {
    if (!this.ctx) return;
    if (this.ready) {
      const soft = power < 3.5, snowSoft = ENV.snow === 'powder' || ENV.snow === 'spring';
      this.play(soft || snowSoft ? 'land_soft' : 'land', Math.min(1.3, 0.35 + power * 0.12), (ENV.snow === 'ice' ? 1.15 : snowSoft ? 0.85 : 1) * (0.94 + Math.random() * 0.12));
      return;
    }
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260 + power * 40;
    const g = ctx.createGain(); const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(1, 0.25 + power * 0.08), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.4);
  }
  crash() { if (!this.play('crash', 1, 0.95 + Math.random() * 0.1)) this.thump(8); }
  // short sounds: 'pop' (snow crunch as the skis leave), 'rail' (a steel rail's clank), 'box' (a plastic thud)
  hit(kind, power = 1) {
    if (!this.ctx || !this.on) return;
    if (this.ready) {
      if (kind === 'pop') this.play('pop', 0.5 + power * 0.45, (ENV.snow === 'powder' ? 0.85 : 1) * (0.95 + Math.random() * 0.1));
      else if (kind === 'rail') this.play('rail_hit', power, 0.95 + Math.random() * 0.1);
      else this.play('box_hit', power, 0.95 + Math.random() * 0.1);
      return;
    }
    const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(), g = ctx.createGain();
    if (kind === 'pop') { f.type = 'highpass'; f.frequency.value = 1400; g.gain.setValueAtTime(0.18 * power, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09); }
    else if (kind === 'rail') {
      f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 6; g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'triangle'; o.frequency.value = 760;
      og.gain.setValueAtTime(0.12, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5); o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.55);
    } else { f.type = 'lowpass'; f.frequency.value = 420; g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); }
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + 0.6);
  }
  // meeting a rail or box (power 0.45 to 1.5): the clang or thud of its material, and the snow off the bases
  rail(kind, power = 1) {
    if (!this.ready) { this.hit(kind === 'box' ? 'box' : 'rail', power); return; }
    const metal = isMetal(kind);
    this.play(metal ? 'rail_hit' : 'box_hit', 0.45 + power * 0.5, (metal ? 1 : kind === 'bench' ? 0.8 : kind === 'tube' ? 0.9 : 1) * (0.94 + Math.random() * 0.12));
    this.play('schat', 0.35 + power * 0.25, 1.05 + Math.random() * 0.15);
    this.slideKind = kind;
  }
  // a change of direction on a rail: the snow packed on the bases flicks off ("schat") and the skis clack on
  swap(kind) {
    if (!this.ready) return;
    this.play('schat', 1, 0.95 + Math.random() * 0.15);
    this.play(isMetal(kind) ? 'rail_hit' : 'box_hit', 0.35, 1.1 + Math.random() * 0.1, 0.02);
  }
  railOff() {}
  // the chairlift (lift.js): the drive's hum (level 0..1, call when it changes or every frame) and a chair's clack
  liftHum(level) { this.lift = Math.max(0, Math.min(1, level)); }
  liftClack(level = 1) { if (this.ready) this.play('lift_clack', Math.min(1, level), 0.95 + Math.random() * 0.1); }
  frame(sk) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, sp = sk.v.length(), on = this.on ? 1 : 0;
    const ground = sk.state === 'ground', rail = sk.state === 'rail';
    // (towed up a T-bar, tbar.js, the skis glide on the snow of its track at the tow's speed: the run's hiss and powder's
    // hush follow them; a chairlift's seat has none)
    const glide = ground || (sk.state === 'lift' && sk.liftKind === 'tbar');
    const powderSnow = ENV.snow === 'powder' || sk.surf === 1, ice = ENV.snow === 'ice', spring = ENV.snow === 'spring';
    const slide = (sk.slide || 0), brake = sk.brake || 0, edge = Math.abs(sk.edge || 0);
    const carve = ground ? Math.min(1, edge * sp * 0.07) * (powderSnow ? 0.35 : 1) : 0;
    const skid = ground ? Math.min(1, slide * 0.12 + brake * sp * 0.05) : 0;
    if (!this.ready) {
      const set = (n, v) => n.g.gain.setTargetAtTime(v, t, 0.06);
      set(this.syn.wind, Math.min(0.5, sp * sp * 0.0009) * on);
      this.syn.wind.fl.frequency.setTargetAtTime(300 + sp * 30, t, 0.1);
      set(this.syn.carve, Math.min(0.18, carve * 0.18 + (glide && !ground ? sp * 0.01 : 0)) * on);
      set(this.syn.skid, Math.min(0.35, skid * 0.35 + (ground && sk.surf === 1 ? sp * 0.01 : 0)) * on);
      set(this.syn.grind, rail ? (0.12 + sp * 0.008) * on : 0);
      return;
    }
    const metal = isMetal(sk.rail ? sk.rail.kind : this.slideKind);
    // (the levels and speeds go into two objects kept for this, so a frame makes nothing new)
    const want = this._want || (this._want = {}), rate = this._rate || (this._rate = {});
    want.wind = Math.min(1, sp * sp * 0.0022 + (sk.state === 'air' ? 0.08 : 0));
    // the run's hiss: a steady glide sound that grows with speed, more with the edges set; quieter in powder
    want.carve = glide ? Math.min(1, sp * 0.035 + carve * 0.6) * (powderSnow ? 0.25 : spring ? 0.7 : 1) : 0;
    want.skid = Math.min(1.2, skid * (ice ? 1.4 : 1));
    want.powder = glide && powderSnow ? Math.min(1, sp * 0.07 + slide * 0.1) : 0;
    want.rail_grind = rail && metal ? Math.min(1, 0.35 + sp * 0.06) : 0;
    want.box_slide = rail && !metal ? Math.min(1, 0.4 + sp * 0.06) : 0;
    want.ambience = 1; want.lift_hum = this.lift;
    rate.wind = 0.85 + Math.min(0.35, sp * 0.02); rate.carve = (ice ? 1.2 : spring ? 0.85 : 1) * (0.9 + Math.min(0.25, sp * 0.015));
    rate.skid = ice ? 1.25 : spring ? 0.8 : 1; rate.powder = 0.9 + Math.min(0.2, sp * 0.015);
    rate.rail_grind = rate.box_slide = 0.9 + Math.min(0.25, sp * 0.02); rate.ambience = rate.lift_hum = 1;
    for (const n in this.loops) {
      const L = this.loops[n], w = (want[n] || 0) * L.base * on;
      if (Math.abs(w - L.want) > 0.004) { L.g.gain.setTargetAtTime(w, t, n === 'skid' || n === 'rail_grind' || n === 'box_slide' ? 0.04 : 0.1); L.want = w; }
      const r = rate[n] || 1;
      if (Math.abs(r - L.rate) > 0.01) { L.s.playbackRate.setTargetAtTime(r, t, 0.15); L.rate = r; }
    }
  }
}
