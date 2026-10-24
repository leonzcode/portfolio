/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Ender Dragon.

   Our own model (boxes) and our own flight code, built to the behaviour the
   Minecraft Wiki describes:

     health      200; the head takes full damage, every other part a quarter
                 of it plus up to 1; hits within half a second of the last
                 count only by how much harder they are (the game's rule for
                 every mob)
     parts       head 1 x 1, neck 3 x 3, body 5 x 3, three tail parts 2 x 2,
                 two wings 4 x 2 (width x height, in blocks)
     healing     from the nearest end crystal within 32 blocks (a cube round
                 it), 1 health every half second, a beam drawn between them;
                 losing that crystal costs it 10 health
     phases      circling the pillars on a ring of waypoints; strafing (flies
                 at you and spits a fireball); flying to the portal and
                 landing (a 1 in 3 + crystals left chance at each waypoint);
                 perched: scanning, a roar, 3 seconds of breath (3 health a
                 second to what stands in it), up to four times, or until it
                 has taken 50 damage, then taking off; charging you; dying
     contact     the head and neck hurt 10 (Normal); the wings throw you
                 back and hurt 5 unless it is perched
     griefing    breaks what its head, neck and body fly through, except the
                 blocks the game keeps from it (obsidian, end stone, bedrock,
                 iron bars, the portal blocks...)
     death       10 seconds rising slowly, beams of light growing out of it;
                 experience from 7.7 seconds on, 8% every quarter second and
                 the last 20% at the end (12000 the first time, 500 after)
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';
import { Entity, mat, cube, colour, boxesTouch, DragonFireball, BreathCloud } from './entities.js?v=107';
const THREE = window.THREE;

const IMMUNE = new Set(['bedrock', 'obsidian', 'crying_obsidian', 'end_stone', 'iron_bars', 'end_portal_frame', 'end_portal', 'end_gateway',
  'respawn_anchor', 'reinforced_deepslate', 'barrier', 'light', 'command_block', 'structure_block', 'jigsaw']);
