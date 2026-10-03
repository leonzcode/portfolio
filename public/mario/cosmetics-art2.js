/* ---------------------------------------------------------------------------
   Leon Kart - the prizes, as shapes.

   The second batch of cosmetics, and the ones that are won rather than picked:
   a hat and a flag for each of the five tracks, a laurel for the best across
   all of them, a helm and a shield for ranked, and a run of rewards for ranked
   wins that ends in a kart made out of a trophy.

   Same rules as cosmetics-art.js. Every item is a part list of { g, c } pairs,
   plain non-indexed geometry with normals and one colour each, which the game
   merges into one mesh with its colours in the vertices. Sizes are metres and
   the nose is +z; the helpers negate z once on the way in.

   Prizes have fixed identities, so they mostly carry their own colours: a
   Glacier Pass flag is ice blue whoever wins it. Third places carry a little
   bronze medal or bronze trim, so they read as a podium.

   Frames, the same as the first batch:
   - HATS: origin at the top centre of the driver's head, the head a ~0.55 m
     block below it (y -0.55..0), face towards +z.
   - DECOR: origin at a mount on top of the kart's tail, +z forward.
   - GLIDERS: origin at the glider mount above the driver, driver below.
   - THEMED_BODIES: a chassis spec like formula() in parts.js; the game adds
     the wheels at (+-track, axle, +-wheelbase) and the driver at the seat.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { box, cyl, ball, taper, hoop, INK, STEEL, DARK, RUBBER, GLASS, CHROME } from './parts.js?v=103';

const TAU = Math.PI * 2;
const WHITE = 0xf7f6f1, GOLD = 0xffd233, GOLD_DK = 0xd9a520, GOLD_LT = 0xffe98a;
const WOOD = 0x8a5a33, BLACK = 0x15161a;
const BRONZE = 0xcd7f32, BRONZE_DK = 0x8f5524, BRONZE_LT = 0xeaa862;
const P = (g, c) => ({ g, c });

/* ---- shapes, the same ones the first batch builds with --------------------- */

// a colour, lighter or darker
function shade(hex, k) {
  const f = v => Math.max(0, Math.min(255, Math.round(v * k)));
  return (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
}

/* Place a piece that was built at the origin. The turns are in the sketch
   frame: rx tips its top towards the nose, ry swings its nose towards +x, rz
   lifts its +x side. They are applied in that order (rz, rx, ry), then it is
   moved to (x, y, z) with z forward. */
function at(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(-rx);
  if (ry) g.rotateY(-ry);
  g.translate(x, y, -z);
  return g;
}
// several pieces built about the origin, placed together
function place(parts, x, y, z, rx = 0, ry = 0, rz = 0) {
  for (const p of parts) at(p.g, x, y, z, rx, ry, rz);
  return parts;
}

// a tube from one point to another, thicker at one end if asked
const V3 = p => new THREE.Vector3(p[0], p[1], -p[2]);
const UP = new THREE.Vector3(0, 1, 0);
function rod(a, b, ra = 0.03, rb = ra, seg = 6) {
  const A = V3(a), B = V3(b), d = B.clone().sub(A);
  const len = Math.max(1e-4, d.length());
  const g = new THREE.CylinderGeometry(rb, ra, len, seg).toNonIndexed();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// a smooth tube along a curve through the points, for handles
function tube(pts, rad, seg = 16, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(pts.map(V3));
  const g = new THREE.TubeGeometry(curve, seg, rad, radial, false).toNonIndexed();
  g.deleteAttribute('uv');
  return g;
}

/* A flat outline given a thickness, for fins, flags, wings and stars.
   'front': the outline is drawn in (x, y), facing forwards.
   'side':  drawn in (z, y), seen from the side, thickness across the car.
   'top':   drawn in (x, z), seen from above, thickness up and down. */
function slab(pts, thick, plane, x = 0, y = 0, z = 0) {
  const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  let g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 2 });
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  g.clearGroups();
  g.translate(0, 0, -thick / 2);
  if (plane === 'side') g.rotateY(Math.PI / 2);
  else if (plane === 'top') g.rotateX(-Math.PI / 2);
  g.translate(x, y, -z);
  return g;
}
// a star with its edges cut at an angle, so it catches the light like metal
function chunkyStar(n, R, r, depth, bev, x = 0, y = 0, z = 0) {
  const shape = new THREE.Shape(star(n, R, r).map(p => new THREE.Vector2(p[0], p[1])));
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.7, bevelSegments: 1, curveSegments: 2 });
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  g.clearGroups();
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  g.translate(x, y, -z);
  return g;
}

// a smooth sphere, squashed if asked
function sphere(r, x, y, z, sx = 1, sy = 1, sz = 1, w = 12, h = 8) {
  const g = new THREE.SphereGeometry(r, w, h).toNonIndexed();
  g.scale(sx, sy, sz);
  g.translate(x, y, -z);
  return g;
}
// the top of a sphere down to theta, or a wedge of it, squashed in height
function dome(r, x, y, z, sy = 1, theta = Math.PI / 2, w = 16, h = 5, phi0 = 0, phiLen = TAU) {
  const g = new THREE.SphereGeometry(r, w, h, phi0, phiLen, 0, theta).toNonIndexed();
  g.scale(1, sy, 1);
  g.translate(x, y, -z);
  return g;
}
// an upright cylinder squashed into an ellipse
function ecyl(rx, rz, h, seg, x, y, z, rTop = 1, rBot = 1) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg).toNonIndexed();
  g.scale(rx, 1, rz);
  g.translate(x, y, -z);
  return g;
}
/* Part of an upright cylinder's wall, open, between two angles measured from
   the nose round towards +x. kBot widens the bottom edge. A thin shell, so it
   goes through twoSided. */
function wall(rx, rz, h, y, a0, a1, seg = 16, kBot = 1) {
  const g = new THREE.CylinderGeometry(1, kBot, h, seg, 1, true, Math.PI - a1, a1 - a0).toNonIndexed();
  g.scale(rx, 1, rz);
  g.translate(0, y, 0);
  return g;
}
// a flat ring lying level, round or elliptical
function ring(rx, rz, tube, x, y, z, seg = 28) {
  const g = new THREE.TorusGeometry(1, tube, 5, seg).toNonIndexed();
  g.rotateX(Math.PI / 2);
  // scale the ring, not the tube: push each vertex out along its own radius
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vz = p.getZ(i), d = Math.hypot(vx, vz) || 1;
    const cx = vx / d, cz = vz / d;
    p.setX(i, cx * rx + (vx - cx)); p.setZ(i, cz * rz + (vz - cz));
  }
  g.computeVertexNormals();
  g.translate(x, y, -z);
  return g;
}
// the same, but only part of the way round, between two angles from the nose
function arc(rx, rz, tube, y, a0, a1, seg = 16, radial = 5) {
  const g = new THREE.TorusGeometry(1, tube, radial, seg, a1 - a0).toNonIndexed();
  g.rotateZ(a0 - Math.PI / 2);
  g.rotateX(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vz = p.getZ(i), d = Math.hypot(vx, vz) || 1;
    const cx = vx / d, cz = vz / d;
    p.setX(i, cx * rx + (vx - cx)); p.setZ(i, cz * rz + (vz - cz));
  }
  g.computeVertexNormals();
  g.translate(0, y, 0);
  return g;
}
// a brim: a flat elliptical ring, rx by rz, lying level with its hole at the centre
function brim(rIn, rx, rz, seg = 28) {
  const g = new THREE.RingGeometry(rIn, 1, seg, 3).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  g.scale(rx, 1, rz);
  return g;
}
// a thin flat band lying level, for lines woven into a brim
function annulus(rIn, rOut, rx, rz, seg = 28) {
  const g = new THREE.RingGeometry(rIn, rOut, seg, 1).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  g.scale(rx, 1, rz);
  return g;
}
/* Bend a level brim: the sides roll up (side) and the front and back dip
   (dip), each growing with the square of the distance past where the crown
   stops. */
function curl(g, side, dip, from = 0.3) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)), z = Math.abs(p.getZ(i));
    p.setY(i, p.getY(i) + side * Math.max(0, x - from) ** 2 - dip * Math.max(0, z - from * 0.8) ** 2);
  }
  g.computeVertexNormals();
  return g;
}
// a cup or a bowl turned on a lathe: a profile of [radius, height] pairs
function lathe(profile, seg, x = 0, y = 0, z = 0) {
  const g = new THREE.LatheGeometry(profile.map(([rr, h]) => new THREE.Vector2(rr, h)), seg).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(x, y, -z);
  return g;
}
// faceted shading, so a low-segment shape reads as cut rather than smooth
function faceted(g) { g.computeVertexNormals(); return g; }

/* The same faces turned inside out. A thin shell is only one face thick and
   the game's material draws front faces only, so it is drawn twice. */
function flip(g) {
  for (const name of ['position', 'normal']) {
    const a = g.attributes[name].array;
    for (let i = 0; i < a.length; i += 9) {
      for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
    }
  }
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}
const twoSided = (g, c, cIn = c) => [P(g, c), P(flip(g.clone()), cIn)];

// a star outline, n points, for slabs
function star(n, R, r, rot = 0) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU, k = i % 2 ? r : R;
    pts.push([Math.sin(a) * k, Math.cos(a) * k]);
  }
  return pts;
}
// mirror an outline in x
const mx = pts => pts.map(([x, z]) => [-x, z]);

// move every vertex of a part list by a function of where it is (sketch frame)
function warp(parts, fn) {
  for (const p of parts) {
    const a = p.g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const q = fn(a.getX(i), a.getY(i), -a.getZ(i));
      a.setXYZ(i, q[0], q[1], -q[2]);
    }
    p.g.computeVertexNormals();
  }
  return parts;
}

// axles joining the wheels to a body narrower than the track
function axles(track, wb, y = 0.41) {
  return [
    P(rod([-track + 0.12, y, wb], [track - 0.12, y, wb], 0.055), DARK),
    P(rod([-track + 0.12, y, -wb], [track - 0.12, y, -wb], 0.055), DARK),
  ];
}
// a steering wheel on a short column, standing in front of the seat
function steering(y, z, lift = 0.18) {
  return [
    P(rod([0, y, z + 0.12], [0, y + lift, z], 0.04), DARK),
    P(cyl(0.17, 0.17, 0.05, 12, 'z', 0, y + lift + 0.02, z - 0.02), INK),
  ];
}

