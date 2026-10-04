/* ---------------------------------------------------------------------------
   Leoncraft 2 - vanilla world generation: density functions.

   Since 1.18 the shape of a Minecraft world is a tree of "density
   functions" read from data (worldgen/density_function): noises, splines,
   gradients, clamps, mins and maxes... Evaluating that tree node by node
   for every block is far too slow, so each tree is turned into JavaScript
   source once and compiled. Three kinds of function come out:

     point    f(x, y, z), for single samples (aquifers, biomes, surfaces)
     column   fills a column of samples at one x, z, working everything that
              does not depend on y out once (the climate, the splines)
     block    for each block of a chunk, where the "interpolated" parts are
              read from a coarse lattice filled beforehand (the game works
              out its terrain on 4 x 8 x 4 cells and blends in between)

   The meaning of every node follows misode's deepslate (MIT,
   https://github.com/misode/deepslate, Copyright (c) 2021 Misode), which
   matches Minecraft 26.3. Two places differ on purpose: spline coordinates
   are rounded to float as the game does, and interval_select uses its
   last function above the last threshold.
--------------------------------------------------------------------------- */
import { normalNoise, Blended } from './noise.js';
import { Xoroshiro } from './random.js';

const strip = s => (typeof s === 'string' && s.startsWith('minecraft:') ? s.slice(10) : s);
const num = v => {
  if (v === Infinity) return '1e309';
  if (v === -Infinity) return '-1e309';
  const s = String(v);
  return v < 0 || Object.is(v, -0) ? '(' + s + ')' : s;
};
const F = Math.fround;

/* ============================================================ the state ==
   One per world seed: the seeded random, the noises made from it, and the
   parsed function trees. */
export class DensityState {
  constructor(data, seed) {
    this.data = data;
    this.seed = BigInt(seed);
    this.random = Xoroshiro.fromSeed(this.seed).forkPositional();
    this.noises = new Map();
    this.named = new Map();
    this.inline = new Map();
    this.blended = null;
    this.fns = [];            // compiled helper functions, shared by every compiled tree
  }
  noise(id) {
    const key = id.includes(':') ? id : 'minecraft:' + id;
    let n = this.noises.get(key);
    if (!n) {
      const def = this.data.noise[strip(key)];
      if (!def) throw new Error('no noise ' + key);
      n = normalNoise(def, this.random.fromHashOf(key));
      this.noises.set(key, n);
    }
    return n;
  }
  randomFactory(name) {
    const key = name.includes(':') ? name : 'minecraft:' + name;
    return this.random.fromHashOf(key).forkPositional();
  }

