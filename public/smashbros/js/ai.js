// CPU players. They press the same virtual buttons a person does.
const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

export class CPU {
  constructor(level) {
    this.level = level;
    this.held = { a: 0, b: 0, j: 0, s: 0, g: 0, sm: 0 };
    this.pulses = {};
    this.stick = { x: 0, y: 0 };
    this.plan = null;
    this.planT = 0;
    this.wait = 0;
    this.shieldT = 0;
    this.ledgeWait = 0;
    this.rand = Math.random;
  }

  pulse(k, len) {
    if (this.held[k] || this.pulses[k] > 0) return;
    this.pulses[k] = len || 2;
  }

  think(match, f) {
    const lv = this.level;
    const out = { x: 0, y: 0, cx: 0, cy: 0, held: { a: 0, b: 0, j: 0, s: 0, g: 0, sm: 0 } };
    // release buttons whose pulse ended (one frame gap so the next press registers)
    for (const k in this.held) {
      if (this.pulses[k] > 0) { this.pulses[k]--; this.held[k] = 1; }
      else this.held[k] = 0;
    }
    this.decide(match, f);
    out.x = this.stick.x; out.y = this.stick.y;
    out.held = Object.assign({}, this.held);
    if (this.shieldT > 0) { this.shieldT--; out.held.s = 1; }
    if (this.holdA > 0) { this.holdA--; out.held.a = 1; out.held.sm = this.holdSm ? 1 : 0; }
    if (this.holdB > 0) { this.holdB--; out.held.b = 1; }
    return out;
  }

