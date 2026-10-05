/* ---------------------------------------------------------------------------
   Leoncraft 2 - one block as a little mesh, for your hand.

   The same vertex format and the same box models as the world (see
   mesher.js and models.js), so a held stair is a stair, a held fence a fence
   post, and a plant or a door is its flat item picture, as in the game.
   Positions are centred on the block, lifted by one so they stay positive
   in the unsigned vertex format (the shader takes off 8, 0, 8).
--------------------------------------------------------------------------- */
import { boxesOf } from '../models.js?v=14';
const THREE = window.THREE;

const FACES = [
  { n: [1, 0, 0], t: [0, 0, -1], b: [0, -1, 0] }, { n: [-1, 0, 0], t: [0, 0, 1], b: [0, -1, 0] },
  { n: [0, 1, 0], t: [1, 0, 0], b: [0, 0, 1] }, { n: [0, -1, 0], t: [1, 0, 0], b: [0, 0, -1] },
  { n: [0, 0, 1], t: [1, 0, 0], b: [0, -1, 0] }, { n: [0, 0, -1], t: [-1, 0, 0], b: [0, -1, 0] },
];
const CORNERS = [[0, 1], [1, 1], [1, 0], [0, 0]];
const TINTS = { grass: 0x79c05a, foliage: 0x59ae30, water: 0x3f76e4, spruce: 0x619961, birch: 0x80a755, redstone: 0xb00000 };
// shapes that are held as a flat picture
const FLAT = new Set(['cross', 'torch', 'wall_torch', 'rail', 'wire', 'crop', 'vine', 'pad', 'door', 'ladder', 'fluid', 'none', 'sign', 'wall_sign', 'candle', 'chain', 'lantern', 'bed', 'pot']);

/* The pixels of every texture layer (16 x 16 RGBA, 1024 bytes a layer), from
   the item icons: with them a flat item is drawn the game's way, its picture
   given a sixteenth of thickness, every pixel's edge a little side face. */
let PIX = null;
export function setLayerPixels(px) { PIX = px; }

export function isFlatItem(d) { return !!d && (FLAT.has(d.shape) || (d.iconLayer !== undefined && d.shape !== 'cube' && d.shape !== 'slab' && d.shape !== 'stairs')); }

/* The shield in a hand, as the game's shield model: a board 12 x 22 x 1
   pixels with a handle 2 x 6 x 6 behind it (its boxes, turned over as the
   game turns the model into the item's space). Our own look, from block
   textures: upright boards in an iron rim, a darker wooden handle.
   layers: { wood, rim, handle }. It sits half a block higher than a block
   would, so every corner stays in the unsigned vertex range; the shield's
   DISPLAY entries in held.js take that back off. */
