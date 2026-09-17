/* ---------------------------------------------------------------------------
   GTA VI - the game loop, the person, the car and the camera.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { buildCity, CITY, rng } from './city.js';
import { makePerson, poseWalk, poseIdle, poseAim, poseSit, posePunch } from './person.js';
import { makeCar, CAR_KINDS, beamMat, headMat } from './vehicle.js';
import { makeTraffic } from './traffic.js';
import { initFx, muzzle, tracer, impact, explode, stepFx } from './fx.js';

const el = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------------------------------------------------------- renderer -- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(54, innerWidth / innerHeight, 0.15, 2600);

/* ---- sky ------------------------------------------------------------------
   A dome with the horizon painted into it, rather than a flat colour: the thing
   that makes a game look outdoors is that the sky is brighter near the ground
   than overhead. */
const skyUniforms = {
  top: { value: new THREE.Color(0x2a5ea8) },
  bottom: { value: new THREE.Color(0xbcd0e0) },
  sun: { value: new THREE.Vector3(0.4, 0.6, 0.2) },
  sunColor: { value: new THREE.Color(0xffe6b8) },
  cloudLit: { value: new THREE.Color(0xffffff) },
  cloudDark: { value: new THREE.Color(0x9fb0c4) },
  drift: { value: 0 },
  cover: { value: 0.42 },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1600, 32, 18),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms,
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top, bottom, sunColor, cloudLit, cloudDark;
      uniform vec3 sun; uniform float drift, cover;
      varying vec3 vP;
      // value noise, four octaves: enough for cloud, cheap enough for a dome
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }
        return v;
      }
      void main(){
        vec3 dir = normalize(vP);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(bottom, top, pow(h, 0.72));
        float d = max(dot(dir, normalize(sun)), 0.0);
        c += sunColor * pow(d, 380.0) * 6.0;             // the sun
        c += sunColor * pow(d, 5.0) * 0.14;              // and the haze round it
        // cloud, mapped onto a flat sheet above the world so it thins out and
        // stretches towards the horizon the way real cloud does
        if (dir.y > 0.012) {
          vec2 uv = dir.xz / dir.y * 0.06 + vec2(drift, drift * 0.35);
          float n = fbm(uv * 1.7);
          float n2 = fbm(uv * 4.2 + 11.0);
          float mask = smoothstep(0.52 - cover * 0.34, 0.86 - cover * 0.2, n);
          mask *= smoothstep(0.012, 0.14, dir.y);        // fade into the horizon
          vec3 cc = mix(cloudDark, cloudLit, clamp(n2 * 1.3 + d * 0.5, 0.0, 1.0));
          c = mix(c, cc, mask * 0.9);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
);
sky.frustumCulled = false;
scene.add(sky);

const sun = new THREE.DirectionalLight(0xffe9c4, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 460;
sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);

/* Streets are canyons: with only a sun, anything the sun cannot reach goes to
   black, and half a city is always in shadow. The sky itself does the filling -
   the dome is pre-filtered into an environment map, so a wall in shadow picks up
   blue from above and warm bounce from the ground the way a real one does. The
   hemisphere and ambient lights underneath it are only a floor, in case the
   environment map is not ready yet. */
const hemi = new THREE.HemisphereLight(0xbcd6f0, 0x6b6558, 0.45);
scene.add(hemi);
const fill = new THREE.AmbientLight(0xdfe8f2, 0.16);
scene.add(fill);

/* Three real lights that hop between whichever street lamps are nearest. The
   painted pools do the road; these are what make a car, a person and the player
   pass through the light rather than under it. */
const lampLights = [0, 1, 2].map(() => {
  const l = new THREE.PointLight(0xffd9a0, 0, 30, 2);
  l.visible = false;
  scene.add(l);
  return l;
});
let lampPick = 0;
function pickLamps(night) {
  if (!city || !city.lamps.length) return;
  const want = night * 26;
  const near = [];
  for (const p of city.lamps) {
    const d = (p[0] - player.pos.x) ** 2 + (p[2] - player.pos.z) ** 2;
    if (d < 1600) near.push([d, p]);
  }
  near.sort((a, b) => a[0] - b[0]);
  lampLights.forEach((l, i) => {
    const it = near[i];
    l.visible = !!it && want > 0.4;
    if (it) { l.position.set(it[1][0], it[1][1] - 0.4, it[1][2]); l.intensity = want; }
  });
}
scene.fog = new THREE.Fog(0xbcd0e0, 90, 820);

// the sky on its own, so it can be baked into the environment map
const skyEnvScene = new THREE.Scene();
skyEnvScene.add(new THREE.Mesh(sky.geometry, sky.material));
let pmrem = null, envAt = -9;
function refreshEnv(day) {
  if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
  const old = scene.environment;
  scene.environment = pmrem.fromScene(skyEnvScene, 0, 1, 3000).texture;
  scene.environmentIntensity = lerp(0.35, 1.0, day);
  if (old) old.dispose();
  envAt = day;
}

/* ------------------------------------------------------------------- post ---
   The scene goes into a buffer and is graded on the way to the screen, which is
   where a modern game actually gets its look. Three passes: pull the bright
   things out, blur them, then put everything back together with a contrast
   curve, a little warmth in the highlights, a vignette and a whisper of grain so
   a flat sky does not band. Writing it by hand keeps the game to a few files.
*/
const postScene = new THREE.Scene();
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
postQuad.frustumCulled = false;
postScene.add(postQuad);

const POST_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const brightMat = new THREE.ShaderMaterial({
  uniforms: { tD: { value: null }, thr: { value: 0.66 } },
  vertexShader: POST_VERT,
  fragmentShader: `
    uniform sampler2D tD; uniform float thr; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tD, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(c * (max(l - thr, 0.0) / max(l, 1e-4)), 1.0);
    }`,
});
const blurMat = new THREE.ShaderMaterial({
  uniforms: { tD: { value: null }, dir: { value: new THREE.Vector2() } },
  vertexShader: POST_VERT,
  fragmentShader: `
    uniform sampler2D tD; uniform vec2 dir; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tD, vUv).rgb * 0.227;
      c += (texture2D(tD, vUv + dir * 1.385).rgb + texture2D(tD, vUv - dir * 1.385).rgb) * 0.316;
      c += (texture2D(tD, vUv + dir * 3.231).rgb + texture2D(tD, vUv - dir * 3.231).rgb) * 0.070;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const finalMat = new THREE.ShaderMaterial({
  uniforms: {
    tD: { value: null }, tB: { value: null },
    bloom: { value: 0.5 }, time: { value: 0 }, night: { value: 0 }, aspect: { value: 1 },
  },
  vertexShader: POST_VERT,
  fragmentShader: `
    uniform sampler2D tD, tB; uniform float bloom, time, night, aspect; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tD, vUv).rgb + texture2D(tB, vUv).rgb * bloom * (1.0 + night * 0.7);
      // a gentle S curve, which is what stops a render looking flat
      c = clamp(c, 0.0, 1.6);
      c = c * c * (3.0 - 2.0 * clamp(c, 0.0, 1.0)) * 0.34 + c * 0.66;
      // warm the highlights, cool the shadows, the standard city grade
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += vec3(0.030, 0.008, -0.020) * l * (1.0 - night * 0.5);
      c += vec3(-0.008, 0.000, 0.022) * (1.0 - l);
      c = mix(vec3(l), c, 1.10);
      // vignette
      vec2 q = (vUv - 0.5) * vec2(aspect, 1.0);
      c *= mix(1.0, smoothstep(0.92, 0.28, length(q)), 0.34);
      // grain
      float g = fract(sin(dot(vUv * (1.0 + fract(time)), vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * 0.010;
      gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
    }`,
});

let rtScene = null, rtA = null, rtB = null;
function makeTargets() {
  const dpr = renderer.getPixelRatio();
  const w = Math.max(4, Math.floor(innerWidth * dpr)), h = Math.max(4, Math.floor(innerHeight * dpr));
  if (rtScene) { rtScene.dispose(); rtA.dispose(); rtB.dispose(); }
  rtScene = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
  const bw = Math.max(4, w >> 2), bh = Math.max(4, h >> 2);
  rtA = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false });
  rtB = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false });
  for (const rt of [rtScene, rtA, rtB]) {
    rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
  }
  finalMat.uniforms.aspect.value = innerWidth / innerHeight;
}
makeTargets();

function draw(mat, target) {
  postQuad.material = mat;
  renderer.setRenderTarget(target);
  renderer.render(postScene, postCam);
}
function renderPost(t) {
  renderer.setRenderTarget(rtScene);
  renderer.clear();
  renderer.render(scene, camera);
  brightMat.uniforms.tD.value = rtScene.texture;
  draw(brightMat, rtA);
  blurMat.uniforms.tD.value = rtA.texture;
  blurMat.uniforms.dir.value.set(1 / rtA.width, 0);
  draw(blurMat, rtB);
  blurMat.uniforms.tD.value = rtB.texture;
  blurMat.uniforms.dir.value.set(0, 1 / rtA.height);
  draw(blurMat, rtA);
  finalMat.uniforms.tD.value = rtScene.texture;
  finalMat.uniforms.tB.value = rtA.texture;
  finalMat.uniforms.time.value = t;
  draw(finalMat, null);
}

/* ---------------------------------------------------------------- the city -- */
const CITY_SEED = 20261115;
let city = null, solids = [];

/* ---------------------------------------------------------------- the player */
const player = {
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  yaw: 0, look: 0,              // look = where the body faces, yaw = where the camera looks
  onGround: false,
  h: 1.82, r: 0.34,
  hp: 100, armour: 0, cash: 0, stars: 0,
  sprint: false, aiming: false, walkT: 0, speed: 0,
  car: null,                    // the car being driven, if any
  model: null,
};
const cam = { yaw: 0, pitch: -0.12, dist: 5.4, target: new THREE.Vector3(), shake: 0 };

/* ---------------------------------------------------------------- the cars -- */
const cars = [];
let traffic = null;

/* ------------------------------------------------------------------- input -- */
const keys = Object.create(null);
let paused = false, chatting = false, pointerLocked = false;
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (chatting) {
    if (k === 'escape') { closeChat(false); e.preventDefault(); }
    return;
  }
  keys[k] = true;
  if (k === 't' && !paused) { openChat(); e.preventDefault(); }
  if (k === 'escape') { setPaused(!paused); e.preventDefault(); }
  if (k === 'f' && !paused) { toggleCar(); e.preventDefault(); }
  if (k === 'r' && !paused) reload();
  if (k === 'q' && !paused) openWheel();
  if (k >= '1' && k <= '7') setWeapon(+k - 1);
  if (k === ' ') e.preventDefault();
});
addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if (k === 'q') closeWheel(true);
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let firedThisClick = false;
renderer.domElement.addEventListener('mousedown', e => {
  if (paused || chatting) return;
  if (!pointerLocked) { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 2) player.aiming = true;
  if (e.button === 0) { fireDown = true; firedThisClick = false; }
});
addEventListener('mouseup', e => {
  if (e.button === 2) player.aiming = false;
  if (e.button === 0) { fireDown = false; firedThisClick = false; }
});
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
addEventListener('mousemove', e => {
  if (!pointerLocked || paused) return;
  if (wheelOn) {                                   // the wheel takes the mouse
    wheelAim.x += e.movementX * 0.02;
    wheelAim.y += e.movementY * 0.02;
    const l = Math.hypot(wheelAim.x, wheelAim.y);
    if (l > 1) { wheelAim.x /= l; wheelAim.y /= l; }
    updateWheel();
    return;
  }
  const slow = player.aiming && wep().scope ? 0.35 : player.aiming ? 0.62 : 1;
  cam.yaw -= e.movementX * 0.0022 * slow;
  cam.pitch = clamp(cam.pitch - e.movementY * 0.0019 * slow, -1.15, 0.72);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  makeTargets();
});

/* ------------------------------------------------------------------ weapons --
   Seven of them, each defined by the handful of numbers that actually change how
   a gun feels: how fast it fires, how far the shots wander, how hard it kicks the
   camera and how much is left in the magazine. */
const WEAPONS = [
  { id: 'fist',    name: 'Fists',   mag: 0,  ammo: -1, rate: 0.40, dmg: 16, melee: true },
  { id: 'pistol',  name: 'Pistol',  mag: 12, ammo: 96,  rate: 0.17,  dmg: 28, spread: 0.010, range: 150, kick: 1.5 },
  { id: 'smg',     name: 'SMG',     mag: 30, ammo: 240, rate: 0.075, dmg: 16, spread: 0.030, range: 120, kick: 0.7, auto: true },
  { id: 'shotgun', name: 'Shotgun', mag: 8,  ammo: 48,  rate: 0.80,  dmg: 13, spread: 0.085, range: 55,  kick: 4.2, pellets: 8 },
  { id: 'rifle',   name: 'Rifle',   mag: 30, ammo: 180, rate: 0.095, dmg: 25, spread: 0.017, range: 220, kick: 1.1, auto: true },
  { id: 'sniper',  name: 'Sniper',  mag: 5,  ammo: 25,  rate: 1.30,  dmg: 110, spread: 0.001, range: 600, kick: 5.0, scope: true },
  { id: 'grenade', name: 'Grenade', mag: 1,  ammo: 8,   rate: 1.00,  dmg: 130, lob: true },
];
for (const w of WEAPONS) w.in = w.mag;               // what is in the magazine now

let weapon = 0, fireDown = false, fireCool = 0, reloadT = 0, meleeT = 0, meleeArm = 1;
const wep = () => WEAPONS[weapon];

function setWeapon(i) {
  if (i < 0 || i >= WEAPONS.length || player.car) return;
  weapon = i; reloadT = 0;
  showGun();
  hudWeapon();
}
function hudWeapon() {
  const w = wep();
  el('wepname').textContent = w.name;
  el('wepammo').innerHTML = !w.mag ? ''
    : reloadT > 0 ? 'RELOADING'
    : w.in + '<em> / ' + (w.ammo < 0 ? '&infin;' : w.ammo) + '</em>';
  el('wep').classList.toggle('on', !player.car);
}
function reload() {
  const w = wep();
  if (!w.mag || reloadT > 0 || w.in >= w.mag || w.ammo <= 0) return;
  reloadT = w.id === 'shotgun' ? 1.9 : w.id === 'sniper' ? 2.2 : 1.5;
  hudWeapon();
}
function finishReload() {
  const w = wep();
  const want = Math.min(w.mag - w.in, w.ammo);
  w.in += want; w.ammo -= want;
  hudWeapon();
}

/* ---- the gun in the hand -------------------------------------------------- */
const gunMetal = new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.45, metalness: 0.7 });
const gunGrip = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.85 });
const gunWood = new THREE.MeshStandardMaterial({ color: 0x4e3320, roughness: 0.8 });
/* The hand hangs off the wrist, so in its own space "forward" is -y. Everything
   below is built along that axis, which is why a gun pointed down the arm ends
   up pointed down the sights when the arm comes up. */
function makeGun(id) {
  const g = new THREE.Group();
  const put = (w, h, d, x, y, z, m) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || gunMetal);
    b.position.set(x, y, z); b.castShadow = true; g.add(b);
  };
  if (id === 'pistol') {
    put(0.045, 0.19, 0.035, 0, -0.14, 0.01);
    put(0.040, 0.10, 0.045, 0, -0.03, -0.02, gunGrip);
    put(0.030, 0.05, 0.030, 0, -0.06, 0.03);
  } else if (id === 'smg') {
    put(0.050, 0.30, 0.055, 0, -0.19, 0.01);
    put(0.040, 0.13, 0.040, 0, -0.04, -0.03, gunGrip);
    put(0.035, 0.12, 0.030, 0, -0.10, 0.06);
    put(0.030, 0.09, 0.075, 0, -0.16, -0.05);
  } else if (id === 'shotgun') {
    put(0.048, 0.52, 0.048, 0, -0.30, 0.01);
    put(0.042, 0.16, 0.060, 0, -0.02, -0.02, gunWood);
    put(0.038, 0.16, 0.038, 0, -0.44, 0.045, gunWood);
  } else if (id === 'rifle') {
    put(0.048, 0.46, 0.050, 0, -0.27, 0.01);
    put(0.042, 0.13, 0.042, 0, -0.03, -0.03, gunGrip);
    put(0.034, 0.16, 0.030, 0, -0.11, 0.055);
    put(0.030, 0.10, 0.034, 0, -0.20, -0.045);
  } else if (id === 'sniper') {
    put(0.046, 0.68, 0.048, 0, -0.40, 0.01);
    put(0.042, 0.14, 0.042, 0, -0.03, -0.03, gunWood);
    put(0.034, 0.22, 0.034, 0, -0.22, 0.062);
    put(0.028, 0.03, 0.028, 0, -0.34, 0.062);
  } else if (id === 'grenade') {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 1),
      new THREE.MeshStandardMaterial({ color: 0x3d4a33, roughness: 0.8 }));
    b.position.set(0, -0.07, 0); b.castShadow = true; g.add(b);
  }
  return g;
}
const gunModels = {};
let heldGun = null;
function showGun() {
  const hand = player.model && player.model.userData.armR.hand;
  if (!hand) return;
  if (heldGun) { hand.remove(heldGun); heldGun = null; }
  const id = wep().id;
  if (id === 'fist') return;
  if (!gunModels[id]) gunModels[id] = makeGun(id);
  heldGun = gunModels[id];
  heldGun.position.set(0.01, -0.07, 0.02);
  hand.add(heldGun);
}

/* ---- the weapon wheel ----------------------------------------------------- */
let wheelOn = false;
const wheelAim = { x: 0, y: -1 };
let wheelPick = 0;
const wheelSegs = [];
function buildWheel() {
  const hub = el('wheelhub');
  WEAPONS.forEach((w, i) => {
    const a = (i / WEAPONS.length) * Math.PI * 2 - Math.PI / 2;
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.style.left = (Math.cos(a) * 150) + 'px';
    seg.style.top = (Math.sin(a) * 150) + 'px';
    seg.innerHTML = '<b>' + w.name + '</b>' + (w.mag ? (w.ammo < 0 ? '' : w.ammo + ' spare') : 'always');
    hub.appendChild(seg);
    wheelSegs.push({ el: seg, a });
  });
}
function openWheel() {
  if (player.car || wheelOn) return;
  wheelOn = true;
  wheelAim.x = 0; wheelAim.y = -1;
  el('wheel').classList.add('on');
  updateWheel();
}
function updateWheel() {
  const ang = Math.atan2(wheelAim.y, wheelAim.x);
  let best = 0, bd = 9;
  wheelSegs.forEach((sgm, i) => {
    let d = Math.abs(((ang - sgm.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    d = Math.PI - d;
    if (d < bd) { bd = d; best = i; }
  });
  wheelPick = best;
  wheelSegs.forEach((sgm, i) => sgm.el.classList.toggle('on', i === best));
}
function closeWheel(take) {
  if (!wheelOn) return;
  wheelOn = false;
  el('wheel').classList.remove('on');
  if (take) setWeapon(wheelPick);
}

/* ------------------------------------------------------------- collision ---- */
// The world is a pile of axis-aligned boxes standing on the ground, which is all a
// city of buildings actually is. Cheap to test and exact enough to walk around.
function hitsSolid(x, y, z, r, h) {
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (y > s.h || y + h < 0) continue;
    if (Math.abs(x - s.x) < s.w / 2 + r && Math.abs(z - s.z) < s.d / 2 + r) return s;
  }
  return null;
}
function groundAt(x, z) {
  // pavements are raised; roads are at zero
  const g = CITY.grid, pitch = CITY.pitch, origin = -CITY.half + CITY.road / 2;
  const bx = Math.floor((x - origin) / pitch), bz = Math.floor((z - origin) / pitch);
  if (bx < 0 || bz < 0 || bx >= g || bz >= g) return 0;
  const lx = x - (origin + bx * pitch), lz = z - (origin + bz * pitch);
  return (lx >= 0 && lx <= CITY.block && lz >= 0 && lz <= CITY.block) ? 0.28 : 0;
}

/* -------------------------------------------------------------- on foot ----- */
const WALK = 3.1, RUN = 6.4, SPRINT = 9.2, GRAV = 22, JUMP = 7.4;
function stepPlayer(dt) {
  const fwd = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const wish = new THREE.Vector3();
  if (keys['w']) wish.add(fwd);
  if (keys['s']) wish.sub(fwd);
  if (keys['d']) wish.add(right);
  if (keys['a']) wish.sub(right);
  const moving = wish.lengthSq() > 0;
  if (moving) wish.normalize();

  player.sprint = !!keys['shift'] && !player.aiming;
  const want = player.aiming ? WALK : player.sprint ? SPRINT : RUN;
  const target = wish.multiplyScalar(moving ? want : 0);
  const accel = player.onGround ? 14 : 3.5;
  player.vel.x = lerp(player.vel.x, target.x, 1 - Math.exp(-accel * dt));
  player.vel.z = lerp(player.vel.z, target.z, 1 - Math.exp(-accel * dt));

  player.vel.y -= GRAV * dt;
  if (keys[' '] && player.onGround) { player.vel.y = JUMP; player.onGround = false; }

  // move, axis at a time, so sliding along a wall works
  const p = player.pos;
  const nx = p.x + player.vel.x * dt;
  if (!hitsSolid(nx, p.y, p.z, player.r, player.h)) p.x = nx; else player.vel.x = 0;
  const nz = p.z + player.vel.z * dt;
  if (!hitsSolid(p.x, p.y, nz, player.r, player.h)) p.z = nz; else player.vel.z = 0;

  p.y += player.vel.y * dt;
  const g = groundAt(p.x, p.z);
  if (p.y <= g) { p.y = g; player.vel.y = 0; player.onGround = true; }
  else player.onGround = false;

  // the body turns to face the way it is going, or the way you aim
  player.speed = Math.hypot(player.vel.x, player.vel.z);
  if (player.aiming) player.look = cam.yaw;
  else if (player.speed > 0.4) {
    const want = Math.atan2(-player.vel.x, -player.vel.z);
    let d = want - player.look;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    player.look += d * (1 - Math.exp(-11 * dt));
  }
  player.walkT += player.speed * dt * 1.5;
}

/* ---------------------------------------------------------------- driving --- */
function toggleCar() {
  if (player.car) {
    const c = player.car;
    // step out on the left, if there is room
    const side = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw)).multiplyScalar(1.9);
    const x = c.pos.x + side.x, z = c.pos.z + side.z;
    player.pos.set(x, groundAt(x, z), z);
    player.vel.set(0, 0, 0);
    c.driver = null; player.car = null;
    player.model.visible = true;
    el('speedo').style.display = 'none';
    hint('');
    hudWeapon();
    return;
  }
  let best = null, bd = 3.4;
  for (const c of cars) {
    if (c.driver) continue;
    const d = Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return;
  player.car = best; best.driver = 'me';
  best.group.matrixWorldAutoUpdate = true;              // it was parked and frozen
  best.parked = false;
  player.model.visible = false;
  el('speedo').style.display = 'block';
  el('wepname').textContent = best.kind.label;
  el('wepammo').textContent = '';
  hint('');
}
function stepCar(c, dt) {
  const k = c.kind;
  const throttle = (keys['w'] ? 1 : 0) - (keys['s'] ? 1 : 0);
  const steer = (keys['a'] ? 1 : 0) - (keys['d'] ? 1 : 0);
  const hand = !!keys['shift'];

  // engine and brakes
  const goingForward = c.speed > 0.2;
  if (throttle > 0) c.speed += (c.speed < 0 ? k.brake : k.accel) * dt;
  else if (throttle < 0) c.speed -= (c.speed > 0 ? k.brake : k.accel * 0.55) * dt;
  else c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), k.drag * dt);
  if (keys[' ']) c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), k.brake * 1.5 * dt);
  c.speed = clamp(c.speed, -k.top * 0.4, k.top);

  // steering: less lock the faster you go, which is what stops a car spinning at speed
  const grip = hand ? 0.35 : 1;
  const lock = k.steer * (1 - Math.min(0.72, Math.abs(c.speed) / k.top * 0.8));
  const turn = steer * lock * clamp(Math.abs(c.speed) / 6, 0, 1) * (goingForward ? 1 : -1);
  c.yaw += turn * dt;

  // the body leans, and the back steps out under power or the handbrake
  c.slip = lerp(c.slip, turn * (hand ? 2.6 : 0.8) * clamp(Math.abs(c.speed) / k.top, 0, 1), 1 - Math.exp(-6 * dt));
  c.roll = lerp(c.roll, -turn * 0.25 * clamp(Math.abs(c.speed) / 14, 0, 1), 1 - Math.exp(-8 * dt));

  const dir = new THREE.Vector3(-Math.sin(c.yaw + c.slip * 0.22), 0, -Math.cos(c.yaw + c.slip * 0.22));
  const nx = c.pos.x + dir.x * c.speed * dt;
  const nz = c.pos.z + dir.z * c.speed * dt;
  let hitX = hitsSolid(nx, 0.6, c.pos.z, k.w * 0.5, 1.4);
  let hitZ = hitsSolid(c.pos.x, 0.6, nz, k.w * 0.5, 1.4);
  for (const o of cars) {                              // and the other traffic
    if (o === c || !o.group.visible) continue;
    const near = Math.abs(o.pos.x - c.pos.x) < 9 && Math.abs(o.pos.z - c.pos.z) < 9;
    if (!near) continue;
    const rr = (k.l + o.kind.l) * 0.28;
    if (Math.hypot(o.pos.x - nx, o.pos.z - c.pos.z) < rr) hitX = hitX || o;
    if (Math.hypot(o.pos.x - c.pos.x, o.pos.z - nz) < rr) hitZ = hitZ || o;
  }
  if (!hitX) c.pos.x = nx;
  if (!hitZ) c.pos.z = nz;
  if (hitX || hitZ) {                                  // a bump costs you most of your speed
    c.speed *= -0.22;
    cam.shake = Math.min(1, cam.shake + 0.5);
    if (c.driver === 'me') damage(Math.min(18, Math.abs(c.speed) * 1.2));
  }
  c.pos.y = lerp(c.pos.y, groundAt(c.pos.x, c.pos.z), 1 - Math.exp(-12 * dt));
  c.wheelSpin += c.speed * dt / 0.34;
  c.steerVis = lerp(c.steerVis, steer * 0.5, 1 - Math.exp(-12 * dt));
  c.apply();
}

/* ---------------------------------------------------------------- shooting --
   One ray per shot, tested against the buildings, the traffic and the people. A
   pellet gun just fires the same ray several times with a wider cone. */
function rayAABB(o, d, minx, maxx, miny, maxy, minz, maxz) {
  let t0 = 0, t1 = 1e9;
  const ax = [[minx, maxx, o.x, d.x], [miny, maxy, o.y, d.y], [minz, maxz, o.z, d.z]];
  for (const a of ax) {
    if (Math.abs(a[3]) < 1e-6) { if (a[2] < a[0] || a[2] > a[1]) return null; continue; }
    let lo = (a[0] - a[2]) / a[3], hi = (a[1] - a[2]) / a[3];
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    t0 = Math.max(t0, lo); t1 = Math.min(t1, hi);
    if (t0 > t1) return null;
  }
  return t0;
}
function rayBox(o, d, s) {
  return rayAABB(o, d, s.x - s.w / 2, s.x + s.w / 2, 0, s.h, s.z - s.d / 2, s.z + s.d / 2);
}
function rayCar(o, d, c) {
  // into the car's own frame, so a car parked at an angle is still a box
  const cs = Math.cos(-c.yaw), sn = Math.sin(-c.yaw);
  const px = o.x - c.pos.x, pz = o.z - c.pos.z;
  const lo = { x: px * cs - pz * sn, y: o.y - c.pos.y, z: px * sn + pz * cs };
  const ld = { x: d.x * cs - d.z * sn, y: d.y, z: d.x * sn + d.z * cs };
  const k = c.kind;
  return rayAABB(lo, ld, -k.w / 2, k.w / 2, 0.1, 0.42 + k.h + k.roof, -k.l / 2, k.l / 2);
}
function castRay(from, dir, range) {
  let t = range, hit = null;
  for (let i = 0; i < solids.length; i++) {
    const d = rayBox(from, dir, solids[i]);
    if (d != null && d < t) { t = d; hit = { kind: 'world' }; }
  }
  if (traffic) {
    for (const p of traffic.peds) {
      if (!p.g.visible || p.dead) continue;
      const q = p.g.position;
      const d = rayAABB(from, dir, q.x - 0.3, q.x + 0.3, q.y + 0.1, q.y + 1.85, q.z - 0.26, q.z + 0.26);
      if (d != null && d < t) { t = d; hit = { kind: 'ped', ped: p }; }
    }
    for (const c of cars) {
      if (!c.group.visible || c === player.car) continue;
      if (Math.abs(c.pos.x - from.x) > range || Math.abs(c.pos.z - from.z) > range) continue;
      const d = rayCar(from, dir, c);
      if (d != null && d < t) { t = d; hit = { kind: 'car', car: c }; }
    }
  }
  if (net && net.others) {
    for (const o of net.others.values()) {
      if (!o.g || !o.g.visible) continue;
      const q = o.g.position;
      const d = rayAABB(from, dir, q.x - 0.3, q.x + 0.3, q.y + 0.1, q.y + 1.85, q.z - 0.26, q.z + 0.26);
      if (d != null && d < t) { t = d; hit = { kind: 'player', id: o.id }; }
    }
  }
  return { t, hit };
}

function gunTip() {
  if (heldGun) {
    const v = new THREE.Vector3(0, -0.34, 0);
    heldGun.localToWorld(v);
    return v;
  }
  return camera.getWorldPosition(new THREE.Vector3());
}

function fireOnce(w) {
  const from = camera.getWorldPosition(new THREE.Vector3());
  const base = camera.getWorldDirection(new THREE.Vector3());
  const spread = w.spread * (player.aiming ? 0.55 : 1) * (player.speed > 4 ? 1.8 : 1);
  const shots = w.pellets || 1;
  let struck = false;
  for (let n = 0; n < shots; n++) {
    const dir = base.clone();
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    const r = castRay(from, dir, w.range);
    const end = from.clone().addScaledVector(dir, r.t);
    tracer(gunTip(), end);
    if (r.hit) {
      impact(end, r.hit.kind === 'ped' || r.hit.kind === 'player' ? 'body' : r.hit.kind);
      if (r.hit.kind === 'ped') { hurtPed(r.hit.ped, w.dmg); struck = true; }
      if (r.hit.kind === 'car') { hurtCar(r.hit.car, w.dmg); struck = true; }
      if (r.hit.kind === 'player' && net) { net.hit(r.hit.id, w.dmg); struck = true; }
    }
  }
  muzzle(gunTip(), w.id === 'shotgun' || w.id === 'sniper' ? 1.5 : 1);
  if (struck) flashReticle();
  cam.shake = Math.min(1, cam.shake + w.kick * 0.06);
  cam.pitch = clamp(cam.pitch + w.kick * 0.0045, -1.15, 0.72);
  if (net) net.shot(from, base);
}

function throwGrenade() {
  const from = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 1),
    new THREE.MeshStandardMaterial({ color: 0x3d4a33, roughness: 0.8 }));
  mesh.castShadow = true;
  mesh.position.copy(from).addScaledVector(dir, 1.1);
  scene.add(mesh);
  grenades.push({
    mesh, vel: dir.clone().multiplyScalar(21).add(new THREE.Vector3(0, 4.5, 0)), t: 0,
  });
}
const grenades = [];
function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.t += dt;
    g.vel.y -= 22 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    const floor = groundAt(g.mesh.position.x, g.mesh.position.z) + 0.08;
    if (g.mesh.position.y < floor) {
      g.mesh.position.y = floor;
      g.vel.y = Math.abs(g.vel.y) * 0.34;
      g.vel.x *= 0.6; g.vel.z *= 0.6;
    }
    if (g.t > 2.1) {
      blast(g.mesh.position.clone(), 130, 9);
      scene.remove(g.mesh); g.mesh.geometry.dispose();
      grenades.splice(i, 1);
    }
  }
}
function blast(pos, dmg, radius) {
  explode(pos);
  cam.shake = Math.min(1.4, cam.shake + 1.1);
  if (traffic) {
    for (const p of traffic.peds) {
      if (p.dead) continue;
      const d = p.g.position.distanceTo(pos);
      if (d < radius) hurtPed(p, dmg * (1 - d / radius));
    }
    for (const c of cars) {
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d < radius) hurtCar(c, dmg * (1 - d / radius));
    }
  }
  const dp = player.pos.distanceTo(pos);
  if (dp < radius) damage(dmg * 0.7 * (1 - dp / radius));
  if (net) net.blast(pos, dmg, radius);
}

/* ---- what the shots hit --------------------------------------------------- */
function hurtPed(p, dmg) {
  if (p.dead) return;
  p.hp = (p.hp === undefined ? 100 : p.hp) - dmg;
  if (p.hp <= 0) {
    p.dead = 7;
    p.g.rotation.x = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
    p.g.position.y = groundAt(p.g.position.x, p.g.position.z) + 0.25;
    wanted(2);
    player.cash += 12;
  } else {
    p.idle = 0; p.speed = 3.4;                      // they run for it
    wanted(1);
  }
}
function hurtCar(c, dmg) {
  c.hp = (c.hp === undefined ? 140 : c.hp) - dmg;
  if (c.hp <= 0 && !c.wreck) {
    c.wreck = true;
    blast(new THREE.Vector3(c.pos.x, c.pos.y + 0.8, c.pos.z), 90, 7.5);
    c.char();
    if (c.driver === 'me') { player.car = null; player.model.visible = true; el('speedo').style.display = 'none'; hudWeapon(); }
    c.driver = null;
    wanted(3);
  }
}

/* ---- being wanted --------------------------------------------------------- */
let heatT = 0;
function wanted(n) {
  if (n > player.stars) { player.stars = Math.min(5, n); drawStars(); }
  heatT = 22;
}
function drawStars() {
  const kids = el('stars').children;
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('on', i < player.stars);
  el('stars').classList.toggle('hot', player.stars > 0);
}
function stepHeat(dt) {
  if (player.stars <= 0) return;
  heatT -= dt;
  if (heatT <= 0) { player.stars--; heatT = 22; drawStars(); }
}

let reticleT = 0;
function flashReticle() {
  el('reticle').classList.add('hit');
  reticleT = 0.12;
}

function damage(n) {
  if (player.armour > 0) { const take = Math.min(player.armour, n); player.armour -= take; n -= take; }
  player.hp = clamp(player.hp - n, 0, 100);
  cam.shake = Math.min(1, cam.shake + 0.3);
  const h = el('hurt');
  h.classList.add('on');
  setTimeout(() => h.classList.remove('on'), 60);
  if (player.hp <= 0) respawn();
}
function respawn() {
  player.hp = 100; player.armour = 0; player.stars = 0; drawStars();
  if (player.car) { player.car.driver = null; player.car = null; player.model.visible = true; el('speedo').style.display = 'none'; }
  const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 160;
  const x = Math.cos(a) * d, z = Math.sin(a) * d;
  player.pos.set(x, groundAt(x, z), z);
  player.vel.set(0, 0, 0);
  for (const w of WEAPONS) if (w.mag) w.in = w.mag;
  hudWeapon();
  say('You woke up somewhere else.', 'sys');
}

function punchLands(w) {
  if (!traffic) return;
  const fwd = new THREE.Vector3(-Math.sin(player.look), 0, -Math.cos(player.look));
  for (const p of traffic.peds) {
    if (p.dead || !p.g.visible) continue;
    const dx = p.g.position.x - player.pos.x, dz = p.g.position.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.9) continue;
    if ((dx * fwd.x + dz * fwd.z) / (d || 1) < 0.35) continue;
    hurtPed(p, w.dmg);
    impact(new THREE.Vector3(p.g.position.x, p.g.position.y + 1.2, p.g.position.z), 'body');
    flashReticle();
    break;
  }
}

/* -------------------------------------------------------------- the camera -- */
function stepCamera(dt) {
  const inCar = !!player.car;
  const anchor = inCar
    ? new THREE.Vector3(player.car.pos.x, player.car.pos.y + 1.5, player.car.pos.z)
    : new THREE.Vector3(player.pos.x, player.pos.y + 1.5, player.pos.z);
  const wantDist = cam.lock || (inCar ? 8.4 : (player.aiming ? 2.4 : 5.4));
  cam.dist = lerp(cam.dist, wantDist, 1 - Math.exp(-7 * dt));
  cam.target.lerp(anchor, 1 - Math.exp(-16 * dt));

  const off = new THREE.Vector3(
    Math.sin(cam.yaw) * Math.cos(cam.pitch),
    -Math.sin(cam.pitch),
    Math.cos(cam.yaw) * Math.cos(cam.pitch)
  ).multiplyScalar(cam.dist);
  if (player.aiming && !inCar) { off.x += Math.cos(cam.yaw) * 0.75; off.z += -Math.sin(cam.yaw) * 0.75; }

  // do not let the camera go inside a building
  let d = cam.dist;
  const dir = off.clone().normalize();
  for (const s of solids) {
    const t = rayBox(cam.target, dir, s);
    if (t != null && t < d) d = Math.max(1.1, t - 0.35);
  }
  off.setLength(d);
  camera.position.copy(cam.target).add(off);
  camera.position.y = Math.max(camera.position.y, groundAt(camera.position.x, camera.position.z) + 0.45);
  if (cam.shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * cam.shake * 0.12;
    camera.position.y += (Math.random() - 0.5) * cam.shake * 0.12;
    cam.shake *= Math.exp(-6 * dt);
  }
  camera.lookAt(cam.target);
}

/* ------------------------------------------------------------------- night -- */
let clock = 9.5;                              // hours
function stepSky(dt) {
  clock = (clock + dt * 0.02) % 24;
  const t = (clock / 24) * Math.PI * 2 - Math.PI / 2;
  const height = Math.sin(t);
  const day = clamp(height * 1.6 + 0.35, 0, 1);
  const night = 1 - day;
  sun.position.set(Math.cos(t) * 200, Math.max(-40, height * 220), 90);
  sun.target.position.set(player.pos.x, 0, player.pos.z);
  sun.position.add(new THREE.Vector3(player.pos.x, 0, player.pos.z));
  sun.intensity = 2.8 * day;
  sun.color.setHSL(0.09, 0.55, lerp(0.52, 0.72, day));
  hemi.intensity = lerp(0.26, 0.55, day);
  fill.intensity = lerp(0.15, 0.22, day);
  // after dark the fill takes the colour of a city, not of a blue sky
  fill.color.setHSL(lerp(0.09, 0.58, day), lerp(0.30, 0.20, day), 0.6);
  beamMat.uniforms.uStrength.value = night * 0.7;
  headMat.emissiveIntensity = night * 1.4;
  lampPick -= dt;
  if (lampPick <= 0) { lampPick = 0.2; pickLamps(night); }
  const top = new THREE.Color().setHSL(0.6, 0.62, lerp(0.05, 0.34, day));
  const bot = new THREE.Color().setHSL(0.58, 0.45, lerp(0.07, 0.74, day));
  skyUniforms.top.value.copy(top);
  skyUniforms.bottom.value.copy(bot);
  skyUniforms.drift.value += dt * 0.0016;
  skyUniforms.cloudLit.value.setHSL(0.10, 0.22 * (1 - day) + 0.06, lerp(0.10, 0.95, day));
  skyUniforms.cloudDark.value.setHSL(0.60, 0.20, lerp(0.05, 0.62, day));
  skyUniforms.sun.value.copy(sun.position).normalize();
  scene.fog.color.copy(bot);
  scene.fog.near = lerp(50, 90, day);
  scene.fog.far = lerp(520, 820, day);
  renderer.setClearColor(bot);
  finalMat.uniforms.night.value = night;
  if (city) city.setNight(night);
  // the environment map is expensive, so it is rebuilt only when the light has
  // actually moved rather than every frame
  if (Math.abs(day - envAt) > 0.04) refreshEnv(day);
}

/* ---------------------------------------------------------------- minimap ---
   Drawn once into a big canvas and then panned, turned and scaled into the small
   one. It turns with you, because a map that turns is the one thing that makes a
   grid city navigable without street names. */
const mapc = el('mapc'), mg = mapc.getContext('2d');
let mapBase = null;
const MAP_S = 1200;
function drawMapBase() {
  const c = document.createElement('canvas'); c.width = c.height = MAP_S;
  const g = c.getContext('2d');
  const span = CITY.grid * CITY.pitch + CITY.road;
  const k = MAP_S / span;
  g.fillStyle = '#2b3038'; g.fillRect(0, 0, MAP_S, MAP_S);          // the road network
  const origin = -CITY.half + CITY.road / 2;
  for (const b of (city && city.blocks) || []) {
    const x = (b.x - CITY.block / 2 + span / 2) * k, z = (b.z - CITY.block / 2 + span / 2) * k;
    g.fillStyle = b.park ? '#39512f' : '#171a1f';
    g.fillRect(x, z, CITY.block * k, CITY.block * k);
  }
  // a hairline down the middle of every road, like a road atlas
  g.strokeStyle = 'rgba(255,255,255,.10)'; g.lineWidth = Math.max(1, 0.5 * k);
  for (let i = 0; i <= CITY.grid; i++) {
    const at = (-CITY.half + i * CITY.pitch + span / 2) * k;
    g.beginPath(); g.moveTo(at, 0); g.lineTo(at, MAP_S); g.stroke();
    g.beginPath(); g.moveTo(0, at); g.lineTo(MAP_S, at); g.stroke();
  }
  mapBase = c;
}
function drawMap() {
  if (!mapBase) drawMapBase();
  const W = mapc.width, H = mapc.height;
  const span = CITY.grid * CITY.pitch + CITY.road;
  const k = MAP_S / span;
  const inCar = !!player.car;
  const zoom = inCar ? 0.92 : 1.25;      // a car needs to see further ahead
  const px = inCar ? player.car.pos.x : player.pos.x;
  const pz = inCar ? player.car.pos.z : player.pos.z;
  const head = inCar ? player.car.yaw : player.look;

  mg.save();
  mg.fillStyle = '#10131a'; mg.fillRect(0, 0, W, H);
  mg.beginPath(); mg.rect(0, 0, W, H); mg.clip();
  mg.translate(W / 2, H * 0.58);
  mg.rotate(head);                                   // north swings, you stay up
  mg.scale(zoom, zoom);
  mg.translate(-(px + span / 2) * k, -(pz + span / 2) * k);
  mg.drawImage(mapBase, 0, 0);

  // other people in the world
  if (net && net.others) {
    mg.fillStyle = '#7fd1ff';
    for (const o of net.others.values()) {
      if (!o.g) continue;
      mg.beginPath();
      mg.arc((o.g.position.x + span / 2) * k, (o.g.position.z + span / 2) * k, 3.4 / zoom, 0, 7);
      mg.fill();
    }
  }
  mg.restore();

  // the cone of view, then the blip, both pinned to the middle
  mg.save();
  mg.translate(W / 2, H * 0.58);
  const grd = mg.createRadialGradient(0, 0, 2, 0, 0, 74);
  grd.addColorStop(0, 'rgba(255,255,255,.20)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  mg.fillStyle = grd;
  mg.beginPath(); mg.moveTo(0, 0); mg.arc(0, 0, 74, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); mg.closePath(); mg.fill();
  mg.fillStyle = player.car ? '#ffd23f' : '#ffffff';
  mg.strokeStyle = 'rgba(0,0,0,.75)'; mg.lineWidth = 2;
  mg.beginPath(); mg.moveTo(0, -11); mg.lineTo(7, 9); mg.lineTo(0, 5); mg.lineTo(-7, 9); mg.closePath();
  mg.fill(); mg.stroke();
  mg.restore();
}

/* ------------------------------------------------------------------- chat --- */
function say(text, cls) {
  const log = el('chatlog');
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.innerHTML = text;
  log.appendChild(d);
  while (log.children.length > 9) log.removeChild(log.firstChild);
  setTimeout(() => { if (d.parentNode) d.style.opacity = '0'; }, 14000);
}
window.gtaSay = say;
function openChat() {
  chatting = true; el('chatbox').classList.add('on'); el('chatin').value = '';
  document.exitPointerLock(); setTimeout(() => el('chatin').focus(), 0);
}
function closeChat(send) {
  const v = el('chatin').value.trim();
  chatting = false; el('chatbox').classList.remove('on'); el('chatin').blur();
  if (send && v) { if (net) net.chat(v); else say('<b>You</b> ' + esc(v), 'me'); }
}
el('chatin').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') closeChat(true);
  if (e.key === 'Escape') closeChat(false);
});
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
window.gtaEsc = esc;

/* ------------------------------------------------------------------- hints -- */
let hintUntil = 0;
function hint(t) {
  const h = el('hint');
  if (!t) { h.classList.remove('on'); return; }
  h.innerHTML = t; h.classList.add('on'); hintUntil = performance.now() + 2500;
}

/* ------------------------------------------------------------------ pause --- */
function setPaused(v) {
  paused = v;
  el('pause').classList.toggle('on', v);
  if (v) document.exitPointerLock();
  else renderer.domElement.requestPointerLock();
}
el('resume').addEventListener('click', () => setPaused(false));

/* --------------------------------------------------------------- the loop --- */
let net = null;
let last = performance.now(), started = false;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!started) return;
  simulate(dt, now);
  drawHud(now);
  renderPost(now / 1000);
}

// Everything that moves, split out from the drawing so a test can run the world
// forward without waiting on a renderer.
function simulate(dt, now) {
  const slow = wheelOn ? 0.22 : 1;
  const sdt = dt * slow;
  if (!paused && !chatting) {
    if (player.car) stepCar(player.car, sdt);
    else stepPlayer(sdt);
    stepGrenades(sdt);
    stepHeat(dt);
    fireCool -= sdt;
    meleeT = Math.max(0, meleeT - sdt);
    if (reloadT > 0) { reloadT -= sdt; if (reloadT <= 0) { reloadT = 0; finishReload(); } }
    const w = wep();
    const wantFire = fireDown && !player.car && !wheelOn && fireCool <= 0 && reloadT <= 0;
    if (wantFire && (w.auto || !firedThisClick)) {
      firedThisClick = true;
      if (w.melee) {
        meleeT = w.rate; meleeArm = meleeArm ? 0 : 1;
        fireCool = w.rate;
        setTimeout(() => punchLands(w), 150);
      } else if (w.in > 0) {
        w.in--;
        if (w.lob) throwGrenade(); else fireOnce(w);
        if (w.lob) { w.ammo--; w.in = Math.min(1, w.ammo); }
        fireCool = w.rate;
        hudWeapon();
      } else {
        reload();
        fireCool = 0.25;
      }
    }
  }
  if (traffic && !paused && !chatting) {
    const eye = player.car ? player.car.pos : player.pos;
    traffic.step(dt, eye, now / 1000, player.car);
  }
  stepCamera(dt);
  stepSky(dt);

  // the person
  if (player.car) {
    player.model.visible = false;
  } else {
    player.model.visible = true;
    player.model.position.set(player.pos.x, player.pos.y, player.pos.z);
    player.model.rotation.y = player.look;
    if (meleeT > 0) posePunch(player.model, 1 - meleeT / wep().rate, meleeArm);
    else if (player.aiming) poseAim(player.model, cam.pitch);
    else if (player.speed > 0.4) poseWalk(player.model, player.walkT, Math.min(1, player.speed / SPRINT));
    else poseIdle(player.model, now / 1000);
  }

  if (reticleT > 0) { reticleT -= dt; if (reticleT <= 0) el('reticle').classList.remove('hit'); }
  stepFx(dt, camera);
  if (net) net.tick(dt);
  if (city.tick) city.tick(now / 1000);
}

function drawHud(now) {
  if (hintUntil && now > hintUntil) { el('hint').classList.remove('on'); hintUntil = 0; }

  // near a car? say so
  if (!player.car && !paused) {
    let near = false;
    for (const c of cars) if (!c.driver && Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < 3.4) near = true;
    if (near && !hintUntil) hint('<b>F</b> to get in');
  }

  // hud
  el('hpbar').style.transform = 'scaleX(' + (player.hp / 100) + ')';
  el('apbar').style.transform = 'scaleX(' + (player.armour / 100) + ')';
  el('cash').textContent = '$' + player.cash.toLocaleString();
  el('reticle').classList.toggle('on', player.aiming && !player.car && !wep().melee);
  if (player.car) {
    const mph = Math.abs(player.car.speed) * 2.237;
    el('spd').textContent = Math.round(mph);
    el('gear').textContent = player.car.speed < -0.2 ? 'R' : 'D';
  }
  drawMap();
}

/* ------------------------------------------------------------------ start --- */
async function start() {
  el('loadline').textContent = 'laying out the streets…';
  await new Promise(r => setTimeout(r, 30));
  city = buildCity(scene, CITY_SEED, () => {});
  solids = city.solids;

  el('loadline').textContent = 'putting the traffic out…';
  await new Promise(r => setTimeout(r, 20));
  traffic = makeTraffic(scene, city, 99);
  for (const c of traffic.cars) cars.push(c);

  el('loadline').textContent = 'almost there…';
  player.model = makePerson(0x2a3a6a, 0xe0b48c);
  scene.add(player.model);
  initFx(scene);
  buildWheel();
  drawStars();
  showGun();
  // the middle of a junction, so the first thing you see is a street rather than
  // the six feet of alley between two towers
  const junction = -CITY.half + CITY.road / 2 + 4 * CITY.pitch - CITY.road / 2;
  player.pos.set(junction, 0, junction);
  cam.target.copy(player.pos);
  cam.yaw = Math.PI * 0.25;
  hudWeapon();
  drawMapBase();

  // multiplayer is optional: if the server is not reachable the city is still there
  try {
    const mod = await import('./net.js');
    net = mod.connect({ scene, player, cars, say, esc, THREE, damage, explode, tracer });
  } catch (e) { say('Playing on your own - could not reach the server.', 'sys'); }

  refreshEnv(1);
  started = true;
  boot.classList.add('gone');
  el('hud').classList.add('on');
  renderer.domElement.requestPointerLock();
  say('Welcome to the city. <b>T</b> to talk.', 'sys');
}
el('play').addEventListener('click', start);
frame();

// a handle for the tests
window.__gta = {
  get player(){ return player; },
  get cars(){ return cars; },
  get city(){ return city; },
  get cam(){ return cam; },
  get started(){ return started; },
  start, setPaused, toggleCar, setWeapon, say, reload,
  fire(){ const w = wep(); if (w.melee || w.in <= 0) return; w.in--; if (w.lob) throwGrenade(); else fireOnce(w); hudWeapon(); },
  wheel(on){ if (on) openWheel(); else closeWheel(true); },
  hurt(n){ damage(n); },
  tp(x,z){ player.pos.set(x, groundAt(x,z), z); player.vel.set(0,0,0);
    cam.target.set(x, player.pos.y + 1.5, z); },
  get traffic(){ return traffic; },
  stats(){ return { pos:[+player.pos.x.toFixed(2),+player.pos.y.toFixed(2),+player.pos.z.toFixed(2)],
    hp:player.hp, stars:player.stars, car:!!player.car, speed:player.car?+player.car.speed.toFixed(2):0,
    solids:solids.length, cars:cars.length, peds:traffic?traffic.peds.length:0, weapon:wep().name, ammo:wep().in, clock:+clock.toFixed(1) }; },
  key(k, on){ keys[k] = !!on; },
  step(n, dt){ for (let i = 0; i < (n || 1); i++) simulate(dt || 0.05, performance.now()); },
  perf(){ const t0 = performance.now(); scene.updateMatrixWorld(true); const t1 = performance.now();
    renderer.setRenderTarget(null); renderer.render(scene, camera); const t2 = performance.now();
    return { matrixMs:+(t1-t0).toFixed(2), renderMs:+(t2-t1).toFixed(2),
             calls:renderer.info.render.calls, tris:renderer.info.render.triangles,
             programs:renderer.info.programs.length }; },
  setClock(h){ clock = h; },
};
