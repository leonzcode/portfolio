// Trick names and points. The air is measured, not guessed from keys: every physics step the body's turn is split
// into its spin (about its own long axis), flip (about its left-right axis) and roll, and the times the body goes
// upside down are counted. A landing then names what was done the way freeskiers say it:
//   [Switch] [Left|Right] [Double] Cork|Rodeo|Bio|Misty 1080 [Mute to Tail]   or   Back Flip, Lincoln Loop, 360...
// Rails: entry spin, 50-50 or slide, swaps and presses, exit spin ("Left 270 On, Slide, Back Swap, 270 Out").
import * as THREE from 'three';
import { GRABS, grabDef } from './grabs.js?v=21';
// (B: on a snowboard the grabs, spins and slides have the board's own names, board.js)
import { rideGrabDef, boardSpinParts, boardRailName } from './board.js?v=21';

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
// (P: the extra rides name their own spins and flips: RIDE_SPIN[kind](A) gives the parts for a rotation, or null for
// none; scoot.js and sled.js register theirs. A ride with one rides backwards 'Fakie', not 'Switch'.)
export const RIDE_SPIN = {};
// (S, 2026-11-08: a ride's own words for the snow moves, RIDE_WORDS[kind] = { lazy, nose, tail }: on the scooter and the
// snowbike S is a manual and N a nose manual, not a lazy boy and a butter; scoot.js registers them)
export const RIDE_WORDS = {};
const MULT = ['', 'Double ', 'Triple ', 'Quad ', 'Quint '];
const round180 = d => Math.round(d / 180) * 180;
const round90 = d => Math.round(d / 90) * 90;
const tAirOf = e => e.tAir || 0;

