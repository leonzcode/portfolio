/* ---------------------------------------------------------------------------
   Leoncraft 2 - structures: the small ones. The desert pyramid, the jungle
   temple, the swamp hut, the igloo, the pillager outpost, buried treasure
   and the abandoned camps.

   Desert pyramid: 21 x 21, a stepped sandstone shell rising nine levels
   over one big hall, two towers at the front corners with orange and blue
   terracotta faces, the entrance between them and doorways in the sides.
   The hall floor has the orange terracotta star round a blue block; under
   the blue block a narrow shaft drops into the hidden room: four chests in
   alcoves and a stone pressure plate over nine TNT.

   Jungle temple: 12 x 15 of cobblestone and moss, a ground hall, an upper
   room and roof, and a basement with the tripwire corridor (two
   dispensers of arrows), the lever wall, and two chests, one at the end of
   the trap and one walled up behind the levers.

   Swamp hut: 7 x 9 of spruce on oak log stilts down to the swamp bed, a
   porch, a cauldron, a crafting table and a potted mushroom; a witch and
   her black cat.

   Igloo: a snow block dome with an entrance tunnel and ice windows, a bed,
   furnace and crafting table on a carpet; half the time a trapdoor under
   the carpet and a ladder down to the stone brick basement: brewing stand,
   cauldron, the chest, and two cells (a villager and a zombie villager).

   Pillager outpost: the dark oak and birch watchtower on its cobblestone
   foot, four storeys with ladders, the open top under a slab roof with
   the loot chest; round it a golem cage, a target dummy and a tent.

   Buried treasure: one chest in sand a few blocks under the beach, at the
   spot /locate gives (the start chunk's corner + 9).

   Abandoned camps (26.x): a wool tent in the biome's colour, its wood for
   the logs and benches, a campfire, a bedroll, and a chest or barrel.
--------------------------------------------------------------------------- */
import { Build, NORTH, EAST, SOUTH, WEST } from '../build.js?v=107';
import { footprint, surfacePrint, door, bed, torch, make, rng, weather, DX, DZ } from './util.js?v=107';
import { blockPosLong } from '../rand.js?v=107';

export const PLANS = {};

// a block that holds loot without being a chest (dispensers): placed, then the loot noted for the game
function container(g, x, y, z, block, state, table) {
  g.set(x, y, z, block, state);
  if (!g.inside(x, y, z)) return;
  const [X, Y, Z] = g.world(x, y, z);
  g.wr.chest(X, Y, Z, table, (X * 3129871) ^ (Z * 116129781) ^ Y);
}
// a suspicious block and the archaeology table it holds; its loot seed is its place as a long, as the game gives a
// desert pyramid's (BlockPos.asLong)
function find(g, x, y, z, block, table) {
  g.set(x, y, z, block);
  if (!g.inside(x, y, z)) return;
  const [X, Y, Z] = g.world(x, y, z);
  g.wr.chest(X, Y, Z, table, blockPosLong(X, Y, Z));
}
// the corner and turn for a w x d design at the start chunk's corner, turned at random
// the top of the sea: 62, or a Superflat world's far lower one (struct/starts.js ctx.sea)
const sea1 = ctx => (ctx.sea !== undefined ? ctx.sea : 63) - 1;
function atCorner(ctx, w, d) {
  const rot = ctx.r.nextInt(4);
  const W = rot & 1 ? d : w, D = rot & 1 ? w : d;
  return { rot, x: ctx.x0, z: ctx.z0, W, D };
}
// the lowest of a footprint's four corners (the check the game makes for these)
function lowestCorner(ctx, x, z, W, D) {
  return Math.min(ctx.ground(x, z), ctx.ground(x + W - 1, z), ctx.ground(x, z + D - 1), ctx.ground(x + W - 1, z + D - 1));
}

