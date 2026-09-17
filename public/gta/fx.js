/* ---------------------------------------------------------------------------
   Effects: the things that make a shot feel like a shot.

   All of it is pooled. A gun firing ten rounds a second cannot allocate a mesh
   per round, so every effect borrows a mesh from a ring, lives for a fraction of
   a second, and goes back. Nothing here is lit - the whole lot is additive, which
   is both cheaper and closer to how a muzzle flash actually reads on film.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

let scene = null;
const live = [];

function additive(color, size, tex) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      color, map: tex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    })
  );
  m.visible = false;
  return m;
}

let dotTex = null;
function softDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,240,200,.65)');
  grd.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

/* ---- pools ---------------------------------------------------------------- */
function pool(make, n) {
  const items = [];
  for (let i = 0; i < n; i++) items.push(make());
  let at = 0;
  return () => { const it = items[at]; at = (at + 1) % n; return it; };
}
let takeFlash, takePuff, takeSpark, takeTracer;

export function initFx(s) {
  scene = s;
  const tex = softDot();
  takeFlash = pool(() => { const m = additive(0xffe6a8, 1.0, tex); scene.add(m); return m; }, 8);
  takePuff = pool(() => { const m = additive(0xd8d2c4, 0.5, tex); scene.add(m); return m; }, 24);
  takeSpark = pool(() => { const m = additive(0xffc46a, 0.24, tex); scene.add(m); return m; }, 40);
  takeTracer = pool(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    l.frustumCulled = false; l.visible = false;
    scene.add(l);
    return l;
  }, 24);
}

function play(obj, life, fn) {
  obj.visible = true;
  live.push({ o: obj, t: 0, life, fn });
}

/* ---- the effects ---------------------------------------------------------- */
export function muzzle(pos, size) {
  const m = takeFlash();
  m.position.copy(pos);
  m.scale.setScalar((size || 1) * (0.8 + Math.random() * 0.5));
  m.rotation.z = Math.random() * 6.28;
  m.material.opacity = 1;
  play(m, 0.055, (o, k) => { o.material.opacity = 1 - k; });
}

export function tracer(from, to) {
  const l = takeTracer();
  const p = l.geometry.attributes.position;
  p.setXYZ(0, from.x, from.y, from.z);
  p.setXYZ(1, to.x, to.y, to.z);
  p.needsUpdate = true;
  l.material.opacity = 0.85;
  play(l, 0.05, (o, k) => { o.material.opacity = 0.85 * (1 - k); });
}

export function impact(pos, kind) {
  const m = takePuff();
  m.position.copy(pos);
  m.material.color.setHex(kind === 'car' ? 0xffd08a : kind === 'body' ? 0xd04a4a : 0xcfc8ba);
  m.material.opacity = 0.85;
  m.scale.setScalar(0.35);
  play(m, 0.3, (o, k) => { o.material.opacity = 0.85 * (1 - k); o.scale.setScalar(0.35 + k * 0.9); });
  for (let i = 0; i < 3; i++) {
    const s = takeSpark();
    s.position.copy(pos);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5)
      .normalize().multiplyScalar(3 + Math.random() * 4);
    s.material.opacity = 1;
    play(s, 0.22, (o, k, dt) => {
      v.y -= 22 * dt;
      o.position.addScaledVector(v, dt);
      o.material.opacity = 1 - k;
    });
  }
}

export function explode(pos) {
  const m = takeFlash();
  m.position.copy(pos);
  m.material.color.setHex(0xffb44a);
  m.material.opacity = 1;
  m.scale.setScalar(2);
  play(m, 0.55, (o, k) => { o.material.opacity = 1 - k; o.scale.setScalar(2 + k * 14); });
  for (let i = 0; i < 14; i++) {
    const s = takeSpark();
    s.position.copy(pos);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)
      .normalize().multiplyScalar(9 + Math.random() * 12);
    s.material.opacity = 1;
    s.scale.setScalar(1 + Math.random() * 2);
    play(s, 0.7 + Math.random() * 0.4, (o, k, dt) => {
      v.y -= 15 * dt;
      o.position.addScaledVector(v, dt);
      o.material.opacity = 1 - k;
    });
  }
}

/* every effect faces the camera, which is what sells a flat plane as a puff */
export function stepFx(dt, camera) {
  for (let i = live.length - 1; i >= 0; i--) {
    const e = live[i];
    e.t += dt;
    const k = Math.min(1, e.t / e.life);
    if (e.fn) e.fn(e.o, k, dt);
    if (e.o.isMesh && camera) e.o.quaternion.copy(camera.quaternion);
    if (e.t >= e.life) { e.o.visible = false; live.splice(i, 1); }
  }
}
