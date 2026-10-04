/* ---------------------------------------------------------------------------
   Leoncraft 2 - the player.

   Movement is Minecraft's, tick for tick at 20 a second, and drawn between
   ticks so it is smooth at any frame rate:

     on the ground   acceleration 0.1 (x1.3 sprinting, x0.3 sneaking), then
                     friction 0.546 a tick; jump 0.42 up (sprint-jumping
                     adds 0.2 forward)
     in the air      acceleration 0.02, gravity 0.08, drag 0.98 up and down,
                     0.91 across
     in water        acceleration 0.02, drag 0.8, sinking 0.02, Space swims up
     flying          double-tap Space; Space and Shift for up and down

   The body is 0.6 wide and 1.8 tall with eyes at 1.62, and moves into the
   world one axis at a time (y, then x, then z), as the game does: every box
   it could touch this tick (full blocks, and the boxes of slabs, stairs,
   fences, doors...) is gathered, and the move along each axis is cut short
   at the first one in the way. Walking into something up to 0.6 high steps
   up onto it, which is how stairs and slabs are climbed.
--------------------------------------------------------------------------- */
import { BLOCKS, FLUID, SOLID, B } from './blocks.js?v=8';
import { collisionBoxes, selectionBoxes } from './models.js?v=8';
const THREE = window.THREE;

const W = 0.3, HT = 1.8, STEP = 0.6;
const EPS = 1e-7;

export class Player {
  constructor(world) {
    this.w = world;
    this.pos = new THREE.Vector3(0, 100, 0);
    this.prev = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.inWater = false; this.eyeInWater = false; this.inLava = false;
    this.flying = false; this.sprinting = false; this.sneaking = false;
    this.keys = {};
    this.walkDist = 0; this.prevWalk = 0;
    this.bob = 0;
    this.fov = 70;
    this.baseFov = 70;            // the FOV option; sprinting widens it by fovEffects
    this.fovEffects = 1;
    this.canFly = true;           // creative mode
    this.stepped = 0;
    this.lastSpace = 0;
    this.splashes = [];
  }
  setKey(k, on) {
    if (k === ' ' && on && !this.keys[' ']) {
      const now = performance.now();
      if (now - this.lastSpace < 300 && this.canFly) this.flying = !this.flying, this.vel.y = 0;
      this.lastSpace = now;
    }
    if ((k === 'w') && on && !this.keys.w) {
      const now = performance.now();
      if (now - (this.lastW || 0) < 280 && this.canSprint !== false) this.sprinting = true;
      this.lastW = now;
    }
    this.keys[k] = on;
  }

