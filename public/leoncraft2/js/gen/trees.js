/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: trees.

   The game's tree feature, piece by piece as it builds one: a trunk placer
   (straight, forking, giant 2 x 2, fancy, dark oak, mega jungle, bending,
   cherry, the mangrove's upwards branching), a foliage placer per kind of
   crown, root placers for mangroves, and decorators (vines, cocoa, bee
   nests, podzol, propagules, leaf litter, pale moss...). Also fallen
   trees, huge mushrooms and bamboo.

   Every random draw is made in the game's order from the feature's random
   generator, so the second tree of a patch starts where the first left
   off. Where the game walks a Java HashSet of positions (decorators go
   through the tree's logs and leaves in that order), the set's iteration
   order is reproduced: by hash bucket for the table size it grew to, then
   by insertion, then sorted by height as the game sorts them.

   Written from the game's behaviour (no Mojang code), checked against
   chunks the 26.3 server made.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';
import { FEATURES, provider, stateFrom, stateOf, sampleInt, predicate, tag, isAir, fluidOf, msin, mcos, strip, placeConfigured } from './features.js?v=107';

const F = Math.fround;
const MIN_Y = -64, MAX_BUILD = 320;

// named block state providers the tree data refers to (worldgen/block_state_provider)
const NAMED = {
  soil_beneath_tree: { type: 'minecraft:rule_based', rules: [{ if_true: { type: 'minecraft:not', predicate: { type: 'minecraft:matching_block_tag', tag: 'minecraft:cannot_replace_below_tree_trunk' } }, then: { id: 'minecraft:dirt' } }] },
  podzol_beneath_tree: { type: 'minecraft:rule_based', rules: [{ if_true: { type: 'minecraft:matching_block_tag', tag: 'minecraft:beneath_tree_podzol_replaceable' }, then: { id: 'minecraft:podzol', properties: { snowy: 'false' } } }] },
  mangrove_propagule: { type: 'minecraft:randomized_int', property: 'age', source: { id: 'minecraft:mangrove_propagule', properties: { age: '0', hanging: 'true', stage: '0', waterlogged: 'false' } }, values: { type: 'minecraft:uniform', max_inclusive: 4, min_inclusive: 0 } },
};
function prov(p) {
  if (p == null) return null;
  if (typeof p === 'string' && NAMED[strip(p)]) return provider(NAMED[strip(p)]);
  return provider(p);
}

/* ---- directions ---- */
const NORTH = [0, -1], EAST = [1, 0], SOUTH = [0, 1], WEST = [-1, 0];
const HORIZONTAL = [NORTH, EAST, SOUTH, WEST];
const clockwise = d => HORIZONTAL[(HORIZONTAL.indexOf(d) + 1) & 3];
const opposite = d => HORIZONTAL[(HORIZONTAL.indexOf(d) + 2) & 3];
const axisOf = d => (d[0] !== 0 ? 'x' : 'z');
// Direction.values(): down, up, north, south, west, east
const ALL6 = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

/* ---- tags (resolved lazily, the block table is ready by then) ---- */
let T = null;
function tags() {
  if (!T) T = { logs: tag('logs'), leaves: tag('leaves'), repl: tag('replaceable_by_trees'), dirt: tag('dirt'), bamboo: tag('supports_bamboo'), bambooPodzol: tag('beneath_bamboo_podzol_replaceable') };
  return T;
}

/* ---- a Java HashSet<BlockPos>, for its iteration order ---- */
class PosSet {
  constructor() { this.keys = new Map(); this.list = []; }
  static key(x, y, z) { return (x + 33554432) * 1e6 + (y + 1000) * 2000 + 0 + ((z + 33554432) % 1) + z * 1e-6; }
  has(x, y, z) { return this.keys.has(x + ',' + y + ',' + z); }
  add(x, y, z) {
    const k = x + ',' + y + ',' + z;
    if (this.keys.has(k)) return;
    this.keys.set(k, this.list.length);
    this.list.push([x, y, z]);
  }
  get size() { return this.list.length; }
  // the order the game walks it in, then sorted by y (stable)
  ordered() {
    const n = this.list.length;
    let cap = 16;
    while (n > cap * 0.75) cap *= 2;
    const keyed = this.list.map((p, i) => {
      const h = (Math.imul((p[1] + Math.imul(p[2], 31)) | 0, 31) + p[0]) | 0;
      const s = (h ^ (h >>> 16)) & (cap - 1);
      return { p, s, i };
    });
    keyed.sort((a, b) => a.s - b.s || a.i - b.i);
    const out = keyed.map(e => e.p);
    return out.map((p, i) => ({ p, i })).sort((a, b) => a.p[1] - b.p[1] || a.i - b.i).map(e => e.p);
  }
}

/* ---- block tests ---- */
function validTreePos(R, x, y, z) {
  const b = R.get(x, y, z);
  return isAir(b) || tags().repl[b] === 1;
}
const isLog = (R, x, y, z) => tags().logs[R.get(x, y, z)] === 1;
const isAirOrLeaves = (R, x, y, z) => { const b = R.get(x, y, z); return isAir(b) || tags().leaves[b] === 1; };
const isFree = (R, x, y, z) => validTreePos(R, x, y, z) || isLog(R, x, y, z);
const solidRender = b => b !== 0 && BLOCKS[b].shape === 'cube' && BLOCKS[b].pass === 'opaque';
function withAxis(st, axis) {
  if (!st.props || st.props.axis === undefined) return st;
  return stateOf({ Name: st.name, Properties: Object.assign({}, st.props, { axis }) });
}

/* ============================================================ the tree == */
function makeTree(D, cfg, r) {
  const R = D.region;
  const t = {
    D, R, r, cfg,
    logs: new PosSet(), leaves: new PosSet(), roots: new PosSet(), deco: new PosSet(),
    trunk: prov(cfg.trunk_provider), foliage: prov(cfg.foliage_provider), below: prov(cfg.below_trunk_provider),
    canGrow: null,
  };
  const tp = cfg.trunk_placer;
  if (tp && tp.can_grow_through) {
    const n = strip(tp.can_grow_through);
    t.canGrow = n.startsWith('#') ? tag(n.slice(1)) : (() => { const s = new Uint8Array(4096); for (const b of [].concat(tp.can_grow_through)) if (B[strip(b)] !== undefined) s[B[strip(b)]] = 1; return s; })();
  }
  return t;
}
const trunkValid = (t, x, y, z) => validTreePos(t.R, x, y, z) || (t.canGrow !== null && t.canGrow[t.R.get(x, y, z)] === 1);
function setLog(t, x, y, z, st) { t.logs.add(x, y, z); t.R.set(x, y, z, st.id, st.meta); }
// TrunkPlacer.placeLog: only where a tree may grow
function placeLog(t, x, y, z, axis) {
  if (!trunkValid(t, x, y, z)) return false;
  let st = t.trunk(t.r, x, y, z, t.R);
  if (axis) st = withAxis(st, axis);
  setLog(t, x, y, z, st);
  return true;
}
function placeBelow(t, x, y, z) {
  if (!t.below) return;
  const st = t.below(t.r, x, y, z, t.R);
  if (st) setLog(t, x, y, z, st);
}
function setLeaf(t, x, y, z, st) { t.leaves.add(x, y, z); t.R.set(x, y, z, st.id, st.meta); }
function tryPlaceLeaf(t, x, y, z) {
  if (!validTreePos(t.R, x, y, z)) return false;
  const st = t.foliage(t.r, x, y, z, t.R);
  setLeaf(t, x, y, z, st);
  return true;
}
function setDeco(t, x, y, z, st) { t.deco.add(x, y, z); t.R.set(x, y, z, st.id, st.meta); }

/* ---- feature sizes ---- */
function sizeAt(ms, height, y) {
  const type = strip(ms.type);
  if (type === 'three_layers_feature_size') {
    const limit = ms.limit ?? 1, upperLimit = ms.upper_limit ?? 1;
    if (y < limit) return ms.lower_size ?? 0;
    if (y >= height - upperLimit) return ms.upper_size ?? 1;
    return ms.middle_size ?? 1;
  }
  return y < (ms.limit ?? 1) ? (ms.lower_size ?? 0) : (ms.upper_size ?? 1);
}
function maxFreeHeight(t, height, x, y, z) {
  const ms = t.cfg.minimum_size, R = t.R;
  for (let i = 0; i <= height + 1; i++) {
    const j = sizeAt(ms, height, i);
    for (let k = -j; k <= j; k++) for (let l = -j; l <= j; l++) {
      const X = x + k, Y = y + i, Z = z + l;
      if (isFree(R, X, Y, Z) && (t.cfg.ignore_vines || R.get(X, Y, Z) !== B.vine)) continue;
      return i - 2;
    }
  }
  return height;
}

/* ---- trunk placers: each returns the foliage attachments ---- */
const att = (x, y, z, ro, dbl) => ({ x, y, z, ro, dbl: !!dbl });
const TRUNKS = {
  straight_trunk_placer(t, h, x, y, z) {
    placeBelow(t, x, y - 1, z);
    for (let i = 0; i < h; i++) placeLog(t, x, y + i, z);
    return [att(x, y + h, z, 0, false)];
  },
  forking_trunk_placer(t, h, x, y, z) {
    const r = t.r;
    placeBelow(t, x, y - 1, z);
    const out = [];
    const dir = HORIZONTAL[r.nextInt(4)];
    const i0 = h - r.nextInt(4) - 1;
    let j = 3 - r.nextInt(3);
    let k = x, l = z, top = null;
    for (let n = 0; n < h; n++) {
      const o = y + n;
      if (n >= i0 && j > 0) { k += dir[0]; l += dir[1]; j--; }
      if (placeLog(t, k, o, l)) top = o + 1;
    }
    if (top !== null) out.push(att(k, top, l, 1, false));
    k = x; l = z;
    const dir2 = HORIZONTAL[r.nextInt(4)];
    if (dir2 !== dir) {
      const o0 = i0 - r.nextInt(2) - 1;
      let p = 1 + r.nextInt(3);
      top = null;
      for (let q = o0; q < h && p > 0; q++, p--) {
        if (q < 1) continue;
        const rr = y + q;
        k += dir2[0]; l += dir2[1];
        if (placeLog(t, k, rr, l)) top = rr + 1;
      }
      if (top !== null) out.push(att(k, top, l, 0, false));
    }
    return out;
  },
  giant_trunk_placer(t, h, x, y, z) {
    placeBelow(t, x, y - 1, z); placeBelow(t, x + 1, y - 1, z); placeBelow(t, x, y - 1, z + 1); placeBelow(t, x + 1, y - 1, z + 1);
    const R = t.R;
    const tryLog = (dx, dy, dz) => { if (isFree(R, x + dx, y + dy, z + dz)) placeLog(t, x + dx, y + dy, z + dz); };
    for (let i = 0; i < h; i++) {
      tryLog(0, i, 0);
      if (i >= h - 1) continue;
      tryLog(1, i, 0); tryLog(1, i, 1); tryLog(0, i, 1);
    }
    return [att(x, y + h, z, 0, true)];
  },
  mega_jungle_trunk_placer(t, h, x, y, z) {
    const r = t.r;
    const out = TRUNKS.giant_trunk_placer(t, h, x, y, z);
    for (let i = h - 2 - r.nextInt(4); i > Math.trunc(h / 2); i -= 2 + r.nextInt(4)) {
      const f = F(r.nextFloat() * F(Math.PI * 2));
      let j = 0, k = 0;
      for (let l = 0; l < 5; l++) {
        j = Math.trunc(F(1.5 + F(mcos(f) * l)));
        k = Math.trunc(F(1.5 + F(msin(f) * l)));
        placeLog(t, x + j, y + i - 3 + Math.trunc(l / 2), z + k);
      }
      out.push(att(x + j, y + i, z + k, -2, false));
    }
    return out;
  },
  dark_oak_trunk_placer(t, h, x, y, z) {
    const r = t.r, R = t.R;
    const out = [];
    placeBelow(t, x, y - 1, z); placeBelow(t, x + 1, y - 1, z); placeBelow(t, x, y - 1, z + 1); placeBelow(t, x + 1, y - 1, z + 1);
    const dir = HORIZONTAL[r.nextInt(4)];
    const i0 = h - r.nextInt(4);
    let j = 2 - r.nextInt(3);
    let n = x, o = z;
    const top = y + h - 1;
    for (let p = 0; p < h; p++) {
      if (p >= i0 && j > 0) { n += dir[0]; o += dir[1]; j--; }
      const q = y + p;
      if (isAirOrLeaves(R, n, q, o)) {
        placeLog(t, n, q, o); placeLog(t, n + 1, q, o); placeLog(t, n, q, o + 1); placeLog(t, n + 1, q, o + 1);
      }
    }
    out.push(att(n, top, o, 0, true));
    for (let p = -1; p <= 2; p++) for (let q = -1; q <= 2; q++) {
      if ((p >= 0 && p <= 1 && q >= 0 && q <= 1) || r.nextInt(3) > 0) continue;
      const s = r.nextInt(3) + 2;
      for (let k = 0; k < s; k++) placeLog(t, x + p, top - k - 1, z + q);
      out.push(att(x + p, top, z + q, 0, false));
    }
    return out;
  },
  fancy_trunk_placer(t, h, x, y, z) {
    const r = t.r;
    const k = h + 2;
    const l = Math.floor(k * 0.618);
    placeBelow(t, x, y - 1, z);
    const m = Math.min(1, Math.floor(1.382 + Math.pow(k / 13, 2)));
    const n = y + l;
    let j = k - 5;
    const coords = [{ x, y: y + j, z, base: n }];
    while (j >= 0) {
      const f = treeShape(k, j);
      if (!(f < 0)) {
        for (let o = 0; o < m; o++) {
          const g = f * (r.nextFloat() + 0.328);
          const hh = F(r.nextFloat() * 2) * Math.PI;
          const p = g * Math.sin(hh) + 0.5, q = g * Math.cos(hh) + 0.5;
          const bx = x + Math.floor(p), by = y + j - 1, bz = z + Math.floor(q);
          if (!makeLimb(t, bx, by, bz, bx, by + 5, bz, false)) continue;
          const dx = x - bx, dz = z - bz;
          const tt = by - Math.sqrt(dx * dx + dz * dz) * 0.381;
          const u = tt > n ? n : Math.trunc(tt);
          if (!makeLimb(t, x, u, z, bx, by, bz, false)) continue;
          coords.push({ x: bx, y: by, z: bz, base: u });
        }
      }
      j--;
    }
    makeLimb(t, x, y, z, x, y + l, z, true);
    // the branches
    for (const c of coords) {
      if ((c.x === x && c.base === c.y && c.z === z) || !(c.base - y >= k * 0.2)) continue;
      makeLimb(t, x, c.base, z, c.x, c.y, c.z, true);
    }
    const out = [];
    for (const c of coords) if (c.base - y >= k * 0.2) out.push(att(c.x, c.y, c.z, 0, false));
    return out;
  },
  bending_trunk_placer(t, h, x, y, z) {
    const r = t.r, tp = t.cfg.trunk_placer;
    const dir = HORIZONTAL[r.nextInt(4)];
    const i0 = h - 1;
    let px = x, py = y, pz = z;
    placeBelow(t, x, y - 1, z);
    const out = [];
    const minLeaves = tp.min_height_for_leaves ?? 1;
    for (let j = 0; j <= i0; j++) {
      if (j + 1 >= i0 + r.nextInt(2)) { px += dir[0]; pz += dir[1]; }
      if (validTreePos(t.R, px, py, pz)) placeLog(t, px, py, pz);
      if (j >= minLeaves) out.push(att(px, py, pz, 0, false));
      py++;
    }
    const bl = sampleInt(tp.bend_length, r);
    for (let k = 0; k <= bl; k++) {
      if (validTreePos(t.R, px, py, pz)) placeLog(t, px, py, pz);
      out.push(att(px, py, pz, 0, false));
      px += dir[0]; pz += dir[1];
    }
    return out;
  },
  upwards_branching_trunk_placer(t, h, x, y, z) {
    const r = t.r, tp = t.cfg.trunk_placer;
    const out = [];
    for (let i = 0; i < h; i++) {
      const j = y + i;
      if (placeLog(t, x, j, z) && i < h - 1 && r.nextFloat() < F(tp.place_branch_per_log_probability)) {
        const dir = HORIZONTAL[r.nextInt(4)];
        const k = sampleInt(tp.extra_branch_length, r);
        const l = Math.max(0, k - sampleInt(tp.extra_branch_length, r) - 1);
        const steps = sampleInt(tp.extra_branch_steps, r);
        // the branch
        let top = j + l, bx = x, bz = z, s = steps;
        let lx = x, ly = j, lz = z;
        for (let q = l; q < h && s > 0; q++, s--) {
          if (q < 1) continue;
          const yy = j + q;
          bx += dir[0]; bz += dir[1];
          top = yy;
          if (placeLog(t, bx, yy, bz)) top++;
          lx = bx; ly = yy; lz = bz;
          out.push(att(bx, yy, bz, 0, false));
        }
        void lx; void ly; void lz;
        if (top - j > 1) {
          out.push(att(bx, top, bz, 0, false));
          out.push(att(bx, top - 2, bz, 0, false));
        }
      }
      if (i === h - 1) out.push(att(x, j + 1, z, 0, false));
    }
    return out;
  },
  cherry_trunk_placer(t, h, x, y, z) {
    const r = t.r, tp = t.cfg.trunk_placer;
    placeBelow(t, x, y - 1, z);
    const so = tp.branch_start_offset_from_top;
    const soMin = so.min_inclusive, soMax = so.max_inclusive;
    const i = Math.max(0, h - 1 + (r.nextInt(soMax - soMin + 1) + soMin));
    let j = Math.max(0, h - 1 + (r.nextInt(soMax - 1 - soMin + 1) + soMin));
    if (j >= i) j++;
    const k = sampleInt(tp.branch_count, r);
    const three = k === 3, two = k >= 2;
    const l = three ? h : two ? Math.max(i, j) + 1 : i + 1;
    for (let m = 0; m < l; m++) placeLog(t, x, y + m, z);
    const out = [];
    if (three) out.push(att(x, y + l, z, 0, false));
    const dir = HORIZONTAL[r.nextInt(4)];
    out.push(cherryBranch(t, h, x, y, z, dir, i, i < l - 1));
    if (two) out.push(cherryBranch(t, h, x, y, z, opposite(dir), j, j < l - 1));
    return out;
  },
  poplar_trunk_placer(t, h, x, y, z) {
    // 26.x's poplars (not checked against the game): a straight trunk with a
    // few short stubs below the crown
    const r = t.r, tp = t.cfg.trunk_placer;
    placeBelow(t, x, y - 1, z);
    for (let i = 0; i < h; i++) placeLog(t, x, y + i, z);
    const n = sampleInt(tp.branch_amount, r);
    const above = tp.trunk_height_above_branches ?? 4;
    for (let k = 0; k < n; k++) {
      const d = HORIZONTAL[r.nextInt(4)];
      const by = y + Math.max(1, h - above - r.nextInt(Math.max(1, h - above)));
      placeLog(t, x + d[0], by, z + d[1], axisOf(d));
    }
    return [att(x, y + h, z, 0, false)];
  },
};
function cherryBranch(t, h, x, y, z, dir, start, notTop) {
  const r = t.r, tp = t.cfg.trunk_placer;
  let mx = x, my = y + start, mz = z;
  const i = h - 1 + sampleInt(tp.branch_end_offset_from_top, r);
  const bl2 = notTop || i < start;
  const j = sampleInt(tp.branch_horizontal_length, r) + (bl2 ? 1 : 0);
  const ex = x + dir[0] * j, ey = y + i, ez = z + dir[1] * j;
  const k = bl2 ? 2 : 1;
  const ax = axisOf(dir);
  for (let l = 0; l < k; l++) { mx += dir[0]; mz += dir[1]; placeLog(t, mx, my, mz, ax); }
  const up = ey > my ? 1 : -1;
  let o;
  while ((o = Math.abs(ex - mx) + Math.abs(ey - my) + Math.abs(ez - mz)) !== 0) {
    const f = F(Math.abs(ey - my) / o);
    const vert = r.nextFloat() < f;
    if (vert) my += up; else { mx += dir[0]; mz += dir[1]; }
    placeLog(t, mx, my, mz, vert ? null : ax);
  }
  return att(ex, ey + 1, ez, 0, false);
}
function treeShape(height, y) {
  if (F(y) < F(height * F(0.3))) return -1;
  const f = F(height / 2);
  const g = F(f - y);
  let h = F(Math.sqrt(F(F(f * f) - F(g * g))));
  if (g === 0) h = f;
  else if (Math.abs(g) >= f) return 0;
  return F(h * 0.5);
}
function makeLimb(t, sx, sy, sz, ex, ey, ez, place) {
  if (!place && sx === ex && sy === ey && sz === ez) return true;
  const dx = ex - sx, dy = ey - sy, dz = ez - sz;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const f = F(dx / steps), g = F(dy / steps), h = F(dz / steps);
  for (let j = 0; j <= steps; j++) {
    const X = sx + Math.floor(F(0.5 + F(j * f))), Y = sy + Math.floor(F(0.5 + F(j * g))), Z = sz + Math.floor(F(0.5 + F(j * h)));
    if (place) {
      const ax = Math.abs(X - sx), az = Math.abs(Z - sz), k = Math.max(ax, az);
      placeLog(t, X, Y, Z, k > 0 ? (ax === k ? 'x' : 'z') : 'y');
      continue;
    }
    if (!isFree(t.R, X, Y, Z)) return false;
  }
  return true;
}

/* ---- foliage placers ---- */
function leavesRow(t, fp, a, cx, cy, cz, range, localY, large) {
  const add = large ? 1 : 0;
  for (let j = -range; j <= range + add; j++) for (let k = -range; k <= range + add; k++) {
    if (skipSigned(t, fp, j, localY, k, range, large)) continue;
    tryPlaceLeaf(t, cx + j, cy + localY, cz + k);
  }
}
function skipSigned(t, fp, dx, y, dz, range, large) {
  const type = strip(fp.type);
  if (type === 'dark_oak_foliage_placer') {
    if (!(y !== 0 || !large || (dx !== -range && dx < range) || (dz !== -range && dz < range))) return true;
  }
  let i, j;
  if (large) { i = Math.min(Math.abs(dx), Math.abs(dx - 1)); j = Math.min(Math.abs(dz), Math.abs(dz - 1)); }
  else { i = Math.abs(dx); j = Math.abs(dz); }
  return SKIP[type](t, fp, i, y, j, range, large);
}
const cornerSkip = (t, fp, dx, y, dz, range) => dx === range && dz === range && range > 0;
const SKIP = {
  blob_foliage_placer: (t, fp, dx, y, dz, range) => dx === range && dz === range && (t.r.nextInt(2) === 0 || y === 0),
  fancy_foliage_placer: (t, fp, dx, y, dz, range) => F(F(F(dx + 0.5) * F(dx + 0.5)) + F(F(dz + 0.5) * F(dz + 0.5))) > F(range * range),
  bush_foliage_placer: (t, fp, dx, y, dz, range) => dx === range && dz === range && t.r.nextInt(2) === 0,
  spruce_foliage_placer: cornerSkip,
  pine_foliage_placer: cornerSkip,
  acacia_foliage_placer: (t, fp, dx, y, dz, range) => (y === 0 ? (dx > 1 || dz > 1) && dx !== 0 && dz !== 0 : dx === range && dz === range && range > 0),
  dark_oak_foliage_placer: (t, fp, dx, y, dz, range, large) => {
    if (y === -1 && !large) return dx === range && dz === range;
    if (y === 1) return dx + dz > range * 2 - 2;
    return false;
  },
  jungle_foliage_placer: (t, fp, dx, y, dz, range) => (dx + dz >= 7 ? true : dx * dx + dz * dz > range * range),
  mega_pine_foliage_placer: (t, fp, dx, y, dz, range) => (dx + dz >= 7 ? true : dx * dx + dz * dz > range * range),
  random_spread_foliage_placer: () => false,
  cherry_foliage_placer: (t, fp, dx, y, dz, range) => {
    const r = t.r;
    if (y === -1 && (dx === range || dz === range) && r.nextFloat() < F(fp.wide_bottom_layer_hole_chance)) return true;
    const corner = dx === range && dz === range;
    if (range > 2) return corner || (dx + dz > range * 2 - 2 && r.nextFloat() < F(fp.corner_hole_chance));
    return corner && r.nextFloat() < F(fp.corner_hole_chance);
  },
  poplar_foliage_placer: (t, fp, dx, y, dz, range) => (dx === range && dz === range) || (dx + dz >= range && t.r.nextFloat() < F(fp.side_hole_chance ?? 0)),
};
function rowWithHanging(t, fp, a, cx, cy, cz, range, localY, large, hang, ext) {
  leavesRow(t, fp, a, cx, cy, cz, range, localY, large);
  const add = large ? 1 : 0;
  const lx = cx, ly = cy - 1, lz = cz;      // the "log" position the extensions measure from
  for (const d of HORIZONTAL) {
    const e = clockwise(d);
    const j = (e[0] > 0 || e[1] > 0) ? range + add : range;
    let mx = cx + e[0] * j - d[0] * range, my = cy + localY - 1, mz = cz + e[1] * j - d[1] * range;
    for (let k = -range; k < range + add; k++) {
      const set = t.leaves.has(mx, my + 1, mz);
      if (set && tryExtension(t, hang, lx, ly, lz, mx, my, mz)) tryExtension(t, ext, lx, ly, lz, mx, my - 1, mz);
      mx += d[0]; mz += d[1];
    }
  }
}
function tryExtension(t, chance, lx, ly, lz, x, y, z) {
  if (Math.abs(x - lx) + Math.abs(y - ly) + Math.abs(z - lz) >= 7) return false;
  if (t.r.nextFloat() > F(chance)) return false;
  return tryPlaceLeaf(t, x, y, z);
}
const FOLIAGE = {
  blob_foliage_placer: {
    height: (t, fp) => fp.height ?? 3,
    place(t, fp, a, fh, fr, off) {
      for (let i = off; i >= off - fh; i--) {
        const j = Math.max(fr + a.ro - 1 - Math.trunc(i / 2), 0);
        leavesRow(t, fp, a, a.x, a.y, a.z, j, i, a.dbl);
      }
    },
  },
  fancy_foliage_placer: {
    height: (t, fp) => fp.height ?? 4,
    place(t, fp, a, fh, fr, off) {
      for (let i = off; i >= off - fh; i--) {
        const j = fr + (i === off || i === off - fh ? 0 : 1);
        leavesRow(t, fp, a, a.x, a.y, a.z, j, i, a.dbl);
      }
    },
  },
  bush_foliage_placer: {
    height: (t, fp) => fp.height ?? 2,
    place(t, fp, a, fh, fr, off) {
      for (let i = off; i >= off - fh; i--) leavesRow(t, fp, a, a.x, a.y, a.z, fr + a.ro - 1 - i, i, a.dbl);
    },
  },
  spruce_foliage_placer: {
    height: (t, fp, h) => Math.max(4, h - sampleInt(fp.trunk_height, t.r)),
    place(t, fp, a, fh, fr, off) {
      let i = t.r.nextInt(2), j = 1, k = 0;
      for (let l = off; l >= -fh; l--) {
        leavesRow(t, fp, a, a.x, a.y, a.z, i, l, a.dbl);
        if (i >= j) { i = k; k = 1; j = Math.min(j + 1, fr + a.ro); continue; }
        i++;
      }
    },
  },
  pine_foliage_placer: {
    height: (t, fp) => sampleInt(fp.height, t.r),
    radius: (t, fp, th) => sampleInt(fp.radius, t.r) + t.r.nextInt(Math.max(th + 1, 1)),
    place(t, fp, a, fh, fr, off) {
      let i = 0;
      for (let j = off; j >= off - fh; j--) {
        leavesRow(t, fp, a, a.x, a.y, a.z, i, j, a.dbl);
        if (i >= 1 && j === off - fh + 1) { i--; continue; }
        if (i >= fr + a.ro) continue;
        i++;
      }
    },
  },
  acacia_foliage_placer: {
    height: () => 0,
    place(t, fp, a, fh, fr, off) {
      const y = a.y + off;
      leavesRow(t, fp, a, a.x, y, a.z, fr + a.ro, -1 - fh, a.dbl);
      leavesRow(t, fp, a, a.x, y, a.z, fr - 1, -fh, a.dbl);
      leavesRow(t, fp, a, a.x, y, a.z, fr + a.ro - 1, 0, a.dbl);
    },
  },
  dark_oak_foliage_placer: {
    height: () => 4,
    place(t, fp, a, fh, fr, off) {
      const y = a.y + off;
      if (a.dbl) {
        leavesRow(t, fp, a, a.x, y, a.z, fr + 2, -1, true);
        leavesRow(t, fp, a, a.x, y, a.z, fr + 3, 0, true);
        leavesRow(t, fp, a, a.x, y, a.z, fr + 2, 1, true);
        if (t.r.nextBoolean()) leavesRow(t, fp, a, a.x, y, a.z, fr, 2, true);
      } else {
        leavesRow(t, fp, a, a.x, y, a.z, fr + 2, -1, false);
        leavesRow(t, fp, a, a.x, y, a.z, fr + 1, 0, false);
      }
    },
  },
  jungle_foliage_placer: {
    height: (t, fp) => fp.height ?? 2,
    place(t, fp, a, fh, fr, off) {
      const n = a.dbl ? fh : 1 + t.r.nextInt(2);
      for (let j = off; j >= off - n; j--) leavesRow(t, fp, a, a.x, a.y, a.z, fr + a.ro + 1 - j, j, a.dbl);
    },
  },
  mega_pine_foliage_placer: {
    height: (t, fp) => sampleInt(fp.crown_height, t.r),
    place(t, fp, a, fh, fr, off) {
      let i = 0;
      for (let j = a.y - fh + off; j <= a.y + off; j++) {
        const k = a.y - j;
        const l = fr + a.ro + Math.floor(F(F(F(k) / F(fh)) * F(3.5)));
        const m = k > 0 && l === i && (j & 1) === 0 ? l + 1 : l;
        leavesRow(t, fp, a, a.x, j, a.z, m, 0, a.dbl);
        i = l;
      }
    },
  },
  random_spread_foliage_placer: {
    height: (t, fp) => sampleInt(fp.foliage_height, t.r),
    place(t, fp, a, fh, fr) {
      const r = t.r;
      const n = fp.leaf_placement_attempts ?? 128;
      for (let i = 0; i < n; i++) {
        const dx = r.nextInt(fr) - r.nextInt(fr);
        const dy = r.nextInt(fh) - r.nextInt(fh);
        const dz = r.nextInt(fr) - r.nextInt(fr);
        tryPlaceLeaf(t, a.x + dx, a.y + dy, a.z + dz);
      }
    },
  },
  cherry_foliage_placer: {
    height: (t, fp) => sampleInt(fp.height, t.r),
    place(t, fp, a, fh, fr, off) {
      const y = a.y + off, dbl = a.dbl;
      const i = fr + a.ro - 1;
      leavesRow(t, fp, a, a.x, y, a.z, i - 2, fh - 3, dbl);
      leavesRow(t, fp, a, a.x, y, a.z, i - 1, fh - 4, dbl);
      for (let j = fh - 5; j >= 0; j--) leavesRow(t, fp, a, a.x, y, a.z, i, j, dbl);
      rowWithHanging(t, fp, a, a.x, y, a.z, i, -1, dbl, fp.hanging_leaves_chance, fp.hanging_leaves_extension_chance);
      rowWithHanging(t, fp, a, a.x, y, a.z, i - 1, -2, dbl, fp.hanging_leaves_chance, fp.hanging_leaves_extension_chance);
    },
  },
  poplar_foliage_placer: {
    // 26.x's poplars (not checked against the game): a tall narrow crown
    height: (t, fp) => sampleInt(fp.height, t.r),
    place(t, fp, a, fh, fr, off) {
      const w = Math.max(1, Math.min(2, Math.round(fr / 3)));
      for (let i = off; i >= off - fh - 2; i--) {
        const rr = (i === off || i <= off - fh - 1) ? w - 1 : w;
        leavesRow(t, fp, a, a.x, a.y, a.z, Math.max(0, rr), i, a.dbl);
      }
    },
  },
};

/* ---- root placers ---- */
function placeRootsMangrove(t, rp, x, y, z, ox, oy, oz) {
  const R = t.R, r = t.r;
  const mr = rp.mangrove_root_placement;
  const through = (() => { const n = strip(mr.can_grow_through); return n.startsWith('#') ? tag(n.slice(1)) : null; })();
  const muddyIn = new Uint8Array(4096);
  for (const b of mr.muddy_roots_in) if (B[strip(b)] !== undefined) muddyIn[B[strip(b)]] = 1;
  const canPlace = (X, Y, Z) => validTreePos(R, X, Y, Z) || (through && through[R.get(X, Y, Z)] === 1);
  for (let yy = y; yy < oy; yy++) if (!canPlace(x, yy, z)) return false;
  const list = [[ox, oy - 1, oz]];
  const maxLen = mr.max_root_length, maxW = mr.max_root_width, skew = F(mr.random_skew_chance);
  const potential = (px, py, pz, d) => {
    const below = [px, py - 1, pz], side = [px + d[0], py, pz + d[1]];
    const dist = Math.abs(px - ox) + Math.abs(py - oy) + Math.abs(pz - oz);
    if (dist > maxW - 3 && dist <= maxW) return r.nextFloat() < skew ? [below, [side[0], side[1] - 1, side[2]]] : [below];
    if (dist > maxW) return [below];
    if (r.nextFloat() < skew) return [below];
    return r.nextBoolean() ? [side] : [below];
  };
  const simulate = (px, py, pz, d, acc, layer) => {
    if (layer === maxLen || acc.length > maxLen) return false;
    for (const p of potential(px, py, pz, d)) {
      if (!canPlace(p[0], p[1], p[2])) continue;
      acc.push(p);
      if (!simulate(p[0], p[1], p[2], d, acc, layer + 1)) return false;
    }
    return true;
  };
  for (const d of HORIZONTAL) {
    const acc = [];
    if (!simulate(ox + d[0], oy, oz + d[1], d, acc, 0)) return false;
    list.push(...acc);
    list.push([ox + d[0], oy, oz + d[1]]);
  }
  const rootP = prov(rp.root_provider), muddyP = prov(mr.muddy_roots_provider);
  const above = rp.above_root_placement;
  const aboveP = above ? prov(above.above_root_provider) : null;
  for (const [X, Y, Z] of list) {
    if (muddyIn[R.get(X, Y, Z)]) {
      const st = muddyP(r, X, Y, Z, R);
      t.roots.add(X, Y, Z); R.set(X, Y, Z, st.id, st.meta);
      continue;
    }
    if (!canPlace(X, Y, Z)) continue;
    const st = rootP(r, X, Y, Z, R);
    t.roots.add(X, Y, Z); R.set(X, Y, Z, st.id, st.meta);
    if (above && r.nextFloat() < F(above.above_root_placement_chance) && isAir(R.get(X, Y + 1, Z))) {
      const s2 = aboveP(r, X, Y + 1, Z, R);
      t.roots.add(X, Y + 1, Z); R.set(X, Y + 1, Z, s2.id, s2.meta);
    }
  }
  return true;
}

/* ---- decorators ---- */
const ctxAir = (t, x, y, z) => isAir(t.R.get(x, y, z));
// a vine on the face of the block beside it (meta: 1 north, 2 east, 4 south, 8 west, as models.js keeps them)
function placeVine(t, x, y, z, face) { setDeco(t, x, y, z, { id: B.vine, meta: face }); }
function lowestTrunkOrRoot(t, logs, roots) {
  if (roots.length === 0) return logs.slice();
  if (logs.length && roots[0][1] === logs[0][1]) return logs.concat(roots);
  return roots.slice();
}
function shuffle(list, r) {
  for (let i = list.length; i > 1; i--) {
    const j = r.nextInt(i);
    const tmp = list[i - 1]; list[i - 1] = list[j]; list[j] = tmp;
  }
  return list;
}
const DECORATORS = {
  trunk_vine(t, d, ctx) {
    const r = t.r;
    for (const [x, y, z] of ctx.logs) {
      // (each on the log's side: the one west of the log hangs on its east face, and so on)
      if (r.nextInt(3) > 0 && ctxAir(t, x - 1, y, z)) placeVine(t, x - 1, y, z, 2);
      if (r.nextInt(3) > 0 && ctxAir(t, x + 1, y, z)) placeVine(t, x + 1, y, z, 8);
      if (r.nextInt(3) > 0 && ctxAir(t, x, y, z - 1)) placeVine(t, x, y, z - 1, 4);
      if (r.nextInt(3) > 0 && ctxAir(t, x, y, z + 1)) placeVine(t, x, y, z + 1, 1);
    }
  },
  leave_vine(t, d, ctx) {
    const r = t.r, p = F(d.probability);
    // on the leaf's side, and up to four more below it on the same face (hanging where the leaf's side was)
    const hang = (x, y, z, face) => {
      placeVine(t, x, y, z, face);
      let i = 4, yy = y - 1;
      while (ctxAir(t, x, yy, z) && i > 0) { placeVine(t, x, yy, z, face); yy--; i--; }
    };
    for (const [x, y, z] of ctx.leaves) {
      if (r.nextFloat() < p && ctxAir(t, x - 1, y, z)) hang(x - 1, y, z, 2);
      if (r.nextFloat() < p && ctxAir(t, x + 1, y, z)) hang(x + 1, y, z, 8);
      if (r.nextFloat() < p && ctxAir(t, x, y, z - 1)) hang(x, y, z - 1, 4);
      if (r.nextFloat() < p && ctxAir(t, x, y, z + 1)) hang(x, y, z + 1, 1);
    }
  },
  cocoa(t, d, ctx) {
    const r = t.r;
    if (r.nextFloat() >= F(d.probability)) return;
    const logs = ctx.logs;
    if (!logs.length) return;
    const y0 = logs[0][1];
    for (const [x, y, z] of logs) {
      if (y - y0 > 2) continue;
      for (const dd of HORIZONTAL) {
        const e = opposite(dd);
        if (!(r.nextFloat() <= F(0.25))) continue;
        const X = x + e[0], Z = z + e[1];
        if (!ctxAir(t, X, y, Z)) continue;
        const age = r.nextInt(3);
        void age;
        setDeco(t, X, y, Z, { id: B.cocoa, meta: HORIZONTAL.indexOf(dd) });
      }
    }
  },
  beehive(t, d, ctx) {
    const leaves = ctx.leaves, logs = ctx.logs;
    if (!logs.length) return;
    const r = t.r;
    if (r.nextFloat() >= F(d.probability)) return;
    const i = leaves.length ? Math.max(leaves[0][1] - 1, logs[0][1] + 1) : Math.min(logs[0][1] + 1 + r.nextInt(3), logs[logs.length - 1][1]);
    const list = [];
    for (const [x, y, z] of logs) if (y === i) for (const dd of [EAST, SOUTH, WEST]) list.push([x + dd[0], y, z + dd[1]]);
    if (!list.length) return;
    shuffle(list, r);
    const spot = list.find(([x, y, z]) => ctxAir(t, x, y, z) && ctxAir(t, x, y, z + 1));
    if (!spot) return;
    // the bees the nest gets (their random draws; how many waits in meta bits 5-6, entities/hives.js lets them out)
    const n = 2 + r.nextInt(2);
    for (let k = 0; k < n; k++) r.nextInt(599);
    setDeco(t, spot[0], spot[1], spot[2], { id: B.bee_nest, meta: 2 | (n << 5) });
  },
  alter_ground(t, d, ctx) {
    const P = prov(d.provider);
    const list = lowestTrunkOrRoot(t, ctx.logs, ctx.roots);
    if (!list.length) return;
    const y0 = list[0][1];
    const R = t.R, r = t.r;
    const atBlock = (x, y, z) => {
      for (let i = 2; i >= -3; i--) {
        const yy = y + i;
        const st = P(r, x, yy, z, R);
        if (st) { setDeco(t, x, yy, z, st); break; }
        if (!ctxAir(t, x, yy, z) && i < 0) break;
      }
    };
    const circle = (x, y, z) => {
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        if (Math.abs(i) === 2 && Math.abs(j) === 2) continue;
        atBlock(x + i, y, z + j);
      }
    };
    for (const [x, y, z] of list) {
      if (y !== y0) continue;
      circle(x - 1, y, z - 1); circle(x + 2, y, z - 1); circle(x - 1, y, z + 2); circle(x + 2, y, z + 2);
      for (let j = 0; j < 5; j++) {
        const k = r.nextInt(64), l = k % 8, m = Math.trunc(k / 8);
        if (l !== 0 && l !== 7 && m !== 0 && m !== 7) continue;
        circle(x - 3 + l, y, z - 3 + m);
      }
    }
  },
  attached_to_leaves(t, d, ctx) {
    const r = t.r;
    const P = prov(d.block_provider);
    const dirs = d.directions.map(n => ({ down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] })[n]);
    const excl = new Set();
    const exXZ = d.exclusion_radius_xz ?? 0, exY = d.exclusion_radius_y ?? 0, need = d.required_empty_blocks ?? 1;
    for (const [x, y, z] of shuffle(ctx.leaves.slice(), r)) {
      const dd = dirs[r.nextInt(dirs.length)];
      const X = x + dd[0], Y = y + dd[1], Z = z + dd[2];
      if (excl.has(X + ',' + Y + ',' + Z) || !(r.nextFloat() < F(d.probability))) continue;
      let ok = true;
      for (let i = 1; i <= need; i++) if (!ctxAir(t, x + dd[0] * i, y + dd[1] * i, z + dd[2] * i)) { ok = false; break; }
      if (!ok) continue;
      for (let a = -exXZ; a <= exXZ; a++) for (let b = -exY; b <= exY; b++) for (let c = -exXZ; c <= exXZ; c++) excl.add((X + a) + ',' + (Y + b) + ',' + (Z + c));
      const st = P(r, X, Y, Z, t.R);
      setDeco(t, X, Y, Z, st);
    }
  },
  attached_to_logs(t, d, ctx) {
    const r = t.r;
    const P = prov(d.block_provider);
    const dirs = d.directions.map(n => ({ down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] })[n]);
    for (const [x, y, z] of shuffle(ctx.logs.slice(), r)) {
      const dd = dirs[r.nextInt(dirs.length)];
      const X = x + dd[0], Y = y + dd[1], Z = z + dd[2];
      if (r.nextFloat() <= F(d.probability) && ctxAir(t, X, Y, Z)) setDeco(t, X, Y, Z, P(r, X, Y, Z, t.R));
    }
  },
  place_on_ground(t, d, ctx) {
    const list = lowestTrunkOrRoot(t, ctx.logs, ctx.roots);
    if (!list.length) return;
    const R = t.R, r = t.r;
    const y0 = list[0][1];
    let x0 = list[0][0], x1 = x0, z0 = list[0][2], z1 = z0;
    for (const [x, y, z] of list) { if (y !== y0) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const rad = d.radius ?? 2, hgt = d.height ?? 1, tries = d.tries ?? 128;
    const P = prov(d.block_state_provider);
    const bx0 = x0 - rad, bx1 = x1 + rad, by0 = y0 - hgt, by1 = y0 + hgt, bz0 = z0 - rad, bz1 = z1 + rad;
    for (let n = 0; n < tries; n++) {
      const x = r.nextInt(bx1 - bx0 + 1) + bx0, y = r.nextInt(by1 - by0 + 1) + by0, z = r.nextInt(bz1 - bz0 + 1) + bz0;
      const above = R.get(x, y + 1, z);
      if ((isAir(above) || above === B.vine) && solidRender(R.get(x, y, z)) && R.height('MOTION_BLOCKING_NO_LEAVES', x, z) <= y + 1) {
        setDeco(t, x, y + 1, z, P(r, x, y + 1, z, R));
      }
    }
  },
  pale_moss(t, d, ctx) {
    const r = t.r;
    const list = shuffle(ctx.logs.slice(), r);
    if (!list.length) return;
    let low = list[0];
    for (const p of list) if (p[1] < low[1]) low = p;
    if (r.nextFloat() < F(d.ground_probability)) placeConfigured(t.D, 'pale_moss_patch', r, low[0], low[1] + 1, low[2]);
    const hanger = (x, y, z) => {
      while (ctxAir(t, x, y - 1, z) && !(r.nextFloat() < 0.5)) { setDeco(t, x, y, z, { id: B.pale_hanging_moss, meta: 0 }); y--; }
      setDeco(t, x, y, z, { id: B.pale_hanging_moss, meta: 0 });
    };
    for (const [x, y, z] of ctx.logs) if (r.nextFloat() < F(d.trunk_probability) && ctxAir(t, x, y - 1, z)) hanger(x, y - 1, z);
    for (const [x, y, z] of ctx.leaves) if (r.nextFloat() < F(d.leaves_probability) && ctxAir(t, x, y - 1, z)) hanger(x, y - 1, z);
  },
  creaking_heart(t, d, ctx) {
    const r = t.r;
    const logs = ctx.logs;
    if (!logs.length) return;
    if (r.nextFloat() >= F(d.probability)) return;
    const list = shuffle(logs.slice(), r);
    const spot = list.find(([x, y, z]) => ALL6.every(([a, b, c]) => isLog(t.R, x + a, y + b, z + c)));
    // (meta 3: upright and natural, so it gives experience when broken: entities/hearts.js)
    if (spot) setDeco(t, spot[0], spot[1], spot[2], { id: B.creaking_heart, meta: 3 });
  },
  /* 26.x shelf mushrooms on a poplar's sides, standing or fallen (our own: the game's decorator was not to hand):
     with the decorator's probability, one to three of them on open sides of the log, each hanging on the log (meta:
     the face of the block it hangs on, as a button's, and bit 3 large). The game makes both sizes; how many of each
     is not known here, so it is half and half, picked from the spot (the trees' random numbers run as before). */
  shelf_mushroom(t, d, ctx) {
    const r = t.r, logs = ctx.logs;
    if (!logs.length || B.shelf_mushroom === undefined || r.nextFloat() >= F(d.probability)) return;
    const sides = [[1, 0, 1], [-1, 0, 0], [0, 1, 5], [0, -1, 4]];
    let n = 1 + r.nextInt(3);
    for (let k = 0; k < 8 && n > 0; k++) {
      const [x, y, z] = logs[r.nextInt(logs.length)], [dx, dz, face] = sides[r.nextInt(4)];
      if (!ctxAir(t, x + dx, y, z + dz)) continue;
      const X = x + dx, Z = z + dz, big = (Math.imul(X, 73428767) ^ Math.imul(Z, 912931) ^ Math.imul(y, 42317861)) >>> 13 & 1;
      setDeco(t, X, y, Z, { id: B.shelf_mushroom, meta: face | (big << 3) });
      n--;
    }
  },
};

