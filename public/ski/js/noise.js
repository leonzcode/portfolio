// Small noise kit: 2D simplex (Gustavson's), fbm, ridged noise, and a seeded random.

const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const perm = new Uint8Array(512), grad = new Float32Array(512 * 2);
export function seedNoise(seed = 7) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    const a = perm[i] / 256 * Math.PI * 2;
    grad[i * 2] = Math.cos(a); grad[i * 2 + 1] = Math.sin(a);
  }
}
seedNoise(7);

export function simplex(x, y) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { const g = perm[ii + perm[jj]] * 2; t0 *= t0; n += t0 * t0 * (grad[g] * x0 + grad[g + 1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { const g = perm[ii + i1 + perm[jj + j1]] * 2; t1 *= t1; n += t1 * t1 * (grad[g] * x1 + grad[g + 1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { const g = perm[ii + 1 + perm[jj + 1]] * 2; t2 *= t2; n += t2 * t2 * (grad[g] * x2 + grad[g + 1] * y2); }
  return 70 * n; // about -1..1
}

export function fbm(x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < oct; o++) { s += a * simplex(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}

export function ridged(x, y, oct = 5) {
  let a = 1, f = 1, s = 0, n = 0, w = 1;
  for (let o = 0; o < oct; o++) {
    let r = 1 - Math.abs(simplex(x * f, y * f)); r *= r * w; w = Math.min(1, r * 2);
    s += a * r; n += a; a *= 0.5; f *= 2.1;
  }
  return s / n;
}

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
export const lerp = (a, b, t) => a + (b - a) * t;
// smooth maximum with a blend width k (metres)
export function smax(a, b, k) { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return b + (a - b) * h + k * h * (1 - h); }
