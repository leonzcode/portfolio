/* ---------------------------------------------------------------------------
   Leon Kart - the things that only happen where they happen.

   Every circuit carries a short list of these, and it is what you remember the
   place by. Hay comes across Sunfield Loop and the cattle grids rattle you;
   boulders come down the banking at Redrock Dunes and the wind shoves you on the
   straights; icicles drop out of the overhangs at Glacier Pass and the drifts
   grab you on the exits; the light gates at Neon Mile shut in your face and the
   springs throw you over them; Ember Hollow erupts.

   All of it is periodic and driven by the race clock, which every browser in a
   room already agrees on, so nothing here needs a single byte of network. A
   hazard is at the same point in its cycle on every screen because everybody is
   evaluating the same cosine of the same number. Only the consequences are
   local, exactly like the items: your browser decides what happened to your
   kart and tells the others what it did.

   Placement comes from the world seed, so a circuit drawn from seed 4321 has its
   geysers in the same places for everyone in the room.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

import { spinOut } from './kart.js?v=35';
import { merge, vertexMat, box, cyl } from './parts.js?v=35';

const TAU = Math.PI * 2;

/* ---- the models ----------------------------------------------------------- */
/* Small, cheap and readable at speed, and every one of them a single mesh with
   its colours in the vertices. A cattle grid drawn as a frame and seven bars is
   eight draw calls and there are four of them on the circuit; drawn this way
   the whole set costs four. Nothing here moves any part of itself
   independently, so there is no reason for any of them to be more than one. */
function model(look) {
  const bits = [];
  let rough = 0.85, emis = 0;

  if (look === 'hay') {
    // a round bale, banded, lying on its side so it rolls the way it looks
    bits.push({ g: cyl(1, 1, 1.9, 12, 'x', 0, 0, 0), c: 0xe0b954 });
    for (const x of [-0.62, 0, 0.62]) {
      const band = new THREE.TorusGeometry(1.01, 0.07, 5, 12).toNonIndexed();
      band.rotateY(Math.PI / 2);
      band.translate(x, 0, 0);
      bits.push({ g: band, c: 0xa8813a });
    }
  } else if (look === 'boulder') {
    const rock = new THREE.DodecahedronGeometry(1, 0).toNonIndexed();
    rock.scale(1, 0.92, 1.06);
    bits.push({ g: rock, c: 0x8a6b4e });
    const chip = new THREE.TetrahedronGeometry(0.42).toNonIndexed();
    chip.translate(0.6, 0.45, -0.3);
    bits.push({ g: chip, c: 0x6f553d });
    rough = 0.95;
  } else if (look === 'icicle') {
    const spike = new THREE.ConeGeometry(0.55, 3.4, 7).toNonIndexed();
    spike.rotateX(Math.PI);
    spike.translate(0, 1.7, 0);
    bits.push({ g: spike, c: 0xbfe8ff });
    rough = 0.2;
  } else if (look === 'ember') {
    bits.push({ g: new THREE.IcosahedronGeometry(0.85, 0).toNonIndexed(), c: 0x3a1c14 });
    const hot = new THREE.IcosahedronGeometry(1.1, 0).toNonIndexed();
    bits.push({ g: hot, c: 0xff5a18 });
    emis = 0xff5a18;
    rough = 0.9;
  } else if (look === 'grid') {
    // a cattle grid: bars across the road in a shallow frame
    bits.push({ g: box(1, 0.16, 1, 0, 0, 0), c: 0x6b6f78 });
    for (let i = -3; i <= 3; i++) {
      bits.push({ g: cyl(0.09, 0.09, 1, 6, 'x', 0, 0.14, -i * 0.14), c: 0x9aa2ae });
    }
    rough = 0.55;
  } else if (look === 'gate') {
    bits.push({ g: box(1, 0.85, 0.5, 0, 0, 0), c: 0x18203c });
    bits.push({ g: box(1.01, 0.3, 0.52, 0, 0, 0), c: 0xff2f6e });
    emis = 0xff2f6e;
    rough = 0.4;
  } else if (look === 'spring') {
    bits.push({ g: cyl(1, 1.08, 0.3, 14, 'y', 0, 0.15, 0), c: 0x101a30 });
    const ring = new THREE.TorusGeometry(0.72, 0.09, 6, 16).toNonIndexed();
    ring.rotateX(Math.PI / 2);
    ring.translate(0, 0.33, 0);
    bits.push({ g: ring, c: 0x8fe9ff });
    emis = 0x39d0ff;
    rough = 0.35;
  } else if (look === 'sand') {
    const pit = new THREE.CircleGeometry(1, 16).toNonIndexed();
    pit.rotateX(-Math.PI / 2);
    bits.push({ g: pit, c: 0xb98748 });
    rough = 1;
  } else if (look === 'drift') {
    const heap = new THREE.SphereGeometry(1, 12, 7, 0, TAU, 0, Math.PI / 2).toNonIndexed();
    heap.scale(1, 0.42, 1);
    bits.push({ g: heap, c: 0xf4fbff });
    rough = 1;
  } else if (look === 'vent') {
    const ring = new THREE.TorusGeometry(1.5, 0.35, 6, 14).toNonIndexed();
    ring.rotateX(Math.PI / 2);
    ring.translate(0, 0.16, 0);
    bits.push({ g: ring, c: 0x5a2a1c });
    emis = 0x8c2a0e;
    rough = 0.95;
  }
  if (!bits.length) bits.push({ g: box(0.2, 0.2, 0.2, 0, 0, 0), c: 0x888888 });

  const mat = vertexMat(rough, true);
  if (emis) { mat.emissive = new THREE.Color(emis); mat.emissiveIntensity = 0.9; }
  if (look === 'icicle') { mat.transparent = true; mat.opacity = 0.85; mat.metalness = 0.1; }
  const m = merge(bits, mat);
  m.receiveShadow = true;
  // a group, because the rest of this file positions and scales a group
  const g = new THREE.Group();
  g.add(m);
  return g;
}

