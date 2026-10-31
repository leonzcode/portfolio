// "Your look": the player's person on a turntable, and the choices that make it (woman or man, adult or child, the
// person and outfit, height, build, skin, hair, top, trousers or skirt and shoes colours), kept in localStorage
// car_look. Opened with P or from the car chooser. Saving tells the on-foot module (onfoot.js relook) and the drive
// ({ type: 'look', look } on drive.events).
//   const ui = new LookUI(drive); ui.open(); ui.close(); ui.toggle()
import * as THREE from 'three';
import { People } from './people.js?v=49';

const KEY = 'car_look';
const SKIN = ['#f6d7c3', '#eac0a0', '#d4a07a', '#b07a52', '#8a5636', '#5e3a24', '#3f271a'];
const HAIR = ['#14100d', '#33241a', '#5b3c26', '#8a5c38', '#b48a58', '#dcc08c', '#8c8a86', '#e8e4dc', '#8e3420', '#c25a2a'];
const TOP = ['#f4f4f0', '#1c1f26', '#9e1c24', '#c8462e', '#2a4d7a', '#5d8fc4', '#3d5a3a', '#c9a227', '#7a2e5a', '#e7a3b5', '#6b6f75', '#4b3a2a'];
const BOTTOM = ['#1b2433', '#3b4a63', '#262626', '#5a5f66', '#6d5a43', '#c2b49a', '#2f3d2a', '#7a1f2b'];
const SHOES = ['#111111', '#f0f0ee', '#5a3a24', '#8a6a4a', '#7a1e1e', '#2a3d66'];

const CSS = `
.lk { position: fixed; inset: 0; z-index: 1002; display: none; pointer-events: auto; font: 14px/1.4 Roboto, "Google Sans", system-ui, sans-serif; color: #202124; }
.lk.on { display: block; }
.lk-dim { position: absolute; inset: 0; background: rgba(0,0,0,.28); }
.lk-card { position: absolute; left: 16px; top: 16px; bottom: 16px; width: min(720px, calc(100vw - 32px)); background: #fff; border-radius: 12px; box-shadow: 0 2px 6px rgba(60,64,67,.3), 0 8px 24px 4px rgba(60,64,67,.18); display: grid; grid-template-columns: 300px 1fr; overflow: hidden; }
.lk-stage { position: relative; background: radial-gradient(120% 80% at 50% 92%, #e9eef6 0%, #f6f8fb 55%, #ffffff 100%); border-right: 1px solid #e8eaed; }
.lk-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.lk-stage canvas:active { cursor: grabbing; }
.lk-hint { position: absolute; left: 0; right: 0; bottom: 12px; text-align: center; font-size: 12px; color: #5f6368; pointer-events: none; }
.lk-name { position: absolute; left: 16px; right: 16px; top: 14px; font-size: 12px; color: #5f6368; }
.lk-name b { display: block; font: 500 18px/1.3 "Google Sans", Roboto, system-ui; color: #202124; }
.lk-side { display: flex; flex-direction: column; min-height: 0; }
.lk-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 6px 20px; }
.lk-head h2 { margin: 0; font: 400 22px/1.3 "Google Sans", Roboto, system-ui; }
.lk-x { border: 0; background: none; font-size: 22px; line-height: 1; cursor: pointer; color: #5f6368; padding: 6px 8px; border-radius: 50%; }
.lk-x:hover { background: #f1f3f4; }
.lk-body { overflow-y: auto; padding: 4px 20px 12px; flex: 1; }
.lk-sec { padding: 12px 0; border-bottom: 1px solid #f1f3f4; }
.lk-sec:last-child { border-bottom: 0; }
.lk-lab { font-size: 12px; font-weight: 500; color: #5f6368; margin-bottom: 8px; display: flex; justify-content: space-between; }
.lk-lab span { font-weight: 400; }
.lk-seg { display: inline-flex; border: 1px solid #dadce0; border-radius: 18px; overflow: hidden; margin-right: 8px; }
.lk-seg button { border: 0; background: #fff; padding: 7px 16px; font: 500 13px Roboto, system-ui; color: #3c4043; cursor: pointer; }
.lk-seg button + button { border-left: 1px solid #dadce0; }
.lk-seg button.on { background: #e8f0fe; color: #1967d2; }
.lk-pick { display: flex; align-items: center; gap: 8px; }
.lk-arrow { width: 34px; height: 34px; border-radius: 50%; border: 1px solid #dadce0; background: #fff; cursor: pointer; font-size: 16px; color: #3c4043; flex: none; }
.lk-arrow:hover, .lk-seg button:hover:not(.on) { background: #f8f9fa; }
.lk-pickt { flex: 1; text-align: center; }
.lk-pickt b { display: block; font-weight: 500; }
.lk-pickt small { color: #5f6368; }
.lk-range { width: 100%; accent-color: #1a73e8; }
.lk-sw { display: flex; flex-wrap: wrap; gap: 8px; }
.lk-sw button { width: 28px; height: 28px; border-radius: 50%; border: 1px solid rgba(0,0,0,.15); cursor: pointer; padding: 0; position: relative; }
.lk-sw button.on { box-shadow: 0 0 0 2px #fff, 0 0 0 4px #1a73e8; }
.lk-sw .own { width: auto; padding: 0 10px; border-radius: 14px; background: #fff; border-color: #dadce0; font: 500 12px Roboto, system-ui; color: #3c4043; }
.lk-sw .own.on { background: #e8f0fe; color: #1967d2; border-color: #e8f0fe; box-shadow: none; }
.lk-foot { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid #e8eaed; }
.lk-btn { border: 1px solid #dadce0; background: #fff; color: #1a73e8; border-radius: 18px; padding: 8px 18px; font: 500 14px Roboto, system-ui; cursor: pointer; }
.lk-btn:hover { background: #f8fbff; }
.lk-btn.main { background: #1a73e8; color: #fff; border-color: #1a73e8; }
.lk-btn.main:hover { background: #1765cc; }
.lk-btn.left { margin-right: auto; color: #3c4043; }
.lk button:focus-visible, .lk input:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
.hud-lookbtn { display: block; width: calc(100% - 24px); margin: 4px 12px 10px; border: 1px solid #dadce0; background: #fff; color: #1a73e8; border-radius: 16px; padding: 7px 12px; font: 500 13px Roboto, system-ui; cursor: pointer; }
@media (max-width: 640px) {
  .lk-card { left: 0; right: 0; top: auto; bottom: 0; width: auto; height: 92vh; border-radius: 16px 16px 0 0; grid-template-columns: 1fr; grid-template-rows: 38% 1fr; }
  .lk-stage { border-right: 0; border-bottom: 1px solid #e8eaed; }
  .lk-head { padding-top: 8px; }
}
@media (prefers-reduced-motion: reduce) { .lk-stage canvas { cursor: default; } }
`;

