/* ---------------------------------------------------------------------------
   Leoncraft 2 - the world simulating itself.

   What Minecraft's server does every tick, for the blocks:

     block updates   a block that changes tells its six neighbours, in the
                     game's order (west, east, down, up, north, south); they
                     check they can still stand (a torch on a wall that went),
                     and redstone works out its power
     scheduled ticks a block can ask to be looked at again in n ticks
                     (fire, repeaters, buttons, cane that lost its water);
                     due ones run in order of time, then priority, then when
                     they were asked for, as the game's tick list does
     random ticks    randomTickSpeed (3) cells of every 16 x 16 x 16
                     section near the player, picked at random each tick,
                     are "ticked": grass spreads, crops grow, leaves decay,
                     ice melts (sim/plants.js)
     precipitation   one column in sixteen chunks a tick: snow settles and
                     water freezes where it is cold, cauldrons fill in the
                     rain (sim/weather.js)

   Everything else hangs off this: farming, fire, explosions and TNT, beds,
   weather, redstone. Each part registers what its blocks do:
     sim.on(name, { random, tick, neighbor, use, placed, broken })

   The light the rules need (a crop wants 9) is the light the mesher worked
   out for the chunk, kept by world.js.
--------------------------------------------------------------------------- */
import { B, BLOCKS, MAX_ID, FLUID } from '../blocks.js?v=107';
import { CH, H, idx } from '../world-const.js?v=107';
import { BIOMES } from '../biomes.js?v=107';
import { installPlants } from './plants.js?v=107';
import { installFarming, resolveItem, itemName } from './farming.js?v=107';
import { installFire } from './fire.js?v=107';
import { Bodies } from './bodies.js?v=107';
import { Lids } from './lids.js?v=107';
import { Beams } from './beams.js?v=107';
import { Beacons } from './beacon.js?v=107';
import { Sculk } from './sculk.js?v=107';
import { Conduits } from './conduit.js?v=107';
import { installBeds } from './beds.js?v=107';
import { Weather } from './weather.js?v=107';
import { installRedstone } from './redstone.js?v=107';
import { installParts } from './rsparts.js?v=107';
import { installTripwire } from './tripwire.js?v=107';
import { installPistons } from './pistons.js?v=107';
import { installDispensers } from './dispense.js?v=107';
import { explode } from '../explosion.js?v=107';
import { blockDrops } from '../loot.js?v=107';
import { itemName as itemNameOf } from '../items.js?v=107';
import { Messages } from './messages.js?v=107';
import { installContainers } from '../containers.js?v=107';

const SIN = new Float32Array(65536);
for (let i = 0; i < 65536; i++) SIN[i] = Math.sin(i * Math.PI * 2 / 65536);
const mcCos = x => SIN[(Math.trunc(Math.fround(Math.fround(x * 10430.378) + 16384)) & 65535)];

// the game's neighbour order for block updates
export const NB6 = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];

