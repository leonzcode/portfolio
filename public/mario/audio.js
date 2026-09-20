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
  loadTracks();

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

/* What has been asked for, and the last tier each cue was asked at. A test
   cannot listen to the speakers, and "the drift makes a noise" is a thing worth
   being able to check, so the cues count themselves. Costs an increment. */
export const heard = { charge: 0, turbo: 0, boost: 0, chargeAt: 0, turboAt: 0 };

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
export function boost() {
  heard.boost++;
  sweep('sawtooth', 320, 1400, 0.4, 0.2);
  hit(900, 0.35, 0.16, 'bandpass', 0.7);
}
/* The drift charge landing a tier. Blue, orange and purple each get their own
   note, rising, so the charge can be heard rather than watched: in Mario Kart
   the sparks are as much a sound as a picture, and a drift you have to look
   down at is a drift you are not driving. */
export function charge(tier) {
  heard.charge++; heard.chargeAt = tier;
  if (!ready) return;
  const t = ac.currentTime;
  const base = [0, 620, 830, 1108][tier] || 620;
  tone('triangle', base, t, 0.07, 0.12);
  tone('triangle', base * 1.5, t + 0.045, 0.09, 0.09);
}
/* And the turbo itself going off, which is a harder, shorter version of a
   booster: the bigger the tier the lower it starts and the further it sweeps. */
export function turbo(tier) {
  heard.turbo++; heard.turboAt = tier;
  const from = [0, 420, 360, 300][tier] || 420;
  sweep('sawtooth', from, 1500 + tier * 220, 0.3 + tier * 0.06, 0.2);
  hit(760 + tier * 120, 0.26, 0.15, 'bandpass', 0.8);
}
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
export function engine(on, speed, top, offroad, air) {
  if (!ready) return;
  const t = ac.currentTime;
  if (!on) { eng.g.gain.setTargetAtTime(0, t, 0.15); return; }
  const rev = Math.min(1.3, Math.abs(speed) / Math.max(1, top));
  /* With no wheels on the ground there is nothing loading the engine, so it
     revs free: the note climbs and the muffling comes off. It lasts as long as
     the jump does and it is the difference between a car that left the ground
     and a car whose height changed. */
  const free = air ? 1 : 0;
  eng.a.frequency.setTargetAtTime(64 + rev * 150 + free * 46, t, free ? 0.035 : 0.06);
  eng.b.frequency.setTargetAtTime(32 + rev * 74 + free * 22, t, free ? 0.035 : 0.06);
  eng.lp.frequency.setTargetAtTime(380 + rev * 1500 + (offroad ? -120 : 0) + free * 900, t, 0.08);
  eng.g.gain.setTargetAtTime(0.055 + rev * 0.075 + free * 0.012, t, 0.08);
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

/* The music is two CC0 loops by Kenney (see music/CREDITS.txt), decoded into
   buffers and looped through the same gain the chiptune used. If a file will not
   load or will not decode, the chiptune below covers for it, so the game never
   ends up silent because of a missing asset. */
const TRACKS = { race: 'music/race.ogg', lobby: 'music/lobby.ogg' };
const buffers = Object.create(null);
let musicSrc = null, musicWhich = '';

function loadTracks() {
  for (const k in TRACKS) {
    fetch(new URL(TRACKS[k], import.meta.url).href)
      .then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
      .then(b => ac.decodeAudioData(b))
      .then(buf => {
        buffers[k] = buf;
        if (musicWhich === k && !musicSrc) playLoop(k);     // it arrived late, start it now
      })
      .catch(function () {});
  }
}
function playLoop(k) {
  stopLoop();
  const src = ac.createBufferSource();
  src.buffer = buffers[k];
  src.loop = true;
  src.connect(musicGain);
  src.start();
  musicSrc = src;
  musicOn = false;                    // the chiptune stands down while a file plays
}
function stopLoop() {
  if (!musicSrc) return;
  try { musicSrc.stop(); } catch (e) {}
  musicSrc.disconnect();
  musicSrc = null;
}

export function music(on, which) {
  if (!ready) return;
  const want = on ? (which || 'race') : '';
  if (want === musicWhich) return;
  musicWhich = want;
  if (!want) {
    stopLoop(); musicOn = false;
    musicGain.gain.setTargetAtTime(0, ac.currentTime, 0.3);
    return;
  }
  musicGain.gain.setTargetAtTime(0.3, ac.currentTime, 0.3);
  if (buffers[want]) { playLoop(want); return; }
  stopLoop();
  musicOn = true;
  if (nextAt < ac.currentTime) { nextAt = ac.currentTime + 0.06; step16 = 0; }
}
// what the music is doing, for a test and for the sake of being able to ask
export function musicNow() { return { which: musicWhich, file: !!musicSrc, synth: musicOn, loaded: Object.keys(buffers) }; }
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
