/* ---------------------------------------------------------------------------
   Leoncraft 2 - every entity in the world, and the game's dealings with them.

     tick()        20 a second: spawning, every entity's tick, the grid that
                   finds neighbours, chunks unloading (their entities are
                   kept and come back with the chunk), despawning
     render(a)     the frame: each mob posed between ticks into the bone
                   texture, instanced by model (render/entitymesh.js)
     raycast()     what the crosshair is on, for attacking and using
     attack(e)     the player's hit, by the 1.9 combat rules: the cooldown
                   scales the damage (0.2 + 0.8 x charge squared), a full
                   charge while falling is a critical (x1.5), sprinting adds
                   knockback, a sword on the ground sweeps
     hurtPlayer()  a mob's hit on the player: difficulty scaling, the 10 tick
                   window, knockback, then survival.hurt(amount, source)
     spawn(type, x, y, z), toJSON(), fromJSON()

   The game passes hooks for what other parts own:
     dropItem(world, x, y, z, name, count)   a dropped item (items module)
     giveXp(amount, x, y, z)                  experience
     itemName(id)                             the name of an inventory id
   Without them, drops of things that are blocks go straight into the
   inventory and the rest are left out.
--------------------------------------------------------------------------- */
import { Terrain } from './terrain.js?v=8';
import { PathFinder, Navigation } from './path.js?v=8';
import { Particles } from './particles.js?v=8';
import { Living, Mob, wrap, DEG } from './entity.js?v=8';
import { TYPES } from './mobs.js?v=8';
import './projectiles.js?v=8';
import './boat.js?v=8';
import './mobs2.js?v=8';
import { explode } from './explosion.js?v=8';
import { placeBoat } from './boat.js?v=8';
import { Spawner } from './spawner.js?v=8';
import { MODELS, POSE, restPose } from './mobmodels.js?v=8';
import { buildAtlas, buildSheet, SLOTS } from './mobart.js?v=8';
import { EntityMeshes } from '../render/entitymesh.js?v=8';
import { B, BLOCKS, FLUID, OPACITY } from '../blocks.js?v=8';
import { breakAt } from '../place.js?v=8';
import { dropOf } from '../survival.js?v=8';
const THREE = window.THREE;

const R = () => Math.random();
const CELL = 16;
const DIFF = { peaceful: 0, easy: 1, normal: 2, hard: 3 };

