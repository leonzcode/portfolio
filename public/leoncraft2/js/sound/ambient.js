/* ---------------------------------------------------------------------------
   Leoncraft 2 - the world's own sounds, once a tick, as the game makes them.

   Blocks that make noise by themselves (the game's animateTick): each tick
   667 random blocks within 16 of the camera and 667 within 32 (spread the
   game's way, two random numbers taken from each other, so most land close)
   get a chance to sound:
     fire              1 in 24   block.fire.ambient      1-2, 0.3-1
     lava under air    1 in 100  block.lava.pop          0.2-0.4, 0.9-1.05
                       1 in 200  block.lava.ambient      0.2-0.4, 0.9-1.05
     flowing water     1 in 64   block.water.ambient     0.75-1, 0.5-1.5
     nether portal     1 in 100  block.portal.ambient    0.5, 0.8-1.2
     campfire          1 in 10   block.campfire.crackle  0.5-1.5, 0.6-1.3
   and a lit furnace, smoker or blast furnace crackles one tick in ten.

   Rain: up to 100 x rain^2 columns within 10 of the camera; every few
   ticks (a 1 in 3 chance growing with each tick since the last) the last
   one rain fell on gets a weather.rain (0.2), or weather.rain.above (0.1,
   pitch 0.5) when it is above you and you are under a roof.

   Under water: the eyes going under play ambient.underwater.enter, then the
   held loop fades in over 40 ticks (and out again), with its additions a
   1% chance a tick, rare 0.1%, ultra rare 0.01%; coming out plays exit.

   The cave mood: each tick a random block within 8 of the eyes; where no
   sky light reaches, the mood rises by (1 - block light) / 6000 (by 1/6000
   in full dark, five minutes), and sky light lowers it. At 100% the mood
   sound (ambient.cave in the Overworld, the biome's own in the Nether)
   plays 2 blocks beyond that block, and the mood starts again. The Nether's
   biomes also have their held loop (crossfading over 40 ticks between
   biomes) and their additions (1.11% a tick).

   The cost: about 340 block reads a tick (a quarter of the game's samples,
   each four times as likely to sound), a tenth of a millisecond.
--------------------------------------------------------------------------- */
import { Sound } from './sound.js?v=22';
import { B, BLOCKS, FLUID } from '../blocks.js?v=22';
import { LEVEL, FALLING } from '../world-const.js?v=22';
import { BIOMES } from '../biomes.js?v=22';

const R = Math.random;
// a quick random number for the block sampling (xorshift: Math.random a few thousand times a tick is slow)
let seed = (Math.random() * 0x7fffffff) | 1;
const ri = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % n); };
/* The game samples 667 + 667 blocks a tick. A quarter as many, each with four
   times the chance, sounds the same (every block is heard as often on
   average) and costs a quarter. */
const SAMPLES = 167, K = 4;
// what each block does: 1 fire, 2 lava, 3 water, 4 nether portal, 5 campfire
const AMB = new Uint8Array(4096);
for (const d of BLOCKS) {
  if (!d) continue;
  if (d.name === 'fire' || d.name === 'soul_fire') AMB[d.id] = 1;
  else if (FLUID[d.id] === 2) AMB[d.id] = 2;
  else if (FLUID[d.id] === 1) AMB[d.id] = 3;
  else if (d.name === 'nether_portal') AMB[d.id] = 4;
  else if (d.name === 'campfire' || d.name === 'soul_campfire') AMB[d.id] = 5;
}
const COOKS = { furnace: 'block.furnace.fire_crackle', smoker: 'block.smoker.smoke', blast_furnace: 'block.blastfurnace.fire_crackle' };
const NETHER_AMB = { nether_wastes: 1, crimson_forest: 1, warped_forest: 1, soul_sand_valley: 1, basalt_deltas: 1 };
const WATERY = /ocean|river/;

