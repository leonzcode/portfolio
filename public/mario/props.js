/* ---------------------------------------------------------------------------
   Leon Kart - the furniture round the circuit.

   Kenney's Racing Kit, CC0, loaded once and then instanced: barriers down both
   edges, stands and banner towers where a crowd would stand, cones on the apex
   of the tight corners, a gantry over the start line. The models are small and
   share a handful of flat materials, so the whole circuit costs about twenty
   draw calls rather than one per post.

   Everything here is decoration. If the models fail to arrive the race is
   exactly the same race, which is why buildProps is fired and forgotten rather
   than awaited: the track is drivable before the scenery turns up.

   Sizes are in the kit's own units, where a road tile is one across. The SCALE
   table below turns each one into metres for this circuit, whose road is about
   sixteen to twenty-two metres wide.
--------------------------------------------------------------------------- */
import { GLTFLoader } from '/legacy/vendor/three-addons-0.163.0/loaders/GLTFLoader.js';
import { dressOf } from './themes.js?v=68';

/* Which part of a place's palette each model wears. The kit is one kit, so
   without this every circuit has the same green trees and the same red barriers
   standing round it and the theme stops at the kerb. */
const WEARS = {
  treeLarge: 'tree', treeSmall: 'tree',
  barrierRed: 'barrier', barrierWhite: 'barrier',
  rail: 'barrier', railDouble: 'barrier', fenceStraight: 'metal', fenceCurved: 'metal',
  grandStandCovered: 'metal', grandStand: 'metal',
  grandStandAwning: 'metal', grandStandRound: 'metal', grandStandCoveredRound: 'metal',
  lightPostModern: 'metal', lightPostLarge: 'metal', overheadLights: 'metal',
  pitsGarage: 'metal', pitsGarageClosed: 'metal', pitsOffice: 'metal', pitsOfficeRoof: 'metal',
  radarEquipment: 'metal', pylon: 'cloth',
  flagCheckers: 'cloth', flagCheckersSmall: 'cloth', flagGreen: 'cloth', flagRed: 'cloth',
  bannerTowerRed: 'cloth', bannerTowerGreen: 'cloth',
  billboard: 'cloth', billboardLow: 'cloth', billboardLower: 'cloth',
  tentLong: 'cloth', tent: 'cloth', tentClosed: 'cloth', tentRoof: 'cloth',
};


/* ---- landmarks --------------------------------------------------------------
   A few small scenes out in each place's country, the kind of thing you catch
   out of the corner of your eye on the way past: a wheat field and a campsite
   in the meadow, a camp and a stand of cacti on the dunes, a Christmas tree
   with presents, a reindeer and a toy train on the glacier, fire pits at Ember
   Hollow. Each is a list of [model, across, along, height, turn] in metres
   from its middle; the middle is found at run time, somewhere open. */
function wheatField(cols, rows, gap) {
  const out = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    out.push(['nature/crops_wheatStageB', (c - (cols - 1) / 2) * gap, (r - (rows - 1) / 2) * gap, 1.5, (c + r) * 0.7]);
  }
  for (let c = 0; c < cols + 1; c++) {
    out.push(['nature/fence_simple', (c - cols / 2) * gap, -((rows + 1) / 2) * gap, 1.2, 0]);
    out.push(['nature/fence_simple', (c - cols / 2) * gap, ((rows + 1) / 2) * gap, 1.2, 0]);
  }
  return out;
}
const CAMP = [
  ['nature/tent_detailedOpen', 0, 0, 3.4, 0.3], ['nature/tent_smallClosed', 7, 3, 2.4, -0.5], ['nature/campfire_stones', 3, -4, 0.6, 0],
  ['nature/campfire_logs', 3, -4, 0.7, 0], ['nature/log_stack', -5, -3, 1.2, 1.2], ['nature/log_stack', -6, 1, 1.1, 0.4],
];
const LANDMARKS = {
  meadow: [wheatField(6, 5, 2.6), CAMP, wheatField(4, 7, 2.6)],
  dunes: [
    CAMP,
    [['nature/cactus_tall', 0, 0, 9, 0], ['nature/cactus_tall', 5, 3, 7, 1], ['nature/cactus_short', -4, 2, 3, 2],
     ['nature/cactus_tall', -3, -5, 8, 3], ['nature/cactus_short', 6, -4, 2.5, 4], ['nature/rock_largeA', 1, 6, 3, 0]],
  ],
  frost: [
    [['holiday/tree-decorated-snow', 0, 0, 9, 0], ['holiday/present-a-round', 2.4, 1, 0.9, 0.3], ['holiday/present-b-cube', -2.2, 1.5, 0.8, 0.9],
     ['holiday/present-a-round', 1, -2.6, 0.7, 1.4], ['holiday/present-b-cube', -1.6, -2.2, 1, 0.2], ['holiday/reindeer', 7, 2, 2.4, -1.2],
     ['holiday/reindeer', 8, -1, 2.2, -1.6], ['holiday/sled', 5, -4, 1.1, 0.5], ['holiday/snowman', -7, 3, 2.6, 0.8]],
    [['holiday/train-locomotive', 0, 0, 3.2, 0], ['holiday/train-tender', 0, -5.2, 2.8, 0], ['holiday/train-wagon', 0, -10.4, 2.8, 0],
     ['holiday/train-wagon', 0, -15.6, 2.8, 0], ['holiday/snow-pile', 4, -6, 1.4, 0], ['holiday/snowman', -4, 3, 2.4, 2]],
  ],
  ember: [
    [['nature/campfire_stones', 0, 0, 1, 0], ['nature/log_stack', 3, 1, 1.2, 0.5], ['nature/stump_oldTall', -3, 2, 1.4, 1]],
    [['nature/campfire_stones', 0, 0, 1, 0.4], ['nature/rock_tallC', 5, 2, 6, 0], ['nature/rock_tallE', -4, 4, 7, 1]],
  ],
};

