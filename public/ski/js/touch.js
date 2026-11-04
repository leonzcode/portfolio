// Touch controls (shown on touch screens): a thumb stick on the left half (steer, push up to tuck, pull down to
// brake; in the air it spins and flips), and buttons on the right: Pop (hold to crouch, let go to pop), Grab (hold
// for the grab shown on the picker above it, tap the picker to change grab), Butter (hold, the stick presses the nose
// or tail), and the camera.
import { GRABS } from './grabs.js?v=8';

const ORDER = ['safety', 'mute', 'japan', 'tail', 'nose', 'truck', 'critical', 'octo', 'blunt', 'stalefish', 'bowarrow', 'dubtail', 'seatbelt', 'daffy', 'spread', 'backscratch', 'ironcross'];

export class Touch {
  constructor(input, onCamera) {
    this.on = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.state = { jx: 0, jy: 0, pop: false, grab: false, butter: false, sel: 0 };
    input.touch = this.state;
    if (!this.on) return;
    document.getElementById('grabhint').style.display = 'none';      // the key list means nothing here
    const el = this.el = document.createElement('div'); el.id = 'touch';
    el.innerHTML = `<div class="stick"><i></i></div>
      <div class="tbtns">
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
    hold('pop', 'pop'); hold('grab', 'grab'); hold('butter', 'butter');
    const pick = el.querySelector('.pick');
    pick.addEventListener('touchstart', e => { st.sel = (st.sel + 1) % ORDER.length; pick.textContent = GRABS[ORDER[st.sel]].name; e.preventDefault(); }, { passive: false });
    el.querySelector('.cam').addEventListener('touchstart', e => { onCamera(); e.preventDefault(); }, { passive: false });
  }
  get grabId() { return ORDER[this.state.sel]; }
}
export const TOUCH_GRABS = ORDER;