// a bronze medal facing forward, centred on the origin: the mark of third place
function medal(s = 1) {
  return [
    P(cyl(0.082 * s, 0.082 * s, 0.022, 14, 'z', 0, 0, -0.006), BRONZE_DK),
    P(cyl(0.066 * s, 0.066 * s, 0.03, 14, 'z', 0, 0, 0), BRONZE),
    P(slab(star(5, 0.05 * s, 0.021 * s), 0.014, 'front', 0, -0.003 * s, 0.018), BRONZE_LT),
  ];
}

/* A point on an ellipsoid centred at (0, cy, 0) with radii rx, ry, rz: a is
   the angle from the nose round towards +x, e the height above its equator
   as an angle. k pushes it out (or in) from the surface. */
const onShell = (rx, ry, rz, cy, a, e, k = 1) =>
  [Math.sin(a) * Math.cos(e) * rx * k, cy + Math.sin(e) * ry * k, Math.cos(a) * Math.cos(e) * rz * k];
// a line of thin rods over an ellipsoid at angle a, from height e0 over the top to e1
function meridian(rx, ry, rz, cy, a, e0, e1, n, rad, c) {
  const out = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const q = onShell(rx, ry, rz, cy, a, e0 + (e1 - e0) * (i / n), 1.0 + rad / Math.min(rx, ry, rz));
    if (prev) out.push(P(rod(prev, q, rad, rad, 4), c));
    prev = q;
  }
  return out;
}

/* ===========================================================================
   HATS. Origin at the top centre of the head; the head is a ~0.55 m block
   below it, face towards +z.
=========================================================================== */

/* a sunflower, facing +z at the origin, about 0.2 across */
function sunflower(s = 1) {
  const parts = [
    P(cyl(0.046 * s, 0.046 * s, 0.03, 12, 'z', 0, 0, 0.012), 0x5a3416),
    P(cyl(0.028 * s, 0.028 * s, 0.034, 10, 'z', 0, 0, 0.015), 0x3a200c),
  ];
  for (let i = 0; i < 12; i++) {
    parts.push(P(at(box(0.04 * s, 0.062 * s, 0.014, 0, 0.072 * s, 0), 0, 0, 0, 0, 0, (i / 12) * TAU), 0xffc61a));
    parts.push(P(at(box(0.034 * s, 0.05 * s, 0.012, 0, 0.066 * s, -0.008), 0, 0, 0, 0, 0, ((i + 0.5) / 12) * TAU), 0xf09a12));
  }
  return parts;
}

