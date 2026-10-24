/* ---------------------------------------------------------------------------
   Leoncraft 2 - what the hand throws or puts out that did nothing before:

     ender pearl          thrown (1.5 a tick); where it lands you go, for 5
                          damage, and one time in twenty an endermite comes
                          out; a second's wait between throws
     bottle o' enchanting thrown up a little (0.7); 3 to 11 experience where
                          it breaks
     wind charge          thrown (1.5), a burst where it hits (mobs7.js); half
                          a second between throws
     blue and brown eggs  thrown like an egg (a chick one time in eight)
     firework rocket      on a block: up it goes and bursts in its stars'
                          colours (5 damage, 2 more a star, to what is close);
                          gliding with an elytra, a boost along the look
     armor stand          stood on the block clicked, facing you; armour on it
                          and off it with a right click; two quick hits (one in
                          creative) knock it down
     painting             on the side of a block: the biggest that fits there,
                          one of the sizes the game has (our own pictures);
                          comes off when hit or when its wall goes
     fishing rod          cast and reeled in; in water a fish bites after 5 to
                          30 seconds (less with Lure), the bobber dips, and a
                          reel then lands a fish, junk or treasure, and 1 to 6
                          experience
     ominous bottle       drunk: Bad Omen for 100 minutes

   useExtra(manager, itemName, target, take, build) is the manager's last
   try at a right click (entities/manager.js useHeld).
--------------------------------------------------------------------------- */
import { Entity, Living, DEG, yawTo, r3 } from './entity.js?v=107';
import { Projectile } from './projectiles.js?v=107';
import { register, TYPES } from './mobs.js?v=107';
import { model } from './mobs2.js?v=107';
import { addArt } from './mobart.js?v=107';
import { B, BLOCKS, FLUID, SOLID } from '../blocks.js?v=107';
import { ITEMS, I, armorOf, addCooldown, onCooldown, PAINTING_VARIANTS, PAINTING_PX, maxDamage } from '../items.js?v=107';
import { ENCH, ORDER, isPrimary, selectEnchants } from '../enchanting.js?v=107';
import { LegacyRandom } from '../gen/random.js?v=107';
import { fireworkColour } from '../crafting.js?v=107';
import { rayBox } from './terrain.js?v=107';
import { lootStack } from '../containers.js?v=107';
const THREE = window.THREE;

const PI = Math.PI;
const R = () => Math.random();
const RI = n => Math.floor(Math.random() * n);
const POSE = 7, RX = 3, RY = 4, RZ = 5, SC = 6;
const set = (P, i, k, v) => { if (i !== undefined) P[i * POSE + k] = v; };

// the ominous bottle is drunk like a potion: Bad Omen (its level from the bottle) for 100 minutes
if (I.ominous_bottle !== undefined && ITEMS[I.ominous_bottle]) ITEMS[I.ominous_bottle].food = { hunger: 0, saturation: 0, ticks: 32, always: true, drink: true, effects: [['bad_omen', 1, 6000, 1]], leaves: null };

/* ---- thrown ---- */
export class EnderPearl extends Projectile {
  static MODEL = 'ball'; static TEX = 'ender_pearl';
  hitEntity(e) {
    const src = { type: 'thrown', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    if (e.isPlayer) this.m.hurtPlayer(0.0001, src); else if (e.hurt) e.hurt(0.0001, src);
    this.land(); return true;
  }
  hitBlock() { this.land(); }
  land() {
    if (this.removed) return;
    const p = this.pos, m = this.m;
    m.particles('magic', p.x, p.y, p.z, 32, 0.5, [0.55, 0.2, 0.75]);
    if (this.owner === m.player && m.player.alive()) {
      if (m.riding) m.dismount();
      const P = m.P;
      P.pos.set(p.x, p.y, p.z); P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.fallDistance = 0;
      m.hurtPlayer(5, { type: 'ender_pearl', noKnock: true });
      if (R() < 0.05) m.spawn('endermite', p.x, p.y, p.z, { natural: false });
    }
    this.remove();
  }
}
register('ender_pearl', EnderPearl);
/* ---- Leon Network's Murder Mystery: the murderer's thrown knife. It flies straight (it neither falls nor slows) for
   two seconds, about 30 blocks, drawn along its flight, and goes on the first block it meets; the first player it
   reaches is told to the server as a thrown hit (net.js shotPlayer), which kills there. Our own model and picture. ---- */
model('knife', [{ name: 'blade', pivot: [0, 24, 0], boxes: [[-0.5, -1, -8, 1, 2, 10, 0, 0], [-2, -0.5, 2, 4, 1, 1, 0, 14], [-0.5, -0.5, 3, 1, 1, 4, 0, 18]] }]);
addArt('knife', [64, 32], p => { p.box(0, 0, 1, 2, 10, 0xd8dde2, 0.06); p.box(0, 14, 4, 1, 1, 0x3a3a3a, 0.08); p.box(0, 18, 1, 1, 4, 0x6a4a2a, 0.08); });
export class Knife extends Projectile {
  static W = 0.5; static H = 0.5; static MODEL = 'knife'; static TEX = 'knife';
  constructor(m, type) { super(m, type); this.gravity = 0; this.drag = 1; }
  rootPose(root, t, a) { root.multiply(t.makeRotationX(-(this.prevPitch + (this.pitch - this.prevPitch) * a))); }
  skip(e) { return e === this.owner; }
  tick() { super.tick(); if (this.life > 40 && !this.removed) this.remove(); }
  hitEntity(e) {
    const src = { type: 'thrown', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z };
    if (e.isPlayer) this.m.hurtPlayer(10, src); else e.hurt(10, src);
    this.m.particles('crit', this.pos.x, this.pos.y, this.pos.z, 6, 0.2);
    this.remove();
  }
  hitBlock() { this.m.particles('crit', this.pos.x, this.pos.y, this.pos.z, 4, 0.1); this.remove(); }
}
register('knife', Knife);
addArt('ender_pearl', [64, 32], p => { p.box(0, 0, 4, 4, 4, 0x1e5a52, 0.12); p.speckle(0, 0, 16, 8, 0x3a8a7a, 0.3); });
export class ExpBottle extends Projectile {
  static MODEL = 'ball'; static TEX = 'experience_bottle';
  constructor(m, type) { super(m, type); this.gravity = 0.07; }
  hitEntity() { this.smash(); return true; }
  hitBlock() { this.smash(); }
  smash() {
    if (this.removed) return;
    const p = this.pos;
    this.m.particles('magic', p.x, p.y, p.z, 20, 0.4, [0.4, 0.6, 1]);
    this.m.xpAt(p.x, p.y, p.z, 3 + RI(5) + RI(5));
    this.remove();
  }
}
register('experience_bottle', ExpBottle);
addArt('experience_bottle', [64, 32], p => { p.box(0, 0, 4, 4, 4, 0x7ad87a, 0.1); p.speckle(0, 0, 16, 8, 0xd8f8a8, 0.2); });

/* ---- fireworks ---- */
export class FireworkRocket extends Entity {
  static W = 0.25; static H = 0.25; static MODEL = 'firework_rocket'; static TEX = 'firework_rocket'; static BRIGHT = true;
  constructor(m, type) { super(m, type); this.gravity = 0; this.life = 0; this.stack = null; this.boosting = null; this.angled = false; this.owner = null; this.stuck = false; this.drag = 1; }
  // shot from a crossbow: along (dx, dy, dz) at speed, as a projectile is
  shootAt(dx, dy, dz, speed, inacc) { Projectile.prototype.shoot.call(this, dx, dy, dz, speed, inacc); this.angled = true; }
  get waterDrag() { return 1; }
  init(stack) {
    this.stack = stack;
    const flight = (stack && stack.flight) || 1;
    this.life = 10 * (1 + flight) + RI(6) + RI(7);
    this.vel.set((R() - R()) * 0.0023, 0.05, (R() - R()) * 0.0023);
  }
  tick() {
    this.prev.copy(this.pos); this.prevYaw = this.yaw; this.age++;
    if (this.boosting) {
      // carrying a gliding player along their look
      const P = this.m.P, b = this.boosting;
      if (!P.gliding) { this.burst(); return; }
      const lx = -Math.sin(P.yaw) * Math.cos(P.pitch), ly = Math.sin(P.pitch), lz = -Math.cos(P.yaw) * Math.cos(P.pitch);
      P.vel.x += lx * 0.1 + (lx * 1.5 - P.vel.x) * 0.5; P.vel.y += ly * 0.1 + (ly * 1.5 - P.vel.y) * 0.5; P.vel.z += lz * 0.1 + (lz * 1.5 - P.vel.z) * 0.5;
      this.pos.set(P.pos.x, P.pos.y + 0.5, P.pos.z);
      void b;
    } else if (this.angled) {
      // off a crossbow: straight on at its speed, no gravity; it meets mobs and players as a projectile does
      // (Projectile.prototype.tick, which counts its own life up: the fuse is kept aside)
      const fuse = this.life, age = this.age;
      if (this.vel.lengthSq() > 1e-8) { Projectile.prototype.tick.call(this); this.age = age; }
      else this.prev.copy(this.pos);
      if (this.removed) return;
      this.life = fuse;
    } else {
      this.vel.x *= 1.15; this.vel.z *= 1.15; this.vel.y += 0.04;
      this.move(this.vel.x, this.vel.y, this.vel.z);
      if (this.hCollide || this.vCollide) { this.burst(); return; }
    }
    if (this.age % 2 === 0) this.m.particles('sparkle', this.pos.x, this.pos.y - 0.2, this.pos.z, 1, 0.05);
    if (this.age > this.life) this.burst();
  }
  // (shot at an angle) a mob or a player: it goes off there; a block: only one with stars goes off, a plain rocket stops
  hitEntity() { this.burst(); }
  hitBlock() { if (this.stack && this.stack.explosions && this.stack.explosions.length) this.burst(); else this.vel.set(0, 0, 0); }
  burst() {
    if (this.removed) return;
    const ex = (this.stack && this.stack.explosions) || [], p = this.pos;
    for (const f of ex) {
      const cols = (f.colors || ['white']).map(c => { const v = fireworkColour(c) || 0xffffff; return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]; });
      const n = f.shape === 'large_ball' ? 60 : f.shape === 'small_ball' ? 30 : 40, spread = f.shape === 'large_ball' ? 3 : 1.6;
      for (let i = 0; i < n; i += 4) this.m.particles('sparkle', p.x, p.y, p.z, 4, spread, cols[RI(cols.length)]);
    }
    if (!ex.length) this.m.particles('poof', p.x, p.y, p.z, 3, 0.2);
    // stars hurt what is close: 5, and 2 more for each further star (within 5 blocks, seen)
    if (ex.length) {
      const dmg = 5 + ex.length * 2;
      this.m.forNear(p.x, p.z, 5, e => { if (e !== this && e.hurt && !e.dead && e.dist2(p.x, p.y, p.z) <= 25) e.hurt(dmg * Math.sqrt((5 - Math.sqrt(e.dist2(p.x, p.y, p.z))) / 5), { type: 'fireworks', noKnock: true, attacker: this.owner || undefined }); });
      const P = this.m.player, d2 = P.dist2(p.x, p.y, p.z);
      if (P.alive() && d2 <= 25) this.m.hurtPlayer(dmg * Math.sqrt((5 - Math.sqrt(d2)) / 5), { type: 'fireworks', noKnock: true });
    }
    this.remove();
  }
  // bo: carrying the player of the machine that runs it (net/mobs.js keeps another machine's copy on that player)
  toJSON() { const o = super.toJSON(); o.lf = this.life; if (this.angled) o.an = 1; if (this.stack) o.st = { flight: this.stack.flight, explosions: this.stack.explosions }; if (this.boosting) o.bo = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.life = o.lf || 30; this.angled = !!o.an; this.stack = o.st || null; }
}
register('firework_rocket', FireworkRocket);
model('firework_rocket', [{ name: 'rocket', pivot: [0, 24, 0], boxes: [[-1, -8, -1, 2, 5, 2, 0, 0], [-0.5, -3, -0.5, 1, 5, 1, 8, 0], [-1.5, -10, -1.5, 3, 2, 3, 0, 8]] }]);
addArt('firework_rocket', [64, 32], p => { p.box(0, 0, 2, 5, 2, 0xc83030, 0.06); p.fill(0, 4, 8, 1, 0xf0f0f0); p.box(8, 0, 1, 5, 1, 0x8a6a40, 0.06); p.box(0, 8, 3, 2, 3, 0xd8d8d8, 0.06); });

