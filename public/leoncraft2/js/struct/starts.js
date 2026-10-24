/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: which structure starts where, and its pieces.

   Structures(seed, source) answers, for one world:
     structuresIn(cx, cz, dim)        the structures that start in a chunk
     nearest(type, x, z, dim)         the nearest of a kind, the way /locate
                                      searches (ring by ring of regions)
     strongholds(n)                   the first n stronghold positions
     piecesFor(cx, cz, dim)           every piece of every structure that
                                      reaches into a chunk (for building it)
   and apply(blocks, meta, cx, cz, dim) builds those pieces into a chunk.

   Whether a try becomes a structure is the game's own test: its frequency
   and exclusion zone, then the set's structures in weighted random order,
   each checking its biome at its own spot (see point()). The biome source
   is pluggable (makeSource): with the vanilla generator plugged in, the
   answers are the real game's.
--------------------------------------------------------------------------- */
import { SETS, BIOMES_OF, STRONGHOLD_BIASED, MONUMENT_SURROUNDING, SET_OF, FAMILY, potentialChunk, isStructureChunk, heightOf, SEA_LEVEL } from './placement.js?v=107';
import { JRand, toLong, largeFeature } from './rand.js?v=107';
import { strongholdPieces } from './stronghold.js?v=107';
import { fortressPieces } from './fortress.js?v=107';
import { mineshaftPieces } from './mineshaft.js?v=107';
import { ChunkWriter } from './piece.js?v=107';
import { PLANS } from './builds/index.js?v=107';

// how far (in chunks) a structure's pieces can reach from its start chunk
const REACH = {
  stronghold: 9, fortress: 9, mineshaft: 7, mineshaft_mesa: 7, ancient_city: 9, trial_chambers: 9, mansion: 5, monument: 4,
  bastion_remnant: 6, end_city: 8, pillager_outpost: 5, trail_ruins: 4, village_plains: 7, village_desert: 7, village_savanna: 7,
  village_snowy: 7, village_taiga: 7, ocean_ruin_cold: 3, ocean_ruin_warm: 3, shipwreck: 2, shipwreck_beached: 2, buried_treasure: 1,
};
const reach = t => REACH[t] || 2;
const SET_REACH = {};
for (const k in SETS) SET_REACH[k] = Math.max(...SETS[k].list.map(e => reach(e[0])));
// the footprint the game checks for the single-piece structures (SinglePieceStructure width, depth)
const SINGLE = { desert_pyramid: [21, 21], jungle_pyramid: [12, 15] };        // (the swamp hut stands on water, so has no such check)
// a guess at half the start piece's size, for the jigsaw structures (the templates themselves are not used)
const JIGSAW = {
  village_plains: 5, village_desert: 6, village_savanna: 6, village_snowy: 5, village_taiga: 5, pillager_outpost: 7,
  bastion_remnant: 10, trail_ruins: 4, trial_chambers: 0, ancient_city: 0,
};
const ROT = [[1, 1], [-1, 1], [-1, -1], [1, -1]];      // where a turned template's far corner lands
/* The start pools of the jigsaw structures that stand on the surface: each
   start template's weight and its size across (x, z), as 26.3 has them. The
   start's middle (where its biome is read and its height taken) is the
   middle of the template picked, turned, so it is where the game puts it. */
