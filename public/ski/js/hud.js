// The heads-up display: speed, score and the line's multiplier, trick names as they land, rail balance, a grab list.
import { GRABS, guideOf } from './grabs.js?v=26';
import { keyHelp } from './input.js?v=26';
import { rideGrabDef, rideGuide } from './board.js?v=26';      // (B: a board's, scooter's... own grab names in the lists)

const $ = id => document.getElementById(id);
/* (2026-11-12, Leon: "make it so that controls appear at the top left every time unless the user toggles them off")
   The main keys for the panel at the top left, short, for the scheme and what you ride. The full list is the menu's Keys. */
function mainKeys(scheme, kind) {
  const sled = kind === 'sled';
  if (scheme === 'keys') return [
    ['A / D', 'turn; in the air, spin'], ['W', 'tuck; in the air, front flip'], ['S', 'brake; in the air, back flip'],
    ['Space', 'hold to crouch, let go to pop'], ['Q / E', 'tilt the spin (corks)'],
    ['Shift + W / S', sled ? 'with A / D: spin flat on the snow' : 'butter on the nose / tail'],
    ['C', 'camera'], ['R', 'start again a little earlier'], ['Backspace', 'back to the top'],
    ['E', 'at a lift: ride it up'], ['Esc', 'pause, all keys'],
  ];
  return [
    ['← / →', 'turn; in the air, spin'], ['↑', 'tuck; in the air, front flip'], ['↓', 'brake; in the air, back flip'],
    ['Space', 'hold to crouch, let go to pop'], ['Shift', 'skate forward'], ['G / H', 'Lincoln loop'],
    ['N', sled ? 'with ← / →: spin flat on the snow' : 'butter (with ↓ the tail)'],
    ['Q', 'camera'], ['Enter', 'back to your last crash; twice: the start'], ['Backspace', 'back to the top'],
    ['E', 'at a lift: ride it up'], ['Esc', 'pause, all keys'],
  ];
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export class Hud {
  constructor() {
    this.kmh = $('kmh'); this.pts = $('pts'); this.combo = $('combo'); this.list = $('tricks'); this.rail = $('rail'); this.railI = document.querySelector('#railbar i');
    this.note = $('note'); this.fps = $('fps'); this.hint = $('grabhint');
    this.shown = []; this.score = 0; this.lastK = -1;
    // Tab hides the controls panel (in the Shredsauce scheme Tab sets a marker, so the key there is the one left of 1)
    // (2026-11-12, Leon: shown by default every time: no timer hides it, and the choice is not kept past this visit)
    addEventListener('keydown', e => { if (e.code === (this.scheme === 'shred' ? 'Backquote' : 'Tab') && !(e.target && e.target.tagName === 'INPUT')) { e.preventDefault(); this.hint.classList.toggle('hidden'); } });
  }
  show(on) { $('hud').classList.toggle('hidden', !on); }
  // (B: what you ride, for the grab names in the lists)
  setRide(kind) { this.kind = kind; if (this.scheme) this.setScheme(this.scheme); }
  setScheme(scheme) {
    this.scheme = scheme;
    const h = keyHelp(scheme, this.kind || 'ski'), other = this.kind && this.kind !== 'ski';   // (P: the ride's own trick keys first)
    const nm = id => { const d = other && rideGrabDef(this.kind, id); return d ? d.name : GRABS[id] ? GRABS[id].name : id; }, gd = id => other ? rideGuide(this.kind, id) : guideOf(id);
    // the controls panel at the top left: the main keys, then the grabs (or the ride's tricks), and the key that hides it
    const hideKey = scheme === 'shred' ? '`' : 'Tab';
    const row = ([k, d]) => `<div><kbd>${esc(k)}</kbd>${esc(d)}</div>`;
    this.hint.innerHTML = `<div class="gh-head"><b>Controls</b><span><kbd>${hideKey}</kbd>hides this</span></div>`
      + `<div class="gh-main">${mainKeys(scheme, this.kind || 'ski').map(row).join('')}</div>`
      + `<div class="gh-sub">${other && this.kind !== 'board' ? 'Tricks, in the air' : 'Grabs, hold in the air'}${scheme === 'shred' ? ' (+ E / R: another version)' : ''}</div>`   // (P, 2026-11-08: every ride's tricks have their own E and R versions)
      + `<div class="gh-grabs">${h.grabs.map(([k, id]) => row([k, nm(id)])).join('')}</div>`;
    const box = $('keys');
    // (X: on a scooter, snowbike or sled the grab keys are its tricks; on a sled the butter keys spin it flat on the snow)
    const base = other && this.kind === 'sled' ? h.base.map(([k, d]) => [k, /butter/.test(d) ? 'with a turn key: spin the sled flat on the snow (a spinner)' : d]) : h.base;
    box.innerHTML = base.map(([k, d]) => `<div><kbd>${k}</kbd>${d}</div>`).join('') + `<div style="margin-top:6px"><b>${other ? 'Tricks' : 'Grabs and positions'}</b></div>` + h.grabs.map(([k, id]) => `<div><kbd>${k}</kbd>${nm(id)}<span class="gg"> ${gd(id)}</span></div>`).join('');
  }
  trick(t) {
    if (t.banked) { this.score += t.points; this.pts.textContent = this.score.toLocaleString(); this.combo.textContent = ''; if (!t.name) return; }
    if (!t.name) return;
    const el = document.createElement('div');
    el.className = 'trick' + (t.quality === 'bail' || t.quality === 'sketchy' ? ' bad' : '');
    el.innerHTML = `<span class="n"></span>${t.points ? `<span class="p">+${t.points.toLocaleString()}</span>` : ''}`;
    el.querySelector('.n').textContent = t.name;
    this.list.appendChild(el);
    this.shown.push(el);
    while (this.shown.length > 3) this.shown.shift().remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, t.banked ? 1800 : 2600);
    if (!t.banked && t.combo > 1) this.combo.textContent = `x${t.combo} line`;
    if (t.quality === 'bail') this.combo.textContent = '';
  }
  frame(sk, fps) {
    const k = Math.round(sk.v.length() * 3.6);
    if (k !== this.lastK) { this.kmh.textContent = k; this.lastK = k; }
    // (the page's words are only touched when they change: a write every frame makes the browser lay the page out again)
    const onRail = sk.state === 'rail';
    if (onRail !== this.wasRail) { this.rail.classList.toggle('on', onRail); this.wasRail = onRail; }
    if (onRail) { const l = Math.round((50 + Math.max(-1, Math.min(1, sk.balance)) * 48) * 10) / 10; if (l !== this.railL) { this.railI.style.left = l + '%'; this.railL = l; } }
    if (fps == null) this.lastFps = null;
    else if (fps !== this.lastFps) { this.fps.textContent = fps; this.lastFps = fps; }
  }
  remoteTrick(who, name, pts) {
    const el = document.createElement('div'); el.className = 'trick remote';
    el.innerHTML = '<span class="n"></span><span class="p"></span>';
    el.querySelector('.n').textContent = who + ': ' + name; el.querySelector('.p').textContent = pts ? '+' + pts.toLocaleString() : '';
    this.list.appendChild(el); this.shown.push(el);
    while (this.shown.length > 3) this.shown.shift().remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, 2400);
  }
  chat(m) {
    const box = document.getElementById('chat'), el = document.createElement('div');
    if (m.sys) { el.className = 'sys'; el.textContent = m.text; }
    else { const b = document.createElement('b'); b.textContent = m.name; el.appendChild(b); el.appendChild(document.createTextNode(m.text)); }
    box.appendChild(el);
    while (box.children.length > 7) box.firstChild.remove();
    setTimeout(() => { el.classList.add('old'); setTimeout(() => el.remove(), 700); }, 11000);
  }
  flash(text, ms = 1400) { this.note.textContent = text; this.note.classList.add('on'); clearTimeout(this.nt); this.nt = setTimeout(() => this.note.classList.remove('on'), ms); }
}
