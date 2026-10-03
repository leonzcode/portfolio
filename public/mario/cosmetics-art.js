/* ---------------------------------------------------------------------------
   Leon Kart - the cosmetics, as shapes.

   Novelty bodies, hats, gliders, little things bolted on the back, and one
   pair of sunglasses. Everything here is a part list in the same shape the
   bodies in parts.js use - { g, c } pairs of plain non-indexed geometry and a
   colour - so whoever puts it on a kart merges it into one mesh with its
   colours in the vertices, the same as everything else.

   They are seen small and fast, from six metres behind a moving car, so each
   one is a bold silhouette in a few blocks of colour rather than a model.
   Wherever it makes sense the main panels take the racer's own kart and trim
   colours, so a shark is still Pip's shark.

   Sizes are metres and the nose is +z, the same sketching convention as
   parts.js: the helpers negate z once on the way in.

   Frames:
   - THEMED_BODIES: a chassis spec exactly like formula() in parts.js. The
     game adds the wheels at (+-track, axle, +-wheelbase) and the driver at the
     seat; every body leaves room for both.
   - HATS and sunglasses(): origin at the top centre of the driver's head, the
     head a ~0.55 m block below it (y -0.55..0), face towards +z.
   - GLIDERS: origin at the glider mount above the driver, driver below.
   - DECOR: origin at a mount point on top of the kart's tail.
   A hat part flagged { spin: true } (the propeller) is centred on the y axis,
   so it can be split off into its own mesh and turned if anyone wants to.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { box, cyl, ball, taper, hoop, INK, STEEL, DARK, RUBBER, GLASS, CHROME } from './parts.js?v=100';

const TAU = Math.PI * 2;
const WHITE = 0xf7f6f1, CREAM = 0xfff1d6, GOLD = 0xffd233, GOLD_DK = 0xd9a520, GOLD_LT = 0xffe98a;
const WOOD = 0x8a5a33, WOOD_LT = 0xe8c39a, LEAF = 0x4caf50, BLACK = 0x15161a;
const P = (g, c) => ({ g, c });

/* ---- a few more shapes, all built the way parts.js builds its own -------- */

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
// a flat ring lying level, round or elliptical
function ring(rx, rz, tube, x, y, z, seg = 28) {
  const g = new THREE.TorusGeometry(1, tube, 5, seg).toNonIndexed();
  g.rotateX(Math.PI / 2);
  // scale the ring, not the tube: push each vertex out along its own radius
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vz = p.getZ(i), d = Math.hypot(vx, vz) || 1;
    const cx = vx / d, cz = vz / d;          // the centre of the tube here
    p.setX(i, cx * rx + (vx - cx)); p.setZ(i, cz * rz + (vz - cz));
  }
  g.computeVertexNormals();
  g.translate(x, y, -z);
  return g;
}
// a brim: a flat elliptical ring, rx by rz, lying level with its hole at the centre
function brim(rIn, rx, rz, seg = 28) {
  const g = new THREE.RingGeometry(rIn, 1, seg, 3).toNonIndexed();
  g.rotateX(-Math.PI / 2);
  g.scale(rx, 1, rz);
  return g;
}
/* Bend a level brim: the sides roll up (side) and the front and back dip
   (dip), each growing with the square of the distance past where the crown
   stops, which is the shape a felt brim takes. */
function curl(g, side, dip, from = 0.3) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)), z = Math.abs(p.getZ(i));
    p.setY(i, p.getY(i) + side * Math.max(0, x - from) ** 2 - dip * Math.max(0, z - from * 0.8) ** 2);
  }
  g.computeVertexNormals();
  return g;
}
// faceted shading for a low-segment cylinder, so a hexagon reads as one
function faceted(g) { g.computeVertexNormals(); return g; }

/* The same faces turned inside out. A thin shell (a canopy, a dish, the
   inside of a tub) is only one face thick, and the game's material draws
   front faces only, so it is drawn twice, once each way. */
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

/* A skin stretched through a run of cross sections, front to back: the hull
   of a boat or the body of a shark. Each section is a closed outline in
   (x, y) at a z, all with the same number of points. Faces are turned to
   look out from the middle of the shape. */
function loft(sections) {
  const R = sections.map(s => s.pts.map(p => new THREE.Vector3(p[0], p[1], -s.z)));
  const out = [];
  const centre = ring => ring.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / ring.length);
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
  const tri = (a, b, c, inside) => {
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
    if (n.lengthSq() < 1e-12) return;
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(inside);
    if (n.dot(m) < 0) { const t = b; b = c; c = t; }
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let i = 0; i < R.length - 1; i++) {
    const A = R[i], B = R[i + 1], inside = centre(A).add(centre(B)).multiplyScalar(0.5);
    for (let j = 0; j < A.length; j++) {
      const k = (j + 1) % A.length;
      tri(A[j], A[k], B[k], inside); tri(A[j], B[k], B[j], inside);
    }
  }
  const cap = (ring, next) => {
    const inside = centre(next);
    for (let j = 1; j < ring.length - 1; j++) tri(ring[0], ring[j], ring[j + 1], inside);
  };
  cap(R[0], R[1]); cap(R[R.length - 1], R[R.length - 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

// a star outline, n points, for slabs
function star(n, R, r, rot = 0) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU, k = i % 2 ? r : R;
    pts.push([Math.sin(a) * k, Math.cos(a) * k]);
  }
  return pts;
}

// turn a whole part list about the origin, in the sketch frame
function turnAll(parts, rx = 0, ry = 0, rz = 0) {
  for (const p of parts) at(p.g, 0, 0, 0, rx, ry, rz);
  return parts;
}
function moveAll(parts, x, y, z) {
  for (const p of parts) p.g.translate(x, y, -z);
  return parts;
}

// a little pseudo random sequence, so sprinkles land in the same place each time
function seeded(s) {
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
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

// shorten a body front to back, parts, seat and exhausts together
function squeeze(spec, k) {
  for (const p of spec.parts) p.g.scale(1, 1, k);
  for (const e of spec.exhaust) e.z *= k;
  spec.seat.z *= k;
  return spec;
}

/* ===========================================================================
   THEMED BODIES. Each one is a chassis spec in the same shape as formula():
   where the driver sits, how the floor hangs from the axles, where the wheels
   go and where the exhaust comes out.
=========================================================================== */

/* a speedboat on wheels: a vee hull with a raked bow, a rail round the deck,
   a mast with a pennant and an outboard motor hung off the transom */
function boat(r) {
  const S = [
    { z: 1.78, a: 0.05, yd: 1.0, aw: 0.03, yw: 0.82, yk: 0.76 },
    { z: 1.4, a: 0.42, yd: 0.94, aw: 0.3, yw: 0.52, yk: 0.32 },
    { z: 0.75, a: 0.66, yd: 0.87, aw: 0.56, yw: 0.42, yk: 0.18 },
    { z: -0.4, a: 0.72, yd: 0.85, aw: 0.62, yw: 0.4, yk: 0.16 },
    { z: -1.45, a: 0.66, yd: 0.87, aw: 0.58, yw: 0.42, yk: 0.24 },
  ];
  const side = (s, t) => [s.aw + (s.a - s.aw) * t, s.yw + (s.yd - s.yw) * t];
  const L = (s, t) => { const q = side(s, t); return [-q[0], q[1]]; };
  const parts = [
    // topsides in the kart's colour, a white boot stripe, and a dark bottom
    P(loft(S.map(s => ({ z: s.z, pts: [[s.a, s.yd], side(s, 0.22), L(s, 0.22), [-s.a, s.yd]] }))), r.kart),
    P(loft(S.map(s => ({ z: s.z, pts: [side(s, 0.22), side(s, 0), L(s, 0), L(s, 0.22)] }))), WHITE),
    P(loft(S.map(s => ({ z: s.z, pts: [side(s, 0), [0, s.yk], L(s, 0)] }))), INK),
    // a teak deck behind the screen, with its planking
    P(slab([[0.6, -1.38], [0.67, -0.4], [0.6, 0.7], [-0.6, 0.7], [-0.67, -0.4], [-0.6, -1.38]], 0.03, 'top', 0, 0.875, 0), 0xc8955a),
    P(box(0.02, 0.034, 2.0, 0.3, 0.876, -0.35), 0x8a5a33),
    P(box(0.02, 0.034, 2.0, -0.3, 0.876, -0.35), 0x8a5a33),
    // the windscreen, raked back, framed in the trim colour
    P(at(box(1.0, 0.32, 0.05, 0, 0, 0), 0, 1.04, 0.8, -0.35), GLASS),
    P(rod([-0.52, 1.2, 0.74], [0.52, 1.2, 0.74], 0.035), r.trim),
    P(rod([-0.52, 0.88, 0.86], [-0.52, 1.2, 0.74], 0.03), r.trim),
    P(rod([0.52, 0.88, 0.86], [0.52, 1.2, 0.74], 0.03), r.trim),
  ].concat(steering(0.9, 0.5));
  // the gunwale, a rubbing strake along the deck edge in the trim colour
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    for (const sx of [1, -1]) parts.push(P(rod([sx * a.a, a.yd + 0.02, a.z], [sx * b.a, b.yd + 0.02, b.z], 0.045), r.trim));
  }
  // a guard rail on posts down each side and round the bow
  const rail = [[0.62, 1.16, -1.38], [0.66, 1.16, -0.4], [0.6, 1.18, 0.62], [0.36, 1.22, 1.32], [0.0, 1.26, 1.72]];
  for (const sx of [1, -1]) {
    for (let i = 0; i < rail.length - 1; i++) {
      const a = rail[i], b = rail[i + 1];
      parts.push(P(rod([sx * a[0], a[1], a[2]], [sx * b[0], b[1], b[2]], 0.025), CHROME));
    }
    for (let i = 0; i < rail.length - 1; i++) {
      const a = rail[i];
      parts.push(P(rod([sx * a[0], a[1] - 0.3, a[2]], [sx * a[0], a[1], a[2]], 0.022), CHROME));
    }
  }
  parts.push(P(rod([0, 0.98, 1.72], [0, 1.26, 1.72], 0.022), CHROME));
  // a life ring on each flank, red and white quarters
  for (const sx of [1, -1]) {
    for (let q = 0; q < 4; q++) parts.push(P(hoop(0.16, 0.05, Math.PI / 2, q * Math.PI / 2, 'x', sx * 0.73, 0.64, -0.1), q % 2 ? WHITE : 0xff3b2f));
    // and a porthole up by the bow
    parts.push(P(cyl(0.09, 0.09, 0.05, 10, 'x', sx * 0.64, 0.68, 0.45), CHROME));
    parts.push(P(cyl(0.065, 0.065, 0.07, 10, 'x', sx * 0.64, 0.68, 0.45), GLASS));
  }
  // the mast behind the driver, a spreader, and a pennant in the trim colour
  parts.push(
    P(rod([0, 0.88, -0.95], [0, 2.18, -0.95], 0.045, 0.035, 8), WHITE),
    P(rod([-0.3, 1.66, -0.95], [0.3, 1.66, -0.95], 0.025), WHITE),
    P(slab([[0, 0], [0, 0.34], [-0.6, 0.17]], 0.03, 'side', 0, 1.8, -0.97), r.trim),
    P(ball(0.06, 0, 2.2, -0.95), r.trim),
  );
  // the outboard: a cowl, a leg down past the transom and a propeller
  parts.push(
    P(box(0.4, 0.4, 0.36, 0, 1.0, -1.66), DARK),
    P(box(0.42, 0.14, 0.38, 0, 1.24, -1.66), r.trim),
    P(box(0.14, 0.62, 0.16, 0, 0.6, -1.72), DARK),
    P(cyl(0.13, 0.13, 0.04, 8, 'z', 0, 0.32, -1.82), STEEL),
    P(rod([0, 1.04, -1.46], [0, 1.0, -1.12], 0.03), DARK),       // its tiller
  );
  // a touch shorter overall, so it is no longer than the longest kart
  return squeeze({
    seat: { y: 0.62, z: 0.05, lean: 0 }, ride: 0.4, wheelbase: 1.0, track: 0.95,
    parts,
    exhaust: [{ x: 0, y: 1.0, z: -1.9 }],
  }, 0.92);
}

