/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: carvers.

   The old tunnel caves and canyons that wind through the noise caves.
   Every chunk within 8 of the one being made may start a cave system (with
   a 15% chance) or a canyon (1%), seeded from the world seed and that
   chunk's position with the old java.util.Random; the system is traced
   step by step and each step cuts an ellipsoid. A system only depends on
   where it starts, so its steps are kept and replayed for every chunk it
   reaches; only where it stops (out of reach of the chunk) differs.

   Written from the game's behaviour (checked against chunks the 26.3
   server made), with Minecraft's own sine table, float maths and random
   call order, since all three decide where a tunnel goes.
--------------------------------------------------------------------------- */
import { LegacyRandom } from './random.js?v=107';

const F = Math.fround;
// Mth.sin / Mth.cos: a 65536-entry table of floats
const SIN = new Float32Array(65536);
for (let i = 0; i < 65536; i++) SIN[i] = Math.sin(i * Math.PI * 2 / 65536);
const K = F(10430.378);
export const msin = f => SIN[(Math.trunc(F(f * K))) & 65535];
export const mcos = f => SIN[(Math.trunc(F(F(f * K) + 16384))) & 65535];
const PI_F = F(Math.PI), HALF_PI = F(1.5707964), TWO_PI = F(F(Math.PI) * 2);

// float providers (all in float, as the game samples them)
function sampleFloat(p, r) {
  if (typeof p === 'number') return F(p);
  const t = p.type.replace('minecraft:', '');
  if (t === 'constant') return F(p.value);
  if (t === 'uniform') return F(F(r.nextFloat() * F(F(p.max_exclusive) - F(p.min_inclusive))) + F(p.min_inclusive));
  if (t === 'trapezoid') {
    const mn = F(p.min), mx = F(p.max), pl = F(p.plateau);
    const f = F(mx - mn), g = F(F(f - pl) / 2), h = F(f - g);
    return F(F(mn + F(r.nextFloat() * h)) + F(r.nextFloat() * g));
  }
  throw new Error('float provider ' + t);
}
function sampleInt(p, r) {
  if (typeof p === 'number') return p;
  const t = p.type.replace('minecraft:', '');
  const mn = p.min_inclusive, mx = p.max_inclusive;
  if (t === 'constant') return p.value;
  if (t === 'uniform') return r.nextInt(mx - mn + 1) + mn;
  if (t === 'biased_to_bottom') return mn + r.nextInt(r.nextInt(mx - mn + 1) + 1);
  if (t === 'very_biased_to_bottom') return mn + r.nextInt(r.nextInt(r.nextInt(mx - mn + 1) + 1) + 1);
  throw new Error('int provider ' + t);
}
// a height anchor in a world from minY to top (the Overworld's -64..319 unless told)
const anchorY = (a, minY = -64, top = 319) => (a.absolute !== undefined ? a.absolute : a.above_bottom !== undefined ? minY + a.above_bottom : a.below_top !== undefined ? top - a.below_top : 63);
function sampleHeight(p, r, minY, top) {
  const t = p.type.replace('minecraft:', '');
  const lo = anchorY(p.min_inclusive, minY, top), hi = anchorY(p.max_inclusive, minY, top);
  if (t === 'uniform') return r.nextInt(hi - lo + 1) + lo;
  throw new Error('height provider ' + t);
}

