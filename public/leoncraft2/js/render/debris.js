/* ---------------------------------------------------------------------------
   Leoncraft 2 - debris (RIP Computer's realism only).

   A block blown up or broken does not just vanish in a puff of flat
   particles: it splits into real little cubes cut from its own textures
   (each face its own picture, the biome's tint on the faces that take one),
   thrown out from the blast, tumbling, bouncing off the ground and walls,
   then lying flat on a face where they came to rest and shrinking away
   after a few seconds. Only a picture: the world's blocks go as they always
   did, the same on every page.

   One instanced mesh of unit cubes, at most MAX pieces (the oldest go
   first); a piece is its middle and size, a turn (a quaternion), the cut of
   the texture it shows, the layers of its six faces and the light where it
   is. Moved 20 times a second (tick), eased between ticks each frame.
--------------------------------------------------------------------------- */
import { BLOCKS, B, SOLID } from '../blocks.js?v=107';
import { COMMON, LIGHTS, LDR, TONEMAP } from './glsl.js?v=107';
import { VANILLA } from './vanilla.js?v=107';
import { Terrain } from '../entities/terrain.js?v=107';
import { Smoke } from './smoke.js?v=107';
const THREE = window.THREE;

const MAX = 900;
const HEAD = `precision highp float; precision highp int; precision highp sampler2DArray;\n`;

const VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
in vec3 position; in vec3 normal; in vec2 uv; in float aFace;
in vec4 iPos;      // middle (xyz) and size (w)
in vec4 iRot;      // the turn, a quaternion
in vec4 iTex;      // the cut of the texture: u, v, how much of it, which faces take the tint (bits)
in vec3 iLayA;     // the layers of the faces +x, -x, +y
in vec3 iLayB;     //   and -y, +z, -z
in vec3 iCol;      // the tint
in vec2 iLv;       // the sky and block light where it is (0..1)
out vec3 vUv; out vec3 vCol; out vec3 vN; out vec3 vWorld; out vec2 vLv;
#ifdef LIT
uniform sampler2D uAmbient, uNoise, uView;
uniform float uEyeInWater;
uniform vec3 uDimAmb;
out vec3 vKeep; out vec3 vAdd;
#endif
LIGHTS_HERE
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
void main() {
  vec3 p = iPos.xyz + qrot(iRot, position * iPos.w);
  vN = qrot(iRot, normal);
  int f = int(aFace + 0.5);
  float layer = f == 0 ? iLayA.x : f == 1 ? iLayA.y : f == 2 ? iLayA.z : f == 3 ? iLayB.x : f == 4 ? iLayB.y : iLayB.z;
  vUv = vec3(iTex.xy + uv * iTex.z, layer);
  vCol = ((int(iTex.w + 0.5) >> f) & 1) == 1 ? iCol : vec3(1.0);
  vWorld = p; vLv = iLv;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * (p - cameraPosition), 1.0);
#ifdef LIT
#ifdef LDR
  fogTerms(p, vKeep, vAdd);
#else
  vKeep = vec3(1.0); vAdd = vec3(0.0);
