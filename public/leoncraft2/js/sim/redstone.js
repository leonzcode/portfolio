/* ---------------------------------------------------------------------------
   Leoncraft 2 - redstone: power, and the dust that carries it.

   Power as the game (Java Edition) has it. Every block can give power out
   of each of its six faces, "weak" or "strong":
     weak     what the block next door feels (a lever, a lit torch, dust
              pointing at it)
     strong   that, and it also powers the block it goes into right through,
              so the block in turn powers what is round it (a torch under a
              block, a repeater into a block, a lever into the block it is on)
   A block that conducts (a full, solid, opaque block: stone, planks, wool,
   a lamp; not glass, leaves, slabs, glowstone, TNT, observers, pistons or
   the block of redstone) counts as powered as strongly as the strongest
   strong power going into it. Dust only takes power from blocks that are
   strongly powered, never from a block dust is pointing into: that is the
   game's "weak power", and why dust on top of a block lights a lamp beside
   it but not dust beside it.

   Dust works out its power once the block updates of a change settle: the
   whole stretch of joined dust at once, each piece the most of the power
   reaching it from outside and one less than the strongest piece joined to
   it. Pieces join sideways, up the side of a block (unless a block that
   conducts sits on the lower piece) and down over an edge that does not
   conduct, so power climbs a staircase of solid blocks and runs down one of
   glass but never up it. The parts that react (sim/rsparts.js,
   sim/pistons.js, sim/dispense.js) are then told, out to two blocks from
   each piece that changed, as the game tells them.

   Faces are numbered as models.js numbers them: 0 east (+x), 1 west, 2 up,
   3 down, 4 south (+z), 5 north. weak(x, y, z, f) is the power the block at
   (x, y, z) gives out of its face f; signalFrom(x, y, z, f) is the power the
   block at (x, y, z) gets from its neighbour on face f.
--------------------------------------------------------------------------- */
import { B, BLOCKS, MAX_ID } from '../blocks.js?v=107';
import { wireLinks, wireShape } from './states.js?v=107';

export const F6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const HFACE = [5, 0, 4, 1];             // a horizontal facing (north east south west) -> its face
export const FACE6 = [5, 0, 4, 1, 2, 3];       // a facing (north east south west up down) -> its face
export const FACE_H = [1, 3, -1, -1, 2, 0];    // a face -> the horizontal facing, or -1
export const FACE_F6 = [1, 3, 4, 5, 2, 0];     // a face -> the facing (north east south west up down)

export const WEAK = new Array(MAX_ID).fill(null);     // (rs, x, y, z, meta, face) -> power out of that face
export const STRONG = new Array(MAX_ID).fill(null);
export const COND = new Uint8Array(MAX_ID);            // conducts power (the game's isRedstoneConductor)
export const SOURCE = new Uint8Array(MAX_ID);          // gives power of its own (isSignalSource)

// full blocks that do not conduct (the Minecraft Wiki, Conductivity)
const NOT_CONDUCTING = new Set(['glowstone', 'redstone_block', 'observer', 'piston', 'sticky_piston', 'tnt', 'hopper', 'farmland', 'dirt_path',
  'spawner', 'beacon', 'barrier', 'trial_spawner', 'vault', 'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron', 'composter',
  'moving_piston', 'honey_block', 'chorus_flower', 'chorus_plant', 'mangrove_roots', 'scaffolding']);
for (const d of BLOCKS) {
  if (!d) continue;
  const full = d.shape === 'cube' && d.solid && (d.pass === 'opaque' || d.name === 'slime_block');
  COND[d.id] = full && !NOT_CONDUCTING.has(d.name) && !d.leaves && !/glass$/.test(d.name) ? 1 : 0;
}
const WIRE = B.redstone_wire;

export class Redstone {
  constructor(sim) {
    this.sim = sim;
    this.w = sim.w;
    this.dirty = new Set();          // dust to work out again: "x,y,z"
    this.solving = false;            // dust gives no power while dust works its own out (the game's shouldSignal)
    this.toggles = [];               // redstone torches turned off lately: [key, tick] (for burning out)
    this.polled = new Map();         // parts looked at every tick or so (comparators, daylight detectors): key -> [x, y, z]
    this.tickers = [];               // (rs) each tick, after the block events
    this.lastSolve = 0;
  }

