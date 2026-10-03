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
import { Sky, SUN_I } from './sky.js?v=1';
import { Post } from './post.js?v=1';
import { Interaction } from './interaction.js?v=1';
import { makeMaterials, makeLayerInfo } from './materials.js?v=1';
import { makeWaterMaterial } from './water.js?v=1';
import { makeNoise2D, makeNoise3D } from './noisetex.js?v=1';
const THREE = window.THREE;

export class Renderer {
  constructor(canvas, textures, opts) {
    this.opts = Object.assign({ renderDist: 10, shadowRes: 2048, shadowDist: 112, scale: 1 }, opts || {});
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
    this.inter = new Interaction(r);
    // shadow map
    const sr = this.opts.shadowRes;
    this.shadowRT = new THREE.WebGLRenderTarget(sr, sr, { depthBuffer: true, type: THREE.UnsignedByteType });
    this.shadowRT.depthTexture = new THREE.DepthTexture(sr, sr, THREE.FloatType);
    this.shadowRT.depthTexture.compareFunction = THREE.LessEqualCompare;
    this.shadowRT.depthTexture.minFilter = this.shadowRT.depthTexture.magFilter = THREE.LinearFilter;
    // the textures
    this.U = {
      uTime: { value: 0 }, uFrame: { value: 0 },
      uAlbedo: { value: textures.albedo }, uNormalMap: { value: textures.normal }, uSpecMap: { value: textures.spec },
      uLayerInfo: { value: makeLayerInfo(textures.manifest) },
      uAmbient: { value: this.sky.amb.texture }, uView: { value: this.sky.view.texture }, uTrans: { value: this.sky.trans.texture },
      uNoise: { value: makeNoise2D() }, uNoise3: { value: makeNoise3D() },
      uShadow: { value: this.shadowRT.depthTexture }, uShadowMat: { value: new THREE.Matrix4() }, uShadowRes: { value: sr },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uInteract: { value: this.inter.texture }, uInteractRect: { value: this.inter.rect }, uPlayer: { value: new THREE.Vector3() },
      uWet: { value: 0 }, uSceneColor: { value: null }, uSceneDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uEyeInWater: { value: 0 }, uNear: { value: 0.05 }, uFar: { value: 1000 }, uProjInv: { value: new THREE.Matrix4() },
      uRender: { value: 160 }, uMoon: { value: textures.moon }, uMoonPhase: { value: 0 }, uSkyAtEye: { value: 1 },
      uWaterTint: { value: new THREE.Vector3(0.05, 0.18, 0.78) }, uCover: { value: 0.42 }, uCamPos: { value: new THREE.Vector3() },
      uClock: { value: 0 }, uFaceRot: { value: new THREE.Matrix3() },
    };
    this.mats = makeMaterials(this.U);
    this.mats.fluid = makeWaterMaterial(this.U, this.opts);
    this.post = new Post(r, this.U, this.opts);
    // the block in your hand: drawn in the world just in front of the eye
    this.handScene = new THREE.Scene();
    this.hand = new THREE.Group();
    this.handScene.add(this.hand);
    this.swing = 0;
    this.columns = new Map();
    this.frame = 0;
    this.resize(canvas.clientWidth || 1280, canvas.clientHeight || 720);
  }