// weapons: [damage, attack speed]; anything else is a fist (1, 4)
function weaponOf(name) {
  if (!name) return [1, 4, ''];
  const tier = /^(wooden|stone|iron|golden|diamond|netherite)_/.exec(name);
  const t = tier ? tier[1] : null;
  if (/_sword$/.test(name)) return [{ wooden: 4, stone: 5, iron: 6, golden: 4, diamond: 7, netherite: 8 }[t] || 4, 1.6, 'sword'];
  if (/_axe$/.test(name)) return [{ wooden: 7, stone: 9, iron: 9, golden: 7, diamond: 9, netherite: 10 }[t] || 7, { wooden: 0.8, stone: 0.8, iron: 0.9 }[t] || 1, 'axe'];
  if (/_pickaxe$/.test(name)) return [{ wooden: 2, stone: 3, iron: 4, golden: 2, diamond: 5, netherite: 6 }[t] || 2, 1.2, 'pickaxe'];
  if (/_shovel$/.test(name)) return [{ wooden: 2.5, stone: 3.5, iron: 4.5, golden: 2.5, diamond: 5.5, netherite: 6.5 }[t] || 2.5, 1, 'shovel'];
  if (/_hoe$/.test(name)) return [1, { wooden: 1, stone: 2, iron: 3, golden: 1, diamond: 4, netherite: 4 }[t] || 1, 'hoe'];
  if (name === 'trident') return [9, 1.1, 'trident'];
  if (name === 'mace') return [6, 0.6, 'mace'];
  return [1, 4, ''];
}

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
    this.grid = new Map();
    this.particlesP = new Particles();
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
      isPlayer: true, type: 'player', get pos() { return P.pos; }, get vel() { return P.vel; }, w: 0.6, hw: 0.3, h: 1.8, eyeH: 1.62,
      alive: () => !self.survival.dead && !self.gone,
      creative: () => self.mode === 'creative',
      sneaking: () => P.sneaking,
      inWater: () => P.inWater,
      hurt: (n, src) => self.hurtPlayer(n, src),
      knockback: (s, dx, dz) => self.knockPlayer(s, dx, dz),
      push: (x, y, z) => { P.vel.x += x; P.vel.y += y; P.vel.z += z; },
      dist2: (x, y, z) => (P.pos.x - x) ** 2 + (P.pos.y - y) ** 2 + (P.pos.z - z) ** 2,
      heal: n => { self.survival.health = Math.min(20, self.survival.health + n); },
    };
  }
  get difficulty() { return (this.options && this.options.get('difficulty')) || 'normal'; }
  get time() { return this.hooks.time ? this.hooks.time() : 6000; }

  /* ---- light and the time of day, the game's way ---- */
  // how much the sky light is taken down at this time of day (0 at noon, 11 at midnight)
  skyDarken() {
    const t = this.time % 24000;
    let f = t / 24000 - 0.25;
    f = f - Math.floor(f);
    const c = (f * 2 + (0.5 - Math.cos(f * Math.PI) / 2)) / 3;
    let d = 1 - (Math.cos(c * Math.PI * 2) * 2 + 0.5);
    d = Math.max(0, Math.min(1, d));
    return Math.floor(d * 11);
  }
  isDay() { return this.skyDarken() < 4; }
  rawBrightness(x, y, z) { return Math.max(this.t.sky(x, y, z) - this.skyDarken(), this.t.block(x, y, z)); }
  brightness(x, y, z) { const f = this.rawBrightness(x, y, z) / 15; return f / (4 - 3 * f); }
  seesSky(x, y, z) { return y >= this.t.motionTop(x, z) - 0; }

  /* ---- finding neighbours ---- */
  rebuildGrid() {
    for (const a of this.grid.values()) a.length = 0;
    for (const e of this.list) {
      if (e.removed) continue;
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
    const p = e.pos;
    this.forNear(p.x, p.z, 2, o => {
      if (o === e || o.removed || o.dead || !(o instanceof Living) || o.vehicle || o.constructor.NO_PUSH) return;
      if (o.id < e.id && this.age % 1 === 0 && o.pushedWith === this.age) return;
      if (Math.abs(o.pos.x - p.x) >= o.hw + e.hw || Math.abs(o.pos.z - p.z) >= o.hw + e.hw || o.pos.y >= p.y + e.h || o.pos.y + o.h <= p.y) return;
      // an empty boat takes a mob in
      if (o.takesPassenger && o.takesPassenger(e)) { o.addPassenger(e); return; }
      this.pushPair(e, o);
    });
    e.pushedWith = this.age;
    const P = this.P;
    if (this.player.alive() && !this.riding && e !== this.riding && Math.abs(P.pos.x - p.x) < 0.3 + e.hw && Math.abs(P.pos.z - p.z) < 0.3 + e.hw && P.pos.y < p.y + e.h && P.pos.y + 1.8 > p.y) {
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
    const e = new C(this, type);
    e.setPos(x, y, z);
    if (o.yaw !== undefined) e.yaw = e.prevYaw = o.yaw;
    else if (e instanceof Living) e.yaw = e.prevYaw = R() * Math.PI * 2;
    if (e instanceof Living) { e.bodyYaw = e.prevBodyYaw = e.headYaw = e.prevHeadYaw = e.yaw; }
    if (e instanceof Mob) e.nav = new Navigation(e);
    if (o.natural !== false && e.finalizeSpawn && !o.json) e.finalizeSpawn(o);
    if (o.json) e.fromJSON(o.json);
    if (o.persistent) e.persistent = true;
    e.lightS = 15; e.lightB = 0; e.lS = 1; e.lB = 0;
    this.sampleLight(e, true);
    this.list.push(e);
    return e;
  }
  get count() { return this.list.length; }

  /* ---- 20 a second ---- */
  tick() {
    this.age++;
    this.t.reset();
    this.budget = 6;
    const P = this.P;
    // the attack cooldown counts up; changing what you hold starts it again
    this.ticksSinceSwing++;
    const held = this.inv ? this.inv.heldId() : 0;
    if (held !== this.lastHeld) { this.lastHeld = held; this.ticksSinceSwing = 0; }
    if (this.pInvul > 0) this.pInvul--;
    this.effectsTick();
    if (this.difficulty === 'peaceful') this.peaceful();
    this.spawner.tick();
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const e = this.list[i];
      if (e.removed) continue;
      if (e.vehicle) { this.ridingTick(e); continue; }
      e.tick();
      if (e.passengers.length) this.positionRiders(e);
      if (!e.removed && (this.age + e.id) % 4 === 0) this.sampleLight(e);
      // flames off anything burning
      if (e.fire > 0 && !e.removed && (this.age + e.id) % 2 === 0) this.particlesP.add('flame', e.pos.x + (R() - 0.5) * e.w, e.pos.y + R() * e.h, e.pos.z + (R() - 0.5) * e.w, 1, 0);
    }
    if (this.riding && this.riding.removed) this.dismount();
    // the dead go
    let j = 0;
    for (let i = 0; i < this.list.length; i++) { const e = this.list[i]; if (!e.removed) this.list[j++] = e; else this.forget(e); }
    this.list.length = j;
    this.rebuildGrid();
    if (this.age % 20 === 0) this.chunks();
    this.particlesP.tick();
  }
  forget(e) {
    if (e.vehicle) { const v = e.vehicle; v.passengers.splice(v.passengers.indexOf(e), 1); e.vehicle = null; }
    for (const p of e.passengers) { if (p !== this.player) p.vehicle = null; }
    if (this.riding === e) this.dismount();
  }
  // the light where a mob's eyes are, eased when drawn
  sampleLight(e, now) {
    const x = Math.floor(e.pos.x), y = Math.floor(e.pos.y + Math.min(e.h, 1.6) * 0.85), z = Math.floor(e.pos.z);
    e.lightS = this.t.sky(x, y, z); e.lightB = this.t.block(x, y, z);
    if (now) { e.lS = e.lightS / 15; e.lB = e.lightB / 15; }
  }
  // Peaceful: monsters vanish, and you heal a point a second
  peaceful() {
    for (const e of this.list) if (e.constructor.HOSTILE && !e.removed) e.remove();
    if (this.age % 20 === 0 && this.mode !== 'creative' && !this.survival.dead && this.survival.health < 20) this.survival.health = Math.min(20, this.survival.health + 1);
  }
  /* Despawning (the game's): beyond 128 blocks a monster goes at once; beyond
     32, after 30 seconds with nothing happening, a 1 in 800 chance a tick. */
  despawnCheck(e) {
    if (e.persistent || e.passengers.length || e.vehicle) { e.noActionTime = 0; return; }
    const c = e.constructor, P = this.P;
    const d2 = e.dist2(P.pos.x, P.pos.y, P.pos.z);
    const far = c.DESPAWN || 128, near = 32;
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
      // monsters that would despawn anyway are just gone
      if (!(e.constructor.HOSTILE && !e.persistent) && e.toJSON) {
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
    for (const [k, c] of W.chunks) {
      if (this.populated.has(k)) continue;
      this.populated.add(k);
      if (this.difficulty !== 'peaceful' || true) this.spawner.populate(c.cx, c.cz);
    }
  }

  /* ---- riding ---- */
  mount(v) {
    if (this.riding) this.dismount();
    if (v.passengers.length >= (v.constructor.SEATS || 1)) {
      // a mob in your seat is put out
      const mob = v.passengers.find(p => p !== this.player);
      if (!mob || v.constructor.SEATS > 1) return false;
      this.unseat(mob);
    }
    this.riding = v;
    v.passengers.unshift(this.player);
    this.P.riding = v;
    this.P.vel.set(0, 0, 0);
    if (v.onMounted) v.onMounted(this.player);
    return true;
  }
  unseat(e) { const v = e.vehicle; if (!v) return; v.passengers.splice(v.passengers.indexOf(e), 1); e.vehicle = null; e.setPos(v.pos.x, v.pos.y + v.h + 0.1, v.pos.z); }
  dismount() {
    const v = this.riding;
    if (!v) return;
    this.riding = null; this.P.riding = null;
    const i = v.passengers.indexOf(this.player);
    if (i >= 0) v.passengers.splice(i, 1);
    // somewhere to stand beside it (or on top)
    const P = this.P, T = this.t;
    const tries = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    let placed = false;
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
        if (v.yawDelta) this.P.yaw += v.yawDelta;
      } else {
        p.pos.set(x, y, z);
        if (v.yawDelta) { p.yaw += v.yawDelta; p.bodyYaw = p.yaw; }
      }
    }
  }
  // a mob riding something: no movement of its own
  ridingTick(e) {
    const v = e.vehicle;
    if (!v || v.removed) { e.vehicle = null; return; }
    e.baseTick();
    e.vel.set(0, 0, 0);
    if (e instanceof Mob) { e.serverAi(); e.animTick && e.animTick(); }
    e.fallDist = 0;
  }

  /* ---- the player's side of a fight ---- */
  heldName() {
    const id = this.inv ? this.inv.heldId() : 0;
    if (!id) return '';
    if (this.hooks.itemName) return this.hooks.itemName(id) || '';
    return BLOCKS[id] ? BLOCKS[id].name : '';
  }
  offhandName() {
    const id = this.inv && this.inv.offhandId ? this.inv.offhandId() : 0;
    if (!id) return '';
    if (this.hooks.itemName) return this.hooks.itemName(id) || '';
    return BLOCKS[id] ? BLOCKS[id].name : '';
  }
  // how charged the next hit is (0..1): ticks since the last swing over 20 / attack speed
  cooldown() {
    const [, speed] = weaponOf(this.heldName());
    const delay = 20 / speed;
    return Math.max(0, Math.min(1, (this.ticksSinceSwing + 0.5) / delay));
  }
  // a click in the air (or on a block) starts the cooldown again, as the game does
  swung() { this.ticksSinceSwing = 0; }
  /* The player hits an entity. */
  attack(e) {
    const P = this.P;
    if (!e || e.removed) return false;
    const [base, , kind] = weaponOf(this.heldName());
    const c = this.cooldown();
    let dmg = base * (0.2 + c * c * 0.8);
    // not alive (a boat, a minecart): it just takes the hit
    if (!(e instanceof Living)) { this.ticksSinceSwing = 0; return e.hurt ? e.hurt(dmg, { type: 'player', attacker: this.player, player: true }) : false; }
    if (e.dead) { this.ticksSinceSwing = 0; return false; }
    const strong = c > 0.9;
    let knock = 0, sprintHit = false;
    if (P.sprinting && strong) { knock++; sprintHit = true; }
    const falling = this.survival && this.survival.fallFrom !== null && this.survival.fallFrom > P.pos.y;
    const crit = strong && falling && !P.onGround && !P.inWater && !this.riding && !P.flying && !P.sprinting && !this.climbing();
    if (crit) dmg *= 1.5;
    const walked = Math.abs(P.walkDist - P.prevWalk) / 0.6;
    const sweep = strong && !crit && !sprintHit && P.onGround && walked < 0.1 * 1.0 + 0.01 && kind === 'sword';
    if (this.mode === 'creative' && false) dmg = 1e9;
    const hpBefore = e.health;
    const ok = e.hurt(dmg, { type: 'player', attacker: this.player, player: true, x: P.pos.x, z: P.pos.z });
    this.ticksSinceSwing = 0;
    if (!ok) return false;
    e.lastHurtByPlayer = this.age;
    if (knock > 0) {
      e.knockback(knock * 0.5, Math.sin(P.yaw), Math.cos(P.yaw));
      P.vel.x *= 0.6; P.vel.z *= 0.6; P.sprinting = false;
    }
    if (sweep) {
      this.forNear(e.pos.x, e.pos.z, 3, o => {
        if (o === e || o.removed || o.dead || !(o instanceof Living) || o === this.riding) return;
        if (Math.abs(o.pos.x - e.pos.x) > e.hw + 1 + o.hw || Math.abs(o.pos.z - e.pos.z) > e.hw + 1 + o.hw || Math.abs(o.pos.y - e.pos.y) > 0.5) return;
        if (o.dist2(P.pos.x, P.pos.y, P.pos.z) >= 9) return;
        o.knockback(0.4, Math.sin(P.yaw), Math.cos(P.yaw));
        o.hurt(1, { type: 'player', attacker: this.player, player: true, noKnock: true });
      });
      const s = Math.sin(P.yaw), co = Math.cos(P.yaw);
      this.particlesP.add('sweep', P.pos.x - s, P.pos.y + 0.9, P.pos.z - co, 1, 0);
    }
    if (crit) this.particles('crit', e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, 12, e.w * 0.5);
    if (this.hooks.damageHeld && kind) this.hooks.damageHeld(kind === 'sword' || kind === 'trident' ? 1 : 2);
    this.lastHit = { dmg, crit, sweep, knock, cooldown: c, before: hpBefore, after: e.health };
    return true;
  }
  climbing() {
    const b = this.t.get(Math.floor(this.P.pos.x), Math.floor(this.P.pos.y), Math.floor(this.P.pos.z));
    return !!(BLOCKS[b] && /ladder|vine/.test(BLOCKS[b].name));
  }
  /* Right click on an entity. True if something happened (no block use then). */
  interact(e) {
    if (!e || e.removed || e.dead) return false;
    const held = this.heldName();
    const r = e.interact ? e.interact(held, this.player) : false;
    if (!r) return false;
    if (r === 'consume' && this.mode !== 'creative' && this.inv) this.inv.takeSelected(1);
    if (r === 'milk') { if (this.hooks.fillBucket) this.hooks.fillBucket('milk_bucket'); }
    if (r === 'damage' && this.hooks.damageHeld) this.hooks.damageHeld(1);
    return true;
  }

  /* ---- the player being hit ---- */
  hurtPlayer(amount, src) {
    if (!this.player.alive() || this.mode === 'creative' || !this.survival) return false;
    const diff = this.difficulty;
    // the game scales mob and explosion damage to the player by difficulty
    if (src.type === 'mob' || src.type === 'explosion' || src.type === 'arrow' || src.type === 'thrown') {
      if (diff === 'peaceful') amount = src.type === 'explosion' ? amount : 0;
      else if (diff === 'easy') amount = Math.min(amount / 2 + 1, amount);
      else if (diff === 'hard') amount = amount * 1.5;
    }
    if (amount <= 0) return false;
    // the 10 tick window
    if (this.pInvul > 10) {
      if (amount <= this.pLast) return false;
      const extra = amount - this.pLast;
      this.pLast = amount;
      amount = extra;
    } else {
      this.pLast = amount; this.pInvul = 20;
      if (!src.noKnock && src.x !== undefined) {
        this.knockPlayer(0.4, src.x - this.P.pos.x, src.z - this.P.pos.z);
        // a mob with knockback of its own (iron golems, ravagers) adds to it
        if (src.knock) this.knockPlayer(src.knock * 0.5, Math.sin(src.yaw), Math.cos(src.yaw));
      }
    }
    if (this.effects.resistance) amount *= 0.8;
    const before = this.survival.health;
    this.survival.hurt(amount, src);
    this.lastPlayerHurt = { amount, before, after: this.survival.health, src: src.type };
    if (this.riding && this.survival.dead) this.dismount();
    return true;
  }
  knockPlayer(strength, dx, dz) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    const v = this.P.vel;
    v.x = v.x / 2 - dx / l * strength;
    v.z = v.z / 2 - dz / l * strength;
    if (this.P.onGround) v.y = Math.min(0.4, v.y / 2 + strength);
    this.P.onGround = false;
  }
  // a few effects mobs put on you (poison, hunger from husks, slowness from strays)
  effectPlayer(name, ticks) { this.effects[name] = Math.max(this.effects[name] || 0, ticks); if (this.hooks.effect) this.hooks.effect(name, ticks); }
  effectsTick() {
    for (const k in this.effects) {
      const t = --this.effects[k];
      if (k === 'poison' && t % 25 === 0 && this.survival && this.survival.health > 1 && this.mode !== 'creative') this.survival.hurt(1, { type: 'magic' });
      if (k === 'slowness' && this.P) { this.P.vel.x *= 0.85; this.P.vel.z *= 0.85; }
      if (t <= 0) delete this.effects[k];
    }
  }

  /* ---- death, drops, experience ---- */
  onDeath(e, src) {
    const byPlayer = !!(src && src.player) || (e.lastHurtByPlayer !== undefined && this.age - e.lastHurtByPlayer < 100);
    e.byPlayer = byPlayer;
    if (e.loot && !e.isBaby && !(e.baby && e.type === 'zombie' && false)) e.loot((name, n) => { if (n > 0) this.dropAt(e, name, n, byPlayer); }, byPlayer);
    if (this.riding === e) this.dismount();
  }
  dropAt(e, name, n, byPlayer) { this.dropItemAt(e.pos.x, e.pos.y + Math.min(e.h, 1) * 0.5, e.pos.z, name, n, false, byPlayer !== false); }
  dropItemAt(x, y, z, name, n, fromBlock, toPlayer) {
    if (n <= 0 || !name) return;
    if (this.hooks.dropItem) { this.hooks.dropItem(this.world, x, y, z, name, n); return; }
    // no items module: what is a block goes into the inventory
    if (this.inv && B[name] !== undefined && toPlayer !== false && this.mode !== 'creative') this.inv.add(B[name], n);
    this.dropped = this.dropped || [];
    this.dropped.push([name, n]);
  }
  dropXp(e) {
    if (!e.byPlayer) return;
    const n = e.xp !== undefined ? e.xp : e.constructor.XP || 0;
    if (!n) return;
    this.xpEarned += n;
    if (this.hooks.giveXp) this.hooks.giveXp(n, e.pos.x, e.pos.y, e.pos.z);
  }
  pickupArrow() {
    if (this.mode === 'creative') return true;
    if (this.hooks.dropItem) { this.hooks.dropItem(this.world, this.P.pos.x, this.P.pos.y + 0.5, this.P.pos.z, 'arrow', 1); return true; }
    if (this.inv && B.arrow !== undefined) return this.inv.add(B.arrow, 1) === 0;
    return true;
  }
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
    this.xpEarned += 1 + Math.floor(R() * 7);
    if (this.hooks.giveXp) this.hooks.giveXp(1 + Math.floor(R() * 7), baby.pos.x, baby.pos.y, baby.pos.z);
  }
  explode(x, y, z, power, src, o) { return explode(this, x, y, z, power, src, o); }
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
    const reach = this.mode === 'creative' ? 5 : 3;
    const h = this.raycast(eye, dir, Math.min(reach, blockT === undefined ? reach : blockT));
    return h ? h.entity : null;
  }
  /* Right click with something that makes an entity: a boat (on water, or on
     the block looked at), a spawn egg, an egg or snowball to throw. True if
     it was used. */
  useHeld(target) {
    const name = this.heldName();
    if (!name || !this.lookEye) return false;
    const P = this.P, eye = this.lookEye, dir = this.lookDir;
    const take = () => { if (this.mode !== 'creative' && this.inv) this.inv.takeSelected(1); };
    if (/_boat$|_raft$/.test(name)) {
      // the boat goes on the first water or block the look meets (within 5)
      const t = this.t.ray(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 5, true);
      if (t >= 5) return false;
      const x = eye.x + dir.x * t, z = eye.z + dir.z * t;
      const bx = this.t.rayX, by = this.t.rayY, bz = this.t.rayZ;
      const top = FLUID[this.t.get(bx, by, bz)] ? by + this.t.fluidHeight(bx, by, bz) - 0.4 : by + 1;
      if (this.t.boxHits(x - 0.68, top + 0.01, z - 0.68, x + 0.68, top + 0.55, z + 0.68)) return false;
      placeBoat(this, name, x, top, z, P.yaw);
      take();
      return true;
    }
    if (/_spawn_egg$/.test(name)) {
      const type = name.slice(0, -10);
      if (!TYPES[type] || !target) return false;
      const f = target.face || [0, 1, 0];
      const e = this.spawn(type, target.x + 0.5 + f[0] * 0.5, target.y + (f[1] > 0 ? 1 : f[1] < 0 ? -TYPES[type].H || -1 : 0), target.z + 0.5 + f[2] * 0.5, { natural: true });
      if (e) e.persistent = true;
      take();
      return true;
    }
    if (name === 'egg' || name === 'snowball' || name === 'splash_potion') {
      const e = this.spawn(name === 'splash_potion' ? 'potion' : name, eye.x, eye.y - 0.1, eye.z, { natural: false });
      if (!e) return false;
      e.owner = this.player;
      e.shoot(dir.x, dir.y, dir.z, name === 'splash_potion' ? 0.5 : 1.5, 1);
      e.vel.x += P.vel.x; e.vel.z += P.vel.z; if (!P.onGround) e.vel.y += P.vel.y;
      take();
      return true;
    }
    return false;
  }
  // creative, before there are boat items: B puts an oak boat where you look
  placeBoatAtCrosshair() {
    const P = this.P;
    const eye = this.lookEye || P.pos, dir = this.lookDir;
    if (!dir) return null;
    const t = this.t.ray(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 8, true);
    if (t >= 8) return null;
    const bx = this.t.rayX, by = this.t.rayY, bz = this.t.rayZ;
    const top = FLUID[this.t.get(bx, by, bz)] ? by + this.t.fluidHeight(bx, by, bz) - 0.4 : by + 1;
    return placeBoat(this, 'oak_boat', eye.x + dir.x * t, top, eye.z + dir.z * t, P.yaw);
  }

  /* ---- drawing, once a frame ---- */
  render(alpha) {
    const M = this.meshes;
    M.begin();
    const cam = this.R.camera;
    this.pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const P = this.P, far = (this.world.renderDist || 8) * 16 + 16, far2 = far * far;
    const k = 0.15;
    for (const e of this.list) {
      if (e.removed) continue;
      const c = e.constructor;
      if (!c.MODEL) continue;
      const x = e.prev.x + (e.pos.x - e.prev.x) * alpha, y = e.prev.y + (e.pos.y - e.prev.y) * alpha, z = e.prev.z + (e.pos.z - e.prev.z) * alpha;
      const dx = x - P.pos.x, dz = z - P.pos.z;
      if (dx * dx + dz * dz > far2) continue;
      // the light, eased so it never pops
      e.lS += (e.lightS / 15 - e.lS) * k; e.lB += (e.lightB / 15 - e.lB) * k;
      this.sphere.center.set(x, y + e.h / 2, z); this.sphere.radius = Math.max(e.w, e.h) + 1.5;
      const seen = this.frustum.intersectsSphere(this.sphere);
      if (seen) this.drawOne(e, alpha, x, y, z);
      // its round shadow on the ground
      if (seen && c.SHADOW && !e.vehicle) this.shadowOf(e, x, y, z, c.SHADOW * (e.baby || e.ageT < 0 ? 0.5 : 1) * (c.SCALE || 1));
    }
    this.particlesP.draw(M, alpha);
    M.end();
  }
  shadowOf(e, x, y, z, r) {
    const T = this.t;
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let yy = Math.floor(y + 0.01); yy > y - 3; yy--) {
      const b = T.get(bx, yy - 1, bz);
      if (b && BLOCKS[b].solid) {
        const top = yy;
        const dy = y - top;
        if (dy < -0.05) break;
        const a = 0.55 * Math.max(0, 1 - dy / 3) * Math.min(1, (e.lS * e.lS + e.lB) * 1.2 + 0.3);
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
      const head = e.prevHeadYaw + wrap(e.headYaw - e.prevHeadYaw) * a;
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
    let s = (c.SCALE || 1) / 16;
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
    const slot = SLOTS[e.texName ? e.texName() : c.TEX] || [0, 0];
    const white = A.swell > 0 ? (Math.floor(A.swell * 10) % 2 ? Math.max(0.5, Math.min(1, A.swell)) * 0.7 : 0) : 0;
    const hurt = e.hurtTime > 0 || (living && e.dead) ? 1 : 0;
    const tint = e.tint ? e.tint() : 0xffffff;
    M.add(M.model(name, mdl), bone, slot[0], slot[1], e.lS, e.lB, hurt, white, ((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255);
    // layers on the same bones: wool, saddles, armour
    const L = this.layerList; L.length = 0;
    if (e.layers) e.layers(L);
    for (const [ln, lt, col] of L) {
      const lm = MODELS[ln];
      if (!lm) continue;
      const ls = SLOTS[lt] || slot;
      const cc = col === null || col === undefined ? 0xffffff : col;
      M.add(M.model(ln, lm), bone, ls[0], ls[1], e.lS, e.lB, hurt, white, ((cc >> 16) & 255) / 255, ((cc >> 8) & 255) / 255, (cc & 255) / 255);
    }
  }
  v3(s) { return (this._v3 || (this._v3 = new THREE.Vector3())).set(s, s, s); }

  /* ---- keeping them ---- */
  toJSON() {
    const list = [];
    for (const e of this.list) if (!e.removed && !e.dead && e.toJSON && !(e.constructor.HOSTILE && !e.persistent && e.constructor.NO_SAVE)) list.push(e.toJSON());
    const stored = {};
    for (const [k, a] of this.stored) stored[k] = a;
    return { v: 1, list, stored, pop: [...this.populated] };
  }
  fromJSON(o) {
    if (!o) return;
    for (const e of o.list || []) if (TYPES[e.t]) this.spawn(e.t, e.p[0], e.p[1], e.p[2], { json: e, natural: false });
    for (const k in o.stored || {}) this.stored.set(k, o.stored[k]);
    for (const k of o.pop || []) this.populated.add(k);
  }
  // leaving the world: drop everything
  dispose() {
    this.gone = true;
    this.list.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
import { rayBox } from './terrain.js?v=8';
