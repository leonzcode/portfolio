/* ---------------------------------------------------------------------------
   Things lying about the city.

   Health on the pavement, armour in an alley, a roll of cash and a box of
   ammunition. They spin, they glow a little so you can see one from across a
   junction, and they come back a while after you take them, which is the whole
   design: it gives a reason to go down a street you would otherwise drive past.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { CITY } from './city.js';

const KINDS = {
  health: { color: 0x4be05a, label: '+25 health', respawn: 45 },
  armour: { color: 0x4aa8f0, label: '+50 armour', respawn: 60 },
  cash:   { color: 0x6ee07a, label: 'cash', respawn: 35 },
  ammo:   { color: 0xf0c040, label: 'ammunition', respawn: 50 },
};

function shapeFor(kind) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: KINDS[kind].color, emissive: KINDS[kind].color,
    emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.2,
  });
  const add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); };
  if (kind === 'health') {                    // a cross
    add(new THREE.BoxGeometry(0.44, 0.15, 0.15), 0, 0, 0);
    add(new THREE.BoxGeometry(0.15, 0.44, 0.15), 0, 0, 0);
  } else if (kind === 'armour') {             // a vest, near enough
    add(new THREE.BoxGeometry(0.40, 0.46, 0.14), 0, 0, 0);
    add(new THREE.BoxGeometry(0.14, 0.18, 0.16), -0.16, 0.26, 0);
    add(new THREE.BoxGeometry(0.14, 0.18, 0.16), 0.16, 0.26, 0);
  } else if (kind === 'cash') {               // a bundle of notes
    add(new THREE.BoxGeometry(0.42, 0.10, 0.22), 0, 0, 0);
    add(new THREE.BoxGeometry(0.40, 0.09, 0.20), 0.03, 0.10, 0.01);
  } else {                                    // a box of rounds
    add(new THREE.BoxGeometry(0.40, 0.26, 0.28), 0, 0, 0);
    add(new THREE.BoxGeometry(0.42, 0.06, 0.30), 0, 0.14, 0);
  }
  g.userData.mat = mat;
  return g;
}

export function makePickups(scene, seed, groundAt) {
  let s = seed >>> 0;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const items = [];
  const names = Object.keys(KINDS);

  const blockOrigin = -CITY.half + CITY.road / 2;
  for (let i = 0; i < 64; i++) {
    const kind = names[(r() * names.length) | 0];
    const bx = (r() * CITY.grid) | 0, bz = (r() * CITY.grid) | 0;
    const side = (r() * 4) | 0, t = 4 + r() * (CITY.block - 8);
    const x0 = blockOrigin + bx * CITY.pitch, z0 = blockOrigin + bz * CITY.pitch;
    let x, z;
    if (side === 0) { x = x0 + t; z = z0 + 1.6; }
    else if (side === 1) { x = x0 + CITY.block - 1.6; z = z0 + t; }
    else if (side === 2) { x = x0 + t; z = z0 + CITY.block - 1.6; }
    else { x = x0 + 1.6; z = z0 + t; }
    const g = shapeFor(kind);
    const y = groundAt(x, z) + 0.75;
    g.position.set(x, y, z);
    scene.add(g);
    items.push({ kind, g, x, z, y, gone: 0, spin: r() * 6.28 });
  }

  function step(dt, player, take) {
    for (const it of items) {
      if (it.gone > 0) {
        it.gone -= dt;
        if (it.gone <= 0) { it.gone = 0; it.g.visible = true; }
        continue;
      }
      it.spin += dt * 1.6;
      it.g.rotation.y = it.spin;
      it.g.position.y = it.y + Math.sin(it.spin * 1.7) * 0.06;
      const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
      if (d < 1.5 && Math.abs(it.y - player.pos.y) < 2.4 && !player.car) {
        it.gone = KINDS[it.kind].respawn;
        it.g.visible = false;
        take(it.kind, KINDS[it.kind].label);
      }
    }
  }
  return { items, step };
}
