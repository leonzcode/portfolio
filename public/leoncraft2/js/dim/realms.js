/* ---------------------------------------------------------------------------
   Leoncraft 2 - the dimensions in play: portals, the End, its fight, and
   the entities they bring.

   One per game, made by main.js, which calls:
     tick()                 each game tick, after the player has moved
     frame(alpha, dt)       each frame: entities drawn, the portal's purple
                            overlay, the boss bar
     use(hit, id)           a right click on a block (true: handled here)
     useAir(id)             a right click at nothing (throwing an eye)
     attack(eye)            a left click: hits the dragon or a crystal first
                            if one is nearer than the block (true: handled)
     broken(x, y, z, b)     a block was broken (portals going out)
     render state           .bossFog, .boss
     respawnPlan()          where death sends you (an anchor in the Nether)
     toJSON() / fromJSON()  portal locations per dimension, the End's fight,
                            the respawn anchor
   and passes it travel(dim, resolve, near): main.js saves, swaps the World
   for that dimension's (loading screen and all), loads the ground round
   `near`, calls resolve(world) for where to stand, and puts you there.

   Waits, as in the game: 80 ticks in a nether portal in survival (1 in
   creative), the timer running down 4 a tick outside; 10 ticks of cooldown
   after travelling, kept topped up while you stand in a portal; end portals
   and gateways at once.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=46';
import { Y0 } from '../world-const.js?v=46';
import { DIMS } from '../dims.js?v=46';
import { explode } from '../explosion.js?v=46';
import { portalShape, shapeCells, tryLight, checkPortal, findBuildSpot, buildPortal, tryEndPortal } from './portal.js?v=46';
import { EndFight, gatewayBlocks } from './endfight.js?v=46';
import { EndCrystal, EyeOfEnder, Burst, boxesTouch } from './entities.js?v=46';
import { mix32, rng } from '../noise.js?v=46';
import { portalSwirl } from './art.js?v=46';
const THREE = window.THREE;

const E = y => y - Y0;                     // world y -> engine y
const W = 0.3;                              // the player's half width

/* Where the nearest stronghold is, for a thrown eye. The structures work
   fills this in with setStrongholdLocator; until then the game's first ring
   is stood in for: three at even angles, 1280 to 2816 blocks out. */
let locator = null;
export function setStrongholdLocator(fn) { locator = fn; }
export function nearestStronghold(seed, x, z) {
  if (locator) return locator(x, z);
  const r = rng(mix32((seed | 0) ^ 0x57a0)), a0 = r() * Math.PI * 2;
  let best = null, bd = 1e18;
  for (let i = 0; i < 3; i++) {
    const a = a0 + i * Math.PI * 2 / 3, d = 1280 + r() * 1536;
    const p = { x: Math.floor(Math.cos(a) * d / 16) * 16 + 4, z: Math.floor(Math.sin(a) * d / 16) * 16 + 4 };
    const dd = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (dd < bd) { bd = dd; best = p; }
  }
  return best;
}

export class Realms {
  constructor(o) {
    this.o = o;                             // { game(), renderer, travel(dim, resolve, near), give(id, n), survival() }
    this.R = o.renderer;
    // plain colours go through the post chain's exposure only when there is one; otherwise they are drawn as they are
    this.linear = !!this.R.post;
    this.entities = [];
    this.portalTime = 0; this.cooldown = 0; this.busy = false;
    this.poi = { overworld: [], the_nether: [], the_end: [] };
    this.fightState = null;
    this.fight = null;
    this.spawnDim = 'overworld'; this.anchor = null;
    this.bossFog = false; this.boss = null;
    this.hurtCool = 0;
    /* standing in a portal: the portal's own swirl over the whole screen, as the game draws it (one
       16 pixel picture stretched across, turning as the block does), clearer the longer you stand */
    this.overlay = document.createElement('canvas');
    this.overlay.width = this.overlay.height = 16;
    this.overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;image-rendering:pixelated;';
    this.swirlAt = -1;
    const c = document.getElementById('c');
    if (c && c.parentNode) c.parentNode.insertBefore(this.overlay, c.nextSibling);
  }
  get game() { return this.o.game(); }
  get world() { return this.game.world; }
  get dim() { return this.game.dim || 'overworld'; }
  toJSON() {
    return { poi: this.poi, fight: this.fight ? this.fight.state() : this.fightState, spawnDim: this.spawnDim, anchor: this.anchor };
  }
  fromJSON(s) {
    if (!s) return;
    if (s.poi) for (const k in this.poi) this.poi[k] = s.poi[k] || [];
    this.fightState = s.fight || null;
    this.spawnDim = s.spawnDim || 'overworld'; this.anchor = s.anchor || null;
  }

