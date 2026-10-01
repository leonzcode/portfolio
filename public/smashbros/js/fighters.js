// Fighter roster and movesets.
// Units: world pixels, y grows downward, frames at 60 per second.
// Hitbox x/y are relative to the fighter's feet, x pointing the way they face.
// Angles follow the platform-fighter convention: 0 = forward, 90 = up,
// 270 = straight down, 361 = the "Sakurai" angle (flat on the ground at low
// knockback, about 38 degrees otherwise).

export const SAKURAI = 361;

function H(start, end, x, y, r, dmg, ang, bkb, kbg, extra) {
  return Object.assign({ start, end, x, y, r, dmg, ang, bkb, kbg, g: 0 }, extra || {});
}

// A generic moveset, tuned like an all-rounder. Each fighter rescales it and
// then replaces what makes them different (specials, a few normals).
function baseMoves() {
  return {
    jab1: { anim: 'jab', total: 16, hits: [H(3, 4, 22, -42, 12, 2.2, 75, 8, 40)], jab: { next: 'jab2', from: 5, to: 15 } },
    jab2: { anim: 'jab2', total: 16, hits: [H(3, 4, 24, -40, 12, 2.0, 75, 8, 40)], jab: { next: 'jab3', from: 5, to: 15 } },
    jab3: { anim: 'jab3', total: 30, hits: [H(5, 7, 28, -38, 15, 4.5, 40, 45, 90)] },
    ftilt: { anim: 'ftilt', total: 28, hits: [H(6, 8, 34, -36, 14, 7.5, SAKURAI, 10, 100), H(6, 8, 16, -38, 11, 7, SAKURAI, 8, 100)] },
    utilt: { anim: 'utilt', total: 30, hits: [H(5, 11, 6, -84, 19, 5.5, 96, 30, 115)] },
    dtilt: { anim: 'dtilt', total: 22, hits: [H(5, 7, 32, -8, 13, 5.5, 78, 40, 55)] },
    dashatk: { anim: 'dashatk', total: 36, hits: [H(6, 9, 22, -36, 18, 9, 60, 70, 55), H(10, 16, 22, -36, 15, 6, 60, 50, 50, { g: 0 })],
      vel: [{ f: 6, vx: 6, mode: 'set' }, { f: 18, vx: 1, mode: 'set' }] },
    fsmash: { anim: 'fsmash', total: 52, charge: 9, hits: [H(15, 17, 40, -40, 18, 17, SAKURAI, 26, 104), H(15, 17, 20, -40, 13, 15, SAKURAI, 22, 100)] },
    usmash: { anim: 'usmash', total: 44, charge: 7, hits: [H(10, 13, 2, -92, 22, 14, 87, 32, 98), H(10, 13, 2, -60, 14, 12, 87, 30, 95)] },
    dsmash: { anim: 'dsmash', total: 46, charge: 4, hits: [H(6, 7, 34, -8, 17, 11, 30, 28, 100), H(13, 14, -34, -8, 17, 13, 30, 30, 100, { g: 1 })] },
    nair: { anim: 'nair', total: 40, ll: 7, air: true, hits: [H(3, 6, 0, -38, 27, 8, SAKURAI, 10, 100), H(7, 24, 0, -38, 24, 5, SAKURAI, 4, 100, { g: 0 })] },
    fair: { anim: 'fair', total: 46, ll: 15, air: true, hits: [H(14, 17, 32, -28, 19, 12.5, 45, 30, 96), H(14, 17, 14, -36, 13, 10, 45, 25, 90)] },
    bair: { anim: 'bair', total: 33, ll: 8, air: true, hits: [H(6, 9, -34, -38, 18, 10.5, SAKURAI, 10, 100)] },
    uair: { anim: 'uair', total: 30, ll: 6, air: true, hits: [H(4, 8, 2, -84, 21, 7, 75, 32, 112)] },
    dair: { anim: 'dair', total: 52, ll: 18, air: true, hits: [H(16, 19, 0, 4, 18, 12, 270, 30, 80), H(16, 19, 0, -20, 14, 10, 290, 25, 70)] },
    getupatk: { anim: 'dsmash', total: 32, intang: [0, 20], hits: [H(18, 20, 32, -10, 18, 7, SAKURAI, 70, 50), H(18, 20, -32, -10, 18, 7, SAKURAI, 70, 50)] },
    ledgeatk: { anim: 'ftilt', total: 50, intang: [0, 24], hits: [H(24, 27, 36, -26, 20, 9, SAKURAI, 80, 40)] },
    grab: { anim: 'grab', total: 32, grab: true, hits: [H(6, 7, 28, -40, 15, 0, 0, 0, 0)] },
    dashgrab: { anim: 'grab', total: 40, grab: true, hits: [H(8, 9, 36, -40, 17, 0, 0, 0, 0)], vel: [{ f: 0, vx: 4, mode: 'set' }, { f: 12, vx: 0, mode: 'set' }] },
    pummel: { anim: 'pummel', total: 18, dmg: 1.3 },
    fthrow: { anim: 'fthrow', total: 26, release: 12, dmg: 8, ang: 45, bkb: 60, kbg: 68 },
    bthrow: { anim: 'bthrow', total: 30, release: 14, dmg: 11, ang: 135, bkb: 60, kbg: 78 },
    uthrow: { anim: 'uthrow', total: 28, release: 12, dmg: 7, ang: 88, bkb: 70, kbg: 60 },
    dthrow: { anim: 'dthrow', total: 30, release: 16, dmg: 5, ang: 72, bkb: 72, kbg: 35 },
  };
}

