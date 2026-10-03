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
import { ITEMS } from './items.js?v=100';
import { topSpeed, TUNE } from './kart.js?v=100';

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
   How fast the road ahead can be taken.

   The field used to lift for the largest change of heading anywhere in the
   next hundred and fifty metres. That reads an S bend as a hairpin and two
   gentle curves as one sharp one, so the computer drivers took corners at
   sixteen to thirty metres a second that a person takes at thirty seven, and
   spent every race behind wondering why.

   Now each stretch ahead is asked what it actually needs: its radius, and how
   tightly this car can turn at the speed it would be doing there - the steering
   gives up lock as the speed rises, so the radius and the speed are solved for
   together - and then how much road there is between here and there to slow
   down in. The lowest of those is the fastest it can be going now. A better
   driver uses more of the car's lock, so it can carry more speed into the same
   bend; that is most of what skill is now.
--------------------------------------------------------------------------- */
const PLAN_BRAKE = 13;       // m/s^2 it plans to slow at: a lift and a dab, not a stamp
function cornerLimit(track, k, commit) {
  const S = track.samples, N = S.length;
  const R = track.rules || { grip: 1 };
  const grip = (R.grip || 1) * (k.parts ? k.parts.grip : 1);
  /* The car's own top end, not a boosted one. The steering's lock goes with
     the speed as a share of the top end, so a boost lends a car more turn, but
     only for the second it lasts, and the bend this is planning for is usually
     further off than that. Planned on the boost, the field left every boost
     lane committed to a corner it could only make with the boost still on,
     and a third of its time against the wall on Neon was the bend after one. */
  const top = Math.max(1, topSpeed(k) / (k.boost > 0 ? TUNE.boostTop : 1));
  const w = TUNE.steer * grip * (0.52 + commit * 0.33);
  const v = Math.max(10, Math.abs(k.speed));
  // far enough ahead to stop for anything, and a little more
  const reach = Math.min(120, 10 + Math.ceil((v * v) / (2 * PLAN_BRAKE) / 2.2));
  let lim = Infinity;
  for (let j = 2; j < reach; j += 2) {
    const a = S[(k.hint + j - 2) % N].t, b = S[(k.hint + j + 2) % N].t;
    const turn = Math.atan2(Math.abs(a.x * b.z - a.z * b.x), a.x * b.x + a.z * b.z);
    if (turn < 0.006) continue;
    const rad = 8.8 / turn;                       // four samples of road bent by that much
    const vc = (rad * w) / (1 + (rad * w * 0.42) / top);
    const d = (j - 2) * 2.2;
    const va = Math.sqrt(vc * vc + 2 * PLAN_BRAKE * d);
    if (va < lim) lim = va;
  }
  return lim;
}

/* Which divide is next. Measured forward round the lap from where the car is,
   so it wraps at the line like everything else does. */