const DIR = 'models/';
/* What grows where. [model, weight, share of the height range]. */
const SCENERY = {
  meadow: {
    tree: [['nature/tree_default', 3], ['nature/tree_oak', 3], ['nature/tree_detailed', 2], ['nature/tree_fat', 2],
           ['nature/tree_pineRoundA', 2], ['nature/tree_pineTallA_detailed', 2, 1.2]],
    treeH: [7, 14],
    // the kit's leaves are a sea green; a meadow's are grass green
    tint: { 'nature/tree_default': 0xc8ff8a, 'nature/tree_oak': 0xc8ff8a, 'nature/tree_detailed': 0xd8ff90,
            'nature/tree_fat': 0xc0f080, 'nature/tree_pineRoundA': 0xb0e090, 'nature/tree_pineTallA_detailed': 0xa8d890,
            'nature/plant_bushLarge': 0xc8ff8a },
    scrub: [['nature/flower_redA', 2], ['nature/flower_yellowA', 2], ['nature/flower_purpleA', 2],
            ['nature/grass_large', 4], ['nature/plant_bushLarge', 2, 1.6], ['nature/rock_smallA', 1],
            ['nature/mushroom_redGroup', 1]],
    scrubH: [0.5, 1.2],
  },
  dunes: {
    tree: [['nature/cactus_tall', 4], ['nature/cactus_short', 3, 0.6], ['nature/rock_tallA', 2], ['nature/rock_tallB', 2],
           ['nature/rock_largeA', 2, 0.6], ['nature/tree_palmTall', 1, 1.2]],
    treeH: [5, 11],
    tint: { 'nature/rock_tallA': 0xe0955e, 'nature/rock_tallB': 0xd88a55, 'nature/rock_largeA': 0xe0955e,
            'nature/rock_smallC': 0xe0a070, 'nature/grass_large': 0xe8c878 },
    scrub: [['nature/rock_smallC', 3], ['nature/cactus_short', 1, 1.8], ['nature/grass_large', 2]],
    scrubH: [0.5, 1.2],
  },
  frost: {
    tree: [['holiday/tree-snow-a', 3], ['holiday/tree-snow-b', 3], ['holiday/tree-snow-c', 4], ['holiday/rocks-large', 0.5, 0.4]],
    treeH: [8, 15],
    scrub: [['holiday/snow-pile', 5], ['holiday/rocks-small', 1], ['holiday/snowman', 0.7, 2.2], ['holiday/present-a-cube', 0.3]],
    scrubH: [0.7, 1.5],
  },
  neon: {
    tree: [['city/low-detail-building-a', 2], ['city/low-detail-building-b', 2], ['city/low-detail-building-c', 2],
           ['city/low-detail-building-d', 2], ['city/low-detail-building-e', 2], ['city/low-detail-building-f', 2],
           ['city/low-detail-building-g', 2], ['city/low-detail-building-h', 2],
           ['city/building-skyscraper-a', 1, 1.8], ['city/building-skyscraper-b', 1, 1.8], ['city/building-skyscraper-c', 1, 2],
           ['city/building-skyscraper-d', 1, 2], ['city/building-skyscraper-e', 1, 2.2]],
    treeH: [16, 34],
    nearH: 0.45,                // a street by the kerb, not a canyon
    skyline: [['city/building-skyscraper-a', 1], ['city/building-skyscraper-b', 1], ['city/building-skyscraper-c', 1],
              ['city/building-skyscraper-d', 1], ['city/building-skyscraper-e', 1]],
    skyGlow: 1.6,
    skylineFar: [['city/low-detail-building-a', 1, 2.4], ['city/low-detail-building-c', 1, 2.4],
                 ['city/low-detail-building-e', 1, 2.4], ['city/low-detail-building-g', 1, 2.4]],
    glow: 0.4,
    scrub: [['holiday/lantern', 2], ['city/detail-parasol-a', 1, 1.4]],
    scrubH: [1.6, 2.4],
  },
  ember: {
    tree: [['nature/tree_thin_dark', 2], ['nature/tree_blocks_dark', 1], ['nature/rock_tallC', 3], ['nature/rock_tallE', 3],
           ['nature/stone_tallA', 2], ['nature/stump_oldTall', 1, 0.35]],
    treeH: [6, 13],
    tint: { 'nature/tree_thin_dark': 0x6a5a55, 'nature/tree_blocks_dark': 0x6a5048, 'nature/rock_tallC': 0x6a4a44,
            'nature/rock_tallE': 0x5a4040, 'nature/stone_tallA': 0x6a4a44, 'nature/rock_smallC': 0x5a4040,
            'nature/stump_oldTall': 0x5a4a44, 'nature/log_large': 0x5a4a44 },
    scrub: [['nature/rock_smallC', 3], ['nature/log_large', 1], ['nature/stump_oldTall', 1]],
    scrubH: [0.4, 1.1],
  },
};


/* The hoarding at the side of the road. The kit's billboard comes with a made
   up company printed on it, and this is Leon's circuit, so it carries his
   address instead. One canvas, drawn once and shared by every board on the
   lap; the material it replaces is the only one in the kit with a picture on
   it, which is what makes it safe to find by name. */
