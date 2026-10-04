/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: the random number generators.

   Minecraft (Java Edition) uses two generators for world generation:
   Xoroshiro128++ for almost everything since 1.18, and the old 48-bit
   linear congruential generator of java.util.Random for a few things kept
   for compatibility (carvers, some noises). Both work on Java's 64-bit
   `long`, which JavaScript does not have, so a long is kept here as two
   unsigned 32-bit halves (h, l). The hot paths (positional randoms, which
   run for single blocks) never touch BigInt; seeding does, as it is rare.

   Ported from misode's deepslate (MIT, https://github.com/misode/deepslate,
   Copyright (c) 2021 Misode), rewritten for speed. MD5 after the public
   domain reference algorithm (RFC 1321).
--------------------------------------------------------------------------- */

const M64 = (1n << 64n) - 1n;
export const U64 = v => BigInt.asUintN(64, BigInt(v));
export const S64 = v => BigInt.asIntN(64, BigInt(v));
const hiOf = v => Number((v >> 32n) & 0xffffffffn);
const loOf = v => Number(v & 0xffffffffn);
const toBig = (h, l) => BigInt.asIntN(64, (BigInt(h >>> 0) << 32n) | BigInt(l >>> 0));

/* ---- 64-bit arithmetic on halves; results are left in R ---- */
export const R = { h: 0, l: 0 };
export function mul64(aH, aL, bH, bL) {
  const a0 = aL & 0xffff, a1 = aL >>> 16, a2 = aH & 0xffff, a3 = aH >>> 16;
  const b0 = bL & 0xffff, b1 = bL >>> 16, b2 = bH & 0xffff, b3 = bH >>> 16;
  let t = a0 * b0;
  const r0 = t & 0xffff; let c = Math.floor(t / 65536);
  t = a1 * b0 + a0 * b1 + c;
  const r1 = t & 0xffff; c = Math.floor(t / 65536);
  t = a2 * b0 + a1 * b1 + a0 * b2 + c;
  const r2 = t & 0xffff; c = Math.floor(t / 65536);
  t = a3 * b0 + a2 * b1 + a1 * b2 + a0 * b3 + c;
  const r3 = t & 0xffff;
  R.h = ((r3 << 16) | r2) >>> 0;
  R.l = ((r1 << 16) | r0) >>> 0;
}
export function add64(aH, aL, bH, bL) {
  const l = aL + bL;
  R.h = (aH + bH + (l > 0xffffffff ? 1 : 0)) >>> 0;
  R.l = l >>> 0;
}

/* Mth.getSeed: the long a block position hashes to. The x term is an int
   multiplication (it overflows, as in the game) before it widens. */
export function posSeed(x, y, z) {
  const a = Math.imul(x, 3129871);
  mul64(z < 0 ? 0xffffffff : 0, z >>> 0, 0, 116129781);
  let lH = (R.h ^ (a < 0 ? 0xffffffff : 0) ^ (y < 0 ? 0xffffffff : 0)) >>> 0;
  let lL = (R.l ^ (a >>> 0) ^ (y >>> 0)) >>> 0;
  mul64(lH, lL, lH, lL);
  mul64(R.h, R.l, 0, 42317861);
  const sH = R.h, sL = R.l;
  mul64(lH, lL, 0, 11);
  add64(sH, sL, R.h, R.l);
  // arithmetic shift right by 16
  const h = R.h, l = R.l;
  R.l = ((l >>> 16) | (h << 16)) >>> 0;
  R.h = (h >> 16) >>> 0;
}

/* ================================================================ MD5 == */
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = new Int32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
export function md5(str) {
  const bytes = new TextEncoder().encode(str);
  const n = ((bytes.length + 8) >> 6) + 1;
  const w = new Int32Array(n * 16);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i & 3) * 8);
  w[bytes.length >> 2] |= 0x80 << ((bytes.length & 3) * 8);
  w[n * 16 - 2] = bytes.length * 8;
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let o = 0; o < w.length; o += 16) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const s = MD5_S[(i >> 4) * 4 + (i & 3)];
      const t = (a + f + MD5_K[i] + w[o + g]) | 0;
      a = d; d = c; c = b;
      b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => { for (let k = 0; k < 4; k++) out[i * 4 + k] = (v >>> (k * 8)) & 255; });
  return out;
}
const beLong = (b, o) => (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);

