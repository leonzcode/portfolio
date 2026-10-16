/* Leoncraft 2 - Leon Network on this page.

   The server "hub" (mlhub apps/mc/hub.js) is a minigame network in one void
   world: a lobby and Bed Wars arenas. The server runs the games (teams, beds,
   generators, deaths, the clock); this page shows them and does what only the
   page can: the sidebar scoreboard and titles, the people on the stands and
   the floating words over them and over the generators, the item shop and the
   team upgrades (paid from this inventory), the kit you start and respawn
   with, the rules of what may be broken or built, the void, the heal pool,
   and turning a death into the minigame's (no death screen: the server moves
   you to watch, then back to your island).

   Everything arrives as { t: 'hub', k, ... } (net.js hands them here) and
   goes back the same way.
--------------------------------------------------------------------------- */

import { B, BLOCKS } from '../blocks.js?v=64';
import { I } from '../items.js?v=64';
import { POTIONS } from '../brewing.js?v=64';
import { ChestScreen } from '../ui/containers.js?v=64';
import { RemotePlayers, playerSize, F } from './players.js?v=64';
import { register } from '../commands.js?v=64';
import { Sound } from '../sound/sound.js?v=64';
import { RES_OVERRIDE } from '../explosion.js?v=64';
import { skinUrl } from '../ui/skins.js?v=64';
import { Painter, PaintScreen, faceColour, faceOfNormal, loadSkin64 } from '../ui/paint.js?v=64';
import { blockGeometry } from '../render/blockmesh.js?v=64';
import { lightNear } from '../lightlevel.js?v=64';
import { setSkin as setOwnSkin } from '../render/avatar.js?v=64';
// each game's person on the stand wears a skin for the game (from the Skin Gallery's openly licensed skins, ui/skins.js)
const NPC_SKIN = { bedwars: 'red_knight', skywars: 'pilot', duels: 'knight', tntrun: 'blue_tnt_mouse', murder: 'shadow_ninja', prophunt: 'ghost', chameleon: 'camouflaged_wizard' };

const THREE = window.THREE;
let active = null;                     // the hub on this page, for its commands
// (no advancement or recipe toasts on the network: its games are not survival)
import('../adv/toast.js?v=64').then(m => {
  const T = m.AdvToast, add = T.add, rec = T.addRecipes;
  T.add = function (x) { if (active) return; return add.call(this, x); };
  T.addRecipes = function (ids) { if (active) return; return rec.call(this, ids); };
}).catch(() => {});

const idOf = name => (I[name] !== undefined ? I[name] : B[name] !== undefined ? B[name] : 0);
// the lobby's temporary blocks: place them anywhere in the lobby, the server takes them away again after 5 s
const TEMP_BLOCK = 'white_wool', TEMP_NAME = '§bTemporary Blocks §7- Place them, they vanish after 5 seconds';
const stack = (name, count = 1, extra) => { const id = idOf(name); return id ? Object.assign({ id, count }, extra || null) : null; };
const CURRENCY = { iron: { item: 'iron_ingot', name: 'Iron', code: '§f' }, gold: { item: 'gold_ingot', name: 'Gold', code: '§6' }, diamond: { item: 'diamond', name: 'Diamond', code: '§b' }, emerald: { item: 'emerald', name: 'Emerald', code: '§2' } };
const RESOURCES = ['iron_ingot', 'gold_ingot', 'diamond', 'emerald'];
const roman = n => ['', 'I', 'II', 'III', 'IV', 'V'][n] || String(n);

// the shop's potions: the mode's own strengths and lengths
POTIONS.bw_speed = { effects: [['speed', 2, 900]], colour: 0x33EBFF };
POTIONS.bw_jump = { effects: [['jump_boost', 5, 900]], colour: 0x22FF4C };
POTIONS.bw_invis = { effects: [['invisibility', 1, 600]], colour: 0xF6F6F6 };

/* ---- the kit's tiers ---- */
const ARMOR_TIERS = [null, 'chainmail', 'iron', 'diamond'];
const PICKS = [null, ['wooden_pickaxe', { efficiency: 1 }], ['iron_pickaxe', { efficiency: 2 }], ['golden_pickaxe', { efficiency: 3, sharpness: 2 }], ['diamond_pickaxe', { efficiency: 3 }]];
const AXES = [null, ['wooden_axe', { efficiency: 1 }], ['stone_axe', { efficiency: 1 }], ['iron_axe', { efficiency: 2 }], ['diamond_axe', { efficiency: 3 }]];
const SWORDS = ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword'];

/* ---- the item shop: [id, shown, price [currency, n], what it gives] by category ---- */
const C = (cur, n) => [cur, n];
function shopItems(team) {
  return {
    blocks: [
      { id: 'wool', name: 'Wool', price: C('iron', 4), give: () => [stack(team.wool, 16)], icon: team.wool, n: 16, lore: ['Great for bridging across', 'islands. Turns into your team\'s', 'colour.'] },
      { id: 'clay', name: 'Hardened Clay', price: C('iron', 12), give: () => [stack(team.clay, 16)], icon: team.clay, n: 16, lore: ['Basic block to defend your bed.'] },
      { id: 'glass', name: 'Blast-Proof Glass', price: C('iron', 12), give: () => [stack(team.glass, 4)], icon: team.glass, n: 4, lore: ['Immune to explosions.'] },
      { id: 'endstone', name: 'End Stone', price: C('iron', 24), give: () => [stack('end_stone', 12)], icon: 'end_stone', n: 12, lore: ['Solid block to defend your bed.'] },
      { id: 'ladder', name: 'Ladder', price: C('iron', 4), give: () => [stack('ladder', 8)], icon: 'ladder', n: 8, lore: ['Useful to save cats stuck in', 'trees.'] },
      { id: 'wood', name: 'Wood', price: C('gold', 4), give: () => [stack('oak_planks', 16)], icon: 'oak_planks', n: 16, lore: ['Good block to defend your bed.', 'Strong against pickaxes.'] },
      { id: 'obsidian', name: 'Obsidian', price: C('emerald', 4), give: () => [stack('obsidian', 4)], icon: 'obsidian', n: 4, lore: ['Extreme protection for your bed.'] },
    ],
    melee: [
      { id: 'stone_sword', name: 'Stone Sword', price: C('iron', 10), sword: 1, icon: 'stone_sword' },
      { id: 'iron_sword', name: 'Iron Sword', price: C('gold', 7), sword: 2, icon: 'iron_sword' },
      { id: 'diamond_sword', name: 'Diamond Sword', price: C('emerald', 4), sword: 3, icon: 'diamond_sword' },
      { id: 'kb_stick', name: 'Stick (Knockback I)', price: C('gold', 5), give: () => [stack('stick', 1, { ench: { knockback: 1 } })], icon: 'stick', glint: true },
    ],
    armor: [
      { id: 'chain', name: 'Permanent Chainmail Armor', price: C('iron', 24), armor: 1, icon: 'chainmail_boots', lore: ['Chainmail leggings and boots', 'which you will always spawn', 'with.'] },
      { id: 'ironarmor', name: 'Permanent Iron Armor', price: C('gold', 12), armor: 2, icon: 'iron_boots', lore: ['Iron leggings and boots which', 'you will always spawn with.'] },
      { id: 'diaarmor', name: 'Permanent Diamond Armor', price: C('emerald', 6), armor: 3, icon: 'diamond_boots', lore: ['Diamond leggings and boots', 'which you will always spawn', 'with.'] },
    ],
    tools: [
      { id: 'pick', tool: 'pick', prices: [null, C('iron', 10), C('iron', 10), C('gold', 3), C('gold', 6)], names: [null, 'Wooden Pickaxe', 'Iron Pickaxe', 'Golden Pickaxe', 'Diamond Pickaxe'] },
      { id: 'axe', tool: 'axe', prices: [null, C('iron', 10), C('iron', 10), C('gold', 3), C('gold', 6)], names: [null, 'Wooden Axe', 'Stone Axe', 'Iron Axe', 'Diamond Axe'] },
      { id: 'shears', name: 'Permanent Shears', price: C('iron', 20), shears: true, icon: 'shears', lore: ['Great to get rid of wool. You', 'will always spawn with these', 'shears.'] },
    ],
    ranged: [
      { id: 'arrow', name: 'Arrow', price: C('gold', 2), give: () => [stack('arrow', 6)], icon: 'arrow', n: 6 },
      { id: 'bow', name: 'Bow', price: C('gold', 12), give: () => [stack('bow')], icon: 'bow' },
      { id: 'bow_power', name: 'Bow (Power I)', price: C('gold', 20), give: () => [stack('bow', 1, { ench: { power: 1 } })], icon: 'bow', glint: true },
      { id: 'bow_punch', name: 'Bow (Power I, Punch I)', price: C('emerald', 6), give: () => [stack('bow', 1, { ench: { power: 1, punch: 1 } })], icon: 'bow', glint: true },
    ],
    potions: [
      { id: 'speed', name: 'Speed II Potion (45 seconds)', price: C('emerald', 1), give: () => [stack('potion', 1, { potion: 'bw_speed', name: 'Speed II Potion (45 seconds)' })], icon: 'potion', potion: 'bw_speed' },
      { id: 'jump', name: 'Jump V Potion (45 seconds)', price: C('emerald', 1), give: () => [stack('potion', 1, { potion: 'bw_jump', name: 'Jump V Potion (45 seconds)' })], icon: 'potion', potion: 'bw_jump' },
      { id: 'invis', name: 'Invisibility Potion (30 seconds)', price: C('emerald', 2), give: () => [stack('potion', 1, { potion: 'bw_invis', name: 'Invisibility Potion (30 seconds)' })], icon: 'potion', potion: 'bw_invis' },
    ],
    utility: [
      { id: 'gapple', name: 'Golden Apple', price: C('gold', 3), give: () => [stack('golden_apple')], icon: 'golden_apple', lore: ['Well-rounded healing.'] },
      { id: 'tnt', name: 'TNT', price: C('gold', 4), give: () => [stack('tnt')], icon: 'tnt', lore: ['Instantly ignites, appropriate', 'to explode things!'] },
      { id: 'pearl', name: 'Ender Pearl', price: C('emerald', 4), give: () => [stack('ender_pearl')], icon: 'ender_pearl', lore: ['The quickest way to invade', 'enemy bases.'] },
      { id: 'water', name: 'Water Bucket', price: C('gold', 3), give: () => [stack('water_bucket')], icon: 'water_bucket', lore: ['Great to slow down', 'approaching enemies. Can also', 'protect against TNT.'] },
      { id: 'sponge', name: 'Sponge', price: C('gold', 3), give: () => [stack('sponge', 4)], icon: 'sponge', n: 4, lore: ['Great for soaking up water.'] },
      { id: 'fireball', name: 'Fireball', price: C('iron', 40), give: () => [stack('fire_charge', 1, { name: '§fFireball' })], icon: 'fire_charge', lore: ['Right-click to launch! Great to', 'knock back enemies walking on', 'thin bridges.'] },
      { id: 'bridge_egg', name: 'Bridge Egg', price: C('emerald', 1), give: () => [stack('egg', 1, { name: '§fBridge Egg' })], icon: 'egg', lore: ['This egg creates a bridge in its', 'trail after being thrown.'] },
      { id: 'popup', name: 'Compact Pop-Up Tower', price: C('iron', 24), give: () => [stack('chest', 1, { name: '§fCompact Pop-Up Tower' })], icon: 'chest', lore: ['Place a pop-up defence tower!'] },
      { id: 'milk', name: 'Magic Milk', price: C('gold', 4), give: () => [stack('milk_bucket', 1, { name: '§fMagic Milk' })], icon: 'milk_bucket', lore: ['Avoid triggering traps for 30', 'seconds after consuming.'] },
    ],
  };
}
const CATEGORIES = [
  { id: 'quick', name: 'Quick Buy', icon: 'nether_star' }, { id: 'blocks', name: 'Blocks', icon: 'terracotta' }, { id: 'melee', name: 'Melee', icon: 'golden_sword' },
  { id: 'armor', name: 'Armor', icon: 'chainmail_boots' }, { id: 'tools', name: 'Tools', icon: 'stone_pickaxe' }, { id: 'ranged', name: 'Ranged', icon: 'bow' },
  { id: 'potions', name: 'Potions', icon: 'brewing_stand' }, { id: 'utility', name: 'Utility', icon: 'tnt' },
];
const QUICK = ['wool', 'stone_sword', 'chain', 'pick', 'bow', 'speed', 'tnt', 'wood', 'iron_sword', 'ironarmor', 'shears', 'arrow', 'jump', 'water', 'clay', 'endstone', 'axe', 'gapple', 'fireball', 'pearl', 'bridge_egg'];
// the shop's special items, known by their names
const SPECIAL = { Fireball: 'fireball', 'Bridge Egg': 'bridge', 'Compact Pop-Up Tower': 'popup', 'Magic Milk': 'milk' };
const specialOf = st => (st && st.name ? SPECIAL[st.name.replace(/\u00a7./g, '')] || null : null);
const GRID = [19, 20, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34, 37, 38, 39, 40, 41, 42, 43];

