/* ---------------------------------------------------------------------------
   Leoncraft 2 - every entity in the world, and the game's dealings with them.

     tick()        20 a second: spawning, every entity's tick, the grid that
                   finds neighbours, chunks unloading (their entities are
                   kept and come back with the chunk), despawning
     render(a)     the frame: each mob posed between ticks into the bone
                   texture, instanced by model (render/entitymesh.js)
     raycast()     what the crosshair is on, for attacking and using
     attack(e)     the player's hit, and hurtPlayer() a hit on the player:
                   both by the game's combat rules (combat/combat.js, which
                   also has the shield, bows, crossbows and tridents)
     spawn(type, x, y, z), toJSON(), fromJSON()

   The game passes hooks for what other parts own:
     dropItem(world, x, y, z, name, count)   a dropped item (items module)
     giveXp(amount, x, y, z)                  experience
     itemName(id)                             the name of an inventory id
   Without them, drops of things that are blocks go straight into the
   inventory and the rest are left out.
--------------------------------------------------------------------------- */
import { Terrain } from './terrain.js?v=107';
import { PathFinder, Navigation } from './path.js?v=107';
import { Particles } from './particles.js?v=107';
import { Ambient } from './ambient.js?v=107';
import { Living, Mob, wrap, DEG } from './entity.js?v=107';
import { TYPES } from './mobs.js?v=107';
import './projectiles.js?v=107';
import { placeBoat } from './boat.js?v=107';
import './mobs2.js?v=107';
import './mobs3.js?v=107';
import './mobs4.js?v=107';
import { wandererTick } from './merchant.js?v=107';
import { tableBooks } from './tablebook.js?v=107';
import { explode } from './explosion.js?v=107';
import { splitXp } from './xporb.js?v=107';
import { placeMinecart, isRail, Minecart } from './minecart.js?v=107';
import { CART_ITEMS } from './carts.js?v=107';
import { fallFrom, FALLS, free } from './fallingblock.js?v=107';
import { Spawner, DESPAWN } from './spawner.js?v=107';
import { MODELS, POSE, restPose } from './mobmodels.js?v=107';
import { buildAtlas, buildSheet, SLOTS } from './mobart.js?v=107';
import { EntityMeshes } from '../render/entitymesh.js?v=107';
import { B, BLOCKS, FLUID, OPACITY, OPAQUE } from '../blocks.js?v=107';
import { lightNear } from '../lightlevel.js?v=107';
import { activeDrops } from '../drops.js?v=107';
import { breakAt } from '../place.js?v=107';
import { dropOf } from '../survival.js?v=107';
import { itemName, ITEMS, I, cooldownTick } from '../items.js?v=107';
import { Combat } from '../combat/combat.js?v=107';
import { walkers } from '../render/realism.js?v=107';
// RIP Computer: how long the dead lie (ticks, then a second and a half sinking), how many at once, and what never
// lies (slimes and magma cubes split into smaller ones, the bosses have deaths of their own)
const CORPSE_TICKS = 300, MAX_CORPSES = 40;
const NO_CORPSE = new Set(['slime', 'magma_cube', 'ender_dragon', 'wither', 'armor_stand', 'vex', 'allay']);
import './nether.js?v=107';
// the mobs whose spawn eggs had nothing to make: land animals, flyers and swimmers, monsters
import './mobs5.js?v=107';
import './mobs6.js?v=107';
import './mobs7.js?v=107';
import { DIMS } from '../dims.js?v=107';
import { armorLayers } from './armorlayer.js?v=107';
import { MobHeld } from '../render/mobheld.js?v=107';
import { setSpawnerMob } from '../struct/spawners.js?v=107';
import { useExtra, leashInteract, leashTick, tieToFence, nameplates } from './items2.js?v=107';
const THREE = window.THREE;

const R = () => Math.random();
const CELL = 8;
const DIFF = { peaceful: 0, easy: 1, normal: 2, hard: 3 };
// a stick for steering: the mob it works on and how much one burst wears it
const STICKS = { carrot_on_a_stick: ['pig', 7], warped_fungus_on_a_stick: ['strider', 1] };

// the most things one world keeps at once (mobs, vehicles, arrows...), and the most boats and the most minecarts
const ENTITY_CAP = 1200, VEHICLE_CAP = 150;

export class Entities {
  constructor(o) {
    this.world = o.world; this.P = o.player; this.inv = o.inv; this.survival = o.survival;
    this.R = o.renderer; this.options = o.options; this.mode = o.mode || 'survival';
    this.fluids = o.fluids || null;
    this.hooks = o.hooks || {};
    this.seed = this.world.seed | 0;
    this.t = new Terrain(this.world);
    this.paths = new PathFinder(this.t);
    this.list = [];
    this.displays = [];             // mobs shown inside spawners (makeDisplay)
    this.corpses = [];              // RIP Computer: the dead left lying a while (corpse)
    this.grid = new Map();
    this.particlesP = new Particles();
    this.particlesP.t = this.t;       // (water drops land, bubbles burst out of water)
    this.ambient = new Ambient(this);      // torches smoking, campfires, lava sparks (ambient.js)
    this.age = 0;
    this.stored = new Map();        // "cx,cz" -> saved entities of chunks not loaded
    this.populated = new Set();     // chunks that have had their animals
    this.riding = null;
    this.xpEarned = 0;
    this.ticksSinceSwing = 100; this.lastHeld = -1;
    this.pInvul = 0; this.pLast = 0;
    this.effects = {};               // the player's effects: name -> ticks left
    this.budget = 0;
    this.spawner = new Spawner(this);
    // drawing
    this.atlas = buildAtlas();
    this.meshes = new EntityMeshes(this.R, this.atlas, buildSheet());
    this.group = this.meshes.group;
    this.pose = new Float32Array(64 * POSE);
    this.A = {};
    this.frustum = new THREE.Frustum(); this.pm = new THREE.Matrix4(); this.sphere = new THREE.Sphere();
    this.m4 = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
    this.parts = []; for (let i = 0; i < 64; i++) this.parts.push(new THREE.Matrix4());
    this.euler = new THREE.Euler(); this.layerList = [];
    this.box6 = [0, 0, 0, 0, 0, 0];
    // the player, as mobs see it
    const self = this, P = this.P;
    this.player = {
      isPlayer: true, type: 'player', get pos() { return P.pos; }, get vel() { return P.vel; }, get w() { return 0.6 * (P.scale || 1); }, get hw() { return 0.3 * (P.scale || 1); }, get h() { return P.h || 1.8; }, get eyeH() { return P.eyeH || 1.62; },
      alive: () => !self.survival.dead && !self.gone,
      creative: () => self.mode === 'creative' || self.mode === 'spectator',
      sneaking: () => P.sneaking,
      inWater: () => P.inWater,
      hurt: (n, src) => self.hurtPlayer(n, src),
      knockback: (s, dx, dz) => self.knockPlayer(s, dx, dz),
      push: (x, y, z) => { P.vel.x += x; P.vel.y += y; P.vel.z += z; },
      dist2: (x, y, z) => (P.pos.x - x) ** 2 + (P.pos.y - y) ** 2 + (P.pos.z - z) ** 2,
      heal: n => { self.survival.heal(n); },
    };
    // the player's fights: hits, the shield, bows, crossbows, tridents (combat/combat.js)
    this.combat = new Combat(this);
    // boats are solid, to mobs (terrain.js) and to the player (player.js), except the one you sit in
    this.solids = []; this.t.solids = this.solids;
    P.extraBoxes = this.boxFn = (out, x0, y0, z0, x1, y1, z1) => {
      const S = this.solids;
      for (let i = 0; i < S.length; i++) {
        const e = S[i], p = e.pos;
        if (e.removed || e === this.riding || p.x + e.hw < x0 || p.x - e.hw > x1 || p.z + e.hw < z0 || p.z - e.hw > z1 || p.y + e.h < y0 - 1 || p.y > y1) continue;
        out.push(p.x - e.hw, p.y, p.z - e.hw, p.x + e.hw, p.y + e.h, p.z + e.hw);
      }
    };
    // a boat's turn reaches the camera a frame at a time, not in a jump each tick
    this.turnDue = 0; this.turnDone = 0;
    // a named mob's name over it while you look at it
    nameplates(this);
  }
  get difficulty() { return (this.options && this.options.get('difficulty')) || 'normal'; }
  get time() { return this.hooks.time ? this.hooks.time() : 6000; }
  // the world simulating itself (weather, the sky's darkening): sim/sim.js, when it is there
  get sim() { return (this.inter && this.inter.sim) || null; }
  get dim() { return this.world.dim || 'overworld'; }
  get D() { return DIMS[this.dim] || DIMS.overworld; }
  raining() { const s = this.sim; return this.dim === 'overworld' && !!(s && s.weather && s.weather.raining); }
  thundering() { const s = this.sim; return this.dim === 'overworld' && !!(s && s.weather && s.weather.thundering); }