/* a cottage: walls, a gabled roof in the kart's colour with a hatch over the
   seat so the driver's head comes out of the middle of it, a front door,
   shuttered windows, a window box and a chimney (which is where the boost
   comes out) */
function house(r) {
  const WALL = CREAM, a = Math.atan2(0.5, 0.84);
  const parts = [
    P(box(1.52, 0.12, 2.8, 0, 0.24, 0), 0x8b8f96),                  // a stone footing
    P(box(1.44, 0.72, 2.7, 0, 0.66, 0), WALL),                       // the walls
    P(box(1.3, 0.02, 1.02, 0, 1.03, 0), 0x5a3a22),                   // the floor of the hatch
  ];
  // two roof sections, front and back, each with its gables and a ridge cap
  for (const [z0, z1] of [[1.5, 0.34], [-0.34, -1.5]]) {
    const len = z0 - z1, zc = (z0 + z1) / 2;
    for (const sx of [1, -1]) parts.push(P(at(box(1.1, 0.07, len, 0, 0, 0), sx * 0.47, 1.26, zc, 0, 0, -sx * a), r.kart));
    parts.push(P(box(0.12, 0.08, len, 0, 1.53, zc), r.trim));
    for (const gz of [z0 - 0.17, z1 + 0.17]) parts.push(P(slab([[-0.72, 0], [0.72, 0], [0, 0.47]], 0.06, 'front', 0, 1.02, gz), WALL));
  }
  // the front: a door with a step, an awning, two shuttered windows, and a
  // round window up in the gable
  parts.push(
    P(box(0.34, 0.58, 0.04, 0, 0.6, 1.37), 0x8a4f2a),
    P(ball(0.03, 0.1, 0.58, 1.4), GOLD),
    P(box(0.52, 0.06, 0.18, 0, 0.3, 1.43), 0x9aa0a8),
    P(at(box(0.52, 0.04, 0.22, 0, 0, 0), 0, 0.96, 1.44, 0.25), r.trim),
    P(cyl(0.1, 0.1, 0.04, 12, 'z', 0, 1.2, 1.37), GLASS),
    P(cyl(0.12, 0.12, 0.03, 12, 'z', 0, 1.2, 1.36), WHITE),
  );
  const win = (x, y, z, face) => {
    // face: 'z' for a window in a front or back wall, 'x' for a side wall
    const out = [];
    if (face === 'z') {
      out.push(P(box(0.24, 0.24, 0.03, x, y, z), GLASS));
      out.push(P(box(0.26, 0.03, 0.04, x, y, z), WHITE), P(box(0.03, 0.26, 0.04, x, y, z), WHITE));
      out.push(P(box(0.3, 0.04, 0.06, x, y - 0.14, z), WHITE));
      for (const s of [1, -1]) out.push(P(box(0.08, 0.26, 0.03, x + s * 0.17, y, z), r.trim));
    } else {
      out.push(P(box(0.03, 0.28, 0.46, x, y, z), GLASS));
      out.push(P(box(0.04, 0.03, 0.48, x, y, z), WHITE), P(box(0.04, 0.3, 0.03, x, y, z), WHITE));
      for (const s of [1, -1]) out.push(P(box(0.03, 0.3, 0.12, x, y, z + s * 0.3), r.trim));
    }
    return out;
  };
  for (const sx of [1, -1]) {
    parts.push(...win(sx * 0.45, 0.7, 1.37, 'z'));
    parts.push(...win(sx * 0.35, 0.7, -1.37, 'z'));
    parts.push(...win(sx * 0.735, 0.72, 0, 'x'));
    // a window box of flowers under each side window
    parts.push(P(box(0.1, 0.1, 0.5, sx * 0.78, 0.5, 0), r.kart));
    [0xff5c8a, GOLD, 0xff7a1a].forEach((c, i) => parts.push(P(ball(0.06, sx * 0.78, 0.58, -0.16 + i * 0.16), c)));
    // corner boards
    for (const sz of [1, -1]) parts.push(P(box(0.06, 0.72, 0.06, sx * 0.73, 0.66, sz * 1.36), r.trim));
  }
  // the chimney, in brick, with a cap
  parts.push(
    P(box(0.22, 0.62, 0.22, 0.42, 1.48, -1.0), 0xb5523b),
    P(box(0.28, 0.06, 0.28, 0.42, 1.8, -1.0), DARK),
    P(cyl(0.12, 0.12, 0.03, 12, 'z', 0, 1.2, -1.37), WHITE),
    P(cyl(0.1, 0.1, 0.04, 12, 'z', 0, 1.2, -1.38), GLASS),
  );
  return {
    seat: { y: 0.5, z: 0.0, lean: 0 }, ride: 0.4, wheelbase: 1.0, track: 0.95,
    parts,
    exhaust: [{ x: 0.42, y: 1.88, z: -1.0 }],
  };
}

/* a pencil, ridden like a horse: a yellow hexagon, a sharpened wooden point
   with the lead at the nose, and the metal ferrule and pink eraser behind */
function pencil(r) {
  const Y = 0.5, H = 0.42;                     // the axis height and the hexagon's corner radius
  const hex = (r1, r2, len, z, c) => {
    const g = cyl(r1, r2, len, 6, 'z', 0, 0, 0);
    g.rotateZ(Math.PI / 6);                     // a flat on top, the way it lies on a desk
    g.translate(0, Y, -z);
    return P(faceted(g), c);
  };
  const parts = [
    hex(H, H, 1.86, -0.08, 0xffd233),                          // the paint
    hex(H, 0.12, 0.62, 1.16, WOOD_LT),                          // the sharpened wood
    hex(0.12, 0.015, 0.22, 1.58, 0x3b3b40),                     // and the lead
    hex(H + 0.008, H + 0.008, 0.1, -0.86, r.kart),             // a painted band
    hex(H + 0.008, H + 0.008, 0.04, -0.75, r.trim),
    // the ferrule, with its crimped rings, and the eraser
    P(cyl(0.4, 0.4, 0.36, 14, 'z', 0, Y, -1.19), CHROME),
    P(cyl(0.415, 0.415, 0.045, 14, 'z', 0, Y, -1.07), STEEL),
    P(cyl(0.415, 0.415, 0.045, 14, 'z', 0, Y, -1.15), STEEL),
    P(cyl(0.415, 0.415, 0.045, 14, 'z', 0, Y, -1.25), STEEL),
    P(cyl(0.415, 0.415, 0.045, 14, 'z', 0, Y, -1.33), STEEL),
    P(cyl(0.38, 0.38, 0.26, 14, 'z', 0, Y, -1.5), 0xf28fa6),
    P(cyl(0.32, 0.38, 0.07, 14, 'z', 0, Y, -1.665), 0xf28fa6),
    // the maker's mark down the upper faces, a few letters' worth of dark blocks
    ...[1, -1].flatMap(sx => [[0.3, 0.16], [0.1, 0.06], [-0.12, 0.22]].map(([z, len]) =>
      P(at(box(0.012, 0.1, len, 0, 0, 0), sx * 0.322, Y + 0.186, z, 0, 0, sx * Math.PI / 6), 0x1f3b2a))),
    // a saddle to sit on
    P(box(0.5, 0.08, 0.66, 0, Y + 0.39, -0.16), r.trim),
  ].concat(axles(0.9, 0.95), steering(Y + 0.36, 0.42, 0.22));
  return {
    seat: { y: 0.66, z: -0.15, lean: 0 }, ride: 0.4, wheelbase: 0.95, track: 0.9,
    parts,
    exhaust: [{ x: 0.2, y: Y - 0.1, z: -1.76 }, { x: -0.2, y: Y - 0.1, z: -1.76 }],
  };
}

/* a log: rough bark, sawn ends with their rings, a couple of branch stubs, a
   toadstool growing out of the back, and a cushion lashed on for the driver */
