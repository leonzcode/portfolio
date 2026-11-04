// Three control schemes, read into the same intents for the skier:
//   mouse: the mouse points where you want to go (the skier carves towards it), hold the left button to crouch and
//          let go to pop, right button brakes; in the air the mouse spins and flips; grabs on the number row and
//          letters near WASD
//   keys:  A/D turn, W tucks (and skates on the flat), S brakes, Space crouch and pop; in the air A/D spin, W/S flip,
//          Q/E tilt the axis, Shift + A/D shifty; grabs on the right hand (J K L I U O P H N M Y B ;)
//   shred: the layout of Shredsauce's keyboard controls (shredsauce.com/controls): arrows turn and spin, Up crouches
//          for less drag and front flips, Down brakes and back flips, G/H Lincoln loops, Space crouch and pop, N butters
//          and presses, grabs on C (mute) B (tail) V (japan) X (safety) Z (nose) F (blunt) S (Left Safety) and the number
//          row, each tweaked or varied by E or R held with it, A and D left and right shifties in the air, Tab sets a marker, Enter goes back to the last crash (or the marker, if set since; twice, to the start), P looks over
//          the other shoulder riding switch, a quick second press of a spin key spins faster, N pressed twice just
//          after a landing reverts. Shift skates forward on the snow (in the air: a shifty, Left Shift to the left,
//          Right Shift or Alt to the right). Q changes the camera here (C is a grab).
// A press is only used within 0.3 s of being made, so an old one never fires later.
// All: C changes the camera (Q in the shred scheme), Backspace goes back to the top, Esc pauses; R starts again a
// little earlier (mouse and keys; in the shred scheme R is a tweak key and Enter does it).
import { POSITIONS } from './grabs.js?v=14';
export { POSITIONS };

const GRAB_KEYS = {
  keys: { KeyJ: 'safety', KeyK: 'mute', KeyL: 'japan', KeyI: 'tail', KeyU: 'nose', KeyO: 'truck', KeyP: 'critical', KeyH: 'octo', KeyN: 'blunt', KeyM: 'stalefish', KeyY: 'bowarrow', KeyB: 'dubtail', Semicolon: 'seatbelt',
    Digit7: 'daffy', Digit8: 'spread', Digit9: 'backscratch', Digit0: 'ironcross' },
  mouse: { Digit1: 'safety', Digit2: 'mute', Digit3: 'japan', Digit4: 'tail', Digit5: 'nose', Digit6: 'truck', KeyF: 'critical', KeyG: 'octo', KeyZ: 'blunt', KeyX: 'stalefish', KeyV: 'bowarrow', KeyB: 'dubtail', KeyT: 'seatbelt',
    Digit7: 'daffy', Digit8: 'spread', Digit9: 'backscratch', Digit0: 'ironcross' },
  // Shredsauce's own grab keys, then the rest of ours on the number row
  // (Leon's own placing, 2026-11-03: C mute, B tail, V japan, X safety, Z nose, F blunt, S Left Safety; A and D are
  // the shifties; the rest on the number row)
  shred: { KeyC: 'mute', KeyB: 'tail', KeyV: 'japan', KeyX: 'safety', KeyZ: 'nose', KeyF: 'blunt', KeyS: 'safety_m',
    Digit1: 'truck', Digit2: 'mute_m', Digit3: 'japan_m', Digit4: 'tail_m', Digit5: 'critical', Digit6: 'octo', Digit7: 'stalefish',
    Digit8: 'bowarrow', Digit9: 'seatbelt', Digit0: 'dubtail', Minus: 'daffy', Equal: 'spread', BracketLeft: 'backscratch', BracketRight: 'ironcross' },
};

export function keyHelp(scheme) {
  const g = GRAB_KEYS[scheme] || GRAB_KEYS.keys, name = c => c.replace('Key', '').replace('Digit', '').replace('Semicolon', ';').replace('Minus', '-').replace('Equal', '=').replace('BracketLeft', '[').replace('BracketRight', ']');
  const grabs = Object.entries(g).map(([k, id]) => [name(k), id]);
  let base;
  if (scheme === 'mouse') base = [
    ['Mouse', 'point where to go'], ['Left button', 'hold to crouch, let go to pop'], ['Right button / S', 'brake (hold harder to stop)'], ['W', 'tuck, skate on the flat'],
    ['Air: mouse', 'spin and flip'], ['Q / E', 'tilt the axis (corks)'], ['Air: Shift + A / D', 'shifty'], ['Shift + W / S', 'butter on the nose / tail'],
  ];
  else if (scheme === 'shred') base = [
    ['← / →', 'turn / spin'], ['↓', 'brake (hold to stop) / back flip'], ['↑', 'crouch for less drag, skate on the flat / front flip'],
    ['Shift', 'skate forward; in the air a shifty (Left Shift left, Right Shift or Alt right)'], ['Air: A / D', 'left / right shifty'], ['G / H', 'Lincoln loop'],
    ['Space', 'crouch for less drag, let go to pop'], ['N', 'butter on the nose (with ↓ the tail), turn it with ← / →; on a rail a nose or tail press'],
    ['N N', 'just after a landing: a revert'], ['Air: ← ← / → →', 'a quick second press spins faster'],
    ['Grab + E / R', 'tweak it or vary it (poked, uncrossed blunt, truck to the left or right)'],
    ['Tab', 'set a marker'], ['Enter', 'back to your last crash (or your marker); twice: the start'], ['P', 'look over the other shoulder riding switch'], ['T', 'chat (in a room)'],
  ];
  else base = [
    ['A / D', 'turn'], ['W', 'tuck, skate on the flat'], ['S', 'brake (hold harder to stop)'], ['Space', 'hold to crouch, let go to pop'],
    ['Air: A / D', 'spin'], ['Air: W / S', 'front / back flip'], ['Q / E', 'tilt the axis (corks)'], ['Air: Shift + A / D', 'shifty'], ['Shift + W / S', 'butter on the nose / tail'],
  ];
  base.push([scheme === 'shred' ? 'Q' : 'C', 'camera (chase, far, first person, filmer)']);
  if (scheme !== 'shred') base.push(['R', 'start again a little earlier']);
  base.push(['Backspace', 'back to the top'], ['Esc', 'pause']);
  return { base, grabs };
}

