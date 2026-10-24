/* ---------------------------------------------------------------------------
   Leoncraft 2 - "blended" 3D noise, the kind the Nether's and the End's
   terrain is made of (the game's "old blended noise", described on the
   Minecraft Wiki's noise settings pages): two low-frequency noises of many
   octaves give the lowest and highest the ground can be, and a third,
   quicker one picks between them, so the land comes out in big rounded
   shapes with sudden walls where the picker flips. The numbers in the
   settings (xz and y scale, xz and y factor) are the game's; the noises
   themselves are ours (js/noise.js), so a seed does not give the game's
   terrain, only terrain shaped the same way.
--------------------------------------------------------------------------- */
import { Octaves, rng, mix32, hashStr } from '../noise.js?v=107';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class BlendedNoise {
  constructor(seed, name, xzScale, yScale, xzFactor, yFactor) {
    const r = rng(mix32(seed ^ hashStr(name)));
    // sixteen octaves, the lowest about 190 blocks across; the top six weigh under a thousandth and are left out
    const amps = new Array(16).fill(1).map((a, i) => (i < 11 ? 1 : 0));
    this.lo = new Octaves(r, -15, amps);
    this.hi = new Octaves(r, -15, amps);
    this.main = new Octaves(r, -7, [1, 1, 1, 1, 1, 1, 1, 1]);
    this.xz = 684.412 * xzScale; this.y = 684.412 * yScale;
    this.xzf = xzFactor; this.yf = yFactor;
  }
  sample(x, y, z) {
    const X = x * this.xz, Y = y * this.y, Z = z * this.xz;
    // the picker: about 255 times the normalised sum in the game's own units, over 10, halved and offset
    const m = this.main.sample(X / this.xzf, Y / this.yf, Z / this.xzf);
    const t = clamp(12.75 * m + 0.5, 0, 1);
    if (t <= 0) return this.lo.sample(X, Y, Z);
    if (t >= 1) return this.hi.sample(X, Y, Z);
    const a = this.lo.sample(X, Y, Z), b = this.hi.sample(X, Y, Z);
    return a + (b - a) * t;
  }
}

// the game's y_clamped_gradient: from one value at fromY to another at toY
export function yGradient(y, fromY, toY, fromV, toV) {
  const t = clamp((y - fromY) / (toY - fromY), 0, 1);
  return fromV + (toV - fromV) * t;
}
// and its squeeze: clamp to -1..1, then x/2 - x^3/24
export function squeeze(d) { const c = clamp(d, -1, 1); return c / 2 - c * c * c / 24; }