  /* ---- collision ---- */
  // every solid box overlapping a region, as flat [x0, y0, z0, x1, y1, z1] runs in this.bx
  gather(x0, y0, z0, x1, y1, z1) {
    const out = this.bx || (this.bx = []);
    out.length = 0;
    const w = this.w;
    const nbAt = (x, y, z) => (dx, dy, dz) => { const b = w.get(x + dx, y + dy, z + dz); return b ? { d: BLOCKS[b], m: w.meta(x + dx, y + dy, z + dz) } : null; };
    for (let y = Math.floor(y0) - 1; y <= Math.floor(y1); y++)
      for (let z = Math.floor(z0); z <= Math.floor(z1); z++)
        for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
          if (!w.loaded(x, z)) { out.push(x, y, z, x + 1, y + 1, z + 1); continue; }   // the edge of the loaded world is a wall
          const b = w.get(x, y, z);
          if (!b || !SOLID[b]) continue;
          const d = BLOCKS[b];
          if (d.shape === 'cube') { out.push(x, y, z, x + 1, y + 1, z + 1); continue; }
          const boxes = collisionBoxes(d, w.meta(x, y, z), nbAt(x, y, z));
          if (boxes) for (const c of boxes) out.push(x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]);
        }
    return out;
  }
  // how far the body box can go along one axis before a box stops it (Minecraft's clip)
  clip(bx, axis, d, x0, y0, z0, x1, y1, z1) {
    if (d === 0) return 0;
    const lo = [x0, y0, z0], hi = [x1, y1, z1];
    const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
    for (let i = 0; i < bx.length; i += 6) {
      if (bx[i + a1 + 3] <= lo[a1] + EPS || bx[i + a1] >= hi[a1] - EPS) continue;
      if (bx[i + a2 + 3] <= lo[a2] + EPS || bx[i + a2] >= hi[a2] - EPS) continue;
      if (d > 0 && bx[i + axis] >= hi[axis] - EPS) d = Math.min(d, bx[i + axis] - hi[axis]);
      else if (d < 0 && bx[i + axis + 3] <= lo[axis] + EPS) d = Math.max(d, bx[i + axis + 3] - lo[axis]);
    }
    return d;
  }
  // the move itself: y, x, z, then the same again lifted by a step if that gets further
  slide(px, py, pz, dx, dy, dz, bx) {
    let x0 = px - W, y0 = py, z0 = pz - W, x1 = px + W, y1 = py + HT, z1 = pz + W;
    const my = this.clip(bx, 1, dy, x0, y0, z0, x1, y1, z1); y0 += my; y1 += my;
    const mx = this.clip(bx, 0, dx, x0, y0, z0, x1, y1, z1); x0 += mx; x1 += mx;
    const mz = this.clip(bx, 2, dz, x0, y0, z0, x1, y1, z1); z0 += mz; z1 += mz;
    return [mx, my, mz];
  }
  boxHits(x0, y0, z0, x1, y1, z1) {
    const bx = this.gather(x0, y0, z0, x1, y1, z1);
    for (let i = 0; i < bx.length; i += 6)
      if (bx[i] < x1 - EPS && bx[i + 3] > x0 + EPS && bx[i + 1] < y1 - EPS && bx[i + 4] > y0 + EPS && bx[i + 2] < z1 - EPS && bx[i + 5] > z0 + EPS) return true;
    return false;
  }
  move(dx, dy, dz) {
    const p = this.pos;
    // sneaking keeps you on the edge of a block: no step that would leave nothing under you
    if (this.sneaking && this.onGround && !this.flying) {
      const drop = (nx, nz) => !this.boxHits(nx - W, p.y - STEP, nz - W, nx + W, p.y, nz + W);
      while (dx !== 0 && drop(p.x + dx, p.z)) dx = Math.abs(dx) < 0.05 ? 0 : dx - Math.sign(dx) * 0.05;
      while (dz !== 0 && drop(p.x, p.z + dz)) dz = Math.abs(dz) < 0.05 ? 0 : dz - Math.sign(dz) * 0.05;
      while (dx !== 0 && dz !== 0 && drop(p.x + dx, p.z + dz)) {
        dx = Math.abs(dx) < 0.05 ? 0 : dx - Math.sign(dx) * 0.05;
        dz = Math.abs(dz) < 0.05 ? 0 : dz - Math.sign(dz) * 0.05;
      }
    }
    const reach = Math.max(Math.abs(dx), Math.abs(dz)) + STEP + 1;
    const bx = this.gather(p.x - W - reach, p.y - reach, p.z - W - reach, p.x + W + reach, p.y + HT + reach, p.z + W + reach);
    let [mx, my, mz] = this.slide(p.x, p.y, p.z, dx, dy, dz, bx);
    const landed = dy < 0 && my !== dy;
    // blocked sideways while on (or landing on) the ground: try it a step higher
    if ((this.onGround || landed) && !this.flying && (mx !== dx || mz !== dz)) {
      const up = this.clip(bx, 1, STEP, p.x - W, p.y, p.z - W, p.x + W, p.y + HT, p.z + W);
      const [sx, , sz] = this.slide(p.x, p.y + up, p.z, dx, 0, dz, bx);
      if (sx * sx + sz * sz > mx * mx + mz * mz + 1e-9) {
        // and back down onto whatever is there
        const down = this.clip(bx, 1, -up, p.x + sx - W, p.y + up, p.z + sz - W, p.x + sx + W, p.y + up + HT, p.z + sz + W);
        mx = sx; mz = sz; my = up + down;
        this.stepped = (this.stepped || 0) + my;      // the camera eases up the step
      }
    }
    p.x += mx; p.y += my; p.z += mz;
    if (my !== dy) { if (dy < 0) this.onGround = true; this.vel.y = 0; } else if (dy !== 0) this.onGround = false;
    if (mx !== dx) this.vel.x = 0;
    if (mz !== dz) this.vel.z = 0;
  }

  /* ---- one tick ---- */
  tick() {
    this.prev.copy(this.pos);
    this.prevWalk = this.walkDist;
    const k = this.keys;
    let fwd = (k.w ? 1 : 0) - (k.s ? 1 : 0), str = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    this.sneaking = !!k.shift && !this.flying;
    // survival sets canSprint (hunger above 6) and usingItem (eating: a fifth of the speed, no sprinting)
    if (fwd <= 0 || this.sneaking || this.canSprint === false || this.usingItem) this.sprinting = false;
    if (k.control && fwd > 0 && this.canSprint !== false && !this.usingItem) this.sprinting = true;
    const feetB = this.w.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.4), Math.floor(this.pos.z));
    const eyeB = this.w.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 1.62), Math.floor(this.pos.z));
    const wasIn = this.inWater;
    this.inWater = FLUID[feetB] === 1 || FLUID[this.w.get(Math.floor(this.pos.x), Math.floor(this.pos.y + 1.0), Math.floor(this.pos.z))] === 1;
    this.inLava = FLUID[feetB] === 2;
    this.eyeInWater = FLUID[eyeB] === 1 || !!(BLOCKS[eyeB] && BLOCKS[eyeB].waterlogged);
    if (this.inWater && !wasIn && this.vel.y < -0.15) this.splashes.push([this.pos.x, this.pos.z, Math.min(1.6, -this.vel.y * 3), 2.6]);

    let accel;
    if (this.flying) accel = this.sprinting ? 0.1 : 0.05;
    else if (this.inWater || this.inLava) accel = 0.02;
    else if (this.onGround) {
      const under = this.w.get(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
      const slip = (BLOCKS[under] && BLOCKS[under].slippery) || 0.6;
      const f = slip * 0.91;
      accel = 0.1 * (0.16277136 / (f * f * f));
      if (this.sprinting) accel *= 1.3;
    } else accel = this.sprinting ? 0.026 : 0.02;
    if (this.sneaking) { fwd *= 0.3; str *= 0.3; }
    if (this.usingItem) { fwd *= 0.2; str *= 0.2; }
    // move relative to where you are looking (only round, not up)
    let len = Math.hypot(fwd, str);
    if (len > 0.0001) {
      if (len < 1) len = 1;
      const f = fwd / len * accel, s = str / len * accel;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      this.vel.x += -sin * f + cos * s;
      this.vel.z += -cos * f - sin * s;
    }
    if (this.flying) {
      if (k[' ']) this.vel.y += 0.15 * 0.25 * 3;
      if (k.shift) this.vel.y -= 0.15 * 0.25 * 3;
    } else if (this.inWater || this.inLava) {
      if (k[' ']) this.vel.y += 0.04;
    } else if (k[' '] && this.onGround) {
      this.vel.y = 0.42;
      this.jumped = true;           // survival.js takes a jump's exhaustion
      if (this.sprinting) { this.vel.x += -Math.sin(this.yaw) * 0.2; this.vel.z += -Math.cos(this.yaw) * 0.2; }
      this.onGround = false;
    }
    const was = this.pos.clone();
    this.move(this.vel.x, this.vel.y, this.vel.z);
    // drag and gravity
    if (this.flying) {
      this.vel.x *= 0.91 * 0.6 / 0.546 * 0.91; this.vel.z *= 0.91 * 0.6 / 0.546 * 0.91; this.vel.y *= 0.6;
      if (this.onGround) this.flying = false;
    } else if (this.inWater) {
      this.vel.x *= 0.8; this.vel.y *= 0.8; this.vel.z *= 0.8; this.vel.y -= 0.02;
    } else if (this.inLava) {
      this.vel.multiplyScalar(0.5); this.vel.y -= 0.02;
    } else {
      const under = this.w.get(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
      const slip = this.onGround ? ((BLOCKS[under] && BLOCKS[under].slippery) || 0.6) : 1.0;
      this.vel.y = (this.vel.y - 0.08) * 0.98;
      this.vel.x *= slip * 0.91; this.vel.z *= slip * 0.91;
    }
    const moved = Math.hypot(this.pos.x - was.x, this.pos.z - was.z);
    if (this.onGround) this.walkDist += moved * 0.6;
    // wading and swimming push ripples out across the water
    if (this.inWater && moved > 0.02 && Math.random() < 0.6) this.splashes.push([this.pos.x, this.pos.z, 0.25 + moved * 1.2, 1.2]);
    // creative: falling out of the world brings you back down from the sky (survival hurts instead)
    if (this.canFly && this.pos.y < -80) { this.pos.y = 200; this.vel.set(0, 0, 0); }
    if (!this.canFly) this.flying = false;
    // a little wider when sprinting, as the game does
    const want = this.baseFov * (1 + ((this.sprinting ? 1.12 : 1) * (this.flying && this.sprinting ? 1.05 : 1) - 1) * this.fovEffects);
    this.fov += (want - this.fov) * 0.35;
  }

  /* ---- where the camera is, between ticks ---- */
  view(alpha) {
    const p = this.prev.clone().lerp(this.pos, alpha);
    const walk = this.prevWalk + (this.walkDist - this.prevWalk) * alpha;
    const eye = p.clone();
    eye.y += this.sneaking ? 1.27 : 1.62;
    // the game's head bob: a figure of eight as you walk
    const speed = Math.min(1, Math.hypot(this.vel.x, this.vel.z) * 4);
    const bobAmt = this.onGround && !this.flying && this.bobbing !== false ? speed : 0;
    this.bob += (bobAmt - this.bob) * 0.1;
    const bx = Math.sin(walk * Math.PI) * 0.05 * this.bob, by = -Math.abs(Math.cos(walk * Math.PI)) * 0.08 * this.bob;
    eye.x += Math.cos(this.yaw) * bx; eye.z += -Math.sin(this.yaw) * bx;
    eye.y += by;
    // the held block sways a little against the step
    const handBob = { x: Math.sin(walk * Math.PI) * 0.025 * this.bob, y: -Math.abs(Math.cos(walk * Math.PI)) * 0.03 * this.bob };
    return { feet: p, eye, roll: Math.sin(walk * Math.PI) * 0.006 * this.bob, handBob };
  }

  /* ---- what the crosshair is on: a voxel walk along the view ray ---- */
  pick(eye, reach) {
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    let x = Math.floor(eye.x), y = Math.floor(eye.y), z = Math.floor(eye.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = Math.abs(1 / dir.x), tdy = Math.abs(1 / dir.y), tdz = Math.abs(1 / dir.z);
    let tx = (sx > 0 ? x + 1 - eye.x : eye.x - x) * tdx, ty = (sy > 0 ? y + 1 - eye.y : eye.y - y) * tdy, tz = (sz > 0 ? z + 1 - eye.z : eye.z - z) * tdz;
    let face = null, t = 0;
    while (t <= reach) {
      const b = this.w.get(x, y, z);
      if (b && !FLUID[b] && b !== B.air && BLOCKS[b].shape !== 'none') {
        const d = BLOCKS[b];
        if (d.shape === 'cube') return { x, y, z, b, face, t, hit: [eye.x + dir.x * t, eye.y + dir.y * t, eye.z + dir.z * t] };
        // a shaped block: the nearest of its boxes the ray goes through, if any
        const w = this.w, bx = x, by = y, bz = z;
        const nb = (dx, dy, dz) => { const n = w.get(bx + dx, by + dy, bz + dz); return n ? { d: BLOCKS[n], m: w.meta(bx + dx, by + dy, bz + dz) } : null; };
        const r = rayBoxes(eye, dir, x, y, z, selectionBoxes(d, w.meta(x, y, z), nb));
        if (r && r.t <= reach) return { x, y, z, b, face: r.face, t: r.t, hit: r.hit, box: r.box };
      }
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; face = [-sx, 0, 0]; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; face = [0, -sy, 0]; }
      else { z += sz; t = tz; tz += tdz; face = [0, 0, -sz]; }
    }
    return null;
  }
  // would a block here overlap the player? (a whole cube, or the given boxes)
  occupies(x, y, z, boxes) {
    if (boxes) {
      const p = this.pos;
      return boxes.some(c => x + c[3] > p.x - W && x + c[0] < p.x + W && z + c[5] > p.z - W && z + c[2] < p.z + W && y + c[4] > p.y && y + c[1] < p.y + HT);
    }
    const p = this.pos;
    return x + 1 > p.x - W && x < p.x + W && z + 1 > p.z - W && z < p.z + W && y + 1 > p.y && y < p.y + HT;
  }
}

// the nearest box a ray enters: where, through which face, and how far along
function rayBoxes(o, dir, x, y, z, boxes) {
  let best = null;
  for (const c of boxes) {
    let t0 = 0, t1 = 1e9, axis = -1, sgn = 0;
    const lo = [x + c[0], y + c[1], z + c[2]], hi = [x + c[3], y + c[4], z + c[5]], O = [o.x, o.y, o.z], D = [dir.x, dir.y, dir.z];
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      if (Math.abs(D[k]) < 1e-9) { if (O[k] < lo[k] || O[k] > hi[k]) ok = false; continue; }
      let a = (lo[k] - O[k]) / D[k], b = (hi[k] - O[k]) / D[k];
      let s = -1;
      if (a > b) { const tmp = a; a = b; b = tmp; s = 1; }
      if (a > t0) { t0 = a; axis = k; sgn = s; }
      if (b < t1) t1 = b;
      if (t0 > t1) ok = false;
    }
    if (!ok || axis < 0) continue;
    if (!best || t0 < best.t) {
      const face = [0, 0, 0]; face[axis] = sgn;
      best = { t: t0, face, hit: [O[0] + D[0] * t0, O[1] + D[1] * t0, O[2] + D[2] * t0], box: c };
    }
  }
  return best;
}
