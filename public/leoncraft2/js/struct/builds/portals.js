/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: ruined portals, every variant.

   A ruined portal is a broken obsidian frame (some blocks missing, some
   turned to crying obsidian) with a little ruin of stone bricks round it,
   a loot chest, sometimes a gold block or a pool of lava, and netherrack
   and magma spread over the ground about it, thinning out with distance.

   The layouts: a frame standing on a stepped platform, one between two
   pillars under a broken arch, one fallen flat on the ground, one leaning
   with its top corner gone, one on a raised square of bricks, and, one
   time in twenty, a giant frame.

   The variants change where it sits and what it is made of:
     ruined_portal           on the ground, some moss on the bricks
     ruined_portal_desert    half buried in the sand
     ruined_portal_jungle    on the ground, mossy, hung with vines and leaves
     ruined_portal_swamp     partly sunk, mossy, vines
     ruined_portal_mountain  on the ground or sunk into the hillside
     ruined_portal_ocean     on the sea floor, flooded, magma instead of lava
     ruined_portal_nether    of blackstone, on a blackstone footing
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { footprint, rng } from './util.js?v=107';

export const PLANS = {};

const VARIANTS = {
  ruined_portal: { sink: [0, 0], moss: 0.2 },
  ruined_portal_desert: { sink: [2, 4], moss: 0, sand: true },
  ruined_portal_jungle: { sink: [0, 0], moss: 0.45, vines: true, leaves: true },
  ruined_portal_swamp: { sink: [1, 2], moss: 0.5, vines: true },
  ruined_portal_mountain: { sink: [0, 3], moss: 0.15 },
  ruined_portal_ocean: { sink: [0, 1], moss: 0.3, ocean: true },
  ruined_portal_nether: { sink: [0, 0], moss: 0, nether: true },
};
// box sizes (w across the frame, d deep) per layout
const SIZE = { standing: [8, 6], arch: [10, 5], fallen: [8, 9], leaning: [8, 7], platform: [9, 9], giant: [11, 7] };
const LAYOUTS = ['standing', 'standing', 'arch', 'fallen', 'leaning', 'platform'];

for (const t of Object.keys(VARIANTS)) PLANS[t] = ctx => portal(ctx, t);

function portal(ctx, type) {
  const V = VARIANTS[type], r = ctx.r;
  const layout = r.nextFloat() < 0.05 ? 'giant' : LAYOUTS[r.nextInt(LAYOUTS.length)];
  const rot = r.nextInt(4);
  const [w, d] = SIZE[layout];
  const W = rot & 1 ? d : w, D = rot & 1 ? w : d;
  const cx = ctx.x0 + 8, cz = ctx.z0 + 8;
  const x = cx - (W >> 1), z = cz - (D >> 1);
  let y;
  if (V.nether) y = ctx.point.y;
  else {
    const fp = footprint(ctx, x, z, W, D);
    y = V.ocean ? fp.med : Math.max(fp.med, 62);
    if (V.sink[1] > 0) y -= r.between(V.sink[0], V.sink[1]);
  }
  const seed = (cx * 73428767) ^ (cz * 912931) ^ (y * 4127) ^ rot;
  const o = { V, layout, y, seed, gold: r.nextFloat() < 0.35, lava: !V.nether && r.nextFloat() < 0.4 };
  const out = [];
  // the netherrack spread over the ground round it, measured now
  if (!V.nether) {
    const S = 17, sx = cx - 8, sz = cz - 8;
    const hs = new Array(S * S);
    let lo = 999;
    for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) { const h = ctx.ground(sx + i, sz + j); hs[i * S + j] = h; if (h < lo) lo = h; }
    out.push(new Build(type, sx, lo, sz, S, 4, S, 0, drawSpread, { hs, lo, seed: seed ^ 0x5bd1e995, ocean: !!V.ocean, sand: !!V.sand }));
  }
  out.push(new Build(type, x, y - 3, z, w, 16, d, rot, drawPortal, o));
  return out;
}

function drawSpread(g, o) {
  const R = rng(o.seed), S = g.w, c = (S - 1) / 2;
  for (let i = 0; i < S; i++) for (let j = 0; j < S; j++) {
    const roll = R.nextFloat(), roll2 = R.nextFloat();
    const dist = Math.hypot(i - c, j - c);
    if (roll > 0.85 - dist * 0.11) continue;
    const h = o.hs[i * S + j], ly = h - o.lo;
    const top = g.get(i, ly, j);
    if (!top) continue;
    g.set(i, ly, j, roll2 < 0.12 ? 'magma_block' : o.sand && roll2 > 0.7 ? 'sand' : 'netherrack');
  }
}

