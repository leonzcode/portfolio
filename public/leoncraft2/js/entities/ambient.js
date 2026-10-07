/* ---------------------------------------------------------------------------
   Leoncraft 2 - the blocks round you giving off their little particles, the
   game's "animate tick": each tick it looks at 667 random spots within 16
   blocks of you and 667 within 32, and a block found there may make
   something:

     torches        a puff of smoke and a flame at the tip (soul torches a
                    soul flame, a lit redstone torch a red speck)
     fire           three big puffs of smoke over it (soul fire the same)
     lava           with air over it, one time in a hundred a spark that
                    jumps up and falls back
     nether portal  four swirling purple specks
     campfires      once seen, every tick as the game's campfire does: 11 in
                    a hundred ticks two or three puffs of its tall smoke,
                    rising 0.07 a tick for 280 to 330 ticks (a signal fire,
                    over a hay bale, higher), and now and then a spark

   And while it rains, the splashes where it lands (rainSplashes).

   Particles go through entities/particles.js like the rest, so Video
   Settings' Particles leaves some out the same way. Cheap: 1334 block reads
   a tick, nothing kept but the campfires near you.
--------------------------------------------------------------------------- */
import { BLOCKS, B } from '../blocks.js?v=24';
import { BIOMES } from '../biomes.js?v=24';

const R = Math.random;
const KIND = new Uint8Array(BLOCKS.length + 1);
const TORCH = 1, WALL_TORCH = 2, SOUL_TORCH = 3, SOUL_WALL_TORCH = 4, RS_TORCH = 5, RS_WALL_TORCH = 6, FIRE = 7, LAVA = 8, PORTAL = 9, CAMPFIRE = 10;
const set = (name, k) => { if (B[name] !== undefined) KIND[B[name]] = k; };
set('torch', TORCH); set('wall_torch', WALL_TORCH); set('soul_torch', SOUL_TORCH); set('soul_wall_torch', SOUL_WALL_TORCH);
set('copper_torch', TORCH); set('copper_wall_torch', WALL_TORCH);
set('redstone_torch', RS_TORCH); set('redstone_wall_torch', RS_WALL_TORCH);
set('fire', FIRE); set('soul_fire', FIRE); set('lava', LAVA); set('nether_portal', PORTAL);
for (const d of BLOCKS) if (d && d.shape === 'campfire') KIND[d.id] = CAMPFIRE;

/* where a wall torch's flame is, by the wall it hangs on: models.js wall_torch leans a 14 pixel
   picture out at 22.5 degrees from 2.5 up and 1.2 out on the north wall, and the flame is 10 of the
   picture's 16 pixels up it; the particles start a little over it, as a standing torch's do */
const TURN = { 5: 0, 0: 1, 4: 2, 1: 3 };
function wallTip(m) {
  let x = 8, z = 4.6;
  for (let i = TURN[m & 7] || 0; i > 0; i--) { const nx = 16 - z; z = x; x = nx; }
  return [x / 16, 11.8 / 16, z / 16];
}