const STARTS = {
  village_plains: [[50, 9, 9], [50, 10, 10], [50, 8, 15], [50, 11, 11], [1, 9, 9], [1, 10, 10], [1, 8, 15], [1, 11, 11]],
  village_desert: [[98, 17, 9], [98, 12, 12], [49, 15, 15], [2, 17, 9], [2, 12, 12], [1, 15, 15]],
  village_savanna: [[100, 14, 12], [50, 11, 11], [150, 9, 11], [150, 9, 9], [2, 14, 12], [1, 11, 11], [3, 9, 11], [3, 9, 9]],
  village_snowy: [[100, 12, 8], [50, 11, 9], [150, 7, 7], [2, 12, 8], [1, 11, 9], [3, 7, 7]],
  village_taiga: [[49, 22, 18], [49, 9, 9], [1, 22, 18], [1, 9, 9]],
  trail_ruins: [[1, 5, 5], [1, 5, 5], [1, 7, 7], [1, 7, 7], [1, 7, 7]],
  pillager_outpost: [[1, 16, 16]],
  bastion_remnant: [[1, 46, 46], [1, 30, 48], [1, 38, 38], [1, 16, 32]],
  trial_chambers: [[1, 19, 19], [1, 19, 19]],
  ancient_city: [[1, 18, 41], [1, 18, 41], [1, 18, 41]],
};
/* A start placed by a named jigsaw (the ancient city's city_anchor) is moved
   so that jigsaw sits on the chunk corner: where it is in the template (x, z),
   the same in each of the city's centres. */
const ANCHOR = { ancient_city: [13, 20] };
// the middle of a template's box once turned about the chunk corner (Java's
// integer halving, which rounds towards zero)
function startMiddle(x0, z0, sx, sz, rot) {
  let x1, x2, z1, z2;
  if (rot === 0) { x1 = x0; x2 = x0 + sx - 1; z1 = z0; z2 = z0 + sz - 1; }
  else if (rot === 1) { x1 = x0 - (sz - 1); x2 = x0; z1 = z0; z2 = z0 + sx - 1; }
  else if (rot === 2) { x1 = x0 - (sx - 1); x2 = x0; z1 = z0 - (sz - 1); z2 = z0; }
  else { x1 = x0; x2 = x0 + sz - 1; z1 = z0 - (sx - 1); z2 = z0; }
  return [Math.trunc((x1 + x2) / 2), Math.trunc((z1 + z2) / 2)];
}

/* =================================================== the biome source == */
/* Make the source structures read the land from, out of a world generator:
   the vanilla one (noiseBiome on 4 x 4 x 4 cells) where it is plugged in,
   else this game's own (one biome per column from the climate). Biome ids
   are turned into names with the BIOMES table. For the Nether and the End
   the same generator calls answer netherBiome / endBiome / endGround, so a
   dimension's generator only needs noiseBiome (or climate) and surfaceAt. */
export function makeSource(gen, BIOMES, pickBiome, Y0, dim) {
  const name = id => (BIOMES[id] ? BIOMES[id].name : undefined);
  const ground = (x, z) => {
    const y = gen.surfaceAt ? gen.surfaceAt(x, z) : 64 - Y0;
    return y < 0 ? -64 : y + Y0;
  };
  let biome;
  if (typeof gen.noiseBiome === 'function') biome = (x, y, z) => name(gen.noiseBiome(x >> 2, y >> 2, z >> 2));
  // the Nether's and the End's own generators know their biomes by column (so an end city
  // never stands on the main island, nor a bastion in the basalt deltas)
  else if (dim !== 'overworld' && typeof gen.biomeAt === 'function') biome = (x, y, z) => name(gen.biomeAt(x, z));
  else if (pickBiome && typeof gen.climate === 'function') biome = (x, y, z) => name(pickBiome(gen.climate(x & ~3, z & ~3)));
  else biome = () => undefined;
  const src = { vanilla: typeof gen.noiseBiome === 'function', biome, ground };
  // a Superflat world (gen/flat.js): the game's sea level for it, and only the structures its preset has
  if (gen.seaLevel !== undefined) src.seaLevel = gen.seaLevel;
  if (gen.allowStructures) src.allow = gen.allowStructures;
  // whether any water or lava of a chunk's bare terrain touches a box there (the vanilla generator knows)
  if (typeof gen.fluidNear === 'function') src.fluidNear = (box, cx, cz) => gen.fluidNear(box.x0, box.y0, box.z0, box.x1, box.y1, box.z1, cx, cz);
  if (dim === 'nether') { src.netherBiome = biome; src.biome = () => undefined; }
  if (dim === 'end') { src.endBiome = (x, z) => biome(x, 64, z); src.endGround = ground; src.biome = () => undefined; }
  return src;
}