/* a column of fire or steam, used by the geysers and shown only while it blows */
function plume() {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.4 - i * 0.18, 2 - i * 0.2, 5, 9, 1, true),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffd233 : 0xff5a18, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    m.position.y = 2.5 + i * 3.4;
    g.add(m);
  }
  return g;
}

/* the flat warning ring a faller or a geyser paints on the road before it goes */
function warnRing(colour) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.62, 1, 20), new THREE.MeshBasicMaterial({
    color: colour, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

/* ---------------------------------------------------------------------------
   Placement, which is the part that has to agree between browsers. Everything
   is spread evenly round the lap from a start offset drawn out of the seed, so
   no two circuits put theirs in the same place and every circuit puts them
   somewhere you have to deal with rather than somewhere you never go.
--------------------------------------------------------------------------- */
export function makeHazards(scene, track, seed) {
  const list = [];
  const group = new THREE.Group();
  group.name = 'hazards';
  scene.add(group);

  let s = ((seed | 0) * 2654435761) & 0x7fffffff || 7;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

  const L = track.length;
  const spec = (track.rules && track.rules.hazards) || [];

  // somewhere on the lap that is not a jump and not the split, because a hazard
  // you meet in the air or on the island nose is a hazard nobody can read
  const clear = arc => {
    for (const r of track.ramps) {
      const d = Math.abs(((arc - r.s + L) % L + L / 2) % L - L / 2);
      if (d < 26) return false;
    }
    const sp = track.splitAt;
    if (sp) {
      const d = Math.abs(((arc - sp.s + L) % L + L / 2) % L - L / 2);
      if (d < 55) return false;
    }
    return true;
  };
  const place = (k, n) => {
    let arc = ((0.13 + rnd() * 0.1 + k / n) % 1) * L;
    for (let t = 0; t < 40 && !clear(arc); t++) arc = (arc + 13) % L;
    return arc;
  };

  for (const h of spec) {
    for (let k = 0; k < h.n; k++) {
      const arc = place(k, h.n);
      const a = track.at(arc);
      const item = {
        kind: h.kind, spec: h, arc, i: a.i,
        // every one of them is at a different point in its cycle, or a circuit
        // fires all six geysers at once and then does nothing for six seconds
        phase: rnd(),
        p: a.p.clone(), n: a.n.clone(), t: a.t.clone(), w: a.w,
        hot: 0, cool: 0,
      };
      build(item);
      list.push(item);
    }
  }

  function put(mesh, x, y, z) {
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  function roadY(x, z, hint) { return track.project(x, z, hint).y; }

  function build(o) {
    const h = o.spec;
    if (o.kind === 'roller') {
      o.mesh = model(h.look);
      o.mesh.scale.setScalar(h.r);
      // turn about the road first and roll second, so the roll happens about the
      // bale's own axle rather than about the world
      o.mesh.rotation.order = 'YXZ';
      o.r = h.r;
      o.reach = o.w + h.r + 4;          // it rolls right across and off both sides
      group.add(o.mesh);
    } else if (o.kind === 'rumble') {
      o.mesh = model('grid');
      o.mesh.scale.set(o.w * 1.9, 1, 3.2);
      put(o.mesh, o.p.x, roadY(o.p.x, o.p.z, o.i) + 0.05, o.p.z);
      o.mesh.rotation.y = Math.atan2(o.t.x, o.t.z);
      o.half = 2.4;
    } else if (o.kind === 'gust') {
      // no model of its own: the dust is drawn as a moving sheet
      o.span = 34;
      o.sheet = new THREE.Mesh(new THREE.PlaneGeometry(o.w * 2.4, 7),
        new THREE.MeshBasicMaterial({ color: 0xe8c9a0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      o.sheet.position.set(o.p.x, roadY(o.p.x, o.p.z, o.i) + 3.4, o.p.z);
      o.sheet.rotation.y = Math.atan2(o.t.x, o.t.z);
      group.add(o.sheet);
    } else if (o.kind === 'bog') {
      // off the racing line, on one side or the other, where cutting costs you
      const side = rnd() < 0.5 ? -1 : 1;
      o.r = 3.4 + rnd() * 2.2;
      const lat = side * (o.w * (0.52 + rnd() * 0.3));
      o.p.addScaledVector(o.n, lat);
      o.mesh = model(h.look);
      o.mesh.scale.setScalar(o.r);
      put(o.mesh, o.p.x, roadY(o.p.x, o.p.z, o.i) + 0.06, o.p.z);
    } else if (o.kind === 'faller') {
      const lat = (rnd() * 1.4 - 0.7) * o.w;
      o.p.addScaledVector(o.n, lat);
      o.groundY = roadY(o.p.x, o.p.z, o.i);
      o.r = 2.2;
      o.mesh = model(h.look);
      o.mesh.visible = false;
      group.add(o.mesh);
      o.ring = warnRing(h.look === 'ember' ? 0xff7a1a : 0x8fe9ff);
      o.ring.scale.setScalar(o.r);
      put(o.ring, o.p.x, o.groundY + 0.08, o.p.z);
    } else if (o.kind === 'gate') {
      // it shuts across one half of the road, so there is always a way through
      o.side = rnd() < 0.5 ? -1 : 1;
      o.half = o.w * 0.5;
      o.p.addScaledVector(o.n, o.side * o.half);
      o.groundY = roadY(o.p.x, o.p.z, o.i);
      o.mesh = model('gate');
      o.mesh.scale.set(o.w, 1, 1);
      put(o.mesh, o.p.x, o.groundY + 0.5, o.p.z);
      o.mesh.rotation.y = Math.atan2(o.t.x, o.t.z);
    } else if (o.kind === 'spring') {
      const lat = (rnd() * 1.2 - 0.6) * o.w;
      o.p.addScaledVector(o.n, lat);
      o.r = 2.4;
      o.mesh = model('spring');
      o.mesh.scale.setScalar(o.r);
      put(o.mesh, o.p.x, roadY(o.p.x, o.p.z, o.i) + 0.02, o.p.z);
    } else if (o.kind === 'geyser') {
      const lat = (rnd() * 1.3 - 0.65) * o.w;
      o.p.addScaledVector(o.n, lat);
      o.groundY = roadY(o.p.x, o.p.z, o.i);
      o.r = 2.6;
      o.mesh = model('vent');
      o.mesh.scale.setScalar(o.r / 1.5);
      put(o.mesh, o.p.x, o.groundY + 0.04, o.p.z);
      o.jet = plume();
      o.jet.visible = false;
      put(o.jet, o.p.x, o.groundY, o.p.z);
      o.ring = warnRing(0xffd233);
      o.ring.scale.setScalar(o.r);
      put(o.ring, o.p.x, o.groundY + 0.09, o.p.z);
    }
  }

  /* ---- the cycle ---------------------------------------------------------- */
  /* dt moves the models, t decides where in its cycle each one is. Splitting
     them is what lets a hazard be frame rate independent and still identical on
     every screen: nothing integrates, everything is read off the clock. */
  function step(dt, t, karts, on) {
    for (const o of list) {
      const h = o.spec;
      const cyc = h.period ? ((t / h.period) + o.phase) % 1 : 0;
      if (o.cool > 0) o.cool -= dt;

      if (o.kind === 'roller') {
        // straight across the road and back, quickest through the middle
        const lat = Math.sin(cyc * TAU) * o.reach;
        const x = o.p.x + o.n.x * lat, z = o.p.z + o.n.z * lat;
        const y = roadY(x, z, o.i);
        o.mesh.position.set(x, y + h.r * 0.92, z);
        // rolling, which means turning about the axis it is travelling along
        o.mesh.rotation.y = Math.atan2(o.n.x, o.n.z);
        o.roll = (o.roll || 0) + (Math.cos(cyc * TAU) * o.reach * TAU / h.period) * dt / h.r;
        o.mesh.rotation.x = o.roll;
        for (const k of karts) {
          if (k.finished || k.spin > 0 || k.star > 0) continue;
          const dx = k.pos.x - x, dz = k.pos.z - z;
          if (Math.hypot(dx, dz) > h.r + 1.2) continue;
          const d = Math.max(0.01, Math.hypot(dx, dz));
          if (h.heavy) spinOut(k, false, { x: -dx / d, z: -dz / d, speed: 20 });
          else {
            k.speed *= 0.6;
            k.pushX += (dx / d) * 13; k.pushZ += (dz / d) * 13;
            k.drift = 0; k.driftT = 0;
          }
          if (on) on(k, h.look === 'boulder' ? 'a boulder' : 'a hay bale');
        }

      } else if (o.kind === 'rumble') {
        for (const k of karts) {
          if (k.finished || k.hop > 0.4) continue;
          if (Math.abs(k.pos.x - o.p.x) + Math.abs(k.pos.z - o.p.z) > o.w * 2.2) continue;
          const pr = track.project(k.pos.x, k.pos.z, k.hint);
          const along = Math.abs(((pr.s - o.arc + L) % L + L / 2) % L - L / 2);
          if (along > o.half) continue;
          // it rattles rather than stops: a little speed, and the drift is gone
          k.speed *= Math.pow(0.55, dt);
          k.shake = 0.5;
          if (k.drift !== 0) { k.drift = 0; k.driftT = 0; }
        }

      } else if (o.kind === 'gust') {
        // a long breath in and out, strongest in the middle of it
        const blow = Math.sin(cyc * TAU);
        const dir = o.gustSide || (o.gustSide = rnd() < 0.5 ? -1 : 1);
        o.sheet.material.opacity = 0.05 + Math.abs(blow) * 0.22;
        o.sheet.position.x = o.p.x + o.n.x * blow * 4;
        o.sheet.position.z = o.p.z + o.n.z * blow * 4;
        for (const k of karts) {
          if (k.finished || k.hop > 1.4) continue;
          const pr = track.project(k.pos.x, k.pos.z, k.hint);
          const along = Math.abs(((pr.s - o.arc + L) % L + L / 2) % L - L / 2);
          if (along > o.span) continue;
          const fade = 1 - along / o.span;
          const push = blow * dir * h.force * fade * dt;
          k.pos.x += o.n.x * push; k.pos.z += o.n.z * push;
        }

      } else if (o.kind === 'bog') {
        for (const k of karts) {
          if (k.finished || k.hop > 0.5 || k.star > 0) continue;
          if (Math.hypot(k.pos.x - o.p.x, k.pos.z - o.p.z) > o.r) continue;
          // it holds you rather than spinning you, which is worse
          k.speed *= Math.pow(1 - h.grab, dt);
          k.slow = Math.max(k.slow, 0.25);
          if (k.drift !== 0) { k.drift = 0; k.driftT = 0; }
          if (on && !o.cool) { on(k, h.look === 'sand' ? 'the sand' : 'a snow drift'); o.cool = 1.2; }
        }

      } else if (o.kind === 'faller') {
        // the last stretch of the cycle is the drop, and the ring says so first
        const warn = h.warn / h.period;
        const drop = cyc > 1 - warn ? (cyc - (1 - warn)) / warn : -1;
        if (drop < 0) {
          o.mesh.visible = false;
          o.ring.material.opacity = 0.12;
        } else {
          o.mesh.visible = true;
          const y = o.groundY + 26 * (1 - drop) * (1 - drop);
          o.mesh.position.set(o.p.x, y, o.p.z);
          o.mesh.rotation.y += dt * 3;
          o.ring.material.opacity = 0.2 + drop * 0.6;
          if (drop > 0.94 && !o.cool) {
            o.cool = h.period * 0.5;
            for (const k of karts) {
              if (k.finished || k.spin > 0 || k.star > 0) continue;
              const dx = k.pos.x - o.p.x, dz = k.pos.z - o.p.z;
              const d = Math.hypot(dx, dz);
              if (d > o.r) continue;
              spinOut(k, true, { x: dx / Math.max(0.01, d), z: dz / Math.max(0.01, d), speed: 24 });
              if (on) on(k, h.look === 'ember' ? 'a falling ember' : 'an icicle');
            }
          }
        }

      } else if (o.kind === 'gate') {
        // shut for most of the cycle, open for the rest of it
        const open = cyc < h.open;
        const lift = open ? 1 : 0;
        o.lift = (o.lift === undefined ? lift : o.lift + (lift - o.lift) * Math.min(1, dt * 7));
        o.mesh.position.y = o.groundY + 0.5 + o.lift * 4.2;
        // it dims when it is up, so open and shut read at a distance
        o.mesh.children[0].material.emissiveIntensity = open ? 0.2 : 1.4;
        if (o.lift > 0.35) continue;                 // up: nothing to hit
        for (const k of karts) {
          if (k.finished || k.spin > 0) continue;
          const dx = k.pos.x - o.p.x, dz = k.pos.z - o.p.z;
          // across the bar rather than round it: within half its width, and
          // within a car's length of the plane it stands in
          const across = Math.abs(dx * o.n.x + dz * o.n.z);
          const along = dx * o.t.x + dz * o.t.z;
          if (across > o.half || Math.abs(along) > 1.6) continue;
          if (k.hop > 2.6) continue;                 // sprung clean over it
          k.speed *= 0.3;
          k.pos.x -= o.t.x * (1.7 - Math.abs(along)) * Math.sign(along || 1);
          k.pos.z -= o.t.z * (1.7 - Math.abs(along)) * Math.sign(along || 1);
          k.drift = 0; k.driftT = 0; k.wallHit = 1;
          if (on && !o.cool) { on(k, 'a light gate'); o.cool = 0.8; }
        }

      } else if (o.kind === 'spring') {
        o.mesh.rotation.y = t * 2.4;
        for (const k of karts) {
          if (k.finished || k.hop > 0.3) continue;
          if (Math.hypot(k.pos.x - o.p.x, k.pos.z - o.p.z) > o.r) continue;
          k.hopV = Math.max(k.hopV, h.up);
          k.launched = 1;
          k.drift = 0; k.driftT = 0;
          if (on) on(k, null);
        }

      } else if (o.kind === 'geyser') {
        const warn = h.warn / h.period;
        const blow = cyc > 1 - warn * 0.5;
        const soon = cyc > 1 - warn;
        o.ring.material.opacity = soon ? 0.25 + Math.abs(Math.sin(t * 18)) * 0.55 : 0.12;
        o.jet.visible = blow;
        if (blow) {
          const f = (cyc - (1 - warn * 0.5)) / (warn * 0.5);
          o.jet.scale.set(1, 0.4 + f * 1.3, 1);
          for (const c of o.jet.children) c.material.opacity = 0.45 * (1 - f * 0.6);
          for (const k of karts) {
            if (k.finished || k.hop > 1) continue;
            if (Math.hypot(k.pos.x - o.p.x, k.pos.z - o.p.z) > o.r) continue;
            k.hopV = Math.max(k.hopV, h.up);
            k.launched = 1;
            k.drift = 0; k.driftT = 0;
            if (on && !o.cool) { on(k, 'a geyser'); o.cool = 1.4; }
          }
        }
      }
    }
  }

  /* what a computer driver should try to miss: the ones that are actually
     dangerous right now, in the same shape as the item hazards it already reads */
  function threats(t) {
    const out = [];
    for (const o of list) {
      const h = o.spec;
      if (o.kind === 'roller') { if (o.mesh) out.push({ x: o.mesh.position.x, z: o.mesh.position.z }); }
      else if (o.kind === 'bog') out.push({ x: o.p.x, z: o.p.z });
      else if (o.kind === 'gate') { if (o.lift !== undefined && o.lift < 0.5) out.push({ x: o.p.x, z: o.p.z }); }
      else if (o.kind === 'geyser' || o.kind === 'faller') {
        const cyc = h.period ? ((t / h.period) + o.phase) % 1 : 0;
        if (cyc > 1 - (h.warn / h.period)) out.push({ x: o.p.x, z: o.p.z });
      }
    }
    return out;
  }

  return {
    list, step, threats, group,
    get count() { return list.length; },
  };
}
