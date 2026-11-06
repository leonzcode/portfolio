// What skis do to snow: the track map (a picture of the ground round the rider, red = how deep a groove is pressed,
// green = the snow pushed up beside it, blue = snow scraped smooth) drawn into by every ski (or the board) on the snow,
// and the spray thrown off edges. The snow material (materials.js) reads the map for its relief. The map follows the
// rider: when they get far from its middle it is copied, shifted by whole texels, so the tracks behind stay. A second,
// coarse map covers the whole run and keeps every track (so you see your lines from the chairlift and on the next run);
// the fine map fills what it uncovers from it.
// The tracks follow what real skis leave: a carving edge cuts a narrow, sharp-walled line with the snow it pushes heaped
// on the outside of the turn; a skid scrapes a wide, shallow, smoothed band with a ridge of loose snow along its far side;
// powder takes a deep soft trench; ice barely a scratch (env.js's snow kinds).
import * as THREE from 'three';
import { snowUniforms } from './materials.js?v=16';
import { height, surface } from './terrain.js?v=16';
import { snowKind, SNOW } from './env.js?v=16';
const SNOW_POWDER = SNOW.powder, SNOW_SPRING = SNOW.spring, SNOW_ICE = SNOW.ice;

// a stamp's corners are its centre line's ends (world x, z) pushed out across it here, at least uMinW either side so a
// narrow line still covers a texel of a coarse map; there the groove is widened to the texel and made shallower
const STAMP_VS = `
attribute vec4 aSeg;    // groove depth, berm height, half width (m), which side the berm is on (-1..1, 0 both)
attribute vec3 aSeg2;   // sharpness of the walls (0 soft U .. 1 sharp), how much is scraped smooth, berm width (m)
attribute vec3 aN;      // the unit across the line (x, z) and which side this corner is (-1 or +1)
uniform vec2 uMinW;     // the least half-texel-and-more a stamp covers in this map: across (x) and along (z) metres
varying vec2 vUv; varying vec4 vSeg; varying vec3 vSeg2;
void main() {
  vSeg = aSeg; vSeg2 = aSeg2;
  float hw = max(aSeg.z, uMinW.x * 0.5), w = hw + max(aSeg2.z, uMinW.x * 0.5);
  vSeg.x *= mix(1.0, aSeg.z / hw, 0.6); vSeg.z = hw; vSeg2.z = w - hw;
  vUv = vec2(aN.z, uv.y);
  // (and its ends pushed out along the line by half of uMinW, so short pieces join up in a coarse map's long texels)
  vec2 along = vec2(-aN.y, aN.x) * (uv.y * 2.0 - 1.0) * uMinW.y * 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(position.x + aN.x * aN.z * w + along.x, position.z + aN.y * aN.z * w + along.y, 0.0, 1.0);
}`;
const STAMP_FS = `
varying vec2 vUv; varying vec4 vSeg; varying vec3 vSeg2;
void main() {
  // vUv.x: -1..1 across the stamp (the berm runs out past the groove)
  float hw = vSeg.z, bw = vSeg2.z, a = vUv.x * (hw + bw), d = abs(a);
  float u = clamp(d / hw, 0.0, 1.0);
  // the groove's floor: a soft U in deep snow, a flat floor with steep walls where an edge cut it
  float groove = vSeg.x * mix(1.0 - u * u, 1.0 - smoothstep(0.72, 1.0, u), vSeg2.x) * step(d, hw);
  // the snow pushed out, heaped beside the groove (on one side or both)
  float side = vSeg.w == 0.0 ? 1.0 : clamp(1.0 + vSeg.w * sign(a), 0.0, 2.0) * 0.6;
  float t = (d - hw * 0.9) / bw;
  float berm = vSeg.y * side * smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.35, 1.0, t));
  gl_FragColor = vec4(groove, berm, vSeg2.y * step(d, hw), 1.0);
}`;
// the fine map moved on: what it still covers is copied over, what it uncovers comes from the coarse map
const COPY_FS = `
uniform sampler2D tSrc; uniform sampler2D tCoarse; uniform vec2 uShift; uniform vec2 uOrigin; uniform vec2 uSize; uniform vec2 uO2; uniform vec2 uS2; varying vec2 vUv;
void main() {
  vec2 uv = vUv + uShift;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    vec2 c = (uOrigin + vUv * uSize - uO2) / uS2;
    gl_FragColor = (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0) ? vec4(0.0) : texture2D(tCoarse, c);
  } else gl_FragColor = texture2D(tSrc, uv);
}`;

