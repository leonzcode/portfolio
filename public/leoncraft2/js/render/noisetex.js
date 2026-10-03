/* Leoncraft 2 - noise textures, made once at start.
   2D: 256 x 256, four channels of tiling fractal noise (water detail,
   caustics, cloud coverage). 3D: 64^3 tiling Perlin-Worley, the usual
   building block for volumetric clouds (billowy edges, not smoke). */
const THREE = window.THREE;

function tileNoise2(size, period, seed) {
  // value noise on a grid that wraps, smoothed
  const g = new Float32Array(period * period);
  let s = seed >>> 0;
  for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * period, fy = y / size * period;
    const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
    const a = g[(iy % period) * period + ix % period], b = g[(iy % period) * period + (ix + 1) % period];
    const c = g[((iy + 1) % period) * period + ix % period], d = g[((iy + 1) % period) * period + (ix + 1) % period];
    out[y * size + x] = (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
  }
  return out;
}
function fbm2(size, base, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 0.5, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const n = tileNoise2(size, base << o, seed + o * 1013);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

export function makeNoise2D() {
  const S = 256;
  const ch = [fbm2(S, 8, 5, 11), fbm2(S, 8, 5, 77), fbm2(S, 16, 4, 191), fbm2(S, 4, 6, 403)];
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 4; c++) {
    // stretch each channel to fill 0..1
    data[i * 4 + c] = Math.max(0, Math.min(255, ((ch[c][i] - 0.5) * 1.9 + 0.5) * 255));
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function makeNoise3D() {
  const S = 64;
  const data = new Uint8Array(S * S * S * 4);
  // Worley: distance to the nearest of a wrapping grid of random points
  const worley = (cells, seed) => {
    const pts = new Float32Array(cells * cells * cells * 3);
    let s = seed >>> 0;
    const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < pts.length; i++) pts[i] = r();
    const out = new Float32Array(S * S * S);
    for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = x / S * cells, py = y / S * cells, pz = z / S * cells;
      const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
      let best = 9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        const wx = ((nx % cells) + cells) % cells, wy = ((ny % cells) + cells) % cells, wz = ((nz % cells) + cells) % cells;
        const k = ((wz * cells + wy) * cells + wx) * 3;
        const qx = nx + pts[k] - px, qy = ny + pts[k + 1] - py, qz = nz + pts[k + 2] - pz;
        const d = qx * qx + qy * qy + qz * qz;
        if (d < best) best = d;
      }
      out[(z * S + y) * S + x] = Math.sqrt(best);
    }
    return out;
  };
  const w1 = worley(4, 17), w2 = worley(8, 29), w3 = worley(16, 43);
  for (let i = 0; i < S * S * S; i++) {
    // inverted, so the cells are puffs; several sizes, the bigger counting more
    const a = 1 - Math.min(1, w1[i] * 1.2), b = 1 - Math.min(1, w2[i] * 1.2), c = 1 - Math.min(1, w3[i] * 1.2);
    data[i * 4] = (1 - (a * 0.625 + b * 0.25 + c * 0.125)) * 255;
    data[i * 4 + 1] = (1 - b) * 255;
    data[i * 4 + 2] = (1 - c) * 255;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.Data3DTexture(data, S, S, S);
  t.format = THREE.RGBAFormat;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