// the parts: centre (right, up, back) from the dragon's position, width and height
const PARTS = [
  { name: 'head', c: [0, 2.6, -8.6], w: 1, h: 1 },
  { name: 'neck', c: [0, 2.2, -4.8], w: 3, h: 3 },
  { name: 'body', c: [0, 1.5, 0], w: 5, h: 3 },
  { name: 'tail1', c: [0, 1.5, 4.0], w: 2, h: 2 },
  { name: 'tail2', c: [0, 1.6, 6.0], w: 2, h: 2 },
  { name: 'tail3', c: [0, 1.7, 8.0], w: 2, h: 2 },
  { name: 'wing1', c: [4.5, 2.2, 0], w: 4, h: 2 },
  { name: 'wing2', c: [-4.5, 2.2, 0], w: 4, h: 2 },
];
const SITTING = new Set(['scanning', 'roar', 'flame']);
const wrapA = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export class EnderDragon extends Entity {
  constructor(R, fight) {
    super(R);
    this.fight = fight;
    this.maxHealth = 200; this.health = 200;
    this.yaw = 0; this.prevYaw = 0;
    this.phase = 'holding'; this.phaseT = 0;
    this.target = new THREE.Vector3();
    this.node = 0; this.dir = 1;
    this.hurtTime = 0; this.invul = 0; this.lastHurt = 0;
    this.sitDamage = 0; this.flames = 0;
    this.crystal = null;
    this.deathTime = 0;
    this.speed = 0.6;
    this.w = 16; this.h = 8;
    this.buildNodes();
    this.buildModel();
    this.setPhase('holding');
  }

  /* ---- the waypoints: 12 on a ring 60 out, 8 at 40, 4 at 20, above the ground ---- */
  buildNodes() {
    this.nodes = [];
    const f = this.fight;
    const ring = (n, r, lift) => {
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        const x = Math.floor(r * Math.cos(a)), z = Math.floor(r * Math.sin(a));
        const top = f.topAt(x, z);
        this.nodes.push(new THREE.Vector3(x + 0.5, Math.max(73 + 64, top + lift + Math.random() * 12), z + 0.5));
      }
    };
    ring(12, 60, 22); ring(8, 40, 26); ring(4, 20, 30);
  }

  /* ---- the model: boxes in our own design ---- */
  buildModel() {
    const R = this.R, g = this.group;
    this.mats = { body: mat(R, 0x171717), plate: mat(R, 0x252525), skin: mat(R, 0x2c2c30, { side: THREE.DoubleSide }), eye: mat(R, 0xd060ff), bone: mat(R, 0x101010) };
    const M = this.mats;
    this.model = new THREE.Group();
    g.add(this.model);
    const add = (parent, w, h, d, m, x, y, z) => { const c = cube(w, h, d, m); c.position.set(x, y, z); parent.add(c); return c; };
    // body with a ridge of plates
    add(this.model, 3.2, 2.6, 7, M.body, 0, 1.6, 0);
    for (let i = 0; i < 4; i++) add(this.model, 0.4, 0.7, 0.9, M.plate, 0, 3.1, -2.5 + i * 1.7);
    // legs
    for (const [x, z] of [[1.4, -2.2], [-1.4, -2.2], [1.4, 2.4], [-1.4, 2.4]]) add(this.model, 0.8, 1.6, 0.8, M.body, x, 0.2, z);
    // neck: five segments rising to the head
    this.neck = [];
    for (let i = 0; i < 5; i++) this.neck.push(add(this.model, 1.1, 1.1, 1.1, M.body, 0, 2.0 + i * 0.12, -4.0 - i * 1.0));
    this.head = new THREE.Group();
    this.head.position.set(0, 2.6, -8.6);
    this.model.add(this.head);
    add(this.head, 1.8, 1.4, 1.8, M.body, 0, 0, 0.4);
    add(this.head, 1.2, 0.7, 1.6, M.body, 0, -0.2, -1.1);            // snout
    this.jaw = add(this.head, 1.1, 0.35, 1.5, M.plate, 0, -0.65, -1.0);
    add(this.head, 0.25, 0.6, 0.25, M.plate, 0.5, 0.95, 0.9); add(this.head, 0.25, 0.6, 0.25, M.plate, -0.5, 0.95, 0.9);   // horns
    add(this.head, 0.3, 0.18, 0.1, M.eye, 0.55, 0.25, -0.5); add(this.head, 0.3, 0.18, 0.1, M.eye, -0.55, 0.25, -0.5);  // eyes
    add(this.head, 0.2, 0.2, 0.3, M.plate, 0.35, 0.2, -1.95); add(this.head, 0.2, 0.2, 0.3, M.plate, -0.35, 0.2, -1.95);
    // tail: twelve segments
    this.tail = [];
    for (let i = 0; i < 12; i++) { const s = 1.0 - i * 0.05; this.tail.push(add(this.model, s, s, 1.0, M.body, 0, 1.6, 4.0 + i * 0.95)); }
    // wings: an arm and a skin, each in two halves that fold
    this.wings = [];
    for (const side of [1, -1]) {
      const root = new THREE.Group(); root.position.set(side * 1.5, 2.6, -0.8); this.model.add(root);
      add(root, 4, 0.35, 0.35, M.bone, side * 2, 0, 0);
      const skin = add(root, 4, 0.05, 4.2, M.skin, side * 2, -0.05, 2.0);
      const tip = new THREE.Group(); tip.position.set(side * 4, 0, 0); root.add(tip);
      add(tip, 4, 0.25, 0.25, M.bone, side * 2, 0, 0);
      add(tip, 4, 0.05, 3.4, M.skin, side * 2, -0.05, 1.6);
      this.wings.push({ root, tip, side, skin });
    }
    // the death beams
    this.beams = new THREE.Group();
    g.add(this.beams);
    const n = 40, pos = new Float32Array(n * 9);
    this.beamDirs = [];
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0.3).normalize()).normalize();
      const len = 20 + Math.random() * 40, w = 1 + Math.random() * 2;
      const tip = d.clone().multiplyScalar(len);
      const a = tip.clone().addScaledVector(side, w), b = tip.clone().addScaledVector(side, -w);
      pos.set([0, 0, 0, a.x, a.y, a.z, b.x, b.y, b.z], i * 9);
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.beamMesh = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: colour(0xffd8ff, R.linear), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beamMesh.frustumCulled = false;
    this.beams.add(this.beamMesh);
    this.beams.visible = false;
    this.bodyMats = [M.body, M.plate, M.skin, M.bone];
    this.bodyCols = this.bodyMats.map(m => m.color.clone());
  }

  /* ---- where each part is (boxes, in the engine's coordinates) ---- */
  partBoxes() {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw), p = this.pos, sit = this.sitting();
    return PARTS.map(P => {
      // (right, up, back) to world: right = (cos, 0, -sin), back = (sin, 0, cos); perched, the head hangs low
      const [r, u, bk] = P.c;
      const dip = sit ? (P.name === 'head' ? 1.3 : P.name === 'neck' ? 0.6 : 0) : 0;
      const x = p.x + r * c + bk * s, z = p.z - r * s + bk * c, y = p.y + u - P.h / 2 - dip;
      const hw = P.w / 2;
      return { name: P.name, box: [x - hw, y, z - hw, x + hw, y + P.h, z + hw] };
    });
  }
  headPos() { const hb = this.partBoxes()[0].box; return new THREE.Vector3((hb[0] + hb[3]) / 2, (hb[1] + hb[4]) / 2, (hb[2] + hb[5]) / 2); }
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  sitting() { return SITTING.has(this.phase); }

  setPhase(p) {
    this.phase = p; this.phaseT = 0;
    const f = this.fight;
    if (p === 'holding') { this.speed = 0.6; this.pickNode(true); }
    if (p === 'strafe') this.speed = 0.7;
    if (p === 'approach') { this.speed = 0.6; this.target.set(0.5, f.podiumY + 20, 0.5); }
    if (p === 'landing') this.speed = 0.4;
    if (p === 'scanning') { this.sitDamage = this.sitDamage || 0; }
    if (p === 'takeoff') { this.speed = 0.5; const fw = this.forward(); this.target.set(fw.x * 40, f.podiumY + 30, fw.z * 40); this.flames = 0; this.sitDamage = 0; }
    if (p === 'charge') { this.speed = 1.0; }
    if (p === 'dying') { this.vel.set(0, 0, 0); this.beams.visible = true; }
  }
  pickNode(nearest) {
    if (nearest) {
      let best = 0, bd = 1e9;
      for (let i = 0; i < 12; i++) { const d = this.nodes[i].distanceToSquared(this.pos); if (d < bd) { bd = d; best = i; } }
      this.node = best;
      if (Math.random() < 0.5) this.dir = -this.dir;
    }
    this.node = ((this.node + this.dir) % 12 + 12) % 12;
    if (Math.random() < 0.08) this.dir = -this.dir;
    this.target.copy(this.nodes[this.node]);
  }

  /* ---- a tick ---- */
  tick() {
    super.tick();
    this.prevYaw = this.yaw;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invul > 0) this.invul--;
    this.phaseT++;
    if (this.phase === 'dying') { this.dyingTick(); return; }
    this.heal();
    const P = this.R.playerFeet();
    const f = this.fight;
    switch (this.phase) {
      case 'holding':
        if (this.horizDist(this.target) < 10) {
          const left = f.crystalsAlive();
          if (f.podiumY && Math.floor(Math.random() * (3 + left)) === 0) { this.setPhase('approach'); break; }
          if (P && this.pos.distanceTo(P) < 150 && Math.random() < 0.3) { this.setPhase('strafe'); break; }
          this.pickNode(false);
        }
        this.fly(0.06);
        break;
      case 'strafe': {
        if (!P || this.phaseT > 300) { this.setPhase('holding'); break; }
        this.target.set(P.x, P.y + 6, P.z);
        this.fly(0.08);
        const head = this.headPos(), eye = P.clone(); eye.y += 1.6;
        const to = eye.clone().sub(head), d = to.length();
        const ang = Math.abs(wrapA(Math.atan2(-to.x, -to.z) - this.yaw));
        if (d < 64 && ang < 0.18 && this.phaseT > 10 && this.R.canSee(head, eye)) {
          this.R.add(new DragonFireball(this.R, to).at(head.x + to.x / d, head.y + to.y / d - 0.5, head.z + to.z / d));
          this.setPhase('holding');
        }
        if (d < 12) this.setPhase('holding');
        break;
      }
      case 'approach':
        this.fly(0.08);
        if (this.horizDist(this.target) < 12) { this.setPhase('landing'); this.target.set(0.5, f.podiumY + 4, 0.5); }
        if (this.phaseT > 600) this.setPhase('holding');
        break;
      case 'landing': {
        const d = this.pos.distanceTo(this.target);
        this.speed = Math.max(0.12, Math.min(0.45, d * 0.04));
        this.fly(0.1);
        if (d < 1.5) { this.pos.copy(this.target); this.vel.set(0, 0, 0); this.setPhase('scanning'); }
        if (this.phaseT > 400) { this.pos.copy(this.target); this.setPhase('scanning'); }
        break;
      }
      case 'scanning':
        this.face(P, 0.05);
        if (P && this.pos.distanceTo(P) < 20 && this.phaseT > 25) this.setPhase('roar');
        else if (this.phaseT > 100) { this.chargeNext = !!P && this.pos.distanceTo(P) > 20 && Math.random() < 0.5; this.setPhase('takeoff'); }
        break;
      case 'roar':
        this.face(P, 0.08);
        if (this.phaseT >= 40) this.setPhase('flame');
        break;
      case 'flame':
        if (this.phaseT === 1) {
          // breath on the ground in front of the head
          const h = this.headPos(), fw = this.forward();
          const c = new BreathCloud(this.R, { radius: 3, grow: 0, life: 60, damage: 3 });
          this.R.add(c.at(h.x + fw.x * 3, this.fight.groundBelow(h.x + fw.x * 3, h.y, h.z + fw.z * 3), h.z + fw.z * 3));
        }
        if (this.phaseT >= 60) { this.flames++; if (this.flames >= 4) this.setPhase('takeoff'); else this.setPhase('scanning'); }
        break;
      case 'takeoff':
        this.fly(0.06);
        if (this.pos.y > f.podiumY + 20 && this.horizDist(new THREE.Vector3(0, 0, 0)) > 22) {
          if (this.chargeNext && P) { this.chargeNext = false; this.setPhase('charge'); } else this.setPhase('holding');
        }
        break;
      case 'charge':
        if (!P || this.phaseT > 200) { this.setPhase('holding'); break; }
        this.target.set(P.x, P.y + 1, P.z);
        this.fly(0.15);
        if (this.pos.distanceTo(this.target) < 5) this.setPhase('holding');
        break;
    }
    if (this.sitting() && this.sitDamage > 50) this.setPhase('takeoff');
    this.contact();
    this.grief();
  }
  horizDist(t) { return Math.hypot(t.x - this.pos.x, t.z - this.pos.z); }
  face(P, rate) {
    if (!P) return;
    const want = Math.atan2(-(P.x - this.pos.x), -(P.z - this.pos.z));
    this.yaw += Math.max(-rate, Math.min(rate, wrapA(want - this.yaw)));
  }
  // steer towards the target: turn at most `turn` a tick, climb or dive at most 0.4
  fly(turn) {
    const t = this.target, p = this.pos;
    const want = Math.atan2(-(t.x - p.x), -(t.z - p.z));
    this.yaw = wrapA(this.yaw + Math.max(-turn, Math.min(turn, wrapA(want - this.yaw))));
    const fw = this.forward();
    const vy = Math.max(-0.4, Math.min(0.4, (t.y - p.y) * 0.08));
    this.vel.x += (fw.x * this.speed - this.vel.x) * 0.25;
    this.vel.z += (fw.z * this.speed - this.vel.z) * 0.25;
    this.vel.y += (vy - this.vel.y) * 0.25;
    p.add(this.vel);
  }
  // the nearest crystal within 32 blocks heals it 1 every half second
  heal() {
    if (this.crystal && this.crystal.dead) this.crystal = null;
    if (this.age % 10 === 0) {
      if (!this.crystal || Math.random() < 0.1) this.crystal = this.fight.nearestCrystal(this.pos, 32);
      if (this.crystal && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1);
    }
  }
  // what the head, neck and wings do to you
  contact() {
    const pb = this.R.playerBox();
    if (!pb || this.R.playerInvulnerable()) return;
    const parts = this.partBoxes();
    const grow = (b, x, y) => [b[0] - x, b[1] - y, b[2] - x, b[3] + x, b[4] + y, b[5] + x];
    if (this.hurtTime === 0) {
      for (const k of [6, 7]) {
        if (!boxesTouch(grow(parts[k].box, 4, 2), pb)) continue;
        const bc = parts[2].box, cx = (bc[0] + bc[3]) / 2, cz = (bc[2] + bc[5]) / 2;
        const dx = (pb[0] + pb[3]) / 2 - cx, dz = (pb[2] + pb[5]) / 2 - cz, l = Math.max(0.1, Math.hypot(dx, dz));
        this.R.pushPlayer(dx / l * 2, 0.2, dz / l * 2);
        if (!this.sitting()) this.R.hurtPlayer(5, 'dragon');
        break;
      }
    }
    for (const k of [0, 1]) if (boxesTouch(grow(parts[k].box, 1, 1), pb)) { this.R.hurtPlayer(10, 'dragon'); break; }
  }
  // break what it flies through
  grief() {
    const w = this.R.world;
    let n = 0;
    for (const P of this.partBoxes().slice(0, 3)) {
      const b = P.box;
      for (let y = Math.floor(b[1]); y <= Math.floor(b[4]); y++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5]); z++) for (let x = Math.floor(b[0]); x <= Math.floor(b[3]); x++) {
        const id = w.get(x, y, z);
        if (!id || IMMUNE.has(BLOCKS[id].name) || BLOCKS[id].fluid) continue;
        w.set(x, y, z, 0, 0);
        if (++n > 48) return;
      }
    }
  }

  /* ---- being hit ---- */
  hurt(amount, part, source) {
    if (this.phase === 'dying' || this.dead) return false;
    if (part && part !== 'head') amount = amount / 4 + Math.min(amount, 1);
    if (amount < 0.01) return false;
    // half a second after a hit, only a harder hit counts, and only by the difference
    if (this.invul > 10) { if (amount <= this.lastHurt) return false; const d = amount - this.lastHurt; this.lastHurt = amount; amount = d; }
    else { this.lastHurt = amount; this.invul = 20; this.hurtTime = 10; }
    if (this.sitting()) this.sitDamage += amount;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.setPhase('dying');
    return true;
  }

  dyingTick() {
    this.deathTime++;
    this.pos.y += 0.1;
    this.yaw += 0.02;
    const t = this.deathTime;
    if (t % 4 === 0) {
      const b = this.partBoxes()[2].box;
      this.R.burst((b[0] + b[3]) / 2 + (Math.random() - 0.5) * 8, b[1] + Math.random() * 4, (b[2] + b[5]) / 2 + (Math.random() - 0.5) * 8, 2);
    }
    const total = this.fight.xpForKill();
    if (t > 150 && t % 5 === 0 && t < 200) this.fight.dropXp(this.pos, Math.floor(total * 0.08));
    if (t >= 200) {
      this.fight.dropXp(this.pos, Math.floor(total * 0.2));
      this.dead = true;
      this.fight.dragonDied(this);
    }
  }

  /* ---- drawing ---- */
  render(alpha) {
    super.render(alpha);
    const yaw = this.prevYaw + wrapA(this.yaw - this.prevYaw) * alpha;
    this.model.rotation.y = yaw;
    this.beams.rotation.y = (this.age + alpha) * 0.01;
    const t = (this.age + alpha) / 20;
    const sit = this.sitting();
    // wings: a slow beat in flight, folded when perched
    const beat = sit ? 0.15 : Math.sin(t * Math.PI * 2 * 0.55) * 0.7;
    for (const wg of this.wings) {
      wg.root.rotation.z = wg.side * (sit ? -0.25 : beat);
      wg.tip.rotation.z = wg.side * (sit ? -1.2 : beat * 0.7 + 0.1);
    }
    // the neck curls down while perched, and the jaw opens to breathe
    const dip = sit ? 0.9 : 0;
    this.neck.forEach((n, i) => { n.position.y = 2.0 + i * 0.12 - dip * (i / 4) * 1.2; });
    this.head.position.y = 2.6 - dip * 1.3;
    this.jaw.rotation.x = this.phase === 'flame' || this.phase === 'roar' ? 0.5 : 0;
    // the tail sways
    this.tail.forEach((s, i) => { s.position.x = Math.sin(t * 2 - i * 0.45) * i * 0.08; s.position.y = 1.6 + Math.sin(t * 1.4 - i * 0.3) * i * 0.04; });
    // red when hurt
    const red = this.hurtTime > 0 ? 0.6 : 0;
    this.bodyMats.forEach((m, i) => m.color.copy(this.bodyCols[i]).lerp(colour(0xb01010, this.R.linear), red));
    if (this.phase === 'dying') {
      const k = Math.min(1, this.deathTime / 200);
      this.beamMesh.geometry.setDrawRange(0, Math.max(3, Math.floor(k * 40) * 3));
      this.beams.scale.setScalar(0.3 + k);
    }
  }
}