/* ==================================================== desert pyramid == */
PLANS.desert_pyramid = ctx => {
  const { rot, x, z, W, D } = atCorner(ctx, 21, 21);
  const y = Math.max(lowestCorner(ctx, x, z, W, D), sea1(ctx));
  // the box runs from 16 under the floor (the hidden room and its TNT) to the tower tops
  return [new Build('desert_pyramid', x, y - 16, z, 21, 30, 21, rot, drawPyramid, { b: 16 })];
};
function drawPyramid(g, o) {
  const b = o.b;
  // the floor and the foundation under it
  g.fill(0, b - 4, 0, 20, b, 20, 'sandstone');
  for (let x = 0; x < 21; x++) for (let z = 0; z < 21; z++) g.down(x, b - 5, z, 'sandstone');
  g.air(0, b + 1, 0, 20, b + 13, 20);
  // the stepped shell, hollow inside
  for (let i = 1; i <= 9; i++) {
    g.fill(i, b + i, i, 20 - i, b + i, 20 - i, 'sandstone');
    if (i < 9) g.air(i + 1, b + i, i + 1, 19 - i, b + i, 19 - i);
  }
  // the walls of the lower hall stand straight up to the fourth level
  for (let y = 1; y <= 4; y++) {
    g.hollow(4, b + y, 4, 16, b + y, 16, 'sandstone', 'air');
  }
  g.air(5, b + 1, 5, 15, b + 8, 15);
  for (let i = 5; i <= 8; i++) { g.fill(i, b + i, i, 20 - i, b + i, 20 - i, 'sandstone'); if (i < 9) g.air(i + 1, b + i, i + 1, 19 - i, b + i, 19 - i); }
  // a band of cut sandstone and orange terracotta round the hall
  for (let x = 5; x <= 15; x++) { g.set(x, b + 3, 4, 'cut_sandstone'); g.set(x, b + 3, 16, 'cut_sandstone'); }
  for (let z = 5; z <= 15; z++) { g.set(4, b + 3, z, 'cut_sandstone'); g.set(16, b + 3, z, 'cut_sandstone'); }
  for (const x of [6, 10, 14]) { g.set(x, b + 2, 16, 'orange_terracotta'); g.set(x, b + 2, 4, 'orange_terracotta'); }
  for (const z of [6, 10, 14]) { g.set(4, b + 2, z, 'orange_terracotta'); g.set(16, b + 2, z, 'orange_terracotta'); }
  // pillars in the hall
  for (const [px, pz] of [[7, 7], [13, 7], [7, 13], [13, 13]]) g.fill(px, b + 1, pz, px, b + 4, pz, 'cut_sandstone');
  // the floor star: orange terracotta round a blue centre
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [0, -2], [0, 2], [-2, 0], [2, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) g.set(10 + dx, b, 10 + dz, 'orange_terracotta');
  g.set(10, b, 10, 'blue_terracotta');

  // the two towers at the front corners
  for (const tx of [0, 16]) {
    g.fill(tx, b + 1, 0, tx + 4, b + 10, 4, 'sandstone');
    g.air(tx + 1, b + 1, 1, tx + 3, b + 10, 3);
    g.fill(tx, b + 10, 0, tx + 4, b + 10, 4, 'cut_sandstone');
    g.air(tx + 1, b + 10, 1, tx + 3, b + 10, 3);
    for (let x = tx; x <= tx + 4; x++) for (const z of [0, 4]) if ((x - tx) % 2 === 0) g.set(x, b + 11, z, 'sandstone_slab', { slab: 0 });
    for (const zz of [1, 2, 3]) { g.set(tx, b + 11, zz, (zz & 1) ? 'sandstone_slab' : 'air', { slab: 0 }); g.set(tx + 4, b + 11, zz, (zz & 1) ? 'sandstone_slab' : 'air', { slab: 0 }); }
    // the face on the front: terracotta in a column with the blue eye
    for (let y = 3; y <= 8; y++) g.set(tx + 2, b + y, 0, y === 6 ? 'blue_terracotta' : 'orange_terracotta');
    g.set(tx + 1, b + 6, 0, 'orange_terracotta'); g.set(tx + 3, b + 6, 0, 'orange_terracotta');
    g.set(tx + 2, b + 9, 0, 'chiseled_sandstone');
    // a ladder up the inside and a way into the hall
    for (let y = 1; y <= 9; y++) g.set(tx + 2, b + y, 3, 'ladder', { f: NORTH });
    const inner = tx === 0 ? 4 : 16;
    g.air(inner, b + 1, 2, inner, b + 2, 2);
    g.air(tx === 0 ? 4 : 16, b + 1, 3, tx === 0 ? 4 : 16, b + 2, 3);
  }
  // the entrance between the towers and the passage into the hall
  g.fill(7, b + 1, 0, 13, b + 6, 4, 'sandstone');
  g.fill(7, b + 6, 0, 13, b + 6, 0, 'cut_sandstone');
  for (let x = 7; x <= 13; x++) g.set(x, b + 7, 0, (x & 1) ? 'sandstone_stairs' : 'cut_sandstone', { f: SOUTH });
  g.air(9, b + 1, 0, 11, b + 3, 4);
  g.set(8, b + 4, 0, 'chiseled_sandstone'); g.set(12, b + 4, 0, 'chiseled_sandstone');
  g.set(10, b + 5, 0, 'orange_terracotta');
  // the doorways in the sides
  for (const sx of [0, 1, 2, 3, 4]) { g.air(sx, b + 1, 10, sx, b + 2, 10); g.air(20 - sx, b + 1, 10, 20 - sx, b + 2, 10); }
  g.set(0, b + 3, 10, 'chiseled_sandstone'); g.set(20, b + 3, 10, 'chiseled_sandstone');

  // the hidden room: a shaft under the blue block into a sandstone room with four chests and a trap
  g.fill(7, b - 15, 7, 13, b - 1, 13, 'sandstone');
  g.air(10, b - 10, 10, 10, b - 1, 10);
  g.air(9, b - 13, 9, 11, b - 11, 11);
  for (const [ax, az] of [[10, 8], [10, 12], [8, 10], [12, 10]]) g.air(ax, b - 13, az, ax, b - 12, az);
  g.fill(9, b - 15, 9, 11, b - 15, 11, 'tnt');
  g.set(10, b - 13, 10, 'stone_pressure_plate');
  for (const [cx, cz] of [[9, 9], [11, 9], [9, 11], [11, 11]]) find(g, cx, b - 14, cz, 'suspicious_sand', 'archaeology/desert_pyramid');
  g.set(10, b - 11, 8, 'chiseled_sandstone'); g.set(10, b - 11, 12, 'chiseled_sandstone');
  g.set(8, b - 11, 10, 'chiseled_sandstone'); g.set(12, b - 11, 10, 'chiseled_sandstone');
  g.chest(10, b - 13, 8, 'desert_pyramid', SOUTH);
  g.chest(10, b - 13, 12, 'desert_pyramid', NORTH);
  g.chest(8, b - 13, 10, 'desert_pyramid', EAST);
  g.chest(12, b - 13, 10, 'desert_pyramid', WEST);
}

