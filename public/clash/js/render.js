/* Leon Clash: draws a match on one canvas (Canvas 2D). The field is seen from
   above with a slight tilt: the ground is squashed vertically, bodies stand
   upright. Positions are eased between sim ticks so motion is smooth at any
   frame rate. Your side is always at the bottom. */
import { art, drawSprite, rowFor, spriteHeight, envSprite } from "./art.js?v=1";

const K = 0.86;                      // vertical squash of the ground
const BLUE = "#3f8fe6", RED = "#e0533f";
const TEAM = [BLUE, RED];

export function makeRenderer(canvas, sim, opts) {
  opts = opts || {};
  const R = sim.R, W = R.W, H = R.H;
  const ctx = canvas.getContext("2d", { alpha: false });
  let dpr = 1, cw = 0, ch = 0, tile = 20, ox = 0, oy = 0;
  let bg = null;
  let viewSide = 0;
  let reduced = !!opts.reducedMotion;
  const ruins = [];                  // destroyed towers {x, y, lodge, s, t}
  const corpses = [];                // {u, x, y, row, t0, s, air}
  const parts = [];                  // particles
  const rings = [];                  // expanding rings {x, y, r, t0, dur, col}
  const texts = [];                  // floating words {x, y, txt, t0, col}
  const lines = [];                  // short lived lines {x1,y1,x2,y2,t0,dur,col}
  let shake = 0, shakeT = 0;
  let flakes = [];
  let now = 0;
  // a soft shadow drawn once, stamped under every body
  const shadowImg = document.createElement("canvas");
  shadowImg.width = 64; shadowImg.height = 24;
  (function () {
    const g = shadowImg.getContext("2d");
    const rg = g.createRadialGradient(32, 12, 2, 32, 12, 30);
    rg.addColorStop(0, "rgba(20,40,60,0.42)"); rg.addColorStop(0.7, "rgba(20,40,60,0.28)"); rg.addColorStop(1, "rgba(20,40,60,0)");
    g.fillStyle = rg; g.save(); g.scale(1, 0.4); g.beginPath(); g.arc(32, 30, 30, 0, Math.PI * 2); g.fill(); g.restore();
  })();
  // when frames run long, the extras go quiet until they are quick again
  let avgDt = 16, lastT = 0, lowFx = false;

  function setView(side) { viewSide = side; bg = null; }
  function vx(x) { return viewSide ? W - x : x; }
  function vy(y) { return viewSide ? H - y : y; }
  function sx(x) { return ox + vx(x) * tile / 1000; }
  function sy(y) { return oy + vy(y) * tile * K / 1000; }
  function toWorld(px, py) {
    let x = (px - ox) * 1000 / tile, y = (py - oy) * 1000 / (tile * K);
    if (viewSide) { x = W - x; y = H - y; }
    return [Math.round(x), Math.round(y)];
  }

  // padTop: css pixels kept clear for the bar over the field
  function resize(w, h, d, padTop) {
    dpr = d || 1;
    cw = Math.max(1, Math.round(w * dpr)); ch = Math.max(1, Math.round(h * dpr));
    canvas.width = cw; canvas.height = ch;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const pt = Math.round((padTop || 0) * dpr);
    tile = Math.min(cw / 18.3, (ch - pt) / (32 * K + 0.4));
    ox = Math.round((cw - tile * 18) / 2);
    oy = pt + Math.round((ch - pt - tile * 32 * K) / 2);
    bg = null;
    flakes = [];
    const n = reduced ? 0 : 50;
    for (let i = 0; i < n; i++) flakes.push({ x: Math.random() * cw, y: Math.random() * ch, s: 0.5 + Math.random() * 1.5, v: 8 + Math.random() * 18, p: Math.random() * 6 });
  }

  /* ---------------- the field, drawn once per size ---------------- */
  function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function buildBg() {
    bg = document.createElement("canvas");
    bg.width = cw; bg.height = ch;
    const g = bg.getContext("2d");
    // forest and snow outside the field
    g.fillStyle = "#cfdde8"; g.fillRect(0, 0, cw, ch);
    const fx0 = ox, fy0 = oy, fw = tile * 18, fh = tile * 32 * K;
    // the field: snow with soft drifts
    const grd = g.createLinearGradient(0, fy0, 0, fy0 + fh);
    grd.addColorStop(0, "#e8f0f6"); grd.addColorStop(0.5, "#f4f8fb"); grd.addColorStop(1, "#e6eef5");
    g.fillStyle = grd; g.fillRect(fx0, fy0, fw, fh);
    // drift shading
    g.save();
    g.beginPath(); g.rect(fx0, fy0, fw, fh); g.clip();
    for (let i = 0; i < 140; i++) {
      const x = fx0 + hash2(i, 1) * fw, y = fy0 + hash2(i, 2) * fh;
      const r = tile * (0.6 + hash2(i, 3) * 1.8);
      const a = 0.05 + hash2(i, 4) * 0.06;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(160,190,215," + a + ")"); rg.addColorStop(1, "rgba(160,190,215,0)");
      g.fillStyle = rg; g.beginPath(); g.ellipse(x, y, r * 1.6, r * 0.6, 0, 0, Math.PI * 2); g.fill();
    }
    // snow sparkle
    for (let i = 0; i < 500; i++) {
      g.fillStyle = "rgba(255,255,255," + (0.4 + hash2(i, 9) * 0.6) + ")";
      g.fillRect(fx0 + hash2(i, 7) * fw, fy0 + hash2(i, 8) * fh, Math.max(1, dpr), Math.max(1, dpr));
    }
    // a faint line down the middle and tile marks in each half
    g.strokeStyle = "rgba(90,130,170,0.10)"; g.lineWidth = Math.max(1, dpr);
    for (let tx = 1; tx < 18; tx++) {
      for (let ty = 1; ty < 32; ty++) {
        if (ty >= 15 && ty <= 17) continue;
        const px = fx0 + tx * tile, py = fy0 + ty * tile * K;
        g.beginPath(); g.moveTo(px - 2 * dpr, py); g.lineTo(px + 2 * dpr, py); g.stroke();
      }
    }
    // the frozen stream
    const s0 = sy(viewSide ? R.streamBot : R.streamTop), s1 = sy(viewSide ? R.streamTop : R.streamBot);
    const sg = g.createLinearGradient(0, s0, 0, s1);
    sg.addColorStop(0, "#5f9cc7"); sg.addColorStop(0.5, "#3d7bb0"); sg.addColorStop(1, "#5d97c2");
    g.fillStyle = sg; g.fillRect(0, s0, cw, s1 - s0);
    // ice shelves along the banks
    g.fillStyle = "#dceaf4";
    for (let x = 0; x < cw; x += 3 * dpr) {
      const a = 2 * dpr + hash2(x, 11) * tile * 0.22, b = 2 * dpr + hash2(x, 12) * tile * 0.22;
      g.fillRect(x, s0, 3 * dpr, a); g.fillRect(x, s1 - b, 3 * dpr, b);
    }
    // current streaks
    g.strokeStyle = "rgba(220,240,255,0.35)"; g.lineWidth = Math.max(1, dpr * 1.2);
    for (let i = 0; i < 40; i++) {
      const x = hash2(i, 21) * cw, y = s0 + (0.25 + hash2(i, 22) * 0.5) * (s1 - s0), l = tile * (0.4 + hash2(i, 23));
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke();
    }
    // log bridges
    for (const b of R.bridges) {
      const x0 = sx(b - R.bridgeHalf), x1 = sx(b + R.bridgeHalf);
      const l = Math.min(x0, x1), w = Math.abs(x1 - x0);
      const top = s0 - tile * 0.25, bot = s1 + tile * 0.25;
      g.fillStyle = "rgba(20,40,60,0.25)"; g.fillRect(l + tile * 0.12, top + tile * 0.12, w, bot - top);
      const logH = tile * 0.36;
      for (let y = top, i = 0; y < bot; y += logH, i++) {
        const lg = g.createLinearGradient(0, y, 0, y + logH);
        lg.addColorStop(0, i % 2 ? "#9a6a3e" : "#a8774a"); lg.addColorStop(0.5, "#7a4f2b"); lg.addColorStop(1, "#5a371c");
        g.fillStyle = lg; g.fillRect(l, y, w, Math.min(logH - dpr, bot - y));
        g.fillStyle = "#c9a072"; g.beginPath(); g.ellipse(l + dpr * 2, y + logH / 2, dpr * 2, logH * 0.42, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(l + w - dpr * 2, y + logH / 2, dpr * 2, logH * 0.42, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = "rgba(255,255,255,0.75)";
      for (let i = 0; i < 6; i++) g.fillRect(l + hash2(b, i) * w, top + hash2(i, b) * (bot - top), tile * 0.3, dpr * 2);
      // rope rails
      g.strokeStyle = "#4b3018"; g.lineWidth = dpr * 1.5;
      g.beginPath(); g.moveTo(l, top); g.lineTo(l, bot); g.moveTo(l + w, top); g.lineTo(l + w, bot); g.stroke();
    }
    g.restore();
    // trees and rocks on the edges, from the env sheet when it is there
    const trees = [];
    for (let i = 0; i < 26; i++) {
      const side = i % 2;
      const x = side ? fx0 + fw - tile * (0.1 + hash2(i, 31) * 0.5) : fx0 + tile * (0.1 + hash2(i, 31) * 0.5);
      const y = fy0 + hash2(i, 32) * fh;
      if (Math.abs(y - (s0 + s1) / 2) < tile * 1.6) continue;
      trees.push([x, y, 0.8 + hash2(i, 33) * 0.5]);
    }
    for (let i = 0; i < 30; i++) {
      const x = hash2(i, 41) * cw, y = hash2(i, 42) * ch;
      if (x > fx0 - tile * 0.4 && x < fx0 + fw + tile * 0.4 && y > fy0 - tile * 2.2 && y < fy0 + fh + tile * 1.8) continue;
      trees.push([x, y, 0.9 + hash2(i, 43) * 0.7]);
    }
    trees.sort((a, b) => a[1] - b[1]);
    for (const t of trees) drawPine(g, t[0], t[1], tile * t[2]);
    for (let i = 0; i < 8; i++) {
      const left = i % 2 === 0;
      const x = left ? fx0 + tile * (0.9 + hash2(i, 51) * 0.8) : fx0 + fw - tile * (0.9 + hash2(i, 51) * 0.8);
      const y = (i < 4 ? s0 - tile * 0.5 : s1 + tile * 0.4);
      drawRock(g, x, y, tile * (0.35 + hash2(i, 52) * 0.25));
    }
    // field border
    g.strokeStyle = "rgba(60,90,120,0.35)"; g.lineWidth = dpr * 2;
    g.strokeRect(fx0, fy0, fw, fh);
  }
  function drawPine(g, x, y, s) {
    const sp = envSprite("pine");
    if (sp) {
      const c = sp.c, sc = s / 32;
      g.drawImage(sp.img, c[0], c[1], c[2], c[3], x - c[2] * sc / 2, y - c[3] * sc, c[2] * sc, c[3] * sc);
      return;
    }
    g.fillStyle = "rgba(30,50,70,0.18)"; g.beginPath(); g.ellipse(x, y, s * 0.5, s * 0.18, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#5b3b22"; g.fillRect(x - s * 0.06, y - s * 0.3, s * 0.12, s * 0.3);
    const tiers = [[0.62, 0.95, "#2f5e4c"], [0.5, 1.35, "#356b55"], [0.36, 1.7, "#3c765e"]];
    for (const t of tiers) {
      g.fillStyle = t[2];
      g.beginPath(); g.moveTo(x - s * t[0], y - s * (t[1] - 0.6)); g.lineTo(x + s * t[0], y - s * (t[1] - 0.6)); g.lineTo(x, y - s * t[1] - s * 0.3); g.closePath(); g.fill();
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.beginPath(); g.moveTo(x - s * t[0] * 0.55, y - s * (t[1] - 0.25)); g.lineTo(x + s * t[0] * 0.3, y - s * (t[1] - 0.2)); g.lineTo(x, y - s * t[1] - s * 0.3); g.closePath(); g.fill();
    }
  }
  function drawRock(g, x, y, s) {
    g.fillStyle = "rgba(30,50,70,0.2)"; g.beginPath(); g.ellipse(x, y + s * 0.15, s, s * 0.35, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#6f7a86"; g.beginPath(); g.moveTo(x - s, y + s * 0.1); g.lineTo(x - s * 0.6, y - s * 0.55); g.lineTo(x + s * 0.3, y - s * 0.7); g.lineTo(x + s, y); g.lineTo(x + s * 0.5, y + s * 0.25); g.closePath(); g.fill();
    g.fillStyle = "#f5f9fc"; g.beginPath(); g.moveTo(x - s * 0.62, y - s * 0.5); g.lineTo(x + s * 0.3, y - s * 0.68); g.lineTo(x + s * 0.55, y - s * 0.35); g.lineTo(x - s * 0.3, y - s * 0.28); g.closePath(); g.fill();
  }

  /* ---------------- towers and buildings drawn in code ---------------- */
  function drawLodge(g, x, y, s, side, hp, mhp, frozen) {
    const w = s * 2.7, h = s * 1.6;
    g.fillStyle = "rgba(20,40,60,0.28)"; g.beginPath(); g.ellipse(x, y + s * 0.1, w * 0.62, s * 0.45, 0, 0, Math.PI * 2); g.fill();
    // stone base
    g.fillStyle = "#7d8792"; g.fillRect(x - w / 2, y - s * 0.35, w, s * 0.45);
    g.fillStyle = "#98a3ad"; for (let i = 0; i < 6; i++) g.fillRect(x - w / 2 + i * w / 6 + s * 0.04, y - s * 0.32, w / 6 - s * 0.08, s * 0.18);
    // log walls
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? "#8a5a33" : "#9b683d";
      g.fillRect(x - w / 2 + s * 0.05, y - s * 0.35 - (i + 1) * s * 0.2, w - s * 0.1, s * 0.19);
    }
    // door and windows, lit
    g.fillStyle = "#3b2312"; g.fillRect(x - s * 0.22, y - s * 0.95, s * 0.44, s * 0.6);
    g.fillStyle = frozen ? "#bfe6ff" : "#ffd27a";
    g.fillRect(x - w * 0.36, y - s * 1.05, s * 0.4, s * 0.3); g.fillRect(x + w * 0.36 - s * 0.4, y - s * 1.05, s * 0.4, s * 0.3);
    // roof with snow
    const ry = y - s * 1.35;
    g.fillStyle = side === viewSide ? "#2c5f9e" : "#9e3a2c";
    g.beginPath(); g.moveTo(x - w * 0.62, ry); g.lineTo(x, ry - h * 0.75); g.lineTo(x + w * 0.62, ry); g.closePath(); g.fill();
    g.fillStyle = "#f7fbfe";
    g.beginPath(); g.moveTo(x - w * 0.58, ry - s * 0.05); g.lineTo(x, ry - h * 0.72); g.lineTo(x + w * 0.58, ry - s * 0.05); g.lineTo(x + w * 0.4, ry - s * 0.2); g.lineTo(x, ry - h * 0.5); g.lineTo(x - w * 0.42, ry - s * 0.18); g.closePath(); g.fill();
    // chimney with smoke
    g.fillStyle = "#6b737c"; g.fillRect(x + w * 0.2, ry - h * 0.7, s * 0.28, s * 0.5);
    g.fillStyle = "#f7fbfe"; g.fillRect(x + w * 0.2 - s * 0.03, ry - h * 0.72, s * 0.34, s * 0.1);
    // flag
    g.strokeStyle = "#3b2312"; g.lineWidth = Math.max(1, s * 0.05);
    g.beginPath(); g.moveTo(x - w * 0.3, ry - h * 0.3); g.lineTo(x - w * 0.3, ry - h * 1.15); g.stroke();
    g.fillStyle = TEAM[side === viewSide ? 0 : 1];
    g.beginPath(); g.moveTo(x - w * 0.3, ry - h * 1.15); g.lineTo(x - w * 0.3 + s * 0.6, ry - h * 1.02); g.lineTo(x - w * 0.3, ry - h * 0.9); g.closePath(); g.fill();
  }
  function drawHut(g, x, y, s, side, frozen) {
    const w = s * 1.9;
    g.fillStyle = "rgba(20,40,60,0.28)"; g.beginPath(); g.ellipse(x, y + s * 0.1, w * 0.6, s * 0.35, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#7d8792"; g.fillRect(x - w / 2, y - s * 0.3, w, s * 0.38);
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? "#8a5a33" : "#9b683d"; g.fillRect(x - w / 2 + s * 0.05, y - s * 0.3 - (i + 1) * s * 0.19, w - s * 0.1, s * 0.18); }
    g.fillStyle = frozen ? "#bfe6ff" : "#ffd27a"; g.fillRect(x - s * 0.18, y - s * 0.85, s * 0.36, s * 0.26);
    const ry = y - s * 1.06;
    g.fillStyle = side === viewSide ? "#2c5f9e" : "#9e3a2c";
    g.beginPath(); g.moveTo(x - w * 0.62, ry); g.lineTo(x, ry - s * 0.95); g.lineTo(x + w * 0.62, ry); g.closePath(); g.fill();
    g.fillStyle = "#f7fbfe";
    g.beginPath(); g.moveTo(x - w * 0.56, ry - s * 0.04); g.lineTo(x, ry - s * 0.92); g.lineTo(x + w * 0.56, ry - s * 0.04); g.lineTo(x + w * 0.3, ry - s * 0.22); g.lineTo(x, ry - s * 0.6); g.lineTo(x - w * 0.34, ry - s * 0.2); g.closePath(); g.fill();
  }
  function drawRuin(g, x, y, s, lodge) {
    const w = s * (lodge ? 2.4 : 1.7);
    g.fillStyle = "rgba(20,40,60,0.22)"; g.beginPath(); g.ellipse(x, y, w * 0.6, s * 0.35, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#6f7a86"; g.fillRect(x - w / 2, y - s * 0.28, w, s * 0.3);
    g.fillStyle = "#5a3a20";
    for (let i = 0; i < 5; i++) { g.save(); g.translate(x - w * 0.4 + i * w * 0.2, y - s * 0.35); g.rotate((i % 2 ? 0.4 : -0.3)); g.fillRect(-s * 0.35, -s * 0.06, s * 0.7, s * 0.12); g.restore(); }
    g.fillStyle = "rgba(245,250,255,0.9)"; g.beginPath(); g.ellipse(x, y - s * 0.3, w * 0.45, s * 0.14, 0, 0, Math.PI * 2); g.fill();
  }
  // buildings that are cards, as simple code drawings until sprites exist
  function drawBuilding(g, e, x, y, s) {
    if (drawSprite(g, e.u.replace("*", ""), "walk", 2, 0, x, y, s / 32)) return;
    const u = e.u.replace("*", "");
    const col = TEAM[e.s === viewSide ? 0 : 1];
    g.fillStyle = "rgba(20,40,60,0.25)"; g.beginPath(); g.ellipse(x, y, s * 0.7, s * 0.25, 0, 0, Math.PI * 2); g.fill();
    if (u === "igloo") {
      g.fillStyle = "#eef6fb"; g.beginPath(); g.ellipse(x, y - s * 0.1, s * 0.85, s * 0.75, 0, Math.PI, 0); g.fill();
      g.strokeStyle = "#9fbdd3"; g.lineWidth = Math.max(1, s * 0.04);
      for (let i = 1; i < 4; i++) { g.beginPath(); g.ellipse(x, y - s * 0.1, s * 0.85, s * 0.75 * i / 4, 0, Math.PI, 0); g.stroke(); }
      g.fillStyle = "#3b5a74"; g.beginPath(); g.ellipse(x, y - s * 0.1, s * 0.25, s * 0.3, 0, Math.PI, 0); g.fill();
    } else if (u === "fence") {
      g.fillStyle = "#c0392b";
      for (let i = -2; i <= 2; i++) g.fillRect(x + i * s * 0.3 - s * 0.04, y - s * 0.7, s * 0.08, s * 0.7);
      g.fillStyle = "#e67e22"; g.fillRect(x - s * 0.7, y - s * 0.55, s * 1.4, s * 0.12); g.fillRect(x - s * 0.7, y - s * 0.3, s * 1.4, s * 0.12);
    } else if (u === "cornice") {
      g.fillStyle = "#f4f9fd"; g.beginPath(); g.moveTo(x - s * 0.8, y); g.quadraticCurveTo(x - s * 0.2, y - s * 1.1, x + s * 0.8, y - s * 0.6); g.lineTo(x + s * 0.6, y); g.closePath(); g.fill();
      g.strokeStyle = "#a9c6dc"; g.lineWidth = Math.max(1, s * 0.05); g.stroke();
    } else {
      // turret-like: cannon, flare tower, catapult, lift tower
      g.fillStyle = "#6b4a2e"; g.fillRect(x - s * 0.5, y - s * 0.5, s, s * 0.5);
      g.fillStyle = col; g.fillRect(x - s * 0.5, y - s * 0.62, s, s * 0.14);
      g.fillStyle = "#59626b";
      if (u === "lifttower") { g.fillRect(x - s * 0.08, y - s * 1.6, s * 0.16, s * 1.1); g.fillRect(x - s * 0.6, y - s * 1.6, s * 1.2, s * 0.1); }
      else if (u === "flaretower") { g.fillRect(x - s * 0.2, y - s * 1.3, s * 0.4, s * 0.7); g.fillStyle = "#ff9b3d"; g.beginPath(); g.arc(x, y - s * 1.35, s * 0.18, 0, Math.PI * 2); g.fill(); }
      else if (u === "catapult") { g.save(); g.translate(x, y - s * 0.6); g.rotate(-0.6); g.fillRect(-s * 0.06, -s * 0.9, s * 0.12, s * 0.9); g.fillStyle = "#fff"; g.beginPath(); g.arc(0, -s * 0.9, s * 0.18, 0, Math.PI * 2); g.fill(); g.restore(); }
      else { g.fillRect(x - s * 0.12, y - s * 1.0, s * 0.24, s * 0.45); g.fillStyle = "#cfd8df"; g.beginPath(); g.arc(x, y - s * 1.0, s * 0.16, 0, Math.PI * 2); g.fill(); }
    }
  }

  /* ---------------- the token stand-in for units ---------------- */
  const GLYPH = {};
  for (const c of sim.DB.CARDS) if (c.unit) GLYPH[c.unit] = c.name.replace(/^The /, "").slice(0, 2);
  function drawToken(g, e, x, y, s) {
    const col = TEAM[e.s === viewSide ? 0 : 1];
    const r = Math.max(s * 0.35, e.r / 1000 * tile * 0.9);
    g.fillStyle = col; g.beginPath(); g.arc(x, y - r, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = Math.max(1, r * 0.15); g.stroke();
    g.fillStyle = "#fff"; g.font = "bold " + Math.round(r * 0.9) + "px Atkinson Hyperlegible, sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(GLYPH[e.u.replace("*", "")] || "?", x, y - r);
  }

  /* ---------------- effects ---------------- */
  function puff(x, y, n, col, spd, life, up) {
    if (reduced || lowFx) n = Math.ceil(n / 3);
    for (let i = 0; i < n && parts.length < 500; i++) {
      const a = Math.random() * Math.PI * 2, v = (0.3 + Math.random()) * spd;
      parts.push({ x, y, z: 0, vx: Math.cos(a) * v, vy: Math.sin(a) * v * K, vz: (up || 0) * (0.5 + Math.random()), t0: now, life: life * (0.6 + Math.random() * 0.6), col, sz: 0.6 + Math.random() });
    }
  }
  function ring(x, y, r, col, dur) { rings.push({ x, y, r, col, t0: now, dur: dur || 450 }); }
  function text(x, y, txt, col) { texts.push({ x, y, txt, col, t0: now }); }
  function bump(n) { if (reduced) return; shake = Math.max(shake, n); shakeT = now; }

  // turn sim events into effects (positions in world units)
  function onEvents(st, evs) {
    for (const e of evs) {
      if (e.k === "play") {
        const c = sim.CARD[e.card];
        const r = c.type === "spell" ? (c.spell.r || c.spell.half || 1500) : 1300;
        ring(e.x, e.y, r, e.s === viewSide ? "rgba(90,170,255,0.9)" : "rgba(255,110,90,0.9)", 520);
        if (c.type !== "spell") puff(e.x, e.y, 14, "#ffffff", 900, 600, 0);
        if (e.sum) { ring(e.x, e.y, 2200, "rgba(255,200,60,0.95)", 800); text(e.x, e.y - 1500, "Summit!", "#ffd34d"); }
      } else if (e.k === "die") {
        const u = sim.UNIT[e.u];
        if (e.kind === 0) corpses.push({ u: e.u.replace("*", ""), x: e.x, y: e.y, s: e.s, t0: now, air: u.air });
        puff(e.x, e.y, e.kind ? 24 : 10, e.kind ? "#d9e6ef" : "#ffffff", e.kind ? 1600 : 900, 700, 0);
      } else if (e.k === "tower") {
        const t = st.ents.find(x => x.id === e.id);
        bump(e.lodge ? 9 : 6);
      } else if (e.k === "splash") {
        ring(e.x, e.y, e.r, "rgba(220,240,255,0.9)", 350);
        puff(e.x, e.y, 6, "#e9f4ff", 700, 400, 0);
      } else if (e.k === "impact") {
        puff(e.x, e.y, 3, "#ffffff", 500, 300, 0);
      } else if (e.k === "boom") {
        const col = e.kind === "freeze" || e.kind === "whiteout" ? "rgba(150,220,255,0.95)" : e.kind === "pulse" ? "rgba(255,240,120,0.9)" : e.kind === "wind" ? "rgba(255,230,190,0.9)" : e.kind === "trap" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.95)";
        ring(e.x, e.y, Math.max(600, e.r), col, e.kind === "pulse" ? 350 : 550);
        const n = e.kind === "pulse" ? 4 : Math.min(40, 8 + (e.r / 120) | 0);
        puff(e.x, e.y, n, e.kind === "freeze" ? "#bfe9ff" : "#ffffff", Math.max(800, e.r * 0.8), 700, 0);
        if (e.r >= 2400 && e.kind !== "pulse") bump(3);
      } else if (e.k === "cocoa") {
        text(e.x, e.y - 800, "+" + Math.round(e.n / 1000) + " cocoa", "#ffcf87");
      } else if (e.k === "healpulse") {
        const h = st.ents.find(x => x.id === e.id);
        if (h) ring(h.x, h.y, e.r, "rgba(120,240,150,0.7)", 600);
      } else if (e.k === "pull") {
        const a = st.ents.find(x => x.id === e.by), b = st.ents.find(x => x.id === e.id);
        if (a && b) lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, t0: now, dur: 260, col: "#e8f4ff" });
      } else if (e.k === "abil") {
        const h = st.ents.find(x => x.id === e.id);
        if (h) { ring(h.x, h.y, 3500, "rgba(255,200,60,0.95)", 700); text(h.x, h.y - 1800, { rally: "Rally!", whiteout: "Whiteout!", leap: "Big Air!", flare: "Flare!" }[e.kind] || "!", "#ffd34d"); }
      } else if (e.k === "chargeon") {
        const h = st.ents.find(x => x.id === e.id);
        if (h) puff(h.x, h.y, 6, "#ffffff", 600, 400, 0);
      }
    }
  }

  /* ---------------- per frame ---------------- */
  function draw(st, alpha, prev, ui, t) {
    if (lastT) { avgDt = avgDt * 0.92 + Math.min(200, t - lastT) * 0.08; }
    lastT = t;
    if (!lowFx && avgDt > 28) lowFx = true; else if (lowFx && avgDt < 19) lowFx = false;
    now = t;
    if (!bg) buildBg();
    let shx = 0, shy = 0;
    if (shake > 0) {
      const k = Math.max(0, 1 - (now - shakeT) / 380);
      if (k <= 0) shake = 0;
      else { shx = (Math.random() - 0.5) * shake * dpr * k; shy = (Math.random() - 0.5) * shake * dpr * k; }
    }
    ctx.setTransform(1, 0, 0, 1, shx, shy);
    ctx.drawImage(bg, 0, 0);
    const s = tile;                  // pixels per tile
    // stream shimmer
    if (!reduced && !lowFx) {
      const s0 = sy(viewSide ? R.streamBot : R.streamTop), s1 = sy(viewSide ? R.streamTop : R.streamBot);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let i = 0; i < 12; i++) {
        const x = ((i * 977 + now * 0.03 * (1 + (i % 3))) % (cw + 200)) - 100;
        const y = s0 + ((i * 37) % 10) / 10 * (s1 - s0) * 0.8 + (s1 - s0) * 0.1;
        ctx.fillRect(x, y, tile * 0.7, Math.max(1, dpr));
      }
    }
    // deploy area preview
    if (ui && ui.drag) drawDeploy(st, ui.drag);
    // ruins of fallen towers stay
    for (const r of ruins) drawRuin(ctx, sx(r.x), sy(r.y), s, r.lodge);
    // zones under everything
    for (const z of st.zones) drawZone(st, z);
    // gather drawables
    const list = [];
    for (const e of st.ents) {
      const p = prev && prev.get(e.id);
      let x = e.x, y = e.y;
      if (p && e.k === 0) { x = p[0] + (e.x - p[0]) * alpha; y = p[1] + (e.y - p[1]) * alpha; }
      list.push({ e, x, y, d: vy(y) + (e.air ? 400 : 0) });
    }
    for (const c of corpses) list.push({ c, x: c.x, y: c.y, d: vy(c.y) - 50 });
    list.sort((a, b) => a.d - b.d);
    // shadows first so bodies never sit under another's shadow
    for (const it of list) {
      if (!it.e) continue;
      const e = it.e;
      if (e.k === 2) continue;
      const px = sx(it.x), py = sy(it.y);
      const rr = Math.max(s * 0.22, e.r / 1000 * s * 0.85);
      if (e.air) ctx.globalAlpha = 0.6;
      ctx.drawImage(shadowImg, px - rr * 1.07, py - rr * 0.43, rr * 2.13, rr * 0.86);
      ctx.globalAlpha = 1;
    }
    for (const it of list) {
      if (it.c) { drawCorpse(it.c); continue; }
      drawEnt(st, it.e, it.x, it.y, alpha);
    }
    // shots
    for (const p of st.projs) drawProj(st, p, alpha, prev);
    for (let i = lines.length - 1; i >= 0; i--) {
      const L = lines[i], k = (now - L.t0) / L.dur;
      if (k >= 1) { lines.splice(i, 1); continue; }
      ctx.strokeStyle = L.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = Math.max(1, dpr * 1.5);
      ctx.beginPath(); ctx.moveTo(sx(L.x1), sy(L.y1) - s * 0.5); ctx.lineTo(sx(L.x2), sy(L.y2) - s * 0.5); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // bars on top of all bodies
    for (const it of list) if (it.e) drawBars(st, it.e, it.x, it.y);
    drawFx();
    if (ui && ui.drag) drawGhost(st, ui.drag);
    // falling snow
    if (flakes.length && !lowFx) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      const dt = 1 / 60;
      for (const f of flakes) {
        f.y += f.v * dt * dpr; f.x += Math.sin(now / 900 + f.p) * 0.3 * dpr;
        if (f.y > ch) { f.y = -4; f.x = Math.random() * cw; }
        ctx.fillRect(f.x, f.y, f.s * dpr, f.s * dpr);
      }
    }
  }

  function drawDeploy(st, d) {
    const c = sim.CARD[d.card];
    if (!c) return;
    if (c.type !== "spell") {
      const rects = sim.zoneRects(st, d.side);
      // shade the whole field red-ish, then clear the legal rects
      ctx.fillStyle = "rgba(200,60,60,0.10)";
      ctx.fillRect(ox, oy, tile * 18, tile * 32 * K);
      for (const r of rects) {
        const x0 = sx(r[0]), x1 = sx(r[2]), y0 = sy(r[1]), y1 = sy(r[3]);
        const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(l, t, w, h);
        ctx.strokeStyle = "rgba(60,140,230,0.8)"; ctx.setLineDash([6 * dpr, 5 * dpr]); ctx.lineWidth = dpr * 1.5;
        ctx.strokeRect(l, t, w, h); ctx.setLineDash([]);
      }
    }
  }
  function drawGhost(st, d) {
    if (d.x == null) return;
    const c = sim.CARD[d.card];
    if (!c) return;
    const p = sim.snap(c, d.x, d.y);
    const ok = !sim.canPlay(st, d.side, d.card, p[0], p[1]) || d.cocoaShort;
    const px = sx(p[0]), py = sy(p[1]);
    ctx.globalAlpha = 0.75;
    if (c.type === "spell") {
      const sp = c.spell;
      const r = (sp.r || 1500) / 1000 * tile;
      ctx.strokeStyle = ok ? "rgba(255,255,255,0.95)" : "rgba(255,90,70,0.95)";
      ctx.fillStyle = ok ? "rgba(255,255,255,0.18)" : "rgba(255,90,70,0.15)";
      ctx.lineWidth = dpr * 2;
      if (sp.kind === "roll") {
        const dir = (d.side === viewSide ? -1 : 1);
        const hw = sp.half / 1000 * tile, len = sp.dist / 1000 * tile * K;
        ctx.fillRect(px - hw, dir < 0 ? py - len : py, hw * 2, len); ctx.strokeRect(px - hw, dir < 0 ? py - len : py, hw * 2, len);
      } else if (sp.kind === "bridge") {
        const hw = sp.half / 1000 * tile;
        ctx.fillRect(px - hw, sy(viewSide ? R.streamBot : R.streamTop), hw * 2, (R.streamBot - R.streamTop) / 1000 * tile * K);
      } else {
        ctx.beginPath(); ctx.ellipse(px, py, r, r * K, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    } else {
      const u = sim.UNIT[c.unit];
      // range ring for anything that shoots
      if (u.dmg && u.range > 1200) {
        const rr = (u.range + u.r) / 1000 * tile;
        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineWidth = dpr * 1.5;
        ctx.beginPath(); ctx.ellipse(px, py, rr, rr * K, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      const n = c.count || 1;
      ctx.fillStyle = ok ? "rgba(255,255,255,0.5)" : "rgba(255,80,60,0.45)";
      const rr = Math.max(tile * 0.35, u.r / 1000 * tile);
      ctx.beginPath(); ctx.ellipse(px, py, rr * (n > 1 ? 1.8 : 1), rr * K * (n > 1 ? 1.8 : 1), 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.6;
      if (!drawSprite(ctx, c.unit, "walk", rowFor(d.side === 0 ? 3 : 0, viewSide === 1), 0, px, py, tile / 32)) {}
    }
    ctx.globalAlpha = 1;
  }

  function drawZone(st, z) {
    const x = sx(z.x), y = sy(z.y);
    if (z.k === "bridge") {
      const hw = z.half / 1000 * tile;
      const t0 = sy(viewSide ? R.streamBot : R.streamTop), t1 = sy(viewSide ? R.streamTop : R.streamBot);
      const left = (z.until - st.tick) / 20;
      ctx.globalAlpha = left < 2 ? 0.4 + 0.3 * Math.sin(now / 80) : 0.95;
      const g = ctx.createLinearGradient(x - hw, 0, x + hw, 0);
      g.addColorStop(0, "#cfeaff"); g.addColorStop(0.5, "#f2fbff"); g.addColorStop(1, "#bfe1fa");
      ctx.fillStyle = g; ctx.fillRect(x - hw, t0 - tile * 0.1, hw * 2, t1 - t0 + tile * 0.2);
      ctx.strokeStyle = "rgba(120,180,220,0.9)"; ctx.lineWidth = dpr;
      for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x - hw + i * hw / 2.5, t0); ctx.lineTo(x - hw + i * hw / 2.5 - tile * 0.2, t1); ctx.stroke(); }
      ctx.globalAlpha = 1;
      return;
    }
    if (z.k === "zone") {
      const r = z.r / 1000 * tile;
      const col = z.heal ? "120,230,160" : z.hasteP ? "255,170,70" : "170,215,255";
      const pulse = reduced ? 0 : Math.sin(now / 220) * 0.05;
      ctx.fillStyle = "rgba(" + col + "," + (0.18 + pulse) + ")";
      ctx.beginPath(); ctx.ellipse(x, y, r, r * K, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(" + col + ",0.8)"; ctx.lineWidth = dpr * 2; ctx.stroke();
      if (!reduced && !lowFx && Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * z.r;
        const px = z.x + Math.cos(a) * rr, py = z.y + Math.sin(a) * rr;
        parts.push({ x: px, y: py, z: 0, vx: z.slowP ? 300 : 0, vy: 0, vz: z.heal ? 500 : z.slowP ? -100 : 300, t0: now, life: 700, col: z.heal ? "#e9fff0" : z.hasteP ? "#ffd08a" : "#ffffff", sz: 1 });
      }
      return;
    }
    if (z.k === "roll") {
      const k = Math.min(z.trav, z.dist) / z.dist;
      const r = tile * (0.45 + 0.4 * k) * (z.half / 1300);
      ctx.fillStyle = "rgba(20,40,60,0.25)"; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f6fbff"; ctx.beginPath(); ctx.arc(x, y - r, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#b9d4e8"; ctx.lineWidth = dpr * 2; ctx.stroke();
      ctx.strokeStyle = "rgba(160,190,215,0.8)"; ctx.beginPath(); ctx.arc(x, y - r, r * 0.6, now / 120, now / 120 + 2); ctx.stroke();
      if (!reduced) puff(z.x, z.y, 1, "#ffffff", 400, 400, 0);
      return;
    }
    // something about to land: a marker on the ground, which is the counterplay
    if (z.at != null) {
      const total = Math.max(1, z.at - z.t0), k = 1 - (z.at - st.tick) / total;
      const r = (z.r || 1200) / 1000 * tile;
      const col = z.k === "freeze" ? "120,200,255" : z.kind === "flare" ? "255,140,40" : z.k === "spawn" ? "255,255,255" : z.k === "push" ? "255,230,190" : "255,255,255";
      ctx.strokeStyle = "rgba(" + col + "," + (0.5 + 0.4 * k) + ")"; ctx.lineWidth = dpr * 2;
      ctx.setLineDash([6 * dpr, 6 * dpr]);
      ctx.beginPath(); ctx.ellipse(x, y, r, r * K, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(" + col + "," + (0.1 + 0.2 * k) + ")";
      ctx.beginPath(); ctx.ellipse(x, y, r * k, r * K * k, 0, 0, Math.PI * 2); ctx.fill();
      // the thing in the air: from the caster's lodge
      const from = z.s === viewSide ? [W / 2, viewSide ? 3000 : 29000] : [W / 2, viewSide ? 29000 : 3000];
      const fx = sx(from[0]) + (x - sx(from[0])) * k, fy = sy(from[1]) + (y - sy(from[1])) * k - Math.sin(k * Math.PI) * tile * 3;
      if (z.k === "strike" && z.card === "rockfall") {
        ctx.fillStyle = "#6f7a86"; const rr = tile * 0.5;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x + (i - 1) * rr * 1.4, y - tile * 6 * (1 - k) - rr, rr * (1 - i * 0.15), 0, Math.PI * 2); ctx.fill(); }
      } else if (z.k !== "spawn" || k < 1) {
        ctx.fillStyle = z.k === "freeze" ? "#bfe9ff" : z.kind === "flare" ? "#ff9b3d" : "#ffffff";
        ctx.beginPath(); ctx.arc(fx, fy, tile * 0.28, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(60,90,120,0.6)"; ctx.lineWidth = dpr; ctx.stroke();
      }
    }
  }

  function phaseOf(st, e, d, alpha) {
    if (!e.ir || !d.dmg) return -1;
    const full = d.hit * 100;
    const left = Math.max(0, e.cd - alpha * 100);
    return Math.max(0, Math.min(0.999, 1 - left / full));
  }
  function drawEnt(st, e, wx, wy, alpha) {
    const d = sim.UNIT[e.u];
    const s = tile;
    let x = sx(wx), y = sy(wy);
    if (e.k === 2) {
      const fr = e.frT > st.tick;
      if (e.lane === -1) drawLodge(ctx, x, y, s, e.s, e.hp, e.mhp, fr);
      else drawHut(ctx, x, y, s * 1.05, e.s, fr);
      // the defender on top
      const tint = e.hit >= st.tick - 2 ? 0.35 : 0;
      if (!drawSprite(ctx, "guard", e.ir ? "attack" : "walk", rowFor(e.face, viewSide === 1), e.ir ? phaseOf(st, e, d, alpha) : 0, x, y - s * (e.lane === -1 ? 1.95 : 1.55), s / 32 * 0.9, tint)) {}
      return;
    }
    if (e.k === 1) {
      ctx.globalAlpha = e.dep > 0 ? 0.6 : 1;
      drawBuilding(ctx, e, x, y, s);
      ctx.globalAlpha = 1;
      if (e.life > 0 && d.life) {
        const k = e.life / d.life;
        ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = dpr * 2;
        ctx.beginPath(); ctx.arc(x + s * 0.55, y - s * 0.2, s * 0.14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
      }
      if (e.frT > st.tick) iceBlock(x, y, s * 0.9);
      return;
    }
    let lift = 0;
    if (e.air) lift = s * 0.9 + Math.sin(now / 200 + e.id) * s * 0.06;
    if (e.lp) lift = Math.sin(Math.PI * e.lp.n / e.lp.t) * s * 2.2;
    if (d.leap && wy > R.streamTop && wy < R.streamBot) lift = Math.sin(Math.PI * (wy - R.streamTop) / (R.streamBot - R.streamTop)) * s * 1.2;
    const key = e.u.replace("*", "");
    const row = rowFor(e.face, viewSide === 1);
    let anim = "walk", ph;
    const atk = phaseOf(st, e, d, alpha);
    const frozen = e.frT > st.tick, stunned = e.stT > st.tick;
    if (atk >= 0 && !stunned) { anim = "attack"; ph = atk; }
    else if (e.dep > 0 || stunned) { ph = 0; }
    else {
      const sp = (d.speed || 60) / 60;
      ph = ((now / 1000) * 1.6 * sp + e.id * 0.37) % 1;
    }
    const tint = !lowFx && e.hit >= st.tick - 2 ? 0.45 : 0;
    ctx.globalAlpha = e.dep > 0 ? 0.55 + 0.45 * (1 - e.dep / Math.max(1, d.deploy)) : 1;
    const sc = s / 32 * (d.scale || 1);
    if (!drawSprite(ctx, key, anim, row, ph, x, y - lift, sc, tint)) drawToken(ctx, e, x, y - lift, s);
    ctx.globalAlpha = 1;
    if (e.sm) {
      ctx.fillStyle = "#ffcc3a"; const r = s * 0.1;
      ctx.beginPath(); ctx.arc(x + s * 0.3, y - lift - s * 0.2, r, 0, Math.PI * 2); ctx.fill();
    }
    if (frozen) iceBlock(x, y - lift, s * 0.6);
    else if (stunned && !reduced) {
      ctx.fillStyle = "#ffe066";
      for (let i = 0; i < 3; i++) { const a = now / 160 + i * 2.1; ctx.fillRect(x + Math.cos(a) * s * 0.3 - dpr, y - lift - s * 1.25 + Math.sin(a) * s * 0.1, 2.5 * dpr, 2.5 * dpr); }
    }
    if (e.slT > st.tick || e.as) { ctx.fillStyle = "rgba(150,210,255,0.85)"; ctx.font = Math.round(s * 0.35) + "px sans-serif"; ctx.textAlign = "center"; ctx.fillText("❄", x - s * 0.35, y - lift - s * 0.9); }
    if ((e.haT > st.tick || e.au) && !reduced) { ctx.fillStyle = "rgba(255,170,60,0.8)"; ctx.fillRect(x - s * 0.25, y - s * 0.02, s * 0.5, dpr * 2); }
    if (e.chg) { ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = dpr * 2; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * (0.3 + i * 0.25)); ctx.lineTo(x - s * 0.9, y - s * (0.3 + i * 0.25)); ctx.stroke(); } }
    if (e.sh > 0) { ctx.strokeStyle = "rgba(170,220,255,0.75)"; ctx.lineWidth = dpr * 1.5; ctx.beginPath(); ctx.ellipse(x, y - lift - s * 0.55, s * 0.5, s * 0.7, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
  function iceBlock(x, y, s) {
    ctx.fillStyle = "rgba(190,235,255,0.55)"; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.rect(x - s * 0.6, y - s * 1.5, s * 1.2, s * 1.5); ctx.fill(); ctx.stroke();
  }
  function drawCorpse(c) {
    const k = (now - c.t0) / 900;
    if (k >= 1) { corpses.splice(corpses.indexOf(c), 1); return; }
    const x = sx(c.x), y = sy(c.y);
    ctx.globalAlpha = 1 - k * k;
    const d = sim.UNIT[c.u] || {};
    if (!drawSprite(ctx, c.u, "death", 2, Math.min(0.999, k * 1.4), x, y - (c.air ? tile * 0.9 * (1 - k) : 0), tile / 32 * (d.scale || 1))) {
      ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.beginPath(); ctx.arc(x, y - tile * 0.3, tile * 0.3 * (1 + k), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawBars(st, e, wx, wy) {
    const s = tile;
    const mine = e.s === viewSide;
    const x = sx(wx), y = sy(wy);
    if (e.k === 2) {
      const w = s * (e.lane === -1 ? 2.2 : 1.6), h = Math.max(5 * dpr, s * 0.2);
      const top = y + s * 0.35;
      ctx.fillStyle = "rgba(15,25,40,0.75)"; ctx.fillRect(x - w / 2 - dpr, top - dpr, w + 2 * dpr, h + 2 * dpr);
      ctx.fillStyle = mine ? BLUE : RED; ctx.fillRect(x - w / 2, top, w * e.hp / e.mhp, h);
      ctx.fillStyle = "#fff"; ctx.font = "bold " + Math.round(h * 1.05) + "px Atkinson Hyperlegible, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(e.hp), x, top + h / 2 + dpr * 0.5);
      return;
    }
    const full = e.hp >= e.mhp && e.sh >= (e.msh || 0);
    if (full && e.k === 0) {
      // a small team dot when untouched
      ctx.fillStyle = mine ? BLUE : RED;
      const lift = e.air ? s * 0.9 : 0;
      ctx.fillRect(x - s * 0.08, y - lift - s * 1.55, s * 0.16, s * 0.08);
      return;
    }
    const d = sim.UNIT[e.u];
    const w = Math.max(s * 0.7, Math.min(s * 1.4, e.r / 1000 * s * 2)), h = Math.max(3 * dpr, s * 0.1);
    const lift = e.air ? s * 0.9 : 0;
    const top = y - lift - (e.k === 1 ? s * 1.7 : s * 1.6);
    ctx.fillStyle = "rgba(15,25,40,0.75)"; ctx.fillRect(x - w / 2 - dpr, top - dpr, w + 2 * dpr, h + 2 * dpr);
    ctx.fillStyle = mine ? BLUE : RED; ctx.fillRect(x - w / 2, top, w * Math.max(0, e.hp) / e.mhp, h);
    if (e.sh > 0 && e.msh) { ctx.fillStyle = "#cfe9ff"; ctx.fillRect(x - w / 2, top - h - dpr, w * e.sh / e.msh, h * 0.8); }
  }
  function drawProj(st, p, alpha, prev) {
    const pr = prev && prev.get(-p.id);
    const wx = pr ? pr[0] + (p.x - pr[0]) * alpha : p.x, wy = pr ? pr[1] + (p.y - pr[1]) * alpha : p.y;
    const x = sx(wx), y = sy(wy);
    const s = tile;
    const u = p.u.replace("*", "");
    if (p.k === "hook") {
      const f = sim.byId(st, p.by);
      if (f) { ctx.strokeStyle = "rgba(240,248,255,0.9)"; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(sx(f.x), sy(f.y) - s * 0.8); ctx.lineTo(x, y - s * 0.5); ctx.stroke(); }
      ctx.fillStyle = "#c9d2da"; ctx.beginPath(); ctx.arc(x, y - s * 0.5, s * 0.1, 0, Math.PI * 2); ctx.fill();
      return;
    }
    let h = s * 0.7;
    if (p.k === "lob") {
      const tot = Math.max(1, Math.hypot(p.tx - p.sx, p.ty - p.sy)), rem = Math.hypot(p.tx - wx, p.ty - wy);
      const k = 1 - rem / tot;
      h = Math.sin(k * Math.PI) * s * 3.5 + s * 0.3;
      ctx.fillStyle = "rgba(20,40,60,0.25)"; ctx.beginPath(); ctx.ellipse(x, y, s * 0.25, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f6fbff"; ctx.beginPath(); ctx.arc(x, y - h, s * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#9fbdd3"; ctx.lineWidth = dpr; ctx.stroke();
      return;
    }
    const src = sim.byId(st, p.by);
    if (u === "biathlete" || u === "ranger") {
      // an arrow: a short line along its travel
      const ang = Math.atan2(sy(p.ty) - sy(p.y), sx(p.tx) - sx(p.x));
      ctx.strokeStyle = "#4b3018"; ctx.lineWidth = Math.max(1, dpr * 1.4);
      ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * s * 0.35, y - h - Math.sin(ang) * s * 0.35); ctx.lineTo(x, y - h); ctx.stroke();
      return;
    }
    if (u === "sage" || u === "matriarch" || u === "owl") {
      ctx.fillStyle = "#bfe9ff"; ctx.save(); ctx.translate(x, y - h); ctx.rotate(now / 100);
      ctx.fillRect(-s * 0.13, -s * 0.13, s * 0.26, s * 0.26); ctx.restore();
      if (!reduced && Math.random() < 0.5) parts.push({ x: wx, y: wy, z: 700, vx: 0, vy: 0, vz: 0, t0: now, life: 250, col: "#dff4ff", sz: 0.8 });
      return;
    }
    if (u === "flaretower" || u === "lodge" || u === "hut") {
      ctx.fillStyle = u === "flaretower" ? "#ff9b3d" : "#ffe7a3";
      ctx.beginPath(); ctx.arc(x, y - h, s * (u === "flaretower" ? 0.13 : 0.11), 0, Math.PI * 2); ctx.fill();
      return;
    }
    // snowballs by default
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "rgba(80,110,140,0.7)"; ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(x, y - h, s * (u === "cannon" ? 0.17 : 0.1), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  function drawFx() {
    const s = tile;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i], k = (now - r.t0) / r.dur;
      if (k >= 1) { rings.splice(i, 1); continue; }
      const rr = r.r / 1000 * s * (0.4 + 0.6 * k);
      ctx.strokeStyle = r.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = dpr * 3 * (1 - k) + dpr;
      ctx.beginPath(); ctx.ellipse(sx(r.x), sy(r.y), rr, rr * K, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i], age = now - p.t0;
      if (age >= p.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const t = age / 1000;
      const x = sx(p.x + p.vx * t), y = sy(p.y + p.vy * t) - (p.z + p.vz * t) / 1000 * s;
      ctx.globalAlpha = 1 - age / p.life;
      ctx.fillStyle = p.col;
      const z = Math.max(1.5 * dpr, s * 0.09 * p.sz);
      ctx.fillRect(x - z / 2, y - z / 2, z, z);
    }
    ctx.globalAlpha = 1;
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i], k = (now - t.t0) / 1100;
      if (k >= 1) { texts.splice(i, 1); continue; }
      ctx.globalAlpha = 1 - k * k;
      ctx.font = "bold " + Math.round(s * 0.55) + "px 'Alfa Slab One', serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = dpr * 3; ctx.strokeStyle = "rgba(20,32,46,0.9)";
      const x = sx(t.x), y = sy(t.y) - k * s;
      ctx.strokeText(t.txt, x, y); ctx.fillStyle = t.col; ctx.fillText(t.txt, x, y);
    }
    ctx.globalAlpha = 1;
  }
  function noteTowers(st) {
    // called each tick: towers that vanished leave a ruin
    for (const sp of R.towerSpots) {
      for (let s = 0; s < 2; s++) {
        const y = s === 0 ? sp.y : H - sp.y;
        const key = s + ":" + sp.x + ":" + y;
        if (ruins.some(r => r.key === key)) continue;
        const alive = st.ents.some(e => e.k === 2 && e.s === s && e.x === sp.x && e.y === y);
        if (!alive) {
          ruins.push({ key, x: sp.x, y, lodge: sp.lane === -1, s });
          puff(sp.x, y, 40, "#e9f2f8", 2400, 1100, 600);
          puff(sp.x, y, 20, "#8a5a33", 1800, 900, 900);
        }
      }
    }
  }
  return {
    resize, draw, onEvents, setView, toWorld, noteTowers,
    get tile() { return tile / dpr; }, get dpr() { return dpr; },
    worldToCss(x, y) { return [sx(x) / dpr, sy(y) / dpr]; },
    set reducedMotion(v) { reduced = v; },
    get lowFx() { return lowFx; },
    reset() { ruins.length = 0; corpses.length = 0; parts.length = 0; rings.length = 0; texts.length = 0; },
  };
}