function scaleMoves(moves, k) {
  const out = {};
  for (const name in moves) {
    const m = JSON.parse(JSON.stringify(moves[name]));
    m.name = name;
    const f = n => Math.max(1, Math.round(n * k.spd));
    m.total = f(m.total);
    if (m.charge) m.charge = f(m.charge);
    if (m.release) m.release = f(m.release);
    if (m.ll) m.ll = Math.max(4, Math.round(m.ll * k.spd));
    if (m.jab) { m.jab.from = f(m.jab.from); m.jab.to = f(m.jab.to); }
    if (m.intang) m.intang = m.intang.map(f);
    if (m.vel) m.vel.forEach(v => { v.f = Math.round(v.f * k.spd); });
    if (m.dmg) m.dmg = +(m.dmg * k.dmg).toFixed(1);
    if (m.hits) m.hits.forEach(h => {
      h.start = f(h.start); h.end = Math.max(h.start, f(h.end));
      h.x *= k.reach; h.y *= k.size; h.r *= k.size;
      h.dmg = +(h.dmg * k.dmg).toFixed(1);
      h.kbg *= k.kbg;
    });
    out[name] = m;
  }
  return out;
}

// --- The roster -----------------------------------------------------------

const EMBER = {
  id: 'ember', name: 'Ember', title: 'The all-rounder',
  colors: { body: '#ff5a1f', limb: '#c63a13', accent: '#ffd23f', skin: '#ffd9b8', dark: '#3a0e05', eye: '#1b0b04' },
  size: 1.0, weight: 98, walk: 2.6, run: 5.6, dashv: 6.2, air: 3.9, airAccel: 0.32, grav: 0.55, fall: 9.4, ff: 14,
  jump: 13.6, hop: 8.6, djump: 13.0, jumps: 2, traction: 0.62,
  k: { spd: 1, dmg: 1, reach: 1, size: 1, kbg: 1 },
  special: {
    neutralB: { anim: 'throwball', total: 46, proj: { at: 15, kind: 'fireball' } },
    sideB: { anim: 'flykick', total: 46, once: true, hits: [H(11, 22, 30, -30, 17, 11, 40, 40, 78)],
      vel: [{ f: 0, vx: 1, mode: 'set' }, { f: 10, vx: 9.5, mode: 'set' }, { f: 10, vy: -3, mode: 'setAir' }, { f: 24, vx: 2, mode: 'set' }] },
    upB: { anim: 'uppercut', total: 34, helpless: true, ledgeFrom: 14,
      vel: [{ f: 3, vy: -14.5, mode: 'set', steer: 2.4 }],
      hits: [H(3, 4, 14, -50, 16, 2, 88, 50, 0, { g: 0, set: true }), H(6, 7, 14, -60, 16, 1.5, 90, 45, 0, { g: 1, set: true }),
        H(9, 10, 14, -66, 16, 1.5, 90, 45, 0, { g: 2, set: true }), H(12, 13, 14, -70, 16, 1.5, 90, 45, 0, { g: 3, set: true }),
        H(15, 17, 14, -78, 18, 5, 70, 62, 62, { g: 4 })] },
    downB: { anim: 'spin', total: 44, floaty: true,
      hits: [H(6, 7, 0, -38, 30, 1.5, 120, 30, 0, { g: 0, set: true }), H(11, 12, 0, -38, 30, 1.5, 120, 30, 0, { g: 1, set: true }),
        H(16, 17, 0, -38, 30, 1.5, 120, 30, 0, { g: 2, set: true }), H(21, 22, 0, -38, 30, 1.5, 120, 30, 0, { g: 3, set: true }),
        H(27, 29, 0, -38, 32, 4.5, 50, 50, 85, { g: 4 })] },
  },
};

