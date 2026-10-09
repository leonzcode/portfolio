/* ---------------------------------------------------------------------------
   Leon Kart - controllers.

   A PS5 DualSense, a PS4 pad, an Xbox pad, or anything else the browser maps
   to the standard layout, read through the Gamepad API once a frame. Chrome,
   Edge and Firefox all give a DualSense the standard mapping over USB and over
   Bluetooth, so one table covers every pad worth worrying about:

     0 Cross / A     1 Circle / B    2 Square / X    3 Triangle / Y
     4 L1 / LB       5 R1 / RB       6 L2 / LT       7 R2 / RT   (6 and 7 are analogue)
     8 Create / View 9 Options / Menu 10 L3  11 R3
     12-15 the D-pad, up down left right   16 the PS button   17 the touchpad, when there is one
     axes 0,1 the left stick, 2,3 the right

   Nothing here knows about karts. It says what each pad is holding, what was
   just pressed or let go, and what a driver would make of it, and the game
   decides what that means. Pads come and go by polling rather than by the
   connect events alone: a browser only shows a pad to the page once a button
   on it has been pressed, and the list it returns is the truth either way.
--------------------------------------------------------------------------- */
export const B = {
  CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7,
  CREATE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16, PAD: 17,
};
const NB = 18;

// what kind of pad, for which glyphs to draw: Sony's, Xbox's, or a generic one in Xbox's places
export function kindOf(id) {
  const s = String(id || '').toLowerCase();
  if (/045e|xbox|xinput/.test(s)) return 'xbox';
  if (/054c|dualsense|dualshock|playstation|wireless controller/.test(s)) return 'ps';
  return 'pad';
}
export function padName(id) {
  const s = String(id || '').toLowerCase();
  if (/dualsense|0ce6|0df2/.test(s)) return 'DualSense';
  if (/dualshock|05c4|09cc/.test(s)) return 'DualShock 4';
  if (kindOf(id) === 'xbox') return 'Xbox controller';
  if (kindOf(id) === 'ps') return 'PlayStation controller';
  return 'Controller';
}

