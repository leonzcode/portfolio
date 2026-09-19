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
import { spinOut } from './kart.js?v=12';

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
  star: {
    name: 'Star', self: true,
    face: svg('<path d="M32 6 L40 26 L62 26 L44 39 L51 59 L32 46 L13 59 L20 39 L2 26 L24 26 Z" fill="#ffd233" ' + K + '/>'),
  },
  surge: {
    name: 'Surge', self: true,
    face: svg('<path d="M36 4 L14 34 H28 L22 60 L50 26 H34 Z" fill="#8fd3ff" ' + K + '/>'),
  },
};

/* What the box gives you, by where you are. Lower rows are further back. */
const TABLE = [
  // place 1st
  [['slick', 5], ['bolt', 4], ['turbo', 2]],
  [['slick', 4], ['bolt', 4], ['turbo', 3], ['seeker', 1]],
  [['bolt', 3], ['turbo', 4], ['seeker', 3], ['slick', 2], ['bomb', 1]],
  [['turbo', 4], ['seeker', 4], ['bomb', 2], ['bolt', 2], ['star', 1]],
  [['turbo', 3], ['seeker', 4], ['bomb', 2], ['star', 2], ['surge', 2]],
  // last rows
  [['turbo', 3], ['seeker', 3], ['star', 3], ['surge', 3], ['bomb', 2]],
];

export function rollItem(place, field) {
  const row = TABLE[Math.min(TABLE.length - 1, Math.max(0, Math.round((place - 1) / Math.max(1, field - 1) * (TABLE.length - 1))))];
  let total = 0;
  for (const r of row) total += r[1];
  let pick = Math.random() * total;
  for (const r of row) { pick -= r[1]; if (pick <= 0) return r[0]; }
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
    if (kind === 'slick') {
      const g = shapeFor('slick');
      const back = owner.yaw;
      g.position.set(owner.pos.x + Math.sin(back) * 2.6, owner.pos.y + 0.02, owner.pos.z + Math.cos(back) * 2.6);
      scene.add(g);
      hazards.push({ kind, g, owner: owner.id, t: 0, x: g.position.x, z: g.position.z, r: 1.5, ghost: !!ghost });
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

  function step(dt, karts, onHit) {
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
        if (p.kind === 'bomb') boom(p, karts, onHit);
        else if (spinOut(k, false) && onHit) onHit(k, p.kind, p.owner);
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
        if (spinOut(k, false) && onHit) onHit(k, h.kind, h.owner);
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
      if (spinOut(k, true) && onHit) onHit(k, 'bomb', p.owner);
    }
  }
  function kill(i, p) { scene.remove(p.g); live.splice(i, 1); }

  function clear() {
    for (const p of live) scene.remove(p.g);
    for (const h of hazards) scene.remove(h.g);
    live.length = 0; hazards.length = 0;
  }

  return { spawn, step, clear, live, hazards };
}

export function lapProg(k, track) {
  return (k.lap - 1) * track.length + k.prog;
}