/* ---- the team upgrades ---- */
const UPGRADES = [
  { id: 'sharp', slot: 10, name: 'Sharpened Swords', icon: 'iron_sword', max: 1, cost: [[4], [8]], lore: ['Your team permanently gains', 'Sharpness I on all swords and', 'axes!'], tiers: null },
  { id: 'prot', slot: 11, name: 'Reinforced Armor', icon: 'iron_chestplate', max: 4, cost: [[2, 4, 8, 16], [5, 10, 20, 30]], lore: ['Your team permanently gains', 'Protection on all armor pieces!'], tiers: ['Protection I', 'Protection II', 'Protection III', 'Protection IV'] },
  { id: 'haste', slot: 12, name: 'Maniac Miner', icon: 'golden_pickaxe', max: 2, cost: [[2, 4], [4, 6]], lore: ['All players on your team', 'permanently gain Haste.'], tiers: ['Haste I', 'Haste II'] },
  { id: 'forge', slot: 13, name: 'Forge', icon: 'furnace', max: 4, cost: [[2, 4, 6, 8], [4, 8, 12, 16]], lore: ['Upgrade resource spawning on', 'your island.'], tiers: ['+50% Resources', '+100% Resources', 'Spawn emeralds', '+200% Resources'] },
  { id: 'heal', slot: 14, name: 'Heal Pool', icon: 'beacon', max: 1, cost: [[1], [3]], lore: ['Creates a Regeneration field', 'around your base!'], tiers: null },
];
const TRAPS = [
  { id: 'trap', slot: 15, name: 'It\'s a Trap!', icon: 'tripwire_hook', lore: ['Inflicts Blindness and Slowness', 'for 8 seconds.'] },
  { id: 'counter', slot: 16, name: 'Counter-Offensive Trap', icon: 'feather', lore: ['Grants Speed II and Jump Boost', 'II for 15 seconds to allied', 'players near your base.'] },
  { id: 'alarm', slot: 24, name: 'Alarm Trap', icon: 'redstone_torch', lore: ['Reveals invisible players as', 'well as their name and team.'] },
  { id: 'fatigue', slot: 25, name: 'Miner Fatigue Trap', icon: 'iron_pickaxe', lore: ['Inflicts Mining Fatigue for 10', 'seconds.'] },
];
const TRAP_COST = [1, 2, 4];

/* ---- a chest-like screen of things to click, not to take ---- */
class MenuScreen extends ChestScreen {
  constructor(hub, title) {
    const box = new Array(54).fill(null);
    super(hub.game.inv, hub.game.hands.icons, box, title);
    this.hub = hub; this.tips = new Array(54).fill(null); this.acts = new Array(54).fill(null);
    this.fillBox();
  }
  put(i, st, tip, act) { this.box[i] = st; this.tips[i] = tip; this.acts[i] = act || null; }
  fillBox() {}
  tooltipFor(st, s) { return s && s.kind === 'box' && this.tips[s.i] ? this.tips[s.i] : super.tooltipFor(st, s); }
  mouseClicked(mx, my, button) {
    const s = this.slotAt(mx, my);
    if (s && s.kind === 'box') {
      const act = this.acts[s.i];
      if (act && !this.inv.carried) { act(); this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); this.inv.changed(); }
      return true;
    }
    return super.mouseClicked(mx, my, button);
  }
  // (the box is a menu: nothing is put into it, nothing taken out by shift or number keys)
  mayPlace(s, st) { return s.kind === 'box' ? false : super.mayPlace(s, st); }
  quickMove(s) { if (s.kind !== 'box') return; }
  numberKey(s, n) { if (s.kind !== 'box') super.numberKey(s, n); }
  throwFrom(s, all) { if (s.kind !== 'box') super.throwFrom(s, all); }
}

class ShopScreen extends MenuScreen {
  constructor(hub) { super(hub, 'Item Shop'); }
  fillBox() {
    const hub = this.hub, cat = hub.shopCat || 'quick';
    const items = shopItems(hub.team || { wool: 'white_wool', clay: 'white_terracotta', glass: 'white_stained_glass' });
    CATEGORIES.forEach((c, i) => {
      const st = stack(c.icon); if (!st) return;
      st.name = '§a' + c.name;
      this.put(i, st, ['§a' + c.name, '§eClick to view!'], () => { hub.shopCat = c.id; });
      // the line under the categories: the open one marked in green
      this.put(9 + i, stack(c.id === cat ? 'lime_stained_glass_pane' : 'gray_stained_glass_pane'), [c.id === cat ? '§a↑ ' + c.name : '§8↑ Categories', '§8↓ Items'], null);
    });
    this.put(8, null, null, null); this.put(17, stack('gray_stained_glass_pane'), ['§8↑ Categories', '§8↓ Items'], null);
    const all = {}; for (const k in items) for (const it of items[k]) all[it.id] = it;
    const list = cat === 'quick' ? QUICK.map(id => all[id]).filter(Boolean) : items[cat] || [];
    list.forEach((it, n) => { if (n < GRID.length) this.offer(GRID[n], it); });
  }
  offer(slot, it) {
    const hub = this.hub;
    let name = it.name, price = it.price, icon = it.icon, extra = {}, done = false;
    if (it.tool) {
      const tier = hub.kit[it.tool], next = Math.min(4, tier + 1);
      done = tier >= 4;
      name = it.names[next] + (tier >= 4 ? '' : ' (' + roman(next) + ')');
      price = it.prices[next];
      icon = (it.tool === 'pick' ? PICKS : AXES)[next][0];
      extra.ench = Object.assign({}, (it.tool === 'pick' ? PICKS : AXES)[next][1]);
    }
    if (it.armor !== undefined && hub.kit.armor >= it.armor) done = true;
    if (it.shears && hub.kit.shears) done = true;
    const st = stack(icon, it.n || 1, extra);
    if (!st) return;
    if (it.glint) st.ench = { unbreaking: 1 };
    if (it.potion) st.potion = it.potion;
    const cur = CURRENCY[price[0]], have = hub.count(cur.item), can = have >= price[1];
    st.name = (done ? '§a' : can ? '§a' : '§c') + name;
    const tip = [st.name, '§7Cost: ' + cur.code + price[1] + ' ' + cur.name];
    if (it.lore) tip.push('', ...it.lore.map(l => '§7' + l));
    if (it.tool) tip.push('', '§7This is an upgradable item.', '§7It will lose 1 tier upon', '§7death!');
    tip.push('');
    if (done) tip.push(it.tool ? '§aMAXED!' : '§aUNLOCKED');
    else tip.push(can ? '§eClick to purchase!' : '§cYou don\'t have enough ' + cur.name + '!');
    this.put(slot, st, tip, () => { if (!done) hub.buy(it, name, price); });
  }
}

class UpgradeScreen extends MenuScreen {
  constructor(hub) { super(hub, hub.per === 1 ? 'Upgrades & Traps' : 'Upgrades & Traps'); }
  fillBox() {
    const hub = this.hub, big = hub.prices | 0, up = hub.up || {}, traps = hub.traps || [];
    const have = hub.count('diamond');
    for (const U of UPGRADES) {
      const lv = up[U.id] | 0, st = stack(U.icon);
      if (!st) continue;
      const maxed = lv >= U.max, price = maxed ? 0 : U.cost[big][lv];
      st.name = (maxed ? '§a' : have >= price ? '§e' : '§c') + U.name + (U.max > 1 && !maxed ? ' ' + roman(lv + 1) : '');
      const tip = [st.name, ...U.lore.map(l => '§7' + l), ''];
      if (U.tiers) U.tiers.forEach((t, i) => tip.push((i < lv ? '§a' : '§7') + 'Tier ' + (i + 1) + ': ' + t + ', §b' + U.cost[big][i] + ' Diamond' + (U.cost[big][i] === 1 ? '' : 's')));
      else tip.push('§7Cost: §b' + U.cost[big][0] + ' Diamond' + (U.cost[big][0] === 1 ? '' : 's'));
      tip.push('', maxed ? '§aUNLOCKED' : have >= price ? '§eClick to purchase!' : '§cYou don\'t have enough Diamonds!');
      if (lv) st.ench = { unbreaking: 1 };
      this.put(U.slot, st, tip, () => { if (!maxed) hub.upgrade('upg', U.id, price, U.name); });
    }
    const tp = traps.length < 3 ? TRAP_COST[traps.length] : 0;
    for (const T of TRAPS) {
      const st = stack(T.icon);
      if (!st) continue;
      const full = traps.length >= 3;
      st.name = (full ? '§c' : have >= tp ? '§e' : '§c') + T.name;
      const tip = [st.name, ...T.lore.map(l => '§7' + l), '', '§7Cost: §b' + (full ? '-' : tp + ' Diamond' + (tp === 1 ? '' : 's')), '',
        full ? '§cTrap queue full!' : have >= tp ? '§eClick to purchase!' : '§cYou don\'t have enough Diamonds!'];
      this.put(T.slot, st, tip, () => { if (!full) hub.upgrade('trap', T.id, tp, T.name); });
    }
    for (let i = 27; i < 36; i++) this.put(i, stack('gray_stained_glass_pane'), ['§8↑ Purchasable', '§8↓ Traps Queue'], null);
    for (let i = 0; i < 3; i++) {
      const id = traps[i], T = id && TRAPS.find(t => t.id === id), st = T ? stack(T.icon, i + 1) : stack('light_gray_stained_glass', i + 1);
      if (!st) continue;
      st.name = T ? '§aTrap #' + (i + 1) + ': ' + T.name : '§cTrap #' + (i + 1) + ': No Trap!';
      this.put(39 + i, st, T ? [st.name, '§7This trap will be activated', '§7when an enemy walks into your', '§7base.'] : [st.name, '§7The ' + ['first', 'second', 'third'][i] + ' enemy to walk into', '§7your base will trigger this trap!', '', '§7Purchasing a trap will queue it', '§7here. Its cost will scale based', '§7on the number of traps queued.', '', '§7Next trap: §b' + (traps.length < 3 ? TRAP_COST[traps.length] + ' Diamond' + (traps.length ? 's' : '') : '-')], null);
    }
  }
}

