// The scene's settings and what they change: the time of day, the sky and the kind of snow.
//   ENV.time  hours, 0 to 24
//   ENV.sky   'clear' | 'cloudy' | 'overcast'
//   ENV.snow  'groomed' | 'powder' | 'packed' | 'spring' | 'ice'
// Kept in localStorage 'ski_env' and applied while you ride, with no reload and no new shader.
// The sky is a dome painted with photographs of real skies (Poly Haven's pure skies, CC0: a day of Qwantani skies from
// dawn to dusk, cumulus, a sunset, an overcast sky and a starry night), the two nearest the time blended. The sun's disc
// was painted out of each photo, and the dome draws its own sun where the light really comes from. The sun and sky
// light, the fog (the colour of the sky's own horizon in each direction), the reflections and the snow follow.
// At night the park's floodlights come on: towers along the fences, pools of light on the snow, and the light that
// follows the rider turns into a floodlight.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { snowUniforms, setFieldSun } from './materials.js?v=24';
import { height, runHalf, getPark } from './terrain.js?v=24';
import { installShadowOnly } from './shadowproxy.js?v=24';
import { bake } from './gear.js?v=24';

const KEY = 'ski_env';
export const ENV = Object.assign({ time: 12.5, sky: 'clear', snow: 'groomed' },
  (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } })());
const saveEnv = () => { try { localStorage.setItem(KEY, JSON.stringify(ENV)); } catch (e) {} };

// ---- the snow kinds ------------------------------------------------------------------------------------------------------
// snowK: multipliers on the riding (1 = groomed): mu sliding friction, drag (air and snow), grip of the edges, sink (how
// deep the skis ride: powder). look: groom (corduroy), lumps (powder's soft relief), wet (spring's darker, glossy, coarse
// grains), ice (blue-grey glaze), rough (roughness), sparkle; track: how tracks are pressed in this snow (trackM: how
// deep a full groove is, metres; depth, width, berm: multipliers on a groove's depth, width and the snow heaped beside
// it; sharp: how crisp a carve's outside wall is; soft: how soft the walls are drawn (m: crumbling powder and slush 2 to
// 4 cm, a hard edge's cut a few mm); polish: how shiny a skid leaves it; scratch: ice, where a track is a white
// scratch, not a dark groove; lump: how lumpy heaped snow is). The look is uniforms only: a change builds no shader.
export const SNOW = {
  groomed: { trackM: 0.07, name: 'Groomed', snowK: { mu: 1, drag: 1, grip: 1, sink: 0 },
    look: { groom: 1, lumps: 0.15, wet: 0, ice: 0, rough: 0.78, sparkle: 1 }, track: { depth: 1, width: 1, berm: 1, sharp: 1, soft: 0.003, polish: 0.6, scratch: 0, lump: 0.5 } },
  powder: { trackM: 0.28, name: 'Powder', snowK: { mu: 1.35, drag: 1.6, grip: 0.7, sink: 0.22 },
    look: { groom: 0, lumps: 1, wet: 0, ice: 0, rough: 0.9, sparkle: 1.25 }, track: { depth: 1, width: 2.1, berm: 1.5, sharp: 0.45, soft: 0.035, polish: 0.1, scratch: 0, lump: 1 } },
  packed: { trackM: 0.04, name: 'Packed', snowK: { mu: 0.85, drag: 1, grip: 1.08, sink: 0 },
    look: { groom: 0.2, lumps: 0.05, wet: 0, ice: 0.15, rough: 0.62, sparkle: 0.7 }, track: { depth: 0.8, width: 0.9, berm: 0.45, sharp: 1.1, soft: 0.002, polish: 0.9, scratch: 0.12, lump: 0.3 } },
  spring: { trackM: 0.1, name: 'Spring slush', snowK: { mu: 1.6, drag: 1.25, grip: 0.92, sink: 0.07 },
    look: { groom: 0.35, lumps: 0.55, wet: 1, ice: 0, rough: 0.5, sparkle: 0.35 }, track: { depth: 1, width: 1.6, berm: 1.3, sharp: 0.55, soft: 0.018, polish: 0.4, scratch: 0, lump: 0.9 } },
  ice: { trackM: 0.012, name: 'Ice', snowK: { mu: 0.55, drag: 1, grip: 0.55, sink: 0 },
    look: { groom: 0.1, lumps: 0, wet: 0, ice: 1, rough: 0.28, sparkle: 0.4 }, track: { depth: 1, width: 0.75, berm: 0.08, sharp: 1.6, soft: 0.0008, polish: 0, scratch: 1, lump: 0.1 } },
};
export const snowKind = () => SNOW[ENV.snow] || SNOW.groomed;

