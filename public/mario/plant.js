/* ---------------------------------------------------------------------------
   Leon Cart - the Snapper.

   A carnivorous vine in a drum, bolted to the nose of your kart for a few
   seconds. It does not get thrown and it does not get aimed: it waits, and when
   anything comes within reach of the front of the car it lunges and bites.

   A kart it catches is spun out. A banana or an oil slick it catches is simply
   eaten, which is worth knowing, because a Snapper is the only thing in the
   game that clears a line rather than adding to it. Every bite drags you
   forward a little, so a lap spent eating your way up the field is genuinely
   quicker than a lap spent behind it.

   It is grown on the kart it belongs to rather than added to the scene, so it
   leans, pitches and tumbles with the car for free, and so it goes away with
   the car when a round ends.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

const LIFE = 8.5;              // how long it stays bolted on
const REACH = 5.2;             // how far in front it can get at something
const BITE = 0.55;             // how long a lunge takes, start to finish

/* The model. A drum, a coiled stem out of it, and a head made of two jaws that
   open and shut. Built once per plant and thrown away with it; there is only
   ever a handful of them on a circuit at a time. */
function grow(colour) {
  const g = new THREE.Group();
  const mat = (c, rough) => new THREE.MeshStandardMaterial({ color: c, roughness: rough === undefined ? 0.7 : rough, flatShading: true });

  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.5, 12), mat(0x6b6f78, 0.5));
  drum.position.y = 0.25;
  g.add(drum);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.05, 5, 12), mat(0xffd233, 0.4));
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.42;
  g.add(band);

  // the stem, in three segments so it can arc when it lunges
  const stem = new THREE.Group();
  stem.position.y = 0.46;
  g.add(stem);
  const joints = [];
  let parent = stem;
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    seg.position.y = i ? 0.34 : 0.06;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.11 - i * 0.012, 0.13 - i * 0.012, 0.34, 7), mat(0x2f9440));
    m.position.y = 0.17;
    seg.add(m);
    // a leaf off each joint, which is most of what makes it read as a plant
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), mat(0x3aa84c));
    leaf.scale.set(1.5, 0.3, 0.8);
    leaf.position.set(i % 2 ? 0.2 : -0.2, 0.14, 0);
    leaf.rotation.z = i % 2 ? -0.5 : 0.5;
    seg.add(leaf);
    parent.add(seg);
    joints.push(seg);
    parent = seg;
  }

  // the head: two jaws hinged at the back, with teeth
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.34;
  parent.add(headPivot);
  const jaws = [];
  for (const sign of [1, -1]) {
    const jaw = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(colour));
    shell.rotation.z = sign > 0 ? 0 : Math.PI;
    jaw.add(shell);
    const gum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 10), mat(0xfff6e2, 0.6));
    gum.position.y = sign * 0.02;
    jaw.add(gum);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4), mat(0xfff6e2, 0.5));
      tooth.position.set(Math.cos(a) * 0.23, sign * 0.08, Math.sin(a) * 0.23);
      tooth.rotation.x = sign > 0 ? 0 : Math.PI;
      jaw.add(tooth);
    }
    headPivot.add(jaw);
    jaws.push({ jaw, sign });
  }
  // two small eyes on top, so it is obvious which way it is looking
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 5), mat(0xfff6e2, 0.4));
    eye.position.set(sx * 0.14, 0.2, 0.2);
    headPivot.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 4), mat(0x17223b, 0.4));
    pupil.position.set(sx * 0.14, 0.21, 0.26);
    headPivot.add(pupil);
  }

  for (const o of g.children) { o.castShadow = true; }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { group: g, joints, jaws, headPivot };
}

/* ---------------------------------------------------------------------------
   One Snapper, riding one kart. `on` reports a bite so the game can make a
   noise about it and tell the network who got eaten.
--------------------------------------------------------------------------- */
export function plantOn(k) {
  if (k.plant) { k.plant.life = LIFE; return k.plant; }
  const m = grow(k.who ? k.who.kart : 0xe8402a);
  // on the nose, and part of the body so it leans and pitches with the car
  m.group.position.set(0, 0.3, -1.35);
  k.body.add(m.group);

  const p = {
    life: LIFE, t: 0, bite: 0, target: null, chomp: 0, model: m,
    kart: k,
  };
  k.plant = p;
  return p;
}

export function dropPlant(k) {
  if (!k.plant) return;
  k.body.remove(k.plant.model.group);
  k.plant.model.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  k.plant = null;
}

