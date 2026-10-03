/* ---------------------------------------------------------------------------
   Karts, and the way they drive.

   The handling is arcade on purpose. A kart has one speed along its heading and
   a slide angle that only exists while drifting, which is the whole trick of the
   genre: you hop, the back steps out, the heading swings wider than the travel,
   a charge builds, and letting go of the hop fires you out of the corner. Grip,
   mass and slip angles would be more honest and much less fun.

   Every kart is merged into a couple of meshes with its colours baked into the
   vertices, so a full grid of twelve costs a few dozen draw calls.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { driverFor, whenDrivers, loadDrivers, tintDriver, tintMaterial, headBox } from './drivers.js?v=103';
import { paintMaterial, makeAura, DRIVER_STYLE, normaliseStyle } from './cosmetics.js?v=103';
/* The geometry of the cosmetics - themed bodies, hats, gliders, decorations -
   is fetched with everything else but is not needed to draw a car, so a kart
   built before it arrives simply goes without until it is next built. */
let ART = null;
const artWaiting = [];
// two batches: the first set of cosmetics, and the prizes
Promise.all([import('./cosmetics-art.js?v=103'), import('./cosmetics-art2.js?v=103').catch(() => ({}))]).then(([a, b]) => {
  const both = k => Object.assign({}, a[k] || {}, b[k] || {});
  ART = { HATS: both('HATS'), DECOR: both('DECOR'), GLIDERS: both('GLIDERS'), THEMED_BODIES: both('THEMED_BODIES'), sunglasses: a.sunglasses };
  for (const f of artWaiting.splice(0)) { try { f(); } catch (e) {} }
}).catch(e => console.warn('cosmetics art', e));
export function whenArt(f) { if (ART) f(); else artWaiting.push(f); }
export const artLoaded = () => new Promise(res => whenArt(() => res(ART)));
export const artReady = () => !!ART;
import { loadKit } from './models.js?v=103';
// the drivers and the kit's bodies are fetched once, as soon as anything builds a kart
loadDrivers('models/chars/');
loadKit('models/kit/', ['race', 'race-future', 'kart-oobi', 'wheel-racing']);

export const RACERS = [
  // Leon swapped these two names: Brayden is first, in Pip's old look without the glasses
  { id: 'pip',  name: 'Brayden', shirt: 0xe8402a, skin: 0xffd9b0, cap: 0xe8402a, kart: 0xe8402a, trim: 0xffd233 },
  { id: 'nib',  name: 'Nib',  shirt: 0x2f9440, skin: 0xd9a877, cap: 0x17223b, kart: 0x43d94f, trim: 0xfff6e2 },
  { id: 'wren', name: 'Wren', shirt: 0x2b56d6, skin: 0xf0d2b4, cap: 0xffd233, kart: 0x2b56d6, trim: 0x8fd3ff },
  { id: 'bram', name: 'Bram', shirt: 0x7a3fb0, skin: 0x8a5a36, cap: 0xffd233, kart: 0x9a4fd0, trim: 0xffd233 },
  { id: 'coco', name: 'Pip', shirt: 0xff8a1f, skin: 0x5f3b22, cap: 0x17223b, kart: 0xff8a1f, trim: 0xfff6e2 },
  { id: 'mox',  name: 'Mox',  shirt: 0x17223b, skin: 0xe8c39a, cap: 0xe8402a, kart: 0x3a3f4a, trim: 0xe8402a },
  { id: 'juno', name: 'Juno', shirt: 0xff5fa2, skin: 0xffd9b0, cap: 0xfff6e2, kart: 0xff5fa2, trim: 0x8fd3ff },
  { id: 'tock', name: 'Tock', shirt: 0x1fb6a6, skin: 0xb07a4e, cap: 0x17223b, kart: 0x1fb6a6, trim: 0xffd233 },
  // very short hair, a black jacket and dark jeans. Sunglasses are his to put on, like anybody's.
  { id: 'thomas', name: 'Thomas', shirt: 0x1d2433, skin: 0xe0a878, cap: 0x1d2433, kart: 0x2b3a67, trim: 0x9fd8ff,
    look: { shirt: 0x22252c, pants: 0x2b3a67 } },
  /* Leon's secret driver (2026-10-02): hidden from the picker and never a
     computer racer until "nubert" is typed on the title screen. */
  { id: 'nubert', name: 'Nubert', shirt: 0xf26b4a, skin: 0xf26b4a, cap: 0xd9503a, kart: 0xf26b4a, trim: 0xffd233, secret: true },
];

/* A car painted from one colour off the wheel. The body and the driver take it
   as it is; the trim is the same colour pushed towards white if it is dark and
   towards black if it is light, so the stripes and the wing still read against
   the bodywork whatever was picked. The racer underneath supplies everything
   the wheel does not decide, which is the driver's skin. */
function accentOf(c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const to = lum < 140 ? 255 : 0, k = lum < 140 ? 0.62 : 0.55;
  const mix = v => Math.round(v + (to - v) * k);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
export function racerOf(cast, colour) {
  const base = RACERS[Math.max(0, Math.min(RACERS.length - 1, cast | 0))];
  if (colour === null || colour === undefined) return base;
  const c = colour & 0xffffff;
  return Object.assign({}, base, { kart: c, shirt: c, cap: c, trim: accentOf(c) });
}

/* Something for the paint to reflect. A car lit only by a sun and a flat
   ambient is a car made of coloured clay: the bodywork has no sky in it, no
   bright line along the top of a panel, nothing to say it is lacquered metal.
   This is a sky drawn by hand into a panorama - pale overhead, a bright band
   at the horizon, the ground darker below, and two soft bright patches for
   the sun and the sky opposite it - and three.js blurs it to suit each
   surface's roughness, per renderer, so the garage and the race both get it
   from the same small canvas. */
const KART_ENV = (() => {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#6f9fd2');
  sky.addColorStop(0.42, '#c9ddef');
  sky.addColorStop(0.5, '#fff8ea');
  sky.addColorStop(0.53, '#8c9486');
  sky.addColorStop(1, '#3d4238');
  g.fillStyle = sky; g.fillRect(0, 0, 256, 128);
  for (const [x, y, rad, a] of [[70, 34, 26, 0.95], [190, 44, 40, 0.45]]) {
    const r = g.createRadialGradient(x, y, 0, x, y, rad);
    r.addColorStop(0, 'rgba(255,255,255,' + a + ')');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
/* A shade glossier than it was, so the reflection has somewhere to show, and
   not so much that the drivers look varnished: they share the material. */
const BODY_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.42, metalness: 0.12, envMap: KART_ENV, envMapIntensity: 0.42,
});
const TYRE_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.9, envMap: KART_ENV, envMapIntensity: 0.25,
});

/* The patch of dark a car sits in. The sun casts a real shadow, but a single
   directional light throws it off to one side, so at a glance nothing looks
   like it is touching the ground. This is the contact: a soft disc under the
   floor that shrinks and fades as the car leaves the road, which is also the
   only cue you get for how high you are in the air. Built once and shared. */