function log(r) {
  const Y = 0.55, R = 0.47, BARK = 0x6b4423, BARK_DK = 0x4a2e17;
  const parts = [P(cyl(R, R, 2.8, 12, 'z', 0, Y, 0), BARK)];
  // ridges of bark running along it
  const rnd = seeded(7);
  for (let i = 0; i < 10; i++) {
    const th = (i / 10) * TAU + rnd() * 0.3, len = 0.8 + rnd() * 1.2, z = (rnd() - 0.5) * (2.6 - len);
    parts.push(P(at(box(0.09, 0.06, len, 0, 0, 0), Math.sin(th) * R, Y + Math.cos(th) * R, z, 0, 0, -th), BARK_DK));
  }
  // the sawn ends, ring inside ring
  for (const s of [1, -1]) {
    parts.push(
      P(cyl(0.44, 0.44, 0.03, 12, 'z', 0, Y, s * 1.405), 0xe0b47a),
      P(cyl(0.31, 0.31, 0.036, 12, 'z', 0, Y, s * 1.41), 0xb98652),
      P(cyl(0.2, 0.2, 0.042, 12, 'z', 0, Y, s * 1.414), 0xe0b47a),
      P(cyl(0.08, 0.08, 0.048, 8, 'z', 0, Y, s * 1.418), 0x9a6a3a),
    );
  }
  // two branch stubs, one still in leaf
  parts.push(
    P(rod([0.3, 0.86, 0.72], [0.66, 1.26, 0.9], 0.1, 0.065, 7), BARK),
    P(ball(0.17, 0.7, 1.36, 0.92), LEAF),
    P(ball(0.13, 0.84, 1.28, 0.8), 0x3f9a44),
    P(ball(0.12, 0.6, 1.46, 1.02), 0x5cbf5c),
    P(rod([-0.32, 0.86, -0.7], [-0.64, 1.16, -0.92], 0.09, 0.07, 7), BARK),
    P(at(cyl(0.07, 0.07, 0.03, 8, 'y', 0, 0, 0), -0.645, 1.165, -0.925, -0.45, 0, 0.82), 0xe0b47a),
  );
  // a toadstool and a little one beside it
  const shroom = (x, y, z, s) => [
    P(cyl(0.06 * s, 0.075 * s, 0.2 * s, 8, 'y', x, y + 0.1 * s, z), 0xf3ead6),
    P(dome(0.19 * s, x, y + 0.18 * s, z, 0.7, Math.PI / 2, 12, 4), 0xd62828),
    P(ball(0.035 * s, x + 0.08 * s, y + 0.28 * s, z + 0.05 * s), WHITE),
    P(ball(0.03 * s, x - 0.07 * s, y + 0.27 * s, z - 0.07 * s), WHITE),
    P(ball(0.03 * s, x - 0.02 * s, y + 0.31 * s, z + 0.1 * s), WHITE),
    P(ball(0.03 * s, x + 0.1 * s, y + 0.24 * s, z - 0.1 * s), WHITE),
  ];
  // off the centre line, so anything bolted on the back stands on the log and not on a toadstool
  parts.push(...shroom(0.28, 0.9, -0.95, 1.2), ...shroom(0.4, 0.8, -1.2, 0.7));
  // rope lashings in the trim colour, and the cushion they hold down
  parts.push(
    P(hoop(R + 0.02, 0.035, TAU, 0, 'z', 0, Y, 0.5), r.trim),
    P(hoop(R + 0.02, 0.035, TAU, 0, 'z', 0, Y, -0.55), r.trim),
    P(box(0.6, 0.12, 0.8, 0, Y + R + 0.02, -0.05), r.kart),
    P(box(0.62, 0.04, 0.82, 0, Y + R + 0.07, -0.05), shade(r.kart, 0.8)),
  );
  parts.push(...axles(0.92, 1.0), ...steering(Y + R - 0.04, 0.5, 0.2));
  return {
    seat: { y: 0.74, z: -0.05, lean: 0 }, ride: 0.4, wheelbase: 1.0, track: 0.92,
    parts,
    exhaust: [{ x: 0.2, y: Y, z: -1.5 }, { x: -0.2, y: Y, z: -1.5 }],
  };
}

/* a rocket: a round body in the kart's colour, a pointed nose and four swept
   fins in the trim colour, portholes, and a nozzle the boost comes out of */
function rocket(r) {
  const Y = 0.6, R = 0.44;
  const parts = [
    P(cyl(R, R, 2.1, 16, 'z', 0, Y, -0.15), r.kart),
    P(cyl(R, 0.32, 0.36, 16, 'z', 0, Y, 1.08), r.trim),
    P(cyl(0.32, 0.0, 0.5, 16, 'z', 0, Y, 1.51), r.trim),
    P(cyl(R + 0.015, R + 0.015, 0.08, 16, 'z', 0, Y, 0.86), WHITE),
    P(cyl(R + 0.015, R + 0.015, 0.1, 16, 'z', 0, Y, -0.95), WHITE),
    P(cyl(R + 0.01, R + 0.01, 0.08, 16, 'z', 0, Y, -1.19), STEEL),
    // the nozzle, flared, with the glow inside it
    P(cyl(0.38, 0.28, 0.34, 14, 'z', 0, Y, -1.38), DARK),
    P(cyl(0.3, 0.3, 0.02, 14, 'z', 0, Y, -1.54), 0xff8a1f),
    // the cockpit: a dark rim round the seat and a raked screen
    P(box(0.62, 0.04, 0.86, 0, Y + R - 0.01, 0.1), INK),
    P(at(box(0.62, 0.24, 0.05, 0, 0, 0), 0, Y + R + 0.1, 0.6, -0.45), GLASS),
    P(rod([-0.32, Y + R + 0.2, 0.55], [0.32, Y + R + 0.2, 0.55], 0.03), r.trim),
  ];
  // four fins in an X, swept back, so the lower pair clears the road
  const fin = (span) => [[-0.4, 0], [-1.2, 0], [-1.5, span], [-1.2, span]];
  for (const [th, span] of [[Math.PI / 4, 0.62], [-Math.PI / 4, 0.62], [3 * Math.PI / 4, 0.4], [-3 * Math.PI / 4, 0.4]]) {
    const g = slab(fin(span).map(([u, v]) => [u, v + R - 0.06]), 0.07, 'side', 0, 0, 0);
    parts.push(P(at(g, 0, Y, 0, 0, 0, -th), r.trim));
  }
  // a porthole each side of the nose
  for (const sx of [1, -1]) {
    parts.push(P(cyl(0.13, 0.13, 0.05, 12, 'x', sx * (R - 0.005), Y + 0.05, 0.5), CHROME));
    parts.push(P(cyl(0.09, 0.09, 0.07, 12, 'x', sx * (R - 0.005), Y + 0.05, 0.5), GLASS));
  }
  parts.push(...axles(0.92, 0.9));
  return {
    seat: { y: 0.72, z: 0.1, lean: 0 }, ride: 0.4, wheelbase: 0.9, track: 0.92,
    parts,
    exhaust: [{ x: 0, y: Y, z: -1.62 }],
  };
}

/* a shark: a lofted body in the kart's colour over a white belly, a tall
   dorsal fin behind the driver, a crescent tail, pectoral fins, gills, eyes,
   and a grin full of teeth at the nose */
function shark(r) {
  const S = [
    { z: 1.6, cy: 0.66, a: 0.07, bt: 0.05, bb: 0.05 },
    { z: 1.42, cy: 0.66, a: 0.34, bt: 0.2, bb: 0.16 },
    { z: 1.08, cy: 0.64, a: 0.56, bt: 0.32, bb: 0.26 },
    { z: 0.5, cy: 0.63, a: 0.7, bt: 0.4, bb: 0.33 },
    { z: -0.3, cy: 0.63, a: 0.7, bt: 0.4, bb: 0.33 },
    { z: -1.0, cy: 0.66, a: 0.46, bt: 0.28, bb: 0.22 },
    { z: -1.5, cy: 0.7, a: 0.2, bt: 0.14, bb: 0.11 },
    { z: -1.72, cy: 0.72, a: 0.09, bt: 0.08, bb: 0.07 },
  ];
  const N = 7;
  const upper = S.map(s => ({ z: s.z, pts: Array.from({ length: N }, (_, i) => {
    const t = (i / (N - 1)) * Math.PI;
    return [Math.cos(t) * s.a, s.cy + Math.sin(t) * s.bt];
  }) }));
  const lower = S.map(s => ({ z: s.z, pts: Array.from({ length: N }, (_, i) => {
    const t = Math.PI + (i / (N - 1)) * Math.PI;
    return [Math.cos(t) * s.a, s.cy + Math.sin(t) * s.bb];
  }) }));
  const parts = [P(loft(upper), r.kart), P(loft(lower), WHITE)];
  // the dorsal fin, swept back behind the seat, and the tail
  parts.push(
    P(slab([[-0.28, 0.95], [-0.88, 1.78], [-0.86, 1.5], [-1.08, 0.88]], 0.1, 'side'), r.kart),
    P(slab([[-1.55, 0.8], [-2.1, 1.5], [-1.98, 1.06], [-1.9, 0.72], [-2.04, 0.32], [-1.62, 0.62]], 0.1, 'side'), r.kart),
  );
  // pectoral fins, angled down, between the wheels
  for (const sx of [1, -1]) {
    const g = slab([[0, 0.32], [sx * 0.46, -0.28], [sx * 0.36, -0.42], [0, -0.06]], 0.05, 'top');
    parts.push(P(at(g, sx * 0.62, 0.44, 0, 0, 0, -sx * 0.35), r.kart));
    // gills
    for (let k = 0; k < 3; k++) parts.push(P(box(0.03, 0.24, 0.04, sx * 0.7, 0.66, 0.66 - k * 0.12), shade(r.kart, 0.55)));
    // an eye: white, with a big black pupil looking forward
    parts.push(P(ball(0.1, sx * 0.46, 0.8, 1.04), WHITE));
    parts.push(P(ball(0.065, sx * 0.52, 0.81, 1.09), BLACK));
  }
  /* The mouth: a dark grin that follows the outline of the snout a little
     proud of it, so it wraps round the nose from cheek to cheek, with white
     teeth along its edge. The outline comes from the same sections the body
     is lofted through. */
  const section = z => {
    for (let i = 0; i < S.length - 1; i++) {
      const A = S[i], B = S[i + 1];
      if (z <= A.z && z >= B.z) {
        const t = (A.z - z) / (A.z - B.z), o = {};
        for (const k of ['cy', 'a', 'bt', 'bb']) o[k] = A[k] + (B[k] - A[k]) * t;
        return o;
      }
    }
    return null;
  };
  const halfW = (z, y) => {
    const s = section(z);
    if (!s) return 0;
    const d = (s.cy - y) / (y < s.cy ? s.bb : s.bt);
    return d >= 1 ? 0 : s.a * Math.sqrt(1 - d * d);
  };
  const yM = 0.55;
  let zTip = 1.6;
  while (zTip > 1.0 && halfW(zTip, yM) < 0.03) zTip -= 0.01;
  const zs = [];
  for (let i = 0; i <= 8; i++) zs.push(0.8 + (zTip - 0.8) * (i / 8));
  const right = zs.map(z => [halfW(z, yM) + 0.03, z]);
  const outer = [...right, [0, zTip + 0.05], ...right.slice().reverse().map(([x, z]) => [-x, z])];
  const inner = outer.slice().reverse().map(([x, z]) => [x * 0.7, 0.98 + (z - 0.98) * 0.7]);
  parts.push(P(slab(outer.concat(inner), 0.12, 'top', 0, yM, 0), 0x3a0d14));
  for (const sx of [1, -1]) {
    for (const i of [2, 4, 6, 8]) {
      const z = zs[i], w = halfW(z, yM) + 0.05;
      parts.push(P(cyl(0.04, 0.0, 0.1, 4, 'y', sx * w, yM + 0.005, z), WHITE));
    }
    for (const i of [3, 5, 7]) {
      const z = zs[i], w = halfW(z, yM) + 0.05;
      parts.push(P(cyl(0.0, 0.035, 0.08, 4, 'y', sx * w, yM - 0.02, z), WHITE));
    }
  }
  parts.push(P(cyl(0.04, 0.0, 0.1, 4, 'y', 0, yM + 0.005, zTip + 0.07), WHITE));
  return squeeze({
    seat: { y: 0.62, z: 0.15, lean: 0 }, ride: 0.4, wheelbase: 1.0, track: 0.95,
    parts,
    exhaust: [{ x: 0.16, y: 0.72, z: -1.7 }, { x: -0.16, y: 0.72, z: -1.7 }],
  }, 0.9);
}

/* a hot dog in its paper tray: two halves of bun, a sausage longer than the
   bun at both ends, and a zigzag of mustard along it in front of and behind
   the driver, who sits astride the sausage */
