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
               sound or the block's
     voice     pitch 1 +- 0.2 (1.5 for a baby), at the mob's own volume (the
               Minecraft Wiki's sound tables: a cow 0.4, a bat 0.1, a ghast
               5...), hostile ones on Hostile Mobs, the rest on Friendly Mobs
   Sounds are named as the game names them: entity.<name>.ambient and so on,
   where a few mobs borrow another's (a cave spider is a spider to the ear, a
   mooshroom a cow) and some speak differently by what they are doing (a cat
   that is not tamed, an axolotl out of water, a villager trading).

   Arrows: a mob's arrow leaving its bow plays the mob's shoot sound, and
   any arrow sticking in a block plays entity.arrow.hit. A thrown trident
   hits a mob or the ground with its own sounds, and calls out as it starts
   back to a Loyalty thrower. A lead put on, tied to a fence, let go or
   snapping (past 10 blocks) is heard; bees buzz while they fly near.
--------------------------------------------------------------------------- */
import { Sound } from './sound.js?v=107';
import { blockSound, voice, spread } from './sfx.js?v=107';

const R = Math.random;
// the mobs that sound as another does (the game's own sounds.json has no events of their own)
const NAME = { cave_spider: 'spider', mooshroom: 'cow', trader_llama: 'llama', pufferfish: 'puffer_fish' };
// the game's volume for each mob's voice where it is not 1: one number, or [ambient, hurt, death]
const VOL = {
  bat: 0.1, bee: 0.4, cow: 0.4, mooshroom: 0.4, squid: 0.4, ghast: 5, ender_dragon: 5, warden: 4, drowned: 0.9,
  horse: 0.8, donkey: 0.8, mule: 0.8, skeleton_horse: 0.8, zombie_horse: 0.8, camel: 0.8,
  hoglin: [0.9, 0.8, 0.9], zoglin: [0.9, 0.9, 0.93], piglin_brute: [0.9, 0.64, 0.8], rabbit: [0.25, 0.5, 0.5],
  cat: [0.6, 0.65, 0.75], ocelot: [0.6, 0.45, 0.45], fox: [0.8, 0.75, 0.9], goat: [1, 0.65, 0.65], panda: [1, 0.82, 0.82],
  phantom: [0.8, 0.75, 1], turtle: [0.8, 1, 1], allay: [0.1, 0.32, 0.24], parrot: [0.7, 1, 1], guardian: [0.1, 1, 1],
};
// pitch multipliers, as the game's: [ambient, hurt, death]
const PITCH = { bat: [0.95, 0.95, 0.95], allay: [1, 1.5, 1], cat: [1, 1, 0.9], salmon: [1, 0.8, 0.8], tropical_fish: [1, 1, 0.8] };
// their own footsteps, and how loud (the rest step with the block's sound, or none)
const STEP = { iron_golem: 1, warden: 3, camel: 0.5, camel_husk: 0.5, strider: 0.25, piglin_brute: 0.1125 };
const STEP_OF = { zombified_piglin: 'zombie' };
// heard on the Hostile Mobs slider (the game's sound source), the rest on Friendly Mobs
const HOSTILE = new Set(('blaze bogged breeze cave_spider creaking creeper drowned elder_guardian ender_dragon enderman endermite evoker ghast guardian '
  + 'hoglin husk magma_cube parched phantom piglin piglin_brute pillager ravager shulker silverfish skeleton slime spider stray vex vindicator '
  + 'warden witch wither wither_skeleton zoglin zombie zombie_villager zombified_piglin').split(' '));
// what an angry one says instead of its usual
const ANGRY = { wolf: 'growl', enderman: 'scream', piglin: 'angry', piglin_brute: 'angry', zombified_piglin: 'angry', hoglin: 'angry', zoglin: 'angry', warden: 'angry' };

const part = (v, i) => typeof v === 'number' ? v : v ? v[i] : 1;

/* What a mob's kind sounds like, worked out once a mob (its type does not
   change): its event names, volume, pitch, slider and how far it is heard
   (16 blocks, further for a sound over volume 1). */
function kindOf(e) {
  const type = e.type, slime = type === 'slime' || type === 'magma_cube';
  const v = slime ? 0.4 * Math.max(0, (e.size | 0) - 1) : VOL[type];
  const reach = 16 * Math.max(1, typeof v === 'number' ? v : v ? Math.max(v[0], v[1], v[2]) : 1, STEP[type] || 0);
  const sr = 16 * Math.max(1, STEP[type] || 0);
  return {
    type, slime, v, reach2: reach * reach, name: 'entity.' + (NAME[type] || type) + '.', pitch: PITCH[type],
    cat: HOSTILE.has(type) || e.constructor.HOSTILE ? 'hostile' : 'neutral',
    step: 'entity.' + (STEP_OF[type] || NAME[type] || type) + '.step', stepR2: sr * sr,
    trades: e.vxp !== undefined || e.shakeT !== undefined,
  };
}