/* ========================================================= Structures == */
export class Structures {
  constructor(seed, src) {
    this.seed = toLong(seed);
    this.src = src || { biome: () => undefined, ground: () => 64 };
    this.sea = this.src.seaLevel !== undefined ? this.src.seaLevel : SEA_LEVEL;
    this.starts = new Map();          // "set:cx,cz" -> start or null
    this.groundCache = new Map();
    this.ring = null;                 // stronghold ring tries (cheap), and their final chunks once worked out
  }
  ground(x, z) {
    const k = x * 65536 + z;
    let v = this.groundCache.get(k);
    if (v === undefined) {
      if (this.groundCache.size > 50000) this.groundCache.clear();
      v = this.src.ground(x, z);
      this.groundCache.set(k, v);
    }
    return v;
  }
  occupied(x, z) { return Math.max(this.ground(x, z), this.sea - 1); }       // WORLD_SURFACE_WG: water counts
  biomeOK(type, x, y, z, dim) {
    const src = this.src;
    let b;
    if (dim === 'nether') b = src.netherBiome ? src.netherBiome(x, y, z) : undefined;
    else if (dim === 'end') b = src.endBiome ? src.endBiome(x, z) : undefined;
    else b = src.biome(x, y, z);
    return b === undefined || BIOMES_OF[type].has(b);
  }
  lowest(x, z, w, d) {
    return Math.min(this.occupied(x, z), this.occupied(x, z + d), this.occupied(x + w, z), this.occupied(x + w, z + d));
  }

