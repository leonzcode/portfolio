/* ---------------------------------------------------------------------------
   Leoncraft 2 - Leonpixel's lobby cosmetics: what they are and how they look.

   Hidden in the lobby's chests (mlhub apps/mc/hubcos.js keeps who has found
   what, and which chest holds which): 30 hats, 30 auras, 30 trails, 30
   gadgets and the Backpack. A hat is a little model of boxes on the head
   (render/hats.js builds it, the avatar draws it with the body's own
   shader); an aura is a pattern of particles round you, a trail is left
   where you walk; a gadget does something when you use it and never runs
   out. Everything here is ours. The ids must match the server's list
   (hubcos.js COSMETICS): the server checks every one.

   Hats: boxes [x, y, z, w, h, d, colour, opts] in the head's own pixels (y
   up from the neck, the head itself from y 0 to 8 and x, z from -4 to 4, +z
   the face, +x the player's left); opts: rot [x, y, z] in degrees about the
   box's middle, paint (a painter below), dim (0..1, how much its own
   shading varies).
--------------------------------------------------------------------------- */

export const CATS = [
  ['hat', 'Hats', '§d'], ['aura', 'Auras', '§b'], ['trail', 'Trails', '§a'], ['gadget', 'Gadgets', '§6'], ['special', 'Special', '§e'],
];
export const RARITY = { c: ['Common', '§a'], r: ['Rare', '§9'], e: ['Epic', '§5'], l: ['Legendary', '§6'] };

// mirrored about x (a pair of horns, ears...)
const pair = (b) => [b, [-b[0], ...b.slice(1, 7), b[7] && b[7].rot ? Object.assign({}, b[7], { rot: [b[7].rot[0], -b[7].rot[1], -b[7].rot[2]] }) : b[7]]];
// a pointed hat's cone: tiers from y0 up, each narrower, leaning by (lx, lz) a tier
const cone = (y0, w0, tiers, colour, lx = 0, lz = 0, step = 2) => {
  const out = [];
  for (let i = 0; i < tiers; i++) { const w = w0 * (1 - i / (tiers + 0.6)); out.push([lx * i, y0 + step * i + step / 2, lz * i, w, step, w, colour]); }
  return out;
};
// four sides of a ring round the head at height y
const ring = (y, h, r, t, colour, opts) => [[0, y, r, r * 2 + t, h, t, colour, opts], [0, y, -r, r * 2 + t, h, t, colour, opts], [r, y, 0, t, h, r * 2 - t, colour, opts], [-r, y, 0, t, h, r * 2 - t, colour, opts]];

