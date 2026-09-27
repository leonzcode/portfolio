/* ---------------------------------------------------------------------------
   Kart bodies and wheels from Kenney's Car Kit (CC0, kenney.nl; the licence is
   in models/kit/License.txt).

   The kit paints its models from one small palette texture: every face points
   at one square of it. Read once, those squares become colours on the
   vertices, which is how every other part of a kart in this game is coloured,
   so a model body merges into the same one-material mesh as the code-built
   parts and costs no more to draw. The main colour of each body - whichever
   bright colour covers most of it - is marked, and that is the colour the
   player's paint replaces.

   The kit's cars face +z and a kart's front is -z, so everything is turned
   round as it is read. Until the kit has loaded a kart is built entirely in
   code, exactly as before.
--------------------------------------------------------------------------- */
import { GLTFLoader } from '/legacy/vendor/three-addons-0.163.0/loaders/GLTFLoader.js';
const THREE = window.THREE;

const kit = {};               // name -> { parts: {node: baked}, wheels: [{x,y,z}], char: {x,y,z}|null }
const waiting = [];
let started = false, ready = false;
export function kitReady() { return ready; }
export function whenKit(fn) { if (ready) fn(); else waiting.push(fn); }
export function kitModel(name) { return kit[name] || null; }

export function loadKit(base, names) {
  if (started) return;
  started = true;
  const loader = new GLTFLoader();
  let left = names.length;
  const done = () => {
    if (--left > 0) return;
    ready = true;
    for (const fn of waiting.splice(0)) { try { fn(); } catch (e) { console.warn(e); } }
  };
  for (const n of names) {
    loader.load(base + n + '.glb', gltf => {
      try { kit[n] = bake(gltf); } catch (e) { console.warn('kit', n, e); }
      done();
    }, undefined, done);
  }
}

// the palette, read into pixels once per texture
const pixels = new Map();
function palette(tex) {
  if (pixels.has(tex)) return pixels.get(tex);
  const img = tex.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const p = { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
  pixels.set(tex, p);
  return p;
}

function bake(gltf) {
  const scene = gltf.scene;
  scene.rotation.y = Math.PI;
  scene.updateMatrixWorld(true);
  const out = { parts: {}, wheels: [], char: null };
  const col = new THREE.Color();
  scene.traverse(o => {
    if (!o.isMesh) return;
    // a node's mesh can come back as "name_1"; the node's own name is the one wanted
    const name = (o.name || (o.parent && o.parent.name) || '').replace(/_\d+$/, '');
    const at = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    if (/wheel/.test(name)) out.wheels.push({ name, x: at.x, y: at.y, z: at.z });
    if (/character/.test(name)) { out.char = { x: at.x, y: at.y, z: at.z }; return; }
    const g = o.geometry.index !== null ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, U = g.attributes.uv;
    const map = o.material && o.material.map;
    const pal = map && map.image ? palette(map) : null;
    const cols = new Float32Array(P.count * 3);
    const keys = new Array(P.count);
    for (let i = 0; i < P.count; i++) {
      let r = 0.8, gg = 0.8, b = 0.8;
      if (pal && U) {
        const x = Math.min(pal.w - 1, Math.max(0, Math.floor(U.getX(i) * pal.w)));
        const y = Math.min(pal.h - 1, Math.max(0, Math.floor(U.getY(i) * pal.h)));
        const k = (y * pal.w + x) * 4;
        r = pal.d[k] / 255; gg = pal.d[k + 1] / 255; b = pal.d[k + 2] / 255;
      }
      keys[i] = ((r * 255) | 0) + ',' + ((gg * 255) | 0) + ',' + ((b * 255) | 0);
      col.setRGB(r, gg, b, THREE.SRGBColorSpace);
      cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
    }
    // the main colour: the bright, saturated one covering the most area
    const area = {};
    const a = new THREE.Vector3(), b2 = new THREE.Vector3(), c2 = new THREE.Vector3();
    for (let i = 0; i < P.count; i += 3) {
      a.fromBufferAttribute(P, i); b2.fromBufferAttribute(P, i + 1); c2.fromBufferAttribute(P, i + 2);
      const s = b2.sub(a).cross(c2.sub(a)).length() / 2;
      area[keys[i]] = (area[keys[i]] || 0) + s;
    }
    /* Painted in families, not single swatches: a body's red is a light red,
       a red and a dark red on different faces, and repainting only one of them
       left a patchwork. So every bright colour near the main colour's hue is
       the main colour, and keeps its own lightness against it; the next
       family of hues is the trim. */
    const hsv = k => {
      const [r, g2, b] = k.split(',').map(Number), mx = Math.max(r, g2, b), mn = Math.min(r, g2, b);
      let h = 0;
      if (mx !== mn) h = mx === r ? ((g2 - b) / (mx - mn) + 6) % 6 : mx === g2 ? (b - r) / (mx - mn) + 2 : (r - g2) / (mx - mn) + 4;
      return { h: h * 60, s: mx < 60 ? 0 : (mx - mn) / mx, v: mx / 255 };
    };
    const bright = Object.keys(area).filter(k => hsv(k).s > 0.3).sort((x, y) => area[y] - area[x]);
    const near = (a1, b1) => { const d = Math.abs(hsv(a1).h - hsv(b1).h); return Math.min(d, 360 - d) < 25; };
    const main = bright[0] || null;
    const second = main ? bright.find(k => !near(k, main)) || null : null;
    const family = {};
    for (const k of bright) {
      if (main && near(k, main)) family[k] = { to: 'paint', v: hsv(k).v / hsv(main).v };
      else if (second && near(k, second)) family[k] = { to: 'trim', v: hsv(k).v / hsv(second).v };
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', P.clone());
    g2.setAttribute('normal', g.attributes.normal.clone());
    out.parts[name] = { g: g2, cols, keys, family };
  });
  return out;
}

/* A part ready to merge: its geometry scaled and moved, its main colour (and,
   if asked, its second) repainted. */
export function kitPart(model, node, { scale = 1, dx = 0, dy = 0, dz = 0, paint = null, trim = null } = {}) {
  const m = kit[model];
  const p = m && m.parts[node];
  if (!p) return null;
  const g = p.g.clone();
  g.scale(scale, scale, scale);
  g.translate(dx, dy, dz);
  const cols = p.cols.slice();
  const c = new THREE.Color();
  if (paint !== null || trim !== null) {
    for (let i = 0; i < p.keys.length; i++) {
      const f = p.family[p.keys[i]];
      if (!f) continue;
      const hex = f.to === 'paint' ? paint : trim;
      if (hex === null || hex === undefined) continue;
      c.setHex(hex).multiplyScalar(Math.min(1.25, f.v));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
  }
  return { g, cols };
}
