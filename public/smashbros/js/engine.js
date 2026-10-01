// BLAST ZONE match engine. No DOM here, so it can be simulated headless.
import { fighterById, SAKURAI } from './fighters.js';

export const STAGES = {
  final: {
    id: 'final', name: 'Final Zone',
    main: { x1: -380, x2: 380, y: 0, depth: 64 },
    plats: [],
    blast: { l: -1160, r: 1160, t: -1000, b: 720 },
    spawn: [-260, 260, -90, 90],
  },
  ruins: {
    id: 'ruins', name: 'Battle Ruins',
    main: { x1: -340, x2: 340, y: 0, depth: 64 },
    plats: [{ x1: -230, x2: -90, y: -126 }, { x1: 90, x2: 230, y: -126 }, { x1: -70, x2: 70, y: -248 }],
    blast: { l: -1100, r: 1100, t: -1000, b: 720 },
    spawn: [-230, 230, -60, 60],
  },
};

const KB_SCALE = 0.142;      // knockback units -> launch speed
const KB_DECAY = 0.24;       // launch speed lost per frame
const HITSTUN_MUL = 0.4;
const TUMBLE_KB = 80;
const SHIELD_MAX = 50;
const BUFFER = 7;
const LEDGE_HANG_MAX = 330;

let NEXT_ID = 1;

export class Fighter {
  constructor(slot, charId, opts) {
    this.slot = slot;
    this.c = fighterById(charId);
    this.name = opts.name || this.c.name;
    this.cpu = opts.cpu || 0;          // 0 = human, 1..9 = CPU level
    this.team = slot;
    this.stocks = opts.stocks;
    this.percent = 0;
    this.stats = { kos: 0, falls: 0, dealt: 0, taken: 0, sds: 0 };
    this.h = 74 * this.c.size;
    this.r = 15 * this.c.size;
    this.reset(0, -300, 1);
    this.input = blankInput();
    this.prevHeld = {};
    this.buf = { a: -99, b: -99, j: -99, s: -99, g: -99, sm: -99 };
    this.flickF = -99; this.flickDir = 0; this.downTapF = -99; this.upTapF = -99;
    this.prevX = 0; this.prevY = 0;
    this.stale = [];
    this.eliminated = false;
    this.place = 0;
  }
  reset(x, y, face) {
    Object.assign(this, {
      x, y, vx: 0, vy: 0, kbx: 0, kby: 0, face,
      state: 'air', sf: 0, grounded: false, plat: null,
      jumpsLeft: this.c.jumps - 1, ff: false, airdodged: false, sideBUsed: false,
      move: null, hitlag: 0, hitstun: 0, tumble: false, pendingLaunch: null,
      intang: 0, invinc: 0, shield: SHIELD_MAX, stun: 0, dizzy: 0,
      holding: null, heldBy: null, grabTimer: 0,
      ledge: null, ledgeLock: 0, ledgeGrabs: 0,
      dropThrough: 0, lastHitBy: null, lastHitF: -9999, flash: 0, shake: 0,
      armorFlash: 0, landLag: 0, helplessLand: false, techLock: 0, respawnT: 0,
    });
  }
}

function blankInput() {
  return { x: 0, y: 0, cx: 0, cy: 0, held: { a: 0, b: 0, j: 0, s: 0, g: 0, sm: 0 }, press: {} };
}