// ---- the skies ---------------------------------------------------------------------------------------------------------
// each photo: its file (sky/<f>_2k.jpg, _1k.jpg) and where its sun (or glow) is (u across the picture); the night sky
// keeps its own moon, turned to stand ahead and to the left of the way down (moonAz)
const PHOTOS = {
  dawn: { f: 'qwantani_dawn', u: 0.596 }, sunrise: { f: 'qwantani_sunrise', u: 0.600 }, morning: { f: 'qwantani_morning', u: 0.600 },
  midmorning: { f: 'qwantani_mid_morning', u: 0.600 }, noon: { f: 'qwantani_noon', u: 0.600 }, afternoon: { f: 'qwantani_afternoon', u: 0.600 },
  late: { f: 'qwantani_late_afternoon', u: 0.600 }, sunset: { f: 'qwantani_sunset', u: 0.600 }, dusk1: { f: 'qwantani_dusk_1', u: 0.595 },
  dusk2: { f: 'qwantani_dusk_2', u: 0.606 }, night: { f: 'kloppenheim_02', u: 0.599, moonAz: 38 },
  cumulus: { f: 'kloofendal_48d_partly_cloudy', u: 0.595 }, cloudset: { f: 'belfast_sunset', u: 0.605 }, grey: { f: 'snow_field', u: 0.620 },
};
// which photo at which hour, for each sky
const SETS = {
  clear: [[5.0, 'night'], [6.0, 'dawn'], [6.7, 'sunrise'], [8.1, 'morning'], [10.1, 'midmorning'], [12.5, 'noon'], [14.9, 'afternoon'], [17.0, 'late'], [18.1, 'sunset'], [18.7, 'dusk1'], [19.3, 'dusk2'], [20.3, 'night']],
  cloudy: [[5.0, 'night'], [6.2, 'dawn'], [6.9, 'sunrise'], [8.6, 'cumulus'], [16.2, 'cumulus'], [17.8, 'cloudset'], [19.0, 'dusk2'], [20.2, 'night']],
  overcast: [[4.0, 'grey'], [21.0, 'grey']],
};
export const SKY_NAMES = { clear: 'Clear blue', cloudy: 'Some clouds', overcast: 'Overcast' };
export const TIMES = [['Dawn', 6.3], ['Morning', 9], ['Noon', 12.5], ['Afternoon', 15.5], ['Sunset', 18], ['Dusk', 18.9], ['Night', 21.5]];