  /* ---- JSON -> nodes ---- */
  node(j) {
    if (typeof j === 'number') return { t: 'const', v: j };
    if (typeof j === 'string') {
      const name = strip(j);
      let n = this.named.get(name);
      if (!n) {
        const def = this.data.density_function[name];
        if (def === undefined) throw new Error('no density function ' + name);
        n = { t: 'ref' };               // a placeholder against cycles; filled in below
        this.named.set(name, n);
        Object.assign(n, this.node(def), { name });
      }
      return n;
    }
    const key = JSON.stringify(j);
    let n = this.inline.get(key);
    if (n) return n;
    n = this.parse(j);
    this.inline.set(key, n);
    return n;
  }
  parse(j) {
    const t = strip(j.type);
    const N = x => this.node(x);
    switch (t) {
      case 'constant': return { t: 'const', v: j.value ?? j.argument ?? 0 };
      case 'blend_alpha': return { t: 'const', v: 1 };
      case 'blend_offset': case 'beardifier': return { t: 'const', v: 0 };
      case 'blend_density': case 'cache': return N(j.input ?? j.argument);
      case 'interpolated': return { t, a: N(j.input ?? j.argument), cxz: j.cell_size_xz ?? 4, cy: j.cell_size_y ?? 4 };
      case 'old_blended_noise': return { t, xz: j.xz_scale ?? 1, y: j.y_scale ?? 1, xzf: j.xz_factor ?? 80, yf: j.y_factor ?? 160, sm: j.smear_scale_multiplier ?? 8 };
      case 'noise': return {
        t, noise: strip(j.noise), xz: j.xz_scale ?? 1, ys: j.y_scale ?? 1,
        sx: j.shift_x !== undefined ? N(j.shift_x) : null, sy: j.shift_y !== undefined ? N(j.shift_y) : null, sz: j.shift_z !== undefined ? N(j.shift_z) : null,
      };
      case 'shift_a': case 'shift_b': case 'shift': return { t, noise: strip(j.noise ?? j.argument) };
      case 'find_top_surface': return { t, d: N(j.density), ub: N(j.upper_bound), lb: j.lower_bound ?? 0, ch: j.cell_height ?? 1 };
      case 'range_choice': return { t, a: N(j.input), min: j.min_inclusive ?? 0, max: j.max_exclusive ?? 1, yes: N(j.when_in_range), no: N(j.when_out_of_range) };
      case 'clamp': return { t, a: N(j.input), min: j.min ?? 0, max: j.max ?? 1 };
      case 'interval_select': return { t, a: N(j.input), th: j.thresholds || [], fs: (j.functions || []).map(N) };
      case 'abs': case 'square': case 'cube': case 'sqrt': case 'half_negative': case 'quarter_negative':
      case 'squeeze': case 'reciprocal': case 'negate': case 'log': case 'sign':
        return { t: 'unary', op: t, a: N(j.input ?? j.argument) };
      case 'add': case 'sub': case 'mul': case 'div': case 'min': case 'max':
        return { t: 'bin', op: t, a: N(j.left ?? j.argument1), b: N(j.right ?? j.argument2) };
      case 'spline': return { t, s: this.spline(j.spline) };
      case 'gradient': return { t, axis: j.axis || 'y', tiling: j.tiling || 'clamp_to_edge', from: j.from_coordinate ?? 0, to: j.to_coordinate ?? 1, fv: j.from_value ?? 0, tv: j.to_value ?? 1 };
      case 'lerp': return { t, alpha: N(j.alpha), a: N(j.first), b: N(j.second) };
      case 'floor': case 'round': case 'ceil': case 'truncate': return { t: 'round', op: t, a: N(j.input), m: N(j.multiple) };
      case 'pow': return { t, a: N(j.base), b: N(j.exponent) };
      case 'distance_to_point': return { t, p: j.point || [0, 0, 0], metric: j.metric || 'euclidean' };
      case 'slice': return { t, axis: j.axis || 'y', c: j.coordinate ?? 0, a: N(j.input) };
    }
    throw new Error('density function type not handled: ' + t);
  }
  spline(j) {
    if (typeof j === 'number') return { c: true, v: F(j) };
    const pts = j.points || [];
    if (!pts.length) return { c: true, v: 0 };
    return {
      coord: this.node(j.coordinate),
      loc: pts.map(p => F(p.location ?? 0)),
      der: pts.map(p => F(p.derivative ?? 0)),
      val: pts.map(p => this.spline(p.value)),
    };
  }

  blendedNoise(n) {
    if (!this.blended) this.blended = new Blended(this.random.fromHashOf('minecraft:terrain'), n.xz, n.y, n.xzf, n.yf, n.sm);
    return this.blended;
  }
}

