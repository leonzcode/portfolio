/* ---------------------------------------------------------------------------
   Traffic and people.

   The city is a grid, so the traffic can be too: every car knows which road it
   is on, which way it is pointing and which junction it is heading for. At the
   junction it picks straight, left or right, waits if the light is against it,
   and sets off again. It is not a simulation of driving, it is a simulation of
   what traffic looks like from the pavement, which is the part that matters.

   Everything past a couple of streets away is switched off rather than drawn.
   With a nine by nine city that hides roughly four fifths of the population at
   any moment, which is what pays for having a population at all.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { CITY } from './city.js';
import { makeCar, CAR_KINDS } from './vehicle.js';
import { makePerson, poseWalk, poseIdle } from './person.js';

const KERB = 0.28;
const LANE = CITY.road / 4;                 // middle of a lane, from the centre line
const roadAt = i => -CITY.half + i * CITY.pitch;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* the two axes take it in turns, twenty seconds round */
export function greenNS(t) {
  const p = (t % 20) / 20;
  return p < 0.47;
}

const SHIRTS = [0x2a3a6a, 0x8a2a2a, 0x2e6b4a, 0xd0d0d0, 0x3b3b42, 0x7a4f9a, 0xc07a2a, 0x1f1f24];
const SKINS = [0xe8c39a, 0xd9a877, 0xb07a4e, 0x8a5a36, 0x5f3b22, 0xf0d2b4];
const TROUSERS = [0x23262e, 0x3a4152, 0x5a4632, 0x2c2c30, 0x6a6a72];

