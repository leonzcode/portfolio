// Poses and fighter drawing. A pose is a set of joint angles; moves blend
// ready -> wind-up -> strike -> ready over their frames.
// Limb angles: 0 points straight down, PI/2 points the way the fighter faces,
// PI points up. Elbow/knee values bend relative to the upper limb.

const PI = Math.PI;
const BASE = { hipH: 0.95, lean: 0.1, head: 0, aF: [0.5, 0.9], aB: [-0.3, 0.7], lF: [0.25, -0.3], lB: [-0.2, -0.2], rot: 0, sw: 0 };

function P(o) { return Object.assign({}, BASE, o); }

const ANIMS = {
  jab: [P({ aF: [1.1, 1.5], lean: 0.15 }), P({ aF: [1.55, 0.05], aB: [-0.6, 0.8], lean: 0.25 })],
  jab2: [P({ aB: [1.0, 1.4], lean: 0.15 }), P({ aB: [1.55, 0.05], aF: [-0.4, 0.9], lean: 0.28 })],
  jab3: [P({ lF: [1.0, -1.6], lean: 0 }), P({ lF: [1.55, 0], lB: [-0.25, -0.1], lean: -0.25, aF: [0.2, 0.4], aB: [-0.9, 0.3] })],
  ftilt: [P({ lF: [0.7, -1.4], lean: -0.05 }), P({ lF: [1.55, -0.05], lean: -0.35, aF: [0.1, 0.3], aB: [-0.9, 0.4] })],
  utilt: [P({ aF: [0.3, 1.3], lean: 0.15 }), P({ aF: [3.05, 0.1], aB: [-0.6, 0.6], lean: -0.15 })],
  dtilt: [P({ hipH: 0.55, lean: 0.6, lF: [0.8, -1.8], lB: [-0.4, -1.6] }), P({ hipH: 0.5, lean: 0.5, lF: [1.55, -0.1], lB: [-0.5, -1.7], aF: [0.6, 0.6] })],
  dashatk: [P({ lean: 0.5, aF: [1.4, 0.3] }), P({ lean: 0.65, lF: [1.45, -0.1], lB: [-0.6, -1.3], aF: [1.6, 0], aB: [-1.4, 0.2] })],
  fsmash: [P({ lean: -0.35, aF: [-1.4, 1.0], aB: [0.6, 1.0], lF: [0.6, -0.4], lB: [-0.4, -0.2] }), P({ lean: 0.45, aF: [1.6, 0], aB: [-1.2, 0.4], lF: [0.75, -0.2], lB: [-0.6, -0.1] })],
  usmash: [P({ hipH: 0.7, lean: 0.4, aF: [0.3, 1.5], aB: [0.2, 1.5] }), P({ lean: -0.2, head: -0.6, aF: [3.0, 0.1], aB: [2.8, 0.1], hipH: 1 })],
  dsmash: [P({ hipH: 0.55, lean: 0.2, aF: [0.8, 0.5], aB: [-0.8, 0.5] }), P({ hipH: 0.42, lean: 0.05, lF: [1.55, 0], lB: [-1.55, 0], aF: [0.4, 0.3], aB: [-0.4, 0.3] })],
  nair: [P({ lF: [1.0, -1.5], lB: [0.3, -1.4] }), P({ lF: [1.5, -0.05], lB: [-0.5, -1.6], lean: -0.2, aF: [1.2, 0.3], aB: [-1.2, 0.3] })],
  fair: [P({ aF: [2.9, 0.3], aB: [2.7, 0.3], lean: -0.35, lF: [0.6, -1.0] }), P({ aF: [1.0, 0.1], aB: [0.9, 0.1], lean: 0.55, lF: [0.3, -0.8] })],
  bair: [P({ lB: [-0.8, -1.5], lean: 0.3 }), P({ lB: [-1.75, 0], lean: 0.6, aF: [0.8, 0.5], lF: [0.6, -1.4] })],
  uair: [P({ lF: [0.9, -1.5], lB: [0.5, -1.2] }), P({ lF: [2.6, -0.1], lB: [0.3, -1.4], spin: -1 })],
  dair: [P({ lF: [1.0, -1.6], lB: [0.8, -1.5], aF: [2.2, 0.4], aB: [2.0, 0.4] }), P({ lF: [0.05, 0], lB: [0.3, -0.4], aF: [2.6, 0.2], aB: [-2.5, 0.2], lean: -0.1 })],
  drill: [P({ lF: [0.2, 0], lB: [0.2, 0], aF: [2.9, 0], aB: [2.9, 0] }), P({ lF: [0.05, 0], lB: [0.05, 0], aF: [3.0, 0], aB: [3.0, 0], drill: true })],
  grab: [P({ aF: [1.2, 0.6], aB: [1.0, 0.6], lean: 0.2 }), P({ aF: [1.55, 0.05], aB: [1.5, 0.05], lean: 0.35 })],
  pummel: [P({ aF: [1.5, 0.2], aB: [1.4, 0.2], lean: -0.1 }), P({ lean: 0.45, aF: [1.5, 0.2], aB: [1.4, 0.2], head: 0.4 })],
  fthrow: [P({ aF: [1.5, 0.2], aB: [1.4, 0.2] }), P({ aF: [1.75, 0], aB: [1.6, 0], lean: 0.45, lF: [0.7, -0.2] })],
  bthrow: [P({ aF: [1.5, 0.2], aB: [1.4, 0.2] }), P({ aF: [-1.6, 0.1], aB: [-1.5, 0.1], lean: -0.45, spin: 0.5 })],
  uthrow: [P({ aF: [1.5, 0.2], aB: [1.4, 0.2], hipH: 0.8 }), P({ aF: [3.0, 0.1], aB: [3.0, 0.1], lean: -0.2, hipH: 1 })],
  dthrow: [P({ aF: [1.5, 0.2], aB: [1.4, 0.2] }), P({ hipH: 0.65, lean: 0.75, aF: [0.2, 0.2], aB: [0.1, 0.2] })],
  throwball: [P({ aF: [-1.0, 1.3], lean: -0.2 }), P({ aF: [1.55, 0.1], lean: 0.3, aB: [-0.8, 0.4] })],
  flykick: [P({ lF: [0.9, -1.4], lean: -0.1 }), P({ lF: [1.6, 0], lB: [0.2, -1.6], lean: -0.45, aF: [2.0, 0.6] })],
  uppercut: [P({ hipH: 0.7, aF: [0.5, 1.6] }), P({ aF: [3.0, 0.05], lean: -0.1, lB: [-0.2, -1.4], lF: [0.6, -1.2], spin: 1 })],
  spin: [P({ aF: [1.6, 0], aB: [-1.6, 0] }), P({ aF: [1.6, 0], aB: [-1.6, 0], flip: true, lF: [0.4, -0.4], lB: [-0.4, -0.4] })],
  headbutt: [P({ lean: 0.6, hipH: 0.75 }), P({ lean: 1.35, lF: [-0.7, -0.3], lB: [-1.0, -0.2], aF: [-1.2, 0.2], aB: [-1.3, 0.2], hipH: 0.9 })],
  zip: [P({ hipH: 0.7, lean: 0.5, lF: [1.2, -2.2], lB: [1.0, -2.0], aF: [1.0, 1.8], aB: [0.8, 1.8] }), P({ hipH: 0.7, lean: 0.6, lF: [1.2, -2.3], lB: [1.0, -2.1], aF: [1.0, 1.9], aB: [0.8, 1.9] })],
  thunder: [P({ aF: [3.0, 0.1], aB: [2.9, 0.1], lean: -0.1 }), P({ aF: [3.0, 0.1], aB: [2.9, 0.1], lean: -0.15, hipH: 0.8 })],
  haymaker: [P({ lean: -0.35, aF: [-1.7, 0.9], hipH: 0.85, lF: [0.5, -0.5] }), P({ lean: 0.5, aF: [1.6, 0], aB: [-1.0, 0.4], lF: [0.85, -0.3], lB: [-0.7, -0.1] })],
  shoulder: [P({ lean: 0.3 }), P({ lean: 0.75, aF: [0.6, 1.2], aB: [0.2, 1.4], lF: [0.6, -0.4], lB: [-0.6, -0.2] })],
  rocket: [P({ hipH: 0.7, aF: [0.8, 1.2] }), P({ aF: [3.0, 0], aB: [2.9, 0], flip: true })],
  quake: [P({ hipH: 1, lF: [1.4, -1.4], aF: [2.4, 0.5], aB: [2.3, 0.5] }), P({ hipH: 0.6, lean: 0.3, lF: [0.45, -0.6], lB: [-0.4, -0.5], aF: [0.6, 0.3], aB: [-0.4, 0.3] })],
  slash: [P({ aF: [2.6, 0.3], lean: -0.2 }), P({ aF: [0.9, 0.1], lean: 0.4 })],
  lunge: [P({ lean: -0.1, aF: [0.2, 1.4] }), P({ lean: 0.6, aF: [1.57, 0], lF: [1.1, -0.2], lB: [-1.0, -0.1] })],
  skyspin: [P({ aF: [1.2, 0.3] }), P({ aF: [1.57, 0], aB: [-1.5, 0.2], flip: true })],
  counter: [P({ aF: [1.2, 1.8], lean: -0.1, hipH: 0.85 }), P({ aF: [1.2, 1.9], lean: -0.15, hipH: 0.85 })],
  swordup: [P({ aF: [-1.0, 0.6] }), P({ aF: [3.2, 0.1], lean: -0.2 })],
  swordf: [P({ aF: [2.8, 0.2], lean: -0.2 }), P({ aF: [1.2, 0.1], lean: 0.35 })],
  swordb: [P({ aF: [0.8, 0.4] }), P({ aF: [-1.7, 0.1], lean: 0.3 })],
  swordsmash: [P({ aF: [3.0, 0.3], lean: -0.4, lF: [0.5, -0.3] }), P({ aF: [1.0, 0], lean: 0.6, lF: [0.9, -0.2], lB: [-0.8, 0] })],
  swordlow: [P({ hipH: 0.55, lean: 0.5, aF: [0.4, 0.3] }), P({ hipH: 0.5, lean: 0.55, aF: [1.45, 0], lF: [0.9, -1.2] })],
  swordspin: [P({ aF: [1.4, 0.2] }), P({ aF: [1.57, 0], aB: [-1.4, 0.2], flip: true })],
};