export class Sim {
  constructor(o) {
    Object.assign(this, o);          // world, fluids, player, inv, renderer, gui, game
    this.w = o.world;
    this.n = 0;                      // ticks since the world started running here
    this.beh = new Array(MAX_ID);    // what each block does
    this.RT = new Uint8Array(MAX_ID);     // has a random tick
    this.NBR = new Uint8Array(MAX_ID);    // listens to its neighbours
    this.queue = new Map();          // "x,y,z" -> { x, y, z, b, t, p, s }
    this.qseq = 0;
    this.due = new Set();            // ticks taken off the queue to run this tick, not run yet (the game's willTickThisTick)
    this.events = [];                // block events (a piston moving), run after the random ticks: [x, y, z, b, id, param]
    this.updates = [];               // block updates waiting, drained at once
    this.draining = false;
    this.randomTickSpeed = 3;
    this.simDist = 8;                // chunks round the player that are simulated
    this.rng = Math.random;
    this.state = new Map();          // block entity-ish data by "x,y,z" (comparator output, beds in use...)
    this.msg = new Messages(o.gui);
    this.bodies = new Bodies(this);
    this.weather = new Weather(this);
    installPlants(this);
    installFarming(this);
    installFire(this);
    installBeds(this);
    installRedstone(this);
    installContainers(this);         // chests joining, spilling, droppers and dispensers firing (containers.js)
    installParts(this);
    installTripwire(this);           // tripwire hooks and their strings (sim/tripwire.js)
    installPistons(this);
    // chest and shulker box lids, open barrels, ringing bells (sim/lids.js); beacon beams (sim/beams.js)
    this.lids = new Lids(this);
    this.beams = new Beams(this);
    this.beacons = new Beacons(this);   // and the powers they give (sim/beacon.js)
    // sculk sensors hearing vibrations, shriekers shrieking (sim/sculk.js)
    this.sculk = new Sculk(this);
    // conduits waking in their frames (sim/conduit.js)
    this.conduits = new Conduits(this);
    // (sim/dispense.js has dispensers too; containers.js's run them, so they are not installed twice)
    this.w.onSet = (x, y, z, ob, om, nb, nm) => this.onSet(x, y, z, ob, om, nb, nm);
  }
  dispose() {
    if (this.w.onSet) this.w.onSet = null;
    if (this.redstone) for (const f of this.redstone.disposers || []) f();
    this.bodies.dispose();
    this.lids.dispose();
    this.beams.dispose();
    this.beacons.dispose();
    this.sculk.dispose();
    this.conduits.dispose();
    this.weather.dispose();
    this.msg.dispose();
  }

  on(name, b) {
    const id = typeof name === 'number' ? name : B[name];
    if (id === undefined) return;
    const cur = this.beh[id];
    // two parts may both care about a block (a door is redstone's and the player's): run both
    if (cur) {
      const both = {};
      for (const k of new Set([...Object.keys(cur), ...Object.keys(b)])) {
        if (cur[k] && b[k]) both[k] = (...a) => { const r1 = cur[k](...a); const r2 = b[k](...a); return r1 || r2; };
        else both[k] = cur[k] || b[k];
      }
      b = both;
    }
    this.beh[id] = b;
    if (b.random) this.RT[id] = 1;
    if (b.neighbor) this.NBR[id] = 1;
  }
  onAll(test, b) { for (const d of BLOCKS) if (d && test(d)) this.on(d.id, b); }

  /* ---- the clock: everything that happens in one game tick ---- */
  tick() {
    this.n++;
    const g = this.game;
    this.weather.tick();
    this.runScheduled();
    this.randomTicks();
    this.weather.precipitation();
    this.runEvents();
    if (this.redstone) this.redstone.tick();
    this.bodies.tick();
    this.afterTick && this.afterTick();
    for (const f of this.tickers || []) f();
    this.msg.tick();
  }
  get time() { return this.game ? this.game.time : 0; }
  set time(t) { if (this.game) this.game.time = t; }
  get creative() { return this.game && this.game.mode === 'creative'; }
  get mayBuild() { const m = this.game && this.game.mode; return m !== 'adventure' && m !== 'spectator'; }

  /* ---- scheduled ticks ---- */
  schedule(x, y, z, delay, priority) {
    const k = x + ',' + y + ',' + z;
    if (this.queue.has(k)) return;              // the game keeps the first one asked for
    this.queue.set(k, { x, y, z, b: this.w.get(x, y, z), t: this.n + Math.max(1, delay | 0), p: priority || 0, s: this.qseq++ });
  }
  scheduled(x, y, z) { return this.queue.has(x + ',' + y + ',' + z); }
  runScheduled() {
    if (!this.queue.size) return;
    const due = [];
    for (const [k, e] of this.queue) if (e.t <= this.n) { due.push(e); this.queue.delete(k); }
    if (!due.length) return;
    due.sort((a, b) => a.t - b.t || a.p - b.p || a.s - b.s);
    const run = due.slice(0, 65536);
    for (const e of run) this.due.add(e.x + ',' + e.y + ',' + e.z);
    try {
      for (const e of run) {
        this.due.delete(e.x + ',' + e.y + ',' + e.z);
        if (!this.w.loaded(e.x, e.z)) continue;
        const b = this.w.get(e.x, e.y, e.z);
        if (b !== e.b) continue;                  // the block it was for is gone
        const h = this.beh[b];
        if (h && h.tick) h.tick(this, e.x, e.y, e.z, this.w.meta(e.x, e.y, e.z));
      }
    } finally { this.due.clear(); }
  }
  // a tick for this cell is due this very tick and has not run yet
  willTickThisTick(x, y, z) { return this.due.has(x + ',' + y + ',' + z); }
  scheduledAt(x, y, z) { const e = this.queue.get(x + ',' + y + ',' + z); return e ? e.t : -1; }
  unschedule(x, y, z) { this.queue.delete(x + ',' + y + ',' + z); }

