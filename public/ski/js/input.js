// Two control schemes, read into the same intents for the skier:
//   mouse: the mouse points where you want to go (the skier carves towards it), hold the left button to crouch and
//          let go to pop, right button brakes; in the air the mouse spins and flips; grabs on the number row and
//          letters near WASD
//   keys:  A/D turn, W tucks, S brakes, Space crouch and pop; in the air A/D spin, W/S flip, Q/E tilt the axis;
//          grabs on the right hand (J K L I U O P H N M Y B ;)
// Both: Shift + W/S butters on the nose or tail (A/D or the mouse pivots), C changes the camera, R starts again a
// little earlier, Backspace goes back to the top, Esc pauses.
const GRAB_KEYS = {
  keys: { KeyJ: 'safety', KeyK: 'mute', KeyL: 'japan', KeyI: 'tail', KeyU: 'nose', KeyO: 'truck', KeyP: 'critical', KeyH: 'octo', KeyN: 'blunt', KeyM: 'stalefish', KeyY: 'bowarrow', KeyB: 'dubtail', Semicolon: 'seatbelt',
    Digit7: 'daffy', Digit8: 'spread', Digit9: 'backscratch', Digit0: 'ironcross' },
  mouse: { Digit1: 'safety', Digit2: 'mute', Digit3: 'japan', Digit4: 'tail', Digit5: 'nose', Digit6: 'truck', KeyF: 'critical', KeyG: 'octo', KeyZ: 'blunt', KeyX: 'stalefish', KeyV: 'bowarrow', KeyB: 'dubtail', KeyT: 'seatbelt',
    Digit7: 'daffy', Digit8: 'spread', Digit9: 'backscratch', Digit0: 'ironcross' },
};
export const POSITIONS = new Set(['daffy', 'spread', 'backscratch', 'ironcross']);

export function keyHelp(scheme) {
  const g = GRAB_KEYS[scheme], name = c => c.replace('Key', '').replace('Digit', '').replace('Semicolon', ';');
  const grabs = Object.entries(g).map(([k, id]) => [name(k), id]);
  const base = scheme === 'mouse' ? [
    ['Mouse', 'point where to go'], ['Left button', 'hold to crouch, let go to pop'], ['Right button / S', 'brake (hockey stop)'], ['W', 'tuck'],
    ['Air: mouse', 'spin and flip'], ['Q / E', 'tilt the axis (corks)'], ['Shift + W / S', 'butter on the nose / tail'],
  ] : [
    ['A / D', 'turn'], ['W', 'tuck'], ['S', 'brake (hockey stop)'], ['Space', 'hold to crouch, let go to pop'],
    ['Air: A / D', 'spin'], ['Air: W / S', 'front / back flip'], ['Q / E', 'tilt the axis (corks)'], ['Shift + W / S', 'butter on the nose / tail'],
  ];
  base.push(['C', 'camera (chase, far, first person, filmer)'], ['R', 'start again a little earlier'], ['Backspace', 'back to the top'], ['Esc', 'pause']);
  return { base, grabs };
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas; this.scheme = 'mouse';
    this.keys = new Set(); this.pressed = new Set();
    this.mdx = 0; this.mdy = 0; this.lmb = false; this.rmb = false;
    this.stick = 0;                    // the mouse scheme's pointing, -1 (left) .. 1 (right)
    this.airDx = 0; this.airDy = 0;
    this.grab = null; this.grabOrder = [];
    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (['Space', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code); this.pressed.add(e.code);
      const id = GRAB_KEYS[this.scheme][e.code];
      if (id) { this.grabOrder = this.grabOrder.filter(x => x !== id); this.grabOrder.push(id); }
    });
    addEventListener('keyup', e => {
      this.keys.delete(e.code);
      const id = GRAB_KEYS[this.scheme][e.code];
      if (id) this.grabOrder = this.grabOrder.filter(x => x !== id);
    });
    addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; this.grabOrder = []; });
    canvas.addEventListener('mousedown', e => { if (e.button === 0) this.lmb = true; if (e.button === 2) this.rmb = true; });
    addEventListener('mouseup', e => { if (e.button === 0) this.lmb = false; if (e.button === 2) this.rmb = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { this.mdx += e.movementX; this.mdy += e.movementY; } });
  }
  setScheme(s) { this.scheme = s; this.keys.clear(); this.grabOrder = []; this.stick = 0; }
  down(...codes) { return codes.some(c => this.keys.has(c)); }
  took(code) { if (this.pressed.has(code)) { this.pressed.delete(code); return true; } return false; }
  // the intents for one frame; air tells it the skier is flying
  read(air, onRail) {
    const k = this, mouse = this.scheme === 'mouse';
    const I = { steer: 0, tuck: false, brake: false, crouch: false, spin: 0, flip: 0, tilt: 0, butter: false, press: 0, grab: null, pose: null, target: null };
    const L = k.down('KeyA', 'ArrowLeft'), R = k.down('KeyD', 'ArrowRight'), F = k.down('KeyW', 'ArrowUp'), B = k.down('KeyS', 'ArrowDown');
    I.butter = k.down('ShiftLeft', 'ShiftRight');
    I.press = I.butter ? (F ? 1 : B ? -1 : 0) : 0;
    I.tilt = (k.down('KeyE') ? 1 : 0) - (k.down('KeyQ') ? 1 : 0);
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
        I.spin = Math.max(-1, Math.min(1, this.airDx + (R ? 1 : 0) - (L ? 1 : 0)));
        I.flip = Math.max(-1, Math.min(1, -this.airDy + (F ? 1 : 0) - (B ? 1 : 0)));
        if (Math.abs(I.spin) < 0.08) I.spin = 0; if (Math.abs(I.flip) < 0.08) I.flip = 0;
      }
    } else {
      I.crouch = k.down('Space');
      if (!air) {
        I.steer = (R ? 1 : 0) - (L ? 1 : 0);
        I.tuck = F && !I.butter; I.brake = B && !I.butter;
      } else {
        I.spin = (R ? 1 : 0) - (L ? 1 : 0);
        I.flip = (F ? 1 : 0) - (B ? 1 : 0);
      }
    }
    if (onRail && !air) { I.spin = k.took(mouse ? 'KeyE' : 'KeyE') ? 1 : k.took('KeyQ') ? -1 : 0; I.tilt = 0; }
    const id = this.grabOrder[this.grabOrder.length - 1] || null;
    if (id) { if (POSITIONS.has(id)) I.pose = id; else I.grab = id; }
    this.mdx = 0; this.mdy = 0;
    return I;
  }
}
