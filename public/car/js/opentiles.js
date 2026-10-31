// Real buildings from open 3D tilesets (round 6, agent T). There is no free, keyless copy of Google Earth's mesh, so
// where a city or country publishes its own buildings openly (no key, no login, open licence, reachable from a web
// page) they are drawn over the open world's terrain in place of our generated houses. The OSM footprints stay for
// the collisions, the roofs a car can land on and the cut mask; only the drawn walls and roofs of the buildings that
// stand inside a source's coverage are left out (buildings.js reads covers() through the build's ctx.realAt).
//
// Each source is a 3D Tiles set streamed by 3DTilesRenderer, like the Google path in world.js: placed in the local
// frame of geo.js, its height matched to our ground (calibrate: the lowest point of the real buildings in each small
// cell against the ground there), photographed surfaces drawn through baked.js (unlit, so the time of day and the
// weather reach them through bakedUniforms), untextured ones lit by the sky's own lights. Sources and their licences:
// scratchpad car6/T/SOURCES.md and CREDITS.md. ?noopen turns all of it off, ?opentiles=<id> uses one source only.
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GLTFExtensionsPlugin, TileCompressionPlugin, UpdateOnChangePlugin, ImplicitTilingPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { frame, project } from './geo.js?v=50';
import { patchBaked } from './baked.js?v=50';
import { FACADE_NIGHT } from './facade.js?v=50'; // (the weather's night for the windows: weather.js sets it)

const Q = new URLSearchParams(location.search);
const D2R = Math.PI / 180;

// Rough outlines (lat, lon) of where a country-wide or state-wide set has buildings: their own bounding boxes reach
// well into the neighbours, where they have nothing (a few km out at the borders is fine).
const NL = [[51.37, 3.36], [51.27, 3.85], [51.37, 4.25], [51.48, 4.75], [51.42, 5.05], [51.25, 5.5], [50.75, 5.69], [50.75, 6.02], [51.1, 6.08], [51.35, 6.22], [51.75, 5.95], [51.85, 6.4], [51.92, 6.8], [52.12, 6.9], [52.25, 7.07], [52.65, 7.06], [53.2, 7.22], [53.47, 6.9], [53.5, 5.6], [53.2, 4.7], [52.9, 4.55], [52.3, 4.4], [51.95, 3.95], [51.7, 3.5]];
const CH = [[46.13, 5.96], [46.42, 6.1], [46.6, 6.1], [46.95, 6.43], [47.25, 6.95], [47.47, 7.0], [47.59, 7.55], [47.6, 8.2], [47.8, 8.6], [47.7, 9.0], [47.54, 9.57], [47.05, 9.6], [46.9, 9.88], [46.9, 10.47], [46.55, 10.5], [46.23, 10.13], [46.4, 9.4], [45.82, 9.03], [46.0, 8.85], [46.3, 8.42], [46.1, 8.12], [45.9, 7.85], [45.88, 7.0], [46.15, 6.8], [46.2, 6.2]];
const NRW = [[50.73, 6.02], [51.1, 6.08], [51.35, 6.22], [51.75, 5.95], [51.85, 6.4], [51.92, 6.8], [52.12, 6.9], [52.25, 7.07], [52.27, 7.35], [52.45, 7.6], [52.4, 8.0], [52.45, 8.3], [52.53, 8.45], [52.5, 8.7], [52.4, 9.0], [52.1, 9.1], [51.65, 9.45], [51.45, 9.15], [51.3, 8.95], [51.0, 8.55], [50.75, 8.15], [50.85, 8.0], [50.65, 7.8], [50.6, 7.4], [50.45, 7.2], [50.32, 6.8], [50.33, 6.4], [50.5, 6.2]];

