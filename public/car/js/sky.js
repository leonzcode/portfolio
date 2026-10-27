// The sky, the sun and the light the car is lit by. A physical sky (three's Preetham Sky) with the sun at a
// mid-afternoon height, its picture made into the scene's environment (what the paint and glass reflect), a
// hazy fog towards the horizon, and the sun's shadow box following the camera's target.
import * as THREE from 'three';
import { Sky as SkyMesh } from 'three/addons/objects/Sky.js';

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.mesh = new SkyMesh(); this.mesh.scale.setScalar(150000);
    const u = this.mesh.material.uniforms;
    u.turbidity.value = 3.2; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    this.mesh.material.fog = false;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xfff3e2, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const S = 45;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 400 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6157, 0.9);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbcd0e6, 0.00009);

    this.dir = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.clouds = makeClouds();
    scene.add(this.clouds);
    this.setSun(48, 215);
  }

  // elevation and azimuth in degrees (azimuth clockwise from north)
  setSun(elev, az) {
    const e = THREE.MathUtils.degToRad(elev), a = THREE.MathUtils.degToRad(az);
    this.dir.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
    this.mesh.material.uniforms.sunPosition.value.copy(this.dir).multiplyScalar(1000);
    this.clouds.material.uniforms.uSun.value.copy(this.dir);
    this.makeEnv();
  }

  makeEnv() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const s = new THREE.Scene();
    const m = new SkyMesh(); m.scale.setScalar(1000);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) m.material.uniforms[k].value = this.mesh.material.uniforms[k].value;
    m.material.uniforms.sunPosition.value.copy(this.dir).multiplyScalar(1000);
    s.add(m);
    // a dim ground under the horizon so the underside of the car is not lit by sky
    const g = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a4640, side: THREE.BackSide }));
    s.add(g);
    if (this.env) this.env.dispose();
    this.env = pm.fromScene(s, 0.02).texture;
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.85;
    pm.dispose();
  }

  // keep the shadow box round what the camera looks at (the car), snapped to texels so edges do not crawl
  update(camera, focus) {
    const f = focus || camera.position;
    const S = this.sun.shadow.camera.right, texel = (2 * S) / this.sun.shadow.mapSize.x;
    this.focus.set(Math.round(f.x / texel) * texel, Math.round(f.y / texel) * texel, Math.round(f.z / texel) * texel);
    this.sun.target.position.copy(this.focus);
    this.sun.position.copy(this.focus).addScaledVector(this.dir, 200);
    this.sun.target.updateMatrixWorld();
    this.mesh.position.copy(camera.position);
    // the cloud deck follows the camera across, its pattern stays put in the world (and drifts with the wind)
    this.clouds.position.set(camera.position.x, 1500, camera.position.z);
    this.clouds.material.uniforms.uTime.value = performance.now() / 1000;
  }
}

// ---------------------------------------------------------------------------------------------------------
// The sun's shadow pass made cheaper (perf agent A; main.js calls these round renderer.render).
// 1. One depth material per kind of caster. three.js draws every caster without a depth material of its own with one
//    shared MeshDepthMaterial, and an instanced, an instanced-and-coloured, a skinned and a plain caster each need a
//    different program for it: the program was worked out again at every switch (about ten times a frame in a city).
//    Casters whose shadow needs their own material's state (alpha-tested leaves, displacement, clipping) keep three's.
// 2. Shadow-only stand-ins (cars.js shadowOnly, parked cars' shadow parts: userData.shadowOnly) are left out of the
//    main pass altogether: drawing them there with an empty range still set their program and uniforms.
const DEPTH = new Map(), OURS = new WeakSet();
let shadowOnly = [];
function ownDepth(m) { return !m || m.alphaTest > 0 || m.alphaToCoverage === true || (m.displacementMap && m.displacementScale !== 0) || (Array.isArray(m.clippingPlanes) && m.clippingPlanes.length > 0); }
// 3b. Subtrees in which nothing is drawn and nothing lights the scene (the bones of every person's skeleton: about
//    eighty nodes a person, thousands in a busy street) are hidden while the frame is drawn, so neither pass walks
//    them (both walked every node; a hidden bone still moves its skin, as the skin reads the bones' world matrices,
//    which three works out for hidden nodes too). ?noinert turns it off; setInert(false) from a test.
const INERT_MIN = 8;
let inert = [], inertOn = typeof location === 'undefined' || !/[?&]noinert/.test(location.search);
export function setInert(on) { inertOn = !!on; }
function caster(o) {
  if (!o.castShadow) return;
  const cur = o.customDepthMaterial;
  if (cur !== undefined && !OURS.has(cur)) return; // the object's own
  if ((Array.isArray(o.material) ? o.material : [o.material]).some(ownDepth)) { if (cur) o.customDepthMaterial = undefined; return; }
  const g = o.geometry, ma = g && (g.morphAttributes.position || g.morphAttributes.normal || g.morphAttributes.color);
  const key = (o.isInstancedMesh ? 'i' + (o.instanceColor ? 'c' : '') + (o.morphTexture ? 'm' : '') : '') + (o.isSkinnedMesh ? 's' : '') + (o.isBatchedMesh ? 'b' + (o.colorTexture ? 'c' : '') : '') + (ma ? 'm' + ma.length + (g.morphAttributes.normal ? 'n' : '') : '');
  // (plain casters keep three's own shared one: then only they use it)
  if (!key) { if (cur) o.customDepthMaterial = undefined; return; }
  let d = DEPTH.get(key);
  if (!d) { d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); d.name = 'depth_' + key; OURS.add(d); DEPTH.set(key, d); }
  if (cur !== d) o.customDepthMaterial = d;
}
// the node count of o's subtree when nothing in it is drawn or lights the scene, else -1 (and its inert children of
// some size go on the list); casters and stand-ins taken in on the way
function walk(o, so, out) {
  if (o.visible === false) return -1;
  let live = !!(o.isMesh || o.isLine || o.isPoints || o.isSprite || o.isLight || o.isCamera || o.isLOD);
  if (o.isMesh) { if (o.userData.shadowOnly) so.push(o); caster(o); }
  let n = 1, kids = null;
  const ch = o.children;
  for (let i = 0; i < ch.length; i++) { const k = walk(ch[i], so, out); if (k < 0) live = true; else { n += k; (kids || (kids = [])).push(ch[i], k); } }
  if (!live) return n;
  if (kids) for (let i = 0; i < kids.length; i += 2) if (kids[i + 1] >= INERT_MIN) out.push(kids[i]);
  return -1;
}
// a walk over what is drawn (main.js: every 30 frames), so new objects are taken in within half a second
export function tidyCasters(root) {
  const so = [], out = [];
  walk(root, so, out);
  shadowOnly = so; inert = out;
}
// around renderer.render: the stand-ins hidden from the main pass, shown for the shadow pass (wrapShadowPass), and
// the inert subtrees hidden from both
export function hideShadowOnly(hide) {
  for (const o of shadowOnly) { if (hide) { o.userData._vis = o.visible; o.visible = false; } else if (o.userData._vis !== undefined) { o.visible = o.userData._vis; o.userData._vis = undefined; } }
  if (hide && !inertOn) return;
  for (const o of inert) { if (hide) { if (o.visible) { o.visible = false; o.userData._ivis = true; } } else if (o.userData._ivis) { o.visible = true; o.userData._ivis = false; } }
}
export function wrapShadowPass(renderer) {
  const SM = renderer.shadowMap;
  if (SM._perfWrapped) return;
  SM._perfWrapped = true;
  const render = SM.render;
  SM.render = function (...a) {
    for (const o of shadowOnly) if (o.userData._vis !== undefined) o.visible = o.userData._vis;
    try { return render.apply(this, a); } finally { for (const o of shadowOnly) if (o.userData._vis !== undefined) o.visible = false; }
  };
}