const HATS = {
  /* Sunfield Loop: a wide straw farmer's hat, a green band with a bronze
     medal for a buckle, and a sunflower tucked in at the side */
  meadow: (r) => {
    const STRAW = 0xeac66c, STRAW_DK = 0xc39a45, BAND = 0x2e7d32, LEAF = 0x3f9a44;
    const K = [0.75, 0.3, 0.34];                          // how the brim curls
    const b = curl(brim(0.29, 0.7, 0.66, 32), ...K);
    b.translate(0, -0.085, 0);
    const parts = [...twoSided(b, STRAW, STRAW_DK)];
    // woven lines round the brim, following its curl, and a bound edge
    for (const k of [0.58, 0.8]) {
      const g = curl(annulus(k, k + 0.035, 0.7, 0.66, 32), ...K);
      g.translate(0, -0.079, 0);
      parts.push(P(g, STRAW_DK));
    }
    { const g = curl(ring(0.7, 0.66, 0.016, 0, 0, 0, 32), ...K); g.translate(0, -0.085, 0); parts.push(P(g, STRAW_DK)); }
    parts.push(
      P(ecyl(0.33, 0.33, 0.27, 20, 0, 0.04, 0, 0.88, 1), STRAW),
      P(dome(0.29, 0, 0.175, 0, 0.32, Math.PI / 2, 20, 4), STRAW),
      P(ecyl(0.342, 0.342, 0.075, 20, 0, -0.045, 0, 0.985, 1), BAND),
    );
    parts.push(...place(medal(0.72), 0, -0.04, 0.342, -0.05));
    // the sunflower, with two leaves behind it, tucked in the band at the side
    const fl = sunflower(1.05);
    fl.push(
      P(at(sphere(0.05, 0, 0, 0, 0.5, 1.6, 0.2, 6, 4), 0, 0, 0, 0, 0, -0.9), LEAF),
      P(at(sphere(0.05, 0, 0, 0, 0.5, 1.4, 0.2, 6, 4), 0, 0, 0, 0, 0, 0.7), shade(LEAF, 0.8)),
    );
    fl[fl.length - 2].g.translate(0.09, 0.07, 0.01);
    fl[fl.length - 1].g.translate(-0.08, 0.08, 0.01);
    const a = -0.85;
    parts.push(...place(fl, Math.sin(a) * 0.365, -0.02, Math.cos(a) * 0.365, -0.35, a));
    return parts;
  },

  /* Redrock Dunes: a pith helmet in sand, a terracotta band, goggles with
     sky blue lenses resting on the front, and a bronze button on top */
  dunes: (r) => {
    const SAND = 0xe9d4a4, SAND_DK = 0xc6a874, TERRA = 0xc65a2e, LEATHER = 0x6b4226, LENS = 0x6cc4ff;
    const CY = -0.05, RX = 0.335, RY = 0.34, RZ = 0.37;
    const crown = new THREE.SphereGeometry(1, 20, 7, 0, TAU, 0, Math.PI / 2).toNonIndexed();
    crown.scale(RX, RY, RZ);
    crown.translate(0, CY, 0);
    // the brim: a sloping skirt, longer at the front and the back
    const skirt = new THREE.CylinderGeometry(1, 1, 0.11, 24, 1, true).toNonIndexed();
    const sp = skirt.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const top = sp.getY(i) > 0;
      sp.setX(i, sp.getX(i) * (top ? RX : 0.5));
      sp.setZ(i, sp.getZ(i) * (top ? RZ : 0.6));
    }
    skirt.computeVertexNormals();
    skirt.translate(0, CY - 0.055, 0);
    const parts = [
      P(crown, SAND),
      ...twoSided(skirt, SAND, SAND_DK),
      P(ring(0.5, 0.6, 0.016, 0, CY - 0.11, 0, 32), BRONZE),
      P(ecyl(RX + 0.008, RZ + 0.008, 0.075, 22, 0, CY + 0.03, 0, 0.99, 1), TERRA),
      // the vent on top, in bronze
      P(cyl(0.06, 0.075, 0.04, 12, 'y', 0, CY + RY + 0.005, 0), BRONZE),
      P(dome(0.05, 0, CY + RY + 0.025, 0, 0.7, Math.PI / 2, 10, 3), BRONZE_LT),
    ];
    // seams down the crown, front to back and side to side
    for (const a of [0, Math.PI / 2]) parts.push(...meridian(RX, RY, RZ, CY, a, 0.42, Math.PI - 0.42, 8, 0.011, SAND_DK));
    // goggles pushed up on the front: a strap round the crown, two lenses
    const e = 0.36, ce = Math.cos(e);
    parts.push(P(ring(RX * ce + 0.014, RZ * ce + 0.014, 0.02, 0, CY + RY * Math.sin(e), 0, 24), LEATHER));
    for (const sx of [1, -1]) {
      const a = sx * 0.33, q = onShell(RX, RY, RZ, CY, a, e, 1.03);
      parts.push(...place([
        P(cyl(0.078, 0.078, 0.05, 14, 'z', 0, 0, 0), BRONZE),
        P(cyl(0.06, 0.06, 0.056, 14, 'z', 0, 0, 0.004), LENS),
        P(at(box(0.016, 0.06, 0.006, 0, 0, 0), -0.018, 0.012, 0.034, 0, 0, -0.6), 0xe8f7ff),
      ], q[0], q[1], q[2], -0.38, a));
    }
    parts.push(P(box(0.07, 0.026, 0.03, 0, CY + RY * Math.sin(e), RZ * ce + 0.035), BRONZE_DK));
    return parts;
  },

  /* Glacier Pass: a fur trapper hat with the ear flaps down, pale grey fur,
     a blue top, and a bronze star on the turned-up front */
  frost: (r) => {
    const FUR = 0xe6e9ee, FUR_DK = 0xc4cad3, FUR_SH = 0xd3d8df, TOP = 0x2f6fc8, TOP_DK = 0x22569e;
    const parts = [
      P(ecyl(0.33, 0.33, 0.17, 20, 0, 0.05, 0), TOP),
      P(dome(0.33, 0, 0.135, 0, 0.36, Math.PI / 2, 20, 4), TOP),
      P(ball(0.035, 0, 0.255, 0), TOP_DK),
      // seams on the cloth top, side to side and front to back
      ...meridian(0.335, 0.12, 0.335, 0.135, 0, 0.0, Math.PI, 8, 0.009, TOP_DK),
      ...meridian(0.335, 0.12, 0.335, 0.135, Math.PI / 2, 0.0, Math.PI, 8, 0.009, TOP_DK),
    ];
    // the fur: a fat roll round the crown, lumpy, so it reads as fur
    parts.push(P(ring(0.37, 0.37, 0.085, 0, -0.02, 0, 20), FUR));
    for (let i = 0; i < 14; i++) {
      const a = ((i + 0.5) / 14) * TAU;
      parts.push(P(at(sphere(0.085, 0, 0, 0, 1.55, 0.95, 0.9, 8, 5), Math.sin(a) * 0.38, -0.015 + (i % 2) * 0.015, Math.cos(a) * 0.38, 0, a), i % 3 === 0 ? FUR_SH : FUR));
    }
    // the turned-up front: a thick fur panel standing up over the brow
    parts.push(...twoSided(wall(0.43, 0.43, 0.2, 0.09, -0.95, 0.95, 12, 1.03), FUR, FUR_DK));
    for (let i = 0; i < 6; i++) {
      const a = -0.8 + i * (1.6 / 5);
      parts.push(P(at(sphere(0.06, 0, 0, 0, 1.6, 0.85, 0.85, 8, 5), Math.sin(a) * 0.428, 0.19, Math.cos(a) * 0.428, 0, a), i % 2 ? FUR_SH : FUR));
    }
    // the flap round the back of the neck, with a rolled hem
    parts.push(
      ...twoSided(wall(0.395, 0.395, 0.26, -0.15, 1.75, TAU - 1.75, 12, 1.05), FUR, FUR_DK),
      P(arc(0.41, 0.41, 0.05, -0.28, 1.75, TAU - 1.75, 12, 5), FUR),
    );
    // ear flaps: thick rounded pads hanging down over the ears, and their ties
    const pad = [[0.17, 0.02], [-0.17, 0.02], [-0.18, -0.24], [-0.13, -0.36], [-0.05, -0.41], [0.05, -0.41], [0.13, -0.36], [0.18, -0.24]];
    for (const sx of [1, -1]) {
      parts.push(
        P(at(slab(pad, 0.085, 'side'), sx * 0.38, -0.03, -0.02, 0, 0, sx * 0.08), FUR),
        P(at(slab(pad.map(([z, y]) => [z * 0.8, y * 0.86 - 0.01]), 0.09, 'side'), sx * 0.38, -0.03, -0.02, 0, 0, sx * 0.08), FUR_SH),
        P(rod([sx * 0.36, -0.44, 0.0], [sx * 0.34, -0.6, 0.05], 0.013, 0.013, 4), TOP_DK),
        P(sphere(0.03, sx * 0.34, -0.61, 0.05, 1, 1, 1, 8, 5), TOP_DK),
      );
    }
    parts.push(...place(medal(1.0), 0, 0.075, 0.445, -0.08));
    return parts;
  },

  /* Neon Mile: a dark cyber helmet with a glowing visor across the eyes,
     pink and cyan light strips over the shell, and a bronze badge */
  neon: (r) => {
    const SHELL = 0x1c1d28, SHELL_HI = 0x30324a, PINK = 0xff2bd6, CYAN = 0x2af4ff, VISOR = 0x22d8ff;
    const RX = 0.37, RY = 0.32, RZ = 0.39, CY = -0.12;
    const shell = new THREE.SphereGeometry(1, 20, 7, 0, TAU, 0, Math.PI / 2).toNonIndexed();
    shell.scale(RX, RY, RZ);
    shell.translate(0, CY, 0);
    const parts = [
      P(shell, SHELL),
      ...twoSided(wall(RX, RZ, 0.3, CY - 0.15, 1.05, TAU - 1.05, 18), SHELL, 0x0e0f16),
      // the visor, wrapped round the front, edged in pink
      ...twoSided(wall(RX + 0.016, RZ + 0.016, 0.15, CY - 0.08, -1.15, 1.15, 16), VISOR, 0x0b3a52),
      P(arc(RX + 0.02, RZ + 0.02, 0.014, CY - 0.005, -1.2, 1.2, 16, 4), PINK),
      P(arc(RX + 0.02, RZ + 0.02, 0.014, CY - 0.155, -1.2, 1.2, 16, 4), PINK),
      // a bright line through the visor, where the eyes are
      ...twoSided(wall(RX + 0.02, RZ + 0.02, 0.025, CY - 0.08, -1.0, 1.0, 14), 0xe8ffff, 0x0b3a52),
      // a light strip round the lower edge of the shell
      P(arc(RX + 0.008, RZ + 0.008, 0.012, CY - 0.27, 1.1, TAU - 1.1, 18, 4), CYAN),
    ];
    // light strips over the top, front to back: cyan down the middle, pink beside it
    for (const [xo, c] of [[0, CYAN], [0.15, PINK], [-0.15, PINK]]) {
      const k = Math.sqrt(1 - (xo / RX) ** 2), n = 9;
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const t = 0.45 + (i / n) * (Math.PI - 0.45);
        const q = [xo, CY + RY * k * Math.sin(t) * 1.03, RZ * k * Math.cos(t) * 1.03];
        if (prev) parts.push(P(rod(prev, q, 0.013, 0.013, 4), c));
        prev = q;
      }
    }
    // pods over the ears with glowing rings
    for (const sx of [1, -1]) {
      parts.push(
        P(cyl(0.095, 0.095, 0.06, 14, 'x', sx * (RX + 0.01), CY - 0.09, -0.04), SHELL_HI),
        P(cyl(0.07, 0.07, 0.07, 14, 'x', sx * (RX + 0.012), CY - 0.09, -0.04), CYAN),
        P(cyl(0.045, 0.045, 0.076, 12, 'x', sx * (RX + 0.012), CY - 0.09, -0.04), SHELL),
      );
    }
    parts.push(...place(medal(0.6), 0, CY + 0.055, RZ - 0.004, -0.2));
    return parts;
  },

  /* Ember Hollow: an obsidian helmet in cut facets, lava glowing in its
     cracks, two curved horns with glowing tips, and a bronze brow */
  ember: (r) => {
    const OBS = 0x221d27, OBS_HI = 0x3a3344, LAVA = 0xff5a0a, LAVA_HI = 0xffb21e, LAVA_DK = 0xd2360a;
    const RX = 0.375, RY = 0.33, RZ = 0.395, CY = -0.1;
    const shell = new THREE.SphereGeometry(1, 12, 5, 0, TAU, 0, Math.PI / 2).toNonIndexed();
    shell.scale(RX, RY, RZ);
    shell.translate(0, CY, 0);
    const parts = [
      P(faceted(shell), OBS),
      ...twoSided(faceted(wall(RX, RZ, 0.3, CY - 0.15, 1.0, TAU - 1.0, 9, 0.96)), OBS, 0x0e0c10),
      P(ring(RX + 0.012, RZ + 0.012, 0.03, 0, CY, 0, 24), BRONZE),
    ];
    // the cracks: jagged lines over the shell, hotter in some stretches than others
    const crack = (pts, rad = 0.017) => {
      const q = pts.map(([a, e]) => onShell(RX, RY, RZ, CY, a, e, 1.0));
      for (let i = 0; i < q.length - 1; i++) parts.push(P(rod(q[i], q[i + 1], rad * (i % 2 ? 0.8 : 1.1), rad * (i % 2 ? 1.1 : 0.8), 4), [LAVA, LAVA_HI, LAVA_DK][i % 3]));
    };
    // fissures running out from a split at the crown, forking as they go
    crack([[0.3, 1.42], [0.05, 1.12], [0.22, 0.86], [0.02, 0.6], [0.14, 0.3], [0.04, 0.08]], 0.02);
    crack([[0.22, 0.86], [0.55, 0.74], [0.7, 0.48]], 0.012);
    crack([[0.02, 0.6], [-0.3, 0.5], [-0.42, 0.26]], 0.011);
    crack([[1.2, 1.35], [1.45, 1.05], [1.3, 0.78], [1.62, 0.5], [1.5, 0.22]], 0.018);
    crack([[1.3, 0.78], [1.0, 0.6]], 0.011);
    crack([[-1.6, 1.32], [-1.4, 1.0], [-1.66, 0.74], [-1.45, 0.42], [-1.6, 0.12]], 0.017);
    crack([[2.7, 1.3], [2.95, 0.98], [2.75, 0.66], [3.05, 0.36]], 0.017);
    crack([[-2.4, 1.2], [-2.62, 0.9], [-2.45, 0.55]], 0.013);
    // and down the guard round the back
    for (const sx of [1, -1]) {
      const zig = [[1.6, -0.12], [1.72, -0.2], [1.58, -0.29], [1.7, -0.38]].map(([a, y]) => [sx * Math.sin(a) * RX * 1.01, CY + y, Math.cos(a) * RZ * 1.01]);
      for (let i = 0; i < zig.length - 1; i++) parts.push(P(rod(zig[i], zig[i + 1], 0.014, 0.012, 4), i % 2 ? LAVA : LAVA_DK));
    }
    // a pool of lava glowing at the crown
    parts.push(P(sphere(0.06, 0, CY + RY - 0.005, 0.02, 1, 0.35, 1, 8, 4), LAVA_HI));
    // horns: out of the sides, then up and curling forward
    for (const sx of [1, -1]) {
      const pts = [[0.3, -0.04, 0.02], [0.48, 0.02, 0.06], [0.6, 0.16, 0.12], [0.62, 0.34, 0.2], [0.53, 0.48, 0.3]];
      const rad = [0.1, 0.078, 0.056, 0.036, 0.006];
      const col = [OBS, OBS, OBS_HI, LAVA];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        parts.push(P(rod([sx * a[0], a[1], a[2]], [sx * b[0], b[1], b[2]], rad[i], rad[i + 1], 8), col[i]));
        if (i > 0) parts.push(P(sphere(rad[i], sx * a[0], a[1], a[2], 1, 1, 1, 8, 6), i === 3 ? LAVA : OBS));
      }
      // a glowing band where each horn leaves the helmet
      parts.push(P(rod([sx * 0.36, -0.025, 0.03], [sx * 0.4, -0.01, 0.04], 0.094, 0.09, 8), LAVA));
    }
    parts.push(...place(medal(0.7), 0, CY - 0.005, RZ + 0.035));
    return parts;
  },

  /* third overall: a laurel crown in polished bronze-gold, two branches of
     leaves meeting at the front over a ruby */
  laurel: (r) => {
    const LG = 0xdcae52, LG_DK = 0xae7d2a, LG_LT = 0xf3d27e, RUBY = 0xd8173a;
    const R = 0.34, Y = -0.05, KZ = 1.06;
    const parts = [
      P(arc(R, R * KZ, 0.02, Y, 0.1, Math.PI - 0.1, 18, 5), LG_DK),
      P(arc(R, R * KZ, 0.02, Y, -(Math.PI - 0.1), -0.1, 18, 5), LG_DK),
    ];
    const leaf = (x, y, z, pitch, yaw, c, s = 1) =>
      P(at(sphere(0.08 * s, 0, 0, 0.075 * s, 0.13, 0.36, 1, 6, 3), x, y, z, pitch, yaw), c);
    const n = 9;
    for (const sx of [1, -1]) {
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const a = sx * (Math.PI - 0.22 - t * (Math.PI - 0.52));
        // the way along the branch towards the front
        const yaw = sx > 0 ? Math.atan2(-Math.cos(a), Math.sin(a)) : Math.atan2(Math.cos(a), -Math.sin(a));
        const s = 0.85 + 0.3 * Math.sin(t * Math.PI);
        const x = Math.sin(a) * R * 1.02, z = Math.cos(a) * R * KZ * 1.02;
        parts.push(leaf(x, Y + 0.02, z, -0.95, yaw, i % 2 ? LG : LG_LT, s));
        parts.push(leaf(x * 1.04, Y - 0.005, z * 1.04, -0.25, yaw, i % 2 ? LG_LT : LG, s * 0.95));
      }
      // a last leaf at the front end of each branch, pointing at the gem
      const a = sx * 0.3, x = Math.sin(a) * R * 1.04, z = Math.cos(a) * R * KZ * 1.04;
      parts.push(leaf(x, Y + 0.01, z, -0.3, -sx * 1.25, LG_LT, 0.85));
    }
    // the gem at the front in a gold setting, and a ribbon tied at the back
    parts.push(
      P(cyl(0.064, 0.064, 0.03, 12, 'z', 0, Y + 0.01, R * KZ + 0.02), LG_DK),
      P(faceted(sphere(0.054, 0, Y + 0.01, R * KZ + 0.045, 1, 1.15, 0.6, 8, 4)), RUBY),
      P(ball(0.035, 0, Y, -R * KZ * 1.02), LG_DK),
    );
    for (const sx of [1, -1]) {
      parts.push(P(at(box(0.055, 0.15, 0.014, 0, -0.075, 0), sx * 0.03, Y - 0.01, -R * KZ * 1.04, 0.15, 0, sx * 0.3), LG));
    }
    return parts;
  },

  /* third in ranked: a knight's great helm in dark steel, a gold cross on
     its face, eye slits, breaths, and a purple plume */
  rkhelm: (r) => {
    const IRON = 0x4a505b, IRON_DK = 0x2c3038, IRON_HI = 0x6a717e;
    const PURP = 0x7a2fc0, PURP_LT = 0xa45ae8, PURP_DK = 0x52208a;
    const R = 0.355, Y0 = -0.56, Y1 = 0.05;
    const parts = [
      P(cyl(R, R * 1.03, Y1 - Y0, 18, 'y', 0, (Y0 + Y1) / 2, 0), IRON),
      P(cyl(R * 0.62, R, 0.1, 18, 'y', 0, Y1 + 0.05, 0), IRON_HI),
      P(cyl(R * 0.62, R * 0.62, 0.02, 18, 'y', 0, Y1 + 0.11, 0), IRON_DK),
      P(ring(R + 0.012, R + 0.012, 0.024, 0, Y1 - 0.005, 0, 24), GOLD),
      P(ring(R * 1.03 + 0.012, R * 1.03 + 0.012, 0.024, 0, Y0 + 0.03, 0, 24), GOLD),
      // the cross on its face: a gold brow band and a bar down the middle
      ...twoSided(wall(R + 0.008, R + 0.008, 0.055, -0.13, -1.05, 1.05, 12), GOLD, GOLD_DK),
      P(box(0.075, 0.44, 0.03, 0, -0.33, R - 0.002), GOLD),
    ];
    // eye slits either side of the bar
    for (const sx of [1, -1]) {
      const a0 = sx > 0 ? 0.11 : -0.95, a1 = sx > 0 ? 0.95 : -0.11;
      parts.push(...twoSided(wall(R + 0.006, R + 0.006, 0.05, -0.21, a0, a1, 8), BLACK));
      // breaths, a grid of holes low on the face
      for (const a of [0.3, 0.45, 0.6]) for (const y of [-0.34, -0.4, -0.46]) {
        parts.push(P(at(box(0.03, 0.03, 0.02, 0, 0, 0), sx * Math.sin(a) * (R + 0.006), y, Math.cos(a) * (R + 0.006), 0, sx * a), BLACK));
      }
    }
    // rivets round the brow band
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.3;
      parts.push(P(sphere(0.016, Math.sin(a) * (R + 0.03), -0.13, Math.cos(a) * (R + 0.03), 1, 1, 1, 6, 4), GOLD_DK));
    }
    // the plume: a gold socket, and a spray of long feathers out of it, the
    // first standing up and the rest arching over and falling away behind
    const sy = Y1 + 0.2, sz = -0.04;
    parts.push(
      P(cyl(0.05, 0.065, 0.08, 10, 'y', 0, Y1 + 0.15, sz), GOLD),
      P(sphere(0.055, 0, sy, sz, 1, 0.6, 1, 10, 5), GOLD_DK),
    );
    const plume = (th, L, w, x, c, bend) => {
      // one feather: an ellipsoid along its own length, then bent down at its end
      const g = sphere(1, 0, 0, 0, w * 0.7, L / 2, w, 10, 8);
      g.translate(0, L / 2, 0);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const t = p.getY(i) / L; p.setZ(i, p.getZ(i) + bend * t * t); }
      g.computeVertexNormals();
      return P(at(g, x, sy, sz, -th), c);
    };
    const spray = [
      [0.25, 0.42, 0.095, 0, PURP_LT, 0.1], [0.75, 0.56, 0.1, 0, PURP, 0.18], [1.2, 0.62, 0.1, 0, PURP_LT, 0.24],
      [1.65, 0.6, 0.095, 0, PURP, 0.24], [2.1, 0.52, 0.085, 0, PURP_DK, 0.16],
      [0.95, 0.5, 0.085, 0.065, PURP_DK, 0.2], [0.95, 0.5, 0.085, -0.065, PURP_DK, 0.2],
      [1.5, 0.52, 0.08, 0.065, PURP_LT, 0.22], [1.5, 0.52, 0.08, -0.065, PURP_LT, 0.22],
    ];
    for (const [th, L, w, x, c, bend] of spray) parts.push(plume(th, L, w, x, c, bend));
    return parts;
  },

  /* five ranked wins: a sporty headband in the racer's trim colour, a star
     badge at the front and little wings at the sides */
  headband: (r) => {
    const T = r && r.trim !== undefined ? r.trim : GOLD;
    const band = new THREE.CylinderGeometry(0.312, 0.318, 0.11, 22, 1, true).toNonIndexed();
    band.translate(0, -0.11, 0);
    const parts = [
      ...twoSided(band, T, shade(T, 0.7)),
      P(ring(0.316, 0.316, 0.012, 0, -0.058, 0, 22), WHITE),
      P(ring(0.32, 0.32, 0.012, 0, -0.162, 0, 22), WHITE),
      // the star badge
      P(cyl(0.082, 0.082, 0.02, 16, 'z', 0, -0.11, 0.318), WHITE),
      P(cyl(0.07, 0.07, 0.03, 16, 'z', 0, -0.11, 0.322), INK),
      P(chunkyStar(5, 0.05, 0.021, 0.008, 0.008, 0, -0.113, 0.345), GOLD),
    ];
    // wings, three feathers each, sweeping back and up from the temples
    const feather = (z1, y1, w) => {
      const L = Math.hypot(z1, y1), dz = z1 / L, dy = y1 / L, nz = -dy, ny = dz;
      const loc = [[0, 0], [0.2, 0.5], [0.7, 0.5], [1, 0], [0.7, -0.45], [0.2, -0.45]];
      return loc.map(([u, v]) => [dz * u * L + nz * v * w, dy * u * L + ny * v * w]);
    };
    for (const sx of [1, -1]) {
      const wing = [
        P(slab(feather(-0.3, 0.34, 0.1), 0.026, 'side', 0, 0.01, 0), WHITE),
        P(slab(feather(-0.38, 0.22, 0.095), 0.026, 'side', 0.005, 0, 0), 0xeef1f5),
        P(slab(feather(-0.4, 0.09, 0.09), 0.026, 'side', 0.01, -0.012, 0), 0xdfe5ee),
        P(slab(feather(-0.33, -0.03, 0.08), 0.026, 'side', 0.015, -0.024, 0), 0xc9d2de),
        // a gold bone along the top of the wing, and a gold boss at its root
        P(rod([0, 0.02, 0.02], [0, 0.2, -0.17], 0.02, 0.012, 5), GOLD),
        P(sphere(0.045, 0.01, 0.0, 0.0, 0.8, 1, 1, 8, 5), GOLD),
      ];
      parts.push(...place(wing, sx * 0.33, -0.1, -0.02, 0, -sx * 0.3));
    }
    return parts;
  },

  /* fifty ranked wins: a full-face racing helmet in polished gold, a black
     visor, and a red stripe from the brow over the top to the back */
  goldhelm: (r) => {
    const G = 0xffcc33, G_LT = 0xffe17a, G_DK = 0xd9a21e, VIS = 0x121418, SEAL = 0x2b2b30, RED = 0xe01f2a;
    const C = -0.22, R = 0.385, KZ = 1.08;
    const shellPart = (rad, phi0, phiLen, th0, thLen, w, h) => {
      const g = new THREE.SphereGeometry(rad, w, h, phi0, phiLen, th0, thLen).toNonIndexed();
      g.scale(1, 1, KZ);
      g.translate(0, C, 0);
      return g;
    };
    const FRONT = Math.PI * 1.5;                 // the sphere's phi for the nose
    const parts = [
      P(shellPart(R, 0, TAU, 0, 2.3, 24, 12), G),
      // the visor in its rubber seal
      P(shellPart(R + 0.004, FRONT - 1.08, 2.16, 1.16, 0.82, 14, 4), SEAL),
      P(shellPart(R + 0.008, FRONT - 1.0, 2.0, 1.22, 0.7, 14, 4), VIS),
      P(ring(R * Math.sin(2.3) + 0.004, R * Math.sin(2.3) * KZ + 0.004, 0.022, 0, C + R * Math.cos(2.3), 0, 24), SEAL),
    ];
    // a glint across the visor
    for (const [a, e, l] of [[-0.42, 0.18, 0.13], [-0.3, 0.1, 0.07]]) {
      const q = onShell(R, R, R * KZ, C, a, e, 1.03);
      parts.push(P(at(box(l, 0.016, 0.006, 0, 0, 0), q[0], q[1], q[2], -0.2, a, 0.35), 0xc8d6e8));
    }
    // the stripe, red between two white pinstripes, laid along the shell
    const stripe = (xo, w, c) => {
      const Rk = Math.sqrt(R * R - xo * xo) + 0.006, n = 14;
      const t0 = 0.5, t1 = Math.PI + 0.75;
      for (let i = 0; i < n; i++) {
        const ta = t0 + (t1 - t0) * (i / n), tb = t0 + (t1 - t0) * ((i + 1) / n);
        const A = [C + Rk * Math.sin(ta), Rk * KZ * Math.cos(ta)], B = [C + Rk * Math.sin(tb), Rk * KZ * Math.cos(tb)];
        const dy = B[0] - A[0], dz = B[1] - A[1], len = Math.hypot(dy, dz) + 0.004;
        parts.push(P(at(box(w, 0.012, len, 0, 0, 0), xo, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, Math.atan2(-dy, dz)), c));
      }
    };
    stripe(0, 0.1, RED);
    stripe(0.068, 0.02, WHITE);
    stripe(-0.068, 0.02, WHITE);
    // chin vents, visor pivots, and a little spoiler at the back
    for (const a of [-0.16, 0, 0.16]) {
      const q = onShell(R, R, R * KZ, C, a, -0.62, 1.005);
      parts.push(P(at(box(0.07, 0.022, 0.02, 0, 0, 0), q[0], q[1], q[2], 0.5, a), SEAL));
    }
    for (const sx of [1, -1]) {
      parts.push(
        P(cyl(0.05, 0.05, 0.03, 12, 'x', sx * (R - 0.002), C + 0.08, 0.06), SEAL),
        P(cyl(0.028, 0.028, 0.036, 10, 'x', sx * (R - 0.002), C + 0.08, 0.06), RED),
      );
    }
    // two vents at the back, either side of the stripe
    for (const sx of [1, -1]) {
      const a = Math.PI - sx * 0.42, q = onShell(R, R, R * KZ, C, a, 0.25, 1.005);
      parts.push(P(at(box(0.1, 0.03, 0.02, 0, 0, 0), q[0], q[1], q[2], 0, a), SEAL));
      parts.push(P(at(box(0.1, 0.03, 0.02, 0, 0, 0), q[0] * 0.99, q[1] - 0.06, q[2] * 0.99, 0, a), SEAL));
    }
    return parts;
  },
};
export { HATS };

