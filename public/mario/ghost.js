/* ---------------------------------------------------------------------------
   Ghosts.

   A ghost is a race somebody drove, played back so you can drive against it.
   It is recorded as the kart's own state - where it was, which way it pointed,
   how it leaned, how far the wheel was turned, whether the wing was out -
   twenty times a second of race time, and played back through the same
   apply() that draws every other kart. So a ghost looks exactly like the run
   it came from, tricks and all, and stays right if the way karts are drawn
   ever changes.

   It is not in the field. It has no place, cannot be hit, cannot be bumped,
   cannot be targeted and does not finish: nothing that walks the list of
   karts ever meets it, because it is not in the list.

   Twenty one bytes a sample. Position and heading are sent as the change
   since the last sample, in centimetres and milliradians, which fits sixteen
   bits at any speed the game can reach; the rest are absolute and small
   enough for a byte. A ninety second race is about thirty seven kilobytes,
   and a little more once it is written as text to go over the wire.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { makeKart, apply, racerOf } from './kart.js?v=62';
import { unpackLook } from './parts.js?v=62';

export const GHOST_RATE = 20;
export const GHOST_BYTES = 21;
// how long the recording runs on past the line, so a ghost coasts through it
const TAIL = 2.5;

const TAU = Math.PI * 2;
const wrap = a => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const i8 = v => Math.max(-127, Math.min(127, Math.round(v)));
const u8 = v => Math.max(0, Math.min(255, Math.round(v)));

/* One sample of the kart as apply() will need to see it again. Height is taken
   with the hop folded in, because a ghost casts no shadow and the hop only
   decides where the shadow goes. Heading is kept continuous across whole
   turns, so a spin is a spin and not a jump from one side of the circle to
   the other. */
function snap(k, prev) {
  let yaw = k.yaw;
  if (prev) yaw = prev.yaw + wrap(yaw - prev.yaw);
  return {
    x: k.pos.x, y: k.pos.y + (k.hop || 0), z: k.pos.z, yaw,
    slide: k.slide || 0, roll: (k.roll || 0) + (k.tumbleZ || 0), tumbleX: k.tumbleX || 0,
    lean: k.lean || 0, pitch: k.pitch || 0, steer: k.steerVis || 0, squat: k.squat || 0,
    trickSpin: k.trick ? (k.trickSpin || 0) : 0,
    speed: Math.max(0, k.speed || 0), glide: k.glideOut || 0, spinB: k.spinB || 0,
    boost: k.boost || 0,
    flags: (k.agrav ? 1 : 0) | (k.trick ? 2 : 0) | (((k.trickKind || 0) & 3) << 2),
  };
}
function mix(a, b, t) {
  const o = {};
  for (const key in a) o[key] = key === 'flags' ? (t < 0.5 ? a.flags : b.flags) : a[key] + (b[key] - a[key]) * t;
  return o;
}

/* ---- the recorder --------------------------------------------------------
   Fed the player's kart at the end of every frame. A sample falls due every
   twentieth of a second of race time, which is almost never exactly at the
   end of a frame, so each one is worked out between the frame before and the
   frame after: the path recorded is the path driven, not the path rounded to
   whenever the screen happened to draw. */
export function makeRecorder() {
  let rows = [], next = 0, prev = null, prevT = 0, laps = [], lastLap = 1, endAt = -1, start = null;
  return {
    begin(k, slot) {
      rows = []; next = 0; prevT = 0; laps = []; lastLap = k.lap || 1; endAt = -1;
      prev = snap(k, null);
      start = { slot: slot | 0 };
    },
    get active() { return !!start && (endAt < 0 || prevT < endAt); },
    tick(t, k) {
      if (!start || (endAt >= 0 && t > endAt)) return;
      const cur = snap(k, prev);
      while (next <= t + 1e-9) {
        const a = t > prevT ? Math.max(0, Math.min(1, (next - prevT) / (t - prevT))) : 1;
        rows.push(mix(prev, cur, a));
        next += 1 / GHOST_RATE;
      }
      prev = cur; prevT = t;
      // a lap done is a split to race against
      if ((k.lap || 1) > lastLap && !k.finished) { laps.push(t); lastLap = k.lap; }
      if (k.finished && endAt < 0) { laps.push(k.time); endAt = k.time + TAIL; }
    },
    /* The finished recording, ready to keep or send - or nothing, if the race
       was not finished under the car's own power. */
    finish(meta) {
      if (!start || endAt < 0 || rows.length < GHOST_RATE) return null;
      return encode(rows, Object.assign({ slot: start.slot, laps: laps.slice(0, 3) }, meta));
    },
    // for a test
    get rows() { return rows; },
  };
}

