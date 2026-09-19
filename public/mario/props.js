/* ---------------------------------------------------------------------------
   Leon Cart - the furniture round the circuit.

   Kenney's Racing Kit, CC0, loaded once and then instanced: barriers down both
   edges, stands and banner towers where a crowd would stand, cones on the apex
   of the tight corners, a gantry over the start line. The models are small and
   share a handful of flat materials, so the whole circuit costs about twenty
   draw calls rather than one per post.

   Everything here is decoration. If the models fail to arrive the race is
   exactly the same race, which is why buildProps is fired and forgotten rather
   than awaited: the track is drivable before the scenery turns up.

   Sizes are in the kit's own units, where a road tile is one across. The SCALE
   table below turns each one into metres for this circuit, whose road is about
   sixteen to twenty-two metres wide.
--------------------------------------------------------------------------- */
import { GLTFLoader } from '/legacy/vendor/three-addons-0.163.0/loaders/GLTFLoader.js';

const DIR = 'models/';
const SCALE = {
  grandStandCovered: 9, grandStand: 9,
  bannerTowerRed: 7, bannerTowerGreen: 7,
  barrierRed: 9, barrierWhite: 9,
  pylon: 6, treeLarge: 6, treeSmall: 6,
  tentLong: 7, tent: 7,
  lightPostModern: 9, flagCheckers: 7,
};

/* one load per model, however many times it is asked for */
const cache = new Map();
function load(loader, name) {
  if (!cache.has(name)) {
    cache.set(name, new Promise((res, rej) => loader.load(DIR + name + '.glb', res, undefined, rej)));
  }
  return cache.get(name);
}

/* Flatten a loaded model to the meshes it is really made of, with its own
   hierarchy baked into the geometry, so each one can become a single
   InstancedMesh no matter how the kit nested it. */
function parts(root, THREE) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    out.push({ geometry: g, material: o.material });
  });
  void THREE;
  return out;
}