/* ===========================================================================
   DECOR. Origin at a mount on top of the kart's tail, +z forward.
=========================================================================== */

/* The map flags. A pole, and a pennant streaming back off the top of it,
   swung out to one side and rippling, so it shows its face to the chase
   camera rather than its edge. The pennant is built flat, painted with its
   bands and its emblem on both faces, then rippled and swung as one. */
const FL = { top: 1.1, H: 0.4, L: 0.62, yaw: 0.8 };
const fUp = z => FL.top - (FL.H / 2) * (-z / FL.L);
const fLo = z => FL.top - FL.H + (FL.H / 2) * (-z / FL.L);
const fMid = FL.top - FL.H / 2;

// a strip of the pennant between z0 and z1, bounded above and below, as a
// sheet facing +x (side 1) or -x (side -1), standing out from the cloth by x
function sheet(z0, z1, up, lo, side, x = 0, n = 6) {
  const pos = [];
  const push = (a, b, c) => {
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    if (Math.abs(nx) < 1e-9) return;
    if (nx * side < 0) { const t = b; b = c; c = t; }
    pos.push(...a, ...b, ...c);
  };
  for (let i = 0; i < n; i++) {
    const za = z0 + (z1 - z0) * (i / n), zb = z0 + (z1 - z0) * ((i + 1) / n);
    const A = [x, lo(za), -za], B = [x, lo(zb), -zb], C = [x, up(zb), -zb], D = [x, up(za), -za];
    push(A, B, C); push(A, C, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function pennant(o) {
  const parts = [
    P(cyl(0.065, 0.075, 0.05, 10, 'y', 0, 0.025, 0), DARK),
    P(rod([0, 0.04, 0], [0, FL.top + 0.05, 0], 0.024, 0.02, 6), o.pole),
    ...o.finial,
  ];
  const cloth = [];
  // the cloth itself, a sheet each way
  for (const s of [1, -1]) cloth.push(P(sheet(0, -FL.L, fUp, fLo, s, 0, 10), o.field));
  // bands painted on it: [z0, z1, colour, which part of the height]
  for (const [z0, z1, c, part] of o.bands) {
    let up = fUp, lo = fLo;
    if (part === 'top') lo = z => fUp(z) - o.edge;
    if (part === 'bottom') up = z => fLo(z) + o.edge;
    const n = Math.max(1, Math.round((z0 - z1) / 0.06));
    for (const s of [1, -1]) cloth.push(P(sheet(z0, z1, up, lo, s, s * 0.004, n), c));
  }
  // the emblem, on both faces
  for (const s of [1, -1]) {
    for (const e of o.emblem()) { e.g.translate(s * 0.014, fMid, -o.ez); cloth.push(e); }
  }
  // ripple it, more towards the free end, and swing it out to the side
  warp(cloth, (x, y, z) => {
    const t = Math.max(0, -z / FL.L);
    return [x + 0.075 * Math.sin(t * 5.2) * Math.pow(t, 0.8), y, z];
  });
  for (const p of cloth) at(p.g, 0, 0, 0, 0, FL.yaw);
  return parts.concat(cloth);
}
// a piece of an emblem: an outline drawn in (z, y) about the emblem's centre
const em = (pts, c, t = 0.012) => P(slab(pts, t, 'side'), c);
const emBox = (h, w, y, z, c, rx = 0, t = 0.012) => P(at(box(t, h, w, 0, 0, 0), 0, y, z, rx), c);
const emDisc = (rad, c, t = 0.012, seg = 16) => P(cyl(rad, rad, t, seg, 'x', 0, 0, 0), c);

const DECOR = {
  /* Sunfield Loop: green, a gold band at the pole and a gold tip, a sunflower */
  meadowflag: (r) => pennant({
    pole: WOOD, field: 0x3f9a3a, edge: 0.04,
    finial: [P(ball(0.055, 0, FL.top + 0.08, 0), GOLD)],
    bands: [[0, -0.07, GOLD, 'all'], [-0.47, -FL.L, GOLD, 'all']],
    ez: -0.25,
    emblem: () => [em(star(12, 0.105, 0.072, 0.13), 0xffc61a, 0.01), emDisc(0.052, 0x5a3416, 0.016), emDisc(0.03, 0x3a200c, 0.02, 10)],
  }),
  /* Redrock Dunes: terracotta, sand bands, a cactus on a sand sun */
  dunesflag: (r) => pennant({
    pole: 0xd8b98a, field: 0xc65a2e, edge: 0.04,
    finial: [P(cyl(0.0, 0.05, 0.12, 8, 'y', 0, FL.top + 0.11, 0), 0xc65a2e), P(cyl(0.05, 0.05, 0.03, 8, 'y', 0, FL.top + 0.04, 0), 0xe9d4a4)],
    bands: [[0, -0.07, 0xe9d4a4, 'all'], [-0.07, -0.47, 0x6cc4ff, 'bottom'], [-0.47, -FL.L, 0xe9d4a4, 'all']],
    ez: -0.25,
    emblem: () => [
      emDisc(0.105, 0xf1dfb5, 0.01, 18),
      // a saguaro: a tall trunk with two arms turning up, rounded at every end
      emBox(0.15, 0.042, -0.015, 0, 0x2f8a3a, 0, 0.016), P(cyl(0.021, 0.021, 0.016, 10, 'x', 0, 0.06, 0), 0x2f8a3a),
      emBox(0.026, 0.05, -0.02, 0.04, 0x2f8a3a, 0, 0.016), emBox(0.06, 0.026, 0.0, 0.058, 0x2f8a3a, 0, 0.016),
      P(cyl(0.013, 0.013, 0.016, 8, 'x', 0, 0.03, 0.058), 0x2f8a3a),
      emBox(0.026, 0.05, -0.04, -0.04, 0x2f8a3a, 0, 0.016), emBox(0.05, 0.026, -0.025, -0.058, 0x2f8a3a, 0, 0.016),
      P(cyl(0.013, 0.013, 0.016, 8, 'x', 0, 0.0, -0.058), 0x2f8a3a),
      emBox(0.016, 0.15, -0.09, 0, 0xc6a874, 0, 0.016),
    ],
  }),
  /* Glacier Pass: ice blue, white bands, a white snowflake */
  frostflag: (r) => pennant({
    pole: 0xeef3f8, field: 0x4fa6e6, edge: 0.04,
    finial: [P(faceted(cyl(0.0, 0.055, 0.12, 4, 'y', 0, FL.top + 0.15, 0)), 0xbfe6ff), P(faceted(cyl(0.055, 0.0, 0.07, 4, 'y', 0, FL.top + 0.055, 0)), 0x8fd0ff)],
    bands: [[0, -0.07, WHITE, 'all'], [-0.07, -0.47, WHITE, 'top'], [-0.07, -0.47, WHITE, 'bottom'], [-0.47, -FL.L, WHITE, 'all']],
    ez: -0.25,
    emblem: () => {
      const out = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        out.push(P(at(box(0.016, 0.105, 0.022, 0, 0.0525, 0), 0, 0, 0, a), WHITE));
        // two pairs of branches up each arm, in a V
        for (const [up, len] of [[0.04, 0.04], [0.07, 0.03]]) {
          for (const s of [1, -1]) {
            const g = box(0.016, len, 0.014, 0, len / 2, 0);
            at(g, 0, 0, 0, s * 0.85);
            g.translate(0, up, 0);
            at(g, 0, 0, 0, a);
            out.push(P(g, WHITE));
          }
        }
      }
      out.push(emDisc(0.022, 0xdff2ff, 0.02, 6));
      return out;
    },
  }),
  /* Neon Mile: near black, a pink stripe along the top and a cyan one along
     the bottom, and a lightning bolt */
  neonflag: (r) => pennant({
    pole: 0x24242e, field: 0x17141f, edge: 0.04,
    finial: [P(ball(0.05, 0, FL.top + 0.08, 0), 0xff2bd6), P(cyl(0.034, 0.034, 0.05, 10, 'y', 0, FL.top - 0.05, 0), 0x2af4ff)],
    bands: [[0, -0.05, 0x2af4ff, 'all'], [-0.05, -FL.L, 0xff2bd6, 'top'], [-0.05, -FL.L, 0x2af4ff, 'bottom']],
    ez: -0.24,
    emblem: () => {
      const bolt = [[0.05, 0.12], [-0.045, 0.0], [0.005, 0.0], [-0.05, -0.12], [0.06, 0.025], [0.012, 0.025], [0.055, 0.12]];
      return [em(bolt.map(([z, y]) => [z * 1.22, y * 1.18]), 0xff2bd6, 0.01), em(bolt, 0xbffcff, 0.016)];
    },
  }),
  /* Ember Hollow: black, an orange band and tip, and a flame */
  emberflag: (r) => pennant({
    pole: 0x1e1a22, field: 0x1c181c, edge: 0.04,
    finial: [P(cyl(0.0, 0.045, 0.14, 7, 'y', 0, FL.top + 0.12, 0), 0xff7a10), P(ball(0.045, 0, FL.top + 0.04, 0), 0xffb21e)],
    bands: [[0, -0.06, 0xff6a10, 'all'], [-0.06, -0.47, 0xff6a10, 'bottom'], [-0.47, -FL.L, 0xff6a10, 'all']],
    ez: -0.24,
    emblem: () => {
      const flame = [[0.0, -0.11], [0.07, -0.07], [0.08, 0.0], [0.05, 0.06], [0.04, 0.02], [0.01, 0.13], [-0.02, 0.04], [-0.05, 0.09], [-0.075, 0.0], [-0.07, -0.07]];
      const inner = [[0.0, -0.1], [0.045, -0.065], [0.045, 0.0], [0.015, 0.05], [-0.01, 0.0], [-0.04, 0.02], [-0.045, -0.06]];
      return [em(flame, 0xff5a0a, 0.01), em(inner, 0xffc21e, 0.018)];
    },
  }),

  /* the overall top ten: a large laurel wreath standing upright on a post,
     green leaves on a gold stem, gold berries and a gold bow */
  laurels: (r) => {
    const G1 = 0x3f9a44, G2 = 0x2f7d32, G3 = 0x5fbf5a, GD = 0xe6b422;
    const CY = 0.55, R = 0.235;
    const parts = [
      P(box(0.26, 0.05, 0.16, 0, 0.025, 0), BLACK),
      P(box(0.2, 0.03, 0.12, 0, 0.065, 0), GOLD_DK),
      P(rod([0, 0.06, 0], [0, CY - R + 0.02, 0], 0.03, 0.026, 8), GOLD),
    ];
    const leaf = (x, y, rz, c, s) => P(at(sphere(0.07 * s, 0, 0.07 * s, 0, 0.42, 1, 0.16, 6, 3), x, y, 0, 0, 0, rz), c);
    const n = 9, phi0 = 0.32, phi1 = Math.PI - 0.4;
    for (const sx of [1, -1]) {
      // the stem, a gold arc up each side
      for (let i = 0; i < 10; i++) {
        const fa = phi0 - 0.12 + (i / 10) * (phi1 - phi0 + 0.12), fb = phi0 - 0.12 + ((i + 1) / 10) * (phi1 - phi0 + 0.12);
        parts.push(P(rod([sx * R * Math.sin(fa), CY - R * Math.cos(fa), 0], [sx * R * Math.sin(fb), CY - R * Math.cos(fb), 0], 0.016, 0.014, 5), GD));
      }
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), phi = phi0 + t * (phi1 - phi0);
        const on = k => [sx * R * k * Math.sin(phi), CY - R * k * Math.cos(phi)];
        const along = sx * (phi - Math.PI / 2);          // the stem's way, as a turn of +y
        const s = 1.05 - 0.3 * t;
        const o = on(1.06), n2 = on(0.95), b = on(1.0);
        parts.push(leaf(o[0], o[1], along - sx * 0.62, i % 2 ? G1 : G3, s));
        parts.push(leaf(n2[0], n2[1], along + sx * 0.5, i % 2 ? G2 : G1, s * 0.9));
        if (i % 2 === 0 && i < n - 1) parts.push(P(sphere(0.024, b[0], b[1], 0.03, 1, 1, 1, 6, 4), GOLD), P(sphere(0.024, b[0], b[1], -0.03, 1, 1, 1, 6, 4), GOLD));
      }
      // a leaf at the top of each branch
      const pt = phi1 + 0.12;
      parts.push(leaf(sx * R * Math.sin(pt), CY - R * Math.cos(pt), sx * (pt - Math.PI / 2), G1, 0.8));
    }
    // the bow where the branches cross, and its tails
    const by = CY - R;
    parts.push(
      P(sphere(0.045, 0, by, 0, 1, 0.8, 0.7, 8, 5), GOLD_DK),
      P(at(sphere(0.07, 0, 0, 0, 1, 0.55, 0.35, 8, 5), 0.07, by + 0.02, 0, 0, 0, 0.35), GOLD),
      P(at(sphere(0.07, 0, 0, 0, 1, 0.55, 0.35, 8, 5), -0.07, by + 0.02, 0, 0, 0, -0.35), GOLD),
      P(at(box(0.045, 0.14, 0.02, 0, -0.07, 0), 0.025, by - 0.02, 0, 0, 0, 0.35), GOLD),
      P(at(box(0.045, 0.14, 0.02, 0, -0.07, 0), -0.025, by - 0.02, 0, 0, 0, -0.35), GOLD),
    );
    return parts;
  },

  /* ranked top ten: a heraldic shield, purple inside a gold border, crossed
     gold swords on both faces, on a short iron post */
  rkshield: (r) => {
    const PURP = 0x6a28b0, PURP_LT = 0x8a44d4, IRON = 0x4a505b;
    const outline = (k) => {
      const pts = [[-0.25, 0.3], [0.25, 0.3], [0.25, 0.04]];
      const bez = (p0, c, p1, t) => [(1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]];
      for (const t of [0.2, 0.4, 0.6, 0.8]) pts.push(bez([0.25, 0.04], [0.23, -0.22], [0, -0.35], t));
      pts.push([0, -0.35]);
      for (const t of [0.8, 0.6, 0.4, 0.2]) pts.push(bez([-0.25, 0.04], [-0.23, -0.22], [0, -0.35], t));
      pts.push([-0.25, 0.04]);
      return pts.map(([x, y]) => [x * k, y * k + (k < 1 ? 0.012 : 0)]);
    };
    const shield = [
      P(slab(outline(1), 0.05, 'front'), GOLD),
      P(slab(outline(0.84), 0.07, 'front'), PURP),
      P(slab([[-0.2, 0.24], [0.2, 0.24], [0.2, 0.2], [-0.2, 0.2]], 0.074, 'front'), PURP_LT),
    ];
    // crossed swords, gold, on both faces
    const sword = (rz, zf) => {
      const s = [
        P(slab([[-0.018, -0.13], [0.018, -0.13], [0.018, 0.17], [0, 0.21], [-0.018, 0.17]], 0.012, 'front'), GOLD_LT),
        P(box(0.13, 0.026, 0.016, 0, -0.13, 0), GOLD_DK),
        P(box(0.026, 0.07, 0.016, 0, -0.18, 0), 0x3a2410),
        P(sphere(0.022, 0, -0.225, 0, 1, 1, 0.6, 8, 5), GOLD_DK),
      ];
      return place(s, 0, -0.02, zf, 0, 0, rz);
    };
    for (const f of [1, -1]) shield.push(...sword(0.72, f * 0.044), ...sword(-0.72, f * 0.05));
    // a gold boss where the blades cross
    for (const f of [1, -1]) shield.push(P(chunkyStar(5, 0.045, 0.02, 0.008, 0.006, 0, -0.025, f * 0.062), GOLD));
    place(shield, 0, 0.62, 0, 0.12);
    return [
      P(box(0.24, 0.05, 0.16, 0, 0.025, 0), DARK),
      P(rod([0, 0.05, 0], [0, 0.3, 0], 0.03, 0.026, 8), IRON),
      P(box(0.14, 0.04, 0.06, 0, 0.3, 0), GOLD_DK),
      ...shield,
    ];
  },

  /* one ranked win: a gold star on a springy antenna */
  star: (r) => {
    const parts = [
      P(cyl(0.07, 0.085, 0.05, 12, 'y', 0, 0.025, 0), DARK),
      P(cyl(0.035, 0.035, 0.03, 10, 'y', 0, 0.065, 0), STEEL),
    ];
    // the spring
    const turns = 3.5, n = 28, h0 = 0.075, h1 = 0.25, rr = 0.036;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = t * turns * TAU;
      const q = [Math.sin(a) * rr, h0 + (h1 - h0) * t, Math.cos(a) * rr];
      if (prev) parts.push(P(rod(prev, q, 0.01, 0.01, 4), CHROME));
      prev = q;
    }
    // the antenna, bent back a little the way a whip aerial is at speed
    const ant = [[0, 0.25, 0], [0, 0.43, -0.012], [0, 0.6, -0.04], [0, 0.75, -0.085], [0, 0.86, -0.14]];
    for (let i = 0; i < ant.length - 1; i++) parts.push(P(rod(ant[i], ant[i + 1], 0.014, 0.011, 5), DARK));
    parts.push(P(sphere(0.026, 0, 0.865, -0.142, 1, 1, 1, 8, 5), GOLD_DK));
    const st = [
      P(chunkyStar(5, 0.15, 0.066, 0.05, 0.022), GOLD),
      P(chunkyStar(5, 0.085, 0.037, 0.088, 0.012), GOLD_LT),
    ];
    parts.push(...place(st, 0, 0.99, -0.18, -0.35));
    return parts;
  },
};
export { DECOR };