// 3. Exactly two spot lights drawn, always (PERF_PLAN item 23): the number of lights is part of every lit shader, so
//    a change (a left car's headlight beams and a new car's, four; or none at all once a left car goes and the car
//    driven is a traffic car without beams) built every lit shader in the scene again in the next draw, for seconds.
//    The player's car's beams are the ones drawn; any other car's are hidden; two dark stand-ins fill in for missing
//    ones. beams: cars.js BEAMS (every rig's), mine: the player's car's (rig._beams).
const FILL = [];
const SPOTS = 2;
function drawn(o, scene) { for (let p = o.parent; p; p = p.parent) { if (p === scene) return true; if (!p.visible) return false; } return false; }
export function steadySpots(scene, beams, mine) {
  if (!FILL.length) for (let i = 0; i < SPOTS; i++) { const s = new THREE.SpotLight(0xffffff, 0, 1, 0.3); s.name = 'spot_fill'; s.visible = false; s.castShadow = false; scene.add(s); FILL.push(s); }
  let n = 0;
  if (beams) for (const b of beams) { const on = n < SPOTS && !!mine && mine.includes(b) && drawn(b, scene); if (b.visible !== on) b.visible = on; if (on) n++; }
  for (const f of FILL) { const on = n < SPOTS; if (f.visible !== on) f.visible = on; if (on) n++; }
}

// A deck of fair-weather cumulus 1.5 km up: fbm noise on the deck's world position, thresholded to a coverage,
// lit from the sun's side and darker underneath, thinning towards the horizon so it melts into the haze.
function makeClouds() {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, forceSinglePass: true, // (one draw, not two)
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uCover: { value: 0.47 } },
    vertexShader: /* glsl */`
      varying vec3 vW;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; uniform float uTime, uCover;
      varying vec3 vW;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vW.xz / 2600.0 + vec2(uTime * 0.0035, uTime * 0.0012);
        float d = fbm(p) * 0.75 + fbm(p * 3.1 + 5.0) * 0.25;
        float c = smoothstep(uCover, uCover + 0.17, d);
        if (c < 0.01) discard;
        // light: brighter where the cloud's sunward side is (the density falls towards the sun)
        float ds = fbm(p + uSun.xz * 0.06) * 0.75 + fbm((p + uSun.xz * 0.06) * 3.1 + 5.0) * 0.25;
        float lit = clamp(0.62 + (d - ds) * 3.0, 0.35, 1.0);
        vec3 col = mix(vec3(0.62, 0.66, 0.72), vec3(1.0, 0.99, 0.97), lit);
        // thin out towards the horizon (distance across the deck from under the camera)
        float far = length(vW.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(9000.0, 22000.0, far);
        gl_FragColor = vec4(col, c * 0.92 * fade);
      }`,
  });
  const g = new THREE.PlaneGeometry(50000, 50000, 1, 1);
  g.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = -1; mesh.name = 'clouds';
  return mesh;
}