function nextSplit(track, prog) {
  const list = track.splits && track.splits.length ? track.splits : (track.splitAt ? [track.splitAt] : null);
  if (!list) return null;
  const L = track.length;
  let best = null, near = 1e9;
  for (const s of list) {
    const to = (((s.s1 - prog) % L) + L) % L;
    if (to < near) { near = to; best = s; }
  }
  return best;
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
  /* The one coming up, not the first one on the lap. A circuit divides three
     times now, and a driver that only knew about the first island went round
     that one and drove straight into the next. Whichever is nearest ahead is
     the one worth thinking about. */
  const sp = nextSplit(track, k.prog);
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
        /* The clean lane, when one of them is sand or ice or ash. A split with
           a strip down one side is a choice with a right answer, and the field
           was tossing a coin for it: half of them took the strip, slid into the
           island and lost seconds. Otherwise its own side, as before. */
        const clean = -(track.samples[sp.i % N].strip || 0);
        br.side = clean ? clean
          : Math.abs(q.lateral) > q.half * 0.55 ? (q.lateral > 0 ? 1 : -1) : br.side0;
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

  /* How well it is driving right now: its own skill, raised when the field
     asks it to push and lowered when it is asked to ease off. Everything that
     makes one driver quicker than another reads this - how far ahead it looks,
     how much of the car's lock it uses in a bend, how close to the top end it
     runs on a straight - so a car told to push drives like a better driver in
     every way at once. Asked only to go faster, a weak driver found the extra
     on the straights and gave it all back in the corners. */
  const push = br.bot ? (br.mul || 1) : 1;
  const drive = Math.max(0, Math.min(1.08, br.skill + (push - 1) * 2));

  // where to aim: up the road, but pulled in close when there is a bend coming,
  // or the aim point ends up across the grass on the inside of a hairpin
  const soon = curveAhead(track, k.hint, 18);
  let look = Math.round((5 + k.speed * 0.5 * (0.8 + drive * 0.4)) / (1 + soon * 1.6));
  if (side) look = Math.min(look, 9);
  /* And no further round a bend than the bend allows. The aim point is a
     straight line from here, and through a long bend a straight line crosses
     the inside of it: a car asked to push, doing fifty, looked forty metres up
     the road, drew a chord three metres inside the kerb and followed it along
     the wall for the length of the corner. An arc of length L bent through an
     angle a sags L*a/8 from its chord, so it looks no further than a metre
     and a half of that. */
  const t0 = track.samples[k.hint % N].t;
  while (look > 6) {
    const t1 = track.samples[(k.hint + look) % N].t;
    const a = Math.acos(Math.max(-1, Math.min(1, t0.x * t1.x + t0.z * t1.z)));
    if (look * 2.2 * a / 8 <= 1.5) break;
    look -= 2;
  }
  const tgt = track.samples[(k.hint + Math.max(3, look)) % N];
  br.wobble += dt * 0.7;
  let lane = Math.max(-0.62, Math.min(0.62, br.line * 0.5 + Math.sin(br.wobble) * 0.1));
  /* Down the middle where the edge is a drop. A driver holding its favourite
     line a metre off the kerb is holding it a metre off the kerb on a causeway
     too, and there is no kerb there: the whole field walked off the side of the
     first one of these ever built. */
  /* Off the strip. Sand, ice and ash run down one whole half of the road, and
     the field did not know they were there: it drove through them as often as
     not, which on a lap with two of them is most of why it was slow and most of
     why it was in the wall. Any half of the road without one will do. */
  const strip = tgt.strip || track.samples[k.hint % N].strip || 0;
  if (strip && !side) lane = -strip * Math.max(0.34, Math.min(0.62, Math.abs(lane) + 0.2));
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
  /* And enough lock for the speed. A fixed gain on the angle to the aim point
     asks for the same turn at fifty metres a second as at twenty, when at fifty
     the car needs two and a half times the rate of turn to hold the same arc,
     and has less lock to find it with. So a fast car ran wide until the angle
     had grown enough to make up the difference, which on a long bend is the
     whole width of the road: the field spent its quickest corners on the
     outside wall. The arc from here through the aim point says what rate of
     turn it needs, and that over the lock the car has at this speed is the
     least it steers. Slow, the old gain is the larger and nothing changes. */
  const v = Math.abs(k.speed);
  const lockNow = TUNE.steer * (1 - Math.min(0.42, v / Math.max(1, topSpeed(k)) * 0.42))
                * Math.min(1, v / 7) * R.grip * (k.parts ? k.parts.grip : 1);
  const reachAim = Math.max(4, Math.hypot(dx, dz));
  const gain = Math.max(2.1 / R.grip, lockNow > 0.05 ? (2 * v) / (reachAim * lockNow) : 0);
  let steer = Math.max(-1, Math.min(1, err * gain));

  // lift and drift for the tight stuff
  const bend = curveAhead(track, k.hint, Math.round(14 + k.speed * 0.8));
  // and it has to slow down more for the same corner where the grip is low.
  // The root of it, not the whole of it: cornering speed goes with the root of
  // the grip, and lifting in proportion made a lap of Glacier Pass take three
  // times as long as a lap of anywhere else.
  /* How much it lifts for what is coming. The whole game is a quarter quicker
     than it was and a corner does not care: at the old numbers the field
     arrived at everything a quarter too fast and spent the race in the scenery. */
  /* The fastest the road ahead allows, and on a straight a touch under the
     car's top end for a driver who is not the best. br.mul is how hard the
     field is asking this one to try to hold its distance from the player; it
     raises the top end through the car's own topMul, and asks for a little
     more commitment into a corner when it is behind and a little less when it
     is ahead. The autopilot is the player's own car and carries none of it. */
  /* Pushing a driver does not mean asking it to go through a corner faster
     than the corner allows - that is a car in the wall. It means asking it to
     drive like a better driver: use more of the lock it has, carry more speed
     in. So a car told to try harder corners like a more skilful one, up to a
     little past the best in the field, and a car told to ease off corners like
     a more careful one. */
  const straight = topSpeed(k) * (0.9 + Math.min(1, drive) * 0.1);
  const wantSpeed = Math.min(straight, cornerLimit(track, k, drive));
  /* On the brakes as soon as it is properly over, not a fifth over. The speed
     asked for used to be a rough guess, so coasting until well past it cost
     nothing; now it is the speed the corner can actually be taken at, and a
     car that only coasts down to it arrives a fifth too quick and finds the
     wall. */
  const gas = k.speed < wantSpeed ? 1 : 0;
  const brake = k.speed > wantSpeed * 1.05 ? 1 : 0;
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