export const HATS = {
  hat_top: { boxes: [[0, 8.75, 0, 11, 0.5, 11, 0x1a1a1e], [0, 12.6, 0, 7, 7.2, 7, 0x222228], [0, 9.7, 0, 7.3, 1.3, 7.3, 0xb3202a]] },
  hat_crown: {
    boxes: [...ring(9.6, 3, 4.3, 0.6, 0xf2c230),
      ...[-3, 0, 3].flatMap(x => [[x, 11.7, 4.3, 1, 1.4, 0.6, 0xf7d64a], [x, 11.7, -4.3, 1, 1.4, 0.6, 0xf7d64a], [4.3, 11.7, x, 0.6, 1.4, 1, 0xf7d64a], [-4.3, 11.7, x, 0.6, 1.4, 1, 0xf7d64a]]),
      [0, 9.6, 4.65, 1.4, 1.4, 0.2, 0xd01c2c], [4.65, 9.6, 0, 0.2, 1.4, 1.4, 0x2a5ad8], [-4.65, 9.6, 0, 0.2, 1.4, 1.4, 0x22a84a], [0, 9.6, -4.65, 1.4, 1.4, 0.2, 0x9a2ad8]],
  },
  hat_wizard: {
    boxes: [[0, 8.75, 0, 12, 0.5, 12, 0x2b3a9e], ...cone(9, 8, 5, 0x2f40b0, 0.45, -0.5),
      [2.2, 10.4, 4.05, 1, 1, 0.2, 0xffe23a], [-2.4, 12.3, 2.9, 0.8, 0.8, 0.2, 0xffe23a], [3.3, 13.2, 0.4, 0.2, 0.8, 0.8, 0xffe23a], [-0.4, 14.6, 1.6, 0.6, 0.6, 0.2, 0xffe23a]],
  },
  hat_witch: {
    boxes: [[0, 8.75, 0, 13, 0.5, 13, 0x1b1b22], ...cone(9, 8, 5, 0x22222c, 0, -0.9), [0, 9.6, 0, 8.3, 1, 8.3, 0x6a2c91], [0, 9.6, 4.2, 2, 1.4, 0.3, 0xd8c050], [0, 18.6, -5.4, 1.2, 1.2, 1.6, 0x22222c]],
  },
  hat_party: {
    boxes: [[0, 9.5, 0, 6, 2, 6, 0xff5fa8], [0, 11.5, 0, 4.4, 2, 4.4, 0xffe14a], [0, 13.5, 0, 3, 2, 3, 0x3ad8e8], [0, 15.2, 0, 1.6, 1.4, 1.6, 0x7ce83a], [0, 16.6, 0, 2.2, 2.2, 2.2, 0xffffff]],
  },
  hat_cowboy: {
    boxes: [[0, 8.75, 0, 12, 0.5, 14, 0x7a4a24], [6.6, 9.4, 0, 1.6, 0.5, 14, 0x7a4a24], [-6.6, 9.4, 0, 1.6, 0.5, 14, 0x7a4a24], [0, 11, 0, 8, 4, 8, 0x8a5a2c], [0, 13.1, 0, 6, 0.3, 6, 0x6e4220], [0, 9.6, 0, 8.3, 1, 8.3, 0x3a2210]],
  },
  hat_viking: {
    boxes: [[0, 9.4, 0, 9.2, 2.8, 9.2, 0x9aa0a8], [0, 11.3, 0, 7, 1, 7, 0xa8aeb6], [0, 9, 0, 9.4, 0.8, 9.4, 0x7a6038], [0, 6.6, 4.7, 1.2, 3.6, 0.5, 0x9aa0a8],
      ...pair([5.3, 10.1, 0, 1.8, 1.6, 1.8, 0xefe6cf]), ...pair([6.3, 11.5, 0, 1.4, 1.6, 1.4, 0xefe6cf]), ...pair([6.6, 13, 0, 1, 1.4, 1, 0xd8ceb4])],
  },
  hat_chef: { boxes: [[0, 9.6, 0, 9.2, 2.2, 9.2, 0xf4f4f4], [0, 13.2, 0, 10.4, 5, 10.4, 0xfcfcfc], [0, 15.9, 0, 8.4, 0.8, 8.4, 0xffffff]] },
  hat_santa: {
    boxes: [[0, 9.2, 0, 9.6, 1.6, 9.6, 0xfafafa], [0, 11.2, -0.5, 7.6, 2.6, 7.6, 0xc8202a], [0, 13, -1.8, 5.6, 2, 5.6, 0xc8202a], [0, 13.9, -3.8, 3.4, 1.5, 3.2, 0xb81c26],
      [0, 13.2, -5.6, 2, 2, 2, 0xb81c26], [0, 12.2, -6.6, 2.2, 2.2, 2.2, 0xffffff]],
  },
  hat_pirate: {
    boxes: [[0, 9.6, 0, 9.2, 2.2, 9.2, 0x16161a], [0, 11.6, 3.9, 11.5, 3.2, 1, 0x1c1c22], [0, 11.1, -4.1, 10.5, 2.6, 1, 0x1c1c22], [5.4, 10.9, 0, 1, 2.2, 7.2, 0x1c1c22], [-5.4, 10.9, 0, 1, 2.2, 7.2, 0x1c1c22],
      [0, 11.9, 4.45, 2.2, 2, 0.2, 0xf2f2f2], [-0.5, 12.2, 4.58, 0.6, 0.6, 0.1, 0x101010], [0.5, 12.2, 4.58, 0.6, 0.6, 0.1, 0x101010], [0, 10.4, 4.5, 3.8, 0.4, 0.2, 0xd8c050]],
  },
  hat_propeller: {
    boxes: [[2.25, 9.4, 2.25, 4.5, 1.8, 4.5, 0xe53935], [-2.25, 9.4, 2.25, 4.5, 1.8, 4.5, 0xfdd835], [2.25, 9.4, -2.25, 4.5, 1.8, 4.5, 0x1e88e5], [-2.25, 9.4, -2.25, 4.5, 1.8, 4.5, 0x43a047],
      [0, 8.7, 5.8, 7, 0.4, 3, 0x1e88e5], [0, 10.6, 0, 1.2, 0.6, 1.2, 0xffffff], [0, 11.6, 0, 0.5, 1.4, 0.5, 0x9e9e9e],
      [0, 12.4, 0, 11, 0.3, 1.3, 0xfafafa, { rot: [0, 25, 0] }], [0, 12.4, 0, 11, 0.3, 1.3, 0xfafafa, { rot: [0, 115, 0] }]],
  },
  hat_grad: {
    boxes: [[0, 9.3, 0, 8.8, 1.6, 8.8, 0x1a1a1e], [0, 10.4, 0, 11.5, 0.6, 11.5, 0x111114, { rot: [0, 45, 0] }], [0, 10.85, 0, 1, 0.4, 1, 0xe8c040],
      [2.6, 10.85, 2.6, 0.4, 0.3, 7.4, 0xe8c040, { rot: [0, 45, 0] }], [5.3, 9.3, 5.3, 0.7, 3.2, 0.7, 0xe8c040]],
  },
  hat_halo: { boxes: [[0, 12.6, 3, 6.6, 0.6, 0.8, 0xffe066], [0, 12.6, -3, 6.6, 0.6, 0.8, 0xffe066], [3, 12.6, 0, 0.8, 0.6, 5.4, 0xffe066], [-3, 12.6, 0, 0.8, 0.6, 5.4, 0xffe066]] },
  hat_horns: { boxes: [...pair([2.8, 9.2, 1.2, 1.5, 1.6, 1.5, 0xb01818]), ...pair([3.4, 10.6, 0.9, 1.1, 1.4, 1.1, 0xa01414]), ...pair([3.9, 11.8, 0.6, 0.8, 1.2, 0.8, 0x6e0c0c])] },
  hat_bunny: {
    boxes: [...pair([2, 12, -0.5, 1.8, 7, 1, 0xf6f6f6, { rot: [0, 0, -10] }]), ...pair([2, 11.6, 0.05, 0.9, 5.4, 0.1, 0xf6a6c4, { rot: [0, 0, -10] }]), [0, 8.7, 0, 9.2, 0.6, 9.2, 0xf6a6c4]],
  },
  hat_cat: { boxes: [...pair([2.6, 9.6, 1, 2.6, 2, 1, 0xe88a2c]), ...pair([2.6, 11.1, 1, 1.4, 1.2, 1, 0xe88a2c]), ...pair([2.6, 10, 1.55, 1.3, 1.3, 0.1, 0xf6a6c4])] },
  hat_flowers: {
    boxes: [...ring(8.9, 1, 4.4, 0.9, 0x3c8c3c),
      ...[[-3, 0xe53935], [-1, 0xfdd835], [1, 0xc070e0], [3, 0xffffff]].flatMap(([x, c]) => [[x, 9.5, 4.6, 1.3, 1.3, 1.3, c], [4.6, 9.5, -x, 1.3, 1.3, 1.3, c], [-4.6, 9.5, x, 1.3, 1.3, 1.3, c], [-x, 9.5, -4.6, 1.3, 1.3, 1.3, c]])],
  },
  hat_sombrero: {
    boxes: [[0, 8.75, 0, 17, 0.5, 17, 0xd8b25a], ...ring(9.3, 0.6, 8.2, 0.6, 0xb23a2a), [0, 10.6, 0, 7.4, 3.2, 7.4, 0xd8b25a], [0, 12.7, 0, 5.4, 1.2, 5.4, 0xceaa52], [0, 9.6, 0, 7.6, 0.8, 7.6, 0x2a8a3a]],
  },
  hat_fez: { boxes: [[0, 10.4, 0, 6.6, 4, 6.6, 0xb3202a], [0, 12.55, 0, 6, 0.3, 6, 0xa01c26], [0, 12.9, 0, 0.6, 0.5, 0.6, 0x111111], [2.1, 11.6, 0.2, 0.4, 2.4, 0.4, 0x111111, { rot: [0, 0, 20] }]] },
  hat_beanie: { boxes: [[0, 9.6, 0, 9, 3, 9, 0xc0392b, { paint: 'stripes' }], [0, 8.8, 0, 9.4, 1.4, 9.4, 0x922b21], [0, 11.8, 0, 2.6, 2.2, 2.6, 0xffffff]] },
  hat_cap: { boxes: [[0, 9.5, -0.2, 8.9, 2.6, 8.9, 0x2456c8], [0, 10.95, -0.2, 1, 0.3, 1, 0x1d43a0], [0, 8.7, 5.9, 8, 0.4, 4.2, 0x1d43a0], [0, 9.6, 4.3, 3, 1.6, 0.2, 0xffffff]] },
  hat_cone: { boxes: [[0, 8.75, 0, 10, 0.5, 10, 0xff7a10], [0, 10, 0, 6, 2, 6, 0xff7a10], [0, 12, 0, 4.6, 2, 4.6, 0xf4f4f4], [0, 14, 0, 3.4, 2, 3.4, 0xff7a10], [0, 15.8, 0, 2.2, 1.6, 2.2, 0xf4f4f4]] },
  hat_astro: {
    boxes: [[0, 9.3, 0, 10, 0.6, 10, 0xf2f2f2], [0, 4.4, -4.8, 10, 9.6, 0.6, 0xe8e8e8], [4.8, 4.4, 0, 0.6, 9.6, 9, 0xe8e8e8], [-4.8, 4.4, 0, 0.6, 9.6, 9, 0xe8e8e8],
      [0, 8.1, 4.8, 10, 1.8, 0.6, 0xf2f2f2], [0, 0.2, 4.8, 10, 0.6, 0.6, 0xf2f2f2], [0, 4.1, 4.85, 8.8, 7.6, 0.4, 0x3a5a9a, { paint: 'visor' }],
      [3.4, 11, -2, 0.4, 2.6, 0.4, 0x9e9e9e], [3.4, 12.5, -2, 0.8, 0.8, 0.8, 0xe53935]],
  },
  hat_headphones: { boxes: [[0, 9.1, 0, 9.4, 0.7, 1.4, 0x2c2c32], ...pair([4.8, 6.4, 0, 0.7, 4.4, 1.4, 0x2c2c32]), ...pair([5, 3.6, 0, 1.2, 3.2, 3.2, 0xe53935])] },
  hat_pumpkin: { boxes: [[0, 4, 0, 9.6, 9.6, 9.6, 0xd4791c, { paint: 'pumpkin' }], [0, 9.3, 0, 1.2, 1.2, 1.2, 0x5a7a2a]] },
  hat_knight: {
    boxes: [[0, 9.3, 0, 9.8, 0.6, 9.8, 0xa8aeb6], [0, 4.4, -4.7, 9.8, 9.6, 0.6, 0x9aa0a8], [4.7, 4.4, 0, 0.6, 9.6, 9, 0x9aa0a8], [-4.7, 4.4, 0, 0.6, 9.6, 9, 0x9aa0a8],
      [0, 4.4, 4.7, 9.8, 9.6, 0.6, 0x9aa0a8, { paint: 'slit' }], [0, 11.2, -0.8, 1.2, 3.2, 5.6, 0xc62828]],
  },
  hat_mushroom: {
    boxes: [[0, 9.8, 0, 11, 2.2, 11, 0xc8282a], [0, 11.4, 0, 8, 1.2, 8, 0xc8282a],
      [2, 12.05, 1.4, 1.8, 0.2, 1.8, 0xfafafa], [-2.4, 12.05, -1.6, 1.4, 0.2, 1.4, 0xfafafa], [5.55, 10, 2, 0.2, 1.4, 1.4, 0xfafafa], [-5.55, 9.8, -1, 0.2, 1.6, 1.6, 0xfafafa], [1, 10, -5.55, 1.6, 1.4, 0.2, 0xfafafa], [-2, 9.9, 5.55, 1.4, 1.4, 0.2, 0xfafafa]],
  },
  hat_frog: {
    boxes: [[0, 9.3, 0, 9.2, 2, 9.2, 0x5aa02c], ...pair([2.4, 11, 2.4, 2.6, 2.4, 2.6, 0x6ab83a]), ...pair([2.4, 11.2, 3.75, 1.6, 1.6, 0.2, 0xffffff]), ...pair([2.4, 11.2, 3.9, 0.8, 0.8, 0.2, 0x101010]),
      [0, 8.6, 4.65, 7, 0.5, 0.2, 0x2e5a12]],
  },
  hat_antlers: {
    boxes: [[0, 8.9, 0, 9.2, 0.6, 1.2, 0x6b4a2a], ...pair([3.9, 10.8, 0, 0.9, 3.8, 0.9, 0x8b5a2b]), ...pair([4.9, 12, 0, 2.2, 0.7, 0.7, 0x8b5a2b]),
      ...pair([3.6, 13.3, 0, 0.7, 2, 0.7, 0x8b5a2b, { rot: [0, 0, 15] }]), ...pair([5.7, 13, 0, 0.7, 1.6, 0.7, 0x8b5a2b, { rot: [0, 0, -15] }])],
  },
  hat_sprout: { boxes: [[0, 9.6, 0, 0.6, 3.2, 0.6, 0x4a8a2a], [1.3, 11.2, 0, 2.4, 0.4, 1.4, 0x5ab83a, { rot: [0, 0, 25] }], [-1.3, 11.7, 0, 2.4, 0.4, 1.4, 0x5ab83a, { rot: [0, 0, -25] }]] },
};