#endif
#endif
}`;
// the shader looks: lit like the blocks round it (the sun on its side facing the sun, the sky, torches), fogged and
// tone mapped as the particles are (one pass to the screen), or left for the full chain
const FS_LIT = COMMON + TONEMAP + /* glsl */`
uniform sampler2DArray uAlbedo;
uniform sampler2D uAmbient, uNoise;
uniform vec3 uLightDir, uDimAmb;
uniform float uDim, uTime;
in vec3 vUv; in vec3 vCol; in vec3 vN; in vec3 vWorld; in vec2 vLv;
in vec3 vKeep; in vec3 vAdd;
out vec4 o;
LIGHTS_HERE
void main() {
  vec4 t = texture(uAlbedo, vUv);
  // (the see-through parts of leaves and glass stay see-through: clumps of leaves, shards of glass)
  if (t.a < 0.1) discard;
  vec3 albedo = toLinear(t.rgb * vCol);
  vec3 n = normalize(vN);
  float sky = vLv.x, block = vLv.y;
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb;
  vec3 up = texelFetch(uAmbient, ivec2(0, 0), 0).rgb, side = texelFetch(uAmbient, ivec2(1, 0), 0).rgb, down = texelFetch(uAmbient, ivec2(2, 0), 0).rgb;
  vec3 amb = n.y > 0.0 ? mix(side, up, n.y) : mix(side, down, -n.y);
  vec3 L = sunC * smoothstep(0.8, 0.95, sky) * max(dot(n, uLightDir), 0.0) + amb * sky * sky / PI
    + (block > 0.0 ? blockLight(block, sky * sky * sat(lum(sunC) * 0.3)) / PI : vec3(0.0)) + vec3(0.002);
  if (uDim > 0.5) L = uDimAmb * (uDim < 1.5 ? 1.0 : 0.3 + 0.7 * sky * sky) / PI * (0.75 + 0.25 * n.y) + (block > 0.0 ? blockLight(block, 0.0) / PI : vec3(0.0)) + vec3(0.002);
#ifdef LDR
  o = vec4(toneLDR(albedo * L * vKeep + vAdd), 1.0);
#else
  o = vec4(albedo * L, 1.0);
#endif
}`;
// Fast graphics (only drawn if the look changes while pieces are flying): the lightmap and the face shade
const FS_VANILLA = VANILLA + /* glsl */`
uniform sampler2DArray uAlbedo;
uniform vec3 cameraPosition;
in vec3 vUv; in vec3 vCol; in vec3 vN; in vec3 vWorld; in vec2 vLv;
out vec4 o;
void main() {
  vec4 t = texture(uAlbedo, vUv);
  if (t.a < 0.1) discard;
  vec3 n = abs(normalize(vN));
  float shade = n.y > 0.5 ? 1.0 : n.x > n.z ? 0.6 : 0.8;
  vec3 c = t.rgb * vCol * shade * lightmapAt(vLv.x, vLv.y);
  o = vec4(linearFog(c, fogDistance(vWorld - cameraPosition)), 1.0);
}`;

// a unit cube, its faces in the blocks' order (+x, -x, +y, -y, +z, -z: blocks.js resolveTextures)
function cubeGeometry() {
  const F = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const pos = [], nor = [], uv = [], face = [], idx = [];
  F.forEach(([n, u, v], f) => {
    const b = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push((n[0] + u[0] * su + v[0] * sv) * 0.5, (n[1] + u[1] * su + v[1] * sv) * 0.5, (n[2] + u[2] * su + v[2] * sv) * 0.5);
      nor.push(n[0], n[1], n[2]); uv.push((su + 1) / 2, 1 - (sv + 1) / 2); face.push(f);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _w = new THREE.Vector3();

export class Debris {
  constructor(renderer, world) {
    this.R = renderer; this.world = world;
    this.T = world ? new Terrain(world) : null;
    this.list = [];
    const g = this.geo = cubeGeometry();
    const inst = (n, k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * k), k); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; };
    this.aPos = inst('iPos', 4); this.aRot = inst('iRot', 4); this.aTex = inst('iTex', 4);
    this.aLayA = inst('iLayA', 3); this.aLayB = inst('iLayB', 3); this.aCol = inst('iCol', 3); this.aLv = inst('iLv', 2);
    g.instanceCount = 0;
    const uni = Object.assign({}, renderer.U);
    this.mesh = new THREE.Mesh(g, renderer.looked(o => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: HEAD + (o.vanilla ? VS.replace('LIGHTS_HERE', '') : COMMON + TONEMAP + 'uniform float uTime;\n' + VS.replace('LIGHTS_HERE', LDR + LIGHTS)),
      fragmentShader: HEAD + (o.vanilla ? FS_VANILLA : FS_LIT.replace('LIGHTS_HERE', LIGHTS)),
      uniforms: renderer.withU(uni), side: THREE.FrontSide,
      defines: o.vanilla ? {} : o.ldr ? { LIT: 1, LDR: 1, TONE_LUT: 1 } : { LIT: 1 },
    })));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    renderer.scene.add(this.mesh);
    // and the smoke a blast leaves (smoke.js)
    this.smoke = new Smoke(renderer);
    this.smoke.setWorld(world);
  }
  setWorld(world) { this.world = world; this.list.length = 0; this.T = world ? new Terrain(world) : null; this.smoke.setWorld(world); }
  get on() { return !!(this.R.opts && this.R.opts.realism) && !this.R.vanilla; }
  // what a block's pieces look like: the layers of its six faces, which take the tint, and the tint
  look(b, x, z) {
    let d = BLOCKS[b];
    // (only what is solid splits into pieces: grass, flowers, torches and the like just go)
    if (!d || !d.faces || !d.solid || d.shape === 'none' || d.shape === 'fluid' || d.shape === 'cross') return null;
    let faces = d.faces.slice(), mask = 0, tint = 0xffffff;
    // a grass block (and its kind) is dirt under a grassy top
    if (d.name === 'grass_block') { const dirt = BLOCKS[B.dirt].faces[0]; faces = [dirt, dirt, d.faces[2], dirt, dirt, dirt]; mask = 4; }
    else if (d.name === 'podzol' || d.name === 'mycelium' || d.name === 'dirt_path') { const dirt = BLOCKS[B.dirt].faces[0]; faces = [dirt, dirt, d.faces[2], dirt, dirt, dirt]; }
    else if (d.tint) mask = 63;
    if (mask && this.world) {
      const c = this.R.colours, bi = this.world.biomeAt(x, z);
      if (c) tint = d.tint === 'grass' || d.name === 'grass_block' ? c.grass[bi] : d.tint === 'foliage' ? c.leaf[bi] : d.tint === 'spruce' ? 0x619961 : d.tint === 'birch' ? 0x80a755 : d.tint === 'water' ? c.water[bi] : 0xffffff;
    }
    // (a slab, stair, fence or the like: its side picture on every face of its pieces)
    if (d.shape !== 'cube' && d.shape !== 'snow') { const l = d.faces[0] || d.faces[2]; faces = [l, l, l, l, l, l]; }
    return { faces, mask, r: ((tint >> 16) & 255) / 255, g: ((tint >> 8) & 255) / 255, b: (tint & 255) / 255 };
  }
  // one piece: where, its size, its push (blocks a tick) and its spin (radians a tick about each axis)
  piece(look, x, y, z, s, vx, vy, vz, life) {
    if (this.list.length >= MAX) this.list.shift();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3));
    const p = {
      x, y, z, ox: x, oy: y, oz: z, vx, vy, vz, s, q, oq: q.clone(),
      w: new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9),
      age: 0, life: life || (100 + Math.floor(Math.random() * 80)), rest: false,
      u: Math.random() * (1 - Math.min(1, s)), v: Math.random() * (1 - Math.min(1, s)), look, sky: 1, blk: 0,
    };
    this.lightAt(p);
    this.list.push(p);
    return p;
  }
  lightAt(p) {
    const T = this.T;
    if (!T) { p.sky = 1; p.blk = 0; return; }
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    p.sky = T.sky(x, y, z) / 15; p.blk = T.block(x, y, z) / 15;
  }
  /* a block blown apart by a blast at (cx, cy, cz) of this power: n pieces cut from it, thrown away from the blast,
     harder the nearer it was */
  burst(bx, by, bz, b, cx, cy, cz, power, n) {
    if (!this.on) return;
    const look = this.look(b, bx, bz);
    if (!look) return;
    n = n || 6;
    const k = Math.cbrt(n), s0 = 0.62 / k;
    for (let i = 0; i < n; i++) {
      const x = bx + 0.15 + Math.random() * 0.7, y = by + 0.15 + Math.random() * 0.7, z = bz + 0.15 + Math.random() * 0.7;
      let dx = x - cx + (Math.random() - 0.5) * 0.8, dy = y - cy + (Math.random() - 0.5) * 0.8 + 0.6, dz = z - cz + (Math.random() - 0.5) * 0.8;
      const d = Math.hypot(dx, dy, dz) || 1;
      dx /= d; dy /= d; dz /= d;
      const near = Math.max(0, 1 - d / (power * 2.2));
      const sp = (0.25 + Math.random() * 0.4) * (0.4 + 0.6 * Math.sqrt(near)) * Math.min(2, power / 4 + 0.5);
      this.piece(look, x, y, z, s0 * (0.7 + Math.random() * 0.5), dx * sp, dy * sp + 0.12, dz * sp);
    }
  }
  // a block broken by hand: a few chunks falling out of where it was
  crumble(bx, by, bz, b) {
    if (!this.on) return;
    const look = this.look(b, bx, bz);
    if (!look) return;
    const n = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const x = bx + 0.2 + Math.random() * 0.6, y = by + 0.2 + Math.random() * 0.6, z = bz + 0.2 + Math.random() * 0.6;
      this.piece(look, x, y, z, 0.16 + Math.random() * 0.12, (x - bx - 0.5) * 0.12, 0.08 + Math.random() * 0.08, (z - bz - 0.5) * 0.12, 50 + Math.floor(Math.random() * 40));
    }
  }

  /* ---- 20 a second ---- */
  tick() {
    const L = this.list, w = this.world;
    if (!this.on) { L.length = 0; this.smoke.list.length = 0; return; }
    this.smoke.tick();
    if (!L.length) return;
    const solid = (x, y, z) => { if (!w) return false; const bb = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return !!bb && !!SOLID[bb] && BLOCKS[bb].shape === 'cube'; };
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.ox = p.x; p.oy = p.y; p.oz = p.z; p.oq.copy(p.q);
      if (p.age++ >= p.life) continue;
      const r = p.s * 0.5;
      if (!p.rest) {
        p.vy -= 0.045;
        p.vx *= 0.98; p.vy *= 0.98; p.vz *= 0.98;
        // down (or up) first, then across: bounce off what it meets
        let ny = p.y + p.vy;
        let ground = false;
        if (p.vy < 0 && solid(p.x, ny - r, p.z)) {
          ny = Math.floor(ny - r) + 1 + r;
          if (p.vy < -0.1) { p.vy = -p.vy * 0.32; p.w.multiplyScalar(0.7); p.w.x += (Math.random() - 0.5) * 0.3; p.w.z += (Math.random() - 0.5) * 0.3; }
          else { p.vy = 0; ground = true; }
          p.vx *= 0.75; p.vz *= 0.75;
        } else if (p.vy > 0 && solid(p.x, ny + r, p.z)) { ny = p.y; p.vy = -p.vy * 0.2; }
        p.y = ny;
        const nx = p.x + p.vx;
        if (solid(nx + Math.sign(p.vx) * r, p.y, p.z)) { p.vx = -p.vx * 0.3; p.w.y += (Math.random() - 0.5) * 0.4; } else p.x = nx;
        const nz = p.z + p.vz;
        if (solid(p.x, p.y, nz + Math.sign(p.vz) * r)) { p.vz = -p.vz * 0.3; p.w.y += (Math.random() - 0.5) * 0.4; } else p.z = nz;
        // stuck inside something (a block put back where it lay): out on top
        if (solid(p.x, p.y, p.z)) { p.y = Math.floor(p.y) + 1 + r; p.vy = 0; }
        if (ground) {
          p.vx *= 0.55; p.vz *= 0.55; p.w.multiplyScalar(0.45);
          // tipping over onto the face nearest the ground
          let best = 0, sgn = 1, bd = -1;
          for (let a = 0; a < 3; a++) { _v.copy(AXES[a]).applyQuaternion(p.q); const d = Math.abs(_v.y); if (d > bd) { bd = d; best = a; sgn = _v.y < 0 ? -1 : 1; } }
          _v.copy(AXES[best]).applyQuaternion(p.q).multiplyScalar(sgn);
          _q.setFromUnitVectors(_v, UP);
          _q2.copy(_q).multiply(p.q);
          p.q.slerp(_q2, 0.45);
          if (Math.abs(p.vx) + Math.abs(p.vz) < 0.004 && bd > 0.999) { p.rest = true; p.q.copy(_q2); p.y = Math.floor(p.y - r + 0.01) + r; }
        } else if (p.w.lengthSq() > 1e-6) {
          // tumbling as it flies
          const a = p.w.length();
          _q.setFromAxisAngle(_w.copy(p.w).divideScalar(a), a);
          p.q.premultiply(_q).normalize();
        }
        if (p.age % 4 === 0) this.lightAt(p);
      } else if (!solid(p.x, p.y - r - 0.05, p.z)) p.rest = false;   // the ground under it went: falls again
      L[n++] = p;
    }
    L.length = n;
  }

  /* ---- each frame: the pieces eased between ticks ---- */
  render(alpha, cam) {
    if (cam) this.smoke.render(cam, alpha);
    const L = this.list, n = Math.min(L.length, MAX);
    this.mesh.visible = n > 0;
    this.geo.instanceCount = n;
    if (!n) return;
    const P = this.aPos.array, Q = this.aRot.array, Tx = this.aTex.array, LA = this.aLayA.array, LB = this.aLayB.array, C = this.aCol.array, LV = this.aLv.array;
    for (let i = 0; i < n; i++) {
      const p = L[i], f = p.look.faces;
      // the last three quarters of a second: shrinking away
      const left = p.life - (p.age + alpha);
      const k = left < 15 ? Math.max(0, left / 15) : 1;
      P[i * 4] = p.ox + (p.x - p.ox) * alpha; P[i * 4 + 1] = p.oy + (p.y - p.oy) * alpha - (1 - k) * p.s * 0.5; P[i * 4 + 2] = p.oz + (p.z - p.oz) * alpha; P[i * 4 + 3] = p.s * k;
      _q.copy(p.oq).slerp(p.q, alpha);
      Q[i * 4] = _q.x; Q[i * 4 + 1] = _q.y; Q[i * 4 + 2] = _q.z; Q[i * 4 + 3] = _q.w;
      Tx[i * 4] = p.u; Tx[i * 4 + 1] = p.v; Tx[i * 4 + 2] = Math.min(1, p.s); Tx[i * 4 + 3] = p.look.mask;
      LA[i * 3] = f[0]; LA[i * 3 + 1] = f[1]; LA[i * 3 + 2] = f[2]; LB[i * 3] = f[3]; LB[i * 3 + 1] = f[4]; LB[i * 3 + 2] = f[5];
      C[i * 3] = p.look.r; C[i * 3 + 1] = p.look.g; C[i * 3 + 2] = p.look.b;
      LV[i * 2] = p.sky; LV[i * 2 + 1] = p.blk;
    }
    for (const a of [this.aPos, this.aRot, this.aTex, this.aLayA, this.aLayB, this.aCol, this.aLv]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
  }
}
