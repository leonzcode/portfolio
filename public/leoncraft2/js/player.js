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
   world one axis at a time (y, then x, then z), as the game does.
--------------------------------------------------------------------------- */
import { BLOCKS, FLUID, SOLID, B } from './blocks.js?v=1';
const THREE = window.THREE;

const W = 0.3, HT = 1.8;

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
    this.lastSpace = 0;
    this.splashes = [];
  }
  setKey(k, on) {
    if (k === ' ' && on && !this.keys[' ']) {
      const now = performance.now();
      if (now - this.lastSpace < 300) this.flying = !this.flying, this.vel.y = 0;
      this.lastSpace = now;
    }
    if ((k === 'w') && on && !this.keys.w) {
      const now = performance.now();
      if (now - (this.lastW || 0) < 280) this.sprinting = true;
      this.lastW = now;
    }
    this.keys[k] = on;
  }

  /* ---- collision ---- */
  boxHits(x0, y0, z0, x1, y1, z1) {
    for (let y = Math.floor(y0); y <= Math.floor(y1 - 1e-7); y++)
      for (let z = Math.floor(z0); z <= Math.floor(z1 - 1e-7); z++)
        for (let x = Math.floor(x0); x <= Math.floor(x1 - 1e-7); x++) {
          const b = this.w.get(x, y, z);
          if (b && SOLID[b]) return true;
          if (!this.w.loaded(x, z)) return true;    // the edge of the loaded world is a wall
        }
    return false;
  }
  move(dx, dy, dz) {
    const p = this.pos;
    // y first, then x, then z, stopping at whatever is solid
    const tryAxis = (axis, d) => {
      if (d === 0) return 0;
      const n = Math.ceil(Math.abs(d) / 0.45);
      const s = d / n;
      let moved = 0;
      for (let i = 0; i < n; i++) {
        const q = p.clone(); q[axis] += s;
        if (this.boxHits(q.x - W, q.y, q.z - W, q.x + W, q.y + HT, q.z + W)) {
          // slide up against it as close as it allows
          if (axis === 'y') p.y = s < 0 ? Math.floor(p.y + 1e-6) + 0.0 : Math.ceil(p.y + HT) - HT - 1e-4;
          else if (s > 0) p[axis] = Math.ceil(p[axis] + W) - W - 1e-4;
          else p[axis] = Math.floor(p[axis] - W) + W + 1e-4;
          return moved + 1;   // hit
        }
        p[axis] = q[axis]; moved += s;
      }
      return 0;
    };
    const hy = tryAxis('y', dy);
    if (hy) { if (dy < 0) this.onGround = true; this.vel.y = 0; } else if (dy !== 0) this.onGround = false;
    // sneaking keeps you on the edge of a block
    if (this.sneaking && this.onGround && !this.flying) {
      const edge = (nx, nz) => !this.boxHits(nx - W, p.y - 0.6, nz - W, nx + W, p.y, nz + W);
      if (edge(p.x + dx, p.z)) dx = 0;
      if (edge(p.x, p.z + dz)) dz = 0;
    }
    if (tryAxis('x', dx)) this.vel.x = 0;
    if (tryAxis('z', dz)) { this.vel.z = 0; }
  }

  /* ---- one tick ---- */
  tick() {
    this.prev.copy(this.pos);
    this.prevWalk = this.walkDist;
    const k = this.keys;
    let fwd = (k.w ? 1 : 0) - (k.s ? 1 : 0), str = (k.d ? 1 : 0) - (k.a ? 1 : 0);
    this.sneaking = !!k.shift && !this.flying;
    if (fwd <= 0 || this.sneaking) this.sprinting = false;
    if (k.control && fwd > 0) this.sprinting = true;
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
    if (this.pos.y < -80) { this.pos.y = 200; this.vel.set(0, 0, 0); }
    // a little wider when sprinting, as the game does
    const want = 70 * (this.sprinting ? 1.12 : 1) * (this.flying && this.sprinting ? 1.05 : 1);
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
    const bobAmt = this.onGround && !this.flying ? speed : 0;
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
      if (b && !FLUID[b] && b !== B.air) return { x, y, z, b, face };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; face = [-sx, 0, 0]; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; face = [0, -sy, 0]; }
      else { z += sz; t = tz; tz += tdz; face = [0, 0, -sz]; }
    }
    return null;
  }
  // would a block here overlap the player?
  occupies(x, y, z) {
    const p = this.pos;
    return x + 1 > p.x - W && x < p.x + W && z + 1 > p.z - W && z < p.z + W && y + 1 > p.y && y < p.y + HT;
  }
}
