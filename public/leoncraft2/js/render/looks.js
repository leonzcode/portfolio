/* ---------------------------------------------------------------------------
   Leoncraft 2 - Shaders ON or OFF, and the shader's own settings, changed
   while you play.

   Shaders OFF is the game as it draws itself (render/vanilla.js). Shaders ON
   is our shader, in one of two pipelines: the light one (everything lit at
   the corners and drawn in one pass straight to the screen) or, when a part
   that needs the whole picture is on (bloom, light shafts, volumetric
   clouds, screen-space reflections, normal maps), the full chain
   (render/post.js) with the light worked out per pixel.

   The Shader Options screen (ui/video.js) edits a plain settings object
   (SHADER_DEFAULTS); lookOf() turns it into what the renderer needs, and
   applyLook() puts that into effect without reloading anything:

     - every material the world is drawn with keeps its identity (meshes all
       over the game hold on to them) and only takes the new shader code, so
       nothing has to find its material again; three.js builds the new
       programs the next time each is drawn
     - the parts only one look uses (the atmosphere tables, the Fast look's
       lightmap and sky, the post chain, the shadow maps) are made the first
       time they are wanted and kept, so switching back is quick
     - a part that is off is not drawn at all, and what it would cost is
       left out of the shaders (#defines), not just multiplied by zero

   Other modules hand in their materials through renderer.looked(make):
   make(opts) builds the material for a look, and is called again for each
   new one. renderer.onLook(fn) hears of every change.
--------------------------------------------------------------------------- */
import { Sky, FullScreen } from './sky.js?v=17';
import { Post } from './post.js?v=17';
import { makeMaterials } from './materials.js?v=17';
import { makeWaterMaterial } from './water.js?v=17';
import { makeNoise3DAsync, makeNoise3DGPU } from './noisetex.js?v=17';
import { makeLdrSky } from './ldrsky.js?v=17';
import { Vanilla, makeVanillaMaterials } from './vanilla.js?v=17';
import { BlockClouds, detailedCloudMaterial } from './clouds.js?v=17';
import { ShadowMaps } from './shadows.js?v=17';
import { makeToneLut } from './glsl.js?v=17';
const THREE = window.THREE;

/* ---- the shader's settings ----
   The defaults are the Medium preset, which is the look the game had before
   these settings existed. */
export const SHADER_DEFAULTS = {
  shadows: 'medium',         // off low medium high: how sharp the sun's shadow map is
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
  lightShafts: 'off',        // off low high
  ao: 1,                     // ambient occlusion strength, 0 - 1
  fog: 1,                    // 0 none - 2 thick
  exposure: 0,               // stops brighter or darker, -2 - 2
  contrast: 1,               // 0.5 - 1.5
  saturation: 1,             // 0 grey - 2
  clouds: 'blocks',          // blocks volumetric off (blocks follow Clouds in Video Settings)
  cloudShadows: false,
  normalMaps: false,
  heldLight: true,           // a torch in your hand lights what is round you
  antialiasing: 'off',       // off fxaa (the full chain only)
  tone: 'agx',               // agx aces reinhard: the tone curve from the scene's light to the screen
};
export const SHADER_PRESETS = {
  low: { shadows: 'off', wavingPlants: 'low', wavingLeaves: 'off', waves: 'off' },
  medium: {},
  high: { shadows: 'high', shadowDistance: 96, shadowSoftness: 0.6 },
  ultra: { shadows: 'high', shadowDistance: 128, shadowSoftness: 0.6, bloom: 'low', lightShafts: 'low', clouds: 'volumetric', cloudShadows: true,
    water: 'reflections', reflections: 'high', normalMaps: true },
};
export const SHADER_PRESET_NAMES = ['low', 'medium', 'high', 'ultra'];

// the settings in effect: a preset's, or the player's own (Custom)
export function shaderSettings(preset, own) {
  if (preset === 'custom') {
    const s = Object.assign({}, SHADER_DEFAULTS, own || {});
    // (Waves was ON or OFF before it had levels)
    if (s.waves === true) s.waves = 'high'; else if (s.waves === false) s.waves = 'off';
    return s;
  }
  return Object.assign({}, SHADER_DEFAULTS, SHADER_PRESETS[preset] || {});
}
// which preset these settings are (or 'custom')
export function presetOf(s) {
  for (const name of SHADER_PRESET_NAMES) {
    const p = shaderSettings(name);
    let same = true;
    for (const k in SHADER_DEFAULTS) if (p[k] !== s[k]) { same = false; break; }
    if (same) return name;
  }
  return 'custom';
}

