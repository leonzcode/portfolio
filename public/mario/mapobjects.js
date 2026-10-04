/* ---------------------------------------------------------------------------
   Leon Kart - things a player can put on a map.

   Every object here is a list of parts, the same as a kart: boxes, cylinders,
   balls, tapers, hoops and a few shapes of our own, each with one colour, all
   of which merge into a single mesh with its colours in the vertices. A map
   with two hundred things on it is then two hundred draw calls at the very
   worst, and instanced it is one per kind.

   The frame every make() builds in:
     - metres, y = 0 is the ground it stands on, centred on x = 0, z = 0;
     - +z is the front (the helpers negate z once, as they do for a kart);
     - things you drive over (pads, the ramp) are driven toward +z, so their
       chevrons point +z and the ramp's high lip is at +z;
     - things that float are built in the air already (an item box at 1.2 m, a
       balloon basket at 8 m, a UFO at 8 m), and the sky things are built high
       and big: the planet's middle is 70 m up, the moon's 55 m, the star's
       40 m, a cloud's 34 m, so a sky object dropped on the ground anywhere
       near the edge of a map is already in the sky.

   make(color) takes an optional 0xRRGGBB. Where an object has an obvious main
   colour (a house roof, a car of a rocket, a balloon's stripes) the colour
   goes there; for the lights it is the colour of the light. Left out, every
   object is its own natural colour.

   Nothing glows on its own. "Glowing" here means bright, saturated colours,
   and the game is free to add emissive on top.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { box, cyl, ball, taper, hoop, merge, vertexMat, INK, STEEL, DARK, GLASS, CHROME } from './parts.js?v=105';

/* ---- the palette ------------------------------------------------------- */
const RED = 0xe8402a, YEL = 0xffd233, BLUE = 0x2b56d6, GREEN = 0x43d94f;
const CREAM = 0xfff6e2, ORANGE = 0xf4762a, PINK = 0xff6fae, PURPLE = 0x9b5cff, CYAN = 0x39d0ff;
const WHITE = 0xf4f6fa, BLACK = 0x15171d, BARK = 0x6b4a2f, GOLD = 0xffc233;
const RUBBER = 0x1d2430, WOOD = 0x8a6a42;
const RAINBOW = [0xff4d5e, 0xff9a2e, 0xffe14d, 0x5fe36b, 0x39d0ff, 0x6a7bff, 0xc46bff];
const SHIRTS = [0xe8402a, 0xffd233, 0x2b56d6, 0x43d94f, 0x8fd3ff, 0xfff6e2, 0xf4762a, 0xff6fae];
const SKIN = [0xf0c8a0, 0xd9a273, 0xa9754c, 0x7a4f2e, 0xf7ddc0];