export function makePads() {
  const slots = [];                      // by gamepad index
  let onChange = null;                   // (index, connected, slot)
  let rumbleAt = [];                     // the last effect started on each pad, and how hard

  function fresh(i, gp) {
    return {
      i, id: gp.id, kind: kindOf(gp.id), gp,
      val: new Float32Array(NB), on: new Uint8Array(NB), went: new Uint8Array(NB), left: new Uint8Array(NB),
      ax: [0, 0, 0, 0], dir: null, dirGo: null, dirAt: 0, stick: false, used: false, usedAt: 0,
    };
  }
  function read(s, gp, now) {
    s.gp = gp;
    s.used = false;
    const bt = gp.buttons || [];
    for (let b = 0; b < NB; b++) {
      const x = bt[b];
      let v = 0, on = false;
      if (x !== undefined && x !== null) {
        if (typeof x === 'object') { v = +x.value || 0; on = !!x.pressed || v > 0.5; if (on && !v) v = 1; }
        else { v = +x || 0; on = v > 0.5; }
      }
      // a trigger reads as pressed from a feather touch on some pads; a press is half way
      if (b === B.L2 || b === B.R2) on = v > 0.35;
      s.val[b] = v;
      s.went[b] = on && !s.on[b] ? 1 : 0;
      s.left[b] = !on && s.on[b] ? 1 : 0;
      s.on[b] = on ? 1 : 0;
      if (s.went[b]) s.used = true;
    }
    const ax = gp.axes || [];
    for (let a = 0; a < 4; a++) s.ax[a] = +ax[a] || 0;
    if (Math.abs(s.ax[0]) > 0.5 || Math.abs(s.ax[1]) > 0.5 || s.val[B.R2] > 0.3 || s.val[B.L2] > 0.3) s.used = true;
    if (s.used) s.usedAt = now;
    /* A direction for the menus: the D-pad, or the left stick pushed most of
       the way. Held, it repeats, slowly at first. The stick lets go of a
       direction at a third of the way back, so it does not flicker on the edge. */
    const x = s.ax[0], y = s.ax[1];
    let dir = s.on[B.UP] ? 'up' : s.on[B.DOWN] ? 'down' : s.on[B.LEFT] ? 'left' : s.on[B.RIGHT] ? 'right' : null;
    let stick = false;
    if (!dir) {
      const keep = s.stick && s.dir && (
        (s.dir === 'left' && x < -0.35) || (s.dir === 'right' && x > 0.35) ||
        (s.dir === 'up' && y < -0.35) || (s.dir === 'down' && y > 0.35));
      if (keep) dir = s.dir;
      else if (Math.abs(x) > 0.6 || Math.abs(y) > 0.6) dir = Math.abs(x) > Math.abs(y) ? (x < 0 ? 'left' : 'right') : (y < 0 ? 'up' : 'down');
      stick = !!dir;
    }
    s.dirGo = null;
    if (dir && dir !== s.dir) { s.dirGo = dir; s.dirAt = now + 380; }
    else if (dir && now >= s.dirAt) { s.dirGo = dir; s.dirAt = now + 130; }
    s.dir = dir; s.stick = stick;
  }

  function poll(now) {
    let list = [];
    try { list = (navigator.getGamepads && navigator.getGamepads()) || []; } catch (e) { list = []; }
    const seen = [];
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (!gp || gp.connected === false) continue;
      seen[i] = 1;
      let s = slots[i];
      if (s && s.id !== gp.id) { slots[i] = null; if (onChange) onChange(i, false, s); s = null; }
      if (!s) {
        s = slots[i] = fresh(i, gp);
        read(s, gp, now);
        // what was already held when it turned up is not a press
        s.went.fill(0); s.dirGo = null;
        if (onChange) onChange(i, true, s);
        continue;
      }
      read(s, gp, now);
    }
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && !seen[i]) { const s = slots[i]; slots[i] = null; if (onChange) onChange(i, false, s); }
    }
  }

  /* What a driver would make of pad i. The stick has a small dead zone and a
     gentle curve, so the middle of its travel is for placing the car and the
     edge is for full lock; the triggers are read for how far they are in. The
     face buttons drive too, the way the classic kart games lay them out. */
  function drive(i) {
    const s = slots[i];
    const out = { gas: 0, brake: 0, steer: 0, hop: false, item: false, look: false };
    if (!s) return out;
    const DZ = 0.12;
    const x = s.ax[0], m = Math.abs(x);
    // a positive steer is a turn to the left, which is the sign kart.js uses
    if (m > DZ) out.steer = -Math.sign(x) * Math.pow(Math.min(1, (m - DZ) / (1 - DZ)), 1.4);
    if (s.on[B.LEFT]) out.steer = 1;
    if (s.on[B.RIGHT]) out.steer = -1;
    const trig = v => (v < 0.06 ? 0 : Math.min(1, (v - 0.06) / 0.9));
    out.gas = Math.max(trig(s.val[B.R2]), s.on[B.CROSS] ? 1 : 0);
    out.brake = Math.max(trig(s.val[B.L2]), s.on[B.SQUARE] ? 1 : 0);
    out.hop = !!s.on[B.R1];
    out.item = !!(s.on[B.CIRCLE] || s.on[B.L1]);
    out.look = !!(s.on[B.TRIANGLE] || s.on[B.PAD]);
    return out;
  }

  /* Rumble, through the dual-rumble actuator Chrome and Edge give a pad. A
     weaker effect does not cut short a stronger one still running. */
  function rumble(i, strong, weak, ms) {
    const s = slots[i];
    if (!s || !s.gp) return false;
    const now = performance.now();
    const was = rumbleAt[i];
    const hard = Math.max(strong, weak);
    if (was && now < was.until && hard < was.hard) return false;
    rumbleAt[i] = { until: now + ms, hard };
    const va = s.gp.vibrationActuator;
    try {
      if (va && va.playEffect) {
        const p = va.playEffect(va.type || 'dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
        if (p && p.catch) p.catch(() => {});
        return true;
      }
      const h = s.gp.hapticActuators && s.gp.hapticActuators[0];
      if (h && h.pulse) { const p = h.pulse(hard, ms); if (p && p.catch) p.catch(() => {}); return true; }
    } catch (e) {}
    return false;
  }

  return {
    poll,
    get(i) { return slots[i] || null; },
    has(i) { return !!slots[i]; },
    indices() { const out = []; for (let i = 0; i < slots.length; i++) if (slots[i]) out.push(i); return out; },
    get count() { return slots.filter(Boolean).length; },
    drive, rumble,
    set onChange(f) { onChange = f; },
  };
}