const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);

function blend(a, b, t) {
  const o = {};
  for (const k in a) {
    if (Array.isArray(a[k])) o[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)];
    else if (typeof a[k] === 'number') o[k] = lerp(a[k], b[k] == null ? a[k] : b[k], t);
    else o[k] = t < 0.5 ? a[k] : b[k];
  }
  for (const k in b) if (!(k in o)) o[k] = t < 0.5 ? a[k] : b[k];
  return o;
}

function movePose(f, idle) {
  const mi = f.move, m = mi.m;
  const pair = ANIMS[m.anim] || ANIMS.jab;
  const hits = (mi.countered && mi.extraHits) || m.hits || [];
  let s = hits.length ? Math.min(...hits.map(h => h.start)) : (m.proj ? m.proj.at : m.release || Math.round(m.total * 0.3));
  let e = hits.length ? Math.max(...hits.map(h => h.end)) : s + 4;
  if (m.counter && !mi.countered) { s = m.counter[0]; e = m.counter[1]; }
  const t = mi.f;
  const start = idle;
  let p;
  if (t < s) p = blend(start, pair[0], ease(Math.min(1, t / Math.max(1, s))));
  else if (t <= e) p = blend(pair[0], pair[1], ease(Math.min(1, (t - s + 1) / Math.max(2, Math.min(4, e - s + 1)))));
  else p = blend(pair[1], start, ease(Math.min(1, (t - e) / Math.max(1, m.total - e))));
  if (mi.countered && t >= s) p = blend(ANIMS.swordf[0], ANIMS.swordf[1], ease(Math.min(1, (t - m.counter[1]) / 4)));
  // spins and flips
  const pr = Math.max(0, Math.min(1, (t - s) / Math.max(1, e - s + 2)));
  if (pair[1].spin) p.rot = pair[1].spin * 2 * PI * ease(pr) * (t >= s ? 1 : 0);
  if (pair[1].flip && t >= s && t <= e + 2) p.flipNow = Math.floor((t - s) / 3) % 2 === 1;
  if (pair[1].drill && t >= s && t <= e) p.flipNow = Math.floor(t / 2) % 2 === 1;
  if (mi.charge && t === m.charge) p.chargeShake = true;
  return p;
}