const TAU = Math.PI * 2;
const tintOr = (color, def) => (color === undefined || color === null ? def : color);
// k below 1 darkens, above 1 lifts toward white (1.3 = a third of the way)
function shade(hex, k) {
  let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  if (k >= 1) { const t = Math.min(1, k - 1); r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
  else { r *= k; g *= k; b *= k; }
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
function mix(a, b, t) {
  const ch = (h, s) => (h >> s) & 255;
  const m = s => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
const P = (g, c) => ({ g, c });

/* ---- shapes ------------------------------------------------------------- */
const flat = g => (g.index ? g.toNonIndexed() : g);
/* Turn a shape built round the origin (x, then y, then z, radians) and then put
   it at x, y, z with +z the front. ry turns +x toward the front; rx > 0 lifts
   the front and tips the top back; rz > 0 tips the top toward -x. */
function put(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, -z);
  return g;
}
// the same for a whole list of parts built round a shared origin
function moved(list, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  for (const p of list) put(p.g, x, y, z, rx, ry, rz);
  return list;
}
// a ball, without parts.js's toNonIndexed warning on a shape that already is
const orb = (r, x, y, z) => put(new THREE.IcosahedronGeometry(r, 1), x, y, z);
function blob(r, sx, sy, sz, x, y, z) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  g.scale(sx, sy, sz);
  return put(g, x, y, z);
}
const sph = (r, ws, hs, ps, pl, ts, tl) =>
  flat(new THREE.SphereGeometry(r, ws, hs, ps || 0, pl === undefined ? TAU : pl, ts || 0, tl === undefined ? Math.PI : tl));
// a cone standing on y
const cone = (r, h, seg, x, y, z) => cyl(0, r, h, seg, 'y', x, y + h / 2, z);
// a ring lying in the x-y plane (facing the front), round the origin
function torus(R, r, rs, ts, arc, start) {
  const g = flat(new THREE.TorusGeometry(R, r, rs, ts, arc === undefined ? TAU : arc));
  if (start) g.rotateZ(start);
  return g;
}
// a ring lying flat
const ring = (R, r, rs, ts, x, y, z) => put(torus(R, r, rs, ts), x, y, z, Math.PI / 2);

const UP = new THREE.Vector3(0, 1, 0);
// a round bar from A to B, r at A and rEnd at B
function rod(ax, ay, az, bx, by, bz, r, seg = 6, rEnd) {
  const A = new THREE.Vector3(ax, ay, -az), B = new THREE.Vector3(bx, by, -bz);
  const d = B.clone().sub(A), len = Math.max(1e-4, d.length());
  const g = flat(new THREE.CylinderGeometry(rEnd === undefined ? r : rEnd, r, len, seg));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
/* A flat bar from A to B: w wide and t thick. The width lies square to `up`,
   so with up 'y' a slab lies flat like a plank on the ground, and with up 'z'
   it stands in the x-y plane like a letter on a sign. */
function slab(ax, ay, az, bx, by, bz, w, t, up) {
  const A = new THREE.Vector3(ax, ay, -az), B = new THREE.Vector3(bx, by, -bz);
  const dir = B.clone().sub(A), len = Math.max(1e-4, dir.length());
  dir.normalize();
  const U = up === 'z' ? new THREE.Vector3(0, 0, -1) : up === 'x' ? new THREE.Vector3(1, 0, 0) : UP.clone();
  const side = new THREE.Vector3().crossVectors(dir, U);
  if (side.lengthSq() < 1e-8) side.crossVectors(dir, Math.abs(dir.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1));
  side.normalize();
  const nrm = new THREE.Vector3().crossVectors(dir, side);
  const g = flat(new THREE.BoxGeometry(w, t, len));
  g.applyMatrix4(new THREE.Matrix4().makeBasis(side, nrm, dir));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// point a shape's +y along a direction (given with +z the front), then put it at x, y, z
function stick(g, nx, ny, nz, x, y, z) {
  const n = new THREE.Vector3(nx, ny, -nz).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, n));
  g.translate(x, y, -z);
  return g;
}
/* Knock every corner of a shape in or out by up to amp of itself. Corners that
   share a place move together, so the faces stay joined and just go faceted,
   which is what a rock is. */
function jag(g, amp, seed) {
  g = flat(g);
  const p = g.attributes.position, seen = new Map(), r = rng(seed);
  for (let i = 0; i < p.count; i++) {
    const key = Math.round(p.getX(i) * 997) + '|' + Math.round(p.getY(i) * 997) + '|' + Math.round(p.getZ(i) * 997);
    let k = seen.get(key);
    if (k === undefined) { k = 1 + (r() * 2 - 1) * amp; seen.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}
// a rock, sat so its lowest point is at `bottom`
function stone(r, seed, amp, sx, sy, sz, x, bottom, z, detail) {
  const g = jag(new THREE.DodecahedronGeometry(r, detail || 0), amp, seed);
  g.rotateY(seed * 0.7);
  g.scale(sx, sy, sz);
  return sit(g, x, bottom, z);
}
// put any shape with its lowest point at `bottom`
function sit(g, x, bottom, z) {
  g.computeBoundingBox();
  g.translate(x, bottom - g.boundingBox.min.y, -z);
  return g;
}
/* A prism across x: wBot wide at the foot, wTop at the top (0 makes a gable
   roof whose ridge runs front to back), h tall, d deep, standing on y = 0. */
function gable(wBot, wTop, h, d) {
  const g = flat(new THREE.BoxGeometry(wBot, h, d));
  const p = g.attributes.position, k = wTop / wBot;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setX(i, p.getX(i) * k);
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}
// a wedge on y = 0: nothing at the back, h tall at the front (+z)
function wedge(w, h, d) {
  const g = flat(new THREE.BoxGeometry(w, h, d));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0 && p.getY(i) > 0) p.setY(i, -h / 2 + 0.03);
  g.translate(0, h / 2, 0);
  g.computeVertexNormals();
  return g;
}
// a puffy star, points in the x-y plane, one point up
function starShape(ro, ri, depth, n) {
  n = n || 5;
  const rim = [];
  for (let k = 0; k < n * 2; k++) {
    const a = Math.PI / 2 + k * Math.PI / n, r = k % 2 ? ri : ro;
    rim.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const pos = [];
  for (let k = 0; k < n * 2; k++) {
    const a = rim[k], b = rim[(k + 1) % (n * 2)];
    pos.push(0, 0, depth, a[0], a[1], 0, b[0], b[1], 0);
    pos.push(0, 0, -depth, b[0], b[1], 0, a[0], a[1], 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
// turn a closed shape inside out, so from outside you see its far wall and through its near one
function insideOut(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      let t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t;
      t = n[i + 3 + k]; n[i + 3 + k] = n[i + 6 + k]; n[i + 6 + k] = t;
    }
  }
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}
// a chevron lying flat, pointing +z, apex at z
function chevron(z, span, depth, w, y, c) {
  return [
    P(slab(-span, y, z - depth, 0.02, y, z, w, 0.06), c),
    P(slab(span, y, z - depth, -0.02, y, z, w, 0.06), c),
  ];
}

/* ===================================================================== nature */

function pine(color) {
  const leaf = tintOr(color, 0x2f7d3a);
  const out = [P(cyl(0.3, 0.45, 2.4, 7, 'y', 0, 1.2, 0), BARK)];
  [[2.7, 3.0, 1.6], [2.15, 2.7, 3.2], [1.55, 2.4, 4.7], [0.9, 1.9, 6.1]].forEach(([r, h, y], i) => {
    out.push(P(put(cyl(0, r, h, 8, 'y', 0, h / 2, 0), 0, y, 0, 0, i * 0.4, 0), shade(leaf, 0.84 + i * 0.09)));
  });
  return out;
}

function oak(color) {
  const leaf = tintOr(color, 0x4f9e3a);
  return [
    P(cyl(0.38, 0.6, 3.4, 7, 'y', 0, 1.7, 0), BARK),
    P(rod(0, 2.6, 0, 1.2, 3.8, 0.4, 0.17, 5), BARK),
    P(rod(0, 2.8, 0, -1.1, 3.9, -0.5, 0.16, 5), BARK),
    P(blob(2.3, 1, 0.86, 1, 0, 5.0, 0), leaf),
    P(blob(1.75, 1, 0.9, 1, 1.6, 4.4, 0.6), shade(leaf, 0.9)),
    P(blob(1.65, 1, 0.9, 1, -1.55, 4.5, -0.4), shade(leaf, 0.86)),
    P(blob(1.5, 1, 0.9, 1, 0.3, 6.1, -0.7), shade(leaf, 1.1)),
    P(blob(1.4, 1, 0.9, 1, -0.6, 4.3, 1.5), shade(leaf, 0.95)),
    P(blob(1.35, 1, 0.9, 1, 0.7, 4.2, -1.6), shade(leaf, 0.92)),
  ];
}

function palm(color) {
  const leaf = tintOr(color, 0x3fa34a);
  const out = [];
  const pt = k => { const t = k / 7; return [1.5 * t * t, 7.2 * t]; };
  for (let k = 0; k < 7; k++) {
    const [x0, y0] = pt(k), [x1, y1] = pt(k + 1);
    const r = 0.34 - k * 0.02;
    out.push(P(rod(x0, y0, 0, x1, y1 + 0.06, 0, r, 7, r - 0.025), k % 2 ? 0xa07a4c : 0xc29a63));
  }
  const [cx, cy] = pt(7);
  out.push(P(orb(0.5, cx, cy, 0), shade(leaf, 0.75)));
  for (let i = 0; i < 7; i++) {
    const a = i * TAU / 7 + 0.3, dx = Math.cos(a), dz = Math.sin(a);
    const mx = cx + dx * 1.7, my = cy + 0.5, mz = dz * 1.7;
    const ex = cx + dx * 3.5, ey = cy - 0.9, ez = dz * 3.5;
    out.push(P(slab(cx, cy + 0.1, 0, mx, my, mz, 0.85, 0.08), leaf));
    out.push(P(slab(mx, my, mz, ex, ey, ez, 0.7, 0.08), shade(leaf, 0.86)));
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.6;
    out.push(P(orb(0.27, cx + Math.cos(a) * 0.42, cy - 0.38, Math.sin(a) * 0.42), 0x6b4a2f));
  }
  return out;
}

function cactus(color) {
  const g = tintOr(color, 0x4f9a48), d = shade(g, 0.75);
  const out = [
    P(cyl(0.55, 0.62, 4.4, 8, 'y', 0, 2.2, 0), g),
    P(blob(0.55, 1, 0.75, 1, 0, 4.4, 0), g),
  ];
  for (let k = 0; k < 4; k++) {
    const a = k * TAU / 4 + Math.PI / 8;
    out.push(P(put(box(0.14, 4.3, 0.14, 0, 0, 0), Math.cos(a) * 0.55, 2.2, Math.sin(a) * 0.55), d));
  }
  // right arm, low; left arm, higher
  out.push(P(rod(0.4, 1.9, 0, 1.35, 1.9, 0, 0.34, 8), g));
  out.push(P(orb(0.34, 1.35, 1.9, 0), g));
  out.push(P(cyl(0.34, 0.34, 1.7, 8, 'y', 1.35, 2.75, 0), g));
  out.push(P(blob(0.34, 1, 0.75, 1, 1.35, 3.6, 0), g));
  out.push(P(rod(-0.4, 2.7, 0, -1.25, 2.7, 0, 0.3, 8), g));
  out.push(P(orb(0.3, -1.25, 2.7, 0), g));
  out.push(P(cyl(0.3, 0.3, 1.2, 8, 'y', -1.25, 3.3, 0), g));
  out.push(P(blob(0.3, 1, 0.75, 1, -1.25, 3.9, 0), g));
  out.push(P(blob(0.24, 1, 0.6, 1, 0, 4.85, 0), PINK));
  out.push(P(blob(0.17, 1, 0.6, 1, 1.35, 3.85, 0), PINK));
  return out;
}

function bush(color) {
  const leaf = tintOr(color, 0x4a9a3e);
  const out = [
    P(blob(1.2, 1.2, 0.8, 1.1, 0, 0.82, 0), leaf),
    P(blob(0.95, 1, 0.8, 1, 0.95, 0.65, 0.3), shade(leaf, 0.9)),
    P(blob(0.9, 1, 0.8, 1, -0.95, 0.62, -0.2), shade(leaf, 0.86)),
    P(blob(0.8, 1, 0.8, 1, 0.2, 0.58, 0.95), shade(leaf, 1.08)),
    P(blob(0.75, 1, 0.8, 1, -0.3, 0.55, -0.95), shade(leaf, 0.94)),
  ];
  [[0.6, 1.25, 0.6], [-0.5, 1.2, 0.7], [1.3, 0.8, 0.8], [-1.2, 0.85, 0.5], [0.1, 1.45, -0.3], [-0.8, 0.6, -1.0]]
    .forEach(([x, y, z]) => out.push(P(orb(0.12, x, y, z), RED)));
  return out;
}

function rock(color) {
  const c = tintOr(color, 0x8d929b);
  return [
    P(stone(1.3, 11, 0.25, 1.2, 0.8, 1.0, 0, -0.1, 0), c),
    P(stone(0.62, 23, 0.25, 1, 0.8, 1, 1.4, -0.06, 0.6), shade(c, 0.86)),
    P(stone(0.45, 37, 0.3, 1, 0.75, 1, -1.25, -0.05, -0.7), shade(c, 1.1)),
  ];
}

function boulder(color) {
  const c = tintOr(color, 0x7f828b);
  return [
    P(stone(2.5, 5, 0.22, 1.15, 0.82, 1.0, 0, -0.2, 0), c),
    P(stone(1.1, 8, 0.25, 1, 0.85, 1, 2.5, -0.1, 1.1), shade(c, 0.88)),
    P(stone(0.8, 9, 0.25, 1, 0.8, 1, -2.4, -0.1, -1.0), shade(c, 1.08)),
    P(stone(0.5, 14, 0.3, 1, 0.8, 1, 1.1, -0.05, 2.2), shade(c, 0.95)),
  ];
}

function flowers(color) {
  const out = [P(cyl(1.95, 2.1, 0.14, 12, 'y', 0, 0.07, 0), 0x5fae4a)];
  const r = rng(77);
  const PET = [RED, YEL, PINK, WHITE, PURPLE, ORANGE];
  for (let i = 0; i < 15; i++) {
    const a = i * 2.39996, d = 1.7 * Math.sqrt((i + 0.5) / 15);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.5 + r() * 0.45;
    const pc = color === undefined || color === null ? PET[i % PET.length] : shade(color, 0.85 + (i % 3) * 0.12);
    out.push(P(cyl(0.035, 0.045, h, 4, 'y', x, h / 2 + 0.1, z), 0x3e8a35));
    const head = [];
    for (let k = 0; k < 5; k++) head.push(P(put(box(0.17, 0.05, 0.3, 0, 0, 0.17), 0, 0, 0, 0, k * TAU / 5, 0), pc));
    head.push(P(box(0.14, 0.09, 0.14, 0, 0.03, 0), i % 2 ? YEL : 0xffb02e));
    out.push(...moved(head, x, h + 0.12, z, -0.25, a, 0));
  }
  return out;
}

function mushroom(color) {
  const cap = tintOr(color, RED), stem = 0xfff1d6;
  const R = 1.8, SY = 0.72, Y0 = 2.0;
  const dome = sph(R, 16, 8, 0, TAU, 0, Math.PI / 2);
  dome.scale(1, SY, 1);
  put(dome, 0, Y0, 0);
  const out = [
    P(cyl(0.6, 0.8, 2.1, 12, 'y', 0, 1.05, 0), stem),
    P(cyl(R, R, 0.1, 16, 'y', 0, Y0 + 0.02, 0), 0xf6e2c4),
    P(cyl(1.5, 1.0, 0.3, 14, 'y', 0, Y0 - 0.12, 0), 0xe8cfa8),
    P(dome, cap),
    P(blob(0.15, 1, 2.1, 0.6, 0.25, 1.35, 0.66), BLACK),
    P(blob(0.15, 1, 2.1, 0.6, -0.25, 1.35, 0.66), BLACK),
  ];
  const spots = [[0, 0, 0.5]];
  for (let k = 0; k < 5; k++) spots.push([0.72, k * TAU / 5 + 0.3, 0.42]);
  for (let k = 0; k < 6; k++) spots.push([1.22, k * TAU / 6 + 0.9, 0.32]);
  for (const [th, ph, rs] of spots) {
    const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
    const px = R * nx, py = Y0 + SY * R * ny, pz = R * nz;
    out.push(P(stick(cyl(rs, rs, 0.14, 9, 'y', 0, 0, 0), nx, ny / SY, nz, px, py, pz), WHITE));
  }
  return out;
}

function crystal(color) {
  const c = tintOr(color, 0xb26bff), tip = shade(c, 1.5), lit = shade(c, 1.2);
  const out = [P(stone(1.5, 4, 0.2, 1.25, 0.45, 1.1, 0, -0.1, 0), 0x3c3550)];
  const C = [
    [4.8, 0.62, 0, 0, 0.04], [3.4, 0.48, 0.95, 0.35, 0.42], [3.0, 0.45, -0.85, 0.5, 0.48],
    [2.6, 0.42, -0.4, -0.9, 0.4], [2.2, 0.36, 0.6, -0.75, 0.55], [1.7, 0.3, 1.3, -0.2, 0.75],
    [1.5, 0.28, -1.25, -0.3, 0.8], [1.9, 0.32, 0.2, 1.1, 0.62],
  ];
  C.forEach(([h, r, x, z, lean], i) => {
    const L = Math.hypot(x, z) || 1, dx = x / L, dz = z / L;
    const parts = [
      P(cyl(r, r * 0.9, h, 6, 'y', 0, h / 2, 0), i % 2 ? lit : c),
      P(cyl(0, r * 0.9, r * 1.9, 6, 'y', 0, h + r * 0.95, 0), tip),
    ];
    for (const p of parts) p.g.rotateY(i * 0.9);
    out.push(...moved(parts, x, 0.25, z, -lean * dz, 0, -lean * dx));
  });
  return out;
}

function snowman(color) {
  const snow = 0xf3f7ff, scarf = tintOr(color, RED), coal = 0x22252c;
  const out = [
    P(orb(1.05, 0, 0.98, 0), snow),
    P(orb(0.78, 0, 2.45, 0), snow),
    P(orb(0.55, 0, 3.55, 0), snow),
    P(put(cyl(0, 0.12, 0.7, 6, 'y', 0, 0.35, 0), 0, 3.5, 0.45, -Math.PI / 2), ORANGE),
    P(orb(0.08, 0.2, 3.72, 0.47), coal),
    P(orb(0.08, -0.2, 3.72, 0.47), coal),
    P(cyl(0.6, 0.6, 0.08, 12, 'y', 0, 3.98, 0), coal),
    P(cyl(0.4, 0.4, 0.62, 12, 'y', 0, 4.32, 0), coal),
    P(cyl(0.41, 0.41, 0.14, 12, 'y', 0, 4.08, 0), scarf),
    P(ring(0.52, 0.14, 5, 14, 0, 3.05, 0), scarf),
    P(slab(0.3, 3.0, 0.5, 0.45, 2.3, 0.66, 0.28, 0.08, 'z'), scarf),
    P(rod(0.65, 2.6, 0, 1.75, 3.25, 0, 0.05, 4), BARK),
    P(rod(1.4, 3.05, 0, 1.6, 3.5, 0, 0.04, 4), BARK),
    P(rod(-0.65, 2.6, 0, -1.75, 3.2, 0, 0.05, 4), BARK),
    P(rod(-1.4, 3.0, 0, -1.65, 3.4, 0, 0.04, 4), BARK),
  ];
  for (let k = 0; k < 5; k++) {
    const a = -0.6 + k * 0.3;
    out.push(P(orb(0.05, Math.sin(a) * 0.3, 3.38 - Math.cos(a) * 0.08, 0.48), coal));
  }
  for (const y of [2.2, 2.5, 2.8]) out.push(P(orb(0.08, 0, y, 0.74 - Math.abs(y - 2.45) * 0.3), coal));
  return out;
}

function iceberg(color) {
  const ice = tintOr(color, 0xe2f6ff), deep = mix(ice, 0x5fb4e6, 0.45), mid = mix(ice, 0x8fd0f5, 0.3);
  return [
    P(stone(3.3, 3, 0.18, 1.15, 0.38, 1.0, 0, -0.1, 0), deep),
    P(stone(2.2, 6, 0.22, 1.1, 1.25, 0.95, -0.4, 0.1, 0.1), mid),
    P(sit(jag(new THREE.CylinderGeometry(0.25, 1.5, 5.2, 6, 2), 0.18, 9), 0.8, 0.4, -0.4), ice),
    P(sit(jag(new THREE.CylinderGeometry(0.2, 1.1, 3.6, 5, 2), 0.2, 12), -1.4, 0.4, 0.9), ice),
    P(sit(jag(new THREE.CylinderGeometry(0.15, 0.9, 2.6, 5, 1), 0.2, 15), 1.9, 0.3, 1.2), mid),
    P(stone(0.7, 21, 0.3, 1.2, 0.5, 1, 3.6, -0.05, 1.6), ice),
    P(stone(0.55, 25, 0.3, 1.2, 0.5, 1, -3.3, -0.05, -1.4), ice),
  ];
}

function lavarock(color) {
  /* Dark plates laid over a glowing core, close enough that the core only
     shows in the seams between them: the cracks are the gaps. */
  const glow = tintOr(color, 0xff6a1a), hot = mix(glow, 0xffe14d, 0.6), CY = 1.5;
  const out = [P(put(jag(new THREE.IcosahedronGeometry(1.4, 1), 0.05, 31), 0, CY, 0), glow)];
  const r = rng(5), N = 16;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) / N * 1.75, rad = Math.sqrt(Math.max(0, 1 - y * y)), th = i * 2.39996;
    const g = jag(new THREE.DodecahedronGeometry(0.64 + r() * 0.1, 0), 0.15, 40 + i);
    g.rotateY(i * 1.7);
    const d = 1.3;
    out.push(P(put(g, Math.cos(th) * rad * d, CY + y * d, Math.sin(th) * rad * d), i % 3 ? 0x2e2a2e : 0x3d363a));
  }
  out.push(P(cyl(0.7, 0.85, 0.08, 9, 'y', 1.9, 0.04, 0.9), glow));
  out.push(P(cyl(0.5, 0.6, 0.08, 8, 'y', -1.7, 0.04, 1.2), glow));
  out.push(P(cyl(0.3, 0.35, 0.1, 7, 'y', 1.9, 0.08, 0.9), hot));
  return out;
}

function bamboo(color) {
  const g = tintOr(color, 0x7cc04a), node = shade(g, 0.72), leaf = 0x4f9e3a;
  const out = [];
  const S = [[0, 0, 7.4, 0.2, 0.03], [0.6, 0.3, 6.4, 0.18, 0.1], [-0.55, 0.35, 5.8, 0.17, 0.12],
             [0.2, -0.6, 6.9, 0.19, 0.08], [-0.4, -0.45, 5.2, 0.16, 0.14], [0.9, -0.3, 4.6, 0.15, 0.16],
             [-0.95, -0.05, 4.9, 0.16, 0.15]];
  S.forEach(([x, z, h, r, lean], i) => {
    const parts = [P(cyl(r, r, h, 6, 'y', 0, h / 2, 0), i % 2 ? shade(g, 1.08) : g)];
    for (let y = 1.1; y < h - 0.3; y += 1.15) parts.push(P(cyl(r * 1.3, r * 1.3, 0.12, 6, 'y', 0, y, 0), node));
    for (let k = 0; k < 3; k++) {
      const a = i * 1.3 + k * 2.1, y = h - 0.6 - k * 0.9;
      parts.push(P(slab(0, y, 0, Math.cos(a) * 1.2, y - 0.5, Math.sin(a) * 1.2, 0.32, 0.04), leaf));
    }
    const L = Math.hypot(x, z) || 1;
    out.push(...moved(parts, x, 0, z, -lean * z / L, 0, -lean * x / L));
  });
  return out;
}

// a sky thing: a fat cumulus, built 34 m up
function cloud(color) {
  const c = tintOr(color, 0xffffff), under = shade(c, 0.86);
  return moved([
    P(blob(5.5, 1.6, 0.55, 1.0, 0, -1.2, 0), under),
    P(blob(5.0, 1, 0.9, 1, 0, 1.2, 0), c),
    P(blob(4.0, 1, 0.9, 1, 4.6, 0.4, 0.6), c),
    P(blob(3.8, 1, 0.9, 1, -4.6, 0.2, -0.4), c),
    P(blob(3.4, 1, 0.9, 1, 2.0, 3.2, -0.8), shade(c, 1.05)),
    P(blob(3.0, 1, 0.9, 1, -2.4, 2.6, 1.0), c),
    P(blob(2.8, 1, 0.85, 1, 7.6, -0.4, -0.2), under),
    P(blob(2.6, 1, 0.85, 1, -7.4, -0.6, 0.4), under),
  ], 0, 34, 0);
}

/* ================================================================== buildings */

function house(color) {
  const roof = tintOr(color, RED), wall = CREAM, trim = 0x8a5a3a, W = 6, D = 5, H = 3.4;
  const out = [
    P(box(W + 0.2, 0.3, D + 0.2, 0, 0.15, 0), 0x9a9ea6),
    P(box(W, H, D, 0, 0.3 + H / 2, 0), wall),
    P(put(gable(D + 0.9, 0, 2.3, W + 0.7), 0, 0.3 + H - 0.05, 0, 0, Math.PI / 2), roof),
    P(box(0.75, 1.7, 0.75, 1.6, 0.3 + H + 1.4, -1.0), 0xa5513a),
    P(box(0.9, 0.18, 0.9, 1.6, 0.3 + H + 2.3, -1.0), 0x7a3a2a),
    P(box(1.05, 2.0, 0.12, 0, 0.3 + 1.0, D / 2 + 0.04), trim),
    P(orb(0.07, 0.32, 1.3, D / 2 + 0.14), GOLD),
    P(box(1.5, 0.16, 0.7, 0, 0.08, D / 2 + 0.45), 0x9a9ea6),
  ];
  for (const sx of [-1, 1]) {
    out.push(P(box(1.2, 1.0, 0.1, sx * 1.85, 2.15, D / 2 + 0.04), GLASS));
    out.push(P(box(1.36, 0.14, 0.14, sx * 1.85, 1.6, D / 2 + 0.06), WHITE));
    out.push(P(box(0.08, 1.0, 0.13, sx * 1.85, 2.15, D / 2 + 0.06), WHITE));
    out.push(P(box(0.32, 1.1, 0.1, sx * 1.85 - 0.8, 2.15, D / 2 + 0.05), roof));
    out.push(P(box(0.32, 1.1, 0.1, sx * 1.85 + 0.8, 2.15, D / 2 + 0.05), roof));
    out.push(P(box(0.1, 1.0, 1.1, sx * (W / 2 + 0.04), 2.15, 0), GLASS));
    out.push(P(box(0.12, 0.12, 1.26, sx * (W / 2 + 0.06), 2.15, 0), WHITE));
  }
  return out;
}

function tower(color) {
  const stoneC = 0xb9b4a8, dk = 0x8f8a80, flag = tintOr(color, RED);
  const out = [
    P(cyl(2.4, 2.75, 0.8, 10, 'y', 0, 0.4, 0), dk),
    P(cyl(2.2, 2.45, 9, 10, 'y', 0, 4.9, 0), stoneC),
    P(cyl(2.32, 2.36, 0.35, 10, 'y', 0, 3.6, 0), dk),
    P(cyl(2.24, 2.27, 0.35, 10, 'y', 0, 6.9, 0), dk),
    P(cyl(2.75, 2.25, 0.7, 10, 'y', 0, 9.65, 0), dk),
    P(cyl(2.75, 2.75, 0.7, 10, 'y', 0, 10.35, 0), stoneC),
    P(box(1.4, 2.1, 0.6, 0, 1.05 + 0.3, 2.3), 0x2a2018),
    P(cyl(0.7, 0.7, 0.6, 10, 'z', 0, 2.4, 2.3), 0x2a2018),
    P(rod(0, 10.5, 0, 0, 14.2, 0, 0.07, 5), DARK),
    P(slab(0.05, 13.65, 0, 1.9, 13.65, 0, 1.0, 0.07, 'z'), flag),
  ];
  for (let k = 0; k < 10; k++) {
    const a = k * TAU / 10;
    out.push(P(put(box(0.95, 0.9, 0.55, 0, 0, 0), Math.cos(a) * 2.5, 11.15, Math.sin(a) * 2.5, 0, a + Math.PI / 2, 0), stoneC));
  }
  for (const [a, y] of [[Math.PI / 2, 5.2], [Math.PI / 2 + 1.3, 7.8], [Math.PI / 2 - 1.3, 7.8], [Math.PI / 2 + 2.6, 5.0], [Math.PI / 2 - 2.6, 5.0]]) {
    out.push(P(put(box(0.3, 1.1, 0.3, 0, 0, 0), Math.cos(a) * 2.28, y, Math.sin(a) * 2.28, 0, a + Math.PI / 2, 0), 0x2a2018));
  }
  return out;
}

function castle(color) {
  const stoneC = 0xbdb7aa, dk = 0x8f8a80, roof = tintOr(color, BLUE), hole = 0x241c16;
  const out = [
    P(box(8.4, 5.2, 1.7, 0, 2.6, 0), stoneC),
    P(box(8.6, 0.5, 1.9, 0, 0.25, 0), dk),
    P(box(2.8, 3.5, 1.8, 0, 1.75, 0), hole),
    P(cyl(1.4, 1.4, 1.8, 12, 'z', 0, 3.5, 0), hole),
    P(box(3.4, 0.3, 0.3, 0, 5.0, 0.95), dk),
  ];
  for (const x of [-1.0, -0.35, 0.35, 1.0]) out.push(P(box(0.12, 3.6, 0.12, x, 2.25, 0.9), DARK));
  for (const y of [1.0, 2.2, 3.4]) out.push(P(box(2.8, 0.1, 0.12, 0, y, 0.9), DARK));
  for (let k = 0; k < 7; k++) out.push(P(box(0.75, 0.8, 1.7, -3.6 + k * 1.2, 5.6, 0), stoneC));
  for (const sx of [-1, 1]) {
    const x = sx * 4.6;
    out.push(P(cyl(1.75, 1.95, 7.4, 10, 'y', x, 3.7, 0), stoneC));
    out.push(P(cyl(2.05, 1.8, 0.5, 10, 'y', x, 7.45, 0), dk));
    out.push(P(cone(2.25, 3.4, 10, x, 7.7, 0), roof));
    out.push(P(rod(x, 11.0, 0, x, 12.6, 0, 0.05, 4), DARK));
    out.push(P(slab(x + 0.04, 12.25, 0, x + 1.25, 12.25, 0, 0.65, 0.06, 'z'), roof === BLUE ? YEL : shade(roof, 1.4)));
    for (const y of [3.0, 5.4]) out.push(P(box(0.3, 1.0, 0.3, x, y, 1.82), hole));
  }
  return out;
}

function lighthouse(color) {
  const stripe = tintOr(color, RED);
  const out = [
    P(cyl(2.6, 2.85, 1.0, 12, 'y', 0, 0.5, 0), 0x9a9ea6),
    P(box(1.0, 1.8, 0.4, 0, 1.9, 2.1), 0x2a3550),
  ];
  for (let k = 0; k < 6; k++) {
    const y0 = 1 + k * 2, y1 = y0 + 2;
    const r0 = 2.1 - (y0 - 1) / 12 * 0.75, r1 = 2.1 - (y1 - 1) / 12 * 0.75;
    out.push(P(cyl(r1, r0, 2, 12, 'y', 0, (y0 + y1) / 2, 0), k % 2 ? WHITE : stripe));
  }
  out.push(P(cyl(2.0, 1.6, 0.4, 12, 'y', 0, 13.2, 0), DARK));
  out.push(P(ring(1.9, 0.05, 4, 16, 0, 14.15, 0), DARK));
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8;
    out.push(P(cyl(0.04, 0.04, 0.75, 4, 'y', Math.cos(a) * 1.9, 13.78, Math.sin(a) * 1.9), DARK));
  }
  out.push(P(cyl(1.05, 1.05, 1.7, 10, 'y', 0, 14.25, 0), 0xfff2a0));
  for (let k = 0; k < 5; k++) {
    const a = k * TAU / 5;
    out.push(P(box(0.12, 1.7, 0.12, Math.cos(a) * 1.06, 14.25, Math.sin(a) * 1.06), DARK));
  }
  out.push(P(cone(1.4, 1.5, 10, 0, 15.1, 0), stripe));
  out.push(P(orb(0.22, 0, 16.65, 0), DARK));
  for (const y of [5.5, 9.3]) out.push(P(box(0.5, 0.8, 0.3, 0, y, 2.1 - (y - 1) / 12 * 0.75), 0x2a3550));
  return out;
}

function windmill(color) {
  const sail = tintOr(color, RED), body = 0xf2e6cf, roof = 0x7a4a2e, spar = 0x5a3e2a;
  const HY = 7.4, HZ = 2.0;
  const out = [
    P(cyl(2.55, 2.7, 0.7, 8, 'y', 0, 0.35, 0), 0x9a9188),
    P(cyl(1.55, 2.4, 6.6, 8, 'y', 0, 0.7 + 3.3, 0), body),
    P(cyl(1.75, 1.75, 0.35, 8, 'y', 0, 7.3, 0), roof),
    P(cone(1.85, 2.4, 8, 0, 7.45, 0), roof),
    P(cyl(0.32, 0.32, 1.4, 8, 'z', 0, HY, 1.35), DARK),
    P(orb(0.38, 0, HY, HZ), DARK),
    P(box(1.0, 1.9, 0.3, 0, 1.65, 2.2), 0x5a3a24),
    P(box(0.7, 0.8, 0.2, 0, 4.4, 1.85), GLASS),
    P(ring(2.0, 0.08, 4, 16, 0, 3.0, 0), spar),
  ];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
    out.push(P(slab(0, HY, HZ, dx * 5.6, HY + dy * 5.6, HZ, 0.2, 0.16, 'z'), spar));
    const o = 0.62;
    out.push(P(slab(dx * 1.2 + px * o, HY + dy * 1.2 + py * o, HZ + 0.06, dx * 5.5 + px * o, HY + dy * 5.5 + py * o, HZ + 0.06, 1.05, 0.06, 'z'), sail));
    for (const t of [2.2, 3.4, 4.6]) {
      out.push(P(slab(dx * t - px * 0.1, HY + dy * t - py * 0.1, HZ + 0.1, dx * t + px * 1.18, HY + dy * t + py * 1.18, HZ + 0.1, 0.07, 0.06, 'z'), spar));
    }
  }
  return out;
}

