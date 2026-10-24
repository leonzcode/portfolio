/* ---------------------------------------------------------------------------
   Leoncraft 2 - a block drawn the moment it goes down.

   A block you put down, or one another player put down near you, is drawn
   at once as a little mesh of its own (the hand's block mesh, set in its
   cell), until its column's own mesh with it in is on the graphics card. The
   workers take a frame or two over a column next to you, and longer over one
   with no kept mesh (a bridge running into a new chunk); the game's own
   client shows a placed block in the very next frame (its Semi Blocking
   chunk builder makes the section on the spot), and this does the same
   without making the section on the page's own thread.

   Only plain boxes (whole blocks, slabs, stairs) in the opaque and cut-out
   passes: glass or a pane drawn opaque for a frame would flash. Its light is
   the cell's own (lightNear), with no corner shading; for the frame or two it
   shows, that is all the difference there is.
--------------------------------------------------------------------------- */
import { BLOCKS } from './blocks.js?v=107';
import { blockGeometry } from './render/blockmesh.js?v=107';
import { lightNear } from './lightlevel.js?v=107';
const THREE = window.THREE;
const SHAPES = new Set(['cube', 'slab', 'stairs']);
const MAX = 256, LIFE = 4000;

export class QuickBlocks {
  constructor(renderer, world) {
    this.R = renderer; this.w = world;
    this.group = new THREE.Group(); this.group.name = 'quick-blocks';
    renderer.scene.add(this.group);
    this.list = new Map();      // "x,y,z" -> { mesh, b, k: its column, v: the first mesh version of the column that has it, at }
  }
  drawable(d) { return !!d && SHAPES.has(d.shape) && (d.pass === 'opaque' || d.pass === 'cutout') && !d.lower && d.place !== false; }
  /* (x, y, z) now holds block b (meta m): drawn until its column's mesh has it. Anything else there (air, a
     shape not drawn here) takes a quick block away. Call it straight after world.set, before the frame's flush:
     the column's next mesh job is the first with the change in it. */
  put(x, y, z, b, m) {
    const key = x + ',' + y + ',' + z, old = this.list.get(key);
    if (old) this.drop(key, old);
    const d = BLOCKS[b];
    if (!b || !this.drawable(d) || this.list.size >= MAX) return;
    const w = this.w, k = Math.floor(x / 16) + ',' + Math.floor(z / 16);
    if (!w.chunks || !w.chunks.has(k)) return;
    let geo;
    try { geo = blockGeometry(d, m & 255); } catch (e) { return; }
    if (geo.flat) { geo.geometry.dispose(); return; }
    const mats = this.R.mats, mesh = new THREE.Mesh(geo.geometry, geo.cutout ? mats.cutout : mats.opaque);
    mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    // (a block mesh's own height runs 0.5 to 1.5: blockmesh.js packs y + 1 and the shader takes none of it off)
    mesh.matrix.makeTranslation(x + 0.5, y - 0.5, z + 0.5); mesh.matrixWorldNeedsUpdate = true;
    const v = lightNear(w, x, y, z, !!w.noSky), L = geo.geometry.attributes.aL;
    if (L) { const s = Math.round((v >> 4) / 15 * 255), bl = Math.round((v & 15) / 15 * 255); for (let i = 0; i < L.count; i++) { L.array[i * 4] = s; L.array[i * 4 + 1] = bl; } L.needsUpdate = true; }
    this.group.add(mesh);
    this.list.set(key, { mesh, b, x, y, z, cut: geo.cutout, k, v: (w.meshVersion.get(k) || 0) + 1, at: performance.now() });
  }
  drop(key, q) { this.group.remove(q.mesh); q.mesh.geometry.dispose(); this.list.delete(key); }
  // once a frame, before drawing: a quick block goes once its column's mesh with it is on the card (or the cell changed)
  frame() {
    if (!this.list.size) return;
    const w = this.w, shown = w.shownVersion, up = this.R.uploads, mats = this.R.mats, now = performance.now();
    for (const [key, q] of this.list) {
      const there = (shown && (shown.get(q.k) || 0) >= q.v && !(up && up.has(q.k))) || w.get(q.x, q.y, q.z) !== q.b || now - q.at > LIFE || !w.chunks.has(q.k);
      if (there) { this.drop(key, q); continue; }
      // (a new look drops the old materials: render/looks.js)
      const m = q.cut ? mats.cutout : mats.opaque;
      if (q.mesh.material !== m) q.mesh.material = m;
    }
  }
  clear() { for (const [key, q] of this.list) this.drop(key, q); }
  dispose() { this.clear(); if (this.group.parent) this.group.parent.remove(this.group); }
}