/* ===========================================================================
   GLIDERS. Origin at the mount above the driver, the driver below at about
   y -1.2, nose +z. The game's own hang glider is about 4.6 m across.
=========================================================================== */

// two struts down from a wing to the driver's shoulders
const struts = (x, y, z, c = DARK) => [
  P(rod([x, y, z], [0.3, -0.92, 0.05], 0.035), c),
  P(rod([-x, y, z], [-0.3, -0.92, 0.05], 0.035), c),
];

/* a feather, seen from above: rooted at (x0, z0), pointing at ang (measured
   from +x round towards the back), L long and w wide. 'from' cuts it to its
   outer part, for the darker tips laid over the feathers. */
function feather(x0, z0, ang, L, w, thick, y, from = 0) {
  const d = [Math.cos(ang), -Math.sin(ang)], n = [Math.sin(ang), Math.cos(ang)];
  const loc = from > 0
    ? [[from, 0.52], [0.85, 0.38], [1.0, 0], [0.86, -0.34], [from, -0.52]]
    : [[0, 0], [0.12, 0.42], [0.55, 0.5], [0.85, 0.36], [1, 0], [0.86, -0.32], [0.5, -0.5], [0.12, -0.4]];
  const pts = loc.map(([a, b]) => [x0 + d[0] * a * L + n[0] * b * w, z0 + d[1] * a * L + n[1] * b * w]);
  return slab(pts, thick, 'top', 0, y, 0);
}

