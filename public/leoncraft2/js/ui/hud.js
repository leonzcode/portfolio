/* ---------------------------------------------------------------------------
   Leoncraft 2 - the in-game HUD, drawn on the GUI canvas under any screen.

   The hotbar (widgets.png, 182 x 22 at the bottom centre) with its 24-pixel
   selector, the block in each slot and its count, the off hand when it holds
   something, the selected block's name fading out over the hotbar for two
   seconds after it changes, the crosshair, and in survival the hearts,
   hunger, armour, air and the experience bar and level, all at the game's
   positions. F3 adds the debug text: grey translucent strips down the left
   and right, one per line, as the game draws them.

   The crosshair is drawn the game's way, inverting what is behind it. The
   world is on another canvas, so it lives in its own small canvas under the
   GUI with CSS mix-blend-mode: difference; the HUD shows and hides it.

     const hud = new Hud(inventory, icons);
     gui.hud = hud;
     hud.setStats(survival.stats());     // each tick in survival
     hud.setDebug(leftLines, rightLines); // or hud.setDebug(null) to hide F3
     hud.crosshair = false;               // third person
--------------------------------------------------------------------------- */
import { displayName } from './inventory.js?v=8';
import { drawStack } from './inventory.js?v=8';

const TICK = 50;

export class Hud {
  constructor(inventory, icons) {
    this.inv = inventory;
    this.icons = icons;
    this.stats = null;          // { health, food, air, xp (0-1), level, armor, maxHealth?, absorption? }
    this.debug = null;          // { left: [], right: [] }
    this.camera = null;         // { yaw, pitch } (radians): F3 shows the axes instead of the crosshair
    this.crosshair = true;
    this._dirty = true;
    this._wake = Infinity;
    this._hlId = 0; this._hlUntil = 0;
    this._lastHealth = -1; this._blinkUntil = 0; this._lostFrom = 0;
    this._drawn = false;
    this._cross = null; this._crossKey = '';
    this._overlay = null;
    inventory.on('change', () => { this._dirty = true; this._checkHeld(); });
    this._checkHeld(true);
  }

  // a different block in the hand shows its name again; the same one does not
  _checkHeld(quiet) {
    const id = this.inv.heldId();
    if (id === this._hlId) return;
    this._hlId = id;
    this._hlUntil = id && !quiet ? performance.now() + 2000 : 0;
    this._dirty = true;
  }

  setStats(s) {
    const o = this.stats;
    if (s && o && s.health === o.health && s.food === o.food && s.air === o.air && s.xp === o.xp && s.level === o.level && s.armor === o.armor && s.absorption === o.absorption
      && s.poison === o.poison && s.wither === o.wither && s.hungerEffect === o.hungerEffect && s.regen === o.regen && (s.saturation > 0) === (o.saturation > 0)) return;
    if (s && this._lastHealth >= 0 && s.health < this._lastHealth) {
      // hurt: the hearts blink for a second, the lost ones shown white
      this._blinkUntil = performance.now() + 1000;
      this._lostFrom = Math.max(this._lostFrom || 0, this._lastHealth);
    }
    this._lastHealth = s ? s.health : -1;
    this.stats = s ? Object.assign({}, s) : null;
    this._dirty = true;
  }
  setDebug(left, right) {
    if (!left && !right) { if (this.debug) { this.debug = null; this._dirty = true; } return; }
    const d = this.debug, L = left || [], R = right || [];
    if (d && same(d.left, L) && same(d.right, R)) return;
    this.debug = { left: L.slice(), right: R.slice() };
    this._dirty = true;
  }
  markDirty() { this._dirty = true; }

  // the GUI asks this every frame while the HUD is up
  isDirty() {
    if (this._dirty || this.icons.pending) return true;
    return performance.now() >= this._wake;
  }

