// Static things the car hits, in plan (x, z) with a height range: building footprints (polygons, concave is
// fine), fences, walls and rails (thick segments), poles, hydrants, trees, bollards (circles). Kept in a grid
// of 16 m cells. The car is a row of circles along its body; `contacts(circles)` gives each overlap's push-out.
// A building's polygon blocks from its base (or the underside of an overhang) to its walls' top, so a car above it
// is not stopped by it; `roofAt(x, z, yHint)` is the roof such a car stands on (shape.roof: { eave, top, at(x, z) },
// set by buildings.js). A shape with `lazy` (Google's mesh: its top found by a ray when first needed) has y1 = 1e4
// until a car comes near it.
import { under } from './under.js?v=34';
const CELL = 16;

export class Collide {
  constructor() { this.grid = new Map(); this.shapes = []; this.dynamic = []; }

  _cells(x0, z0, x1, z1, fn) {
    const a = Math.floor(x0 / CELL), b = Math.floor(z0 / CELL), c = Math.floor(x1 / CELL), d = Math.floor(z1 / CELL);
    if ((c - a + 1) * (d - b + 1) > 4096) return; // nothing that big belongs in here
    for (let i = a; i <= c; i++) for (let j = b; j <= d; j++) fn(i + ',' + j);
  }
  _add(s, x0, z0, x1, z1) {
    s.id = this.shapes.length; this.shapes.push(s);
    this._cells(x0, z0, x1, z1, k => { let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(s); });
    return s;
  }
  // points [[x, z], ...] (closed implicitly); y0..y1 is the height range it blocks
  addPolygon(points, y0 = -1e4, y1 = 1e4, tag) {
    if (!points || points.length < 3) return null;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return this._add({ k: 0, p: points, y0, y1, tag, bb: [x0, z0, x1, z1] }, x0, z0, x1, z1);
  }
  addSegment(a, b, thickness = 0.2, y0 = -1e4, y1 = 1e4, tag) {
    const r = thickness / 2;
    return this._add({ k: 1, a, b, r, y0, y1, tag }, Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r);
  }
  addCircle(x, z, r, y0 = -1e4, y1 = 1e4, tag) {
    return this._add({ k: 2, x, z, r, y0, y1, tag }, x - r, z - r, x + r, z + r);
  }
  remove(s) {
    if (!s) return;
    s.dead = true;
  }
  clear() { this.grid.clear(); this.shapes.length = 0; }

  // shapes near a box
  near(x0, z0, x1, z1) {
    const out = new Set();
    this._cells(x0, z0, x1, z1, k => { const l = this.grid.get(k); if (l) for (const s of l) if (!s.dead) out.add(s); });
    return out;
  }

  // circles: [{ x, z, r, y0, y1 }]; returns [{ i (circle index), nx, nz (push direction), depth, px, pz (contact point), shape }]
  contacts(circles) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const c of circles) { x0 = Math.min(x0, c.x - c.r); x1 = Math.max(x1, c.x + c.r); z0 = Math.min(z0, c.z - c.r); z1 = Math.max(z1, c.z + c.r); }
    const out = [];
    // inside a tunnel's bore (under.js) the buildings over it are not in the way (a building's walls block from
    // -1e4 up: from under the ground, so a car on a hillside below its base still meets them)
    let tunnel = false;
    if (under.tubes.length && circles.length) { const c = circles[0]; tunnel = under.floorAt((x0 + x1) / 2, (z0 + z1) / 2, c.y0 + 0.3) !== null; }
    for (const s of this.near(x0, z0, x1, z1)) {
      if (tunnel && s.tag === 'building') continue;
      if (s.lazy) { const f = s.lazy; s.lazy = null; try { const t = f(); if (Number.isFinite(t)) s.y1 = t; } catch (e) {} }
      // (a building with a known base, buildings.js's roof info: a car more than 2.5 m under its base is in a cutting
      // or a tunnel passing beside or under it, not at its walls)
      const y0 = s.y0 < -9e3 && s.tag === 'building' && s.roof && Number.isFinite(s.roof.base) ? s.roof.base - 2.5 : s.y0;
      for (let i = 0; i < circles.length; i++) {
        const c = circles[i];
        if (c.y1 < y0 || c.y0 > s.y1) continue;
        const h = hit(s, c);
        if (h) { h.i = i; h.shape = s; out.push(h); }
      }
    }
    return out;
  }

  // The roof under (x, z) for a wheel at yHint: the highest building roof whose plan holds the point, where the
  // wheel is at or over the top of its walls (less `up`: a car landing on it, or rolling on it). null when none:
  // a car beside a building (below its walls' top) is stopped by the wall and stands on the ground.
  roofAt(x, z, yHint, up = 0.6) {
    if (yHint == null || !Number.isFinite(yHint)) return null;
    const l = this.grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)); if (!l) return null;
    let best = null;
    for (const s of l) {
      const rf = s.roof;
      if (!rf || s.dead || yHint < rf.eave - up) continue;
      const b = s.bb; if (b && (x < b[0] || x > b[2] || z < b[1] || z > b[3])) continue;
      if (!inside(s.p, x, z)) continue;
      const h = rf.at ? rf.at(x, z) : rf.top;
      if (Number.isFinite(h) && (best === null || h > best)) best = h;
    }
    return best;
  }
}

function closestOnSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
  let t = l > 0 ? ((px - ax) * dx + (pz - az) * dz) / l : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [ax + dx * t, az + dz * t];
}

function inside(p, x, z) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function hit(s, c) {
  if (s.k === 2) {
    const dx = c.x - s.x, dz = c.z - s.z, d = Math.hypot(dx, dz), m = s.r + c.r;
    if (d >= m) return null;
    const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
    return { nx, nz, depth: m - d, px: s.x + nx * s.r, pz: s.z + nz * s.r };
  }
  if (s.k === 1) {
    const [qx, qz] = closestOnSeg(c.x, c.z, s.a[0], s.a[1], s.b[0], s.b[1]);
    const dx = c.x - qx, dz = c.z - qz, d = Math.hypot(dx, dz), m = s.r + c.r;
    if (d >= m) return null;
    let nx, nz;
    if (d > 1e-6) { nx = dx / d; nz = dz / d; } else { const ex = s.b[0] - s.a[0], ez = s.b[1] - s.a[1], el = Math.hypot(ex, ez) || 1; nx = -ez / el; nz = ex / el; }
    return { nx, nz, depth: m - d, px: qx, pz: qz };
  }
  // polygon: nearest edge point; if the centre is inside, push out through the nearest edge
  const p = s.p;
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [qx, qz] = closestOnSeg(c.x, c.z, p[j][0], p[j][1], p[i][0], p[i][1]);
    const d = (c.x - qx) ** 2 + (c.z - qz) ** 2;
    if (d < best) { best = d; bx = qx; bz = qz; }
  }
  const d = Math.sqrt(best), ins = inside(p, c.x, c.z);
  if (!ins && d >= c.r) return null;
  let nx = c.x - bx, nz = c.z - bz;
  const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
  if (ins) { nx = -nx; nz = -nz; }
  return { nx, nz, depth: ins ? c.r + d : c.r - d, px: bx, pz: bz };
}