/* ---- TreeFeature ---- */
FEATURES.tree = (D, cfg, r, x, y, z) => {
  const t = makeTree(D, cfg, r);
  const R = t.R;
  const tp = cfg.trunk_placer, fp = cfg.foliage_placer;
  const tpt = strip(tp.type), fpt = strip(fp.type);
  const trunkFn = TRUNKS[tpt], fol = FOLIAGE[fpt];
  if (!trunkFn || !fol) return false;
  const h = tp.base_height + r.nextInt((tp.height_rand_a ?? 0) + 1) + r.nextInt((tp.height_rand_b ?? 0) + 1);
  const fh = fol.height(t, fp, h);
  const k = h - fh;
  const fr = fol.radius ? fol.radius(t, fp, k) : sampleInt(fp.radius ?? 0, r);
  let ox = x, oy = y, oz = z;
  const rp = cfg.root_placer;
  if (rp) oy = y + sampleInt(rp.trunk_offset_y, r);
  const lo = Math.min(y, oy), hi = Math.max(y, oy) + h + 1;
  if (lo < MIN_Y + 1 || hi > MAX_BUILD) return false;
  const minClip = cfg.minimum_size.min_clipped_height;
  const o = maxFreeHeight(t, h, ox, oy, oz);
  if (o < h && (minClip === undefined || o < minClip)) return false;
  if (rp && !placeRootsMangrove(t, rp, x, y, z, ox, oy, oz)) return false;
  const atts = trunkFn(t, o, ox, oy, oz);
  for (const a of atts) fol.place(t, fp, a, fh, fr, sampleInt(fp.offset ?? 0, r));
  if (t.logs.size === 0 && t.leaves.size === 0) return false;
  if (cfg.decorators && cfg.decorators.length) {
    const ctx = { logs: t.logs.ordered(), leaves: t.leaves.ordered(), roots: t.roots.ordered() };
    for (const d of cfg.decorators) {
      const fn = DECORATORS[strip(d.type)];
      if (fn) fn(t, d, ctx);
    }
  }
  void R;
  return true;
};

