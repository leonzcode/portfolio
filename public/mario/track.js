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

/* The lap.

   Drawn fresh for every race from the round's seed, because a circuit you have
   learned is a circuit you stop reading. The shape is a ring whose radius is a
   few smooth harmonics of the angle round it: that gives long straights, real
   corners and the odd hairpin, and it can never cross itself, which a wandering
   walk very much can. Width varies point to point so a hairpin can open out and
   a chicane can pinch.

   Both browsers in a lobby build from the same seed, so both get the same lap
   without a byte of it going over the wire. */
function makeCP(seed) {
  let s = (seed | 0) || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const n = 15 + Math.floor(rnd() * 5);
  const wave = [
    { k: 2, a: 0.10 + rnd() * 0.15, p: rnd() * 6.283 },
    { k: 3, a: 0.06 + rnd() * 0.13, p: rnd() * 6.283 },
    { k: 5, a: 0.04 + rnd() * 0.08, p: rnd() * 6.283 },
    { k: 7, a: 0.02 + rnd() * 0.05, p: rnd() * 6.283 },
  ];
  const squash = 0.78 + rnd() * 0.22;
  const spin = rnd() * 6.283;
  const out = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    let r = 1;
    for (const q of wave) r += q.a * Math.sin(q.k * th + q.p);
    const R = 168 * r;
    out.push({
      x: Math.cos(th + spin) * R,
      z: Math.sin(th + spin) * R * squash,
      w: 7.5 + rnd() * 3.6,
    });
  }
  return out;
}

const STEP = 2.2;                 // metres between samples
const KERB = 1.5;                 // the red and white, the outer strip of the road
// The wall stands on the edge of the tarmac itself, so the barrier is on the
// road rather than beside it. props.js finds this line by asking project where
// it is, so the barriers follow it wherever it goes, camber and all.
const SHOULDER = 0;