const MODE_ICON = { bw_solo: 'red_bed', bw_doubles: 'blue_bed', bw_3s: 'lime_bed', bw_4s: 'yellow_bed', sw_solo: 'ender_eye', sw_doubles: 'ender_pearl', duels_classic: 'iron_sword', duels_sumo: 'slime_ball', tntrun: 'tnt', murder: 'iron_sword',
  duels_bridge: 'blue_terracotta', duels_bedwars: 'red_bed', duels_skywars: 'ender_eye', buildbattle: 'bricks', spleef: 'diamond_shovel', prophunt: 'oak_leaves', ch_classic: 'brush', ch_infection: 'rotten_flesh', ch_double: 'ender_pearl' };
const GAME_ICON = { bedwars: 'red_bed', skywars: 'ender_eye', duels: 'iron_sword', tntrun: 'tnt', murder: 'bow', buildbattle: 'bricks', spleef: 'diamond_shovel', prophunt: 'oak_leaves', chameleon: 'brush' };
// the lobby compass shows every game (a click opens that game's own menu); a person on the stand shows their game's modes
class GameMenu extends MenuScreen {
  constructor(hub, game) { const g = game && (hub.games || []).find(x => x.id === game); super(hub, g ? g.name : 'Game Menu'); this.only = game || null; this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); hub.send({ k: 'counts' }); }
  fillBox() {
    const hub = this.hub;
    if (!this.only) {
      const games = hub.games || [], slots = [];
      // seven to a row, each row in the middle, from the second row down
      for (let i = 0; i < games.length; i += 7) { const n = Math.min(7, games.length - i), start = (1 + 2 * (i / 7)) * 9 + 1 + Math.floor((7 - n) / 2); for (let j = 0; j < n; j++) slots.push(start + j); }
      games.forEach((g, i) => {
        const st = stack(GAME_ICON[g.id] || 'paper');
        if (!st || slots[i] === undefined) return;
        st.name = '§a' + g.name;
        const n = hub.gameCounts ? hub.gameCounts[g.id] | 0 : null;
        this.put(slots[i], st, ['§a' + g.name, '§7' + (g.blurb || ''), '', n === null ? '' : '§7' + n + ' currently playing!', '§eClick to browse!'].filter((l, j) => l || j !== 3), () => { setTimeout(() => hub.openScreen(new GameMenu(hub, g.id)), 0); });
      });
      return;
    }
    const g = (hub.games || []).find(x => x.id === this.only) || {};
    const modes = (hub.modes || []).filter(m => (m.menu || m.game) === this.only);
    if ((hub.editable || []).indexOf(this.only) >= 0) editorEntry(this, hub, this.only, 49);
    const first = modes.slice(0, 7), more = modes.slice(7);
    [first, more].forEach((list, row) => {
      const start = (2 + row) * 9 + Math.max(1, Math.floor((9 - list.length) / 2));
      list.forEach((m, i) => {
        const st = stack(MODE_ICON[m.id] || 'paper');
        if (!st) return;
        st.name = '§a' + m.name;
        const n = hub.counts ? hub.counts[m.id] | 0 : null;
        this.put(start + i, st, ['§a' + m.name, '§7' + (g.blurb || ''), '', n === null ? '' : '§7' + n + ' currently playing!', '§eClick to play!'].filter((l, j) => l || j !== 3), () => { hub.send({ k: 'play', mode: m.id }); hub.closeScreens(); });
      });
    });
  }
}
// the Map Editor, in Prop Hunt's and Chameleon's menus: open to mods and admins, a locked door to everyone else
function editorEntry(menu, hub, game, slot) {
  const ok = !!hub.staff, st = stack(ok ? 'writable_book' : 'barrier');
  if (!st) return;
  st.name = (ok ? '§a' : '§c') + 'Map Editor';
  menu.put(slot, st, ok ? ['§aMap Editor', '§7Change this game\'s maps, or make', '§7new ones. Every change is saved', '§7and used by the next game.', '', '§eClick to open!']
    : ['§cMap Editor §7(Locked)', '§7Change this game\'s maps, or make', '§7new ones.', '', '§cYou need §2[MOD] §cor §c[ADMIN]', '§cto use this.'],
  () => { if (!hub.staff) { hub.ctx.chat.add('§cYou need §2[MOD] §cor §c[ADMIN] §cto use the Map Editor.', 0xFFFFFF); hub.sound('block.note_block.bass'); return; } hub.send({ k: 'editor', game }); });
}
class EditorMenu extends MenuScreen {
  constructor(hub, game, maps) { super(hub, 'Map Editor'); this.game = game; this.maps = maps || []; this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); }
  fillBox() {
    const hub = this.hub, maps = this.maps || [];
    maps.slice(0, 27).forEach((m, i) => {
      const st = stack(m.custom ? 'map' : 'filled_map') || stack('paper');
      if (!st) return;
      st.name = '§a' + m.name;
      this.put(10 + (i % 7) + Math.floor(i / 7) * 9, st, ['§a' + m.name, m.by ? '§7by ' + m.by : '§7Leon Network\'s own', m.custom ? '§7Made in the editor' : '', '', '§eClick to edit!'].filter((l, j) => l || j !== 2),
        () => { hub.send({ k: 'edit', game: this.game, id: m.id }); hub.closeScreens(); });
    });
    const nw = stack('anvil');
    if (nw) { nw.name = '§aCreate New Map'; this.put(49, nw, ['§aCreate New Map', '§7Starts as a flat field of grass.', '§7Rename it with §f/mapname <name>§7.', '', '§eClick to make one!'], () => { hub.send({ k: 'newmap', game: this.game }); hub.closeScreens(); }); }
  }
}
class VoteMenu extends MenuScreen {
  constructor(hub) { super(hub, 'Map Vote'); }
  fillBox() {
    const hub = this.hub, V = hub.votes || { maps: [] };
    (V.maps || []).slice(0, 21).forEach((m, i) => {
      const mine = V.mine === m.id, st = stack(mine ? 'filled_map' : 'map') || stack('paper');
      if (!st) return;
      st.name = (mine ? '§a§l' : '§a') + m.name;
      if (mine) st.ench = { unbreaking: 1 };
      this.put(10 + (i % 7) + Math.floor(i / 7) * 9, st, ['§a' + m.name, m.by ? '§7by ' + m.by : '§7Leon Network\'s own', '', '§7Votes: §e' + m.v, '', mine ? '§aYou voted for this map!' : '§eClick to vote!'],
        () => { hub.send({ k: 'mapvote', id: m.id }); });
    });
  }
}
/* Chameleon's poses (the Pose item cycles them; everyone sees them through the server's 'poses'):
   each bends the parts of the model as the game's model space has them (S: head, body, right arm,
   left arm, right leg, left leg; x right, y down, angles in radians). */
const HALF = Math.PI / 2;
const POSES = [
  ['Standing', null],
  ['T-Pose', S => { S[2].rx = S[3].rx = 0; S[2].ry = S[3].ry = 0; S[2].rz = HALF; S[3].rz = -HALF; }],
  ['Arms Up', S => { S[2].rx = S[3].rx = -Math.PI; S[2].rz = 0.12; S[3].rz = -0.12; }],
  ['Zombie', S => { S[2].rx = S[3].rx = -HALF; S[2].ry = S[3].ry = 0; S[2].rz = S[3].rz = 0; }],
  ['Sitting', S => { for (const q of S) q.y += 10; S[4].rx = S[5].rx = -HALF; S[4].ry = 0.15; S[5].ry = -0.15; S[2].rx = S[3].rx = -0.4; }],
  ['Star', S => { S[2].rx = S[3].rx = 0; S[2].rz = 2.3; S[3].rz = -2.3; S[4].rx = S[5].rx = 0; S[4].rz = 0.45; S[5].rz = -0.45; }],
  ['Waving', S => { S[2].rx = -2.9; S[2].rz = 0.35; S[3].rx = 0; S[3].rz = -0.1; }],
];
// a seeker crouching: down on one knee's lean, both arms out along the look as if sighting down a rifle
const SNIPE = (S, sneak) => {
  const head = S[0];
  S[2].rx = -HALF + head.rx; S[2].ry = -0.1 + head.ry; S[2].rz = 0;
  S[3].rx = -HALF + head.rx - 0.15; S[3].ry = 0.55 + head.ry; S[3].rz = 0;
  if (sneak) { S[0].rz = 0.12; }
};
// Build Battle's votes, as the hotbar holds them
const VOTES = [['Super Poop', '§4', 'red_terracotta'], ['Poop', '§c', 'pink_terracotta'], ['OK', '§a', 'lime_terracotta'], ['Good', '§2', 'green_terracotta'], ['Epic', '§5', 'purple_terracotta'], ['Legendary', '§6', 'yellow_terracotta']];

/* ---- words floating in the world (generators, the people on the stands) ---- */
function holoSprites(font, lines) {
  const out = [], k = 4;
  for (const line of lines) {
    if (!line) { out.push(null); continue; }
    const w = (font ? font.width(line) : line.length * 6) + 2, h = 10;
    const c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, c.width, c.height);
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    if (font) font.draw(t.getContext('2d'), line, 1, 1, 0xFFFFFF, true);
    g.drawImage(t, 0, 0, w, h, 0, 0, c.width, c.height);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    s.scale.set(w * 0.025, h * 0.025, 1);
    s.renderOrder = 10;
    s.frustumCulled = false;
    out.push(s);
  }
  return out;
}

export class Hub {
  constructor(net) {
    this.net = net;
    this.area = 'lobby'; this.board = null; this.titleT = null;
    this.npcList = []; this.holos = new Map(); this.gens = [];
    this.team = null; this.up = {}; this.traps = []; this.prices = 0; this.per = 1;
    this.kit = { armor: 0, pick: 0, axe: 0, shears: false };
    this.alive = false; this.changed = new Set(); this.modes = [];
    this.shopCat = 'quick';
    this.t = 0;
    this.tnt = []; this.eggs = []; this.building = false; this.tower = []; this.fireAt = -99;
    this.props = new Map(); this.propMeshes = new Map(); this.still = 0; this.lockAt = null; this.hitAt = -99;
    this.painter = null; this.paintOn = false;
  }
  send(o) { this.net.send(Object.assign({ t: 'hub' }, o)); }

