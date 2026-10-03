/* ---------------------------------------------------------------------------
   Leoncraft 2 - survival: health, hunger, air, and how long a block takes.

   Health and air work as in Minecraft: 20 health points (ten hearts), a
   fall of more than three blocks hurts a point a block, lava hurts, the void
   hurts, and 15 seconds of air under water before drowning starts. With a
   full hunger bar health comes back a point every four seconds. There is no
   food in this preview, so hunger stays full.

   Breaking by hand takes the block's hardness times 1.5 seconds, as the game
   does for blocks a hand can mine. The game makes stone and ores much slower
   without a pickaxe and drops nothing; there are no tools here yet, so every
   block is mined at the hand rate and drops itself (or what it turns into:
   stone gives cobblestone, grass gives dirt).
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from './blocks.js?v=4';

export class Survival {
  constructor() { this.reset(); }
  reset() {
    this.health = 20; this.food = 20; this.air = 300;
    this.fallFrom = null; this.regen = 0; this.burn = 0; this.voidT = 0;
    this.dead = false; this.hurtTime = 0; this.lastHealth = 20;
  }
  hurt(n) {
    if (this.dead || n <= 0) return;
    this.health = Math.max(0, this.health - n);
    this.hurtTime = 10;
    if (this.health <= 0) this.dead = true;
  }
  // once a tick (20 a second), in survival
  tick(player) {
    if (this.dead) return;
    this.lastHealth = this.health;
    if (this.hurtTime > 0) this.hurtTime--;
    const y = player.pos.y;
    // falling: the highest point since you left the ground
    if (player.onGround || player.inWater || player.flying) {
      if (this.fallFrom !== null && player.onGround && !player.inWater) {
        const fell = this.fallFrom - y;
        if (fell > 3) this.hurt(Math.ceil(fell - 3));
      }
      this.fallFrom = player.onGround || player.inWater ? null : this.fallFrom;
      if (player.inWater) this.fallFrom = null;
    } else this.fallFrom = this.fallFrom === null ? y : Math.max(this.fallFrom, y);
    // air
    if (player.eyeInWater) {
      this.air--;
      if (this.air <= -20) { this.air = 0; this.hurt(2); }
    } else this.air = Math.min(300, this.air + 4);
    // lava and the void
    if (player.inLava) { if (++this.burn % 10 === 1) this.hurt(4); } else this.burn = 0;
    if (y < -64 - 0) { if (++this.voidT % 10 === 1) this.hurt(4); } else this.voidT = 0;
    // getting better, with a full stomach
    if (this.food >= 18 && this.health < 20) { if (++this.regen >= 80) { this.regen = 0; this.health = Math.min(20, this.health + 1); } } else this.regen = 0;
  }
  stats() {
    return { health: this.health, food: this.food, air: Math.max(0, this.air), xp: 0, level: 0, armor: 0, hurt: this.hurtTime };
  }
  toJSON() { return { health: this.health, food: this.food, air: this.air }; }
  fromJSON(o) { if (!o) return; this.health = o.health ?? 20; this.food = o.food ?? 20; this.air = o.air ?? 300; this.dead = this.health <= 0; }
}

// seconds to break by hand; 0 is at once, Infinity never
export function breakTime(d) {
  if (!d || d.hardness === undefined) return 0.3;
  if (d.hardness < 0) return Infinity;
  if (d.hardness === 0) return 0;
  return Math.min(20, d.hardness * 1.5);
}

// what breaking a block gives you (0 for nothing)
const TURNS_INTO = {
  stone: 'cobblestone', grass_block: 'dirt', deepslate: 'cobbled_deepslate', podzol: 'dirt', mycelium: 'dirt',
  dirt_path: 'dirt', farmland: 'dirt', infested_stone: 'cobblestone', snow_block: 'snow_block', bookshelf: 'bookshelf',
};
const NOTHING = /(^|_)(glass|glass_pane|ice|leaves|short_grass|tall_grass|fern|large_fern|dead_bush|seagrass|tall_seagrass|kelp_plant|fire|soul_fire|budding_amethyst|spawner|infested_.*)$/;
export function dropOf(b) {
  const d = BLOCKS[b];
  if (!d) return 0;
  if (d.lower) return dropOf(B[d.lower]);
  let name = d.name;
  if (TURNS_INTO[name] && B[TURNS_INTO[name]] !== undefined) return B[TURNS_INTO[name]];
  if (NOTHING.test(name) || name === 'tall_grass_top_block' || name === 'packed_ice' && false) return 0;
  // the wall-hung ones give the item you placed
  const std = name.replace(/_wall_(torch|sign|hanging_sign|banner|head|skull|fan)$/, '_$1').replace(/^wall_torch$/, 'torch');
  if (std !== name && B[std] !== undefined) return B[std];
  if (FLUID[b] || d.item === false) return 0;
  return b;
}