/* ---- armor stand ---- */
export class ArmorStand extends Living {
  static W = 0.5; static H = 1.975; static HEALTH = 20; static MODEL = 'armor_stand'; static TEX = 'armor_stand'; static SHADOW = 0.5;
  static NO_PUSH = true; static NO_FALL = true; static CATEGORY = 'misc';
  constructor(m, type) { super(m, type); this.equip = {}; this.lastHit = -100; this.wobble = 0; }
  tick() {
    this.prev.copy(this.pos); this.prevBodyYaw = this.bodyYaw; this.prevHeadYaw = this.headYaw; this.prevYaw = this.yaw;
    this.age++;
    if (this.wobble > 0) this.wobble--;
    // it falls, and stands where it lands
    this.vel.y -= 0.08; this.vel.x = 0; this.vel.z = 0;
    this.move(0, this.vel.y, 0);
    if (this.onGround) this.vel.y = 0;
    this.headYaw = this.bodyYaw = this.yaw;
  }
  hurt(amount, source) {
    if (this.removed) return false;
    if (source && (source.type === 'explosion' || source.type === 'fire' || source.type === 'lava')) { this.breakDown(true); return true; }
    const byPlayer = source && (source.player || (source.attacker && source.attacker.isPlayer));
    if (!byPlayer) return false;
    // in creative one hit takes it away, nothing dropped; otherwise two within a quarter second
    if (this.m.mode === 'creative') { this.remove(); this.m.particles('poof', this.pos.x, this.pos.y + 1, this.pos.z, 8, 0.3, [0.6, 0.45, 0.3]); return true; }
    if (this.age - this.lastHit < 5) { this.breakDown(true); return true; }
    this.lastHit = this.age; this.wobble = 10;
    return true;
  }
  breakDown(drop) {
    if (drop) { this.m.dropAt(this, 'armor_stand', 1); for (const k in this.equip) if (this.equip[k]) this.m.dropAt(this, this.equip[k], 1); }
    this.m.particles('poof', this.pos.x, this.pos.y + 1, this.pos.z, 12, 0.3, [0.6, 0.45, 0.3]);
    this.remove();
  }
  // armour on: into its slot (swapping); empty-handed: off again, the piece by where you clicked
  interact(held, player) {
    const a = held ? armorOf(I[held]) : null;
    const slots = ['head', 'chest', 'legs', 'feet'];
    if (a) {
      const k = slots[a.slot], old = this.equip[k];
      this.equip[k] = held;
      if (old) this.m.dropItemAt(this.m.P.pos.x, this.m.P.pos.y + 1, this.m.P.pos.z, old, 1, false, true);
      return 'consume';
    }
    if (held) { if (!this.equip.mainhand) { this.equip.mainhand = held; return 'consume'; } return false; }
    const P = this.m.P, eyeY = P.pos.y + 1.62, dy = eyeY - this.pos.y;
    const k = dy > 1.6 ? 'head' : dy > 0.9 ? 'chest' : dy > 0.4 ? 'legs' : 'feet';
    const order = [k, 'head', 'chest', 'legs', 'feet', 'mainhand'];
    for (const s of order) if (this.equip[s]) { const it = this.equip[s]; this.equip[s] = null; this.m.dropItemAt(P.pos.x, P.pos.y + 1, P.pos.z, it, 1, false, true); return 'swing'; }
    return false;
  }
  anim(A) { A.wobble = this.wobble; }
}
register('armor_stand', ArmorStand);
model('armor_stand', [
  { name: 'head', pivot: [0, 1, 0], boxes: [[-1, -7, -1, 2, 7, 2, 0, 0]] },
  { name: 'body', pivot: [0, 0, 0], boxes: [[-6, 0, -1.5, 12, 3, 3, 0, 26], [-3, 3, -1, 2, 7, 2, 16, 0], [1, 3, -1, 2, 7, 2, 48, 16], [-4, 10, -1, 8, 2, 2, 0, 48]] },
  { name: 'rightArm', pivot: [-5, 2, 0], boxes: [] },
  { name: 'leftArm', pivot: [5, 2, 0], boxes: [] },
  { name: 'rightLeg', pivot: [-1.9, 12, 0], boxes: [[-1, 0, -1, 2, 11, 2, 8, 0]] },
  { name: 'leftLeg', pivot: [1.9, 12, 0], boxes: [[-1, 0, -1, 2, 11, 2, 40, 16, 0, true]] },
  { name: 'base', pivot: [0, 12, 0], boxes: [[-6, 11, -6, 12, 1, 12, 0, 32]] },
], (m, P, A) => { if (A.wobble > 0) set(P, m.index.body, RY, Math.sin(A.wobble * 1.3) * 0.15); });
addArt('armor_stand', [64, 64], p => {
  const wood = 0xa8824e, dark = 0x7a5a32, stone = 0x9a9a9a;
  p.clear(0, 0, 64, 64);
  for (const [u, v, w, h, d] of [[0, 0, 2, 7, 2], [16, 0, 2, 7, 2], [48, 16, 2, 7, 2], [8, 0, 2, 11, 2], [40, 16, 2, 11, 2], [0, 26, 12, 3, 3], [0, 48, 8, 2, 2]]) { p.box(u, v, w, h, d, wood, 0.08); p.speckle(u, v, 2 * (w + d), h + d, dark, 0.15); }
  p.box(0, 32, 12, 1, 12, stone, 0.06); p.speckle(0, 32, 48, 13, 0x7a7a7a, 0.2);
});

/* ---- paintings ---- */
const PAINTINGS = PAINTING_VARIANTS;
/* Each picture our own, from the name's seed: one of four scenes (rolling
   hills by day, a sea at sunset, a night with a moon and stars, a few bold
   shapes), in flat bands of colour with a pixel of grain, a sun or moon,
   trees or figures, and a dark frame: a stand-in until the famous painting
   that variant shows (textures/famous_paintings.jpg), or a player's own copy
   of the game's, is drawn over it (entities/packart.js). */
const SCENES = [
  { sky: [0x7ab0e0, 0xb8d8f0], far: 0x6a9a5a, near: 0x4a7a3a, ground: 0x8a6a40, sun: 0xf8e8a0 },
  { sky: [0xd8784a, 0xf0c070], far: 0x3a5a8a, near: 0x2a4a7a, ground: 0x1a3a6a, sun: 0xf8d060 },
  { sky: [0x1a1a3a, 0x3a3a6a], far: 0x2a3a4a, near: 0x1e2a36, ground: 0x141c24, sun: 0xe8e8f0 },
  { sky: [0xe8dcc0, 0xd8c8a0], far: 0xa84a3a, near: 0x3a5a8a, ground: 0x2a2a2a, sun: 0xf0b030 },
];
/* The newer paintings Pixel Perfection CE has no picture of: each a scene of our own on its name's subject,
   drawn with a few shapes at sixteen pixels a block. */
