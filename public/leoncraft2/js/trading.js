/* ---------------------------------------------------------------------------
   Leoncraft 2 - villager trading: the professions, the trades and the prices.

   All of it the Minecraft Wiki's (Trading, Villager; Java Edition):

   Professions come from job site blocks (a blast furnace makes an armorer,
   a lectern a librarian...). A villager has five levels, Novice (0
   experience), Apprentice (10), Journeyman (70), Expert (150) and Master
   (250); each level brings two trades picked at random from that level's
   pool (fewer if the pool is smaller). Every trade is
       what it wants (one or two stacks) > what it gives | stock, villager
       experience, price multiplier
   and the tables below are the wiki's, written as
       '<n> <item> [+ <n> <item>] > [<n>] <item>|<stock> <xp> <multiplier>[|<kind> <arg>]'
   where the kinds are:
       ench <base>   gear enchanted with 5 to 19 levels (as the middle slot of a
                     table with 13 shelves); it costs base plus those levels
       book          an enchanted book: any tradeable enchantment at any of its
                     levels, 2 + 3 level to 6 + 13 level emeralds (double for
                     treasure), no more than 64
       arrow         tipped arrows of a brewable potion picked when it is offered
       stew          a suspicious stew with one of six effects
       dyed          leather dyed with two random dyes (perhaps the same one)
       boat          the boat of the villager's biome
       map <target>  an explorer map (offered only where maps are made)
       colors <list> one trade for each colour ({c} in the item), 'all' for all 16
       types <list>  offered only by villagers of these biomes

   Prices: the first item's count moves with demand and reputation,
       count = clamp(p + max(0, floor(p d m)) - floor(m r) - hero, 1, stack)
   (p the price in the table, d the demand, m the multiplier, r the
   reputation; hero is max(1, floor(p (0.3 + 0.0625 (level - 1)))) for a
   player with Hero of the Village). Demand starts at 0 and on each restock
   gains the uses since the last one less the uses that were left. A
   villager restocks while working at its job site, up to twice a day.

   Reputation (gossip, per player): each trade +4 (to 25), hitting the
   villager -25 (to 200, weighed -1), killing one near it -25 (to 100,
   weighed -5), curing it +20 for good (weighed 5) and +25 (to 25). Every
   20 minutes they fall by 2, 20, 10, 0 and 1.

   A trade gives the player 3 to 6 experience (5 more when the villager
   levels up) and the villager the trade's experience.
--------------------------------------------------------------------------- */
import { I, maxStack, withCount, stackToJSON, stackFromJSON } from './items.js?v=107';
import { B } from './blocks.js?v=107';
import { ENCH, ORDER, selectEnchants } from './enchanting.js?v=107';
import { BREWABLE } from './brewing.js?v=107';
import { dyeColour, mixColours } from './crafting.js?v=107';

export const LEVEL_XP = [0, 10, 70, 150, 250];
export const LEVEL_NAMES = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
export const TRADES_PER_LEVEL = 2;
export const TYPES = ['desert', 'jungle', 'plains', 'savanna', 'snow', 'swamp', 'taiga'];

// profession -> its job site block(s)
export const PROFESSIONS = {
  armorer: ['blast_furnace'], butcher: ['smoker'], cartographer: ['cartography_table'], cleric: ['brewing_stand'], farmer: ['composter'],
  fisherman: ['barrel'], fletcher: ['fletching_table'], leatherworker: ['cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron'],
  librarian: ['lectern'], mason: ['stonecutter'], shepherd: ['loom'], toolsmith: ['smithing_table'], weaponsmith: ['grindstone'],
};
export const TITLES = { armorer: 'Armorer', butcher: 'Butcher', cartographer: 'Cartographer', cleric: 'Cleric', farmer: 'Farmer', fisherman: 'Fisherman',
  fletcher: 'Fletcher', leatherworker: 'Leatherworker', librarian: 'Librarian', mason: 'Mason', shepherd: 'Shepherd', toolsmith: 'Toolsmith',
  weaponsmith: 'Weaponsmith', nitwit: 'Nitwit', none: 'Villager' };
// block id -> profession
export const SITE_OF = new Map();
for (const p in PROFESSIONS) for (const n of PROFESSIONS[p]) if (B[n] !== undefined) SITE_OF.set(B[n], p);

