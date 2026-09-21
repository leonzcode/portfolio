/* ---------------------------------------------------------------------------
   Items.

   Seven of them, and the part that matters is not what they do but who gets
   them: the roulette is weighted by where you are in the running order, so the
   racer at the back draws the things that close a gap and the leader draws the
   things you can only leave behind you. That single rule is what keeps a race
   worth watching to the last corner.

   Everything is drawn from primitives and pooled, and each item carries its own
   little SVG for the slot in the corner of the screen.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { spinOut } from './kart.js?v=39';

const svg = (inner) => '<svg viewBox="0 0 64 64" width="100%" height="100%">' + inner + '</svg>';
const K = 'stroke="#17223b" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';

export const ITEMS = {
  turbo: {
    name: 'Turbo', triple: true,
    face: svg('<path d="M32 8 L50 34 H40 L44 56 L18 28 H30 L26 8 Z" fill="#ffd233" ' + K + '/>'),
  },
  slick: {
    name: 'Slick', drop: true,
    face: svg('<ellipse cx="32" cy="40" rx="24" ry="14" fill="#3a3f4a" ' + K + '/>'
            + '<ellipse cx="24" cy="36" rx="6" ry="3" fill="#8fd3ff" stroke="none"/>'),
  },
  peel: {
    name: 'Banana', drop: true, triple: true,
    face: svg('<path d="M12 20 Q18 48 46 52 Q58 52 56 44 Q40 44 26 30 Q20 24 20 18 Z" fill="#ffd233" ' + K + '/>'
            + '<path d="M12 20 Q14 14 20 18" fill="none" ' + K + '/>'),
  },
  bolt: {
    name: 'Bolt', shoot: true, triple: true,
    face: svg('<circle cx="32" cy="34" r="20" fill="#43d94f" ' + K + '/>'
            + '<path d="M16 30 Q32 18 48 30" fill="none" ' + K + '/>'),
  },
  seeker: {
    name: 'Seeker', shoot: true, homing: true, triple: true,
    face: svg('<circle cx="32" cy="34" r="20" fill="#e8402a" ' + K + '/>'
            + '<path d="M22 26 L32 42 L42 26" fill="none" ' + K + '/>'),
  },
  bomb: {
    name: 'Bomb', shoot: true,
    face: svg('<circle cx="30" cy="38" r="19" fill="#17223b" ' + K + '/>'
            + '<path d="M40 22 Q48 14 54 18" fill="none" stroke="#ffd233" stroke-width="5" stroke-linecap="round"/>'),
  },
  oil: {
    // thrown over your shoulder: it lands on everybody else's screen, not yours
    name: 'Oil Can', self: true, others: true,
    face: svg('<path d="M14 26 h30 l8 8 v18 a4 4 0 0 1 -4 4 H18 a4 4 0 0 1 -4 -4 Z" fill="#3a3f4a" ' + K + '/>'
            + '<path d="M44 30 q10 -8 14 -2" fill="none" stroke="#17223b" stroke-width="5" stroke-linecap="round"/>'
            + '<circle cx="52" cy="18" r="5" fill="#17223b" stroke="none"/>'),
  },
  bullet: {
    /* The comeback item. It takes the wheel off you for a few seconds and drives
       the car down the racing line at a speed you cannot otherwise reach,
       knocking over anything in the way. You only get it a long way back, and
       it stops the moment you are not. */
    name: 'Bullet', self: true,
    face: svg('<path d="M32 6 q13 12 13 28 v14 a4 4 0 0 1 -4 4 H23 a4 4 0 0 1 -4 -4 V34 Q19 18 32 6 Z" fill="#8fd3ff" ' + K + '/>'
            + '<path d="M22 50 l-6 10 h12 z" fill="#ffd233" ' + K + '/>'
            + '<path d="M42 50 l6 10 H36 z" fill="#ffd233" ' + K + '/>'
            + '<circle cx="25" cy="28" r="4" fill="#17223b" stroke="none"/>'
            + '<circle cx="39" cy="28" r="4" fill="#17223b" stroke="none"/>'),
  },
  star: {
    name: 'Star', self: true,
    face: svg('<path d="M32 6 L40 26 L62 26 L44 39 L51 59 L32 46 L13 59 L20 39 L2 26 L24 26 Z" fill="#ffd233" ' + K + '/>'),
  },
  plant: {
    /* The rare one. It rides on the nose for a few seconds and bites whatever
       comes near: a kart gets spun, a banana or an oil slick gets eaten, and
       every bite drags you forward a little. Nothing to aim and nothing to
       throw, which is the point of it - it is the item you use by driving at
       people. */
    name: 'Snapper', self: true,
    face: svg('<path d="M30 54 h10 v-16 h-10 z" fill="#2f9440" ' + K + '/>'
            + '<path d="M18 30 q0 -16 17 -16 q17 0 17 16 q0 4 -3 6 q-14 -6 -28 0 q-3 -2 -3 -6 z" fill="#e8402a" ' + K + '/>'
            + '<path d="M18 34 q0 14 17 14 q17 0 17 -14 q-14 7 -34 0 z" fill="#c9302a" ' + K + '/>'
            + '<path d="M24 34 l4 6 l4 -6 l4 6 l4 -6" fill="none" stroke="#fff6e2" stroke-width="3"/>'),
  },
  surge: {
    name: 'Surge', self: true,
    face: svg('<path d="M36 4 L14 34 H28 L22 60 L50 26 H34 Z" fill="#8fd3ff" ' + K + '/>'),
  },
};

