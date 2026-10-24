/* ---------------------------------------------------------------------------
   Leoncraft 2 - what villagers wear: painted here, our own pixels.

   As in the game a villager is drawn in layers over its skin, all on the
   villager's own shape (entities/mobmodels.js): the clothes of its biome
   (plains, desert, savanna, snow, taiga, jungle, swamp), then those of its
   profession (a farmer's straw hat, a butcher's apron, a librarian's tall
   hat...), then the badge of its level on the belt: stone for a novice
   (4 x 4), then iron, gold, emerald and diamond (2 x 3). Anything left clear
   shows the layer below.

   The villager's texture layout (64 x 64): head 0,0 (8 x 10 x 8) and the
   hat over it 32,0; nose 24,0; body 16,20 (8 x 12 x 6); the robe 0,38
   (8 x 18 x 6); the folded arms 44,22 (4 x 8 x 4) and 40,38 (8 x 4 x 4);
   legs 0,22 (4 x 12 x 4); a hat's brim 30,47 (16 x 16 x 1, its top face
   the brim's top).
--------------------------------------------------------------------------- */
import { addArt } from './mobart.js?v=107';

// the faces of a box at (u, v) of w x h x d: [x, y, w, h]
function faces(u, v, w, h, d) {
  return { top: [u + d, v, w, d], bottom: [u + d + w, v, w, d], right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h] };
}
const HEAD = faces(0, 0, 8, 10, 8), HAT = faces(32, 0, 8, 10, 8), BODY = faces(16, 20, 8, 12, 6), ROBE = faces(0, 38, 8, 18, 6);
const ARM = faces(44, 22, 4, 8, 4), MID = faces(40, 38, 8, 4, 4), LEG = faces(0, 22, 4, 12, 4), RIM = faces(30, 47, 16, 16, 1);
const SIDES = ['front', 'right', 'left', 'back'];
// paint rows of the sides of a box (rows counted from its top), all the way round
function band(p, F, y0, h, c, amt = 0.06) { for (const s of SIDES) { const [x, y, w] = F[s]; p.fill(x, y + y0, w, h, c, amt); } }
function cover(p, F, c, amt = 0.07) { for (const k in F) { const [x, y, w, h] = F[k]; p.fill(x, y, w, h, c, amt); } }