// the sun's path: up at 6:30, down at 18:30, 50 degrees high at 12:30; from behind the start on the left round to the
// left of the way down (so a sunset is in front of you as you ride)
export function sunAt(t, out = new THREE.Vector3()) {
  const el = 50 * Math.sin(Math.PI * (t - 6.5) / 12), az = THREE.MathUtils.degToRad(165 - (t - 6.5) / 12 * 145);
  out.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - el), az);
  return { el, dir: out };
}
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function table(T, x) {
  if (x <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (x <= T[i][0]) { const t = (x - T[i - 1][0]) / (T[i][0] - T[i - 1][0]); const a = T[i - 1][1], b = T[i][1]; return Array.isArray(a) ? a.map((v, k) => lerp(v, b[k], t)) : lerp(a, b, t); }
  return T[T.length - 1][1];
}
// how bright the sky photos are drawn, by the sun's height (every photo was stored at the same brightness)
const DOME_B = [[-18, 0.022], [-12, 0.05], [-7, 0.14], [-2, 0.5], [4, 0.85], [12, 1]];
const SUN_I = [[-1.5, 0], [3, 0.9], [10, 2.3], [25, 2.9], [45, 3.15]];
const SUN_C = [[-1.5, [1, 0.42, 0.22]], [4, [1, 0.62, 0.4]], [12, [1, 0.84, 0.66]], [25, [1, 0.94, 0.85]], [45, [1, 0.965, 0.91]]];
const HEMI_I = [[-16, 0.16], [-6, 0.35], [0, 0.7], [10, 1.0], [30, 1.05]];
// the lights' and sky's changes for each sky kind
const KIND = {
  clear: { sun: 1, hemi: 1, shadow: 1, fog: 1, dome: 1 },
  cloudy: { sun: 0.92, hemi: 1.08, shadow: 0.9, fog: 1.15, dome: 1 },
  overcast: { sun: 0.16, hemi: 1.75, shadow: 0.3, fog: 2.4, dome: 1.45 },
};

const DOME_VS = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}`;
const DOME_FS = `
uniform sampler2D uA; uniform sampler2D uB; uniform float uMix; uniform float uRotA; uniform float uRotB;
uniform vec3 uTint; uniform float uSat; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunVis;
uniform sampler2D uHz; uniform vec3 uZen;
varying vec3 vDir;
vec3 dec(vec3 s) { s = min(s, vec3(0.93)); return s / (1.0 - s); }    // the photos were stored as x / (1 + x) (capped: past 0.93 one step of 8 bits is a big jump)
void main() {
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, -1.0, 1.0)) * 57.29578;
  // (under the horizon only the horizon's own colour: the far snow fades into it in the fog)
  float v = clamp((max(el, 0.4) + 6.0) / 96.0, 0.004, 0.996);
  float az = atan(d.z, d.x) * 0.1591549 + 0.5;
  vec3 c = mix(dec(texture2D(uA, vec2(az + uRotA, v)).rgb), dec(texture2D(uB, vec2(az + uRotB, v)).rgb), uMix) * uTint;
  c = max(vec3(0.0), mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uSat));    // a touch more colour: the tone curve greys a sky
  c *= mix(vec3(1.0), uZen, smoothstep(8.0, 70.0, el));    // (2026-11-11: high up the sky overhead is a deeper blue, Freeride's)
  float cs = dot(d, uSunDir), above = smoothstep(-0.02, 0.01, d.y);
  // the sun: a disc, its bright rim of glare and a soft halo
  c += uSunCol * uSunVis * above * (smoothstep(0.99996, 0.99999, cs) * 60.0 + pow(max(cs, 0.0), 2200.0) * 6.0 + pow(max(cs, 0.0), 60.0) * 0.35);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  /* (2026-11-08, for "the sky has like a weird glitchy block in it ... for all the skies": the terrain is drawn out to
     2 or 2.6 km, which straight down the run ends a little under the true horizon, and in that gap the dome showed its
     part under the horizon: one row of the photo stretched down, every column of pixels its own colour, a block of
     grey-blue stripes, darker or lighter than the far snow and fog round it. Now under the horizon, and over its first
     few degrees above, the dome is the horizon's own colour round the compass, the same colour (already on the
     screen's scale) the far snow and the fog fade into, so the gap and the far snow are one colour.) */
  gl_FragColor.rgb = mix(gl_FragColor.rgb, texture2D(uHz, vec2(az, 0.5)).rgb, 1.0 - smoothstep(-0.5, 3.0, el));
}`;

const sRGBtoLin = s => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
const decode = s => { s = Math.min(s, 0.93); return s / (1 - s); };
const NH = 128;     // the horizon's colours round the compass

export class Env {
  constructor(scene, renderer, q, wide) {
    this.scene = scene; this.r = renderer; this.q = q; this.wide = wide;
    this.res = q.tier === 'low' ? '1k' : '2k';
    this.alpine = !!(getPark() && getPark().freeride);      // (2026-11-11: Freeride's light, apply)
    this.tex = new Map();          // photo key -> { tex, hz: Float32Array(NH*3) in photo u, ready }
    this.skier = null;
    // the dome
    const blank = new THREE.DataTexture(new Uint8Array([150, 175, 210, 255]), 1, 1); blank.colorSpace = THREE.SRGBColorSpace; blank.needsUpdate = true;
    this.blank = blank;
    this.u = {
      uA: { value: blank }, uB: { value: blank }, uMix: { value: 0 }, uRotA: { value: 0 }, uRotB: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uSunVis: { value: 1 },
      uSat: { value: 1.4 }, uHz: { value: blank },
      // (2026-11-11) the sky overhead a deeper blue on a high mountain (Freeride: thinner, cleaner air), 1 elsewhere
      uZen: { value: getPark() && getPark().freeride ? new THREE.Vector3(0.8, 0.88, 1.0) : new THREE.Vector3(1, 1, 1) },
    };
    this.domeMat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide, depthWrite: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), this.domeMat);
    this.dome.name = 'sky'; this.dome.frustumCulled = false; this.dome.renderOrder = 1e6;   // drawn last of the opaque things, so the depth test skips what is covered
    scene.add(this.dome);
    // the sun (by night, the floodlight over the rider): a shadow box that follows the rider
    this.sunDir = new THREE.Vector3();
    const sun = this.sun = new THREE.DirectionalLight(0xfff1df, 3.1);
    const shadowRes = q.tier === 'low' ? 1024 : 2048, box = q.tier === 'low' ? 26 : 34;
    sun.castShadow = q.shadows;
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    Object.assign(sun.shadow.camera, { left: -box, right: box, top: box, bottom: -box, near: 1, far: 300 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    // (layer 5: things drawn only into the shadow map, cut into pieces so only those near the rider are: the lift's
    // stations and towers, the park's fences, the trees near the rider; lift.js, world.js. three r180 tests the view
    // camera's layers in the shadow pass, not this camera's, so they are moved to layer 0 and kept out of the view's own
    // draws by shadowproxy.js, at the first shadow map: 2026-11-09)
    sun.shadow.camera.layers.enable(5);
    scene.add(sun, sun.target);
    installShadowOnly(scene, sun);       // (stand-ins drawn into the shadow map only: shadowproxy.js)
    // sky light from above, the snow's bounce from below
    this.hemi = new THREE.HemisphereLight(0xa9c8ef, 0xf2f4f6, 1.05);
    scene.add(this.hemi);
    // fog: the colour of the sky's horizon (the snow reads it by direction from uHorizon; everything else takes the mean)
    // (three lays fog on after the tone curve and the screen's colour encoding, so these are the horizon's colours as
    // shown on the screen: the dome's colour put through the same tone curve and encoding in acesSRGB)
    this.hzTex = new THREE.DataTexture(new Uint8Array(NH * 4), NH, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.hzTex.wrapS = THREE.RepeatWrapping; this.hzTex.magFilter = this.hzTex.minFilter = THREE.LinearFilter; this.hzTex.needsUpdate = true;
    snowUniforms.uHorizon.value = this.hzTex; this.u.uHz.value = this.hzTex;    // (and the dome under the horizon)
    scene.fog = new THREE.FogExp2(0xc6d7e8, 0.0003);
    this.fogBase = wide ? (q.tier === 'low' ? 0.00016 : 0.00011) : q.tier === 'low' ? 0.00042 : 0.00028;
    // the snow fades into the horizon's colour by the distance the terrain stops being drawn (main.js: Terrain far)
    if (wide) snowUniforms.uFarFade.value.set(1e6, 2e6);     // (the real mountain keeps its far snow)
    else snowUniforms.uFarFade.value.set(q.tier === 'low' ? 1300 : 1850, q.tier === 'low' ? 2000 : 2600);
    // reflections: the dome and a snow floor, made into a reflection map whenever the sky changes
    this.pm = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    const d2 = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.domeMat); d2.frustumCulled = false; this.envScene.add(d2);
    this.floorMat = new THREE.MeshBasicMaterial({ color: 0xdfe6ee });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 24), this.floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = -8; this.envScene.add(floor);
    this.envRT = null; this.envDirty = true; this.envAt = 0;
    // the park's floodlights
    this.lights = makeLightTowers(scene, q);
    this.night = 0;
    this.apply();
    /* (2026-11-12, for "improving loading time": the reflection map is made at the first frame, not here. Made here it
       was made from the sky's blank stand-in (its photos still coming) and made again at the first frame from the
       photos, about 0.2 s of the start on a slow processor for one never seen. Meanwhile scene.environment is an empty
       target of the very same kind and size, so every shader is built at the start just as it will be drawn.) */
    {
      const cs = 2 ** Math.floor(Math.log2(q.tier === 'low' ? 128 : 256));
      const rt = new THREE.WebGLRenderTarget(3 * Math.max(cs, 16 * 7), 4 * cs, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false, type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false });
      rt.texture.mapping = THREE.CubeUVReflectionMapping; rt.texture.name = 'PMREM.cubeUv';
      this.envRT = rt; this.scene.environment = rt.texture; this.envDirty = true; this.envAt = 0;
    }
    window.__skiEnv = this;          // (for tests: __skiEnv.set('time', 18))
  }
  // the photo for a key, loading it the first time (the dome keeps the last ones meanwhile)
  photo(key) {
    let e = this.tex.get(key);
    if (e) return e;
    e = { tex: null, hz: null, ready: false };
    this.tex.set(key, e);
    // (?r=2: the photos with their old suns' patches painted out smoothly, 2026-11-08; a browser may keep the old ones)
    const url = `./sky/${PHOTOS[key].f}_${this.res}.jpg?r=2`;
    new THREE.ImageLoader().load(url, img => {
      const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
      this.r.initTexture(t);                         // sent to the graphics card now, not in a frame's draw
      // the horizon's colour round the compass, from the rows 0 to 3 degrees up
      const c = document.createElement('canvas'), W = 256, H = 64; c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H);
      const y0 = Math.round((1 - 9 / 96) * H), y1 = Math.round((1 - 6 / 96) * H);
      const px = x.getImageData(0, y0, W, Math.max(1, y1 - y0)).data, rows = Math.max(1, y1 - y0);
      const hz = new Float32Array(W * 3);
      for (let i = 0; i < W; i++) for (let k = 0; k < 3; k++) { let s = 0; for (let r = 0; r < rows; r++) s += decode(sRGBtoLin(px[(r * W + i) * 4 + k] / 255)); hz[i * 3 + k] = s / rows; }
      e.tex = t; e.hz = hz; e.ready = true;
      this.apply(); this.envDirty = true;
    }, undefined, () => { e.ready = false; });
    return e;
  }
  attach(skier) { this.skier = skier; this.applySnow(); }
  set(k, v) { ENV[k] = v; saveEnv(); if (k === 'snow') this.applySnow(); this.apply(); this.envDirty = true; }
  applySnow() {
    const s = snowKind(), L = s.look;
    if (this.skier) this.skier.snowK = Object.assign({}, s.snowK);
    snowUniforms.uSnowLook.value.set(L.groom, L.lumps, L.wet, L.ice);
    snowUniforms.uSnowRough.value = L.rough;
    snowUniforms.uSparkle.value = L.sparkle;
    snowUniforms.uTrackDepth.value = s.trackM;
    const T = s.track; snowUniforms.uTrackLook.value.set(T.soft, T.polish, T.scratch, T.lump);
  }
  // everything that follows from the settings (cheap: about 0.15 ms; the reflection map is made again in follow())
  apply() {
    const t = ((ENV.time % 24) + 24) % 24, set = SETS[ENV.sky] || SETS.clear, kind = KIND[ENV.sky] || KIND.clear;
    const { el, dir } = sunAt(t, this.sunDir);
    setFieldSun(dir);          // (the mountain's own shadows for this sun, Freeride's: materials.js, frfield.js)
    // the two photos round the time (wrapping round midnight)
    let i = set.findIndex(s => s[0] > t), a, b, f;
    if (i <= 0) { a = set[set.length - 1]; b = set[0]; const span = b[0] + 24 - a[0], dt = (t < b[0] ? t + 24 : t) - a[0]; f = dt / span; }
    else { a = set[i - 1]; b = set[i]; f = (t - a[0]) / (b[0] - a[0]); }
    f = ss(0, 1, f);
    const A = this.photo(a[1]), B = this.photo(b[1]);
    // until a photo has come, the other one (or the last shown) stands in for it
    const tA = A.ready ? A : B.ready ? B : null, tB = B.ready ? B : tA;
    if (tA) { this.u.uA.value = tA.tex; this.u.uB.value = tB.tex; this.u.uMix.value = A.ready && B.ready ? f : 0; }
    // turn each photo so its sun sits where ours is
    const uSun = Math.atan2(dir.z, dir.x) / (2 * Math.PI) + 0.5;
    const keyA = tA === B ? b[1] : a[1], keyB = tB === A ? a[1] : b[1];
    const rotOf = k => { const P = PHOTOS[k]; if (P.moonAz == null) return P.u - uSun; const r = THREE.MathUtils.degToRad(P.moonAz); return P.u - (Math.atan2(Math.cos(r), Math.sin(r)) / (2 * Math.PI) + 0.5); };
    const rotA = rotOf(keyA), rotB = rotOf(keyB);
    this.u.uRotA.value = rotA; this.u.uRotB.value = rotB;
    // brightness
    const domeB = table(DOME_B, el) * kind.dome;
    const night = this.night = 1 - ss(-9, -1.5, el);
    // the park's lamps: on from a little before sunset (earlier under a grey sky), full on by dusk (makeLightTowers)
    const lampOn = this.lampOn = Math.max(night, 1 - ss(-3, ENV.sky === 'overcast' ? 10 : 3, el));
    this.u.uTint.value.setScalar(domeB * (ENV.sky === 'overcast' ? 1 : lerp(0.78, 1, night)));
    if (night > 0) this.u.uTint.value.multiply(new THREE.Vector3(lerp(1, 0.75, night), lerp(1, 0.85, night), 1));
    // the sun's disc (hidden by overcast; the night sky's photo keeps its own moon)
    const sc = table(SUN_C, el);
    this.u.uSunDir.value.copy(dir);
    this.u.uSunCol.value.setRGB(sc[0], sc[1], sc[2]);
    this.u.uSunVis.value = (ENV.sky === 'overcast' ? 0 : 1) * ss(-3, 0.5, el);
    // lights: by day the sun; by night the floodlight over the rider, warm white and high
    const sunI = table(SUN_I, el) * kind.sun;
    const flood = night * 1.15;
    this.flood = flood > sunI ? flood : 0;
    if (flood > sunI) {
      // (the light's way and strength are the nearest lamps', worked out in follow() as the rider moves)
      this.lightDir = FLOOD_DIR; this.sun.color.setRGB(1, 0.92, 0.8); this.sun.intensity = flood;
      this.sun.shadow.intensity = 0.85;
    } else {
      this.lightDir = dir; this.sun.color.setRGB(sc[0], sc[1], sc[2]); this.sun.intensity = sunI;
      this.sun.shadow.intensity = kind.shadow;
    }
    snowUniforms.uSunDir.value.copy(this.lightDir);
    // the sky light: the photos' zenith colour (blue by day, grey under cloud, dark blue at night)
    /* (2026-11-11) high on a big mountain under a clear sky (Freeride) the shade is darker and bluer against the sunlit
       snow, as in photographs of real faces: less of the sky's light (and of its reflection, below) and a bluer sky.
       Not under a grey sky, where the sky's light is all there is, nor by night */
    const alp = this.alpine && ENV.sky !== 'overcast' ? (1 - night) * (ENV.sky === 'cloudy' ? 0.6 : 1) : 0;
    const hemiI = table(HEMI_I, el) * kind.hemi * (1 - 0.38 * alp);
    const zen = ENV.sky === 'overcast' ? [0.82, 0.86, 0.92] : el > -2 ? [0.62 - 0.1 * alp, 0.76 - 0.05 * alp, 0.98] : [0.42, 0.5, 0.75];
    this.hemi.color.setRGB(zen[0], zen[1], zen[2]); this.hemi.intensity = hemiI;
    this.hemiWarm = (1 - ss(4, 18, Math.abs(el))) * (ENV.sky === 'overcast' ? 0.2 : 0.55);
    this.hemi.groundColor.setRGB(0.95, 0.96, 0.97).multiplyScalar(lerp(0.35, 1, ss(-6, 10, el)));
    // the camera's exposure: a little more by night, as eyes get used to the dark
    const expo = this.r.toneMappingExposure = lerp(0.92, 1.35, night);
    // the horizon round the compass (for the fog), from the two photos at their turns, plus the sun's halo, as the dome
    // draws it and then as the screen shows it
    const hA = tA && tA.hz, hB = tB && tB.hz, mix = this.u.uMix.value, tint = this.u.uTint.value, sat = this.u.uSat.value, d8 = this.hzTex.image.data;
    let mr = 0, mg = 0, mb = 0;
    for (let k = 0; k < NH; k++) {
      const u = (k + 0.5) / NH, ang = (u - 0.5) * 2 * Math.PI, dx = Math.cos(ang), dz = Math.sin(ang);
      const cs = Math.max(0, dx * dir.x + dz * dir.z), halo = Math.pow(cs, 60) * 0.35 * this.u.uSunVis.value * 0.74;
      for (let c = 0; c < 3; c++) {
        const va = hA ? sampleRow(hA, u + rotA, c) : 0.9, vb = hB ? sampleRow(hB, u + rotB, c) : va;
        _v[c] = lerp(va, vb, mix) * tint.getComponent(c);
      }
      const l = _v[0] * 0.2126 + _v[1] * 0.7152 + _v[2] * 0.0722;
      for (let c = 0; c < 3; c++) _v[c] = Math.max(0, l + (_v[c] - l) * sat) + sc[c] * halo;
      acesSRGB(_v, expo);
      for (let c = 0; c < 3; c++) d8[k * 4 + c] = Math.round(_v[c] * 255);
      d8[k * 4 + 3] = 255;
      mr += _v[3]; mg += _v[4]; mb += _v[5];
    }
    this.hzTex.needsUpdate = true;
    this.scene.fog.color.setRGB(mr / NH, mg / NH, mb / NH);
    // round sunrise and sunset the sky light takes some of the horizon's warmth
    if (this.hemiWarm > 0) { const m = Math.max(mr, mg, mb) / NH || 1; this.hemi.color.lerp(_c.setRGB(mr / NH / m, mg / NH / m, mb / NH / m), this.hemiWarm); }
    this.scene.fog.density = this.fogBase * kind.fog * lerp(1, 0.8, night);
    this.floorMat.color.setRGB(0.9, 0.93, 0.96).multiplyScalar(Math.min(1.2, sunI * 0.22 + hemiI * 0.45));
    this.scene.environmentIntensity = 0.55 * lerp(0.25, 1, ss(-8, 8, el)) * (1 - 0.35 * alp);
    // how bright lit snow is on the screen, for the spray (drawn unlit): the sun and sky on it by day, the floodlights by night
    { const L = lerp(0.95 * (sunI * Math.max(0.15, dir.y) * 0.3 + hemiI * 0.7), 0.3, night); _v[0] = L * 0.97; _v[1] = L * 0.99; _v[2] = L; acesSRGB(_v, expo); snowUniforms.uSnowLit.value.set(_v[0], _v[1], _v[2]); }
    // the park's lights
    snowUniforms.uNight.value = night;
    snowUniforms.uLamps.value = lampOn;
    if (this.lights && this.lights.lamps) this.lights.lamps.material.emissiveIntensity = lampOn * 3.5;
    this.envDirty = true;
  }
  makeEnvMap() {
    const old = this.envRT;
    this.envRT = this.pm.fromScene(this.envScene, 0.02, 1, 2000, { size: this.q.tier === 'low' ? 128 : 256 });
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
    this.envDirty = false; this.envAt = performance.now();
  }
  follow(p) {
    const s = this.sun;
    // by night the light on the rider (and the rails, the trees) comes from the nearest lamps: their way, and as strong
    // as their pools are where the rider is (the snow material's own sum, for a flat patch of snow)
    if (this.flood && this.lights && this.lights.rows.length) {
      _ld.set(0, 0, 0); let pool = 0;
      for (const R of this.lights.rows) {
        const d2 = R.dx * R.dx + R.dz * R.dz, fz = d2 > 1e-6 ? ((p.x - R.x0) * R.dx + (p.z - R.z0) * R.dz) / d2 : 0, k = Math.floor(fz);
        for (let j = 0; j <= 1; j++) {
          const kz = k + j; if (kz < 0 || kz > R.n - 1) continue;
          const dx = p.x - (R.x0 + R.dx * kz), dz = p.z - (R.z0 + R.dz * kz), r2 = dx * dx + R.h * R.h + dz * dz, r = Math.sqrt(r2);
          const aim = 0.25 + 0.75 * ss(-6, 18, dx * R.ax + dz * R.az);
          const w = R.power * aim * (R.h / r) / r2 * (1 - ss(0.5, 1, Math.abs(fz - kz)));
          _ld.x -= dx / r * w; _ld.y += R.h / r * w; _ld.z -= dz / r * w; pool += w;
        }
      }
      if (pool > 1e-4) {
        _ld.normalize(); if (_ld.y < 0.25) { _ld.y = 0.25; _ld.normalize(); }
        (this.lampDir || (this.lampDir = new THREE.Vector3())).copy(_ld);
        this.lightDir = this.lampDir; snowUniforms.uSunDir.value.copy(_ld);
        s.intensity = this.flood * Math.min(1.5, Math.max(0.3, pool * 1.1));
      }
    }
    s.position.copy(p).addScaledVector(this.lightDir || this.sunDir, 120); s.updateMatrixWorld();
    s.target.position.copy(p); s.target.updateMatrixWorld();
    this.dome.position.copy(p); this.dome.updateMatrixWorld();
    // the reflection map: made again after a change, at most four times a second while the slider moves
    if (this.envDirty && performance.now() - this.envAt > 250) this.makeEnvMap();
  }
}
const _c = new THREE.Color(), _v = new Float32Array(6), _ld = new THREE.Vector3();
// three's ACES filmic tone curve (the same numbers as its shader) and the sRGB encoding: v[0..2] in, the encoded colour
// out in v[0..2] and the tone-mapped linear colour in v[3..5]
function acesSRGB(v, expo) {
  const k = expo / 0.6, r = v[0] * k, g = v[1] * k, b = v[2] * k;
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b, ig = 0.076 * r + 0.90834 * g + 0.01566 * b, ib = 0.0284 * r + 0.13383 * g + 0.83777 * b;
  const fit = x => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
  const fr = fit(ir), fg = fit(ig), fb = fit(ib);
  const o = [1.60475 * fr - 0.53108 * fg - 0.07367 * fb, -0.10208 * fr + 1.10813 * fg - 0.00605 * fb, -0.00327 * fr - 0.07276 * fg + 1.07602 * fb];
  for (let c = 0; c < 3; c++) { const x = Math.min(1, Math.max(0, o[c])); v[3 + c] = x; v[c] = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; }
}
const FLOOD_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 58), THREE.MathUtils.degToRad(70));
function sampleRow(hz, u, c) {
  const W = hz.length / 3, f = (((u % 1) + 1) % 1) * W - 0.5, i0 = Math.floor(f), t = f - i0;
  const a = hz[(((i0 % W) + W) % W) * 3 + c], b = hz[((((i0 + 1) % W) + W) % W) * 3 + c];
  return a + (b - a) * t;
}

// ---- floodlight towers ---------------------------------------------------------------------------------------------------
/* (2026-11-06, Leon: "add lights so that in night time mode or others the lights turn on and they actually work".)
   The park's lamps come in rows: a row is lamps evenly spaced along a line, each aimed one way across it,
     { x0, z0, dx, dz, n, ax, az, h, power }
   x0, z0 the first lamp, dx, dz the step to the next, n how many, ax, az the way they point (flat, a unit vector), h the
   lamp's height over the snow, power how bright its pool is. Rows of towers come from the map (park.lightTowers; a map
   without them gets two rows along its fences, or the run's sides, every 45 m); lamps on buildings, the lift's stations
   (park.stationLamps, lift.js planLift), have no tower drawn. Up to six rows go to the snow material (snowUniforms
   uLRowA/B/C), which lights each pixel from the two nearest lamps of each row: so however many lamps a row has, it
   costs the same, and nothing is sent per lamp. As it gets dark (from a little before sunset, earlier under cloud) the
   lamps come on (uLamps): their heads glow (one draw of points, Glow below), their pools light the snow and the
   features, and the light that lights the rider, the rails and the trees by night comes from the nearest lamps
   (Env.follow), so the rider's shadow turns as they pass a tower. Nothing is built when they come on or go off: the
   shaders have it all already and only uniforms change. */
const ROWS_MAX = 6;
function lampRows() {
  const park = getPark(), towers = [];
  if (park && park.lightTowers && park.lightTowers.length) for (const r of park.lightTowers) towers.push(Object.assign({ h: 11, power: 150 }, r, { tower: true }));
  else {
    const f = park && park.fences && park.fences.length >= 2 ? park.fences : null;
    let xa, xb, z0, z1;
    if (f) { xa = Math.min(f[0][0], f[1][0]) - 2.5; xb = Math.max(f[0][0], f[1][0]) + 2.5; z0 = Math.min(f[0][1], f[1][1]) + 10; z1 = Math.max(f[0][3], f[1][3]); }
    else { xa = -runHalf(200) + 2; xb = runHalf(200) - 2; z0 = 0; z1 = 1400; }
    const S = 45, n = Math.max(1, Math.floor((z1 - z0) / S) + 1);
    towers.push({ x0: xa, z0, dx: 0, dz: S, n, ax: 1, az: 0, h: 11, power: 150, tower: true }, { x0: xb, z0, dx: 0, dz: S, n, ax: -1, az: 0, h: 11, power: 150, tower: true });
  }
  const extra = (park && park.stationLamps || []).map(r => Object.assign({ h: 4.5, power: 40, dx: 0, dz: 0, n: 1 }, r, { tower: false }));
  return towers.concat(extra).slice(0, ROWS_MAX);
}
// every lamp of a row: its place on the snow
function* lampsOf(R) { for (let k = 0; k < R.n; k++) yield [R.x0 + R.dx * k, R.z0 + R.dz * k]; }

// the lamps' glow: a soft bright core and a wide faint halo round each head, added to what is behind, the size of a
// few metres at the lamp (never under a few pixels, so a far row of lamps still shows), fading into the fog
const GLOW_VS = `
uniform float uLamps; uniform float uScale;
varying float vK;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float d = -mv.z;
  vK = uLamps * (1.0 - smoothstep(1400.0, 2400.0, d));
  if (vK < 0.01 || d < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_PointSize = clamp(5.0 * uScale / d, 4.0, 160.0);
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FS = `
varying float vK;
void main() {
  vec2 c = (gl_PointCoord - 0.5) * 2.0; float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 30.0) * 1.6 + exp(-r2 * 6.0) * 0.28 + (1.0 - r2) * 0.04;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.64) * a * vK, 1.0);
}`;
const _db2 = new THREE.Vector2();

function makeLightTowers(scene, q) {
  const rows = lampRows();
  // the rows into the snow material
  const U = snowUniforms;
  U.uLRowN.value = rows.length;
  rows.forEach((R, i) => { U.uLRowA.value[i].set(R.x0, R.z0, R.dx, R.dz); U.uLRowB.value[i].set(R.n, R.ax, R.az, R.h); U.uLRowC.value[i].set(R.power, 0, 0, 0); });
  // every tower's place and turn (its lamp towards the run), and every lamp head's place (for the glow)
  const at = [], heads = [], m = new THREE.Matrix4(), qn = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const headAt = new THREE.Vector3(0, 13.3, 0.6);       // (the stand-in's lamp in the tower's own frame; the model's once it is in)
  for (const R of rows) for (const [x, z] of lampsOf(R)) {
    if (R.tower) at.push(m.clone().compose(new THREE.Vector3(x, height(x, z), z), qn.setFromAxisAngle(up, Math.atan2(R.ax, R.az)).clone(), one));
    else heads.push(x, height(x, z) + R.h, z);
  }
  const towerHeads = () => { const a = []; for (const t of at) { const v = headAt.clone().applyMatrix4(t); a.push(v.x, v.y, v.z); } return a; };
  const glowG = new THREE.BufferGeometry();
  const setHeads = () => { glowG.setAttribute('position', new THREE.Float32BufferAttribute(towerHeads().concat(heads), 3)); glowG.computeBoundingSphere(); };
  setHeads();
  const glowM = new THREE.ShaderMaterial({ uniforms: { uLamps: U.uLamps, uScale: { value: 300 } }, vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Points(glowG, glowM);
  glow.name = 'lamp glow'; glow.frustumCulled = false; glow.renderOrder = 6; glow.matrixAutoUpdate = false;
  // (sized by the picture's height and the lens, as the spray is; drawn by day too, every point dropped at its corner
  // when the lamps are off, so its program is built with the rest at boot, not when the lamps first come on)
  glow.onBeforeRender = (r, sc, cam) => { glowM.uniforms.uScale.value = 0.5 * r.getDrawingBufferSize(_db2).y * cam.projectionMatrix.elements[5]; };
  scene.add(glow);
  if (!at.length) return { pole: null, lamps: null, glow, rows };
  const build = (pole1, lamp1) => [mergeGeometries(at.map(t => bake(pole1.clone(), t))), mergeGeometries(at.map(t => bake(lamp1.clone(), t)))];   // (bake: gear.js, applyMatrix4's sums in one loop)
  // the stand-in: a pole and a lamp box leaning out (+z is towards the run)
  const poleG = new THREE.CylinderGeometry(0.11, 0.16, 13.5, 6); poleG.translate(0, 6.75, 0); poleG.deleteAttribute('uv');
  const headG = new THREE.BoxGeometry(0.5, 0.3, 1.2); headG.rotateX(-0.35); headG.translate(0, 13.4, 0.5); headG.deleteAttribute('uv');
  const [pg, lg] = build(poleG, headG);
  const pole = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.4, roughness: 0.45 }));
  const lamps = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, emissive: 0xfff2d8, emissiveIntensity: 0, roughness: 0.3 }));
  for (const o of [pole, lamps]) { o.matrixAutoUpdate = false; o.castShadow = false; o.name = 'floodlights'; scene.add(o); }   // (thin poles: no shadows, and no shadow shader to build)
  new GLTFLoader().load('./models/env/floodlight.glb', gl => {
    const body = [], lamp = [];
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      (o.material && o.material.name === 'Light' ? lamp : body).push(g.index ? g.toNonIndexed() : g);
    });
    if (!body.length || !lamp.length) return;
    const B = mergeGeometries(body), L = mergeGeometries(lamp);
    // 13.5 m tall, standing on its foot, the lamp's side turned to +z
    B.computeBoundingBox(); const bb = B.boundingBox, k = 13.5 / (bb.max.y - bb.min.y);
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    L.computeBoundingBox(); const lc = L.boundingBox.getCenter(new THREE.Vector3());
    const turn = Math.atan2(lc.x - cx, lc.z - cz);
    const fit = new THREE.Matrix4().makeRotationY(-turn).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-cx, -bb.min.y, -cz));
    B.applyMatrix4(fit); L.applyMatrix4(fit);
    const [pg2, lg2] = build(B, L);
    pole.geometry.dispose(); lamps.geometry.dispose(); pole.geometry = pg2; lamps.geometry = lg2;
    // (the glow on the model's own lamp, just under it)
    L.computeBoundingBox(); L.boundingBox.getCenter(headAt); headAt.y = L.boundingBox.min.y - 0.05; setHeads();
  }, undefined, e => console.warn('floodlight model', e));
  return { pole, lamps, glow, rows };
}