function hill(x, z) {
  // gentle ground, so the circuit sits in country rather than on a table
  return Math.sin(x * 0.0075) * 3.4 + Math.cos(z * 0.0091) * 3.0 + Math.sin((x + z) * 0.004) * 2.2;
}
// Hollows dug into the field. The water section runs along a channel, and a
// channel means the ground either side has to come down to meet it, or the road
// is simply buried under a flat field.
const basins = [];
export function groundY(x, z) {
  const rim = Math.max(0, (Math.max(Math.abs(x), Math.abs(z)) - 210) / 240);
  const y = hill(x, z) + rim * rim * 46;
  // The deepest hollow that reaches here, not the sum of them. Adding them up
  // meant a dozen overlapping basins along the channel dug a seventeen metre pit
  // instead of the three metre one each of them asked for.
  let dig = 0;
  for (let i = 0; i < basins.length; i++) {
    const b = basins[i];
    const d = Math.hypot(x - b.x, z - b.z);
    if (d >= b.r) continue;
    const cut = b.drop * (0.5 + 0.5 * Math.cos(Math.PI * d / b.r));
    if (cut > dig) dig = cut;
  }
  return y - dig;
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

function sampleLoop(seed) {
  basins.length = 0;                  // a new lap digs its own hollows
  const CP = makeCP(seed);
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

  /* ---- the road is graded ------------------------------------------------- */
  // The ground rolls; a road laid on it should not. Average each sample's height
  // over the fifty odd metres either side of it, which keeps the long climbs and
  // takes out the short bumps that were being felt through the wheels.
  {
    const raw = out.map(a => a.p.y);
    const n = out.length, W = 12;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let d = -W; d <= W; d++) sum += raw[(i + d + n) % n];
      out[i].p.y = sum / (W * 2 + 1);
    }
  }

  /* ---- the lean of the corners ------------------------------------------- */
  // Measure the bend a little way ahead of each sample and smooth it, or the
  // road twitches from one sample to the next. `bank` is a slope: how much
  // height a metre of lateral offset buys, so the outside of the corner rises
  // and the inside drops.
  const M = out.length;
  for (let i = 0; i < M; i++) {
    const a = out[i], b = out[(i + 9) % M];
    out[i].turn = Math.atan2(a.t.x * b.t.z - a.t.z * b.t.x, a.t.x * b.t.x + a.t.z * b.t.z);
  }
  for (let i = 0; i < M; i++) {
    let sum = 0;
    for (let d = -8; d <= 8; d++) sum += out[(i + d + M) % M].turn;
    // negative, because the outside of the bend is the side away from the turn
    out[i].bend = sum / 17;
    out[i].bank = Math.max(-0.08, Math.min(0.08, -out[i].bend * 0.62));
  }
  // the start straight stays flat, so the line, the gantry and the grid all sit
  // where they are drawn
  const FLAT = 26;
  for (let d = -FLAT; d <= FLAT; d++) {
    const i = (d + M) % M;
    out[i].bank *= Math.min(1, Math.abs(d) / FLAT) ** 2;
  }

  /* ---- the ramps ---------------------------------------------------------- */
  // The road itself climbs these, so a kart drives up rather than through, and
  // the lip is where game.js throws it into the air.
  const ramps = [];
  for (const at of [0.235, 0.615]) {
    /* The height of the jump is (v sin th)^2 / 2G, so a quarter of the height
       wants half the launch speed and half the launch speed wants half the ramp
       angle. 1.1m over four samples is about ten degrees, which throws a kart at
       racing speed a bit under a metre. */
    const i0 = Math.floor(at * M), len = 4, rise = 1.1;
    for (let k = 0; k < len; k++) {
      const i = (i0 + k) % M;
      const f = k / (len - 1);
      out[i].lift = rise * f * f * (3 - 2 * f);         // eased, so the run in is gentle
      out[i].p.y += out[i].lift;
      out[i].bank = 0;                                   // flat on the ramp
    }
    const lip = out[(i0 + len - 1) % M];
    ramps.push({ i: (i0 + len - 1) % M, pos: lip.p.clone(), s: lip.s });
  }

  /* ---- the bridge, the tunnel and the water ------------------------------ */
  // A smooth rise from nothing to the full amount and back, so each section
  // joins the road either side of it without a step.
  const bump = t => 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  // All three sit on straight stretches. They are flat inside, because the deck,
  // the tube and the sheet are all built square to the road, and a flat section
  // on the circuit's best corner is a corner thrown away.
  const features = [
    // long and gentle, because a bridge is a bridge: at this slope the crest
    // does not reach the launch threshold and nobody is thrown off it
    { kind: 'bridge', at: 0.06, len: 34, rise: 4.5 },
    { kind: 'tunnel', at: 0.44, len: 30 },
    { kind: 'water', at: 0.83, len: 34, drop: 3.1 },
  ];
  for (const f of features) {
    f.i0 = Math.floor(f.at * M);
    f.ids = [];
    // the water sits at the height the road was before it dipped
    let sum = 0;
    for (let k = 0; k < f.len; k++) sum += out[(f.i0 + k) % M].p.y;
    f.surfaceY = sum / f.len + 0.4;
    for (let k = 0; k < f.len; k++) {
      const i = (f.i0 + k) % M;
      const t = k / (f.len - 1);
      const a = out[i];
      f.ids.push(i);
      a.bank = 0;                                   // flat through all three
      if (f.kind === 'bridge') { a.p.y += f.rise * bump(t); a.bridge = 1; }
      else if (f.kind === 'tunnel') a.tunnel = 1;
      else if (f.kind === 'water') {
        a.p.y -= f.drop * bump(t);
        a.water = 1;
        a.waterY = f.surfaceY;
        if (k % 3 === 0) basins.push({ x: a.p.x, z: a.p.z, r: a.w + 26, drop: f.drop * bump(t) + 1.2 });
      }
    }
  }

  return { samples: out, length: s, ramps, features };
}

