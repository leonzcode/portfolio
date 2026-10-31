// The game's settings panel (round 6): one panel for everything a player can set, opened from the gear button on
// the drive's screen and from the map's menu. Other modules add their own section:
//   import { settings } from './settings.js?v=51';
//   settings.addSection('Weather and time', el => { ...build into el...; return () => { ...refresh when opened... }; }, { order: 20 });
// buildFn(el, settings) builds the section's controls into el once (the first time the panel opens, or at once if it
// is already open) and may return a function that is called every time the panel opens, to show the current state.
// Sections are shown by `order` (lower first; Graphics is 10), then in the order they were added.
// Also: settings.open(), settings.close(), settings.toggle(), settings.isOpen, settings.el (the panel).
// Keys typed into the panel never reach the game (they stop at the panel), and Escape closes it.

const CSS = `
.st-btn { position: absolute; top: 16px; right: 108px; width: 40px; height: 40px; border-radius: 50%; border: 0; background: #fff; color: #3c4043; display: flex; align-items: center; justify-content: center; cursor: pointer; pointer-events: auto; box-shadow: 0 1px 3px rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15); padding: 0; }
.st-btn:hover { background: #f1f3f4; }
.st-btn:focus-visible, .st-panel button:focus-visible, .st-panel input:focus-visible, .st-panel select:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
.st-btn svg { width: 22px; height: 22px; fill: currentColor; }
.hud.touch .st-btn { top: 16px; right: 12px; }
.st-scrim { position: fixed; inset: 0; z-index: 48; background: rgba(0,0,0,.32); opacity: 0; transition: opacity .18s; }
.st-scrim.on { opacity: 1; }
.st-panel { position: fixed; z-index: 49; top: 0; right: 0; bottom: 0; width: 380px; max-width: 100vw; box-sizing: border-box; background: #fff; color: #202124; font: 400 14px/20px Roboto, system-ui, sans-serif; box-shadow: 0 0 16px rgba(0,0,0,.28); display: flex; flex-direction: column; transform: translateX(16px); opacity: 0; transition: transform .18s ease-out, opacity .18s; pointer-events: auto; color-scheme: light; }
.st-panel.on { transform: none; opacity: 1; }
.st-panel[hidden], .st-scrim[hidden] { display: none; }
.st-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 12px 10px 24px; border-bottom: 1px solid #e8eaed; }
.st-head h2 { margin: 0; font: 400 22px/28px 'Google Sans', Roboto, system-ui, sans-serif; color: #202124; }
.st-x { width: 40px; height: 40px; border: 0; border-radius: 50%; background: none; color: #5f6368; cursor: pointer; font-size: 24px; line-height: 1; }
.st-x:hover { background: #f1f3f4; }
.st-body { overflow-y: auto; flex: 1; padding: 4px 0 24px; overscroll-behavior: contain; }
.st-sec { padding: 16px 24px 18px; border-bottom: 1px solid #e8eaed; }
.st-sec:last-child { border-bottom: 0; }
.st-sec > h3 { margin: 0 0 10px; font: 500 14px/20px 'Google Sans', Roboto, system-ui, sans-serif; color: #202124; letter-spacing: .1px; }
.st-seg { display: flex; border: 1px solid #dadce0; border-radius: 20px; overflow: hidden; }
.st-seg button { flex: 1; border: 0; border-left: 1px solid #dadce0; background: #fff; color: #3c4043; font: 500 14px/20px 'Google Sans', Roboto, system-ui, sans-serif; padding: 8px 4px; cursor: pointer; }
.st-seg button:first-child { border-left: 0; }
.st-seg button:hover { background: #f8f9fa; }
.st-seg button.on { background: #e8f0fe; color: #1967d2; }
.st-p { margin: 10px 0 0; color: #5f6368; font-size: 13px; line-height: 18px; }
.st-p b { color: #202124; font-weight: 500; }
.st-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; cursor: pointer; }
.st-row span { color: #3c4043; }
.st-sw { position: relative; width: 36px; height: 14px; border-radius: 7px; background: #bdc1c6; flex: none; border: 0; padding: 0; cursor: pointer; }
.st-sw::after { content: ''; position: absolute; top: -3px; left: -2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.4); transition: left .15s; }
.st-sw.on { background: #8ab4f8; }
.st-sw.on::after { left: 18px; background: #1a73e8; }
.st-fps { position: fixed; z-index: 47; left: 50%; top: 4px; transform: translateX(-50%); padding: 2px 8px; border-radius: 10px; background: rgba(32,33,36,.72); color: #fff; font: 500 12px/16px 'Roboto Mono', ui-monospace, monospace; pointer-events: none; white-space: nowrap; display: none; }
.st-fps.on { display: block; }
@media (max-width: 600px) {
  .st-panel { top: auto; left: 0; width: 100%; max-height: 82vh; border-radius: 16px 16px 0 0; transform: translateY(24px); }
  .st-head { padding-left: 20px; }
  .st-sec { padding: 14px 20px 16px; }
}
@media (prefers-reduced-motion: reduce) { .st-panel, .st-scrim, .st-sw::after { transition: none; } }
`;
const GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.47.47 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';

