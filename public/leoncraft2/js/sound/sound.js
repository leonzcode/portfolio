/* ---------------------------------------------------------------------------
   Leoncraft 2 - the sound engine.

   Works the way the game's own does (its SoundEngine over OpenAL):

     - Sounds are named by the game's sound events ('block.stone.break',
       'entity.zombie.ambient'...). A pack says which recordings each event
       may play, in the game's sounds.json form: one is picked by weight each
       time, and its own volume and pitch multiply the ones it is played with.
       The pack is either Leoncraft's own (openly licensed recordings, see
       sounds/CREDITS.txt) or the player's own Minecraft, read from their
       computer (packs.js).
     - Every sound belongs to a category with its own slider (Master, Music,
       Jukebox/Note Blocks, Weather, Blocks, Hostile Mobs, Friendly Mobs,
       Players, Ambient/Environment, Voice/Speech, UI). The loudness a sound
       starts with is min(1, volume x its category), and Master is the
       listener's own gain over everything.
     - Attenuation is the game's: linear, from full at the sound to silence
       at its range, the range being 16 blocks (or the recording's own
       attenuation_distance) times the volume where that is over 1. So an
       explosion (volume 4) carries 64 blocks and a footstep 16.
     - Pitch is clamped to 0.5-2, as the game clamps it.
     - Positioned sounds pan by where they are from the camera (Web Audio's
       equal-power panner, close to OpenAL's stereo); Directional Audio turns
       on HRTF, as the game's option does.

   And so it never costs a frame: no more than MAX_VOICES sounds play at
   once (the quietest goes first when another needs room), a sound out of
   earshot is never started, recordings are decoded once and kept, and the
   only per-frame work is moving the listener (setListener).

   Sound.play(event, x, y, z, volume, pitch, category)   a sound in the world
   Sound.near(event, volume, pitch, category)            at the listener (UI clicks, the level up)
   Sound.loop(event, category, opts) -> handle            a held sound (under water, a minecart)
   Sound.setListener(cam)                                 once a frame
--------------------------------------------------------------------------- */

export const CATEGORIES = ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice', 'ui'];
const MAX_VOICES = 40;            // sounds playing at once (the game allows 247, but this is plenty and keeps the mixer light)
const MAX_STREAMS = 6;            // music, records, the long loops
const LATE = 0.35;                // a recording that took longer than this to load is dropped rather than played late

let ctx = null;                   // made on the first click or key press (browsers keep audio off until then)
let out = null;                   // master gain
const gains = {};                 // category -> GainNode
let options = null;
const vol = {};                   // category -> 0-1
let hrtf = false;
const voices = [];                // { src, g, p, cat, loud, end, stream }
let packs = [];                   // the packs, the first that has an event wins (packs.js fills it)
const listenerPos = { x: 0, y: 0, z: 0 };
const fwd = { x: 0, y: 0, z: -1 }, upv = { x: 0, y: 1, z: 0 };
const unlockers = [];
let subtitleSink = null;          // (key, x, y, z, relative) for the subtitles (subtitles.js)
let onLoad = [];

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ---- the context, made on the first gesture ---- */
function makeContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return null; }
  out = ctx.createGain();
  out.connect(ctx.destination);
  for (const c of CATEGORIES) {
    if (c === 'master') continue;
    const g = ctx.createGain();
    g.connect(out);
    gains[c] = g;
  }
  applyVolumes();
  const fns = onLoad; onLoad = [];
  for (const f of fns) { try { f(ctx); } catch (e) { console.warn(e); } }
  return ctx;
}
function unlock() {
  const c = makeContext();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  for (const f of unlockers.splice(0)) { try { f(); } catch (e) { console.warn(e); } }
}

function applyVolumes() {
  if (!options) return;
  const v = options.get('soundVolumes') || {};
  for (const c of CATEGORIES) vol[c] = typeof v[c] === 'number' ? clamp(v[c], 0, 1) : 1;
  if (!ctx) return;
  out.gain.value = vol.master;
  for (const c in gains) gains[c].gain.value = 1;   // the category is applied per sound (min(1, volume x category)), as the game does
  for (const s of voices) if (s.g && s.base !== undefined) s.g.gain.value = clamp(s.base * vol[s.cat], 0, 1);
}