/* ---- the biomes' clothes ---- */
function robe(p, c, dark, belt) {
  cover(p, ROBE, c); cover(p, BODY, c); cover(p, ARM, c); cover(p, MID, c);
  p.speckle(0, 44, 28, 18, dark, 0.12);
  // the hands show at the ends of the folded arms
  p.fill(ARM.front[0], ARM.front[1] + 5, 4, 3, 0xb5876e); p.fill(MID.front[0] + 2, MID.front[1], 4, 4, c, 0.05);
  band(p, ROBE, 10, 1, belt, 0.04);
  cover(p, LEG, dark, 0.06);
  band(p, LEG, 10, 2, 0x3a2a1c, 0.05);                  // shoes
}
const TYPE_ART = {
  plains: p => robe(p, 0x6f4b2c, 0x5a3c22, 0x3a2716),
  desert: p => {
    robe(p, 0xc8a46c, 0xb08d58, 0x9c3a22);
    band(p, ROBE, 12, 6, 0xb89660);
    band(p, HAT, 2, 1, 0xb5452a); band(p, HAT, 3, 1, 0xe08a3a);   // the headband
  },
  savanna: p => {
    robe(p, 0x9e3d24, 0x83321c, 0xd6a03a);
    for (let x = 0; x < 28; x += 3) p.fill(x, 44 + 14, 2, 1, 0xd6a03a);
    band(p, ROBE, 4, 1, 0xd6a03a);
    band(p, HAT, 1, 2, 0xc8932e); band(p, HAT, 2, 1, 0x9e3d24);
  },
  snow: p => {
    robe(p, 0x4f6f9e, 0x3f5b85, 0xe8eef5);
    band(p, ROBE, 0, 2, 0xf0f2f6, 0.04); band(p, ROBE, 16, 2, 0xf0f2f6, 0.04);    // fur at the collar and hem
    // a fur hat
    band(p, HAT, 0, 3, 0xe9ecf2, 0.05); p.fill(HAT.top[0], HAT.top[1], 8, 8, 0xe2e6ee, 0.05);
    band(p, HAT, 2, 1, 0x4f6f9e);
  },
  taiga: p => {
    robe(p, 0x4b3a28, 0x3c2e20, 0x1f1812);
    band(p, ROBE, 0, 3, 0x8c6a42, 0.12);                    // a fur collar
    band(p, HAT, 0, 2, 0x5a4430, 0.08); p.fill(HAT.top[0], HAT.top[1], 8, 8, 0x5a4430, 0.08);
  },
  jungle: p => {
    robe(p, 0x5d7a30, 0x4a6326, 0x6b4a2a);
    band(p, ROBE, 14, 4, 0x6b4a2a);
    // leaves on the head
    p.fill(HAT.top[0], HAT.top[1], 8, 8, 0x3f8a2a, 0.12); band(p, HAT, 0, 2, 0x3f8a2a, 0.12);
    for (const s of SIDES) { const [x, y] = HAT[s]; p.px(x + 1, y + 2, 0x2f6e20); p.px(x + 5, y + 2, 0x2f6e20); }
  },
  swamp: p => {
    robe(p, 0x3d5536, 0x31462b, 0x5a4a2a);
    // a hood with moss on it
    band(p, HAT, 0, 3, 0x2f4428, 0.1); p.fill(HAT.top[0], HAT.top[1], 8, 8, 0x2f4428, 0.1);
    for (const s of ['right', 'left', 'back']) { const [x, y, w] = HAT[s]; p.fill(x, y + 3, w, 6, 0x2f4428, 0.1); }
    p.speckle(HAT.top[0], HAT.top[1], 8, 8, 0x5a8a3a, 0.3);
  },
};