  /* ---- the game has started (net.js attach) ---- */
  attach(game, ctx) {
    this.game = game; this.ctx = ctx;
    active = this;
    window.__lc2hub = this;
    this.overlay = { under: true, animates: false, draw: g => this.draw(g) };
    ctx.gui.overlays.push(this.overlay);
    this.npcs = new RemotePlayers(ctx.renderer, ctx.gui.font);
    this.group = new THREE.Group(); this.group.name = 'hub-holograms';
    ctx.renderer.scene.add(this.group);
    // a death is the minigame's: the server is told, you are made whole where you are, and it moves you on
    const hooks = game.survival.hooks;
    hooks.onDeath = (message, src) => this.died(src);
    // the people on the stands answer either button; what you hold in a lobby (the game menu, the way back) answers the right one
    const I2 = game.inter, use = I2.useWith.bind(I2), down = I2.down.bind(I2);
    I2.useWith = () => { if (this.clickNpc() || this.useHeld()) return true; return use(); };
    I2.down = b => { if (b === 0 && this.clickNpc()) return; if (b === 0) this.seekerSwing(I2); down(b); };
    I2.mayBreak = (x, y, z) => this.mayBreak(x, y, z);
    I2.mayPlace = (x, y, z, b) => this.mayPlace(x, y, z, false, b);
    // the lobby's temporary blocks go down even in adventure
    I2.adventurePlace = id => this.area === 'lobby' && id === idOf(TEMP_BLOCK);
    this.unhook = () => { I2.useWith = use; I2.down = down; I2.mayBreak = null; I2.mayPlace = null; I2.adventurePlace = null; };
    // every change seen while a game is on (yours and everyone's): those may be broken again, the map may not
    const net = this.net, blocks = net.blocks.bind(net), local = net.local.bind(net);
    net.blocks = (d, e) => { if (this.area === 'game') for (let i = 0; i + 4 < e.length; i += 5) this.changed.add(e[i] + ',' + e[i + 1] + ',' + e[i + 2]); return blocks(d, e); };
    net.local = (w, x, y, z, b, m, prev) => {
      if (this.area === 'game') { this.changed.add(x + ',' + y + ',' + z); if (b === B.tnt && this.alive) this.tnt.push([x, y, z]); }
      return local(w, x, y, z, b, m, prev);
    };
    // the shop's glass stands any explosion
    for (const n of ['red', 'blue', 'lime', 'yellow', 'cyan', 'white', 'pink', 'gray']) if (B[n + '_stained_glass'] !== undefined) RES_OVERRIDE.set(B[n + '_stained_glass'], 3600000);
    this.unwrapNet = () => { net.blocks = blocks; net.local = local; };
    // K in a shared waiting room starts the game (never while a screen or the chat is open)
    this.onKey = e => {
      if (e.code !== 'KeyK' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || ctx.gui.screen) return;
      if (this.area === 'wait' && this.startable) this.send({ k: 'start' });
      else if (this.area === 'wait' && this.watching) this.ctx.chat.add('§cA game is already on here. You will play in the next round.', 0xFFFFFF);
    };
    window.addEventListener('keydown', this.onKey);
  }
  detach() {
    if (active === this) active = null;
    this.area = null; this.applySize();
    if (this.overlay) { const o = this.ctx.gui.overlays, i = o.indexOf(this.overlay); if (i >= 0) o.splice(i, 1); }
    if (this.npcs) { this.npcs.dispose(); this.npcs = null; }
    this.clearProps(); this.unpaint();
    this.clearHolos();
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    if (this.unhook) this.unhook();
    if (this.unwrapNet) this.unwrapNet();
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    RES_OVERRIDE.clear();
    this.game = null;
  }

  /* ---- what the server says ---- */
  receive(m) {
    const g = this.game;
    if (!g) return;
    switch (m.k) {
      case 'hello': this.modes = m.modes || []; this.games = m.games || []; this.staff = !!m.staff; this.editable = m.editable || []; return;
      case 'votes': this.votes = m; this.refreshScreen(); return;
      case 'poses': this.poses = new Map(m.list || []); this.seekerIds = new Set(m.seekers || []); return;
      // (the menu it was asked from is swapped for the list in one step: closing it first would hand the game the mouse,
      // and its pointer lock lands after the list opens, hiding the cursor over a menu nobody can click)
      case 'editmaps': { const cur = this.ctx.gui.screen, E = new EditorMenu(this, m.game, m.maps); if (cur instanceof MenuScreen) { E.hub = this; this.ctx.gui.replace(E); } else this.openScreen(E); return; }
      case 'where': {
        this.area = m.area; this.floor = m.floor; this.spawn = m.spawn; this.bounds = m.bounds || null;
        if (m.team) this.team = m.team;
        if (m.per) this.per = m.per;
        this.gameKind = m.game || null; this.spill = !!m.spill; this.noBuild = !!m.noBuild; this.jumps = m.jumps | 0;
        this.hideNames = !!m.hideNames; this.role = m.role || null; this.hadBow = false; this.arrowT = 0;
        // a shared room: K starts it (startable); a late comer watches the round on there (watching)
        this.startable = !!m.startable; this.watching = !!m.watching;
        // the new games: The Bridge's goals (no building there), a Build Battle plot and its vote, Spleef's snow, hiding
        this.noPlace = m.noPlace || null; this.plot = m.plot || null; this.vote = !!m.vote; this.theme = m.theme || ''; this.owner = m.owner || ''; this.dig = m.dig || null;
        this.hide = m.hide || null; this.paintOn = !!(m.hide && m.hide.paint);
        if (!this.hide || this.hide.kind !== 'prophunt') this.clearProps();
        if (!this.hide || this.hide.kind !== 'chameleon' || this.role === 'seeker') this.unpaint();
        if (this.hide && this.hide.kind === 'chameleon' && this.role === 'seeker' && m.area === 'game') this.wearSeeker();
        if (this.paintOn && !this.painter) this.startPaint();
        if (m.area !== 'game') { this.team = null; this.alive = false; }
        this.setNpcs(m.npcs || []);
        this.setGens(m.gens || []);
        this.closeScreens();
        this.applySize();
        if (m.area !== 'game' || this.gameKind !== 'chameleon') { this.poses = new Map(); this.seekerIds = new Set(); this.myPose = 0; }
        else if (this.role !== 'hider') this.myPose = 0;
        return;
      }
      case 'start': this.changed.clear(); this.kit = { armor: 0, pick: 0, axe: 0, shears: false }; this.up = {}; this.traps = []; return;
      case 'kit': this.giveKit(m.kind, m.fresh); return;
      case 'go': {
        const c = this.ctx.commandCtx(), sv = g.survival;
        if (sv.dead) sv.respawn(true);
        if (m.mode && g.mode !== m.mode) c.setMode(m.mode);
        c.goTo(g.dim, +m.x, +m.y, +m.z, +m.yaw, +m.pitch);
        g.player.fallDistance = 0;
        return;
      }
      case 'spec': this.alive = false; return;
      case 'counts': this.counts = m.c || {}; this.gameCounts = m.g || {}; this.refreshScreen(); return;
      case 'mode': if (m.m && g.mode !== m.m) this.ctx.commandCtx().setMode(m.m); return;
      // (Murder Mystery: you shot an innocent)
      case 'kill': if (this.alive && !g.survival.dead) g.survival.hurt(3.4e38, 'generic_kill'); return;
      case 'title': this.titleT = { t: m.tt || '', s: m.s || '', fi: m.fi | 0, st: m.st | 0, fo: m.fo | 0, at: performance.now() }; this.overlay.animates = true; this.ctx.gui.markDirty(); return;
      case 'board':
        this.board = { title: m.title, lines: m.lines || [] };
        this.genInfo = m.gen || null;
        if (m.npcs) for (const [id, lines] of m.npcs) this.setNpcLines(id, lines);
        this.updateGenHolos();
        this.ctx.gui.markDirty();
        return;
      case 'team': this.up = m.up || {}; this.traps = m.traps || []; this.prices = m.prices | 0; this.applyUpgrades(true); this.refreshScreen(); return;
      case 'loot':
        for (const [name, n] of m.s || []) {
          const id = idOf(name);
          if (!id) continue;
          g.inv.add(id, n);
          const c = Object.values(CURRENCY).find(x => x.item === name);
          this.ctx.chat.add((c ? c.code : '§f') + '+' + n + ' ' + (c ? c.name : name), 0xFFFFFF);
        }
        return;
      case 'refund': if (m.n > 0) { g.inv.add(idOf('diamond'), m.n | 0); this.refreshScreen(); } return;
      case 'eff': {
        const sv = g.survival;
        for (const n of m.clear || []) sv.removeEffect(n);
        for (const [n, lv, t] of m.e || []) sv.addEffect(n, lv, t);
        return;
      }
      case 'sound': this.sound(m.s); return;
      case 'build': this.building = !!m.on; return;
      // Prop Hunt: every disguise, and where it is locked
      case 'props': this.props = new Map((m.list || []).map(e => [e[0], { b: e[1], lock: e[2] || null }])); return;
      // Chameleon: the time to paint is over, or you were found and seek now
      case 'paint': this.paintOn = !!m.on; if (!m.on) this.closeScreens(); return;
      case 'role': this.role = m.role || null; if (this.role === 'seeker') { this.unpaint(); if (this.hide && this.hide.kind === 'chameleon') this.wearSeeker(); } return;
      case 'fx': {
        // (a whistle: its notes one after another, each [ms later, pitch])
        const notes = Array.isArray(m.notes) ? m.notes : [[0, 1]];
        for (const [ms, pitch] of notes) setTimeout(() => { try { Sound.play(m.s || 'entity.firework_rocket.blast', +m.x, +m.y, +m.z, m.kind === 'whistle' ? 3 : 1.5, +pitch || 1, 'player'); } catch (e) { /* no sound yet */ } }, ms | 0);
        const E = g.entities;
        if (E && E.particles) {
          if (m.kind === 'whistle') E.particles('crit', +m.x, +m.y + 1.2, +m.z, 8, 0.25);
          else { E.particles('sparkle', +m.x, +m.y + 0.5, +m.z, 30, 0.6, [1, 0.85, 0.2]); E.particles('crit', +m.x, +m.y + 0.5, +m.z, 20, 0.6); }
        }
        return;
      }
    }
  }
  sound(name) { try { const L = Sound.listener; Sound.play(name, L.x, L.y, L.z, 1, 1, 'player'); } catch (e) { /* no sound yet */ } }