/* ===================================================== jungle temple == */
PLANS.jungle_pyramid = ctx => {
  const { rot, x, z, W, D } = atCorner(ctx, 12, 15);
  const fp = footprint(ctx, x, z, W, D, 2);
  const y = Math.max(fp.min, sea1(ctx));
  return [new Build('jungle_pyramid', x, y - 5, z, 12, 16, 15, rot, drawJungle, { b: 5, seed: x * 31 + z })];
};
function drawJungle(g, o) {
  const b = o.b, R = rng(o.seed);
  const cob = () => (R.nextFloat() < 0.4 ? 'mossy_cobblestone' : 'cobblestone');
  const fillC = (x0, y0, z0, x1, y1, z1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) g.set(x, b + y, z, cob()); };
  const shell = (x0, y0, z0, x1, y1, z1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const e = x === x0 || x === x1 || z === z0 || z === z1 || y === y0 || y === y1;
      g.set(x, b + y, z, e ? cob() : 'air');
    }
  };
  // foundation, basement and the ground floor body
  for (let x = 0; x < 12; x++) for (let z = 0; z < 15; z++) g.down(x, b - 5, z, 'cobblestone');
  g.air(0, b + 1, 0, 11, b + 10, 14);
  shell(0, -4, 0, 11, 4, 14);
  fillC(1, 0, 1, 10, 0, 13);                      // the ground floor over the basement
  // the upper room and the roof
  shell(2, 4, 2, 9, 8, 12);
  fillC(3, 9, 3, 8, 9, 11);
  for (let x = 3; x <= 8; x++) { g.set(x, b + 10, 3, 'cobblestone_stairs', { f: SOUTH }); g.set(x, b + 10, 11, 'cobblestone_stairs', { f: NORTH }); }
  for (let z = 4; z <= 10; z++) { g.set(3, b + 10, z, 'cobblestone_stairs', { f: EAST }); g.set(8, b + 10, z, 'cobblestone_stairs', { f: WEST }); }
  g.fill(4, b + 10, 4, 7, b + 10, 10, 'mossy_cobblestone');
  // stairs round the lower roof
  for (let x = 0; x <= 11; x++) { g.set(x, b + 5, 0, 'cobblestone_stairs', { f: SOUTH }); g.set(x, b + 5, 14, 'cobblestone_stairs', { f: NORTH }); }
  for (let z = 1; z <= 13; z++) { g.set(0, b + 5, z, 'cobblestone_stairs', { f: EAST }); g.set(11, b + 5, z, 'cobblestone_stairs', { f: WEST }); }
  for (let x = 1; x <= 10; x++) for (let z = 1; z <= 13; z++) if (x < 2 || x > 9 || z < 2 || z > 12) g.set(x, b + 5, z, cob());
  // the entrance: steps up to a doorway two wide, and windows
  g.air(5, b + 1, 0, 6, b + 3, 0);
  g.set(5, b + 4, 0, 'chiseled_stone_bricks'); g.set(6, b + 4, 0, 'chiseled_stone_bricks');
  for (const z of [3, 6, 9, 12]) { g.air(0, b + 2, z, 0, b + 2, z); g.air(11, b + 2, z, 11, b + 2, z); }
  for (const x of [2, 9]) g.air(x, b + 2, 0, x, b + 2, 0);
  g.air(5, b + 6, 2, 6, b + 7, 2);
  for (const z of [5, 9]) { g.air(2, b + 6, z, 2, b + 6, z); g.air(9, b + 6, z, 9, b + 6, z); }
  // pillars in the hall and the stair up to the upper room
  for (const [px, pz] of [[3, 4], [8, 4], [3, 10], [8, 10]]) for (let y = 1; y <= 3; y++) g.set(px, b + y, pz, y === 2 ? 'chiseled_stone_bricks' : cob());
  g.air(4, b + 4, 7, 7, b + 4, 8);
  g.set(4, b + 1, 8, 'cobblestone_stairs', { f: EAST }); g.set(5, b + 2, 8, 'cobblestone_stairs', { f: EAST });
  g.set(6, b + 3, 8, 'cobblestone_stairs', { f: EAST }); g.set(7, b + 4, 8, 'cobblestone_stairs', { f: EAST });
  g.set(4, b + 1, 7, 'cobblestone_stairs', { f: EAST }); g.set(5, b + 2, 7, 'cobblestone_stairs', { f: EAST });
  g.set(6, b + 3, 7, 'cobblestone_stairs', { f: EAST }); g.set(7, b + 4, 7, 'cobblestone_stairs', { f: EAST });

  // the stair down to the basement at the back right
  g.air(9, b, 9, 10, b, 13);
  for (let i = 0; i < 4; i++) { g.set(9, b - i, 12 - i, 'cobblestone_stairs', { f: SOUTH }); g.set(10, b - i, 12 - i, 'cobblestone_stairs', { f: SOUTH }); g.air(9, b - i + 1, 12 - i, 10, b - i + 3, 12 - i); }
  // the basement: a hall, the trapped corridor down the left and the lever room at the back
  g.air(5, b - 3, 2, 10, b - 1, 8);
  g.air(1, b - 3, 1, 2, b - 1, 13);
  g.air(3, b - 3, 12, 8, b - 1, 13);
  g.air(3, b - 3, 2, 4, b - 1, 3);
  // the corridor trap: a string across the way between two hooks in the walls, and in the wall over the
  // west hook's block a dispenser that fires across at head height when the string is tripped (sim/tripwire.js)
  g.set(1, b - 3, 10, 'tripwire_hook', { f: EAST });
  g.set(2, b - 3, 10, 'tripwire');
  g.set(3, b - 3, 10, 'tripwire_hook', { f: WEST });
  container(g, 0, b - 2, 10, 'dispenser', { f: EAST }, 'jungle_temple_dispenser');
  g.set(2, b - 3, 2, 'vine');
  // the second trap at the foot of the stair, the same way round
  g.set(8, b - 3, 9, 'tripwire_hook', { f: EAST });
  g.set(9, b - 3, 9, 'tripwire');
  g.set(10, b - 3, 9, 'tripwire_hook', { f: WEST });
  container(g, 7, b - 2, 9, 'dispenser', { f: EAST }, 'jungle_temple_dispenser');
  // the lever puzzle on the back wall: three levers, a sticky piston and its wire
  g.fill(3, b - 3, 14, 8, b - 1, 14, 'cobblestone');
  for (const lx of [4, 5, 6]) g.set(lx, b - 2, 13, 'lever', { f: NORTH });
  g.set(7, b - 3, 13, 'sticky_piston', { up: true });
  g.set(8, b - 3, 12, 'redstone_wire');
  // the chests: one at the end of the corridor, one walled up beside the lever room
  g.fill(9, b - 3, 10, 10, b - 1, 11, 'cobblestone');
  g.air(10, b - 3, 11, 10, b - 3, 11);
  g.chest(1, b - 3, 13, 'jungle_temple', EAST);
  g.chest(10, b - 3, 11, 'jungle_temple', NORTH);
  // vines hanging inside the hall, on the walls
  for (let i = 0; i < 14; i++) {
    const side = R.nextInt(4), t = 1 + R.nextInt(side & 1 ? 13 : 10), h = 2 + R.nextInt(3);
    const [vx, vz] = side === 0 ? [t, 1] : side === 1 ? [10, t] : side === 2 ? [t, 13] : [1, t];
    for (let y = h; y <= 4; y++) if (g.is(vx, b + y, vz, 'air')) g.set(vx, b + y, vz, 'vine');
  }
}

