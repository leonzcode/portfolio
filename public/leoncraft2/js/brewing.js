/* ---------------------------------------------------------------------------
   Leoncraft 2 - potions and brewing.

   A potion is a stack of potion, splash_potion or lingering_potion with a
   `potion` name (water, awkward, swiftness, long_swiftness, strong_swiftness...).
   Effects, times and colours are the Minecraft Wiki's (Potion, Brewing; Java
   Edition): a brewing stand takes 400 ticks a brew, a blaze powder fuels 20
   brews, and the ingredient changes each bottle below it that it can:

     water + nether wart -> awkward (redstone -> mundane, glowstone -> thick,
             fermented spider eye -> weakness; every effect ingredient but
             the golden carrot, pufferfish, turtle shell and phantom
             membrane -> mundane)
     awkward + golden carrot night vision, rabbit's foot leaping, magma cream
             fire resistance, sugar swiftness, pufferfish water breathing,
             glistering melon healing, spider eye poison, ghast tear
             regeneration, blaze powder strength, turtle shell turtle master,
             phantom membrane slow falling, breeze rod wind charging, cobweb
             weaving, slime block oozing, stone infestation
     fermented spider eye turns night vision to invisibility, swiftness and
             leaping to slowness (not the enhanced ones), healing and poison
             to harming, keeping redstone or glowstone where the new one has it
     redstone makes it last longer, glowstone stronger, gunpowder makes it
     a splash potion, dragon's breath a lingering one (and leaves its bottle).

   Thrown: a splash potion gives its effects to everything within 4 blocks of
   where it breaks, less the further off; a lingering one leaves a cloud
   (entities/mobfx.js). A tipped arrow gives an eighth of each effect.
--------------------------------------------------------------------------- */
import { I, ITEMS } from './items.js?v=107';
import { EFFECTS, effectName } from './effects.js?v=107';

