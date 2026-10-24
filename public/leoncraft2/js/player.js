/* ---------------------------------------------------------------------------
   Leoncraft 2 - the player.

   Movement is Minecraft's, tick for tick at 20 a second, and drawn between
   ticks so it is smooth at any frame rate:

     on the ground   acceleration 0.1 (x1.3 sprinting, x0.3 sneaking), then
                     friction 0.546 a tick; jump 0.42 up (sprint-jumping
                     adds 0.2 forward), and held, the next jump 10 ticks
                     after the last
     in the air      acceleration 0.02, gravity 0.08, drag 0.98 up and down,
                     0.91 across
                     (the ground as a tick starts picks the friction, so the
                     tick of a jump still has the ground's and the tick of a
                     landing the air's, which is what makes a sprint-jump
                     7.1 m/s)
     in water        acceleration 0.02, drag 0.8 (0.9 sprint-swimming),
                     sinking 0.005, Space swims up 0.04, Shift down 0.04;
                     swimming into a wall with clear air 0.6 above lifts
                     you 0.3, which is how you climb out onto the bank
     flying          double-tap Space (within 7 ticks); acceleration 0.05
                     (0.1 sprinting), drag 0.91; Space and Shift add 0.15
                     up or down, drag 0.6, so 7.5 m/s

   The keys give 0.98 of a step each way (the game's own factor, which is
   what makes walking 4.317 m/s and sprinting 5.612). Water depth is read
   from the water's surface, not its block: a still pool is 8/9 of a block
   deep. Moving water pushes you along its current. Ladders and vines hold
   you at 0.15 down (none sneaking) and climb at 0.2; cobwebs, berry bushes
   and powder snow slow you inside them; soul sand and honey slow you on
   them; slime bounces you back up and beds a little.

   The body is 0.6 wide and 1.8 tall with eyes at 1.62 (1.5 and 1.27
   crouching, 0.6 and 0.4 swimming or crawling, with the camera easing
   between them), and moves into the
   world one axis at a time (y, then x, then z), as the game does: every box
   it could touch this tick (full blocks, and the boxes of slabs, stairs,
   fences, doors...) is gathered, and the move along each axis is cut short
   at the first one in the way. Walking into something up to 0.6 high steps
   up onto it, which is how stairs and slabs are climbed.
--------------------------------------------------------------------------- */
import { BLOCKS, FLUID, SOLID, B } from './blocks.js?v=107';
import { collisionBoxes, selectionBoxes } from './models.js?v=107';
import { LEVEL, FALLING } from './world-const.js?v=107';
const THREE = window.THREE;

