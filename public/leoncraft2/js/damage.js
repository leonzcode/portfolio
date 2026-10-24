/* ---------------------------------------------------------------------------
   Leoncraft 2 - kinds of damage and the death messages they leave.

   Every hurt names a damage type, as the game's data does (Java Edition,
   26.x): how much exhaustion it costs when it gets through to health, whether
   difficulty scales it, and the tags that decide what stops it:

     armor        armour reduces it (and wears down by a quarter of it);
                  falling, drowning, starving, burning, suffocating, the
                  void, magic, wither and freezing go straight through
     effects      Resistance can reduce it (not starving)
     resistance   Resistance can reduce it (not the void or /kill)
     enchant      Protection enchantments can reduce it
     invul        creative mode and the hurt window do not stop it (the
                  void, /kill)
     fire / explosion / projectile / fall / freezing / drowning / lightning
                  what Fire, Blast, Projectile Protection and Feather
                  Falling, Fire Resistance and the game rules look for
     helmet       a falling block: a helmet takes a quarter off and wears

   Scaling: mob and projectile damage from a mob (not a player) is scaled by
   difficulty; explosions always are (Peaceful 0, Easy min(d/2 + 1, d),
   Hard 1.5 d).

   Death messages are the game's English ones (Minecraft Wiki, Death
   messages). A kill while a mob had hurt you in the last 5 seconds gets the
   "while trying to escape" form; a fall longer than 5 blocks says where it
   started (a ladder, vines, scaffolding) or "fell from a high place".
--------------------------------------------------------------------------- */
import { Account } from './net/account.js?v=107';

const D = (exh, msg, o) => Object.assign({ exh, msg, armor: true, effects: true, resistance: true, enchant: true, invul: false, scale: 'mob' }, o || {});
const PASS = { armor: false };

export const DAMAGE = {
  arrow: D(0.1, 'arrow', { projectile: true }),
  bad_respawn_point: D(0.1, 'badRespawnPoint', { explosion: true, scale: 'always', noKnock: true }),
  cactus: D(0.1, 'cactus', { noKnock: true }),
  campfire: D(0.1, 'inFire', { fire: true, noKnock: true }),
  cramming: D(0, 'cramming', Object.assign({ noKnock: true }, PASS)),
  dragon_breath: D(0, 'dragonBreath', Object.assign({ noKnock: true }, PASS)),
  drown: D(0, 'drown', Object.assign({ drowning: true, noKnock: true }, PASS)),
  dry_out: D(0.1, 'dryout', { noKnock: true }),
  ender_pearl: D(0, 'fall', Object.assign({ fall: true, noKnock: true }, PASS)),
  explosion: D(0.1, 'explosion', { explosion: true, scale: 'always', noKnock: true }),
  fall: D(0, 'fall', Object.assign({ fall: true, noKnock: true }, PASS)),
  falling_anvil: D(0.1, 'anvil', { helmet: true }),
  falling_block: D(0.1, 'fallingBlock', { helmet: true }),
  falling_stalactite: D(0.1, 'fallingStalactite', { helmet: true }),
  fireball: D(0.1, 'fireball', { fire: true, projectile: true }),
  fireworks: D(0.1, 'fireworks', { explosion: true }),
  fly_into_wall: D(0, 'flyIntoWall', Object.assign({ noKnock: true }, PASS)),
  freeze: D(0, 'freeze', Object.assign({ freezing: true, noKnock: true }, PASS)),
  generic: D(0, 'generic', Object.assign({ noKnock: true }, PASS)),
  generic_kill: D(0, 'genericKill', Object.assign({ resistance: false, invul: true, noKnock: true }, PASS)),
  hot_floor: D(0.1, 'hotFloor', { fire: true, noKnock: true }),
  in_fire: D(0.1, 'inFire', { fire: true, noKnock: true }),
  in_wall: D(0, 'inWall', Object.assign({ noKnock: true }, PASS)),
  indirect_magic: D(0, 'indirectMagic', PASS),
  lava: D(0.1, 'lava', { fire: true, noKnock: true }),
  lightning_bolt: D(0.1, 'lightningBolt', { lightning: true, noKnock: true }),
  mace_smash: D(0.1, 'mace_smash'),
  magic: D(0, 'magic', Object.assign({ noKnock: true }, PASS)),
  mob_attack: D(0.1, 'mob'),
  mob_attack_no_aggro: D(0.1, 'mob'),
  mob_projectile: D(0.1, 'mob', { projectile: true }),
  on_fire: D(0, 'onFire', Object.assign({ fire: true, noKnock: true }, PASS)),
  out_of_world: D(0, 'outOfWorld', Object.assign({ resistance: false, invul: true, noKnock: true }, PASS)),
  outside_border: D(0, 'outsideBorder', Object.assign({ noKnock: true }, PASS)),
  player_attack: D(0.1, 'player'),
  player_explosion: D(0.1, 'explosion.player', { explosion: true, scale: 'always', noKnock: true }),
  sonic_boom: D(0, 'sonic_boom', Object.assign({ enchant: false, scale: 'always' }, PASS)),
  spear: D(0.1, 'spear', { noKnock: true }),
  spit: D(0.1, 'mob'),
  stalagmite: D(0, 'stalagmite', Object.assign({ fall: true, noKnock: true }, PASS)),
  starve: D(0, 'starve', Object.assign({ effects: false, noKnock: true }, PASS)),
  sting: D(0.1, 'sting'),
  sweet_berry_bush: D(0.1, 'sweetBerryBush', { noKnock: true }),
  thorns: D(0.1, 'thorns'),
  thrown: D(0.1, 'thrown', { projectile: true }),
  trident: D(0.1, 'trident', { projectile: true }),
  unattributed_fireball: D(0.1, 'onFire', { fire: true, projectile: true }),
  wind_charge: D(0.1, 'mob', { projectile: true }),
  wither: D(0, 'wither', Object.assign({ noKnock: true }, PASS)),
  wither_skull: D(0.1, 'witherSkull', { projectile: true }),
};
// the names the rest of the game used before there were types
const ALIAS = {
  fire: 'in_fire', soul_fire: 'in_fire', burning: 'on_fire', magma: 'hot_floor', berry: 'sweet_berry_bush', void: 'out_of_world', kill: 'generic_kill',
  poison: 'magic', suffocation: 'in_wall', mob: 'mob_attack', player: 'player_attack', lightning: 'lightning_bolt', anvil: 'falling_anvil',
  dry: 'dry_out', respawn: 'bad_respawn_point', intentional: 'bad_respawn_point', projectile: 'mob_projectile', skull: 'wither_skull', head: 'mob_attack',
};
export function damageType(name) {
  const n = ALIAS[name] || name;
  return DAMAGE[n] ? n : 'generic';
}

