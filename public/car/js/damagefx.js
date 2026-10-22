// What a crash throws about: glass cubes from tempered windows, plastic shards from lamps, sparks where metal drags
// on stone, steam and smoke from a broken engine, and the parts that come off (bumpers, mirrors, wheels, doors) as
// rigid bodies that bounce, slide and lie on the road. Everything is pooled: the glass and shards are one
// InstancedMesh each, the sparks one LineSegments, the smoke one instanced billboard mesh, all made once (so their
// shaders are built with the rest of the scene during loading) and costing nothing while nothing is happening.
import * as THREE from 'three';

const G = 9.81;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _m3 = new THREE.Matrix3(), _m3b = new THREE.Matrix3(), _col = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------------------------------------------------
// small pieces (glass cubes, plastic shards): a ring of instances with simple ballistics and one ground height each

class Bits {
  constructor(parent, geometry, material, max, { colors = false } = {}) {
    this.max = max;
    const im = this.mesh = new THREE.InstancedMesh(geometry, material, max);
    im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colors) { for (let i = 0; i < max; i++) im.setColorAt(i, _col.setRGB(1, 1, 1)); im.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    parent.add(im);
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.ax = new Float32Array(max * 3);
    this.ang = new Float32Array(max); this.spin = new Float32Array(max); this.sc = new Float32Array(max * 3);
    this.gy = new Float32Array(max); this.live = new Uint8Array(max); this.rest = new Float32Array(max);
    this.next = 0; this.active = 0; this.used = 0;
  }
  // one piece at p (in the mesh's parent frame), moving at v, landing on y = gy
  add(px, py, pz, vx, vy, vz, gy, size, color) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    if (this.live[i] !== 1) this.active++;
    this.live[i] = 1; this.rest[i] = 0;
    const p = this.p, v = this.v, k = i * 3;
    p[k] = px; p[k + 1] = py; p[k + 2] = pz; v[k] = vx; v[k + 1] = vy; v[k + 2] = vz;
    _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.ax[k] = _v.x; this.ax[k + 1] = _v.y; this.ax[k + 2] = _v.z;
    this.ang[i] = Math.random() * 6.28; this.spin[i] = rnd(8, 30) * (Math.random() < 0.5 ? -1 : 1);
    const s = size;
    this.sc[k] = s * rnd(0.7, 1.3); this.sc[k + 1] = s * rnd(0.6, 1.2); this.sc[k + 2] = s * rnd(0.7, 1.3);
    this.gy[i] = gy;
    if (color !== undefined && this.mesh.instanceColor) { this.mesh.setColorAt(i, _col.setHex(color)); this.mesh.instanceColor.needsUpdate = true; }
    this.used = Math.max(this.used, i + 1);
    this.mesh.count = this.used;
    this._write(i);
    return i;
  }
  _write(i) {
    const k = i * 3;
    _q.setFromAxisAngle(_v.set(this.ax[k], this.ax[k + 1], this.ax[k + 2]), this.ang[i]);
    _m.compose(_r.set(this.p[k], this.p[k + 1], this.p[k + 2]), _q, _s.set(this.sc[k], this.sc[k + 1], this.sc[k + 2]));
    this.mesh.setMatrixAt(i, _m);
  }
  update(dt) {
    if (!this.active) return;
    const p = this.p, v = this.v;
    let moved = false;
    for (let i = 0; i < this.used; i++) {
      if (this.live[i] !== 1) continue;
      const k = i * 3;
      v[k + 1] -= G * dt;
      // a little air drag: the smallest bits flutter
      const dr = Math.exp(-dt * 0.35);
      v[k] *= dr; v[k + 2] *= dr;
      p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
      this.ang[i] += this.spin[i] * dt;
      const gy = this.gy[i] + this.sc[k + 1] * 0.5;
      if (p[k + 1] < gy) {
        p[k + 1] = gy;
        if (v[k + 1] < -0.6) {
          // bounce, scatter a little sideways, lose most of the speed
          v[k + 1] = -v[k + 1] * rnd(0.15, 0.4);
          v[k] = v[k] * 0.55 + rnd(-0.4, 0.4); v[k + 2] = v[k + 2] * 0.55 + rnd(-0.4, 0.4);
          this.spin[i] *= 0.5;
        } else {
          // sliding on the road
          v[k + 1] = 0;
          const f = Math.exp(-dt * 7);
          v[k] *= f; v[k + 2] *= f; this.spin[i] *= f;
          if (v[k] * v[k] + v[k + 2] * v[k + 2] < 0.004) {
            this.live[i] = 2; this.active--;
            // lie flat-ish: a random turn about the vertical
            this.ax[k] = Math.random() * 0.3; this.ax[k + 1] = 1; this.ax[k + 2] = Math.random() * 0.3;
            const l = Math.hypot(this.ax[k], 1, this.ax[k + 2]); this.ax[k] /= l; this.ax[k + 1] /= l; this.ax[k + 2] /= l;
          }
        }
      }
      this._write(i);
      moved = true;
    }
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.live.fill(0); this.active = 0; this.used = 0; this.next = 0; this.mesh.count = 0; }
  // drop pieces lying far from (x, z), so the pool's ring keeps the ones near the player
  forgetFar(x, z, r) {
    let any = false;
    for (let i = 0; i < this.used; i++) {
      if (!this.live[i]) continue;
      const k = i * 3, dx = this.p[k] - x, dz = this.p[k + 2] - z;
      if (dx * dx + dz * dz > r * r) { if (this.live[i] === 1) this.active--; this.live[i] = 0; this.sc[k] = this.sc[k + 1] = this.sc[k + 2] = 0; this._write(i); any = true; }
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------------------
// sparks: bright streaks (a line from where the spark is to where it was a moment ago), white to orange to red

class Sparks {
  constructor(parent, max = 700) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 6); this.col = new Float32Array(max * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    m.name = 'damage_sparks';
    this.mesh = new THREE.LineSegments(g, m); this.mesh.frustumCulled = false; this.mesh.name = 'sparks';
    parent.add(this.mesh);
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.life0 = new Float32Array(max); this.gy = new Float32Array(max);
    this.n = 0; this.next = 0;
  }
  add(px, py, pz, vx, vy, vz, gy, life) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    const k = i * 3;
    this.p[k] = px; this.p[k + 1] = py; this.p[k + 2] = pz; this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
    this.life[i] = this.life0[i] = life; this.gy[i] = gy;
    this.n = Math.max(this.n, i + 1);
  }
  update(dt) {
    if (!this.n) return;
    const p = this.p, v = this.v, P = this.pos, C = this.col;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3, o = i * 6;
      if (this.life[i] <= 0) { P[o] = P[o + 3] = P[o + 1] = P[o + 4] = P[o + 2] = P[o + 5] = 0; C[o] = C[o + 1] = C[o + 2] = C[o + 3] = C[o + 4] = C[o + 5] = 0; continue; }
      live++;
      this.life[i] -= dt;
      v[k + 1] -= G * dt;
      const dr = Math.exp(-dt * 1.2); v[k] *= dr; v[k + 2] *= dr;
      p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
      if (p[k + 1] < this.gy[i]) { p[k + 1] = this.gy[i]; v[k + 1] = Math.abs(v[k + 1]) * 0.35; v[k] *= 0.6; v[k + 2] *= 0.6; }
      // the streak: back along the velocity, as a camera's shutter sees a hot fleck
      const tail = 0.022;
      P[o] = p[k]; P[o + 1] = p[k + 1]; P[o + 2] = p[k + 2];
      P[o + 3] = p[k] - v[k] * tail; P[o + 4] = p[k + 1] - v[k + 1] * tail; P[o + 5] = p[k + 2] - v[k + 2] * tail;
      const t = Math.max(0, this.life[i] / this.life0[i]);
      // hot white-yellow, cooling to orange and red
      const r = 4 * t + 0.8, gg = 3.2 * t * t + 0.25 * t, b = 1.6 * t * t * t;
      C[o] = r; C[o + 1] = gg; C[o + 2] = b; C[o + 3] = r * 0.5; C[o + 4] = gg * 0.35; C[o + 5] = b * 0.2;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.n * 2);
    if (!live) { this.n = 0; g.setDrawRange(0, 0); }
  }
  clear() { this.life.fill(0); this.n = 0; this.mesh.geometry.setDrawRange(0, 0); }
}