function skyscraper(color) {
  const body = tintOr(color, 0x34466e), W = 8, D = 8, H = 34;
  const warm = 0xffe7a3, cool = 0xc7e8ff, dk = shade(body, 0.7);
  const out = [
    P(box(W + 0.8, 3.0, D + 0.8, 0, 1.5, 0), dk),
    P(box(W - 1, 2.2, 0.1, 0, 1.3, D / 2 + 0.42), cool),
    P(box(W, H, D, 0, H / 2, 0), body),
    P(box(W * 0.7, 3.4, D * 0.7, 0, H + 1.7, 0), dk),
    P(box(W + 0.3, 0.4, D + 0.3, 0, H + 0.2, 0), shade(body, 1.25)),
    P(rod(0, H + 3.4, 0, 0, H + 9, 0, 0.15, 5, 0.06), STEEL),
    P(orb(0.25, 0, H + 9.1, 0), RED),
  ];
  for (let f = 0; f < 12; f++) {
    const y = 4.4 + f * 2.5, c = f % 3 === 1 ? cool : warm;
    out.push(P(box(W * 0.9, 1.3, 0.1, 0, y, D / 2 + 0.03), c));
    out.push(P(box(W * 0.9, 1.3, 0.1, 0, y, -D / 2 - 0.03), f % 2 ? warm : cool));
    out.push(P(box(0.1, 1.3, D * 0.9, W / 2 + 0.03, y, 0), f % 4 === 2 ? warm : cool));
    out.push(P(box(0.1, 1.3, D * 0.9, -W / 2 - 0.03, y, 0), c));
  }
  const top = 4.4 + 11 * 2.5 + 0.7, bot = 4.4 - 0.7, hh = top - bot, my = (top + bot) / 2;
  for (const u of [-2.4, -0.8, 0.8, 2.4]) {
    out.push(P(box(0.22, hh, 0.16, u, my, D / 2 + 0.05), body));
    out.push(P(box(0.22, hh, 0.16, u, my, -D / 2 - 0.05), body));
    out.push(P(box(0.16, hh, 0.22, W / 2 + 0.05, my, u), body));
    out.push(P(box(0.16, hh, 0.22, -W / 2 - 0.05, my, u), body));
  }
  return out;
}

function barn(color) {
  const red = tintOr(color, 0xb8322a), roof = 0x4e4a4c, white = WHITE, W = 7.4, D = 9;
  const out = [
    P(box(W, 4.2, D, 0, 2.1, 0), red),
    P(gable(W, 5.2, 1.8, D, 0), red),
    P(gable(5.2, 0.01, 1.1, D), red),
  ];
  out[1].g.translate(0, 4.2, 0);
  out[2].g.translate(0, 6.0, 0);
  for (const s of [-1, 1]) {
    out.push(P(slab(s * 4.0, 3.95, 0, s * 2.7, 6.1, 0, 0.22, D + 0.6, 'z'), roof));
    out.push(P(slab(s * 2.75, 6.0, 0, s * -0.05, 7.2, 0, 0.22, D + 0.6, 'z'), roof));
    for (const zz of [-1, 1]) out.push(P(box(0.25, 4.2, 0.25, s * (W / 2 + 0.02), 2.1, zz * (D / 2 + 0.02)), white));
  }
  // the big doors with their white cross, and the hay loft
  out.push(P(box(3.6, 3.2, 0.12, 0, 1.6, D / 2 + 0.05), shade(red, 0.82)));
  out.push(P(box(3.9, 0.22, 0.16, 0, 3.3, D / 2 + 0.07), white));
  out.push(P(box(0.22, 3.3, 0.16, -1.85, 1.65, D / 2 + 0.07), white));
  out.push(P(box(0.22, 3.3, 0.16, 1.85, 1.65, D / 2 + 0.07), white));
  out.push(P(box(0.18, 3.3, 0.16, 0, 1.65, D / 2 + 0.07), white));
  for (const s of [-1, 1]) {
    out.push(P(slab(s * 0.1, 0.15, D / 2 + 0.09, s * 1.75, 3.15, D / 2 + 0.09, 0.2, 0.12, 'z'), white));
    out.push(P(slab(s * 1.75, 0.15, D / 2 + 0.09, s * 0.1, 3.15, D / 2 + 0.09, 0.2, 0.12, 'z'), white));
  }
  out.push(P(box(1.5, 1.3, 0.12, 0, 5.2, D / 2 + 0.05), 0x3a2418));
  out.push(P(box(1.8, 0.18, 0.16, 0, 5.9, D / 2 + 0.07), white));
  out.push(P(box(1.8, 0.18, 0.16, 0, 4.5, D / 2 + 0.07), white));
  out.push(P(box(0.4, 0.4, 0.4, 0, 7.3, D / 2 + 0.25), roof));
  return out;
}