function kit(p, W, H, rnd) {
  const hex = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const K = {
    W, H, rnd,
    mix: (a, b, t) => { const A = hex(a), Bc = hex(b); return (Math.round(A[0] + (Bc[0] - A[0]) * t) << 16) | (Math.round(A[1] + (Bc[1] - A[1]) * t) << 8) | Math.round(A[2] + (Bc[2] - A[2]) * t); },
    px: (x, y, c, g = 0.05) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) p.px(x, y, g ? p.shade(c, 1 + (rnd() - 0.5) * 2 * g) : c); },
    rect: (x, y, w, h, c, g) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) K.px(x + i, y + j, c, g); },
    oval: (cx, cy, rx, ry, c, g) => { for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) K.px(x, y, c, g); },
    disc: (cx, cy, r, c, g) => K.oval(cx, cy, r, r, c, g),
    // bands of colour from a (at y0) to b (at y1)
    sky: (y0, y1, a, b, bands = 4) => { for (let y = y0; y < y1; y++) { const t = Math.floor((y - y0) / Math.max(1, y1 - y0) * bands) / Math.max(1, bands - 1); K.rect(0, y, W, 1, K.mix(a, b, Math.min(1, t)), 0.02); } },
    line: (x0, y0, x1, y1, c, g) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) K.px(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, c, g); },
    // a hill line: the ground from y(x) down, in colour c
    hills: (fy, c, g) => { for (let x = 0; x < W; x++) for (let y = Math.max(0, Math.floor(fy(x))); y < H; y++) K.px(x, y, c, g); },
  };
  return K;
}
const THEMED = {
  meditative: K => {
    K.sky(0, 16, 0xf0a060, 0x8a4a6a);
    K.disc(8, 6, 3, 0xf8d878, 0);
    K.hills(x => 12 + Math.sin(x / 3) * 0.6, 0x3a2a3a);
    K.oval(8, 11, 3, 2.5, 0x1e1620); K.disc(8, 7, 1.6, 0x1e1620);
  },
  prairie_ride: K => {
    K.sky(0, 22, 0x88b8e8, 0xf0dca0);
    K.hills(x => 14 - (x > 9 ? 5 : x > 6 ? 3 : 0), 0xb06a48);
    K.hills(x => 22 + Math.sin(x / 2) * 0.5, 0xc8b060);
    K.rect(4, 19, 7, 3, 0x5a3a24); K.rect(4, 22, 1, 3, 0x4a2e1c); K.rect(9, 22, 1, 3, 0x4a2e1c); K.rect(10, 18, 2, 2, 0x5a3a24);
    K.rect(6, 16, 2, 3, 0x7a2a2a); K.disc(7, 15, 1, 0xd8a878, 0); K.rect(5, 14, 4, 1, 0x3a2a1a, 0);
  },
  baroque: K => {
    K.rect(0, 0, 32, 32, 0x2a1a14, 0.04);
    K.oval(16, 16, 13, 14, 0xb08a3a, 0.08); K.oval(16, 16, 11, 12, 0x3a2418, 0.05);
    K.rect(12, 20, 8, 7, 0x6a8ab8); K.rect(13, 18, 6, 2, 0x5a7aa8);
    for (const [x, y, c] of [[11, 12, 0xd84040], [16, 9, 0xf0e8d0], [21, 12, 0xe8b830], [14, 14, 0xc85090], [19, 15, 0xd84040]]) K.disc(x, y, 2.4, c);
    for (let i = 0; i < 6; i++) K.line(16, 18, 10 + i * 2.4, 13, 0x3a6a2a, 0);
  },
  humble: K => {
    K.sky(0, 22, 0x7ab0e0, 0xc8e0f0);
    K.hills(x => 22 + Math.sin(x / 5) * 1.5, 0x5a9a3a);
    K.rect(9, 15, 14, 9, 0xd8c8a0); K.rect(15, 19, 3, 5, 0x6a4a2a); K.rect(11, 17, 3, 3, 0x88b8d8); K.rect(19, 17, 3, 3, 0x88b8d8);
    for (let i = 0; i < 6; i++) K.rect(8 + i, 15 - i, 16 - 2 * i, 1, 0xa83a2a);
    K.rect(20, 7, 2, 5, 0x6a6a6a); K.disc(22, 5, 1.5, 0xd8d8d8, 0); K.disc(24, 3, 1.2, 0xe0e0e0, 0);
  },
  bouquet: K => {
    K.rect(0, 0, 48, 48, 0xd8c8a8, 0.04); K.rect(0, 36, 48, 12, 0x8a5a3a, 0.06);
    K.oval(24, 32, 7, 9, 0x3a5a9a); K.rect(20, 22, 8, 3, 0x2e4a84);
    for (let i = 0; i < 9; i++) K.line(24, 24, 12 + i * 3, 10 + (i % 3) * 3, 0x3a7a2a, 0);
    const C = [0xd83040, 0xf0e070, 0xe890c0, 0xf8f8f0, 0x8a48c0, 0xe87830];
    for (let i = 0; i < 14; i++) K.disc(10 + K.rnd() * 28, 6 + K.rnd() * 16, 2 + K.rnd() * 1.5, C[i % C.length]);
  },
  cavebird: K => {
    K.rect(0, 0, 48, 48, 0x2a2622, 0.08);
    K.oval(24, 30, 15, 20, 0x9ac0d8, 0.02); K.oval(24, 34, 15, 12, 0x6a9a5a, 0.04);
    K.hills(x => 40 + Math.abs(x - 24) * 0.3, 0x3a3430);
    const bx = 24, by = 22;
    K.rect(bx - 1, by, 3, 2, 0x1a1a1a, 0); K.line(bx - 6, by - 3, bx, by, 0x1a1a1a, 0); K.line(bx + 7, by - 3, bx + 1, by, 0x1a1a1a, 0);
    for (let i = 0; i < 20; i++) K.px(K.rnd() * 48, K.rnd() * 10, 0x4a4440);
  },
  cotan: K => {
    K.rect(0, 0, 48, 48, 0xece0c8, 0.03);
    K.disc(16, 16, 9, 0xd84a2a); K.disc(16, 16, 5, 0x2a3a8a); K.disc(34, 30, 7, 0xf0c030); K.disc(34, 30, 3, 0x1a1a1a);
    K.rect(6, 34, 20, 4, 0x2a8a6a); K.line(4, 44, 44, 4, 0x1a1a1a, 0); K.line(10, 46, 46, 22, 0x1a1a1a, 0);
    K.rect(30, 8, 3, 14, 0x8a2a8a);
  },
  endboss: K => {
    K.sky(0, 48, 0x4a3478, 0x8a6aa8);
    for (let i = 0; i < 30; i++) K.px(K.rnd() * 48, K.rnd() * 30, 0xe0d8f0, 0);
    K.hills(x => 38 + Math.abs(x - 24) * 0.25, 0xd8d8a0);
    K.oval(24, 16, 6, 3, 0x141018); K.line(18, 15, 4, 8, 0x141018, 0); K.line(30, 15, 44, 8, 0x141018, 0);
    K.line(18, 16, 6, 12, 0x141018, 0); K.line(30, 16, 42, 12, 0x141018, 0); K.rect(29, 13, 6, 3, 0x141018); K.px(33, 14, 0xc060f0, 0);
    K.rect(11, 27, 2, 11, 0x2a2a3a); K.rect(36, 25, 2, 13, 0x2a2a3a);
  },
  fern: K => {
    K.rect(0, 0, 48, 48, 0xc8d4b8, 0.04);
    for (let a = -1.2; a <= 1.21; a += 0.4) {
      const ex = 24 + Math.sin(a) * 22, ey = 44 - Math.cos(a) * 34;
      K.line(24, 46, ex, ey, 0x3a6a2a, 0);
      for (let t = 0.2; t < 1; t += 0.12) { const x = 24 + (ex - 24) * t, y = 46 + (ey - 46) * t; K.line(x, y, x - 4 * (1 - t), y - 3 * (1 - t) - 1, 0x4a8a3a, 0); K.line(x, y, x + 4 * (1 - t), y - 3 * (1 - t) - 1, 0x5a9a44, 0); }
    }
  },
  owlemons: K => {
    K.rect(0, 0, 48, 48, 0x6a8a9a, 0.04); K.rect(0, 30, 48, 3, 0x5a3a24); K.line(0, 32, 48, 28, 0x4a2e1c, 0);
    K.oval(24, 20, 9, 11, 0x8a6a4a); K.oval(24, 23, 6, 7, 0xc8b090);
    K.disc(20, 16, 3, 0xf0e8d0, 0); K.disc(28, 16, 3, 0xf0e8d0, 0); K.disc(20, 16, 1.4, 0xf0b020, 0); K.disc(28, 16, 1.4, 0xf0b020, 0); K.px(20, 16, 0x101010, 0); K.px(28, 16, 0x101010, 0);
    K.rect(23, 19, 2, 2, 0xd8a030, 0); K.rect(16, 7, 3, 3, 0x8a6a4a); K.rect(29, 7, 3, 3, 0x8a6a4a);
    K.oval(9, 38, 4, 3, 0xf0d830); K.oval(38, 39, 4, 3, 0xf0d830); K.rect(9, 35, 1, 1, 0x3a7a2a, 0);
  },
  sunflowers: K => {
    K.sky(0, 32, 0x5a98e0, 0xb0d8f0);
    K.hills(x => 36 + Math.sin(x / 6) * 2, 0x5a8a2a);
    for (const [x, y] of [[12, 14], [25, 9], [37, 16]]) {
      K.rect(x, y, 1, 48 - y, 0x3a6a1a, 0); K.oval(x + 3, y + 12, 3, 1.5, 0x4a8a2a);
      for (let a = 0; a < 6.28; a += 0.5) K.disc(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 2, 0xf0c020);
      K.disc(x, y, 3.5, 0x5a3a1a);
    }
  },
  tides: K => {
    K.sky(0, 20, 0x1a2a4a, 0x4a6a9a); K.disc(36, 8, 4, 0xf0f0e0, 0);
    for (let r = 0; r < 6; r++) {
      const y0 = 20 + r * 5, c = K.mix(0x2a5a9a, 0x0a2a5a, r / 5);
      K.hills(x => y0 + Math.sin(x / 4 + r * 1.7) * 2, c);
      for (let x = 0; x < 48; x++) if (Math.sin(x / 4 + r * 1.7) > 0.8) K.px(x, y0 + Math.sin(x / 4 + r * 1.7) * 2 - 1, 0xe8f0f8, 0);
    }
  },
  dennis: K => {
    K.rect(0, 0, 48, 48, 0x5a6a5a, 0.05);
    K.oval(24, 46, 16, 14, 0x2a2a3a); K.rect(21, 28, 6, 6, 0xd8a888);
    K.oval(24, 20, 8, 10, 0xe0b090); K.oval(24, 12, 9, 5, 0x3a2a1a);
    K.rect(20, 19, 2, 1, 0x2a2a2a, 0); K.rect(26, 19, 2, 1, 0x2a2a2a, 0); K.rect(23, 22, 2, 2, 0xc89070, 0); K.rect(21, 26, 6, 1, 0x8a4a3a, 0);
    K.rect(22, 34, 4, 8, 0xe8e8e8); K.rect(23, 35, 2, 7, 0x8a2a2a);
  },
  backyard: K => {
    K.sky(0, 30, 0x88c0f0, 0xd8ecf8);
    K.hills(x => 40, 0x5aa03a);
    K.rect(30, 14, 18, 26, 0xc8a878); for (let i = 0; i < 8; i++) K.rect(28 + i, 14 - i, 20, 1, 0x8a3a2a);
    K.rect(36, 30, 4, 10, 0x5a3a24); K.rect(41, 20, 4, 4, 0x9ac8e8);
    for (let x = 0; x < 30; x += 4) { K.rect(x, 34, 2, 10, 0xe8e0d0); } K.rect(0, 36, 30, 1, 0xe8e0d0); K.rect(0, 40, 30, 1, 0xe8e0d0);
    K.rect(10, 22, 3, 18, 0x5a3a24); K.disc(11, 18, 8, 0x3a7a2a); K.disc(7, 22, 5, 0x4a8a34);
    for (let y = 44; y < 64; y++) K.rect(22 - (y - 44) * 0.4, y, 6 + (y - 44) * 0.8, 1, 0xb8a888);
  },
  pond: K => {
    K.rect(0, 0, 48, 64, 0x5a9a3a, 0.08); K.sky(0, 14, 0x9ac8e8, 0xd8e8f0);
    K.oval(24, 38, 19, 14, 0x3a6aa8); K.oval(22, 36, 15, 10, 0x4a7ab8);
    for (const [x, y] of [[14, 36], [28, 42], [32, 32], [20, 46]]) { K.disc(x, y, 3, 0x3a8a2a); K.px(x + 1, y - 1, 0xe8a0c0, 0); }
    for (let i = 0; i < 9; i++) { const x = 3 + i * 5 + (i > 4 ? 0 : 0); K.line(x, 60, x + 1, 50 - (i % 3) * 3, 0x6a8a2a, 0); K.rect(x, 48 - (i % 3) * 3, 1, 3, 0x6a4a2a, 0); }
  },
  changing: K => {
    const S = [[0x8ac8f0, 0x7ac04a, 0xf0b0d0], [0x5aa8f0, 0x4a9a2a, 0x2a7a1a], [0xd8b888, 0xc8902a, 0xd85a1a], [0xb8c8d8, 0xf0f0f8, 0xe8f0f8]];
    S.forEach(([sky, gr, leaf], i) => {
      K.rect(i * 16, 0, 16, 20, sky); K.rect(i * 16, 20, 16, 12, gr);
      K.rect(i * 16 + 7, 12, 2, 10, 0x5a3a24); K.disc(i * 16 + 8, 10, 5, leaf);
    });
  },
  finding: K => {
    K.sky(0, 14, 0x7ab8f0, 0xb8dcf8); K.rect(0, 14, 64, 6, 0x3a7ab8); K.hills(x => 20 + Math.sin(x / 7) * 0.8, 0xe8d8a0);
    K.rect(26, 21, 12, 7, 0x8a5a2a); K.rect(26, 19, 12, 3, 0x6a4422); K.rect(31, 23, 2, 2, 0xd8b830, 0);
    K.disc(28, 19, 1.4, 0xf0d040, 0); K.disc(33, 18, 1.4, 0xf0d040, 0);
    K.line(52, 30, 50, 8, 0x8a6a3a, 0); for (const [dx, dy] of [[-8, 3], [8, 2], [-6, -2], [6, -3]]) K.line(50, 8, 50 + dx, 8 + dy, 0x3a8a2a, 0);
  },
  lowmist: K => {
    K.sky(0, 32, 0xc8d0d8, 0xe8ecf0);
    [[10, 0x8a96a0], [15, 0x6a7a86], [20, 0x4a5a66], [25, 0x2e3a44]].forEach(([y, c], i) => K.hills(x => y + Math.sin(x / (6 + i * 2) + i) * 3 + Math.sin(x / 2.5 + i) * 0.6, c));
    for (let i = 0; i < 40; i++) K.px(K.rnd() * 64, 14 + K.rnd() * 10, 0xe0e4e8, 0);
  },
  passage: K => {
    K.rect(0, 0, 64, 32, 0x5a5650, 0.08);
    for (let i = 0; i < 6; i++) K.rect(18 + i * 2, 4 + i * 2, 28 - i * 4, 28 - i * 2, K.mix(0x3a3632, 0x9a9488, i / 5), 0.05);
    K.oval(32, 18, 4, 8, 0xf0e8c8, 0.02); K.rect(28, 18, 8, 14, 0xf0e8c8, 0.02);
    for (let y = 0; y < 32; y += 4) { K.rect(0, y, 64, 1, 0x4a4640, 0); }
    K.line(0, 32, 28, 26, 0x6a665e, 0); K.line(64, 32, 36, 26, 0x6a665e, 0);
  },
  orb: K => {
    K.sky(0, 64, 0x0a0a1a, 0x2a1a3a);
    K.hills(x => 50 + Math.sin(x / 9) * 3, 0x1a1a24);
    for (let r = 18; r > 0; r--) K.disc(32, 26, r, K.mix(0x2a1a4a, 0xf8f0ff, (18 - r) / 18), 0);
    for (let a = 0; a < 6.28; a += 0.52) K.line(32 + Math.cos(a) * 20, 26 + Math.sin(a) * 20, 32 + Math.cos(a) * 28, 26 + Math.sin(a) * 28, 0x8a6ac8, 0);
  },
  unpacked: K => {
    K.rect(0, 0, 64, 64, 0xc8a878, 0.05); K.rect(0, 46, 64, 18, 0x8a6a4a, 0.06);
    const crate = (x, y, w, h) => { K.rect(x, y, w, h, 0xb88a4a); K.rect(x, y, w, 1, 0x6a4a2a, 0); K.rect(x, y + h - 1, w, 1, 0x6a4a2a, 0); K.rect(x, y, 1, h, 0x6a4a2a, 0); K.rect(x + w - 1, y, 1, h, 0x6a4a2a, 0); K.line(x, y, x + w - 1, y + h - 1, 0x8a6a3a, 0); };
    crate(6, 30, 18, 18); crate(10, 14, 14, 16); crate(40, 32, 18, 16);
    K.rect(40, 26, 18, 6, 0x9a7240); K.rect(38, 24, 4, 8, 0xa8803a);
    for (const [x, y, c] of [[45, 28, 0xd84040], [50, 27, 0x40a0d8], [54, 28, 0xf0d040]]) K.disc(x, y, 2, c);
  },
};

