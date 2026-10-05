/* ---------------------------------------------------------------------------
   Leoncraft 2 - the frame, start to finish.

     sky          the atmosphere tables, and what everything is lit by
     interaction  ripples and trampled grass, stepped at 60 a second
     shadow       the world from the sun (or moon), into a squeezed map
                  centred on the player, snapped to its texels so it does not
                  shimmer as you walk
     world        opaque and alpha-tested blocks into a floating-point target
     copies       that colour and its depth, for the water to see through
     water        water, lava, ice and stained glass over it
     post         light shafts, clouds, sky and fog, bloom, exposure, tone
                  mapping, FXAA

   Chunk meshes come in from the workers as plain arrays and are wrapped here.
--------------------------------------------------------------------------- */
import { Sky, SUN_I } from './sky.js?v=14';
import { Post } from './post.js?v=14';
import { Interaction } from './interaction.js?v=14';
import { makeMaterials, makeLayerInfo, bakeLayerMaterials } from './materials.js?v=14';
import { makeWaterMaterial } from './water.js?v=14';
import { makeNoise2D, makeNoise3D } from './noisetex.js?v=14';
import { makeLdrSky } from './ldrsky.js?v=14';
import { FullScreen } from './sky.js?v=14';
import { blockGeometry } from './blockmesh.js?v=14';
import { Avatar } from './avatar.js?v=14';
import { Vanilla, makeVanillaMaterials } from './vanilla.js?v=14';
import { BlockClouds, detailedCloudMaterial } from './clouds.js?v=14';
import { ShadowMaps } from './shadows.js?v=14';
import { dimLook } from '../dim/look.js?v=14';
import { makeToneLut } from './glsl.js?v=14';
const THREE = window.THREE;
// one black pixel, for a texture that is made later
function blankTexture() {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  t.needsUpdate = true;
  return t;
}

