/* ---------------------------------------------------------------------------
   The city.

   It is generated rather than modelled, because a modelled city is gigabytes and
   this one has to arrive over a web connection. The trick to making a generated
   city look like a place rather than a spreadsheet is variety in the right places:
   blocks are not all the same size, buildings on a block are not all the same
   height, the ground floor is a shop rather than more office windows, and the
   floors line up across the whole street.

   Two things do most of the visual work here:

   * Facades are mapped from world position, not from the box's own UVs. A window
     is therefore always the same size whether it is on a four storey shop or a
     forty storey tower, and every building on a street shares a floor line. This
     is the single biggest difference between "generated city" and "city".
   * Everything repeated is instanced, so a few hundred thousand square metres of
     city costs a few dozen draw calls and the frame budget goes on lighting.

   Coordinates: x/z is the ground plane, y is up. One unit is one metre.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

export const CITY = {
  block: 62,          // one city block, kerb to kerb
  road: 15,           // road width between kerbs
  pave: 3.2,          // pavement width
  grid: 9,            // blocks across, so 9x9 with roads between
};
CITY.pitch = CITY.block + CITY.road;
CITY.half = (CITY.grid * CITY.pitch) / 2;

const FLOOR = 3.2;             // one storey
const BASE = 4.4;              // the shopfront storey at the bottom
const KERB = 0.28;             // how far the pavement stands above the road
const TILE_M = 16;             // one facade texture covers 16 m, which is five floors
const GROUND = KERB + BASE;    // where the upper floors start

/* A repeatable random, so the city is the same city every time it is built and
   everybody on the server is walking round the same place. */
export function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function canvasTex(w, h, draw, repeat, clampV) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = clampV ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}
const hex = (r, g, b) => 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/* ---- mapping a texture from world space --------------------------------------
   Injected into the standard material's vertex shader. Side faces take their u
   from world x or z and their v from world y; the top face takes both from x/z.
   Everything the city builds shares one floor grid because of it.              */