export async function buildProps(scene, THREE, track) {
  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion();
  const euler = new THREE.Euler(), scl = new THREE.Vector3();

  // spots are { pos, yaw, scale }; one model, however many of them
  async function put(name, spots) {
    if (!spots.length) return;
    let gltf;
    try { gltf = await load(loader, name); } catch (e) { return; }
    const base = SCALE[name] || 1;
    for (const part of parts(gltf.scene, THREE)) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
      im.name = name;
      spots.forEach((sp, i) => {
        euler.set(0, sp.yaw || 0, 0);
        quat.setFromEuler(euler);
        scl.setScalar(base * (sp.scale || 1));
        m4.compose(sp.pos, quat, scl);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;            // one box round the whole circuit is useless
      im.matrixWorldAutoUpdate = false;
      group.add(im);
    }
  }

  const L = track.length;
  /* Which way a model has to be turned depends on how the kit drew it. A
     barrier, a gantry and a long tent are long along their own x; a grandstand
     and a lamp are square in plan and face their own +z, with the tall back of
     the stand at -z and the seats looking out at +z. So there are two helpers:
     one that points a model's +z somewhere, one that points its +x somewhere. */
  const alongZ = (dx, dz) => Math.atan2(dx, dz);
  const alongX = (dx, dz) => Math.atan2(-dz, dx);
  const withRoad = a => alongX(a.t.x, a.t.z);            // lying along the tarmac
  // looking in at the road from `sgn` side of it
  const facingRoad = (a, sgn) => alongZ(-sgn * a.n.x, -sgn * a.n.z);
  // Off to the side the ground is not at road height: the road follows the hills
  // and so does the grass, but they part company a few metres out. Everything
  // standing on the field asks the ground how high it is.
  const side = (a, off) => {
    const p = a.p.clone().addScaledVector(a.n, off);
    p.y = track.groundY(p.x, p.z);
    return p;
  };

  /* ---- barriers down both edges ------------------------------------------ */
  /* These are the edge of the circuit, not decoration beside it: the kit draws a
     barrier from one end with its front face on the origin and its body behind,
     so putting the origin on the wall line makes the barrier you can see the wall
     you bounce off.

     They have to be spaced along the WALL, though, not along the middle of the
     road. Round the outside of a corner the wall is longer than the centreline,
     so stepping 2.25m down the middle leaves the run short by the difference and
     opens holes in it - which you cannot see but can still drive into, because
     the wall is continuous even where the barrier is not. Same where the road
     changes width and the wall line steps sideways. So walk each edge itself. */
  const STEP = 2.2;                        // the barrier is 2.25m, so joints overlap
  const red = [], white = [];
  for (const sgn of [1, -1]) {
    let carry = 0, prev = null, n = 0;
    for (let s = 0; s <= L; s += 1) {
      const a = track.at(s % L);
      const pos = side(a, sgn * (a.w + track.shoulder));
      if (prev) {
        carry += Math.hypot(pos.x - prev.x, pos.z - prev.z);
        while (carry >= STEP) {
          carry -= STEP;
          (n++ % 2 ? red : white).push({ pos: pos.clone(), yaw: facingRoad(a, sgn) });
        }
      } else {
        (n++ % 2 ? red : white).push({ pos: pos.clone(), yaw: facingRoad(a, sgn) });
      }
      prev = pos;
    }
  }
  put('barrierRed', red);
  put('barrierWhite', white);

  /* ---- where a crowd would stand ----------------------------------------- */
  const stands = [], covered = [];
  // three blocks of three, spaced by their own width so they sit side by side
  // instead of growing into one long wall, and far enough back not to loom
  for (const at of [0.02, 0.42, 0.72]) {
    for (let k = -1; k <= 1; k++) {
      const b = track.at((at * L + k * 10.5 + L) % L);
      const pos = side(b, -(b.w + 16));
      (at < 0.1 ? covered : stands).push({ pos, yaw: facingRoad(b, -1) });
    }
  }
  put('grandStandCovered', covered);
  put('grandStand', stands);

  /* ---- banner towers, tall enough to see a corner coming ----------------- */
  const towersR = [], towersG = [];
  for (let k = 0; k < 10; k++) {
    const a = track.at((k / 10) * L);
    const pos = side(a, (k % 2 ? 1 : -1) * (a.w + 8));
    (k % 2 ? towersR : towersG).push({ pos, yaw: facingRoad(a, k % 2 ? 1 : -1) });
  }
  put('bannerTowerRed', towersR);
  put('bannerTowerGreen', towersG);

  /* ---- cones on the inside of the tight corners -------------------------- */
  const cones = [];
  for (let s = 0; s < L; s += 4) {
    const a = track.at(s), b = track.at((s + 22) % L);
    const turn = Math.atan2(a.t.x * b.t.z - a.t.z * b.t.x, a.t.x * b.t.x + a.t.z * b.t.z);
    if (Math.abs(turn) < 0.5) continue;            // only where it actually bends
    const inner = turn > 0 ? 1 : -1;
    cones.push({ pos: side(a, inner * (a.w + 1.1)), yaw: withRoad(a) });
  }
  put('pylon', cones);

  /* ---- trees, close enough to flick past --------------------------------- */
  const big = [], small = [];
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let s = 0; s < L; s += 7) {
    const a = track.at(s);
    for (const sgn of [1, -1]) {
      if (rnd() > 0.45) continue;
      const pos = side(a, sgn * (a.w + 9 + rnd() * 16));
      (rnd() > 0.45 ? big : small).push({ pos, yaw: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.5 });
    }
  }
  put('treeLarge', big);
  put('treeSmall', small);

  /* ---- lamps, and a paddock ---------------------------------------------- */
  const lamps = [];
  for (let s = 0; s < L; s += 34) {
    const a = track.at(s);
    lamps.push({ pos: side(a, -(a.w + 5.4)), yaw: facingRoad(a, -1) });
  }
  put('lightPostModern', lamps);

  const tents = [], longTents = [];
  const pad = track.at(0.11 * L);
  for (let k = 0; k < 5; k++) {
    const pos = side(pad, -(pad.w + 20 + (k % 2) * 9));
    pos.x += Math.cos(k * 1.9) * 11;
    pos.z += Math.sin(k * 1.9) * 11;
    pos.y = track.groundY(pos.x, pos.z);
    (k % 2 ? tents : longTents).push({ pos, yaw: withRoad(pad) });
  }
  put('tent', tents);
  put('tentLong', longTents);

  /* ---- the start line ----------------------------------------------------- */
  // No gantry from the kit here: track.js already builds one over the line, in
  // the gold and navy the rest of the game is lettered in. Two would be the
  // barrier problem again.
  const start = track.at(0);
  put('flagCheckers', [
    { pos: side(start, start.w + 2.4), yaw: withRoad(start) },
    { pos: side(start, -(start.w + 2.4)), yaw: withRoad(start) },
  ]);

  return group;
}
