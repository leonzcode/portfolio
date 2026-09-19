/* ---------------------------------------------------------------------------
   Leon Cart - the five places you can race.

   A theme is not a palette. It is a palette *and* a set of rules: what the road
   does to the tyres, how much the rough costs you, how wide the circuit is, how
   steeply it banks, how many jumps and boxes and boosters it carries, which
   items come up, and the one or two things that happen to you here that do not
   happen anywhere else. Two races in the same place are still two different
   laps, because the circuit is drawn from the round's seed; but a lap of
   Glacier Pass never drives like a lap of Neon Mile, whatever the seed says.

   Nothing in here is anybody else's art. Each place is given a job the others do
   not do:

     Sunfield Loop   wide, forgiving, fast. The one you learn on. Hay rolls
                     across it and the cattle grids rattle you.
     Redrock Dunes   narrow and loose, with the worst run off on the calendar.
                     Boulders come down the banking and the wind pushes.
     Glacier Pass    the grip goes. Long slides, gentle banking, icicles from
                     the overhangs and drifts piled on the exits.
     Neon Mile       tight, grippy and technical. Light gates shut in your face
                     and the road is half booster.
     Ember Hollow    the dangerous one. Biggest jumps, biggest drift boost,
                     least room for error, and the ground erupts.

   `rules` is the whole of it. Every number is a multiplier on the common tuning
   unless it says otherwise, so 1 everywhere would be a plain race.
--------------------------------------------------------------------------- */