  draw(g) {
    const now = performance.now();
    this._dirty = false;
    this._wake = Infinity;
    this._drawn = true;
    this._hook(g);
    const W = g.width, H = g.height, cx = Math.floor(W / 2);
    const inv = this.inv, survival = inv.mode === 'survival';

    // the axes in place of the crosshair while F3 is up and the camera is known
    if (this.debug && this.camera) this._axes(g, cx, Math.floor(H / 2));

    // the hotbar, the selected slot's frame and the off hand
    g.blit('widgets', 0, 0, 182, 22, cx - 91, H - 22);
    g.blit('widgets', 0, 22, 24, 23, cx - 91 - 1 + inv.selected * 20, H - 23);
    const off = inv.offhand, leftHanded = g.options && g.options.get('mainHand') === 'left';
    if (off) {
      if (!leftHanded) g.blit('widgets', 24, 22, 22, 24, cx - 91 - 29, H - 23);
      else g.blit('widgets', 60, 22, 22, 24, cx + 91 + 7, H - 23);
    }
    for (let i = 0; i < 9; i++) drawStack(g, this.icons, inv.slots[i], cx - 90 + i * 20 + 2, H - 16 - 3);
    if (off) drawStack(g, this.icons, off, leftHanded ? cx + 91 + 10 : cx - 91 - 26, H - 16 - 3);

    if (survival && this.stats) this._bars(g, cx, H, now);

    // the held block's name: solid for a second and a half, then fading over half a second
    if (this._hlId && now < this._hlUntil) {
      const left = this._hlUntil - now;
      const a = Math.min(1, left / 500);
      const name = displayName(this._hlId);
      const y = H - 59 + (survival ? 0 : 14);
      g.ctx.globalAlpha = a;
      g.centered(name, cx, y, 0xFFFFFF, true);
      g.ctx.globalAlpha = 1;
      this._wakeAt(left > 500 ? this._hlUntil - 500 : now);
    } else if (this._hlUntil && now < this._hlUntil + 100) this._wakeAt(now);

    if (this.debug) this._debugText(g, W);
  }

  _wakeAt(t) { if (t < this._wake) this._wake = t; }

