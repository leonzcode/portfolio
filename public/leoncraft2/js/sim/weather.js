/* ---------------------------------------------------------------------------
   Leoncraft 2 - weather, as the game's server runs it (Minecraft Wiki,
   "Weather", Java Edition).

   Two clocks, rain and thunder, each counting down to its next change:
   clear spells of 12 000-180 000 ticks (0.5-7.5 days) and rain of
   12 000-24 000; thunder comes after 12 000-180 000 ticks and lasts
   3 600-15 600, but only storms while it rains. The rain and thunder levels
   ease in and out by 0.01 a tick; it "is raining" above 0.2 and storming
   above 0.9 (thunder level times rain level). Sleeping through the night
   ends the rain.

   Where it falls: rain in biomes warm enough (0.15 and up) that have any,
   snow below that, nothing in deserts, savannas and badlands. One random
   column in sixteen chunks a tick: water at the top freezes where it is
   cold (a source with something not water beside it, block light under 10),
   snow settles on the top block while it snows (one layer: the
   snowAccumulationHeight rule's default), and a cauldron under the sky
   fills with rain (5% a time) or powder snow (10%).

   Lightning, while it storms: one chance in 100 000 a tick in each chunk,
   at the top of a random column it rains on (a lightning rod within 128
   draws it), lighting a fire there and up to four round it, hurting and
   setting alight what stands within 3, and changing creepers, pigs and
   villagers through window.__lc2.entities.lightning if the mobs are in.

   Rain and snow are drawn round the player by sim/weatherfx.js; the sky
   and the light dim through render/vanilla.js (Fast) and the cloud cover
   (Detailed).
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { CH, LEVEL, FALLING } from '../world-const.js?v=107';
import { WeatherFX } from './weatherfx.js?v=107';

const between = (r, a, b) => a + Math.floor(r() * (b - a + 1));

export class Weather {
  constructor(sim) {
    this.sim = sim;
    this.clearTime = 0; this.rainTime = 0; this.thunderTime = 0;
    this.rainingFlag = false; this.thunderingFlag = false;
    this.rainLevel = 0; this.thunderLevel = 0;
    this.snowHeight = 1;            // the snowAccumulationHeight game rule
    this.cycle = true;              // doWeatherCycle
    this.bolts = [];
    this.fx = sim.renderer ? new WeatherFX(sim, this) : null;
  }
  dispose() { if (this.fx) this.fx.dispose(); }
  // levels as the rules read them
  get rain() { return this.rainLevel; }
  get thunder() { return this.thunderLevel * this.rainLevel; }
  get raining() { return this.rainLevel > 0.2; }
  get thundering() { return this.thunder > 0.9; }

  /* ---- the cycle ---- */
  tick() {
    const r = this.sim.rng;
    if (this.cycle) {
      if (this.clearTime > 0) {
        this.clearTime--;
        this.thunderTime = this.thunderingFlag ? 0 : 1;
        this.rainTime = this.rainingFlag ? 0 : 1;
        this.thunderingFlag = false; this.rainingFlag = false;
      } else {
        if (this.thunderTime > 0) { if (--this.thunderTime === 0) this.thunderingFlag = !this.thunderingFlag; }
        else this.thunderTime = this.thunderingFlag ? between(r, 3600, 15600) : between(r, 12000, 180000);
        if (this.rainTime > 0) { if (--this.rainTime === 0) this.rainingFlag = !this.rainingFlag; }
        else this.rainTime = this.rainingFlag ? between(r, 12000, 24000) : between(r, 12000, 180000);
      }
    }
    this.rainLevel = Math.max(0, Math.min(1, this.rainLevel + (this.rainingFlag ? 0.01 : -0.01)));
    this.thunderLevel = Math.max(0, Math.min(1, this.thunderLevel + (this.thunderingFlag ? 0.01 : -0.01)));
    // what the renderer reads (render/vanilla.js, sim/weatherfx.js)
    if (this.sim.renderer) this.sim.renderer.weatherState = { rain: this.rain, thunder: this.thunder, flash: this.flash || 0 };
    if (this.flash > 0) this.flash = Math.max(0, this.flash - 1);
  }
  // the /weather command: clear, rain or thunder for a while
  set(kind, ticks) {
    if (kind === 'clear') { this.clearTime = ticks || between(this.sim.rng, 12000, 180000); this.rainTime = 0; this.thunderTime = 0; this.rainingFlag = false; this.thunderingFlag = false; }
    else { this.clearTime = 0; this.rainTime = ticks || between(this.sim.rng, 12000, 24000); this.rainingFlag = true;
      this.thunderTime = kind === 'thunder' ? this.rainTime : between(this.sim.rng, 12000, 180000); this.thunderingFlag = kind === 'thunder'; }
  }
  // sleeping through the night ends the rain (the game's resetWeatherCycle)
  clearBySleep() { this.rainTime = 0; this.rainingFlag = false; this.thunderTime = 0; this.thunderingFlag = false; }
  now(level) { this.rainLevel = level ? 1 : 0; this.thunderLevel = level && this.thunderingFlag ? 1 : 0; }

  /* ---- where it falls ---- */
  // 'rain', 'snow' or null at a block
  precipAt(x, y, z) {
    const b = this.sim.biomeAt(x, z);
    if (!(b.rain > 0)) return null;
    return this.sim.tempAt(x, y, z) < 0.15 ? 'snow' : 'rain';
  }
  rainingAt(x, y, z) {
    if (!this.raining) return false;
    if (this.sim.dimension() !== 'overworld') return false;
    if (this.sim.topAt(x, z) >= y) return false;
    return this.precipAt(x, y, z) === 'rain';
  }

  /* ---- each tick: freezing, snow, cauldrons, lightning ---- */
  precipitation() {
    const sim = this.sim, w = sim.w, r = sim.rng;
    if (sim.dimension() !== 'overworld') return;
    const p = sim.player.pos, pcx = Math.floor(p.x / CH), pcz = Math.floor(p.z / CH), R = sim.simDist;
    const storm = this.raining && this.thundering;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R) continue;
      const c = w.chunkXZ(pcx + dx, pcz + dz);
      if (!c || (sim.skip && sim.skip(c))) continue;
      if (storm && Math.floor(r() * 100000) === 0) this.strikeIn(c);
      if (Math.floor(r() * 16) !== 0) continue;
      const x = c.cx * CH + Math.floor(r() * 16), z = c.cz * CH + Math.floor(r() * 16);
      const top = sim.topAt(x, z);
      if (top < 0) continue;
      const y = top + 1;                    // the air on top
      this.freeze(x, top, z);
      if (!this.raining) continue;
      const kind = this.precipAt(x, y, z);
      if (kind === 'snow') this.settle(x, y, z);
      if (kind) {
        const below = w.get(x, top, z), n = below ? BLOCKS[below].name : '';
        if (n === 'cauldron') {
          if (kind === 'rain' ? r() < 0.05 : r() < 0.1) {
            const into = kind === 'rain' ? B.water_cauldron : B.powder_snow_cauldron;
            if (into !== undefined) sim.set(x, top, z, into, 1);
          }
        } else if ((n === 'water_cauldron' || n === 'powder_snow_cauldron') && (kind === 'rain') === (n === 'water_cauldron')) {
          const lv = w.meta(x, top, z) & 3;
          if (lv < 3 && r() < (kind === 'rain' ? 0.05 : 0.1)) sim.set(x, top, z, below, lv + 1);
        }
      }
    }
  }
  freeze(x, y, z) {
    const sim = this.sim, w = sim.w;
    if (!sim.coldAt(x, y, z)) return;
    const b = w.get(x, y, z);
    if (FLUID[b] !== 1 || (w.meta(x, y, z) & (LEVEL | FALLING))) return;
    if (sim.blockLight(x, y + 1, z) >= 10) return;
    let edge = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (FLUID[w.get(x + dx, y, z + dz)] !== 1) edge = true;
    if (!edge) return;
    sim.set(x, y, z, B.ice, 0);
  }
  settle(x, y, z) {
    const sim = this.sim, w = sim.w;
    if (this.snowHeight <= 0 || !sim.coldAt(x, y, z) || sim.blockLight(x, y, z) >= 10) return;
    const here = w.get(x, y, z);
    if (here === B.snow) {
      const layers = (w.meta(x, y, z) & 7) + 1;
      if (layers < this.snowHeight) sim.set(x, y, z, B.snow, layers);
      return;
    }
    if (here) return;
    const below = w.get(x, y - 1, z);
    if (!below) return;
    const d = BLOCKS[below];
    if (!(d.solid && d.shape === 'cube' || d.leaves) || below === B.ice || below === B.packed_ice || below === B.barrier) return;
    sim.set(x, y, z, B.snow, 0);
  }

  /* ---- lightning ---- */
  strikeIn(c) {
    const sim = this.sim, r = sim.rng;
    let x = c.cx * CH + Math.floor(r() * 16), z = c.cz * CH + Math.floor(r() * 16);
    let top = sim.topAt(x, z) + 1;
    // a lightning rod within 128 blocks takes it
    const rod = this.findRod(x, top, z);
    if (rod) { [x, top, z] = rod; top += 1; }
    else {
      // the player, if under the open sky nearby (the game aims at living things in the column's area)
      const p = sim.player.pos;
      if (Math.abs(p.x - x) < 16 && Math.abs(p.z - z) < 16 && sim.canSeeSky(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)) && r() < 0.5) {
        x = Math.floor(p.x); z = Math.floor(p.z); top = sim.topAt(x, z) + 1;
      }
    }
    if (!rod && !this.rainingAt(x, top, z)) return;
    this.strike(x, top, z);
  }
  findRod(x, y, z) {
    if (B.lightning_rod === undefined) return null;
    const rods = this.sim.rods;
    if (!rods) return null;
    let best = null, bd = 128 * 128;
    for (const k of rods) {
      const [rx, ry, rz] = k.split(',').map(Number);
      if (this.sim.get(rx, ry, rz) !== B.lightning_rod) { rods.delete(k); continue; }
      const d = (rx - x) ** 2 + (rz - z) ** 2;
      if (d < bd && this.sim.canSeeSky(rx, ry, rz)) { bd = d; best = [rx, ry, rz]; }
    }
    return best;
  }
  // a bolt at the top of a column (x, y the air it lands in, z)
  strike(x, y, z) {
    const sim = this.sim, r = sim.rng;
    this.flash = 2;
    if (this.fx) this.fx.bolt(x + 0.5, y, z + 0.5);
    // fire where it lands, and up to four times round it (Normal difficulty and up)
    if ((sim.difficulty === undefined ? 2 : sim.difficulty) >= 2 && sim.lightFire) {
      if (!sim.get(x, y, z)) sim.lightFire(x, y, z, 0);
      for (let i = 0; i < 4; i++) {
        const fx = x + Math.floor(r() * 3) - 1, fy = y + Math.floor(r() * 3) - 1, fz = z + Math.floor(r() * 3) - 1;
        if (!sim.get(fx, fy, fz)) sim.lightFire(fx, fy, fz, 0);
      }
    }
    // a lightning rod lights up and gives a signal (redstone.js)
    if (sim.redstone && sim.redstone.pulseRod) sim.redstone.pulseRod(x, y - 1, z);
    // what stands within 3 blocks: 5 damage and set alight
    const L = window.__lc2, p = sim.player.pos;
    if ((p.x - x - 0.5) ** 2 + (p.z - z - 0.5) ** 2 < 9 && Math.abs(p.y - y) < 6) {
      const g = sim.game;
      if (g && g.mode !== 'creative' && g.survival) { if (g.survival.struckByLightning) g.survival.struckByLightning(); else g.survival.hurt(5, 'lightning_bolt'); }
    }
    if (L && L.entities && typeof L.entities.lightning === 'function') L.entities.lightning(x + 0.5, y, z + 0.5);
    if (sim.onLightning) sim.onLightning(x, y, z);
  }

  toJSON() { return { c: this.clearTime, r: this.rainTime, t: this.thunderTime, rf: this.rainingFlag, tf: this.thunderingFlag, rl: this.rainLevel, tl: this.thunderLevel }; }
  fromJSON(o) {
    if (!o) return;
    this.clearTime = o.c || 0; this.rainTime = o.r || 0; this.thunderTime = o.t || 0;
    this.rainingFlag = !!o.rf; this.thunderingFlag = !!o.tf; this.rainLevel = o.rl || 0; this.thunderLevel = o.tl || 0;
  }
}