/* ========================================================= Xoroshiro == */
const SILVER = 0x6a09e667f3bcc909n, GOLDEN = U64(-7046029254386353131n);
function mixStafford13(z) {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
  return z ^ (z >> 31n);
}

export class Xoroshiro {
  // the 128-bit state: lo = (a, b), hi = (c, d)
  constructor(a, b, c, d) { this.a = a >>> 0; this.b = b >>> 0; this.c = c >>> 0; this.d = d >>> 0; this.rH = 0; this.rL = 0; }
  static fromSeed(seed) {
    const r = new Xoroshiro(0, 0, 0, 0);
    r.setSeed(seed);
    return r;
  }
  setSeed(seed) {
    const s = U64(seed) ^ SILVER;
    const lo = mixStafford13(s), hi = mixStafford13((s + GOLDEN) & M64);
    this.a = hiOf(lo); this.b = loOf(lo); this.c = hiOf(hi); this.d = loOf(hi);
  }
  next() {
    const loH = this.a, loL = this.b, hiH = this.c, hiL = this.d;
    let sL = loL + hiL;
    const sH = (loH + hiH + (sL > 0xffffffff ? 1 : 0)) >>> 0;
    sL >>>= 0;
    const rH = ((sH << 17) | (sL >>> 15)) >>> 0, rL = ((sL << 17) | (sH >>> 15)) >>> 0;
    const oL = rL + loL;
    this.rH = (rH + loH + (oL > 0xffffffff ? 1 : 0)) >>> 0;
    this.rL = oL >>> 0;
    const h2H = (hiH ^ loH) >>> 0, h2L = (hiL ^ loL) >>> 0;
    const t1H = ((loL << 17) | (loH >>> 15)) >>> 0, t1L = ((loH << 17) | (loL >>> 15)) >>> 0;
    const shH = ((h2H << 21) | (h2L >>> 11)) >>> 0, shL = (h2L << 21) >>> 0;
    this.a = (t1H ^ h2H ^ shH) >>> 0;
    this.b = (t1L ^ h2L ^ shL) >>> 0;
    this.c = ((h2H << 28) | (h2L >>> 4)) >>> 0;
    this.d = ((h2L << 28) | (h2H >>> 4)) >>> 0;
  }
  nextLong() { this.next(); return toBig(this.rH, this.rL); }
  nextInt(bound) {
    this.next();
    if (bound === undefined) return this.rL | 0;
    let l = this.rL;
    let lo = Math.imul(l, bound) >>> 0;
    if (lo < bound) {
      const thr = (((-bound) >>> 0) % bound);
      while (lo < thr) { this.next(); l = this.rL; lo = Math.imul(l, bound) >>> 0; }
    }
    const a = l >>> 16, b = l & 0xffff;
    const u = a * bound + Math.floor(b * bound / 65536);
    return Math.floor(u / 65536);
  }
  nextIntBetween(min, max) { return this.nextInt(max - min + 1) + min; }
  nextFloat() { this.next(); return (this.rH >>> 8) * 5.9604644775390625e-8; }
  nextDouble() { this.next(); return (this.rH * 2097152 + (this.rL >>> 11)) * 1.1102230246251565e-16; }
  nextBoolean() { this.next(); return (this.rL & 1) !== 0; }
  consume(n) { for (let i = 0; i < n; i++) this.next(); }
  forkPositional() {
    this.next(); const a = this.rH, b = this.rL;
    this.next();
    return new XoroshiroPositional(a, b, this.rH, this.rL);
  }
  fork() {
    this.next(); const a = this.rH, b = this.rL;
    this.next();
    return new Xoroshiro(a, b, this.rH, this.rL);
  }
}

