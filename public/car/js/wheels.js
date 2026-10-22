// Wheels: a check on every model's wheel nodes as it loads, and the extra wheels of long vehicles.
// The rig spins each wheel about its node's x axis, through the node's origin. A model whose wheels were posed
// steered or cambered, or whose hub is off the tyre's centre, wobbles and tumbles when it spins (the first round's
// Milano, Porsche and Conquer had their front wheels modelled turned 18 to 30 degrees). The models are fixed at
// the source (scratchpad pipeline), and this straightens any that slip through, once per template.
import * as THREE from 'three';

const WHEEL = /^wheel_(FL|FR|RL|RR)(\d*)$/;
const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4(), _v = new THREE.Vector3();

// eigenvectors of a symmetric 3x3 matrix (Jacobi), columns sorted by ascending eigenvalue
function eigSym3(a) {
  const A = [[a[0], a[1], a[2]], [a[1], a[3], a[4]], [a[2], a[4], a[5]]];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-18) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const order = [0, 1, 2].sort((i, j) => A[i][i] - A[j][j]);
  return order.map(i => ({ value: A[i][i], vec: new THREE.Vector3(V[0][i], V[1][i], V[2][i]) }));
}

// points of a wheel node in its own frame (the tyre's, when its material says so)
function wheelPoints(n) {
  n.updateWorldMatrix(true, true);
  _inv.copy(n.matrixWorld).invert();
  const tyre = [], all = [];
  n.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    _m.multiplyMatrices(_inv, o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const isTyre = mats.length === 1 && /^tire/.test(mats[0] && mats[0].name || '');
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(_m);
      all.push(p); if (isTyre) tyre.push(p);
    }
  });
  return tyre.length > 60 ? tyre : all;
}

function axleOf(P) {
  const c = new THREE.Vector3();
  for (const p of P) c.add(p);
  c.divideScalar(P.length);
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of P) {
    const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  const e = eigSym3([xx, xy, xz, yy, yz, zz]);
  const ax = e[0].vec.normalize();
  if (ax.x < 0) ax.negate();
  return ax;
}

// transform the geometry of every mesh under node n by M, given in n's own frame (geometries are cloned first if
// another node shares them)
function transformUnder(n, M) {
  n.updateWorldMatrix(true, true);
  _inv.copy(n.matrixWorld).invert();
  n.traverse(o => {
    if (!o.isMesh) return;
    const L = new THREE.Matrix4().multiplyMatrices(_inv, o.matrixWorld); // mesh -> node
    const T = new THREE.Matrix4().copy(L).invert().multiply(M).multiply(L); // in the mesh's own frame
    if (o.geometry.userData.wheelFixed) o.geometry = o.geometry.clone();
    o.geometry.applyMatrix4(T);
    o.geometry.userData.wheelFixed = true;
    o.geometry.computeBoundingBox(); o.geometry.computeBoundingSphere();
  });
}

// straighten and centre every wheel node of a template (run once per loaded file)
export function fixWheels(scene, { maxTilt = 2, maxOff = 0.004 } = {}) {
  const report = {};
  const nodes = [];
  scene.traverse(n => { if (WHEEL.test(n.name)) nodes.push(n); });
  for (const n of nodes) {
    let P = wheelPoints(n);
    if (P.length < 30) continue;
    const ax = axleOf(P);
    const tilt = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, ax.x)));
    const r = { tilt: +tilt.toFixed(2), off: 0 };
    if (tilt > maxTilt) {
      const q = new THREE.Quaternion().setFromUnitVectors(ax, _v.set(1, 0, 0));
      transformUnder(n, new THREE.Matrix4().makeRotationFromQuaternion(q));
      for (const p of P) p.applyQuaternion(q);
      r.straightened = true;
    }
    // the tyre's centre: the middle of its extent across the axle (a tyre is round, so this is the hub)
    let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of P) { y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    r.off = +Math.hypot(cy, cz).toFixed(4);
    r.radius = +((y1 - y0 + z1 - z0) / 4).toFixed(4);
    if (r.off > maxOff) {
      transformUnder(n, new THREE.Matrix4().makeTranslation(0, -cy, -cz));
      // move the node by the same amount, so the wheel stays where it was and the physics gets the true hub
      _v.set(0, cy, cz).multiply(n.scale).applyQuaternion(n.quaternion);
      n.position.add(_v);
      r.centred = true;
    }
    report[n.name] = r;
  }
  scene.userData.wheelReport = report;
  return report;
}

// long vehicles: wheels beyond the four the physics uses (a bus's or truck's second rear axle, wheel_RL2 and so
// on) spin and ride with the physics wheel they are named after
export function addExtraWheels(rig, model) {
  const out = [];
  const ORDER = ['FL', 'FR', 'RL', 'RR'];
  const nodes = [];
  model.traverse(n => { const m = WHEEL.exec(n.name); if (m && m[2]) nodes.push([n, m[1]]); });
  for (const [n, k] of nodes) {
    const base = ORDER.indexOf(k);
    const pos = n.position.clone();
    const pivot = new THREE.Group(); pivot.name = 'pivot_' + n.name; pivot.position.copy(pos);
    const spin = new THREE.Group(); spin.name = 'spin_' + n.name;
    n.parent.add(pivot); pivot.add(spin); spin.add(n); n.position.set(0, 0, 0);
    const radius = (n.userData && n.userData.radius) || rig.wheels[base].radius;
    out.push({ pivot, spin, rest: pos.y, base, k: rig.wheels[base].radius / radius, steer: k[0] === 'F' });
  }
  return out;
}

export function updateExtraWheels(list, s, steerL, steerR) {
  for (const w of list) {
    if (s.wheelSpin) w.spin.rotation.x = -(s.wheelSpin[w.base] || 0) * w.k;
    w.pivot.position.y = w.rest + (s.susp ? (s.susp[w.base] || 0) : 0);
    if (w.steer) w.pivot.rotation.y = w.base === 0 ? steerL : steerR;
  }
}