export function poseFor(f, frame) {
  const t = frame + f.slot * 37;
  const st = f.state;
  const breathe = Math.sin(t * 0.07) * 0.025;
  const idle = P({ hipH: 0.95 + breathe, aF: [0.5 + breathe, 0.9], aB: [-0.3 - breathe, 0.7] });
  switch (st) {
    case 'attack': return movePose(f, idle);
    case 'throw': return f.move ? movePose(f, idle) : idle;
    case 'holding': return P({ aF: [1.55, 0.05], aB: [1.5, 0.05], lean: 0.3 });
    case 'walk': {
      const ph = f.sf * 0.17, s = Math.sin(ph);
      return P({ lF: [s * 0.55, -0.25 - Math.max(0, -s) * 0.5], lB: [-s * 0.55, -0.25 - Math.max(0, s) * 0.5], aF: [-s * 0.45 + 0.2, 0.5], aB: [s * 0.45 - 0.1, 0.5], hipH: 0.95 + Math.abs(s) * 0.02 });
    }
    case 'dash': case 'run': {
      const ph = f.sf * 0.36, s = Math.sin(ph);
      return P({ lean: 0.38, lF: [s * 1.05 + 0.2, -0.6 - Math.max(0, -s) * 1.2], lB: [-s * 1.05 + 0.2, -0.6 - Math.max(0, s) * 1.2], aF: [-s * 1.1 + 0.3, 1.2], aB: [s * 1.1 + 0.1, 1.2], hipH: 0.9 + Math.abs(Math.cos(ph)) * 0.05 });
    }
    case 'skid': case 'turn': return P({ lean: -0.35, lF: [0.7, -0.2], lB: [-0.3, -0.6], aF: [1.2, 0.6], aB: [-1.0, 0.6], hipH: 0.82 });
    case 'crouch': return P({ hipH: 0.55, lean: 0.45, lF: [0.9, -1.8], lB: [0.5, -1.7], aF: [0.8, 0.9], aB: [0.6, 0.9] });
    case 'jumpsquat': case 'land': return P({ hipH: 0.68, lean: 0.25, lF: [0.7, -1.4], lB: [0.4, -1.2], aF: [-0.4, 0.6], aB: [-0.6, 0.6] });
    case 'shield': case 'shieldstun': case 'shielddrop': return P({ hipH: 0.85, lean: 0.15, aF: [1.3, 1.6], aB: [1.1, 1.7], lF: [0.4, -0.4], lB: [-0.3, -0.3] });
    case 'spotdodge': return P({ hipH: 0.7, lean: -0.2, aF: [0.3, 1.5], aB: [0.2, 1.5] });
    case 'roll': case 'tech': {
      const r = Math.min(1, f.sf / 22);
      const p = P({ hipH: 0.6, lean: 0.6, lF: [1.3, -2.2], lB: [1.1, -2.1], aF: [1.2, 1.8], aB: [1.0, 1.8] });
      p.rot = (st === 'roll' ? -(f.rollDir || 1) * f.face : -(f.techDir || 0) * f.face) * 2 * PI * ease(r);
      return p;
    }
    case 'airdodge': return P({ hipH: 0.75, lean: 0.4, lF: [1.0, -1.8], lB: [0.8, -1.7], aF: [1.0, 1.7], aB: [0.8, 1.7] });
    case 'hitstun': {
      if (f.tumble) { const p = P({ lean: -0.4, aF: [2.4, 0.4], aB: [-2.2, 0.4], lF: [0.8, -0.6], lB: [-0.5, -0.4] }); p.rot = (t * 0.25) * -f.face; return p; }
      return P({ lean: -0.5, head: -0.4, aF: [2.0, 0.6], aB: [-1.8, 0.6], lF: [0.5, -0.4], lB: [-0.4, -0.3] });
    }
    case 'knockdown': { const p = P({ lean: 0, aF: [2.5, 0.2], aB: [-2.5, 0.2], lF: [0.2, -0.3], lB: [-0.2, -0.2] }); p.lying = true; return p; }
    case 'getup': { const k = Math.min(1, f.sf / 20); const p = P({ hipH: 0.6 + 0.35 * k, lean: 0.6 * (1 - k) }); if (k < 0.4) p.lying = true; return p; }
    case 'helpless': return P({ lean: -0.2, aF: [2.6, 0.5], aB: [2.4, 0.5], lF: [0.3, -0.5], lB: [-0.2, -0.4], dim: true });
    case 'shieldbreak': case 'dizzy': {
      const sw = Math.sin(t * 0.12);
      return P({ lean: sw * 0.25 - 0.1, head: sw * 0.4, aF: [0.2 + sw * 0.2, 0.3], aB: [0.1 - sw * 0.2, 0.3], hipH: 0.9, dizzy: true });
    }
    case 'ledge': return P({ hipH: 0.95, lean: 0.05, aF: [3.0, 0.05], aB: [2.95, 0.05], lF: [0.15, -0.2], lB: [-0.1, -0.15] });
    case 'ledgeclimb': case 'ledgeroll': return P({ hipH: 0.6, lean: 0.5, lF: [1.2, -2.0], lB: [0.9, -1.8], aF: [1.6, 0.4], aB: [1.5, 0.4] });
    case 'grabbed': return P({ lean: -0.2, head: -0.3, aF: [0.2, 0.2], aB: [-0.2, 0.2], lF: [0.1, -0.1], lB: [-0.1, -0.1], hipH: 1 });
    case 'getupatk': return idle;
    case 'respawn': return idle;
    case 'air': {
      if (f.airAnim === 'djump' && f.djT != null && f.djT < 22) {
        const p = P({ lF: [1.1, -2.0], lB: [0.9, -1.9], aF: [1.4, 1.4], aB: [1.2, 1.4], hipH: 0.8 });
        p.rot = -f.face * 2 * PI * ease(f.djT / 22) * 0;
        p.rot = 2 * PI * ease(Math.min(1, f.djT / 22));
        return p;
      }
      if (f.vy < -2) return P({ lF: [0.9, -1.6], lB: [0.2, -0.6], aF: [2.2, 0.4], aB: [-0.8, 0.5], lean: 0.05 });
      return P({ lF: [0.4, -0.7], lB: [-0.1, -0.3], aF: [1.9, 0.5], aB: [-1.4, 0.5], lean: -0.05 });
    }
    default: return idle;
  }
}

