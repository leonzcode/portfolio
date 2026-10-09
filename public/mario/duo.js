/* ---------------------------------------------------------------------------
   Leon Kart - two players on one computer.

   The screen before a split screen race: who is driving, in what, with which
   hands, and where. Player 1 has the WASD side of the keyboard and Player 2
   the arrows, and a controller can take either seat: press Cross on it (or A)
   and it joins the first seat that has not got one. Nothing here races; it
   hands the game a plan and the game builds the race from it. Nothing here is
   sent anywhere either: the two looks are kept in this browser.
--------------------------------------------------------------------------- */
import { glyph, prompt, padName, kindOf, B } from './pads.js?v=106';

/* The two sides of the keyboard, by where the keys are (KeyboardEvent.code),
   so a French or German layout still gets the same four keys under the left
   hand. Player 2's drift and item keys are the ones the right hand can reach
   from the arrows. Not Right Ctrl, though it is the obvious one: held by
   Player 2 while Player 1 presses W, it is Ctrl+W, and that closes the tab
   whatever the page says. */
export const DUO_KEYS = [
  { gas: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'], hop: ['Space', 'ShiftLeft'],
    item: ['KeyE'], view: ['KeyQ'], look: ['KeyR'] },
  { gas: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    hop: ['ShiftRight', 'Numpad0'], item: ['Enter', 'NumpadEnter'], view: ['Period'], look: ['Slash'] },
];
const KEYS_TEXT = [
  '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive &middot; <kbd>Space</kbd> drift &middot; <kbd>E</kbd> item &middot; <kbd>Q</kbd> view &middot; <kbd>R</kbd> look back',
  '<kbd>&#8593;</kbd><kbd>&#8592;</kbd><kbd>&#8595;</kbd><kbd>&#8594;</kbd> drive &middot; <kbd>Right Shift</kbd> or <kbd>Num 0</kbd> drift &middot; <kbd>Enter</kbd> item &middot; <kbd>.</kbd> view &middot; <kbd>/</kbd> look back',
];
export function keysText(n) { return KEYS_TEXT[n]; }
export function padText(kind) {
  return prompt('gas', kind) + ' go &middot; ' + prompt('brake', kind) + ' brake &middot; ' + glyph('stick', kind) + ' steer &middot; '
    + prompt('hop', kind, true) + ' drift &middot; ' + prompt('item', kind, true) + ' item &middot; ' + prompt('view', kind) + ' view &middot; '
    + prompt('look', kind) + ' look back &middot; ' + prompt('pause', kind) + ' pause';
}

const PALETTE = [null, 0xe8402a, 0xff8a1f, 0xffd233, 0x43d94f, 0x1fb6a6, 0x4fb7ff, 0x2b56d6, 0x9a4fd0, 0xff5fa2, 0xf4f4f4, 0x2a2f3a];
const KEY = 'mkDuo';
const hex = n => '#' + (n & 0xffffff).toString(16).padStart(6, '0');