/* A source as everyone else hands it in: a type name ('fall'), or an object
   { type, attacker, direct, x, z, ... } (js/entities). Comes back as one
   object with .type (the game's id) and .def (its row above). */
export function sourceOf(s) {
  const o = typeof s === 'string' || !s ? { type: s || 'generic' } : s;
  const type = damageType(o.type || (o.explosion ? 'explosion' : 'generic'));
  return { type, def: DAMAGE[type], attacker: o.attacker || null, direct: o.direct || null, x: o.x, z: o.z, raw: o };
}

// a mob's name as the death message shows it ("Zombie", "Cave Spider")
export function entityName(e) {
  if (!e) return '';
  // (you: your account's name, as in chat and on the death screen)
  if (e.isPlayer) return e.name || Account.name || 'Player';
  if (e.customName) return e.customName;
  const t = String(e.type || e.kind || 'entity').replace(/^minecraft:/, '');
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* ---- death messages: %1 is the player, %2 the one who did it ---- */
const MSG = {
  arrow: ['%1 was shot by %2', '%1 was shot by %2'],
  badRespawnPoint: ['%1 was killed by [Intentional Game Design]', '%1 was killed by [Intentional Game Design]'],
  cactus: ['%1 was pricked to death', '%1 walked into a cactus while trying to escape %2'],
  cramming: ['%1 was squished too much', '%1 was squashed by %2'],
  dragonBreath: ['%1 was roasted in dragon\'s breath', '%1 was roasted in dragon\'s breath by %2'],
  drown: ['%1 drowned', '%1 drowned while trying to escape %2'],
  dryout: ['%1 died from dehydration', '%1 died from dehydration while trying to escape %2'],
  explosion: ['%1 blew up', '%1 was blown up by %2'],
  'explosion.player': ['%1 was blown up by %2', '%1 was blown up by %2'],
  fall: ['%1 hit the ground too hard', '%1 hit the ground too hard while trying to escape %2'],
  anvil: ['%1 was squashed by a falling anvil', '%1 was squashed by a falling anvil while fighting %2'],
  fallingBlock: ['%1 was squashed by a falling block', '%1 was squashed by a falling block while fighting %2'],
  fallingStalactite: ['%1 was skewered by a falling stalactite', '%1 was skewered by a falling stalactite while fighting %2'],
  fireball: ['%1 was fireballed by %2', '%1 was fireballed by %2'],
  fireworks: ['%1 went off with a bang', '%1 went off with a bang while fighting %2'],
  flyIntoWall: ['%1 experienced kinetic energy', '%1 experienced kinetic energy while trying to escape %2'],
  freeze: ['%1 froze to death', '%1 was frozen to death by %2'],
  generic: ['%1 died', '%1 died because of %2'],
  genericKill: ['%1 was killed', '%1 was killed while fighting %2'],
  hotFloor: ['%1 discovered the floor was lava', '%1 walked into the danger zone due to %2'],
  inFire: ['%1 went up in flames', '%1 walked into fire while fighting %2'],
  inWall: ['%1 suffocated in a wall', '%1 suffocated in a wall while fighting %2'],
  indirectMagic: ['%1 was killed by %2 using magic', '%1 was killed by %2 using magic'],
  lava: ['%1 tried to swim in lava', '%1 tried to swim in lava to escape %2'],
  lightningBolt: ['%1 was struck by lightning', '%1 was struck by lightning while fighting %2'],
  mace_smash: ['%1 was smashed by %2', '%1 was smashed by %2'],
  magic: ['%1 was killed by magic', '%1 was killed by magic while trying to escape %2'],
  mob: ['%1 was slain by %2', '%1 was slain by %2'],
  onFire: ['%1 burned to death', '%1 was burned to a crisp while fighting %2'],
  outOfWorld: ['%1 fell out of the world', '%1 didn\'t want to live in the same world as %2'],
  outsideBorder: ['%1 left the confines of this world', '%1 left the confines of this world while fighting %2'],
  player: ['%1 was slain by %2', '%1 was slain by %2'],
  sonic_boom: ['%1 was obliterated by a sonically-charged shriek', '%1 was obliterated by a sonically-charged shriek while trying to escape %2'],
  spear: ['%1 was speared by %2', '%1 was speared by %2'],
  stalagmite: ['%1 was impaled on a stalagmite', '%1 was impaled on a stalagmite while fighting %2'],
  starve: ['%1 starved to death', '%1 starved to death while fighting %2'],
  sting: ['%1 was stung to death', '%1 was stung to death'],
  sweetBerryBush: ['%1 was poked to death by a sweet berry bush', '%1 was poked to death by a sweet berry bush while trying to escape %2'],
  thorns: ['%1 was killed while trying to hurt %2', '%1 was killed while trying to hurt %2'],
  thrown: ['%1 was pummeled by %2', '%1 was pummeled by %2'],
  trident: ['%1 was impaled by %2', '%1 was impaled by %2'],
  wither: ['%1 withered away', '%1 withered away while fighting %2'],
  witherSkull: ['%1 was shot by a skull from %2', '%1 was shot by a skull from %2'],
};
// where a long fall began (the climbable block you came off, or none)
const FELL = {
  ladder: '%1 fell off a ladder', vine: '%1 fell off some vines', weeping_vines: '%1 fell off some weeping vines',
  weeping_vines_plant: '%1 fell off some weeping vines', twisting_vines: '%1 fell off some twisting vines',
  twisting_vines_plant: '%1 fell off some twisting vines', scaffolding: '%1 fell off scaffolding', water: '%1 fell out of the water',
};

/* The message for a death. kill: the source of the last hit; fall: the
   longest fall in this fight ({ dist, from }) or null; killer: the mob that
   last hurt you within 5 seconds, or null. */
export function deathMessage(name, kill, fall, killer) {
  const k = killer ? entityName(killer) : '';
  const fill = t => t.replace('%1', name).replace('%2', k);
  const def = kill.def;
  // a mob's own hit names the mob even with nobody else around
  const direct = kill.attacker ? entityName(kill.attacker) : '';
  if (def.fall && fall && fall.dist > 5) {
    if (killer) return fill('%1 was doomed to fall by %2');
    const t = fall.from ? (FELL[fall.from] || '%1 fell while climbing') : '%1 fell from a high place';
    return fill(t);
  }
  const m = MSG[def.msg] || MSG.generic;
  if (direct && (def.msg === 'mob' || def.msg === 'player' || def.projectile || def.msg === 'explosion.player' || def.msg === 'thorns' || def.msg === 'indirectMagic' || def.msg === 'mace_smash' || def.msg === 'spear'))
    return m[1].replace('%1', name).replace('%2', direct);
  if (kill.type === 'explosion' && direct) return MSG.explosion[1].replace('%1', name).replace('%2', direct);
  if (killer && m[1].includes('%2')) return fill(m[1]);
  // a projectile or mob hit with no one to name falls back on the plain form
  if (def.msg === 'mob' || def.msg === 'player' || def.projectile) return fill(MSG.generic[0]);
  return fill(m[0]);
}