  /* ---- the dimension changed (or the game started in one) ---- */
  entered() {
    for (const e of this.entities) e.dispose();
    this.entities = [];
    if (this.fight) { this.fightState = this.fight.state(); this.fight = null; }
    if (this.dim === 'the_end') this.fight = new EndFight(this, this.fightState, this.game.entry.seed | 0);
    this.boss = null; this.bossFog = false;
  }
  dispose() {
    for (const e of this.entities) e.dispose();
    this.entities = [];
    if (this.overlay.parentNode) this.overlay.parentNode.removeChild(this.overlay);
  }

  /* ---- entities ---- */
  add(e) { this.entities.push(e); this.R.scene.add(e.group); e.render(0); return e; }
  playerFeet() { const g = this.game; return g && g.player && !(g.survival && g.survival.dead) ? g.player.pos : null; }
  playerBox() { const p = this.game.player; return p ? [p.pos.x - W, p.pos.y, p.pos.z - W, p.pos.x + W, p.pos.y + p.h, p.pos.z + W] : null; }
  playerInvulnerable() { return this.game.mode === 'creative'; }
  hurtPlayer(n, source) {
    const g = this.game;
    if (g.mode === 'creative') return;
    // the dragon's wings and head are its own hits, its breath too (survival.js keeps the hurt window)
    const d = this.fight && this.fight.dragon, by = d && !d.dead ? { type: 'ender_dragon', pos: d.pos, hurt() {} } : null;
    g.survival.hurt(n, { type: source === 'dragon' ? 'mob' : source || 'generic', attacker: by, x: d ? d.pos.x : undefined, z: d ? d.pos.z : undefined });
  }
  pushPlayer(x, y, z) { const v = this.game.player.vel; v.x += x; v.y += y; v.z += z; }
  give(id, n) { if (this.o.give) this.o.give(id, n); }
  addXp(n) { const s = this.game.survival; if (s && s.addXp) s.addXp(n); }
  particles(x, y, z, colour, n) { /* small sparks: left to the particle work; bursts stand in where it matters */ }
  burst(x, y, z, size) { this.add(new Burst(this, size).at(x, y, z)); }
  canSee(a, b) {
    const w = this.world, d = b.clone().sub(a), len = d.length(), n = Math.ceil(len / 0.5);
    for (let i = 1; i < n; i++) {
      const p = a.clone().addScaledVector(d, i / n);
      const id = w.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (id && BLOCKS[id].solid && BLOCKS[id].shape === 'cube') return false;
    }
    return true;
  }
  // an explosion here: blocks, the player, the dragon's parts and other crystals
  explode(x, y, z, power, o) {
    const g = this.game, targets = [];
    if (g.player && g.mode !== 'creative') targets.push({ box: this.playerBox(), hurt: n => { g.survival.hurt(n, { type: (o && o.source) === 'bad_respawn_point' ? 'bad_respawn_point' : 'explosion', x, z }); }, push: (a, b, c) => this.pushPlayer(a, b, c) });
    for (const e of this.entities) {
      if (e.dead) continue;
      if (e instanceof EndCrystal) targets.push({ box: e.box(), hurt: () => e.hurt(1, 'explosion') });
      else if (e.partBoxes) for (const p of e.partBoxes()) targets.push({ box: p.box, hurt: n => e.hurt(n, p.name, 'explosion') });
    }
    this.burst(x, y, z, power * 0.8);
    return explode(this.world, x, y, z, power, Object.assign({ fluids: g.fluids, targets }, o || {}));
  }
  crystalDestroyed(c, source) {
    if (this.fight) this.fight.crystalDestroyed(c, source);
    else this.explode(c.pos.x, c.pos.y + 1, c.pos.z, 6, { source: 'end_crystal', by: source });
  }