/* Auras: particles round you while worn. shape: ring (orbiting at height y, radius r), halo (over the head), helix (two
   spirals rising), sphere, rain (falling from over you), rise (going up from the feet), wings (a pair of wings
   behind), cloud (a cloud over the head and drops under it), burst (now and then all round). kind is the particle,
   col a colour or 'rainbow', n how many a tick. */
export const AURAS = {
  aura_flame: { kind: 'flame', shape: 'ring', y: 0.9, r: 0.8, n: 2, speed: 0.12 },
  aura_soul: { kind: 'soul_flame', shape: 'ring', y: 0.9, r: 0.8, n: 2, speed: 0.1 },
  aura_hearts: { kind: 'heart', shape: 'halo', y: 2.3, r: 0.55, n: 0.25, speed: 0.06 },
  aura_notes: { kind: 'note', shape: 'ring', y: 2.1, r: 0.7, n: 0.35, speed: 0.08, col: 'rainbow' },
  aura_enchant: { kind: 'enchant', shape: 'sphere', y: 1, r: 1.3, n: 2, inward: true },
  aura_portal: { kind: 'portal', shape: 'helix', y: 0, r: 0.7, n: 2, speed: 0.15 },
  aura_rainbow: { kind: 'glowdust', shape: 'ring', y: 0.15, r: 0.9, n: 3, speed: 0.1, col: 'rainbow' },
  aura_snow: { kind: 'snowflake', shape: 'rain', y: 3, r: 1.1, n: 2 },
  aura_raincloud: { kind: 'poof', shape: 'cloud', y: 2.7, r: 0.6, n: 2, drop: 'rain', col: [0.85, 0.85, 0.9] },
  aura_storm: { kind: 'large_smoke', shape: 'cloud', y: 2.8, r: 0.6, n: 1.5, drop: 'crit', col: [0.3, 0.3, 0.35] },
  aura_bubbles: { kind: 'airbubble', shape: 'rise', y: 0, r: 0.7, n: 1 },
  aura_fireflies: { kind: 'glowdust', shape: 'sphere', y: 1, r: 1.6, n: 0.6, col: [1, 0.9, 0.3], drift: true },
  aura_galaxy: { kind: 'sparkle', shape: 'sphere', y: 1, r: 1.2, n: 2.5, col: 'galaxy', orbit: true },
  aura_helix: { kind: 'glowdust', shape: 'helix', y: 0, r: 0.75, n: 3, speed: 0.18, col: 'redblue' },
  aura_frost: { kind: 'sparkle', shape: 'ring', y: 0.1, r: 0.9, n: 2, speed: 0.05, col: [0.7, 0.9, 1] },
  aura_gold: { kind: 'glowdust', shape: 'rain', y: 2.4, r: 0.8, n: 1.5, col: [1, 0.82, 0.2] },
  aura_emerald: { kind: 'sparkle', shape: 'sphere', y: 1, r: 1, n: 1.5, col: [0.3, 1, 0.45] },
  aura_redstone: { kind: 'dust', shape: 'ring', y: 1, r: 0.85, n: 3, speed: 0.2, col: [1, 0.1, 0.1] },
  aura_void: { kind: 'smoke', shape: 'rise', y: 0, r: 0.6, n: 2, col: [0.18, 0.05, 0.25] },
  aura_sakura: { kind: 'petal', shape: 'rain', y: 3, r: 1.2, n: 1, col: [1, 0.72, 0.85] },
  aura_autumn: { kind: 'petal', shape: 'rain', y: 3, r: 1.2, n: 1, col: 'autumn' },
  aura_lava: { kind: 'lava', shape: 'halo', y: 2.2, r: 0.6, n: 0.6, speed: 0.05 },
  aura_crit: { kind: 'crit', shape: 'ring', y: 1.1, r: 0.9, n: 2, speed: 0.2 },
  aura_magic: { kind: 'magic', shape: 'ring', y: 1.1, r: 0.9, n: 2, speed: -0.15 },
  aura_smoke: { kind: 'large_smoke', shape: 'rise', y: 0, r: 0.5, n: 0.8 },
  aura_angel: { kind: 'sparkle', shape: 'wings', y: 1.3, r: 0.9, n: 3, col: [1, 1, 1] },
  aura_demon: { kind: 'dust', shape: 'wings', y: 1.3, r: 0.9, n: 3, col: [0.6, 0.02, 0.02] },
  aura_sun: { kind: 'flame', shape: 'halo', y: 2.35, r: 0.5, n: 2, speed: 0.14 },
  aura_ocean: { kind: 'glowdust', shape: 'ring', y: 0.4, r: 1, n: 3, speed: 0.08, col: 'ocean', wave: true },
  aura_love: { kind: 'heart', shape: 'burst', y: 1, r: 1.2, n: 8, every: 40 },
};