function paintPicture(p, name, w, h) {
  const W = w * 16, H = h * 16;
  let seed = 7; for (const c of name) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  if (THEMED[name]) {
    THEMED[name](kit(p, W, H, rnd));
    for (let x = 0; x < W; x++) { p.px(x, 0, 0x5a3a20); p.px(x, H - 1, 0x4a2e18); }
    for (let y = 0; y < H; y++) { p.px(0, y, 0x5a3a20); p.px(W - 1, y, 0x4a2e18); }
    return;
  }
  const k0 = rnd(), kind = k0 < 0.4 ? 0 : k0 < 0.65 ? 1 : k0 < 0.85 ? 2 : 3, S = SCENES[kind];
  const grain = (c, x, y) => p.shade(c, ((x * 7 + y * 13 + seed) % 5) === 0 ? 0.94 : 1);
  const mix = (a, b, t) => { const A = [(a >> 16) & 255, (a >> 8) & 255, a & 255], Bc = [(b >> 16) & 255, (b >> 8) & 255, b & 255]; return A.map((v, i) => Math.round(v + (Bc[i] - v) * t)); };
  // the sky, in four bands from top to bottom
  for (let y = 0; y < H; y++) { const c = mix(S.sky[0], S.sky[1], Math.floor(y / H * 4) / 3); for (let x = 0; x < W; x++) p.px(x, y, c); }
  const ph1 = rnd() * 6, ph2 = rnd() * 6, f1 = 1 + Math.floor(rnd() * 2), f2 = 2 + Math.floor(rnd() * 2);
  if (kind === 3) {
    // bold shapes: a big disc, a slab, a bar
    const r = Math.floor(Math.min(W, H) * 0.28), cx = Math.floor(W * (0.3 + rnd() * 0.4)), cy = Math.floor(H * 0.4);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) p.px(cx + x, cy + y, S.far);
    p.fill(Math.floor(W * 0.1), Math.floor(H * 0.62), Math.floor(W * 0.8), Math.max(2, Math.floor(H * 0.12)), S.near);
    p.fill(Math.floor(W * (0.15 + rnd() * 0.5)), Math.floor(H * 0.2), Math.max(2, Math.floor(W * 0.08)), Math.floor(H * 0.65), S.ground);
  } else {
    // the sun (or moon), then far and near hills (a flat sea for the sunset) and the ground
    const r = Math.max(2, Math.floor(Math.min(W, H) / 7)), sx = Math.floor(W * (0.2 + rnd() * 0.6)), sy = Math.floor(H * (0.15 + rnd() * 0.15));
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) p.px(sx + x, sy + y, S.sun);
    if (kind === 2) for (let k = 0; k < w * h * 3; k++) p.px(Math.floor(rnd() * W), Math.floor(rnd() * H * 0.5), 0xf0f0f8);
    for (let x = 0; x < W; x++) {
      const t = x / W;
      const far = kind === 1 ? Math.floor(H * 0.55) : Math.floor(H * (0.5 + 0.08 * Math.sin(t * PI * f1 + ph1)));
      const near = Math.floor(H * (0.66 + 0.07 * Math.sin(t * PI * f2 + ph2)));
      for (let y = far; y < H; y++) p.px(x, y, grain(y >= near ? (y >= H - Math.max(2, Math.floor(H / 8)) ? S.ground : S.near) : S.far, x, y));
      if (kind === 1 && x % 4 === Math.floor(ph1) % 4) p.px(x, far + 2 + (x % 3), 0x8ab0d8);
    }
    // trees on the hills (day and night), each a trunk and a round top
    if (kind !== 1) for (let k = 0; k < w * h; k++) {
      const tx = 2 + Math.floor(rnd() * (W - 5)), base = Math.floor(H * (0.66 + 0.07 * Math.sin(tx / W * PI * f2 + ph2)));
      p.fill(tx + 1, base - 4, 1, 4, 0x4a3420);
      p.fill(tx, base - 7, 3, 3, kind === 2 ? 0x1a2a1a : 0x2a5a2a);
    }
  }
  // the frame round the edge
  for (let x = 0; x < W; x++) { p.px(x, 0, 0x5a3a20); p.px(x, H - 1, 0x4a2e18); }
  for (let y = 0; y < H; y++) { p.px(0, y, 0x5a3a20); p.px(W - 1, y, 0x4a2e18); }
}
/* The pictures are famous paintings out of copyright (textures/famous_paintings.jpg, drawn over these by
   entities/packart.js) at sixty-four pixels a block, as the first Leoncraft has them: at the game's sixteen a
   photographed Mona Lisa is a smudge with a face-shaped area in it. The picture's plane takes four texture pixels to
   each of its model's (entitymesh.js modelGeometry), so the model keeps the game's sizes. Until the sheet is in, or
   if it never comes, each shows the scene above, drawn a model pixel to every four of its texture's. */
