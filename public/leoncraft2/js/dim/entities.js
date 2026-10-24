/* ---------------------------------------------------------------------------
   Leoncraft 2 - the End's (and the eye of ender's) entities.

   Self-contained until the mob work's entity system lands; each keeps the
   small interface that system can fold in:
     pos, prev, vel (THREE.Vector3, engine coordinates: y is the index, world y + 64)
     group          a THREE.Group, added to the scene by js/dim/realms.js
     box()          [x0, y0, z0, x1, y1, z1]
     tick()         20 times a second
     render(alpha)  between ticks
     hurt(amount, source) -> true if it counted
     dead           remove me

     EndCrystal     sits on a pillar burning a fire under itself, beams the
                    dragon back to health, explodes (power 6) when hit
     DragonFireball flies at you, bursts into a cloud of dragon's breath
     BreathCloud    a purple cloud that hurts what stands in it
     EyeOfEnder     thrown: floats towards the nearest stronghold, then breaks
                    (1 in 5) or drops to be picked up
     XpOrb          drifts to the player and gives its experience
     Burst          a puff of explosion smoke
   Models are boxes with flat colours, our own design.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';
const THREE = window.THREE;
const V = (x, y, z) => new THREE.Vector3(x || 0, y || 0, z || 0);

/* Colours: Fast graphics shows them as given, Detailed takes them as
   surface colours in linear light (lit by its exposure). */
export function colour(hex, linearScene) {
  const c = new THREE.Color();
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  if (linearScene) c.setRGB(Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2), THREE.LinearSRGBColorSpace);
  else c.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  return c;
}
export function mat(R, hex, o) {
  return new THREE.MeshBasicMaterial(Object.assign({ color: colour(hex, R.linear) }, o || {}));
}
export function cube(w, h, d, material) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); }
export const boxesTouch = (a, b) => a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];

export class Entity {
  constructor(R) {
    this.R = R;
    this.pos = V(); this.prev = V(); this.vel = V();
    this.group = new THREE.Group();
    this.dead = false; this.age = 0;
    this.w = 1; this.h = 1;
  }
  at(x, y, z) { this.pos.set(x, y, z); this.prev.copy(this.pos); return this; }
  box() { const p = this.pos, w = this.w / 2; return [p.x - w, p.y, p.z - w, p.x + w, p.y + this.h, p.z + w]; }
  tick() { this.prev.copy(this.pos); this.age++; }
  render(alpha) { this.group.position.lerpVectors(this.prev, this.pos, alpha); }
  hurt() { return false; }
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && !o.material.shared) o.material.dispose(); });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

/* ---- the end crystal ---- */
export class EndCrystal extends Entity {
  constructor(R, opts) {
    super(R);
    this.w = 2; this.h = 2;
    this.showBase = !opts || opts.base !== false;
    this.pillar = opts && opts.pillar !== undefined ? opts.pillar : -1;
    this.respawner = !!(opts && opts.respawner);
    this.beamTo = null;              // a point the beam goes to (the dragon, or the sky while respawning)
    this.spin = Math.random() * 100;
    const g = this.group;
    const glass = mat(R, 0xd8b8e8, { transparent: true, opacity: 0.45, depthWrite: false });
    const core = mat(R, 0xff6fd2);
    this.outer = cube(1.2, 1.2, 1.2, new THREE.MeshBasicMaterial({ color: colour(0xe8d0ff, R.linear), wireframe: true }));
    this.inner = cube(0.85, 0.85, 0.85, glass);
    this.core = cube(0.5, 0.5, 0.5, core);
    this.spinner = new THREE.Group();
    this.spinner.add(this.outer, this.inner, this.core);
    g.add(this.spinner);
    if (this.showBase) { const base = cube(2, 0.5, 2, mat(R, 0x3a3a3a)); base.position.y = 0.25; g.add(base); }
    // the beam: a thin box stretched between the crystal and its target
    this.beam = cube(0.25, 0.25, 1, new THREE.MeshBasicMaterial({ color: colour(0xffc8ff, R.linear), transparent: true, opacity: 0.8, depthWrite: false }));
    this.beam.visible = false;
    this.beamHolder = new THREE.Group();
    this.beamHolder.add(this.beam);
  }
  tick() {
    super.tick();
    // in the End it keeps a fire burning in its own block
    const w = this.R.world;
    if (this.R.dim === 'the_end' && w) {
      const bx = Math.floor(this.pos.x), by = Math.floor(this.pos.y), bz = Math.floor(this.pos.z);
      const b = w.get(bx, by, bz);
      if (b !== B.fire && w.loaded(bx, bz) && (b === 0 || BLOCKS[b].replaceable)) w.set(bx, by, bz, B.fire, 0);
    }
  }
  render(alpha) {
    super.render(alpha);
    const t = (this.age + alpha + this.spin) / 20;
    this.spinner.position.y = 1.3 + Math.sin(t * 2.5) * 0.25;
    this.outer.rotation.set(t * 1.2, t * 2.0, t * 0.7);
    this.inner.rotation.set(-t * 1.6, t * 1.1, -t * 0.9);
    this.core.rotation.set(t * 2.4, -t * 1.7, t * 1.3);
    if (this.beamTo) {
      const from = this.group.position.clone(); from.y += this.spinner.position.y;
      const d = this.beamTo.clone().sub(from), len = d.length();
      this.beam.visible = true;
      this.beam.scale.set(1, 1, len);
      this.beamHolder.position.copy(from).addScaledVector(d, 0.5);
      this.beamHolder.lookAt(this.beamTo);
      if (!this.beamHolder.parent && this.group.parent) this.group.parent.add(this.beamHolder);
    } else this.beam.visible = false;
  }
  hurt(amount, source) {
    if (this.dead) return false;
    this.dead = true;
    this.R.crystalDestroyed(this, source);
    return true;
  }
  dispose() { super.dispose(); if (this.beamHolder.parent) this.beamHolder.parent.remove(this.beamHolder); this.beam.geometry.dispose(); }
}