// ---------------------------------------------------------------- drawing
function dir(a, face) { return { x: Math.sin(a) * face, y: Math.cos(a) }; }

export function skeleton(f, pose, x, y, face, scale) {
  const s = (scale || 1) * f.c.size;
  const L = { thigh: 17 * s, shin: 17 * s, torso: 25 * s, upper: 14 * s, fore: 14 * s, head: 12.5 * s };
  const hip = { x, y: y - (L.thigh + L.shin) * 0.97 * pose.hipH };
  const lean = pose.lean;
  const up = { x: Math.sin(lean) * face, y: -Math.cos(lean) };
  const neck = { x: hip.x + up.x * L.torso, y: hip.y + up.y * L.torso };
  const headC = { x: neck.x + up.x * (L.head + 1) + Math.sin(lean + pose.head) * face * 2, y: neck.y + up.y * (L.head + 1) };
  const sh = { x: neck.x - up.x * 3 * s, y: neck.y - up.y * 3 * s };
  const arm = (a) => {
    const d1 = dir(a[0] + lean, face), d2 = dir(a[0] + a[1] + lean, face);
    const el = { x: sh.x + d1.x * L.upper, y: sh.y + d1.y * L.upper };
    return { a: sh, b: el, c: { x: el.x + d2.x * L.fore, y: el.y + d2.y * L.fore }, ang: a[0] + a[1] + lean };
  };
  const leg = (l) => {
    const d1 = dir(l[0], face), d2 = dir(l[0] + l[1], face);
    const kn = { x: hip.x + d1.x * L.thigh, y: hip.y + d1.y * L.thigh };
    return { a: hip, b: kn, c: { x: kn.x + d2.x * L.shin, y: kn.y + d2.y * L.shin } };
  };
  return { s, L, hip, neck, headC, aF: arm(pose.aF), aB: arm(pose.aB), lF: leg(pose.lF), lB: leg(pose.lB), center: { x: hip.x, y: hip.y - L.torso * 0.4 } };
}

