/* ---------------------------------------------------------------------------
   Leoncraft 2 - beacon beams, as the game draws them.

   A beacon on a pyramid (at least the 3 x 3 layer of iron, gold, emerald,
   diamond or netherite blocks under it) with nothing solid over it sends a
   beam to the top of the world: an inner beam 0.4 of a block across, turning
   2.25 degrees a tick, its picture running up it 2.5 times a block, and a
   fainter glow round it 0.5 across. Stained glass (or a stained glass pane)
   in its way colours it from there up: the first one its own colour, every
   one after that the average of the beam so far and its own.

   Beacons are only ever put there by a player, so they are in the world's
   edits: those of the columns in sight are looked over once a second.
   The beam's picture is Pixel Perfection CE's (textures/beacon_beam.png).

   End gateways send a beam too (Minecraft Wiki, End Gateway): up and down
   from the gateway at once, growing and shrinking on a half sine. A new one
   (made when the dragon dies, or at the far end of a trip) shines magenta
   for 10 seconds, as tall as the world; after that a purple one, 50 blocks
   at its tallest, for 2 seconds every 2400 ticks and whenever something
   goes through it. Its picture is that pack's end gateway beam. Gateways
   are made by the game, so they are in the edits as well.
--------------------------------------------------------------------------- */
import { B, OPACITY } from '../blocks.js?v=107';
import { H } from '../world-const.js?v=107';
const THREE = window.THREE;

const BEACON = B.beacon, GATEWAY = B.end_gateway;
const MAGENTA = [0xC7 / 255, 0x4E / 255, 0xBD / 255], PURPLE = [0x89 / 255, 0x32 / 255, 0xB8 / 255];
const BASE = new Set(['iron_block', 'gold_block', 'emerald_block', 'diamond_block', 'netherite_block'].map(n => B[n]).filter(v => v !== undefined));
// the dyes' colours (the game's DyeColor), for the glass
const DYE = { white: 0xF9FFFE, orange: 0xF9801D, magenta: 0xC74EBD, light_blue: 0x3AB3DA, yellow: 0xFED83D, lime: 0x80C71F, pink: 0xF38BAA,
  gray: 0x474F52, light_gray: 0x9D9D97, cyan: 0x169C9C, purple: 0x8932B8, blue: 0x3C44AA, brown: 0x835432, green: 0x5E7C16, red: 0xB02E26, black: 0x1D1D21 };
