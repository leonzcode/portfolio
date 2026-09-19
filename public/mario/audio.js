/* ---------------------------------------------------------------------------
   Sound, synthesised rather than downloaded.

   A kart racer is a loud, bright, chiptune sort of place, so everything here is
   square waves, short envelopes and a drum made of filtered noise. The engine is
   a buzz whose pitch follows your speed, the coins are a two note ping, and the
   music is four bars of bass, arpeggio and hats scheduled a fraction of a second
   ahead of the clock so it does not depend on the frame rate.
--------------------------------------------------------------------------- */
let ac = null, master = null, musicGain = null, noiseBuf = null;
let eng = null, ready = false, muted = false, level = 0.5;

function noise(sec) {
  const n = Math.floor(ac.sampleRate * sec);
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
  master.gain.value = muted ? 0 : level;
  master.connect(ac.destination);
  musicGain = ac.createGain();
  musicGain.gain.value = 0.30;
  musicGain.connect(master);
  noiseBuf = noise(2);

  // the engine: a buzz and a sub, through a filter that opens with the revs
  const a = ac.createOscillator(), b = ac.createOscillator();
  a.type = 'square'; b.type = 'sawtooth';
  a.frequency.value = 70; b.frequency.value = 35;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 5;
  const g = ac.createGain(); g.gain.value = 0;
  a.connect(lp); b.connect(lp); lp.connect(g); g.connect(master);
  a.start(); b.start();
  eng = { a, b, lp, g };
  ready = true;
  return true;
}
export function isOn() { return ready; }
export function mute(v) { muted = v; if (ready) master.gain.value = v ? 0 : level; }
// the menu's slider. It works before start() too, so the level is already right
// on the first note rather than snapping down after it
export function volume(v) { level = Math.max(0, Math.min(1, v)); if (ready && !muted) master.gain.value = level; return level; }
export function volume_() { return level; }
export function muted_() { return muted; }

function tone(wave, hz, at, life, vol, dest) {
  if (!ready) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = wave; o.frequency.value = hz;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + life);
  o.connect(g); g.connect(dest || master);
  o.start(at); o.stop(at + life + 0.02);
}
function sweep(wave, from, to, life, vol) {
  if (!ready) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + life);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + life);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + life + 0.02);
}
function hit(freq, life, vol, type, q) {
  if (!ready) return;
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  const f = ac.createBiquadFilter();
  f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
  const g = ac.createGain();
  const t = ac.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + life);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random(), life + 0.05);
}

/* ---- the one-shots ------------------------------------------------------- */
export function coin() {
  if (!ready) return;
  const t = ac.currentTime;
  tone('square', 1046, t, 0.07, 0.16);
  tone('square', 1568, t + 0.06, 0.12, 0.16);
}
export function tick() { hit(2200, 0.03, 0.10, 'bandpass', 4); }
export function land() {
  if (!ready) return;
  const t = ac.currentTime;
  tone('square', 784, t, 0.08, 0.18);
  tone('square', 1175, t + 0.07, 0.16, 0.18);
}
export function boost() { sweep('sawtooth', 320, 1400, 0.4, 0.2); hit(900, 0.35, 0.16, 'bandpass', 0.7); }
export function bump() { hit(320, 0.12, 0.22, 'lowpass', 1); }
export function spin() { sweep('square', 700, 180, 0.6, 0.18); }
export function bang() {
  sweep('sawtooth', 420, 60, 0.7, 0.28);
  hit(500, 0.6, 0.3, 'lowpass', 0.6);
}
export function beep(high) {
  if (!ready) return;
  const t = ac.currentTime;
  tone('square', high ? 1046 : 523, t, high ? 0.5 : 0.22, 0.2);
}
export function lapChime() {
  if (!ready) return;
  const t = ac.currentTime;
  [784, 988, 1319].forEach((f, i) => tone('triangle', f, t + i * 0.09, 0.2, 0.17));
}
export function fanfare(good) {
  if (!ready) return;
  const t = ac.currentTime;
  const notes = good ? [523, 659, 784, 1046, 1319] : [523, 494, 440, 392];
  notes.forEach((f, i) => tone('square', f, t + i * 0.12, 0.28, 0.18));
}

/* ---- the continuous ones ------------------------------------------------- */
export function engine(on, speed, top, offroad) {
  if (!ready) return;
  const t = ac.currentTime;
  if (!on) { eng.g.gain.setTargetAtTime(0, t, 0.15); return; }
  const rev = Math.min(1.3, Math.abs(speed) / Math.max(1, top));
  eng.a.frequency.setTargetAtTime(64 + rev * 150, t, 0.06);
  eng.b.frequency.setTargetAtTime(32 + rev * 74, t, 0.06);
  eng.lp.frequency.setTargetAtTime(380 + rev * 1500 + (offroad ? -120 : 0), t, 0.08);
  eng.g.gain.setTargetAtTime(0.055 + rev * 0.075, t, 0.08);
}
export function skid(on) {
  if (!ready) return;
  if (on && !skid.node) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 1.4;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
    skid.node = { g };
  }
  if (skid.node) skid.node.g.gain.setTargetAtTime(on ? 0.1 : 0, ac.currentTime, 0.06);
}

/* ---- the tune ------------------------------------------------------------ */
const BASS = [0, 0, 7, 7, 5, 5, 3, 3];
const ARP = [12, 16, 19, 16, 12, 16, 19, 24];
const ROOT = 98;                       // low G
let musicOn = false, nextAt = 0, step16 = 0;

export function music(on) {
  if (!ready) return;
  musicOn = on;
  musicGain.gain.setTargetAtTime(on ? 0.3 : 0, ac.currentTime, 0.3);
  if (on && nextAt < ac.currentTime) { nextAt = ac.currentTime + 0.06; step16 = 0; }
}
export function musicTick() {
  if (!ready || !musicOn) return;
  const spb = 60 / 132 / 4;            // sixteenths at 132 bpm
  const now = ac.currentTime;
  if (nextAt < now) nextAt = now + 0.05;
  while (nextAt < now + 0.35) {
    const at = nextAt, k = step16 % 32;
    const semi = n => ROOT * Math.pow(2, n / 12);
    if (k % 4 === 0) tone('triangle', semi(BASS[(k / 4) % 8] - 12), at, spb * 3.4, 0.16, musicGain);
    if (k % 2 === 0) tone('square', semi(ARP[(k / 2) % 8]), at, spb * 1.4, 0.055, musicGain);
    if (k % 8 === 0) {                 // kick
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, at);
      o.frequency.exponentialRampToValueAtTime(48, at + 0.12);
      g.gain.setValueAtTime(0.4, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
      o.connect(g); g.connect(musicGain);
      o.start(at); o.stop(at + 0.17);
    }
    if (k % 4 === 2) {                 // hat
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.09, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      src.connect(f); f.connect(g); g.connect(musicGain);
      src.start(at, Math.random(), 0.1);
    }
    nextAt += spb;
    step16++;
  }
}
