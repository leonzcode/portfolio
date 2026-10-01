// Synthesized sound effects (Web Audio), no files to load.
export class Sound {
  constructor() { this.ctx = null; this.vol = 0.6; this.muted = false; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = this.vol;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }

  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.vol; }

  // ---- music: a looping battle track, scheduled a little ahead of time
  startMusic(kind) {
    if (!this.ctx) return;
    if (this.music && this.music.kind === kind) return;
    this.stopMusic();
    const c = this.ctx;
    const gain = c.createGain(); gain.gain.value = kind === 'menu' ? 0.1 : 0.16; gain.connect(this.master);
    const m = { kind, gain, step: 0, next: c.currentTime + 0.08, bpm: kind === 'menu' ? 118 : 148 };
    this.music = m;
    m.timer = setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    if (!this.music) return;
    clearInterval(this.music.timer);
    const g = this.music.gain, c = this.ctx;
    g.gain.setTargetAtTime(0.0001, c.currentTime, 0.15);
    setTimeout(() => g.disconnect(), 800);
    this.music = null;
  }

  schedule() {
    const m = this.music, c = this.ctx;
    if (!m) return;
    const spb = 60 / m.bpm / 4; // sixteenth notes
    const roots = [110, 87.31, 130.81, 98.0];        // A, F, C, G
    const chords = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 4, 7]];
    while (m.next < c.currentTime + 0.12) {
      const s = m.step % 64, bar = Math.floor(s / 16), st = s % 16, t = m.next;
      const root = roots[bar];
      const battle = m.kind !== 'menu';
      // drums
      if (st % 8 === 0 || (battle && st === 10)) this.kick(t, m.gain);
      if (st === 4 || st === 12) this.snare(t, m.gain, battle ? 0.5 : 0.25);
      if (battle || st % 2 === 0) this.hat(t, m.gain, st % 4 === 2 ? 0.22 : 0.1);
      // bass on eighths with an octave hop
      if (st % 2 === 0) this.note('sawtooth', root * (st % 4 === 2 ? 2 : 1), t, spb * 1.7, 0.22, m.gain, 600);
      // arpeggio lead
      const ch = chords[bar];
      const seq = battle ? [0, 1, 2, 1, 0, 2, 1, 2] : [0, 2, 1, 2];
      if (st % (battle ? 2 : 4) === 0) {
        const idx = seq[(st / (battle ? 2 : 4)) % seq.length];
        const semi = ch[idx] + (st >= 8 ? 12 : 0);
        this.note('square', root * 4 * Math.pow(2, semi / 12), t, spb * 1.5, battle ? 0.07 : 0.05, m.gain, 2600);
      }
      if (battle && st === 0 && bar % 2 === 0) this.note('triangle', root * 8 * Math.pow(2, 7 / 12), t, spb * 8, 0.06, m.gain, 4000);
      m.step++; m.next += spb;
    }
  }

  note(type, f, t, dur, vol, out, cutoff) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = cutoff || 3000;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  kick(t, out) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.18);
  }
  snare(t, out, v) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + 0.16);
  }
  hat(t, out, v) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = 'highpass'; f.frequency.value = 7500;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + 0.05);
  }

  tone(type, f0, f1, dur, vol, delay) {
    const c = this.ctx, t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  burst(dur, vol, f, q, type, f1, delay) {
    const c = this.ctx, t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = this.noise;
    const bf = c.createBiquadFilter(); bf.type = type || 'bandpass'; bf.frequency.setValueAtTime(f, t); bf.Q.value = q || 1;
    if (f1) bf.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bf); bf.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  play(name, vol) {
    if (!this.ctx || this.muted) return;
    const v = vol == null ? 1 : vol;
    switch (name) {
      case 'hit1': this.burst(0.08, 0.5 * v, 2200, 1.2); this.tone('square', 220, 90, 0.06, 0.12 * v); break;
      case 'hit2': this.burst(0.14, 0.7 * v, 1500, 0.9); this.tone('sawtooth', 160, 55, 0.12, 0.2 * v); break;
      case 'hit3': this.burst(0.28, 0.9 * v, 900, 0.7, 'lowpass', 300); this.tone('sine', 120, 35, 0.3, 0.45 * v); this.burst(0.05, 0.5 * v, 5000, 2); break;
      case 'shieldhit': this.tone('triangle', 900, 600, 0.09, 0.2 * v); this.burst(0.05, 0.2 * v, 4000, 3); break;
      case 'shieldup': this.tone('sine', 500, 700, 0.06, 0.06 * v); break;
      case 'shieldbreak': this.burst(0.5, 0.8, 3000, 0.6, 'highpass'); this.tone('sawtooth', 400, 60, 0.6, 0.3); break;
      case 'jump': this.burst(0.12, 0.25 * v, 600, 1, 'bandpass', 2400); break;
      case 'djump': this.burst(0.16, 0.25 * v, 800, 1, 'bandpass', 3200); break;
      case 'dash': this.burst(0.08, 0.2 * v, 1200, 0.8, 'lowpass', 300); break;
      case 'land': this.burst(0.08, 0.3 * v, 400, 0.8, 'lowpass'); break;
      case 'thud': this.tone('sine', 140, 50, 0.15, 0.4 * v); this.burst(0.1, 0.3 * v, 300, 0.8, 'lowpass'); break;
      case 'ko': this.burst(1.2, 0.9, 1800, 0.5, 'lowpass', 120); this.tone('sine', 90, 28, 1.0, 0.6); this.tone('sawtooth', 1400, 3000, 0.35, 0.08); break;
      case 'grab': this.tone('square', 300, 200, 0.07, 0.12 * v); break;
      case 'throw': this.burst(0.2, 0.3 * v, 500, 1, 'bandpass', 2000); break;
      case 'fire': this.burst(0.22, 0.35 * v, 900, 0.8, 'lowpass', 200); this.tone('triangle', 300, 600, 0.12, 0.08 * v); break;
      case 'zap': this.tone('sawtooth', 1200, 300, 0.12, 0.12 * v); this.tone('square', 1800, 900, 0.08, 0.06 * v, 0.03); break;
      case 'zip': this.tone('sawtooth', 600, 2400, 0.12, 0.1 * v); break;
      case 'slash': this.burst(0.15, 0.35 * v, 3500, 2, 'bandpass', 1200); break;
      case 'counter': this.tone('triangle', 1600, 1500, 0.4, 0.2); this.tone('sine', 2400, 2300, 0.3, 0.1); break;
      case 'armor': this.tone('square', 220, 200, 0.1, 0.15 * v); this.burst(0.06, 0.3 * v, 2500, 4); break;
      case 'ledge': this.tone('triangle', 700, 900, 0.05, 0.1 * v); break;
      case 'dodge': this.burst(0.1, 0.18 * v, 2500, 2, 'bandpass', 900); break;
      case 'tech': this.tone('sine', 1200, 1600, 0.08, 0.15 * v); break;
      case 'charge': this.tone('sawtooth', 200, 800, 0.9, 0.05 * v); break;
      case 'count': this.tone('square', 660, null, 0.14, 0.15); break;
      case 'go': this.tone('square', 990, null, 0.3, 0.18); this.tone('square', 1320, null, 0.3, 0.12, 0.02); break;
      case 'game': [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, null, 0.22, 0.12, i * 0.09)); break;
      case 'menu': this.tone('triangle', 880, null, 0.05, 0.08); break;
      case 'select': this.tone('square', 660, 990, 0.1, 0.1); break;
      case 'back': this.tone('triangle', 500, 300, 0.08, 0.08); break;
    }
  }
}
