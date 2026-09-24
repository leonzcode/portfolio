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
import { ITEMS, lapProg } from './items.js?v=49';
import { topSpeed } from './kart.js?v=49';

export function makeBrain(kart, skill, seed) {
  let s = (seed | 0) || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  return {
    kart, skill,
    line: (rnd() - 0.5) * 0.9,          // which part of the road it likes
    side: 0,                            // which way round the split, once it decides
    // and the way it would go if it happened to be in the middle of the road
    // when the road divides. Fixed per driver and alternating down the grid, so
    // a field arriving together comes out of the split in two queues, not one.
    side0: (seed | 0) % 34 < 17 ? -1 : 1,
    itemWait: 0.6 + rnd() * 1.4,
    wobble: rnd() * 6.28,
    rnd,
  };
}

/* ---------------------------------------------------------------------------
   The elastic, stretched over a race rather than a corner.

   A grid that drives its own pace and nothing else turns a race into a
   procession: get clear on the first lap and the last two are a lap of an
   empty circuit, which is the least interesting thing a race can be. So the
   field watches the player. Hold the lead for more than a few seconds and it
   starts finding a little more, slowly, and keeps finding it for as long as
   the lead holds; lose the lead and it gives the same back at the same rate.

   Small numbers and a slow rate on purpose. The point is that a race stays a
   race, not that the field lands on your bumper the moment you get ahead - a
   player who is simply quicker still wins, they just have to keep driving. At
   a fortieth per second it takes most of a lap to find its ten percent, which
   is slow enough that what you notice is the gap not growing rather than the
   car behind speeding up.
--------------------------------------------------------------------------- */
const PACE_MIN = 0.94, PACE_MAX = 1.1, PACE_RATE = 0.025, GRACE = 5;
let pace = 1, leadT = 0, tailT = 0;
export function pacePulse(dt, leading, trailing) {
  leadT = leading ? leadT + dt : 0;
  tailT = trailing ? tailT + dt : 0;
  /* Level is where it wants to be, and a close race leaves it there. It only
     goes looking for the extra once the lead has held for a while, so a lap
     one scrap or a lead you hold into the first corner and lose out of it
     does not set the whole grid off. */
  const want = leadT > GRACE ? PACE_MAX : tailT > GRACE ? PACE_MIN : 1;
  const step = PACE_RATE * dt;
  pace += Math.max(-step, Math.min(step, want - pace));
  return pace;
}
export function paceOf() { return pace; }
export function resetPace() { pace = 1; leadT = tailT = 0; }

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
  const R = track.rules || { grip: 1 };

  /* Stuck. On a low grip circuit, or against a barrier after a bad landing, a
     driver can end up nose first into something with the throttle pinned and no
     way out of it, and sit there for the rest of the race. If it has been
     crawling for a couple of seconds it backs off, reverses, and turns towards
     the road, which is what a person does without thinking about it. */
  /* Not before it has ever moved. On the grid every car is stationary for the
     whole countdown, which this read as four seconds of being stuck, so the
     lights went out and the entire field reversed. */
  if (k.rescue || k.falling) { br.stuckT = 0; br.backT = 0; return { gas: 0, brake: 0, steer: 0, hop: false }; }
  if (Math.abs(k.speed) > 8) br.rolled = 1;
  br.stuckT = br.rolled && Math.abs(k.speed) < 3.5 && k.spin <= 0 ? (br.stuckT || 0) + dt : 0;
  if (br.stuckT > 2) {
    br.backT = 1.1;
    br.stuckT = 0;
  }
  if (br.backT > 0) {
    br.backT -= dt;
    const q = track.project(k.pos.x, k.pos.z, k.hint);
    // reverse, pointing the nose back at the middle of the road as it goes
    return { gas: 0, brake: 1, steer: q.lateral > 0 ? -0.8 : 0.8, hop: false };
  }

  /* The split, which is the one part of the lap where the middle of the road is
     not road. A driver that treats it as a wide straight aims up the middle and
     drives into the island, so it picks a side on the way in and holds it: the
     decision is made once, well before the divide, and it sits in the middle of
     the lane it chose rather than at some fraction of a width that is half kerb.
     The aim point is pulled in through the split too, because an aim point past
     the far end of it is a line back across the island. */
  const sp = track.splitAt;
  let side = 0;
  if (sp) {
    const L = track.length;
    const toEnd = (((sp.s1 - k.prog) % L) + L) % L;
    const span = (((sp.s1 - sp.s0) % L) + L) % L;
    if (toEnd < span + 110) {
      // whichever side it is already on when the road starts to open, so the
      // field fans out instead of seven cars crossing each other for the same
      // lane. A car sitting on the middle line falls back on the part of the
      // road it likes anyway, which is different for every driver.
      const q = track.project(k.pos.x, k.pos.z, k.hint);
      if (!br.side) {
        /* Its own side unless it is already committed to the other one. A
           field arriving together is a field on one racing line, and reading
           the side off position alone sent all seven of them down the same
           lane and left the other empty. */
        br.side = Math.abs(q.lateral) > q.half * 0.55 ? (q.lateral > 0 ? 1 : -1) : br.side0;
      }
      /* And once the island is actually under the car, the side is settled by
         where the car is, not by what it decided thirty metres ago. Shoved
         across on the way in, it used to spend the whole split trying to steer
         back through the island, which is the one line that is not available. */
      if (q.island > 1) {
        const on = q.lateral > 0 ? 1 : -1;
        if (on !== br.side) br.side = on;
      }
      side = br.side;
    } else br.side = 0;
  }

  // where to aim: up the road, but pulled in close when there is a bend coming,
  // or the aim point ends up across the grass on the inside of a hairpin
  const soon = curveAhead(track, k.hint, 18);
  let look = Math.round((5 + k.speed * 0.5 * (0.8 + br.skill * 0.4)) / (1 + soon * 1.6));
  if (side) look = Math.min(look, 9);
  const tgt = track.samples[(k.hint + Math.max(3, look)) % N];
  br.wobble += dt * 0.7;
  let lane = Math.max(-0.62, Math.min(0.62, br.line * 0.5 + Math.sin(br.wobble) * 0.1));
  /* Down the middle where the edge is a drop. A driver holding its favourite
     line a metre off the kerb is holding it a metre off the kerb on a causeway
     too, and there is no kerb there: the whole field walked off the side of the
     first one of these ever built. */
  const edge = Math.max(tgt.causeway || 0, track.samples[k.hint % N].causeway || 0);
  if (edge > 0.1) lane *= Math.max(0.12, 1 - edge);
  if (side) {
    // the widest the island gets between here and where it is looking, so the
    // line clears it on the way in as well as alongside it
    const isle = Math.max(tgt.island || 0, track.samples[k.hint % N].island || 0);
    const laneW = Math.max(3, tgt.w - isle);
    /* Its own part of the lane rather than the exact middle of it. Sending every
       driver that picked this side to one line sent them all to the same two
       metres of road, where they arrived together, shoved each other off it, and
       ended up back on the wrong side of the island. Keeping each driver's own
       preference inside the lane is what lets four of them through it at once. */
    const off = isle + laneW * (0.5 + br.line * 0.5 + Math.sin(br.wobble) * 0.06);
    lane = side * Math.min(0.95, Math.max((isle + 1.8) / tgt.w, off / tgt.w));
  }
  const aim = tgt.p.clone().addScaledVector(tgt.n, lane * tgt.w);

  // steer at it
  const dx = aim.x - k.pos.x, dz = aim.z - k.pos.z;
  const want = Math.atan2(-dx, -dz);
  let err = want - k.yaw;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  // a slippery circuit needs more lock for the same change of direction, and
  // a grippy one needs less or the car saws at the wheel all the way round
  let steer = Math.max(-1, Math.min(1, err * 2.1 / R.grip));

  // lift and drift for the tight stuff
  const bend = curveAhead(track, k.hint, Math.round(14 + k.speed * 0.8));
  // and it has to slow down more for the same corner where the grip is low.
  // The root of it, not the whole of it: cornering speed goes with the root of
  // the grip, and lifting in proportion made a lap of Glacier Pass take three
  // times as long as a lap of anywhere else.
  /* How much it lifts for what is coming. The whole game is a quarter quicker
     than it was and a corner does not care: at the old numbers the field
     arrived at everything a quarter too fast and spent the race in the scenery. */
  const cap = 1 - Math.min(0.68, bend * 0.55 / Math.sqrt(R.grip)) * (1.25 - br.skill * 0.45);
  // off its own top end, so a quicker field stays quick round the corners too
  /* The elastic is the grid reacting to the player, so it is the grid that
     carries it. The autopilot is the player's own car being driven for him by
     a test, and handing it the field's pace made a measurement of the game
     into a measurement of how long the harness had been in front. */
  const wantSpeed = topSpeed(k) * (0.72 + br.skill * 0.3) * cap * (br.bot ? pace : 1);
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

  /* The elastic.

     Two of them, actually. The old one is a nudge for anybody a long way off
     the leader, which keeps the pack a pack. The new one watches the person at
     the keyboard: run away at the front and the whole field slowly finds a bit
     more, fall back and it slowly gives it up again. It moves at a few per cent
     a second and is capped either side, so it is something you feel as the race
     closing up rather than something you can see happening. */
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