function pyramid(color) {
  const sand = tintOr(color, 0xe3c27a), H = 9.6, R = 9.9;
  const out = [];
  const bands = 5;
  for (let k = 0; k < bands; k++) {
    const y0 = k * H / bands, y1 = (k + 1) * H / bands;
    const r0 = R * (1 - y0 / H), r1 = R * (1 - y1 / H);
    out.push(P(put(cyl(r1 + (k === bands - 1 ? 0 : 0.001), r0, y1 - y0, 4, 'y', 0, 0, 0), 0, (y0 + y1) / 2, 0, 0, Math.PI / 4),
      k % 2 ? shade(sand, 0.92) : sand));
  }
  // the gold cap sits over the last band's point
  out.push(P(put(cyl(0, R * 0.17, H * 0.17, 4, 'y', 0, 0, 0), 0, H * 0.915, 0, 0, Math.PI / 4), GOLD));
  out.push(P(box(1.5, 2.0, 1.2, 0, 1.0, 6.4), 0x3a2a1a));
  out.push(P(box(2.1, 0.35, 1.3, 0, 2.15, 6.3), shade(sand, 0.8)));
  return out;
}

function grandstand(color) {
  const seat = tintOr(color, BLUE), conc = 0xb9bcc4, roof = CREAM;
  const out = [];
  const r = rng(321);
  for (let k = 0; k < 5; k++) {
    const y = 0.7 + k * 0.85, z = 2.6 - k * 1.3;
    out.push(P(box(14, y, 1.3, 0, y / 2, z), k % 2 ? conc : shade(conc, 0.94)));
    out.push(P(box(13.6, 0.5, 0.14, 0, y + 0.3, z - 0.55), k % 2 ? seat : shade(seat, 1.2)));
    for (let i = 0; i < 9; i++) {
      if (r() < 0.12) continue;
      const x = -6 + i * 1.5 + (r() - 0.5) * 0.4;
      out.push(P(box(0.55, 0.72, 0.42, x, y + 0.45, z - 0.15), SHIRTS[(r() * SHIRTS.length) | 0]));
      out.push(P(box(0.36, 0.36, 0.36, x, y + 1.02, z - 0.15), SKIN[(r() * SKIN.length) | 0]));
    }
  }
  out.push(P(box(14.4, 7.0, 0.4, 0, 3.5, -3.35), shade(conc, 0.85)));
  out.push(P(box(0.4, 7.0, 6.6, -7.2, 3.5, -0.2), shade(conc, 0.85)));
  out.push(P(box(0.4, 7.0, 6.6, 7.2, 3.5, -0.2), shade(conc, 0.85)));
  out.push(P(slab(0, 7.0, -3.6, 0, 7.6, 3.0, 15.2, 0.3), roof));
  out.push(P(box(15.2, 0.4, 0.34, 0, 7.55, 3.0), seat));
  for (const x of [-7.2, 7.2]) out.push(P(box(0.3, 0.6, 0.3, x, 7.2, 2.6), DARK));
  return out;
}

function ferris(color) {
  const rim = tintOr(color, RED), steel = 0xd8dde4, CY = 7.6, R = 6.2;
  const out = [
    P(box(9.6, 0.4, 3.6, 0, 0.2, 0), 0x9a9ea6),
    P(rod(0, CY, -1.45, 0, CY, 1.45, 0.3, 8), DARK),
    P(orb(0.6, 0, CY, 0), DARK),
    P(box(2.2, 2.0, 1.6, 4.0, 1.4, 2.6), 0xfff6e2),
    P(box(2.5, 0.25, 1.9, 4.0, 2.5, 2.6), rim),
  ];
  for (const z of [-1, 1]) {
    out.push(P(rod(-3.7, 0.3, z * 1.45, 0, CY, z * 1.15, 0.2, 6), STEEL));
    out.push(P(rod(3.7, 0.3, z * 1.45, 0, CY, z * 1.15, 0.2, 6), STEEL));
    out.push(P(rod(-2.2, 3.4, z * 1.35, 2.2, 3.4, z * 1.35, 0.1, 5), STEEL));
    out.push(P(put(torus(R, 0.16, 6, 32), 0, CY, z * 0.75), rim));
    out.push(P(put(torus(R * 0.55, 0.08, 5, 20), 0, CY, z * 0.75), steel));
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8;
      out.push(P(rod(0, CY, z * 0.75, Math.cos(a) * R, CY + Math.sin(a) * R, z * 0.75, 0.055, 4), steel));
    }
  }
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + Math.PI / 8, x = Math.cos(a) * R, y = CY + Math.sin(a) * R;
    const c = RAINBOW[k % RAINBOW.length];
    out.push(P(rod(x, y, -0.8, x, y, 0.8, 0.07, 4), steel));
    out.push(P(rod(x, y, 0, x, y - 0.45, 0, 0.05, 4), steel));
    out.push(P(box(1.4, 0.2, 1.3, x, y - 0.5, 0), c));
    out.push(P(box(1.2, 0.95, 1.1, x, y - 1.1, 0), shade(c, 1.35)));
  }
  return out;
}

function bridgeArch(color) {
  const stoneC = tintOr(color, 0xcdbfa8), dk = shade(stoneC, 0.86), CY = -1.5, Ri = 9.2, Ro = 10.4, Rm = (Ri + Ro) / 2;
  const out = [];
  const a0 = Math.asin(-CY / Rm) - 0.02, N = 13;
  for (let k = 0; k < N; k++) {
    const t0 = a0 + (Math.PI - 2 * a0) * k / N, t1 = a0 + (Math.PI - 2 * a0) * (k + 1) / N;
    const ax = Math.cos(t0) * Rm, ay = CY + Math.sin(t0) * Rm, bx = Math.cos(t1) * Rm, by = CY + Math.sin(t1) * Rm;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = (bx - ax) * 0.53, dy = (by - ay) * 0.53;
    out.push(P(slab(mx - dx, my - dy, 0, mx + dx, my + dy, 0, Ro - Ri, 4.4, 'z'), k === (N >> 1) ? shade(stoneC, 1.15) : k % 2 ? dk : stoneC));
  }
  const inner = x => CY + Math.sqrt(Math.max(0, Ri * Ri - x * x));
  const outer = x => CY + Math.sqrt(Math.max(0, Ro * Ro - x * x));
  for (const s of [-1, 1]) {
    for (let x0 = 1.5; x0 < 10.0; x0 += 1) {
      const x1 = Math.min(10.4, x0 + 1);
      const bottom = Math.max(outer(x1) - 0.08, inner(x0) + 0.05, 0);
      const h = 9.0 - bottom;
      if (h > 0.05) out.push(P(box(x1 - x0 + 0.02, h, 4.3, s * (x0 + x1) / 2, bottom + h / 2, 0), stoneC));
    }
    out.push(P(box(3.4, 9.0, 4.8, s * 11.9, 4.5, 0), dk));
    out.push(P(box(3.8, 0.5, 5.2, s * 11.9, 0.25, 0), shade(dk, 0.9)));
  }
  out.push(P(box(27.2, 0.8, 4.9, 0, 9.3, 0), dk));
  out.push(P(box(26.8, 0.08, 3.6, 0, 9.73, 0), 0x4a4d55));
  for (const zs of [-1, 1]) {
    out.push(P(box(27.0, 0.25, 0.32, 0, 10.75, zs * 2.25), shade(stoneC, 1.12)));
    for (let k = 0; k < 14; k++) out.push(P(box(0.26, 0.95, 0.26, -13 + k * 2, 10.15, zs * 2.25), stoneC));
    for (const s of [-1, 1]) {
      out.push(P(cyl(0.1, 0.12, 1.8, 6, 'y', s * 13.3, 10.6, zs * 2.25), DARK));
      out.push(P(box(0.45, 0.6, 0.45, s * 13.3, 11.7, zs * 2.25), 0xfff2a0));
    }
  }
  return out;
}

function stadiumLight(color) {
  const lamp = tintOr(color, 0xfffbe0), steel = 0x9aa3ad, H = 18;
  const out = [P(box(3.2, 0.5, 3.2, 0, 0.25, 0), 0x9a9ea6)];
  const foot = 1.25, head = 0.45;
  const leg = (sx, sz, t) => [sx * (foot + (head - foot) * t), H * t, sz * (foot + (head - foot) * t)];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) out.push(P(rod(sx * foot, 0.4, sz * foot, sx * head, H, sz * head, 0.11, 5), steel));
  const sides = [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]];
  for (const [[ax, az], [bx, bz]] of sides) {
    for (let k = 0; k < 6; k++) {
      const t0 = 0.02 + k / 6.2, t1 = 0.02 + (k + 1) / 6.2;
      const A = leg(ax, az, k % 2 ? t1 : t0), B = leg(bx, bz, k % 2 ? t0 : t1);
      out.push(P(rod(A[0], A[1], A[2], B[0], B[1], B[2], 0.05, 4), steel));
    }
  }
  const hd = [
    P(box(5.4, 3.4, 0.45, 0, 0, 0), DARK),
    P(box(5.8, 0.2, 1.4, 0, -1.9, 0.4), steel),
  ];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    hd.push(P(box(1.05, 0.82, 0.16, -1.85 + c * 1.23, -1.05 + r * 1.05, 0.28), lamp));
  }
  out.push(...moved(hd, 0, H + 1.6, 0.4, -0.22, 0, 0));
  return out;
}

// a big top: stripes all round, a flag on the pole
function tent(color) {
  const a = tintOr(color, RED), b = WHITE, R = 5.6, N = 12;
  const out = [];
  for (let k = 0; k < N; k++) {
    const t0 = k * TAU / N;
    const wall = flat(new THREE.CylinderGeometry(R, R, 3.2, 2, 1, true, t0, TAU / N));
    out.push(P(put(wall, 0, 1.6, 0), k % 2 ? a : b));
    const top = flat(new THREE.CylinderGeometry(0.3, R + 0.5, 3.6, 2, 1, true, t0, TAU / N));
    out.push(P(put(top, 0, 3.2 + 1.8, 0), k % 2 ? b : a));
  }
  out.push(P(cyl(R + 0.5, R + 0.5, 0.06, 24, 'y', 0, 3.2, 0), shade(a, 0.8)));
  out.push(P(cyl(R - 0.05, R - 0.05, 0.1, 24, 'y', 0, 3.17, 0), shade(a, 0.6)));
  out.push(P(rod(0, 6.6, 0, 0, 8.6, 0, 0.08, 5), DARK));
  out.push(P(slab(0.05, 8.25, 0, 1.5, 8.25, 0, 0.7, 0.06, 'z'), YEL));
  out.push(P(put(gable(2.4, 0.01, 2.8, 0.3), 0, 0, R + 0.02), 0x2a2018));
  for (let k = 0; k < N; k++) {
    const t = k * TAU / N + TAU / N / 2;
    out.push(P(orb(0.22, Math.sin(t) * (R + 0.5), 3.1, Math.cos(t) * (R + 0.5)), YEL));
  }
  return out;
}

/* ====================================================================== track */

function boostpad(color) {
  const bed = tintOr(color, 0xff7a1a), out = [
    P(box(2.8, 0.1, 3.4, 0, 0.05, 0), 0x1d2340),
    P(box(2.4, 0.05, 3.0, 0, 0.12, 0), bed),
    P(box(0.2, 0.16, 3.4, 1.4, 0.08, 0), YEL),
    P(box(0.2, 0.16, 3.4, -1.4, 0.08, 0), YEL),
  ];
  const cols = [0xfff6c2, 0xffe14d, 0xffb02e];
  [-1.0, -0.05, 0.9].forEach((z, i) => out.push(...chevron(z + 0.6, 0.95, 0.8, 0.36, 0.17, cols[i])));
  return out;
}

function jumppad(color) {
  const plate = tintOr(color, CYAN), out = [
    P(box(2.9, 0.22, 3.3, 0, 0.11, 0), 0x2a2f3a),
    P(rod(-1.3, 0.3, -1.45, 1.3, 0.3, -1.45, 0.1, 6), STEEL),
  ];
  for (const x of [-0.85, 0.85]) {
    for (let k = 0; k < 5; k++) out.push(P(ring(0.24, 0.045, 4, 10, x, 0.3 + k * 0.1, 1.05), CHROME));
  }
  const top = [P(box(2.6, 0.14, 3.1, 0, 0, 0), plate), P(box(2.6, 0.16, 0.25, 0, 0.01, 1.43), YEL)];
  [-0.9, 0.0, 0.9].forEach(z => top.push(...chevron(z + 0.35, 0.8, 0.6, 0.3, 0.1, YEL)));
  out.push(...moved(top, 0, 0.58, 0.05, Math.atan2(0.62, 3.1), 0, 0));
  return out;
}

function itembox(color) {
  const out = [];
  const g = flat(new THREE.BoxGeometry(1, 1, 1));
  const p = g.attributes.position, cols = new Float32Array(p.count * 3), c = new THREE.Color();
  let baseH = 0, spread = 1;
  if (color !== undefined && color !== null) {
    const hsl = {};
    new THREE.Color().setHex(color).getHSL(hsl, THREE.SRGBColorSpace);
    baseH = hsl.h; spread = 0.22;
  }
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) * 0.35 + p.getY(i) * 0.5 - p.getZ(i) * 0.25;
    const h = ((baseH + t * spread) % 1 + 1) % 1;
    c.setHSL(h, 0.9, 0.6, THREE.SRGBColorSpace);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  put(g, 0, 1.2, 0);
  out.push({ g, c: 0xffffff, cols });
  const E = 0.56, edge = 0xf4f8ff;
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    out.push(P(box(0.1, 1.2, 0.1, a * E, 1.2, b * E), edge));
    out.push(P(box(1.2, 0.1, 0.1, 0, 1.2 + a * E, b * E), edge));
    out.push(P(box(0.1, 0.1, 1.2, a * E, 1.2 + b * E, 0), edge));
  }
  // a question mark on each side
  const Q = [[0, 0.27, 0.36, 0.1], [-0.16, 0.2, 0.1, 0.14], [0.16, 0.17, 0.1, 0.22], [0.06, 0.05, 0.2, 0.1],
             [0, -0.05, 0.1, 0.16], [0, -0.26, 0.11, 0.11]];
  for (let k = 0; k < 4; k++) {
    for (const [u, v, w, h] of Q) out.push(P(put(box(w, h, 0.06, u, v, 0.52), 0, 1.2, 0, 0, k * Math.PI / 2, 0), WHITE));
  }
  return out;
}