  /* ---- each tick ---- */
  tick() {
    const g = this.game;
    if (!g || this.busy) return;
    if (this.hurtCool > 0) this.hurtCool--;
    if (this.fight) this.fight.tick();
    for (const e of this.entities) if (!e.dead) e.tick();
    if (this.entities.some(e => e.dead)) {
      this.entities = this.entities.filter(e => { if (e.dead) { e.dispose(); return false; } return true; });
    }
    this.portals();
    const P = g.player;
    this.boss = this.fight ? this.fight.bossBar(P ? P.pos : null) : null;
    this.bossFog = !!this.boss;
  }
  // what the player's body is in: nether portal, end portal (its surface 12 pixels up), gateway
  portals() {
    const g = this.game, p = g.player, w = this.world;
    if (!p || g.survival.dead) return;
    let nether = null, end = null, gate = null;
    for (let y = Math.floor(p.pos.y); y <= Math.floor(p.pos.y + p.h - 1e-4); y++)
      for (let z = Math.floor(p.pos.z - W); z <= Math.floor(p.pos.z + W); z++)
        for (let x = Math.floor(p.pos.x - W); x <= Math.floor(p.pos.x + W); x++) {
          const b = w.get(x, y, z);
          if (b === B.nether_portal) nether = [x, y, z];
          else if (b === B.end_portal && p.pos.y < y + 0.75) end = [x, y, z];
          else if (b === B.end_gateway) gate = [x, y, z];
        }
    if (nether) {
      if (this.cooldown > 0) this.cooldown = 10;
      else {
        this.portalTime++;
        const wait = g.mode === 'creative' ? 1 : 80;
        // (the other side made ahead while you stand here, so the loading screen after is short: main.js ahead)
        if (this.portalTime === 2 && wait > 2 && this.o.ahead) { const t = this.portalTarget(nether); if (t) this.o.ahead(t.to, t.near); }
        if (this.portalTime >= wait) { this.portalTime = 0; this.netherTravel(nether); }
      }
    } else {
      this.portalTime = Math.max(0, this.portalTime - 4);
      if (this.cooldown > 0) this.cooldown--;
    }
    if (end && this.cooldown === 0 && !this.busy) this.endTravel();
    if (gate && this.cooldown === 0 && !this.busy) this.gatewayTravel(gate);
  }

  /* ---- each frame ---- */
  frame(alpha) {
    for (const e of this.entities) e.render(alpha);
    // the game's sum: a fifth at once, then the fourth power of the time stood there (80 ticks) up to all of it
    let a = Math.min(1, this.portalTime / 80);
    if (a > 0 && a < 1) a = a * a * a * a * 0.8 + 0.2;
    this.overlay.style.opacity = a > 0 ? a.toFixed(3) : '0';
    if (a > 0) {
      const frames = portalSwirl(), f = Math.floor(performance.now() / 100) % frames.length;
      if (f !== this.swirlAt) { this.swirlAt = f; this.overlay.getContext('2d').putImageData(new ImageData(frames[f], 16, 16), 0, 0); }
    }
  }

