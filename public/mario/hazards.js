/* ---------------------------------------------------------------------------
   Leon Cart - the things that only happen where they happen.

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

import { spinOut } from './kart.js?v=24';

const TAU = Math.PI * 2;

/* ---- the models ----------------------------------------------------------- */
/* Small, cheap and readable at speed. Everything is flat shaded and low poly to
   sit with the rest of the game, and each one is built once and reused. */
function model(look) {
  const g = new THREE.Group();
  const mat = (c, rough, emis) => new THREE.MeshStandardMaterial({
    color: c, roughness: rough === undefined ? 0.85 : rough, flatShading: true,
    emissive: emis || 0x000000, emissiveIntensity: emis ? 0.85 : 0,
  });
  if (look === 'hay') {
    // a round bale, banded, lying on its side so it rolls the way it looks
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.9, 12), mat(0xe0b954));
    bale.rotation.z = Math.PI / 2;
    g.add(bale);
    for (const z of [-0.62, 0, 0.62]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.01, 0.07, 5, 12), mat(0xa8813a));
      band.position.x = z;
      band.rotation.y = Math.PI / 2;
      g.add(band);
    }
  } else if (look === 'boulder') {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), mat(0x8a6b4e, 0.95));
    rock.scale.set(1, 0.92, 1.06);
    g.add(rock);
    const chip = new THREE.Mesh(new THREE.TetrahedronGeometry(0.42), mat(0x6f553d, 0.95));
    chip.position.set(0.6, 0.45, -0.3);
    g.add(chip);
  } else if (look === 'icicle') {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.4, 7), new THREE.MeshStandardMaterial({
      color: 0xbfe8ff, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.85, flatShading: true,
    }));
    spike.rotation.x = Math.PI;              // point down
    spike.position.y = 1.7;
    g.add(spike);
  } else if (look === 'ember') {
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), mat(0x3a1c14, 0.9, 0xff5a18));
    g.add(ball);
    const hot = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0), new THREE.MeshBasicMaterial({
      color: 0xff8a1f, transparent: true, opacity: 0.32,
    }));
    g.add(hot);
  } else if (look === 'grid') {
    // a cattle grid: bars across the road in a shallow frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 0.16, 1), mat(0x6b6f78, 0.7));
    g.add(frame);
    for (let i = -3; i <= 3; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 6), mat(0x9aa2ae, 0.4));
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 0.14, i * 0.14);
      g.add(bar);
    }
  } else if (look === 'gate') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.85, 0.5), new THREE.MeshStandardMaterial({
      color: 0x18203c, roughness: 0.4, emissive: 0xff2f6e, emissiveIntensity: 1.1, flatShading: true,
    }));
    g.add(bar);
  } else if (look === 'spring') {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.08, 0.3, 14), new THREE.MeshStandardMaterial({
      color: 0x101a30, roughness: 0.35, emissive: 0x39d0ff, emissiveIntensity: 1.2,
    }));
    pad.position.y = 0.15;
    g.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 6, 16), new THREE.MeshBasicMaterial({ color: 0x8fe9ff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.33;
    g.add(ring);
  } else if (look === 'sand') {
    const pit = new THREE.Mesh(new THREE.CircleGeometry(1, 16), new THREE.MeshStandardMaterial({
      color: 0xb98748, roughness: 1,
    }));
    pit.rotation.x = -Math.PI / 2;
    g.add(pit);
  } else if (look === 'drift') {
    const heap = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 7, 0, TAU, 0, Math.PI / 2), new THREE.MeshStandardMaterial({
      color: 0xf4fbff, roughness: 1, flatShading: true,
    }));
    heap.scale.set(1, 0.42, 1);
    g.add(heap);
  } else if (look === 'vent') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.35, 6, 14), mat(0x2a1a18, 0.95, 0x8c2a0e));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.16;
    g.add(ring);
  }
  for (const o of g.children) { o.castShadow = true; o.receiveShadow = true; }
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
        o.mesh.material = o.mesh.material;
        for (const c of o.mesh.children) c.material.emissiveIntensity = open ? 0.25 : 1.3;
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
        o.mesh.children[1].rotation.z = t * 2.4;
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