/* ---- events: which recording, how loud ---- */
// the event as the first pack that has it gives it, with that pack
function lookup(event) {
  for (const p of packs) { const e = p.events && p.events[event]; if (e) return [e, p]; }
  return [null, null];
}
// one recording, by weight, following event references ({ type: 'event' }) as the game does
function pick(event, depth = 0) {
  const [e, p] = lookup(event);
  if (!e || !e.sounds || !e.sounds.length || depth > 4) return null;
  let total = 0;
  for (const s of e.sounds) total += s.weight || 1;
  let r = Math.random() * total, s = e.sounds[0];
  for (const x of e.sounds) { r -= x.weight || 1; if (r < 0) { s = x; break; } }
  if (s.type === 'event') {
    const inner = pick(s.name, depth + 1);
    if (!inner) return null;
    return { name: inner.name, pack: inner.pack, volume: inner.volume * (s.volume ?? 1), pitch: inner.pitch * (s.pitch ?? 1), stream: inner.stream, range: s.attenuation_distance ?? inner.range, subtitle: e.subtitle || inner.subtitle };
  }
  return { name: s.name, pack: p, volume: s.volume ?? 1, pitch: s.pitch ?? 1, stream: !!s.stream, range: s.attenuation_distance ?? 16, subtitle: e.subtitle || null };
}

/* ---- the listener: the camera ---- */
function setListener(x, y, z, fx, fy, fz, ux, uy, uz) {
  if (!Number.isFinite(x + y + z + fx + fy + fz + ux + uy + uz)) return;
  listenerPos.x = x; listenerPos.y = y; listenerPos.z = z;
  fwd.x = fx; fwd.y = fy; fwd.z = fz; upv.x = ux; upv.y = uy; upv.z = uz;
  if (!ctx) return;
  const L = ctx.listener;
  if (L.positionX) {
    L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
    L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
    L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
  } else {
    L.setPosition(x, y, z);
    L.setOrientation(fx, fy, fz, ux, uy, uz);
  }
}

/* ---- playing ---- */
function audibleAt(x, y, z, range) {
  const dx = x - listenerPos.x, dy = y - listenerPos.y, dz = z - listenerPos.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return d >= range ? 0 : 1 - d / range;
}
// room for one more: the quietest one playing goes if the new one is louder, otherwise the new one is not played
function makeRoom(loud, stream) {
  let n = 0, worst = null;
  for (const v of voices) {
    if (!!v.stream !== stream) continue;
    n++;
    if (!v.keep && (!worst || v.loud < worst.loud)) worst = v;
  }
  if (n < (stream ? MAX_STREAMS : MAX_VOICES)) return true;
  if (!worst || worst.loud >= loud) return false;
  stopVoice(worst);
  return true;
}
function stopVoice(v) {
  const i = voices.indexOf(v);
  if (i >= 0) voices.splice(i, 1);
  try { if (v.src) { v.src.onended = null; v.src.stop(); } } catch (e) {}
  if (v.el) { try { v.el.pause(); } catch (e) {} if (v.url && v.revoke) URL.revokeObjectURL(v.url); v.el.removeAttribute('src'); }
  try { if (v.src) v.src.disconnect(); if (v.g) v.g.disconnect(); if (v.p) v.p.disconnect(); } catch (e) {}
  v.stopped = true;
}
function panner(x, y, z, range) {
  const p = ctx.createPanner();
  p.panningModel = hrtf ? 'HRTF' : 'equalpower';
  p.distanceModel = 'linear';
  p.refDistance = 0.0001;
  p.maxDistance = Math.max(0.01, range);
  p.rolloffFactor = 1;
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
  else p.setPosition(x, y, z);
  return p;
}

/* Start one resolved recording. at: null for one at the listener (no panning,
   no fading with distance), else [x, y, z]. o: { loop, keep, onEnd }. */
