/* ---------------------------------------------------------------------------
   Leon Cart - the coins.

   Scattered along the racing line, worth a little speed while you hold them and
   worth real money afterwards: what you pick up in a race is added to what the
   race itself paid, and that is what the shop spends.

   They were taken out once because they were only decoration. They are back
   because they are not: a coin is a reason to take the line that goes through
   the middle of the corner rather than the one that goes round the outside of
   it, and the small top end they give is the difference between catching the
   car in front and following it home.

   One instanced mesh for the lot of them, so however many are on the circuit
   they cost a single draw call. Who has collected what is per browser: your
   coins are yours, and nobody needs telling about them.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

const GOLD = 0xffd233, EDGE = 0xe0a21a;
const BACK = 9;                 // seconds before a collected one comes back

export function makeCoins(scene, track, seed) {
  const list = [];
  let s = ((seed | 0) * 22695477) & 0x7fffffff || 11;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

  /* Where they go. Mostly in short runs down the middle of the road, which is
     what makes them a line rather than a scatter, and a few pairs set wide on
     the corners where taking them costs you something. */
  const L = track.length;
  const nearRamp = arc => track.ramps.some(r => {
    const d = Math.abs(((arc - r.s + L) % L + L / 2) % L - L / 2);
    return d < 18;
  });
  for (let start = 14; start < L - 20; start += 34 + rnd() * 26) {
    if (nearRamp(start)) continue;
    const run = 3 + ((rnd() * 4) | 0);
    // one lateral for the whole run, so it reads as a line to follow
    const lat = (rnd() * 1.3 - 0.65);
    for (let k = 0; k < run; k++) {
      const arc = (start + k * 4.2) % L;
      const a = track.at(arc);
      const isle = a.island || 0;
      let off = lat * a.w;
      // never up the middle of a split, where the middle is an island
      if (isle > 0.15 && Math.abs(off) < isle + 2) off = (off >= 0 ? 1 : -1) * (isle + 2.4);
      const p = a.p.clone().addScaledVector(a.n, off);
      const y = track.project(p.x, p.z, a.i).y;
      list.push({ x: p.x, y: y + 1.05, z: p.z, taken: 0, phase: rnd() * 6.28 });
    }
  }

  const n = Math.max(1, list.length);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.52, 0.1, 14),
    new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 0.55,
                                     emissive: GOLD, emissiveIntensity: 0.25 })
  );
  disc.geometry.rotateX(Math.PI / 2);
  const face = new THREE.Mesh(
    new THREE.TorusGeometry(0.33, 0.07, 5, 12),
    new THREE.MeshStandardMaterial({ color: EDGE, roughness: 0.35, metalness: 0.5 })
  );
  const meshes = [disc, face].map(m => {
    const im = new THREE.InstancedMesh(m.geometry, m.material, n);
    im.frustumCulled = false;
    im.castShadow = true;
    scene.add(im);
    return im;
  });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1), gone = new THREE.Vector3(1e-4, 1e-4, 1e-4);
  const at = new THREE.Vector3();

  function draw(t) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      e.set(0, t * 2.4 + c.phase, 0);
      q.setFromEuler(e);
      at.set(c.x, c.y + Math.sin(t * 2 + c.phase) * 0.09, c.z);
      m4.compose(at, q, c.taken > 0 ? gone : one);
      for (const im of meshes) im.setMatrixAt(i, m4);
    }
    for (const im of meshes) im.instanceMatrix.needsUpdate = true;
  }
  draw(0);

  /* One frame. `mine` is the kart whose pickups count; everybody else's karts
     still knock them out of the world so the field looks right, but only yours
     are banked. */
  function step(dt, t, karts, mine, onPick) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.taken > 0) { c.taken -= dt; continue; }
      for (const k of karts) {
        if (k.finished || k.hop > 1.6) continue;
        const dx = k.pos.x - c.x, dz = k.pos.z - c.z;
        if (dx * dx + dz * dz > 3.4) continue;
        c.taken = BACK;
        if (k === mine && onPick) onPick(c);
        break;
      }
    }
    draw(t);
  }

  return {
    list, step, meshes,
    get count() { return list.length; },
    get left() { return list.filter(c => c.taken <= 0).length; },
  };
}