const ALL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const smith1 = '15 coal > emerald|16 2 .05', bell = '36 emerald > bell|12 5 .2', iron = '4 iron_ingot > emerald|12 10 .05', diamond = '1 diamond > emerald|12 30 .05';
const villageMaps = [['savanna', 'desert jungle plains'], ['plains', 'desert savanna snow taiga'], ['taiga', 'plains snow swamp'], ['desert', 'jungle savanna'],
  ['snowy', 'swamp taiga'], ['jungle_temple', 'desert savanna swamp'], ['swamp_hut', 'jungle snow taiga']]
  .map(([t, who]) => `8 emerald + 1 compass > filled_map|12 5 .2|map ${t}|types ${who}`);
const book = xp => `1 emerald + 1 book > enchanted_book|12 ${xp} .2|book`;
export const TRADES = {
  armorer: [
    [smith1, '5 emerald > iron_helmet|12 1 .2', '9 emerald > iron_chestplate|12 1 .2', '7 emerald > iron_leggings|12 1 .2', '4 emerald > iron_boots|12 1 .2'],
    [iron, bell, '3 emerald > chainmail_leggings|12 5 .2', '1 emerald > chainmail_boots|12 5 .2'],
    ['1 lava_bucket > emerald|12 20 .05', '1 diamond > emerald|12 20 .05', '1 emerald > chainmail_helmet|12 10 .2', '4 emerald > chainmail_chestplate|12 10 .2', '5 emerald > shield|12 10 .2'],
    ['14 emerald > diamond_leggings|3 15 .2|ench 14', '8 emerald > diamond_boots|3 15 .2|ench 8'],
    ['8 emerald > diamond_helmet|3 30 .2|ench 8', '16 emerald > diamond_chestplate|3 30 .2|ench 16'],
  ],
  butcher: [
    ['14 chicken > emerald|16 2 .05', '4 rabbit > emerald|16 2 .05', '7 porkchop > emerald|16 2 .05', '1 emerald > rabbit_stew|12 1 .05'],
    [smith1, '1 emerald > 8 cooked_chicken|16 5 .05', '1 emerald > 5 cooked_porkchop|16 5 .05'],
    ['10 beef > emerald|16 20 .05', '7 mutton > emerald|16 20 .05'],
    ['10 dried_kelp_block > emerald|12 30 .05'],
    ['10 sweet_berries > emerald|12 30 .05'],
  ],
  cartographer: [
    ['24 paper > emerald|12 2 .05', '7 emerald > map|12 1 .05'],
    ['11 glass_pane > emerald|12 10 .05', ...villageMaps],
    ['1 compass > emerald|12 10 .05', '13 emerald + 1 compass > filled_map|12 10 .2|map monument', '12 emerald + 1 compass > filled_map|12 10 .2|map trial_chambers'],
    ['7 emerald > item_frame|12 15 .05', '3 emerald > {c}_banner|12 15 .05|colors cyan gray green lime orange|types desert', '3 emerald > {c}_banner|12 15 .05|colors brown green yellow|types jungle',
      '3 emerald > {c}_banner|12 15 .05|colors brown pink white yellow|types plains', '3 emerald > {c}_banner|12 15 .05|colors green magenta orange red|types savanna',
      '3 emerald > {c}_banner|12 15 .05|colors blue cyan light_blue red white|types snow', '3 emerald > {c}_banner|12 15 .05|colors black light_blue purple|types swamp',
      '3 emerald > {c}_banner|12 15 .05|colors blue lime pink purple|types taiga'],
    ['8 emerald > globe_banner_pattern|12 30 .05', '14 emerald + 1 compass > filled_map|12 30 .2|map mansion'],
  ],
  cleric: [
    ['32 rotten_flesh > emerald|16 2 .05', '1 emerald > 2 redstone|12 1 .05'],
    ['3 gold_ingot > emerald|12 10 .05', '1 emerald > lapis_lazuli|12 5 .05'],
    ['2 rabbit_foot > emerald|12 20 .05', '4 emerald > glowstone|12 10 .05'],
    ['4 turtle_scute > emerald|12 30 .05', '9 glass_bottle > emerald|12 30 .05', '5 emerald > ender_pearl|12 15 .05'],
    ['22 nether_wart > emerald|12 30 .05', '3 emerald > experience_bottle|12 30 .05'],
  ],
  farmer: [
    ['20 wheat > emerald|16 2 .05', '26 potato > emerald|16 2 .05', '22 carrot > emerald|16 2 .05', '15 beetroot > emerald|16 2 .05', '1 emerald > 6 bread|16 1 .05'],
    ['6 pumpkin > emerald|12 10 .05', '1 emerald > 4 pumpkin_pie|12 5 .05', '1 emerald > 4 apple|16 5 .05'],
    ['4 melon > emerald|12 20 .05', '3 emerald > 18 cookie|12 10 .05'],
    ['1 emerald > cake|12 15 .05', '1 emerald > suspicious_stew|12 15 .05|stew'],
    ['3 emerald > 3 golden_carrot|12 30 .05', '4 emerald > 3 glistering_melon_slice|12 30 .05'],
  ],
  fisherman: [
    ['20 string > emerald|16 2 .05', '10 coal > emerald|16 2 .05', '3 emerald > cod_bucket|16 1 .05', '6 cod + 1 emerald > 6 cooked_cod|16 1 .05'],
    ['15 cod > emerald|16 10 .05', '2 emerald > campfire|12 5 .05', '6 salmon + 1 emerald > 6 cooked_salmon|16 5 .05'],
    ['13 salmon > emerald|16 20 .05', '3 emerald > fishing_rod|3 10 .2|ench 3'],
    ['6 tropical_fish > emerald|12 30 .05'],
    ['4 pufferfish > emerald|12 30 .05', '1 oak_boat > emerald|12 30 .05|boat'],
  ],
  fletcher: [
    ['32 stick > emerald|16 2 .05', '1 emerald > 16 arrow|12 1 .05', '10 gravel + 1 emerald > 10 flint|12 1 .05'],
    ['26 flint > emerald|12 10 .05', '2 emerald > bow|12 5 .05'],
    ['14 string > emerald|16 20 .05', '3 emerald > crossbow|12 10 .05'],
    ['24 feather > emerald|16 30 .05', '2 emerald > bow|3 15 .05|ench 2'],
    ['8 tripwire_hook > emerald|12 30 .05', '3 emerald > crossbow|3 15 .05|ench 3', '2 emerald + 5 arrow > 5 tipped_arrow|12 30 .05|arrow'],
  ],
  leatherworker: [
    ['6 leather > emerald|16 2 .05', '3 emerald > leather_leggings|12 1 .2|dyed', '7 emerald > leather_chestplate|12 1 .2|dyed'],
    ['26 flint > emerald|12 10 .05', '5 emerald > leather_helmet|12 5 .2|dyed', '4 emerald > leather_boots|12 5 .2|dyed'],
    ['9 rabbit_hide > emerald|12 20 .05', '7 emerald > leather_chestplate|12 10 .2|dyed'],
    ['4 turtle_scute > emerald|12 30 .05', '6 emerald > leather_horse_armor|12 15 .2|dyed'],
    ['6 emerald > saddle|12 30 .2', '5 emerald > leather_helmet|12 30 .2|dyed'],
  ],
  librarian: [
    ['24 paper > emerald|16 2 .05', book(1), '9 emerald > bookshelf|12 1 .05'],
    ['4 book > emerald|12 10 .05', book(5), '1 emerald > lantern|12 5 .05'],
    ['5 ink_sac > emerald|12 20 .05', book(10), '1 emerald > 4 glass|12 10 .05'],
    ['2 writable_book > emerald|12 30 .05', book(15), '5 emerald > clock|12 15 .05', '4 emerald > compass|12 15 .05'],
    ['3 emerald > yellow_candle|12 30 .05', '3 emerald > red_candle|12 30 .05'],
  ],
  mason: [
    ['10 clay_ball > emerald|16 2 .05', '1 emerald > 10 brick|16 1 .05'],
    ['20 stone > emerald|16 10 .05', '1 emerald > 4 chiseled_stone_bricks|16 5 .05'],
    ['16 granite > emerald|16 20 .05', '16 andesite > emerald|16 20 .05', '16 diorite > emerald|16 20 .05', '1 emerald > 4 dripstone_block|16 10 .05',
      '1 emerald > 4 polished_andesite|16 10 .05', '1 emerald > 4 polished_diorite|16 10 .05', '1 emerald > 4 polished_granite|16 10 .05'],
    ['12 quartz > emerald|12 30 .05', '1 emerald > {c}_terracotta|12 15 .05|colors all', '1 emerald > {c}_glazed_terracotta|12 15 .05|colors all'],
    ['1 emerald > quartz_pillar|12 30 .05', '1 emerald > quartz_block|12 30 .05'],
  ],
  shepherd: [
    ['18 white_wool > emerald|16 2 .05', '18 brown_wool > emerald|16 2 .05', '18 black_wool > emerald|16 2 .05', '18 gray_wool > emerald|16 2 .05', '2 emerald > shears|12 1 .05'],
    ['12 {c}_dye > emerald|16 10 .05|colors white gray black light_blue lime', '1 emerald > {c}_wool|16 5 .05|colors all', '1 emerald > 4 {c}_carpet|16 5 .05|colors all'],
    ['12 {c}_dye > emerald|16 20 .05|colors yellow light_gray orange red pink', '3 emerald > {c}_bed|12 10 .05|colors all'],
    ['12 {c}_dye > emerald|16 30 .05|colors brown purple blue green magenta cyan', '3 emerald > {c}_banner|12 15 .05|colors all'],
    ['2 emerald > 3 painting|12 30 .05'],
  ],
  toolsmith: [
    [smith1, '1 emerald > stone_axe|12 1 .2', '1 emerald > stone_shovel|12 1 .2', '1 emerald > stone_pickaxe|12 1 .2', '1 emerald > stone_hoe|12 1 .2'],
    [iron, bell],
    ['30 flint > emerald|12 20 .05', '1 emerald > iron_axe|3 10 .2|ench 1', '2 emerald > iron_shovel|3 10 .2|ench 2', '3 emerald > iron_pickaxe|3 10 .2|ench 3', '4 emerald > diamond_hoe|3 10 .2'],
    [diamond, '12 emerald > diamond_axe|3 15 .2|ench 12', '5 emerald > diamond_shovel|3 15 .2|ench 5'],
    ['13 emerald > diamond_pickaxe|3 30 .2|ench 13'],
  ],
  weaponsmith: [
    [smith1, '3 emerald > iron_axe|12 1 .2', '2 emerald > iron_sword|3 1 .05|ench 2'],
    [iron, bell],
    ['24 flint > emerald|12 20 .05'],
    [diamond, '12 emerald > diamond_axe|3 15 .2|ench 12'],
    ['8 emerald > diamond_sword|3 30 .2|ench 8'],
  ],
};
// the wandering trader: two of what it buys, two special and five ordinary things it sells
const logs = ['acacia', 'birch', 'cherry', 'dark_oak', 'jungle', 'mangrove', 'oak', 'pale_oak', 'spruce', 'poplar'];
const saplings = ['acacia_sapling', 'birch_sapling', 'cherry_sapling', 'dark_oak_sapling', 'jungle_sapling', 'mangrove_propagule', 'oak_sapling', 'pale_oak_sapling', 'spruce_sapling', 'poplar_sapling'];
export const WANDERING = {
  buying: ['1 hay_block > emerald|2 1 .05', '1 potion > emerald|2 1 .05|potion water', '4 baked_potato > emerald|2 1 .05', '1 milk_bucket > 2 emerald|2 1 .05',
    '1 water_bucket > 2 emerald|2 1 .05', '1 fermented_spider_eye > 3 emerald|2 1 .05'],
  special: ['1 emerald > packed_ice|6 1 .05', '1 emerald > 4 gunpowder|2 1 .05', ...logs.map(l => `1 emerald > 8 ${l}_log|4 1 .05`), '3 emerald > 3 podzol|6 1 .05',
    '5 emerald > potion|1 1 .05|potion long_invisibility', '6 emerald > blue_ice|6 1 .05', '1 emerald > iron_pickaxe|1 1 .2|ench 1'],
  ordinary: [
    ...['fern', 'dandelion', 'poppy', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'wheat_seeds', 'beetroot_seeds',
      'pumpkin_seeds', 'melon_seeds', 'wildflowers', 'tall_dry_grass'].map(n => `1 emerald > ${n}|12 1 .05`),
    '1 emerald > sugar_cane|8 1 .05', '1 emerald > pumpkin|4 1 .05', '1 emerald > blue_orchid|8 1 .05', '1 emerald > lily_of_the_valley|7 1 .05', '1 emerald > open_eyeblossom|7 1 .05',
    '1 emerald > name_tag|5 1 .05', '1 emerald > 2 sulfur_spike|5 1 .05', '1 emerald > 3 {c}_dye|12 1 .05|colors all',
    '1 emerald > 3 vine|4 1 .05', '1 emerald > 3 pale_hanging_moss|4 1 .05', '1 emerald > 3 brown_mushroom|4 1 .05', '1 emerald > 3 red_mushroom|4 1 .05', '1 emerald > 3 shelf_mushroom|12 1 .05',
    '1 emerald > 5 lily_pad|2 1 .05', '1 emerald > 2 small_dripleaf|5 1 .05', '1 emerald > 8 sand|8 1 .05', '1 emerald > 4 red_sand|6 1 .05', '1 emerald > 2 pointed_dripstone|5 1 .05',
    '1 emerald > 2 rooted_dirt|5 1 .05', '1 emerald > 2 moss_block|5 1 .05', '1 emerald > 2 pale_moss_block|5 1 .05',
    '2 emerald > golden_dandelion|12 1 .05', '2 emerald > sea_pickle|5 1 .05', '2 emerald > glowstone|5 1 .05', '3 emerald > tropical_fish_bucket|4 1 .05', '3 emerald > pufferfish_bucket|4 1 .05',
    '3 emerald > kelp|12 1 .05', '3 emerald > cactus|8 1 .05', ...['brain', 'bubble', 'fire', 'horn', 'tube'].map(c => `3 emerald > ${c}_coral_block|8 1 .05`), '3 emerald > firefly_bush|12 1 .05',
    '4 emerald > slime_ball|5 1 .05', ...saplings.map(s => `5 emerald > ${s}|8 1 .05`), '5 emerald > nautilus_shell|5 1 .05'],
};
// what the fisherman takes in each biome
const BOATS = { desert: 'jungle_boat', jungle: 'jungle_boat', plains: 'oak_boat', savanna: 'acacia_boat', snow: 'spruce_boat', swamp: 'dark_oak_boat', taiga: 'spruce_boat' };
// a suspicious stew's possible effects and their times in ticks
const STEWS = [['night_vision', 100], ['jump_boost', 160], ['weakness', 140], ['blindness', 120], ['poison', 280], ['saturation', 7]];
// the enchantments a librarian sells (all but Soul Speed, Swift Sneak and Wind Burst), and the treasure ones that cost double
const TREASURE = new Set(['binding_curse', 'vanishing_curse', 'frost_walker', 'mending']);
const TRADEABLE = ORDER.concat([...TREASURE]);

