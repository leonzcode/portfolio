// Cars parked along the kerbs, as streets have them (and as Street View shows them). Only where a road is wider
// than its travel lanes (the strip left over is the parking lane), never near a junction, a hydrant or a bus stop,
// facing the way traffic goes on that side. Every parked car is solid. They are drawn with instancing: each model's
// parts are one InstancedMesh for all its parked copies, near ones with the detailed parts, the rest with the far
// ones, so a hundred parked cars cost about what one moving car does.
import * as THREE from 'three';
import { frame } from './geo.js?v=26';

const MODELS = ['fairheaven', 'milano', 'shvan', 'conquer', 's10', 'fairheaven', 'milano'];
// outside North America no pickups or boxy American vans: saloons and hatchbacks
const MODELS_ELSE = ['fairheaven', 'milano', 'volvos90', 'milano', 'fairheaven', 'volvos90', 'milano'];
const inAmericas = () => frame.lat > 14 && frame.lat < 72 && frame.lon > -170 && frame.lon < -52;
// the common colours of real cars, white and black and greys most of all
const PAINTS = [0xf2f2f0, 0xf2f2f0, 0x111214, 0x111214, 0x8c9096, 0xb8bcc2, 0x55595f, 0x1e3a6b, 0x7a1418];
const CLASSES = { residential: 0.42, tertiary: 0.32, secondary: 0.24, unclassified: 0.3, living_street: 0.35, primary: 0.15 };
const NEAR = 30, FAR = 90, SHADOW = 40, SHADOWS = 10, MAX = 160;