  resize(w, h) {
    this.cw = w; this.ch = h;
    const s = this.opts.scale;
    const rw = Math.max(1, Math.round(w * s)), rh = Math.max(1, Math.round(h * s));
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.main) this.main.dispose();
    this.main = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.main.depthTexture = new THREE.DepthTexture(rw, rh, THREE.FloatType);
    this.post.resize(rw, rh);
    this.U.uRes.value.set(rw, rh);
    this.U.uSceneColor.value = this.post.copyColor.texture;
    this.U.uSceneDepth.value = this.post.linDepth.texture;
    this.rw = rw; this.rh = rh;
  }

  /* ---- chunk meshes ---- */
  setColumn(cx, cz, mesh) {
    this.dropColumn(cx, cz);
    const objs = [];
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
      if (shadowMat) {
        const s = new THREE.Mesh(g, shadowMat);
        s.position.copy(m.position); s.matrixAutoUpdate = false; s.updateMatrix();
        this.shadowScene.add(s);
        objs.push(s);
      }
    };
    add(mesh.opaque, 'opaque', this.scene, this.mats.opaque, this.mats.shadowOpaque);
    add(mesh.cutout, 'cutout', this.scene, this.mats.cutout, this.mats.shadowCutout);
    add(mesh.fluid, 'fluid', this.trans, this.mats.fluid, null);
    add(mesh.translucent, 'translucent', this.trans, this.mats.translucent, null);
    this.columns.set(cx + ',' + cz, objs);
  }
  dropColumn(cx, cz) {
    const k = cx + ',' + cz;
    const objs = this.columns.get(k);
    if (!objs) return;
    const seen = new Set();
    for (const o of objs) {
      o.parent && o.parent.remove(o);
      if (!seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    }
    this.columns.delete(k);
  }

  /* ---- the held block ----
     A little cube (or a flat sprite for plants and torches) in the terrain's
     own vertex format, so it takes the same light, shadow and fog. */
  setHeld(id, BLOCKS) {
    this.hand.clear();
    const d = BLOCKS[id];
    if (!d || !d.faces) return;
    const verts = [], A = [], L = [], C = [], idx = [];
    const tint = d.tint === 'grass' ? 0x79c05a : d.tint === 'foliage' ? 0x59ae30 : d.tint === 'water' ? 0x3f76e4 : d.tint === 'spruce' ? 0x619961 : d.tint === 'birch' ? 0x80a755 : 0xffffff;
    const quad = (pts, uvs, layer, n, flags) => {
      const v0 = verts.length / 4;
      for (let c = 0; c < 4; c++) {
        verts.push(Math.round((pts[c][0] + 8) * 32), Math.round((pts[c][1] + 1) * 32), Math.round((pts[c][2] + 8) * 32), layer);
        A.push(uvs[c][0], uvs[c][1], n, 3 | flags);
        L.push(255, 0, 0, 0);
        C.push(tint >> 16, (tint >> 8) & 255, tint & 255, 255);
      }
      idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    };
    const tinted = d.tint ? 64 : 0;
    if (d.shape === 'cube' || d.shape === 'snow' || d.shape === 'cactus') {
      // the mesher's faces: normal, then +u and +v directions
      const F = [[[1, 0, 0], [0, 0, -1], [0, -1, 0]], [[-1, 0, 0], [0, 0, 1], [0, -1, 0]], [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
                 [[0, -1, 0], [1, 0, 0], [0, 0, -1]], [[0, 0, 1], [1, 0, 0], [0, -1, 0]], [[0, 0, -1], [-1, 0, 0], [0, -1, 0]]];
      for (let f = 0; f < 6; f++) {
        const [n, t, b] = F[f];
        const pts = [[0, 1], [1, 1], [1, 0], [0, 0]].map(([u, v]) => [0, 1, 2].map(k => n[k] * 0.5 + t[k] * (u - 0.5) + b[k] * (v - 0.5)));
        let layer = d.faces[f], flags = tinted;
        if (d.overlay !== undefined && f !== 2 && f !== 3) flags = 16 | 64;
        else if (d.overlay !== undefined && f === 3) flags = 0;
        if (d.front && f === 4) layer = d.front;
        quad(pts, [[0, 16], [16, 16], [16, 0], [0, 0]], layer, f, flags);
      }
    } else {
      const layer = d.faces[2];
      quad([[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]], [[0, 16], [16, 16], [16, 0], [0, 0]], layer, 4, tinted | 32);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('aPos', new THREE.BufferAttribute(new Uint16Array(verts), 4));
    g.setAttribute('aA', new THREE.BufferAttribute(new Uint8Array(A), 4));
    g.setAttribute('aL', new THREE.BufferAttribute(new Uint8Array(L), 4));
    g.setAttribute('aC', new THREE.BufferAttribute(new Uint8Array(C), 4));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    const flat = d.shape !== 'cube' && d.shape !== 'snow' && d.shape !== 'cactus';
    const m = new THREE.Mesh(g, flat ? this.mats.handCutout : this.mats.handOpaque);
    m.frustumCulled = false;
    // the shader's face frames turn with the hand
    const rot = new THREE.Matrix3();
    m.onBeforeRender = () => { rot.setFromMatrix4(m.matrixWorld); rot.multiplyScalar(1 / m.matrixWorld.getMaxScaleOnAxis()); this.U.uFaceRot.value.copy(rot); m.material.uniformsNeedUpdate = true; };
    m.onAfterRender = () => { this.U.uFaceRot.value.identity(); m.material.uniformsNeedUpdate = true; };
    this.handMesh = m;
    this.hand.add(m);
    this.heldFlat = flat;
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
    cam.fov = state.fov;
    cam.far = this.opts.renderDist * 16 + 96;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    U.uNear.value = cam.near; U.uFar.value = cam.far;
    U.uCamPos.value.copy(cam.position);
    U.uProjInv.value.copy(cam.projectionMatrixInverse);

    this.sky.update(sun, moon, state.eye.y);
    this.inter.update(dt, state.feet, state.trample);
    U.uInteract.value = this.inter.texture;

    // the shadow map, from whichever light is up
    const D = this.opts.shadowDist;
    const sc = this.shadowCam;
    sc.left = -D; sc.right = D; sc.top = D; sc.bottom = -D; sc.near = -320; sc.far = 320;
    sc.updateProjectionMatrix();
    const up = Math.abs(light.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const look = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), light.clone().negate(), up);
    // snap the centre to whole texels in the light's own frame
    const inv = look.clone().invert();
    const centre = state.feet.clone().applyMatrix4(inv);
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

    // the world
    r.setRenderTarget(this.main);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    this.post.copies(this.main);
    r.setRenderTarget(this.main);
    r.render(this.trans, cam);
    // the hand, over everything, never inside a wall
    if (this.handMesh && state.showHand !== false) {
      this.swing = Math.max(0, this.swing - dt * 3.2);
      this.placeHand(state, cam);
      r.render(this.handScene, cam);
    }
    // and all that comes after
    this.post.frame(this.main, cam, dt);
  }
}
