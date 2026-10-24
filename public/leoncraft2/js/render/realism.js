/* ---------------------------------------------------------------------------
   Leoncraft 2 - RIP Computer's realism, the parts that run on the page each
   frame (the shader side is in glsl.js WIND, interaction.js, materials.js
   REALISM, debris.js). Off at every other level (opts.realism, looks.js).

     walkers   everyone walking near: you, other players (net/players.js)
               and mobs (entities/manager.js) hand in their feet each frame
               with walkers.add(); the nearest eight part the plants round
               their legs (uPush) and press the grass flat where they tread
               (the interaction map's uSteps), which springs back up behind
     wind      Photon's wind (glsl.js photonWind), stronger in rain
     wet       the ground getting wet in rain and drying after (uWet, for the
               puddles), only where the biome has rain
     blasts    an explosion's flash lighting what is round it (uFlash, a
               warm light through glsl.js heldLight), lingering smoke, and
               every block it took away burst into pieces (debris.js): the
               blocks removed near a blast just before or after it, from any
               page (world.js WORLD_FX hears each block that goes, so a blast
               on another player's machine, whose changes and boom come here
               in either order, looks the same)
--------------------------------------------------------------------------- */
import { WORLD_FX } from '../world.js?v=107';
import { FLUID } from '../blocks.js?v=107';
const THREE = window.THREE;

// everyone walking near this frame: x, y (feet), z, width over a player's, on the ground (1/0)
export const walkers = {
  buf: new Float32Array(64 * 5), n: 0,
  add(x, y, z, w, ground) {
    if (this.n >= 64) return;
    const o = this.n++ * 5;
    this.buf[o] = x; this.buf[o + 1] = y; this.buf[o + 2] = z; this.buf[o + 3] = w; this.buf[o + 4] = ground ? 1 : 0;
  },
};

const BLAST_MS = 1500;          // a block gone this long before or after a blast near it was blown away by it

export class Realism {
  constructor(R) {
    this.R = R;
    this.wet = 0;
    this.flash = null;           // { x, y, z, power, t }
    this.blasts = [];            // { x, y, z, power, t }
    this.gone = [];              // blocks taken away lately: [x, y, z, b, t]
    this.steps = [];             // the trample map's walkers ([x, z, strength, radius])
    this.order = new Int32Array(64);
    const U = R.U;
    U.uPush = { value: Array.from({ length: 8 }, () => new THREE.Vector4()) };
    U.uRealWind = { value: 0 };
    U.uGust = { value: U.uNoise.value };
    U.uFlash = { value: new THREE.Vector4() };
    U.uRain = { value: 0 };
    WORLD_FX.gone = (w, x, y, z, was, now) => this.blockGone(w, x, y, z, was, now);
    WORLD_FX.blast = (x, y, z, power) => this.blast(x, y, z, power);
  }
  get on() { return !!(this.R.opts && this.R.opts.realism) && !this.R.vanilla; }