const idOf = n => (I[n] !== undefined ? I[n] : B[n] !== undefined ? B[n] : undefined);
// '<n> <item>' (or '<item>', one) -> [id, count]
function stackSpec(s) {
  const m = /^(\d+)\s+(\S+)$/.exec(s.trim()) || [null, '1', s.trim()];
  return [m[2], +m[1]];
}
/* A table line read into a trade description, one for each colour.
   { want: [[name, n], [name, n]?], give: [name, n], uses, xp, mult, kind, arg, types } */
function parse(line) {
  const parts = line.split('|');
  const [w, gv] = parts[0].split('>');
  const [uses, xp, mult] = parts[1].trim().split(/\s+/).map(Number);
  const out = { want: w.split('+').map(stackSpec), give: stackSpec(gv), uses, xp, mult, kind: null, arg: null, types: null };
  let colours = null;
  for (const extra of parts.slice(2)) {
    const [k, ...rest] = extra.trim().split(/\s+/);
    if (k === 'colors') colours = rest[0] === 'all' ? ALL : rest;
    else if (k === 'types') out.types = rest;
    else { out.kind = k; out.arg = rest.join(' '); }
  }
  if (!colours) return [out];
  const sub = (s, c) => [s[0].replace('{c}', c), s[1]];
  return colours.map(c => Object.assign({}, out, { want: out.want.map(s => sub(s, c)), give: sub(out.give, c) }));
}
const POOLS = {};
function pool(prof, level) {
  const key = prof + level;
  if (!POOLS[key]) POOLS[key] = (TRADES[prof] && TRADES[prof][level - 1] || []).flatMap(parse);
  return POOLS[key];
}
const WPOOLS = {};
function wpool(name) { return WPOOLS[name] || (WPOOLS[name] = WANDERING[name].flatMap(parse)); }