/* ========================================================== swamp hut == */
PLANS.swamp_hut = ctx => {
  const rot = ctx.r.nextInt(4);
  const W = rot & 1 ? 9 : 7, D = rot & 1 ? 7 : 9;
  const x = ctx.x0, z = ctx.z0;
  const fp = surfacePrint(ctx, x, z, W, D);
  // the floor stands a couple of blocks over the water or mud
  const y = fp.mean + 2;
  return [new Build('swamp_hut', x, y, z, 7, 8, 9, rot, drawHut, {})];
};
function drawHut(g) {
  // floor and walls of spruce, a porch at the front (z 0..1)
  g.air(0, 1, 0, 6, 7, 8);
  g.fill(1, 0, 1, 5, 0, 7, 'spruce_planks');
  for (let y = 1; y <= 3; y++) g.hollow(1, y, 2, 5, y, 7, 'spruce_planks', 'air');
  g.air(2, 1, 3, 4, 3, 6);
  // the corner posts of oak log run down to the bottom of the swamp
  for (const [x, z] of [[1, 2], [5, 2], [1, 7], [5, 7]]) { g.fill(x, 1, z, x, 3, z, 'oak_log', { axis: 'y' }); g.down(x, 0, z, 'oak_log'); g.set(x, 0, z, 'oak_log', { axis: 'y' }); }
  for (const [x, z] of [[1, 1], [5, 1]]) { g.down(x, -1, z, 'oak_log'); g.set(x, 0, z, 'oak_log', { axis: 'y' }); g.set(x, 1, z, 'oak_fence'); g.set(x, 2, z, 'oak_fence'); }
  // door opening, windows with fences
  g.air(3, 1, 2, 3, 2, 2);
  g.set(1, 2, 4, 'air'); g.set(1, 2, 5, 'air'); g.set(5, 2, 4, 'air'); g.set(5, 2, 5, 'air');
  g.set(3, 2, 7, 'air');
  // the roof: spruce stairs round the edge, planks between
  for (let x = 0; x <= 6; x++) { g.set(x, 4, 1, 'spruce_stairs', { f: SOUTH }); g.set(x, 4, 8, 'spruce_stairs', { f: NORTH }); }
  for (let z = 2; z <= 7; z++) { g.set(0, 4, z, 'spruce_stairs', { f: EAST }); g.set(6, 4, z, 'spruce_stairs', { f: WEST }); }
  g.fill(1, 4, 2, 5, 4, 7, 'spruce_planks');
  g.fill(1, 4, 1, 5, 4, 1, 'spruce_stairs', { f: SOUTH });
  // inside: crafting table, cauldron, the potted mushroom on the sill
  g.set(3, 1, 6, 'crafting_table');
  g.set(4, 1, 6, 'cauldron');
  g.set(1, 3, 5, 'potted_red_mushroom');
  g.set(2, 1, 6, 'oak_fence');
  g.entity('witch', 3, 1, 4, {});
  g.entity('cat', 2, 1, 4, { variant: 'all_black' });
}