let adTex = null;
function billboardTex(THREE) {
  if (adTex) return adTex;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#17223b'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#ffd233';
  g.fillRect(0, 0, 512, 16);
  g.fillRect(0, 240, 512, 16);
  g.fillStyle = '#fff6e2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  /* Sized to the board rather than guessed at. The panel takes the whole of
     this canvas, so a line set at a fixed size and found to be wider than it
     is simply loses its first and last letters, which is a hoarding reading
     eonzhao.de. */
  const TEXT = 'leonzhao.dev';
  let px = 88;
  do {
    g.font = 'bold ' + px + 'px Verdana, Geneva, sans-serif';
    px -= 2;
  } while (px > 20 && g.measureText(TEXT).width > 448);
  g.fillText(TEXT, 256, 132);
  adTex = new THREE.CanvasTexture(c);
  adTex.anisotropy = 4;
  return adTex;
}
const SCALE = {
  grandStandCovered: 9, grandStand: 9,
  grandStandAwning: 9, grandStandRound: 9, grandStandCoveredRound: 9,
  bannerTowerRed: 7, bannerTowerGreen: 7,
  barrierRed: 9, barrierWhite: 9,
  treeLarge: 6, treeSmall: 6,
  tentLong: 7, tent: 7, tentClosed: 7, tentRoof: 7,
  lightPostModern: 9, flagCheckers: 7, flagCheckersSmall: 7,
  flagGreen: 7, flagRed: 7,
  billboard: 8, billboardLow: 8, billboardLower: 8,
  fenceStraight: 9, fenceCurved: 9,
  pitsGarage: 9, pitsGarageClosed: 9, pitsOffice: 9, pitsOfficeRoof: 9,
  pylon: 6, lightPostLarge: 9, lightColored: 8, lightRed: 8, lightRedDouble: 8,
  overheadLights: 9, radarEquipment: 7, rail: 9, railDouble: 9,
};

/* The lit windows of a city palette, worked out once per texture: every
   window-blue square becomes a light, everything else goes dark. */
const glowCache = new Map();
function windowGlow(tex, THREE) {
  if (glowCache.has(tex)) return glowCache.get(tex);
  const img = tex.image;
  if (!img || !img.width) return tex;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    const window_ = b > 140 && b > r + 25 && b >= gg;
    if (window_) {
      // most lit warm, some cool, in blocks of the palette rather than per pixel
      const warm = ((i >> 6) % 5) !== 0;
      px[i] = warm ? 255 : 190; px[i + 1] = warm ? 214 : 225; px[i + 2] = warm ? 150 : 255;
    } else { px[i] = px[i + 1] = px[i + 2] = 0; }
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = tex.flipY;
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  glowCache.set(tex, t);
  return t;
}

/* one load per model, however many times it is asked for */
const cache = new Map();
function load(loader, name) {
  if (!cache.has(name)) {
    cache.set(name, new Promise((res, rej) => loader.load(DIR + name + '.glb', res, undefined, rej)));
  }
  return cache.get(name);
}

/* Flatten a loaded model to the meshes it is really made of, with its own
   hierarchy baked into the geometry, so each one can become a single
   InstancedMesh no matter how the kit nested it.

   And then move it onto its own origin. The kit does not draw these models
   where their node sits: a barrier's mesh is the better part of a unit away
   from it, which at the scale used here is nearly six metres. Anything placed
   by its node therefore lands six metres from where it was asked to be, which
   is a barrier you bump into before you reach it and a tree in the wrong
   field. Centre the footprint on x and z, stand the feet on y = 0, and then a
   spot means a spot. */
function parts(root, THREE) {
  const out = [];
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    g.computeBoundingBox();
    box.union(g.boundingBox);
    out.push({ geometry: g, material: o.material });
  });
  if (out.length) {
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    for (const part of out) part.geometry.translate(-cx, -box.min.y, -cz);
  }
  const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
  return { list: out, size };
}

