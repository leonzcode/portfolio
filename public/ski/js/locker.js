// The locker (2026-11-05, for "download 3D meshes/models for an actual helmet/jacket/pants/skis/bindings/poles ... and
// make it so that you can customize your player"): which of the five riders, a helmet or a beanie, the goggle lens,
// the colours and fit of the clothes, the skis and their top sheet, the poles. Kept in localStorage ski_look, sent to
// the room as the rider's look (net.js), and shown while the fold is open: the camera turns slowly round the rider
// beside the menu (main.js calls preview()).
import * as THREE from 'three';
import { LOOK } from './gear.js?v=26';

const KEY = 'ski_look';
const BODIES = [['m_adult_10', 'Rider 1'], ['m_adult_18', 'Rider 2'], ['m_adult_17', 'Rider 3'], ['f_adult_13', 'Rider 4'], ['f_adult_14', 'Rider 5']];
const CHOICES = {
  head: [['lid', 'Helmet'], ['painted', 'Painted helmet'], ['beanie', 'Beanie']],
  fit: [['baggy', 'Baggy'], ['regular', 'Regular'], ['slim', 'Slim']],
  ski: [['park', 'Park'], ['twin', 'Twin'], ['pow', 'Pow']],
  top: [['hoodie', 'Hoodie'], ['long', 'Long jacket'], ['jacket', 'Jacket']],
  gaiter: [['on', 'Gaiter'], ['off', 'None']],
  gog: [['on', 'Goggles on'], ['up', 'Goggles up']],
};
const WELLS = [['jacket', 'Jacket'], ['jacket2', 'Sleeves'], ['pants', 'Trousers'], ['gloves', 'Gloves'], ['helmet', 'Helmet or hat'], ['lens', 'Lens'], ['frame', 'Goggle frame'],
  ['boots', 'Boots'], ['skiA', 'Ski top'], ['skiB', 'Ski tips'], ['poleCol', 'Poles'], ['gaiterCol', 'Gaiter']];
// colours that change on the rider at once; the rest rebuild it (a moment later, so dragging a colour is smooth)
const LIVE = new Set(['jacket', 'jacket2', 'pants', 'gloves', 'helmet', 'lens', 'fit', 'top']);
const HEX = /^#[0-9a-f]{6}$/i;
// a look from storage or the room, with anything unknown or malformed dropped
export function cleanLook(l) {
  const out = Object.assign({}, LOOK);
  if (!l || typeof l !== 'object') return out;
  if (BODIES.some(b => b[0] === l.body)) out.body = l.body;
  for (const k of Object.keys(CHOICES)) if (CHOICES[k].some(c => c[0] === l[k])) out[k] = l[k];
  for (const [k] of WELLS) if (HEX.test(l[k] || '')) out[k] = l[k].toLowerCase();
  if (l.poles === 'off' || l.poles === 'on') out.poles = l.poles;
  if (!HEX.test(l.jacket2 || '')) out.jacket2 = out.jacket;          // (sleeves not chosen: the jacket's own colour)
  return out;
}
export function loadLook(start) {
  let s = null; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  return cleanLook(s || start);
}
function saveLook(l) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} }
const rnd = a => a[Math.floor(Math.random() * a.length)];
const PALETTE = ['#c8392b', '#e8702a', '#f2c230', '#3f8f4e', '#2f6db5', '#6a4fb3', '#d94f8a', '#f2f2ef', '#9aa3ad', '#2b2f36', '#16181c', '#7a5c3e', '#46b3c4', '#b7d34a'];