const SHADOW_RES = { low: 512, medium: 1024, high: 2048 };
const WAVE = { off: 0, low: 0.5, high: 1 };
const SUN_TINT = { warm: [1.12, 0.97, 0.78], natural: [1.06, 1.0, 0.88], cool: [0.98, 1.0, 1.04] };

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
    shadowRes: SHADOW_RES[s.shadows] || 1024, shadowDist: s.shadowDistance,
    shadowSoft: 0.4 + 2.4 * s.shadowSoftness,
    normals: full && !!s.normalMaps,
    cloudShadow: s.cloudShadows ? 2 : 0,
    sky: full ? 1 : 16,
    uploadMs: 3, plantDist: 96, leafInDist: 48, plantShadows: false, leafInShadows: false,
    wind: plants + leaves > 0, wave: [plants, leaves],
    water: s.water === 'vanilla' ? 0 : 1, waves: s.waves === 'off' ? false : s.waves === 'low' ? 'low' : true,
    ssrSteps: s.water === 'reflections' ? (s.reflections === 'high' ? 28 : 12) : 0,
    bloom: s.bloom !== 'off', bloomMix: s.bloom === 'high' ? 0.08 : 0.045,
    // (High: finer, and the beams stronger, so the level shows)
    vlSteps: s.lightShafts === 'off' ? 0 : s.lightShafts === 'high' ? 20 : 10,
    vlStrength: s.lightShafts === 'high' ? 1.5 : 1,
    volumetric: s.clouds === 'volumetric', shaderClouds: s.clouds,
    fxaa: s.antialiasing === 'fxaa',
    ao: s.ao, fog: s.fog, exposure: s.exposure, contrast: s.contrast, saturation: s.saturation, tone: s.tone || 'agx',
    sunTint: tint.map(v => v * s.sunBrightness), skyLight: s.skyLight, skySat: s.skyColour, heldLight: !!s.heldLight,
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
  return [o.vanilla, o.ldr, o.shadows, o.normals, o.cloudShadow, o.wind, o.water, o.waves, o.ssrSteps, o.rgss, o.vlSteps > 0 ? o.vlSteps : 0, !!o.improvedTransparency].join(',');
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
  /* Handed to the graphics card a few at a time, a frame's share each: putting
     a program together (its source, then the calls that start it compiling)
     takes a few milliseconds in this thread, and the full chain's forty in one
     go cost the frame the setting was changed in a tenth of a second or more. */
  /* Each frame after that, the programs handed over are asked whether they
     are built yet, oldest first, stopping at the first that is not: every
     such question waits for the graphics process to catch up, so they are
     kept to a few a frame (three.js's own compileAsync asked all of them every
     ten milliseconds). One that is built is asked for its uniforms and
     attributes there and then, questions three.js would otherwise ask at its
     first draw, all of them in the frame the new look first shows. */
  const compiled = new Promise(res => {
    const list = prep.compile, building = [];
    let i = 0;
    const step = () => {
      if (R.lookToken !== token) return res();
      const t0 = performance.now();
      while (i < list.length && performance.now() - t0 < 5) {
        const scene = new THREE.Scene(), batch = list.slice(i, i + 3);
        for (const m of batch) scene.add(new THREE.Mesh(R.standGeo, m));
        i += 3;
        try { R.r.compile(scene, R.camera); for (const m of batch) building.push(m); } catch (e) { /* built when first drawn */ }
      }
      while (building.length && performance.now() - t0 < 8) {
        // (a material's program as it is now: one let go meanwhile is not asked about)
        const p = R.r.properties.get(building[0]).currentProgram;
        if (p && p.program) {
          if (!p.isReady()) break;
          try { p.getUniforms(); p.getAttributes(); } catch (e) { /* (three.js reports a shader that failed) */ }
        }
        building.shift();
      }
      if (i < list.length || building.length) requestAnimationFrame(step); else res();
    };
    step();
  });
  // (and the full chain's cloud noise, made in a worker the first time)
  Promise.all([compiled, prep.noise]).then(done, done);
  // a browser that cannot say when they are ready: after a while all the same
  setTimeout(done, 10000);
  return true;
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
  if (!o.vanilla && !R.sky) R.sky = new Sky(r);
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
    if (!R._post) R._post = new Post(r, U, o);
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

  // the sun's shadow maps: a new pair when the size changes (token ones with no shadows)
  const res = o.shadows ? o.shadowRes || 1024 : 4;
  if (!R.shadows || R.shadows.res !== res) {
    const old = R.shadows;
    R.shadows = new ShadowMaps(R, res);
    if (old) for (const t of old.maps.concat([old.body])) { t.depthTexture.dispose(); t.dispose(); }
    U.uShadow.value = R.shadows.texture; U.uShadowRes.value = res; U.uBodyShadow.value = R.shadows.body.depthTexture;
    R.shadowSlice = null;
  } else if (R.shadowDistWas !== o.shadowDist) R.shadows.S.dirty = true;     // reaching further or less far: drawn again
  R.shadowDistWas = o.shadowDist;
  U.uShadowSoft.value = o.shadowSoft || 1.6;
  U.uCloudShadow.value = o.cloudShadow > 0 ? 0.8 : 0;

  if (!o.vanilla) {
    // the atmosphere and what is worked out from it
    if (!R.sky) R.sky = new Sky(r);
    const S = R.sky;
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
    else for (const k in next) {
      if (!next[k]) continue;
      if (R.mats[k]) morph(R.mats[k], next[k]); else R.mats[k] = next[k];
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
    if (prep) for (const [m, n] of prep.pairs) morph(m, n);
    else if (R.lookList && !first) R.lookList = R.lookList.filter(e => { const m = e.ref.deref(); if (m) morph(m, e.make(o)); return !!m; });
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
    if (!R._post) R._post = new Post(r, U, o);
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
    const blob = await (await fetch(url)).blob();
    const RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
    const full = await createImageBitmap(blob, RAW);
    const layers = R.U.uAlbedo.value.image.depth, blockLayers = Math.min(layersOfBlocks, full.height / 16);
    /* Cut into pieces of 128 layers (no one upload over 2048 pixels tall) as
       bitmaps, decoded with nothing premultiplied, and handed to the graphics
       card as they are. (They went through a 2D canvas before, which keeps
       colour premultiplied by alpha: the height kept in alpha wiped out the
       normal of every low pixel, which then faced away from all light, black
       specks over stone and sand.) */
    const pieces = [];
    for (let z = 0; z < blockLayers; z += 128) {
      const n = Math.min(128, blockLayers - z);
      pieces.push([z, n, await createImageBitmap(full, 0, z * 16, 16, n * 16, RAW)]);
    }
    full.close && full.close();
    const t = new THREE.DataArrayTexture(null, 16, 16, layers);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 8;
    t.source.dataReady = false;
    t.needsUpdate = true;
    r_upload(R.r, t, pieces, layers, R.skipNormalLayers);
    R.U.uNormalMap.value = t;
    R.normalsLoaded = true;
  })().catch(e => { console.warn('normal maps', e); R.normalsLoading = null; });
  return R.normalsLoading;
}
function r_upload(r, t, pieces, layers, skip) {
  r.initTexture(t);
  const gl = r.getContext(), glTex = r.properties.get(t).__webglTexture;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  const N = 128, flat = new Uint8Array(16 * 16 * N * 4);
  for (let i = 0; i < flat.length; i += 4) { flat[i] = 128; flat[i + 1] = 128; flat[i + 2] = 255; flat[i + 3] = 255; }
  // every layer flat first (items, the other dimensions' art), then the blocks' own maps
  for (let z = 0; z < layers; z += N) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, z, 16, 16, Math.min(N, layers - z), gl.RGBA, gl.UNSIGNED_BYTE, flat);
  for (const [z, n, bmp] of pieces) { gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, z, 16, 16, n, gl.RGBA, gl.UNSIGNED_BYTE, bmp); bmp.close && bmp.close(); }
  // and flat again where a resource pack replaced the block's picture (its bumps were made for ours)
  if (skip) for (const l of skip) if (l < layers) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, l, 16, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, flat, 0);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  r.resetState();
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
