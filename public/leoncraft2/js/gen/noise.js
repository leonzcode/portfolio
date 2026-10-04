/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: the noises.

   Improved (Perlin) noise as the game builds it from a random generator,
   the "normal" noise made of two stacks of octaves (each 26.3 noise is
   described by a base amplitude, a base octave, an octave count and
   amplitude modifiers), and the old blended noise that shapes the land.

   Ported from misode's deepslate (MIT, https://github.com/misode/deepslate,
   Copyright (c) 2021 Misode), which matches Minecraft 26.3; rewritten with
   typed arrays and no allocation per sample.
--------------------------------------------------------------------------- */

const GX = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, 0, -1, 0]);
const GY = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1]);
const GZ = new Float64Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 1, 0, -1]);
const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = v => v - Math.floor(v / 33554432 + 0.5) * 33554432;
const SHIFT_UP = Math.fround(1e-7);

export class Perlin {
  constructor(random, fudge) {
    this.xo = random.nextDouble() * 256;
    this.yo = random.nextDouble() * 256;
    this.zo = random.nextDouble() * 256;
    const p = this.p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) {
      const j = random.nextInt(256 - i);
      const t = p[i]; p[i] = p[i + j]; p[i + j] = t;
    }
    for (let i = 0; i < 256; i++) p[i + 256] = p[i];
    this.fudge = fudge || 0;       // the y "smear" of the blended noise's octaves
  }
  sample(x, y, z) {
    const x1 = wrap(x) + this.xo, y1 = wrap(y) + this.yo, z1 = wrap(z) + this.zo;
    const fx = Math.floor(x1), fy = Math.floor(y1), fz = Math.floor(z1);
    const rx = x1 - fx, ry = y1 - fy, rz = z1 - fz;
    let sy = ry;
    if (this.fudge !== 0) {
      const lim = (y >= 0 && y < ry) ? y : ry;
      sy = ry - Math.floor(lim / this.fudge + SHIFT_UP) * this.fudge;
    }
    return this.lerpAt(fx, fy, fz, rx, sy, rz, ry);
  }
  lerpAt(X, Y, Z, rx, ry, rz, ory) {
    const p = this.p;
    const x0 = p[X & 255], x1 = p[(X + 1) & 255];
    const a0 = p[(x0 + Y) & 255], a1 = p[(x0 + Y + 1) & 255];
    const b0 = p[(x1 + Y) & 255], b1 = p[(x1 + Y + 1) & 255];
    let h;
    const rx1 = rx - 1, ry1 = ry - 1, rz1 = rz - 1;
    h = p[(a0 + Z) & 255] & 15; const d000 = GX[h] * rx + GY[h] * ry + GZ[h] * rz;
    h = p[(b0 + Z) & 255] & 15; const d100 = GX[h] * rx1 + GY[h] * ry + GZ[h] * rz;
    h = p[(a1 + Z) & 255] & 15; const d010 = GX[h] * rx + GY[h] * ry1 + GZ[h] * rz;
    h = p[(b1 + Z) & 255] & 15; const d110 = GX[h] * rx1 + GY[h] * ry1 + GZ[h] * rz;
    h = p[(a0 + Z + 1) & 255] & 15; const d001 = GX[h] * rx + GY[h] * ry + GZ[h] * rz1;
    h = p[(b0 + Z + 1) & 255] & 15; const d101 = GX[h] * rx1 + GY[h] * ry + GZ[h] * rz1;
    h = p[(a1 + Z + 1) & 255] & 15; const d011 = GX[h] * rx + GY[h] * ry1 + GZ[h] * rz1;
    h = p[(b1 + Z + 1) & 255] & 15; const d111 = GX[h] * rx1 + GY[h] * ry1 + GZ[h] * rz1;
    const tx = smooth(rx), ty = smooth(ory), tz = smooth(rz);
    const l00 = d000 + tx * (d100 - d000), l10 = d010 + tx * (d110 - d010);
    const l01 = d001 + tx * (d101 - d001), l11 = d011 + tx * (d111 - d011);
    const m0 = l00 + ty * (l10 - l00), m1 = l01 + ty * (l11 - l01);
    return m0 + tz * (m1 - m0);
  }
}

/* A stack of octaves: value = sum of amplitude * noise(position * frequency). */
export class Stack {
  constructor(layers) {
    this.n = layers.length;
    this.noise = layers.map(l => l.noise);
    this.freq = new Float64Array(layers.map(l => l.frequency));
    this.amp = new Float64Array(layers.map(l => l.amplitude));
  }
  sample(x, y, z) {
    let v = 0;
    const N = this.noise, F = this.freq, A = this.amp;
    for (let i = 0; i < this.n; i++) { const f = F[i]; v += A[i] * N[i].sample(x * f, y * f, z * f); }
    return v;
  }
}