// ---------------------------------------------------------------------------------------------------------
// puffs: camera-facing soft billboards for steam, smoke and flames, one instanced draw per blending

let _puffTex = null;
function puffTexture() {
  if (_puffTex) return _puffTex;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true }), img = g.createImageData(S, S);
  // a soft blob with a billowy edge (a few octaves of value noise over a radial falloff)
  const N = 16, grid = []; for (let i = 0; i < (N + 1) * (N + 1); i++) grid.push(Math.random());
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, a = grid[(yi % N) * (N + 1) + xi % N], b = grid[(yi % N) * (N + 1) + (xi + 1) % N], cc = grid[((yi + 1) % N) * (N + 1) + xi % N], d = grid[((yi + 1) % N) * (N + 1) + (xi + 1) % N]; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, r = Math.hypot(u, v);
    const n = vn(x / S * 4, y / S * 4) * 0.55 + vn(x / S * 8, y / S * 8) * 0.3 + vn(x / S * 16, y / S * 16) * 0.15;
    const a = Math.max(0, 1 - r * (0.75 + n * 0.55)) ** 1.6;
    const k = (y * S + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(255 * Math.min(1, a * 1.4));
  }
  g.putImageData(img, 0, 0);
  _puffTex = new THREE.CanvasTexture(c);
  return _puffTex;
}