const W = 0.3, HT = 1.8, STEP = 0.6;
const EPS = 1e-7;
// the body's poses: height and eye height
const POSE = { stand: [1.8, 1.62], crouch: [1.5, 1.27], swim: [0.6, 0.4] };
const ids = list => new Set(list.map(n => B[n]).filter(v => v !== undefined));
const SCAFFOLD = B.scaffolding;
const HONEY = B.honey_block;
const CLIMB = ids(['ladder', 'vine', 'scaffolding', 'weeping_vines', 'weeping_vines_plant', 'twisting_vines', 'twisting_vines_plant', 'cave_vines', 'cave_vines_plant']);
const byName = list => new Map(list.filter(e => B[e[0]] !== undefined).map(e => [B[e[0]], e[1]]));
// standing on these: how much of your speed (and jump) is left
const SPEED = byName([['soul_sand', 0.4], ['honey_block', 0.4]]);
const JUMP = byName([['honey_block', 0.5]]);
// inside these: what is left of a move across and up and down
const STUCK = byName([['cobweb', [0.25, 0.05]], ['sweet_berry_bush', [0.8, 0.75]], ['powder_snow', [0.9, 1.5]]]);
const isBed = b => !!(BLOCKS[b] && /_bed$/.test(BLOCKS[b].name));
const isWater = b => FLUID[b] === 1 || !!(BLOCKS[b] && BLOCKS[b].waterlogged);
const isFluid = (b, kind) => kind === 1 ? isWater(b) : FLUID[b] === kind;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Player {
  constructor(world) {
    this.w = world;
    this.pos = new THREE.Vector3(0, 100, 0);
    this.prev = this.pos.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false; this.inWater = false; this.eyeInWater = false; this.inLava = false;
    this.flying = false; this.sprinting = false; this.sneaking = false;
    this.swimming = false; this.pose = 'stand'; this.h = HT;
    this.scale = 1; this.halfW = W;     // (half size in Leon Network's Chameleon: setScale)
    this.eyeH = 1.62; this.prevEyeH = 1.62;
    this.waterDepth = -1; this.lavaDepth = -1;
    this.hCollide = false; this.minorCollide = false; this.moved = [0, 0, 0];
    this.fallDistance = 0; this.landed = null;   // { dist, block }: the last landing, for fall damage
    this.stuck = null; this.climbing = false;
    this.noSprint = false;        // set while too hungry to sprint
    this.keys = {};
    this.walkDist = 0; this.prevWalk = 0;
    this.bob = 0; this.oBob = 0;   // how much the view bobs (the game's: speed over the ground, up to 0.1)
    this.fov = 70;
    this.baseFov = 70;            // the FOV option; sprinting widens it by fovEffects
    this.fovEffects = 1;
    this.fovMod = 1; this.prevFovMod = 1;   // how much wider than the FOV option the view is, this tick and the last
    this.canFly = true;           // creative mode
    this.stepped = 0;
    this.splashes = [];
    this.age = 0;                 // ticks lived, for the presses below
    this.taps = {};               // presses since the last tick: { age, n } a key
    this.noJumpDelay = 0;         // holding Space jumps again only 10 ticks after the last jump
    this.jumpTrigger = 0;         // the game's double-tap windows: 7 ticks after a press of Space (flying)
    this.sprintTrigger = 0;       // and of forward (sprinting)
  }
  /* A key going down or up, the moment it happens. The tick reads what is
     held then, as the game does, and also every press since the tick
     before, so a tap shorter than a tick is never lost. Double taps (Space
     to fly, forward to sprint) are counted in ticks, as the game counts
     them. */
  // a player made smaller or bigger (Leon Network's Chameleon plays at half size): the box, the eyes and the height all follow
  // (wide: the box's width alone, when it is not k: a Chameleon hider is thinner than they look, as in LC1's Mecha)
  setScale(k, wide = k) {
    if (!(k > 0) || !(wide > 0) || (k === this.scale && W * wide === this.halfW)) return;
    const grew = k > this.scale || W * wide > this.halfW;
    this.scale = k; this.halfW = W * wide;
    this.h = POSE[this.pose][0] * k; this.eyeH = this.prevEyeH = POSE[this.pose][1] * k;
    // (growing back inside something would wedge you: lifted until clear, as the first Leoncraft does)
    if (grew && this.w) { const p = this.pos; for (let i = 0; i < 4 && this.boxHits(p.x - this.halfW, p.y, p.z - this.halfW, p.x + this.halfW, p.y + this.h, p.z + this.halfW); i++) p.y += 1; }
  }
  setKey(k, on) {
    // a press in the air with an elytra on starts a glide (tick())
    if (k === ' ' && on && !this.keys[' '] && !this.onGround && !this.flying) this.wantGlide = true;
    if (on && !this.keys[k]) {
      const t = this.taps[k];
      this.taps[k] = t && t.age === this.age ? { age: this.age, n: t.n + 1 } : { age: this.age, n: 1 };
    }
    this.keys[k] = on;
  }
  // how many times a key went down since the last tick
  presses(k) { const t = this.taps[k]; return t && t.age === this.age ? t.n : 0; }

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
          // scaffolding holds you up only from above, and not while you sneak down through it (the game's STABLE shape)
          if (b === SCAFFOLD) { if (this.pos.y >= y + 1 - 1e-5 && !this.sneaking) out.push(x, y + 14 / 16, z, x + 1, y + 1, z + 1); continue; }
          // a honey block is a sixteenth in from each side and 15/16 tall (you lean into it to slide)
          if (b === HONEY) { out.push(x + 1 / 16, y, z + 1 / 16, x + 15 / 16, y + 15 / 16, z + 15 / 16); continue; }
          if (d.shape === 'cube') { out.push(x, y, z, x + 1, y + 1, z + 1); continue; }
          const boxes = collisionBoxes(d, w.meta(x, y, z), nbAt(x, y, z), x, z);
          if (boxes) for (const c of boxes) out.push(x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]);
        }
    // things in the world you can stand on and walk into: boats (js/entities)
    if (this.extraBoxes) this.extraBoxes(out, x0, y0, z0, x1, y1, z1);
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
    let x0 = px - this.halfW, y0 = py, z0 = pz - this.halfW, x1 = px + this.halfW, y1 = py + this.h, z1 = pz + this.halfW;
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
    // spectators pass through everything
    if (this.noclip) { p.x += dx; p.y += dy; p.z += dz; this.onGround = false; this.hCollide = false; this.moved[0] = dx; this.moved[1] = dy; this.moved[2] = dz; return; }
    // sneaking keeps you on the edge of a block: no step that would leave nothing under you
    // (in 0.05 steps, and the last step of 0.05 or less stops it, as the game does; never on the way up)
    if (this.sneaking && this.onGround && !this.flying && dy <= 0) {
      const drop = (nx, nz) => !this.boxHits(nx - this.halfW, p.y - STEP, nz - this.halfW, nx + this.halfW, p.y, nz + this.halfW);
      while (dx !== 0 && drop(p.x + dx, p.z)) dx = Math.abs(dx) <= 0.05 ? 0 : dx - Math.sign(dx) * 0.05;
      while (dz !== 0 && drop(p.x, p.z + dz)) dz = Math.abs(dz) <= 0.05 ? 0 : dz - Math.sign(dz) * 0.05;
      while (dx !== 0 && dz !== 0 && drop(p.x + dx, p.z + dz)) {
        dx = Math.abs(dx) <= 0.05 ? 0 : dx - Math.sign(dx) * 0.05;
        dz = Math.abs(dz) <= 0.05 ? 0 : dz - Math.sign(dz) * 0.05;
      }
    }
    const reach = Math.max(Math.abs(dx), Math.abs(dz)) + STEP + 1;
    const bx = this.gather(p.x - this.halfW - reach, p.y - reach, p.z - this.halfW - reach, p.x + this.halfW + reach, p.y + this.h + reach, p.z + this.halfW + reach);
    let [mx, my, mz] = this.slide(p.x, p.y, p.z, dx, dy, dz, bx);
    const landed = dy < 0 && my !== dy;
    // blocked sideways while on (or landing on) the ground: try it a step higher
    if ((this.onGround || landed) && !this.flying && (mx !== dx || mz !== dz)) {
      let up = this.clip(bx, 1, STEP, p.x - this.halfW, p.y, p.z - this.halfW, p.x + this.halfW, p.y + this.h, p.z + this.halfW);
      let [sx, , sz] = this.slide(p.x, p.y + up, p.z, dx, 0, dz, bx);
      /* and the game's second try (Entity.collide): lifted only as far as the ceiling over the whole way across allows,
         so a carpet, a slab or a stair's lip under a low lintel still steps up (the full lift hit the lintel, and a doorway
         two blocks high with a carpet in it could not be walked through) */
      const up2 = this.clip(bx, 1, STEP, Math.min(p.x, p.x + dx) - this.halfW, p.y, Math.min(p.z, p.z + dz) - this.halfW, Math.max(p.x, p.x + dx) + this.halfW, p.y + this.h, Math.max(p.z, p.z + dz) + this.halfW);
      if (up2 < up - 1e-9 && up2 > 1e-9) {
        const [tx, , tz] = this.slide(p.x, p.y + up2, p.z, dx, 0, dz, bx);
        if (tx * tx + tz * tz > sx * sx + sz * sz + 1e-9) { sx = tx; sz = tz; up = up2; }
      }
      if (sx * sx + sz * sz > mx * mx + mz * mz + 1e-9) {
        // and back down onto whatever is there
        const down = this.clip(bx, 1, -up, p.x + sx - this.halfW, p.y + up, p.z + sz - this.halfW, p.x + sx + this.halfW, p.y + up + this.h, p.z + sz + this.halfW);
        mx = sx; mz = sz; my = up + down;
        this.stepped = (this.stepped || 0) + my;      // the camera eases up the step
      }
    }
    p.x += mx; p.y += my; p.z += mz;
    this.hCollide = mx !== dx || mz !== dz;
    this.moved[0] = mx; this.moved[1] = my; this.moved[2] = mz;
    // falling: the distance builds while going down (the landing move too, as the game counts it since 1.21.5), and is spent on landing
    if (my < 0) this.fallDistance -= my;
    if (my !== dy) {
      if (dy < 0) {
        this.onGround = true;
        const under = this.under();
        if (this.fallDistance > 0) this.landed = { dist: this.fallDistance, block: under };
        this.fallDistance = 0;
        // slime throws you back up (not sneaking), a bed a little
        if (BLOCKS[under] && BLOCKS[under].name === 'slime_block' && !this.sneaking && this.vel.y < 0) this.vel.y = -this.vel.y;
        else if (isBed(under) && !this.sneaking && this.vel.y < 0) this.vel.y = -this.vel.y * 0.66;
        else this.vel.y = 0;
      } else this.vel.y = 0;
    } else if (dy !== 0) this.onGround = false;
    if (mx !== dx) this.vel.x = 0;
    if (mz !== dz) this.vel.z = 0;
  }
  // the block you are standing on (just under the feet, as the game looks for it)
  under() { return this.w.get(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z)); }
  /* how slippery the ground you move on is: the block half a block under the
     feet, as the game looks for it (so a slab or a carpet laid on ice is as
     slippery as the ice) */
  slip() {
    const b = this.w.get(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.500001), Math.floor(this.pos.z));
    return (BLOCKS[b] && BLOCKS[b].slippery) || 0.6;
  }

  /* ---- fluids ---- */
  /* Where a fluid's surface is in a block (-1e9: no fluid of that kind). A
     source or still water is 8/9 of a block deep, flowing water
     (8 - level)/9, and water with more of it above a whole block. */
  fluidTop(x, y, z, kind) {
    const b = this.w.get(x, y, z);
    if (!isFluid(b, kind)) return -1e9;
    if (isFluid(this.w.get(x, y + 1, z), kind)) return y + 1;
    return y + this.ownHeight(x, y, z);
  }
  ownHeight(x, y, z) {
    const b = this.w.get(x, y, z);
    if (!FLUID[b]) return isWater(b) ? 8 / 9 : 0;
    const m = this.w.meta(x, y, z);
    return ((m & FALLING) ? 8 : 8 - (m & LEVEL)) / 9;
  }
  // how far a fluid's surface is above the bottom of the body (-1: not in it)
  fluidDepth(kind) {
    const p = this.pos;
    const minY = p.y + 0.001;
    let depth = -1;
    for (let y = Math.floor(minY); y <= Math.floor(p.y + this.h - 0.001); y++)
      for (let z = Math.floor(p.z - this.halfW + 0.001); z <= Math.floor(p.z + this.halfW - 0.001); z++)
        for (let x = Math.floor(p.x - this.halfW + 0.001); x <= Math.floor(p.x + this.halfW - 0.001); x++) {
          const top = this.fluidTop(x, y, z, kind);
          if (top >= minY) depth = Math.max(depth, top - minY);
        }
    return depth;
  }
  // the way water runs at a block: towards lower water beside it, or over an edge
  flow(x, y, z, out) {
    const own = this.ownHeight(x, y, z);
    let fx = 0, fz = 0;
    for (const [dx, dz] of DIRS) {
      const b = this.w.get(x + dx, y, z + dz);
      let d = 0;
      if (isWater(b)) { const f = this.ownHeight(x + dx, y, z + dz); if (f > 0) d = own - f; }
      else if (!b || !SOLID[b]) {
        if (isWater(this.w.get(x + dx, y - 1, z + dz))) { const f = this.ownHeight(x + dx, y - 1, z + dz); if (f > 0) d = own - (f - 8 / 9); }
      } else continue;
      fx += dx * d; fz += dz * d;
    }
    const len = Math.hypot(fx, fz);
    out[0] = len > 1e-9 ? fx / len : 0; out[1] = len > 1e-9 ? fz / len : 0;
    return out;
  }
  // moving water pushes whatever is in it (0.014 a tick, averaged over the blocks you are in)
  pushByWater() {
    const p = this.pos, minY = p.y + 0.001, f = this.fl || (this.fl = [0, 0]);
    let sx = 0, sz = 0, n = 0;
    for (let y = Math.floor(minY); y <= Math.floor(p.y + this.h - 0.001); y++)
      for (let z = Math.floor(p.z - this.halfW + 0.001); z <= Math.floor(p.z + this.halfW - 0.001); z++)
        for (let x = Math.floor(p.x - this.halfW + 0.001); x <= Math.floor(p.x + this.halfW - 0.001); x++) {
          if (FLUID[this.w.get(x, y, z)] !== 1) continue;
          const top = this.fluidTop(x, y, z, 1);
          if (top < minY) continue;
          this.flow(x, y, z, f);
          const k = top - minY < 0.4 ? top - minY : 1;
          sx += f[0] * k; sz += f[1] * k; n++;
        }
    if (!n) return;
    sx /= n; sz /= n;
    const len = Math.hypot(sx, sz);
    if (len < 1e-9) return;
    let s = 0.014;
    if (Math.abs(this.vel.x) < 0.003 && Math.abs(this.vel.z) < 0.003 && len * s < 0.0045) s = 0.0045 / len;
    this.vel.x += sx * s; this.vel.z += sz * s;
  }
  // nothing solid and no fluid in the body box moved by (dx, dy, dz): the game's isFree
  freeAt(dx, dy, dz) {
    const p = this.pos;
    const x0 = p.x - this.halfW + dx, y0 = p.y + dy, z0 = p.z - this.halfW + dz, x1 = p.x + this.halfW + dx, y1 = p.y + this.h + dy, z1 = p.z + this.halfW + dz;
    if (this.boxHits(x0, y0, z0, x1, y1, z1)) return false;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
      for (let z = Math.floor(z0); z < Math.ceil(z1); z++)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const b = this.w.get(x, y, z);
          if (FLUID[b] || isWater(b)) return false;
        }
    return true;
  }
  // would the body fit here in a pose? (for standing up from a crouch or a crawl)
  fits(pose) {
    const p = this.pos, h = POSE[pose][0] * this.scale;
    return !this.boxHits(p.x - this.halfW + 1e-4, p.y + 1e-4, p.z - this.halfW + 1e-4, p.x + this.halfW - 1e-4, p.y + h - 1e-4, p.z + this.halfW - 1e-4);
  }
  /* The game's honey slide: in a honey block's cell (its box is a sixteenth in from each side, so you
     can lean into it), off the ground, falling faster than 0.08, no higher than 15/16 of it, and not
     over its top: the fall turns into a slide at 0.05 (what you had across slowed in step) and the
     fall so far is forgotten. The block slid on, or null. */
  honeySlide() {
    const p = this.pos, v = this.vel, r = 0.4375 + this.halfW;
    for (let y = Math.floor(p.y + 1e-7); y <= Math.floor(p.y + this.h - 1e-7); y++)
      for (let z = Math.floor(p.z - this.halfW + 1e-7); z <= Math.floor(p.z + this.halfW - 1e-7); z++)
        for (let x = Math.floor(p.x - this.halfW + 1e-7); x <= Math.floor(p.x + this.halfW - 1e-7); x++) {
          if (this.w.get(x, y, z) !== HONEY || p.y > y + 0.9375 - 1e-7) continue;
          if (!(Math.abs(x + 0.5 - p.x) + 1e-7 > r || Math.abs(z + 0.5 - p.z) + 1e-7 > r)) continue;
          if (v.y < -0.13) { const d = -0.05 / v.y; v.x *= d; v.z *= d; }
          v.y = -0.05;
          this.fallDistance = 0;
          return [x, y, z];
        }
    return null;
  }
  // the blocks the body is inside: cobwebs and the like, and ladders
  insideBlocks() {
    const p = this.pos;
    this.stuck = null;
    for (let y = Math.floor(p.y + 1e-5); y <= Math.floor(p.y + this.h - 1e-5); y++)
      for (let z = Math.floor(p.z - this.halfW + 1e-5); z <= Math.floor(p.z + this.halfW - 1e-5); z++)
        for (let x = Math.floor(p.x - this.halfW + 1e-5); x <= Math.floor(p.x + this.halfW - 1e-5); x++) {
          const st = STUCK.get(this.w.get(x, y, z));
          if (st) this.stuck = st;
        }
    this.climbing = CLIMB.has(this.w.get(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
    // a wall is a ladder you brought with you (Leon Network's Chameleon, as the first Leoncraft's Mecha has it: mcOnWall)
    this.onWallNow = !this.climbing && !!this.wallClimb && !this.flying && !this.gliding && this.onWall();
  }
  // touching a solid block's side (a shade past your own box); barriers only when noBarrierClimb is off (hiders cannot see them)
  onWall() {
    const p = this.pos, r = this.halfW + 0.08;
    for (let y = Math.floor(p.y + 0.1); y <= Math.floor(p.y + this.h - 0.1); y++)
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        const b = this.w.get(Math.floor(p.x + dx), y, Math.floor(p.z + dz));
        if (!b || !SOLID[b]) continue;
        if (this.noBarrierClimb && b === B.barrier) continue;
        return true;
      }
    return false;
  }

  /* Gliding on an elytra, the game's own flight (its fall-flying travel):
     looking down trades height for speed, looking up spends speed on height,
     a tenth of the way each tick towards going where you look, then 0.99 of
     the speed kept across and 0.98 up and down. Returns the speed across
     before the move (for flying into a wall). */
  glide() {
    const v = this.vel, f = -this.pitch;          // (the game's pitch: down is positive)
    const lx = -Math.sin(this.yaw) * Math.cos(f), lz = -Math.cos(this.yaw) * Math.cos(f);
    const d = Math.hypot(lx, lz), e = Math.hypot(v.x, v.z);
    const g = this.effects && this.effects.slow_falling && v.y <= 0 ? 0.01 : 0.08;
    const h = Math.cos(f) * Math.cos(f);
    v.y += g * (-1 + h * 0.75);
    if (v.y < 0 && d > 0) { const i = v.y * -0.1 * h; v.x += lx * i / d; v.y += i; v.z += lz * i / d; }
    if (f < 0 && d > 0) { const i = e * -Math.sin(f) * 0.04; v.x += -lx * i / d; v.y += i * 3.2; v.z += -lz * i / d; }
    if (d > 0) { v.x += (lx / d * e - v.x) * 0.1; v.z += (lz / d * e - v.z) * 0.1; }
    v.x *= 0.99; v.y *= 0.98; v.z *= 0.99;
    return Math.hypot(v.x, v.z);
  }

  /* ---- one tick ---- */
  tick() {
    this.prev.copy(this.pos);
    this.prevWalk = this.walkDist;
    this.oBob = this.bob;
    this.prevEyeH = this.eyeH;
    // the keys as this tick sees them: held now, or pressed since the last tick (a tap shorter than a tick)
    const k0 = this.keys, k = this.tickKeys || (this.tickKeys = {});
    for (const n of ['w', 'a', 's', 'd', ' ', 'shift', 'control']) k[n] = !!k0[n] || this.presses(n) > 0;
    const jumpPresses = this.presses(' '), fwdPresses = this.presses('w');
    // the keys: 0.98 of a step each way, as the game reads them
    let fwd = ((k.w ? 1 : 0) - (k.s ? 1 : 0)) * 0.98, str = ((k.d ? 1 : 0) - (k.a ? 1 : 0)) * 0.98;
    this.sneaking = !!k.shift && !this.flying;
    /* Space twice within 7 ticks starts or stops flying (creative), as the
       game counts it: the first press opens the window, the second, on any
       of the six ticks after, flies. Not while swimming, and a spectator
       is always flying. */
    if (this.canFly && !this.noclip) for (let i = 0; i < jumpPresses; i++) {
      if (this.jumpTrigger === 0) this.jumpTrigger = 7;
      else if (!this.swimming) { this.flying = !this.flying; this.jumpTrigger = 0; }
    }
    if (this.jumpTrigger > 0) this.jumpTrigger--;
    if (this.sprintTrigger > 0) this.sprintTrigger--;
    if (this.noJumpDelay > 0) this.noJumpDelay--;
    // water and lava, measured from their surfaces
    const wasIn = this.inWater;
    this.waterDepth = this.fluidDepth(1); this.lavaDepth = this.fluidDepth(2);
    this.inWater = this.waterDepth >= 0; this.inLava = this.lavaDepth >= 0;
    const ex = Math.floor(this.pos.x), ez = Math.floor(this.pos.z), ey = this.pos.y + this.eyeH;
    this.eyeInWater = this.fluidTop(ex, Math.floor(ey), ez, 1) > ey;
    if (this.inWater) this.fallDistance = 0;
    if (this.inWater && !wasIn && this.vel.y < -0.15) this.splashes.push([this.pos.x, this.pos.z, Math.min(1.6, -this.vel.y * 3), 2.6]);
    /* Crouching slows you on the very tick Shift goes down (and stops on the
       tick it comes up), as in the game: it is worked out here from the key,
       not from last tick's pose. A gap too low to stand in keeps you
       crouched; one too low to crouch in, crawling. */
    const crouching = !this.flying && !this.swimming && this.fits('crouch') && (k.shift || !this.fits('stand'));
    const slowPose = crouching || (this.pose === 'swim' && !this.inWater);
    /* Sprinting stops when you let go of forward, get too hungry, run
       straight into a wall, or wade (not swim). Sneaking, eating or drawing
       a bow slow you but do not stop it (the game went back to that in
       1.21.5); they only keep it from starting, which takes a full step
       forward. survival sets canSprint (hunger above 6) and usingItem. */
    const mayRun = !this.noSprint && this.canSprint !== false;
    const mayStart = mayRun && !this.usingItem && (!slowPose || this.eyeInWater);
    if (fwd <= 0 || !mayRun) this.sprinting = false;
    if (this.hCollide && !this.minorCollide) this.sprinting = false;
    if (this.swimming) { if (!this.inWater) this.sprinting = false; }
    else if (this.inWater && !this.eyeInWater && !this.flying) this.sprinting = false;
    if (k.control && fwd > 0 && mayStart && (!this.inWater || this.eyeInWater || this.flying)) this.sprinting = true;
    // forward twice within 7 ticks, on the ground or under water (the game's double tap)
    if (this.usingItem) this.sprintTrigger = 0;
    for (let i = 0; i < fwdPresses; i++) {
      if (this.sprinting || fwd <= 0 || !mayStart || !(this.onGround || this.eyeInWater)) break;
      if (this.sprintTrigger > 0) this.sprinting = true;
      else this.sprintTrigger = 7;
    }
    // swimming: sprinting under water, and it lasts while you sprint in water
    if (this.flying) this.swimming = false;
    else if (this.swimming) this.swimming = this.sprinting && this.inWater;
    else this.swimming = this.sprinting && this.eyeInWater && isWater(this.w.get(ex, Math.floor(this.pos.y), ez));
    this.insideBlocks();
    if (this.climbing || this.onWallNow || this.stuck || this.flying) this.fallDistance = 0;

    /* The ground as the tick starts decides both the push and the friction
       after the move, as in the game: the tick of a jump still slides like
       the ground (0.546), and the tick you land still glides like the air
       (0.91). */
    const ground0 = this.onGround, slip0 = ground0 ? this.slip() : 1;
    let accel;
    // (flySpeed: 0.05, which a spectator's mouse wheel changes)
    if (this.flying) accel = (this.flySpeed ?? 0.05) * (this.sprinting ? 2 : 1);
    else if (this.inWater || this.inLava) accel = 0.02;
    else if (ground0) {
      const slip = slip0;
      accel = (this.sprinting ? 0.13 : 0.1) * (0.216 / (slip * slip * slip));
      // Speed and Slowness (survival.js effects): +20% and -15% a level
      const fx = this.effects;
      if (fx && (fx.speed || fx.slowness)) accel *= Math.max(0, (1 + 0.2 * (fx.speed ? fx.speed.level : 0)) * (1 - 0.15 * (fx.slowness ? fx.slowness.level : 0)));
    } else accel = this.sprinting ? 0.026 : 0.02;
    if (slowPose) { fwd *= 0.3; str *= 0.3; }
    // eating or drawing a bow: a fifth of the speed
    if (this.usingItem) { fwd *= 0.2; str *= 0.2; }
    // an elytra: a press of Space in the air opens it; the ground, water, flying or a worn-out elytra close it
    if (this.wantGlide) { this.wantGlide = false; if (!this.onGround && !this.flying && !this.inWater && !this.inLava && !this.climbing && !this.riding && !(this.effects && this.effects.levitation) && this.hasElytra && this.hasElytra()) this.gliding = true; }
    if (this.gliding && (this.onGround || this.flying || this.inWater || this.inLava || this.riding || !(this.hasElytra && this.hasElytra()))) this.gliding = false;
    const glideSpeed = this.gliding ? this.glide() : 0;
    // move relative to where you are looking (only round, not up)
    let len = this.gliding ? 0 : Math.hypot(fwd, str);
    if (len > 0.0001) {
      if (len < 1) len = 1;
      const f = fwd / len * accel, s = str / len * accel;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      this.vel.x += -sin * f + cos * s;
      this.vel.z += -cos * f - sin * s;
    }
    // Space and Shift
    const fluidDepth = this.inWater ? this.waterDepth : this.lavaDepth;
    // flying: three times the flying speed (0.05) a tick up or down, so 7.5 blocks a second at full speed
    if (this.flying) {
      // the climb and dive follow the flying speed (a spectator's can be changed)
      const up = 3 * (this.flySpeed ?? 0.05);
      if (k[' ']) this.vel.y += up;
      if (k.shift) this.vel.y -= up;
    } else if (k[' '] && (this.inWater || this.inLava) && (!this.onGround || fluidDepth > 0.4)) {
      this.vel.y += 0.04;                       // swimming up
    } else if (k[' '] && this.onGround && this.noJumpDelay === 0) {
      // a jump, from the ground or from water too shallow to swim in (held, the next one waits 10 ticks)
      const px = Math.floor(this.pos.x), pz = Math.floor(this.pos.z);
      const j = JUMP.get(this.w.get(px, Math.floor(this.pos.y), pz)) || JUMP.get(this.w.get(px, Math.floor(this.pos.y - 0.5), pz)) || 1;
      this.vel.y = Math.max(0.42 * j + (this.effects && this.effects.jump_boost ? 0.1 * this.effects.jump_boost.level : 0), this.vel.y);
      this.jumped = true;           // survival.js takes a jump's exhaustion
      this.noJumpDelay = 10;
      if (this.sprinting) { this.vel.x += -Math.sin(this.yaw) * 0.2; this.vel.z += -Math.cos(this.yaw) * 0.2; }
      this.onGround = false;
    }
    if (!k[' ']) this.noJumpDelay = 0;
    if (this.inWater && k.shift && !this.flying) this.vel.y -= 0.04;
    // swimming follows where you look, up and down
    if (this.swimming) {
      const look = Math.sin(this.pitch), d4 = look < -0.2 ? 0.085 : 0.06;
      if (look <= 0 || k[' '] || isWater(this.w.get(ex, Math.floor(this.pos.y + 0.9), ez))) this.vel.y += (look - this.vel.y) * d4;
    }
    // ladders and vines: slow to slide down them, none at all sneaking
    if (this.climbing && !this.flying) {
      this.vel.x = Math.max(-0.15, Math.min(0.15, this.vel.x));
      this.vel.z = Math.max(-0.15, Math.min(0.15, this.vel.z));
      this.vel.y = Math.max(-0.15, this.vel.y);
      // (but sneaking in scaffolding is how you go down it)
      if (this.vel.y < 0 && this.sneaking && this.w.get(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)) !== SCAFFOLD) this.vel.y = 0;
    }
    // on a wall (Chameleon): jump goes up it at the first Leoncraft's 3.2 blocks a second, Shift in the air comes down at the
    // same pace, and otherwise you hold where you are, still or moving along it, until you come off the wall
    if (this.onWallNow) {
      if (k[' ']) this.vel.y = 0.16;
      // (in the air, by what is under your feet: holding a wall counts as standing for the rest of the game)
      else if (k.shift && !this.boxHits(this.pos.x - this.halfW, this.pos.y - 0.06, this.pos.z - this.halfW, this.pos.x + this.halfW, this.pos.y, this.pos.z + this.halfW)) this.vel.y = -0.16;
      else this.vel.y = Math.max(this.vel.y, 0);
    }
    if (this.inWater && !this.flying) this.pushByWater();
    const was = this.pos.clone(), startY = this.pos.y, vy0 = this.vel.y;
    // inside a cobweb or a bush: only part of the move happens, and the speed is lost
    if (this.stuck && !this.flying) {
      const st = this.stuck;
      this.move(this.vel.x * st[0], this.vel.y * st[1], this.vel.z * st[0]);
      this.vel.set(0, 0, 0);
    } else this.move(this.vel.x, this.vel.y, this.vel.z);
    // a run along a wall at a slant is not a crash into it (the game's 8 degrees)
    this.minorCollide = false;
    if (this.hCollide && len > 0.0001) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const ix = -sin * fwd + cos * str, iz = -cos * fwd - sin * str;
      const mx = this.moved[0], mz = this.moved[2];
      const d4 = ix * ix + iz * iz, d5 = mx * mx + mz * mz;
      if (d4 > 1e-5 && d5 > 1e-5) this.minorCollide = Math.acos(Math.max(-1, Math.min(1, (ix * mx + iz * mz) / Math.sqrt(d4 * d5)))) < 0.13962634;
    }
    // climbing: pushing into the ladder, or Space, goes up
    if (this.climbing && !this.flying && (this.hCollide || k[' '])) this.vel.y = 0.2;
    // pressed into a honey block's side on the way down: a slow, safe slide
    this.slidingOn = !this.flying && !this.onGround && this.vel.y < -0.08 ? this.honeySlide() : null;
    // drag and gravity
    if (this.gliding) {
      // into a wall at speed: the speed lost, times 10, less 3 (survival.js takes it as flying into a wall)
      if (this.hCollide) { const lost = (glideSpeed - Math.hypot(this.vel.x, this.vel.z)) * 10 - 3; if (lost > 0) this.wallHit = (this.wallHit || 0) + lost; }
      // a glide that is not falling fast counts as a fall of 1 (the game's)
      if (this.vel.y > -0.5) this.fallDistance = 1;
      if (this.onGround) this.gliding = false;
    } else if (this.flying) {
      // flying: the air's 0.91 across, and 0.6 of the climb or dive asked for (a ceiling does not take it away)
      this.vel.x *= slip0 * 0.91; this.vel.z *= slip0 * 0.91; this.vel.y = vy0 * 0.6;
      if (this.onGround) this.flying = false;
    } else if (this.inWater) {
      // Dolphin's Grace: hardly any drag across the water
      const f = this.effects && this.effects.dolphins_grace ? 0.96 : this.sprinting ? 0.9 : 0.8;
      this.vel.x *= f; this.vel.y *= 0.8; this.vel.z *= f;
      if (!this.sprinting) this.vel.y -= 0.005;
      // out onto the bank: against a wall with nothing but air 0.6 higher
      if (this.hCollide && this.freeAt(this.vel.x, this.vel.y + 0.6 - this.pos.y + startY, this.vel.z)) this.vel.y = 0.3;
    } else if (this.inLava) {
      if (this.lavaDepth <= 0.4) { this.vel.x *= 0.5; this.vel.y *= 0.8; this.vel.z *= 0.5; this.vel.y -= 0.005; }
      else this.vel.multiplyScalar(0.5);
      this.vel.y -= 0.02;
      if (this.hCollide && this.freeAt(this.vel.x, this.vel.y + 0.6 - this.pos.y + startY, this.vel.z)) this.vel.y = 0.3;
    } else {
      const under = this.under();
      const slip = slip0;            // (the ground as the tick started: see above)
      // Levitation: drawn up towards 0.05 a tick a level; Slow Falling: a tenth of the gravity on the way down
      const lev = this.effects && this.effects.levitation;
      if (lev) this.vel.y = (this.vel.y + (0.05 * lev.level - this.vel.y) * 0.2) * 0.98;
      // (gravityScale: Leonpixel's Moon Boots, net/lobbycos.js; 1 everywhere else)
      else this.vel.y = (this.vel.y - (this.effects && this.effects.slow_falling && this.vel.y < 0 ? 0.01 : 0.08) * (this.gravityScale || 1)) * 0.98;
      this.vel.x *= slip * 0.91; this.vel.z *= slip * 0.91;
      // walking on slime: slowed unless you are bouncing
      if (this.onGround && BLOCKS[under] && BLOCKS[under].name === 'slime_block' && Math.abs(this.vel.y) < 0.1 && !this.sneaking) {
        const d = 0.4 + Math.abs(this.vel.y) * 0.2; this.vel.x *= d; this.vel.z *= d;
      }
    }
    // soul sand and honey keep only part of the speed
    if (!this.flying) {
      const px = Math.floor(this.pos.x), pz = Math.floor(this.pos.z);
      const here = this.w.get(px, Math.floor(this.pos.y), pz);
      const sf = isWater(here) ? 1 : SPEED.get(here) || SPEED.get(this.w.get(px, Math.floor(this.pos.y - 0.500001), pz)) || 1;
      if (sf !== 1) { this.vel.x *= sf; this.vel.z *= sf; }
    }
    /* the view bob follows the speed across the ground, up to 0.1, 0.4 of the way a tick (none in the
       air or swimming): the speed this tick's move left, as the game takes it, so the bob eases off on
       the very tick you stop pushing */
    this.bob += ((this.onGround && !this.flying && !this.swimming ? Math.min(0.1, Math.hypot(this.vel.x, this.vel.z)) : 0) - this.bob) * 0.4;
    // the game drops speeds too small to see
    if (Math.abs(this.vel.x) < 0.003) this.vel.x = 0;
    if (Math.abs(this.vel.y) < 0.003) this.vel.y = 0;
    if (Math.abs(this.vel.z) < 0.003) this.vel.z = 0;
    // the pose for next tick: swimming lies down, sneaking crouches, and a low gap keeps you crawling
    let pose = this.swimming || this.gliding ? 'swim' : this.sneaking ? 'crouch' : 'stand';
    // (a spectator passes through blocks standing up: nothing makes it crouch or crawl)
    if (this.noclip) pose = 'stand';
    /* (and buried, with not even room to crawl, the pose stays as it was, as the game only changes it when
       crawling would fit: it used to lie down, which put the eyes, the camera and the light the model is
       lit by 1.2 deeper in the ground, so out of spectator into the ground your skin went pitch black) */
    else if (!this.fits(pose)) pose = this.fits('crouch') ? 'crouch' : this.fits('swim') ? 'swim' : this.pose || pose;
    this.pose = pose; this.h = POSE[pose][0] * this.scale;
    this.eyeH += (POSE[pose][1] * this.scale - this.eyeH) * 0.5;
    const moved = Math.hypot(this.pos.x - was.x, this.pos.z - was.z);
    if (this.onGround) this.walkDist += moved * 0.6;
    // wading and swimming push ripples out across the water
    if (this.inWater && moved > 0.02 && Math.random() < 0.6) this.splashes.push([this.pos.x, this.pos.z, 0.25 + moved * 1.2, 1.2]);
    // (the void kills in creative too, as in the game: survival.js creativeTick; a spectator flies on down as far as it likes)
    if (!this.canFly) this.flying = false;
    /* The view widens with your speed, as the game works it out: half way
       between walking speed and how fast you could go (sprinting 30% faster
       gives 15% wider, Speed and Slowness count too), 10% more flying,
       scaled by FOV Effects. It eases half way there each tick and is drawn
       between ticks (view), so it never steps. */
    const fx = this.effects;
    let speed = this.sprinting ? 1.3 : 1;
    if (fx && fx.speed) speed *= 1 + 0.2 * fx.speed.level;
    if (fx && fx.slowness) speed *= Math.max(0, 1 - 0.15 * fx.slowness.level);
    const fm = (this.flying ? 1.1 : 1) * (speed + 1) / 2;
    this.prevFovMod = this.fovMod;
    this.fovMod = Math.max(0.1, Math.min(1.5, this.fovMod + (1 + (fm - 1) * this.fovEffects - this.fovMod) * 0.5));
    this.fov = this.baseFov * this.fovMod;
    this.age++;                   // (presses before now are spent)
  }

  /* ---- where the camera is, between ticks ---- */
  view(alpha) {
    const p = this.prev.clone().lerp(this.pos, alpha);
    // (the step's phase runs on from the newest tick rather than between the last two, as the game's does,
    // so the bob stops with the tick you stop on rather than one after)
    const walk = this.walkDist + (this.walkDist - this.prevWalk) * alpha;
    const eye = p.clone();
    eye.y += this.prevEyeH + (this.eyeH - this.prevEyeH) * alpha;
    /* The game's view bob: with each step the world and your hands swing
       across by half the bob and down by all of it (so the eye goes the
       other way, along the view's own right and up), and the hands turn a
       little too: 3 degrees on z and 5 on x at full bob. */
    const h = this.bobbing !== false ? this.oBob + (this.bob - this.oBob) * alpha : 0;
    const s = Math.sin(walk * Math.PI), c = Math.cos(walk * Math.PI);
    const bx = s * h * 0.5, by = Math.abs(c) * h, sp = Math.sin(this.pitch);
    eye.x += Math.cos(this.yaw) * bx + Math.sin(this.yaw) * sp * by;
    eye.y += Math.cos(this.pitch) * by;
    eye.z += -Math.sin(this.yaw) * bx + Math.cos(this.yaw) * sp * by;
    const handBob = { x: -bx, y: -by, rz: -s * h * 3 * Math.PI / 180, rx: Math.abs(Math.cos(walk * Math.PI + 0.2)) * h * 5 * Math.PI / 180 };
    const fov = this.baseFov * (this.prevFovMod + (this.fovMod - this.prevFovMod) * alpha);
    return { feet: p, eye, roll: 0, handBob, fov };
  }

  /* The eyes as the game's own pick sees them: the pose's height over the
     feet as it is now (the camera eases to it, the pick does not) and no view
     bob. alpha 1 is where the last tick left you: the game picks from there
     (pick at a partial tick of 1) before it handles a click, which is what
     lets a god bridge or a telly bridge catch the side of the block under you
     in the tick after you walk off it, before you start to fall. */
  pickEye(alpha = 1) {
    const p = this.pos, q = this.prev, a = alpha >= 1 ? 1 : alpha;
    return { x: q.x + (p.x - q.x) * a, y: q.y + (p.y - q.y) * a + POSE[this.pose || 'stand'][1] * (this.scale || 1), z: q.z + (p.z - q.z) * a };
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
        const r = rayBoxes(eye, dir, x, y, z, selectionBoxes(d, w.meta(x, y, z), nb, x, z));
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
      return boxes.some(c => x + c[3] > p.x - this.halfW && x + c[0] < p.x + this.halfW && z + c[5] > p.z - this.halfW && z + c[2] < p.z + this.halfW && y + c[4] > p.y && y + c[1] < p.y + this.h);
    }
    const p = this.pos;
    return x + 1 > p.x - this.halfW && x < p.x + this.halfW && z + 1 > p.z - this.halfW && z < p.z + this.halfW && y + 1 > p.y && y < p.y + this.h;
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
