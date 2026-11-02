// What skis do to snow: the track map (a picture of the ground round the rider, red = how deep a groove is pressed,
// green = the snow pushed up beside it) drawn into by every ski on the snow, and the spray thrown off edges.
// The snow material (materials.js) reads the map for its relief. The map follows the rider: when they get far from
// its middle it is copied, shifted by whole texels, so the tracks behind stay.
import * as THREE from 'three';
import { snowUniforms } from './materials.js?v=1';
import { height, surface } from './terrain.js?v=1';

const STAMP_VS = `
attribute vec4 aSeg;    // groove depth, berm height, half width (m), unused
varying vec2 vUv; varying vec4 vSeg;
void main() { vUv = uv; vSeg = aSeg; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STAMP_FS = `
varying vec2 vUv; varying vec4 vSeg;
void main() {
  // vUv.x: -1..1 across the stamp (the berm runs out past the groove)
  float d = abs(vUv.x) * (vSeg.z + 0.12);
  float groove = vSeg.x * (1.0 - smoothstep(vSeg.z * 0.75, vSeg.z, d));
  float berm = vSeg.y * smoothstep(vSeg.z * 0.8, vSeg.z + 0.02, d) * (1.0 - smoothstep(vSeg.z + 0.03, vSeg.z + 0.12, d));
  gl_FragColor = vec4(groove, berm, 0.0, 1.0);
}`;
const COPY_FS = `
uniform sampler2D tSrc; uniform vec2 uShift; varying vec2 vUv;
void main() { vec2 uv = vUv + uShift; gl_FragColor = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture2D(tSrc, uv); }`;

export class Tracks {
  constructor(renderer, q) {
    this.r = renderer;
    const W = q.tier === 'low' ? 512 : 1024, H = W * 4;
    this.W = W; this.H = H;
    this.size = new THREE.Vector2(96, 384);
    const opt = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.rt = [new THREE.WebGLRenderTarget(W, H, opt), new THREE.WebGLRenderTarget(W, H, opt)];
    this.cur = 0;
    for (const t of this.rt) { renderer.setRenderTarget(t); renderer.setClearColor(0x000000, 0); renderer.clear(); }
    renderer.setRenderTarget(null);
    this.origin = new THREE.Vector2(-48, -60);
    snowUniforms.uTrack.value = this.rt[0].texture;
    snowUniforms.uTrackOrigin.value.copy(this.origin);
    snowUniforms.uTrackSize.value.copy(this.size);
    snowUniforms.uTrackTexel.value.set(1 / W, 1 / H);
    // stamps: up to 64 quads a frame, drawn with MAX blending
    this.N = 64;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.N * 4 * 3); this.uv = new Float32Array(this.N * 4 * 2); this.seg = new Float32Array(this.N * 4 * 4);
    const idx = []; for (let i = 0; i < this.N; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2)); g.setAttribute('aSeg', new THREE.BufferAttribute(this.seg, 4));
    g.setIndex(idx);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({ vertexShader: STAMP_VS, fragmentShader: STAMP_FS, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.copyMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uShift: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: COPY_FS, depthTest: false, depthWrite: false });
    this.copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat); this.copyQuad.frustumCulled = false;
    this.copyScene = new THREE.Scene(); this.copyScene.add(this.copyQuad);
    this.n = 0;
    this.last = new Map();     // per ski: the last stamped point
  }
  // keep the rider inside the map: x in its middle, z a quarter from its top (more room behind)
  follow(p) {
    const wantX = p.x - this.size.x / 2, wantZ = p.z - this.size.y * 0.3;
    const dx = wantX - this.origin.x, dz = wantZ - this.origin.y;
    if (Math.abs(dx) < this.size.x * 0.22 && Math.abs(dz) < this.size.y * 0.18) return;
    const tx = Math.round(dx / this.size.x * this.W), tz = Math.round(dz / this.size.y * this.H);
    if (!tx && !tz) return;
    const src = this.rt[this.cur], dst = this.rt[1 - this.cur];
    this.copyMat.uniforms.tSrc.value = src.texture; this.copyMat.uniforms.uShift.value.set(tx / this.W, tz / this.H);
    this.r.setRenderTarget(dst); this.r.render(this.copyScene, this.cam); this.r.setRenderTarget(null);
    this.cur = 1 - this.cur;
    this.origin.x += tx / this.W * this.size.x; this.origin.y += tz / this.H * this.size.y;
    snowUniforms.uTrack.value = this.rt[this.cur].texture;
    snowUniforms.uTrackOrigin.value.copy(this.origin);
  }
  // a groove from a to b (world points on the snow), half width hw, depth and berm 0..1
  stamp(ax, az, bx, bz, hw, depth, berm) {
    if (this.n >= this.N) return;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 1e-4) return;
    const nx = -dz / L, nz = dx / L, w = hw + 0.12;
    const toU = (x, z, o) => { this.pos[o] = (x - this.origin.x) / this.size.x; this.pos[o + 1] = (z - this.origin.y) / this.size.y; this.pos[o + 2] = 0; };
    const i = this.n * 4;
    toU(ax + nx * w, az + nz * w, i * 3); toU(ax - nx * w, az - nz * w, (i + 1) * 3);
    toU(bx + nx * w, bz + nz * w, (i + 2) * 3); toU(bx - nx * w, bz - nz * w, (i + 3) * 3);
    const uv = [-1, 0, 1, 0, -1, 1, 1, 1]; for (let k = 0; k < 8; k++) this.uv[i * 2 + k] = uv[k];
    for (let k = 0; k < 4; k++) { const o = (i + k) * 4; this.seg[o] = depth; this.seg[o + 1] = berm; this.seg[o + 2] = hw; this.seg[o + 3] = 0; }
    this.n++;
  }
  // every ski on the snow leaves a groove: narrow and sharp when carving, broad and shallow when skidding, deep in powder
  fromSkier(sk, rig) {
    if (!rig.ready) return;
    const onSnow = sk.state === 'ground' || (sk.state === 'crash' && sk.p.y < height(sk.p.x, sk.p.z) + 0.15);
    for (const [key, ski] of [['L', rig.skiL], ['R', rig.skiR]]) {
      const c = ski.position;
      const last = this.last.get(key);
      if (!onSnow) { this.last.delete(key); continue; }
      if (last && (Math.hypot(c.x - last.x, c.z - last.z) < 0.08)) continue;
      if (last && Math.hypot(c.x - last.x, c.z - last.z) < 4) {
        const surf = surface(c.x, c.z), powder = surf === 1;
        // how far the ski is turned across its travel
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(ski.quaternion);
        const tx = c.x - last.x, tz = c.z - last.z, tl = Math.hypot(tx, tz);
        const across = Math.abs(fwd.x * tz - fwd.z * tx) / (tl || 1);
        const hw = 0.05 + across * 0.75 + (powder ? 0.06 : 0);
        const depth = sk.state === 'crash' ? 0.9 : powder ? 1.0 : 0.32 + Math.abs(sk.edge) * 0.25 - across * 0.18;
        const berm = powder ? 0.9 : 0.35 + Math.abs(sk.edge) * 0.4;
        this.stamp(last.x, last.z, c.x, c.z, hw, Math.max(0.12, depth), berm);
      }
      this.last.set(key, c.clone());
    }
  }
  flush() {
    if (!this.n) return;
    for (let i = this.n * 4; i < this.N * 4; i++) { this.pos[i * 3] = -10; this.pos[i * 3 + 1] = -10; }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.aSeg.needsUpdate = true;
    this.geo.setDrawRange(0, this.n * 6);
    const ac = this.r.autoClear; this.r.autoClear = false;
    this.r.setRenderTarget(this.rt[this.cur]); this.r.render(this.scene, this.cam); this.r.setRenderTarget(null);
    this.r.autoClear = ac;
    this.n = 0;
  }
}

// ---- spray -------------------------------------------------------------------------------------------------------------
const SPRAY_VS = `
attribute vec4 aLife;   // age, life, size, sparkle seed
varying float vA; varying float vS;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float t = aLife.x / max(aLife.y, 0.001);
  vA = (1.0 - t) * smoothstep(0.0, 0.08, t) * step(aLife.x, aLife.y);
  vS = aLife.w;
  gl_PointSize = aLife.z * (0.6 + t * 1.4) * uScale / max(0.3, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const SPRAY_FS = `
varying float vA; varying float vS;
uniform vec3 uSun; uniform float uTime;
void main() {
  vec2 c = gl_PointCoord - 0.5; float r = length(c);
  float a = smoothstep(0.5, 0.15, r) * vA * 0.75;
  if (a < 0.01) discard;
  float glint = step(0.93, fract(vS * 13.7 + uTime * 3.1)) * smoothstep(0.2, 0.0, r);
  vec3 col = vec3(0.92, 0.95, 1.0) * (0.75 + 0.35 * uSun.y) + glint * 1.5;
  gl_FragColor = vec4(col, a);
}`;
export class Spray {
  constructor(scene, q) {
    this.N = q.tier === 'low' ? 260 : q.tier === 'medium' ? 600 : 1000;
    const g = new THREE.BufferGeometry();
    this.p = new Float32Array(this.N * 3); this.v = new Float32Array(this.N * 3); this.life = new Float32Array(this.N * 4);
    for (let i = 0; i < this.N; i++) this.life[i * 4] = 99;
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 4));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 300 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 } },
      vertexShader: SPRAY_VS, fragmentShader: SPRAY_FS, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    this.k = 0; this.acc = 0;
  }
  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.k; this.k = (this.k + 1) % this.N;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i * 4] = 0; this.life[i * 4 + 1] = life; this.life[i * 4 + 2] = size; this.life[i * 4 + 3] = Math.random();
  }
  fromSkier(sk, rig, dt) {
    if (!rig.ready) return;
    const sp = sk.v.length();
    let rate = 0;
    const powder = sk.surf === 1;
    if (sk.state === 'ground') {
      rate = sk.slide * 40 + (Math.abs(sk.edge) > 0.45 && sp > 8 ? sp * 3 : 0) + (powder && sp > 3 ? sp * 9 : 0);
      if (sk.brake > 0.3) rate += sp * 30;
    }
    if (sk.state === 'crash' && sp > 1) rate = sp * 25;
    this.acc += rate * dt;
    while (this.acc > 1) {
      this.acc--;
      const ski = Math.random() < 0.5 ? rig.skiL : rig.skiR;
      const t = (Math.random() - 0.3) * 0.8;
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(ski.quaternion);
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(ski.quaternion);
      // thrown off the outside of the turn (the side the skis slide towards)
      const vr = sk.v.clone().normalize();
      const out = Math.sign(side.dot(vr)) || 1;
      const p = ski.position.clone().addScaledVector(fwd, t).addScaledVector(side, out * 0.06);
      const k = 0.35 + Math.random() * 0.5;
      this.emit(p.x, p.y + 0.03, p.z,
        sk.v.x * k + side.x * out * (1 + Math.random() * 2.5) + (Math.random() - 0.5),
        1.2 + Math.random() * (powder ? 3.2 : 2.0),
        sk.v.z * k + side.z * out * (1 + Math.random() * 2.5) + (Math.random() - 0.5),
        powder ? 0.28 + Math.random() * 0.3 : 0.12 + Math.random() * 0.16, 0.5 + Math.random() * (powder ? 1.1 : 0.6));
    }
  }
  burst(p, n, power) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = power * (0.4 + Math.random()); this.emit(p.x, p.y + 0.05, p.z, Math.cos(a) * s, 0.8 + Math.random() * power * 0.9, Math.sin(a) * s, 0.25 + Math.random() * 0.35, 0.7 + Math.random() * 0.9); }
  }
  update(dt, time) {
    for (let i = 0; i < this.N; i++) {
      const l = this.life[i * 4]; if (l > this.life[i * 4 + 1]) continue;
      this.life[i * 4] = l + dt;
      const o = i * 3;
      this.v[o + 1] -= 9.81 * dt * 0.55;
      const d = Math.max(0, 1 - dt * 2.2); this.v[o] *= d; this.v[o + 1] *= d; this.v[o + 2] *= d;
      this.p[o] += this.v[o] * dt; this.p[o + 1] += this.v[o + 1] * dt; this.p[o + 2] += this.v[o + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.aLife.needsUpdate = true;
    this.mat.uniforms.uTime.value = time;
  }
}