const rand = n => Math.floor(Math.random() * n);
const RNG = { nextInt: rand, nextFloat: () => Math.random() };

/* One offer made from a trade description for a villager of this biome type;
   null when it cannot be offered (an item the game does not have, a map with
   nowhere to show, a trade for other biomes). */
export function makeOffer(t, type) {
  if (t.types && t.types.indexOf(type) < 0) return null;
  if (t.kind === 'map') return mapOffer(t);
  const st = ([n, c]) => { const id = idOf(n); return id === undefined ? null : { id, count: c }; };
  let a = st(t.want[0]), b = t.want[1] ? st(t.want[1]) : null, out = st(t.give);
  if (!a || (t.want[1] && !b) || !out) return null;
  switch (t.kind) {
    case 'ench': {
      // 5 to 19 levels, the price that much more
      const lv = 5 + rand(15);
      const ench = {};
      for (const [k, l] of selectEnchants(out.id, lv, RNG)) ench[k] = l;
      if (!Object.keys(ench).length) return null;
      out.ench = ench;
      a.count = Math.min(+t.arg + lv, 64);
      break;
    }
    case 'book': {
      const k = TRADEABLE[rand(TRADEABLE.length)], e = ENCH[k];
      if (!e) return null;
      const lv = 1 + rand(e.maxLevel);
      let price = 2 + rand(5 + lv * 10) + 3 * lv;
      if (TREASURE.has(k)) price *= 2;
      a.count = Math.min(price, 64);
      out.ench = { [k]: lv };
      break;
    }
    case 'arrow': out.potion = BREWABLE[rand(BREWABLE.length)]; break;
    case 'stew': out.stew = STEWS[rand(STEWS.length)].slice(); break;
    case 'dyed': out.color = mixColours(null, [dyeColour(ALL[rand(16)]), dyeColour(ALL[rand(16)])]); break;
    case 'boat': { const id = idOf(BOATS[type] || 'oak_boat'); if (id === undefined) return null; a = { id, count: 1 }; break; }
    case 'potion': if (t.want[0][0] === 'potion') a.potion = t.arg; else out.potion = t.arg; break;
  }
  return { a, b, out, uses: 0, maxUses: t.uses, xp: t.xp, mult: t.mult, demand: 0, special: 0 };
}
/* A cartographer's explorer map: the offer is made at once, its map once the nearest of its place is
   found from where you are (the workers search, as /locate does), with the place marked and the land and
   water drawn in; where there is none in reach the offer is left used up, as the game would not offer it. */