/* ---- on the wire ---------------------------------------------------------- */
function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function encode(rows, meta) {
  const n = rows.length;
  const buf = new ArrayBuffer(n * GHOST_BYTES);
  const dv = new DataView(buf);
  const r0 = rows[0];
  // kept from the deltas actually written, so the reader lands exactly here too
  let px = Math.round(r0.x * 100), py = Math.round(r0.y * 100), pz = Math.round(r0.z * 100);
  let pyaw = Math.round(r0.yaw * 1000);
  const d16 = (o, v, p) => { const d = Math.max(-32767, Math.min(32767, v - p)); dv.setInt16(o, d, true); return p + d; };
  for (let i = 0; i < n; i++) {
    const r = rows[i], o = i * GHOST_BYTES;
    px = d16(o, Math.round(r.x * 100), px);
    py = d16(o + 2, Math.round(r.y * 100), py);
    pz = d16(o + 4, Math.round(r.z * 100), pz);
    pyaw = d16(o + 6, Math.round(r.yaw * 1000), pyaw);
    dv.setInt8(o + 8, i8(r.slide * 100));
    dv.setInt8(o + 9, i8(wrap(r.roll) * 40));
    dv.setInt8(o + 10, i8(wrap(r.tumbleX) * 40));
    dv.setInt8(o + 11, i8(r.lean * 100));
    dv.setInt8(o + 12, i8(r.pitch * 100));
    dv.setInt8(o + 13, i8(r.steer * 100));
    dv.setInt8(o + 14, i8(r.squat * 100));
    dv.setInt8(o + 15, i8(wrap(r.trickSpin) * 40));
    dv.setUint8(o + 16, u8(r.speed * 255 / 90));
    dv.setUint8(o + 17, u8(r.glide * 255));
    dv.setUint8(o + 18, u8(r.spinB * 255 / 0.45));
    dv.setUint8(o + 19, u8(Math.min(0.28, r.boost) * 255 / 0.28));
    dv.setUint8(o + 20, r.flags & 255);
  }
  return Object.assign({
    v: 1, rate: GHOST_RATE, n,
    x0: Math.round(r0.x * 100) / 100, y0: Math.round(r0.y * 100) / 100,
    z0: Math.round(r0.z * 100) / 100, yaw0: Math.round(r0.yaw * 1000) / 1000,
    d: toB64(new Uint8Array(buf)),
  }, meta);
}
/* Back into one array per channel. Refuses anything that is not exactly the
   size it says it is, because this came over the wire from somebody else. */
export function decode(g) {
  if (!g || g.v !== 1 || g.rate !== GHOST_RATE || !(g.n >= 2)) return null;
  let bytes;
  try { bytes = fromB64(g.d); } catch (e) { return null; }
  const n = g.n;
  if (bytes.length !== n * GHOST_BYTES) return null;
  const dv = new DataView(bytes.buffer);
  const F = () => new Float32Array(n);
  const T = { n, rate: GHOST_RATE, dur: (n - 1) / GHOST_RATE,
    x: F(), y: F(), z: F(), yaw: F(), slide: F(), roll: F(), tumbleX: F(), lean: F(), pitch: F(),
    steer: F(), squat: F(), trickSpin: F(), speed: F(), glide: F(), spinB: F(), boost: F(),
    flags: new Uint8Array(n) };
  let px = Math.round(g.x0 * 100), py = Math.round(g.y0 * 100), pz = Math.round(g.z0 * 100);
  let pyaw = Math.round(g.yaw0 * 1000);
  for (let i = 0; i < n; i++) {
    const o = i * GHOST_BYTES;
    px += dv.getInt16(o, true); py += dv.getInt16(o + 2, true);
    pz += dv.getInt16(o + 4, true); pyaw += dv.getInt16(o + 6, true);
    T.x[i] = px / 100; T.y[i] = py / 100; T.z[i] = pz / 100; T.yaw[i] = pyaw / 1000;
    T.slide[i] = dv.getInt8(o + 8) / 100;
    T.roll[i] = dv.getInt8(o + 9) / 40;
    T.tumbleX[i] = dv.getInt8(o + 10) / 40;
    T.lean[i] = dv.getInt8(o + 11) / 100;
    T.pitch[i] = dv.getInt8(o + 12) / 100;
    T.steer[i] = dv.getInt8(o + 13) / 100;
    T.squat[i] = dv.getInt8(o + 14) / 100;
    T.trickSpin[i] = dv.getInt8(o + 15) / 40;
    T.speed[i] = dv.getUint8(o + 16) * 90 / 255;
    T.glide[i] = dv.getUint8(o + 17) / 255;
    T.spinB[i] = dv.getUint8(o + 18) * 0.45 / 255;
    T.boost[i] = dv.getUint8(o + 19) * 0.28 / 255;
    T.flags[i] = dv.getUint8(o + 20);
  }
  return T;
}

/* ---- the look ------------------------------------------------------------
   You can see the car and you can see through it. Every material on it is its
   own copy - the body and tyre materials are shared by every kart in the
   race, and making the shared ones see-through would turn the whole field
   into ghosts - and each copy is drawn washed pale blue, see-through in the
   middle and brightest at its edges, which is the thing that reads as a
   ghost rather than as a car that has faded. No shadow, and it pulses a
   little, slowly, the way a thing that is not quite there does. */
