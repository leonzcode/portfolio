/* ---------------------------------------------------------------------------
   Leoncraft 2 - lit TNT and falling blocks: blocks that move.

   Primed TNT (the game's PrimedTnt): starts at the block's centre with 0.2
   upwards and a nudge of 0.02 a random way, falls by 0.04 a tick, keeps 98%
   of its speed each tick (70% sideways and bouncing back at half speed off
   the ground), flashes white every other 5 ticks, swells in its last 10, and
   after its fuse (80 ticks when lit by hand or fire or redstone, 10-29 when a
   blast lights it) explodes with power 4, a sixteenth of a block above its
   feet. Pushed about by other explosions.

   Falling blocks: when one starts to fall, on the game's scheduled ticks
   (installFalling below); the falling itself is an entity
   (entities/fallingblock.js), as in the game. Only a world with no mobs, or
   an old save's falling block, falls as one of these bodies.
     sand, red sand, gravel, concrete powder, anvils, suspicious sand and
     gravel: placed, or a neighbour changing, ticks them 2 ticks later (the
     dragon egg 5); then with nothing under them (air, fire, a fluid,
     anything replaceable) they fall
     concrete powder sets as concrete the moment it is placed in or beside
     water, or water comes next to it (not water under it alone)
     the dragon egg teleports when clicked (right click, or a left click in
     survival): up to 1000 tries at a spot up to 15 across and 7 up or down,
     the first one that is air
     pointed dripstone: hanging (pointing down) with nothing to hang from, it
     falls 2 ticks later with every piece under it, the tip hurting what it
     lands on (the column's length a block of fall, at least 6); standing
     (pointing up) on nothing, it breaks a tick later
     scaffolding: its distance is how many blocks sideways it is from a
     column standing on something solid (straight up a column keeps the
     column's), worked out a tick after it or a neighbour changes; at 7 it
     breaks, or falls if it was already at 7 (as a piece placed out of reach does)

   Drawn with the block's own model and the held-block material, so they take
   the same light and fog as the world.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { blockGeometry, intAttribute } from '../render/blockmesh.js?v=107';
import { lightNear } from '../lightlevel.js?v=107';
import { FALLS, free as fallsInto, touchesWater, concreteOf } from '../entities/fallingblock.js?v=107';
import { H } from '../world-const.js?v=107';
const THREE = window.THREE;

/* ---- when blocks fall (the game's FallingBlock, PointedDripstoneBlock, ScaffoldingBlock, DragonEggBlock) ---- */
const sturdy = b => !!b && !!BLOCKS[b] && BLOCKS[b].solid && BLOCKS[b].shape === 'cube';
function installFalling(sim, bodies) {
  const E = () => sim.game && sim.game.entities;
  // a block leaving its cell to fall: the mobs' falling block, or one of ours where there are no mobs
  const fall = (x, y, z, b, m) => { const e = E(); if (e && e.fallBlock) return e.fallBlock(x, y, z, b, m); return bodies.fall(x, y, z, b, m); };
  sim.fallBlock = fall;
  const EGG = B.dragon_egg;
  for (let id = 1; id < FALLS.length; id++) {
    if (!FALLS[id] || !BLOCKS[id]) continue;
    const delay = id === EGG ? 5 : 2, concrete = concreteOf(id);
    sim.on(id, {
      onPlace(s, x, y, z) {
        if (concrete && touchesWater(s.w, x, y, z)) { s.set(x, y, z, concrete, 0); return; }
        s.schedule(x, y, z, delay);
      },
      neighbor(s, x, y, z) {
        if (concrete && touchesWater(s.w, x, y, z)) { s.set(x, y, z, concrete, 0); return; }
        s.schedule(x, y, z, delay);
      },
      tick(s, x, y, z, m) { if (y > 0 && fallsInto(s.get(x, y - 1, z))) fall(x, y, z, id, m); },
    });
  }

  // the dragon egg: a click sends it somewhere near
  const teleport = (s, x, y, z) => {
    const b = s.get(x, y, z), m = s.meta(x, y, z), r = n => Math.floor(Math.random() * n);
    for (let i = 0; i < 1000; i++) {
      const nx = x + r(16) - r(16), ny = y + r(8) - r(8), nz = z + r(16) - r(16);
      if (ny < 0 || ny >= H || s.get(nx, ny, nz) || !s.w.loaded(nx, nz)) continue;
      // the portal's purple specks along the way
      const P = s.renderer && s.renderer.particles;
      if (P && P.spawn) for (let k = 0; k < 128; k++) {
        const t = k / 127, j = () => (Math.random() - 0.5);
        P.spawn(x + (nx - x) * t + 0.5 + j(), y + (ny - y) * t + j() + 0.5, z + (nz - z) * t + 0.5 + j(), j() * 0.4, j() * 0.4, j() * 0.4,
          { colour: 0xb040e0, size: 0.08, life: 20 + r(20), gravity: 0, physics: false });
      }
      s.set(nx, ny, nz, b, m);
      s.set(x, y, z, 0, 0);
      return true;
    }
    return false;
  };
  if (EGG !== undefined) sim.on(EGG, { use(s, x, y, z) { teleport(s, x, y, z); return true; } });
  // a left click on a block in survival: the dragon egg teleports instead of being mined (interact.js)
  sim.attacked = hit => (hit && hit.b === EGG && EGG !== undefined ? (teleport(sim, hit.x, hit.y, hit.z), true) : false);

  // pointed dripstone (meta 5 points down, 4 up): held from behind its point, or by more dripstone pointing the same way
  const DRIP = B.pointed_dripstone;
  if (DRIP !== undefined) {
    const down = m => (m & 7) === 5;
    const held = (s, x, y, z, m) => {
      const by = down(m) ? y + 1 : y - 1, b = s.get(x, by, z);
      return sturdy(b) || (b === DRIP && down(s.meta(x, by, z)) === down(m));
    };
    const check = (s, x, y, z, m) => { if (!held(s, x, y, z, m)) s.schedule(x, y, z, down(m) ? 2 : 1); };
    sim.on(DRIP, {
      onPlace: check,
      neighbor: check,
      tick(s, x, y, z, m) {
        if (held(s, x, y, z, m)) return;
        if (!down(m)) { s.destroy(x, y, z); return; }
        // the whole hanging column falls; the lowest piece is its tip, which hurts
        let n = 0;
        for (let yy = y; yy > 0 && s.get(x, yy, z) === DRIP && down(s.meta(x, yy, z)); yy--) n++;
        for (let k = 0; k < n; k++) {
          const yy = y - k, e = fall(x, yy, z, DRIP, s.meta(x, yy, z));
          if (e && k === n - 1 && e.hurtsEntities !== undefined) { e.hurtsEntities = true; e.perBlock = Math.max(1 + k, 6); e.maxDamage = 40; e.damageType = 'falling_stalactite'; }
        }
      },
    });
  }

  // scaffolding: meta 0-7 its distance, 8 the bottom piece (a frame round its foot)
  const SC = B.scaffolding;
  if (SC !== undefined) {
    const distance = (s, x, y, z) => {
      const below = s.get(x, y - 1, z);
      let i = 7;
      if (below === SC) i = s.meta(x, y - 1, z) & 7;
      else if (sturdy(below)) return 0;
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        if (s.get(x + dx, y, z + dz) !== SC) continue;
        i = Math.min(i, (s.meta(x + dx, y, z + dz) & 7) + 1);
        if (i === 1) break;
      }
      return i;
    };
    const state = (s, x, y, z) => { const d = distance(s, x, y, z); return d | (d !== 0 && s.get(x, y - 1, z) !== SC ? 8 : 0); };
    sim.scaffoldDistance = (x, y, z) => distance(sim, x, y, z);
    // placed: its distance from the start (one placed out of reach is already at 7, and falls)
    (sim.placers || (sim.placers = [])).push(list => list.map(e => (e[3] === SC ? [e[0], e[1], e[2], SC, state(sim, e[0], e[1], e[2])] : e)));
    sim.on(SC, {
      onPlace(s, x, y, z) { s.schedule(x, y, z, 1); },
      neighbor(s, x, y, z) { s.schedule(x, y, z, 1); },
      tick(s, x, y, z, m) {
        const n = state(s, x, y, z);
        if ((n & 7) === 7) { if ((m & 7) === 7) fall(x, y, z, SC, n); else s.destroy(x, y, z); }
        else if (n !== m) s.set(x, y, z, SC, n);
      },
    });
  }
}