export function shieldGeometry(layers) {
  const verts = [], A = [], L = [], C = [], idx = [];
  // a box from the game's model numbers (pixels, y down, -z the front), with a layer, a tint and a turn of its texture
  const box = (x, y, z, w, h, d, layer, tint, rot) => {
    const f = [x, 8 - (y + h), -(z + d)], t = [x + w, 8 - y, -z];
    const size = [w, h, d];
    for (let fi = 0; fi < 6; fi++) {
      const F = FACES[fi];
      let kt = 0, kb = 0;
      for (let k = 0; k < 3; k++) { if (F.t[k]) kt = k; if (F.b[k]) kb = k; }
      // the face's texture: as many pixels as it is wide and tall (turned or not), no more than one tile
      const uw = Math.min(16, size[kt]), vh = Math.min(16, size[kb]);
      const v0 = verts.length / 4;
      for (let c = 0; c < 4; c++) {
        const [u, v] = CORNERS[c], P = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          if (F.n[k]) P[k] = F.n[k] > 0 ? t[k] : f[k];
          else if (k === kt) P[k] = (F.t[k] > 0) === (u === 1) ? t[k] : f[k];
          else P[k] = (F.b[k] > 0) === (v === 1) ? t[k] : f[k];
        }
        verts.push(Math.round((P[0] / 16 + 7.5) * 32), Math.round((P[1] / 16 + 0.5) * 32), Math.round((P[2] / 16 + 7.5) * 32), layer);
        A.push(u ? uw : 0, v ? vh : 0, fi, 3 | (rot ? 4 : 0) | (tint !== 0xffffff ? 64 : 0));
        L.push(255, 0, 0, 0);
        C.push(tint >> 16, (tint >> 8) & 255, tint & 255, 255);
      }
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
  };
  const W = 0xffffff, IRON = 0xb4b4bc;
  // the boards, upright, in two parts so the texture is never stretched
  box(-5, -10, -2, 10, 16, 1, layers.wood, W, 1);
  box(-5, 6, -2, 10, 4, 1, layers.wood, W, 1);
  // the rim: down both sides, across the top and the bottom
  box(-6, -11, -2, 1, 22, 1, layers.rim, IRON, 0);
  box(5, -11, -2, 1, 22, 1, layers.rim, IRON, 0);
  box(-5, -11, -2, 10, 1, 1, layers.rim, IRON, 0);
  box(-5, 10, -2, 10, 1, 1, layers.rim, IRON, 0);
  // the handle behind
  box(-1, -3, -1, 2, 6, 6, layers.handle, W, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('aPos', new THREE.BufferAttribute(new Uint16Array(verts), 4));
  g.setAttribute('aA', new THREE.BufferAttribute(new Uint8Array(A), 4));
  g.setAttribute('aL', new THREE.BufferAttribute(new Uint8Array(L), 4));
  g.setAttribute('aC', new THREE.BufferAttribute(new Uint8Array(C), 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return { geometry: g, flat: false, cutout: false };
}

export function blockGeometry(d, meta) {
  const verts = [], A = [], L = [], C = [], idx = [];
  const tint = TINTS[d.tint] || 0xffffff, tinted = d.tint ? 64 : 0;
  const put = (x, y, z, layer, u, v, n, flags) => {
    verts.push(Math.round((x + 8) * 32), Math.round((y + 1) * 32), Math.round((z + 8) * 32), layer);
    A.push(u, v, n, 3 | flags);
    L.push(255, 0, 0, 0);
    C.push(tint >> 16, (tint >> 8) & 255, tint & 255, 255);
  };
  const flat = isFlatItem(d);
  if (flat) {
    // the item picture: its own sprite when it has one, else the block's texture
    const layer = d.iconLayer !== undefined ? d.iconLayer : d.faces[2];
    if (PIX && PIX.length >= (layer + 1) * 1024) {
      // the picture with a sixteenth of thickness: front, back, and the edge of every solid pixel
      const o = layer * 1024, h = 1 / 32, solid = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && PIX[o + (y * 16 + x) * 4 + 3] >= 128;
      const quad = (a, b, c, e, n, u0, v0t, u1, v1) => {
        const k = verts.length / 4;
        put(a[0], a[1], a[2], layer, u0, v1, n, tinted | 3); put(b[0], b[1], b[2], layer, u1, v1, n, tinted | 3);
        put(c[0], c[1], c[2], layer, u1, v0t, n, tinted | 3); put(e[0], e[1], e[2], layer, u0, v0t, n, tinted | 3);
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
      };
      quad([-0.5, -0.5, h], [0.5, -0.5, h], [0.5, 0.5, h], [-0.5, 0.5, h], 4, 0, 0, 16, 16);
      quad([0.5, -0.5, -h], [-0.5, -0.5, -h], [-0.5, 0.5, -h], [0.5, 0.5, -h], 5, 16, 0, 0, 16);
      for (let py = 0; py < 16; py++) for (let px = 0; px < 16; px++) {
        if (!solid(px, py)) continue;
        const x0 = -0.5 + px / 16, x1 = x0 + 1 / 16, y1 = 0.5 - py / 16, y0 = y1 - 1 / 16;
        if (!solid(px - 1, py)) quad([x0, y0, -h], [x0, y0, h], [x0, y1, h], [x0, y1, -h], 1, px, py, px + 1, py + 1);
        if (!solid(px + 1, py)) quad([x1, y0, h], [x1, y0, -h], [x1, y1, -h], [x1, y1, h], 0, px, py, px + 1, py + 1);
        if (!solid(px, py - 1)) quad([x0, y1, h], [x1, y1, h], [x1, y1, -h], [x0, y1, -h], 2, px, py, px + 1, py + 1);
        if (!solid(px, py + 1)) quad([x0, y0, -h], [x1, y0, -h], [x1, y0, h], [x0, y0, h], 3, px, py, px + 1, py + 1);
      }
    } else {
      const v0 = verts.length / 4;
      put(-0.5, -0.5, 0, layer, 0, 16, 4, tinted | 32); put(0.5, -0.5, 0, layer, 16, 16, 4, tinted | 32);
      put(0.5, 0.5, 0, layer, 16, 0, 4, tinted | 32); put(-0.5, 0.5, 0, layer, 0, 0, 4, tinted | 32);
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
  } else {
    let boxes = boxesOf(d, meta || d.iconMeta || 0, () => null);
    if (!boxes) {
      const h = d.shape === 'snow' ? (d.height || 0.125) * 16 : 16, s = d.shape === 'cactus' ? 1 : 0;
      boxes = [{ f: [s, 0, s], t: [16 - s, h, 16 - s] }];
    }
    for (const bx of boxes) {
      if (bx.q) {
        const v0 = verts.length / 4, [u0, v0t, u1, v1] = bx.uv;
        const uv = [[u0, v1], [u1, v1], [u1, v0t], [u0, v0t]];
        for (let c = 0; c < 4; c++) put(bx.q[c][0] / 16 - 0.5, bx.q[c][1] / 16 - 0.5, bx.q[c][2] / 16 - 0.5, bx.layer, uv[c][0], uv[c][1], 2, tinted | 32);
        idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        continue;
      }
      const faces = bx.faces || d.faces;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        let kt = 0, kb = 0;
        for (let k = 0; k < 3; k++) { if (F.t[k]) kt = k; if (F.b[k]) kb = k; }
        let layer = faces[f], flags = tinted;
        if (!bx.faces) {
          if (d.front !== undefined && f === 4) layer = d.front;
          if (d.overlay !== undefined && f !== 2 && f !== 3) flags = 16 | 64;
          else if (d.overlay !== undefined && f === 3) flags = 0;
        }
        const v0 = verts.length / 4;
        for (let c = 0; c < 4; c++) {
          const [u, v] = CORNERS[c], P = [0, 0, 0];
          for (let k = 0; k < 3; k++) {
            if (F.n[k]) P[k] = F.n[k] > 0 ? bx.t[k] : bx.f[k];
            else if (k === kt) P[k] = (F.t[k] > 0) === (u === 1) ? bx.t[k] : bx.f[k];
            else P[k] = (F.b[k] > 0) === (v === 1) ? bx.t[k] : bx.f[k];
          }
          let tu = F.t[kt] > 0 ? P[kt] : 16 - P[kt], tv = F.b[kb] > 0 ? P[kb] : 16 - P[kb];
          const r = bx.uv && bx.uv[f];
          if (r) { tu = u ? r[2] : r[0]; tv = v ? r[3] : r[1]; }
          put(P[0] / 16 - 0.5, P[1] / 16 - 0.5, P[2] / 16 - 0.5, layer, tu, tv, f, flags);
        }
        idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('aPos', new THREE.BufferAttribute(new Uint16Array(verts), 4));
  g.setAttribute('aA', new THREE.BufferAttribute(new Uint8Array(A), 4));
  g.setAttribute('aL', new THREE.BufferAttribute(new Uint8Array(L), 4));
  g.setAttribute('aC', new THREE.BufferAttribute(new Uint8Array(C), 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  return { geometry: g, flat, cutout: flat || d.pass !== 'opaque' };
}