const S = s => Math.round(s * 20);
// name -> { effects: [[effect, level, ticks]], colour (0xRRGGBB) }
export const POTIONS = {
  water: { effects: [], colour: 0x385DC6 }, mundane: { effects: [], colour: 0x385DC6 }, thick: { effects: [], colour: 0x385DC6 },
  awkward: { effects: [], colour: 0x385DC6 },
  night_vision: { effects: [['night_vision', 1, S(180)]], colour: 0xC2FF66 }, long_night_vision: { effects: [['night_vision', 1, S(480)]], colour: 0xC2FF66 },
  invisibility: { effects: [['invisibility', 1, S(180)]], colour: 0xF6F6F6 }, long_invisibility: { effects: [['invisibility', 1, S(480)]], colour: 0xF6F6F6 },
  leaping: { effects: [['jump_boost', 1, S(180)]], colour: 0xFDFF84 }, long_leaping: { effects: [['jump_boost', 1, S(480)]], colour: 0xFDFF84 },
  strong_leaping: { effects: [['jump_boost', 2, S(90)]], colour: 0xFDFF84 },
  fire_resistance: { effects: [['fire_resistance', 1, S(180)]], colour: 0xFF9900 }, long_fire_resistance: { effects: [['fire_resistance', 1, S(480)]], colour: 0xFF9900 },
  swiftness: { effects: [['speed', 1, S(180)]], colour: 0x33EBFF }, long_swiftness: { effects: [['speed', 1, S(480)]], colour: 0x33EBFF },
  strong_swiftness: { effects: [['speed', 2, S(90)]], colour: 0x33EBFF },
  slowness: { effects: [['slowness', 1, S(90)]], colour: 0x8BAFE0 }, long_slowness: { effects: [['slowness', 1, S(240)]], colour: 0x8BAFE0 },
  strong_slowness: { effects: [['slowness', 4, S(20)]], colour: 0x8BAFE0 },
  turtle_master: { effects: [['slowness', 4, S(20)], ['resistance', 3, S(20)]], colour: 0x8B83A0 },
  long_turtle_master: { effects: [['slowness', 4, S(40)], ['resistance', 3, S(40)]], colour: 0x8B83A0 },
  strong_turtle_master: { effects: [['slowness', 6, S(20)], ['resistance', 4, S(20)]], colour: 0x8B83A0 },
  water_breathing: { effects: [['water_breathing', 1, S(180)]], colour: 0x98DAC0 }, long_water_breathing: { effects: [['water_breathing', 1, S(480)]], colour: 0x98DAC0 },
  healing: { effects: [['instant_health', 1, 1]], colour: 0xF82423 }, strong_healing: { effects: [['instant_health', 2, 1]], colour: 0xF82423 },
  harming: { effects: [['instant_damage', 1, 1]], colour: 0xA9656A }, strong_harming: { effects: [['instant_damage', 2, 1]], colour: 0xA9656A },
  poison: { effects: [['poison', 1, S(45)]], colour: 0x87A363 }, long_poison: { effects: [['poison', 1, S(90)]], colour: 0x87A363 },
  strong_poison: { effects: [['poison', 2, 432]], colour: 0x87A363 },
  regeneration: { effects: [['regeneration', 1, S(45)]], colour: 0xCD5CAB }, long_regeneration: { effects: [['regeneration', 1, S(90)]], colour: 0xCD5CAB },
  strong_regeneration: { effects: [['regeneration', 2, 450]], colour: 0xCD5CAB },
  strength: { effects: [['strength', 1, S(180)]], colour: 0xFFC700 }, long_strength: { effects: [['strength', 1, S(480)]], colour: 0xFFC700 },
  strong_strength: { effects: [['strength', 2, S(90)]], colour: 0xFFC700 },
  weakness: { effects: [['weakness', 1, S(90)]], colour: 0x484D48 }, long_weakness: { effects: [['weakness', 1, S(240)]], colour: 0x484D48 },
  slow_falling: { effects: [['slow_falling', 1, S(90)]], colour: 0xF3CFB9 }, long_slow_falling: { effects: [['slow_falling', 1, S(240)]], colour: 0xF3CFB9 },
  wind_charged: { effects: [['wind_charged', 1, S(180)]], colour: 0xBDC9FF }, weaving: { effects: [['weaving', 1, S(180)]], colour: 0x78695A },
  oozing: { effects: [['oozing', 1, S(180)]], colour: 0x99FFA3 }, infested: { effects: [['infested', 1, S(180)]], colour: 0x8C9B8C },
  luck: { effects: [['luck', 1, S(300)]], colour: 0x59C106 },
};
// the colour of one with more than one effect is the game's mix: each effect's colour weighed by its level
for (const k in POTIONS) {
  const p = POTIONS[k];
  if (p.effects.length < 2) continue;
  let r = 0, g = 0, b = 0, n = 0;
  for (const [e, lv] of p.effects) { const c = EFFECTS[e] ? EFFECTS[e].colour : 0; r += lv * ((c >> 16) & 255); g += lv * ((c >> 8) & 255); b += lv * (c & 255); n += lv; }
  p.colour = (Math.floor(r / n) << 16) | (Math.floor(g / n) << 8) | Math.floor(b / n);
}
// what the game calls each one ("Potion of the Turtle Master", "Arrow of Splashing")
const TITLE = { night_vision: 'Night Vision', invisibility: 'Invisibility', leaping: 'Leaping', fire_resistance: 'Fire Resistance', swiftness: 'Swiftness',
  slowness: 'Slowness', turtle_master: 'the Turtle Master', water_breathing: 'Water Breathing', healing: 'Healing', harming: 'Harming', poison: 'Poison',
  regeneration: 'Regeneration', strength: 'Strength', weakness: 'Weakness', slow_falling: 'Slow Falling', wind_charged: 'Wind Charging', weaving: 'Weaving',
  oozing: 'Oozing', infested: 'Infestation', luck: 'Luck' };
const AWKWARD = { golden_carrot: 'night_vision', rabbit_foot: 'leaping', magma_cream: 'fire_resistance', sugar: 'swiftness', pufferfish: 'water_breathing',
  glistering_melon_slice: 'healing', spider_eye: 'poison', ghast_tear: 'regeneration', blaze_powder: 'strength', turtle_helmet: 'turtle_master',
  phantom_membrane: 'slow_falling', breeze_rod: 'wind_charged', cobweb: 'weaving', slime_block: 'oozing', stone: 'infested' };