/* ---- fallen trees ---- */
FEATURES.fallen_tree = (D, cfg, r, x, y, z) => {
  const R = D.region;
  const t = makeTree(D, { trunk_provider: cfg.trunk_provider, minimum_size: {}, ignore_vines: true }, r);
  const P = prov(cfg.trunk_provider);
  const placeLogBlock = (X, Y, Z, axis) => {
    let st = P(r, X, Y, Z, R);
    if (axis) st = withAxis(st, axis);
    R.set(X, Y, Z, st.id, st.meta);
  };
  const decorate = (logs, decos) => {
    if (!decos || !decos.length) return;
    const ctx = { logs: logs.ordered(), leaves: [], roots: [] };
    for (const d of decos) { const fn = DECORATORS[strip(d.type)]; if (fn) fn(t, d, ctx); }
  };
  // the stump
  placeLogBlock(x, y, z, null);
  const stump = new PosSet(); stump.add(x, y, z);
  decorate(stump, cfg.stump_decorators);
  const dir = HORIZONTAL[r.nextInt(4)];
  const len = sampleInt(cfg.log_length, r) - 2;
  const off = 2 + r.nextInt(2);
  let px = x + dir[0] * off, py = y, pz = z + dir[1] * off;
  const sturdyBelow = (X, Y, Z) => { const b = R.get(X, Y - 1, Z); return b !== 0 && BLOCKS[b].shape === 'cube' && BLOCKS[b].solid; };
  const mayPlaceOn = (X, Y, Z) => validTreePos(R, X, Y, Z) && sturdyBelow(X, Y, Z);
  py++;
  for (let i = 0; i < 6; i++) { if (mayPlaceOn(px, py, pz)) break; py--; }
  // can the whole log lie there?
  let gap = 0, ok = true;
  let cx = px, cz = pz;
  for (let j = 0; j < len; j++) {
    if (!validTreePos(R, cx, py, cz)) { ok = false; break; }
    if (!sturdyBelow(cx, py, cz)) { if (++gap > 2) { ok = false; break; } } else gap = 0;
    cx += dir[0]; cz += dir[1];
  }
  if (!ok) return true;
  const logs = new PosSet();
  for (let i = 0; i < len; i++) {
    placeLogBlock(px, py, pz, axisOf(dir));
    logs.add(px, py, pz);
    px += dir[0]; pz += dir[1];
  }
  decorate(logs, cfg.log_decorators);
  return true;
};