const PAINT_RES = PAINTING_PX / 16;
function scaled(p) {
  const px = (x, y, c, a) => { x = Math.floor(x) * PAINT_RES; y = Math.floor(y) * PAINT_RES; for (let j = 0; j < PAINT_RES; j++) for (let i = 0; i < PAINT_RES; i++) p.px(x + i, y + j, c, a); };
  return { px, shade: (c, k) => p.shade(c, k), fill: (x, y, w, h, c, amt = 0.08) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, p.shade(c, 1 + (p.r() - 0.5) * 2 * amt)); } };
}
const sizes = new Set(PAINTINGS.map(([, w, h]) => w + 'x' + h));
for (const s of sizes) {
  const [w, h] = s.split('x').map(Number), W = w * 16, H = h * 16;
  // the back: a wooden board a pixel thick; the picture: a plane on its front
  model('painting_' + s, [{ name: 'board', pivot: [0, 24, 0], boxes: [[-W / 2, -H, 0, W, H, 1, 0, 0]] }]);
  // the picture a tenth of a pixel off the board, its front alone (its back lay in the same place and flickered with it)
  model('painting_' + s + '_face', [{ name: 'board', pivot: [0, 24, 0], boxes: [[-W / 2, -H, -0.1, W, H, 0, 0, 0, 0, false, false, true, PAINT_RES]] }]);
}
addArt('painting_back', [64, 64], p => { p.fill(0, 0, 64, 64, 0x8a6a40, 0.1); for (let y = 0; y < 64; y += 4) p.fill(0, y, 64, 1, 0x6a4e2e); });
for (const [n, w, h] of PAINTINGS) addArt('painting_' + n, [w * 16 * PAINT_RES, h * 16 * PAINT_RES], p => paintPicture(scaled(p), n, w, h));
/* What a painting hangs on: a solid block, or a sign (standing, on a wall, hanging; not a banner). The game counts its
   signs as solid for this (forceSolidOn), which keeps the old secret door working: signs in a doorway, a painting hung
   on them, and you walk through the picture. (Hanging signs are let in here too; whether the game's are, we did not check.) */
export function holdsPainting(b) {
  if (SOLID[b]) return true;
  const d = BLOCKS[b];
  return !!d && (d.shape === 'sign' || d.shape === 'wall_sign') && !d.banner;
}
export class Painting extends Entity {
  static W = 1; static H = 1; static TEX = 'painting_back'; static NO_PUSH = true; static SHADOW = 0;
  constructor(m, type) { super(m, type); this.variant = 'kebab'; this.face = [0, 0, -1]; this.block = null; this.gravity = 0; this.checkT = 0; }
  get size() { const v = PAINTINGS.find(e => e[0] === this.variant) || PAINTINGS[0]; return v[1] + 'x' + v[2]; }
  modelName() { return 'painting_' + this.size; }
  // hung: its box is a thin slab against the wall (w x h, 1/16 deep)
  setOn(bx, by, bz, face, variant) {
    this.variant = variant; this.face = face; this.block = [bx, by, bz];
    const v = PAINTINGS.find(e => e[0] === variant), w = v[1], h = v[2];
    // facing out of the wall (a mob's yaw: its front is (-sin, -cos))
    this.yaw = this.prevYaw = Math.atan2(-face[0], -face[2]);
    // the middle of the wall the picture covers, off its face by half a pixel
    const ox = (w % 2 === 0 ? 0.5 : 0), oy = (h % 2 === 0 ? 0.5 : 0);
    const rx = -face[2], rz = face[0];          // the wall's "right" as you face it
    const cx = bx + 0.5 + face[0] * 0.5625 + rx * ox, cz = bz + 0.5 + face[2] * 0.5625 + rz * ox;
    this.setPos(cx, by + 0.5 - h / 2 + oy, cz);
    const thin = 1 / 16;
    this.w = Math.abs(face[0]) ? thin : w; this.hw = Math.max(this.w, Math.abs(face[0]) ? w : thin) / 2; this.h = h;
    return this;
  }
  tick() {
    this.prev.copy(this.pos); this.age++;
    // the wall behind gone: it drops
    if (++this.checkT >= 20 && this.block) {
      this.checkT = 0;
      const [x, y, z] = this.block;
      // (a wall in a chunk not loaded yet is not gone: one come in by a teleport, or handed over by a server, waits for it)
      if (this.m.t.loaded && !this.m.t.loaded(x, z)) return;
      if (!holdsPainting(this.m.t.get(x, y, z))) { this.drop(); this.remove(); }
    }
  }
  hurt(amount, source) {
    if (this.removed) return false;
    if (this.m.mode !== 'creative' || !(source && source.player)) this.drop();
    this.remove();
    return true;
  }
  /* The item comes out 0.15 in front of the picture, as the game's hanging things drop theirs. From the picture's own
     place, a sixteenth off the wall, a quarter of the item's box was in the wall, its hop often carried it right in
     (23 breaks of 40 in a test), and it came out on top of the wall (drops.js _unstick only went up), out of sight. */
  drop() {
    const f = this.face || [0, 0, 0];
    this.m.dropItemAt(this.pos.x + f[0] * 0.15, this.pos.y + Math.min(this.h, 1) * 0.5, this.pos.z + f[2] * 0.15, 'painting', 1, false, true);
  }
  layers(out) { out.push(['painting_' + this.size + '_face', 'painting_' + this.variant, null, false, true]); }
  toJSON() { const o = super.toJSON(); o.vr = this.variant; o.fc = this.face; o.bl = this.block; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.vr && o.fc && o.bl) this.setOn(o.bl[0], o.bl[1], o.bl[2], o.fc, o.vr); }
}
Painting.MODEL = 'painting_1x1';
register('painting', Painting);
// the biggest pictures that fit on the wall at (x, y, z) facing out of face: a solid wall (or signs) behind, nothing in front
function paintingFits(m, x, y, z, face, w, h) {
  const T = m.t, rx = -face[2], rz = face[0];
  const x0 = -Math.floor((w - 1) / 2), y0 = -Math.floor((h - 1) / 2);
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
    const ax = x + rx * (x0 + i), ay = y + y0 + j, az = z + rz * (x0 + i);
    if (!holdsPainting(T.get(ax, ay, az))) return false;
    const b = T.get(ax + face[0], ay, az + face[2]);
    if (b && (SOLID[b] || FLUID[b])) return false;
  }
  // no other painting there already
  let clash = false;
  m.forNear(x + 0.5, z + 0.5, 4, e => { if (e.type === 'painting' && !e.removed && e.face && e.face[0] === face[0] && e.face[2] === face[2] && Math.abs(e.pos.y - (y + 0.5)) < (h + e.h) / 2 && Math.hypot(e.pos.x - (x + 0.5 + face[0] * 0.53), e.pos.z - (z + 0.5 + face[2] * 0.53)) < (w + 1) / 2) clash = true; });
  return !clash;
}