function start(r, at, volume, pitch, cat, o = {}) {
  const v = volume * r.volume;
  const base = v;
  const gain = clamp(v * (vol[cat] ?? 1), 0, 1);
  if (gain <= 0 && !o.loop) return null;
  const range = Math.max(v, 1) * r.range;
  const reach = at ? audibleAt(at[0], at[1], at[2], range) : 1;
  if (reach <= 0 && !o.loop) return null;
  const loud = gain * reach;
  const rate = clamp(pitch * r.pitch, 0.5, 2);
  if (r.stream) return startStream(r, at, base, rate, cat, range, loud, o);
  const clip = r.pack.get(r.name);
  if (!clip) {
    // not decoded yet: it is asked for, and played if it comes in time (a recording used once a minute is not kept waiting for)
    const t0 = performance.now();
    const voice = { pending: true, cat, base, loud, stopped: false };
    r.pack.load(r.name).then(c => {
      if (!c || voice.stopped || (!o.loop && performance.now() - t0 > LATE * 1000)) return;
      if (!play(c, at, base, rate, cat, range, loud, o, voice)) voice.stopped = true;
    }, () => {});
    return voice;
  }
  return play(clip, at, base, rate, cat, range, loud, o, null);
}
// (into: the waiting stand-in a loop's handle already holds, filled in now)
function play(clip, at, base, rate, cat, range, loud, o, into) {
  if (!ctx || !makeRoom(loud, false)) return null;
  const src = ctx.createBufferSource();
  src.buffer = clip.buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = clamp(base * (vol[cat] ?? 1), 0, 1);
  src.connect(g);
  let p = null;
  if (at) { p = panner(at[0], at[1], at[2], range); g.connect(p); p.connect(gains[cat] || out); }
  else g.connect(gains[cat] || out);
  const off = clip.offset || 0, dur = clip.duration || clip.buffer.duration - off;
  const voice = Object.assign(into || {}, { src, g, p, cat, base, loud, keep: !!o.keep, stream: false, range, pending: false });
  if (o.loop) {
    src.loop = true;
    if (clip.offset !== undefined) { src.loopStart = off; src.loopEnd = off + dur; }
    src.start(0, off);
  } else src.start(0, off, dur);
  src.onended = () => { const i = voices.indexOf(voice); if (i >= 0) voices.splice(i, 1); try { src.disconnect(); g.disconnect(); if (p) p.disconnect(); } catch (e) {} if (o.onEnd) o.onEnd(); };
  voices.push(voice);
  return voice;
}
// music, records and long ambience: read as they play (an <audio> element through the mixer)
function startStream(r, at, base, rate, cat, range, loud, o) {
  if (!ctx || !makeRoom(loud, true)) return null;
  const voice = { stream: true, cat, base, loud, keep: !!o.keep, range, stopped: false };
  voices.push(voice);
  Promise.resolve(r.pack.streamUrl(r.name)).then(u => {
    if (!u || voice.stopped) return;
    const el = new Audio();
    el.src = u.url; el.loop = !!o.loop; el.preload = 'auto';
    el.preservesPitch = false; el.mozPreservesPitch = false; el.webkitPreservesPitch = false;
    el.playbackRate = rate;
    const src = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    g.gain.value = clamp(base * (vol[cat] ?? 1), 0, 1);
    src.connect(g);
    let p = null;
    if (at) { p = panner(at[0], at[1], at[2], range); g.connect(p); p.connect(gains[cat] || out); }
    else g.connect(gains[cat] || out);
    Object.assign(voice, { el, url: u.url, revoke: !!u.revoke, mediaSrc: src, g, p });
    el.onended = () => { stopVoice(voice); if (o.onEnd) o.onEnd(); };
    el.onerror = () => { stopVoice(voice); if (o.onEnd) o.onEnd(true); };
    el.play().catch(() => { stopVoice(voice); if (o.onEnd) o.onEnd(true); });
  }, () => { stopVoice(voice); if (o.onEnd) o.onEnd(true); });
  return voice;
}