let wuvId = 0;
function worldUV(mat, side, off, top) {
  const key = 'wuv' + (++wuvId);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSide = { value: new THREE.Vector2(side[0], side[1]) };
    sh.uniforms.uOff = { value: new THREE.Vector2(off ? off[0] : 0, off ? off[1] : 0) };
    sh.uniforms.uTop = { value: new THREE.Vector2(top ? top[0] : side[0], top ? top[1] : side[0]) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uSide;\nuniform vec2 uOff;\nuniform vec2 uTop;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vec4 wq = vec4( position, 1.0 );
        vec3 nq = normal;
        #ifdef USE_INSTANCING
          wq = instanceMatrix * wq;
          nq = mat3( instanceMatrix ) * nq;
        #endif
        wq = modelMatrix * wq;
        nq = normalize( mat3( modelMatrix ) * nq );
        vec3 aq = abs( nq );
        vec2 pq;
        // the horizontal axis has to run the way a viewer standing in front of
        // the wall reads it, or every other wall comes out mirrored
        if ( aq.y > 0.5 ) pq = wq.xz * uTop;
        else if ( aq.x > aq.z ) pq = vec2( -sign( nq.x ) * wq.z, wq.y ) * uSide + uOff;
        else pq = vec2( sign( nq.z ) * wq.x, wq.y ) * uSide + uOff;
        #ifdef USE_MAP
          vMapUv = pq;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv = pq;
        #endif
      `);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/* ---- facades ----------------------------------------------------------------
   One tile is 16 m square: five storeys of 3.2 m, five window bays of 3.2 m. The
   tile is drawn so its edges land on wall rather than on a window, which is what
   makes it repeat without a visible seam. Lit windows are also written into an
   emissive map so the city lights itself at night instead of going black.     */
const STYLES = [
  { kind: 'grid',    wall: [150, 146, 138], trim: [112, 106, 98],  glass: [58, 74, 92],  lit: 0.26 },
  { kind: 'grid',    wall: [118, 112, 104], trim: [86, 80, 74],    glass: [50, 66, 86],  lit: 0.22 },
  { kind: 'brick',   wall: [134, 78, 62],   trim: [206, 200, 190], glass: [46, 58, 76],  lit: 0.30 },
  { kind: 'brick',   wall: [96, 76, 68],    trim: [184, 178, 170], glass: [44, 56, 72],  lit: 0.28 },
  { kind: 'curtain', wall: [74, 82, 94],    trim: [140, 148, 158], glass: [70, 96, 120], lit: 0.30 },
  { kind: 'curtain', wall: [52, 60, 72],    trim: [110, 120, 132], glass: [54, 82, 108], lit: 0.34 },
  { kind: 'grid',    wall: [178, 170, 154], trim: [132, 124, 112], glass: [62, 78, 96],  lit: 0.24 },
  { kind: 'stone',   wall: [166, 158, 146], trim: [120, 112, 102], glass: [48, 62, 80],  lit: 0.20 },
];

function facade(seed, st) {
  const r = rng(seed);
  const P = 512, rows = 5, cols = 5;
  const cell = P / rows;
  const lit = [];

  const paint = (g) => {
    g.fillStyle = hex(st.wall[0], st.wall[1], st.wall[2]); g.fillRect(0, 0, P, P);

    if (st.kind === 'brick') {
      // courses of brick, each one a slightly different shade
      const bh = 7, bw = 17;
      for (let y = 0; y < P; y += bh) {
        const off = ((y / bh) | 0) % 2 ? bw / 2 : 0;
        for (let x = -bw; x < P; x += bw) {
          const f = 0.86 + r() * 0.3;
          g.fillStyle = hex(st.wall[0] * f, st.wall[1] * f, st.wall[2] * f);
          g.fillRect(x + off + 0.8, y + 0.8, bw - 1.6, bh - 1.6);
        }
      }
    } else if (st.kind === 'stone') {
      for (let y = 0; y < P; y += 16) for (let x = 0; x < P; x += 26) {
        const f = 0.9 + r() * 0.2;
        g.fillStyle = hex(st.wall[0] * f, st.wall[1] * f, st.wall[2] * f);
        g.fillRect(x + 1, y + 1, 24, 14);
      }
    } else {
      // concrete: gentle blotches so a big flat wall is not a flat colour
      for (let i = 0; i < 260; i++) {
        const f = 0.93 + r() * 0.14;
        g.globalAlpha = 0.5;
        g.fillStyle = hex(st.wall[0] * f, st.wall[1] * f, st.wall[2] * f);
        g.beginPath(); g.arc(r() * P, r() * P, 6 + r() * 30, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
    }

    // floor slabs: a band of trim at every storey
    for (let y = 0; y < rows; y++) {
      const fy = y * cell;
      g.fillStyle = hex(st.trim[0], st.trim[1], st.trim[2]);
      g.fillRect(0, fy, P, st.kind === 'curtain' ? 9 : 5);
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.fillRect(0, fy + (st.kind === 'curtain' ? 9 : 5), P, 3);
    }

    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const on = r() < st.lit;
      if (st.kind === 'curtain') {
        // a continuous band of glass with slim mullions
        const gx = x * cell, gy = y * cell + 14;
        const gw = cell, gh = cell - 24;
        const grd = g.createLinearGradient(0, gy, 0, gy + gh);
        const top = on ? [255, 232, 186] : mix(st.glass, [150, 186, 214], 0.5);
        const bot = on ? [236, 206, 150] : st.glass;
        grd.addColorStop(0, hex(top[0], top[1], top[2]));
        grd.addColorStop(1, hex(bot[0], bot[1], bot[2]));
        g.fillStyle = grd; g.fillRect(gx, gy, gw, gh);
        g.fillStyle = 'rgba(255,255,255,.10)';
        g.fillRect(gx, gy, gw, gh * 0.30);
        g.fillStyle = hex(st.trim[0], st.trim[1], st.trim[2]);
        g.fillRect(gx + cell - 3, gy - 2, 3, gh + 4);          // the mullion
        if (on) lit.push([gx, gy, gw, gh]);
      } else {
        const ww = cell * (st.kind === 'brick' ? 0.42 : 0.56);
        const wh = cell * 0.56;
        const gx = x * cell + (cell - ww) / 2, gy = y * cell + cell * 0.22;
        g.fillStyle = hex(st.trim[0], st.trim[1], st.trim[2]);  // frame and sill
        g.fillRect(gx - 4, gy - 4, ww + 8, wh + 8);
        g.fillStyle = 'rgba(0,0,0,.28)';
        g.fillRect(gx - 5, gy + wh + 4, ww + 10, 3);
        const grd = g.createLinearGradient(gx, gy, gx + ww, gy + wh);
        const top = on ? [255, 231, 182] : mix(st.glass, [156, 190, 218], 0.55);
        const bot = on ? [228, 192, 128] : mix(st.glass, [0, 0, 0], 0.25);
        grd.addColorStop(0, hex(top[0], top[1], top[2]));
        grd.addColorStop(1, hex(bot[0], bot[1], bot[2]));
        g.fillStyle = grd; g.fillRect(gx, gy, ww, wh);
        g.fillStyle = 'rgba(255,255,255,.14)';                  // a reflection streak
        g.beginPath(); g.moveTo(gx, gy + wh); g.lineTo(gx + ww * 0.55, gy); g.lineTo(gx + ww, gy);
        g.lineTo(gx + ww * 0.45, gy + wh); g.closePath(); g.fill();
        if (!on && r() < 0.35) {                                // blinds, half down
          g.fillStyle = 'rgba(224,220,206,.62)';
          g.fillRect(gx, gy, ww, wh * (0.2 + r() * 0.4));
        }
        g.fillStyle = 'rgba(0,0,0,.35)';                        // the transom bar
        g.fillRect(gx, gy + wh * 0.42, ww, 2);
        if (on) lit.push([gx, gy, ww, wh]);
      }
    }

    // grime: streaks under the sills and in the corners, which is most of what
    // stops a rendered building looking like it was printed yesterday
    for (let i = 0; i < 90; i++) {
      const x = r() * P, y = r() * P, w = 2 + r() * 5, h = 10 + r() * 60;
      g.fillStyle = 'rgba(28,26,24,' + (0.03 + r() * 0.06) + ')';
      g.fillRect(x, y, w, h);
    }
  };

  const tex = canvasTex(P, P, paint);
  const emis = canvasTex(P, P, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, P, P);
    for (const w of lit) {
      const grd = g.createLinearGradient(0, w[1], 0, w[1] + w[3]);
      grd.addColorStop(0, 'rgb(255,226,174)'); grd.addColorStop(1, 'rgb(214,170,104)');
      g.fillStyle = grd; g.fillRect(w[0], w[1], w[2], w[3]);
    }
  });
  return { tex: tex, emis: emis };
}

/* ---- shopfronts -------------------------------------------------------------
   The ground floor, which is the only floor anybody on foot actually looks at.
   Eight metres per tile, so a long building reads as a row of separate shops. */
const SHOP_SIGNS = [
  ['LAUNDRY', '#e05a4a'], ['PHO 24', '#f0b429'], ['LIQUOR', '#3fa9f5'],
  ['TACOS', '#e8523f'], ['BARBER', '#4ac3a1'], ['PAWN', '#d94f8a'],
  ['COFFEE', '#c98a3c'], ['DELI', '#5ec36a'], ['NAILS', '#b07ae0'],
  ['MOTEL', '#ff6b6b'], ['ARCADE', '#7ad3ff'], ['GYM', '#f2f2f2'],
];
function shopTex(seed) {
  const r = rng(seed);
  const UNIT = 512, N = 3;                   // three shops, eight metres each
  const W = UNIT * N, H = 288;
  const picks = [];
  for (let i = 0; i < N; i++) {
    picks.push({
      sign: SHOP_SIGNS[(r() * SHOP_SIGNS.length) | 0],
      awning: ['#a63a34', '#2f6f4f', '#2a4f86', '#6b4a2a', '#3c3f46', '#7a2f5a'][(r() * 6) | 0],
      panes: 2 + ((r() * 2) | 0),
      shut: r() < 0.14,                       // a shuttered unit, every so often
    });
  }

  const one = function (g, x0, sh, emissive) {
    const W1 = UNIT, bandH = 54;
    if (emissive) {
      if (!sh.shut) {
        g.fillStyle = sh.sign[1]; g.globalAlpha = 0.92;
        g.font = 'bold 40px "Segoe UI", Arial'; g.textAlign = 'center';
        g.fillText(sh.sign[0], x0 + W1 / 2, 42); g.globalAlpha = 1;
      }
    } else {
      g.fillStyle = '#1b1a1c'; g.fillRect(x0, 0, W1, bandH);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x0, bandH - 4, W1, 4);
      if (!sh.shut) {
        g.fillStyle = sh.sign[1];
        g.font = 'bold 40px "Segoe UI", Arial'; g.textAlign = 'center';
        g.fillText(sh.sign[0], x0 + W1 / 2, 42);
      }
      g.fillStyle = '#24211e'; g.fillRect(x0 + W1 - 6, 0, 6, H);   // the party wall
    }

    const gy = bandH + 30, gh = H - gy - 22;
    if (sh.shut) {
      if (emissive) return;
      g.fillStyle = '#4a4c50'; g.fillRect(x0 + 14, gy - 10, W1 - 28, gh + 10);
      for (let y = gy - 10; y < gy + gh; y += 7) {
        g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x0 + 14, y, W1 - 28, 3);
      }
      g.fillStyle = 'rgba(210,60,70,.5)';
      g.font = 'bold 26px "Segoe UI", Arial'; g.textAlign = 'center';
      g.fillText('FOR LEASE', x0 + W1 / 2, gy + gh * 0.55);
      return;
    }

    for (let i = 0; i < sh.panes; i++) {
      const pw = (W1 - 44) / sh.panes, px = x0 + 22 + i * pw;
      const door = i === sh.panes - 1;
      if (emissive) {
        const grd = g.createLinearGradient(0, gy, 0, gy + gh);
        grd.addColorStop(0, 'rgb(255,214,150)'); grd.addColorStop(1, 'rgb(150,108,58)');
        g.fillStyle = grd; g.fillRect(px + 6, gy, pw - 12, gh);
      } else {
        const grd = g.createLinearGradient(0, gy, 0, gy + gh);
        grd.addColorStop(0, '#ffe2ad'); grd.addColorStop(0.5, '#c99a58'); grd.addColorStop(1, '#3a2c1c');
        g.fillStyle = grd; g.fillRect(px + 6, gy, pw - 12, gh);
        // whatever is behind the glass, as silhouettes
        g.fillStyle = 'rgba(40,30,20,.45)';
        for (let k = 0; k < 4; k++) {
          const bw = 14 + Math.random() * 40;
          g.fillRect(px + 18 + Math.random() * (pw - 60), gy + gh - 10 - Math.random() * 60, bw, 10 + Math.random() * 50);
        }
        g.fillStyle = 'rgba(255,255,255,.13)';                     // reflection
        g.beginPath(); g.moveTo(px + 6, gy + gh); g.lineTo(px + pw * 0.5, gy); g.lineTo(px + pw * 0.78, gy);
        g.lineTo(px + pw * 0.3, gy + gh); g.closePath(); g.fill();
        g.strokeStyle = '#26241f'; g.lineWidth = 7; g.strokeRect(px + 6, gy, pw - 12, gh);
        if (door) {
          g.strokeStyle = '#1c1a17'; g.lineWidth = 5; g.strokeRect(px + 26, gy + 16, pw - 52, gh - 16);
          g.fillStyle = '#c8b898'; g.fillRect(px + pw - 44, gy + gh * 0.5, 5, 22);   // the handle
        }
      }
    }
    if (!emissive) {
      g.fillStyle = sh.awning;                                     // the awning
      g.beginPath(); g.moveTo(x0 + 10, bandH + 6); g.lineTo(x0 + W1 - 16, bandH + 6);
      g.lineTo(x0 + W1 - 26, bandH + 28); g.lineTo(x0 + 20, bandH + 28); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)';
      for (let k = 0; k < 5; k++) g.fillRect(x0 + 20 + k * (W1 - 46) / 5, bandH + 6, (W1 - 46) / 10, 22);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x0 + 10, bandH + 26, W1 - 26, 4);
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x0, bandH + 30, W1, 12);   // its shadow
    }
  };

  const draw = function (g, emissive) {
    if (emissive) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
    else {
      g.fillStyle = '#4c4842'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 1200; i++) {
        const v = 58 + Math.random() * 30;
        g.fillStyle = 'rgba(' + (v | 0) + ',' + ((v - 3) | 0) + ',' + ((v - 8) | 0) + ',.35)';
        g.fillRect(Math.random() * W, Math.random() * H, 3, 3);
      }
      g.fillStyle = '#2e2b28'; g.fillRect(0, H - 12, W, 12);
    }
    for (let i = 0; i < N; i++) one(g, i * UNIT, picks[i], emissive);
  };

  return {
    tex: canvasTex(W, H, function (g) { draw(g, false); }, null, true),
    emis: canvasTex(W, H, function (g) { draw(g, true); }, null, true),
  };
}

/* ---- the ground ---------------------------------------------------------- */
function asphaltTex() {
  return canvasTex(512, 512, function (g, W, H) {
    g.fillStyle = '#4a4c52'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 14000; i++) {                    // aggregate
      const v = 56 + Math.random() * 40;
      g.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + ((v + 4) | 0) + ',.5)';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    for (let i = 0; i < 60; i++) {                       // patches and old repairs
      const v = 58 + Math.random() * 16;
      g.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + ((v + 3) | 0) + ',.45)';
      g.fillRect(Math.random() * W, Math.random() * H, 30 + Math.random() * 120, 14 + Math.random() * 50);
    }
    for (let i = 0; i < 26; i++) {                       // tar seams
      g.strokeStyle = 'rgba(30,30,34,.55)'; g.lineWidth = 2 + Math.random() * 3;
      g.beginPath(); g.moveTo(Math.random() * W, Math.random() * H);
      g.lineTo(Math.random() * W, Math.random() * H); g.stroke();
    }
  }, [12, 12]);
}
function paveTex() {
  return canvasTex(512, 512, function (g, W, H) {
    g.fillStyle = '#7c7c84'; g.fillRect(0, 0, W, H);
    const s = 64;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      const v = 112 + Math.random() * 24;
      g.fillStyle = hex(v, v, v + 4);
      g.fillRect(x + 2, y + 2, s - 4, s - 4);
      g.fillStyle = 'rgba(0,0,0,.10)';
      g.fillRect(x + 2, y + s - 6, s - 4, 4);
    }
    for (let i = 0; i < 5000; i++) {
      g.fillStyle = 'rgba(0,0,0,.05)';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    for (let i = 0; i < 40; i++) {                        // stains
      g.fillStyle = 'rgba(40,38,36,.10)';
      g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 6 + Math.random() * 26, 0, 7); g.fill();
    }
  }, [8, 8]);
}

/* ---- instancing helper ---------------------------------------------------- */
function instance(group, geo, mat, list, opt) {
  if (!list.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3();
  list.forEach(function (it, k) {
    e.set(it.rx || 0, it.ry || 0, it.rz || 0);
    q.setFromEuler(e);
    p.set(it.x, it.y, it.z);
    s.set(it.sx === undefined ? 1 : it.sx, it.sy === undefined ? 1 : it.sy, it.sz === undefined ? 1 : it.sz);
    m.compose(p, q, s);
    im.setMatrixAt(k, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = !opt || opt.cast !== false;
  im.receiveShadow = !opt || opt.recv !== false;
  im.frustumCulled = false;
  group.add(im);
  return im;
}

/* ---- put it together ------------------------------------------------------ */
export function buildCity(scene, seed, onProgress) {
  const r = rng(seed);
  const group = new THREE.Group();
  scene.add(group);
  const solids = [];              // axis-aligned boxes the world collides against
  const blocks = [];              // one entry per city block, for the map
  const lamps = [];               // lamp positions, for the night lights
  const glow = [];                // materials that light up after dark

  const span = CITY.grid * CITY.pitch + CITY.road;
  const blockOrigin = -CITY.half + CITY.road / 2;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const roadAt = function (i) { return -CITY.half + i * CITY.pitch; };

  // ---- the road surface -----------------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 400, span + 400),
    new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.92, metalness: 0.02 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // ---- road markings, as geometry so they stay crisp at street level --------
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xd8d6c8, roughness: 0.75 });
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xc8a33c, roughness: 0.75 });
  const white = [], yellow = [];

  // paint runs between junctions, not through them, which is most of what makes
  // a junction read as a junction from the driver's seat
  const JHALF = CITY.road / 2 + 6.2;
  const runs = [];
  for (let j = 0; j <= CITY.grid; j++) {
    const a = j === 0 ? -span / 2 : roadAt(j - 1) + JHALF;
    const b = j === CITY.grid ? span / 2 : roadAt(j) - JHALF;
    if (b > a) runs.push([a, b]);
    if (j < CITY.grid) runs.push([roadAt(j) + JHALF, roadAt(j + 1) - JHALF]);
  }
  for (let i = 0; i <= CITY.grid; i++) {
    const c = roadAt(i);
    for (const run of runs) {
      const mid = (run[0] + run[1]) / 2, len = run[1] - run[0];
      if (len <= 0) continue;
      // the centre line: two solid yellows
      for (const off of [-0.22, 0.22]) {
        yellow.push({ x: c + off, y: 0.012, z: mid, sx: 0.16, sy: 0.02, sz: len });
        yellow.push({ x: mid, y: 0.012, z: c + off, sx: len, sy: 0.02, sz: 0.16 });
      }
      // a solid line along the gutter
      for (const off of [-CITY.road / 2 + 0.7, CITY.road / 2 - 0.7]) {
        white.push({ x: c + off, y: 0.012, z: mid, sx: 0.14, sy: 0.02, sz: len });
        white.push({ x: mid, y: 0.012, z: c + off, sx: len, sy: 0.02, sz: 0.14 });
      }
      // lane dashes either side of the centre
      for (const off of [-CITY.road / 4, CITY.road / 4]) {
        for (let t = run[0] + 2; t < run[1] - 3.4; t += 8.2) {
          white.push({ x: c + off, y: 0.012, z: t + 1.7, sx: 0.14, sy: 0.02, sz: 3.4 });
          white.push({ x: t + 1.7, y: 0.012, z: c + off, sx: 3.4, sy: 0.02, sz: 0.14 });
        }
      }
    }
  }
  // crossings and stop lines at every junction
  for (let i = 0; i <= CITY.grid; i++) for (let j = 0; j <= CITY.grid; j++) {
    const cx = roadAt(i), cz = roadAt(j);
    const out = CITY.road / 2 + 2.6;
    for (const s of [-1, 1]) {
      for (let k = -3; k <= 3; k++) {
        white.push({ x: cx + k * 2.0, y: 0.013, z: cz + s * out, sx: 0.9, sy: 0.02, sz: 3.6 });
        white.push({ x: cx + s * out, y: 0.013, z: cz + k * 2.0, sx: 3.6, sy: 0.02, sz: 0.9 });
      }
      white.push({ x: cx - s * (CITY.road / 4), y: 0.013, z: cz + s * (out + 2.8), sx: CITY.road / 2 - 1.2, sy: 0.02, sz: 0.5 });
      white.push({ x: cx + s * (out + 2.8), y: 0.013, z: cz + s * (CITY.road / 4), sx: 0.5, sy: 0.02, sz: CITY.road / 2 - 1.2 });
    }
  }
  instance(group, box, paintMat, white, { cast: false });
  instance(group, box, yellowMat, yellow, { cast: false });

  // manhole covers, scattered
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.7, metalness: 0.5 });
  const holes = [];
  for (let i = 0; i < 160; i++) {
    const onX = r() < 0.5;
    const c = roadAt((r() * (CITY.grid + 1)) | 0) + (r() - 0.5) * (CITY.road - 3);
    const t = (r() - 0.5) * span;
    holes.push({ x: onX ? c : t, y: 0.014, z: onX ? t : c, sx: 1, sy: 0.02, sz: 1 });
  }
  instance(group, new THREE.CylinderGeometry(0.42, 0.42, 1, 12), metalMat, holes, { cast: false });

  // ---- pavements ------------------------------------------------------------
  const paveMat = new THREE.MeshStandardMaterial({ map: paveTex(), roughness: 0.94 });
  const kerbMat = new THREE.MeshStandardMaterial({ color: 0x9a9aa2, roughness: 0.86 });
  const slabs = [], kerbs = [];
  for (let bz = 0; bz < CITY.grid; bz++) for (let bx = 0; bx < CITY.grid; bx++) {
    const cx = blockOrigin + bx * CITY.pitch + CITY.block / 2;
    const cz = blockOrigin + bz * CITY.pitch + CITY.block / 2;
    slabs.push({ x: cx, y: KERB / 2, z: cz, sx: CITY.block, sy: KERB, sz: CITY.block });
    kerbs.push({ x: cx, y: KERB / 2 - 0.01, z: cz, sx: CITY.block + 0.55, sy: KERB + 0.02, sz: CITY.block + 0.55 });
  }
  instance(group, box, kerbMat, kerbs, { cast: false });
  instance(group, box, paveMat, slabs, { cast: false });

  // ---- building materials ---------------------------------------------------
  const styles = STYLES.map(function (st, i) {
    const f = facade(1000 + i * 977, st);
    const m = new THREE.MeshStandardMaterial({
      map: f.tex, emissiveMap: f.emis, emissive: 0xffffff, emissiveIntensity: 0,
      roughness: st.kind === 'curtain' ? 0.34 : 0.88,
      metalness: st.kind === 'curtain' ? 0.24 : 0.04,
    });
    worldUV(m, [1 / TILE_M, 1 / TILE_M], [0, -GROUND / TILE_M]);
    glow.push(m);
    return m;
  });
  const shops = [0, 1, 2, 3, 4].map(function (k) {
    const s = shopTex(4400 + k * 131);
    const m = new THREE.MeshStandardMaterial({
      map: s.tex, emissiveMap: s.emis, emissive: 0xffffff, emissiveIntensity: 0.06,
      roughness: 0.6, metalness: 0.05,
    });
    worldUV(m, [1 / 24, 1 / BASE], [0, -KERB / BASE]);
    return m;
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4d54, roughness: 0.95 });
  const parapetMat = new THREE.MeshStandardMaterial({ color: 0x6e7078, roughness: 0.9 });

  const byStyle = styles.map(function () { return []; });
  const byShop = shops.map(function () { return []; });
  const caps = [], parapets = [], acs = [], tanks = [], tankLegs = [], masts = [];

  // ---- the blocks -----------------------------------------------------------
  const treeSpots = [];
  for (let bz = 0; bz < CITY.grid; bz++) {
    for (let bx = 0; bx < CITY.grid; bx++) {
      const x0 = blockOrigin + bx * CITY.pitch, z0 = blockOrigin + bz * CITY.pitch;
      const cx = x0 + CITY.block / 2, cz = z0 + CITY.block / 2;

      // a park instead of buildings, here and there
      const isPark = r() < 0.09;
      blocks.push({ x: cx, z: cz, park: isPark });
      if (isPark) {
        const grass = new THREE.Mesh(new THREE.BoxGeometry(CITY.block - 5, 0.14, CITY.block - 5),
          new THREE.MeshStandardMaterial({ color: 0x4d7a41, roughness: 1 }));
        grass.position.set(cx, KERB + 0.06, cz); grass.receiveShadow = true; group.add(grass);
        const path = new THREE.Mesh(new THREE.BoxGeometry(CITY.block - 5, 0.16, 4),
          new THREE.MeshStandardMaterial({ color: 0xa79a84, roughness: 1 }));
        path.position.set(cx, KERB + 0.07, cz); path.receiveShadow = true; group.add(path);
        for (let i = 0; i < 16; i++) treeSpots.push({
          x: cx + (r() - 0.5) * (CITY.block - 12), z: cz + (r() - 0.5) * (CITY.block - 12),
        });
        continue;
      }

      // the block is cut into lots, each lot gets a building
      const lotsX = 2 + ((r() * 2) | 0), lotsZ = 2 + ((r() * 2) | 0);
      const lw = (CITY.block - 4) / lotsX, ld = (CITY.block - 4) / lotsZ;
      const edge = Math.max(Math.abs(bx - (CITY.grid - 1) / 2), Math.abs(bz - (CITY.grid - 1) / 2));
      const downtown = 1 - edge / ((CITY.grid - 1) / 2);      // tall in the middle, low at the edges
      for (let lz = 0; lz < lotsZ; lz++) for (let lx = 0; lx < lotsX; lx++) {
        if (r() < 0.10) continue;                              // a gap, a car park, a yard
        const w = lw * (0.76 + r() * 0.18), d = ld * (0.76 + r() * 0.18);
        const px = x0 + 2 + lx * lw + lw / 2, pz = z0 + 2 + lz * ld + ld / 2;
        // storeys, not metres, so every floor line in the city agrees
        const wanted = 7 + downtown * downtown * (14 + r() * 74) + r() * 9;
        const floors = Math.max(1, Math.round(wanted / FLOOR));
        const top = GROUND + floors * FLOOR;
        const si = (r() * styles.length) | 0;

        byStyle[si].push({ x: px, y: (top + KERB) / 2, z: pz, sx: w, sy: top - KERB, sz: d });
        byShop[(r() * shops.length) | 0].push({ x: px, y: KERB + BASE / 2, z: pz, sx: w + 0.3, sy: BASE, sz: d + 0.3 });
        solids.push({ x: px, z: pz, w: w + 0.3, d: d + 0.3, h: top });

        // roof: a slab, a parapet round the edge, and some plant on top
        caps.push({ x: px, y: top + 0.15, z: pz, sx: w + 0.4, sy: 0.3, sz: d + 0.4 });
        const ph = 0.55 + r() * 0.5;
        const ring = [[0, d / 2, w + 0.4, 0.34], [0, -d / 2, w + 0.4, 0.34],
                      [w / 2, 0, 0.34, d + 0.4], [-w / 2, 0, 0.34, d + 0.4]];
        for (const e of ring) parapets.push({ x: px + e[0], y: top + 0.3 + ph / 2, z: pz + e[1], sx: e[2], sy: ph, sz: e[3] });
        const units = 1 + ((r() * 3) | 0);
        for (let i = 0; i < units; i++) {
          const uw = 1.4 + r() * 2.4, uh = 0.9 + r() * 1.4;
          acs.push({
            x: px + (r() - 0.5) * Math.max(0.5, w - uw - 1), y: top + 0.3 + uh / 2,
            z: pz + (r() - 0.5) * Math.max(0.5, d - uw - 1), sx: uw, sy: uh, sz: uw * (0.7 + r() * 0.5),
          });
        }
        if (floors < 9 && r() < 0.34) {                        // a water tower on the low roofs
          const tx = px + (r() - 0.5) * w * 0.4, tz = pz + (r() - 0.5) * d * 0.4;
          tanks.push({ x: tx, y: top + 3.6, z: tz, sx: 1.5, sy: 2.6, sz: 1.5 });
          for (const leg of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
            tankLegs.push({ x: tx + leg[0] * 0.85, y: top + 1.4, z: tz + leg[1] * 0.85, sx: 0.16, sy: 2.2, sz: 0.16 });
        }
        if (floors > 14 && r() < 0.6) masts.push({ x: px, y: top + 4.5, z: pz, sx: 0.14, sy: 9, sz: 0.14 });
      }
    }
    if (onProgress) onProgress((bz + 1) / CITY.grid);
  }

  for (let i = 0; i < styles.length; i++) instance(group, box, styles[i], byStyle[i]);
  for (let i = 0; i < shops.length; i++) instance(group, box, shops[i], byShop[i]);
  instance(group, box, roofMat, caps);
  instance(group, box, parapetMat, parapets);
  instance(group, box, roofMat, acs);
  instance(group, new THREE.CylinderGeometry(0.5, 0.5, 1, 10), roofMat, tanks);
  instance(group, box, roofMat, tankLegs, { recv: false });
  instance(group, box, metalMat, masts, { recv: false });

  // ---- street lamps ---------------------------------------------------------
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.6, metalness: 0.55 });
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0x2a2a28, emissive: 0xffd08a, emissiveIntensity: 0 });
  const poles = [], arms = [], bulbs = [];
  // three to a block and swapping sides, so a street is lit about every twenty
  // metres the way a real one is, rather than once a block
  const LAMP_AT = [[0.22, -1], [0.5, 1], [0.78, -1]];
  for (let i = 0; i <= CITY.grid; i++) {
    for (let j = 0; j < CITY.grid; j++) {
      const base = blockOrigin + j * CITY.pitch;
      for (const la of LAMP_AT) {
        const along = base + CITY.block * la[0];
        const cross = roadAt(i) + la[1] * (CITY.road / 2 - 1.0);
        const reach = -la[1];                      // the arm leans out over the road
        // a lamp on a road running north to south, then the same going east to west
        poles.push({ x: cross, y: 4.2, z: along });
        arms.push({ x: cross + reach * 0.95, y: 8.2, z: along, sx: 2.1, sy: 0.15, sz: 0.15 });
        bulbs.push({ x: cross + reach * 1.9, y: 8.05, z: along, sx: 0.8, sy: 0.2, sz: 0.42 });
        lamps.push([cross + reach * 1.9, 8.0, along]);
        poles.push({ x: along, y: 4.2, z: cross });
        arms.push({ x: along, y: 8.2, z: cross + reach * 0.95, sx: 0.15, sy: 0.15, sz: 2.1 });
        bulbs.push({ x: along, y: 8.05, z: cross + reach * 1.9, sx: 0.42, sy: 0.2, sz: 0.8 });
        lamps.push([along, 8.0, cross + reach * 1.9]);
      }
    }
  }
  instance(group, new THREE.CylinderGeometry(0.1, 0.16, 8.4, 8), poleMat, poles, { recv: false });
  instance(group, box, poleMat, arms, { recv: false });
  const bulbMesh = instance(group, box, bulbMat, bulbs, { cast: false, recv: false });

  // A real light per lamp would be hundreds of shadow-casting lights. What the
  // eye actually reads at night is the pool on the tarmac, so paint that: one
  // additive disc under each lamp, switched on with the rest of the night.
  // The falloff is worked out in the shader rather than sampled from a texture:
  // a disc this big seen along the road is minified so hard that a texture just
  // averages itself away to nothing.
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0 }, uColor: { value: new THREE.Color(0xffd9a0) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vQ;
      void main(){
        vQ = uv;
        #ifdef USE_INSTANCING
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
        #else
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        #endif
      }`,
    fragmentShader: `
      uniform float uStrength; uniform vec3 uColor; varying vec2 vQ;
      void main(){
        float d = length( vQ - 0.5 ) * 2.0;
        float a = pow( max( 0.0, 1.0 - d ), 2.4 );
        if ( a * uStrength < 0.002 ) discard;
        gl_FragColor = vec4( uColor * a * uStrength, 1.0 );
      }`,
  });
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  instance(group, poolGeo, poolMat, lamps.map(function (l) {
    return { x: l[0], y: 0.06, z: l[2], sx: 16, sy: 1, sz: 16 };
  }), { cast: false, recv: false });

  // ---- traffic lights -------------------------------------------------------
  const lensGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 10);
  lensGeo.rotateX(Math.PI / 2);
  const lensMat = function (c) {
    return new THREE.MeshStandardMaterial({ color: 0x141416, emissive: c, emissiveIntensity: 0.04, roughness: 0.4 });
  };
  const sig = {
    ns: { r: lensMat(0xff2a1a), a: lensMat(0xffb020), g: lensMat(0x34e05a) },
    ew: { r: lensMat(0xff2a1a), a: lensMat(0xffb020), g: lensMat(0x34e05a) },
  };
  const tPoles = [], tArms = [], tHeads = [];
  const lensList = { ns: { r: [], a: [], g: [] }, ew: { r: [], a: [], g: [] } };
  for (let i = 0; i <= CITY.grid; i++) for (let j = 0; j <= CITY.grid; j++) {
    const cx = roadAt(i), cz = roadAt(j);
    const k = CITY.road / 2 + 0.9;
    for (const corner of [[-1, -1], [1, 1]]) {
      const sx = corner[0], sz = corner[1];
      const px = cx + sx * k, pz = cz + sz * k;
      if (Math.abs(px) > CITY.half || Math.abs(pz) > CITY.half) continue;
      tPoles.push({ x: px, y: 3.1, z: pz });
      tArms.push({ x: px - sx * 2.2, y: 5.9, z: pz, sx: 4.4, sy: 0.14, sz: 0.14 });
      const hx = px - sx * 4.2;
      tHeads.push({ x: hx, y: 5.4, z: pz, sx: 0.44, sy: 1.2, sz: 0.42, ry: Math.PI / 2 });
      for (const l of [['r', 0.38], ['a', 0], ['g', -0.38]])
        lensList.ew[l[0]].push({ x: hx + sx * 0.24, y: 5.4 + l[1], z: pz, ry: Math.PI / 2 });
      tHeads.push({ x: px, y: 5.4, z: pz - sz * 1.4, sx: 0.44, sy: 1.2, sz: 0.42 });
      for (const l of [['r', 0.38], ['a', 0], ['g', -0.38]])
        lensList.ns[l[0]].push({ x: px, y: 5.4 + l[1], z: pz - sz * 1.64 });
    }
  }
  instance(group, new THREE.CylinderGeometry(0.12, 0.16, 6.2, 8), poleMat, tPoles, { recv: false });
  instance(group, box, poleMat, tArms, { recv: false });
  instance(group, box, poleMat, tHeads, { recv: false });
  for (const axis of ['ns', 'ew']) for (const c of ['r', 'a', 'g'])
    instance(group, lensGeo, sig[axis][c], lensList[axis][c], { cast: false, recv: false });

  // ---- pavement clutter -----------------------------------------------------
  const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xb3372c, roughness: 0.7 });
  const binMat = new THREE.MeshStandardMaterial({ color: 0x2f3a33, roughness: 0.8, metalness: 0.2 });
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2e, roughness: 0.9 });
  const hydrants = [], bins = [], benches = [], benchLegs = [];
  const onKerb = function () {
    const bx = (r() * CITY.grid) | 0, bz = (r() * CITY.grid) | 0;
    const x0 = blockOrigin + bx * CITY.pitch, z0 = blockOrigin + bz * CITY.pitch;
    const side = (r() * 4) | 0, t = 3 + r() * (CITY.block - 6);
    if (side === 0) return [x0 + t, z0 + 1.4];
    if (side === 1) return [x0 + CITY.block - 1.4, z0 + t];
    if (side === 2) return [x0 + t, z0 + CITY.block - 1.4];
    return [x0 + 1.4, z0 + t];
  };
  for (let i = 0; i < 90; i++) { const p = onKerb(); hydrants.push({ x: p[0], y: KERB + 0.42, z: p[1] }); }
  for (let i = 0; i < 110; i++) { const p = onKerb(); bins.push({ x: p[0], y: KERB + 0.45, z: p[1], ry: r() * 6.28 }); }
  for (let i = 0; i < 70; i++) {
    const p = onKerb(), ry = r() < 0.5 ? 0 : Math.PI / 2;
    benches.push({ x: p[0], y: KERB + 0.46, z: p[1], ry: ry, sx: 1.9, sy: 0.12, sz: 0.55 });
    benches.push({ x: p[0], y: KERB + 0.72, z: p[1] - 0.24, ry: ry, sx: 1.9, sy: 0.42, sz: 0.1 });
    for (const s of [-1, 1])
      benchLegs.push({ x: p[0] + (ry ? 0 : s * 0.8), y: KERB + 0.23, z: p[1] + (ry ? s * 0.8 : 0), sx: 0.1, sy: 0.46, sz: 0.1 });
  }
  instance(group, new THREE.CylinderGeometry(0.16, 0.2, 0.84, 8), hydrantMat, hydrants, { recv: false });
  instance(group, new THREE.CylinderGeometry(0.3, 0.26, 0.9, 10), binMat, bins, { recv: false });
  instance(group, box, benchMat, benches, { recv: false });
  instance(group, box, metalMat, benchLegs, { recv: false });

  // ---- trees ----------------------------------------------------------------
  for (let i = 0; i < 300; i++) { const p = onKerb(); treeSpots.push({ x: p[0], z: p[1] }); }
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 });
  const leafMats = [0x2f5c33, 0x35663a, 0x28502e].map(function (c) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true });
  });
  const trunks = [], crowns = leafMats.map(function () { return []; });
  for (const t of treeSpots) {
    const h = 3.6 + r() * 2.8;
    trunks.push({ x: t.x, y: h / 2 + KERB, z: t.z, sy: h / 4 });
    const cn = 2 + ((r() * 2) | 0);
    for (let k = 0; k < cn; k++) {
      const sc = (1.5 + r() * 0.8) * (k ? 0.78 : 1);
      crowns[(r() * leafMats.length) | 0].push({
        x: t.x + (r() - 0.5) * 1.4, y: h + KERB + 0.4 + (r() - 0.5) * 0.9, z: t.z + (r() - 0.5) * 1.4,
        sx: sc, sy: sc * 0.85, sz: sc, ry: r() * 6.28, rx: r(),
      });
    }
    solids.push({ x: t.x, z: t.z, w: 0.6, d: 0.6, h: h });
  }
  instance(group, new THREE.CylinderGeometry(0.17, 0.26, 4, 6), trunkMat, trunks, { recv: false });
  for (let i = 0; i < leafMats.length; i++)
    instance(group, new THREE.IcosahedronGeometry(1, 0), leafMats[i], crowns[i], { recv: false });

  // ---- what the rest of the game needs back ---------------------------------
  return {
    group: group, solids: solids, blocks: blocks, lamps: lamps, bulbMesh: bulbMesh, styles: styles, span: span,
    setNight: function (v) {                       // 0 = noon, 1 = midnight
      for (const m of glow) m.emissiveIntensity = v * 1.25;
      for (const m of shops) m.emissiveIntensity = 0.06 + v * 1.15;
      bulbMat.emissiveIntensity = v * 2.6;
      poolMat.uniforms.uStrength.value = Math.max(0, v - 0.18) * 0.95;
      bulbMat.color.setHex(v > 0.35 ? 0xffe9b0 : 0x2a2a28);
    },
    tick: function (t) {
      // the lights run on a twenty second cycle, the two axes out of step
      const p = (t % 20) / 20;
      const set = function (axis, rr, aa, gg) {
        sig[axis].r.emissiveIntensity = rr;
        sig[axis].a.emissiveIntensity = aa;
        sig[axis].g.emissiveIntensity = gg;
      };
      if (p < 0.44) { set('ns', 0.04, 0.04, 2.4); set('ew', 2.4, 0.04, 0.04); }
      else if (p < 0.5) { set('ns', 0.04, 2.4, 0.04); set('ew', 2.4, 0.04, 0.04); }
      else if (p < 0.94) { set('ns', 2.4, 0.04, 0.04); set('ew', 0.04, 0.04, 2.4); }
      else { set('ns', 2.4, 0.04, 0.04); set('ew', 0.04, 2.4, 0.04); }
    },
  };
}
