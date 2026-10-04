/* ---------------------------------------------------------------------------
   Leoncraft 2 - one block as a little mesh, for your hand.

   The same vertex format and the same box models as the world (see
   mesher.js and models.js), so a held stair is a stair, a held fence a fence
   post, and a plant or a door is its flat item picture, as in the game.
   Positions are centred on the block, lifted by one so they stay positive
   in the unsigned vertex format (the shader takes off 8, 0, 8).
--------------------------------------------------------------------------- */
import { boxesOf } from '../models.js?v=8';
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

export function isFlatItem(d) { return !!d && (FLAT.has(d.shape) || (d.iconLayer !== undefined && d.shape !== 'cube' && d.shape !== 'slab' && d.shape !== 'stairs')); }

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
    const v0 = verts.length / 4;
    put(-0.5, -0.5, 0, layer, 0, 16, 4, tinted | 32); put(0.5, -0.5, 0, layer, 16, 16, 4, tinted | 32);
    put(0.5, 0.5, 0, layer, 16, 0, 4, tinted | 32); put(-0.5, 0.5, 0, layer, 0, 0, 4, tinted | 32);
    idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
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