function hotdog(r) {
  const BUN = 0xe0a050, DOG = 0xb5452f, MUSTARD = 0xffd233;
  const parts = [
    // the tray, in the kart's colours
    P(box(1.4, 0.22, 2.74, 0, 0.32, 0), r.kart),
    P(box(1.42, 0.06, 2.76, 0, 0.37, 0), r.trim),
  ];
  for (const sx of [1, -1]) {
    parts.push(
      P(cyl(0.3, 0.3, 2.0, 12, 'z', sx * 0.36, 0.62, 0), BUN),
      P(sphere(0.3, sx * 0.36, 0.62, 1.0, 1, 1, 0.9), BUN),
      P(sphere(0.3, sx * 0.36, 0.62, -1.0, 1, 1, 0.9), BUN),
    );
  }
  parts.push(
    P(cyl(0.26, 0.26, 2.5, 12, 'z', 0, 0.8, 0), DOG),
    P(sphere(0.26, 0, 0.8, 1.25, 1, 1, 0.95), DOG),
    P(sphere(0.26, 0, 0.8, -1.25, 1, 1, 0.95), DOG),
    // the scored ends of the sausage
    P(box(0.4, 0.03, 0.03, 0, 0.98, 1.35), shade(DOG, 0.7)),
    P(box(0.4, 0.03, 0.03, 0, 0.98, -1.35), shade(DOG, 0.7)),
  );
  // mustard, in a zigzag, either side of the driver
  for (const [z0, z1] of [[1.36, 0.42], [-0.52, -1.4]]) {
    const n = 4, pts = [];
    for (let i = 0; i <= n; i++) pts.push([(i % 2 ? -1 : 1) * 0.15, 1.06, z0 + (z1 - z0) * (i / n)]);
    for (let i = 0; i < n; i++) parts.push(P(rod(pts[i], pts[i + 1], 0.05), MUSTARD));
    for (const p of pts) parts.push(P(ball(0.05, p[0], p[1], p[2]), MUSTARD));
  }
  return {
    seat: { y: 0.74, z: -0.05, lean: 0 }, ride: 0.4, wheelbase: 1.0, track: 0.95,
    parts,
    exhaust: [{ x: 0.3, y: 0.32, z: -1.45 }, { x: -0.3, y: 0.32, z: -1.45 }],
  };
}

/* a clawfoot bathtub on a trolley: a white roll-top tub full of water and
   bubbles, gold claw feet, chrome taps at the front, a towel over the side in
   the kart's colours, and a rubber duck */
function bathtub(r) {
  const parts = [P(box(1.2, 0.08, 2.1, 0, 0.36, 0), DARK)];
  const bowl = (sx, sy, sz) => {
    const g = new THREE.SphereGeometry(1, 18, 7, 0, TAU, Math.PI / 2, Math.PI / 2).toNonIndexed();
    g.scale(sx, sy, sz);
    g.translate(0, 1.0, 0);
    return g;
  };
  parts.push(
    P(bowl(0.72, 0.55, 1.4), WHITE),
    P(flip(bowl(0.69, 0.52, 1.37)), 0xe9eef2),
    P(ring(0.72, 1.4, 0.05, 0, 1.0, 0, 32), WHITE),
    P(ecyl(0.69, 1.36, 0.03, 24, 0, 0.92, 0), 0x8fd3ff),
  );
  // bubbles round the driver and at the ends
  const rnd = seeded(3);
  for (let i = 0; i < 12; i++) {
    const a = rnd() * TAU, d = 0.35 + rnd() * 0.25;
    const x = Math.sin(a) * d * 0.9, z = -0.1 + Math.cos(a) * d * 1.6;
    if (Math.abs(x) > 0.6 || Math.abs(z) > 1.2) continue;
    { const br = 0.07 + rnd() * 0.07; parts.push(P(sphere(br, x, 0.95, z, 1, 1, 1, 8, 5), 0xffffff)); }
  }
  // claw feet, standing on the trolley
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    parts.push(P(rod([sx * 0.3, 0.66, sz * 0.72], [sx * 0.42, 0.46, sz * 0.86], 0.06, 0.045), GOLD_DK));
    parts.push(P(ball(0.08, sx * 0.43, 0.46, sz * 0.88), GOLD_DK));
  }
  // the taps at the front end: a spout and two cross-head valves
  parts.push(
    P(rod([0, 0.98, 1.36], [0, 1.24, 1.36], 0.045), CHROME),
    P(rod([0, 1.24, 1.36], [0, 1.2, 1.12], 0.04), CHROME),
    P(cyl(0.05, 0.035, 0.06, 8, 'y', 0, 1.17, 1.12), CHROME),
  );
  for (const [sx, cap] of [[1, 0xe0302a], [-1, 0x2a6cf0]]) {
    parts.push(
      P(rod([sx * 0.24, 0.98, 1.3], [sx * 0.24, 1.14, 1.3], 0.035), CHROME),
      P(box(0.2, 0.035, 0.035, sx * 0.24, 1.16, 1.3), CHROME),
      P(box(0.035, 0.035, 0.2, sx * 0.24, 1.16, 1.3), CHROME),
      P(ball(0.04, sx * 0.24, 1.19, 1.3), cap),
    );
  }
  // a towel over the left side
  parts.push(
    P(box(0.22, 0.04, 0.52, -0.66, 1.05, 0.45), r.kart),
    P(box(0.04, 0.46, 0.52, -0.78, 0.84, 0.45), r.kart),
    P(box(0.046, 0.05, 0.53, -0.78, 0.74, 0.45), r.trim),
    P(box(0.046, 0.05, 0.53, -0.78, 0.66, 0.45), r.trim),
  );
  // a rubber duck, floating behind the driver
  parts.push(
    P(sphere(0.14, 0.32, 0.97, -0.85, 1, 0.75, 1.25), 0xffd84a),
    P(sphere(0.1, 0.32, 1.12, -0.74), 0xffd84a),
    P(taper(0.06, 0.1, 0.045, 0.035, 0.1, 0.32, 1.1, -0.62), 0xff8a1f),
    P(ball(0.02, 0.37, 1.15, -0.67), BLACK),
    P(ball(0.02, 0.27, 1.15, -0.67), BLACK),
    // chrome pipes out of the back, for the boost
    P(cyl(0.07, 0.07, 0.6, 8, 'z', 0.26, 0.48, -1.2), STEEL),
    P(cyl(0.07, 0.07, 0.6, 8, 'z', -0.26, 0.48, -1.2), STEEL),
  );
  parts.push(...axles(0.95, 0.95));
  return {
    seat: { y: 0.5, z: -0.05, lean: 0 }, ride: 0.4, wheelbase: 0.95, track: 0.95,
    parts,
    exhaust: [{ x: 0.26, y: 0.48, z: -1.55 }, { x: -0.26, y: 0.48, z: -1.55 }],
  };
}

/* a chrome toaster: the driver sits in the front slot like a slice, and two
   slices of toast stand up out of the slots behind; a lever and a browning
   dial in the trim colour, and a base in the kart's colour */
function toaster(r) {
  const CRUST = 0xb06a2a, CRUMB = 0xf2c77a;
  const parts = [
    P(box(1.42, 0.12, 2.56, 0, 0.29, -0.05), r.kart),
    P(box(1.36, 0.6, 2.5, 0, 0.62, -0.05), CHROME),
    P(box(1.02, 0.22, 2.5, 0, 0.98, -0.05), CHROME),
    P(cyl(0.17, 0.17, 2.5, 12, 'z', 0.51, 0.92, -0.05), CHROME),
    P(cyl(0.17, 0.17, 2.5, 12, 'z', -0.51, 0.92, -0.05), CHROME),
    // the slots: the driver's at the front, two for the toast behind
    P(box(0.92, 0.02, 0.62, 0, 1.09, 0.42), INK),
    P(box(1.0, 0.02, 0.2, 0, 1.09, -0.36), INK),
    P(box(1.0, 0.02, 0.2, 0, 1.09, -0.8), INK),
    // a lever down the right side and a dial on the front
    P(box(0.02, 0.46, 0.08, 0.69, 0.64, -0.2), INK),
    P(box(0.18, 0.08, 0.16, 0.77, 0.74, -0.2), r.trim),
    P(cyl(0.11, 0.11, 0.06, 14, 'z', 0.36, 0.62, 1.22), r.trim),
    P(box(0.02, 0.08, 0.02, 0.36, 0.66, 1.26), INK),
    P(cyl(0.11, 0.11, 0.06, 14, 'z', -0.36, 0.62, 1.22), r.trim),
    P(box(0.5, 0.08, 0.02, 0, 0.42, 1.21), r.kart),
    // stripes down the flanks, which is half of what makes it read as a toaster
    P(box(0.012, 0.06, 2.3, 0.685, 0.5, -0.05), STEEL),
    P(box(0.012, 0.06, 2.3, -0.685, 0.5, -0.05), STEEL),
    P(cyl(0.07, 0.07, 0.3, 8, 'z', 0.4, 0.45, -1.36), STEEL),
    P(cyl(0.07, 0.07, 0.3, 8, 'z', -0.4, 0.45, -1.36), STEEL),
  ];
  // two slices of toast, a crust round a pale middle, with the domed top a
  // loaf has
  for (const z of [-0.36, -0.8]) {
    parts.push(
      P(box(0.82, 0.56, 0.12, 0, 1.17, z), CRUST),
      P(cyl(0.25, 0.25, 0.12, 14, 'z', 0.18, 1.46, z), CRUST),
      P(cyl(0.25, 0.25, 0.12, 14, 'z', -0.18, 1.46, z), CRUST),
      P(box(0.7, 0.46, 0.13, 0, 1.2, z), CRUMB),
      P(cyl(0.2, 0.2, 0.13, 14, 'z', 0.18, 1.46, z), CRUMB),
      P(cyl(0.2, 0.2, 0.13, 14, 'z', -0.18, 1.46, z), CRUMB),
    );
  }
  return {
    seat: { y: 0.52, z: 0.42, lean: 0 }, ride: 0.4, wheelbase: 0.95, track: 0.95,
    parts,
    exhaust: [{ x: 0.4, y: 0.45, z: -1.54 }, { x: -0.4, y: 0.45, z: -1.54 }],
  };
}

/* a birthday cake: a long bottom tier the driver sits on, a round top tier
   behind them, icing in the kart's colour running down both in drips, piping
   in the trim colour, candles, cherries and sprinkles */
