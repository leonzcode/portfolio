/* ---------------------------------------------------------------------------
   Sparks, puffs and bangs. Pooled additive planes that always face the camera,
   the same trick the rest of these games use: a race can throw a hundred of
   these a second and none of them may allocate anything.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

let scene = null;
const live = [];
let dotTex = null;

function softDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,240,190,.6)');
  grd.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}
function plane(size) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: softDot(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false }));
  m.visible = false;
  return m;
}
function pool(make, n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(make());
  let at = 0;
  return () => { const it = a[at]; at = (at + 1) % n; return it; };
}
let takeSpark, takePuff, takeFlash;

export function initFx(s) {
  scene = s;
  takeSpark = pool(() => { const m = plane(0.4); scene.add(m); return m; }, 70);
  takePuff = pool(() => { const m = plane(1.2); scene.add(m); return m; }, 26);
  takeFlash = pool(() => { const m = plane(3); scene.add(m); return m; }, 8);
}
function play(o, life, fn) { o.visible = true; live.push({ o, t: 0, life, fn }); }

/* One particle, in whichever style the kart throwing it was built with. The
   shape is the same quad either way; what changes is how long it lives, how
   fast it falls, how it grows and how it turns, which between them is the whole
   difference between a spark, a flame and a bubble. */
export function spark(pos, color, up, style, size) {
  const m = takeSpark();
  m.position.copy(pos);
  m.material.color.setHex(color);
  m.material.opacity = 1;
  const s = size || 1;
  m.scale.setScalar(s);
  const v = new THREE.Vector3((Math.random() - 0.5) * 5, (up || 1) + Math.random() * 3, (Math.random() - 0.5) * 5);
  if (style === 'flame') {
    // it lifts instead of falling, and swells as it burns out
    v.set((Math.random() - 0.5) * 2, (up || 1) * 0.4 + Math.random(), (Math.random() - 0.5) * 2);
    play(m, 0.42, (o, k, dt) => {
      v.y += 5 * dt;
      o.position.addScaledVector(v, dt);
      o.scale.setScalar(s * (1 + k * 1.6));
      o.material.opacity = 1 - k * k;
    });
  } else if (style === 'bubble') {
    // slow, floaty, and it pops rather than fading
    v.multiplyScalar(0.45);
    play(m, 0.85, (o, k, dt) => {
      v.y += 3.2 * dt;
      o.position.addScaledVector(v, dt);
      o.scale.setScalar(s * (0.6 + k * 0.9));
      o.material.opacity = k > 0.86 ? (1 - k) * 7 : 0.8;
    });
  } else if (style === 'star') {
    // it tumbles and drops like anything else, but it spins doing it
    play(m, 0.55, (o, k, dt) => {
      v.y -= 11 * dt;
      o.position.addScaledVector(v, dt);
      o.rotation.z += dt * 9;
      o.scale.setScalar(s * (1 - k * 0.5));
      o.material.opacity = 1 - k;
    });
  } else if (style === 'bolt') {
    // short, sharp and stretched along the way it is going
    v.multiplyScalar(1.5);
    play(m, 0.2, (o, k, dt) => {
      o.position.addScaledVector(v, dt);
      o.scale.set(s * 0.4, s * (1.8 - k), s);
      o.material.opacity = 1 - k * k;
    });
  } else {
    play(m, 0.32, (o, k, dt) => { v.y -= 16 * dt; o.position.addScaledVector(v, dt); o.material.opacity = 1 - k; });
  }
}
export function puff(pos, color) {
  const m = takePuff();
  m.position.copy(pos);
  m.material.color.setHex(color === undefined ? 0xfff6e2 : color);
  m.material.opacity = 0.75;
  m.scale.setScalar(0.6);
  play(m, 0.45, (o, k, dt) => { o.material.opacity = 0.75 * (1 - k); o.scale.setScalar(0.6 + k * 2); o.position.y += 1.6 * dt; });
}
export function blast(pos) {
  const m = takeFlash();
  m.position.copy(pos);
  m.material.color.setHex(0xffb340);
  m.material.opacity = 1;
  m.scale.setScalar(1);
  play(m, 0.5, (o, k) => { o.material.opacity = 1 - k; o.scale.setScalar(1 + k * 5); });
  for (let i = 0; i < 12; i++) spark(pos, i % 2 ? 0xffd233 : 0xe8402a, 4);
}
export function coinPop(pos) {
  for (let i = 0; i < 5; i++) spark(pos, 0xffd233, 3);
}

/* Every spark and puff turned to face one camera. They are flat cards, so in
   split screen each half turns them to its own camera before it is drawn. */
export function faceFx(camera) {
  for (let i = 0; i < live.length; i++) live[i].o.quaternion.copy(camera.quaternion);
}
export function stepFx(dt, camera) {
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i];
    e.t += dt;
    const k = Math.min(1, e.t / e.life);
    e.fn(e.o, k, dt);
    if (camera) e.o.quaternion.copy(camera.quaternion);
    if (e.t >= e.life) { e.o.visible = false; live.splice(i, 1); }
  }
}
