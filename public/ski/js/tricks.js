// Trick names and points. The air is measured, not guessed from keys: every physics step the body's turn is split
// into its spin (about its own long axis), flip (about its left-right axis) and roll, and the times the body goes
// upside down are counted. A landing then names what was done the way freeskiers say it:
//   [Switch] [Left|Right] [Double] Cork|Rodeo|Bio|Misty 1080 [Mute to Tail]   or   Back Flip, Lincoln Loop, 360...
// Rails: entry spin, 50-50 or slide, swaps and presses, exit spin ("Left 270 On, Slide, Back Swap, 270 Out").
import * as THREE from 'three';
import { GRABS, grabDef } from './grabs.js?v=9';

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
const MULT = ['', 'Double ', 'Triple ', 'Quad ', 'Quint '];
const round180 = d => Math.round(d / 180) * 180;
const round90 = d => Math.round(d / 90) * 90;

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
        this.air = { sw: e.sw, how: e.how, spin: 0, flip: 0, roll: 0, total: 0, inv: 0, invNow: false, grabs: [], prevQ: sk.q.clone(), fromRail: e.rail, press: e.press || 0, t0: performance.now(),
          pipe: !!e.pipe, fwd0: new THREE.Vector3(0, 0, 1).applyQuaternion(sk.q), oop: null };
        if (!e.rail) this.railT = this.railT && this.railT.done ? null : this.railT;
        break;
      case 'grab': if (this.air) this.air.grabs.push({ id: e.id, t: 0 }); break;
      case 'grabEnd': if (this.air) { const g = this.air.grabs.findLast?.(x => x.id === e.id) || this.air.grabs.filter(x => x.id === e.id).pop(); if (g) { g.t = e.t; g.mod = e.mod || ''; } } break;
      case 'shifty': if (this.air && !this.air.shifty) this.air.shifty = { dir: e.dir, t: e.t }; break;
      case 'land': this.land(e, sk); break;
      case 'railOn': {
        const entry = this.air ? round90(Math.abs(this.air.spin)) : 0;
        const dir = this.air && this.air.spin > 0 ? 'Left' : 'Right';
        this.railT = { kind: e.kind, mode: e.mode, sw: e.sw, entry, dir, swaps: [], t: 0, press: 0, preSw: this.air ? this.air.sw : sk.sw };
        this.air = null;
        break;
      }
      // from one slide to the other through a 50-50 is a front swap, through switch a back swap; anything else a switch-up
      case 'railSwap': if (this.railT) { const half = Math.abs(Math.abs(e.from - e.to) - Math.PI) < 0.1; this.railT.swaps.push(half ? (e.mode === 'slide' ? (e.front ? 'Front Swap' : 'Back Swap') : '180 Switch-Up') : 'Switch-Up'); } break;
      case 'railOff': if (this.railT) { this.railT.done = true; this.railT.press = e.press || 0; this.railT.how = e.how; } break;
      case 'railFall': this.railT = null; break;
      case 'butter': this.award(`${e.nose ? 'Nose' : 'Tail'} Butter ${round180(e.deg)}`, 100 + round180(e.deg) / 180 * 110, 'clean'); break;
      case 'revert': if (this.combo) this.award('Revert', 60, 'clean'); break;
      case 'crash': this.bail(); break;
      case 'respawn': this.air = null; this.railT = null; break;
    }
  }
  land(e, sk) {
    const A = this.air; this.air = null;
    if (!A) return;
    if (e.q === 'crash') return;          // the crash event that follows says Bail
    const spinAbs = Math.abs(A.spin), spinR = round180(spinAbs);
    const grabs = A.grabs.filter(g => g.t >= 0.18);
    const parts = [];
    let pts = 0;
    // a rail trick finishes with what came off it
    if (A.fromRail && this.railT && this.railT.done) {
      const R = this.railT; this.railT = null;
      const name = [];
      if (R.entry >= 90) name.push(`${R.dir} ${R.entry} On`);
      else if (R.preSw) name.push('Switch');
      name.push(R.mode === 'slide' ? (R.kind === 'box' ? 'Boardslide' : 'Lip Slide') : (R.sw ? 'Switch 50-50' : '50-50'));
      if (Math.abs(R.press) > 0.35) name.push(R.press > 0 ? 'Nose Press' : 'Tail Press');
      name.push(...R.swaps);
      const exit = round90(spinAbs);
      if (exit >= 90) name.push(`${exit} Out`);
      else if (e.sw !== R.preSw && R.mode === '5050') name.push('to Fakie');
      for (const g of grabs) name.push(GRABS[g.id] ? GRABS[g.id].name : g.id);
      pts = 160 + R.t * 140 + R.entry / 90 * 70 + exit / 90 * 70 + R.swaps.length * 130 + (Math.abs(R.press) > 0.35 ? 100 : 0) + (R.mode === 'slide' ? 60 : 0);
      this.award(name.join(', '), pts, e.q);
      return;
    }
    const tAir = e.tAir;
    const shifty = A.shifty && A.shifty.t > 0.15 ? `${A.shifty.dir > 0 ? 'Right' : 'Left'} Shifty` : '';
    if (spinR < 180 && A.inv === 0 && !grabs.length && !shifty && tAir < 0.9) return;     // a hop, not a trick
    if (A.how === 'wall' && spinR < 180 && A.inv === 0 && !grabs.length) return;          // slid off a face
    if (A.sw) parts.push('Switch');
    const flipBack = A.flip < 0;
    if (A.inv > 0) {
      const mult = MULT[Math.min(A.inv, 4) - 1];
      if (A.pipe && A.inv === 1 && flipBack && spinR === 180) parts.push('Flair');
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
      parts.push(A.spin > 0 ? 'Left' : 'Right', `${pre}${spinR}`);
    } else if (!grabs.length && !shifty) parts.push('Straight Air');
    if (shifty) { parts.push(shifty); pts += 90; }
    pts += spinR / 180 * 125;
    for (const g of grabs) {
      const d = GRABS[g.id]; if (!d) continue;
      pts += (d.pos ? 90 : 130) + Math.min(1.6, g.t) * (d.pos ? 160 : 240);
    }
    // a variation (E or R with the grab) is named for what it is; a plain grab held a second or more is tweaked
    const gn = grabs.map(g => { const d = grabDef(g.id, g.mod); if (!d) return null; return (g.t >= 1.0 && !d.pos && !g.mod ? 'Tweaked ' : '') + d.name; }).filter(Boolean);
    for (const g of grabs) { if (g.t >= 1.0) pts += 80; if (g.mod) pts += 70; }
    if (gn.length) parts.push(gn.join(' to '));
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