export class XoroshiroPositional {
  constructor(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; }
  at(x, y, z) {
    posSeed(x, y, z);
    return new Xoroshiro(R.h ^ this.a, R.l ^ this.b, this.c, this.d);
  }
  // the same, into an existing generator (no allocation, for per-block use)
  atInto(r, x, y, z) {
    posSeed(x, y, z);
    r.a = (R.h ^ this.a) >>> 0; r.b = (R.l ^ this.b) >>> 0; r.c = this.c; r.d = this.d;
    return r;
  }
  fromHashOf(name) {
    const h = md5(name);
    return new Xoroshiro(beLong(h, 0) ^ this.a, beLong(h, 4) ^ this.b, beLong(h, 8) ^ this.c, beLong(h, 12) ^ this.d);
  }
}

/* ================================================== java.util.Random == */
/* The 48-bit state is kept as two 24-bit halves so the multiplication by
   0x5DEECE66D stays exact in doubles. */
const MH = 0x5de, ML = 0xece66d;
export class LegacyRandom {
  constructor(seed) { this.sh = 0; this.sl = 0; if (seed !== undefined) this.setSeed(seed); }
  setSeed(seed) {
    const s = (U64(seed) ^ 0x5deece66dn) & 0xffffffffffffn;
    this.sh = Number(s >> 24n); this.sl = Number(s & 0xffffffn);
  }
  next(bits) {
    const p0 = this.sl * ML + 0xb;
    const nl = p0 % 16777216;
    const c = Math.floor(p0 / 16777216);
    this.sh = (this.sh * ML + this.sl * MH + c) % 16777216;
    this.sl = nl;
    const v = Math.floor((this.sh * 16777216 + this.sl) / Math.pow(2, 48 - bits));
    return bits === 32 ? v | 0 : v;
  }
  nextInt(bound) {
    if (bound === undefined) return this.next(32);
    if ((bound & -bound) === bound) return Math.floor(bound * this.next(31) / 2147483648);
    let bits, val;
    do { bits = this.next(31); val = bits % bound; } while (((bits - val + (bound - 1)) | 0) < 0);
    return val;
  }
  nextIntBetween(min, max) { return this.nextInt(max - min + 1) + min; }
  nextLong() { const h = this.next(32), l = this.next(32); return BigInt.asIntN(64, (BigInt(h) << 32n) + BigInt(l)); }
  nextBoolean() { return this.next(1) !== 0; }
  nextFloat() { return this.next(24) / 16777216; }
  nextDouble() { return (this.next(26) * 134217728 + this.next(27)) * 1.1102230246251565e-16; }
  consume(n) { for (let i = 0; i < n; i++) this.next(1); }
  // WorldgenRandom.setLargeFeatureSeed (carvers)
  setLargeFeatureSeed(seed, x, z) {
    this.setSeed(seed);
    const a = this.nextLong(), b = this.nextLong();
    this.setSeed(BigInt.asIntN(64, (BigInt(x) * a) ^ (BigInt(z) * b) ^ BigInt(seed)));
  }
}

/* WorldgenRandom over Xoroshiro: the decoration and feature seeds. */
export function decorationSeed(r, worldSeed, x, z) {
  r.setSeed(worldSeed);
  const a = r.nextLong() | 1n, b = r.nextLong() | 1n;
  const s = BigInt.asIntN(64, (BigInt(x) * a + BigInt(z) * b) ^ BigInt(worldSeed));
  r.setSeed(s);
  return s;
}
export function featureSeed(r, decoSeed, index, step) {
  r.setSeed(BigInt.asIntN(64, decoSeed + BigInt(index) + BigInt(10000 * step)));
}

/* Seeds as Minecraft reads them: a number that fits a long is that long,
   anything else is the text's String.hashCode, and nothing at all is a
   random 64-bit seed. Returned as a decimal string. */
export function parseSeed(text) {
  const t = String(text == null ? '' : text).trim();
  if (t === '') {
    const a = new Uint32Array(2);
    (globalThis.crypto || { getRandomValues: v => { for (let i = 0; i < v.length; i++) v[i] = Math.random() * 4294967296 >>> 0; return v; } }).getRandomValues(a);
    return toBig(a[0], a[1]).toString();
  }
  if (/^[-+]?\d+$/.test(t)) {
    const v = BigInt(t);
    if (v >= -(1n << 63n) && v < (1n << 63n)) return v.toString();
  }
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return String(h);
}