/* ======================================================= analysis bits == */
function children(n) {
  switch (n.t) {
    case 'const': case 'old_blended_noise': case 'shift_a': case 'shift_b': case 'shift': case 'gradient': case 'distance_to_point': return [];
    case 'noise': return [n.sx, n.sy, n.sz].filter(Boolean);
    case 'interpolated': case 'unary': case 'clamp': case 'slice': return [n.a];
    case 'bin': case 'pow': return [n.a, n.b];
    case 'round': return [n.a, n.m];
    case 'range_choice': return [n.a, n.yes, n.no];
    case 'interval_select': return [n.a, ...n.fs];
    case 'lerp': return [n.alpha, n.a, n.b];
    case 'find_top_surface': return [n.ub];          // the density inside is its own function
    case 'spline': return splineCoords(n.s);
  }
  return [];
}
function splineCoords(s, out = []) {
  if (s.c) return out;
  if (!out.includes(s.coord)) out.push(s.coord);
  for (const v of s.val) splineCoords(v, out);
  return out;
}
// does a node change with y? (column functions work the rest out once per column)
function yDep(n) {
  if (n._ydep !== undefined) return n._ydep;
  let r;
  switch (n.t) {
    case 'const': case 'shift_a': case 'shift_b': case 'find_top_surface': r = false; break;
    case 'gradient': r = n.axis === 'y'; break;
    case 'old_blended_noise': case 'shift': case 'distance_to_point': r = true; break;
    case 'noise': r = n.ys !== 0 || (n.sy && yDep(n.sy)) || (n.sx && yDep(n.sx)) || (n.sz && yDep(n.sz)) || false; break;
    case 'slice': r = n.axis !== 'y' && yDep(n.a); break;
    default: r = children(n).some(yDep);
  }
  if (n.t === 'find_top_surface') r = false;
  n._ydep = r;
  return r;
}

/* ============================================================ compiling == */
let fnCounter = 0;

export class Compiler {
  constructor(state) {
    this.S = state;
    this.env = { N: [], fn: [], tri, ip: [] };
    this.noiseIdx = new Map();
    this.splineFns = new Map();
    this.ftsFns = new Map();
    this.ipFns = new Map();
  }
  noiseRef(id, obj) {
    const key = id + (obj ? '' : '');
    if (!this.noiseIdx.has(key)) { this.noiseIdx.set(key, this.env.N.length); this.env.N.push(obj || this.S.noise(id)); }
    return 'N' + this.noiseIdx.get(key);
  }
  fnRef(f) {
    let i = this.env.fn.indexOf(f);
    if (i < 0) { i = this.env.fn.length; this.env.fn.push(f); }
    return 'FN' + i;
  }

