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
   InstancedMesh no matter how the kit nested it.

   And then move it onto its own origin. The kit does not draw these models
   where their node sits: a barrier's mesh is the better part of a unit away
   from it, which at the scale used here is nearly six metres. Anything placed
   by its node therefore lands six metres from where it was asked to be, which
   is a barrier you bump into before you reach it and a tree in the wrong
   field. Centre the footprint on x and z, stand the feet on y = 0, and then a
   spot means a spot. */
function parts(root, THREE) {
  const out = [];
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    g.computeBoundingBox();
    box.union(g.boundingBox);
    out.push({ geometry: g, material: o.material });
  });
  if (out.length) {
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    for (const part of out) part.geometry.translate(-cx, -box.min.y, -cz);
  }
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  return { list: out, size };
}

export async function buildProps(scene, THREE, track) {
  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion();
  const euler = new THREE.Euler(), scl = new THREE.Vector3();

  // spots are { pos, yaw, scale }; one model, however many of them
  async function put(name, spots, faceOn) {
    if (!spots.length) return;
    let gltf;
    try { gltf = await load(loader, name); } catch (e) { return; }
    const base = SCALE[name] || 1;
    const model = parts(gltf.scene, THREE);
    // a model that is meant to stand ON a line rather than straddle it gets
    // pushed back by half its depth, so its near face lands on the spot
    if (faceOn) {
      const halfDepth = model.size.z * base / 2;
      for (const sp of spots) {
        sp.pos.x -= Math.sin(sp.yaw) * halfDepth;
        sp.pos.z -= Math.cos(sp.yaw) * halfDepth;
      }
    }
    for (const part of model.list) {
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
  /* The barrier has to stand on the surface the physics actually stops you at,
     and that surface is not a neat 3.2m offset from the tarmac.

     stepKart asks track.project where it is, and project answers with the offset
     from the NEAREST SAMPLE's centre. Round the outside of a corner the nearest
     sample is one further round, and measured from there the offset crosses the
     limit while the kart is still short of where a constant offset would put the
     wall. So the wall cuts the corner, and barriers drawn on the constant offset
     sit outside it: you bump into nothing, a few metres before you reach them.

     So ask the same question the physics asks. For each sample, walk outward and
     find the first offset at which project says you have hit, by bisection, and
     stand the barrier's front face there. What you can see is then what you hit,
     everywhere, including the corners.

     The kit draws a barrier from one end, with its front face on the origin and
     its body behind, which is what makes this work: the origin goes on the wall. */
  const STEP = 2.2;                        // the barrier is 2.25m, so joints overlap
  const red = [], white = [];

  // the first offset from this sample at which the physics says you have hit
  function wallAt(i, sgn) {
    const a = track.samples[i];
    let lo = a.w, hi = a.w + track.shoulder * 2.4;
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      const pr = track.project(a.p.x + a.n.x * sgn * mid, a.p.z + a.n.z * sgn * mid, i);
      if (Math.abs(pr.lateral) >= pr.wall) hi = mid; else lo = mid;
    }
    const p = a.p.clone().addScaledVector(a.n, sgn * hi);
    p.y = track.groundY(p.x, p.z);
    return p;
  }

  for (const sgn of [1, -1]) {
    // the wall as a closed ring of points, then walked at an even spacing: round
    // the outside of a corner the edge is longer than the middle of the road, so
    // stepping along the centreline instead leaves holes you cannot see
    const ring = [];
    for (let i = 0; i < track.samples.length; i++) ring.push(wallAt(i, sgn));
    ring.push(ring[0].clone());
    let walked = 0, next = 0, n = 0;
    for (let i = 1; i < ring.length; i++) {
      const from = ring[i - 1], to = ring[i];
      const seg = Math.hypot(to.x - from.x, to.z - from.z);
      if (seg < 1e-6) continue;
      const dx = (to.x - from.x) / seg, dz = (to.z - from.z) / seg;
      // +x runs along the wall; pick the turn that leaves +z looking at the road
      const inward = track.samples[i % track.samples.length].p.clone().sub(to);
      const yaw = ((-dz) * inward.x + dx * inward.z) > 0 ? alongX(dx, dz) : alongX(-dx, -dz);
      while (next <= walked + seg) {
        const at = next - walked;
        const pos = new THREE.Vector3(from.x + dx * at, 0, from.z + dz * at);
        pos.y = track.groundY(pos.x, pos.z);
        (n++ % 2 ? red : white).push({ pos, yaw });
        next += STEP;
      }
      walked += seg;
    }
  }
  put('barrierRed', red, true);         // the face on the wall, the body behind it
  put('barrierWhite', white, true);

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

  /* People in them. Two instanced meshes for the whole crowd, coloured per
     instance, seated in rows that climb toward the back the way the stand does.
     They are small and far away, so a body and a head is all anybody can make
     out and all they are given. */
  function crowd(spots, wide, deep, high) {
    if (!spots.length) return;
    const ROWS = 5, COLS = 8;
    const n = spots.length * ROWS * COLS;
    const body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.85, 0.4),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    const head = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.26, 7, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.95 }), n);
    const SHIRT = [0xe8402a, 0xffd233, 0x2b56d6, 0x43d94f, 0x8fd3ff, 0xfff6e2, 0xf4762a];
    const SKIN = [0xf0c8a0, 0xd9a273, 0xa9754c, 0x7a4f2e, 0xf7ddc0];
    const col = new THREE.Color();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1), tiny = new THREE.Vector3(1e-4, 1e-4, 1e-4);
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let i = 0;
    for (const sp of spots) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const empty = rnd() < 0.12;      // a few empty seats, or it reads as wallpaper
          const lx = (c / (COLS - 1) - 0.5) * wide * 0.78 + (rnd() - 0.5) * 0.3;
          const lz = deep * (0.3 - r / (ROWS - 1) * 0.5);
          const ly = high * (0.26 + r / (ROWS - 1) * 0.42);
          const cs = Math.cos(sp.yaw), sn = Math.sin(sp.yaw);
          // the stand's own yaw turns the row into place
          const wx = sp.pos.x + lx * cs + lz * sn;
          const wz = sp.pos.z - lx * sn + lz * cs;
          e.set(0, sp.yaw, 0); q.setFromEuler(e);
          const sz = empty ? tiny : one;
          m.compose(new THREE.Vector3(wx, sp.pos.y + ly, wz), q, sz);
          body.setMatrixAt(i, m);
          col.setHex(SHIRT[(rnd() * SHIRT.length) | 0]); body.setColorAt(i, col);
          m.compose(new THREE.Vector3(wx, sp.pos.y + ly + 0.56, wz), q, sz);
          head.setMatrixAt(i, m);
          col.setHex(SKIN[(rnd() * SKIN.length) | 0]); head.setColorAt(i, col);
          i++;
        }
      }
    }
    body.name = 'crowd'; head.name = 'crowd';
    for (const im of [body, head]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      im.castShadow = true;
      group.add(im);
    }
  }
  crowd(covered, 10, 10.2, 10.7);
  crowd(stands, 9, 9, 8.1);

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