/* ---- tracing: a system is a list of tunnels, a tunnel a list of steps ---- */
function traceCave(cfg, r, cx, cz, minY, top) {
  const out = [];
  const range = 112;
  const n = sampleInt(cfg.count || { type: 'very_biased_to_bottom', min_inclusive: 0, max_inclusive: 14 }, r);
  for (let k = 0; k < n; k++) {
    const x = cx * 16 + r.nextInt(16);
    const y = sampleHeight(cfg.y, r, minY, top);
    const z = cz * 16 + r.nextInt(16);
    const hm = sampleFloat(cfg.horizontal_radius_multiplier, r);
    const vm = sampleFloat(cfg.vertical_radius_multiplier, r);
    const floor = sampleFloat(cfg.floor_level, r);
    let m = 1;
    if (r.nextInt(4) === 0) {
      const ys = sampleFloat(cfg.room_vertical_radius_multiplier, r);
      const rad = F(1 + F(r.nextFloat() * 6));
      const d = 1.5 + F(msin(HALF_PI) * rad);
      out.push({ room: true, floor, steps: [{ x: x + 1, y, z, hr: d, vr: d * ys }] });
      m += r.nextInt(4);
    }
    for (let p = 0; p < m; p++) {
      const yaw = F(r.nextFloat() * TWO_PI);
      const pitch = F(F(r.nextFloat() - 0.5) / 4);
      let th = sampleFloat(cfg.thickness, r);
      if (cfg.weird_thickness_bias && r.nextInt(10) === 0) th = F(th * F(F(F(r.nextFloat() * r.nextFloat()) * 3) + 1));
      const count = range - r.nextInt(range / 4);
      // (the Nether's tunnels start five times as tall)
      tunnel(out, r.nextLong(), x, y, z, hm, vm, th, yaw, pitch, 0, count, cfg.start_vertical_radius_multiplier ?? 1, floor);
    }
  }
  return out;
}
function tunnel(out, seed, x, y, z, hm, vm, th, yaw, pitch, start, count, ys, floor, parent) {
  const r = new LegacyRandom(seed);
  const branchAt = r.nextInt(Math.trunc(count / 2)) + Math.trunc(count / 4);
  const steep = r.nextInt(6) === 0;
  let f = 0, g = 0;
  // a branch only exists if its parent got as far as the fork for this chunk
  const t = { room: false, floor, th, count, steps: [], parent: parent || null };
  out.push(t);
  for (let j = start; j < count; j++) {
    const d = 1.5 + F(msin(F(F(PI_F * j) / count)) * th);
    const e = d * ys;
    const h = mcos(pitch);
    x += F(mcos(yaw) * h);
    y += msin(pitch);
    z += F(msin(yaw) * h);
    pitch = F(pitch * (steep ? F(0.92) : F(0.7)));
    pitch = F(pitch + F(g * F(0.1)));
    yaw = F(yaw + F(f * F(0.1)));
    g = F(g * F(0.9));
    f = F(f * F(0.75));
    g = F(g + F(F(F(r.nextFloat() - r.nextFloat()) * r.nextFloat()) * 2));
    f = F(f + F(F(F(r.nextFloat() - r.nextFloat()) * r.nextFloat()) * 4));
    if (j === branchAt && th > 1) {
      tunnel(out, r.nextLong(), x, y, z, hm, vm, F(F(r.nextFloat() * 0.5) + 0.5), F(yaw - HALF_PI), F(pitch / 3), j, count, 1, floor, t);
      tunnel(out, r.nextLong(), x, y, z, hm, vm, F(F(r.nextFloat() * 0.5) + 0.5), F(yaw + HALF_PI), F(pitch / 3), j, count, 1, floor, t);
      return;
    }
    if (r.nextInt(4) === 0) continue;
    t.steps.push({ x, y, z, hr: d * hm, vr: e * vm, j });
  }
}
function traceCanyon(cfg, r, cx, cz) {
  const S = cfg.shape;
  const range = 112;
  let x = cx * 16 + r.nextInt(16);
  let y = sampleHeight(cfg.y, r);
  let z = cz * 16 + r.nextInt(16);
  let yaw = F(r.nextFloat() * TWO_PI);
  let pitch = sampleFloat(cfg.vertical_rotation, r);
  const ys = S.y_scale !== undefined ? sampleFloat(S.y_scale, r) : sampleFloat(cfg.y_scale, r);
  const th = sampleFloat(S.thickness, r);
  const count = Math.trunc(F(range * sampleFloat(S.distance_factor, r)));
  const r2 = new LegacyRandom(r.nextLong());
  // the width factors, one per y
  const wf = new Float32Array(384);
  let w = 1;
  for (let j = 0; j < 384; j++) {
    if (j === 0 || r2.nextInt(S.width_smoothness) === 0) w = F(1 + F(r2.nextFloat() * r2.nextFloat()));
    wf[j] = F(w * w);
  }
  let f = 0, g = 0;
  const t = { room: false, canyon: true, wf, th, count, steps: [] };
  for (let i = 0; i < count; i++) {
    let d = 1.5 + F(msin(F(F(i * PI_F) / count)) * th);
    let e = d * ys;
    d *= sampleFloat(S.horizontal_radius_factor, r2);
    // the vertical radius, wider towards the middle if the shape says so
    const cf = F(1 - F(Math.abs(F(0.5 - F(i / count))) * 2));
    const fac = F(F(S.vertical_radius_default_factor) + F(F(S.vertical_radius_center_factor) * cf));
    e = fac * e * F(F(r2.nextFloat() * F(0.25)) + F(0.75));
    const h = mcos(pitch), sj = msin(pitch);
    x += F(mcos(yaw) * h);
    y += sj;
    z += F(msin(yaw) * h);
    pitch = F(pitch * F(0.7));
    pitch = F(pitch + F(g * F(0.05)));
    yaw = F(yaw + F(f * F(0.05)));
    g = F(g * F(0.8));
    f = F(f * F(0.5));
    g = F(g + F(F(F(r2.nextFloat() - r2.nextFloat()) * r2.nextFloat()) * 2));
    f = F(f + F(F(F(r2.nextFloat() - r2.nextFloat()) * r2.nextFloat()) * 4));
    if (r2.nextInt(4) === 0) continue;
    t.steps.push({ x, y, z, hr: d, vr: e, j: i });
  }
  return [t];
}

