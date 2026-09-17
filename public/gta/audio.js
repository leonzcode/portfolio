/* ---------------------------------------------------------------------------
   Sound, made rather than loaded.

   There are no audio files here. Everything is synthesised on the fly out of
   oscillators and noise, which is why the whole game still downloads in a couple
   of hundred kilobytes: an engine is a pair of detuned saws through a filter, a
   gunshot is a noise burst with a very fast decay and a low thump under it, and a
   siren is two tones taking turns.

   The context cannot start until somebody clicks something, so everything is
   built on the first call to start() - which happens on the button that enters
   the city.
--------------------------------------------------------------------------- */
let ac = null, master = null, noiseBuf = null;
let eng = null, ambient = null, siren = null;
let ready = false;

function noise(seconds) {
  const n = Math.floor(ac.sampleRate * seconds);
  const b = ac.createBuffer(1, n, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export function start() {
  if (ready) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ac = new AC();
  master = ac.createGain();
  master.gain.value = 0.55;
  master.connect(ac.destination);
  noiseBuf = noise(2);

  /* ---- the engine: two saws a whisker apart, through a moving filter ----- */
  const a = ac.createOscillator(), b = ac.createOscillator();
  a.type = 'sawtooth'; b.type = 'sawtooth';
  a.frequency.value = 60; b.frequency.value = 61.7;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 3.5;
  const g = ac.createGain(); g.gain.value = 0;
  a.connect(lp); b.connect(lp); lp.connect(g); g.connect(master);
  a.start(); b.start();
  eng = { a, b, lp, g };

  /* ---- the city: a hiss and a hum that never stop ----------------------- */
  const src = ac.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'lowpass'; bp.frequency.value = 340;
  const ag = ac.createGain(); ag.gain.value = 0.0;
  src.connect(bp); bp.connect(ag); ag.connect(master);
  src.start();
  ambient = { g: ag, f: bp };

  /* ---- the siren: two tones taking turns -------------------------------- */
  const so = ac.createOscillator();
  so.type = 'sine'; so.frequency.value = 680;
  const sg = ac.createGain(); sg.gain.value = 0;
  so.connect(sg); sg.connect(master);
  so.start();
  siren = { o: so, g: sg, t: 0 };

  ready = true;
  return true;
}

export function resume() { if (ac && ac.state === 'suspended') ac.resume(); }
export function isOn() { return ready; }

/* ---- one-shots ------------------------------------------------------------ */
function burst(opts) {
  if (!ready) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = opts.type || 'bandpass';
  f.frequency.value = opts.freq;
  f.Q.value = opts.q || 1;
  const g = ac.createGain();
  const t = ac.currentTime;
  g.gain.setValueAtTime(opts.vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.life);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 1.5, opts.life + 0.02);
  if (opts.sweep) f.frequency.exponentialRampToValueAtTime(opts.sweep, t + opts.life);
}
function thump(freq, life, vol, to) {
  if (!ready) return;
  const o = ac.createOscillator();
  o.type = 'sine';
  const g = ac.createGain();
  const t = ac.currentTime;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(to || freq * 0.4, t + life);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + life);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + life + 0.02);
}

