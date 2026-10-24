/* ---------------------------------------------------------------------------
   Leoncraft 2 - sculk sensors and sculk shriekers, from the Minecraft Wiki
   (Sculk Sensor, Sculk Shrieker, Vibration; Java Edition).

   Things that happen make vibrations, each with its frequency (1 to 15):
   a step (1), landing (5), a block changing (6), a door, trapdoor or gate
   shutting (10) or opening (11), a block placed (12) or broken (13), a
   container shutting (14) or opening (15). Sneaking makes no steps, and a
   step on wool or a carpet is silent.

   A sculk sensor hears any of them within 8 blocks (a calibrated one 16)
   unless wool stands between: the vibration flies to it, a block a tick,
   and when it arrives the sensor is active for 30 ticks (the calibrated one
   10): its tendrils light up and it gives a redstone signal that is weaker
   the further away the vibration began, 15 - 15 x distance / range (at
   least 1), strongly into the block under it; a comparator reads the
   frequency. Then 10 ticks cooling down, deaf, and it listens again. Only
   one vibration flies to a sensor at a time.

   A sculk shrieker shrieks for 90 ticks when a player stands on it, or when
   a sensor within 8 blocks of it hears a player: rings rise from it one
   after another. One that can summon a warden (meta bit 1, the ones the
   game puts in its ancient cities) also brings Darkness for 12 seconds on
   the players near it in survival, at most once in 10 seconds, and counts a
   warning against them: the fourth (with no warden within 48 blocks) brings
   a warden up out of the ground within 5 blocks of the shrieker; a warning
   wears off every 10 minutes.

   Meta layouts are in sim/states.js. Sensors and shriekers near the player
   are found by looking over the area round them a layer a tick.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { WEAK, STRONG, SOURCE } from './redstone.js?v=107';
const THREE = window.THREE;

const SENSOR = B.sculk_sensor, CAL = B.calibrated_sculk_sensor, SHRIEKER = B.sculk_shrieker;
const WOOLLY = new Uint8Array(4096);
for (const d of BLOCKS) if (d && /(^|_)wool$|_carpet$/.test(d.name)) WOOLLY[d.id] = 1;
const isSensor = b => b === SENSOR || (b === CAL && CAL !== undefined);
const key = (x, y, z) => x + ',' + y + ',' + z;
const R = () => Math.random();
// the frequencies (the game's vibration frequencies)
export const FREQ = { step: 1, hit_ground: 5, block_change: 6, block_close: 10, block_open: 11, block_place: 12, block_destroy: 13, container_close: 14, container_open: 15 };
const OPENS = /door$|trapdoor$|fence_gate$/;

// the redstone a sensor gives: its power while active, strongly into the block below
for (const id of [SENSOR, CAL]) {
  if (id === undefined) continue;
  WEAK[id] = (r, x, y, z, m) => ((m & 3) === 1 ? (m >> 4) & 15 : 0);
  STRONG[id] = (r, x, y, z, m, f) => ((m & 3) === 1 && f === 3 ? (m >> 4) & 15 : 0);
  SOURCE[id] = 1;
}

export class Sculk {
  constructor(sim) {
    this.sim = sim;
    this.w = sim.world;
    this.near = new Map();         // "x,y,z" -> [x, y, z, block]: sensors and shriekers round the player
    this.flying = new Map();       // sensor key -> the vibration on its way: { at, power, freq, player }
    this.freq = new Map();         // sensor key -> the frequency of what it last heard (for comparators)
    this.shrieks = new Map();      // shrieker key -> { x, y, z, t }
    this.warned = -1e9;
    this.walked = 0; this.lastPos = null; this.landed = null;
    this.mobSteps = new WeakMap();
    this.rings = [];
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    const r = sim.renderer;
    if (r && r.scene) r.scene.add(this.group);
    this.ringGeo = new THREE.RingGeometry(0.3, 0.42, 24).rotateX(-Math.PI / 2);
    (sim.tickers || (sim.tickers = [])).push(() => this.tick());
    // what grows, decays or settles by itself on random ticks or in the weather makes no vibration
    const quietly = (o, k) => { const f = o && o[k]; if (!f || f.__sculk) return; o[k] = (...a) => { this.quiet = true; try { return f.apply(o, a); } finally { this.quiet = false; } }; o[k].__sculk = true; };
    quietly(sim, 'randomTicks');
    if (sim.weather) quietly(sim.weather, 'precipitation');
    // a change made while the world ticks is the world's; one made between ticks is the player's (hands, commands)
    const tick = sim.tick;
    if (tick && !tick.__sculk) { sim.tick = (...a) => { this.ticking = true; try { return tick.apply(sim, a); } finally { this.ticking = false; } }; sim.tick.__sculk = true; }
    const sensorTick = {
      // active, then cooling down, then listening again
      tick: (s, x, y, z, m) => {
        const b = this.w.get(x, y, z);
        if ((m & 3) === 1) { this.setPhase(x, y, z, b, m, 2, 0); s.schedule(x, y, z, 10); }
        else if ((m & 3) === 2) this.setPhase(x, y, z, b, m, 0, 0);
      },
      removed: (s, x, y, z, om) => { if ((om & 3) === 1 && s.redstone) { s.redstone.around(x, y, z); s.redstone.around(x, y - 1, z); } },
    };
    if (SENSOR !== undefined) sim.on(SENSOR, sensorTick);
    if (CAL !== undefined) sim.on(CAL, sensorTick);
    const frame = () => {
      if (this.dead) return;
      if (this.rings.length) this.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  dispose() {
    this.dead = true;
    for (const r of this.rings) { this.group.remove(r.mesh); r.mesh.material.dispose(); }
    this.rings.length = 0;
    this.ringGeo.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  /* ---- what the sensors hear ---- */
  // a block changed (sim.js onSet): placed, broken, a door opening...
  changed(x, y, z, ob, om, nb, nm) {
    if (!this.near.size || this.quiet || this.sim.quiet) return;
    if (FLUID[ob] || FLUID[nb] || isSensor(ob) || isSensor(nb) || ob === SHRIEKER || nb === SHRIEKER) return;
    let f;
    if (ob === nb) {
      // of the changes a block makes in place, only doors, trapdoors and gates opening and shutting are heard
      const n = BLOCKS[nb] && BLOCKS[nb].name;
      if (!n || !OPENS.test(n) || ((om ^ nm) & 4) === 0) return;
      f = nm & 4 ? FREQ.block_open : FREQ.block_close;
    } else f = !ob || (BLOCKS[ob] && BLOCKS[ob].replaceable) ? FREQ.block_place : !nb ? FREQ.block_destroy : FREQ.block_change;
    this.vibrate(x + 0.5, y + 0.5, z + 0.5, f, !this.ticking);
  }
  // a vibration at (x, y, z): each sensor in range that is listening and has nothing on its way to it takes it
  vibrate(x, y, z, freq, byPlayer) {
    if (!this.near.size) return;
    for (const [k, s] of this.near) {
      const [sx, sy, sz, b] = s;
      if (!isSensor(b) || this.flying.has(k)) continue;
      const range = b === CAL ? 16 : 8, dx = sx + 0.5 - x, dy = sy + 0.5 - y, dz = sz + 0.5 - z, d = Math.hypot(dx, dy, dz);
      if (d > range || d < 0.5) continue;
      if ((this.w.meta(sx, sy, sz) & 3) !== 0 || this.w.get(sx, sy, sz) !== b) continue;
      if (this.woolBetween(x, y, z, sx + 0.5, sy + 0.5, sz + 0.5, d)) continue;
      const ticks = Math.max(1, Math.floor(d));
      this.flying.set(k, { at: this.sim.n + ticks, power: Math.max(1, 15 - Math.floor(15 / range * d)), freq, player: byPlayer });
      // the vibration, a little light flying to the sensor a block a tick
      const P = this.sim.renderer && this.sim.renderer.particles;
      if (P && P.spawn) P.spawn(x, y, z, dx / ticks, dy / ticks, dz / ticks, { colour: 0x29dfeb, size: 0.09, life: ticks, gravity: 0, friction: 1, physics: false });
    }
  }
  // wool (or a carpet) on the line between them blocks a vibration
  woolBetween(x0, y0, z0, x1, y1, z1, d) {
    const n = Math.ceil(d * 2);
    for (let i = 1; i < n; i++) {
      const t = i / n, b = this.w.get(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t), Math.floor(z0 + (z1 - z0) * t));
      if (WOOLLY[b]) return true;
    }
    return false;
  }
  frequency(x, y, z) { return (this.w.meta(x, y, z) & 3) === 1 ? this.freq.get(key(x, y, z)) || 0 : 0; }

  setPhase(x, y, z, b, m, phase, power) {
    this.w.set(x, y, z, b, (m & 12) | phase | (power << 4));
    const rs = this.sim.redstone;
    if (rs) { rs.around(x, y, z); rs.around(x, y - 1, z); rs.go(); }
  }
  activate(k, x, y, z, v) {
    const b = this.w.get(x, y, z), m = this.w.meta(x, y, z);
    if (!isSensor(b) || (m & 3) !== 0) return;
    this.freq.set(k, v.freq);
    this.setPhase(x, y, z, b, m, 1, v.power);
    this.sim.schedule(x, y, z, b === CAL ? 10 : 30);
    if (this.sim.onSound) this.sim.onSound('block.sculk_sensor.clicking', x, y, z);
    // a player heard: the shriekers within 8 blocks of the sensor shriek
    if (v.player) for (const [, s] of this.near) if (s[3] === SHRIEKER && Math.hypot(s[0] - x, s[1] - y, s[2] - z) <= 8) this.shriek(s[0], s[1], s[2]);
  }
  shriek(x, y, z) {
    const k = key(x, y, z), w = this.w;
    if (this.shrieks.has(k) || w.get(x, y, z) !== SHRIEKER) return;
    const m = w.meta(x, y, z);
    w.set(x, y, z, SHRIEKER, m | 1);
    this.shrieks.set(k, { x, y, z, t: 0 });
    if (this.sim.onSound) this.sim.onSound('block.sculk_shrieker.shriek', x, y, z);
    // one that can summon a warden darkens the world for the players near it (survival only)
    const g = this.sim.game, P = this.sim.player;
    if ((m & 2) && g && g.mode === 'survival' && P && this.sim.n - this.warned >= 200 && Math.hypot(P.pos.x - x, P.pos.z - z) <= 40) {
      this.warned = this.sim.n;
      if (g.survival && g.survival.addEffect) g.survival.addEffect('darkness', 1, 260);
      const E = g.entities;
      const near = E && E.list.some(e => e.type === 'warden' && !e.dead && !e.removed && Math.hypot(e.pos.x - x, e.pos.y - y, e.pos.z - z) < 48);
      if (!near) {
        this.warning = (this.warning || 0) + 1; this.warnAt = this.sim.n;
        if (this.warning >= 4) { this.warning = 0; this.summonWarden(x, y, z); }
      }
    }
  }
  // a warden up out of the ground: a spot within 5 blocks across and 6 up or down, solid under it and three free above
  summonWarden(x, y, z) {
    const g = this.sim.game, E = g && g.entities, w = this.w;
    if (!E) return;
    for (let i = 0; i < 30; i++) {
      const sx = x + Math.floor(R() * 11) - 5, sz = z + Math.floor(R() * 11) - 5;
      for (let sy = y + 6; sy >= y - 6; sy--) {
        const below = w.get(sx, sy - 1, sz);
        if (!below || !BLOCKS[below].solid || FLUID[below]) continue;
        let free = true;
        for (let k = 0; k < 3; k++) { const b = w.get(sx, sy + k, sz); if (b && (BLOCKS[b].solid || FLUID[b])) free = false; }
        if (!free) continue;
        const e = E.spawn('warden', sx + 0.5, sy, sz + 0.5, { natural: false });
        if (e) { e.emergeT = 134; e.persistent = false; }
        if (this.sim.onSound) this.sim.onSound('entity.warden.emerge', sx, sy, sz);
        return;
      }
    }
  }

  /* ---- each tick ---- */
  tick() {
    const sim = this.sim, w = this.w, P = sim.player;
    this.lastTick = performance.now();
    if (!P) return;
    this.scan(P);
    // a warning wears off every 10 minutes
    if (this.warning > 0 && sim.n - this.warnAt > 12000) { this.warning--; this.warnAt = sim.n; }
    // vibrations arriving
    for (const [k, v] of this.flying) {
      if (v.at > sim.n) continue;
      this.flying.delete(k);
      const s = this.near.get(k);
      if (s) this.activate(k, s[0], s[1], s[2], v);
    }
    // shriekers: a ring every 5 ticks for the first 50, quiet again after 90
    for (const [k, s] of this.shrieks) {
      if (w.get(s.x, s.y, s.z) !== SHRIEKER) { this.shrieks.delete(k); continue; }
      if (s.t < 50 && s.t % 5 === 0) this.ring(s.x + 0.5, s.y + 0.5, s.z + 0.5);
      if (++s.t >= 90) { this.shrieks.delete(k); w.set(s.x, s.y, s.z, SHRIEKER, w.meta(s.x, s.y, s.z) & ~1); }
    }
    for (const r of this.rings) r.prev = r.t, r.t++;
    if (!this.near.size) { this.lastPos = null; return; }
    // the player: a step every 1 2/3 blocks walked on the ground (not sneaking, not on wool), landing after a fall
    const p = P.pos, alive = !(sim.game && sim.game.survival && sim.game.survival.dead);
    if (this.lastPos && alive && P.onGround && !P.sneaking && !P.flying) {
      this.walked += Math.hypot(p.x - this.lastPos[0], p.z - this.lastPos[2]);
      if (this.walked >= 5 / 3) {
        this.walked = 0;
        if (!WOOLLY[w.get(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z))] && !WOOLLY[w.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))]) this.vibrate(p.x, p.y + 0.1, p.z, FREQ.step, true);
      }
    }
    if (P.landed && P.landed !== this.landed) { if (this.landed !== null && alive && P.landed.dist > 0.5) this.vibrate(p.x, p.y + 0.1, p.z, FREQ.hit_ground, true); this.landed = P.landed; }
    else if (this.landed === null) this.landed = P.landed || 0;
    this.lastPos = [p.x, p.y, p.z];
    // standing on a shrieker
    if (P.onGround && alive) {
      const fx = Math.floor(p.x), fy = Math.floor(p.y - 0.2), fz = Math.floor(p.z);
      if (w.get(fx, fy, fz) === SHRIEKER) this.shriek(fx, fy, fz);
    }
    // mobs walking near a sensor
    const E = sim.game && sim.game.entities;
    if (E && E.forNear) {
      E.forNear(p.x, p.z, 40, e => {
        if (e.removed || !e.maxHealth || !e.onGround || e.sneaking || e.noPhysics || !e.alive || !e.alive()) return;
        const last = this.mobSteps.get(e) || { x: e.pos.x, z: e.pos.z, d: 0 };
        last.d += Math.hypot(e.pos.x - last.x, e.pos.z - last.z); last.x = e.pos.x; last.z = e.pos.z;
        if (last.d >= 5 / 3) { last.d = 0; this.vibrate(e.pos.x, e.pos.y + 0.1, e.pos.z, FREQ.step, false); }
        this.mobSteps.set(e, last);
      });
    }
  }
  // one layer of the 33 x 17 x 33 blocks round the player a tick; ones that went are forgotten
  scan(P) {
    if (SENSOR === undefined) return;
    const w = this.w, px = Math.floor(P.pos.x), py = Math.floor(P.pos.y), pz = Math.floor(P.pos.z);
    const ly = py - 8 + (this.sim.n % 17);
    for (let z = pz - 16; z <= pz + 16; z++) for (let x = px - 16; x <= px + 16; x++) {
      const b = w.get(x, ly, z);
      if (isSensor(b) || b === SHRIEKER) { const k = key(x, ly, z); if (!this.near.has(k)) this.near.set(k, [x, ly, z, b]); }
    }
    if (this.sim.n % 20) return;
    for (const [k, s] of this.near) {
      if (w.get(s[0], s[1], s[2]) !== s[3] || Math.abs(s[0] - px) > 48 || Math.abs(s[2] - pz) > 48) { this.near.delete(k); this.flying.delete(k); }
    }
  }
  // a shriek: a ring rising from the shrieker's middle a tenth of a block a tick, fading over 30 ticks
  ring(x, y, z) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9ff0ee, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
    this.group.add(mesh);
    this.rings.push({ mesh, x, y, z, t: 0, prev: 0 });
  }
  frame() {
    const a = Math.min(1, (performance.now() - (this.lastTick || performance.now())) / 50);
    let n = 0;
    for (const r of this.rings) {
      const t = r.prev + (r.t - r.prev) * Math.max(0, Math.min(1, a));
      if (r.t >= 30) { this.group.remove(r.mesh); r.mesh.material.dispose(); continue; }
      r.mesh.matrix.makeTranslation(r.x, r.y + t * 0.1, r.z);
      r.mesh.material.opacity = 0.85 * (1 - t / 30);
      r.mesh.matrixWorldNeedsUpdate = true;
      this.rings[n++] = r;
    }
    this.rings.length = n;
  }
}