  /* ---- a standalone spline: one function of its coordinates' values ---- */
  splineFn(s, coords) {
    const key = s;
    if (this.splineFns.has(key)) return this.splineFns.get(key);
    const params = coords.map((_, i) => 'c' + i);
    const body = [];
    const val = (v, out) => {
      if (v.c) return num(v.v);
      const f = this.splineFn(v, coords);
      return this.fnRef(f) + '(' + params.join(',') + ')';
    };
    const ci = coords.indexOf(s.coord);
    body.push('const c = FR(c' + ci + ');');
    const n = s.loc.length;
    const ext = (i) => {
      const d = s.der[i];
      const v = val(s.val[i]);
      if (d === 0) return 'return ' + v + ';';
      return 'return FR(' + v + ' + FR(' + num(d) + ' * FR(c - ' + num(s.loc[i]) + ')));';
    };
    body.push('if (c < ' + num(s.loc[0]) + ') { ' + ext(0) + ' }');
    for (let i = 0; i < n - 1; i++) {
      const l0 = s.loc[i], l1 = s.loc[i + 1], d0 = s.der[i], d1 = s.der[i + 1];
      const dl = F(l1 - l0);
      body.push('if (c < ' + num(l1) + ') {');
      body.push('const f = FR(FR(c - ' + num(l0) + ') / ' + num(dl) + ');');
      body.push('const v0 = ' + val(s.val[i]) + ', v1 = ' + val(s.val[i + 1]) + ';');
      body.push('const dv = FR(v1 - v0);');
      body.push('const f8 = FR(' + num(F(d0 * dl)) + ' - dv), f9 = FR(' + num(F(-d1 * dl)) + ' + dv);');
      body.push('return FR(FR(v0 + FR(f * dv)) + FR(FR(f * FR(1 - f)) * FR(f8 + FR(f * FR(f9 - f8)))));');
      body.push('}');
    }
    body.push(ext(n - 1));
    // nested splines are compiled first (inside val), so every reference exists
    const src = 'const FR = Math.fround; const FN = E.fn;\n' +
      'return function(' + params.join(',') + ') { ' + body.join('\n').replace(/FN(\d+)\(/g, 'FN[$1](') + ' };';
    const f = new Function('E', src)(this.env);
    this.splineFns.set(key, f);
    return f;
  }

  /* ---- point functions ---- */
  point(root) {
    if (root._point) return root._point;
    const f = this.build([root], 'point');
    root._point = f;
    return f;
  }
  column(root) { return this.build([root], 'column'); }
  block(roots, lattice) { return this.build(roots, 'block', lattice); }

  build(roots, mode, lattice) {
    const C = this;
    const refs = new Map();
    // count references (interpolated nodes are leaves in block mode)
    const leaf = n => (mode === 'block' && n.t === 'interpolated' && lattice && lattice.has(n));
    const visit = n => {
      const c = refs.get(n) || 0;
      refs.set(n, c + 1);
      if (c > 0) return;
      if (leaf(n)) return;
      if (n.t === 'interpolated') return;       // its own helper
      for (const ch of children(n)) visit(ch);
    };
    if (mode === 'column') visit(roots[0]); else roots.forEach(visit);
    let vid = 0;
    const nv = () => 'v' + (vid++);
    const memo = new Map();
    const loopDecl = [], topDecl = [];
    const pro = [];
    const hoisted = new Map();

    const bind = (e, S) => {
      if (/^[A-Za-z_]\w*$/.test(e) || /^\(?-?[\d.e+]+\)?$/.test(e)) return e;
      const v = nv();
      S.push('const ' + v + ' = ' + e + ';');
      return v;
    };
    const emit = (n, S, inPro) => {
      if (n.t === 'const') return num(n.v);
      if (mode === 'column' && !inPro && !yDep(n)) {
        if (hoisted.has(n)) return hoisted.get(n);
        const e = emitRaw(n, pro, true);
        const v = nv();
        pro.push('const ' + v + ' = ' + e + ';');
        hoisted.set(n, v);
        return v;
      }
      if ((refs.get(n) || 0) > 1) {
        let v = memo.get(n);
        if (!v) {
          v = 'm' + (vid++);
          memo.set(n, v);
          (mode === 'column' && !inPro ? loopDecl : topDecl).push('let ' + v + ' = NaN;');
        }
        const T = [];
        const e = emitRaw(n, T, inPro);
        S.push('if (' + v + ' !== ' + v + ') {', ...T, v + ' = ' + e + ';', '}');
        return v;
      }
      return emitRaw(n, S, inPro);
    };
    const emitRaw = (n, S, inPro) => {
      const E = (c) => emit(c, S, inPro);
      switch (n.t) {
        case 'const': return num(n.v);
        case 'interpolated': {
          if (mode === 'block' && lattice && lattice.has(n)) {
            const k = lattice.get(n);
            return 'tri(L' + k + ', ctx.bi, ctx.fx, ctx.fy, ctx.fz)';
          }
          const f = C.interpPoint(n);
          return C.fnRef(f) + '(x, y, z)';
        }
        case 'old_blended_noise': {
          const r = C.noiseRef('__blended', C.S.blendedNoise(n));
          return r + '.sample(x, y, z)';
        }
        case 'noise': {
          const r = C.noiseRef(n.noise);
          const sx = n.sx ? bind(E(n.sx), S) : null, sy = n.sy ? bind(E(n.sy), S) : null, sz = n.sz ? bind(E(n.sz), S) : null;
          const ax = (c, sc, sh) => {
            let s = sc === 0 ? '0' : sc === 1 ? c : c + ' * ' + num(sc);
            if (sh) s = sc === 0 ? sh : s + ' + ' + sh;
            return s;
          };
          return r + '.sample(' + ax('x', n.xz, sx) + ', ' + ax('y', n.ys, sy) + ', ' + ax('z', n.xz, sz) + ')';
        }
        case 'shift_a': return '(' + C.noiseRef(n.noise) + '.sample(x * 0.25, 0, z * 0.25) * 4)';
        case 'shift_b': return '(' + C.noiseRef(n.noise) + '.sample(z * 0.25, x * 0.25, 0) * 4)';
        case 'shift': return '(' + C.noiseRef(n.noise) + '.sample(x * 0.25, y * 0.25, z * 0.25) * 4)';
        case 'find_top_surface': {
          const ub = bind(E(n.ub), S);
          const f = C.fts(n);
          return C.fnRef(f) + '(x, z, ' + ub + ')';
        }
        case 'range_choice': {
          const a = bind(E(n.a), S);
          const v = nv();
          S.push('let ' + v + ';');
          const A = [], B = [];
          A.push(v + ' = ' + emit(n.yes, A, inPro) + ';');
          B.push(v + ' = ' + emit(n.no, B, inPro) + ';');
          S.push('if (' + num(n.min) + ' <= ' + a + ' && ' + a + ' < ' + num(n.max) + ') {', ...A, '} else {', ...B, '}');
          return v;
        }
        case 'clamp': {
          const a = bind(E(n.a), S);
          return '(' + a + ' < ' + num(n.min) + ' ? ' + num(n.min) + ' : ' + a + ' > ' + num(n.max) + ' ? ' + num(n.max) + ' : ' + a + ')';
        }
        case 'interval_select': {
          const a = bind(E(n.a), S);
          const v = nv();
          S.push('let ' + v + ';');
          const k = Math.min(n.th.length, n.fs.length - 1);
          for (let i = 0; i <= k; i++) {
            const T = [];
            T.push(v + ' = ' + emit(n.fs[i], T, inPro) + ';');
            if (i < k) S.push((i ? '} else ' : '') + 'if (' + a + ' < ' + num(n.th[i]) + ') {', ...T);
            else S.push(k ? '} else {' : '{', ...T, '}');
          }
          return v;
        }
        case 'unary': {
          const a = bind(E(n.a), S);
          switch (n.op) {
            case 'abs': return 'Math.abs(' + a + ')';
            case 'square': return '(' + a + ' * ' + a + ')';
            case 'cube': return '(' + a + ' * ' + a + ' * ' + a + ')';
            case 'half_negative': return '(' + a + ' > 0 ? ' + a + ' : ' + a + ' * 0.5)';
            case 'quarter_negative': return '(' + a + ' > 0 ? ' + a + ' : ' + a + ' * 0.25)';
            case 'squeeze': { const c = nv(); S.push('const ' + c + ' = ' + a + ' < -1 ? -1 : ' + a + ' > 1 ? 1 : ' + a + ';'); return '(' + c + ' / 2 - ' + c + ' * ' + c + ' * ' + c + ' / 24)'; }
            case 'reciprocal': return '(1 / ' + a + ')';
            case 'negate': return '(-' + a + ')';
            case 'sqrt': return 'Math.sqrt(' + a + ')';
            case 'log': return 'Math.log(' + a + ')';
            case 'sign': return 'Math.sign(' + a + ')';
          }
          break;
        }
        case 'bin': {
          const a = bind(E(n.a), S);
          if (n.op === 'mul' || n.op === 'div') {
            // the game skips the right side when the left is zero
            const v = nv();
            S.push('let ' + v + ' = 0;');
            const T = [];
            const b = emit(n.b, T, inPro);
            T.push(v + ' = ' + a + (n.op === 'mul' ? ' * ' : ' / ') + b + ';');
            if (/^\(?-?[\d.e+]+\)?$/.test(a)) S.push(...T); else S.push('if (' + a + ' !== 0) {', ...T, '}');
            return v;
          }
          const b = bind(E(n.b), S);
          switch (n.op) {
            case 'add': return '(' + a + ' + ' + b + ')';
            case 'sub': return '(' + a + ' - ' + b + ')';
            case 'min': return '(' + a + ' < ' + b + ' ? ' + a + ' : ' + b + ')';
            case 'max': return '(' + a + ' > ' + b + ' ? ' + a + ' : ' + b + ')';
          }
          break;
        }
        case 'spline': {
          const coords = splineCoords(n.s);
          if (n.s.c) return num(n.s.v);
          const vals = coords.map(c => bind(E(c), S));
          const f = C.splineFn(n.s, coords);
          return C.fnRef(f) + '(' + vals.join(', ') + ')';
        }
        case 'gradient': {
          const c = n.axis;
          const range = n.to - n.from;
          const v = nv();
          let co = '(' + c + ' - ' + num(n.from) + ')';
          if (n.tiling === 'repeat') co = '((' + co + ' % ' + range + ' + ' + range + ') % ' + range + ')';
          else if (n.tiling === 'mirrored_repeat') {
            const w = nv();
            S.push('const ' + w + ' = Math.floor(' + co + ' / ' + range + ');');
            co = '((' + w + ' & 1) === 0 ? ' + co + ' - ' + w + ' * ' + range + ' : ' + range + ' - (' + co + ' - ' + w + ' * ' + range + '))';
          }
          S.push('const ' + v + ' = ' + co + ' / ' + num(range) + ';');
          return '(' + v + ' < 0 ? ' + num(n.fv) + ' : ' + v + ' > 1 ? ' + num(n.tv) + ' : ' + num(n.fv) + ' + ' + v + ' * ' + num(n.tv - n.fv) + ')';
        }
        case 'lerp': {
          const al = bind(E(n.alpha), S);
          const v = nv();
          S.push('let ' + v + ';');
          const A = [], B = [], D = [];
          A.push(v + ' = ' + emit(n.a, A, inPro) + ';');
          B.push(v + ' = ' + emit(n.b, B, inPro) + ';');
          const ea = emit(n.a, D, inPro), eb = emit(n.b, D, inPro);
          D.push(v + ' = Math.fround(' + ea + ' + Math.fround(' + al + ' * Math.fround(' + eb + ' - ' + ea + ')));');
          S.push('if (' + al + ' === 0) {', ...A, '} else if (' + al + ' === 1) {', ...B, '} else {', ...D, '}');
          return v;
        }
        case 'round': {
          const a = bind(E(n.a), S), m = bind(E(n.m), S);
          const fn = { floor: 'Math.floor', round: 'Math.round', ceil: 'Math.ceil', truncate: 'Math.trunc' }[n.op];
          return '(' + m + ' === 0 ? ' + a + ' : ' + fn + '(' + a + ' / ' + m + ') * ' + m + ')';
        }
        case 'pow': return 'Math.pow(' + bind(E(n.a), S) + ', ' + bind(E(n.b), S) + ')';
        case 'distance_to_point': {
          const [px, py, pz] = n.p;
          const dx = '(' + num(px) + ' - x)', dy = '(' + num(py) + ' - y)', dz = '(' + num(pz) + ' - z)';
          if (n.metric === 'euclidean_squared') return '(' + dx + '*' + dx + '+' + dy + '*' + dy + '+' + dz + '*' + dz + ')';
          if (n.metric === 'manhattan') return '(Math.abs' + dx + '+Math.abs' + dy + '+Math.abs' + dz + ')';
          if (n.metric === 'chebyshev') return 'Math.max(Math.abs' + dx + ',Math.abs' + dy + ',Math.abs' + dz + ')';
          return 'Math.sqrt(' + dx + '*' + dx + '+' + dy + '*' + dy + '+' + dz + '*' + dz + ')';
        }
        case 'slice': {
          const f = C.point(n.a);
          const args = n.axis === 'x' ? [num(n.c), 'y', 'z'] : n.axis === 'y' ? ['x', num(n.c), 'z'] : ['x', 'y', num(n.c)];
          return C.fnRef(f) + '(' + args.join(', ') + ')';
        }
      }
      throw new Error('cannot compile ' + n.t);
    };

    let src;
    const pre = () => {
      const lines = ['const tri = E.tri; const FN = E.fn;'];
      return lines;
    };
    if (mode === 'point') {
      const S = [];
      const e = emit(roots[0], S, false);
      src = 'return function(x, y, z) {\n' + topDecl.join('\n') + '\n' + S.join('\n') + '\nreturn ' + e + ';\n};';
    } else if (mode === 'column') {
      const S = [];
      const e = emit(roots[0], S, false);
      src = 'return function(x, z, y0, dy, n, out, off) {\n' + topDecl.join('\n') + '\n' + pro.join('\n') +
        '\nfor (let k = 0; k < n; k++) {\nconst y = y0 + k * dy;\n' + loopDecl.join('\n') + '\n' + S.join('\n') +
        '\nout[off + k] = ' + e + ';\n}\n};';
    } else {
      // block: several roots, one result each into ctx.out
      const S = [];
      const es = roots.map(r => bind(emit(r, S, false), S));
      const lat = [...lattice.values()].map(k => 'const L' + k + ' = ctx.L[' + k + '];').join(' ');
      src = 'return function(x, y, z, ctx) {\n' + lat + '\n' + topDecl.join('\n') + '\n' + S.join('\n') + '\n' +
        es.map((e, i) => 'ctx.out[' + i + '] = ' + e + ';').join('\n') + '\n};';
    }
    // noise and helper references become constants of the compiled function
    const head = pre();
    for (let i = 0; i < this.env.N.length; i++) head.push('const N' + i + ' = E.N[' + i + '];');
    src = head.join('\n') + '\n' + src.replace(/FN(\d+)\(/g, 'FN[$1](');
    try {
      return new Function('E', src)(this.env);
    } catch (err) {
      console.error(src);
      throw err;
    }
  }

  /* find_top_surface: from the upper bound down in steps of the cell height,
     the first y where the density is above zero */
  fts(n) {
    if (this.ftsFns.has(n)) return this.ftsFns.get(n);
    const d = this.point(n.d);
    const lb = n.lb, ch = n.ch;
    const f = (x, z, ub) => {
      const top = Math.floor(ub / ch) * ch;
      if (top < lb) return lb;
      for (let y = top; y >= lb; y -= ch) if (d(x, y, z) > 0) return y;
      return lb;
    };
    this.ftsFns.set(n, f);
    return f;
  }

  /* an interpolated node read at single points: its cell corners are kept */
  interpPoint(n) {
    if (this.ipFns.has(n)) return this.ipFns.get(n);
    const inner = this.point(n.a);
    const w = n.cxz, h = n.cy;
    const cache = new Map();
    const corner = (x, y, z) => {
      const k = x * 73856093 ^ y * 19349663 ^ z * 83492791;
      let e = cache.get(k);
      if (e && e[0] === x && e[1] === y && e[2] === z) return e[3];
      if (cache.size > 65536) cache.clear();
      const v = inner(x, y, z);
      cache.set(k, [x, y, z, v]);
      return v;
    };
    const lz = (a, f0, f1) => (a === 0 ? f0() : a === 1 ? f1() : f0() + a * (f1() - f0()));
    const f = (x, y, z) => {
      const fx = ((x % w + w) % w) / w, fy = ((y % h + h) % h) / h, fz = ((z % w + w) % w) / w;
      const x0 = Math.floor(x / w) * w, y0 = Math.floor(y / h) * h, z0 = Math.floor(z / w) * w;
      const l2 = (zz) => lz(fy, () => lz(fx, () => corner(x0, y0, zz), () => corner(x0 + w, y0, zz)),
                                 () => lz(fx, () => corner(x0, y0 + h, zz), () => corner(x0 + w, y0 + h, zz)));
      return lz(fz, () => l2(z0), () => l2(z0 + w));
    };
    this.ipFns.set(n, f);
    return f;
  }
}

/* Trilinear read of a lattice laid out y fastest (49 per column), then x
   (5 columns), then z: x first, then y, then z, like the game's lerp3. */
export function tri(L, b, fx, fy, fz) {
  const v000 = L[b], v100 = L[b + 49], v010 = L[b + 1], v110 = L[b + 50];
  const v001 = L[b + 245], v101 = L[b + 294], v011 = L[b + 246], v111 = L[b + 295];
  const a0 = v000 + fx * (v100 - v000), a1 = v010 + fx * (v110 - v010);
  const b0 = v001 + fx * (v101 - v001), b1 = v011 + fx * (v111 - v011);
  const c0 = a0 + fy * (a1 - a0), c1 = b0 + fy * (b1 - b0);
  return c0 + fz * (c1 - c0);
}

export { yDep, children };
