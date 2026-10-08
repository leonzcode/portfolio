/* ---------------------------------------------------------------------------
   Leoncraft 2 - how the other dimensions look in Detailed graphics.

   Fast graphics (render/vanilla.js) follows the game's own fog and lightmap
   rules; Detailed has no sun, moon, clouds or light shafts there, lights
   everything with a fixed ambient (the Nether's warm 0.1, the End's dim
   violet sky light) and fogs towards the biome's fog colour over the same
   distances Fast uses: the Nether's thick sphere (a twentieth of the view to
   half of it), the End's last tenth, a boss fight's thick fog.
--------------------------------------------------------------------------- */
import { nightVision, shutFog } from '../render/vanilla.js?v=33';
const THREE = window.THREE;
const lin = v => Math.pow(v / 255, 2.2);
const target = new THREE.Vector3();

export function dimLook(R, state, dt) {
  const U = R.U, D = state.dim;
  // Night Vision lifts the light floor (glsl.js lightFloor), Blindness and Darkness close a black fog in (glsl.js uShut), in every dimension
  if (U.uNightVision) U.uNightVision.value = nightVision(state);
  if (U.uShut) shutFog(state, dt, (R.opts.renderDist || 8) * 16, U.uShut.value);
  if (!D || D.id === 'overworld') { U.uDim.value = 0; if (R.post && R.post.u.uBias) R.post.u.uBias.value = 1; return; }
  U.uDim.value = D.code;
  // the eye adjusts less far in the dark there, so the Nether stays dim and the End's sky stays black
  if (R.post && R.post.u.uBias) R.post.u.uBias.value = D.id === 'the_nether' ? 0.4 : 0.7;
  if (D.id === 'the_nether') U.uDimAmb.value.set(0.34, 0.22, 0.18);
  else U.uDimAmb.value.set(0.62, 0.56, 0.72);
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