// the enhanced potions of Swiftness and Leaping cannot be corrupted
const CORRUPT = { night_vision: 'invisibility', long_night_vision: 'long_invisibility', swiftness: 'slowness', long_swiftness: 'long_slowness',
  leaping: 'slowness', long_leaping: 'long_slowness', healing: 'harming', strong_healing: 'strong_harming', poison: 'harming', long_poison: 'harming',
  strong_poison: 'strong_harming', water: 'weakness' };
// straight into a water bottle these make a mundane potion (all the effect ingredients but four)
const NOT_MUNDANE = new Set(['golden_carrot', 'pufferfish', 'turtle_helmet', 'phantom_membrane']);
const POTION_ITEMS = new Set(['potion', 'splash_potion', 'lingering_potion']);
export const isPotion = st => !!st && !!ITEMS[st.id] && POTION_ITEMS.has(ITEMS[st.id].name);
export const isTipped = st => !!st && !!ITEMS[st.id] && ITEMS[st.id].name === 'tipped_arrow';
export function potionColour(st) { const p = st && POTIONS[st.potion || 'water']; return p ? p.colour : 0x385DC6; }
// every potion a brewing stand can make (the drinkable form): what a fletcher tips arrows with
export const BREWABLE = Object.keys(POTIONS).filter(n => !/^(water|mundane|thick|awkward|luck)$/.test(n));

// what one bottle becomes with an ingredient, or null
export function brewResult(bottle, ingredient) {
  if (!isPotion(bottle) || !ingredient) return null;
  const kind = ITEMS[bottle.id].name, p = bottle.potion || 'water', ing = ITEMS[ingredient.id] ? ITEMS[ingredient.id].name : '';
  const as = (name, item) => (POTIONS[name] ? { id: I[item || kind], count: 1, potion: name } : null);
  if (ing === 'gunpowder') return kind === 'potion' ? as(p, 'splash_potion') : null;
  if (ing === 'dragon_breath') return kind === 'splash_potion' ? as(p, 'lingering_potion') : null;
  if (p === 'water') {
    if (ing === 'nether_wart') return as('awkward');
    if (ing === 'redstone') return as('mundane');
    if (ing === 'glowstone_dust') return as('thick');
    if (ing === 'fermented_spider_eye') return as('weakness');
    if (AWKWARD[ing] && !NOT_MUNDANE.has(ing)) return as('mundane');
    return null;
  }
  if (p === 'awkward' && AWKWARD[ing]) return as(AWKWARD[ing]);
  if (ing === 'fermented_spider_eye' && CORRUPT[p]) return as(CORRUPT[p]);
  if (ing === 'redstone' && POTIONS['long_' + p] && !/^(long|strong)_/.test(p)) return as('long_' + p);
  if (ing === 'glowstone_dust' && POTIONS['strong_' + p] && !/^(long|strong)_/.test(p)) return as('strong_' + p);
  return null;
}
export function isIngredient(st) {
  if (!st || !ITEMS[st.id]) return false;
  const n = ITEMS[st.id].name;
  return n === 'nether_wart' || n === 'redstone' || n === 'glowstone_dust' || n === 'fermented_spider_eye' || n === 'gunpowder' || n === 'dragon_breath' || !!AWKWARD[n];
}

