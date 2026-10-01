import { Match, STAGES } from './engine.js';
import { ROSTER, fighterById } from './fighters.js';
import { CPU } from './ai.js';
import { Renderer, SLOT_COLORS, SLOT_LABEL } from './render.js';
import { poseFor, drawFighter, shade } from './anim.js';
import { Sound } from './audio.js';
import { listenKeys, readKeyboard, readPad, pads, KEYMAPS, keyDown } from './input.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
const R = new Renderer(canvas);
const sound = new Sound();
listenKeys();

// ------------------------------------------------------------- settings
const DEFAULT = {
  stocks: 3,
  stage: 'final',
  slots: [
    { type: 'human', device: 'kb1', char: 'ember', level: 5 },
    { type: 'cpu', device: 'kb2', char: 'volt', level: 5 },
    { type: 'off', device: 'pad0', char: 'rook', level: 5 },
    { type: 'off', device: 'pad1', char: 'lyra', level: 5 },
  ],
};
let cfg = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem('blastzone')); if (s && s.slots && s.slots.length === 4) return s; } catch (e) {}
  return JSON.parse(JSON.stringify(DEFAULT));
}
function save() { try { localStorage.setItem('blastzone', JSON.stringify(cfg)); } catch (e) {} }

let muted = false;
try { muted = localStorage.getItem('blastzone-muted') === '1'; } catch (e) {}
sound.setMuted(muted);
const muteBtn = $('mute');
const paintMute = () => { muteBtn.textContent = muted ? 'Sound off' : 'Sound on'; muteBtn.setAttribute('aria-pressed', String(muted)); };
paintMute();
muteBtn.addEventListener('click', () => { muted = !muted; sound.setMuted(muted); paintMute(); try { localStorage.setItem('blastzone-muted', muted ? '1' : '0'); } catch (e) {} });

