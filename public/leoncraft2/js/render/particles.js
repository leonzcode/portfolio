/* ---------------------------------------------------------------------------
   Leoncraft 2 - particles.

   The game's block particles, to its numbers: a broken block bursts into
   pieces from a grid four to a side across each of its boxes (64 for a
   cube), each showing a random quarter of the block's texture at 0.6 of
   its brightness, 0.1 to 0.2 of a block across, living 4 to 40 ticks,
   falling at 0.04 a tick with 0.98 drag and bouncing to a stop on the
   ground; mining chips one off the face you are hitting every tick. Grass
   blocks crumble as dirt; tinted blocks (leaves, grass) take their
   colour.

   Other parts of the game can throw their own with spawn() (a coloured
   square, or a block-textured piece): smoke, crits, splashes and the rest.

   All of them are drawn as one mesh of quads facing the camera, rebuilt
   each frame from the live ones (at most MAX), lit by the light where the
   player stands.
--------------------------------------------------------------------------- */
import { BLOCKS, B, SOLID } from '../blocks.js?v=19';
import { VANILLA } from './vanilla.js?v=19';
import { COMMON, LIGHTS, LDR, TONEMAP } from './glsl.js?v=19';
const THREE = window.THREE;

const MAX = 1500;
const HEAD = `precision highp float; precision highp int; precision highp sampler2DArray;\n`;

const VS = /* glsl */`
uniform mat4 viewMatrix, projectionMatrix;
in vec3 position; in vec3 aUv; in vec3 aCol;
out vec3 vUv; out vec3 vCol; out vec3 vWorld;
#ifdef LIT
// Shaders ON: the light where you stand and (one pass) the fog, per corner (a piece is a few pixels across)
uniform sampler2D uAmbient, uNoise, uView;
uniform vec3 cameraPosition;
uniform vec2 uLightLv;
uniform float uEyeInWater;
out vec3 vLight; out vec3 vKeep; out vec3 vAdd;
#endif
LIGHTS_HERE
void main() {
  vUv = aUv; vCol = aCol; vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
#ifdef LIT
  float sky = uLightLv.x, block = uLightLv.y;
  vec3 sunC = texelFetch(uAmbient, ivec2(3, 0), 0).rgb, amb = texelFetch(uAmbient, ivec2(0, 0), 0).rgb;
  vLight = sunC * smoothstep(0.8, 0.95, sky) * 0.5 + amb * sky * sky * 0.8 / PI + (block > 0.0 ? blockLight(block, sky * sky * sat(lum(sunC) * 0.3)) / PI : vec3(0.0)) + vec3(0.002);
#ifdef LDR
  fogTerms(position, vKeep, vAdd);
#else
  // the full chain fogs and tone-maps the whole picture afterwards (render/post.js)
  vKeep = vec3(1.0); vAdd = vec3(0.0);
#endif
#endif
}`;
// Fast graphics: the lightmap and the fog, as the blocks
const FS_VANILLA = VANILLA + /* glsl */`
uniform sampler2DArray uAlbedo;
uniform vec3 cameraPosition;
uniform vec2 uLightLv;
in vec3 vUv; in vec3 vCol; in vec3 vWorld;
out vec4 o;
void main() {
  vec4 t = vUv.z >= 0.0 ? textureLod(uAlbedo, vUv, 0.0) : vec4(1.0);
  if (t.a < 0.1) discard;
  vec3 c = t.rgb * vCol * lightmapAt(uLightLv.x, uLightLv.y);
  o = vec4(linearFog(c, fogDistance(vWorld - cameraPosition)), 1.0);
}`;
// Detailed graphics: lit like the player model (sky, sun, block light), then fogged and tone mapped like the blocks
const FS_DETAILED = COMMON + TONEMAP + /* glsl */`
uniform sampler2DArray uAlbedo;
in vec3 vUv; in vec3 vCol; in vec3 vWorld;
in vec3 vLight; in vec3 vKeep; in vec3 vAdd;
out vec4 o;
void main() {
  vec4 t = vUv.z >= 0.0 ? textureLod(uAlbedo, vUv, 0.0) : vec4(1.0);
  if (t.a < 0.1) discard;
  vec3 albedo = toLinear(t.rgb * vCol);
#ifdef LDR
  o = vec4(toneLDR(albedo * vLight * vKeep + vAdd), 1.0);
#else
  o = vec4(albedo * vLight, 1.0);
#endif
}`;

