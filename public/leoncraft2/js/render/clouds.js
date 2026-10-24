/* ---------------------------------------------------------------------------
   Leoncraft 2 - block clouds, as the game draws them with or without shaders.

   Cells of cloud 12 x 4 x 12 at height 192, drifting west, from our own
   256 x 256 pattern that wraps round. Fancy clouds are boxes (a top, a
   bottom and the sides facing open sky, each with its face shade), fast ones
   just the flat tops. The mesh is laid out in cells round the camera and
   only rebuilt when you are eight cells from where it was built; between
   rebuilds it just slides with the wind.

   Drawn twice: depth first, then colour where it is the nearest cloud, so
   they never show through each other. Whoever makes one hands in a
   material maker (the colour and fog are theirs: render/vanilla.js for Fast,
   renderer.js for Detailed); the geometry has a position and a face shade.
--------------------------------------------------------------------------- */
import { COMMON, TONEMAP, EXPOSURE } from './glsl.js?v=107';
const THREE = window.THREE;
export const CLOUD_H = 192, CLOUD_S = 12;

/* Detailed's clouds: white, lit by the sun (or moon) from above and the sky
   all round, with the same face shades, melting into the sky's own colour
   towards the horizon, then tone mapped like everything else. A cloud's face
   is one colour but for that melt, so all of it is worked out per vertex. */
const DETAILED_VS = COMMON + TONEMAP + /* glsl */`
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform sampler2D uView, uAmbient;
uniform vec3 cameraPosition, uLightDir;
uniform float uExposure, uRender, uDim;
uniform vec2 uCloudFade;     // where they start to melt into the sky, and where they are gone (Cloud Distance)
` + EXPOSURE + /* glsl */`
in vec3 position; in float shade;
out vec4 vCol;
vec3 skyDir(vec3 d) {
  float elev = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (PI * 0.5));
  float az = atan(d.z, d.x); if (az < 0.0) az += TAU;
  return textureLod(uView, vec2(az / TAU, v), 0.0).rgb;
}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  // (from the eye, never viewMatrix on the place in the world: vanilla.js TERRAIN_VS; the depth pass and the colour pass
  // came out a little apart far from the middle of the world, and the clouds flickered as the view turned)
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (w.xyz - cameraPosition), 1.0);
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb, amb = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
  vec3 c = 0.85 * (sunC * (0.2 + 0.45 * sat(uLightDir.y)) + amb * (1.3 / PI)) * shade;
  vec3 rel = w.xyz - cameraPosition;
  float f = smoothstep(uCloudFade.x, uCloudFade.y, length(rel.xz));
  vec3 rd = normalize(rel);
  // (into the fog's colour: near the bottom of the world that goes to black, glsl.js VOID)
  c = mix(c, skyDir(vec3(rd.x, max(rd.y, 0.0), rd.z)) * (1.0 - uVoid.y), f);
  float a = 0.8 * (1.0 - f * f);
#ifdef HDR
  // the full chain: light as it is, weighed by how much cloud there is, and what shows through it in
  // the alpha, for the composite to put the sky behind (post.js)
  vCol = vec4(c * a, 1.0 - a);
#else
  vCol = vec4(toneLDR(c * exposureNow()), a);
#endif
}`;
const DETAILED_FS = /* glsl */`
in vec4 vCol;
out vec4 o;
void main() { o = vCol; }`;
export function detailedCloudMaterial(U, hdr) {
  // (the full chain's are written straight over what is there, colour and alpha: see DETAILED_VS)
  const over = hdr ? { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor } : {};
  return extra => new THREE.RawShaderMaterial(Object.assign({
    glslVersion: THREE.GLSL3, vertexShader: 'precision highp float; precision highp int;\n' + DETAILED_VS, fragmentShader: 'precision highp float;\n' + DETAILED_FS,
    uniforms: U, side: THREE.DoubleSide, defines: hdr ? { HDR: 1 } : {},
  }, extra, extra && extra.transparent ? over : {}));
}