  /* Where the structure would stand if built in chunk (cx, cz), checked as
     the game checks it (Structure.findValidGenerationPoint), or null. */
  point(type, cx, cz, dim) {
    if (this.src.allow && !this.src.allow.has(type)) return null;
    // the chunk's middle (ChunkPos.getMiddleBlockX, block 8), where most
    // structures stand and are biome-checked; mansions and end cities measure
    // from block 7 instead
    const x0 = cx * 16, z0 = cz * 16, xm = x0 + 8, zm = z0 + 8, x7 = x0 + 7, z7 = z0 + 7;
    const r = largeFeature(new JRand(0), this.seed, cx, cz);
    let p = null;
    if (SINGLE[type]) {
      const [w, d] = SINGLE[type];
      if (this.lowest(x0, z0, w, d) < this.sea) return null;
      p = { x: xm, y: this.occupied(xm, zm), z: zm };
    } else if (JIGSAW[type] !== undefined || type.startsWith('abandoned_camp')) {
      // the start piece's height, then its turn, then its template come first from the random
      let y = 0;
      if (type === 'trial_chambers') y = r.between(-40, -20);
      else if (type === 'ancient_city') y = -27;
      else if (type === 'bastion_remnant') y = 33;
      const T = STARTS[type];
      let k = 0;
      const rot = r.nextInt(4), hw = JIGSAW[type] !== undefined ? JIGSAW[type] : 3;
      if (T) {
        let n = 0;
        for (const t of T) n += t[0];
        n = r.nextInt(n);
        while ((n -= T[k][0]) >= 0) k++;
      } else r.next(31);
      let x = x0 + ROT[rot][0] * hw, z = z0 + ROT[rot][1] * hw;
      if (T) {
        // the anchor turned with the template (no turn, a quarter, a half, three quarters clockwise)
        const A = ANCHOR[type] || [0, 0], ax = [A[0], -A[1], -A[0], A[1]][rot], az = [A[1], A[0], -A[1], -A[0]][rot];
        [x, z] = startMiddle(x0 - ax, z0 - az, T[k][1], T[k][2], rot);
      }
      if (type.startsWith('village') || type === 'pillager_outpost' || type.startsWith('abandoned_camp')) y = this.occupied(x, z) + 1;
      else if (type === 'trail_ruins') y = this.occupied(x, z) + 1 - 15;
      p = { x, y, z, rot };
    } else switch (type) {
      case 'igloo': p = { x: xm, y: this.occupied(xm, zm), z: zm }; break;
      case 'shipwreck': case 'ocean_ruin_cold': case 'ocean_ruin_warm': case 'buried_treasure':
        p = { x: xm, y: this.ground(xm, zm), z: zm }; break;
      case 'shipwreck_beached': p = { x: xm, y: this.occupied(xm, zm), z: zm }; break;
      case 'ruined_portal': case 'ruined_portal_desert': case 'ruined_portal_jungle': case 'ruined_portal_swamp':
      case 'ruined_portal_mountain': case 'ruined_portal_ocean':
        p = { x: x0, y: this.ground(x0 + 4, z0 + 4), z: z0 }; break;
      case 'ruined_portal_nether': p = { x: x0, y: 40, z: z0 }; break;
      case 'mansion': case 'end_city': {
        const rot = r.nextInt(4);
        const i = rot === 1 || rot === 2 ? -5 : 5, j = rot === 2 || rot === 3 ? -5 : 5;
        const g = type === 'end_city' ? (x, z) => (this.src.endGround ? this.src.endGround(x, z) : 70) : (x, z) => this.occupied(x, z);
        const y = Math.min(g(x7, z7), g(x7, z7 + j), g(x7 + i, z7), g(x7 + i, z7 + j));
        if (y < 60) return null;
        p = { x: x7, y, z: z7, rot };
        break;
      }
      case 'monument': {
        p = { x: xm, y: this.ground(xm, zm), z: zm };
        if (!this.biomeOK(type, p.x, p.y, p.z, dim)) return null;
        if (!this.monumentSurroundings(x0 + 9, z0 + 9)) return null;
        return p;
      }
      case 'mineshaft': case 'mineshaft_mesa': {
        const m = mineshaftPieces(this.seed, cx, cz, type === 'mineshaft' ? 'normal' : 'mesa', (x, z) => this.occupied(x, z));
        p = { x: xm, y: 50 + m.dy, z: z0, pieces: m.pieces };
        break;
      }
      case 'fortress': p = { x: x0, y: 64, z: z0 }; break;
      case 'stronghold': p = { x: x0, y: 0, z: z0 }; break;
      default: p = { x: xm, y: this.occupied(xm, zm), z: zm };
    }
    return p && this.biomeOK(type, p.x, p.y, p.z, dim) ? p : null;
  }
  // every biome within 29 blocks of the monument (3D, as the game reads it) must be ocean or river
  monumentSurroundings(x, z) {
    const src = this.src;
    const x0 = (x - 29) >> 2, x1 = (x + 29) >> 2, z0 = (z - 29) >> 2, z1 = (z + 29) >> 2, y0 = (63 - 29) >> 2, y1 = (63 + 29) >> 2;
    const ys = [];
    for (let y = 15; y <= y1; y++) ys.push(y);
    for (let y = 14; y >= y0; y--) ys.push(y);
    for (const qy of src.vanilla ? ys : [15]) for (let qz = z0; qz <= z1; qz++) for (let qx = x0; qx <= x1; qx++) {
      const b = src.biome(qx << 2, qy << 2, qz << 2);
      if (b !== undefined && !MONUMENT_SURROUNDING.has(b)) return false;
    }
    return true;
  }

