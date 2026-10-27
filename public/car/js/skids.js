// Tyre marks: a dark strip laid under each wheel while it slides (hard braking, the handbrake, wheelspin, a slide),
// as a ring of instanced quads that fade out over half a minute. One draw call for all of them.
import * as THREE from 'three';

const MAX = 900, LIFE = 30;

export class Skids {
  constructor(scene) {
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    // each mark's own age fades it (instance colour carries 1 - age / LIFE in all three channels)
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vColor.r;\n  diffuseColor.rgb = vec3(0.04);');
    };
    m.customProgramCacheKey = () => 'skids1';
    this.mesh = new THREE.InstancedMesh(g, m, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    // (hidden while there are no marks: three.js drew an empty instanced mesh every frame; perf)
    this.mesh.visible = false; this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'skids';
    scene.add(this.mesh);
    this.born = new Float32Array(MAX); this.next = 0; this.t = 0;
    this.last = [null, null, null, null];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
  }

  // v: the Vehicle; ground: (x, z, y) -> height
  update(dt, v, ground) {
    this.t += dt;
    const up = new THREE.Vector3(0, 1, 0);
    v.wheels.forEach((w, i) => {
      const sliding = w.contact && v.speed > 2.5 && (w.slip > 0.25 || w.lat > 0.2 || (v.handbrake > 0.3 && !w.front && Math.abs(v.fwdSpeed) > 3));
      if (!sliding) { this.last[i] = null; return; }
      const p = w.rest.clone().sub(v.com).applyQuaternion(v.q).add(v.pos);
      const g = ground(p.x, p.z, p.y);
      if (g === null || !Number.isFinite(g)) { this.last[i] = null; return; }
      p.y = g + 0.03;
      const prev = this.last[i];
      this.last[i] = p;
      if (!prev) return;
      const dx = p.x - prev.x, dz = p.z - prev.z, len = Math.hypot(dx, dz);
      if (len < 0.25) { this.last[i] = prev; return; }
      if (len > 3) return;
      const k = this.next; this.next = (this.next + 1) % MAX;
      this._p.set((p.x + prev.x) / 2, (p.y + prev.y) / 2, (p.z + prev.z) / 2);
      this._q.setFromAxisAngle(up, Math.atan2(-dz, dx));
      this._s.set(len + 0.05, 1, 0.21);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(k, this._m);
      this.born[k] = this.t;
      this.mesh.count = Math.max(this.mesh.count, k + 1); this.mesh.visible = true;
      this.mesh.instanceMatrix.needsUpdate = true;
    });
    // fade by age (cheap: a few hundred values; only the marks there are are sent to the graphics card)
    const n = this.mesh.count;
    if (!n) return;
    const c = this.mesh.instanceColor.array;
    for (let k = 0; k < n; k++) { const a = Math.max(0, 1 - (this.t - this.born[k]) / LIFE); c[k * 3] = c[k * 3 + 1] = c[k * 3 + 2] = a; }
    this.mesh.instanceColor.clearUpdateRanges(); this.mesh.instanceColor.addUpdateRange(0, n * 3);
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.mesh.count = 0; this.mesh.visible = false; this.next = 0; this.last = [null, null, null, null]; }
}