/* ---- what the game calls ---- */
export const Sound = {
  CATEGORIES,
  get ctx() { return ctx; },
  get packs() { return packs; },
  get playing() { return voices.length; },
  get listener() { return listenerPos; },
  get forward() { return fwd; },
  /* options: the game's Options (ui/gui.js): soundVolumes, directionalAudio */
  init(opts) {
    options = opts;
    applyVolumes();
    hrtf = !!options.get('directionalAudio');
    options.onChange(k => {
      if (k === 'soundVolumes') applyVolumes();
      if (k === 'directionalAudio') hrtf = !!options.get('directionalAudio');
    });
    const go = () => unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, go, { capture: true });
  },
  // run fn on the next gesture (a permission the browser only gives with one), at once if there is no need to wait
  onGesture(fn) { unlockers.push(fn); },
  whenReady(fn) { if (ctx) fn(ctx); else onLoad.push(fn); },
  setPacks(list) { packs = list.filter(Boolean); },
  volume(cat) { return vol[cat] ?? 1; },
  has(event) { return !!lookup(event)[0]; },
  subtitleOf(event) { const [e] = lookup(event); return e ? e.subtitle || null : null; },
  setSubtitleSink(fn) { subtitleSink = fn; },
  /* A sound in the world, at (x, y, z). */
  play(event, x, y, z, volume = 1, pitch = 1, cat = 'block') {
    if (!ctx || ctx.state !== 'running') return null;
    // (a position that is not a number would throw in the panner)
    if (!Number.isFinite(x + y + z) || !Number.isFinite(volume * pitch)) return null;
    const r = pick(event);
    if (!r) return null;
    const v = start(r, [x, y, z], volume, pitch, cat);
    // a line in the subtitles for one in earshot that is not silenced, as in the game
    if (subtitleSink && r.subtitle && volume * r.volume * (vol[cat] ?? 1) > 0) {
      const range = Math.max(volume * r.volume, 1) * r.range;
      if (audibleAt(x, y, z, range) > 0) subtitleSink(r.subtitle, x, y, z, false);
    }
    return v;
  },
  /* At the listener: no panning, no distance (the button click, a level up). */
  near(event, volume = 1, pitch = 1, cat = 'ui') {
    if (!ctx || ctx.state !== 'running') return null;
    const r = pick(event);
    if (!r) return null;
    const v = start(r, null, volume, pitch, cat);
    if (subtitleSink && r.subtitle) subtitleSink(r.subtitle, 0, 0, 0, true);
    return v;
  },
  /* A held sound: under-water ambience, a biome's loop, a minecart rolling.
     opts: { at: [x, y, z] or null, volume, pitch }. The handle can move
     (pos), change volume (setVolume, with a fade in seconds) and stop. */
  loop(event, cat, o = {}) {
    if (!ctx) return null;
    const r = pick(event);
    if (!r) return null;
    const h = start(r, o.at || null, o.volume ?? 1, o.pitch ?? 1, cat, { loop: true, keep: true });
    if (!h) return null;
    return {
      voice: h,
      setVolume(v, fade = 0) {
        h.base = v * r.volume;
        const target = clamp(h.base * (vol[cat] ?? 1), 0, 1);
        if (h.g) {
          const t = ctx.currentTime;
          h.g.gain.cancelScheduledValues(t);
          if (fade > 0) { h.g.gain.setValueAtTime(h.g.gain.value, t); h.g.gain.linearRampToValueAtTime(target, t + fade); }
          else h.g.gain.value = target;
        }
      },
      pos(x, y, z) { if (h.p) { if (h.p.positionX) { h.p.positionX.value = x; h.p.positionY.value = y; h.p.positionZ.value = z; } else h.p.setPosition(x, y, z); } },
      pitch(p) { const rate = clamp(p * r.pitch, 0.5, 2); if (h.src) h.src.playbackRate.value = rate; if (h.el) h.el.playbackRate = rate; },
      stop() { stopVoice(h); },
      get stopped() { return !!h.stopped; },
    };
  },
  /* A stream played once (a music track, a record): onEnd(failed) when it is over. */
  stream(event, cat, o = {}) {
    if (!ctx || ctx.state !== 'running') return null;
    const r = pick(event);
    if (!r) return null;
    const v = start(Object.assign({}, r, { stream: true }), o.at || null, o.volume ?? 1, o.pitch ?? 1, cat, { keep: true, onEnd: o.onEnd });
    if (v) v.track = r.name;
    return v;
  },
  stop(v) { if (v) stopVoice(v); },
  stopAll(cat) { for (const v of voices.slice()) if (!cat || v.cat === cat) stopVoice(v); },
  /* the camera, once a frame: a THREE camera (its world position and turn) */
  setListener(cam) {
    const e = cam.matrixWorld.elements;
    // the camera looks down its -z, with +y up
    const fx = -e[8], fy = -e[9], fz = -e[10], l = Math.hypot(fx, fy, fz) || 1;
    const ux = e[4], uy = e[5], uz = e[6], m = Math.hypot(ux, uy, uz) || 1;
    setListener(e[12], e[13], e[14], fx / l, fy / l, fz / l, ux / m, uy / m, uz / m);
  },
  setListenerAt: setListener,
  // a gain node to put something of one's own through a category (the music manager's fades)
  gainFor(cat) { return gains[cat] || out; },
};
