/* ---------------------------------------------------------------------------
   Leoncraft 2 - status effects: what each one is and how it shows.

   Names, colours and kinds are the game's (Java Edition 26.x). Beneficial
   effects go in the HUD's top row and show blue in tooltips; harmful and
   neutral ones go in the second row and show red. Instant effects (Instant
   Health, Instant Damage, Saturation) act once when given. The numbers that
   run them are in survival.js; movement reads Speed, Slowness, Jump Boost,
   Slow Falling, Levitation and Dolphin's Grace (player.js), mining reads
   Haste, Mining Fatigue and Conduit Power (mining.js).

     effect(name)            the row below, or null
     effectName(name, lv)    "Regeneration II"
     effectTime(ticks)       "0:45", "**:**" for infinite
     roman(n)                "IV" (Arabic past 10, as the game does)
--------------------------------------------------------------------------- */

const E = (colour, kind, display, o) => Object.assign({ colour, kind, display }, o || {});
// kind: 'good' (beneficial), 'bad' (harmful), 'neutral'
export const EFFECTS = {
  speed: E(0x33EBFF, 'good', 'Speed'),
  slowness: E(0x8BAFE0, 'bad', 'Slowness'),
  haste: E(0xD9C043, 'good', 'Haste'),
  mining_fatigue: E(0x4A4217, 'bad', 'Mining Fatigue'),
  strength: E(0xFFC700, 'good', 'Strength'),
  instant_health: E(0xF82423, 'good', 'Instant Health', { instant: true }),
  instant_damage: E(0xA9656A, 'bad', 'Instant Damage', { instant: true }),
  jump_boost: E(0xFDFF84, 'good', 'Jump Boost'),
  nausea: E(0x551D4A, 'bad', 'Nausea'),
  regeneration: E(0xCD5CAB, 'good', 'Regeneration'),
  resistance: E(0x9146F0, 'good', 'Resistance'),
  fire_resistance: E(0xFF9900, 'good', 'Fire Resistance'),
  water_breathing: E(0x98DAC0, 'good', 'Water Breathing'),
  invisibility: E(0xF6F6F6, 'good', 'Invisibility'),
  blindness: E(0x1F1F23, 'bad', 'Blindness'),
  night_vision: E(0xC2FF66, 'good', 'Night Vision'),
  hunger: E(0x587653, 'bad', 'Hunger'),
  weakness: E(0x484D48, 'bad', 'Weakness'),
  poison: E(0x87A363, 'bad', 'Poison'),
  wither: E(0x736156, 'bad', 'Wither'),
  health_boost: E(0xF87D23, 'good', 'Health Boost'),
  absorption: E(0x2552A5, 'good', 'Absorption'),
  saturation: E(0xF82423, 'good', 'Saturation', { instant: true }),
  glowing: E(0x94A061, 'neutral', 'Glowing'),
  levitation: E(0xCEFFFF, 'bad', 'Levitation'),
  luck: E(0x59C106, 'good', 'Luck'),
  unluck: E(0xC0A44D, 'bad', 'Bad Luck'),
  slow_falling: E(0xF3CFB9, 'good', 'Slow Falling'),
  conduit_power: E(0x1DC2D1, 'good', 'Conduit Power'),
  dolphins_grace: E(0x88A3BE, 'good', 'Dolphin\'s Grace'),
  bad_omen: E(0x0B6138, 'neutral', 'Bad Omen'),
  hero_of_the_village: E(0x44FF44, 'good', 'Hero of the Village'),
  darkness: E(0x292721, 'bad', 'Darkness'),
  trial_omen: E(0x16A6A6, 'neutral', 'Trial Omen'),
  raid_omen: E(0xDE4058, 'neutral', 'Raid Omen'),
  wind_charged: E(0xBDC9FF, 'bad', 'Wind Charged'),
  weaving: E(0x78695A, 'bad', 'Weaving'),
  oozing: E(0x99FFA3, 'bad', 'Oozing'),
  infested: E(0x8C9B8C, 'bad', 'Infested'),
};
// where each effect's picture is in the classic sheet (container/inventory, 18 x 18 from 0, 198, eight to a row)
export const EFFECT_ICON = {
  speed: 0, slowness: 1, haste: 2, mining_fatigue: 3, strength: 4, weakness: 5, poison: 6, regeneration: 7,
  invisibility: 8, hunger: 9, jump_boost: 10, nausea: 11, night_vision: 12, blindness: 13, resistance: 14, fire_resistance: 15,
  water_breathing: 16, wither: 17, absorption: 18, levitation: 19, glowing: 20, luck: 21, unluck: 22, health_boost: 23,
  // the effects that came later, with the nearest of those
  slow_falling: 19, conduit_power: 16, dolphins_grace: 0, bad_omen: 22, raid_omen: 22, trial_omen: 22, hero_of_the_village: 21,
  darkness: 13, wind_charged: 10, weaving: 1, oozing: 6, infested: 9,
};
// the old names commands and items still use
const ALIAS = { jump: 'jump_boost', instant_heal: 'instant_health', harm: 'instant_damage', heal: 'instant_health', confusion: 'nausea', bad_luck: 'unluck' };
export function effectId(name) {
  const n = String(name || '').replace(/^minecraft:/, '');
  return EFFECTS[n] ? n : ALIAS[n] && EFFECTS[ALIAS[n]] ? ALIAS[n] : null;
}
export const effect = name => EFFECTS[effectId(name)] || null;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = n => (n >= 1 && n <= 10 ? ROMAN[n] : String(n));
export function effectName(name, level) {
  const d = effect(name);
  const base = d ? d.display : String(name).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return level > 1 ? base + ' ' + roman(level) : base;
}
// m:ss, or **:** for an effect that never ends
export function effectTime(ticks) {
  if (ticks < 0 || ticks === Infinity) return '**:**';
  const s = Math.floor(ticks / 20), m = Math.floor(s / 60);
  if (m >= 60) return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  return m + ':' + String(s % 60).padStart(2, '0');
}