function rotPt(p, c, a) {
  const cs = Math.cos(a), sn = Math.sin(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

function rotateSkeleton(sk, a) {
  if (!a) return sk;
  const c = sk.center;
  const R = p => rotPt(p, c, a);
  const limb = l => Object.assign({}, l, { a: R(l.a), b: R(l.b), c: R(l.c) });
  return Object.assign({}, sk, { hip: R(sk.hip), neck: R(sk.neck), headC: R(sk.headC), aF: limb(sk.aF), aB: limb(sk.aB), lF: limb(sk.lF), lB: limb(sk.lB), rotA: a });
}

function capsule(ctx, a, b, w, fill, outline) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline; ctx.lineWidth = w + 4;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.strokeStyle = fill; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  // soft highlight on the side facing the light (up and to the left) for a rounded, lit look
  const dx = b.x - a.x, dy = b.y - a.y, m = Math.hypot(dx, dy) || 1;
  let px = -dy / m, py = dx / m;
  if (py > 0 || (py === 0 && px > 0)) { px = -px; py = -py; }
  const o = w * 0.22;
  if (fill !== '#ffffff') {
    ctx.strokeStyle = shade(fill, 0.38); ctx.globalAlpha *= 0.75; ctx.lineWidth = w * 0.32;
    ctx.beginPath(); ctx.moveTo(a.x + px * o, a.y + py * o); ctx.lineTo(b.x + px * o, b.y + py * o); ctx.stroke();
    ctx.globalAlpha /= 0.75;
    ctx.strokeStyle = shade(fill, -0.22); ctx.globalAlpha *= 0.5; ctx.lineWidth = w * 0.25;
    ctx.beginPath(); ctx.moveTo(a.x - px * o * 1.2, a.y - py * o * 1.2); ctx.lineTo(b.x - px * o * 1.2, b.y - py * o * 1.2); ctx.stroke();
    ctx.globalAlpha /= 0.5;
  }
}

function limb(ctx, l, w, fill, outline, endFill) {
  capsule(ctx, l.a, l.b, w, fill, outline);
  capsule(ctx, l.b, l.c, w * 0.92, fill, outline);
  if (endFill) {
    ctx.fillStyle = outline; ctx.beginPath(); ctx.arc(l.c.x, l.c.y, w * 0.72 + 2, 0, 7); ctx.fill();
    ctx.fillStyle = endFill; ctx.beginPath(); ctx.arc(l.c.x, l.c.y, w * 0.72, 0, 7); ctx.fill();
  }
}

// Draw a fighter. opts: { flash, alpha, slotColor, glow, scale, face, x, y, frame }
export function drawFighter(ctx, f, pose, opts) {
  const o = opts || {};
  let face = o.face != null ? o.face : f.face;
  if (pose.flipNow) face = -face;
  const x = o.x != null ? o.x : f.x, y = o.y != null ? o.y : f.y;
  let sk = skeleton(f, pose, x, y, face, o.scale);
  if (pose.lying) {
    sk = rotateSkeleton(skeleton(f, Object.assign({}, pose, { hipH: 0.95 }), x, y, face, o.scale), face * PI / 2 * -1);
    // drop the body onto the ground
    const dy = y - Math.max(sk.headC.y, sk.hip.y) - 6 * sk.s;
    sk = shiftSk(sk, -face * sk.L.torso * 0.2, dy + sk.L.head * 0.2);
  }
  if (pose.rot) sk = rotateSkeleton(sk, pose.rot * face);
  if (pose.chargeShake) sk = shiftSk(sk, (Math.random() - 0.5) * 3, 0);
  const C = f.c.colors;
  let body = C.body, lim = C.limb, acc = C.accent, skin = C.skin, dark = C.dark;
  if (pose.dim) { body = shade(body, -0.35); lim = shade(lim, -0.35); }
  if (o.flash) { body = lim = acc = skin = '#ffffff'; }
  const out = dark;
  const s = sk.s;
  const w = 9.5 * s, tw = (f.c.id === 'rook' ? 23 : 19) * s;
  ctx.save();
  ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
  if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = 16; }
  // back limbs
  limb(ctx, sk.lB, w, shade(lim, -0.2), out, shade(acc, -0.25));
  limb(ctx, sk.aB, w * 0.9, shade(lim, -0.2), out, shade(skin, -0.2));
  if (f.c.id === 'lyra') drawPonytail(ctx, sk, face, C, out);
  // torso
  capsule(ctx, sk.hip, sk.neck, tw, body, out);
  // belt / chest stripe
  ctx.strokeStyle = acc; ctx.lineWidth = 3 * s; ctx.lineCap = 'butt';
  const mid = { x: lerp(sk.hip.x, sk.neck.x, 0.18), y: lerp(sk.hip.y, sk.neck.y, 0.18) };
  const perp = { x: -(sk.neck.y - sk.hip.y) / sk.L.torso, y: (sk.neck.x - sk.hip.x) / sk.L.torso };
  ctx.beginPath(); ctx.moveTo(mid.x - perp.x * tw * 0.5, mid.y - perp.y * tw * 0.5); ctx.lineTo(mid.x + perp.x * tw * 0.5, mid.y + perp.y * tw * 0.5); ctx.stroke();
  if (f.c.id === 'rook') { // shoulder pads
    for (const sd of [-1, 1]) {
      const p = { x: sk.neck.x + perp.x * tw * 0.45 * sd, y: sk.neck.y + perp.y * tw * 0.45 * sd };
      ctx.fillStyle = out; ctx.beginPath(); ctx.arc(p.x, p.y, 9 * s + 2, 0, 7); ctx.fill();
      ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(p.x, p.y, 9 * s, 0, 7); ctx.fill();
    }
  }
  // head
  drawHead(ctx, f, sk, face, C, out, skin, body, acc, pose, o.frame || 0);
  // front limbs
  limb(ctx, sk.lF, w, lim, out, acc);
  if (f.c.sword) drawSword(ctx, sk, face, pose, o, s);
  limb(ctx, sk.aF, w * 0.9, lim, out, skin);
  ctx.restore();
  return sk;
}

