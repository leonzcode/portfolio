// Surfaces whose light is baked into their pictures (Google's photogrammetry, satellite imagery on the terrain)
// are drawn unlit, so they cannot take three.js shadows. This gives any such material the sun's shadow map
// (the DirectionalLight's own, read as three packs it) so the car, the traffic and the props still cast shadows on
// them, and a cut-out mask: where `uCutOn` is set, fragments inside the road mask between the road's height and
// `uCutTop` above it are thrown away (the cars baked into Google's mesh), so our own road shows instead.
import * as THREE from 'three';

export const bakedUniforms = {
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowDark: { value: 0.5 },
  uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
  uShadowBias: { value: 0.0002 }, // (about 8 cm over the shadow camera's 400 m; the photographed surfaces cast nothing, so no acne)
  uCutMap: { value: null },          // R: inside a carriageway (0..1), G: road height, packed (see roads mask)
  uCutOn: { value: 0 },
  uCutBox: { value: new THREE.Vector4(0, 0, 1, 1) }, // x0, z0, 1/width, 1/depth in metres
  uCutTop: { value: 4.2 },
  uCutBelow: { value: 0.6 },
  uCutH: { value: new THREE.Vector2(0, 1) },         // road height = x + uCutHt
  uCutHt: { value: null },
  uExposure: { value: 1 },
  uDetail: { value: null },
  uDetailOn: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  // (round 6, weather.js) the light of the moment against a clear noon: the photographs carry noon's light, so at
  // dusk, under cloud and at night they are darkened (and tinted) by it, the hills and roofs with the rest
  uSkyLight: { value: new THREE.Vector3(1, 1, 1) },
  uWet: { value: 0 },                                  // 0..1: rain on the ground (darker)
  uSnow: { value: 0 },                                 // 0..1: snow lying on flat ground and roofs
  // the street lamps' light map (weather.js lamps): R the light, B where the lamps' heads are (for wet reflections),
  // G the ground's height there ((G*255 - 128) * 2 m
  // over uLampBox.w); box: x0, z0, 1/span, base height
  uLampTex: { value: null },
  uLampBox: { value: new THREE.Vector4(0, 0, 1, 0) },
  uLampK: { value: 0 },
  uLampCol: { value: new THREE.Vector3(1.3, 0.95, 0.6) },
};

// (round 6, weather.js) the street lamps' light at a world position, for any shader that declares these uniforms
export const LAMP_GLSL = /* glsl */`
uniform sampler2D uLampTex;
uniform vec4 uLampBox;
uniform float uLampK;
uniform vec3 uLampCol;
vec3 lampLight( vec3 w ) {
  if ( uLampK < 0.003 ) return vec3( 0.0 );
  vec2 luv = ( w.xz - uLampBox.xy ) * uLampBox.z;
  if ( luv.x <= 0.0 || luv.y <= 0.0 || luv.x >= 1.0 || luv.y >= 1.0 ) return vec3( 0.0 );
  vec4 lt = texture2D( uLampTex, luv );
  float gy = uLampBox.w + ( lt.g * 255.0 - 128.0 ) * 2.0;
  float hk = 1.0 - smoothstep( 3.0, 7.0, abs( w.y - gy ) );
  return uLampCol * ( lt.r * 1.4 ) * uLampK * hk;
}
`;

