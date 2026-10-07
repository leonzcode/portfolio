/* ---------------------------------------------------------------------------
   Leoncraft 2 - lit TNT and falling blocks: blocks that move.

   Primed TNT (the game's PrimedTnt): starts at the block's centre with 0.2
   upwards and a nudge of 0.02 a random way, falls by 0.04 a tick, keeps 98%
   of its speed each tick (70% sideways and bouncing back at half speed off
   the ground), flashes white every other 5 ticks, swells in its last 10, and
   after its fuse (80 ticks when lit by hand or fire or redstone, 10-29 when a
   blast lights it) explodes with power 4, a sixteenth of a block above its
   feet. Pushed about by other explosions.

   Falling blocks (sand, gravel, concrete powder, anvils...): a block with
   nothing under it is looked at 2 ticks later and, still unsupported, falls
   the same way, landing as the block again (or dropping as an item where it
   cannot stand).

   Drawn with the block's own model and the held-block material, so they take
   the same light and fog as the world.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=24';
import { blockGeometry } from '../render/blockmesh.js?v=24';
const THREE = window.THREE;

const W = 0.98, HT = 0.98;
export class Bodies {
  constructor(sim) {
    this.sim = sim;
    this.list = [];
    this.group = new THREE.Group();
    const r = sim.renderer;
    if (r && r.scene) r.scene.add(this.group);
    this.geo = new Map();
    this.white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    sim.primeTnt = (x, y, z, by, fuse) => this.prime(x, y, z, by, fuse);
    // things that fall
    const self = this;
    for (const d of BLOCKS) if (d && (d.falls || /_concrete_powder$/.test(d.name) || /anvil$/.test(d.name) || d.name === 'dragon_egg')) {
      sim.on(d.id, {
        onPlace(s, x, y, z) { s.schedule(x, y, z, 2); },
        neighbor(s, x, y, z) { s.schedule(x, y, z, 2); },
        tick(s, x, y, z, m) { if (y > 0 && self.free(x, y - 1, z)) self.fall(x, y, z, d.id, m); },
      });
    }
    // drawn between ticks, on the screen's own clock
    this.lastTick = performance.now();
    const frame = () => {
      if (this.dead) return;
      if (this.list.length) this.frame(Math.min(1, (performance.now() - this.lastTick) / 50));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  dispose() {
    this.dead = true;
    for (const e of this.list) this.drop(e);
    this.list = [];
    if (this.group.parent) this.group.parent.remove(this.group);
  }
  // can a falling block pass through this cell?
  free(x, y, z) {
    const b = this.sim.get(x, y, z);
    if (!b) return true;
    const d = BLOCKS[b];
    return !!FLUID[b] || d.name === 'fire' || d.name === 'soul_fire' || (d.replaceable && !d.solid);
  }

  /* ---- making them ---- */
  prime(x, y, z, by, fuse) {
    const a = Math.random() * Math.PI * 2;
    const e = this.add({ kind: 'tnt', b: B.tnt, m: 0, x: x + 0.5, y, z: z + 0.5, vx: -Math.sin(a) * 0.02, vy: 0.2, vz: -Math.cos(a) * 0.02, fuse: fuse === undefined ? 80 : fuse, by });
    return e;
  }
  fall(x, y, z, b, m) {
    b = b || this.sim.get(x, y, z);
    m = m === undefined ? this.sim.meta(x, y, z) : m;
    this.sim.set(x, y, z, 0, 0);
    return this.add({ kind: 'falling', b, m, x: x + 0.5, y, z: z + 0.5, vx: 0, vy: 0, vz: 0, time: 0 });
  }
  add(e) {
    e.px = e.x; e.py = e.y; e.pz = e.z; e.onGround = false;
    e.vel = { get x() { return e.vx; }, set x(v) { e.vx = v; }, get y() { return e.vy; }, set y(v) { e.vy = v; }, get z() { return e.vz; }, set z(v) { e.vz = v; } };
    e.box = () => [e.x - W / 2, e.y, e.z - W / 2, e.x + W / 2, e.y + HT, e.z + W / 2];
    e.push = (vx, vy, vz) => { e.vx += vx; e.vy += vy; e.vz += vz; };
    this.list.push(e);
    this.mesh(e);
    return e;
  }
  mesh(e) {
    const r = this.sim.renderer;
    if (!r || !r.mats) return;
    let g = this.geo.get(e.b * 256 + e.m);
    if (!g) {
      try { g = blockGeometry(BLOCKS[e.b], e.m); } catch (err) { return; }
      this.geo.set(e.b * 256 + e.m, g);
    }
    const m = new THREE.Mesh(g.geometry, this.material(r, g.cutout));
    m.frustumCulled = false;
    m.scale.setScalar(1);
    e.obj = new THREE.Group();
    e.obj.add(m);
    if (e.kind === 'tnt') {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.white);
      w.position.y = 0.5; w.visible = false;
      e.flash = w;
      e.obj.add(w);
    }
    // blockmesh.js centres the block on the origin, lifted by one: put its feet at the body's feet
    m.position.set(0, -0.5, 0);
    this.group.add(e.obj);
  }
  // the held-block material, but tested against the world's depth like any block
  material(r, cutout) {
    const k = cutout ? 'c' : 'o';
    this.mats = this.mats || {};
    if (this.mats[k]) return this.mats[k];
    const src = cutout ? r.mats.handCutout : r.mats.handOpaque;
    const m = new src.constructor({ uniforms: src.uniforms, vertexShader: src.vertexShader, fragmentShader: src.fragmentShader,
      defines: Object.assign({}, src.defines), glslVersion: src.glslVersion, side: src.side, transparent: src.transparent });
    m.depthFunc = THREE.LessEqualDepth; m.depthTest = true; m.depthWrite = true;
    return (this.mats[k] = m);
  }
  drop(e) { if (e.obj && e.obj.parent) e.obj.parent.remove(e.obj); e.obj = null; }

  /* ---- each tick ---- */
  tick() {
    this.lastTick = performance.now();
    if (!this.list.length) return;
    for (const e of this.list.slice()) {
      e.px = e.x; e.py = e.y; e.pz = e.z;
      if (!this.sim.w.loaded(e.x, e.z)) continue;
      e.vy -= 0.04;
      this.move(e);
      e.vx *= 0.98; e.vy *= 0.98; e.vz *= 0.98;
      if (e.onGround) { e.vx *= 0.7; e.vz *= 0.7; if (e.kind === 'tnt') e.vy *= -0.5; }
      if (e.kind === 'tnt') {
        e.fuse--;
        if (e.fuse <= 0) { e.dead = true; this.drop(e); this.sim.explode(e.x, e.y + HT / 16, e.z, 4, { source: e, decay: false }); }
      } else {
        e.time++;
        if (e.onGround) { e.dead = true; this.land(e); }
        else if (e.time > 600 || e.y < -10) { e.dead = true; this.drop(e); }
      }
    }
    this.list = this.list.filter(e => !e.dead);
  }
  land(e) {
    const x = Math.floor(e.x), y = Math.floor(e.y + 0.01), z = Math.floor(e.z);
    this.drop(e);
    const here = this.sim.get(x, y, z);
    if (this.free(x, y, z) && !(here && FLUID[here] === 2)) {
      this.sim.set(x, y, z, e.b, e.m);
      if (this.sim.fluids) this.sim.fluids.around(x, y, z);
    } else this.sim.dropItem(e.x, e.y + 0.5, e.z, BLOCKS[e.b].name, 1);
  }
  // move with collision against solid blocks, an axis at a time
  move(e) {
    const w = this.sim.w;
    const solid = (x, y, z) => { const b = w.get(x, y, z); return b && BLOCKS[b].solid && !(BLOCKS[b].shape === 'cross'); };
    const hits = (x0, y0, z0, x1, y1, z1) => {
      for (let x = Math.floor(x0); x <= Math.floor(x1 - 1e-7); x++) for (let y = Math.floor(y0); y <= Math.floor(y1 - 1e-7); y++)
        for (let z = Math.floor(z0); z <= Math.floor(z1 - 1e-7); z++) if (solid(x, y, z)) return true;
      return false;
    };
    const h = W / 2;
    e.onGround = false;
    // y
    let ny = e.y + e.vy;
    if (hits(e.x - h, ny, e.z - h, e.x + h, ny + HT, e.z + h)) {
      if (e.vy < 0) { ny = Math.floor(ny) + 1; e.onGround = true; if (hits(e.x - h, ny, e.z - h, e.x + h, ny + HT, e.z + h)) ny = e.y; }
      else ny = e.y;
      if (e.kind !== 'tnt' || !e.onGround) e.vy = 0;
    }
    e.y = ny;
    let nx = e.x + e.vx;
    if (hits(nx - h, e.y, e.z - h, nx + h, e.y + HT, e.z + h)) { nx = e.x; e.vx = 0; }
    e.x = nx;
    let nz = e.z + e.vz;
    if (hits(e.x - h, e.y, nz - h, e.x + h, e.y + HT, nz + h)) { nz = e.z; e.vz = 0; }
    e.z = nz;
  }
  // each frame: where they are drawn, between this tick and the last
  frame(alpha) {
    for (const e of this.list) {
      if (!e.obj) continue;
      e.obj.position.set(e.px + (e.x - e.px) * alpha, e.py + (e.y - e.py) * alpha, e.pz + (e.z - e.pz) * alpha);
      if (e.kind === 'tnt') {
        const f = e.fuse - alpha + 1;
        let s = 1;
        if (f < 10) { const k = 1 - f / 10; s = 1 + k * k * k * k * 0.3; }
        e.obj.scale.setScalar(s);
        if (e.flash) e.flash.visible = Math.floor(e.fuse / 5) % 2 === 0;
      }
    }
  }
  toJSON() { return this.list.map(e => [e.kind, e.b, e.m, +e.x.toFixed(3), +e.y.toFixed(3), +e.z.toFixed(3), e.fuse || 0]); }
  fromJSON(a) {
    for (const [kind, b, m, x, y, z, fuse] of a || []) {
      if (kind === 'tnt') this.add({ kind, b, m, x, y, z, vx: 0, vy: 0, vz: 0, fuse });
      else this.add({ kind, b, m, x, y, z, vx: 0, vy: 0, vz: 0, time: 0 });
    }
  }
}