/* ---- the dragon's fireball ---- */
export class DragonFireball extends Entity {
  constructor(R, dir) {
    super(R);
    this.w = 1; this.h = 1;
    this.dir = dir.clone().normalize();
    const ball = cube(0.9, 0.9, 0.9, mat(R, 0x7a2fb8));
    const glow = cube(1.3, 1.3, 1.3, new THREE.MeshBasicMaterial({ color: colour(0xd99cff, R.linear), transparent: true, opacity: 0.35, depthWrite: false }));
    ball.position.y = glow.position.y = 0.5;
    this.ball = ball; this.group.add(ball, glow);
  }
  tick() {
    super.tick();
    // pushed along by its own power, slowed by the air (terminal speed about 2 blocks a tick)
    this.vel.addScaledVector(this.dir, 0.1).multiplyScalar(0.95);
    const steps = Math.ceil(this.vel.length() / 0.4);
    for (let s = 0; s < steps; s++) {
      this.pos.addScaledVector(this.vel, 1 / steps);
      const w = this.R.world, p = this.pos;
      const b = w.get(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z));
      const pl = this.R.playerBox();
      if ((b && BLOCKS[b].solid) || boxesTouch(this.box(), pl) || this.age > 400) { this.burst(); return; }
    }
    if (Math.random() < 0.5) this.R.particles(this.pos.x, this.pos.y + 0.5, this.pos.z, 0xb070ff, 1);
  }
  burst() {
    this.dead = true;
    const c = new BreathCloud(this.R, { radius: 3, grow: 4 / 600, life: 600, damage: 6 });
    this.R.add(c.at(this.pos.x, Math.floor(this.pos.y) + 0.05, this.pos.z));
    // it settles on the ground below where it burst
    const w = this.R.world;
    for (let y = Math.floor(this.pos.y); y > Math.floor(this.pos.y) - 8; y--) { const b = w.get(Math.floor(this.pos.x), y - 1, Math.floor(this.pos.z)); if (b && BLOCKS[b].solid) { c.pos.y = c.prev.y = y + 0.05; break; } }
  }
  render(alpha) { super.render(alpha); this.ball.rotation.set(this.age * 0.3, this.age * 0.2, 0); }
}

/* ---- dragon's breath: a cloud on the ground ---- */
export class BreathCloud extends Entity {
  constructor(R, o) {
    super(R);
    this.radius = o.radius; this.grow = o.grow || 0; this.life = o.life; this.damage = o.damage; this.every = 20;
    this.cool = 0;
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()); pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 0.6; pos[i * 3 + 2] = Math.sin(a) * r; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: colour(0xc070ff, R.linear), size: 0.35, transparent: true, opacity: 0.8, depthWrite: false }));
    this.group.add(this.points);
  }
  tick() {
    super.tick();
    this.radius += this.grow;
    if (this.age >= this.life) { this.dead = true; return; }
    // what stands inside it is hurt, once a second
    if (this.cool > 0) this.cool--;
    const P = this.R.playerFeet();
    if (P && this.cool === 0) {
      const dx = P.x - this.pos.x, dz = P.z - this.pos.z;
      if (dx * dx + dz * dz < this.radius * this.radius && P.y > this.pos.y - 0.5 && P.y < this.pos.y + 2.5) { this.R.hurtPlayer(this.damage, 'dragon_breath'); this.cool = this.every; }
    }
  }
  render(alpha) {
    super.render(alpha);
    const s = this.radius;
    this.points.scale.set(s, 1 + Math.sin(this.age * 0.2) * 0.1, s);
    this.points.rotation.y = this.age * 0.01;
    this.points.material.opacity = 0.8 * Math.min(1, (this.life - this.age) / 40);
  }
}