const PUFF_VS = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 iPos;
attribute vec4 iCol; // rgb, alpha
attribute vec2 iSR;  // size, rotation
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = position.xy + 0.5;
  vCol = iCol;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSR.y), s = sin(iSR.y);
  mv.xy += mat2(c, s, -s, c) * position.xy * iSR.x;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const PUFF_FS = `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  #include <logdepthbuf_fragment>
  float a = texture2D(uTex, vUv).a * vCol.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol.rgb, a);
}`;

class Puffs {
  constructor(parent, max, additive) {
    this.max = max;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iSR = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iCol', this.iCol); g.setAttribute('iSR', this.iSR);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      vertexShader: PUFF_VS, fragmentShader: PUFF_FS, uniforms: { uTex: { value: puffTexture() } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    m.name = additive ? 'damage_fire' : 'damage_smoke';
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    this.mesh.name = additive ? 'fire' : 'smoke';
    parent.add(this.mesh);
    this.list = [];
    this.additive = additive;
  }
  // kind: { r, g, b, a, size0, size1, life, rise, drag }
  add(x, y, z, vx, vy, vz, k) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ x, y, z, vx, vy, vz, t: 0, life: k.life * rnd(0.75, 1.25), k, rot: Math.random() * 6.28, spin: rnd(-0.6, 0.6) });
  }
  update(dt, wind) {
    const L = this.list;
    if (!L.length && !this.mesh.geometry.instanceCount) return;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.t += dt;
      if (p.t >= p.life) continue;
      const k = p.k, dr = Math.exp(-dt * (k.drag || 1.5));
      p.vx = p.vx * dr + wind.x * (1 - dr); p.vz = p.vz * dr + wind.z * (1 - dr);
      p.vy = p.vy * dr + (k.rise || 0) * (1 - dr);
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.spin * dt;
      L[j++] = p;
    }
    L.length = j;
    const P = this.iPos.array, C = this.iCol.array, S = this.iSR.array;
    for (let i = 0; i < j; i++) {
      const p = L[i], k = p.k, f = p.t / p.life;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      // fade in quickly, out slowly
      const a = k.a * Math.min(1, f * 6) * (1 - f) * (1 - f);
      const fl = this.additive ? 0.75 + 0.25 * Math.sin(p.t * 40 + p.rot * 7) : 1;
      C[i * 4] = k.r * fl; C[i * 4 + 1] = k.g * fl; C[i * 4 + 2] = k.b * fl; C[i * 4 + 3] = a;
      S[i * 2] = k.size0 + (k.size1 - k.size0) * Math.sqrt(f); S[i * 2 + 1] = p.rot;
    }
    this.iPos.needsUpdate = this.iCol.needsUpdate = this.iSR.needsUpdate = true;
    this.mesh.geometry.instanceCount = j;
  }
  clear() { this.list.length = 0; this.mesh.geometry.instanceCount = 0; }
}