  /* ---- survival bars ---- */
  _bars(g, cx, H, now) {
    const s = this.stats;
    const left = cx - 91, right = cx + 91;
    const maxHealth = s.maxHealth || 20, absorb = Math.ceil(s.absorption || 0);
    const health = Math.ceil(s.health);
    const tick = Math.floor(now / TICK);

    // experience: the bar, then the level in green with a black outline
    g.blit('icons', 0, 64, 182, 5, left, H - 32 + 3);
    const xpw = Math.floor(Math.max(0, Math.min(1, s.xp || 0)) * 183);
    if (xpw > 0) g.blit('icons', 0, 69, xpw, 5, left, H - 32 + 3);
    if (s.level > 0) {
      const t = String(s.level), x = Math.floor((g.width - g.textWidth(t)) / 2), y = H - 31 - 4;
      g.text(t, x + 1, y, 0x000000, false); g.text(t, x - 1, y, 0x000000, false);
      g.text(t, x, y + 1, 0x000000, false); g.text(t, x, y - 1, 0x000000, false);
      g.text(t, x, y, 0x80FF20, false);
    }

    // hearts, left to right in rows of ten
    const rows = Math.ceil((maxHealth + absorb) / 2 / 10);
    const rowH = Math.max(10 - (rows - 2), 3);
    const top = H - 39;
    const blinking = now < this._blinkUntil;
    const blink = blinking && Math.floor((this._blinkUntil - now) / 150) % 2 === 1;
    if (blinking) this._wakeAt(now);
    else this._lostFrom = 0;
    const lost = blinking ? Math.max(health, Math.ceil(this._lostFrom)) : health;
    const lowHealth = health + absorb <= 4;
    if (lowHealth) this._wakeAt((tick + 1) * TICK);
    const hearts = Math.ceil(maxHealth / 2), total = hearts + Math.ceil(absorb / 2);
    // poisoned hearts are green, withered ones black; with regeneration a wave runs along them
    const hx = s.poison ? 36 : s.wither ? 72 : 0;
    const wave = s.regen ? tick % Math.ceil(maxHealth + 5) : -1;
    if (s.regen) this._wakeAt((tick + 1) * TICK);
    for (let i = total - 1; i >= 0; i--) {
      const row = Math.floor(i / 10);
      const x = left + (i % 10) * 8;
      let y = top - row * rowH;
      if (lowHealth) y += hash(tick * 31 + i) & 1;
      if (i === wave) y -= 2;
      g.blit('icons', 16 + (blink ? 9 : 0), 0, 9, 9, x, y);
      if (i >= hearts) {
        // absorption hearts, gold
        const a = absorb - (i - hearts) * 2;
        g.blit('icons', a >= 2 ? 160 : 169, 0, 9, 9, x, y);
        continue;
      }
      if (blink && i * 2 < lost) g.blit('icons', (i * 2 + 1 < lost ? 70 : 79) + hx, 0, 9, 9, x, y);
      if (i * 2 + 1 < health) g.blit('icons', 52 + hx, 0, 9, 9, x, y);
      else if (i * 2 + 1 === health) g.blit('icons', 61 + hx, 0, 9, 9, x, y);
    }

    // armour, above the hearts
    const armor = s.armor || 0;
    if (armor > 0) {
      const ay = top - (rows - 1) * rowH - 10;
      for (let i = 0; i < 10; i++) {
        const x = left + i * 8;
        if (i * 2 + 1 < armor) g.blit('icons', 34, 9, 9, 9, x, ay);
        else if (i * 2 + 1 === armor) g.blit('icons', 25, 9, 9, 9, x, ay);
        else g.blit('icons', 16, 9, 9, 9, x, ay);
      }
    }

    // hunger, right to left
    // green with the hunger effect; with no saturation left the bar trembles now and then
    const food = s.food ?? 20, fx = s.hungerEffect ? 36 : 0, bg = s.hungerEffect ? 133 : 16;
    const shake = s.saturation !== undefined && s.saturation <= 0 && tick % (food * 3 + 1) === 0;
    if (s.saturation !== undefined && s.saturation <= 0) {
      // redraw only for the tremble and the tick after it
      const period = food * 3 + 1, next = shake ? tick + 1 : tick + (period - tick % period);
      this._wakeAt(next * TICK);
    }
    for (let i = 0; i < 10; i++) {
      const x = right - i * 8 - 9;
      const y = top + (shake ? (hash(tick * 7 + i) % 3) - 1 : 0);
      g.blit('icons', bg, 27, 9, 9, x, y);
      if (i * 2 + 1 < food) g.blit('icons', 52 + fx, 27, 9, 9, x, y);
      else if (i * 2 + 1 === food) g.blit('icons', 61 + fx, 27, 9, 9, x, y);
    }

    // air, above the hunger, while there is less than a full breath
    const air = s.air ?? 300, maxAir = s.maxAir || 300;
    if (air < maxAir) {
      const full = Math.ceil((air - 2) * 10 / maxAir), popping = Math.ceil(air * 10 / maxAir) - full;
      for (let k = 0; k < full + popping; k++) g.blit('icons', k < full ? 16 : 25, 18, 9, 9, right - k * 8 - 9, top - 10);
    }
  }

