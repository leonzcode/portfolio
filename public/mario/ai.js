/* ---------------------------------------------------------------------------
   The computer drivers.

   Each one aims at a point some way up the road, steers at it, and lifts off for
   corners it can see coming. On top of that sits a skill number that decides how
   far ahead it looks, how much it lifts, and how tidy its line is, plus a light
   hand on the elastic: a driver a long way behind the leader tries a little
   harder. It is not a racing line solver, but it holds a line, defends, drifts
   the hairpin and throws items, which is what a grid is for.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
import { ITEMS, lapProg } from './items.js?v=17';
import { topSpeed } from './kart.js?v=17';

export function makeBrain(kart, skill, seed) {
  let s = (seed | 0) || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  return {
    kart, skill,
    line: (rnd() - 0.5) * 0.9,          // which part of the road it likes
    itemWait: 0.6 + rnd() * 1.4,
    wobble: rnd() * 6.28,
    rnd,
  };
}

/* look along the road and find the tightest bend within reach */
function curveAhead(track, i, n) {
  const N = track.samples.length;
  let worst = 0;
  const a = track.samples[i % N].t;
  for (let k = 4; k < n; k += 3) {
    const b = track.samples[(i + k) % N].t;
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z));
    worst = Math.max(worst, Math.acos(dot));
  }
  return worst;
}

export function driveBrain(br, track, dt, karts, leaderProg, useItem) {
  const k = br.kart;
  if (k.finished) return { gas: 0, brake: 0, steer: 0, hop: false };
  const N = track.samples.length;

  // where to aim: up the road, but pulled in close when there is a bend coming,
  // or the aim point ends up across the grass on the inside of a hairpin
  const soon = curveAhead(track, k.hint, 18);
  const look = Math.round((5 + k.speed * 0.5 * (0.8 + br.skill * 0.4)) / (1 + soon * 1.6));
  const tgt = track.samples[(k.hint + Math.max(3, look)) % N];
  br.wobble += dt * 0.7;
  const lane = Math.max(-0.62, Math.min(0.62, br.line * 0.5 + Math.sin(br.wobble) * 0.1));
  const aim = tgt.p.clone().addScaledVector(tgt.n, lane * tgt.w);

  // steer at it
  const dx = aim.x - k.pos.x, dz = aim.z - k.pos.z;
  const want = Math.atan2(-dx, -dz);
  let err = want - k.yaw;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  let steer = Math.max(-1, Math.min(1, err * 2.1));

  // lift and drift for the tight stuff
  const bend = curveAhead(track, k.hint, Math.round(14 + k.speed * 0.8));
  const cap = 1 - Math.min(0.52, bend * 0.42) * (1.25 - br.skill * 0.45);
  // off its own top end, so a quicker field stays quick round the corners too
  const wantSpeed = topSpeed(k) * (0.72 + br.skill * 0.3) * cap;
  const gas = k.speed < wantSpeed ? 1 : 0;
  const brake = k.speed > wantSpeed * 1.22 ? 1 : 0;
  const hop = br.skill > 0.45 && Math.abs(err) > 0.42 && k.speed > 13 && bend > 0.55;

  // steer round anything lying on the road
  for (const h of (br.hazards || [])) {
    const hx = h.x - k.pos.x, hz = h.z - k.pos.z;
    const d = Math.hypot(hx, hz);
    if (d > 16 || d < 0.1) continue;
    const ahead = (-Math.sin(k.yaw) * hx + -Math.cos(k.yaw) * hz) / d;
    if (ahead < 0.72) continue;
    const side = (-Math.cos(k.yaw) * hx + Math.sin(k.yaw) * hz) / d;
    steer += (side > 0 ? -1 : 1) * (1 - d / 16) * 0.9;
  }
  steer = Math.max(-1, Math.min(1, steer));

  // items: hold one for a beat, then use it the way a person would
  if (k.item) {
    br.itemWait -= dt;
    if (br.itemWait <= 0) {
      const id = k.item;
      let fire = false;
      if (id === 'turbo' || id === 'star') fire = bend < 0.3;
      else if (id === 'surge') fire = k.place > 1;
      else if (id === 'seeker') fire = k.place > 1;
      else if (id === 'slick') fire = nearBehind(k, karts, 22);
      else if (id === 'bolt') fire = k.place > 1 ? nearAhead(k, karts, 30) : nearBehind(k, karts, 18);
      else if (id === 'bomb') fire = nearAhead(k, karts, 26) || nearBehind(k, karts, 16);
      if (fire) { useItem(k); br.itemWait = 0.8 + br.rnd() * 1.6; }
    }
  } else br.itemWait = 0.5 + br.rnd() * 1.2;

  // a gentle elastic, so the pack stays a pack
  const behind = leaderProg - lapProg(k, track);
  br.boostBias = behind > 120 ? 1.06 : behind < -80 ? 0.96 : 1;

  return { gas, brake, steer, hop };
}

function nearAhead(k, karts, range) {
  for (const o of karts) {
    if (o === k || o.finished) continue;
    const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    if ((-Math.sin(k.yaw) * dx + -Math.cos(k.yaw) * dz) / d > 0.6) return true;
  }
  return false;
}
function nearBehind(k, karts, range) {
  for (const o of karts) {
    if (o === k || o.finished) continue;
    const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    if ((-Math.sin(k.yaw) * dx + -Math.cos(k.yaw) * dz) / d < -0.6) return true;
  }
  return false;
}