export const PUFF = {
  steam: { r: 0.9, g: 0.91, b: 0.93, a: 0.22, size0: 0.15, size1: 1.1, life: 1.8, rise: 1.4, drag: 1.4 },
  smoke: { r: 0.16, g: 0.16, b: 0.17, a: 0.55, size0: 0.35, size1: 2.6, life: 3.5, rise: 1.2, drag: 0.9 },
  dust: { r: 0.55, g: 0.52, b: 0.47, a: 0.35, size0: 0.3, size1: 1.8, life: 1.4, rise: 0.25, drag: 2.5 },
  tyre: { r: 0.7, g: 0.7, b: 0.72, a: 0.25, size0: 0.25, size1: 1.4, life: 1.2, rise: 0.4, drag: 2 },
  fire: { r: 2.4, g: 0.85, b: 0.22, a: 0.85, size0: 0.55, size1: 0.15, life: 0.75, rise: 2.4, drag: 2.5 },
};

// ---------------------------------------------------------------------------------------------------------
// rigid debris: a part (a group of meshes) that came off. Corner points against the ground with impulses (bounce,
// sliding friction), so a bumper skids and settles flat, a mirror tumbles, a wheel rolls on its rim and falls over.

class Debris {
  constructor(obj, opts) {
    this.obj = obj;
    this.m = opts.mass || 10;
    this.v = (opts.v || new THREE.Vector3()).clone();
    this.w = (opts.w || new THREE.Vector3()).clone();
    // the part's box in its own frame (inertia and the corner points)
    const box = opts.box || new THREE.Box3().setFromObject(obj);
    const sz = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(0.05, 0.05, 0.05)), ctr = box.getCenter(new THREE.Vector3());
    // the centre of mass at the box's middle: re-centre the object's children on it
    this.com = ctr.clone();
    const m = this.m;
    this.Ib = new THREE.Vector3(m / 12 * (sz.y * sz.y + sz.z * sz.z), m / 12 * (sz.x * sz.x + sz.z * sz.z), m / 12 * (sz.x * sz.x + sz.y * sz.y));
    this.pts = opts.points || [];
    if (!this.pts.length) {
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) this.pts.push(new THREE.Vector3(x, y, z));
      // the middles of the long edges, so a long thin part lies along the road rather than on two corners
      const ax = sz.x >= sz.y && sz.x >= sz.z ? 'x' : sz.z >= sz.y ? 'z' : 'y';
      for (const a of [box.min, box.max]) for (const b of [box.min, box.max]) {
        const p = ctr.clone();
        if (ax === 'x') { p.y = a.y; p.z = b.z; } else if (ax === 'z') { p.x = a.x; p.y = b.y; } else { p.x = a.x; p.z = b.z; }
        this.pts.push(p);
      }
    }
    this.e = opts.bounce ?? 0.25; this.mu = opts.mu ?? 0.55;
    this.age = 0; this.still = 0; this.sleep = false; this.life = opts.life ?? 120;
    this.ground = opts.ground; this.gc = { x: NaN, z: NaN, h: 0 };
    // walls (buildings, poles): a circle about the middle, as wide as the part's smaller side
    this.walls = opts.walls || null; this.rW = Math.min(0.45, Math.max(0.12, Math.min(sz.x, sz.z) / 2));
    this.onHit = opts.onHit || null;
    this.kind = opts.kind || 'part';
  }
  groundAt(x, z, y) {
    const c = this.gc;
    if (Math.abs(x - c.x) > 0.3 || Math.abs(z - c.z) > 0.3 || !Number.isFinite(c.h)) {
      const h = this.ground ? this.ground(x, z, y + 1) : null;
      c.x = x; c.z = z; c.h = h === null || h === undefined || !Number.isFinite(h) ? (Number.isFinite(c.h) ? c.h : y - 1) : h;
    }
    return c.h;
  }
  invI(out, x, y, z) {
    const q = this.obj.quaternion;
    _r.set(x, y, z).applyQuaternion(_q2.copy(q).invert());
    _r.set(_r.x / this.Ib.x, _r.y / this.Ib.y, _r.z / this.Ib.z).applyQuaternion(q);
    return out.copy(_r);
  }
  step(dt) {
    const o = this.obj;
    this.age += dt;
    if (this.sleep) return;
    this.v.y -= G * dt;
    // the centre of mass in the world
    const com = _c.copy(this.com).applyQuaternion(o.quaternion).add(o.position);
    com.addScaledVector(this.v, dt);
    const wl = this.w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_v.copy(this.w).divideScalar(wl), wl * dt); o.quaternion.premultiply(_q).normalize(); }
    // contacts
    let deep = 0, hit = 0;
    for (const p of this.pts) {
      const r = _r.copy(p).sub(this.com).applyQuaternion(o.quaternion);
      const wx = com.x + r.x, wy = com.y + r.y, wz = com.z + r.z;
      const h = this.groundAt(wx, wz, wy);
      const pen = h - wy;
      if (pen <= 0) continue;
      deep = Math.max(deep, pen);
      const rx = r.x, ry = r.y, rz = r.z;
      // velocity of the point
      const vx = this.v.x + this.w.y * rz - this.w.z * ry, vy = this.v.y + this.w.z * rx - this.w.x * rz, vz = this.v.z + this.w.x * ry - this.w.y * rx;
      if (vy >= 0) continue;
      hit = Math.max(hit, -vy);
      // normal impulse (ground normal straight up)
      const rn = _n.set(-rz, 0, rx); // r x (0,1,0)
      const k = 1 / this.m + (this.invI(_w, rn.x, rn.y, rn.z).cross(_v.set(rx, ry, rz))).y;
      const j = -(1 + (vy < -1 ? this.e : 0)) * vy / k;
      // friction against the sliding
      let tx = vx, tz = vz; const tl = Math.hypot(tx, tz);
      let jt = 0;
      if (tl > 1e-4) {
        tx /= tl; tz /= tl;
        const rt = _n.set(ry * tz, rz * tx - rx * tz, -ry * tx); // r x t
        const kt = 1 / this.m + _v.set(tx, 0, tz).dot(this.invI(_w, rt.x, rt.y, rt.z).cross(_s.set(rx, ry, rz)));
        jt = Math.min(this.mu * j, tl / kt);
      }
      const Jx = -tx * jt, Jy = j, Jz = -tz * jt;
      this.v.x += Jx / this.m; this.v.y += Jy / this.m; this.v.z += Jz / this.m;
      // w += I^-1 (r x J)
      this.invI(_w, ry * Jz - rz * Jy, rz * Jx - rx * Jz, rx * Jy - ry * Jx);
      this.w.add(_w);
    }
    if (deep > 0) {
      com.y += Math.min(deep, 0.2);
      // rolling and air resistance
      this.w.multiplyScalar(Math.exp(-dt * 0.8));
    }
    this.w.multiplyScalar(Math.exp(-dt * 0.15));
    if (hit > 2 && this.onHit) this.onHit(this, hit);
    // out of any wall it went into, bouncing off it
    if (this.walls) {
      const cs = this.walls(com.x, com.z, this.rW, com.y);
      if (cs) for (const c of cs) {
        if (!(c.depth > 0)) continue;
        com.x += c.nx * c.depth; com.z += c.nz * c.depth;
        const vn = this.v.x * c.nx + this.v.z * c.nz;
        if (vn < 0) { this.v.x -= (1 + this.e) * vn * c.nx; this.v.z -= (1 + this.e) * vn * c.nz; this.v.multiplyScalar(0.8); this.w.multiplyScalar(0.7); }
      }
    }
    o.position.copy(com).sub(_r.copy(this.com).applyQuaternion(o.quaternion));
    o.updateMatrixWorld();
    // asleep once at rest a moment
    if (deep > 0 && this.v.lengthSq() < 0.01 && this.w.lengthSq() < 0.03) this.still += dt; else this.still = 0;
    if (this.still > 0.6 || this.age > 40) { this.sleep = true; this.v.set(0, 0, 0); this.w.set(0, 0, 0); }
  }
}