  /* ---- travelling ---- */
  async go(dim, resolve, near) {
    if (this.busy) return;
    this.busy = true;
    try { await this.o.travel(dim, resolve, near); }
    finally { this.busy = false; this.cooldown = 10; this.portalTime = 0; this.overlay.style.opacity = '0'; }
  }
  // where a nether portal at `at` takes you from here: the dimension, the spot the coordinates give, and the ground to load
  portalTarget(at) {
    const g = this.game, from = this.dim;
    if (from === 'the_end') return null;
    const to = from === 'the_nether' ? 'overworld' : 'the_nether';
    const k = to === 'the_nether' ? 1 / 8 : 8;
    const p = g.player.pos;
    const tx = Math.floor(p.x * k), tz = Math.floor(p.z * k);
    const axis = this.world.meta(at[0], at[1], at[2]) === 2 ? 'z' : 'x';
    const D = DIMS[to], yLo = E(D.minY) + 1, yHi = E(D.minY + D.logical) - 1;
    const ty = Math.max(yLo, Math.min(yHi - 4, Math.floor(p.y)));
    // a portal known there already (the one you came through, most often): the ground is made round it,
    // not round the point the coordinates give, which can be a hundred blocks from it
    const known = this.findPortal(null, to, tx, ty, tz);
    return { to, tx, ty, tz, axis, yLo, yHi, near: known ? { x: known.x, z: known.z } : { x: tx, z: tz } };
  }
  netherTravel(at) {
    const t = this.portalTarget(at);
    if (!t) return;
    const { to, tx, ty, tz, axis, yLo, yHi } = t;
    this.go(to, world => {
      const s = this.findPortal(world, to, tx, ty, tz) || this.makePortal(world, to, tx, ty, tz, axis, yLo, yHi);
      const along = s.w / 2;
      return { x: s.x + (s.axis === 'x' ? along : 0.5), y: s.y, z: s.z + (s.axis === 'z' ? along : 0.5) };
    }, t.near);
  }
  // the nearest known portal within 128 blocks (16 in the Nether), by straight-line distance to its nearest block
  findPortal(world, dim, tx, ty, tz) {
    const r = dim === 'the_nether' ? 16 : 128;
    let best = null, bd = 1e18;
    for (const s of this.poi[dim]) {
      for (const [x, y, z] of shapeCells(s)) {
        if (Math.abs(x - tx) > r || Math.abs(z - tz) > r) continue;
        const d = (x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
    }
    // gone since (broken while you were away)? forget it and look again (world: null, before it is loaded)
    if (best && world && world.loaded(best.x, best.z) && world.get(best.x, best.y, best.z) !== B.nether_portal) {
      this.poi[dim] = this.poi[dim].filter(s => s !== best);
      return this.findPortal(world, dim, tx, ty, tz);
    }
    return best;
  }
  makePortal(world, dim, tx, ty, tz, axis, yLo, yHi) {
    const spot = findBuildSpot(world, tx, ty, tz, axis, yLo, yHi - 4);
    let s;
    if (spot) s = buildPortal(world, spot[0], spot[1], spot[2], axis, false);
    else {
      const D = DIMS[dim];
      const y = Math.max(E(70), Math.min(E(D.minY + D.logical) - 10, ty));
      s = buildPortal(world, tx, y, tz, axis, true);
    }
    this.poi[dim].push(s);
    return s;
  }
  endTravel() {
    const g = this.game;
    if (this.dim === 'the_end') {
      // the exit portal: home to your spawn point
      this.go('overworld', world => this.o.spawnPoint(world), { x: g.spawn.x, z: g.spawn.z });
      return;
    }
    if (this.dim !== 'overworld') return;
    this.go('the_end', world => {
      // the obsidian platform at (100, 48, 0), rebuilt every time, with room above it
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        world.set(100 + dx, E(48), dz, B.obsidian, 0);
        for (let k = 1; k <= 3; k++) world.set(100 + dx, E(48) + k, dz, 0, 0);
      }
      return { x: 100.5, y: E(49), z: 0.5, yaw: Math.PI / 2 };
    }, { x: 100, z: 0 });
  }
  // an end gateway: out to the islands 1024 blocks on (a return gateway built there), or back again
  async gatewayTravel(at) {
    if (this.dim !== 'the_end' || !this.fight) return;
    // (its purple flash, sim/beams.js)
    const sim = this.game && this.game.sim;
    if (sim && sim.beams && sim.beams.gatewayUsed) sim.beams.gatewayUsed(at[0], at[1], at[2]);
    const f = this.fight.s, key = at[0] + ',' + at[2];
    let exit = f.links[key];
    this.busy = true;
    try {
      if (!exit) {
        const len = Math.hypot(at[0], at[2]) || 1, dx = at[0] / len, dz = at[2] / len;
        let found = null;
        for (let d = 1024; d < 2048 && !found; d += 16) {
          const x = Math.floor(dx * d), z = Math.floor(dz * d);
          const r = await this.world.ask({ type: 'surface', x, z });
          if (r.y >= 0) found = { x, z };
        }
        if (!found) found = { x: Math.floor(dx * 1024), z: Math.floor(dz * 1024), make: true };
        exit = f.links[key] = { x: found.x, z: found.z, make: !!found.make, back: null };
      }
    } finally { this.busy = false; }
    const inner = { x: at[0], y: at[1], z: at[2] };
    // a gateway out on the islands leads back to its inner one, landing on its bedrock cap
    if (exit.inner) {
      return this.go('the_end', () => ({ x: exit.inner.x + 0.5, y: exit.inner.y + 3, z: exit.inner.z + 0.5 }), { x: exit.inner.x, z: exit.inner.z });
    }
    this.go('the_end', world => {
      let top = -1;
      for (let y = E(200); y > E(0); y--) { const b = world.get(exit.x, y, exit.z); if (b === B.end_stone) { top = y; break; } }
      if (top < 0) {
        // no island: a small one of end stone
        top = E(74);
        for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dz * dz <= 16) for (let k = 0; k < 3 - Math.floor(Math.hypot(dx, dz) / 2); k++) world.set(exit.x + dx, top - k, exit.z + dz, B.end_stone, 0);
      }
      const gy = top + 10;
      if (world.get(exit.x, gy, exit.z) !== B.end_gateway) for (const [x, y, z, b] of gatewayBlocks(exit.x, gy, exit.z)) world.set(x, y, z, b, 0);
      f.links[exit.x + ',' + exit.z] = { inner };
      return { x: exit.x + 1.5, y: top + 1, z: exit.z + 0.5 };
    }, { x: exit.x, z: exit.z });
  }

