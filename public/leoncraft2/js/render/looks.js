/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Shaders setting (Off, Low, Medium, High, RIP Computer),
   changed while you play.

   Off is the game as it draws itself (render/vanilla.js). The others are our
   shader, in one of two pipelines: the light one (Low and Medium: everything
   lit at the corners and drawn in one pass straight to the screen) or the
   full chain (High and RIP Computer: render/post.js, the light worked out per
   pixel, with bloom, light shafts, volumetric clouds, reflections of the
   world in the water and normal maps).

   Each level is a plain settings object (SHADER_DEFAULTS and LEVEL_SETTINGS);
   lookOf() turns it into what the renderer needs, and applyLook() puts that
   into effect without reloading anything:

     - every material the world is drawn with keeps its identity (meshes all
       over the game hold on to them) and only takes the new shader code, so
       nothing has to find its material again; three.js builds the new
       programs the next time each is drawn
     - the parts only one look uses (the atmosphere tables, the Off look's
       lightmap and sky, the post chain, the shadow maps) are made the first
       time they are wanted and kept, so switching back is quick
     - a part that is off is not drawn at all, and what it would cost is
       left out of the shaders (#defines), not just multiplied by zero

   Other modules hand in their materials through renderer.looked(make):
   make(opts) builds the material for a look, and is called again for each
   new one. renderer.onLook(fn) hears of every change.
--------------------------------------------------------------------------- */
import { Sky, FullScreen } from './sky.js?v=107';
import { Post } from './post.js?v=107';
import { makeMaterials, layerMatMaterial } from './materials.js?v=107';
import { makeWaterMaterial } from './water.js?v=107';
import { makeNoise3DAsync, makeNoise3DGPU } from './noisetex.js?v=107';
import { makeLdrSky } from './ldrsky.js?v=107';
import { Vanilla, makeVanillaMaterials } from './vanilla.js?v=107';
import { BlockClouds, detailedCloudMaterial } from './clouds.js?v=107';
import { ShadowMaps } from './shadows.js?v=107';
import { makeToneLut } from './glsl.js?v=107';
const THREE = window.THREE;

/* ---- the shader's settings ----
   The defaults are Medium, the look the game had before the levels. */
export const SHADER_DEFAULTS = {
  shadows: 'medium',         // off low medium high ultra: how sharp the sun's shadow map is
  shadowDistance: 64,        // blocks the shadows reach
  shadowSoftness: 0.5,       // 0 hard edges, 1 the softest
  sunColour: 'natural',      // warm natural cool
  sunBrightness: 1,          // 0.5 - 1.5
  skyLight: 1,               // the sky's light in the shade, 0.5 - 1.5
  skyColour: 1,              // how deep the sky's blue is, 0 grey - 1.5
  water: 'sheen',            // vanilla (its texture), sheen (the sky in it), reflections (the world in it too)
  reflections: 'low',        // low high: how far the reflections look
  waves: 'high',             // off low high: how high the waves run (Low: half as high, and cheaper)
  wavingPlants: 'high',      // off low high: grass, flowers, crops, kelp
  wavingLeaves: 'high',      // off low high
  bloom: 'off',              // off low high
  lightShafts: 'off',        // off low high max
  ao: 1,                     // ambient occlusion strength, 0 - 1
  fog: 1,                    // 0 none - 2 thick
  exposure: 0,               // stops brighter or darker, -2 - 2
  contrast: 1,               // 0.5 - 1.5
  saturation: 1,             // 0 grey - 2
  clouds: 'blocks',          // blocks volumetric off (blocks follow Clouds in Video Settings)
  cloudDetail: 'normal',     // normal max: how finely the volumetric clouds are marched
  cloudShadows: false,
  normalMaps: false,
  heldLight: true,           // a torch in your hand lights what is round you
  antialiasing: 'off',       // off fxaa (the full chain only)
  tone: 'agx',               // agx aces reinhard: the tone curve from the scene's light to the screen
  realism: false,            // RIP Computer's extras: plants pushed by everyone and Photon's wind, blocks blown apart, bodies left lying, puddles
};
/* The levels of the one Shaders button in Video Settings (Off is the game's
   own look). Low and Medium are the light pipeline; High and RIP Computer
   bring back the full look from before the shaders were lightened: bloom,
   light shafts, volumetric clouds and their shadows, the world in the water,
   normal maps and soft shadows far out. RIP Computer has every part at its
   most. */
export const SHADER_LEVELS = ['off', 'low', 'medium', 'high', 'rip'];
export const LEVEL_SETTINGS = {
  low: { shadows: 'low', shadowDistance: 48, shadowSoftness: 0, wavingPlants: 'low', wavingLeaves: 'off', waves: 'off' },
  medium: {},
  high: { shadows: 'high', shadowDistance: 96, shadowSoftness: 0.6, bloom: 'low', lightShafts: 'low', clouds: 'volumetric', cloudShadows: true,
    water: 'reflections', reflections: 'low', normalMaps: true },
  rip: { shadows: 'ultra', shadowDistance: 128, shadowSoftness: 0.7, bloom: 'high', lightShafts: 'max', clouds: 'volumetric', cloudDetail: 'max', cloudShadows: true,
    water: 'reflections', reflections: 'max', normalMaps: true, realism: true },
};

// the settings of a level (Off has none: lookOf(_, false))
export function shaderSettings(level) {
  return Object.assign({}, SHADER_DEFAULTS, LEVEL_SETTINGS[level] || {});
}

/* The shadow map, by its sharpness: texels a side, how many frames a new one
   is spread over, and how many taps a soft edge takes. The map is an even
   grid now (render/shadows.js), a texel about a pixel of a block's texture
   at every level but Low. */
const SHADOW_RES = { low: 1024, medium: 2048, high: 3072, ultra: 4096 };
const SHADOW_SLICES = { low: 8, medium: 6, high: 3, ultra: 1 };
const SHADOW_TAPS = { low: 4, medium: 4, high: 8, ultra: 16 };
const WAVE = { off: 0, low: 0.5, high: 1 };
// how many new shader programs are built at once while a look is coming (applyLook)
// (each takes a core or two in the browser while it is built; the game's own workers want theirs)
const COMPILE_AT_ONCE = (n => n >= 16 ? 3 : n >= 8 ? 2 : 1)(navigator.hardwareConcurrency || 4);
const SUN_TINT = { warm: [1.12, 0.97, 0.78], natural: [1.06, 1.0, 0.88], cool: [0.98, 1.0, 1.04] };
export const CLOUD_SHADE = 0.33;

// Shaders OFF: the game's own look
const VANILLA_LOOK = {
  vanilla: true, ldr: true, shadows: 0, normals: false, cloudShadow: 0, sky: 16,
  uploadMs: 3, plantDist: 136, leafInDist: 64, plantShadows: false, wind: false, wave: [0, 0], water: 1, waves: false, ssrSteps: 0,
  bloom: false, vlSteps: 0, volumetric: false, shaderClouds: 'blocks', fxaa: false, heldLight: false,
  ao: 1, fog: 1, exposure: 0, contrast: 1, saturation: 1, tone: 'agx', sunTint: SUN_TINT.natural, skyLight: 1, skySat: 1,
};

// does this need the full chain?
export function needsFullChain(s) {
  return s.bloom !== 'off' || s.lightShafts !== 'off' || s.clouds === 'volumetric' || s.water === 'reflections' || !!s.normalMaps;
}

/* What the renderer needs for these settings (shaders on), or for the
   game's own look (shaders off). */
export function lookOf(s, on) {
  if (!on) return Object.assign({}, VANILLA_LOOK);
  const full = needsFullChain(s);
  const plants = WAVE[s.wavingPlants] || 0, leaves = WAVE[s.wavingLeaves] || 0;
  const tint = SUN_TINT[s.sunColour] || SUN_TINT.natural;
  return {
    vanilla: false, ldr: !full,
    shadows: s.shadows === 'off' ? 0 : s.shadowSoftness > 0 ? 2 : 1,
    shadowRes: SHADOW_RES[s.shadows] || 2048, shadowDist: s.shadowDistance,
    shadowSlices: SHADOW_SLICES[s.shadows] || 6, shadowTaps: SHADOW_TAPS[s.shadows] || 4,
    shadowSoft: 0.4 + 2.4 * s.shadowSoftness,
    normals: full && !!s.normalMaps,
    cloudShadow: s.cloudShadows ? 2 : 0,
    sky: full ? 1 : 16,
    uploadMs: 3, plantDist: 96, leafInDist: 48, plantShadows: false, leafInShadows: false,
    wind: plants + leaves > 0, wave: [plants, leaves],
    water: s.water === 'vanilla' ? 0 : 1, waves: s.waves === 'off' ? false : s.waves === 'low' ? 'low' : true,
    ssrSteps: s.water === 'reflections' ? ({ low: 12, high: 28, max: 48 }[s.reflections] || 12) : 0,
    bloom: s.bloom !== 'off', bloomMix: s.bloom === 'high' ? 0.08 : 0.045,
    // (High and above: finer, and the beams stronger, so the level shows)
    vlSteps: { off: 0, low: 10, high: 20, max: 32 }[s.lightShafts] || 0,
    vlStrength: s.lightShafts === 'low' ? 1 : 1.5,
    cloudSteps: s.cloudDetail === 'max' ? 32 : 20,
    volumetric: s.clouds === 'volumetric', shaderClouds: s.clouds,
    fxaa: s.antialiasing === 'fxaa',
    ao: s.ao, fog: s.fog, exposure: s.exposure, contrast: s.contrast, saturation: s.saturation, tone: s.tone || 'agx',
    sunTint: tint.map(v => v * s.sunBrightness), skyLight: s.skyLight, skySat: s.skyColour, heldLight: !!s.heldLight,
    // (the full chain only: puddles and wet ground are worked out per pixel there)
    realism: full && !!s.realism,
  };
}

/* ---- a material takes another one's shader ----
   Its program is let go first (dispose), so three.js builds it afresh from
   the new code the next time it is drawn: a material keeps a program per
   setup it has been drawn with, and would otherwise go back to an old one
   with the uniforms it had then. */
const MORPH = ['vertexShader', 'fragmentShader', 'defines', 'uniforms', 'side', 'transparent', 'depthWrite', 'depthTest', 'depthFunc', 'blending', 'glslVersion'];
export function morph(dst, src) {
  if (!dst || !src || dst === src) return dst;
  dst.dispose();
  for (const k of MORPH) dst[k] = src[k];
  dst.needsUpdate = true;
  return dst;
}

// the key of everything that changes shader code: a change in any of it rebuilds the materials
function codeKey(o) {
  return [o.vanilla, o.ldr, o.shadows, o.shadowTaps || 4, o.normals, o.cloudShadow, o.wind, o.water, o.waves, o.ssrSteps, o.rgss, o.vlSteps > 0 ? o.vlSteps : 0, o.ldr ? 0 : o.cloudSteps || 20, !!o.improvedTransparency, !!o.realism].join(',');
}

/* ---- put a look into effect ----
   R is the Renderer; look comes from lookOf() (plus the Video Settings that
   reach the shaders, like rgss). The first call (from the Renderer's own
   constructor) builds everything at once. Later ones that only change
   numbers (exposure, fog, how far the shadows reach...) take effect at once.
   One that needs new shader code builds it off to the side and has the
   graphics card compile it in the background (KHR_parallel_shader_compile) while
   the old look goes on being drawn; when it is ready the materials take it,
   the programs come out of three.js's cache already built, and the new look
   is there from one frame to the next with no stall. */
export function applyLook(R, look, first) {
  if (first) { safeCompileAsync(R.r); firstVertexFlat(R.r); }
  const o = Object.assign({}, R.opts || {}, look);
  const key = codeKey(o);
  if (first || key === R.lookKey) {
    // (back to this look while another was still being built for: that one is not wanted any more)
    if (R.lookPending) { R.lookToken = (R.lookToken || 0) + 1; R.lookPending = null; }
    return finishLook(R, look, first, first ? null : false);
  }
  // already being built for: it takes these numbers when it is ready
  if (R.lookPending && R.lookPending.key === key) { Object.assign(R.lookPending.look, look); return true; }
  const token = R.lookToken = (R.lookToken || 0) + 1;
  // (main.js's render scale leaves alone the frames from here until a few seconds after the look lands)
  R.lookAt = performance.now();
  const prep = prepare(R, o);
  const pending = R.lookPending = { key, look: Object.assign({}, look), prep };
  let ran = false;
  const done = () => {
    if (ran) return;
    ran = true;
    if (R.lookToken !== token) { letGoBuilt(R, prep.temps); return; }
    R.lookPending = null;
    finishLook(R, pending.look, false, prep);
  };
  /* Handed to the graphics card one or two at a time (COMPILE_AT_ONCE, by
     the machine's cores), the next only when one of those is built. The
     browser compiles each new program on a core of its own, and the first
     time a look is chosen on a machine none of them are in its cache yet:
     the forty-odd of a look handed over at once (three a frame) took every
     core for half a second and more, the browser's own drawing starved with
     them, and the game stopped for that long, from a third of a second to
     two and a half with the machine busy. A few at a time the new look takes
     a little longer to come the first time (one to two seconds; the old one
     is drawn meanwhile) and the frames keep coming. A program that is in the
     cache already (an earlier look's, or the browser's own copy from another
     day) is ready at once and holds no place in the line. */
  /* Each frame, the programs being built are asked whether they are done:
     every such question waits for the graphics process to catch up, which is
     why there are only ever one or two to ask (three.js's own compileAsync
     asked all of them every ten milliseconds). One that is done is asked for
     its uniforms and attributes there and then, questions three.js would
     otherwise ask at its first draw, all of them in the frame the new look
     first shows. */
  const compiled = new Promise(res => {
    const list = prep.compile, building = [], most = R.compileAtOnce || COMPILE_AT_ONCE, programs = R.r.info.programs;
    let i = 0;
    const step = () => {
      if (R.lookToken !== token) return res();
      const t0 = performance.now();
      for (let j = 0; j < building.length;) {
        // (one let go meanwhile, its look given up, is not asked about)
        const [p, at] = building[j];
        if (p.program && !p.isReady()) { j++; continue; }
        if (p.program) {
          try { p.getUniforms(); p.getAttributes(); } catch (e) { /* (three.js reports a shader that failed) */ }
          if (R.lookStats) R.lookStats.push([p, performance.now() - at]);
        }
        building.splice(j, 1);
      }
      while (i < list.length && building.length < most && performance.now() - t0 < 5) {
        const scene = new THREE.Scene(), had = programs ? programs.length : 0;
        scene.add(new THREE.Mesh(R.standGeo, list[i++]));
        try { R.r.compile(scene, R.camera); } catch (e) { /* built when first drawn */ }
        // (the programs this one made: none when it shares one already built)
        if (programs) for (let k = had; k < programs.length; k++) building.push([programs[k], performance.now()]);
      }
      if (i < list.length || building.length) requestAnimationFrame(step); else res();
    };
    step();
  });
  // (and the full chain's cloud noise, made in a worker the first time)
  // (and the atmosphere's tables drawn the first time, a part a frame, before the look takes over)
  Promise.all([compiled, prep.noise]).then(() => firstSky(R, token)).then(done, done);
  // a browser that cannot say when they are ready: after a while all the same
  setTimeout(done, 10000);
  return true;
}

/* The atmosphere's tables the first time a shader look is chosen while
   playing, drawn before it takes over: the two that never change, then the
   sky, the fog and the light table a frame each, and the light table read
   back without waiting for it (the first read had waited for all of that to
   be drawn, a fifth of a second and more). */
function firstSky(R, token) {
  const S = R.sky, U = R.U;
  if (!S || S.lightRead) return Promise.resolve();
  return new Promise(res => {
    let k = -1;
    const step = () => {
      if (R.lookToken !== token) return res();
      if (k < 0) S.init();
      else if (k < 3) S.part(k, U.uSunDir.value, U.uMoonDir.value, R.camera.position.y, true);
      else { S.readLight(); if (S.lightRead) return res(); }
      R.r.setRenderTarget(null);
      k = Math.min(k + 1, 3);
      requestAnimationFrame(step);
    };
    step();
  });
}

/* A look given up while it was still being built (another chosen before it
   was ready): its materials are let go once the graphics process has finished
   building their programs. Let go while it was still at it, Chrome went on
   asking after programs that were no longer there, a console warning each
   time. (Checked four times a second, half a minute at most.) */
function letGoBuilt(R, mats) {
  let tries = 0;
  const check = () => {
    const building = mats.some(m => { const p = R.r.properties.get(m).currentProgram; return p && p.program && !p.isReady(); });
    if (building && ++tries < 120) setTimeout(check, 250);
    else for (const m of mats) m.dispose();
  };
  check();
}

/* three.js's compileAsync asks each material for its program until all are
   built; a material that took another look's shader meanwhile (morph, which
   lets its program go) has none to ask, and the question threw. These are
   simply not waited for. */
function safeCompileAsync(r) {
  if (r.compileAsyncSafe) return;
  r.compileAsyncSafe = true;
  r.compileAsync = function (scene, camera, target = null) {
    const mats = r.compile(scene, camera, target);
    const parallel = r.extensions.get('KHR_parallel_shader_compile') !== null;
    return new Promise(resolve => {
      const check = () => {
        for (const m of mats) { const p = r.properties.get(m).currentProgram; if (!p || p.isReady()) mats.delete(m); }
        if (mats.size === 0) resolve(scene); else setTimeout(check, 10);
      };
      if (parallel) check(); else setTimeout(check, 10);
    });
  };
}
/* A flat varying (the texture layer, the face's flags: the same at every
   corner of a face) takes the last corner's value in OpenGL and the first's
   in Direct3D, so ANGLE on Direct3D 11 put a geometry shader in front of
   every shader that has one, built at its first draw and run on every
   triangle after. Asking for the first corner's value lets the graphics
   card do it its own way. */
function firstVertexFlat(r) {
  const pv = r.getContext().getExtension('WEBGL_provoking_vertex');
  if (pv) pv.provokingVertexWEBGL(pv.FIRST_VERTEX_CONVENTION_WEBGL);
}
// the full chain's 3D noise (volumetric clouds and light shafts): drawn by the graphics card, once, and filled in when ready
function noise3D(R) {
  if (!R.noise3) {
    let made;
    try { made = makeNoise3DGPU(R.r); } catch (e) { console.warn('noise on the graphics card', e); made = makeNoise3DAsync(); }
    const put = t => { R.U.uNoise3.value = t; };
    R.noise3 = made.then(put, e => { console.warn('noise on the graphics card', e); return makeNoise3DAsync().then(put); });
  }
  return R.noise3;
}

/* What a new look needs that can be made before it takes over: the parts
   only it uses (made once and kept), and every material in its new form,
   with the list of what the graphics card is to compile. */
function prepare(R, o) {
  const r = R.r, U = R.U, compile = [];
  // (the atmosphere's tables drawn only once their shaders are built: finishLook)
  if (!o.vanilla && !R.sky) R.sky = new Sky(r, true);
  if (!o.vanilla && !R.sky.ready) compile.push(...R.sky.materials);
  // (the ripples and trampled grass, stepped every frame with shaders on: built in its first frame, a tenth of a second)
  if (!o.vanilla && R.inter && R.inter.m) compile.push(R.inter.m);
  // (and the light pipeline's table of what each texture is made of, worked out at its first frame: renderer.js)
  if (!o.vanilla && o.ldr && !R.layerMatDone && !R.layerMatMat) { R.layerMatMat = layerMatMaterial(U.uSpecMap.value, U.uLayerInfo.value); compile.push(R.layerMatMat); }
  if (o.vanilla && !R._vanilla) R._vanilla = new Vanilla(R, R.textures);
  if (o.vanilla) for (const fs of [R._vanilla.skyFS]) compile.push(fs.mesh.material);
  if (o.vanilla) compile.push(R._vanilla.cloudMesh.depth.material, R._vanilla.cloudMesh.colour.material);
  if (!o.vanilla && !U.uToneLut.value) U.uToneLut.value = makeToneLut(o.contrast || 1, o.saturation === undefined ? 1 : o.saturation, o.tone);
  if (!o.vanilla && o.ldr) {
    if (!R.skyFS) { R.skyFS = new FullScreen(makeLdrSky(U)); R.skyFS.mesh.renderOrder = 1e6; }
    if (!R.blockClouds) R.blockClouds = new BlockClouds(detailedCloudMaterial(U));
    compile.push(R.skyFS.mesh.material, R.blockClouds.depth.material, R.blockClouds.colour.material);
  }
  let noise = null;
  const variants = [];
  if (!o.ldr) {
    if (!U.uNoise3.value) noise = noise3D(R);
    if (!R._post) { R._post = new Post(r, U, o); R._post.owner = R; }
    if (!R.blockCloudsHDR) R.blockCloudsHDR = new BlockClouds(detailedCloudMaterial(U, true));
    const P = R._post;
    compile.push(P.mCopy, P.mLin, P.mVL, P.mClouds, P.mComp, P.mDown, P.mUp, P.mLum, P.mExpo, P.mFinal, P.mFxaa, R.blockCloudsHDR.depth.material, R.blockCloudsHDR.colour.material);
    // (and any pass whose shader the new look changes, in its new form)
    for (const m of P.variants(o)) { variants.push(m); compile.push(m); }
  }
  const next = o.vanilla ? makeVanillaMaterials(U, o) : Object.assign(makeMaterials(U, o), { fluid: makeWaterMaterial(U, o) });
  const temps = variants.slice(), pairs = [];
  for (const k in next) if (next[k]) { temps.push(next[k]); compile.push(next[k]); }
  if (R.lookList) R.lookList = R.lookList.filter(e => {
    const m = e.ref.deref();
    if (!m) return false;
    const n = e.make(o);
    pairs.push([m, n]); temps.push(n); compile.push(n);
    return true;
  });
  return { next, pairs, temps, compile, noise };
}

/* The look takes over. prep: what prepare() made (a new shader), false (only
   numbers changed), or null (the first look, everything made here). */
function finishLook(R, look, first, prep) {
  const r = R.r, U = R.U;
  const o = R.opts = Object.assign(R.opts || {}, look);
  const rebuild = first || !!prep;
  R.lookKey = codeKey(o);
  const wasLdr = R.ldr;
  R.ldr = !!o.ldr;

  // the sun's shadow maps: a new pair when the size changes (token ones with no shadows; never more than the graphics card takes)
  const res = o.shadows ? Math.min(o.shadowRes || 2048, r.capabilities.maxTextureSize || 4096) : 4;
  if (!R.shadows || R.shadows.res !== res) {
    const old = R.shadows;
    R.shadows = new ShadowMaps(R, res);
    if (old) for (const t of old.maps.concat([old.body])) { t.depthTexture.dispose(); t.dispose(); }
    U.uShadow.value = R.shadows.texture; U.uShadowRes.value = res; U.uBodyShadow.value = R.shadows.body.depthTexture;
    R.shadowSlice = null;
  } else if (R.shadowDistWas !== o.shadowDist) R.shadows.S.dirty = true;     // reaching further or less far: drawn again
  R.shadowDistWas = o.shadowDist;
  U.uShadowSoft.value = o.shadowSoft || 1.6;
  /* how much of the sun a cloud overhead takes away (High and RIP): a third. It took four fifths, and
     with the sun a dozen times the sky's light, every field under a cloud went a murky dark olive
     beside fields in full sun, the land patched very dark and very bright at once */
  U.uCloudShadow.value = o.cloudShadow > 0 ? CLOUD_SHADE : 0;

  if (!o.vanilla) {
    // the atmosphere and what is worked out from it
    if (!R.sky) R.sky = new Sky(r);
    const S = R.sky;
    S.init();
    U.uAmbient.value = S.amb.texture; U.uView.value = S.view.texture; U.uTrans.value = S.trans.texture; U.uFogTab.value = S.fog.texture;
    const t = o.sunTint || SUN_TINT.natural;
    S.uniforms.uWarm.value.set(t[0], t[1], t[2]);
    S.uniforms.uSkyK.value = o.skyLight === undefined ? 1 : o.skyLight;
    S.uniforms.uSkySat.value = o.skySat === undefined ? 1 : o.skySat;
    S.uniforms.uExpBias.value = Math.pow(2, o.exposure || 0);
    // all of the table again next frame, so the new colours show at once
    if (R.skySun) R.skySun.set(0, -2, 0);
    /* the tone curve, with the contrast and saturation in it (no cost a pixel), refilled in
       place; only the light pipeline reads it (the full chain works the same out per pixel),
       so in the full chain it waits until the light one is back */
    const tk = (o.contrast || 1) + ',' + (o.saturation === undefined ? 1 : o.saturation) + ',' + (o.tone || 'agx');
    if (o.ldr && R.toneKey !== tk) { U.uToneLut.value = makeToneLut(o.contrast || 1, o.saturation === undefined ? 1 : o.saturation, o.tone, U.uToneLut.value); R.toneKey = tk; }
    if (!o.ldr && !U.uNoise3.value) noise3D(R);
  }
  U.uWave.value.set(o.wave ? o.wave[0] : 0, o.wave ? o.wave[1] : 0);
  U.uAO.value = o.ao === undefined ? 1 : o.ao;
  U.uFogMul.value = o.fog === undefined ? 1 : o.fog;

  // Shaders OFF: the lightmap, the game's sky and clouds (made once, kept)
  if (o.vanilla && !R._vanilla) R._vanilla = new Vanilla(R, R.textures);
  R.vanilla = o.vanilla ? R._vanilla : null;

  if (rebuild) {
    // every material, its new code into the same object
    const next = prep ? prep.next : o.vanilla ? makeVanillaMaterials(U, o) : Object.assign(makeMaterials(U, o), { fluid: makeWaterMaterial(U, o) });
    if (!R.mats) R.mats = next;
    else {
      for (const k in next) {
        if (!next[k]) continue;
        if (R.mats[k]) morph(R.mats[k], next[k]);
        else {
          // one this look has and the last did not: taken as it is, so it is no longer a stand-in to let go at the next change
          R.mats[k] = next[k];
          if (prep) prep.temps = prep.temps.filter(m => m !== next[k]);
        }
      }
      /* and one the last look had and this one does not goes: the near cut-out
         band of Off, Low and Medium (leaves and plants within 40 blocks) was
         left with the old look's code in High and RIP, so they were drawn
         with Off's lightmap or the light pipeline's tone curve in the full
         chain, and came out black at night or after a change of time */
      for (const k in R.mats) if (R.mats[k] && !next[k]) { R.mats[k].dispose(); R.mats[k] = null; }
    }
    // Improved Transparency: water and glass keep their depth, so the rain drawn again after them only shows in front
    if (o.improvedTransparency) for (const k of ['fluid', 'translucent']) if (R.mats[k]) R.mats[k].depthWrite = true;
    // the held block keeps the ordinary depth test its camera needs (render/held.js)
    if (R.held) for (const k of ['handOpaque', 'handCutout']) if (R.mats[k]) R.mats[k].depthFunc = THREE.LessEqualDepth;
    // the stand-ins the chunk meshes are drawn from (renderer.js makeStandIns)
    if (R.stands) for (const m of R.stands) if (m.parent) m.parent.remove(m);
    R.stands = [];
    R.makeStandIns();
    // and every material handed in by the rest of the game
    if (prep) {
      const done = new Set();
      for (const [m, n] of prep.pairs) { morph(m, n); done.add(m); }
      /* and one handed in while the new code was being built (a player joining, a world or a
         dimension's mobs, a first glint): made for the last look, since R.opts only changes here,
         so it kept the last look's code until the next change, the Off look's lightmap in the
         full chain and the like, which drew it black or glaring. It gets its new form now. */
      if (R.lookList) R.lookList = R.lookList.filter(e => { const m = e.ref.deref(); if (m && !done.has(m)) morph(m, e.make(o)); return !!m; });
    } else if (R.lookList && !first) R.lookList = R.lookList.filter(e => { const m = e.ref.deref(); if (m) morph(m, e.make(o)); return !!m; });
    /* The new materials the shaders were compiled for are kept until the next
       change of look: while they are, their programs stay in three.js's cache
       for the materials that took their code, however long until those are
       first drawn. The last look's are let go now. */
    if (R.lookTemps) for (const m of R.lookTemps) m.dispose();
    R.lookTemps = prep ? prep.temps : null;
  }

  // the light pipeline's sky (drawn as the scene's last solid thing) and its block clouds
  if (!o.vanilla && o.ldr && !R.skyFS) {
    R.skyFS = new FullScreen(makeLdrSky(U));
    R.skyFS.mesh.renderOrder = 1e6;
  }
  if (R.skyFS) {
    const want = !o.vanilla && o.ldr;
    if (want && R.skyFS.mesh.parent !== R.scene) R.scene.add(R.skyFS.mesh);
    if (!want && R.skyFS.mesh.parent === R.scene) R.scene.remove(R.skyFS.mesh);
  }
  if (!o.vanilla && o.ldr && !R.blockClouds) R.blockClouds = new BlockClouds(detailedCloudMaterial(U));
  if (!o.vanilla && !o.ldr && !R.blockCloudsHDR) R.blockCloudsHDR = new BlockClouds(detailedCloudMaterial(U, true));

  // the full chain
  if (!o.ldr) {
    if (!R._post) { R._post = new Post(r, U, o); R._post.owner = R; }
    // coming into the full chain from another look: its eye starts from this picture
    else if (wasLdr) R._post.resetExposure();
    R.post = R._post;
    R.post.configure(o);
  } else R.post = null;

  if (!first && rebuild) {
    R.locs = new Map();
    // (main.js's render scale leaves the next few seconds alone)
    R.lookAt = performance.now();
    /* The canvas and the full chain's pictures only when the pipeline itself
       changed: giving a canvas a size, even the one it has, throws its picture
       away and costs the graphics card a frame. */
    if (R.ldr !== wasLdr || (!R.ldr && !R.main)) R.resize(R.cw, R.ch);
    if (R.shadows) R.shadows.S.dirty = true;
  }
  if (R.lookFns) for (const fn of R.lookFns) { try { fn(o, rebuild); } catch (e) { console.error(e); } }
  return rebuild;
}

/* The full-screen passes the look on screen draws with (the atmosphere's
   tables, its sky, the ripples, the table of what each texture is made of,
   the full chain's passes), for the renderer to build ahead with everything
   else (renderer.js warmUp): built where they were first drawn, each held
   one of the title's first frames, a tenth of a second and more. */
export function passMaterials(R) {
  const o = R.opts || {}, U = R.U, out = [];
  if (o.vanilla) return out;
  if (R.sky) out.push(...R.sky.materials);
  if (R.inter && R.inter.m) out.push(R.inter.m);
  if (o.ldr && !R.layerMatDone && !R.layerMatMat) R.layerMatMat = layerMatMaterial(U.uSpecMap.value, U.uLayerInfo.value);
  if (R.layerMatMat) out.push(R.layerMatMat);
  if (o.ldr && R.skyFS) out.push(R.skyFS.mesh.material);
  if (!o.ldr && R._post) { const P = R._post; out.push(P.mCopy, P.mLin, P.mVL, P.mClouds, P.mComp, P.mDown, P.mUp, P.mLum, P.mExpo, P.mFinal, P.mFxaa); }
  return out.filter(m => m && m.isMaterial);
}

// a material made for each look (see the top): built now for this one, and again for each new one
export function looked(R, make) {
  const m = make(R.opts);
  (R.lookList || (R.lookList = [])).push({ ref: new WeakRef(m), make });
  return m;
}

/* ---- normal maps, fetched the first time they are wanted ----
   (a third of the textures' download, so only for the full chain with
   Normal Maps on). Every layer starts flat (items, the other dimensions'
   art, a resource pack's textures), then the blocks' maps go in. */
export async function loadNormalMaps(R, url, layersOfBlocks) {
  if (R.normalsLoaded || R.normalsLoading) return R.normalsLoading;
  R.normalsLoading = (async () => {
    const buf = await (await fetch(url)).arrayBuffer();
    const layers = R.U.uAlbedo.value.image.depth;
    // every size of every layer, worked out in a worker (normalSizes), then handed over a size a frame
    const sizes = await inWorker(buf, layers, layersOfBlocks, R.skipNormalLayers ? Array.from(R.skipNormalLayers) : null);
    const t = new THREE.DataArrayTexture(null, 16, 16, layers);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    // (room for the five sizes, none of them made by three.js: it would make them from the empty texture)
    t.generateMipmaps = false; t.mipmaps = sizes.map(() => ({})); t.anisotropy = 8;
    t.source.dataReady = false;
    t.needsUpdate = true;
    const r = R.r, gl = r.getContext();
    r.initTexture(t);
    const glTex = r.properties.get(t).__webglTexture;
    for (let lv = 0, s = 16; lv < sizes.length; lv++, s >>= 1) {
      await new Promise(res => requestAnimationFrame(res));
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, lv, 0, 0, 0, s, s, layers, gl.RGBA, gl.UNSIGNED_BYTE, sizes[lv]);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      r.resetState();
    }
    R.U.uNormalMap.value = t;
    R.normalsLoaded = true;
  })().catch(e => { console.warn('normal maps', e); R.normalsLoading = null; });
  return R.normalsLoading;
}
// normalSizes in a worker of its own (here in this thread if there are no workers to be had)
function inWorker(buf, layers, layersOfBlocks, skip) {
  return new Promise((resolve, reject) => {
    let w;
    try {
      const src = normalSizes.toString() + '\nonmessage = e => normalSizes(...e.data).then(s => postMessage(s, s.map(a => a.buffer)), err => postMessage(String(err)));';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      w = new Worker(url);
      URL.revokeObjectURL(url);
    } catch (e) { normalSizes(buf, layers, layersOfBlocks, skip).then(resolve, reject); return; }
    w.onmessage = e => { w.terminate(); if (Array.isArray(e.data)) resolve(e.data); else reject(new Error(e.data)); };
    w.onerror = () => { w.terminate(); normalSizes(buf, layers, layersOfBlocks, skip).then(resolve, reject); };
    w.postMessage([buf, layers, layersOfBlocks, skip]);
  });
}

