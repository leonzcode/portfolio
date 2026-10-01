/* ---------------------------------------------------------------------------
   Leon Kart - the furniture round the circuit.

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
import { dressOf } from './themes.js?v=92';

/* Which part of a place's palette each model wears. The kit is one kit, so
   without this every circuit has the same green trees and the same red barriers
   standing round it and the theme stops at the kerb. */
const WEARS = {
  treeLarge: 'tree', treeSmall: 'tree',
  barrierRed: 'barrier', barrierWhite: 'barrier',
  rail: 'barrier', railDouble: 'barrier', fenceStraight: 'metal', fenceCurved: 'metal',
  grandStandCovered: 'metal', grandStand: 'metal',
  grandStandAwning: 'metal', grandStandRound: 'metal', grandStandCoveredRound: 'metal',
  lightPostModern: 'metal', lightPostLarge: 'metal', overheadLights: 'metal',
  pitsGarage: 'metal', pitsGarageClosed: 'metal', pitsOffice: 'metal', pitsOfficeRoof: 'metal',
  radarEquipment: 'metal', pylon: 'cloth',
  flagCheckers: 'cloth', flagCheckersSmall: 'cloth', flagGreen: 'cloth', flagRed: 'cloth',
  bannerTowerRed: 'cloth', bannerTowerGreen: 'cloth',
  billboard: 'cloth', billboardLow: 'cloth', billboardLower: 'cloth',
  tentLong: 'cloth', tent: 'cloth', tentClosed: 'cloth', tentRoof: 'cloth',
};

const DIR = 'models/';

/* The hoarding at the side of the road. The kit's billboard comes with a made
   up company printed on it, and this is Leon's circuit, so it carries his
   address instead. One canvas, drawn once and shared by every board on the
   lap; the material it replaces is the only one in the kit with a picture on
   it, which is what makes it safe to find by name. */