/* ============================================================== igloo == */
PLANS.igloo = ctx => {
  const rot = ctx.r.nextInt(4);
  const basement = ctx.r.nextFloat() < 0.5;
  const depth = basement ? 3 * ctx.r.between(4, 8) : 0;
  const W = rot & 1 ? 11 : 9, D = rot & 1 ? 9 : 11;
  const x = ctx.x0 + 3, z = ctx.z0 + 3;
  const fp = footprint(ctx, x + 1, z + 3, W - 2, D - 4);
  const y = Math.max(fp.med, sea1(ctx));
  const lab = basement ? 8 : 0;
  return [new Build('igloo', x, y - depth - lab, z, 9, depth + lab + 8, 11, rot, drawIgloo, { b: depth + lab, depth, basement })];
};
function drawIgloo(g, o) {
  const b = o.b;
  const cx = 4, cz = 6;
  // ground under the dome
  for (let x = 0; x < 9; x++) for (let z = 2; z < 11; z++) {
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz <= 18) { g.set(x, b, z, 'snow_block'); g.down(x, b - 1, z, 'snow_block'); }
  }
  // the dome: a shell of snow blocks over a round room
  for (let y = 1; y <= 5; y++) for (let x = 0; x < 9; x++) for (let z = 2; z < 11; z++) {
    const dx = x - cx, dz = z - cz, dy = y - 0.5;
    const out = dx * dx / 18.5 + dz * dz / 18.5 + dy * dy / 21;
    const inn = dx * dx / 8.5 + dz * dz / 8.5 + dy * dy / 12;
    if (out <= 1 && inn > 1) g.set(x, b + y, z, 'snow_block');
    else if (inn <= 1) g.set(x, b + y, z, 'air');
  }
  // the entrance tunnel at the front
  for (let z = 0; z <= 2; z++) { g.fill(3, b + 1, z, 5, b + 3, z, 'snow_block'); g.air(4, b + 1, z, 4, b + 2, z); g.set(3, b, z, 'snow_block'); g.set(4, b, z, 'snow_block'); g.set(5, b, z, 'snow_block'); }
  g.air(4, b + 1, 3, 4, b + 2, 3);
  // ice windows in the sides
  g.set(0, b + 2, 6, 'ice'); g.set(8, b + 2, 6, 'ice');
  // inside: carpet, bed, furnace, crafting table, a redstone torch
  g.fill(2, b, 4, 6, b, 9, 'snow_block');
  g.fill(2, b + 1, 4, 6, b + 1, 9, 'white_carpet');
  bed(g, 2, b + 1, 8, 'red', SOUTH);
  g.set(6, b + 1, 8, 'furnace', { f: WEST });
  g.set(6, b + 1, 9, 'crafting_table');
  g.set(6, b + 1, 4, 'air');
  g.set(6, b + 1, 4, 'redstone_torch');
  if (!o.basement) return;
  // the trapdoor under the carpet, and the ladder shaft down
  const top = b, bot = b - o.depth;
  g.set(4, b, 6, 'oak_trapdoor', { top: true });
  g.set(4, b + 1, 6, 'white_carpet');
  for (let y = bot; y < top; y++) {
    for (const [x, z] of [[3, 6], [5, 6], [4, 5], [4, 7]]) g.set(x, y, z, 'stone_bricks');
    g.set(4, y, 6, 'ladder', { f: SOUTH });
  }
  // the lab: stone bricks with a chest, brewing stand, cauldron and two cells
  const ly = bot - 4;
  g.fill(0, ly - 1, 2, 8, bot, 10, 'stone_bricks');
  g.air(1, ly, 3, 7, ly + 3, 9);
  g.set(4, bot, 6, 'ladder', { f: SOUTH });
  g.set(4, bot - 1, 6, 'ladder', { f: SOUTH });
  g.set(4, bot - 2, 6, 'ladder', { f: SOUTH });
  g.set(4, bot - 3, 6, 'ladder', { f: SOUTH });
  g.set(4, bot - 1, 7, 'stone_bricks'); g.set(4, bot - 2, 7, 'stone_bricks'); g.set(4, bot - 3, 7, 'stone_bricks');
  // cells along the back with iron bars
  g.fill(1, ly, 8, 7, ly + 3, 8, 'iron_bars');
  g.set(4, ly, 8, 'stone_bricks'); g.set(4, ly + 1, 8, 'stone_bricks'); g.set(4, ly + 2, 8, 'stone_bricks'); g.set(4, ly + 3, 8, 'stone_bricks');
  g.fill(4, ly, 9, 4, ly + 3, 9, 'stone_bricks');
  g.entity('villager', 2, ly, 9, {});
  g.entity('zombie_villager', 6, ly, 9, {});
  g.set(1, ly, 3, 'brewing_stand');
  g.set(2, ly, 3, 'cauldron');
  g.set(7, ly, 4, 'crafting_table');
  g.set(1, ly + 2, 5, 'oak_wall_sign', { f: EAST });
  weather(g, rng(o.depth * 7 + 3), 0.15, 0, ly - 1, 2, 8, bot, 10, 'stone_bricks', 'mossy_stone_bricks');
  weather(g, rng(o.depth * 7 + 5), 0.08, 0, ly - 1, 2, 8, bot, 10, 'stone_bricks', 'cracked_stone_bricks');
  g.chest(7, ly, 3, 'igloo_chest', WEST);
}

