/* ---------------------------------------------------------------------------
   Leoncraft 2 - particles: the puff when a mob dies, crits, hearts, the
   flames on something burning, explosion smoke, bubbles.

   A fixed pool in flat arrays (no objects made per particle). Each one moves
   20 times a second with its own gravity and drag, ages through its frames,
   and is drawn between ticks as a camera-facing square (render/entitymesh.js).
--------------------------------------------------------------------------- */
import { keepParticle } from '../render/particles.js?v=24';
const N = 4096;
const R = () => Math.random();

// kinds: frame range, size, life, gravity, drag, colour, glow
const KINDS = {
  poof: { f0: 7, f1: 0, size: 0.18, life: [8, 20], g: -0.004, drag: 0.9, col: [0.9, 0.9, 0.9], spread: 0.06 },
  smoke: { f0: 7, f1: 0, size: 0.14, life: [10, 30], g: -0.003, drag: 0.96, col: [0.35, 0.35, 0.35], spread: 0.02 },
  crit: { f0: 8, f1: 8, size: 0.14, life: [6, 16], g: 0.02, drag: 0.7, col: [1, 1, 1], spread: 0.5 },
  magic: { f0: 9, f1: 9, size: 0.14, life: [6, 16], g: 0.02, drag: 0.7, col: [0.6, 0.3, 1], spread: 0.5 },
  heart: { f0: 10, f1: 10, size: 0.2, life: [16, 24], g: -0.01, drag: 0.86, col: [1, 1, 1], spread: 0.02, glow: true },
  angry: { f0: 11, f1: 11, size: 0.24, life: [16, 24], g: -0.01, drag: 0.86, col: [1, 1, 1], spread: 0.02 },
  flame: { f0: 12, f1: 12, size: 0.12, life: [8, 20], g: -0.002, drag: 0.96, col: [1, 1, 1], spread: 0.01, glow: true },
  bubble: { f0: 13, f1: 13, size: 0.08, life: [10, 30], g: -0.02, drag: 0.85, col: [1, 1, 1], spread: 0.02 },
  splash: { f0: 14, f1: 14, size: 0.06, life: [8, 16], g: 0.04, drag: 0.98, col: [0.6, 0.7, 1], spread: 0.15 },
  explosion: { f0: 19, f1: 16, size: 0.9, life: [6, 14], g: 0, drag: 0.9, col: [1, 1, 1], spread: 0.0 },
  explosion_big: { f0: 15, f1: 15, size: 3.6, life: [3, 4], g: 0, drag: 1, col: [1, 1, 1], spread: 0, glow: true },
  sweep: { f0: 21, f1: 21, size: 0.6, life: [4, 6], g: 0, drag: 1, col: [1, 1, 1], spread: 0 },
  sparkle: { f0: 21, f1: 21, size: 0.1, life: [10, 20], g: -0.005, drag: 0.9, col: [0.5, 1, 0.5], spread: 0.05, glow: true },
  portal: { f0: 22, f1: 22, size: 0.08, life: [20, 40], g: 0, drag: 0.94, col: [0.6, 0.2, 0.9], spread: 0.3, glow: true },
  dust: { f0: 22, f1: 22, size: 0.08, life: [10, 20], g: 0.002, drag: 0.9, col: [0.5, 0.5, 0.5], spread: 0.05 },
  // the runes that drift from bookshelves into an enchanting table (their path is set where they are made)
  enchant: { f0: 24, f1: 25, size: 0.09, life: [30, 40], g: 0.0015, drag: 1, col: [0.86, 0.86, 1], spread: 0, glow: true },
  note: { f0: 20, f1: 20, size: 0.2, life: [10, 14], g: -0.02, drag: 0.8, col: [0.3, 1, 0.3], spread: 0, glow: true },
  // the blocks round you (entities/ambient.js): soul torches' flames, fire's big smoke, lava's sparks,
  // and campfire smoke, rising a long way and fading over its last three seconds
  soul_flame: { f0: 26, f1: 26, size: 0.12, life: [8, 20], g: -0.002, drag: 0.96, col: [1, 1, 1], spread: 0.01, glow: true },
  large_smoke: { f0: 7, f1: 0, size: 0.3, life: [16, 40], g: -0.003, drag: 0.96, col: [0.3, 0.3, 0.3], spread: 0 },
  lava: { f0: 22, f1: 22, size: 0.12, life: [16, 40], g: 0.03, drag: 0.999, col: [1, 0.55, 0.15], spread: 0, glow: true },
  // leaves falling from leaf blocks (their life is set to the time they take to reach the ground)
  leaf: { f0: 27, f1: 27, size: 0.25, life: [300, 300], g: 0.00021, drag: 1, col: [1, 1, 1], spread: 0 },
  underwater: { f0: 22, f1: 22, size: 0.12, life: [16, 80], g: 0, drag: 0.98, col: [0.4, 0.4, 0.7], spread: 0 },
  rain: { f0: 22, f1: 22, size: 0.2, life: [8, 40], g: 0.06, drag: 0.98, col: [0.7, 0.8, 1], spread: 0 },
  campfire: { f0: 2, f1: 2, size: 0.5, life: [280, 330], g: -0.000003, drag: 1, col: [0.85, 0.85, 0.85], spread: 0 },
  campfire_signal: { f0: 1, f1: 1, size: 0.5, life: [400, 460], g: -0.000003, drag: 1, col: [0.85, 0.85, 0.85], spread: 0 },
};

