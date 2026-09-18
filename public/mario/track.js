/* ---------------------------------------------------------------------------
   The circuit.

   One closed loop, built from a handful of control points blown up into a few
   hundred samples along a Catmull-Rom spline. Everything else in the game asks
   the track two questions - "how far round am I" and "am I still on the tarmac"
   - and both are answered by projecting a position onto the nearest sample, so
   the same data drives the road mesh, the lap counter, the running order, the
   minimap and the computer drivers.

   Coordinates: x/z is the ground, y is up, one unit is one metre.
--------------------------------------------------------------------------- */
const THREE = window.THREE;

/* The lap: a long pit straight, a fast right sweeper, a chicane, a hairpin, and
   a long left-hander that spits you back onto the straight. Width is per point
   so the hairpin can open out and the chicane can pinch. */
const CP = [
  { x: -60, z: -128, w: 9.5 },
  { x: 40, z: -132, w: 9.5 },
  { x: 118, z: -120, w: 9.0 },
  { x: 168, z: -84, w: 8.5 },
  { x: 180, z: -26, w: 8.0 },
  { x: 144, z: 14, w: 7.5 },
  { x: 172, z: 58, w: 8.0 },
  { x: 152, z: 110, w: 11.0 },
  { x: 84, z: 126, w: 10.0 },
  { x: 24, z: 104, w: 8.5 },
  { x: -42, z: 124, w: 9.0 },
  { x: -112, z: 102, w: 10.5 },
  { x: -154, z: 42, w: 9.0 },
  { x: -146, z: -42, w: 9.0 },
  { x: -112, z: -104, w: 9.5 },
];

const STEP = 2.2;                 // metres between samples
const KERB = 1.5;                 // kerb strip, just outside the tarmac
const SHOULDER = 3.2;             // how far past the kerb before a wall

function hill(x, z) {
  // gentle ground, so the circuit rolls rather than sitting on a table
  return Math.sin(x * 0.0075) * 3.4 + Math.cos(z * 0.0091) * 3.0 + Math.sin((x + z) * 0.004) * 2.2;
}

function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (rep) t.repeat.set(rep[0], rep[1]);
  return t;
}

function tarmacTex() {
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#5c616b'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 6000; i++) {
      const v = 88 + Math.random() * 34;
      g.fillStyle = 'rgba(' + (v | 0) + ',' + (v | 0) + ',' + ((v + 6) | 0) + ',.45)';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    for (let i = 0; i < 18; i++) {
      g.fillStyle = 'rgba(80,84,92,.5)';
      g.fillRect(Math.random() * W, Math.random() * H, 20 + Math.random() * 70, 8 + Math.random() * 26);
    }
  }, [1, 1]);
}
function grassTex() {
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#57c04a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4200; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? 'rgba(74,170,60,.55)' : 'rgba(112,208,92,.5)';
      g.fillRect(Math.random() * W, Math.random() * H, 3, 3);
    }
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = 'rgba(66,150,56,.55)'; g.lineWidth = 2;
      const x = Math.random() * W, y = Math.random() * H;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 12, y - 8 - Math.random() * 10); g.stroke();
    }
  }, [60, 60]);
}