/* =================================================== pillager outpost == */
PLANS.pillager_outpost = ctx => {
  const p = ctx.point, r = ctx.r;
  const rot = p.rot || 0;
  const out = [];
  const T = 11;                                            // the tower's footprint
  const tx = p.x - (T >> 1), tz = p.z - (T >> 1);
  const tfp = footprint(ctx, tx, tz, T, T, 2);
  const ty = Math.max(tfp.med, sea1(ctx));
  out.push(new Build('pillager_outpost', tx, ty - 1, tz, T, 26, T, rot, drawOutpost, { b: 1 }));
  // the bits round it: a cage with a golem, a target dummy, a tent, log piles
  const extras = ['cage', 'dummy', 'tent', 'logs', 'dummy', 'tent'];
  const taken = [[tx - 1, tz - 1, tx + T, tz + T]];
  let tries = 0;
  for (const kind of extras) {
    if (kind === 'cage' && r.nextFloat() < 0.15) continue;
    if (kind !== 'cage' && r.nextFloat() < 0.35) continue;
    const w = kind === 'tent' ? 5 : kind === 'cage' ? 5 : kind === 'logs' ? 4 : 3, d = kind === 'tent' ? 6 : kind === 'logs' ? 3 : w;
    for (let t = 0; t < 8; t++, tries++) {
      const a = r.nextFloat() * Math.PI * 2, dist = r.between(11, 20);
      const ex = Math.round(p.x + Math.cos(a) * dist), ez = Math.round(p.z + Math.sin(a) * dist);
      const er = r.nextInt(4);
      const W = er & 1 ? d : w, D = er & 1 ? w : d;
      const q = [ex - (W >> 1), ez - (D >> 1), ex - (W >> 1) + W - 1, ez - (D >> 1) + D - 1];
      if (taken.some(t2 => q[0] <= t2[2] + 1 && q[2] >= t2[0] - 1 && q[1] <= t2[3] + 1 && q[3] >= t2[1] - 1)) continue;
      const fp = footprint(ctx, q[0], q[1], W, D);
      if (fp.min < sea1(ctx) || fp.max - fp.min > 3) continue;
      taken.push(q);
      out.push(new Build('pillager_outpost', q[0], fp.med, q[1], w, 8, d, er, EXTRA[kind], {}));
      break;
    }
  }
  return out;
};
function drawOutpost(g, o) {
  const b = o.b;
  const L = 'dark_oak_log', P = 'birch_planks', F = 'dark_oak_fence', DP = 'dark_oak_planks';
  // the cobblestone foot, down to the ground
  g.air(0, b + 1, 0, 10, b + 24, 10);
  for (let x = 1; x <= 9; x++) for (let z = 1; z <= 9; z++) { g.set(x, b, z, 'cobblestone'); g.down(x, b - 1, z, 'cobblestone'); }
  for (let x = 2; x <= 8; x++) for (let z = 2; z <= 8; z++) if (x === 2 || x === 8 || z === 2 || z === 8) g.set(x, b + 1, z, 'cobblestone');
  // the core: birch walls between dark oak logs, floors every five blocks
  for (let y = 1; y <= 19; y++) {
    for (let x = 2; x <= 8; x++) for (let z = 2; z <= 8; z++) {
      const edgeX = x === 2 || x === 8, edgeZ = z === 2 || z === 8;
      if (!edgeX && !edgeZ) continue;
      const post = (edgeX && edgeZ) || (edgeX && z === 5) || (edgeZ && x === 5);
      g.set(x, b + y, z, post ? L : y === 1 ? 'cobblestone' : P, { axis: 'y' });
    }
  }
  for (const y of [5, 10, 15]) {
    g.fill(3, b + y, 3, 7, b + y, 7, DP);
    // a ring of dark oak logs round the outside at each floor
    for (let x = 1; x <= 9; x++) { g.set(x, b + y, 1, L, { axis: 'x' }); g.set(x, b + y, 9, L, { axis: 'x' }); }
    for (let z = 2; z <= 8; z++) { g.set(1, b + y, z, L, { axis: 'z' }); g.set(9, b + y, z, L, { axis: 'z' }); }
  }
  // windows of fence
  for (const y of [3, 7, 8, 12, 13, 17, 18]) for (const t of [3, 4, 6, 7]) {
    if ((t + y) % 3 === 0) continue;
    g.set(t, b + y, 2, F); g.set(t, b + y, 8, F); g.set(2, b + y, t, F); g.set(8, b + y, t, F);
  }
  // door and ladders up through holes in the floors
  g.air(5, b + 1, 2, 5, b + 2, 2);
  g.set(5, b + 1, 2, 'air');
  for (let y = 1; y <= 20; y++) g.set(7, b + y, 7, 'ladder', { f: NORTH });
  // the open top: a deck wider than the tower, a fence rail, posts and a slab roof
  g.fill(0, b + 20, 0, 10, b + 20, 10, DP);
  g.set(7, b + 20, 7, 'ladder', { f: NORTH });
  for (let x = 0; x <= 10; x++) { g.set(x, b + 21, 0, F); g.set(x, b + 21, 10, F); }
  for (let z = 0; z <= 10; z++) { g.set(0, b + 21, z, F); g.set(10, b + 21, z, F); }
  for (const [x, z] of [[0, 0], [10, 0], [0, 10], [10, 10]]) for (let y = 21; y <= 23; y++) g.set(x, b + y, z, L, { axis: 'y' });
  g.fill(0, b + 24, 0, 10, b + 24, 10, 'dark_oak_slab', { slab: 0 });
  g.fill(1, b + 24, 1, 9, b + 24, 9, DP);
  g.fill(2, b + 25, 2, 8, b + 25, 8, 'dark_oak_slab', { slab: 0 });
  // lights, the banner and the loot chest
  for (const [x, z] of [[1, 1], [9, 1], [1, 9], [9, 9]]) g.set(x, b + 23, z, 'lantern', { m: 1 });
  g.set(5, b + 21, 5, 'white_banner');
  g.entity('pillager', 4, b + 21, 4, {});
  g.entity('pillager', 6, b + 6, 4, {});
  g.entity('pillager', 4, b + 11, 6, {});
  g.entity('pillager', 5, b + 16, 4, {});
  g.chest(3, b + 21, 3, 'pillager_outpost', SOUTH);
}
const EXTRA = {
  cage(g) {
    g.air(0, 1, 0, 4, 6, 4);
    for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) { g.set(x, 0, z, 'dark_oak_planks'); g.down(x, -1, z, 'dirt'); }
    for (let y = 1; y <= 3; y++) for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) if (x === 0 || x === 4 || z === 0 || z === 4) g.set(x, y, z, 'dark_oak_fence');
    g.fill(0, 4, 0, 4, 4, 4, 'dark_oak_slab', { slab: 0 });
    g.entity('iron_golem', 2, 1, 2, {});
  },
  dummy(g) {
    g.air(0, 1, 0, 2, 4, 2);
    g.set(1, 1, 1, 'dark_oak_fence');
    g.set(1, 2, 1, 'hay_block', { axis: 'y' });
    g.set(0, 2, 1, 'dark_oak_fence'); g.set(2, 2, 1, 'dark_oak_fence');
    g.set(1, 3, 1, 'carved_pumpkin', { f: NORTH });
  },
  tent(g) {
    g.air(0, 1, 0, 4, 4, 5);
    for (let z = 0; z < 6; z++) {
      g.set(0, 1, z, 'white_wool'); g.set(4, 1, z, 'white_wool');
      g.set(1, 2, z, 'white_wool'); g.set(3, 2, z, 'white_wool');
      g.set(2, 3, z, 'dark_oak_log', { axis: 'z' });
    }
    g.set(2, 1, 5, 'white_wool'); g.set(1, 1, 5, 'white_wool'); g.set(3, 1, 5, 'white_wool'); g.set(2, 2, 5, 'white_wool');
    g.set(1, 1, 3, 'crafting_table');
    g.entity('pillager', 2, 1, 2, {});
  },
  logs(g) {
    g.air(0, 1, 0, 3, 3, 2);
    for (let x = 0; x < 4; x++) { g.set(x, 1, 0, 'dark_oak_log', { axis: 'x' }); g.set(x, 1, 1, 'dark_oak_log', { axis: 'x' }); g.set(x, 1, 2, 'dark_oak_log', { axis: 'x' }); }
    for (let x = 0; x < 4; x++) g.set(x, 2, 1, 'dark_oak_log', { axis: 'x' });
  },
};

