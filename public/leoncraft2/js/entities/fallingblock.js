/* ---------------------------------------------------------------------------
   Leoncraft 2 - falling blocks: sand, red sand, gravel, concrete powder,
   anvils, the dragon egg, suspicious sand and gravel, pointed dripstone
   hanging from nothing, scaffolding too far from its support.

   The game's FallingBlockEntity, tick by tick (sim/bodies.js decides when a
   block starts to fall, as the game's scheduled ticks do):
     - it starts at the block's centre, its feet on the block's floor, still;
       the cell it left becomes air (or water, for a waterlogged plant)
     - each tick: 0.04 down, the move (with the world's collision), then all
       of its speed kept at 0.98
     - concrete powder stops in the first water it reaches (falling faster
       than a block a tick it looks along the path for a water source) and
       sets there as concrete
     - once on the ground, in the block its feet are in: placed there when
       that cell can be replaced (air, water, lava, fire, grass, one layer of
       snow) and the block could stand there and has something under it;
       otherwise it breaks and drops as its item (so sand on a torch or a
       slab drops), or as nothing for suspicious sand and gravel
     - 600 ticks without landing, or 100 out below or above the world: it
       drops as its item and is gone
     - over chunks that are not loaded it waits where it is (the game's
       entities do not tick there; there is no instant fall in the game any
       more, nor here)
   Anvils and pointed dripstone hurt what they land on: a block of fall past
   the first is 2 points for an anvil (40 at most) and the dripstone's own
   count for dripstone, to everything but players in creative; an anvil that
   hurt something is chipped one step at a 5% chance and 5% more a block
   (a damaged anvil breaks instead).

   Drawn with the world's own block shader and textures (render/blockmesh.js),
   lit by the light where it is, in whichever look the game is in.
--------------------------------------------------------------------------- */
import { Entity } from './entity.js?v=107';
import { register } from './mobs.js?v=107';
import { BLOCKS, FLUID, B } from '../blocks.js?v=107';
import { blockGeometry } from '../render/blockmesh.js?v=107';
const THREE = window.THREE;

// blocks that fall as sand does (blocks.js and blockdata.js mark them)
export const FALLS = new Uint8Array(4096);
for (const d of BLOCKS) if (d && (d.falls || /(_concrete_powder|^anvil|^chipped_anvil|^damaged_anvil|^dragon_egg|^suspicious_(sand|gravel))$/.test(d.name))) FALLS[d.id] = 1;
const ANVIL_NEXT = {};
for (const [a, b] of [['anvil', 'chipped_anvil'], ['chipped_anvil', 'damaged_anvil'], ['damaged_anvil', null]]) if (B[a] !== undefined) ANVIL_NEXT[B[a]] = b ? B[b] : 0;
const CONCRETE = {};
for (const d of BLOCKS) if (d && /_concrete_powder$/.test(d.name) && B[d.name.replace(/_powder$/, '')] !== undefined) CONCRETE[d.id] = B[d.name.replace(/_powder$/, '')];
const SUSPICIOUS = new Set(['suspicious_sand', 'suspicious_gravel'].map(n => B[n]).filter(v => v !== undefined));

// the game's FallingBlock.isFree: something a falling block falls through (air, fire, any fluid, anything replaceable)
export function free(b) {
  if (!b) return true;
  const d = BLOCKS[b];
  return !!(FLUID[b] || d.replaceable || d.name === 'fire' || d.name === 'soul_fire');
}
// can it come to rest in this cell (canBeReplaced with nothing in the hand: snow only as a single layer)?
function replaceable(b, m) {
  if (!b) return true;
  const d = BLOCKS[b];
  if (d.name === 'snow') return (m & 7) === 0;
  return !!(FLUID[b] || d.replaceable);
}
// the game's concrete powder: does it set here (in water, or with water beside or above it)?
export function touchesWater(world, x, y, z) {
  if (FLUID[world.get(x, y, z)] === 1) return true;
  for (const [dx, dy, dz] of [[0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]]) if (FLUID[world.get(x + dx, y + dy, z + dz)] === 1) return true;
  return false;
}
export const concreteOf = b => CONCRETE[b] || 0;

