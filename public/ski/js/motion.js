// Springs for the rider's pose. Every pose parameter that can change with the controls moves through one of these,
// so a change (left to right, a grab to another grab, a spin to a flip) passes through the poses in between instead of
// jumping. Critically damped by default (no overshoot); a damping ratio under 1 lets a little swing through, kept for
// the arms and the air, never for what carries a landing.
export class Spring {
  constructor(x = 0) { this.x = x; this.v = 0; }
  // move towards target for dt seconds; w is the natural frequency in rad/s (critically damped, it is about 95% of
  // the way there after 4.7 / w seconds), zeta the damping ratio
  to(target, w, dt, zeta = 1) {
    if (!(dt > 0)) return this.x;
    const y = this.x - target;
    if (zeta >= 0.999) {
      const j1 = this.v + y * w, e = Math.exp(-w * dt);
      this.x = e * (y + j1 * dt) + target;
      this.v = e * (this.v - j1 * w * dt);
    } else {
      const a = zeta * w, wd = w * Math.sqrt(1 - zeta * zeta), B = (this.v + a * y) / wd;
      const e = Math.exp(-a * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
      this.x = e * (y * c + B * s) + target;
      this.v = e * ((B * wd - a * y) * c - (y * wd + a * B) * s);
    }
    return this.x;
  }
  set(x) { this.x = x; this.v = 0; return x; }
}

// a bank of named springs kept in a plain object (the rig's p), so clearing that object resets them all
export function springBank(P, dt) {
  return (name, target, w, zeta = 1) => {
    let s = P[name];
    if (s === undefined) { s = P[name] = new Spring(target); return target; }
    return s.to(target, w, dt, zeta);
  };
}

export const smooth01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
