/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the ancient city, our own design.

   A dead city of deepslate in a cavern carved out deep underground. The
   plan lays the city out in its own frame (x along the main avenue, about
   151 x 101 blocks, centred on the start point) and turns the whole frame
   by the start's rot, so every box is placed from its corners in that
   frame.

   What it is made of, in drawing order:
     the cavern     tiles that carve the cave (a dome, highest over the
                    middle, its rim wobbling) and lay a solid floor
     two chasms     basalt-walled drops with sculk at the bottom, each with
                    a bridge out to a gate in the city wall
     streets        the main avenue, two cross streets and two ring roads,
                    deepslate tiles edged with polished deepslate
     the centre     a stepped platform with the great frame of reinforced
                    deepslate (its opening shaped like the warden's head),
                    four towers, soul fire braziers and chests
     the quarters   rows of ruined houses, towers, sculk courtyards, wool
                    tents, soul fire halls and at least two ice boxes, each
                    facing its street
     the wall       a broken wall round the city with gates for the streets
     sculk          last, patches of sculk, veins, sensors, shriekers and
                    the odd catalyst spread over every floor and roof

   Randomness: the plan uses ctx.r for the layout; drawing uses a hash of
   the frame position and a salt from the plan, so every chunk a box
   crosses draws the same thing, and nothing takes from g.r except chests.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { id } from '../piece.js?v=107';
import { hash32 } from '../rand.js?v=107';

export const PLANS = {};

const TYPE = 'ancient_city';
const F = -52;                 // the floor blocks of the city; people walk at F + 1
const HX = 75, HZ = 50;        // half the city's size along x and z (its frame)

/* ------------------------------------------------------------- noise -- */
// a number 0..1 for a cell, from a salt
const h01 = (s, x, z, k) => hash32(s, x, z, k | 0) / 4294967296;
// smooth value noise 0..1 over a grid of `cell` blocks
function vnoise(s, x, z, cell) {
  const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
  const fx = (x - gx * cell) / cell, fz = (z - gz * cell) / cell;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = h01(s, gx, gz, cell), b = h01(s, gx + 1, gz, cell);
  const c = h01(s, gx, gz + 1, cell), d = h01(s, gx + 1, gz + 1, cell);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
// a deepslate brick, now and then cracked
const brick = (s, x, y, z) => h01(s, x * 31 + y, z, 3) < 0.22 ? 'cracked_deepslate_bricks' : 'deepslate_bricks';
const tile = (s, x, y, z) => h01(s, x * 17 + y, z, 5) < 0.12 ? 'cracked_deepslate_tiles' : 'deepslate_tiles';

/* --------------------------------------------------- the great frame -- */
// The opening, 25 wide and 20 high, is the warden's head with its two
// horns; around it a ring of reinforced deepslate, then a band of bricks
// and tiles. Kept as a map of 31 x 23 cells: 0 open, 1 ring, 2 brick, 3 tile.
const PW = 31, PH = 23;
const PORTAL = (() => {
  const open = (x, y) => {
    const gx = x - 3;
    if (y < 0 || gx < 0 || gx > 24) return false;
    if (y <= 11) return gx >= 4 && gx <= 20;
    if (y <= 14) return gx >= 1 && gx <= 23;
    if (y <= 19) return gx <= 3 || gx >= 21 ? gx >= 1 && gx <= 23 : false;
    return false;
  };
  const map = [];
  for (let x = 0; x < PW; x++) {
    map.push([]);
    for (let y = 0; y < PH; y++) {
      let v = -1;
      if (open(x, y)) v = 0;
      else {
        let dist = 9;
        for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++)
          if (open(x + dx, y + dy)) dist = Math.min(dist, Math.max(Math.abs(dx), Math.abs(dy)));
        if (dist === 1) v = 1;
        else if (dist === 2) v = 2;
        else if (dist === 3) v = 3;
      }
      map[x].push(v);
    }
  }
  return map;
})();

/* ------------------------------------------------------------ drawing -- */
// one tile of the cavern: a solid floor and the air above it, the roof a
// dome over the city and the rim wobbling a few blocks outside the walls
function drawCave(g, o) {
  for (let x = 0; x < g.w; x++) for (let z = 0; z < g.d; z++) {
    const lx = o.lx + x, lz = o.lz + z;
    const n = vnoise(o.s, lx, lz, 9), n2 = vnoise(o.s + 1, lx, lz, 5);
    const dx = Math.max(0, Math.abs(lx) - HX), dz = Math.max(0, Math.abs(lz) - HZ);
    const rim = 7 + (n - 0.5) * 6;
    const e = Math.sqrt(dx * dx + dz * dz) / rim;
    if (e >= 1) continue;
    const dome = Math.max(0, 1 - (lx / 92) * (lx / 92) - (lz / 66) * (lz / 66));
    let top = 13 + Math.round(18 * Math.sqrt(dome) + (n2 - 0.5) * 4);
    let fl = 0;
    if (e > 0) { top = Math.round(top * (1 - e * 0.7)); fl = Math.round(e * 4 + n2 * 2); }
    g.fill(x, 0, z, x, 2 + fl, z, 'deepslate', { axis: 'y' });
    if (top > fl + 2) g.air(x, 3 + fl, z, x, 2 + top, z);
  }
}

// a chasm: walls of basalt, sculk at the bottom, a rail round the edge and a
// bridge across it at frame x o.bx..o.bx+4 running along z
function drawChasm(g, o) {
  const w = g.w, d = g.d, B0 = o.bx, B1 = o.bx + 4;
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
    const lx = o.lx + x, lz = o.lz + z;
    if (edge) {
      for (let y = 0; y <= 6; y++) g.set(x, y, z, h01(o.s, lx * 5 + y, lz, 1) < 0.3 ? 'smooth_basalt' : 'basalt', { axis: 'y' });
      g.set(x, 7, z, 'polished_deepslate');
      if (x < B0 || x > B1) g.set(x, 8, z, 'deepslate_tile_wall');
      continue;
    }
    const n = vnoise(o.s + 2, lx, lz, 4);
    g.set(x, 0, z, n > 0.45 ? 'sculk' : 'smooth_basalt');
    g.air(x, 1, z, x, 8, z);
    if (n > 0.55 && h01(o.s, lx, lz, 9) < 0.05) g.set(x, 1, z, 'sculk_sensor');
    else if (n > 0.5 && h01(o.s, lx, lz, 8) < 0.25) g.set(x, 1, z, 'sculk_vein');
    // basalt columns standing in the chasm
    if (h01(o.s, lx, lz, 11) < 0.04 && (x < B0 - 1 || x > B1 + 1)) {
      const t = 2 + Math.floor(h01(o.s, lx, lz, 12) * 5);
      g.fill(x, 0, z, x, t, z, 'basalt', { axis: 'y' });
    }
  }
  // the bridge, with arches down to the floor
  for (let z = 0; z < d; z++) {
    g.fill(B0 + 1, 7, z, B1 - 1, 7, z, 'deepslate_tiles');
    g.set(B0, 7, z, 'polished_deepslate'); g.set(B1, 7, z, 'polished_deepslate');
    g.set(B0, 8, z, 'deepslate_tile_wall'); g.set(B1, 8, z, 'deepslate_tile_wall');
    if (z > 0 && z < d - 1) g.air(B0 + 1, 8, z, B1 - 1, 8, z);
    if (z % 4 === 2) {
      g.fill(B0, 0, z, B0, 6, z, 'deepslate_bricks'); g.fill(B1, 0, z, B1, 6, z, 'deepslate_bricks');
      g.fill(B0 + 1, 6, z, B1 - 1, 6, z, 'deepslate_brick_slab', { slab: 1 });
    }
  }
  g.air(B0 + 1, 8, 0, B1 - 1, 8, 0); g.air(B0 + 1, 8, d - 1, B1 - 1, 8, d - 1);
}

