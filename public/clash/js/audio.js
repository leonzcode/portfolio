/* Leon Clash: sound. Short effects from assets/sfx (built by tools/clash/build_audio.py
   from openly licensed packs, see CREDITS.md) and one music loop. Anything that
   has not loaded is skipped quietly. Nothing plays until the first tap (browsers
   need a gesture first). */
const V = "?v=1";
const NAMES = ["tap", "deploy", "spell", "nope", "poof", "boom", "freeze", "whistle", "tower", "lodge", "emote", "ability",
  "melee", "shot", "arrow", "snow", "win", "lose", "flag"];
// which attack sound each body makes
const ATK = {
  kid: "snow", cannon: "snow", catapult: "boom", sage: "freeze", matriarch: "freeze", owl: "freeze", flaretower: "shot",
  biathlete: "arrow", ranger: "arrow", glider: "arrow", lodge: "shot", hut: "shot",
};

export function makeAudio(base) {
  let ctx = null, master = null, sfxGain = null, musGain = null;
  const bufs = {};
  let muted = false, musicOn = false, musicSrc = null, musicBuf = null, loading = false;
  const last = {};
  try { muted = localStorage.getItem("clash.mute") === "1"; } catch (e) {}

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(master);
    musGain = ctx.createGain(); musGain.gain.value = 0.22; musGain.connect(master);
    load();
  }
  async function getBuf(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const a = await r.arrayBuffer();
      return await new Promise(function (res) { ctx.decodeAudioData(a, res, function () { res(null); }); });
    } catch (e) { return null; }
  }
  async function load() {
    if (loading) return;
    loading = true;
    let man = {};
    try { const r = await fetch(base + "assets/sfx/sfx.json" + V); if (r.ok) man = await r.json(); } catch (e) {}
    await Promise.all(NAMES.map(async function (n) { if (!man[n]) return; const b = await getBuf(base + "assets/sfx/" + man[n] + V); if (b) bufs[n] = b; }));
    if (man.music) musicBuf = await getBuf(base + "assets/sfx/" + man.music + V);
    if (musicOn) startMusic();
  }
  function unlock() { init(); if (ctx && ctx.state === "suspended") ctx.resume(); }
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);

  function play(name, vol) {
    if (!ctx || muted) return;
    const b = bufs[name];
    if (!b) return;
    const t = ctx.currentTime;
    if (last[name] && t - last[name] < 0.05) return;     // no stacking of the same sound
    last[name] = t;
    const s = ctx.createBufferSource(); s.buffer = b;
    s.playbackRate.value = 0.94 + Math.random() * 0.12;
    const g = ctx.createGain(); g.gain.value = vol == null ? 1 : vol;
    s.connect(g); g.connect(sfxGain); s.start();
  }
  function atk(u) { play(ATK[(u || "").replace("*", "")] || "melee", 0.45); }
  function startMusic() {
    if (!ctx || !musicBuf || musicSrc) return;
    musicSrc = ctx.createBufferSource(); musicSrc.buffer = musicBuf; musicSrc.loop = true;
    musicSrc.connect(musGain); musicSrc.start();
  }
  function music(on) {
    musicOn = on;
    if (on) startMusic();
    else if (musicSrc) { try { musicSrc.stop(); } catch (e) {} musicSrc = null; }
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem("clash.mute", m ? "1" : "0"); } catch (e) {}
    if (master) master.gain.value = m ? 0 : 1;
  }
  return { play, atk, music, setMuted, get muted() { return muted; }, unlock };
}
