// The compile gate (perf B): nothing is drawn with a shader program that is still being built.
// A program first met in a draw is built there and then, and the draw waits for it: 0.3 to 3.6 s frames after area
// rebuilds (parked cars, bridges, trees' shadows). The gate watches everything put into the scene (Object3D.add, so
// every module's meshes, the map tiles and the people too): a mesh whose material has no program ready for that kind
// of mesh (instanced, skinned...) is kept out of the drawing (moved to a layer the camera does not see) and its
// programs are built in the background (renderer.compile with KHR_parallel_shader_compile); it is put back once they
// are linked. A mesh that casts a shadow whose shadow-pass program is new stays out of the shadow map (castShadow
// off) until that program is built too (with a depth material of the same variant as the shadow map's own).
// The building is done a few milliseconds a frame (flush(), called by main.js before each frame is drawn).
// Rays (THREE.Raycaster) still meet held meshes. Not covered: a material changed on a mesh already in the scene
// (needsUpdate, a new map), which three rebuilds in the next draw. ?nogate turns it off; with ?trace
// window.__car.gate.log lists what it held back.
import * as THREE from 'three';

const HIDE = 1 << 30; // the layer a held mesh is moved to (no camera has it)
const MAX_WAIT = 20000; // a program that never says it is ready is shown anyway after this
const BUDGET = 4; // ms of building a frame (at least one mesh a frame)

// what of a mesh decides which program its material gets (three's needsProgramChange)
function kindOf(o, m) {
  const g = o.geometry, a = g && g.attributes, ma = g && g.morphAttributes;
  return (o.isInstancedMesh ? 'I' + (o.instanceColor ? 'c' : '') + (o.morphTexture ? 'm' : '') : '') + (o.isSkinnedMesh ? 'S' : '') + (o.isBatchedMesh ? 'B' + (o.colorTexture ? 'c' : '') : '')
    + (o.isLine ? 'L' : o.isPoints ? 'P' : o.isSprite ? 'Z' : '')
    + (ma && ma.position ? 'Mp' + ma.position.length : '') + (ma && ma.normal ? 'Mn' : '') + (ma && ma.color ? 'Mc' : '')
    + (a && m.vertexColors === true && a.color && a.color.itemSize === 4 ? 'va' : '') + (a && a.tangent && (m.normalMap || m.anisotropy > 0) ? 'vt' : '')
    + (a && a.uv1 ? 'u1' : '') + (a && a.uv2 ? 'u2' : '') + (a && a.uv3 ? 'u3' : '');
}

// the side a shadow pass draws a material with (WebGLShadowMap: back faces of front-sided ones, not VSM)
const shadowSideOf = m => m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : (m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);

export class CompileGate {
  constructor(renderer, scene, camera) {
    this.R = renderer; this.scene = scene; this.camera = camera; this.P = renderer.properties;
    this.on = !/[?&]nogate/.test(location.search);
    this.queue = new Set();     // meshes whose programs are still to be asked for
    this.held = new Map();      // mesh -> { t, mask, layer, shadow, depth: [materials] }
    this.asked = new WeakMap(); // material -> Set of mesh kinds its program was asked for
    this.depthMats = new Map(); // shadow variant -> our own depth material of that variant (keeps its program alive)
    this.ours = new WeakSet();
    this.stats = { held: 0, shadowHeld: 0, flushes: 0, compiled: 0, depthCompiled: 0, timeouts: 0, maxFlushMs: 0 };
    this.log = /[?&]trace/.test(location.search) ? [] : null;
    this.lastPoll = 0; this.batchN = 12;
    this.fast = false; // (drive.start sets it while the loading card is up: bigger batches, no frame to keep smooth)
    if (this.on) this.install();
  }