const RIM = `
{
  vec3 gv = normalize( vViewPosition );
  float rim = 1.0 - clamp( abs( dot( normalize( normal ), gv ) ), 0.0, 1.0 );
  outgoingLight = mix( outgoingLight, vec3( 0.62, 0.9, 1.0 ), 0.35 )
                + vec3( 0.55, 0.85, 1.0 ) * pow( rim, 2.2 ) * 0.9;
  diffuseColor.a *= 0.45 + 0.55 * pow( rim, 1.6 );
}
#include <opaque_fragment>`;
function ghostMaterial(m) {
  const g = m.clone();
  g.transparent = true;
  g.depthWrite = false;
  g.opacity = 0.62;
  g.userData.base = 0.62;
  if (g.emissive) { g.emissive = new THREE.Color(0x6fc8ff); g.emissiveIntensity = 0.28; }
  if (g.isMeshStandardMaterial || g.isMeshPhongMaterial || g.isMeshLambertMaterial) {
    // the rim, where the shader has the place to put it; plain see-through where it does not
    g.onBeforeCompile = sh => {
      if (sh.fragmentShader.indexOf('#include <opaque_fragment>') >= 0 &&
          sh.fragmentShader.indexOf('vViewPosition') >= 0) {
        sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', RIM);
      }
    };
    g.customProgramCacheKey = () => 'leonkart-ghost';
  }
  return g;
}
function ghostify(k) {
  // the contact patch is a shadow, and a ghost does not throw one
  if (k.shade) { if (k.shade.parent) k.shade.parent.remove(k.shade); k.shade = null; }
  const mats = [];
  k.group.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = false;
    o.renderOrder = 4;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map(ghostMaterial);
    out.forEach(m => mats.push(m));
    o.material = Array.isArray(o.material) ? out : out[0];
  });
  return mats;
}

/* ---- a ghost in the world ------------------------------------------------ */
export function makeGhost(scene, g, label) {
  const T = decode(g);
  if (!T) return null;
  const look = unpackLook(g.look);
  const k = makeKart(racerOf(look.cast, look.colour), look.build);
  const mats = ghostify(k);
  k.name = label || 'Ghost';
  k.ghost = true;
  scene.add(k.group);
  const G = { k, T, mats, meta: g, t: 0, gone: false, fade: 1 };
  pose(G, 0, 0);
  return G;
}
const lerp = (a, b, t) => a + (b - a) * t;
const lerpA = (a, b, t) => a + wrap(b - a) * t;
/* Where the run was at race time t, and the kart drawn there. Before the
   start it sits where the run started, which is the grid slot you are in,
   so it starts inside your car. After the recording runs out it holds still
   and fades away. */
export function pose(G, t, dt) {
  const T = G.T, k = G.k;
  const f = Math.max(0, Math.min(T.n - 1, t * T.rate));
  const i = Math.min(T.n - 2, Math.floor(f)), a = f - i, j = i + 1;
  k.pos.set(lerp(T.x[i], T.x[j], a), lerp(T.y[i], T.y[j], a), lerp(T.z[i], T.z[j], a));
  k.hop = 0;
  k.yaw = lerp(T.yaw[i], T.yaw[j], a);
  k.slide = lerp(T.slide[i], T.slide[j], a);
  k.roll = lerpA(T.roll[i], T.roll[j], a); k.tumbleZ = 0;
  k.tumbleX = lerpA(T.tumbleX[i], T.tumbleX[j], a);
  k.lean = lerp(T.lean[i], T.lean[j], a);
  k.pitch = lerp(T.pitch[i], T.pitch[j], a);
  k.steerVis = lerp(T.steer[i], T.steer[j], a);
  k.squat = lerp(T.squat[i], T.squat[j], a);
  k.speed = lerp(T.speed[i], T.speed[j], a);
  k.glideOut = lerp(T.glide[i], T.glide[j], a);
  k.spinB = lerp(T.spinB[i], T.spinB[j], a);
  k.boost = lerp(T.boost[i], T.boost[j], a);
  const fl = T.flags[a < 0.5 ? i : j];
  k.agrav = fl & 1; k.trick = (fl >> 1) & 1; k.trickKind = (fl >> 2) & 3;
  k.trickSpin = lerpA(T.trickSpin[i], T.trickSpin[j], a);
  k.rev = 0; k.shake = 0;
  k.wheelSpin = (k.wheelSpin || 0) + k.speed * (dt || 0) / 0.38;
  apply(k);
  // the pulse, and the fade once the run it came from is over
  const over = t - T.dur;
  G.fade = over > 0 ? Math.max(0, 1 - over / 1.2) : 1;
  const pulse = 0.88 + 0.12 * Math.sin(performance.now() * 0.0028);
  for (const m of G.mats) m.opacity = m.userData.base * pulse * G.fade;
  k.group.visible = G.fade > 0.01;
  G.t = t;
}
export function dropGhost(scene, G) {
  if (!G) return;
  scene.remove(G.k.group);
  // only the copies it made; the geometry and the shared materials belong to everybody
  for (const m of G.mats) m.dispose();
}
