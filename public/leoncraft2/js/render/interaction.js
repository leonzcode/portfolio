/* ---------------------------------------------------------------------------
   Leoncraft 2 - the interaction map: a 64 x 64 block square that follows the
   player, four texels a block, holding

     r, g   a water surface simulated with the wave equation (this step and
            the last), so wading, swimming and splashing send rings out
            across the water that spread, cross and die away
     b      how trampled the grass is: pressed flat where you walk, standing
            slowly back up over a few seconds

   It is stepped at a fixed 60 times a second, whatever the frame rate, and
   slid along with the player a whole texel at a time so nothing smears.
--------------------------------------------------------------------------- */
import { FullScreen, rawMat, floatTarget } from './sky.js?v=50';
const THREE = window.THREE;

const FS = /* glsl */`
uniform sampler2D uPrev;
uniform vec2 uShift;          // texels the map moved this step
uniform vec4 uSplash;         // world xz, strength, radius (blocks)
uniform vec4 uStep;           // world xz of the player's feet, trample strength, radius
uniform vec4 uRect;           // world xz of the corner, size
uniform float uDamp;
in vec2 vUv; out vec4 o;
vec4 at(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture(uPrev, uv);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(uPrev, 0));
  vec2 uv = vUv + uShift * px;
  vec4 c = at(uv);
  float n = at(uv + vec2(px.x, 0.0)).r + at(uv - vec2(px.x, 0.0)).r + at(uv + vec2(0.0, px.y)).r + at(uv - vec2(0.0, px.y)).r;
  // the wave equation, slowed to the speed of ripples on a pond (about 4 blocks a second)
  float h = (2.0 * c.r - c.g + 0.05 * (n - 4.0 * c.r)) * uDamp;
  vec2 world = uRect.xy + vUv * uRect.zw;
  float ds = length(world - uSplash.xy);
  if (uSplash.z != 0.0 && ds < uSplash.w) h += uSplash.z * (1.0 - ds / uSplash.w) * (1.0 - ds / uSplash.w);
  float tr = c.b * 0.9965;                // grass stands back up over a few seconds
  float dp = length(world - uStep.xy);
  if (uStep.z > 0.0 && dp < uStep.w) tr = max(tr, uStep.z * smoothstep(uStep.w, uStep.w * 0.35, dp));
  o = vec4(clamp(h, -2.0, 2.0), c.r, tr, 1.0);
}`;

export class Interaction {
  constructor(renderer, size) {
    this.r = renderer;
    this.size = size || 256; this.world = 64;
    this.t = [0, 1].map(() => floatTarget(this.size, this.size));
    this.i = 0;
    this.origin = new THREE.Vector2(0, 0);       // world xz of the map's corner
    this.acc = 0;
    this.u = {
      uPrev: { value: null }, uShift: { value: new THREE.Vector2() }, uSplash: { value: new THREE.Vector4() },
      uStep: { value: new THREE.Vector4() }, uRect: { value: new THREE.Vector4() }, uDamp: { value: 0.992 },
    };
    this.m = rawMat(FS, this.u);
    this.fs = new FullScreen(this.m);
    this.rect = new THREE.Vector4(0, 0, this.world, this.world);
    this.splashes = [];
  }
  get texture() { return this.t[this.i].texture; }
  splash(x, z, strength, radius) { this.splashes.push([x, z, strength, radius]); }
  update(dt, player, stepStrength) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const tpb = this.size / this.world;
    while (this.acc >= 1 / 60) {
      this.acc -= 1 / 60;
      // slide with the player, a whole texel at a time
      const want = new THREE.Vector2(player.x - this.world / 2, player.z - this.world / 2);
      const sx = Math.round((want.x - this.origin.x) * tpb), sz = Math.round((want.y - this.origin.y) * tpb);
      this.origin.x += sx / tpb; this.origin.y += sz / tpb;
      this.u.uShift.value.set(sx, sz);
      this.rect.set(this.origin.x, this.origin.y, this.world, this.world);
      this.u.uRect.value.copy(this.rect);
      const s = this.splashes.shift();
      if (s) this.u.uSplash.value.set(s[0], s[1], s[2], s[3]); else this.u.uSplash.value.set(0, 0, 0, 0);
      this.u.uStep.value.set(player.x, player.z, stepStrength, 0.55);
      this.u.uPrev.value = this.t[this.i].texture;
      this.fs.render(this.r, this.t[1 - this.i]);
      this.i = 1 - this.i;
    }
    this.splashes.length = Math.min(this.splashes.length, 4);
  }
}
