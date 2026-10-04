/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: Java's random numbers, exactly.

   Where a structure goes, and how its rooms join up, comes from
   java.util.Random (Minecraft's "legacy" random source) seeded from the
   world seed and the chunk. To land structures where the real game puts
   them, every call has to give the same number the JVM would.

   The 48-bit state is kept as two 24-bit halves, so the multiply by
   0x5DEECE66D stays exact in doubles. The 64-bit seed sums (the region and
   chunk seeds) are done in BigInt, which is slow, but they run once per
   structure, not once per block.
--------------------------------------------------------------------------- */
const MH = 0x5de, ML = 0xece66d;
const P24 = 16777216;

// a seed as Java holds it: a 64-bit long, from a BigInt, a number, or text
export function toLong(seed) {
  if (typeof seed === 'bigint') return BigInt.asIntN(64, seed);
  if (typeof seed === 'number') return BigInt.asIntN(64, BigInt(Math.trunc(seed)));
  const t = String(seed == null ? '' : seed).trim();
  if (/^[-+]?\d+$/.test(t)) return BigInt.asIntN(64, BigInt(t));
  // the game's String.hashCode for a seed typed as words
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return BigInt(h);
}

export class JRand {
  constructor(seed) { this.h = 0; this.l = 0; if (seed !== undefined) this.setSeed(seed); }
  setSeed(seed) {
    const s = (BigInt.asUintN(64, BigInt(seed)) ^ 0x5deece66dn) & 0xffffffffffffn;
    this.h = Number(s >> 24n); this.l = Number(s & 0xffffffn);
    return this;
  }
  next(bits) {
    const p = this.l * ML + 0xb;
    const nl = p % P24;
    this.h = (this.h * ML + this.l * MH + Math.floor(p / P24)) % P24;
    this.l = nl;
    const v = Math.floor((this.h * P24 + this.l) / Math.pow(2, 48 - bits));
    return bits === 32 ? v | 0 : v;
  }
  nextInt(bound) {
    if (bound === undefined) return this.next(32);
    if (bound <= 0) throw new Error('bound must be positive');
    if ((bound & -bound) === bound) return Math.floor(bound * this.next(31) / 2147483648);
    let bits, val;
    do { bits = this.next(31); val = bits % bound; } while (((bits - val + (bound - 1)) | 0) < 0);
    return val;
  }
  // Mth.nextInt / randomBetweenInclusive
  between(min, max) { return min >= max ? min : this.nextInt(max - min + 1) + min; }
  nextLong() { const hi = this.next(32), lo = this.next(32); return BigInt.asIntN(64, (BigInt(hi) << 32n) + BigInt(lo)); }
  nextBoolean() { return this.next(1) !== 0; }
  nextFloat() { return this.next(24) / P24; }
  nextDouble() { return (this.next(26) * 134217728 + this.next(27)) * 1.1102230246251565e-16; }
  // LegacyRandomSource.fork(): a new random seeded from this one's next long
  fork() { return new JRand(this.nextLong()); }
  pick(list) { return list[this.nextInt(list.length)]; }
}

/* WorldgenRandom's seeds, with the legacy source underneath. */
const featureCache = new Map();
function largeFeatureMul(seed) {
  let v = featureCache.get(seed);
  if (!v) {
    const r = new JRand(seed);
    v = [r.nextLong(), r.nextLong()];
    if (featureCache.size > 16) featureCache.clear();
    featureCache.set(seed, v);
  }
  return v;
}
// the random a structure is built with, per start chunk
export function largeFeature(r, seed, cx, cz) {
  const [a, b] = largeFeatureMul(seed);
  return r.setSeed(BigInt.asIntN(64, (BigInt(cx) * a) ^ (BigInt(cz) * b) ^ seed));
}
// the random that picks a structure's spot inside its region
export function largeFeatureWithSalt(r, seed, rx, rz, salt) {
  return r.setSeed(BigInt.asIntN(64, BigInt(rx) * 341873128712n + BigInt(rz) * 132897987541n + seed + BigInt(salt)));
}

// a quick, well-mixed 32-bit hash for things that only need to look random (bricks, eyes, loot)
export function hash32(...v) {
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) {
    h = Math.imul(h ^ (v[i] | 0), 0x01000193);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  }
  return h >>> 0;
}