/* ---------------------------------------------------------------------------
   The button glyphs, drawn here as small pictures in the game's own sticker
   style: an ink disc with the shape on it, a pill for a shoulder or a trigger.
   They are plain shapes and letters, not anybody's artwork.
--------------------------------------------------------------------------- */
const INK = '#17223b';
const FACE = {
  ps: {
    cross: '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9" stroke="#8fd3ff" stroke-width="2.6" stroke-linecap="round"/>',
    circle: '<circle cx="12" cy="12" r="4.8" fill="none" stroke="#ff7a6b" stroke-width="2.4"/>',
    square: '<rect x="7.4" y="7.4" width="9.2" height="9.2" rx="0.8" fill="none" stroke="#ff9ad5" stroke-width="2.3"/>',
    triangle: '<path d="M12 6.6l5.4 9.4H6.6z" fill="none" stroke="#7fe08f" stroke-width="2.3" stroke-linejoin="round"/>',
  },
  xbox: { cross: ['A', '#7fe08f'], circle: ['B', '#ff7a6b'], square: ['X', '#8fd3ff'], triangle: ['Y', '#ffd233'] },
};
const PILL = {
  ps: { l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2', options: 'OPTIONS', create: 'CREATE', pad: 'TOUCH PAD', l3: 'L3', r3: 'R3' },
  xbox: { l1: 'LB', r1: 'RB', l2: 'LT', r2: 'RT', options: 'MENU', create: 'VIEW', pad: 'VIEW', l3: 'LS', r3: 'RS' },
};
export function glyph(name, kind) {
  const k = kind === 'ps' ? 'ps' : 'xbox';
  const lbl = { cross: 'Cross', circle: 'Circle', square: 'Square', triangle: 'Triangle' };
  if (FACE.ps[name]) {
    const body = k === 'ps' ? FACE.ps[name]
      : '<text x="12" y="16.4" text-anchor="middle" font-size="12" font-weight="800" font-family="Baloo 2,system-ui,sans-serif" fill="'
        + FACE.xbox[name][1] + '">' + FACE.xbox[name][0] + '</text>';
    const title = k === 'ps' ? lbl[name] : FACE.xbox[name][0];
    return '<span class="pg" role="img" aria-label="' + title + '"><svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<circle cx="12" cy="12" r="11" fill="' + INK + '"/>' + body + '</svg></span>';
  }
  if (name === 'stick' || name === 'dpad') {
    const inner = name === 'stick'
      ? '<circle cx="12" cy="12" r="10" fill="' + INK + '"/><circle cx="12" cy="12" r="5.6" fill="#fff6e2"/><circle cx="12" cy="12" r="2.4" fill="' + INK + '"/>'
      : '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="' + INK + '"/><path d="M12 5.4l1.8 2.4h-3.6zM12 18.6l1.8-2.4h-3.6zM5.4 12l2.4-1.8v3.6zM18.6 12l-2.4-1.8v3.6z" fill="#fff6e2"/>';
    return '<span class="pg" role="img" aria-label="' + (name === 'stick' ? 'Left stick' : 'D-pad') + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg></span>';
  }
  const t = (PILL[k] && PILL[k][name]) || name.toUpperCase();
  return '<span class="pg pill" role="img" aria-label="' + t + '">' + t + '</span>';
}
/* What each thing a driver does is on, for a hint line. The first one listed
   is the one a hint shows when it only has room for one. */
export const PAD_ACTS = {
  gas: ['r2', 'cross'], brake: ['l2', 'square'], steer: ['stick'], hop: ['r1'], item: ['circle', 'l1'],
  look: ['triangle'], view: ['create'], pause: ['options'], ok: ['cross'], back: ['circle'],
};
export function prompt(act, kind, all) {
  const list = PAD_ACTS[act] || [act];
  return (all ? list : list.slice(0, 1)).map(n => glyph(n, kind)).join('<span class="pgor">/</span>');
}