const NO_DEFAULT = ['Space', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight'];
export class Input {
  constructor(canvas) {
    this.canvas = canvas; this.scheme = 'mouse';
    this.keys = new Set(); this.pressed = new Map(); this.downAt = new Map(); this.lastTap = new Map(); this.revertAt = 0;
    this.mdx = 0; this.mdy = 0; this.lmb = false; this.rmb = false;
    this.stick = 0;                    // the mouse scheme's pointing, -1 (left) .. 1 (right)
    this.airDx = 0; this.airDy = 0;
    this.grabOrder = []; this.fast = 0; this.shiftAir = 0;
    addEventListener('keydown', e => {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (NO_DEFAULT.includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      const now = performance.now();
      // a quick second press of a spin key: the fast spin (as Shredsauce has it)
      if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD') && now - (this.lastTap.get(e.code) || -1e9) < 260) this.fast = e.code;
      if (e.code === 'KeyN' && now - (this.lastTap.get(e.code) || -1e9) < 320) this.revertAt = now;
      this.lastTap.set(e.code, now);
      this.keys.add(e.code); this.pressed.set(e.code, now); this.downAt.set(e.code, now);
      const id = (GRAB_KEYS[this.scheme] || {})[e.code];
      if (id) { this.grabOrder = this.grabOrder.filter(x => x !== id); this.grabOrder.push(id); }
    });
    addEventListener('keyup', e => {
      if (NO_DEFAULT.includes(e.code)) e.preventDefault();     // Alt released alone would move the focus to the browser's menu
      this.keys.delete(e.code);
      if (this.fast === e.code) this.fast = 0;
      const id = (GRAB_KEYS[this.scheme] || {})[e.code];
      if (id) this.grabOrder = this.grabOrder.filter(x => x !== id);
    });
    addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; this.grabOrder = []; this.fast = 0; });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) this.lmb = true; if (e.button === 2) this.rmb = true; });
    addEventListener('mouseup', e => { if (e.button === 0) this.lmb = false; if (e.button === 2) this.rmb = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { this.mdx += e.movementX; this.mdy += e.movementY; } });
  }
  setScheme(s) { this.scheme = s; this.keys.clear(); this.grabOrder = []; this.stick = 0; }
  down(...codes) { return codes.some(c => this.keys.has(c)); }
  took(code) { const t = this.pressed.get(code); if (t === undefined) return false; this.pressed.delete(code); return performance.now() - t < 300; }
  heldFor(code) { return this.keys.has(code) ? performance.now() - (this.downAt.get(code) || 0) : 0; }
  // the intents for one frame; air tells it the skier is flying
  read(air, onRail) {
    const k = this, mouse = this.scheme === 'mouse', shred = this.scheme === 'shred';
    const I = { steer: 0, tuck: false, push: false, brake: false, crouch: false, spin: 0, flip: 0, tilt: 0, butter: false, press: 0, grab: null, pose: null, tweak: '', shifty: 0, fast: false, look: false, revert: false };
    if (shred) {
      const L = k.down('ArrowLeft'), R = k.down('ArrowRight'), F = k.down('ArrowUp'), B = k.down('ArrowDown');
      const shL = k.down('ShiftLeft'), shR = k.down('ShiftRight', 'AltLeft', 'AltRight');
      I.crouch = k.down('Space');
      I.butter = k.down('KeyN');
      I.press = I.butter ? (B ? -1 : 1) : 0;              // N alone presses the nose, with Down the tail
      if (this.revertAt && performance.now() - this.revertAt < 200) { I.revert = true; this.revertAt = 0; }
      I.look = k.down('KeyP');
      // Shift is a skate on the snow; in the air a shifty, only from a press made in the air
      if (!air) { this.shiftAir = 0; I.push = shL || shR; for (const c of ['ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight']) this.pressed.delete(c); }
      else {
        if (k.took('ShiftLeft')) this.shiftAir = -1; if (k.took('ShiftRight') || k.took('AltLeft') || k.took('AltRight')) this.shiftAir = 1; if (!shL && !shR) this.shiftAir = 0; I.shifty = this.shiftAir;
        // A and D: a left and a right shifty, as long as they are held
        const sA = k.down('KeyA'), sD = k.down('KeyD'); if (sA !== sD) I.shifty = sD ? 1 : -1;
      }
      if (!air) {
        I.steer = (R ? 1 : 0) - (L ? 1 : 0);
        if (!I.butter) { I.tuck = F; I.brake = B; }
      } else {
        I.spin = (R ? 1 : 0) - (L ? 1 : 0);
        I.flip = (F ? 1 : 0) - (B ? 1 : 0);
        I.tilt = (k.down('KeyH') ? 1 : 0) - (k.down('KeyG') ? 1 : 0);
        I.fast = this.fast === 'ArrowLeft' || this.fast === 'ArrowRight';
      }
      I.tweak = (k.down('KeyE') ? 'E' : '') + (k.down('KeyR') ? 'R' : '');
      // on a rail the arrows turn the skis on it
      if (onRail && !air) I.spin = 0;
    } else {
      const L = k.down('KeyA', 'ArrowLeft'), R = k.down('KeyD', 'ArrowRight'), F = k.down('KeyW', 'ArrowUp'), B = k.down('KeyS', 'ArrowDown');
      const shift = k.down('ShiftLeft', 'ShiftRight');
      I.butter = shift && !air;
      I.press = I.butter ? (F ? 1 : B ? -1 : 0) : 0;
      I.tilt = (k.down('KeyE') ? 1 : 0) - (k.down('KeyQ') ? 1 : 0);
      if (air && shift) { I.shifty = (R ? 1 : 0) - (L ? 1 : 0); }
      if (mouse) {
        I.crouch = this.lmb || k.down('Space');
        if (!air) {
          this.stick = Math.max(-1, Math.min(1, this.stick + this.mdx * 0.0032));
          I.steer = (R ? 1 : 0) - (L ? 1 : 0);
          I.mouse = this.stick;
          I.tuck = F && !I.butter; I.brake = this.rmb || (B && !I.butter);
          if (onRail) I.steer = Math.max(-1, Math.min(1, I.steer + this.mdx * 0.05));
        } else {
          this.airDx += (this.mdx * 0.05 - this.airDx) * 0.5; this.airDy += (this.mdy * 0.05 - this.airDy) * 0.5;
          I.spin = Math.max(-1, Math.min(1, this.airDx + (I.shifty ? 0 : (R ? 1 : 0) - (L ? 1 : 0))));
          I.flip = Math.max(-1, Math.min(1, -this.airDy + (F ? 1 : 0) - (B ? 1 : 0)));
          if (Math.abs(I.spin) < 0.08) I.spin = 0; if (Math.abs(I.flip) < 0.08) I.flip = 0;
        }
      } else {
        I.crouch = k.down('Space');
        if (!air) {
          I.steer = (R ? 1 : 0) - (L ? 1 : 0);
          I.tuck = F && !I.butter; I.brake = B && !I.butter;
        } else {
          I.spin = I.shifty ? 0 : (R ? 1 : 0) - (L ? 1 : 0);
          I.flip = (F ? 1 : 0) - (B ? 1 : 0);
          I.fast = this.fast === 'KeyA' || this.fast === 'KeyD';
        }
      }
      if (onRail && !air) { I.spin = k.took('KeyE') ? 1 : k.took('KeyQ') ? -1 : 0; I.tilt = 0; }
    }
    const id = this.grabOrder[this.grabOrder.length - 1] || null;
    if (id) { if (POSITIONS.has(id)) I.pose = id; else I.grab = id; }
    // touch: the thumb stick and buttons (touch.js)
    const T = this.touch;
    if (T && (T.jx || T.jy || T.pop || T.grab || T.butter)) {
      if (!air) {
        if (Math.abs(T.jx) > 0.1) { I.steer = T.jx; I.mouse = undefined; }
        if (!T.butter) { if (T.jy < -0.5) I.tuck = true; if (T.jy > 0.55) I.brake = true; }
      } else { if (Math.abs(T.jx) > 0.15) I.spin = T.jx; if (Math.abs(T.jy) > 0.25) I.flip = -T.jy; }
      if (T.pop) I.crouch = true;
      if (T.butter) { I.butter = true; I.press = Math.abs(T.jy) > 0.3 ? -Math.sign(T.jy) : 0; }
      if (T.grab && air && T.grabId) { if (POSITIONS.has(T.grabId)) I.pose = T.grabId; else I.grab = T.grabId; }
    }
    this.mdx = 0; this.mdy = 0;
    return I;
  }
}