function cake(r) {
  const SPONGE = 0xfff0dc, ICING = r.kart, PIPE = r.trim;
  const parts = [
    P(ecyl(0.82, 1.5, 0.08, 28, 0, 0.26, 0), CHROME),                 // the cake board
  ];
  const tier = (rx, rz, y0, h, z, drips) => {
    parts.push(
      P(ecyl(rx, rz, h, 22, 0, y0 + h / 2, z), SPONGE),
      P(ecyl(rx + 0.01, rz + 0.01, 0.07, 22, 0, y0 + h + 0.02, z), ICING),
      P(ring(rx + 0.01, rz + 0.01, 0.04, 0, y0 + 0.03, z, 22), PIPE),
      P(ring(rx + 0.012, rz + 0.012, 0.025, 0, y0 + h * 0.45, z, 22), PIPE),
    );
    const rnd = seeded(Math.round(rx * 100));
    for (let i = 0; i < drips; i++) {
      const a = (i / drips) * TAU + rnd() * 0.15, L = 0.1 + rnd() * 0.16;
      const x = Math.sin(a) * (rx + 0.008), dz = Math.cos(a) * (rz + 0.008);
      parts.push(P(cyl(0.045, 0.055, L, 6, 'y', x, y0 + h - L / 2 + 0.01, z + dz), ICING));
    }
  };
  tier(0.74, 1.36, 0.3, 0.42, 0, 18);
  tier(0.48, 0.48, 0.79, 0.34, -0.66, 10);
  // candles on the top tier, striped, each with its flame
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3, x = Math.sin(a) * 0.28, z = -0.66 + Math.cos(a) * 0.28;
    parts.push(
      P(cyl(0.04, 0.04, 0.16, 8, 'y', x, 1.25, z), WHITE),
      P(cyl(0.042, 0.042, 0.11, 8, 'y', x, 1.385, z), PIPE),
      P(cyl(0.008, 0.008, 0.05, 4, 'y', x, 1.46, z), INK),
      P(sphere(0.05, x, 1.53, z, 1, 1.6, 1, 8, 6), 0xffb020),
      P(sphere(0.028, x, 1.515, z, 1, 1.5, 1, 6, 4), 0xfff2a0),
    );
  }
  // cherries round the front of the bottom tier
  for (const [x, z] of [[0.42, 0.75], [-0.42, 0.75], [0, 1.05], [0.5, -0.1], [-0.5, -0.1]]) {
    parts.push(P(ball(0.08, x, 0.84, z), 0xc8102e));
    parts.push(P(rod([x, 0.9, z], [x + 0.03, 1.0, z - 0.03], 0.01), 0x3f8f3a));
  }
  // sprinkles
  const rnd = seeded(11), cols = [0x2b9bd6, 0x3cc46a, 0xffffff, 0xff8ac2, 0xb05be0, GOLD];
  for (let i = 0; i < 14; i++) {
    const a = rnd() * TAU, d = 0.3 + rnd() * 0.6;
    const x = Math.sin(a) * d * 0.62, z = Math.cos(a) * d * 1.2;
    if (z < -0.1 && Math.abs(x) < 0.5) continue;   // under the top tier
    if (Math.abs(z - 0.2) < 0.35 && Math.abs(x) < 0.32) continue; // under the driver
    parts.push(P(at(box(0.08, 0.025, 0.025, 0, 0, 0), x, 0.79, z, 0, rnd() * Math.PI, 0), cols[i % cols.length]));
  }
  return {
    seat: { y: 0.6, z: 0.3, lean: 0 }, ride: 0.4, wheelbase: 1.0, track: 0.95,
    parts,
    exhaust: [{ x: 0.3, y: 0.42, z: -1.5 }, { x: -0.3, y: 0.42, z: -1.5 }],
  };
}

export const THEMED_BODIES = { boat, house, pencil, log, rocket, shark, hotdog, bathtub, toaster, cake };

/* ===========================================================================
   HATS. Origin at the top centre of the head; the head is a ~0.55 m block
   below it, face towards +z. Every hat sits a little down over the top of it.
=========================================================================== */

// a brim: half a disc reaching forward from the front of the crown
function capBrim(rad, depth, y, z, tilt, c) {
  const g = new THREE.CylinderGeometry(rad, rad, 0.04, 14, 1, false, Math.PI / 2, Math.PI).toNonIndexed();
  g.scale(1, 1, depth / rad);
  return P(at(g, 0, y, z, tilt), c);
}

const HATS = {
  cap: (r) => [
    P(cyl(0.36, 0.37, 0.12, 18, 'y', 0, -0.05, 0), r.kart),
    P(dome(0.36, 0, 0.01, 0, 0.6, Math.PI / 2, 18, 5), r.kart),
    capBrim(0.3, 0.3, -0.08, 0.3, 0.12, r.trim),
    P(at(cyl(0.08, 0.08, 0.03, 12, 'z', 0, 0, 0), 0, 0.07, 0.345, -0.5), r.trim),
    P(ball(0.045, 0, 0.23, 0), r.trim),
    // the gap and the strap at the back
    P(box(0.22, 0.09, 0.03, 0, -0.02, -0.36), INK),
    P(box(0.26, 0.04, 0.04, 0, -0.075, -0.365), r.trim),
  ],
  beanie: (r) => {
    const parts = [
      P(cyl(0.375, 0.375, 0.15, 18, 'y', 0, -0.05, 0), r.trim),
      P(cyl(0.355, 0.36, 0.1, 18, 'y', 0, 0.07, 0), r.kart),
      P(dome(0.355, 0, 0.11, 0, 0.75, Math.PI / 2, 18, 5), r.kart),
      P(cyl(0.365, 0.365, 0.06, 18, 'y', 0, 0.1, 0), WHITE),
      P(ball(0.13, 0, 0.42, 0), WHITE),
    ];
    // ribbing on the turned-up cuff
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      parts.push(P(at(box(0.035, 0.15, 0.02, 0, 0, 0), Math.sin(a) * 0.38, -0.05, Math.cos(a) * 0.38, 0, a, 0), shade(r.trim, 0.82)));
    }
    return parts;
  },
  cowboy: (r) => {
    const HIDE = 0x8a5a2b, BAND = 0x3d2412;
    const b = curl(brim(0.25, 0.64, 0.54), 1.5, 0.35, 0.3);
    b.translate(0, -0.07, 0);
    // the crown: a tapered oval, creased front to back down the middle and
    // pinched in at the front
    const crown = new THREE.CylinderGeometry(0.92, 1.1, 0.36, 18, 2).toNonIndexed();
    crown.scale(0.27, 1, 0.31);
    const p = crown.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), zs = -p.getZ(i), up = (y + 0.18) / 0.36;
      if (y > 0.17) p.setY(i, y - 0.09 * Math.max(0, 1 - Math.abs(x) / 0.16));
      if (zs > 0) p.setX(i, x * (1 - 0.22 * up * up * (zs / 0.31)));
    }
    crown.computeVertexNormals();
    crown.translate(0, 0.11, 0);
    return [
      ...twoSided(b, HIDE, shade(HIDE, 0.8)),
      P(crown, HIDE),
      P(ecyl(0.305, 0.345, 0.07, 18, 0, -0.03, 0), BAND),
      P(at(slab(star(5, 0.05, 0.022), 0.02, 'front'), 0, -0.03, 0.35), r.trim),
    ];
  },
  tophat: (r) => {
    const b = curl(brim(0.2, 0.46, 0.42), 1.6, 0.0, 0.3);
    b.translate(0, -0.07, 0);
    return [
      ...twoSided(b, BLACK, 0x23252b),
      P(cyl(0.3, 0.275, 0.6, 18, 'y', 0, 0.24, 0), BLACK),
      P(cyl(0.29, 0.285, 0.13, 18, 'y', 0, 0.02, 0), r.kart),
      P(box(0.08, 0.08, 0.03, 0.12, 0.02, 0.27), r.trim),
    ];
  },
  party: (r) => {
    const parts = [];
    const n = 4, h = 0.2;
    for (let i = 0; i < n; i++) {
      const rb = 0.3 * (1 - i / n), rt = 0.3 * (1 - (i + 1) / n);
      parts.push(P(cyl(rt, rb, h, 16, 'y', 0, -0.06 + h * (i + 0.5), 0), i % 2 ? r.trim : r.kart));
    }
    // dots, and a pom-pom on the point
    for (const [a, y] of [[0.3, 0.06], [2.2, 0.08], [4.2, 0.05], [1.2, 0.3], [3.3, 0.32], [5.3, 0.28], [0.2, 0.5]]) {
      const rr = 0.3 * (1 - (y + 0.06) / 0.8) + 0.01;
      parts.push(P(ball(0.035, Math.sin(a) * rr, y, Math.cos(a) * rr), WHITE));
    }
    parts.push(P(ball(0.1, 0, 0.76, 0), WHITE));
    return turnAll(parts, 0, 0, -0.18);
  },
  propeller: (r) => {
    const cols = [r.kart, r.trim, 0x2b9bd6, 0x3cc46a];
    const parts = [P(cyl(0.375, 0.375, 0.1, 16, 'y', 0, -0.07, 0), r.kart)];
    for (let i = 0; i < 8; i++) {
      parts.push(P(dome(0.37, 0, -0.03, 0, 0.75, Math.PI / 2, 3, 5, (i / 8) * TAU, TAU / 8), cols[i % 4]));
    }
    parts.push(P(cyl(0.025, 0.025, 0.16, 6, 'y', 0, 0.32, 0), STEEL));
    // the propeller itself: a hub and two pitched blades, centred on the y
    // axis so it can be split off and spun
    const spin = [
      { g: ball(0.055, 0, 0.41, 0), c: r.kart, spin: true },
      { g: at(box(0.4, 0.025, 0.11, 0, 0, 0), 0.24, 0.41, 0, 0.35), c: 0xffd233, spin: true },
      { g: at(box(0.4, 0.025, 0.11, 0, 0, 0), -0.24, 0.41, 0, -0.35), c: 0x2b9bd6, spin: true },
    ];
    return parts.concat(spin);
  },
  viking: (r) => {
    const IRON = 0xa7b0ba, BRONZE = 0xc0873a, HORN = 0xf2e6c8, TIP = 0xb59a6a;
    const band = (axis) => { const g = hoop(0.365, 0.03, Math.PI, 0, axis, 0, 0, 0); g.scale(1, 0.82, 1); g.translate(0, -0.06, 0); return g; };
    const parts = [
      P(dome(0.36, 0, -0.06, 0, 0.82, Math.PI / 2, 18, 5), IRON),
      P(cyl(0.375, 0.375, 0.09, 18, 'y', 0, -0.08, 0), BRONZE),
      P(band('x'), BRONZE), P(band('z'), BRONZE),
      P(box(0.07, 0.24, 0.05, 0, -0.18, 0.37), BRONZE),
      P(ball(0.05, 0, 0.25, 0), BRONZE),
    ];
    // horns: out from the sides, then up and curling in
    for (const sx of [1, -1]) {
      const pts = [[0.3, -0.02, 0], [0.5, 0.06, 0.05], [0.63, 0.24, 0.07], [0.64, 0.44, 0.03], [0.56, 0.6, -0.02]];
      const rad = [0.1, 0.078, 0.056, 0.036, 0.008];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        parts.push(P(rod([sx * a[0], a[1], a[2]], [sx * b[0], b[1], b[2]], rad[i], rad[i + 1], 8), i === pts.length - 2 ? TIP : HORN));
        if (i > 0) parts.push(P(ball(rad[i], sx * a[0], a[1], a[2]), HORN));
      }
    }
    return parts;
  },
  wizard: (r) => {
    const ROBE = 0x3a2f8f;
    const parts = [
      P(cyl(0.56, 0.56, 0.035, 22, 'y', 0, -0.07, 0), ROBE),
      P(cyl(0.24, 0.34, 0.44, 16, 'y', 0, 0.17, 0), ROBE),
      P(cyl(0.345, 0.35, 0.08, 16, 'y', 0, -0.01, 0), r.trim),
      P(sphere(0.245, 0, 0.39, 0, 1, 0.4, 1, 16, 6), ROBE),
      P(at(cyl(0.13, 0.24, 0.42, 14, 'y', 0, 0.21, 0), 0, 0.39, 0, -0.3), ROBE),
      P(ball(0.13, 0, 0.79, -0.12), ROBE),
      P(at(cyl(0.0, 0.13, 0.4, 12, 'y', 0, 0.2, 0), 0, 0.78, -0.12, -0.85), ROBE),
    ];
    // stars and a moon, laid on the cone round all sides
    const moon = [];
    for (let i = 0; i <= 8; i++) { const a = -2.4 + (i / 8) * 4.8; moon.push([Math.sin(a) * 0.08, Math.cos(a) * 0.08]); }
    for (let i = 8; i >= 0; i--) { const a = -2.0 + (i / 8) * 4.0; moon.push([Math.sin(a) * 0.06 + 0.03, Math.cos(a) * 0.065]); }
    const rad = y => 0.34 - ((y + 0.05) / 0.44) * 0.1 + 0.012;
    const on = (pts, a, y) => P(at(slab(pts, 0.02, 'front'), Math.sin(a) * rad(y), y, Math.cos(a) * rad(y), -0.22, a), GOLD);
    parts.push(
      on(star(5, 0.08, 0.035), 0, 0.17),
      on(star(5, 0.055, 0.024), 1.3, 0.08),
      on(star(5, 0.06, 0.026), -1.5, 0.26),
      on(star(5, 0.05, 0.022), 2.5, 0.06),
      on(star(5, 0.06, 0.026), -2.6, 0.2),
      on(star(5, 0.045, 0.02), 3.1, 0.3),
      on(moon, -0.75, 0.1),
    );
    return parts;
  },
  crown: (r) => {
    const RED = 0xe0213a, BLUE = 0x2a6cf0, GREEN = 0x1fbf6a, PEARL = 0xfff6e2, VELVET = 0x9b1c2c;
    const band = new THREE.CylinderGeometry(0.37, 0.35, 0.22, 24, 1, true).toNonIndexed();
    band.translate(0, -0.03, 0);
    const parts = [
      ...twoSided(band, GOLD, GOLD_DK),
      P(ring(0.36, 0.36, 0.035, 0, -0.14, 0, 32), GOLD_DK),
      P(ring(0.375, 0.375, 0.03, 0, 0.08, 0, 32), GOLD_DK),
      P(dome(0.34, 0, 0.0, 0, 0.75, Math.PI / 2, 18, 5), VELVET),
    ];
    // ten points round the rim, tall and short in turn, each tipped with a pearl
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU, tall = i % 2 === 0, h = tall ? 0.3 : 0.19, w = tall ? 0.11 : 0.09;
      const x = Math.sin(a) * 0.37, z = Math.cos(a) * 0.37;
      parts.push(P(at(slab([[-w, 0], [w, 0], [0, h]], 0.035, 'front'), x, 0.07, z, -0.08, a, 0), GOLD));
      const tx = Math.sin(a) * (0.37 + 0.024 * h / 0.3), tz = Math.cos(a) * (0.37 + 0.024 * h / 0.3);
      parts.push(P(ball(tall ? 0.045 : 0.035, tx, 0.07 + h + 0.02, tz), PEARL));
    }
    // jewels round the band, alternating, a big ruby at the front
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + TAU / 20;
      const c = [RED, BLUE, GREEN][i % 3];
      parts.push(P(at(box(0.075, 0.075, 0.04, 0, 0, 0), Math.sin(a) * 0.375, -0.03, Math.cos(a) * 0.375, 0, a, Math.PI / 4), c));
    }
    parts.push(P(sphere(0.07, 0, -0.03, 0.38, 1, 1.2, 0.6, 10, 6), RED));
    // two arches over the velvet, up to an orb and a cross
    for (const axis of ['x', 'z']) {
      const g = hoop(0.35, 0.03, Math.PI, 0, axis, 0, 0, 0);
      g.scale(1, 1.25, 1);
      g.translate(0, 0.07, 0);
      parts.push(P(g, GOLD));
    }
    parts.push(
      P(sphere(0.075, 0, 0.55, 0), GOLD),
      P(box(0.04, 0.18, 0.04, 0, 0.71, 0), GOLD),
      P(box(0.13, 0.04, 0.04, 0, 0.73, 0), GOLD),
      P(ball(0.03, 0, 0.73, 0.03), BLUE),
    );
    return parts;
  },
  halo: (r) => {
    const parts = [
      P(ring(0.46, 0.46, 0.06, 0, 0.27, 0, 40), 0xfff1a8),
      P(ring(0.46, 0.46, 0.035, 0, 0.31, 0, 40), 0xfffbe0),
      P(ring(0.46, 0.46, 0.035, 0, 0.23, 0, 40), GOLD),
    ];
    // a few twinkles riding on it
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26, s = i % 2 ? 0.07 : 0.1;
      parts.push(P(at(slab(star(4, s, s * 0.3), 0.02, 'front'), Math.sin(a) * 0.46, 0.27 + (i % 2 ? 0.1 : 0.14), Math.cos(a) * 0.46, 0, a, 0), 0xffffff));
    }
    return parts;
  },
  headphones: (r) => {
    const parts = [
      P(box(0.44, 0.05, 0.1, 0, 0.045, 0), DARK),
      P(box(0.3, 0.05, 0.12, 0, 0.08, 0), r.trim),
      P(hoop(0.12, 0.035, Math.PI / 2, 0, 'z', 0.22, -0.075, 0), DARK),
      P(hoop(0.12, 0.035, Math.PI / 2, Math.PI / 2, 'z', -0.22, -0.075, 0), DARK),
    ];
    for (const sx of [1, -1]) {
      parts.push(
        P(box(0.07, 0.16, 0.08, sx * 0.34, -0.15, 0), DARK),
        P(box(0.05, 0.1, 0.06, sx * 0.36, -0.26, 0), STEEL),
        P(cyl(0.155, 0.155, 0.04, 16, 'x', sx * 0.305, -0.33, 0), INK),
        P(cyl(0.165, 0.165, 0.12, 16, 'x', sx * 0.385, -0.33, 0), r.kart),
        P(cyl(0.11, 0.11, 0.03, 16, 'x', sx * 0.455, -0.33, 0), r.trim),
      );
    }
    return parts;
  },
  chef: (r) => {
    const W = 0xfdfdfb, W2 = 0xeeeeea;
    const parts = [
      P(cyl(0.32, 0.31, 0.26, 18, 'y', 0, 0.04, 0), W),
      P(sphere(0.24, 0, 0.38, 0, 1, 0.8, 1), W),
    ];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      parts.push(P(sphere(0.17, Math.sin(a) * 0.2, 0.3 + (i % 2) * 0.03, Math.cos(a) * 0.2, 1, 0.85, 1, 10, 7), i % 2 ? W2 : W));
    }
    // pleats round the band
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      parts.push(P(at(box(0.02, 0.24, 0.015, 0, 0, 0), Math.sin(a) * 0.318, 0.04, Math.cos(a) * 0.318, 0, a, 0), 0xd9d9d4));
    }
    return parts;
  },
};
export { HATS };