const SHOTS = {
  pistol:  { freq: 1500, q: 0.7, life: 0.17, vol: 0.55, low: 130 },
  smg:     { freq: 1800, q: 0.8, life: 0.11, vol: 0.34, low: 150 },
  shotgun: { freq: 900,  q: 0.5, life: 0.36, vol: 0.75, low: 80 },
  rifle:   { freq: 1650, q: 0.7, life: 0.20, vol: 0.55, low: 120 },
  sniper:  { freq: 700,  q: 0.4, life: 0.55, vol: 0.85, low: 60 },
  cop:     { freq: 1400, q: 0.8, life: 0.16, vol: 0.30, low: 140 },
};
export function gunshot(id, far) {
  const s = SHOTS[id] || SHOTS.pistol;
  const k = far === undefined ? 1 : Math.max(0.05, far);
  burst({ freq: s.freq, q: s.q, life: s.life, vol: s.vol * k, sweep: s.freq * 0.35 });
  thump(s.low, s.life * 1.4, 0.5 * k, s.low * 0.4);
}
export function punch() { burst({ freq: 260, q: 1.2, life: 0.11, vol: 0.5, type: 'lowpass' }); }
export function boom(far) {
  const k = far === undefined ? 1 : Math.max(0.05, far);
  burst({ freq: 420, q: 0.3, life: 1.1, vol: 0.9 * k, type: 'lowpass', sweep: 90 });
  thump(80, 1.4, 0.95 * k, 26);
}
export function ricochet(far) {
  burst({ freq: 2600, q: 6, life: 0.09, vol: 0.2 * (far === undefined ? 1 : far), sweep: 900 });
}
export function footstep(hard) {
  burst({ freq: hard ? 900 : 520, q: 1.4, life: 0.06, vol: 0.14, type: 'bandpass' });
}
export function crash(force) {
  burst({ freq: 700, q: 0.6, life: 0.35, vol: Math.min(0.8, 0.2 + force * 0.5), type: 'lowpass', sweep: 180 });
  thump(110, 0.35, Math.min(0.8, 0.25 + force * 0.4), 40);
}
export function tyres(on) {
  if (!ready) return;
  if (on && !tyres.node) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1.2;
    const g = ac.createGain(); g.gain.value = 0.0;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
    tyres.node = { src, g };
  }
  if (tyres.node) {
    tyres.node.g.gain.setTargetAtTime(on ? 0.18 : 0, ac.currentTime, 0.08);
  }
}
export function pickup() {
  if (!ready) return;
  const t = ac.currentTime;
  for (const [i, f] of [[0, 660], [0.08, 880], [0.16, 1320]]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i);
    g.gain.exponentialRampToValueAtTime(0.22, t + i + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i + 0.14);
    o.connect(g); g.connect(master);
    o.start(t + i); o.stop(t + i + 0.16);
  }
}

/* ---- the continuous ones -------------------------------------------------- */
export function engine(on, speed, top, load) {
  if (!ready) return;
  const t = ac.currentTime;
  if (!on) { eng.g.gain.setTargetAtTime(0, t, 0.12); return; }
  const rev = Math.min(1, Math.abs(speed) / Math.max(1, top));
  // fake gears: the note climbs, drops back and climbs again
  const gear = Math.min(4, Math.floor(rev * 5));
  const inGear = rev * 5 - gear;
  const hz = 46 + inGear * 58 + gear * 6;
  eng.a.frequency.setTargetAtTime(hz, t, 0.05);
  eng.b.frequency.setTargetAtTime(hz * 1.012, t, 0.05);
  eng.lp.frequency.setTargetAtTime(320 + rev * 1500 + load * 500, t, 0.08);
  eng.g.gain.setTargetAtTime(0.10 + rev * 0.13 + load * 0.05, t, 0.08);
}
export function city(level, night) {
  if (!ready) return;
  ambient.g.gain.setTargetAtTime(0.05 + level * 0.05, ac.currentTime, 0.5);
  ambient.f.frequency.setTargetAtTime(night ? 240 : 380, ac.currentTime, 1.0);
}
export function sirens(dt, loud) {
  if (!ready) return;
  const t = ac.currentTime;
  if (loud <= 0.001) { siren.g.gain.setTargetAtTime(0, t, 0.2); return; }
  siren.t += dt;
  const hi = (siren.t % 1.1) < 0.55;
  siren.o.frequency.setTargetAtTime(hi ? 740 : 540, t, 0.03);
  siren.g.gain.setTargetAtTime(0.05 * loud, t, 0.08);
}
/* ---- the radio ------------------------------------------------------------
   Three stations, none of them recorded: a chord progression, a bass line under
   it and a drum part, scheduled a fraction of a second ahead of the clock so the
   timing does not depend on the frame rate. It is not going to trouble a real
   soundtrack, but it does the job a car radio does, which is to make the driving
   feel like it is going somewhere. */