/* ---- the professions' clothes and hats ---- */
function apron(p, c, rows = 18, from = 2) {
  const [x, y] = ROBE.front;
  p.fill(x + 1, y + from, 6, rows - from, c, 0.05);
  const [bx, by] = BODY.front;
  p.fill(bx + 2, by + 2, 4, 10, c, 0.05);
}
function hatBrim(p, top, under) {
  p.fill(RIM.front[0], RIM.front[1], 16, 16, top, 0.1);
  p.fill(RIM.back[0], RIM.back[1], 16, 16, under, 0.06);
  for (const s of ['right', 'left']) { const [x, y, w, h] = RIM[s]; p.fill(x, y, w, h, under); }
  for (const s of ['top', 'bottom']) { const [x, y, w, h] = RIM[s]; p.fill(x, y, w, h, under); }
}
function crown(p, c, rows, amt = 0.08) { band(p, HAT, 0, rows, c, amt); p.fill(HAT.top[0], HAT.top[1], 8, 8, c, amt); }
const PROF_ART = {
  armorer: p => {
    apron(p, 0x2f2f33);
    cover(p, ARM, 0x3a3a40); cover(p, MID, 0x3a3a40);
    // the welding mask: dark over the face with a slit for the eyes
    const [x, y] = HAT.front;
    p.fill(x, y + 1, 8, 8, 0x26262a, 0.05); p.fill(x + 1, y + 4, 6, 1, 0x7fd0ff);
    crown(p, 0x26262a, 1);
  },
  butcher: p => {
    apron(p, 0xe8e6de); p.speckle(ROBE.front[0] + 1, ROBE.front[1] + 6, 6, 10, 0xb02e26, 0.08);
    band(p, HAT, 2, 1, 0xb02e26, 0.04);
  },
  cartographer: p => {
    band(p, ROBE, 0, 18, 0x335c52, 0.08); band(p, ROBE, 10, 1, 0xd6b13a);
    const [x, y] = ROBE.front; p.fill(x + 3, y, 2, 18, 0xd6b13a);
    // a monocle on its right eye
    const [hx, hy] = HAT.front;
    p.px(hx + 0, hy + 4, 0xe0c040); p.px(hx + 1, hy + 3, 0xe0c040); p.px(hx + 2, hy + 3, 0xe0c040); p.px(hx + 3, hy + 4, 0xe0c040); p.px(hx + 1, hy + 5, 0xe0c040); p.px(hx + 2, hy + 5, 0xe0c040);
  },
  cleric: p => {
    band(p, ROBE, 0, 18, 0x6a2c86, 0.07); cover(p, BODY, 0x6a2c86); cover(p, ARM, 0x6a2c86); cover(p, MID, 0x6a2c86);
    p.fill(ARM.front[0], ARM.front[1] + 5, 4, 3, 0xb5876e);
    const [x, y] = ROBE.front; p.fill(x + 3, y, 2, 18, 0xe0c040); band(p, ROBE, 17, 1, 0xe0c040);
  },
  farmer: p => {
    crown(p, 0xd9b84c, 3, 0.12); band(p, HAT, 2, 1, 0x9a6a2a);
    hatBrim(p, 0xd9b84c, 0xb8973a);
    apron(p, 0x8a6a3c, 18, 8);
  },
  fisherman: p => {
    crown(p, 0x7a5a32, 3); hatBrim(p, 0x7a5a32, 0x5e4426);
    band(p, ROBE, 0, 12, 0x2e3f5a, 0.07); cover(p, BODY, 0x2e3f5a);
    band(p, ROBE, 10, 1, 0x1c1c1c);
  },
  fletcher: p => {
    crown(p, 0x3f6e2a, 3); band(p, HAT, 2, 1, 0x2a4a1c);
    const [x, y] = HAT.right; p.fill(x + 2, y - 0, 1, 4, 0xc0302a); p.fill(x + 3, y + 1, 1, 3, 0xe04a3a);   // the feather
    band(p, ROBE, 0, 9, 0x4a7a32, 0.08); cover(p, BODY, 0x4a7a32);
  },
  leatherworker: p => {
    apron(p, 0x7a4a26); band(p, ROBE, 10, 1, 0x3a2414);
    crown(p, 0x5c3a1e, 2);
    cover(p, ARM, 0x6a4022); cover(p, MID, 0x6a4022);
  },
  librarian: p => {
    // the tall red hat
    crown(p, 0x9e2a2a, 3, 0.06); band(p, HAT, 2, 1, 0x6e1a1a);
    band(p, ROBE, 0, 18, 0xe4dcc6, 0.05); cover(p, BODY, 0xe4dcc6);
    const [x, y] = ROBE.front; p.fill(x + 1, y + 2, 6, 7, 0x9e2a2a, 0.05);
    const [hx, hy] = HAT.front; p.fill(hx + 1, hy + 4, 2, 1, 0x2a2a2a); p.fill(hx + 5, hy + 4, 2, 1, 0x2a2a2a); p.px(hx + 3, hy + 4, 0x2a2a2a); p.px(hx + 4, hy + 4, 0x2a2a2a);
  },
  mason: p => {
    apron(p, 0x7e7e80); band(p, ROBE, 10, 1, 0x2a2a2a);
    cover(p, ARM, 0x5a5a5c); cover(p, MID, 0x5a5a5c);
    band(p, HAT, 1, 1, 0x9a9a9c);
  },
  shepherd: p => {
    crown(p, 0x6e4c2c, 2); hatBrim(p, 0x6e4c2c, 0x553a20);
    band(p, ROBE, 0, 4, 0xece6d6, 0.1); p.fill(BODY.top[0], BODY.top[1], 8, 6, 0xece6d6, 0.1);   // wool on the shoulders
    p.fill(MID.top[0], MID.top[1], 8, 4, 0xece6d6, 0.1);
  },
  toolsmith: p => {
    apron(p, 0x353538); band(p, ROBE, 10, 2, 0x6a4422);
    const [x, y] = ROBE.front; p.fill(x + 1, y + 10, 1, 3, 0xa0a0a6); p.fill(x + 6, y + 10, 1, 3, 0xa0a0a6);
    cover(p, ARM, 0x2a2a2c);
  },
  weaponsmith: p => {
    apron(p, 0x2b2b2e); band(p, ROBE, 17, 1, 0xa02a2a);
    // the eyepatch
    const [hx, hy] = HAT.front; p.fill(hx + 1, hy + 3, 3, 3, 0x111111); p.fill(hx, hy + 2, 8, 1, 0x111111);
  },
  nitwit: p => { band(p, ROBE, 0, 9, 0x4c7a2c, 0.08); cover(p, BODY, 0x4c7a2c); cover(p, ARM, 0x4c7a2c); cover(p, MID, 0x4c7a2c); p.fill(ARM.front[0], ARM.front[1] + 5, 4, 3, 0xb5876e); },
};

