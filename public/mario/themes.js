/* ---------------------------------------------------------------------------
   Leon Cart - the five places you can race.

   Each one is a palette plus a short list of what the circuit is allowed to do
   with itself. The lap is still drawn from the round's seed, so a theme is not a
   fixed track: it is the weather, the ground, the sky and the furniture, and two
   races in the same place are still two different laps.

   Nothing in here is anybody else's art. The names, colours and signatures are
   chosen to give each one a job the others do not do: somewhere fast and open,
   somewhere hot and loose, somewhere cold where the grip goes, somewhere at
   night that is all walls and lights, and somewhere that wants watching.

   `signature` is the one thing a theme has that the others do not, and it is
   what you remember it by:
     ice    patches on the tarmac that take the grip away
     lava   pools off the racing line that throw you if you touch them
     towers a city that closes in either side of the road
     rocks  boulders standing in the run off
--------------------------------------------------------------------------- */

export const THEMES = [
  {
    id: 'meadow',
    name: 'Sunfield Loop',
    blurb: 'Open country, wide corners, and the hills to see them coming',
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
  },
  {
    id: 'dunes',
    name: 'Redrock Dunes',
    blurb: 'Hot, dusty and loose, with boulders where the road runs out',
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
  },
  {
    id: 'frost',
    name: 'Glacier Pass',
    blurb: 'Snow, pines and patches of ice that will take the car off you',
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
  },
  {
    id: 'neon',
    name: 'Neon Mile',
    blurb: 'A city at night, close walls, and the lights doing the talking',
    sky: 0x121a33, fog: 0x1b2444, fogNear: 120, fogFar: 460,
    skyTop: 0x080d22, skyBot: 0x2b3765, cloud: 0.12,
    sun: 0x9fb4ff, sunPower: 0.9, hemiSky: 0x3a4a8c, hemiGround: 0x101728, hemiPower: 0.75,
    ground: '#262d44', groundFleck: ['rgba(40,48,72,.6)', 'rgba(58,70,104,.5)'],
    blade: 'rgba(70,86,132,.45)',
    tarmac: '#31384a', tarmacGrit: [70, 26, 14],
    kerbA: '#ff2f6e', kerbB: '#8fe9ff',
    trunk: 0x2a3350, leaf: 0x39d0ff, treeShape: 'post', treeCount: 200,
    features: ['tunnel', 'bridge'], split: true,
    signature: 'towers',
    music: 'race',
  },
  {
    id: 'ember',
    name: 'Ember Hollow',
    blurb: 'Black rock and fire pools, and nowhere safe to put a wheel wrong',
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
  },
];

export const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];
export const themeAt = i => THEMES[((i % THEMES.length) + THEMES.length) % THEMES.length];
