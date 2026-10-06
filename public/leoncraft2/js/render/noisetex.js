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

/* The volumetric clouds' 3D noise (64 x 64 x 64, half a second of work), as
   bytes. Self-contained, so it can also run in a worker (makeNoise3DAsync). */
function noise3DData() {
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
  return data;
}
function noise3DTexture(data) {
  const S = 64;
  const t = new THREE.Data3DTexture(data, S, S, S);
  t.format = THREE.RGBAFormat;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
export function makeNoise3D() { return noise3DTexture(noise3DData()); }

/* The same noise drawn by the graphics card, a layer at a time into a 64^3
   target: the random points are the same ones (made here, a few thousand),
   so it is the same picture, made in well under a millisecond instead of
   half a second or more of work. (Made in a worker before: starting a worker
   held this thread up for a third of a second to a second, on the very
   frame Shader Options changed.) Its small shader is built in the background
   first, then eight layers are drawn a frame; the promise gives the texture
   once they all are. */
const NOISE_VS = `in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const NOISE_FS = `precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPts[3];
uniform float uZ;
out vec4 fragColor;
// distance to the nearest point of a wrapping grid of cells (one random point each)
float worley(sampler2D pts, int cells, vec3 v) {
  vec3 p = v / 64.0 * float(cells);
  ivec3 c = ivec3(floor(p));
  float best = 9.0;
  for (int dz = -1; dz <= 1; dz++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    ivec3 n = c + ivec3(dx, dy, dz);
    ivec3 w = (n + cells) % cells;
    vec3 q = vec3(n) + texelFetch(pts, ivec2(w.x, w.y + w.z * cells), 0).xyz - p;
    best = min(best, dot(q, q));
  }
  return sqrt(best);
}
void main() {
  vec3 v = vec3(floor(gl_FragCoord.xy), uZ);
  // inverted, so the cells are puffs; several sizes, the bigger counting more
  float a = 1.0 - min(1.0, worley(uPts[0], 4, v) * 1.2);
  float b = 1.0 - min(1.0, worley(uPts[1], 8, v) * 1.2);
  float c = 1.0 - min(1.0, worley(uPts[2], 16, v) * 1.2);
  fragColor = vec4(1.0 - (a * 0.625 + b * 0.25 + c * 0.125), 1.0 - b, 1.0 - c, 1.0);
}`;
export function makeNoise3DGPU(r) {
  const S = 64;
  // the points noise3DData uses: the same generator and seeds, one texel each (x, y + z * cells)
  const points = (cells, seed) => {
    const d = new Float32Array(cells * cells * cells * 4);
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < cells * cells * cells; i++) { d[i * 4] = rnd(); d[i * 4 + 1] = rnd(); d[i * 4 + 2] = rnd(); }
    const t = new THREE.DataTexture(d, cells, cells * cells, THREE.RGBAFormat, THREE.FloatType);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const pts = [points(4, 17), points(8, 29), points(16, 43)];
  const mat = new THREE.RawShaderMaterial({
    vertexShader: NOISE_VS, fragmentShader: NOISE_FS,
    uniforms: { uPts: { value: pts }, uZ: { value: 0 } }, glslVersion: THREE.GLSL3,
    depthTest: false, depthWrite: false,
  });
  const rt = new THREE.WebGL3DRenderTarget(S, S, S, { depthBuffer: false });
  const t = rt.texture;
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(mesh);
  // eight layers a frame, so no one frame pays for all sixty-four draws
  return new Promise(resolve => {
    let z = 0;
    const layers = () => {
      const prev = r.getRenderTarget(), clear = r.autoClear;
      r.autoClear = false;
      for (const end = Math.min(S, z + 8); z < end; z++) {
        mat.uniforms.uZ.value = z;
        r.setRenderTarget(rt, z);
        r.render(scene, cam);
      }
      r.setRenderTarget(prev);
      r.autoClear = clear;
      if (z < S) { requestAnimationFrame(layers); return; }
      mat.dispose(); geo.dispose();
      for (const p of pts) p.dispose();
      resolve(t);
    };
    (r.compileAsync ? r.compileAsync(scene, cam) : Promise.resolve()).then(layers, layers);
  });
}
/* The same, made in a worker so turning on the full chain (Shader Options)
   never stops the game for it; at once in this thread if there are no
   workers to be had. */
export function makeNoise3DAsync() {
  return new Promise(resolve => {
    let w;
    try {
      const src = 'const f = ' + noise3DData.toString() + ';\nconst d = f(); postMessage(d, [d.buffer]);';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      w = new Worker(url);
      URL.revokeObjectURL(url);
    } catch (e) { resolve(makeNoise3D()); return; }
    w.onmessage = e => { w.terminate(); resolve(noise3DTexture(e.data)); };
    w.onerror = () => { w.terminate(); resolve(makeNoise3D()); };
  });
}
