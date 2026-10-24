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
import { Realism } from './realism.js?v=107';
import { Interaction } from './interaction.js?v=107';
import { makeLayerInfo, bakeLayerMaterials } from './materials.js?v=107';
import { makeNoise2D } from './noisetex.js?v=107';
import { Avatar } from './avatar.js?v=107';
import { Held } from './held.js?v=107';
import { Figure } from './figure.js?v=107';
import { PumpkinView } from './pumpkin.js?v=107';
import { glints, pieceLook } from './armor.js?v=107';
import { dimLook } from '../dim/look.js?v=107';
import { blockGeometry, intAttribute } from './blockmesh.js?v=107';
import { applyLook, looked, passMaterials } from './looks.js?v=107';
import { screenFx } from './screenfx.js?v=107';
import { endFlash } from './endflash.js?v=107';
const THREE = window.THREE;
// a column's distance from (ex, ez), squared, in whole blocks; and nearest first
const distTo = (col, ex, ez) => { const dx = col.cx * 16 + 8 - ex, dz = col.cz * 16 + 8 - ez; return (dx * dx + dz * dz) | 0; };
const byDist = (a, b) => a.dist - b.dist;
// what a column's mesh puts on the graphics card, in bytes
const MESH_KINDS = ['opaque', 'cutout', 'plants', 'leafIn', 'fluid', 'translucent'];
function meshBytes(mesh) {
  let n = 0;
  for (let k = 0; k < MESH_KINDS.length; k++) {
    const d = mesh[MESH_KINDS[k]];
    if (!d) continue;
    for (let i = 0; i < d.attrs.length; i++) n += d.attrs[i].byteLength;
  }
  return n;
}
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
    // (a stencil buffer asked for so the depth buffer comes as 24 bits with it: some machines give a lone depth buffer 16 bits, and a
    // carpet or a painting a sixteenth off what is behind it flickered through it there)
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: true, depth: true });
    r.setPixelRatio(1);
    r.autoClear = false;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    if (!r.capabilities.isWebGL2) throw new Error('WebGL2 is needed');
    r.getContext().getExtension('EXT_color_buffer_float');
    // asked now, while the card has nothing to do (three.js keeps it): asked first after the shaders were sent to be built,
    // it waited for all of them, a fifth of a second at every page open (Video Settings' filtering, render/looks.js)
    r.capabilities.getMaxAnisotropy();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
    this.scene = new THREE.Scene();          // opaque and cutout
    this.trans = new THREE.Scene();          // fluids and translucent
    this.shadowScene = new THREE.Scene();    // what moves: your own body (render/avatar.js)
    this.shadowTerrain = new THREE.Scene();  // the world's blocks, drawn into their own map and kept
    this.shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 400);
    this.textures = textures;
    // the atmosphere tables, the shadow maps and the rest are made by the look (render/looks.js)
    this.sky = null; this.shadows = null;
    this.inter = new Interaction(r, this.opts.interSize || 128);
    const sr = 4;
    // the textures
    this.U = {
      uTime: { value: 0 }, uFrame: { value: 0 },
      uAlbedo: { value: textures.albedo }, uNormalMap: { value: textures.normal }, uSpecMap: { value: textures.spec },
      uLayerInfo: { value: makeLayerInfo(textures.manifest) }, uLayerMat: { value: blankTexture() },
      uAmbient: { value: this.sky ? this.sky.amb.texture : null }, uView: { value: this.sky ? this.sky.view.texture : null }, uTrans: { value: this.sky ? this.sky.trans.texture : null },
      uNoise: { value: makeNoise2D() }, uNoise3: { value: null },
      uShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowRes: { value: sr },
      // your own body's small shadow map, and how to find it from the blocks' one (render/shadows.js)
      uBodyShadow: { value: null }, uBodyMat: { value: new THREE.Matrix4() }, uBody: { value: new THREE.Vector4() },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uInteract: { value: this.inter.texture }, uInteractRect: { value: this.inter.rect }, uPlayer: { value: new THREE.Vector3() },
      uWet: { value: 0 }, uSceneColor: { value: null }, uSceneDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uEyeInWater: { value: 0 }, uNear: { value: 0.05 }, uFar: { value: 1000 }, uProjInv: { value: new THREE.Matrix4() },
      uRender: { value: 160 }, uMoon: { value: textures.moon }, uMoonPhase: { value: 0 }, uSkyAtEye: { value: 1 },
      uWaterTint: { value: new THREE.Vector3(0.05, 0.18, 0.78) }, uCover: { value: 0.42 }, uCamPos: { value: new THREE.Vector3() },
      uClock: { value: 0 }, uFaceRot: { value: new THREE.Matrix3() }, uExposure: { value: 1 }, uCave: { value: 0 }, uInvViewProj: { value: new THREE.Matrix4() },
      // the light in your hand (level, faded in and out) and where it is; torches' flicker; how dark cloud shadows are
      uHeldLight: { value: 0 }, uHeldPos: { value: new THREE.Vector3() }, uFlicker: { value: 1 }, uCloudShadow: { value: this.opts.cloudShadow > 0 ? 0.33 : 0 },
      // where a chunk mesh sits (set per draw by drawParts; 0 for everything three.js draws itself)
      uChunk: { value: new THREE.Vector3() },
      // the dimension being drawn (js/dims.js; js/dim/look.js sets these each frame)
      uDim: { value: 0 }, uDimAmb: { value: new THREE.Vector3() }, uDimFog: { value: new THREE.Vector3() }, uDimFogRange: { value: new THREE.Vector2(0, 1) },
      uEndSky: { value: textures.endSky || null },
      // the End's flashes (render/endflash.js): where the source is in the sky, and how strong its light is
      uEndFlash: { value: new THREE.Vector4() },
      // the void's dark (glsl.js VOID): under the horizon below sea level, and all of it near the world's floor
      uVoid: { value: new THREE.Vector3(0, 0, 160) },
      // Detailed's per-vertex light, from the light table each frame (sky.js setUniforms), and the fog's colours
      uAmbUp: { value: new THREE.Vector3() }, uAmbSide: { value: new THREE.Vector3() }, uAmbDown: { value: new THREE.Vector3() },
      uSunC: { value: new THREE.Vector3() }, uDayK: { value: 0 }, uExpo: { value: 1 }, uFogK: { value: 0.0019 },
      uFogTab: { value: null }, uShadowInv: { value: new THREE.Matrix4() },
      // Detailed's tone curve as a table (glsl.js TONE_LUT)
      uToneLut: { value: null },
      // the Shader Options that are only numbers (render/looks.js): the shadows' softness, how much
      // plants and leaves wave, the corners' shade, the fog's thickness; a chunk fading in (Chunk Fade);
      // where the clouds melt into the sky (Cloud Distance)
      uShadowSoft: { value: 1.6 }, uWave: { value: new THREE.Vector2(1, 1) }, uAO: { value: 1 }, uFogMul: { value: 1 },
      // where you stand in the shadow map, its reach and its texel's size (render/shadows.js tellEye)
      uShadowEye: { value: new THREE.Vector4(0, 0, 1, 0.07) },
      // the view a shadow map is being drawn from (render/shadows.js: the shaders read the last one's until it is done)
      uShadowDraw: { value: new THREE.Matrix4() },
      // the full chain's eye, a 1 x 1 picture (render/post.js; lava in water.js reads it)
      uExpoTex: { value: null },
      uChunkFade: { value: 1 }, uCloudFade: { value: new THREE.Vector2(256, 512) },
      // the enchantment glint's speed and strength (Accessibility Settings; render/armor.js GLINT)
      uGlint: { value: new THREE.Vector2(0.5, 0.75) },
      // Brightness (Video Settings) less its default, for the shader look (glsl.js lightFloor)
      uBrightD: { value: (this.opts.brightness === undefined ? 0.5 : this.opts.brightness) - 0.5 },
      // Night Vision's strength, 0..1 (glsl.js lightFloor; Off's lightmap takes it itself: vanilla.js)
      uNightVision: { value: 0 },
      // Fullbright's light, 0 when off (glsl.js fullbrightFill; dim/look.js sets it; Off's lightmap takes its own: vanilla.js)
      uFullbright: { value: 0 },
      // Blindness and Darkness's black fog: start, end, strength (glsl.js LDR, post.js; vanilla.js shutFog)
      uShut: { value: new THREE.Vector3(0, 1, 0) },
      // the still and flowing water textures (the Shader Options' vanilla water, and Shaders OFF)
      uFlowLayers: { value: new THREE.Vector2(textures.manifest.textures.water_flow ? textures.manifest.textures.water_flow.layer : 0, textures.manifest.textures.lava_flow ? textures.manifest.textures.lava_flow.layer : 0) },
    };
    this.gl = r.getContext();
    // RIP Computer's realism: walkers parting the plants, Photon's wind, wet ground, explosions' flash and pieces (realism.js)
    this.real = new Realism(this);
    /* Everything that depends on the look: Shaders OFF (the game's own, vanilla.js), or
       the shader's light pipeline (the sky in one pass first, as the scene's last solid
       thing, so most of the screen never runs it; the game's blocks of cloud after the
       world) or its full chain after the world (post.js). render/looks.js. */
    applyLook(this, this.opts, true);
    // the block in your hand: drawn in the world just in front of the eye
    this.handScene = new THREE.Scene();
    this.hand = new THREE.Group();
    this.handScene.add(this.hand);
    this.swing = 0;
    // the player's own model: third person, its shadow, its armour, and the arms in first person
    this.avatar = new Avatar(this);
    // what is in your hands in first person (held.js); main.js sets this.wearer = { inv, cooldown }
    this.held = new Held(this);
    // you in the inventory screen (figure.js): main.js gives it to the inventory as drawPlayer
    this.figure = new Figure(this);
    this.wearer = null;
    // the view out of a carved pumpkin worn on the head (pumpkin.js)
    this.pumpkin = new PumpkinView(this.r.domElement);
    this.columns = new Map();
    this.order = [];          // the same, nearest the camera first (inView)
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
    // the canvas only given a size that is new: any size given to it, even its own, throws its picture away (a frame's stall)
    const size = (cw, ch) => { const c = this.r.domElement; if (c.width !== cw || c.height !== ch) this.r.setSize(cw, ch, false); };
    if (this.ldr) {
      // drawn at the render scale and stretched by the browser: the cheapest upscale there is
      size(rw, rh);
      // (the full chain's pictures let go, if a look before this one had them)
      if (this.main) { this.main.depthTexture.dispose(); this.main.dispose(); this.main = null; }
      if (this._post) this._post.release();
      return;
    }
    size(Math.round(w * dpr), Math.round(h * dpr));
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
    /* Nearest first: picked one at a time (a few a frame), not the whole line
       copied and sorted each frame. And no more than about three megabytes a
       frame: handing the data over is quick here, but the graphics process
       copies it after, and a burst of columns arriving together cost the next
       frame there instead. */
    let bytes = 0;
    while (this.uploads.size) {
      let best = null, bd = Infinity;
      for (const e of this.uploads.values()) { const d = (e[0] - this.ccx) * (e[0] - this.ccx) + (e[1] - this.ccz) * (e[1] - this.ccz); if (d < bd) { bd = d; best = e; } }
      // (before the first frame the camera's chunk is not known, as when a world is loaded straight after the page,
      // with no title screen drawn first: then any order will do; it had stopped the loading for good)
      if (!best) best = this.uploads.values().next().value;
      const size = meshBytes(best[2]);
      if (bytes > 0 && bytes + size > (this.opts.uploadBytes || 3e6)) break;
      bytes += size;
      this.uploads.delete(best[0] + ',' + best[1]);
      this.addColumn(best[0], best[1], best[2]);
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
    let g = this.standGeo;
    if (!g) {
      g = new THREE.BufferGeometry();
      for (const nm of ['aPos', 'aA', 'aL', 'aF', 'aC']) g.setAttribute(nm, intAttribute(nm === 'aPos' ? new Uint16Array(12) : nm === 'aF' ? new Int8Array(12) : new Uint8Array(12)));
      g.setIndex([0, 1, 2]);
      this.standGeo = g;
    }
    this.locs = new Map();
    this.frustum = new THREE.Frustum(); this.fm = new THREE.Matrix4(); this.box = new THREE.Box3();
    // (made again by a new look: render/looks.js)
    this.stands = this.stands || [];
    const stand = (scene, material, kinds, order, shadow, band) => {
      if (!material) return;
      const m = new THREE.Mesh(g, material);
      m.frustumCulled = false; m.renderOrder = order; m.matrixAutoUpdate = false;
      m.onAfterRender = (r, sc, cam) => this.drawParts(material, kinds, cam, shadow, band || 0);
      scene.add(m);
      this.stands.push(m);
      return m;
    };
    stand(this.scene, this.mats.opaque, ['opaque'], -10, false);
    /* Cut-out blocks near you: their depth first, then lit only where they are in
       front (materials.js cutoutDepthPass). Further out a tree is small on the
       screen, so its hidden layers cost less than drawing it twice: there they
       are drawn once, as before. */
    const cut = ['cutout', 'plants', 'leafIn'];
    this.cutoutNearDist = this.opts.cutoutNear === undefined ? 40 : this.opts.cutoutNear;
    if (this.mats.cutoutDepth && this.mats.cutoutNear) {
      this.cutoutDepthMesh = stand(this.scene, this.mats.cutoutDepth, cut, -9.6, false, 1);
      this.cutoutNearMesh = stand(this.scene, this.mats.cutoutNear, cut, -9.5, false, 1);
      stand(this.scene, this.mats.cutout, cut, -9, false, 2);
    } else stand(this.scene, this.mats.cutout, cut, -9, false);
    stand(this.trans, this.mats.fluid, ['fluid'], -10, false);
    stand(this.trans, this.mats.translucent, ['translucent'], -9, false);
    if (this.opts.shadows) {
      stand(this.shadowTerrain, this.mats.shadowOpaque, ['opaque'], -10, true);
      stand(this.shadowTerrain, this.mats.shadowCutout, ['cutout'].concat(this.opts.plantShadows === false ? [] : ['plants']).concat(this.opts.leafInShadows === false ? [] : ['leafIn']), -9, true);
    }
  }
  // band: 0 every column, 1 only those within cutoutNearDist of the camera, 2 only those beyond
  drawParts(material, kinds, cam, shadow, band) {
    const gl = this.gl;
    const prog = this.r.properties.get(material).currentProgram;
    if (!prog) return;
    const P = prog.program;
    let L = this.locs.get(P);
    if (!L) { L = { chunk: gl.getUniformLocation(P, 'uChunk'), meshTime: gl.getUniformLocation(P, 'uMeshTime'), fade: gl.getUniformLocation(P, 'uChunkFade') }; this.locs.set(P, L); }
    if (!L.chunk) return;
    // Chunk Fade (Video Settings): a column fades in over its first moments on screen
    const fadeFor = shadow || !L.fade || !(this.opts.chunkFade > 0) ? 0 : this.opts.chunkFade * 1000, now = this.fadeNow;
    let faded = false;
    // the shadow map is drawn a share of its columns at a time (render/shadows.js)
    const slice = shadow ? this.shadowSlice : null;
    const list = slice ? slice.list : this.inView(cam);
    const back = !!material.transparent, n = slice ? slice.to : list.length;
    const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const nd = this.cutoutNearDist * this.cutoutNearDist;
    for (let j = slice ? slice.from : 0; j < n; j++) {
      const col = list[back ? n - 1 - j : j];
      if (col.dead) continue;
      if (band && ((col.viewCam === cam && col.dist <= nd) !== (band === 1))) continue;
      if (fadeFor) {
        const f = Math.min(1, (now - col.born) / fadeFor);
        if (f < 1 || faded) { gl.uniform1f(L.fade, f); faded = f < 1; }
      }
      // the sections this camera can see (inView), if it was the last to look at this column
      const v0 = !shadow && col.viewCam === cam ? col.view0 : 0, v1 = !shadow && col.viewCam === cam ? col.view1 + 1 : 24;
      let set = false;
      for (let k = 0; k < kinds.length; k++) {
        const p = col.byKind[kinds[k]];
        if (!p) continue;
        let from, to;
        if (shadow) { from = p.shadowFrom; to = p.count; }
        else {
          if (!p.visible || p.hidden) continue;
          from = p.from; to = p.to;
          const a = p.marks[v0], z = p.marks[v1];
          if (a > from) from = a;
          if (z < to) to = z;
        }
        if (to <= from) continue;
        if (!set) { gl.uniform3f(L.chunk, col.cx * 16, 0, col.cz * 16); set = true; }
        if (L.meshTime && p.t0 !== undefined) gl.uniform1f(L.meshTime, p.t0);
        gl.bindVertexArray(p.vao);
        gl.drawElements(gl.TRIANGLES, to - from, p.type, from * p.bytes);
      }
    }
    // back as three.js left it
    gl.uniform3f(L.chunk, 0, 0, 0);
    if (faded) gl.uniform1f(L.fade, 1);
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
    const ex = cam.position.x, ez = cam.position.z, b = this.box, F = this.frustum;
    const cut = !this.noSectionCull;
    /* The view's own camera goes through every column in the order kept for
       it (nearest first, put right here each frame: from one frame to the next
       it hardly changes, so that is a pass or two over the list, where sorting
       afresh made a few thousand comparisons and as much garbage), and decides
       on the way whether its grass and canopy insides are near enough to draw.
       Any other camera (the sun's, for its map) sorts what it sees. */
    const main = cam === this.camera, order = main ? this.sortOrder(ex, ez) : this.order;
    for (let i = 0; i < order.length; i++) {
      const col = order[i];
      if (col.dead) continue;
      b.min.set(col.cx * 16, col.y0, col.cz * 16); b.max.set(col.cx * 16 + 16, col.y1, col.cz * 16 + 16);
      if (!F.intersectsBox(b)) continue;
      if (!main) col.dist = distTo(col, ex, ez);
      list.push(col);
      /* and only the run of its sections the camera can see: a column near you is
         mostly above or below the view (the ground under your feet, the caves
         beneath, the sky over a tree), and every vertex there would be worked out
         and then thrown away. A section's box is a block bigger each way, for what
         pokes out of it (plants in the wind). drawParts reads these for this camera. */
      let s0 = col.y0 >> 4, s1 = Math.min(23, (col.y1 - 1) >> 4);
      if (cut) {
        while (s0 < s1) { b.min.y = s0 * 16 - 1; b.max.y = s0 * 16 + 17; if (F.intersectsBox(b)) break; s0++; }
        while (s1 > s0) { b.min.y = s1 * 16 - 1; b.max.y = s1 * 16 + 17; if (F.intersectsBox(b)) break; s1--; }
      }
      col.viewCam = cam; col.view0 = s0; col.view1 = s1;
    }
    if (!main) list.sort(byDist);
    return list;
  }
  /* The columns nearest first from (ex, ez), every one's distance (squared,
     in whole blocks) worked out, the dropped ones taken out; and whether its
     plants and the inside of its canopies are drawn: grass and flowers stop
     where you could not make them out anyway, a canopy's inside further in. */
  sortOrder(ex, ez) {
    const o = this.order, pd = this.opts.plantDist || 96, ld = this.opts.leafInDist || 64, pd2 = pd * pd, ld2 = ld * ld;
    let j = 0;
    for (let i = 0; i < o.length; i++) {
      const col = o[i];
      if (col.dead) continue;
      const d = distTo(col, ex, ez);
      col.dist = d;
      if (col.plants) col.plants.hidden = d >= pd2;
      if (col.leafIn) col.leafIn.hidden = d >= ld2;
      // straight into its place among those before it (almost always where it already is)
      let k = j;
      while (k > 0 && o[k - 1].dist > d) { o[k] = o[k - 1]; k--; }
      o[k] = col;
      j++;
    }
    o.length = j;
    return o;
  }
  addColumn(cx, cz, mesh) {
    this.shadows.changed(cx, cz);
    // when it first came into the world (a new mesh of the same column keeps it): Chunk Fade
    const was = this.columns.get(cx + ',' + cz);
    this.dropColumn(cx, cz);
    const gl = this.gl;
    const col = { cx, cz, vis: mesh.vis, skyLow: mesh.skyLow, parts: [], byKind: {}, y0: 1e9, y1: -1e9, dist: 0, born: was ? was.born : (this.fadeNow || 0) };
    const add = (data, kind) => {
      if (!data || !data.count) return;
      // how tall the mesh is, for culling: from the first section with anything in it to the last
      const mk = data.marks;
      for (let sct = 0; sct < 24; sct++) if (mk[sct + 1] > mk[sct]) { col.y0 = Math.min(col.y0, sct * 16); col.y1 = Math.max(col.y1, sct * 16 + 17); }
      const qi = this.quadIndex(data.count);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const bufs = [];
      for (let i = 0; i < data.attrs.length; i++) {
        const a = data.attrs[i], buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(i);
        // read as integers (uvec4 / ivec4 in the shaders): fed to a float input, ANGLE on Direct3D 11 would build every
        // shader a second time at its first draw (a third of a second or more each, the hang after a change of look)
        gl.vertexAttribIPointer(i, 4, a instanceof Uint16Array ? gl.UNSIGNED_SHORT : a instanceof Int8Array ? gl.BYTE : gl.UNSIGNED_BYTE, 0, 0);
        bufs.push(buf);
      }
      // the indices every mesh shares (quadIndex), never let go with the column
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, qi.buf);
      gl.bindVertexArray(null);
      const count = data.count * 1.5;
      const p = {
        kind, vao, bufs, count, marks: data.marks, from: 0, to: count, visible: true, hidden: false,
        type: qi.type, bytes: qi.bytes,
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
    // in the near-first order where the column it replaces was (a new one goes in from the end)
    const at = was ? this.order.indexOf(was) : -1;
    if (at >= 0) { col.dist = was.dist; this.order[at] = col; }
    else this.order.push(col);
    this.glDirty = true;
  }
  /* The one list of indices every chunk mesh is drawn with (mesher.js Buf:
     each face four vertices, its triangles 0 1 2 and 0 2 3), long enough for
     a mesh of this many vertices: 16-bit while that will do (most of them),
     32-bit past it, made longer when a bigger mesh comes (the meshes made
     before keep the shorter one, which is long enough for them). */
  quadIndex(verts) {
    const gl = this.gl, wide = verts > 65536, Q = this.quads || (this.quads = {});
    let e = wide ? Q.wide : Q.narrow;
    if (e && e.verts >= verts) return e;
    const n = wide ? Math.max(verts, e ? e.verts * 2 : 1 << 18) : 65536, quads = n >> 2;
    const a = wide ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    for (let q = 0, i = 0; q < quads; q++) { const v = q * 4; a[i++] = v; a[i++] = v + 1; a[i++] = v + 2; a[i++] = v; a[i++] = v + 2; a[i++] = v + 3; }
    gl.bindVertexArray(null);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, a, gl.STATIC_DRAW);
    e = { buf, verts: n, type: wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, bytes: wide ? 4 : 2 };
    if (wide) Q.wide = e; else Q.narrow = e;
    return e;
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
    let head = 0, tail = 0;
    const start = ((R * span) + R) * 24 + csy, sx = span * 24, last = span - 1;
    q[tail++] = start; done[start] = 63;
    /* Under the world (falling into the void) the camera is in no section: the
       walk starts from the bottom of every column at once, as if come in from
       below, so the underside of the world is drawn (from the bottom section
       under you alone, only it and its four neighbours were). */
    if (eye.y < 0) for (let ci = 0; ci < span * span; ci++) { const c = ci * 24; if (c !== start) { q[tail++] = c; done[c] = 8; } }
    /* The six ways out written out one by one (faces 0 to 5: +x, -x, +y, -y, +z,
       -z; a cell entered by face f is marked with the opposite one's bit): this
       runs on every section you cross, over every section in range, and the
       loop over a table of directions took most of a millisecond. */
    while (head < tail) {
      const cell = q[head++], entries = done[cell];
      const ci = (cell / 24) | 0, y = cell - ci * 24, ix = (ci / span) | 0, iz = ci - ix * span;
      if (y < lo[ci]) lo[ci] = y;
      if (y > hi[ci]) hi[ci] = y;
      const col = cols[ci];
      // which faces can be left by, from the faces it was entered by
      let exits;
      if (col === null || !col.vis || cell === start) exits = 63;
      else {
        const vis = col.vis, o = y * 6;
        exits = 0;
        if (entries & 1) exits |= vis[o];
        if (entries & 2) exits |= vis[o + 1];
        if (entries & 4) exits |= vis[o + 2];
        if (entries & 8) exits |= vis[o + 3];
        if (entries & 16) exits |= vis[o + 4];
        if (entries & 32) exits |= vis[o + 5];
      }
      // never back towards the camera, never out of range
      let k;
      if ((exits & 1) && ix >= R && ix < last) { k = cell + sx; if (!done[k]) q[tail++] = k; done[k] |= 2; }
      if ((exits & 2) && ix <= R && ix > 0) { k = cell - sx; if (!done[k]) q[tail++] = k; done[k] |= 1; }
      if ((exits & 4) && y >= csy && y < 23) { k = cell + 1; if (!done[k]) q[tail++] = k; done[k] |= 8; }
      if ((exits & 8) && y <= csy && y > 0) { k = cell - 1; if (!done[k]) q[tail++] = k; done[k] |= 4; }
      if ((exits & 16) && iz >= R && iz < last) { k = cell + 24; if (!done[k]) q[tail++] = k; done[k] |= 32; }
      if ((exits & 32) && iz <= R && iz > 0) { k = cell - 24; if (!done[k]) q[tail++] = k; done[k] |= 16; }
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
    this.visKey = csx + ',' + (eye.y < 0 ? -1 : csy) + ',' + csz;
    this.visDirty = false;
  }

  /* ---- what is in your hands ----
     The block's own shape (or the flat item picture for tools, plants,
     doors, torches) in the terrain's own vertex format, so it takes the same
     light, shadow and fog; held by your arm in first person (held.js) and by
     the model's hand in third person (avatar.js). */
  /* Every shader the world, the hand and the player's model are drawn with,
     compiled now (behind the loading screen) rather than in the frame that
     first needs one: three.js builds a program the first time a material is
     drawn, and that frame stalled for a tenth of a second or more (the first
     F5, the first block in your hand, the first break). */
  precompile() {
    const r = this.r, cam = this.camera;
    const extra = new THREE.Scene();
    for (const k in this.mats) { const m = this.mats[k]; if (m && m.isMaterial) extra.add(new THREE.Mesh(this.standGeo, m)); }
    try {
      r.setRenderTarget(this.vanilla || this.ldr ? null : this.main);
      for (const s of [this.scene, this.trans, this.handScene, extra]) r.compile(s, cam);
      // (your body's shadow, into its own map as render/shadows.js draws it)
      if (this.opts.shadows && this.shadows) { r.setRenderTarget(this.shadows.body); r.compile(this.shadowScene, this.shadowCam); }
    } catch (e) { console.warn('precompile', e); }
    r.setRenderTarget(null);
  }
  setHeld(id, DRAW) {
    const d = DRAW[id];
    // a torch, lantern or glowstone in your hand lights the world around you (faded in render())
    this.heldLight = d && d.light ? d.light : 0;
    this.held.set(0, id, DRAW);
    this.avatar.setHeld(0, d);
    this.drawTable = DRAW;
  }
  /* the off hand and the armour, read from the inventory main.js gave us
     (this.wearer): cheap enough to look at every frame, and nothing is
     missed whatever changed them */
  checkWorn() {
    const inv = this.wearer && this.wearer.inv, DRAW = this.drawTable;
    if (!inv || !DRAW) return;
    const off = inv.offhand ? inv.offhand.id : 0;
    if (off !== this.offId) { this.offId = off; this.held.set(1, off, DRAW); this.avatar.setHeld(1, DRAW[off]); }
    // enchanted things shimmer, in either hand
    const gm = glints(inv.slots[inv.selected]), go = glints(inv.offhand);
    this.held.glint(0, gm); this.held.glint(1, go); this.avatar.glintHeld(0, gm); this.avatar.glintHeld(1, go);
    // a loaded crossbow shows what it is loaded with
    const load = s => s && s.charged && s.charged.length ? (s.charged[0][0] === 'firework_rocket' ? 'rocket' : 'arrow') : null;
    this.held.loaded(0, load(inv.slots[inv.selected])); this.held.loaded(1, load(inv.offhand));
    // per piece: the stack, its id, enchanted or not, its dye
    const W = this.worn || (this.worn = [null, null, null, null, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    let changed = false;
    for (let i = 0; i < 4; i++) {
      const s = inv.armor[i], id = s ? s.id : 0, en = (s && s.ench ? 1 : 0) | (s && s.trim ? 2 : 0), col = s && typeof s.color === 'number' ? s.color : -1;
      if (W[i] !== s || W[i + 4] !== id || W[i + 8] !== en || W[i + 12] !== col) { W[i] = s; W[i + 4] = id; W[i + 8] = en; W[i + 12] = col; changed = true; }
    }
    if (changed) this.avatar.setArmor(inv.armor);
    // a block worn on the head that is not armour (a carved pumpkin, a mob head): the block itself
    const hid = W[4];
    if (hid !== this.headId) {
      this.headId = hid;
      const d = hid && !pieceLook(inv.armor[0]) ? DRAW[hid] : null;
      this.avatar.setHeadItem(d);
      this.headPumpkin = !!d && d.name === 'carved_pumpkin';
    }
  }
  // first person only: your arm, and whatever it holds (held.js)
  drawHand(state, cam, dt) {
    this.swing = Math.max(0, this.swing - dt * 3.2);
    this.pumpkin.show(this.headPumpkin && state.showHand !== false && !this.avatar.view);
    if (state.showHand === false || this.avatar.view) return;
    this.held.draw(state, cam, dt);
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
    // (kept, for when a new look needs them all built again: render/looks.js)
    if (extra) this.warmExtra = extra;
    const r = this.r, cam = this.camera, more = new THREE.Scene();
    // (with the look's full-screen passes: render/looks.js passMaterials)
    const mats = [this.mats.handOpaque, this.mats.handCutout].concat(extra || [], passMaterials(this));
    for (const m of mats) if (m) more.add(new THREE.Mesh(this.standGeo, m));
    const scenes = [this.scene, this.trans, this.handScene, this.shadowTerrain, this.shadowScene, more,
      this.vanilla ? null : this.ldr ? this.blockClouds && this.blockClouds.scene : this.blockCloudsHDR && this.blockCloudsHDR.scene,
      this.overlay && this.overlay.scene].filter(Boolean);
    if (this.vanilla) for (const o of [this.vanilla.skyFS, this.vanilla.cloudMesh]) if (o && o.scene) scenes.push(o.scene);
    // resolves once they are all built (or could not be), for whoever wants to wait for that
    return Promise.all(scenes.map(s => { try { return r.compileAsync(s, cam).catch(() => {}); } catch (e) { return null; /* drawn as before, built when first seen */ } }));
  }

  // the rain and snow, on their own (Improved Transparency: before the water as well as after it)
  drawFx(cam) {
    if (!this.fxMeshes) return;
    for (const m of this.fxMeshes) if (m.visible && m.parent && (!m.geometry.drawRange || m.geometry.drawRange.count > 0)) this.r.render(m, cam);
  }

  /* ---- the look: Shaders ON or OFF and the shader's settings (render/looks.js) ---- */
  setLook(look) { return applyLook(this, look, false); }
  // a material that is made again for each look: make(opts) -> material
  looked(make) { return looked(this, make); }
  // fn(opts, rebuilt) after every change of look
  onLook(fn) { (this.lookFns || (this.lookFns = [])).push(fn); }
  // a material's own uniforms, with any of the shared ones a later look added (the Fast look's lightmap and fog)
  withU(uniforms) { for (const k in this.U) if (!(k in uniforms)) uniforms[k] = this.U[k]; return uniforms; }

  /* ---- the light in your hand, and torch flicker ---- */
  updateLights(state, dt) {
    const U = this.U, t = U.uClock.value;
    // the held light fades in and out rather than snapping
    const want = this.opts.heldLight === false ? 0 : this.heldLight || 0;
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
    if (this.ldr && !this.vanilla && !this.layerMatDone) { this.layerMatDone = true; U.uLayerMat.value = bakeLayerMaterials(r, U.uSpecMap.value, U.uLayerInfo.value, this.layerMatMat); this.layerMatMat = null; }
    this.frame++;
    this.fadeNow = performance.now();
    U.uFrame.value = this.frame;
    U.uTime.value = state.time;
    U.uClock.value = performance.now() / 1000;
    // where the sun and moon are
    const sun = state.sunDir, moon = state.moonDir;
    U.uSunDir.value.copy(sun); U.uMoonDir.value.copy(moon);
    const light = sun.y > -0.02 ? sun : moon;
    U.uLightDir.value.copy(light);
    U.uPlayer.value.copy(state.feet);
    this.real.frame(state, dt);
    U.uEyeInWater.value = state.eyeInWater ? 1 : 0;
    U.uSkyAtEye.value = state.skyAtEye;
    /* the void (glsl.js VOID): the sky under the horizon darkens once the eye is
       below sea level (y 63, 127 here), easing in over a block; the fog goes
       to black over the last 32 blocks above the dimension's floor, as the
       game's does, and the sky with it as far as the fog reaches into the sky
       (the render distance: overhead it stays blue); not in the End, whose sky
       stays as it is */
    // (the game's factor is on the colour as shown, (y over the floor / 32) squared; here the light is
    // before the tone curve, where it takes about its cube to look as dark)
    // (a Superflat world, its horizon at the floor, darkens only in its last block: the game's clear colour scale is 1 there)
    const vd = state.dim, vf = (state.eye.y - 64 - (vd ? vd.minY : -64)) / (state.horizon === 0 ? 1 : 32);
    U.uVoid.value.set(vd && vd.sky !== 'normal' ? 0 : Math.max(0, Math.min(1, (state.horizon !== undefined ? state.horizon : 127) - state.eye.y)),
      vd && vd.sky === 'end' ? 0 : 1 - (Math.max(0, Math.min(1, vf)) ** 2) ** 3, Math.max(32, this.opts.renderDist * 16));
    if (vd && vd.sky === 'end') endFlash(U.uClock.value, !!state.bossFog, U.uEndFlash.value); else U.uEndFlash.value.set(0, 0, 0, 0);
    U.uMoonPhase.value = state.moonPhase;
    U.uRender.value = this.opts.renderDist * 16;
    if (state.waterTint) U.uWaterTint.value.copy(state.waterTint);
    const cam = this.camera;
    cam.position.copy(state.eye);
    // roll and tiltPitch: the tip of the view when hurt (survival.js viewTilt)
    cam.rotation.set(state.pitch + (state.tiltPitch || 0), state.yaw, state.roll || 0, 'YXZ');
    // the player's model posed for this frame (and, in third person, the camera pulled back), in what it wears and holds
    if (state.player) this.checkWorn();
    this.avatar.update(state, dt, cam);
    if (state.player) this.figure.frame(state);
    // hurt: the view tilts away from the hit (combat/combat.js)
    if (state.tilt) cam.quaternion.multiply(state.tilt);
    // the held block takes the light where you stand, as the model does
    if (this.uHandLight && this.avatar.uLight) this.uHandLight.value.copy(this.avatar.uLight.value);
    cam.fov = state.fov;
    // far enough for the clouds, which reach as far as Cloud Distance says at height 192
    const cloudReach = (this.opts.cloudDist || this.opts.renderDist * 2) * 16;
    U.uCloudFade.value.set(Math.min(cloudReach * 0.5, U.uRender.value), cloudReach);
    cam.far = Math.max(this.opts.renderDist * 32 + 128, Math.hypot(cloudReach, 192 - state.eye.y) + 64);
    cam.updateProjectionMatrix();
    // the portal's and Nausea's wobble, and the water over your eyes (render/screenfx.js)
    screenFx(this, cam, state);
    cam.updateMatrixWorld();
    U.uNear.value = cam.near; U.uFar.value = cam.far;
    // block pieces and the like, placed for this frame (render/particles.js)
    if (this.particles) this.particles.render(cam, state.alpha || 0);
    U.uCamPos.value.copy(cam.position);
    U.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.updateLights(state, dt);
    this.ccx = Math.floor(cam.position.x / 16); this.ccz = Math.floor(cam.position.z / 16);
    this.pumpUploads(this.opts.uploadMs || 4);
    // (under the world is a place of its own, -1: the walk starts differently there)
    const vk = Math.floor(cam.position.x / 16) + ',' + Math.max(-1, Math.min(23, Math.floor(cam.position.y / 16))) + ',' + Math.floor(cam.position.z / 16);
    const now = performance.now();
    if (vk !== this.visKey || (this.visDirty && now - (this.visAt || 0) > 1000)) { this.updateVisibility(cam.position); this.visAt = now; }
    // (how far grass, flowers and the inside of canopies are drawn: inView, as it puts the columns in order)

    // the sky table: every frame on the full tiers; on the light ones every few frames (it changes
    // slowly), a third of it a frame, and all at once when the sun has jumped (/time set, a night's sleep)
    // (nothing in the Nether or the End, which have no sky)
    if (!this.vanilla && this.sky && (this.frame < 3 || !(state.dim && state.dim.sky !== 'normal'))) {
      const n = this.opts.sky || 1, at = this.skySun || (this.skySun = new THREE.Vector3(0, -2, 0));
      if (n < 3 || this.frame < 3 || at.dot(sun) < 0.9997) { this.sky.update(sun, moon, state.eye.y); at.copy(sun); }
      else if (this.frame % n < 3) { this.sky.part(this.frame % n, sun, moon, state.eye.y); if (this.frame % n === 0) at.copy(sun); }
    }
    if (!this.vanilla) {
      this.inter.update(dt, state.feet, state.trample, this.real.steps, this.real.on);
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
      // Improved Transparency: the clouds and the rain go in before water and glass, so they show through them
      const it = !!this.opts.improvedTransparency;
      if (it) { this.vanilla.drawClouds(r, cam, state.time); this.drawFx(cam); }
      r.render(this.trans, cam);
      if (!it) this.vanilla.drawClouds(r, cam, state.time);
      this.drawHand(state, cam, dt);
      return;
    }
    // the exposure: under the sky the sky table works it out from the light there is (glsl.js EXPOSURE);
    // in a cave or under a roof the eye eases over to one level, whatever the time of day;
    // the Nether and the End have no sky and keep one level each (about where the eye used to settle there)
    // (the full chain starts from the same and lets what is on the screen nudge it: post.js FS_EXPO)
    const cave = !sunless && state.skyAtEye < 1 ? 1 : 0;
    this.caveNow = this.caveNow === undefined ? cave : this.caveNow + (cave - this.caveNow) * Math.min(1, dt * 1.5);
    U.uCave.value = this.caveNow < 0.002 ? 0 : this.caveNow;
    U.uExposure.value = (sunless ? (state.dim.id === 'the_end' ? 2.0 : 4.2) : 2.4) * Math.pow(2, this.opts.exposure || 0);
    if (this.ldr) {
      this.sky.setUniforms(U, cam.position.y);
      U.uFogK.value *= this.opts.fog === undefined ? 1 : this.opts.fog;
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, false);
      // the sky is the scene's last solid thing (render/looks.js)
      r.render(this.scene, cam);
      if (this.overlay) this.overlay.render(r, cam);
      // the clouds, as Fast draws them (none where the dimension has none, or with Clouds off), before
      // water and glass with Improved Transparency (and the rain too), after them without
      const clouds = state.dim && !state.dim.clouds ? 'off' : this.opts.shaderClouds === 'off' ? 'off' : this.opts.clouds || 'fancy';
      const drawClouds = this.blockClouds && clouds !== 'off' && !state.eyeInWater && U.uShut.value.z < 0.5;
      const it = !!this.opts.improvedTransparency;
      if (it) { if (drawClouds) this.blockClouds.draw(r, cam, state.time, clouds, cloudReach); this.drawFx(cam); }
      r.render(this.trans, cam);
      if (drawClouds && !it) this.blockClouds.draw(r, cam, state.time, clouds, cloudReach);
      this.drawHand(state, cam, dt);
      return;
    }

    // the world
    r.setRenderTarget(this.main);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    if (this.overlay) this.overlay.render(r, cam);
    // block clouds (Shader Options), lit as the rest of the full chain and marked so the
    // edge of the world does not melt them (post.js); the marched ones are the post chain's
    const clouds = state.dim && !state.dim.clouds ? 'off' : this.opts.clouds || 'fancy';
    this.post.cloudsOn = this.opts.volumetric && clouds !== 'off' && U.uShut.value.z < 0.5;
    if (this.opts.shaderClouds === 'blocks' && clouds !== 'off' && !state.eyeInWater && this.blockCloudsHDR && U.uShut.value.z < 0.5) {
      r.setRenderTarget(this.main);
      this.blockCloudsHDR.draw(r, cam, state.time, clouds, cloudReach);
    }
    if (this.opts.improvedTransparency) this.drawFx(cam);
    this.post.copies(this.main);
    r.setRenderTarget(this.main);
    r.render(this.trans, cam);
    // the hand, over everything, never inside a wall
    this.drawHand(state, cam, dt);
    // and all that comes after
    this.post.frame(this.main, cam, dt);
  }
}