/* ---- the fishing rod (the wiki's Fishing, Java Edition) ----
   Cast, the bobber settles in the water and waits 100 to 600 ticks, 100
   fewer a level of Lure (drawn again while that is not above 0); then a fish
   swims in for 20 to 80 ticks and bites: 20 to 40 ticks to reel it in, or
   the wait starts again. A tick of the wait or the swim counts 2 a quarter
   of the time in the rain, and none half the time without open sky above.
   What comes up: fish 85, junk 10, treasure 5 by weight, each moved by its
   quality times the luck (the rod's Luck of the Sea): fish -1, junk -2,
   treasure +2, floor(weight + quality x luck); treasure only in open water
   (a 5 x 4 x 5 of water below and air above round the bobber). Treasure
   bows, rods and books all come enchanted at 30 levels from the random loot
   list (treasure enchantments too), the bow and rod with 0-25% of their
   durability left; junk boots and rods keep 0-90% of theirs (worn 10-100%). The catch flies to you, with an orb of 1
   to 6 experience at your feet. */
const FISH = [['cod', 60], ['salmon', 25], ['tropical_fish', 2], ['pufferfish', 13]];
const JUNK = [['lily_pad', 17], ['leather_boots', 10], ['leather', 10], ['bone', 10], ['potion', 10], ['string', 5], ['fishing_rod', 2], ['bowl', 10], ['stick', 5], ['ink_sac', 1], ['tripwire_hook', 10], ['rotten_flesh', 10], ['bamboo', 10]];
const TREASURE = [['name_tag', 1], ['saddle', 1], ['bow', 1], ['fishing_rod', 1], ['enchanted_book', 1], ['nautilus_shell', 1]];
const pickW = list => { let t = 0; for (const [, w] of list) t += w; let r = R() * t; for (const [n, w] of list) { if (r < w) return n; r -= w; } return list[0][0]; };
// the enchantments random loot may carry (the table's and the treasure ones), in the game's order
const ON_RANDOM_LOOT = ORDER.concat(['binding_curse', 'vanishing_curse', 'frost_walker', 'mending']);
const BIOME_NAMES = [];
import('../biomes.js?v=107').then(m => { for (const b of m.BIOMES) BIOME_NAMES[b.id] = b.name; }).catch(() => {});
export class FishingBobber extends Projectile {
  static W = 0.25; static H = 0.25; static MODEL = 'bobber'; static TEX = 'bobber';
  constructor(m, type) {
    super(m, type); this.gravity = 0.03; this.drag = 0.92; this.wait = 0; this.swim = 0; this.bite = 0; this.hooked = null; this.inWaterT = 0; this.lure = 0; this.luck = 0; this.stuckBlock = false;
    this.line = null;
  }
  tick() {
    const T = this.m.t, p = this.pos;
    const water = FLUID[T.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] === 1;
    if (this.hooked) {
      const h = this.hooked;
      if (h.removed || h.dead) this.hooked = null;
      else { this.prev.copy(p); p.set(h.pos.x, h.pos.y + h.h * 0.8, h.pos.z); this.age++; this.lineTick(); return; }
    }
    if (water) {
      // floating at the surface, bobbing; the wait for a bite, the fish swimming in, then a dip
      this.prev.copy(p); this.age++;
      const top = Math.floor(p.y) + 0.9;
      this.vel.x *= 0.9; this.vel.z *= 0.9;
      this.vel.y += (top - p.y) * 0.1 - this.vel.y * 0.3;
      p.add(this.vel);
      if (this.bite > 0) {
        this.vel.y -= 0.1;
        if (--this.bite === 0) { this.wait = 0; this.swim = 0; }
      } else {
        // how much this tick counts: twice now and then in the rain, not at all half the time under cover
        const bx = Math.floor(p.x), by = Math.floor(p.y) + 1, bz = Math.floor(p.z), m = this.m, W = m.sim && m.sim.weather;
        const sky = m.seesSky(bx, by, bz);
        let n = 1;
        if (sky && m.dim === 'overworld' && (W && W.rainingAt ? W.rainingAt(bx, by, bz) : m.raining()) && R() < 0.25) n = 2;
        if (!sky && R() < 0.5) n--;
        if (this.swim > 0) {
          this.swim -= n;
          if (this.swim <= 0) { this.bite = 20 + RI(21); this.m.particles('splash', p.x, p.y, p.z, 6, 0.2); }
          else if (this.age % 2 === 0) this.m.particles('bubble', p.x + (R() - 0.5) * this.swim * 0.05, p.y, p.z + (R() - 0.5) * this.swim * 0.05, 1, 0.05);
        } else if (this.wait > 0) {
          this.wait -= n;
          if (this.wait <= 0) this.swim = 20 + RI(61);
        } else this.wait = this.newWait();
      }
      this.lineTick();
      return;
    }
    if (this.stuckBlock) { this.prev.copy(p); this.lineTick(); return; }
    super.tick();
    this.lineTick();
    if (this.age > 1200) this.gone();
  }
  // 100 to 600 ticks less 100 a level of Lure (when that leaves nothing, the next tick draws again)
  newWait() { return 100 + RI(501) - this.lure * 100; }
  /* Open water: the 5 x 5 layers round the bobber's block, one below it to two above, each all
     water (still, or a waterlogged block with nothing to stand on) or all air (or lily pads),
     and no water over air. */
  openWater() {
    const T = this.m.t, x = Math.floor(this.pos.x), y = Math.floor(this.pos.y), z = Math.floor(this.pos.z);
    let above = false;
    for (let dy = -1; dy <= 2; dy++) {
      let kind = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        const b = T.get(x + dx, y + dy, z + dz), d = BLOCKS[b];
        const k = !b || (d && d.name === 'lily_pad') ? 2 : (FLUID[b] === 1 && !(T.meta(x + dx, y + dy, z + dz) & 15)) || (d && d.waterlogged && !d.solid) ? 1 : 3;
        if (k === 3 || (kind && k !== kind)) return false;
        kind = k;
      }
      if (kind === 2) above = true;
      else if (above) return false;
    }
    return true;
  }
  // what a bite brings up: a stack (enchanted and worn where the game makes it so)
  catchStack() {
    const luck = this.luck | 0, open = this.openWater();
    const wf = Math.max(0, Math.floor(85 - luck)), wj = Math.max(0, Math.floor(10 - 2 * luck)), wt = open ? Math.max(0, Math.floor(5 + 2 * luck)) : 0;
    const r = R() * (wf + wj + wt);
    const W = this.m.world, b = W && W.biomeAt ? W.biomeAt(Math.floor(this.pos.x), Math.floor(this.pos.z)) : -1;
    const jungle = /jungle/.test(BIOME_NAMES[b] || '');
    let name, ench = null, dmg = 0, count = 1;
    if (r < wf) name = pickW(FISH);
    else if (r < wf + wj) {
      name = pickW(jungle ? JUNK : JUNK.filter(e => e[0] !== 'bamboo'));
      // (set_damage uniform(0, 0.9) is the durability left: worn floor((1 - u) x max), 10% to all of it, as SetItemDamageFunction)
      if (name === 'leather_boots' || name === 'fishing_rod') dmg = Math.floor(maxDamage(I[name]) * (1 - R() * 0.9));
      if (name === 'ink_sac') count = 10;
    } else {
      name = pickW(TREASURE);
      const rng = new LegacyRandom(Math.floor(R() * 2 ** 31) * 4096 + RI(4096));
      // (26.1.2's fishing/treasure: enchant_with_levels 30 for the bow, the rod and the book alike, from #on_random_loot)
      if (name === 'bow' || name === 'fishing_rod') {
        ench = enchanted(I[name], 30, rng, false);
        dmg = Math.floor(maxDamage(I[name]) * (0.75 + R() * 0.25));
      } else if (name === 'enchanted_book') ench = enchanted(I.book, 30, rng, true);
    }
    const st = { id: I[name], count };
    if (ench && Object.keys(ench).length) st.ench = ench;
    if (dmg > 0) st.dmg = Math.min(dmg, maxDamage(st.id) - 1);
    return st;
  }
  hitEntity(e) {
    if (e.isPlayer || this.grapple) return false;
    // the old combat (Leon Network's, as Hypixel plays): the hook hits another player for nothing but a knock and a
    // flinch, as a snowball does, then holds on (the "rod" of the old fights)
    if (e.remotePlayer && this.m.combat && this.m.combat.legacy && e.hurt) e.hurt(0.0001, { type: 'thrown', attacker: this.owner, direct: this, x: this.pos.x - this.vel.x, z: this.pos.z - this.vel.z });
    this.hooked = e; this.vel.set(0, 0, 0); return true;
  }
  hitBlock() { this.stuckBlock = true; this.vel.set(0, 0, 0); }
  // reeling in: a fish if one is biting, the hooked mob pulled, else nothing; the rod's wear
  reel() {
    const m = this.m, P = m.P, p = this.pos;
    let wear = 0;
    if (this.hooked) {
      const h = this.hooked, dx = P.pos.x - h.pos.x, dy = P.pos.y - h.pos.y, dz = P.pos.z - h.pos.z;
      // another player: the game's pull on an entity, a tenth of the way to you, sent to their machine
      if (h.remotePlayer) h.push(dx * 0.1, dy * 0.1, dz * 0.1);
      else if (h.vel) { h.vel.x += dx * 0.1; h.vel.y += dy * 0.1 + Math.sqrt(Math.hypot(dx, dy, dz)) * 0.08; h.vel.z += dz * 0.1; }
      wear = 5;
    } else if (this.bite > 0) {
      // what was caught comes out of the water at the bobber and flies to you
      const st = this.catchStack(), dx = P.pos.x - p.x, dy = P.pos.y - p.y, dz = P.pos.z - p.z;
      m.dropItemAt(p.x, p.y, p.z, ITEMS[st.id].name, st.count, false, true,
        { stack: st, delay: 0, vel: [dx * 0.1, dy * 0.1 + Math.sqrt(Math.sqrt(dx * dx + dy * dy + dz * dz)) * 0.08, dz * 0.1] });
      m.xpAt(P.pos.x, P.pos.y + 0.5, P.pos.z + 0.5, 1 + RI(6));
      wear = 1;
    } else if (this.stuckBlock) wear = 2;
    this.gone();
    return wear;
  }
  gone() { this.remove(); if (this.line) { if (this.line.parent) this.line.parent.remove(this.line); this.line.geometry.dispose(); this.line = null; } if (this.m.bobber === this) this.m.bobber = null; }
  // the line: from the rod's tip (in front of the hand that holds it: the right, or the left with the rod in the off hand) to the bobber
  lineTick() {
    const m = this.m, P = m.P;
    if (!this.line) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 9), 3));
      this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
      this.line.frustumCulled = false;
      if (m.group) m.group.add(this.line);
    }
    // too far, or no rod left in either hand: in it comes (the game's shouldStopFishing looks at both hands)
    const inMain = m.heldName() === 'fishing_rod';
    if (P && (this.dist2(P.pos.x, P.pos.y, P.pos.z) > 32 * 32 || !(inMain || m.offhandName() === 'fishing_rod'))) { this.gone(); return; }
    const a = this.line.geometry.attributes.position.array, s = Math.sin(P.yaw), c = Math.cos(P.yaw), side = inMain ? 1 : -1;
    // (the view's right is (cos yaw, -sin yaw))
    const hx = P.pos.x + c * 0.35 * side - s * 0.8, hy = P.pos.y + 1.62 + 0.25, hz = P.pos.z - s * 0.35 * side - c * 0.8;
    for (let i = 0; i < 9; i++) {
      const t = i / 8, sag = Math.sin(t * PI) * 0.3;
      a[i * 3] = hx + (this.pos.x - hx) * t; a[i * 3 + 1] = hy + (this.pos.y + 0.1 - hy) * t - sag; a[i * 3 + 2] = hz + (this.pos.z - hz) * t;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
  remove() { super.remove(); if (this.line && this.line.parent) { this.line.parent.remove(this.line); this.line.geometry.dispose(); this.line = null; } }
}
register('fishing_bobber', FishingBobber);
// enchanted at a level as the table would (a book takes any of the list, an item its primary ones)
function enchanted(id, level, rng, book) {
  const out = {}, set = new Set(ON_RANDOM_LOOT);
  for (const [n, l] of selectEnchants(id, level, rng, (k, it) => set.has(k) && !!ENCH[k] && (book || isPrimary(k, it)), ON_RANDOM_LOOT)) out[n] = l;
  return out;
}
model('bobber', [{ name: 'b', pivot: [0, 24, 0], boxes: [[-1.5, -3, -1.5, 3, 3, 3, 0, 0], [-0.5, -5, -0.5, 1, 2, 1, 12, 0]] }]);
addArt('bobber', [64, 32], p => { p.box(0, 0, 3, 3, 3, { all: 0xd83030, bottom: 0xf0f0f0 }, 0.05); p.fill(0, 4, 12, 2, 0xf0f0f0); p.box(12, 0, 1, 2, 1, 0x3a3a3a, 0.05); });

