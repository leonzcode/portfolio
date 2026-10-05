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
import { blockGeometry, isFlatItem } from './blockmesh.js?v=13';
const THREE = window.THREE;
const PI = Math.PI, DEG = PI / 180;
const wrap = a => a - 2 * PI * Math.round(a / (2 * PI));

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
    this.rests = new Map();
    this.arms = [new THREE.Matrix4(), new THREE.Matrix4()];
    this.t = new THREE.Matrix4(); this.m = new THREE.Matrix4(); this.m2 = new THREE.Matrix4(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.q = new THREE.Quaternion();
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

  /* The item at rest, in the camera's space, worked out once per kind and
     side: the game's first person place and turn for that kind, moved so
     its grip sits in the bare arm's fist. With it, the point the game turns
     the item about as it swings (moved the same way), and the fist. */
  rest(kind, side) {
    const A = this.R.avatar, key = kind + side + (A.slim ? 's' : 'w');
    let C = this.rests.get(key);
    if (C) return C;
    const t = this.t, e = this.e, f = side ? -1 : 1;
    const arm = A.armMatrix(new THREE.Matrix4(), null, side, 0, 0, 0, 0);
    // the game's first person place for the item, at rest
    const J = new THREE.Matrix4().makeTranslation(f * 0.56, -0.52, -0.72);
    if (TILT[kind]) J.multiply(t.makeRotationX(TILT[kind] * DEG));
    applyDisplay(J, DISPLAY[kind][side ? 'fpL' : 'fp'], t, e);
    const g = GRIP[kind], n = NUDGE[kind];
    const grip = new THREE.Vector3(f * g[0], g[1], g[2]).applyMatrix4(J);
    const nudge = new THREE.Vector3(f * n[0], n[1], n[2]);
    const fist = this.fistOf(arm, side, new THREE.Vector3()).add(nudge);
    const shift = fist.clone().sub(grip);
    // moved so the grip is in the fist (the geometry's block is centred one block up)
    const K = new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z).multiply(J).multiply(t.makeTranslation(0, -1, 0));
    C = { K, fist, nudge, pivot: new THREE.Vector3(f * 0.56, -0.52, -0.72).add(shift) };
    this.rests.set(key, C);
    return C;
  }
  // the middle of the bottom of an arm, from its matrix
  fistOf(arm, side, out) {
    return out.set(-(this.R.avatar.slim ? 0.5 : 1) * (side ? -1 : 1), FIST_Y, 0).applyMatrix4(arm);
  }
  /* The game's swing of a held item (f 1 the right hand, -1 the left; sp
     0..1): it turns towards the middle, tips forward and down, and comes back. */
  attackTurn(m, f, sp) {
    const t = this.t, a = Math.sin(sp * sp * PI), b = Math.sin(Math.sqrt(sp) * PI);
    m.makeRotationY(f * (45 - 20 * a) * DEG);
    m.multiply(t.makeRotationZ(f * -20 * b * DEG));
    m.multiply(t.makeRotationX(-80 * b * DEG));
    m.multiply(t.makeRotationY(f * -45 * DEG));
    return m;
  }
  /* The hand lags a little behind a quick turn: the game keeps a view that
     follows yours half the way each tick, and turns the hand a tenth of the
     gap between them. Here as the turn of the hand's camera (the other way). */
  sway(state, cam, dt) {
    const yaw = state.yaw || 0, pitch = state.pitch || 0;
    if (this.yawB === undefined || dt > 0.5) { this.yawB = yaw; this.pitchB = pitch; }
    const k = 1 - Math.pow(0.5, dt * 20);
    this.yawB += wrap(yaw - this.yawB) * k;
    this.pitchB += (pitch - this.pitchB) * k;
    const hc = this.cam;
    hc.position.copy(cam.position);
    hc.quaternion.copy(cam.quaternion).multiply(this.q.setFromEuler(this.e.set(0.1 * (pitch - this.pitchB), 0.1 * wrap(yaw - this.yawB), 0, 'YXZ')));
  }

  /* ---- a frame: the arms and what they hold ---- */
  draw(state, cam, dt) {
    const R = this.R, A = R.avatar, t = this.t;
    this.started = true;
    const cool = R.wearer && R.wearer.cooldown ? R.wearer.cooldown() : 1;
    this.step(dt, cool);
    // the camera: where the eye is, the game's 70 degrees, depth squeezed to the front
    const hc = this.cam;
    this.sway(state, cam, dt);
    hc.aspect = cam.aspect; hc.updateProjectionMatrix();
    const pe = hc.projectionMatrix.elements, s = 0.01;
    for (let c = 0; c < 4; c++) pe[c * 4 + 2] = s * pe[c * 4 + 2] + (s - 1) * pe[c * 4 + 3];
    hc.projectionMatrixInverse.copy(hc.projectionMatrix).invert();
    hc.updateMatrixWorld();
    const bob = state.bob, bx = bob ? bob.x : 0, by = bob ? bob.y : 0;
    for (const H of this.hands) {
      const side = H.side, f = side ? -1 : 1, m = H.show;
      // how far down the arm is: the drop of what it holds, and the dip while it changes (0.6 a block for all the way)
      const eq = (m ? DROP[m.userData.kind] / 0.6 : 0) + 1 - H.h;
      // only the main hand swings
      const sp = side === 0 ? A.cur.attack : 0, sq = Math.sqrt(sp);
      const arm = A.armMatrix(this.arms[side], null, side, sp, bx, by, eq);
      if (!m) continue;
      const C = this.rest(m.userData.kind, side), P = C.pivot, M = this.m;
      // the item: where the game has it, swinging the game's way about its own point
      M.makeTranslation(f * -0.4 * Math.sin(sq * PI) + bx + P.x, 0.2 * Math.sin(sq * 2 * PI) + by - 0.6 * eq + P.y, -0.2 * Math.sin(sp * PI) + P.z);
      M.multiply(this.attackTurn(this.m2, f, sp));
      M.multiply(t.makeTranslation(-P.x, -P.y, -P.z));
      // the arm goes with it, its fist kept on the item's grip
      const grip = this.v.copy(C.fist).applyMatrix4(M), fist = this.fistOf(arm, side, this.w).add(C.nudge);
      arm.premultiply(t.makeTranslation(grip.x - fist.x, grip.y - fist.y, grip.z - fist.z));
      M.multiply(C.K);
      m.matrix.multiplyMatrices(cam.matrixWorld, M);
      m.visible = true;
      m.matrixWorldNeedsUpdate = true;
    }
    // the right arm is always there; the left only to hold something
    A.setArms(cam.matrixWorld, this.arms[0], this.arms[1], true, !!this.hands[1].show);
    R.r.render(R.handScene, hc);
  }
}