/* ---- normal noise, as 26.3 describes it ---- */
const INPUT_FACTOR = 1.0181268882175227, TARGET_DEV = 0.3333333333333333;
export function normalNoise(def, random) {
  const baseAmp = def.base_amplitude ?? 1, baseOct = def.base_octave ?? 0, count = def.octave_count ?? 1;
  const mods = def.amplitude_modifiers || [];
  const norm = typeof def.normalize === 'boolean' ? (def.normalize ? 'enabled' : 'disabled') : (def.normalize || 'enabled');
  // the octaves
  let freq = Math.pow(2, baseOct), amp = baseAmp;
  if (norm !== 'disabled') amp *= Math.pow(0.5, -(count - 1)) / (Math.pow(0.5, -count) - 1);
  const octs = [];
  for (let i = 0; i < count; i++) {
    const m = mods[i] ?? 1;
    if (m !== 0) octs.push({ index: baseOct + i, frequency: freq, amplitude: amp * m });
    freq *= 2; amp *= 0.5;
  }
  // the normalisation
  let target = 0, variance = 0;
  for (const o of octs) { target += Math.abs(o.amplitude); variance += (0.2702247831245211 * Math.abs(o.amplitude)) ** 2; }
  const dev = Math.sqrt(variance);
  let nf = dev === 0 ? 0 : (target * TARGET_DEV) / (dev * Math.sqrt(2));
  if (norm === 'legacy' && nf !== 0) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < count; i++) if ((mods[i] ?? 1) !== 0) { mn = Math.min(mn, i); mx = Math.max(mx, i); }
    const pd = 0.1 * (1 + 1 / (mx - mn + 1));
    nf = baseAmp * 0.5 * TARGET_DEV / pd;
  }
  const first = random.forkPositional(), second = random.forkPositional();
  const layers = [];
  for (const o of octs) {
    const key = 'octave_' + o.index;
    const vf = nf * o.amplitude;
    layers.push({ noise: new Perlin(first.fromHashOf(key)), frequency: o.frequency, amplitude: vf });
    layers.push({ noise: new Perlin(second.fromHashOf(key)), frequency: o.frequency * INPUT_FACTOR, amplitude: vf });
  }
  return new Stack(layers);
}

/* ---- the old blended noise (the body of the land) ---- */
export class Blended {
  constructor(random, xzScale, yScale, xzFactor, yFactor, smear) {
    this.xzMul = 684.412 * xzScale;
    this.yMul = 684.412 * yScale;
    this.xzFactor = xzFactor; this.yFactor = yFactor;
    const limitSmear = this.yMul * smear, mainSmear = limitSmear / yFactor;
    const make = (first, smearY, valueFactor) => {
      const octaves = -first + 1;
      let factor = 1;
      valueFactor /= Math.pow(2, octaves) - 1;
      const layers = [];
      for (let i = octaves - 1; i >= 0; i--) {
        layers.push({ noise: new Perlin(random, smearY * factor), frequency: factor, amplitude: valueFactor });
        factor /= 2; valueFactor *= 2;
      }
      return new Stack(layers);
    };
    this.minN = make(-15, limitSmear, 0.99998474);
    this.maxN = make(-15, limitSmear, 0.99998474);
    this.mainN = make(-7, mainSmear, 12.75);
  }
  sample(x, y, z) {
    const xx = x * this.xzMul, yy = y * this.yMul, zz = z * this.xzMul;
    let m = this.mainN.sample(xx / this.xzFactor, yy / this.yFactor, zz / this.xzFactor) + 0.5;
    m = m < 0 ? 0 : m > 1 ? 1 : m;
    if (m === 0) return this.minN.sample(xx, yy, zz);
    if (m === 1) return this.maxN.sample(xx, yy, zz);
    const a = this.minN.sample(xx, yy, zz), b = this.maxN.sample(xx, yy, zz);
    return Math.fround(a + Math.fround(m * Math.fround(b - a)));
  }
}

/* Simplex noise and the 2D "Perlin simplex" stack, for the biome
   temperature noises (frozen oceans, snow) that still use them. */
const SG = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
export class Simplex {
  constructor(random) {
    this.xo = random.nextDouble() * 256; this.yo = random.nextDouble() * 256; this.zo = random.nextDouble() * 256;
    const p = this.p = new Int32Array(512);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 0; i < 256; i++) { const j = random.nextInt(256 - i); const t = p[i]; p[i] = p[i + j]; p[i + j] = t; }
  }
  P(i) { return this.p[i & 255]; }
  corner(g, x, y, z, off) {
    let t = off - x * x - y * y - z * z;
    if (t < 0) return 0;
    t *= t;
    const gr = SG[g];
    return t * t * (gr[0] * x + gr[1] * y + gr[2] * z);
  }
  sample2(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const g0 = this.P(ii + this.P(jj)) % 12, g1 = this.P(ii + i1 + this.P(jj + j1)) % 12, g2 = this.P(ii + 1 + this.P(jj + 1)) % 12;
    return 70 * (this.corner(g0, x0, y0, 0, 0.5) + this.corner(g1, x1, y1, 0, 0.5) + this.corner(g2, x2, y2, 0, 0.5));
  }
}
export class PerlinSimplex {
  // octaves: sorted list of octave numbers, e.g. [-2, -1, 0]; random: a LegacyRandom
  constructor(random, octaves) {
    const first = -octaves[0], last = octaves[octaves.length - 1];
    const total = first + last + 1;
    const zero = new Simplex(random);
    const levels = new Array(total).fill(null);
    if (last >= 0 && last < total && octaves.includes(0)) levels[last] = zero;
    for (let i = last + 1; i < total; i++) {
      if (i >= 0 && octaves.includes(last - i)) levels[i] = new Simplex(random);
      else random.consume(262);
    }
    if (last > 0) throw new Error('PerlinSimplex with positive octaves is not needed here');
    this.levels = levels;
    this.inputF = Math.pow(2, last);
    this.valueF = 1 / (Math.pow(2, total) - 1);
  }
  sample(x, y, useOffsets) {
    let v = 0, f = this.inputF, a = this.valueF;
    for (const n of this.levels) {
      if (n) v += n.sample2(x * f + (useOffsets ? n.xo : 0), y * f + (useOffsets ? n.yo : 0)) * a;
      f /= 2; a *= 2;
    }
    return v;
  }
}