  /* ---- F3 ---- */
  _debugText(g, W) {
    const { left, right } = this.debug;
    for (let i = 0; i < left.length; i++) {
      const t = left[i];
      if (!t) continue;
      const y = 2 + 9 * i, w = g.textWidth(t);
      g.fill(1, y - 1, 2 + w + 1, y + 8, 0x90505050);
      g.text(t, 2, y, 0xE0E0E0, false);
    }
    for (let i = 0; i < right.length; i++) {
      const t = right[i];
      if (!t) continue;
      const y = 2 + 9 * i, w = g.textWidth(t), x = W - 2 - w;
      g.fill(x - 1, y - 1, x + w + 1, y + 8, 0x90505050);
      g.text(t, x, y, 0xE0E0E0, false);
    }
  }
  // the three axes, red east, green up, blue south, turned with the camera
  _axes(g, cx, cy) {
    const { yaw, pitch } = this.camera;
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // world to view for a camera turned yaw about Y, then pitch about X
    const view = (x, y, z) => {
      const x1 = cyw * x - syw * z, z1 = syw * x + cyw * z;
      return [x1, cp * y - sp * z1, sp * y + cp * z1];
    };
    const axes = [[view(1, 0, 0), '#FF0000'], [view(0, 1, 0), '#00FF00'], [view(0, 0, 1), '#0000FF']];
    axes.sort((a, b) => a[0][2] - b[0][2]);
    const ctx = g.ctx;
    ctx.lineWidth = 1;
    for (const [v, col] of axes) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, cy + 0.5);
      ctx.lineTo(cx + 0.5 + v[0] * 10, cy + 0.5 - v[1] * 10);
      ctx.stroke();
    }
  }

  /* ---- the crosshair ---- */
  // hooks an overlay into the GUI once: after every redraw it shows the crosshair only if the HUD was drawn
  _hook(g) {
    if (this._overlay) return;
    this._overlay = { draw: gg => this._syncCross(gg) };
    g.overlays.push(this._overlay);
  }
  _syncCross(g) {
    const show = this._drawn && this.crosshair && !(this.debug && this.camera);
    this._drawn = false;
    if (!show) { if (this._cross) this._cross.style.display = 'none'; if (this._atk) this._atk.style.display = 'none'; return; }
    const img = g.sheet('icons');
    if (!img) return;
    if (!this._cross) {
      const c = this._cross = document.createElement('canvas');
      Object.assign(c.style, { position: 'fixed', pointerEvents: 'none', mixBlendMode: 'difference', imageRendering: 'pixelated', zIndex: '4' });
      document.body.appendChild(c);
    }
    const c = this._cross, s = g.scale, dpr = g.dpr || window.devicePixelRatio || 1;
    const x = Math.floor((g.width - 15) / 2), y = Math.floor((g.height - 15) / 2);
    const key = s + ',' + dpr + ',' + x + ',' + y;
    if (key !== this._crossKey) {
      this._crossKey = key;
      c.width = c.height = 15 * s;
      c.style.width = c.style.height = (15 * s / dpr) + 'px';
      c.style.left = (x * s / dpr) + 'px';
      c.style.top = (y * s / dpr) + 'px';
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false;
      cx.clearRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0, 15, 15, 0, 0, 15 * s, 15 * s);
    }
    c.style.display = '';
    this._syncAttack(g, x, y);
  }
  /* The attack indicator (combat since 1.9): a little bar under the
     crosshair filling as the next hit charges, gone once it is full.
     hud.attack is the charge (0..1), or null for none (js/entities). */
  _syncAttack(g, x, y) {
    const a = this.attack;
    if (a === null || a === undefined || a >= 1) { if (this._atk) this._atk.style.display = 'none'; return; }
    if (!this._atk) {
      const c = this._atk = document.createElement('canvas');
      Object.assign(c.style, { position: 'fixed', pointerEvents: 'none', mixBlendMode: 'difference', imageRendering: 'pixelated', zIndex: '4' });
      document.body.appendChild(c);
    }
    const c = this._atk, s = g.scale, dpr = g.dpr || window.devicePixelRatio || 1;
    const n = Math.floor(a * 17);
    const key = s + ',' + dpr + ',' + x + ',' + y + ',' + n;
    if (key !== this._atkKey) {
      this._atkKey = key;
      c.width = 16 * s; c.height = 4 * s;
      c.style.width = (16 * s / dpr) + 'px'; c.style.height = (4 * s / dpr) + 'px';
      c.style.left = ((x - 1) * s / dpr) + 'px'; c.style.top = ((y + 16) * s / dpr) + 'px';
      const cx = c.getContext('2d');
      cx.clearRect(0, 0, c.width, c.height);
      cx.fillStyle = 'rgb(110,110,110)';
      cx.fillRect(0, s, 16 * s, 2 * s);
      cx.fillStyle = 'rgb(255,255,255)';
      cx.fillRect(0, s, Math.min(16, n) * s, 2 * s);
    }
    c.style.display = '';
  }
  // take the crosshair off the page (leaving the game)
  dispose() {
    if (this._cross) { this._cross.remove(); this._cross = null; }
    if (this._atk) { this._atk.remove(); this._atk = null; }
  }
}

function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// a small stable random number per tick and heart, for the low-health shake
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; }
