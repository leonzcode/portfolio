// The heads-up display: speed, score and the line's multiplier, trick names as they land, rail balance, a grab list.
import { GRABS } from './rig.js?v=2';
import { keyHelp } from './input.js?v=2';

const $ = id => document.getElementById(id);
export class Hud {
  constructor() {
    this.kmh = $('kmh'); this.pts = $('pts'); this.combo = $('combo'); this.list = $('tricks'); this.rail = $('rail'); this.railI = document.querySelector('#railbar i');
    this.note = $('note'); this.fps = $('fps'); this.hint = $('grabhint');
    this.shown = []; this.score = 0; this.lastK = -1;
    addEventListener('keydown', e => { if (e.code === 'Tab' && !(e.target && e.target.tagName === 'INPUT')) { e.preventDefault(); this.hint.classList.toggle('hidden'); } });
    setTimeout(() => this.hint.classList.add('hidden'), 25000);
  }
  show(on) { $('hud').classList.toggle('hidden', !on); }
  setScheme(scheme) {
    const h = keyHelp(scheme);
    const gl = h.grabs.map(([k, id]) => `${k.padEnd(2)} ${GRABS[id].name}`).join('\n');
    this.hint.textContent = gl + '\nTab hides this list';
    const box = $('keys');
    box.innerHTML = h.base.map(([k, d]) => `<div><kbd>${k}</kbd>${d}</div>`).join('') + '<div style="margin-top:6px"><b>Grabs and positions</b></div>' + h.grabs.map(([k, id]) => `<div><kbd>${k}</kbd>${GRABS[id].name}</div>`).join('');
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
    const onRail = sk.state === 'rail';
    this.rail.classList.toggle('on', onRail);
    if (onRail) this.railI.style.left = (50 + Math.max(-1, Math.min(1, sk.balance)) * 48) + '%';
    if (fps != null) this.fps.textContent = fps;
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
