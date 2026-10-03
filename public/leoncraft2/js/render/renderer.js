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
import { Sky, SUN_I } from './sky.js?v=5';
import { Post } from './post.js?v=5';
import { Interaction } from './interaction.js?v=5';
import { makeMaterials, makeLayerInfo } from './materials.js?v=5';
import { makeWaterMaterial } from './water.js?v=5';
import { makeNoise2D, makeNoise3D } from './noisetex.js?v=5';
import { makeLdrSky } from './ldrsky.js?v=5';
import { FullScreen } from './sky.js?v=5';
import { blockGeometry } from './blockmesh.js?v=5';
import { Avatar } from './avatar.js?v=5';
const THREE = window.THREE;

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
    this.shadowScene = new THREE.Scene();
    this.shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 400);
    this.sky = new Sky(r);
    this.inter = new Interaction(r, this.opts.interSize || 256);
    // shadow map
    const sr = this.opts.shadows ? this.opts.shadowRes : 4;   // no shadow map at all: a token one
    this.shadowRT = new THREE.WebGLRenderTarget(sr, sr, { depthBuffer: true, type: THREE.UnsignedByteType });
    this.shadowRT.depthTexture = new THREE.DepthTexture(sr, sr, THREE.FloatType);
    this.shadowRT.depthTexture.compareFunction = THREE.LessEqualCompare;
    this.shadowRT.depthTexture.minFilter = this.shadowRT.depthTexture.magFilter = THREE.LinearFilter;
    // made now, cleared to "nothing in the way", so the shaders never sample a map that is not there yet
    r.setRenderTarget(this.shadowRT); r.setClearColor(0xffffff, 1); r.clear(true, true, false); r.setRenderTarget(null);
    // the textures
    this.U = {
      uTime: { value: 0 }, uFrame: { value: 0 },
      uAlbedo: { value: textures.albedo }, uNormalMap: { value: textures.normal }, uSpecMap: { value: textures.spec },
      uLayerInfo: { value: makeLayerInfo(textures.manifest) },
      uAmbient: { value: this.sky.amb.texture }, uView: { value: this.sky.view.texture }, uTrans: { value: this.sky.trans.texture },
      uNoise: { value: makeNoise2D() }, uNoise3: { value: ldr ? null : makeNoise3D() },
      uShadow: { value: this.shadowRT.depthTexture }, uShadowMat: { value: new THREE.Matrix4() }, uShadowRes: { value: sr },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uInteract: { value: this.inter.texture }, uInteractRect: { value: this.inter.rect }, uPlayer: { value: new THREE.Vector3() },
      uWet: { value: 0 }, uSceneColor: { value: null }, uSceneDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uEyeInWater: { value: 0 }, uNear: { value: 0.05 }, uFar: { value: 1000 }, uProjInv: { value: new THREE.Matrix4() },
      uRender: { value: 160 }, uMoon: { value: textures.moon }, uMoonPhase: { value: 0 }, uSkyAtEye: { value: 1 },
      uWaterTint: { value: new THREE.Vector3(0.05, 0.18, 0.78) }, uCover: { value: 0.42 }, uCamPos: { value: new THREE.Vector3() },
      uClock: { value: 0 }, uFaceRot: { value: new THREE.Matrix3() }, uExposure: { value: 1 }, uInvViewProj: { value: new THREE.Matrix4() },
      // the light in your hand (level, faded in and out) and where it is; torches' flicker; how dark cloud shadows are
      uHeldLight: { value: 0 }, uHeldPos: { value: new THREE.Vector3() }, uFlicker: { value: 1 }, uCloudShadow: { value: this.opts.cloudShadow > 0 ? 0.8 : 0 },
    };
    this.mats = makeMaterials(this.U, this.opts);
    this.mats.fluid = makeWaterMaterial(this.U, this.opts);
    // the full tiers run the whole chain after the world; the low ones draw straight to the screen
    this.post = ldr ? null : new Post(r, this.U, this.opts);
    if (ldr) { this.skyFS = new FullScreen(makeLdrSky(this.U)); }
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
    const s = this.opts.scale;
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
    this.r.setSize(w, h, false);
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
  setColumn(cx, cz, mesh) {
    const k = cx + ',' + cz;
    this.uploads = this.uploads || new Map();
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
    this.visDirty = true;
  }
  /* The shadow map is kept from frame to frame and only drawn again when it
     would look different: the sun has moved a quarter of a degree, you have
     moved a few blocks from where it was centred, the world's meshes changed,
     or your own body is moving (so its shadow keeps up). Standing still, it
     costs nothing at all; it is most of what the full tiers spend a frame on. */
  shadowNeeded(state, light) {
    const S = this.shadowState || (this.shadowState = { x: 0, y: 0, z: 0, cx: 1e9, cy: 1e9, cz: 1e9, at: -1e9, dirty: true });
    const grid = Math.max(2, this.opts.shadowDist / 24), f = state.feet;
    const cx = Math.floor(f.x / grid), cy = Math.floor(f.y / grid), cz = Math.floor(f.z / grid);
    const turned = light.x * S.x + light.y * S.y + light.z * S.z < 0.99997;
    const P = state.player;
    // your own shadow keeps up with you only where you can see yourself (third person)
    const body = this.avatar && this.avatar.ready && this.avatar.view !== 0 && P && (Math.abs(P.vel.x) + Math.abs(P.vel.z) > 0.005 || this.swing > 0 || P.sneaking !== S.sneak);
    const need = S.dirty || turned || cx !== S.cx || cy !== S.cy || cz !== S.cz || this.frame - S.at > 90 || (body && this.frame - S.at >= 3);
    if (!need) return false;
    S.x = light.x; S.y = light.y; S.z = light.z; S.cx = cx; S.cy = cy; S.cz = cz; S.at = this.frame; S.dirty = false;
    S.sneak = P ? P.sneaking : false;
    return true;
  }
  addColumn(cx, cz, mesh) {
    if (this.shadowState) this.shadowState.dirty = true;
    this.dropColumn(cx, cz);
    const objs = [];
    const col = { cx, cz, vis: mesh.vis, skyLow: mesh.skyLow, parts: [], shadows: [] };
    const add = (data, kind, scene, material, shadowMat) => {
      if (!data) return;
      const g = new THREE.BufferGeometry();
      const names = kind === 'fluid' ? ['aPos', 'aA', 'aF', 'aC'] : ['aPos', 'aA', 'aL', 'aC'];
      data.attrs.forEach((a, i) => g.setAttribute(names[i], new THREE.BufferAttribute(a, 4, false)));
      g.setIndex(new THREE.BufferAttribute(data.index, 1));
      // how tall the mesh actually is, for culling
      const P = data.attrs[0];
      let y0 = 1e9, y1 = -1e9;
      for (let i = 1; i < P.length; i += 4) { const y = P[i]; if (y < y0) y0 = y; if (y > y1) y1 = y; }  // (x and z carry an 8 block bias; y does not)
      y0 /= 32; y1 /= 32;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, (y0 + y1) / 2, 8), Math.hypot(8, 8, (y1 - y0) / 2) + 1);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(0, y0, 0), new THREE.Vector3(16, y1, 16));
      const m = new THREE.Mesh(g, material);
      m.position.set(cx * 16, 0, cz * 16);
      if (kind === 'fluid') {
        // each fluid mesh glides from the moment it arrived
        const t0 = this.U.uClock.value;
        m.onBeforeRender = () => { material.uniforms.uMeshTime.value = t0; material.uniformsNeedUpdate = true; };
      }
      m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m);
      objs.push(m);
      col.parts.push({ m, g, marks: data.marks });
      if (shadowMat) {
        // the shadow pass needs nothing below where the sky reaches
        const sg = new THREE.BufferGeometry();
        for (const nm in g.attributes) sg.setAttribute(nm, g.attributes[nm]);
        sg.setIndex(g.index);
        sg.boundingSphere = g.boundingSphere; sg.boundingBox = g.boundingBox;
        const from = data.marks[Math.max(0, Math.min(24, (mesh.skyLow >> 4) - 1))];
        sg.setDrawRange(from, data.index.length - from);
        const s = new THREE.Mesh(sg, shadowMat);
        s.position.copy(m.position); s.matrixAutoUpdate = false; s.updateMatrix();
        this.shadowScene.add(s);
        objs.push(s);
      }
    };
    add(mesh.opaque, 'opaque', this.scene, this.mats.opaque, this.mats.shadowOpaque);
    add(mesh.cutout, 'cutout', this.scene, this.mats.cutout, this.mats.shadowCutout);
    // plants: their own mesh, so far columns can leave them out (and the low tiers cast no shadow with them)
    add(mesh.plants, 'plants', this.scene, this.mats.cutout, this.opts.plantShadows === false ? null : this.mats.shadowCutout);
    col.plants = col.parts.length && mesh.plants ? col.parts[col.parts.length - 1].m : null;
    add(mesh.leafIn, 'leafIn', this.scene, this.mats.cutout, this.opts.leafInShadows === false ? null : this.mats.shadowCutout);
    col.leafIn = mesh.leafIn ? col.parts[col.parts.length - 1].m : null;
    add(mesh.fluid, 'fluid', this.trans, this.mats.fluid, null);
    add(mesh.translucent, 'translucent', this.trans, this.mats.translucent, null);
    col.objs = objs;
    this.columns.set(cx + ',' + cz, col);
  }
  dropColumn(cx, cz) {
    if (this.shadowState) this.shadowState.dirty = true;
    const k = cx + ',' + cz;
    if (this.uploads) this.uploads.delete(k);
    const col = this.columns.get(k);
    if (!col) return;
    const seen = new Set();
    for (const o of col.objs) {
      o.parent && o.parent.remove(o);
      if (!seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    }
    this.columns.delete(k);
    this.visDirty = true;
  }

  /* ---- cave culling ----
     A walk outward from the camera's section, through the faces each
     section's open space connects, never turning back towards the camera
     (Sodium's method). Each column then draws only the run of sections the
     walk reached; underground caves you cannot see are never drawn. */
  updateVisibility(eye) {
    const csx = Math.floor(eye.x / 16), csz = Math.floor(eye.z / 16), csy = Math.max(0, Math.min(23, Math.floor(eye.y / 16)));
    const R = this.opts.renderDist + 1;
    const span = 2 * R + 1;
    const key = (x, y, z) => ((x - csx + R) * span + (z - csz + R)) * 24 + y;
    const done = new Uint8Array(span * span * 24);      // entry faces already handled
    const reach = new Map();                            // column -> [min, max] section
    const q = [[csx, csy, csz, 63]];
    done[key(csx, csy, csz)] = 63;
    const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const OPP = [1, 0, 3, 2, 5, 4];
    while (q.length) {
      const [x, y, z, entries] = q.pop();
      const col = this.columns.get(x + ',' + z);
      const ck = x + ',' + z;
      const r = reach.get(ck);
      if (!r) reach.set(ck, [y, y]); else { if (y < r[0]) r[0] = y; if (y > r[1]) r[1] = y; }
      // which faces can be left by, from the faces it was entered by
      let exits = 0;
      if (!col || !col.vis || (x === csx && y === csy && z === csz)) exits = 63;
      else for (let f = 0; f < 6; f++) if (entries & (1 << f)) exits |= col.vis[y * 6 + f];
      for (let f = 0; f < 6; f++) {
        if (!(exits & (1 << f))) continue;
        const [dx, dy, dz] = DIRS[f];
        // never back towards the camera
        if ((dx > 0 && x < csx) || (dx < 0 && x > csx) || (dy > 0 && y < csy) || (dy < 0 && y > csy) || (dz > 0 && z < csz) || (dz < 0 && z > csz)) continue;
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (ny < 0 || ny > 23 || Math.abs(nx - csx) > R || Math.abs(nz - csz) > R) continue;
        const kk = key(nx, ny, nz), ent = 1 << OPP[f];
        if (done[kk] & ent) continue;
        done[kk] |= ent;
        q.push([nx, ny, nz, ent]);
      }
    }
    for (const [k, col] of this.columns) {
      const r = reach.get(k);
      for (const p of col.parts) {
        if (!r) { p.m.visible = false; continue; }
        p.m.visible = true;
        const from = p.marks[r[0]], to = p.marks[Math.min(24, r[1] + 1)];
        if (to <= from) { p.m.visible = false; continue; }
        p.g.setDrawRange(from, to - from);
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
    cam.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
    // the player's model posed for this frame (and, in third person, the camera pulled back)
    this.avatar.update(state, dt, cam);
    cam.fov = state.fov;
    cam.far = this.opts.renderDist * 16 + 96;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    U.uNear.value = cam.near; U.uFar.value = cam.far;
    U.uCamPos.value.copy(cam.position);
    U.uProjInv.value.copy(cam.projectionMatrixInverse);
    this.updateLights(state, dt);
    this.ccx = Math.floor(cam.position.x / 16); this.ccz = Math.floor(cam.position.z / 16);
    this.pumpUploads(this.opts.uploadMs || 4);
    const vk = Math.floor(cam.position.x / 16) + ',' + Math.max(0, Math.min(23, Math.floor(cam.position.y / 16))) + ',' + Math.floor(cam.position.z / 16);
    const now = performance.now();
    if (vk !== this.visKey || (this.visDirty && now - (this.visAt || 0) > 200)) { this.updateVisibility(cam.position); this.visAt = now; }
    // grass and flowers stop where you could not make them out anyway
    const pd = (this.opts.plantDist || 96) / 16;
    // and the inside of a tree's canopy only near enough to see into
    const ld = (this.opts.leafInDist || 64) / 16;
    for (const col of this.columns.values()) {
      const d = Math.hypot(col.cx + 0.5 - cam.position.x / 16, col.cz + 0.5 - cam.position.z / 16);
      if (col.plants && d >= pd) col.plants.visible = false;
      if (col.leafIn && d >= ld) col.leafIn.visible = false;
    }

    // the sky table: every frame on the full tiers, every few on the low ones (it changes slowly)
    if (this.frame % (this.opts.sky || 1) === 0 || this.frame < 3) this.sky.update(sun, moon, state.eye.y);
    this.inter.update(dt, state.feet, state.trample);
    U.uInteract.value = this.inter.texture;

    // the shadow map, from whichever light is up (some tiers redraw it every other frame)
    const doShadow = this.opts.shadows > 0 && (this.frame % (this.opts.shadowEvery || 1) === 0) && this.shadowNeeded(state, light);
    if (doShadow) {
    const D = this.opts.shadowDist;
    const sc = this.shadowCam;
    sc.left = -D; sc.right = D; sc.top = D; sc.bottom = -D; sc.near = -320; sc.far = 320;
    sc.updateProjectionMatrix();
    const T = this.tmp || (this.tmp = { up: new THREE.Vector3(), o: new THREE.Vector3(), n: new THREE.Vector3(), look: new THREE.Matrix4(), inv: new THREE.Matrix4(), c: new THREE.Vector3() });
    const up = Math.abs(light.y) > 0.99 ? T.up.set(0, 0, 1) : T.up.set(0, 1, 0);
    const look = T.look.lookAt(T.o.set(0, 0, 0), T.n.copy(light).negate(), up);
    // snap the centre to whole texels in the light's own frame
    const inv = T.inv.copy(look).invert();
    const centre = T.c.copy(state.feet).applyMatrix4(inv);
    const texel = 2 * D / this.opts.shadowRes * 0.25;
    centre.x = Math.round(centre.x / texel) * texel; centre.y = Math.round(centre.y / texel) * texel;
    centre.applyMatrix4(look);
    sc.position.copy(centre);
    sc.quaternion.setFromRotationMatrix(look);
    sc.updateMatrixWorld();
    U.uShadowMat.value.multiplyMatrices(sc.projectionMatrix, sc.matrixWorldInverse);
    r.setRenderTarget(this.shadowRT);
    r.setClearColor(0xffffff, 1);
    r.clear(true, true, false);
    if (light.y > 0.0) r.render(this.shadowScene, sc);
    }
    U.uInvViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).invert();
    if (this.ldr) {
      // exposure worked out here: by day the sky, by night the moon, deeper in a cave
      const day = Math.min(1, Math.max(0, (sun.y + 0.12) / 0.42));
      let e = Math.exp(Math.log(4.2) + (Math.log(0.11) - Math.log(4.2)) * Math.sqrt(day));
      if (state.skyAtEye < 1) e *= 2.2;
      const ex = this.ldrExpo === undefined ? e : this.ldrExpo + (e - this.ldrExpo) * Math.min(1, dt * 1.5);
      this.ldrExpo = ex;
      U.uExposure.value = ex;
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, false);
      this.skyFS.render(r, null);
      r.render(this.scene, cam);
      if (this.overlay) this.overlay.render(r, cam);
      r.render(this.trans, cam);
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