// a street running along x (o.along === 'x') or z: tiles edged with polished deepslate
function drawStreet(g, o) {
  const alongX = o.along === 'x';
  for (let x = 0; x < g.w; x++) for (let z = 0; z < g.d; z++) {
    const lx = o.lx + x, lz = o.lz + z;
    const border = alongX ? z === 0 || z === g.d - 1 : x === 0 || x === g.w - 1;
    g.set(x, 0, z, border ? 'polished_deepslate' : tile(o.s, lx, 0, lz));
    if (o.posts && border && ((alongX ? lx : lz) % 16 + 16) % 16 === 8) {
      g.set(x, 1, z, 'deepslate_tile_wall'); g.set(x, 2, z, 'deepslate_tile_wall');
      g.set(x, 3, z, 'soul_lantern');
    }
  }
}

// the stepped platform at the city's heart, with what stands on it
// (frame = city frame from lx -22, lz -20; top floor at y 5 = F + 3)
function drawPlatform(g, o) {
  const w = g.w, d = g.d, cxm = w >> 1, czm = d >> 1;
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    const ring = Math.min(x, z, w - 1 - x, d - 1 - z);
    const top = ring >= 2 ? 5 : 3 + ring;
    g.fill(x, 0, z, x, top - 1, z, 'deepslate_bricks');
    g.air(x, top + 1, z, x, g.h - 1, z);
    if (ring < 2) {
      const n = (x === ring) + (z === ring) + (w - 1 - x === ring) + (d - 1 - z === ring);
      if (n > 1) g.set(x, top, z, 'polished_deepslate');
      else {
        const f = z === ring ? SOUTH : x === ring ? EAST : d - 1 - z === ring ? NORTH : WEST;
        g.set(x, top, z, 'deepslate_tile_stairs', { f });
      }
      continue;
    }
    // the top: tiles, a polished border and walkway, chiseled studs
    const lx = x - cxm, lz = z - czm;
    let b = tile(o.s, x, 5, z);
    if (ring === 2 || Math.abs(lz) <= 3 || Math.abs(lx) <= 3) b = 'polished_deepslate';
    if ((Math.abs(lz) === 3 || Math.abs(lx) === 3) && ((lx + lz) & 3) === 0) b = 'chiseled_deepslate';
    g.set(x, 5, z, b);
  }
  // soul fire braziers
  for (const [bx, bz] of [[-7, -8], [7, -8], [-7, 8], [7, 8]]) {
    const x = cxm + bx, z = czm + bz;
    g.fill(x - 1, 6, z - 1, x + 1, 6, z + 1, 'polished_deepslate');
    g.set(x, 6, z, 'soul_sand'); g.set(x, 7, z, 'soul_fire');
  }
  // candles on chiseled pedestals either side of the walkway
  for (const [bx, bz] of [[-4, -5], [4, -5], [-4, 5], [4, 5], [-10, -5], [10, -5], [-10, 5], [10, 5]]) {
    g.set(cxm + bx, 6, czm + bz, 'chiseled_deepslate');
    g.set(cxm + bx, 7, czm + bz, 'candle', { m: 1 + (Math.abs(bx + bz) & 1) * 2 });
  }
  // sculk round the foot of the frame
  for (const [bx, bz] of [[-3, -12], [3, 12], [-3, 12], [3, -12]]) g.set(cxm + bx, 5, czm + bz, 'sculk_catalyst');
  for (const [bx, bz] of [[-5, -16], [5, 16]]) { g.set(cxm + bx, 6, czm + bz, 'sculk_shrieker'); }
  g.chest(cxm - 5, 6, czm - 12, 'ancient_city', SOUTH);
  g.chest(cxm + 5, 6, czm + 12, 'ancient_city', NORTH);
}