const VOLT = {
  id: 'volt', name: 'Volt', title: 'Fast and light',
  colors: { body: '#ffd23f', limb: '#e0a800', accent: '#74e0ff', skin: '#fff3c4', dark: '#3b2b00', eye: '#14213d' },
  size: 0.9, weight: 80, walk: 3.0, run: 7.1, dashv: 7.6, air: 4.4, airAccel: 0.4, grav: 0.62, fall: 10.2, ff: 15.5,
  jump: 13.8, hop: 8.8, djump: 13.4, jumps: 2, traction: 0.7,
  k: { spd: 0.85, dmg: 0.86, reach: 0.9, size: 0.9, kbg: 1 },
  special: {
    neutralB: { anim: 'throwball', total: 40, proj: { at: 12, kind: 'spark' } },
    sideB: { anim: 'headbutt', total: 48, once: true, hits: [H(12, 30, 18, -30, 20, 10, 45, 40, 72)],
      vel: [{ f: 0, vx: 0, mode: 'set' }, { f: 12, vx: 11, mode: 'set' }, { f: 12, vy: -4, mode: 'setAir' }, { f: 30, vx: 2.5, mode: 'set' }] },
    upB: { anim: 'zip', total: 40, helpless: true, ledgeFrom: 10, zip: { first: 10, second: 22, len: 8, speed: 22 },
      hits: [H(10, 12, 0, -30, 18, 2, 80, 40, 30)] },
    downB: { anim: 'thunder', total: 56,
      hits: [H(16, 30, 0, -230, 18, 7, 270, 30, 40, { g: 0, column: 200 }), H(31, 36, 0, -34, 34, 13, 75, 52, 82, { g: 1 })] },
  },
};

const ROOK = {
  id: 'rook', name: 'Rook', title: 'Heavy hitter',
  colors: { body: '#3f9b6b', limb: '#256b47', accent: '#d9e3c2', skin: '#9bd1a8', dark: '#0d2a1b', eye: '#ffe066' },
  size: 1.18, weight: 116, walk: 2.1, run: 4.7, dashv: 5.4, air: 3.4, airAccel: 0.26, grav: 0.62, fall: 10.6, ff: 15.2,
  jump: 13.2, hop: 8.4, djump: 12.2, jumps: 2, traction: 0.55,
  k: { spd: 1.18, dmg: 1.28, reach: 1.15, size: 1.15, kbg: 1 },
  special: {
    neutralB: { anim: 'haymaker', total: 50, chargeB: { at: 10, max: 90 }, armor: [10, 30], once: false,
      hits: [H(18, 22, 36, -44, 22, 10, SAKURAI, 30, 92, { chargeDmg: 0.18, chargeBkb: 0.6 })],
      vel: [{ f: 16, vx: 6, mode: 'set' }, { f: 26, vx: 0, mode: 'set' }] },
    sideB: { anim: 'shoulder', total: 50, once: true, armor: [8, 30], hits: [H(10, 28, 26, -40, 22, 13, 40, 55, 70)],
      vel: [{ f: 0, vx: 0, mode: 'set' }, { f: 8, vx: 7.4, mode: 'set' }, { f: 30, vx: 1, mode: 'set' }] },
    upB: { anim: 'rocket', total: 44, helpless: true, ledgeFrom: 8,
      vel: [{ f: 6, vy: -15.5, mode: 'set', steer: 2.2 }],
      hits: [H(6, 10, 0, -40, 28, 3, 80, 40, 30, { g: 0 }), H(13, 16, 0, -40, 28, 3, 80, 40, 30, { g: 1 }), H(19, 22, 0, -50, 30, 6, 60, 60, 70, { g: 2 })] },
    downB: { anim: 'quake', total: 58, quake: true,
      hits: [H(22, 25, 60, -10, 30, 12, 85, 70, 60), H(22, 25, -60, -10, 30, 12, 85, 70, 60), H(22, 25, 0, -10, 26, 12, 85, 70, 60)] },
  },
};