/* ---- the right click ---- */
const enchOf = (st, k) => (st && st.ench && st.ench[k]) || 0;
export function useExtra(m, name, target, take, build) {
  const P = m.P, eye = m.lookEye, dir = m.lookDir;
  if (!eye || !dir) return false;
  const throwIt = (type, speed, up) => {
    const e = m.spawn(type, eye.x, eye.y - 0.1, eye.z, { natural: false });
    if (!e) return null;
    e.owner = m.player;
    if (up) { const yaw = P.yaw, c = Math.cos(P.pitch); e.shoot(-Math.sin(yaw) * c, Math.sin(P.pitch + up * DEG), -Math.cos(yaw) * c, speed, 1); }
    else e.shoot(dir.x, dir.y, dir.z, speed, 1);
    e.vel.x += P.vel.x; e.vel.z += P.vel.z; if (!P.onGround) e.vel.y += P.vel.y;
    return e;
  };
  if (name === 'ender_pearl') {
    if (onCooldown(name)) return true;
    if (throwIt('ender_pearl', 1.5, 0)) { take(); addCooldown(name, 20); }
    return true;
  }
  if (name === 'experience_bottle') { if (throwIt('experience_bottle', 0.7, 20)) take(); return true; }
  if (name === 'wind_charge') {
    if (onCooldown(name)) return true;
    if (throwIt('wind_charge', 1.5, 0)) { take(); addCooldown(name, 10); }
    return true;
  }
  if (name === 'blue_egg' || name === 'brown_egg') { if (throwIt('egg', 1.5, 0)) take(); return true; }
  if (name === 'firework_rocket') {
    const st = m.inv && m.inv.slots[m.inv.selected];
    if (P.gliding) {
      const e = m.spawn('firework_rocket', P.pos.x, P.pos.y + 0.5, P.pos.z, { natural: false });
      if (e) { e.init(st); e.boosting = true; take(); }
      return true;
    }
    if (!target || !target.face || !build) return false;
    const f = target.face, x = target.hit ? target.hit[0] : target.x + 0.5 + f[0] * 0.5, y = target.hit ? target.hit[1] : target.y + 0.5 + f[1] * 0.5, z = target.hit ? target.hit[2] : target.z + 0.5 + f[2] * 0.5;
    const e = m.spawn('firework_rocket', x + f[0] * 0.15, y + f[1] * 0.15, z + f[2] * 0.15, { natural: false });
    if (e) { e.init(st); take(); }
    return true;
  }
  if (name === 'armor_stand') {
    if (!target || !target.face || !build) return false;
    const f = target.face, x = target.x + f[0], y = target.y + f[1], z = target.z + f[2], T = m.t;
    if (T.solid(x, y, z) || T.solid(x, y + 1, z)) return false;
    const e = m.spawn('armor_stand', x + 0.5, y, z + 0.5, { natural: false });
    if (e) {
      // facing you, to the nearest eighth of a turn
      const yaw = Math.round((P.yaw + PI) / (PI / 4)) * (PI / 4);
      e.yaw = e.prevYaw = e.bodyYaw = e.prevBodyYaw = e.headYaw = e.prevHeadYaw = yaw;
      e.persistent = true;
      take();
    }
    return true;
  }
  if (name === 'painting') {
    if (!target || !target.face || !build || target.face[1] !== 0) return false;
    const f = target.face, st = m.inv && m.inv.slots[m.inv.selected];
    // one picture of its own (from the creative tabs): there, if it fits
    const own = st && st.variant && PAINTINGS.find(v => v[0] === st.variant);
    if (own) {
      if (!paintingFits(m, target.x, target.y, target.z, f, own[1], own[2])) return false;
      const e = m.spawn('painting', target.x, target.y, target.z, { natural: false });
      if (e) { e.setOn(target.x, target.y, target.z, f, own[0]); e.persistent = true; take(); }
      return true;
    }
    // the largest pictures that fit, one of them at random
    let best = 0, fits = [];
    for (const v of PAINTINGS) {
      const area = v[1] * v[2];
      if (area < best) continue;
      if (!paintingFits(m, target.x, target.y, target.z, f, v[1], v[2])) continue;
      if (area > best) { best = area; fits = []; }
      fits.push(v);
    }
    if (!fits.length) return false;
    const v = fits[RI(fits.length)];
    const e = m.spawn('painting', target.x, target.y, target.z, { natural: false });
    if (e) { e.setOn(target.x, target.y, target.z, f, v[0]); e.persistent = true; take(); }
    return true;
  }
  if (name === 'fishing_rod') {
    const st = m.inv && m.inv.slots[m.inv.selected];
    if (m.bobber && !m.bobber.removed) {
      const wear = m.bobber.reel();
      if (wear && m.mode !== 'creative') m.damageHeld(wear);
      m.bobber = null;
      return true;
    }
    const b = throwIt('fishing_bobber', 0.6 + R() * 0.2, 0);
    // the luck: Luck of the Sea, and a level for each of Luck (less Bad Luck) on the player
    const fx = m.survival && m.survival.effects, lv = n => (fx && fx[n] ? fx[n].level || 1 : 0);
    if (b) { b.lure = enchOf(st, 'lure'); b.luck = enchOf(st, 'luck_of_the_sea') + lv('luck') - lv('unluck'); m.bobber = b; }
    return true;
  }
  if (name === 'brush') return brushAt(m, target);
  // a knowledge book teaches its recipes (every recipe is known here already) and is used up
  if (name === 'knowledge_book') { take(); return true; }
  return false;
}

/* ---- the brush: held on suspicious sand or gravel, a stroke every half
   second; ten strokes and what was buried comes out of the face brushed,
   the block is plain sand or gravel, and the brush takes a point of wear.
   Left alone for two seconds the strokes start again. What it finds is the
   block's own archaeology table, rolled from its loot seed (the structure
   that laid it says which: struct/spawners.js findAt); one with no table
   (placed from the creative inventory) holds nothing, as in the game. ---- */
