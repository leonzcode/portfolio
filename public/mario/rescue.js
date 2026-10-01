/* ---------------------------------------------------------------------------
   Leon Kart - getting you out of a hole.

   Some circuits have gaps in them with nothing underneath. Miss the jump, or go
   over the edge of a causeway, and you fall; a balloon comes down after you,
   picks the car up, carries it back to the last piece of road you were on, and
   sets it down facing the right way.

   It costs you the time it takes and all of your speed, which is exactly the
   right price: a gap you can take at the wrong angle and lose two seconds to is
   a gap worth being careful about, and a gap that ends your race is a gap
   nobody would ever jump.

   One balloon is built per kart that needs one and thrown away afterwards.
   There are never many at once, and a race can go by without a single one.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

import { merge, vertexMat, box, cyl, ball } from './parts.js?v=89';

const DROP = 0.85;        // how long it lets you fall before it turns up
const LIFT = 1.0;         // how long the lift itself takes
const SET = 0.55;         // and how long it hangs there before letting go

/* The balloon: a canopy, a basket, and the lines between them. One mesh for the
   canopy because it is the only part that has to be its own colour, and one for
   everything else. */
function build(colour) {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(2.1, 14, 9),
    new THREE.MeshStandardMaterial({ color: colour, roughness: 0.55, flatShading: true })
  );
  canopy.scale.set(1, 1.15, 1);
  canopy.position.y = 4.6;
  g.add(canopy);

  const rig = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 1.15, z = Math.sin(a) * 1.15;
    const line = box(0.07, 2.4, 0.07, x, 2.1, -z);
    line.translate(0, 0, 0);
    rig.push({ g: line, c: 0xe9e2d2 });
  }
  rig.push({ g: cyl(1.35, 1.15, 0.5, 12, 'y', 0, 0.75, 0), c: 0x8a5a36 });
  rig.push({ g: cyl(1.4, 1.4, 0.14, 12, 'y', 0, 1.02, 0), c: 0x6b4526 });
  rig.push({ g: ball(0.34, 0, 1.5, 0), c: 0xffd9b0 });                 // whoever is flying it
  rig.push({ g: box(0.62, 0.14, 0.62, 0, 1.78, 0), c: 0x2b56d6 });     // and their hat
  g.add(merge(rig, vertexMat(0.75, true)));

  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function makeRescue(scene, track) {
  const live = [];

  /* Where to put somebody back. The last sample before the gap they went into,
     in the middle of the road, which is the only place that is certainly there. */
  function safeSpot(k) {
    const N = track.samples.length;
    const i = k.hint || 0;
    /* Clear here means clear of its neighbours too. project() calls a stretch a
       hole when EITHER end of it is one, because that is the same test the
       ribbon uses when it decides not to draw a quad - so a sample that is not
       itself a hole but sits next to one still reads as no road at all. Putting
       a car down there dropped it straight back in, which is a balloon lifting
       you out of a hole and posting you into it again for the rest of the race.
       Checking one sample was the whole of the bug. */
    const clear = j => {
      for (let d = -1; d <= 1; d++) {
        const q = track.samples[(j + d + N * 2) % N];
        if (q.gap || q.causeway > 0.02) return false;
      }
      return true;
    };
    for (let n = 0; n < N; n++) {
      const a = track.samples[(i - n + N * 2) % N];
      if (!clear((i - n + N * 2) % N)) continue;
      /* Well back from whatever they fell into, not on the lip of it. Set down
         on the edge of a gap with no speed, a car simply drives into it again,
         and again, for the rest of the race. Twenty six samples is about sixty
         metres, which is enough road to be back at racing speed by the time the
         hole comes round again even from a dead stop on the slowest circuit. */
      let at = a;
      for (let b = 1; b <= 26; b++) {
        const j = (i - n - b + N * 2) % N;
        if (!clear(j)) break;
        at = track.samples[j];
      }
      return {
        x: at.p.x, z: at.p.z, y: track.project(at.p.x, at.p.z, at.i).y,
        yaw: Math.atan2(-at.t.x, -at.t.z), i: at.i,
      };
    }
    const a = track.samples[0];
    return { x: a.p.x, z: a.p.z, y: a.p.y, yaw: Math.atan2(-a.t.x, -a.t.z), i: 0 };
  }

  /* Somebody has gone over. Called once per fall; the balloon does the rest. */
  function send(k) {
    if (k.rescue) return;
    k.rescue = 1;
    const to = safeSpot(k);
    const g = build(k.who ? k.who.trim : 0xffd233);
    g.position.set(k.pos.x, k.pos.y + 16, k.pos.z);
    scene.add(g);
    live.push({ k, g, to, t: 0, from: null });
  }

  function step(dt) {
    for (let n = live.length - 1; n >= 0; n--) {
      const r = live[n];
      const k = r.k;
      r.t += dt;

      if (r.t < DROP) {
        // it is on its way down while you are still falling
        const f = r.t / DROP;
        r.g.position.set(k.pos.x, k.pos.y + 16 * (1 - f) + 3.4, k.pos.z);
        continue;
      }
      if (!r.from) {
        r.from = { x: k.pos.x, y: k.pos.y, z: k.pos.z };
        k.falling = 0; k.fallV = 0;
        k.speed = 0; k.spin = 0; k.slide = 0;
        k.pushX = 0; k.pushZ = 0;
        k.tumbleX = 0; k.tumbleZ = 0; k.wobX = 0; k.wobZ = 0;
        k.hop = 0; k.hopV = 0; k.launched = 0; k.roadRise = 0;
      }

      const f = Math.min(1, (r.t - DROP) / LIFT);
      const e = f * f * (3 - 2 * f);
      // carried across in a shallow arc, so it reads as being flown rather than
      // slid along a line
      const x = r.from.x + (r.to.x - r.from.x) * e;
      const z = r.from.z + (r.to.z - r.from.z) * e;
      const y = r.from.y + (r.to.y + 2.6 - r.from.y) * e + Math.sin(Math.PI * e) * 5;
      k.pos.set(x, y, z);
      k.yaw = r.to.yaw;
      k.hint = r.to.i;
      k.prog = track.project(x, z, r.to.i).s;
      r.g.position.set(x, y + 3.4, z);
      r.g.rotation.y = r.to.yaw;

      if (r.t > DROP + LIFT + SET) {
        // let go: back on the road, pointing the right way, and stopped
        const at = track.project(r.to.x, r.to.z, r.to.i);
        k.pos.set(r.to.x, at.y, r.to.z);
        k.hint = at.i;
        k.prog = at.s;
        k.falling = 0; k.overEdge = 0; k.rescue = 0;
        k.speed = 0;
        scene.remove(r.g);
        r.g.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        live.splice(n, 1);
      }
    }
  }

  function clear() {
    for (const r of live) {
      // whatever state the carry was in, the car is its own again
      r.k.falling = 0; r.k.fallV = 0; r.k.overEdge = 0; r.k.rescue = 0;
      scene.remove(r.g);
      r.g.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    live.length = 0;
  }

  return { send, step, clear, get busy() { return live.length; } };
}