function coin(color) {
  const gold = tintOr(color, GOLD);
  return [
    P(cyl(0.4, 0.4, 0.1, 18, 'z', 0, 1, 0), gold),
    P(cyl(0.42, 0.42, 0.06, 18, 'z', 0, 1, 0), shade(gold, 0.8)),
    P(put(torus(0.355, 0.04, 4, 18), 0, 1, 0.05), shade(gold, 0.85)),
    P(put(torus(0.355, 0.04, 4, 18), 0, 1, -0.05), shade(gold, 0.85)),
    P(box(0.11, 0.38, 0.16, 0, 1, 0), shade(gold, 1.45)),
  ];
}

function trafficCone(color) {
  const o = tintOr(color, 0xff6a1a);
  const r = y => 0.27 - (y - 0.06) / 0.78 * 0.2;
  const out = [
    P(box(0.62, 0.06, 0.62, 0, 0.03, 0), o),
    P(cyl(0.07, 0.27, 0.78, 10, 'y', 0, 0.45, 0), o),
  ];
  for (const y of [0.4, 0.6]) out.push(P(cyl(r(y + 0.06) + 0.012, r(y - 0.06) + 0.012, 0.12, 10, 'y', 0, y, 0), WHITE));
  return out;
}

function tyres(color) {
  const paint = tintOr(color, RED), out = [];
  for (let s = 0; s < 3; s++) {
    const x = (s - 1) * 0.94;
    out.push(P(cyl(0.22, 0.22, 1.12, 8, 'y', x, 0.56, 0), 0x111318));
    for (let k = 0; k < 4; k++) {
      const c = (s + k) % 2 ? RUBBER : (k % 2 ? WHITE : paint);
      out.push(P(ring(0.32, 0.14, 6, 12, x, 0.14 + k * 0.28, 0), c));
    }
  }
  return out;
}

function barrier(color) {
  const conc = 0xc8c5bc, paint = tintOr(color, RED);
  const s = new THREE.Shape();
  s.moveTo(-0.32, 0); s.lineTo(0.32, 0); s.lineTo(0.32, 0.08); s.lineTo(0.24, 0.3);
  s.lineTo(0.1, 0.82); s.lineTo(-0.1, 0.82); s.lineTo(-0.24, 0.3); s.lineTo(-0.32, 0.08); s.lineTo(-0.32, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 4, bevelEnabled: false });
  g.translate(0, 0, -2);
  g.rotateY(Math.PI / 2);
  const out = [P(flat(g), conc)];
  for (const zs of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      out.push(P(put(box(0.96, 0.24, 0.05, 0, 0, 0), -1.5 + k, 0.56, zs * 0.19, zs * 0.26, 0, 0), k % 2 ? WHITE : paint));
    }
  }
  out.push(P(box(4.0, 0.04, 0.2, 0, 0.83, 0), shade(conc, 0.85)));
  return out;
}

function fence(color) {
  const post = tintOr(color, 0x6a7380), wire = 0xb4bcc6, L = 2, B = 0.12, T = 2.1;
  const out = [
    P(cyl(0.07, 0.07, 2.3, 6, 'y', -L, 1.15, 0), post),
    P(cyl(0.07, 0.07, 2.3, 6, 'y', L, 1.15, 0), post),
    P(rod(-L, T, 0, L, T, 0, 0.045, 5), post),
    P(rod(-L, B, 0, L, B, 0, 0.035, 5), post),
    P(box(0.3, 0.06, 0.3, -L, 0.03, 0), post),
    P(box(0.3, 0.06, 0.3, L, 0.03, 0), post),
  ];
  const step = 0.42;
  for (let c = -L - (T - B); c <= L; c += step) {
    // u - v = c, clipped to the panel
    let v0 = Math.max(B, -L - c), v1 = Math.min(T, L - c);
    if (v1 - v0 > 0.05) out.push(P(slab(v0 + c, v0, 0, v1 + c, v1, 0, 0.045, 0.03, 'z'), wire));
  }
  for (let c = -L + B; c <= L + T; c += step) {
    // u + v = c
    let v0 = Math.max(B, c - L), v1 = Math.min(T, c + L);
    if (v1 - v0 > 0.05) out.push(P(slab(c - v0, v0, 0, c - v1, v1, 0, 0.045, 0.03, 'z'), wire));
  }
  return out;
}

function neonrail(color) {
  const a = tintOr(color, 0x39f0ff), b = color === undefined || color === null ? 0xff3fd2 : shade(color, 1.35);
  const out = [
    P(rod(-2, 0.95, 0, 2, 0.95, 0, 0.13, 8), a),
    P(rod(-2, 0.55, 0, 2, 0.55, 0, 0.1, 8), b),
  ];
  for (const x of [-1.85, 0, 1.85]) {
    out.push(P(box(0.16, 1.0, 0.16, x, 0.5, -0.12), 0x1b1f2e));
    out.push(P(box(0.5, 0.06, 0.5, x, 0.03, -0.1), 0x1b1f2e));
    out.push(P(box(0.24, 0.1, 0.24, x, 1.06, -0.12), a));
  }
  return out;
}

function checkpoint(color) {
  const c = tintOr(color, CYAN), ink = INK, X = 6.3;
  const out = [P(box(13.6, 1.4, 1.0, 0, 6.9, 0), ink), P(box(12.6, 0.62, 1.08, 0, 6.9, 0), c)];
  for (const s of [-1, 1]) {
    out.push(P(box(1.0, 6.4, 1.0, s * X, 3.2, 0), ink));
    out.push(P(box(1.5, 0.5, 1.5, s * X, 0.25, 0), shade(ink, 1.3)));
    for (const y of [1.6, 3.2, 4.8]) out.push(P(box(1.06, 0.42, 1.06, s * X, y, 0), c));
    out.push(P(rod(s * X, 7.6, 0, s * X, 9.2, 0, 0.05, 4), DARK));
    out.push(P(slab(s * X + s * 0.04, 8.85, 0, s * X + s * 1.1, 8.85, 0, 0.6, 0.05, 'z'), YEL));
  }
  for (let k = 0; k < 11; k++) out.push(P(box(0.32, 0.18, 0.32, -5 + k, 6.12, 0), 0xfff6c2));
  return out;
}

function startgate(color) {
  const tower = tintOr(color, INK), gold = GOLD, X = 7.3;
  const out = [];
  for (const s of [-1, 1]) {
    out.push(P(box(1.1, 8.0, 1.1, s * X, 4.0, 0), tower));
    out.push(P(box(1.6, 0.5, 1.6, s * X, 0.25, 0), shade(tower, 1.3)));
    out.push(P(box(1.16, 0.3, 1.16, s * X, 2.4, 0), gold));
    out.push(P(box(1.16, 0.3, 1.16, s * X, 5.2, 0), gold));
    out.push(P(rod(s * X, 9.2, 0, s * X, 11.2, 0, 0.05, 4), DARK));
    for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) {
      out.push(P(slab(s * X + s * (0.04 + k * 0.4), 10.95 - j * 0.4, 0, s * X + s * (0.44 + k * 0.4), 10.95 - j * 0.4, 0, 0.4, 0.05, 'z'),
        (k + j) % 2 ? BLACK : WHITE));
    }
  }
  out.push(P(box(15.8, 1.9, 1.2, 0, 8.4, 0), tower));
  out.push(P(box(15.8, 0.18, 1.26, 0, 9.3, 0), gold));
  out.push(P(box(15.8, 0.18, 1.26, 0, 7.5, 0), gold));
  const N = 18, w = 14.4 / N;
  for (let k = 0; k < N; k++) for (let j = 0; j < 2; j++) {
    out.push(P(box(w, 0.8, 1.3, -7.2 + w * (k + 0.5), 8.0 + j * 0.8, 0), (k + j) % 2 ? BLACK : WHITE));
  }
  out.push(P(box(4.2, 1.0, 0.7, 0, 9.9, 0), BLACK));
  for (let k = 0; k < 5; k++) out.push(P(cyl(0.3, 0.3, 0.2, 10, 'z', -1.6 + k * 0.8, 9.9, 0.4), 0xff2a2a));
  return out;
}

function arrowSign(color) {
  const c = tintOr(color, YEL), board = INK;
  const out = [
    P(cyl(0.08, 0.08, 1.6, 6, 'y', -1.1, 0.8, -0.1), STEEL),
    P(cyl(0.08, 0.08, 1.6, 6, 'y', 1.1, 0.8, -0.1), STEEL),
    P(box(3.2, 1.3, 0.12, 0, 2.15, 0), board),
    P(box(3.36, 0.1, 0.16, 0, 2.85, 0), c),
    P(box(3.36, 0.1, 0.16, 0, 1.45, 0), c),
  ];
  for (const u of [-1.05, -0.15, 0.75]) {
    out.push(P(slab(u, 2.6, 0, u + 0.42, 2.12, 0, 0.27, 0.2, 'z'), c));
    out.push(P(slab(u + 0.42, 2.18, 0, u, 1.7, 0, 0.27, 0.2, 'z'), c));
  }
  return out;
}

function ramp(color) {
  const side = tintOr(color, 0xff9a1a), out = [P(put(wedge(3.6, 1.0, 4.0), 0, 0, 0), side)];
  const deck = [P(box(3.2, 0.05, 4.05, 0, 0, 0), 0x2a2f3a)];
  [-1.2, 0.0, 1.2].forEach(z => deck.push(...chevron(z + 0.45, 1.05, 0.75, 0.34, 0.04, YEL)));
  deck.push(P(box(3.6, 0.1, 0.22, 0, 0.03, 1.95), WHITE));
  out.push(...moved(deck, 0, 0.53, 0, Math.atan2(1.0, 4.0), 0, 0));
  out.push(P(box(3.62, 0.08, 0.05, 0, 0.98, 2.0), WHITE));
  return out;
}

function haybale(color) {
  const hay = tintOr(color, 0xe2c158), end = shade(hay, 0.82), out = [];
  for (const [x, y, z] of [[-0.8, 0.75, 0], [0.8, 0.75, 0], [0, 2.05, 0]]) {
    out.push(P(cyl(0.75, 0.75, 1.3, 12, 'x', x, y, z), hay));
    for (const s of [-1, 1]) {
      out.push(P(put(torus(0.42, 0.06, 4, 12), 0, 0, 0, 0, Math.PI / 2), end));
      out[out.length - 1].g.translate(x + s * 0.66, y, -z);
    }
  }
  return out;
}

/* ======================================================================== fun */

function duck(color) {
  const y = tintOr(color, YEL), beak = ORANGE;
  return [
    P(blob(1.75, 1.2, 0.8, 1.0, 0, 1.4, -0.1), y),
    P(put(cyl(0, 0.75, 1.4, 7, 'y', 0, 0.7, 0), 0, 1.75, -1.4, 0.75), y),
    P(blob(0.9, 0.4, 0.6, 1.2, 1.95, 1.6, -0.2), shade(y, 0.88)),
    P(blob(0.9, 0.4, 0.6, 1.2, -1.95, 1.6, -0.2), shade(y, 0.88)),
    P(blob(1.05, 1, 0.95, 1, 0, 3.35, 0.8), y),
    P(blob(0.6, 1.1, 0.38, 1.0, 0, 3.15, 1.75), beak),
    P(blob(0.24, 1, 1.15, 0.6, 0.42, 3.62, 1.62), WHITE),
    P(blob(0.24, 1, 1.15, 0.6, -0.42, 3.62, 1.62), WHITE),
    P(orb(0.13, 0.44, 3.62, 1.78), BLACK),
    P(orb(0.13, -0.44, 3.62, 1.78), BLACK),
  ];
}

function donut(color) {
  const icing = tintOr(color, 0xff7eb6), dough = 0xd99a55, R = 1.8, r = 0.9, CY = 3.0;
  const out = [
    P(box(2.4, 0.24, 1.4, 0, 0.12, 0), 0x6b4a2f),
    P(put(torus(R, r, 9, 24), 0, CY, 0), dough),
    P(put(torus(R, r * 0.86, 9, 24), 0, CY, 0.32), icing),
    P(put(torus(R, r * 0.86, 9, 24), 0, CY, -0.32), icing),
  ];
  const rr = rng(9);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 18; k++) {
      const ph = k * TAU / 18 + rr() * 0.25, ps = 0.5 + rr() * 0.9, rad = R + r * 0.86 * Math.cos(ps);
      const x = Math.cos(ph) * rad, y = CY + Math.sin(ph) * rad, z = s * (0.32 + r * 0.86 * Math.sin(ps) + 0.02);
      out.push(P(put(box(0.3, 0.08, 0.08, 0, 0, 0), x, y, z, 0, 0, rr() * Math.PI), RAINBOW[(k + (s > 0 ? 0 : 3)) % RAINBOW.length]));
    }
  }
  return out;
}

function icecream(color) {
  const scoop = tintOr(color, 0xff8fbf), cone = 0xd9a45a, band = 0xb27a3a;
  const out = [
    P(cyl(0.7, 0.9, 0.5, 10, 'y', 0, 0.25, 0), 0x5a6170),
    P(cyl(1.3, 0.14, 3.6, 10, 'y', 0, 0.4 + 1.8, 0), cone),
    P(ring(1.32, 0.12, 4, 14, 0, 3.95, 0), band),
  ];
  for (const y of [1.6, 2.6]) {
    const rr = 0.14 + (y - 0.4) / 3.6 * 1.16;
    out.push(P(ring(rr + 0.02, 0.06, 4, 12, 0, y, 0), band));
  }
  out.push(P(orb(1.35, 0, 4.7, 0), scoop));
  out.push(P(ring(1.2, 0.3, 5, 12, 0, 4.15, 0), scoop));
  for (let k = 0; k < 5; k++) {
    const a = k * TAU / 5 + 0.3;
    out.push(P(blob(0.24, 1, 1.6, 1, Math.cos(a) * 1.25, 3.85, Math.sin(a) * 1.25), scoop));
  }
  out.push(P(orb(1.1, 0, 5.95, 0), 0xa8f0c8));
  out.push(P(orb(0.85, 0, 6.95, 0), 0xfff1d6));
  out.push(P(orb(0.32, 0, 7.95, 0), RED));
  out.push(P(rod(0, 8.15, 0, 0.25, 8.65, 0, 0.04, 4), 0x3e8a35));
  return out;
}