  /* ---- block events: what a piston does when it is told to move, after the tick's random ticks ----
     The same event for the same block is only queued once; ones queued while
     they run (a piston pushing a block that powers another) run this tick too. */
  blockEvent(x, y, z, b, id, param) {
    for (const e of this.events) if (e[0] === x && e[1] === y && e[2] === z && e[3] === b && e[4] === id && e[5] === param) return;
    this.events.push([x, y, z, b, id, param]);
  }
  runEvents() {
    let n = 0;
    while (this.events.length && n++ < 65536) {
      const [x, y, z, b, id, param] = this.events.shift();
      if (this.w.get(x, y, z) !== b) continue;
      const h = this.beh[b];
      if (h && h.event) h.event(this, x, y, z, this.w.meta(x, y, z), id, param);
    }
  }

  /* ---- block updates ----
     Three kinds, as the game has them: 0 a block changed (its neighbours
     re-check their shape and their power), 1 a neighbour update only (a
     button let go: power may have changed, nothing was placed), 2 a shape
     update only (a crop grew, a fire aged: observers see it, redstone does
     not need to). */
  onSet(x, y, z, ob, om, nb, nm) {
    // section counts for random ticks
    const c = this.w.chunkAt(x, z);
    if (c && c.rtc) { const s = y >> 4; if (this.RT[ob]) c.rtc[s]--; if (this.RT[nb]) c.rtc[s]++; }
    if (this.silent) return;
    if (this.sculk) this.sculk.changed(x, y, z, ob, om, nb, nm);
    const kind = this.quiet ? 2 : 0;
    if (ob !== nb && !this.quiet) {
      const h = this.beh[ob]; if (h && h.removed) h.removed(this, x, y, z, om, nb);
      const hn = this.beh[nb]; if (hn && hn.onPlace) hn.onPlace(this, x, y, z, nm, ob);
      // a log gone: the leaves round it may decay now (plants.js)
      if (this.LOGS && this.LOGS[ob] && !this.LOGS[nb]) {
        const k = Math.floor(x / 16) + ',' + Math.floor(z / 16);
        let l = this.logsGone.get(k); if (!l) this.logsGone.set(k, l = []);
        if (l.length < 4096) l.push([x, y, z]);
      }
    }
    for (const [dx, dy, dz] of NB6) this.updates.push(x + dx, y + dy, z + dz, x, y, z, kind);
    this.drain();
  }
  // tell the six neighbours of a cell that its power may have changed (the game's updateNeighborsAt)
  updateAround(x, y, z, kind) {
    for (const [dx, dy, dz] of NB6) this.updates.push(x + dx, y + dy, z + dz, x, y, z, kind === undefined ? 1 : kind);
    this.drain();
  }
  drain() {
    if (this.draining) return;
    this.draining = true;
    let n = 0;
    try {
      const u = this.updates;
      do {
        for (let i = 0; i < u.length && n < 400000; i += 7, n++) {
          const x = u[i], y = u[i + 1], z = u[i + 2];
          if (y < 0 || y >= H) continue;
          const b = this.w.get(x, y, z);
          if (!this.NBR[b]) continue;
          this.beh[b].neighbor(this, x, y, z, this.w.meta(x, y, z), u[i + 3], u[i + 4], u[i + 5], u[i + 6]);
        }
        u.length = 0;
        // dust works out its power once the updates settle (redstone.js), which may make more
        if (this.redstone) this.redstone.flush();
      } while (u.length && n < 400000);
    } finally {
      this.updates.length = 0;
      this.draining = false;
    }
  }
  // set a block as the game does (with updates); quietSet tells no neighbours (a fire ageing)
  set(x, y, z, b, m) { return this.w.set(x, y, z, b, m || 0); }
  quietSet(x, y, z, b, m) { const q = this.quiet; this.quiet = true; try { return this.w.set(x, y, z, b, m || 0); } finally { this.quiet = q; } }
  // no updates at all (dust setting its own power: redstone.js sends the right ones itself)
  silentSet(x, y, z, b, m) { const q = this.silent; this.silent = true; try { return this.w.set(x, y, z, b, m || 0); } finally { this.silent = q; } }
  get(x, y, z) { return this.w.get(x, y, z); }
  meta(x, y, z) { return this.w.meta(x, y, z); }
  name(x, y, z) { const b = this.w.get(x, y, z); return b ? BLOCKS[b].name : 'air'; }
  // a block broken by the world itself (decay, fire, an explosion): it drops what it would
  destroy(x, y, z, drops, chance) {
    const b = this.w.get(x, y, z);
    if (!b) return;
    const m = this.w.meta(x, y, z);
    if (drops !== false) this.dropLoot(x, y, z, b, m, chance === undefined ? 1 : chance);
    const d = BLOCKS[b];
    this.w.set(x, y, z, d.waterlogged ? B.water : 0, 0);
    if (this.fluids) this.fluids.around(x, y, z);
  }
  dropLoot(x, y, z, b, m, chance) {
    const h = this.beh[b];
    const list = h && h.loot ? this.lootOf(b, m, null) : null;
    if (list) {
      for (const [name, count] of list) {
        if (chance < 1 && this.rng() >= chance) continue;
        this.dropItem(x + 0.5, y + 0.5, z + 0.5, name, count);
      }
      return;
    }
    // the game's own loot table, as for a block that pops off (no tool needed)
    const out = blockDrops(this.w, x, y, z, b, m, { popped: true });
    const drops = this.game && this.game.drops;
    for (const s of out.items) {
      if (chance < 1 && this.rng() >= chance) continue;
      if (drops) drops.popFrom(x, y, z, s);
    }
  }
  // what a block gives when it breaks: [[item name, count], ...]
  lootOf(b, m, tool) {
    const h = this.beh[b];
    if (h && h.loot) { const r = h.loot(this, b, m, tool); if (r) return r; }
    const d = BLOCKS[b];
    if (!d || !d.item || FLUID[b]) return [];
    return [[d.name, 1]];
  }
  // an item into the world, as an item lying on the ground (drops.js)
  dropItem(x, y, z, name, count) {
    if (count <= 0) return;
    const id = resolveItem(name);
    const drops = this.game && this.game.drops;
    if (id && drops) { drops.popFrom(Math.floor(x), Math.floor(y), Math.floor(z), { id, count }); return; }
    if (!id || !this.inv || this.creative) return;
    // only what lands within reach is picked up straight away (no item entities yet)
    const p = this.player.pos;
    if ((p.x - x) ** 2 + (p.y + 1 - y) ** 2 + (p.z - z) ** 2 > 36) return;
    this.inv.add(id, count);
  }