  decide(match, f) {
    const lv = this.level, R = this.rand;
    const S = match.stage, M = S.main;
    const st = f.state;
    if (st === 'dead') return;
    if (st === 'respawn') { this.stick = { x: f.respawnT > 50 + (10 - lv) * 6 ? sign(-f.x) || 1 : 0, y: 0 }; return; }

    // DI and tech while being launched
    if (f.hitlag > 0 || st === 'hitstun') {
      if (lv >= 4) this.stick = { x: sign(-f.x) || 1, y: f.y > -100 ? -0.6 : 0.4 };
      else this.stick = { x: 0, y: 0 };
      if (st === 'hitstun' && lv >= 5 && f.tumble && f.y > -60 && f.vy + f.kby > 0 && R() < lv * 0.02) this.pulse('s', 2);
      return;
    }
    if (st === 'grabbed') { if (R() < lv * 0.06) this.pulse(['a', 'b', 'j'][Math.floor(R() * 3)], 1); this.stick = { x: R() < 0.5 ? -1 : 1, y: 0 }; return; }
    if (st === 'knockdown') { if (R() < 0.04 + lv * 0.01) { const r = R(); if (r < 0.4) this.stick = { x: 0, y: -1 }; else if (r < 0.7) this.pulse('a', 2); else this.stick = { x: sign(-f.x) || 1, y: 0 }; } return; }
    if (st === 'dizzy') { this.stick.x = R() < 0.5 ? -1 : 1; if (R() < 0.3) this.pulse('a', 1); return; }

    const target = this.pickTarget(match, f);

    // ---- ledge
    if (st === 'ledge') {
      this.stick = { x: 0, y: 0 };
      if (this.ledgeWait <= 0) this.ledgeWait = 6 + Math.floor(R() * (34 - lv * 2));
      if (--this.ledgeWait <= 0) {
        const r = R(), toward = -f.ledge.dir;
        if (r < 0.5) this.stick = { x: toward, y: 0 };
        else if (r < 0.7) this.pulse('j', 2);
        else if (r < 0.85) this.pulse('s', 2);
        else this.pulse('a', 2);
      }
      return;
    }

    // ---- recovery
    const offstage = f.x < M.x1 - 6 || f.x > M.x2 + 6 || (f.y > M.y + 4 && !f.grounded);
    if (offstage && !f.grounded) return this.recover(match, f);

    // ---- holding someone
    if (st === 'holding') {
      if (f.sf === 4) {
        const r = R(); const toward = sign(-f.x) || f.face;
        const v = f.holding;
        if (v && v.percent > 100 && lv > 4) this.stick = { x: (Math.abs(f.x) > 180 && sign(f.x) === -f.face) ? -f.face : f.face, y: 0 };
        else if (r < 0.35) this.stick = { x: 0, y: 1 };
        else if (r < 0.6) this.stick = { x: 0, y: -1 };
        else this.stick = { x: R() < 0.5 ? f.face : -f.face, y: 0 };
      } else if (f.sf < 4) { this.stick = { x: 0, y: 0 }; if (R() < 0.3) this.pulse('a', 1); }
      return;
    }

    if (!target) { this.stick = { x: sign(-f.x) * (Math.abs(f.x) > 60 ? 1 : 0), y: 0 }; return; }

    // reaction time: higher levels decide more often
    const react = Math.max(3, 24 - lv * 2.3);
    if (this.wait > 0) { this.wait--; this.guardEdge(match, f); return; }
    this.wait = Math.floor(react * (0.6 + R() * 0.8));

    const dx = target.x - f.x, dy = (target.y - target.h / 2) - (f.y - f.h / 2);
    const adx = Math.abs(dx);
    const reach = 58 * f.c.size * (f.c.sword ? 1.35 : 1);
    const tOff = target.x < M.x1 - 20 || target.x > M.x2 + 20 || target.y > M.y + 30;

    // shielding against an attack that's coming
    if (f.grounded && target.state === 'attack' && target.move && adx < 110 && R() < 0.05 + lv * 0.07) {
      const m = target.move.m, first = m.hits && m.hits[0] ? m.hits[0].start : 0;
      if (target.move.f < first + 2) {
        if (R() < 0.25 && lv > 5) { this.stick = { x: 0, y: 1 }; this.shieldT = 3; return; }
        this.shieldT = 10 + Math.floor(R() * 10); this.stick = { x: 0, y: 0 }; return;
      }
    }
    // punish out of shield
    if (st === 'shield' && target.state === 'attack' && adx < reach + 10 && R() < 0.2 + lv * 0.06) { this.pulse('a', 2); return; }

    // in the air
    if (!f.grounded) {
      this.stick = { x: sign(dx) * (adx > 20 ? 1 : 0), y: 0 };
      if (adx < reach + 25 && Math.abs(dy) < 80 && R() < 0.4 + lv * 0.05) {
        let sx = 0, sy = 0;
        if (dy < -40 && adx < 50) sy = -1;
        else if (dy > 40 && adx < 45) sy = 1;
        else if (sign(dx) === f.face) sx = f.face;
        else if (sign(dx) === -f.face) sx = -f.face;
        this.stick = { x: sx, y: sy };
        this.pulse('a', 2);
      } else if (dy < -90 && f.jumpsLeft > 0 && R() < 0.2) this.pulse('j', 2);
      return;
    }

    // edge-guarding: wait at the edge and hit them as they come back
    if (tOff) {
      const L = target.x < 0 ? M.x1 : M.x2;
      const goal = L - sign(L) * 30;
      if (Math.abs(f.x - goal) > 12) { this.stick = { x: sign(goal - f.x), y: 0 }; return; }
      this.stick = { x: 0, y: 0 };
      f.face = sign(L) || f.face;
      if (adx < 110 && Math.abs(dy) < 90 && R() < 0.3 + lv * 0.05) { this.stick = { x: sign(L), y: 0 }; this.pulse('sm', 2); this.holdA = 0; }
      else if (lv > 6 && target.y > M.y + 40 && adx < 220 && R() < 0.1) this.stick = { x: 0, y: 1 };
      return;
    }

    // projectiles from range
    const hasProj = ['ember', 'volt', 'lyra'].includes(f.c.id);
    if (adx > 240 && hasProj && R() < 0.12 + lv * 0.02) {
      this.stick = { x: 0, y: 0 }; f.face = sign(dx) || f.face; this.pulse('b', 2);
      if (f.c.id === 'lyra') this.holdB = Math.floor(R() * 40);
      return;
    }

    // target above: anti-air
    if (dy < -70 && adx < 70) {
      if (R() < 0.5) { this.stick = { x: 0, y: -1 }; this.pulse(R() < 0.4 ? 'sm' : 'a', 2); }
      else { this.pulse('j', 2); this.stick = { x: sign(dx), y: 0 }; }
      return;
    }

    // close enough to hit
    if (adx < reach && Math.abs(dy) < 60) {
      f.face = sign(dx) || f.face;
      const strong = target.percent > 85 + (9 - lv) * 6;
      const shielding = target.state === 'shield';
      const r = R();
      if (shielding && r < 0.6) { this.stick = { x: 0, y: 0 }; this.pulse('g', 2); return; }
      if (strong && r < 0.45) {
        const s = R();
        this.stick = s < 0.6 ? { x: sign(dx), y: 0 } : s < 0.85 ? { x: 0, y: 1 } : { x: 0, y: -1 };
        this.pulse('sm', 2); this.holdA = Math.floor(R() * 20); this.holdSm = true;
        return;
      }
      if (r < 0.25) { this.stick = { x: 0, y: 0 }; this.pulse('a', 2); }
      else if (r < 0.45) { this.stick = { x: sign(dx), y: 0 }; this.pulse('a', 2); this.wait = 2; }
      else if (r < 0.6) { this.stick = { x: 0, y: 1 }; this.pulse('a', 2); }
      else if (r < 0.72) { this.stick = { x: 0, y: 0 }; this.pulse('g', 2); }
      else if (r < 0.84) { this.pulse('j', 2); this.stick = { x: sign(dx), y: 0 }; }
      else { this.stick = { x: sign(dx), y: 0 }; this.pulse('b', 2); }
      return;
    }

    // approach
    if (adx > reach) {
      this.stick = { x: sign(dx), y: 0 };
      if (adx < reach + 120 && adx > reach + 30 && R() < 0.08 + lv * 0.01) { this.pulse('j', 2); }
      if ((st === 'run' || st === 'dash') && adx < reach + 50 && R() < 0.15) this.pulse('a', 2);
    }
    this.guardEdge(match, f);
  }