function drawPortal(g, o) {
  const V = o.V, R = rng(o.seed), b = 3;
  const wy = ly => o.y - b + ly;
  const open = ly => (V.ocean || (wy(ly) <= 62 && V.ocean) ? 'water' : 'air');
  const brick = () => {
    if (V.nether) { const f = R.nextFloat(); return f < 0.5 ? 'polished_blackstone_bricks' : f < 0.75 ? 'cracked_polished_blackstone_bricks' : f < 0.9 ? 'blackstone' : 'gilded_blackstone'; }
    const f = R.nextFloat();
    return f < V.moss ? 'mossy_stone_bricks' : f < V.moss + 0.2 ? 'cracked_stone_bricks' : 'stone_bricks';
  };
  const stairs = V.nether ? 'polished_blackstone_brick_stairs' : R.nextFloat() < V.moss ? 'mossy_stone_brick_stairs' : 'stone_brick_stairs';
  const slab = V.nether ? 'polished_blackstone_brick_slab' : 'stone_brick_slab';
  const obsidian = solid => {
    const f = R.nextFloat();
    if (!solid && f < 0.16) return null;
    return f > 0.86 ? 'crying_obsidian' : 'obsidian';
  };
  const lava = V.ocean ? 'magma_block' : 'lava';
  // an upright frame in the plane z = fz, from x0, bottom at y0, inside iw x ih
  const frame = (x0, y0, fz, iw, ih, broken) => {
    for (let x = x0; x <= x0 + iw + 1; x++) for (let y = y0; y <= y0 + ih + 1; y++) {
      const edge = x === x0 || x === x0 + iw + 1 || y === y0 || y === y0 + ih + 1;
      if (!edge) { g.set(x, y, fz, open(y)); continue; }
      const foot = y === y0;
      if (broken && x >= x0 + iw && y >= y0 + ih - 1) { g.set(x, y, fz, open(y)); continue; }
      const blk = obsidian(foot);
      g.set(x, y, fz, blk || open(y));
    }
  };
  const clear = (x0, y0, z0, x1, y1, z1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) g.set(x, y, z, open(y)); };
  const footing = (x0, z0, x1, z1, ly, name) => { for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { g.set(x, ly, z, name || brick()); g.down(x, ly - 1, z, V.nether ? 'blackstone' : V.sand ? 'sandstone' : 'cobblestone'); } };
  const W = g.w, D = g.d;

  switch (o.layout) {
    case 'standing': {
      clear(0, b + 1, 0, W - 1, b + 7, D - 1);
      footing(1, 1, 6, 4, b);
      for (let x = 0; x <= 7; x++) { g.set(x, b, 0, stairs, { f: SOUTH }); g.set(x, b, 5, stairs, { f: NORTH }); }
      for (let z = 1; z <= 4; z++) { g.set(0, b, z, stairs, { f: EAST }); g.set(7, b, z, stairs, { f: WEST }); }
      frame(2, b + 1, 2, 2, 3, false);
      g.set(1, b + 1, 3, slab, { slab: 0 });
      g.set(6, b + 1, 1, brick()); g.set(6, b + 2, 1, slab, { slab: 0 });
      if (o.gold) g.set(1, b + 1, 1, 'gold_block');
      g.chest(5, b + 1, 4, 'ruined_portal', WEST);
      break;
    }
    case 'arch': {
      clear(0, b + 1, 0, W - 1, b + 9, D - 1);
      footing(0, 1, 9, 3, b);
      // two pillars and what is left of the arch over them
      for (const px of [0, 9]) for (let y = 1; y <= 6; y++) g.set(px, b + y, 2, brick());
      for (let x = 0; x <= 3; x++) g.set(x, b + 7, 2, brick());
      g.set(8, b + 7, 2, brick()); g.set(9, b + 7, 2, brick());
      g.set(4, b + 7, 2, stairs, { f: WEST, top: true });
      g.set(7, b + 7, 2, stairs, { f: EAST, top: true });
      frame(3, b + 1, 2, 2, 3, R.nextFloat() < 0.4);
      g.set(1, b + 1, 1, stairs, { f: SOUTH }); g.set(8, b + 1, 3, stairs, { f: NORTH });
      if (o.gold) g.set(9, b + 8, 2, 'gold_block');
      if (o.lava) { g.set(1, b, 4, lava); g.set(2, b, 4, lava); }
      g.chest(8, b + 1, 1, 'ruined_portal', SOUTH);
      break;
    }
    case 'fallen': {
      clear(0, b + 1, 0, W - 1, b + 4, D - 1);
      // the frame lying flat on the ground, stone bricks it broke off scattered round
      for (let x = 1; x <= 4; x++) for (let z = 1; z <= 7; z++) {
        const edge = x === 1 || x === 4 || z === 1 || z === 7;
        if (edge) { const blk = obsidian(false); if (blk) g.set(x, b, z, blk); }
        else g.set(x, b, z, R.nextFloat() < 0.5 ? 'netherrack' : brick());
      }
      for (const [x, z] of [[6, 2], [6, 3], [7, 6], [5, 7], [0, 4]]) g.set(x, b, z, brick());
      g.set(6, b + 1, 2, slab, { slab: 0 });
      g.set(6, b + 1, 6, 'obsidian');
      if (o.lava) { g.set(6, b, 4, lava); g.set(6, b, 5, lava); g.set(7, b, 5, lava); }
      if (o.gold) g.set(5, b, 1, 'gold_block');
      g.chest(7, b + 1, 7, 'ruined_portal', NORTH);
      break;
    }
    case 'leaning': {
      clear(0, b + 1, 0, W - 1, b + 7, D - 1);
      footing(1, 2, 6, 4, b);
      frame(1, b + 1, 3, 2, 3, true);
      // the fallen corner on the ground in front
      g.set(5, b + 1, 1, 'obsidian'); g.set(6, b + 1, 1, 'crying_obsidian'); g.set(4, b + 1, 0, 'obsidian');
      g.set(6, b + 1, 4, brick()); g.set(6, b + 2, 4, brick()); g.set(6, b + 3, 4, stairs, { f: WEST });
      g.set(0, b + 1, 4, stairs, { f: EAST });
      if (o.lava) { g.set(7, b, 6, lava); g.set(6, b, 6, lava); }
      if (o.gold) g.set(1, b + 1, 4, 'gold_block');
      g.chest(5, b + 1, 5, 'ruined_portal', NORTH);
      break;
    }
    case 'platform': {
      clear(0, b + 1, 0, W - 1, b + 8, D - 1);
      footing(1, 1, 7, 7, b);
      footing(2, 2, 6, 6, b + 1);
      for (let x = 1; x <= 7; x++) { g.set(x, b + 1, 1, stairs, { f: SOUTH }); g.set(x, b + 1, 7, stairs, { f: NORTH }); }
      for (let z = 2; z <= 6; z++) { g.set(1, b + 1, z, stairs, { f: EAST }); g.set(7, b + 1, z, stairs, { f: WEST }); }
      frame(3, b + 2, 4, 2, 3, false);
      for (const [x, z] of [[2, 2], [6, 2], [2, 6], [6, 6]]) { g.set(x, b + 2, z, brick()); if (R.nextFloat() < 0.6) g.set(x, b + 3, z, brick()); }
      if (o.gold) g.set(6, b + 4, 6, 'gold_block');
      if (o.lava) { g.set(0, b, 0, lava); g.set(8, b, 8, lava); }
      g.chest(5, b + 2, 3, 'ruined_portal', NORTH);
      break;
    }
    default: {
      // the giant frame: 6 x 9 inside, on a long footing with a pillar at each side
      clear(0, b + 1, 0, W - 1, b + 12, D - 1);
      footing(0, 2, 10, 4, b);
      frame(1, b + 1, 3, 6, 9, false);
      for (const px of [0, 10]) for (let y = 1; y <= 5 + R.nextInt(5); y++) g.set(px, b + y, 3, brick());
      for (let x = 0; x <= 10; x++) { g.set(x, b, 1, stairs, { f: SOUTH }); g.set(x, b, 5, stairs, { f: NORTH }); }
      if (o.gold) { g.set(9, b + 1, 4, 'gold_block'); g.set(1, b + 1, 2, 'gold_block'); }
      if (o.lava) g.set(9, b, 6, lava);
      g.chest(9, b + 1, 2, 'ruined_portal', SOUTH);
    }
  }
  // the jungle and swamp ones are overgrown
  if (V.vines || V.leaves) {
    for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
      for (let y = b + 1; y < b + 12; y++) {
        const roll = R.nextFloat();
        if (!g.is(x, y, z, 'air')) continue;
        const above = g.get(x, y + 1, z);
        if (V.leaves && roll < 0.35 && above && !g.is(x, y + 1, z, 'air') && g.is(x, y - 1, z, 'air') === false && y > b + 2) g.set(x, y, z, 'jungle_leaves');
        else if (V.vines && roll < 0.25 && (g.get(x + 1, y, z) || g.get(x - 1, y, z) || g.get(x, y, z + 1) || g.get(x, y, z - 1))) g.set(x, y, z, 'vine');
      }
    }
  }
}