/* What the box gives you, by where you are. Lower rows are further back. */
const TABLE = [
  // place 1st
  [['peel', 6], ['slick', 4], ['bolt', 3], ['turbo', 2]],
  [['peel', 5], ['slick', 3], ['bolt', 4], ['turbo', 3], ['seeker', 1]],
  [['peel', 3], ['bolt', 3], ['turbo', 4], ['seeker', 3], ['slick', 2], ['bomb', 1], ['oil', 1], ['plant', 1]],
  [['peel', 2], ['turbo', 4], ['seeker', 4], ['bomb', 2], ['bolt', 2], ['star', 1], ['oil', 2], ['plant', 2]],
  [['turbo', 3], ['seeker', 4], ['bomb', 2], ['star', 2], ['surge', 2], ['oil', 2], ['plant', 2], ['bullet', 1]],
  // last rows
  [['turbo', 2], ['seeker', 3], ['star', 3], ['surge', 3], ['bomb', 2], ['oil', 2], ['plant', 2], ['bullet', 3]],
];

/* Where you are in the order decides the row; where you are racing bends it.
   Ember Hollow deals bombs and stars, Glacier Pass deals slicks, Neon Mile deals
   turbos. The bias is a multiplier on the weights rather than a separate table,
   so the catch up in the rows above still works the same everywhere. */
export function rollItem(place, field, bias) {
  const row = TABLE[Math.min(TABLE.length - 1, Math.max(0, Math.round((place - 1) / Math.max(1, field - 1) * (TABLE.length - 1))))];
  const b = bias || {};
  let total = 0;
  for (const r of row) total += r[1] * (b[r[0]] === undefined ? 1 : b[r[0]]);
  let pick = Math.random() * total;
  for (const r of row) {
    pick -= r[1] * (b[r[0]] === undefined ? 1 : b[r[0]]);
    if (pick <= 0) return r[0];
  }
  return row[0][0];
}
// three of something, sometimes, when you are well back
export function rollCount(id, place, field) {
  if (!ITEMS[id].triple) return 1;
  const back = place / Math.max(1, field);
  return (back > 0.55 && Math.random() < 0.45) ? 3 : 1;
}

/* ---- what they look like in the world ------------------------------------ */
function shapeFor(kind) {
  const g = new THREE.Group();
  const mat = (c, e) => new THREE.MeshStandardMaterial({ color: c, emissive: e === undefined ? 0 : e, emissiveIntensity: 0.4, roughness: 0.4 });
  if (kind === 'slick') {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.14, 14), mat(0x2a2f38));
    m.position.y = 0.09; g.add(m);
  } else if (kind === 'peel') {
    // a curl of skin lying on the road: a squashed torus section, ends and all
    const body = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.17, 6, 10, Math.PI * 1.15), mat(0xffd233));
    body.rotation.x = Math.PI / 2;
    body.scale.set(1, 1, 0.55);
    body.position.y = 0.17;
    g.add(body);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 0.42, 5), mat(0x8a5a36));
    stalk.position.set(0.55, 0.3, 0.3);
    stalk.rotation.z = 0.9;
    g.add(stalk);
  } else if (kind === 'bolt') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), mat(0x43d94f, 0x43d94f)));
    g.position.y = 0.62;
  } else if (kind === 'seeker') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), mat(0xe8402a, 0xe8402a)));
    g.position.y = 0.62;
  } else if (kind === 'bomb') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.66, 1), mat(0x17223b)));
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), mat(0xffd233, 0xffd233));
    f.position.set(0.3, 0.55, 0); f.rotation.z = -0.6; g.add(f);
    g.position.y = 0.66;
  }
  for (const c of g.children) c.castShadow = true;
  return g;
}