const unlock = () => { const first = !sound.ctx; sound.unlock(); if (first && sound.ctx) sound.startMusic(screen === 'match' || screen === 'pause' ? 'battle' : 'menu'); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

// ------------------------------------------------------------- screens
let screen = 'title';
let match = null, cpus = [], live = [];
let demo = null, demoCpus = [];
let paused = false;
let focusSlot = 0;

function show(name) {
  screen = name;
  for (const id of ['title', 'select', 'stage', 'pause', 'results']) $(id).classList.toggle('on', id === name);
  document.body.classList.toggle('playing', name === 'match' || name === 'pause');
  if (name === 'select') buildSelect();
  if (name === 'stage') buildStages();
  if (name === 'match') sound.startMusic('battle');
  else if (name === 'title' || name === 'select' || name === 'stage') sound.startMusic('menu');
  else if (name === 'results') sound.stopMusic();
}

function newDemo() {
  const a = ROSTER[Math.floor(Math.random() * ROSTER.length)].id;
  let b = ROSTER[Math.floor(Math.random() * ROSTER.length)].id;
  if (b === a) b = ROSTER[(ROSTER.findIndex(c => c.id === a) + 1) % ROSTER.length].id;
  demo = new Match({ stage: Math.random() < 0.5 ? 'final' : 'ruins', stocks: 2, countdown: false, players: [{ char: a, cpu: 8 }, { char: b, cpu: 8 }] });
  demoCpus = [new CPU(8), new CPU(8)];
  R.updateCamera(demo, true);
}
newDemo();

$('go').addEventListener('click', () => { sound.play('select'); show('select'); });
$('toTitle').addEventListener('click', () => { sound.play('back'); show('title'); });
$('toStage').addEventListener('click', () => { sound.play('select'); show('stage'); });
$('stageBack').addEventListener('click', () => { sound.play('back'); show('select'); });
$('resume').addEventListener('click', () => setPaused(false));
$('restart').addEventListener('click', () => { setPaused(false); startMatch(); });
$('quit').addEventListener('click', () => { setPaused(false); match = null; show('select'); });
$('boxes').addEventListener('click', e => { R.showHitboxes = !R.showHitboxes; e.currentTarget.setAttribute('aria-pressed', String(R.showHitboxes)); e.currentTarget.textContent = R.showHitboxes ? 'Hide hitboxes' : 'Show hitboxes'; });
$('again').addEventListener('click', () => { sound.play('select'); startMatch(); });
$('change').addEventListener('click', () => { sound.play('back'); match = null; show('select'); });
document.querySelectorAll('[data-stock]').forEach(b => b.addEventListener('click', () => {
  cfg.stocks = Math.max(1, Math.min(9, cfg.stocks + +b.dataset.stock)); $('stocks').textContent = cfg.stocks; save(); sound.play('menu');
}));

// ------------------------------------------------------------- fighter select
const DEVICES = [['kb1', 'Keyboard 1'], ['kb2', 'Keyboard 2'], ['pad0', 'Controller 1'], ['pad1', 'Controller 2'], ['pad2', 'Controller 3'], ['pad3', 'Controller 4']];
let tileCanvases = [], slotCanvases = [];

function buildSelect() {
  $('stocks').textContent = cfg.stocks;
  const roster = $('roster');
  roster.innerHTML = '';
  tileCanvases = [];
  for (const c of ROSTER) {
    const b = document.createElement('button');
    b.className = 'tile'; b.type = 'button';
    b.style.setProperty('--c2', shade(c.colors.body, -0.35));
    b.setAttribute('aria-label', 'Choose ' + c.name);
    const cv = document.createElement('canvas');
    b.appendChild(cv);
    b.insertAdjacentHTML('beforeend', '<span class="chips"></span><span class="nm">' + c.name + '</span><span class="tt">' + c.title + ' · weight ' + c.weight + '</span>');
    b.addEventListener('click', () => {
      cfg.slots[focusSlot].char = c.id;
      if (cfg.slots[focusSlot].type === 'off') cfg.slots[focusSlot].type = focusSlot === 0 ? 'human' : 'cpu';
      save(); sound.play('select'); buildSlots(); paintChips();
    });
    roster.appendChild(b);
    tileCanvases.push({ cv, c });
  }
  buildSlots(); paintChips();
}

function paintChips() {
  const tiles = $('roster').querySelectorAll('.tile');
  ROSTER.forEach((c, i) => {
    const box = tiles[i].querySelector('.chips');
    box.innerHTML = cfg.slots.map((s, k) => s.type !== 'off' && s.char === c.id ? '<i style="background:' + SLOT_COLORS[k] + '">' + (s.type === 'cpu' ? 'CPU' : SLOT_LABEL[k]) + '</i>' : '').join('');
  });
}

function buildSlots() {
  const wrap = $('slots');
  wrap.innerHTML = '';
  slotCanvases = [];
  cfg.slots.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'slot' + (s.type === 'off' ? ' off' : '') + (i === focusSlot ? ' focus' : '');
    card.style.setProperty('--pc', SLOT_COLORS[i]);
    const c = fighterById(s.char);
    card.innerHTML =
      '<div class="top"><span class="pl">' + SLOT_LABEL[i] + '</span><div class="seg" role="group" aria-label="' + SLOT_LABEL[i] + ' type">'
      + ['human', 'cpu', 'off'].map(t => '<button type="button" data-t="' + t + '" aria-pressed="' + (s.type === t) + '">' + (t === 'human' ? 'Player' : t === 'cpu' ? 'CPU' : 'Off') + '</button>').join('')
      + '</div></div>'
      + '<div class="pick"><canvas></canvas><button class="arr l" type="button" aria-label="Previous fighter">&lsaquo;</button><button class="arr r" type="button" aria-label="Next fighter">&rsaquo;</button></div>'
      + '<div class="who">' + (s.type === 'off' ? '&mdash;' : c.name) + '</div>'
      + (s.type === 'human'
        ? '<label>Controls <select aria-label="' + SLOT_LABEL[i] + ' controls">' + DEVICES.map(([v, l]) => '<option value="' + v + '"' + (s.device === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>'
        : s.type === 'cpu'
          ? '<label>Level <input type="range" min="1" max="9" value="' + s.level + '" aria-label="' + SLOT_LABEL[i] + ' CPU level"><span class="lv">' + s.level + '</span></label>'
          : '<label>Turn this player on to join</label>');
    card.addEventListener('pointerdown', () => { if (focusSlot !== i) { focusSlot = i; wrap.querySelectorAll('.slot').forEach((el, k) => el.classList.toggle('focus', k === i)); } });
    card.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { s.type = b.dataset.t; focusSlot = i; save(); sound.play('menu'); buildSlots(); paintChips(); }));
    const cyc = d => { const k = ROSTER.findIndex(r => r.id === s.char); s.char = ROSTER[(k + d + ROSTER.length) % ROSTER.length].id; if (s.type === 'off') s.type = 'cpu'; save(); sound.play('menu'); buildSlots(); paintChips(); };
    card.querySelector('.arr.l').addEventListener('click', () => cyc(-1));
    card.querySelector('.arr.r').addEventListener('click', () => cyc(1));
    const sel = card.querySelector('select');
    if (sel) sel.addEventListener('change', () => { s.device = sel.value; save(); paintKeys(); });
    const rng = card.querySelector('input[type=range]');
    if (rng) rng.addEventListener('input', () => { s.level = +rng.value; card.querySelector('.lv').textContent = s.level; save(); });
    wrap.appendChild(card);
    slotCanvases.push({ cv: card.querySelector('.pick canvas'), s, i });
  });
  const n = cfg.slots.filter(s => s.type !== 'off').length;
  $('toStage').disabled = n < 2;
  $('toStage').textContent = n < 2 ? 'Add a second player' : 'Choose stage';
  paintKeys();
}

