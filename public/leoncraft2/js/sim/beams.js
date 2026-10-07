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
--------------------------------------------------------------------------- */
import { B, OPACITY } from '../blocks.js?v=24';
import { H } from '../world-const.js?v=24';
const THREE = window.THREE;

const BEACON = B.beacon;
const BASE = new Set(['iron_block', 'gold_block', 'emerald_block', 'diamond_block', 'netherite_block'].map(n => B[n]).filter(v => v !== undefined));
// the dyes' colours (the game's DyeColor), for the glass
const DYE = { white: 0xF9FFFE, orange: 0xF9801D, magenta: 0xC74EBD, light_blue: 0x3AB3DA, yellow: 0xFED83D, lime: 0x80C71F, pink: 0xF38BAA,
  gray: 0x474F52, light_gray: 0x9D9D97, cyan: 0x169C9C, purple: 0x8932B8, blue: 0x3C44AA, brown: 0x835432, green: 0x5E7C16, red: 0xB02E26, black: 0x1D1D21 };
const GLASS = new Map();
for (const [c, hex] of Object.entries(DYE)) for (const n of [c + '_stained_glass', c + '_stained_glass_pane'])
  if (B[n] !== undefined) GLASS.set(B[n], [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);

let TEX = null;
function beamTexture() {
  if (TEX) return TEX;
  TEX = new THREE.TextureLoader().load(new URL('../../textures/beacon_beam.png?v=24', import.meta.url).href);
  TEX.wrapS = TEX.wrapT = THREE.RepeatWrapping;
  TEX.magFilter = THREE.NearestFilter; TEX.minFilter = THREE.NearestFilter;
  return TEX;
}
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
    this.group = new THREE.Group();
    const r = sim.renderer;
    if (r && r.scene) r.scene.add(this.group);
    this.n = 0;
    (sim.tickers || (sim.tickers = [])).push(() => { if (++this.n % 20 === 1) this.scan(); });
    const frame = () => {
      if (this.dead) return;
      if (this.list.size) this.frame();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  dispose() {
    this.dead = true;
    for (const k of [...this.list.keys()]) this.remove(k);
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
        if ((v >> 8) !== BEACON) continue;
        const y = i >> 8, z = cz * 16 + ((i >> 4) & 15), x = cx * 16 + (i & 15);
        if (this.w.get(x, y, z) !== BEACON) continue;
        const key = x + ',' + y + ',' + z;
        seen.add(key);
        this.update(key, x, y, z);
      }
    }
    for (const k of [...this.list.keys()]) if (!seen.has(k)) this.remove(k);
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
    for (const e of this.list.values()) e.inner.rotation.y = -(t * 2.25 - 45) * Math.PI / 180;
  }
}
