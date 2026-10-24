/* ---------------------------------------------------------------------------
   Leoncraft 2 - what is in your hands, in first person.

     arm        with the main hand empty, the game's bare right arm; holding
                something, the game draws only the thing, no arm under it,
                where that kind of item's own first person numbers put it (a
                block 45 degrees round, low and to the right, a tool or a
                sword leaning out, anything flat at the game's slant). The
                off hand shows only what it holds, never an arm.
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
import { blockGeometry, isFlatItem, shieldGeometry, tridentGeometry } from './blockmesh.js?v=107';
import { setGlint } from './glint.js?v=107';
import { gpuLayer as textureLayer, DRAW, itemId } from '../items.js?v=107';
const THREE = window.THREE;
const PI = Math.PI, DEG = PI / 180;
const wrap = a => a - 2 * PI * Math.round(a / (2 * PI));

/* ---- the kinds of held thing, and how each is placed ----
   The game's own numbers, from the display settings of its item models
   (measured from the game's files): [translation (pixels), turn (degrees: x,
   then y, then z), scale] for first person (fp) and third person (tp), right
   hand and left (L). The left hand's are given as the game ends up using
   them: it takes the model's left-hand entry (or the right-hand one when the
   model has none) and mirrors it, x moved the other way and the y and z turns
   the other way round.
   base: the kind whose grip the hand closes on in first person (below). */