function trophy(color) {
  const gold = tintOr(color, GOLD), hi = shade(gold, 1.3), dk = shade(gold, 0.75);
  return [
    P(box(2.8, 0.6, 2.8, 0, 0.3, 0), 0x2a2f3a),
    P(box(2.2, 0.7, 2.2, 0, 0.95, 0), 0x3a3f4a),
    P(box(1.2, 0.4, 0.08, 0, 0.95, 1.12), hi),
    P(cyl(0.9, 1.05, 0.3, 12, 'y', 0, 1.45, 0), gold),
    P(cyl(0.22, 0.45, 1.1, 10, 'y', 0, 2.15, 0), gold),
    P(orb(0.42, 0, 2.75, 0), hi),
    P(cyl(1.6, 0.5, 2.3, 14, 'y', 0, 4.15, 0), gold),
    P(ring(1.6, 0.13, 5, 18, 0, 5.3, 0), hi),
    P(cyl(1.5, 1.5, 0.05, 14, 'y', 0, 5.27, 0), dk),
    P(put(torus(0.6, 0.13, 5, 12, Math.PI * 1.24, -Math.PI * 0.62), 1.25, 4.4, 0), gold),
    P(put(torus(0.6, 0.13, 5, 12, Math.PI * 1.24, Math.PI * 0.38), -1.25, 4.4, 0), gold),
    P(put(starShape(0.55, 0.24, 0.15), 0, 4.1, 1.08, -0.446), hi),
  ];
}

function dino(color) {
  const g = tintOr(color, 0x5bbf4a), belly = mix(g, 0xfff1c0, 0.55), spike = ORANGE, dk = shade(g, 0.8);
  const out = [
    P(box(2.1, 2.1, 3.0, 0, 3.1, 0), g),
    P(box(1.6, 1.7, 0.12, 0, 3.0, 1.52), belly),
    P(taper(1.7, 1.0, 1.0, 1.6, 1.8, 0, 3.0, -2.3), g),
    P(taper(1.0, 0.55, 0.6, 1.0, 1.8, 0, 2.6, -4.0), dk),
    P(taper(0.55, 0.15, 0.2, 0.6, 1.6, 0, 2.2, -5.6), g),
    P(box(1.25, 1.7, 1.25, 0, 4.5, 1.2), g),
    P(box(1.55, 1.15, 2.3, 0, 5.55, 1.85), g),
    P(box(1.35, 0.42, 1.9, 0, 4.45, 1.75), g),
    P(box(1.15, 0.4, 1.6, 0, 4.78, 1.8), 0xb0303a),
    P(box(0.34, 0.34, 0.12, 0.5, 5.75, 2.98), WHITE),
    P(box(0.34, 0.34, 0.12, -0.5, 5.75, 2.98), WHITE),
  ];
  for (const s of [-1, 1]) {
    out.push(P(box(0.16, 0.34, 0.34, s * 0.79, 5.85, 2.2), WHITE));
    out.push(P(box(0.18, 0.2, 0.2, s * 0.82, 5.85, 2.28), BLACK));
    out.push(P(box(0.85, 1.7, 1.5, s * 0.85, 2.3, -0.4), dk));
    out.push(P(box(0.65, 1.5, 0.65, s * 0.85, 0.95, -0.2), g));
    out.push(P(box(0.85, 0.3, 1.25, s * 0.85, 0.15, 0.1), dk));
    out.push(P(box(0.3, 0.75, 0.3, s * 0.8, 3.0, 1.75), g));
    out.push(P(box(0.3, 0.3, 0.5, s * 0.8, 2.65, 1.95), g));
  }
  for (let k = 0; k < 5; k++) {
    const x = -0.55 + k * 0.275;
    out.push(P(cyl(0.08, 0, 0.22, 4, 'y', x, 4.88, 2.85), WHITE));
  }
  const S = [[1.2, 5.2, 0.35], [0.1, 4.15, 0.45], [-1.1, 4.15, 0.42], [-2.3, 3.5, 0.36], [-3.5, 3.1, 0.3], [-4.7, 2.6, 0.22]];
  for (const [z, y, h] of S) out.push(P(put(cyl(0, h * 0.9, h * 1.5, 4, 'y', 0, h * 0.75, 0), 0, y, z, 0, Math.PI / 4), spike));
  return out;
}

function statue(color) {
  const m = tintOr(color, 0x6fb8a0), dk = shade(m, 0.82), plinth = 0xc8c1b2;
  return [
    P(box(3.2, 0.6, 3.2, 0, 0.3, 0), shade(plinth, 0.9)),
    P(box(2.5, 2.1, 2.5, 0, 1.65, 0), plinth),
    P(box(2.9, 0.3, 2.9, 0, 2.85, 0), shade(plinth, 0.9)),
    P(box(1.2, 0.08, 0.06, 0, 1.75, 1.27), 0x7a7466),
    P(box(0.55, 1.7, 0.65, -0.36, 3.85, 0), dk),
    P(box(0.55, 1.7, 0.65, 0.36, 3.85, 0), dk),
    P(taper(1.35, 1.35, 1.3, 1.3, 0.85, 0, 4.85, 0), m),
    P(box(1.55, 1.3, 0.9, 0, 5.85, 0), m),
    P(box(0.35, 0.35, 0.35, 0, 6.65, 0), m),
    P(box(0.85, 0.9, 0.85, 0, 7.25, 0), m),
    P(box(0.95, 0.15, 0.95, 0, 7.75, 0), dk),
    P(box(0.38, 1.7, 0.38, 0.98, 7.1, 0), m),
    P(cyl(0.12, 0.16, 0.7, 6, 'y', 0.98, 8.25, 0), dk),
    P(cone(0.28, 0.6, 6, 0.98, 8.6, 0), GOLD),
    P(box(0.38, 1.3, 0.38, -0.98, 5.5, 0.1), m),
    P(box(0.8, 1.0, 0.18, -0.98, 5.0, 0.45), dk),
  ];
}

function balloon(color) {
  const a = tintOr(color, RED), b = color === undefined || color === null ? YEL : CREAM;
  const R = 3.6, SY = 1.1, CY = 14.4, N = 10, TH = 0.7 * Math.PI;
  const out = [
    P(box(1.4, 1.1, 1.4, 0, 8.0, 0), 0xa8733d),
    P(box(1.55, 0.16, 1.55, 0, 8.58, 0), 0x6b4a2f),
    P(cyl(0.2, 0.25, 0.3, 6, 'y', 0, 9.6, 0), DARK),
    P(cone(0.18, 0.5, 6, 0, 9.75, 0), ORANGE),
  ];
  const ringR = R * Math.sin(TH), ringY = CY + SY * R * Math.cos(TH), skirtY = 10.3, skirtR = 0.85;
  for (let k = 0; k < N; k++) {
    const ph = k * TAU / N;
    const g = sph(R, 2, 9, ph, TAU / N, 0, TH);
    g.scale(1, SY, 1);
    out.push(P(put(g, 0, CY, 0), k % 2 ? b : a));
    // the cylinder measures its angle a quarter turn round from the sphere's
    const c = flat(new THREE.CylinderGeometry(ringR, skirtR, ringY - skirtY, 2, 1, true, ph - Math.PI / 2, TAU / N));
    out.push(P(put(c, 0, (ringY + skirtY) / 2, 0), k % 2 ? b : a));
  }
  out.push(P(cyl(skirtR, skirtR, 0.12, 10, 'y', 0, skirtY, 0), DARK));
  for (const [x, z] of [[0.62, 0.62], [-0.62, 0.62], [0.62, -0.62], [-0.62, -0.62]]) {
    out.push(P(rod(x, 8.6, z, x * 1.2, skirtY, z * 1.2, 0.03, 4), 0x3a2a1a));
  }
  return out;
}

function pinata(color) {
  const stripes = color === undefined || color === null ? [PINK, YEL, CYAN, GREEN, ORANGE, PURPLE]
    : [color, shade(color, 1.35), shade(color, 0.8), shade(color, 1.6), shade(color, 1.15), shade(color, 0.9)];
  const wood = 0x8a5a3a, out = [
    P(cyl(0.16, 0.2, 7.2, 6, 'y', -3.3, 3.6, 0), wood),
    P(cyl(0.16, 0.2, 7.2, 6, 'y', 3.3, 3.6, 0), wood),
    P(rod(-3.5, 7.0, 0, 3.5, 7.0, 0, 0.14, 6), wood),
    P(rod(0, 7.0, 0, 0, 4.2, 0, 0.03, 4), 0xe8dcc0),
  ];
  for (let k = 0; k < 6; k++) out.push(P(box(1.4, 1.3, 0.48, 0, 3.6, -1.2 + k * 0.48), stripes[k]));
  for (const [x, z, k] of [[0.48, 0.95, 1], [-0.48, 0.95, 3], [0.48, -0.95, 4], [-0.48, -0.95, 0]]) {
    out.push(P(box(0.38, 1.1, 0.38, x, 2.4, z), stripes[k]));
  }
  out.push(P(put(box(0.7, 1.3, 0.7, 0, 0, 0), 0, 4.6, 1.15, -0.35), stripes[2]));
  out.push(P(box(0.85, 0.75, 1.3, 0, 5.3, 1.75), stripes[5]));
  out.push(P(box(0.6, 0.45, 0.3, 0, 5.15, 2.45), stripes[1]));
  for (const s of [-1, 1]) {
    out.push(P(put(box(0.22, 0.9, 0.12, 0, 0.45, 0), s * 0.3, 5.6, 1.5, 0, 0, -s * 0.25), stripes[0]));
    out.push(P(orb(0.09, s * 0.44, 5.5, 2.15), BLACK));
  }
  for (let k = 0; k < 4; k++) out.push(P(rod(0, 3.9, -1.45, (k - 1.5) * 0.12, 2.9, -1.75, 0.04, 4), stripes[k]));
  return out;
}

function present(w, h, d, body, ribbon, x, z, ry, y0) {
  const s = Math.min(w, d), out = [
    P(box(w, h, d, 0, h / 2, 0), body),
    P(box(w + 0.04, h + 0.04, s * 0.18, 0, h / 2, 0), ribbon),
    P(box(s * 0.18, h + 0.04, d + 0.04, 0, h / 2, 0), ribbon),
    P(orb(s * 0.1, 0, h + 0.05, 0), ribbon),
  ];
  for (const k of [-1, 1]) {
    const g = torus(s * 0.16, s * 0.05, 4, 10);
    g.scale(1.4, 0.8, 1);
    out.push(P(put(g, k * s * 0.18, h + s * 0.12, 0, 0, 0, -k * 0.5), ribbon));
  }
  return moved(out, x, y0 || 0, z, 0, ry, 0);
}
function gift(color) {
  const main = tintOr(color, RED);
  return [
    ...present(2.4, 2.0, 2.4, main, YEL, 0, 0, 0.1),
    ...present(1.3, 1.0, 1.3, GREEN, WHITE, 0.2, -0.1, -0.35, 2.0),
    ...present(1.6, 1.4, 1.6, BLUE, PINK, 2.1, 0.8, 0.4),
    ...present(1.0, 0.9, 1.0, PURPLE, YEL, -1.8, 1.3, -0.3),
  ];
}

function snowglobe(color) {
  const base = tintOr(color, 0x9c2a3a), R = 2.4, CY = 3.4;
  const glassG = sph(R, 20, 14);
  insideOut(glassG);
  put(glassG, 0, CY, 0);
  const out = [
    P(cyl(2.0, 2.35, 1.3, 14, 'y', 0, 0.65, 0), base),
    P(cyl(2.05, 2.05, 0.2, 14, 'y', 0, 1.05, 0), GOLD),
    P(glassG, 0xcfeeff),
    P(ring(1.98, 0.08, 4, 20, 0, 1.38, 0), GOLD),
    P(cyl(1.92, 1.92, 0.3, 14, 'y', 0, 1.45, 0), WHITE),
    P(cyl(0.1, 0.12, 0.5, 5, 'y', -0.5, 1.85, -0.3), BARK),
    P(cone(0.75, 1.2, 7, -0.5, 1.95, -0.3), 0x2f7d3a),
    P(cone(0.55, 1.0, 7, -0.5, 2.7, -0.3), 0x3f8f45),
    P(orb(0.42, 0.7, 2.0, 0.3), WHITE),
    P(orb(0.3, 0.7, 2.6, 0.3), WHITE),
    P(put(cyl(0, 0.06, 0.3, 4, 'y', 0, 0.15, 0), 0.7, 2.6, 0.58, -Math.PI / 2), ORANGE),
    P(put(torus(Math.sqrt(R * R - 1.3 * 1.3), 0.05, 4, 8, 1.1, 1.75), 0, CY, 1.3), WHITE),
  ];
  const r = rng(12);
  for (let k = 0; k < 14; k++) {
    const a = r() * TAU, d = 0.3 + r() * 1.6, y = 2.0 + r() * 2.6;
    if (Math.hypot(d, y - CY) > R - 0.25) continue;
    out.push(P(put(box(0.12, 0.12, 0.12, 0, 0, 0), Math.cos(a) * d, y, Math.sin(a) * d, r(), r(), 0), WHITE));
  }
  return out;
}

// a sky thing: seven bands from the ground up, 46 m high
function rainbow() {
  const out = [];
  RAINBOW.forEach((c, i) => {
    const g = torus(46 - i * 2.0, 1.08, 4, 40, Math.PI, 0);
    g.scale(1, 1, 0.5);
    out.push(P(put(g, 0, -2, 0), c));
  });
  return out;
}

/* ====================================================================== space */