const GLIDERS = {
  /* twenty-five ranked wins: swept silver jet wings, a spine with a canopy,
     two engine pods under the wings with blue glowing exhausts */
  jet: (r) => {
    const SIL = 0xc9d1db, SIL_DK = 0x8b96a4, SIL_LT = 0xe8edf3, BLUE = 0x2a6cf0, GLOW = 0x56ccff, GLOW_HI = 0xd6f4ff;
    const parts = [];
    const wingT = [[0.16, 0.66], [2.2, -0.52], [2.2, -0.8], [1.25, -0.78], [0.16, -0.62]];
    const stripe = [[0.16, 0.66], [2.2, -0.52], [2.2, -0.6], [0.16, 0.5]];
    const dih = 0.07;
    for (const sx of [1, -1]) {
      const m = pts => (sx > 0 ? pts : mx(pts));
      const side = [
        P(slab(m(wingT), 0.036, 'top', 0, 0.018, 0), SIL),
        P(slab(m(wingT), 0.03, 'top', 0, -0.012, 0), SIL_DK),
        P(slab(m(stripe), 0.05, 'top', 0, 0.012, 0), BLUE),
        // a winglet standing up at the tip
        P(slab([[-0.5, 0], [-0.82, 0], [-0.95, 0.36], [-0.8, 0.36]], 0.03, 'side', sx * 2.2, 0.0, 0), BLUE),
        P(slab([[-0.52, 0.0], [-0.82, 0.0], [-0.84, 0.06], [-0.55, 0.06]], 0.034, 'side', sx * 2.2, 0.0, 0), SIL_LT),
      ];
      // the engine pod, its pylon, its intake and its glow
      const px = sx * 1.05, py = -0.13;
      side.push(
        P(box(0.05, 0.14, 0.42, px, -0.04, -0.2), SIL_DK),
        P(cyl(0.14, 0.14, 0.8, 12, 'z', px, py, -0.25), SIL_LT),
        P(cyl(0.15, 0.15, 0.07, 12, 'z', px, py, 0.17), DARK),
        P(cyl(0.11, 0.11, 0.08, 12, 'z', px, py, 0.16), 0x24262c),
        P(cyl(0.035, 0.0, 0.06, 8, 'z', px, py, 0.2), STEEL),
        P(cyl(0.12, 0.135, 0.14, 12, 'z', px, py, -0.71), DARK),
        P(cyl(0.1, 0.1, 0.02, 12, 'z', px, py, -0.775), GLOW_HI),
        P(cyl(0.0, 0.095, 0.5, 10, 'z', px, py, -1.03), GLOW),
        P(cyl(0.0, 0.055, 0.32, 8, 'z', px, py, -0.95), GLOW_HI),
        P(cyl(0.142, 0.142, 0.05, 12, 'z', px, py, -0.1), BLUE),
      );
      for (const p of side) at(p.g, 0, 0, 0, 0, 0, sx * dih);
      parts.push(...side);
    }
    // the spine, a nose cone and a canopy, and twin fins at the back
    parts.push(
      P(cyl(0.15, 0.15, 1.5, 14, 'z', 0, 0.06, -0.12), SIL_LT),
      P(cyl(0.15, 0.0, 0.55, 14, 'z', 0, 0.06, 0.905), SIL_LT),
      P(cyl(0.155, 0.155, 0.05, 14, 'z', 0, 0.06, 0.55), BLUE),
      P(sphere(0.12, 0, 0.17, 0.3, 1, 0.75, 2.2, 12, 6), 0x24486e),
      P(sphere(0.05, -0.04, 0.24, 0.42, 1, 0.5, 2.0, 6, 4), 0x9fd8ff),
      P(cyl(0.13, 0.15, 0.1, 14, 'z', 0, 0.06, -0.91), DARK),
      P(cyl(0.1, 0.1, 0.02, 12, 'z', 0, 0.06, -0.965), GLOW_HI),
    );
    for (const sx of [1, -1]) {
      const g = slab([[-0.45, 0], [-0.85, 0], [-1.02, 0.46], [-0.82, 0.46]], 0.03, 'side', 0, 0, 0);
      at(g, sx * 0.09, 0.14, 0, 0, 0, -sx * 0.3);
      parts.push(P(g, BLUE));
    }
    return parts.concat(struts(0.42, -0.02, 0.0));
  },

  /* a hundred and fifty ranked wins: a phoenix. Huge wings of layered
     feathers, yellow at the root through orange to red at the tips, a body
     with a crested head between them, and a tail of long feathers */
  phoenix: (r) => {
    const RAMP = [0xffe45a, 0xffc433, 0xffa020, 0xff7a1a, 0xf24e1c, 0xd8261c, 0xb81414];
    const ramp = t => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))))];
    const deg = Math.PI / 180;
    const lerp = (a, b, t) => a + (b - a) * t;
    const wing = [];
    // primaries: a fan from the hand out to the tip, darker at their ends
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const x0 = lerp(1.85, 2.4, t), z0 = lerp(0.42, 0.3, t), ang = lerp(76, 8, t) * deg, L = lerp(1.35, 0.92, t), w = 0.27;
      wing.push(P(feather(x0, z0, ang, L, w, 0.03, 0), ramp(lerp(0.55, 0.75, t))));
      wing.push(P(feather(x0, z0, ang, L, w * 1.02, 0.04, 0.003, 0.55), ramp(lerp(0.85, 1, t))));
    }
    // secondaries along the forearm, pointing back
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const x0 = lerp(0.9, 1.8, t), z0 = lerp(0.48, 0.44, t), ang = lerp(93, 80, t) * deg, L = lerp(1.05, 1.25, t), w = 0.3;
      wing.push(P(feather(x0, z0, ang, L, w, 0.03, 0.02), ramp(lerp(0.3, 0.5, t))));
      wing.push(P(feather(x0, z0, ang, L, w * 1.02, 0.04, 0.023, 0.6), ramp(lerp(0.6, 0.8, t))));
    }
    // tertials by the body
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      wing.push(P(feather(lerp(0.3, 0.75, t), lerp(0.32, 0.45, t), lerp(100, 95, t) * deg, lerp(0.9, 1.0, t), 0.3, 0.03, 0.02), ramp(lerp(0.15, 0.3, t))));
    }
    // coverts laid over the top in two rows, brightest nearest the body
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      wing.push(P(feather(lerp(0.3, 2.3, t), lerp(0.4, 0.36, t), lerp(95, 40, t) * deg, lerp(0.58, 0.5, t), 0.25, 0.03, 0.05), ramp(lerp(0.0, 0.45, t))));
    }
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      wing.push(P(feather(lerp(0.4, 1.9, t), lerp(0.47, 0.45, t), lerp(95, 60, t) * deg, 0.36, 0.24, 0.03, 0.08), ramp(lerp(0.0, 0.2, t))));
    }
    // the leading edge, in gold
    const arm = [[0.25, 0.1, 0.42], [1.0, 0.1, 0.54], [1.85, 0.1, 0.48], [2.42, 0.1, 0.33]];
    for (let i = 0; i < arm.length - 1; i++) wing.push(P(rod(arm[i], arm[i + 1], 0.075 - i * 0.012, 0.065 - i * 0.012, 6), 0xffd23a));
    wing.push(P(sphere(0.07, 1.85, 0.1, 0.48, 1, 1, 1, 8, 5), 0xffd23a));
    // bend the wing: it rises towards the tip and its trailing edge droops
    warp(wing, (x, y, z) => [x, y + 0.11 * x + 0.1 * Math.max(0, x - 1.1) ** 2 + 0.07 * Math.min(0, z), z]);
    const parts = [];
    for (const p of wing) {
      parts.push(p);
      const g = p.g.clone();
      g.scale(-1, 1, 1);
      // a mirror turns faces inside out: put their corners back in order
      for (const name of ['position', 'normal']) {
        const a = g.attributes[name].array;
        for (let i = 0; i < a.length; i += 9) for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; }
      }
      parts.push(P(g, p.c));
    }
    // the tail: long feathers fanning out behind, each with an eye near its end
    const tail = [];
    for (let i = 0; i < 7; i++) {
      const k = i - 3, ang = (90 + k * 8) * deg, L = 2.3 - Math.abs(k) * 0.22, w = 0.2;
      const x0 = k * 0.04, z0 = -0.3;
      tail.push(P(feather(x0, z0, ang, L, w, 0.03, -0.02 - Math.abs(k) * 0.005), ramp(0.45 + Math.abs(k) * 0.05)));
      tail.push(P(feather(x0, z0, ang, L, w * 1.04, 0.04, -0.018 - Math.abs(k) * 0.005, 0.62), ramp(0.95)));
      const ex = x0 + Math.cos(ang) * L * 0.8, ez = z0 - Math.sin(ang) * L * 0.8;
      tail.push(P(cyl(0.07, 0.07, 0.05, 8, 'y', ex, -0.02, ez), 0xffd84a));
      tail.push(P(cyl(0.035, 0.035, 0.056, 6, 'y', ex, -0.02, ez), 0x9a0f12));
    }
    warp(tail, (x, y, z) => { const d = Math.max(0, -0.3 - z); return [x, y - 0.12 * d + 0.03 * d * d, z]; });
    parts.push(...tail);
    // the bird: a body, a belly, a neck, a crested head and a gold beak
    parts.push(
      P(sphere(0.25, 0, 0.1, 0.0, 1, 0.75, 1.9, 12, 7), 0xff7a1a),
      P(sphere(0.2, 0, 0.03, 0.1, 1, 0.6, 1.6, 10, 6), 0xffd84a),
      P(rod([0, 0.16, 0.36], [0, 0.32, 0.7], 0.12, 0.09, 8), 0xff5a1a),
      P(sphere(0.135, 0, 0.36, 0.78, 1, 0.95, 1.1, 10, 7), 0xff4a1a),
      P(cyl(0.055, 0.0, 0.2, 6, 'z', 0, 0.33, 0.98), 0xffc21e),
      P(ball(0.026, 0.075, 0.4, 0.86), BLACK),
      P(ball(0.026, -0.075, 0.4, 0.86), BLACK),
    );
    for (const [z1, y1, c] of [[0.36, 0.78, 0xffe45a], [0.42, 0.66, 0xffa020], [0.5, 0.55, 0xf24e1c]]) {
      const z0 = 0.76, y0 = 0.44, L = Math.hypot(z1 - z0, y1 - y0), dz = (z1 - z0) / L, dy = (y1 - y0) / L, nz = -dy, ny = dz, w = 0.08;
      const loc = [[0, 0], [0.2, 0.5], [0.7, 0.45], [1, 0], [0.7, -0.4], [0.2, -0.45]];
      parts.push(P(slab(loc.map(([u, v]) => [z0 + dz * u * L + nz * v * w, y0 + dy * u * L + ny * v * w]), 0.03, 'side'), c));
    }
    return parts.concat(struts(0.42, 0.04, 0.12, 0xb8860b));
  },
};
export { GLIDERS };