export class Carvers {
  constructor(gen, data) {
    this.gen = gen;
    this.cfg = data.configured_carver;
    this.biomes = data.biome;
    this.cache = new Map();
    this.r = new LegacyRandom(0);
    this.useMask = true;     // a block is carved once per chunk
  }
  // the systems that start in a chunk (traced once, kept)
  systems(cx, cz) {
    const key = cx + ',' + cz;
    let s = this.cache.get(key);
    if (s) return s;
    if (this.cache.size > 4000) this.cache.clear();
    s = [];
    const g = this.gen;
    const bid = g.noiseBiome((cx * 16) >> 2, 0, (cz * 16) >> 2);
    const bname = g.biomeName(bid);
    const list = (this.biomes[bname] && this.biomes[bname].carvers) || [];
    const r = this.r;
    for (let l = 0; l < list.length; l++) {
      const cfg = this.cfg[list[l]];
      if (!cfg) continue;
      r.setLargeFeatureSeed(g.seed + BigInt(l), cx, cz);
      if (!(r.nextFloat() <= cfg.probability)) continue;
      const type = cfg.type.replace('minecraft:', '');
      if (type === 'cave') s.push(...traceCave(cfg, r, cx, cz));
      else if (type === 'canyon') s.push(...traceCanyon(cfg, r, cx, cz));
    }
    this.cache.set(key, s);
    return s;
  }
  carve(blocks, meta, cx, cz, aquifer, grid) {
    const mask = new Uint8Array(98304);
    const mx = cx * 16 + 8, mz = cz * 16 + 8;
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
      for (const t of this.systems(cx + dx, cz + dz)) {
        t.cut = !!(t.parent && t.parent.cut);
        if (t.cut) continue;
        for (const st of t.steps) {
          if (!t.room) {
            // a tunnel stops at the first step out of reach of this chunk
            const fx = st.x - mx, fz = st.z - mz, h = t.count - st.j, w = t.th + 2 + 16;
            if (fx * fx + fz * fz - h * h > w * w) { t.cut = true; break; }
          }
          this.ellipsoid(blocks, meta, cx, cz, st, t, mask, aquifer, grid);
        }
      }
    }
  }
  ellipsoid(blocks, meta, cx, cz, st, t, mask, aquifer, grid) {
    const { x, y, z, hr, vr } = st;
    const mx = cx * 16 + 8, mz = cz * 16 + 8;
    const lim = 16 + hr * 2;
    if (Math.abs(x - mx) > lim || Math.abs(z - mz) > lim) return;
    const x0 = cx * 16, z0 = cz * 16;
    const kx0 = Math.max(Math.floor(x - hr) - x0 - 1, 0), kx1 = Math.min(Math.floor(x + hr) - x0, 15);
    const ylo = Math.max(Math.floor(y - vr) - 1, -63), yhi = Math.min(Math.floor(y + vr) + 1, 312);
    const kz0 = Math.max(Math.floor(z - hr) - z0 - 1, 0), kz1 = Math.min(Math.floor(z + hr) - z0, 15);
    const g = this.gen;
    let surface = false;
    for (let lx = kx0; lx <= kx1; lx++) {
      const rx = (x0 + lx + 0.5 - x) / hr;
      for (let lz = kz0; lz <= kz1; lz++) {
        const rz = (z0 + lz + 0.5 - z) / hr;
        if (rx * rx + rz * rz >= 1) continue;
        surface = false;
        for (let v = yhi; v > ylo; v--) {
          const ry = (v - 0.5 - y) / vr;
          if (t.canyon) {
            if ((rx * rx + rz * rz) * t.wf[v + 64 - 1] + ry * ry / 6 >= 1) continue;
          } else if (ry <= t.floor || rx * rx + ry * ry + rz * rz >= 1) continue;
          const i = ((v + 64) << 8) | (lz << 4) | lx;
          if (this.useMask) { if (mask[i]) continue; mask[i] = 1; }
          const b = blocks[i];
          if (b === g.B.grass_block || b === g.B.mycelium) surface = true;
          if (!g.carvable(b)) continue;
          const s = aquifer.substance(x0 + lx, v, z0 + lz, 0);
          if (s === -1) continue;
          const nb = s === 1 ? g.B.water : s === 2 ? g.B.lava : 0;
          blocks[i] = nb; meta[i] = 0;
          if (surface) {
            const below = i - 256;
            if (blocks[below] === g.B.dirt) {
              const st2 = g.topMaterial(x0 + lx, v - 1, z0 + lz, lx, lz, nb !== 0, grid);
              if (st2) { blocks[below] = st2.id; meta[below] = st2.meta; }
            }
          }
        }
      }
    }
  }
}