export class BlockClouds {
  // material(extra): a material for this geometry, with extra settings merged in
  constructor(material) {
    // (only read, so one for every set of clouds: the full chain's no longer works it out again in the frame it is turned on)
    this.cells = cloudPattern || (cloudPattern = makeCloudPattern());
    this.geo = new THREE.BufferGeometry();
    this.depth = new THREE.Mesh(this.geo, material({ colorWrite: false }));
    this.colour = new THREE.Mesh(this.geo, material({ transparent: true, depthWrite: false, depthFunc: THREE.LessEqualDepth }));
    this.scene = new THREE.Scene();
    for (const m of [this.depth, this.colour]) { m.frustumCulled = false; m.matrixAutoUpdate = false; this.scene.add(m); }
    this.colour.renderOrder = 1;
    this.at = null;
  }
  // mode 'fancy' or 'fast'; reach: how far out they need to go (blocks)
  draw(r, cam, time, mode, reach) {
    const H = CLOUD_H, S = CLOUD_S;
    const scroll = time * 20 * 0.03;
    const cx = Math.floor((cam.position.x + scroll) / S), cz = Math.floor(cam.position.z / S);
    const flat = mode === 'fast';
    const R = Math.max(16, Math.ceil(reach / S) + 1) + 8;
    const B = this.at;
    if (!B || B.flat !== flat || B.R !== R || Math.abs(cx - B.cx) > 8 || Math.abs(cz - B.cz) > 8) {
      this.at = { cx, cz, flat, R };
      this.build(cx, cz, R, flat);
    }
    // the mesh is laid out in cloud cells round where it was built; slide it with the wind
    const at = this.at;
    for (const m of [this.depth, this.colour]) {
      m.position.set(at.cx * S - scroll, H, at.cz * S);
      m.updateMatrix(); m.matrixWorld.copy(m.matrix);
    }
    r.render(this.scene, cam);
  }
  build(cx, cz, R, flat) {
    const cells = this.cells, S = CLOUD_S, T = flat ? 0 : 4;
    const on = (x, z) => cells[(((cz + z) & 255) << 8) | ((cx + x) & 255)];
    // counted first, then written straight into typed arrays
    let quads = 0;
    // past NEAR cells only their tops: smaller than a pixel's worth of side by then, and a long Cloud Distance stays cheap
    const NEAR = 48 * 48;
    for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
      if (!on(x, z)) continue;
      quads += flat || x * x + z * z > NEAR ? 1 : 2 + !on(x - 1, z) + !on(x + 1, z) + !on(x, z - 1) + !on(x, z + 1);
    }
    const pos = new Float32Array(quads * 18), sh = new Float32Array(quads * 6);
    let n = 0, m = 0;
    const v = (x, y, z) => { pos[n++] = x; pos[n++] = y; pos[n++] = z; };
    const quad = (ax, ay, az, bx, by, bz, cx2, cy, cz2, dx, dy, dz, s) => {
      v(ax, ay, az); v(bx, by, bz); v(cx2, cy, cz2); v(ax, ay, az); v(cx2, cy, cz2); v(dx, dy, dz);
      for (let i = 0; i < 6; i++) sh[m++] = s;
    };
    for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
      if (!on(x, z)) continue;
      const x0 = x * S, x1 = x0 + S, z0 = z * S, z1 = z0 + S;
      quad(x0, T, z0, x0, T, z1, x1, T, z1, x1, T, z0, 1.0);
      if (flat || x * x + z * z > NEAR) continue;
      quad(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1, 0.7);
      if (!on(x - 1, z)) quad(x0, 0, z0, x0, 0, z1, x0, T, z1, x0, T, z0, 0.9);
      if (!on(x + 1, z)) quad(x1, 0, z1, x1, 0, z0, x1, T, z0, x1, T, z1, 0.9);
      if (!on(x, z - 1)) quad(x1, 0, z0, x0, 0, z0, x0, T, z0, x1, T, z0, 0.8);
      if (!on(x, z + 1)) quad(x0, 0, z1, x1, 0, z1, x1, T, z1, x0, T, z1, 0.8);
    }
    const g = this.geo;
    g.dispose();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('shade', new THREE.BufferAttribute(sh, 1));
    g.setDrawRange(0, quads * 6);
  }
}

/* Our own cloud pattern, 256 x 256 cells that wrap round: soft noise cut at
   a level, so it comes out as the same kind of big blocky drifts with sky
   between them. */
let cloudPattern = null;
function makeCloudPattern() {
  const N = 256, out = new Uint8Array(N * N);
  const rnd = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise = (x, y, p, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const a = rnd(((xi % p) + p) % p, ((yi % p) + p) % p, s), b = rnd((((xi + 1) % p) + p) % p, ((yi % p) + p) % p, s);
    const c = rnd(((xi % p) + p) % p, (((yi + 1) % p) + p) % p, s), d = rnd((((xi + 1) % p) + p) % p, (((yi + 1) % p) + p) % p, s);
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = noise(x / 16, y / 16, 16, 1) * 0.55 + noise(x / 6, y / 6, 256 / 6 | 0, 2) * 0.3 + noise(x / 2.5, y / 2.5, 256 / 2.5 | 0, 3) * 0.15;
    out[y * N + x] = n > 0.56 ? 1 : 0;
  }
  return out;
}