export class Ambience {
  constructor() {
    this.mood = 0;
    this.rainT = 0;
    this.under = false;
    this.uwLoop = null; this.uwFade = 0;
    this.loops = new Map();          // biome loop event -> { h, fade, want }
    this.n = 0;
  }
  reset() {
    this.stopLoops();
    this.mood = 0; this.under = false; this.uwFade = 0;
  }
  stopLoops() {
    if (this.uwLoop) { this.uwLoop.stop(); this.uwLoop = null; }
    for (const l of this.loops.values()) if (l.h) l.h.stop();
    this.loops.clear();
  }
  /* g: the game; eye: the camera's position (THREE vector) */
  tick(g, eye) {
    const w = g.world, P = g.player;
    if (!w || !P) return;
    this.n++;
    const dead = g.survival && g.survival.dead;
    this.blocks(w, eye);
    if (g.containers && g.containers.lit && this.n % 1 === 0) this.cookers(g, eye);
    this.rain(g, eye);
    this.underwater(P, dead);
    const biome = BIOMES[w.biomeAt(Math.floor(P.pos.x), Math.floor(P.pos.z))];
    this.biomeSounds(g, P, biome, dead);
  }
  // the game's animateTick, for the blocks that sound by themselves
  blocks(w, eye) {
    const cx = Math.floor(eye.x), cy = Math.floor(eye.y), cz = Math.floor(eye.z);
    for (let i = 0; i < SAMPLES; i++) {
      this.one(w, cx + ri(16) - ri(16), cy + ri(16) - ri(16), cz + ri(16) - ri(16));
      this.one(w, cx + ri(32) - ri(32), cy + ri(32) - ri(32), cz + ri(32) - ri(32));
    }
  }
  one(w, x, y, z) {
    const b = w.get(x, y, z);
    const k = AMB[b];
    if (!k) return;
    if (k === 1) { if (ri(24) < K) Sound.play('block.fire.ambient', x + 0.5, y + 0.5, z + 0.5, 1 + R(), R() * 0.7 + 0.3, 'block'); return; }
    if (k === 2) {
      if (w.get(x, y + 1, z) !== 0) return;
      if (ri(100) < K) Sound.play('block.lava.pop', x + R(), y + 1, z + R(), 0.2 + R() * 0.2, 0.9 + R() * 0.15, 'block');
      if (ri(200) < K) Sound.play('block.lava.ambient', x + 0.5, y + 0.5, z + 0.5, 0.2 + R() * 0.2, 0.9 + R() * 0.15, 'block');
      return;
    }
    if (k === 3) {
      const m = w.meta(x, y, z);
      if ((m & LEVEL) && !(m & FALLING) && ri(64) < K) Sound.play('block.water.ambient', x + 0.5, y + 0.5, z + 0.5, R() * 0.25 + 0.75, R() + 0.5, 'block');
      return;
    }
    if (k === 4) { if (ri(100) < K) Sound.play('block.portal.ambient', x + 0.5, y + 0.5, z + 0.5, 0.5, R() * 0.4 + 0.8, 'block'); return; }
    if (k === 5 && ri(10) < K) Sound.play('block.campfire.crackle', x + 0.5, y + 0.5, z + 0.5, 0.5 + R(), R() * 0.7 + 0.6, 'block');
  }
  cookers(g, eye) {
    for (const c of g.containers.lit) {
      if (!(c.burn > 0) || !COOKS[c.kind]) continue;
      const dx = c.x + 0.5 - eye.x, dy = c.y - eye.y, dz = c.z + 0.5 - eye.z;
      if (dx * dx + dy * dy + dz * dz > 32 * 32) continue;
      if (R() < 0.1) Sound.play(COOKS[c.kind], c.x + 0.5, c.y, c.z + 0.5, 1, 1, 'block');
    }
  }
  // rain falling round the camera (the game's tickRainParticles)
  rain(g, eye) {
    const W = g.sim && g.sim.weather;
    const lvl = W ? W.rain : 0;
    if (!(lvl > 0) || !W.rainingAt) return;
    const w = g.world, ex = Math.floor(eye.x), ey = Math.floor(eye.y), ez = Math.floor(eye.z);
    // (the game looks at up to 100 x rain^2 columns and keeps the last it rains on: one found is as good, so a few are tried)
    const n = Math.min(6, Math.floor(100 * lvl * lvl));
    let hit = null;
    for (let j = 0; j < n && !hit; j++) {
      const x = ex + ri(21) - 10, z = ez + ri(21) - 10;
      const top = this.topAt(w, x, z, ey);
      if (top === null || top > ey + 10 || top < ey - 10) continue;
      if (!W.rainingAt(x, top, z)) continue;
      hit = [x, top - 1, z];
    }
    if (!hit || !(ri(3) < this.rainT++)) return;
    this.rainT = 0;
    const roof = this.topAt(w, ex, ez, ey);
    if (hit[1] > ey + 1 && roof !== null && roof > ey) Sound.play('weather.rain.above', hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5, 0.1, 0.5, 'weather');
    else Sound.play('weather.rain', hit[0] + 0.5, hit[1] + 0.5, hit[2] + 0.5, 0.2, 1, 'weather');
  }
  // the first space above the highest block that stops rain in a column (the game's MOTION_BLOCKING heightmap), looked for near y
  topAt(w, x, z, y) {
    const c = w.chunkAt(x, z);
    if (!c) return null;
    for (let yy = Math.min(c.top, 383); yy >= y - 12 && yy > 0; yy--) {
      const b = w.get(x, yy, z);
      if (b && (BLOCKS[b].solid || FLUID[b] || BLOCKS[b].leaves)) return yy + 1;
    }
    return null;
  }
  underwater(P, dead) {
    const under = !!P.eyeInWater && !dead;
    if (under && !this.under) {
      Sound.play('ambient.underwater.enter', P.pos.x, P.pos.y + 1.6, P.pos.z, 1, 1, 'ambient');
      if (!this.uwLoop || this.uwLoop.stopped) this.uwLoop = Sound.loop('ambient.underwater.loop', 'ambient', { volume: 0.01 });
    } else if (!under && this.under && !dead) Sound.play('ambient.underwater.exit', P.pos.x, P.pos.y + 1.6, P.pos.z, 1, 1, 'ambient');
    this.under = under;
    // the loop fades in and out over 40 ticks
    this.uwFade = Math.max(0, Math.min(40, this.uwFade + (under ? 1 : -1)));
    if (this.uwLoop) {
      if (this.uwFade === 0 && !under) { this.uwLoop.stop(); this.uwLoop = null; }
      else this.uwLoop.setVolume(Math.max(0.01, this.uwFade / 40), 0.05);
    }
    if (under) {
      const r = R();
      if (r < 0.0001) Sound.near('ambient.underwater.loop.additions.ultra_rare', 1, 1, 'ambient');
      else if (r < 0.001) Sound.near('ambient.underwater.loop.additions.rare', 1, 1, 'ambient');
      else if (r < 0.01) Sound.near('ambient.underwater.loop.additions', 1, 1, 'ambient');
    }
  }
  biomeSounds(g, P, biome, dead) {
    const w = g.world, name = biome ? biome.name || biome.id || '' : '';
    const key = String(name).replace(/^minecraft:/, '').toLowerCase().replace(/ /g, '_');
    const nether = g.dim === 'the_nether' && NETHER_AMB[key];
    // the held loop of a Nether biome, crossfading as you cross into another
    const want = nether ? 'ambient.' + key + '.loop' : null;
    if (want && !this.loops.has(want) && Sound.has(want)) this.loops.set(want, { h: Sound.loop(want, 'ambient', { volume: 0.01 }), fade: 0 });
    for (const [ev, l] of this.loops) {
      l.fade = Math.max(0, Math.min(40, l.fade + (ev === want && !dead ? 1 : -1)));
      if (!l.h) { this.loops.delete(ev); continue; }
      if (l.fade === 0 && ev !== want) { l.h.stop(); this.loops.delete(ev); }
      else l.h.setVolume(Math.max(0.01, l.fade / 40), 0.05);
    }
    if (dead) return;
    if (nether && R() < 0.0111) Sound.near('ambient.' + key + '.additions', 1, 1, 'ambient');
    // the mood
    const ex = P.pos.x, ey = P.pos.y + (P.eyeH || 1.62), ez = P.pos.z;
    const bx = Math.floor(ex + ri(17) - 8), by = Math.floor(ey + ri(17) - 8), bz = Math.floor(ez + ri(17) - 8);
    const sim = g.sim;
    if (!sim || !sim.rawLight) return;
    const l = sim.rawLight(bx, by, bz), sky = l >> 4, blk = l & 15;
    if (sky > 0) this.mood -= sky / 15 * 0.001;
    else this.mood -= (blk - 1) / 6000;
    if (this.mood >= 1) {
      const dx = bx + 0.5 - ex, dy = by + 0.5 - ey, dz = bz + 0.5 - ez, d = Math.hypot(dx, dy, dz) || 1, d2 = d + 2;
      const ev = nether ? 'ambient.' + key + '.mood' : g.dim === 'the_end' ? null : 'ambient.cave';
      if (ev) Sound.play(ev, ex + dx / d * d2, ey + dy / d * d2, ez + dz / d * d2, 1, 1, 'ambient');
      this.mood = 0;
    } else this.mood = Math.max(0, this.mood);
  }
}