/* ---- huge mushrooms ---- */
function hugeMushroom(D, cfg, r, x, y, z, red) {
  const R = D.region;
  let h = r.nextInt(3) + 4;
  if (r.nextInt(12) === 0) h *= 2;
  const fr = cfg.foliage_radius ?? 2;
  if (y < MIN_Y + 1 || y + h + 1 >= MAX_BUILD) return false;
  if (cfg.can_place_on && !predicate(cfg.can_place_on)(R, x, y - 1, z)) return false;
  for (let j = 0; j <= h; j++) {
    const k = red ? 0 : (j <= 3 ? 0 : fr);
    for (let l = -k; l <= k; l++) for (let n = -k; n <= k; n++) {
      const b = R.get(x + l, y + j, z + n);
      if (isAir(b) || tags().leaves[b] === 1) continue;
      return false;
    }
  }
  const cap = prov(cfg.cap_provider), stem = prov(cfg.stem_provider);
  if (red) {
    for (let i = h - 3; i <= h; i++) {
      const j = i < h ? fr : fr - 1;
      for (let l = -j; l <= j; l++) for (let n = -j; n <= j; n++) {
        const e5 = l === -j || l === j, e6 = n === -j || n === j;
        if (i < h && e5 === e6) continue;
        if (solidRender(R.get(x + l, y + i, z + n))) continue;
        const st = cap(r, x, y, z, R);
        R.set(x + l, y + i, z + n, st.id, st.meta);
      }
    }
  } else {
    for (let j = -fr; j <= fr; j++) for (let k = -fr; k <= fr; k++) {
      const e5 = j === -fr || j === fr, e6 = k === -fr || k === fr;
      if (e5 && e6) continue;
      if (solidRender(R.get(x + j, y + h, z + k))) continue;
      const st = cap(r, x, y, z, R);
      R.set(x + j, y + h, z + k, st.id, st.meta);
    }
  }
  for (let i = 0; i < h; i++) {
    if (solidRender(R.get(x, y + i, z))) continue;
    const st = stem(r, x, y, z, R);
    R.set(x, y + i, z, st.id, st.meta);
  }
  return true;
}
FEATURES.huge_red_mushroom = (D, cfg, r, x, y, z) => hugeMushroom(D, cfg, r, x, y, z, true);
FEATURES.huge_brown_mushroom = (D, cfg, r, x, y, z) => hugeMushroom(D, cfg, r, x, y, z, false);

