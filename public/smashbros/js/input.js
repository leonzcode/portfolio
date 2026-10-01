// Keyboard and gamepad controllers. Each produces the engine's input shape:
// { x, y, cx, cy, held: { a, b, j, s, g, sm } }   (y is positive downward)

export const KEYMAPS = {
  kb1: {
    label: 'Keyboard 1',
    left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'],
    a: ['KeyJ'], b: ['KeyK'], j: ['Space'], s: ['KeyL'], g: ['KeyH'], sm: ['KeyI'],
    help: 'Move W A S D · Jump Space or W · Attack J · Special K · Shield L · Grab H · Smash I',
  },
  kb2: {
    label: 'Keyboard 2',
    left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'],
    a: ['Comma', 'Numpad1'], b: ['Period', 'Numpad2'], j: ['ShiftRight', 'Numpad0'], s: ['Slash', 'Numpad3'], g: ['KeyM', 'Numpad4'], sm: ['KeyN', 'Numpad5'],
    help: 'Move arrows · Jump Right Shift or Up · Attack , · Special . · Shield / · Grab M · Smash N',
  },
};

const down = new Set();
let listening = false;

export function listenKeys() {
  if (listening) return;
  listening = true;
  window.addEventListener('keydown', e => {
    down.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'].includes(e.code) && document.body.classList.contains('playing')) e.preventDefault();
  });
  window.addEventListener('keyup', e => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
}

const any = codes => codes.some(c => down.has(c));

export function readKeyboard(id) {
  const k = KEYMAPS[id];
  const x = (any(k.right) ? 1 : 0) - (any(k.left) ? 1 : 0);
  const y = (any(k.down) ? 1 : 0) - (any(k.up) ? 1 : 0);
  return { x, y, cx: 0, cy: 0, held: { a: any(k.a) ? 1 : 0, b: any(k.b) ? 1 : 0, j: any(k.j) ? 1 : 0, s: any(k.s) ? 1 : 0, g: any(k.g) ? 1 : 0, sm: any(k.sm) ? 1 : 0 } };
}

export function keyDown(code) { return down.has(code); }

const DZ = 0.22;
const dz = v => (Math.abs(v) < DZ ? 0 : v);

export function pads() {
  const list = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  return list.filter(Boolean);
}

export function readPad(index) {
  const p = pads().find(g => g.index === index);
  if (!p) return { x: 0, y: 0, cx: 0, cy: 0, held: { a: 0, b: 0, j: 0, s: 0, g: 0, sm: 0 }, start: false };
  const b = i => (p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.4)) ? 1 : 0;
  let x = dz(p.axes[0] || 0), y = dz(p.axes[1] || 0);
  if (b(14)) x = -1; if (b(15)) x = 1; if (b(12)) y = -1; if (b(13)) y = 1;
  return {
    x, y, cx: dz(p.axes[2] || 0), cy: dz(p.axes[3] || 0),
    held: { a: b(0), b: b(1), j: b(2) || b(3), s: b(5) || b(6) || b(7), g: b(4), sm: 0 },
    start: !!b(9),
  };
}