  /* ---- clicks ---- */
  use(hit, id) {
    const g = this.game, w = this.world, d = BLOCKS[id] || {}, hb = BLOCKS[hit.b] || {};
    const sneak = g.player.sneaking;
    // beds explode outside the Overworld; respawn anchors charge, set your spawn in the Nether, explode elsewhere
    if (!sneak && hb.shape === 'bed' && !DIMS[this.dim].bedsWork) {
      const m = w.meta(hit.x, hit.y, hit.z), F = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]][m & 3];
      const head = m & 8 ? [hit.x, hit.y, hit.z] : [hit.x + F[0], hit.y, hit.z + F[2]], foot = m & 8 ? [hit.x - F[0], hit.y, hit.z - F[2]] : [hit.x, hit.y, hit.z];
      w.set(head[0], head[1], head[2], 0, 0); w.set(foot[0], foot[1], foot[2], 0, 0);
      this.explode(head[0] + 0.5, head[1] + 0.5, head[2] + 0.5, 5, { fire: true, source: 'bad_respawn_point' });
      return true;
    }
    if (!sneak && hit.b === B.respawn_anchor) {
      const m = w.meta(hit.x, hit.y, hit.z) & 7;
      if (id === B.glowstone && m < 4) { w.set(hit.x, hit.y, hit.z, B.respawn_anchor, m + 1); if (g.mode !== 'creative') g.inv.takeSelected(1); return true; }
      if (m > 0) {
        if (DIMS[this.dim].anchorsWork) {
          this.spawnDim = 'the_nether'; this.anchor = { x: hit.x, y: hit.y, z: hit.z };
          // the player's respawn point (survival.js keeps it; life.js brings you back to it)
          const was = g.survival.spawnPoint;
          g.survival.spawnPoint = { dim: this.dim, x: hit.x, y: hit.y, z: hit.z, kind: 'anchor' };
          if (!was || was.dim !== this.dim || was.x !== hit.x || was.y !== hit.y || was.z !== hit.z) { if (g.sim && g.sim.msg) g.sim.msg.show('Respawn point set'); }
          return true;
        }
        w.set(hit.x, hit.y, hit.z, 0, 0);
        this.explode(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 5, { fire: true, source: 'bad_respawn_point' });
        return true;
      }
    }
    if (d.use === 'ignite') {
      // TNT is lit, not set beside (sim/bodies.js primes it), owned by the player entity, as the game's PrimedTnt owner is (net/events.js credits the blast to it)
      if (hit.b === B.tnt && g.sim && g.sim.primeTnt) { w.set(hit.x, hit.y, hit.z, 0, 0); g.sim.primeTnt(hit.x, hit.y, hit.z, (g.entities && g.entities.player) || g.player, 80); this.usedItem(id); return true; }
      const n = hit.face;
      let x = hit.x, y = hit.y, z = hit.z;
      if (!hb.replaceable || hit.b === B.fire) { x += n[0]; y += n[1]; z += n[2]; }
      const cur = w.get(x, y, z);
      const open = cur === 0 || !!(BLOCKS[cur] && BLOCKS[cur].replaceable && !BLOCKS[cur].fluid);
      if (open && this.dim !== 'the_end') {
        const s = tryLight(w, x, y, z);
        if (s) { this.poi[this.dim].push(s); this.usedItem(id); return true; }
      }
      // not a portal: the fire goes where the game puts it, by the simulation's rules (sim/fire.js): on a top
      // that holds it, or against the side of a block that burns, with nothing under it
      if (g.sim && g.sim.lightFire) return false;
      if (!open) return true;
      const below = w.get(x, y - 1, z);
      if (below && BLOCKS[below].solid) {
        w.set(x, y, z, below === B.soul_sand || below === B.soul_soil ? B.soul_fire : B.fire, 0);
        this.usedItem(id);
      }
      return true;
    }
    if (d.use === 'eye') {
      if (hit.b === B.end_portal_frame) {
        const m = w.meta(hit.x, hit.y, hit.z);
        if (!(m & 4)) {
          w.set(hit.x, hit.y, hit.z, B.end_portal_frame, m | 4);
          this.usedItem(id);
          tryEndPortal(w, hit.x, hit.y, hit.z);
        }
        return true;
      }
      this.useAir(id);
      return true;
    }
    if (d.use === 'crystal') {
      if (hit.b !== B.obsidian && hit.b !== B.bedrock) return true;
      const a1 = w.get(hit.x, hit.y + 1, hit.z), a2 = w.get(hit.x, hit.y + 2, hit.z);
      if ((a1 && a1 !== B.fire) || (a2 && a2 !== B.fire)) return true;
      const c = new EndCrystal(this, { base: false });
      c.at(hit.x + 0.5, hit.y + 1, hit.z + 0.5);
      if (this.entities.some(e => !e.dead && boxesTouch(e.box(), [hit.x, hit.y + 1, hit.z, hit.x + 1, hit.y + 3, hit.z + 1]))) return true;
      this.add(c);
      this.usedItem(id);
      if (this.fight) this.fight.tryRespawn();
      return true;
    }
    return false;
  }
  /* A fire that appears in a frame (spread there, lit by lava, a fireball, a dispenser) lights it, as flint and steel
     does: the game's fire onPlace in the Overworld and the Nether (sim/fire.js asks). True when it did. */
  fireAt(x, y, z) {
    if (this.dim === 'the_end') return false;
    const s = tryLight(this.world, x, y, z);
    if (s) this.poi[this.dim].push(s);
    return !!s;
  }
  usedItem(id) {
    const g = this.game;
    if (g.mode === 'creative') return;
    // flint and steel wears by 1 a use (hands.js)
    if (BLOCKS[id] && BLOCKS[id].name === 'flint_and_steel') { if (g.hands) g.hands.wearHeld(1); return; }
    g.inv.takeSelected(1);
  }
  // an eye of ender thrown: towards the nearest stronghold, in the Overworld only; 1 in 5 break
  useAir(id) {
    const d = BLOCKS[id] || {};
    if (d.use !== 'eye' || this.dim !== 'overworld') return false;
    const g = this.game, p = g.player;
    const t = nearestStronghold(g.entry.seed | 0, p.pos.x, p.pos.z);
    if (!t) return false;
    const e = new EyeOfEnder(this, t, Math.random() >= 0.2);
    this.add(e.at(p.pos.x, p.pos.y + p.eyeH - 0.1, p.pos.z));
    this.usedItem(id);
    return true;
  }
  // a left click: the nearest entity part on the view ray within reach, if nearer than the block
  attack(eye, blockHit) {
    const g = this.game, p = g.player;
    const dir = new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    const reach = g.mode === 'creative' ? 5 : 3;
    let best = null;
    const test = (box, e, part) => {
      const t = rayBox(eye, dir, box);
      if (t !== null && t <= reach && (!best || t < best.t)) best = { t, e, part };
    };
    for (const e of this.entities) {
      if (e.dead) continue;
      if (e.partBoxes) { for (const P of e.partBoxes()) test(P.box, e, P.name); }
      else if (e instanceof EndCrystal) test(e.box(), e, null);
    }
    if (!best || (blockHit && blockHit.t < best.t)) return false;
    // a bare hand does 1 (tools come with the item work)
    const dmg = this.o.attackDamage ? this.o.attackDamage() : 1;
    if (best.e.partBoxes) best.e.hurt(dmg, best.part, 'player');
    else best.e.hurt(dmg, 'player');
    return true;
  }
  // a block was broken: a portal next to it whose frame is no longer whole goes out
  broken(x, y, z) {
    const w = this.world;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const gone = checkPortal(w, x + dx, y + dy, z + dz);
      if (gone && gone.length) {
        const set = new Set(gone.map(c => c.join(',')));
        this.poi[this.dim] = this.poi[this.dim].filter(s => !shapeCells(s).some(c => set.has(c.join(','))));
      }
    }
  }
  // death: where you come back (the Nether's anchor, if it still has a charge; else the world spawn)
  respawnPlan() {
    if (this.spawnDim === 'the_nether' && this.anchor) return { dim: 'the_nether', anchor: this.anchor };
    return { dim: 'overworld' };
  }
  anchorSpot(world) {
    const a = this.anchor;
    if (!a || world.get(a.x, a.y, a.z) !== B.respawn_anchor || (world.meta(a.x, a.y, a.z) & 7) === 0) { this.spawnDim = 'overworld'; this.anchor = null; return null; }
    world.set(a.x, a.y, a.z, B.respawn_anchor, (world.meta(a.x, a.y, a.z) & 7) - 1);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      for (const dy of [0, -1, 1]) {
        const x = a.x + dx, y = a.y + dy, z = a.z + dz, below = world.get(x, y - 1, z);
        if (!world.get(x, y, z) && !world.get(x, y + 1, z) && below && BLOCKS[below].solid) return { x: x + 0.5, y, z: z + 0.5 };
      }
    }
    return { x: a.x + 0.5, y: a.y + 1, z: a.z + 0.5 };
  }
}

// how far along a ray it enters a box (null if it misses)
function rayBox(o, d, b) {
  let t0 = 0, t1 = 1e9;
  const O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(D[k]) < 1e-9) { if (O[k] < b[k] || O[k] > b[k + 3]) return null; continue; }
    let a = (b[k] - O[k]) / D[k], c = (b[k + 3] - O[k]) / D[k];
    if (a > c) { const t = a; a = c; c = t; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return null;
  }
  return t0;
}