/* ---- the level badges on the belt ---- */
const BADGES = [[0x8a8a8a, 0x5c5c5c, 4, 4], [0xdcdcdc, 0x9a9a9a, 2, 3], [0xf5d23a, 0xb8901a, 2, 3], [0x2fd25e, 0x14853a, 2, 3], [0x62e8e2, 0x2a9e9a, 2, 3]];
BADGES.forEach(([c, edge, w, h], i) => addArt('villager_level_' + (i + 1), [64, 64], p => {
  const [x, y] = ROBE.front;
  const bx = x + (w === 4 ? 2 : 3), by = y + 10 - Math.floor(h / 2);
  p.fill(bx, by, w, h, c, 0.02);
  p.fill(bx, by + h - 1, w, 1, edge); if (w > 2) p.fill(bx + w - 1, by, 1, h, edge);
}));
/* ---- the wandering trader: a whole skin of its own (the villager's shape) ---- */
addArt('wandering_trader', [64, 64], p => {
  const skin = 0xbd8b72, dark = 0x9c6e58, blue = 0x2b4a8c, blueD = 0x1e3564, trim = 0xd9c48c, cloth = 0xddd4ae;
  cover(p, HEAD, skin, 0.05);
  const [fx, fy] = HEAD.front;
  p.fill(fx, fy + 3, 8, 1, 0x4a3426);                                  // the brow
  p.px(fx + 1, fy + 4, 0xffffff); p.px(fx + 2, fy + 4, 0x2e6a2a); p.px(fx + 5, fy + 4, 0x2e6a2a); p.px(fx + 6, fy + 4, 0xffffff);
  p.fill(fx + 2, fy + 8, 4, 1, dark);
  p.box(24, 0, 2, 4, 2, 0xae7c64, 0.05);                                // nose
  // the cloth over its head and down the back of the neck
  p.fill(HAT.top[0], HAT.top[1], 8, 8, cloth, 0.06); band(p, HAT, 0, 3, cloth, 0.06);
  for (const s of ['right', 'left', 'back']) { const [x, y, w] = HAT[s]; p.fill(x, y + 3, w, 7, cloth, 0.06); }
  band(p, HAT, 3, 1, 0xb8a878);
  // the blue robe with its gold edging, a brown belt
  cover(p, BODY, blue); cover(p, ROBE, blue); cover(p, ARM, blue); cover(p, MID, blue);
  p.speckle(0, 44, 28, 18, blueD, 0.15);
  band(p, ROBE, 17, 1, trim); band(p, ROBE, 9, 2, 0x5a3a20);
  const [rx, ry] = ROBE.front; p.fill(rx + 3, ry, 2, 9, trim);
  p.fill(ARM.front[0], ARM.front[1] + 5, 4, 3, skin);
  cover(p, LEG, blueD, 0.06); band(p, LEG, 10, 2, 0x3a2a1c, 0.05);
});
for (const t in TYPE_ART) addArt('villager_type_' + t, [64, 64], TYPE_ART[t]);
for (const n in PROF_ART) addArt('villager_prof_' + n, [64, 64], PROF_ART[n]);
