/* ---------------------------------------------------------------------------
   Leon Kart - what a kart is made of.

   Five bodies, four sets of wheels and five exhaust trails, and any of them go
   with any of them. None of them carries a colour of its own: every panel is
   painted from the racer you picked, so Pip's buggy is Pip's red and Tock's is
   Tock's teal, and a grid of eight is still eight recognisable cars however
   anybody has built them.

   Parts are cosmetic. They change nothing about how a kart drives, which is
   deliberate: a lobby where the fast build wins is a lobby where nobody picks
   the one they like.

   Everything is boxes, cylinders and tapered boxes so a whole car still merges
   into two meshes with its colours in the vertices, and a full grid still costs
   a couple of dozen draw calls.

   Sizes are metres. The nose points at +z here; the helpers negate z once so a
   part list can be written the way you would sketch it, nose forward.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { kitModel, kitPart } from './models.js?v=87';

export const INK = 0x17223b, STEEL = 0xb8bcc4, DARK = 0x3a3f4a, RUBBER = 0x1d2430;
export const GLASS = 0x9fd8ff, CHROME = 0xd8dde4;

export function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, -z);
  return g;
}
export function cyl(r1, r2, len, seg, axis, x, y, z) {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg).toNonIndexed();
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, -z);
  return g;
}
export function ball(r, x, y, z) {
  const g = new THREE.IcosahedronGeometry(r, 1).toNonIndexed();
  g.translate(x, y, -z);
  return g;
}
/* A box narrower at one end than the other, which is what almost every panel on
   a car actually is. Front means towards the nose. */