// the great frame (frame x across the avenue, z through it; stands on the platform)
function drawPortal(g, o) {
  for (let x = 0; x < PW; x++) for (let y = 0; y < PH; y++) {
    const v = PORTAL[x][y];
    if (v <= 0) continue;
    for (let z = 0; z < g.d; z++) {
      let b = v === 1 ? 'reinforced_deepslate' : v === 2 ? brick(o.s, x, y, z) : tile(o.s, x, y, z);
      if (v === 2 && z !== 1 && (y === 11 || y === 15) ) b = 'chiseled_deepslate';
      g.set(x, y, z, b);
    }
  }
  // soul lanterns hanging in the horns
  g.set(5, 19, 1, 'soul_lantern', { m: 1 });
  g.set(PW - 6, 19, 1, 'soul_lantern', { m: 1 });
}

// a tower, door on its south side (z = d - 1)
function drawTower(g, o) {
  const w = g.w, d = g.d, H = g.h - 1, mx = w >> 1;
  g.fill(0, 0, 0, w - 1, 0, d - 1, 'polished_deepslate');
  for (let y = 1; y <= H - 2; y++) for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
    if (!edge) { g.set(x, y, z, 'air'); continue; }
    const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
    g.set(x, y, z, corner ? 'polished_deepslate' : y % 6 === 0 ? 'chiseled_deepslate' : brick(o.s, x, y, z));
  }
  g.air(mx, 1, d - 1, mx, 3, d - 1);
  for (let y = 5; y < H - 3; y += 4) {
    g.air(mx, y, 0, mx, y + 1, 0); g.air(0, y, mx, 0, y + 1, mx); g.air(w - 1, y, mx, w - 1, y + 1, mx);
  }
  g.fill(0, H - 1, 0, w - 1, H - 1, d - 1, 'deepslate_tiles');
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
    if (edge && ((x + z) & 1) === 0) g.set(x, H, z, 'deepslate_brick_wall');
  }
  g.set(mx, H - 2, d >> 1, 'soul_lantern', { m: 1 });
  g.set(mx, H, d >> 1, 'soul_lantern');
}