export class Tracks {
  constructor(renderer, q) {
    this.r = renderer;
    const W = q.tier === 'low' ? 512 : 1024, H = W * 4;
    this.W = W; this.H = H;
    // 48 x 192 m round the rider: a texel is 4.7 cm (9.4 on the low tier), fine enough for a carving edge's line
    this.size = new THREE.Vector2(48, 192);
    const opt = { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.rt = [new THREE.WebGLRenderTarget(W, H, opt), new THREE.WebGLRenderTarget(W, H, opt)];
    this.cur = 0;
    for (const t of this.rt) { renderer.setRenderTarget(t); renderer.setClearColor(0x000000, 0); renderer.clear(); }
    renderer.setRenderTarget(null);
    this.origin = new THREE.Vector2(-24, -60);
    snowUniforms.uTrack.value = this.rt[0].texture;
    snowUniforms.uTrackOrigin.value.copy(this.origin);
    snowUniforms.uTrackSize.value.copy(this.size);
    snowUniforms.uTrackTexel.value.set(1 / W, 1 / H);
    // the coarse map: 160 x 1620 m over the whole run, 31 x 40 cm texels (31 x 79 on the low tier); it never moves
    const CW = 512, CH = q.tier === 'low' ? 2048 : 4096;
    this.o2 = new THREE.Vector2(-80, -100); this.s2 = new THREE.Vector2(160, 1620);
    this.rt2 = new THREE.WebGLRenderTarget(CW, CH, opt);
    renderer.setRenderTarget(this.rt2); renderer.clear(); renderer.setRenderTarget(null);
    snowUniforms.uTrack2.value = this.rt2.texture;
    snowUniforms.uTrack2Origin.value.copy(this.o2); snowUniforms.uTrack2Size.value.copy(this.s2); snowUniforms.uTrack2Texel.value.set(1 / CW, 1 / CH);
    this.minW = [new THREE.Vector2(1.4 * this.size.x / W, 1.4 * this.size.y / H), new THREE.Vector2(1.2 * this.s2.x / CW, 1.2 * this.s2.y / CH)];
    // stamps: up to 64 quads a frame, drawn with MAX blending
    this.N = 64;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.N * 4 * 3); this.uv = new Float32Array(this.N * 4 * 2); this.seg = new Float32Array(this.N * 4 * 4); this.seg2 = new Float32Array(this.N * 4 * 3); this.nrm = new Float32Array(this.N * 4 * 3);
    const idx = []; for (let i = 0; i < this.N; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2)); g.setAttribute('aSeg', new THREE.BufferAttribute(this.seg, 4)); g.setAttribute('aSeg2', new THREE.BufferAttribute(this.seg2, 3)); g.setAttribute('aN', new THREE.BufferAttribute(this.nrm, 3));
    g.setIndex(idx);
    this.geo = g;
    this.minWU = { value: this.minW[0] };
    const mat = new THREE.ShaderMaterial({ uniforms: { uMinW: this.minWU }, vertexShader: STAMP_VS, fragmentShader: STAMP_FS, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    // the stamps are drawn in world x, z through a camera over each map
    this.cam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
    this.camF = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10); this.placeCam();
    this.cam2 = new THREE.OrthographicCamera(this.o2.x, this.o2.x + this.s2.x, this.o2.y + this.s2.y, this.o2.y, -10, 10); this.cam2.updateMatrixWorld();
    this.copyMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, tCoarse: { value: this.rt2.texture }, uShift: { value: new THREE.Vector2() }, uOrigin: { value: new THREE.Vector2() }, uSize: { value: this.size }, uO2: { value: this.o2 }, uS2: { value: this.s2 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: COPY_FS, depthTest: false, depthWrite: false });
    this.copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat); this.copyQuad.frustumCulled = false;
    this.copyScene = new THREE.Scene(); this.copyScene.add(this.copyQuad);
    // the stamp and copy shaders draw only into the maps: build them now (with a map bound, as they are drawn), not in
    // the first frame that leaves a track
    renderer.setRenderTarget(this.rt2); renderer.compile(this.scene, this.cam2); renderer.compile(this.copyScene, this.cam); renderer.setRenderTarget(null);
    this.n = 0;
    this.last = new Map();     // per ski: the last stamped point
    this._f = new THREE.Vector3();
  }
  placeCam() {
    const c = this.camF; c.left = this.origin.x; c.right = this.origin.x + this.size.x; c.bottom = this.origin.y; c.top = this.origin.y + this.size.y;
    c.updateProjectionMatrix(); c.updateMatrixWorld();
  }
  // keep the rider inside the map: x in its middle, z a quarter from its top (more room behind)
  follow(p) {
    const wantX = p.x - this.size.x / 2, wantZ = p.z - this.size.y * 0.3;
    const dx = wantX - this.origin.x, dz = wantZ - this.origin.y;
    if (Math.abs(dx) < this.size.x * 0.22 && Math.abs(dz) < this.size.y * 0.18) return;
    const tx = Math.round(dx / this.size.x * this.W), tz = Math.round(dz / this.size.y * this.H);
    if (!tx && !tz) return;
    const src = this.rt[this.cur], dst = this.rt[1 - this.cur];
    this.origin.x += tx / this.W * this.size.x; this.origin.y += tz / this.H * this.size.y;
    this.copyMat.uniforms.tSrc.value = src.texture; this.copyMat.uniforms.uShift.value.set(tx / this.W, tz / this.H); this.copyMat.uniforms.uOrigin.value.copy(this.origin);
    this.r.setRenderTarget(dst); this.r.render(this.copyScene, this.cam); this.r.setRenderTarget(null);
    this.cur = 1 - this.cur;
    snowUniforms.uTrack.value = this.rt[this.cur].texture;
    snowUniforms.uTrackOrigin.value.copy(this.origin);
    this.placeCam();
  }
  // a groove from a to b (world points on the snow), half width hw, depth and berm 0..1; side: which side the berm is
  // heaped on (+1 the left of the way from a to b, -1 the right, 0 both); sharp 0..1; scrape 0..1 smoothed; bw the berm's width (m)
  stamp(ax, az, bx, bz, hw, depth, berm, side = 0, sharp = 1, scrape = 0, bw = 0.12) {
    if (this.n >= this.N) return;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 1e-4) return;
    const nx = -dz / L, nz = dx / L;
    const i = this.n * 4, P = this.pos, NN = this.nrm;
    // corners: a, a, b, b (the shader pushes them out across the line: side -1 is +n, as the old corners were)
    for (let k = 0; k < 4; k++) {
      const o = (i + k) * 3, atB = k >= 2, sd = k & 1 ? 1 : -1;
      P[o] = atB ? bx : ax; P[o + 1] = 0; P[o + 2] = atB ? bz : az;
      NN[o] = -nx; NN[o + 1] = -nz; NN[o + 2] = sd;
    }
    const uv = [-1, 0, 1, 0, -1, 1, 1, 1]; for (let k = 0; k < 8; k++) this.uv[i * 2 + k] = uv[k];
    for (let k = 0; k < 4; k++) {
      const o = (i + k) * 4; this.seg[o] = depth; this.seg[o + 1] = berm; this.seg[o + 2] = hw; this.seg[o + 3] = side;
      const o2 = (i + k) * 3; this.seg2[o2] = sharp; this.seg2[o2 + 1] = scrape; this.seg2[o2 + 2] = bw;
    }
    this.n++;
  }
  // every ski on the snow (or the board) leaves a track: narrow and sharp when carving, broad, shallow and scraped smooth
  // when skidding, a deep soft trench in powder; how deep and wide follows the snow kind (env.js)
  fromSkier(sk, rig) {
    if (!rig.ready) return;
    const onSnow = sk.state === 'ground' || (sk.state === 'crash' && sk.p.y < height(sk.p.x, sk.p.z) + 0.15);
    const K = sk.K || {}, one = K.tracks === 1 || rig.skiL === rig.skiR, T = snowKind().track;
    const turn = sk.turnRate || 0, edge = Math.abs(sk.edge || 0), sink = sk.sink || 0;
    // (P: a ride with its own track points (the snow scooter's two boards, the snowbike's skis and foot skis, the sled's
    // runners) lists them in rig.tracks: children of rig.root placed where each meets the snow, userData.hw its half width)
    const list = rig.tracks || null, nT = list ? list.length : one ? 1 : 2;
    for (let i = 0; i < nT; i++) {
      const key = list ? 'T' + i : i ? 'R' : 'L', ski = list ? list[i] : i ? rig.skiR : rig.skiL;
      if (!ski) continue;
      const c = ski.position;
      const last = this.last.get(key);
      if (!onSnow) { this.last.delete(key); continue; }
      if (last && (Math.hypot(c.x - last.x, c.z - last.z) < 0.06)) continue;
      if (last && Math.hypot(c.x - last.x, c.z - last.z) < 4) {
        const surf = surface(c.x, c.z), deep = surf === 1 || T.depth > 2;
        // how far the ski is turned across its travel (sin of the slip)
        const fwd = this._f.set(0, 0, 1).applyQuaternion(ski.quaternion);
        const tx = c.x - last.x, tz = c.z - last.z, tl = Math.hypot(tx, tz);
        const cr = (fwd.x * tz - fwd.z * tx) / (tl || 1), across = Math.abs(cr);
        const halfW = list ? ski.userData.hw : (K.trackW || (one ? 0.27 : 0.1)) / 2;
        // the snow goes to the outside of the turn (turnRate > 0 turns to the rider's left, +x; a stamp's side +1 is the
        // left of its way)
        const out = turn ? -Math.sign(turn) : 0;
        let hw, depth, berm, side, sharp, scrape, bw;
        if (sk.state === 'crash') { hw = 0.35; depth = 0.9; berm = 0.5; side = 0; sharp = 0.2; scrape = 0.3; bw = 0.25; }
        else if (across < 0.18) {
          // carving: the edge's own line, as wide as the ski, deeper the harder it is set
          hw = halfW * (1 + across * 2) * Math.min(1.6, T.width);
          depth = (0.32 + edge * 0.45) * T.depth + sink * 2.5;
          berm = (0.25 + edge * 0.55) * T.berm; side = out * Math.min(1, edge * 1.6); sharp = Math.min(1, T.sharp);
          scrape = 0.15; bw = 0.05 + hw * 0.8 + (deep ? 0.12 : 0);
        } else {
          // skidding: the base scrapes a wide band smooth and pushes loose snow up along its far side
          const k = Math.min(1, (across - 0.18) / 0.5);
          hw = halfW + across * (one ? 0.7 : 0.75) * T.width;
          depth = (0.22 - k * 0.08) * T.depth + sink * 2;
          berm = (0.45 + k * 0.4) * T.berm; side = out || Math.sign(cr); sharp = 0.35 * T.sharp; scrape = 0.6 + k * 0.4;
          bw = 0.1 + hw * 0.35;
        }
        if (deep) { depth = Math.max(depth, 0.85); sharp *= 0.5; berm = Math.max(berm, 0.7); bw += 0.1; }
        this.stamp(last.x, last.z, c.x, c.z, hw, Math.min(1, Math.max(0.08, depth)), Math.min(1, berm), side, Math.min(1, sharp), scrape, bw);
      }
      if (last) last.copy(c); else this.last.set(key, c.clone());
    }
  }
  flush() {
    if (!this.n) return;
    for (let i = this.n * 4; i < this.N * 4; i++) { this.pos[i * 3] = -1e5; this.pos[i * 3 + 2] = -1e5; }
    const A = this.geo.attributes;
    A.position.needsUpdate = true; A.uv.needsUpdate = true; A.aSeg.needsUpdate = true; A.aSeg2.needsUpdate = true; A.aN.needsUpdate = true;
    this.geo.setDrawRange(0, this.n * 6);
    const ac = this.r.autoClear; this.r.autoClear = false;
    // into the fine map round the rider, then the coarse map that keeps them
    this.minWU.value = this.minW[0]; this.r.setRenderTarget(this.rt[this.cur]); this.r.render(this.scene, this.camF);
    this.minWU.value = this.minW[1]; this.r.setRenderTarget(this.rt2); this.r.render(this.scene, this.cam2);
    this.r.setRenderTarget(null);
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
uniform vec3 uSun; uniform float uTime; uniform vec3 uSnowLit;
void main() {
  vec2 c = gl_PointCoord - 0.5; float r = length(c);
  float a = smoothstep(0.5, 0.15, r) * vA * 0.75;
  if (a < 0.01) discard;
  float glint = step(0.93, fract(vS * 13.7 + uTime * 3.1)) * smoothstep(0.2, 0.0, r);
  // (as bright as the lit snow on the screen: env.js works it out for the time of day)
  vec3 col = vec3(0.94, 0.96, 1.0) * uSnowLit * (1.0 + glint * 0.6);
  gl_FragColor = vec4(col, a);
}`;
const _fw = new THREE.Vector3(), _sd = new THREE.Vector3(), _sp = new THREE.Vector3();
export class Spray {
  constructor(scene, q) {
    this.N = q.tier === 'low' ? 260 : q.tier === 'medium' ? 600 : 1000;
    const g = new THREE.BufferGeometry();
    this.p = new Float32Array(this.N * 3); this.v = new Float32Array(this.N * 3); this.life = new Float32Array(this.N * 4);
    for (let i = 0; i < this.N; i++) this.life[i * 4] = 99;
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 4));
    this.mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 300 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uSnowLit: snowUniforms.uSnowLit },
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
    // (the snow kind: powder sprays big and soft everywhere, spring slush throws heavier wet clumps, ice only fine chips)
    const kind = snowKind(), powder = sk.surf === 1 || kind === SNOW_POWDER, wet = kind === SNOW_SPRING, ice = kind === SNOW_ICE;
    if (sk.state === 'ground') {
      rate = sk.slide * 40 + (Math.abs(sk.edge) > 0.45 && sp > 8 ? sp * 3 : 0) + (powder && sp > 3 ? sp * 9 : 0);
      if (sk.brake > 0.3) rate += sp * 30;
      rate *= ice ? 0.45 : wet ? 0.8 : 1;
    }
    if (sk.state === 'crash' && sp > 1) rate = sp * 25;
    this.acc += rate * dt;
    while (this.acc > 1) {
      this.acc--;
      const ski = Math.random() < 0.5 ? rig.skiL : rig.skiR;
      const t = (Math.random() - 0.3) * 0.8;
      // (scratch vectors: nothing is made per grain)
      const fwd = _fw.set(0, 0, 1).applyQuaternion(ski.quaternion);
      const side = _sd.set(1, 0, 0).applyQuaternion(ski.quaternion);
      // thrown off the outside of the turn (the side the skis slide towards)
      const out = Math.sign(side.dot(sk.v)) || 1;
      const p = _sp.copy(ski.position).addScaledVector(fwd, t).addScaledVector(side, out * 0.06);
      const k = 0.35 + Math.random() * 0.5;
      this.emit(p.x, p.y + 0.03, p.z,
        sk.v.x * k + side.x * out * (1 + Math.random() * 2.5) + (Math.random() - 0.5),
        1.2 + Math.random() * (powder ? 3.2 : 2.0),
        sk.v.z * k + side.z * out * (1 + Math.random() * 2.5) + (Math.random() - 0.5),
        powder ? 0.28 + Math.random() * 0.3 : wet ? 0.18 + Math.random() * 0.2 : ice ? 0.06 + Math.random() * 0.08 : 0.12 + Math.random() * 0.16, wet ? 0.35 + Math.random() * 0.35 : 0.5 + Math.random() * (powder ? 1.1 : 0.6));
    }
  }
  // the "schat": the snow packed on the bases flicking off as the skis meet a rail or swap on it, a short fan of fine
  // grains thrown out to both sides of the rail and up, a little along the way you go (dir)
  flick(at, dir, power = 1) {
    if (!at) return;
    const dx = dir ? dir.x : 0, dz = dir ? dir.z : 1, n = Math.round(8 + power * 16);
    for (let i = 0; i < n; i++) {
      const sgn = i & 1 ? 1 : -1, s = (1.2 + Math.random() * 2.4) * power, up = 0.6 + Math.random() * 1.8 * power, al = (Math.random() - 0.3) * 1.5;
      this.emit(at.x + (Math.random() - 0.5) * 0.3, at.y + 0.02, at.z + (Math.random() - 0.5) * 0.3,
        -dz * sgn * s + dx * al, up, dx * sgn * s + dz * al, 0.06 + Math.random() * 0.1, 0.25 + Math.random() * 0.35);
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
