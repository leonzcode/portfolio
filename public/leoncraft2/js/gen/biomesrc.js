/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: which biome goes where.

   The overworld picks a biome every 4 x 4 x 4 blocks (a "quart" cell) from
   six climate values (temperature, humidity, continentalness, erosion,
   depth, weirdness): the biome table lists a box in that 6D space for each
   biome, and the closest box wins. The game quantises everything to
   integers (value * 10000, in float) and searches an R-tree; ties go to the
   last answer found, which is kept here the same way.

   A block's biome then comes from the eight cells around it, each nudged
   by a hash of the world seed (the "zoom" with its ragged edges).

   R-tree after misode's deepslate (MIT, https://github.com/misode/deepslate,
   Copyright (c) 2021 Misode); the zoom after Cubitect's cubiomes (MIT,
   https://github.com/Cubitect/cubiomes). SHA-256 after FIPS 180-4.
--------------------------------------------------------------------------- */
import { R, mul64, add64 } from './random.js';

const F = Math.fround;
export const quantize = v => Math.trunc(F(F(v) * 10000));
const D = 7;

/* ============================================================= R-tree == */
class Leaf {
  constructor(space, value) { this.space = space; this.value = value; this.leaf = true; }
}
class Sub {
  constructor(children) {
    this.children = children;
    const s = new Float64Array(D * 2);
    for (let i = 0; i < D; i++) { s[i * 2] = Infinity; s[i * 2 + 1] = -Infinity; }
    for (const c of children) for (let i = 0; i < D; i++) {
      if (c.space[i * 2] < s[i * 2]) s[i * 2] = c.space[i * 2];
      if (c.space[i * 2 + 1] > s[i * 2 + 1]) s[i * 2 + 1] = c.space[i * 2 + 1];
    }
    this.space = s;
    this.leaf = false;
  }
}
const mid = (s, i) => Math.trunc((s[i * 2] + s[i * 2 + 1]) / 2);       // long division
function sortBy(nodes, i, abs) {
  return nodes.map(n => ({ k: abs ? Math.abs(mid(n.space, i)) : mid(n.space, i), n }))
    .sort((a, b) => a.k - b.k).map(e => e.n);
}
function bucketize(nodes) {
  const out = [];
  let cur = [];
  const n = Math.pow(10, Math.floor(Math.log(nodes.length - 0.01) / Math.log(10)));
  for (const node of nodes) {
    cur.push(node);
    if (cur.length < n) continue;
    out.push(new Sub(cur));
    cur = [];
  }
  if (cur.length) out.push(new Sub(cur));
  return out;
}
function area(s) { let f = 0; for (let i = 0; i < D; i++) f += Math.abs(s[i * 2 + 1] - s[i * 2]); return f; }
function build(nodes) {
  if (nodes.length === 1) return nodes[0];
  if (nodes.length <= 10) {
    const keyed = nodes.map(n => { let k = 0; for (let i = 0; i < D; i++) k += Math.abs(mid(n.space, i)); return { k, n }; });
    keyed.sort((a, b) => a.k - b.k);
    return new Sub(keyed.map(e => e.n));
  }
  let best = Infinity, dim = -1;
  for (let i = 0; i < D; i++) {
    const b = bucketize(sortBy(nodes, i, false));
    let f = 0;
    for (const s of b) f += area(s.space);
    if (!(best > f)) continue;
    best = f; dim = i;
  }
  let res = bucketize(sortBy(nodes, dim, false));
  res = sortBy(res, dim, true);
  return new Sub(res.map(s => build(s.children)));
}
function dist(space, v) {
  let r = 0;
  for (let i = 0; i < D; i++) {
    const lo = space[i * 2], hi = space[i * 2 + 1], x = v[i];
    const a = x - hi, b = lo - x;
    const d = a > 0 ? a : b > 0 ? b : 0;
    r += d * d;
  }
  return r;
}
function search(node, v, closest) {
  if (node.leaf) return node;
  let l = closest ? dist(closest.space, v) : Infinity;
  let leaf = closest;
  for (const c of node.children) {
    const m = dist(c.space, v);
    if (l <= m) continue;
    const l2 = search(c, v, leaf);
    const n = c === l2 ? m : dist(l2.space, v);
    if (l <= n) continue;
    l = n; leaf = l2;
    if (n === 0) return leaf;
  }
  return leaf;
}

export class BiomeTable {
  constructor(bp, biomeIds) {
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const dec = c => alpha.indexOf(c);
    const vals = bp.values;
    const leaves = [];
    for (let o = 0; o < bp.entries.length; o += bp.width) {
      const e = bp.entries.substr(o, bp.width);
      const name = bp.names[dec(e[0])];
      const s = new Float64Array(D * 2);
      for (let i = 0; i < 6; i++) { s[i * 2] = quantize(vals[dec(e[1 + i * 2])]); s[i * 2 + 1] = quantize(vals[dec(e[2 + i * 2])]); }
      const off = quantize(vals[dec(e[13])]);
      s[12] = off; s[13] = off;
      leaves.push(new Leaf(s, biomeIds(name)));
    }
    this.root = build(leaves);
    this.last = null;
    this.v = new Float64Array(D);
  }
  find(t, h, c, e, d, w) {
    const v = this.v;
    v[0] = t; v[1] = h; v[2] = c; v[3] = e; v[4] = d; v[5] = w; v[6] = 0;
    const leaf = search(this.root, v, this.last);
    this.last = leaf;
    return leaf.value;
  }
}

