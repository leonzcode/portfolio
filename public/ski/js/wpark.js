/* (W, round 10) Any mountain on Earth: its park, the object terrain.js and the physics ask about everything built on
   the mountain (as park.js assemble's): the lifts' station pads (wlift.js), the generated features (side hits along the
   runs' edges, wind lips, rock drops, the terrain parks' lines: added by addFeatures), where the rock faces are
   (cliff, for the physics' walls) and where a run can start (the pause menu's start points, the trail map's drops).
   Features standing on a slope that runs any way are built in a frame of their own, as the lifts are: a park.js Kicker
   laid out along z in its frame, asked through the frame (Framed). */
import * as THREE from 'three';
import { smax } from './noise.js?v=26';

export function makeWorldPark(land) {
  const feats = [];                  // world-frame features: { x0, x1, z0, z1, height(x, z, g), surface(x, z), ownMesh }
  let grid = null; const B = 32, key = (i, j) => i * 100003 + j;
  const near = (x, z) => grid ? grid.get(key(Math.floor(x / B), Math.floor(z / B))) : null;
  const top = (l, x, z, g, terr) => {
    let a = -Infinity, b = -Infinity;
    for (const f of l) { if (terr && f.ownMesh) continue; const y = f.height(x, z, g); if (y > a) { b = a; a = y; } else if (y > b) b = y; }
    // (two features meeting: rounded into each other, as park.js does, a little)
    return b > -Infinity && a - b < 0.6 ? smax(a, b, 0.6) : a;
  };
  const park = {
    world: true, kickers: [], pipe: null, qp: null, rails: [], all: feats, fences: [], banner: null, starts: [],
    pads: null,             // (wlift.js planWorldLifts: { padAt(x, z, g, terrainOnly), surf(x, z) })
    height(x, z, g) {
      const l = near(x, z); let y = l ? top(l, x, z, g, false) : -Infinity;
      if (this.pads) { const p = this.pads.padAt(x, z, g, false); if (p > y) y = p; }
      return y;
    },
    heightTerrainOnly(x, z, g) {
      const l = near(x, z); let y = l ? top(l, x, z, g, true) : -Infinity;
      if (this.pads) { const p = this.pads.padAt(x, z, g, true); if (p > y) y = p; }
      return y;
    },
    // the ground under features with meshes of their own is lowered a little, so it never shows through them
    visualDip(x, z) {
      const l = near(x, z); if (!l) return 0;
      let d = 0;
      for (const f of l) if (f.ownMesh) { const g = land.at(x, z), y = f.height(x, z, g); if (y > g + 0.02) d = Math.max(d, Math.min(0.35, (y - g) * 2)); }
      return d;
    },
    surface(x, z) {
      if (this.pads && this.pads.surf(x, z)) return true;
      const l = near(x, z); if (!l) return false;
      for (const f of l) if (f.surface && f.surface(x, z)) return true;
      return false;
    },
    // a rock face (the physics' wall over about 53 degrees)
    cliff(x, z) { return land.cliff(x, z); },
    // the features added: into the lookup grid
    add(list) {
      for (const f of list) feats.push(f);
      grid = new Map();
      for (const f of feats) for (let i = Math.floor(f.x0 / B); i <= Math.floor(f.x1 / B); i++) for (let j = Math.floor(f.z0 / B); j <= Math.floor(f.z1 / B); j++) {
        const k = key(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(f);
      }
    },
  };
  return park;
}

// the way down the fall line at a place (radians, as the skier's yaw: 0 faces +z)
export function fallYaw(h, x, z, s = 4) {
  const gx = (h(x + s, z) - h(x - s, z)) / (2 * s), gz = (h(x, z + s) - h(x, z - s)) / (2 * s);
  return Math.hypot(gx, gz) < 1e-4 ? 0 : Math.atan2(-gx, -gz);
}
