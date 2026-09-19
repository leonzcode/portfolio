/* ---------------------------------------------------------------------------
   Leon Cart - the garage.

   The car you are about to drive, on a turntable, before you drive it. Pick a
   racer and it is their car; change a part and it changes in front of you; drag
   it and it turns. It is the one screen in the game whose whole job is to let
   you look at something.

   It runs on its own small renderer rather than on the main one. The title
   screen is an opaque panel over the world, so there is no hole to look at the
   race scene through, and a second context the size of a postcard costs far
   less than the arrangement needed to punch one. It is thrown away the moment a
   race starts, so nothing is paying for it while you are racing.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

import { makeKart, apply } from './kart.js?v=24';
import { CHASSIS, WHEELS, TRAILS, HATS, FACES, SUITS, normalise } from './parts.js?v=24';

/* The rows under the turntable, in two groups: the car, then the person in it.
   Grouping them matters more than it sounds - six unlabelled rows of arrows is
   a settings screen, and two groups of three is a garage. */
export const PARTS = [
  { group: 'Kart', key: 'chassis', label: 'Body', list: CHASSIS },
  { key: 'wheels', label: 'Wheels', list: WHEELS },
  { key: 'trail', label: 'Trail', list: TRAILS },
  { group: 'Racer', key: 'hat', label: 'Hat', list: HATS },
  { key: 'face', label: 'Face', list: FACES },
  { key: 'suit', label: 'Outfit', list: SUITS },
];

export function makeGarage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.2, 60);
  camera.position.set(0, 1.95, 6.5);
  camera.lookAt(0, 0.8, 0);

  /* Three lights, which is all a single object needs: a key over the shoulder,
     a cool fill from the other side so the dark flank is not a silhouette, and
     a rim from behind to lift the edges off the background. */
  const key = new THREE.DirectionalLight(0xfff4d8, 2.5);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1; key.shadow.camera.far = 22;
  key.shadow.camera.left = -4; key.shadow.camera.right = 4;
  key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
  key.shadow.bias = -0.0012;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfe0ff, 0.85);
  fill.position.set(-5, 3, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a0, 1.4);
  rim.position.set(-2, 4, -6);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xdff0ff, 0x6b6f78, 0.7));

  // the turntable, with a ring round the edge of it
  const pad = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(2.55, 2.75, 0.22, 44),
    new THREE.MeshStandardMaterial({ color: 0x2d3550, roughness: 0.55, metalness: 0.15 })
  );
  disc.position.y = -0.11;
  disc.receiveShadow = true;
  pad.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.07, 6, 48),
    new THREE.MeshStandardMaterial({ color: 0xffd233, roughness: 0.4, emissive: 0xffd233, emissiveIntensity: 0.35 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  pad.add(ring);
  scene.add(pad);

  const turn = new THREE.Group();          // what the drag rotates
  scene.add(turn);

  let kart = null, racer = null, build = null;
  // it starts showing you its face. A car first seen from behind is a car you
  // have to wait eight seconds to recognise.
  let yaw = -2.5, spin = 0.3, drag = null, t = 0;

  function show(who, b) {
    const next = normalise(b);
    if (kart && racer === who && build
        && Object.keys(next).every(k => next[k] === build[k])) return;
    if (kart) {
      turn.remove(kart.group);
      kart.group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }
    racer = who; build = next;
    kart = makeKart(who, next);
    kart.pos.set(0, 0, 0);
    apply(kart);
    kart.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    if (kart.shade) kart.shade.visible = false;     // the real shadow does the job here
    turn.add(kart.group);
  }

  /* Drag anywhere on the canvas to turn it, and it drifts back into a slow
     rotation when you let go. Pointer events cover mouse, pen and touch in one
     set of handlers, which is why they are used rather than three. */
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, yaw };
    spin = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    yaw = drag.yaw + (e.clientX - drag.x) * 0.011;
  });
  const letGo = () => { if (drag) { drag = null; spin = 0.3; } };
  canvas.addEventListener('pointerup', letGo);
  canvas.addEventListener('pointercancel', letGo);
  canvas.addEventListener('lostpointercapture', letGo);

  function frame(dt) {
    t += dt;
    if (!drag) yaw += spin * dt;
    turn.rotation.y = yaw;
    pad.rotation.y = yaw;
    if (kart) {
      // it idles: the wheels creep, the driver looks around, and the whole car
      // breathes on its springs, so the screen is never quite still
      kart.wheelSpin += dt * 0.6;
      kart.steerVis = Math.sin(t * 0.55) * 0.22;
      kart.squat = Math.sin(t * 1.3) * 0.012;
      kart.lean = Math.sin(t * 0.42) * 0.02;
      apply(kart);
      kart.group.position.y = 0.02 + Math.sin(t * 1.1) * 0.012;
    }
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())
        || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
  }

  function dispose() {
    scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
    renderer.dispose();
  }

  return { show, frame, dispose, get yaw() { return yaw; }, set yaw(v) { yaw = v; } };
}