function planet(color) {
  const c = tintOr(color, 0xe8955a), R = 30;
  const edges = [0, 0.17, 0.31, 0.43, 0.55, 0.67, 0.8, 1];
  const tones = [shade(c, 1.25), c, shade(c, 1.45), shade(c, 0.85), shade(c, 1.2), c, shade(c, 0.8)];
  const out = [];
  for (let k = 0; k < 7; k++) {
    const t0 = edges[k] * Math.PI, tl = (edges[k + 1] - edges[k]) * Math.PI;
    out.push(P(sph(R, 40, Math.max(2, Math.round(tl / Math.PI * 22)), 0, TAU, t0, tl), tones[k]));
  }
  for (const [rr, tube, col] of [[41, 4.5, 0xf3e2b8], [51.5, 3.8, 0xc9a77a]]) {
    const g = torus(rr, tube, 4, 72);
    g.scale(1, 1, 0.07);
    g.rotateX(Math.PI / 2);
    out.push(P(g, col));
  }
  return moved(out, 0, 70, 0, 0.5, 0, 0.42);
}

function moon(color) {
  const c = tintOr(color, 0xc9ccd3), R = 20, CY = 55;
  const out = [P(put(sph(R, 30, 20), 0, CY, 0), c)];
  const N = 22, r = rng(4);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i + 0.5) / N * 2, rad = Math.sqrt(1 - y * y), th = i * 2.39996;
    if (y < -0.7) continue;
    const nx = Math.cos(th) * rad, nz = Math.sin(th) * rad;
    const rc = 1.8 + r() * 2.6;
    out.push(P(stick(cyl(rc, rc, 0.6, 12, 'y', 0, 0, 0), nx, y, nz, nx * (R - 0.3), CY + y * (R - 0.3), nz * (R - 0.3)), shade(c, 0.72)));
    const rim = flat(new THREE.TorusGeometry(rc, 0.45, 4, 14));
    rim.rotateX(Math.PI / 2);
    out.push(P(stick(rim, nx, y, nz, nx * (R - 0.05), CY + y * (R - 0.05), nz * (R - 0.05)), shade(c, 1.12)));
  }
  return out;
}

function star(color) {
  const c = tintOr(color, 0xffe14d);
  return moved([
    P(starShape(9, 4.1, 3.4), c),
    P(box(0.75, 2.1, 2.7, 1.45, 0.9, 1.35), BLACK),
    P(box(0.75, 2.1, 2.7, -1.45, 0.9, 1.35), BLACK),
  ], 0, 40, 0);
}

function ufo(color) {
  const light = tintOr(color, 0x7dff6b), hull = CHROME, Y = 8;
  const out = [
    P(cyl(4.6, 2.0, 1.0, 22, 'y', 0, Y - 0.5, 0), hull),
    P(cyl(2.6, 4.6, 0.7, 22, 'y', 0, Y + 0.35, 0), shade(hull, 0.9)),
    P(ring(4.6, 0.2, 5, 30, 0, Y, 0), DARK),
    P(put(sph(2.0, 16, 8, 0, TAU, 0, Math.PI / 2), 0, Y + 0.65, 0), GLASS),
    P(cyl(1.3, 1.6, 0.35, 16, 'y', 0, Y - 1.1, 0), light),
    P(cyl(0.7, 1.1, 0.12, 14, 'y', 0, Y - 1.3, 0), shade(light, 1.4)),
  ];
  for (let k = 0; k < 12; k++) {
    const a = k * TAU / 12;
    out.push(P(orb(0.3, Math.cos(a) * 4.72, Y, Math.sin(a) * 4.72), k % 2 ? light : 0xffe14d));
  }
  return out;
}

function satellite(color) {
  const panel = tintOr(color, 0x2747a8), foil = 0xd9a93a, Y = 9;
  const out = [
    P(box(1.6, 1.6, 2.2, 0, Y, 0), foil),
    P(box(1.66, 0.2, 2.26, 0, Y + 0.5, 0), shade(foil, 0.75)),
    P(box(1.66, 0.2, 2.26, 0, Y - 0.5, 0), shade(foil, 0.75)),
    P(rod(0, Y, 1.1, 0, Y, 1.6, 0.12, 6), STEEL),
    P(cyl(0.25, 1.3, 0.55, 14, 'z', 0, Y, 1.9), WHITE),
    P(rod(0, Y, 1.7, 0, Y, 2.9, 0.04, 4), STEEL),
    P(orb(0.12, 0, Y, 2.95), RED),
    P(rod(0.4, Y + 0.8, 0, 0.4, Y + 2.0, 0, 0.03, 4), STEEL),
    P(orb(0.1, 0.4, Y + 2.05, 0), WHITE),
    P(cyl(0.3, 0.4, 0.4, 8, 'z', 0, Y, -1.3), DARK),
  ];
  for (const s of [-1, 1]) {
    out.push(P(rod(s * 0.8, Y, 0, s * 1.6, Y, 0, 0.07, 5), STEEL));
    out.push(P(box(4.0, 0.08, 1.8, s * 3.6, Y, 0), panel));
    out.push(P(box(4.04, 0.1, 0.06, s * 3.6, Y, 0), shade(panel, 1.5)));
    for (const u of [-1, 0, 1]) out.push(P(box(0.06, 0.1, 1.84, s * 3.6 + u * 1.0, Y, 0), shade(panel, 1.5)));
  }
  return out;
}

function rocketShip(color) {
  const acc = tintOr(color, RED), body = WHITE, tower = 0xd9532f;
  const out = [
    P(cyl(5.2, 5.6, 0.8, 8, 'y', 0, 0.4, 0), 0x9a9ea6),
    P(ring(3.6, 0.18, 4, 24, 0, 0.82, 0), YEL),
    P(cyl(0.75, 1.05, 1.0, 12, 'y', 0, 1.3, 0), DARK),
    P(cyl(1.35, 1.35, 8.5, 16, 'y', 0, 1.8 + 4.25, 0), body),
    P(cyl(1.38, 1.38, 0.5, 16, 'y', 0, 3.6, 0), acc),
    P(cyl(1.38, 1.38, 0.35, 16, 'y', 0, 9.6, 0), acc),
    P(cone(1.35, 3.8, 16, 0, 10.3, 0), acc),
    P(cyl(0.48, 0.48, 0.2, 14, 'z', 0, 8.0, 1.3), GLASS),
    P(put(torus(0.48, 0.07, 4, 14), 0, 8.0, 1.42), CHROME),
  ];
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + Math.PI / 4;
    // a taper is tall at its front: that end goes against the body, the short end points out
    const fin = [P(taper(0.2, 0.2, 1.4, 3.0, 1.9, 0, 0, 0), acc)];
    out.push(...moved(fin, Math.cos(a) * 2.3, 2.3, Math.sin(a) * 2.3, 0, a + Math.PI / 2, 0));
  }
  // the gantry beside it
  const TX = -4.4;
  out.push(P(box(1.0, 14.5, 1.0, TX, 0.8 + 7.25, 0), tower));
  for (let k = 0; k < 7; k++) {
    const y0 = 1.0 + k * 2, y1 = y0 + 2;
    out.push(P(slab(TX + 0.55, y0, k % 2 ? -0.5 : 0.5, TX + 0.55, y1, k % 2 ? 0.5 : -0.5, 0.12, 0.12, 'x'), tower));
  }
  out.push(P(box(3.0, 0.35, 0.6, TX + 1.9, 11.5, 0), tower));
  out.push(P(box(3.0, 0.35, 0.6, TX + 1.9, 7.0, 0), tower));
  out.push(P(orb(0.25, TX, 15.3, 0), RED));
  return out;
}

function asteroid(color) {
  const c = tintOr(color, 0x8a7f74), Y = 6;
  const out = [P(put(jag(new THREE.IcosahedronGeometry(2.8, 1), 0.2, 17), 0, Y, 0), c)];
  const r = rng(3);
  for (let k = 0; k < 7; k++) {
    const th = r() * TAU, y = r() * 1.6 - 0.6, rad = Math.sqrt(1 - y * y);
    const nx = Math.cos(th) * rad, nz = Math.sin(th) * rad;
    out.push(P(put(jag(new THREE.DodecahedronGeometry(0.5 + r() * 0.4, 0), 0.25, 30 + k),
      nx * 2.65, Y + y * 2.65, nz * 2.65), shade(c, k % 2 ? 0.7 : 0.82)));
  }
  for (const [x, y, z, s] of [[4.3, 1.4, 1.0, 0.6], [-3.9, -0.6, -1.6, 0.45], [1.2, 2.6, -3.6, 0.35]]) {
    out.push(P(put(jag(new THREE.DodecahedronGeometry(s, 0), 0.3, 60 + x * 3), x, Y + y, z), shade(c, 1.1)));
  }
  return out;
}

function galaxyRing(color) {
  const out = [], CY = 11.6, R = 8;
  const cols = color === undefined || color === null ? RAINBOW.concat([0xff6fd8, 0x7dfcff, 0xffffff, 0xff4d5e, 0xffe14d])
    : [0, 1, 2, 3, 4, 5].map(i => shade(color, [1, 1.3, 0.85, 1.5, 1.15, 0.95][i]));
  for (let k = 0; k < 12; k++) {
    out.push(P(put(torus(R, 0.6, 8, 6, TAU / 12 + 0.01, k * TAU / 12), 0, CY, 0), cols[k % cols.length]));
  }
  out.push(P(put(torus(R - 1.05, 0.18, 5, 40), 0, CY, 0), 0xf4f0ff));
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + 0.2;
    out.push(P(put(starShape(0.9, 0.35, 0.35, 4), Math.cos(a) * (R + 1.6), CY + Math.sin(a) * (R + 1.6), 0, 0, 0, a), k % 2 ? 0xffe14d : WHITE));
  }
  return out;
}

/* ===================================================================== lights */

function lamp(color) {
  const glow = tintOr(color, 0xfff2b0), pole = 0x2e3440;
  return [
    P(cyl(0.26, 0.34, 0.5, 8, 'y', 0, 0.25, 0), pole),
    P(cyl(0.1, 0.14, 5.5, 8, 'y', 0, 0.5 + 2.75, 0), pole),
    P(rod(0, 5.7, 0, 0, 6.0, 1.3, 0.07, 6), pole),
    P(box(0.75, 0.16, 1.0, 0, 6.05, 1.55), pole),
    P(box(0.6, 0.38, 0.85, 0, 5.78, 1.55), glow),
    P(box(0.68, 0.06, 0.92, 0, 5.56, 1.55), pole),
    P(orb(0.12, 0, 6.05, 0), pole),
  ];
}

function torch(color) {
  const flame = tintOr(color, 0xff5a1a), core = mix(flame, 0xffe14d, 0.75), mid = mix(flame, 0xffe14d, 0.35), pole = 0xc8a060;
  const out = [P(cyl(0.09, 0.12, 2.3, 6, 'y', 0, 1.15, 0), pole)];
  for (const y of [0.6, 1.2, 1.8]) out.push(P(cyl(0.12, 0.12, 0.08, 6, 'y', 0, y, 0), shade(pole, 0.7)));
  out.push(P(cyl(0.3, 0.15, 0.5, 8, 'y', 0, 2.5, 0), 0x5a3a24));
  out.push(P(cyl(0.31, 0.31, 0.1, 8, 'y', 0, 2.55, 0), 0xc8a060));
  out.push(P(blob(0.32, 1, 0.9, 1, 0, 2.95, 0), flame));
  out.push(P(cone(0.25, 0.95, 7, 0, 3.0, 0), flame));
  out.push(P(put(cone(0.13, 0.55, 6, 0, 0, 0), 0.2, 2.85, 0, 0, 0, -0.45), mid));
  out.push(P(put(cone(0.12, 0.5, 6, 0, 0, 0), -0.2, 2.85, -0.05, 0, 0, 0.5), mid));
  out.push(P(put(cone(0.11, 0.45, 6, 0, 0, 0), 0, 2.85, 0.2, -0.45, 0, 0), mid));
  out.push(P(blob(0.2, 1, 1.1, 1, 0, 2.95, 0.15), core));
  out.push(P(cone(0.15, 0.6, 6, 0, 3.0, 0.12), core));
  return out;
}

function lanternString(color) {
  const wood = 0x7a5a3a, X = 5, TOP = 5.0, SAG = 0.9, out = [];
  for (const s of [-1, 1]) {
    out.push(P(cyl(0.12, 0.15, TOP + 0.3, 6, 'y', s * X, (TOP + 0.3) / 2, 0), wood));
    out.push(P(orb(0.18, s * X, TOP + 0.35, 0), GOLD));
  }
  const yAt = x => TOP - SAG * (1 - (x / X) * (x / X));
  for (let k = 0; k < 10; k++) {
    const x0 = -X + k * 1.0, x1 = x0 + 1.0;
    out.push(P(rod(x0, yAt(x0), 0, x1, yAt(x1), 0, 0.025, 4), 0x2a2a2a));
  }
  for (let k = 0; k < 7; k++) {
    const x = -3.75 + k * 1.25, y = yAt(x) - 0.55;
    const c = color === undefined || color === null ? RAINBOW[k % RAINBOW.length] : (k % 2 ? color : shade(color, 1.35));
    out.push(P(rod(x, y + 0.5, 0, x, yAt(x), 0, 0.015, 3), 0x2a2a2a));
    out.push(P(blob(0.34, 1, 1.15, 1, x, y, 0), c));
    out.push(P(cyl(0.16, 0.16, 0.1, 6, 'y', x, y + 0.42, 0), DARK));
    out.push(P(cyl(0.14, 0.14, 0.08, 6, 'y', x, y - 0.42, 0), DARK));
  }
  return out;
}

function spotlight(color) {
  const lens = tintOr(color, 0xfffbe0), body = 0x3a3f4a;
  const out = [
    P(box(1.8, 0.4, 1.8, 0, 0.2, 0), DARK),
    P(cyl(0.65, 0.75, 0.3, 10, 'y', 0, 0.55, 0), body),
    P(box(1.9, 0.18, 0.4, 0, 0.75, 0), body),
    P(box(0.16, 1.3, 0.36, 0.95, 1.35, 0), body),
    P(box(0.16, 1.3, 0.36, -0.95, 1.35, 0), body),
  ];
  const head = [
    P(cyl(0.78, 0.78, 1.5, 14, 'z', 0, 0, 0), 0x5a6170),
    P(cyl(0.6, 0.78, 0.4, 14, 'z', 0, 0, -0.9), body),
    P(cyl(0.68, 0.68, 0.08, 14, 'z', 0, 0, 0.76), lens),
    P(put(torus(0.74, 0.07, 4, 16), 0, 0, 0.78), DARK),
  ];
  out.push(...moved(head, 0, 1.85, 0, 0.62, 0, 0));
  return out;
}