const sign = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Match {
  constructor(cfg) {
    this.stage = STAGES[cfg.stage] || STAGES.final;
    this.frame = 0;
    this.fighters = cfg.players.map((p, i) => new Fighter(i, p.char, { cpu: p.cpu, stocks: cfg.stocks, name: p.name }));
    this.fighters.forEach((f, i) => {
      const sx = this.stage.spawn[i % this.stage.spawn.length];
      f.reset(sx, this.stage.main.y, sx < 0 ? 1 : -1);
      f.state = 'idle'; f.grounded = true; f.plat = this.stage.main;
      f.jumpsLeft = f.c.jumps - 1;
    });
    this.projectiles = [];
    this.fx = [];          // visual effects for the renderer
    this.sounds = [];      // sound events for the audio layer
    this.shake = 0;
    this.slowmo = 0;
    this.over = false;
    this.overT = 0;
    this.winner = null;
    this.countdown = cfg.countdown === false ? 0 : 180;
    this.ledges = [
      { x: this.stage.main.x1, y: this.stage.main.y, dir: -1, owner: null },
      { x: this.stage.main.x2, y: this.stage.main.y, dir: 1, owner: null },
    ];
    this.eliminations = 0;
  }

  sfx(name, vol) { this.sounds.push({ name, vol: vol == null ? 1 : vol }); }

  // ---------------------------------------------------------------- update
  step(inputs) {
    this.sounds.length = 0;
    if (this.countdown > 0) {
      if (this.countdown % 60 === 0) this.sfx(this.countdown === 60 ? 'count' : 'count');
      this.countdown--;
      if (this.countdown === 0) { this.sfx('go'); this.goFrame = this.frame; }
      this.fighters.forEach((f, i) => this.readInput(f, inputs[i] || blankInput()));
      this.updateFx();
      this.frame++;
      return;
    }
    if (this.over) { this.overT++; this.updateFx(); this.frame++; return; }
    this.fighters.forEach((f, i) => this.readInput(f, inputs[i] || blankInput()));
    for (const f of this.fighters) if (!f.eliminated) this.updateFighter(f);
    this.updateProjectiles();
    this.resolveHits();
    for (const f of this.fighters) if (!f.eliminated) this.checkBlast(f);
    this.updateFx();
    if (this.shake > 0) this.shake *= 0.86;
    if (this.shake < 0.3) this.shake = 0;
    this.frame++;
  }

  readInput(f, inp) {
    const t = this.frame;
    const held = inp.held;
    const press = {};
    for (const k of ['a', 'b', 'j', 's', 'g', 'sm']) {
      press[k] = !!held[k] && !f.prevHeld[k];
      if (press[k]) f.buf[k] = t;
    }
    f.prevHeld = Object.assign({}, held);
    if (Math.abs(inp.x) > 0.75 && Math.abs(f.prevX) < 0.35) { f.flickF = t; f.flickDir = sign(inp.x); }
    if (inp.y > 0.7 && f.prevY < 0.35) f.downTapF = t;
    if (inp.y < -0.7 && f.prevY > -0.35) f.upTapF = t;
    f.prevX = inp.x; f.prevY = inp.y;
    f.input = Object.assign({}, inp, { press });
    // c-stick / smash key act as instant smash or aerial input
    if (Math.abs(inp.cx) > 0.5 || Math.abs(inp.cy) > 0.5) {
      if (!f.cWas) { f.buf.sm = t; f.cdir = { x: Math.abs(inp.cx) > Math.abs(inp.cy) ? sign(inp.cx) : 0, y: Math.abs(inp.cy) >= Math.abs(inp.cx) ? sign(inp.cy) : 0 }; }
      f.cWas = true;
    } else f.cWas = false;
    if (press.sm) f.cdir = null;
  }

  buffered(f, k) { return this.frame - f.buf[k] <= BUFFER; }
  consume(f, k) { f.buf[k] = -99; }

  setState(f, s) { f.state = s; f.sf = 0; }

  // ------------------------------------------------------- fighter update
  updateFighter(f) {
    if (f.flash > 0) f.flash--;
    if (f.armorFlash > 0) f.armorFlash--;
    if (f.hitlag > 0) {
      f.hitlag--;
      if (f.hitlag === 0 && f.pendingLaunch) this.launch(f, f.pendingLaunch);
      return;
    }
    f.sf++;
    if (f.intang > 0) f.intang--;
    if (f.invinc > 0) f.invinc--;
    if (f.ledgeLock > 0) f.ledgeLock--;
    if (f.dropThrough > 0) f.dropThrough--;
    if (f.techLock > 0) f.techLock--;
    const c = f.c, inp = f.input;
    const st = f.state;

    if (st !== 'shield' && st !== 'shieldstun' && f.shield < SHIELD_MAX) f.shield = Math.min(SHIELD_MAX, f.shield + 0.075);

    switch (st) {
      case 'dead': this.updateDead(f); return;
      case 'respawn': this.updateRespawn(f); return;
      case 'ledge': this.updateLedge(f); return;
      case 'ledgeclimb': case 'ledgeroll': this.updateLedgeGetup(f); return;
      case 'grabbed': return; // positioned by the holder
      case 'throw': break;
      case 'holding': this.updateHolding(f); break;
      case 'attack': this.updateMove(f); break;
      case 'hitstun': this.updateHitstun(f); break;
      case 'knockdown': this.updateKnockdown(f); break;
      case 'getup': if (f.sf >= 30) this.setState(f, 'idle'); break;
      case 'tech': if (f.sf >= (f.techDir ? 40 : 26)) this.setState(f, 'idle'); else if (f.techDir && f.sf < 30) f.vx = f.techDir * 5.2; break;
      case 'shieldbreak': if (f.grounded && f.sf > 10) { this.setState(f, 'dizzy'); f.dizzy = Math.round(220 + f.percent * 0.8); } break;
      case 'dizzy': if (--f.dizzy <= 0) { this.setState(f, 'idle'); f.shield = SHIELD_MAX * 0.375; }
        if (inp.press.a || inp.press.b || inp.press.j || Math.abs(inp.x - f.prevMashX || 0) > 0.6) f.dizzy -= 3; f.prevMashX = inp.x; break;
      case 'shield': this.updateShield(f); break;
      case 'shieldstun': if (--f.stun <= 0) this.setState(f, 'shield'); break;
      case 'shielddrop': if (f.sf >= 8) this.setState(f, 'idle'); else this.groundActionable(f, true); break;
      case 'spotdodge': f.intang = f.sf >= 2 && f.sf < 18 ? 2 : f.intang; if (f.sf >= 27) this.setState(f, 'idle'); break;
      case 'roll': f.intang = f.sf >= 3 && f.sf < 16 ? 2 : f.intang; f.vx = f.sf < 22 ? f.rollDir * 6.2 : 0; if (f.sf >= 31) { f.face = -f.rollDir; this.setState(f, 'idle'); } break;
      case 'airdodge': this.updateAirdodge(f); break;
      case 'jumpsquat': this.updateJumpsquat(f); break;
      case 'land': if (f.sf >= f.landLag) this.setState(f, 'idle'); break;
      case 'helpless': this.airDrift(f, 0.7); if (this.tryLedge(f)) return; break;
      case 'air': this.updateAir(f); break;
      default: this.updateGround(f); break;
    }

    this.physics(f);
  }

  // ---------------------------------------------------------- ground states
  groundActionable(f, fromShieldDrop) {
    const inp = f.input;
    // specials
    if (this.buffered(f, 'b')) { this.consume(f, 'b'); return this.doSpecial(f); }
    // grab
    if (this.buffered(f, 'g') || (this.buffered(f, 'a') && inp.held.s)) {
      this.consume(f, 'g'); this.consume(f, 'a');
      return this.startMove(f, (f.state === 'dash' || f.state === 'run') ? 'dashgrab' : 'grab');
    }
    // jumping
    const tapJump = this.frame - f.upTapF <= 2 && f.state !== 'crouch';
    if (this.buffered(f, 'j') || tapJump) { this.consume(f, 'j'); f.upTapF = -99; this.setState(f, 'jumpsquat'); f.jumpHeld = true; return true; }
    // attacks
    const smash = this.buffered(f, 'sm') || (this.buffered(f, 'a') && this.frame - f.flickF <= 3 && ((f.state !== 'dash' || f.sf <= 3) && f.state !== 'run'));
    if (smash) {
      this.consume(f, 'sm'); this.consume(f, 'a');
      const d = f.cdir || { x: Math.abs(inp.x) > 0.4 ? sign(inp.x) : 0, y: Math.abs(inp.y) > 0.5 ? sign(inp.y) : 0 };
      if (d.y < 0) return this.startMove(f, 'usmash');
      if (d.y > 0) return this.startMove(f, 'dsmash');
      if (d.x) f.face = d.x;
      return this.startMove(f, 'fsmash');
    }
    if (this.buffered(f, 'a')) {
      this.consume(f, 'a');
      if (f.state === 'dash' || f.state === 'run') return this.startMove(f, 'dashatk');
      if (inp.y < -0.5) return this.startMove(f, 'utilt');
      if (inp.y > 0.5) return this.startMove(f, 'dtilt');
      if (Math.abs(inp.x) > 0.5) { f.face = sign(inp.x); return this.startMove(f, 'ftilt'); }
      return this.startMove(f, 'jab1');
    }
    // shield
    if (inp.held.s && !fromShieldDrop) { this.setState(f, 'shield'); f.vx *= 0.5; this.sfx('shieldup', 0.4); return true; }
    return false;
  }

  updateGround(f) {
    const c = f.c, inp = f.input;
    if (this.groundActionable(f)) return;
    const ax = inp.x;
    const flick = this.frame - f.flickF <= 2;
    switch (f.state) {
      case 'idle': case 'walk': case 'crouch':
        if (inp.y > 0.6 && Math.abs(ax) < 0.5) {
          if (f.plat && f.plat !== this.stage.main && this.frame - f.downTapF <= 3) return this.dropThrough(f);
          if (f.state !== 'crouch') this.setState(f, 'crouch');
          f.vx *= 0.7; return;
        }
        if (flick && Math.abs(ax) > 0.7) { f.face = sign(ax); this.setState(f, 'dash'); f.vx = f.face * c.dashv; this.dust(f, 1); this.sfx('dash', 0.25); return; }
        if (Math.abs(ax) > 0.2) {
          if (f.state !== 'walk') this.setState(f, 'walk');
          f.face = sign(ax); f.vx = ax * c.walk * (Math.abs(ax) > 0.75 ? 1.15 : 1);
        } else {
          if (f.state !== 'idle') this.setState(f, 'idle');
          f.vx = approach(f.vx, 0, c.traction);
        }
        break;
      case 'dash':
        if (flick && sign(ax) === -f.face) { f.face = -f.face; f.sf = 0; f.vx = f.face * c.dashv; this.dust(f, 1); return; }
        f.vx = f.face * c.dashv;
        if (f.sf >= 11) {
          if (sign(ax) === f.face) this.setState(f, 'run');
          else { this.setState(f, 'skid'); }
        }
        break;
      case 'run':
        if (sign(ax) === f.face) f.vx = approach(f.vx, f.face * c.run, 0.6);
        else if (sign(ax) === -f.face) { this.setState(f, 'turn'); this.dust(f, 0.6); }
        else this.setState(f, 'skid');
        if (inp.y > 0.6) this.setState(f, 'crouch');
        if (f.sf % 16 === 0) this.dust(f, 0.4);
        break;
      case 'skid':
        f.vx = approach(f.vx, 0, c.traction * 0.9);
        if (f.sf > 10 || Math.abs(f.vx) < 0.4) this.setState(f, 'idle');
        break;
      case 'turn':
        f.vx = approach(f.vx, 0, c.traction * 1.4);
        if (f.sf >= 12) { f.face = -f.face; this.setState(f, Math.abs(ax) > 0.6 ? 'run' : 'idle'); }
        break;
    }
  }

  dropThrough(f) {
    f.dropThrough = 10; f.grounded = false; f.plat = null; f.y += 2; f.vy = 1.5;
    this.setState(f, 'air');
    return true;
  }

  updateJumpsquat(f) {
    const inp = f.input;
    if (!inp.held.j && !(inp.y < -0.6)) f.jumpHeld = false;
    // jump-cancelled up smash / up special, like out of shield
    if (this.buffered(f, 'sm') && (!f.cdir || f.cdir.y < 0)) { this.consume(f, 'sm'); this.consume(f, 'a'); return this.startMove(f, 'usmash'); }
    if (this.buffered(f, 'a') && inp.y < -0.5) { this.consume(f, 'a'); return this.startMove(f, 'utilt'); }
    if (this.buffered(f, 'b') && inp.y < -0.5) { this.consume(f, 'b'); return this.startMove(f, 'upB'); }
    if (f.sf >= 3) {
      const full = f.jumpHeld;
      f.grounded = false; f.plat = null;
      f.vy = -(full ? f.c.jump : f.c.hop);
      f.vx = clamp(f.vx * 0.85 + inp.x * 1.4, -f.c.air * 1.1, f.c.air * 1.1);
      this.setState(f, 'air'); f.airAnim = 'jump';
      this.dust(f, 0.8); this.sfx('jump', 0.35);
    }
  }

  updateShield(f) {
    const inp = f.input;
    f.vx = approach(f.vx, 0, 0.5);
    f.shield -= 0.14;
    if (f.shield <= 0) return this.breakShield(f);
    if (this.buffered(f, 'j') || this.frame - f.upTapF <= 2) { this.consume(f, 'j'); this.setState(f, 'jumpsquat'); f.jumpHeld = true; return; }
    if (this.buffered(f, 'a') || this.buffered(f, 'g')) { this.consume(f, 'a'); this.consume(f, 'g'); return this.startMove(f, 'grab'); }
    if (this.buffered(f, 'b') && inp.y < -0.5) { this.consume(f, 'b'); return this.startMove(f, 'upB'); }
    if (this.frame - f.downTapF <= 2) { this.setState(f, 'spotdodge'); this.sfx('dodge', 0.3); return; }
    if (this.frame - f.flickF <= 2 && Math.abs(inp.x) > 0.7) { f.rollDir = sign(inp.x); this.setState(f, 'roll'); this.sfx('dodge', 0.3); return; }
    if (!inp.held.s) this.setState(f, 'shielddrop');
  }

  breakShield(f) {
    this.setState(f, 'shieldbreak'); f.shield = 0; f.grounded = false; f.plat = null;
    f.vy = -15; f.vx = 0; this.sfx('shieldbreak', 1); this.shake = Math.max(this.shake, 10);
    this.fx.push({ type: 'burst', x: f.x, y: f.y - f.h / 2, t: 0, life: 30, color: '#74e0ff', big: true });
  }

  // ---------------------------------------------------------- air states
  airDrift(f, mul) {
    const c = f.c, ax = f.input.x;
    if (Math.abs(ax) > 0.2) f.vx = approach(f.vx, ax * c.air * (mul || 1), c.airAccel * (mul || 1));
    else f.vx = approach(f.vx, 0, 0.04);
  }

  updateAir(f) {
    const c = f.c, inp = f.input;
    if (this.tryLedge(f)) return;
    this.airDrift(f, 1);
    if (this.frame - f.downTapF <= 2 && f.vy > -2 && !f.ff) { f.ff = true; f.vy = c.ff; this.fx.push({ type: 'ffspark', x: f.x, y: f.y - f.h, t: 0, life: 10 }); }
    // specials
    if (this.buffered(f, 'b')) { this.consume(f, 'b'); if (this.doSpecial(f)) return; }
    // aerials (attack button or c-stick)
    if (this.buffered(f, 'a') || this.buffered(f, 'sm')) {
      const viaC = this.buffered(f, 'sm') && f.cdir;
      this.consume(f, 'a'); this.consume(f, 'sm');
      const dx = viaC ? f.cdir.x : (Math.abs(inp.x) > 0.5 ? sign(inp.x) : 0);
      const dy = viaC ? f.cdir.y : (Math.abs(inp.y) > 0.5 ? sign(inp.y) : 0);
      let name = 'nair';
      if (dy < 0 && Math.abs(inp.y) >= Math.abs(inp.x) * 0.8) name = 'uair';
      else if (dy > 0 && Math.abs(inp.y) >= Math.abs(inp.x) * 0.8) name = 'dair';
      else if (dx === f.face) name = 'fair';
      else if (dx === -f.face) name = 'bair';
      if (viaC) { if (dy < 0) name = 'uair'; else if (dy > 0) name = 'dair'; else if (dx === f.face) name = 'fair'; else if (dx) name = 'bair'; }
      return this.startMove(f, name);
    }
    if (this.buffered(f, 'g')) { this.consume(f, 'g'); return this.startMove(f, 'nair'); }
    // double jump (button or tap-up)
    const tap = this.frame - f.upTapF === 2;
    if ((this.buffered(f, 'j') || tap) && f.jumpsLeft > 0) {
      this.consume(f, 'j'); f.upTapF = -99;
      f.jumpsLeft--; f.ff = false; f.vy = -c.djump; f.vx = inp.x * c.air * 0.95;
      if (Math.abs(inp.x) > 0.3) f.face = sign(inp.x);
      f.airAnim = 'djump'; f.djT = 0; this.sfx('djump', 0.35);
      this.fx.push({ type: 'ring', x: f.x, y: f.y, t: 0, life: 14 });
      return;
    }
    // air dodge
    if (this.buffered(f, 's') && !f.airdodged) {
      this.consume(f, 's');
      f.airdodged = true; this.setState(f, 'airdodge'); f.ff = false;
      const m = Math.hypot(inp.x, inp.y);
      if (m > 0.35) { f.adDir = { x: inp.x / m, y: inp.y / m }; f.vx = f.adDir.x * 9.5; f.vy = f.adDir.y * 9.5; }
      else { f.adDir = null; f.vx *= 0.3; f.vy = Math.min(f.vy, 1); }
      this.sfx('dodge', 0.3);
      return;
    }
    if (f.djT != null) f.djT++;
  }

  updateAirdodge(f) {
    const dir = f.adDir;
    const total = dir ? 36 : 49;
    const iEnd = dir ? 19 : 29;
    if (f.sf >= 3 && f.sf <= iEnd) f.intang = Math.max(f.intang, 1);
    if (dir) {
      if (f.sf < 12) { f.vx = dir.x * 9.5 * (1 - f.sf / 14); f.vy = dir.y * 9.5 * (1 - f.sf / 14); f.noGrav = true; }
      else f.noGrav = false;
    }
    if (this.tryLedge(f, true)) return;
    if (f.sf >= total) { f.noGrav = false; this.setState(f, 'air'); }
  }

  // -------------------------------------------------------------- ledges
  tryLedge(f, any) {
    if (f.ledgeLock > 0 || f.vy < -1 && !(f.state === 'attack' && f.move && f.move.m.ledgeFrom && f.move.f >= f.move.m.ledgeFrom)) return false;
    if (f.state === 'attack' && !(f.move.m.ledgeFrom && f.move.f >= f.move.m.ledgeFrom)) return false;
    for (const L of this.ledges) {
      const hx = L.x + L.dir * 14;
      if (Math.abs(f.x - hx) > 42) continue;
      // fighter must be outside or at the lip of the stage on that side
      if ((f.x - L.x) * L.dir < -14) continue;
      const top = f.y - f.h;
      if (top > L.y + 10 || f.y < L.y + 18 || top < L.y - 70) continue;
      if (L.owner && L.owner !== f) {
        const o = L.owner;
        if (o.state === 'ledge') { o.ledge = null; this.setState(o, 'air'); o.vx = L.dir * 3; o.vy = -3; o.ledgeLock = 40; o.intang = 0; this.sfx('dodge', 0.3); }
      }
      this.grabLedge(f, L);
      return true;
    }
    return false;
  }

  grabLedge(f, L) {
    L.owner = f; f.ledge = L;
    this.setState(f, 'ledge');
    f.face = -L.dir; f.vx = f.vy = f.kbx = f.kby = 0; f.ff = false; f.move = null; f.noGrav = false;
    f.x = L.x + L.dir * 14; f.y = L.y + f.h * 0.86;
    f.jumpsLeft = f.c.jumps - 1; f.airdodged = false; f.sideBUsed = false;
    f.intang = f.ledgeGrabs === 0 ? 64 : Math.max(8, 64 - f.ledgeGrabs * 22);
    f.ledgeGrabs++;
    this.sfx('ledge', 0.5);
  }

  releaseLedge(f) { if (f.ledge && f.ledge.owner === f) f.ledge.owner = null; f.ledge = null; }

  updateLedge(f) {
    const inp = f.input, L = f.ledge;
    f.x = L.x + L.dir * 14; f.y = L.y + f.h * 0.86;
    if (f.sf > LEDGE_HANG_MAX) { this.releaseLedge(f); this.setState(f, 'air'); f.ledgeLock = 40; return; }
    if (f.sf < 8) return;
    const toward = -L.dir;
    if (this.buffered(f, 'j') || this.frame - f.upTapF <= 2) {
      this.consume(f, 'j'); this.releaseLedge(f);
      this.setState(f, 'air'); f.y = L.y - 4; f.x = L.x + L.dir * 2; f.vy = -f.c.jump * 0.92; f.vx = toward * 1.5; f.intang = 3; f.ledgeLock = 20;
      f.airAnim = 'jump'; this.sfx('jump', 0.3); return;
    }
    if (this.buffered(f, 'a') || this.buffered(f, 'b')) {
      this.consume(f, 'a'); this.consume(f, 'b'); this.releaseLedge(f);
      f.x = L.x - L.dir * 26; f.y = L.y; f.grounded = true; f.plat = this.stage.main; f.face = toward;
      return this.startMove(f, 'ledgeatk');
    }
    if (this.buffered(f, 's')) {
      this.consume(f, 's'); this.setState(f, 'ledgeroll'); f.getupDir = toward; return;
    }
    if (inp.y < -0.6 || sign(inp.x) === toward && Math.abs(inp.x) > 0.6) { this.setState(f, 'ledgeclimb'); return; }
    if (inp.y > 0.6 || sign(inp.x) === L.dir && Math.abs(inp.x) > 0.6) {
      this.releaseLedge(f); this.setState(f, 'air'); f.ledgeLock = 30; f.vy = 0; f.intang = 0;
      f.x = L.x + L.dir * 26;
    }
  }

  updateLedgeGetup(f) {
    const L = f.ledge;
    const total = f.state === 'ledgeroll' ? 46 : 34;
    f.intang = f.sf < total - 6 ? 2 : 0;
    const t = Math.min(1, f.sf / (f.state === 'ledgeroll' ? 20 : 22));
    if (f.sf <= 22) {
      f.x = L.x + L.dir * 14 + (-L.dir) * 40 * t;
      f.y = L.y + f.h * 0.86 * (1 - t);
    } else if (f.state === 'ledgeroll') {
      f.x += -L.dir * 5.4;
    }
    if (f.sf >= total) {
      this.releaseLedge(f);
      f.y = L.y; f.grounded = true; f.plat = this.stage.main; f.vx = f.vy = 0;
      this.setState(f, 'idle');
    }
  }

  // ------------------------------------------------------------- moves
  startMove(f, name) {
    const m = f.c.moves[name];
    if (!m) return false;
    if (name === 'sideB' && m.once && !f.grounded) { if (f.sideBUsed) return false; f.sideBUsed = true; }
    f.move = { m, f: 0, id: NEXT_ID++, hit: new Set(), charge: 0, chargeB: 0, air: !f.grounded, zipped: 0, landed: false };
    this.setState(f, 'attack');
    if (m.intang) f.intang = Math.max(f.intang, m.intang[1]);
    if (name === 'upB') { f.ff = false; }
    if (m.counter) f.move.counterOn = true;
    if (!m.special && !m.air && f.grounded && name !== 'dashatk' && name !== 'dashgrab') f.vx *= 0.25;
    return true;
  }

  doSpecial(f) {
    const inp = f.input;
    if (inp.y < -0.5 && Math.abs(inp.y) >= Math.abs(inp.x) * 0.7) return this.startMove(f, 'upB');
    if (inp.y > 0.5 && Math.abs(inp.y) >= Math.abs(inp.x) * 0.7) return this.startMove(f, 'downB');
    if (Math.abs(inp.x) > 0.5) { f.face = sign(inp.x); return this.startMove(f, 'sideB'); }
    return this.startMove(f, 'neutralB');
  }

  updateMove(f) {
    const mi = f.move, m = mi.m, inp = f.input;
    // smash attack charge hold
    if (m.charge && mi.f === m.charge && mi.charge < 60 && (inp.held.a || inp.held.sm || (f.cWas))) {
      mi.charge++; if (mi.charge % 8 === 1) this.fx.push({ type: 'glint', x: f.x, y: f.y - f.h * 0.6, t: 0, life: 10 });
      if (mi.charge === 1) this.sfx('charge', 0.35);
      f.vx = approach(f.vx, 0, 0.6);
      return;
    }
    if (m.chargeB && mi.f === m.chargeB.at && mi.chargeB < m.chargeB.max && inp.held.b) {
      mi.chargeB++; if (mi.chargeB % 10 === 1) this.fx.push({ type: 'glint', x: f.x, y: f.y - f.h * 0.6, t: 0, life: 10 });
      if (!f.grounded) { f.vy = Math.min(f.vy, 2); this.airDrift(f, 0.4); }
      return;
    }
    // Rook's down special plunges in the air until it lands
    if (m.quake && mi.air && mi.f === 14 && !f.grounded) {
      f.vy = 17; f.vx *= 0.9;
      mi.plunging = true;
      return;
    }
    mi.f++;
    const t = mi.f;
    if (m.vel) for (const v of m.vel) if (v.f === t) {
      if (v.mode === 'setAir') { if (!f.grounded && v.vy != null) f.vy = v.vy; }
      else { if (v.vx != null) f.vx = v.vx * f.face; if (v.vy != null) { f.vy = v.vy; f.grounded = false; f.plat = null; } }
      if (v.steer) mi.steer = v.steer;
    }
    if (mi.steer) { f.vx = approach(f.vx, inp.x * mi.steer, 0.6); if (Math.abs(inp.x) > 0.5 && t < 8) f.face = sign(inp.x); }
    if (m.floaty && !f.grounded) { f.vy = Math.min(f.vy, 2.2); this.airDrift(f, 0.8); }
    if (m.zip) this.zip(f, mi, m.zip);
    if (m.proj && t === m.proj.at) this.spawnProjectile(f, m.proj.kind, mi.chargeB);
    if (m.armor) f.armored = t >= m.armor[0] && t <= m.armor[1];
    else f.armored = false;
    if (m.counter) mi.counterOn = t >= m.counter[0] && t <= m.counter[1] && !mi.countered;
    // jab chain
    if (m.jab && t >= m.jab.from && t <= m.jab.to && this.buffered(f, 'a') && f.grounded) {
      this.consume(f, 'a'); return this.startMove(f, m.jab.next);
    }
    // aerials drift; grounded moves slow down
    if (m.air || (!f.grounded && !mi.steer && !m.zip)) this.airDrift(f, m.air ? 1 : 0.5);
    else if (f.grounded && !m.vel && !m.special) f.vx = approach(f.vx, 0, f.c.traction * 0.8);
    if (m.air && this.frame - f.downTapF <= 2 && f.vy > -2 && !f.ff) { f.ff = true; f.vy = f.c.ff; }
    if (m.ledgeFrom && t >= m.ledgeFrom && !f.grounded && this.tryLedge(f, true)) return;
    if (t >= m.total + (mi.countered ? 10 : 0)) this.endMove(f);
  }

  endMove(f) {
    const m = f.move.m;
    f.armored = false;
    const wasGrab = m.grab && f.holding;
    f.move = null;
    if (wasGrab) { this.setState(f, 'holding'); return; }
    if (f.grounded) this.setState(f, 'idle');
    else if (m.helpless) { this.setState(f, 'helpless'); f.helplessLand = true; }
    else this.setState(f, 'air');
  }

  zip(f, mi, z) {
    const t = mi.f, inp = f.input;
    const dirFrom = () => {
      const m = Math.hypot(inp.x, inp.y);
      return m > 0.3 ? { x: inp.x / m, y: inp.y / m } : { x: 0, y: -1 };
    };
    if (t === z.first) { mi.zdir = dirFrom(); f.intang = Math.max(f.intang, z.len); this.sfx('zip', 0.6); }
    if (t === z.second) {
      const d = dirFrom();
      const dot = d.x * mi.zdir.x + d.y * mi.zdir.y;
      if (dot < 0.8) { mi.zdir = d; mi.zip2 = true; f.intang = Math.max(f.intang, z.len); this.sfx('zip', 0.5); }
      else mi.zdir = null;
    }
    const inZip = (t >= z.first && t < z.first + z.len) || (mi.zip2 && t >= z.second && t < z.second + z.len);
    if (inZip && mi.zdir) {
      f.vx = mi.zdir.x * z.speed; f.vy = mi.zdir.y * z.speed; f.noGrav = true;
      if (Math.abs(mi.zdir.x) > 0.2) f.face = sign(mi.zdir.x);
      if (mi.zdir.y < -0.2) { f.grounded = false; f.plat = null; }
      this.fx.push({ type: 'afterimage', x: f.x, y: f.y, face: f.face, t: 0, life: 12, f });
    } else if (f.noGrav) { f.noGrav = false; f.vx *= 0.25; f.vy *= 0.25; }
  }

  // ------------------------------------------------------------- grabs
  updateHolding(f) {
    const v = f.holding;
    if (!v || v.state !== 'grabbed') { f.holding = null; this.setState(f, 'idle'); return; }
    v.x = f.x + f.face * 30 * f.c.size; v.y = f.y; v.face = -f.face;
    f.grabTimer--;
    const vin = v.input;
    if (vin.press.a || vin.press.b || vin.press.j || vin.press.s || this.frame - v.flickF === 0) f.grabTimer -= 4;
    if (f.grabTimer <= 0) return this.grabRelease(f, v);
    if (f.throwing) return;
    const inp = f.input;
    const d = f.cdir && this.buffered(f, 'sm') ? f.cdir : null;
    const dx = d ? d.x : (Math.abs(inp.x) > 0.6 ? sign(inp.x) : 0);
    const dy = d ? d.y : (Math.abs(inp.y) > 0.6 ? sign(inp.y) : 0);
    if (f.sf > 6 && (dx || dy)) {
      this.consume(f, 'sm');
      const name = dy < 0 ? 'uthrow' : dy > 0 ? 'dthrow' : dx === f.face ? 'fthrow' : 'bthrow';
      return this.doThrow(f, v, name);
    }
    if (this.buffered(f, 'a') && !f.pummelT) {
      this.consume(f, 'a'); f.pummelT = f.c.moves.pummel.total;
    }
    if (f.pummelT) {
      f.pummelT--;
      if (f.pummelT === f.c.moves.pummel.total - 6) {
        const dmg = f.c.moves.pummel.dmg;
        v.percent += dmg; f.stats.dealt += dmg; v.stats.taken += dmg; v.flash = 6;
        f.hitlag = v.hitlag = 3; this.sfx('hit1', 0.4);
        this.fx.push({ type: 'spark', x: v.x, y: v.y - v.h * 0.6, t: 0, life: 10, power: 0.3 });
      }
    }
  }

  doThrow(f, v, name) {
    const m = f.c.moves[name];
    f.throwing = { m, t: 0, name };
    f.move = { m: Object.assign({ anim: m.anim }, m), f: 0, id: NEXT_ID++, hit: new Set(), throwV: v };
    this.setState(f, 'throw');
    this.sfx('throw', 0.4);
  }

  updateThrowState(f) {
    const mi = f.move, v = mi.throwV, m = mi.m;
    mi.f++;
    if (v && v.state === 'grabbed') {
      // victim follows the throw arc
      const k = Math.min(1, mi.f / m.release);
      const ang = m.name === 'bthrow' ? Math.PI * k : m.name === 'uthrow' ? Math.PI * 0.5 * k : 0;
      v.x = f.x + f.face * 30 * Math.cos(ang) * f.c.size;
      v.y = f.y - (m.name === 'uthrow' ? 40 * k : 0) - Math.sin(ang) * 20;
      if (mi.f >= m.release) {
        const dir = m.name === 'bthrow' ? f.face : f.face;
        v.heldBy = null; f.holding = null;
        this.applyHit(f, v, { dmg: m.dmg, ang: m.ang, bkb: m.bkb, kbg: m.kbg, throwDir: dir }, { name: m.name, id: mi.id }, true);
        mi.throwV = null;
      }
    }
    if (mi.f >= m.total) { f.move = null; f.throwing = null; this.setState(f, 'idle'); }
  }

  grabRelease(f, v) {
    f.holding = null; v.heldBy = null; f.throwing = null;
    this.setState(f, 'idle'); f.vx = -f.face * 4;
    this.setState(v, 'air'); v.grounded = false; v.plat = null; v.vy = -6; v.vx = f.face * 4;
  }

  // ----------------------------------------------------------- hitstun etc
  updateHitstun(f) {
    if (f.hitstun > 0) f.hitstun--;
    if (f.hitstun <= 0) {
      if (f.grounded) this.setState(f, 'idle');
      else { this.setState(f, 'air'); f.airAnim = f.tumble ? 'tumble' : 'fall'; }
      return;
    }
    // can't grab ledges in hitstun
  }

  updateKnockdown(f) {
    const inp = f.input;
    f.vx = approach(f.vx, 0, 0.6);
    if (f.sf < 26) return;
    if (this.buffered(f, 'a')) { this.consume(f, 'a'); return this.startMove(f, 'getupatk'); }
    if (Math.abs(inp.x) > 0.6 && (this.frame - f.flickF <= 3 || f.sf > 30)) { f.rollDir = sign(inp.x); this.setState(f, 'roll'); return; }
    if (inp.y < -0.6 || this.buffered(f, 'j') || this.buffered(f, 's') || f.sf > 120) {
      this.consume(f, 'j'); this.setState(f, 'getup'); f.intang = 24;
    }
  }

  // ----------------------------------------------------------- physics
  physics(f) {
    const c = f.c;
    if (f.state === 'throw') { this.updateThrowState(f); }
    if (f.state === 'holding' || f.state === 'grabbed' || f.state === 'throw') { f.vx = approach(f.vx, 0, 0.8); }
    // launch decay
    if (f.kbx || f.kby) {
      const mag = Math.hypot(f.kbx, f.kby);
      const nm = Math.max(0, mag - KB_DECAY);
      if (nm === 0) { f.kbx = f.kby = 0; } else { f.kbx *= nm / mag; f.kby *= nm / mag; }
    }
    if (!f.grounded && !f.noGrav && f.state !== 'ledge') {
      const fall = f.ff ? c.ff : c.fall;
      f.vy = Math.min(fall, f.vy + c.grav * (f.state === 'hitstun' ? 1 : 1));
    }
    const px = f.x, py = f.y;
    f.x += f.vx + f.kbx;
    f.y += f.vy + f.kby;
    this.collide(f, px, py);
  }

  collide(f, px, py) {
    const S = this.stage, M = S.main;
    // walls of the main platform
    const inX = f.x > M.x1 && f.x < M.x2;
    const bodyTop = f.y - f.h;
    if (inX && f.y > M.y + 1 && bodyTop < M.y + M.depth) {
      if (py <= M.y + 1 && f.y >= M.y && !f.grounded) {
        // landing from above handled below
      } else if (px <= M.x1 || px >= M.x2) {
        // came in from the side: push out
        f.x = px <= M.x1 ? M.x1 - 0.5 : M.x2 + 0.5;
        if (f.state === 'hitstun' && Math.abs(f.kbx) > 4) { f.kbx = -f.kbx * 0.5; this.sfx('thud', 0.5); }
        f.vx = 0;
      } else if (py - f.h >= M.y + M.depth - 2) {
        // bonk the underside
        f.y = M.y + M.depth + f.h + 0.5; if (f.vy < 0) f.vy = 0; if (f.kby < 0) f.kby = -f.kby * 0.4;
      } else {
        f.x = (f.x - M.x1 < M.x2 - f.x) ? M.x1 - 0.5 : M.x2 + 0.5; f.vx = 0;
      }
    }
    // landing
    if (!f.grounded) {
      const plats = [M].concat(S.plats);
      for (const P of plats) {
        const soft = P !== M;
        if (soft && (f.dropThrough > 0 || f.input.y > 0.75 && f.state !== 'hitstun' && f.state !== 'attack')) continue;
        if (f.x < P.x1 - 2 || f.x > P.x2 + 2) continue;
        if (py <= P.y + 0.01 && f.y >= P.y && (f.vy + f.kby) >= 0) { this.land(f, P); break; }
      }
    } else if (f.plat) {
      const P = f.plat;
      f.y = P.y;
      f.vy = 0;
      if (f.x < P.x1 || f.x > P.x2) {
        const holdEdge = ['attack', 'shield', 'shieldstun', 'spotdodge', 'roll', 'land', 'jumpsquat', 'holding', 'throw', 'knockdown', 'getup', 'tech', 'dizzy', 'idle', 'skid', 'crouch', 'turn'].includes(f.state)
          && !(f.state === 'attack' && f.move && (f.move.m.name === 'dashatk' || f.move.m.special && f.move.m.vel && Math.abs(f.vx) > 4));
        if (holdEdge && f.kbx === 0) { f.x = clamp(f.x, P.x1, P.x2); f.vx = 0; }
        else { f.grounded = false; f.plat = null; if (f.state !== 'attack' && f.state !== 'hitstun') { this.setState(f, 'air'); f.airAnim = 'fall'; } }
      }
    }
  }

  land(f, P) {
    f.grounded = true; f.plat = P; f.y = P.y; f.ff = false; f.noGrav = false;
    const impact = f.vy + f.kby;
    f.vy = 0;
    f.jumpsLeft = f.c.jumps - 1; f.airdodged = false; f.sideBUsed = false; f.ledgeGrabs = 0;
    if (f.state === 'hitstun') {
      if (f.tumble || impact > 6) {
        const teched = this.frame - f.buf.s <= 20 && f.techLock === 0;
        if (teched) {
          f.kbx = f.kby = 0; this.setState(f, 'tech'); f.intang = 20;
          const ax = f.input.x; f.techDir = Math.abs(ax) > 0.5 ? sign(ax) : 0; f.hitstun = 0;
          this.sfx('tech', 0.5); this.fx.push({ type: 'ring', x: f.x, y: f.y, t: 0, life: 16, color: '#fff' });
          return;
        }
        if (impact > 9 && f.kby > 4) { // ground bounce
          f.grounded = false; f.plat = null; f.kby = -f.kby * 0.7; f.y = P.y - 1;
          this.sfx('thud', 0.6); this.dust(f, 1.2); f.techLock = 30; return;
        }
        f.kbx *= 0.4; f.kby = 0; f.hitstun = 0;
        this.setState(f, 'knockdown'); this.sfx('thud', 0.5); this.dust(f, 1); return;
      }
      f.kby = 0;
      return; // keep sliding in hitstun
    }
    f.kby = 0;
    if (f.state === 'attack' && f.move) {
      const m = f.move.m;
      if (m.air) {
        const first = m.hits && m.hits.length ? m.hits[0].start : 0;
        const lag = (f.move.f < first - 1 || f.move.f > m.total - 6) ? 4 : (m.ll || 6);
        f.move = null; this.setState(f, 'land'); f.landLag = lag; f.vx *= 0.6; this.dust(f, 0.6); return;
      }
      if (m.quake && f.move.plunging) { f.move.plunging = false; f.move.f = 21; this.shake = Math.max(this.shake, 6); return; }
      if (m.helpless) { f.move = null; this.setState(f, 'land'); f.landLag = 22; return; }
      if (m.special && m.vel && f.move.f > 14) { f.move = null; this.setState(f, 'land'); f.landLag = 12; return; }
      f.move.air = false;
      return;
    }
    if (f.state === 'helpless') { this.setState(f, 'land'); f.landLag = 24; this.dust(f, 0.8); return; }
    if (f.state === 'airdodge') { this.setState(f, 'land'); f.landLag = 10; return; }
    if (f.state === 'shieldbreak') return;
    if (f.state === 'air' || f.state === 'jumpsquat') {
      this.setState(f, 'land'); f.landLag = impact > 12 ? 6 : 3; this.dust(f, impact > 12 ? 1 : 0.5);
      if (impact > 12) this.sfx('land', 0.25);
    }
  }

  // ----------------------------------------------------------- projectiles
  spawnProjectile(f, kind, charge) {
    const p = { kind, owner: f, x: f.x + f.face * 30, y: f.y - f.h * 0.55, vx: 0, vy: 0, r: 10, life: 70, t: 0, hit: new Set(), id: NEXT_ID++ };
    if (kind === 'fireball') Object.assign(p, { vx: f.face * 6.6, vy: 2, grav: 0.32, bounce: -6.5, r: 11, dmg: 5, ang: SAKURAI, bkb: 10, kbg: 34, life: 80 });
    if (kind === 'spark') Object.assign(p, { vx: f.face * 6, vy: f.grounded ? 0 : 6, grav: 0.5, crawl: true, r: 12, dmg: 4.5, ang: 70, bkb: 26, kbg: 40, life: 92 });
    if (kind === 'crescent') {
      const k = (charge || 0) / 60;
      Object.assign(p, { vx: f.face * (8 + k * 3), vy: 0, r: 16 + k * 10, dmg: 5 + k * 9, ang: 45, bkb: 22 + k * 30, kbg: 60, life: 28 + k * 22, pierce: false });
    }
    this.projectiles.push(p);
    this.sfx(kind === 'fireball' ? 'fire' : kind === 'spark' ? 'zap' : 'slash', 0.5);
  }

  updateProjectiles() {
    const S = this.stage;
    const plats = [S.main].concat(S.plats);
    for (const p of this.projectiles) {
      p.t++;
      if (p.grav) p.vy = Math.min(10, p.vy + p.grav);
      const py = p.y;
      p.x += p.vx; p.y += p.vy;
      for (const P of plats) {
        if (p.x > P.x1 && p.x < P.x2 && py <= P.y && p.y >= P.y) {
          p.y = P.y;
          if (p.crawl) { p.vy = 0; p.onGround = P; }
          else if (p.bounce) p.vy = p.bounce;
        }
      }
      if (p.onGround && (p.x < p.onGround.x1 || p.x > p.onGround.x2)) p.onGround = null;
      if (p.crawl && p.onGround) { p.y = p.onGround.y - 2; p.vy = 0; }
      if (p.t > p.life || p.y > S.blast.b || Math.abs(p.x) > S.blast.r) p.dead = true;
    }
    this.projectiles = this.projectiles.filter(p => !p.dead);
  }

  // ------------------------------------------------------------- hits
  activeHitboxes(f) {
    const out = [];
    const mi = f.move;
    if (!mi || f.hitlag > 0) return out;
    const m = mi.m;
    if (f.state !== 'attack') return out;
    const t = mi.f;
    let hits = m.hits || [];
    if (mi.countered) hits = mi.extraHits || [];
    if (m.quake && mi.plunging) hits = [{ start: 0, end: 999, x: 0, y: 0, r: 22, dmg: 10, ang: 270, bkb: 30, kbg: 70, g: 9 }];
    for (const h of hits) {
      if (t < h.start || t > h.end) continue;
      let dmg = h.dmg, bkb = h.bkb;
      if (h.chargeDmg && mi.chargeB) { dmg += mi.chargeB * h.chargeDmg; bkb += mi.chargeB * (h.chargeBkb || 0); }
      if (m.charge && mi.charge) dmg *= 1 + 0.4 * mi.charge / 60;
      const box = { x: f.x + h.x * f.face, y: f.y + h.y, r: h.r, column: h.column, h, dmg, bkb, g: h.g || 0, grab: m.grab };
      out.push(box);
    }
    return out;
  }

  hurtOverlap(box, v) {
    const crouch = v.state === 'crouch' ? 0.62 : v.state === 'ledge' ? 1 : 1;
    const top = v.y - v.h * crouch + v.r, bot = v.y - v.r;
    if (box.column) {
      const dx = Math.abs(box.x - v.x);
      if (dx > box.r + v.r) return false;
      const cy1 = box.y - box.column, cy2 = box.y + box.column;
      return bot + v.r > cy1 && top - v.r < cy2;
    }
    const cy = clamp(box.y, top, bot);
    const dx = box.x - v.x, dy = box.y - cy;
    return dx * dx + dy * dy <= (box.r + v.r) * (box.r + v.r);
  }

  canBeHit(v) {
    return !v.eliminated && v.state !== 'dead' && v.state !== 'respawn' && v.intang <= 0 && v.invinc <= 0;
  }

  resolveHits() {
    const hits = [];
    for (const a of this.fighters) {
      if (a.eliminated) continue;
      const boxes = this.activeHitboxes(a);
      if (!boxes.length) continue;
      const mi = a.move;
      for (const v of this.fighters) {
        if (v === a || v.eliminated || !this.canBeHit(v)) continue;
        if (v.state === 'grabbed' && v.heldBy !== a) { /* can still be hit by others */ }
        const seen = new Set();
        for (const b of boxes) {
          const key = v.slot + ':' + b.g;
          if (mi.hit.has(key) || seen.has(b.g)) continue;
          if (!this.hurtOverlap(b, v)) continue;
          seen.add(b.g);
          if (b.grab) {
            if (a.holding || v.state === 'ledge' || v.state === 'grabbed' || v.state === 'holding' || !v.grounded && v.state !== 'shield') continue;
            mi.hit.add(key);
            hits.push({ type: 'grab', a, v });
            break;
          }
          mi.hit.add(key);
          hits.push({ type: 'hit', a, v, b });
        }
      }
    }
    for (const p of this.projectiles) {
      for (const v of this.fighters) {
        if (v === p.owner || v.eliminated || !this.canBeHit(v) || p.hit.has(v.slot)) continue;
        if (!this.hurtOverlap({ x: p.x, y: p.y, r: p.r }, v)) continue;
        p.hit.add(v.slot);
        hits.push({ type: 'proj', p, v });
      }
    }
    for (const h of hits) {
      if (h.type === 'grab') this.applyGrab(h.a, h.v);
      else if (h.type === 'hit') this.applyHit(h.a, h.v, { dmg: h.b.dmg, ang: h.b.h.ang, bkb: h.b.bkb, kbg: h.b.h.kbg, set: h.b.h.set, hx: h.b.x }, { name: h.a.move ? h.a.move.m.name : 'x', id: h.a.move ? h.a.move.id : 0 });
      else if (h.type === 'proj') {
        const p = h.p;
        this.applyHit(p.owner, h.v, { dmg: p.dmg, ang: p.ang, bkb: p.bkb, kbg: p.kbg, hx: p.x, proj: p, throwDir: sign(p.vx) || p.owner.face }, { name: p.kind, id: p.id });
        if (!p.pierce) p.dead = true;
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.dead);
  }

  applyGrab(a, v) {
    if (a.state !== 'attack') return;
    if (v.state === 'attack' && v.move && v.move.m.counter) v.move.counterOn = false;
    a.move = null; a.holding = v; this.setState(a, 'holding'); a.grabTimer = Math.round(90 + v.percent * 0.7); a.pummelT = 0; a.throwing = null;
    if (v.holding) { v.holding.heldBy = null; this.setState(v.holding, 'air'); v.holding = null; }
    v.move = null; v.heldBy = a; this.setState(v, 'grabbed'); v.vx = v.vy = v.kbx = v.kby = 0; v.hitstun = 0; v.armored = false;
    if (v.ledge) this.releaseLedge(v);
    this.sfx('grab', 0.6);
  }

  staleMul(a, name) {
    let n = 0;
    for (const s of a.stale) if (s === name) n++;
    return Math.max(0.55, (n === 0 ? 1.05 : 1) - n * 0.08);
  }

  applyHit(a, v, hb, src, isThrow) {
    // counters
    if (v.state === 'attack' && v.move && v.move.counterOn && !isThrow) {
      const mi = v.move;
      mi.countered = true; mi.counterOn = false;
      const dmg = Math.max(8, hb.dmg * 1.25);
      mi.f = mi.m.counter[1];
      mi.extraHits = [{ start: mi.f + 3, end: mi.f + 8, x: 26, y: -40, r: 34, dmg, ang: SAKURAI, bkb: 60, kbg: 92, g: 7 }];
      v.face = sign(a.x - v.x) || v.face;
      v.intang = 30; a.hitlag = 18; v.hitlag = 8;
      this.sfx('counter', 0.9); this.shake = Math.max(this.shake, 5);
      this.fx.push({ type: 'counterflash', x: v.x, y: v.y - v.h / 2, t: 0, life: 18 });
      if (hb.proj) hb.proj.dead = true;
      return;
    }
    const mult = isThrow || hb.proj ? 1 : this.staleMul(a, src.name);
    const dmg = +(hb.dmg * mult).toFixed(1);
    const dirX = hb.throwDir || (sign(v.x - (hb.hx != null ? a.x : a.x)) || a.face);
    // shields
    if ((v.state === 'shield' || v.state === 'shieldstun') && !isThrow) {
      v.shield -= dmg * 1.0;
      a.hitlag = Math.max(a.hitlag, Math.min(14, Math.floor(dmg * 0.3 + 3)));
      v.hitlag = a.hitlag;
      v.stun = Math.floor(dmg * 0.6 + 2);
      this.setState(v, 'shieldstun');
      v.kbx = dirX * Math.min(6, 1 + dmg * 0.18);
      this.sfx('shieldhit', 0.6);
      this.fx.push({ type: 'shieldspark', x: (a.x + v.x) / 2, y: v.y - v.h / 2, t: 0, life: 12 });
      if (v.shield <= 0) this.breakShield(v);
      return;
    }
    v.percent = Math.min(999, +(v.percent + dmg).toFixed(1));
    a.stats.dealt += dmg; v.stats.taken += dmg;
    if (!isThrow && !hb.proj) { a.stale.push(src.name); if (a.stale.length > 9) a.stale.shift(); }
    v.lastHitBy = a; v.lastHitF = this.frame;
    v.flash = 8;
    // knockback
    let kb;
    if (hb.set) kb = hb.bkb + 8;
    else {
      const p = v.percent, d = dmg, w = v.c.weight;
      kb = (((p / 10 + p * d / 20) * (200 / (w + 100)) * 1.4 + 18) * (hb.kbg / 100)) + hb.bkb;
    }
    // heavy armor absorbs weaker hits
    if (v.armored && kb < 130 && !isThrow) {
      a.hitlag = v.hitlag = Math.min(14, Math.floor(dmg * 0.4 + 4));
      v.armorFlash = 10; this.sfx('armor', 0.6);
      this.fx.push({ type: 'spark', x: v.x, y: v.y - v.h / 2, t: 0, life: 12, power: 0.6 });
      return;
    }
    let ang = hb.ang;
    if (ang === SAKURAI) ang = v.grounded && kb < 60 ? 0 : 38;
    const hl = isThrow ? 0 : Math.min(22, Math.floor(dmg * 0.42 + 4));
    a.hitlag = Math.max(a.hitlag, hl);
    v.hitlag = hl;
    // interrupt the victim
    if (v.holding) { const g = v.holding; v.holding = null; g.heldBy = null; this.setState(g, 'air'); g.vy = -4; }
    if (v.heldBy) { const h = v.heldBy; h.holding = null; if (h.state === 'holding') this.setState(h, 'idle'); v.heldBy = null; }
    if (v.ledge) this.releaseLedge(v);
    v.move = null; v.armored = false;
    this.setState(v, 'hitstun');
    v.pendingLaunch = { kb, ang, dirX };
    if (hl === 0) this.launch(v, v.pendingLaunch);
    // feedback
    const power = Math.min(1, kb / 180);
    this.sfx(kb > 150 ? 'hit3' : kb > 80 ? 'hit2' : 'hit1', 0.5 + power * 0.5);
    this.fx.push({ type: 'spark', x: hb.proj ? hb.proj.x : (v.x + (a.x - v.x) * 0.3), y: v.y - v.h * 0.55, t: 0, life: 14 + Math.round(power * 10), power, color: a.c.colors.accent });
    if (kb > 120) this.shake = Math.max(this.shake, 4 + power * 8);
    if (kb > 150) this.fx.push({ type: 'flash', t: 0, life: 6 });
    a.hitConfirm = 6;
  }

  launch(v, L) {
    v.pendingLaunch = null;
    let a = L.ang * Math.PI / 180;
    // directional influence: perpendicular stick input bends the angle up to 18 degrees
    const inp = v.input;
    const lx = Math.cos(a) * L.dirX, ly = -Math.sin(a);
    const sx = inp.x, sy = inp.y;
    if (Math.hypot(sx, sy) > 0.3 && L.kb > 40) {
      const cross = lx * sy - ly * sx; // perpendicular component
      const turn = clamp(cross, -1, 1) * (18 * Math.PI / 180);
      const ca = Math.atan2(ly, lx) + turn;
      v.kbx = Math.cos(ca); v.kby = Math.sin(ca);
    } else { v.kbx = lx; v.kby = ly; }
    const speed = L.kb * KB_SCALE;
    v.kbx *= speed; v.kby *= speed;
    v.hitstun = Math.floor(L.kb * HITSTUN_MUL);
    v.tumble = L.kb > TUMBLE_KB;
    v.vx = 0; v.vy = 0; v.ff = false;
    if (v.grounded && v.kby >= -0.5 && Math.abs(L.ang % 360) < 5) { v.kby = 0; }
    else if (v.kby < 0 || !v.grounded) { v.grounded = false; v.plat = null; }
    else if (v.grounded && v.kby > 0) { v.kby = -v.kby * 0.8; v.grounded = false; v.plat = null; }
    v.techLock = 0;
    v.launchT = 0;
    if (L.kb > 110) v.smoke = Math.min(90, Math.floor(L.kb * 0.35));
  }

  // ----------------------------------------------------------- blast zones
  checkBlast(f) {
    if (f.state === 'dead' || f.state === 'respawn') return;
    const B = this.stage.blast;
    let side = null;
    if (f.x < B.l) side = 'l'; else if (f.x > B.r) side = 'r'; else if (f.y > B.b) side = 'b';
    else if (f.y - f.h < B.t && (f.state === 'hitstun' || f.tumble)) side = 't';
    if (!side) return;
    this.ko(f, side);
  }

  ko(f, side) {
    const B = this.stage.blast;
    const killer = f.lastHitBy && this.frame - f.lastHitF < 360 ? f.lastHitBy : null;
    f.stocks--; f.stats.falls++;
    if (killer && killer !== f) killer.stats.kos++; else f.stats.sds++;
    if (f.holding) { f.holding.heldBy = null; this.setState(f.holding, 'air'); f.holding = null; }
    if (f.heldBy) { f.heldBy.holding = null; f.heldBy = null; }
    if (f.ledge) this.releaseLedge(f);
    const x = clamp(f.x, B.l, B.r), y = clamp(f.y - f.h / 2, B.t, B.b);
    this.fx.push({ type: 'ko', x, y, side, t: 0, life: 70, color: f.c.colors.body });
    this.shake = Math.max(this.shake, 14);
    this.sfx('ko', 1);
    f.move = null; f.kbx = f.kby = f.vx = f.vy = 0; f.hitstun = 0;
    this.setState(f, 'dead');
    f.x = 0; f.y = -2000;
    const alive = this.fighters.filter(o => o.stocks > 0);
    if (f.stocks <= 0) {
      f.eliminated = true; f.place = alive.length + 1;
      if (alive.length <= 1) {
        this.over = true; this.winner = alive[0] || null; if (this.winner) this.winner.place = 1;
        this.slowmo = 40; this.sfx('game', 1);
      }
    }
  }

  updateDead(f) {
    if (f.sf > 70 && f.stocks > 0) {
      const i = this.fighters.indexOf(f);
      f.reset(this.stage.spawn[i % this.stage.spawn.length] * 0.45, -300, 1);
      f.percent = 0; this.setState(f, 'respawn'); f.invinc = 0; f.respawnT = 0;
    }
  }

  updateRespawn(f) {
    f.respawnT++;
    f.y = -300; f.vx = f.vy = 0; f.grounded = false;
    const inp = f.input;
    const acted = f.respawnT > 40 && (Math.abs(inp.x) > 0.5 || inp.y > 0.5 || inp.press.j || inp.press.a || inp.press.b || inp.press.s);
    if (acted || f.respawnT > 300) {
      this.setState(f, 'air'); f.invinc = 120; f.jumpsLeft = f.c.jumps - 1;
      if (inp.press.j) { f.vy = -f.c.djump * 0.8; f.jumpsLeft--; }
    }
  }

  // ------------------------------------------------------------ effects
  dust(f, size) { this.fx.push({ type: 'dust', x: f.x, y: f.y, t: 0, life: 18, size, dir: -f.face }); }

  updateFx() {
    for (const e of this.fx) e.t++;
    for (const f of this.fighters) {
      if (f.smoke > 0 && f.state === 'hitstun') {
        f.smoke--;
        if (this.frame % 2 === 0) this.fx.push({ type: 'smoke', x: f.x, y: f.y - f.h / 2, t: 0, life: 24 });
      } else f.smoke = 0;
    }
    this.fx = this.fx.filter(e => e.t < e.life);
  }
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}
