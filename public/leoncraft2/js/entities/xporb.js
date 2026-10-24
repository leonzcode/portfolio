/* ---------------------------------------------------------------------------
   Leoncraft 2 - experience orbs.

   What a mob is worth comes out as orbs, split into the game's sizes (1, 3,
   7, 17, 37, 73, 149, 307...), tossed up a little. Each falls 0.03 a tick,
   and within 8 blocks of the player is drawn to them, harder the closer it
   is ((1 - distance / 8)^2 x 0.1 a tick). Touching the player it is picked
   up (one every two ticks) and its value goes to the game's experience
   (hooks.giveXp). Five minutes on the ground and it is gone.
--------------------------------------------------------------------------- */
import { Entity } from './entity.js?v=107';
import { register } from './mobs.js?v=107';

const SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
// how many of the game's orb picture's 16 pixels each of its eleven sizes of ball fills
const ORB_PX = [8, 10, 12, 12, 12, 14, 14, 14, 16, 16, 16];
export function splitXp(n) { for (const s of SIZES) if (n >= s) return s; return 1; }

export class XpOrb extends Entity {
  static W = 0.5; static H = 0.5; static STEP = 0; static PARTICLE = true; static NOT_PICKABLE = true; static NO_SAVE = false;
  constructor(m, type) { super(m, type); this.value = 1; this.life = 0; this.gravity = 0.03; }
  tick() {
    this.baseTick();
    const v = this.vel, p = this.pos, P = this.m.player;
    if (this.inWater) { v.y += 0.0002 + (v.y < 0.06 ? 0.005 : 0); v.multiplyScalar(0.99); }
    else v.y -= this.gravity;
    // drawn to the player
    if (P.alive() && this.age > 2) {
      const dx = (P.pos.x - p.x) / 8, dy = (P.pos.y + 0.81 - p.y) / 8, dz = (P.pos.z - p.z) / 8;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1) { const f = (1 - l) * (1 - l) * 0.1; v.x += dx / l * f; v.y += dy / l * f; v.z += dz / l * f; }
      // picked up
      if (Math.abs(P.pos.x - p.x) < 0.55 && Math.abs(P.pos.z - p.z) < 0.55 && p.y > P.pos.y - 0.5 && p.y < P.pos.y + 1.8 && this.m.takeOrb(this)) { this.remove(); return; }
    }
    this.move(v.x, v.y, v.z);
    const f = this.onGround ? this.m.t.slip(Math.floor(p.x), Math.floor(p.y - 0.5), Math.floor(p.z)) * 0.98 : 0.98;
    v.x *= f; v.z *= f; v.y *= 0.98;
    if (this.onGround) v.y *= -0.9;
    if (++this.life >= 6000) this.remove();
  }
  /* drawn as a bright, pulsing ball in the particle pass, as the game's: a
     square 0.3 of a block across, 0.1 up, at half opacity, the ball in it 8 to
     16 of its 16 pixels across by the orb's worth (the game's eleven sizes) */
  particle(M, a, x, y, z) {
    const t = (this.age + a) / 2;
    const r = (Math.sin(t) + 1) * 0.5, g = 1, b = (Math.sin(t + 4.19) + 1) * 0.1;
    const v = this.value, icon = v >= 2477 ? 10 : v >= 1237 ? 9 : v >= 617 ? 8 : v >= 307 ? 7 : v >= 149 ? 6 : v >= 73 ? 5 : v >= 37 ? 4 : v >= 17 ? 3 : v >= 7 ? 2 : v >= 3 ? 1 : 0;
    // our ball (frame 23 of the sheet) is 9.2 of its frame's 16 pixels across
    const size = 0.3 * ORB_PX[icon] / 16 / (9.2 / 16);
    M.particle(x, y + 0.1, z, size, r, g, b, 0.5, 23, 1, 0);
  }
  toJSON() { const o = super.toJSON(); o.xv = this.value; o.l = this.life; return o; }
  fromJSON(o) { super.fromJSON(o); this.value = o.xv || 1; this.life = o.l || 0; }
}
register('xp_orb', XpOrb);