const K = (fp, fpL, tp, tpL, base) => ({ fp, fpL, tp, tpL, base });
const BLOCK_TP = [[0, 2.5, 0], [75, 45, 0], 0.375], BLOCK_TPL = [[0, 2.5, 0], [75, -45, 0], 0.375];
const BLOCK_FP = [[0, 0, 0], [0, 45, 0], 0.4], BLOCK_FPL = [[0, 0, 0], [0, -225, 0], 0.4];
const FLAT_FP = [[1.13, 3.2, 1.13], [0, -90, 25], 0.68], FLAT_FPL = [[-1.13, 3.2, 1.13], [0, 90, -25], 0.68];
const TOOL_FP = FLAT_FP, TOOL_FPL = [[-1.13, 3.2, 1.13], [0, -90, 25], 0.68];
const SHIELD_LIFT = [0, -0.5, 0], TRIDENT_LIFT = [0, -1.5, 0];
export const DISPLAY = {
  // a block (block/block), and anything flat (item/generated)
  block: K(BLOCK_FP, BLOCK_FPL, BLOCK_TP, BLOCK_TPL, 'block'),
  flat: K(FLAT_FP, FLAT_FPL, [[0, 3, 1], [0, 0, 0], 0.55], [[0, 3, 1], [0, 0, 0], 0.55], 'flat'),
  // tools, swords, sticks, bones, bamboo, blaze and breeze rods (item/handheld)
  handheld: K(TOOL_FP, TOOL_FPL, [[0, 4, 0.5], [0, -90, 55], 0.85], [[0, 4, 0.5], [0, -90, 55], 0.85], 'handheld'),
  // fishing rods and the two things on a stick (item/handheld_rod)
  rod: K([[0, 1.6, 0.8], [0, 90, 25], 0.68], [[0, 1.6, 0.8], [0, 90, 25], 0.68], [[0, 4, 2.5], [0, 90, 55], 0.85], [[0, 4, 2.5], [0, 90, 55], 0.85], 'rod'),
  mace: K([[0, 3, 0.8], [0, -90, 25], 0.9], [[0, 3, 0.8], [0, -90, 25], 0.9], [[0, 4, 1], [0, -90, 55], 1], [[0, 4, 1], [0, -90, 55], 1], 'mace'),
  bow: K(TOOL_FP, TOOL_FPL, [[-1, -2, 2.5], [-80, 260, -40], 0.9], [[1, -2, 2.5], [-80, 280, -40], 0.9], 'bow'),
  crossbow: K([[1.13, 3.2, 1.13], [-90, 0, -55], 0.68], [[-1.13, 3.2, 1.13], [-90, 0, -35], 0.68], [[2, 0.1, -3], [-90, 0, -60], 0.9], [[-2, 0.1, -3], [-90, 0, -30], 0.9], 'crossbow'),
  // the flat things with numbers of their own
  horn: K(FLAT_FP, TOOL_FPL, [[0, 3, 1], [0, 180, 0], 0.55], [[0, 3, 1], [0, 0, 0], 0.55], 'flat'),
  brush: K(FLAT_FP, [[-8, 0.5, -5.5], [55, 85, 0], 1], [[0, 4, 0], [0, 0, 45], 0.9], [[0, 4, 0], [0, 0, 45], 0.9], 'flat'),
  bud: K([[0, 5, 0], [0, -90, 25], 0.68], [[0, 5, 0], [0, 90, -25], 0.68], [[0, 4, 1], [0, 0, 0], 0.55], [[0, 4, 1], [0, 0, 0], 0.55], 'flat'),
  smallBud: K([[0, 6, 0], [0, -90, 25], 0.68], [[0, 6, 0], [0, 90, -25], 0.68], [[0, 4, 1], [0, 0, 0], 0.55], [[0, 4, 1], [0, 0, 0], 0.55], 'flat'),
  roots: K([[1.13, 0, 1.13], [0, -90, 25], 0.68], [[-1.13, 0, 1.13], [0, 90, -25], 0.68], [[0, 0, 1], [0, 0, 0], 0.55], [[0, 0, 1], [0, 0, 0], 0.55], 'flat'),
  // the blocks with numbers of their own
  stairs: K(BLOCK_FP, BLOCK_FPL, BLOCK_TP, [[0, 2.5, 0], [75, 135, 0], 0.375], 'block'),
  thin: K([[0, 4.2, 0], [0, 45, 0], 0.4], [[0, 4.2, 0], [0, -225, 0], 0.4], [[0, 2.5, 2], [75, 45, 0], 0.375], [[0, 2.5, 2], [75, -45, 0], 0.375], 'block'),
  turned: K([[0, 0, 0], [0, 135, 0], 0.4], BLOCK_FPL, BLOCK_TP, BLOCK_TPL, 'block'),
  chest: K([[0, 0, 0], [0, 315, 0], 0.4], [[0, 0, 0], [0, -315, 0], 0.4], [[0, 2.5, 0], [75, 315, 0], 0.375], [[0, 2.5, 0], [75, -315, 0], 0.375], 'block'),
  conduit: K([[0, 0, 0], [0, 315, 0], 0.8], [[0, 0, 0], [0, -315, 0], 0.8], [[0, 2.5, 0], [75, 315, 0], 0.5], [[0, 2.5, 0], [75, -315, 0], 0.5], 'block'),
  pot: K([[0, 0, 0], [0, 90, 0], 0.375], [[0, 0, 0], [0, -90, 0], 0.375], [[0, 2, 0.5], [0, 90, 0], 0.375], [[0, 2, 0.5], [0, -90, 0], 0.375], 'block'),
  shelf: K([[0, -2, 0], [0, 135, 0], 0.5], BLOCK_FPL, [[-3, 1, 0], [75, 135, 0], 0.4], [[3, 1, 0], [75, -135, 0], 0.4], 'block'),
  lightningRod: K(BLOCK_FP, BLOCK_FPL, [[0, 2, 0.5], [0, 0, 0], 0.4], [[0, 2, 0.5], [0, 0, 0], 0.4], 'block'),
  endRod: K(BLOCK_FP, BLOCK_FPL, [[0, 0, 0], [0, 0, 0], 0.375], [[0, 0, 0], [0, 0, 0], 0.375], 'block'),
  skull: K(BLOCK_FP, BLOCK_FPL, [[0, 3, 0], [45, 45, 0], 0.5], [[0, 3, 0], [45, -45, 0], 0.5], 'block'),
  sensor: K(BLOCK_FP, BLOCK_FPL, BLOCK_TP, BLOCK_TP, 'block'),
  /* the shield, held as its model (blockmesh.js shieldGeometry), and the
     same while it is up blocking; the fourth number takes back the half
     block the model is lifted by */
  shield: K([[-10, 1.75, -10], [0, 180, 5], 1.25, SHIELD_LIFT], [[-10, 0, -10], [0, -180, -5], 1.25, SHIELD_LIFT],
    [[10, 6, -4], [0, 90, 0], 1, SHIELD_LIFT], [[-10, 6, 12], [0, -90, 0], 1, SHIELD_LIFT], 'shield'),
  shieldBlock: K([[-15, 3.25, -11], [0, 180, -5], 1.25, SHIELD_LIFT], [[-5, 5, -11], [0, -180, 5], 1.25, SHIELD_LIFT],
    [[-3.49, 11, -2], [45, 155, 0], 1, SHIELD_LIFT], [[-11.51, 7, 2.5], [45, -155, 0], 1, SHIELD_LIFT], 'shield'),
  // the trident, held as its model, and raised over the shoulder to throw (third person; first person moves it in useMove)
  trident: K([[-3, 17, 1], [0, -90, 25], 1, TRIDENT_LIFT], [[-13, 17, 1], [0, -90, 25], 1, TRIDENT_LIFT],
    [[11, 17, -2], [0, 60, 0], 1, TRIDENT_LIFT], [[-3, 17, 12], [0, -60, 0], 1, TRIDENT_LIFT], 'trident'),
  tridentThrow: K([[-3, 17, 1], [0, -90, 25], 1, TRIDENT_LIFT], [[-13, 17, 1], [0, -90, 25], 1, TRIDENT_LIFT],
    [[8, -17, 9], [0, 90, 180], 1, TRIDENT_LIFT], [[-8, -17, -7], [0, -90, -180], 1, TRIDENT_LIFT], 'trident'),
};
/* Which things are which. A kind only applies where our own shape is the
   game's (a chest is a chest here too, the shield and the trident are their
   models; a bed
   is held as its flat picture, so it keeps the flat numbers). */
