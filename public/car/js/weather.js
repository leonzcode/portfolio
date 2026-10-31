// The time of day and the weather (round 6, agent W). The sun and the moon where they really are for the place and
// the hour, a sky of our own on three's Preetham sky (twilight, a dark night with a lit moon and stars, a grey dome
// under cloud), and everything lit by that one state together: the sun or moon light, the sky light, the sky picture
// the paint reflects, the cars' street picture (tinted, see wrapEnv), the photographed ground, hills and roofs
// (baked.js uSkyLight: what kept the hills bright at night before), the fog. At night the windows light up, the street
// lamps light the road under them (a light map the road and ground shaders read, no real lights), the lamp heads glow,
// the headlights come on. Weather: clear, cloudy, overcast, rain (streaks, wet darker roads with puddles), storm
// (rain and lightning) and fog. Kept in localStorage car_weather; a section of the settings panel; O opens it.
// Nothing here builds a shader while the game is drawn: every change is uniforms and light values, the programs are
// built once at the start (or by the compile gate as meshes join the scene).
import * as THREE from 'three';
import { Sky as SkyMesh } from 'three/addons/objects/Sky.js';
import { bakedUniforms, LAMP_GLSL } from './baked.js?v=51';
import { FACADE_NIGHT } from './facade.js?v=51';
import { frame } from './geo.js?v=51';

const KEY = 'car_weather';
const D2R = Math.PI / 180;
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} },
};