  /* ---- the kit ---- */
  giveKit(kind, fresh) {
    const g = this.game, inv = g.inv;
    inv.slots.fill(null); inv.armor.fill(null); inv.offhand = null; inv.carried = null;
    g.survival.clearEffects();
    g.survival.health = g.survival.maxHealth; g.survival.food = 20; g.survival.saturation = 5;
    if (kind === 'lobby') {
      inv.slots[0] = stack('compass', 1, { name: '§aGame Menu §7(Right Click)' });
      inv.slots[1] = stack(TEMP_BLOCK, 64, { name: TEMP_NAME });
    } else if (kind === 'wait' || kind === 'wait_vote') {
      inv.slots[8] = stack('red_bed', 1, { name: '§c§lReturn to Lobby §7(Right Click)' });
      if (kind === 'wait_vote') inv.slots[0] = stack('filled_map', 1, { name: '§aMap Vote §7- Right Click to choose the map' }) || stack('paper', 1, { name: '§aMap Vote §7- Right Click to choose the map' });
    } else if (kind === 'edit') {
      this.alive = true;
    } else if (kind === 'empty') {
      this.alive = true;
    } else if (kind === 'mm_murderer') {
      this.alive = true;
      inv.slots[1] = stack('iron_sword', 1, { name: '§cKnife' });
    } else if (kind === 'mm_detective') {
      this.alive = true; this.hadBow = true;
      inv.slots[1] = stack('bow', 1, { name: "§bDetective's Bow" }); inv.slots[8] = stack('arrow', 1);
    } else if (kind === 'duel_classic') {
      // Classic Duels: an iron sword, a bow and five arrows, a fishing rod, iron armour
      this.alive = true;
      inv.slots[0] = stack('iron_sword'); inv.slots[1] = stack('fishing_rod'); inv.slots[2] = stack('bow'); inv.slots[8] = stack('arrow', 5);
      inv.armor[0] = stack('iron_helmet'); inv.armor[1] = stack('iron_chestplate'); inv.armor[2] = stack('iron_leggings'); inv.armor[3] = stack('iron_boots');
      inv.select(0);
    } else if (kind === 'bridge') {
      // The Bridge: a sword, a bow and its arrow (it comes back), a pickaxe, two stacks of your clay, golden apples, your colour to wear
      this.alive = true;
      const clay = this.team ? this.team.clay : 'white_terracotta', rgb = this.team ? this.team.rgb : 0xFFFFFF;
      inv.slots[0] = stack('iron_sword'); inv.slots[1] = stack('bow'); inv.slots[2] = stack('diamond_pickaxe', 1, { ench: { efficiency: 2 } });
      inv.slots[3] = stack(clay, 64); inv.slots[4] = stack(clay, 64); inv.slots[5] = stack('golden_apple', 8); inv.slots[8] = stack('arrow');
      inv.armor[1] = stack('leather_chestplate', 1, { color: rgb }); inv.armor[2] = stack('leather_leggings', 1, { color: rgb }); inv.armor[3] = stack('leather_boots', 1, { color: rgb });
      inv.select(0);
    } else if (kind === 'spleef') {
      this.alive = true;
      inv.slots[0] = stack('diamond_shovel', 1, { name: '§bSpleef Shovel', ench: { efficiency: 5, unbreaking: 3 } });
      inv.select(0);
    } else if (kind === 'bb_vote') {
      VOTES.forEach((v, i) => { inv.slots[i + 1] = stack(v[2], 1, { name: v[1] + '§l' + v[0] }); });
      inv.select(3);
    } else if (kind === 'ph_hider') {
      this.alive = true;
      // (an empty hand to pick a block with; the taunt at the end of the bar)
      inv.slots[7] = stack('paper', 1, { name: '§eDisguise §7- Right Click any block to become it' });
      inv.slots[8] = stack('firework_star', 1, { name: '§aTaunt §7- Right Click to make a bang (+2 points)' });
      inv.select(0);
    } else if (kind === 'ph_seeker') {
      this.alive = true;
      inv.slots[0] = stack('iron_sword'); inv.slots[1] = stack('bow'); inv.slots[8] = stack('arrow', 32);
      inv.select(0);
    } else if (kind === 'ch_hider') {
      this.alive = true;
      const named = (items, name) => { for (const it of items) { const st = stack(it, 1, { name }); if (st) return st; } return null; };
      inv.slots[0] = named(['brush', 'feather'], '§aPaint Brush §7- Right Click to paint your skin');
      inv.slots[1] = named(['spyglass', 'stick'], '§bColour Picker §7- Right Click a block to copy its colour');
      inv.slots[2] = stack('paper', 1, { name: '§dBlock Stamp §7- Right Click a block to wear its picture' });
      inv.slots[3] = named(['armor_stand', 'oak_fence'], '§6Pose §7- Right Click to change your pose');
      inv.slots[8] = named(['goat_horn', 'note_block'], '§eWhistle §7- Right Click to whistle (+2 points)');
      inv.select(0);
    } else if (kind === 'ch_seeker' || kind === 'ch_hunter') {
      this.alive = true;
      inv.slots[0] = stack('stick', 1, { name: '§cTag Stick §7- Hit a hider once to find them' });
      inv.select(0);
    } else if (kind === 'game') {
      if (fresh) this.kit = { armor: 0, pick: 0, axe: 0, shears: false };
      this.alive = true;
      inv.slots[0] = stack('wooden_sword');
      this.giveTools();
      this.dressUp();
      inv.select(0);
    }
    inv.changed();
  }
  dressUp() {
    const inv = this.game.inv, rgb = this.team ? this.team.rgb : 0xFFFFFF, T = ARMOR_TIERS[this.kit.armor];
    inv.armor[0] = stack('leather_helmet', 1, { color: rgb });
    inv.armor[1] = stack('leather_chestplate', 1, { color: rgb });
    inv.armor[2] = T ? stack(T + '_leggings') : stack('leather_leggings', 1, { color: rgb });
    inv.armor[3] = T ? stack(T + '_boots') : stack('leather_boots', 1, { color: rgb });
    this.applyUpgrades(true);
  }
  // the pickaxe, axe and shears you have earned: in your inventory, the old tier replaced
  giveTools() {
    const inv = this.game.inv;
    const place = (old, st) => {
      if (!st) return;
      for (let i = 0; i < 36; i++) { const s = inv.slots[i]; if (s && old.indexOf(s.id) >= 0) { inv.slots[i] = st; return; } }
      inv.addStack(st);
    };
    const pickIds = PICKS.filter(Boolean).map(p => idOf(p[0])), axeIds = AXES.filter(Boolean).map(a => idOf(a[0]));
    if (this.kit.pick) { const p = PICKS[this.kit.pick]; place(pickIds, stack(p[0], 1, { ench: Object.assign({}, p[1]) })); }
    if (this.kit.axe) { const a = AXES[this.kit.axe]; place(axeIds, stack(a[0], 1, { ench: Object.assign({}, a[1]) })); }
    if (this.kit.shears && !inv.slots.some(s => s && s.id === idOf('shears'))) inv.addStack(stack('shears'));
    this.applyUpgrades(true);
  }
  swordTier() { let t = 0; for (const s of this.game.inv.slots) if (s) { const i = SWORDS.map(idOf).indexOf(s.id); if (i > t) t = i; } return t; }
  count(name) { return this.game.inv.count(idOf(name)); }
  take(name, n) {
    const inv = this.game.inv, id = idOf(name);
    for (let i = 0; i < 36 && n > 0; i++) { const s = inv.slots[i]; if (!s || s.id !== id) continue; const k = Math.min(n, s.count); s.count -= k; n -= k; if (!s.count) inv.slots[i] = null; }
    inv.changed();
  }
  buy(it, name, price) {
    const g = this.game, cur = CURRENCY[price[0]];
    if (this.count(cur.item) < price[1]) { this.ctx.chat.add('§cYou don\'t have enough ' + cur.name + '! Need ' + (price[1] - this.count(cur.item)) + ' more!', 0xFF5555); this.sound('entity.enderman.teleport'); return; }
    if (it.armor !== undefined && this.kit.armor >= it.armor) return;
    this.take(cur.item, price[1]);
    // (what does not fit is dropped at your feet, as the game drops a full inventory's overflow)
    if (it.give) for (const st of it.give()) if (st) { const left = g.inv.addStack(st); if (left > 0) g.inv.emit('drop', Object.assign({}, st, { count: left })); }
    if (it.sword !== undefined) {
      // a better sword takes the wooden one's place
      const inv = g.inv, wood = idOf('wooden_sword'), st = stack(SWORDS[it.sword]);
      const i = inv.slots.findIndex(s => s && s.id === wood);
      if (i >= 0) inv.slots[i] = st; else inv.addStack(st);
    }
    if (it.armor !== undefined) { this.kit.armor = it.armor; this.dressUp(); }
    if (it.tool) { this.kit[it.tool] = Math.min(4, this.kit[it.tool] + 1); this.giveTools(); }
    if (it.shears) { this.kit.shears = true; this.giveTools(); }
    this.applyUpgrades(true);
    g.inv.changed();
    this.ctx.chat.add('§aYou purchased §6' + name, 0xFFFFFF);
    this.sound('block.note_block.pling');
  }
  upgrade(k, id, price, name) {
    if (this.count('diamond') < price) { this.ctx.chat.add('§cYou don\'t have enough Diamonds!', 0xFF5555); return; }
    this.take('diamond', price);
    this.send({ k, id, paid: price });
    this.sound('block.note_block.pling');
  }
  // the team's upgrades on what you carry and wear: Sharpness on swords and axes, Protection on armour, Haste; nothing ever wears out
  applyUpgrades(force) {
    const g = this.game;
    if (!g || this.area !== 'game' || this.gameKind !== 'bedwars') return;
    const inv = g.inv, up = this.up || {};
    const swordIds = new Set(SWORDS.map(idOf).concat(AXES.filter(Boolean).map(a => idOf(a[0]))));
    let changed = false;
    for (const s of inv.slots.concat(inv.armor)) {
      if (!s) continue;
      if (s.dmg) { s.dmg = 0; changed = true; }
      if (swordIds.has(s.id) && up.sharp) { if (!s.ench || !s.ench.sharpness) { s.ench = Object.assign({}, s.ench, { sharpness: 1 }); changed = true; } }
    }
    if (up.prot) for (const s of inv.armor) if (s && (!s.ench || (s.ench.protection | 0) !== up.prot)) { s.ench = Object.assign({}, s.ench, { protection: up.prot }); changed = true; }
    if (changed || force) inv.changed();
  }
  refreshScreen() {
    const s = this.ctx.gui.screen;
    if (s instanceof MenuScreen) { s.box.fill(null); s.tips.fill(null); s.acts.fill(null); s.fillBox(); this.ctx.gui.markDirty(); }
  }
  closeScreens() { const s = this.ctx.gui.screen; if (s instanceof MenuScreen) this.ctx.gui.back(); }

  /* ---- dying ---- */
  died(src) {
    const g = this.game, sv = g.survival;
    const killer = sv.attacker && sv.attacker.remotePlayer && sv.age - sv.attackerAge <= 200 ? sv.attacker.customName : '';
    const res = RESOURCES.map(n => [n, this.count(n)]).filter(e => e[1] > 0);
    const type = src && src.type || '';
    if (this.area === 'game' && this.alive) {
      this.send({ k: 'died', by: killer, void: this.voided || type === 'out_of_world', shot: /arrow|trident|projectile|thrown/.test(type), res });
      // a tier of each tool is lost with a death, never below the first
      if (this.kit.pick > 1) this.kit.pick--;
      if (this.kit.axe > 1) this.kit.axe--;
      this.alive = false;
    }
    this.voided = false;
    if (this.spill && this.area === 'game' && g.hands && g.hands.spillAll) { try { g.hands.spillAll(); } catch (e) { /* nothing to spill */ } }
    // made whole where you fell: the server moves you to watch, and back to your island in a while
    sv.respawn(true);
    sv.attacker = null;
    const inv = g.inv;
    inv.slots.fill(null); inv.offhand = null; inv.carried = null;
    inv.changed();
    g.player.vel.set(0, 0, 0);
    g.player.fallDistance = 0;
  }

  /* ---- what may be broken and built ---- */
  inPlot(x, y, z) { const p = this.plot; return !!p && x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && y >= p.y0 && y <= p.y1; }
  mayBreak(x, y, z) {
    if (this.building || this.area === 'edit') return true;
    if (this.area !== 'game' || !this.alive || this.noBuild) return false;
    if (this.gameKind === 'buildbattle') return !this.vote && this.inPlot(x, y, z);
    if (this.dig) { const b = this.game.world.get(x, y, z); return !!BLOCKS[b] && BLOCKS[b].name === this.dig; }
    // SkyWars: any of it, within the arena
    if (this.gameKind === 'skywars') { const b = this.bounds; return !b || (Math.abs(x + 0.5 - b.x) <= b.reach && Math.abs(z + 0.5 - b.z) <= b.reach && y <= b.top && y >= b.bottom); }
    const w = this.game.world, b = w.get(x, y, z), d = BLOCKS[b];
    // another team's bed may be broken; your own never
    if (d && d.shape === 'bed') return !this.team || d.name !== this.team.wool.replace('_wool', '_bed');
    return this.changed.has(x + ',' + y + ',' + z);
  }
  mayPlace(x, y, z, quiet, id) {
    if (this.building || this.area === 'edit') return true;
    // the lobby: only a temporary block, only into the air (the server takes it away again)
    if (this.area === 'lobby') {
      if (id !== idOf(TEMP_BLOCK) || this.game.world.get(x, y, z)) return false;
      // (never round the people on the stand: 3 blocks clear of each, as the server has it)
      for (const n of this.npcList || []) if (Math.abs(x + 0.5 - n.x) <= 3 && Math.abs(z + 0.5 - n.z) <= 3 && y >= n.y - 2 && y <= n.y + 4) { if (quiet !== true) this.ctx.chat.add('§cYou cannot place blocks near the people on the stand!', 0xFF5555); return false; }
      return true;
    }
    if (this.area !== 'game' || !this.alive || this.noBuild || this.dig) return false;
    if (this.gameKind === 'buildbattle') { if (this.vote || !this.inPlot(x, y, z)) { if (quiet !== true && !this.vote) this.ctx.chat.add('§cYou can only build on your own plot!', 0xFF5555); return false; } return true; }
    if (this.noPlace) for (const q of this.noPlace) if (x + 0.5 >= q[0] && x + 0.5 <= q[3] && z + 0.5 >= q[2] && z + 0.5 <= q[5]) { if (quiet !== true) this.ctx.chat.add('§cYou can\'t place blocks there!', 0xFF5555); return false; }
    const b = this.bounds;
    if (b && (Math.abs(x + 0.5 - b.x) > b.reach || Math.abs(z + 0.5 - b.z) > b.reach || y > b.top || y < b.bottom)) {
      if (quiet !== true) this.ctx.chat.add('§cYou can\'t place blocks here!', 0xFF5555);
      return false;
    }
    return true;
  }