// ---------------------------------------------------------------------------------------------------------
// sounds of a crash, made in the browser like the rest of the car's sound (sound.js): a crunch of metal, glass
// breaking, a scrape that follows the contact, the tinkle of bits landing

class CrashSound {
  constructor(carSound) { this.cs = carSound; this.scrapeG = null; this.lastGlass = 0; this.lastCrunch = 0; }
  get ctx() { return this.cs && this.cs.ctx; }
  noise(sec) {
    const c = this.ctx; if (!this.buf || this.buf.sampleRate !== c.sampleRate) {
      const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.buf = b;
    }
    return this.buf;
  }
  out() { return this.cs.master || this.ctx.destination; }
  crunch(e) {
    const c = this.ctx; if (!c) return;
    const now = performance.now(); if (now - this.lastCrunch < 90) return; this.lastCrunch = now;
    const t = c.currentTime, k = Math.min(1, e);
    // a crumpling burst: noise through a falling band pass, and a few metallic rings
    const n = c.createBufferSource(); n.buffer = this.noise(); n.playbackRate.value = 0.7 + Math.random() * 0.3;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2600, t); bp.frequency.exponentialRampToValueAtTime(320, t + 0.35);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * k + 0.05, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + 0.4 * k);
    n.connect(bp); bp.connect(g); g.connect(this.out()); n.start(t, Math.random()); n.stop(t + 1);
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 300 + Math.random() * 1400;
      const og = c.createGain(); const d = 0.15 + Math.random() * 0.3;
      og.gain.setValueAtTime(0.06 * k, t + i * 0.02); og.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(og); og.connect(this.out()); o.start(t + i * 0.02); o.stop(t + d + 0.05);
    }
  }
  glass(k = 1) {
    const c = this.ctx; if (!c) return;
    const now = performance.now(); if (now - this.lastGlass < 60) return; this.lastGlass = now;
    const t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noise();
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
    const g = c.createGain(); g.gain.setValueAtTime(0.5 * k, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    n.connect(hp); hp.connect(g); g.connect(this.out()); n.start(t, Math.random()); n.stop(t + 0.6);
    // tinkles: short high pings over the next half second, the bits landing
    for (let i = 0; i < 14; i++) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 3500 + Math.random() * 5000;
      const og = c.createGain(), t0 = t + 0.05 + Math.random() * 0.7;
      og.gain.setValueAtTime(0.0001, t); og.gain.setValueAtTime(0.03 * k, t0); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      o.connect(og); og.connect(this.out()); o.start(t); o.stop(t0 + 0.08);
    }
  }
  // level 0..1, held while scraping; hard: metal on stone (brighter) or plastic (duller)
  scrape(level, hard = 1) {
    const c = this.ctx; if (!c) return;
    if (!this.scrapeG && level < 0.01) return;
    if (!this.scrapeG) {
      const n = c.createBufferSource(); n.buffer = this.noise(); n.loop = true;
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 1.4;
      const bp2 = c.createBiquadFilter(); bp2.type = 'peaking'; bp2.frequency.value = 4800; bp2.gain.value = 8; bp2.Q.value = 3;
      const g = c.createGain(); g.gain.value = 0;
      n.connect(bp); bp.connect(bp2); bp2.connect(g); g.connect(this.out()); n.start();
      this.scrapeG = g; this.scrapeF = bp;
    }
    const t = c.currentTime;
    this.scrapeG.gain.setTargetAtTime(Math.min(0.5, level * 0.5), t, level > 0 ? 0.03 : 0.12);
    this.scrapeF.frequency.setTargetAtTime(hard ? 1700 + level * 1800 : 700 + level * 600, t, 0.05);
  }
}