export async function buildProps(scene, THREE, track, current) {
  const still = () => !current || current();
  const dress = dressOf(track.theme);
  const glow = track.theme.glow || 0;
  const loader = new GLTFLoader();
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion();
  const euler = new THREE.Euler(), scl = new THREE.Vector3();

  // spots are { pos, yaw, scale }; one model, however many of them
  async function put(name, spots, faceOn, reheight, opts = {}) {
    if (!spots.length) return;
    let gltf;
    try { gltf = await load(loader, name); } catch (e) { return; }
    // the lobby moved on while this was loading; this scenery is for a circuit
    // that is not there any more
    if (!still()) { if (group.parent) scene.remove(group); return; }
    const base = SCALE[name] || 1;
    const model = parts(gltf.scene, THREE);
    // a model that is meant to stand ON a line rather than straddle it gets
    // pushed back by half its depth, so its near face lands on the spot
    if (faceOn) {
      const halfDepth = model.size.z * base / 2;
      for (const sp of spots) {
        sp.pos.x -= Math.sin(sp.yaw) * halfDepth;
        sp.pos.z -= Math.cos(sp.yaw) * halfDepth;
        // and take the height again where it actually ended up: moving it half a
        // metre and keeping the old y leaves it in the air wherever the road is
        // not flat across, which with one sided ramps is most of a lap
        if (reheight) sp.pos.y = reheight(sp.pos);
      }
    }
    /* The last word on where a thing is, taken after it has been pushed back
       onto its own face rather than when it was listed. That push moves a deep
       model - a hoarding is several metres front to back - and it happens here,
       long after the list was vetted, so a billboard checked out in the open
       could still come to rest inside a hillside. Asked again, at the end, of
       the position that is actually used. */
    spots = spots.filter(sp => !inHill(sp.pos));
    if (!spots.length) return;
    for (const part of model.list) {
      /* The kit's own material, tinted to this place. It has to be a copy: the
         materials are shared between models inside a glb, and painting the
         original would repaint the same trees on every circuit after it. A
         trunk keeps the bark colour and everything else takes the model's, so
         a tinted tree does not end up with a green trunk. */
      const mat = part.material.clone();
      // the one material in the kit that carries a printed sign
      if (part.material.name === 'tankco') {
        const t = billboardTex(THREE);
        if (mat.map) {
          t.wrapS = mat.map.wrapS;
          t.wrapT = mat.map.wrapT;
          t.flipY = mat.map.flipY;
          if (mat.map.colorSpace) t.colorSpace = mat.map.colorSpace;
        }
        t.needsUpdate = true;
        mat.map = t;
      }
      /* The Nature kit leaves its materials at glTF's default of fully metallic,
         and a metal with nothing to reflect is black: the whole wood came out as
         silhouettes. Scenery is painted wood and stone, so it is made matte. */
      if (name.indexOf('/') > 0 && mat.metalness !== undefined) {
        mat.metalness = 0;
        mat.roughness = Math.max(0.75, mat.roughness || 0);
        /* The kit's colours are given as linear numbers, and with the metal
           taken off they come out washed pale - a pink tent, beige logs. A
           little more depth puts them back near what the kit shows. */
        if (!mat.map && mat.color) mat.color.multiplyScalar(0.82);
      }
      // a place's own colour on a model from another kit: red rock, ash, dry grass
      if (opts.tint !== undefined && mat.color) mat.color.multiply(new THREE.Color(opts.tint));
      /* A city after dark: the buildings' own colours, faintly lit from inside,
         so they read as a street rather than as black blocks. */
      if (opts.glow && mat.map) {
        /* After dark a building is its windows. The facade is darkened and a
           glow map made from the palette lights only its window squares - the
           blue ones - warm or cool, so the street reads as night with people
           in it rather than as white blocks under a floodlight. */
        mat.color.multiply(new THREE.Color(0x5a6088));
        mat.emissive = new THREE.Color(0xffffff);
        mat.emissiveMap = windowGlow(mat.map, THREE);
        mat.emissiveIntensity = opts.glow * 2.2;
      }
      const key = WEARS[name];
      if (key) {
        const brown = mat.color && mat.color.r > mat.color.b * 1.15 && mat.color.g < mat.color.r * 0.85;
        const tint = key === 'tree' && brown ? dress.bark : dress[key];
        if (tint !== undefined) mat.color.multiplyScalar(1).multiply(new THREE.Color(tint));
        /* On a circuit that races after dark the barriers light themselves.
           They are the line between road and not road, and on Neon Mile they
           are the only thing that tells you where it goes. */
        if (glow && key === 'barrier') {
          mat.emissive = mat.color.clone();
          mat.emissiveIntensity = glow * 0.55;
        }
      }
      const im = new THREE.InstancedMesh(part.geometry, mat, spots.length);
      im.name = name;
      spots.forEach((sp, i) => {
        euler.set(0, sp.yaw || 0, 0);
        quat.setFromEuler(euler);
        // a spot can ask for a height instead of a scale: models from other kits
        // are all sorts of sizes, and a tree is a tree height however it was drawn
        scl.setScalar(sp.h ? sp.h / Math.max(0.01, model.size.y) : base * (sp.scale || 1));
        m4.compose(sp.pos, quat, scl);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      /* Only the things close enough to the road for their shadow to land on
         it. Everything in the band behind the barrier - the wood, the catch
         fencing, the billboards, the floodlights, the marshal posts, several
         thousand tufts of grass - is a second pass through the shadow map for a
         shadow that falls in a field nobody drives on. */
      const FAR = ['treeLarge', 'treeSmall', 'fenceStraight', 'fenceCurved',
                   'billboard', 'billboardLow', 'billboardLower', 'lightPostLarge',
                   'flagGreen', 'flagRed', 'radarEquipment', 'pitsGarage', 'pitsOffice',
                   'tent', 'tentLong', 'grandStand', 'grandStandCovered'];
      im.castShadow = FAR.indexOf(name) < 0 && !opts.far;
      im.receiveShadow = true;
      im.frustumCulled = false;            // one box round the whole circuit is useless
      im.matrixWorldAutoUpdate = false;
      group.add(im);
    }
  }

  const L = track.length;
  /* Which way a model has to be turned depends on how the kit drew it. A
     barrier, a gantry and a long tent are long along their own x; a grandstand
     and a lamp are square in plan and face their own +z, with the tall back of
     the stand at -z and the seats looking out at +z. So there are two helpers:
     one that points a model's +z somewhere, one that points its +x somewhere. */
  const alongZ = (dx, dz) => Math.atan2(dx, dz);
  const alongX = (dx, dz) => Math.atan2(-dz, dx);
  const withRoad = a => alongX(a.t.x, a.t.z);            // lying along the tarmac
  // looking in at the road from `sgn` side of it
  const facingRoad = (a, sgn) => alongZ(-sgn * a.n.x, -sgn * a.n.z);
  // Off to the side the ground is not at road height: the road follows the hills
  // and so does the grass, but they part company a few metres out. Everything
  // standing on the field asks the ground how high it is.
  const side = (a, off) => {
    const p = a.p.clone().addScaledVector(a.n, off);
    p.y = track.groundY(p.x, p.z);
    return p;
  };
  /* The same, but measured against the road where the thing lands rather than
     the road it was measured from. Beside a divide the tarmac is half as wide
     again a few metres further along, so a hoarding put twelve metres off a
     normal stretch comes to rest on the wide one - a billboard standing in the
     road. Asked once and corrected, which is enough: the road does not change
     width twice in the few metres this moves anything. */
  const clearOf = (a, off) => {
    const want = Math.abs(off) - a.w;          // how far off the road it asked to be
    let p = side(a, off);
    const q = track.project(p.x, p.z, null);
    const over = q.half + want - Math.abs(q.lateral);
    return over > 0.05 ? side(a, off + Math.sign(off) * over) : p;
  };

  /* Nothing roadside where the road is inside a mountain. A tunnel already has
     walls - the bore is the barrier - and everything that usually lines a road
     is placed off the tarmac by a few metres, which inside a tunnel is a few
     metres into solid rock. A barrier runs through the wall, a lamp post
     stands in it, a tree grows out of the hillside: all of it reads as the
     mountain and the track passing through each other, which is exactly what
     it is. */
  const inTunnel = a => !!(a && a.tunnel);
  /* And the same asked of where a thing actually ends up rather than of the
     sample it was measured from. A tree placed twenty metres off a corner can
     come to rest nearest a stretch of road half a bend further round, and on a
     circuit with a tunnel in that bend that is a tree standing inside a
     mountain. The mountain is built out to about the bore plus the rocks that
     make it, so anything within that of a tunnel's centreline is inside it.

     The tunnel centrelines are gathered once and this is a distance check, not
     a search of the whole lap for every object on it. */
  const tunPts = track.samples.filter(a => a.tunnel).map(a => a.p);
  const NEAR = 54, WIDE = 46;
  const inHill = p => {
    if (!tunPts.length) return false;
    /* A cheap bound first: almost nothing on a circuit is anywhere near a
       tunnel, and asking the road where a point is costs a search of the whole
       lap. Only the handful that pass this are asked properly. */
    let close = false;
    for (let i = 0; i < tunPts.length; i++) {
      const dx = p.x - tunPts[i].x, dz = p.z - tunPts[i].z;
      if (dx * dx + dz * dz < NEAR * NEAR) { close = true; break; }
    }
    if (!close) return false;
    /* And then along the road rather than as the crow flies. A hill is built
       over the bored stretch and no further, so a barrier forty metres before
       a mouth is out in the open and belongs there - a plain distance test
       took those out too and left a gap in the fence on the approach. */
    const q = track.project(p.x, p.z, null);
    /* A sample or two either side of the nearest one as well. Right at a mouth
       the road can hand back a segment that skips the sample the point is
       actually closest to, and a billboard slips through on that. Four metres
       of slack is a post or two of fence, and it is inside the rock anyway. */
    const N = track.samples.length;
    for (let d = -2; d <= 2; d++) {
      if (track.samples[(q.i + d + N) % N].tunnel) return Math.abs(q.lateral) < WIDE;
    }
    return false;
  };
  // placed, then checked: the list only ever gets what is actually out in the open
  const clear = (list, o) => { if (!inHill(o.pos)) list.push(o); };

  /* ---- barriers down both edges ------------------------------------------ */
  /* The barrier has to stand on the surface the physics actually stops you at,
     and that surface is not a neat 3.2m offset from the tarmac.

     stepKart asks track.project where it is, and project answers with the offset
     from the NEAREST SAMPLE's centre. Round the outside of a corner the nearest
     sample is one further round, and measured from there the offset crosses the
     limit while the kart is still short of where a constant offset would put the
     wall. So the wall cuts the corner, and barriers drawn on the constant offset
     sit outside it: you bump into nothing, a few metres before you reach them.

     So ask the same question the physics asks. For each sample, walk outward and
     find the first offset at which project says you have hit, by bisection, and
     stand the barrier's front face there. What you can see is then what you hit,
     everywhere, including the corners.

     The kit draws a barrier from one end, with its front face on the origin and
     its body behind, which is what makes this work: the origin goes on the wall. */
  const STEP = 2.2;                        // the barrier is 2.25m, so joints overlap
  const red = [], white = [];

  // the first offset from this sample at which the physics says you have hit
  function wallAt(i, sgn) {
    const a = track.samples[i];
    let lo = a.w, hi = a.w + track.shoulder * 2.4;
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      const pr = track.project(a.p.x + a.n.x * sgn * mid, a.p.z + a.n.z * sgn * mid, i);
      if (Math.abs(pr.lateral) >= pr.wall) hi = mid; else lo = mid;
    }
    const p = a.p.clone().addScaledVector(a.n, sgn * hi);
    // on the road surface, which leans on a banked corner: standing them on the
    // field left the barrier below the tarmac on every bend
    p.y = track.project(p.x, p.z, i).y;
    return p;
  }

  for (const sgn of [1, -1]) {
    // the wall as a closed ring of points, then walked at an even spacing: round
    // the outside of a corner the edge is longer than the middle of the road, so
    // stepping along the centreline instead leaves holes you cannot see
    const ring = [];
    for (let i = 0; i < track.samples.length; i++) ring.push(wallAt(i, sgn));
    ring.push(ring[0].clone());
    let walked = 0, next = 0, n = 0;
    for (let i = 1; i < ring.length; i++) {
      const from = ring[i - 1], to = ring[i];
      const seg = Math.hypot(to.x - from.x, to.z - from.z);
      if (seg < 1e-6) continue;
      const dx = (to.x - from.x) / seg, dz = (to.z - from.z) / seg;
      // +x runs along the wall; pick the turn that leaves +z looking at the road
      const inward = track.samples[i % track.samples.length].p.clone().sub(to);
      const yaw = ((-dz) * inward.x + dx * inward.z) > 0 ? alongX(dx, dz) : alongX(-dx, -dz);
      /* Nothing to lean on where there is nothing to lean on. A causeway is a
         road with the ground taken away either side of it and a gap is no road
         at all; fencing either turns the one place on the circuit you can
         actually fall off into a corridor. */
      const here = track.samples[i % track.samples.length];
      const prev = track.samples[(i - 1 + track.samples.length) % track.samples.length];
      /* Either end of the segment, not just the far one. A barrier is placed
         somewhere along the run between two samples, so testing only one of
         them left a post or two standing just inside each mouth. */
      const open = here.gap || here.noFence || inTunnel(here) || inTunnel(prev);
      while (next <= walked + seg) {
        const at = next - walked;
        next += STEP;
        if (open) { n++; continue; }
        const pos = new THREE.Vector3(from.x + dx * at, 0, from.z + dz * at);
        // on the road, like the ring points it sits between: asking the ground
        // here put the barrier back under the tarmac on every banked corner
        pos.y = track.project(pos.x, pos.z, null).y;
        clear(n++ % 2 ? red : white, { pos, yaw });
      }
      walked += seg;
    }
  }
  const onRoad = p => track.project(p.x, p.z, null).y;
  put('barrierRed', red, true, onRoad);   // the face on the wall, the body behind it
  put('barrierWhite', white, true, onRoad);

  /* ---- where a crowd would stand ----------------------------------------- */
  const stands = [], covered = [];
  // three blocks of three, spaced by their own width so they sit side by side
  // instead of growing into one long wall, and far enough back not to loom
  for (const at of [0.02, 0.42, 0.72]) {
    for (let k = -1; k <= 1; k++) {
      const b = track.at((at * L + k * 10.5 + L) % L);
      if (inTunnel(b)) continue;
      const pos = clearOf(b, -(b.w + 16));
      clear(at < 0.1 ? covered : stands, { pos, yaw: facingRoad(b, -1) });
    }
  }
  put('grandStandCovered', covered);
  put('grandStand', stands);

  /* People in them. Two instanced meshes for the whole crowd, coloured per
     instance, seated in rows that climb toward the back the way the stand does.
     They are small and far away, so a body and a head is all anybody can make
     out and all they are given. */
  function crowd(spots, wide, deep, high) {
    if (!spots.length) return;
    const ROWS = 5, COLS = 8;
    const n = spots.length * ROWS * COLS;
    const body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 0.85, 0.4),
      new THREE.MeshStandardMaterial({ roughness: 0.9 }), n);
    const head = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.26, 7, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.95 }), n);
    const SHIRT = [0xe8402a, 0xffd233, 0x2b56d6, 0x43d94f, 0x8fd3ff, 0xfff6e2, 0xf4762a];
    const SKIN = [0xf0c8a0, 0xd9a273, 0xa9754c, 0x7a4f2e, 0xf7ddc0];
    const col = new THREE.Color();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1), tiny = new THREE.Vector3(1e-4, 1e-4, 1e-4);
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let i = 0;
    for (const sp of spots) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const empty = rnd() < 0.12;      // a few empty seats, or it reads as wallpaper
          const lx = (c / (COLS - 1) - 0.5) * wide * 0.78 + (rnd() - 0.5) * 0.3;
          const lz = deep * (0.3 - r / (ROWS - 1) * 0.5);
          const ly = high * (0.26 + r / (ROWS - 1) * 0.42);
          const cs = Math.cos(sp.yaw), sn = Math.sin(sp.yaw);
          // the stand's own yaw turns the row into place
          const wx = sp.pos.x + lx * cs + lz * sn;
          const wz = sp.pos.z - lx * sn + lz * cs;
          e.set(0, sp.yaw, 0); q.setFromEuler(e);
          const sz = empty ? tiny : one;
          m.compose(new THREE.Vector3(wx, sp.pos.y + ly, wz), q, sz);
          body.setMatrixAt(i, m);
          col.setHex(SHIRT[(rnd() * SHIRT.length) | 0]); body.setColorAt(i, col);
          m.compose(new THREE.Vector3(wx, sp.pos.y + ly + 0.56, wz), q, sz);
          head.setMatrixAt(i, m);
          col.setHex(SKIN[(rnd() * SKIN.length) | 0]); head.setColorAt(i, col);
          i++;
        }
      }
    }
    body.name = 'crowd'; head.name = 'crowd';
    for (const im of [body, head]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      im.castShadow = true;
      group.add(im);
    }
  }
  crowd(covered, 10, 10.2, 10.7);
  crowd(stands, 9, 9, 8.1);

  /* ---- banner towers, tall enough to see a corner coming ----------------- */
  const towersR = [], towersG = [];
  for (let k = 0; k < 10; k++) {
    const a = track.at((k / 10) * L);
    if (inTunnel(a)) continue;
    const pos = clearOf(a, (k % 2 ? 1 : -1) * (a.w + 8));
    clear(k % 2 ? towersR : towersG, { pos, yaw: facingRoad(a, k % 2 ? 1 : -1) });
  }
  put('bannerTowerRed', towersR);
  put('bannerTowerGreen', towersG);

  /* ---- trees, close enough to flick past --------------------------------- */
  const big = [], small = [];
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let s = 0; s < L; s += 7) {
    const a = track.at(s);
    for (const sgn of [1, -1]) {
      if (rnd() > 0.45) continue;
      if (inTunnel(a)) continue;
      const pos = clearOf(a, sgn * (a.w + 9 + rnd() * 16));
      clear(rnd() > 0.45 ? big : small, { pos, yaw: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.5 });
    }
  }
  /* And scrub, further out and much smaller, in the same list as the small
     trees rather than a list of its own. It is the same model, so a second
     instanced mesh of it would be a second set of draw calls for no reason,
     and two meshes sharing a name is a thing that reads as one. */
  for (let s = 0; s < L; s += 3.2) {
    const a = track.at(s);
    for (const sgn of [1, -1]) {
      if (rnd() > 0.55) continue;
      if (inTunnel(a)) continue;
      clear(small, { pos: clearOf(a, sgn * (a.w + 7 + rnd() * 24)),
                     yaw: rnd() * 6.28, scale: 0.16 + rnd() * 0.17 });
    }
  }
  /* ---- the country, in what each place grows ----------------------------
     The racing kit has one tree, tinted per circuit, and a tinted tree is
     still the same tree in every place. So each place draws its own from the
     Nature, Holiday and City kits (all CC0, kenney.nl): leafy trees, pines and
     flowers in the meadow; cacti, red rock and a palm or two on the dunes;
     snowy pines, snowmen and drifts on the glacier; streets of buildings round
     Neon Mile; burnt trees, stumps and scorched rock at Ember Hollow. Each
     spot keeps the place it was given above and takes a model and a height
     from its place's list; the far wood that track.js plants is swapped the
     same way once the models are in. */
  const set = SCENERY[track.theme.id];
  if (set) {
    const pickFrom = (list, r) => {
      const total = list.reduce((a, x) => a + x[1], 0);
      let v = r * total;
      for (const x of list) { v -= x[1]; if (v <= 0) return x; }
      return list[list.length - 1];
    };
    const deal = (spots, list, [h0, h1], near) => {
      const by = new Map();
      for (const sp of spots) {
        const m = pickFrom(list, rnd());
        const f = m[2] || 1;                  // a model's own share of the height range
        const one = { pos: sp.pos, yaw: rnd() * Math.PI * 2, h: (h0 + rnd() * (h1 - h0)) * f * (near ? set.nearH || 0.8 : 1) };
        if (!by.has(m[0])) by.set(m[0], []);
        by.get(m[0]).push(one);
      }
      return by;
    };
    // one mesh a model, whichever band its spots came from: fewer draws, and no
    // two meshes of the same thing to be told apart
    const all = new Map();
    const add = by => { for (const [name, spots] of by) all.set(name, (all.get(name) || []).concat(spots)); };
    add(deal(big.concat(small.filter(sp => (sp.scale || 1) > 0.4)), set.tree, set.treeH, true));
    add(deal(small.filter(sp => (sp.scale || 1) <= 0.4), set.scrub, set.scrubH));
    // the far wood
    /* Seven in ten of them. A kit tree is a few hundred triangles where the
       cone it replaces was twenty, and a wood two hundred metres off reads as a
       wood at seventy per cent as well as at a hundred. */
    const wood = (track.trees || []).filter(() => rnd() < 0.7).map(t => ({ pos: new THREE.Vector3(t.x, t.y, t.z) }));
    add(deal(wood, set.tree, set.treeH));
    const jobs = [];
    for (const [name, spots] of all) {
      jobs.push(put(name, spots, false, null, { tint: set.tint && set.tint[name], glow: set.glow, far: true }));
    }

    /* The landmarks: somewhere open for each, fifty to eighty metres off the
       road, well clear of every part of the lap and of each other. */
    const scenes = LANDMARKS[track.theme.id];
    if (scenes && scenes.length) {
      const S = track.samples, N = S.length;
      const gap = (x, z) => {
        let m = 1e18;
        for (let i = 0; i < N; i += 3) { const dx = S[i].p.x - x, dz = S[i].p.z - z; m = Math.min(m, dx * dx + dz * dz); }
        return Math.sqrt(m);
      };
      const sites = [];
      for (let k = 0; k < 90 && sites.length < scenes.length; k++) {
        const a = S[(k * 37 + 11) % N], sgn = k % 2 ? 1 : -1, d = a.w + 50 + rnd() * 30;
        const x = a.p.x + a.n.x * sgn * d, z = a.p.z + a.n.z * sgn * d;
        if (gap(x, z) < 40 || inHill({ x, y: 0, z })) continue;
        if (sites.some(t => Math.hypot(t.x - x, t.z - z) < 150)) continue;
        sites.push({ x, z, yaw: rnd() * Math.PI * 2 });
      }
      const lm = new Map();
      sites.forEach((site, n) => {
        const c = Math.cos(site.yaw), sn = Math.sin(site.yaw);
        for (const [name, dx, dz, h, turn] of scenes[n]) {
          const x = site.x + dx * c - dz * sn, z = site.z + dx * sn + dz * c;
          if (!lm.has(name)) lm.set(name, []);
          lm.get(name).push({ pos: new THREE.Vector3(x, track.groundY(x, z), z), yaw: -site.yaw + (turn || 0), h });
        }
      });
      for (const [name, spots] of lm) put(name, spots, false, null, { tint: set.tint && set.tint[name], far: true });
    }
    /* The horizon too, where a place has models for it: Neon Mile's towers
       become the city kit's skyscrapers, at the height each tower was. */
    const sky = track.skyline;
    const skyJobs = [];
    if (set.skyline && sky && sky.spots.length) {
      const by = new Map();
      for (const sp of sky.spots) {
        // the far ring, most of the way into the haze, is built from the plain blocks
        const m = pickFrom(sp.ring === 'far' && set.skylineFar ? set.skylineFar : set.skyline, rnd());
        if (!by.has(m[0])) by.set(m[0], []);
        by.get(m[0]).push({ pos: new THREE.Vector3(sp.x, sp.y, sp.z), yaw: sp.ry, h: sp.h * (m[2] || 1) });
      }
      for (const [name, spots] of by) {
        skyJobs.push(put(name, spots, false, null, { glow: set.glow ? set.glow * (set.skyGlow || 1) : 0, far: true }));
      }
    }
    /* The copses on the split islands, the same way: each cone and trunk
       becomes one of the place's trees, standing where it stood. */
    const isle = [];
    track.group.traverse(o => { if (o.name === 'isleTree') isle.push(o); });
    if (isle.length) {
      track.group.updateMatrixWorld(true);
      const by = new Map(), v = new THREE.Vector3();
      for (const top of isle) {
        top.getWorldPosition(v);
        const tall = top.userData.tall || 6;
        const m = pickFrom(set.tree.filter(x => !/rock|stone|building/.test(x[0])), rnd());
        if (!by.has(m[0])) by.set(m[0], []);
        by.get(m[0]).push({ pos: new THREE.Vector3(v.x, v.y - tall * 0.56, v.z), yaw: rnd() * 6.28, h: tall });
      }
      for (const [name, spots] of by) jobs.push(put(name, spots, false, null, { tint: set.tint && set.tint[name] }));
    }
    Promise.all(jobs).then(() => {
      if (!still()) return;
      for (const m of track.treeMeshes || []) m.visible = false;
      for (const top of isle) { top.visible = false; if (top.userData.trunk) top.userData.trunk.visible = false; }
    });
    if (skyJobs.length) Promise.all(skyJobs).then(() => {
      if (!still()) return;
      for (const m of sky.meshes) m.visible = false;
    });
  } else {
    put('treeLarge', big);
    put('treeSmall', small);
  }

  /* ---- lamps, and a paddock ---------------------------------------------- */
  const lamps = [];
  for (let s = 0; s < L; s += 34) {
    const a = track.at(s);
    if (inTunnel(a)) continue;
    clear(lamps, { pos: clearOf(a, -(a.w + 5.4)), yaw: facingRoad(a, -1) });
  }
  put('lightPostModern', lamps);

  const tents = [], longTents = [];
  const pad = track.at(0.11 * L);
  for (let k = 0; k < 5; k++) {
    const pos = clearOf(pad, -(pad.w + 20 + (k % 2) * 9));
    pos.x += Math.cos(k * 1.9) * 11;
    pos.z += Math.sin(k * 1.9) * 11;
    pos.y = track.groundY(pos.x, pos.z);
    clear(k % 2 ? tents : longTents, { pos, yaw: withRoad(pad) });
  }
  put('tent', tents);
  put('tentLong', longTents);

  /* ---- what fills the middle distance ------------------------------------
     Everything above is at the edge of the road. What makes a circuit read as
     a place rather than a ribbon is the band behind that: catch fencing, the
     backs of billboards, floodlights, a pit lane, marshal posts, radar dishes.
     All of it is from the same kit as the barriers and all of it is instanced,
     so a hundred and fifty new objects cost about a dozen draw calls.
  -------------------------------------------------------------------------- */
  {
    let sseed = 20260920;
    const rnd = () => { sseed = (sseed * 1103515245 + 12345) & 0x7fffffff; return sseed / 0x7fffffff; };
    const fence = [], boards = [], boardsLow = [], flood = [], marshalG = [], marshalR = [];
    const rails = [], dishes = [], pylons = [];
    for (let s = 0; s < L; s += 4.4) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      // catch fencing stands back behind the barrier, both sides, all the way
      for (const sgn of [1, -1]) {
        clear(fence, { pos: clearOf(a, sgn * (a.w + 5.2)), yaw: withRoad(a) });
      }
    }
    for (let s = 6; s < L; s += 26) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = ((s / 26) | 0) % 2 ? 1 : -1;
      // a guard rail in front of the fence on the outside of things
      clear(rails, { pos: clearOf(a, sgn * (a.w + 3.4)), yaw: withRoad(a) });
    }
    for (let s = 20; s < L; s += 61) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = ((s / 61) | 0) % 2 ? 1 : -1;
      clear(boards, { pos: clearOf(a, sgn * (a.w + 12)), yaw: facingRoad(a, sgn) });
    }
    for (let s = 44; s < L; s += 73) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = ((s / 73) | 0) % 2 ? -1 : 1;
      clear(boardsLow, { pos: clearOf(a, sgn * (a.w + 10)), yaw: facingRoad(a, sgn) });
    }
    for (let s = 12; s < L; s += 88) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      clear(flood, { pos: clearOf(a, (a.w + 15)), yaw: facingRoad(a, 1) });
    }
    for (let s = 34; s < L; s += 96) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = ((s / 96) | 0) % 2 ? 1 : -1;
      clear(sgn > 0 ? marshalG : marshalR, { pos: clearOf(a, sgn * (a.w + 6.4)), yaw: facingRoad(a, sgn) });
    }
    for (let s = 70; s < L; s += 180) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      clear(dishes, { pos: clearOf(a, -(a.w + 19)), yaw: rnd() * 6.28 });
    }
    /* Markers on the apex of things. The scrub that used to be here as well
       went up with the small trees: the kit does have a piece called grass, but
       it is a flat one metre square with no height at all - a ground decal, not
       a tuft - and scaled up to read from the road it became green wedges lying
       across the sand at Redrock Dunes, z fighting with the ground under them. */
    for (let s = 0; s < L; s += 17) {
      const a = track.at(s);
      if (inTunnel(a)) continue;
      const sgn = rnd() < 0.5 ? 1 : -1;
      clear(pylons, { pos: clearOf(a, sgn * (a.w + 1.6)), yaw: withRoad(a) });
    }
    /* Anything placed face on has to take its height again after it has been
       pushed back by half its depth, or it ends up standing at the height of
       the ground it used to be over. */
    const onGround = p => track.groundY(p.x, p.z);
    put('fenceStraight', fence, true, onGround);
    put('railDouble', rails, true, onGround);
    put('billboard', boards, true, onGround);
    put('billboardLow', boardsLow, true, onGround);
    put('lightPostLarge', flood);
    put('flagGreen', marshalG);
    put('flagRed', marshalR);
    put('radarEquipment', dishes);
    put('pylon', pylons);

    // a pit lane, once, on the straight before the line
    const pit = track.at((L - 150 + L) % L);
    const garages = [], offices = [];
    for (let k = 0; k < 6; k++) {
      const a = track.at(((L - 150 + k * 11) % L + L) % L);
      clear(k % 3 === 2 ? offices : garages, { pos: clearOf(a, -(a.w + 16)), yaw: facingRoad(a, -1) });
    }
    put('pitsGarage', garages, true, onGround);
    put('pitsOffice', offices, true, onGround);
    void pit;
  }

  /* ---- the start line ----------------------------------------------------- */
  // No gantry from the kit here: track.js already builds one over the line, in
  // the gold and navy the rest of the game is lettered in. Two would be the
  // barrier problem again.
  const start = track.at(0);
  put('flagCheckers', [
    { pos: side(start, start.w + 2.4), yaw: withRoad(start) },
    { pos: side(start, -(start.w + 2.4)), yaw: withRoad(start) },
  ]);

  return group;
}