// Trails: left where you walk (n a tick while moving; at the feet unless said)
export const TRAILS = {
  trail_flame: { kind: 'flame', n: 2 }, trail_soul: { kind: 'soul_flame', n: 2 }, trail_hearts: { kind: 'heart', n: 0.4 }, trail_notes: { kind: 'note', n: 0.5, col: 'rainbow' },
  trail_rainbow: { kind: 'glowdust', n: 4, col: 'rainbow' }, trail_smoke: { kind: 'smoke', n: 2 }, trail_cloud: { kind: 'poof', n: 1.5 }, trail_sparkle: { kind: 'sparkle', n: 2, col: [1, 1, 1] },
  trail_portal: { kind: 'portal', n: 3 }, trail_enchant: { kind: 'enchant', n: 2 }, trail_redstone: { kind: 'dust', n: 3, col: [1, 0.1, 0.1] }, trail_emerald: { kind: 'sparkle', n: 2, col: [0.3, 1, 0.45] },
  trail_snow: { kind: 'snowflake', n: 2 }, trail_lava: { kind: 'lava', n: 0.6 }, trail_water: { kind: 'splash', n: 3 }, trail_bubble: { kind: 'airbubble', n: 1.5 },
  trail_crit: { kind: 'crit', n: 2 }, trail_magic: { kind: 'magic', n: 2 }, trail_cherry: { kind: 'petal', n: 1, col: [1, 0.72, 0.85] }, trail_leaves: { kind: 'petal', n: 1, col: [0.35, 0.7, 0.25] },
  trail_gold: { kind: 'glowdust', n: 2, col: [1, 0.82, 0.2] }, trail_ink: { kind: 'smoke', n: 2, col: [0.05, 0.05, 0.08] }, trail_frost: { kind: 'sparkle', n: 2, col: [0.7, 0.9, 1] },
  trail_glow: { kind: 'glowdust', n: 2, col: [1, 0.95, 0.5] }, trail_confetti: { kind: 'glowdust', n: 4, col: 'confetti' }, trail_stars: { kind: 'sparkle', n: 1.5, col: [1, 1, 0.7], twinkle: true },
  trail_footprints: { kind: 'dust', n: 0, steps: true, col: [0.25, 0.2, 0.15] }, trail_fire_smoke: { kind: 'flame', n: 1.5, also: 'smoke' }, trail_ghost: { kind: 'poof', n: 1, col: [0.9, 0.95, 1] },
  trail_electric: { kind: 'crit', n: 2, col: [0.5, 0.8, 1] },
};