/* ===================================================== buried treasure == */
PLANS.buried_treasure = ctx => {
  const x = ctx.x0 + 9, z = ctx.z0 + 9;
  const gy = ctx.ground(x, z);
  const y = gy - 1 - ctx.r.nextInt(3);
  return [new Build('buried_treasure', x - 1, y - 1, z - 1, 3, 3, 3, 0, g => {
    g.fill(0, 0, 0, 2, 2, 2, 'sand');
    g.chest(1, 1, 1, 'buried_treasure');
  })];
};

/* ===================================================== abandoned camps == */
// the camp's wood, tent colour and loot by biome
const CAMP = {
  bamboo_jungle: ['bamboo', 'lime_wool', 'village/village_plains_house'],
  birch_forest: ['birch', 'white_wool', 'village/village_plains_house'],
  cherry_grove: ['cherry', 'pink_wool', 'village/village_plains_house'],
  dappled_forest: ['oak', 'green_wool', 'village/village_plains_house'],
  flower_forest: ['birch', 'yellow_wool', 'village/village_plains_house'],
  forest: ['oak', 'brown_wool', 'village/village_plains_house'],
  meadow: ['oak', 'light_blue_wool', 'village/village_plains_house'],
  old_growth_pine_taiga: ['spruce', 'brown_wool', 'village/village_taiga_house'],
  old_growth_birch_forest: ['birch', 'white_wool', 'village/village_plains_house'],
  old_growth_spruce_taiga: ['spruce', 'gray_wool', 'village/village_taiga_house'],
  pale_garden: ['pale_oak', 'light_gray_wool', 'village/village_plains_house'],
  savanna: ['acacia', 'orange_wool', 'village/village_savanna_house'],
  snowy_taiga: ['spruce', 'white_wool', 'village/village_snowy_house'],
  sparse_jungle: ['jungle', 'green_wool', 'village/village_plains_house'],
  swamp: ['mangrove', 'green_wool', 'village/village_plains_house'],
  taiga: ['spruce', 'red_wool', 'village/village_taiga_house'],
  windswept_forest: ['spruce', 'blue_wool', 'village/village_taiga_house'],
  wooded_badlands: ['oak', 'orange_wool', 'village/village_desert_house'],
};
PLANS.abandoned_camp = ctx => {
  const biome = ctx.type.replace('abandoned_camp_', '');
  const [wood, wool, loot] = CAMP[biome] || ['oak', 'white_wool', 'village/village_plains_house'];
  const r = ctx.r;
  const rot = ctx.point.rot !== undefined ? ctx.point.rot : r.nextInt(4);
  const w = 9, d = 11;
  const W = rot & 1 ? d : w, D = rot & 1 ? w : d;
  const x = ctx.point.x - (W >> 1), z = ctx.point.z - (D >> 1);
  const fp = footprint(ctx, x, z, W, D, 2);
  const y = Math.max(fp.med, sea1(ctx));
  const o = {
    wood, wool, loot, barrel: r.nextBoolean(), lantern: r.nextBoolean(), snow: biome === 'snowy_taiga',
    sand: biome === 'wooded_badlands' ? 'red_sand' : null,
  };
  return [new Build(ctx.type, x, y, z, w, 6, d, rot, drawCamp, o)];
};
function drawCamp(g, o) {
  const log = o.wood === 'bamboo' ? 'bamboo_block' : o.wood + '_log';
  const planks = o.wood + '_planks', fence = o.wood + '_fence', slab = o.wood + '_slab';
  const stripped = o.wood === 'bamboo' ? 'stripped_bamboo_block' : 'stripped_' + o.wood + '_log';
  g.air(0, 1, 0, 8, 5, 10);
  for (let x = 0; x < 9; x++) for (let z = 0; z < 11; z++) g.down(x, -1, z, 'dirt');
  // the tent at the back: an A of wool over a log ridge, open at the front
  for (let z = 5; z <= 9; z++) {
    g.set(2, 1, z, o.wool); g.set(6, 1, z, o.wool);
    g.set(3, 2, z, o.wool); g.set(5, 2, z, o.wool);
    g.set(4, 3, z, log, { axis: 'z' });
  }
  g.set(3, 1, 10, o.wool); g.set(4, 1, 10, o.wool); g.set(5, 1, 10, o.wool); g.set(4, 2, 10, o.wool);
  g.set(4, 1, 4, fence); g.set(4, 2, 4, fence); g.set(4, 3, 4, fence);
  if (o.lantern) g.set(4, 2, 4, 'lantern', { m: 1 });
  // a bedroll and the chest or barrel inside
  bed(g, 3, 1, 8, 'brown', SOUTH);
  if (o.barrel) g.barrel(5, 1, 9, o.loot);
  else g.chest(5, 1, 9, o.loot, WEST);
  // the fire in front, ringed by benches of log
  g.set(4, 0, 1, o.sand || 'coarse_dirt');
  g.set(4, 1, 1, 'campfire', { f: SOUTH });
  g.set(1, 1, 1, stripped, { axis: 'z' }); g.set(1, 1, 2, stripped, { axis: 'z' });
  g.set(7, 1, 1, stripped, { axis: 'z' }); g.set(7, 1, 2, stripped, { axis: 'z' });
  g.set(3, 1, 0, slab, { slab: 0 }); g.set(5, 1, 0, slab, { slab: 0 });
  // a woodpile and a block to split on
  g.set(8, 1, 7, log, { axis: 'x' }); g.set(8, 1, 8, log, { axis: 'x' }); g.set(8, 2, 8, log, { axis: 'x' });
  g.set(0, 1, 6, planks);
  if (o.snow) { g.set(1, 2, 1, 'snow'); g.set(7, 2, 2, 'snow'); g.set(8, 3, 8, 'snow'); }
}