const FLAT_KINDS = [
  ['shield', /^shield$/], ['trident', /^trident$/],
  ['handheld', /_(sword|pickaxe|axe|shovel|hoe|spear)$|^(stick|blaze_rod|breeze_rod|bone|bamboo|debug_stick)$/],
  ['rod', /^(fishing_rod|carrot_on_a_stick|warped_fungus_on_a_stick)$/],
  ['mace', /^mace$/], ['bow', /^bow$/], ['crossbow', /^crossbow$/], ['horn', /^goat_horn$/], ['brush', /^brush$/],
  ['bud', /^(large|medium)_amethyst_bud$/], ['smallBud', /^small_amethyst_bud$/], ['roots', /^hanging_roots$/],
];
const BLOCK_KINDS = [
  ['stairs', /_stairs$/],
  ['thin', /_(trapdoor|pressure_plate|carpet)$|^(moss_carpet|pale_moss_carpet|daylight_detector|snow)$/],
  ['turned', /_glazed_terracotta$|^(bee_nest|beehive|blast_furnace|carved_pumpkin|dispenser|dropper|furnace|jack_o_lantern|lectern|loom|pumpkin|smoker)$/],
  ['chest', /(^|_)chest$|shulker_box$/], ['conduit', /^conduit$/], ['pot', /^decorated_pot$/], ['shelf', /_shelf$/],
  ['lightningRod', /lightning_rod$/], ['endRod', /^end_rod$/], ['skull', /_(head|skull)$|^heavy_core$/], ['sensor', /^calibrated_sculk_sensor$/],
];
const kindCache = new Map();
export function heldKind(d) {
  if (!d) return null;
  const flat = isFlatItem(d), n = d.name || '', key = n + (flat ? '|f' : '|b');
  let k = kindCache.get(key);
  if (k) return k;
  k = flat ? 'flat' : 'block';
  for (const [kind, re] of flat ? FLAT_KINDS : BLOCK_KINDS) if (re.test(n)) { k = kind; break; }
  kindCache.set(key, k);
  return k;
}
/* A held mesh's light (sky level << 8 | block level, 0..255 each) into its
   vertices: Detailed reads it there (Fast takes the player's from a uniform),
   so a block in your hand is as dark as your arm in a cave. */
export function setLight(g, lv) {
  const L = g.attributes.aL, a = L.array, sky = lv >> 8, bl = lv & 255;
  for (let i = 0; i < L.count; i++) { a[i * 4] = sky; a[i * 4 + 1] = bl; }
  L.needsUpdate = true;
}
/* Something held in a model's hand, the game's third-person way, into m:
   from the arm's matrix (a humanoid's arm, in model pixels), turned down the
   arm to the fist, then the item's own third-person place and turn. side 0
   is the right hand; inset moves the hand in (a slim arm's half pixel). */
