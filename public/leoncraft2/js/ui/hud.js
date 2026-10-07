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
import { displayName, drawStack, GLINT, COOLING } from './inventory.js?v=25';
import { drawBossBar } from '../dim/bossbar.js?v=25';
import { BLOCKS, B } from '../blocks.js?v=25';
import { EFFECTS, EFFECT_ICON } from '../effects.js?v=25';

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
      && s.poison === o.poison && s.wither === o.wither && s.hungerEffect === o.hungerEffect && s.regen === o.regen && (s.saturation > 0) === (o.saturation > 0)
      && s.fire === o.fire) return;
    if (s && this._lastHealth >= 0 && s.health < this._lastHealth) {
      // hurt: the hearts blink for a second, the lost ones shown white
      this._blinkUntil = performance.now() + 1000;
      this._lostFrom = Math.max(this._lostFrom || 0, this._lastHealth);
    }
    this._lastHealth = s ? s.health : -1;
    this.stats = s ? Object.assign({}, s) : null;
    this._dirty = true;
  }
  /* the effects on you (survival.js effects: name -> { level, ticks, ambient }),
     each frame; the HUD is drawn again when one comes or goes, and each tick
     while one is in its last ten seconds (its icon flickers) */
  setEffects(e) {
    let k = '';
    if (e) for (const n in e) { const x = e[n]; k += n + (x.ambient ? '*' : '') + (x.ticks >= 0 && x.ticks <= 200 ? ':' + x.ticks : '') + ','; }
    if (k === this._fxKey) return;
    this._fxKey = k; this.effects = k ? e : null; this._dirty = true;
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

    // burning, in first person: the game's flames up the lower part of the view, under the HUD
    if (this.stats && this.stats.fire && this.crosshair) this._fire(g, now);

    // the axes in place of the crosshair while F3 is up and the camera is known
    if (this.debug && this.camera) this._axes(g, cx, Math.floor(H / 2));

    // what is held up under the HUD (a map in the hand: js/maps.js), and when to draw again
    if (this.under) { const w = this.under(g, now); if (w) this._wakeAt(w); }
    // the effects on you, top right
    if (this.effects) this._effects(g, W, now);
    // a spectator has no hotbar (modes.js): only the debug text and a boss's bar
    if (this.spectator) {
      if (this.debug) this._debugText(g, W);
      if (this.boss) drawBossBar(g, this.boss, cx);
      return;
    }
    // the hotbar, the selected slot's frame and the off hand
    g.blit('widgets', 0, 0, 182, 22, cx - 91, H - 22);
    g.blit('widgets', 0, 22, 24, 23, cx - 91 - 1 + inv.selected * 20, H - 23);
    const off = inv.offhand, leftHanded = g.options && g.options.get('mainHand') === 'left';
    if (off) {
      if (!leftHanded) g.blit('widgets', 24, 22, 22, 24, cx - 91 - 29, H - 23);
      else g.blit('widgets', 60, 22, 22, 24, cx + 91 + 7, H - 23);
    }
    GLINT.seen = false; COOLING.seen = false;
    for (let i = 0; i < 9; i++) drawStack(g, this.icons, inv.slots[i], cx - 90 + i * 20 + 2, H - 16 - 3);
    if (off) drawStack(g, this.icons, off, leftHanded ? cx + 91 + 10 : cx - 91 - 26, H - 16 - 3);
    // Attack Indicator: Hotbar (Video Settings): a sword beside the hotbar on the main hand's side, filling as the hit charges
    if (this.attackMode === 'hotbar' && this.attack !== null && this.attack !== undefined && this.attack < 1) this._hotbarAttack(g, leftHanded ? cx - 91 - 22 : cx + 91 + 6, H - 20, this.attack);
    // an enchanted item in the hotbar shines: redrawn twenty times a second while it is there
    if (GLINT.seen) { GLINT.seen = false; this._wakeAt(now + 50); }
    // an item cooling down: its veil shrinks a step a tick
    if (COOLING.seen) { COOLING.seen = false; this._wakeAt(now + 50); }

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
    // a boss's bar across the top (the Ender Dragon: js/dim/bossbar.js)
    if (this.boss) drawBossBar(g, this.boss, cx);
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

  /* ---- effects ----
     As the game lays them out: a 24 pixel box each from the top right, the
     beneficial ones in the top row and the rest in a second row 26 below,
     longest lasting furthest right (ambient ones, from a beacon or a
     conduit, first, in the box with the light rim), the picture 3 in, and in
     the last ten seconds the picture fading and flickering by the game's
     sum. The boxes and pictures are Pixel Perfection's (container/inventory,
     where the classic game kept them); effects newer than that sheet borrow
     the nearest picture. */
  _effects(g, W, now) {
    const e = this.effects, list = [];
    for (const n in e) { const d = EFFECTS[n]; if (d && !d.instant && !e[n].hidden) list.push(n); }
    if (!list.length) return;
    const img = g.sheet('container/inventory');
    if (!img) { this._wakeAt(now + 100); return; }
    const key = n => { const x = e[n]; return [x.ambient ? 1 : 0, x.ticks < 0 ? 1 : 0, x.ticks < 0 ? 0 : x.ticks, EFFECTS[n].colour]; };
    list.sort((a, b) => { const p = key(a), q = key(b); for (let i = 0; i < 4; i++) if (p[i] !== q[i]) return q[i] - p[i]; return 0; });
    let good = 0, rest = 0;
    const ctx = g.ctx, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    for (const n of list) {
      const x = e[n], d = EFFECTS[n];
      let px = W, py = 1;
      if (d.kind === 'good') px -= 25 * ++good;
      else { px -= 25 * ++rest; py += 26; }
      g.blit(img, x.ambient ? 165 : 141, 166, 24, 24, px, py);
      let a = 1;
      if (!x.ambient && x.ticks >= 0 && x.ticks <= 200) {
        const k = x.ticks, l = 10 - k / 20;
        a = clamp(clamp(k / 10 / 5 * 0.5, 0, 0.5) + Math.cos(k * Math.PI / 5) * clamp(l / 10 * 0.25, 0, 0.25), 0, 1);
      }
      const ic = EFFECT_ICON[n];
      if (ic === undefined) continue;
      ctx.globalAlpha = a;
      g.blit(img, (ic % 8) * 18, 198 + Math.floor(ic / 8) * 18, 18, 18, px + 3, py + 3);
      ctx.globalAlpha = 1;
    }
  }

  /* ---- on fire ----
     The game's screen flames: the fire picture on two squares a block
     across, half a block in front of the eye and 0.3 below it, 0.24 out to
     each side and turned 10 degrees in, seen through the hand's 70 degree
     view at nine tenths opacity. Drawn here a picture column at a time, each
     column stretched to where those squares put it, and again whenever the
     fire's frame changes. */
  _fire(g, now) {
    const d = BLOCKS[B.fire], px = this.icons.px;
    if (!d || !d.faces || !px) return;
    const frames = d.anim ? d.anim.frames : 1, ft = d.anim ? d.anim.frametime : 2;
    const step = Math.floor(now / (TICK * ft));
    this._wakeAt((step + 1) * TICK * ft);
    // the second fire picture the game uses is our same flames half a cycle on
    const layer = d.faces[0] + (step + (frames >> 1)) % frames;
    const pic = this._firePic || (this._firePic = new Map());
    let c = pic.get(layer);
    if (!c) {
      c = document.createElement('canvas'); c.width = c.height = 16;
      const img = new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset + layer * 1024, 1024).slice(), 16, 16);
      c.getContext('2d').putImageData(img, 0, 0);
      pic.set(layer, c);
    }
    const ctx = g.ctx, Wp = ctx.canvas.width, Hp = ctx.canvas.height;
    const ty = Math.tan(35 * Math.PI / 180), tx = ty * Wp / Hp;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 2; i++) {
      const sx = i ? -0.24 : 0.24, th = (i ? 10 : -10) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
      // a point of the square (x across it, y up it, both -0.5..0.5) on the screen, in canvas pixels
      const at = (x, y) => {
        const X = x * cs - 0.5 * sn + sx, Z = -x * sn - 0.5 * cs, Y = y - 0.3;
        return [(X / -Z / tx + 1) / 2 * Wp, (1 - Y / -Z / ty) / 2 * Hp];
      };
      for (let u = 0; u < 16; u++) {
        const x0 = -0.5 + u / 16, x1 = x0 + 1 / 16;
        const a = at(x0, 0), b = at(x1, 0), top = at(x0 + 0.5 / 16, 0.5), bot = at(x0 + 0.5 / 16, -0.5);
        const L = Math.floor(Math.min(a[0], b[0])), R = Math.ceil(Math.max(a[0], b[0]));
        if (R < 0 || L > Wp) continue;
        // the picture is laid mirrored on the square, as the game lays it
        ctx.drawImage(c, 15 - u, 0, 1, 16, L, top[1], R - L, bot[1] - top[1]);
      }
    }
    ctx.restore();
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
     crosshair filling as the next hit charges, gone once it is full; at a
     full charge with a mob in reach, a small sword there instead.
     hud.attack is the charge (0..1), 2 for the sword, or null for none
     (combat/combat.js indicator()). */
  // our own sword, 16 x 16: grey, and white up to the charge
  _hotbarAttack(g, x, y, a) {
    const fill = Math.round(Math.max(0, Math.min(1, a)) * 16);
    const px = (u, v) => g.fill(x + u, y + v, x + u + 1, y + v + 1, 16 - v <= fill ? 0xFFFFFFFF : 0xFF5A5A5A);
    for (let i = 0; i < 9; i++) { px(5 + i, 10 - i); px(6 + i, 10 - i); }
    for (const [u, v] of [[3, 9], [4, 10], [5, 11], [6, 12], [4, 12], [3, 13], [2, 14], [1, 15]]) px(u, v);
  }
  _syncAttack(g, x, y) {
    const a = this.attackMode && this.attackMode !== 'crosshair' ? null : this.attack;
    if (a === null || a === undefined || (a >= 1 && a !== 2)) { if (this._atk) this._atk.style.display = 'none'; return; }
    if (!this._atk) {
      const c = this._atk = document.createElement('canvas');
      Object.assign(c.style, { position: 'fixed', pointerEvents: 'none', mixBlendMode: 'difference', imageRendering: 'pixelated', zIndex: '4' });
      document.body.appendChild(c);
    }
    const c = this._atk, s = g.scale, dpr = g.dpr || window.devicePixelRatio || 1;
    const n = a === 2 ? 99 : Math.floor(a * 17);
    const key = s + ',' + dpr + ',' + x + ',' + y + ',' + n;
    if (key !== this._atkKey && n === 99) {
      // our own little sword: a blade from the lower left to the upper right, a guard and a grip
      this._atkKey = key;
      c.width = 16 * s; c.height = 16 * s;
      c.style.width = (16 * s / dpr) + 'px'; c.style.height = (16 * s / dpr) + 'px';
      c.style.left = ((x - 1) * s / dpr) + 'px'; c.style.top = ((y + 16) * s / dpr) + 'px';
      const cx = c.getContext('2d');
      cx.clearRect(0, 0, c.width, c.height);
      cx.fillStyle = 'rgb(255,255,255)';
      const px = (u, v) => cx.fillRect(u * s, v * s, s, s);
      for (let i = 0; i < 8; i++) { px(5 + i, 9 - i); px(6 + i, 9 - i); }
      for (const [u, v] of [[3, 8], [4, 9], [5, 10], [6, 11], [4, 11], [3, 12], [2, 13]]) px(u, v);
    } else if (key !== this._atkKey) {
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