  /* ---- light and the time of day, the game's way ---- */
  // how much the sky light is taken down at this time of day (0 at noon, 11 at midnight; rain and storms darken it more)
  skyDarken() {
    if (this.sdAge === this.age && this.age > 0) return this.sd;
    this.sdAge = this.age;
    const s = this.sim;
    if (s && typeof s.skyDarken === 'function' && this.D.fixedTime === null) { try { return (this.sd = s.skyDarken()); } catch (e) { /* the clock below */ } }
    return (this.sd = this.skyDarkenAt(this.D.fixedTime !== null ? this.D.fixedTime : this.time));
  }
  skyDarkenAt(time) {
    const t = time % 24000;
    let f = t / 24000 - 0.25;
    f = f - Math.floor(f);
    const c = (f * 2 + (0.5 - Math.cos(f * Math.PI) / 2)) / 3;
    let d = 1 - (Math.cos(c * Math.PI * 2) * 2 + 0.5);
    d = Math.max(0, Math.min(1, d));
    return Math.floor(d * 11);
  }
  // never day where the clock stands still (the Nether, the End)
  isDay() { return this.D.fixedTime === null && this.skyDarken() < 4; }
  // sky light as the rules see it: the Nether and the End have none in the game
  skyLight(x, y, z) { return this.D.hasSky && this.dim !== 'the_end' ? this.t.sky(x, y, z) : 0; }
  rawBrightness(x, y, z) { return Math.max(this.skyLight(x, y, z) - this.skyDarken(), this.t.block(x, y, z)); }
  // the game's light-dependent brightness: the curve f / (4 - 3f), lifted by the dimension's ambient light (the Nether's 0.1)
  brightness(x, y, z) { const f = this.rawBrightness(x, y, z) / 15, g = f / (4 - 3 * f), a = this.D.ambient || 0; return a + (1 - a) * g; }
  seesSky(x, y, z) { return y >= this.t.motionTop(x, z) - 0; }