  /* ---- reading power ---- */
  get(x, y, z) { return this.w.get(x, y, z); }
  meta(x, y, z) { return this.w.meta(x, y, z); }
  weak(x, y, z, f) { const b = this.w.get(x, y, z), fn = WEAK[b]; return fn ? fn(this, x, y, z, this.w.meta(x, y, z), f) : 0; }
  strong(x, y, z, f) { const b = this.w.get(x, y, z), fn = STRONG[b]; return fn ? fn(this, x, y, z, this.w.meta(x, y, z), f) : 0; }
  // the strong power going into a block from its six sides (the game's getDirectSignalTo)
  strongInto(x, y, z) {
    let m = 0;
    for (let g = 0; g < 6; g++) {
      const v = F6[g], s = this.strong(x + v[0], y + v[1], z + v[2], g ^ 1);
      if (s > m) { m = s; if (m >= 15) break; }
    }
    return m;
  }
  // the power the block at (x, y, z) gets from its neighbour on face f (the game's getSignal)
  signalFrom(x, y, z, f) {
    const v = F6[f], nx = x + v[0], ny = y + v[1], nz = z + v[2];
    const nb = this.w.get(nx, ny, nz), fn = WEAK[nb];
    let p = fn ? fn(this, nx, ny, nz, this.w.meta(nx, ny, nz), f ^ 1) : 0;
    if (p < 15 && COND[nb]) { const s = this.strongInto(nx, ny, nz); if (s > p) p = s; }
    return p;
  }
  // is any power reaching the block (hasNeighborSignal), and the most that is (getBestNeighborSignal)
  powered(x, y, z, skip) {
    for (let f = 0; f < 6; f++) if (f !== skip && this.signalFrom(x, y, z, f) > 0) return true;
    return false;
  }
  power(x, y, z) {
    let m = 0;
    for (let f = 0; f < 6; f++) { const p = this.signalFrom(x, y, z, f); if (p > m) { m = p; if (m >= 15) break; } }
    return m;
  }
  // a full face to stand on or hang from (the game's isFaceSturdy, near enough)
  sturdy(x, y, z, f) {
    const b = this.w.get(x, y, z);
    if (!b) return false;
    const d = BLOCKS[b];
    if (!d.solid && d.name !== 'hopper') return false;
    if (d.shape === 'cube' || d.shape === 'cactus') return d.name !== 'hopper' || f === 2;
    const m = this.w.meta(x, y, z);
    // (a sculk sensor or a daylight detector is a low slab whatever its meta holds: only its foot is full)
    if (d.shape === 'slab') { const t = /_slab$/.test(d.name) ? m & 3 : 0; return t === 2 || (t === 1 ? f === 2 : f === 3); }
    if (d.shape === 'stairs') return f === (m & 4 ? 2 : 3);
    return false;
  }

  /* ---- telling blocks ---- */
  // one block hears that its neighbour at (fx, fy, fz) changed (the game's neighborChanged)
  update(x, y, z, fx, fy, fz, kind) { this.sim.updates.push(x, y, z, fx, fy, fz, kind === undefined ? 1 : kind); }
  // the six round a block (updateNeighborsAt)
  around(x, y, z, kind, skip) {
    const u = this.sim.updates, k = kind === undefined ? 1 : kind;
    for (let f = 0; f < 6; f++) if (f !== skip) { const v = F6[f]; u.push(x + v[0], y + v[1], z + v[2], x, y, z, k); }
  }
  // and the six round each of those (what a torch or a lever's block does)
  around2(x, y, z) { for (const v of F6) this.around(x + v[0], y + v[1], z + v[2]); }
  // the block in front of a part that gives power one way, and those round it (updateNeighborsInFront)
  front(x, y, z, f) {
    const v = F6[f], fx = x + v[0], fy = y + v[1], fz = z + v[2];
    this.update(fx, fy, fz, x, y, z);
    this.around(fx, fy, fz, 1, f ^ 1);
  }
  // only shape updates: what observers watch
  shapes(x, y, z) { const u = this.sim.updates; for (const v of F6) u.push(x + v[0], y + v[1], z + v[2], x, y, z, 2); }
  go() { this.sim.drain(); }
  // a part changing its own state, as the game's setBlock with flag 2: its look and the observers round it, nothing else
  setState(x, y, z, b, m) {
    if (!this.sim.silentSet(x, y, z, b, m)) return false;
    this.shapes(x, y, z);
    return true;
  }