// ---------------------------------------------------------------------------------------------------------

export class FX {
  constructor(scene, opts = {}) {
    this.scene = scene;
    const grp = this.group = new THREE.Group(); grp.name = 'damage_fx'; scene.add(grp);
    // tempered glass: small cubes with sharp shiny faces (they glitter in the sun)
    const cube = new THREE.BoxGeometry(1, 1, 1);
    const glassMat = new THREE.MeshStandardMaterial({ name: 'damage_glassbits', color: 0xaecdc6, metalness: 0.2, roughness: 0.06, envMapIntensity: 2.2, transparent: true, opacity: 0.88 });
    this.glass = new Bits(grp, cube, glassMat, opts.glass || 4000);
    // plastic shards: thin wedges, coloured per piece (red, amber, clear lens plastic; black bumper plastic)
    const shard = new THREE.BufferGeometry();
    shard.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0.1, 0.5, -0.45, -0.1, -0.3, 0.5, 0, -0.4, 0, -0.1, 0.5, 0.5, 0.1, -0.4, -0.45, 0.1, -0.3]), 3));
    shard.setIndex([0, 1, 2, 3, 4, 5, 0, 3, 1, 1, 3, 5, 2, 1, 5, 2, 5, 4, 0, 2, 4, 0, 4, 3]);
    shard.computeVertexNormals();
    const shardMat = new THREE.MeshStandardMaterial({ name: 'damage_shards', color: 0xffffff, roughness: 0.25, metalness: 0.05, side: THREE.DoubleSide });
    this.shards = new Bits(grp, shard, shardMat, opts.shards || 1500, { colors: true });
    this.sparks = new Sparks(grp, opts.sparks || 700);
    this.smoke = new Puffs(grp, 220, false);
    this.fire = new Puffs(grp, 120, true);
    this.debris = [];
    this.emitters = [];
    this.wind = new THREE.Vector3(0.6, 0, 0.25);
    this.sound = new CrashSound(opts.sound);
    // the inside of a car gets its own small pool of cubes (they ride with it, on the seats and the floor)
    this.cabinMat = glassMat;
    this.cube = cube;
  }

  // a pool of glass cubes inside a car (parented to the car, so they ride with it)
  cabinBits(parent) {
    const b = new Bits(parent, this.cube, this.cabinMat, 500);
    b.mesh.name = 'cabin_glass';
    return b;
  }

  // a burst of glass cubes from points on a window (world positions, sampled by the caller)
  glassBurst(pts, vel, out, gy, n) {
    for (let i = 0; i < n; i++) {
      const p = pts[(Math.random() * pts.length) | 0];
      const s = rnd(0.5, 2.6);
      this.glass.add(p.x + rnd(-0.02, 0.02), p.y + rnd(-0.02, 0.02), p.z + rnd(-0.02, 0.02),
        vel.x * 0.85 + out.x * s + rnd(-0.6, 0.6), vel.y * 0.5 + out.y * s + rnd(-0.2, 1.4), vel.z * 0.85 + out.z * s + rnd(-0.6, 0.6),
        gy, rnd(0.006, 0.013));
    }
  }

  shardBurst(p, vel, out, gy, n, colors, size = 0.03) {
    for (let i = 0; i < n; i++) {
      const s = rnd(0.4, 1.8);
      this.shards.add(p.x + rnd(-0.06, 0.06), p.y + rnd(-0.04, 0.04), p.z + rnd(-0.06, 0.06),
        vel.x * 0.7 + out.x * s + rnd(-0.6, 0.6), vel.y * 0.4 + out.y * s + rnd(0, 1.2), vel.z * 0.7 + out.z * s + rnd(-0.6, 0.6),
        gy, size * rnd(0.4, 1.4), colors[(Math.random() * colors.length) | 0]);
    }
  }

  // sparks off a scraping contact: p the contact, vel the car's velocity there (they fly back from it), gy the ground
  sparkBurst(p, vel, n, gy, up = 1) {
    const sp = Math.hypot(vel.x, vel.z);
    for (let i = 0; i < n; i++) {
      const k = rnd(0.3, 1.0);
      this.sparks.add(p.x, p.y, p.z,
        -vel.x * k * 0.5 + rnd(-1.5, 1.5) * (1 + sp * 0.05), rnd(0.2, 2.6) * up, -vel.z * k * 0.5 + rnd(-1.5, 1.5) * (1 + sp * 0.05),
        gy, rnd(0.15, 0.55));
    }
  }

  puff(kind, x, y, z, vx = 0, vy = 0, vz = 0) {
    const k = PUFF[kind] || PUFF.smoke;
    (kind === 'fire' ? this.fire : this.smoke).add(x, y, z, vx, vy, vz, k);
  }

  // a source of steam, smoke or flames that follows a car: obj (its object), local (a point in the car's frame)
  emit(obj, local, kind, rate, seconds) {
    const e = this.emitters.find(e => e.obj === obj && e.kind === kind);
    if (e) { e.rate = Math.max(e.rate, rate); e.t = Math.max(e.t, seconds); e.local.copy(local); return e; }
    const n = { obj, local: local.clone(), kind, rate, t: seconds, acc: 0 };
    this.emitters.push(n);
    return n;
  }
  stopEmitters(obj) { this.emitters = this.emitters.filter(e => e.obj !== obj); }

  addDebris(obj, opts) {
    const d = new Debris(obj, opts);
    this.debris.push(d);
    // a budget: the oldest pieces go first
    while (this.debris.length > (opts.max || 40)) { const o = this.debris.shift(); this.removeDebris(o); }
    return d;
  }
  removeDebris(d) {
    if (d.obj.parent) d.obj.parent.remove(d.obj);
    d.obj.traverse(o => { if (o.isMesh && o.userData.dmgOwnGeo && o.geometry) o.geometry.dispose(); });
    if (d.onRemove) d.onRemove();
  }

  update(dt, camera, near) {
    if (dt <= 0) return;
    this.glass.update(dt); this.shards.update(dt); this.sparks.update(dt);
    // emitters
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t -= dt;
      if (e.t <= 0 || !e.obj.parent) { this.emitters.splice(i, 1); continue; }
      e.acc += e.rate * dt;
      if (e.acc < 1) continue;
      e.obj.updateWorldMatrix(true, false);
      _v.copy(e.local).applyMatrix4(e.obj.matrixWorld);
      while (e.acc >= 1) {
        e.acc -= 1;
        if (e.kind === 'fire') this.puff('fire', _v.x + rnd(-0.45, 0.45), _v.y + rnd(-0.05, 0.15), _v.z + rnd(-0.35, 0.35), rnd(-0.2, 0.2), rnd(0.6, 1.8), rnd(-0.2, 0.2));
        else this.puff(e.kind, _v.x + rnd(-0.15, 0.15), _v.y, _v.z + rnd(-0.15, 0.15), rnd(-0.3, 0.3), rnd(0.3, 1.0), rnd(-0.3, 0.3));
      }
    }
    this.smoke.update(dt, this.wind); this.fire.update(dt, this.wind);
    // debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.step(Math.min(dt, 1 / 30));
      const far = near && d.obj.position.distanceToSquared(near) > 300 * 300;
      if (far || d.age > d.life) { this.debris.splice(i, 1); this.removeDebris(d); }
    }
  }

  clear() {
    this.glass.clear(); this.shards.clear(); this.sparks.clear(); this.smoke.clear(); this.fire.clear();
    for (const d of this.debris) this.removeDebris(d);
    this.debris.length = 0; this.emitters.length = 0;
  }
}