// ---- the settings panel ---------------------------------------------------------------------------------------------------
const hhmm = t => { const h = Math.floor(t) % 24, m = Math.round((t - Math.floor(t)) * 60) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
export function buildPanel(env, box) {
  if (!box) return;
  box.innerHTML = '';
  const lab = (text, el) => { const l = document.createElement('label'); l.append(text, el); return l; };
  // time: a slider and presets
  const tl = document.createElement('label'); tl.style.gridColumn = '1 / -1';
  const tv = document.createElement('span'); tv.className = 'envtime';
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = 0; slider.max = 24; slider.step = 0.05; slider.value = ENV.time;
  const head = document.createElement('span'); head.append('Time of day ', tv); tl.append(head, slider);
  tv.textContent = hhmm(ENV.time);
  slider.oninput = () => { const t = +slider.value; tv.textContent = hhmm(t); ENV.time = t; env.apply(); };
  slider.onchange = () => { env.set('time', +slider.value); mark(); };
  const pre = document.createElement('div'); pre.className = 'envpre'; pre.style.gridColumn = '1 / -1';
  const mark = () => pre.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.t - ENV.time) < 0.01)));
  for (const [n, t] of TIMES) { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.dataset.t = t; b.onclick = () => { slider.value = t; tv.textContent = hhmm(t); env.set('time', t); mark(); }; pre.appendChild(b); }
  mark();
  const sky = document.createElement('select');
  for (const k in SKY_NAMES) sky.add(new Option(SKY_NAMES[k], k));
  sky.value = ENV.sky; sky.onchange = () => env.set('sky', sky.value);
  const snow = document.createElement('select');
  for (const k in SNOW) snow.add(new Option(SNOW[k].name, k));
  snow.value = ENV.snow; snow.onchange = () => env.set('snow', snow.value);
  box.append(tl, pre, lab('Sky', sky), lab('Snow', snow));
}
