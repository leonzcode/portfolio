/* ---------------------------------------------------------------------------
   Leon Cart - the cones.

   Things in the way that do not simply stop you. A cone gets knocked along the
   road, skids, slows down and settles wherever it ends up, so the line through a
   corner is different on lap three from lap one because of what everyone did to
   it on laps one and two. The large ones are heavier: they move less and cost
   you more.

   Everything is drawn from two instanced meshes per size, so however many cones
   are scattered about they cost four draw calls between them.

   The network part is deliberately thin. Every browser runs the same settling
   maths, so the only thing worth sending is the shove itself: who hit which cone
   and how hard. Between shoves nobody needs to say anything.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

const ORANGE = 0xf4762a, WHITE = 0xfff6e2, INK = 0x17223b;

// How big they stand. The ordinary ones are chest high on a kart, the large
// ones you go round rather than through. The collision radius comes off the
// same number so the two never drift apart.
const SIZE = { small: 2.1, large: 3.3 };
const radiusOf = size => 0.46 * size * 1.28;

function coneMeshes(scene, n, size) {
  const h = 1.15 * size, r = 0.46 * size;
  const body = new THREE.Mesh(
    new THREE.ConeGeometry(r, h, 9),
    new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.75, flatShading: true })
  );
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.62, r * 0.72, h * 0.17, 9, 1, true),
    new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.8, side: THREE.DoubleSide })
  );
  const foot = new THREE.Mesh(
    new THREE.BoxGeometry(r * 2.3, 0.1 * size, r * 2.3),
    new THREE.MeshStandardMaterial({ color: INK, roughness: 0.9 })
  );
  const parts = [
    { geo: body.geometry, mat: body.material, y: h / 2 },
    { geo: band.geometry, mat: band.material, y: h * 0.42 },
    { geo: foot.geometry, mat: foot.material, y: 0.05 * size },
  ];
  return parts.map(p => {
    p.geo.translate(0, p.y, 0);
    const im = new THREE.InstancedMesh(p.geo, p.mat, n);
    im.castShadow = true;
    im.frustumCulled = false;
    scene.add(im);
    return im;
  });
}

export function makeCones(scene, track) {
  const list = [];
  let seed = 4242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  // Scattered where they make a line awkward rather than impossible: a few on
  // the racing line down the straights, a knot of them on the apex of the
  // corners, and the big ones where there is room to go round.
  const L = track.length;
  for (let s = 26; s < L; s += 23) {
    const a = track.at(s);
    const big = rnd() < 0.16;
    const lat = (rnd() * 1.4 - 0.7) * a.w;
    const p = a.p.clone().addScaledVector(a.n, lat);
    list.push({
      x: p.x, z: p.z, y: p.y, vx: 0, vz: 0, spin: rnd() * 6.3, wob: 0,
      big, r: radiusOf(big ? SIZE.large : SIZE.small), hint: null, home: { x: p.x, z: p.z },
      // one shove per contact: a kart resting against a cone was shoving it
      // again every frame, which added up to a velocity no single hit could give
      cool: 0,
    });
  }

  const small = list.filter(c => !c.big), large = list.filter(c => c.big);
  const smallM = coneMeshes(scene, Math.max(1, small.length), SIZE.small);
  const largeM = coneMeshes(scene, Math.max(1, large.length), SIZE.large);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);

  function draw() {
    for (const [group, meshes] of [[small, smallM], [large, largeM]]) {
      group.forEach((c, i) => {
        e.set(c.wob * 0.5, c.spin, c.wob);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(c.x, c.y, c.z), q, one);
        for (const im of meshes) im.setMatrixAt(i, m4);
      });
      for (const im of meshes) im.instanceMatrix.needsUpdate = true;
    }
  }
  draw();

  /* A shove, whoever it came from. The same call runs on the browser that did
     the hitting and on everyone else's when the message arrives, so the cone
     ends up in the same place without anybody streaming its position. */
  // The same shove moves a heavy cone less, which is the whole of what makes the
  // large ones large. It lives here so a shove off the network obeys it too.
  const MASS = { small: 1, large: 2.4 };
  function shove(i, vx, vz) {
    const c = list[i];
    if (!c) return;
    const m = c.big ? MASS.large : MASS.small;
    c.vx += vx / m; c.vz += vz / m;
    c.wob = Math.min(0.85, c.wob + (c.big ? 0.18 : 0.45));
  }

  function step(dt, karts, onShove) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const moving = c.vx !== 0 || c.vz !== 0;
      if (moving) {
        c.x += c.vx * dt; c.z += c.vz * dt;
        const damp = Math.exp(-2.9 * dt);
        c.vx *= damp; c.vz *= damp;
        if (Math.hypot(c.vx, c.vz) < 0.2) { c.vx = 0; c.vz = 0; }
        c.spin += (c.big ? 2.2 : 5.5) * dt;
        const pr = track.project(c.x, c.z, c.hint);
        c.hint = pr.i;
        // it can be shoved off the road but not through the fence
        if (Math.abs(pr.lateral) > pr.wall) {
          const over = (Math.abs(pr.lateral) - pr.wall) * Math.sign(pr.lateral);
          c.x -= pr.n.x * over; c.z -= pr.n.z * over;
          c.vx *= -0.35; c.vz *= -0.35;
        }
        c.y = pr.y;
      }
      if (c.wob > 0) c.wob = Math.max(0, c.wob - dt * (moving ? 0.6 : 2.6));
      if (c.cool > 0) c.cool -= dt;

      for (const k of karts) {
        if (k.finished) continue;
        const dx = c.x - k.pos.x, dz = c.z - k.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > c.r + 1.05) continue;
        const sp = Math.abs(k.speed);
        if (sp < 1.2 || c.cool > 0) continue;
        // it goes the way the kart was going, with a nudge to whichever side it
        // was already sitting on, so it scatters instead of shooting straight
        const fx = -Math.sin(k.yaw), fz = -Math.cos(k.yaw);
        const away = d > 0.01 ? { x: dx / d, z: dz / d } : { x: fx, z: fz };
        // hit it with the hop button down and it goes twice as far
        // hit it with the hop button down and it goes about twice as far, which
        // needs the ceiling raised with it or the extra is simply clipped off
        const hard = !!k.bash;
        const force = sp * 0.72 * (hard ? 2.2 : 1);
        let vx = (fx * 0.65 + away.x * 0.55) * force;
        let vz = (fz * 0.65 + away.z * 0.55) * force;
        const cap = 17 * (hard ? 2.2 : 1);
        const mag = Math.hypot(vx, vz);
        if (mag > cap) { vx = vx / mag * cap; vz = vz / mag * cap; }
        shove(i, vx, vz);
        c.cool = 0.35;
        if (!k.bash) k.speed *= c.big ? 0.84 : 0.955;
        if (onShove) onShove(k, i, vx, vz);
      }
    }
    draw();
  }

  return {
    list, step, shove,
    get count() { return list.length; },
    get moving() { return list.filter(c => c.vx !== 0 || c.vz !== 0).length; },
  };
}
