/* ---------------------------------------------------------------------------
   Leoncraft 2 - weapons: what the item in your hand is worth in a fight.

   Numbers from the Minecraft Wiki (Java Edition 26.x): Sword, Axe, Tool,
   Trident, Mace, Spear, Attack cooldown, Damage, and the enchantment pages.

   Attack damage and attack speed are the item's own (items.js keeps the
   table the tooltip shows): a fist is 1 damage at 4 attacks a second, an
   item that is not a weapon or tool hits like a fist.
   The cooldown: full damage needs 20 / speed ticks since the last swing;
   earlier, the base damage is scaled by 0.2 + 0.8 p^2 and the enchantment
   bonus by p, where p = (ticks + 0.5) / (20 / speed), at most 1.
   Enchantment bonus: Sharpness 0.5 a level + 0.5, Smite 2.5 a level on the
   undead, Bane of Arthropods 2.5 a level on arthropods, Impaling 2.5 a
   level on water mobs (Java's rule). Strength adds 3 a level, Weakness
   takes 4 a level, to the base.
   Durability: a sword, trident, mace or spear wears 1 a hit, the other
   tools 2.
--------------------------------------------------------------------------- */
import { ITEMS } from '../items.js?v=107';

// the kinds of mob some enchantments care about, by entity type
export const UNDEAD = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'wither_skeleton', 'bogged', 'parched',
  'zombified_piglin', 'zoglin', 'phantom', 'wither', 'skeleton_horse', 'zombie_horse', 'zombie_nautilus', 'camel_husk']);
export const ARTHROPOD = new Set(['spider', 'cave_spider', 'bee', 'silverfish', 'endermite']);
export const AQUATIC = new Set(['axolotl', 'cod', 'dolphin', 'elder_guardian', 'glow_squid', 'guardian', 'pufferfish', 'salmon', 'squid',
  'tadpole', 'tropical_fish', 'turtle', 'nautilus']);

// spears, which items.js does not rate yet: [damage, speed] by material (the Spear page)
const SPEAR = { wooden: [1, 1.54], stone: [2, 1.33], copper: [2, 1.18], golden: [1, 1.05], iron: [3.5, 1.05], diamond: [4, 0.95], netherite: [5, 0.87] };

const FIST = { damage: 1, speed: 4, kind: '', name: '' };
const cache = new Map();
/* { damage, speed, kind, name } of an item id (0 for an empty hand). kind is
   sword, axe, pickaxe, shovel, hoe, spear, trident, mace or '' */
export function weaponOf(id) {
  if (!id) return FIST;
  let w = cache.get(id);
  if (w) return w;
  const it = ITEMS[id];
  const name = it ? it.name : '';
  let kind = '', damage = 1, speed = 4;
  if (it && it.tool && /^(sword|axe|pickaxe|shovel|hoe|spear)$/.test(it.tool.kind)) kind = it.tool.kind;
  else if (name === 'trident' || name === 'mace') kind = name;
  if (it && it.attack !== undefined) { damage = it.attack; speed = it.attackSpeed; }
  else if (kind === 'spear') { const s = SPEAR[it.tool.material] || SPEAR.wooden; damage = s[0]; speed = s[1]; }
  w = { damage, speed, kind, name };
  cache.set(id, w);
  return w;
}
export const enchOf = (s, name) => (s && s.ench && s.ench[name] ? s.ench[name] : 0);

// the extra damage the held item's enchantments do to this target (before the cooldown)
export function enchantBonus(stack, target) {
  if (!stack || !stack.ench) return 0;
  const e = stack.ench, type = target ? target.type : '';
  let b = 0;
  if (e.sharpness) b += 0.5 * e.sharpness + 0.5;
  if (e.smite && UNDEAD.has(type)) b += 2.5 * e.smite;
  if (e.bane_of_arthropods && ARTHROPOD.has(type)) b += 2.5 * e.bane_of_arthropods;
  if (e.impaling && AQUATIC.has(type)) b += 2.5 * e.impaling;
  return b;
}
// ticks for a full charge with this item
export const chargeTicks = id => 20 / weaponOf(id).speed;
// how much a hit wears the item
export function wearPerHit(id) {
  const k = weaponOf(id).kind;
  return k === 'sword' || k === 'trident' || k === 'mace' || k === 'spear' ? 1 : k ? 2 : 0;
}
/* The mace's smash: falling more than 1.5 blocks adds 4 a block for the
   first 3, 2 a block for the next 5 and 1 a block after that; Density adds
   0.5 a block a level. */
export function smashBonus(fall, density) {
  if (fall <= 1.5) return 0;
  const a = Math.min(fall, 3), b = Math.min(Math.max(fall - 3, 0), 5), c = Math.max(fall - 8, 0);
  return 4 * a + 2 * b + c + 0.5 * (density || 0) * fall;
}
// the game's armour formula, for mobs as for players (Breach takes 15 percentage points a level off what the armour stops)
export function afterArmor(dmg, armor, toughness, breach) {
  if (armor <= 0) return dmg;
  const f = Math.min(20, Math.max(armor / 5, armor - 4 * dmg / ((toughness || 0) + 8))) / 25;
  return dmg * (1 - Math.max(0, f - 0.15 * (breach || 0)));
}