  /* The structure a set builds in chunk (cx, cz), if any: the weighted pick
     of ChunkGenerator.createStructures. */
  startFor(setName, cx, cz) {
    const key = setName + ':' + cx + ',' + cz;
    if (this.starts.has(key)) return this.starts.get(key);
    const S = SETS[setName];
    let out = null;
    if (S.rings) {
      for (const s of this.strongholdsNear(cx, cz, 0)) if (s.cx === cx && s.cz === cz) { out = { type: 'stronghold', set: setName, cx, cz, x: cx * 16, y: 0, z: cz * 16 }; break; }
    } else if (isStructureChunk(this.seed, S, cx, cz)) {
      const list = S.list.slice();
      if (list.length === 1) {
        const p = this.point(list[0][0], cx, cz, S.dim);
        if (p) out = Object.assign({ type: list[0][0], set: setName, cx, cz }, p);
      } else {
        const r = largeFeature(new JRand(0), this.seed, cx, cz);
        let total = 0;
        for (const e of list) total += e[1];
        while (list.length) {
          let k = r.nextInt(total), l = 0;
          for (const e of list) { if ((k -= e[1]) < 0) break; l++; }
          const e = list[l];
          const p = this.point(e[0], cx, cz, S.dim);
          if (p) { out = Object.assign({ type: e[0], set: setName, cx, cz }, p); break; }
          list.splice(l, 1);
          total -= e[1];
        }
      }
    }
    if (this.starts.size > 60000) this.starts.clear();
    this.starts.set(key, out);
    return out;
  }

  /* ---- strongholds ---- */
  ringTries() {
    if (this.ring) return this.ring;
    // (a Superflat world whose preset has no strongholds has none at all: they skip point(), so the check is here;
    //  without it The Void, Leonpixel's world, had strongholds hanging in the air beside the arenas)
    if (this.src.allow && !this.src.allow.has('stronghold')) return (this.ring = []);
    const { distance, spread: s0, count } = SETS.strongholds.rings;
    const r = new JRand(this.seed);
    let a = r.nextDouble() * Math.PI * 2;
    let l = 0, m = 0, spread = s0;
    const out = [];
    for (let n = 0; n < count; n++) {
      const e = 4 * distance + distance * m * 6 + (r.nextDouble() - 0.5) * (distance * 2.5);
      const o = Math.round(Math.cos(a) * e), p = Math.round(Math.sin(a) * e);
      out.push({ n, ring: m, o, p, fork: r.nextLong(), cx: null, cz: null });
      a += Math.PI * 2 / spread;
      if (++l === spread) {
        m++; l = 0;
        spread += Math.trunc(2 * spread / (m + 1));
        spread = Math.min(spread, count - n);
        a += r.nextDouble() * Math.PI * 2;
      }
    }
    return (this.ring = out);
  }
  // one stronghold's chunk: a random spot in a preferred biome within 112 blocks of its try (BiomeSource.findBiomeHorizontal)
  settle(t) {
    if (t.cx !== null) return t;
    const fr = new JRand(t.fork);
    const x = t.o * 16 + 8, z = t.p * 16 + 8;
    const i = x >> 2, j = z >> 2, k = 112 >> 2;
    let found = null, m = 0;
    for (let pz = -k; pz <= k; pz++) for (let q = -k; q <= k; q++) {
      const b = this.src.biome((i + q) << 2, 0, (j + pz) << 2);
      if (b !== undefined && !STRONGHOLD_BIASED.has(b)) continue;
      if (found === null || fr.nextInt(m + 1) === 0) found = [(i + q) << 2, (j + pz) << 2];
      m++;
    }
    if (found) { t.cx = found[0] >> 4; t.cz = found[1] >> 4; }
    else { t.cx = t.o; t.cz = t.p; }
    return t;
  }
  // the strongholds whose chunk could be within `within` chunks of (cx, cz)
  strongholdsNear(cx, cz, within) {
    const out = [];
    for (const t of this.ringTries()) {
      if (Math.abs(t.o - cx) > within + 8 || Math.abs(t.p - cz) > within + 8) continue;
      this.settle(t);
      if (Math.abs(t.cx - cx) <= within && Math.abs(t.cz - cz) <= within) out.push(t);
    }
    return out;
  }
  strongholds(n) { return this.ringTries().slice(0, n || 3).map(t => this.settle(t)).map(t => ({ x: t.cx * 16, z: t.cz * 16, cx: t.cx, cz: t.cz, ring: t.ring })); }

  /* ---- what starts in a chunk ---- */
  structuresIn(cx, cz, dim) {
    dim = dim || 'overworld';
    const out = [];
    for (const k in SETS) if (SETS[k].dim === dim) { const s = this.startFor(k, cx, cz); if (s) out.push(s); }
    return out;
  }