export class Locker {
  // box: the #locker element; fold: its <details>; onChange(look, rebuild): rebuild is false when only live colours changed
  constructor(box, fold, look, onChange) {
    this.box = box; this.fold = fold; this.look = look; this.onChange = onChange; this.timer = 0; this.ang = 0;
    this.build();
  }
  get open() { return !!(this.fold && this.fold.open); }
  build() {
    const L = this.look, box = this.box;
    box.innerHTML = '';
    const row = (lab, el) => { const r = document.createElement('div'); r.className = 'lk-row'; const s = document.createElement('span'); s.className = 'seglab'; s.textContent = lab; r.append(s, el); box.appendChild(r); return r; };
    // which rider
    const sel = document.createElement('select'); sel.className = 'lk-body';
    for (const [v, t] of BODIES) { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); }
    sel.value = L.body; sel.onchange = () => this.set('body', sel.value);
    row('Rider', sel);
    // the choices, as the menu's switches
    this.segs = {};
    for (const [k, lab] of [['head', 'Head'], ['top', 'Top'], ['fit', 'Fit'], ['gaiter', 'Face'], ['gog', 'Goggles'], ['ski', 'Skis']]) {
      const seg = document.createElement('div'); seg.className = 'seg lk-seg'; seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', lab);
      for (const [v, t] of CHOICES[k]) { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = v; b.textContent = t; b.onclick = () => this.set(k, v); seg.appendChild(b); }
      this.segs[k] = seg; row(lab, seg);
    }
    // the colours: a grid of wells
    const grid = document.createElement('div'); grid.className = 'lk-wells';
    this.wells = {};
    for (const [k, lab] of WELLS) {
      const l = document.createElement('label'); l.className = 'lk-well';
      const i = document.createElement('input'); i.type = 'color'; i.value = L[k];
      i.oninput = () => this.set(k, i.value, true); i.onchange = () => this.set(k, i.value);
      const t = document.createElement('span'); t.textContent = lab;
      l.append(i, t); grid.appendChild(l); this.wells[k] = i;
    }
    box.appendChild(grid);
    const acts = document.createElement('div'); acts.className = 'lk-acts';
    const rb = document.createElement('button'); rb.type = 'button'; rb.textContent = 'Random look'; rb.onclick = () => this.random();
    const zb = document.createElement('button'); zb.type = 'button'; zb.textContent = 'Reset'; zb.onclick = () => { this.look = Object.assign({}, LOOK); this.sync(); this.changed(true); };
    acts.append(rb, zb); box.appendChild(acts);
    this.sync();
  }
  sync() {
    const L = this.look;
    this.box.querySelector('.lk-body').value = L.body;
    for (const k in this.segs) for (const b of this.segs[k].children) b.setAttribute('aria-checked', String(b.dataset.v === L[k]));
    for (const k in this.wells) this.wells[k].value = L[k];
  }
  set(k, v, dragging = false) {
    if (this.look[k] === v) return;
    this.look = Object.assign({}, this.look, { [k]: v });
    this.sync();
    this.changed(!LIVE.has(k), dragging);
  }
  random() {
    const L = Object.assign({}, this.look);
    for (const [k] of WELLS) L[k] = rnd(PALETTE);
    L.lens = rnd(['#ff8a2a', '#2a8cff', '#c0c4cc', '#f2c230', '#d94f8a', '#3fd17a']);
    L.body = rnd(BODIES)[0]; for (const k of Object.keys(CHOICES)) L[k] = rnd(CHOICES[k])[0];
    this.look = L; this.sync(); this.changed(true);
  }
  // live colours go on now; anything else rebuilds the rider once the changes stop for a moment
  changed(rebuild, dragging = false) {
    saveLook(this.look);
    if (!rebuild) { this.onChange(this.look, false); return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onChange(this.look, true), dragging ? 450 : 120);
  }
  // the camera turning slowly round the rider, the rider to the right of the menu card
  preview(camera, rig, dt) {
    if (!rig || !rig.ready || !rig.b) return false;
    this.ang += dt * 0.45;
    const c = this._c || (this._c = new THREE.Vector3()), f = this._f || (this._f = new THREE.Vector3()), r = this._r || (this._r = new THREE.Vector3());
    c.setFromMatrixPosition(rig.b.spine.matrixWorld);
    f.set(Math.sin(this.ang), 0, Math.cos(this.ang)).applyQuaternion(rig.body.quaternion); f.y = 0; f.normalize();
    camera.position.copy(c).addScaledVector(f, 2.9); camera.position.y += 0.35;
    camera.up.set(0, 1, 0); camera.lookAt(c);
    // shift the view so the rider stands right of the card (the card covers the left of a wide screen)
    const wide = innerWidth > 900 && innerWidth / innerHeight > 1.25;
    if (wide) { r.set(1, 0, 0).applyQuaternion(camera.quaternion); camera.lookAt(c.addScaledVector(r, -0.75)); }
    return true;
  }
}