/* ======================================================== the Nether ==
   26.3 gives the Nether the same cave carver with its own numbers (the
   game's nether_cave): up to 9 systems a chunk, one chunk in five, tunnels
   started five times as tall and up to twice as thick, rooms half as tall,
   floors cut off a little higher. There is no aquifer: what a cave cuts is
   lava below the lava sea's top (y 31) and air above, through anything but
   bedrock. Height 0..127. */
const NETHER_CAVE = {
  count: { type: 'very_biased_to_bottom', min_inclusive: 0, max_inclusive: 9 }, floor_level: -0.7, horizontal_radius_multiplier: 1.0,
  probability: 0.2, room_vertical_radius_multiplier: 0.5, start_vertical_radius_multiplier: 5.0,
  thickness: { type: 'trapezoid', min: 0, max: 6, plateau: 2 }, vertical_radius_multiplier: 1.0,
  y: { type: 'uniform', min_inclusive: { absolute: 0 }, max_inclusive: { below_top: 1 } },
};
export class NetherCarvers {
  constructor(seed, ids) {
    this.seed = seed;           // the world seed, a BigInt
    this.ids = ids;             // { bedrock, lava }
    this.cache = new Map();
    this.r = new LegacyRandom(0);
  }
  systems(cx, cz) {
    const key = cx + ',' + cz;
    let s = this.cache.get(key);
    if (s) return s;
    if (this.cache.size > 4000) this.cache.clear();
    s = [];
    const r = this.r;
    r.setLargeFeatureSeed(this.seed, cx, cz);
    if (r.nextFloat() <= NETHER_CAVE.probability) s = traceCave(NETHER_CAVE, r, cx, cz, 0, 127);
    this.cache.set(key, s);
    return s;
  }
  // cut the caves of every system within 8 chunks into this chunk's blocks (indexed from y -64, as every chunk is)
  carve(blocks, meta, cx, cz) {
    const mask = new Uint8Array(98304);
    const mx = cx * 16 + 8, mz = cz * 16 + 8;
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
      for (const t of this.systems(cx + dx, cz + dz)) {
        t.cut = !!(t.parent && t.parent.cut);
        if (t.cut) continue;
        for (const st of t.steps) {
          if (!t.room) {
            const fx = st.x - mx, fz = st.z - mz, h = t.count - st.j, w = t.th + 2 + 16;
            if (fx * fx + fz * fz - h * h > w * w) { t.cut = true; break; }
          }
          this.ellipsoid(blocks, meta, cx, cz, st, t, mask);
        }
      }
    }
  }
  ellipsoid(blocks, meta, cx, cz, st, t, mask) {
    const { x, y, z, hr, vr } = st;
    const mx = cx * 16 + 8, mz = cz * 16 + 8;
    const lim = 16 + hr * 2;
    if (Math.abs(x - mx) > lim || Math.abs(z - mz) > lim) return;
    const x0 = cx * 16, z0 = cz * 16;
    const kx0 = Math.max(Math.floor(x - hr) - x0 - 1, 0), kx1 = Math.min(Math.floor(x + hr) - x0, 15);
    const ylo = Math.max(Math.floor(y - vr) - 1, 1), yhi = Math.min(Math.floor(y + vr) + 1, 120);
    const kz0 = Math.max(Math.floor(z - hr) - z0 - 1, 0), kz1 = Math.min(Math.floor(z + hr) - z0, 15);
    const { bedrock, lava } = this.ids;
    for (let lx = kx0; lx <= kx1; lx++) {
      const rx = (x0 + lx + 0.5 - x) / hr;
      for (let lz = kz0; lz <= kz1; lz++) {
        const rz = (z0 + lz + 0.5 - z) / hr;
        if (rx * rx + rz * rz >= 1) continue;
        for (let v = yhi; v > ylo; v--) {
          const ry = (v - 0.5 - y) / vr;
          if (ry <= t.floor || rx * rx + ry * ry + rz * rz >= 1) continue;
          const i = ((v + 64) << 8) | (lz << 4) | lx;
          if (mask[i]) continue;
          mask[i] = 1;
          if (blocks[i] === bedrock) continue;
          blocks[i] = v < 32 ? lava : 0; meta[i] = 0;
        }
      }
    }
  }
}