export class Particles {
  constructor() {
    this.n = 0;
    this.pos = new Float32Array(N * 3); this.prev = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    this.col = new Float32Array(N * 4); this.life = new Float32Array(N * 2); this.info = new Float32Array(N * 6);   // f0, f1, size, gravity, drag, light
    this.spin = new Float32Array(N);
  }
  add(kind, x, y, z, count, spread, col, light) {
    const K = KINDS[kind] || KINDS.poof;
    const s = spread === undefined ? K.spread : spread;
    for (let k = 0; k < count; k++) {
      if (this.n >= N) return;
      // the Particles setting (Video Settings) leaves some out
      if (!keepParticle()) continue;
      const i = this.n++;
      const o = i * 3;
      const px = x + (count > 1 ? (R() - 0.5) * s * 2 : 0), py = y + (count > 1 ? (R() - 0.5) * s * 2 : 0), pz = z + (count > 1 ? (R() - 0.5) * s * 2 : 0);
      this.pos[o] = this.prev[o] = px; this.pos[o + 1] = this.prev[o + 1] = py; this.pos[o + 2] = this.prev[o + 2] = pz;
      const v = kind === 'crit' || kind === 'magic' ? 0.5 : kind === 'explosion' ? 0.05 : 0.04;
      this.vel[o] = (R() - 0.5) * v; this.vel[o + 1] = (R() - 0.2) * v; this.vel[o + 2] = (R() - 0.5) * v;
      if (kind === 'heart' || kind === 'angry' || kind === 'note') { this.vel[o] = this.vel[o + 2] = 0; this.vel[o + 1] = 0.02; }
      const c = col || K.col, shade = kind === 'poof' || kind === 'smoke' || kind === 'explosion' ? 0.8 + R() * 0.2 : 1;
      this.col[i * 4] = c[0] * shade; this.col[i * 4 + 1] = c[1] * shade; this.col[i * 4 + 2] = c[2] * shade; this.col[i * 4 + 3] = 1;
      const life = K.life[0] + R() * (K.life[1] - K.life[0]);
      this.life[i * 2] = 0; this.life[i * 2 + 1] = life;
      const I = i * 6;
      this.info[I] = K.f0; this.info[I + 1] = K.f1; this.info[I + 2] = K.size * (0.75 + R() * 0.5); this.info[I + 3] = K.g; this.info[I + 4] = K.drag;
      this.info[I + 5] = K.glow ? 1 : light === undefined ? 1 : light;
      this.spin[i] = kind === 'sweep' ? R() * 6.28 : 0;
    }
  }
  tick() {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const L = this.life;
      L[i * 2] += 1;
      if (L[i * 2] >= L[i * 2 + 1]) continue;
      if (j !== i) this.move(i, j);
      const o = j * 3, I = j * 6;
      this.prev[o] = this.pos[o]; this.prev[o + 1] = this.pos[o + 1]; this.prev[o + 2] = this.pos[o + 2];
      this.pos[o] += this.vel[o]; this.pos[o + 1] += this.vel[o + 1]; this.pos[o + 2] += this.vel[o + 2];
      const d = this.info[I + 4];
      this.vel[o] *= d; this.vel[o + 1] = (this.vel[o + 1] - this.info[I + 3]) * d; this.vel[o + 2] *= d;
      j++;
    }
    this.n = j;
  }
  move(i, j) {
    for (let k = 0; k < 3; k++) { this.pos[j * 3 + k] = this.pos[i * 3 + k]; this.prev[j * 3 + k] = this.prev[i * 3 + k]; this.vel[j * 3 + k] = this.vel[i * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[j * 4 + k] = this.col[i * 4 + k];
    for (let k = 0; k < 2; k++) this.life[j * 2 + k] = this.life[i * 2 + k];
    for (let k = 0; k < 6; k++) this.info[j * 6 + k] = this.info[i * 6 + k];
    this.spin[j] = this.spin[i];
  }
  draw(meshes, a) {
    for (let i = 0; i < this.n; i++) {
      const o = i * 3, I = i * 6, t = (this.life[i * 2] + a) / this.life[i * 2 + 1];
      const f0 = this.info[I], f1 = this.info[I + 1];
      const frame = Math.round(f0 + (f1 - f0) * Math.min(1, t));
      const x = this.prev[o] + (this.pos[o] - this.prev[o]) * a, y = this.prev[o + 1] + (this.pos[o + 1] - this.prev[o + 1]) * a, z = this.prev[o + 2] + (this.pos[o + 2] - this.prev[o + 2]) * a;
      // the explosion puff thins as it grows; anything long-lived (campfire smoke) fades over its last 60 ticks
      const left = this.life[i * 2 + 1] - this.life[i * 2] - a;
      const alpha = f0 === 15 ? 1 - t * 0.5 : this.life[i * 2 + 1] > 200 && left < 60 ? Math.max(0, left / 60) : 1;
      meshes.particle(x, y, z, this.info[I + 2] * (f0 === 15 ? 0.6 + t : 1), this.col[i * 4], this.col[i * 4 + 1], this.col[i * 4 + 2], alpha, frame, this.info[I + 5], this.spin[i]);
    }
  }
}