/* ===========================================================================
   GLIDERS. Origin at the mount above the driver, the driver below at about
   y -1.2, nose +z. The game's own hang glider is about 4.6 m across.
=========================================================================== */

// two struts down from a wing to the driver's shoulders, like the hang glider's
const struts = (x, y, z) => [
  P(rod([x, y, z], [0.3, -0.92, 0.05], 0.035), DARK),
  P(rod([-x, y, z], [-0.3, -0.92, 0.05], 0.035), DARK),
];

/* A scalloped membrane wing, drawn as seen from above on the right side and
   mirrored for the left. Fingers fan out from a wrist; between each pair of
   finger tips the trailing edge curves in towards it. Returns the panels
   between the fingers (so they can be coloured separately) and the bones. */
function membrane(rootF, rootB, wrist, tips, pull) {
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const scallop = (p, q) => {
    const m = lerp(p, q, 0.5), c = lerp(m, wrist, pull), out = [];
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t;
      out.push([u * u * p[0] + 2 * u * t * c[0] + t * t * q[0], u * u * p[1] + 2 * u * t * c[1] + t * t * q[1]]);
    }
    return out;
  };
  const panels = [];
  for (let i = 0; i < tips.length - 1; i++) panels.push([wrist, tips[i], ...scallop(tips[i], tips[i + 1]), tips[i + 1]]);
  panels.push([rootF, wrist, tips[tips.length - 1], ...scallop(tips[tips.length - 1], rootB), rootB]);
  return panels;
}
// mirror an outline in x, and the same for a point
const mx = pts => pts.map(([x, z]) => [-x, z]);
// turn a point (x, y) about the z axis by a, for bones that follow a raised wing
const rz2 = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

function wingPair(o) {
  const { rootF, rootB, wrist, tips, pull, y, dihedral, cols, bone, boneR, thick } = o;
  const parts = [];
  for (const sx of [1, -1]) {
    const panels = membrane(rootF, rootB, wrist, tips, pull);
    const a = sx * dihedral;
    panels.forEach((pts, i) => {
      const g = slab(sx > 0 ? pts : mx(pts), thick, 'top', 0, 0, 0);
      parts.push(P(at(g, 0, y, 0, 0, 0, a), cols[i % cols.length]));
    });
    // bones: the arm out to the wrist, and a finger to every tip
    const B = ([x, z]) => { const q = rz2(sx * x, 0.03, a); return [q[0], y + q[1], z]; };
    parts.push(P(rod(B(rootF), B(wrist), boneR * 1.4, boneR * 1.1, 6), bone));
    for (const t of tips) parts.push(P(rod(B(wrist), B(t), boneR, boneR * 0.45, 5), bone));
    parts.push(P(ball(boneR * 1.6, ...B(wrist)), bone));
  }
  return parts;
}