export class Tricks {
  constructor(onTrick) {
    this.onTrick = onTrick;          // ({ name, points, quality }) for the HUD
    this.air = null; this.railT = null;
    this.score = 0; this.combo = 0; this.comboT = 0; this.comboPts = 0;
  }
  // called every physics step
  step(sk, dt) {
    for (const e of sk.events) this.event(e, sk);
    sk.events.length = 0;
    if (sk.state === 'air' && this.air) this.measure(sk);
    if (sk.state === 'rail' && this.railT) this.railT.t += dt;
    if (sk.state === 'ground') { this.comboT += dt; if (this.comboT > 2.6 && this.combo) this.endCombo(); }
  }
  measure(sk) {
    const A = this.air;
    _q.copy(sk.q).multiply(A.prevQ.invert());
    A.prevQ.copy(sk.q);
    let ang = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
    if (ang < 1e-6) return;
    const s = Math.sqrt(1 - _q.w * _q.w) || 1;
    const axis = _v.set(_q.x / s, _q.y / s, _q.z / s); if (_q.w < 0) axis.negate();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(sk.q), left = new THREE.Vector3(1, 0, 0).applyQuaternion(sk.q), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(sk.q);
    A.spin += ang * axis.dot(up) * 180 / Math.PI;
    A.flip += ang * axis.dot(left) * 180 / Math.PI;
    A.roll += ang * axis.dot(fwd) * 180 / Math.PI;
    A.total += ang * 180 / Math.PI;                 // all the turning, whatever the axis
    // in the pipe: a rotation that first turns the skis uphill is an alley-oop
    if (A.pipe && A.oop === null && Math.abs(A.spin) > 25) { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(sk.q); f.y = 0; const f0 = A.fwd0.clone(); f0.y = 0; A.oop = f.normalize().z < f0.normalize().z - 0.05; }
    const inv = up.y < -0.05;
    if (inv && !A.invNow) A.inv++;
    A.invNow = up.y < 0.1 ? (A.invNow || inv) : false;
  }
  event(e, sk) {
    switch (e.type) {
      case 'takeoff':
        this.air = { sw: e.sw, how: e.how, unslide: e.unslide || 0, spin: 0, flip: 0, roll: 0, total: 0, inv: 0, invNow: false, grabs: [], prevQ: sk.q.clone(), fromRail: e.rail, press: e.press || 0, t0: performance.now(),
          pipe: !!e.pipe, fwd0: new THREE.Vector3(0, 0, 1).applyQuaternion(sk.q), oop: null };
        if (!e.rail) this.railT = this.railT && this.railT.done ? null : this.railT;
        break;
      case 'grab': if (this.air) this.air.grabs.push({ id: e.id, t: 0, at: sk.tAir || 0 }); break;
      case 'grabEnd': if (this.air) { const g = this.air.grabs.findLast?.(x => x.id === e.id) || this.air.grabs.filter(x => x.id === e.id).pop(); if (g) { g.t = e.t; g.mod = e.mod || ''; } } break;
      case 'shifty': if (this.air && !this.air.shifty) this.air.shifty = { dir: e.dir, t: e.t }; break;
      // (X: the extra rides' timed tricks done in the air: a tailwhip, a barspin, a briflip..., n times round)
      case 'act': if (this.air && e.n > 0) (this.air.acts || (this.air.acts = [])).push({ id: e.id, n: e.n, at: e.at || 0 }); break;
      // (X: a sled's flat spin on the snow, a bodyboarder's spinner)
      case 'sledspin': { const d = round180(e.deg); this.award(`${d} Spinner`, 110 + d / 180 * 120, 'clean'); break; }
      case 'land': this.land(e, sk); break;
      case 'railOn': {
        const entry = this.air ? round90(Math.abs(this.air.spin)) : 0;
        const dir = this.air && this.air.spin > 0 ? 'Left' : 'Right';
        // (popped up and back down onto the same rail: a hop, part of the same rail trick)
        const R0 = this.railT;
        if (R0 && R0.done && R0.rail === e.rail && this.air && this.air.fromRail && performance.now() - this.air.t0 < 2000) {
          R0.done = false; R0.swaps.push(entry >= 90 ? `${entry} Hop` : 'Hop'); R0.mode = e.mode === 'slide' ? 'slide' : R0.mode;
          this.air = null; break;
        }
        this.railT = { kind: e.kind, top: e.rail && e.rail.top, rail: e.rail, mode: e.mode, sw: e.sw, entry, dir, swaps: [], t: 0, press: 0, preSw: this.air ? this.air.sw : sk.sw };
        this.air = null;
        break;
      }
      // from one slide to the other through a 50-50 is a front swap, through switch a back swap; anything else a switch-up
      // (a quarter turn names where it went: to a slide, or back to a 50-50 either way round)
      case 'railSwap': if (this.railT) {
        const half = Math.abs(Math.abs(e.from - e.to) - Math.PI) < 0.1, R = this.railT;
        const flat = R.top ? R.top === 'flat' : /^(box|bench|ledge|table|picnic)$/.test(R.kind || '');
        R.swaps.push(half ? (e.mode === 'slide' ? (e.front ? 'Front Swap' : 'Back Swap') : '180 Switch-Up')
          : e.mode === 'slide' ? (flat ? 'to Boardslide' : 'to Lip Slide') : Math.cos(e.to) < 0 ? 'to Switch 50-50' : 'to 50-50');
      } break;
      case 'railOff': if (this.railT) { this.railT.done = true; this.railT.press = e.press || 0; this.railT.how = e.how; this.railT.one = this.railT.one || !!e.one; } break;
      case 'railFall': this.railT = null; break;
      case 'butter': { const W = RIDE_WORDS[sk.kind]; this.award(`${(W && (e.nose ? W.nose : W.tail)) || (e.nose ? 'Nose Butter' : 'Tail Butter')} ${round180(e.deg)}`, 100 + round180(e.deg) / 180 * 110, 'clean'); break; }   // (S: RIDE_WORDS)
      case 'revert': if (this.combo) this.award('Revert', 60, 'clean'); break;
      case 'lazyboy': this.award((RIDE_WORDS[sk.kind] && RIDE_WORDS[sk.kind].lazy) || (sk.kind === 'board' ? 'Hand Drag' : 'Lazy Boy'), Math.round(80 + 60 * Math.min(3, e.t)), 'clean'); break;   // (B: on a board it is a hand drag)
      case 'crash': this.bail(); break;
      case 'respawn': case 'lift': this.air = null; this.railT = null; break;
    }
  }
  land(e, sk) {
    const A = this.air; this.air = null;
    if (!A) return;
    if (e.q === 'crash') return;          // the crash event that follows says Bail
    const spinAbs = Math.abs(A.spin), spinR = round180(spinAbs);
    // (X: on the extra rides the key of a timed trick is not a grab: the trick is named from its 'act' events)
    const rideK = sk.kind && sk.kind !== 'ski' ? sk.kind : null, isAct = id => { const d = rideK && rideGrabDef(rideK, id); return !!(d && d.act); };
    const grabs = A.grabs.filter(g => g.t >= 0.18 && !isAct(g.id));
    const acts = A.acts || [];
    const parts = [];
    let pts = 0;
    // a rail trick finishes with what came off it
    if (A.fromRail && this.railT && this.railT.done) {
      const R = this.railT; this.railT = null;
      const name = [];
      const onBoard = sk.kind === 'board', ride = sk.kind && sk.kind !== 'ski', gDef = id => ride ? rideGrabDef(sk.kind, id) : GRABS[id];
      if (R.entry >= 90) name.push(onBoard ? `${((R.dir === 'Left') !== !!sk.goofy) !== !!R.preSw ? 'Frontside' : 'Backside'} ${R.entry} On` : `${R.dir} ${R.entry} On`);
      else if (R.preSw) name.push('Switch');
      const flat = R.top ? R.top === 'flat' : /^(box|bench|ledge|table|picnic)$/.test(R.kind || '');
      // (P, 2026-11-08: ridden on one ski or foot, R held, for 0.4 s or more)
      if (R.one) name.push((RIDE_WORDS[sk.kind] && RIDE_WORDS[sk.kind].oneFoot) || (sk.kind && sk.kind !== 'ski' ? 'One-Footed' : 'One-Ski'));
      name.push((onBoard && boardRailName(R.mode, sk.railLock || 0, sk.goofy)) || (R.mode === 'slide' ? (flat ? 'Boardslide' : 'Lip Slide') : (R.sw ? 'Switch 50-50' : '50-50')));
      if (Math.abs(R.press) > 0.35) name.push(R.press > 0 ? 'Nose Press' : 'Tail Press');
      name.push(...R.swaps);
      // (the quarter turn back to the travel off a slide is not a spin out)
      const exit = round90(Math.max(0, spinAbs - Math.abs(A.unslide || 0)));
      if (exit >= 90) name.push(`${exit} Out`);
      else if (e.sw !== R.preSw && R.mode === '5050') name.push('to Fakie');
      for (const g of grabs) name.push(gDef(g.id) ? gDef(g.id).name : g.id);
      pts = 160 + R.t * 140 + R.entry / 90 * 70 + exit / 90 * 70 + R.swaps.length * 130 + (Math.abs(R.press) > 0.35 ? 100 : 0) + (R.mode === 'slide' ? 60 : 0) + (R.one ? 110 : 0);
      this.award(name.join(', '), pts, e.q);
      return;
    }
    const tAir = e.tAir;
    const shifty = A.shifty && A.shifty.t > 0.15 ? `${A.shifty.dir > 0 ? 'Right' : 'Left'} Shifty` : '';
    if (spinR < 180 && A.inv === 0 && !grabs.length && !shifty && !acts.length && tAir < 0.9) return;     // a hop, not a trick
    if (A.how === 'wall' && spinR < 180 && A.inv === 0 && !grabs.length) return;          // slid off a face
    const rsp = RIDE_SPIN[sk.kind];
    const board = sk.kind === 'board', ride = sk.kind && sk.kind !== 'ski', bsp = board ? boardSpinParts(A, sk.goofy) : rsp ? rsp(A) : null, gDef = id => ride ? rideGrabDef(sk.kind, id) : GRABS[id];
    if (A.sw && !bsp) parts.push(rsp ? 'Fakie' : 'Switch');
    // (a bar spin or a tail whip that had not gone all the way round when the snow came is landed sketchy)
    for (const g of grabs) { const d = gDef(g.id); if (d && d.spinT && tAirOf(e) - (g.at || 0) < d.spinT * 0.92) e = Object.assign({}, e, { q: e.q === 'clean' ? 'sketchy' : e.q }); }
    const flipBack = A.flip < 0;
    if (A.inv > 0) {
      const mult = MULT[Math.min(A.inv, 4) - 1];
      if (bsp) parts.push(...bsp);
      else if (A.pipe && A.inv === 1 && flipBack && spinR === 180) parts.push('Flair');
      else if (spinR < 180) {
        if (Math.abs(A.roll) > Math.abs(A.flip)) parts.push(`${mult}Lincoln Loop`);
        else parts.push(`${mult}${flipBack ? 'Back Flip' : 'Front Flip'}`);
      } else {
        // spin-led off-axis rotation is a cork (bio forwards); flip-led, the axis near level, a rodeo (misty forwards)
        const off = Math.abs(A.flip) < spinAbs * 1.9;
        const kind = flipBack ? (off ? 'Cork' : 'Rodeo') : (off ? 'Bio' : 'Misty');
        // off-axis tricks are counted by all their turning (a cork 720 is two turns round its tipped axis), and as
        // riders count them one inversion fewer than the turns: a cork 720, a double cork 1080, a triple cork 1440
        const deg = Math.max(spinR, round180(A.total)), invN = Math.max(1, Math.min(A.inv, Math.round(deg / 360) - 1));
        parts.push(A.spin > 0 ? 'Left' : 'Right', `${MULT[Math.min(invN, 4) - 1]}${kind} ${deg}`);
      }
      pts += A.inv * 360 + (spinR >= 180 ? 120 : 0);
    } else if (spinR >= 180) {
      const pre = A.how === 'pop' && Math.abs(A.press) > 0.35 ? (A.press > 0 ? 'Nollie ' : 'Ollie ') : '';
      if (A.pipe && A.oop) parts.push('Alley-oop');
      if (bsp) { if (pre) parts.push(pre.trim()); parts.push(...bsp); }
      else parts.push(A.spin > 0 ? 'Left' : 'Right', `${pre}${spinR}`);
    } else if (!grabs.length && !shifty && !acts.length) parts.push('Straight Air');
    if (shifty) { parts.push(shifty); pts += 90; }
    pts += spinR / 180 * 125;
    for (const g of grabs) {
      const d = gDef(g.id); if (!d) continue;
      pts += (d.pos ? 90 : 130) + Math.min(1.6, g.t) * (d.pos ? 160 : 240);
    }
    // a variation (E or R with the grab) is named for what it is; a plain grab held a second or more is tweaked
    const gn = grabs.map(g => { const d = ride ? rideGrabDef(sk.kind, g.id, g.mod) : grabDef(g.id, g.mod); if (!d) return null; return (g.t >= 1.0 && !d.pos && !d.noTweak && !g.mod ? 'Tweaked ' : '') + d.name; }).filter(Boolean);
    for (const g of grabs) { if (g.t >= 1.0) pts += 80; if (g.mod) pts += 70; }
    // (X: the extra rides: the timed tricks and the held ones in the order they were started, "360 Tailwhip to Superman",
    // "Double Tailwhip", "Backflip Barspin")
    if (acts.length) {
      const seq = []; for (const g of grabs) { const d = rideGrabDef(sk.kind, g.id, g.mod); if (d) seq.push({ at: g.at || 0, name: d.name }); }
      for (const a of acts) {
        const d = rideGrabDef(sk.kind, a.id); if (!d) continue;
        const last = seq.length && seq[seq.length - 1];
        if (last && last.act === a.id) { last.n += a.n; last.name = `${MULT[Math.min(last.n, 5) - 1]}${d.name}`; }
        else seq.push({ at: a.at, act: a.id, n: a.n, name: `${MULT[Math.min(a.n, 5) - 1]}${d.name}` });
        pts += (d.pts || 250) * a.n * (1 + 0.35 * (a.n - 1));
      }
      seq.sort((x, y) => x.at - y.at);
      if (seq.length) parts.push(seq.map(x => x.name).join(' to '));
    } else if (gn.length) parts.push(gn.join(' to '));
    pts += tAir * 45;
    if (A.sw) pts *= 1.2;
    this.award(parts.join(' '), pts, e.q);
  }
  award(name, pts, quality) {
    pts = Math.round((quality === 'sketchy' ? 0.5 : 1) * pts / 5) * 5;
    this.combo++; this.comboT = 0; this.comboPts += pts;
    this.onTrick({ name: (quality === 'sketchy' ? 'Sketchy ' : '') + name, points: pts, quality, combo: this.combo });
  }
  bail() {
    this.air = null; this.railT = null;
    this.comboPts = 0; this.combo = 0;
    this.onTrick({ name: 'Bail', points: 0, quality: 'bail', combo: 0 });
  }
  endCombo() {
    const mult = Math.min(1 + (this.combo - 1) * 0.25, 4);
    const total = Math.round(this.comboPts * mult);
    this.score += total;
    this.onTrick({ name: this.combo > 1 ? `Line x${mult.toFixed(2).replace(/\.?0+$/, '')}` : '', points: total, quality: 'line', combo: 0, banked: true });
    this.combo = 0; this.comboPts = 0;
  }
}