const STATIONS = [
  { name: 'Sunset 101', bpm: 100, root: 110, wave: 'sawtooth', lead: 'triangle',
    chords: [[0, 4, 7], [-3, 0, 4], [-5, -1, 2], [-3, 0, 4]] },
  { name: 'Night Drive', bpm: 118, root: 98, wave: 'square', lead: 'sine',
    chords: [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [0, 3, 7]] },
  { name: 'Block Party', bpm: 92, root: 87, wave: 'sawtooth', lead: 'square',
    chords: [[0, 3, 7], [5, 8, 12], [-4, 0, 3], [1, 5, 8]] },
];
export const stationNames = STATIONS.map(s => s.name);
let radioGain = null, radioOn = false, station = 0, nextAt = 0, step8 = 0;

function semi(root, n) { return root * Math.pow(2, n / 12); }
function tone(wave, hz, at, life, vol, dest) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = wave; o.frequency.value = hz;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + life);
  o.connect(g); g.connect(dest || radioGain);
  o.start(at); o.stop(at + life + 0.02);
}
function drum(at, kind) {
  if (kind === 'kick') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, at);
    o.frequency.exponentialRampToValueAtTime(44, at + 0.13);
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    o.connect(g); g.connect(radioGain);
    o.start(at); o.stop(at + 0.18);
  } else {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = kind === 'snare' ? 1400 : 7000;
    const g = ac.createGain();
    g.gain.setValueAtTime(kind === 'snare' ? 0.3 : 0.12, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + (kind === 'snare' ? 0.16 : 0.05));
    src.connect(f); f.connect(g); g.connect(radioGain);
    src.start(at, Math.random(), 0.2);
  }
}

export function radio(on, idx) {
  if (!ready) return;
  if (!radioGain) {
    radioGain = ac.createGain();
    radioGain.gain.value = 0;
    const lp = ac.createBiquadFilter();       // a car speaker, not a hi-fi
    lp.type = 'lowpass'; lp.frequency.value = 5200;
    radioGain.connect(lp); lp.connect(master);
  }
  if (idx !== undefined && idx !== station) { station = ((idx % STATIONS.length) + STATIONS.length) % STATIONS.length; step8 = 0; nextAt = 0; }
  radioOn = !!on;
  radioGain.gain.setTargetAtTime(radioOn ? 0.34 : 0, ac.currentTime, 0.25);
}
export function radioStation() { return station; }
export function radioTick() {
  if (!ready || !radioOn) return;
  const st = STATIONS[station];
  const spb = 60 / st.bpm / 2;                // one eighth note
  const now = ac.currentTime;
  if (nextAt < now) nextAt = now + 0.05;
  while (nextAt < now + 0.4) {
    const at = nextAt, k = step8 % 32, bar = (step8 / 8 | 0) % 4;
    const chord = st.chords[bar];
    if (k % 8 === 0 || k % 8 === 4) drum(at, 'kick');
    if (k % 8 === 4) drum(at, 'snare');
    if (k % 2 === 1) drum(at, 'hat');
    // a bass note on every other eighth, walking the chord
    if (k % 2 === 0) {
      const n = chord[(k / 2) % 3 === 2 ? 1 : 0] - 12;
      tone(st.wave, semi(st.root, n) / 2, at, spb * 1.7, 0.16);
    }
    // the chord itself, held across the bar
    if (k % 8 === 0) {
      for (const n of chord) tone(st.wave, semi(st.root, n), at, spb * 7, 0.055);
    }
    // and a line over the top, in the second half of the loop
    if (step8 % 64 >= 32 && k % 4 === 2) {
      const n = chord[(step8 % 3)] + 12;
      tone(st.lead, semi(st.root, n), at, spb * 1.2, 0.07);
    }
    nextAt += spb;
    step8++;
  }
}

export function horn() {
  if (!ready) return;
  const t = ac.currentTime;
  for (const f of [392, 494]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
    g.gain.setValueAtTime(0.14, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.45);
  }
}

export function volume(v) { if (ready) master.gain.value = v; }