/* one frame of every plant on the circuit */
export function stepPlants(dt, karts, hazards, on) {
  for (const k of karts) {
    const p = k.plant;
    if (!p) continue;
    p.life -= dt;
    p.t += dt;
    if (p.life <= 0) { dropPlant(k); continue; }

    // where the front of this car is, and which way it is pointing
    const fx = -Math.sin(k.yaw), fz = -Math.cos(k.yaw);
    const nx = k.pos.x + fx * 1.4, nz = k.pos.z + fz * 1.4;

    /* Looking for something to bite. Nearest first, in front rather than all
       round, and never while it is already mid lunge: a plant that retargets
       halfway through a bite snaps at nothing and looks broken. */
    if (p.bite <= 0) {
      let best = null, bestD = REACH;
      for (const o of karts) {
        if (o === k || o.finished || o.spin > 0 || o.star > 0) continue;
        const dx = o.pos.x - nx, dz = o.pos.z - nz;
        const d = Math.hypot(dx, dz);
        if (d > bestD) continue;
        if ((dx * fx + dz * fz) / (d || 1) < -0.25) continue;     // not behind you
        best = { kind: 'kart', o, dx, dz, d };
        bestD = d;
      }
      for (const h of hazards || []) {
        const dx = h.x - nx, dz = h.z - nz;
        const d = Math.hypot(dx, dz);
        if (d > bestD) continue;
        if ((dx * fx + dz * fz) / (d || 1) < -0.25) continue;
        best = { kind: 'hazard', h, dx, dz, d };
        bestD = d;
      }
      if (best) { p.bite = BITE; p.target = best; }
    }

    // the lunge, and what it lands on
    if (p.bite > 0) {
      const was = p.bite;
      p.bite -= dt;
      const at = 1 - p.bite / BITE;
      p.chomp = at;
      // it connects halfway through, which is when the jaws are shut
      if (was > BITE * 0.5 && p.bite <= BITE * 0.5 && p.target) {
        const tg = p.target;
        if (tg.kind === 'kart' && tg.o.spin <= 0 && tg.o.star <= 0) {
          const d = Math.max(0.01, Math.hypot(tg.o.pos.x - nx, tg.o.pos.z - nz));
          if (d < REACH + 1.5 && on) on(k, tg.o, 'kart',
            { x: (tg.o.pos.x - nx) / d, z: (tg.o.pos.z - nz) / d });
        } else if (tg.kind === 'hazard' && on) {
          on(k, tg.h, 'hazard');
        }
        // every bite drags the car it is bolted to forward
        k.speed += 3.4;
        k.boost = Math.max(k.boost, 0.35);
      }
      if (p.bite <= 0) { p.bite = 0; p.target = null; p.chomp = 0; }
    }

    /* The animation. Idle, it sways and works its jaws; lunging, the stem
       straightens out at whatever it is going for and the jaws slam. */
    const m = p.model;
    const sway = Math.sin(p.t * 3.1);
    const lunge = p.chomp > 0 ? Math.sin(p.chomp * Math.PI) : 0;
    let aim = 0;
    if (p.target) {
      // which side of the nose it is on, in the car's own frame
      const rx = Math.cos(k.yaw), rz = -Math.sin(k.yaw);
      aim = Math.max(-1, Math.min(1, (p.target.dx * rx + p.target.dz * rz) / REACH));
    }
    m.joints.forEach((seg, i) => {
      const out = lunge * (0.55 - i * 0.1);
      seg.rotation.x = -out - (1 - lunge) * (0.1 + sway * 0.07 * (i + 1) * 0.3);
      seg.rotation.z = -aim * lunge * 0.4 + (1 - lunge) * sway * 0.06;
    });
    m.headPivot.rotation.x = -lunge * 0.5;
    // the jaws: wide open on the way out, shut at the point of contact
    const open = p.chomp > 0
      ? (p.chomp < 0.5 ? 0.9 * (p.chomp / 0.5) : Math.max(0, 1 - (p.chomp - 0.5) / 0.22) * 0.9)
      : 0.28 + Math.sin(p.t * 5.5) * 0.14;
    for (const j of m.jaws) j.jaw.rotation.x = j.sign * open;
    // and it shrinks back into the drum as it runs out of time
    const end = Math.min(1, p.life / 0.8);
    m.group.scale.setScalar(0.6 + end * 0.4);
  }
}
