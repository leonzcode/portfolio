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

export function spark(pos, color, up) {
  const m = takeSpark();
  m.position.copy(pos);
  m.material.color.setHex(color);
  m.material.opacity = 1;
  const v = new THREE.Vector3((Math.random() - 0.5) * 5, (up || 1) + Math.random() * 3, (Math.random() - 0.5) * 5);
  play(m, 0.32, (o, k, dt) => { v.y -= 16 * dt; o.position.addScaledVector(v, dt); o.material.opacity = 1 - k; });
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