export function loadLook() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && typeof s === 'object') return s; } catch (e) {}
  return null;
}

export class LookUI {
  constructor(drive) {
    this.drive = drive; this.isOpen = false;
    if (!document.getElementById('lk-css')) { const s = document.createElement('style'); s.id = 'lk-css'; s.textContent = CSS; document.head.appendChild(s); }
    const el = this.el = document.createElement('div');
    el.className = 'lk'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Your look');
    el.innerHTML = `<div class="lk-dim"></div>
      <div class="lk-card">
        <div class="lk-stage"><div class="lk-name">You<b class="lk-nm">Your look</b></div><canvas></canvas><div class="lk-hint">Drag to turn</div></div>
        <div class="lk-side">
          <div class="lk-head"><h2>Your look</h2><button class="lk-x" aria-label="Close">&times;</button></div>
          <div class="lk-body">
            <div class="lk-sec"><div class="lk-lab">Body</div>
              <div class="lk-seg lk-sex"><button data-v="f">Woman</button><button data-v="m">Man</button></div>
              <div class="lk-seg lk-age"><button data-v="a">Adult</button><button data-v="k">Child</button></div></div>
            <div class="lk-sec"><div class="lk-lab">Face, hair and outfit <span class="lk-count"></span></div>
              <div class="lk-pick"><button class="lk-arrow lk-prev" aria-label="Previous">&#8249;</button><div class="lk-pickt"><b class="lk-style"></b><small>Each person has their own face and clothes</small></div><button class="lk-arrow lk-next" aria-label="Next">&#8250;</button></div></div>
            <div class="lk-sec"><div class="lk-lab">Height <span class="lk-hv"></span></div><input type="range" class="lk-range lk-height" min="0.88" max="1.12" step="0.01">
              <div class="lk-lab" style="margin-top:10px">Build <span class="lk-bv"></span></div><input type="range" class="lk-range lk-build" min="-1" max="1" step="0.05"></div>
            <div class="lk-sec"><div class="lk-lab">Skin</div><div class="lk-sw" data-k="skin"></div></div>
            <div class="lk-sec"><div class="lk-lab">Hair colour</div><div class="lk-sw" data-k="hairColour"></div></div>
            <div class="lk-sec"><div class="lk-lab">Top colour</div><div class="lk-sw" data-k="topColour"></div></div>
            <div class="lk-sec"><div class="lk-lab">Trousers or skirt colour</div><div class="lk-sw" data-k="bottomColour"></div></div>
            <div class="lk-sec"><div class="lk-lab">Shoes colour</div><div class="lk-sw" data-k="shoesColour"></div></div>
          </div>
          <div class="lk-foot"><button class="lk-btn left lk-rand">Randomise</button><button class="lk-btn lk-cancel">Cancel</button><button class="lk-btn main lk-save">Save look</button></div>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.$ = s => el.querySelector(s);
    this.$('.lk-x').onclick = () => this.close();
    this.$('.lk-cancel').onclick = () => this.close();
    this.$('.lk-dim').onclick = () => this.close();
    this.$('.lk-save').onclick = () => this.save();
    this.$('.lk-rand').onclick = () => { const l = People.randomLook(Math.random, { kid: !!this.look.kid, sex: this.look.sex }); l.height = 1; this.set(l); };
    this.$('.lk-prev').onclick = () => this.step(-1);
    this.$('.lk-next').onclick = () => this.step(1);
    for (const b of el.querySelectorAll('.lk-sex button')) b.onclick = () => this.pickKind(b.dataset.v, !!this.look.kid);
    for (const b of el.querySelectorAll('.lk-age button')) b.onclick = () => this.pickKind(this.look.sex, b.dataset.v === 'k');
    this.$('.lk-height').oninput = e => { this.look.height = +e.target.value; this.apply(); };
    this.$('.lk-build').oninput = e => { this.look.build = +e.target.value; this.apply(); };
    const sets = { skin: SKIN, hairColour: HAIR, topColour: TOP, bottomColour: BOTTOM, shoesColour: SHOES };
    for (const box of el.querySelectorAll('.lk-sw')) {
      const k = box.dataset.k;
      box.innerHTML = `<button class="own" data-c="">Own</button>` + sets[k].map(c => `<button data-c="${c}" style="background:${c}" aria-label="${k} ${c}"></button>`).join('');
      for (const b of box.querySelectorAll('button')) b.onclick = () => { this.look[k] = b.dataset.c || null; this.apply(); };
    }
    // the game's keys do nothing while this is open (Escape and P close it)
    addEventListener('keydown', e => {
      if (!this.isOpen) {
        if (e.code === 'KeyP' && !e.repeat && e.target.tagName !== 'INPUT' && this.drive.active) { e.stopImmediatePropagation(); this.open(); }
        return;
      }
      if (e.code === 'Escape' || (e.code === 'KeyP' && e.target.tagName !== 'INPUT')) { this.close(); }
      if (e.target.tagName !== 'INPUT' || e.code !== 'Tab') e.stopImmediatePropagation();
    }, true);
    addEventListener('keyup', e => { if (this.isOpen) e.stopImmediatePropagation(); }, true);
    // a way in from the car chooser
    this.hookCars();
  }

  hookCars() {
    const box = document.querySelector('.hud-cars');
    if (!box) { setTimeout(() => this.hookCars(), 1000); return; }
    if (box.querySelector('.hud-lookbtn')) return;
    const b = document.createElement('button'); b.className = 'hud-lookbtn'; b.textContent = 'Your look (P)';
    b.onclick = () => { b.blur(); box.classList.remove('on'); this.open(); };
    box.appendChild(b);
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  async open() {
    if (this.isOpen) return;
    this.isOpen = true;
    try { this.drive.keys && this.drive.keys.clear(); } catch (e) {}
    this.el.classList.add('on');
    await People.load();
    const saved = loadLook();
    this.saved = saved;
    this.look = People.fixLook(saved || { ...People.DEFAULT_LOOK });
    this.makeStage();
    this.apply(true);
    this.$('.lk-save').focus();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('on');
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.person) { this.person.dispose(); this.person = null; }
  }

  save() {
    const l = { ...this.look };
    try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {}
    const D = this.drive;
    try { if (D.onfoot && D.onfoot.relook) D.onfoot.relook(); } catch (e) { console.warn('relook', e); }
    try { if (D.events) D.events.dispatchEvent({ type: 'look', look: l }); } catch (e) {}
    try { if (D.hud) D.hud.flash('Look saved'); } catch (e) {}
    this.close();
  }

  // the models of the chosen kind, in catalogue order
  list() { return People.catalogue.filter(m => m.sex === this.look.sex && !!m.kid === !!this.look.kid); }
  step(d) {
    const L = this.list(); if (!L.length) return;
    let i = L.findIndex(m => m.id === this.look.base);
    i = (i + d + L.length) % L.length;
    this.look.base = L[i].id;
    this.apply();
  }
  pickKind(sex, kid) {
    if (sex === this.look.sex && kid === !!this.look.kid) return;
    const L = People.catalogue.filter(m => m.sex === sex && !!m.kid === kid);
    if (!L.length) return;
    this.look.sex = sex; this.look.kid = kid; this.look.base = L[0].id;
    this.apply();
  }
  set(l) { this.look = People.fixLook(l); this.apply(); }

  // the controls and the person follow the look
  apply(first) {
    const l = this.look = People.fixLook(this.look);
    const m = People.catalogue.find(c => c.id === l.base) || {};
    const L = this.list(), i = L.findIndex(c => c.id === l.base);
    this.$('.lk-style').textContent = m.label || l.base;
    this.$('.lk-count').textContent = L.length ? `${i + 1} of ${L.length}` : '';
    this.$('.lk-nm').textContent = m.label || 'Your look';
    for (const b of this.el.querySelectorAll('.lk-sex button')) b.classList.toggle('on', b.dataset.v === l.sex);
    for (const b of this.el.querySelectorAll('.lk-age button')) b.classList.toggle('on', (b.dataset.v === 'k') === !!l.kid);
    this.$('.lk-height').value = l.height;
    this.$('.lk-build').value = l.build;
    const h = (m.h || 1.75) * l.height;
    this.$('.lk-hv').textContent = `${Math.round(h * 100)} cm`;
    this.$('.lk-bv').textContent = l.build < -0.5 ? 'Slim' : l.build < -0.15 ? 'Lean' : l.build <= 0.15 ? 'Average' : l.build <= 0.5 ? 'Solid' : 'Heavy';
    for (const box of this.el.querySelectorAll('.lk-sw')) {
      const v = l[box.dataset.k] || '';
      for (const b of box.querySelectorAll('button')) b.classList.toggle('on', (b.dataset.c || '') === v);
      // a colour the model has no region for (no shoes to recolour...) is still offered: it just does nothing
    }
    if (!this.R) return;
    if (!this.person) {
      this.person = People.createPerson(l, { lod: 'near', shadow: false });
      this.scene.add(this.person.object);
      this.person.play('idle', { fade: 0 });
    } else this.person.setLook(l);
    this.frameCam();
    // the preview's shaders built in the background (its own context): no long frame for the game behind
    if (this.R.compileAsync) { const n = this.compiling = (this.compiling || 0) + 1; this.R.compileAsync(this.scene, this.cam).catch(() => {}).finally(() => { if (this.compiling === n) this.compiling = 0; }); }
  }

  makeStage() {
    if (this.R) { this.loop(); return; }
    const cv = this.$('.lk-stage canvas');
    let R;
    try { R = this.R = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { console.warn('look preview', e); return; }
    R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.NeutralToneMapping; R.toneMappingExposure = 1.0;
    R.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    const S = this.scene = new THREE.Scene();
    S.add(new THREE.HemisphereLight(0xf4f7ff, 0x8a8070, 1.25));
    const key = new THREE.DirectionalLight(0xfff3e4, 2.2); key.position.set(1.5, 3, 2.5); S.add(key);
    const rim = new THREE.DirectionalLight(0xdfe9ff, 1.2); rim.position.set(-2, 2.5, -2.5); S.add(rim);
    // a soft round shadow on the floor
    const g = document.createElement('canvas'); g.width = g.height = 64;
    const x = g.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(g), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.002; S.add(sh);
    this.cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    this.yaw = 0.35; this.spin = true;
    let drag = false, px = 0;
    cv.addEventListener('pointerdown', e => { drag = true; px = e.clientX; this.spin = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!drag) return; this.yaw += (e.clientX - px) * 0.012; px = e.clientX; });
    cv.addEventListener('pointerup', () => { drag = false; });
    this.loop();
  }

  frameCam() {
    if (!this.cam || !this.person) return;
    const h = this.person.height || 1.75;
    this.cam.position.set(0, h * 0.6, h * 3.0);
    this.cam.lookAt(0, h * 0.53, 0);
  }

  loop() {
    const R = this.R; if (!R) return;
    let last = performance.now();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const f = () => {
      if (!this.isOpen) return;
      this.raf = requestAnimationFrame(f);
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
      const cv = R.domElement, w = cv.clientWidth, h = cv.clientHeight;
      if (w && h && (cv.width !== Math.round(w * R.getPixelRatio()) || cv.height !== Math.round(h * R.getPixelRatio()))) { R.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }
      if (this.spin && !reduce) this.yaw += dt * 0.35;
      if (this.person) { this.person.object.rotation.y = Math.PI + this.yaw; this.person.update(dt); }
      if (!this.compiling) R.render(this.scene, this.cam);
    };
    f();
  }
}