const GLIDERS = {
  parachute: (r) => {
    const parts = [];
    const n = 8, R = 2.0, th = 1.05, sy = 0.62, y0 = -0.25;
    for (let i = 0; i < n; i++) {
      const g = new THREE.SphereGeometry(R, 3, 6, (i / n) * TAU, TAU / n, 0, th).toNonIndexed();
      g.scale(1, sy, 1);
      g.translate(0, y0, 0);
      parts.push(...twoSided(g, i % 2 ? WHITE : r.kart));
    }
    parts.push(P(dome(0.2, 0, y0 + R * sy - 0.06, 0, 0.5), r.trim));
    // cords from the hem down to the harness at the shoulders
    const rimY = y0 + R * Math.cos(th) * sy, rimR = R * Math.sin(th);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, x = Math.cos(a) * rimR, z = -Math.sin(a) * rimR;
      parts.push(P(rod([x, rimY, z], [x > 0 ? 0.32 : -0.32, -0.95, 0.02], 0.02, 0.02, 4), 0x5a606c));
    }
    parts.push(P(box(0.76, 0.06, 0.08, 0, -0.95, 0.02), r.trim));
    return parts;
  },
  umbrella: (r) => {
    const parts = [];
    const n = 8, R = 1.85, th = 1.22, sy = 0.5;
    for (let i = 0; i < n; i++) {
      const g = new THREE.SphereGeometry(R, 3, 6, (i / n) * TAU, TAU / n, 0, th).toNonIndexed();
      g.scale(1, sy, 1);
      parts.push(...twoSided(g, i % 2 ? r.trim : r.kart));
    }
    const rimY = R * Math.cos(th) * sy, rimR = R * Math.sin(th);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, x = Math.cos(a) * rimR, z = -Math.sin(a) * rimR;
      parts.push(P(rod([0, R * sy - 0.06, 0], [x, rimY - 0.02, z], 0.018, 0.018, 4), DARK));
      parts.push(P(ball(0.04, x, rimY - 0.02, z), DARK));
    }
    parts.push(
      P(rod([0, R * sy + 0.22, 0], [0, -0.82, 0], 0.035, 0.035, 6), DARK),
      P(cyl(0.0, 0.05, 0.16, 6, 'y', 0, R * sy + 0.22, 0), STEEL),
      P(rod([0, -0.7, 0], [0, -0.98, 0], 0.05, 0.05, 6), WOOD),
      P(hoop(0.13, 0.045, Math.PI, Math.PI, 'z', 0.13, -0.98, 0), WOOD),
    );
    // held, so it leans a little to one side, over the driver's hand
    return moveAll(turnAll(parts, 0.05, 0, 0.18), 0.17, 0, 0);
  },
  balloons: (r) => {
    const B = [
      [0, 0.95, 0, r.kart], [-0.75, 0.55, 0.2, r.trim], [0.78, 0.62, -0.1, 0x2b9bd6], [-0.32, 0.18, -0.52, 0x3cc46a],
      [0.42, 0.22, 0.56, 0xb05be0], [-0.2, 1.55, -0.3, 0xff8ac2], [0.55, 1.42, 0.32, 0xff8a1f],
    ];
    const hold = [0.36, -0.92, 0.1];
    const parts = [];
    for (const [x, y, z, c] of B) {
      const rr = 0.42;
      parts.push(P(sphere(rr, x, y, z, 1, 1.18, 1, 12, 8), c));
      parts.push(P(cyl(0.06, 0.02, 0.09, 6, 'y', x, y - rr * 1.18 - 0.03, z), shade(c, 0.8)));
      parts.push(P(sphere(0.08, x - 0.14, y + 0.24, z + 0.26, 1, 1.4, 1, 6, 4), 0xffffff));
      parts.push(P(rod([x, y - rr * 1.18 - 0.07, z], hold, 0.014, 0.014, 4), 0xeeeeee));
    }
    return parts;
  },
  batwings: (r) => {
    const parts = wingPair({
      rootF: [0.15, 0.35], rootB: [0.15, -0.45], wrist: [1.0, 0.78],
      tips: [[2.35, 0.25], [2.05, -0.6], [1.4, -0.98], [0.62, -0.88]],
      pull: 0.32, y: 0.05, dihedral: 0.2, thick: 0.05,
      cols: [0x2e2438, 0x3a2d4a], bone: 0x15111c, boneR: 0.045,
    });
    // a little bat in the middle, ears up and red eyed
    parts.push(
      P(sphere(0.26, 0, 0.08, 0, 1, 0.8, 1.2), 0x241c2e),
      P(sphere(0.17, 0, 0.18, 0.3), 0x241c2e),
      P(cyl(0.0, 0.07, 0.18, 4, 'y', 0.09, 0.36, 0.28), 0x241c2e),
      P(cyl(0.0, 0.07, 0.18, 4, 'y', -0.09, 0.36, 0.28), 0x241c2e),
      P(ball(0.035, 0.07, 0.22, 0.45), 0xff3030),
      P(ball(0.035, -0.07, 0.22, 0.45), 0xff3030),
      P(cyl(0.012, 0.0, 0.05, 4, 'y', 0.04, 0.12, 0.45), WHITE),
      P(cyl(0.012, 0.0, 0.05, 4, 'y', -0.04, 0.12, 0.45), WHITE),
    );
    // a claw at each wrist
    for (const sx of [1, -1]) {
      const q = rz2(sx * 1.0, 0.03, sx * 0.2);
      parts.push(P(rod([q[0], 0.05 + q[1], 0.78], [q[0] + sx * 0.02, 0.05 + q[1] + 0.14, 0.92], 0.035, 0.0, 5), 0xd8d2c4));
    }
    return parts.concat(struts(0.45, 0.06, 0.05));
  },
  dragon: (r) => {
    const BONE = 0xd9a520;
    const parts = wingPair({
      rootF: [0.22, 0.48], rootB: [0.22, -0.55], wrist: [1.35, 1.05],
      tips: [[3.05, 0.55], [2.8, -0.55], [2.05, -1.25], [1.08, -1.2]],
      pull: 0.3, y: 0.12, dihedral: 0.32, thick: 0.06,
      cols: [0xf0a030, 0xe0602a, 0xc8331f, 0xa01c18], bone: BONE, boneR: 0.065,
    });
    // spikes along the arm, a horn at the wrist, and a spine between the wings
    for (const sx of [1, -1]) {
      const a = sx * 0.32;
      for (const t of [0.3, 0.55, 0.8]) {
        const x = 0.22 + (1.35 - 0.22) * t, z = 0.48 + (1.05 - 0.48) * t;
        const q = rz2(sx * x, 0.06, a), q2 = rz2(sx * x, 0.26, a);
        parts.push(P(rod([q[0], 0.12 + q[1], z], [q2[0], 0.12 + q2[1], z - 0.12], 0.05, 0.0, 5), GOLD));
      }
      const w = rz2(sx * 1.35, 0.06, a), w2 = rz2(sx * 1.5, 0.4, a);
      parts.push(P(rod([w[0], 0.12 + w[1], 1.05], [w2[0], 0.12 + w2[1], 1.3], 0.07, 0.0, 6), 0xfff2d0));
    }
    parts.push(P(rod([0, 0.14, 0.62], [0, 0.14, -0.7], 0.12, 0.08, 8), 0xa01c18));
    for (const z of [0.4, 0.05, -0.3]) parts.push(P(cyl(0.0, 0.07, 0.22, 4, 'y', 0, 0.32, z), GOLD));
    return parts.concat(struts(0.55, 0.12, 0.1));
  },
  paper: (r) => {
    const PAPER = 0xf7f7f2, FOLD = 0xe2e2da;
    const nose = 1.6, back = -1.3, span = 1.55;
    const lead = z => span * (nose - z) / (nose - back);       // the leading edge's x at a z
    const parts = [];
    for (const sx of [1, -1]) {
      const wing = [[0.02, nose], [span, back], [0.02, back]];
      const stripe = [[0.06, -0.5], [lead(-0.5) - 0.05, -0.5], [lead(-0.78) - 0.05, -0.78], [0.06, -0.78]];
      const thin = [[0.06, -0.92], [lead(-0.92) - 0.05, -0.92], [lead(-1.0) - 0.05, -1.0], [0.06, -1.0]];
      const a = sx * 0.12;
      parts.push(P(at(slab(sx > 0 ? wing : mx(wing), 0.03, 'top'), 0, 0, 0, 0, 0, a), PAPER));
      parts.push(P(at(slab(sx > 0 ? stripe : mx(stripe), 0.034, 'top'), 0, 0.004, 0, 0, 0, a), r.kart));
      parts.push(P(at(slab(sx > 0 ? thin : mx(thin), 0.034, 'top'), 0, 0.004, 0, 0, 0, a), r.trim));
      // a crease down each wing
      const c0 = rz2(sx * 0.5, 0.02, a), c1 = rz2(sx * 0.62, 0.02, a);
      parts.push(P(rod([c0[0], c0[1], 0.6], [c1[0], c1[1], back + 0.02], 0.008, 0.008, 3), 0xcfcfc6));
    }
    // the keel, folded down the middle
    parts.push(P(slab([[nose - 0.05, 0], [back, 0], [back, -0.46], [0.2, -0.3]], 0.05, 'side', 0, -0.005, 0), FOLD));
    parts.push(P(slab([[0.8, -0.12], [-1.0, -0.12], [-1.0, -0.3], [0.0, -0.24]], 0.056, 'side', 0, -0.005, 0), r.kart));
    return parts.concat(struts(0.5, 0.0, -0.1));
  },
};
export { GLIDERS };