export function makeDuo(g) {
  const { el, esc } = g;
  let open = false;
  const pads = [null, null];             // which controller each seat has, by gamepad index
  let plan = load();
  const faces = new Map();               // driver -> picture, once drawn

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const mine = g.mine();
    const seat = (q, n) => ({
      name: (q && typeof q.name === 'string' ? q.name : (n ? 'Player 2' : (mine.name || 'Player 1'))).slice(0, 12),
      cast: q && g.canDrive(q.cast | 0) ? q.cast | 0 : (n ? (mine.cast + 3) % 8 : mine.cast),
      build: g.normalise(q && q.build ? q.build : (n ? { chassis: 'buggy' } : mine.build)),
      colour: q && (q.colour === null || typeof q.colour === 'number') ? q.colour : (n ? 0x2b56d6 : mine.colour),
      // Player 1 follows the garage until they change something here
      garage: n === 0 && (!q || q.garage !== false),
    });
    const p = s && Array.isArray(s.p) ? s.p : [];
    return {
      p: [seat(p[0], 0), seat(p[1], 1)],
      theme: s && g.themes.some(t => t.id === s.theme) ? s.theme : g.theme(),
      layout: s && s.layout === 'lr' ? 'lr' : 'tb',
    };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(plan)); } catch (e) {}
  }
  function fromGarage() {
    const P = plan.p[0];
    if (!P.garage) return;
    const mine = g.mine();
    P.cast = mine.cast; P.build = g.normalise(mine.build); P.colour = mine.colour;
    if (mine.name) P.name = mine.name.slice(0, 12);
  }

  function show(on) {
    open = !!on;
    el('duo').classList.toggle('on', open);
    if (!open) return;
    fromGarage();
    // a controller unplugged since the last visit has no seat
    for (let n = 0; n < 2; n++) if (pads[n] !== null && !g.pads.has(pads[n])) pads[n] = null;
    draw();
    const first = el('duo').querySelector('#duomode button');
    if (first) first.focus({ preventScroll: true });
  }

  /* Drawn whole each time, and whatever had the focus gets it back: a pad
     moving through the cards would otherwise be thrown back to the top by
     every arrow it pressed. Each control carries a data-f naming it. */
  function draw() {
    const box = el('duocards');
    if (!box) return;
    const had = document.activeElement && el('duo').contains(document.activeElement) ? document.activeElement.getAttribute('data-f') : null;
    box.innerHTML = card(0) + '<button type="button" class="dswap" data-f="swap" aria-label="Swap the controllers"'
      + (pads[0] === null && pads[1] === null ? ' hidden' : '') + '>&#8645;<small>swap</small></button>' + card(1);
    el('duomaps').innerHTML = g.themes.map(t =>
      '<button type="button" data-f="t:' + t.id + '" data-t="' + t.id + '"' + (t.id === plan.theme ? ' class="on"' : '') + '>'
      + '<i style="background:linear-gradient(' + hex(t.sky) + ' 0 55%,' + t.ground + ' 55% 100%)"></i>' + esc(t.name) + '</button>').join('');
    el('duolay').innerHTML = [['tb', 'Top and bottom'], ['lr', 'Side by side']].map(([v, t]) =>
      '<button type="button" data-f="l:' + v + '" data-lay="' + v + '"' + (plan.layout === v ? ' class="on"' : '') + '>' + t + '</button>').join('');
    for (let n = 0; n < 2; n++) faceFor(n);
    if (had) {
      const back = el('duo').querySelector('[data-f="' + had + '"]');
      if (back && !back.hidden) back.focus({ preventScroll: true });
    }
  }
  function card(n) {
    const P = plan.p[n];
    const row = (k, label, name) => '<div class="drow"><em>' + label + '</em>'
      + '<button type="button" data-f="' + n + k + '-" data-n="' + n + '" data-k="' + k + '" data-d="-1" aria-label="Player ' + (n + 1) + ', previous ' + label.toLowerCase() + '">&lsaquo;</button>'
      + '<b>' + esc(name) + '</b>'
      + '<button type="button" data-f="' + n + k + '+" data-n="' + n + '" data-k="' + k + '" data-d="1" aria-label="Player ' + (n + 1) + ', next ' + label.toLowerCase() + '">&rsaquo;</button></div>';
    const partRows = g.parts.map(part => row(part.key, part.label, (part.list.find(x => x.id === P.build[part.key]) || part.list[0]).name)).join('');
    const pal = PALETTE.slice();
    if (P.colour !== null && pal.indexOf(P.colour) < 0) pal.splice(1, 0, P.colour);
    const swatches = pal.map((c, i) =>
      '<button type="button" data-f="' + n + 'c' + i + '" data-n="' + n + '" data-c="' + (c === null ? '' : c) + '"'
      + ' class="' + (c === null ? 'def' : '') + (c === P.colour ? ' on' : '') + '"'
      + (c === null ? '' : ' style="background:' + hex(c) + '"')
      + ' aria-label="Player ' + (n + 1) + ' paint ' + (c === null ? 'as the driver comes' : hex(c)) + '"></button>').join('');
    const pi = pads[n];
    const pad = pi !== null ? g.pads.get(pi) : null;
    const anyKind = (() => { for (const i of g.pads.indices()) return g.pads.get(i).kind; return 'ps'; })();
    const dev = pad
      ? '<p class="dpad"><b>' + icon() + ' Controller ' + (pi + 1) + '</b> &middot; ' + esc(padName(pad.id))
        + ' <button type="button" class="dleave" data-f="' + n + 'leave" data-leave="' + n + '">Use the keyboard</button></p>'
        + '<p class="dkeys">' + padText(pad.kind) + '</p>'
        + '<p class="dkeys also">Keyboard too: ' + KEYS_TEXT[n] + '</p>'
      : '<p class="dkeys">' + KEYS_TEXT[n] + '</p>'
        + '<p class="djoin">Controller? Press ' + glyph('cross', anyKind) + ' on it to join.</p>';
    return '<section class="dcard p' + (n + 1) + '" data-n="' + n + '" aria-label="Player ' + (n + 1) + '">'
      + '<header><b class="dtag">P' + (n + 1) + '</b><label class="sr" for="dname' + n + '">Player ' + (n + 1) + ' name</label>'
      + '<input id="dname' + n + '" class="dname" data-f="' + n + 'name" data-n="' + n + '" maxlength="12" autocomplete="off" spellcheck="false" value="' + esc(P.name) + '"></header>'
      + '<div class="dlook"><i class="dface" data-face="' + n + '" style="--paint:' + (P.colour === null ? hex(g.racers[P.cast].kart) : hex(P.colour)) + '"></i>'
      + '<div class="drows">' + row('cast', 'Driver', g.racers[P.cast].name) + partRows + '</div></div>'
      + '<div class="dpaint" role="group" aria-label="Player ' + (n + 1) + ' paint">' + swatches + '</div>'
      + '<div class="ddev">' + dev + '</div></section>';
  }
  function icon() {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 8h10a5 5 0 0 1 4.6 7l-.8 2a2.4 2.4 0 0 1-4.1.5L15 15H9l-1.7 2.5a2.4 2.4 0 0 1-4.1-.5l-.8-2A5 5 0 0 1 7 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  }
  function faceFor(n) {
    const box = el('duo').querySelector('[data-face="' + n + '"]');
    if (!box) return;
    const cast = plan.p[n].cast;
    const put = url => { if (url && box.isConnected && plan.p[n].cast === cast) box.innerHTML = '<img alt="" src="' + url + '">'; };
    if (faces.has(cast)) { put(faces.get(cast)); return; }
    Promise.resolve(g.portrait(cast)).then(url => { if (url) faces.set(cast, url); put(url); }).catch(() => {});
  }

  function stepCast(n, d) {
    const P = plan.p[n];
    const L = g.racers.length;
    let c = P.cast;
    for (let k = 0; k < L; k++) { c = ((c + d) % L + L) % L; if (g.canDrive(c)) break; }
    P.cast = c;
  }
  function stepPart(n, key, d) {
    const P = plan.p[n];
    const part = g.parts.find(q => q.key === key);
    if (!part) return;
    const i = part.list.findIndex(x => x.id === P.build[key]);
    P.build = Object.assign({}, P.build, { [key]: part.list[(((i < 0 ? 0 : i) + d) % part.list.length + part.list.length) % part.list.length].id });
  }

  el('duo').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !el('duo').contains(b)) return;
    if (b.dataset.m) { go(b.dataset.m); return; }
    if (b.id === 'duoback') { show(false); return; }
    if (b.dataset.t) { plan.theme = b.dataset.t; save(); draw(); g.tick(); return; }
    if (b.dataset.lay) { plan.layout = b.dataset.lay; save(); draw(); g.tick(); return; }
    if (b.classList.contains('dswap')) { const t = pads[0]; pads[0] = pads[1]; pads[1] = t; draw(); g.tick(); return; }
    if (b.dataset.leave !== undefined) { pads[+b.dataset.leave] = null; draw(); g.tick(); return; }
    const n = +b.dataset.n;
    if (!(n === 0 || n === 1)) return;
    if (b.dataset.k) {
      if (b.dataset.k === 'cast') stepCast(n, +b.dataset.d);
      else stepPart(n, b.dataset.k, +b.dataset.d);
    } else if (b.dataset.c !== undefined) {
      plan.p[n].colour = b.dataset.c === '' ? null : +b.dataset.c;
    } else return;
    if (n === 0) plan.p[0].garage = false;
    save(); draw(); g.tick();
  });
  el('duo').addEventListener('input', e => {
    const t = e.target;
    if (!t.classList || !t.classList.contains('dname')) return;
    const n = +t.dataset.n;
    plan.p[n].name = t.value.slice(0, 12);
    if (n === 0) plan.p[0].garage = false;
    save();
  });
  // typing a name is typing, not driving or starting anything
  el('duo').addEventListener('keydown', e => {
    if (e.target.classList && e.target.classList.contains('dname')) {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
    } else if (e.key === 'Escape') { show(false); e.stopPropagation(); e.preventDefault(); }
  });

  function go(mode) {
    const names = plan.p.map((P, n) => (P.name || '').trim() || 'Player ' + (n + 1));
    if (names[0].toLowerCase() === names[1].toLowerCase()) names[1] = names[1].slice(0, 10) + ' 2';
    show(false);
    g.start({
      mode: mode === 'vs' ? 'vs' : 'race', theme: plan.theme, layout: plan.layout,
      p: plan.p.map((P, n) => ({ name: names[n], cast: P.cast, build: g.normalise(P.build), colour: P.colour, pad: pads[n] })),
    });
  }

  /* A press on controller i while this screen is up. One that has no seat yet
     takes the first free one when it presses Cross or Options; anything else
     it presses moves round the screen like any pad. True if the press was
     used here. */
  function pad(i, s) {
    if (!open) return false;
    if (pads.indexOf(i) >= 0) return false;
    if (!(s.went[B.CROSS] || s.went[B.OPTIONS])) return false;
    const free = pads.indexOf(null);
    if (free < 0) return false;
    pads[free] = i;
    draw();
    g.ding();
    return true;
  }
  // a controller takes the first free seat, unless it has one already
  function seat(i) {
    if (!open || pads.indexOf(i) >= 0 || !g.pads.has(i)) return false;
    const free = pads.indexOf(null);
    if (free < 0) return false;
    pads[free] = i;
    draw();
    return true;
  }
  // a controller went: its seat is free again
  function lost(i) {
    const n = pads.indexOf(i);
    if (n >= 0) { pads[n] = null; if (open) draw(); }
  }

  return {
    show, pad, lost, seat,
    redraw() { if (open) draw(); },
    get open() { return open; },
    get plan() { return plan; },
    get pads() { return pads.slice(); },
    kindOfPad: i => { const s = g.pads.get(i); return s ? s.kind : kindOf(''); },
  };
}
