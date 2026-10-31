// The sky, the weather and the fog as you choose them (O, or the Sky button): the time of day (the sun's height and
// direction, night with the headlights on), clear, cloudy, overcast or rain (the cloud deck's cover, the sun's
// strength, the sky's haze, rain falling round you), and fog from none to thick. Kept in localStorage car_atmos.
import * as THREE from 'three';
import { FACADE_NIGHT } from './facade.js?v=50';

const KEY = 'car_atmos';
const WEATHER = {
  clear: { name: 'Clear', cover: 0.47, sun: 1, turb: 3.2, hemi: 1, fog: 0xbcd0e6 },
  cloudy: { name: 'Cloudy', cover: 0.3, sun: 0.7, turb: 4.5, hemi: 0.95, fog: 0xb4c2d2 },
  overcast: { name: 'Overcast', cover: 0.04, sun: 0.2, turb: 9, hemi: 0.85, fog: 0xa3abb4 },
  rain: { name: 'Rain', cover: 0.0, sun: 0.1, turb: 10, hemi: 0.7, fog: 0x8f979f, rain: true },
};
const FOG = { none: ['None', 0.15], light: ['Light', 1], normal: ['Normal', 5], heavy: ['Heavy', 24] };
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const _c = new THREE.Color(), _n = new THREE.Color(0x0b1220);