// the name a potion stack shows ("Potion of Swiftness", "Splash Water Bottle", "Arrow of Leaping")
export function potionName(st) {
  const kind = ITEMS[st.id].name, p = (st.potion || 'water').replace(/^(long|strong)_/, '');
  if (kind === 'tipped_arrow') {
    if (p === 'water') return 'Arrow of Splashing';
    return TITLE[p] ? 'Arrow of ' + TITLE[p] : 'Tipped Arrow';
  }
  const pre = kind === 'splash_potion' ? 'Splash ' : kind === 'lingering_potion' ? 'Lingering ' : '';
  if (p === 'water') return pre + 'Water Bottle';
  if (p === 'mundane' || p === 'thick' || p === 'awkward') return pre + p[0].toUpperCase() + p.slice(1) + ' Potion';
  return pre + 'Potion of ' + (TITLE[p] || p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
}
// what an effect does to the attributes, for the "When Applied" lines (the game's modifiers a level)
const APPLIED = { speed: [0.2, '%', 'Speed'], slowness: [-0.15, '%', 'Speed'], strength: [3, '', 'Attack Damage'], weakness: [-4, '', 'Attack Damage'],
  luck: [1, '', 'Luck'], unluck: [-1, '', 'Luck'], health_boost: [4, '', 'Max Health'], haste: [0.1, '%', 'Attack Speed'], mining_fatigue: [-0.1, '%', 'Attack Speed'] };
// its tooltip lines after the name: each effect with its time, then what it changes
export function potionLines(st) {
  const p = POTIONS[st.potion || 'water'];
  if (!p || !p.effects.length) return ['§7No Effects'];
  const n = ITEMS[st.id].name;
  // a lingering potion's cloud gives a quarter of the time, a tipped arrow an eighth
  return effectLines(p.effects, n === 'lingering_potion' ? 0.25 : n === 'tipped_arrow' ? 0.125 : 1);
}
/* [effect, level, ticks]... as the game lists them under a potion's name (and a suspicious stew's, in
   creative): each with its time as 03:00 (01:40:00 past the hour), then what it changes */
export function effectLines(effects, scale = 1) {
  const pad = v => String(v).padStart(2, '0');
  const out = [], applied = [];
  for (const [e, lv, t] of effects) {
    // blue for the good and the neutral, red for the harmful; no time for one over within a second
    const def = EFFECTS[e], col = def && def.kind === 'bad' ? '§c' : '§9';
    const nm = effectName(e, lv);
    if ((def && def.instant) || t <= 20) out.push(col + nm);
    else {
      const s = Math.floor(Math.max(1, Math.floor(t * scale)) / 20), m = Math.floor(s / 60);
      out.push(col + nm + ' (' + (m >= 60 ? pad(Math.floor(m / 60)) + ':' : '') + pad(m % 60) + ':' + pad(s % 60) + ')');
    }
    const a = APPLIED[e];
    if (a) {
      const v = a[0] * lv, txt = a[1] === '%' ? Math.round(v * 100) + '%' : String(Math.round(v * 100) / 100);
      applied.push((v > 0 ? '§9+' : '§c') + txt + ' ' + a[2]);
    }
  }
  if (applied.length) out.push('', '§5When Applied:', ...applied);
  return out;
}
// drinking it: its effects on the drinker (survival.js)
export function drinkPotion(st, survival) {
  const p = POTIONS[st.potion || 'water'];
  if (!p) return;
  for (const [e, lv, t] of p.effects) {
    if (e === 'instant_health') survival.heal(4 << (lv - 1));
    else if (e === 'instant_damage') survival.hurtEffect(6 << (lv - 1), 'magic');
    else survival.addEffect(e, lv, t);
  }
}

/* ---- the brewing stand: slots 0-2 bottles, 3 ingredient, 4 blaze powder ----
   drop(x, y, z, stack): what the ingredient leaves (dragon's breath's bottle)
   when its slot is not empty yet, dropped beside the stand. */
export function brewingTick(c, drop) {
  const s = c.slots;
  let changed = false;
  if (c.fuel <= 0 && s[4] && ITEMS[s[4].id].name === 'blaze_powder') {
    c.fuel = 20; s[4].count--; if (s[4].count <= 0) s[4] = null; changed = true;
  }
  const can = s[3] && [0, 1, 2].some(i => s[i] && brewResult(s[i], s[3]));
  if (c.brew > 0) {
    if (!can || c.ingredient !== s[3].id) { c.brew = 0; return true; }
    if (--c.brew === 0) {
      for (const i of [0, 1, 2]) { const r = s[i] && brewResult(s[i], s[3]); if (r) s[i] = r; }
      const n = ITEMS[s[3].id].name;
      s[3].count--;
      // dragon's breath leaves its bottle behind: in the slot once it is used up, beside the stand before that
      if (n === 'dragon_breath') {
        const bottle = { id: I.glass_bottle, count: 1 };
        if (s[3].count <= 0) s[3] = bottle;
        else if (drop && c.x !== undefined) drop(c.x + 0.5, c.y + 1.2, c.z + 0.5, bottle);
      } else if (s[3].count <= 0) s[3] = null;
      changed = true;
    }
  } else if (can && c.fuel > 0) {
    c.fuel--; c.brew = 400; c.ingredient = s[3].id; changed = true;
  }
  return changed || c.brew > 0;
}