/* What a mob says when it speaks of its own accord (null: nothing), by the
   game's rules for the few that have more than one thing to say. */
function ambientOf(e, type) {
  switch (type) {
    case 'cat': return e.tamed ? (R() < 0.25 ? 'purreow' : 'ambient') : 'stray_ambient';
    case 'wolf': if (e.target) return 'growl'; return R() < 1 / 3 ? (e.tamed && e.health < e.maxHealth / 2 ? 'whine' : 'pant') : 'ambient';
    case 'allay': return e.equip && e.equip.mainhand ? 'ambient_with_item' : 'ambient_without_item';
    case 'axolotl': return e.inWater ? 'idle_water' : 'idle_air';
    case 'breeze': return e.onGround ? 'idle_ground' : 'idle_air';
    case 'dolphin': return e.inWater ? 'ambient_water' : 'ambient';
    case 'drowned': return e.inWater ? 'ambient_water' : 'ambient';
    case 'skeleton_horse': return e.inWater ? 'ambient_water' : 'ambient';
    case 'guardian': case 'elder_guardian': return e.inWater ? 'ambient' : 'ambient_land';
    case 'turtle': return e.inWater ? null : 'ambient_land';
    case 'polar_bear': return e.baby ? 'ambient_baby' : 'ambient';
    case 'sniffer': return 'idle';
    case 'fox': return e.sleeping ? 'sleep' : 'ambient';
    case 'villager': case 'wandering_trader': return e.sleeping ? null : e.customer ? 'trade' : 'ambient';
    // these say nothing unprompted
    case 'creeper': case 'slime': case 'magma_cube': case 'iron_golem': case 'copper_golem': case 'bee': case 'tadpole': case 'pufferfish': return null;
  }
  return e.target && ANGRY[type] ? ANGRY[type] : 'ambient';
}
// the hurt or death event, where being out of water or small changes it
function hurtOf(e, type, kind) {
  if (type === 'guardian' || type === 'elder_guardian') return e.inWater ? kind : kind + '_land';
  if (type === 'drowned') return e.inWater ? kind + '_water' : kind;
  if (type === 'turtle' && e.baby) return kind + '_baby';
  if ((type === 'slime' || type === 'magma_cube') && (e.size | 0) <= 1) return kind + '_small';
  return kind;
}

const BEE_LOOPS = 4, BEE_NEAR = 8;