const GLASS = new Map();
for (const [c, hex] of Object.entries(DYE)) for (const n of [c + '_stained_glass', c + '_stained_glass_pane'])
  if (B[n] !== undefined) GLASS.set(B[n], [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);

let TEX = null, GTEX = null;
const loadBeam = f => {
  const t = new THREE.TextureLoader().load(new URL('../../textures/' + f + '?v=107', import.meta.url).href);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  return t;
};
function beamTexture() { return TEX || (TEX = loadBeam('beacon_beam.png')); }
function gatewayTexture() { return GTEX || (GTEX = loadBeam('end_gateway_beam.png')); }
// four sides of a square column r from its middle, y0 to y1, the picture repeating `per` times a block up it
function column(r, y0, y1, per) {
  const P = [], U = [], I = [];
  const c = [[-r, -r], [r, -r], [r, r], [-r, r]];
  for (let s = 0; s < 4; s++) {
    const [ax, az] = c[s], [bx, bz] = c[(s + 1) & 3], k = P.length / 3;
    P.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    U.push(0, 0, 1, 0, 1, (y1 - y0) * per, 0, (y1 - y0) * per);
    I.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  return g;
}

export class Beams {
  constructor(sim) {
    this.sim = sim;
    this.w = sim.world;
    this.list = new Map();        // "x,y,z" -> { key, group, sig }
    this.gates = new Map();       // "x,y,z" -> { x, y, z, age (ticks since it was made, to 200), cool (ticks into a flash, or -1), group }
    this.group = new THREE.Group();
    const r = sim.renderer;
    if (r && r.scene) r.scene.add(this.group);
    this.n = 0;
    (sim.tickers || (sim.tickers = [])).push(() => { if (++this.n % 20 === 1) this.scan(); if (this.gates.size) this.gateTick(); });
    // a gateway made now: its magenta beam (sim.js onSet calls onPlace when a block appears)
    if (GATEWAY !== undefined) sim.on(GATEWAY, { onPlace: (s, x, y, z) => this.gateway(x, y, z, true) });
    const frame = () => {
      if (this.dead) return;
      if (this.list.size || this.gates.size) this.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  dispose() {
    this.dead = true;
    for (const k of [...this.list.keys()]) this.remove(k);
    for (const g of this.gates.values()) this.gateMesh(g, 0, null);
    if (this.group.parent) this.group.parent.remove(this.group);
  }
  scan() {
    const P = this.sim.player, r = this.sim.renderer;
    if (!P || BEACON === undefined) return;
    const R = (r && r.opts && r.opts.renderDist || 10) + 1, pcx = Math.floor(P.pos.x / 16), pcz = Math.floor(P.pos.z / 16);
    const seen = new Set();
    for (const [k, ed] of this.w.edits) {
      const comma = k.indexOf(','), cx = +k.slice(0, comma), cz = +k.slice(comma + 1);
      if (Math.abs(cx - pcx) > R || Math.abs(cz - pcz) > R || !this.w.loaded(cx * 16, cz * 16)) continue;
      for (const [i, v] of ed) {
        if ((v >> 8) === GATEWAY && GATEWAY !== undefined) {
          const y = i >> 8, z = cz * 16 + ((i >> 4) & 15), x = cx * 16 + (i & 15);
          if (this.w.get(x, y, z) === GATEWAY) { seen.add('g' + x + ',' + y + ',' + z); this.gateway(x, y, z, false); }
          continue;
        }
        if ((v >> 8) !== BEACON) continue;
        const y = i >> 8, z = cz * 16 + ((i >> 4) & 15), x = cx * 16 + (i & 15);
        if (this.w.get(x, y, z) !== BEACON) continue;
        const key = x + ',' + y + ',' + z;
        seen.add(key);
        this.update(key, x, y, z);
      }
    }
    for (const k of [...this.list.keys()]) if (!seen.has(k)) this.remove(k);
    for (const [k, g] of this.gates) if (!seen.has('g' + k)) { this.gateMesh(g, 0, null); this.gates.delete(k); }
  }
  /* ---- end gateways ---- */
  gateway(x, y, z, fresh) {
    const k = x + ',' + y + ',' + z;
    let g = this.gates.get(k);
    if (!g) { g = { x, y, z, age: fresh ? 0 : 200, cool: -1, group: null, h: -1 }; this.gates.set(k, g); }
    else if (fresh) { g.age = 0; g.cool = -1; }
  }
  // something went through a gateway (dim/realms.js): its purple flash
  gatewayUsed(x, y, z) { this.gateway(x, y, z, false); const g = this.gates.get(x + ',' + y + ',' + z); if (g && g.age >= 200) g.cool = 0; }
  gateTick() {
    for (const [k, g] of this.gates) {
      if (this.w.get(g.x, g.y, g.z) !== GATEWAY) { this.gateMesh(g, 0, null); this.gates.delete(k); continue; }
      let h = 0, colour = null;
      if (g.age < 200) { g.age++; h = Math.floor(Math.sin(Math.PI * g.age / 200) * H); colour = MAGENTA; }
      else {
        // every 2400 ticks, and after something went through: 40 ticks of purple
        if (g.cool < 0 && this.sim.n % 2400 === 0) g.cool = 0;
        if (g.cool >= 0) { g.cool++; h = Math.floor(Math.sin(Math.PI * Math.min(1, g.cool / 40)) * 50); colour = PURPLE; if (g.cool >= 40) g.cool = -1; }
      }
      this.gateMesh(g, h, colour);
    }
  }
  // the beam h blocks up and h down from the gateway (none when h is 0), rebuilt when its height changes
  gateMesh(g, h, colour) {
    if (h === g.h) return;
    g.h = h;
    if (g.group) { this.group.remove(g.group); g.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); g.group = null; }
    if (!h || !colour) return;
    const G = new THREE.Group(), inner = new THREE.Group(), tex = gatewayTexture(), c = new THREE.Color(colour[0], colour[1], colour[2]);
    G.position.set(g.x + 0.5, 0, g.z + 0.5);
    G.add(inner);
    for (const [y0, y1] of [[g.y + 1, g.y + 1 + h], [g.y - h, g.y]]) {
      const a = new THREE.Mesh(column(0.2, y0, y1, 2.5), new THREE.MeshBasicMaterial({ map: tex, color: c, alphaTest: 0.5, side: THREE.DoubleSide, fog: false }));
      const b = new THREE.Mesh(column(0.25, y0, y1, 2), new THREE.MeshBasicMaterial({ map: tex, color: c, transparent: true, opacity: 0.125, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      a.frustumCulled = b.frustumCulled = false;
      inner.add(a); G.add(b);
    }
    this.group.add(G);
    g.group = G; g.inner = inner;
  }
  // the beam's colours from the beacon up (or null: no pyramid, or something solid over it)
  segments(x, y, z) {
    const W = this.w;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!BASE.has(W.get(x + dx, y - 1, z + dz))) return null;
    const out = [{ y0: y + 1, c: [1, 1, 1] }];
    let colour = null;
    for (let yy = y + 1; yy < H; yy++) {
      const b = W.get(x, yy, z);
      if (!b) continue;
      const g = GLASS.get(b);
      if (g) {
        colour = colour ? colour.map((v, k) => (v + g[k]) / 2) : g.slice();
        out.push({ y0: yy, c: colour });
        continue;
      }
      if (OPACITY[b] >= 15 && b !== B.bedrock) return null;
    }
    return out;
  }
  update(key, x, y, z) {
    const segs = this.segments(x, y, z);
    if (!segs) { this.remove(key); return; }
    const sig = segs.map(s => s.y0 + ':' + s.c.map(v => v.toFixed(3)).join('/')).join(' ');
    const e = this.list.get(key);
    if (e && e.sig === sig) return;
    if (e) this.remove(key);
    const g = new THREE.Group();
    g.position.set(x + 0.5, 0, z + 0.5);
    const inner = new THREE.Group();
    g.add(inner);
    const tex = beamTexture();
    segs.forEach((s, i) => {
      const y1 = i + 1 < segs.length ? segs[i + 1].y0 : H, colour = new THREE.Color(s.c[0], s.c[1], s.c[2]);
      const a = new THREE.Mesh(column(0.2, s.y0, y1, 2.5), new THREE.MeshBasicMaterial({ map: tex, color: colour, alphaTest: 0.5, side: THREE.DoubleSide, fog: false }));
      const b = new THREE.Mesh(column(0.25, s.y0, y1, 2), new THREE.MeshBasicMaterial({ map: tex, color: colour, transparent: true, opacity: 0.125, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      a.frustumCulled = b.frustumCulled = false;
      inner.add(a); g.add(b);
    });
    this.group.add(g);
    this.list.set(key, { key, group: g, inner, sig });
  }
  remove(key) {
    const e = this.list.get(key);
    if (!e) return;
    this.group.remove(e.group);
    e.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.list.delete(key);
  }
  // the inner beam turns, and the picture runs up both
  frame() {
    const t = performance.now() / 50;
    if (TEX) TEX.offset.y = -((t * 0.2) % 1);
    if (GTEX) GTEX.offset.y = -((t * 0.2) % 1);
    for (const e of this.list.values()) e.inner.rotation.y = -(t * 2.25 - 45) * Math.PI / 180;
    for (const g of this.gates.values()) if (g.group) g.inner.rotation.y = -(t * 2.25 - 45) * Math.PI / 180;
  }
}
