/* ---------------------------------------------------------------------------
   Leoncraft 2 - noise.

   The same building blocks modern Minecraft's world generator is made of,
   written from the published descriptions of it:

     improved Perlin noise (Ken Perlin, 2002), each with its own shuffled
       permutation and a random offset, so two noises never line up;
     octaves of it, from a first (lowest) octave up, each with an amplitude;
     "normal noise": two octave sets read at slightly different scales and
       added, which spreads the values out evenly instead of piling them up
       around zero.

   Every noise is seeded from the world seed and its own name, so the same
   seed always gives the same world.
--------------------------------------------------------------------------- */

// splitmix32: a quick, good 32-bit mixer for seeding
export function mix32(a) {
  a |= 0; a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
  t = t ^ (t >>> 15); t = Math.imul(t, 0x735a2d97);
  return (t ^ (t >>> 15)) >>> 0;
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// a small seeded generator (mulberry32)
export function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = n => Math.floor(next() * n);
  next.range = (a, b) => a + next() * (b - a);
  next.chance = p => next() < p;
  return next;
}
// a position hash, for things decided block by block (0..1)
export function hash3(seed, x, y, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* ---- improved Perlin noise --------------------------------------------- */
const GRAD = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
];
const GX = new Float64Array(16), GY = new Float64Array(16), GZ = new Float64Array(16);
GRAD.forEach((g, i) => { GX[i] = g[0]; GY[i] = g[1]; GZ[i] = g[2]; });

export class Improved {
  constructor(r) {
    this.xo = r() * 256; this.yo = r() * 256; this.zo = r() * 256;
    const p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) { const j = i + Math.floor(r() * (256 - i)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 256; i++) p[i + 256] = p[i];
    this.p = p;
  }
  sample(x, y, z) {
    x += this.xo; y += this.yo; z += this.zo;
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const w = z * z * z * (z * (z * 6 - 15) + 10);
    const p = this.p;
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B_ = p[X + 1] + Y, BA = p[B_] + Z, BB = p[B_ + 1] + Z;
    const g = (h, a, b, c) => { h &= 15; return GX[h] * a + GY[h] * b + GZ[h] * c; };
    const l1 = g(p[AA], x, y, z) + u * (g(p[BA], x - 1, y, z) - g(p[AA], x, y, z));
    const l2 = g(p[AB], x, y - 1, z) + u * (g(p[BB], x - 1, y - 1, z) - g(p[AB], x, y - 1, z));
    const l3 = g(p[AA + 1], x, y, z - 1) + u * (g(p[BA + 1], x - 1, y, z - 1) - g(p[AA + 1], x, y, z - 1));
    const l4 = g(p[AB + 1], x, y - 1, z - 1) + u * (g(p[BB + 1], x - 1, y - 1, z - 1) - g(p[AB + 1], x, y - 1, z - 1));
    const m1 = l1 + v * (l2 - l1), m2 = l3 + v * (l4 - l3);
    return m1 + w * (m2 - m1);
  }
}

/* ---- octaves ----------------------------------------------------------- */
export class Octaves {
  // firstOctave: the lowest (e.g. -9 means a wavelength of 512 blocks)
  constructor(r, firstOctave, amplitudes) {
    this.levels = [];
    const n = amplitudes.length;
    // the lowest octave counts for most, and each one up for half as much
    const lowest = Math.pow(2, n - 1) / (Math.pow(2, n) - 1);
    for (let i = 0; i < n; i++) {
      const sub = rng(Math.floor(r() * 4294967296));
      if (amplitudes[i] !== 0) {
        this.levels.push({ noise: new Improved(sub), amp: amplitudes[i], freq: Math.pow(2, firstOctave + i), valueFactor: lowest / Math.pow(2, i) });
      }
    }
  }
  sample(x, y, z) {
    let v = 0;
    for (const L of this.levels) v += L.amp * L.valueFactor * L.noise.sample(x * L.freq, y * L.freq, z * L.freq);
    return v;
  }
}

/* ---- normal noise ------------------------------------------------------ */
export class NormalNoise {
  constructor(seed, name, firstOctave, amplitudes) {
    const r = rng(mix32(seed ^ hashStr(name)));
    this.a = new Octaves(r, firstOctave, amplitudes);
    this.b = new Octaves(r, firstOctave, amplitudes);
    let lo = 1e9, hi = -1e9;
    amplitudes.forEach((a, i) => { if (a !== 0) { lo = Math.min(lo, i); hi = Math.max(hi, i); } });
    const span = hi - lo;
    // spread the sum out to roughly -1..1
    this.factor = (1 / 6) / (0.1 * (1 + 1 / (span + 1)));
  }
  sample(x, y, z) {
    const k = 1.0181268882175227;
    return (this.a.sample(x, y, z) + this.b.sample(x * k, y * k, z * k)) * this.factor;
  }
}

/* ---- splines ----------------------------------------------------------- */
// a cubic Hermite spline over one input; a point's value may itself be a spline
export function spline(input, points) { return { input, points }; }
export function evalSpline(s, ctx) {
  if (typeof s === 'number') return s;
  const x = ctx[s.input];
  const P = s.points;
  const val = i => evalSpline(P[i][1], ctx);
  if (x <= P[0][0]) return val(0) + (P[0][2] || 0) * (x - P[0][0]);
  const n = P.length - 1;
  if (x >= P[n][0]) return val(n) + (P[n][2] || 0) * (x - P[n][0]);
  let i = 0;
  while (P[i + 1][0] < x) i++;
  const x0 = P[i][0], x1 = P[i + 1][0];
  const y0 = val(i), y1 = val(i + 1);
  const d0 = P[i][2] || 0, d1 = P[i + 1][2] || 0;
  const t = (x - x0) / (x1 - x0), dx = x1 - x0;
  const a = d0 * dx - (y1 - y0), b = -d1 * dx + (y1 - y0);
  return y0 + t * (y1 - y0) + t * (1 - t) * (a * (1 - t) + b * t);
}