/* Particles (Video Settings): All shows every one; Decreased leaves out one
   in three; Minimal shows only one in ten. */
export const particleSetting = { level: 'all' };
export function keepParticle() {
  const l = particleSetting.level;
  return l === 'all' ? true : l === 'decreased' ? Math.random() >= 1 / 3 : Math.random() < 0.1;
}

export class Particles {
  constructor(renderer, world) {
    this.R = renderer; this.world = world;
    this.list = [];
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 12); this.uv = new Float32Array(MAX * 12); this.col = new Float32Array(MAX * 12);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aUv', new THREE.BufferAttribute(this.uv, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array(MAX * 6);
    for (let i = 0; i < MAX; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const U = renderer.U;
    const uni = Object.assign({}, U, { uLightLv: renderer.avatar.uLight });
    // made again for each look, Shaders ON or OFF (render/looks.js)
    this.mesh = new THREE.Mesh(g, renderer.looked(o => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: HEAD + (o.vanilla ? VS.replace('LIGHTS_HERE', '') : COMMON + TONEMAP + 'uniform float uTime;\n' + VS.replace('LIGHTS_HERE', LDR + LIGHTS)), fragmentShader: HEAD + (o.vanilla ? FS_VANILLA : FS_DETAILED),
      uniforms: renderer.withU(uni), side: THREE.DoubleSide, defines: o.vanilla ? {} : o.ldr ? { LIT: 1, LDR: 1, TONE_LUT: 1 } : { LIT: 1 },
    })));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    renderer.scene.add(this.mesh);
    this.right = new THREE.Vector3(); this.up = new THREE.Vector3();
  }
  setWorld(world) { this.world = world; this.list.length = 0; }

  /* ---- what a block looks like as particles ---- */
  look(b, x, z) {
    let d = BLOCKS[b];
    if (!d || !d.faces) return null;
    // grass blocks (and their kind) crumble as dirt, as the game draws them
    if (d.name === 'grass_block' || d.name === 'podzol' || d.name === 'mycelium' || d.name === 'dirt_path') d = BLOCKS[B.dirt];
    const layer = d.faces[0];
    let tint = 0xffffff;
    if (d.tint && this.world) {
      const c = this.R.colours, bi = this.world.biomeAt(x, z);
      if (c) tint = d.tint === 'grass' ? c.grass[bi] : d.tint === 'foliage' ? c.leaf[bi] : d.tint === 'spruce' ? 0x619961 : d.tint === 'birch' ? 0x80a755 : d.tint === 'water' ? c.water[bi] : 0xffffff;
    }
    return { layer, r: ((tint >> 16) & 255) / 255 * 0.6, g: ((tint >> 8) & 255) / 255 * 0.6, b: (tint & 255) / 255 * 0.6 };
  }
  terrain(x, y, z, xa, ya, za, look) {
    const p = this.make(x, y, z, xa, ya, za);
    p.layer = look.layer; p.r = look.r; p.g = look.g; p.b = look.b;
    p.uo = Math.random() * 3; p.vo = Math.random() * 3;
    p.size /= 2;
    return p;
  }
  // the game's particle: a random push, normalised to a random speed, plus 0.1 up
  make(x, y, z, xa, ya, za) {
    const keep = keepParticle();
    let xd = xa + (Math.random() * 2 - 1) * 0.4, yd = ya + (Math.random() * 2 - 1) * 0.4, zd = za + (Math.random() * 2 - 1) * 0.4;
    const s = (Math.random() + Math.random() + 1) * 0.15, l = Math.hypot(xd, yd, zd) || 1;
    xd = xd / l * s * 0.4; yd = yd / l * s * 0.4 + 0.1; zd = zd / l * s * 0.4;
    const p = { x, y, z, ox: x, oy: y, oz: z, xd, yd, zd, age: 0, life: Math.floor(4 / (Math.random() * 0.9 + 0.1)), size: 0.1 * (Math.random() * 0.5 + 0.5) * 2,
      gravity: 1, friction: 0.98, layer: -1, uo: 0, vo: 0, r: 1, g: 1, b: 1, ground: false, physics: true };
    // (one the Particles setting leaves out is made all the same, for whoever asked for it, but never shown)
    if (!keep) return p;
    if (this.list.length >= MAX) this.list.shift();
    this.list.push(p);
    return p;
  }
  // a broken block: pieces from a grid across each of its boxes
  blockBreak(x, y, z, b, boxes) {
    const look = this.look(b, x, z);
    if (!look) return;
    const list = boxes && boxes.length ? boxes : [[0, 0, 0, 1, 1, 1]];
    for (const bx of list) {
      const dx = Math.min(1, bx[3] - bx[0]), dy = Math.min(1, bx[4] - bx[1]), dz = Math.min(1, bx[5] - bx[2]);
      const nx = Math.max(2, Math.ceil(dx / 0.25)), ny = Math.max(2, Math.ceil(dy / 0.25)), nz = Math.max(2, Math.ceil(dz / 0.25));
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
        const fx = (i + 0.5) / nx, fy = (j + 0.5) / ny, fz = (k + 0.5) / nz;
        this.terrain(x + fx * dx + bx[0], y + fy * dy + bx[1], z + fz * dz + bx[2], fx - 0.5, fy - 0.5, fz - 0.5, look);
      }
    }
  }
  // mining: a chip off the face being hit
  blockHit(x, y, z, face, b, box) {
    const look = this.look(b, x, z);
    if (!look || !face) return;
    const c = box || [0, 0, 0, 1, 1, 1];
    let px = x + Math.random() * (c[3] - c[0] - 0.2) + 0.1 + c[0];
    let py = y + Math.random() * (c[4] - c[1] - 0.2) + 0.1 + c[1];
    let pz = z + Math.random() * (c[5] - c[2] - 0.2) + 0.1 + c[2];
    if (face[1] < 0) py = y + c[1] - 0.1; if (face[1] > 0) py = y + c[4] + 0.1;
    if (face[2] < 0) pz = z + c[2] - 0.1; if (face[2] > 0) pz = z + c[5] + 0.1;
    if (face[0] < 0) px = x + c[0] - 0.1; if (face[0] > 0) px = x + c[3] + 0.1;
    const p = this.terrain(px, py, pz, 0, 0, 0, look);
    p.xd *= 0.2; p.yd = (p.yd - 0.1) * 0.2 + 0.1; p.zd *= 0.2;
    p.size *= 0.6;
  }
  // anything else: { colour: 0xRRGGBB, size, life, gravity, friction, physics, block }
  spawn(x, y, z, xd, yd, zd, o = {}) {
    const p = this.make(x, y, z, 0, 0, 0);
    p.xd = xd; p.yd = yd; p.zd = zd;
    if (o.size !== undefined) p.size = o.size;
    if (o.life !== undefined) p.life = o.life;
    if (o.gravity !== undefined) p.gravity = o.gravity;
    if (o.friction !== undefined) p.friction = o.friction;
    if (o.physics !== undefined) p.physics = o.physics;
    if (o.block) { const l = this.look(o.block, Math.floor(x), Math.floor(z)); if (l) { p.layer = l.layer; p.r = l.r; p.g = l.g; p.b = l.b; p.uo = Math.random() * 3; p.vo = Math.random() * 3; } }
    if (o.colour !== undefined) { p.r = ((o.colour >> 16) & 255) / 255; p.g = ((o.colour >> 8) & 255) / 255; p.b = (o.colour & 255) / 255; }
    return p;
  }

  /* ---- 20 a second ---- */
  tick() {
    const L = this.list, w = this.world;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.ox = p.x; p.oy = p.y; p.oz = p.z;
      if (p.age++ >= p.life) continue;
      p.yd -= 0.04 * p.gravity;
      this.move(p, w);
      p.xd *= p.friction; p.yd *= p.friction; p.zd *= p.friction;
      if (p.ground) { p.xd *= 0.7; p.zd *= 0.7; }
      L[n++] = p;
    }
    L.length = n;
  }
  // a particle stops against whole solid blocks (enough for pieces this small)
  move(p, w) {
    if (!p.physics || !w) { p.x += p.xd; p.y += p.yd; p.z += p.zd; return; }
    const solid = (x, y, z) => { const b = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return b && SOLID[b] && BLOCKS[b].shape === 'cube'; };
    const r = p.size * 0.5;
    let ny = p.y + p.yd;
    p.ground = false;
    if (solid(p.x, ny - r, p.z)) { if (p.yd < 0) { ny = Math.floor(ny - r) + 1 + r; p.ground = true; } else ny = p.y; p.yd = 0; }
    p.y = ny;
    const nx = p.x + p.xd; if (solid(nx, p.y, p.z)) p.xd = 0; else p.x = nx;
    const nz = p.z + p.zd; if (solid(p.x, p.y, nz)) p.zd = 0; else p.z = nz;
  }

  /* ---- each frame: the quads, between ticks ---- */
  render(cam, alpha) {
    const L = this.list, n = Math.min(L.length, MAX);
    const P = this.pos, UV = this.uv, C = this.col;
    const R = this.right.setFromMatrixColumn(cam.matrixWorld, 0), Up = this.up.setFromMatrixColumn(cam.matrixWorld, 1);
    for (let i = 0; i < n; i++) {
      const p = L[i];
      const x = p.ox + (p.x - p.ox) * alpha, y = p.oy + (p.y - p.oy) * alpha, z = p.oz + (p.z - p.oz) * alpha;
      const s = p.size;
      const rx = R.x * s, ry = R.y * s, rz = R.z * s, ux = Up.x * s, uy = Up.y * s, uz = Up.z * s;
      const o = i * 12;
      P[o] = x - rx - ux; P[o + 1] = y - ry - uy; P[o + 2] = z - rz - uz;
      P[o + 3] = x + rx - ux; P[o + 4] = y + ry - uy; P[o + 5] = z + rz - uz;
      P[o + 6] = x + rx + ux; P[o + 7] = y + ry + uy; P[o + 8] = z + rz + uz;
      P[o + 9] = x - rx + ux; P[o + 10] = y - ry + uy; P[o + 11] = z - rz + uz;
      // a quarter of the texture, from where this piece was cut
      const u0 = p.uo / 4, v0 = p.vo / 4, u1 = u0 + 0.25, v1 = v0 + 0.25;
      UV[o] = u0; UV[o + 1] = v1; UV[o + 2] = p.layer;
      UV[o + 3] = u1; UV[o + 4] = v1; UV[o + 5] = p.layer;
      UV[o + 6] = u1; UV[o + 7] = v0; UV[o + 8] = p.layer;
      UV[o + 9] = u0; UV[o + 10] = v0; UV[o + 11] = p.layer;
      for (let k = 0; k < 4; k++) { C[o + k * 3] = p.r; C[o + k * 3 + 1] = p.g; C[o + k * 3 + 2] = p.b; }
    }
    const g = this.geo;
    g.setDrawRange(0, n * 6);
    if (n) {
      for (const nm of ['position', 'aUv', 'aCol']) { const a = g.attributes[nm]; a.clearUpdateRanges(); a.addUpdateRange(0, n * 12); a.needsUpdate = true; }
    }
    this.mesh.visible = n > 0;
  }
}