/* ===========================================================================
   DECOR. Origin at a mount on top of the kart's tail, +z forward.
=========================================================================== */
const DECOR = {
  flag: (r) => {
    const parts = [
      P(cyl(0.06, 0.07, 0.06, 8, 'y', 0, 0.03, 0), DARK),
      P(rod([0, 0.05, 0], [0, 1.24, 0], 0.022, 0.018, 6), STEEL),
      P(ball(0.045, 0, 1.26, 0), GOLD),
    ];
    // a flag in three panels, kinked so it looks like it is flapping
    const nodes = [[0, 0], [0.07, -0.2], [-0.02, -0.4], [0.06, -0.6]];
    for (let i = 0; i < nodes.length - 1; i++) {
      const [x0, z0] = nodes[i], [x1, z1] = nodes[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.02, ry = Math.atan2(x1 - x0, z1 - z0);
      parts.push(P(at(box(0.02, 0.36, len, 0, 0, 0), (x0 + x1) / 2, 1.0, (z0 + z1) / 2, 0, ry), r.trim));
      parts.push(P(at(box(0.026, 0.08, len, 0, 0, 0), (x0 + x1) / 2, 1.0, (z0 + z1) / 2, 0, ry), r.kart));
    }
    return parts;
  },
  spoiler: (r) => [
    P(box(0.9, 0.04, 0.22, 0, 0.02, 0), DARK),
    P(at(box(0.06, 0.44, 0.2, 0, 0, 0), 0.36, 0.24, -0.04, -0.15), DARK),
    P(at(box(0.06, 0.44, 0.2, 0, 0, 0), -0.36, 0.24, -0.04, -0.15), DARK),
    P(at(box(1.32, 0.06, 0.42, 0, 0, 0), 0, 0.48, -0.08, 0.16), r.kart),
    P(at(box(1.32, 0.05, 0.24, 0, 0, 0), 0, 0.6, -0.12, 0.3), r.kart),
    P(box(1.34, 0.08, 0.03, 0, 0.66, -0.25), r.trim),
    P(box(0.04, 0.34, 0.54, 0.68, 0.52, -0.1), r.trim),
    P(box(0.04, 0.34, 0.54, -0.68, 0.52, -0.1), r.trim),
  ],
  duck: (r) => {
    const Y = 0xffd84a, Y2 = 0xf5c23a, BEAK = 0xff8a1f;
    return [
      P(sphere(0.17, 0, 0.13, 0, 1, 0.76, 1.25), Y),
      P(rod([0, 0.15, -0.16], [0, 0.28, -0.27], 0.075, 0.012, 8), Y),
      P(sphere(0.115, 0, 0.33, 0.1), Y),
      P(taper(0.08, 0.13, 0.05, 0.035, 0.12, 0, 0.31, 0.24), BEAK),
      P(ball(0.022, 0.06, 0.37, 0.19), BLACK),
      P(ball(0.022, -0.06, 0.37, 0.19), BLACK),
      P(sphere(0.08, 0.15, 0.16, -0.04, 0.4, 0.7, 1.3, 8, 6), Y2),
      P(sphere(0.08, -0.15, 0.16, -0.04, 0.4, 0.7, 1.3, 8, 6), Y2),
    ];
  },
  horns: (r) => {
    const HORN = 0xf2e6c8, TIP = 0x4a3a2e;
    const parts = [P(box(0.46, 0.06, 0.2, 0, 0.03, 0), r.kart), P(box(0.2, 0.08, 0.16, 0, 0.08, 0), DARK)];
    for (const sx of [1, -1]) {
      const pts = [[0.1, 0.1, 0], [0.32, 0.15, 0.03], [0.5, 0.27, 0.12], [0.58, 0.45, 0.22], [0.54, 0.62, 0.32]];
      const rad = [0.085, 0.068, 0.05, 0.032, 0.005];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        parts.push(P(rod([sx * a[0], a[1], a[2]], [sx * b[0], b[1], b[2]], rad[i], rad[i + 1], 8), i === pts.length - 2 ? TIP : HORN));
        if (i > 0) parts.push(P(ball(rad[i], sx * a[0], a[1], a[2]), HORN));
      }
    }
    return parts;
  },
  flower: (r) => {
    const STEM = 0x3f8f3a, HX = 0, HY = 0.62, HZ = 0.05, TILT = -0.35;
    const parts = [
      P(cyl(0.08, 0.1, 0.1, 10, 'y', 0, 0.05, 0), r.kart),                 // a little pot
      P(rod([0, 0.08, 0], [0, 0.6, 0.03], 0.025, 0.022, 6), STEM),
      P(at(sphere(0.1, 0, 0, 0, 1, 0.18, 0.45, 8, 4), 0.08, 0.3, 0.02, 0, 0, 0.5), STEM),
      P(at(sphere(0.1, 0, 0, 0, 1, 0.18, 0.45, 8, 4), -0.08, 0.4, 0.0, 0, 0, -0.5), STEM),
    ];
    const head = [
      P(cyl(0.11, 0.11, 0.06, 14, 'z', 0, 0, 0), 0x5a3416),
      P(cyl(0.07, 0.07, 0.065, 12, 'z', 0, 0, 0.005), 0x3a200c),
      P(cyl(0.13, 0.1, 0.04, 14, 'z', 0, 0, -0.04), STEM),
    ];
    for (let i = 0; i < 14; i++) {
      const g = box(0.065, 0.15, 0.02, 0, 0.17, 0);
      head.push(P(at(g, 0, 0, 0, 0, 0, (i / 14) * TAU), i % 2 ? 0xffc61a : 0xffd84a));
    }
    for (const p of head) at(p.g, HX, HY, HZ, TILT);
    return parts.concat(head);
  },
  cone: (r) => {
    const OR = 0xff6a1a, parts = [P(box(0.4, 0.04, 0.4, 0, 0.02, 0), OR)];
    const r0 = 0.16, r1 = 0.03, y0 = 0.04, y1 = 0.62;
    const R = y => r0 + (r1 - r0) * (y - y0) / (y1 - y0);
    const bands = [[0.04, 0.22, OR], [0.22, 0.31, WHITE], [0.31, 0.4, OR], [0.4, 0.48, WHITE], [0.48, 0.62, OR]];
    for (const [a, b, c] of bands) parts.push(P(cyl(R(b), R(a), b - a, 14, 'y', 0, (a + b) / 2, 0), c));
    return parts;
  },
  trophy: (r) => [
    P(box(0.36, 0.12, 0.36, 0, 0.06, 0), 0x1c1c22),
    P(box(0.28, 0.08, 0.28, 0, 0.16, 0), 0x2a2a32),
    P(box(0.2, 0.06, 0.012, 0, 0.065, 0.181), GOLD),
    P(cyl(0.05, 0.1, 0.06, 14, 'y', 0, 0.23, 0), GOLD_DK),
    P(cyl(0.035, 0.05, 0.08, 10, 'y', 0, 0.3, 0), GOLD),
    P(sphere(0.06, 0, 0.35, 0), GOLD_LT),
    P(cyl(0.16, 0.06, 0.12, 18, 'y', 0, 0.44, 0), GOLD),
    P(cyl(0.23, 0.16, 0.18, 18, 'y', 0, 0.59, 0), GOLD),
    P(ring(0.23, 0.23, 0.025, 0, 0.68, 0, 28), GOLD_LT),
    P(cyl(0.205, 0.205, 0.01, 18, 'y', 0, 0.68, 0), GOLD_DK),
    P(hoop(0.1, 0.025, Math.PI * 1.15, -Math.PI * 0.575, 'z', 0.2, 0.55, 0), GOLD),
    P(hoop(0.1, 0.025, Math.PI * 1.15, Math.PI * 0.425, 'z', -0.2, 0.55, 0), GOLD),
    P(at(slab(star(5, 0.07, 0.03), 0.02, 'front'), 0, 0.58, 0.2, 0.12), r.kart),
  ],
  antlers: (r) => {
    const A = 0x7a4f2a, parts = [P(box(0.32, 0.04, 0.12, 0, 0.02, 0), DARK)];
    const branch = (pts, r0, r1) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
        parts.push(P(rod(pts[i], pts[i + 1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, 6), A));
        if (i > 0) parts.push(P(ball(r0 + (r1 - r0) * t0, ...pts[i]), A));
      }
    };
    for (const sx of [1, -1]) {
      const X = x => sx * x;
      branch([[X(0.1), 0.02, 0], [X(0.2), 0.25, -0.04], [X(0.33), 0.45, -0.1], [X(0.38), 0.62, -0.06], [X(0.3), 0.78, 0.02]], 0.055, 0.024);
      branch([[X(0.2), 0.25, -0.04], [X(0.13), 0.38, 0.12]], 0.04, 0.018);
      branch([[X(0.33), 0.45, -0.1], [X(0.46), 0.6, -0.22]], 0.038, 0.016);
      branch([[X(0.33), 0.45, -0.1], [X(0.27), 0.58, 0.1]], 0.035, 0.016);
      branch([[X(0.38), 0.62, -0.06], [X(0.53), 0.74, -0.1]], 0.032, 0.014);
    }
    return parts;
  },
  fins: (r) => {
    const parts = [];
    const fin = [[0.45, 0], [-0.42, 0], [-0.62, 0.52], [-0.44, 0.5], [0.15, 0.08]];
    for (const sx of [1, -1]) {
      const x = sx * 0.45;
      parts.push(
        P(slab(fin, 0.07, 'side', x, 0, 0), r.kart),
        P(rod([x, 0.08, 0.15], [x, 0.5, -0.44], 0.03), CHROME),
        P(box(0.09, 0.04, 0.95, x, 0.02, 0), CHROME),
        // a bullet tail light at the top of the fin
        P(cyl(0.065, 0.065, 0.24, 10, 'z', x, 0.44, -0.47), CHROME),
        P(cyl(0.055, 0.055, 0.04, 10, 'z', x, 0.44, -0.6), 0xff2a2a),
      );
    }
    return parts;
  },
  satellite: (r) => {
    const DISH = 0xf2f2ee, parts = [
      P(cyl(0.1, 0.12, 0.05, 10, 'y', 0, 0.025, 0), DARK),
      P(rod([0, 0.05, 0], [0, 0.36, 0], 0.03), STEEL),
      P(ball(0.05, 0, 0.38, 0), DARK),
    ];
    // the dish, built level then tipped up to face forwards
    const R = 0.42, th = 0.75;
    const dish = new THREE.SphereGeometry(R, 16, 4, 0, TAU, Math.PI - th, th).toNonIndexed();
    dish.translate(0, R, 0);
    const local = [...twoSided(dish, DISH, 0xdfe3e8)];
    const rimY = R - R * Math.cos(th), rimR = R * Math.sin(th), tip = [0, 0.36, 0];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      local.push(P(rod([Math.sin(a) * rimR, rimY, Math.cos(a) * rimR], tip, 0.012, 0.012, 4), STEEL));
    }
    local.push(P(cyl(0.035, 0.05, 0.08, 8, 'y', 0, 0.37, 0), r.trim));
    for (const p of local) at(p.g, 0, 0.4, 0.02, 0.6);
    return parts.concat(local);
  },
};
export { DECOR };

/* ===========================================================================
   Thomas's sunglasses. Same frame as a hat: the head is a block below the
   origin, its face at z ~ +0.27. Wraparound shades, a dark lens with a blue
   frame, a glint across each lens, and arms back to the ears.
=========================================================================== */
export function sunglasses() {
  const LENS = 0x101418, FRAME = 0x1a2a44, GLINT = 0xbfd4ff;
  const lens = [[-0.115, 0.06], [0.115, 0.065], [0.12, -0.02], [0.07, -0.075], [-0.08, -0.07], [-0.115, -0.02]];
  const parts = [
    P(box(0.66, 0.05, 0.05, 0, -0.205, 0.3), FRAME),
    P(box(0.07, 0.035, 0.035, 0, -0.245, 0.31), FRAME),
  ];
  for (const sx of [1, -1]) {
    const pts = sx > 0 ? lens : mx(lens);
    parts.push(P(at(slab(pts, 0.03, 'front'), sx * 0.14, -0.265, 0.3, 0, sx * 0.22), LENS));
    // a glint: a long stroke and a short one across the lens
    parts.push(P(at(box(0.022, 0.11, 0.004, 0, 0, 0), sx * 0.14 - 0.035, -0.255, 0.318, 0, sx * 0.22, -0.6), GLINT));
    parts.push(P(at(box(0.012, 0.06, 0.004, 0, 0, 0), sx * 0.14 + 0.005, -0.25, 0.318, 0, sx * 0.22, -0.6), GLINT));
    // the outer edge wraps back round the side of the face, standing a
    // little proud of it so it shows from behind as well
    parts.push(P(at(box(0.06, 0.11, 0.035, 0, 0, 0), sx * 0.29, -0.24, 0.26, 0, sx * 0.9), LENS));
    // hinge and arm, back along the side of the head to the ear
    parts.push(P(box(0.05, 0.06, 0.06, sx * 0.305, -0.215, 0.24), FRAME));
    parts.push(P(box(0.045, 0.055, 0.36, sx * 0.31, -0.22, 0.06), FRAME));
    parts.push(P(at(box(0.045, 0.1, 0.05, 0, 0, 0), sx * 0.31, -0.26, -0.12, -0.3), FRAME));
  }
  return parts;
}
