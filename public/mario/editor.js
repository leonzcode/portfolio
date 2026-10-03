/* ---------------------------------------------------------------------------
   Leon Kart - the map builder.

   Building a map is like building in Minecraft: you fly about the world and
   put things where you are looking. WASD to fly, Space and Shift for up and
   down, the mouse to look (click the world to grab the mouse, Esc to let it
   go). Four tools on the bar along the bottom:

     1  Track    click to lay the next point of the road after the one picked
     2  Select   click a point to pick it, then change it in the panel: its
                 height (R / F), width, lean, the section it starts (ramp, hump,
                 gap, tunnel, bridge, water, boosters, ice...) and its barriers.
                 G picks it up and puts it down wherever you look.
     3  Objects  pick something from the panel and click to put it down.
                 Q / E turn it, Z / X size it.
     4  Erase    click a thing or a point to take it away.

   The settings panel is everything about the place itself: the sky, the fog,
   the ground (grass, hills, or nothing at all for a road in the sky), the
   colours of the road and its kerbs, the hills on the horizon, the trees, how
   many laps, item boxes, boosters.

   Y drives it: the map is built for real and you are on the line in a car.
   Y again comes back to building where the car was. P takes the picture shown
   for the map on the Custom maps page.

   A map is saved under a password, the way a Leoncraft minigame is: anybody
   can play it, only somebody with its password (or an admin) can change it.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { merge, vertexMat } from './parts.js?v=102';
import { THEMES, themeById, registerTheme } from './themes.js?v=102';
import { icon } from './icons.js?v=102';

let OBJ = null;                 // the object library, fetched with the builder
function objects() {
  if (!OBJ) OBJ = import('./mapobjects.js?v=102').then(m => m).catch(e => { console.warn('map objects', e); return { OBJECTS: [], CATEGORIES: [], objectById: () => null }; });
  return OBJ;
}

/* ---- a map, as data -------------------------------------------------------- */
export const SECTIONS = [
  ['road', 'Plain road'], ['ramp', 'Ramp (a jump)'], ['hump', 'Hump'], ['chasm', 'Gap to jump'],
  ['bridge', 'Bridge'], ['tunnel', 'Tunnel'], ['water', 'Water to drive through'], ['boostlane', 'Booster lane'],
  ['agrav', 'Anti-gravity'], ['narrows', 'Narrows'], ['arena', 'Wide open'], ['bowl', 'Banked bowl'],
  ['spiral', 'Climbing spiral'], ['shelf', 'Drop-off'], ['causeway', 'Causeway'], ['moguls', 'Rollers'],
  ['whoops', 'Bumps'], ['icestrip', 'Ice down one side'], ['sandstrip', 'Sand down one side'],
];
export const BARRIERS = [['wall', 'Barriers'], ['tyres', 'Tyre stacks'], ['fence', 'Fence'], ['neon', 'Neon rail'], ['none', 'None (you can fall off)']];
const SKYLINES = [['', 'None'], ['hill', 'Hills'], ['mesa', 'Mesas'], ['peak', 'Mountains'], ['volcano', 'Volcanoes'], ['tower', 'Towers']];
const TREES = [['cone', 'Pines'], ['round', 'Round trees'], ['cactus', 'Cactus'], ['spire', 'Spires'], ['none', 'No trees']];
const hex = v => '#' + (v >>> 0).toString(16).padStart(6, '0').slice(-6);
const num = h => parseInt(String(h).replace('#', ''), 16) || 0;

export function newMap() {
  const nodes = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    nodes.push({ x: Math.round(Math.cos(a) * 150), z: Math.round(Math.sin(a) * 95), y: 0, w: 10, seg: 'road', barrier: 'wall' });
  }
  return {
    v: 1, nodes, objects: [], laps: 3, items: true, pads: 4,
    look: { base: 'meadow', sky: '#4fb7ff', skyTop: '#2f8fe0', skyBot: '#bfe8ff', fog: '#8fd3ff', fogNear: 260, fogFar: 640,
            sun: '#fff4d8', sunPower: 2.1, ambient: 0.28, ground: 'flat', groundColour: '#57c04a', tarmac: '#5c616b',
            kerbA: '#e8402a', kerbB: '#fff6e2', skyline: 'hill', skyNear: '#6aa85c', skyFar: '#8fc07e', trees: 'cone', treeCount: 300, groundY: -1 },
  };
}
// the look of a built-in place, as a starting point for the settings
function lookFrom(base) {
  const t = themeById(base);
  return { base, sky: hex(t.sky), skyTop: hex(t.skyTop), skyBot: hex(t.skyBot), fog: hex(t.fog), fogNear: t.fogNear, fogFar: t.fogFar,
           sun: hex(t.sun), sunPower: t.sunPower, ambient: t.ambient === undefined ? 0.28 : t.ambient, ground: 'flat',
           groundColour: typeof t.ground === 'string' ? t.ground : '#57c04a', tarmac: t.tarmac, kerbA: t.kerbA, kerbB: t.kerbB,
           skyline: t.skyline ? t.skyline.kind : '', skyNear: t.skyline ? hex(t.skyline.near) : '#6aa85c', skyFar: t.skyline ? hex(t.skyline.far) : '#8fc07e',
           trees: t.treeShape || 'cone', treeCount: t.treeCount || 300, groundY: -1 };
}

/* The place a map makes: the built-in place it started from, with every
   colour and setting the builder chose put over it. */