/* ---- the spline ---------------------------------------------------------- */
function catmull(p0, p1, p2, p3, t, key) {
  const a = p0[key], b = p1[key], c = p2[key], d = p3[key];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

function sampleLoop() {
  const fine = [];
  const n = CP.length;
  for (let i = 0; i < n; i++) {
    const p0 = CP[(i - 1 + n) % n], p1 = CP[i], p2 = CP[(i + 1) % n], p3 = CP[(i + 2) % n];
    const seg = Math.max(2, Math.round(Math.hypot(p2.x - p1.x, p2.z - p1.z) / STEP));
    for (let k = 0; k < seg; k++) {
      const t = k / seg;
      fine.push({
        x: catmull(p0, p1, p2, p3, t, 'x'),
        z: catmull(p0, p1, p2, p3, t, 'z'),
        w: catmull(p0, p1, p2, p3, t, 'w'),
      });
    }
  }
  // arc length, tangents and normals
  const out = [];
  let s = 0;
  for (let i = 0; i < fine.length; i++) {
    const a = fine[i], b = fine[(i + 1) % fine.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    out.push({
      p: new THREE.Vector3(a.x, hill(a.x, a.z), a.z),
      t: new THREE.Vector3(dx / len, 0, dz / len),
      n: new THREE.Vector3(-dz / len, 0, dx / len),      // left of travel
      w: a.w, s, len,
    });
    s += len;
  }
  return { samples: out, length: s };
}

/* ---- put it together ----------------------------------------------------- */
export function buildTrack(scene) {
  const { samples, length } = sampleLoop();
  const N = samples.length;
  const group = new THREE.Group();
  scene.add(group);

  /* the ground, with a hill field under it */
  const gseg = 60, gspan = 900;
  const gg = new THREE.PlaneGeometry(gspan, gspan, gseg, gseg);
  gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    // lift the far ground into a rim of hills, so the course sits in a bowl
    const rim = Math.max(0, (edge - 210) / 240);
    gp.setY(i, hill(x, z) + rim * rim * 46);
  }
  gg.computeVertexNormals();
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1 }));
  ground.receiveShadow = true;
  group.add(ground);

  /* the road ribbon */
  const pos = [], uv = [], idx = [];
  const kpos = [], kuv = [], kidx = [];
  for (let i = 0; i < N; i++) {
    const a = samples[i];
    const l = a.p.clone().addScaledVector(a.n, a.w);
    const r = a.p.clone().addScaledVector(a.n, -a.w);
    pos.push(l.x, l.y + 0.06, l.z, r.x, r.y + 0.06, r.z);
    uv.push(0, a.s / 9, 1, a.s / 9);
    // kerbs, one strip either side
    const lo = a.p.clone().addScaledVector(a.n, a.w + KERB);
    const ro = a.p.clone().addScaledVector(a.n, -(a.w + KERB));
    kpos.push(l.x, l.y + 0.05, l.z, lo.x, lo.y + 0.05, lo.z, r.x, r.y + 0.05, r.z, ro.x, ro.y + 0.05, ro.z);
    kuv.push(0, a.s / 3.2, 1, a.s / 3.2, 0, a.s / 3.2, 1, a.s / 3.2);
  }
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const a = i * 2, b = a + 1, c = j * 2, d = c + 1;
    idx.push(a, c, b, b, c, d);
    const ka = i * 4, kb = ka + 1, kc = ka + 2, kd = ka + 3;
    const ja = j * 4, jb = ja + 1, jc = ja + 2, jd = ja + 3;
    kidx.push(ka, kb, ja, kb, jb, ja);            // left kerb, facing up
    kidx.push(kc, jc, kd, kd, jc, jd);            // right kerb, facing up
  }
  const road = new THREE.Mesh(
    ribbon(pos, uv, idx),
    new THREE.MeshStandardMaterial({ map: tarmacTex(), roughness: 0.82, metalness: 0.02 })
  );
  road.receiveShadow = true;
  group.add(road);

  const kerbTex = canvasTex(64, 64, (g, W, H) => {
    g.fillStyle = '#e8402a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff6e2'; g.fillRect(0, 0, W, H / 2);
  }, [1, 1]);
  const kerb = new THREE.Mesh(ribbon(kpos, kuv, kidx),
    new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.7 }));
  kerb.receiveShadow = true;
  group.add(kerb);

  /* the start line, and an arch over it */
  const startTex = canvasTex(128, 128, (g, W, H) => {
    const s = W / 8;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      g.fillStyle = ((x / s + y / s) | 0) % 2 ? '#17223b' : '#fff6e2';
      g.fillRect(x, y, s, s);
    }
  }, [1, 1]);
  const s0 = samples[0];
  const line = new THREE.Mesh(new THREE.PlaneGeometry(s0.w * 2, 4.5),
    new THREE.MeshStandardMaterial({ map: startTex, roughness: 0.8 }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -Math.atan2(s0.t.z, s0.t.x) + Math.PI / 2;
  line.position.copy(s0.p).setY(s0.p.y + 0.09);
  group.add(line);

  const inkMat = new THREE.MeshStandardMaterial({ color: 0x17223b, roughness: 0.6 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd233, roughness: 0.55 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.1, 9, 1.1), inkMat);
    post.position.copy(s0.p).addScaledVector(s0.n, side * (s0.w + 2.2)).setY(s0.p.y + 4.5);
    post.castShadow = true;
    group.add(post);
  }
  const banner = new THREE.Mesh(new THREE.BoxGeometry(s0.w * 2 + 5, 2.6, 0.6), goldMat);
  banner.position.copy(s0.p).setY(s0.p.y + 8.2);
  banner.rotation.y = Math.atan2(s0.t.x, s0.t.z) + Math.PI / 2;
  banner.castShadow = true;
  group.add(banner);

  /* the barrier: one striped ribbon down each side, which is what the edge of a
     circuit actually looks like and reads far better than a line of posts */
  const m4 = new THREE.Matrix4();
  const barTex = canvasTex(64, 64, (g, W, H) => {
    g.fillStyle = '#fff6e2'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8402a'; g.fillRect(0, 0, W / 2, H);
  }, [1, 1]);
  const barMat = new THREE.MeshStandardMaterial({ map: barTex, roughness: 0.75 });
  const BAR_H = 1.35;
  for (const side of [-1, 1]) {
    const bp = [], bu = [], bi = [];
    for (let i = 0; i < N; i++) {
      const a = samples[i];
      const foot = a.p.clone().addScaledVector(a.n, side * (a.w + SHOULDER));
      bp.push(foot.x, foot.y, foot.z, foot.x, foot.y + BAR_H, foot.z);
      bu.push(a.s / 5.4, 0, a.s / 5.4, 1);
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a = i * 2, b = a + 1, c = j * 2, d = c + 1;
      if (side < 0) bi.push(a, c, b, b, c, d); else bi.push(a, b, c, b, d, c);
    }
    const bar = new THREE.Mesh(ribbon(bp, bu, bi), barMat);
    bar.castShadow = true; bar.receiveShadow = true;
    group.add(bar);
  }

  /* trees and hills for the middle distance */
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f9440, roughness: 1, flatShading: true });
  const trunks = [], leaves = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let k = 0; k < 420; k++) {
    const a = rnd() * Math.PI * 2, d = 150 + rnd() * 260;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.8;
    // keep the trees clear of the tarmac
    let near = 1e9;
    for (let i = 0; i < N; i += 3) {
      const dx = samples[i].p.x - x, dz = samples[i].p.z - z;
      near = Math.min(near, dx * dx + dz * dz);
    }
    if (near < 400) continue;
    const y = hill(x, z) + Math.max(0, (Math.max(Math.abs(x), Math.abs(z)) - 210) / 240) ** 2 * 46;
    const h = 5 + rnd() * 5;
    trunks.push({ x, y, z, h });
    leaves.push({ x, y: y + h * 0.78, z, r: 2.6 + rnd() * 1.8 });
  }
  const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.55, 1, 6), trunkMat, trunks.length);
  const lm = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2.1, 7), leafMat, leaves.length);
  const sc = new THREE.Vector3(), q = new THREE.Quaternion(), pv = new THREE.Vector3();
  trunks.forEach((t, k) => { pv.set(t.x, t.y + t.h / 2, t.z); sc.set(1, t.h, 1); m4.compose(pv, q, sc); tm.setMatrixAt(k, m4); });
  leaves.forEach((l, k) => { pv.set(l.x, l.y + l.r, l.z); sc.set(l.r, l.r, l.r); m4.compose(pv, q, sc); lm.setMatrixAt(k, m4); });
  tm.instanceMatrix.needsUpdate = true; lm.instanceMatrix.needsUpdate = true;
  tm.castShadow = lm.castShadow = true;
  tm.frustumCulled = lm.frustumCulled = false;
  group.add(tm); group.add(lm);

  /* grandstands along the pit straight */
  const standMat = new THREE.MeshStandardMaterial({ color: 0x2b56d6, roughness: 0.8 });
  const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffd233, roughness: 0.9 });
  for (let k = 0; k < 4; k++) {
    const a = samples[Math.floor((k * 13 + 6) % N)];
    const base = a.p.clone().addScaledVector(a.n, a.w + 17);
    const st = new THREE.Mesh(new THREE.BoxGeometry(22, 5.5, 9), standMat);
    st.position.copy(base).setY(base.y + 2.6);
    st.rotation.y = Math.atan2(a.t.x, a.t.z) + Math.PI / 2;
    st.castShadow = true; st.receiveShadow = true;
    group.add(st);
    const crowd = new THREE.Mesh(new THREE.BoxGeometry(21, 1.1, 8), crowdMat);
    crowd.position.copy(base).setY(base.y + 5.7);
    crowd.rotation.y = st.rotation.y;
    group.add(crowd);
  }

  /* ---- things on the road ------------------------------------------------- */
  const itemBoxes = [];
  for (const at of [0.17, 0.42, 0.63, 0.86]) {
    const i = Math.floor(at * N);
    const a = samples[i];
    for (const off of [-0.55, 0, 0.55]) {
      const p = a.p.clone().addScaledVector(a.n, off * a.w);
      itemBoxes.push({ pos: p.clone().setY(p.y + 1.35), i, taken: 0 });
    }
  }
  const boostPads = [];
  for (const at of [0.08, 0.53, 0.75]) {
    const i = Math.floor(at * N);
    const a = samples[i];
    boostPads.push({ pos: a.p.clone(), i, n: a.n.clone(), t: a.t.clone(), w: a.w * 0.5 });
  }
  const coins = [];
  for (let k = 0; k < 60; k++) {
    const i = Math.floor((k / 60) * N + 7) % N;
    const a = samples[i];
    const off = Math.sin(k * 1.7) * 0.5;
    const p = a.p.clone().addScaledVector(a.n, off * a.w);
    coins.push({ pos: p.clone().setY(p.y + 0.75), i, taken: 0 });
  }

  /* their meshes */
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0xfff6e2, emissive: 0xffd233, emissiveIntensity: 0.35, roughness: 0.4, transparent: true, opacity: 0.92,
  });
  const boxGeo = new THREE.BoxGeometry(2.1, 2.1, 2.1);
  const boxMesh = new THREE.InstancedMesh(boxGeo, boxMat, itemBoxes.length);
  boxMesh.frustumCulled = false;
  group.add(boxMesh);

  const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.11, 14);
  coinGeo.rotateX(Math.PI / 2);
  const coinMesh = new THREE.InstancedMesh(coinGeo,
    new THREE.MeshStandardMaterial({ color: 0xffd233, emissive: 0xffb300, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.4 }),
    coins.length);
  coinMesh.frustumCulled = false;
  group.add(coinMesh);

  const padTex = canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = '#ff8a1f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffd233';
    for (let k = 0; k < 3; k++) {
      const y = k * (H / 3);
      g.beginPath();
      g.moveTo(W * 0.1, y + H / 3 * 0.8); g.lineTo(W * 0.5, y + H / 3 * 0.15); g.lineTo(W * 0.9, y + H / 3 * 0.8);
      g.lineTo(W * 0.9, y + H / 3 * 0.95); g.lineTo(W * 0.5, y + H / 3 * 0.35); g.lineTo(W * 0.1, y + H / 3 * 0.95);
      g.closePath(); g.fill();
    }
  }, [1, 1]);
  for (const pad of boostPads) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pad.w * 2, 7),
      new THREE.MeshStandardMaterial({ map: padTex, emissive: 0xff8a1f, emissiveIntensity: 0.3, roughness: 0.6 }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.atan2(pad.t.z, pad.t.x) + Math.PI / 2;
    m.position.copy(pad.pos).setY(pad.pos.y + 0.1);
    group.add(m);
  }

  /* ---- the starting grid -------------------------------------------------- */
  // two by two, behind the line, the way a grid actually forms
  function gridSlot(k) {
    const back = 8 + Math.floor(k / 2) * 6.5;
    const s = (length - back) % length;
    const a = at(s);
    const side = (k % 2) ? 0.42 : -0.42;
    return { pos: a.p.clone().addScaledVector(a.n, side * a.w), yaw: Math.atan2(-a.t.x, -a.t.z) };
  }

  function at(s) {
    const ss = ((s % length) + length) % length;
    let i = Math.min(N - 1, Math.floor(ss / (length / N)));
    // walk to the right sample, since spacing is not exactly uniform
    while (i < N - 1 && samples[i + 1].s <= ss) i++;
    while (i > 0 && samples[i].s > ss) i--;
    return samples[i];
  }

  /* ---- the two questions -------------------------------------------------- */
  function project(x, z, hint) {
    let best = -1, bestD = Infinity;
    const scan = (lo, hi) => {
      for (let k = lo; k <= hi; k++) {
        const i = ((k % N) + N) % N;
        const dx = samples[i].p.x - x, dz = samples[i].p.z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    };
    if (hint === undefined || hint === null) scan(0, N - 1);
    else {
      scan(hint - 26, hint + 26);
      if (bestD > 1600) { bestD = Infinity; scan(0, N - 1); }     // lost: look everywhere
    }
    const a = samples[best];
    const dx = x - a.p.x, dz = z - a.p.z;
    const along = dx * a.t.x + dz * a.t.z;
    const lateral = dx * a.n.x + dz * a.n.z;
    return {
      i: best, s: a.s + along, lateral, half: a.w,
      onRoad: Math.abs(lateral) <= a.w + 0.4,
      onKerb: Math.abs(lateral) > a.w + 0.4 && Math.abs(lateral) <= a.w + KERB,
      wall: a.w + SHOULDER,
      y: a.p.y, t: a.t, n: a.n,
    };
  }

  return {
    group, samples, length, project, at, gridSlot,
    itemBoxes, boostPads, coins, boxMesh, coinMesh,
    // the ribbon, in a form the minimap can draw cheaply
    outline: samples.filter((_, i) => i % 3 === 0).map(a => [a.p.x, a.p.z]),
    bounds: samples.reduce((b, a) => ({
      minx: Math.min(b.minx, a.p.x), maxx: Math.max(b.maxx, a.p.x),
      minz: Math.min(b.minz, a.p.z), maxz: Math.max(b.maxz, a.p.z),
    }), { minx: 1e9, maxx: -1e9, minz: 1e9, maxz: -1e9 }),
  };
}

function ribbon(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