export class Renderer {
  constructor(canvas, textures, opts) {
    this.opts = Object.assign({ renderDist: 10, shadowRes: 2048, shadowDist: 112, scale: 1, shadows: 2, ldr: false }, opts || {});
    const ldr = this.ldr = !!this.opts.ldr;
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    r.setPixelRatio(1);
    r.autoClear = false;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    if (!r.capabilities.isWebGL2) throw new Error('WebGL2 is needed');
    r.getContext().getExtension('EXT_color_buffer_float');
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
    this.scene = new THREE.Scene();          // opaque and cutout
    this.trans = new THREE.Scene();          // fluids and translucent
    this.shadowScene = new THREE.Scene();    // what moves: your own body (render/avatar.js)
    this.shadowTerrain = new THREE.Scene();  // the world's blocks, drawn into their own map and kept
    this.shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 400);
    // Fast graphics is the game with no shaders (vanilla.js): no atmosphere tables at all
    this.sky = this.opts.vanilla ? null : new Sky(r);
    this.inter = new Interaction(r, this.opts.interSize || 256);
    // the sun's shadow maps (render/shadows.js); with no shadows at all, token ones
    const sr = this.opts.shadows ? this.opts.shadowRes : 4;
    this.shadows = new ShadowMaps(this, sr);
    // the textures
    this.U = {
      uTime: { value: 0 }, uFrame: { value: 0 },
      uAlbedo: { value: textures.albedo }, uNormalMap: { value: textures.normal }, uSpecMap: { value: textures.spec },
      uLayerInfo: { value: makeLayerInfo(textures.manifest) }, uLayerMat: { value: blankTexture() },
      uAmbient: { value: this.sky ? this.sky.amb.texture : null }, uView: { value: this.sky ? this.sky.view.texture : null }, uTrans: { value: this.sky ? this.sky.trans.texture : null },
      uNoise: { value: makeNoise2D() }, uNoise3: { value: ldr ? null : makeNoise3D() },
      uShadow: { value: this.shadows.texture }, uShadowMat: { value: new THREE.Matrix4() }, uShadowRes: { value: sr },
      // your own body's small shadow map, and how to find it from the blocks' one (render/shadows.js)
      uBodyShadow: { value: this.shadows.body.depthTexture }, uBodyMat: { value: new THREE.Matrix4() }, uBody: { value: new THREE.Vector4() },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uInteract: { value: this.inter.texture }, uInteractRect: { value: this.inter.rect }, uPlayer: { value: new THREE.Vector3() },
      uWet: { value: 0 }, uSceneColor: { value: null }, uSceneDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uEyeInWater: { value: 0 }, uNear: { value: 0.05 }, uFar: { value: 1000 }, uProjInv: { value: new THREE.Matrix4() },
      uRender: { value: 160 }, uMoon: { value: textures.moon }, uMoonPhase: { value: 0 }, uSkyAtEye: { value: 1 },
      uWaterTint: { value: new THREE.Vector3(0.05, 0.18, 0.78) }, uCover: { value: 0.42 }, uCamPos: { value: new THREE.Vector3() },
      uClock: { value: 0 }, uFaceRot: { value: new THREE.Matrix3() }, uExposure: { value: 1 }, uCave: { value: 0 }, uInvViewProj: { value: new THREE.Matrix4() },
      // the light in your hand (level, faded in and out) and where it is; torches' flicker; how dark cloud shadows are
      uHeldLight: { value: 0 }, uHeldPos: { value: new THREE.Vector3() }, uFlicker: { value: 1 }, uCloudShadow: { value: this.opts.cloudShadow > 0 ? 0.8 : 0 },
      // where a chunk mesh sits (set per draw by drawParts; 0 for everything three.js draws itself)
      uChunk: { value: new THREE.Vector3() },
      // the dimension being drawn (js/dims.js; js/dim/look.js sets these each frame)
      uDim: { value: 0 }, uDimAmb: { value: new THREE.Vector3() }, uDimFog: { value: new THREE.Vector3() }, uDimFogRange: { value: new THREE.Vector2(0, 1) },
      uEndSky: { value: textures.endSky || null },
      // Detailed's per-vertex light, from the light table each frame (sky.js setUniforms), and the fog's colours
      uAmbUp: { value: new THREE.Vector3() }, uAmbSide: { value: new THREE.Vector3() }, uAmbDown: { value: new THREE.Vector3() },
      uSunC: { value: new THREE.Vector3() }, uDayK: { value: 0 }, uExpo: { value: 1 }, uFogK: { value: 0.0019 },
      uFogTab: { value: this.sky ? this.sky.fog.texture : null }, uShadowInv: { value: new THREE.Matrix4() },
      // Detailed's tone curve as a table (glsl.js TONE_LUT)
      uToneLut: { value: this.opts.vanilla ? null : makeToneLut() },
    };
    if (this.opts.vanilla) {
      this.vanilla = new Vanilla(this, textures);
      this.mats = makeVanillaMaterials(this.U);
    } else {
      this.mats = makeMaterials(this.U, this.opts);
      this.mats.fluid = makeWaterMaterial(this.U, this.opts);
    }
    this.gl = r.getContext();
    this.makeStandIns();
    // the full tiers run the whole chain after the world; the low ones draw straight to the screen
    this.post = ldr ? null : new Post(r, this.U, this.opts);
    // Detailed: the sky in one pass first, and the game's own blocks of cloud after the world
    if (ldr && !this.vanilla) {
      this.skyFS = new FullScreen(makeLdrSky(this.U));
      // drawn after every solid thing and before anything blended (rain, glass, beams), only where
      // nothing covers it (ldrsky.js), so most of the screen never runs the sky's shader
      this.skyFS.mesh.renderOrder = 1e6;
      this.scene.add(this.skyFS.mesh);
      this.blockClouds = new BlockClouds(detailedCloudMaterial(this.U));
    }
    // the block in your hand: drawn in the world just in front of the eye
    this.handScene = new THREE.Scene();
    this.hand = new THREE.Group();
    this.handScene.add(this.hand);
    this.swing = 0;
    // the player's own model: third person, its shadow, and the bare arm in first person
    this.avatar = new Avatar(this);
    this.columns = new Map();
    this.frame = 0;
    this.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  }

  resize(w, h) {
    this.cw = w; this.ch = h;
    // drawn in the screen's own pixels (a sharp laptop screen has two or more to each CSS pixel)
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const s = this.opts.scale * dpr;
    const rw = Math.max(1, Math.round(w * s)), rh = Math.max(1, Math.round(h * s));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.U.uRes.value.set(rw, rh);
    this.rw = rw; this.rh = rh;
    if (this.ldr) {
      // drawn at the render scale and stretched by the browser: the cheapest upscale there is
      this.r.setSize(rw, rh, false);
      return;
    }
    this.r.setSize(Math.round(w * dpr), Math.round(h * dpr), false);
    if (this.main) this.main.dispose();
    this.main = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.main.depthTexture = new THREE.DepthTexture(rw, rh, THREE.FloatType);
    this.post.resize(rw, rh);
    this.U.uRes.value.set(rw, rh);
    this.U.uSceneColor.value = this.post.copyColor.texture;
    this.U.uSceneDepth.value = this.post.linDepth.texture;
    this.rw = rw; this.rh = rh;
  }

  /* ---- chunk meshes ----
     Meshes arriving from the workers are queued and put on the GPU a few a
     frame, so a burst of them never stalls one frame. */
  setColumn(cx, cz, mesh, urgent) {
    const k = cx + ',' + cz;
    this.uploads = this.uploads || new Map();
    // a block you just broke or placed: on the graphics card now, not in turn
    if (urgent) {
      this.uploads.delete(k);
      this.addColumn(cx, cz, mesh);
      this.r.resetState();
      this.visDirty = true;
      return;
    }
    this.uploads.set(k, [cx, cz, mesh]);
  }
  pumpUploads(budgetMs) {
    if (!this.uploads || !this.uploads.size) return;
    const t0 = performance.now();
    // nearest first
    const list = [...this.uploads.values()].sort((a, b) => ((a[0] - this.ccx) ** 2 + (a[1] - this.ccz) ** 2) - ((b[0] - this.ccx) ** 2 + (b[1] - this.ccz) ** 2));
    for (const [cx, cz, mesh] of list) {
      this.uploads.delete(cx + ',' + cz);
      this.addColumn(cx, cz, mesh);
      if (performance.now() - t0 > budgetMs) break;
    }
    // buffers and vertex arrays were bound behind three.js's back
    this.r.resetState();
    this.visDirty = true;
  }
  /* ---- chunk meshes, drawn in one loop ----
     A column's meshes are plain vertex arrays on the graphics card, each in
     its own vertex array object. Every kind (opaque, cut-out, plants, the
     inside of canopies, water, glass) is drawn in one tight loop from inside
     a stand-in mesh that three.js renders first, so the shader, its uniforms,
     textures, blending and depth test are already set: per chunk only its
     offset and one draw call. Hundreds of three.js meshes cost more in
     bookkeeping than in drawing (8 ms a frame on a slow laptop); this costs
     almost nothing. Opaque chunks go nearest first, so hidden pixels are
     never shaded; water and glass furthest first, so they blend right. */
  makeStandIns() {
    const g = new THREE.BufferGeometry();
    for (const nm of ['aPos', 'aA', 'aL', 'aF', 'aC']) g.setAttribute(nm, new THREE.BufferAttribute(nm === 'aPos' ? new Uint16Array(12) : nm === 'aF' ? new Int8Array(12) : new Uint8Array(12), 4));
    g.setIndex([0, 1, 2]);
    this.standGeo = g;
    this.locs = new Map();
    this.frustum = new THREE.Frustum(); this.fm = new THREE.Matrix4(); this.box = new THREE.Box3();
    const stand = (scene, material, kinds, order, shadow) => {
      if (!material) return;
      const m = new THREE.Mesh(g, material);
      m.frustumCulled = false; m.renderOrder = order; m.matrixAutoUpdate = false;
      m.onAfterRender = (r, sc, cam) => this.drawParts(material, kinds, cam, shadow);
      scene.add(m);
    };
    stand(this.scene, this.mats.opaque, ['opaque'], -10, false);
    stand(this.scene, this.mats.cutout, ['cutout', 'plants', 'leafIn'], -9, false);
    stand(this.trans, this.mats.fluid, ['fluid'], -10, false);
    stand(this.trans, this.mats.translucent, ['translucent'], -9, false);
    if (this.opts.shadows) {
      stand(this.shadowTerrain, this.mats.shadowOpaque, ['opaque'], -10, true);
      stand(this.shadowTerrain, this.mats.shadowCutout, ['cutout'].concat(this.opts.plantShadows === false ? [] : ['plants']).concat(this.opts.leafInShadows === false ? [] : ['leafIn']), -9, true);
    }
  }
  drawParts(material, kinds, cam, shadow) {
    const gl = this.gl;
    const prog = this.r.properties.get(material).currentProgram;
    if (!prog) return;
    const P = prog.program;
    let L = this.locs.get(P);
    if (!L) { L = { chunk: gl.getUniformLocation(P, 'uChunk'), meshTime: gl.getUniformLocation(P, 'uMeshTime') }; this.locs.set(P, L); }
    if (!L.chunk) return;
    // the shadow map is drawn a share of its columns at a time (render/shadows.js)
    const slice = shadow ? this.shadowSlice : null;
    const list = slice ? slice.list : this.inView(cam);
    const back = !!material.transparent, n = slice ? slice.to : list.length;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    for (let j = slice ? slice.from : 0; j < n; j++) {
      const col = list[back ? n - 1 - j : j];
      if (col.dead) continue;
      gl.uniform3f(L.chunk, col.cx * 16, 0, col.cz * 16);
      for (let k = 0; k < kinds.length; k++) {
        const p = col.byKind[kinds[k]];
        if (!p) continue;
        let from, to;
        if (shadow) { from = p.shadowFrom; to = p.count; }
        else { if (!p.visible || p.hidden) continue; from = p.from; to = p.to; }
        if (to <= from) continue;
        if (L.meshTime && p.t0 !== undefined) gl.uniform1f(L.meshTime, p.t0);
        gl.bindVertexArray(p.vao);
        gl.drawElements(gl.TRIANGLES, to - from, p.type, from * p.bytes);
      }
    }
    // back as three.js left it
    gl.uniform3f(L.chunk, 0, 0, 0);
    if (L.meshTime && material.uniforms.uMeshTime) gl.uniform1f(L.meshTime, material.uniforms.uMeshTime.value);
    gl.bindVertexArray(prevVao);
  }
  // the columns a camera can see this frame, nearest first (worked out once per camera per frame)
  inView(cam) {
    const C = this.cull || (this.cull = new Map());
    let e = C.get(cam);
    if (e && e.frame === this.frame) return e.list;
    if (!e) { e = { frame: -1, list: [] }; C.set(cam, e); }
    e.frame = this.frame;
    const list = e.list;
    list.length = 0;
    this.fm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.fm);
    const ex = cam.position.x, ez = cam.position.z, b = this.box;
    for (const col of this.columns.values()) {
      b.min.set(col.cx * 16, col.y0, col.cz * 16); b.max.set(col.cx * 16 + 16, col.y1, col.cz * 16 + 16);
      if (!this.frustum.intersectsBox(b)) continue;
      col.dist = (col.cx * 16 + 8 - ex) ** 2 + (col.cz * 16 + 8 - ez) ** 2;
      list.push(col);
    }
    list.sort((a, b) => a.dist - b.dist);
    return list;
  }
  addColumn(cx, cz, mesh) {
    this.shadows.changed(cx, cz);
    this.dropColumn(cx, cz);
    const gl = this.gl;
    const col = { cx, cz, vis: mesh.vis, skyLow: mesh.skyLow, parts: [], byKind: {}, y0: 1e9, y1: -1e9, dist: 0 };
    const add = (data, kind) => {
      if (!data || !data.index.length) return;
      // how tall the mesh is, for culling: from the first section with anything in it to the last
      const mk = data.marks;
      for (let sct = 0; sct < 24; sct++) if (mk[sct + 1] > mk[sct]) { col.y0 = Math.min(col.y0, sct * 16); col.y1 = Math.max(col.y1, sct * 16 + 17); }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const bufs = [];
      for (let i = 0; i < data.attrs.length; i++) {
        const a = data.attrs[i], buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 4, a instanceof Uint16Array ? gl.UNSIGNED_SHORT : a instanceof Int8Array ? gl.BYTE : gl.UNSIGNED_BYTE, false, 0, 0);
        bufs.push(buf);
      }
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.index, gl.STATIC_DRAW);
      bufs.push(ib);
      gl.bindVertexArray(null);
      const wide = data.index instanceof Uint32Array;
      const count = data.index.length;
      const p = {
        kind, vao, bufs, count, marks: data.marks, from: 0, to: count, visible: true, hidden: false,
        type: wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, bytes: wide ? 4 : 2,
        // the shadow pass needs nothing below where the sky reaches
        shadowFrom: data.marks[Math.max(0, Math.min(24, (mesh.skyLow >> 4) - 1))],
      };
      // each water mesh glides from the moment it arrived
      if (kind === 'fluid') p.t0 = this.U.uClock.value;
      col.parts.push(p);
      col.byKind[kind] = p;
    };
    add(mesh.opaque, 'opaque');
    add(mesh.cutout, 'cutout');
    // plants and the inside of canopies: their own meshes, so far columns can leave them out
    add(mesh.plants, 'plants');
    add(mesh.leafIn, 'leafIn');
    add(mesh.fluid, 'fluid');
    add(mesh.translucent, 'translucent');
    col.plants = col.byKind.plants || null;
    col.leafIn = col.byKind.leafIn || null;
    if (col.y0 > col.y1) { col.y0 = 0; col.y1 = 1; }
    this.columns.set(cx + ',' + cz, col);
    this.glDirty = true;
  }
  dropColumn(cx, cz) {
    const k = cx + ',' + cz;
    if (this.uploads) this.uploads.delete(k);
    const col = this.columns.get(k);
    if (!col) return;
    this.shadows.changed(cx, cz);
    const gl = this.gl;
    // a shadow map being built may still hold it in its list
    col.dead = true;
    for (const p of col.parts) { gl.deleteVertexArray(p.vao); for (const b of p.bufs) gl.deleteBuffer(b); }
    this.columns.delete(k);
    this.visDirty = true;
  }

  /* ---- cave culling ----
     A walk outward from the camera's section, through the faces each
     section's open space connects, never turning back towards the camera
     (Sodium's method). Each column then draws only the run of sections the
     walk reached; underground caves you cannot see are never drawn. Every
     step goes one section further from the camera, so walking in rings
     (first in, first out) reaches a section only after everything that can
     lead into it: each is visited once, with all the faces it was entered
     by already gathered. */
  updateVisibility(eye) {
    const csx = Math.floor(eye.x / 16), csz = Math.floor(eye.z / 16), csy = Math.max(0, Math.min(23, Math.floor(eye.y / 16)));
    const R = this.opts.renderDist + 1;
    const span = 2 * R + 1, cells = span * span * 24;
    // everything in flat typed arrays, kept from walk to walk: no strings, nothing for the collector
    const V = this.visBuf && this.visBuf.span === span ? this.visBuf : (this.visBuf = {
      span, done: new Uint8Array(cells), q: new Int32Array(cells + 1), cols: new Array(span * span),
      lo: new Int8Array(span * span), hi: new Int8Array(span * span),
    });
    const done = V.done, q = V.q, cols = V.cols, lo = V.lo, hi = V.hi;
    done.fill(0); lo.fill(127); hi.fill(-1); cols.fill(null);
    for (const col of this.columns.values()) {
      const ix = col.cx - csx + R, iz = col.cz - csz + R;
      if (ix >= 0 && iz >= 0 && ix < span && iz < span) cols[ix * span + iz] = col;
    }
    const OPP = [1, 0, 3, 2, 5, 4], DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];
    let head = 0, tail = 0;
    const start = ((R * span) + R) * 24 + csy;
    q[tail++] = start; done[start] = 63;
    while (head < tail) {
      const cell = q[head++], entries = done[cell];
      const y = cell % 24, ci = (cell - y) / 24, ix = (ci / span) | 0, iz = ci - ix * span;
      if (y < lo[ci]) lo[ci] = y;
      if (y > hi[ci]) hi[ci] = y;
      const col = cols[ci];
      // which faces can be left by, from the faces it was entered by
      let exits = 0;
      if (!col || !col.vis || cell === start) exits = 63;
      else { const vis = col.vis, o = y * 6; for (let f = 0; f < 6; f++) if (entries & (1 << f)) exits |= vis[o + f]; }
      for (let f = 0; f < 6; f++) {
        if (!(exits & (1 << f))) continue;
        const dx = DX[f], dy = DY[f], dz = DZ[f];
        // never back towards the camera
        if ((dx > 0 && ix < R) || (dx < 0 && ix > R) || (dy > 0 && y < csy) || (dy < 0 && y > csy) || (dz > 0 && iz < R) || (dz < 0 && iz > R)) continue;
        const nx = ix + dx, ny = y + dy, nz = iz + dz;
        if (ny < 0 || ny > 23 || nx < 0 || nz < 0 || nx >= span || nz >= span) continue;
        const kk = (nx * span + nz) * 24 + ny, ent = 1 << OPP[f];
        if (!done[kk]) q[tail++] = kk;
        done[kk] |= ent;
      }
    }
    for (const col of this.columns.values()) {
      const ix = col.cx - csx + R, iz = col.cz - csz + R;
      const ci = ix >= 0 && iz >= 0 && ix < span && iz < span ? ix * span + iz : -1;
      const reached = ci >= 0 && hi[ci] >= 0;
      for (const p of col.parts) {
        if (!reached) { p.visible = false; continue; }
        const from = p.marks[lo[ci]], to = p.marks[Math.min(24, hi[ci] + 1)];
        if (to <= from) { p.visible = false; continue; }
        p.visible = true; p.from = from; p.to = to;
      }
    }
    this.visKey = csx + ',' + csy + ',' + csz;
    this.visDirty = false;
  }

  /* ---- the held block ----
     The block's own shape (or the flat item picture for plants, doors,
     torches) in the terrain's own vertex format, so it takes the same light,
     shadow and fog. See blockmesh.js. */
  setHeld(id, BLOCKS) {
    this.hand.clear();
    const d = BLOCKS[id];
    // a torch, lantern or glowstone in your hand lights the world around you (faded in render())
    this.heldLight = d && d.light ? d.light : 0;
    if (!d || !d.faces) { this.handMesh = null; this.avatar.setHeld(null); return; }
    // the same boxes as the world draws (a held stair is a stair), or the item's flat picture
    const { geometry: g, flat, cutout } = blockGeometry(d, d.iconMeta || 0);
    const m = new THREE.Mesh(g, cutout ? this.mats.handCutout : this.mats.handOpaque);
    m.frustumCulled = false;
    // the shader's face frames turn with the hand
    const rot = new THREE.Matrix3();
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); this.U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { this.U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    this.handMesh = m;
    this.hand.add(m);
    this.heldFlat = flat;
    this.avatar.setHeld(m, flat);
    // glass and leaves keep their holes in the model's hand too
    if (cutout && this.avatar.held) this.avatar.held.material = this.mats.cutout;
  }
  placeHand(state, cam) {
    if (!this.handMesh) return;
    // where it sits: low and to the right, turned the way the game holds a block
    const s = this.swing;
    const sw = Math.sin(Math.min(1, s) * Math.PI);
    const bob = state.bob || { x: 0, y: 0 };
    this.hand.position.copy(cam.position);
    this.hand.quaternion.copy(cam.quaternion);
    const m = this.handMesh;
    m.position.set(0.56 + bob.x - sw * 0.18, -0.52 + bob.y - sw * 0.2 + Math.sin(Math.sqrt(Math.min(1, s)) * Math.PI * 2) * 0.05, -0.85 - sw * 0.25);
    m.rotation.set(this.heldFlat ? sw * -0.6 : 0.42 - sw * 0.6, this.heldFlat ? -0.5 : 0.785 + sw * 0.4, 0, 'YXZ');
    m.scale.setScalar(this.heldFlat ? 0.55 : 0.4);
    this.hand.updateMatrixWorld(true);
  }
  // first person only: the held block, or the bare arm when the hand is empty
  drawHand(state, cam, dt) {
    this.swing = Math.max(0, this.swing - dt * 3.2);
    if (state.showHand === false || this.avatar.view) return;
    if (this.handMesh) this.placeHand(state, cam);
    this.avatar.placeArm(state, cam, !this.handMesh);
    this.r.render(this.handScene, cam);
  }

  /* ---- shaders built before they are needed ----
     A shader is put together the first time something drawn with it comes
     into view: the water's when you first turn to the sea, glass, a mob's,
     the clouds'. Building one stops that frame for a tenth of a second or
     more (Detailed's are the bigger ones), which is felt as a hitch. So every
     material the world has (and any handed in, like the mobs') is built once
     the world is loaded, in the background where the browser can, before it
     is ever looked at. */
  warmUp(extra) {
    const r = this.r, cam = this.camera, more = new THREE.Scene();
    const mats = [this.mats.handOpaque, this.mats.handCutout].concat(extra || []);
    for (const m of mats) if (m) more.add(new THREE.Mesh(this.standGeo, m));
    const scenes = [this.scene, this.trans, this.handScene, this.shadowTerrain, this.shadowScene, more,
      this.blockClouds && this.blockClouds.scene, this.overlay && this.overlay.scene].filter(Boolean);
    if (this.vanilla) for (const o of [this.vanilla.skyFS, this.vanilla.cloudMesh]) if (o && o.scene) scenes.push(o.scene);
    for (const s of scenes) { try { r.compileAsync(s, cam).catch(() => {}); } catch (e) { /* drawn as before, built when first seen */ } }
  }

  /* ---- the light in your hand, and torch flicker ---- */
  updateLights(state, dt) {
    const U = this.U, t = U.uClock.value;
    // the held light fades in and out rather than snapping
    const want = this.heldLight || 0;
    this.heldNow = (this.heldNow || 0) + (want - (this.heldNow || 0)) * (1 - Math.exp(-dt * 7));
    if (this.heldNow < 0.05 && want === 0) this.heldNow = 0;
    U.uHeldLight.value = this.heldNow * (1 + 0.025 * Math.sin(t * 6.1) + 0.015 * Math.sin(t * 13.7 + 2.0));
    // at the player's right hand (state.handPos if the game knows better)
    if (state.handPos) U.uHeldPos.value.copy(state.handPos);
    else {
      const y = state.yaw || 0, s = Math.sin(y), c = Math.cos(y), f = state.feet;
      U.uHeldPos.value.set(f.x + c * 0.35 - s * 0.3, f.y + 1.2, f.z - s * 0.35 - c * 0.3);
    }
    // a slow, gentle flicker for every torch
    U.uFlicker.value = 1 + 0.03 * Math.sin(t * 2.3) + 0.02 * Math.sin(t * 5.3 + 1.3) + 0.012 * Math.sin(t * 11.9 + 0.4);
  }

  /* ---- a frame ---- */
  render(state, dt) {
    const U = this.U, r = this.r;
    // Detailed: what each texture is made of, once the textures are on the graphics card (materials.js)
    if (this.ldr && !this.vanilla && !this.layerMatDone) { this.layerMatDone = true; U.uLayerMat.value = bakeLayerMaterials(r, U.uSpecMap.value, U.uLayerInfo.value); }
    this.frame++;
    U.uFrame.value = this.frame;
    U.uTime.value = state.time;
    U.uClock.value = performance.now() / 1000;
    // where the sun and moon are
    const sun = state.sunDir, moon = state.moonDir;
    U.uSunDir.value.copy(sun); U.uMoonDir.value.copy(moon);
    const light = sun.y > -0.02 ? sun : moon;
    U.uLightDir.value.copy(light);
    U.uPlayer.value.copy(state.feet);
    U.uEyeInWater.value = state.eyeInWater ? 1 : 0;
    U.uSkyAtEye.value = state.skyAtEye;
    U.uMoonPhase.value = state.moonPhase;
    U.uRender.value = this.opts.renderDist * 16;
    if (state.waterTint) U.uWaterTint.value.copy(state.waterTint);
    const cam = this.camera;
    cam.position.copy(state.eye);
    // roll and tiltPitch: the tip of the view when hurt (survival.js viewTilt)
    cam.rotation.set(state.pitch + (state.tiltPitch || 0), state.yaw, state.roll || 0, 'YXZ');
    // the player's model posed for this frame (and, in third person, the camera pulled back)
    this.avatar.update(state, dt, cam);
    // hurt: the view tilts away from the hit (combat/combat.js)
    if (state.tilt) cam.quaternion.multiply(state.tilt);
    // the held block takes the light where you stand, as the model does
    if (this.uHandLight && this.avatar.uLight) this.uHandLight.value.copy(this.avatar.uLight.value);
    cam.fov = state.fov;
    // far enough for the clouds, which reach twice the render distance out at height 192
    cam.far = this.opts.renderDist * 32 + 128;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    U.uNear.value = cam.near; U.uFar.value = cam.far;
    // block pieces and the like, placed for this frame (render/particles.js)
    if (this.particles) this.particles.render(cam, state.alpha || 0);
    U.uCamPos.value.copy(cam.position);
    U.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.updateLights(state, dt);
    this.ccx = Math.floor(cam.position.x / 16); this.ccz = Math.floor(cam.position.z / 16);
    this.pumpUploads(this.opts.uploadMs || 4);
    const vk = Math.floor(cam.position.x / 16) + ',' + Math.max(0, Math.min(23, Math.floor(cam.position.y / 16))) + ',' + Math.floor(cam.position.z / 16);
    const now = performance.now();
    if (vk !== this.visKey || (this.visDirty && now - (this.visAt || 0) > 1000)) { this.updateVisibility(cam.position); this.visAt = now; }
    // grass and flowers stop where you could not make them out anyway
    const pd = (this.opts.plantDist || 96) / 16;
    // and the inside of a tree's canopy only near enough to see into
    const ld = (this.opts.leafInDist || 64) / 16;
    for (const col of this.columns.values()) {
      const d = Math.hypot(col.cx + 0.5 - cam.position.x / 16, col.cz + 0.5 - cam.position.z / 16);
      if (col.plants) col.plants.hidden = d >= pd;
      if (col.leafIn) col.leafIn.hidden = d >= ld;
    }

    // the sky table: every frame on the full tiers; on the light ones every few frames (it changes
    // slowly), a third of it a frame, and all at once when the sun has jumped (/time set, a night's sleep)
    // (nothing in the Nether or the End, which have no sky)
    if (this.sky && (this.frame < 3 || !(state.dim && state.dim.sky !== 'normal'))) {
      const n = this.opts.sky || 1, at = this.skySun || (this.skySun = new THREE.Vector3(0, -2, 0));
      if (n < 3 || this.frame < 3 || at.dot(sun) < 0.9997) { this.sky.update(sun, moon, state.eye.y); at.copy(sun); }
      else if (this.frame % n < 3) { this.sky.part(this.frame % n, sun, moon, state.eye.y); if (this.frame % n === 0) at.copy(sun); }
    }
    if (!this.vanilla) {
      this.inter.update(dt, state.feet, state.trample);
      U.uInteract.value = this.inter.texture;
    }

    // the shadow map, from whichever light is up (some tiers redraw it every other frame)
    if (!this.vanilla) dimLook(this, state, dt);
    const sunless = !!(state.dim && state.dim.sky !== 'normal');
    // the sun's shadow maps: kept, and built a share at a time when they must change (render/shadows.js)
    if (this.opts.shadows > 0 && !sunless) this.shadows.update(state, light, this.frame);
    else U.uBody.value.w = 0;
    U.uInvViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
    if (this.vanilla) {
      // the game with no shaders: sky, blocks, water, clouds, hand, straight to the screen
      this.vanilla.update(state, this.opts, dt);
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, false);
      this.vanilla.drawSky(r);
      r.render(this.scene, cam);
      if (this.overlay) this.overlay.render(r, cam);
      r.render(this.trans, cam);
      this.vanilla.drawClouds(r, cam, state.time);
      this.drawHand(state, cam, dt);
      return;
    }
    if (this.ldr) {
      // the exposure: under the sky the sky table works it out from the light there is (glsl.js EXPOSURE);
      // in a cave or under a roof the eye eases over to one level, whatever the time of day;
      // the Nether and the End have no sky and keep one level each (about where the eye used to settle there)
      const cave = !sunless && state.skyAtEye < 1 ? 1 : 0;
      this.caveNow = this.caveNow === undefined ? cave : this.caveNow + (cave - this.caveNow) * Math.min(1, dt * 1.5);
      U.uCave.value = this.caveNow < 0.002 ? 0 : this.caveNow;
      U.uExposure.value = sunless ? (state.dim.id === 'the_end' ? 2.0 : 4.2) : 2.4;
      this.sky.setUniforms(U, cam.position.y);
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, false);
      // the sky is the scene's last solid thing (see the constructor)
      r.render(this.scene, cam);
      if (this.overlay) this.overlay.render(r, cam);
      r.render(this.trans, cam);
      // the clouds, as Fast draws them (none where the dimension has none, or with Clouds off)
      const clouds = state.dim && !state.dim.clouds ? 'off' : this.opts.clouds || 'fancy';
      if (this.blockClouds && clouds !== 'off' && !state.eyeInWater) this.blockClouds.draw(r, cam, state.time, clouds, U.uRender.value * 2);
      this.drawHand(state, cam, dt);
      return;
    }

    // the world
    r.setRenderTarget(this.main);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    if (this.overlay) this.overlay.render(r, cam);
    this.post.copies(this.main);
    r.setRenderTarget(this.main);
    r.render(this.trans, cam);
    // the hand, over everything, never inside a wall
    this.drawHand(state, cam, dt);
    // and all that comes after
    this.post.frame(this.main, cam, dt);
  }
}