/* The PNG decoded here rather than by the browser, and every size of every
   layer worked out from it (16 down to 1 texel a side). The height is kept
   in alpha, which a 2D canvas premultiplies away (the normal of every low
   pixel wiped out: black specks over stone and sand), and an ImageBitmap,
   which keeps it, has no way to read its pixels back; so the smaller sizes
   were made by the graphics card, generateMipmap over nineteen hundred
   layers after it had cleared the lot, a tenth to a sixth of a second of its
   time in one frame. Only what build_textures.py writes: 8 bits a channel,
   RGBA, not interlaced. Each texel of a smaller size is the average of four
   of the size above it, rounded, as generateMipmap makes them; layers past
   the blocks' (and any a resource pack replaced: its pictures' bumps were
   made for ours) are flat. (Self-contained: it is run in a worker from its
   own source.) */
async function normalSizes(buf, layers, layersOfBlocks, skip) {
  const d = new Uint8Array(buf), dv = new DataView(buf), idat = [];
  let i = 8, w = 0, h = 0;
  while (i + 8 <= d.length) {
    const n = dv.getUint32(i), type = String.fromCharCode(d[i + 4], d[i + 5], d[i + 6], d[i + 7]);
    if (type === 'IHDR') {
      w = dv.getUint32(i + 8); h = dv.getUint32(i + 12);
      if (w !== 16 || d[i + 16] !== 8 || d[i + 17] !== 6 || d[i + 20] !== 0) throw new Error('normal maps: not a 16 wide 8-bit RGBA PNG');
    } else if (type === 'IDAT') idat.push(d.subarray(i + 8, i + 8 + n));
    else if (type === 'IEND') break;
    i += 12 + n;
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = w * 4;
  if (raw.length < (stride + 1) * h) throw new Error('normal maps: PNG cut short');
  const blockLayers = Math.min(layersOfBlocks, h / 16 | 0, layers);
  // the blocks' rows unfiltered straight into the first size; the rest of it flat
  const top = new Uint8Array(16 * 16 * 4 * layers);
  new Uint32Array(top.buffer, blockLayers * 1024).fill(new Uint32Array(new Uint8Array([128, 128, 255, 255]).buffer)[0]);
  for (let y = 0; y < blockLayers * 16; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride, up = o - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? top[o + x - 4] : 0, b = y > 0 ? top[up + x] : 0, c = x >= 4 && y > 0 ? top[up + x - 4] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      top[o + x] = v;      // (kept to a byte by the array, as the filters want)
    }
  }
  if (skip) for (const l of skip) if (l < blockLayers) for (let k = l * 1024; k < (l + 1) * 1024; k += 4) { top[k] = 128; top[k + 1] = 128; top[k + 2] = 255; top[k + 3] = 255; }
  const sizes = [top];
  for (let s = 8; s >= 1; s >>= 1) {
    const up = sizes[sizes.length - 1], u = s * 2, a = new Uint8Array(s * s * 4 * layers);
    for (let z = 0; z < layers; z++) {
      const ub = z * u * u * 4, ab = z * s * s * 4;
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) for (let c = 0; c < 4; c++) {
        const p = ub + ((2 * y) * u + 2 * x) * 4 + c;
        a[ab + (y * s + x) * 4 + c] = (up[p] + up[p + 4] + up[p + u * 4] + up[p + u * 4 + 4] + 2) >> 2;
      }
    }
    sizes.push(a);
  }
  return sizes;
}

/* ---- texture filtering and mipmaps (Video Settings) ----
   On the texture arrays straight away: how many mip levels are used
   (Mipmap Levels, 0 = none) and the anisotropy (Anisotropic Filtering, when
   Texture Filtering is Anisotropic). RGSS is in the shaders instead. */
export function setFiltering(R, mipLevels, aniso) {
  const r = R.r, gl = r.getContext();
  const ext = r.extensions.get('EXT_texture_filter_anisotropic');
  /* (three.js asks the graphics card once and keeps the answer: asking it
     again waits for everything the card has still to do, which while a new
     look's shaders are being built was a sixth of a second) */
  const maxA = ext ? r.capabilities.getMaxAnisotropy() : 1;
  for (const t of [R.U.uAlbedo.value, R.U.uNormalMap.value, R.U.uSpecMap.value]) {
    if (!t || !t.image || !(t.image.depth > 1)) continue;
    const p = r.properties.get(t);
    if (!p || !p.__webglTexture) continue;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, p.__webglTexture);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, Math.max(0, Math.min(4, mipLevels)));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, mipLevels > 0 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    if (ext) gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.max(1, Math.min(maxA, aniso || 1)));
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  r.resetState();
}