export function makeItemWorld(scene, track, fx) {
  const live = [];        // projectiles
  const hazards = [];     // things lying on the road

  function spawn(kind, owner, karts, ghost) {
    if (kind === 'slick' || kind === 'peel') {
      const g = shapeFor(kind);
      const back = owner.yaw;
      g.position.set(owner.pos.x + Math.sin(back) * 2.6, owner.pos.y + 0.02, owner.pos.z + Math.cos(back) * 2.6);
      scene.add(g);
      g.rotation.y = Math.random() * Math.PI * 2;
      hazards.push({ kind, g, owner: owner.id, t: 0, x: g.position.x, z: g.position.z,
                     r: kind === 'peel' ? 1.15 : 1.5, ghost: !!ghost });
      return;
    }
    if (kind === 'bolt' || kind === 'seeker' || kind === 'bomb') {
      const g = shapeFor(kind);
      const fwd = owner.yaw;
      g.position.set(owner.pos.x - Math.sin(fwd) * 2.4, owner.pos.y + 0.6, owner.pos.z - Math.cos(fwd) * 2.4);
      scene.add(g);
      const p = {
        kind, g, owner: owner.id, t: 0, ghost: !!ghost,
        x: g.position.x, z: g.position.z, yaw: fwd,
        speed: kind === 'bomb' ? 26 : kind === 'seeker' ? 36 : 42,
        hint: owner.hint, target: null, life: kind === 'bomb' ? 1.6 : 7,
      };
      if (kind === 'seeker') p.target = aheadOf(owner, karts);
      live.push(p);
      return;
    }
  }

  function aheadOf(owner, karts) {
    // the racer one place in front, which is who a homing item is for
    let best = null, bestGap = Infinity;
    for (const k of karts) {
      if (k === owner || k.finished) continue;
      const gap = lapProg(k, track) - lapProg(owner, track);
      if (gap > 0 && gap < bestGap) { bestGap = gap; best = k; }
    }
    return best;
  }

  /* ---- held behind you ---------------------------------------------------
     In Mario Kart you hold the button rather than tapping it, and the shell or
     the banana sits a couple of metres off your tail. It is a threat and a
     shield at the same time: anything coming up behind hits that instead of
     you, which is most of why holding a green shell is worth more than
     throwing one, and why the car in front of you dawdling with a banana out
     is a car you cannot simply drive into.

     It hangs off the kart's own group, so it follows the car round corners for
     free and needs nothing per frame. Local +z is behind here, the same
     convention the rest of the car is built in. */
  function hold(kind, owner) {
    if (!owner || owner.holdMesh) return;
    const g = shapeFor(kind);
    g.position.set(0, 0.6, 2.7);
    g.scale.setScalar(0.85);
    owner.group.add(g);
    owner.holdKind = kind;
    owner.holdMesh = g;
  }
  function drop(owner) {
    if (!owner || !owner.holdMesh) return null;
    const kind = owner.holdKind;
    owner.group.remove(owner.holdMesh);
    owner.holdMesh.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    owner.holdMesh = null;
    owner.holdKind = null;
    return kind;
  }

  function step(dt, karts, onHit, onBlock) {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.t += dt;
      if (p.kind === 'seeker' && p.target && !p.target.finished) {
        const dx = p.target.pos.x - p.x, dz = p.target.pos.z - p.z;
        const want = Math.atan2(-dx, -dz);
        let d = want - p.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        p.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, d));
      }
      p.x += -Math.sin(p.yaw) * p.speed * dt;
      p.z += -Math.cos(p.yaw) * p.speed * dt;
      const pr = track.project(p.x, p.z, p.hint);
      p.hint = pr.i;
      p.g.position.set(p.x, pr.y + (p.kind === 'bomb' ? 0.66 : 0.62), p.z);
      p.g.rotation.x += dt * 9;
      p.g.rotation.y += dt * 4;
      // a bolt bounces off the fence, the rest just die there
      if (Math.abs(pr.lateral) > pr.wall) {
        if (p.kind === 'bolt') {
          const nx = pr.n.x, nz = pr.n.z;
          const vx = -Math.sin(p.yaw), vz = -Math.cos(p.yaw);
          const dot = vx * nx + vz * nz;
          const rx = vx - 2 * dot * nx, rz = vz - 2 * dot * nz;
          p.yaw = Math.atan2(-rx, -rz);
          p.x -= nx * (Math.abs(pr.lateral) - pr.wall) * Math.sign(pr.lateral) * 1.1;
          p.z -= nz * (Math.abs(pr.lateral) - pr.wall) * Math.sign(pr.lateral) * 1.1;
          p.bounces = (p.bounces || 0) + 1;
          if (p.bounces > 4) { kill(i, p); continue; }
        } else if (p.kind === 'bomb') { boom(p, karts, onHit); kill(i, p); continue; }
        else { kill(i, p); continue; }
      }
      // who it touches. A ghost is somebody else's shell, shown but not judged.
      let struck = false;
      for (const k of (p.ghost ? [] : karts)) {
        if (k.finished || (p.t < 0.25 && k.id === p.owner)) continue;
        if (Math.hypot(k.pos.x - p.x, k.pos.z - p.z) > 1.7) continue;
        /* Whatever is being trailed takes it, if it came from behind. A shell
           that bounced round and arrived at the nose does not, because the
           thing shielding you is not there: the point of holding one is that
           it covers your back and nothing else. */
        if (k.holdMesh && p.kind !== 'bomb') {
          const bx = Math.sin(k.yaw), bz = Math.cos(k.yaw);   // behind the kart
          if ((p.x - k.pos.x) * bx + (p.z - k.pos.z) * bz > 0) {
            drop(k);
            if (onBlock) onBlock(k, p.kind);
            struck = true;
            break;
          }
        }
        if (p.kind === 'bomb') boom(p, karts, onHit);
        // where it came from and how fast, so the kart tumbles the right way
        else if (spinOut(k, false, { x: p.x - k.pos.x, z: p.z - k.pos.z, speed: p.speed }) && onHit) onHit(k, p.kind, p.owner);
        struck = true;
        break;
      }
      if (struck || p.t > p.life) {
        if (p.kind === 'bomb' && !struck && !p.ghost) boom(p, karts, onHit);
        kill(i, p);
      }
    }

    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      h.t += dt;
      h.g.rotation.y += dt * 0.6;
      for (const k of (h.ghost ? [] : karts)) {
        if (k.finished || (h.t < 0.6 && k.id === h.owner)) continue;
        if (Math.hypot(k.pos.x - h.x, k.pos.z - h.z) > h.r) continue;
        // a thing lying on the road throws you off the way you drove onto it
        if (spinOut(k, false, { x: h.x - k.pos.x, z: h.z - k.pos.z, speed: Math.abs(k.speed) }) && onHit) onHit(k, h.kind, h.owner);
        scene.remove(h.g);
        hazards.splice(i, 1);
        break;
      }
      if (h.t > 45) { scene.remove(h.g); hazards.splice(i, 1); }
    }
  }

  function boom(p, karts, onHit) {
    if (fx) fx.blast(new THREE.Vector3(p.x, p.g.position.y, p.z));
    for (const k of karts) {
      if (k.finished) continue;
      if (Math.hypot(k.pos.x - p.x, k.pos.z - p.z) > 7) continue;
      // out from the blast, harder the closer you were standing
      const d = Math.hypot(k.pos.x - p.x, k.pos.z - p.z);
      if (spinOut(k, true, { x: p.x - k.pos.x, z: p.z - k.pos.z, speed: 34 * (1 - d / 7) }) && onHit) onHit(k, 'bomb', p.owner);
    }
  }
  function kill(i, p) { scene.remove(p.g); live.splice(i, 1); }

  function clear() {
    for (const p of live) scene.remove(p.g);
    for (const h of hazards) scene.remove(h.g);
    live.length = 0; hazards.length = 0;
  }

  /* Something took one off the road. The Snapper is the only thing that does
     this, and it is worth having: it is the one item that clears a line rather
     than adding to it. */
  function eat(h) {
    const i = hazards.indexOf(h);
    if (i < 0) return false;
    scene.remove(h.g);
    hazards.splice(i, 1);
    return true;
  }

  return { spawn, step, clear, live, hazards, eat, hold, drop };
}

export function lapProg(k, track) {
  return (k.lap - 1) * track.length + k.prog;
}