let seedCounter = 7000;
export function themeFor(data, id) {
  const L = data.look || {};
  const base = THEMES.find(t => t.id === L.base) || THEMES[0];
  const R = base.rules || {};
  const th = Object.assign({}, base, {
    id, seed: ++seedCounter, name: data.name || 'Custom map', blurb: 'A map somebody built',
    features: [], split: false, splits: [], signature: null,
    sky: num(L.sky || hex(base.sky)), skyTop: num(L.skyTop || hex(base.skyTop)), skyBot: num(L.skyBot || hex(base.skyBot)),
    fog: num(L.fog || hex(base.fog)), fogNear: +L.fogNear || base.fogNear, fogFar: +L.fogFar || base.fogFar,
    sun: num(L.sun || hex(base.sun)), sunPower: +L.sunPower || base.sunPower, ambient: L.ambient === undefined ? base.ambient : +L.ambient,
    ground: L.groundColour || base.ground, tarmac: L.tarmac || base.tarmac, kerbA: L.kerbA || base.kerbA, kerbB: L.kerbB || base.kerbB,
    treeShape: L.trees && L.trees !== 'none' ? L.trees : base.treeShape,
    treeCount: L.trees === 'none' || L.ground === 'void' ? 0 : Math.max(0, Math.min(900, +L.treeCount || 0)),
    skyline: L.skyline ? Object.assign({}, base.skyline || { n: 28, w: [40, 92], h: [22, 54] }, { kind: L.skyline, near: num(L.skyNear || '#6aa85c'), far: num(L.skyFar || '#8fc07e') }) : null,
    rules: Object.assign({}, R, { ramps: 0, hazards: [], coneEvery: 1e9, boxRows: data.items === false ? 0 : (R.boxRows || 6),
                                  pads: Math.max(0, Math.min(16, data.pads === undefined ? 4 : +data.pads)), width: 1 }),
  });
  if (L.ground === 'void') th.hemiGround = 0x111122;
  return th;
}
// what track.js is given for a map: its points, and what the ground is
export function specFor(data) {
  const L = data.look || {};
  return { nodes: data.nodes, ground: L.ground || 'flat', groundY: L.groundY === undefined ? -1 : +L.groundY };
}

/* ---- the things on a map, when it is driven -------------------------------
   Everything placed is drawn as one instanced mesh a kind, and the ones that
   do something (boosters, springs, item boxes, coins, anything solid) are
   checked against every kart each step. */