/* ===========================================================================
   THEMED BODIES.
=========================================================================== */

/* two hundred ranked wins: a trophy on wheels. A black plinth in two tiers
   with gold mouldings and plaques, a great gold cup on a stem that the driver
   sits in, two big handles, a "1" on the cup and on the back plaque, gold
   mudguards, and a little trophy on the bonnet for a mascot */
function trophy(r) {
  const G = 0xffcc33, G_LT = 0xffd966, G_DK = 0xd9a520, G_DEEP = 0xa87a12;
  const PLINTH = 0x17171c, VELVET = 0xa0182c, ENAMEL = 0xb3122a;
  const parts = [
    P(box(1.46, 0.03, 2.96, 0, 0.215, 0), G_DK),
    P(box(1.5, 0.18, 3.0, 0, 0.32, 0), PLINTH),
    P(box(1.54, 0.04, 3.04, 0, 0.43, 0), G_DK),
    P(box(1.36, 0.12, 2.72, 0, 0.51, 0), PLINTH),
    // a gold moulding round the top edge of the plinth
    P(box(1.4, 0.04, 0.07, 0, 0.585, 1.345), G),
    P(box(1.4, 0.04, 0.07, 0, 0.585, -1.345), G),
    P(box(0.07, 0.04, 2.76, 0.665, 0.585, 0), G),
    P(box(0.07, 0.04, 2.76, -0.665, 0.585, 0), G),
  ];
  // a "1" drawn in boxes, facing forwards (f 1) or backwards (f -1)
  const one = (x, y, z, f, s, c) => [
    P(box(0.034 * s, 0.13 * s, 0.014, x, y, z), c),
    P(at(box(0.03 * s, 0.055 * s, 0.014, 0, 0, 0), x + f * 0.024 * s, y + 0.045 * s, z, 0, 0, -f * 0.9), c),
    P(box(0.085 * s, 0.022 * s, 0.014, x, y - 0.055 * s, z), c),
  ];
  // plaques: down each side, and front and back with a "1" on them
  for (const sx of [1, -1]) {
    parts.push(
      P(box(0.012, 0.13, 0.9, sx * 0.756, 0.32, 0), G_LT),
      P(box(0.014, 0.012, 0.66, sx * 0.757, 0.345, 0), G_DEEP),
      P(box(0.014, 0.012, 0.46, sx * 0.757, 0.3, 0), G_DEEP),
    );
  }
  for (const f of [1, -1]) {
    parts.push(P(box(0.74, 0.14, 0.012, 0, 0.315, f * 1.506), G_LT));
    parts.push(...one(0, 0.315, f * 1.513, f, 0.95, PLINTH));
    for (const sx of [1, -1]) parts.push(P(box(0.18, 0.014, 0.014, sx * 0.2, 0.315, f * 1.513), G_DEEP));
  }
  // the cup: a foot, a stem with a knop, and a deep bowl with a rolled lip
  const y0 = 0.76;
  const prof = [[0.17, 0], [0.36, 0.05], [0.5, 0.16], [0.59, 0.32], [0.65, 0.48], [0.7, 0.58], [0.76, 0.62]];
  parts.push(
    P(cyl(0.36, 0.42, 0.05, 20, 'y', 0, 0.595, 0), G_DK),
    P(cyl(0.11, 0.17, 0.12, 14, 'y', 0, 0.68, 0), G),
    P(sphere(0.14, 0, 0.7, 0, 1, 0.42, 1, 12, 6), G_LT),
    ...twoSided(lathe(prof, 24, 0, y0, 0), G, G_DK),
    P(cyl(0.18, 0.18, 0.03, 14, 'y', 0, y0 + 0.01, 0), G_DK),
    P(cyl(0.36, 0.42, 0.08, 16, 'y', 0, y0 + 0.1, 0), VELVET),
    P(ring(0.775, 0.775, 0.045, 0, y0 + 0.62, 0, 24), G_LT),
    P(ring(0.665, 0.665, 0.024, 0, y0 + 0.5, 0, 24), G_DK),
  );
  // a medal on the front and the back of the bowl: red enamel, a gold "1"
  for (const f of [1, -1]) {
    const med = [
      P(cyl(0.17, 0.17, 0.03, 18, 'z', 0, 0, 0), G_DK),
      P(cyl(0.14, 0.14, 0.04, 18, 'z', 0, 0, 0.004), ENAMEL),
      ...one(0, 0, 0.03, 1, 1.3, G_LT),
    ];
    place(med, 0, y0 + 0.26, 0.57, -0.5);
    if (f < 0) for (const p of med) at(p.g, 0, 0, 0, 0, Math.PI);
    parts.push(...med);
  }
  // the handles, big ear-shaped loops out of each side of the bowl
  for (const sx of [1, -1]) {
    const pts = [[0.68, 1.32, 0], [0.95, 1.36, 0], [1.08, 1.2, 0], [1.05, 1.02, 0], [0.85, 0.92, 0], [0.5, 0.93, 0]];
    parts.push(P(tube(pts.map(([x, y, z]) => [sx * x, y, z]), 0.055, 16, 6), G));
  }
  // gold mudguards over the wheels
  const track = 0.95, wb = 1.05;
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const g = new THREE.CylinderGeometry(0.52, 0.52, 0.4, 12, 1, true, Math.PI / 2 - 1.2, 2.4).toNonIndexed();
    g.rotateZ(Math.PI / 2);
    g.translate(sx * track, 0.41, -sz * wb);
    parts.push(...twoSided(g, G, G_DK));
  }
  // bumpers, and gold exhausts out of the back of the plinth
  parts.push(
    P(cyl(0.04, 0.04, 1.3, 10, 'x', 0, 0.2, 1.54), G),
    P(cyl(0.04, 0.04, 1.3, 10, 'x', 0, 0.2, -1.54), G),
  );
  for (const sx of [1, -1]) {
    parts.push(
      P(cyl(0.075, 0.075, 0.3, 10, 'z', sx * 0.42, 0.5, -1.5), G_DK),
      P(cyl(0.05, 0.05, 0.31, 10, 'z', sx * 0.42, 0.5, -1.5), BLACK),
    );
  }
  // the mascot: a little trophy on a black block on the bonnet
  const mz = 1.12;
  parts.push(
    P(box(0.24, 0.1, 0.2, 0, 0.62, mz), PLINTH),
    P(box(0.16, 0.04, 0.012, 0, 0.62, mz + 0.106), G_LT),
    P(cyl(0.025, 0.06, 0.08, 10, 'y', 0, 0.71, mz), G),
    ...twoSided(lathe([[0.03, 0], [0.09, 0.03], [0.13, 0.1], [0.145, 0.17]], 14, 0, 0.75, mz), G, G_DK),
    P(hoop(0.05, 0.014, Math.PI * 1.2, -Math.PI * 0.6, 'z', 0.15, 0.84, mz), G),
    P(hoop(0.05, 0.014, Math.PI * 1.2, Math.PI * 0.4, 'z', -0.15, 0.84, mz), G),
  );
  parts.push(...axles(track, wb), ...steering(1.06, 0.4, 0.2));
  return {
    seat: { y: 0.8, z: 0.0, lean: 0 }, ride: 0.4, wheelbase: wb, track,
    parts,
    exhaust: [{ x: 0.42, y: 0.5, z: -1.68 }, { x: -0.42, y: 0.5, z: -1.68 }],
  };
}

export const THEMED_BODIES = { trophy };
