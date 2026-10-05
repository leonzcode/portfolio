/* ---------------------------------------------------------------------------
   Leoncraft 2 - what is in your hands, in first person.

     arm        your arm is always there. Empty, it is the game's bare arm;
                holding something, the same arm holds it, with the item in
                the fist turned the way the game turns that kind of item in
                first person (a block 45 degrees round, a tool or a sword
                leaning out, anything flat at the game's slant). What is in
                the off hand the left arm holds the same way.
     items      a block is its own small shape, anything flat is its picture
                given a pixel of thickness (render/blockmesh.js).
     motion     it swings with the arm (the game's 6 tick swing) and bobs as
                you walk; when what you hold changes, the hand drops out of
                sight and comes back up with the new thing (the game's 0.4 a
                tick), and after a swing it dips and comes back up with the
                attack cooldown, as in the game.
     drawing    over the world, from a camera of its own with the game's
                fixed 70 degree view (sprinting or a potion never stretches
                your hand), its depth squeezed into the front hundredth of the
                depth buffer: the hand is never inside a wall, and the arm and
                the item still hide one another properly.

   The item model numbers (where and how far round each kind sits) are the
   game's display settings for its block, flat, handheld and rod items.
--------------------------------------------------------------------------- */
import { blockGeometry, isFlatItem } from './blockmesh.js?v=12';
const THREE = window.THREE;
const PI = Math.PI, DEG = PI / 180;

/* ---- the kinds of held thing, and how each is placed ----
   [translation (pixels), turn (degrees: x, then y, then z), scale], for the
   right hand and the left: first person (fp) and third person (tp). */