  /* ---- dust ---- */
  isWire(x, y, z) { return this.w.get(x, y, z) === WIRE; }
  // the four sides a piece of dust points (north east south west), as it is drawn
  wireSides(x, y, z, m) {
    const w = this.w;
    const nb = (dx, dy, dz) => { const b = w.get(x + dx, y + dy, z + dz); return b ? { d: BLOCKS[b], m: w.meta(x + dx, y + dy, z + dz) } : null; };
    return wireShape(wireLinks(nb), m);
  }
  dirtyWire(x, y, z) { this.dirty.add(x + ',' + y + ',' + z); }
  // dust placed or taken away: the dust round it, and what is round that, hear of it (updateNeighborsOfNeighboringWires)
  wireChanged(x, y, z) {
    const corner = (cx, cy, cz) => { if (this.isWire(cx, cy, cz)) { this.update(cx, cy, cz, x, y, z); this.around(cx, cy, cz); } };
    for (let k = 0; k < 4; k++) { const v = F6[HFACE[k]]; corner(x + v[0], y, z + v[2]); }
    for (let k = 0; k < 4; k++) {
      const v = F6[HFACE[k]], sx = x + v[0], sz = z + v[2];
      if (COND[this.w.get(sx, y, sz)]) corner(sx, y + 1, sz); else corner(sx, y - 1, sz);
    }
    this.around(x, y + 1, z); this.around(x, y - 1, z);
  }
  /* Every dust whose power may have changed, worked out network by network. */
  flush() {
    if (!this.dirty.size || this.flushing) return;
    this.flushing = true;
    try {
      let guard = 0;
      while (this.dirty.size && guard++ < 10000) {
        const k = this.dirty.values().next().value;
        this.dirty.delete(k);
        const [x, y, z] = k.split(',').map(Number);
        if (this.isWire(x, y, z)) this.solve(x, y, z);
      }
    } finally { this.flushing = false; }
  }
  solve(x0, y0, z0) {
    const w = this.w, X = [], Y = [], Z = [], at = new Map();
    const add = (x, y, z) => {
      const k = x + ',' + y + ',' + z;
      if (at.has(k)) return;
      at.set(k, X.length); X.push(x); Y.push(y); Z.push(z);
      this.dirty.delete(k);
    };
    add(x0, y0, z0);
    // every piece joined to this one, either way
    for (let i = 0; i < X.length && X.length < 20000; i++) {
      const x = X[i], y = Y[i], z = Z[i];
      const coverAbove = COND[w.get(x, y + 1, z)];
      for (let k = 0; k < 4; k++) {
        const v = F6[HFACE[k]], sx = x + v[0], sz = z + v[2], sb = w.get(sx, y, sz);
        if (sb === WIRE) add(sx, y, sz);
        if (!coverAbove && w.get(sx, y + 1, sz) === WIRE) add(sx, y + 1, sz);
        if (!COND[sb] && w.get(sx, y - 1, sz) === WIRE) add(sx, y - 1, sz);
      }
    }
    const n = X.length;
    // what reaches each piece from outside the dust
    const pw = new Int8Array(n), old = new Int8Array(n);
    this.solving = true;
    try { for (let i = 0; i < n; i++) { pw[i] = this.power(X[i], Y[i], Z[i]); old[i] = w.meta(X[i], Y[i], Z[i]) & 15; } }
    finally { this.solving = false; }
    // who each piece takes power from: beside it, up a conducting block (nothing conducting over it), down past one that does not
    const outs = new Array(n);
    for (let i = 0; i < n; i++) outs[i] = [];
    for (let i = 0; i < n; i++) {
      const x = X[i], y = Y[i], z = Z[i];
      const coverAbove = COND[w.get(x, y + 1, z)];
      for (let k = 0; k < 4; k++) {
        const v = F6[HFACE[k]], sx = x + v[0], sz = z + v[2], cs = COND[w.get(sx, y, sz)];
        let j = at.get(sx + ',' + y + ',' + sz); if (j !== undefined) outs[j].push(i);
        if (cs && !coverAbove) { j = at.get(sx + ',' + (y + 1) + ',' + sz); if (j !== undefined) outs[j].push(i); }
        if (!cs) { j = at.get(sx + ',' + (y - 1) + ',' + sz); if (j !== undefined) outs[j].push(i); }
      }
    }
    // spread it, strongest first, one less a step
    const buckets = []; for (let p = 0; p <= 15; p++) buckets.push([]);
    for (let i = 0; i < n; i++) if (pw[i] > 0) buckets[pw[i]].push(i);
    for (let p = 15; p >= 2; p--) {
      const bk = buckets[p];
      for (let q = 0; q < bk.length; q++) {
        const i = bk[q];
        if (pw[i] !== p) continue;
        for (const j of outs[i]) if (pw[j] < p - 1) { pw[j] = p - 1; buckets[p - 1].push(j); }
      }
    }
    // the pieces that changed take their new power, and the blocks round them are told
    const changed = [];
    for (let i = 0; i < n; i++) if (pw[i] !== old[i]) changed.push(i);
    if (!changed.length) return;
    for (const i of changed) this.sim.silentSet(X[i], Y[i], Z[i], WIRE, (w.meta(X[i], Y[i], Z[i]) & ~15) | pw[i]);
    const told = new Set(), u = this.sim.updates;
    const tell = (x, y, z, fx, fy, fz, kind) => {
      const k = x + ',' + y + ',' + z;
      if (told.has(k) || at.has(k)) return;
      told.add(k);
      u.push(x, y, z, fx, fy, fz, kind);
    };
    // the six beside each changed piece hear it as a change (observers see it); those two away as a neighbour update
    for (const i of changed) for (const v of F6) tell(X[i] + v[0], Y[i] + v[1], Z[i] + v[2], X[i], Y[i], Z[i], 0);
    for (const i of changed) for (const v of F6) {
      const ax = X[i] + v[0], ay = Y[i] + v[1], az = Z[i] + v[2];
      for (const v2 of F6) tell(ax + v2[0], ay + v2[1], az + v2[2], ax, ay, az, 1);
    }
    this.lastSolve = n;
  }