  install() {
    const gate = this, add0 = THREE.Object3D.prototype.add;
    THREE.Object3D.prototype.add = function (...objs) {
      const r = add0.apply(this, objs);
      try {
        if (gate.on) { let p = this; while (p.parent) p = p.parent; if (p === gate.scene) for (const o of objs) if (o && o.isObject3D) gate.check(o); }
      } catch (e) { console.warn('gate', e); }
      return r;
    };
    // rays still meet a held mesh (three's Raycaster skips objects not on its layers): the ground under a wheel in the
    // Google world is a ray against the tiles, and a tile that just came in is held for a frame or two
    const RC = THREE.Raycaster.prototype;
    for (const k of ['intersectObject', 'intersectObjects']) {
      const f = RC[k]; if (typeof f !== 'function') continue;
      RC[k] = function (...a) { const L = this.layers, m = L.mask; L.mask = m | HIDE; try { return f.apply(this, a); } finally { L.mask = m; } };
    }
  }

  // this material's programs for this kind of mesh built and linked
  ready(m, o) {
    const mp = this.P.get(m);
    if (!mp.currentProgram || !mp.programs) return false;
    // (changed since it was last drawn: needsUpdate, a new map or envMap; three asks for a program again then)
    if (mp.__version !== undefined && mp.__version !== m.version) return false;
    const g = o.geometry, inst = !!o.isInstancedMesh;
    if (mp.instancing !== inst || mp.skinning !== !!o.isSkinnedMesh || mp.batching !== !!o.isBatchedMesh) return false;
    if (inst && mp.instancingColor !== (o.instanceColor !== null)) return false;
    if (g && g.morphAttributes && mp.morphTargets !== !!g.morphAttributes.position) return false;
    if (g && g.attributes) {
      if (mp.vertexAlphas !== (m.vertexColors === true && !!g.attributes.color && g.attributes.color.itemSize === 4)) return false;
      if (mp.vertexTangents !== (!!g.attributes.tangent && (!!m.normalMap || m.anisotropy > 0))) return false;
    }
    for (const p of mp.programs.values()) if (!p.isReady()) return false;
    return true;
  }

  // the shadow pass's material for this mesh and material, as WebGLShadowMap.getDepthMaterial makes it: the mesh's
  // own customDepthMaterial, or one of ours of the same variant (made once and kept)
  depthOf(o, m) {
    // (the shadow pass gives its depth material the mesh material's map, alpha map, alpha test and displacement, so
    // they are part of the variant whether or not it makes a copy of its own for alpha-tested ones)
    const side = shadowSideOf(m), at = m.alphaToCoverage === true ? 0.5 : m.alphaTest;
    const key = [side, m.wireframe ? 'w' : '', m.map ? 'm' + m.map.channel : '', m.alphaMap ? 'a' + m.alphaMap.channel : '', at > 0 ? 't' : '', m.displacementMap ? 'd' + m.displacementMap.channel : ''].join(',');
    // (the shadow pass sets a custom one up from the mesh's material on every draw, so its variant is in the key too)
    if (o.customDepthMaterial) return { d: o.customDepthMaterial, k: kindOf(o, o.customDepthMaterial) + '|' + key + '#' + o.customDepthMaterial.version };
    let d = this.depthMats.get(key);
    if (!d) {
      d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      d.side = side; d.wireframe = !!m.wireframe; d.name = 'gate_depth'; this.ours.add(d);
      d.map = m.map; d.alphaMap = m.alphaMap; d.alphaTest = at; d.displacementMap = m.displacementMap; d.displacementScale = m.displacementScale; d.displacementBias = m.displacementBias;
      this.depthMats.set(key, d);
    }
    return { d, k: kindOf(o, d) + '|' + key + '#' + d.version };
  }