// a ruined house, door on its south side
function drawHouse(g, o) {
  const w = g.w, d = g.d, H = o.H, mx = w >> 1;
  g.fill(0, 0, 0, w - 1, 0, d - 1, 'deepslate_tiles');
  g.air(0, 1, 0, w - 1, g.h - 1, d - 1);
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    if (!(x === 0 || z === 0 || x === w - 1 || z === d - 1)) continue;
    const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
    const drop = o.roof ? 0 : [0, 0, 1, 2, 3][Math.floor(h01(o.s, x >> 1, z >> 1, 1) * 5)];
    const top = corner ? H + (o.roof ? 1 : 0) : H - drop;
    for (let y = 1; y <= top; y++) g.set(x, y, z, corner ? 'polished_deepslate' : y === 1 ? 'polished_deepslate' : brick(o.s, x, y, z));
  }
  // door and windows
  g.air(mx - 1, 1, d - 1, mx + 1, 3, d - 1);
  if (H >= 5) g.set(mx, 4, d - 1, 'chiseled_deepslate');
  if (H >= 4) {
    for (let z = 2; z < d - 2; z += 3) { g.air(0, 2, z, 0, 3, z); g.air(w - 1, 2, z, w - 1, 3, z); }
    for (let x = 2; x < w - 2; x += 4) if (x !== mx) g.air(x, 2, 0, x, 3, 0);
  }
  // a roof with holes fallen through it
  if (o.roof) {
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
      const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
      if (edge || h01(o.s, x >> 1, z >> 1, 4) > 0.25) g.set(x, H + 1, z, 'deepslate_tile_slab', { slab: 0 });
    }
    g.set(mx, H, d >> 1, 'soul_lantern', { m: 1 });
  } else {
    g.set(1, 1, d - 2, 'deepslate_tile_wall');
    g.set(1, 2, d - 2, 'soul_lantern');
  }
  // carpets, worn through in places
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) {
    if (h01(o.s, x, z, 6) > 0.85) continue;
    if (!o.roof && x === 1 && z === d - 2) continue;
    const rim = x === 1 || x === w - 2 || z === 1 || z === d - 2;
    g.set(x, 1, z, rim ? 'gray_carpet' : x === mx ? 'blue_carpet' : 'light_blue_carpet');
  }
  g.set(1, 1, 1, 'candle', { m: o.n % 4 });
  g.set(w - 2, 1, 1, 'candle', { m: (o.n >> 2) % 4 });
  if (o.skull) g.set(w - 2, 1, d - 3, 'skeleton_skull', { m: o.n % 16 });
  if (o.chest) g.chest(mx, 1, 1, 'ancient_city', SOUTH);
}