// A tiling grain (two octaves of value noise) laid over photographs close to the camera, so a satellite picture
// seen from a car's height reads as gravel, grass and asphalt instead of a smear. Luminance only, mean 1.
export function makeDetail() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
  const rnd = (x, y, s) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  const noise = (x, y, f, s) => {
    const fx = x * f / N, fy = y * f / N, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const w = v => ((v % f) + f) % f;
    const a = rnd(w(x0), w(y0), s), b = rnd(w(x0 + 1), w(y0), s), cc = rnd(w(x0), w(y0 + 1), s), dd = rnd(w(x0 + 1), w(y0 + 1), s);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (cc * (1 - sx) + dd * sx) * sy;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = noise(x, y, 64, 1) * 0.5 + noise(x, y, 128, 2) * 0.3 + noise(x, y, 256, 3) * 0.2;
    const o = (y * N + x) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(v * 255); d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const VERT_PARS = /* glsl */`
uniform mat4 uShadowMatrix;
varying vec4 vBkShadow;
varying vec3 vBkWorld;
`;
const VERT = /* glsl */`
{
  vec4 bkW = modelMatrix * vec4( transformed, 1.0 );
  vBkWorld = bkW.xyz;
  vBkShadow = uShadowMatrix * bkW;
}
`;
const FRAG_PARS = /* glsl */`
uniform sampler2D uShadowMap;
uniform float uShadowOn, uShadowDark, uShadowBias, uExposure;
uniform vec2 uShadowTexel;
uniform sampler2D uCutMap;
uniform float uCutOn, uCutTop, uCutBelow;
uniform vec4 uCutBox;
uniform vec2 uCutH;
uniform sampler2D uCutHt;
uniform sampler2D uDetail;
uniform float uDetailOn;
uniform vec3 uCamPos;
uniform vec3 uSkyLight;
uniform float uWet, uSnow;
varying vec4 vBkShadow;
varying vec3 vBkWorld;
${LAMP_GLSL}
// three r180's unpackRGBAToDepth, written out so it does not matter where <packing> sits in the shader
float bkDepth( vec2 uv ) {
  vec4 v = texture2D( uShadowMap, uv );
  return dot( v, vec4( ( 255.0 / 256.0 ) / vec3( 1.0, 256.0, 65536.0 ), 1.0 / 16777216.0 ) );
}
float bkShadow() {
  if ( uShadowOn < 0.5 ) return 1.0;
  vec3 c = vBkShadow.xyz / vBkShadow.w;
  if ( c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0 ) return 1.0;
  float z = c.z - uShadowBias, s = 0.0;
  for ( int i = -1; i <= 1; i++ ) for ( int j = -1; j <= 1; j++ ) {
    s += step( z, bkDepth( c.xy + vec2( float( i ), float( j ) ) * uShadowTexel ) );
  }
  s /= 9.0;
  vec2 e = smoothstep( 0.0, 0.05, c.xy ) * smoothstep( 0.0, 0.05, 1.0 - c.xy );
  return mix( 1.0, s, e.x * e.y );
}
`;
const FRAG_CUT = /* glsl */`
if ( uCutOn > 0.5 ) {
  vec2 cuv = ( vBkWorld.xz - uCutBox.xy ) * uCutBox.zw;
  if ( cuv.x > 0.0 && cuv.x < 1.0 && cuv.y > 0.0 && cuv.y < 1.0 ) {
    vec4 m = texture2D( uCutMap, cuv );
    float rh = uCutH.x + texture2D( uCutHt, cuv ).r;
    // (green: a cut that reaches higher there, 25 m for full green: a tunnel's bore, a road cut into a hillside;
    // cutmask.js and tunnels.js)
    if ( m.r > 0.5 && vBkWorld.y > rh - uCutBelow && vBkWorld.y < rh + max( uCutTop, m.g * 25.0 ) ) discard;
  }
}
`;
const FRAG = /* glsl */`
gl_FragColor.rgb *= mix( uShadowDark, 1.0, bkShadow() ) * uExposure;
if ( uDetailOn > 0.5 ) {
  float dd = distance( vBkWorld, uCamPos );
  vec3 fn = normalize( cross( dFdx( vBkWorld ), dFdy( vBkWorld ) ) );
  float fade = ( 1.0 - smoothstep( 25.0, 90.0, dd ) ) * smoothstep( 0.6, 0.85, abs( fn.y ) );
  if ( fade > 0.0 ) {
    float n = texture2D( uDetail, vBkWorld.xz * 0.35 ).r * 0.6 + texture2D( uDetail, vBkWorld.xz * 1.3 ).r * 0.4;
    // grass in the photo (green over red and blue) gets a finer, stronger grain with a little hue in it, the way
    // a lawn looks from a car; everything else a light concrete and asphalt grain
    vec3 cc = gl_FragColor.rgb;
    float green = smoothstep( 0.01, 0.06, cc.g - max( cc.r, cc.b ) );
    float blades = texture2D( uDetail, vBkWorld.xz * vec2( 3.1, 2.3 ) ).r * 0.5 + texture2D( uDetail, vBkWorld.xz * 6.7 ).r * 0.5;
    float amt = mix( 0.42, 0.75, green );
    float dn = mix( n, blades * 0.6 + n * 0.4, green );
    gl_FragColor.rgb *= 1.0 + ( dn - 0.5 ) * amt * fade;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, gl_FragColor.rgb * vec3( 0.92, 1.06, 0.9 ), green * ( dn - 0.4 ) * fade );
  }
}
// (round 6, weather.js) the light of the moment, wet ground darker, and the street lamps' pools at night
{
  vec3 bkC = gl_FragColor.rgb;
  if ( uWet > 0.001 || uSnow > 0.001 ) {
    vec3 wn = normalize( cross( dFdx( vBkWorld ), dFdy( vBkWorld ) ) );
    float flatK = smoothstep( 0.5, 0.9, abs( wn.y ) );
    bkC *= 1.0 - 0.32 * uWet * flatK;
    // snow: on what is flat enough to hold it, thinner in patches (the grain's broad noise)
    if ( uSnow > 0.001 ) {
      float sn = texture2D( uDetail, vBkWorld.xz * 0.021 ).r * 0.65 + texture2D( uDetail, vBkWorld.xz * 0.11 ).r * 0.35;
      float cov = uSnow * smoothstep( 0.6, 0.88, abs( wn.y ) ) * smoothstep( 0.3, 0.55, sn + 0.18 * uSnow );
      bkC = mix( bkC, vec3( 0.8, 0.82, 0.86 ) * ( 0.92 + 0.16 * sn ), cov );
    }
  }
  gl_FragColor.rgb = bkC * uSkyLight + bkC * lampLight( vBkWorld ) * 0.3;
}
`;

export function patchBaked(material) {
  if (!material || material.userData.baked) return material;
  const mats = Array.isArray(material) ? material : [material];
  for (const m of mats) {
    if (m.userData.baked) continue;
    m.userData.baked = true;
    m.toneMapped = false; // the pictures are photographs already: keep their colours
    const prev = m.onBeforeCompile;
    const prevKey = prev ? prev.toString().length + ':' + (m.type || '') + ':' + (m.constructor.name || '') : m.type;
    m.onBeforeCompile = (shader, r) => {
      if (prev) prev.call(m, shader, r);
      Object.assign(shader.uniforms, bakedUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT);
      const pk = shader.fragmentShader.includes('#include <packing>') ? '' : '#include <packing>\n';
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + pk + FRAG_PARS)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FRAG_CUT)
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + FRAG);
    };
    m.customProgramCacheKey = () => 'baked3|' + prevKey;
    m.needsUpdate = true;
  }
  return material;
}

// Each frame after the shadow map is drawn: point the uniforms at the sun's map.
export function syncBaked(light) {
  const sh = light && light.castShadow ? light.shadow : null;
  if (sh && sh.map) {
    bakedUniforms.uShadowMap.value = sh.map.texture;
    bakedUniforms.uShadowMatrix.value.copy(sh.matrix);
    bakedUniforms.uShadowTexel.value.set(1 / sh.mapSize.x, 1 / sh.mapSize.y);
    bakedUniforms.uShadowOn.value = 1;
  } else bakedUniforms.uShadowOn.value = 0;
}
