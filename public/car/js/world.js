// The world under the car: Google's photorealistic 3D tiles when there is a key ('google'), otherwise terrain from
// the AWS Terrarium elevation tiles with Esri's satellite imagery draped on it ('open'), with OSM buildings added
// by buildings.js. Both are placed in the local frame of geo.js (+x east, +y up, +z south).
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GLTFExtensionsPlugin, TileCompressionPlugin, TilesFadePlugin, TerrariumMeshPlugin, XYZTilesOverlay, UpdateOnChangePlugin } from '3d-tiles-renderer/plugins';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { frame, toLocal, unproject, lonLatToTile } from './geo.js?v=41';
import { patchBaked } from './baked.js?v=41';
import { under } from './under.js?v=41';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// Elevation in metres from Terrarium tiles at zoom 15 (about 4 m a pixel at mid latitudes), decoded on the page,
// for the physics and the roads. The terrain mesh the plugin draws reads the same pixels, so the two agree.
class Heights {
  constructor(z) { this.tiles = new Map(); this.z = z; this.onTile = null; }
  key(x, y) { return x + ',' + y; }
  want(lat, lon, radius) {
    const z = this.z, [cx, cy] = lonLatToTile(lon, lat, z);
    const m = 40075016 * Math.cos(lat * Math.PI / 180) / 2 ** z / 256; // metres a pixel
    const r = Math.ceil(radius / (m * 256));
    const out = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push(this.fetch(Math.floor(cx) + dx, Math.floor(cy) + dy));
    return Promise.all(out);
  }
  fetch(x, y) {
    const k = this.key(x, y);
    if (this.tiles.has(k)) return this.tiles.get(k).p;
    const t = { data: null, p: null };
    t.p = fetch(TERRARIUM.replace('{z}', this.z).replace('{x}', x).replace('{y}', y))
      .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(b => createImageBitmap(b))
      .then(img => {
        const c = new OffscreenCanvas(256, 256), g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const px = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
        for (let i = 0; i < 65536; i++) h[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        t.data = h;
        if (this.onTile) this.onTile(x, y, this.z);
      })
      .catch(() => { t.data = null; this.tiles.delete(k); });
    this.tiles.set(k, t);
    return t.p;
  }
  // bilinear, pixel centres at +0.5 as the terrain mesh samples them
  at(lat, lon) {
    const [fx, fy] = lonLatToTile(lon, lat, this.z);
    const px = fx * 256 - 0.5, py = fy * 256 - 0.5;
    const x0 = Math.floor(px), y0 = Math.floor(py), tx = px - x0, ty = py - y0;
    // (the roads, the cut mask and the walls ask for hundreds of thousands of points in a build: four points inside
    // one tile, the last tile used kept, are read straight from its pixels, with no tile key made)
    const ix = x0 & 255, iy = y0 & 255;
    if (ix !== 255 && iy !== 255) {
      const kx = x0 >> 8, ky = y0 >> 8;
      let d = (kx === this._kx && ky === this._ky) ? this._kd : null;
      if (!d) { const t = this.tiles.get(kx + ',' + ky); d = t && t.data; if (d) { this._kx = kx; this._ky = ky; this._kd = d; } }
      if (!d) return null;
      const i = iy * 256 + ix;
      return (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + 256] * (1 - tx) + d[i + 257] * tx) * ty;
    }
    const v = (X, Y) => {
      const t = this.tiles.get(this.key(Math.floor(X / 256), Math.floor(Y / 256)));
      if (!t || !t.data) return NaN;
      return t.data[(((Y % 256) + 256) % 256) * 256 + (((X % 256) + 256) % 256)];
    };
    const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
    const r = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    return Number.isNaN(r) ? null : r;
  }
}

const _o = new THREE.Vector3(), _d = new THREE.Vector3(0, -1, 0), _ray = new THREE.Raycaster();
const _box = new THREE.Box3(), _m = new THREE.Matrix4();

export class World extends THREE.EventDispatcher {
  constructor(renderer, scene, camera) {
    super();
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.mode = null; this.tiles = null; this.heights = null;
    this.root = new THREE.Group(); this.root.name = 'world'; scene.add(this.root);
    this.extra = []; // meshes other modules add that raycasts should hit (buildings in the open world)
    this.attributions = '';
    this.loading = 0;
  }