// an ice box: a sealed brick room lined with packed ice, snow on the floor, one chest
function drawIceBox(g, o) {
  g.hollow(0, 0, 0, 6, 6, 6, 'deepslate_bricks', 'air');
  g.hollow(1, 1, 1, 5, 5, 5, 'packed_ice', 'air');
  g.fill(2, 1, 2, 4, 1, 4, 'snow_block');
  g.set(1, 3, 1, 'blue_ice'); g.set(5, 3, 1, 'blue_ice'); g.set(1, 2, 5, 'blue_ice'); g.set(5, 4, 5, 'blue_ice');
  g.set(2, 2, 4, 'snow'); g.set(4, 2, 3, 'snow');
  g.air(3, 2, 5, 3, 3, 6);
  g.set(3, 1, 6, 'deepslate_brick_stairs', { f: NORTH });
  g.set(3, 4, 6, 'chiseled_deepslate');
  g.chest(3, 2, 2, 'ancient_city_ice_box', SOUTH);
}

// a sculk courtyard: low walls, a catalyst in a bed of sculk, shriekers at its corners
function drawCourt(g, o) {
  const w = g.w, d = g.d, m = w >> 1;
  g.fill(0, 0, 0, w - 1, 0, d - 1, 'deepslate_tiles');
  g.air(0, 1, 0, w - 1, g.h - 1, d - 1);
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
    if (edge) {
      const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
      if (corner) { g.fill(x, 1, z, x, 3, z, 'polished_deepslate'); g.set(x, 4, z, 'soul_lantern'); }
      else { g.set(x, 1, z, brick(o.s, x, 1, z)); if (h01(o.s, x, z, 2) < 0.7) g.set(x, 2, z, brick(o.s, x, 2, z)); }
    } else if (Math.abs(x - m) <= 2 && Math.abs(z - m) <= 2) g.set(x, 0, z, 'sculk');
    else if (h01(o.s, x, z, 7) < 0.3) g.set(x, 1, z, 'sculk_vein');
  }
  g.air(m - 1, 1, d - 1, m + 1, 2, d - 1);
  g.set(m, 0, m, 'sculk_catalyst');
  for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) g.set(m + a, 1, m + b, 'sculk_shrieker');
  g.set(m - 2, 1, m, 'sculk_sensor'); g.set(m + 2, 1, m, 'sculk_sensor');
  g.set(m, 1, 1, 'air');
  if (o.chest) g.chest(m, 1, 1, 'ancient_city', SOUTH);
}

// a wool tent open to the south with a soul campfire in front of it
function drawTent(g, o) {
  const d = g.d, L = d - 3;            // the tent runs z 0..L, the fire sits at z d - 1
  g.air(0, 1, 0, g.w - 1, g.h - 1, d - 1);
  for (let z = 0; z <= L; z++) {
    const wool = z % 3 === 1 ? 'light_blue_wool' : 'gray_wool';
    g.fill(0, 1, z, 0, 2, z, wool); g.fill(6, 1, z, 6, 2, z, wool);
    g.set(1, 3, z, wool); g.set(5, 3, z, wool);
    g.set(2, 4, z, wool); g.set(4, 4, z, wool);
    g.set(3, 5, z, 'blue_wool');
    if (z === 0) { g.fill(1, 1, 0, 5, 2, 0, 'gray_wool'); g.fill(2, 3, 0, 4, 3, 0, 'gray_wool'); g.set(3, 4, 0, 'gray_wool'); }
    else for (let x = 1; x <= 5; x++) g.set(x, 1, z, z === 1 || x === 1 || x === 5 ? 'gray_carpet' : 'blue_carpet');
  }
  g.set(1, 1, 1, 'candle', { m: o.n % 4 });
  g.set(5, 1, 1, 'candle', { m: (o.n >> 2) % 4 });
  g.set(3, 1, d - 1, 'soul_campfire');
  g.set(1, 1, d - 1, 'polished_deepslate_slab', { slab: 0 });
  g.set(5, 1, d - 1, 'polished_deepslate_slab', { slab: 0 });
  if (o.chest) g.chest(3, 1, 1, 'ancient_city', SOUTH);
}