/* ============================================================ SHA-256 == */
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
function sha256(bytes) {
  const n = ((bytes.length + 8) >> 6) + 1;
  const w = new Uint32Array(n * 16);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  w[bytes.length >> 2] |= 0x80 << (24 - (bytes.length & 3) * 8);
  w[n * 16 - 1] = bytes.length * 8;
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rr = (x, s) => (x >>> s) | (x << (32 - s));
  for (let o = 0; o < w.length; o += 16) {
    for (let i = 0; i < 16; i++) W[i] = w[o + i];
    for (let i = 16; i < 64; i++) {
      const s0 = rr(W[i - 15], 7) ^ rr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rr(W[i - 2], 17) ^ rr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) >>> 0;
      const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) for (let k = 0; k < 4; k++) out[i * 4 + k] = (H[i] >>> (24 - k * 8)) & 255;
  return out;
}

/* BiomeManager.obfuscateSeed: SHA-256 of the seed's eight bytes (little
   endian), the first eight bytes of the hash read back little endian. */
export function zoomSeed(seed) {
  const s = BigInt.asUintN(64, BigInt(seed));
  const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) b[i] = Number((s >> BigInt(i * 8)) & 255n);
  const h = sha256(b);
  let lo = 0, hi = 0;
  for (let i = 3; i >= 0; i--) lo = (lo * 256 + h[i]);
  for (let i = 7; i >= 4; i--) hi = (hi * 256 + h[i]);
  return { h: hi >>> 0, l: lo >>> 0 };
}

/* ---- the zoom ---- */
// LinearCongruentialGenerator.next(l, m) = l * (l * 6364136223846793005 + 1442695040888963407) + m
const AH = 0x5851f42d, AL = 0x4c957f2d, CH = 0x14057b7e, CL = 0xf767814f;
function lcg(h, l, mH, mL) {
  mul64(h, l, AH, AL);
  add64(R.h, R.l, CH, CL);
  mul64(h, l, R.h, R.l);
  add64(R.h, R.l, mH, mL);
}
const sx = v => (v < 0 ? 0xffffffff : 0);
function fiddle(h, l) {
  // floorMod(l >> 24, 1024) / 1024: bits 24..33 of the long
  const v = ((l >>> 24) | ((h & 0x3) << 8)) & 1023;
  return (v / 1024 - 0.5) * 0.9;
}

export class Zoom {
  constructor(seed) {
    this.s = zoomSeed(seed);
    this.cache = new Map();
  }
  // the three nudges of a cell corner
  nudge(q, r, s) {
    const key = (q & 0x3ff) | ((r & 0x3ff) << 10) | ((s & 0x3ff) << 20);
    let e = this.cache.get(key);
    if (e && e[3] === q && e[4] === r && e[5] === s) return e;
    if (this.cache.size > 100000) this.cache.clear();
    const S = this.s;
    lcg(S.h, S.l, sx(q), q >>> 0);
    lcg(R.h, R.l, sx(r), r >>> 0);
    lcg(R.h, R.l, sx(s), s >>> 0);
    lcg(R.h, R.l, sx(q), q >>> 0);
    lcg(R.h, R.l, sx(r), r >>> 0);
    lcg(R.h, R.l, sx(s), s >>> 0);
    const d = fiddle(R.h, R.l);
    lcg(R.h, R.l, S.h, S.l);
    const ee = fiddle(R.h, R.l);
    lcg(R.h, R.l, S.h, S.l);
    const f = fiddle(R.h, R.l);
    e = [d, ee, f, q, r, s];
    this.cache.set(key, e);
    return e;
  }
  // which quart cell a block takes its biome from: returns [qx, qy, qz]
  cell(x, y, z, out) {
    const i = x - 2, j = y - 2, k = z - 2;
    const l = i >> 2, m = j >> 2, n = k >> 2;
    const d = (i & 3) / 4, e = (j & 3) / 4, f = (k & 3) / 4;
    let o = 0, g = Infinity;
    for (let p = 0; p < 8; p++) {
      const b1 = (p & 4) === 0, b2 = (p & 2) === 0, b3 = (p & 1) === 0;
      const q = b1 ? l : l + 1, r = b2 ? m : m + 1, s = b3 ? n : n + 1;
      const h = b1 ? d : d - 1, t = b2 ? e : e - 1, u = b3 ? f : f - 1;
      const N = this.nudge(q, r, s);
      const v = (u + N[2]) * (u + N[2]) + (t + N[1]) * (t + N[1]) + (h + N[0]) * (h + N[0]);
      if (!(g > v)) continue;
      o = p; g = v;
    }
    out[0] = (o & 4) === 0 ? l : l + 1;
    out[1] = (o & 2) === 0 ? m : m + 1;
    out[2] = (o & 1) === 0 ? n : n + 1;
    return out;
  }
}