  /* ---- the nearest of a kind, as /locate finds it ---- */
  nearest(type, x, z, dim, maxRings) {
    const types = FAMILY[type] || (type === 'abandoned_camp' ? SETS.abandoned_camp.list.map(e => e[0]) : [type]);
    const sets = [...new Set(types.map(t => SET_OF[t]).filter(Boolean))];
    const ok = s => s && types.includes(s.type);
    let best = null;
    for (const setName of sets) {
      const S = SETS[setName];
      if (S.rings) {
        // every ring try, nearest first by its rough spot, settled only while it could still win
        const list = this.ringTries().map(t => ({ t, d: Math.hypot(t.o * 16 + 8 - x, t.p * 16 + 8 - z) })).sort((a, b) => a.d - b.d);
        for (const { t, d } of list) {
          if (best && d - 130 > best.dist) break;
          this.settle(t);
          const dist = Math.hypot(t.cx * 16 - x, t.cz * 16 - z);
          if (!best || dist < best.dist) best = { type: 'stronghold', x: t.cx * 16, z: t.cz * 16, cx: t.cx, cz: t.cz, dist };
        }
        continue;
      }
      const ox = S.locateOffset ? S.locateOffset[0] : 0, oz = S.locateOffset ? S.locateOffset[1] : 0;
      const qcx = Math.floor(x / 16), qcz = Math.floor(z / 16);
      const rx0 = Math.floor(qcx / S.spacing), rz0 = Math.floor(qcz / S.spacing);
      // the game takes the first one it meets on the nearest ring with any (x outer, z inner), not the closest on it
      const lim = maxRings || 100;
      let found = null;
      ring: for (let l = 0; l <= lim; l++) {
        for (let m = -l; m <= l; m++) for (let n = -l; n <= l; n++) {
          if (Math.abs(m) !== l && Math.abs(n) !== l) continue;
          const [pcx, pcz] = S.spacing === 1 ? [rx0 + m, rz0 + n] : potentialChunk(this.seed, S, rx0 + m, rz0 + n);
          const s = this.startFor(setName, pcx, pcz);
          if (!ok(s)) continue;
          const px = pcx * 16 + ox, pz = pcz * 16 + oz;
          found = { type: s.type, x: px, z: pz, cx: pcx, cz: pcz, y: s.y, dist: Math.hypot(px - x, pz - z) };
          break ring;
        }
      }
      if (found && (!best || found.dist < best.dist)) best = found;
    }
    return best;
  }

  /* ---- pieces ---- */
  pieces(s) {
    if (s.pieces && s.built) return s.pieces;
    let list = [];
    try {
      switch (s.type) {
        case 'stronghold': list = strongholdPieces(this.seed, s.cx, s.cz); break;
        case 'fortress': list = fortressPieces(this.seed, s.cx, s.cz); break;
        case 'mineshaft': case 'mineshaft_mesa': list = s.pieces || []; break;
        default: {
          const plan = PLANS[s.type] || (s.type.startsWith('abandoned_camp') && PLANS.abandoned_camp);
          if (plan) {
            const r = largeFeature(new JRand(0), this.seed, s.cx, s.cz);
            list = plan({
              type: s.type, seed: this.seed, cx: s.cx, cz: s.cz, x0: s.cx * 16, z0: s.cz * 16, point: s, rot: s.rot || 0, r,
              ground: (x, z) => this.ground(x, z), surface: (x, z) => this.occupied(x, z), biome: (x, y, z) => this.src.biome(x, y, z), sea: this.sea,
            }) || [];
          }
        }
      }
    } catch (e) { console.error('structure', s.type, e); list = []; }
    s.pieces = list; s.built = true;
    return list;
  }
  // every structure start whose pieces may reach chunk (cx, cz)
  startsNear(cx, cz, dim) {
    const out = [];
    for (const k in SETS) {
      const S = SETS[k];
      if (S.dim !== dim) continue;
      const R = SET_REACH[k];
      if (S.rings) {
        for (const t of this.strongholdsNear(cx, cz, R)) { const s = this.startFor(k, t.cx, t.cz); if (s) out.push(s); }
        continue;
      }
      for (let rz = Math.floor((cz - R) / S.spacing); rz <= Math.floor((cz + R) / S.spacing); rz++)
        for (let rx = Math.floor((cx - R) / S.spacing); rx <= Math.floor((cx + R) / S.spacing); rx++) {
          const [pcx, pcz] = S.spacing === 1 ? [rx, rz] : potentialChunk(this.seed, S, rx, rz);
          if (Math.abs(pcx - cx) > R || Math.abs(pcz - cz) > R) continue;
          const s = this.startFor(k, pcx, pcz);
          if (s && Math.abs(pcx - cx) <= reach(s.type) && Math.abs(pcz - cz) <= reach(s.type)) out.push(s);
        }
    }
    return out;
  }
  piecesFor(cx, cz, dim) {
    const x0 = cx * 16, z0 = cz * 16, out = [];
    for (const s of this.startsNear(cx, cz, dim || 'overworld'))
      for (const p of this.pieces(s)) if (p.box.intersectsXZ(x0, z0, x0 + 15, z0 + 15)) out.push([s, p]);
    return out;
  }

