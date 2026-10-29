// What sits over the drive: the speedometer and gear, the view's name when it changes, the keys, a loading card.
export class Hud {
  constructor(root, drive) {
    this.drive = drive;
    const el = this.el = document.createElement('div');
    el.className = 'hud';
    el.innerHTML = `
      <div class="hud-speed"><b class="hud-v">0</b><span class="hud-u">km/h</span><span class="hud-g">D1</span></div>
      <div class="hud-sig"><span class="hud-l">&#9664;</span><span class="hud-r">&#9654;</span></div>
      <div class="hud-toast"></div>
      <div class="hud-note"><span></span><button aria-label="Close">&times;</button></div>
      <button class="hud-carbtn" aria-label="Choose a car"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M18.9 6c-.2-.6-.8-1-1.4-1h-11c-.7 0-1.2.4-1.4 1L3 12v8c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h12v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-8l-2.1-6zM6.5 16c-.8 0-1.5-.7-1.5-1.5S5.7 13 6.5 13s1.5.7 1.5 1.5S7.3 16 6.5 16zm11 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg><span>Car</span></button>
      <div class="hud-cars"><div class="hud-cars-h">Choose a car <button class="hud-cx" aria-label="Close">&times;</button></div><div class="hud-cars-l"></div><div class="hud-cars-p"></div></div>
      <div class="hud-keys">
        <div class="hud-keys-h">Controls <button class="hud-x" aria-label="Close">&times;</button></div>
        <dl>
          <dt>W / &uarr;</dt><dd>Accelerate</dd><dt>S / &darr;</dt><dd>Brake, hold to reverse</dd>
          <dt>A D / &larr; &rarr;</dt><dd>Steer</dd><dt>Space</dt><dd>Handbrake; in the Roadster, hold to fly up</dd><dt>Shift</dt><dd>Roadster: fly down; on the ground with W, the rear jet</dd><dt>F</dt><dd>Thruster boost (Roadster)</dd>
          <dt>C</dt><dd>Change view</dd><dt>B</dt><dd>Look back</dd><dt>Drag</dt><dd>Look around</dd>
          <dt>E</dt><dd>Get out, or get in a car</dd><dt>P</dt><dd>Your look</dd>
          <dt>, / .</dt><dd>Left / right signal</dd><dt>X</dt><dd>Hazard lights</dd><dt>L</dt><dd>Headlights</dd>
          <dt>1 to 0, -</dt><dd>Change car</dd><dt>[ and ]</dt><dd>The plane and the helicopter</dd><dt>R</dt><dd>Back on the road</dd><dt>M</dt><dd>Sound on or off</dd><dt>H</dt><dd>Show or hide this</dd>
        </dl>
      </div>
      <div class="hud-load"><div class="hud-load-card"><div class="hud-spin"></div><div class="hud-load-t">Loading</div><div class="hud-bar"><i></i></div></div></div>
      <div class="hud-bump"></div>
      <div class="hud-touch">
        <div class="ht-l"><button data-k="KeyA" aria-label="Steer left">&#9664;</button><button data-k="KeyD" aria-label="Steer right">&#9654;</button></div>
        <div class="ht-r"><button data-k="KeyC" class="ht-small" aria-label="Change view">&#128247;</button><button data-k="KeyS" class="ht-brake" aria-label="Brake">Brake</button><button data-k="KeyW" class="ht-gas" aria-label="Accelerate">Gas</button></div>
      </div>`;
    root.appendChild(el);
    this.$ = s => el.querySelector(s);
    // the notice, the loading card and the toast live outside the HUD (which stays hidden until a drive starts),
    // so they show while a place loads and over the map too
    this.noteEl = this.$('.hud-note'); root.appendChild(this.noteEl);
    this.loadEl = this.$('.hud-load'); root.appendChild(this.loadEl);
    this.toastEl = this.$('.hud-toast'); root.appendChild(this.toastEl);
    this.$('.hud-x').onclick = () => this.toggleHelp(false);
    this.$('.hud-carbtn').onclick = e => { e.currentTarget.blur(); const b = this.$('.hud-cars'); if (b.classList.contains('on')) b.classList.remove('on'); else this.openCars(); };
    this.$('.hud-cx').onclick = () => this.$('.hud-cars').classList.remove('on');
    // touch screens: buttons that hold the same keys the keyboard does
    if (matchMedia('(pointer: coarse)').matches || /[?&]touch/.test(location.search)) {
      el.classList.add('touch');
      document.documentElement.style.setProperty('--mu-mini-bottom', '118px'); // the minimap over the steering buttons
      for (const b of el.querySelectorAll('.hud-touch button')) {
        const k = b.dataset.k;
        const on = e => { e.preventDefault(); if (k === 'KeyC') { dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' })); return; } drive.keys.add(k); b.classList.add('on'); };
        const off = e => { e.preventDefault(); drive.keys.delete(k); b.classList.remove('on'); };
        b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
      }
    }
    this.t = 0;
    try { if (localStorage.getItem('car_help') === '0') this.toggleHelp(false); } catch (e) {}
    this.show(false);
  }
  show(on) { this.el.classList.toggle('on', on); }
  toggleHelp(on) {
    const k = this.$('.hud-keys'), v = on === undefined ? k.classList.contains('off') : on;
    k.classList.toggle('off', !v);
    try { localStorage.setItem('car_help', v ? '1' : '0'); } catch (e) {}
  }
  flash(text) {
    if (!text) return;
    const t = this.toastEl; t.textContent = text; t.classList.add('on');
    clearTimeout(this._ft); this._ft = setTimeout(() => t.classList.remove('on'), 1400);
  }
  // the car chooser: every drivable car, then the paints of the one being driven
  openCars() {
    const C = this.drive.mods.cars, box = this.$('.hud-cars');
    if (!C) return;
    const list = C.CARS.filter(c => !c.npcOnly), cur = this.drive.carId;
    const KIND = { sedan: 'Sedan', sports: 'Sports car', pickup: 'Pickup', hatchback: 'Hatchback', van: 'Van', suv: 'SUV', supercar: 'Supercar', electric: 'Electric sports car', bus: 'School bus', truck: 'Semi truck', plane: 'Light plane', heli: 'Helicopter' };
    // (the cars take 1 to 0, - and = in order; an aircraft its own key, aircraft.js)
    const cars = list.filter(c => !c.air), keyOf = c => c.air ? c.key : (cars.indexOf(c) < 12 ? '1234567890-='[cars.indexOf(c)] : '');
    this.$('.hud-cars-l').innerHTML = list.map(c => `<button data-id="${c.id}" class="${c.id === cur ? 'on' : ''}"><b>${c.name}</b><small>${KIND[c.kind] || c.kind || ''}${keyOf(c) ? ` &middot; key ${keyOf(c)}` : ''}</small></button>`).join('');
    const spec = list.find(c => c.id === cur);
    const paints = spec && spec.paints ? spec.paints : [];
    this.$('.hud-cars-p').innerHTML = paints.map(p => `<button data-paint="${p}" style="background:#${p.toString(16).padStart(6, '0')}" aria-label="Paint"></button>`).join('');
    // (buttons give the focus back, or Space, the handbrake, would press them again)
    for (const b of box.querySelectorAll('[data-id]')) b.onclick = async () => { b.blur(); await this.drive.setCar(b.dataset.id); this.openCars(); };
    for (const b of box.querySelectorAll('[data-paint]')) b.onclick = () => { b.blur(); const r = this.drive.car && this.drive.car.rig; if (r && r.setPaint) r.setPaint(+b.dataset.paint); };
    box.classList.add('on');
  }

  // a longer notice at the top that can be closed
  note(text, ms = 9000) {
    const n = this.noteEl;
    n.querySelector('span').textContent = text; n.classList.add('on');
    n.querySelector('button').onclick = () => n.classList.remove('on');
    clearTimeout(this._nt); this._nt = setTimeout(() => n.classList.remove('on'), ms);
  }
  bump(speed) {
    const b = this.$('.hud-bump'); b.style.opacity = Math.min(0.5, speed / 40);
    clearTimeout(this._bt); this._bt = setTimeout(() => { b.style.opacity = 0; }, 120);
  }
  loading(text, f) {
    const l = this.loadEl;
    if (text === null) { l.classList.remove('on'); return; }
    l.classList.add('on');
    l.querySelector('.hud-load-t').textContent = text;
    if (f !== undefined) l.querySelector('.hud-bar i').style.width = Math.round(f * 100) + '%';
  }
  update(dt, v, drive) {
    this.t += dt;
    const mph = drive.mph, s = Math.abs(v.fwdSpeed) * (mph ? 2.23694 : 3.6);
    // (written only when it changes: every write made the page work its style out again, each frame; perf)
    const E = this._els || (this._els = { v: this.$('.hud-v'), u: this.$('.hud-u'), g: this.$('.hud-g'), l: this.$('.hud-l'), r: this.$('.hud-r'), last: {} }), was = E.last;
    const set = (k, val) => { if (was[k] !== val) { was[k] = val; E[k].textContent = val; } };
    set('v', String(Math.round(s)));
    set('u', mph ? 'mph' : 'km/h');
    // (an aircraft has no gearbox: aircraft.js shows its own gauges)
    set('g', v.air ? (v.airS && v.airS.airborne ? 'AIR' : 'GND') : v.reverse ? 'R' : (Math.abs(v.fwdSpeed) < 0.3 && v.throttle < 0.05 ? 'N' : 'D' + v.gear));
    const on = Math.floor(this.t * 3) % 2 === 0, sg = drive.signal;
    const l = on && (sg === -1 || sg === 2), r = on && (sg === 1 || sg === 2);
    if (was.l !== l) { was.l = l; E.l.classList.toggle('on', l); }
    if (was.r !== r) { was.r = r; E.r.classList.toggle('on', r); }
  }
}
