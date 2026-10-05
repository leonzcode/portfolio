/* ---------------------------------------------------------------------------
   Leoncraft 2 - falling sand, gravel (and anything else marked "falls").

   As in the game, a block that falls only does so when something changes
   next to it: when the block under it goes (or it is placed over a gap) it
   waits two ticks, then becomes an entity that falls 0.04 a tick with 0.98
   drag. Where it lands it becomes a block again, if the space is free (air,
   water, a plant); on a torch, a slab or anything else that is in the way it
   breaks and drops itself.

   Drawn with the world's own block shader and textures (render/blockmesh.js),
   lit by the light where it is.
--------------------------------------------------------------------------- */
import { Entity } from './entity.js?v=15';
import { register } from './mobs.js?v=15';
import { BLOCKS, FLUID, B } from '../blocks.js?v=15';
import { blockGeometry } from '../render/blockmesh.js?v=15';
const THREE = window.THREE;

export const FALLS = new Uint8Array(4096);
for (const d of BLOCKS) if (d && (d.falls || /(_concrete_powder|^anvil|^chipped_anvil|^damaged_anvil|^dragon_egg|^suspicious_(sand|gravel)|^pointed_dripstone)$/.test(d.name))) FALLS[d.id] = 1;
// can a falling block fall into (or land in) this?
export function free(b) {
  if (!b) return true;
  const d = BLOCKS[b];
  return !!(FLUID[b] || d.replaceable || d.name === 'fire' || d.name === 'soul_fire');
}

export class FallingBlock extends Entity {
  static W = 0.98; static H = 0.98; static STEP = 0; static NOT_PICKABLE = true; static NO_PUSH = true; static BLOCK = true;
  constructor(m, type) { super(m, type); this.block = B.sand; this.meta = 0; this.time = 0; this.gravity = 0.04; this.mesh = null; }
  tick() {
    this.baseTick();
    const v = this.vel;
    this.time++;
    v.y -= this.gravity;
    this.move(v.x, v.y, v.z);
    v.multiplyScalar(0.98);
    if (this.onGround || this.time > 600) {
      const T = this.m.t, x = Math.floor(this.pos.x), y = Math.floor(this.pos.y + 0.5), z = Math.floor(this.pos.z);
      const here = T.get(x, y, z);
      if (this.time <= 600 && free(here) && !free(T.get(x, y - 1, z))) {
        this.m.world.set(x, y, z, this.block, this.meta);
        if (this.m.fluids) this.m.fluids.around(x, y, z);
      } else this.m.dropItemAt(this.pos.x, this.pos.y + 0.5, this.pos.z, BLOCKS[this.block].name, 1, true, false);
      this.remove();
    }
  }
  remove() { super.remove(); if (this.mesh) { this.mesh.parent && this.mesh.parent.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } }
  // its own mesh in the world's scene (there are only ever a few)
  draw(group, R, a) {
    if (!this.mesh) {
      const d = BLOCKS[this.block];
      const { geometry, cutout } = blockGeometry(d, this.meta);
      this.mesh = new THREE.Mesh(geometry, cutout ? R.mats.cutout : R.mats.opaque);
      this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false;
      group.add(this.mesh);
      this.lv = -1;
    }
    const x = this.prev.x + (this.pos.x - this.prev.x) * a, y = this.prev.y + (this.pos.y - this.prev.y) * a, z = this.prev.z + (this.pos.z - this.prev.z) * a;
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
  toJSON() { const o = super.toJSON(); o.b = BLOCKS[this.block].name; o.m = this.meta; return o; }
  fromJSON(o) { super.fromJSON(o); this.block = B[o.b] || B.sand; this.meta = o.m || 0; }
}
register('falling_block', FallingBlock);