const hash = (a, b) => { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _c = new THREE.Color();

export class Parked {
  constructor({ scene, cars }) {
    this.scene = scene; this.C = cars;
    this.group = new THREE.Group(); this.group.name = 'parked'; scene.add(this.group);
    this.kinds = new Map(); // model -> { near: [{ mesh, local }], far: [...], shadow: [...] }
    this.list = []; this.frame = 0;
  }

  // the parts of one model, as InstancedMeshes
  async kind(model) {
    if (this.kinds.has(model)) return this.kinds.get(model);
    const p = (async () => {
      const rig = await this.C.loadCar(model, { npc: true, color: 0xffffff });
      rig.object.position.set(0, 0, 0); rig.object.quaternion.identity(); rig.object.updateMatrixWorld(true);
      const K = { model, near: [], far: [], shadow: [], dims: rig.dims, paintParts: [], paints: new Map() };
      const add = (list, o, cast) => {
        const im = new THREE.InstancedMesh(o.geometry, o.material, MAX);
        im.count = 0; im.frustumCulled = false; im.castShadow = !!cast; im.receiveShadow = !cast;
        im.userData.local = o.matrixWorld.clone();
        this.group.add(im); list.push(im);
      };
      rig.object.traverse(o => {
        if (!o.isMesh) return;
        let far = false, a = o; while (a) { if (a.name === 'far') far = true; a = a.parent; }
        const paint = !o.castShadow && /paint/.test(o.name || '');
        // the paint is drawn per colour (the paint shader takes its colour from its material)
        if (paint) K.paintParts.push({ name: o.name, far, local: o.matrixWorld.clone(), geometry: o.geometry });
        else if (o.castShadow) add(K.shadow, o, true);
        else if (far) add(K.far, o);
        else add(K.near, o);
      });
      return K;
    })();
    this.kinds.set(model, p);
    return p;
  }

  // one model's paint parts in one colour, as InstancedMeshes made with that colour's own paint material
  paintSet(K, color) {
    let P = K.paints.get(color);
    if (P) return P;
    P = { near: [], far: [], ready: false };
    K.paints.set(color, P);
    P.promise = this.C.loadCar(K.model, { npc: true, color }).then(rig => {
      const mats = new Map(); rig.object.traverse(o => { if (o.isMesh && /paint/.test(o.name || '')) mats.set(o.name, o.material); });
      for (const part of K.paintParts) {
        const mat = mats.get(part.name); if (!mat) continue;
        const im = new THREE.InstancedMesh(part.geometry, mat, MAX);
        im.count = 0; im.frustumCulled = false; im.receiveShadow = true;
        im.userData.local = part.local;
        this.group.add(im); (part.far ? P.far : P.near).push(im);
      }
      P.ready = true; this.frame = 0;
    }).catch(() => {});
    return P;
  }

  // slots along every road wide enough to have a parking strip, round (cx, cz)
  async build(roads, data, { cx = 0, cz = 0, radius = 230, collide, lift = 0, leftHand = false } = {}) {
    const S = roads && roads._debug ? roads._debug() : null;
    if (!S || !S.edges || !this.C) return this;
    const avoid = [];
    for (const p of (data && data.points) || []) if (p.kind === 'fire_hydrant' || p.kind === 'bus_stop' || p.kind === 'traffic_signals' || p.kind === 'crossing') avoid.push([p.x, p.z, p.kind === 'bus_stop' ? 14 : p.kind === 'fire_hydrant' ? 4.5 : 8]);
    // junctions keep clear by their widest road plus a car's length
    const jn = [];
    for (const J of S.junctions || []) { if (!J.n) continue; let w = 0; for (const L of J.E || []) { const c = (L.e || L).c; if (c) w = Math.max(w, c.hw); } jn.push([J.n.x, J.n.z, w + 8]); }
    const nearJunction = (x, z) => jn.some(([jx, jz, r]) => (jx - x) ** 2 + (jz - z) ** 2 < r * r);
    // a spot must be nearest its own road at its middle and both ends (else it is where another road crosses)
    const own = (e, x, z) => { if (!roads.nearestEdge) return true; const n = roads.nearestEdge(x, z, 30); return !n || !n.edge || n.edge === e; };
    const out = [];
    for (const e of S.edges) {
      const c = e.c, pr = CLASSES[c && c.cls];
      if (!pr || c.bridge || !e.pts || e.pts.length < 2) continue;
      const strip = (c.width - c.travel) / 2;
      if (strip < 1.9) continue;
      const pts = e.pts;
      // arc length
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const L = cum[cum.length - 1];
      if (L < 30) continue;
      const step = 6.3, ends = 11;
      for (const side of [1, -1]) {
        if (c.oneway && side === (leftHand ? 1 : -1) && strip < 2.2) continue;
        for (let k = 0, s = ends; s < L - ends; s += step, k++) {
          if (hash(e.id * 2 + (side > 0 ? 1 : 0), k) > pr) continue;
          let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
          const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
          const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
          const dx = bx - ax, dz = bz - az, dl = Math.hypot(dx, dz) || 1, tx = dx / dl, tz = dz / dl;
          const off = c.travel / 2 + strip / 2 + 0.05;
          const x = ax + dx * t - tz * off * side, z = az + dz * t + tx * off * side;
          if ((x - cx) ** 2 + (z - cz) ** 2 > radius * radius) continue;
          if (avoid.some(([px, pz, r]) => (px - x) ** 2 + (pz - z) ** 2 < r * r)) continue;
          if (nearJunction(x, z) || !own(e, x, z) || !own(e, x + tx * 3, z + tz * 3) || !own(e, x - tx * 3, z - tz * 3)) continue;
          const sf = roads.surfaceAt(x, z);
          if (!sf || !sf.onRoad || !Number.isFinite(sf.h)) continue;
          // facing the way traffic goes on that side of the road
          const along = (side > 0) !== leftHand;
          const heading = (Math.atan2(along ? tx : -tx, along ? -tz : tz) * 180 / Math.PI + 360) % 360;
          const ML = inAmericas() ? MODELS : MODELS_ELSE, model = ML[(hash(e.id, k * 7 + 3) * ML.length) | 0];
          out.push({ x, y: sf.h + lift, z, heading, model, paint: PAINTS[(hash(k, e.id * 3 + 1) * PAINTS.length) | 0] });
          if (out.length >= 420) break;
        }
      }
    }
    // models first, then they become solid and visible (the old list stays on screen until then)
    await Promise.all([...new Set(out.map(o => o.model))].map(m => this.kind(m).catch(() => null)));
    for (const o of out) {
      const K = await this.kinds.get(o.model);
      if (!K) { o.skip = true; continue; }
      o.K = K;
      const d = K.dims, hl = d.length / 2 - 0.1, hw = d.width / 2 - 0.05, h = o.heading * Math.PI / 180;
      const fx = Math.sin(h), fz = -Math.cos(h), rx = -fz, rz = fx;
      if (collide) collide.addPolygon([[o.x + fx * hl + rx * hw, o.z + fz * hl + rz * hw], [o.x + fx * hl - rx * hw, o.z + fz * hl - rz * hw], [o.x - fx * hl - rx * hw, o.z - fz * hl - rz * hw], [o.x - fx * hl + rx * hw, o.z - fz * hl + rz * hw]], o.y - 0.5, o.y + d.height, 'parked');
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -h);
      o.m = new THREE.Matrix4().compose(_p.set(o.x, o.y, o.z), _q, _s);
    }
    this.list = out;
    this.frame = 0;
    // every colour's paint ready now (made the first time a car of that colour came near, it held a frame)
    const sets = new Map(); for (const o of out) if (o.K && !o.skip) sets.set(o.K.model + ':' + o.paint, [o.K, o.paint]);
    await Promise.all([...sets.values()].map(([K, col]) => (this.paintSet(K, col).promise || Promise.resolve()).catch(() => {})));
    return this;
  }

  // every few frames: near cars with their detailed parts, the rest with the far ones, shadows only round the camera
  update(camera) {
    if ((this.frame++ % 8) !== 0 || !this.list.length) return;
    const cx = camera.position.x, cz = camera.position.z;
    const sets = new Map(), shadowed = [];
    for (const o of this.list) {
      if (!o.K || o.skip) continue;
      const d2 = (o.x - cx) ** 2 + (o.z - cz) ** 2;
      if (d2 > FAR * FAR) continue;
      let S = sets.get(o.K); if (!S) sets.set(o.K, S = { near: [], far: [], shadow: [] });
      (d2 < NEAR * NEAR ? S.near : S.far).push(o);
      if (d2 < SHADOW * SHADOW) { o.d2 = d2; shadowed.push(o); }
    }
    // shadows for the nearest few only
    shadowed.sort((a, b) => a.d2 - b.d2);
    for (const o of shadowed.slice(0, SHADOWS)) sets.get(o.K).shadow.push(o);
    const fill = (meshes, cars) => {
      for (const im of meshes) {
        const n = Math.min(cars.length, MAX);
        for (let i = 0; i < n; i++) {
          _m.multiplyMatrices(cars[i].m, im.userData.local);
          im.setMatrixAt(i, _m);
        }
        im.count = n;
        im.instanceMatrix.needsUpdate = true;
      }
    };
    const seen = new Set();
    for (const [K, S] of sets) {
      fill(K.near, S.near); fill(K.far, S.far); fill(K.shadow, S.shadow); seen.add(K);
      // paint, one set a colour
      const byCol = new Map();
      for (const [which, cars] of [['near', S.near], ['far', S.far]]) for (const o of cars) { let b = byCol.get(o.paint); if (!b) byCol.set(o.paint, b = { near: [], far: [] }); b[which].push(o); }
      for (const [col, P] of K.paints) if (!byCol.has(col)) for (const im of [...P.near, ...P.far]) im.count = 0;
      for (const [col, b] of byCol) { const P = this.paintSet(K, col); if (P.ready) { fill(P.near, b.near); fill(P.far, b.far); } }
    }
    for (const o of this.list) if (o.K && !seen.has(o.K)) { for (const im of [...o.K.near, ...o.K.far, ...o.K.shadow]) im.count = 0; for (const P of o.K.paints.values()) for (const im of [...P.near, ...P.far]) im.count = 0; seen.add(o.K); }
  }

  clear() {
    this.list = [];
    for (const p of this.kinds.values()) Promise.resolve(p).then(K => { if (!K) return; for (const im of [...K.near, ...K.far, ...K.shadow]) im.count = 0; for (const P of K.paints.values()) for (const im of [...P.near, ...P.far]) im.count = 0; });
  }

  dispose() {
    this.clear();
    this.scene.remove(this.group);
  }
}
