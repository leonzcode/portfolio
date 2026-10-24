/* ---------------------------------------------------------------------------
   Leoncraft 2 - how the other dimensions look in Detailed graphics.

   Fast graphics (render/vanilla.js) follows the game's own fog and lightmap
   rules; Detailed has no sun, moon, clouds or light shafts there, lights
   everything with a fixed ambient (the Nether's warm 0.1, the End's dim
   violet sky light) and fogs towards the biome's fog colour over the same
   distances Fast uses: the Nether's thick sphere (a twentieth of the view to
   half of it), the End's last tenth, a boss fight's thick fog.
--------------------------------------------------------------------------- */
import { nightVision, shutFog } from '../render/vanilla.js?v=107';
const THREE = window.THREE;
const lin = v => Math.pow(v / 255, 2.2);
const target = new THREE.Vector3();
/* Fullbright in the shader looks: everything is lit up to this much light
   (glsl.js fullbrightFill: only what the sun or moon, the sky and torches
   leave is filled in), so a cave or the night is lit about as open ground is
   by day and day stays as it was; colours are not touched. One for the light
   pipeline (Low, Medium) and one for the full chain (High, RIP Computer),
   whose eye opens up in a cave: each measured so a stone floor in a dark cave
   comes out about as bright as one in the noon sun. The light pipeline's
   exposure is known here (sky.js uExpo): it opens up at night outdoors, so
   the light is scaled by the cave's exposure over it and the night comes out
   as the cave does. The full chain's eye starts from the same base, so its
   light is scaled the same way (what the screen shows only nudges it). Measured
   (a stone floor's mean grey): Low and Medium day 96, night 91, cave 100; High
   and RIP Computer day 119, night 119, cave 119. */
export const FULLBRIGHT_LIGHT = { ldr: 0.7, full: 1.35 };

export function dimLook(R, state, dt) {
  const U = R.U, D = state.dim;
  // Night Vision lifts the light floor (glsl.js lightFloor), Blindness and Darkness close a black fog in (glsl.js uShut), in every dimension
  if (U.uNightVision) U.uNightVision.value = nightVision(state);
  // Fullbright: everything lit up to a day's light (FULLBRIGHT_LIGHT)
  if (U.uFullbright) {
    let base = R.opts.ldr && U.uExpo ? U.uExpo.value : 0;
    /* the full chain's eye starts from the same base (post.js FS_EXPO: the sky table's exposure, eased
       over to uExposure in a cave, uExposure alone in the Nether and the End), so its light is scaled
       the same way; the table's numbers are kept read back here, as the light pipeline does (sky.js
       readLight: never waits for the graphics card) */
    if (!R.opts.ldr && R.opts.fullbright && R.sky && R.sky.light && U.uExposure && U.uCave) {
      if (R.sky.readLight) R.sky.readLight();
      const e = Math.max(1e-4, R.sky.light[24]), cave = U.uCave.value, ex = U.uExposure.value;
      base = D && D.id !== 'overworld' ? ex : cave > 0 ? Math.exp(Math.log(e) + (Math.log(ex) - Math.log(e)) * cave) : e;
    }
    const k = base > 0 && U.uExposure ? Math.min(4, Math.max(0.25, U.uExposure.value / base)) : 1;
    U.uFullbright.value = R.opts.fullbright ? FULLBRIGHT_LIGHT[R.opts.ldr ? 'ldr' : 'full'] * k : 0;
  }
  if (U.uShut) shutFog(state, dt, (R.opts.renderDist || 8) * 16, U.uShut.value);
  if (!D || D.id === 'overworld') { U.uDim.value = 0; return; }
  // (the eye there keeps the renderer's one level for each, as Low and Medium do: post.js FS_EXPO)
  U.uDim.value = D.code;
  if (D.id === 'the_nether') U.uDimAmb.value.set(0.34, 0.22, 0.18);
  else {
    // the End's dim sky light, and in a flash its sky light coming up in purple (render/endflash.js)
    const k = U.uEndFlash ? U.uEndFlash.value.w * 1.4 : 0;
    U.uDimAmb.value.set(0.62 + 0.42 * k, 0.56 + 0.12 * k, 0.72 + 0.62 * k);
  }
  const b = state.biome, c = b && b.fog !== undefined ? b.fog : 0x330808;
  target.set(lin(c >> 16), lin((c >> 8) & 255), lin(c & 255));
  if (D.id === 'the_end') target.multiplyScalar(0.15 * 0.15);
  const f = U.uDimFog.value;
  if (!R.dimFogSet || R.dimFogFor !== D.id) { f.copy(target); R.dimFogSet = true; R.dimFogFor = D.id; }
  else f.lerp(target, Math.min(1, dt * 2));
  const rd = (R.opts.renderDist || 8) * 16;
  if (D.foggy || state.bossFog) U.uDimFogRange.value.set(rd * 0.05, Math.min(rd, 192) * 0.5);
  else U.uDimFogRange.value.set(rd - Math.max(4, Math.min(64, rd / 10)), rd);
}