export const DISPLAY = {
  block: {
    fp: [[0, 0, 0], [0, 45, 0], 0.4], fpL: [[0, 0, 0], [0, -225, 0], 0.4],
    tp: [[0, 2.5, 0], [75, 45, 0], 0.375], tpL: [[0, 2.5, 0], [75, -45, 0], 0.375],
  },
  flat: {
    fp: [[1.13, 3.2, 1.13], [0, -90, 25], 0.68], fpL: [[-1.13, 3.2, 1.13], [0, 90, -25], 0.68],
    tp: [[0, 3, 1], [0, 0, 0], 0.55], tpL: [[0, 3, 1], [0, 0, 0], 0.55],
  },
  handheld: {
    fp: [[1.13, 3.2, 1.13], [0, -90, 25], 0.68], fpL: [[-1.13, 3.2, 1.13], [0, -90, 25], 0.68],
    tp: [[0, 4, 0.5], [0, -90, 55], 0.85], tpL: [[0, 4, 0.5], [0, -90, 55], 0.85],
  },
  rod: {
    fp: [[0, 1.6, 0.8], [0, 90, 25], 0.68], fpL: [[0, 1.6, 0.8], [0, 90, 25], 0.68],
    tp: [[0, 4, 2.5], [0, 90, 55], 0.85], tpL: [[0, 4, 2.5], [0, 90, 55], 0.85],
  },
  bow: {
    fp: [[1.13, 3.2, 1.13], [0, -90, 25], 0.68], fpL: [[-1.13, 3.2, 1.13], [0, -90, 25], 0.68],
    tp: [[-1, -2, 2.5], [-80, 260, -40], 0.9], tpL: [[1, -2, 2.5], [-80, 280, -40], 0.9],
  },
};
const HANDHELD = /_(sword|pickaxe|axe|shovel|hoe|spear)$|^(stick|blaze_rod|breeze_rod|bone|mace|trident|debug_stick)$/;
const ROD = /^(fishing_rod|carrot_on_a_stick|warped_fungus_on_a_stick)$/;
export function heldKind(d) {
  if (!d) return null;
  if (!isFlatItem(d)) return 'block';
  const n = d.name || '';
  if (n === 'bow' || n === 'crossbow') return 'bow';
  if (ROD.test(n)) return 'rod';
  if (HANDHELD.test(n)) return 'handheld';
  return 'flat';
}
// one of the DISPLAY entries onto m (t, e: scratch)
export function applyDisplay(m, spec, t, e) {
  const [tr, r, s] = spec;
  m.multiply(t.makeTranslation(tr[0] / 16, tr[1] / 16, tr[2] / 16));
  m.multiply(t.makeRotationFromEuler(e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ')));
  m.multiply(t.makeScale(s, s, s));
}

/* Where the fist closes on each kind, in the item's own space (a block
   centred on the origin, a picture in the x-y plane): under a block, at a
   tool's handle (bottom left of its picture), at the foot of anything else. */
const GRIP = {
  block: [0, -0.85, 0], flat: [0, -0.42, 0], handheld: [-0.3, -0.3, 0], rod: [-0.3, -0.3, 0], bow: [-0.05, -0.05, 0],
};
/* and a nudge from the grip, in the camera's space (blocks) */
const NUDGE = {
  block: [-0.07, 0.02, -0.08], flat: [-0.02, 0, 0], handheld: [0, 0, 0], rod: [0, 0, 0], bow: [0, 0, 0],
};
/* Holding something, the arm sits a little lower than the bare arm (so the
   item is about where the game shows it, and still in a hand you can see),
   in blocks; and a block leans its top towards you a little, so you see it
   from above as the game's lower held block is seen. */
const DROP = { block: 0.14, flat: 0.07, handheld: 0.1, rod: 0.08, bow: 0.07 };
const TILT = { block: 22, flat: 0, handheld: 0, rod: 0, bow: 0 };
// the fist: the middle of the bottom of the arm (the skin's arm, model pixels, y up)
const FIST_Y = -10;

export class Held {
  constructor(R) {
    this.R = R;
    // the hand's own camera, with the depth squeezed to the front
    this.cam = new THREE.PerspectiveCamera(70, 1, 0.05, 16);
    this.cam.matrixAutoUpdate = true;
    // drawn with an ordinary depth test now (the hand is put in front by its camera instead)
    for (const k of ['handOpaque', 'handCutout']) if (R.mats[k]) R.mats[k].depthFunc = THREE.LessEqualDepth;
    // per hand (0 main, 1 off): what it should hold, what it shows, how far up it is (1 up, 0 out of sight)
    this.hands = [0, 1].map(side => ({ side, wantId: 0, want: null, showId: 0, show: null, h: 1 }));
    this.started = false;
    this.offsets = new Map();
    this.t = new THREE.Matrix4(); this.m = new THREE.Matrix4(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.rot = new THREE.Matrix3();
  }

  /* what a hand holds: an id from the DRAW table, or 0 */
  set(side, id, DRAW) {
    const H = this.hands[side];
    if (H.wantId === id && (H.want || !id)) return;
    if (H.want && H.want !== H.show) this.drop(H.want);
    H.wantId = id;
    H.want = this.make(DRAW[id]);
    // the very first thing held is just there
    if (!this.started) this.swap(H);
  }
  make(d) {
    if (!d || !d.faces) return null;
    const R = this.R;
    const { geometry: g, cutout } = blockGeometry(d, d.iconMeta || 0);
    const m = new THREE.Mesh(g, cutout ? R.mats.handCutout : R.mats.handOpaque);
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
    // the shader's face frames turn with the item
    const rot = this.rot, U = R.U;
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    m.userData.kind = heldKind(d);
    R.hand.add(m);
    return m;
  }
  drop(m) { if (!m) return; this.R.hand.remove(m); m.geometry.dispose(); }
  swap(H) {
    if (H.show && H.show !== H.want) this.drop(H.show);
    H.show = H.want; H.showId = H.wantId;
  }

  /* how high each hand is: the game lowers it while what it shows is not what
     it should hold, swaps at the bottom, and raises it again (0.4 a tick);
     the main hand also follows the cube of the attack cooldown */
  step(dt, cool) {
    const k = Math.min(1, dt * 8);
    for (const H of this.hands) {
      const same = H.showId === H.wantId;
      const want = same ? (H.side === 0 ? cool * cool * cool : 1) : 0;
      H.h += Math.max(-k, Math.min(k, want - H.h));
      if (!same && H.h < 0.1) this.swap(H);
    }
  }

  /* The item's place against the arm, worked out once per kind and side:
     the game's first person turn for that kind, moved so its grip sits in
     the bare arm's fist. */
  offset(kind, side) {
    const A = this.R.avatar, key = kind + side + (A.slim ? 's' : 'w');
    let O = this.offsets.get(key);
    if (O) return O;
    const t = this.t, e = this.e, f = side ? -1 : 1;
    const arm = new THREE.Matrix4();
    A.armMatrix(arm, null, side, 0, 0, 0, 0);
    // the game's first person place for the item, at rest
    const J = new THREE.Matrix4().makeTranslation(f * 0.56, -0.52, -0.72);
    if (TILT[kind]) J.multiply(t.makeRotationX(TILT[kind] * DEG));
    applyDisplay(J, DISPLAY[kind][side ? 'fpL' : 'fp'], t, e);
    const g = GRIP[kind];
    const grip = this.v.set(f * g[0], g[1], g[2]).applyMatrix4(J);
    const ax = (A.slim ? 0.5 : 1) * f;
    const fist = this.w.set(-ax, FIST_Y, 0).applyMatrix4(arm);
    const n = NUDGE[kind];
    // moved so the grip is in the fist, then set against the arm
    O = new THREE.Matrix4().makeTranslation(fist.x - grip.x + f * n[0], fist.y - grip.y + n[1], fist.z - grip.z + n[2]);
    O.multiply(J);
    O.premultiply(arm.invert());
    // the geometry's block is centred one block up
    O.multiply(t.makeTranslation(0, -1, 0));
    this.offsets.set(key, O);
    return O;
  }

  /* ---- a frame: the arms and what they hold ---- */
  draw(state, cam, dt) {
    const R = this.R, A = R.avatar;
    this.started = true;
    const cool = R.wearer && R.wearer.cooldown ? R.wearer.cooldown() : 1;
    this.step(dt, cool);
    // the camera: where the eye is, the game's 70 degrees, depth squeezed to the front
    const hc = this.cam;
    hc.position.copy(cam.position); hc.quaternion.copy(cam.quaternion);
    hc.aspect = cam.aspect; hc.updateProjectionMatrix();
    const pe = hc.projectionMatrix.elements, s = 0.01;
    for (let c = 0; c < 4; c++) pe[c * 4 + 2] = s * pe[c * 4 + 2] + (s - 1) * pe[c * 4 + 3];
    hc.projectionMatrixInverse.copy(hc.projectionMatrix).invert();
    hc.updateMatrixWorld();
    const main = this.hands[0], off = this.hands[1];
    // how far down each arm is: the drop of what it holds, and the dip while it changes (0.6 a block for all the way)
    const dr = h => (h.show ? DROP[h.show.userData.kind] / 0.6 : 0) + 1 - h.h;
    // the right arm is always there; the left only to hold something
    A.placeArms(state, hc, true, !!off.show, dr(main), dr(off));
    for (const H of this.hands) {
      const m = H.show;
      if (!m) continue;
      m.visible = true;
      m.matrix.multiplyMatrices(A.armParts[2 + H.side], this.offset(m.userData.kind, H.side));
      m.matrixWorldNeedsUpdate = true;
    }
    R.r.render(R.handScene, hc);
  }
}
