/* ---------------------------------------------------------------------------
   Leoncraft 2 - conduits (Minecraft Wiki, Conduit; Java Edition).

   Every 40 ticks a conduit looks round itself: the 26 cells about it must all
   be water, and its frame is whatever prismarine, prismarine bricks, dark
   prismarine and sea lanterns stand in the three 5 x 5 rings round it (one
   about each axis, 42 places). With 16 or more it is active: Conduit Power
   (13 seconds) on a player in the water within 16 blocks for every 7 of the
   frame, and with all 42 it hunts the nearest hostile mob within 8 blocks,
   4 damage every 2 seconds while the mob is in water.

   Inactive it is the closed shell (its block model). Active the shell opens:
   the cage (a cube half a block across) turns slowly about a slanted axis
   and bobs, the eye in the middle always looks at you, open while it hunts
   and shut otherwise, the current wraps round it, and now and then a light
   drifts in from a block of its frame. The cage, shell and eyes are
   Pixel Perfection Legacy's (textures/conduit/, CC BY-SA 4.0); the current
   is drawn here.

   Conduits are only ever put there by a player, so they are in the world's
   edits: those of the columns in sight are looked over once a second.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
const THREE = window.THREE;

const CONDUIT = B.conduit, WET = B.lc2_wet_conduit;
const isConduit = b => b === CONDUIT || (b === WET && WET !== undefined);
const FRAME = new Set(['prismarine', 'prismarine_bricks', 'dark_prismarine', 'sea_lantern'].map(n => B[n]).filter(v => v !== undefined));
// the 42 places of the frame: one coordinate 0, the furthest of the other two 2 away
const RING = [];
for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) {
  const a = Math.abs(x), b = Math.abs(y), c = Math.abs(z);
  if ((a === 0 && Math.max(b, c) === 2) || (b === 0 && Math.max(a, c) === 2) || (c === 0 && Math.max(a, b) === 2)) RING.push([x, y, z]);
}
const watery = b => FLUID[b] === 1 || (BLOCKS[b] && BLOCKS[b].waterlogged);

const TEX = {};
function tex(name) {
  if (TEX[name]) return TEX[name];
  const t = new THREE.TextureLoader().load(new URL('../../textures/conduit/' + name + '.png?v=107', import.meta.url).href);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return (TEX[name] = t);
}
// the current: faint streaks of water round the conduit, drawn here (a canvas of four rows that scroll)
let WIND = null;
function windTexture() {
  if (WIND) return WIND;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rnd() * 32), y = Math.floor(rnd() * 32), len = 3 + Math.floor(rnd() * 7);
    g.fillStyle = 'rgba(' + (190 + Math.floor(rnd() * 50)) + ',' + (225 + Math.floor(rnd() * 30)) + ',255,' + (0.35 + rnd() * 0.4).toFixed(2) + ')';
    g.fillRect(x, y, len, 1);
    if (x + len > 32) g.fillRect(0, y, x + len - 32, 1);
  }
  WIND = new THREE.CanvasTexture(c);
  WIND.magFilter = THREE.NearestFilter; WIND.minFilter = THREE.NearestFilter; WIND.generateMipmaps = false;
  WIND.wrapS = WIND.wrapT = THREE.RepeatWrapping;
  return WIND;
}
// a cube s blocks across with the game's box unwrap of a w-pixel cube at (0, 0) of a picture tw x th
function boxGeo(s, w, tw, th) {
  const g = new THREE.BoxGeometry(s, s, s), uv = g.attributes.uv, U = (u, v) => [u / tw, 1 - v / th];
  // three.js face order: +x, -x, +y, -y, +z, -z; each four corners (top left, top right, bottom left, bottom right)
  const rect = [[2 * w, w, 3 * w, 2 * w], [0, w, w, 2 * w], [w, 0, 2 * w, w], [2 * w, 0, 3 * w, w], [w, w, 2 * w, 2 * w], [3 * w, w, 4 * w, 2 * w]];
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = rect[f];
    const c = [U(u0, v0), U(u1, v0), U(u0, v1), U(u1, v1)];
    for (let k = 0; k < 4; k++) uv.setXY(f * 4 + k, c[k][0], c[k][1]);
  }
  return g;
}
const AXIS = new THREE.Vector3(0.5, 1, 0.5).normalize();

export class Conduits {
  constructor(sim) {
    this.sim = sim;
    this.w = sim.world;
    this.list = new Map();         // "x,y,z" -> { x, y, z, frame, active, hunting, target, group, parts }
    this.group = new THREE.Group();
    const r = sim.renderer;
    if (r && r.scene) r.scene.add(this.group);
    this.n = 0;
    this.q = new THREE.Quaternion(); this.v = new THREE.Vector3();
    (sim.tickers || (sim.tickers = [])).push(() => this.tick());
    const frame = () => {
      if (this.dead) return;
      if (this.group.children.length) this.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  dispose() {
    this.dead = true;
    for (const k of [...this.list.keys()]) this.remove(k);
    if (this.group.parent) this.group.parent.remove(this.group);
  }
  // the conduits in the world's edits round the player (once a second)
  scan() {
    const P = this.sim.player, r = this.sim.renderer;
    if (!P || CONDUIT === undefined) return;
    const R = (r && r.opts && r.opts.renderDist || 10) + 1, pcx = Math.floor(P.pos.x / 16), pcz = Math.floor(P.pos.z / 16);
    const seen = new Set();
    for (const [k, ed] of this.w.edits) {
      const comma = k.indexOf(','), cx = +k.slice(0, comma), cz = +k.slice(comma + 1);
      if (Math.abs(cx - pcx) > R || Math.abs(cz - pcz) > R || !this.w.loaded(cx * 16, cz * 16)) continue;
      for (const [i, v] of ed) {
        if (!isConduit(v >> 8)) continue;
        const y = i >> 8, z = cz * 16 + ((i >> 4) & 15), x = cx * 16 + (i & 15);
        if (!isConduit(this.w.get(x, y, z))) continue;
        const key = x + ',' + y + ',' + z;
        seen.add(key);
        if (!this.list.has(key)) this.list.set(key, { key, x, y, z, frame: 0, active: false, hunting: false, target: null, group: null, t: Math.random() * 100, frames: [] });
      }
    }
    for (const k of [...this.list.keys()]) if (!seen.has(k)) this.remove(k);
  }
  remove(k) {
    const c = this.list.get(k);
    if (!c) return;
    this.show(c, false);
    this.list.delete(k);
  }
  // the 40-tick look round: the water, the frame, and what an active one does
  check(c) {
    const w = this.w, { x, y, z } = c;
    let water = true;
    for (let dx = -1; dx <= 1 && water; dx++) for (let dy = -1; dy <= 1 && water; dy++) for (let dz = -1; dz <= 1 && water; dz++) {
      if ((dx || dy || dz) && !watery(w.get(x + dx, y + dy, z + dz))) water = false;
    }
    c.frames = [];
    if (water) for (const [dx, dy, dz] of RING) if (FRAME.has(w.get(x + dx, y + dy, z + dz))) c.frames.push([x + dx, y + dy, z + dz]);
    c.frame = c.frames.length;
    const was = c.active;
    c.active = water && c.frame >= 16;
    if (c.active !== was && this.sim.onSound) this.sim.onSound(c.active ? 'block.conduit.activate' : 'block.conduit.deactivate', x, y, z);
    this.show(c, c.active);
    if (!c.active) { c.hunting = false; c.target = null; return; }
    // Conduit Power on the player in the water within range
    const g = this.sim.game, P = this.sim.player, range = Math.floor(c.frame / 7) * 16;
    if (P && P.inWater && (P.pos.x - x - 0.5) ** 2 + (P.pos.y - y - 0.5) ** 2 + (P.pos.z - z - 0.5) ** 2 <= range * range && g && g.survival && g.survival.addEffect) g.survival.addEffect('conduit_power', 1, 260);
    // a full frame hunts: the nearest hostile mob within 8 blocks, hurt while it is in the water
    c.hunting = c.frame >= 42;
    c.target = null;
    const E = g && g.entities;
    if (c.hunting && E && E.forNear) {
      let best = null, bd = 64;
      E.forNear(x + 0.5, z + 0.5, 8, e => {
        if (e.removed || !e.constructor.HOSTILE || !e.alive || !e.alive()) return;
        const d = (e.pos.x - x - 0.5) ** 2 + (e.pos.y - y - 0.5) ** 2 + (e.pos.z - z - 0.5) ** 2;
        if (d < bd) { bd = d; best = e; }
      });
      c.target = best;
      if (best && best.inWater) { best.hurt(4, { type: 'magic', x: x + 0.5, z: z + 0.5, noKnock: true }); if (this.sim.onSound) this.sim.onSound('block.conduit.attack.target', x, y, z); }
    }
  }
  tick() {
    if (++this.n % 20 === 1) this.scan();
    for (const c of this.list.values()) {
      if ((this.n + c.x + c.z) % 40 === 0) this.check(c);
      c.prevT = c.t; c.t++;
      // now and then a light drifts in from one of its frame blocks
      if (c.active && c.frames.length && Math.random() < 0.5) {
        const [fx, fy, fz] = c.frames[(Math.random() * c.frames.length) | 0], P = this.sim.renderer && this.sim.renderer.particles;
        if (P && P.spawn) {
          const sx = fx + 0.5 + (Math.random() - 0.5), sy = fy + 0.5 + (Math.random() - 0.5), sz = fz + 0.5 + (Math.random() - 0.5), life = 20 + ((Math.random() * 10) | 0);
          P.spawn(sx, sy, sz, (c.x + 0.5 - sx) / life, (c.y + 0.5 - sy) / life, (c.z + 0.5 - sz) / life, { colour: 0xbfeef0, size: 0.06, life, gravity: 0, friction: 1, physics: false });
        }
      }
    }
    this.lastTick = performance.now();
  }
  // the moving parts of an active one; the block's own shell is left out of its mesh while they show
  show(c, on) {
    if (on && !c.group) {
      const r = this.sim.renderer;
      if (!r || !r.scene) return;
      const G = new THREE.Group();
      G.position.set(c.x + 0.5, c.y + 0.5, c.z + 0.5);
      const mat = (map, extra) => new THREE.MeshBasicMaterial(Object.assign({ map, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, fog: false }, extra || {}));
      const cage = new THREE.Mesh(boxGeo(0.5, 8, 32, 16), mat(tex('cage')));
      const wind = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat(windTexture(), { alphaTest: 0, depthWrite: false, opacity: 0.6 }));
      const inner = new THREE.Mesh(new THREE.BoxGeometry(0.875, 0.875, 0.875), mat(windTexture(), { alphaTest: 0, depthWrite: false, opacity: 0.45 }));
      const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), [mat(tex('closed_eye')), mat(tex('open_eye'))][0]);
      eye.userData.mats = [eye.material, mat(tex('open_eye'))];
      G.add(cage, wind, inner, eye);
      this.group.add(G);
      c.group = G; c.parts = { cage, wind, inner, eye };
      this.w.setMoving(c.x, c.y, c.z, true);
    } else if (!on && c.group) {
      this.group.remove(c.group);
      c.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      if (c.parts) { const m = c.parts.eye.userData.mats; if (m) m.forEach(x => x.dispose()); }
      c.group = null; c.parts = null;
      this.w.setMoving(c.x, c.y, c.z, false);
    }
  }
  // each frame: the cage turning and bobbing, the eye facing the camera, the current
  frame() {
    const a = Math.min(1, (performance.now() - (this.lastTick || performance.now())) / 50), r = this.sim.renderer, cam = r && r.camera;
    const time = this.sim.game ? ((this.sim.game.time % 24000) + 24000) % 24000 : 6000;
    const day = Math.min(1, Math.max(0.2, 0.5 + 2 * Math.cos(2 * Math.PI * (time / 24000 - 0.25))));
    for (const c of this.list.values()) {
      if (!c.group) continue;
      const t = (c.prevT === undefined ? c.t : c.prevT + (c.t - c.prevT) * a), P = c.parts;
      // bobbing up and down, a little over three seconds a time
      let h = Math.sin(t * 0.1) / 2 + 0.5; h = h * h + h;
      P.cage.position.set(0, -0.2 + h * 0.2, 0);
      P.cage.quaternion.setFromAxisAngle(AXIS, -t * 2.25 * Math.PI / 180);
      P.eye.position.copy(P.cage.position);
      if (cam) P.eye.quaternion.copy(cam.quaternion);
      P.eye.material = P.eye.userData.mats[c.target ? 1 : 0];
      // the current turns from one axis to another every 66 ticks
      const k = Math.floor(t / 66) % 3;
      P.wind.rotation.set(k === 1 ? Math.PI / 2 : 0, 0, k === 2 ? Math.PI / 2 : 0);
      P.inner.rotation.set(Math.PI, 0, Math.PI);
      const W = windTexture();
      W.offset.y = (t * 0.02) % 1;
      // as bright as the light where it is
      const l = this.light(c, day);
      for (const m of [P.cage.material, P.eye.material]) m.color.setRGB(l, l, l);
      c.group.updateMatrixWorld(true);
    }
  }
  light(c, day) {
    const ch = this.w.chunkAt(c.x, c.z);
    let s = 15, bl = 0;
    if (ch && ch.light && c.y >= 0 && c.y < ch.lightH) { const v = ch.light[(c.y << 8) | ((c.z - ch.cz * 16) << 4) | (c.x - ch.cx * 16)]; s = v >> 4; bl = v & 15; }
    const v = Math.max(s * day, bl) / 15;
    return 0.15 + 0.85 * v * v;
  }
}