  guardEdge(match, f) {
    const M = match.stage.main;
    if (!f.grounded) return;
    const ahead = f.x + this.stick.x * 70;
    if (this.stick.x && (ahead < M.x1 + 10 || ahead > M.x2 - 10)) this.stick.x = 0;
  }

  pickTarget(match, f) {
    let best = null, bd = 1e9;
    for (const o of match.fighters) {
      if (o === f || o.eliminated || o.state === 'dead' || o.state === 'respawn' || o.team === f.team) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  recover(match, f) {
    const R = this.rand, M = match.stage.main;
    const L = f.x < 0 ? { x: M.x1, y: M.y, dir: -1 } : { x: M.x2, y: M.y, dir: 1 };
    const toward = -L.dir;
    const gx = L.x + L.dir * 12, gy = L.y + 20;
    const dx = gx - f.x, dy = gy - f.y;
    const st = f.state;
    this.stick = { x: toward, y: 0 };
    if (st === 'attack') {
      // steer the up special at the ledge
      const m = Math.hypot(dx, dy - 40) || 1;
      this.stick = { x: dx / m, y: (dy - 40) / m };
      return;
    }
    if (st === 'helpless' || st === 'airdodge') return;
    if (st !== 'air') return;
    const below = f.y > L.y - 30;
    if (f.jumpsLeft > 0 && (below || Math.abs(dx) > 260) && f.vy > -3) { this.pulse('j', 2); return; }
    if (!f.sideBUsed && Math.abs(dx) > 300 && f.y < L.y + 60 && f.c.id !== 'rook' && R() < 0.5) {
      this.stick = { x: toward, y: 0 }; this.pulse('b', 2); return;
    }
    const upRange = f.c.id === 'volt' ? 330 : f.c.id === 'rook' ? 200 : 240;
    if (f.jumpsLeft === 0 && f.vy > 0 && (f.y > L.y - 20 || Math.abs(dx) > 160) && Math.hypot(dx, dy) < upRange + 120) {
      const m = Math.hypot(dx, dy - 30) || 1;
      this.stick = f.c.id === 'volt' ? { x: dx / m, y: (dy - 30) / m } : { x: toward * 0.6, y: -1 };
      this.pulse('b', 2);
    }
  }
}