function paintKeys() {
  const used = new Set(cfg.slots.filter(s => s.type === 'human').map(s => s.device));
  const lines = [];
  for (const id of ['kb1', 'kb2']) if (used.has(id)) lines.push('<b>' + KEYMAPS[id].label + ':</b> ' + KEYMAPS[id].help);
  if ([...used].some(d => d.startsWith('pad'))) lines.push('<b>Controller:</b> left stick moves · A attack · B special · X or Y jump · bumpers and triggers shield · left bumper grabs · right stick smashes · Start pauses');
  lines.push('<b>Tips:</b> tap a direction with attack (or hold Smash) for a smash attack, and hold it to charge · shield + direction rolls · shield in the air air-dodges · press down in the air to fast-fall · Esc pauses');
  $('keys').innerHTML = lines.join('<br>');
}

function drawPortrait(cv, c, frame, tile) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const fake = { c, slot: tile ? 0 : 1, state: 'idle', sf: frame, face: tile ? -1 : 1, h: 74 * c.size, x: 0, y: 0 };
  const sc = tile ? h / 120 : h / 105;
  drawFighter(ctx, fake, poseFor(fake, frame), { x: tile ? w * 0.68 : w / 2, y: h - (tile ? 8 : 6), scale: sc, face: tile ? -1 : 1, frame });
}

// ------------------------------------------------------------- stage select
let stagePreviews = [];
function buildStages() {
  const wrap = $('stages');
  wrap.innerHTML = '';
  stagePreviews = [];
  const info = { final: 'One wide flat platform. No hiding.', ruins: 'Three floating platforms over a stone deck.' };
  for (const id of Object.keys(STAGES)) {
    const b = document.createElement('button');
    b.className = 'stagecard'; b.type = 'button';
    b.innerHTML = '<canvas></canvas><span class="nm">' + STAGES[id].name + '</span><span class="tt">' + info[id] + '</span>';
    b.addEventListener('click', () => { cfg.stage = id; save(); sound.play('select'); startMatch(); });
    wrap.appendChild(b);
    const cv = b.querySelector('canvas');
    const r = new Renderer(cv);
    const m = new Match({ stage: id, stocks: 1, countdown: false, players: [] });
    stagePreviews.push({ r, m });
  }
}

// ------------------------------------------------------------- matches
function startMatch() {
  live = cfg.slots.map((s, i) => Object.assign({ slot: i }, s)).filter(s => s.type !== 'off');
  match = new Match({ stage: cfg.stage, stocks: cfg.stocks, players: live.map(s => ({ char: s.char, cpu: s.type === 'cpu' ? s.level : 0 })) });
  // keep slot colours: fighters take the colour of the slot they came from
  match.fighters.forEach((f, k) => { f.slot = live[k].slot; f.team = live[k].slot; });
  cpus = live.map(s => (s.type === 'cpu' ? new CPU(s.level) : null));
  R.trails = {}; R.hud = {};
  R.updateCamera(match, true);
  paused = false;
  show('match');
}

function setPaused(p) {
  if (!match || match.over) return;
  paused = p;
  $('pause').classList.toggle('on', p);
  screen = p ? 'pause' : 'match';
  if (p) $('resume').focus();
}

function inputsFor(m, cpusArr, slots) {
  return m.fighters.map((f, k) => {
    if (cpusArr[k]) return cpusArr[k].think(m, f);
    const dev = slots[k].device;
    if (dev === 'kb1' || dev === 'kb2') return readKeyboard(dev);
    return readPad(+dev.slice(3));
  });
}