let adTex = null;
function billboardTex(THREE) {
  if (adTex) return adTex;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#17223b'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#ffd233';
  g.fillRect(0, 0, 512, 16);
  g.fillRect(0, 240, 512, 16);
  g.fillStyle = '#fff6e2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  /* Sized to the board rather than guessed at. The panel takes the whole of
     this canvas, so a line set at a fixed size and found to be wider than it
     is simply loses its first and last letters, which is a hoarding reading
     eonzhao.de. */
  const TEXT = 'leonzhao.dev';
  let px = 88;
  do {
    g.font = 'bold ' + px + 'px Verdana, Geneva, sans-serif';
    px -= 2;
  } while (px > 20 && g.measureText(TEXT).width > 448);
  g.fillText(TEXT, 256, 132);
  adTex = new THREE.CanvasTexture(c);
  adTex.anisotropy = 4;
  return adTex;
}
const SCALE = {
  grandStandCovered: 9, grandStand: 9,
  grandStandAwning: 9, grandStandRound: 9, grandStandCoveredRound: 9,
  bannerTowerRed: 7, bannerTowerGreen: 7,
  barrierRed: 9, barrierWhite: 9,
  treeLarge: 6, treeSmall: 6,
  tentLong: 7, tent: 7, tentClosed: 7, tentRoof: 7,
  lightPostModern: 9, flagCheckers: 7, flagCheckersSmall: 7,
  flagGreen: 7, flagRed: 7,
  billboard: 8, billboardLow: 8, billboardLower: 8,
  fenceStraight: 9, fenceCurved: 9,
  pitsGarage: 9, pitsGarageClosed: 9, pitsOffice: 9, pitsOfficeRoof: 9,
  pylon: 6, lightPostLarge: 9, lightColored: 8, lightRed: 8, lightRedDouble: 8,
  overheadLights: 9, radarEquipment: 7, rail: 9, railDouble: 9,
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

export async function buildProps(scene, THREE, track, current) {
  const still = () => !current || current();
  const dress = dressOf(track.theme);
  const glow = track.theme.glow || 0;
  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion();
  const euler = new THREE.Euler(), scl = new THREE.Vector3();

  // spots are { pos, yaw, scale }; one model, however many of them
  async function put(name, spots, faceOn, reheight) {
    if (!spots.length) return;
    let gltf;
    try { gltf = await load(loader, name); } catch (e) { return; }
    // the lobby moved on while this was loading; this scenery is for a circuit
    // that is not there any more
    if (!still()) { if (group.parent) scene.remove(group); return; }
    const base = SCALE[name] || 1;
    const model = parts(gltf.scene, THREE);
    // a model that is meant to stand ON a line rather than straddle it gets
    // pushed back by half its depth, so its near face lands on the spot
    if (faceOn) {
      const halfDepth = model.size.z * base / 2;
      for (const sp of spots) {
        sp.pos.x -= Math.sin(sp.yaw) * halfDepth;
        sp.pos.z -= Math.cos(sp.yaw) * halfDepth;
        // and take the height again where it actually ended up: moving it half a
        // metre and keeping the old y leaves it in the air wherever the road is
        // not flat across, which with one sided ramps is most of a lap
        if (reheight) sp.pos.y = reheight(sp.pos);
      }
    }
    /* The last word on where a thing is, taken after it has been pushed back
       onto its own face rather than when it was listed. That push moves a deep
       model - a hoarding is several metres front to back - and it happens here,
       long after the list was vetted, so a billboard checked out in the open
       could still come to rest inside a hillside. Asked again, at the end, of
       the position that is actually used. */
    spots = spots.filter(sp => !inHill(sp.pos));
    if (!spots.length) return;
    for (const part of model.list) {
      /* The kit's own material, tinted to this place. It has to be a copy: the
         materials are shared between models inside a glb, and painting the
         original would repaint the same trees on every circuit after it. A
         trunk keeps the bark colour and everything else takes the model's, so
         a tinted tree does not end up with a green trunk. */
      const mat = part.material.clone();
      // the one material in the kit that carries a printed sign
      if (part.material.name === 'tankco') {
        const t = billboardTex(THREE);
        if (mat.map) {
          t.wrapS = mat.map.wrapS;
          t.wrapT = mat.map.wrapT;
          t.flipY = mat.map.flipY;
          if (mat.map.colorSpace) t.colorSpace = mat.map.colorSpace;
        }
        t.needsUpdate = true;
        mat.map = t;
      }
      const key = WEARS[name];
      if (key) {
        const brown = mat.color && mat.color.r > mat.color.b * 1.15 && mat.color.g < mat.color.r * 0.85;
        const tint = key === 'tree' && brown ? dress.bark : dress[key];
        if (tint !== undefined) mat.color.multiplyScalar(1).multiply(new THREE.Color(tint));
        /* On a circuit that races after dark the barriers light themselves.
           They are the line between road and not road, and on Neon Mile they
           are the only thing that tells you where it goes. */
        if (glow && key === 'barrier') {
          mat.emissive = mat.color.clone();
          mat.emissiveIntensity = glow * 0.55;
        }
      }
      const im = new THREE.InstancedMesh(part.geometry, mat, spots.length);
      im.name = name;
      spots.forEach((sp, i) => {
        euler.set(0, sp.yaw || 0, 0);
        quat.setFromEuler(euler);
        scl.setScalar(base * (sp.scale || 1));
        m4.compose(sp.pos, quat, scl);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      /* Only the things close enough to the road for their shadow to land on
         it. Everything in the band behind the barrier - the wood, the catch
         fencing, the billboards, the floodlights, the marshal posts, several
         thousand tufts of grass - is a second pass through the shadow map for a
         shadow that falls in a field nobody drives on. */
      const FAR = ['treeLarge', 'treeSmall', 'fenceStraight', 'fenceCurved',
                   'billboard', 'billboardLow', 'billboardLower', 'lightPostLarge',
                   'flagGreen', 'flagRed', 'radarEquipment', 'pitsGarage', 'pitsOffice',
                   'tent', 'tentLong', 'grandStand', 'grandStandCovered'];
      im.castShadow = FAR.indexOf(name) < 0;
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
  /* The same, but measured against the road where the thing lands rather than
     the road it was measured from. Beside a divide the tarmac is half as wide
     again a few metres further along, so a hoarding put twelve metres off a
     normal stretch comes to rest on the wide one - a billboard standing in the
     road. Asked once and corrected, which is enough: the road does not change
     width twice in the few metres this moves anything. */
  const clearOf = (a, off) => {
    const want = Math.abs(off) - a.w;          // how far off the road it asked to be
    let p = side(a, off);
    const q = track.project(p.x, p.z, null);
    const over = q.half + want - Math.abs(q.lateral);
    return over > 0.05 ? side(a, off + Math.sign(off) * over) : p;
  };

  /* Nothing roadside where the road is inside a mountain. A tunnel already has
     walls - the bore is the barrier - and everything that usually lines a road
     is placed off the tarmac by a few metres, which inside a tunnel is a few
     metres into solid rock. A barrier runs through the wall, a lamp post
     stands in it, a tree grows out of the hillside: all of it reads as the
     mountain and the track passing through each other, which is exactly what
     it is. */
  const inTunnel = a => !!(a && a.tunnel);
  /* And the same asked of where a thing actually ends up rather than of the
     sample it was measured from. A tree placed twenty metres off a corner can
     come to rest nearest a stretch of road half a bend further round, and on a
     circuit with a tunnel in that bend that is a tree standing inside a
     mountain. The mountain is built out to about the bore plus the rocks that
     make it, so anything within that of a tunnel's centreline is inside it.

     The tunnel centrelines are gathered once and this is a distance check, not
     a search of the whole lap for every object on it. */
  const tunPts = track.samples.filter(a => a.tunnel).map(a => a.p);
  const NEAR = 54, WIDE = 46;
  const inHill = p => {
    if (!tunPts.length) return false;
    /* A cheap bound first: almost nothing on a circuit is anywhere near a
       tunnel, and asking the road where a point is costs a search of the whole
       lap. Only the handful that pass this are asked properly. */
    let close = false;
    for (let i = 0; i < tunPts.length; i++) {
      const dx = p.x - tunPts[i].x, dz = p.z - tunPts[i].z;
      if (dx * dx + dz * dz < NEAR * NEAR) { close = true; break; }
    }
    if (!close) return false;
    /* And then along the road rather than as the crow flies. A hill is built
       over the bored stretch and no further, so a barrier forty metres before
       a mouth is out in the open and belongs there - a plain distance test
       took those out too and left a gap in the fence on the approach. */
    const q = track.project(p.x, p.z, null);
    /* A sample or two either side of the nearest one as well. Right at a mouth
       the road can hand back a segment that skips the sample the point is
       actually closest to, and a billboard slips through on that. Four metres
       of slack is a post or two of fence, and it is inside the rock anyway. */
    const N = track.samples.length;
    for (let d = -2; d <= 2; d++) {
      if (track.samples[(q.i + d + N) % N].tunnel) return Math.abs(q.lateral) < WIDE;
    }
    return false;
  };
  // placed, then checked: the list only ever gets what is actually out in the open
  const clear = (list, o) => { if (!inHill(o.pos)) list.push(o); };

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
    // on the road surface, which leans on a banked corner: standing them on the
    // field left the barrier below the tarmac on every bend
    p.y = track.project(p.x, p.z, i).y;
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
      /* Nothing to lean on where there is nothing to lean on. A causeway is a
         road with the ground taken away either side of it and a gap is no road
         at all; fencing either turns the one place on the circuit you can
         actually fall off into a corridor. */
      const here = track.samples[i % track.samples.length];
      const prev = track.samples[(i - 1 + track.samples.length) % track.samples.length];
      /* Either end of the segment, not just the far one. A barrier is placed
         somewhere along the run between two samples, so testing only one of
         them left a post or two standing just inside each mouth. */
      const open = here.gap || here.noFence || inTunnel(here) || inTunnel(prev);
      while (next <= walked + seg) {
        const at = next - walked;
        next += STEP;
        if (open) { n++; continue; }
        const pos = new THREE.Vector3(from.x + dx * at, 0, from.z + dz * at);
        // on the road, like the ring points it sits between: asking the ground
        // here put the barrier back under the tarmac on every banked corner
        pos.y = track.project(pos.x, pos.z, null).y;
        clear(n++ % 2 ? red : white, { pos, yaw });
      }
      walked += seg;
    }
  }
  const onRoad = p => track.project(p.x, p.z, null).y;
  put('barrierRed', red, true, onRoad);   // the face on the wall, the body behind it
  put('barrierWhite', white, true, onRoad);

  /* ---- where a crowd would stand ----------------------------------------- */
  const stands = [], covered = [];
  // three blocks of three, spaced by their own width so they sit side by side
  // instead of growing into one long wall, and far enough back not to loom
  for (const at of [0.02, 0.42, 0.72]) {
    for (let k = -1; k <= 1; k++) {
      const b = track.at((at * L + k * 10.5 + L) % L);
      if (inTunnel(b)) continue;
      const pos = clearOf(b, -(b.w + 16));
      clear(at < 0.1 ? covered : stands, { pos, yaw: facingRoad(b, -1) });
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
    if (inTunnel(a)) continue;
    const pos = clearOf(a, (k % 2 ? 1 : -1) * (a.w + 8));
    clear(k % 2 ? towersR : towersG, { pos, yaw: facingRoad(a, k % 2 ? 1 : -1) });
  }
  put('bannerTowerRed', towersR);
  put('bannerTowerGreen', towersG);

  /* ---- trees, close enough to flick past --------------------------------- */
  const big = [], small = [];
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let s = 0; s < L; s += 7) {
    const a = track.at(s);
    for (const sgn of [1, -1]) {
      if (rnd() > 0.45) continue;
      if (inTunnel(a)) continue;
      const pos = clearOf(a, sgn * (a.w + 9 + rnd() * 16));
      clear(rnd() > 0.45 ? big : small, { pos, yaw: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.5 });
    }
  }
  /* And scrub, further out and much smaller, in the same list as the small
     trees rather than a list of its own. It is the same model, so a second
     instanced mesh of it would be a second set of draw calls for no reason,
     and two meshes sharing a name is a thing that reads as one. */
  for (let s = 0; s < L; s += 3.2) {
    const a = track.at(s);
    for (const sgn of [1, -1]) {
      if (rnd() > 0.55) continue;
      if (inTunnel(a)) continue;
      clear(small, { pos: clearOf(a, sgn * (a.w + 7 + rnd() * 24)),
                     yaw: rnd() * 6.28, scale: 0.16 + rnd() * 0.17 });
    }
  }
  put('treeLarge', big);
  put('treeSmall', small);

  /* ---- lamps, and a paddock ---------------------------------------------- */
  const lamps = [];
  for (let s = 0; s < L; s += 34) {
    const a = track.at(s);
    if (inTunnel(a)) continue;
    clear(lamps, { pos: clearOf(a, -(a.w + 5.4)), yaw: facingRoad(a, -1) });
  }
  put('lightPostModern', lamps);

  const tents = [], longTents = [];
  const pad = track.at(0.11 * L);
  for (let k = 0; k < 5; k++) {
    const pos = clearOf(pad, -(pad.w + 20 + (k % 2) * 9));
    pos.x += Math.cos(k * 1.9) * 11;
    pos.z += Math.sin(k * 1.9) * 11;
    pos.y = track.groundY(pos.x, pos.z);
    clear(k % 2 ? tents : longTents, { pos, yaw: withRoad(pad) });
  }
  put('tent', tents);
  put('tentLong', longTents);

  /* ---- what fills the middle distance ------------------------------------
     Everything above is at the edge of the road. What makes a circuit read as
     a place rather than a ribbon is the band behind that: catch fencing, the
     backs of billboards, floodlights, a pit lane, marshal posts, radar dishes.
     All of it is from the same kit as the barriers and all of it is instanced,
     so a hundred and fifty new objects cost about a dozen draw calls.
  -------------------------------------------------------------------------- */
  {
    let sseed = 20260920;
    const rnd = () => { sseed = (sseed * 1103515245 + 12345) & 0x7fffffff; return sseed / 0x7fffffff; };
    const fence = [], boards = [], boardsLow = [], flood = [], marshalG = [], marshalR = [];
    const rails = [], dishes = [], pylons = [];
    for (let s = 0; s < L; s += 4.4) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      // catch fencing stands back behind the barrier, both sides, all the way
      for (const sgn of [1, -1]) {
        clear(fence, { pos: clearOf(a, sgn * (a.w + 5.2)), yaw: withRoad(a) });
      }
    }
    for (let s = 6; s < L; s += 26) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = ((s / 26) | 0) % 2 ? 1 : -1;
      // a guard rail in front of the fence on the outside of things
      clear(rails, { pos: clearOf(a, sgn * (a.w + 3.4)), yaw: withRoad(a) });
    }
    for (let s = 20; s < L; s += 61) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = ((s / 61) | 0) % 2 ? 1 : -1;
      clear(boards, { pos: clearOf(a, sgn * (a.w + 12)), yaw: facingRoad(a, sgn) });
    }
    for (let s = 44; s < L; s += 73) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = ((s / 73) | 0) % 2 ? -1 : 1;
      clear(boardsLow, { pos: clearOf(a, sgn * (a.w + 10)), yaw: facingRoad(a, sgn) });
    }
    for (let s = 12; s < L; s += 88) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      clear(flood, { pos: clearOf(a, (a.w + 15)), yaw: facingRoad(a, 1) });
    }
    for (let s = 34; s < L; s += 96) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = ((s / 96) | 0) % 2 ? 1 : -1;
      clear(sgn > 0 ? marshalG : marshalR, { pos: clearOf(a, sgn * (a.w + 6.4)), yaw: facingRoad(a, sgn) });
    }
    for (let s = 70; s < L; s += 180) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      clear(dishes, { pos: clearOf(a, -(a.w + 19)), yaw: rnd() * 6.28 });
    }
    /* Markers on the apex of things. The scrub that used to be here as well
       went up with the small trees: the kit does have a piece called grass, but
       it is a flat one metre square with no height at all - a ground decal, not
       a tuft - and scaled up to read from the road it became green wedges lying
       across the sand at Redrock Dunes, z fighting with the ground under them. */
    for (let s = 0; s < L; s += 17) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = rnd() < 0.5 ? 1 : -1;
      clear(pylons, { pos: clearOf(a, sgn * (a.w + 1.6)), yaw: withRoad(a) });
    }
    /* Anything placed face on has to take its height again after it has been
       pushed back by half its depth, or it ends up standing at the height of
       the ground it used to be over. */
    const onGround = p => track.groundY(p.x, p.z);
    put('fenceStraight', fence, true, onGround);
    put('railDouble', rails, true, onGround);
    put('billboard', boards, true, onGround);
    put('billboardLow', boardsLow, true, onGround);
    put('lightPostLarge', flood);
    put('flagGreen', marshalG);
    put('flagRed', marshalR);
    put('radarEquipment', dishes);
    put('pylon', pylons);

    // a pit lane, once, on the straight before the line
    const pit = track.at((L - 150 + L) % L);
    const garages = [], offices = [];
    for (let k = 0; k < 6; k++) {
      const a = track.at(((L - 150 + k * 11) % L + L) % L);
      clear(k % 3 === 2 ? offices : garages, { pos: clearOf(a, -(a.w + 16)), yaw: facingRoad(a, -1) });
    }
    put('pitsGarage', garages, true, onGround);
    put('pitsOffice', offices, true, onGround);
    void pit;
  }

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