  /* ---- each tick, after the scheduled ticks and the block events ---- */
  tick() {
    const s = this.sim;
    // torches turned off over 60 ticks ago no longer count towards burning out
    while (this.toggles.length && s.n - this.toggles[0][1] > 60) this.toggles.shift();
    for (const f of this.tickers) f(this);
  }
  // remember a part to look at again later (a comparator reading a chest, a daylight detector)
  poll(x, y, z, on) {
    const k = x + ',' + y + ',' + z;
    if (on) this.polled.set(k, [x, y, z]); else this.polled.delete(k);
  }
}

/* ---- the dust's own rules ---- */
function wirePower(rs, x, y, z, m, f) {
  if (rs.solving) return 0;
  const p = m & 15;
  if (!p || f === 2) return 0;          // nothing upwards
  if (f === 3) return p;                // the block it lies on
  return rs.wireSides(x, y, z, m)[FACE_H[f]] ? p : 0;
}

export function installRedstone(sim) {
  const rs = sim.redstone = new Redstone(sim);
  if (WIRE !== undefined) {
    WEAK[WIRE] = wirePower; STRONG[WIRE] = wirePower; SOURCE[WIRE] = 1;
    sim.on(WIRE, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) {
        // lying on nothing it can stay on: it pops off as an item
        if (!rs.sturdy(x, y - 1, z, 2) && s.get(x, y - 1, z) !== B.hopper) { s.destroy(x, y, z); return; }
        if (kind !== 2) rs.dirtyWire(x, y, z);
      },
      onPlace(s, x, y, z) { rs.dirtyWire(x, y, z); rs.wireChanged(x, y, z); },
      removed(s, x, y, z) { rs.wireChanged(x, y, z); },
      // a click on dust joined to nothing turns the cross into a dot, or back (and what it pointed at hears)
      use(s, x, y, z, m) {
        const links = wireLinks((dx, dy, dz) => { const b = s.get(x + dx, y + dy, z + dz); return b ? { d: BLOCKS[b], m: s.meta(x + dx, y + dy, z + dz) } : null; });
        if (links.some(l => l > 0)) return false;
        s.silentSet(x, y, z, WIRE, m ^ 16);
        rs.shapes(x, y, z);
        for (let k = 0; k < 4; k++) { const v = F6[HFACE[k]]; rs.update(x + v[0], y, z + v[2], x, y, z); rs.around(x + v[0], y, z + v[2]); }
        rs.go();
        return true;
      },
    });
  }
  return rs;
}
