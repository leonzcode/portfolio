/* ---------------------------------------------------------------------------
   Leoncraft 2 - the End's flashes (26.x).

   As the game's changelog has them (Java 25w33a, 1.21.9): every thirty
   seconds the End's sky flashes, for between 5 and 19 seconds, and its sky
   light, which is otherwise off there, comes up and floods the dimension
   with purple light (its dimension type's sky light colour, #ac60cd). While
   the dragon's fog is on, the flash's source in the sky is hidden and its
   light is weaker. The rise and fall of each flash, where in the sky it is
   and how strong it gets are our own (the game's numbers are in its code,
   which we do not use).

   endFlash(seconds, bossFog, out) puts in out (a Vector4) the direction of
   the flash's source (zero when it is hidden) and in w how strong its light
   is now, 0 to 1. Every viewer works it out from the clock, so it needs no
   saving and no messages.
--------------------------------------------------------------------------- */
export const END_FLASH_COLOUR = [0xac / 255, 0x60 / 255, 0xcd / 255];
const PERIOD = 30;

// the same few numbers for the same flash every time
function hash(n, s) {
  let h = Math.imul(n | 0, 374761393) ^ Math.imul(s | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function endFlash(t, bossFog, out) {
  const slot = Math.floor(t / PERIOD), at = t - slot * PERIOD;
  const len = 5 + hash(slot, 1) * 14;
  let k = 0;
  if (at < len) {
    // up in about half a second, then a slow fade over its last two thirds, never a jump
    const up = Math.min(1, at / 0.5), down = Math.min(1, (len - at) / (len * 0.66));
    k = up * up * (3 - 2 * up) * down * down * (3 - 2 * down);
  }
  if (bossFog) k *= 0.5;
  if (k <= 0 || bossFog) { out.set(0, 0, 0, k); return out; }
  // anywhere round the sky, from a little over the horizon to high up
  const az = hash(slot, 2) * Math.PI * 2, el = 0.2 + hash(slot, 3) * 1.0;
  out.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el), k);
  return out;
}

/* The flash's source as the sky shaders draw it (our own: a soft violet glow
   with a bright middle, not the game's picture), for a view direction rd and
   uEndFlash; added to the sky in the screen's colours (Off and Low/Medium) or
   worked back through the eye (High and RIP: post.js). */
export const END_FLASH_GLSL = /* glsl */`
uniform vec4 uEndFlash;
vec3 endFlashSky(vec3 rd) {
  if (uEndFlash.w <= 0.0 || dot(uEndFlash.xyz, uEndFlash.xyz) < 0.5) return vec3(0.0);
  float a = acos(clamp(dot(rd, uEndFlash.xyz), -1.0, 1.0));
  float g = exp(-a * a / 0.004) * 0.9 + exp(-a / 0.14) * 0.35 + exp(-a / 0.45) * 0.08;
  return vec3(0.675, 0.376, 0.804) * g * uEndFlash.w;
}
`;