function brushAt(m, t) {
  if (!t || !t.face) return false;
  const b = m.t.get(t.x, t.y, t.z), n = BLOCKS[b] && BLOCKS[b].name;
  if (n !== 'suspicious_sand' && n !== 'suspicious_gravel') return false;
  const k = t.x + ',' + t.y + ',' + t.z, br = m.brushing;
  if (!br || br.k !== k || m.age - br.last > 40) m.brushing = { k, n: 0, last: m.age };
  const s = m.brushing;
  if (m.age - s.last >= 10 || s.n === 0) {
    s.last = m.age; s.n++;
    const sand = n === 'suspicious_sand';
    m.particles('poof', t.x + 0.5 + t.face[0] * 0.55, t.y + 0.5 + t.face[1] * 0.55, t.z + 0.5 + t.face[2] * 0.55, 4, 0.2, sand ? [0.86, 0.8, 0.6] : [0.55, 0.52, 0.5]);
    if (s.n >= 10) {
      // the find, in the block next to the face brushed, lying still
      const S = typeof window !== 'undefined' && window.__lc2 && window.__lc2.structures, H = m.hooks.hands;
      const fx = t.x + t.face[0] + 0.5, fy = t.y + t.face[1] + 0.625, fz = t.z + t.face[2] + 0.5;
      if (S && S.findAt) S.findAt(t.x, t.y, t.z).then(e => {
        const st = e && lootStack(e);
        if (st && H && H.drops) H.drops.spawn(fx, fy, fz, st, { vel: [0, 0, 0] });
      }, () => {});
      m.world.set(t.x, t.y, t.z, sand ? B.sand : B.gravel, 0);
      if (m.mode !== 'creative') m.damageHeld(1);
      m.brushing = null;
    }
  }
  return true;
}

/* ---- leads: a mob on one follows you (pulled along past 6 blocks, the lead
   snapping past 10); right click a fence and the mobs you lead are tied to
   a knot on it; right click a led mob to let it go. Kept with the mob when
   the world is saved. ---- */
const FENCE = b => !!(BLOCKS[b] && BLOCKS[b].shape === 'fence');
const NOT_LEASHED = /^(villager|wandering_trader|bat|cod|salmon|tropical_fish|pufferfish|tadpole|wither|ender_dragon|armor_stand|evoker_fangs|painting|leash_knot|shulker|warden|creaking|elder_guardian|guardian|ghast|vex|phantom|breeze)$/;
const leashable = e => e instanceof Living && !e.constructor.HOSTILE && !NOT_LEASHED.test(e.type) && !e.dead;
// what the lead pulls towards: the player, or the knot on a fence
function holderPos(m, e) {
  const L = e.leash;
  if (L.knot) return { x: L.knot[0] + 0.5, y: L.knot[1] + 0.6, z: L.knot[2] + 0.5 };
  const P = m.P;
  return { x: P.pos.x, y: P.pos.y + 1.0, z: P.pos.z };
}
function unleash(m, e, drop) {
  if (!e.leash) return;
  const knot = e.leash.knot;
  e.leash = null;
  if (drop) m.dropAt(e, 'lead', 1);
  dropLine(e);
  if (knot) cleanKnots(m);
}
function dropLine(e) { if (e.leashLine) { if (e.leashLine.parent) e.leashLine.parent.remove(e.leashLine); e.leashLine.geometry.dispose(); e.leashLine = null; } }
// the knots: one entity on each fence something is tied to, gone when nothing is
function cleanKnots(m) {
  for (const k of m.list) if (k.type === 'leash_knot' && !k.removed && !m.list.some(e => e.leash && e.leash.knot && e.leash.knot.join(',') === k.at)) k.remove();
}
function ensureKnot(m, at) {
  const key = at.join(',');
  if (m.list.some(k => k.type === 'leash_knot' && !k.removed && k.at === key)) return;
  const k = m.spawn('leash_knot', at[0] + 0.5, at[1] + 0.375, at[2] + 0.5, { natural: false });
  if (k) k.at = key;
}
// a right click on a mob: a lead put on or taken off, a name tag's name given (true when it took the click)
export function leashInteract(m, e, held) {
  if (e.leash) { unleash(m, e, m.mode !== 'creative'); return true; }
  if (held === 'lead' && leashable(e)) {
    e.leash = { player: true }; e.persistent = true;
    if (m.mode !== 'creative' && m.inv) m.inv.takeSelected(1);
    return true;
  }
  if (held === 'name_tag') {
    const st = m.inv && m.inv.slots[m.inv.selected];
    // only a tag renamed on an anvil names anything
    if (!st || !st.name || !(e instanceof Living) || e.isPlayer) return false;
    e.customName = st.name; e.persistent = true;
    if (m.mode !== 'creative') m.inv.takeSelected(1);
    return true;
  }
  return false;
}
// a right click on a fence: what you lead is tied there (true when anything was)
export function tieToFence(m, t) {
  if (!t || !FENCE(t.b)) return false;
  let any = false;
  for (const e of m.list) if (e.leash && e.leash.player && !e.removed) { e.leash = { knot: [t.x, t.y, t.z] }; any = true; }
  if (any) ensureKnot(m, [t.x, t.y, t.z]);
  return any;
}
// each tick, for a led mob
export function leashTick(m, e) {
  const L = e.leash;
  if (e.dead || e.removed) { unleash(m, e, !e.removed || e.dead); return; }
  if (L.knot && !FENCE(m.t.get(L.knot[0], L.knot[1], L.knot[2]))) { unleash(m, e, true); return; }
  if (L.player && !m.player.alive()) { unleash(m, e, true); return; }
  if (L.knot) ensureKnot(m, L.knot);
  const h = holderPos(m, e), dx = h.x - e.pos.x, dy = h.y - (e.pos.y + e.h * 0.6), dz = h.z - e.pos.z, d = Math.hypot(dx, dy, dz);
  if (d > 10) { unleash(m, e, true); return; }
  if (d > 6) {
    const k = Math.min(0.4, (d - 6) * 0.1);
    e.vel.x += dx / d * k; e.vel.z += dz / d * k; if (dy > 0) e.vel.y += dy / d * k * 0.5;
  }
  if (d > 4 && e.nav && (e.nav.isDone() || m.age % 10 === 0)) e.nav.moveTo(h.x, h.y - 1, h.z, 1, 2);
  // the line, from the mob's neck to the hand or the knot
  if (!e.leashLine) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 12), 3));
    e.leashLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x6a4a2a }));
    e.leashLine.frustumCulled = false;
    if (m.group) m.group.add(e.leashLine);
  }
  const a = e.leashLine.geometry.attributes.position.array, sx = e.pos.x, sy = e.pos.y + e.h * 0.8, sz = e.pos.z;
  let hx = h.x, hy = h.y, hz = h.z;
  if (L.player) { const P = m.P, s = Math.sin(P.yaw), c = Math.cos(P.yaw); hx = P.pos.x - c * 0.35 - s * 0.5; hy = P.pos.y + 1.1; hz = P.pos.z + s * 0.35 - c * 0.5; }
  for (let i = 0; i < 12; i++) {
    const t = i / 11, sag = Math.sin(t * PI) * Math.max(0, 0.6 - d * 0.05);
    a[i * 3] = sx + (hx - sx) * t; a[i * 3 + 1] = sy + (hy - sy) * t - sag; a[i * 3 + 2] = sz + (hz - sz) * t;
  }
  e.leashLine.geometry.attributes.position.needsUpdate = true;
}
// the knot on a fence post
export class LeashKnot extends Entity {
  static W = 0.375; static H = 0.5; static MODEL = 'leash_knot'; static TEX = 'leash_knot'; static NO_PUSH = true; static SHADOW = 0;
  constructor(m, type) { super(m, type); this.gravity = 0; this.at = ''; }
  tick() { this.prev.copy(this.pos); this.age++; if (this.age % 40 === 0) cleanKnots(this.m); }
  // hit: everything tied here is let go
  hurt() { for (const e of this.m.list) if (e.leash && e.leash.knot && e.leash.knot.join(',') === this.at) unleash(this.m, e, this.m.mode !== 'creative'); this.remove(); return true; }
  toJSON() { const o = super.toJSON(); o.at = this.at; return o; }
  fromJSON(o) { super.fromJSON(o); this.at = o.at || ''; }
}
register('leash_knot', LeashKnot);
model('leash_knot', [{ name: 'knot', pivot: [0, 24, 0], boxes: [[-3, -8, -3, 6, 8, 6, 0, 0]] }]);
addArt('leash_knot', [64, 32], p => { p.box(0, 0, 6, 8, 6, 0x8a6a40, 0.12); p.speckle(0, 0, 24, 14, 0x5a4428, 0.25); });
// a lead kept with the mob in the save: Living's own toJSON and fromJSON, wrapped
{
  const tj = Living.prototype.toJSON, fj = Living.prototype.fromJSON;
  Living.prototype.toJSON = function () { const o = tj.call(this); if (this.leash) o.lsh = this.leash.knot ? this.leash.knot : 1; return o; };
  Living.prototype.fromJSON = function (o) { fj.call(this, o); if (o.lsh) this.leash = Array.isArray(o.lsh) ? { knot: o.lsh } : { player: true }; };
}

/* ---- a named mob's name, over its head while you look at it (the game's
   nameplate: white on a dark band), drawn on the GUI ---- */
const projV = new THREE.Vector3();
export function nameplates(mgr) {
  const H = mgr.hooks.hands, gui = H && H.gui;
  if (!gui) return;
  // one overlay on the GUI, pointed at the mobs of the dimension being played
  if (gui.nameplates) { gui.nameplates.m = mgr; return; }
  const ov = gui.nameplates = {
    m: mgr,
    get animates() { const m = this.m, e = m.inter && m.inter.entityTarget; return !!(e && e.customName); },
    draw(g) {
      const m = this.m, e = m.inter && m.inter.entityTarget, cam = m.R && m.R.camera;
      if (!e || !e.customName || !cam || g.screen || m.gone) return;
      projV.set(e.pos.x, e.pos.y + e.h + 0.5, e.pos.z).project(cam);
      if (projV.z > 1) return;
      const x = Math.round((projV.x + 1) / 2 * g.width), y = Math.round((1 - projV.y) / 2 * g.height);
      const t = e.customName, w = g.textWidth(t);
      g.fill(x - Math.ceil(w / 2) - 1, y - 1, x + Math.ceil(w / 2) + 1, y + 8, 0x40000000);
      g.text(t, x - Math.floor(w / 2), y, 0xFFFFFF, false);
    },
  };
  gui.overlays.push(ov);
}