const W = 0.98, HT = 0.98;
// primed TNT and falling blocks at once, and explosions a tick, at most
const MAX_BODIES = 600, BLASTS_PER_TICK = 8;

export class Bodies {
  constructor(sim) {
    this.sim = sim;
    this.list = [];
    this.group = new THREE.Group();
    const r = sim.renderer;
    if (r && r.scene) r.scene.add(this.group);
    this.geo = new Map();
    this.white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    sim.primeTnt = (x, y, z, by, fuse) => this.prime(x, y, z, by, fuse);
    installFalling(sim, this);
    // drawn between ticks, on the screen's own clock
    this.lastTick = performance.now();
    const frame = () => {
      if (this.dead) return;
      if (this.list.length) this.frame(Math.min(1, (performance.now() - this.lastTick) / 50));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  dispose() {
    this.dead = true;
    for (const e of this.list) this.drop(e);
    this.list = [];
    if (this.group.parent) this.group.parent.remove(this.group);
  }
  // can a falling block pass through this cell?
  free(x, y, z) {
    const b = this.sim.get(x, y, z);
    if (!b) return true;
    const d = BLOCKS[b];
    return !!FLUID[b] || d.name === 'fire' || d.name === 'soul_fire' || (d.replaceable && !d.solid);
  }

  /* ---- making them ---- */
  prime(x, y, z, by, fuse) {
    // (a thousand TNT going up together: past MAX_BODIES the rest just go, unlit, rather than freezing the page)
    if (this.list.length >= MAX_BODIES) return null;
    const a = Math.random() * Math.PI * 2;
    const e = this.add({ kind: 'tnt', b: B.tnt, m: 0, x: x + 0.5, y, z: z + 0.5, vx: -Math.sin(a) * 0.02, vy: 0.2, vz: -Math.cos(a) * 0.02, fuse: fuse === undefined ? 80 : fuse, by });
    return e;
  }
  fall(x, y, z, b, m) {
    if (this.list.length >= MAX_BODIES) return null;
    b = b || this.sim.get(x, y, z);
    m = m === undefined ? this.sim.meta(x, y, z) : m;
    this.sim.set(x, y, z, 0, 0);
    return this.add({ kind: 'falling', b, m, x: x + 0.5, y, z: z + 0.5, vx: 0, vy: 0, vz: 0, time: 0 });
  }
  add(e) {
    e.px = e.x; e.py = e.y; e.pz = e.z; e.onGround = false;
    e.vel = { get x() { return e.vx; }, set x(v) { e.vx = v; }, get y() { return e.vy; }, set y(v) { e.vy = v; }, get z() { return e.vz; }, set z(v) { e.vz = v; } };
    e.box = () => [e.x - W / 2, e.y, e.z - W / 2, e.x + W / 2, e.y + HT, e.z + W / 2];
    e.push = (vx, vy, vz) => { e.vx += vx; e.vy += vy; e.vz += vz; };
    this.list.push(e);
    this.mesh(e);
    return e;
  }
  mesh(e) {
    const r = this.sim.renderer;
    if (!r || !r.mats) return;
    let g = this.geo.get(e.b * 256 + e.m);
    if (!g) {
      try { g = blockGeometry(BLOCKS[e.b], e.m); } catch (err) { return; }
      this.geo.set(e.b * 256 + e.m, g);
    }
    const m = this.litMesh(r, g, e.x, e.y + 0.5, e.z);
    m.frustumCulled = false;
    m.scale.setScalar(1);
    e.lit = m;
    e.obj = new THREE.Group();
    e.obj.add(m);
    if (e.kind === 'tnt') {
      /* the flash: the game lays its white over the TNT before the light, so it is only as bright as
         the block's light makes it; here a white block lit the same way, shown in the TNT's place.
         (It was an unlit white box, which glowed in a dark cave at night and glared with the shaders on.) */
      const wk = B.white_concrete * 256;
      let wg = this.geo.get(wk);
      if (!wg && B.white_concrete !== undefined) { try { wg = blockGeometry(BLOCKS[B.white_concrete], 0); this.geo.set(wk, wg); } catch (err) { wg = null; } }
      const w = wg ? this.litMesh(r, wg, e.x, e.y + 0.5, e.z) : new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.white);
      if (wg) { w.frustumCulled = false; w.position.set(0, -0.5, 0); e.flashLit = w; } else w.position.y = 0.5;
      w.visible = false;
      e.flash = w;
      e.obj.add(w);
    }
    // blockmesh.js centres the block on the origin, lifted by one: put its feet at the body's feet
    m.position.set(0, -0.5, 0);
    this.group.add(e.obj);
  }
  /* The world's own block material (it takes each look's code in place: render/looks.js), each body
     lit by the light where it is, in its own copy of the shape's light. (A copy of the held block's
     material was made once and kept: a change of Shaders left primed TNT and pushed blocks in the old
     look's code, black or glaring, and on the Off look they took the player's light, not their own.) */
  material(r, cutout) { return cutout ? r.mats.cutout : r.mats.opaque; }
  litMesh(r, g, x, y, z) {
    const src = g.geometry, geo = new THREE.BufferGeometry();
    for (const n of ['aPos', 'aA', 'aC']) geo.setAttribute(n, src.attributes[n]);
    geo.setIndex(src.index);
    geo.setAttribute('aL', intAttribute(new Uint8Array(src.attributes.aL.count * 4)));
    geo.boundingSphere = src.boundingSphere;
    const m = new THREE.Mesh(geo, this.material(r, g.cutout));
    m.userData.light = -1;
    this.light(m, x, y, z);
    return m;
  }
  // the light in the block at (x, y, z) into a body's mesh, when it changes
  light(m, x, y, z) {
    const w = this.sim.w, v = lightNear(w, Math.floor(x), Math.floor(y), Math.floor(z), !!w.noSky);
    if (v === m.userData.light) return;
    m.userData.light = v;
    const L = m.geometry.attributes.aL, sky = (v >> 4) * 17, bl = (v & 15) * 17;
    for (let i = 0; i < L.count; i++) { L.array[i * 4] = sky; L.array[i * 4 + 1] = bl; }
    L.needsUpdate = true;
  }
  drop(e) {
    if (e.obj && e.obj.parent) e.obj.parent.remove(e.obj);
    if (e.lit) { e.lit.geometry.dispose(); e.lit = null; }
    if (e.flashLit) { e.flashLit.geometry.dispose(); e.flashLit = null; }
    e.obj = null;
  }

  /* ---- each tick ---- */
  tick() {
    this.lastTick = performance.now();
    if (!this.list.length) return;
    // at most BLASTS_PER_TICK explosions a tick (and none once 15 ms are gone): the rest wait a tick on a spent fuse
    let blasts = 0;
    for (const e of this.list.slice()) {
      e.px = e.x; e.py = e.y; e.pz = e.z;
      if (!this.sim.w.loaded(e.x, e.z)) continue;
      e.vy -= 0.04;
      this.move(e);
      e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98;
      if (e.onGround) { e.vx *= 0.7; e.vz *= 0.7; if (e.kind === 'tnt') e.vy *= -0.5; }
      if (e.kind === 'tnt') {
        if (e.fuse > 0) e.fuse--;
        if (e.fuse <= 0 && (blasts >= BLASTS_PER_TICK || (blasts && performance.now() - this.lastTick > 15))) continue;
        if (e.fuse <= 0) { blasts++; e.dead = true; this.drop(e); this.sim.explode(e.x, e.y + HT / 16, e.z, 4, { source: e, decay: 'tnt' }); }
      } else {
        e.time++;
        if (e.onGround) { e.dead = true; this.land(e); }
        else if (e.time > 600 || e.y < -10) { e.dead = true; this.drop(e); }
      }
    }
    this.list = this.list.filter(e => !e.dead);
  }
  land(e) {
    const x = Math.floor(e.x), y = Math.floor(e.y + 0.01), z = Math.floor(e.z);
    this.drop(e);
    const here = this.sim.get(x, y, z);
    if (this.free(x, y, z) && !(here && FLUID[here] === 2)) {
      this.sim.set(x, y, z, e.b, e.m);
      if (this.sim.fluids) this.sim.fluids.around(x, y, z);
    } else this.sim.dropItem(e.x, e.y + 0.5, e.z, BLOCKS[e.b].name, 1);
  }
  // move with collision against solid blocks, an axis at a time
  move(e) {
    const w = this.sim.w;
    const solid = (x, y, z) => { const b = w.get(x, y, z); return b && BLOCKS[b].solid && !(BLOCKS[b].shape === 'cross'); };
    const hits = (x0, y0, z0, x1, y1, z1) => {
      for (let x = Math.floor(x0); x <= Math.floor(x1 - 1e-7); x++) for (let y = Math.floor(y0); y <= Math.floor(y1 - 1e-7); y++)
        for (let z = Math.floor(z0); z <= Math.floor(z1 - 1e-7); z++) if (solid(x, y, z)) return true;
      return false;
    };
    const h = W / 2;
    e.onGround = false;
    // y
    let ny = e.y + e.vy;
    if (hits(e.x - h, ny, e.z - h, e.x + h, ny + HT, e.z + h)) {
      if (e.vy < 0) { ny = Math.floor(ny) + 1; e.onGround = true; if (hits(e.x - h, ny, e.z - h, e.x + h, ny + HT, e.z + h)) ny = e.y; }
      else ny = e.y;
      if (e.kind !== 'tnt' || !e.onGround) e.vy = 0;
    }
    e.y = ny;
    let nx = e.x + e.vx;
    if (hits(nx - h, e.y, e.z - h, nx + h, e.y + HT, e.z + h)) { nx = e.x; e.vx = 0; }
    e.x = nx;
    let nz = e.z + e.vz;
    if (hits(e.x - h, e.y, nz - h, e.x + h, e.y + HT, nz + h)) { nz = e.z; e.vz = 0; }
    e.z = nz;
  }
  // each frame: where they are drawn, between this tick and the last
  frame(alpha) {
    for (const e of this.list) {
      if (!e.obj) continue;
      e.obj.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
      if (e.lit) this.light(e.lit, e.x, e.y + 0.5, e.z);
      if (e.kind === 'tnt') {
        const f = e.fuse - alpha + 1;
        let s = 1;
        if (f < 10) { const k = 1 - f / 10; s = 1 + k * k * k * k * 0.3; }
        e.obj.scale.setScalar(s);
        if (e.flash) {
          const on = Math.floor(e.fuse / 5) % 2 === 0;
          e.flash.visible = on;
          // (the lit white block stands in for the TNT while it flashes, in the same light)
          if (e.flashLit) { if (e.lit) e.lit.visible = !on; if (on) this.light(e.flashLit, e.x, e.y + 0.5, e.z); }
        }
      }
    }
  }
  toJSON() { return this.list.map(e => [e.kind, e.b, e.m, +e.x.toFixed(3), +e.y.toFixed(3), +e.z.toFixed(3), e.fuse || 0]); }
  fromJSON(a) {
    for (const [kind, b, m, x, y, z, fuse] of a || []) {
      if (kind === 'tnt') this.add({ kind, b, m, x, y, z, vx: 0, vy: 0, vz: 0, fuse });
      else this.add({ kind, b, m, x, y, z, vx: 0, vy: 0, vz: 0, time: 0 });
    }
  }
}