function neonArch(color) {
  const a = tintOr(color, 0xff3fd2), b = color === undefined || color === null ? 0x39f0ff : shade(color, 1.45);
  const out = [
    P(torus(6.3, 0.28, 6, 22, Math.PI, 0), a),
    P(torus(5.5, 0.22, 6, 20, Math.PI, 0), b),
  ];
  for (const s of [-1, 1]) {
    out.push(P(box(1.6, 0.5, 1.0, s * 5.9, 0.25, 0), 0x1b1f2e));
  }
  for (let k = 0; k <= 12; k++) {
    const t = k / 12 * Math.PI;
    out.push(P(box(0.26, 0.26, 0.26, Math.cos(t) * 6.95, 0.15 + Math.sin(t) * 6.95, 0), YEL));
  }
  out[0].g.translate(0, 0.15, 0);
  out[1].g.translate(0, 0.15, 0);
  return out;
}

function glowOrb(color) {
  const c = tintOr(color, 0x7df9ff), Y = 2.6;
  const out = [
    P(put(sph(0.95, 16, 12), 0, Y, 0), c),
    P(put(torus(1.45, 0.06, 4, 28), 0, Y, 0, 1.2, 0, 0.3), shade(c, 1.4)),
    P(put(torus(1.3, 0.05, 4, 26), 0, Y, 0, 0.4, 0, -0.9), shade(c, 1.25)),
    P(cyl(1.1, 1.1, 0.03, 18, 'y', 0, 0.015, 0), shade(c, 1.3)),
  ];
  for (let k = 0; k < 3; k++) {
    const a = k * TAU / 3;
    out.push(P(orb(0.12, Math.cos(a) * 1.7, Y + Math.sin(a * 2) * 0.5, Math.sin(a) * 1.7), WHITE));
  }
  return out;
}

/* ====================================================================== signs */

function billboard(color) {
  const face = tintOr(color, YEL), steel = 0x8a929c;
  const out = [
    P(box(0.4, 4.2, 0.4, -3.0, 2.1, -0.3), steel),
    P(box(0.4, 4.2, 0.4, 3.0, 2.1, -0.3), steel),
    P(box(10.4, 5.0, 0.35, 0, 6.6, 0), INK),
    P(box(9.8, 4.4, 0.1, 0, 6.6, 0.2), face),
    P(box(9.8, 4.4, 0.1, 0, 6.6, -0.2), 0x5a606c),
    P(box(9.4, 0.12, 0.9, 0, 4.05, 0.6), steel),
    P(rod(-4.7, 4.65, 1.0, 4.7, 4.65, 1.0, 0.04, 4), steel),
  ];
  for (const x of [-3.5, 0, 3.5]) {
    out.push(P(rod(x, 9.1, 0, x, 9.5, 1.0, 0.05, 4), steel));
    out.push(P(box(0.5, 0.25, 0.35, x, 9.45, 1.1), 0xfff2b0));
  }
  return out;
}

function banner(color) {
  const cloth = tintOr(color, RED), out = [];
  for (const s of [-1, 1]) {
    out.push(P(cyl(0.14, 0.18, 7.4, 8, 'y', s * 6.4, 3.7, 0), STEEL));
    out.push(P(orb(0.24, s * 6.4, 7.5, 0), GOLD));
    out.push(P(box(0.6, 0.3, 0.6, s * 6.4, 0.15, 0), DARK));
  }
  out.push(P(box(12.6, 1.9, 0.08, 0, 5.7, 0), cloth));
  out.push(P(box(12.6, 0.2, 0.12, 0, 6.7, 0), WHITE));
  out.push(P(box(12.6, 0.2, 0.12, 0, 4.7, 0), WHITE));
  out.push(P(rod(-6.4, 6.9, 0, 6.4, 6.9, 0, 0.03, 4), 0x2a2a2a));
  for (let k = 0; k < 12; k++) {
    const x = -5.5 + k * 1.0;
    out.push(P(put(gable(0.6, 0.01, 0.6, 0.05), x, 4.6, 0, 0, 0, Math.PI), RAINBOW[k % RAINBOW.length]));
  }
  return out;
}

function flagWave(n, x0, len, y, ht, rows, colAt) {
  const out = [], pts = [];
  for (let k = 0; k <= n; k++) pts.push([x0 + k * len / n, Math.sin(k * 1.4) * 0.22]);
  const rh = ht / rows;
  for (let k = 0; k < n; k++) for (let j = 0; j < rows; j++) {
    const yy = y + ht / 2 - rh * (j + 0.5);
    out.push(P(slab(pts[k][0], yy, pts[k][1], pts[k + 1][0], yy, pts[k + 1][1], rh, 0.05, 'z'), colAt(k, j)));
  }
  return out;
}
function flag(color) {
  const c = tintOr(color, RED);
  return [
    P(cyl(0.45, 0.55, 0.3, 8, 'y', 0, 0.15, 0), DARK),
    P(cyl(0.07, 0.1, 8.0, 8, 'y', 0, 4.0, 0), STEEL),
    P(orb(0.18, 0, 8.1, 0), GOLD),
    ...flagWave(4, 0.08, 2.6, 7.0, 1.6, 1, (k) => (k % 2 ? shade(c, 0.9) : c)),
  ];
}
function checkerFlag(color) {
  const dk = tintOr(color, BLACK);
  return [
    P(cyl(0.45, 0.55, 0.3, 8, 'y', 0, 0.15, 0), DARK),
    P(cyl(0.07, 0.1, 8.0, 8, 'y', 0, 4.0, 0), STEEL),
    P(orb(0.18, 0, 8.1, 0), GOLD),
    ...flagWave(5, 0.08, 2.8, 7.0, 1.8, 3, (k, j) => ((k + j) % 2 ? WHITE : dk)),
  ];
}

function signPost(color) {
  const wood = 0x8a6a42, out = [
    P(cyl(0.12, 0.15, 3.3, 6, 'y', 0, 1.65, 0), wood),
    P(cone(0.2, 0.3, 6, 0, 3.3, 0), shade(wood, 0.8)),
  ];
  const cols = color === undefined || color === null ? [YEL, CYAN, PINK] : [color, shade(color, 1.3), shade(color, 0.8)];
  [[2.85, 0.4], [2.3, 2.6], [1.75, -0.9]].forEach(([y, yaw], i) => {
    const b = [
      P(box(1.5, 0.38, 0.09, 0.85, 0, 0), cols[i]),
      P(put(cyl(0.27, 0.27, 0.09, 3, 'z', 0, 0, 0), 1.6 + 0.06, 0, 0, 0, 0, Math.PI / 2), cols[i]),
      P(box(0.9, 0.05, 0.11, 0.85, 0.06, 0), INK),
      P(box(0.6, 0.05, 0.11, 0.7, -0.07, 0), INK),
    ];
    out.push(...moved(b, 0, y, 0, 0, yaw, 0));
  });
  return out;
}

/* ===================================================================== the list */

export const CATEGORIES = [
  { id: 'nature', name: 'Nature' },
  { id: 'buildings', name: 'Buildings' },
  { id: 'track', name: 'Track' },
  { id: 'fun', name: 'Fun' },
  { id: 'space', name: 'Space' },
  { id: 'lights', name: 'Lights' },
  { id: 'signs', name: 'Signs' },
];

const O = (id, name, cat, size, solid, func, make) => ({ id, name, cat, size, solid, func, make });

export const OBJECTS = [
  O('pine', 'Pine tree', 'nature', 1.4, true, null, pine),
  O('oak', 'Oak tree', 'nature', 1.6, true, null, oak),
  O('palm', 'Palm tree', 'nature', 1.0, true, null, palm),
  O('cactus', 'Cactus', 'nature', 1.0, true, null, cactus),
  O('bush', 'Bush', 'nature', 1.5, false, null, bush),
  O('rock', 'Rock', 'nature', 1.6, true, null, rock),
  O('boulder', 'Boulder', 'nature', 3.0, true, null, boulder),
  O('flowers', 'Flower patch', 'nature', 2.0, false, null, flowers),
  O('mushroom', 'Giant mushroom', 'nature', 1.8, true, null, mushroom),
  O('crystal', 'Crystal cluster', 'nature', 1.8, true, null, crystal),
  O('snowman', 'Snowman', 'nature', 1.1, true, null, snowman),
  O('iceberg', 'Iceberg', 'nature', 3.6, true, null, iceberg),
  O('lavarock', 'Lava rock', 'nature', 1.9, true, null, lavarock),
  O('bamboo', 'Bamboo', 'nature', 1.2, true, null, bamboo),
  O('cloud', 'Cloud', 'nature', 10, false, 'sky', cloud),

  O('house', 'House', 'buildings', 3.6, true, null, house),
  O('tower', 'Castle tower', 'buildings', 2.8, true, null, tower),
  O('castle', 'Castle gate', 'buildings', 6.4, true, null, castle),
  O('lighthouse', 'Lighthouse', 'buildings', 2.8, true, null, lighthouse),
  O('windmill', 'Windmill', 'buildings', 2.7, true, null, windmill),
  O('skyscraper', 'Skyscraper', 'buildings', 4.8, true, null, skyscraper),
  O('barn', 'Barn', 'buildings', 4.8, true, null, barn),
  O('pyramid', 'Pyramid', 'buildings', 7.2, true, null, pyramid),
  O('grandstand', 'Grandstand', 'buildings', 7.2, true, null, grandstand),
  O('ferris', 'Ferris wheel', 'buildings', 4.8, true, null, ferris),
  O('bridge_arch', 'Arch bridge', 'buildings', 13.5, false, null, bridgeArch),
  O('stadium_light', 'Floodlight', 'buildings', 1.6, true, null, stadiumLight),
  O('tent', 'Circus tent', 'buildings', 6.0, true, null, tent),

  O('boostpad', 'Boost pad', 'track', 1.7, false, 'boost', boostpad),
  O('jumppad', 'Spring pad', 'track', 1.7, false, 'jump', jumppad),
  O('itembox', 'Item box', 'track', 0.8, false, 'item', itembox),
  O('coin', 'Coin', 'track', 0.45, false, 'coin', coin),
  O('cone', 'Traffic cone', 'track', 0.35, false, null, trafficCone),
  O('tyres', 'Tyre stack', 'track', 1.4, true, null, tyres),
  O('barrier', 'Concrete barrier', 'track', 2.0, true, null, barrier),
  O('fence', 'Fence', 'track', 2.0, true, null, fence),
  O('neonrail', 'Neon rail', 'track', 2.0, true, null, neonrail),
  O('checkpoint', 'Checkpoint', 'track', 6.8, false, 'checkpoint', checkpoint),
  O('startgate', 'Start gate', 'track', 7.9, false, 'start', startgate),
  O('arrow_sign', 'Turn sign', 'track', 1.6, true, null, arrowSign),
  O('ramp', 'Ramp', 'track', 2.1, false, 'jump', ramp),
  O('haybale', 'Hay bales', 'track', 1.6, true, null, haybale),

  O('duck', 'Rubber duck', 'fun', 2.2, true, null, duck),
  O('donut', 'Giant donut', 'fun', 2.7, true, null, donut),
  O('icecream', 'Ice cream', 'fun', 1.4, true, null, icecream),
  O('trophy', 'Trophy', 'fun', 1.9, true, null, trophy),
  O('dino', 'Dinosaur', 'fun', 2.8, true, null, dino),
  O('statue', 'Statue', 'fun', 1.8, true, null, statue),
  O('balloon', 'Hot air balloon', 'fun', 3.6, false, null, balloon),
  O('pinata', 'Pinata', 'fun', 3.4, true, null, pinata),
  O('gift', 'Presents', 'fun', 2.4, true, null, gift),
  O('snowglobe', 'Snow globe', 'fun', 2.4, true, null, snowglobe),
  O('rainbow', 'Rainbow', 'fun', 46, false, 'sky', rainbow),

  O('planet', 'Ringed planet', 'space', 55, false, 'sky', planet),
  O('moon', 'Moon', 'space', 20, false, 'sky', moon),
  O('star', 'Star', 'space', 9, false, 'sky', star),
  O('ufo', 'UFO', 'space', 4.6, false, null, ufo),
  O('satellite', 'Satellite', 'space', 5.6, false, null, satellite),
  O('rocket_ship', 'Rocket', 'space', 5.6, true, null, rocketShip),
  O('asteroid', 'Asteroid', 'space', 3.2, false, null, asteroid),
  O('galaxy_ring', 'Galaxy ring', 'space', 8.6, false, null, galaxyRing),

  O('lamp', 'Street lamp', 'lights', 0.4, true, null, lamp),
  O('torch', 'Tiki torch', 'lights', 0.35, true, null, torch),
  O('lantern_string', 'Lantern string', 'lights', 5.2, false, null, lanternString),
  O('spotlight', 'Searchlight', 'lights', 1.2, true, null, spotlight),
  O('neon_arch', 'Neon arch', 'lights', 6.6, false, null, neonArch),
  O('glow_orb', 'Glow orb', 'lights', 1.0, false, null, glowOrb),

  O('billboard', 'Billboard', 'signs', 5.2, true, null, billboard),
  O('banner', 'Banner', 'signs', 6.6, false, null, banner),
  O('flag', 'Flag', 'signs', 0.5, true, null, flag),
  O('checker_flag', 'Checkered flag', 'signs', 0.5, true, null, checkerFlag),
  O('sign_post', 'Sign post', 'signs', 0.5, true, null, signPost),
];

const BY_ID = new Map(OBJECTS.map(o => [o.id, o]));
export function objectById(id) { return BY_ID.get(id) || null; }

/* One object as one mesh, for anything that just wants it on screen. The
   game can equally call make() and merge the parts itself, with whatever
   material it likes. */
export function buildObject(id, color, mat) {
  const o = objectById(id);
  if (!o) return null;
  const m = merge(o.make(color), mat || vertexMat());
  m.name = 'mapobj-' + id;
  m.userData.mapObject = id;
  return m;
}

// imported for the shared vocabulary even where this file has its own version
void ball; void hoop;
