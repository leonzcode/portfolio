// What lies under the ground: the tunnels' bores (tunnels.js puts them here when it builds an area), so the
// world's ground under a wheel, a person or the camera inside a tunnel is the tunnel's floor rather than the hill
// over it (world.js asks floorAt), rays from the camera stop at its walls (world.js raycast takes `meshes`), and the
// terrain is cut away where the bore's roof comes near the surface (cutmask.js draws `mask`).
//
//   under.set(reg)                 reg: { tubes, meshes, mask } (tunnels.js), replacing the last one; under.clear(reg)
//   under.floorAt(x, z, yHint)     the floor of a bore at (x, z) for something at yHint inside it, else null
//   under.floorNear(x, z)          the floor of a masked bore stretch at (x, z) whatever the height, else null
//
// A tube: { x, z, f (floor height), nx, nz (right normal) arrays along the bore's centre line, dL, dR (half widths
// to the walls), hw (carriageway half width), crown (roof over the floor), grid: Map cell -> [segment index] }.
// Frame: geo.js local metres, +x east, +y up, +z south.
const CELL = 16;
const EMPTY = { tubes: [], meshes: [], mask: [] };
let REG = EMPTY;

const key = (i, j) => i * 73856093 ^ j * 19349663;

// index a tube's segments by 16 m cells (tunnels.js calls this before set)
export function indexTube(t) {
  const g = new Map(), m = Math.max(t.dL, t.dR) + 1;
  for (let i = 1; i < t.x.length; i++) {
    const x0 = Math.min(t.x[i - 1], t.x[i]) - m, x1 = Math.max(t.x[i - 1], t.x[i]) + m, z0 = Math.min(t.z[i - 1], t.z[i]) - m, z1 = Math.max(t.z[i - 1], t.z[i]) + m;
    for (let a = Math.floor(x0 / CELL); a <= Math.floor(x1 / CELL); a++) for (let b = Math.floor(z0 / CELL); b <= Math.floor(z1 / CELL); b++) {
      const k = key(a, b); let l = g.get(k); if (!l) g.set(k, l = []); l.push(i);
    }
  }
  t.grid = g;
  return t;
}

// the place on a tube nearest (x, z): { f (floor there), o (offset right of the centre line), t (along the segment) }
const _hit = { f: 0, o: 0, ok: false };
function onTube(t, x, z, ext = 0.3) {
  const l = t.grid && t.grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  _hit.ok = false; if (!l) return _hit;
  let best = Infinity;
  for (const i of l) {
    const ax = t.x[i - 1], az = t.z[i - 1], dx = t.x[i] - ax, dz = t.z[i] - az, L2 = dx * dx + dz * dz;
    if (L2 < 1e-6) continue;
    const u = ((x - ax) * dx + (z - az) * dz) / L2;
    // (a little past either end of a piece: the outside of a bend)
    if (u < -0.05 || u > 1.05) continue;
    const uc = Math.max(0, Math.min(1, u)), cx = ax + dx * uc, cz = az + dz * uc, L = Math.sqrt(L2);
    const o = ((x - cx) * -dz + (z - cz) * dx) / L; // right of a->b is (-dz, dx): +x east, +z south
    if (o < -t.dL - ext || o > t.dR + ext) continue;
    // past the tube's own ends it is not in the tube
    if ((i === 1 && u < 0) || (i === t.x.length - 1 && u > 1)) continue;
    const d = Math.abs(o) + (u < 0 ? -u : u > 1 ? u - 1 : 0) * L;
    if (d < best) { best = d; _hit.f = t.f[i - 1] + (t.f[i] - t.f[i - 1]) * uc; _hit.o = o; _hit.ok = true; }
  }
  return _hit;
}

// the terrain's height (world.js sets it in the open map): something at or over the ground's surface is not in a
// tunnel under it, however shallow the tunnel (a street just inside a portal)
let groundFn = null;
export function setGround(fn) { groundFn = fn; }
export function floorAt(x, z, yHint) {
  if (yHint == null || !Number.isFinite(yHint) || !REG.tubes.length) return null;
  let best = null, bd = Infinity, g;
  for (const t of REG.tubes) {
    const h = onTube(t, x, z);
    if (!h.ok) continue;
    // inside the bore: from a little under its floor (a wheel dipping on its springs) up to its roof
    if (yHint < h.f - 2 || yHint > h.f + t.crown + 0.3) continue;
    if (groundFn) { if (g === undefined) g = groundFn(x, z); if (g != null && yHint > g - 0.8) continue; }
    const top = h.f + (Math.abs(h.o) > t.hw ? t.walk : 0);
    const d = Math.abs(yHint - top);
    if (d < bd) { bd = d; best = top; }
  }
  return best;
}

export function floorNear(x, z) {
  let best = null;
  for (const t of REG.tubes) {
    if (!t.masked) continue;
    const h = onTube(t, x, z, 4);
    if (h.ok && (best === null || h.f < best)) best = h.f;
  }
  return best;
}

export function set(reg) { REG = reg || EMPTY; under.tubes = REG.tubes; under.meshes = REG.meshes; under.mask = REG.mask; }
export function clear(reg) { if (!reg || reg === REG) set(EMPTY); }

export const under = { set, clear, floorAt, floorNear, indexTube, setGround, tubes: EMPTY.tubes, meshes: EMPTY.meshes, mask: EMPTY.mask };
export default under;
