/* ---------------------------------------------------------------------------
   Leoncraft 2 - soft smoke (RIP Computer's realism only).

   An explosion leaves a cloud: puffs thrown out from the blast that swell,
   rise and drift with the wind for a few seconds, see-through and soft at
   their edges, broken up by a drifting noise, lit by the sky and the sun
   (and brighter seen against the sun), the first few glowing as a fireball
   for a moment. Billboards drawn right after the full chain's composite
   (post.js afterComp), so they go over the sky too, each pixel tested
   against the world's depth by hand and faded where it meets the ground
   (soft particles); sorted far to near; the picture's alpha is left as it
   was (the eye's measure reads it: post.js FS_LUM).
--------------------------------------------------------------------------- */
import { COMMON } from './glsl.js?v=107';
import { Terrain } from '../entities/terrain.js?v=107';
const THREE = window.THREE;

const MAX = 240;
const HEAD = `precision highp float; precision highp int;\n`;

const VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
in vec2 position;
in vec4 iPos;      // middle (xyz) and half size (w)
in vec4 iA;        // age (0..1 of its life), heat (fireball glow, 0..1), seed, turn
in vec2 iLv;       // the sky and block light where it is (0..1)
out vec2 vUv; out vec4 vA; out vec2 vLv; out vec3 vDir;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iA.w), s = sin(iA.w);
  vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
  vec3 p = iPos.xyz + (right * q.x + up * q.y) * iPos.w;
  vUv = position; vA = iA; vLv = iLv; vDir = normalize(p - cameraPosition);
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (p - cameraPosition), 1.0);
}`;
const FS = COMMON + /* glsl */`
uniform sampler2D uAmbient, uNoise;
uniform sampler2D uSmokeDepth;   // the world's depth (the full chain's main picture)
uniform vec2 uSmokeSize;         // the size of the picture drawn into
uniform float uNear, uFar;
uniform vec3 uLightDir;
uniform float uTime, uDim;
uniform vec3 uDimAmb;
in vec2 vUv; in vec4 vA; in vec2 vLv; in vec3 vDir;
out vec4 o;
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float scene = textureLod(uSmokeDepth, gl_FragCoord.xy / uSmokeSize, 0.0).r;
  if (gl_FragCoord.z >= scene) discard;
  float soft = scene >= 1.0 ? 1.0 : sat((lin(scene) - lin(gl_FragCoord.z)) / 1.2);
  float t = vA.x;
  // a soft round edge, eaten into by two drifting layers of noise
  vec2 nuv = vUv * 0.22 + vA.z * 7.31;
  float n = textureLod(uNoise, nuv + vec2(uTime * 0.013, -uTime * 0.009), 0.0).r * 0.6 + textureLod(uNoise, nuv * 2.3 - uTime * 0.02, 0.0).g * 0.4;
  float dens = smoothstep(1.0, 0.2, r) * sat(0.35 + (n - 0.5) * 1.8 + (1.0 - r) * 0.5);
  float fade = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.45, 1.0, t));
  float a = dens * fade * 0.72 * soft;
  if (a < 0.004) discard;
  // lit by the sky and, out in the open, the sun (more of it seen against the sun: light through the smoke)
  float sky = vLv.x, block = vLv.y;
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb, amb = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
  float through = 0.55 + 1.6 * pow(sat(dot(vDir, uLightDir)), 6.0);
  vec3 L = amb * sky * sky / PI + sunC * smoothstep(0.8, 0.95, sky) * 0.35 * through + vec3(1.0, 0.6, 0.3) * block * block * 0.6 + vec3(0.002);
  if (uDim > 0.5) L = uDimAmb / PI + vec3(1.0, 0.6, 0.3) * block * block * 0.6 + vec3(0.002);
  vec3 col = vec3(0.32, 0.31, 0.3) * mix(1.0, 0.7, n) * L;
  // the fireball: white-yellow in its middle going orange, for the first moments
  float heat = vA.y * (1.0 - smoothstep(0.0, 0.07, t));
  col += mix(vec3(6.0, 2.2, 0.5), vec3(12.0, 8.0, 3.0), sat(1.0 - r * 1.4)) * heat * dens;
  o = vec4(col, a);
}`;

export class Smoke {
  constructor(renderer) {
    this.R = renderer;
    this.list = [];
    this.T = null; this.world = null;
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    // (three.js sorts see-through things by their bounding sphere's middle: given, as the corners are only 2D)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const inst = (n, k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * k), k); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.aPos = inst('iPos', 4); this.aA = inst('iA', 4); this.aLv = inst('iLv', 2);
    g.instanceCount = 0;
    this.uDepth = { value: null }; this.uSize = { value: new THREE.Vector2(1, 1) };
    this.mesh = new THREE.Mesh(g, new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + VS, fragmentShader: HEAD + FS,
      uniforms: renderer.withU({ uSmokeDepth: this.uDepth, uSmokeSize: this.uSize }), transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.order = [];
    // drawn into the composite (post.js calls it with the picture, the main one for its depth, and the camera)
    this.draw = (target, main, cam) => {
      if (!this.mesh.visible || !main.depthTexture) return;
      this.uDepth.value = main.depthTexture; this.uSize.value.set(target.width, target.height);
      const r = this.R.r;
      r.setRenderTarget(target);
      r.render(this.scene, cam);
    };
  }
  setWorld(world) { if (world !== this.world) { this.world = world; this.T = world ? new Terrain(world) : null; this.list.length = 0; } }
  // one puff: where, its push (blocks a tick), its half size now and at the end, its life (ticks), how hot it starts
  puff(x, y, z, vx, vy, vz, s0, s1, life, heat) {
    if (this.list.length >= MAX) this.list.shift();
    const p = { x, y, z, ox: x, oy: y, oz: z, vx, vy, vz, s0, s1, life, age: 0, heat: heat || 0, seed: Math.random(), rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.02, sky: 1, blk: 0 };
    this.lightAt(p);
    this.list.push(p);
  }
  lightAt(p) {
    const T = this.T;
    if (!T) return;
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    p.sky = T.sky(x, y, z) / 15; p.blk = T.block(x, y, z) / 15;
  }
  // an explosion's cloud: puffs thrown out round it, the inner ones a fireball for a moment
  blast(x, y, z, power) {
    const n = Math.round(10 + power * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, d = Math.random() * power * 0.35;
      const dx = Math.cos(a) * Math.cos(e), dy = Math.sin(e), dz = Math.sin(a) * Math.cos(e);
      const sp = 0.05 + Math.random() * 0.12 * power / 4;
      const hot = i < n * 0.4 ? 0.6 + Math.random() * 0.4 : 0;
      this.puff(x + dx * d, y + dy * d + 0.3, z + dz * d, dx * sp, dy * sp * 0.6 + 0.03, dz * sp,
        0.5 + Math.random() * 0.5 + power * 0.1, 1.6 + Math.random() * 1.2 + power * 0.35, 70 + Math.floor(Math.random() * 90), hot);
    }
  }
  tick() {
    const L = this.list;
    if (!L.length) return;
    let n = 0;
    for (const p of L) {
      p.ox = p.x; p.oy = p.y; p.oz = p.z;
      if (++p.age >= p.life) continue;
      // slowing, rising, carried off with the wind (the way the clouds and Photon's wind go)
      p.vx = p.vx * 0.9 + 0.0035; p.vz = p.vz * 0.9 + 0.002; p.vy = p.vy * 0.92 + 0.0028;
      p.x += p.vx; p.y += p.vy; p.z += p.vz;
      p.rot += p.spin;
      if (p.age % 5 === 0) this.lightAt(p);
      L[n++] = p;
    }
    L.length = n;
  }
  render(cam, alpha) {
    const L = this.list, n = Math.min(L.length, MAX);
    if (this.R.post) this.R.post.afterComp = this.draw;
    this.mesh.visible = n > 0;
    this.geo.instanceCount = n;
    if (!n) return;
    // far to near, so the nearer ones go over
    const c = cam.position, O = this.order;
    O.length = 0;
    for (let i = 0; i < n; i++) { const p = L[i]; O.push([(p.x - c.x) ** 2 + (p.y - c.y) ** 2 + (p.z - c.z) ** 2, p]); }
    O.sort((a, b) => b[0] - a[0]);
    const P = this.aPos.array, A = this.aA.array, LV = this.aLv.array;
    for (let i = 0; i < n; i++) {
      const p = O[i][1], t = Math.min(1, (p.age + alpha) / p.life);
      P[i * 4] = p.ox + (p.x - p.ox) * alpha; P[i * 4 + 1] = p.oy + (p.y - p.oy) * alpha; P[i * 4 + 2] = p.oz + (p.z - p.oz) * alpha;
      P[i * 4 + 3] = p.s0 + (p.s1 - p.s0) * (1 - (1 - t) * (1 - t));
      A[i * 4] = t; A[i * 4 + 1] = p.heat; A[i * 4 + 2] = p.seed; A[i * 4 + 3] = p.rot;
      LV[i * 2] = p.sky; LV[i * 2 + 1] = p.blk;
    }
    for (const a of [this.aPos, this.aA, this.aLv]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
  }
}