// ---- where the sun and the moon are (low precision formulas, good to a fraction of a degree) ----
function jd(ms) { return ms / 86400000 + 2440587.5; }
// local direction from right ascension and declination (radians) at a place and time: elevation, azimuth (degrees,
// clockwise from north)
function altAz(ra, dec, ms, lat, lon) {
  const d = jd(ms) - 2451545.0;
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  const H = (gmst + lon) * D2R - ra, la = lat * D2R;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(la) - Math.cos(dec) * Math.sin(la) * Math.cos(H));
  return { elev: el / D2R, az: ((az / D2R) % 360 + 360) % 360 };
}
const OBL = 23.4397 * D2R;
function sunAt(ms, lat, lon) {
  const d = jd(ms) - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const ra = Math.atan2(Math.cos(OBL) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(OBL) * Math.sin(L));
  return altAz(ra, dec, ms, lat, lon);
}
function moonAt(ms, lat, lon) {
  const d = jd(ms) - 2451545.0;
  const L = (218.316 + 13.176396 * d) * D2R, M = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.229350 * d) * D2R;
  const l = L + 6.289 * D2R * Math.sin(M), b = 5.128 * D2R * Math.sin(F);
  const ra = Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l));
  return altAz(ra, dec, ms, lat, lon);
}
function dirOf(elev, az, out) {
  const e = elev * D2R, a = az * D2R;
  return out.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

// ---- the weathers ----
// block: share of the direct sun the clouds take; amb: the sky light against a clear day's; cover: the cloud deck's
// threshold (sky.js, lower is more cloud); dome: how much of the sky is a grey dome; fog: FogExp2 density; turb: the
// sky's haze; rain: streaks (1 rain, 1.6 storm); wet: the roads' wetness
export const WEATHER = {
  clear: { name: 'Clear', block: 0, amb: 1, cover: 0.47, dome: 0, fog: 0.00009, turb: 3.2, stars: 1 },
  cloudy: { name: 'Cloudy', block: 0.3, amb: 0.95, cover: 0.27, dome: 0.18, fog: 0.00012, turb: 5, stars: 0.5 },
  overcast: { name: 'Overcast', block: 0.9, amb: 0.8, cover: 0.0, dome: 0.88, fog: 0.00022, turb: 10, stars: 0 },
  rain: { name: 'Rain', block: 0.94, amb: 0.6, cover: 0.0, dome: 0.94, fog: 0.00075, turb: 12, stars: 0, rain: 1, wet: 1 },
  snow: { name: 'Snow', block: 0.9, amb: 0.8, cover: 0.0, dome: 0.92, fog: 0.0011, turb: 10, stars: 0, snow: 1, wet: 0.25 },
  storm: { name: 'Storm', block: 0.97, amb: 0.42, cover: 0.0, dome: 0.97, fog: 0.0011, turb: 14, stars: 0, rain: 1.6, wet: 1, flash: true },
  fog: { name: 'Fog', block: 0.8, amb: 0.72, cover: 0.12, dome: 0.75, fog: 0.0062, turb: 12, stars: 0, wet: 0.35 },
};
// the presets: a time picked from the sun itself for the place and the day (dawn, sunset and dusk), or a clock time
export const PRESETS = [['dawn', 'Dawn'], ['morning', 'Morning'], ['noon', 'Noon'], ['afternoon', 'Afternoon'], ['sunset', 'Sunset'], ['dusk', 'Dusk'], ['night', 'Night']];

// brightness of the sky light against a clear noon, by the sun's elevation (degrees): day, golden hour, the bright and
// the deep blue of twilight, then night (the moon and a city's glow on top of that)
function dayLum(e) {
  if (e >= 20) return 1;
  if (e >= 0) return 0.5 + 0.5 * sstep(0, 20, e);
  if (e >= -6) return 0.13 + 0.37 * sstep(-6, 0, e);
  if (e >= -12) return 0.04 + 0.09 * sstep(-12, -6, e);
  // (a city's night: the sky glow and every lamp round about, so unlit streets are dim, not black)
  return 0.032 + 0.008 * sstep(-18, -12, e);
}
// the sun's colour (linear) by its elevation: deep orange on the horizon, white high up
const SUNCOL = [[-1, [1, 0.32, 0.1]], [0, [1, 0.4, 0.15]], [3, [1, 0.55, 0.28]], [8, [1, 0.72, 0.47]], [15, [1, 0.85, 0.68]], [30, [1, 0.95, 0.88]]];
function sunColour(e, out) {
  if (e <= SUNCOL[0][0]) return out.setRGB(...SUNCOL[0][1]);
  for (let i = 1; i < SUNCOL.length; i++) if (e <= SUNCOL[i][0]) {
    const [e0, a] = SUNCOL[i - 1], [e1, b] = SUNCOL[i], t = (e - e0) / (e1 - e0);
    return out.setRGB(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
  }
  return out.setRGB(...SUNCOL[SUNCOL.length - 1][1]);
}

// ---- the sky: three's Preetham sky with twilight, night, moon, stars, a cloud dome, fog and lightning on top ----
const SKY_PARS = /* glsl */`
uniform vec3 uMoonDir, uSunDir, uTwiZen, uTwiHor, uTwiGlow, uNightZen, uNightHor, uDome, uFogSky, uFlashCol;
uniform float uTwi, uNight, uMoonLit, uMoonVis, uStars, uDomeK, uFogK, uFlash, uTime, uEnvPass, uDayK;
float wxH3(vec3 p) { p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
float wxN3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wxH3(i), wxH3(i + vec3(1,0,0)), f.x), mix(wxH3(i + vec3(0,1,0)), wxH3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wxH3(i + vec3(0,0,1)), wxH3(i + vec3(1,0,1)), f.x), mix(wxH3(i + vec3(0,1,1)), wxH3(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;
const SKY_MAIN = /* glsl */`
{
  vec3 wd = normalize( vWorldPosition - cameraPosition );
  float h = max( wd.y, 0.0 );
  // the Preetham sky fades out as the sun goes down: a gradient of our own takes over through twilight
  vec2 sxz = uSunDir.xz; float sl = length( sxz );
  float toward = sl > 1e-4 ? max( dot( normalize( wd.xz + 1e-5 ), sxz / sl ), 0.0 ) : 0.0;
  vec3 tw = mix( uTwiHor, uTwiZen, pow( h, 0.45 ) );
  tw += uTwiGlow * pow( toward, 3.0 ) * exp( -h * 7.0 );
  // the Belt of Venus: a pink band over the dark blue opposite the sun
  float away = sl > 1e-4 ? max( dot( normalize( wd.xz + 1e-5 ), -sxz / sl ), 0.0 ) : 0.0;
  tw += vec3( 0.06, 0.03, 0.045 ) * away * exp( -abs( h - 0.12 ) * 18.0 ) * uTwi;
  retColor = retColor * uDayK + tw * uTwi;
  // night: deep blue overhead, a city's glow along the horizon
  retColor += mix( uNightHor, uNightZen, pow( h, 0.35 ) ) * uNight;
  // stars (cells on the sphere; fewer and fainter towards the horizon's haze)
  if ( uStars > 0.001 && uEnvPass < 0.5 ) {
    vec3 p = wd * 170.0, c = floor( p ), f = fract( p );
    float r = wxH3( c );
    if ( r > 0.93 ) {
      vec3 sp = vec3( wxH3( c + 1.7 ), wxH3( c + 3.1 ), wxH3( c + 5.3 ) ) * 0.7 + 0.15;
      float px = length( fwidth( p ) );
      float d = length( f - sp );
      float s = 1.0 - smoothstep( 0.03, 0.03 + 1.2 * px, d );
      float mag = pow( ( r - 0.93 ) / 0.07, 3.0 );
      float tw2 = 0.75 + 0.25 * sin( uTime * ( 1.5 + 3.0 * wxH3( c + 9.1 ) ) + r * 40.0 );
      retColor += vec3( 0.9, 0.93, 1.0 ) * s * ( 0.08 + 0.9 * mag ) * tw2 * uStars * smoothstep( 0.02, 0.25, h );
    }
  }
  // the moon: a lit sphere (its phase is the sun's light on it), a few darker seas, earthshine, a halo
  {
    vec3 md = normalize( uMoonDir );
    float cd = dot( wd, md );
    const float R = 0.0105;
    if ( cd > 0.99 ) {
      vec3 mx = normalize( cross( vec3( 0.0, 1.0, 0.0 ), md ) ), my = cross( md, mx );
      vec2 q = vec2( dot( wd, mx ), dot( wd, my ) ) / R;
      float r2 = dot( q, q );
      float edge = 1.0 - smoothstep( 0.92, 1.0, r2 );
      if ( r2 < 1.0 ) {
        vec3 n = normalize( q.x * mx + q.y * my - sqrt( 1.0 - r2 ) * md );
        float lit = smoothstep( -0.03, 0.08, dot( n, normalize( uSunDir ) ) );
        float sea = wxN3( vec3( q * 2.3, 1.0 ) ) * 0.6 + wxN3( vec3( q * 5.1, 4.0 ) ) * 0.4;
        float alb = 0.62 + 0.38 * smoothstep( 0.35, 0.65, sea );
        vec3 mc = vec3( 1.0, 0.97, 0.9 ) * alb * ( lit * 1.6 + 0.012 );
        retColor = mix( retColor, max( retColor, mc ), edge * uMoonVis );
      }
      float ang = length( cross( wd, md ) );
      retColor += vec3( 0.55, 0.6, 0.7 ) * exp( -ang * 55.0 ) * 0.05 * uMoonLit * uNight * uMoonVis;
    }
  }
  // cloud: a grey dome, a little brighter towards the horizon
  retColor = mix( retColor, uDome * ( 0.82 + 0.3 * ( 1.0 - h ) ), uDomeK );
  // fog: the horizon goes to the fog's colour
  retColor = mix( retColor, uFogSky, uFogK * ( 1.0 - smoothstep( 0.0, 0.45, h ) ) );
  // under the horizon (seen past the edge of the map): the fog's colour
  if ( wd.y < 0.0 ) retColor = mix( retColor, uFogSky, smoothstep( 0.0, -0.08, wd.y ) );
  // lightning lights the clouds from inside
  retColor += uFlashCol * uFlash * ( 0.35 + 0.65 * h );
}
`;
function skyMaterial() {
  const S = SkyMesh.SkyShader;
  const u = THREE.UniformsUtils.clone(S.uniforms);
  const V = THREE.Vector3;
  Object.assign(u, {
    uMoonDir: { value: new V(0, -1, 0) }, uSunDir: { value: new V(0, 1, 0) },
    uTwiZen: { value: new V() }, uTwiHor: { value: new V() }, uTwiGlow: { value: new V() },
    uNightZen: { value: new V(0.0012, 0.002, 0.0045) }, uNightHor: { value: new V(0.012, 0.0095, 0.008) },
    uDome: { value: new V(0.6, 0.62, 0.65) }, uFogSky: { value: new V(0.7, 0.78, 0.86) }, uFlashCol: { value: new V(0.75, 0.8, 1.0) },
    uTwi: { value: 0 }, uNight: { value: 0 }, uMoonLit: { value: 0 }, uMoonVis: { value: 0 }, uStars: { value: 0 }, uDomeK: { value: 0 },
    uFogK: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uEnvPass: { value: 0 }, uDayK: { value: 1 },
  });
  const fs = S.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\n' + SKY_PARS)
    .replace('gl_FragColor = vec4( retColor, 1.0 );', SKY_MAIN + '\ngl_FragColor = vec4( retColor, 1.0 );');
  if (fs === S.fragmentShader || !fs.includes('uMoonDir')) throw new Error('sky shader patch failed');
  const m = new THREE.ShaderMaterial({ name: 'WeatherSky', uniforms: u, vertexShader: S.vertexShader, fragmentShader: fs, side: THREE.BackSide, depthWrite: false });
  m.fog = false;
  return m;
}

// ---- rain: streaks in a box round the camera, each one's place worked out in its shader ----
const RAIN_MAX = 7000;
function makeRain() {
  const N = RAIN_MAX, pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2 * 3);
  let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    const a = rnd(), b = rnd(), c = rnd();
    for (let k = 0; k < 2; k++) { seed.set([a, b, c], (i * 2 + k) * 3); pos.set([0, k, 0], (i * 2 + k) * 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const m = new THREE.ShaderMaterial({
    name: 'WeatherRain',
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uCol: { value: new THREE.Vector4(0.7, 0.74, 0.8, 0.3) }, uLen: { value: 0.85 }, uWind: { value: new THREE.Vector2(0.08, 0.03) },
      uLampTex: bakedUniforms.uLampTex, uLampBox: bakedUniforms.uLampBox, uLampK: bakedUniforms.uLampK, uLampCol: bakedUniforms.uLampCol },
    vertexShader: /* glsl */`
      attribute vec3 seed; uniform vec3 uCam; uniform float uTime, uLen; uniform vec2 uWind;
      varying float vT; varying float vFar; varying vec3 vLit;
      ${LAMP_GLSL}
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        const float S = 34.0, H = 20.0;
        vec3 p;
        p.x = uCam.x - S * 0.5 + mod( seed.x * S - ( uCam.x - S * 0.5 ), S );
        p.z = uCam.z - S * 0.5 + mod( seed.y * S - ( uCam.z - S * 0.5 ), S );
        p.y = uCam.y + H * 0.5 - mod( seed.z * H + uTime * 9.5, H );
        p += position.y * vec3( uWind.x, 1.0, uWind.y ) * uLen;
        vT = position.y;
        vFar = length( p - uCam );
        // (drops near a street lamp catch its light; a lamp's pool is under it, the drops fall through its cone)
        vLit = lampLight( vec3( p.x, uCam.y - 2.0, p.z ) );
        gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec4 uCol; varying float vT; varying float vFar; varying vec3 vLit;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float a = uCol.a * vT * ( 1.0 - smoothstep( 9.0, 19.0, vFar ) ) * smoothstep( 0.8, 2.5, vFar );
        gl_FragColor = vec4( uCol.rgb + vLit * 0.5, a );
      }`,
    transparent: true, depthWrite: false,
  });
  const L = new THREE.LineSegments(g, m);
  L.frustumCulled = false; L.matrixAutoUpdate = false; L.name = 'rain'; L.renderOrder = 5;
  L.onBeforeRender = (r, sc, cam) => { m.uniforms.uCam.value.copy(cam.position); };
  return L;
}

// ---- snow: soft flakes in a box round the camera, drifting down, worked out in the shader ----
const FLAKES = 5000;
function makeSnow() {
  const pos = new Float32Array(FLAKES * 3);
  let s = 777; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < FLAKES; i++) pos.set([rnd(), rnd(), rnd()], i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const m = new THREE.ShaderMaterial({
    name: 'WeatherSnow',
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uCol: { value: new THREE.Vector3(0.9, 0.92, 0.96) }, uPx: { value: 400 } },
    vertexShader: /* glsl */`
      uniform vec3 uCam; uniform float uTime, uPx; varying float vA;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        const float S = 30.0, H = 18.0;
        vec3 sd = position;
        float t = uTime;
        vec3 p;
        p.x = uCam.x - S * 0.5 + mod( sd.x * S + sin( t * 0.7 + sd.z * 40.0 ) * 0.6 + t * 0.35 - ( uCam.x - S * 0.5 ), S );
        p.z = uCam.z - S * 0.5 + mod( sd.y * S + cos( t * 0.6 + sd.x * 30.0 ) * 0.6 - ( uCam.z - S * 0.5 ), S );
        p.y = uCam.y + H * 0.5 - mod( sd.z * H + t * ( 0.9 + 0.5 * fract( sd.x * 17.0 ) ), H );
        vec4 mv = viewMatrix * vec4( p, 1.0 );
        float d = max( 0.5, -mv.z );
        gl_PointSize = clamp( uPx * 0.035 / d, 1.0, 9.0 );
        vA = ( 1.0 - smoothstep( 9.0, 16.0, d ) ) * smoothstep( 0.4, 1.2, d );
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; varying float vA;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = ( 1.0 - smoothstep( 0.3, 1.0, length( q ) ) ) * vA * 0.85;
        if ( a < 0.01 ) discard;
        gl_FragColor = vec4( uCol, a );
      }`,
    transparent: true, depthWrite: false,
  });
  const P = new THREE.Points(g, m);
  P.frustumCulled = false; P.matrixAutoUpdate = false; P.name = 'snow'; P.renderOrder = 5;
  P.onBeforeRender = (r, sc, cam) => { m.uniforms.uCam.value.copy(cam.position); m.uniforms.uPx.value = r.domElement.height; };
  return P;
}

// ---- the glow of the street lamps' heads at night: camera-facing soft quads, one draw ----
function makeGlows(max, col = [1.0, 0.8, 0.55], name = 'lamp glows') {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const at = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  g.setAttribute('aGlow', at);
  g.instanceCount = 0;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const m = new THREE.ShaderMaterial({
    name: 'WeatherGlows',
    uniforms: { uK: { value: 0 }, uCol: { value: new THREE.Color(col[0], col[1], col[2]) }, uFogD: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec4 aGlow; varying vec2 vQ; varying float vFog;
      uniform float uFogD;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main() {
        vec4 mv = viewMatrix * vec4( aGlow.xyz, 1.0 );
        float d = -mv.z;
        // a little bigger far away so it stays a few pixels across
        float s = aGlow.w * ( 1.0 + d * 0.012 );
        mv.xy += position.xy * s;
        vQ = position.xy;
        vFog = exp( -pow( uFogD * d, 2.0 ) );
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uK; uniform vec3 uCol; varying vec2 vQ; varying float vFog;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      void main() {
        #include <logdepthbuf_fragment>
        float r = length( vQ );
        float a = exp( -r * r * 9.0 ) * 0.9 + exp( -r * 3.2 ) * 0.25;
        a *= 1.0 - smoothstep( 0.8, 1.0, r );
        gl_FragColor = vec4( uCol * a * uK * vFog, 1.0 );
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.name = name; mesh.renderOrder = 4;
  return mesh;
}

// the light the traffic's headlights throw on the road ahead: a soft elongated patch, added on top (one draw)
function beamTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d'), im = g.createImageData(64, 128), d = im.data;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    const u = (x + 0.5) / 64 * 2 - 1, v = (y + 0.5) / 128; // v 0 far end, 1 at the car
    const w = 0.35 + 0.65 * (1 - v);               // wider further out
    const a = Math.max(0, 1 - (u / w) * (u / w)) * Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.15)), 0.8) * (0.35 + 0.65 * v);
    const o = (y * 64 + x) * 4; d[o] = 255; d[o + 1] = 244; d[o + 2] = 222; d[o + 3] = Math.round(255 * Math.min(1, a));
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeBeams(max) {
  const m = new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, toneMapped: false });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), m, max);
  mesh.count = 0; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.name = 'traffic beams'; mesh.renderOrder = 3;
  return mesh;
}

// where a lamp's light falls (local to the part's instance) and how far, and where its head is, by prop part
const LAMPS = { lampCobraLens: { pool: [0, 0, -2.35], r: 10.5, head: [0, 9.2, -2.35] }, lampArm: { pool: [0, -8.2, -2.35], r: 10.5, head: [0, 0.3, -2.35] }, lampPostGlass: { pool: [0, 0, 0], r: 7.5, head: [0, 3.98, 0] } };

const _v = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color(), _m = new THREE.Matrix4();

export class Weather {
  constructor(G) {
    this.G = G; this.R = G.renderer; this.scene = G.scene; this.sky = G.sky; this.cam = G.camera;
    const q = G.quality || window.__carQuality;
    this.low = !!(q && q.low);
    const s = store.get();
    this.weather = WEATHER[s.weather] ? s.weather : 'clear';
    this.hour = Number.isFinite(s.hour) ? s.hour : 14.5;
    this.real = !!s.real;
    this.lat = 37.79; this.lon = -122.4;
    this.flash = 0; this.nextFlash = 4; this.flashT = 0; this.t = 0;
    this.st = {};
    this.sunDir = new THREE.Vector3(0, 1, 0); this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lampsOn = false; this.carLamps = false; this.autoLit = false;
    this.lampTex = null; this.lampFor = null; this.lampCheck = 0;
    this.skyLight = new THREE.Vector3(1, 1, 1);

    // the sky: our material on the sky's own mesh (Sky.setSun still sets its sunPosition)
    this.skyMat = skyMaterial();
    const old = this.sky.mesh.material;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) this.skyMat.uniforms[k].value = old.uniforms[k].value;
    this.sky.mesh.material = this.skyMat;
    // the sky picture the paint, the water and the roads reflect: rendered from the same sky into one cube, made a
    // PMREM into one target that is kept (so scene.environment is always the same texture and no material has to
    // work its program out again), at the size the graphics tier asks for, fixed for the visit
    this.envSize = (q && q.p && q.p.envSize) || 256;
    this.envScene = new THREE.Scene();
    this.envSkyMat = this.skyMat.clone(); this.envSkyMat.uniforms = this.skyMat.uniforms; // (shares the uniforms)
    const envSky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.envSkyMat); envSky.scale.setScalar(900);
    this.envGround = new THREE.MeshBasicMaterial({ color: 0x4a4640, side: THREE.BackSide });
    const ground = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2), this.envGround);
    this.envScene.add(envSky, ground);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(this.envSize, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCam = new THREE.CubeCamera(1, 2000, this.cubeRT);
    this.pm = new THREE.PMREMGenerator(this.R);
    this.envRT = null;
    // (the sky's own makeEnv would make a new texture each time: ours instead)
    this.sky.makeEnv = () => { this.makeEnv(); this.tintEnv(true); };
    // (a lost and restored graphics context empties every render target: the sky picture and the tinted street picture
    // are drawn again)
    try { this.R.domElement.addEventListener('webglcontextrestored', () => setTimeout(() => { try { this.makeEnv(); this.tintEnv(true); } catch (e) {} }, 300)); } catch (e) {}
    this.sky.setSun = () => {}; // (the sun follows the time here)

    // the cloud deck's colours (sky.js makeClouds has the uniforms)
    this.cloudU = this.sky.clouds && this.sky.clouds.material.uniforms;

    // rain and the lamps' glow, made now and built in the background; shown when wanted
    this.rain = makeRain(); this.rain.visible = false;
    this.glowMax = this.low ? 400 : 1500;
    this.glows = makeGlows(1500); this.glows.visible = false;
    // (a change of graphics tier: fewer drops and glows, a coarser light map on 'low', from the next change on)
    try { if (q && q.on) q.on(() => { this.low = !!q.low; this.glowMax = this.low ? 400 : 1500; this.lampFor = null; this.apply(false); }); } catch (e) {}
    // the traffic's lamps after dark: their light on the road ahead, the headlamps' and tail lamps' glow
    this.beams = makeBeams(32); this.beams.visible = false;
    this.heads = makeGlows(64, [1.0, 0.95, 0.85], 'traffic headlamps'); this.heads.visible = false;
    this.tails = makeGlows(64, [1.0, 0.08, 0.04], 'traffic tail lamps'); this.tails.visible = false;
    this.flakes = makeSnow(); this.flakes.visible = false;
    this.scene.add(this.rain, this.glows, this.beams, this.heads, this.tails, this.flakes);
    this.warm();

    this.apply(true);
    this.ui();
    addEventListener('keydown', e => {
      if (e.code !== 'KeyO' || e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const D = this.G.drive; if (!D || !D.active) return;
      const S = this.settings; if (S) S.toggle();
    });
    const loop = () => { requestAnimationFrame(loop); try { this.tick(); } catch (e) { if (!this.tickErr) { this.tickErr = 1; console.warn('weather', e); } } };
    requestAnimationFrame(loop);
  }

  // the rain's and the glows' programs built now (shown or not), so a change of weather builds nothing in a draw
  warm() {
    const R = this.R;
    try {
      for (const o of [this.rain, this.glows, this.beams, this.heads, this.tails, this.flakes]) {
        const v = o.visible; o.visible = true;
        const p = R.compileAsync ? R.compileAsync(o, this.cam, this.scene) : null;
        o.visible = v;
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { console.warn('weather warm', e); }
  }

  // ---- state ----
  save() { store.set({ weather: this.weather, hour: this.hour, real: this.real }); }
  set(o = {}) {
    if (o.weather && WEATHER[o.weather]) this.weather = o.weather;
    if (Number.isFinite(o.hour)) this.hour = ((o.hour % 24) + 24) % 24;
    if (o.preset) { this.real = false; this.hour = this.presetHour(o.preset); }
    if (o.real !== undefined) this.real = !!o.real;
    this.save(); this.apply(true); this.refreshUI();
  }
  // the place's clock offset from UTC in hours (from its longitude: a time zone's middle; good to an hour or so)
  zone() { return Math.round(this.lon / 15); }
  // the moment the sun is worked out for: now (following the real time) or today at the chosen local hour
  moment() {
    if (this.real) return Date.now();
    const now = new Date(), z = this.zone();
    // today's date at the place
    const loc = new Date(now.getTime() + z * 3600000);
    const day = Date.UTC(loc.getUTCFullYear(), loc.getUTCMonth(), loc.getUTCDate());
    return day + (this.hour - z) * 3600000;
  }
  localHour(ms) { const h = ((ms / 3600000 + this.zone()) % 24 + 24) % 24; return h; }
  // a preset's local hour, from the sun for this place and day
  presetHour(k) {
    const z = this.zone(), now = new Date(), loc = new Date(now.getTime() + z * 3600000);
    const day = Date.UTC(loc.getUTCFullYear(), loc.getUTCMonth(), loc.getUTCDate());
    const at = h => sunAt(day + (h - z) * 3600000, this.lat, this.lon).elev;
    // solar noon: the highest sun
    let noon = 12, best = -99;
    for (let h = 9; h <= 15; h += 0.05) { const e = at(h); if (e > best) { best = e; noon = h; } }
    // the time the sun crosses an elevation, rising (before noon) or setting (after)
    const cross = (e0, rising) => {
      let prev = null;
      for (let i = 0; i <= 12 * 20; i++) {
        const h = rising ? noon - 12 + i / 20 : noon + i / 20, e = at(h);
        if (prev !== null && ((rising && prev < e0 && e >= e0) || (!rising && prev > e0 && e <= e0))) return h;
        prev = e;
      }
      return null;
    };
    const wrap = h => ((h % 24) + 24) % 24;
    switch (k) {
      case 'dawn': return wrap(cross(-4, true) ?? noon - 6);
      case 'morning': return wrap(Math.min(noon - 3, (cross(15, true) ?? noon - 4)));
      case 'noon': return wrap(noon);
      case 'afternoon': return wrap(noon + 3.2);
      case 'sunset': return wrap(cross(3, false) ?? noon + 6);
      case 'dusk': return wrap(cross(-5, false) ?? noon + 7);
      case 'night': return wrap(noon + 11);
    }
    return this.hour;
  }

  // ---- everything from the time and the weather ----
  apply(envNow) {
    const W = WEATHER[this.weather];
    // (the place: the drop's origin; a few kilometres either way make no difference to the sun)
    if (Number.isFinite(frame.lat) && Number.isFinite(frame.lon)) { this.lat = frame.lat; this.lon = frame.lon; }
    const ms = this.moment();
    if (this.real) this.hour = this.localHour(ms);
    const sun = sunAt(ms, this.lat, this.lon), moon = moonAt(ms, this.lat, this.lon);
    const e = sun.elev;
    dirOf(sun.elev, sun.az, this.sunDir); dirOf(moon.elev, moon.az, this.moonDir);
    // the moon's lit share (its phase) from the angle between it and the sun
    const elong = Math.acos(Math.max(-1, Math.min(1, this.sunDir.dot(this.moonDir))));
    const illum = (1 - Math.cos(elong)) / 2;
    const moonUp = sstep(-1, 6, moon.elev);
    const amb = W.amb, block = W.block;
    // the sky light against a clear noon, the night's floor raised a little by the moon
    const night = 1 - sstep(-14, -4, e);
    let lum = dayLum(e) + 0.014 * illum * moonUp * night;
    const S = this.st;
    S.elev = e; S.az = sun.az; S.moonElev = moon.elev; S.illum = illum; S.lum = lum;

    // the direct light: the sun, or after dark the moon (dim, blue, only when it is up), less what the clouds take
    const sky = this.sky, L = sky.sun;
    const sunUp = sstep(-1.5, 5, e);
    let dI = 3.0 * sunUp * (0.42 + 0.58 * sstep(2, 30, e)) * (1 - block);
    sunColour(e, _c);
    const moonI = 0.16 * illum * moonUp * night * (1 - block);
    this.lightDir = this.sunDir;
    if (e < 0.5 && moonI > dI) { dI = moonI; _c.setRGB(0.6, 0.7, 1.0); this.lightDir = this.moonDir; }
    if (e < 0.5 && moonI <= dI && dI < 0.01) this.lightDir = this.moonDir.y > 0.05 ? this.moonDir : this.sunDir;
    L.color.copy(_c); L.intensity = dI;
    sky.dir.copy(this.lightDir.y > 0.02 ? this.lightDir : _v.copy(this.lightDir).setY(0.02).normalize());
    this.directI = dI;

    // the sky light (hemisphere): blue by day, deeper blue at twilight, a dark blue night over a city's warm glow;
    // grey under cloud, a little stronger then (the light the clouds take from the sun comes back as sky light)
    const tw = sstep(-10, 2, e) * (1 - sstep(4, 14, e));
    const H = sky.hemi;
    _c.setRGB(0.81, 0.89, 1.0).lerp(_c2.setRGB(0.42, 0.52, 0.95), tw * 0.7).lerp(_c2.setRGB(0.32, 0.4, 0.66), night);
    _c.lerp(_c2.setRGB(0.86, 0.88, 0.92), W.dome * (1 - night * 0.6));
    H.color.copy(_c);
    H.groundColor.setRGB(0.42, 0.38, 0.34).lerp(_c2.setRGB(0.3, 0.26, 0.26), tw * 0.6).lerp(_c2.setRGB(0.55, 0.38, 0.24), night);
    const domeBoost = 1 + 0.45 * W.dome * sunUp + (W.snow ? 0.25 * sunUp : 0);
    const hemiI = 0.9 * lum * amb * domeBoost;
    H.intensity = hemiI;
    this.hemiI = hemiI;

    // what the photographed surfaces (ground, hills, roofs, photogrammetry) are lit by, against a clear noon: the
    // same light as above, summed (noon clear: the sun 3.0 at 60 degrees and the sky 0.9, about 3.4)
    const sinE = Math.max(0, Math.sin(Math.max(e, 0) * D2R)) * 0.85 + 0.15 * sunUp;
    _c.copy(L.color).multiplyScalar(this.lightDir === this.sunDir ? dI * sinE : dI * 0.5);
    _c2.copy(H.color).multiplyScalar(hemiI * 0.92);
    const sl = this.skyLight.set(_c.r + _c2.r, _c.g + _c2.g, _c.b + _c2.b).multiplyScalar(1 / 3.35);
    bakedUniforms.uSkyLight.value.copy(sl);
    // shadows on the photographs: as dark as the direct light's share of all the light
    const share = (_c.r + _c.g + _c.b) / Math.max(1e-4, _c.r + _c.g + _c.b + _c2.r + _c2.g + _c2.b);
    bakedUniforms.uShadowDark.value = lerp(1, 0.45, clamp01(share * 1.25));
    this.baseSkyLight = sl.clone();

    // the reflections: the sky picture (scene.environment, from this very sky) and the cars' street picture
    this.scene.environmentIntensity = 0.85 * (0.7 + 0.3 * amb);
    this.envTint = new THREE.Vector3(sl.x, sl.y, sl.z).multiplyScalar(1 / Math.max(0.05, 1)).max(_v.set(0.012, 0.014, 0.02));

    // how dark it is (0 day, 1 night): the windows light up, the lamps come on
    const dark = clamp01(1 - lum * amb * 1.7);
    this.nightK = dark;
    FACADE_NIGHT.value = dark;
    this.lampK = sstep(0.32, 0.8, dark);
    bakedUniforms.uLampK.value = this.lampK;
    this.carLamps = dark > 0.42;
    this.G.carLamps = this.carLamps;
    bakedUniforms.uWet.value = W.wet || 0;
    bakedUniforms.uSnow.value = W.snow || 0;

    // the sky's shader
    const u = this.skyMat.uniforms;
    u.turbidity.value = W.turb; u.rayleigh.value = 1.4 * (0.4 + 0.6 * sstep(-4, 10, e));
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000);
    u.uSunDir.value.copy(this.sunDir); u.uMoonDir.value.copy(this.moonDir);
    u.uDayK.value = sstep(-3, 1, e);
    u.uTwi.value = sstep(-15, -1, e) * (1 - sstep(-0.5, 6, e));
    u.uTwiZen.value.set(0.03, 0.06, 0.15).lerp(_v.set(0.012, 0.02, 0.06), sstep(-3, -12, e));
    u.uTwiHor.value.set(0.30, 0.24, 0.30).lerp(_v.set(0.03, 0.035, 0.07), sstep(-3, -13, e));
    u.uTwiGlow.value.set(0.9, 0.38, 0.12).multiplyScalar(1 - sstep(-2, -11, e));
    u.uNight.value = night;
    u.uMoonLit.value = illum;
    u.uMoonVis.value = sstep(-1, 3, moon.elev) * (1 - W.dome) * lerp(0.35, 1, 1 - sstep(-4, 8, e));
    u.uStars.value = W.stars * sstep(-8, -14, e) * 0.8;
    // the grey dome's brightness follows the light (dark grey at night, with a city's warm glow from below)
    u.uDomeK.value = W.dome;
    const db = lum * amb * domeBoost;
    u.uDome.value.set(0.62, 0.64, 0.68).multiplyScalar(db * (W.flash ? 0.6 : 1)).add(_v.set(0.013, 0.011, 0.011).multiplyScalar(night));
    // the fog's colour: the horizon's (sRGB), scaled with the light
    const fogB = Math.pow(clamp01(lum * amb * domeBoost), 0.55);
    _c.setRGB(0.74, 0.82, 0.9).lerp(_c2.setRGB(0.66, 0.68, 0.72), W.dome).lerp(_c2.setRGB(0.6, 0.5, 0.52), tw * 0.5 * (1 - W.dome));
    _c.multiplyScalar(fogB).add(_c2.setRGB(0.026, 0.026, 0.031).multiplyScalar(night));
    const fog = this.scene.fog;
    if (fog) { fog.color.setRGB(_c.r, _c.g, _c.b, THREE.SRGBColorSpace); }
    // (the quality tier may ask for a denser fog to hide the far edge: the denser of the two)
    const q = this.G.quality || window.__carQuality;
    this.fogDensity = Math.max(W.fog, (q && q.p && q.p.fog) || 0);
    if (fog) fog.density = this.fogDensity;
    this.fogLinear = fog ? fog.color.clone() : new THREE.Color();
    u.uFogSky.value.set(this.fogLinear.r, this.fogLinear.g, this.fogLinear.b).multiplyScalar(1 / 0.9);
    u.uFogK.value = clamp01(this.fogDensity / 0.006) * 0.9 + (W.rain ? 0.35 : 0);
    // the environment's ground under the horizon follows the light too
    this.envGround.color.setRGB(0.29, 0.27, 0.25).multiplyScalar(Math.max(0.02, lum * amb));

    // the cloud deck: lit side and shade from the light, grey and thick under cloud, gone in fog
    if (this.cloudU && this.cloudU.uLitCol) {
      const cb = Math.pow(clamp01(lum * amb * domeBoost), 0.5);
      sunColour(Math.max(e, -1), _c);
      const warm = sstep(14, 1, e) * sunUp * (1 - W.dome);
      _c2.setRGB(1, 0.99, 0.97).lerp(_c, warm);
      this.cloudU.uLitCol.value.set(_c2.r, _c2.g, _c2.b).multiplyScalar(cb).add(_v.set(0.05, 0.04, 0.035).multiplyScalar(night));
      this.cloudU.uShadeCol.value.set(0.62, 0.66, 0.72).lerp(_v.set(0.5, 0.52, 0.56), W.dome).multiplyScalar(cb * (1 - 0.25 * W.dome)).add(_v.set(0.03, 0.025, 0.022).multiplyScalar(night));
      this.cloudU.uOpacity.value = this.weather === 'fog' ? 0 : 0.92 * (1 - 0.6 * W.dome);
      this.cloudU.uCover.value = W.cover;
      // (under a full grey dome the deck adds nothing but a screen of noise to work out: put away, and back as the
      // graphics tier wants it, quality.js clouds)
      const C = this.sky.clouds, hide = W.dome > 0.85 || this.weather === 'fog';
      if (hide && C.visible) { C.visible = false; this.cloudsHidden = true; }
      else if (!hide && this.cloudsHidden) { this.cloudsHidden = false; const qq = this.G.quality || window.__carQuality; C.visible = !(qq && qq.p && qq.p.clouds === false); }
      if (this.cloudU.uSun) this.cloudU.uSun.value.copy(this.sunDir);
    }

    // rain
    const rn = W.rain || 0;
    this.rainOn = rn > 0;
    if (this.rainOn) {
      const n = Math.round(RAIN_MAX * Math.min(1, rn / 1.6) * (this.low ? 0.25 : 1));
      this.rain.geometry.setDrawRange(0, n * 2);
      const rb = Math.min(1, Math.pow(clamp01(lum * amb * 1.4), 0.5) * 1.05) + 0.05 * this.lampK;
      this.rain.material.uniforms.uCol.value.set(0.78 * rb, 0.82 * rb, 0.88 * rb, rn > 1 ? 0.7 : 0.6);
      this.rain.material.uniforms.uWind.value.set(rn > 1 ? 0.22 : 0.07, rn > 1 ? 0.1 : 0.03);
    }
    this.rain.visible = this.rainOn;
    // snow falling
    this.snowOn = !!W.snow;
    if (this.snowOn) {
      this.flakes.geometry.setDrawRange(0, Math.round(FLAKES * (this.low ? 0.3 : 1)));
      const fb = Math.min(1, Math.pow(clamp01(lum * amb * 1.4), 0.5) * 1.1) + 0.06 * this.lampK;
      this.flakes.material.uniforms.uCol.value.set(0.92 * fb, 0.94 * fb, 0.98 * fb);
    }
    this.flakes.visible = this.snowOn;

    // the lamps' glow
    this.glows.material.uniforms.uK.value = this.lampK;
    this.glows.material.uniforms.uFogD.value = this.fogDensity;
    this.glows.visible = this.lampK > 0.02 && this.glows.geometry.instanceCount > 0;

    // the cars' street picture tinted to the light, and the sky picture made again (not while a slider moves)
    this.tintEnv();
    if (envNow) this.makeEnv(); else this.envDirty = true;
    this.lastApply = performance.now();
  }

  // the scene's environment: the sky as it is now, into the one kept PMREM target
  makeEnv() {
    try {
      const u = this.skyMat.uniforms;
      u.uEnvPass.value = 1;
      this.cubeCam.update(this.R, this.envScene);
      u.uEnvPass.value = 0;
      if (!this.envRT) this.envRT = this.pm.fromCubemap(this.cubeRT.texture);
      else this.pm.fromCubemap(this.cubeRT.texture, this.envRT);
      if (this.scene.environment !== this.envRT.texture) { const old = this.scene.environment; this.scene.environment = this.envRT.texture; if (old && old !== this.envRT.texture && old.dispose && !old.userData.keep) old.dispose(); }
      this.sky.env = this.envRT.texture;
      this.envDirty = false;
    } catch (e) { console.warn('weather env', e); }
  }

  // The cars' (and the walls') street picture (cars.js makeEnvironment: a sunny street HDRI) seen through the light
  // of the moment: a copy of it, tinted, in a target of the same size and layout. drive.js hands the picture here
  // before any car gets it, and everything uses the copy; at night it is dark blue, at sunset warm.
  wrapEnv(tex) {
    try {
      if (!tex || !tex.image || !tex.image.width || tex.userData.weatherTint) return tex;
      const w = tex.image.width, h = tex.image.height;
      const rt = new THREE.WebGLRenderTarget(w, h, { type: tex.type || THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: false });
      const t = rt.texture;
      t.mapping = tex.mapping; t.name = 'car env (weather)';
      t.userData = Object.assign({}, tex.userData, { weatherTint: true, keep: true });
      const mat = new THREE.ShaderMaterial({
        uniforms: { tSrc: { value: tex }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uSize: { value: new THREE.Vector2(w, h) } },
        vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
        fragmentShader: 'uniform sampler2D tSrc; uniform vec3 uTint; uniform vec2 uSize; void main() { gl_FragColor = vec4( texture2D( tSrc, gl_FragCoord.xy / uSize ).rgb * uTint, 1.0 ); }',
        depthTest: false, depthWrite: false, toneMapped: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
      this.envCopy = { rt, mat, scene: new THREE.Scene().add(quad), cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), src: tex };
      this.tintEnv(true);
      return t;
    } catch (e) { console.warn('weather env tint', e); return tex; }
  }
  tintEnv(force) {
    const E = this.envCopy; if (!E || !this.envTint) return;
    const k = this.envTint;
    if (!force && E.last && E.last.distanceToSquared(k) < 1e-7) return;
    E.mat.uniforms.uTint.value.copy(k);
    const R = this.R, prev = R.getRenderTarget(), ac = R.autoClear;
    try { R.setRenderTarget(E.rt); R.autoClear = false; R.render(E.scene, E.cam); }
    finally { R.setRenderTarget(prev); R.autoClear = ac; }
    E.last = (E.last || new THREE.Vector3()).copy(k);
  }

  // ---- the drive's modules, as they load (drive.js loadMods): the roads' materials learn the wet and the lamps ----
  attach(D) {
    this.D = D;
    const RM = D.mods && D.mods.roads;
    if (RM && RM.materials && !this.roadsPatched) {
      const M = RM.materials();
      for (const k of ['asphalt', 'paint', 'pave', 'curb']) if (M[k]) patchRoad(M[k], k === 'asphalt', this.R);
      this.roadsPatched = true;
    }
  }

  // ---- every frame ----
  tick() {
    const now = performance.now(), dt = Math.min(0.1, (now - (this.lastT || now)) / 1000); this.lastT = now;
    this.t += dt;
    const D = this.G.drive;
    this.skyMat.uniforms.uTime.value = this.t;
    if (this.rainOn) this.rain.material.uniforms.uTime.value = this.t;
    if (this.snowOn) this.flakes.material.uniforms.uTime.value = this.t;
    if (this.envDirty && now - this.lastApply > 180) this.makeEnv();
    // following the real time: the sun moves on every half minute (and the place after a drop)
    if ((this.real && now - (this.lastReal || 0) > 30000) || (Number.isFinite(frame.lat) && (Math.abs(frame.lat - this.lat) > 0.02 || Math.abs(frame.lon - this.lon) > 0.02))) {
      this.lastReal = now; this.apply(true);
    }
    // the lamps' light map and glows for the street's props (again when they are built anew)
    if (D && now - this.lampCheck > 1500) { this.lampCheck = now; this.lamps(D); }
    this.lampStep(this.low ? 2 : 3);
    // the headlights come on as it gets dark (once; L still turns them off) and off again in the morning
    if (D && D.active) {
      if (this.carLamps && !this.autoLit) { if (this.headlightsReady(D)) { this.autoLit = true; D.headlights = true; } }
      else if (!this.carLamps && this.autoLit) { this.autoLit = false; D.headlights = false; }
    }
    // the traffic's lamps after dark
    this.carGlow(D);
    // lightning
    const W = WEATHER[this.weather];
    if (W.flash) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.flashT = 0.0001; this.nextFlash = 5 + Math.random() * 11; this.flashSeed = Math.random(); this.thunder(); }
    }
    if (this.flashT > 0) {
      this.flashT += dt;
      const t = this.flashT, s = this.flashSeed;
      // two or three flickers in the first half second
      let f = Math.exp(-t * 9) + (t > 0.12 ? 0.7 * Math.exp(-(t - 0.12) * 11) : 0) + (s > 0.5 && t > 0.3 ? 0.5 * Math.exp(-(t - 0.3) * 8) : 0);
      if (t > 1.2) { f = 0; this.flashT = 0; }
      this.setFlash(f);
    }
  }
  // The car's lit lamps are other materials (cars.js lampMaterial), whose programs would be built in the draw that
  // first shows them (a stall of a second or more): built here in the background first, then the lamps come on.
  headlightsReady(D) {
    const rig = D.car && D.car.rig;
    if (!rig || !rig._setLamps || !rig.state || !this.R.compileAsync) return true;
    if (rig._wxLit === 'ready') return true;
    if (rig._wxLit) return false; // (still being built)
    try {
      const st = rig.state, was = st.headlights;
      st.headlights = true; rig._setLamps(true);
      const pr = this.R.compileAsync(rig.object, this.cam, this.scene);
      st.headlights = was; rig._setLamps(true);
      rig._wxLit = 'building';
      const done = () => { rig._wxLit = 'ready'; };
      Promise.race([pr, new Promise(r => setTimeout(r, 15000))]).then(done, done);
    } catch (e) { rig._wxLit = 'ready'; }
    return false;
  }
  carGlow(D) {
    const list = this.carLamps && D && D.active && D.traffic && D.traffic.list;
    if (!list || !list.length) { if (this.beams.visible) this.beams.visible = this.heads.visible = this.tails.visible = false; return; }
    const B = this.beams, H = this.heads.geometry, T = this.tails.geometry, ha = H.attributes.aGlow.array, ta = T.attributes.aGlow.array;
    let nb = 0, nh = 0, nt = 0;
    const cam = this.cam.position, k = sstep(0.42, 0.75, this.nightK);
    for (const c of list) {
      const rig = c.rig, o = rig && rig.object, dm = rig && rig.dims;
      if (!o || !dm || !o.visible) continue;
      const mw = o.matrixWorld, e = mw.elements;
      if ((e[12] - cam.x) ** 2 + (e[14] - cam.z) ** 2 > 200 * 200) continue;
      const fr = dm.front || dm.length / 2, re = dm.rear || dm.length / 2, w = dm.width || 1.8;
      if (nb < 32) { _m.makeTranslation(0, 0.07, -(fr + 6.5)).scale(_v.set(Math.max(4, w * 2.4), 1, 12)); _m.premultiply(mw); B.setMatrixAt(nb++, _m); }
      for (let sd = -1; sd <= 1; sd += 2) { const sx = 0.36 * sd;
        if (nh < 64) { _v.set(sx * w, 0.68, -fr + 0.05).applyMatrix4(mw); ha[nh * 4] = _v.x; ha[nh * 4 + 1] = _v.y; ha[nh * 4 + 2] = _v.z; ha[nh * 4 + 3] = 0.42; nh++; }
        if (nt < 64) { _v.set(sx * w * 1.05, 0.85, re - 0.05).applyMatrix4(mw); ta[nt * 4] = _v.x; ta[nt * 4 + 1] = _v.y; ta[nt * 4 + 2] = _v.z; ta[nt * 4 + 3] = 0.3; nt++; }
      }
    }
    B.count = nb; B.instanceMatrix.needsUpdate = true; B.visible = nb > 0; B.material.opacity = 0.32 * k;
    H.instanceCount = nh; H.attributes.aGlow.needsUpdate = true; this.heads.visible = nh > 0;
    T.instanceCount = nt; T.attributes.aGlow.needsUpdate = true; this.tails.visible = nt > 0;
    this.heads.material.uniforms.uK.value = 0.9 * k; this.tails.material.uniforms.uK.value = 0.7 * k;
    this.heads.material.uniforms.uFogD.value = this.tails.material.uniforms.uFogD.value = this.fogDensity;
  }
  setFlash(f) {
    if (f === this.flash) return;
    this.flash = f;
    this.skyMat.uniforms.uFlash.value = f * 1.1;
    this.sky.hemi.intensity = this.hemiI + f * 3.5;
    bakedUniforms.uSkyLight.value.copy(this.baseSkyLight).addScalar(f * 0.6);
    if (this.cloudU && this.cloudU.uFlash) this.cloudU.uFlash.value = f;
  }
  thunder() {
    try {
      const S = this.G.drive && this.G.drive.sound, c = S && S.on && S.ctx;
      if (!c) return;
      const t = c.currentTime + 1 + Math.random() * 3, len = 3.5;
      const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate), d = buf.getChannelData(0);
      let b = 0;
      for (let i = 0; i < d.length; i++) { b = b * 0.985 + (Math.random() * 2 - 1) * 0.015; const x = i / d.length; d[i] = b * 9 * Math.exp(-x * 3) * (0.6 + 0.4 * Math.sin(x * 23 + Math.random())); }
      const src = c.createBufferSource(); src.buffer = buf;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const g = c.createGain(); g.gain.value = 0.9;
      src.connect(lp); lp.connect(g); g.connect(c.destination); src.start(t);
    } catch (e) {}
  }

  // The street lamps of the props now built: a light map of where their light falls (a texture over the area the
  // road and ground shaders read: red the light, green the ground's height there), and a glow at each head. Worked
  // out a few milliseconds a frame (lampStep, from tick), never in one go.
  lamps(D) {
    const P = D.propsObj;
    if (!P || !P.group || this.lampJob) return;
    // (again when the props are new, or when the area moved on)
    if (P === this.lampFor && P.group.children.length === this.lampKids) return;
    this.lampFor = P; this.lampKids = P.group.children.length;
    this.lampJob = this.lampWork(D, P);
  }
  lampStep(budget = 3) {
    if (!this.lampJob) return;
    const t0 = performance.now();
    try { while (performance.now() - t0 < budget) { if (this.lampJob.next().done) { this.lampJob = null; break; } } }
    catch (e) { this.lampJob = null; console.warn('weather lamps', e); }
  }
  *lampWork(D, P) {
    const found = [];
    P.group.traverse(o => {
      const k = o.isInstancedMesh && o.name && o.name.startsWith('props:') ? o.name.slice(6) : null, L = k && LAMPS[k], all = L && o.userData.all;
      if (!all) return;
      for (let i = 0; i < all.n; i++) found.push([k, i, all.m]);
    });
    yield;
    // most streets have no lamps in the map data (and the vector tiles carry none): then lamps are put along the
    // roads' outer lanes, one every 34 m on each side, staggered, as streets are lit
    const R = D.roadsObj, lanes = R && R.graph && R.graph.lanes;
    const synth = [];
    if (lanes) for (let li = 0; li < lanes.length; li++) {
      const L = lanes[li];
      if ((li & 15) === 15) yield;
      if (L.kind !== 'road' || L.order !== L.count - 1 || !L.pts || L.pts.length < 2) continue;
      const sgn = Math.sign(L._o || 1) * (L.dir > 0 ? 1 : -1);
      let acc = L.dir > 0 ? 0 : 17;
      for (let i = 1; i < L.pts.length; i++) {
        const a = L.pts[i - 1], b = L.pts[i], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        while (acc <= len) {
          const t = acc / len, rx = -dz / len * sgn, rz = dx / len * sgn;
          synth.push([a.x + dx * t + rx * 1.2, a.y + (b.y - a.y) * t, a.z + dz * t + rz * 1.2, rx, rz]);
          acc += 34;
        }
        acc -= len;
      }
    }
    const useSynth = found.length < synth.length * 0.25;
    if (!found.length && !synth.length && this.lampTex) return;
    const c = this.cam.position;
    const N = this.low ? 384 : 512, SPAN = this.low ? 900 : 1100, px = SPAN / N;
    const x0 = Math.round((c.x - SPAN / 2) / 16) * 16, z0 = Math.round((c.z - SPAN / 2) / 16) * 16;
    const by = Math.round(c.y);
    const data = new Uint8Array(N * N * 4), acc = new Float32Array(N * N), hb = new Float32Array(N * N), hd = new Float32Array(N * N);
    const glowA = this.glows.geometry.attributes.aGlow, ga = this.glowNext || (this.glowNext = new Float32Array(glowA.array.length));
    let ng = 0;
    const splat = (x, y, z, rad) => {
      const cx = (x - x0) / px, cz = (z - z0) / px, r = rad / px;
      if (cx < -r || cz < -r || cx > N + r || cz > N + r) return false;
      const i0 = Math.max(0, Math.floor(cx - r)), i1 = Math.min(N - 1, Math.ceil(cx + r)), j0 = Math.max(0, Math.floor(cz - r)), j1 = Math.min(N - 1, Math.ceil(cz + r));
      const hy = Math.max(0, Math.min(255, Math.round((y - by) / 2 + 128)));
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const dx = (ii + 0.5 - cx) / r, dz = (j + 0.5 - cz) / r, d2 = dx * dx + dz * dz;
        if (d2 >= 1) continue;
        const f = (1 - d2) * (1 - d2), q = j * N + ii;
        if (f > hb[q]) { hb[q] = f; data[q * 4 + 1] = hy; }
        acc[q] += f;
      }
      return true;
    };
    // (blue: where the lamps' heads are, tight, for their reflections in a wet road)
    const head = (x, z) => {
      const cx = (x - x0) / px, cz = (z - z0) / px, r = Math.max(1.6, 4.5 / px);
      const i0 = Math.max(0, Math.floor(cx - r)), i1 = Math.min(N - 1, Math.ceil(cx + r)), j0 = Math.max(0, Math.floor(cz - r)), j1 = Math.min(N - 1, Math.ceil(cz + r));
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const dx = (ii + 0.5 - cx) / r, dz = (j + 0.5 - cz) / r, d2 = dx * dx + dz * dz;
        if (d2 < 1) { const q = j * N + ii; hd[q] = Math.max(hd[q], 1 - d2); }
      }
    };
    let n = 0;
    for (const [k, i, m] of found) {
      if ((++n & 15) === 0) yield;
      const L = LAMPS[k];
      _m.fromArray(m, i * 16);
      _v.set(L.pool[0], L.pool[1], L.pool[2]).applyMatrix4(_m);
      if (!splat(_v.x, _v.y, _v.z, L.r)) continue;
      _v.set(L.head[0], L.head[1], L.head[2]).applyMatrix4(_m);
      head(_v.x, _v.z);
      if (ng < this.glowMax) {
        ga[ng * 4] = _v.x; ga[ng * 4 + 1] = _v.y - 0.12; ga[ng * 4 + 2] = _v.z; ga[ng * 4 + 3] = k === 'lampPostGlass' ? 0.9 : 1.25;
        ng++;
      }
    }
    if (useSynth) for (const [x, y, z, rx, rz] of synth) {
      if ((++n & 15) === 0) yield;
      if (!splat(x, y, z, 11)) continue;
      head(x + rx * 2.2, z + rz * 2.2);
      if (ng < this.glowMax) { ga[ng * 4] = x + rx * 2.2; ga[ng * 4 + 1] = y + 8.6; ga[ng * 4 + 2] = z + rz * 2.2; ga[ng * 4 + 3] = 1.15; ng++; }
    }
    for (let j = 0; j < N; j++) {
      if ((j & 15) === 15) yield;
      for (let ii = 0, q = j * N; ii < N; ii++, q++) { data[q * 4] = Math.min(255, Math.round(Math.min(1.4, acc[q]) / 1.4 * 255)); data[q * 4 + 2] = Math.round(hd[q] * 255); data[q * 4 + 3] = 255; }
    }
    yield;
    // (all at once: the new map, its box and the glows)
    glowA.array.set(ga.subarray(0, ng * 4)); glowA.needsUpdate = true; this.glows.geometry.instanceCount = ng;
    let t = this.lampTex;
    if (!t || t.image.width !== N) {
      if (t) t.dispose();
      t = this.lampTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    } else t.image.data = data;
    t.needsUpdate = true;
    bakedUniforms.uLampTex.value = t;
    bakedUniforms.uLampBox.value.set(x0, z0, 1 / SPAN, by);
    this.glows.visible = this.lampK > 0.02 && ng > 0;
    this.st.lamps = found.length; this.st.synth = useSynth ? synth.length : 0; this.st.glows = ng;
  }

  // ---- the settings panel's section ----
  ui() {
    const tryAdd = () => {
      const S = window.__carSettings;
      if (!S) return false;
      this.settings = S;
      S.addSection('Time and weather', (el, st) => this.build(el, st), { order: 20, id: 'weather' });
      return true;
    };
    if (!tryAdd()) import('./settings.js?v=51').then(() => tryAdd()).catch(() => {});
  }
  build(el, st) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;margin:2px 0 6px';
    row.innerHTML = '<input type="range" min="0" max="24" step="0.0833" aria-label="Time of day" style="flex:1;accent-color:#1a73e8"><b style="font:500 14px/20px Roboto,system-ui;color:#202124;min-width:44px;text-align:right"></b>';
    el.appendChild(row);
    const range = row.querySelector('input'), lab = row.querySelector('b');
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 4px';
    for (const [k, n] of PRESETS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = n;
      b.style.cssText = 'border:1px solid #dadce0;background:#fff;color:#3c4043;border-radius:16px;padding:5px 12px;font:500 13px Roboto,system-ui;cursor:pointer';
      b.onclick = () => { this.set({ hour: this.presetHour(k), real: false }); };
      chips.appendChild(b);
    }
    el.appendChild(chips);
    const real = st.toggleRow(el, 'Follow the real time here', this.real, v => this.set({ real: v }));
    const h3 = document.createElement('h3'); h3.textContent = 'Weather'; h3.style.cssText = 'margin:16px 0 10px;font:500 14px/20px "Google Sans",Roboto,system-ui,sans-serif;color:#202124';
    el.appendChild(h3);
    const wbox = document.createElement('div'); wbox.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px';
    const wbs = [];
    for (const [k, w] of Object.entries(WEATHER)) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = w.name; b.dataset.k = k;
      b.style.cssText = 'border:1px solid #dadce0;background:#fff;color:#3c4043;border-radius:16px;padding:6px 14px;font:500 13px Roboto,system-ui;cursor:pointer';
      b.onclick = () => this.set({ weather: k });
      wbox.appendChild(b); wbs.push(b);
    }
    el.appendChild(wbox);
    st.text(el, 'Your own choice: in a multiplayer room each player keeps the time and weather they pick. O opens this.');
    const fmt = h => { const hh = Math.floor(h) % 24, mm = Math.floor((h - Math.floor(h)) * 60 + 0.5) % 60; return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
    range.oninput = () => { this.hour = +range.value; this.real = false; real.set(false); lab.textContent = fmt(this.hour); this.apply(false); };
    range.onchange = () => { this.set({ hour: +range.value, real: false }); range.blur(); };
    this.refreshUI = () => {
      range.value = this.hour; lab.textContent = fmt(this.hour); real.set(this.real);
      for (const b of wbs) { const on = b.dataset.k === this.weather; b.style.background = on ? '#e8f0fe' : '#fff'; b.style.borderColor = on ? '#1a73e8' : '#dadce0'; b.style.color = on ? '#1967d2' : '#3c4043'; }
    };
    this.refreshUI();
    return () => this.refreshUI();
  }
  refreshUI() {}
}

// The roads' materials (roads.js) learn the wet and the street lamps' light (patched once, before they are first
// built: drive.js calls attach as the modules load). Wet: darker, glossier, puddles in the dips of a noise.
function patchRoad(m, puddles, R) {
  if (m.userData.weather) return;
  try { const mp = R && R.properties.get(m); if (mp && mp.currentProgram) return; } catch (e) {} // (built already: leave it)
  m.userData.weather = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey && m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => m.type;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.uniforms.uLampTex = bakedUniforms.uLampTex; sh.uniforms.uLampBox = bakedUniforms.uLampBox;
    sh.uniforms.uLampK = bakedUniforms.uLampK; sh.uniforms.uLampCol = bakedUniforms.uLampCol; sh.uniforms.uWet = bakedUniforms.uWet; sh.uniforms.uSnow = bakedUniforms.uSnow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWxW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWxW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWxW;\nuniform float uWet, uSnow;\n' + LAMP_GLSL + `