// rain: streaks in a 60 m box round the camera, each one's place worked out in its shader (nothing moved on the CPU)
function makeRain() {
  const N = 5000, pos = new Float32Array(N * 2 * 3), seed = new Float32Array(N * 2 * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random(), b = Math.random(), c = Math.random();
    for (let k = 0; k < 2; k++) { seed.set([a, b, c], (i * 2 + k) * 3); pos.set([0, k, 0], (i * 2 + k) * 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 } },
    vertexShader: `
      attribute vec3 seed; uniform vec3 uCam; uniform float uTime;
      void main() {
        const float S = 60.0, H = 32.0;
        vec3 p;
        p.x = uCam.x - S * 0.5 + mod(seed.x * S - (uCam.x - S * 0.5), S);
        p.z = uCam.z - S * 0.5 + mod(seed.y * S - (uCam.z - S * 0.5), S);
        p.y = uCam.y + H * 0.5 - mod(seed.z * H + uTime * 11.0, H);
        // the streak's top half a metre up and a little upwind
        p += position.y * vec3(0.06, 0.55, 0.03);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `void main() { gl_FragColor = vec4(0.72, 0.76, 0.82, 0.32); }`,
    transparent: true, depthWrite: false,
  });
  const L = new THREE.LineSegments(g, m);
  L.frustumCulled = false; L.matrixAutoUpdate = false; L.visible = false; L.name = 'rain';
  L.onBeforeRender = (r, s, cam) => { m.uniforms.uCam.value.copy(cam.position); m.uniforms.uTime.value = performance.now() / 1000; };
  return L;
}

/* Light from the street lamps at night: a soft pool on the ground under each one (where its light falls), added on
   top of the ground's own picture, fading in as it gets dark. The lamps are read from the props' own instances:
   a cobra head's light falls 2.35 m out over the road, a post lamp's round its foot. */
const POOL_OF = { lampCobraLens: [0, 0, -2.35, 9], lampArm: [0, -8.2, -1.6, 9], lampPostGlass: [0, 0, 0, 6] };
function poolTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,214,160,1)'); r.addColorStop(0.35, 'rgba(255,196,130,0.55)'); r.addColorStop(1, 'rgba(255,180,110,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _d = new THREE.Object3D();
class LampPools {
  constructor(scene, ground) {
    this.ground = ground; this.n = 0; this.max = 1500;
    this.mat = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.mat, this.max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.renderOrder = 3; this.mesh.name = 'lamp pools'; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  build(group) {
    let n = 0;
    if (group) group.traverse(o => {
      const k = o.isInstancedMesh && o.name && o.name.slice(6), P = k && POOL_OF[k], all = P && o.userData.all;
      if (!all) return;
      for (let i = 0; i < all.n && n < this.max; i++) {
        _m.fromArray(all.m, i * 16); _p.set(P[0], P[1], P[2]).applyMatrix4(_m);
        const g = this.ground(_p.x, _p.z, _p.y + 1);
        if (g == null || !Number.isFinite(g)) continue;
        _d.position.set(_p.x, g + 0.06, _p.z); _d.scale.set(P[3] * 2, 1, P[3] * 2); _d.updateMatrix();
        this.mesh.setMatrixAt(n++, _d.matrix);
      }
    });
    this.n = this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
  night(k) { this.mat.opacity = 0.55 * k; this.mesh.visible = k > 0.02 && this.n > 0; }
}

export class Atmos {
  constructor(drive) {
    this.D = drive; this.sky = drive.G.sky; this.scene = drive.scene;
    const s = read();
    this.hour = Number.isFinite(s.hour) ? s.hour : 14.5;
    this.weather = WEATHER[s.weather] ? s.weather : 'clear';
    this.fog = FOG[s.fog] ? s.fog : 'light';
    this.rain = makeRain(); this.scene.add(this.rain);
    this.pools = new LampPools(this.scene, (x, z, y) => this.D.ground(x, z, y));
    // (the lamps again whenever the street's props are built anew)
    let since = 0;
    setInterval(() => { const P = this.D.propsObj; since += 1.5; if (P && P.group && (P !== this.poolsFor || (since > 8 && (this.nightK || 0) > 0.02))) { this.poolsFor = P; since = 0; try { this.pools.build(P.group); this.pools.night(this.nightK || 0); } catch (e) { console.warn('lamp pools', e); } } }, 1500);
    this.ui();
    this.apply(true);
    addEventListener('keydown', e => { if (e.code === 'KeyO' && !e.repeat && this.D.active && !/INPUT|TEXTAREA/.test(e.target.tagName)) this.toggle(); });
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ hour: this.hour, weather: this.weather, fog: this.fog })); } catch (e) {} }
  // the sun's height and direction at an hour: up at 6, highest (60 degrees) at noon, down at 18; under the horizon at night
  sunAt(h) { return { elev: 60 * Math.sin(Math.PI * (h - 6) / 12), az: ((90 + (h - 6) * 15) % 360 + 360) % 360 }; }
  apply(env) {
    const S = this.sky, W = WEATHER[this.weather], { elev, az } = this.sunAt(this.hour);
    const day = THREE.MathUtils.smoothstep(elev, -6, 8);
    const u = S.mesh.material.uniforms;
    u.turbidity.value = W.turb; u.rayleigh.value = 1.4 * (0.35 + 0.65 * day);
    // (the light and the sky follow the sun at once; its picture for reflections only when the slider is let go)
    const e = Math.max(elev, -10);
    if (env) S.setSun(e, az);
    else { const r = THREE.MathUtils.degToRad(e), a = THREE.MathUtils.degToRad(az); S.dir.set(Math.cos(r) * Math.sin(a), Math.sin(r), -Math.cos(r) * Math.cos(a)); u.sunPosition.value.copy(S.dir).multiplyScalar(1000); S.clouds.material.uniforms.uSun.value.copy(S.dir); }
    S.sun.intensity = 3.0 * W.sun * day;
    S.sun.color.setHex(elev < 12 ? 0xffd2a6 : 0xfff3e2);
    // after dark the moon lights the street instead, dim and blue, from high on the other side (the sky keeps the sun's)
    if (day < 0.5) {
      const r = THREE.MathUtils.degToRad(45), a = THREE.MathUtils.degToRad(az + 180);
      S.dir.set(Math.cos(r) * Math.sin(a), Math.sin(r), -Math.cos(r) * Math.cos(a));
      S.sun.intensity = Math.max(S.sun.intensity, 0.35 * (1 - day * 2) * (W.rain ? 0.5 : 1));
      if (day < 0.25) S.sun.color.setHex(0x9fb4e0);
    }
    S.hemi.intensity = 0.9 * W.hemi * (0.1 + 0.9 * day);
    this.scene.environmentIntensity = 0.85 * (0.12 + 0.88 * day);
    S.clouds.material.uniforms.uCover.value = W.cover;
    // (the sky model never goes dark: after dusk a night sky of its own colour, and the cloud deck put away)
    const dark = day < 0.08;
    S.mesh.visible = !dark; S.clouds.visible = !dark;
    this.scene.background = dark ? (this.nightSky || (this.nightSky = new THREE.Color(0x070c18))) : null;
    const f = this.scene.fog;
    if (f) { f.density = 0.00009 * FOG[this.fog][1] * (W.rain ? 2.5 : 1); f.color.copy(_c.setHex(W.fog).lerp(_n, 1 - day)); }
    this.rain.visible = !!W.rain;
    // night: the windows lit, the light bounced off the street dimmed, the lamps' light on the ground
    this.nightK = 1 - day;
    FACADE_NIGHT.value = this.nightK;
    this.pools.night(this.nightK);
    // dark out: the headlights come on (once; L still turns them off)
    if (day < 0.35 && !this.litForNight) { this.litForNight = true; this.D.headlights = true; }
    if (day >= 0.35) this.litForNight = false;
    this.label();
  }
  ui() {
    const btn = document.createElement('button');
    btn.className = 'hud-skybtn'; btn.setAttribute('aria-label', 'Time, weather and fog');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6.8 4.8 5.4 3.4 4 4.8l1.4 1.4 1.4-1.4zM1 11h3v2H1v-2zm10-10h2v3h-2V1zm8.6 3.8L18.2 3.4l-1.4 1.4 1.4 1.4 1.4-1.4zM17 18h-1.1A5 5 0 1 1 12 7a5 5 0 0 1 4.9 4H17a3.5 3.5 0 0 1 0 7z"/></svg><span>Sky</span>';
    const p = document.createElement('div');
    p.className = 'hud-sky';
    const row = (title, keys, cur, set) => `<div class="sky-row"><div class="sky-t">${title}</div><div class="sky-opts">${keys.map(([k, n]) => `<button data-k="${k}" data-set="${set}" class="${k === cur ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
    p.innerHTML = `<div class="sky-row"><div class="sky-t">Time <b class="sky-time"></b></div><input type="range" min="0" max="24" step="0.25" class="sky-hour"></div>` +
      row('Weather', Object.entries(WEATHER).map(([k, w]) => [k, w.name]), this.weather, 'weather') +
      row('Fog', Object.entries(FOG).map(([k, f]) => [k, f[0]]), this.fog, 'fog');
    document.body.appendChild(btn); document.body.appendChild(p);
    this.btn = btn; this.panel = p;
    const hr = p.querySelector('.sky-hour');
    hr.value = this.hour;
    hr.oninput = () => { this.hour = +hr.value; this.apply(false); };
    hr.onchange = () => { this.hour = +hr.value; this.apply(true); this.save(); hr.blur(); };
    p.querySelectorAll('.sky-opts button').forEach(b => b.onclick = () => {
      this[b.dataset.set] = b.dataset.k;
      p.querySelectorAll(`button[data-set="${b.dataset.set}"]`).forEach(x => x.classList.toggle('on', x === b));
      this.apply(b.dataset.set === 'weather'); this.save(); b.blur();
    });
    btn.onclick = () => { btn.blur(); this.toggle(); };
    // (shown only while driving or walking, as the car button is)
    const show = () => { const on = !!(this.D.active); btn.style.display = on ? '' : 'none'; if (!on) p.classList.remove('on'); requestAnimationFrame(() => setTimeout(show, 500)); };
    show();
  }
  toggle() { this.panel.classList.toggle('on'); }
  label() {
    const t = this.panel && this.panel.querySelector('.sky-time'); if (!t) return;
    const h = Math.floor(this.hour) % 24, m = Math.round((this.hour - Math.floor(this.hour)) * 60);
    t.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
}
export default { Atmos };