  /* ---- the people on the stands ---- */
  setNpcs(list) {
    for (const n of this.npcList) this.npcs.remove(n.nid);
    this.clearHolos();
    this.npcList = list.map((n, i) => Object.assign({ nid: -1000 - i }, n));
    for (const n of this.npcList) {
      const sk = NPC_SKIN[String(n.id).replace(/^game:/, '')];
      this.npcs.add({ id: n.nid, name: '', skin: sk ? skinUrl(sk) : '', eq: n.held ? { h: n.held, o: '', a: null } : null });
      this.feed(n);
      this.holo('npc:' + n.id, n.x, n.y + 1.95, n.z, n.lines || []);
    }
  }
  setNpcLines(id, lines) {
    const n = this.npcList.find(q => q.id === id);
    if (!n) return;
    const key = 'npc:' + id, h = this.holos.get(key);
    if (h && h.lines.join('\n') === lines.join('\n')) return;
    this.holo(key, n.x, n.y + 1.95, n.z, lines);
  }
  feed(n) { this.npcs.state(n.nid, { ts: performance.now(), x: n.x, y: n.y, z: n.z, yaw: n.yaw, pitch: 0, f: 0, d: 0 }, performance.now()); }
  // the person under the crosshair, within reach: what a click on them does
  clickNpc() {
    const n = this.npcAt();
    if (!n) return false;
    const [kind, arg] = n.id.split(':');
    if (kind === 'game') this.openScreen(new GameMenu(this, arg));
    else if (kind === 'shop' && this.alive) this.openScreen(new ShopScreen(this));
    else if (kind === 'upg' && this.alive) this.openScreen(new UpgradeScreen(this));
    return true;
  }
  npcAt() {
    const P = this.game.player, eye = { x: P.pos.x, y: P.pos.y + (P.sneaking ? 1.27 : 1.62), z: P.pos.z };
    const dx = -Math.sin(P.yaw) * Math.cos(P.pitch), dy = Math.sin(P.pitch), dz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    let best = null, bestT = 4.5;
    for (const n of this.npcList) {
      // the ray against the person's box (0.6 wide, 1.8 tall), slab by slab
      let t0 = 0, t1 = bestT;
      for (const [o, d, lo, hi] of [[eye.x, dx, n.x - 0.35, n.x + 0.35], [eye.y, dy, n.y, n.y + 1.9], [eye.z, dz, n.z - 0.35, n.z + 0.35]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 1; t1 = 0; } continue; }
        let a = (lo - o) / d, b = (hi - o) / d;
        if (a > b) { const t = a; a = b; b = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      }
      if (t0 <= t1 && t0 < bestT) { bestT = t0; best = n; }
    }
    return best;
  }
  useHeld() {
    const inv = this.game.inv, h = inv.slots[inv.selected];
    // (a Prop Hunt hider picks a block with an empty hand too)
    const hider = this.area === 'game' && this.alive && this.hide && this.hide.kind === 'prophunt' && this.role === 'hider';
    if (!h && !hider) return false;
    if (h && this.area === 'game' && this.alive) {
      const sp = specialOf(h);
      if (sp === 'fireball') { if (this.t - this.fireAt >= 10) { this.fireAt = this.t; this.launchFireball(); this.useOne(); } return true; }
      if (sp === 'milk') {
        this.useOne(); this.send({ k: 'milk' });
        this.ctx.chat.add('§aYour Magic Milk is active! Traps will not trigger for 30 seconds.', 0xFFFFFF);
        this.sound('entity.generic.drink');
        return true;
      }
      if (sp === 'popup') { const T = this.game.inter.target; if (T && T.face && this.popUp(T)) this.useOne(); return true; }
      // (the egg is thrown as any egg is; its trail is laid in the ticks after)
      if (sp === 'bridge') this.bridgeAt = this.t;
    }
    if (h && this.area === 'game' && this.alive) {
      const nm = h.name ? h.name.replace(/\u00a7./g, '') : '';
      // Build Battle: a vote
      const vi = this.vote ? VOTES.findIndex(v => v[0] === nm) : -1;
      if (vi >= 0) { this.send({ k: 'vote', v: vi + 1 }); this.sound('block.note_block.pling'); return true; }
      // Prop Hunt: a taunt
      if (this.hide && this.hide.kind === 'prophunt' && /^Taunt/.test(nm)) { this.send({ k: 'taunt' }); return true; }
      // Chameleon: a whistle, heard by everyone near (the server keeps its wait)
      if (this.hide && this.hide.kind === 'chameleon' && /^Whistle/.test(nm)) { this.send({ k: 'whistle' }); return true; }
      // Chameleon: the next pose (as LC1's Mecha had them), told to everyone through the server
      if (this.hide && this.hide.kind === 'chameleon' && /^Pose/.test(nm)) {
        this.myPose = ((this.myPose | 0) + 1) % POSES.length;
        this.send({ k: 'pose', p: this.myPose });
        this.ctx.chat.add('§6Pose: §e' + POSES[this.myPose][0] + ' §7(right click again for the next)', 0xFFFFFF);
        this.sound('block.wood.place');
        return true;
      }
      // Chameleon: the brush, the picker and the stamp
      if (this.hide && this.hide.kind === 'chameleon' && this.painter) {
        const T = this.game.inter.target;
        if (/^Paint Brush/.test(nm)) { if (this.paintOn) this.openScreen(new PaintScreen(this.painter, { renderer: this.ctx.renderer, world: this.game.world, player: this.game.player })); else this.ctx.chat.add('§cThe time to paint is over!', 0xFF5555); return true; }
        if (/^Colour Picker/.test(nm)) { if (T) { const c = faceColour(T.b || this.game.world.get(T.x, T.y, T.z), faceOfNormal(T.face)); if (c !== null) { this.painter.setColour(c); this.ctx.chat.add('§bPicked a colour: §f#' + c.toString(16).padStart(6, '0') + ' §7(paint with it in the Paint Brush)', 0xFFFFFF); this.sound('block.note_block.hat'); } } return true; }
        if (/^Block Stamp/.test(nm)) { if (!this.paintOn) { this.ctx.chat.add('§cThe time to paint is over!', 0xFF5555); return true; } if (T && this.painter.stamp(T.b || this.game.world.get(T.x, T.y, T.z), faceOfNormal(T.face))) { this.ctx.chat.add('§dYou are covered in ' + ((BLOCKS[T.b || this.game.world.get(T.x, T.y, T.z)] || {}).display || 'that block') + '!', 0xFFFFFF); this.sound('block.wool.place'); } return true; }
      }
    }
    // Prop Hunt: a hider's right click on any block of the map makes them it
    if (hider) {
      const T = this.game.inter.target;
      if (T) {
        const d = BLOCKS[T.b || this.game.world.get(T.x, T.y, T.z)];
        if (d && (this.hide.props || []).indexOf(d.name) >= 0) {
          this.send({ k: 'disguise', b: d.name }); this.disguise = d.name;
          // seen from behind, so you see what you have become (F5 still changes it)
          const A = this.ctx.renderer.avatar;
          if (A && A.view === 0) { this.viewBefore = 0; A.setView(1); }
          this.ctx.chat.add('§aYou are now disguised as §e' + (d.display || d.name) + '§a! Stand still to lock in place.', 0xFFFFFF); this.sound('entity.chicken.egg'); }
        else this.ctx.chat.add('§cYou can\'t disguise as that block.', 0xFF5555);
        return true;
      }
    }
    if (!h) return false;
    if (this.area === 'lobby' && h.id === idOf('compass')) { this.openScreen(new GameMenu(this)); return true; }
    if (this.area === 'wait' && h.id === idOf('red_bed')) { this.send({ k: 'lobby' }); return true; }
    if (this.area === 'wait' && h.name && /^Map Vote/.test(h.name.replace(/\u00a7./g, ''))) { this.openScreen(new VoteMenu(this)); return true; }
    return false;
  }
  useOne() { const inv = this.game.inv, h = inv.slots[inv.selected]; if (!h) return; if (--h.count <= 0) inv.slots[inv.selected] = null; inv.changed(); }
  look() {
    const P = this.game.player;
    return { eye: { x: P.pos.x, y: P.pos.y + (P.sneaking ? 1.27 : 1.62), z: P.pos.z }, d: { x: -Math.sin(P.yaw) * Math.cos(P.pitch), y: Math.sin(P.pitch), z: -Math.cos(P.yaw) * Math.cos(P.pitch) } };
  }
  // a fireball from your eyes the way you look: it breaks the blocks a player put down (not the map, not blast-proof glass) and throws people back
  launchFireball() {
    const E = this.game.entities, { eye, d } = this.look();
    if (!E) return;
    const f = E.spawn('fireball', eye.x + d.x * 1.2, eye.y + d.y * 1.2 - 0.5, eye.z + d.z * 1.2, { natural: false });
    if (!f) return;
    f.owner = E.player; f.power = 2; f.deflected = true;
    f.vel.set(d.x, d.y, d.z);
    this.sound('entity.ghast.shoot');
  }
  /* A pop-up tower where you clicked: a one-block shaft with a ladder, walls
     of your wool round it with a way in towards you, and a platform with
     battlements on top, put up a few blocks a tick. */
  popUp(T) {
    const g = this.game, P = g.player, n = T.face;
    const bx = T.x + n[0], by = T.y + n[1], bz = T.z + n[2];
    const yaw = P.yaw, sx = -Math.sin(yaw), sz = -Math.cos(yaw);
    const fx = Math.abs(sx) > Math.abs(sz) ? Math.sign(sx) : 0, fz = fx ? 0 : Math.sign(sz);
    const rx = -fz, rz = fx, wool = B[this.team ? this.team.wool : 'white_wool'], ladder = B.ladder;
    const face = fx === 1 ? 0 : fx === -1 ? 1 : fz === 1 ? 4 : 5;
    const cells = [];
    const at = (f, r, y, b, m) => cells.push([bx + f * fx + r * rx, by + y, bz + f * fz + r * rz, b, m | 0]);
    for (let y = 0; y < 5; y++) {
      for (let f = -1; f <= 1; f++) for (let r = -1; r <= 1; r++) {
        if (!f && !r) continue;
        if (f === -1 && r === 0 && y < 2) continue;          // the way in, on your side
        at(f, r, y, wool);
      }
      at(0, 0, y, ladder, face);
    }
    for (let f = -2; f <= 2; f++) for (let r = -2; r <= 2; r++) {
      if (!f && !r) { at(0, 0, 5, ladder, face); continue; }
      at(f, r, 5, wool);
      if ((Math.abs(f) === 2 || Math.abs(r) === 2) && ((f + r) & 1) === 0) at(f, r, 6, wool);
    }
    this.tower.push(...cells);
    this.sound('block.wool.place');
    return true;
  }
  openScreen(s) { this.game.hands.open(s); }
  // (for tests: window.__lc2hub)
  openShop() { this.openScreen(new ShopScreen(this)); }
  openUpgrades() { this.openScreen(new UpgradeScreen(this)); }
  openGame(g) { this.openScreen(new GameMenu(this, g)); }
  openMenu() { this.openScreen(new GameMenu(this)); }