  async start(mode, lat, lon, key) {
    this.dispose();
    this.mode = mode;
    // ?tiles=<tileset.json> loads any georeferenced 3D tileset down the Google path, for testing it without a key
    const testUrl = new URLSearchParams(location.search).get('tiles');
    const tiles = new TilesRenderer(mode === 'google' ? (testUrl || 'https://tile.googleapis.com/v1/3dtiles/root.json') : undefined);
    this.tiles = tiles;
    // our own handling of each tile's model runs first (before the fade plugin's, which must see the material we keep)
    tiles.addEventListener('load-model', e => this.onModel(e.scene, e.tile));
    if (mode === 'google') {
      if (!testUrl) {
        const auth = new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true, useRecommendedSettings: true });
        tiles.registerPlugin(auth);
        // a session refresh must not carry one tile's abort signal, and a failed refresh must not block every later
        // fetch (the library keeps the rejected promise otherwise)
        const A = auth.auth, refresh = A.refreshToken.bind(A);
        A.refreshToken = options => {
          const o = options ? { ...options } : {}; delete o.signal;
          const pr = refresh(o);
          pr.catch(() => { A._tokenRefreshPromise = null; });
          return pr;
        };
      }
      const draco = new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/');
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
      // mipmaps on: from a car the road is seen at a grazing angle, and without them it shimmers
      tiles.registerPlugin(new TileCompressionPlugin({ disableMipmaps: false }));
      tiles.registerPlugin(new TilesFadePlugin({ fadeDuration: 400 }));
      tiles.errorTarget = +(new URLSearchParams(location.search).get('err') || 10);
      // (a full cache refuses every new tile, those by the car too: room for a street-level view's thousands)
      tiles.lruCache.minSize = 3000; tiles.lruCache.maxSize = 6000;
      tiles.lruCache.minBytesSize = 0.45 * 2 ** 30; tiles.lruCache.maxBytesSize = 0.7 * 2 ** 30;
    } else {
      // zoom 14 (about 7.5 m a pixel): city elevation data holds some of the buildings and trees; a coarser level
      // smooths them out of the streets while keeping hills
      // (the plugin reads elevation at even levels only: 2 * floor(maxZoom / 2); the physics must read the same)
      const TZ = +(new URLSearchParams(location.search).get('tz') || 14);
      this.heights = new Heights(2 * Math.floor(TZ / 2));
      this.heights.onTile = (x, y, z) => this.dispatchEvent({ type: 'ground-changed', bbox: this.tileBox(x, y, z) });
      // (the tunnels' bores, under.js: something over the terrain's surface is not inside one)
      under.setGround((x, z) => this.groundAt(x, z));
      const overlay = new XYZTilesOverlay({ url: ESRI, levels: +(new URLSearchParams(location.search).get('lv') || 19), tileDimension: 256 });
      tiles.registerPlugin(new TerrariumMeshPlugin({ url: TERRARIUM, maxZoom: TZ, overlay, applyOverlayTexture: true, unlit: true }));
      tiles.errorTarget = 2;
    }
    tiles.registerPlugin(new UpdateOnChangePlugin());
    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    tiles.group.matrixAutoUpdate = false;
    tiles.group.matrix.copy(frame.ecefToLocal);
    tiles.group.matrixWorldNeedsUpdate = true;
    this.root.add(tiles.group);
    tiles.addEventListener('dispose-model', e => e.scene.traverse(o => { if (o.isMesh && o.geometry.boundsTree) o.geometry.disposeBoundsTree(); }));
    tiles.addEventListener('tiles-load-start', () => { this.loading++; });
    tiles.addEventListener('tiles-load-end', () => { this.loading = 0; });
    if (this.heights) await this.heights.want(lat, lon, 1500);
    if (mode === 'google') {
      // the key works once the root tileset arrives; a refusal (bad key, API off, quota) comes as a load error
      const ok = await new Promise(res => {
        const t = setTimeout(() => res(!!tiles.root), 12000);
        tiles.addEventListener('load-root-tileset', () => { clearTimeout(t); res(true); });
        tiles.addEventListener('load-error', e => { if (!tiles.root) { clearTimeout(t); res(false); } });
      });
      if (!ok) { this.dispose(); throw new Error('google-refused'); }
    }
  }

  onModel(scene, tile) {
    const google = this.mode === 'google';
    scene.traverse(o => {
      if (!o.isMesh) return;
      // photogrammetry carries its light in its pictures: draw it unlit even if a tile asks for a lit material
      const m = o.material;
      if (google && m && !m.isMeshBasicMaterial && m.map) {
        o.material = new THREE.MeshBasicMaterial({ map: m.map, color: 0xffffff, side: m.side, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, vertexColors: m.vertexColors });
        m.dispose();
      }
      patchBaked(o.material);
      if (!o.material.isMeshBasicMaterial) o.material.toneMapped = true;
      if (o.material.map) o.material.map.anisotropy = 8;
      if (google) {
        o.geometry.computeBoundsTree({ maxLeafTris: 10 });
        o.castShadow = false;
      }
    });
    // finer ground arrived: its box in our frame (the tile's scene has no parent yet, so it is in ECEF until
    // the group's matrix is applied); only fine tiles matter for the roads
    if (google && (!tile || !(tile.geometricError > 6))) {
      scene.updateMatrixWorld(true);
      _box.setFromObject(scene).applyMatrix4(this.tiles.group.matrixWorld);
      if (_box.max.x - _box.min.x < 1500) this.dispatchEvent({ type: 'ground-changed', bbox: _box.clone() });
    }
  }

  tileBox(x, y, z) {
    const n = 2 ** z, lon0 = x / n * 360 - 180, lon1 = (x + 1) / n * 360 - 180;
    const lat0 = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, lat1 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
    const a = toLocal(lat0, lon0, 0), b = toLocal(lat1, lon1, 0);
    return new THREE.Box3(new THREE.Vector3(Math.min(a.x, b.x), -1e4, Math.min(a.z, b.z)), new THREE.Vector3(Math.max(a.x, b.x), 1e4, Math.max(a.z, b.z)));
  }

  // Height of the ground at (x, z). With the tiles and a hint (a wheel's height) it is the first surface under
  // yHint + 0.6; without one, the lowest surface in the whole column, so tree crowns and awnings over a road are
  // passed through. null when nothing is loaded there. Inside a tunnel (under.js) with a hint at the tunnel's level,
  // the tunnel's floor.
  groundAt(x, z, yHint) {
    if (yHint !== undefined && under.tubes.length) { const f = under.floorAt(x, z, yHint); if (f !== null) return f; }
    if (this.mode === 'open') {
      const g = unproject(x, z), e = this.heights.at(g.lat, g.lon);
      if (e === null) return null;
      // the ellipsoid's surface falls away from the origin's tangent plane by d^2 / 2R
      return e - frame.h - (x * x + z * z) / (2 * 6371000);
    }
    if (!this.tiles) return null;
    if (yHint !== undefined) {
      // the surface right under a wheel: the first thing a ray from just above it meets
      _ray.set(_o.set(x, yHint + 0.6, z), _d); _ray.far = 40; _ray.firstHitOnly = true;
      const h = _ray.intersectObject(this.tiles.group, true);
      _ray.firstHitOnly = false;
      return h.length ? h[0].point.y : null;
    }
    // from 400 m over the ground found so far near here (a shorter ray crosses far fewer tiles), else from 3 km
    const top = this.gRef === undefined ? 9000 : this.gRef + 400;
    _ray.set(_o.set(x, top, z), _d); _ray.far = top + 12000; _ray.firstHitOnly = false;
    let hits = _ray.intersectObject(this.tiles.group, true);
    if (!hits.length && this.gRef !== undefined) { _ray.set(_o.set(x, 9000, z), _d); _ray.far = 21000; hits = _ray.intersectObject(this.tiles.group, true); }
    if (!hits.length) return null;
    const y = hits[hits.length - 1].point.y;
    this.gRef = this.gRef === undefined ? y : this.gRef * 0.98 + y * 0.02;
    return y;
  }

  // First hit along a ray against the world's own surfaces (tiles, terrain is skipped in the open world, buildings).
  raycast(origin, dir, far = 100) {
    _ray.set(origin, dir); _ray.far = far; _ray.firstHitOnly = true;
    let list = this.mode === 'google' && this.tiles ? [this.tiles.group, ...this.extra] : this.extra;
    if (under.meshes.length) list = list.concat(under.meshes); // (a tunnel's walls and roof)
    const hits = _ray.intersectObjects(list, true);
    _ray.firstHitOnly = false;
    if (!hits.length) return null;
    const h = hits[0], n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return { point: h.point, normal: n, distance: h.distance, object: h.object };
  }

  update() {
    if (!this.tiles) return;
    if (this.tiles.stats && this.tiles.stats.failed > 0 && performance.now() - (this.retryAt || 0) > 8000) { this.retryAt = performance.now(); try { this.tiles.resetFailedTiles(); } catch (e) {} }
    this.camera.updateMatrixWorld();
    // the tiles' traversal (2.5 to 5 ms a frame while the camera moves): every second frame, and at once after a
    // jump of the camera (a tile that has come in shows a frame later at most)
    const f = this._uf = (this._uf || 0) + 1, cp = this.camera.position;
    const lp = this._up || (this._up = new THREE.Vector3(Infinity, 0, 0)), jump = cp.distanceToSquared(lp) > 400;
    if (this._ef === undefined) this._ef = /[?&]tileseveryframe/.test(location.search); // (test flag: the old way)
    if (!jump && f - (this._ul || 0) < 2 && !this._ef) return;
    this._ul = f; lp.copy(cp);
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.update();
    if (this.mode === 'google') {
      const a = this.tiles.getAttributions ? this.tiles.getAttributions() : [];
      const s = a.map(x => x.value).filter(v => typeof v === 'string').join('; ');
      if (s !== this.attributions) { this.attributions = s; this.dispatchEvent({ type: 'attributions', text: s }); }
    }
  }

  dispose() {
    this.gRef = undefined;
    under.setGround(null);
    if (this.tiles) { this.root.remove(this.tiles.group); this.tiles.dispose(); this.tiles = null; }
    this.heights = null;
  }
}