/* ---- put it together ----------------------------------------------------- */
export function buildTrack(scene, seed) {
  const { samples, length, ramps, features } = sampleLoop(seed);
  const N = samples.length;
  /* The camber pivots on the inside edge rather than the middle of the road.
     Tilting about the middle drops the inside edge below the field it is cut
     into, which buries the road under the ground mesh and puts a kart under the
     grass. Lifting the whole road by the amount the low side would have dropped
     keeps it on top of the world and only ever raises the outside. */
  const lift = a => a.w * Math.abs(a.bank);
  const surf = (a, lat) => a.p.y + lat * a.bank + lift(a);
  const group = new THREE.Group();
  scene.add(group);

  /* the ground, with a hill field under it */
  const gseg = 60, gspan = 900;
  const gg = new THREE.PlaneGeometry(gspan, gspan, gseg, gseg);
  gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    // the rim of hills the course sits in is part of groundY
    gp.setY(i, groundY(x, z));
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
    l.y = surf(a, a.w); r.y = surf(a, -a.w);           // the lean of the corner
    pos.push(l.x, l.y + 0.06, l.z, r.x, r.y + 0.06, r.z);
    uv.push(0, a.s / 9, 1, a.s / 9);
    // The kerb is the outer strip of the road now, not a verge outside it, so it
    // lies on the tarmac and leans with it.
    const lo = a.p.clone().addScaledVector(a.n, a.w - KERB).setY(surf(a, a.w - KERB));
    const ro = a.p.clone().addScaledVector(a.n, -(a.w - KERB)).setY(surf(a, -(a.w - KERB)));
    kpos.push(l.x, l.y + 0.07, l.z, lo.x, lo.y + 0.07, lo.z, r.x, r.y + 0.07, r.z, ro.x, ro.y + 0.07, ro.z);
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
  // across the road between the two posts, not lying along it: the box is long
  // on its own x, so that has to end up pointing down the normal
  banner.rotation.y = Math.atan2(s0.t.x, s0.t.z);
  banner.castShadow = true;
  group.add(banner);

  /* the edge of the circuit is a run of barrier models now, placed in props.js
     against the wall line this returns as `shoulder` */
  const m4 = new THREE.Matrix4();

  /* trees and hills for the middle distance */
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f9440, roughness: 1, flatShading: true });
  const trunks = [], leaves = [];
  // the trees get their own stream, started from the lap's seed so a new circuit
  // gets a new wood rather than the same one draped over it
  let tseed = (seed | 0) * 7 + 7;
  const rnd = () => { tseed = (tseed * 1103515245 + 12345) & 0x7fffffff; return tseed / 0x7fffffff; };
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
    const y = groundY(x, z);
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

  /* the stands, the barriers and the rest of the furniture are real models now,
     and they live in props.js */

  /* ---- the bridge, the tunnel and the water, built ------------------------ */
  for (const f of features) {
    const ids = f.ids;

    if (f.kind === 'bridge') {
      // a deck under the road and piers down to whatever the ground is doing
      const deckMat = new THREE.MeshStandardMaterial({ color: 0x8d8d8d, roughness: 0.9 });
      const pierMat = new THREE.MeshStandardMaterial({ color: 0x6f747d, roughness: 0.95 });
      const dp = [], du = [], di = [];
      ids.forEach((i, k) => {
        const a = samples[i];
        const l = a.p.clone().addScaledVector(a.n, a.w + KERB);
        const r = a.p.clone().addScaledVector(a.n, -(a.w + KERB));
        dp.push(l.x, l.y - 0.85, l.z, r.x, r.y - 0.85, r.z);
        du.push(0, k, 1, k);
      });
      for (let k = 0; k < ids.length - 1; k++) {
        const aa = k * 2, bb = aa + 1, cc = aa + 2, dd = aa + 3;
        di.push(aa, bb, cc, bb, dd, cc);
      }
      const deck = new THREE.Mesh(ribbon(dp, du, di), deckMat);
      deck.receiveShadow = true;
      group.add(deck);
      for (let k = 2; k < ids.length - 2; k += 5) {
        const a = samples[ids[k]];
        for (const side of [1, -1]) {
          const top = a.p.clone().addScaledVector(a.n, side * a.w * 0.78);
          const foot = groundY(top.x, top.z);
          const h = Math.max(1, top.y - 0.85 - foot);
          const pier = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, 1.5), pierMat);
          pier.position.set(top.x, foot + h / 2, top.z);
          pier.castShadow = true;
          group.add(pier);
        }
      }
    }

    if (f.kind === 'tunnel') {
      // a half pipe over the road, wide enough to clear the kerbs and low
      // enough to feel like a tunnel, with a light every so often
      const R = [], RU = [], RI = [], RINGS = 9;
      ids.forEach((i, k) => {
        const a = samples[i];
        const rad = a.w + KERB;
        for (let j = 0; j <= RINGS; j++) {
          const ang = Math.PI * (j / RINGS);
          const p = a.p.clone().addScaledVector(a.n, Math.cos(ang) * rad);
          R.push(p.x, a.p.y + Math.sin(ang) * rad * 0.58 - 0.2, p.z);
          RU.push(j / RINGS, k * 0.5);
        }
      });
      for (let k = 0; k < ids.length - 1; k++) {
        for (let j = 0; j < RINGS; j++) {
          const aa = k * (RINGS + 1) + j, bb = aa + 1;
          const cc = (k + 1) * (RINGS + 1) + j, dd = cc + 1;
          RI.push(aa, bb, cc, bb, dd, cc);
        }
      }
      // both sides: an arch you can see coming, and a roof once you are under it
      const tube = new THREE.Mesh(ribbon(R, RU, RI),
        new THREE.MeshStandardMaterial({ color: 0x59606e, roughness: 0.95, side: THREE.DoubleSide }));
      tube.castShadow = true; tube.receiveShadow = true;
      group.add(tube);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6e2, emissive: 0xffd233, emissiveIntensity: 1.1 });
      for (let k = 2; k < ids.length - 2; k += 4) {
        const a = samples[ids[k]];
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(a.w * 0.5, 0.25, 1.1), lampMat);
        lamp.position.set(a.p.x, a.p.y + (a.w + KERB) * 0.58 - 0.65, a.p.z);
        lamp.rotation.y = Math.atan2(a.t.x, a.t.z);
        group.add(lamp);
      }
    }

    if (f.kind === 'water') {
      // A sheet that follows the channel. A rectangle big enough to cover the
      // dip also floods every field around it, because the ground out there is
      // higher than the water.
      const wp = [], wu = [], wi = [], SPAN = 17;
      ids.forEach((i, k) => {
        const a = samples[i];
        const l = a.p.clone().addScaledVector(a.n, a.w + SPAN);
        const r = a.p.clone().addScaledVector(a.n, -(a.w + SPAN));
        wp.push(l.x, f.surfaceY, l.z, r.x, f.surfaceY, r.z);
        wu.push(0, k * 0.35, 1, k * 0.35);
      });
      for (let k = 0; k < ids.length - 1; k++) {
        const aa = k * 2, bb = aa + 1, cc = aa + 2, dd = aa + 3;
        wi.push(aa, cc, bb, bb, cc, dd);
      }
      const sheet = new THREE.Mesh(ribbon(wp, wu, wi), new THREE.MeshStandardMaterial({
        color: 0x2e86c8, roughness: 0.18, metalness: 0.15,
        transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide,
      }));
      sheet.renderOrder = 2;
      group.add(sheet);
    }
  }

  /* ---- things on the road ------------------------------------------------- */
  let bs = 991;
  const brnd = () => { bs = (bs * 1103515245 + 12345) & 0x7fffffff; return bs / 0x7fffffff; };

  const itemBoxes = [];
  // Nowhere near the ramps. A row before one is a row you are looking past, a
  // row after it is a row you fly over, and a row on it is a row you cannot
  // steer for. Boxes belong where you can actually go and get them.
  const nearRamp = i => ramps.some(r => {
    const d = Math.abs(((i - r.i + N) % N + N / 2) % N - N / 2);
    return d < 14;
  });
  for (let k = 0; k < 7; k++) {
    let i = Math.floor(((0.1 + k * 0.128 + brnd() * 0.04) % 1) * N);
    for (let n = 0; n < N && nearRamp(i); n++) i = (i + 5) % N;
    const a = samples[i];
    for (const off of [-0.55, 0, 0.55]) {
      const p = a.p.clone().addScaledVector(a.n, off * a.w);
      itemBoxes.push({ pos: p.clone().setY(surf(a, off * a.w) + 1.35), i, taken: 0 });
    }
  }

  // twice as many as there were, spread round the lap and set off to one side or
  // the other so taking one is a line you have to choose rather than a gift
  const boostPads = [];
  for (let k = 0; k < 6; k++) {
    const i = Math.floor(((0.07 + k * 0.161 + brnd() * 0.04) % 1) * N);
    const a = samples[i];
    const off = (brnd() * 1.1 - 0.55) * a.w;
    const p = a.p.clone().addScaledVector(a.n, off);
    boostPads.push({ pos: p.clone().setY(surf(a, off)), i, n: a.n.clone(), t: a.t.clone(), w: a.w * 0.34 });
  }
  // a booster on the run up to each ramp, so you are thrown further for taking it
  for (const r of ramps) {
    const a = samples[(r.i - 3 + N) % N];
    boostPads.push({ pos: a.p.clone().setY(surf(a, 0)), i: (r.i - 3 + N) % N, n: a.n.clone(), t: a.t.clone(), w: a.w * 0.8, ramp: true });
  }


  /* their meshes */
  /* The boxes: a blue crystal with a question mark on every face and a brighter
     core turning inside it. Two instanced meshes between the lot of them, and
     the question mark is drawn rather than modelled, which is what keeps the
     shell to one draw call. */
  const boxTex = canvasTex(128, 128, (g, W, H) => {
    g.fillStyle = 'rgba(58,150,220,0.92)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#bfe8ff'; g.lineWidth = 9;
    g.strokeRect(6, 6, W - 12, H - 12);
    // a few facets, so it reads as cut rather than moulded
    g.strokeStyle = 'rgba(200,238,255,0.45)'; g.lineWidth = 5;
    g.beginPath();
    g.moveTo(6, 40); g.lineTo(46, 6); g.moveTo(W - 6, H - 40); g.lineTo(W - 46, H - 6);
    g.stroke();
    g.fillStyle = '#fff6e2';
    g.font = 'bold 86px "Trebuchet MS", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = '#17223b'; g.lineWidth = 10;
    g.strokeText('?', W / 2, H / 2 + 4);
    g.fillText('?', W / 2, H / 2 + 4);
  }, [1, 1]);
  const boxMat = new THREE.MeshStandardMaterial({
    map: boxTex, color: 0xffffff, emissive: 0x2f7fd0, emissiveIntensity: 0.45,
    roughness: 0.22, metalness: 0.1, transparent: true, opacity: 0.86,
  });
  const boxGeo = new THREE.BoxGeometry(2.1, 2.1, 2.1);
  const boxMesh = new THREE.InstancedMesh(boxGeo, boxMat, itemBoxes.length);
  boxMesh.frustumCulled = false;
  group.add(boxMesh);
  const coreMesh = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.72, 0),
    new THREE.MeshStandardMaterial({ color: 0xdff2ff, emissive: 0x8fd3ff, emissiveIntensity: 1.2, roughness: 0.3 }),
    itemBoxes.length
  );
  coreMesh.frustumCulled = false;
  group.add(coreMesh);


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
    // Height between samples, not at them. Handing back the nearest sample's own
    // y made the kart step up and down every couple of metres, which reads as a
    // bumpy ride on a road that is meant to be smooth.
    const nb = samples[(best + (along >= 0 ? 1 : samples.length - 1)) % samples.length];
    const span = Math.abs(nb.s - a.s) || 1;
    const f = Math.min(1, Math.abs(along) / span);
    // the lean, held flat once you are off the tarmac so the kerb does not
    // launch anybody, and the ramps come along for the ride in p.y already
    const bank = a.bank + ((nb.bank - a.bank) * f);
    const lt = Math.max(-a.w, Math.min(a.w, lateral));
    // the same pivot the road is built on: lifted by what the low side would
    // otherwise have dropped, so the tarmac never sinks under the field
    let y = a.p.y + (nb.p.y - a.p.y) * f + lt * bank + a.w * Math.abs(bank);
    // Off the tarmac the ground takes over. The kerb is drawn from the road edge
    // down to the grass, so the height has to follow it down: keeping the road's
    // own height out there put a kart nearly two metres under the field on the
    // inside of a banked corner, with the camera below the surface and the road
    // hidden behind ground it was looking at from underneath.
    const over = Math.abs(lateral) - a.w;
    if (over > 0) {
      const g = groundY(x, z);
      const m = Math.min(1, over / KERB);
      y += (g - y) * m;
    }
    return {
      i: best, s: a.s + along, lateral, half: a.w,
      onRoad: Math.abs(lateral) <= a.w + 0.4,
      // the red and white is the outer strip of the road, so riding it is riding
      // the edge rather than being off the track
      onKerb: Math.abs(lateral) > a.w - KERB && Math.abs(lateral) <= a.w + 0.4,
      wall: a.w + SHOULDER,
      y, bank, t: a.t, n: a.n,
      // how steeply the road is climbing here, which is what throws a car
      slope: (nb.p.y - a.p.y) / (Math.abs(nb.s - a.s) || 1),
      // the surface above you, when there is one
      waterY: a.waterY === undefined ? null : a.waterY,
      tunnel: !!a.tunnel,
    };
  }

  return {
    group, samples, length, ramps, features, project, at, gridSlot, groundY,
    // how far past the tarmac the wall is, so the barriers can stand on it
    shoulder: SHOULDER,
    itemBoxes, boostPads, boxMesh, coreMesh,
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