export const THEMES = [
  {
    id: 'meadow',
    // how much light there is in the air here, and how much the kerbs and the
    // road markings make for themselves after dark
    ambient: 0.28, glow: 0,
    /* What the scenery is wearing. The furniture round a circuit is the same
       kit everywhere, so without this every place has the same green trees and
       the same red barriers standing in it and the palette stops at the kerb.
       Each colour multiplies the model's own, so 0xffffff is the kit as drawn. */
    dress: { tree: 0x9ee06a, bark: 0xc79a62, barrier: 0xffffff, metal: 0xffffff, cloth: 0xffffff },
    name: 'Sunfield Loop',
    blurb: 'Open country, wide corners, and the hay coming across the road',
    sky: 0x4fb7ff, fog: 0x8fd3ff, fogNear: 260, fogFar: 640,
    skyTop: 0x2f8fe0, skyBot: 0xbfe8ff, cloud: 0.9,
    sun: 0xfff4d8, sunPower: 2.1, hemiSky: 0xcfeaff, hemiGround: 0x5f9a4a, hemiPower: 0.85,
    ground: '#57c04a', groundFleck: ['rgba(74,170,60,.55)', 'rgba(112,208,92,.5)'],
    blade: 'rgba(66,150,56,.55)',
    tarmac: '#5c616b', tarmacGrit: [88, 34, 6],
    kerbA: '#e8402a', kerbB: '#fff6e2',
    trunk: 0x8a5a36, leaf: 0x2f9440, treeShape: 'cone', treeCount: 420,
    features: ['bridge', 'tunnel', 'water'], split: true,
    signature: null,
    music: 'race',
    rules: {
      // the friendly one: it holds on, it forgives the grass, and there is
      // always another booster coming
      grip: 1.06, slide: 0, top: 1, accel: 1.06, offTop: 0.62,
      driftCharge: 1, boost: 1, hop: 1,
      width: 1.15, bank: 1, ramps: 2, rampRise: 1.1,
      boxRows: 8, pads: 8, coneEvery: 26, coneBig: 0.12,
      items: { turbo: 1.6, peel: 1.4, bomb: 0.5, seeker: 0.7 },
      hazards: [
        { kind: 'roller', n: 5, look: 'hay', r: 2.2, speed: 9, period: 7.5, spin: 1 },
        { kind: 'rumble', n: 4, look: 'grid' },
      ],
    },
  },
  {
    id: 'dunes',
    // how much light there is in the air here, and how much the kerbs and the
    // road markings make for themselves after dark
    ambient: 0.3, glow: 0,
    dress: { tree: 0xc6cf7a, bark: 0xd9b07a, barrier: 0xffd8ad, metal: 0xf0d3ad, cloth: 0xffdfb4 },
    name: 'Redrock Dunes',
    blurb: 'Narrow, loose and hot, with boulders off the banking and wind on the straights',
    sky: 0xf0b071, fog: 0xf3c79a, fogNear: 200, fogFar: 560,
    skyTop: 0xd9853f, skyBot: 0xffdcae, cloud: 0.45,
    sun: 0xfff0c4, sunPower: 2.45, hemiSky: 0xffe0b0, hemiGround: 0xb06a3a, hemiPower: 0.9,
    ground: '#d9a25e', groundFleck: ['rgba(198,140,78,.55)', 'rgba(232,190,128,.5)'],
    blade: 'rgba(184,124,70,.5)',
    tarmac: '#8a7358', tarmacGrit: [140, 40, -12],
    kerbA: '#c9452f', kerbB: '#ffe7c2',
    trunk: 0x9a6b3c, leaf: 0x7aa05a, treeShape: 'cactus', treeCount: 260,
    features: ['bridge', 'tunnel'], split: true,
    signature: 'rocks',
    music: 'race',
    rules: {
      // quick in a straight line and merciless everywhere else: the sand takes
      // two thirds of your speed and the road is the narrowest with a fence
      grip: 0.9, slide: 0.25, top: 1.08, accel: 0.92, offTop: 0.36,
      driftCharge: 0.9, boost: 1.12, hop: 1,
      width: 0.92, bank: 1.25, ramps: 3, rampRise: 1.35,
      boxRows: 6, pads: 4, coneEvery: 20, coneBig: 0.3,
      items: { bomb: 1.8, star: 1.5, turbo: 1.2, slick: 0.6 },
      hazards: [
        { kind: 'roller', n: 6, look: 'boulder', r: 3.1, speed: 13, period: 6.2, spin: 1, heavy: 1 },
        { kind: 'gust', n: 4, force: 6, period: 5.4 },
        { kind: 'bog', n: 6, look: 'sand', grab: 0.55 },
      ],
    },
  },
  {
    id: 'frost',
    // how much light there is in the air here, and how much the kerbs and the
    // road markings make for themselves after dark
    ambient: 0.34, glow: 0,
    dress: { tree: 0x86b6a4, bark: 0xa08a74, barrier: 0xdcecfa, metal: 0xe4f1fb, cloth: 0xe8f4ff },
    name: 'Glacier Pass',
    blurb: 'The grip goes. Long slides, icicles overhead and drifts on the exits',
    sky: 0xbfe0f5, fog: 0xdcecf7, fogNear: 170, fogFar: 520,
    skyTop: 0x8ec4e8, skyBot: 0xeaf6ff, cloud: 1.0,
    sun: 0xe8f3ff, sunPower: 1.75, hemiSky: 0xe8f6ff, hemiGround: 0x9fb8c8, hemiPower: 1.0,
    ground: '#eef5fa', groundFleck: ['rgba(214,231,243,.6)', 'rgba(255,255,255,.55)'],
    blade: 'rgba(196,218,234,.5)',
    tarmac: '#6d7580', tarmacGrit: [120, 30, 10],
    kerbA: '#2b56d6', kerbB: '#fff6e2',
    trunk: 0x6b4a30, leaf: 0x2c6b4a, treeShape: 'cone', treeCount: 380,
    features: ['bridge', 'tunnel', 'water'], split: true,
    signature: 'ice',
    music: 'race',
    rules: {
      // the wheels turn and the kart carries on. Banking is kept gentle here on
      // purpose: camber you cannot hold is not a corner, it is a cliff
      grip: 0.78, slide: 0.55, top: 0.98, accel: 0.95, offTop: 0.55,
      driftCharge: 1.28, boost: 1.05, hop: 1,
      width: 1.05, bank: 0.7, ramps: 2, rampRise: 0.9,
      boxRows: 7, pads: 7, coneEvery: 24, coneBig: 0.16,
      items: { slick: 1.8, surge: 1.5, peel: 1.2, bomb: 0.6 },
      hazards: [
        { kind: 'faller', n: 7, look: 'icicle', period: 4.6, warn: 1.1 },
        { kind: 'bog', n: 7, look: 'drift', grab: 0.42 },
      ],
    },
  },
  {
    id: 'neon',
    // how much light there is in the air here, and how much the kerbs, the
    // barriers and the road markings make for themselves after dark
    ambient: 0.62, glow: 1.35,
    dress: { tree: 0x2f88c8, bark: 0x40507e, barrier: 0x8c9ad6, metal: 0x7d8fd4, cloth: 0x8f7fd0 },
    name: 'Neon Mile',
    blurb: 'Tight, grippy and technical. Light gates shut in your face',
    sky: 0x121a33, fog: 0x1b2444, fogNear: 120, fogFar: 460,
    skyTop: 0x080d22, skyBot: 0x2b3765, cloud: 0.12,
    sun: 0x9fb4ff, sunPower: 1.05, hemiSky: 0x5c6fb8, hemiGround: 0x1a2440, hemiPower: 1.05,
    ground: '#262d44', groundFleck: ['rgba(40,48,72,.6)', 'rgba(58,70,104,.5)'],
    blade: 'rgba(70,86,132,.45)',
    tarmac: '#31384a', tarmacGrit: [70, 26, 14],
    kerbA: '#ff2f6e', kerbB: '#8fe9ff',
    trunk: 0x2a3350, leaf: 0x39d0ff, treeShape: 'post', treeCount: 200,
    features: ['tunnel', 'bridge'], split: true,
    signature: 'towers',
    music: 'race',
    rules: {
      // it holds on like nothing else, so the road can afford to be the
      // narrowest on the calendar and the drift charges twice as quickly
      grip: 1.18, slide: 0, top: 1.02, accel: 1.12, offTop: 0.35,
      driftCharge: 1.35, boost: 1.18, hop: 1,
      width: 0.85, bank: 1.1, ramps: 3, rampRise: 1.25,
      boxRows: 8, pads: 11, coneEvery: 19, coneBig: 0.1,
      items: { turbo: 1.8, bolt: 1.6, surge: 1.3, peel: 0.7 },
      hazards: [
        { kind: 'gate', n: 5, period: 6.8, open: 0.55 },
        { kind: 'spring', n: 5, up: 11 },
      ],
    },
  },
  {
    id: 'ember',
    // how much light there is in the air here, and how much the kerbs and the
    // road markings make for themselves after dark
    ambient: 0.34, glow: 0.5,
    dress: { tree: 0x9a5a44, bark: 0x6b4038, barrier: 0xffb48a, metal: 0xc98a72, cloth: 0xd08a68 },
    name: 'Ember Hollow',
    blurb: 'Biggest jumps, biggest reward, and the ground erupts underneath you',
    sky: 0x39121a, fog: 0x5a1c1e, fogNear: 130, fogFar: 470,
    skyTop: 0x250810, skyBot: 0x8c2a1e, cloud: 0.22,
    sun: 0xffb072, sunPower: 1.5, hemiSky: 0xff8a5c, hemiGround: 0x2a1418, hemiPower: 0.95,
    ground: '#3a2e31', groundFleck: ['rgba(44,34,38,.6)', 'rgba(78,58,58,.5)'],
    blade: 'rgba(120,64,48,.45)',
    tarmac: '#3c3438', tarmacGrit: [74, 26, 8],
    kerbA: '#ff7a1a', kerbB: '#2b2226',
    trunk: 0x2e2226, leaf: 0x6b3430, treeShape: 'spire', treeCount: 240,
    features: ['bridge', 'tunnel'], split: true,
    signature: 'lava',
    music: 'race',
    rules: {
      // the gambler's circuit: four ramps, the biggest lip, the biggest drift
      // boost on the calendar, and the fewest boxes to bail you out with
      grip: 0.95, slide: 0.1, top: 1.05, accel: 1, offTop: 0.25,
      driftCharge: 1, boost: 1.25, hop: 1.1,
      width: 0.95, bank: 1.15, ramps: 4, rampRise: 1.45,
      boxRows: 5, pads: 5, coneEvery: 21, coneBig: 0.22,
      items: { bomb: 1.6, seeker: 1.5, star: 1.6, turbo: 1.2, peel: 0.6 },
      hazards: [
        { kind: 'geyser', n: 6, period: 5.8, up: 15, warn: 1.3 },
        { kind: 'faller', n: 8, look: 'ember', period: 3.4, warn: 0.8 },
      ],
    },
  },
];

/* Everything a theme does not say for itself. A place that sets nothing plays
   like a plain race, which is what makes the tables above readable: a number is
   only written down where it differs. */
export const BASE_DRESS = { tree: 0xffffff, bark: 0xffffff, barrier: 0xffffff, metal: 0xffffff, cloth: 0xffffff };
export const dressOf = th => Object.assign({}, BASE_DRESS, (th && th.dress) || {});

export const BASE_RULES = {
  grip: 1, slide: 0, top: 1, accel: 1, offTop: 0.48,
  driftCharge: 1, boost: 1, hop: 1,
  width: 1, bank: 1, ramps: 2, rampRise: 1.1,
  boxRows: 7, pads: 6, coneEvery: 23, coneBig: 0.16,
  items: {}, hazards: [],
};

export const rulesOf = th => Object.assign({}, BASE_RULES, (th && th.rules) || {});

export const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];
export const themeAt = i => THEMES[((i % THEMES.length) + THEMES.length) % THEMES.length];