export function taper(wFront, wBack, h, hFront, d, x, y, z) {
  const g = new THREE.BoxGeometry(wBack, h, d).toNonIndexed();
  const p = g.attributes.position;
  const kx = wFront / wBack, ky = hFront / h;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) < 0) { p.setX(i, p.getX(i) * kx); p.setY(i, p.getY(i) * ky); }
  }
  g.computeVertexNormals();
  g.translate(x, y, -z);
  return g;
}
/* ---------------------------------------------------------------------------
   Many little shapes into one mesh, with their colours baked into the vertices.
   This is the single most important thing in the whole game for performance: a
   car, a plant or a cattle grid drawn as twenty objects is twenty draw calls,
   and drawn this way it is one. Anything that does not have to move
   independently of the rest of itself should come through here.
--------------------------------------------------------------------------- */
export const vertexMat = (rough, flat) => new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: rough === undefined ? 0.8 : rough, flatShading: !!flat,
});
export function merge(parts, mat) {
  let n = 0;
  for (const p of parts) n += p.g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  let o = 0;
  for (const p of parts) {
    const count = p.g.attributes.position.count;
    pos.set(p.g.attributes.position.array, o * 3);
    nor.set(p.g.attributes.normal.array, o * 3);
    if (p.cols) col.set(p.cols, o * 3);
    else {
      c.setHex(p.c);
      for (let i = 0; i < count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    }
    o += count;
    p.g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/* A tube bent round one axis, for roll cages and bumper hoops: a torus cut to
   an arc, which is far cheaper to build than a swept path and reads the same. */
export function hoop(r, thick, arc, start, axis, x, y, z) {
  const g = new THREE.TorusGeometry(r, thick, 5, 14, arc).toNonIndexed();
  g.rotateZ(start);
  if (axis === 'x') g.rotateY(Math.PI / 2);
  g.translate(x, y, -z);
  return g;
}

/* ---------------------------------------------------------------------------
   Three more bodies, each one a decision rather than a shade of the same car.
   The five above are all reasonable; these are not meant to be. A bullet will
   not go round a corner, a dart will not go anywhere fast in a straight line,
   and a tank will not do either but nothing moves it. Picking one should cost
   you something you notice on the first lap.
--------------------------------------------------------------------------- */

/* a land speed car: long, low, pointed, and hopeless at turning */
function bullet(r) {
  return {
    seat: { y: 0.46, z: -0.3, lean: 0.22 }, ride: 0.3, wheelbase: 1.06, track: 0.78,
    parts: [
      { g: taper(0.42, 1.02, 0.5, 0.2, 3.5, 0, 0.44, 0.1), c: r.kart },
      { g: taper(0.3, 0.72, 0.16, 0.08, 3.4, 0, 0.72, 0.12), c: r.trim },
      { g: box(1.06, 0.12, 2.9, 0, 0.2, -0.1), c: INK },
      { g: cyl(0.2, 0.06, 1.1, 10, 'z', 0, 0.5, 1.9), c: r.trim },
      { g: box(0.7, 0.44, 0.7, 0, 0.78, -0.46), c: DARK },
      { g: box(0.5, 0.2, 0.24, 0, 1.04, -0.52), c: INK },
      { g: box(0.12, 0.86, 1.0, 0, 1.0, -1.44), c: r.trim },
      { g: box(0.9, 0.08, 0.34, 0, 1.36, -1.62), c: r.kart },
      { g: taper(0.9, 0.64, 0.4, 0.34, 0.9, 0, 0.5, -1.5), c: r.kart },
      { g: cyl(0.12, 0.14, 0.5, 8, 'z', 0.2, 0.44, -1.96), c: STEEL },
      { g: cyl(0.12, 0.14, 0.5, 8, 'z', -0.2, 0.44, -1.96), c: STEEL },
      { g: box(0.16, 0.1, 0.9, 0.62, 0.34, 0.5), c: DARK },
      { g: box(0.16, 0.1, 0.9, -0.62, 0.34, 0.5), c: DARK },
    ],
    exhaust: [{ x: 0.2, y: 0.44, z: -2.2 }, { x: -0.2, y: 0.44, z: -2.2 }],
  };
}

/* a shopping trolley with an engine: tiny, upright, and gone before you look */
function dart(r) {
  return {
    seat: { y: 0.62, z: 0.04, lean: -0.08 }, ride: 0.34, wheelbase: 0.68, track: 0.8,
    parts: [
      { g: box(1.12, 0.36, 1.5, 0, 0.44, 0), c: r.kart },
      { g: box(0.96, 0.14, 1.56, 0, 0.66, 0), c: r.trim },
      { g: box(1.2, 0.1, 1.3, 0, 0.24, 0), c: INK },
      { g: taper(0.5, 1.06, 0.3, 0.2, 0.8, 0, 0.5, 0.86), c: r.kart },
      { g: box(0.76, 0.42, 0.14, 0, 0.92, -0.42), c: r.trim },
      { g: cyl(0.06, 0.06, 0.5, 6, 'y', 0.3, 1.1, -0.44), c: STEEL },
      { g: cyl(0.06, 0.06, 0.5, 6, 'y', -0.3, 1.1, -0.44), c: STEEL },
      { g: box(0.84, 0.08, 0.1, 0, 1.34, -0.44), c: DARK },
      { g: box(0.5, 0.3, 0.4, 0, 0.72, -0.78), c: DARK },
      { g: cyl(0.09, 0.09, 0.42, 7, 'z', 0.22, 0.6, -0.96), c: STEEL },
      { g: box(0.16, 0.18, 0.5, 0.58, 0.44, 0.1), c: DARK },
      { g: box(0.16, 0.18, 0.5, -0.58, 0.44, 0.1), c: DARK },
    ],
    exhaust: [{ x: 0.22, y: 0.6, z: -1.16 }],
  };
}

/* a brick with wheels: nothing shifts it and it shifts everything */
function tank(r) {
  return {
    seat: { y: 0.92, z: 0.06, lean: -0.04 }, ride: 0.5, wheelbase: 0.98, track: 1.06,
    parts: [
      { g: box(2.0, 0.7, 2.5, 0, 0.62, 0), c: r.kart },
      { g: box(2.08, 0.18, 2.3, 0, 0.98, 0), c: r.trim },
      { g: box(2.14, 0.2, 2.6, 0, 0.26, 0), c: INK },
      { g: box(1.5, 0.64, 0.2, 0, 1.3, -0.5), c: DARK },
      { g: box(1.62, 0.16, 0.5, 0, 1.64, -0.52), c: r.trim },
      { g: cyl(0.09, 0.09, 0.9, 7, 'y', 0.66, 1.4, -0.5), c: STEEL },
      { g: cyl(0.09, 0.09, 0.9, 7, 'y', -0.66, 1.4, -0.5), c: STEEL },
      { g: cyl(0.09, 0.09, 1.4, 7, 'x', 0, 1.82, -0.5), c: STEEL },
      { g: box(2.16, 0.42, 0.5, 0, 0.7, 1.24), c: DARK },
      { g: box(1.9, 0.2, 0.2, 0, 1.0, 1.38), c: r.trim },
      { g: box(2.16, 0.46, 0.44, 0, 0.7, -1.26), c: DARK },
      { g: box(0.46, 0.3, 0.16, 0.7, 0.96, 1.3), c: 0xffd233 },
      { g: box(0.46, 0.3, 0.16, -0.7, 0.96, 1.3), c: 0xffd233 },
      { g: cyl(0.16, 0.18, 0.7, 8, 'z', 0.5, 0.98, -1.5), c: STEEL },
      { g: cyl(0.16, 0.18, 0.7, 8, 'z', -0.5, 0.98, -1.5), c: STEEL },
      { g: box(0.3, 0.5, 0.9, 1.06, 0.62, 0.3), c: r.trim },
      { g: box(0.3, 0.5, 0.9, -1.06, 0.62, 0.3), c: r.trim },
    ],
    exhaust: [{ x: 0.5, y: 1.3, z: -1.7 }, { x: -0.5, y: 1.3, z: -1.7 }],
  };
}

/* ---------------------------------------------------------------------------
   The bodies. Each returns its parts plus where the driver sits on it and how
   far off the ground its floor is, so the same driver fits every one of them.
--------------------------------------------------------------------------- */

/* the open wheel racer: wings, side pods and a roll hoop */
function formula(r) {
  return {
    seat: { y: 0.5, z: 0.02, lean: 0 }, ride: 0.38, wheelbase: 0.86, track: 0.88,
    parts: [
      { g: box(1.72, 0.14, 2.5, 0, 0.26, -0.05), c: DARK },
      { g: box(1.5, 0.1, 2.56, 0, 0.2, -0.05), c: INK },
      { g: taper(0.86, 1.34, 0.46, 0.34, 2.0, 0, 0.5, 0.18), c: r.kart },
      { g: taper(0.7, 1.1, 0.16, 0.12, 2.0, 0, 0.74, 0.2), c: r.trim },
      { g: taper(0.34, 0.5, 0.42, 0.3, 1.5, 0.66, 0.5, -0.1), c: r.kart },
      { g: taper(0.34, 0.5, 0.42, 0.3, 1.5, -0.66, 0.5, -0.1), c: r.kart },
      { g: box(0.3, 0.26, 0.1, 0.66, 0.52, 0.66), c: INK },
      { g: box(0.3, 0.26, 0.1, -0.66, 0.52, 0.66), c: INK },
      { g: taper(0.2, 0.8, 0.28, 0.14, 0.9, 0, 0.52, 1.5), c: r.trim },
      { g: box(1.66, 0.08, 0.42, 0, 0.32, 1.72), c: r.trim },
      { g: box(0.06, 0.2, 0.42, 0.82, 0.4, 1.72), c: r.kart },
      { g: box(0.06, 0.2, 0.42, -0.82, 0.4, 1.72), c: r.kart },
      { g: box(0.9, 0.16, 0.12, 0, 0.8, 0.62), c: DARK },
      { g: box(0.82, 0.52, 0.14, 0, 0.94, -0.36), c: r.kart },
      { g: box(0.56, 0.2, 0.22, 0, 1.24, -0.44), c: DARK },
      { g: cyl(0.07, 0.07, 0.56, 7, 'y', 0.34, 1.12, -0.5), c: STEEL },
      { g: cyl(0.07, 0.07, 0.56, 7, 'y', -0.34, 1.12, -0.5), c: STEEL },
      { g: cyl(0.07, 0.07, 0.72, 7, 'x', 0, 1.38, -0.5), c: STEEL },
      { g: taper(0.74, 0.5, 0.44, 0.5, 0.9, 0, 0.78, -0.95), c: r.kart },
      { g: box(0.62, 0.3, 0.3, 0, 0.72, -1.3), c: DARK },
      { g: cyl(0.1, 0.12, 0.66, 7, 'z', 0.26, 0.95, -1.34), c: STEEL },
      { g: cyl(0.1, 0.12, 0.66, 7, 'z', -0.26, 0.95, -1.34), c: STEEL },
      { g: box(0.1, 0.42, 0.24, 0.24, 1.14, -1.2), c: DARK },
      { g: box(0.1, 0.42, 0.24, -0.24, 1.14, -1.2), c: DARK },
      { g: box(1.44, 0.09, 0.4, 0, 1.38, -1.24), c: r.trim },
      { g: box(1.3, 0.06, 0.22, 0, 1.24, -1.34), c: r.trim },
      { g: box(0.07, 0.42, 0.52, 0.72, 1.24, -1.26), c: r.kart },
      { g: box(0.07, 0.42, 0.52, -0.72, 1.24, -1.26), c: r.kart },
      { g: box(0.16, 0.1, 0.08, 0.5, 0.86, 0.52), c: DARK },
      { g: box(0.16, 0.1, 0.08, -0.5, 0.86, 0.52), c: DARK },
    ],
    exhaust: [{ x: 0.26, y: 0.95, z: -1.66 }, { x: -0.26, y: 0.95, z: -1.66 }],
  };
}

/* the go kart: a floor, side rails, a bumper hoop and the engine slung beside
   the seat, which is what a real one is and none of it is bodywork */
function roadster(r) {
  const rail = [];
  for (const sx of [1, -1]) {
    rail.push({ g: cyl(0.075, 0.075, 2.3, 6, 'z', sx * 0.82, 0.4, -0.05), c: r.trim });
    rail.push({ g: cyl(0.07, 0.07, 0.34, 6, 'y', sx * 0.82, 0.26, 1.0), c: r.trim });
    rail.push({ g: cyl(0.07, 0.07, 0.34, 6, 'y', sx * 0.82, 0.26, -1.0), c: r.trim });
  }
  return {
    seat: { y: 0.46, z: -0.12, lean: 0.1 }, ride: 0.36, wheelbase: 0.9, track: 0.84,
    parts: [
      { g: box(1.5, 0.12, 2.5, 0, 0.3, 0), c: r.kart },
      { g: box(1.32, 0.1, 2.3, 0, 0.38, 0), c: DARK },
      // a rounded nose box with a number plate on it
      { g: taper(0.86, 1.4, 0.4, 0.3, 0.85, 0, 0.52, 1.36), c: r.kart },
      { g: box(0.62, 0.34, 0.06, 0, 0.6, 1.79), c: 0xfff6e2 },
      { g: box(1.38, 0.1, 0.3, 0, 0.3, 1.82), c: r.trim },
      // the seat: a bucket with high sides
      { g: box(0.72, 0.5, 0.14, 0, 0.72, -0.5), c: r.trim },
      { g: box(0.12, 0.34, 0.6, 0.34, 0.62, -0.2), c: r.trim },
      { g: box(0.12, 0.34, 0.6, -0.34, 0.62, -0.2), c: r.trim },
      { g: box(0.76, 0.1, 0.62, 0, 0.46, -0.2), c: r.trim },
      // the engine, off to one side the way a kart carries it
      { g: box(0.44, 0.44, 0.56, 0.6, 0.62, -0.6), c: DARK },
      { g: cyl(0.2, 0.2, 0.3, 10, 'x', 0.86, 0.66, -0.6), c: STEEL },
      { g: cyl(0.1, 0.1, 0.9, 7, 'z', 0.6, 0.86, -1.1), c: STEEL },
      // steering column and wheel, standing up in front of the driver
      { g: cyl(0.05, 0.05, 0.6, 6, 'y', 0, 0.68, 0.6), c: DARK },
      { g: cyl(0.22, 0.22, 0.06, 12, 'y', 0, 0.98, 0.56), c: INK },
      // bumper hoop round the back
      { g: hoop(0.62, 0.07, Math.PI, 0, 'x', 0, 0.52, -1.42), c: r.trim },
      { g: box(1.3, 0.12, 0.12, 0, 0.52, -1.5), c: r.trim },
      // floor pan fairings over the rear wheels
      { g: taper(0.36, 0.2, 0.22, 0.18, 0.7, 0.78, 0.6, -0.9), c: r.kart },
      { g: taper(0.36, 0.2, 0.22, 0.18, 0.7, -0.78, 0.6, -0.9), c: r.kart },
    ].concat(rail),
    exhaust: [{ x: 0.6, y: 0.86, z: -1.55 }],
  };
}

/* the buggy: everything raised, a cage over the driver, arches over the wheels
   and the spare on the back */
function buggy(r) {
  const cage = [];
  for (const sx of [1, -1]) {
    cage.push({ g: cyl(0.06, 0.06, 1.0, 6, 'y', sx * 0.52, 1.2, 0.42), c: STEEL });
    cage.push({ g: cyl(0.06, 0.06, 1.0, 6, 'y', sx * 0.52, 1.2, -0.72), c: STEEL });
    cage.push({ g: cyl(0.06, 0.06, 1.2, 6, 'z', sx * 0.52, 1.7, -0.15), c: STEEL });
  }
  const arch = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    arch.push({ g: hoop(0.58, 0.07, Math.PI, 0, 'x', sx * 0.84, 0.66, sz * 0.92), c: r.trim });
    arch.push({ g: box(0.34, 0.08, 1.1, sx * 0.84, 1.22, sz * 0.92), c: r.kart });
  }
  return {
    seat: { y: 0.74, z: -0.05, lean: 0 }, ride: 0.56, wheelbase: 0.92, track: 0.84,
    parts: [
      { g: box(1.4, 0.16, 2.4, 0, 0.58, -0.05), c: r.kart },
      { g: box(1.2, 0.12, 2.2, 0, 0.7, -0.05), c: DARK },
      { g: taper(0.9, 1.3, 0.4, 0.3, 0.9, 0, 0.82, 1.24), c: r.kart },
      // a grille and a pair of lamps on the nose
      { g: box(0.9, 0.22, 0.08, 0, 0.8, 1.7), c: INK },
      { g: cyl(0.14, 0.14, 0.12, 10, 'z', 0.34, 0.98, 1.68), c: 0xfff6e2 },
      { g: cyl(0.14, 0.14, 0.12, 10, 'z', -0.34, 0.98, 1.68), c: 0xfff6e2 },
      { g: box(1.5, 0.14, 0.14, 0, 0.62, 1.74), c: STEEL },           // bull bar
      // the seat and the cage rails
      { g: box(0.78, 0.56, 0.14, 0, 1.06, -0.46), c: r.trim },
      { g: box(0.8, 0.1, 0.62, 0, 0.78, -0.18), c: r.trim },
      { g: cyl(0.22, 0.22, 0.06, 12, 'z', 0, 1.06, 0.5), c: INK },
      // a light bar across the top of the cage
      { g: box(1.0, 0.14, 0.18, 0, 1.78, 0.4), c: DARK },
      { g: cyl(0.08, 0.08, 0.1, 8, 'z', 0.3, 1.78, 0.5), c: 0xfff6e2 },
      { g: cyl(0.08, 0.08, 0.1, 8, 'z', 0, 1.78, 0.5), c: 0xfff6e2 },
      { g: cyl(0.08, 0.08, 0.1, 8, 'z', -0.3, 1.78, 0.5), c: 0xfff6e2 },
      // engine, snorkel and the spare wheel on the tail
      { g: box(0.8, 0.44, 0.6, 0, 1.0, -1.02), c: DARK },
      { g: cyl(0.1, 0.1, 1.1, 7, 'y', 0.56, 1.4, -0.9), c: STEEL },
      { g: cyl(0.42, 0.42, 0.26, 12, 'z', 0, 1.0, -1.44), c: RUBBER },
      { g: cyl(0.2, 0.2, 0.3, 8, 'z', 0, 1.0, -1.44), c: r.trim },
    ].concat(cage, arch),
    exhaust: [{ x: 0.56, y: 1.9, z: -0.9 }],
  };
}

/* the speeder: low, covered wheels, a dorsal fin and twin thrusters */
function speeder(r) {
  return {
    seat: { y: 0.46, z: 0.06, lean: 0.28 }, ride: 0.34, wheelbase: 0.94, track: 0.8,
    parts: [
      { g: taper(0.7, 1.5, 0.5, 0.34, 3.0, 0, 0.5, 0.1), c: r.kart },
      { g: taper(0.5, 1.2, 0.2, 0.12, 3.0, 0, 0.78, 0.12), c: r.trim },
      // fairings over all four wheels, which is what makes it read as sealed
      { g: taper(0.42, 0.5, 0.56, 0.4, 1.2, 0.78, 0.5, 0.86), c: r.kart },
      { g: taper(0.42, 0.5, 0.56, 0.4, 1.2, -0.78, 0.5, 0.86), c: r.kart },
      { g: taper(0.5, 0.42, 0.6, 0.46, 1.3, 0.78, 0.52, -0.9), c: r.kart },
      { g: taper(0.5, 0.42, 0.6, 0.46, 1.3, -0.78, 0.52, -0.9), c: r.kart },
      // a canopy bar and a windscreen in front of the driver
      { g: box(0.7, 0.3, 0.06, 0, 0.94, 0.66), c: GLASS },
      { g: box(0.76, 0.08, 0.1, 0, 1.1, 0.64), c: r.trim },
      { g: box(0.14, 0.34, 0.5, 0.36, 0.92, 0.3), c: r.trim },
      { g: box(0.14, 0.34, 0.5, -0.36, 0.92, 0.3), c: r.trim },
      // the fin down the tail
      { g: taper(0.09, 0.09, 0.62, 0.2, 1.2, 0, 1.06, -0.9), c: r.trim },
      // twin thrusters, ringed
      { g: cyl(0.24, 0.3, 0.5, 12, 'z', 0.34, 0.62, -1.5), c: DARK },
      { g: cyl(0.24, 0.3, 0.5, 12, 'z', -0.34, 0.62, -1.5), c: DARK },
      { g: cyl(0.18, 0.18, 0.1, 12, 'z', 0.34, 0.62, -1.72), c: r.trim },
      { g: cyl(0.18, 0.18, 0.1, 12, 'z', -0.34, 0.62, -1.72), c: r.trim },
      // a splitter and a diffuser, so it looks like it is holding itself down
      { g: box(1.62, 0.07, 0.5, 0, 0.26, 1.6), c: INK },
      { g: box(1.5, 0.22, 0.4, 0, 0.34, -1.54), c: INK },
      { g: cyl(0.2, 0.2, 0.05, 12, 'z', 0, 0.82, 0.5), c: INK },
    ],
    exhaust: [{ x: 0.34, y: 0.62, z: -1.85 }, { x: -0.34, y: 0.62, z: -1.85 }],
  };
}

/* the hauler: a stubby pickup with a bed, a grille and a stack */
function hauler(r) {
  return {
    seat: { y: 0.72, z: 0.12, lean: 0 }, ride: 0.44, wheelbase: 0.92, track: 0.88,
    parts: [
      { g: box(1.66, 0.22, 2.7, 0, 0.44, -0.02), c: DARK },
      { g: box(1.56, 0.3, 1.2, 0, 0.7, 0.82), c: r.kart },            // bonnet
      { g: box(1.5, 0.16, 0.5, 0, 0.88, 0.82), c: r.trim },
      // the cab: pillars and a screen, open topped so the driver reads
      { g: box(1.5, 0.5, 0.16, 0, 0.9, -0.05), c: r.kart },
      { g: box(0.16, 0.46, 0.9, 0.7, 0.92, 0.36), c: r.kart },
      { g: box(0.16, 0.46, 0.9, -0.7, 0.92, 0.36), c: r.kart },
      { g: box(1.16, 0.44, 0.07, 0, 1.06, 0.44), c: GLASS },
      { g: box(1.3, 0.1, 0.12, 0, 1.3, 0.44), c: r.trim },
      // grille, lamps and a bumper
      { g: box(1.3, 0.34, 0.12, 0, 0.66, 1.42), c: INK },
      { g: cyl(0.16, 0.16, 0.12, 10, 'z', 0.5, 0.78, 1.44), c: 0xfff6e2 },
      { g: cyl(0.16, 0.16, 0.12, 10, 'z', -0.5, 0.78, 1.44), c: 0xfff6e2 },
      { g: box(1.7, 0.18, 0.2, 0, 0.46, 1.5), c: STEEL },
      { g: box(1.7, 0.18, 0.2, 0, 0.46, -1.42), c: STEEL },
      // the bed, with sides and a toolbox in it
      { g: box(1.56, 0.36, 0.1, 0, 0.72, -1.36), c: r.kart },
      { g: box(0.1, 0.36, 1.1, 0.73, 0.72, -0.86), c: r.kart },
      { g: box(0.1, 0.36, 1.1, -0.73, 0.72, -0.86), c: r.kart },
      { g: box(1.1, 0.26, 0.4, 0, 0.68, -0.52), c: r.trim },
      // a stack up the back of the cab
      { g: cyl(0.1, 0.1, 1.0, 8, 'y', 0.6, 1.2, -0.2), c: STEEL },
      { g: cyl(0.13, 0.13, 0.12, 8, 'y', 0.6, 1.72, -0.2), c: DARK },
      { g: cyl(0.22, 0.22, 0.05, 12, 'z', 0, 1.0, 0.24), c: INK },
    ],
    exhaust: [{ x: 0.6, y: 1.78, z: -0.2 }],
  };
}


/* ---------------------------------------------------------------------------
   Bodies from the kit. Three of the chassis are drawn with a model from
   Kenney's Car Kit once it has loaded: the Formula as its race car, the
   Speeder as its future racer, the Roadster as its go-kart. Each is scaled so
   its wheelbase is the chassis's own, sat so its wheel centres are where the
   chassis hangs its wheels, and painted from the racer: its main colour
   becomes the kart colour and its second the trim. Everything that makes the
   chassis drive the way it does - its stats, its ride height, its exhaust -
   is the chassis's, so a model body changes the look and nothing else.
--------------------------------------------------------------------------- */
const KIT_BODY = {
  formula: { model: 'race', node: 'body', seat: { y: 0.46, z: 0.14 } },
  speeder: { model: 'race-future', node: 'body', seat: { y: 0.5, z: 0.2 } },
  roadster: { model: 'kart-oobi', node: 'kart-oobi' },
};
const HUB_Y = 0.4;            // where the wheel sets put their axle, give or take a few centimetres
function fromKit(id, spec, r) {
  const K = KIT_BODY[id];
  const M = K && kitModel(K.model);
  if (!M || M.wheels.length < 4) return spec;
  const zs = M.wheels.map(w => w.z), xs = M.wheels.map(w => Math.abs(w.x));
  const zF = Math.min(...zs), zB = Math.max(...zs);
  const s = spec.wheelbase / ((zB - zF) / 2);
  const dy = HUB_Y - M.wheels[0].y * s, dz = -((zB + zF) / 2) * s;
  const body = kitPart(K.model, K.node, { scale: s, dy, dz, paint: r.kart, trim: r.trim });
  if (!body) return spec;
  // the model's wheels hang outboard of their node by about half their width
  const track = (Math.max(...xs) + 0.12) * s;
  let seat = spec.seat;
  if (M.char) seat = { y: M.char.y * s + dy - 0.05, z: -(M.char.z * s + dz), lean: 0 };
  else if (K.seat) seat = Object.assign({}, spec.seat, K.seat);
  for (const q of spec.parts) q.g.dispose();
  return Object.assign({}, spec, { parts: [body], track, seat });
}

export const CHASSIS = [
  { id: 'formula', name: 'Formula', make: formula,
    // light and quick, and it will not shove anybody
    stats: { top: 1.06, accel: 1.04, grip: 1.04, weight: 0.82, jump: 1, charge: 1.05, boost: 1 } },
  { id: 'roadster', name: 'Roadster', make: roadster,
    stats: { top: 0.98, accel: 1.12, grip: 1.1, weight: 0.9, jump: 1.05, charge: 1.15, boost: 1.05 } },
  { id: 'buggy', name: 'Buggy', make: buggy,
    // tall springs and a lot of it: it jumps best and shoves hardest
    stats: { top: 0.96, accel: 1, grip: 0.96, weight: 1.22, jump: 1.3, charge: 0.95, boost: 1 } },
  { id: 'speeder', name: 'Speeder', make: speeder,
    stats: { top: 1.12, accel: 0.9, grip: 0.98, weight: 0.86, jump: 0.9, charge: 1, boost: 1.12 } },
  { id: 'hauler', name: 'Hauler', make: hauler,
    // it will move anything it hits and take nothing back
    stats: { top: 0.94, accel: 0.94, grip: 0.9, weight: 1.45, jump: 0.85, charge: 0.9, boost: 1 } },
  /* And three that are not compromises. The five above trade a little of one
     thing for a little of another; these give up a great deal of something to
     be very good at one thing, so which you pick is a plan for the circuit
     rather than a shade of taste. */
  { id: 'bullet', name: 'Bullet', make: bullet,
    // the fastest thing here in a straight line and hopeless everywhere else
    stats: { top: 1.32, accel: 0.7, grip: 0.74, weight: 0.92, jump: 0.8, charge: 0.86, boost: 1.18 } },
  { id: 'dart', name: 'Dart', make: dart,
    // off the line and out of a corner before anything. It used to be gone on
    // a straight as well, by fourteen per cent, and nobody could win in it
    stats: { top: 0.94, accel: 1.4, grip: 1.2, weight: 0.66, jump: 1.12, charge: 1.3, boost: 0.96 } },
  { id: 'tank', name: 'Tank', make: tank,
    // slow at all of it, and nothing on the circuit will move it off its line
    stats: { top: 0.9, accel: 0.84, grip: 0.82, weight: 2, jump: 0.66, charge: 0.86, boost: 1 } },
];

/* ---------------------------------------------------------------------------
   The wheels. Each returns its parts and its radius, and the body sits on
   whatever radius comes back, so a set of knobblies lifts the whole car.
--------------------------------------------------------------------------- */

function slicks(r) {
  const kitWheel = kitPart('wheel-racing', 'wheel-racing', { scale: 0.41 / 0.3, paint: r.trim });
  // turned back round: the kit is read facing the other way for its bodies,
  // which would leave a wheel's rim on its inside face
  if (kitWheel) { kitWheel.g.rotateY(Math.PI); return { r: 0.41, parts: [kitWheel] }; }
  const holes = [];
  for (let n = 0; n < 5; n++) {
    const a = (n / 5) * Math.PI * 2;
    const b = cyl(0.062, 0.062, 0.06, 7, 'x', 0.2, Math.sin(a) * 0.17, 0);
    b.translate(0, 0, Math.cos(a) * 0.17);
    holes.push({ g: b, c: RUBBER });
    const c = b.clone(); c.translate(-0.4, 0, 0);
    holes.push({ g: c, c: RUBBER });
  }
  return { r: 0.41, parts: [
    { g: cyl(0.41, 0.41, 0.34, 16, 'x', 0, 0, 0), c: RUBBER },
    { g: cyl(0.37, 0.37, 0.36, 16, 'x', 0, 0, 0), c: 0x2a3140 },
    { g: cyl(0.29, 0.29, 0.38, 12, 'x', 0, 0, 0), c: r.trim },
    { g: cyl(0.1, 0.1, 0.42, 8, 'x', 0, 0, 0), c: STEEL },
  ].concat(holes) };
}

function knobblies(r) {
  const tread = [];
  for (let n = 0; n < 12; n++) {
    const a = (n / 12) * Math.PI * 2;
    for (const off of [-0.11, 0.11]) {
      const b = box(0.16, 0.12, 0.2, off, Math.sin(a) * 0.46, Math.cos(a) * 0.46);
      b.rotateX(-a);
      const g = box(0.16, 0.12, 0.2, 0, 0, 0);
      g.rotateX(a);
      g.translate(off, Math.sin(a) * 0.46, Math.cos(a) * 0.46);
      tread.push({ g, c: RUBBER });
    }
  }
  return { r: 0.52, parts: [
    { g: cyl(0.46, 0.46, 0.42, 14, 'x', 0, 0, 0), c: 0x232a36 },
    { g: cyl(0.26, 0.26, 0.44, 10, 'x', 0, 0, 0), c: r.trim },
    { g: cyl(0.13, 0.13, 0.48, 8, 'x', 0, 0, 0), c: STEEL },
    { g: cyl(0.3, 0.3, 0.06, 10, 'x', 0.23, 0, 0), c: r.kart },
    { g: cyl(0.3, 0.3, 0.06, 10, 'x', -0.23, 0, 0), c: r.kart },
  ].concat(tread) };
}

function wires(r) {
  const spokes = [];
  for (let n = 0; n < 14; n++) {
    const a = (n / 14) * Math.PI;
    for (const off of [-0.07, 0.07]) {
      const g = box(0.03, 0.72, 0.03, 0, 0, 0);
      g.rotateX(a);
      g.translate(off, 0, 0);
      spokes.push({ g, c: CHROME });
    }
  }
  return { r: 0.44, parts: [
    { g: cyl(0.44, 0.44, 0.2, 18, 'x', 0, 0, 0), c: RUBBER },
    { g: cyl(0.4, 0.4, 0.22, 18, 'x', 0, 0, 0), c: 0x2a3140 },
    { g: cyl(0.38, 0.38, 0.12, 18, 'x', 0, 0, 0), c: r.trim },
    { g: cyl(0.12, 0.12, 0.28, 10, 'x', 0, 0, 0), c: CHROME },
    { g: cyl(0.06, 0.06, 0.34, 8, 'x', 0, 0, 0), c: r.kart },
  ].concat(spokes) };
}

function turbines(r) {
  const vanes = [];
  for (let n = 0; n < 9; n++) {
    const a = (n / 9) * Math.PI * 2;
    const g = box(0.08, 0.3, 0.09, 0, 0.19, 0);
    g.rotateZ(0.5);
    g.rotateX(a);
    g.translate(0.19, 0, 0);
    vanes.push({ g, c: r.kart });
    const c = g.clone(); c.translate(-0.38, 0, 0);
    vanes.push({ g: c, c: r.kart });
  }
  return { r: 0.42, parts: [
    { g: cyl(0.42, 0.42, 0.36, 16, 'x', 0, 0, 0), c: RUBBER },
    { g: cyl(0.34, 0.34, 0.4, 16, 'x', 0, 0, 0), c: r.trim },
    { g: cyl(0.2, 0.2, 0.44, 12, 'x', 0, 0, 0), c: INK },
    { g: cyl(0.09, 0.09, 0.46, 8, 'x', 0, 0, 0), c: r.trim },
  ].concat(vanes) };
}

/* balloons: fat, soft and round. They bounce and they float over anything. */
function balloons(r) {
  return { r: 0.62, parts: [
    { g: cyl(0.62, 0.62, 0.52, 14, 'x', 0, 0, 0), c: RUBBER },
    { g: cyl(0.58, 0.58, 0.62, 14, 'x', 0, 0, 0), c: 0x2a3140 },
    { g: cyl(0.3, 0.3, 0.56, 10, 'x', 0, 0, 0), c: r.trim },
    { g: cyl(0.14, 0.14, 0.6, 8, 'x', 0, 0, 0), c: STEEL },
    { g: cyl(0.34, 0.34, 0.08, 10, 'x', 0.28, 0, 0), c: r.kart },
    { g: cyl(0.34, 0.34, 0.08, 10, 'x', -0.28, 0, 0), c: r.kart },
  ] };
}

/* blades: a razor with a rim, all grip and nothing under it off the tarmac */
function blades(r) {
  const spokes = [];
  for (let n = 0; n < 5; n++) {
    const a = (n / 5) * Math.PI;
    const g = box(0.06, 0.94, 0.06, 0, 0, 0);
    g.rotateX(a);
    spokes.push({ g, c: CHROME });
  }
  return { r: 0.5, parts: [
    { g: cyl(0.5, 0.5, 0.16, 20, 'x', 0, 0, 0), c: RUBBER },
    { g: cyl(0.46, 0.46, 0.18, 20, 'x', 0, 0, 0), c: 0x1b2230 },
    { g: cyl(0.42, 0.42, 0.1, 20, 'x', 0, 0, 0), c: r.trim },
    { g: cyl(0.12, 0.12, 0.22, 8, 'x', 0, 0, 0), c: STEEL },
    { g: cyl(0.2, 0.2, 0.05, 10, 'x', 0.1, 0, 0), c: r.kart },
  ].concat(spokes) };
}

/* rollers: drums off a steamroller. They hold a speed and not a line. */
function rollers(r) {
  const ribs = [];
  for (let n = 0; n < 8; n++) {
    const a = (n / 8) * Math.PI;
    const g = box(0.62, 0.1, 0.1, 0, 0, 0);
    g.rotateX(a);
    g.translate(0, Math.sin(a) * 0.46, Math.cos(a) * 0.46);
    ribs.push({ g, c: STEEL });
  }
  return { r: 0.5, parts: [
    { g: cyl(0.5, 0.5, 0.66, 12, 'x', 0, 0, 0), c: 0x5d636e },
    { g: cyl(0.52, 0.52, 0.12, 12, 'x', 0.3, 0, 0), c: r.trim },
    { g: cyl(0.52, 0.52, 0.12, 12, 'x', -0.3, 0, 0), c: r.trim },
    { g: cyl(0.15, 0.15, 0.72, 8, 'x', 0, 0, 0), c: STEEL },
    { g: cyl(0.3, 0.3, 0.1, 10, 'x', 0, 0, 0), c: r.kart },
  ].concat(ribs) };
}

export const WHEELS = [
  { id: 'slick', name: 'Slicks', make: slicks,
    stats: { top: 1.04, accel: 1, grip: 1.08, weight: 1, jump: 1, charge: 1, boost: 1 } },
  { id: 'knobbly', name: 'Knobblies', make: knobblies,
    // they hardly notice the rough, and they are heavy
    stats: { top: 0.94, accel: 1.02, grip: 1, weight: 1.16, jump: 1.15, charge: 0.96, boost: 1, rough: 1.4 } },
  { id: 'wire', name: 'Wires', make: wires,
    stats: { top: 1.02, accel: 1.1, grip: 1.02, weight: 0.84, jump: 1.08, charge: 1.12, boost: 1 } },
  { id: 'turbine', name: 'Turbines', make: turbines,
    stats: { top: 1.08, accel: 0.94, grip: 1.12, weight: 0.96, jump: 0.95, charge: 1, boost: 1.1 } },
  { id: 'balloon', name: 'Balloons', make: balloons,
    // they float over the rough and they will not hold a fast corner
    stats: { top: 0.88, accel: 1.06, grip: 0.92, weight: 1.12, jump: 1.5, charge: 1, boost: 1, rough: 1.8 } },
  { id: 'blade', name: 'Blades', make: blades,
    // all the grip there is on tarmac, and nothing at all off it
    stats: { top: 1, accel: 1.08, grip: 1.34, weight: 0.78, jump: 0.82, charge: 1.18, boost: 1, rough: 0.55 } },
  { id: 'roller', name: 'Rollers', make: rollers,
    // they hold a speed rather than a line
    stats: { top: 1.16, accel: 0.9, grip: 0.76, weight: 1.08, jump: 0.88, charge: 0.9, boost: 1.1 } },
];

/* ---------------------------------------------------------------------------
   The trail. What comes out of the exhausts when you are on a boost, and what
   the drift throws off the back wheels. Each one is a shape and a pair of
   colours; the racer's own colour is mixed in so it still reads as yours.
--------------------------------------------------------------------------- */
export const TRAILS = [
  { id: 'spark', name: 'Sparks', shape: 'spark', hot: 0xffd233, cool: 0xff8a1f, size: 1,
    stats: { charge: 1.05 } },
  { id: 'flame', name: 'Flames', shape: 'flame', hot: 0xfff0a8, cool: 0xff3d18, size: 1.35,
    stats: { boost: 1.12, top: 1.02 } },
  { id: 'bubble', name: 'Bubbles', shape: 'bubble', hot: 0xdff2ff, cool: 0x8fd3ff, size: 1.15,
    stats: { jump: 1.18, grip: 1.02 } },
  { id: 'star', name: 'Stars', shape: 'star', hot: 0xfff6e2, cool: 0xffd233, size: 1.2,
    stats: { accel: 1.1, charge: 1.08 } },
  { id: 'bolt', name: 'Bolts', shape: 'bolt', hot: 0xd8f0ff, cool: 0x7a5cff, size: 0.95,
    stats: { weight: 1.12, boost: 1.06 } },
  { id: 'ember', name: 'Embers', shape: 'flame', hot: 0xffb066, cool: 0x8c2410, size: 1.5,
    stats: { boost: 1.22, grip: 0.92 } },
  { id: 'frost', name: 'Frost', shape: 'bubble', hot: 0xffffff, cool: 0x7fd4f0, size: 1.1,
    stats: { grip: 1.16, top: 0.95 } },
  { id: 'ghost', name: 'Ghost', shape: 'spark', hot: 0xe8e2ff, cool: 0x6a5acd, size: 1.25,
    stats: { weight: 0.78, accel: 1.14 } },
];

/* ---------------------------------------------------------------------------
   The driver. One look, not a choice: what you build is the car, and the person
   in it is whoever you picked off the grid. Every piece is painted out of the
   racer, so it is still their helmet and their colours.
--------------------------------------------------------------------------- */
export function driverHead(r) {
  return [
    { g: ball(0.4, 0, 0.3, 0), c: r.cap },                        // helmet
    { g: box(0.84, 0.1, 0.5, 0, 0.5, -0.05), c: r.trim },         // a stripe over it
    { g: box(0.5, 0.12, 0.14, 0, 0.16, 0.36), c: r.trim },        // chin bar
    { g: cyl(0.09, 0.09, 0.16, 8, 'x', 0.38, 0.28, 0), c: r.trim },
    { g: cyl(0.09, 0.09, 0.16, 8, 'x', -0.38, 0.28, 0), c: r.trim },
    { g: box(0.6, 0.26, 0.1, 0, 0.24, 0.29), c: 0x12203a },       // visor
    { g: box(0.62, 0.06, 0.09, 0, 0.38, 0.3), c: r.trim },
  ];
}
export function driverBody(r, st) {
  return [
    { g: box(0.52, 0.44, 0.34, 0, st.y + 0.48, st.z), c: r.shirt },
    { g: box(0.42, 0.14, 0.3, 0, st.y + 0.3, st.z + 0.04), c: r.trim },
    { g: box(0.2, 0.1, 0.32, 0, st.y + 0.58, st.z + 0.03), c: r.trim },
  ];
}

/* ---- what a build is ----------------------------------------------------- */
const pick = (list, id, n) => {
  const i = list.findIndex(p => p.id === id);
  return list[i >= 0 ? i : ((n | 0) % list.length + list.length) % list.length];
};
export function normalise(build) {
  const b = build || {};
  return {
    chassis: pick(CHASSIS, b.chassis, 0).id,
    wheels: pick(WHEELS, b.wheels, 0).id,
    trail: pick(TRAILS, b.trail, 0).id,
  };
}

/* What a build is worth to drive.

   Every part carries a handful of multipliers and they are simply multiplied
   together, so a light body on wire wheels is quick to get going and will be
   shoved around, and a hauler on knobblies is slow, sure footed and will move
   anything it touches. There is no best build: everything that is up somewhere
   is down somewhere else. */
export function statsOf(build) {
  const b = normalise(build);
  const out = { top: 1, accel: 1, grip: 1, weight: 1, jump: 1, charge: 1, boost: 1, rough: 1 };
  for (const part of [chassisOf(b.chassis), wheelsOf(b.wheels), trailOf(b.trail)]) {
    const st = part && part.stats;
    if (!st) continue;
    for (const k in out) if (st[k] !== undefined) out[k] *= st[k];
  }
  /* Acceleration and the mini turbo go together, the way they do in Mario
     Kart 8: a car that gets off the line well charges its drifts well. Every
     part still counts towards both - the one they share is the middle of the
     two the parts added up to - but they no longer pull apart, so the two
     bars always sit level. */
  const both = Math.sqrt(out.accel * out.charge);
  out.accel = out.charge = both;
  return out;
}
export const chassisOf = id => {
  const c = pick(CHASSIS, id, 0);
  return KIT_BODY[c.id] ? Object.assign({}, c, { make: r => fromKit(c.id, c.make(r), r) }) : c;
};
export const wheelsOf = id => pick(WHEELS, id, 0);
export const trailOf = id => pick(TRAILS, id, 0);


/* ---------------------------------------------------------------------------
   Putting a look on the wire. The lobby already relays one number per player
   for which racer they picked, so the build travels inside that number rather
   than as a new message: eight racers times five bodies times four wheel sets
   times five trails is eight hundred values, which fits in the integer that was
   already being sent. Nothing on the server had to learn about any of this.
--------------------------------------------------------------------------- */
const ORDER = [['chassis', CHASSIS], ['wheels', WHEELS], ['trail', TRAILS]];
/* How many different looks the parts alone make, times eight for the racer.
   Everything above that is the paint.

   Fixed room per list rather than however many there happen to be. Worked out
   from the live lengths, the whole number shifts every time a part is added:
   every look ever saved or sent decodes to a different car, and two people in
   a lobby on either side of a deploy see each other in the wrong ones. Sixteen
   slots each is room to keep adding without any of that happening again. */
const SLOTS = 16;
const SPAN = 8 * Math.pow(SLOTS, ORDER.length);

/* One number for the whole car: which racer, which parts, and a colour off the
   wheel if one was picked. Colour 0 means "the racer's own", so a car sent
   before there was a wheel still decodes to exactly what it was. It stays well
   inside the integers a double holds exactly, and it is never put through | 0,
   which would cut it to 32 bits and lose the paint. */
export function packLook(cast, build, colour) {
  const b = normalise(build);
  let n = 0;
  for (let i = ORDER.length - 1; i >= 0; i--) {
    const list = ORDER[i][1];
    n = n * SLOTS + Math.max(0, list.findIndex(x => x.id === b[ORDER[i][0]]));
  }
  const paint = colour === null || colour === undefined ? 0 : (colour & 0xffffff) + 1;
  return (cast & 7) + 8 * n + SPAN * paint;
}
export function unpackLook(n) {
  let r = Math.max(0, Math.floor(+n) || 0);
  const paint = Math.floor(r / SPAN);
  r = r % SPAN;
  const cast = r & 7;
  r = Math.floor(r / 8);
  const build = {};
  for (const pair of ORDER) {
    // a slot nothing has been put in yet reads as the first of its list
    build[pair[0]] = (pair[1][r % SLOTS] || pair[1][0]).id;
    r = Math.floor(r / SLOTS);
  }
  return { cast, build, colour: paint > 0 ? paint - 1 : null };
}