function showResults() {
  const places = match.fighters.slice().sort((a, b) => (a.place || 99) - (b.place || 99));
  const w = match.winner;
  $('winner').innerHTML = w ? '<em style="--wc:' + w.c.colors.body + '">' + w.c.name + '</em> wins!' : 'No contest';
  $('winner').style.setProperty('--wc', w ? w.c.colors.body : '#fff');
  $('board').innerHTML = places.map(f => '<tr><td class="place">' + f.place + '</td><td class="pl" style="color:' + SLOT_COLORS[f.slot] + '">'
    + f.c.name + ' <small style="color:var(--mute);font-size:14px">' + (f.cpu ? 'CPU ' + f.cpu : SLOT_LABEL[f.slot]) + '</small></td><td>' + f.stats.kos + '</td><td>' + f.stats.falls + '</td><td>' + Math.round(f.stats.dealt) + '%</td><td>' + f.stats.sds + '</td></tr>').join('');
  show('results');
  $('again').focus();
}

// ------------------------------------------------------------- keys & pads
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'Escape') {
    if (screen === 'match') setPaused(true);
    else if (screen === 'pause') setPaused(false);
    else if (screen === 'stage') show('select');
    else if (screen === 'select') show('title');
  }
  if (e.code === 'Enter' && document.activeElement === document.body) {
    if (screen === 'title') { sound.play('select'); show('select'); }
    else if (screen === 'select' && !$('toStage').disabled) { sound.play('select'); show('stage'); }
    else if (screen === 'results') startMatch();
  }
});

let padPrev = {};
let knownPads = 0;
function pollPads() {
  const list = pads();
  if (list.length !== knownPads) {
    if (list.length > knownPads) toast('Controller connected. Pick it under Controls for a player.');
    knownPads = list.length;
  }
  for (const p of list) {
    const st = readPad(p.index);
    const prev = padPrev[p.index] || {};
    const pressA = st.held.a && !prev.a, pressStart = st.start && !prev.start;
    if (screen === 'title' && (pressA || pressStart)) { sound.play('select'); show('select'); }
    else if (screen === 'select' && pressStart && !$('toStage').disabled) show('stage');
    else if (screen === 'stage' && pressStart) startMatch();
    else if ((screen === 'match' || screen === 'pause') && pressStart) setPaused(screen === 'match');
    else if (screen === 'results' && pressStart) startMatch();
    padPrev[p.index] = { a: st.held.a, start: st.start };
  }
}

let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; toastT = 240; }

// ------------------------------------------------------------- loop
let last = performance.now(), acc = 0, frameN = 0, slowTick = 0;
const STEP = 1000 / 60;

function tick() {
  frameN++;
  pollPads();
  if (toastT > 0 && --toastT === 0) $('toast').style.display = 'none';
  if (screen === 'match' && match) {
    if (match.slowmo > 0) { match.slowmo--; if (++slowTick % 3 !== 0) return; }
    match.step(inputsFor(match, cpus, live));
    for (const s of match.sounds) sound.play(s.name, s.vol);
    if (match.over && match.overT === 1) sound.stopMusic();
    if (match.over && match.overT > 150) showResults();
  } else if (screen === 'title' && demo) {
    demo.step(inputsFor(demo, demoCpus, []));
    if (demo.over && demo.overT > 90) newDemo();
  }
}

function render() {
  if ((screen === 'match' || screen === 'pause' || screen === 'results') && match) {
    if (screen === 'match') R.updateCamera(match);
    R.noBanner = screen === 'results';
    R.draw(match, frameN);
  } else if (screen === 'title' && demo) {
    R.updateCamera(demo);
    R.draw(demo, frameN);
  } else if (screen === 'select') {
    for (const t of tileCanvases) drawPortrait(t.cv, t.c, frameN, true);
    for (const t of slotCanvases) { if (t.s.type !== 'off') drawPortrait(t.cv, fighterById(t.s.char), frameN, false); else t.cv.getContext('2d').clearRect(0, 0, t.cv.width, t.cv.height); }
  } else if (screen === 'stage') {
    for (const p of stagePreviews) { p.r.cam = { x: 0, y: -120, z: 0.5 }; p.r.updateCamera(p.m, true); p.r.draw(p.m, frameN); }
  }
}

function loop(now) {
  let dt = now - last; last = now;
  if (dt > 250) dt = STEP;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) { tick(); acc -= STEP; n++; }
  if (n === 5) acc = 0;
  render();
  requestAnimationFrame(loop);
}

// ?scene= jumps straight to a screen (handy for testing and sharing a quick match)
const scene = new URLSearchParams(location.search).get('scene');
if (scene === 'select') show('select');
else if (scene === 'stage') show('stage');
else if (scene === 'match') { cfg.slots[0].type = 'cpu'; startMatch(); }

if (document.fonts && document.fonts.load) document.fonts.load('italic 900 40px "Barlow Condensed"').catch(() => {});
requestAnimationFrame(loop);