export class Ambient {
  constructor(m) {
    this.m = m;
    this.fires = new Map();      // campfires seen near you: "x,y,z" -> [x, y, z]
  }
  // one particle where asked, still (the game's torch smoke and flames start at rest), or with a push
  // (light: 1 draws it at full brightness; below that it takes the lightmap, so it darkens at night)
  puff(kind, x, y, z, vx = 0, vy = 0, vz = 0, col, light) {
    const P = this.m.particlesP, i = P.n;
    P.add(kind, x, y, z, 1, 0, col, light);
    if (P.n > i) { const o = i * 3; P.vel[o] = vx; P.vel[o + 1] = vy; P.vel[o + 2] = vz; }
  }
  tick() {
    const m = this.m, T = m.t, P = m.P;
    if (!P || !m.particlesP) return;
    const px = Math.floor(P.pos.x), py = Math.floor(P.pos.y), pz = Math.floor(P.pos.z);
    for (let r = 16; r <= 32; r += 16) {
      for (let i = 0; i < 667; i++) {
        const x = px + ((R() * r) | 0) - ((R() * r) | 0), y = py + ((R() * r) | 0) - ((R() * r) | 0), z = pz + ((R() * r) | 0) - ((R() * r) | 0);
        const b = T.get(x, y, z), k = b ? KIND[b] : 0;
        if (k) this.block(k, b, x, y, z);
      }
    }
    this.rainSplashes(px, py, pz);
    // the campfires: every tick, as their block entities do in the game
    for (const [key, f] of this.fires) {
      const [x, y, z] = f;
      const b = T.get(x, y, z);
      if (KIND[b] !== CAMPFIRE || (T.meta(x, y, z) & 4) || Math.abs(x - px) > 64 || Math.abs(z - pz) > 64) { this.fires.delete(key); continue; }
      if (R() < 0.11) {
        const n = 2 + ((R() * 2) | 0), kind = T.get(x, y - 1, z) === B.hay_block ? 'campfire_signal' : 'campfire';
        for (let k = 0; k < n; k++) this.puff(kind, x + 0.5 + R() / 3 * (R() < 0.5 ? 1 : -1), y + R() + R(), z + 0.5 + R() / 3 * (R() < 0.5 ? 1 : -1), 0, 0.07, 0, undefined, OUTDOORS);
      }
    }
  }
  /* Rain hitting the ground, as the game's weather does each tick: 100 x
     rain level squared tries at columns within 10 blocks, each where the rain
     lands (the top block that stops it) if that is within 10 of you and it
     rains there rather than snows: a little splash that hops and falls, or a
     wisp of smoke off lava, magma or a lit campfire. */
  rainSplashes(px, py, pz) {
    const m = this.m, ws = m.R && m.R.weatherState, rain = ws ? ws.rain || 0 : 0;
    if (rain <= 0 || m.dim !== 'overworld') return;
    const T = m.t, W = m.world, n = Math.floor(100 * rain * rain);
    for (let i = 0; i < n; i++) {
      const x = px + ((R() * 21) | 0) - 10, z = pz + ((R() * 21) | 0) - 10;
      const top = T.motionTop(x, z);
      if (top <= 0 || top > py + 10 || top < py - 10) continue;
      const bi = BIOMES[W.biomeAt(x, z)];
      if (!bi || bi.snowy || !bi.rain) continue;
      const b = T.get(x, top - 1, z), d = BLOCKS[b];
      const hot = d && (d.name === 'lava' || d.name === 'magma_block' || (KIND[b] === CAMPFIRE && !(T.meta(x, top - 1, z) & 4)));
      const sx = x + R(), sz = z + R(), sy = top - (d && d.name === 'water' ? 1 / 9 : 0);
      if (hot) this.puff('smoke', sx, sy, sz);
      else this.puff('rain', sx, sy, sz, (R() - 0.5) * 0.04, 0.1 + R() * 0.2, (R() - 0.5) * 0.04, undefined, OUTDOORS);
    }
  }
  block(k, b, x, y, z) {
    const T = this.m.t;
    switch (k) {
      case TORCH: case SOUL_TORCH:
        this.puff('smoke', x + 0.5, y + 0.7, z + 0.5);
        this.puff(k === SOUL_TORCH ? 'soul_flame' : 'flame', x + 0.5, y + 0.7, z + 0.5);
        break;
      case WALL_TORCH: case SOUL_WALL_TORCH: {
        const [tx, ty, tz] = wallTip(T.meta(x, y, z));
        this.puff('smoke', x + tx, y + ty, z + tz);
        this.puff(k === SOUL_WALL_TORCH ? 'soul_flame' : 'flame', x + tx, y + ty, z + tz);
        break;
      }
      case RS_TORCH: case RS_WALL_TORCH: {
        const m = T.meta(x, y, z);
        if (m & 8) break;              // unlit
        const [tx, ty, tz] = k === RS_TORCH ? [0.5, 0.7, 0.5] : wallTip(m);
        this.puff('dust', x + tx + (R() - 0.5) * 0.2, y + ty + (R() - 0.5) * 0.2, z + tz + (R() - 0.5) * 0.2, 0, 0, 0, RED);
        break;
      }
      case FIRE:
        for (let i = 0; i < 3; i++) this.puff('large_smoke', x + R(), y + R() * 0.5 + 0.5, z + R());
        break;
      case LAVA: {
        if (R() >= 0.01) break;
        const a = T.get(x, y + 1, z);
        if (a && BLOCKS[a].solid) break;
        if (a && KIND[a] === LAVA) break;
        this.puff('lava', x + R(), y + 1, z + R(), (R() - 0.5) * 0.08, 0.15 + R() * 0.25, (R() - 0.5) * 0.08);
        break;
      }
      case PORTAL:
        for (let i = 0; i < 4; i++) {
          const s = R() < 0.5 ? -1 : 1;
          this.puff('portal', x + R(), y + R(), z + R(), (R() - 0.5) * 0.5 * 0.5, (R() - 0.5) * 0.5 * 0.5, (R() - 0.5) * 0.5 * 0.5 * s);
        }
        break;
      case CAMPFIRE: {
        if (T.meta(x, y, z) & 4) break;     // put out
        this.fires.set(x + ',' + y + ',' + z, [x, y, z]);
        if (R() < 0.2) this.puff('lava', x + 0.5, y + 0.5, z + 0.5, (R() - 0.5) * 0.08, 0.15 + R() * 0.2, (R() - 0.5) * 0.08);
        break;
      }
    }
  }
}
const RED = [1.0, 0.15, 0.1];
// in the open sky's light (the lightmap darkens it at night), not glowing
const OUTDOORS = 0.98;