export async function buildExtras(scene, track, data, giveItem) {
  const lib = await objects();
  const group = new THREE.Group();
  group.name = 'customExtras';
  const live = [];                       // the ones that do something
  const solids = [];
  const byKey = new Map();
  const put = (id, colour, x, y, z, rot, scale) => {
    const def = lib.objectById(id);
    if (!def) return null;
    const key = id + '|' + (colour === undefined || colour === null ? '' : colour);
    let rec = byKey.get(key);
    if (!rec) { rec = { def, colour, list: [] }; byKey.set(key, rec); }
    rec.list.push({ x, y, z, rot: rot || 0, s: scale || 1 });
    return def;
  };
  for (const o of (data.objects || [])) {
    const def = put(o.t, o.c, +o.x || 0, +o.y || 0, +o.z || 0, +o.r || 0, +o.s || 1);
    if (!def) continue;
    const r = (def.size || 1) * (+o.s || 1);
    if (def.func === 'boost' || def.func === 'jump' || def.func === 'item' || def.func === 'coin') live.push({ def, x: +o.x, y: +o.y, z: +o.z, r: Math.max(1.6, r), off: 0, rot: +o.r || 0 });
    else if (def.solid) solids.push({ x: +o.x, z: +o.z, y: +o.y, r: Math.max(0.5, r * 0.8) });
  }
  // barriers of a different kind, a stretch at a time, along the wall line
  const S = track.samples;
  const kindObj = { tyres: 'tyres', fence: 'fence', neon: 'neonrail' };
  for (let i = 0; i < S.length; i += 2) {
    const a = S[i];
    const obj = kindObj[a.barrier];
    if (!obj) continue;
    for (const side of [-1, 1]) {
      const off = a.w + 0.9;
      const x = a.p.x + a.n.x * off * side, z = a.p.z + a.n.z * off * side;
      const y = track.project(x, z, i).y;
      put(obj, null, x, y, z, Math.atan2(a.t.x, a.t.z) + Math.PI / 2, 1);
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const [, rec] of byKey) {
    let mesh;
    try { mesh = merge(rec.def.make(rec.colour === '' ? undefined : rec.colour), vertexMat(0.7)); } catch (err) { console.warn('object', rec.def.id, err); continue; }
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, rec.list.length);
    rec.list.forEach((p, i) => {
      e.set(0, p.rot, 0); q.setFromEuler(e); v.set(p.x, p.y, p.z); sc.setScalar(p.s);
      m4.compose(v, q, sc); im.setMatrixAt(i, m4);
    });
    im.castShadow = !rec.def.func || rec.def.solid;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.userData.id = rec.def.id;
    group.add(im);
    rec.mesh = im;
  }
  scene.add(group);
  // item boxes and coins spin; a taken one is gone for a few seconds
  const spinners = [];
  for (const [, rec] of byKey) if (rec.def.func === 'item' || rec.def.func === 'coin') spinners.push(rec);
  let t = 0;
  return {
    group,
    step(karts, dt) {
      t += dt;
      for (const L of live) if (L.off > 0) L.off -= dt;
      for (const k of karts) {
        if (k.remote || k.falling || k.rescue) continue;
        for (const L of live) {
          if (L.off > 0) continue;
          const dx = k.pos.x - L.x, dz = k.pos.z - L.z;
          if (dx * dx + dz * dz > L.r * L.r || Math.abs(k.pos.y - L.y) > 3) continue;
          if (L.def.func === 'boost') k.boost = Math.max(k.boost, 1.1);
          else if (L.def.func === 'jump') { if (k.hopV < 8) { k.hopV = 8; k.launched = 1; k.airKeep = 1; k.glide = 1; k.trickWin = 0.3; } }
          else if (L.def.func === 'item') { if (!k.item && giveItem) { giveItem(k); L.off = 3; } }
          else if (L.def.func === 'coin') { k.boost = Math.max(k.boost, 0.35); L.off = 6; }
        }
        // anything solid pushes a kart back out of it
        for (const s of solids) {
          const dx = k.pos.x - s.x, dz = k.pos.z - s.z;
          const d = Math.hypot(dx, dz);
          if (d >= s.r + 0.9 || Math.abs(k.pos.y - s.y) > 4 || d < 1e-4) continue;
          const push = (s.r + 0.9 - d);
          k.pos.x += dx / d * push; k.pos.z += dz / d * push;
          k.speed *= 0.6;
        }
      }
      // spin the boxes and coins, and hide the ones that have been taken
      for (const rec of spinners) {
        rec.list.forEach((p, i) => {
          const L = live.find(x => x.x === p.x && x.z === p.z);
          const gone = L && L.off > 0;
          e.set(0, t * 1.6 + i, 0); q.setFromEuler(e); v.set(p.x, p.y + Math.sin(t * 2 + i) * 0.15, p.z); sc.setScalar(gone ? 0.001 : p.s);
          m4.compose(v, q, sc); rec.mesh.setMatrixAt(i, m4);
        });
        rec.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      scene.remove(group);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    },
  };
}

/* ---- playing a saved map ------------------------------------------------- */
export function playMap(ctx, map, mode) {
  const data = map.data;
  data.name = map.name;
  const id = 'c:' + map.id;
  const th = themeFor(data, id);
  ctx.registerCustom(id, specFor(data), th, data);
  // the builder's own lap count, unless there is none
  ctx.drive(id, mode === 'race' ? 'race' : 'tt', { map: { id: map.id, name: map.name, laps: data.laps || map.laps || 3 } });
}

/* ---- building one ------------------------------------------------------------ */
let ED = null;          // the builder, while it is open
const CSS = `
#ed{ position:fixed; inset:0; z-index:58; pointer-events:none; font-family:var(--body); color:var(--ink); }
#ed .bar{ pointer-events:auto; position:absolute; left:50%; transform:translateX(-50%); display:flex; gap:6px; align-items:center;
  background:var(--cream); border:3px solid var(--ink); border-radius:14px; box-shadow:0 5px 0 var(--ink); padding:6px 8px; }
#ed .top{ top:10px; flex-wrap:wrap; justify-content:center; max-width:96vw; }
#ed .bottom{ bottom:12px; }
#ed button, #ed select, #ed input{ font-family:var(--display); font-weight:800; font-size:13px; border:2px solid var(--ink); border-radius:9px;
  background:#fff; color:var(--ink); padding:5px 9px; cursor:pointer; }
#ed input[type=text], #ed input[type=password]{ cursor:text; font-family:var(--body); font-size:14px; }
#ed input[type=range]{ padding:0; accent-color:var(--ink); }
#ed input[type=color]{ padding:0; width:34px; height:26px; }
#ed button.on{ background:var(--gold); }
#ed button.go{ background:var(--gold); }
#ed .tool{ display:flex; flex-direction:column; align-items:center; min-width:62px; font-size:12px; }
#ed .ic{ width:15px; height:15px; vertical-align:-3px; }
#ed .tool .ic{ width:18px; height:18px; }
#ed .tool kbd{ font-size:10px; opacity:.6; }
#ed .side{ pointer-events:auto; position:absolute; right:10px; top:70px; bottom:80px; width:min(300px,44vw); overflow-y:auto;
  background:var(--cream); border:3px solid var(--ink); border-radius:14px; box-shadow:0 5px 0 var(--ink); padding:10px 12px; }
#ed .side[hidden]{ display:none; }
#ed .side h3{ font-family:var(--display); font-size:16px; margin:2px 0 8px; }
#ed .side h4{ font-family:var(--display); font-size:13px; margin:10px 0 5px; letter-spacing:.05em; text-transform:uppercase; opacity:.7; }
#ed .side label{ display:flex; align-items:center; justify-content:space-between; gap:8px; font-weight:700; font-size:12.5px; margin:0 0 6px; }
#ed .side label input[type=range]{ flex:1; }
#ed .side select{ font-size:12px; padding:3px 6px; }
#ed .cats{ display:flex; flex-wrap:wrap; gap:4px; margin:0 0 8px; }
#ed .cats button{ font-size:11px; padding:3px 7px; }
#ed .objs{ display:grid; grid-template-columns:repeat(2,1fr); gap:5px; }
#ed .objs button{ font-size:11.5px; padding:6px 4px; text-align:center; }
#ed .sws{ display:flex; flex-wrap:wrap; gap:4px; margin:4px 0 8px; }
#ed .sws button{ width:22px; height:22px; padding:0; border-radius:6px; }
#ed .sws button.on{ outline:3px solid var(--gold); }
#ed .cross{ position:absolute; left:50%; top:50%; width:22px; height:22px; margin:-11px 0 0 -11px; pointer-events:none; }
#ed .cross:before, #ed .cross:after{ content:''; position:absolute; background:#fff; box-shadow:0 0 0 1.5px var(--ink); }
#ed .cross:before{ left:10px; top:2px; width:2px; height:18px; }
#ed .cross:after{ top:10px; left:2px; height:2px; width:18px; }
#ed .help{ position:absolute; left:10px; bottom:12px; pointer-events:none; color:#fff; font-weight:800; font-size:12px; line-height:1.6;
  text-shadow:0 1px 0 var(--ink), 0 0 3px var(--ink); max-width:300px; }
#ed .msg{ position:absolute; left:50%; top:70px; transform:translateX(-50%); background:var(--ink); color:#fff; font-weight:800; font-size:13px;
  padding:6px 12px; border-radius:10px; opacity:0; transition:opacity .3s; pointer-events:none; }
#ed .msg.on{ opacity:1; }
#ed.driving .bottom, #ed.driving .side, #ed.driving .cross, #ed.driving .help{ display:none; }
#ed.driving .top{ top:auto; bottom:10px; }
#ed .modal{ pointer-events:auto; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(380px,92vw);
  background:var(--cream); border:3px solid var(--ink); border-radius:16px; box-shadow:0 7px 0 var(--ink); padding:16px 18px; }
#ed .modal[hidden]{ display:none; }
#ed .modal h3{ font-family:var(--display); margin:0 0 10px; }
#ed .modal label{ display:block; font-weight:800; font-size:12px; margin:8px 0 4px; }
#ed .modal input{ width:100%; }
#ed .modal .row{ display:flex; gap:8px; margin-top:12px; justify-content:flex-end; }
#ed .modal p{ font-size:12.5px; font-weight:600; opacity:.75; margin:6px 0 0; }
`;

export function openEditor(ctx, map, pw) {
  if (ED) return;
  const data = map ? JSON.parse(JSON.stringify(map.data)) : newMap();
  if (!data.look) data.look = newMap().look;
  if (!data.objects) data.objects = [];
  const st = {
    id: map ? map.id : null, name: map ? map.name : '', password: pw || null,
    data, tool: 'track', sel: map ? 0 : data.nodes.length - 1, objType: 'pine', objColour: null, objRot: 0, objScale: 1,
    grab: false, driving: false, thumb: null, panel: 'tool', cat: 'nature', dirty: false,
  };
  ED = st;
  if (!document.getElementById('edcss')) { const s = document.createElement('style'); s.id = 'edcss'; s.textContent = CSS; document.head.appendChild(s); }
  const root = document.createElement('div');
  root.id = 'ed';
  root.innerHTML = `
    <div class="bar top">
      <input type="text" id="edname" maxlength="40" placeholder="Map name" value="">
      <button type="button" id="edsave" class="go">Save</button>
      <button type="button" id="edshot" title="Take the picture shown for this map (P)">${icon('camera')} Picture</button>
      <button type="button" id="eddrive" title="Drive it (Y)">${icon('wheel')} Drive <kbd>Y</kbd></button>
      <button type="button" id="edset">${icon('sliders')} Map settings</button>
      <button type="button" id="edexit">Exit</button>
    </div>
    <div class="bar bottom">
      <button type="button" class="tool" data-tool="track">${icon('road')} Track<kbd>1</kbd></button>
      <button type="button" class="tool" data-tool="select">${icon('pointer')} Select<kbd>2</kbd></button>
      <button type="button" class="tool" data-tool="object">${icon('tree')} Objects<kbd>3</kbd></button>
      <button type="button" class="tool" data-tool="erase">${icon('eraser')} Erase<kbd>4</kbd></button>
    </div>
    <div class="side" id="edside"></div>
    <div class="cross"></div>
    <div class="help">Click the world to fly · WASD move · Space up · Shift down<br>Mouse to look · Esc lets the mouse go · Y drive · P picture</div>
    <div class="msg" id="edmsg"></div>
    <div class="modal" id="edmodal" hidden></div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id);
  $('edname').value = st.name;
  $('edname').addEventListener('input', () => { st.name = $('edname').value; st.dirty = true; });
  const say = t => { const m = $('edmsg'); m.textContent = t; m.classList.add('on'); clearTimeout(say.t); say.t = setTimeout(() => m.classList.remove('on'), 2200); };

  /* ---- the scene while building: the road as a ribbon, its points, and the
     things on it, with the place's sky and ground. */
  const scene = ctx.scene, camera = ctx.camera;
  const group = new THREE.Group();
  group.name = 'editor';
  scene.add(group);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x57c04a, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 1, 1).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true;
  group.add(ground);
  const grid = new THREE.GridHelper(1200, 60, 0xffffff, 0xffffff);
  grid.material.transparent = true; grid.material.opacity = 0.12;
  group.add(grid);
  const roadMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  let road = null;
  const nodeGeo = new THREE.SphereGeometry(1.4, 12, 8);
  const nodeMat = new THREE.MeshStandardMaterial({ color: 0xffd233, emissive: 0x332200 });
  const selMat = new THREE.MeshStandardMaterial({ color: 0xff3d3d, emissive: 0x661010 });
  const startMat = new THREE.MeshStandardMaterial({ color: 0x43d94f, emissive: 0x0a3310 });
  const nodesGroup = new THREE.Group(); group.add(nodesGroup);
  const objGroup = new THREE.Group(); group.add(objGroup);
  const ghost = new THREE.Group(); group.add(ghost);
  const geoCache = new Map();
  let lib = null;
  objects().then(m => { lib = m; drawObjects(); drawPanel(); });

  function applyLook() {
    const L = st.data.look;
    ctx.dressSky(themeFor(st.data, 'c:edit-sky'));
    const g = L.ground;
    ground.visible = g !== 'void';
    groundMat.color.set(L.groundColour || '#57c04a');
    ground.position.y = (L.groundY === undefined ? -1 : +L.groundY) - 0.05;
    grid.position.y = ground.position.y + 0.04;
  }
  const SEGCOL = { road: 0x5c616b, ramp: 0xff8a1f, hump: 0xffb347, chasm: 0x111111, bridge: 0x9a9a92, tunnel: 0x6b4a2e, water: 0x2e86c8,
                   boostlane: 0xffd233, agrav: 0x8fe4ff, narrows: 0xe8402a, arena: 0x43d94f, bowl: 0xa35cff, spiral: 0xff5fa2,
                   shelf: 0x7a3fb0, causeway: 0x1fb6a6, moguls: 0xb07a4e, whoops: 0xb07a4e, icestrip: 0xdff2ff, sandstrip: 0xe8c39a };
  // the same curve track.js lays the road along, so what you see is what you get
  function curve() {
    const N = st.data.nodes, n = N.length, out = [];
    const cm = (a, b, c, d, t, k) => { const A = a[k] || 0, B = b[k] || 0, C = c[k] || 0, D = d[k] || 0; const t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * B) + (-A + C) * t + (2 * A - 5 * B + 4 * C - D) * t2 + (-A + 3 * B - 3 * C + D) * t3); };
    for (let i = 0; i < n; i++) {
      const p0 = N[(i - 1 + n) % n], p1 = N[i], p2 = N[(i + 1) % n], p3 = N[(i + 2) % n];
      const seg = Math.max(2, Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z) / 3));
      for (let k = 0; k < seg; k++) {
        const t = k / seg;
        out.push({ x: cm(p0, p1, p2, p3, t, 'x'), z: cm(p0, p1, p2, p3, t, 'z'), y: cm(p0, p1, p2, p3, t, 'y'), w: cm(p0, p1, p2, p3, t, 'w') || 9, ni: i });
      }
    }
    return out;
  }
  function drawRoad() {
    if (road) { group.remove(road); road.geometry.dispose(); }
    const P = curve(), n = P.length;
    if (n < 3) return;
    const pos = [], col = [], idx = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      const nx = -dz / l, nz = dx / l;
      const node = st.data.nodes[a.ni];
      c.setHex(SEGCOL[node.seg] || 0x5c616b);
      if (node.barrier === 'none') c.multiplyScalar(0.8);
      for (const s of [-1, 1]) { pos.push(a.x + nx * a.w * s, a.y + 0.06, a.z + nz * a.w * s); col.push(c.r, c.g, c.b); }
      const j = i * 2, k = ((i + 1) % n) * 2;
      idx.push(j, k, j + 1, j + 1, k, k + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    road = new THREE.Mesh(g, roadMat);
    road.name = 'edroad';
    group.add(road);
    // the points, the picked one red and the start green
    nodesGroup.clear();
    st.data.nodes.forEach((nd, i) => {
      const m = new THREE.Mesh(nodeGeo, i === st.sel ? selMat : i === 0 ? startMat : nodeMat);
      m.position.set(nd.x, (nd.y || 0) + 1.6, nd.z);
      m.userData.node = i;
      nodesGroup.add(m);
    });
  }
  function geoFor(id, colour) {
    const key = id + '|' + (colour === null || colour === undefined ? '' : colour);
    if (geoCache.has(key)) return geoCache.get(key);
    const def = lib && lib.objectById(id);
    if (!def) return null;
    let m;
    try { m = merge(def.make(colour === null ? undefined : colour), vertexMat(0.7)); } catch (e) { console.warn(e); return null; }
    geoCache.set(key, m);
    return m;
  }
  function drawObjects() {
    objGroup.clear();
    if (!lib) return;
    st.data.objects.forEach((o, i) => {
      const src = geoFor(o.t, o.c === undefined ? null : o.c);
      if (!src) return;
      const m = new THREE.Mesh(src.geometry, src.material);
      m.position.set(o.x, o.y, o.z);
      m.rotation.y = o.r || 0;
      m.scale.setScalar(o.s || 1);
      m.userData.obj = i;
      m.castShadow = true;
      objGroup.add(m);
    });
  }
  // what is under the crosshair: a point, a thing, the road, or the ground
  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function aim() {
    ray.setFromCamera(centre, camera);
    const nh = ray.intersectObjects(nodesGroup.children, false)[0];
    const oh = ray.intersectObjects(objGroup.children, false)[0];
    const rh = road ? ray.intersectObject(road, false)[0] : null;
    let gp = null;
    const gy = ground.visible ? ground.position.y + 0.05 : (st.data.nodes[st.sel] ? (st.data.nodes[st.sel].y || 0) : 0);
    floor.constant = -gy;
    const p = new THREE.Vector3();
    if (ray.ray.intersectPlane(floor, p) && p.distanceTo(camera.position) < 900) gp = p;
    const near = [nh && { kind: 'node', d: nh.distance, i: nh.object.userData.node, p: nh.point },
                  oh && { kind: 'obj', d: oh.distance, i: oh.object.userData.obj, p: oh.point },
                  rh && { kind: 'road', d: rh.distance, p: rh.point },
                  gp && { kind: 'ground', d: gp.distanceTo(camera.position), p: gp }].filter(Boolean).sort((a, b) => a.d - b.d);
    return near[0] || null;
  }

  /* ---- flying ---- */
  const keys = {};
  let yaw = 0, pitch = -0.5;
  {
    const n0 = st.data.nodes[0] || { x: 0, z: 0, y: 0 };
    camera.position.set(n0.x, (n0.y || 0) + 60, n0.z + 90);
    camera.lookAt(n0.x, n0.y || 0, n0.z);
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    yaw = Math.atan2(-d.x, -d.z); pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
  }
  const canvas = ctx.renderer.domElement;
  const locked = () => document.pointerLockElement === canvas;
  function onMouseMove(e) {
    if (!locked() || st.driving) return;
    yaw -= e.movementX * 0.0025;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0025));
  }
  function onMouseDown(e) {
    if (st.driving || e.target !== canvas) return;
    if (!locked()) { try { canvas.requestPointerLock(); } catch (err) {} return; }
    act(e.button === 2 ? 'alt' : 'main');
  }
  const noMenu = e => { if (!st.driving && (e.target === canvas)) e.preventDefault(); };
  function onKey(e, down) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
    if (typing) { if (k === 'Escape') e.target.blur(); return; }
    if (down && k === 'y') { e.preventDefault(); e.stopPropagation(); toggleDrive(); return; }
    if (st.driving) return;                       // the game drives
    e.stopPropagation();
    keys[k] = down;
    if (!down) return;
    if (k === '1') setTool('track'); else if (k === '2') setTool('select'); else if (k === '3') setTool('object'); else if (k === '4') setTool('erase');
    else if (k === 'p') shot();
    else if (k === 'g' && st.tool === 'select') { st.grab = !st.grab; say(st.grab ? 'Point picked up: click to put it down' : 'Put down'); }
    else if (k === 'r' || k === 'f') { const nd = st.data.nodes[st.sel]; if (nd) { nd.y = Math.round(((nd.y || 0) + (k === 'r' ? 1 : -1) * (e.shiftKey ? 2.5 : 0.5)) * 10) / 10; changed(); } }
    else if (k === 'q' || k === 'e') { st.objRot += (k === 'q' ? 1 : -1) * Math.PI / 12; ghostDraw(); }
    else if (k === 'z' || k === 'x') { st.objScale = Math.max(0.3, Math.min(6, st.objScale * (k === 'x' ? 1.15 : 1 / 1.15))); ghostDraw(); }
    else if ((k === 'Delete' || k === 'Backspace') && st.tool === 'select') removeNode(st.sel);
  }
  const kd = e => onKey(e, true), ku = e => onKey(e, false);
  addEventListener('keydown', kd, true);
  addEventListener('keyup', ku, true);
  addEventListener('mousemove', onMouseMove);
  addEventListener('mousedown', onMouseDown);
  addEventListener('contextmenu', noMenu);

  function frame(dt) {
    if (st.driving) return;
    const sp = (keys.Shift ? 1 : 1) * (keys.Control ? 120 : 45) * dt;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (keys.w) { camera.position.x += fx * sp; camera.position.z += fz * sp; }
    if (keys.s) { camera.position.x -= fx * sp; camera.position.z -= fz * sp; }
    if (keys.a) { camera.position.x += fz * sp; camera.position.z -= fx * sp; }
    if (keys.d) { camera.position.x -= fz * sp; camera.position.z += fx * sp; }
    if (keys[' ']) camera.position.y += sp;
    if (keys.Shift) camera.position.y -= sp;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
    // a picked-up point follows the crosshair
    if (st.grab && st.tool === 'select') {
      const h = aim();
      const nd = st.data.nodes[st.sel];
      if (h && nd && h.kind !== 'node') { nd.x = Math.round(h.p.x); nd.z = Math.round(h.p.z); changedSoon(); }
    }
    ghostMove();
  }

  /* ---- the tools ---- */
  function setTool(t) {
    st.tool = t; st.grab = false;
    root.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    st.panel = 'tool';
    ghostDraw();
    drawPanel();
  }
  root.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  let changeT = 0;
  function changed() { st.dirty = true; drawRoad(); drawPanel(); }
  function changedSoon() { st.dirty = true; clearTimeout(changeT); changeT = setTimeout(drawRoad, 60); }
  function removeNode(i) {
    if (st.data.nodes.length <= 4) { say('A track needs at least four points.'); return; }
    st.data.nodes.splice(i, 1);
    st.sel = Math.max(0, Math.min(st.sel, st.data.nodes.length - 1));
    changed();
  }
  function act(which) {
    const h = aim();
    if (!h) return;
    if (st.tool === 'track') {
      if (which === 'alt') { if (h.kind === 'node') { st.sel = h.i; changed(); } return; }
      const prev = st.data.nodes[st.sel] || st.data.nodes[st.data.nodes.length - 1];
      const nd = { x: Math.round(h.p.x), z: Math.round(h.p.z), y: h.kind === 'road' || !ground.visible ? Math.round(h.p.y * 10) / 10 : (prev ? prev.y || 0 : 0),
                   w: prev ? prev.w : 10, seg: 'road', barrier: prev ? prev.barrier : 'wall' };
      st.data.nodes.splice(st.sel + 1, 0, nd);
      st.sel = st.sel + 1;
      changed();
    } else if (st.tool === 'select') {
      if (st.grab) { st.grab = false; changed(); say('Put down'); return; }
      if (h.kind === 'node') { st.sel = h.i; changed(); }
      else if (h.kind === 'obj') { pickedObj = h.i; drawPanel(); }
    } else if (st.tool === 'object') {
      if (which === 'alt') { if (h.kind === 'obj') { st.data.objects.splice(h.i, 1); drawObjects(); st.dirty = true; } return; }
      if (st.data.objects.length >= 1500) { say('That is as many things as one map can hold.'); return; }
      // things for the sky are built standing high already, so they go down where you point like anything else
      const y = h.p.y;
      st.data.objects.push({ t: st.objType, x: Math.round(h.p.x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(h.p.z * 10) / 10,
                             r: Math.round(st.objRot * 100) / 100, s: Math.round(st.objScale * 100) / 100, ...(st.objColour !== null ? { c: st.objColour } : {}) });
      drawObjects(); st.dirty = true;
    } else if (st.tool === 'erase') {
      if (h.kind === 'obj') { st.data.objects.splice(h.i, 1); drawObjects(); st.dirty = true; }
      else if (h.kind === 'node') removeNode(h.i);
    }
  }
  let pickedObj = -1;
  // a see-through copy of the thing about to be put down, where it would go
  let ghostMesh = null;
  function ghostDraw() {
    ghost.clear(); ghostMesh = null;
    if (st.tool !== 'object' || !lib) return;
    const src = geoFor(st.objType, st.objColour);
    if (!src) return;
    const mat = src.material.clone(); mat.transparent = true; mat.opacity = 0.45; mat.depthWrite = false;
    ghostMesh = new THREE.Mesh(src.geometry, mat);
    ghostMesh.rotation.y = st.objRot; ghostMesh.scale.setScalar(st.objScale);
    ghost.add(ghostMesh);
  }
  function ghostMove() {
    if (!ghostMesh) return;
    const h = aim();
    ghostMesh.visible = !!h && locked();
    if (h) ghostMesh.position.copy(h.p);
  }

  /* ---- the panel on the right ---- */
  function drawPanel() {
    const side = $('edside');
    if (st.panel === 'settings') { side.innerHTML = settingsHtml(); wireSettings(); return; }
    if (st.tool === 'object') {
      if (!lib) { side.innerHTML = '<h3>Objects</h3><p>Loading…</p>'; return; }
      const cats = lib.CATEGORIES || [];
      const list = lib.OBJECTS.filter(o => o.cat === st.cat);
      side.innerHTML = '<h3>Objects</h3><div class="cats">' + cats.map(c => '<button type="button" data-cat="' + c.id + '"' + (c.id === st.cat ? ' class="on"' : '') + '>' + ctx.esc(c.name) + '</button>').join('') + '</div>'
        + '<div class="objs">' + list.map(o => '<button type="button" data-obj="' + o.id + '"' + (o.id === st.objType ? ' class="on"' : '') + '>' + ctx.esc(o.name) + (o.func ? ' ' + icon('bolt') : '') + '</button>').join('') + '</div>'
        + '<h4>Colour</h4><div class="sws">' + [null, 0xe8402a, 0xff8a1f, 0xffd233, 0x43d94f, 0x1fb6a6, 0x2b56d6, 0x7a3fb0, 0xff5fa2, 0xffffff, 0x3a3f4a].map(c =>
          '<button type="button" data-col="' + (c === null ? '' : c) + '" style="background:' + (c === null ? 'repeating-linear-gradient(45deg,#fff 0 4px,#d9dde6 4px 8px)' : hex(c)) + '"' + (c === st.objColour ? ' class="on"' : '') + '></button>').join('') + '</div>'
        + '<p style="font-size:12px;font-weight:700;opacity:.7">Click to place · right click removes · Q/E turn · Z/X size (' + st.objScale.toFixed(2) + '×)<br>' + icon('bolt') + ' does something: boosters, springs, item boxes, coins</p>'
        + '<p style="font-size:12px;font-weight:700;opacity:.7">' + st.data.objects.length + ' things on this map</p>';
      side.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { st.cat = b.dataset.cat; drawPanel(); });
      side.querySelectorAll('[data-obj]').forEach(b => b.onclick = () => { st.objType = b.dataset.obj; ghostDraw(); drawPanel(); });
      side.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { st.objColour = b.dataset.col === '' ? null : +b.dataset.col; ghostDraw(); drawPanel(); });
      return;
    }
    const nd = st.data.nodes[st.sel];
    const head = st.tool === 'track' ? '<h3>Track</h3><p style="font-size:12px;font-weight:700;opacity:.75">Click the ground to lay the next point after the red one. Right click a point to pick it. Green is the start line.</p>'
      : st.tool === 'erase' ? '<h3>Erase</h3><p style="font-size:12px;font-weight:700;opacity:.75">Click a thing or a point to take it away.</p>'
      : '<h3>Select</h3><p style="font-size:12px;font-weight:700;opacity:.75">Click a point to pick it. G picks it up and puts it down where you look. R / F raise and lower it. Delete removes it.</p>';
    if (!nd) { side.innerHTML = head; return; }
    side.innerHTML = head
      + '<h4>Point ' + (st.sel + 1) + ' of ' + st.data.nodes.length + (st.sel === 0 ? ' (start line)' : '') + '</h4>'
      + '<label>Section from here <select id="edseg">' + SECTIONS.map(s => '<option value="' + s[0] + '"' + (nd.seg === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select></label>'
      + '<label>Barriers <select id="edbar">' + BARRIERS.map(s => '<option value="' + s[0] + '"' + ((nd.barrier || 'wall') === s[0] ? ' selected' : '') + '>' + s[1] + '</option>').join('') + '</select></label>'
      + '<label>Height <input type="range" id="edy" min="-20" max="60" step="0.5" value="' + (nd.y || 0) + '"><b>' + (nd.y || 0) + ' m</b></label>'
      + '<label>Width <input type="range" id="edw" min="4" max="24" step="0.5" value="' + (nd.w || 10) + '"><b>' + (nd.w || 10) + ' m</b></label>'
      + '<label>Lean <input type="range" id="edbank" min="-0.3" max="0.3" step="0.02" value="' + (typeof nd.bank === 'number' ? nd.bank : 0) + '"><b>' + (typeof nd.bank === 'number' ? Math.round(nd.bank * 100) + '%' : 'auto') + '</b></label>'
      + (['ramp', 'road'].indexOf(nd.seg) < 0 ? '<label>Section length <input type="range" id="edlen" min="0.5" max="2.5" step="0.1" value="' + (nd.len || 1) + '"><b>' + (nd.len || 1) + '×</b></label>' : '')
      + (['boostlane', 'icestrip', 'sandstrip'].indexOf(nd.seg) >= 0 ? '<label>Side <select id="edsidesel"><option value="1"' + (nd.side !== -1 ? ' selected' : '') + '>Left</option><option value="-1"' + (nd.side === -1 ? ' selected' : '') + '>Right</option></select></label>' : '')
      + '<p style="font-size:12px;font-weight:700;opacity:.7">How sharp a turn is is how close the points are and the angle between them: move a point (G) to tighten or open a corner.</p>'
      + '<button type="button" id="edauto">Lean: back to automatic</button> <button type="button" id="eddel">Remove point</button>';
    const on = (id, ev, fn) => { const x = side.querySelector('#' + id); if (x) x.addEventListener(ev, fn); };
    on('edseg', 'change', e => { nd.seg = e.target.value; changed(); });
    on('edbar', 'change', e => { nd.barrier = e.target.value; changed(); });
    on('edy', 'input', e => { nd.y = +e.target.value; e.target.nextElementSibling.textContent = nd.y + ' m'; changedSoon(); });
    on('edw', 'input', e => { nd.w = +e.target.value; e.target.nextElementSibling.textContent = nd.w + ' m'; changedSoon(); });
    on('edbank', 'input', e => { nd.bank = +e.target.value; e.target.nextElementSibling.textContent = Math.round(nd.bank * 100) + '%'; st.dirty = true; });
    on('edlen', 'input', e => { nd.len = +e.target.value; e.target.nextElementSibling.textContent = nd.len + '×'; st.dirty = true; });
    on('edsidesel', 'change', e => { nd.side = +e.target.value; st.dirty = true; });
    on('edauto', 'click', () => { delete nd.bank; changed(); });
    on('eddel', 'click', () => removeNode(st.sel));
  }
  function settingsHtml() {
    const L = st.data.look, D = st.data;
    const col = (k, label) => '<label>' + label + ' <input type="color" data-look="' + k + '" value="' + (L[k] || '#ffffff') + '"></label>';
    const rng = (k, label, mn, mx, stp) => '<label>' + label + ' <input type="range" data-lookn="' + k + '" min="' + mn + '" max="' + mx + '" step="' + stp + '" value="' + (L[k] === undefined ? mn : L[k]) + '"></label>';
    const sel = (k, label, opts) => '<label>' + label + ' <select data-looks="' + k + '">' + opts.map(o => '<option value="' + o[0] + '"' + ((L[k] || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
    return '<h3>Map settings <button type="button" id="edback" style="float:right">Done</button></h3>'
      + '<label>Start from <select id="edbase">' + THEMES.map(t => '<option value="' + t.id + '"' + (L.base === t.id ? ' selected' : '') + '>' + ctx.esc(t.name) + '</option>').join('') + '</select></label>'
      + '<h4>Sky</h4>' + col('sky', 'Sky') + col('skyTop', 'Top of the sky') + col('skyBot', 'Horizon') + col('fog', 'Haze')
      + rng('fogNear', 'Haze starts', 40, 900, 10) + rng('fogFar', 'Haze ends', 120, 1600, 10)
      + col('sun', 'Sunlight') + rng('sunPower', 'Sun strength', 0.2, 4, 0.1) + rng('ambient', 'Light in the air', 0, 1.5, 0.05)
      + '<h4>Ground</h4>' + sel('ground', 'Ground', [['flat', 'Flat'], ['hills', 'Rolling hills'], ['void', 'Nothing (a road in the sky)']])
      + col('groundColour', 'Ground colour') + rng('groundY', 'Ground height', -40, 20, 0.5)
      + '<h4>Road</h4>' + col('tarmac', 'Road') + col('kerbA', 'Kerb') + col('kerbB', 'Kerb stripe')
      + '<h4>In the distance</h4>' + sel('skyline', 'Horizon', SKYLINES) + col('skyNear', 'Near hills') + col('skyFar', 'Far hills')
      + sel('trees', 'Trees', TREES) + rng('treeCount', 'How many trees', 0, 900, 10)
      + '<h4>Racing</h4>'
      + '<label>Laps <input type="number" id="edlaps" min="1" max="9" value="' + (D.laps || 3) + '"></label>'
      + '<label>Item boxes <input type="checkbox" id="editems"' + (D.items !== false ? ' checked' : '') + '></label>'
      + '<label>Booster pads on the road <input type="range" id="edpads" min="0" max="16" step="1" value="' + (D.pads === undefined ? 4 : D.pads) + '"></label>';
  }
  function wireSettings() {
    const side = $('edside'), L = st.data.look, D = st.data;
    side.querySelector('#edback').onclick = () => { st.panel = 'tool'; drawPanel(); };
    side.querySelector('#edbase').onchange = e => { Object.assign(L, lookFrom(e.target.value)); applyLook(); drawPanel(); st.dirty = true; };
    side.querySelectorAll('[data-look]').forEach(i => i.addEventListener('input', () => { L[i.dataset.look] = i.value; applyLook(); st.dirty = true; }));
    side.querySelectorAll('[data-lookn]').forEach(i => i.addEventListener('input', () => { L[i.dataset.lookn] = +i.value; applyLook(); st.dirty = true; }));
    side.querySelectorAll('[data-looks]').forEach(i => i.addEventListener('change', () => { L[i.dataset.looks] = i.value; applyLook(); st.dirty = true; }));
    side.querySelector('#edlaps').onchange = e => { D.laps = Math.max(1, Math.min(9, +e.target.value || 3)); st.dirty = true; };
    side.querySelector('#editems').onchange = e => { D.items = e.target.checked; st.dirty = true; };
    side.querySelector('#edpads').oninput = e => { D.pads = +e.target.value; st.dirty = true; };
  }
  $('edset').addEventListener('click', () => { st.panel = st.panel === 'settings' ? 'tool' : 'settings'; drawPanel(); });

  /* ---- driving it ---- */
  let hidden = [];
  function toggleDrive() {
    if (!st.driving) {
      if (st.data.nodes.length < 4) { say('A track needs at least four points.'); return; }
      st.driving = true;
      root.classList.add('driving');
      $('eddrive').innerHTML = icon('wrench') + ' Build <kbd>Y</kbd>';
      if (locked()) document.exitPointerLock();
      group.visible = false;
      ctx.setEditor(null);
      const id = 'c:' + (st.id || 'draft');
      st.data.name = st.name || 'Untitled map';
      ctx.registerCustom(id, specFor(st.data), themeFor(st.data, id), st.data);
      ctx.drive(id, 'tt', { map: null, laps: st.data.laps || 3 });
      say('Driving. Y to go back to building.');
    } else {
      st.driving = false;
      root.classList.remove('driving');
      $('eddrive').innerHTML = icon('wheel') + ' Drive <kbd>Y</kbd>';
      const me = ctx.me();
      ctx.stopDrive();
      group.visible = true;
      ctx.setEditor(frame);
      applyLook();
      if (me) {
        camera.position.set(me.pos.x + Math.sin(me.yaw) * 14, me.pos.y + 9, me.pos.z + Math.cos(me.yaw) * 14);
        yaw = me.yaw; pitch = -0.45;
      }
      say('Building.');
    }
  }
  $('eddrive').addEventListener('click', toggleDrive);

  /* ---- the picture ---- */
  function shot() {
    const c = ctx.renderNow();
    try {
      const W = 480, H = 270;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      // the middle of the view, cut to sixteen by nine
      const sw = c.width, sh = c.height;
      const want = sw / sh > 16 / 9 ? [sh * 16 / 9, sh] : [sw, sw * 9 / 16];
      g.drawImage(c, (sw - want[0]) / 2, (sh - want[1]) / 2, want[0], want[1], 0, 0, W, H);
      st.thumb = cv.toDataURL('image/jpeg', 0.82);
      say('Picture taken' + (st.id ? '' : ': it goes up when you save'));
      if (st.id && (st.password || ctx.admin())) {
        fetch(ctx.MC + '/kart/maps/thumb', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: st.id, password: st.password, admin: ctx.admin() || undefined, thumb: st.thumb }) })
          .then(r => r.json()).then(j => say(j && j.ok ? 'Picture saved for the Custom maps page' : ((j && j.error) || 'Picture not saved')));
      }
    } catch (e) { say('Could not take a picture here.'); }
  }
  $('edshot').addEventListener('click', shot);
  // and P while driving too: the picture can be what the driver sees
  const pk = e => { if (st.driving && (e.key === 'p' || e.key === 'P') && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) { e.stopPropagation(); shot(); } };
  addEventListener('keydown', pk, true);

  /* ---- saving ---- */
  function modal(html, wire) { const m = $('edmodal'); m.innerHTML = html; m.hidden = false; if (locked()) document.exitPointerLock(); wire(m); }
  function closeModal() { $('edmodal').hidden = true; }
  $('edsave').addEventListener('click', () => {
    if (!st.name.trim()) { say('Give the map a name first.'); $('edname').focus(); return; }
    if (st.id && (st.password || ctx.admin())) { doSave(st.password); return; }
    modal('<h3>Save "' + ctx.esc(st.name) + '"</h3>'
      + '<label for="edpw">A password for changing it later</label><input type="password" id="edpw" maxlength="40" autocomplete="new-password">'
      + '<p>Anybody can play your map. Only somebody with this password' + (ctx.admin() ? '' : ' (or an admin)') + ' can change it. Do not use a password you use anywhere else.</p>'
      + '<div class="row"><button type="button" id="edcancel">Cancel</button><button type="button" id="edok" class="go">Save</button></div>', m => {
      m.querySelector('#edcancel').onclick = closeModal;
      m.querySelector('#edok').onclick = () => { const pw = m.querySelector('#edpw').value; if (pw.length < 3) { say('At least three characters.'); return; } doSave(pw); };
      m.querySelector('#edpw').focus();
    });
  });
  function doSave(pw) {
    const body = { id: st.id || undefined, name: st.name.trim(), author: ctx.name() || 'anonymous', password: pw || undefined,
                   admin: ctx.admin() || undefined, data: st.data, thumb: st.thumb || undefined };
    say('Saving…');
    fetch(ctx.MC + '/kart/maps/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json()).then(j => {
        if (j && j.ok) { st.id = j.id; st.password = pw || st.password; st.dirty = false; closeModal(); say('Saved. It is on the Custom maps page.'); }
        else { say((j && j.error) || 'Not saved.'); }
      }).catch(() => say('The server could not be reached.'));
  }
  $('edexit').addEventListener('click', () => {
    if (st.dirty && !confirm('Leave without saving the changes?')) return;
    close();
    ctx.goHome();
  });
  function close() {
    removeEventListener('keydown', kd, true); removeEventListener('keyup', ku, true); removeEventListener('keydown', pk, true);
    removeEventListener('mousemove', onMouseMove); removeEventListener('mousedown', onMouseDown); removeEventListener('contextmenu', noMenu);
    if (locked()) document.exitPointerLock();
    scene.remove(group); root.remove();
    ctx.setEditor(null);
    ED = null;
  }

  ctx.enterBuilder();
  ctx.setEditor(frame);
  applyLook();
  drawRoad();
  setTool('track');
  // for a test: the builder's state, and a way to act without a mouse
  window.__ed = { st, act, setTool, toggleDrive, shot, aim, drawRoad, drawObjects, get camera() { return camera; }, setView(x, y, z, yw, pt) { camera.position.set(x, y, z); yaw = yw; pitch = pt; } };
}