/* ---- the eye of ender, thrown ---- */
export class EyeOfEnder extends Entity {
  constructor(R, target, survives) {
    super(R);
    this.w = 0.25; this.h = 0.25;
    this.target = target;            // { x, z } it heads for (in the engine's coordinates)
    this.survives = survives;
    const e = cube(0.35, 0.35, 0.35, mat(R, 0x2f8a63));
    const p = cube(0.12, 0.25, 0.37, mat(R, 0x0b1a13));
    this.eye = new THREE.Group(); this.eye.add(e, p);
    this.group.add(this.eye);
    this.life = 80;
  }
  tick() {
    super.tick();
    // the game's flight: towards the target, rising while far, sinking when near, gone after 80 ticks
    // up to 12 blocks towards the target, rising 8 if it is further than that, sinking a little if not
    const p = this.pos, t = this.target;
    if (!this.goal) {
      const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz) || 1, k = Math.min(d, 12) / d;
      this.goal = V(p.x + dx * k, p.y + (d > 12 ? 8 : -0.5), p.z + dz * k);
    }
    this.vel.copy(this.goal).sub(p).multiplyScalar(0.06);
    if (this.vel.length() > 0.5) this.vel.setLength(0.5);
    p.add(this.vel);
    this.R.particles(p.x, p.y, p.z, 0xb05cff, 1);
    if (this.age >= this.life) {
      this.dead = true;
      if (this.survives) this.R.add(new Pickup(this.R, B.ender_eye).at(p.x, p.y, p.z));
      else this.R.particles(p.x, p.y, p.z, 0x2f8a63, 12);
    }
  }
  render(alpha) { super.render(alpha); this.eye.rotation.y = this.age * 0.2; }
}

/* ---- an item on the ground waiting to be picked up (for the eye) ---- */
export class Pickup extends Entity {
  constructor(R, id) {
    super(R);
    this.id = id; this.w = 0.25; this.h = 0.25;
    const e = cube(0.3, 0.3, 0.3, mat(R, 0x2f8a63));
    this.m = e; this.group.add(e);
  }
  tick() {
    super.tick();
    const w = this.R.world, p = this.pos;
    this.vel.y -= 0.04; this.vel.multiplyScalar(0.98);
    const below = w.get(Math.floor(p.x), Math.floor(p.y + this.vel.y), Math.floor(p.z));
    if (below && BLOCKS[below].solid) { this.vel.set(0, 0, 0); p.y = Math.floor(p.y + this.vel.y) + 1; } else p.add(this.vel);
    const f = this.R.playerFeet();
    if (f && this.age > 10 && f.distanceTo(p) < 1.5) { this.dead = true; this.R.give(this.id, 1); }
    if (this.age > 6000) this.dead = true;
  }
  render(alpha) { super.render(alpha); this.m.rotation.y = this.age * 0.08; this.m.position.y = 0.25 + Math.sin(this.age * 0.1) * 0.08; }
}

/* ---- experience ---- */
// the game's orb sizes: big amounts split into a few big orbs
const ORB_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
export function splitXp(n) {
  const out = [];
  while (n > 0) { const s = ORB_SIZES.find(v => v <= n) || 1; out.push(s); n -= s; }
  return out;
}
export class XpOrb extends Entity {
  constructor(R, value) {
    super(R);
    this.value = value; this.w = 0.5; this.h = 0.5;
    const s = 0.12 + Math.min(0.3, Math.log10(value + 1) * 0.08);
    this.m = cube(s, s, s, mat(R, 0xb8f040));
    this.group.add(this.m);
    this.vel.set((Math.random() - 0.5) * 0.4, Math.random() * 0.4, (Math.random() - 0.5) * 0.4);
  }
  tick() {
    super.tick();
    const f = this.R.playerFeet(), p = this.pos;
    if (f) {
      const t = f.clone(); t.y += 0.8;
      const d = t.sub(p), l = d.length();
      if (l < 8) {
        const k = 1 - l / 8;
        this.vel.addScaledVector(d.normalize(), k * k * 0.1);
      }
      if (l < 1.2 && this.age > 10) { this.dead = true; this.R.addXp(this.value); return; }
    }
    this.vel.y -= 0.03; this.vel.multiplyScalar(0.98);
    const nb = this.R.world.get(Math.floor(p.x), Math.floor(p.y + this.vel.y), Math.floor(p.z));
    if (nb && BLOCKS[nb].solid && this.vel.y < 0) this.vel.y = 0;
    p.add(this.vel);
    if (this.age > 6000) this.dead = true;
  }
  render(alpha) { super.render(alpha); const t = this.age + alpha; this.m.material.color.copy(colour(Math.sin(t * 0.25) > 0 ? 0xc8ff50 : 0x80e030, this.R.linear)); }
}

/* ---- a puff of smoke ---- */
export class Burst extends Entity {
  constructor(R, size) {
    super(R);
    this.size = size; this.life = 14;
    this.m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: colour(0xf0f0f0, R.linear), transparent: true, opacity: 0.8, depthWrite: false }));
    this.group.add(this.m);
  }
  tick() { super.tick(); if (this.age >= this.life) this.dead = true; }
  render(alpha) {
    super.render(alpha);
    const t = (this.age + alpha) / this.life;
    this.m.scale.setScalar(this.size * (0.3 + t));
    this.m.material.opacity = 0.8 * (1 - t);
  }
}
