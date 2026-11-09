// Touch controls (shown on touch screens): a thumb stick on the left half (steer, push up to tuck, pull down to
// brake; in the air it spins and flips), and buttons on the right: Pop (hold to crouch, let go to pop), Grab (hold
// for the grab shown on the picker above it, tap the picker to change grab), Butter (hold, the stick presses the nose
// or tail), and the camera; on the snow and rails two small ones: One ski (or one foot) and Together.
import { GRABS } from './grabs.js?v=20';
import { rideGrabDef } from './board.js?v=20';      // (B: a board's own grab names on the picker)
import { RIDE_KEYS } from './input.js?v=20';

// (P, 2026-11-08: the picker's list is the ride's own: its trick keys' tricks first (input.js RIDE_KEYS, Leon's scheme),
// then the ski grabs that give it something else. ORDER is changed in place, so main.js's grabId reads the current one.)
const SKI_ORDER = ['safety', 'mute', 'japan', 'tail', 'nose', 'truck', 'critical', 'octo', 'blunt', 'stalefish', 'bowarrow', 'dubtail', 'seatbelt', 'spreadpoles', 'seaman', 'daffy', 'spread', 'backscratch', 'ironcross'];
const ORDER = SKI_ORDER.filter(id => GRABS[id]);
function orderFor(kind) {
  if (!kind || kind === 'ski') return SKI_ORDER.filter(id => GRABS[id]);
  const own = Object.values((RIDE_KEYS[kind] || {}).shred || {}).filter(Boolean), out = [], names = new Set();
  for (const id of [...own, ...SKI_ORDER]) {
    const d = rideGrabDef(kind, id), nm = d ? d.name : null;
    if (!nm || names.has(nm) || out.includes(id)) continue;
    names.add(nm); out.push(id);
  }
  return out.length ? out : SKI_ORDER.filter(id => GRABS[id]);
}

export class Touch {
  constructor(input, onCamera) {
    this.on = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.state = { jx: 0, jy: 0, pop: false, grab: false, butter: false, one: false, tog: false, sel: 0 };
    input.touch = this.state;
    if (!this.on) return;
    document.getElementById('grabhint').style.display = 'none';      // the key list means nothing here
    const el = this.el = document.createElement('div'); el.id = 'touch';
    el.innerHTML = `<div class="stick"><i></i></div>
      <div class="tbtns">
        <button class="one snowonly">One ski</button>
        <button class="tog snowonly">Together</button>
        <button class="pick">Safety</button>
        <button class="grab">Grab</button>
        <button class="butter">Butter</button>
        <button class="pop">Pop</button>
        <button class="cam">Cam</button>
      </div>`;
    document.getElementById('hud').appendChild(el);
    const st = this.state, stick = el.querySelector('.stick'), knob = stick.querySelector('i');
    let sid = null, sx = 0, sy = 0;
    const R = 60;
    stick.addEventListener('touchstart', e => { const t = e.changedTouches[0]; sid = t.identifier; sx = t.clientX; sy = t.clientY; stick.classList.add('on'); stick.style.left = (sx - 70) + 'px'; stick.style.top = (sy - 70) + 'px'; e.preventDefault(); }, { passive: false });
    stick.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) if (t.identifier === sid) {
        let dx = t.clientX - sx, dy = t.clientY - sy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
        st.jx = dx / R; st.jy = dy / R; knob.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      e.preventDefault();
    }, { passive: false });
    const end = e => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; st.jx = 0; st.jy = 0; knob.style.transform = ''; stick.classList.remove('on'); } };
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    const hold = (cls, key) => {
      const b = el.querySelector('.' + cls);
      b.addEventListener('touchstart', e => { st[key] = true; b.classList.add('down'); e.preventDefault(); }, { passive: false });
      const up = e => { st[key] = false; b.classList.remove('down'); e.preventDefault(); };
      b.addEventListener('touchend', up, { passive: false }); b.addEventListener('touchcancel', up, { passive: false });
    };
    hold('pop', 'pop'); hold('grab', 'grab'); hold('butter', 'butter'); hold('one', 'one'); hold('tog', 'tog');
    // (P, 2026-11-08: shown on the snow and rails, hidden in the air, kept in their place so nothing else moves; input.js
    // calls it every frame, and the page is only touched when it changes)
    const snowOnly = el.querySelectorAll('.snowonly');
    let shown = true;
    st.onMode = ground => { if (ground === shown) return; shown = ground; for (const b of snowOnly) b.classList.toggle('off', !ground); if (!ground) { st.one = st.tog = false; for (const b of snowOnly) b.classList.remove('down'); } };
    const pick = el.querySelector('.pick');
    pick.addEventListener('touchstart', e => { st.sel = (st.sel + 1) % ORDER.length; pick.textContent = this.nameOf(ORDER[st.sel]); e.preventDefault(); }, { passive: false });
    this.pick = pick;
    el.querySelector('.cam').addEventListener('touchstart', e => { onCamera(); e.preventDefault(); }, { passive: false });
  }
  get grabId() { return ORDER[this.state.sel]; }
  // (B: what you ride: the picker names its grabs)
  nameOf(id) { const d = this.kind && this.kind !== 'ski' ? rideGrabDef(this.kind, id) : null; return d ? d.name : GRABS[id] ? GRABS[id].name : id; }
  setRide(kind) {
    this.kind = kind;
    const o = orderFor(kind); ORDER.length = 0; ORDER.push(...o); this.state.sel = 0;     // (P: the ride's own list)
    if (this.pick) this.pick.textContent = this.nameOf(ORDER[this.state.sel]);
    // (X: a scooter's, snowbike's or sled's grab button does its tricks: a tailwhip, a superman...)
    const gb = this.el && this.el.querySelector('.grab'); if (gb) gb.textContent = kind === 'scoot' || kind === 'bike' || kind === 'sled' ? 'Trick' : 'Grab';
    const ob = this.el && this.el.querySelector('.one'); if (ob) ob.textContent = !kind || kind === 'ski' ? 'One ski' : 'One foot';   // (P)
  }
}
export const TOUCH_GRABS = ORDER;