// The registry, best first where two overlap (only one of a place's sources is drawn at a time: two sets of the same
// buildings would fight). kind: 'textured' (photographed walls and roofs, through baked.js) or 'lod2' (accurate
// shapes and roofs with no pictures, coloured here and lit). geoid: about how far the set's heights are over ours
// there (WGS84 ellipsoid against sea level), used only until calibrate has measured it.
export const SOURCES = [
  {
    id: 'plateau', name: 'PLATEAU', where: 'Japan (about 290 cities and wards)', kind: 'textured', box: [24, 122, 46, 146], geoid: 37,
    composite: ['https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/all-bldg-lod2-texture-latest/tileset.json',
      'https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/all-bldg-lod1-latest/tileset.json'],
    credit: 'MLIT Project PLATEAU (processed)', palette: { walls: [0xd8d6d0, 0xc9c6bd, 0xe4e1d8, 0xb9b8b3], roofs: [0x8a8a88, 0x77797b, 0x9c9a94] },
  },
  {
    // (a photographed mesh of the whole city, ground, trees and all, like Google's: the ground under our roads is cut
    // away by the cut mask, as it is for Google's mesh, and drawn a hair in front of our terrain where they meet)
    id: 'helsinki-mesh', name: 'Helsinki reality mesh', where: 'Helsinki', kind: 'mesh', box: [60.12, 24.82, 60.31, 25.26], geoid: 0,
    url: 'https://kartta.hel.fi/3d/mesh/Helsinki_2017/tileset.json',
    credit: 'City of Helsinki 3D reality mesh 2017 (CC BY 4.0)',
  },
  {
    id: '3dbag', name: '3DBAG', where: 'the Netherlands', kind: 'lod2', poly: NL, box: [50.7, 3.3, 53.6, 7.3], geoid: 43,
    url: 'https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/tileset.json',
    credit: '3DBAG by the 3D geoinformation group, TU Delft (CC BY 4.0)', palette: { walls: [0x7a4536, 0x5e3a30, 0xb9ad9b, 0x8a5a48], roofs: [0x3a3c40, 0x5a3328, 0x2f3134, 0x6b4636] },
  },
  {
    id: 'swiss', name: 'swissBUILDINGS3D', where: 'Switzerland', kind: 'lod2', poly: CH, box: [45.8, 5.9, 47.9, 10.6], geoid: 49,
    url: 'https://3d.geo.admin.ch/ch.swisstopo.swissbuildings3d.3d/v1/tileset.json',
    credit: '©swisstopo swissBUILDINGS3D', palette: { walls: [0xe8e2d4, 0xdcd3c0, 0xf1ece2, 0xcfc4ae], roofs: [0x7c4a36, 0x8f5a40, 0x5b5a58, 0x6a3d2e] },
  },
  {
    id: 'nrw', name: '3D-Gebäudemodell NRW', where: 'North Rhine-Westphalia', kind: 'lod2', poly: NRW, box: [50.3, 5.8, 52.6, 9.5], geoid: 47,
    url: 'https://ogc-api.nrw.de/3dg/v1/collections/building/3dtiles?f=json',
    credit: 'Geobasis NRW 3D-Gebäudemodell (dl-de/zero-2-0)', palette: { walls: [0xe6e0d4, 0xd4c8b2, 0xa8644a, 0xc9c2b4], roofs: [0x45474a, 0x7a3e30, 0x5a5c5e, 0x8a4a36] },
  },
];

function inPoly(lat, lon, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ya, xa] = P[i], [yb, xb] = P[j];
    if ((ya > lat) !== (yb > lat) && lon < (xb - xa) * (lat - ya) / (yb - ya) + xa) c = !c;
  }
  return c;
}
const inBox = (lat, lon, b) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
const quality = () => { try { return (window.__car && window.__car.quality) || globalThis.__carQuality || null; } catch (e) { return null; } };
const tier = () => { const q = quality(); return q && q.tier ? q.tier : 'high'; };

// how each tier draws them: the screen-space error the renderer refines to (higher is coarser), how far out they
// are loaded and drawn (metres), the cache, and whether they cast shadows and can be hit by rays (the camera)
const TIER = {
  low: { error: 80, reach: 700, bytes: 0.07, tiles: 250, shadows: false, rays: false, free: true, tex: 256, maxTris: 350000 },
  medium: { error: 48, reach: 1100, bytes: 0.16, tiles: 700, shadows: true, rays: true, free: false, tex: 384, maxTris: 900000 },
  high: { error: 32, reach: 1500, bytes: 0.28, tiles: 1200, shadows: true, rays: true, free: false, tex: 512, maxTris: 1600000 },
};

// A b3dm's batch table (every building's attributes, JSON, often most of the file) is never read here: its bytes
// are handed to the feature table's binary part in the header, where nothing points at them, so the loader neither
// parses them nor keeps them (PLATEAU's tiles carry 90 to 120 KB each). The buffer itself is not copied.
function stripB3dm(buf) {
  const v = new DataView(buf);
  if (buf.byteLength < 28 || v.getUint32(0, true) !== 0x6d643362) return buf; // 'b3dm'
  const ftb = v.getUint32(16, true), btj = v.getUint32(20, true), btb = v.getUint32(24, true);
  if (!btj && !btb) return buf;
  v.setUint32(16, ftb + btj + btb, true); v.setUint32(20, 0, true); v.setUint32(24, 0, true);
  return buf;
}
const STRIP = { name: 'OPEN_B3DM_STRIP', fetchData(url, options) {
  if (!/\.b3dm(\?|$)/i.test(url)) return null;
  return fetch(url, options).then(r => r.ok ? r.arrayBuffer().then(b => new Response(stripB3dm(b))) : r);
} };