class Settings {
  constructor() {
    this.sections = []; this.isOpen = false; this.el = null; this._seq = 0;
  }
  _dom() {
    if (this.el) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const scrim = this.scrim = document.createElement('div'); scrim.className = 'st-scrim'; scrim.hidden = true;
    const el = this.el = document.createElement('div');
    el.className = 'st-panel'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Settings');
    el.innerHTML = '<div class="st-head"><h2>Settings</h2><button class="st-x" type="button" aria-label="Close settings">&times;</button></div><div class="st-body"></div>';
    this.body = el.querySelector('.st-body');
    el.querySelector('.st-x').onclick = () => this.close();
    scrim.onclick = () => this.close();
    // keys typed here are the panel's: never the game's (Space is the handbrake, letters change the view...)
    for (const t of ['keydown', 'keyup', 'keypress']) el.addEventListener(t, e => {
      e.stopPropagation();
      if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    // the game's own key handlers sit on window: a key pressed while the panel is open and nothing in it has the
    // focus still closes it with Escape
    addEventListener('keydown', e => { if (this.isOpen && e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); this.close(); } }, true);
    document.body.appendChild(scrim); document.body.appendChild(el);
  }
  // title: the section's heading; build(el, settings): its controls (see the top of this file)
  addSection(title, build, opts = {}) {
    const s = { title, build, order: opts.order ?? 50, seq: this._seq++, el: null, refresh: null, id: opts.id || null };
    if (s.id) { const old = this.sections.findIndex(x => x.id === s.id); if (old >= 0) { const o = this.sections[old]; if (o.el) o.el.remove(); this.sections.splice(old, 1); } }
    this.sections.push(s);
    this.sections.sort((a, b) => a.order - b.order || a.seq - b.seq);
    if (this.isOpen) this._render();
    return s;
  }
  _render() {
    this._dom();
    for (const s of this.sections) {
      if (!s.el) {
        s.el = document.createElement('section'); s.el.className = 'st-sec';
        const h = document.createElement('h3'); h.textContent = s.title; s.el.appendChild(h);
        try { const r = s.build(s.el, this); if (typeof r === 'function') s.refresh = r; } catch (e) { console.warn('settings section', s.title, e); }
      }
      this.body.appendChild(s.el); // (in order: appending moves it)
      if (s.refresh) { try { s.refresh(); } catch (e) { console.warn('settings refresh', s.title, e); } }
    }
  }
  open() {
    this._dom();
    if (this.isOpen) return;
    this.isOpen = true;
    this._render();
    this.el.hidden = false; this.scrim.hidden = false;
    requestAnimationFrame(() => { this.el.classList.add('on'); this.scrim.classList.add('on'); });
    // (the keys the game holds are let go: a key held as the panel opened would stay pressed)
    try { const G = window.__car; if (G && G.drive && G.drive.keys) G.drive.keys.clear(); if (G && G.keys) G.keys.clear(); } catch (e) {}
    const x = this.el.querySelector('.st-x'); if (x) x.focus({ preventScroll: true });
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.remove('on'); this.scrim.classList.remove('on');
    setTimeout(() => { if (!this.isOpen) { this.el.hidden = true; this.scrim.hidden = true; } }, 200);
    if (document.activeElement && this.el.contains(document.activeElement)) document.activeElement.blur();
  }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  // the gear button on the drive's screen (inside the HUD, so it shows and hides with it)
  attachHud(hudEl) {
    if (!hudEl || hudEl.querySelector('.st-btn')) return;
    this._dom();
    const b = document.createElement('button');
    b.className = 'st-btn'; b.type = 'button'; b.setAttribute('aria-label', 'Settings'); b.title = 'Settings';
    b.innerHTML = GEAR;
    b.onclick = e => { e.currentTarget.blur(); this.toggle(); };
    hudEl.appendChild(b);
  }
  // an entry in the map's menu (mapui.js's drawer), above the Google key
  attachMapMenu(drawer) {
    if (!drawer || drawer.querySelector('[data-k="settings"]')) return;
    this._dom();
    const b = document.createElement('button');
    b.className = 'mu-dr-item'; b.type = 'button'; b.dataset.k = 'settings';
    b.innerHTML = GEAR + '<span>Settings</span>';
    b.addEventListener('click', () => {
      // close the drawer the way its own scrim does, then open the panel over the map
      const sc = drawer.parentElement && drawer.parentElement.querySelector('.mu-drawer-scrim');
      if (sc) sc.click();
      this.open();
    });
    const g = drawer.querySelector('[data-k="gkey"]');
    const sep = g && g.previousElementSibling && g.previousElementSibling.classList.contains('mu-dr-sep') ? g.previousElementSibling : null;
    if (sep) drawer.insertBefore(b, sep); else drawer.appendChild(b);
  }

  // small helpers for sections: a row of choices, a switch, a line of text
  segmented(el, choices, current, onPick, label) {
    const box = document.createElement('div'); box.className = 'st-seg'; box.setAttribute('role', 'radiogroup');
    if (label) box.setAttribute('aria-label', label);
    const bs = choices.map(([value, text]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.dataset.v = value;
      b.setAttribute('role', 'radio');
      b.onclick = () => { onPick(value); set(value); };
      box.appendChild(b); return b;
    });
    const set = v => { for (const b of bs) { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } };
    set(current);
    el.appendChild(box);
    return { el: box, set };
  }
  toggleRow(el, text, on, onChange) {
    const row = document.createElement('label'); row.className = 'st-row';
    const t = document.createElement('span'); t.textContent = text;
    const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'st-sw'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-label', text);
    const set = v => { sw.classList.toggle('on', !!v); sw.setAttribute('aria-checked', String(!!v)); };
    set(on);
    sw.onclick = e => { e.preventDefault(); const v = !sw.classList.contains('on'); set(v); onChange(v); };
    row.onclick = e => { if (e.target !== sw) { e.preventDefault(); sw.click(); } };
    row.appendChild(t); row.appendChild(sw); el.appendChild(row);
    return { el: row, set };
  }
  text(el, html) { const p = document.createElement('p'); p.className = 'st-p'; p.innerHTML = html; el.appendChild(p); return p; }
}

export const settings = new Settings();
if (typeof window !== 'undefined') window.__carSettings = settings;