  /* ---- the floating words ---- */
  holo(key, x, y, z, lines) {
    this.dropHolo(key);
    const sprites = holoSprites(this.ctx.gui.font, lines);
    sprites.forEach((s, i) => { if (!s) return; s.position.set(x, y + (lines.length - 1 - i) * 0.27, z); this.group.add(s); });
    this.holos.set(key, { sprites, lines: lines.slice(), x, y, z });
  }
  dropHolo(key) {
    const h = this.holos.get(key);
    if (!h) return;
    for (const s of h.sprites) if (s) { this.group.remove(s); s.material.map.dispose(); s.material.dispose(); }
    this.holos.delete(key);
  }
  clearHolos() { for (const k of [...this.holos.keys()]) this.dropHolo(k); }
  setGens(list) { for (const k of [...this.holos.keys()]) if (k.startsWith('gen:')) this.dropHolo(k); this.gens = list; this.updateGenHolos(); }
  updateGenHolos() {
    const G = this.genInfo;
    this.gens.forEach((gn, i) => {
      const info = G && (gn.kind === 'diamond' ? G.dia : G.em);
      const lines = ['§eTier §c' + roman(info ? info.tier : 1), gn.kind === 'diamond' ? '§b§lDiamond' : '§2§lEmerald', '§eSpawns in §c' + (info ? Math.ceil(info.next / 1000) : '-') + ' §eseconds'];
      const key = 'gen:' + i, h = this.holos.get(key);
      if (h && h.lines.join('\n') === lines.join('\n')) return;
      this.holo(key, gn.x, gn.y + 2.2, gn.z, lines);
    });
  }

  /* ---- each tick (net.js) ---- */
  tick() {
    const g = this.game;
    if (!g || !g.ready) return;
    this.t++;
    const P = g.player, sv = g.survival;
    // the lobby's temporary blocks never run out
    if (this.area === 'lobby' && this.t % 20 === 0) {
      const inv = g.inv, tb = idOf(TEMP_BLOCK);
      let s = inv.slots.find(x => x && x.id === tb);
      if (!s && !inv.slots[1]) { inv.slots[1] = stack(TEMP_BLOCK, 64, { name: TEMP_NAME }); inv.changed(); }
      else if (s && s.count < 64) { s.count = 64; inv.changed(); }
    }
    for (const n of this.npcList) this.feed(n);
    // no hunger anywhere on the network
    sv.food = 20;
    if (this.area !== 'game') {
      // the lobby and the waiting rooms: nothing hurts, and falling off brings you back
      sv.health = sv.maxHealth;
      if (this.spawn && P.pos.y < this.floor) this.ctx.commandCtx().goTo(g.dim, this.spawn.x, this.spawn.y, this.spawn.z, this.spawn.yaw, 0);
      return;
    }
    this.items();
    if (!this.alive) return;
    // the void takes you at once
    if (P.pos.y < this.floor && !sv.dead) { this.voided = true; sv.hurt(3.4e38, 'out_of_world'); return; }
    // Murder Mystery: ten gold makes a bow and an arrow; the detective's arrow comes back; a bow picked up is told to the server
    if (this.gameKind === 'murder') {
      const inv = g.inv, bowId = idOf('bow'), arrowId = idOf('arrow'), hasBow = inv.count(bowId) > 0;
      if (this.count('gold_ingot') >= 10 && this.role !== 'murderer') {
        this.take('gold_ingot', 10);
        if (!hasBow) inv.addStack(stack('bow'));
        inv.addStack(stack('arrow'));
        this.ctx.chat.add('§6You got a bow and an arrow for 10 gold!', 0xFFFFFF);
        this.sound('entity.player.levelup');
      }
      if (inv.count(bowId) > 0 && !this.hadBow) { this.hadBow = true; this.send({ k: 'bow' }); }
      if (this.role === 'detective' && hasBow && inv.count(arrowId) === 0) { if (++this.arrowT >= 100) { this.arrowT = 0; inv.addStack(stack('arrow')); } } else this.arrowT = 0;
    }
    // The Bridge: the arrow comes back three and a half seconds after it is gone
    if (this.gameKind === 'bridge') {
      const inv = g.inv;
      if (inv.count(idOf('bow')) > 0 && inv.count(idOf('arrow')) === 0) { if (++this.arrowT >= 70) { this.arrowT = 0; inv.addStack(stack('arrow')); } } else this.arrowT = 0;
    }
    // Spleef: nothing hurts but the void
    if (this.gameKind === 'spleef') { sv.health = sv.maxHealth; P.fallDistance = 0; }
    // Build Battle: you stay over your own plot while building
    if (this.gameKind === 'buildbattle') {
      sv.health = sv.maxHealth;
      const p = this.plot;
      if (p && !this.vote && this.spawn && (P.pos.x < p.x0 - 1 || P.pos.x > p.x1 + 2 || P.pos.z < p.z0 - 1 || P.pos.z > p.z1 + 2 || P.pos.y > p.y1 + 6 || P.pos.y < p.y0 - 2)) {
        this.ctx.commandCtx().goTo(g.dim, this.spawn.x, this.spawn.y, this.spawn.z, P.yaw, P.pitch);
        this.ctx.chat.add('§cYou can\'t leave your plot!', 0xFF5555);
      }
    }
    // Prop Hunt: a hider standing still for two seconds locks into the block grid; moving off unlocks
    if (this.hide && this.hide.kind === 'prophunt' && this.role === 'hider' && this.disguise) {
      const moving = Math.hypot(P.vel.x, P.vel.z) > 0.01 || !P.onGround;
      if (this.lockAt) { if (Math.hypot(P.pos.x - (this.lockAt[0] + 0.5), P.pos.z - (this.lockAt[2] + 0.5)) > 0.35 || Math.abs(P.pos.y - this.lockAt[1]) > 0.6) { this.lockAt = null; this.send({ k: 'lock', at: null }); } }
      else if (moving) this.still = 0;
      else if (++this.still >= 40) {
        this.lockAt = [Math.floor(P.pos.x), Math.floor(P.pos.y + 0.01), Math.floor(P.pos.z)];
        P.pos.x = this.lockAt[0] + 0.5; P.pos.z = this.lockAt[2] + 0.5; if (P.prev) { P.prev.x = P.pos.x; P.prev.z = P.pos.z; }
        this.send({ k: 'lock', at: this.lockAt });
        this.titleT = { t: '', s: '§aLocked in place', fi: 0, st: 20, fo: 5, at: performance.now() }; this.overlay.animates = true;
      }
    }
    // TNT Run: space pressed twice quickly (the second in the air) is a double jump, while any are left; one press is a
    // plain jump. Nothing hurts but the void
    if (this.gameKind === 'tntrun') {
      sv.health = sv.maxHealth; P.fallDistance = 0;
      const down = !!P.keys[' '], pressed = down && !this.jumpHeld, quick = pressed && this.t - (this.jumpAt || -99) <= 6;
      if (pressed) this.jumpAt = this.t;
      if (quick && !P.onGround && !P.flying && this.jumps > 0) {
        this.jumpAt = -99;
        P.vel.y = 0.75; P.vel.x += -Math.sin(P.yaw) * 0.45; P.vel.z += -Math.cos(P.yaw) * 0.45; P.fallDistance = 0;
        this.jumps--;
        this.sound('entity.bat.takeoff');
        this.titleT = { t: '', s: '§eDouble jumps left: §a' + this.jumps, fi: 0, st: 25, fo: 5, at: performance.now() }; this.overlay.animates = true;
      }
      this.jumpHeld = down;
    }
    if (this.gameKind !== 'bedwars') return;
    if (this.t % 10 === 0) this.applyUpgrades(false);
    if (this.t % 20 === 0) {
      const up = this.up || {};
      if (up.haste) sv.addEffect('haste', up.haste, 60, { ambient: true });
      // the heal pool: Regeneration I on your own island
      const T = this.team;
      if (up.heal && T && T.centre && Math.hypot(P.pos.x - T.centre.x, P.pos.z - T.centre.z) <= T.radius) sv.addEffect('regeneration', 1, 60, { ambient: true });
      // (beds broken drop nothing worth keeping)
      const inv = g.inv;
      for (let i = 0; i < 36; i++) { const s = inv.slots[i]; if (s && BLOCKS[s.id] && BLOCKS[s.id].shape === 'bed') { inv.slots[i] = null; inv.changed(); } }
    }
  }
  // TNT lights itself as it goes down; a bridge egg lays wool behind it; a pop-up tower goes up
  items() {
    const g = this.game, w = g.world;
    for (const [x, y, z] of this.tnt.splice(0)) {
      if (w.get(x, y, z) !== B.tnt || !g.sim || !g.sim.primeTnt) continue;
      w.set(x, y, z, 0, 0);
      g.sim.primeTnt(x, y, z, g.entities && g.entities.player, 52);
      this.sound('entity.tnt.primed');
    }
    const E = g.entities, wool = B[this.team ? this.team.wool : 'white_wool'];
    if (E && this.bridgeAt !== undefined && this.t - this.bridgeAt <= 3) {
      for (const e of E.list) if (e.type === 'egg' && e.owner === E.player && !e.removed && !this.eggs.some(q => q.e === e)) { this.eggs.push({ e, sx: e.pos.x, sz: e.pos.z, last: null }); this.bridgeAt = undefined; break; }
    }
    this.eggs = this.eggs.filter(q => {
      const e = q.e;
      if (e.removed || Math.hypot(e.pos.x - q.sx, e.pos.z - q.sz) > 30) return false;
      const x = Math.floor(e.pos.x), y = Math.floor(e.pos.y) - 2, z = Math.floor(e.pos.z);
      // (the cell under the egg, and the one beside it on the way from the last, so the bridge can be walked)
      const put = (cx, cy, cz) => { if (!w.get(cx, cy, cz) && this.mayPlace(cx, cy, cz, true)) w.set(cx, cy, cz, wool, 0); };
      if (q.last && q.last[0] !== x && q.last[2] !== z) put(x, y, q.last[2]);
      put(x, y, z);
      q.last = [x, y, z];
      return true;
    });
    if (this.tower.length) {
      for (const [x, y, z, b, m] of this.tower.splice(0, 8)) if (!w.get(x, y, z) && this.mayPlace(x, y, z, true)) w.set(x, y, z, b, m);
      if (this.t % 3 === 0) this.sound('block.wool.place');
    }
  }
  frame(now, dt, eye) {
    const g = this.game;
    if (!g || !this.npcs) return;
    this.npcs.frame(now, dt, g.world, 0, eye, 96, g.mode === 'spectator');
    // (their own name tags stay hidden: the words over them are the holograms)
    for (const r of this.npcs.list.values()) if (r.tag) r.tag.far.visible = r.tag.near.visible = false;
    // Murder Mystery: nobody's name shows over them
    if (this.hideNames && this.area === 'game' && this.net.players) for (const r of this.net.players.list.values()) if (r.tag) r.tag.far.visible = r.tag.near.visible = false;
    this.drawProps();
    this.applyPoses();
  }
  /* Prop Hunt: each disguised hider is drawn as their block, where they are
     (or in the cell they locked into); their own model is not drawn. */
  drawProps() {
    const R = this.ctx.renderer, players = this.net.players, w = this.game.world;
    // you, in your own disguise: your body hidden, the block where you stand (seen in third person)
    const me = this.net.id, A = R.avatar, mine = this.props.get(me) || (this.disguise ? { b: this.disguise, lock: this.lockAt } : null);
    if (A) A.hidden = !!mine;
    const all = new Map(this.props);
    if (mine) all.set(me, mine); else all.delete(me);
    for (const [id, m] of this.propMeshes) {
      const pr = all.get(id);
      if (!pr || pr.b !== m.b || m.mats !== R.mats) { this.group.remove(m.mesh); m.mesh.geometry.dispose(); this.propMeshes.delete(id); }
    }
    if (!all.size) return;
    for (const [id, pr] of all) {
      let r;
      if (id === me) { const P = this.game.player; r = { feet: P.pos, av: null }; }
      else { r = players && players.list.get(id); if (!r || !r.feet) continue; }
      const av = r.av;
      if (av) { av.mesh.visible = av.armor.visible = false; for (const h of av.held) if (h) h.mesh.visible = false; if (av.headItem) av.headItem.mesh.visible = false; }
      if (r.tag) r.tag.far.visible = r.tag.near.visible = false;
      let m = this.propMeshes.get(id);
      if (!m) {
        const d = BLOCKS[B[pr.b]];
        if (!d) continue;
        let geo;
        try { geo = blockGeometry(d, 0); } catch (e) { continue; }
        const mesh = new THREE.Mesh(geo.geometry, geo.cutout ? R.mats.cutout : R.mats.opaque);
        mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        m = { mesh, b: pr.b, mats: R.mats, lv: -1 };
        this.propMeshes.set(id, m);
      }
      const x = pr.lock ? pr.lock[0] + 0.5 : r.feet.x, y = pr.lock ? pr.lock[1] : r.feet.y, z = pr.lock ? pr.lock[2] + 0.5 : r.feet.z;
      m.mesh.matrix.makeTranslation(x, y - 0.5, z);
      m.mesh.matrixWorldNeedsUpdate = true;
      const v = lightNear(w, Math.floor(x), Math.floor(y + 0.5), Math.floor(z), !!w.noSky), lv = (Math.round((v >> 4) / 15 * 255) << 8) | Math.round((v & 15) / 15 * 255);
      if (lv !== m.lv) { m.lv = lv; const L = m.mesh.geometry.attributes.aL; if (L) { for (let i = 0; i < L.count; i++) { L.array[i * 4] = lv >> 8; L.array[i * 4 + 1] = lv & 255; } L.needsUpdate = true; } }
    }
  }
  // Chameleon is played at half size: you (your box, eyes and body) and everyone you see
  applySize() {
    const k = this.area === 'game' && this.gameKind === 'chameleon' ? 0.5 : 1, g = this.game;
    playerSize.k = k;
    if (g && g.player && g.player.setScale) g.player.setScale(k);
    // (and nobody in it is hurt by a block at the eyes: half-size players squeeze into places, and paint against walls)
    if (g && g.survival) g.survival.noSuffocate = k !== 1;
    // and everyone in it climbs walls by holding jump against them (never the barriers round the map, or anyone could climb out)
    if (g && g.player) { g.player.wallClimb = k !== 1; g.player.noBarrierClimb = true; }
    const A = this.ctx && this.ctx.renderer && this.ctx.renderer.avatar;
    if (A) A.size = k;
  }
  // Chameleon: a hider's pose, or a seeker's aim while crouching, on every body drawn (none anywhere else)
  applyPoses() {
    // (and Prop Hunt's seekers never heal by themselves: a wrong hit's half heart stays lost)
    if (this.game.survival) this.game.survival.noRegen = this.area === 'game' && this.gameKind === 'prophunt' && this.role === 'seeker';
    const on = this.area === 'game' && this.gameKind === 'chameleon', A = this.ctx.renderer.avatar, P = this.game.player;
    if (A) A.poseOverride = !on ? null : this.role === 'seeker' ? (P.sneaking ? SNIPE : null) : (POSES[this.myPose | 0] || POSES[0])[1];
    const players = this.net.players;
    if (!players) return;
    for (const [id, r] of players.list) {
      if (!r.av) continue;
      if (!on) { r.av.poseOverride = null; continue; }
      const pz = this.poses && this.poses.get(id);
      r.av.poseOverride = pz ? (POSES[pz] || POSES[0])[1] : this.seekerIds && this.seekerIds.has(id) && r.st && (r.st.f & F.SNEAK) ? SNIPE : null;
    }
  }
  clearProps() {
    this.props = new Map(); this.disguise = null; this.lockAt = null; this.still = 0;
    // your body back, and the view you had before you disguised
    const A = this.ctx && this.ctx.renderer && this.ctx.renderer.avatar;
    if (A) { A.hidden = false; if (this.viewBefore !== undefined) { A.setView(this.viewBefore); this.viewBefore = undefined; } }
    for (const [, m] of this.propMeshes) { if (this.group) this.group.remove(m.mesh); m.mesh.geometry.dispose(); }
    this.propMeshes = new Map();
  }
  // Prop Hunt: a seeker's swing that lands on a real block (not a hider) costs half a heart
  seekerSwing(I2) {
    if (!this.hide || this.hide.kind !== 'prophunt' || this.role !== 'seeker' || !this.alive || this.area !== 'game') return;
    if (I2.lastEye) I2.look(I2.lastEye);
    if (I2.entityTarget || !I2.target || this.t - this.hitAt < 10) return;
    this.hitAt = this.t;
    const sv = this.game.survival;
    sv.health = Math.max(1, sv.health - 1);
    this.ctx.chat.add('§cThat block was not a hider! §7(-0.5 health)', 0xFF5555);
    this.sound('entity.player.hurt');
  }

