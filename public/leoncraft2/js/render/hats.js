/* ---------------------------------------------------------------------------
   Leoncraft 2 - the lobby's hats (net/cosdata.js HATS) as a mesh on the
   head: each box unwrapped as a skin's box is, packed into a 128 x 128
   picture painted here (its colour with a little grain, or a painter's
   pattern), every vertex on the head's part (aPart 0) and in the hat layer
   (1: alpha-tested, both sides), so render/avatar.js draws it with the
   body's own shader, lit and shadowed as the head is.
--------------------------------------------------------------------------- */
const THREE = window.THREE;
export const HAT_TEX = 128;

// faces as avatar.js lays them: normal, corners (from outside: top left, top right, bottom right, bottom left), uv rect
function faces(u, v, w, h, d) {
  return [
    [[0, 0, 1], [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]], [u + d, v + d, u + d + w, v + d + h]],
    [[0, 0, -1], [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]],
    [[-1, 0, 0], [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]], [u, v + d, u + d, v + d + h]],
    [[1, 0, 0], [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]], [u + d + w, v + d, u + 2 * d + w, v + d + h]],
    [[0, 1, 0], [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], [u + d, v, u + d + w, v + d]],
    [[0, -1, 0], [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]], [u + d + w, v, u + d + 2 * w, v + d]],
  ];
}
const tx = n => Math.max(1, Math.ceil(n - 1e-6));

// a small fixed noise (the same hat looks the same on every page)
function grain(i) { let x = (i * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x & 1023) / 1023; }

/* Build a hat: { geometry, paint(ctx) }. The geometry's uvs point into a HAT_TEX square; paint draws the picture. */
export function hatParts(def) {
  const P = [], N = [], T = [], A = [], I = [], regions = [];
  // shelf packing of every box's unwrapped picture
  let sx = 0, sy = 0, rowH = 0;
  const m = new THREE.Matrix4(), e = new THREE.Euler(), v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const box of def.boxes) {
    const [cx, cy, cz, w, h, d, , opts] = box;
    const W = tx(w), Hh = tx(h), D = tx(d), uw = 2 * (W + D), uh = D + Hh;
    if (sx + uw > HAT_TEX) { sx = 0; sy += rowH; rowH = 0; }
    if (sy + uh > HAT_TEX) break;          // (a hat too big for its picture loses its last boxes)
    const u0 = sx, v0 = sy;
    sx += uw; rowH = Math.max(rowH, uh);
    regions.push({ box, u0, v0, W, H: Hh, D });
    const rot = opts && opts.rot;
    if (rot) { e.set(rot[0] * Math.PI / 180, rot[1] * Math.PI / 180, rot[2] * Math.PI / 180, 'XYZ'); m.makeRotationFromEuler(e); } else m.identity();
    for (const [nn, corners, r] of faces(u0, v0, W, Hh, D)) {
      const b0 = P.length / 3;
      const UV = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
      n.set(nn[0], nn[1], nn[2]).applyMatrix4(m).normalize();
      for (let k = 0; k < 4; k++) {
        const c = corners[k];
        v.set(c[0] * w / 2, c[1] * h / 2, c[2] * d / 2).applyMatrix4(m);
        P.push(cx + v.x, cy + v.y, cz + v.z);
        N.push(n.x, n.y, n.z);
        T.push(UV[k][0] / HAT_TEX, UV[k][1] / HAT_TEX);
        A.push(0, 1);
      }
      I.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(A, 2));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 64);
  return { geometry: g, paint: ctx => paintHat(ctx, regions) };
}

const rgb = (c, k = 1) => [Math.min(255, ((c >> 16) & 255) * k), Math.min(255, ((c >> 8) & 255) * k), Math.min(255, (c & 255) * k)];
function paintHat(ctx, regions) {
  ctx.clearRect(0, 0, HAT_TEX, HAT_TEX);
  const img = ctx.getImageData(0, 0, HAT_TEX, HAT_TEX), px = img.data;
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= HAT_TEX || y >= HAT_TEX) return; const o = (y * HAT_TEX + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; };
  let seed = 1;
  for (const R of regions) {
    const [, , , , , , colour, opts] = R.box, paint = opts && opts.paint, dim = opts && opts.dim !== undefined ? opts.dim : 0.07;
    const { u0, v0, W, H, D } = R;
    // each face's rectangle, as faces() lays them: [x0, y0, w, h, face]
    const rects = [[u0 + D, v0 + D, W, H, 0], [u0 + 2 * D + W, v0 + D, W, H, 1], [u0, v0 + D, D, H, 2], [u0 + D + W, v0 + D, D, H, 3], [u0 + D, v0, W, D, 4], [u0 + D + W, v0, W, D, 5]];
    for (const [x0, y0, w, h, f] of rects) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let k = 1 + (grain(seed++) - 0.5) * 2 * dim;
      let c = colour;
      if (paint === 'stripes' && f < 4) k *= y % 2 ? 0.82 : 1.05;
      if (paint === 'pumpkin') {
        if (f < 4 || f === 4) k *= x % 2 ? 0.88 : 1.04;
        if (f === 0) {
          // a jack-o'-lantern's face, lit from inside: two eyes and a grin
          const fx = x / Math.max(1, w - 1), fy = y / Math.max(1, h - 1);
          const eye = fy > 0.25 && fy < 0.48 && ((fx > 0.15 && fx < 0.38) || (fx > 0.62 && fx < 0.85)) && Math.abs((fx < 0.5 ? fx - 0.265 : fx - 0.735)) < (fy - 0.22) * 0.9;
          const grin = fy > 0.62 && fy < 0.82 && fx > 0.18 && fx < 0.82 && !(fy < 0.7 && (Math.abs(fx - 0.38) < 0.06 || Math.abs(fx - 0.62) < 0.06));
          if (eye || grin) { c = 0xffd23a; k = 1 + (grain(seed) - 0.5) * 0.1; }
        }
      }
      if (paint === 'visor' && f === 0) { const g = y / Math.max(1, h - 1); c = 0x203a78; k = 0.75 + 0.6 * (1 - g); if (x + y === Math.floor((w + h) / 3) || x + y === Math.floor((w + h) / 3) + 1) k = 1.9; }
      if (paint === 'slit' && f === 0) { const g = y / Math.max(1, h - 1); if (g > 0.38 && g < 0.48 && x > 0 && x < w - 1) { c = 0x101010; k = 1; } else if (g > 0.6 && g < 0.85 && x % 2 === 1 && Math.abs(x - w / 2) < w / 3 && y % 2 === 0) { c = 0x202020; k = 1; } }
      put(x0 + x, y0 + y, rgb(c, k));
    }
  }
  ctx.putImageData(img, 0, 0);
}