export class MobSounds {
  constructor() { this.n = 0; this.bees = new Map(); this.warmed = new Set(); }
  reset() { for (const h of this.bees.values()) h.stop(); this.bees.clear(); }
  // at: the listener's position (sound.js), so far-off mobs cost nothing
  tick(E, at) {
    if (!E || !E.list) return;
    this.n++;
    if (this.bees.size) this.sweep();
    for (const e of E.list) {
      if (e.removed) continue;
      let s = e._snd;
      if (!s) s = e._snd = { amb: -80 + ((R() * 80) | 0), hurt: e.hurtTime | 0, dead: !!e.dead, md: 0, next: 1, stuck: !!e.stuck, new: true, ground: !!e.onGround, vxp: e.vxp | 0, shake: e.shakeT | 0, k: null };
      const dx = e.pos.x - at.x, dy = e.pos.y - at.y, dz = e.pos.z - at.z, d2 = dx * dx + dy * dy + dz * dz;
      if (e.type === 'arrow' || e.type === 'spectral_arrow') { this.arrow(e, s); continue; }
      if (e.type === 'trident') { this.trident(e, s); continue; }
      if (e.paddle && e.rowing) { if (d2 < 16 * 16) this.paddles(e); continue; }
      if (typeof e.health !== 'number' || !e.maxHealth) { s.new = false; continue; }
      // what its kind sounds like, worked out once
      const k = s.k || (s.k = kindOf(e));
      const type = k.type, name = k.name;
      // its kind's voices fetched as the first of them comes within 48 blocks (a bank of them, ready before it is heard)
      if (d2 < 2304 && !this.warmed.has(type)) { this.warmed.add(type); Sound.prefetch(name + 'hurt'); }
      const h = e.hurtTime | 0;
      // out of earshot: only what it was doing is kept, so nothing old is heard when it comes near
      if (d2 >= k.reach2) {
        if (h <= s.hurt || e.dead) s.hurt = h; else { s.hurt = h; s.amb = -80; }
        if (e.dead) s.dead = true;
        if (s.leash || e.leash) s.leash = e.leash ? (e.leash.knot ? 'k' : 'p') : '';
        s.vxp = e.vxp | 0; s.shake = e.shakeT | 0; s.ground = !!e.onGround;
        if (type === 'bee' && this.bees.has(e)) this.bee(e, d2);
        continue;
      }
      const v = k.v, P = k.pitch, cat = k.cat, slime = k.slime, baby = !!(e.isBaby || e.baby);
      // hurt or killed
      if (e.dead && !s.dead) {
        s.dead = true;
        Sound.play(name + hurtOf(e, type, 'death'), e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, part(v, 2), voice(baby) * part(P, 2) * (slime ? 0.8 : 1), cat);
      } else if (h > s.hurt && !e.dead) {
        Sound.play(name + hurtOf(e, type, 'hurt'), e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, part(v, 1), voice(baby) * part(P, 1) * (slime ? 0.8 : 1), cat);
        s.amb = -80;
      }
      s.hurt = h;
      if (e.leash || s.leash) this.lead(E, e, s);
      if (e.dead) continue;
      // speaking
      if (((R() * 1000) | 0) < s.amb++) {
        s.amb = -80;
        const a = ambientOf(e, type);
        if (a) Sound.play(name + a, e.pos.x, e.pos.y + e.h * 0.85, e.pos.z, part(v, 0), voice(baby) * part(P, 0), cat);
      }
      // a villager or a wandering trader: yes to a trade made, no to one it cannot make
      if (k.trades) {
        if ((e.vxp | 0) > s.vxp) Sound.play(name + 'yes', e.pos.x, e.pos.y + e.h * 0.85, e.pos.z, 1, voice(baby), cat);
        if ((e.shakeT | 0) > s.shake) Sound.play(name + 'no', e.pos.x, e.pos.y + e.h * 0.85, e.pos.z, 1, voice(baby), cat);
        s.vxp = e.vxp | 0; s.shake = e.shakeT | 0;
      }
      // a slime or magma cube: a squish as it lands, a smaller one for a small one (1 to 1.5 high)
      if (slime) {
        const small = (e.size | 0) <= 1;
        if (e.onGround && !s.ground && v > 0) Sound.play(name + (small ? 'squish_small' : 'squish'), e.pos.x, e.pos.y, e.pos.z, v, (spread() * 0.2 + 1) / 0.8, cat);
        if (!e.onGround && s.ground && e.vel && e.vel.y > 0.1 && v > 0) Sound.play(name + (small ? 'jump_small' : 'jump'), e.pos.x, e.pos.y, e.pos.z, v, (spread() * 0.2 + 1) * (small ? 1.4 : 0.8), cat);
        s.ground = !!e.onGround;
        continue;
      }
      if (type === 'bee') this.bee(e, d2);
      // footsteps
      if (!e.onGround) continue;
      const mx = e.pos.x - e.prev.x, mz = e.pos.z - e.prev.z;
      s.md += Math.sqrt(mx * mx + mz * mz) * 0.6;
      if (s.md > s.next) {
        s.next = Math.floor(s.md) + 1;
        if (d2 < k.stepR2 && Sound.has(k.step)) Sound.play(k.step, e.pos.x, e.pos.y, e.pos.z, STEP[type] || 0.15, 1, cat);
        else if (d2 < 256) {
          const w = E.world || (E.t && E.t.w);
          const b = w ? w.get(Math.floor(e.pos.x), Math.floor(e.pos.y - 0.2), Math.floor(e.pos.z)) : 0;
          if (b) blockSound('step', b, e.pos.x, e.pos.y, e.pos.z);
        }
      }
    }
  }
  /* Bees buzz while they fly: a held loop on each of the nearest few (an
     angry one's harder), following it, gone when it lands, dies or is out
     of earshot. */
  bee(e, d2) {
    let h = this.bees.get(e);
    const want = !e.dead && !e.removed && !e.onGround && d2 < BEE_NEAR * BEE_NEAR;
    if (!want) { if (h) { h.stop(); this.bees.delete(e); } return; }
    if (!h && this.bees.size < BEE_LOOPS) {
      h = Sound.loop(e.target ? 'entity.bee.loop_aggressive' : 'entity.bee.loop', 'neutral', { at: [e.pos.x, e.pos.y + 0.3, e.pos.z], volume: 0.7, pitch: e.baby ? 1.5 : 1 });
      if (h) this.bees.set(e, h);
    }
    if (h) h.pos(e.pos.x, e.pos.y + 0.3, e.pos.z);
  }
  // the bees' loops whose bee is gone from the world
  sweep() {
    for (const [e, h] of this.bees) if (e.removed || e.dead || h.stopped) { h.stop(); this.bees.delete(e); }
  }
  /* A lead: put on a mob, moved to a fence, let go, or snapping. */
  lead(E, e, s) {
    const L = e.leash, now = L ? (L.knot ? 'k' : 'p') : '';
    const was = s.leash || '';
    if (now !== was) {
      if (now === 'p' && !was) Sound.play('item.lead.tied', e.pos.x, e.pos.y + e.h * 0.6, e.pos.z, 1, 1, 'neutral');
      else if (now === 'k') Sound.play('item.lead.tied', L.knot[0] + 0.5, L.knot[1] + 0.5, L.knot[2] + 0.5, 1, 1, 'neutral');
      else if (!now) Sound.play((s.leashD || 0) > 9.5 ? 'item.lead.break' : 'item.lead.untied', e.pos.x, e.pos.y + e.h * 0.6, e.pos.z, 1, 1, 'neutral');
    }
    s.leash = now;
    if (L) {
      const P = E.P || (E.player && E.player.pos ? E.player : null);
      const hx = L.knot ? L.knot[0] + 0.5 : P ? P.pos.x : e.pos.x, hy = L.knot ? L.knot[1] + 0.6 : P ? P.pos.y + 1 : e.pos.y, hz = L.knot ? L.knot[2] + 0.5 : P ? P.pos.z : e.pos.z;
      s.leashD = Math.hypot(hx - e.pos.x, hy - (e.pos.y + e.h * 0.6), hz - e.pos.z);
    }
  }
  /* A thrown trident: into a mob, into the ground, and back to its thrower. */
  trident(e, s) {
    const cat = e.owner && e.owner.isPlayer ? 'player' : 'hostile';
    if (e.dealt && !s.dealt) Sound.play('item.trident.hit', e.pos.x, e.pos.y, e.pos.z, 1, 1, cat);
    else if (e.stuck && !s.stuck && !e.dealt) Sound.play('item.trident.hit_ground', e.pos.x, e.pos.y, e.pos.z, 1, 1.2 / (R() * 0.2 + 0.9), cat);
    if (e.returning && !s.returning) Sound.play('item.trident.return', e.pos.x, e.pos.y, e.pos.z, 10, 1, cat);
    s.dealt = !!e.dealt; s.stuck = !!e.stuck; s.returning = !!e.returning;
  }
  /* A boat's paddles: each dips with a splash (or a scrape on land) as it
     comes round past an eighth of a turn, on the side it is on, as the game
     plays it (volume 1, pitch 0.8-1.2). */
  paddles(e) {
    const TAU = Math.PI * 2, step = Math.PI / 8;
    for (let i = 0; i < 2; i++) {
      if (!e.rowing[i]) continue;
      const now = e.paddle[i], was = now - step;
      if (((was % TAU) + TAU) % TAU <= Math.PI / 4 && (((now % TAU) + TAU) % TAU) >= Math.PI / 4) {
        const ev = e.status === 3 ? 'entity.boat.paddle_land' : e.status === 0 ? 'entity.boat.paddle_water' : null;
        if (!ev) continue;
        const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
        const ox = i === 1 ? -fz : fz, oz = i === 1 ? fx : -fx;
        Sound.play(ev, e.pos.x + ox, e.pos.y, e.pos.z + oz, 1, 0.8 + 0.4 * R(), 'neutral');
      }
    }
  }
  arrow(e, s) {
    if (s.new) {
      s.new = false;
      const o = e.owner;
      // (the player's own bow plays its sound where the bow is drawn: game.js)
      if (o && !o.isPlayer && o.type && e.age < 3) Sound.play('entity.' + (NAME[o.type] || o.type) + '.shoot', o.pos.x, o.pos.y + 1.5, o.pos.z, 1, 1 / (R() * 0.4 + 0.8), HOSTILE.has(o.type) ? 'hostile' : 'neutral');
    }
    if (e.stuck && !s.stuck) Sound.play('entity.arrow.hit', e.pos.x, e.pos.y, e.pos.z, 1, 1.2 / (R() * 0.2 + 0.9), 'neutral');
    s.stuck = !!e.stuck;
  }
}