  check(root) {
    root.traverse(o => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || this.held.has(o)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let need = false;
      for (const m of mats) if (m && !this.ready(m, o)) { need = true; break; }
      let depth = null;
      if (o.castShadow && this.R.shadowMap.enabled && !o.isSprite) {
        for (const m of mats) { if (!m || !m.visible) continue; const v = this.depthOf(o, m); v.m = m; if (!this.wasAsked(v.d, v.k) || !this.progsReady(v.d)) (depth || (depth = [])).push(v); }
      }
      if (!need && !depth) return;
      const h = { t: performance.now(), layer: false, shadow: false, depth };
      if (need) { h.mask = o.layers.mask; o.layers.mask = HIDE; h.layer = true; this.stats.held++; }
      else { o.castShadow = false; h.shadow = true; this.stats.shadowHeld++; }
      this.held.set(o, h);
      this.queue.add(o);
      if (this.log && this.log.length < 600) { const n = []; let a = o; while (a && n.length < 4) { n.push(a.name || a.type); a = a.parent; } this.log.push([Math.round(h.t), need ? 'draw' : 'shadow', mats.map(m => m && (m.type + ':' + (m.name || ''))).join('+'), n.reverse().join('/')]); }
    });
  }

  progsReady(m) { const mp = this.P.get(m); if (!mp.programs || !mp.currentProgram) return false; for (const p of mp.programs.values()) if (!p.isReady()) return false; return true; }

  // was this material's program for this kind already asked for (then it only has to finish linking)
  wasAsked(m, k) { const s = this.asked.get(m); return !!(s && s.has(k)); }
  markAsked(m, k) { let s = this.asked.get(m); if (!s) this.asked.set(m, s = new Set()); s.add(k); }

  // once a frame, before the drawing: ask for the programs of what came in (a few ms of it), show what is ready
  flush() {
    if (!this.on || (!this.queue.size && !this.held.size)) return;
    try { this._flush(); } catch (e) { console.warn('gate', e); for (const o of [...this.held.keys()]) this.release(o); this.queue.clear(); }
  }

  _flush() {
    const t0 = performance.now();
    if (this.queue.size) {
      const main = [], deep = [], budget = this.fast ? 40 : BUDGET;
      let made = false;
      for (const o of this.queue) {
        // (the rest next frame, they stay held meanwhile; and while driving, at most one call a frame that makes new
        // programs: each costs about 40 ms of the page's own time, the GPU's link comes after)
        if (performance.now() - t0 > budget || (made && !this.fast)) break;
        this.queue.delete(o);
        let p = o; while (p.parent) p = p.parent;
        if (p !== this.scene) { this.release(o); continue; } // taken out again before it was drawn
        const h = this.held.get(o); if (!h) continue;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (h.layer) { let want = false; for (const m of mats) { if (!m) continue; const k = kindOf(o, m) + '#' + m.version; if (!this.wasAsked(m, k)) { this.markAsked(m, k); want = true; } } if (want) main.push(o); }
        if (h.depth) for (const v of h.depth) if (!this.wasAsked(v.d, v.k)) { this.markAsked(v.d, v.k); deep.push([o, v.d, v.m]); }
        // (compiled in groups: each renderer.compile walks the scene's lights once)
        if (main.length + deep.length >= (this.fast ? 24 : this.batchN)) { made = this.compileNow(main, deep) || made; main.length = 0; deep.length = 0; }
      }
      made = this.compileNow(main, deep) || made;
    }
    // what is ready goes back in (looked at every 30 ms at most: each look at a program still linking asks the GPU)
    const now = performance.now();
    if (now - this.lastPoll > 30 && this.held.size) {
      this.lastPoll = now;
      const notReady = new Set();
      const progsReady = mp => { if (!mp.programs || !mp.currentProgram) return false; for (const p of mp.programs.values()) { if (notReady.has(p)) return false; if (!p.isReady()) { notReady.add(p); return false; } } return true; };
      // (while driving at most 48 shown a frame: each one's vertex buffers go to the card in its first draw)
      let shown = 0;
      for (const [o, h] of this.held) {
        if (!this.fast && shown >= 48) break;
        if (this.queue.has(o)) continue;
        let ok = true;
        if (h.layer) { const mats = Array.isArray(o.material) ? o.material : [o.material]; for (const m of mats) if (m && !progsReady(this.P.get(m))) { ok = false; break; } }
        if (ok && h.depth) for (const v of h.depth) if (!progsReady(this.P.get(v.d))) { ok = false; break; }
        if (!ok && now - h.t > MAX_WAIT) { ok = true; this.stats.timeouts++; }
        if (ok) { this.release(o); shown++; }
      }
    }
    const ms = performance.now() - t0; if (ms > this.stats.maxFlushMs) this.stats.maxFlushMs = Math.round(ms);
  }

  // (returns whether it made new programs; then the next calls take one mesh at a time until one makes none)
  compileNow(main, deep) {
    if (!main.length && !deep.length) return false;
    this.stats.flushes++;
    const n0 = this.R.info.programs.length, t0 = performance.now(), n = main.length + deep.length;
    // (the next group's size: as many meshes as fit in the frame's budget at this call's pace, one after a call that
    // made programs; a person's recoloured materials took 4 ms a mesh even with their programs already built)
    try { this._compileNow(main, deep); } finally { const made = this.R.info.programs.length > n0, per = (performance.now() - t0) / Math.max(1, n); this.batchN = made ? 1 : Math.max(1, Math.min(12, Math.floor(BUDGET / Math.max(0.05, per)))); if (made) this.stats.made = (this.stats.made || 0) + 1; return made; }
  }
  _compileNow(main, deep) {
    // the meshes' own programs, lit as the scene is
    const tc = performance.now(), nProg = this.R.info.programs.length;
    if (main.length) { try { this.R.compile({ traverse: f => { for (const o of main) f(o); }, traverseVisible() {} }, this.camera, this.scene); this.stats.compiled += main.length; } catch (e) { console.warn('gate compile', e); } }
    if (this.log) { const ms = performance.now() - tc; if (ms > 20) (this.slow || (this.slow = [])).push([Math.round(tc), Math.round(ms), this.R.info.programs.length - nProg, main.slice(0, 4).map(o => (o.material && (o.material.type + ':' + o.material.name)) + '@' + (o.parent && o.parent.name)).join(' ')]); }
    if (!deep.length) return;
    // the shadow pass's programs: each mesh given its depth material for a moment, compiled into a render target as
    // the shadow map is drawn (no tone mapping, linear output) and with no fog (the shadow pass draws an empty scene,
    // and fog is part of a program's key), then given its own material back
    const prev = this.R.getRenderTarget(), rt = this.rt || (this.rt = new THREE.WebGLRenderTarget(4, 4)), fog = this.scene.fog;
    const rounds = []; // (a mesh with two depth materials goes in two rounds)
    for (const [o, d, m] of deep) { let r = rounds.find(x => !x.has(o)); if (!r) rounds.push(r = new Map()); r.set(o, [d, m]); }
    try {
      this.R.setRenderTarget(rt); this.scene.fog = null;
      for (const r of rounds) {
        const back = [];
        for (const [o, [d, m]] of r) {
          back.push([o, o.material]); o.material = d;
          // (a mesh's own customDepthMaterial is set up from its material as the shadow pass does on every draw)
          if (!this.ours.has(d)) { d.side = shadowSideOf(m); d.wireframe = !!m.wireframe; d.alphaMap = m.alphaMap; d.alphaTest = m.alphaToCoverage === true ? 0.5 : m.alphaTest; d.map = m.map; d.displacementMap = m.displacementMap; d.displacementScale = m.displacementScale; d.displacementBias = m.displacementBias; }
        }
        try { this.R.compile({ traverse: f => { for (const o of r.keys()) f(o); }, traverseVisible() {} }, this.camera, this.scene); this.stats.depthCompiled += r.size; }
        finally { for (const [o, m] of back) o.material = m; }
      }
    } catch (e) { console.warn('gate depth', e); }
    finally { this.scene.fog = fog; this.R.setRenderTarget(prev); }
  }

  release(o) {
    const h = this.held.get(o); if (!h) return;
    this.held.delete(o); this.queue.delete(o);
    if (h.layer && o.layers.mask === HIDE) o.layers.mask = h.mask;
    if (h.shadow && o.castShadow === false) o.castShadow = true;
  }

  get busy() { return this.queue.size + this.held.size; }
}