function shiftSk(sk, dx, dy) {
  const M = p => ({ x: p.x + dx, y: p.y + dy });
  const L = l => Object.assign({}, l, { a: M(l.a), b: M(l.b), c: M(l.c) });
  return Object.assign({}, sk, { hip: M(sk.hip), neck: M(sk.neck), headC: M(sk.headC), center: M(sk.center), aF: L(sk.aF), aB: L(sk.aB), lF: L(sk.lF), lB: L(sk.lB) });
}

function drawHead(ctx, f, sk, face, C, out, skin, body, acc, pose, frame) {
  const h = sk.headC, r = sk.L.head, s = sk.s;
  const id = f.c.id;
  ctx.save();
  // accessories behind the head
  if (id === 'ember') {
    ctx.fillStyle = out;
    for (let i = 0; i < 4; i++) {
      const a = -PI / 2 - face * (0.3 + i * 0.42);
      const tip = { x: h.x + Math.cos(a) * r * 2.0, y: h.y + Math.sin(a) * r * 2.0 - 2 };
      ctx.beginPath(); ctx.moveTo(h.x + Math.cos(a - 0.5) * r * 0.9, h.y + Math.sin(a - 0.5) * r * 0.9);
      ctx.lineTo(tip.x, tip.y); ctx.lineTo(h.x + Math.cos(a + 0.5) * r * 0.9, h.y + Math.sin(a + 0.5) * r * 0.9); ctx.closePath();
      ctx.fillStyle = i % 2 ? acc : body; ctx.strokeStyle = out; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    }
  }
  if (id === 'volt') {
    for (const sd of [-1, 1]) {
      const bx = h.x + sd * r * 0.55 - face * 2, by = h.y - r * 0.6;
      ctx.beginPath();
      ctx.moveTo(bx, by); ctx.lineTo(bx + sd * 6 * s, by - 10 * s); ctx.lineTo(bx + sd * 2 * s, by - 10 * s);
      ctx.lineTo(bx + sd * 9 * s, by - 22 * s); ctx.lineTo(bx - sd * 1 * s, by - 9 * s); ctx.lineTo(bx + sd * 3 * s, by - 9 * s); ctx.closePath();
      ctx.fillStyle = acc; ctx.strokeStyle = out; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    }
  }
  if (id === 'rook') {
    for (const sd of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(h.x + sd * r * 0.6, h.y - r * 0.5);
      ctx.quadraticCurveTo(h.x + sd * r * 1.6, h.y - r * 0.8, h.x + sd * r * 1.3, h.y - r * 1.9);
      ctx.quadraticCurveTo(h.x + sd * r * 1.1, h.y - r * 1.0, h.x + sd * r * 0.3, h.y - r * 0.85);
      ctx.closePath(); ctx.fillStyle = acc; ctx.strokeStyle = out; ctx.lineWidth = 2; ctx.fill(); ctx.stroke();
    }
  }
  // head circle
  ctx.fillStyle = out; ctx.beginPath(); ctx.arc(h.x, h.y, r + 2.2, 0, 7); ctx.fill();
  {
    const base = id === 'rook' ? body : skin;
    const g = ctx.createRadialGradient(h.x - r * 0.35, h.y - r * 0.4, r * 0.1, h.x, h.y, r);
    g.addColorStop(0, base === '#ffffff' ? base : shade(base, 0.35)); g.addColorStop(0.65, base); g.addColorStop(1, base === '#ffffff' ? base : shade(base, -0.18));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, 7); ctx.fill();
  }
  if (id === 'ember' || id === 'lyra' || id === 'volt') { // hair cap
    ctx.fillStyle = id === 'lyra' ? C.accent : id === 'volt' ? body : body;
    ctx.beginPath(); ctx.arc(h.x, h.y, r, PI * 1.05, PI * 1.95); ctx.lineTo(h.x + face * r * 0.2, h.y - r * 0.2); ctx.closePath(); ctx.fill();
  }
  // eyes / visor
  const ex = h.x + face * r * 0.38, ey = h.y + r * 0.05;
  if (pose.dizzy) {
    ctx.strokeStyle = C.eye; ctx.lineWidth = 1.6;
    for (const k of [0, 1]) { ctx.beginPath(); ctx.arc(ex - face * k * r * 0.45, ey, r * 0.16, 0, PI * 1.7 + frame * 0.3); ctx.stroke(); }
  } else if (id === 'rook') {
    ctx.fillStyle = C.eye; ctx.fillRect(ex - r * 0.55 - (face < 0 ? r * 0.3 : 0), ey - r * 0.18, r * 0.9, r * 0.3);
  } else {
    ctx.fillStyle = C.eye;
    for (const k of [0, 1]) { ctx.beginPath(); ctx.ellipse(ex - face * k * r * 0.42, ey, r * 0.11, r * 0.22, 0, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

function drawPonytail(ctx, sk, face, C, out) {
  const h = sk.headC, r = sk.L.head;
  ctx.strokeStyle = out; ctx.lineWidth = 9 * sk.s; ctx.lineCap = 'round';
  const p0 = { x: h.x - face * r * 0.7, y: h.y - r * 0.4 };
  const p1 = { x: p0.x - face * r * 1.4, y: p0.y + r * 0.9 };
  ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(p0.x - face * r * 1.4, p0.y - r * 0.3, p1.x, p1.y); ctx.stroke();
  ctx.strokeStyle = C.accent; ctx.lineWidth = 6 * sk.s;
  ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.quadraticCurveTo(p0.x - face * r * 1.4, p0.y - r * 0.3, p1.x, p1.y); ctx.stroke();
}

function swordDir(sk, face) {
  const v = { x: sk.aF.c.x - sk.aF.b.x, y: sk.aF.c.y - sk.aF.b.y };
  const m = Math.hypot(v.x, v.y) || 1;
  const a = -0.22 * face, cs = Math.cos(a), sn = Math.sin(a);
  return { x: (v.x * cs - v.y * sn) / m, y: (v.x * sn + v.y * cs) / m };
}

function drawSword(ctx, sk, face, pose, o, s) {
  const hand = sk.aF.c;
  const d = swordDir(sk, face);
  const len = 52 * s;
  const tip = { x: hand.x + d.x * len, y: hand.y + d.y * len };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1d0b3f'; ctx.lineWidth = 7 * s;
  ctx.beginPath(); ctx.moveTo(hand.x, hand.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.strokeStyle = '#e8f4ff'; ctx.lineWidth = 4 * s; ctx.shadowColor = '#b9a3ff'; ctx.shadowBlur = o.flash ? 0 : 10;
  ctx.beginPath(); ctx.moveTo(hand.x + d.x * 6, hand.y + d.y * 6); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.shadowBlur = 0;
  // guard
  const pp = { x: -d.y * 7 * s, y: d.x * 7 * s };
  ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 3.5 * s;
  ctx.beginPath(); ctx.moveTo(hand.x + d.x * 4 - pp.x, hand.y + d.y * 4 - pp.y); ctx.lineTo(hand.x + d.x * 4 + pp.x, hand.y + d.y * 4 + pp.y); ctx.stroke();
  ctx.restore();
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

// Sword tip / limb end world position, used for swing trails.
export function strikePoint(sk, f) {
  if (f.c.sword) {
    const d = swordDir(sk, f.face);
    return { x: sk.aF.c.x + d.x * 52 * sk.s, y: sk.aF.c.y + d.y * 52 * sk.s };
  }
  return null;
}