export function makeTraffic(scene, city, seed) {
  let s = seed >>> 0;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const pick = a => a[(r() * a.length) | 0];

  const cars = [];        // everything drivable, parked and moving alike
  const ai = [];          // the ones with a driver
  const peds = [];

  /* ---- parked cars, along the kerb ---------------------------------------- */
  const parkedSpots = [];
  for (let i = 0; i <= CITY.grid; i++) {
    for (let j = 0; j < CITY.grid; j++) {
      const along0 = -CITY.half + j * CITY.pitch + CITY.road / 2;
      for (let k = 0; k < 5; k++) {
        if (r() < 0.62) continue;
        const t = along0 + 5 + k * ((CITY.block - 10) / 6) + r() * 3;
        const side = r() < 0.5 ? -1 : 1;
        const off = side * (CITY.road / 2 - 1.75);
        parkedSpots.push({ x: roadAt(i) + off, z: t, yaw: side > 0 ? 0 : Math.PI });
        parkedSpots.push({ x: t, z: roadAt(i) + off, yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }
    }
  }
  for (const p of parkedSpots) {
    if (Math.abs(p.x) > CITY.half + 6 || Math.abs(p.z) > CITY.half + 6) continue;
    const c = makeCar(pick(CAR_KINDS), r, { still: true });
    c.pos.set(p.x, 0, p.z);
    c.yaw = p.yaw;
    c.parked = true;
    c.apply();
    c.group.updateMatrixWorld(true);
    // parked cars never move, so keep them out of the per frame matrix walk
    c.group.matrixWorldAutoUpdate = false;
    scene.add(c.group);
    cars.push(c);
  }

  /* ---- traffic ------------------------------------------------------------ */
  const N_AI = 42;
  for (let n = 0; n < N_AI; n++) {
    const c = makeCar(pick(CAR_KINDS), r);
    const axis = r() < 0.5 ? 'z' : 'x';
    const dir = r() < 0.5 ? 1 : -1;
    const i = (r() * (CITY.grid + 1)) | 0, j = (r() * (CITY.grid + 1)) | 0;
    const a = {
      car: c, axis, dir, i, j,
      // where along the road it currently is
      at: roadAt(axis === 'z' ? j : i) - dir * (6 + r() * 60),
      want: 8 + r() * 9, stop: 0,
    };
    place(a);
    c.apply();
    scene.add(c.group);
    cars.push(c);
    ai.push(a);
  }

  function laneOffset(axis, dir) {
    // right hand traffic: going +z you keep to -x, going +x you keep to +z
    return axis === 'z' ? -dir * LANE : dir * LANE;
  }
  function place(a) {
    const off = laneOffset(a.axis, a.dir);
    if (a.axis === 'z') { a.car.pos.set(roadAt(a.i) + off, 0, a.at); a.car.yaw = a.dir > 0 ? Math.PI : 0; }
    else { a.car.pos.set(a.at, 0, roadAt(a.j) + off); a.car.yaw = a.dir > 0 ? -Math.PI / 2 : Math.PI / 2; }
  }
  function targetOf(a) {
    return roadAt(a.axis === 'z' ? a.j : a.i);
  }
  function turn(a) {
    // pick straight, left or right, and keep inside the grid
    const opts = [];
    const nextStraight = a.axis === 'z' ? a.j + a.dir : a.i + a.dir;
    if (nextStraight >= 0 && nextStraight <= CITY.grid) opts.push('straight', 'straight', 'straight');
    opts.push('left', 'right');
    for (let guard = 0; guard < 6; guard++) {
      const pickOne = opts[(r() * opts.length) | 0];
      if (pickOne === 'straight') {
        if (a.axis === 'z') a.j += a.dir; else a.i += a.dir;
        return true;
      }
      // right from +z is -x, and so on round the compass
      let nAxis, nDir;
      if (a.axis === 'z') { nAxis = 'x'; nDir = (pickOne === 'right') ? -a.dir : a.dir; }
      else { nAxis = 'z'; nDir = (pickOne === 'right') ? a.dir : -a.dir; }
      const nNext = nAxis === 'z' ? a.j + nDir : a.i + nDir;
      if (nNext < 0 || nNext > CITY.grid) continue;
      a.axis = nAxis; a.dir = nDir;
      if (nAxis === 'z') { a.j += nDir; a.at = roadAt(a.j) - nDir * (CITY.road / 2); }
      else { a.i += nDir; a.at = roadAt(a.i) - nDir * (CITY.road / 2); }
      return true;
    }
    a.dir = -a.dir;                                  // give up and turn round
    return false;
  }

  /* ---- people ------------------------------------------------------------- */
  const LOOP = (CITY.block - 3.4) * 4;                // once round a block
  function pedPlace(p) {
    const b = CITY.block - 3.4, t = ((p.t % LOOP) + LOOP) % LOOP;
    const x0 = p.x0 + 1.7, z0 = p.z0 + 1.7;
    let x, z, yaw;
    if (t < b) { x = x0 + t; z = z0; yaw = -Math.PI / 2; }
    else if (t < b * 2) { x = x0 + b; z = z0 + (t - b); yaw = Math.PI; }
    else if (t < b * 3) { x = x0 + b - (t - b * 2); z = z0 + b; yaw = Math.PI / 2; }
    else { x = x0; z = z0 + b - (t - b * 3); yaw = 0; }
    p.g.position.set(x, KERB, z);
    p.g.rotation.y = p.dir > 0 ? yaw : yaw + Math.PI;
  }
  for (let n = 0; n < 110; n++) {
    const bx = (r() * CITY.grid) | 0, bz = (r() * CITY.grid) | 0;
    const g = makePerson(pick(SHIRTS), pick(SKINS), pick(TROUSERS));
    const p = {
      g, x0: -CITY.half + CITY.road / 2 + bx * CITY.pitch, z0: -CITY.half + CITY.road / 2 + bz * CITY.pitch,
      t: r() * LOOP, dir: r() < 0.5 ? 1 : -1, speed: 1.15 + r() * 0.55,
      phase: r() * 6.28, idle: 0, hp: 100, dead: 0, base: 1.15 + r() * 0.55,
    };
    pedPlace(p);
    scene.add(g);
    peds.push(p);
  }

  /* ---- the step ----------------------------------------------------------- */
  const VIEW = 175, VIEW2 = VIEW * VIEW;
  const PED_VIEW2 = 130 * 130;
  let parkedTick = 0;
  function step(dt, eye, t, playerCar) {
    const nsGreen = greenNS(t);

    // the parked cars only need their visibility looked at, and only now and then
    parkedTick += dt;
    if (parkedTick > 0.25) {
      parkedTick = 0;
      for (const c of cars) {
        if (!c.parked) continue;
        const dx = c.pos.x - eye.x, dz = c.pos.z - eye.z;
        c.group.visible = dx * dx + dz * dz < VIEW2;
      }
    }

    for (const a of ai) {
      const c = a.car;
      if (c.driver) { a.stolen = true; continue; }    // somebody got in
      if (a.stolen) {                                 // and got out again: pick
        a.stolen = false;                             // up the nearest lane
        const i = Math.round((c.pos.x + CITY.half) / CITY.pitch);
        const j = Math.round((c.pos.z + CITY.half) / CITY.pitch);
        const dx = Math.abs(c.pos.x - roadAt(clamp(i, 0, CITY.grid)));
        const dz = Math.abs(c.pos.z - roadAt(clamp(j, 0, CITY.grid)));
        a.axis = dx < dz ? 'z' : 'x';
        a.i = clamp(i, 0, CITY.grid); a.j = clamp(j, 0, CITY.grid);
        a.at = a.axis === 'z' ? c.pos.z : c.pos.x;
        a.dir = Math.cos(c.yaw) > 0 ? -1 : 1;
        if (a.axis === 'x') a.dir = Math.sin(c.yaw) > 0 ? -1 : 1;
        if (a.axis === 'z') { a.j = clamp(a.dir > 0 ? j + 1 : j, 0, CITY.grid); }
        else { a.i = clamp(a.dir > 0 ? i + 1 : i, 0, CITY.grid); }
        c.speed = 0;
      }
      const dx = c.pos.x - eye.x, dz = c.pos.z - eye.z;
      const far = dx * dx + dz * dz > VIEW2;
      c.group.visible = !far;

      const target = targetOf(a);
      const left = (target - a.at) * a.dir;           // metres to the junction
      // the light, and whatever is in front
      let want = a.want;
      const myGreen = a.axis === 'z' ? nsGreen : !nsGreen;
      if (!myGreen && left < 16 && left > CITY.road / 2 + 1.5) want = 0;
      for (const b of ai) {
        if (b === a || b.axis !== a.axis || b.dir !== a.dir) continue;
        if (a.axis === 'z' ? b.i !== a.i : b.j !== a.j) continue;
        const gap = (b.at - a.at) * a.dir;
        if (gap > 0 && gap < 9) want = Math.min(want, gap < 5.5 ? 0 : a.want * 0.35);
      }
      if (playerCar && !playerCar.parked) {
        const pd = a.axis === 'z'
          ? ((playerCar.pos.z - a.at) * a.dir) : ((playerCar.pos.x - a.at) * a.dir);
        const side = a.axis === 'z' ? Math.abs(playerCar.pos.x - c.pos.x) : Math.abs(playerCar.pos.z - c.pos.z);
        if (side < 3 && pd > 0 && pd < 11) want = 0;
      }

      c.speed += clamp(want - c.speed, -14 * dt, 7 * dt);
      if (c.speed < 0) c.speed = 0;
      a.at += c.speed * a.dir * dt;
      c.wheelSpin += c.speed * dt / 0.34;

      if (left <= 0.4) { turn(a); }
      place(a);
      if (!far) c.apply();
    }

    for (const p of peds) {
      const wx = p.g.position.x - eye.x, wz = p.g.position.z - eye.z;
      const far = wx * wx + wz * wz > PED_VIEW2;
      p.g.visible = !far;
      if (p.dead > 0) {
        p.dead -= dt;
        // once nobody is looking, they get back up somewhere else in town
        if (p.dead <= 0 && far) {
          p.hp = 100; p.dead = 0; p.g.rotation.x = 0; p.speed = p.base;
          const bx = (Math.random() * CITY.grid) | 0, bz = (Math.random() * CITY.grid) | 0;
          p.x0 = -CITY.half + CITY.road / 2 + bx * CITY.pitch;
          p.z0 = -CITY.half + CITY.road / 2 + bz * CITY.pitch;
          p.t = Math.random() * LOOP;
          pedPlace(p);
        } else if (p.dead <= 0) { p.dead = 0.5; }
        continue;
      }
      if (far) continue;
      if (p.speed > p.base) p.speed = Math.max(p.base, p.speed - dt * 0.5);
      if (p.idle > 0) { p.idle -= dt; poseIdle(p.g, t + p.phase); continue; }
      if (Math.random() < dt * 0.02) { p.idle = 1 + Math.random() * 4; continue; }
      p.t += p.speed * p.dir * dt;
      p.phase += p.speed * dt * 1.55;
      pedPlace(p);
      poseWalk(p.g, p.phase, 0.12);
    }
  }

  return { cars, ai, peds, step };
}