const MAP_TARGET = { monument: ['monument', 'monument'], mansion: ['mansion', 'mansion'], trial_chambers: ['trial_chambers', 'trial_chambers'],
  jungle_temple: ['jungle_pyramid', 'jungle_temple'], swamp_hut: ['swamp_hut', 'swamp_hut'], plains: ['village_plains', 'village_plains'],
  savanna: ['village_savanna', 'village_savanna'], taiga: ['village_taiga', 'village_taiga'], desert: ['village_desert', 'village_desert'], snowy: ['village_snowy', 'village_snowy'] };
function mapOffer(t) {
  const target = MAP_TARGET[t.arg], a = idOf(t.want[0][0]), b = t.want[1] ? idOf(t.want[1][0]) : undefined, out = idOf('filled_map');
  if (!target || a === undefined || out === undefined || (t.want[1] && b === undefined)) return null;
  const o = { a: { id: a, count: t.want[0][1] }, b: t.want[1] ? { id: b, count: t.want[1][1] } : null, out: { id: out, count: 1 },
    uses: 0, maxUses: t.uses, xp: t.xp, mult: t.mult, demand: 0, special: 0 };
  Promise.all([import('./containers.js?v=107'), import('./maps.js?v=107')]).then(([C, M]) => {
    const L = typeof window !== 'undefined' ? window.__lc2 : null, S = L && L.structures;
    o.out.title = C.MAP_TITLE[target[0]] || 'Explorer Map';
    if (!S || !S.locate) { o.uses = o.maxUses; return; }
    return S.locate(target[0]).then(f => {
      if (!f || f.x === undefined) { o.uses = o.maxUses; return; }
      const m = M.MAPS.create(f.x, f.z, 2, (L.world && L.world.dim) || 'overworld');
      m.marks = [{ x: f.x, z: f.z, type: target[1] }];
      o.out.map = m.id;
      M.fillPreview(m, L.world);
    }, () => { o.uses = o.maxUses; });
  }).catch(() => { o.uses = o.maxUses; });
  return o;
}
// up to n offers drawn from a pool without putting back (the ones that cannot be made are passed over)
function draw(list, n, type) {
  const left = list.slice(), out = [];
  while (out.length < n && left.length) {
    const o = makeOffer(left.splice(rand(left.length), 1)[0], type);
    if (o) out.push(o);
  }
  return out;
}
// the trades a villager gains on reaching a level
export function levelOffers(prof, level, type) { return draw(pool(prof, level), TRADES_PER_LEVEL, type); }
// a wandering trader's nine
export function wanderingOffers() { return draw(wpool('buying'), 2).concat(draw(wpool('special'), 2), draw(wpool('ordinary'), 5)); }