/* ---- bamboo ---- */
FEATURES.bamboo = (D, cfg, r, x, y, z) => {
  const R = D.region;
  if (!isAir(R.get(x, y, z))) return false;
  if (tags().bamboo[R.get(x, y - 1, z)] === 1) {
    const n = r.nextInt(12) + 5;
    if (r.nextFloat() < F(cfg.probability ?? 0)) {
      const k = r.nextInt(4) + 1;
      for (let l = x - k; l <= x + k; l++) for (let m = z - k; m <= z + k; m++) {
        const o = l - x, p = m - z;
        if (o * o + p * p > k * k) continue;
        const yy = R.height('WORLD_SURFACE', l, m) - 1;
        if (tags().bambooPodzol[R.get(l, yy, m)] !== 1) continue;
        R.set(l, yy, m, B.podzol, 0);
      }
    }
    // (BambooFeature: a thick bare trunk, then thick tops: large leaves done growing, large, small; meta as sim/bamboo.js)
    let yy = y;
    for (let k = 0; k < n && isAir(R.get(x, yy, z)); k++) { R.set(x, yy, z, B.bamboo, 1); yy++; }
    if (yy - y >= 3) {
      R.set(x, yy, z, B.bamboo, 1 | 8 | (2 << 4));
      R.set(x, yy - 1, z, B.bamboo, 1 | (2 << 4));
      R.set(x, yy - 2, z, B.bamboo, 1 | (1 << 4));
    }
  }
  return true;
};

export { validTreePos, PosSet };
void fluidOf; void stateFrom;