const SHADOW_TEX = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(0,0,0,.55)');
  r.addColorStop(0.55, 'rgba(0,0,0,.3)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const SHADOW_GEO = new THREE.PlaneGeometry(3.4, 4.2).rotateX(-Math.PI / 2);

import { CHASSIS, WHEELS, TRAILS, chassisOf, wheelsOf, trailOf, normalise, statsOf,
         driverHead, driverBody,
         box, cyl, ball, taper, merge, INK, STEEL, DARK } from './parts.js?v=103';
export { CHASSIS, WHEELS, TRAILS, normalise, statsOf };

/* ---- the model ----------------------------------------------------------- */
/* A kart is a body, a set of wheels, a driver and a trail, and the four are
   chosen separately. Nothing that comes out of the garage carries a colour of
   its own: every panel is painted out of the racer, so however anybody has
   built theirs, a grid of eight is still eight recognisable cars. */
/* Name plates carry a name on the front and back of the car, whatever
   body it is. The body is measured once it is built and a ray is fired at it
   from straight ahead and from straight behind, low down on the centre line,
   so each plate sits on the panel it hits. If the middle of a body is open
   (a buggy's frame), it goes on the end of the bounding box instead. One
   canvas texture, shared by every plate. */
const plateTex = {};
function plateTexture(text) {
  if (plateTex[text]) return plateTex[text];
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const round = (x, y, w, h, r) => {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  // the plate: cream, with a navy rim and a bolt in each top corner
  round(6, 6, 500, 244, 30);
  g.fillStyle = '#f6f1e2'; g.fill();
  g.lineWidth = 14; g.strokeStyle = '#17223b'; g.stroke();
  g.fillStyle = '#9aa3b5';
  for (const x of [70, 442]) { g.beginPath(); g.arc(x, 44, 11, 0, Math.PI * 2); g.fill(); }
  const word = String(text).toUpperCase();
  let size = 112;
  g.font = '900 ' + size + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  const w = g.measureText(word).width;
  if (w > 440) { size = Math.floor(size * 440 / w); g.font = '900 ' + size + 'px "Arial Black", "Helvetica Neue", Arial, sans-serif'; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#17223b';
  g.fillText(word, 256, 146);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (plateTex[text] = t);
}
const plateRay = new THREE.Raycaster();
function nameplates(body, mesh, text) {
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const wide = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
  const pw = Math.min(0.6, wide * 0.45), ph = pw / 2;
  const lowest = bb.min.y + ph * 0.6;
  const mat = new THREE.MeshBasicMaterial({
    map: plateTexture(text), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const plane = new THREE.PlaneGeometry(pw, ph);
  // the front of a kart is -z
  for (const end of [-1, 1]) {
    /* Tried at a few heights, and put on whichever panel stands furthest out
       at that end: one fixed height went over a pickup's tailgate and hung the
       plate inside the bed. A tie goes to the higher one, clear of exhausts. */
    let y = 0, z = null;
    for (const f of [0.22, 0.32, 0.42, 0.52]) {
      const yy = Math.max(lowest, bb.min.y + h * f);
      plateRay.set(new THREE.Vector3(0, yy, end * 10), new THREE.Vector3(0, 0, -end));
      const hit = plateRay.intersectObject(mesh, false)[0];
      if (!hit) continue;
      if (z === null || end * (hit.point.z - z) > -0.04) { z = hit.point.z; y = yy; }
    }
    if (z === null) { z = end < 0 ? bb.min.z : bb.max.z; y = Math.max(lowest, bb.min.y + h * 0.42); }
    const m = new THREE.Mesh(plane, mat);
    m.position.set(0, y, z + end * 0.015);
    // facing out of its own end of the car, the right way up and readable
    m.rotation.y = end < 0 ? Math.PI : 0;
    m.renderOrder = 2;
    m.name = 'nameplate';
    body.add(m);
  }
}

export function makeKart(who, build, style) {
  const r = who || RACERS[0];
  const b = normalise(build);
  const S = normaliseStyle(style);
  /* A themed body (a boat, a pencil, a house) is a different shape on the same
     chassis: it looks like the theme and drives like the body picked. */
  const themed = S.kart.body && ART && ART.THEMED_BODIES && ART.THEMED_BODIES[S.kart.body.replace(/^body_/, '')];
  let spec = null;
  if (themed) { try { spec = themed(r); } catch (e) { console.warn('themed body', e); } }
  if (!spec) spec = chassisOf(b.chassis).make(r);
  if (!spec.exhaust) spec.exhaust = [];
  const tyre = wheelsOf(b.wheels).make(r);
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  /* The car itself comes out of the garage: whichever body was chosen, painted
     out of the racer who is driving it. The driver is built separately and put
     on the seat the body asks for, so the same person fits a formula car and a
     pickup without being modelled twice. */
  const shirt = r.shirt, skin = r.skin, cap = r.cap;
  const st = spec.seat;

  // the torso, which stays with the car
  const torso = driverBody(r, st).concat([
    { g: cyl(0.1, 0.1, 0.1, 8, 'y', 0, st.y + 0.74, st.z), c: skin },
  ]);
  // the paint: the shared material, or a skin or gradient of this car's own
  const paintMat = paintMaterial(BODY_MAT, r.kart, r.trim, S.kart) || BODY_MAT;
  const chassisMesh = merge(spec.parts, paintMat);
  body.add(chassisMesh);
  // number plates, front and back, when they are worn
  if (S.kart.plate === 'plate_name') nameplates(body, chassisMesh, S.name || r.name);
  // something bolted on the back, stood on the bodywork where it is
  if (S.kart.decor && ART && ART.DECOR) {
    const make = ART.DECOR[S.kart.decor.replace(/^decor_/, '')];
    if (make) {
      try {
        const d = merge(make(r), BODY_MAT);
        chassisMesh.geometry.computeBoundingBox();
        const bb = chassisMesh.geometry.boundingBox;
        const z = bb.min.z + (bb.max.z - bb.min.z) * 0.78;
        plateRay.set(new THREE.Vector3(0, 20, z), new THREE.Vector3(0, -1, 0));
        const hit = plateRay.intersectObject(chassisMesh, false)[0];
        d.position.set(0, hit ? hit.point.y : bb.max.y, z);
        d.name = 'decor';
        body.add(d);
      } catch (e) { console.warn('decor', e); }
    }
  }
  // the driver's body on its own, so the character can take its place
  const torsoMesh = merge(torso, BODY_MAT);
  body.add(torsoMesh);

  /* The head and the arms move, so they are their own little groups rather than
     part of the merge. A driver who looks into the corner and turns the wheel
     with the wheel is most of what makes a kart look alive at speed. */
  const head = new THREE.Group();
  head.position.set(0, st.y + 0.8, -st.z);
  head.add(merge([{ g: ball(0.3, 0, 0.27, 0), c: skin }]
    .concat(driverHead(r)), BODY_MAT));
  body.add(head);

  /* The glider, stowed. It lives above the driver and is scaled to nothing
     until a ramp throws the car high enough to want it, which is the whole of
     the deploy animation: a wing that snaps open is a wing that reads at
     forty metres a second, and anything more elaborate would not. */
  const glider = new THREE.Group();
  const gliderArt = S.kart.glider && ART && ART.GLIDERS && ART.GLIDERS[S.kart.glider.replace(/^glider_/, '')];
  let gliderParts = null;
  if (gliderArt) { try { gliderParts = gliderArt(r); } catch (e) { console.warn('glider', e); } }
  if (gliderParts) glider.add(merge(gliderParts, BODY_MAT));
  else glider.add(merge([
    // a shallow V rather than a flat plate: a centre panel, a lower panel each
    // side and a tip below that, which is a hang glider in four boxes
    { g: box(2.5, 0.09, 1.5, 0, 0.16, 0), c: r.trim },
    { g: box(1.2, 0.08, 1.2, -1.7, 0.03, -0.12), c: r.trim },
    { g: box(1.2, 0.08, 1.2, 1.7, 0.03, -0.12), c: r.trim },
    { g: box(0.42, 0.07, 0.72, -2.32, -0.1, -0.26), c: shirt },
    { g: box(0.42, 0.07, 0.72, 2.32, -0.1, -0.26), c: shirt },
    { g: cyl(0.05, 0.05, 4.7, 6, 'x', 0, 0.22, 0.56), c: DARK },
    { g: cyl(0.04, 0.04, 0.95, 5, 'y', -0.6, -0.4, 0.12), c: DARK },
    { g: cyl(0.04, 0.04, 0.95, 5, 'y', 0.6, -0.4, 0.12), c: DARK },
  ], BODY_MAT));
  glider.position.set(0, st.y + 2.02, -st.z + 0.12);
  glider.userData.y0 = glider.position.y;
  glider.rotation.x = -0.14;
  glider.visible = false;
  body.add(glider);

  const arms = new THREE.Group();
  arms.position.set(0, st.y + 0.55, -(st.z + 0.1));
  arms.add(merge([
    { g: cyl(0.09, 0.09, 0.52, 7, 'y', -0.28, -0.02, 0.2), c: shirt },
    { g: cyl(0.09, 0.09, 0.52, 7, 'y', 0.28, -0.02, 0.2), c: shirt },
    { g: ball(0.12, -0.24, -0.06, 0.42), c: 0xfff6e2 },
    { g: ball(0.12, 0.24, -0.06, 0.42), c: 0xfff6e2 },
  ], BODY_MAT));
  arms.rotation.x = -0.5 - st.lean;
  body.add(arms);

  /* Every wheel is its own merge so the set can change without the car being
     rebuilt round it, and the body sits on whatever radius came back: a set of
     knobblies lifts the whole car by the difference. */
  const wheels = [];
  const WX = spec.track, WZ = spec.wheelbase;
  for (const [sx, sz, steers] of [[-1, 1, true], [1, 1, true], [-1, -1, false], [1, -1, false]]) {
    const hub = new THREE.Group();
    hub.position.set(sx * WX, tyre.r, -sz * WZ);
    const m = merge(tyre.parts.map(q => ({ g: q.g.clone(), c: q.c, cols: q.cols })), TYRE_MAT);
    /* A wheel is not symmetric: the rim face, the holes and the hub nut are all
       on its outside. Built once and used four times, the two on the left ended
       up showing the game their inside faces, so the left pair is turned about
       its own axle to put its outside out. */
    if (sx < 0) m.rotation.y = Math.PI;
    hub.add(m);
    body.add(hub);
    wheels.push({ hub, spin: m, steers, y0: tyre.r });
  }
  // and the body rides at the height its wheels give it
  body.position.y = tyre.r - spec.ride;

  // the contact patch, which lives outside the body group so it stays flat on
  // the road while the car above it leans, pitches and tumbles
  /* The car casts. Every kart in the game was drawing no shadow at all, which
     is most of why one sat on the road looking pasted onto it rather than
     standing on it: the scenery cast, the trees cast, and the one thing you
     spend the whole race looking at did not. The wheels are inside the body
     group, so this is all of it. */
  body.traverse(o => { if (o.isMesh) o.castShadow = true; });

  const shade = new THREE.Mesh(SHADOW_GEO, new THREE.MeshBasicMaterial({
    map: SHADOW_TEX, transparent: true, depthWrite: false, opacity: 0.85,
  }));
  /* No renderOrder games here: a transparent mesh forced to draw before the
     opaque world is one the road then paints straight over. It is worth saying
     that renderOrder was not what was wrong with this. The patch sat three
     centimetres over the surface project() reports and the road ribbon is
     drawn at six, so it has been under the tarmac all along - the draw order
     was a symptom that made sense and a cause that was not there. */
  group.add(shade);

  const kart = {
    who: r, group, body, wheels, shade, head, arms, glider, style: S,
    driverParts: { torsoMesh, st },
    build: b, trail: trailOf(b.trail), exhaust: spec.exhaust || [],
    /* What the parts bolted to it are worth, worked out once when it is built.

       This was set twice in this one object - here, and again as `parts: null`
       two dozen lines down - and the second one won, the way the second of any
       two keys in an object literal does. So `k.parts` was null for every kart
       in the game, every guard reading it took its `: 1` fallback, and not one
       of the numbers on the garage's stat bars did anything at all. A hauler on
       knobblies drove exactly like a formula car on wires. */
    parts: statsOf(b),
    // how far the suspension is compressed, and how far it has left to go
    squat: 0, squatV: 0,
    pos: new THREE.Vector3(), yaw: 0, speed: 0,
    drift: 0,            // -1 left, 1 right, 0 none
    driftT: 0, slide: 0, hop: 0, hopV: 0,
    pitch: 0, roadRise: 0, bash: false, hitBy: 0, launched: 0, onIce: 0, reslope: 0,
    straighten: 0,
    // the tumble: how far it is tipped, and how fast that is changing
    tumbleX: 0, tumbleZ: 0, wobX: 0, wobZ: 0, spinRate: 11,
    // velocity across the wheels, from being shoved: it decays as they bite
    pushX: 0, pushZ: 0,
    // how hard you are revving on the grid, which everybody can see
    rev: 0,
    boost: 0, spin: 0, slow: 0, star: 0, bullet: 0,
    // how long you have been sitting in somebody's air, and the shove it buys
    draftT: 0, draft: 0,
    // over nothing: how long for, and how far down
    falling: 0, fallV: 0, fallY: 0, overEdge: 0, rescue: 0,
    // a trick: whether one is running, which one, and how far through it is
    trick: 0, trickKind: 0, trickSpin: 0, trickWin: 0, hopped: 0,
    // the glider: out or not, and how far through opening it is
    glide: 0, glideOut: 0,
    // over an anti-gravity rail, and how much of a spin boost is still playing
    agrav: 0, spinB: 0,
    lap: 1, cpi: 0, prog: 0, place: 1, finished: 0,
    item: null, itemN: 0, roulette: 0,
    // what is queued behind the one in the slot, oldest first
    queue: [],
    hint: 0, offroad: false, wheelSpin: 0, steerVis: 0, lean: 0, topMul: 1, roll: 0, wet: false,
    /* Seconds of a flooded engine left to serve. Hold the throttle from the
       first light and the motor is still coughing when the flag drops, which
       is the price of trying to buy the start rather than time it. */
    stall: 0, revHold: 0,
    // the vertical half of the velocity while airborne, and the slope that put
    // it there
    airG: 9.81, roadSlope: 0,
  };
  // an aura round the whole car, for the ones that were hard to win
  if (S.kart.aura) { const a = makeAura(S.kart.aura); if (a) group.add(a); }
  apply(kart);
  if (!dressDriver(kart)) whenDrivers(() => dressDriver(kart));
  return kart;
}

/* The character in the seat. Scaled so it sits as tall as the driver built in
   code did, hips on the seat, facing up the car; the head and the arms go
   into the groups the kart already turns for looking and steering. A ghost is
   left as it was built: its materials were made see-through when it was, and
   a character dropped in afterwards would not be. */
const SIT_HEIGHT = 1.2;       // hip to the top of the head, in metres
function dressDriver(k) {
  if (k.dressed || k.ghost || !k.driverParts) return !!k.dressed;
  const D = driverFor(k.who && k.who.id);
  if (!D) return false;
  const { torsoMesh, st } = k.driverParts;
  const sc = SIT_HEIGHT / Math.max(0.2, D.top - D.hipAt.y);
  const seat = new THREE.Vector3(0, st.y + 0.14, -st.z);
  const put = (geo, at) => {
    const m = new THREE.Mesh(geo, D.mat);
    m.scale.setScalar(sc);
    m.castShadow = true;
    return m;
  };
  k.body.remove(torsoMesh);
  /* The character's colours. A unique driver is the whole character redone;
     otherwise any of skin, shirt and trousers the look sets, over whatever the
     racer's own are (Thomas's jacket and jeans), over the model's. */
  const S = k.style || normaliseStyle(null);
  const who = k.who || {};
  const DS = S.char.driver ? DRIVER_STYLE[S.char.driver] : null;
  const pick = (a, b) => (a !== null && a !== undefined ? a : b);
  const base = who.look || {};
  const look = DS ? { skin: DS.skin, shirt: DS.shirt, pants: DS.pants, hair: DS.hair }
    : { skin: pick(S.char.skin, base.skin), shirt: pick(S.char.shirt, base.shirt), pants: pick(S.char.pants, base.pants) };
  const custom = Object.keys(look).some(q => look[q] !== null && look[q] !== undefined);
  const G = custom ? tintDriver(D, look, who.id || '') : D;
  const mat = custom ? tintMaterial(DS ? { metal: DS.metal, glow: DS.glow, ghost: DS.ghost, skin: DS.skin } : null) : D.mat;
  const putT = geo => { const m = new THREE.Mesh(geo, mat); m.scale.setScalar(sc); m.castShadow = !(DS && DS.ghost); return m; };
  const torso = putT(G.torso);
  torso.position.copy(seat);
  k.body.add(torso);
  // the head turns about its neck: the group sits at the neck, the head in it
  const h = D.headAt.clone().sub(D.hipAt).multiplyScalar(sc);
  k.head.clear();
  k.head.position.set(0, seat.y + h.y, 0);
  const head = putT(G.head);
  head.position.set(h.x, 0, seat.z + h.z);
  k.head.add(head);
  // a hat on top of the head, and sunglasses on the face, sized to the head
  const hb = headBox(D);
  const fit = (parts, name) => {
    const m = merge(parts, BODY_MAT);
    m.name = name;
    m.scale.setScalar((hb.w * sc) / 0.55);
    m.position.set(head.position.x + hb.cx * sc, hb.top * sc, head.position.z + hb.cz * sc);
    k.head.add(m);
  };
  const hatId = S.char.hat ? S.char.hat.replace(/^hat_/, '') : null;
  if (hatId && ART && ART.HATS && ART.HATS[hatId]) { try { fit(ART.HATS[hatId](who), 'hat'); } catch (e) { console.warn('hat', e); } }
  const face = S.char.face || who.face;
  if (face === 'sunglasses' && ART && ART.sunglasses) { try { fit(ART.sunglasses(), 'shades'); } catch (e) { console.warn('shades', e); } }
  // and the arms about the shoulders
  const a = D.armsAt.clone().sub(D.hipAt).multiplyScalar(sc);
  k.arms.clear();
  k.arms.rotation.x = 0;
  k.arms.position.set(seat.x + a.x, seat.y + a.y, seat.z + a.z);
  k.arms.add(putT(G.arms));
  k.dressed = true;
  return true;
}

export function apply(k) {
  k.group.position.set(k.pos.x, k.pos.y + k.hop, k.pos.z);
  // The kart is drawn cocked INTO the corner, which is what a drift looks like:
  // slide is the angle travel sits away from the heading, so the body goes the
  // other way. Adding it instead swung the kart away from the turn, and pressing
  // right while drifting looked for all the world like going left.
  k.group.rotation.y = k.yaw - k.slide * 0.45;
  // rotation.z is applied before the yaw, so it rolls the kart about its own
  // length: that is the camber of the road under it
  k.group.rotation.z = k.roll + k.tumbleZ;
  k.group.rotation.x = k.tumbleX;
  // revving on the grid: a shake everybody can see, since rev rides along in the
  // position each browser sends
  // and the same rattle for a cattle grid, which is the point of a cattle grid
  const buzz = Math.max(k.rev > 0.02 ? k.rev : 0, k.shake || 0);
  if (buzz > 0.02) {
    const t = performance.now() * 0.001;
    k.group.position.x += Math.sin(t * 37) * 0.11 * buzz;
    k.group.position.z += Math.cos(t * 31) * 0.07 * buzz;
    k.group.position.y += Math.sin(t * 53) * 0.05 * (k.shake || 0);
  }
  if (k.shake > 0) k.shake = Math.max(0, k.shake - 0.06);
  /* The contact patch stays on the road and shrinks with height, which is what
     tells you how far up you are: the car itself gives you nothing to judge it
     against once the horizon has gone. */
  if (k.shade) {
    const up = Math.max(0, k.hop);
    /* Above the tarmac, not under it. The road ribbon is drawn six centimetres
       over the surface project() reports and the kerb seven, and this was sat
       at three: the contact patch every kart has had all along has been buried
       in the road the entire time and nobody has ever seen one. */
    k.shade.position.set(0, 0.09 - k.hop, 0);
    k.shade.rotation.y = -k.group.rotation.y;             // square to the world
    const f = 1 / (1 + up * 0.5);
    k.shade.scale.set(f, 1, f);
    k.shade.material.opacity = 0.85 * f * f;
    k.shade.visible = up < 9;
  }
  /* The trick. Three of them, cycled so the same jump twice does not look the
     same twice: a barrel roll, a backflip and a twist. They are drawn on the
     body rather than on the whole car so the contact patch below stays flat. */
  if (k.trick) {
    const a = k.trickSpin;
    if (k.trickKind === 0) k.body.rotation.z = k.lean + a;
    else if (k.trickKind === 1) k.body.rotation.x = -k.speed * 0.0012 + k.pitch - a;
    else { k.body.rotation.z = k.lean + a * 0.6; k.body.rotation.x = -a * 0.5; }
  } else {
    k.body.rotation.z = k.lean;
  }
  /* Anti-gravity: the car lifts off the rail rather than rolling along it, and
     a spin boost throws it through a full turn on the way out of the contact
     that caused it. body.rotation.y is free, so the spin is drawn there and
     the car keeps pointing where it is going. */
  k.hover = (k.hover || 0) + ((k.agrav ? 0.22 : 0) - (k.hover || 0)) * 0.12;
  if (k.hover > 0.004) k.group.position.y += k.hover;
  k.body.rotation.y = k.spinB > 0 ? (1 - k.spinB / 0.45) * Math.PI * 2 : 0;

  /* The wing, opening. It grows out of the tail and swings up over the driver
     rather than appearing, and it tilts with whatever the car is being asked
     to do in the air, so a dive looks like a dive. */
  if (k.glider) {
    const out = k.glideOut || 0;
    k.glider.visible = out > 0.02;
    if (k.glider.visible) {
      k.glider.scale.set(out, out, 0.45 + out * 0.55);
      k.glider.position.y = k.glider.userData.y0 - (1 - out) * 0.75;
      k.glider.rotation.x = -0.14 - k.pitch * 0.5;
      k.glider.rotation.z = -k.lean * 0.7;
    }
  }

  // nose up on the way up, nose down on the way down
  k.body.rotation.x = -k.speed * 0.0012 + k.pitch;
  void 0;
  /* The driver. Head turns into the corner and the shoulders follow it a beat
     later; the arms turn with the wheel. It is a few radians of nothing and it
     is most of what stops a kart at speed looking like a pushed brick. */
  if (k.head) {
    const into = k.steerVis * 1.5 + k.slide * 0.5;
    k.head.rotation.y = Math.max(-0.7, Math.min(0.7, into));
    k.head.rotation.z = -into * 0.22 - k.lean * 0.5;
    // and it ducks a little under hard acceleration, and lifts on the brakes
    k.head.position.z = -(k.who ? 0 : 0) + Math.min(0.06, Math.max(-0.06, -k.speed * 0.0016));
  }
  if (k.arms) k.arms.rotation.y = k.steerVis * 0.85;

  /* The suspension. Each wheel is pushed up into the body by how hard the car
     is being asked to do something: braking loads the front, power loads the
     back, and a corner loads the outside. Landing squashes all four. */
  for (const w of k.wheels) {
    w.hub.rotation.y = w.steers ? k.steerVis : 0;
    w.spin.rotation.x = k.wheelSpin;
    const front = w.hub.position.z > 0 ? -1 : 1;    // +z is the tail here
    const side = Math.sign(w.hub.position.x);
    const load = front * (k.pitch * 0.9) + side * k.lean * 0.6 + k.squat;
    w.hub.position.y = w.y0 + Math.max(-0.1, Math.min(0.12, load * 0.5));
  }
  const s = 1 + Math.min(0.14, k.boost * 0.5);
  k.group.scale.set(1 / (1 + (s - 1) * 0.4), 1, s);
}

/* ---- how it drives ------------------------------------------------------- */
export const TUNE = {
  accel: 15,
  top: 33.75,              // metres a second on tarmac, before boosts
  reverse: 9,
  brake: 26,
  drag: 5,
  steer: 1.9,              // radians a second at speed
  driftSteer: 2.6,
  offTop: 0.48,            // how much of your speed the grass leaves you
  offAccel: 0.45,
  boostTop: 1.45,
  starTop: 1.22,
  // A hop off the suspension, in metres a second. Everything that leaves the
  // ground from here on is a projectile under G, so this is a launch speed and
  // not a feel knob: 2.1 up and back down under gravity is about four tenths of
  // a second, which is the flick a drift wants.
  hopV: 2.1,
  G: 9.81,
};

/* What the place you are racing in does to a kart. Every circuit sets its own,
   and a kart carries the current one on itself so topSpeed() can be asked about
   a kart without also being handed the track. */
export const PLAIN = {
  grip: 1, slide: 0, top: 1, accel: 1, offTop: TUNE.offTop,
  driftCharge: 1, boost: 1, hop: 1,
};

/* The three mini turbo tiers, and what each is worth.

   Mario Kart runs them as blue, orange and purple: a short kick, a useful one,
   and one you plan a corner around. MT_AT is how much charge each needs, in
   seconds of holding a wide slide, and MT is how long the boost it pays lasts.
   A shallow drift charges at less than half the rate, which is the whole of
   what makes holding a wider line through a corner worth doing. */
export const MT_AT = [0.62, 1.35, 2.3];
const MT = [0.55, 1.05, 1.9];
export function driftTier(k) {
  const c = k.driftT || 0;
  return c >= MT_AT[2] ? 3 : c >= MT_AT[1] ? 2 : c >= MT_AT[0] ? 1 : 0;
}

export function topSpeed(k) {
  const R = k.rules || PLAIN;
  const P = k.parts;
  // topMul is the computer drivers' handicap, 1 for anyone at a keyboard
  let t = TUNE.top * R.top * (k.topMul || 1) * (P ? P.top : 1);
  if (k.stall > 0) t *= 0.5;                  // a coughing engine will not pull
  if (k.boost > 0) t *= TUNE.boostTop;
  if (k.star > 0) t *= TUNE.starTop;
  // and knobblies hardly notice the rough, which is what they are for
  if (k.offroad && k.star <= 0) t *= Math.min(0.95, R.offTop * (P ? P.rough : 1));
  if (k.slow > 0) t *= 0.55;
  return t;
}

/* input: { gas, brake, steer, hop, } with steer in -1..1 */
export function stepKart(k, input, track, dt) {
  // the rules of this place, picked up from the circuit the kart is on
  k.rules = (track && track.rules) || PLAIN;
  const R = k.rules;
  const top = topSpeed(k);

  /* ---- the bullet --------------------------------------------------------
     It takes the wheel off you. For as long as it lasts the car is driven down
     the middle of the road at a speed nothing else reaches, it cannot be
     steered and it cannot be stopped, and anything it touches is knocked flat.
     That is the whole of the item: the only decision is when to use it. */
  if (k.bullet > 0 && track) {
    k.bullet -= dt;
    k.spin = 0; k.drift = 0; k.driftT = 0; k.slide *= 0.85;
    const pr0 = track.project(k.pos.x, k.pos.z, k.hint);
    k.hint = pr0.i;
    // aimed a little way up the road, which is what keeps it on the line
    const look = track.at((pr0.s + 16) % track.length);
    const want = Math.atan2(-(look.p.x - k.pos.x), -(look.p.z - k.pos.z));
    let d = want - k.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k.yaw += d * Math.min(1, dt * 6);
    // and pulled back to the middle of the road, so it never leaves it
    const pull = -pr0.lateral * Math.min(1, dt * 2.4);
    k.pos.x += pr0.n.x * pull; k.pos.z += pr0.n.z * pull;
    k.speed += (TUNE.top * 1.85 - k.speed) * Math.min(1, dt * 2.2);
    k.pos.x += -Math.sin(k.yaw) * k.speed * dt;
    k.pos.z += -Math.cos(k.yaw) * k.speed * dt;
    const pr = track.project(k.pos.x, k.pos.z, k.hint);
    k.hint = pr.i;
    k.pos.y = pr.y;
    k.hop = 0; k.hopV = 0; k.launched = 0; k.falling = 0;
    k.roll += (Math.atan(pr.bank || 0) - k.roll) * Math.min(1, dt * 7);
    k.wheelSpin += k.speed * dt / 0.38;
    k.prog = pr.s;
    if (k.bullet <= 0) { k.bullet = 0; k.boost = Math.max(k.boost, 0.5); }
    return pr;
  }

  if (k.spin > 0) {
    // spun out: no control, just the tumble it was given
    k.spin -= dt;
    // and when it stops, half a second to find the way round again
    if (k.spin <= 0) k.straighten = 0.5;
    k.yaw += dt * (k.spinRate || 11);
    k.tumbleX += k.wobX * dt;
    k.tumbleZ += k.wobZ * dt;
    const settle = Math.exp(-2.1 * dt);
    k.wobX *= settle; k.wobZ *= settle;
    k.speed *= Math.exp(-3.4 * dt);
    k.drift = 0; k.driftT = 0; k.slide *= 0.9;
  } else {
    const gas = input.gas ? 1 : 0;
    const brake = input.brake ? 1 : 0;
    // Nothing under the wheels means nothing to push against and nothing to slow
    // you: off a ramp you keep exactly what you took off with, which is what
    // makes the jump worth taking.
    const flying = k.hop > 0.05;
    k.bash = !!input.hop;          // leaning on it as you make contact
    const acc = TUNE.accel * R.accel * (k.parts ? k.parts.accel : 1)
              * (k.offroad && k.star <= 0 ? TUNE.offAccel : 1)
              * (k.stall > 0 ? 0.3 : 1);
    if (flying) { /* airborne: the throttle and the brake are not connected to anything */ }
    else if (gas) k.speed += acc * dt * (k.speed < 0 ? 2.2 : 1);
    else if (brake) k.speed -= TUNE.brake * dt;
    else k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), TUNE.drag * dt);
    if (!gas && brake && !flying) k.speed = Math.max(k.speed, -TUNE.reverse);
    if (k.speed > top) k.speed -= (k.speed - top) * Math.min(1, dt * 4.5);

    /* ---- the hop, and the drift that follows it --------------------------
       Built the way Mario Kart 8 builds it.

       You hop, the back steps out, and the drift holds until you let the
       button go. Turning costs a little speed, as turning does, but the drift
       itself costs nothing: a kart that dropped speed the moment you committed
       and then wound back up is a kart that punishes you for using the one
       mechanic the whole game is about.

       The charge is a counter rather than a clock, and it fills faster the
       wider you are holding the stick: five a frame at full lock against two a
       frame at a shallow angle, which is what makes a deliberately wide slide
       worth taking and what "soft drifting" means. Three tiers come out of it,
       blue, orange and purple, each worth a longer boost than the last. */
    if (input.hop && k.hop <= 0.001 && k.drift === 0 && k.speed > 6 && !k.launched) {
      k.hopV = TUNE.hopV * R.hop * (k.parts ? k.parts.jump : 1);
      k.pendingDrift = Math.abs(input.steer) > 0.2 ? Math.sign(input.steer) : 0;
      k.hopped = 1;
    }
    if (k.hop > 0.02 && k.pendingDrift && k.drift === 0) { k.drift = k.pendingDrift; k.driftT = 0; }
    if (k.drift !== 0) {
      if (k.speed < 5) { k.drift = 0; k.driftT = 0; }
      else {
        // how far into the corner you are holding it, which is the whole of the
        // difference between a tidy drift and a quick one
        const wide = Math.abs(input.steer) > 0.55 || Math.sign(input.steer) === k.drift;
        k.driftT += dt * (wide ? 1 : 0.42) * R.driftCharge * (k.parts ? k.parts.charge : 1);
      }
    }
    if (!input.hop && k.drift !== 0) {
      /* Let go and whatever tier was reached comes out, for as long as it was
         held. Mario Kart does not pay a flat amount per colour: the boost runs
         anywhere from about a second to about three depending on how far into
         the charge you were when you released, which is why holding a purple
         a moment longer is worth doing rather than letting it go the instant
         it turns. A third again across a tier is the span of it. */
      const tier = driftTier(k);
      if (tier) {
        const from = MT_AT[tier - 1];
        const to = MT_AT[tier] === undefined ? from + 1.3 : MT_AT[tier];
        const into = Math.max(0, Math.min(1, (k.driftT - from) / (to - from)));
        const dur = MT[tier - 1] * (1 + into * 0.34);
        k.boost = Math.max(k.boost, dur * R.boost * (k.parts ? k.parts.boost : 1));
        k.mtFired = tier;             // so the game can make a noise about it
      }
      k.drift = 0; k.driftT = 0; k.pendingDrift = 0;
    }

    // steering: less lock at speed, more of it while sliding
    const grip = Math.min(1, Math.abs(k.speed) / 7);
    const lock = (k.drift !== 0 ? TUNE.driftSteer : TUNE.steer) * (1 - Math.min(0.42, Math.abs(k.speed) / top * 0.42));
    let steer = input.steer;
    if (k.drift !== 0) steer = k.drift * 0.55 + input.steer * 0.55;    // you can tighten or open the slide
    // in the air you can shift the nose, not steer
    // ice: the wheels turn, the kart does not
    k.yaw += steer * lock * grip * R.grip * (k.parts ? k.parts.grip : 1)
           * dt * (k.speed < -0.3 ? -1 : 1) * (flying ? 0.28 : 1) * (k.onIce ? 0.34 : 1);
    k.steerVis += (steer * 0.55 - k.steerVis) * Math.min(1, dt * 10);
    // and what slide there is hangs on longer, because nothing is scrubbing it off
    /* What the back end does when you are not asking it to. On a loose or icy
       circuit a slide does not simply stop when the drift does: it hangs on and
       has to be caught, which is the whole character of the place. */
    const wantSlide = k.drift !== 0 ? -k.drift * (0.3 + Math.abs(input.steer) * 0.22)
                    : (k.onIce ? k.slide * 0.9 : k.slide * R.slide);
    k.slide += (wantSlide - k.slide) * Math.min(1, dt * 6);
    /* And it rolls. Hard, in a drift: the whole car is thrown over onto its
       outside wheels and held there, which is most of what a Mario Kart drift
       looks like from behind. Out of one it is a light lean on the steering. */
    const wantLean = k.drift !== 0
      ? -k.drift * (0.2 + Math.min(0.14, k.driftT * 0.12)) - steer * 0.05
      : -steer * 0.06;
    k.lean += (wantLean - k.lean) * Math.min(1, dt * 8);
  }

  // Back onto its wheels once the spin is done. It always lands face up: a kart
  // on its roof is one nobody can do anything with.
  if (k.spin <= 0 && (k.tumbleX || k.tumbleZ)) {
    const up = Math.max(0, 1 - dt * 3.6);
    k.tumbleX *= up; k.tumbleZ *= up;
    if (Math.abs(k.tumbleX) < 0.008) k.tumbleX = 0;
    if (Math.abs(k.tumbleZ) < 0.008) k.tumbleZ = 0;
    k.wobX = 0; k.wobZ = 0;
  }

  // the hop arc
  if (k.hopV !== 0 || k.hop > 0) {
    /* y += vy*dt, vy -= G*dt. The whole of it, until the glider is out, and
       then the wing is carrying most of the weight. Hold nothing and it sinks
       slowly; hold the throttle and it flares and stays up longer; hold the
       brake and it puts the nose down, drops fast and turns the height it
       gives up into ground speed. That trade is the whole of a glider, and it
       is the only part of Mario Kart where the brake makes you quicker. */
    let g = TUNE.G;
    /* And only on the way down. A wing does not throw you higher, it stops you
       coming back: left over the whole arc it tripled the height of every jump,
       which is a trampoline and not a glider. Up is a plain projectile; past
       the apex the wing catches and the car sinks instead of falling. */
    if (k.glide && k.hopV < 0) {
      g *= input.brake ? 1 : input.gas ? 0.24 : 0.34;
      if (input.brake) k.speed = Math.min(top * 1.15, k.speed + 7 * dt);
    }
    k.hop += k.hopV * dt;
    k.hopV -= g * dt;
    if (k.hop <= 0) {
      // the springs take the landing: a kick into the dampers that settles out
      if (k.hopV < -2) k.squatV = Math.max(-9, k.hopV * 0.5);
      if (k.hopV < -4) k.landed = 1;        // a real landing, not the end of a flick
      /* A trick pulled in the air pays out here, the way it does in Mario Kart:
         land it and you get a boost worth about a blue mini turbo. It is also
         the only thing that ends the trick, so a car that never pressed the
         button simply lands. */
      if (k.trick) {
        k.boost = Math.max(k.boost, 0.62 * (k.parts ? k.parts.boost : 1));
        k.trick = 0; k.trickSpin = 0;
      }
      k.trickWin = 0;
      k.hop = 0; k.hopV = 0; k.launched = 0; k.glide = 0; k.airKeep = 0;
      /* Forget what the road was doing when you left it. Holding on to it meant
         the first frame back on the ground compared a stale climb against the
         flat it had just landed on, read that as a crest, and threw the kart
         straight back into the air: a jump, then a bounce, then another.

         Both of them, which is the half that was missing. The launch test reads
         roadSlope and only roadRise was being cleared, so the smoothed climb
         the car left the ramp carrying was still sitting there on the way down.
         One real jump off one real ramp came back as five, each a little
         smaller than the last as the stale number decayed: 0.84, 0.68, 0.48,
         0.35, and the car spent half the lap in the air for no reason anybody
         driving it could see. Cleared, it refills from the road in about a
         fifth of a second, so a ramp straight after a landing still works. */
      k.roadRise = 0; k.reslope = 1;
    }
  }

  /* A trick. Press the same button in the window after leaving a ramp and the
     car throws a roll; it costs nothing to try and pays a boost on landing, so
     the answer is always to try, which is the point of it. */
  if (k.trickWin > 0) {
    k.trickWin -= dt;
    if (input.hop && !k.trick && k.hop > 0.2) { k.trick = 1; k.trickKind = (k.trickKind + 1) % 3; }
  }
  if (k.trick) k.trickSpin += dt * 7.4;

  // a spring and a damper on the body, which is all a suspension has to be
  k.squatV += (-k.squat * 46 - k.squatV * 9) * dt;
  k.squat += k.squatV * dt;
  if (Math.abs(k.squat) < 0.001 && Math.abs(k.squatV) < 0.01) { k.squat = 0; k.squatV = 0; }

  /* The slipstream. Sit in somebody's air for a few seconds and the car finds
     a shove worth about a mushroom, and it is gone the moment you touch
     anything. It is the one thing in a kart game that rewards patience, and
     without it a train of cars never breaks up. */
  if (k.draftT >= 2.6 && k.draft <= 0) { k.draft = 0.9; k.boost = Math.max(k.boost, 0.9); k.draftT = 0; }
  if (k.draft > 0) k.draft = Math.max(0, k.draft - dt);
  if (k.wallHit || k.spin > 0) { k.draftT = 0; k.draft = 0; }

  if (k.spinB > 0) k.spinB = Math.max(0, k.spinB - dt);
  if (k.boost > 0) k.boost = Math.max(0, k.boost - dt);
  if (k.stall > 0) k.stall = Math.max(0, k.stall - dt);
  if (k.star > 0) k.star = Math.max(0, k.star - dt);
  if (k.slow > 0) k.slow = Math.max(0, k.slow - dt);

  // travel: the kart moves where it points, plus the slide
  const dir = k.yaw + k.slide * 0.35;
  k.pos.x += -Math.sin(dir) * k.speed * dt;
  k.pos.z += -Math.cos(dir) * k.speed * dt;
  // and whatever a shove left you carrying sideways, until the tyres take it out
  if (k.pushX || k.pushZ) {
    k.pos.x += k.pushX * dt;
    k.pos.z += k.pushZ * dt;
    const bite = Math.exp(-4.5 * dt);
    k.pushX *= bite; k.pushZ *= bite;
    if (Math.hypot(k.pushX, k.pushZ) < 0.05) { k.pushX = 0; k.pushZ = 0; }
  }
  k.wheelSpin += k.speed * dt / 0.38;

  // the surface, and the wall
  const pr = track.project(k.pos.x, k.pos.z, k.hint);
  k.hint = pr.i;
  /* Ice takes the grip away rather than the speed: the kart keeps rolling but
     the tyres stop answering, so a corner taken on a patch runs wide. Lava is
     the opposite - it does not slow you, it throws you. */
  /* A strip of something that is not tarmac down one side of the road. Sand
     holds you, ice takes the grip away, ash does a bit of both. It is checked
     before the ice patches so a patch can still override it. */
  k.onIce = 0;
  if (pr.strip && k.hop <= 0.05 && k.star <= 0) {
    if (pr.strip === 'ice') k.onIce = 1;
    else {
      k.speed *= Math.pow(pr.strip === 'sand' ? 0.55 : 0.72, dt);
      if (pr.strip === 'ash') k.onIce = 1;
    }
  }
  if (track.ice && k.hop <= 0.05) {
    for (const p of track.ice) {
      if (Math.hypot(k.pos.x - p.x, k.pos.z - p.z) > p.r) continue;
      k.onIce = 1;
      break;
    }
  }
  if (track.lava && k.hop <= 0.05 && k.star <= 0 && k.spin <= 0) {
    for (const p of track.lava) {
      const dx = k.pos.x - p.x, dz = k.pos.z - p.z;
      if (Math.hypot(dx, dz) > p.r) continue;
      spinOut(k, true, { x: -dx, z: -dz, speed: Math.max(18, Math.abs(k.speed)) });
      k.hopV = Math.max(k.hopV, 5.5);
      break;
    }
  }

  /* The island up the middle of the split, with the house standing on it. It is
     the fence turned inward: outside it you are in one lane or the other, inside
     it you are not on the road at all. Resolving it the same way the fence is
     resolved means clipping the kerb of it costs a scrape and driving square
     into it costs the corner, which is what the two should feel like.

     Doing it by lateral distance rather than by a circle round the house is also
     what makes the split a split: the whole length of the island stops you, not
     just the building, so the two lanes are genuinely separated. */
  if (pr.island > 0 && Math.abs(pr.lateral) < pr.island) {
    const side = pr.lateral >= 0 ? 1 : -1;
    const push = pr.island - Math.abs(pr.lateral);
    k.pos.x += pr.n.x * side * push;
    k.pos.z += pr.n.z * side * push;
    const nx = -pr.n.x * side, nz = -pr.n.z * side;   // into the kerb
    const v = velOf(k);
    const vn = v.x * nx + v.z * nz;
    if (vn > 0) {
      const tx = v.x - vn * nx, tz = v.z - vn * nz;
      v.x = tx * 0.86 - nx * vn * 0.22;
      v.z = tz * 0.86 - nz * vn * 0.22;
      setVel(k, v);
    }
    if (vn > 17) spinOut(k, vn > 27, { x: -nx, z: -nz, speed: vn });
    const lane = Math.atan2(-pr.t.x, -pr.t.z);
    let d = lane - k.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k.yaw += d * 0.35;
    k.drift = 0; k.driftT = 0;
    k.wallHit = 1;
    k.walls = (k.walls || 0) + 1;        // frames spent against a wall, for measuring drivers
  }

  // over the grass but not on it: a jump is not a trip through the rough
  k.offroad = !pr.onRoad && !pr.onKerb && k.hop <= 0.05;
  // under the surface, when there is a surface to be under
  k.wet = pr.waterY !== null && (k.pos.y + k.hop + 0.7) < pr.waterY;

  /* Leaving the ground the way a car does. While the road climbs it is lifting
     you at your speed times its slope, and the moment it stops climbing that
     lift is yours with nothing holding you down. So a fast run at a ramp throws
     you further than a slow one, and a gentle hill does not throw you at all. */
  // A drift flick only lifts the kart a couple of hand widths, so it must not
  // be able to block a ramp: pressing the button on the way up should add to
  // the launch, not cancel it.
  /* And only from the road. Half off the tarmac on a banked corner the blend
     down to the field is steep, and reading that as a ramp threw the car
     skyward for putting two wheels on the kerb, which is the single most
     annoying thing a kart game can do to you. */
  if (k.hop <= 0.35 && k.spin <= 0 && !k.launched && pr.onRoad && !pr.onKerb) {
    /* Leaving a ramp is a projectile problem and nothing else. The road was
       climbing at an angle th = atan(slope); a kart travelling at v along it has
       a vertical component v*sin(th) and a horizontal one v*cos(th). Take the
       first as the launch speed, leave the second as the road speed, and from
       there it is just y" = -G: it rises for v*sin(th)/G seconds, reaches
       v^2*sin^2(th)/2G, and comes down as far away as it went up.

       The bar is where it is because a ramp lifts you several metres a second and
       the rolling ground lifts you one or two, and a gentle hill that launched
       the kart would leave it airborne all lap with no wheels to accelerate on. */
    /* The bar is low, and the second half of the test is what keeps a rolling
       hill from launching anybody: slope is read off the sample the kart is on,
       so it steps rather than glides, and only a real crest drops it in a single
       frame. That is why coming out of the water, or off any ramp back onto the
       flat, catches a little air, while the long rise and fall of the ground
       catches none. */
    /* Leaving the ground is about the road, not about you.

       This used to test the climb rate times your speed, which meant driving
       over a booster threw the car into the air: the speed jumped, the product
       jumped with it, and the next frame read the drop back as the lip of a
       ramp. It is the slope alone now, so a crest is a crest whatever speed you
       arrive at it. */
    /* First frame back on the ground: take the road as it is, and do not
       launch off it. Carried across a landing, the climb the car left the ramp
       with was still sitting in here on the way down, read as a crest against
       the flat it had just landed on, and threw the car straight back up - one
       jump off one ramp coming back as five, each smaller than the last, which
       is the bounce nobody asked for. Forgetting it outright cost a fifth of a
       second of refill and missed a ramp taken straight after a hop; adopting
       it outright let a single raw sample decide a launch, which is the noise
       the smoothing is here to ignore. So it adopts and sits the frame out. */
    if (k.reslope) { k.roadSlope = pr.slope; k.reslope = 0; }
    /* A crest throws you if it is a ramp, a hump or the run up to a gap; any
       other crest only if it is a sharp one, and then only a hop. */
    else if ((pr.jump ? k.roadSlope > 0.075 : k.roadSlope > 0.13) && pr.slope < k.roadSlope * 0.5) {
      k.launched = 1;          // and not again until the wheels are back down
      const th = Math.atan(k.roadSlope);
      let up = Math.abs(k.speed) * Math.sin(th);
      // pulling up on it as you leave adds a little, the way a hop does
      // pulling up on it is worth something, not worth everything: a fifth
      // more and a little off the bottom, so a hop cannot dwarf the ramp
      // pulling up on it is worth a third more, and nothing on its own: a hop
      // that adds a fixed amount dwarfs a gentle ramp and does nothing to a
      // steep one, which is backwards
      if (input.hop) up *= 1.35;
      /* And a ceiling on it. Mario Kart throws you a car length or two into the
         air off a ramp, never over the scenery: anything past about four metres
         is the surface having said something it did not mean. */
      // a ramp can throw you as high as it likes up to that; a hump only a hop
      k.hopV = Math.max(k.hopV, Math.min(pr.jump === 2 ? 9 : pr.jump === 1 ? 4.5 : 3.2, up * (k.parts ? k.parts.jump : 1)));
      // off a ramp, or off the run up to a canyon, the wing comes out as you leave
      if (pr.jump === 2 || pr.chasm) k.glide = 1;
      // a jump meant as one keeps its height over whatever falls away beneath it
      if (pr.jump || pr.chasm) k.airKeep = 1;
      k.speed *= Math.cos(th);              // that lift came out of your road speed
      k.trickWin = 0.28;                    // the window to pull a trick in
    }
    // and remembered smoothed, so one noisy frame cannot look like a crest
    else k.roadSlope = k.roadSlope + (pr.slope - k.roadSlope) * Math.min(1, dt * 14);
  }
  /* A gap has to be cleared, not attempted. The lip before one says how far
     there is to go and the car works out how hard it has to leave from its
     own speed, so arriving slowly means a slow, high jump rather than a fall:
     the ramp does the throwing, which is what a ramp is for. */
  /* Even coming down from a hop: a drift hop timed onto the lip used to leave
     the car falling, which skipped the kicker and dropped it in the hole. */
  if (pr.launch && !k.falling) {
    const v = Math.max(9, Math.abs(k.speed));
    const need = (pr.launch * TUNE.G) / (2 * v) * 1.7;
    /* Topping up rather than replacing, and allowed to do so even if the slope
       already launched the car: the lip flattens before the edge, so the slope
       launch fires early and weakly, and a weak launch off a kicker is a car in
       the hole. It also sits outside the check that a launch only happens on
       the road, because the last thing before a gap is the edge of the road. */
    if (k.hopV < need) { k.hopV = need; k.launched = 1; k.trickWin = 0.3; }
    // a canyon is what the wing is for
    if (k.spin <= 0) k.glide = 1;
    k.airKeep = 1;
  }

  /* When the wing comes out. Anything that throws the car two metres or more
     is worth gliding; the flick off a drift hop, which clears about a fifth of
     one, is not. Working it from the launch speed rather than from the height
     reached means it opens as the car leaves the ramp, the way it does in
     Mario Kart, instead of halfway up. */
  if (!k.glide && k.spin <= 0 && k.hopV > 0
      && (k.hopV * k.hopV) / (2 * TUNE.G) > 2) k.glide = 1;
  // and over a drop: two metres of nothing under the car is worth a wing too
  if (!k.glide && k.spin <= 0 && k.hop > 2) k.glide = 1;
  if (k.spin > 0) k.glide = 0;
  k.glideOut += ((k.glide ? 1 : 0) - k.glideOut) * Math.min(1, dt * (k.glide ? 13 : 18));

  // the nose follows the arc
  const want = k.hop > 0.05 ? Math.atan2(k.hopV, Math.max(8, Math.abs(k.speed))) * 0.85 : 0;
  k.pitch += (want - k.pitch) * Math.min(1, dt * 7);
  /* ---- over nothing -----------------------------------------------------
     A gap in the road, or over the edge of a causeway, and there is no surface
     under the car at all. It stops being driven and starts being a falling
     object; the game notices and sends something to fish it out.

     The test is for the road being missing rather than for the car being low,
     because project() still reports a height over a gap: the samples are there,
     only the tarmac is not. Left to itself the car would drive straight across
     the hole on a floor that is not drawn. */
  /* Clearly off, not brushing it. Half a metre past the edge is a wheel over
     the line; two and a half is a car that has left. */
  const nothing = pr.gap || (pr.causeway > 0.4 && Math.abs(pr.lateral) > pr.wall + 2.4)
    || (pr.edgeOpen && Math.abs(pr.lateral) > pr.wall + 1.6);
  /* Airborne counts as airborne even on the frame the launch happens. hop is
     integrated at the top of the next step, so on the frame a ramp fires it is
     still zero while hopV is already several metres a second: testing hop alone
     dropped every car straight down the hole it had just been thrown over. */
  const flying = k.hop > 0.05 || k.hopV > 0.5;
  if (!k.falling && nothing && !flying && k.spin <= 0) {
    k.falling = 1;
    k.fallV = Math.min(0, k.hopV);
    k.fallY = k.pos.y;
    k.drift = 0; k.driftT = 0;
  }
  if (k.falling) {
    // a projectile again, and nothing under it to land on
    k.fallV -= TUNE.G * dt;
    k.fallY += k.fallV * dt;
    k.pos.y = k.fallY;
    k.speed *= Math.exp(-0.6 * dt);
    k.falling += dt;
    k.hop = 0; k.hopV = 0; k.launched = 0; k.roadRise = 0; k.reslope = 1; k.glide = 0; k.airKeep = 0;
    k.prog = pr.s;
    return pr;
  }
  /* In the air the car keeps its height in the world, not its height above
     whatever is under it. The hop is measured from the road, so when the road
     fell away beneath a car in flight - the floor of a canyon, the far side of
     a crest - the car fell with it, all the way down into the canyon and back
     up the other side, instead of sailing across. Now the hop takes up the
     difference: road drops, the car is that much higher above it. */
  /* Only for a real jump, or over an actual hole. A drift hop on an ordinary
     downhill still comes back to the road, as it should: the road keeps you on
     it everywhere that is not meant to be jumped. */
  if (k.hop > 0 && (k.airKeep || pr.gap) && k.groundY !== undefined) k.hop = Math.max(0, k.hop + (k.groundY - pr.y));
  k.groundY = pr.y;
  k.pos.y = pr.y;
  /* On your feet again, pointing where the road goes. A spin leaves the car
     facing wherever it happened to stop, which is as often backwards as not,
     and the first thing anybody should have to do after being hit is drive,
     not a three point turn. It eases rather than snaps, so it reads as the car
     gathering itself rather than as the game turning it for you. */
  if (k.straighten > 0) {
    k.straighten -= dt;
    const want = Math.atan2(-pr.t.x, -pr.t.z);
    let d = want - k.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k.yaw += d * Math.min(1, dt * 9);
  }
  k.agrav = pr.agrav ? 1 : 0;
  // ease onto the camber rather than snapping to it
  k.roll += (Math.atan(pr.bank || 0) - k.roll) * Math.min(1, dt * 7);
  /* A causeway has no fence on it. Everywhere else the edge of the tarmac is a
     barrier; here it is an edge, and going over it is the point. */
  if (pr.edgeOpen && Math.abs(pr.lateral) > pr.wall) {
    // no barrier here: nothing stops you going over
  } else if (Math.abs(pr.lateral) > pr.wall && pr.causeway > 0.4) {
    k.overEdge = 1;
  } else if (Math.abs(pr.lateral) > pr.wall) {
    /* A barrier is a collision like any other, so it is resolved like one. The
       velocity is split along the wall and into it; the part into it is reversed
       and mostly absorbed, the part along it is kept bar a scrape; and what comes
       out is turned back into a speed along the kart's own heading plus a shove
       across it, exactly as a kart to kart hit is.

       Clipping a wall at a shallow angle therefore costs you very little and a
       head on one costs you nearly everything, which is what it should do, and
       which the old flat multiply could not tell apart. */
    const push = (Math.abs(pr.lateral) - pr.wall) * Math.sign(pr.lateral);
    k.pos.x -= pr.n.x * push;
    k.pos.z -= pr.n.z * push;

    const into = pr.lateral > 0 ? 1 : -1;            // outward, along the normal
    const nx = pr.n.x * into, nz = pr.n.z * into;
    const v = velOf(k);
    const vn = v.x * nx + v.z * nz;                  // into the wall
    if (vn > 0) {
      const WALL_BOUNCE = 0.22, WALL_SCRAPE = 0.86;
      const tx = v.x - vn * nx, tz = v.z - vn * nz;  // along it
      v.x = tx * WALL_SCRAPE - nx * vn * WALL_BOUNCE;
      v.z = tz * WALL_SCRAPE - nz * vn * WALL_BOUNCE;
      setVel(k, v);
    }
    /* a heavy one throws you, and it throws you the way you hit it - on the
       ground. A barrier is a metre tall; a car sailing over a canyon several
       metres up has nothing to hit, and is only steered back over the road. */
    if (vn > 17 && k.hop < 1.2) spinOut(k, vn > 27, { x: -nx, z: -nz, speed: vn });
    // and the nose comes back round to the road, because a kart is not a puck
    const wallYaw = Math.atan2(-pr.t.x, -pr.t.z);
    let d = wallYaw - k.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    k.yaw += d * 0.35;
    k.drift = 0; k.driftT = 0;
    k.wallHit = 1;
    k.walls = (k.walls || 0) + 1;        // frames spent against a wall, for measuring drivers
  }
  // progress round the lap, for the running order
  k.prog = pr.s;
  return pr;
}

/* one kart bumping another: they push apart and swap a little speed */
/* Two karts touching.

   Treated as a collision between two bodies rather than a rule about who slows
   down. Each kart's velocity is a vector; the contact normal is the line between
   them; the impulse along that normal is the standard

       j = -(1 + e) * (va - vb).n / (1/ma + 1/mb)

   with e the restitution, which for a kart is low - they thud rather than
   bounce. Apply j/m to each and you have their new velocities.

   A car cannot simply move in whatever direction it is pushed, though: its
   wheels only roll one way. So each kart's new velocity is split into the part
   along its own heading, which becomes its speed, and the part across it, which
   becomes a sideways shove that decays as the tyres bite. That is why a rear
   ender passes speed forward and a side swipe puts somebody off their line.

   Leaning on the hop button as you make contact is worth mass: a basher counts
   as three karts to your one, and the mass ratio does the rest by itself. */
const RESTITUTION = 0.25;

function heading(k) {
  const d = k.yaw + k.slide * 0.35;
  return { x: -Math.sin(d), z: -Math.cos(d) };
}
function velOf(k) {
  const h = heading(k);
  return { x: h.x * k.speed + k.pushX, z: h.z * k.speed + k.pushZ };
}
function setVel(k, v) {
  const h = heading(k);
  k.speed = v.x * h.x + v.z * h.z;
  k.pushX = v.x - h.x * k.speed;
  k.pushZ = v.z - h.z * k.speed;
}

export function bump(a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > 1.9 || d < 1e-4) return false;
  const nx = dx / d, nz = dz / d;
  /* Mass. What the car is built out of decides how much of a shunt it takes
     and how much it hands out: a hauler on knobblies is nearly twice the kart a
     formula car on wires is, and the impulse below does the rest by itself.
     Leaning on the hop button as you make contact is worth three of you. */
  const ma = (a.bash ? 3 : 1) * (a.parts ? a.parts.weight : 1);
  const mb = (b.bash ? 3 : 1) * (b.parts ? b.parts.weight : 1);

  // out of each other first, the heavier one giving less ground
  const over = 1.9 - d;
  a.pos.x -= nx * over * (mb / (ma + mb)); a.pos.z -= nz * over * (mb / (ma + mb));
  b.pos.x += nx * over * (ma / (ma + mb)); b.pos.z += nz * over * (ma / (ma + mb));

  const av = velOf(a), bv = velOf(b);
  const closing = (av.x - bv.x) * nx + (av.z - bv.z) * nz;
  if (closing <= 0) return true;                 // already coming apart
  const j = -(1 + RESTITUTION) * closing / (1 / ma + 1 / mb);
  av.x += (j / ma) * nx; av.z += (j / ma) * nz;
  bv.x -= (j / mb) * nx; bv.z -= (j / mb) * nz;
  setVel(a, av); setVel(b, bv);
  a.hitBy = b.bash ? 1 : a.hitBy; b.hitBy = a.bash ? 1 : b.hitBy;
  return true;
}

/* Losing it.

   Which way a kart tumbles comes out of where it was hit. The direction of the
   blow is resolved against the kart's own nose: how much of it came from the
   side and how much from front or back. A tap on the right spins you left and
   rolls you the same way; a shunt from behind lifts the nose; a head on hit
   drops it. The harder the hit, the faster all three.

   The one liberty taken with the physics is the landing: however it tumbles, it
   comes back onto its wheels rather than finishing on its roof, because a kart
   lying upside down in the middle of a race is a kart nobody can do anything
   with. `hit` is { x, z, speed } - where the blow came from, and how hard. */
export function spinOut(k, hard, hit) {
  if (k.star > 0) return false;
  k.spin = hard ? 1.5 : 1.05;
  k.speed *= 0.18;
  k.boost = 0; k.drift = 0; k.driftT = 0;

  const h = heading(k);
  let side = 0, front = -1, mag = 1;
  if (hit && (hit.x || hit.z)) {
    const d = Math.hypot(hit.x, hit.z) || 1;
    const ux = hit.x / d, uz = hit.z / d;
    front = ux * h.x + uz * h.z;              // +1 from behind, -1 head on
    side = ux * -h.z + uz * h.x;              // left or right of the nose
    mag = Math.min(2.4, 0.55 + Math.abs(hit.speed || 12) / 15);
  }
  k.spinRate = (hard ? 11 : 8.2) * (Math.abs(side) > 0.12 ? -Math.sign(side) : 1) * mag;
  k.wobZ = -side * 5.8 * mag;                 // tapped on the right, rolls to the left
  // front is +1 when the blow came from ahead, so the sign flips: hit from
  // behind and the nose comes up, hit head on and it goes down
  k.wobX = -front * 3.8 * mag;
  if (hard) { k.wobZ *= 1.35; k.wobX *= 1.35; }
  return true;
}