const LYRA = {
  id: 'lyra', name: 'Lyra', title: 'Swordswoman',
  colors: { body: '#9b5cff', limb: '#6b34c9', accent: '#e8e4ff', skin: '#ffe0cc', dark: '#1d0b3f', eye: '#1d0b3f' },
  size: 1.0, weight: 90, walk: 2.7, run: 6.0, dashv: 6.6, air: 4.0, airAccel: 0.3, grav: 0.53, fall: 9.0, ff: 13.6,
  jump: 13.4, hop: 8.4, djump: 12.8, jumps: 2, traction: 0.6, sword: true,
  k: { spd: 1.05, dmg: 1.05, reach: 1.38, size: 1.05, kbg: 1 },
  special: {
    neutralB: { anim: 'slash', total: 40, chargeB: { at: 8, max: 60 }, proj: { at: 12, kind: 'crescent' } },
    sideB: { anim: 'lunge', total: 46, once: true, hits: [H(12, 20, 54, -36, 16, 13.5, 38, 45, 80), H(12, 20, 26, -36, 14, 11, 38, 40, 78)],
      vel: [{ f: 0, vx: 0, mode: 'set' }, { f: 12, vx: 12, mode: 'set' }, { f: 12, vy: -2, mode: 'setAir' }, { f: 20, vx: 1.5, mode: 'set' }] },
    upB: { anim: 'skyspin', total: 40, helpless: true, ledgeFrom: 10,
      vel: [{ f: 4, vy: -14.2, mode: 'set', steer: 3.0 }],
      hits: [H(4, 6, 0, -50, 30, 3, 85, 50, 0, { g: 0, set: true }), H(9, 11, 0, -55, 30, 3, 85, 50, 0, { g: 1, set: true }),
        H(14, 16, 0, -60, 30, 3, 85, 50, 0, { g: 2, set: true }), H(19, 22, 0, -66, 32, 6, 70, 60, 70, { g: 3 })] },
    downB: { anim: 'counter', total: 56, counter: [5, 26] },
  },
};

export const ROSTER = [EMBER, VOLT, ROOK, LYRA].map(c => {
  const moves = scaleMoves(baseMoves(), c.k);
  for (const name in c.special) {
    const m = JSON.parse(JSON.stringify(c.special[name]));
    m.name = name;
    m.special = true;
    if (m.hits) m.hits.forEach(h => { h.g = h.g || 0; });
    moves[name] = m;
  }
  // Signature normals.
  if (c.id === 'lyra') {
    moves.fsmash.hits[0].dmg = 18; moves.fsmash.hits[0].kbg = 108;
    moves.utilt.anim = 'swordup'; moves.ftilt.anim = 'swordf'; moves.fair.anim = 'swordf'; moves.bair.anim = 'swordb';
    moves.fsmash.anim = 'swordsmash'; moves.dtilt.anim = 'swordlow'; moves.uair.anim = 'swordup'; moves.nair.anim = 'swordspin';
  }
  if (c.id === 'volt') { moves.dair.anim = 'drill'; moves.dair.hits = [H(8, 22, 0, 0, 18, 1.2, 280, 20, 10, { g: 0, set: true }), H(23, 25, 0, -4, 20, 4, SAKURAI, 40, 100, { g: 1 })]; }
  if (c.id === 'rook') { moves.dair.hits[0].dmg = 15; moves.dsmash.hits.forEach(h => { h.ang = 40; }); }
  return Object.assign({}, c, { moves });
});

export function fighterById(id) { return ROSTER.find(c => c.id === id) || ROSTER[0]; }