const FREE = function () { this.array = null; };
let DRACO = null;
const draco = () => DRACO || (DRACO = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/'));

// The source to use at a place (or null): its tileset address and where it has buildings.
async function resolve(lat, lon) {
  if (Q.has('noopen')) return null;
  const only = Q.get('opentiles');
  for (const S of SOURCES) {
    if (only && only !== S.id) continue;
    if (!inBox(lat, lon, S.box) || (S.poly && !inPoly(lat, lon, S.poly))) continue;
    if (S.composite) {
      // a country-wide set made of cities and wards: only the ones within a few km of the drop go into a tileset of
      // our own (the whole set would load every ward's index in view), and the boxes of those are its coverage
      for (const url of S.composite) {
        let j = null;
        try { const r = await fetch(url); if (r.ok) j = await r.json(); } catch (e) { console.warn('open tiles: ' + S.id, e); }
        if (!j || !j.root || !j.root.children) continue;
        const la = lat * D2R, lo = lon * D2R, pad = 4000 / 6371000, padLo = pad / Math.cos(la);
        const near = j.root.children.filter(c => { const r = c.boundingVolume && c.boundingVolume.region; return r && r[0] - padLo < lo && r[2] + padLo > lo && r[1] - pad < la && r[3] + pad > la; });
        // (the drop itself must be inside one of them; a ward box only nearby is not coverage of the drop)
        const here = near.some(c => { const r = c.boundingVolume.region; return r[0] < lo && r[2] > lo && r[1] < la && r[3] > la; });
        if (!here) continue;
        let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
        for (const c of near) { const r = c.boundingVolume.region; w = Math.min(w, r[0]); s = Math.min(s, r[1]); e = Math.max(e, r[2]); n = Math.max(n, r[3]); }
        const root = { asset: { version: '1.0' }, geometricError: 5000, root: { boundingVolume: { region: [w, s, e, n, -100, 1000] }, geometricError: 5000, refine: 'ADD', children: near } };
        const blob = URL.createObjectURL(new Blob([JSON.stringify(root)], { type: 'application/json' }));
        return { S, url: blob, rects: near.map(c => c.boundingVolume.region.slice(0, 4).map(v => v / D2R)), lod: /lod1/.test(url) ? 1 : 2 };
      }
      continue;
    }
    // a single set: its root's region (or our outline) is its coverage
    return { S, url: S.url, rects: null, lod: 2 };
  }
  return null;
}

export class OpenTiles {
  constructor(world) {
    this.world = world; this.renderer = world.renderer; this.camera = world.camera;
    this.src = null; this.tiles = null; this.group = null;
    this.dy = 0; this.calibrated = false; this.calibAt = null; this.calibT = 0;
    this.hit = []; this.bvhQueue = new Set();
    this.credit = '';
    this.stats = { source: null, models: 0, meshes: 0, triangles: 0, textured: 0, lit: 0, bvh: 0, calib: [] };
    this.cam = new THREE.PerspectiveCamera();
    this.mats = new Map(); // shared lit materials, one per source and colour use (one program for all of them)
  }

  // the set covering (lat, lon), loaded and placed; false when there is none here
  async start(lat, lon) {
    let r = null;
    try { r = await Promise.race([resolve(lat, lon), new Promise(res => setTimeout(() => res(null), 6000))]); } catch (e) { console.warn('open tiles', e); }
    if (!r) return false;
    this.src = r.S; this.lod = r.lod; this.stats.source = r.S.id + (r.lod === 1 ? ' (LoD1)' : '');
    this.credit = r.S.credit;
    this.dy = -(r.S.geoid || 0);
    // the coverage in our frame: rectangles (a composite's wards) or the outline
    const P = this.cover = [];
    if (r.rects) for (const [w, s, e, n] of r.rects) { const a = project(s, w), b = project(n, e); P.push({ x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]) }); }
    else if (r.S.poly) this.poly = r.S.poly.map(([la, lo]) => project(la, lo));
    const T = { ...(TIER[tier()] || TIER.high) };
    // (never further than the tier draws our own buildings, with a little to spare: quality.js bldReach)
    try { const q = quality(); if (q && q.p && Number.isFinite(q.p.bldReach)) T.reach = Math.min(T.reach, q.p.bldReach + 250); } catch (e) {}
    this.T = T;
    this.url = r.url;
    const ok = await this.make();
    if (!ok) { console.warn('open tiles: ' + r.S.id + ' did not load'); this.dispose(); return false; }
    this.t0 = performance.now();
    // (a lost graphics context (a Chromebook short of memory) takes the tiles' buffers with it, and on low the page's
    // own copies were let go: once the context is back the set is made again from its index, the height kept)
    const cv = this.renderer.domElement;
    this._onRestore = () => { if (!this.tiles) return; this.remake().catch(e => console.warn('open tiles restore', e)); };
    cv.addEventListener('webglcontextrestored', this._onRestore);
    return true;
  }

  // the renderer for this.url, placed and waiting for its root (false when the root does not come)
  async make() {
    const T = this.T, S = this.src;
    const tiles = this.tiles = new TilesRenderer(this.url);
    // (a plugin object can belong to one renderer only: a fresh one each time, or a second drop or a restored context
    // throws here)
    tiles.registerPlugin({ name: STRIP.name, fetchData: STRIP.fetchData });
    tiles.registerPlugin(new ImplicitTilingPlugin());
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco(), meshoptDecoder: MeshoptDecoder }));
    // (mipmaps on: walls seen at a grazing angle from the street shimmer without them)
    tiles.registerPlugin(new TileCompressionPlugin({ disableMipmaps: false }));
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.errorTarget = +(Q.get('openerr') || T.error);
    // only the tiles a view needs, as they come: no coarse ancestors first and no siblings out of view (a city's
    // coarse tiles are lumps that are not worth their download, and our terrain is under them anyway)
    if (!Q.has('opensiblings')) { tiles.loadSiblings = false; tiles.loadAncestors = false; }
    tiles.lruCache.minSize = Math.round(T.tiles * 0.5); tiles.lruCache.maxSize = T.tiles;
    tiles.lruCache.minBytesSize = T.bytes * 0.6 * 2 ** 30; tiles.lruCache.maxBytesSize = T.bytes * 2 ** 30;
    tiles.addEventListener('load-model', e => this.onModel(e.scene, e.tile));
    tiles.addEventListener('dispose-model', e => this.onDispose(e.scene));
    tiles.setCamera(this.cam);
    this.syncCam();
    tiles.setResolutionFromRenderer(this.cam, this.renderer);
    this.group = tiles.group;
    this.group.name = 'open tiles ' + S.id;
    this.group.matrixAutoUpdate = false;
    this.place();
    // (hidden until its height is matched to ours, a few seconds at most: calibrate)
    this.group.visible = this.calibrated;
    this._pk = null; this.place();
    this.world.root.add(this.group);
    // the root arrives (or not) before the streets are built: if it fails, our own buildings stay
    return new Promise(res => {
      const t = setTimeout(() => res(!!tiles.root), 8000);
      tiles.addEventListener('load-root-tileset', () => { clearTimeout(t); res(true); });
      tiles.addEventListener('load-error', () => { if (!tiles.root) { clearTimeout(t); res(false); } });
      tiles.update();
    });
  }

  async remake() {
    try { if (this.group && this.group.parent) this.group.parent.remove(this.group); this.tiles.dispose(); } catch (e) {}
    this.hit.length = 0; this.bvhQueue.clear();
    this.stats.remade = (this.stats.remade || 0) + 1;
    return this.make();
  }

  // inside the set's coverage (our frame): our own building there is not drawn
  covers(x, z) {
    if (!this.tiles) return false;
    if (this.cover && this.cover.length) { for (const c of this.cover) if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true; return false; }
    if (this.poly) {
      const P = this.poly; let c = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xa, za] = P[i], [xb, zb] = P[j]; if ((za > z) !== (zb > z) && x < (xb - xa) * (z - za) / (zb - za) + xa) c = !c; }
      return c;
    }
    return true;
  }

  place() {
    // ECEF to our frame, then the height difference between the set and our ground
    const k = frame.lat + ',' + frame.lon + ',' + frame.h + ',' + this.dy;
    if (k === this._pk) return;
    this._pk = k;
    this.group.matrix.makeTranslation(0, this.dy, 0).multiply(frame.ecefToLocal);
    this.group.matrixWorldNeedsUpdate = true;
  }

  // the renderer's own camera: the view's, with its far plane at the reach, so nothing further is loaded or drawn
  syncCam() {
    const c = this.camera, m = this.cam, far = Math.max(200, this.T ? this.T.reach : 2600);
    if (m.fov !== c.fov || m.aspect !== c.aspect || m.near !== c.near || m.far !== far) { m.fov = c.fov; m.aspect = c.aspect; m.near = c.near; m.far = far; m.updateProjectionMatrix(); }
    m.position.copy(c.position); m.quaternion.copy(c.quaternion); m.updateMatrixWorld(true);
  }

  // A material for a tile's mesh: its photograph drawn unlit through baked.js (the night and the weather reach it
  // there), or, with none, a shared lit one coloured from the source's palette by which way each face looks and by
  // the building it belongs to.
  onModel(scene, tile) {
    const S = this.src; if (!S) return;
    const T = this.T || TIER.high;
    this.stats.models++;
    scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry, ms = Array.isArray(o.material) ? o.material : [o.material];
      if (!g.attributes.normal) g.computeVertexNormals();
      const out = ms.map(m => {
        if (m && m.map) {
          // (a tile's picture is often 1024 px: smaller here, or the cache fills with a few dozen tiles and refuses
          // the rest, so the near ones never sharpen)
          this.shrink(m.map, T.tex);
          const b = new THREE.MeshBasicMaterial({ map: m.map, color: 0xffffff, side: THREE.FrontSide, vertexColors: !!m.vertexColors && !!g.attributes.color, transparent: !!m.transparent, opacity: m.opacity, alphaTest: m.alphaTest || 0 });
          m.map.anisotropy = tier() === 'low' ? 2 : 8;
          // (a reality mesh's ground lies on our terrain: pulled a hair towards the eye so it wins where they meet)
          if (S.kind === 'mesh') { b.polygonOffset = true; b.polygonOffsetFactor = -1; b.polygonOffsetUnits = -4; }
          patchBaked(b);
          m.map = null; m.dispose();
          this.stats.textured++;
          return b;
        }
        if (m) m.dispose();
        this.stats.lit++;
        return this.litMaterial(!!g.attributes.color);
      });
      o.material = Array.isArray(o.material) ? out : out[0];
      // (the building each triangle belongs to, for its colour: the batch or feature id the set carries)
      const id = g.attributes._batchid || g.attributes._feature_id_0 || g.attributes._FEATURE_ID_0;
      if (id && !g.attributes.bkid) g.setAttribute('bkid', id);
      // (a reality mesh is mostly ground: it casts nothing, its own shading is in its photographs)
      o.castShadow = T.shadows && S.kind !== 'mesh'; o.receiveShadow = true;
      o.matrixAutoUpdate = false; o.updateMatrix();
      this.stats.meshes++;
      this.stats.triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      if (T.rays) this.bvhQueue.add(o);
      // (low: once on the graphics card, the page's own copy of everything but the positions is let go; the heights
      // are measured from the positions, and nothing else of a tile is read again)
      if (T.free) { for (const k in g.attributes) { const at = g.attributes[k]; if (k !== 'position' && at && at.isBufferAttribute && !at.isInterleavedBufferAttribute && at.onUpload) at.onUpload(FREE); } if (g.index && g.index.onUpload) g.index.onUpload(FREE); }
    });
    // (its size in the cache after the pictures were made smaller)
    // (the renderer keeps its first measure of a tile: forgotten here so it is measured again)
    try { if (tile && this.tiles.recalculateBytesUsed) { if (this.tiles._bytesUsed && this.tiles._bytesUsed.delete) this.tiles._bytesUsed.delete(tile); this.tiles.recalculateBytesUsed(tile); } } catch (e) {}
  }

  shrink(tex, max) {
    const im = tex.image; if (!im || !im.width || (im.width <= max && im.height <= max)) return;
    try {
      const k = max / Math.max(im.width, im.height), w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
      const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
      g.drawImage(im, 0, 0, w, h);
      if (im.close) im.close();
      tex.image = c; tex.needsUpdate = true;
      this.stats.shrunk = (this.stats.shrunk || 0) + 1;
    } catch (e) {}
  }

  onDispose(scene) {
    scene.traverse(o => {
      if (!o.isMesh) return;
      this.bvhQueue.delete(o);
      const i = this.hit.indexOf(o); if (i >= 0) this.hit.splice(i, 1);
      if (o.geometry && o.geometry.boundsTree) o.geometry.disposeBoundsTree();
      const g = o.geometry; this.stats.triangles -= g ? (g.index ? g.index.count / 3 : g.attributes.position.count / 3) : 0;
      // (the shared lit materials stay; a photograph's own goes with its tile)
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m && !m.userData.openShared) { if (m.map) m.map.dispose(); m.dispose(); }
    });
  }

  litMaterial(vc) {
    const key = vc ? 'vc' : 'pal';
    if (this.mats.has(key)) return this.mats.get(key);
    const pal = this.src.palette || { walls: [0xd8d4ca], roofs: [0x777777] };
    const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: vc });
    m.userData.openShared = true;
    const cols = (a) => { const out = []; for (let i = 0; i < 4; i++) out.push(new THREE.Color(a[i % a.length])); return out; };
    const U = { uWall: { value: cols(pal.walls) }, uRoof: { value: cols(pal.roofs) }, uOpNight: FACADE_NIGHT };
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float bkid;
varying vec3 vOpN;
varying vec3 vOpW;
varying float vOpId;`)
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
vOpN = inverseTransformDirection( transformedNormal, viewMatrix );
vOpId = bkid;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
vOpW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uWall[4];
uniform vec3 uRoof[4];
uniform float uOpNight;
varying vec3 vOpN;
varying vec3 vOpW;
varying float vOpId;
float opWin = 0.0, opLit = 0.0;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  // walls and roofs told apart by which way the face looks; each building picks its own colours by its id
  // (the id rounded: interpolated across a triangle it wobbles in its last bits, and the hash turns that into speckle)
  float bid = floor( vOpId + 0.5 );
  float h = fract( sin( bid * 12.9898 + 4.1 ) * 43758.5453 );
  int i = int( h * 3.999 ), j = int( fract( h * 7.31 ) * 3.999 );
  vec3 wc = i == 0 ? uWall[0] : i == 1 ? uWall[1] : i == 2 ? uWall[2] : uWall[3];
  vec3 rc = j == 0 ? uRoof[0] : j == 1 ? uRoof[1] : j == 2 ? uRoof[2] : uRoof[3];
  vec3 nw = normalize( vOpN );
  float up = smoothstep( 0.35, 0.7, abs( nw.y ) );
  vec3 col = mix( wc, rc, up );
  // a plain grid of windows on the walls (2.7 m across, 3.2 m floors), fading out with distance before it would shimmer;
  // at night a share of them lit (facade.js's own night, set by the weather)
  if ( up < 0.5 ) {
    vec2 t = normalize( vec2( -nw.z, nw.x ) + vec2( 1e-5 ) );
    vec2 cell = vec2( dot( vOpW.xz, t ) / 2.7, vOpW.y / 3.2 );
    vec2 f = fract( cell );
    float win = step( 0.27, f.x ) * step( f.x, 0.73 ) * step( 0.3, f.y ) * step( f.y, 0.82 );
    float far = 1.0 - smoothstep( 220.0, 520.0, distance( vOpW, cameraPosition ) );
    opWin = win * far * ( 1.0 - up * 2.0 );
    col = mix( col, vec3( 0.13, 0.15, 0.18 ), opWin * 0.8 );
    float hw = fract( sin( dot( floor( cell ), vec2( 12.99, 78.23 ) ) + bid * 3.1 ) * 43758.5453 );
    opLit = win * step( hw, 0.22 ) * uOpNight;
  }
  diffuseColor.rgb *= col;
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3( 1.0, 0.8, 0.56 ) * opLit * 0.9;`);
    };
    m.customProgramCacheKey = () => 'opentiles-lit3';
    this.mats.set(key, m);
    return m;
  }

  // Our ground under the real buildings: in small cells, the lowest point of the set (a wall's foot, or the ground
  // itself in a mesh) against our ground at the cell's middle; a low share of those differences (cells holding only
  // a big roof's middle come out high) is how far the set is over our ground. Run until it has enough cells, then
  // again when the car is far from where it last ran.
  calibrate(ground, cx, cz, R = 380) {
    if (!this.tiles || !this.group) return false;
    const C = 8, cells = new Map(), tops = new Map(), v = new THREE.Vector3(), M = new THREE.Matrix4();
    // (buildings only: a cell counts if it holds a wall, its points spanning 2.5 m or more; a flat roof's middle does
    // not. A mesh's ground cells are what it is measured by, so there every cell counts)
    const needWall = this.src && this.src.kind !== 'mesh';
    this.group.updateMatrixWorld(true);
    let n = 0;
    // (about 60k points read in a run at most, however many tiles are in: counted first)
    let pts = 0; this.group.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) pts += o.geometry.attributes.position.count; });
    this._calibPts = pts;
    this.group.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry, pa = g && g.attributes.position; if (!pa || !pa.array) return;
      // (a tile whose bounds lie wholly outside the circle is skipped; a big one is read every few points, so a run
      // stays a few milliseconds)
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = v.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld), br = g.boundingSphere.radius * o.matrixWorld.getMaxScaleOnAxis();
      if ((bs.x - cx) ** 2 + (bs.z - cz) ** 2 > (R + br) ** 2) return;
      M.copy(o.matrixWorld);
      const step = Math.max(1, Math.ceil(pa.count / 15000), Math.ceil(this._calibPts / 60000));
      for (let i = 0; i < pa.count; i += step) {
        v.fromBufferAttribute(pa, i).applyMatrix4(M);
        const dx = v.x - cx, dz = v.z - cz; if (dx * dx + dz * dz > R * R) continue;
        const k = (Math.floor(v.x / C) + 32768) * 65536 + (Math.floor(v.z / C) + 32768), y = v.y - this.dy, c = cells.get(k);
        if (c === undefined || y < c) cells.set(k, y);
        const t = tops.get(k); if (t === undefined || y > t) tops.set(k, y);
        n++;
      }
    });
    const d = [];
    for (const [k, y] of cells) {
      if (needWall && tops.get(k) - y < 2.5) continue;
      const xc = Math.floor(k / 65536) - 32768, zc = (k % 65536) - 32768;
      const g = ground((xc + 0.5) * C, (zc + 0.5) * C);
      if (g === null || g === undefined || !Number.isFinite(g)) continue;
      d.push(y - g);
    }
    // (enough cells to trust: 150, or 40 once it has waited 10 s)
    if (d.length < 40 || (d.length < 150 && performance.now() - (this.t0 || 0) < 10000)) return false;
    d.sort((a, b) => a - b);
    // The most common difference: the cells holding a building's corner carry its foot (the wall's top and foot share
    // the corner), and those agree to a metre or so; cells holding only the middle of a roof spread out above, cellars
    // and underground parts below. Half-metre bins smoothed over a metre and a half, then the mean of what lies within
    // a metre of the best bin.
    const lo = d[Math.floor(d.length * 0.02)], hi = d[Math.floor(d.length * 0.98)], NB = Math.max(1, Math.min(800, Math.ceil((hi - lo) / 0.5) + 1));
    const hist = new Float32Array(NB);
    for (const x of d) { if (x < lo || x > hi) continue; hist[Math.min(NB - 1, Math.floor((x - lo) / 0.5))]++; }
    let best = 0, bv = -1;
    for (let i = 0; i < NB; i++) { const v = (hist[i - 1] || 0) + hist[i] + (hist[i + 1] || 0); if (v > bv) { bv = v; best = i; } }
    const mode = lo + (best + 0.5) * 0.5;
    let sum = 0, cnt = 0; for (const x of d) if (Math.abs(x - mode) <= 1) { sum += x; cnt++; }
    const p = cnt ? sum / cnt : mode, med = d[d.length >> 1];
    const dy = -p;
    this.stats.calib.push({ cells: d.length, verts: n, mode: +p.toFixed(2), share: +(cnt / d.length).toFixed(2), p05: +d[Math.floor(d.length * 0.05)].toFixed(2), p15: +d[Math.floor(d.length * 0.15)].toFixed(2), med: +med.toFixed(2), at: [Math.round(cx), Math.round(cz)] });
    if (this.stats.calib.length > 8) this.stats.calib.shift();
    if (!Number.isFinite(dy) || Math.abs(dy) > 300) return false;
    // (kept from the run that saw the most cells near here: more tiles come in for a while after the drop)
    if (this.calibrated && this.calibAt && Math.hypot(cx - this.calibAt[0], cz - this.calibAt[1]) < 500 && d.length < (this.calibCells || 0)) return true;
    this.dy = dy; this.place(); this.calibCells = d.length;
    this.calibrated = true; this.calibAt = [cx, cz]; this.calibRuns = (this.calibRuns || 0) + 1;
    return true;
  }

  update() {
    if (!this.tiles) return;
    // (the renderers share one parse queue, 5 at a time: behind the loading card 8, so a city's tiles are not held up
    // waiting on decoder workers; while driving 4, and 2 on low, so fewer finished tiles land in one frame)
    try { const pq = this.tiles.parseQueue, D0 = window.__car && window.__car.drive; if (pq) pq.maxJobs = D0 && D0.holdRender ? 8 : (this.T && this.T.free ? 2 : 4); } catch (e) {}
    this.place();
    this.syncCam();
    this.tiles.setResolutionFromRenderer(this.cam, this.renderer);
    this.tiles.update();
    const now = performance.now(), D = window.__car && window.__car.drive;
    // A triangle budget for the tier: over it, coarser tiles and a shorter reach, a step every 2 s (Zurich's set came
    // to 640k triangles on low against our own buildings' 60k); well under it, back towards the tier's own numbers
    if (this.T && this.T.maxTris && now - (this.budgetT || 0) > 2000) {
      this.budgetT = now;
      const T = this.T, tr = this.stats.triangles, base = +(Q.get('openerr') || T.error);
      if (!this.reach0) this.reach0 = T.reach;
      if (tr > T.maxTris && this.tiles.errorTarget < base * 8) { this.tiles.errorTarget *= 1.4; T.reach = Math.max(300, T.reach * 0.85); this.stats.budget = (this.stats.budget || 0) + 1; }
      else if (tr < T.maxTris * 0.5 && this.tiles.errorTarget > base) { this.tiles.errorTarget = Math.max(base, this.tiles.errorTarget / 1.2); T.reach = Math.min(this.reach0, T.reach * 1.1); }
    }
    // the height: measured once tiles round the car have come in (shown anyway with the guess after 8 s)
    const o = D && D.car && D.car.vehicle ? D.car.vehicle.pos : this.camera.position;
    const far = this.calibAt ? Math.hypot(o.x - this.calibAt[0], o.z - this.calibAt[1]) > 500 : true;
    // (again every 2 s for the first half minute, as finer tiles arrive, then when the car is 500 m on)
    const again = this.calibrated && now - (this.t0 || 0) < 30000 && (this.calibRuns || 0) < 6;
    const slow = !this.calibrated || !(D && D.car && D.car.vehicle) || Math.abs(D.car.vehicle.fwdSpeed || 0) < 6;
    if ((far || again) && slow && now - this.calibT > (this.calibrated ? 4000 : 700) && this.stats.models > 0) {
      if (far && this.calibrated) this.calibCells = 0;
      this.calibT = now;
      // (against the streets' own height, where a road is within 20 m: outside the US the elevation data carries the
      // tops of big buildings in city centres, so the terrain there stands metres over the real ground; the buildings
      // must meet the pavement)
      const R = D && D.roadsObj && D.roadsObj.surfaceAt ? D.roadsObj : null;
      // (bridge decks left out: an elevated expressway beside a building is not its ground; Ginza came out 10 m off)
      // (a reality mesh is measured on the carriageways alone, where its ground is the very road ours is: by a harbour,
      // its sea next to a quay's road read 5 m low)
      const onlyRoad = this.src && this.src.kind === 'mesh';
      const ground = R ? (x, z) => { const r = R.surfaceAt(x, z, undefined, 1); if (!r || r.bridge) return null; if (r.onRoad && Number.isFinite(r.h)) return r.h; return !onlyRoad && Number.isFinite(r.nearH) && r.nearD < 20 ? r.nearH : null; } : (x, z) => this.world.groundAt(x, z);
      try { this.calibrate(ground, o.x, o.z); } catch (e) { console.warn('open tiles calibrate', e); }
    }
    if (!this.group.visible && (this.calibrated || now - (this.t0 || now) > 8000)) this.group.visible = true;
    // one bounds tree a frame for the meshes near the camera, so rays (the camera's, roofs) meet the real buildings
    // (only while the frames have room, at most one every 6th update while the car moves, and near the camera: 150 m)
    const G = window.__car, moving = !(D && D.stillFor && D.stillFor(1000));
    if (this.bvhQueue.size && this.T && this.T.rays && (!G || !G.fps || G.fps > 40) && (!moving || ((this._bvhN = (this._bvhN || 0) + 1) % 6) === 0)) {
      let best = null, bd = (moving ? 150 : 450) ** 2;
      for (const m of this.bvhQueue) {
        if (!m.parent) { this.bvhQueue.delete(m); continue; }
        const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
        const c = g.boundingSphere.center, e = m.matrixWorld.elements;
        const x = e[0] * c.x + e[4] * c.y + e[8] * c.z + e[12], z = e[2] * c.x + e[6] * c.y + e[10] * c.z + e[14];
        const dd = (x - this.camera.position.x) ** 2 + (z - this.camera.position.z) ** 2;
        if (dd < bd) { bd = dd; best = m; }
      }
      // (a big tile's tree is a long task: built only while the car stands still)
      const big = best && (best.geometry.index ? best.geometry.index.count : best.geometry.attributes.position.count) > 120000;
      if (big && !(D && D.stillFor && D.stillFor(1500))) best = null;
      if (best) {
        this.bvhQueue.delete(best);
        try { best.geometry.computeBoundsTree({ maxLeafTris: 10 }); this.hit.push(best); this.stats.bvh++; } catch (e) {}
      }
    }
  }

  // until the tiles round the camera are in (or the cap)
  async settle(cap = 4000) {
    const t0 = performance.now();
    while (this.tiles && performance.now() - t0 < cap) {
      const s = this.tiles.stats || {};
      if (performance.now() - t0 > 500 && !(s.downloading + s.parsing + (s.queued || 0)) && this.calibrated) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  dispose() {
    if (this._onRestore) { try { this.renderer.domElement.removeEventListener('webglcontextrestored', this._onRestore); } catch (e) {} this._onRestore = null; }
    if (this.tiles) {
      try { if (this.group && this.group.parent) this.group.parent.remove(this.group); this.tiles.dispose(); } catch (e) { console.warn('open tiles dispose', e); }
      this.tiles = null;
    }
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear(); this.hit.length = 0; this.bvhQueue.clear();
  }
}

// (world.js) the open world's real buildings for a drop, or null where no open set covers it
export async function startOpenTiles(world, lat, lon) {
  const T = new OpenTiles(world);
  const ok = await T.start(lat, lon);
  return ok ? T : null;
}