export function placeInHand(m, arm, side, kind, inset, t, e) {
  m.copy(arm);
  if (inset) m.multiply(t.makeTranslation(side ? -inset : inset, 0, 0));
  m.multiply(t.makeScale(16, -16, -16));            // back to the game's model space, in blocks
  m.multiply(t.makeRotationX(-PI / 2));
  m.multiply(t.makeRotationY(PI));
  m.multiply(t.makeTranslation((side ? -1 : 1) / 16, 0.125, -0.625));
  applyDisplay(m, DISPLAY[kind][side ? 'tpL' : 'tp'], t, e);
  m.multiply(t.makeTranslation(0, -1, 0));          // the hand geometry's cube is centred one block up
  return m;
}
/* A block worn on a head that is not armour, the game's head layer, into m
   from the head's matrix (model pixels, y up, +z the face): a block 10
   pixels a side (0.625 of a block) about the middle of the head; a mob head
   (skull) 1.1875 times its size, standing on the neck, its face (the -z side
   of our placed head) turned to the front. */
export function placeOnHead(m, head, skull, t) {
  m.copy(head);
  if (skull) m.multiply(t.makeTranslation(0, -9.5, 0)).multiply(t.makeScale(19, 19, 19)).multiply(t.makeRotationY(PI));
  else m.multiply(t.makeTranslation(0, 4, 0)).multiply(t.makeScale(10, 10, 10)).multiply(t.makeTranslation(0, -1, 0));
  return m;
}
// one of the DISPLAY entries onto m (t, e: scratch)
export function applyDisplay(m, spec, t, e) {
  const [tr, r, s, post] = spec;
  m.multiply(t.makeTranslation(tr[0] / 16, tr[1] / 16, tr[2] / 16));
  m.multiply(t.makeRotationFromEuler(e.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, 'XYZ')));
  m.multiply(t.makeScale(s, s, s));
  if (post) m.multiply(t.makeTranslation(post[0], post[1], post[2]));
}
/* The mesh for something in a hand: the shield's model, or the block or
   picture (blockmesh.js). */
let shieldLayers = null, tridentLayers = null;
/* A crossbow's draw data in its loaded picture ("a" an arrow, "r" a firework
   rocket), for another player's hand; anything else as it is */
export function loadedLook(d, c) {
  if (!d || !c || d.name !== 'crossbow') return d;
  const L = textureLayer(c === 'r' ? 'frame_crossbow_firework' : 'frame_crossbow_arrow');
  return L >= 0 ? Object.assign({}, d, { iconLayer: L, faces: [L, L, L, L, L, L] }) : d;
}
/* A bow's draw data in its drawn-back picture (stage 0, 1 or 2), for another player's hand */
export function pulledLook(d, stage) {
  if (!d || d.name !== 'bow' || stage < 0) return d;
  const L = textureLayer('frame_bow_pulling_' + stage);
  return L >= 0 ? Object.assign({}, d, { iconLayer: L, faces: [L, L, L, L, L, L] }) : d;
}
export function heldGeometry(d) {
  if (d.name === 'shield') {
    if (!shieldLayers) {
      const top = n => { const b = DRAW[itemId(n)]; return b && b.faces ? b.faces[2] : 0; };
      shieldLayers = { wood: top('spruce_planks'), rim: top('iron_block'), handle: top('dark_oak_planks') };
    }
    return shieldGeometry(shieldLayers);
  }
  if (d.name === 'trident') {
    if (!tridentLayers) {
      const top = n => { const b = DRAW[itemId(n)]; return b && b.faces ? b.faces[2] : 0; };
      tridentLayers = { pole: top('dark_prismarine'), head: top('prismarine_bricks') };
    }
    return tridentGeometry(tridentLayers);
  }
  return blockGeometry(d, d.iconMeta || 0);
}

/* Where a hand would hold each base kind, in the item's own space (a block
   centred on the origin, a picture in the x-y plane): under a block, at a
   tool's handle (bottom left of its picture), at the foot of anything else.
   Only the trident uses it now (it turns about its grip while raised to
   throw); the game draws held things without the arm. */
const GRIP = {
  block: [0, -0.85, 0], flat: [0, -0.42, 0], handheld: [-0.3, -0.3, 0], rod: [-0.3, -0.3, 0], mace: [-0.3, -0.3, 0],
  bow: [-0.05, -0.05, 0], crossbow: [-0.15, -0.15, 0], shield: [-0.5, 0, -0.625], trident: [-0.5, -0.125, -0.5],
};