// a hall of soul fire pits with benches along the back
function drawSauna(g, o) {
  const w = g.w, d = g.d, mx = w >> 1;
  g.fill(0, 0, 0, w - 1, 0, d - 1, 'polished_deepslate');
  g.air(0, 1, 0, w - 1, g.h - 1, d - 1);
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
    if (!(x === 0 || z === 0 || x === w - 1 || z === d - 1)) continue;
    const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
    const top = corner ? 5 : 4 - [0, 0, 1, 2][Math.floor(h01(o.s, x >> 1, z >> 1, 1) * 4)];
    for (let y = 1; y <= top; y++) g.set(x, y, z, corner ? 'polished_deepslate' : brick(o.s, x, y, z));
  }
  g.air(mx - 1, 1, d - 1, mx + 1, 3, d - 1);
  for (let x = 2; x < w - 2; x += 3) {
    g.set(x, 0, 4, 'soul_sand'); g.set(x, 1, 4, 'soul_fire');
    g.set(x, 0, 3, 'deepslate_tiles'); g.set(x, 0, 5, 'deepslate_tiles');
  }
  for (let x = 1; x < w - 1; x++) g.set(x, 1, 1, 'polished_deepslate_stairs', { f: NORTH });
  g.set(1, 2, 1, 'candle', { m: o.n % 4 });
  g.set(w - 2, 2, 1, 'candle', { m: 2 });
}

// a row of broken pillars with lanterns, beside the platform
function drawColonnade(g, o) {
  for (let x = 1; x < g.w - 1; x += 5) {
    const t = 2 + Math.floor(h01(o.s, o.lx + x, o.lz, 1) * 4);
    g.set(x, 0, 2, 'polished_deepslate');
    for (let y = 1; y <= t; y++) g.set(x, y, 2, brick(o.s, o.lx + x, y, o.lz));
    if (t >= 4) { g.set(x, t + 1, 2, 'chiseled_deepslate'); g.set(x, t + 2, 2, 'soul_lantern'); }
    else g.set(x + 1, 1, 2 + (x % 2 ? 1 : -1), 'cobbled_deepslate_slab', { slab: 0 });
  }
}

// a stretch of the city wall along x (o.along === 'x') or z, two blocks thick, broken along its top
function drawWall(g, o) {
  const alongX = o.along === 'x';
  for (let x = 0; x < g.w; x++) for (let z = 0; z < g.d; z++) {
    const lx = o.lx + x, lz = o.lz + z, a = alongX ? lx : lz;
    const top = 4 + Math.round(6 * vnoise(o.s, lx, lz, 7));
    const gate = o.gates.some(([a0, a1]) => a >= a0 && a <= a1);
    g.set(x, 0, z, 'deepslate_tiles');
    for (let y = 1; y <= top; y++) {
      if (gate && y <= 4) { g.set(x, y, z, 'air'); continue; }
      g.set(x, y, z, y === 1 ? 'polished_deepslate' : gate && y === 5 ? 'chiseled_deepslate' : brick(o.s, lx, y, lz));
    }
    if (top < g.h - 2) g.set(x, top + 1, z, 'deepslate_tile_slab', { slab: 0 });
  }
}

// sculk over every floor and roof in a tile, in patches
let SOFT = null;
function drawSculk(g, o) {
  if (!SOFT) SOFT = new Set(['deepslate', 'cobbled_deepslate', 'deepslate_tiles', 'cracked_deepslate_tiles', 'polished_deepslate',
    'deepslate_bricks', 'cracked_deepslate_bricks', 'smooth_basalt', 'basalt', 'tuff', 'stone'].map(id));
  for (let x = 0; x < g.w; x++) for (let z = 0; z < g.d; z++) {
    const lx = o.lx + x, lz = o.lz + z;
    const n = vnoise(o.s, lx, lz, 8) * 0.65 + vnoise(o.s + 1, lx, lz, 3) * 0.35;
    if (n < 0.5) continue;
    for (let y = g.h - 2; y >= 0; y--) {
      if (!SOFT.has(g.get(x, y, z)) || g.get(x, y + 1, z) !== 0) continue;
      const k = h01(o.s + 2, lx, lz, y);
      if (n > 0.57) {
        g.set(x, y, z, k < 0.008 ? 'sculk_catalyst' : 'sculk');
        if (n > 0.64 && k > 0.97) g.set(x, y + 1, z, 'sculk_sensor');
        else if (n > 0.68 && k > 0.955 && k <= 0.97) g.set(x, y + 1, z, 'sculk_shrieker');
      } else if (k < 0.6) g.set(x, y + 1, z, 'sculk_vein');
    }
  }
}