/* ---- prices ---- */
const f = Math.fround;
// what the first item costs now: demand, then the player's reputation and Hero of the Village
export function priceOf(o, rep = 0, hero = 0) {
  const p = o.a.count;
  let n = p + Math.max(0, Math.floor(f(f(p * o.demand) * f(o.mult))));
  if (rep) n -= Math.floor(f(rep * f(o.mult)));
  if (hero > 0) n -= Math.max(1, Math.floor((0.3 + 0.0625 * (hero - 1)) * p));
  return Math.max(1, Math.min(maxStack(o.a.id), n));
}
export const costA = (o, rep, hero) => withCount(o.a, priceOf(o, rep, hero));
export const outOfStock = o => o.uses >= o.maxUses;
// restocking: demand moves with how the trade went, every trade is open again
export function restock(offers) {
  for (const o of offers) { o.demand = o.demand + o.uses - (o.maxUses - o.uses); o.uses = 0; }
}

/* ---- gossip ---- */
export const GOSSIP = { trading: [4, 25, 1, 2], minor_negative: [25, 200, -1, 20], major_negative: [25, 100, -5, 10], minor_positive: [25, 25, 1, 1], major_positive: [20, 20, 5, 0] };
export function addGossip(g, kind, n) { const G = GOSSIP[kind]; g[kind] = Math.min(G[1], (g[kind] || 0) + (n === undefined ? G[0] : n)); }
export function reputation(g) { let r = 0; for (const k in GOSSIP) r += (g[k] || 0) * GOSSIP[k][2]; return r; }
export function decayGossip(g) { for (const k in GOSSIP) if (g[k]) { g[k] = Math.max(0, g[k] - GOSSIP[k][3]); if (!g[k]) delete g[k]; } }

/* ---- keeping offers ---- */
export function offersToJSON(list) { return list.map(o => ({ a: stackToJSON(o.a), b: stackToJSON(o.b), out: stackToJSON(o.out), u: o.uses, m: o.maxUses, x: o.xp, p: o.mult, d: o.demand })); }
export function offersFromJSON(list) {
  const out = [];
  for (const j of list || []) {
    const a = stackFromJSON(j.a), o = stackFromJSON(j.out);
    if (!a || !o) continue;
    // the price may be more than one stack's worth of the item in a save from elsewhere: keep it as written
    if (Array.isArray(j.a)) a.count = Math.max(1, j.a[1] | 0);
    out.push({ a, b: stackFromJSON(j.b), out: o, uses: j.u | 0, maxUses: j.m | 0, xp: j.x | 0, mult: +j.p || 0.05, demand: j.d | 0, special: 0 });
  }
  return out;
}
