/* ---------------------------------------------------------------------------
   The police.

   The wanted level decides how much of this you get: one star is a single car
   that turns up and follows you, five is a permanent escort. A unit drives
   straight at you rather than obeying lanes, because that is what a pursuit
   looks like, and once it is close enough the officers get out and come after
   you on foot.

   None of it is clever. It does not need to be: the thing that makes a chase
   feel like a chase is sirens behind you, someone shooting at you, and the
   knowledge that standing still gets you arrested.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { CITY } from './city.js';
import { makeCar, CAR_KINDS } from './vehicle.js';
import { makePerson, poseWalk, poseIdle, poseAim } from './person.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const CRUISER = CAR_KINDS.find(k => k.id === 'sedan');

export function makePolice(ctx) {
  const { scene, solids, groundAt, hitsSolid, damage, fx } = ctx;
  const units = [];                 // { car, bar, cops[], state }
  const cops = [];                  // every officer on foot, for the shooting

  /* ---- a cruiser, with a light bar that flashes -------------------------- */
  const barRed = new THREE.MeshStandardMaterial({ color: 0x2a0a0c, emissive: 0xff2018, emissiveIntensity: 0.2 });
  const barBlue = new THREE.MeshStandardMaterial({ color: 0x0a1030, emissive: 0x2050ff, emissiveIntensity: 0.2 });

  function newUnit(x, z, yaw) {
    const car = makeCar(CRUISER, () => 0.05);      // always the white paint
    car.pos.set(x, 0, z);
    car.yaw = yaw;
    car.driver = 'cop';
    car.hp = 220;
    // the light bar
    const bar = new THREE.Group();
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), barRed);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), barBlue);
    l.position.x = -0.26; r.position.x = 0.26;
    bar.add(l); bar.add(r);
    bar.position.set(0, 0.42 + CRUISER.h + CRUISER.roof + 0.08, -CRUISER.l * 0.05);
    car.body.add(bar);
    car.apply();
    scene.add(car.group);
    if (ctx.cars) ctx.cars.push(car);              // so bullets and bumpers find it
    const u = { car, bar, cops: [], state: 'chase', wait: 0 };
    units.push(u);
    return u;
  }

  function newCop(x, z) {
    const g = makePerson(0x1d2a4a, 0xd9a877, 0x141824, { hair: 0x2a2320 });
    g.position.set(x, groundAt(x, z), z);
    scene.add(g);
    const c = { g, x, z, hp: 100, phase: Math.random() * 6, cool: 1 + Math.random(), hit: 0 };
    cops.push(c);
    return c;
  }

  function dropUnit(u) {
    scene.remove(u.car.group);
    units.splice(units.indexOf(u), 1);
    if (ctx.cars) { const i = ctx.cars.indexOf(u.car); if (i >= 0) ctx.cars.splice(i, 1); }
  }
  function dropCop(c) {
    scene.remove(c.g);
    cops.splice(cops.indexOf(c), 1);
  }

  /* ---- where a unit comes from ------------------------------------------ */
  function spawnNear(px, pz) {
    // on a road, a couple of blocks away, in a direction you are not looking
    const a = Math.random() * Math.PI * 2;
    const d = 90 + Math.random() * 60;
    let x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
    // snap to the nearest road line so it starts on tarmac
    const snap = v => {
      const i = Math.round((v + CITY.half) / CITY.pitch);
      return -CITY.half + clamp(i, 0, CITY.grid) * CITY.pitch;
    };
    if (Math.random() < 0.5) x = snap(x); else z = snap(z);
    x = clamp(x, -CITY.half + 2, CITY.half - 2);
    z = clamp(z, -CITY.half + 2, CITY.half - 2);
    if (hitsSolid(x, 0.6, z, 2.2, 1.6)) return null;
    return newUnit(x, z, Math.atan2(px - x, pz - z) + Math.PI);
  }

  /* ---- the step --------------------------------------------------------- */
  let flash = 0, spawnCool = 0, bustT = 0;
  function step(dt, player, stars, t, onBusted) {
    flash += dt;
    const lit = (flash % 0.5) < 0.25;
    barRed.emissiveIntensity = lit ? 3 : 0.1;
    barBlue.emissiveIntensity = lit ? 0.1 : 3;

    const px = player.car ? player.car.pos.x : player.pos.x;
    const pz = player.car ? player.car.pos.z : player.pos.z;

    // how much heat is on the street
    const want = stars <= 0 ? 0 : Math.min(4, stars);
    spawnCool -= dt;
    if (units.length < want && spawnCool <= 0) {
      spawnCool = 2.5;
      spawnNear(px, pz);
    }
    while (units.length > want + 1) dropUnit(units[units.length - 1]);
    if (want === 0) {
      for (let i = cops.length - 1; i >= 0; i--) if (Math.hypot(cops[i].x - px, cops[i].z - pz) > 90) dropCop(cops[i]);
    }

    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i], c = u.car;
      if (c.hp <= 0) {                                 // the car is out of it
        if (!c.wrecked) {
          c.wrecked = true; c.char();
          fx.explode(new THREE.Vector3(c.pos.x, c.pos.y + 0.8, c.pos.z));
          if (ctx.sound) ctx.sound.boom(0.8);
        }
        u.wait -= dt;
        if (u.wait < -6) dropUnit(u);
        continue;
      }
      const dx = px - c.pos.x, dz = pz - c.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 320) { dropUnit(u); continue; }

      // steer towards you, and lift off when you are close
      const want2 = Math.atan2(-dx, -dz);
      let turn = want2 - c.yaw;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      c.yaw += clamp(turn, -2.4 * dt, 2.4 * dt);
      const target = d < 14 ? (player.car ? 16 : 0) : Math.min(24, 8 + d * 0.25);
      c.speed += clamp(target - c.speed, -22 * dt, 9 * dt);
      const dir = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
      const nx = c.pos.x + dir.x * c.speed * dt, nz = c.pos.z + dir.z * c.speed * dt;
      if (!hitsSolid(nx, 0.6, c.pos.z, CRUISER.w * 0.5, 1.4)) c.pos.x = nx; else c.speed *= 0.4;
      if (!hitsSolid(c.pos.x, 0.6, nz, CRUISER.w * 0.5, 1.4)) c.pos.z = nz; else c.speed *= 0.4;
      c.pos.y = groundAt(c.pos.x, c.pos.z);
      c.wheelSpin += c.speed * dt / 0.34;
      c.steerVis = clamp(turn, -0.5, 0.5);
      c.apply();

      // stopped, near you, on foot: send the officers out
      if (!player.car && d < 22 && c.speed < 1.5 && u.cops.length === 0 && cops.length < 6) {
        const side = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
        for (const s of [1, -1]) {
          u.cops.push(newCop(c.pos.x + side.x * 1.9 * s, c.pos.z + side.z * 1.9 * s));
        }
      }
    }

    // officers on foot
    for (let i = cops.length - 1; i >= 0; i--) {
      const c = cops[i];
      if (c.hp <= 0) {
        c.g.rotation.x = Math.PI / 2;
        c.down = (c.down || 0) + dt;
        if (c.down > 12) dropCop(c);
        continue;
      }
      const dx = px - c.x, dz = pz - c.z;
      const d = Math.hypot(dx, dz);
      if (d > 140) { dropCop(c); continue; }
      const face = Math.atan2(-dx, -dz);
      c.g.rotation.y = face;
      if (d > 9) {                                     // close in
        const sp = 4.6;
        const nx = c.x + (dx / d) * sp * dt, nz = c.z + (dz / d) * sp * dt;
        if (!hitsSolid(nx, 0.4, c.z, 0.35, 1.8)) c.x = nx;
        if (!hitsSolid(c.x, 0.4, nz, 0.35, 1.8)) c.z = nz;
        c.phase += sp * dt * 1.6;
        poseWalk(c.g, c.phase, 0.5);
      } else {
        poseAim(c.g, 0);
        c.cool -= dt;
        if (c.cool <= 0) {
          c.cool = 0.85 + Math.random() * 0.9;
          // a shot that mostly misses at distance, the way a game shot should
          const from = new THREE.Vector3(c.x, c.g.position.y + 1.45, c.z);
          const aim = new THREE.Vector3(px - c.x, 1.2 - (c.g.position.y + 1.45) + (player.pos.y || 0), pz - c.z).normalize();
          const miss = 0.035 + d * 0.004;
          aim.x += (Math.random() - 0.5) * miss;
          aim.y += (Math.random() - 0.5) * miss;
          aim.z += (Math.random() - 0.5) * miss;
          const end = from.clone().addScaledVector(aim.normalize(), d + 2);
          fx.tracer(from, end);
          fx.muzzle(from, 0.9);
          if (ctx.sound) ctx.sound.gunshot('cop', Math.max(0.1, 1 - d / 90));
          if (Math.random() < 0.42 - d * 0.02) damage(9 + Math.random() * 7);
        }
      }
      c.g.position.set(c.x, groundAt(c.x, c.z), c.z);
    }

    // standing still next to an officer and you are nicked
    let nearCop = false;
    for (const c of cops) if (c.hp > 0 && Math.hypot(c.x - px, c.z - pz) < 2.6) nearCop = true;
    if (nearCop && !player.car && player.speed < 1.2 && stars > 0) {
      bustT += dt;
      if (bustT > 1.6) { bustT = 0; if (onBusted) onBusted(); }
    } else bustT = Math.max(0, bustT - dt);
  }

  function clear() {
    while (units.length) dropUnit(units[0]);
    while (cops.length) dropCop(cops[0]);
  }

  return { step, clear, units, cops, get count() { return units.length + cops.length; } };
}