export class Held {
  constructor(R) {
    this.R = R;
    // the hand's own camera, with the depth squeezed to the front
    this.cam = new THREE.PerspectiveCamera(70, 1, 0.05, 16);
    this.cam.matrixAutoUpdate = true;
    // drawn with an ordinary depth test now (the hand is put in front by its camera instead)
    for (const k of ['handOpaque', 'handCutout']) if (R.mats[k]) R.mats[k].depthFunc = THREE.LessEqualDepth;
    // per hand (0 main, 1 off): what it should hold, what it shows, how far up it is (1 up, 0 out of sight)
    this.hands = [0, 1].map(side => ({ side, wantId: 0, want: null, showId: 0, show: null, h: 1, glint: false }));
    this.started = false;
    this.rests = new Map();
    this.arms = [new THREE.Matrix4(), new THREE.Matrix4()];
    this.t = new THREE.Matrix4(); this.m = new THREE.Matrix4(); this.m2 = new THREE.Matrix4(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.w = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.rot = new THREE.Matrix3();
    this.bobM = new THREE.Matrix4();
    this.u = new THREE.Matrix4(); this.c = new THREE.Vector3();
  }

  /* what a hand holds: an id from the DRAW table, or 0 */
  set(side, id, DRAW) {
    const H = this.hands[side];
    if (H.wantId === id && (H.want || !id)) return;
    if (H.want && H.want !== H.show) this.drop(H.want);
    H.wantId = id;
    H.want = this.make(DRAW[id]);
    if (H.want) setGlint(H.want, H.glint, this.R);
    // the very first thing held is just there
    if (!this.started) this.swap(H);
  }
  /* a crossbow's load in a hand: 'arrow', 'rocket' or null (renderer.js, from the stack every frame) */
  loaded(side, kind) { this.hands[side].loaded = kind; }
  /* whether what a hand should hold shimmers (renderer.js reads it from the stack every frame) */
  glint(side, on) {
    const H = this.hands[side];
    if (H.glint === on) return;
    H.glint = on;
    setGlint(H.want, on, this.R);
  }
  make(d) {
    if (!d || !d.faces) return null;
    const R = this.R;
    const { geometry: g, cutout } = heldGeometry(d);
    const m = new THREE.Mesh(g, cutout ? R.mats.handCutout : R.mats.handOpaque);
    m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false;
    // the shader's face frames turn with the item
    const rot = this.rot, U = R.U;
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    m.userData.kind = heldKind(d);
    m.userData.d = d;
    R.hand.add(m);
    return m;
  }
  drop(m) { if (!m) return; this.R.hand.remove(m); m.geometry.dispose(); }
  swap(H) {
    if (H.show && H.show !== H.want) this.drop(H.show);
    H.show = H.want; H.showId = H.wantId;
    this.dropVariants(H);
  }
  /* the same thing in another of its pictures (a bow drawn back, a crossbow
     loading or loaded), made the first time it is needed */
  variant(H, layer) {
    const V = H.variants || (H.variants = new Map());
    let m = V.get(layer);
    if (!m) {
      const d = H.show.userData.d;
      m = this.make(Object.assign({}, d, { iconLayer: layer, faces: [layer, layer, layer, layer, layer, layer] }));
      m.userData.kind = H.show.userData.kind;
      V.set(layer, m);
    }
    setGlint(m, H.glint, this.R);
    return m;
  }
  dropVariants(H) {
    if (!H.variants) return;
    for (const m of H.variants.values()) this.drop(m);
    H.variants = null;
  }
  // which of its pictures a hand shows for what it is doing: a layer, or -1 for its own
  pictureFor(H, use) {
    const n = H.show && H.show.userData.d.name;
    let name = null;
    if (n === 'bow' && use && use.kind === 'bow') {
      const p = use.t / 20;
      name = p >= 0.9 ? 'frame_bow_pulling_2' : p >= 0.65 ? 'frame_bow_pulling_1' : 'frame_bow_pulling_0';
    } else if (n === 'crossbow' && use && use.kind === 'crossbow') {
      const p = use.t / use.total;
      name = p >= 1 ? 'frame_crossbow_pulling_2' : p >= 0.58 ? 'frame_crossbow_pulling_1' : 'frame_crossbow_pulling_0';
    } else if (n === 'crossbow' && H.loaded) name = H.loaded === 'rocket' ? 'frame_crossbow_firework' : 'frame_crossbow_arrow';
    return name ? textureLayer(name) : -1;
  }

  /* What the use button does to a hand, as a turn and a shift in the
     camera's space about the item's middle (c): eating and drinking bring it
     to the mouth, turned to face you, bobbing a bite every 4 ticks; a bow
     comes in towards the middle, turned to show its face, and draws back
     with a shake as the pull gets strong; a crossbow tips back as it loads; a
     trident is raised and pulled back to throw; a shield comes up across the
     view; a loaded crossbow is held up to aim. f is 1 for the right hand, -1
     for the left. */
  useMove(U, use, f, c) {
    const t = use.t, T = this.t, k = 1 - Math.pow(Math.max(0, 1 - t / 3), 3);
    let dx = 0, dy = 0, dz = 0, ry = 0, rx = 0, rz = 0;
    if (use.kind === 'eat' || use.kind === 'drink') {
      dx = -0.42 * k; dy = 0.2 * k; ry = 90 * k; rx = 10 * k;
      if (t > use.total * 0.2) dy += Math.abs(Math.cos(t / 4 * PI)) * 0.06;
    } else if (use.kind === 'bow') {
      const p = Math.min(1, t / use.total);
      dx = -0.3 * k; dy = 0.12 * k - 0.04 * p; dz = 0.06 * p; ry = 35 * k; rz = -10 * k;
      if (p > 0.1) dy += Math.sin((t - 0.1) * 1.3) * (p - 0.1) * 0.012;
    } else if (use.kind === 'crossbow') {
      const p = Math.min(1, t / use.total);
      dx = -0.18 * k; dy = 0.2 * k; dz = 0.05 * p; rx = 30 * k; ry = 20 * k;
      if (p > 0.1) dy += Math.sin((t - 0.1) * 1.3) * (p - 0.1) * 0.012;
    } else if (use.kind === 'trident') {
      const p = Math.min(1, t / use.total);
      dx = -0.16 * k; dy = 0.42 * k + 0.04 * p; dz = 0.12 * p; rx = -50 * k; ry = 15 * k;
      if (p > 0.1) dy += Math.sin((t - 0.1) * 1.3) * (p - 0.1) * 0.01;
    } else if (use.kind === 'block') {
      const b = Math.min(1, t / 2);
      dx = -0.32 * b; dy = 0.2 * b; dz = 0.08 * b; ry = 75 * b;
    } else if (use.kind === 'aim') {
      dx = -0.26; dy = 0.26; ry = 45; rx = 22;
    } else if (use.kind === 'spear') {
      // a spear charged: brought in under the view and pointed ahead
      dx = -0.22 * k; dy = 0.08 * k; dz = -0.18 * k; ry = 20 * k; rx = -35 * k;
    } else return false;
    U.makeTranslation(c.x + f * dx, c.y + dy, c.z + dz);
    if (ry) U.multiply(T.makeRotationY(f * ry * DEG));
    if (rx) U.multiply(T.makeRotationX(rx * DEG));
    if (rz) U.multiply(T.makeRotationZ(f * rz * DEG));
    U.multiply(T.makeTranslation(-c.x, -c.y, -c.z));
    return true;
  }

  /* how high each hand is: the game lowers it while what it shows is not what
     it should hold, swaps at the bottom, and raises it again (0.4 a tick);
     the main hand also follows the cube of the attack cooldown */
  // a gun's kick (Leon Network's Rifle): the main hand's item jumps back and up, then settles over a fifth of a second
  recoil(n) { this.kick = Math.max(this.kick || 0, n || 1); }
  step(dt, cool) {
    if (this.kick) this.kick = Math.max(0, this.kick - dt * 5);
    const k = Math.min(1, dt * 8);
    for (const H of this.hands) {
      const same = H.showId === H.wantId;
      const want = same ? (H.side === 0 ? cool * cool * cool : 1) : 0;
      H.h += Math.max(-k, Math.min(k, want - H.h));
      if (!same && H.h < 0.1) this.swap(H);
    }
  }

  /* The item at rest, in the camera's space, worked out once per kind and
     side: the game's first person place for a held thing (0.56 to the side,
     0.52 down, 0.72 ahead) and that kind's own place and turn in it. With
     it, the point the game turns the item about as it swings, and where a
     hand would hold it (the grip). */
  rest(kind, side) {
    const key = kind + side;
    let C = this.rests.get(key);
    if (C) return C;
    const t = this.t, f = side ? -1 : 1, base = DISPLAY[kind].base;
    const J = this.place(kind, side), g = GRIP[base];
    // (the shield and the trident are models, the same either hand: their grip is not mirrored)
    const own = base === 'shield' || base === 'trident';
    const fist = new THREE.Vector3(own ? g[0] : f * g[0], g[1], g[2]).applyMatrix4(J);
    // (the geometry's block is centred one block up)
    const K = new THREE.Matrix4().copy(J).multiply(t.makeTranslation(0, -1, 0));
    C = { K, fist, pivot: new THREE.Vector3(f * 0.56, -0.52, -0.72) };
    this.rests.set(key, C);
    return C;
  }
  // the game's first person place for a kind, at rest
  place(kind, side) {
    const f = side ? -1 : 1;
    const J = new THREE.Matrix4().makeTranslation(f * 0.56, -0.52, -0.72);
    applyDisplay(J, DISPLAY[kind][side ? 'fpL' : 'fp'], this.t, this.e);
    return J;
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
    // the walking bob, as the game moves your hands: across and down with the step, and a little turn each way
    const bob = state.bob, B = this.bobM;
    B.makeTranslation(bob ? bob.x : 0, bob ? bob.y : 0, 0);
    if (bob && bob.rz) B.multiply(t.makeRotationZ(bob.rz));
    if (bob && bob.rx) B.multiply(t.makeRotationX(bob.rx));
    // the light they are in: the sky and block light where you stand, as your arm has
    const lv = (Math.round(A.sky * 255) << 8) | Math.round(A.block * 255);
    for (const H of this.hands) {
      const side = H.side, f = side ? -1 : 1;
      let m = H.show;
      // how far down the hand is while what it holds changes (0.6 a block for all the way)
      const eq = 1 - H.h;
      // only the main hand swings
      const sp = side === 0 ? A.cur.attack : 0, sq = Math.sqrt(sp);
      const arm = A.armMatrix(this.arms[side], null, side, sp, 0, 0, eq);
      if (!m) { arm.premultiply(B); continue; }
      // the use button: a shield goes up to block (its own place), anything else moves below
      const use = bob && bob.use && bob.use.side === side ? bob.use : null;
      const kind = m.userData.kind === 'shield' && use && use.kind === 'block' ? 'shieldBlock' : m.userData.kind;
      const C = this.rest(kind, side), P = C.pivot, M = this.m;
      // the item: where the game has it, swinging the game's way about its own point
      M.makeTranslation(f * -0.4 * Math.sin(sq * PI) + P.x, 0.2 * Math.sin(sq * 2 * PI) - 0.6 * eq + P.y, -0.2 * Math.sin(sp * PI) + P.z);
      M.multiply(this.attackTurn(this.m2, f, sp));
      M.multiply(t.makeTranslation(-P.x, -P.y, -P.z));
      // what the use button is doing with it (eating, a bow drawn...), about the item's middle at rest
      // (a held model, the trident, turns about the hand that holds it)
      const about = kind === 'trident' ? this.c.copy(C.fist) : this.c.set(0, 1, 0).applyMatrix4(C.K);
      if (use && kind !== 'shieldBlock' && this.useMove(this.u, use, f, about)) M.premultiply(this.u);
      // (a gun's kick: back towards you and tipped up, sharp at first and easing out)
      if (side === 0 && this.kick > 0) { const e = this.kick * this.kick; M.premultiply(t.makeTranslation(0, 0.04 * e, 0.22 * e)); M.multiply(this.u.makeRotationX(0.5 * e)); }
      // the picture for it (a bow drawn back), when the pack has one
      const pl = this.pictureFor(H, use);
      if (pl >= 0) { m.visible = false; m = this.variant(H, pl); }
      if (H.variants) for (const v of H.variants.values()) if (v !== m) v.visible = false;
      M.multiply(C.K).premultiply(B);
      m.matrix.multiplyMatrices(cam.matrixWorld, M);
      m.visible = true;
      m.matrixWorldNeedsUpdate = true;
      if (m.userData.light !== lv) { m.userData.light = lv; setLight(m.geometry, lv); }
    }
    // the bare right arm only while the main hand holds nothing (the game never draws an arm under a held thing)
    A.setArms(cam.matrixWorld, this.arms[0], this.arms[1], !this.hands[0].show, false);
    R.r.render(R.handScene, hc);
  }
}
