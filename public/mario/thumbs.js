/* ---------------------------------------------------------------------------
   Leon Kart - a picture of every cosmetic.

   The inventory shows each thing as itself: the hat, the glider, the kart in
   that skin or that body, drawn in your own colours. They are rendered once,
   on a small renderer of their own, the first time the inventory asks, kept
   as images for the rest of the visit, and the renderer is let go a few
   seconds after the last one so it is not holding a GPU context for nothing.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { makeKart, artLoaded, racerOf } from './kart.js?v=104';
import { driverFor } from './drivers.js?v=104';
import { merge } from './parts.js?v=104';

const SIZE = 192;
const cache = new Map();           // key -> data URL (or null when it could not be drawn)
let R = null, scene = null, cam = null, idleT = 0;
const art = () => artLoaded();
const PART_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.08 });

function setup() {
  if (R) return true;
  try {
    R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (e) { R = null; return false; }
  R.setPixelRatio(1);
  R.setSize(SIZE, SIZE, false);
  R.outputColorSpace = THREE.SRGBColorSpace;
  R.toneMapping = THREE.NoToneMapping;
  R.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a6, 1.55));
  const d = new THREE.DirectionalLight(0xffffff, 1.7);
  d.position.set(-3, 6, -4);
  scene.add(d);
  cam = new THREE.PerspectiveCamera(28, 1, 0.05, 400);
  return true;
}
function letGo() {
  clearTimeout(idleT);
  idleT = setTimeout(() => {
    if (!R) return;
    try { R.dispose(); R.forceContextLoss(); } catch (e) {}
    R = null; scene = null; cam = null;
  }, 6000);
}
/* The box round what can be seen. Box3.setFromObject counts hidden things too,
   and a kart carries its glider folded away, four and a half metres wide. */
function seenBox(obj, only) {
  const box = new THREE.Box3(), b = new THREE.Box3();
  obj.updateMatrixWorld(true);
  obj.traverseVisible(o => {
    if (!o.isMesh || !o.geometry || o.name === 'auraRing') return;
    if (only && !only(o)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(b);
  });
  return box;
}
// fit the camera to the thing, looking at it from `dir`
function shoot(obj, dir, pad, focus) {
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = focus ? focus(obj) : seenBox(obj);
  if (box.isEmpty()) box.setFromObject(obj);
  const s = box.getBoundingSphere(new THREE.Sphere());
  const dist = s.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * (pad || 1.02);
  const v = new THREE.Vector3(...dir).normalize();
  cam.position.copy(s.center).addScaledVector(v, dist);
  cam.near = Math.max(0.01, dist - s.radius * 2);
  cam.far = dist + s.radius * 2;
  cam.updateProjectionMatrix();
  cam.lookAt(s.center);
  R.render(scene, cam);
  const url = R.domElement.toDataURL('image/png');
  scene.remove(obj);
  return url;
}
// the kart views: the front three quarters, or the back for number plates (the nose is -z)
const FRONT = [-1, 0.62, -1.15], BACK = [1, 0.6, 1.2], FACE = [-0.55, 0.3, -1], ABOVE_BACK = [0.35, 0.95, 1.1];

async function draw(item, racer, build) {
  const A = await art();
  const id = item.id, short = id.replace(/^[a-z]+_/, '');
  const kart = style => {
    const k = makeKart(racer, build, style);
    if (k.shade) k.shade.visible = false;
    k.group.rotation.y = 0;
    return k.group;
  };
  const parts = list => merge(list, PART_MAT);
  switch (item.kind) {
    case 'skin': return shoot(kart({ kart: { skin: id } }), FRONT);
    case 'body': return shoot(kart({ kart: { body: id } }), FRONT);
    // the back of the car, close enough to read the plate
    case 'plate': return shoot(kart({ kart: { plate: id }, name: 'Your name' }), [0.55, 0.38, 1.2], 1,
      // the plate on the end the camera is at, not both of them
      g => seenBox(g, o => o.name === 'nameplate' && o.getWorldPosition(new THREE.Vector3()).z > 0).expandByScalar(0.55));
    // the driver, not the car
    case 'driver': {
      const k = makeKart(racer, build, { char: { driver: id } });
      if (k.shade) k.shade.visible = false;
      return shoot(k.group, [-0.8, 0.35, -1.1], 1.05, g => seenBox(k.head).union(seenBox(k.arms)).expandByScalar(0.12));
    }
    case 'aura': return shoot(kart({ kart: { aura: id } }), FRONT, 0.95);
    case 'hat': return A && A.HATS && A.HATS[short] ? shoot(parts(A.HATS[short](racer)), FACE) : null;
    case 'face': return A && A.sunglasses ? shoot(parts(A.sunglasses()), FACE) : null;
    case 'glider': return A && A.GLIDERS && A.GLIDERS[short] ? shoot(parts(A.GLIDERS[short](racer)), ABOVE_BACK) : null;
    case 'decor': return A && A.DECOR && A.DECOR[short] ? shoot(parts(A.DECOR[short](racer)), FACE) : null;
  }
  return null;
}

// the characters arrive a moment after the page; a face drawn before then is the stand-in helmet
function driversReady(id) {
  return new Promise(res => {
    const t0 = performance.now();
    const look = () => (driverFor(id || 'pip') || performance.now() - t0 > 15000) ? res() : setTimeout(look, 200);
    look();
  });
}
/* A driver's face, for the picker: each racer in their own colours. */
export function portraitFor(i) {
  const key = 'portrait|' + i;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const job = queue.then(() => new Promise(res => requestAnimationFrame(res))).then(async () => {
    if (cache.has(key)) return cache.get(key);
    await driversReady(racerOf(i, null).id);
    if (!setup()) { cache.set(key, null); return null; }
    let url = null;
    try {
      const k = makeKart(racerOf(i, null), null, null);
      if (k.shade) k.shade.visible = false;
      url = shoot(k.group, [-0.55, 0.2, -1.2], 1.0, g => seenBox(k.head).expandByScalar(0.05));
    } catch (e) { console.warn('portrait', i, e); }
    cache.set(key, url);
    letGo();
    return url;
  });
  queue = job.catch(() => null);
  return job;
}

/* The picture for one thing, in these colours. Resolves to a data URL, or to
   null when it cannot be drawn here (no WebGL), so the icon stays. */
let queue = Promise.resolve();
export function thumbFor(item, racer, build) {
  const key = item.id + '|' + racer.kart + '|' + racer.trim + '|' + (build && build.wheels);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  // one at a time, each in its own frame, so opening the inventory never stalls the menu
  const job = queue.then(() => new Promise(res => requestAnimationFrame(res))).then(async () => {
    if (cache.has(key)) return cache.get(key);
    await driversReady();
    if (!setup()) { cache.set(key, null); return null; }
    let url = null;
    try { url = await draw(item, racer, build); } catch (e) { console.warn('thumb', item.id, e); }
    cache.set(key, url);
    letGo();
    return url;
  });
  queue = job.catch(() => null);
  return job;
}
