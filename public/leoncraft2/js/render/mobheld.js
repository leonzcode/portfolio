/* ---------------------------------------------------------------------------
   Leoncraft 2 - what mobs hold.

   A skeleton's bow, a piglin's crossbow or golden sword, a wither skeleton's
   stone sword: the item itself in the mob's hand, as the game draws them,
   placed the way the player's model holds things in third person
   (render/held.js placeInHand) from the mob's own arm, so it swings, aims and
   falls over with the arm, and grows and shrinks with the mob (a baby's
   sword is half the size). A carved pumpkin or a mob head worn on the head
   goes on the mob's head the same way (render/held.js placeOnHead). The same shapes as in your hand (a block is its
   own small shape, anything flat its picture a pixel thick), lit where the
   mob stands, shimmering when enchanted.

   One mesh per mob and hand, kept while the mob is drawn and let go a few
   seconds after it is not; entities/manager.js calls begin(), hold() for each
   mob it draws and end().
--------------------------------------------------------------------------- */
import { isFlatItem } from './blockmesh.js?v=107';
import { heldKind, heldGeometry, placeInHand, placeOnHead, setLight } from './held.js?v=107';
import { setGlint } from './glint.js?v=107';
import { glints, pieceLook } from './armor.js?v=107';
import { DRAW, itemId } from '../items.js?v=107';
const THREE = window.THREE;

export class MobHeld {
  constructor(R) {
    this.R = R;
    this.group = new THREE.Group();
    R.scene.add(this.group);
    this.byKey = new Map();          // "mob id:hand" -> { id, mesh, kind, seen }
    this.frame = 0;
    this.t = new THREE.Matrix4(); this.e = new THREE.Euler(); this.rot = new THREE.Matrix3();
  }
  begin() { this.frame++; }

  /* One mob's hands: arms (the parts' matrices, model pixels), the model's
     part index, its light (0..1 sky and block). */
  hold(e, mdl, mats, sky, block) {
    const eq = e.equip;
    // side 2 is the head: a carved pumpkin or a mob head (armour is entities/armorlayer.js)
    for (let side = 0; side < 3; side++) {
      const it = side === 2 ? eq.head : side ? eq.offhand : eq.mainhand;
      if (!it) continue;
      const part = mdl.index[side === 2 ? 'head' : side ? 'leftArm' : 'rightArm'];
      if (part === undefined) continue;
      const id = typeof it === 'string' ? itemId(it) : it.id;
      const d = DRAW[id];
      if (!d || !d.faces) continue;
      if (side === 2 && (isFlatItem(d) || pieceLook(typeof it === 'string' ? { id, count: 1 } : it))) continue;
      const key = e.id + ':' + side;
      let h = this.byKey.get(key);
      if (h && h.id !== id) { this.drop(h); h = null; }
      if (!h) h = this.make(key, id, d);
      h.seen = this.frame;
      const m = h.mesh;
      if (side === 2) placeOnHead(m.matrix, mats[part], d.shape === 'head', this.t);
      else placeInHand(m.matrix, mats[part], side, h.kind, 0, this.t, this.e);
      m.matrixWorldNeedsUpdate = true;
      m.visible = true;
      const lv = (Math.round(sky * 255) << 8) | Math.round(block * 255);
      if (lv !== h.light) { h.light = lv; setLight(m.geometry, lv); }
      setGlint(m, typeof it === 'object' && glints(it), this.R);
    }
  }
  make(key, id, d) {
    const R = this.R;
    const { geometry: g, cutout } = heldGeometry(d);
    const m = new THREE.Mesh(g, cutout ? R.mats.cutout : R.mats.opaque);
    m.frustumCulled = false; m.matrixAutoUpdate = false;
    // the shader's face frames turn with the item (as in your hand)
    const U = R.U, rot = this.rot;
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    this.group.add(m);
    const h = { id, mesh: m, kind: heldKind(d), seen: this.frame, light: -1 };
    this.byKey.set(key, h);
    return h;
  }
  drop(h) {
    this.group.remove(h.mesh);
    h.mesh.geometry.dispose();
    for (const [k, v] of this.byKey) if (v === h) { this.byKey.delete(k); break; }
  }
  // the ones not drawn this frame are hidden, and let go after a few seconds out of sight
  end() {
    for (const h of [...this.byKey.values()]) {
      if (h.seen === this.frame) continue;
      h.mesh.visible = false;
      if (this.frame - h.seen > 300) this.drop(h);
    }
  }
}
