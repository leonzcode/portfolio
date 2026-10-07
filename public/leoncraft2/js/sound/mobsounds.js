/* ---------------------------------------------------------------------------
   Leoncraft 2 - mobs' voices and footsteps, and what flies and lands.

   Looked after once a tick from outside the mobs' own code, by what each
   one is doing, as the game makes the sounds:

     ambient   each tick a 1 in 1000 chance that grows by one a tick, starting
               80 ticks after the last (so a mob speaks every 6 seconds or
               so); a hurt puts it back to the start
     hurt      on a full hit (one inside the half second after another adds
               only its extra damage, and no sound); a hit that kills plays
               the death sound instead
     step      every 1/0.6 blocks walked on the ground: the mob's own step
               sound (volume 0.15) or the block's
     voice     pitch 1 +- 0.2 (1.5 for a baby), the mob's volume (1; a ghast
               5, a slime 0.4 a size), hostile ones on Hostile Mobs, the
               rest on Friendly Mobs
   Sounds are named by the mob's id: entity.<id>.ambient and so on. With the
   player's own Minecraft sounds every mob has its own; Leoncraft's sounds
   give the common ones theirs, and the rest a hurt and a death.

   Arrows: a mob's arrow leaving its bow plays the mob's shoot sound, and
   any arrow sticking in a block plays entity.arrow.hit.
--------------------------------------------------------------------------- */
import { Sound } from './sound.js?v=22';
import { blockSound, voice } from './sfx.js?v=22';

const R = Math.random;
const ANGRY = { wolf: 'growl', enderman: 'scream', piglin: 'angry', zombified_piglin: 'angry', polar_bear: 'warning', bee: null };
const QUIET = { creeper: 1, slime: 1, magma_cube: 1, iron_golem: 1, xp_orb: 1, bat: 0 };

export class MobSounds {
  constructor() { this.n = 0; }
  // the listener's position (sound.js), so far-off mobs cost nothing
  tick(E, at) {
    if (!E || !E.list) return;
    this.n++;
    for (const e of E.list) {
      if (e.removed) continue;
      let s = e._snd;
      if (!s) s = e._snd = { amb: -80 + ((R() * 80) | 0), hurt: e.hurtTime | 0, dead: !!e.dead, md: 0, next: 1, stuck: !!e.stuck, new: true };
      const dx = e.pos.x - at.x, dy = e.pos.y - at.y, dz = e.pos.z - at.z, d2 = dx * dx + dy * dy + dz * dz;
      if (e.type === 'arrow' || e.type === 'spectral_arrow') { this.arrow(e, s); continue; }
      if (typeof e.health !== 'number' || !e.maxHealth) { s.new = false; continue; }
      const type = e.type, C = e.constructor, cat = C.HOSTILE ? 'hostile' : 'neutral';
      const vol = type === 'ghast' ? 5 : (type === 'slime' || type === 'magma_cube') ? 0.4 * (e.size || 1) : 1;
      const near = d2 < (16 * Math.max(1, vol) + 4) ** 2;
      const baby = !!(e.isBaby || e.baby);
      // hurt or killed
      const h = e.hurtTime | 0;
      if (e.dead && !s.dead) {
        s.dead = true;
        if (near) Sound.play('entity.' + type + '.death', e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, vol, voice(baby), cat);
      } else if (h > s.hurt && !e.dead) {
        if (near) Sound.play('entity.' + type + '.hurt', e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, vol, voice(baby), cat);
        s.amb = -80;
      }
      s.hurt = h;
      if (e.dead) continue;
      // speaking
      if (((R() * 1000) | 0) < s.amb++) {
        s.amb = -80;
        if (near && !QUIET[type]) {
          const a = e.target && ANGRY[type] ? ANGRY[type] : 'ambient';
          Sound.play('entity.' + type + '.' + a, e.pos.x, e.pos.y + e.h * 0.85, e.pos.z, vol, voice(baby), cat);
        }
      }
      // footsteps
      if (!near || !e.onGround) { s.md += 0; continue; }
      const mx = e.pos.x - e.prev.x, mz = e.pos.z - e.prev.z;
      s.md += Math.sqrt(mx * mx + mz * mz) * 0.6;
      if (s.md > s.next) {
        s.next = Math.floor(s.md) + 1;
        const own = 'entity.' + type + '.step';
        if (Sound.has(own)) Sound.play(own, e.pos.x, e.pos.y, e.pos.z, 0.15, 1, cat);
        else {
          const w = E.world || (E.t && E.t.w);
          const b = w ? w.get(Math.floor(e.pos.x), Math.floor(e.pos.y - 0.2), Math.floor(e.pos.z)) : 0;
          if (b) blockSound('step', b, e.pos.x, e.pos.y, e.pos.z);
        }
      }
    }
  }
  arrow(e, s) {
    if (s.new) {
      s.new = false;
      const o = e.owner;
      // (the player's own bow plays its sound where the bow is drawn: game.js)
      if (o && !o.isPlayer && o.type && e.age < 3) Sound.play('entity.' + o.type + '.shoot', o.pos.x, o.pos.y + 1.5, o.pos.z, 1, 1 / (R() * 0.4 + 0.8), o.constructor.HOSTILE ? 'hostile' : 'neutral');
    }
    if (e.stuck && !s.stuck) Sound.play('entity.arrow.hit', e.pos.x, e.pos.y, e.pos.z, 1, 1.2 / (R() * 0.2 + 0.9), 'neutral');
    s.stuck = !!e.stuck;
  }
}