/* Gadgets: use (a right click) does it; never used up. cd: ticks before the next use. Kinds the page knows (lobbycos.js
   GADGET_FX): toggles (a mount, the guards, boots worn, a timed power), throws and shots, bursts of particles. */
export const GADGETS = {
  gad_pig: { cd: 20, toggle: 'mount', mount: 'pig', h: 0.8, speed: 1.35 },
  gad_horse: { cd: 20, toggle: 'mount', mount: 'horse', h: 1.35, speed: 1.9 },
  gad_secret: { cd: 60, toggle: 'guards', time: 1200 },
  gad_grapple: { cd: 40, how: 'Right Click to cast, again to pull' },
  gad_boots: { cd: 10, toggle: 'boots' },
  gad_jetpack: { cd: 0, hold: true },
  gad_cannon: { cd: 60 },
  gad_firework: { cd: 30 },
  gad_paintball: { cd: 4 },
  gad_tnt: { cd: 60 },
  gad_pearl: { cd: 20 },
  gad_snowball: { cd: 4 },
  gad_popper: { cd: 30 },
  gad_disco: { cd: 300 },
  gad_trampoline: { cd: 200 },
  gad_freeze: { cd: 40 },
  gad_wand: { cd: 30 },
  gad_melon: { cd: 30 },
  gad_chicken: { cd: 40 },
  gad_smoke: { cd: 200 },
  gad_moon: { cd: 20, toggle: 'moon' },
  gad_lightning: { cd: 60 },
  gad_bubble: { cd: 2, hold: true },
  gad_water: { cd: 30 },
  gad_speed: { cd: 20, toggle: 'speed' },
  gad_cloak: { cd: 400 },
  gad_glow: { cd: 20, toggle: 'glow' },
  gad_jukebox: { cd: 600 },
  gad_blink: { cd: 30 },
  gad_rocket: { cd: 120 },
};