  /* Build every structure piece reaching into this chunk, in the game's
     order (underground ones first, then the surface ones), and return what
     the game needs to know: chests (with their loot table), spawners and
     entities to make. */
  apply(blocks, meta, cx, cz, dim, mask) {
    const list = this.piecesFor(cx, cz, dim);
    if (!list.length) return null;
    const w = new ChunkWriter(blocks, meta, cx, cz);
    w.mask = mask || null;
    const order = t => (t.startsWith('mineshaft') || t === 'buried_treasure' || t === 'trail_ruins' || t === 'trial_chambers' ? 0
      : t === 'fortress' || t === 'ancient_city' ? 2 : 1);
    list.sort((a, b) => order(a[0].type) - order(b[0].type));
    for (const [s, p] of list) {
      // A mineshaft piece that water or lava would touch in this chunk is not built here (the game
      // checks each chunk's part of a piece the same way, so its mineshafts stop short of the sea
      // and of aquifers, the corridor cut off), and no sea hangs over a corridor.
      if (s.type.startsWith('mineshaft') && this.src.fluidNear && this.src.fluidNear(p.box, cx, cz)) continue;
      const r = new JRand(BigInt(((p.box.x0 * 73856093) ^ (p.box.y0 * 19349663) ^ (p.box.z0 * 83492791) ^ (cx * 2654435761) ^ (cz * 40503)) | 0) ^ this.seed);
      try { p.place(w, w.box, r); } catch (e) { console.error('structure piece', s.type, p.type, e); }
    }
    // (each structure with the boxes of its pieces that reach this chunk: whether the player stands inside one, for the advancements)
    return { chests: w.chests, spawners: w.spawners, entities: w.entities, structures: [...new Set(list.map(e => e[0]))].map(s => ({ type: s.type, cx: s.cx, cz: s.cz, boxes: list.filter(e => e[0] === s).map(e => e[1].box.toArray()) })) };
  }
}

/* Shorthands, one Structures per seed (and source). */
const worlds = new Map();
function worldFor(seed, src) {
  const k = String(toLong(seed));
  let w = worlds.get(k);
  if (!w || (src && w.src !== src)) { w = new Structures(seed, src); worlds.set(k, w); }
  return w;
}
export function structuresIn(seed, cx, cz, src, dim) { return worldFor(seed, src).structuresIn(cx, cz, dim); }
export function nearestStructure(seed, type, x, z, src, dim) { return worldFor(seed, src).nearest(type, x, z, dim || dimOf(type)); }
export function dimOf(type) {
  const set = SET_OF[FAMILY[type] ? FAMILY[type][0] : type];
  return set ? SETS[set].dim : 'overworld';
}