export class FallingBlock extends Entity {
  static W = 0.98; static H = 0.98; static STEP = 0; static NOT_PICKABLE = true; static NO_PUSH = true; static BLOCK = true;
  constructor(m, type) {
    super(m, type);
    this.block = B.sand; this.meta = 0; this.time = 0; this.gravity = 0.04; this.mesh = null;
    this.dropItem = true;            // breaks into its item where it cannot stand
    this.cancelDrop = false;         // gone with nothing when it lands (an anvil worn past damaged, suspicious sand)
    this.hurtsEntities = false; this.perBlock = 0; this.maxDamage = 40;
    this.damageType = 'falling_block';
  }
  // the falling block for a block leaving (x, y, z) (the cell is the caller's to clear)
  setBlock(b, meta) {
    this.block = b; this.meta = meta || 0;
    const d = BLOCKS[b], n = d ? d.name : '';
    if (/anvil$/.test(n)) { this.hurtsEntities = true; this.perBlock = 2; this.maxDamage = 40; this.damageType = 'falling_anvil'; }
    if (SUSPICIOUS.has(b)) this.cancelDrop = true;
    return this;
  }
  tick() {
    // over ground not loaded (yet, or any more) it waits, as the game's entities do in chunks that are not ticking
    const W = this.m.world;
    if (W.loaded && !W.loaded(this.pos.x, this.pos.z)) { this.prev.copy(this.pos); return; }
    this.baseTick();
    if (!this.block) { this.remove(); return; }
    const v = this.vel, T = this.m.t;
    this.time++;
    v.y -= this.gravity;
    const fromY = this.pos.y;
    this.move(v.x, v.y, v.z);
    // the light where it is now, every tick (it moves too fast for the mobs' every fourth)
    if (this.m.sampleLight) this.m.sampleLight(this);
    let bx = Math.floor(this.pos.x), by = Math.floor(this.pos.y), bz = Math.floor(this.pos.z);
    const concrete = !!CONCRETE[this.block];
    let wet = concrete && FLUID[T.get(bx, by, bz)] === 1;
    // concrete powder falling fast: the first water source along the way stops it there
    if (concrete && !wet && v.lengthSq() > 1) {
      for (let y = Math.floor(fromY); y >= by; y--) if (FLUID[T.get(bx, y, bz)] === 1 && (T.meta(bx, y, bz) & 15) === 0) { by = y; wet = true; break; }
    }
    if (this.onGround || wet) {
      const here = T.get(bx, by, bz), hm = T.meta(bx, by, bz);
      v.x *= 0.7; v.y *= -0.5; v.z *= 0.7;
      if (here === B.moving_piston) { v.multiplyScalar(0.98); return; }
      this.remove();
      if (this.cancelDrop) { this.brokeAfterFall(bx, by, bz); return; }
      const fits = replaceable(here, hm);
      const nothingUnder = free(T.get(bx, by - 1, bz)) && !(concrete && wet);
      if (fits && this.survives(bx, by, bz) && !nothingUnder && by >= 0) {
        this.land(bx, by, bz, here);
        return;
      }
      if (this.dropItem) { this.brokeAfterFall(bx, by, bz); this.dropSelf(); }
      return;
    }
    if ((this.time > 100 && (by < 0 || by >= 384)) || this.time > 600) {
      if (this.dropItem) this.dropSelf();
      this.remove();
      return;
    }
    v.multiplyScalar(0.98);
  }
  // could it stand here? (pointed dripstone pointing down needs something to hang from; scaffolding its support)
  survives(x, y, z) {
    const d = BLOCKS[this.block], T = this.m.t;
    if (d.name === 'pointed_dripstone' && (this.meta & 7) === 5) { const a = T.get(x, y + 1, z); return !!a && (BLOCKS[a].solid || a === this.block); }
    if (d.name === 'scaffolding') { const S = this.m.inter && this.m.inter.sim; return !!(S && S.scaffoldDistance && S.scaffoldDistance(x, y, z) < 7); }
    return true;
  }
  // it comes to rest as the block (concrete powder that touches water sets as concrete)
  land(x, y, z, was) {
    const w = this.m.world, T = this.m.t;
    let b = this.block;
    if (CONCRETE[b] && touchesWater(T, x, y, z)) b = CONCRETE[b];
    // a plant or a single snow layer it lands in is crushed (and drops nothing, as in the game)
    if (!w.set(x, y, z, b, this.meta) && w.get(x, y, z) !== b) { if (this.dropItem) this.dropSelf(); return; }
    if (this.m.fluids && FLUID[was]) this.m.fluids.around(x, y, z);
  }
  // its item, where it is (none for suspicious sand and gravel)
  dropSelf() {
    const d = BLOCKS[this.block];
    if (!d || SUSPICIOUS.has(this.block)) return;
    this.m.dropItemAt(this.pos.x, this.pos.y, this.pos.z, d.name, 1, true, false);
  }
  // broken where it landed: the block's crumbs
  brokeAfterFall(x, y, z) {
    const R = this.m.R, P = R && R.particles;
    if (P && P.blockBreak) try { P.blockBreak(x, y, z, this.block, null); } catch (e) { /* no crumbs */ }
  }
  /* The game's causeFallDamage: anvils and dripstone hurt what they land on
     (a block of fall past the first counts), and an anvil may chip. */
  landed(dist) {
    if (!this.hurtsEntities) return;
    const i = Math.ceil(dist - 1);
    if (i < 0) return;
    const f = Math.min(Math.floor(i * this.perBlock), this.maxDamage);
    const p = this.pos, hw = this.hw, x0 = p.x - hw, x1 = p.x + hw, y0 = p.y, y1 = p.y + this.h, z0 = p.z - hw, z1 = p.z + hw;
    const touches = e => {
      const ew = e.hw !== undefined ? e.hw : (e.w || 0.6) / 2, eh = e.h || 1.8, q = e.pos;
      return q.x + ew > x0 && q.x - ew < x1 && q.z + ew > z0 && q.z - ew < z1 && q.y + eh > y0 && q.y < y1;
    };
    if (f > 0) {
      const src = { type: this.damageType, direct: this };
      this.m.forNear(p.x, p.z, 2, e => { if (e !== this && !e.removed && !e.dead && e.maxHealth && touches(e)) e.hurt(f, src); });
      const P = this.m.player;
      if (P && P.alive() && !P.creative() && touches(P)) P.hurt(f, src);
    }
    if (ANVIL_NEXT[this.block] !== undefined && f > 0 && Math.random() < 0.05 + i * 0.05) {
      const next = ANVIL_NEXT[this.block];
      if (next) this.block = next; else this.cancelDrop = true;
      this.dropMesh();
    }
  }
  remove() { super.remove(); this.dropMesh(); }
  dropMesh() { if (this.mesh) { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } }
  // its own mesh in the world's scene (there are only ever a few)
  draw(group, R, a) {
    // the look changed (Shaders on or off): made again with the new materials
    if (this.mesh && this.mats !== R.mats) this.dropMesh();
    if (!this.mesh) {
      const d = BLOCKS[this.block];
      if (!d) return;
      const { geometry, cutout } = blockGeometry(d, this.meta);
      this.mats = R.mats;
      this.mesh = new THREE.Mesh(geometry, cutout ? R.mats.cutout : R.mats.opaque);
      this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
      group.add(this.mesh);
      this.lv = -1;
    }
    const x = this.prev.x + (this.pos.x - this.prev.x) * a, y = this.prev.y + (this.pos.y - this.prev.y) * a, z = this.prev.z + (this.pos.z - this.prev.z) * a;
    // (blockmesh.js centres the block on its origin, lifted by one)
    this.mesh.matrix.makeTranslation(x, y - 0.5, z);
    this.mesh.matrixWorldNeedsUpdate = true;
    // the light where it is, into its vertices when it changes
    const lv = (Math.round(this.lS * 255) << 8) | Math.round(this.lB * 255);
    if (lv !== this.lv) {
      this.lv = lv;
      const L = this.mesh.geometry.attributes.aL;
      for (let i = 0; i < L.count; i++) { L.array[i * 4] = lv >> 8; L.array[i * 4 + 1] = lv & 255; }
      L.needsUpdate = true;
    }
  }
  toJSON() { const o = super.toJSON(); o.b = BLOCKS[this.block].name; o.m = this.meta; o.ti = this.time; if (this.cancelDrop) o.cd = 1; return o; }
  fromJSON(o) { super.fromJSON(o); this.setBlock(B[o.b] || B.sand, o.m || 0); this.time = o.ti | 0; if (o.cd) this.cancelDrop = true; }
}
register('falling_block', FallingBlock);

/* A block at (x, y, z) starting to fall (the game's FallingBlockEntity.fall):
   the entity at the block's centre, the cell left as air (or water where a
   waterlogged block was). Returns the entity, or null without mobs. */
export function fallFrom(m, x, y, z, b, meta) {
  if (!m || !m.spawn) return null;
  const w = m.world, d = BLOCKS[b];
  w.set(x, y, z, d && d.waterlogged ? B.water : 0, 0);
  if (m.fluids) m.fluids.around(x, y, z);
  const e = m.spawn('falling_block', x + 0.5, y, z + 0.5, { natural: false });
  if (!e) return null;
  e.setBlock(b, meta);
  e.persistent = true;
  return e;
}