  /* ---- finding neighbours ---- */
  rebuildGrid() {
    for (const a of this.grid.values()) a.length = 0;
    this.solids.length = 0;
    for (const e of this.list) {
      if (e.removed) continue;
      if (e.constructor.SOLID) this.solids.push(e);
      const k = (Math.floor(e.pos.x / CELL) + 4096) * 8192 + Math.floor(e.pos.z / CELL) + 4096;
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, a = []);
      a.push(e);
    }
  }
  forNear(x, z, r, fn) {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = this.grid.get((cx + 4096) * 8192 + cz + 4096);
      if (a) for (let i = 0; i < a.length; i++) fn(a[i]);
    }
  }
  near(x, y, z, r) {
    const out = [], r2 = r * r;
    this.forNear(x, z, r, e => { if (!e.removed && e.dist2(x, y, z) <= r2) out.push(e); });
    return out;
  }
  nearest(from, r, test) {
    let best = null, bd = r * r;
    this.forNear(from.pos.x, from.pos.z, r, e => {
      if (e.removed || !test(e)) return;
      const d = from.dist2(e.pos.x, e.pos.y, e.pos.z);
      if (d < bd) { bd = d; best = e; }
    });
    return best;
  }
  // living things push each other apart a little (0.05 a tick), the player too
  pushOthers(e) {
    if (e.vehicle || e.constructor.NO_PUSH) return;
    const p = e.pos, hw = e.hw, h = e.h;
    const x0 = Math.floor((p.x - hw - 1) / CELL), x1 = Math.floor((p.x + hw + 1) / CELL), z0 = Math.floor((p.z - hw - 1) / CELL), z1 = Math.floor((p.z + hw + 1) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const a = this.grid.get((cx + 4096) * 8192 + cz + 4096);
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const o = a[i];
        if (o === e) continue;
        const ow = o.hw + hw;
        if (Math.abs(o.pos.x - p.x) >= ow || Math.abs(o.pos.z - p.z) >= ow || o.pos.y >= p.y + h || o.pos.y + o.h <= p.y) continue;
        if (o.removed || o.dead || !(o instanceof Living) || o.vehicle || o.constructor.NO_PUSH) continue;
        this.pushPair(e, o);
      }
    }
    const P = this.P;
    if (!this.riding && Math.abs(P.pos.x - p.x) < 0.3 + hw && Math.abs(P.pos.z - p.z) < 0.3 + hw && P.pos.y < p.y + h && P.pos.y + 1.8 > p.y && this.player.alive()) {
      let dx = P.pos.x - p.x, dz = P.pos.z - p.z, f = Math.max(Math.abs(dx), Math.abs(dz));
      if (f >= 0.01) {
        f = Math.sqrt(f); dx /= f; dz /= f;
        const g = Math.min(1, 1 / f);
        dx *= g * 0.05; dz *= g * 0.05;
        e.vel.x -= dx; e.vel.z -= dz;
        if (!this.player.creative()) { P.vel.x += dx; P.vel.z += dz; }
      }
    }
  }
  pushPair(a, b) {
    let dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, f = Math.max(Math.abs(dx), Math.abs(dz));
    if (f < 0.01) return;
    f = Math.sqrt(f); dx /= f; dz /= f;
    const g = Math.min(1, 1 / f);
    dx *= g * 0.05; dz *= g * 0.05;
    a.vel.x -= dx; a.vel.z -= dz;
    b.vel.x += dx; b.vel.z += dz;
  }
  // a few paths a tick at most, so a crowd chasing you never stalls a frame
  pathBudget() { if (this.budget <= 0) return false; this.budget--; return true; }

  /* ---- making them ---- */
  spawn(type, x, y, z, o = {}) {
    const C = TYPES[type];
    if (!C) { console.warn('no entity', type); return null; }
    // (past these nothing more comes, so spawn eggs, boats or carts by the hundred cannot swamp a page; a save loads whole)
    if (!o.json && !o.converted && this.full(type)) return null;
    const e = new C(this, type);
    e.setPos(x, y, z);
    if (o.yaw !== undefined) e.yaw = e.prevYaw = o.yaw;
    else if (e instanceof Living) e.yaw = e.prevYaw = R() * Math.PI * 2;
    if (e instanceof Living) { e.bodyYaw = e.prevBodyYaw = e.headYaw = e.prevHeadYaw = e.yaw; }
    if (e instanceof Mob) e.nav = new Navigation(e);
    if (o.natural !== false && e.finalizeSpawn && !o.json) e.finalizeSpawn(o);
    if (o.json) e.fromJSON(o.json);
    if (e.spawnData) e.spawnData(o);
    if (o.persistent) e.persistent = true;
    e.lightS = 15; e.lightB = 0; e.lS = 1; e.lB = 0;
    this.sampleLight(e, true);
    this.list.push(e);
    return e;
  }
  get count() { return this.list.length; }
  /* Room for one more? At most ENTITY_CAP things in the world, VEHICLE_CAP boats and VEHICLE_CAP minecarts. */
  full(type) {
    const L = this.list;
    if (L.length >= ENTITY_CAP) return true;
    const kind = /boat|raft/.test(type) ? 1 : /minecart/.test(type) ? 2 : 0;
    if (!kind) return false;
    let n = 0;
    for (let i = 0; i < L.length; i++) { const t = L[i].type; if (!L[i].removed && (kind === 1 ? t === 'boat' : /minecart/.test(t)) && ++n >= VEHICLE_CAP) return true; }
    return false;
  }
  /* A mob to show inside a spawner: made like any other but kept out of the
     list (nothing ticks it, hits it or saves it), small enough to fit the
     cage (the game's 0.53125, less for anything bigger than a block), tipped
     back 30 degrees. */
  makeDisplay(type, x, y, z) {
    const C = TYPES[type];
    if (!C || !C.MODEL) return null;
    const e = new C(this, type);
    e.setPos(x, y, z);
    e.bodyYaw = e.prevBodyYaw = e.headYaw = e.prevHeadYaw = e.yaw = e.prevYaw = 0;
    const big = Math.max(e.w, e.h);
    e.drawScale = 0.53125 / (big > 1 ? big : 1) / (C.SCALE || 1);
    e.rootPose = (root, t) => { root.multiply(t.makeTranslation(0, -0.2, 0)); root.multiply(t.makeRotationX(-Math.PI / 6)); };
    this.sampleLight(e, true);
    this.displays.push(e);
    return e;
  }
  dropDisplay(e) { const i = this.displays.indexOf(e); if (i >= 0) this.displays.splice(i, 1); }

  /* ---- 20 a second ---- */
  /* RIP Computer (realism): a mob that has died stays lying where it fell for a quarter of a minute, then sinks
     into the ground, instead of going in a puff at the end of its fall: drawn, never ticked, hit or saved (it is
     out of the list by then). Also another machine's mob dying here (net/mobs.js). True if kept (no puff then). */
  corpse(e) {
    const R = this.R;
    if (!R || !R.opts || !R.opts.realism || R.vanilla || !(e instanceof Living) || NO_CORPSE.has(e.type) || e.constructor.BLOCK || e.constructor.PARTICLE || this.gone) return false;
    e.corpseT = 0; e.hurtTime = 0; e.deathTime = 20; e.fire = 0;
    e.prev.copy(e.pos);
    this.corpses.push(e);
    if (this.corpses.length > MAX_CORPSES) this.corpses.shift();
    return true;
  }
  corpseTick() {
    const C = this.corpses;
    if (!C.length) return;
    // (back to another look: they go at once)
    if (!this.R.opts.realism || this.R.vanilla) { C.length = 0; return; }
    let n = 0;
    for (const e of C) {
      e.corpseT++;
      e.prev.copy(e.pos);
      // the ground under it gone: it drops
      const b = this.t.get(Math.floor(e.pos.x), Math.floor(e.pos.y - 0.05), Math.floor(e.pos.z));
      if (!(b && BLOCKS[b].solid) && e.pos.y > this.D.minY) e.pos.y -= 0.35;
      if (e.corpseT < CORPSE_TICKS + 30) C[n++] = e;
    }
    C.length = n;
  }
  tick() {
    this.age++;
    cooldownTick();
    this.t.reset();
    this.budget = 6;
    const P = this.P;
    // the attack cooldown counts up; changing what you hold starts it again
    this.ticksSinceSwing++;
    const held = this.inv ? this.inv.heldId() : 0;
    if (held !== this.lastHeld) { this.lastHeld = held; this.ticksSinceSwing = 0; }
    if (this.pInvul > 0) this.pInvul--;
    if (this.pFire > 0) this.playerFireTick();
    this.combat.tick();
    this.effectsTick();
    if (this.difficulty === 'peaceful') this.peaceful();
    this.spawner.tick();
    wandererTick(this);
    tableBooks(this);
    const n = this.list.length, voidY = this.D.minY;
    for (let i = 0; i < n; i++) {
      const e = this.list[i];
      if (e.removed) continue;
      // a rider has its turn right after what it rides (below), as in the game, so it moves with it smoothly
      if (e.vehicle && !e.vehicle.removed && e.vehicle.passengers.indexOf(e) >= 0) continue;
      if (e.vehicle) { this.ridingTick(e); continue; }
      e.tick();
      // fallen out of the world (64 below its floor; heights here are y + 64): a mob takes the void's damage, anything else is gone
      if (!e.removed && e.pos.y < voidY) e.belowWorld();
      if (e.leash) leashTick(this, e);
      if (e.passengers.length) this.tickRiders(e);
      if (!e.removed && (this.age + e.id) % 4 === 0) this.sampleLight(e);
    }
    if (this.riding && this.riding.removed) this.dismount();
    // the dead go
    let j = 0;
    for (let i = 0; i < this.list.length; i++) { const e = this.list[i]; if (!e.removed) this.list[j++] = e; else this.forget(e); }
    this.list.length = j;
    this.rebuildGrid();
    if (this.age % 20 === 0) this.chunks();
    this.ambient.tick();
    this.particlesP.tick();
    this.corpseTick();
    this.combat.lateTick();
  }
  forget(e) {
    if (e.vehicle) { const v = e.vehicle; v.passengers.splice(v.passengers.indexOf(e), 1); e.vehicle = null; }
    for (const p of e.passengers) { if (p !== this.player) p.vehicle = null; }
    if (this.riding === e) this.dismount();
  }
  // a block starting to fall (sim/bodies.js says when, on the game's scheduled ticks): the entity, the cell left empty
  fallBlock(x, y, z, b, meta) { return fallFrom(this, x, y, z, b, meta); }
  // the light where a mob's eyes are, eased when drawn
  sampleLight(e, now) {
    const x = Math.floor(e.pos.x), y = Math.floor(e.pos.y + Math.min(e.h, 1.6) * 0.85), z = Math.floor(e.pos.z);
    e.lightS = this.t.sky(x, y, z); e.lightB = e.constructor.BRIGHT ? 15 : this.t.block(x, y, z);
    // eyes in a full block (squeezed under a ceiling, pushed into a wall) hold no light: the brightest open block beside them, not black
    if (OPAQUE[this.t.get(x, y, z)]) { const v = lightNear(this.t.w, x, y, z, !!this.t.w.noSky); e.lightS = v >> 4; if (!e.constructor.BRIGHT) e.lightB = v & 15; }
    if (now) { e.lS = e.lightS / 15; e.lB = e.lightB / 15; }
  }
  // Peaceful: monsters vanish (the healing is survival.js's)
  peaceful() {
    for (const e of this.list) if (e.constructor.HOSTILE && !e.removed) e.remove();
  }
  /* Despawning (the game's): beyond 128 blocks (64 for fish) a mob goes at
     once; beyond 32, after 30 seconds with nothing happening, a 1 in 800
     chance a tick. Animals, villagers, pets and anything named, on a lead
     or from a structure never go. */
  despawnCheck(e) {
    if (e.persistent || e.constructor.NO_DESPAWN || e.passengers.length || e.vehicle || e.leashedTo || e.customName) { e.noActionTime = 0; return; }
    const c = e.constructor, P = this.P;
    const d2 = e.dist2(P.pos.x, P.pos.y, P.pos.z);
    const far = c.DESPAWN || DESPAWN[c.CATEGORY] || 128, near = 32;
    if (d2 > far * far) { e.remove(); return; }
    if (e.noActionTime > 600 && R() * 800 < 1 && d2 > near * near) { e.remove(); return; }
    if (d2 < near * near) e.noActionTime = 0;
  }
  /* Chunks coming and going: entities in a chunk that unloads are kept (as
     saved data) and put back when it loads again; a chunk seen for the first
     time gets its animals. */
  chunks() {
    const W = this.world;
    for (const e of this.list) {
      if (e.removed || e === this.riding || e.vehicle === this.player) continue;
      const k = Math.floor(e.pos.x / 16) + ',' + Math.floor(e.pos.z / 16);
      if (W.chunks.has(k)) continue;
      // monsters that would despawn anyway are just gone (and a boat keeps its riders with it)
      const kept = e.vehicle && e.vehicle.constructor.KEEPS_RIDERS;
      if (!(e.constructor.HOSTILE && !e.persistent) && e.toJSON && !kept) {
        let a = this.stored.get(k);
        if (!a) this.stored.set(k, a = []);
        a.push(e.toJSON());
      }
      e.remove();
    }
    for (const [k, a] of this.stored) {
      if (!W.chunks.has(k)) continue;
      this.stored.delete(k);
      for (const o of a) this.spawn(o.t, o.p[0], o.p[1], o.p[2], { json: o, natural: false });
    }
    this.remount = null;
    for (const [k, c] of W.chunks) {
      if (this.populated.has(k)) continue;
      this.populated.add(k);
      // the animals that come with the world (the Overworld's), and a structure's own mobs
      this.spawner.populate(c.cx, c.cz);
      this.spawner.structureMobs(c);
    }
  }

  /* ---- riding ---- */
  mount(v) {
    if (this.riding) this.dismount();
    const seats = v.seats !== undefined ? v.seats : (v.constructor.SEATS || 1);
    if (v.passengers.length >= seats) {
      // a mob in your seat is put out (not from a boat)
      const mob = v.passengers.find(p => p !== this.player);
      if (!mob || seats > 1 || v.constructor.NO_EVICT) return false;
      this.unseat(mob);
    }
    this.turnDue = this.turnDone = 0;
    this.riding = v;
    v.passengers.unshift(this.player);
    this.P.riding = v;
    this.P.vel.set(0, 0, 0);
    if (v.onMounted) v.onMounted(this.player);
    return true;
  }
  // a mob put out of its seat: where its vehicle says (a boat: beside it the way the mob looks, or on top), else on top
  unseat(e) {
    const v = e.vehicle; if (!v) return;
    v.passengers.splice(v.passengers.indexOf(e), 1); e.vehicle = null;
    const s = v.dismountSpot ? v.dismountSpot(e) : null;
    if (s) e.setPos(s[0], s[1], s[2]); else e.setPos(v.pos.x, v.pos.y + v.h + (v.dismountSpot ? 0 : 0.1), v.pos.z);
  }
  dismount() {
    const v = this.riding;
    if (!v) return;
    this.riding = null; this.P.riding = null;
    const i = v.passengers.indexOf(this.player);
    if (i >= 0) v.passengers.splice(i, 1);
    // what is left of the boat's turn this tick
    this.P.yaw += this.turnDue - this.turnDone; this.turnDue = this.turnDone = 0;
    // somewhere to stand beside it (or on top)
    const P = this.P, T = this.t;
    const tries = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    let placed = false;
    // a boat says where: beside it the way you look, or on top (js/entities/boat.js)
    if (v.dismountSpot) {
      const s = v.dismountSpot(P);
      if (s) P.pos.set(s[0], s[1], s[2]); else P.pos.set(v.pos.x, v.pos.y + v.h, v.pos.z);
      placed = true;
      tries.length = 0;
    }
    for (const [dx, dz] of tries) {
      const s = Math.sin(v.yaw + Math.PI / 2), c = Math.cos(v.yaw + Math.PI / 2);
      const x = v.pos.x + (dx * c - dz * s) * (v.w / 2 + 0.5), z = v.pos.z + (dx * s + dz * c) * (v.w / 2 + 0.5);
      for (const dy of [0, 1, -1]) {
        const y = Math.floor(v.pos.y) + dy;
        if (!T.boxHits(x - 0.3, y, z - 0.3, x + 0.3, y + 1.8, z + 0.3) && (T.solid(Math.floor(x), y - 1, Math.floor(z)) || dx === 0 && dz === 0)) {
          P.pos.set(x, y + (dx === 0 && dz === 0 ? v.h : 0), z); placed = true; break;
        }
      }
      if (placed) break;
    }
    if (!placed) P.pos.set(v.pos.x, v.pos.y + v.h + 0.1, v.pos.z);
    P.prev.copy(P.pos); P.vel.set(0, 0, 0);
    if (v.onDismounted) v.onDismounted(this.player);
  }
  /* The game calls this instead of the player's own tick while riding: the
     keys go to the vehicle, Shift gets off. True while riding. */
  rideTick() {
    const v = this.riding, P = this.P;
    if (!v) return false;
    P.prev.copy(P.pos);
    if (P.keys.shift && !v.constructor.NO_DISMOUNT_SHIFT) { this.dismount(); return true; }
    P.onGround = true; P.inWater = false; P.flying = false; P.sprinting = false; P.sneaking = false;
    // sitting up: never in a swimming or crouching pose, no fall counted
    P.swimming = false; P.pose = 'stand'; P.h = 1.8 * (P.scale || 1); P.fallDistance = 0; P.landed = null;
    P.prevEyeH = P.eyeH; P.eyeH += (1.62 * (P.scale || 1) - P.eyeH) * 0.5;
    // no sprint now, so the view narrows back to the FOV setting (as it does on foot)
    if (P.baseFov) P.fov += (P.baseFov - P.fov) * 0.35;
    // the rest of last tick's turn, before this tick's
    P.yaw += this.turnDue - this.turnDone; this.turnDue = this.turnDone = 0;
    // the eyes: under water only if the boat went under
    const ex = Math.floor(P.pos.x), ey = P.pos.y + 1.62, ez = Math.floor(P.pos.z);
    P.eyeInWater = FLUID[this.t.get(ex, Math.floor(ey), ez)] === 1 && ey < Math.floor(ey) + this.t.fluidHeight(ex, Math.floor(ey), ez);
    P.vel.set(0, 0, 0);
    if (this.survival) this.survival.fallFrom = null;
    return true;
  }
  // put the riders in their seats (after the vehicle moved)
  positionRiders(v) {
    for (let i = 0; i < v.passengers.length; i++) {
      const p = v.passengers[i];
      const s = v.seat ? v.seat(i, p) : [0, v.ridingOffset(), 0];
      const sn = Math.sin(v.yaw), cs = Math.cos(v.yaw);
      // seat offsets are along the vehicle (forward) and across it
      const x = v.pos.x - sn * s[0] - cs * s[2], z = v.pos.z - cs * s[0] + sn * s[2], y = v.pos.y + s[1];
      if (p === this.player) {
        this.P.pos.set(x, y, z);
        // the boat's turn goes to the camera over the frames to come (render), as the boat itself is drawn turning
        if (v.yawDelta) { this.turnDue = v.yawDelta; this.turnDone = 0; }
      } else {
        p.pos.set(x, y, z);
        if (v.yawDelta) { p.yaw += v.yawDelta; p.bodyYaw = p.yaw; }
      }
      if (v.riderPlaced) v.riderPlaced(p, i);
    }
  }
  /* Each frame while riding: the part of this tick's turn the boat has made
     by now, and a boat keeps your look within 105 degrees of its bow. */
  rideFrame(alpha) {
    const v = this.riding, P = this.P;
    if (!v) return;
    const want = this.turnDue * alpha;
    P.yaw += want - this.turnDone; this.turnDone = want;
    if (v.constructor.RIDER_BODY) {
      const by = v.prevYaw + wrap(v.yaw - v.prevYaw) * alpha, off = wrap(P.yaw - by), max = 105 * DEG;
      if (Math.abs(off) > max) P.yaw -= off - Math.sign(off) * max;
    }
  }
  // the inventory key while riding a chest boat opens its chest; true if it did
  rideInventory() { const v = this.riding; return !!(v && v.openInventory && v.openInventory(this.player)); }
  /* After a vehicle's tick: each mob riding it has its own (from where it
     sat), then all are put in their seats, then whatever rides them in turn */
  tickRiders(v) {
    for (const p of v.passengers.slice()) {
      if (p === this.player || p === this.P || !p.baseTick || p.removed || p.vehicle !== v) continue;
      this.ridingTick(p);
      if (!p.removed && (this.age + p.id) % 4 === 0) this.sampleLight(p);
    }
    if (v.removed) return;
    this.positionRiders(v);
    for (const p of v.passengers) if (p !== this.player && p.passengers.length) this.tickRiders(p);
  }
  // a mob riding something: no movement of its own
  ridingTick(e) {
    const v = e.vehicle;
    if (!v || v.removed) { e.vehicle = null; return; }
    e.baseTick();
    e.vel.set(0, 0, 0);
    if (e instanceof Mob) {
      e.serverAi(); if (e.bodyDue) { e.bodyDue = false; e.bodyControl(); }
      /* on a mob's back (a jockey: a skeleton on a spider, a pillager on a ravager) its
         body sits the way the mount's does, as the game's rider takes its mount's body
         turn; the head looks about within its own limit. (It sat any way round: backwards
         on a walking horse.) */
      if (v instanceof Mob) {
        e.bodyYaw = v.bodyYaw;
        const max = e.headMax(), off = Math.atan2(Math.sin(e.headYaw - e.bodyYaw), Math.cos(e.headYaw - e.bodyYaw));
        if (Math.abs(off) > max) e.headYaw = e.bodyYaw + Math.sign(off) * max;
      }
      e.animTick && e.animTick();
    }
    e.fallDist = 0;
    // after its own mind has had its say, the seat decides which way it faces (a boat: its way, or sideways)
    if (v.riderPlaced) v.riderPlaced(e, v.passengers.indexOf(e));
  }

  /* ---- the player's side of a fight ---- */
  // the name of an inventory id: the item's (a carrot, not the carrots crop it plants)
  itemName(id) {
    if (!id) return '';
    if (this.hooks.itemName) return this.hooks.itemName(id) || '';
    const it = ITEMS[id];
    return it ? it.name : BLOCKS[id] ? BLOCKS[id].name : '';
  }
  heldName() { return this.itemName(this.inv ? this.inv.heldId() : 0); }
  offhandName() { return this.itemName(this.inv && this.inv.offhandId ? this.inv.offhandId() : 0); }
  // wear on the held item (a sword's hit, shears, a carrot on a stick)
  damageHeld(n, what) {
    if (this.hooks.damageHeld) return this.hooks.damageHeld(n, what);
    if (this.mode === 'creative' || !this.inv || !this.inv.damageSelected) return false;
    return this.inv.damageSelected(n);
  }
  // the held bucket (or bottle) filled: one of the stack becomes the full one
  fillHeld(name) {
    if (this.hooks.fillBucket) return this.hooks.fillBucket(name);
    const inv = this.inv, id = I[name];
    if (!inv || id === undefined) return false;
    if (this.mode === 'creative') { if (!inv.count(id)) inv.add(id, 1); return true; }
    const s = inv.slots[inv.selected];
    if (s && s.count === 1) { inv.slots[inv.selected] = { id, count: 1 }; inv.changed(); }
    else { inv.takeSelected(1); if (inv.add(id, 1) > 0) this.dropItemAt(this.P.pos.x, this.P.pos.y + 1, this.P.pos.z, name, 1); }
    return true;
  }
  /* One of the held stack given for another, whatever it was (a bucket of
     fish fed to an axolotl or a nautilus leaves a bucket of water). Not a
     bucket filled, so it goes straight to the inventory and is not counted
     as one. In creative the held item stays, and the other is added if
     there is none, as the game's filled result does. */
  turnHeld(name) {
    const inv = this.inv, id = I[name];
    if (!inv || id === undefined) return false;
    if (this.mode === 'creative') { if (!inv.count(id)) inv.add(id, 1); return true; }
    const s = inv.slots[inv.selected];
    if (!s) return false;
    if (s.count <= 1) { inv.slots[inv.selected] = { id, count: 1 }; inv.changed(); }
    else { inv.takeSelected(1); if (inv.add(id, 1) > 0) this.dropItemAt(this.P.pos.x, this.P.pos.y + 1, this.P.pos.z, name, 1); }
    return true;
  }
  // how charged the next hit is (0..1): ticks since the last swing over 20 / attack speed
  cooldown() { return this.combat.cooldown(); }
  // a click in the air (or a block broken) starts the cooldown again, as the game does
  swung(air) { if (air) this.combat.airJab(); this.ticksSinceSwing = 0; }
  /* The player hits an entity (combat/combat.js). */
  attack(e) {
    const ok = this.combat.attack(e);
    this.lastHit = this.combat.lastHit;
    return ok;
  }
  climbing() {
    const b = this.t.get(Math.floor(this.P.pos.x), Math.floor(this.P.pos.y), Math.floor(this.P.pos.z));
    return !!(BLOCKS[b] && /ladder|vine/.test(BLOCKS[b].name));
  }
  /* Right click on an entity. True if something happened (no block use then). */
  interact(e) {
    if (!e || e.removed || e.dead) return false;
    const held = this.heldName();
    // leads on and off, a name tag's name (entities/items2.js)
    if (leashInteract(this, e, held)) return true;
    // a fish, an axolotl or a tadpole scooped up in a water bucket (the bucket becomes a bucket of it)
    if (held === 'water_bucket' && /^(cod|salmon|tropical_fish|pufferfish|axolotl|tadpole)$/.test(e.type) && this.inv) {
      const id = I[e.type + '_bucket'], inv = this.inv;
      if (id === undefined) return false;
      if (this.mode === 'creative') { if (!inv.count(id)) inv.add(id, 1); }
      else { inv.slots[inv.selected] = { id, count: 1 }; inv.changed(); }
      e.remove();
      return true;
    }
    // its own kind's spawn egg: a baby of it where it stands, if it has babies (the game's offspring from an egg)
    if (held === e.type + '_spawn_egg' && this.mode !== 'adventure' && this.mode !== 'spectator' && (e.setBaby || e.ageT !== undefined)) {
      const n = this.spawn(e.type, e.pos.x, e.pos.y, e.pos.z, { natural: false, yaw: 0 });
      if (!n) return false;
      if (n.setBaby) n.setBaby(true); else n.ageT = -24000;
      if (this.mode !== 'creative' && this.inv) this.inv.takeSelected(1);
      return true;
    }
    const r = e.interact ? e.interact(held, this.player) : false;
    if (!r) return false;
    if (r === 'consume' && this.mode !== 'creative' && this.inv) this.inv.takeSelected(1);
    if (r === 'milk') this.fillHeld('milk_bucket');
    if (r === 'damage') this.damageHeld(1);
    // a villager's trades (hands.js opens the screen)
    if (r === 'trade' && this.hooks.trade) this.hooks.trade(e);
    return true;
  }

  /* ---- the player being hit (combat/combat.js: difficulty, the shield, the 10 tick window, knockback) ---- */
  hurtPlayer(amount, src) { return this.combat.hurtPlayer(amount, src); }
  get shieldUp() { return this.combat.shieldUp; }
  set shieldUp(v) { }
  knockPlayer(strength, dx, dz) { this.combat.knockPlayer(strength, dx, dz); }
  setPlayerFire(seconds) {
    const S = this.survival;
    if (!S || this.mode === 'creative') return;
    // the player's own fire (survival.js ignite, in ticks), so it burns, shows and goes out as any other
    if (typeof S.ignite === 'function') { S.ignite(seconds * 20); return; }
    this.pFire = Math.max(this.pFire || 0, seconds * 20);
  }
  playerFireTick() {
    const P = this.P;
    if (P.inWater || this.raining() && this.seesSky(Math.floor(P.pos.x), Math.floor(P.pos.y + 1.8), Math.floor(P.pos.z))) { this.pFire = 0; return; }
    if (this.pFire % 20 === 0 && !this.survival.dead) this.survival.hurt(1, 'on_fire');
    if (this.age % 2 === 0) this.particlesP.add('flame', P.pos.x + (R() - 0.5) * 0.6, P.pos.y + R() * 1.8, P.pos.z + (R() - 0.5) * 0.6, 1, 0);
    this.pFire--;
  }
  /* Effects mobs put on you (poison, wither, hunger from husks, slowness
     from strays, mining fatigue from elder guardians): they go to the
     player's own effects (survival.js), which do the harm and show them. */
  // a few effects mobs put on you (poison, hunger from husks, slowness from strays)
  // they go on the player's own effects (survival.js), which do the harm and show in the HUD
  effectPlayer(name, ticks, level = 1) {
    if (this.mode === 'creative') return;
    this.effects[name] = Math.max(this.effects[name] || 0, ticks);
    if (this.survival && this.survival.addEffect) this.survival.addEffect(name, level, ticks);
    if (this.hooks.effect) this.hooks.effect(name, ticks);
  }
  effectsTick() {
    for (const k in this.effects) if (--this.effects[k] <= 0) delete this.effects[k];
  }

  /* ---- death, drops, experience ---- */
  onDeath(e, src) {
    const byPlayer = !!(src && src.player) || (e.lastHurtByPlayer !== undefined && this.age - e.lastHurtByPlayer < 100);
    e.byPlayer = byPlayer;
    const drop = (name, n) => { if (n > 0) this.dropAt(e, name, n, byPlayer); };
    /* killed by the player's own hand: Looting on what it holds (each loot table's own
       increases), and Fire Aspect cooks the meat even out of fire (or in water) */
    const held = src && src.type === 'player' && this.inv ? this.inv.slots[this.inv.selected] : null;
    const looting = held && held.ench ? held.ench.looting | 0 : 0, fire = e.fire;
    if (held && held.ench && held.ench.fire_aspect && !(e.fire > 0)) e.fire = 1;
    if (e.loot && !e.isBaby && !(e.baby && e.type === 'zombie' && false)) e.loot(drop, byPlayer, looting);
    e.fire = fire;
    // what it held or wore, and the experience that adds
    if (e.dropEquipment) e.dropEquipment(drop, byPlayer, looting);
    e.xpExtra = e.equipXp ? e.equipXp() : 0;
    if (this.riding === e) this.dismount();
  }
  dropAt(e, name, n, byPlayer) { this.dropItemAt(e.pos.x, e.pos.y + Math.min(e.h, 1) * 0.5, e.pos.z, name, n, false, byPlayer !== false); }
  // (o: { stack, vel, delay } for a whole stack, enchanted or worn, thrown with its own speed: a fish reeled in)
  dropItemAt(x, y, z, name, n, fromBlock, toPlayer, o) {
    if (n <= 0 || !name) return;
    const D = o && o.stack && this.hooks.hands && this.hooks.hands.drops;
    if (D && D.spawn) { D.spawn(x, y, z, o.stack, { vel: o.vel, delay: o.delay }); return; }
    if (this.hooks.dropItem) { this.hooks.dropItem(this.world, x, y, z, name, n); return; }
    // no items module: what is a block goes into the inventory
    if (this.inv && B[name] !== undefined && toPlayer !== false && this.mode !== 'creative') this.inv.add(B[name], n);
    this.dropped = this.dropped || [];
    this.dropped.push([name, n]);
  }
  dropXp(e) {
    if (!e.byPlayer) return;
    const base = e.xp !== undefined ? e.xp : e.constructor.XP || 0;
    this.xpAt(e.pos.x, e.pos.y + 0.3, e.pos.z, base + (base > 0 ? e.xpExtra || 0 : 0));
  }
  // experience as orbs, split into the game's sizes (the items' orbs, drops.js, when the game gives them)
  xpAt(x, y, z, n) {
    if (this.hooks.giveXp) { if (n > 0) this.hooks.giveXp(n, x, y, z); return; }
    while (n > 0) {
      const v = splitXp(n);
      n -= v;
      const o = this.spawn('xp_orb', x, y, z, { natural: false });
      if (!o) return;
      o.value = v;
      o.vel.set((R() * 0.2 - 0.1) * 2, R() * 0.2 * 2, (R() * 0.2 - 0.1) * 2);
    }
  }
  // the player picks an orb up (one every two ticks)
  takeOrb(o) {
    if (this.orbDelay > this.age) return false;
    this.orbDelay = this.age + 2;
    this.xpEarned += o.value;
    if (this.hooks.giveXp) this.hooks.giveXp(o.value, o.pos.x, o.pos.y, o.pos.z);
    return true;
  }
  // an arrow walked over goes into the inventory (combat/combat.js knows which kind and who may take it)
  pickupArrow(a) { return this.combat.pickupArrow(a || {}); }
  poof(e) {
    for (let i = 0; i < 20; i++) this.particlesP.add('poof', e.pos.x + (R() - 0.5) * e.w * 2, e.pos.y + R() * e.h, e.pos.z + (R() - 0.5) * e.w * 2, 1, 0, null, Math.max(e.lS || 0, e.lB || 0));
  }
  particles(kind, x, y, z, n, spread, col) { this.particlesP.add(kind, x, y, z, n || 1, spread, col); }
  breed(a, b) {
    if (a.inLove <= 0 || b.inLove <= 0) return;
    a.inLove = 0; b.inLove = 0; a.ageT = 6000; b.ageT = 6000;
    const baby = this.spawn(a.type, (a.pos.x + b.pos.x) / 2, a.pos.y, (a.pos.z + b.pos.z) / 2, { natural: false });
    if (baby) { baby.ageT = -24000; if (baby.inherit) baby.inherit(a, b); }
    this.particles('heart', baby.pos.x, baby.pos.y + 0.6, baby.pos.z, 7, 0.6);
    this.xpAt(baby.pos.x, baby.pos.y + 0.3, baby.pos.z, 1 + Math.floor(R() * 7));
  }
  explode(x, y, z, power, src, o) { return explode(this, x, y, z, power, src, o); }
  /* Lightning (sim/weather.js calls this; the player's share it does
     itself): everything within 3 blocks takes 5 and burns for 8 seconds,
     and some change (their thunderHit): a creeper is charged, a pig becomes
     a zombified piglin and a villager a witch (not on Peaceful), and a
     mooshroom turns brown, or red again, unhurt. */
  lightning(x, y, z) {
    for (const e of this.near(x, y, z, 8)) {
      if (e.removed || e.dead || Math.abs(e.pos.x - x) > 3 + e.hw || Math.abs(e.pos.z - z) > 3 + e.hw || e.pos.y > y + 9 || e.pos.y + e.h < y - 3) continue;
      if (e.thunderHit && e.thunderHit(this) === false) continue;
      if (!(e instanceof Living)) continue;
      e.fire = e.fire > 0 ? e.fire + 1 : 0;
      if (!e.fire && e.setFire) e.setFire(8);
      e.hurt(5, { type: 'lightning' });
    }
  }
  // a mob that becomes another (a pig struck by lightning, a piglin in the Overworld): the new one where it stood, keeping its name
  convertMob(e, type, keep) {
    const n = this.spawn(type, e.pos.x, e.pos.y, e.pos.z, { natural: true, yaw: e.yaw, converted: true });
    if (!n) return null;
    if (e.baby || e.ageT < 0) { if (n.setBaby) n.setBaby(true); else if (n.ageT !== undefined) n.ageT = -24000; }
    if (e.customName) n.customName = e.customName;
    n.persistent = e.persistent || !!e.customName;
    if (keep) keep(n);
    e.remove();
    return n;
  }
  // a block broken by a mob (a zombie through a door, an enderman's pick)
  breakBlock(x, y, z, drop) {
    const W = this.world;
    for (const [gx, gy, gz] of breakAt(W, x, y, z)) {
      const b = W.get(gx, gy, gz);
      if (drop) { const d = dropOf(b); if (d) this.dropItemAt(gx + 0.5, gy + 0.5, gz + 0.5, BLOCKS[d].name, 1, true, false); }
      W.set(gx, gy, gz, 0, 0);
      if (this.fluids) this.fluids.around(gx, gy, gz);
    }
    this.particles('poof', x + 0.5, y + 0.5, z + 0.5, 6, 0.4);
  }

  /* ---- what the crosshair is on ----
     the nearest entity whose box the ray enters within maxDist */
  raycast(eye, dir, maxDist) {
    let best = null, bt = maxDist;
    this.forNear(eye.x, eye.z, maxDist + 2, e => {
      if (e.removed || e === this.riding || e.constructor.NOT_PICKABLE || (e.dead && e.deathTime > 0) || e.vehicle === this.player) return;
      const g = e.constructor.PICK || 0;
      const t = rayBox(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, e.pos.x - e.hw - g, e.pos.y - g, e.pos.z - e.hw - g, e.pos.x + e.hw + g, e.pos.y + e.h + g, e.pos.z + e.hw + g);
      if (t < bt) { bt = t; best = e; }
    });
    return best ? { entity: best, t: bt } : null;
  }
  // for the interactor: the entity in reach (3 blocks in survival, 5 in creative) and in front of any block hit
  pickFor(eye, blockT) {
    const P = this.P, dir = this.lookDir || (this.lookDir = new THREE.Vector3());
    dir.set(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    (this.lookEye || (this.lookEye = new THREE.Vector3())).copy(eye);
    const reach = this.combat.reach();
    const h = this.raycast(eye, dir, Math.min(reach, blockT === undefined ? reach : blockT));
    return h ? h.entity : null;
  }
  /* Right click with something that makes an entity: a boat (on water, or on
     the block looked at), a spawn egg, an egg or snowball to throw. True if
     it was used. */
  useHeld(target) {
    // a fence: the mobs you lead are tied to it, whatever is in your hand (entities/items2.js)
    if (target && target.face && tieToFence(this, target)) return true;
    const name = this.heldName();
    if (!name || !this.lookEye) return false;
    /* On the pig or strider you ride, its stick gives it a burst of speed (none while one is on), worn
       7 (a carrot) or 1 (warped fungus); worn out it is a plain fishing rod again (the game's FoodOnAStick) */
    const stick = STICKS[name], r = this.riding;
    if (stick && r && r.type === stick[0] && r.boost) {
      if (!r.boost()) return false;
      if (this.mode !== 'creative' && this.inv) {
        this.damageHeld(stick[1], name);
        if (!this.inv.slots[this.inv.selected]) { this.inv.slots[this.inv.selected] = { id: I.fishing_rod, count: 1 }; this.inv.changed(); }
      }
      return true;
    }
    const P = this.P, eye = this.lookEye, dir = this.lookDir;
    const take = () => { if (this.mode !== 'creative' && this.inv) this.inv.takeSelected(1); };
    // adventure puts nothing into the world with an item (a boat is the exception, as in the game)
    const build = this.mode !== 'adventure' && this.mode !== 'spectator';
    if (/_boat$|_raft$/.test(name)) {
      if (!this.placeBoatLooking(name, this.mode === 'creative' ? 5 : 4.5)) return false;
      take();
      return true;
    }
    if (CART_ITEMS[name] && target && isRail(target.b)) {
      if (!build) return false;
      if (placeMinecart(this, target.x, target.y, target.z, CART_ITEMS[name])) take();
      return true;
    }
    if (/_spawn_egg$/.test(name)) {
      const type = name.slice(0, -10);
      // on a spawner: the spawner takes the egg's mob (struct/spawners.js)
      if (target && build && target.face && setSpawnerMob(this.world, target.x, target.y, target.z, type)) { take(); return true; }
      if (!TYPES[type] || !build) return false;
      // on a block, where the game puts it; at nothing, into the water or lava looked at
      const at = target && target.face ? this.eggSpot(target) : !target ? this.eggFluidSpot() : null;
      if (!at) return false;
      // (a mob from an egg is not kept for good: like any other it goes when you are far off, unless named)
      if (!this.spawn(type, at[0], at[1], at[2], { natural: true, egg: true })) return false;
      take();
      return true;
    }
    if (name === 'egg' || name === 'snowball' || name === 'splash_potion' || name === 'lingering_potion') {
      const thrown = name === 'splash_potion' || name === 'lingering_potion';
      const e = this.spawn(thrown ? 'potion' : name, eye.x, eye.y - 0.1, eye.z, { natural: false });
      if (!e) return false;
      e.owner = this.player;
      if (thrown) {
        // the potion it carries; thrown at 0.5, aimed 20 degrees above the look (the game's)
        const st = this.inv && this.inv.slots[this.inv.selected];
        e.potion = (st && st.potion) || 'water'; e.lingering = name === 'lingering_potion';
        // (the game lifts only the upward part: across it keeps the look's own pitch)
        const yaw = P.yaw, c = Math.cos(P.pitch);
        e.shoot(-Math.sin(yaw) * c, Math.sin(P.pitch + 20 * DEG), -Math.cos(yaw) * c, 0.5, 1);
      } else e.shoot(dir.x, dir.y, dir.z, 1.5, 1);
      e.vel.x += P.vel.x; e.vel.z += P.vel.z; if (!P.onGround) e.vel.y += P.vel.y;
      take();
      return true;
    }
    // pearls, bottles o' enchanting, wind charges, fireworks, armor stands, paintings, the fishing rod (entities/items2.js)
    return useExtra(this, name, target, take, build);
  }
  /* The player's bow, for the items module: drawn for so many ticks, an
     arrow at 3 x power (power = (f^2 + 2f) / 3 of f = ticks / 20, at most 1),
     critical at full draw. Returns the arrow, or null if barely drawn. */
  shootArrow(ticks, o = {}) {
    const f = ticks / 20;
    const power = Math.min(1, (f * f + f * 2) / 3);
    if (power < 0.1) return null;
    const P = this.P, eye = P.pos.clone(); eye.y += 1.62 - 0.1;
    const dir = new THREE.Vector3(-Math.sin(P.yaw) * Math.cos(P.pitch), Math.sin(P.pitch), -Math.cos(P.yaw) * Math.cos(P.pitch));
    const a = this.spawn('arrow', eye.x, eye.y, eye.z, { natural: false });
    a.owner = this.player; a.crit = power >= 1; a.pickup = this.mode === 'creative' ? 0 : 1;
    if (o.power) a.base += o.power * 0.5 + 0.5;          // the Power enchantment
    if (o.punch) a.knock = o.punch;
    if (o.flame) a.fire = 100;
    a.shoot(dir.x, dir.y, dir.z, power * 3, 1);
    a.vel.x += P.vel.x; a.vel.z += P.vel.z; if (!P.onGround) a.vel.y += P.vel.y;
    return a;
  }
  /* A container that is an entity, in the block at (x, y, z), for hoppers
     and droppers (containers.js): a chest boat whose box is in that block
     (one of them at random, as the game picks). */
  containerAt(x, y, z) {
    let found = null, n = 0;
    this.forNear(x + 0.5, z + 0.5, 2, e => {
      if (!e.slots || !e.chest || e.removed || e.pos.x + e.hw <= x || e.pos.x - e.hw >= x + 1 || e.pos.z + e.hw <= z || e.pos.z - e.hw >= z + 1 || e.pos.y + e.h <= y || e.pos.y >= y + 1) return;
      if (Math.random() * ++n < 1) found = e;
    });
    return found;
  }
  // a cart of any kind from a dispenser (dispense.js), on the rail at (x, y, z)
  placeCartAt(name, x, y, z) { return placeMinecart(this, x, y, z, CART_ITEMS[name] || 'minecart'); }
  // a boat from a dispenser (dispense.js): where it says, facing its way
  placeBoatAt(name, x, y, z, yaw) { return placeBoat(this, name, x, y, z, yaw); }
  /* A boat from its item, the game's way: where the look first meets a block
     or the surface of water (within reach), facing the way you look; not
     if it would be inside a block, a boat, a mob or you (so not on the side
     of a block), nor while your eyes are inside a mob. Returns the boat or
     null. */
  /* Where a spawn egg used on a block puts its mob, as the game does: in
     the block clicked if nothing there stops you (grass, a flower, snow),
     else in the one beside the face; then, from a block above that, let down
     onto whatever stops it there (two blocks down when it was a top face that
     was clicked, so it stands on a slab or a fence, one otherwise). */
  eggSpot(target) {
    const T = this.t, f = target.face, d = BLOCKS[target.b];
    const empty = !d || !d.solid;
    const x = empty ? target.x : target.x + f[0], y = empty ? target.y : target.y + f[1], z = empty ? target.z : target.z + f[2];
    const more = !empty && f[1] > 0, down = more ? 2 : 1;
    const y0 = y + 1;
    T.gather(x, y0 - down, z, x + 1, y0 + 1, z + 1);
    const dy = T.clip(1, -down, x + 0.001, y0, z + 0.001, x + 0.999, y0 + 1, z + 0.999);
    return [x + 0.5, y0 + dy, z + 0.5];
  }
  // at nothing in reach: the source block of water or lava along the look, the mob put in it
  eggFluidSpot() {
    const eye = this.lookEye, dir = this.lookDir, T = this.t;
    if (!eye || !dir) return null;
    const reach = this.mode === 'creative' ? 5 : 4.5;
    if (T.ray(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, reach, true) >= reach) return null;
    const x = T.rayX, y = T.rayY, z = T.rayZ;
    if (!FLUID[T.get(x, y, z)] || (T.meta(x, y, z) & 15)) return null;
    return [x + 0.5, y, z + 0.5];
  }
  placeBoatLooking(name, reach) {
    const P = this.P, eye = this.lookEye, dir = this.lookDir, T = this.t;
    if (!eye || !dir) return null;
    let inside = false;
    this.forNear(eye.x, eye.z, 4, e => {
      if (!inside && !e.removed && (e instanceof Living || e.constructor.SOLID || e instanceof Minecart) && e !== this.riding
        && Math.abs(eye.x - e.pos.x) < e.hw && Math.abs(eye.z - e.pos.z) < e.hw && eye.y > e.pos.y && eye.y < e.pos.y + e.h) inside = true;
    });
    if (inside) return null;
    const t = T.ray(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, reach, true);
    if (t >= reach) return null;
    let x = eye.x + dir.x * t, y = eye.y + dir.y * t, z = eye.z + dir.z * t;
    const bx = T.rayX, by = T.rayY, bz = T.rayZ;
    if (FLUID[T.get(bx, by, bz)]) {
      // water (or lava, where it burns): its surface, a little under the top of its cell
      const surf = by + T.fluidHeight(bx, by, bz);
      if (dir.y < -1e-6 && eye.y > surf) { const ts = (surf - eye.y) / dir.y; if (ts > reach) return null; x = eye.x + dir.x * ts; y = surf; z = eye.z + dir.z * ts; }
      else y = Math.min(y, surf);
    }
    const hw = 0.6875, E = 1e-7;
    if (T.boxHits(x - hw, y, z - hw, x + hw, y + 0.5625, z + hw)) return null;
    // nor into a mob (anything that can be pushed) or a minecart, nor into you
    let blocked = false;
    this.forNear(x, z, 3, e => {
      if (blocked || e.removed || e.dead || e.vehicle) return;
      if (!(e instanceof Living && !e.constructor.NO_PUSH) && !e.constructor.SOLID && !(e instanceof Minecart)) return;
      if (e.pos.x + e.hw > x - hw + E && e.pos.x - e.hw < x + hw - E && e.pos.z + e.hw > z - hw + E && e.pos.z - e.hw < z + hw - E && e.pos.y + e.h > y + E && e.pos.y < y + 0.5625 - E) blocked = true;
    });
    if (blocked) return null;
    if (this.mode !== 'spectator' && P.pos.x + 0.3 > x - hw + E && P.pos.x - 0.3 < x + hw - E && P.pos.z + 0.3 > z - hw + E && P.pos.z - 0.3 < z + hw - E && P.pos.y + (P.h || 1.8) > y + E && P.pos.y < y + 0.5625 - E) return null;
    return placeBoat(this, name, x, y, z, P.yaw);
  }

  /* ---- drawing, once a frame ---- */
  render(alpha) {
    if (this.riding) this.rideFrame(alpha);
    const M = this.meshes;
    M.begin();
    // what mobs hold (render/mobheld.js): one set for the renderer, whichever world is drawn
    const held = this.R.mobHeld || (this.R.mobHeld = new MobHeld(this.R));
    held.begin();
    const cam = this.R.camera;
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const P = this.P, far = (this.world.renderDist || 8) * 16 + 16, far2 = far * far;
    // Entity Distance (Video Settings): the game draws a mob out to 64 blocks for each block of its
    // average side, times the setting; Entity Shadows: the round shadows under them, or none
    const ed = 64 * (this.entityDistance === undefined ? 2.5 : this.entityDistance), blobs = this.entityShadows !== false;
    const realOn = !!(this.R.opts && this.R.opts.realism);
    const k = 0.15;
    for (const e of this.list) {
      if (e.removed) continue;
      const c = e.constructor;
      if (!c.MODEL && !c.PARTICLE && !c.BLOCK) continue;
      const x = e.prev.x + (e.pos.x - e.prev.x) * alpha, y = e.prev.y + (e.pos.y - e.prev.y) * alpha, z = e.prev.z + (e.pos.z - e.prev.z) * alpha;
      const dx = x - P.pos.x, dz = z - P.pos.z;
      if (dx * dx + dz * dz > far2) continue;
      // (RIP Computer: walking through the grass parts it: render/realism.js)
      if (realOn && c.MODEL && !e.dead && (e.onGround || e.inWater) && dx * dx + dz * dz < 784) walkers.add(x, y + (e.onGround ? 0 : e.h * 0.5 - 0.45), z, (e.w || 0.6) / 0.6, e.onGround);
      const reach = ed * ((e.w || 0.6) * 2 + (e.h || 0.6)) / 3, dy = y - P.pos.y;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      // the light, eased so it never pops (anything on fire is lit as by a torch at its brightest, as in the game)
      e.lS += (e.lightS / 15 - e.lS) * k; e.lB += ((e.fire > 0 ? 15 : e.lightB) / 15 - e.lB) * k;
      this.sphere.center.set(x, y + e.h / 2, z); this.sphere.radius = Math.max(e.w, e.h) + 1.5;
      // under Invisibility a mob is not drawn, nor its shadow (but Glowing's outline still shows, as in the game)
      const inView = this.frustum.intersectsSphere(this.sphere), fx = e.effects, glow = !!(fx && fx.glowing);
      const seen = inView && !(fx && fx.invisibility);
      if (c.BLOCK) { e.draw(this.group, this.R, alpha); continue; }
      this.meshes.glowNow = glow ? (seen ? 2 : 3) : 1;
      if (seen || (inView && glow && !c.PARTICLE)) { if (c.PARTICLE) e.particle(this.meshes, alpha, x, y, z); else this.drawOne(e, alpha, x, y, z); }
      this.meshes.glowNow = 1;
      // the game's flames round anything burning (render/particles.js burn)
      if (seen && e.fire > 0 && !c.PARTICLE && this.R.particles) this.R.particles.burn(x, y, z, e.w || 0.6, e.h || 1.8);
      // a boat keeps the water out of its inside
      if (seen && c.WATER_MASK && !(e.noMask && e.noMask())) this.meshes.maskAt(x, y + c.WATER_MASK, z, e.prevYaw + wrap(e.yaw - e.prevYaw) * alpha, c.MASK_HX || 0.55, c.MASK_HZ || 0.74);
      // its round shadow on the ground
      if (seen && blobs && c.SHADOW && !e.vehicle) this.shadowOf(e, x, y, z, c.SHADOW * (e.baby || e.ageT < 0 ? 0.5 : 1) * (c.SCALE || 1));
    }
    if (blobs) {
      /* your own round shadow in third person (F5), as the game draws it under the player (0.5 across the
         middle); only on the Off look, since the shader looks cast your real shadow. And every dropped
         item's and experience orb's, 0.15 and three quarters as dark, as the game draws theirs. */
      const av = this.R.avatar;
      if (av && av.view && this.R.vanilla && this.mode !== 'spectator' && !this.riding) {
        const pp = P.prev || P.pos, sh = this.youShadow || (this.youShadow = { lS: 1, lB: 0 });
        sh.lS = av.sky; sh.lB = av.block;
        this.shadowOf(sh, pp.x + (P.pos.x - pp.x) * alpha, pp.y + (P.pos.y - pp.y) * alpha, pp.z + (P.pos.z - pp.z) * alpha, 0.5);
      }
      const D = activeDrops(), it = this.itemShadow || (this.itemShadow = { lS: 1, lB: 0 });
      if (D && D.world === this.world) for (const e of D.items) {
        if (!e.mesh || e.fly > 0 || e.light < 0) continue;
        it.lS = (e.light >> 8) / 255; it.lB = (e.light & 255) / 255;
        this.shadowOf(it, e.prev.x + (e.pos.x - e.prev.x) * alpha, e.prev.y + (e.pos.y - e.prev.y) * alpha, e.prev.z + (e.pos.z - e.prev.z) * alpha, 0.15, 0.75);
      }
      if (D && D.world === this.world) for (const o of D.orbs) {
        if (!o.mesh || o.fly > 0 || !(o.light >= 0)) continue;
        it.lS = (o.light >> 8) / 255; it.lB = Math.max(0, (o.light & 255) / 255 - 7 / 15);
        this.shadowOf(it, o.prev.x + (o.pos.x - o.prev.x) * alpha, o.prev.y + (o.pos.y - o.prev.y) * alpha, o.prev.z + (o.pos.z - o.prev.z) * alpha, 0.15, 0.75);
      }
    }
    // (your own model is lit as by a torch at its brightest while you burn, as the game does: render/avatar.js)
    if (this.R.avatar) {
      const A = this.R.avatar, fx = this.survival && this.survival.effects;
      A.burning = !!(this.survival && this.survival.onFire);
      A.invisible = !!(fx && fx.invisibility); A.glowing = !!(fx && fx.glowing);
    }
    // you, burning, seen from behind or in front (F5)
    if (this.survival && this.survival.onFire && this.R.avatar && this.R.avatar.view && this.R.particles && this.mode !== 'spectator') {
      const pp = P.prev || P.pos;
      this.R.particles.burn(pp.x + (P.pos.x - pp.x) * alpha, pp.y + (P.pos.y - pp.y) * alpha, pp.z + (P.pos.z - pp.z) * alpha, 0.6, P.h || 1.8);
    }
    // the mobs turning inside spawners (struct/spawners.js): drawn, never ticked or hit
    for (const e of this.displays) this.drawOne(e, alpha, e.pos.x, e.pos.y, e.pos.z);
    // the dead lying where they fell (corpse), sinking into the ground in their last second and a half
    for (const e of this.corpses) {
      const x = e.prev.x + (e.pos.x - e.prev.x) * alpha, z = e.prev.z + (e.pos.z - e.prev.z) * alpha;
      const dx = x - P.pos.x, dz = z - P.pos.z;
      if (dx * dx + dz * dz > far2) continue;
      const sink = Math.max(0, (e.corpseT + alpha - CORPSE_TICKS) / 30) * ((e.w || 0.6) + 0.3);
      const y = e.prev.y + (e.pos.y - e.prev.y) * alpha - sink;
      this.sphere.center.set(x, y + e.h / 2, z); this.sphere.radius = Math.max(e.w, e.h) + 1.5;
      if (this.frustum.intersectsSphere(this.sphere)) this.drawOne(e, alpha, x, y, z);
    }
    this.particlesP.draw(M, alpha);
    M.end();
    held.end();
  }
  shadowOf(e, x, y, z, r, k = 1) {
    const T = this.t;
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let yy = Math.floor(y + 0.01); yy > y - 3; yy--) {
      const b = T.get(bx, yy - 1, bz);
      if (b && BLOCKS[b].solid) {
        const top = yy;
        const dy = y - top;
        if (dy < -0.05) break;
        const a = 0.55 * k * Math.max(0, 1 - dy / 3) * Math.min(1, (e.lS * e.lS + e.lB) * 1.2 + 0.3);
        if (a > 0.02) this.meshes.blobAt(x, top + 0.003, z, r, a);
        break;
      }
      if (FLUID[b]) break;
    }
  }
  drawOne(e, a, x, y, z) {
    const c = e.constructor, M = this.meshes;
    const name = e.modelName ? e.modelName() : c.MODEL;
    const mdl = MODELS[name];
    if (!mdl) return;
    const P = this.pose, A = this.A;
    restPose(mdl, P);
    const living = e instanceof Living;
    const body = living ? e.prevBodyYaw + wrap(e.bodyYaw - e.prevBodyYaw) * a : e.prevYaw + wrap(e.yaw - e.prevYaw) * a;
    if (living) {
      /* the head as a turn off the body, eased between the two ticks' turns: the
         head and the body eased each on its own could go opposite ways round when
         the 75-degree clamp moved the head to the body's other side, drawing the
         head twisted up to 162 degrees off for a frame */
      const o0 = wrap(e.prevHeadYaw - e.prevBodyYaw), o1 = wrap(e.headYaw - e.bodyYaw);
      const head = body + o0 + wrap(o1 - o0) * a;
      A.walk = e.prevWalk + (e.walk - e.prevWalk) * a; A.amt = Math.min(1, e.prevWalkAmt + (e.walkAmt - e.prevWalkAmt) * a);
      if (e.dead) A.amt = 0;
      A.age = e.age + a;
      A.yaw = -wrap(head - body);
      A.pitch = -(e.prevPitch + (e.pitch - e.prevPitch) * a);
      let at = e.swingT / 6 - e.prevSwing; if (at < 0) at += 1;
      A.attack = e.swinging || e.prevSwing > 0 ? Math.min(1, e.prevSwing + at * a) : 0;
      A.aggressive = false; A.aiming = false; A.eating = 0; A.flap = 0; A.swell = 0; A.riding = !!e.vehicle; A.shake = false; A.angry = false; A.carry = 0; A.sitting = !!e.sitting;
      if (e.anim) e.anim(A, a);
    } else {
      A.walk = 0; A.amt = 0; A.age = e.age + a; A.yaw = 0; A.pitch = 0; A.attack = 0;
      if (e.anim) e.anim(A, a);
    }
    mdl.animate && mdl.animate(mdl, P, A);
    // the root: at the feet, turned with the body
    const root = this.m4[0], t = this.m4[1];
    root.makeRotationY(body + Math.PI);
    root.setPosition(x, y, z);
    if (e.rootPose) e.rootPose(root, t, a, A);
    if (living && e.dead) {
      // falling over: 90 degrees over the first part of the 20 ticks
      let f = Math.sqrt(Math.max(0, (e.deathTime + a - 1) / 20 * 1.6));
      if (f > 1) f = 1;
      root.multiply(t.makeRotationZ(f * Math.PI / 2 * (c.FLIP || 1)));
    }
    let s = (c.SCALE || 1) / 16 * (e.drawScale || 1);
    if (e.baby || (e.ageT !== undefined && e.ageT < 0)) s *= 0.5;
    if (A.swell > 0) {
      // a creeper swelling before it goes
      const f0 = Math.max(0, Math.min(1, A.swell));
      const wob = 1 + Math.sin(f0 * 100) * f0 * 0.01;
      const f = f0 * f0 * f0 * f0;
      root.multiply(t.makeScale((1 + f * 0.4) * wob * s, (1 + f * 0.1) / wob * s, (1 + f * 0.4) * wob * s));
    } else root.multiply(t.makeScale(s, s, s));
    // the parts
    const n = mdl.parts.length, mats = this.parts, eu = this.euler;
    const baby = e.baby || (e.ageT !== undefined && e.ageT < 0);
    const bone = M.allocBones(n);
    for (let i = 0; i < n; i++) {
      const o = i * POSE, part = mdl.parts[i], m = mats[i];
      m.makeRotationFromEuler(eu.set(P[o + 3], -P[o + 4], -P[o + 5], 'ZYX'));
      let ps = P[o + 6];
      if (baby && i === mdl.index.head) ps *= c.BABY_HEAD || 1.5;
      if (ps !== 1) m.scale(this.v3(ps));
      if (part.parent >= 0) { m.setPosition(P[o], -P[o + 1], -P[o + 2]); m.premultiply(mats[part.parent]); }
      else { m.setPosition(P[o], 24 - P[o + 1], -P[o + 2]); m.premultiply(root); }
      M.setBone(bone + i, m);
    }
    // what it holds, in its hands
    if (e.equip && (e.equip.mainhand || e.equip.offhand || e.equip.head)) this.R.mobHeld.hold(e, mdl, mats, e.lS, e.lB);
    const slot = SLOTS[e.texName ? e.texName() : c.TEX] || [0, 0];
    const white = A.swell > 0 ? (Math.floor(A.swell * 10) % 2 ? Math.max(0.5, Math.min(1, A.swell)) * 0.7 : 0) : 0;
    const hurt = e.hurtTime > 0 || (living && e.dead && e.corpseT === undefined) ? 1 : 0;
    const tint = e.tint ? e.tint() : 0xffffff;
    M.add(M.model(name, mdl), bone, slot[0], slot[1], e.lS, e.lB, hurt, white, ((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255);
    // layers on the same bones: wool, saddles, armour ([model, texture, colour, glint, no hurt flash])
    const L = this.layerList; L.length = 0;
    if (e.layers) e.layers(L);
    if (e.equip) armorLayers(this, e, name, L);
    for (const [ln, lt, col, glint, steady] of L) {
      const lm = MODELS[ln];
      if (!lm) continue;
      const ls = SLOTS[lt] || slot;
      const cc = col === null || col === undefined ? 0xffffff : col;
      M.add(M.model(ln, lm), bone, ls[0], ls[1], e.lS, e.lB, steady ? 0 : hurt, white, ((cc >> 16) & 255) / 255, ((cc >> 8) & 255) / 255, (cc & 255) / 255, glint ? 1 : 0);
    }
  }
  v3(s) { return (this._v3 || (this._v3 = new THREE.Vector3())).set(s, s, s); }

  /* ---- keeping them ---- */
  toJSON() {
    const list = [];
    for (const e of this.list) if (!e.removed && !e.dead && e.toJSON && !(e.constructor.HOSTILE && !e.persistent && e.constructor.NO_SAVE) && !(e.vehicle && e.vehicle.constructor.KEEPS_RIDERS)) list.push(e.toJSON());
    const stored = {};
    for (const [k, a] of this.stored) stored[k] = a;
    return { v: 1, list, stored, pop: [...this.populated], wt: this.wt || null };
  }
  fromJSON(o) {
    if (!o) return;
    for (const e of o.list || []) if (TYPES[e.t]) this.spawn(e.t, e.p[0], e.p[1], e.p[2], { json: e, natural: false });
    // saved sitting in a boat: back in it
    if (this.remount && !this.remount.removed) this.mount(this.remount);
    this.remount = null;
    for (const k in o.stored || {}) this.stored.set(k, o.stored[k]);
    for (const k of o.pop || []) this.populated.add(k);
    if (o.wt) this.wt = o.wt;
  }
  // leaving the world: drop everything
  dispose() {
    this.gone = true;
    this.corpses.length = 0;
    if (this.P.extraBoxes === this.boxFn) this.P.extraBoxes = null;
    for (const e of this.list) if (e.mesh) e.remove();
    this.list.length = 0;
    if (this.world.onSetE) this.world.onSetE = null;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
import { rayBox } from './terrain.js?v=107';
