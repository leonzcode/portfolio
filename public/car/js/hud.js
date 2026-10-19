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
      <div class="hud-keys">
        <div class="hud-keys-h">Controls <button class="hud-x" aria-label="Close">&times;</button></div>
        <dl>
          <dt>W / &uarr;</dt><dd>Accelerate</dd><dt>S / &darr;</dt><dd>Brake, hold to reverse</dd>
          <dt>A D / &larr; &rarr;</dt><dd>Steer</dd><dt>Space</dt><dd>Handbrake</dd>
          <dt>C</dt><dd>Change view</dd><dt>B</dt><dd>Look back</dd><dt>Drag</dt><dd>Look around</dd>
          <dt>Q / E</dt><dd>Left / right signal</dd><dt>X</dt><dd>Hazard lights</dd><dt>L</dt><dd>Headlights</dd>
          <dt>1 to 8</dt><dd>Change car</dd><dt>R</dt><dd>Back on the road</dd><dt>M</dt><dd>Sound on or off</dd><dt>H</dt><dd>Show or hide this</dd>
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
    this.$('.hud-x').onclick = () => this.toggleHelp(false);
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
    const t = this.$('.hud-toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(this._ft); this._ft = setTimeout(() => t.classList.remove('on'), 1400);
  }
  // a longer notice at the top that can be closed
  note(text, ms = 9000) {
    const n = this.$('.hud-note');
    n.querySelector('span').textContent = text; n.classList.add('on');
    n.querySelector('button').onclick = () => n.classList.remove('on');
    clearTimeout(this._nt); this._nt = setTimeout(() => n.classList.remove('on'), ms);
  }
  bump(speed) {
    const b = this.$('.hud-bump'); b.style.opacity = Math.min(0.5, speed / 40);
    clearTimeout(this._bt); this._bt = setTimeout(() => { b.style.opacity = 0; }, 120);
  }
  loading(text, f) {
    const l = this.$('.hud-load');
    if (text === null) { l.classList.remove('on'); return; }
    l.classList.add('on');
    this.$('.hud-load-t').textContent = text;
    if (f !== undefined) this.$('.hud-bar i').style.width = Math.round(f * 100) + '%';
  }
  update(dt, v, drive) {
    this.t += dt;
    const mph = drive.mph, s = Math.abs(v.fwdSpeed) * (mph ? 2.23694 : 3.6);
    this.$('.hud-v').textContent = Math.round(s);
    this.$('.hud-u').textContent = mph ? 'mph' : 'km/h';
    this.$('.hud-g').textContent = v.reverse ? 'R' : (Math.abs(v.fwdSpeed) < 0.3 && v.throttle < 0.05 ? 'N' : 'D' + v.gear);
    const on = Math.floor(this.t * 3) % 2 === 0, sg = drive.signal;
    this.$('.hud-l').classList.toggle('on', on && (sg === -1 || sg === 2));
    this.$('.hud-r').classList.toggle('on', on && (sg === 1 || sg === 2));
  }
}