/* The whole list: [id, category, name, rarity, icon item, what it is] (the icon's colour for a dyed one in icolor) */
const H = (id, name, r, color, what) => [id, 'hat', name, r, 'leather_helmet', what, color];
export const COSMETICS = [
  H('hat_top', 'Top Hat', 'c', 0x1a1a1e, 'A tall black hat with a red band.'),
  H('hat_crown', 'Royal Crown', 'l', 0xf2c230, 'Gold, with a gem on every side.'),
  H('hat_wizard', 'Wizard Hat', 'e', 0x2f40b0, 'Starry and a little bent.'),
  H('hat_witch', 'Witch Hat', 'r', 0x22222c, 'Pointed, with a purple band and a buckle.'),
  H('hat_party', 'Party Hat', 'c', 0xff5fa8, 'Every colour, with a pompom.'),
  H('hat_cowboy', 'Cowboy Hat', 'r', 0x8a5a2c, 'A wide brim turned up at the sides.'),
  H('hat_viking', 'Viking Helmet', 'e', 0x9aa0a8, 'Iron, with two big horns.'),
  H('hat_chef', "Chef's Hat", 'c', 0xfcfcfc, 'Tall, white and puffy.'),
  H('hat_santa', 'Santa Hat', 'r', 0xc8202a, 'Red and white, the tip hanging down.'),
  H('hat_pirate', 'Pirate Hat', 'e', 0x16161a, 'A black hat with a skull on the front.'),
  H('hat_propeller', 'Propeller Cap', 'r', 0xe53935, 'Four colours and a propeller on top.'),
  H('hat_grad', 'Graduation Cap', 'r', 0x1a1a1e, 'A square board and a gold tassel.'),
  H('hat_halo', 'Halo', 'l', 0xffe066, 'A gold ring over your head.'),
  H('hat_horns', 'Devil Horns', 'e', 0xb01818, 'Two small red horns.'),
  H('hat_bunny', 'Bunny Ears', 'c', 0xf6f6f6, 'Long white ears.'),
  H('hat_cat', 'Cat Ears', 'c', 0xe88a2c, 'Orange, with pink insides.'),
  H('hat_flowers', 'Flower Crown', 'r', 0x3c8c3c, 'A ring of leaves and flowers.'),
  H('hat_sombrero', 'Sombrero', 'e', 0xd8b25a, 'Very, very wide.'),
  H('hat_fez', 'Fez', 'c', 0xb3202a, 'Red, with a black tassel.'),
  H('hat_beanie', 'Beanie', 'c', 0xc0392b, 'A striped knit hat with a pompom.'),
  H('hat_cap', 'Baseball Cap', 'c', 0x2456c8, 'Blue, the brim to the front.'),
  H('hat_cone', 'Traffic Cone', 'r', 0xff7a10, 'Orange and white stripes.'),
  H('hat_astro', 'Astronaut Helmet', 'l', 0xf2f2f2, 'With a visor and an aerial.'),
  H('hat_headphones', 'Headphones', 'r', 0xe53935, 'Red ear cups on a black band.'),
  H('hat_pumpkin', 'Pumpkin Head', 'e', 0xd4791c, 'A carved pumpkin, lit from inside.'),
  H('hat_knight', "Knight's Helm", 'e', 0x9aa0a8, 'Iron, a red plume on top.'),
  H('hat_mushroom', 'Mushroom Cap', 'r', 0xc8282a, 'Red with white spots.'),
  H('hat_frog', 'Frog Hat', 'r', 0x5aa02c, 'Green, with big eyes on top.'),
  H('hat_antlers', 'Reindeer Antlers', 'r', 0x8b5a2b, 'Branching antlers on a band.'),
  H('hat_sprout', 'Leaf Sprout', 'c', 0x5ab83a, 'A little plant growing from your head.'),

  ['aura_flame', 'aura', 'Flame Ring', 'r', 'blaze_powder', 'Flames circling your waist.'],
  ['aura_soul', 'aura', 'Soul Fire Ring', 'e', 'soul_torch', 'Blue soul flames circling you.'],
  ['aura_hearts', 'aura', 'Heart Halo', 'c', 'red_dye', 'Hearts drifting over your head.'],
  ['aura_notes', 'aura', 'Music Notes', 'c', 'note_block', 'Notes of every colour going round.'],
  ['aura_enchant', 'aura', 'Enchanted', 'r', 'enchanted_book', 'Runes drawn in towards you.'],
  ['aura_portal', 'aura', 'Ender Swirl', 'e', 'ender_eye', 'A purple spiral from your feet up.'],
  ['aura_rainbow', 'aura', 'Rainbow Ring', 'e', 'prismarine_shard', 'A ring of every colour at your feet.'],
  ['aura_snow', 'aura', 'Snow Globe', 'r', 'snowball', 'Snow falling round you.'],
  ['aura_raincloud', 'aura', 'Rain Cloud', 'r', 'white_wool', 'A little cloud raining on you.'],
  ['aura_storm', 'aura', 'Thunder Cloud', 'e', 'cobweb', 'A dark cloud with sparks.'],
  ['aura_bubbles', 'aura', 'Bubbles', 'c', 'heart_of_the_sea', 'Bubbles floating up.'],
  ['aura_fireflies', 'aura', 'Fireflies', 'r', 'glow_berries', 'Little lights wandering round you.'],
  ['aura_galaxy', 'aura', 'Galaxy', 'l', 'amethyst_shard', 'Stars of purple and blue orbiting you.'],
  ['aura_helix', 'aura', 'Double Helix', 'e', 'end_rod', 'Two spirals, red and blue.'],
  ['aura_frost', 'aura', 'Frost', 'r', 'packed_ice', 'Ice sparkling round your feet.'],
  ['aura_gold', 'aura', 'Gold Dust', 'r', 'gold_nugget', 'Gold falling like snow.'],
  ['aura_emerald', 'aura', 'Emerald Glow', 'r', 'emerald', 'Green sparkles all round you.'],
  ['aura_redstone', 'aura', 'Redstone Charge', 'c', 'redstone', 'Red dust spinning round you.'],
  ['aura_void', 'aura', 'The Void', 'e', 'ink_sac', 'Dark smoke rising from your feet.'],
  ['aura_sakura', 'aura', 'Cherry Blossom', 'r', 'cherry_leaves', 'Pink petals falling.'],
  ['aura_autumn', 'aura', 'Autumn Leaves', 'c', 'oak_leaves', 'Red and gold leaves falling.'],
  ['aura_lava', 'aura', 'Lava Drip', 'e', 'magma_cream', 'Lava dripping from a ring over you.'],
  ['aura_crit', 'aura', 'Battle Sparks', 'c', 'iron_nugget', 'Sparks going round.'],
  ['aura_magic', 'aura', 'Arcane', 'r', 'dragon_breath', 'Magic going round the other way.'],
  ['aura_smoke', 'aura', 'Smoke Screen', 'c', 'gunpowder', 'Smoke rising round you.'],
  ['aura_angel', 'aura', 'Angel Wings', 'l', 'feather', 'White wings of light.'],
  ['aura_demon', 'aura', 'Demon Wings', 'l', 'fire_charge', 'Dark red wings.'],
  ['aura_sun', 'aura', 'Sun Halo', 'e', 'glowstone_dust', 'A ring of flame over your head.'],
  ['aura_ocean', 'aura', 'Ocean Waves', 'r', 'cyan_dye', 'Blue waves round your legs.'],
  ['aura_love', 'aura', 'Love Storm', 'r', 'pink_petals', 'Every now and then, a burst of hearts.'],

  ['trail_flame', 'trail', 'Flame Trail', 'r', 'blaze_powder', 'Flames where you walk.'],
  ['trail_soul', 'trail', 'Soul Trail', 'e', 'soul_lantern', 'Soul fire where you walk.'],
  ['trail_hearts', 'trail', 'Heart Trail', 'c', 'red_dye', 'Hearts left behind you.'],
  ['trail_notes', 'trail', 'Melody Trail', 'c', 'note_block', 'Music notes behind you.'],
  ['trail_rainbow', 'trail', 'Rainbow Trail', 'l', 'prismarine_crystals', 'Every colour behind you.'],
  ['trail_smoke', 'trail', 'Smoke Trail', 'c', 'gunpowder', 'A puff of smoke with each step.'],
  ['trail_cloud', 'trail', 'Cloud Walker', 'r', 'white_wool', 'Walk on little clouds.'],
  ['trail_sparkle', 'trail', 'Sparkle Trail', 'c', 'sugar', 'White sparkles behind you.'],
  ['trail_portal', 'trail', 'Ender Trail', 'e', 'ender_pearl', 'Purple specks where you walk.'],
  ['trail_enchant', 'trail', 'Rune Trail', 'r', 'experience_bottle', 'Runes floating up behind you.'],
  ['trail_redstone', 'trail', 'Redstone Trail', 'c', 'redstone', 'Red dust where you walk.'],
  ['trail_emerald', 'trail', 'Emerald Trail', 'r', 'emerald', 'Green sparkles behind you.'],
  ['trail_snow', 'trail', 'Snow Trail', 'c', 'snowball', 'Snowflakes where you walk.'],
  ['trail_lava', 'trail', 'Lava Trail', 'e', 'lava_bucket', 'Drops of lava behind you.'],
  ['trail_water', 'trail', 'Splash Trail', 'c', 'water_bucket', 'Splashes with every step.'],
  ['trail_bubble', 'trail', 'Bubble Trail', 'c', 'glass_bottle', 'Bubbles behind you.'],
  ['trail_crit', 'trail', 'Spark Trail', 'c', 'iron_nugget', 'Sparks where you walk.'],
  ['trail_magic', 'trail', 'Magic Trail', 'r', 'dragon_breath', 'Purple magic behind you.'],
  ['trail_cherry', 'trail', 'Blossom Trail', 'r', 'cherry_leaves', 'Pink petals behind you.'],
  ['trail_leaves', 'trail', 'Leaf Trail', 'c', 'oak_leaves', 'Green leaves behind you.'],
  ['trail_gold', 'trail', 'Golden Trail', 'e', 'gold_ingot', 'Gold dust where you walk.'],
  ['trail_ink', 'trail', 'Ink Trail', 'r', 'ink_sac', 'Black ink behind you.'],
  ['trail_frost', 'trail', 'Frost Trail', 'r', 'packed_ice', 'Frost sparkles where you walk.'],
  ['trail_glow', 'trail', 'Glow Trail', 'r', 'glow_ink_sac', 'Soft lights behind you.'],
  ['trail_confetti', 'trail', 'Confetti Trail', 'e', 'firework_star', 'Confetti everywhere you go.'],
  ['trail_stars', 'trail', 'Starlight Trail', 'e', 'nether_star', 'Little stars behind you.'],
  ['trail_footprints', 'trail', 'Footprints', 'c', 'leather_boots', 'Footprints where you step.'],
  ['trail_fire_smoke', 'trail', 'Wildfire Trail', 'e', 'fire_charge', 'Flames and smoke behind you.'],
  ['trail_ghost', 'trail', 'Ghost Trail', 'r', 'phantom_membrane', 'Pale wisps behind you.'],
  ['trail_electric', 'trail', 'Electric Trail', 'e', 'lightning_rod', 'Blue sparks where you walk.'],

  ['gad_pig', 'gadget', 'Pig Mount', 'r', 'carrot_on_a_stick', 'Ride your own pig. Use again to get off.'],
  ['gad_horse', 'gadget', 'Horse Mount', 'e', 'saddle', 'Ride a fast horse. Use again to get off.'],
  ['gad_secret', 'gadget', 'Secret Service', 'l', 'iron_chestplate', 'Four guards follow you for a minute.'],
  ['gad_grapple', 'gadget', 'Grappling Hook', 'e', 'fishing_rod', 'Cast it onto a block, then reel in to fly there.'],
  ['gad_boots', 'gadget', 'Double Jump Boots', 'e', 'golden_boots', 'Wear them, then jump again in the air.'],
  ['gad_jetpack', 'gadget', 'Jetpack', 'l', 'elytra', 'Hold the use button to fly up.'],
  ['gad_cannon', 'gadget', 'Human Cannon', 'e', 'tnt_minecart', 'Fire yourself where you look.'],
  ['gad_firework', 'gadget', 'Firework Launcher', 'r', 'firework_rocket', 'A firework bursting over you.'],
  ['gad_paintball', 'gadget', 'Paintball Gun', 'r', 'diamond_hoe', 'Paint the blocks you hit for a few seconds.'],
  ['gad_tnt', 'gadget', 'TNT Toss', 'e', 'tnt', 'A harmless blast that throws people about.'],
  ['gad_pearl', 'gadget', 'Endless Pearl', 'r', 'ender_pearl', 'Throw it and go where it lands.'],
  ['gad_snowball', 'gadget', 'Snowball Cannon', 'c', 'snowball', 'Snowballs that knock people back.'],
  ['gad_popper', 'gadget', 'Party Popper', 'c', 'firework_star', 'A burst of confetti.'],
  ['gad_disco', 'gadget', 'Disco Ball', 'l', 'sea_lantern', 'Lights and music over you for 15 seconds.'],
  ['gad_trampoline', 'gadget', 'Trampoline', 'e', 'slime_ball', 'A slime trampoline for 10 seconds.'],
  ['gad_freeze', 'gadget', 'Freeze Ray', 'e', 'ice', 'Slows down whoever you hit.'],
  ['gad_wand', 'gadget', 'Magic Wand', 'r', 'blaze_rod', 'Sparkles, and you float for a moment.'],
  ['gad_melon', 'gadget', 'Melon Thrower', 'c', 'melon_slice', 'A melon that bursts where it lands.'],
  ['gad_chicken', 'gadget', 'Chicken Bomb', 'r', 'egg', 'A chicken that pops into feathers.'],
  ['gad_smoke', 'gadget', 'Smoke Bomb', 'r', 'gunpowder', 'Smoke, and you vanish for 3 seconds.'],
  ['gad_moon', 'gadget', 'Moon Boots', 'r', 'feather', 'Low gravity until you use them again.'],
  ['gad_lightning', 'gadget', "Thor's Hammer", 'l', 'trident', 'Lightning where you aim (it hurts no one).'],
  ['gad_bubble', 'gadget', 'Bubble Blower', 'c', 'glass_bottle', 'Hold the use button to blow bubbles.'],
  ['gad_water', 'gadget', 'Water Balloon', 'c', 'light_blue_dye', 'A splash where it lands.'],
  ['gad_speed', 'gadget', 'Speed Shoes', 'r', 'sugar', 'Run fast until you use them again.'],
  ['gad_cloak', 'gadget', 'Invisibility Cloak', 'e', 'phantom_membrane', 'Vanish for 8 seconds.'],
  ['gad_glow', 'gadget', 'Glow Stick', 'c', 'glow_ink_sac', 'Glow until you use it again.'],
  ['gad_jukebox', 'gadget', 'Jukebox', 'l', 'jukebox', 'A song for everyone near you.'],
  ['gad_blink', 'gadget', 'Teleport Stick', 'e', 'end_rod', 'Jump eight blocks ahead.'],
  ['gad_rocket', 'gadget', 'Rocket Ride', 'l', 'firework_rocket', 'Shoot up into the sky and float down.'],

  ['backpack', 'special', 'Backpack', 'l', 'bundle', 'Holds the cosmetics you are not carrying.'],
];
export const COS = new Map(COSMETICS.map(c => [c[0], { id: c[0], cat: c[1], name: c[2], rarity: c[3], icon: c[4], what: c[5], color: c[6] }]));
export const catOf = id => (COS.get(id) || {}).cat || '';