  /* ---- random ticks ---- */
  sectionCounts(c) {
    if (c.rtc) return c.rtc;
    // nothing above the chunk's highest block but air, so the count stops there (a third of the chunk, often)
    const rtc = new Int32Array(H >> 4), bl = c.blocks, RT = this.RT;
    for (let i = 0, n = Math.min(bl.length, ((c.top | 0) + 1) << 8); i < n; i++) if (RT[bl[i]]) rtc[i >> 12]++;
    return (c.rtc = rtc);
  }
  randomTicks() {
    // (the world's randomTickSpeed rule, /gamerule or a server's, over the default)
    const R0 = this.game && this.game.rules, speed = R0 && Number.isFinite(R0.randomTickSpeed) ? R0.randomTickSpeed : this.randomTickSpeed;
    if (speed <= 0) return;
    const p = this.player.pos, pcx = Math.floor(p.x / CH), pcz = Math.floor(p.z / CH), R = this.simDist;
    let fresh = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R) continue;
      const c = this.w.chunkXZ(pcx + dx, pcz + dz);
      // (on a server, a chunk another player is nearer to is theirs to tick: net/net.js)
      if (!c || (this.skip && this.skip(c))) continue;
      if (!c.rtc) { if (fresh++ > 6) continue; this.sectionCounts(c); }
      const rtc = c.rtc, bl = c.blocks, ox = c.cx * CH, oz = c.cz * CH;
      for (let s = 0; s < rtc.length; s++) {
        if (rtc[s] <= 0) continue;
        for (let k = 0; k < speed; k++) {
          const r = (this.rng() * 4096) | 0, i = (s << 12) | r;
          const b = bl[i];
          if (!this.RT[b]) continue;
          const x = ox + (r & 15), z = oz + ((r >> 4) & 15), y = (s << 4) | (r >> 8);
          this.beh[b].random(this, x, y, z, c.meta[i]);
        }
      }
    }
  }
  // tick one block at random as if it were picked (tests, bone meal on some blocks)
  randomTickAt(x, y, z) {
    const b = this.w.get(x, y, z), h = this.beh[b];
    if (h && h.random) h.random(this, x, y, z, this.w.meta(x, y, z));
  }

  /* ---- light, as the game's rules read it ---- */
  rawLight(x, y, z) {
    if (y >= H) return 0xf0;
    if (y < 0) return 0;
    const c = this.w.chunkAt(x, z);
    if (!c || !c.light) return this.guessLight(x, y, z);
    const i = idx(x - c.cx * CH, y, z - c.cz * CH);
    if (i >= c.light.length) return 0xf0;
    return c.light[i];
  }
  skyLight(x, y, z) { return this.rawLight(x, y, z) >> 4; }
  blockLight(x, y, z) { return this.rawLight(x, y, z) & 15; }
  // the brightness rules see: the sky's light less how dark it is now, or the block light if more
  brightness(x, y, z, darken) {
    const l = this.rawLight(x, y, z);
    return Math.max((l >> 4) - (darken === undefined ? this.skyDarken() : darken), l & 15);
  }
  guessLight(x, y, z) {
    // no mesh yet: open sky is 15, anything under a roof dark
    for (let yy = y + 1; yy < Math.min(H, y + 64); yy++) { const b = this.w.get(x, yy, z); if (b && BLOCKS[b].opacity >= 15) return 0; }
    return 0xf0;
  }
  canSeeSky(x, y, z) {
    for (let yy = y + 1; yy < H; yy++) { const b = this.w.get(x, yy, z); if (b && BLOCKS[b].opacity > 0) return false; }
    return true;
  }
  // the top block a column's rain or snow lands on (the game's motion-blocking height map)
  topAt(x, z) {
    // from the chunk's highest block down (above it is only air)
    const c = this.w.chunkAt(x, z);
    for (let y = c ? Math.min(H - 1, c.top | 0) : H - 1; y > 0; y--) {
      const b = this.w.get(x, y, z);
      if (!b) continue;
      const d = BLOCKS[b];
      if (d.solid || d.fluid || d.leaves) return y;
    }
    return -1;
  }

  /* ---- the time of day as the game's rules see it ---- */
  // as the game works it out: in doubles, then cut to a float
  celestial() {
    const d = ((this.time / 24000 - 0.25) % 1 + 1) % 1;
    const e = 0.5 - Math.cos(d * Math.PI) / 2;
    return Math.fround(Math.fround(d * 2 + e) / 3);
  }
  // 0 by day, up to 11 at night (less again in rain and storms): what sky light loses.
  // The game's cosine is a 65 536-step table in floats, which decides the exact tick night starts
  skyDarken() {
    const d0 = 1 - this.weather.rain * 5 / 16, d1 = 1 - this.weather.thunder * 5 / 16;
    const d2 = 0.5 + 2 * Math.max(-0.25, Math.min(0.25, mcCos(Math.fround(this.celestial() * Math.fround(Math.PI * 2)))));
    return Math.floor((1 - d2 * d0 * d1) * 11);
  }
  biomeAt(x, z) { return BIOMES[this.w.biomeAt(x, z)] || BIOMES[0]; }
  // the game's temperature at a block: colder with height above y 80 (the noise wobble left out)
  tempAt(x, y, z) {
    const b = this.biomeAt(x, z), ymc = y - 64;
    return b.temp - Math.max(0, ymc - 80) * 0.05 / 40;
  }
  coldAt(x, y, z) { return this.tempAt(x, y, z) < 0.15; }
  dimension() { return (this.game && (this.game.dimension || this.game.dim)) || 'overworld'; }

  /* ---- the player's hand, for the hooks in interact.js ---- */
  use(hit, blockId, sneaking) {
    if (!hit) return false;
    // what is really in the hand (the interactor passes the block it would place, which bone meal is not)
    const heldId = this.inv ? this.inv.heldId() : blockId;
    const held = heldId ? itemNameOf(heldId) : '';
    // what is in the hand first (bone meal, a hoe, flint and steel...), then the block itself
    // (not in adventure: there only the block itself answers, a lever or a door, as in the game)
    if (this.useItem && this.mayBuild && this.useItem(held, hit, heldId, sneaking)) return true;
    if (sneaking && heldId) return false;
    const b = this.w.get(hit.x, hit.y, hit.z), h = this.beh[b];
    if (h && h.use) return !!h.use(this, hit.x, hit.y, hit.z, this.w.meta(hit.x, hit.y, hit.z), held, hit);
    return false;
  }
  // a placement about to happen: [[x, y, z, id, meta], ...] -> the list to place (empty to refuse)
  placed(list, hit, id) {
    let out = list;
    for (const f of this.placers || []) out = f(out, hit, id) || out;
    return out;
  }
  // a block broken by the player: what it drops ([[name, count]]), or null for the game's own drop
  broken(x, y, z, b, m) {
    const h = this.beh[b];
    if (h && h.broken) h.broken(this, x, y, z, m);
    if (h && h.loot) return this.lootOf(b, m, this.inv ? itemNameOf(this.inv.heldId()) : '');
    return null;
  }
  explode(x, y, z, power, o) { return explode(this.w, x, y, z, power, Object.assign({ sim: this }, o || {})); }

  /* ---- what is kept with the world ---- */
  toJSON() {
    const q = [];
    for (const e of this.queue.values()) q.push([e.x, e.y, e.z, e.t - this.n, e.p]);
    return { n: this.n, weather: this.weather.toJSON(), queue: q, state: [...this.state].filter(([, v]) => v && v.keep), bodies: this.bodies.toJSON(),
      spawnBed: this.spawnBed || null, moving: this.redstone && this.redstone.saveMoving ? this.redstone.saveMoving() : [] };
  }
  fromJSON(o) {
    if (!o) return;
    this.n = o.n || 0;
    this.weather.fromJSON(o.weather);
    for (const [x, y, z, dt, p] of o.queue || []) this.queue.set(x + ',' + y + ',' + z, { x, y, z, b: -1, t: this.n + dt, p, s: this.qseq++, fix: true });
    for (const [k, v] of o.state || []) this.state.set(k, v);
    this.bodies.fromJSON(o.bodies);
    this.spawnBed = o.spawnBed || null;
    if (this.redstone && this.redstone.loadMoving) this.redstone.loadMoving(o.moving);
    // the blocks those ticks were for are known once their chunks load
    this.fixQueue = true;
  }
  afterTick() {
    if (!this.fixQueue) return;
    let left = false;
    for (const e of this.queue.values()) {
      if (!e.fix) continue;
      if (!this.w.loaded(e.x, e.z)) { left = true; continue; }
      e.b = this.w.get(e.x, e.y, e.z); e.fix = false;
    }
    if (!left) this.fixQueue = false;
  }
}