  /* ---- Chameleon: your skin, painted, for this game only ---- */
  startPaint() {
    const o = this.ctx.gui.options, own = o.get('skin');
    const url = own && own !== 'default' ? own : new URL('../../textures/skin/default.png?v=64', import.meta.url).href;
    this.painter = new Painter(canvas => {
      const data = canvas.toDataURL('image/png');
      this.net.skinOverride = data;
      setOwnSkin(data, false);
      if (this.net.sendSkin) this.net.sendSkin();
    });
    // (a hider starts as a plain white figure, not their own skin)
    void url; this.painter.startBlank();
  }
  // a Chameleon seeker wears the seekers' skin for the game (Rhys the SWAT Agent, CC BY-SA 3.0, from the gallery)
  wearSeeker() {
    if (!this.net) return;
    const put = data => { if (this.role !== 'seeker' || this.gameKind !== 'chameleon' || this.area !== 'game') return; this.net.skinOverride = data; setOwnSkin(data, false); if (this.net.sendSkin) this.net.sendSkin(); };
    if (this.seekerSkin) { put(this.seekerSkin); return; }
    loadSkin64(new URL('../../textures/skin/gallery/swat_agent.png?v=64', import.meta.url).href).then(c => { if (c) { this.seekerSkin = c.toDataURL('image/png'); put(this.seekerSkin); } });
  }
  unpaint() {
    if (!this.painter && !(this.net && this.net.skinOverride)) return;
    this.painter = null; this.paintOn = false;
    if (this.net) this.net.skinOverride = null;
    if (!this.ctx) return;
    const o = this.ctx.gui.options, own = o.get('skin');
    setOwnSkin(own && own !== 'default' ? own : new URL('../../textures/skin/default.png?v=64', import.meta.url).href, own && own !== 'default' ? o.get('skinModel') === 'slim' : false);
    if (this.net.sendSkin) this.net.sendSkin();
  }

  /* ---- the sidebar and the titles ---- */
  draw(g) {
    const B2 = this.board;
    if (B2 && B2.lines.length && !(this.game && this.game.hideHud)) {
      const lines = B2.lines;
      let w = g.textWidth(B2.title);
      for (const l of lines) w = Math.max(w, g.textWidth(l) + 6);
      const n = lines.length, bottom = Math.floor(g.height / 2 + n * 9 / 3), top = bottom - n * 9;
      const right = g.width - 1, left = right - w - 2;
      g.fill(left - 2, top - 10, right, top - 1, 0x66000000);
      g.fill(left - 2, top - 1, right, bottom, 0x4C000000);
      g.centered(B2.title, Math.floor((left + right) / 2), top - 9, 0xFFFFFF, false);
      lines.forEach((l, i) => g.text(l, left, top + i * 9, 0xFFFFFF, false));
    }
    // what K does, over the hotbar while you wait (and that you are watching, while you watch)
    if (this.area === 'wait' && (this.startable || this.watching) && !(this.game && this.game.hideHud)) {
      const msg = this.watching ? '§eSpectating §7- you will play in the next round' : '§ePress §a§lK §eto start the game';
      const x = Math.floor(g.width / 2), y = g.height - 72, w = g.textWidth(msg);
      g.fill(x - Math.ceil(w / 2) - 4, y - 3, x + Math.ceil(w / 2) + 4, y + 11, 0x66000000);
      g.centered(msg, x, y, 0xFFFFFF, true);
    }
    const T = this.titleT;
    if (T) {
      const t = (performance.now() - T.at) / 50, total = T.fi + T.st + T.fo;
      if (t >= total) { this.titleT = null; this.overlay.animates = false; return; }
      const a = t < T.fi ? t / Math.max(1, T.fi) : t < T.fi + T.st ? 1 : 1 - (t - T.fi - T.st) / Math.max(1, T.fo);
      const c = g.ctx;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, a));
      c.translate(Math.floor(g.width / 2), Math.floor(g.height / 2));
      if (T.t) { c.save(); c.scale(4, 4); g.text(T.t, -Math.floor(g.textWidth(T.t) / 2), -10); c.restore(); }
      if (T.s) { c.save(); c.scale(2, 2); g.text(T.s, -Math.floor(g.textWidth(T.s) / 2), 5); c.restore(); }
      c.restore();
    }
  }
}

/* ---- the network's commands (each answers only on its server) ---- */
const onHub = (ctx, fn) => { if (!active || active.game !== ctx.game) { ctx.say('That command only works on Leon Network.', 0xFF5555); return; } fn(active); };
register('lobby', { always: true, aliases: ['l', 'hub', 'leave'], usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'lobby' })); } });
const MODE_IDS = ['bw_solo', 'bw_doubles', 'bw_3s', 'bw_4s', 'sw_solo', 'sw_doubles', 'duels_classic', 'duels_sumo', 'duels_bridge', 'duels_bedwars', 'duels_skywars', 'tntrun', 'murder', 'buildbattle', 'spleef', 'prophunt', 'ch_classic', 'ch_infection', 'ch_double'];
register('play', {
  always: true, usage: '<mode>', suggest: i => (i === 0 ? (active && active.modes && active.modes.length ? active.modes.map(m => m.id) : MODE_IDS) : []),
  run(args, ctx) { onHub(ctx, h => h.send({ k: 'play', mode: args[0] || 'bw_solo' })); },
});
register('start', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'start' })); } });
// the Map Editor's own: a name for a map made there, or the map gone
register('mapname', { always: true, usage: '<name>', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapname', name: args.join(' ') })); } });
register('mapdelete', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapdelete' })); } });
register('shout', { always: true, usage: '<message>', run(args, ctx) { onHub(ctx, h => h.send({ k: 'shout', text: args.join(' ') })); } });
register('hubbuild', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'build' })); } });
// parties, as the network has them: /party invite <player> (or just /party <player>), accept, leave, list, kick, transfer, disband; /pc talks to it
const PARTY_SUBS = ['invite', 'accept', 'leave', 'list', 'kick', 'transfer', 'disband', 'help'];
register('party', {
  always: true, aliases: ['p'], usage: '<invite|accept|leave|list|kick|transfer|disband> [player]',
  suggest: (i, w, ctx) => (i === 0 ? PARTY_SUBS : i === 1 && active && active.net && active.net.players ? [...active.net.players.list.values()].map(r => r.name) : []),
  run(args, ctx) { onHub(ctx, h => h.send({ k: 'party', a: args })); },
});
register('pc', { always: true, aliases: ['partychat'], usage: '<message>', run(args, ctx) { onHub(ctx, h => { if (args.length) h.send({ k: 'pchat', text: args.join(' ') }); else ctx.say('Usage: /pc <message>', 0xFF5555); }); } });