/* --------------------------------------------------------------- plan -- */
const SIZES = {
  house: [[9, 9], [11, 9], [11, 11], [13, 11], [9, 11]],
  tower: [[7, 7]], icebox: [[7, 7]], court: [[11, 11]], tent: [[7, 9]], sauna: [[11, 9]],
};
const KINDS = [['house', 34], ['tower', 12], ['court', 12], ['tent', 16], ['sauna', 10], ['icebox', 3]];

PLANS.ancient_city = ctx => {
  const r = ctx.r, rot = ctx.point.rot & 3;
  const CX = ctx.point.x, CZ = ctx.point.z;
  const salt = r.nextInt(1 << 30);
  const out = [];
  // the city frame to the world
  const W = (lx, lz) => rot === 0 ? [CX + lx, CZ + lz] : rot === 1 ? [CX - lz, CZ + lx] : rot === 2 ? [CX - lx, CZ - lz] : [CX + lz, CZ - lx];
  // a box from its corner in the city frame (footprint after its own turn lrot)
  const add = (lx0, lz0, w, d, lrot, y0, h, draw, opts) => {
    const fw = lrot & 1 ? d : w, fd = lrot & 1 ? w : d;
    const [ax, az] = W(lx0, lz0), [bx, bz] = W(lx0 + fw - 1, lz0 + fd - 1);
    out.push(new Build(TYPE, Math.min(ax, bx), y0, Math.min(az, bz), w, h, d, (lrot + rot) & 3, draw, opts));
  };
  // the turn that points a building's door (its south side) towards f in the city frame
  const facing = f => (f - SOUTH + 4) & 3;

  // tiles over the cavern, each with its corner in the city frame
  const tiles = [];
  for (let x = -HX - 8; x <= HX + 8; x += 28) for (let z = -HZ - 8; z <= HZ + 8; z += 30)
    tiles.push([x, z, Math.min(28, HX + 8 - x + 1), Math.min(30, HZ + 8 - z + 1)]);
  for (const [x, z, w, d] of tiles) add(x, z, w, d, 0, F - 2, 38, drawCave, { s: salt, lx: x, lz: z });

  // the two chasms, north and south of the outer ring roads
  for (const zc of [-47, 35]) add(-34, zc, 69, 13, 0, F - 7, 9, drawChasm, { s: salt + 10, lx: -34, lz: zc, bx: 32 });

  // streets, cut into pieces
  const street = (x0, z0, x1, z1, along, posts) => {
    const step = 38;
    if (along === 'x') for (let x = x0; x <= x1; x += step) add(x, z0, Math.min(step, x1 - x + 1), z1 - z0 + 1, 0, F, 4, drawStreet, { s: salt + 20, lx: x, lz: z0, along, posts });
    else for (let z = z0; z <= z1; z += step) add(x0, z, x1 - x0 + 1, Math.min(step, z1 - z + 1), 0, F, 4, drawStreet, { s: salt + 20, lx: x0, lz: z, along, posts });
  };
  street(-HX + 2, -33, HX - 2, -29, 'x', false);
  street(-HX + 2, 29, HX - 2, 33, 'x', false);
  street(-43, -HZ + 2, -37, HZ - 2, 'z', false);
  street(37, -HZ + 2, 43, HZ - 2, 'z', false);
  street(-HX + 2, -3, HX - 2, 3, 'x', true);

  // the centre: platform, frame, towers, colonnades
  add(-22, -20, 45, 41, 0, F - 2, 9, drawPlatform, { s: salt + 30 });
  add(-1, -15, PW, 3, 1, F + 4, PH, drawPortal, { s: salt + 31 });
  for (const [tx, tz] of [[-19, -17], [13, -17], [-19, 11], [13, 11]])
    add(tx, tz, 7, 7, facing(tz < 0 ? SOUTH : NORTH), F + 3, 19 + r.nextInt(4), drawTower, { s: salt + 40 + tx * 3 + tz });
  for (const zc of [-27, 22]) add(-21, zc, 43, 6, 0, F, 8, drawColonnade, { s: salt + 50, lx: -21, lz: zc });

  // the quarters: rows of buildings, each row facing its street
  const rows = [];
  for (const [x0, x1] of [[-72, -45], [-35, -24], [24, 35], [45, 72]]) {
    rows.push([x0, x1, -27, -17, NORTH], [x0, x1, -15, -5, SOUTH], [x0, x1, 5, 15, NORTH], [x0, x1, 17, 27, SOUTH]);
  }
  for (const [x0, x1] of [[-72, -45], [45, 72]]) rows.push([x0, x1, -47, -35, SOUTH], [x0, x1, 35, 47, NORTH]);
  const ice = new Set();
  while (ice.size < 2) ice.add(r.nextInt(rows.length));
  const totalW = KINDS.reduce((a, k) => a + k[1], 0);
  let n = 0;
  rows.forEach(([x0, x1, z0, z1, face], ri) => {
    let x = x0 + r.nextInt(2), first = true;
    while (x <= x1) {
      let kind;
      if (first && ice.has(ri)) kind = 'icebox';
      else {
        let k = r.nextInt(totalW), i = 0;
        while (k >= KINDS[i][1]) k -= KINDS[i++][1];
        kind = KINDS[i][0];
      }
      let [w, d] = SIZES[kind][r.nextInt(SIZES[kind].length)];
      if (x + w - 1 > x1) {
        if (x + 6 > x1) break;
        kind = r.nextBoolean() ? 'tower' : 'tent';
        [w, d] = SIZES[kind][0];
      }
      first = false;
      const lrot = facing(face);
      const fd = lrot & 1 ? w : d;
      const lz0 = face === SOUTH ? z1 - fd + 1 : z0;
      const s = salt + 100 + n * 7;
      const nn = r.nextInt(1 << 16);
      switch (kind) {
        case 'house': {
          const H = 4 + r.nextInt(3), roof = r.nextFloat() < 0.4;
          add(x, lz0, w, d, lrot, F, H + 3, drawHouse, { s, H, roof, chest: r.nextFloat() < 0.55, skull: r.nextFloat() < 0.3, n: nn });
          break;
        }
        case 'tower': add(x, lz0, w, d, lrot, F, 11 + r.nextInt(6), drawTower, { s }); break;
        case 'icebox': add(x, lz0, w, d, lrot, F, 7, drawIceBox, { s }); break;
        case 'court': add(x, lz0, w, d, lrot, F, 5, drawCourt, { s, chest: r.nextFloat() < 0.7 }); break;
        case 'tent': add(x, lz0, w, d, lrot, F, 6, drawTent, { s, chest: r.nextFloat() < 0.8, n: nn }); break;
        case 'sauna': add(x, lz0, w, d, lrot, F, 6, drawSauna, { s, n: nn }); break;
      }
      n++;
      x += w + 2 + r.nextInt(2);
    }
  });

  // the city wall, with gates for the streets and the bridges
  const ns = [[-43, -37], [37, 43], [-2, 2]], ew = [[-3, 3], [-33, -29], [29, 33]];
  for (let x = -HX; x <= HX; x += 38) {
    const w = Math.min(38, HX - x + 1);
    add(x, -HZ, w, 2, 0, F, 12, drawWall, { s: salt + 60, lx: x, lz: -HZ, along: 'x', gates: ns });
    add(x, HZ - 1, w, 2, 0, F, 12, drawWall, { s: salt + 60, lx: x, lz: HZ - 1, along: 'x', gates: ns });
  }
  for (let z = -HZ + 2; z <= HZ - 2; z += 33) {
    const d = Math.min(33, HZ - 2 - z + 1);
    add(-HX, z, 2, d, 0, F, 12, drawWall, { s: salt + 60, lx: -HX, lz: z, along: 'z', gates: ew });
    add(HX - 1, z, 2, d, 0, F, 12, drawWall, { s: salt + 60, lx: HX - 1, lz: z, along: 'z', gates: ew });
  }

  // sculk over everything, last
  for (const [x, z, w, d] of tiles) add(x, z, w, d, 0, F - 7, 42, drawSculk, { s: salt + 70, lx: x, lz: z });
  return out;
};