float wxHash( vec2 p ) { p = fract( p * vec2( 233.34, 851.73 ) ); p += dot( p, p + 23.45 ); return fract( p.x * p.y ); }
float wxNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wxHash( i ), wxHash( i + vec2( 1, 0 ) ), f.x ), mix( wxHash( i + vec2( 0, 1 ) ), wxHash( i + vec2( 1, 1 ) ), f.x ), f.y ); }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float wxPud = 0.0;
if ( uWet > 0.001 ) {
  ${puddles ? 'wxPud = smoothstep( 0.56, 0.64, wxNoise( vWxW.xz * 0.16 ) * 0.7 + wxNoise( vWxW.xz * 0.9 ) * 0.3 ) * uWet;' : ''}
  diffuseColor.rgb *= 1.0 - ( 0.42 + 0.25 * wxPud ) * uWet;
  roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.28 + 0.05, uWet );
  roughnessFactor = mix( roughnessFactor, 0.025, wxPud );
}
// snow: lying in patches, thinner where the wheels run (the asphalt's tyre tracks)
if ( uSnow > 0.001 ) {
  float wxSn = smoothstep( 0.38, 0.62, wxNoise( vWxW.xz * 0.23 ) * 0.6 + wxNoise( vWxW.xz * 1.7 ) * 0.4 + 0.12 * uSnow ) * uSnow;
  ${puddles ? 'wxSn *= 1.0 - 0.85 * rdTrack;' : ''}
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.7, 0.72, 0.76 ), wxSn * 0.85 );
  roughnessFactor = mix( roughnessFactor, 0.65, wxSn );
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 wxL = lampLight( vWxW );
  reflectedLight.directDiffuse += diffuseColor.rgb * wxL;
  // on a wet road the lamps' light comes back off the water too
  reflectedLight.directSpecular += wxL * uWet * ( 0.04 + 0.15 * wxPud );
  // and the lamps themselves shine back out of the wet road: the view's ray off the ground, followed up to a lamp's
  // height, finds the lamp's light there (bright at a pool's middle, under the lamp); long streaks at a low angle
  if ( uWet > 0.001 && uLampK > 0.003 ) {
    vec3 wxV = normalize( vWxW - cameraPosition );
    vec3 wxR = reflect( wxV, vec3( 0.0, 1.0, 0.0 ) );
    if ( wxR.y > 0.015 ) {
      vec2 wxQ = vWxW.xz + wxR.xz * ( 8.0 / wxR.y );
      vec2 wxUV = ( wxQ - uLampBox.xy ) * uLampBox.z;
      if ( wxUV.x > 0.0 && wxUV.y > 0.0 && wxUV.x < 1.0 && wxUV.y < 1.0 ) {
        float wxS = smoothstep( 0.25, 1.0, texture2D( uLampTex, wxUV ).b );
        float wxNear = smoothstep( 5.0, 18.0, length( vWxW - cameraPosition ) );
        reflectedLight.directSpecular += uLampCol * wxS * wxS * wxNear * uLampK * uWet * ( 0.2 + 1.1 * wxPud ) * ( 1.0 - 0.5 * roughnessFactor );
      }
    }
  }
}`);
  };
  m.customProgramCacheKey = () => prevKey() + '|wx1';
  m.needsUpdate = true;
}
