// Canvas rendering: camera, backgrounds, stages, fighters, effects, HUD.
import { poseFor, drawFighter, shade } from './anim.js';

export const SLOT_COLORS = ['#ff3b4f', '#3b8cff', '#ffc531', '#2fd16f'];
export const SLOT_LABEL = ['P1', 'P2', 'P3', 'P4'];
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';

export function heat(p) {
  const stops = [[0, [255, 255, 255]], [40, [255, 236, 170]], [80, [255, 176, 76]], [120, [255, 92, 42]], [170, [214, 24, 32]], [240, [120, 0, 18]]];
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (p - a) / (b - a);
      return 'rgb(' + ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',') + ')';
    }
  }
  return 'rgb(120,0,18)';
}

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: -160, z: 0.8 };
    this.hud = {};
    this.trails = {};
    this.showHitboxes = false;
    const r = rng(7);
    this.stars = Array.from({ length: 220 }, () => ({ x: r() * 2 - 1, y: r() * 2 - 1, s: r() * 1.6 + 0.3, tw: r() * 6, d: r() * 0.5 + 0.05 }));
    const r2 = rng(11);
    this.clouds = Array.from({ length: 9 }, () => ({ x: r2() * 3000 - 1500, y: r2() * 300 - 500, w: 200 + r2() * 360, d: 0.15 + r2() * 0.35 }));
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    }
    this.dpr = dpr; this.W = w; this.H = h;
  }

  updateCamera(match, snap) {
    const W = this.W || this.cv.clientWidth, H = this.H || this.cv.clientHeight;
    let x1 = 1e9, x2 = -1e9, y1 = 1e9, y2 = -1e9;
    for (const f of match.fighters) {
      if (f.eliminated || f.state === 'dead') continue;
      const fy = f.state === 'respawn' ? -300 : f.y;
      if (Math.abs(f.x) > match.stage.blast.r * 0.9 || fy > match.stage.blast.b * 0.9 || fy < match.stage.blast.t * 0.9) continue;
      x1 = Math.min(x1, f.x - 110); x2 = Math.max(x2, f.x + 110);
      y1 = Math.min(y1, fy - f.h - 90); y2 = Math.max(y2, fy + 50);
    }
    if (x1 > x2) { x1 = -300; x2 = 300; y1 = -260; y2 = 60; }
    // keep a little of the stage in view and never frame tighter than this
    const cx0 = (x1 + x2) / 2 * 0.85, cy0 = (y1 + y2) / 2 * 0.9 - 20;
    const minW = 700, minH = 400;
    const bw = Math.max(minW, x2 - x1), bh = Math.max(minH, y2 - y1);
    const base = Math.min(W / 1180, H / 690);
    let z = Math.min(W / bw, H / bh);
    z = Math.max(base * 0.5, Math.min(base * 1.6, z));
    let tx = cx0, ty = cy0;
    if (match.over && match.winner && match.overT < 150) {
      const w = match.winner;
      tx = w.x; ty = w.y - w.h * 0.6; z = base * 1.55;
    }
    const k = snap ? 1 : (match.over ? 0.12 : 0.08);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    this.cam.z += (z - this.cam.z) * k * 0.8;
  }

  w2s(x, y) { return { x: (x - this.cam.x) * this.cam.z + this.W / 2, y: (y - this.cam.y) * this.cam.z + this.H / 2 }; }

  draw(match, frame) {
    const ctx = this.ctx;
    this.resize();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(match, frame);
    const sh = match.shake;
    const ox = sh ? (Math.random() - 0.5) * sh : 0, oy = sh ? (Math.random() - 0.5) * sh : 0;
    ctx.save();
    ctx.translate(this.W / 2 + ox, this.H / 2 + oy);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x, -this.cam.y);
    this.drawStage(match, frame);
    for (const f of match.fighters) if (f.state === 'respawn') this.drawRespawnPlatform(f, frame);
    for (const p of match.projectiles) this.drawProjectile(p, frame);
    this.drawFxBelow(match, frame);
    for (const f of match.fighters) this.drawTrail(match, f);
    const order = match.fighters.slice().sort((a, b) => (a.state === 'attack') - (b.state === 'attack'));
    for (const f of order) this.drawFighterFull(match, f, frame);
    this.drawFxAbove(match, frame);
    if (this.showHitboxes) this.drawHitboxes(match);
    ctx.restore();
    this.drawKoBeams(match);
    this.drawOffscreen(match, frame);
    this.drawHud(match, frame);
    if (!this.noBanner) this.drawBanners(match, frame);
    for (const e of match.fx) if (e.type === 'flash') { ctx.fillStyle = 'rgba(255,255,255,' + (0.5 * (1 - e.t / e.life)) + ')'; ctx.fillRect(0, 0, this.W, this.H); }
  }

  // ------------------------------------------------------------ background
  drawBackground(match, frame) {
    const ctx = this.ctx, W = this.W, H = this.H;
    const cam = this.cam;
    if (match.stage.id === 'final') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#070917'); g.addColorStop(0.55, '#101538'); g.addColorStop(1, '#22144a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // nebulae
      const neb = (x, y, r, c) => {
        const gx = W / 2 + (x - cam.x * 0.06) * 1, gy = H / 2 + (y - cam.y * 0.06);
        const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      };
      neb(-W * 0.3, -H * 0.2, W * 0.45, 'rgba(155,92,255,0.22)');
      neb(W * 0.35, H * 0.1, W * 0.4, 'rgba(255,90,31,0.13)');
      neb(0, H * 0.45, W * 0.5, 'rgba(116,224,255,0.08)');
      for (const s of this.stars) {
        const x = ((s.x * W * 0.8 - cam.x * s.d * 0.3) % W + W * 1.5) % W;
        const y = ((s.y * H * 0.8 - cam.y * s.d * 0.3) % H + H * 1.5) % H;
        const a = 0.45 + 0.55 * Math.sin(frame * 0.05 + s.tw);
        ctx.fillStyle = 'rgba(232,236,255,' + a.toFixed(2) + ')';
        ctx.fillRect(x, y, s.s, s.s);
      }
      // planet with ring
      const px = W * 0.78 - cam.x * 0.04, py = H * 0.24 - cam.y * 0.04, pr = Math.min(W, H) * 0.12;
      const pg = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
      pg.addColorStop(0, '#ffb48a'); pg.addColorStop(0.6, '#c2456a'); pg.addColorStop(1, '#3b1240');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, pr, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,210,63,0.45)'; ctx.lineWidth = pr * 0.08;
      ctx.beginPath(); ctx.ellipse(px, py, pr * 1.7, pr * 0.38, -0.35, 0, 7); ctx.stroke();
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1a1035'); g.addColorStop(0.5, '#6a2c5e'); g.addColorStop(0.82, '#ff7a3d'); g.addColorStop(1, '#ffc46a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // sun
      const sx = W * 0.5 - cam.x * 0.03, sy = H * 0.72 - cam.y * 0.03;
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.35);
      sg.addColorStop(0, 'rgba(255,240,190,0.95)'); sg.addColorStop(0.15, 'rgba(255,200,120,0.6)'); sg.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
      // distant mountains, two layers
      const ridge = (d, base, amp, col, seed) => {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
        for (let x = 0; x <= W + 20; x += 20) {
          const wx = x + cam.x * d * this.cam.z;
          const y = H * base + Math.sin(wx * 0.004 + seed) * amp + Math.sin(wx * 0.011 + seed * 2) * amp * 0.45 - cam.y * d * 0.3;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
      };
      ridge(0.05, 0.72, 40, 'rgba(60,24,64,0.75)', 1);
      ridge(0.12, 0.82, 30, 'rgba(36,14,42,0.9)', 4);
      for (const c of this.clouds) {
        const x = W / 2 + (c.x - cam.x * c.d) * this.cam.z * 0.5 + (frame * c.d * 0.2) % (W * 2) - W * 0.5;
        const y = H / 2 + (c.y - cam.y * c.d) * this.cam.z * 0.5;
        ctx.fillStyle = 'rgba(255,190,170,0.12)';
        ctx.beginPath(); ctx.ellipse(((x % (W + 600)) + W + 600) % (W + 600) - 300, y, c.w * 0.5, c.w * 0.1, 0, 0, 7); ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------ stages
  drawStage(match, frame) {
    const ctx = this.ctx, S = match.stage, M = S.main;
    if (S.id === 'final') {
      const glow = 0.6 + 0.4 * Math.sin(frame * 0.04);
      // underside
      ctx.beginPath();
      ctx.moveTo(M.x1, M.y); ctx.lineTo(M.x2, M.y); ctx.lineTo(M.x2 - 22, M.y + 34);
      ctx.lineTo(M.x2 - 150, M.y + 150); ctx.lineTo(70, M.y + 250); ctx.lineTo(0, M.y + 300); ctx.lineTo(-70, M.y + 250);
      ctx.lineTo(M.x1 + 150, M.y + 150); ctx.lineTo(M.x1 + 22, M.y + 34); ctx.closePath();
      const g = ctx.createLinearGradient(0, M.y, 0, M.y + 300);
      g.addColorStop(0, '#2a3366'); g.addColorStop(0.5, '#141a3c'); g.addColorStop(1, '#090b1c');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(116,224,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      // circuitry lines
      ctx.strokeStyle = 'rgba(155,92,255,' + (0.35 * glow).toFixed(2) + ')'; ctx.lineWidth = 2;
      for (const sx of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(sx * 300, M.y + 18); ctx.lineTo(sx * 180, M.y + 120); ctx.lineTo(sx * 60, M.y + 170); ctx.lineTo(0, M.y + 250); ctx.stroke();
      }
      // core
      const cg = ctx.createRadialGradient(0, M.y + 175, 0, 0, M.y + 175, 60);
      cg.addColorStop(0, 'rgba(116,224,255,' + (0.9 * glow).toFixed(2) + ')'); cg.addColorStop(1, 'rgba(116,224,255,0)');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, M.y + 175, 60, 0, 7); ctx.fill();
      // top deck
      ctx.fillStyle = '#3a4580'; ctx.fillRect(M.x1, M.y, M.x2 - M.x1, 12);
      const tg = ctx.createLinearGradient(M.x1, 0, M.x2, 0);
      tg.addColorStop(0, 'rgba(116,224,255,0.2)'); tg.addColorStop(0.5, 'rgba(232,248,255,0.95)'); tg.addColorStop(1, 'rgba(116,224,255,0.2)');
      ctx.fillStyle = tg; ctx.fillRect(M.x1, M.y - 1, M.x2 - M.x1, 3);
      ctx.fillStyle = 'rgba(116,224,255,0.9)';
      for (const x of [M.x1, M.x2]) { ctx.beginPath(); ctx.arc(x, M.y + 2, 4, 0, 7); ctx.fill(); }
    } else {
      // stone deck with pillars
      ctx.fillStyle = '#2a1b2e';
      for (const px of [-260, -120, 120, 260]) { ctx.fillRect(px - 22, M.y + 30, 44, 160 - Math.abs(px) * 0.25); }
      ctx.beginPath();
      ctx.moveTo(M.x1, M.y); ctx.lineTo(M.x2, M.y); ctx.lineTo(M.x2 - 26, M.y + 44); ctx.lineTo(M.x2 - 60, M.y + 64);
      ctx.lineTo(M.x1 + 60, M.y + 64); ctx.lineTo(M.x1 + 26, M.y + 44); ctx.closePath();
      const g = ctx.createLinearGradient(0, M.y, 0, M.y + 64);
      g.addColorStop(0, '#7a5a7c'); g.addColorStop(1, '#3a2640');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(30,14,34,0.6)'; ctx.lineWidth = 2;
      for (let x = M.x1 + 40; x < M.x2; x += 56) { ctx.beginPath(); ctx.moveTo(x, M.y + 4); ctx.lineTo(x - 6, M.y + 40); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(M.x1 + 20, M.y + 24); ctx.lineTo(M.x2 - 20, M.y + 24); ctx.stroke();
      ctx.fillStyle = '#c9a3c4'; ctx.fillRect(M.x1, M.y - 2, M.x2 - M.x1, 5);
      for (const P of S.plats) {
        ctx.fillStyle = 'rgba(255,214,170,0.18)'; ctx.fillRect(P.x1, P.y, P.x2 - P.x1, 12);
        ctx.fillStyle = '#ffe2b8'; ctx.fillRect(P.x1, P.y - 1, P.x2 - P.x1, 4);
        ctx.fillStyle = 'rgba(255,226,184,0.35)';
        for (const x of [P.x1, P.x2]) { ctx.fillRect(x - 2, P.y - 1, 4, 14); }
      }
    }
  }

  drawRespawnPlatform(f, frame) {
    const ctx = this.ctx, y = -300;
    const g = ctx.createRadialGradient(f.x, y + 4, 2, f.x, y + 4, 60);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(116,224,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(f.x, y + 4, 60, 14, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = SLOT_COLORS[f.slot]; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(f.x, y + 4, 44 + Math.sin(frame * 0.2) * 3, 9, 0, 0, 7); ctx.stroke();
  }

  // ------------------------------------------------------------ fighters
  drawFighterFull(match, f, frame) {
    if (f.eliminated || f.state === 'dead') return;
    const ctx = this.ctx;
    const pose = poseFor(f, frame);
    let x = f.x, y = f.state === 'respawn' ? -300 : f.y;
    if (f.hitlag > 0 && f.flash > 0) { x += (Math.random() - 0.5) * 5; y += (Math.random() - 0.5) * 3; }
    // shadow on the ground
    const groundY = this.groundBelow(match, x, y);
    if (groundY != null && groundY - y < 300) {
      const k = 1 - (groundY - y) / 300;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.32 * k).toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(x, groundY + 1, 24 * f.c.size * (0.5 + 0.5 * k), 5, 0, 0, 7); ctx.fill();
    }
    let alpha = 1, glow = null;
    if (f.intang > 0 && f.state !== 'attack' && f.state !== 'ledge') { alpha = 0.55; glow = 'rgba(255,255,255,0.9)'; }
    if (f.state === 'ledge' && f.intang > 0) glow = 'rgba(255,255,255,0.7)';
    if (f.invinc > 0) { glow = frame % 8 < 4 ? '#ffffff' : SLOT_COLORS[f.slot]; }
    if (f.armorFlash > 0 || (f.armored && frame % 6 < 3)) glow = '#ffd23f';
    if (f.move && f.move.charge && f.move.f === f.move.m.charge) glow = frame % 6 < 3 ? '#ffffff' : '#ffd23f';
    const flash = f.flash > 0 && f.flash % 3 !== 0;
    drawFighter(ctx, f, pose, { x, y, flash, alpha, glow, frame });
    if (pose.dizzy) this.drawDizzyStars(f, x, y, frame);
    // shield
    if (f.state === 'shield' || f.state === 'shieldstun') {
      const r = (12 + 30 * Math.max(0, f.shield) / 50) * f.c.size;
      const cx = x, cy = y - f.h * 0.5;
      const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
      const c = SLOT_COLORS[f.slot];
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.5, hexA(c, 0.35)); g.addColorStop(1, hexA(c, 0.55));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      ctx.strokeStyle = hexA(c, 0.9); ctx.lineWidth = 2; ctx.stroke();
    }
    // player pointer
    const top = y - f.h * (pose.lying ? 0.4 : 1) - 26;
    const c = SLOT_COLORS[f.slot];
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(x - 7, top); ctx.lineTo(x + 7, top); ctx.lineTo(x, top + 9); ctx.closePath(); ctx.fill();
    ctx.font = 'italic 800 15px ' + DISPLAY; ctx.textAlign = 'center';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,10,24,0.85)';
    const label = f.cpu ? 'CPU' : SLOT_LABEL[f.slot];
    ctx.strokeText(label, x, top - 3); ctx.fillText(label, x, top - 3);
  }

  drawDizzyStars(f, x, y, frame) {
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const a = frame * 0.12 + i * 2.1;
      const sx = x + Math.cos(a) * 20, sy = y - f.h - 6 + Math.sin(a) * 6;
      star(ctx, sx, sy, 6, '#ffd23f');
    }
  }

  groundBelow(match, x, y) {
    const S = match.stage;
    let best = null;
    for (const P of [S.main].concat(S.plats)) {
      if (x >= P.x1 && x <= P.x2 && P.y >= y - 1 && (best == null || P.y < best)) best = P.y;
    }
    return best;
  }

  drawTrail(match, f) {
    const key = f.slot;
    const tr = this.trails[key] || (this.trails[key] = []);
    const boxes = (f.state === 'attack' && !f.eliminated) ? match.activeHitboxes(f).filter(b => !b.grab) : [];
    if (f.hitlag === 0) {
      if (boxes.length) {
        const b = boxes[0];
        tr.push({ x: b.x, y: b.y, r: b.r });
        if (tr.length > 6) tr.shift();
      } else if (tr.length) tr.shift();
    }
    if (tr.length < 2) return;
    const ctx = this.ctx;
    const col = f.c.sword ? '#e8e4ff' : f.c.colors.accent;
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i];
      ctx.strokeStyle = hexA(col, 0.12 + 0.5 * i / tr.length);
      ctx.lineWidth = Math.max(4, b.r * 1.1 * i / tr.length);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  drawHitboxes(match) {
    const ctx = this.ctx;
    for (const f of match.fighters) {
      if (f.eliminated || f.state === 'dead') continue;
      ctx.strokeStyle = 'rgba(255,230,0,0.8)'; ctx.lineWidth = 1.5;
      const top = f.y - f.h + f.r, bot = f.y - f.r;
      ctx.beginPath(); ctx.arc(f.x, top, f.r, Math.PI, 0); ctx.lineTo(f.x + f.r, bot); ctx.arc(f.x, bot, f.r, 0, Math.PI); ctx.closePath(); ctx.stroke();
      for (const b of match.activeHitboxes(f)) {
        ctx.fillStyle = b.grab ? 'rgba(160,80,255,0.4)' : 'rgba(255,40,40,0.4)';
        if (b.column) ctx.fillRect(b.x - b.r, b.y - b.column, b.r * 2, b.column * 2);
        else { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill(); }
      }
    }
  }

  // ------------------------------------------------------------ projectiles
  drawProjectile(p, frame) {
    const ctx = this.ctx;
    if (p.kind === 'fireball') {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = hexA(i % 2 ? '#ffd23f' : '#ff5a1f', 0.35 - i * 0.07);
        ctx.beginPath(); ctx.arc(p.x - p.vx * i * 1.2, p.y - p.vy * i * 1.2, p.r * (1 - i * 0.15), 0, 7); ctx.fill();
      }
      const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.r);
      g.addColorStop(0, '#fff7c2'); g.addColorStop(0.5, '#ffb02e'); g.addColorStop(1, '#ff4a12');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    } else if (p.kind === 'spark') {
      ctx.strokeStyle = '#fff6a8'; ctx.lineWidth = 3; ctx.shadowColor = '#74e0ff'; ctx.shadowBlur = 12;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2 + frame * 0.4;
        const rr = p.r * (0.6 + ((i + frame) % 3) * 0.3);
        const x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.45, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
    } else if (p.kind === 'crescent') {
      const d = Math.sign(p.vx) || 1;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(d, 1);
      ctx.shadowColor = '#9b5cff'; ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(232,228,255,0.9)';
      ctx.beginPath(); ctx.arc(-p.r * 0.4, 0, p.r * 1.3, -1.1, 1.1); ctx.arc(-p.r * 0.95, 0, p.r * 1.1, 1.0, -1.0, true); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ effects
  drawFxBelow(match, frame) {
    const ctx = this.ctx;
    for (const e of match.fx) {
      const k = e.t / e.life;
      if (e.type === 'dust') {
        for (let i = 0; i < 3; i++) {
          const x = e.x + e.dir * (6 + i * 9) * (0.3 + k) * e.size, y = e.y - 4 - i * 2 - k * 8;
          ctx.fillStyle = 'rgba(220,214,230,' + (0.45 * (1 - k)).toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(x, y, (5 + i * 2 + k * 10) * e.size, 0, 7); ctx.fill();
        }
      } else if (e.type === 'smoke') {
        ctx.fillStyle = 'rgba(70,64,90,' + (0.5 * (1 - k)).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(e.x, e.y - k * 10, 8 + k * 16, 0, 7); ctx.fill();
      } else if (e.type === 'ring') {
        ctx.strokeStyle = hexA(e.color || '#ffffff', 0.7 * (1 - k)); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(e.x, e.y, 16 + k * 40, 4 + k * 8, 0, 0, 7); ctx.stroke();
      } else if (e.type === 'afterimage' && e.f) {
        ctx.fillStyle = hexA(e.f.c.colors.accent, 0.35 * (1 - k));
        ctx.beginPath(); ctx.ellipse(e.x, e.y - e.f.h / 2, 16, e.f.h / 2, 0, 0, 7); ctx.fill();
      }
    }
  }

  drawFxAbove(match, frame) {
    const ctx = this.ctx;
    for (const e of match.fx) {
      const k = e.t / e.life;
      if (e.type === 'spark') {
        const p = e.power || 0.2;
        const R = (18 + p * 46) * (0.6 + k * 0.6);
        ctx.save(); ctx.translate(e.x, e.y);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        const n = 10;
        for (let i = 0; i <= n * 2; i++) {
          const a = i / (n * 2) * Math.PI * 2 + e.x * 0.01;
          const r = i % 2 ? R * 0.28 : R * (i % 4 ? 0.8 : 1);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = e.color || '#ffd23f';
        ctx.beginPath(); ctx.arc(0, 0, R * 0.32, 0, 7); ctx.fill();
        if (p > 0.6) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, R * 1.3 * k + 10, 0, 7); ctx.stroke(); }
        ctx.restore();
      } else if (e.type === 'shieldspark') {
        ctx.globalAlpha = 1 - k; star(ctx, e.x, e.y, 14 + k * 10, '#bff4ff'); ctx.globalAlpha = 1;
      } else if (e.type === 'glint' || e.type === 'ffspark') {
        ctx.globalAlpha = 1 - k; star(ctx, e.x, e.y, 10 - k * 6, '#ffffff'); ctx.globalAlpha = 1;
      } else if (e.type === 'burst') {
        ctx.strokeStyle = hexA(e.color, 1 - k); ctx.lineWidth = 6 * (1 - k);
        ctx.beginPath(); ctx.arc(e.x, e.y, 20 + k * 90, 0, 7); ctx.stroke();
      } else if (e.type === 'counterflash') {
        ctx.strokeStyle = hexA('#e8e4ff', 1 - k); ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(e.x, e.y, 30 + k * 50, 0, 7); ctx.stroke();
        ctx.font = 'italic 900 26px ' + DISPLAY; ctx.textAlign = 'center';
        ctx.fillStyle = hexA('#ffffff', 1 - k); ctx.fillText('COUNTER', e.x, e.y - 60 - k * 20);
      }
    }
  }

  drawKoBeams(match) {
    const ctx = this.ctx, W = this.W, H = this.H;
    for (const e of match.fx) {
      if (e.type !== 'ko') continue;
      const k = e.t / e.life;
      const p = this.w2s(e.x, e.y);
      const sx = Math.max(0, Math.min(W, p.x)), sy = Math.max(0, Math.min(H, p.y));
      const cx = W / 2, cy = H / 2;
      const ang = Math.atan2(cy - sy, cx - sx);
      const len = Math.hypot(W, H) * (0.4 + 0.6 * Math.min(1, k * 3));
      const wid = 140 * (1 - k) + 20;
      ctx.save();
      ctx.translate(sx, sy); ctx.rotate(ang);
      const g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, hexA('#ffffff', 0.95 * (1 - k)));
      g.addColorStop(0.25, hexA(e.color, 0.8 * (1 - k)));
      g.addColorStop(1, hexA(e.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, -wid * 0.3); ctx.lineTo(len, -wid); ctx.lineTo(len, wid); ctx.lineTo(0, wid * 0.3); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = hexA('#ffffff', 0.9 * (1 - k));
      ctx.beginPath(); ctx.arc(sx, sy, 60 + 160 * k, 0, 7); ctx.fill();
    }
  }

  drawOffscreen(match, frame) {
    const ctx = this.ctx, W = this.W, H = this.H;
    for (const f of match.fighters) {
      if (f.eliminated || f.state === 'dead' || f.state === 'respawn') continue;
      const p = this.w2s(f.x, f.y - f.h / 2);
      const m = 10;
      if (p.x > m && p.x < W - m && p.y > m && p.y < H - 120) continue;
      const bx = Math.max(52, Math.min(W - 52, p.x)), by = Math.max(52, Math.min(H - 170, p.y));
      ctx.save();
      ctx.fillStyle = 'rgba(8,10,28,0.85)'; ctx.strokeStyle = SLOT_COLORS[f.slot]; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(bx, by, 40, 0, 7); ctx.fill(); ctx.stroke();
      const a = Math.atan2(p.y - by, p.x - bx);
      ctx.fillStyle = SLOT_COLORS[f.slot];
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(a) * 54, by + Math.sin(a) * 54); ctx.lineTo(bx + Math.cos(a + 0.35) * 40, by + Math.sin(a + 0.35) * 40); ctx.lineTo(bx + Math.cos(a - 0.35) * 40, by + Math.sin(a - 0.35) * 40); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(bx, by, 37, 0, 7); ctx.clip();
      const pose = poseFor(f, frame);
      drawFighter(ctx, f, pose, { x: bx, y: by + f.h * 0.42 * 0.55, scale: 0.55, frame });
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ HUD
  drawHud(match, frame) {
    const ctx = this.ctx, W = this.W, H = this.H;
    const n = match.fighters.length;
    const sc = Math.max(0.62, Math.min(1.15, W / 1280));
    const pw = 220 * sc, ph = 84 * sc;
    for (let i = 0; i < n; i++) {
      const f = match.fighters[i];
      const st = this.hud[i] || (this.hud[i] = { pct: f.percent, shake: 0 });
      if (f.percent > st.pct) st.shake = Math.min(14, 4 + (f.percent - st.pct) * 0.7);
      st.pct = f.percent;
      if (st.shake > 0) st.shake *= 0.85;
      const cx = W * (i + 1) / (n + 1), by = H - 14 * sc;
      const x0 = cx - pw / 2, y0 = by - ph;
      ctx.save();
      if (f.eliminated) ctx.globalAlpha = 0.45;
      // plate
      ctx.fillStyle = 'rgba(8,10,28,0.78)';
      ctx.beginPath(); ctx.moveTo(x0 + 18 * sc, y0); ctx.lineTo(x0 + pw, y0); ctx.lineTo(x0 + pw - 18 * sc, by); ctx.lineTo(x0, by); ctx.closePath(); ctx.fill();
      ctx.fillStyle = SLOT_COLORS[f.slot];
      ctx.beginPath(); ctx.moveTo(x0 + 18 * sc, y0); ctx.lineTo(x0 + 30 * sc, y0); ctx.lineTo(x0 + 12 * sc, by); ctx.lineTo(x0, by); ctx.closePath(); ctx.fill();
      // portrait
      const px = x0 + 58 * sc, py = y0 + ph * 0.5;
      ctx.save();
      ctx.beginPath(); ctx.arc(px, py, 30 * sc, 0, 7);
      ctx.fillStyle = shade(f.c.colors.body, -0.55); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = SLOT_COLORS[f.slot]; ctx.stroke();
      ctx.clip();
      const pose = poseFor(f.eliminated ? Object.assign({}, f, { state: 'idle' }) : Object.assign({}, f, { state: 'idle', sf: frame }), frame);
      drawFighter(ctx, f, pose, { x: px, y: py + 56 * sc * f.c.size, scale: 0.9 * sc, face: 1, frame });
      ctx.restore();
      // percent
      const sx = st.shake ? (Math.random() - 0.5) * st.shake : 0, sy = st.shake ? (Math.random() - 0.5) * st.shake : 0;
      const pct = Math.floor(f.percent);
      const tx = x0 + pw - 34 * sc + sx, ty = y0 + ph * 0.66 + sy;
      ctx.textAlign = 'right';
      ctx.font = 'italic 900 ' + Math.round(50 * sc) + 'px ' + DISPLAY;
      ctx.lineJoin = 'round'; ctx.lineWidth = 7 * sc; ctx.strokeStyle = '#05060f';
      const label = f.eliminated ? '' : String(pct);
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = heat(f.percent); ctx.fillText(label, tx, ty);
      ctx.font = 'italic 900 ' + Math.round(24 * sc) + 'px ' + DISPLAY;
      if (!f.eliminated) { ctx.strokeText('%', tx + 22 * sc, ty); ctx.fillText('%', tx + 22 * sc, ty); }
      if (f.eliminated) {
        ctx.font = 'italic 900 ' + Math.round(30 * sc) + 'px ' + DISPLAY; ctx.fillStyle = '#c9cbe0';
        ctx.fillText(ordinal(f.place), tx + 14 * sc, ty);
      }
      // name and stocks
      ctx.textAlign = 'left';
      ctx.font = 'italic 800 ' + Math.round(15 * sc) + 'px ' + DISPLAY;
      ctx.fillStyle = '#e9ebff';
      ctx.fillText(f.c.name.toUpperCase() + (f.cpu ? '  CPU ' + f.cpu : '  ' + SLOT_LABEL[f.slot]), x0 + 94 * sc, y0 + 18 * sc);
      for (let s = 0; s < Math.min(f.stocks, 8); s++) {
        const sxp = x0 + 100 * sc + s * 15 * sc, syp = by - 12 * sc;
        ctx.fillStyle = '#05060f'; ctx.beginPath(); ctx.arc(sxp, syp, 6 * sc, 0, 7); ctx.fill();
        ctx.fillStyle = f.c.colors.body; ctx.beginPath(); ctx.arc(sxp, syp, 4.6 * sc, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
  }

  drawBanners(match, frame) {
    const ctx = this.ctx, W = this.W, H = this.H;
    const big = (text, t, color) => {
      const s = Math.min(W, H) / 4.2;
      const pop = t < 8 ? 1.6 - 0.6 * (t / 8) : 1;
      ctx.save();
      ctx.translate(W / 2, H * 0.42); ctx.scale(pop, pop); ctx.rotate(-0.06);
      ctx.font = 'italic 900 ' + Math.round(s) + 'px ' + DISPLAY;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.12; ctx.strokeStyle = '#05060f';
      ctx.strokeText(text, 0, 0);
      const g = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.45);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, -0.4));
      ctx.fillStyle = g; ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    if (match.countdown > 0) {
      const n = Math.ceil(match.countdown / 60);
      const t = 60 - (match.countdown - (n - 1) * 60);
      big(String(n), t, '#ffd23f');
    } else if (match.frame - (match.goFrame || 0) < 50 && match.goFrame) {
      big('GO!', match.frame - match.goFrame, '#ff5a1f');
    }
    if (match.over && match.overT > 10) big('GAME!', match.overT - 10, '#ffd23f');
  }
}

function star(ctx, x, y, r, col) {
  ctx.fillStyle = col; ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
}

function ordinal(n) { return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'); }