  /* ---- each frame, before the world is drawn ---- */
  frame(state, dt) {
    const U = this.R.U, on = this.on, W = walkers;
    const wx = this.R.weatherState || {}, rain = on ? Math.min(1, wx.rain || 0) : 0;
    // wet: rises over a quarter of a minute of rain, dries over a minute and a half; only where it rains
    const bio = state.biome, rains = !!bio && !bio.snowy && bio.rain > 0 && !(state.dim && state.dim.sky !== 'normal');
    const want = rains ? rain : 0;
    if (this.R.wetNow !== undefined) { this.wet = this.R.wetNow; delete this.R.wetNow; }
    this.wet += (want - this.wet) * Math.min(1, dt / (want > this.wet ? 15 : 90));
    if (!on) this.wet = 0;
    U.uWet.value = this.wet;
    U.uRain.value = rains ? rain : 0;
    // Photon's windiness: 0.5 plus a third of the wetness, and the wind stronger in rain
    U.uRealWind.value = on ? (1 + 2.64 * rain) * (0.5 + Math.min(1, 0.5 + 0.33 * this.wet)) : 0;
    // the walkers: you first, then the nearest others
    const P = U.uPush.value, S = this.steps;
    S.length = 0;
    for (const v of P) v.set(0, 0, 0, 0);
    if (on) {
      const f = state.feet;
      P[0].set(f.x, f.y + 0.45, f.z, 1);
      let k = 0;
      const B = W.buf, order = this.order;
      for (let i = 0; i < W.n; i++) {
        const o = i * 5, dx = B[o] - f.x, dy = B[o + 1] - f.y, dz = B[o + 2] - f.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 28 * 28 || d2 < 0.01) continue;
        order[k++] = i;
      }
      const d2 = i => { const o = i * 5, dx = B[o] - f.x, dz = B[o + 2] - f.z; return dx * dx + dz * dz; };
      const idx = Array.from(order.subarray(0, k)).sort((a, b) => d2(a) - d2(b));
      for (let j = 0; j < idx.length && j < 7; j++) {
        const o = idx[j] * 5, w = B[o + 3];
        P[j + 1].set(B[o], B[o + 1] + 0.45 * Math.min(1.5, w), B[o + 2], w);
        if (B[o + 4]) S.push([B[o], B[o + 2], 1, 0.55 * w]);
      }
    }
    W.n = 0;
    // an explosion's flash: a warm light at once, gone over a third of a second
    const F = U.uFlash.value, fl = this.flash;
    if (on && fl) {
      const t = (performance.now() - fl.t) / 1000;
      const k = Math.exp(-t / 0.11);
      if (k < 0.02) { this.flash = null; F.set(0, 0, 0, 0); }
      else F.set(fl.x, fl.y, fl.z, (15 + fl.power * 3) * k);
    } else F.set(0, 0, 0, 0);
  }

  /* ---- explosions ---- */
  // a blast at (x, y, z) of this power, on this page or another's
  blast(x, y, z, power) {
    if (!this.on) return;
    const now = performance.now();
    this.flash = { x, y, z, power: power || 4, t: now };
    this.blasts.push({ x, y, z, power: power || 4, t: now });
    while (this.blasts.length > 8) this.blasts.shift();
    // a fireball, and smoke hanging over it for a few seconds (smoke.js)
    const D = this.R.particles && this.R.particles.debris;
    if (D) D.smoke.blast(x, y, z, power || 4);
    // the blocks already gone (another page's changes came first)
    const r = (power || 4) * 2 + 1.5, G = this.gone;
    let n = 0;
    for (const g of G) if (now - g[4] < BLAST_MS && (g[0] + 0.5 - x) ** 2 + (g[1] + 0.5 - y) ** 2 + (g[2] + 0.5 - z) ** 2 < r * r) n++;
    const each = this.piecesEach(n);
    for (let i = G.length - 1; i >= 0; i--) {
      const g = G[i];
      if (now - g[4] >= BLAST_MS || (g[0] + 0.5 - x) ** 2 + (g[1] + 0.5 - y) ** 2 + (g[2] + 0.5 - z) ** 2 >= r * r) continue;
      this.burst(g, x, y, z, power, each);
      G.splice(i, 1);
    }
  }
  // how many pieces a block makes, so a big blast stays within what is drawn
  piecesEach(n) { return Math.max(2, Math.min(8, Math.round(700 / Math.max(1, n)))); }
  burst(g, x, y, z, power, each) {
    const D = this.R.particles && this.R.particles.debris;
    if (D) D.burst(g[0], g[1], g[2], g[3], x, y, z, power || 4, each);
  }
  // world.js: a block went (was: what it was, now: what is there now)
  blockGone(w, x, y, z, was, now) {
    if (!this.on || !was || (now && !FLUID[now]) || FLUID[was]) return;
    const D = this.R.particles && this.R.particles.debris;
    if (!D || D.world !== w) return;
    const t = performance.now();
    for (const bl of this.blasts) {
      const r = bl.power * 2 + 1.5;
      if (t - bl.t < BLAST_MS && (x + 0.5 - bl.x) ** 2 + (y + 0.5 - bl.y) ** 2 + (z + 0.5 - bl.z) ** 2 < r * r) {
        // (counted as they come: a blast takes at most a few hundred blocks)
        bl.n = (bl.n || 0) + 1;
        this.burst([x, y, z, was], bl.x, bl.y, bl.z, bl.power, this.piecesEach(Math.max(bl.n, bl.power * 12)));
        return;
      }
    }
    const G = this.gone;
    G.push([x, y, z, was, t]);
    if (G.length > 400) G.splice(0, G.length - 300);
  }
}
