/* ---------------------------------------------------------------------------
   Leoncraft 2 - rain and snow round the player, and lightning bolts.

   Drawn the way the game's weather renderer does it: every column within 5
   blocks (Fast) or 10 (Detailed) where it is raining or snowing gets one
   upright quad turned across the line from the camera, from the top block
   of the column (or 10 below the eye) to 10 above the eye. Rain streams
   down fast, each column's texture offset by its own hash; snow drifts down
   slowly and sways. They fade towards the edge of the circle, and in and
   out with the rain level, and darken with the light.

   The streaks and flakes are our own art, drawn here on a canvas (no game
   textures). Lightning is a jagged bolt of thin bright ribbons from high in
   the sky, there for a few ticks, with the sky flashing (render/vanilla.js).
--------------------------------------------------------------------------- */
const THREE = window.THREE;

function streakTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 256);
  let s = kind === 'rain' ? 7 : 13;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  if (kind === 'rain') {
    // thin streaks of pale blue, a few lengths
    for (let i = 0; i < 46; i++) {
      const x = Math.floor(rnd() * 64), y = Math.floor(rnd() * 256), len = 10 + Math.floor(rnd() * 22);
      const a = 0.45 + rnd() * 0.45;
      for (let k = 0; k < len; k++) {
        const t = k / len;
        g.fillStyle = `rgba(${170 + Math.floor(rnd() * 30)},${190 + Math.floor(rnd() * 30)},255,${(a * Math.sin(t * Math.PI)).toFixed(3)})`;
        g.fillRect(x, (y + k) % 256, 1, 1);
      }
    }
  } else {
    // flakes: little crosses and dots of white
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(rnd() * 62) + 1, y = Math.floor(rnd() * 254) + 1, a = 0.7 + rnd() * 0.3;
      g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      if (rnd() < 0.5) { g.fillRect(x, y, 2, 2); }
      else { g.fillRect(x, y - 1, 1, 3); g.fillRect(x - 1, y, 3, 1); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = false;
  return t;
}

const VS = /* glsl */`
attribute float aAlpha;
varying vec2 vUv; varying float vA;
void main() { vUv = uv; vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = /* glsl */`
uniform sampler2D uMap; uniform float uBright;
varying vec2 vUv; varying float vA;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(t.rgb * uBright, a);
}`;

export class WeatherFX {
  constructor(sim, weather) {
    this.sim = sim; this.weather = weather;
    const r = sim.renderer;
    this.R = r.vanilla ? 5 : 10;
    const max = (this.R * 2 + 1) ** 2;
    this.max = max;
    this.layers = {};
    for (const kind of ['rain', 'snow']) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 12), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(max * 8), 2).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(max * 4), 1).setUsage(THREE.DynamicDrawUsage));
      const idx = new Uint32Array(max * 6);
      for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.setDrawRange(0, 0);
      const m = new THREE.ShaderMaterial({ uniforms: { uMap: { value: streakTexture(kind) }, uBright: { value: 1 } }, vertexShader: VS, fragmentShader: FS,
        transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      (r.trans || r.scene).add(mesh);
      this.layers[kind] = { g, m, mesh };
    }
    this.boltGroup = new THREE.Group();
    r.scene.add(this.boltGroup);
    this.boltMat = new THREE.MeshBasicMaterial({ color: 0xc8c8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.bolts = [];
    this.t0 = performance.now();
    const frame = () => { if (this.dead) return; try { this.frame(); } catch (e) { console.warn('weather', e); } requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }
  dispose() {
    this.dead = true;
    for (const k in this.layers) { const l = this.layers[k]; if (l.mesh.parent) l.mesh.parent.remove(l.mesh); l.g.dispose(); }
    if (this.boltGroup.parent) this.boltGroup.parent.remove(this.boltGroup);
    const r = this.sim.renderer;
    if (r && r.U && r.U.uCover) r.U.uCover.value = 0.42;
  }
  frame() {
    const sim = this.sim, r = sim.renderer, w = this.weather;
    const rain = w.rain;
    // Detailed: the clouds close in as it rains
    if (!r.vanilla && r.U.uCover) r.U.uCover.value = 0.42 + rain * 0.5;
    for (const b of this.bolts) { b.life--; b.obj.visible = b.life > 0 && (b.life % 3 !== 1); }
    this.bolts = this.bolts.filter(b => { if (b.life <= 0) { this.boltGroup.remove(b.obj); b.obj.geometry.dispose(); return false; } return true; });
    if (rain <= 0 || sim.dimension() !== 'overworld') { for (const k in this.layers) this.layers[k].g.setDrawRange(0, 0); return; }
    const cam = r.camera.position;
    const cx = Math.floor(cam.x), cy = cam.y, cz = Math.floor(cam.z), R = this.R;
    const ticks = sim.n + Math.min(1, (performance.now() - (sim.bodies.lastTick || 0)) / 50);
    const fill = { rain: 0, snow: 0 };
    const tops = this.tops || (this.tops = new Map());
    if ((this.topsAt || 0) !== sim.n) { tops.clear(); this.topsAt = sim.n; }
    // how bright: the time of day, the rain itself and the sky light at the eye
    const day = Math.max(0.2, 1 - sim.skyDarken() / 15);
    for (const k in this.layers) this.layers[k].m.uniforms.uBright.value = (r.vanilla ? 1 : 1.6) * day;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > R * R) continue;
      const x = cx + dx, z = cz + dz;
      if (!sim.w.loaded(x, z)) continue;
      let top = tops.get(x * 65536 + z);
      if (top === undefined) { top = sim.topAt(x, z) + 1; tops.set(x * 65536 + z, top); }
      const y0 = Math.max(top, Math.floor(cy) - R), y1 = Math.max(top, Math.floor(cy) + R);
      if (y0 === y1) continue;
      const kind = w.precipAt(x, top, z);
      if (!kind) continue;
      const L = this.layers[kind], i = fill[kind]++;
      // the quad across the line from the camera
      let ox = x + 0.5 - cam.x, oz = z + 0.5 - cam.z;
      const ol = Math.hypot(ox, oz) || 1;
      const sx = -oz / ol * 0.5, sz = ox / ol * 0.5;
      const P = L.g.attributes.position.array, U = L.g.attributes.uv.array, A = L.g.attributes.aAlpha.array;
      const px = x + 0.5, pz = z + 0.5;
      P.set([px - sx, y0, pz - sz, px + sx, y0, pz + sz, px + sx, y1, pz + sz, px - sx, y1, pz - sz], i * 12);
      const h = ((x * x * 3121 + x * 45238971) ^ (z * z * 418711 + z * 13761)) & 31;
      let v0, uo = 0;
      if (kind === 'rain') v0 = -((ticks + h) / 32) * (3 + (h & 7) / 8);
      else { v0 = -((ticks % 512) / 512) - h / 32; uo = (h / 31) + Math.sin(ticks * 0.01 + h) * 0.1; }
      const vs = (y1 - y0) / 4;
      U.set([uo, v0 + vs, uo + 1, v0 + vs, uo + 1, v0, uo, v0], i * 8);
      const a = ((1 - d2 / (R * R)) * 0.5 + 0.5) * rain;
      A.set([a, a, a, a], i * 4);
    }
    for (const k in this.layers) {
      const L = this.layers[k];
      L.g.setDrawRange(0, fill[k] * 6);
      if (fill[k]) { L.g.attributes.position.needsUpdate = true; L.g.attributes.uv.needsUpdate = true; L.g.attributes.aAlpha.needsUpdate = true; }
    }
  }
  bolt(x, y, z) {
    // a jagged line from 128 up, in steps, as thin crossed ribbons
    const pos = [];
    let px = x, pz = z;
    const seg = [];
    for (let yy = y + 128; yy > y; yy -= 8) {
      const nx = px + (Math.random() - 0.5) * 3, nz = pz + (Math.random() - 0.5) * 3, ny = Math.max(y, yy - 8);
      seg.push([px, yy, pz, nx, ny, nz]);
      px = nx; pz = nz;
    }
    const wdt = 0.16;
    for (const [ax, ay, az, bx, by, bz] of seg) {
      pos.push(ax - wdt, ay, az, ax + wdt, ay, az, bx + wdt, by, bz, ax - wdt, ay, az, bx + wdt, by, bz, bx - wdt, by, bz);
      pos.push(ax, ay, az - wdt, ax, ay, az + wdt, bx, by, bz + wdt, ax, ay, az - wdt, bx, by, bz + wdt, bx, by, bz - wdt);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    const m = new THREE.Mesh(g, this.boltMat);
    m.frustumCulled = false;
    this.boltGroup.add(m);
    this.bolts.push({ obj: m, life: 10 });
  }
}
