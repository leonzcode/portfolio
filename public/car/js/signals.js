// Traffic light timing shared by the lights (props.js) and the traffic (traffic.js), so a car stops when its light
// shows red. Each signal group (roads.signalGroups) runs two phases: approaches along the group's axis, then
// across it. Groups start at different points of the cycle.
const A_GREEN = 24, B_GREEN = 18, AMBER = 3.5, ALL_RED = 1.5;
export const CYCLE = A_GREEN + AMBER + ALL_RED + B_GREEN + AMBER + ALL_RED;

let clock = 0;
export function tick(dt) { clock += dt; }
export function now() { return clock; }

function hash(v) { const s = String(v); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; }

// is an approach with this heading (degrees) on the group's axis
export function onAxis(group, heading) {
  const d = Math.abs(((heading - group.axis) % 180 + 270) % 180 - 90);
  return d <= 45;
}

// 'green' | 'amber' | 'red' for an approach of the group, and the seconds until it changes
export function state(group, heading, t = clock) {
  const off = (group._off ??= hash(group.id) * CYCLE);
  const c = ((t + off) % CYCLE + CYCLE) % CYCLE;
  const a = onAxis(group, heading);
  const aEnd = A_GREEN, aAmb = aEnd + AMBER, bStart = aAmb + ALL_RED, bEnd = bStart + B_GREEN, bAmb = bEnd + AMBER;
  if (a) {
    if (c < aEnd) return { s: 'green', left: aEnd - c };
    if (c < aAmb) return { s: 'amber', left: aAmb - c };
    return { s: 'red', left: CYCLE - c };
  }
  if (c < bStart) return { s: 'red', left: bStart - c };
  if (c < bEnd) return { s: 'green', left: bEnd - c };
  if (c < bAmb) return { s: 'amber', left: bAmb - c };
  return { s: 'red', left: CYCLE - c + bStart };
}
