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

import { B, BLOCKS, SOLID } from '../blocks.js?v=107';
import { I, ITEMS, maxStack } from '../items.js?v=107';
import { makeProfile, applyLayout, layoutKey } from './hubprofile.js?v=107';
import { makeLobbyCos } from './lobbycos.js?v=107';
import { POTIONS } from '../brewing.js?v=107';
import { creativeItems, entryId, HEADS } from '../ui/inventory.js?v=107';
import { DIM_IDS } from '../dims.js?v=107';
import { ChestScreen } from '../ui/containers.js?v=107';
import { Screen, Button, TextField, WHITE } from '../ui/gui.js?v=107';
import { RemotePlayers, playerSize, F } from './players.js?v=107';
import { register, commandDef } from '../commands.js?v=107';
import { Sound } from '../sound/sound.js?v=107';
import { RES_OVERRIDE, BLAST_FILTER } from '../explosion.js?v=107';
import { Painter, PaintScreen, faceColour, faceOfNormal, loadSkin64, pickAtCentre } from '../ui/paint.js?v=107';
import { blockGeometry } from '../render/blockmesh.js?v=107';
import { lightNear } from '../lightlevel.js?v=107';
import { setSkin as setOwnSkin, invisLook, capeRule, getSkinSettings } from '../render/avatar.js?v=107';
// the Profile item's head wears your own skin (ui/inventory.js drawHead)
HEADS.self = () => getSkinSettings().skin;
// each game's person on the stand wears its own skin for the game: our own 64 x 64 skins, drawn in code by
// tools/leoncraft2/build_npc_skins.py into textures/skin/npc/<game>.png (a game not listed gets the default skin)
// a hider's own body while they watch (watchFrame), drawn on their page as a stand-in; the Spectate item's name
const SPEC_BODY = -3001, WATCH_NAME = '§dSpectate §7- Right Click (or L) to leave your body and watch the others';
const NPC_SKIN = new Set(['chameleon', 'pillars', 'bedwars', 'skywars', 'deathswap', 'duels', 'prophunt', 'murder', 'tntrun', 'spleef', 'bridger', 'buildbattle']);
const npcSkinUrl = game => new URL('../../textures/skin/npc/' + game + '.png?v=107', import.meta.url).href;

const THREE = window.THREE;
let active = null;                     // the hub on this page, for its commands
// (no advancement or recipe toasts on the network: its games are not survival)
import('../adv/toast.js?v=107').then(m => {
  const T = m.AdvToast, add = T.add, rec = T.addRecipes;
  T.add = function (x) { if (active) return; return add.call(this, x); };
  T.addRecipes = function (ids) { if (active) return; return rec.call(this, ids); };
}).catch(() => {});

const idOf = name => (I[name] !== undefined ? I[name] : B[name] !== undefined ? B[name] : 0);
// the lobby's temporary blocks: place them anywhere in the lobby, the server takes them away again after 5 s
const TEMP_BLOCK = 'white_wool', TEMP_NAME = '§bTemporary Blocks §7- Place them, they vanish after 5 seconds';
// a stack of the network's: a name of its own is the thing it stands for ("Tag Stick", "Rifle", "Game Menu"), shown over
// the hotbar and at the top of the tooltip without the italics of a renamed item, and what it does ("- Right Click to ...")
// goes on a grey line under it (lore)
const stack = (name, count = 1, extra) => {
  const id = idOf(name);
  if (!id) return null;
  const s = Object.assign({ id, count }, extra || null);
  if (typeof s.name === 'string') {
    const m = s.name.match(/^(.*?) §7(?:- )?(.+)$/);
    if (m) { s.name = m[1]; s.lore = [m[2].replace(/^\((.*)\)$/, '$1')]; }
    s.plain = true;
  }
  return s;
};
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
// (big: three and four a team, where TNT costs twice as much, as in the mode's own shop)
function shopItems(team, big) {
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
      { id: 'tnt', name: 'TNT', price: C('gold', big ? 8 : 4), give: () => [stack('tnt')], icon: 'tnt', lore: ['Instantly ignites, appropriate', 'to explode things!'] },
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
      if (act && !this.inv.carried) { act(button); this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); this.inv.changed(); }
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
    const items = shopItems(hub.team || { wool: 'white_wool', clay: 'white_terracotta', glass: 'white_stained_glass' }, hub.prices | 0);
    CATEGORIES.forEach((c, i) => {
      const st = stack(c.icon); if (!st) return;
      st.name = '§a' + c.name;
      this.put(i, st, ['§a' + c.name, '§eClick to view!'], () => { hub.shopCat = c.id; });
      // the line under the categories: the open one marked in green
      this.put(9 + i, stack(c.id === cat ? 'lime_stained_glass_pane' : 'gray_stained_glass_pane'), [c.id === cat ? '§a↑ ' + c.name : '§8↑ Categories', '§8↓ Items'], null);
    });
    this.put(8, null, null, null); this.put(17, stack('gray_stained_glass_pane'), ['§8↑ Categories', '§8↓ Items'], null);
    const all = {}; for (const k in items) for (const it of items[k]) all[it.id] = it;
    const mine = hub.layouts && hub.layouts['bw:quick'] && Array.isArray(hub.layouts['bw:quick'].s) ? hub.layouts['bw:quick'].s : null;
    if (cat === 'quick') (mine || QUICK).forEach((id, n) => { if (all[id] && n < GRID.length) this.offer(GRID[n], all[id]); });
    else (items[cat] || []).forEach((it, n) => { if (n < GRID.length) this.offer(GRID[n], it); });
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
  duels_bridge: 'blue_terracotta', duels_bedwars: 'red_bed', duels_skywars: 'ender_eye', buildbattle: 'bricks', spleef: 'diamond_shovel', prophunt: 'oak_leaves', ch_classic: 'brush', ch_infection: 'rotten_flesh', ch_double: 'ender_pearl',
  pillars: 'bedrock', deathswap: 'ender_pearl', bridger: 'sandstone' };
const GAME_ICON = { bedwars: 'red_bed', skywars: 'ender_eye', duels: 'iron_sword', tntrun: 'tnt', murder: 'bow', buildbattle: 'bricks', spleef: 'diamond_shovel', prophunt: 'oak_leaves', chameleon: 'brush', pillars: 'bedrock', deathswap: 'ender_pearl', bridger: 'sandstone' };
// Quick Play, at the top of the compass and of every game's menu: into the mode with the most people in it (of that game,
// or of every game from the compass), so you meet others; with nobody about anywhere, a mode at random
function quickPlay(menu, hub, game) {
  const st = stack('nether_star') || stack('emerald');
  if (!st) return;
  const modes = (hub.modes || []).filter(m => !game || (m.menu || m.game) === game);
  if (!modes.length) return;
  st.name = '§aQuick Play';
  menu.put(4, st, ['§aQuick Play', game ? '§7Join the busiest mode of this game.' : '§7Join the busiest game on the network.', '§7(a random one if nobody is playing)', '', '§eClick to play!'], () => {
    const n = m => (hub.counts ? hub.counts[m.id] | 0 : 0), top = Math.max(0, ...modes.map(n));
    const pool = modes.filter(m => n(m) === top), m = pool[Math.floor(Math.random() * pool.length)];
    hub.send({ k: 'play', mode: m.id }); hub.closeScreens();
  });
}
// what each mode is, in its menu (a line each in the tooltip); a mode not here shows its game's blurb
const MODE_BLURB = {
  bw_solo: ['Eight players, each on their', 'own island. Protect your bed', 'and break all the others.'],
  bw_doubles: ['Eight teams of two. Protect', 'your bed and break the others.'],
  bw_3s: ['Four teams of three. Protect', 'your bed and break the others.'],
  bw_4s: ['Four teams of four. Protect', 'your bed and break the others.'],
  sw_solo: ['Everyone on their own island.', 'Loot the chests, then be the', 'last one standing.'],
  sw_doubles: ['Teams of two on each island.', 'Be the last team standing.'],
  duels_classic: ['One against one with an iron', 'sword, a bow, a rod and', 'iron armour.'],
  duels_sumo: ['One against one with no items.', 'Knock the other off the ring.'],
  duels_bridge: ['One against one across a bridge.', 'Jump into their goal', 'to score.'],
  duels_bedwars: ['Bed Wars, one against one.'],
  duels_skywars: ['SkyWars, one against one.'],
  ch_classic: ['Hiders paint themselves to blend', 'into the map, then the seekers', 'come out. One hit finds a hider,', 'and a found hider is out.'],
  ch_infection: ['Hiders paint themselves to blend', 'in. A found hider becomes a', 'seeker, so the hunt grows', 'until nobody is left hidden.'],
  ch_double: ['Everyone paints and hides, then', 'everyone hunts everyone.', 'One hit finds someone, and the', 'last one still hidden wins.'],
  pillars: ['Everyone starts on a bedrock', 'pillar over the void and gets a', 'random item every 5 seconds.', 'Build, fight, and be the last', 'one standing.'],
  deathswap: ['Survival in a new random world.', 'At a random time everyone', 'swaps places. Set traps so', 'the one who lands in your spot', 'dies. Last one alive wins.'],
  bridger: ['Bridge 50 blocks to the end', 'island on a lane of your own.', 'Your fastest time goes on', 'the leaderboard.'],
};
// the Profile item's menus (net/hubprofile.js), made with this file's MenuScreen and helpers when first wanted
let PROFILE = null;
const shopAll = hub => { const items = shopItems(hub.team || { wool: 'white_wool', clay: 'white_terracotta', glass: 'white_stained_glass' }), all = {}; for (const k in items) for (const it of items[k]) { all[it.id] = it; it.cat = k; } return all; };
const profileMenus = () => PROFILE || (PROFILE = makeProfile({ MenuScreen, stack, ITEMS, QUICK, GRID, allShopItems: shopAll }));
// the lobby's cosmetics (net/lobbycos.js): hidden chests, hats, auras, trails, gadgets, the Backpack
let LOBBYCOS = null;
const lobbyCos = () => LOBBYCOS || (LOBBYCOS = makeLobbyCos({ MenuScreen, ChestScreen, stack, idOf }));
// Bridging's replays: the ghost's number among the NPCs, and the menu of runs (your best and the board's top ten)
const REPLAY_ID = -3000;
class ReplayMenu extends MenuScreen {
  constructor(hub, m) { super(hub, 'Bridging Replays'); this.runs = m; this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); }
  fillBox() {
    const hub = this.hub, D = this.runs;
    if (!D) return;
    const t = ms => (ms / 1000).toFixed(3) + 's';
    const watch = k => () => { hub.send({ k: 'brreplay', who: k }); hub.closeScreens(); };
    const mine = stack('player_head', 1) || stack('name_tag', 1);
    if (mine) {
      mine.name = D.mine ? '§aYour Best Run' : '§7No run of yours yet';
      this.put(4, mine, D.mine ? [mine.name, '§e' + t(D.mine.ms), '', '§eClick to watch it!'] : [mine.name, '§7Set a personal best and', '§7it is kept here to watch.'], D.mine ? watch(D.mine.k) : null);
    }
    (D.top || []).forEach((e, i) => {
      const st = stack(i === 0 ? 'gold_block' : i === 1 ? 'iron_block' : i === 2 ? 'copper_block' : 'sandstone', 1) || stack('paper', 1);
      if (!st) return;
      st.name = (i === 0 ? '§6' : i === 1 ? '§h' : i === 2 ? '§g' : '§e') + '#' + (i + 1) + ' §f' + e.name;
      this.put(19 + (i % 7) + Math.floor(i / 7) * 9, st, [st.name, '§e' + t(e.ms), '', e.has ? '§eClick to watch it!' : '§7No replay of this run.'], e.has ? watch(e.k) : null);
    });
    if (!(D.top || []).length) { const st = stack('barrier', 1); if (st) { st.name = '§7Nobody has a time yet'; this.put(22, st, [st.name], null); } }
  }
}
// the lobby's launch pad: its throw, out and up (blocks a tick), landing a few blocks short of the games' people
const PAD_OUT = 0.4375, PAD_UP = 0.53125;
// the lobby compass shows every game (a click opens that game's own menu); a person on the stand shows their game's modes
class GameMenu extends MenuScreen {
  constructor(hub, game) { const g = game && (hub.games || []).find(x => x.id === game); super(hub, g ? g.name : 'Game Menu'); this.only = game || null; this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); hub.send({ k: 'counts' }); }
  fillBox() {
    const hub = this.hub;
    quickPlay(this, hub, this.only);
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
        const about = (MODE_BLURB[m.id] || [g.blurb || '']).map(l => '§7' + l);
        this.put(start + i, st, ['§a' + m.name, ...about, '', ...(n === null ? [] : ['§7' + n + ' currently playing!']), '§eClick to play!'], () => { hub.send({ k: 'play', mode: m.id }); hub.closeScreens(); });
      });
    });
  }
}
// the map lists' orders (the sort button cycles them): most liked, the best likes to dislikes, the newest, A to Z
const SORTS = [['liked', 'Most Liked'], ['ratio', 'Best Ratio'], ['newest', 'Newest'], ['az', 'A to Z']];
function sortMaps(list, mode) {
  const ratio = m => ((m.up | 0) + 1) / ((m.down | 0) + 1);
  const by = mode === 'ratio' ? (a, b) => ratio(b) - ratio(a) || (b.up | 0) - (a.up | 0)
    : mode === 'newest' ? (a, b) => (b.created || 0) - (a.created || 0)
    : mode === 'az' ? (a, b) => String(a.name).localeCompare(String(b.name))
    : (a, b) => (b.up | 0) - (a.up | 0) || ratio(b) - ratio(a);
  return list.slice().sort(by);
}
const STATUS = { draft: '§7Draft', pending: '§eWaiting for approval', approved: '§aApproved', denied: '§cDenied' };
const likes = m => '§a✔ ' + (m.up | 0) + '  §c✘ ' + (m.down | 0);
function sortButton(menu, slot) {
  const hub = menu.hub, cur = SORTS.find(x => x[0] === hub.sortMode) || SORTS[0], st = stack('hopper');
  if (!st) return;
  st.name = '§eSort: §f' + cur[1];
  menu.put(slot, st, ['§eSort: §f' + cur[1], '', ...SORTS.map(x => (x[0] === cur[0] ? '§a▶ ' : '§7  ') + x[1]), '', '§eClick to change!'], () => {
    const i = SORTS.findIndex(x => x[0] === cur[0]); hub.sortMode = SORTS[(i + 1) % SORTS.length][0];
  });
}
// the Map Editor, in Prop Hunt's and Chameleon's menus: anyone makes their own maps (a mod or an admin approves them for the vote)
function editorEntry(menu, hub, game, slot) {
  const st = stack('writable_book');
  if (!st) return;
  st.name = '§aMap Editor';
  menu.put(slot, st, ['§aMap Editor', '§7Make your own maps for this game,', '§7share them with your building team,', '§7and send them to be approved', '§7for the vote.', '', '§eClick to open!'], () => hub.send({ k: 'editor', game }));
}
// a time gone by, short: just now, 12 min ago, 3 h ago, 2 days ago
const ago = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };
// a list of maps 28 to a page, with arrows in the bottom corners when there is more than one page
function mapPage(menu, maps) {
  const pages = Math.max(1, Math.ceil(maps.length / 28));
  menu.page = Math.max(0, Math.min(pages - 1, menu.page | 0));
  const prev = stack('arrow'), next = stack('arrow');
  if (prev && menu.page > 0) { prev.name = '§aPrevious Page'; menu.put(45, prev, ['§aPrevious Page', '§7Page ' + menu.page + ' of ' + pages], () => { menu.page--; }); }
  if (next && menu.page < pages - 1) { next.name = '§aNext Page'; menu.put(53, next, ['§aNext Page', '§7Page ' + (menu.page + 2) + ' of ' + pages], () => { menu.page++; }); }
  return maps.slice(menu.page * 28, menu.page * 28 + 28);
}
// a map being built: one not in the vote yet (a draft, waiting or denied), or one somebody is in the editor on now
const beingBuilt = m => (m.now && m.now.length > 0) || (m.custom && m.status !== 'approved');
class EditorMenu extends MenuScreen {
  constructor(hub, game, maps, staffList, canMake) { super(hub, 'Map Editor'); this.game = game; this.maps = maps || []; this.staffList = !!staffList; this.canMake = canMake !== false; this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); }
  fillBox() {
    const hub = this.hub, all = sortMaps(this.maps || [], hub.sortMode);
    // (staff see every map, the ones being built first, unapproved and in progress, each part in the chosen order;
    //  or only those)
    const built = this.staffList ? all.filter(beingBuilt) : [], only = this.staffList && hub.editOnly;
    const maps = !this.staffList ? all : only ? built : built.concat(all.filter(m => !beingBuilt(m)));
    mapPage(this, maps).forEach((m, i) => {
      const st = stack(m.custom ? 'map' : 'filled_map') || stack('paper');
      if (!st) return;
      st.name = '§a' + m.name;
      const tip = ['§a' + m.name, '§7by §f' + m.by, m.custom ? STATUS[m.status] || '' : '§7Leonpixel\'s own (staff only)', likes(m)];
      if (m.custom && m.editors && m.editors.length) tip.push('§7Team: §f' + m.editors.slice(0, 4).join(', ') + (m.editors.length > 4 ? '...' : ''));
      if (m.now && m.now.length) { st.ench = { unbreaking: 1 }; tip.push('§aBuilding now: §f' + m.now.slice(0, 4).join(', ') + (m.now.length > 4 ? '...' : '')); }
      if (m.custom && m.changed) tip.push('§7Last changed ' + ago(m.changed));
      tip.push('', '§eClick to edit!');
      if (this.staffList) tip.push('§eRight Click to look round it!');
      this.put(10 + (i % 7) + Math.floor(i / 7) * 9, st, tip, b => {
        hub.send({ k: b === 2 && this.staffList ? 'mapspectate' : 'edit', game: this.game, id: m.id }); hub.closeScreens();
      });
    });
    if (!maps.length) {
      const st = stack('barrier');
      if (st) { st.name = only ? '§7No maps being built' : '§7No maps yet'; this.put(22, st, only ? ['§7No maps being built', '§7Every players\' map is in the vote,', '§7and nobody is building one now.'] : ['§7No maps yet', '§7Make one with Create New Map,', '§7or ask to help build someone else\'s.'], null); }
    }
    sortButton(this, 47);
    if (this.staffList) {
      const f = stack(only ? 'brick' : 'bricks');
      if (f) {
        const n = built.length;
        f.name = '§eShow: §f' + (only ? 'Being Built' : 'All Maps');
        this.put(48, f, ['§eShow: §f' + (only ? 'Being Built' : 'All Maps'), '', (only ? '§7  ' : '§a▶ ') + 'All Maps §8(' + all.length + ')', (only ? '§a▶ ' : '§7  ') + 'Being Built §8(' + n + ')', '§8Drafts, waiting, denied, and any', '§8map someone is in the editor on now.', '', '§eClick to change!'], () => { hub.editOnly = !only; this.page = 0; });
      }
    }
    const nw = stack('anvil');
    if (nw && this.canMake) { nw.name = '§aCreate New Map'; this.put(49, nw, ['§aCreate New Map', '§7Starts as a flat field of grass.', '§7A mod or an admin approves it', '§7before it goes in the vote.', '', '§eClick to make one!'], () => { hub.send({ k: 'newmap', game: this.game }); hub.closeScreens(); }); }
    const ob = stack('compass');
    if (ob) { ob.name = '§bOther Players\' Maps'; this.put(51, ob, ['§bOther Players\' Maps', '§7Ask to join a map\'s building team.', '', '§eClick to browse!'], () => hub.send({ k: 'mapbrowse', game: this.game })); }
  }
}
// the players' approved maps that are not yours: a click asks their maker to let you on the building team
class BrowseMenu extends MenuScreen {
  constructor(hub, game, maps) { super(hub, 'Other Players\' Maps'); this.game = game; this.maps = maps || []; this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); }
  fillBox() {
    const hub = this.hub, maps = sortMaps(this.maps || [], hub.sortMode);
    mapPage(this, maps).forEach((m, i) => {
      const st = stack('map') || stack('paper');
      if (!st) return;
      st.name = '§a' + m.name;
      this.put(10 + (i % 7) + Math.floor(i / 7) * 9, st, ['§a' + m.name, '§7by §f' + m.by, likes(m), '', m.asked ? '§eYou have asked to help build this.' : '§eClick to ask to join its building team!'],
        () => { if (!m.asked) { m.asked = true; hub.send({ k: 'mapjoinreq', game: this.game, id: m.id }); } });
    });
    if (!maps.length) { const st = stack('barrier'); if (st) { st.name = '§7No other maps yet'; this.put(22, st, ['§7No approved maps by other players yet.'], null); } }
    sortButton(this, 49);
  }
}
/* SkyWars kits: picked in the waiting room with the Kit Selector, kept in this browser (localStorage lc2_swkit), given
   in the cage as the round starts. Each is a small head start, as the network's are. */
const SW_KITS = [
  { id: 'default', name: 'Default', icon: 'wooden_pickaxe', lore: ['A wooden pickaxe, axe and shovel.'], give: () => [stack('wooden_pickaxe'), stack('wooden_axe'), stack('wooden_shovel')] },
  { id: 'armorer', name: 'Armorer', icon: 'golden_chestplate', lore: ['A gold chestplate, leggings and boots.'], armor: { 1: 'golden_chestplate', 2: 'golden_leggings', 3: 'golden_boots' } },
  { id: 'knight', name: 'Knight', icon: 'stone_sword', lore: ['A Sharpness I stone sword', 'and a gold helmet.'], give: () => [stack('stone_sword', 1, { ench: { sharpness: 1 } })], armor: { 0: 'golden_helmet' } },
  { id: 'archer', name: 'Archer', icon: 'bow', lore: ['A bow and 16 arrows.'], give: () => [stack('bow'), stack('arrow', 16)] },
  { id: 'builder', name: 'Builder', icon: 'bricks', lore: ['64 bricks and a stone pickaxe.'], give: () => [stack('bricks', 64), stack('stone_pickaxe')] },
  { id: 'healer', name: 'Healer', icon: 'golden_apple', lore: ['3 golden apples and a', 'potion of Regeneration.'], give: () => [stack('golden_apple', 3), stack('potion', 1, { potion: 'regeneration' })] },
  { id: 'enderman', name: 'Enderman', icon: 'ender_pearl', lore: ['2 ender pearls.'], give: () => [stack('ender_pearl', 2)] },
  { id: 'fisherman', name: 'Fisherman', icon: 'fishing_rod', lore: ['A fishing rod and 8 cooked cod.'], give: () => [stack('fishing_rod'), stack('cooked_cod', 8)] },
  { id: 'scout', name: 'Scout', icon: 'feather', lore: ['2 potions of Swiftness.'], give: () => [stack('potion', 2, { potion: 'swiftness' })] },
];
const swKitId = () => { try { const v = localStorage.getItem('lc2_swkit'); return SW_KITS.some(k => k.id === v) ? v : 'default'; } catch (e) { return 'default'; } };
class KitMenu extends MenuScreen {
  constructor(hub) { super(hub, 'SkyWars Kits'); }
  fillBox() {
    const cur = swKitId();
    SW_KITS.forEach((k, i) => {
      const on = k.id === cur, st = stack(k.icon) || stack('chest');
      if (!st) return;
      st.name = (on ? '§a§l' : '§a') + k.name;
      if (on) st.ench = { unbreaking: 1 };
      this.put(10 + (i % 7) + Math.floor(i / 7) * 9, st, ['§a' + k.name, ...k.lore.map(l => '§7' + l), '', on ? '§aSelected!' : '§eClick to select!'], () => {
        try { localStorage.setItem('lc2_swkit', k.id); } catch (e) { /* kept for this visit only */ }
        this.hub.swKit = k.id;
        this.hub.ctx.chat.add('§aYou selected the §e' + k.name + ' §akit!', 0xFFFFFF);
        this.hub.sound('block.note_block.pling');
      });
    });
  }
}
// Prop Hunt: the Disguise item's list, the round's rarer blocks of the map (each there at least twice); a click becomes it
class DisguiseMenu extends MenuScreen {
  constructor(hub) { super(hub, 'Disguise'); }
  fillBox() {
    const hub = this.hub, H = hub.hide || {}, list = H.props || [], counts = H.counts || [];
    const start = 9 + Math.max(1, Math.floor((9 - list.length) / 2));
    list.forEach((name, i) => {
      const st = stack(name);
      if (!st) return;
      const d = BLOCKS[B[name]], title = (d && d.display) || name.replace(/_/g, ' '), on = hub.disguise === name;
      st.name = (on ? '§a§l' : '§a') + title;
      if (on) st.ench = { unbreaking: 1 };
      const n = counts[i] | 0;
      this.put(start + i, st, ['§a' + title, '§7' + n + ' on this map', '', on ? '§aYou are this block!' : '§eClick to become it!'], () => {
        if (!(hub.area === 'game' && hub.alive && hub.role === 'hider')) return;
        hub.send({ k: 'disguise', b: name }); hub.disguiseAs(name); hub.closeScreens();
      });
    });
  }
}
// Build Battle's theme vote, from the item in the waiting room: the round's six themes and their votes
class ThemeMenu extends MenuScreen {
  constructor(hub) { super(hub, 'Theme Vote'); }
  fillBox() {
    const hub = this.hub, T = hub.themes || { list: [] };
    (T.list || []).forEach(([name, n], i) => {
      const mine = T.mine === name, st = stack(mine ? 'writable_book' : 'paper') || stack('paper');
      if (!st) return;
      st.name = (mine ? '§a§l' : '§a') + name;
      if (mine) st.ench = { unbreaking: 1 };
      this.put(11 + i + (i >= 5 ? 4 : 0), st, ['§a' + name, '', '§7Votes: §e' + n, '', mine ? '§aYou voted for this theme!' : '§eClick to vote!'], () => { hub.send({ k: 'themevote', theme: name }); });
    });
  }
}
class VoteMenu extends MenuScreen {
  constructor(hub) { super(hub, 'Map Vote'); }
  fillBox() {
    const hub = this.hub, V = hub.votes || { maps: [] };
    sortMaps(V.maps || [], hub.sortMode).slice(0, 28).forEach((m, i) => {
      const mine = V.mine === m.id, st = stack(mine ? 'filled_map' : 'map') || stack('paper');
      if (!st) return;
      st.name = (mine ? '§a§l' : '§a') + m.name;
      if (mine) st.ench = { unbreaking: 1 };
      this.put(10 + (i % 7) + Math.floor(i / 7) * 9, st, ['§a' + m.name, '§7by §f' + (m.by || 'Leonpixel'), likes(m), '', '§7Votes: §e' + m.v, '', mine ? '§aYou voted for this map!' : '§eClick to vote!'],
        () => { hub.send({ k: 'mapvote', id: m.id }); });
    });
    sortButton(this, 49);
  }
}
/* Map Settings, from the item in the editor: the map's name, who is on its building team (and who asks to
   be), sending it to be approved, deleting it. What the server says (k 'mapinfo') fills it; each button
   sends one change, and the server answers with the map as it is now. */
class MapSettingsScreen extends Screen {
  constructor(hub, info) { super('Map Settings'); this.hub = hub; this.info = info; this.vals = { name: '', who: '' }; }
  set(info) { this.info = info; if (this.gui) { this.gui.screen === this && this.reinit(); } }
  reinit() { const g = this.gui; this.widgets = []; this.init(); g.markDirty(); }
  init() {
    const W = this.width, H = this.height, I = this.info || {}, hub = this.hub, mine = !!I.mine;
    const x0 = Math.floor(W / 2 - 160), y0 = 40;
    this.nameF = this.add(new TextField(x0, y0 + 26, 150, 18, { value: this.vals.name, maxLength: 24, hint: 'A new name', onChange: v => { this.vals.name = v; } }));
    this.add(new Button(x0 + 154, y0 + 25, 60, 20, 'Rename', () => { const n = this.nameF.value.trim(); if (n) { hub.send({ k: 'mapname', name: n }); this.vals.name = ''; } })).active = mine && I.custom;
    this.whoF = this.add(new TextField(x0, y0 + 52, 150, 18, { value: this.vals.who, maxLength: 16, hint: 'A player\'s name', onChange: v => { this.vals.who = v; } }));
    this.add(new Button(x0 + 154, y0 + 51, 60, 20, 'Add', () => { const n = this.whoF.value.trim(); if (n) { hub.send({ k: 'mapshare', name: n, on: true }); this.vals.who = ''; } }, 'Let them build on this map')).active = mine && I.custom;
    // the team (left) and the requests to join it (right)
    this.rowsY = y0 + 92;
    (I.editors || []).slice(0, 6).forEach((n, i) => {
      this.add(new Button(x0 + 100, this.rowsY + i * 16, 50, 14, 'Remove', () => hub.send({ k: 'mapshare', name: n, on: false }))).active = mine;
    });
    (I.joinReqs || []).slice(0, 6).forEach((n, i) => {
      this.add(new Button(x0 + 270, this.rowsY + i * 16, 22, 14, '§a✔', () => hub.send({ k: 'mapjoin', name: n, ok: true }), 'Let them on the building team')).active = mine;
      this.add(new Button(x0 + 294, this.rowsY + i * 16, 22, 14, '§c✘', () => hub.send({ k: 'mapjoin', name: n, ok: false }), 'Turn them down')).active = mine;
    });
    const by = H - 28;
    const sub = this.add(new Button(W / 2 - 170, by, 130, 20, 'Submit for Approval', () => hub.send({ k: 'mapsubmit' }), 'A mod or an admin looks at it, then it goes in the vote'));
    sub.active = mine && I.custom && (I.status === 'draft' || I.status === 'denied');
    this.add(new Button(W / 2 - 36, by, 84, 20, '§cDelete Map', () => { if (this.sure) { hub.send({ k: 'mapdelete' }); this.gui.back(); } else { this.sure = true; this.reinit(); } }, 'Click twice: it cannot be undone')).active = mine && I.custom;
    this.add(new Button(W / 2 + 52, by, 118, 20, 'Done', () => this.gui.back()));
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    const I = this.info || {}, W = this.width, x0 = Math.floor(W / 2 - 160), y0 = 40;
    g.centered(this.title, W / 2, 10, WHITE);
    g.centered('§e' + (I.name || '') + ' §7by §f' + (I.by || '') + '   ' + (I.custom ? STATUS[I.status] || '' : '§7Leonpixel\'s own') + '   ' + likes(I), W / 2, 22, WHITE);
    g.text('§7Name', x0 + 220, y0 + 31, WHITE); g.text('§7Share with', x0 + 220, y0 + 57, WHITE);
    g.text('§fBuilding team', x0, this.rowsY - 12, WHITE);
    const ed = I.editors || [];
    if (!ed.length) g.text('§7Only you', x0, this.rowsY + 3, WHITE);
    ed.slice(0, 6).forEach((n, i) => g.text(n, x0, this.rowsY + i * 16 + 3, WHITE));
    g.text('§fAsking to join', x0 + 170, this.rowsY - 12, WHITE);
    const rq = I.joinReqs || [];
    if (!rq.length) g.text('§7Nobody yet', x0 + 170, this.rowsY + 3, WHITE);
    rq.slice(0, 6).forEach((n, i) => g.text(n, x0 + 170, this.rowsY + i * 16 + 3, WHITE));
    if (I.status === 'denied' && I.why) g.centered('§cNot approved: §f' + I.why, W / 2, this.height - 44, WHITE);
    else if (!I.mine) g.centered('§7Only the map\'s maker can change these.', W / 2, this.height - 44, WHITE);
  }
}
/* Chameleon's poses (the Pose item or V cycles them; everyone sees them through the server's 'poses'): the first
   Leoncraft's Mecha poses, with its own numbers (minecraft.html mcPoseModel). There the head, body and arms hang from
   an upper body that turns at the hip (12 pixels up) and drops by a number of pixels; here each part is placed for
   itself, so the upper body's turn is worked into each part's pivot and angles (S: head, body, right arm, left arm,
   right leg, left leg in the game's model space: x right, y down, angles in radians). */
const HALF = Math.PI / 2;
// LC1's poses: up (the upper body's turn about x), drop (pixels), then [rx, ry, rz] for head, armR, armL, legR, legL, in
// three.js's frame (y up), as LC1 sets them; a function of the time for the wave
const LC1_POSES = [
  ['Stand', null],
  ['Sit', { up: 0.14, drop: 12 * 0.78, head: [-0.1, 0, 0], armR: [0.55, 0, 0.14], armL: [0.55, 0, -0.14], legR: [-HALF, 0, 0], legL: [-HALF, 0, 0] }],
  ['Starfish', { up: 0, drop: 0, head: [-0.14, 0, 0], armR: [-0.12, 0, -1.4], armL: [-0.12, 0, 1.4], legR: [0, 0, -0.4], legL: [0, 0, 0.4] }],
  ['Lie Down', { up: -HALF, drop: 12 - 0.16 * 16, head: [0, 0, 0], armR: [0, 0, -0.28], armL: [0, 0, 0.28], legR: [-HALF, 0, 0], legL: [-HALF, 0, 0] }],
  ['Crouch', { up: 0.5, drop: 0.22 * 16, head: [-0.34, 0, 0], armR: [-0.45, 0, 0], armL: [-0.45, 0, 0], legR: [0, 0, 0], legL: [0, 0, 0] }],
  ['Wave', t => { const s = Math.sin(t * 5); return { up: 0, drop: 0, head: [0, 0.18, 0], armR: [-0.2, 0, -2.5 - s * 0.22], armL: [0.16, 0, 0], legR: [0, 0, 0], legL: [0, 0, 0] }; }],
];
// where each part's pivot rests in three.js's frame (the model's 24 - y and -z), and the hip the upper body turns at
const POSE_REST = [[0, 24, 0], [0, 24, 0], [-5, 22, 0], [5, 22, 0], [-1.9, 12, -0.1], [1.9, 12, -0.1]];
const poseM = { u: null, l: null, e: null, v: null };
function lc1Pose(spec) {
  return S => {
    const P = typeof spec === 'function' ? spec(performance.now() / 1000) : spec;
    if (!poseM.u) { poseM.u = new THREE.Matrix4(); poseM.l = new THREE.Matrix4(); poseM.e = new THREE.Euler(); poseM.v = new THREE.Vector3(); }
    const U = poseM.u.makeRotationX(P.up), L = poseM.l, E = poseM.e, v = poseM.v;
    const parts = [P.head, [0, 0, 0], P.armR, P.armL, P.legR, P.legL];
    for (let i = 0; i < 6; i++) {
      const r = POSE_REST[i], a = parts[i], upper = i < 4;
      v.set(r[0], r[1], r[2]);
      E.set(a[0], a[1], a[2], 'XYZ'); L.makeRotationFromEuler(E);
      if (upper) { v.y -= 12; v.applyMatrix4(U); v.y += 12; L.premultiply(U); }
      v.y -= P.drop;
      E.setFromRotationMatrix(L, 'ZYX');
      // back to the game's model space: y and z flip, so do the y and z turns (avatar.js matrices)
      const q = S[i]; q.x = v.x; q.y = 24 - v.y; q.z = -v.z; q.rx = E.x; q.ry = -E.y; q.rz = -E.z;
    }
  };
}
const POSES = LC1_POSES.map(([name, spec]) => [name, spec ? lc1Pose(spec) : null]);
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

/* Pillars of Fortune's random items: anything in the game's own list (the creative tabs, every block and item a player
   can have) but what would break the game or the network: operator blocks, the unbreakable and the unseen, portals, the
   bosses' and the worst mobs' spawn eggs, and the like. Potions, books and the rest come in each of their kinds, as the
   creative list has them. */
const POF_SKIP = /command_block|structure_|jigsaw|barrier|^light$|bedrock|debug_stick|end_portal|end_gateway|nether_portal|^portal$|spawner|vault$|knowledge_book|petrified|moving_piston|piston_head|^air$|cave_air|void_air|^water$|^lava$|bubble_column|^fire$|soul_fire|frosted_ice|reinforced_deepslate|^test_|dragon_egg|budding_amethyst|creaking_heart|wither_skeleton_skull|wither_skeleton_wall_skull|^player_head$|written_book|filled_map|^map$|(wither|ender_dragon|warden|elder_guardian|ghast|happy_ghast|giant|illusioner|ravager|evoker|vex|phantom|shulker|guardian|blaze|creaking|breeze|iron_golem|snow_golem|wither_skeleton|piglin_brute|hoglin|zoglin)_spawn_egg/;
let pofPool = null;
function pofItem() {
  if (!pofPool) {
    pofPool = [];
    const all = creativeItems().all || [];
    for (const e of all) {
      const id = entryId(e), d = ITEMS[id] || BLOCKS[id], name = d && d.name;
      if (!name || POF_SKIP.test(name)) continue;
      pofPool.push(e);
    }
  }
  if (!pofPool.length) return null;
  const e = pofPool[Math.floor(Math.random() * pofPool.length)];
  return typeof e === 'number' ? { id: e, count: 1 } : Object.assign({}, e, { count: 1, ench: e.ench ? Object.assign({}, e.ench) : e.ench });
}
// Bridging's block, which never runs out
const BR_BLOCK = 'sandstone';
/* Death Swap: somewhere to stand round a spot, as the game finds a spawn: down a column to the first block with a full
   top (leaves and logs count, never a fluid), two clear over it, the nearest such column out to 48 blocks; none (the
   sea): the top of the water there, and wet */
function dsStandY(w, x, z) {
  for (let y = 383; y > 0; y--) {
    const b = w.get(x, y, z);
    if (!b) continue;
    const d = BLOCKS[b];
    if (!d) return -1;
    // (water, and the plants that stand in it: seagrass, kelp, anything waterlogged)
    if (d.fluid || d.waterlogged || /seagrass|kelp/.test(d.name)) return -1;
    if (d.solid && d.shape === 'cube') return y + 1;
  }
  return -1;
}
function dsSpot(w, x, z) {
  const free = (xx, yy, zz) => { const b = w.get(xx, yy, zz); return !b || !BLOCKS[b] || !BLOCKS[b].solid; };
  for (let r = 0; r <= 48; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !w.loaded(x + dx, z + dz)) continue;
    const y = dsStandY(w, x + dx, z + dz);
    if (y > 0 && free(x + dx, y, z + dz) && free(x + dx, y + 1, z + dz)) return { x: x + dx + 0.5, y, z: z + dz + 0.5 };
  }
  for (let y = 383; y > 0; y--) if (w.get(x, y, z)) return { x: x + 0.5, y: y + 1, z: z + 0.5, wet: true };
  return { x: x + 0.5, y: 140, z: z + 0.5, wet: true };
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
    invisLook.hideArmor = true;
    this.overlay = { under: true, animates: false, draw: g => this.draw(g) };
    ctx.gui.overlays.push(this.overlay);
    this.npcs = new RemotePlayers(ctx.renderer, ctx.gui.font);
    // (sized as the players are: a Chameleon hider's own body, left standing while they watch, is half size; everyone on
    //  the stands and the Bridging ghost are full size, playerSize.k being 1 outside Chameleon)
    this.npcs.sized = true;
    this.cos = new (lobbyCos().LobbyCos)(this);
    this.group = new THREE.Group(); this.group.name = 'hub-holograms';
    ctx.renderer.scene.add(this.group);
    // a death is the minigame's: the server is told, you are made whole where you are, and it moves you on
    const hooks = game.survival.hooks;
    hooks.onDeath = (message, src) => this.died(src, message);
    // the people on the stands answer either button; what you hold in a lobby (the game menu, the way back) answers the right one
    const I2 = game.inter, use = I2.useWith.bind(I2), down = I2.down.bind(I2);
    // (a chest in the lobby may be a hidden one: asked before what you hold has its say)
    // (out of your body a held button's repeat does nothing: the press itself is down's, below, so a click held past a
    //  quarter of a second does not step you straight back in)
    I2.useWith = () => { if (this.spec) return true; if (this.clickNpc() || (this.area === 'lobby' && this.cos && this.cos.useTarget()) || this.useHeld()) return true; return use(); };
    // (a left click on a person opens their menu only when nothing nearer is under the crosshair: a player you are fighting in
    //  front of a shop takes the hit)
    // (out of your body a right click goes to useHeld alone: the Spectate item steps you back in, nothing else does anything)
    I2.down = b => { if (b === 2) this.pressN = (this.pressN | 0) + 1; if (this.spec) { if (b === 2) this.useHeld(); return; } if (b === 0 && !I2.entityTarget && this.clickNpc()) return; if (b === 0) this.seekerSwing(I2); down(b); };
    I2.mayBreak = (x, y, z) => this.mayBreak(x, y, z);
    // no dropping things anywhere on the network (but the Map Editor and /hubbuild): Q does nothing, and what is thrown
    // out of a screen goes back into the inventory (an inventory that is full still spills what it cannot hold)
    const H = game.hands, dropSel = H.dropSelected.bind(H), throwSt = H.throwStack.bind(H);
    const noDrop = () => this.area !== 'edit' && this.area !== 'ds' && !this.building && !(this.area === 'game' && this.gameKind === 'pillars'), said = () => { if (this.t - (this.dropSaid === undefined ? -99 : this.dropSaid) > 20) { this.dropSaid = this.t; this.ctx.chat.add("§cYou can't drop items here!", 0xFF5555); } };
    let giving = false;
    H.dropSelected = all => { if (noDrop()) { said(); return; } dropSel(all); };
    H.throwStack = st => {
      if (!st || !noDrop() || giving) return throwSt(st);
      giving = true;
      try { game.inv.addStack(st); if (game.inv.changed) game.inv.changed(); } finally { giving = false; }
      said();
    };
    // TNT and fireballs break only what players put down (and SkyWars' map): the map's own blocks stand, so none drop
    BLAST_FILTER.fn = (x, y, z) => this.blastBreaks(x, y, z);
    BLAST_FILTER.noDrops = () => this.area === 'game' && this.gameKind !== 'skywars';
    const brk = I2._breakTarget.bind(I2);
    I2._breakTarget = () => {
      const T = I2.target, before = T && this.dig ? game.world.get(T.x, T.y, T.z) : 0;
      const out = brk();
      if (before && this.area === 'game' && !game.world.get(T.x, T.y, T.z) && game.inv.count(idOf('snowball')) < 64) game.inv.add(idOf('snowball'), 1);
      return out;
    };
    I2.mayPlace = (x, y, z, b) => this.mayPlace(x, y, z, false, b);
    // the lobby's temporary blocks go down even in adventure
    I2.adventurePlace = id => this.area === 'lobby' && id === idOf(TEMP_BLOCK);
    this.unhook = () => { H.dropSelected = dropSel; H.throwStack = throwSt; I2.useWith = use; I2.down = down; I2._breakTarget = brk; I2.mayBreak = null; I2.mayPlace = null; I2.adventurePlace = null; };
    // every change seen while a game is on (yours and everyone's): those may be broken again, the map may not
    const net = this.net, blocks = net.blocks.bind(net), local = net.local.bind(net);
    net.blocks = (d, e) => { if (this.area === 'game') for (let i = 0; i + 4 < e.length; i += 5) this.changed.add(e[i] + ',' + e[i + 1] + ',' + e[i + 2]); return blocks(d, e); };
    net.local = (w, x, y, z, b, m, prev) => {
      /* a map's own block whose state this page's simulation changed by itself (a daylight detector following the sun):
         the server keeps the maps as they are, turns it down and puts it back, and the page changed it again a moment
         later, over and over (dozens of refused messages a minute from every page in a Murder Mystery house). Such a
         change stays on this page. Doors, trapdoors and gates still go (the server lets them open and shut), and so does
         everything in SkyWars, Death Swap, the Map Editor and /hubbuild, and any change to a block a player put down */
      if (b && (prev >> 8) === b && !this.changed.has(x + ',' + y + ',' + z) && this.area !== 'ds' && this.area !== 'edit' && !this.building && this.gameKind !== 'skywars' && !/(_door|_trapdoor|fence_gate)$/.test((BLOCKS[b] || {}).name || '')) return;
      if (this.area === 'game') { this.changed.add(x + ',' + y + ',' + z); if (b === B.tnt && this.alive) this.tnt.push([x, y, z]); }
      // (Bridging: a block put down during a run, into its recording by name)
      const RR = this.br && this.br.rec;
      if (RR && b && this.br.t0 && !this.br.done && RR.b.length < 1200) { const d = BLOCKS[b]; if (d) RR.b.push([RR.f.length, x - RR.o[0], y - RR.o[1], z - RR.o[2], d.name, m | 0]); }
      return local(w, x, y, z, b, m, prev);
    };
    // the shop's glass stands any explosion
    for (const n of ['red', 'blue', 'lime', 'yellow', 'cyan', 'white', 'pink', 'gray']) if (B[n + '_stained_glass'] !== undefined) RES_OVERRIDE.set(B[n + '_stained_glass'], 3600000);
    /* Prop Hunt: a disguised hider is hit where their block is drawn (a whole block, in its cell once locked), never by the
       standing player's box under it (thinner and twice as tall: a swing at the block's edge missed them and cost the
       seeker health, one at the air over it found them); arrows meet the same block (proxyOf) */
    const hub = this, pick0 = net.pickPlayer, proxy0 = net.proxyOf;
    const boxOf = id => {
      const pr = this.area === 'game' && this.hide && this.hide.kind === 'prophunt' && this.props.get(id);
      if (!pr) return null;
      if (pr.lock) return [pr.lock[0], pr.lock[1], pr.lock[2]];
      const r = net.players && net.players.list.get(id);
      return r && r.feet ? [r.feet.x - 0.5, r.feet.y, r.feet.z - 0.5] : null;
    };
    net.pickPlayer = function (E, eye, blockT, found) {
      const res = pick0.call(this, E, eye, blockT, found);
      if (!hub.hide || hub.area !== 'game' || !this.players || this.game.mode === 'spectator') return res;
      const P = this.game.player, dx = -Math.sin(P.yaw) * Math.cos(P.pitch), dy = Math.sin(P.pitch), dz = -Math.cos(P.yaw) * Math.cos(P.pitch);
      // Chameleon: the Tag Stick finds a small hider as the Rifle does, within 0.64 of their middle (their own half size box
      // is a sliver to swing at)
      if (hub.hide.kind === 'chameleon') {
        let lim = Math.min(E.combat.reach(), blockT === undefined ? Infinity : blockT), best = null;
        if (res && res.remotePlayer) { const f = res.pos; lim = Math.min(lim, Math.hypot(f.x - eye.x, f.y + res.h / 2 - eye.y, f.z - eye.z)); best = res; }
        for (const r of this.players.list.values()) {
          if (!this.hittable(r, r.st ? r.st.d : 0) || playerSize.of(r.id) >= 1) continue;
          const f = r.feet, mx = f.x - eye.x, my = f.y + 0.45 - eye.y, mz = f.z - eye.z, along = mx * dx + my * dy + mz * dz;
          if (along > 0 && along < lim && (mx * mx + my * my + mz * mz) - along * along <= 0.64 * 0.64) { lim = along; best = this.proxyOf(r); }
        }
        return best || res;
      }
      if (!hub.props.size || hub.hide.kind !== 'prophunt') return res;
      const along = (x0, y0, z0, x1, y1, z1) => {
        let t0 = 0, t1 = Infinity;
        for (const [o, d, a, b] of [[eye.x, dx, x0, x1], [eye.y, dy, y0, y1], [eye.z, dz, z0, z1]]) {
          if (Math.abs(d) < 1e-9) { if (o < a || o > b) return Infinity; continue; }
          let ta = (a - o) / d, tb = (b - o) / d;
          if (ta > tb) { const s = ta; ta = tb; tb = s; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) return Infinity;
        }
        return t0;
      };
      const resId = res && res.remotePlayer ? +String(res.id).slice(1) : null, disguised = resId !== null && hub.props.has(resId);
      let lim = Math.min(E.combat.reach(), blockT === undefined ? Infinity : blockT), best = null;
      // (someone not disguised that the ordinary pick found, nearer than any block, keeps the hit)
      if (res && !disguised && res.remotePlayer) { const f = res.pos, w = res.hw; lim = Math.min(lim, along(f.x - w, f.y, f.z - w, f.x + w, f.y + res.h, f.z + w)); best = res; }
      const D = this.game.dim;
      for (const id of hub.props.keys()) {
        const r = this.players.list.get(id), b = boxOf(id);
        if (!r || !b || !this.hittable(r, r.st ? r.st.d : D)) continue;
        const t = along(b[0], b[1], b[2], b[0] + 1, b[1] + 1, b[2] + 1);
        if (t < lim) { lim = t; best = this.proxyOf(r); }
      }
      if (best) return best;
      return disguised ? found : res;
    };
    net.proxyOf = function (r) {
      const p = proxy0.call(this, r), b = boxOf(r.id);
      if (!b) return p;
      const q = Object.create(p);
      Object.defineProperties(q, { pos: { get: () => ({ x: b[0] + 0.5, y: b[1], z: b[2] + 0.5 }) }, hw: { value: 0.5 }, w: { value: 1 }, h: { value: 1, writable: true } });
      return q;
    };
    // Murder Mystery, as Hypixel's: the murderer cannot take up the bow the detective dropped
    net.mayTake = st => !(this.area === 'game' && this.gameKind === 'murder' && this.role === 'murderer' && st && st.id === idOf('bow'));
    this.unwrapNet = () => { net.blocks = blocks; net.local = local; net.pickPlayer = pick0; net.proxyOf = proxy0; net.mayTake = null; };
    // K in a shared waiting room starts the game (never while a screen or the chat is open)
    this.onKey = e => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || ctx.gui.screen) return;
      // Chameleon: B opens the Paint Brush and V is the next pose, as the items do
      const cham = this.area === 'game' && this.alive && this.hide && this.hide.kind === 'chameleon' && this.role === 'hider';
      if (e.code === 'KeyB' && cham) { this.openBrush(); return; }
      if (e.code === 'KeyV' && cham) { this.nextPose(); return; }
      if (e.code !== 'KeyK') return;
      if (this.area === 'wait' && this.startable) this.send({ k: 'start' });
      else if (this.area === 'wait' && this.watching) this.ctx.chat.add('§cA game is already on here. You will play in the next round.', 0xFFFFFF);
    };
    window.addEventListener('keydown', this.onKey);
    // a hider's L leaves the body and comes back to it, Left and Right ride round the others (the first Leoncraft's keys); caught
    // before the game's own listeners, so L does not open Advancements then
    this.onWatchKey = e => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || ctx.gui.screen) return;
      const k = e.code;
      if (k === 'KeyL' && (this.spec || this.canWatch())) this.toggleWatch();
      else if ((k === 'ArrowLeft' || k === 'ArrowRight') && this.spec) this.watchNext(k === 'ArrowRight' ? 1 : -1);
      // out of a round (or come late to it) and watching: Left and Right go to the players still in it, as Hypixel's
      // spectators' Teleporter does
      else if ((k === 'ArrowLeft' || k === 'ArrowRight') && this.deadWatch()) this.teleportNext(k === 'ArrowRight' ? 1 : -1);
      else return;
      e.preventDefault(); e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', this.onWatchKey, true);
  }
  detach() {
    if (active === this) active = null;
    if (this.cos) { this.cos.leaveLobby(); this.cos.inLobby = false; }
    this.area = null; this.applySize();
    if (this.overlay) { const o = this.ctx.gui.overlays, i = o.indexOf(this.overlay); if (i >= 0) o.splice(i, 1); }
    if (this.npcs) { this.npcs.dispose(); this.npcs = null; }
    this.clearProps(); this.unpaint();
    this.clearHolos();
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    if (this.unhook) this.unhook();
    if (this.unwrapNet) this.unwrapNet();
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    if (this.onWatchKey) window.removeEventListener('keydown', this.onWatchKey, true);
    if (this.spec) this.endWatch(true);
    RES_OVERRIDE.clear(); BLAST_FILTER.fn = null; BLAST_FILTER.noDrops = null; invisLook.hideArmor = false; capeRule.off = false;
    this.game = null;
  }

  /* ---- what the server says ---- */
  receive(m) {
    const g = this.game;
    if (!g) return;
    // moved by the server (a new round, the lobby, being found): back in the body first, so its move is the one that lands
    if (this.spec && (m.k === 'where' || m.k === 'go' || m.k === 'kit')) this.endWatch(false);
    if (this.cos && this.cos.receive(m)) return;
    if (m.k === 'where' && this.cos) this.cos.areaChanged(m.area);
    switch (m.k) {
      case 'hello': {
        this.modes = m.modes || []; this.games = m.games || []; this.staff = !!m.staff; this.editable = m.editable || [];
        // (sent here from the server list's Map Requests: look round a map waiting for approval)
        const act = window.__lc2HubAction; window.__lc2HubAction = null;
        if (act && act.k === 'mapspectate') setTimeout(() => this.send(act), 1500);
        return;
      }
      case 'votes': this.votes = m; this.refreshScreen(); return;
      case 'browsemaps': { const cur = this.ctx.gui.screen, M = new BrowseMenu(this, m.game, m.maps); if (cur instanceof MenuScreen) this.ctx.gui.replace(M); else this.openScreen(M); return; }
      case 'mapinfo': { const cur = this.ctx.gui.screen; if (cur instanceof MapSettingsScreen) cur.set(m); else if (!m.refresh) this.openScreen(new MapSettingsScreen(this, m)); return; }
      case 'rated': this.rated = true; this.dropRating(); return;
      case 'poses': this.poses = new Map(m.list || []); this.seekerIds = new Set(m.seekers || []); this.applySize(); return;
      // (the menu it was asked from is swapped for the list in one step: closing it first would hand the game the mouse,
      // and its pointer lock lands after the list opens, hiding the cursor over a menu nobody can click)
      case 'editmaps': { const cur = this.ctx.gui.screen, E = new EditorMenu(this, m.game, m.maps, m.staff, m.canMake); if (cur instanceof MenuScreen) { E.hub = this; this.ctx.gui.replace(E); } else this.openScreen(E); return; }
      case 'where': {
        this.area = m.area; this.floor = m.floor; this.spawn = m.spawn; this.bounds = m.bounds || null;
        // (the Map Editor: whether you may /fill there, the map's maker and staff only)
        this.mayFill = m.area === 'edit' && !!m.fill;
        // (told where we are while the world is still loading, coming back from Death Swap's world say, far from where
        // this page thought it was: go there at once, so the loading carries on round the right place; the server's
        // own move after it is then a short one, never a second long trip racing the first)
        { const P = g.player, sc = this.ctx.gui.screen, sp = m.spawn;
          if (sp && P && sc && /Loading/.test(sc.constructor.name) && Math.hypot(sp.x - P.pos.x, sp.z - P.pos.z) > 48) { P.pos.set(+sp.x, +sp.y, +sp.z); if (P.prev) P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.fallDistance = 0; } }
        if (m.team) this.team = m.team;
        if (m.per) this.per = m.per;
        // the old combat everywhere on the network, as Hypixel plays: no attack cooldown, no sweep
        // (but Death Swap, which is the game's own survival)
        { const C = g.entities && g.entities.combat; if (C) C.legacy = m.area !== 'ds'; }
        this.gameKind = m.game || null; this.modeId = m.mode || null; this.spill = !!m.spill; this.noBuild = !!m.noBuild; this.jumps = m.jumps | 0;
        this.hideNames = !!m.hideNames; this.role = m.role || null; this.hadBow = false; this.boughtBow = false; this.arrowT = 0;
        this.clearCorpses();
        // a shared room: K starts it (startable); a late comer watches the round on there (watching)
        this.startable = !!m.startable; this.watching = !!m.watching;
        // the new games: The Bridge's goals (no building there), a Build Battle plot and its vote, Spleef's snow, hiding
        this.noPlace = m.noPlace || null; this.plot = m.plot || null; this.vote = !!m.vote; this.theme = m.theme || ''; this.owner = m.owner || ''; this.dig = m.dig || null;
        this.hide = m.hide || null; this.paintOn = !!(m.hide && m.hide.paint);
        // Bed Wars: each island's team chest (only your own opens, or one whose team is out)
        if (m.teamChests || m.area !== 'game') { this.teamChests = m.teamChests || []; this.outTeams = new Set(m.outTeams || []); }
        if (!this.hide || this.hide.kind !== 'prophunt') this.clearProps();
        if (!this.hide || this.hide.kind !== 'chameleon' || this.role === 'seeker') this.unpaint();
        if (this.hide && this.hide.kind === 'chameleon' && this.role === 'seeker' && m.area === 'game') this.wearSeeker();
        if (this.paintOn && !this.painter) this.startPaint();
        if (m.area === 'game' && this.hide && this.hide.kind === 'prophunt' && this.hide.as && this.role === 'hider') this.disguiseAs(this.hide.as);
        if (m.area !== 'game') { this.team = null; this.alive = false; }
        // Death Swap's world (area ds), and Bridging's lane
        if (m.area === 'ds') { this.alive = !m.watching; this.dsHold = null; RES_OVERRIDE.clear(); }
        this.br = m.bridger ? { start: m.bridger.start, end: m.bridger.end, box: m.bridger.box, y: m.bridger.y, t0: 0, done: false, last: 0 } : null;
        if (!m.bridger) this.stopReplay();
        this.setNpcs(m.npcs || []);
        this.setGens(m.gens || []);
        // (the lobby's slime launch pads)
        this.pads = m.area === 'lobby' && Array.isArray(m.pads) ? m.pads : [];
        this.closeScreens();
        if ((m.area !== 'game' && !m.watching) || this.gameKind !== 'chameleon') { this.poses = new Map(); this.seekerIds = new Set(); this.myPose = 0; }
        else if (this.role !== 'hider') this.myPose = 0;
        this.applySize();
        return;
      }
      // the lobby's leaderboard walls: each board's words floating in front of the wall
      case 'lb':
        for (const k of [...this.holos.keys()]) if (k.startsWith('lb:')) this.dropHolo(k);
        for (const b of m.list || []) this.holo('lb:' + b.id, +b.x, +b.y, +b.z, b.lines || []);
        return;
      case 'layouts': this.layouts = m.all && typeof m.all === 'object' ? m.all : {}; return;
      case 'profile':
        this.profile = m;
        if (this.wantProfile) { this.wantProfile = false; this.openScreen(new (profileMenus().ProfileMenu)(this)); }
        else this.refreshScreen();
        return;
      case 'themes': this.themes = { list: m.list || [], mine: m.mine || '' }; this.refreshScreen(); return;
      case 'teamout': if (this.outTeams) this.outTeams.add(m.t | 0); return;
      case 'start':
        // (Bed Wars: your ender chest starts each game empty, as the network's does)
        if (this.gameKind === 'bedwars' && g.hands && Array.isArray(g.hands.ender)) g.hands.ender.fill(null);
        this.rated = false; this.changed.clear(); this.kit = { armor: 0, pick: 0, axe: 0, shears: false }; this.up = {}; this.traps = []; return;
      case 'kit': this.giveKit(m.kind, m.fresh); return;
      // off to another of the network's servers (a Death Swap world, or back to Leonpixel)
      case 'transfer': this.transfer(String(m.server || 'hub')); return;
      // Pillars of Fortune: the next random item(s); the void rising
      case 'pof_item': if (this.area === 'game' && this.alive) this.pofItems(Math.max(1, Math.min(5, m.n | 0))); return;
      case 'floor': if (this.area === 'game') this.floor = +m.y; return;
      // Death Swap: where to start (find ground round it), let go, and a swap
      case 'spread': this.dsSpread(m); return;
      case 'dsgo': this.dsHold = null; return;
      case 'swapto': this.dsGoto(m); return;
      // Bridging: back at the start (a fall, Reset, or after a run)
      case 'breset': this.brReset(false); return;
      // Bridging's replays: the list to pick from, and one to watch
      case 'brlist': this.openScreen(new ReplayMenu(this, m)); return;
      case 'brplay': this.playReplay(m); return;
      case 'go': {
        const c = this.ctx.commandCtx(), sv = g.survival;
        if (sv.dead) sv.respawn(true);
        if (m.mode && g.mode !== m.mode) c.setMode(m.mode);
        c.goTo(g.dim, +m.x, +m.y, +m.z, +m.yaw, +m.pitch);
        g.player.fallDistance = 0;
        return;
      }
      case 'spec': this.alive = false; return;
      // Murder Mystery: a body lying where someone fell, in their skin, for the rest of the round
      case 'corpse': this.addCorpse(m); return;
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
      // Chameleon: painting on or off (off only at the round's end now)
      case 'paint': this.paintOn = !!m.on; if (!m.on) this.closeScreens(); return;
      case 'role': this.role = m.role || null; if (this.role === 'seeker') { this.unpaint(); if (this.hide && this.hide.kind === 'chameleon') this.wearSeeker(); } this.applySize(); return;
      case 'fx': {
        // (a whistle: its notes one after another, each [ms later, pitch])
        const notes = Array.isArray(m.notes) ? m.notes : [[0, 1]];
        for (const [ms, pitch] of notes) setTimeout(() => { try { Sound.play(m.s || 'entity.firework_rocket.blast', +m.x, +m.y, +m.z, m.kind === 'whistle' ? 3 : 1.5, +pitch || 1, 'player'); } catch (e) { /* no sound yet */ } }, ms | 0);
        if (m.kind === 'whistle') this.whistleSeen(m);
        const E = g.entities;
        if (E && E.particles) {
          if (m.kind === 'shot') this.tracer(+m.x, +m.y, +m.z, m.to);
          else if (m.kind === 'whistle') E.particles('crit', +m.x, +m.y + 1.2, +m.z, 8, 0.25);
          else { E.particles('sparkle', +m.x, +m.y + 0.5, +m.z, 30, 0.6, [1, 0.85, 0.2]); E.particles('crit', +m.x, +m.y + 0.5, +m.z, 20, 0.6); }
        }
        return;
      }
    }
  }
  /* ---- which way the whistle came from, as in the first Leoncraft's Mecha ----
     A seeker gets an arrow on a ring round the crosshair that keeps pointing at the spot as they turn, for 5 s (4 at most);
     the hider who whistled gets a ring going out from the middle of the screen, since they cannot hear themselves. */
  whistleSeen(m) {
    const now = performance.now();
    if (m.ping) {
      this.pings = (this.pings || []).filter(q => q.until > now);
      this.pings.push({ x: +m.x, z: +m.z, until: now + 5000 });
      while (this.pings.length > 4) this.pings.shift();
    }
    if (m.mine) {
      this.ringAt = now;
      this.titleT = { t: '', s: '§eWhistled!', fi: 0, st: 20, fo: 6, at: now };
    }
    if (m.ping || m.mine) { this.overlay.animates = true; this.ctx.gui.markDirty(); }
  }
  drawWhistle(g) {
    const now = performance.now(), c = g.ctx, P = this.game && this.game.player;
    const cx = Math.floor(g.width / 2), cy = Math.floor(g.height / 2);
    let busy = false;
    if (this.pings && this.pings.length && P) {
      this.pings = this.pings.filter(q => q.until > now && this.area === 'game');
      for (const q of this.pings) {
        const rel = Math.atan2(-(q.x - P.pos.x), -(q.z - P.pos.z)) - P.yaw;
        c.save();
        c.globalAlpha = Math.min(1, (q.until - now) / 900);
        c.translate(cx, cy); c.rotate(-rel);
        c.beginPath(); c.moveTo(0, -57); c.lineTo(5, -48); c.lineTo(-5, -48); c.closePath();
        c.fillStyle = '#ffd54a'; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineWidth = 1;
        c.fill(); c.stroke();
        c.restore();
      }
      busy = this.pings.length > 0;
    }
    if (this.ringAt) {
      const t = (now - this.ringAt) / 750;
      if (t >= 1) this.ringAt = 0;
      else {
        c.save();
        c.globalAlpha = 0.95 * (1 - t);
        c.strokeStyle = '#ffd54a'; c.lineWidth = 2;
        c.beginPath(); c.arc(cx, cy, 70 * (0.25 + 0.75 * (1 - (1 - t) * (1 - t))), 0, Math.PI * 2); c.stroke();
        c.restore();
        busy = true;
      }
    }
    return busy;
  }
  // the launch pad's throw: up and out towards the middle of the games' people (or straight ahead with none)
  launchPad() {
    const P = this.game.player, list = this.npcList || [];
    let dx = -Math.sin(P.yaw), dz = -Math.cos(P.yaw);
    if (list.length) {
      let x = 0, z = 0;
      for (const n of list) { x += n.x; z += n.z; }
      dx = x / list.length - P.pos.x; dz = z / list.length - P.pos.z;
    }
    const l = Math.hypot(dx, dz) || 1;
    P.vel.x = dx / l * PAD_OUT; P.vel.z = dz / l * PAD_OUT; P.vel.y = PAD_UP;
    P.onGround = false;
    this.padAt = this.t + 20; this.padFlying = true;
    this.sound('entity.slime.jump');
    const E = this.game.entities;
    if (E && E.particles) E.particles('cloud', P.pos.x, P.pos.y + 0.1, P.pos.z, 12, 0.4);
  }
  sound(name) { try { const L = Sound.listener; Sound.play(name, L.x, L.y, L.z, 1, 1, 'player'); } catch (e) { /* no sound yet */ } }

  /* ---- the kit ---- */
  giveKit(kind, fresh) {
    const g = this.game, inv = g.inv;
    inv.slots.fill(null); inv.armor.fill(null); inv.offhand = null; inv.carried = null;
    g.survival.clearEffects();
    g.survival.health = g.survival.maxHealth; g.survival.food = 20; g.survival.saturation = 5;
    if (kind === 'lobby') {
      // the lobby's own three things and every cosmetic you have found, each where you last kept it (net/lobbycos.js)
      const fixed = {
        compass: stack('compass', 1, { name: '§aGame Menu §7(Right Click)' }),
        temp: stack(TEMP_BLOCK, 64, { name: TEMP_NAME }),
        profile: stack('player_head', 1, { face: 'self', name: '§aProfile §7- Right Click for your stats, titles and item layouts' }) || stack('name_tag', 1, { name: '§aProfile §7- Right Click for your stats, titles and item layouts' }),
      };
      if (this.cos) this.cos.lobbyKit(inv, fixed);
      else { inv.slots[0] = fixed.compass; inv.slots[1] = fixed.temp; inv.slots[2] = fixed.profile; }
    } else if (kind === 'wait' || kind === 'wait_vote' || kind === 'wait_theme') {
      if (kind === 'wait_theme') inv.slots[0] = stack('writable_book', 1, { name: '§aTheme Vote §7- Right Click to vote for the theme' });
      inv.slots[8] = stack('red_bed', 1, { name: '§c§lReturn to Lobby §7(Right Click)' });
      // (SkyWars keeps the Kit Selector first, so its Map Vote goes beside it)
      if (kind === 'wait_vote') inv.slots[this.gameKind === 'skywars' ? 1 : 0] = stack('filled_map', 1, { name: '§aMap Vote §7- Right Click to choose the map' }) || stack('paper', 1, { name: '§aMap Vote §7- Right Click to choose the map' });
      if (this.gameKind === 'skywars') inv.slots[0] = stack('bow', 1, { name: '§aKit Selector §7- Right Click to choose a kit' });
    } else if (kind === 'sw') {
      // SkyWars: the kit you picked, in your cage (alive: without it nothing could be broken or built, and a death
      // was never told to the server, so nobody ever lost)
      this.alive = true;
      const k = SW_KITS.find(q => q.id === (this.swKit || swKitId())) || SW_KITS[0];
      for (const st of k.give ? k.give() : []) if (st) inv.addStack(st);
      for (const [slot, name] of Object.entries(k.armor || {})) { const st = stack(name); if (st) inv.armor[slot | 0] = st; }
      inv.select(0);
      this.ctx.chat.add('§aYou got the §e' + k.name + ' §akit! §7(choose another with the Kit Selector before a game)', 0xFFFFFF);
    } else if (kind === 'pof') {
      // Pillars of Fortune: nothing but what the game gives you
      this.alive = true;
    } else if (kind === 'ds') {
      // Death Swap: a fresh start in survival, as in a new world
      this.alive = true;
    } else if (kind === 'ds_watch') {
      this.alive = false;
    } else if (kind === 'bridger') {
      // Bridging: blocks that never run out, Reset, and the way back
      this.alive = true;
      inv.slots[0] = stack(BR_BLOCK, 64);
      inv.slots[7] = stack('clock', 1, { name: '§cReset §7- Right Click to go back to the start' });
      inv.slots[4] = stack('ender_eye', 1, { name: '§bReplays §7- Right Click to watch the fastest bridges' });
      inv.slots[8] = stack('red_bed', 1, { name: '§c§lReturn to Lobby §7(Right Click)' });
      inv.select(0);
    } else if (kind === 'edit') {
      this.alive = true;
      inv.slots[8] = stack('writable_book', 1, { name: '§6Map Settings §7- Right Click: name, building team, approval' });
    } else if (kind === 'review') {
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
      inv.slots[1] = stack('snowball', 16);
      inv.select(0);
    } else if (kind === 'tntrun') {
      // (snowballs to knock the others off: one more every two seconds, up to 16)
      this.alive = true;
      inv.slots[0] = stack('snowball', 16);
      inv.select(0);
    } else if (kind === 'bb_vote') {
      VOTES.forEach((v, i) => { inv.slots[i + 1] = stack(v[2], 1, { name: v[1] + '§l' + v[0] }); });
      inv.select(3);
    } else if (kind === 'ph_hider') {
      this.alive = true;
      // (an empty hand to pick a block with; the taunt at the end of the bar)
      inv.slots[6] = stack('ender_eye', 1, { name: WATCH_NAME });
      inv.slots[7] = stack('paper', 1, { name: '§eDisguise §7- Right Click to choose which block to be' });
      inv.slots[8] = stack('firework_star', 1, { name: '§aTaunt §7- Right Click to make a bang (+2 points)' });
      inv.select(0);
    } else if (kind === 'ph_seeker') {
      this.alive = true;
      inv.slots[0] = stack('iron_sword'); inv.slots[1] = stack('bow'); inv.slots[8] = stack('arrow', 32);
      inv.select(0);
    } else if (kind === 'ch_hider') {
      this.alive = true;
      const named = (items, name) => { for (const it of items) { const st = stack(it, 1, { name }); if (st) return st; } return null; };
      inv.slots[0] = named(['brush', 'feather'], '§aPaint Brush §7- Right Click (or B) to paint your skin');
      inv.slots[1] = named(['spyglass', 'stick'], '§bColour Picker §7- Right Click a block to copy its colour');
      inv.slots[2] = named(['armor_stand', 'oak_fence'], '§6Pose §7- Right Click (or V) to change your pose');
      inv.slots[7] = named(['ender_eye', 'spyglass'], WATCH_NAME);
      inv.slots[8] = named(['goat_horn', 'note_block'], '§eWhistle §7- Right Click to whistle (+2 points)');
      inv.select(0);
    } else if (kind === 'ch_seeker' || kind === 'ch_hunter') {
      this.alive = true;
      inv.slots[0] = stack('stick', 1, { name: '§cTag Stick §7- Hit a hider once to find them' });
      inv.slots[1] = stack('crossbow', 1, { name: '§6Rifle §7- Right Click to shoot (one hit finds)' });
      inv.select(0);
    } else if (kind === 'game') {
      if (fresh) this.kit = { armor: 0, pick: 0, axe: 0, shears: false };
      this.alive = true;
      inv.slots[0] = stack('wooden_sword');
      this.giveTools();
      this.dressUp();
      inv.select(0);
    }
    // (the lobby keeps its own arrangement, saved as you move things: net/lobbycos.js)
    if (!this.previewing && this.layouts && kind !== 'lobby') applyLayout(inv, this.layouts[layoutKey(kind, this.swKit || swKitId())], ITEMS);
    this.giveRating();
    inv.changed();
  }
  // in a round of a game with a choice of maps: a like and a dislike for the map, once a round (the server keeps count)
  giveRating() {
    const inv = this.game.inv;
    if (this.area !== 'game' || this.rated || !['prophunt', 'chameleon', 'murder'].includes(this.gameKind)) return;
    if (!inv.slots[5]) inv.slots[5] = stack('lime_dye', 1, { name: '§aLike this map §7- Right Click' });
    if (!inv.slots[6]) inv.slots[6] = stack('red_dye', 1, { name: '§cDislike this map §7- Right Click' });
  }
  dropRating() {
    const inv = this.game.inv;
    for (let i = 0; i < inv.slots.length; i++) { const s = inv.slots[i]; if (s && s.name && /this map/.test(s.name)) inv.slots[i] = null; }
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
    if (it.give) for (const st of it.give()) if (st) { const left = this.placeBought(st, it); if (left > 0) g.inv.emit('drop', Object.assign({}, st, { count: left })); }
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
  // a bought item: into the first hotbar slot the Hotbar Manager keeps for its kind (if free, or the same item with
  // room), else wherever it fits
  placeBought(st, it) {
    const inv = this.game.inv, lay = this.layouts && this.layouts['bw:hotbar'], cat = shopAll(this)[it.id] ? shopAll(this)[it.id].cat : '';
    if (lay && Array.isArray(lay.s) && cat) for (let i = 0; i < 9; i++) {
      if (lay.s[i] !== cat) continue;
      const s = inv.slots[i];
      if (!s) { inv.slots[i] = st; return 0; }
      if (s.id === st.id && (s.name || '') === (st.name || '') && !s.ench && s.count + st.count <= maxStack(s.id)) { s.count += st.count; return 0; }
    }
    return inv.addStack(st);
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
  died(src, message) {
    if (this.spec) this.endWatch(true);
    const g = this.game, sv = g.survival;
    // Death Swap: the game's own death (what you had falls where you died), then you watch
    if (this.area === 'ds') {
      if (this.alive) { this.alive = false; this.send({ k: 'died', text: this.net && this.net.deathText ? this.net.deathText(message || '', src) : message || '' }); }
      if (g.hands && g.hands.spillAll) { try { g.hands.spillAll(); } catch (e) { /* nothing to spill */ } }
      sv.respawn(true); sv.attacker = null;
      const inv = g.inv; inv.slots.fill(null); inv.armor.fill(null); inv.offhand = null; inv.carried = null; inv.changed();
      g.player.vel.set(0, 0, 0); g.player.fallDistance = 0;
      return;
    }
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
    // (the lobby keeps what you carry: nothing gives it back there)
    if (this.area === 'lobby') { g.player.vel.set(0, 0, 0); g.player.fallDistance = 0; return; }
    const inv = g.inv;
    inv.slots.fill(null); inv.offhand = null; inv.carried = null;
    inv.changed();
    g.player.vel.set(0, 0, 0);
    g.player.fallDistance = 0;
  }

  /* ---- what may be broken and built ---- */
  // (Bridging: inside your lane's sides and over its floor, as high as you like)
  inLane(x, y, z) { const b = this.br && this.br.box; return !!b && x >= b[0] && x <= b[3] && y >= b[1] && z >= b[2] && z <= b[5]; }
  inPlot(x, y, z) { const p = this.plot; return !!p && x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && y >= p.y0 && y <= p.y1; }
  mayBreak(x, y, z) {
    if (this.building || this.area === 'edit' || this.area === 'ds') return true;
    if (this.br) return this.alive && this.inLane(x, y, z) && this.changed.has(x + ',' + y + ',' + z);
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
  blastBreaks(x, y, z) {
    if (this.building || this.area === 'edit' || this.area === 'ds') return true;
    if (this.area !== 'game' || this.noBuild || this.dig || this.gameKind === 'buildbattle') return false;
    if (this.gameKind === 'skywars') { const b = this.bounds; return !b || (Math.abs(x + 0.5 - b.x) <= b.reach && Math.abs(z + 0.5 - b.z) <= b.reach && y <= b.top && y >= b.bottom); }
    const d = BLOCKS[this.game.world.get(x, y, z)];
    if (d && d.shape === 'bed') return false;
    return this.changed.has(x + ',' + y + ',' + z);
  }
  mayPlace(x, y, z, quiet, id) {
    if (this.building || this.area === 'edit' || this.area === 'ds') return true;
    if (this.br) { if (this.alive && this.inLane(x, y, z)) return true; if (quiet !== true) this.ctx.chat.add('§cYou can only build in your own lane!', 0xFF5555); return false; }
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
      const sk = String(n.id).replace(/^game:/, '');
      this.npcs.add({ id: n.nid, name: '', skin: NPC_SKIN.has(sk) ? npcSkinUrl(sk) : '', eq: n.held ? { h: n.held, o: '', a: null } : null });
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
  // a body lying where someone fell (Murder Mystery), in the skin they wore; gone with the round (clearCorpses)
  addCorpse(m) {
    if (!this.npcs) return;
    const r = this.net.players && this.net.players.list.get(m.id), mine = m.id === this.net.id;
    let skin = '', slim = false;
    if (r) { skin = r.skinUrl || ''; slim = !!r.slim; }
    else if (mine) { const s = getSkinSettings(); skin = s.skin || ''; slim = s.slim; }
    this.corpses = this.corpses || [];
    const nid = -4000 - this.corpses.length;
    this.npcs.add({ id: nid, name: '', skin, slim });
    this.feed({ nid, x: +m.x, y: +m.y, z: +m.z, yaw: +m.yaw || 0 });
    this.corpses.push({ nid });
  }
  clearCorpses() { if (this.corpses && this.npcs) for (const c of this.corpses) this.npcs.remove(c.nid); this.corpses = null; }
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
    // watching while you hide: the Spectate item leaves the body and comes back; nothing else does anything meanwhile
    if (this.spec || this.canWatch()) {
      const h0 = this.game.inv.slots[this.game.inv.selected];
      if (h0 && /^Spectate/.test((h0.name || '').replace(/\u00a7./g, ''))) { this.toggleWatch(); return true; }
      if (this.spec) return true;
    }
    const inv = this.game.inv, h = inv.slots[inv.selected];
    // Bed Wars: another team's chest stays shut while that team is still in the game
    if (this.area === 'game' && this.gameKind === 'bedwars' && this.teamChests && this.teamChests.length ) {
      const T = this.game.inter.target, mine = this.team ? this.team.i : -1;
      const c = T && this.teamChests.find(q => q[0] === T.x && q[1] === T.y && q[2] === T.z);
      if (c && c[3] !== mine && !this.outTeams.has(c[3])) { this.ctx.chat.add('§cYou cannot open another team\'s chest while they are still alive!', 0xFF5555); return true; }
    }
    // (a Prop Hunt hider picks a block with an empty hand too)
    const hider = this.area === 'game' && this.alive && this.hide && this.hide.kind === 'prophunt' && this.role === 'hider';
    if (!h && !hider) return false;
    // a door, trapdoor or gate in a game's map opens on a right click whatever you hold (sneak to disguise as one, or to paint
    // from one with the Colour Picker)
    if (this.area === 'game' && !this.game.player.sneaking && this.opensAtTarget()) {
      const nm = h && h.name ? h.name.replace(/§./g, '') : '';
      if (!/^Colour Picker/.test(nm)) return false;
    }
    // Murder Mystery: the murderer throws the Knife with a right click; it comes back to the hand after 5 seconds
    if (h && this.area === 'game' && this.alive && this.gameKind === 'murder' && this.role === 'murderer' && h.id === I.iron_sword) { this.throwKnife(); return true; }
    // Build Battle: a vote (whatever the page thinks of being alive, which a teleport between builds can upset)
    if (h && this.area === 'game' && this.vote) {
      const nm = h.name ? h.name.replace(/§./g, '') : '', vi = VOTES.findIndex(v => v[0] === nm);
      if (vi >= 0) { this.send({ k: 'vote', v: vi + 1, owner: this.owner || '' }); this.sound('block.note_block.pling'); return true; }
    }
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
      // Prop Hunt: a taunt
      if (this.hide && this.hide.kind === 'prophunt' && /^Taunt/.test(nm)) { this.send({ k: 'taunt' }); return true; }
      // Chameleon: the seekers' Rifle
      if (this.hide && this.hide.kind === 'chameleon' && /^Rifle/.test(nm)) { this.shoot(); return true; }
      // Chameleon: a whistle, heard by everyone near (the server keeps its wait)
      if (this.hide && this.hide.kind === 'chameleon' && /^Whistle/.test(nm)) { this.send({ k: 'whistle' }); return true; }
      // Chameleon: the next pose (as LC1's Mecha had them), told to everyone through the server
      if (this.hide && this.hide.kind === 'chameleon' && /^Pose/.test(nm)) { this.nextPose(); return true; }
      // Chameleon: the brush, the picker and the stamp
      if (this.hide && this.hide.kind === 'chameleon' && this.painter) {
        const T = this.game.inter.target;
        if (/^Paint Brush/.test(nm)) { this.openBrush(); return true; }
        if (/^Colour Picker/.test(nm)) { { const c = pickAtCentre(this.game.world, this.ctx.renderer, () => T ? faceColour(T.b || this.game.world.get(T.x, T.y, T.z), faceOfNormal(T.face)) : null); if (c !== null) { this.painter.setColour(c); this.ctx.chat.add('§bPicked a colour: §f#' + c.toString(16).padStart(6, '0') + ' §7(paint with it in the Paint Brush)', 0xFFFFFF); this.sound('block.note_block.hat'); } } return true; }
      }
    }
    // Prop Hunt: the Disguise item opens the round's list of blocks
    if (hider && h && /^Disguise/.test((h.name || '').replace(/§./g, ''))) { this.openScreen(new DisguiseMenu(this)); return true; }
    // every hider starts as one of the list (the server's hide.as); a right click on a block of the list makes you it
    if (hider && !this.disguise) {
      const T = this.game.inter.target;
      if (T) {
        const d = BLOCKS[T.b || this.game.world.get(T.x, T.y, T.z)];
        if (d && (this.hide.props || []).indexOf(d.name) >= 0) {
          this.send({ k: 'disguise', b: d.name }); this.disguiseAs(d.name); }
        else this.ctx.chat.add('§cYou can only be one of the blocks in the Disguise list!', 0xFF5555);
        return true;
      }
    }
    if (!h) return false;
    if (this.area === 'lobby' && h.cos && this.cos) return this.cos.use(h);
    if (this.area === 'lobby' && h.id === idOf('compass')) { this.openScreen(new GameMenu(this)); return true; }
    if (this.br && h.name && /^Reset/.test(h.name.replace(/\u00a7./g, ''))) { this.brReset(true); return true; }
    if (this.br && h.name && /^Replays/.test(h.name.replace(/\u00a7./g, ''))) { this.send({ k: 'brreplays' }); return true; }
    if (this.br && h.id === idOf('red_bed')) { this.send({ k: 'lobby' }); return true; }
    if (this.area === 'lobby' && h.name && /^Profile/.test(h.name.replace(/\u00a7./g, ''))) { this.swKit = this.swKit || swKitId(); this.wantProfile = true; this.send({ k: 'profile' }); return true; }
    if (this.area === 'wait' && h.id === idOf('red_bed')) { this.send({ k: 'lobby' }); return true; }
    if (this.area === 'wait' && h.name && /^Map Vote/.test(h.name.replace(/\u00a7./g, ''))) { this.openScreen(new VoteMenu(this)); return true; }
    if (this.area === 'wait' && h.name && /^Kit Selector/.test(h.name.replace(/\u00a7./g, ''))) { this.openScreen(new KitMenu(this)); return true; }
    if (this.area === 'wait' && h.name && /^Theme Vote/.test(h.name.replace(/\u00a7./g, ''))) { this.openScreen(new ThemeMenu(this)); return true; }
    if (this.area === 'edit' && h.name && /^Map Settings/.test(h.name.replace(/\u00a7./g, ''))) { this.send({ k: 'mapinfo' }); return true; }
    if (this.area === 'game' && h.name && /this map/.test(h.name)) { this.send({ k: 'maprate', v: /^.?.?Like/.test(h.name.replace(/\u00a7./g, '')) ? 1 : -1 }); return true; }
    return false;
  }
  useOne() { const inv = this.game.inv, h = inv.slots[inv.selected]; if (!h) return; if (--h.count <= 0) inv.slots[inv.selected] = null; inv.changed(); }
  look() {
    const P = this.game.player;
    return { eye: { x: P.pos.x, y: P.pos.y + (P.sneaking ? 1.27 : 1.62), z: P.pos.z }, d: { x: -Math.sin(P.yaw) * Math.cos(P.pitch), y: Math.sin(P.pitch), z: -Math.cos(P.yaw) * Math.cos(P.pitch) } };
  }
  // a fireball from your eyes the way you look: it breaks the blocks a player put down (not the map, not blast-proof glass) and throws people back
  throwKnife() {
    const E = this.game.entities, inv = this.game.inv, { eye, d } = this.look();
    if (!E) return;
    const k = E.spawn('knife', eye.x + d.x * 0.6, eye.y + d.y * 0.6 - 0.1, eye.z + d.z * 0.6, { natural: false });
    if (!k) return;
    k.owner = E.player; k.shoot(d.x, d.y, d.z, 1.6, 0);
    this.knifeSlot = inv.selected; this.knifeBack = this.t + 100;
    inv.slots[inv.selected] = null; if (inv.changed) inv.changed();
    this.sound('entity.player.attack.sweep');
  }
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
    const h = { sprites, lines: lines.slice(), x, y, z };
    this.holos.set(key, h);
    this.showHolo(key, h);
  }
  // F1 leaves only the people's words over them (CLICK TO PLAY, the game, how many are playing; ITEM SHOP...); no boards
  // or generators
  showHolo(key, h) {
    const keep = !this.holoHidden || key.startsWith('npc:');
    for (const s of h.sprites) if (s) s.visible = keep;
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
    // the thrown Knife back in the murderer's hand
    if (this.knifeBack && this.t >= this.knifeBack) {
      this.knifeBack = 0;
      const inv = this.game.inv, s = this.knifeSlot | 0;
      if (this.area === 'game' && this.alive && this.gameKind === 'murder' && this.role === 'murderer' && !inv.slots.some(x => x && x.id === I.iron_sword)) {
        const at = inv.slots[s] ? inv.slots.findIndex((x, i) => i < 9 && !x) : s;
        if (at >= 0) { inv.slots[at] = stack('iron_sword', 1, { name: '§cKnife' }); if (inv.changed) inv.changed(); }
      }
    }
    const P = g.player, sv = g.survival;
    if (this.cos) this.cos.tick();
    // a Death Swap world is survival as the game plays it: nothing of the network's here
    if (this.area === 'ds') { this.dsTick(); return; }
    // the lobby's slime launch pad: stepping onto it throws you out towards the games' people, and the landing never hurts
    if (this.area === 'lobby' && this.pads && this.pads.length) {
      if (P.onGround && this.t >= (this.padAt || 0)) {
        const bx = Math.floor(P.pos.x), by = Math.floor(P.pos.y - 0.2), bz = Math.floor(P.pos.z);
        if (this.pads.some(q => q[0] === bx && q[1] === by && q[2] === bz)) this.launchPad();
      }
      if (this.padFlying) { P.fallDistance = 0; if (P.onGround && this.t > this.padAt - 15) this.padFlying = false; }
    }
    // punches in the lobby only knock you about: nothing there hurts, a fall neither (as in Hypixel's lobbies: a gadget's
    // flight came down hard enough to kill, and a death cleared the inventory)
    if (this.area === 'lobby') { sv.health = sv.maxHealth; P.fallDistance = 0; }
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
    // Bridging: the run's timer, a fall starting you again, blocks that never run out
    if (this.br) { this.brTick(); return; }
    // the void takes you at once
    if (P.pos.y < this.floor && !sv.dead) { this.voided = true; sv.hurt(3.4e38, 'out_of_world'); return; }
    /* Murder Mystery, as Hypixel's: ten gold makes a bow and an arrow (the murderer's ten too), each ten after that one
       more arrow; a bow bought is yours and goes with you when you die. The detective's bow, and the one picked up off
       the floor (only the detective's is ever dropped), brings its arrow back after 5 s and is told to the server,
       which drops it where its holder dies. */
    if (this.gameKind === 'murder') {
      const inv = g.inv, bowId = idOf('bow'), arrowId = idOf('arrow'), bows = inv.count(bowId);
      if (this.count('gold_ingot') >= 10) {
        this.take('gold_ingot', 10);
        if (!bows) { inv.addStack(stack('bow')); this.boughtBow = true; }
        inv.addStack(stack('arrow'));
        this.ctx.chat.add(bows ? '§6You got an arrow for 10 gold!' : '§6You got a bow and an arrow for 10 gold!', 0xFFFFFF);
        this.sound('entity.player.levelup');
      }
      if (inv.count(bowId) > (this.boughtBow ? 1 : 0) && !this.hadBow) { this.hadBow = true; this.send({ k: 'bow' }); }
      if (this.hadBow && this.role !== 'murderer' && inv.count(bowId) > 0 && inv.count(arrowId) === 0) { if (++this.arrowT >= 100) { this.arrowT = 0; inv.addStack(stack('arrow')); } } else this.arrowT = 0;
    }
    // The Bridge: the arrow comes back three and a half seconds after it is gone
    if (this.gameKind === 'bridge') {
      const inv = g.inv;
      if (inv.count(idOf('bow')) > 0 && inv.count(idOf('arrow')) === 0) { if (++this.arrowT >= 70) { this.arrowT = 0; inv.addStack(stack('arrow')); } } else this.arrowT = 0;
    }
    // Spleef: nothing hurts but the void
    if (this.gameKind === 'spleef') { sv.health = sv.maxHealth; P.fallDistance = 0; }
    // Sumo: nobody loses health, a hit only knocks (out of the ring is the only way to lose)
    if (this.modeId === 'duels_sumo' && this.area === 'game') { sv.health = sv.maxHealth; P.fallDistance = 0; }
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
    if (this.hide && this.hide.kind === 'prophunt' && this.role === 'hider' && this.disguise && !this.spec) {
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
      if (this.area === 'game' && this.alive && this.t % 40 === 0 && g.inv.count(idOf('snowball')) < 16) g.inv.add(idOf('snowball'), 1);
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
    // a potion drunk leaves no bottle behind, as the mode has it
    { const inv = g.inv, gb = idOf('glass_bottle'); if (gb) for (let i = 0; i < 36; i++) { const s = inv.slots[i]; if (s && s.id === gb) { inv.slots[i] = null; inv.changed(); } } }
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
    if (this.cos) this.cos.frame();
    this.applyPoses();
    this.watchFrame();
    if (this.corpses) for (const c of this.corpses) { const b = this.npcs.list.get(c.nid); if (b && b.av) b.av.poseOverride = POSES[3][1]; }
    // F1: the words floating in the world go with the HUD, but for the people's own (showHolo)
    const hideText = !!this.ctx.gui.hideHud;
    if (hideText !== !!this.holoHidden) { this.holoHidden = hideText; for (const [k, h] of this.holos) this.showHolo(k, h); }
  }

  /* ---- watching while you hide (Chameleon and Prop Hunt; the first Leoncraft's L) ----
     Your body stays where it is, in its pose or its block: the page goes on sending that place (net.bodyAt), so everyone,
     the seekers too, sees it there and can hit it there. Your eyes fly off (with your own box: walls and the map's barriers
     still stop them), or ride along with anyone still in the round, from their eyes (Left / Right; one past either end is
     your own camera again). L, or the Spectate item, puts you back in your body where you left it. */
  canWatch() {
    const g = this.game;
    return !!g && this.area === 'game' && this.alive && this.role === 'hider' && !!this.hide && (this.hide.kind === 'chameleon' || this.hide.kind === 'prophunt') && !(g.survival && g.survival.dead);
  }
  toggleWatch() { if (this.spec) this.endWatch(true); else this.startWatch(); }
  startWatch() {
    if (this.spec || !this.canWatch() || this.ctx.gui.screen) return;
    const g = this.game, P = g.player, A = this.ctx.renderer.avatar;
    // Prop Hunt: the block locks into its cell first, as standing still would have done
    if (this.hide.kind === 'prophunt' && this.disguise && !this.lockAt) {
      this.lockAt = [Math.floor(P.pos.x), Math.floor(P.pos.y + 0.01), Math.floor(P.pos.z)];
      P.pos.x = this.lockAt[0] + 0.5; P.pos.z = this.lockAt[2] + 0.5; if (P.prev) { P.prev.x = P.pos.x; P.prev.z = P.pos.z; }
      this.send({ k: 'lock', at: this.lockAt });
    }
    const at = { x: P.pos.x, y: P.pos.y, z: P.pos.z, yaw: P.yaw, pitch: P.pitch };
    this.spec = { at, id: null, canFly: P.canFly, view: A ? A.view : 0 };
    this.net.bodyAt = at;
    // (no hand in the corner while you watch: main.js showHand)
    g.noHand = true;
    P.canFly = true; P.flying = true; P.vel.set(0, 0, 0);
    if (A && A.view !== 0) A.setView(0);
    // your body as this page draws it (every other page draws it from the place it is sent): Chameleon's painted figure in
    // its pose; Prop Hunt's block is drawn in its locked cell already (drawProps)
    if (this.hide.kind === 'chameleon') {
      let sk = '';
      try { sk = this.painter && this.painter.canvas ? this.painter.canvas.toDataURL('image/png') : ''; } catch (e) { sk = ''; }
      this.npcs.add({ id: SPEC_BODY, name: '', skin: sk });
      this.feed({ nid: SPEC_BODY, x: at.x, y: at.y, z: at.z, yaw: at.yaw });
    }
    this.ctx.chat.add('§dYou left your body. §7Fly about, or §eLeft§7/§eRight §7to watch the others; §eL §7or the Spectate item to step back in.', 0xFFFFFF);
    this.sound('entity.enderman.teleport');
    this.ctx.gui.markDirty();
  }
  endWatch(back) {
    const S = this.spec;
    if (!S) return;
    this.spec = null;
    if (this.net) this.net.bodyAt = null;
    if (this.npcs) this.npcs.remove(SPEC_BODY);
    const g = this.game, P = g && g.player, A = this.ctx.renderer.avatar;
    if (g) g.noHand = false;
    if (P) {
      P.canFly = S.canFly; if (!P.canFly) P.flying = false;
      if (back) { P.pos.set(S.at.x, S.at.y, S.at.z); if (P.prev) P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.yaw = S.at.yaw; P.pitch = S.at.pitch; P.fallDistance = 0; }
    }
    if (A) { A.hidden = false; if (S.view && A.view !== S.view) A.setView(S.view); }
    if (back) { this.ctx.chat.add('§aBack in your body.', 0xFFFFFF); this.sound('entity.enderman.teleport'); }
    this.ctx.gui.markDirty();
  }
  // everyone still in the round near your body, in a fixed order (so Left and Right are opposites)
  watchTargets() {
    const S = this.spec, L = this.net.players ? [...this.net.players.list.entries()] : [];
    return L.filter(([, r]) => r.feet && r.st && !(r.st.f & (F.SPEC | F.DEAD)) && Math.hypot(r.feet.x - S.at.x, r.feet.z - S.at.z) < 400)
      .map(([id]) => id).sort((a, b) => a - b);
  }
  // watching a round from spectator, out of it or come late (not a hider out of their body)
  deadWatch() { const g = this.game; return !!g && !this.spec && g.mode === 'spectator' && ((this.area === 'game' && !this.alive) || (this.area === 'wait' && !!this.watching)); }
  // the next player still in the round, in turn: put 4 behind them and 2 up, looking at them
  teleportNext(dir) {
    const g = this.game, P = g.player, L = this.net.players ? [...this.net.players.list.entries()] : [];
    // (where each last said they are: r.feet is only kept up for those near enough to be drawn)
    const list = L.filter(([, r]) => r.st && !(r.st.f & (F.SPEC | F.DEAD)) && Math.hypot(r.st.x - P.pos.x, r.st.z - P.pos.z) < 400).sort((a, b) => a[0] - b[0]);
    if (!list.length) { this.ctx.chat.add('§cNobody to watch here.', 0xFF5555); return; }
    const i = list.findIndex(e => e[0] === this.tpWatch);
    const [id, r] = list[(i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length)];
    this.tpWatch = id;
    const s = r.st, yaw = s.yaw || 0, x = s.x + Math.sin(yaw) * 4, z = s.z + Math.cos(yaw) * 4, y = s.y + 2;
    P.pos.set(x, y, z); if (P.prev) P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.flying = true;
    P.yaw = Math.atan2(-(s.x - x), -(s.z - z)); P.pitch = Math.atan2(s.y + 1.2 - (y + 1.62), 4);
    this.ctx.chat.add('§7Watching §f' + (r.name || 'a player'), 0xFFFFFF);
    this.sound('ui.button.click');
  }
  watchNext(dir) {
    const S = this.spec;
    if (!S) return;
    const list = this.watchTargets();
    const i = list.indexOf(S.id);
    let j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    if (j >= list.length || j < 0) j = -1;
    S.id = j < 0 ? null : list[j];
    this.sound('ui.button.click');
    this.ctx.gui.markDirty();
  }
  watchFrame() {
    const S = this.spec;
    if (!S) return;
    if (!this.canWatch()) { this.endWatch(true); return; }
    const A = this.ctx.renderer.avatar;
    if (A) A.hidden = true;
    const b = this.npcs.list.get(SPEC_BODY);
    if (b) { this.feed({ nid: SPEC_BODY, x: S.at.x, y: S.at.y, z: S.at.z, yaw: S.at.yaw }); if (b.av) b.av.poseOverride = (POSES[this.myPose | 0] || POSES[0])[1]; }
    // (the game ends a flight on touching the ground: the camera keeps flying, Space up and Shift down)
    if (!this.game.player.flying) this.game.player.flying = true;
    if (S.id === null) return;
    const r = this.net.players && this.net.players.list.get(S.id);
    if (!r || !r.feet || (r.st && (r.st.f & (F.SPEC | F.DEAD)))) { S.id = null; this.ctx.gui.markDirty(); return; }
    // from their eyes, looking where they look; their own model is not drawn for you meanwhile
    const P = this.game.player, eye = (r.P && r.P.sneaking ? 1.27 : 1.62) * playerSize.of(S.id);
    P.pos.set(r.feet.x, r.feet.y + eye - P.eyeH, r.feet.z); if (P.prev) P.prev.copy(P.pos); P.vel.set(0, 0, 0);
    if (r.P) { P.yaw = r.P.yaw; P.pitch = r.P.pitch; }
    const av = r.av;
    if (av) { av.mesh.visible = av.armor.visible = av.capeMesh.visible = av.glowRim.visible = av.glowBehind.visible = false; for (const h of av.held) if (h) h.mesh.visible = false; if (av.headItem) av.headItem.mesh.visible = false; }
    if (r.tag) r.tag.far.visible = r.tag.near.visible = false;
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
  // the block under the crosshair opens by hand: a wooden door, trapdoor or fence gate (iron ones need redstone)
  opensAtTarget() {
    const T = this.game.inter.target, d = T && BLOCKS[T.b || this.game.world.get(T.x, T.y, T.z)];
    return !!d && /(_door|_trapdoor|fence_gate)$/.test(d.name) && !/^iron_/.test(d.name);
  }
  /* Chameleon: the Rifle. A shot every 0.8 s along where you look, up to 60 blocks, stopped by the first solid block; the
     first player in the way is hit (sent as an arrow's hit named by the Rifle, which the server lets one hit find with).
     The kick in the hand (render/held.js recoil), a flash at the muzzle, a trail of sparks and the bang; everyone else
     sees the trail and hears the bang through the server. */
  shoot() {
    if (this.t - (this.shotAt === undefined ? -99 : this.shotAt) < 16) return;
    // (stunned after too many misses: the first Leoncraft's Mecha makes you stand still a moment)
    if (this.t < (this.stunUntil | 0)) { this.ctx.chat.add('§cYou are stunned for ' + Math.ceil((this.stunUntil - this.t) / 20) + 's!', 0xFF5555); this.shotAt = this.t; return; }
    this.shotAt = this.t;
    const g = this.game, P = g.player, w = g.world, net = this.net;
    const eye = { x: P.pos.x, y: P.pos.y + (P.eyeH || 1.62), z: P.pos.z };
    const dx = -Math.sin(P.yaw) * Math.cos(P.pitch), dy = Math.sin(P.pitch), dz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    // the first solid block in the way, a tenth of a block at a time
    let lim = 60;
    for (let t = 0.2; t < lim; t += 0.1) { const b = w.get(Math.floor(eye.x + dx * t), Math.floor(eye.y + dy * t), Math.floor(eye.z + dz * t)); if (b && SOLID[b]) { lim = t; break; } }
    // the first player before it: a small hider is hit by a shot passing within 0.64 of their middle (knee high on anyone
    // else), as the first Leoncraft's Mecha counts it (a half size figure's own box asked for more aim than a mouse gives);
    // anyone full size by their box
    let best = null;
    if (net && net.players) for (const r of net.players.list.values()) {
      if (!net.hittable(r, (r.st || {}).d)) continue;
      const f = r.feet, k = playerSize.of(r.id);
      let t;
      if (k < 1) {
        const mx = f.x - eye.x, my = f.y + 0.9 * k - eye.y, mz = f.z - eye.z, along = mx * dx + my * dy + mz * dz;
        t = along > 0 && (mx * mx + my * my + mz * mz) - along * along <= 0.64 * 0.64 ? along : Infinity;
      } else {
        const hw = 0.3 * k + 0.1, h = (r.st && r.st.f & F.SNEAK ? 1.5 : 1.8) * k;
        t = rayBox(eye.x, eye.y, eye.z, dx, dy, dz, f.x - hw, f.y, f.z - hw, f.x + hw, f.y + h, f.z + hw);
      }
      if (t < lim) { lim = t; best = r; }
    }
    // a shot into the scenery costs the shooter (6 of LC1's 100, 1.2 of 20 here); at none left, 4 s stunned and whole again
    if (!best) {
      const sv = g.survival;
      if (sv.health - 1.2 > 0.01) { sv.health -= 1.2; this.ctx.chat.add('§cMissed! §7(-1.2 health; shooting the scenery costs you)', 0xFF5555); }
      else { sv.health = sv.maxHealth; this.stunUntil = this.t + 80; sv.addEffect('slowness', 6, 80); this.ctx.chat.add('§c§lSTUNNED! §7Too many misses: 4 seconds without the Rifle.', 0xFF5555); this.sound('entity.player.hurt'); }
    }
    const to = [eye.x + dx * lim, eye.y + dy * lim, eye.z + dz * lim], r3 = v => Math.round(v * 1000) / 1000;
    if (best && net.send) net.send({ t: 'hit', id: best.id, k: 'arrow', dmg: 1, dir: [r3(dx * 3), r3(dy * 3), r3(dz * 3)], at: to.map(r3), item: 'Rifle' });
    this.send({ k: 'shot', to: to.map(r3) });
    // the kick, the flash, the trail and the bang here
    const held = this.ctx.renderer && this.ctx.renderer.held;
    if (held && held.recoil) held.recoil(1);
    const E = g.entities;
    if (E && E.particles) E.particles('sparkle', eye.x + dx * 0.9 - Math.cos(P.yaw) * 0.25, eye.y + dy * 0.9 - 0.15, eye.z + dz * 0.9 + Math.sin(P.yaw) * 0.25, 6, 0.05, [1, 0.8, 0.3]);
    this.tracer(eye.x + dx * 1.2, eye.y + dy * 1.2 - 0.1, eye.z + dz * 1.2, to);
    try { Sound.play('entity.firework_rocket.blast', eye.x, eye.y, eye.z, 1.2, 1.7, 'player'); } catch (e) { /* no sound yet */ }
    if (best) this.sound('entity.arrow.hit_player');
  }
  // a shot's trail: sparks from the muzzle to where it stopped, and a puff there
  tracer(x, y, z, to) {
    const E = this.game.entities;
    if (!E || !E.particles || !Array.isArray(to) || to.length !== 3) return;
    const ex = +to[0], ey = +to[1], ez = +to[2], d = Math.hypot(ex - x, ey - y, ez - z), n = Math.min(80, Math.ceil(d / 0.6));
    for (let i = 1; i <= n; i++) { const f = i / n; E.particles('crit', x + (ex - x) * f, y + (ey - y) * f, z + (ez - z) * f, 1, 0.01); }
    E.particles('poof', ex, ey, ez, 5, 0.08, [0.6, 0.6, 0.6]);
  }
  // a hider paints whenever they like, all round long (only being a seeker, or the round's end, takes the brush away)
  // Chameleon: the next pose (as LC1's Mecha had them), told to everyone through the server
  nextPose() {
    this.myPose = ((this.myPose | 0) + 1) % POSES.length;
    this.send({ k: 'pose', p: this.myPose });
    this.ctx.chat.add('§6Pose: §e' + POSES[this.myPose][0] + ' §7(right click or V for the next)', 0xFFFFFF);
    this.sound('block.wood.place');
  }
  openBrush() {
    if (this.spec) { this.ctx.chat.add('§cStep back into your body first §7(L)', 0xFF5555); return; }
    if (this.painter && this.mayPaint()) this.openScreen(new PaintScreen(this.painter, { renderer: this.ctx.renderer, world: this.game.world, player: this.game.player }));
  }
  mayPaint() {
    if (this.painter && this.paintOn && this.role !== 'seeker') return true;
    if (this.role === 'seeker') this.ctx.chat.add('§cSeekers cannot paint!', 0xFF5555);
    return false;
  }
  // Chameleon's hiders are played at half size: you (your box, eyes and body) and everyone you see; its seekers stay full size
  applySize() {
    // (someone watching a round from its waiting room sees it as it is played, at full size themselves)
    const on = this.gameKind === 'chameleon' && (this.area === 'game' || this.watching), g = this.game;
    const k = on && this.area === 'game' && this.role !== 'seeker' ? 0.5 : 1;
    playerSize.k = on ? 0.5 : 1;
    // (no capes in Chameleon: one would give a painted hider away)
    capeRule.off = on;
    playerSize.full = on && this.seekerIds ? this.seekerIds : new Set();
    /* (and a hider's box is thinner than the body drawn, as LC1's Mecha has it: 0.6 x 0.28 wide on a model at 0.9 x 0.5, a box
       three of the model's pixels each side of the middle, so the shoulders and the head go into a wall pressed against.
       Three of our half-size model's pixels (0.9375 / 32 a block) are 0.0879, and the box's half width 0.3 x 0.5 x 7/12 = 0.0875) */
    if (g && g.player && g.player.setScale) g.player.setScale(k, k < 1 ? k * 7 / 12 : k);
    // (and nobody in it is hurt by a block at the eyes: half-size players squeeze into places, and paint against walls)
    if (g && g.survival) g.survival.noSuffocate = on;
    // and everyone in it climbs walls by holding jump against them (never the barriers round the map, or anyone could climb out)
    if (g && g.player) { g.player.wallClimb = on && this.area === 'game'; g.player.noBarrierClimb = true; }
    const A = this.ctx && this.ctx.renderer && this.ctx.renderer.avatar;
    if (A) A.size = k;
  }
  // Chameleon: a hider's pose, or a seeker's aim while crouching, on every body drawn (none anywhere else)
  applyPoses() {
    // (Prop Hunt's seekers never heal by themselves, a wrong hit's half heart stays lost; nor does anyone in Chameleon, where
    //  a Rifle shot into the scenery costs the shooter)
    if (this.game.survival) this.game.survival.noRegen = this.area === 'game' && ((this.gameKind === 'prophunt' && this.role === 'seeker') || this.gameKind === 'chameleon');
    const on = this.area === 'game' && this.gameKind === 'chameleon', A = this.ctx.renderer.avatar, P = this.game.player;
    // (in the lobby: riding a mount, net/lobbycos.js)
    if (A) A.poseOverride = !on ? (this.cos ? this.cos.poseOf('') : null) : this.role === 'seeker' ? (P.sneaking ? SNIPE : null) : (POSES[this.myPose | 0] || POSES[0])[1];
    const players = this.net.players;
    if (!players) return;
    for (const [id, r] of players.list) {
      if (!r.av) continue;
      if (!on) { r.av.poseOverride = this.cos ? this.cos.poseOf(r.name) : null; continue; }
      const pz = this.poses && this.poses.get(id);
      r.av.poseOverride = pz ? (POSES[pz] || POSES[0])[1] : this.seekerIds && this.seekerIds.has(id) && r.st && (r.st.f & F.SNEAK) ? SNIPE : null;
    }
  }
  // Prop Hunt: you as a block, seen from behind so you see what you have become (F5 still changes it)
  disguiseAs(name) {
    this.disguise = name; this.lockAt = null; this.still = 0;
    const A = this.ctx.renderer.avatar;
    if (A && A.view === 0) { this.viewBefore = 0; A.setView(1); }
    this.ctx.chat.add('§aYou are disguised as §e' + this.propTitle() + '§a! Stand still to lock in place.', 0xFFFFFF);
    this.sound('entity.chicken.egg');
  }
  propTitle() {
    const n = this.disguise || (this.hide && this.hide.as) || (this.hide && this.hide.props && this.hide.props[0]) || '', d = BLOCKS[B[n]];
    return (d && d.display) || n.replace(/_/g, ' ');
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
    const url = own && own !== 'default' ? own : new URL('../../textures/skin/default.png?v=107', import.meta.url).href;
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
    loadSkin64(new URL('../../textures/skin/gallery/swat_agent.png?v=107', import.meta.url).href).then(c => { if (c) { this.seekerSkin = c.toDataURL('image/png'); put(this.seekerSkin); } });
  }
  unpaint() {
    if (!this.painter && !(this.net && this.net.skinOverride)) return;
    this.painter = null; this.paintOn = false;
    if (this.net) this.net.skinOverride = null;
    if (!this.ctx) return;
    const o = this.ctx.gui.options, own = o.get('skin');
    setOwnSkin(own && own !== 'default' ? own : new URL('../../textures/skin/default.png?v=107', import.meta.url).href, own && own !== 'default' ? o.get('skinModel') === 'slim' : false);
    if (this.net.sendSkin) this.net.sendSkin();
  }

  /* ---- another of the network's servers: a Death Swap world, or back to Leonpixel ----
     Out of this world to the title (as Disconnect does), then straight onto that server (ui/multiplayer.js rejoin). */
  transfer(id) {
    if (this.moving) return;
    this.moving = true;
    const gui = this.ctx.gui, hooks = gui.hooks || {};
    this.ctx.chat.add('§7Sending you to ' + (id === 'hub' ? 'Leonpixel' : 'the game world') + '...', 0xFFFFFF);
    const go = () => import('../ui/multiplayer.js?v=107').then(M => M.rejoin(gui, id), e => console.error('transfer', e));
    Promise.resolve(hooks.quitToTitle ? hooks.quitToTitle() : null).then(go, go);
  }

  /* ---- Pillars of Fortune: the random items ---- */
  pofItems(n) {
    const inv = this.game.inv;
    let got = null;
    for (let i = 0; i < n; i++) { const st = pofItem(); if (st) { inv.addStack(st); got = st; } }
    if (!got) return;
    inv.changed();
    this.sound('entity.item.pickup');
  }

  /* ---- Death Swap on this page ----
     Where to start: the spot the server gives (far from everyone else), ground found round it once its terrain is made
     (through the loading screen, as a long teleport goes); in the sea, further on, up to five times. Held there,
     whole and fed, until everyone stands somewhere and the server lets go (dsgo). */
  dsSpread(m) {
    const g = this.game, T = window.__lc2 && window.__lc2.travel;
    let x = Math.floor(+m.x) || 0, z = Math.floor(+m.z) || 0, tries = 0, spot = null;
    this.dsHold = null;
    const done = () => {
      if (!this.game) return;
      const P = this.game.player;
      this.dsHold = { x: P.pos.x, y: P.pos.y, z: P.pos.z };
      this.send({ k: 'placed' });
    };
    // everyone together where they came in (the world's spawn, already loaded): ready once standing on the ground
    if (m.here) {
      let n = 0;
      const ready = () => {
        if (!this.game || this.area !== 'ds') return;
        const P = this.game.player;
        if ((P.onGround || P.inWater || ++n > 40) && this.game.ready) done(); else setTimeout(ready, 250);
      };
      if (g) ready();
      return;
    }
    const go = busy => {
      if (!this.game || this.area !== 'ds') return;
      if (!T) { this.ctx.commandCtx().goTo('overworld', x + 0.5, 200, z + 0.5); setTimeout(done, 4000); return; }
      T('overworld', w => (spot = dsSpot(w, x, z)), { x, z }).then(ok => {
        if (!ok) { if (busy < 40) setTimeout(() => go(busy + 1), 250); else done(); return; }
        // (in the sea: on round the way you were going, further each time, five times before swimming it)
        if (spot && spot.wet && ++tries < 6) { const a = Math.atan2(z, x) + tries * 1.1; x += Math.round(Math.cos(a) * (120 + tries * 60)); z += Math.round(Math.sin(a) * (120 + tries * 60)); go(0); return; }
        done();
      }, () => done());
    };
    if (g) go(0);
  }
  // a swap: to where another player stood, in whichever dimension (a watcher: to someone still in)
  dsGoto(m) {
    const g = this.game;
    if (!g) return;
    const dim = DIM_IDS[m.d | 0] || 'overworld', x = +m.x, y = +m.y, z = +m.z, P = g.player;
    if (![x, y, z].every(Number.isFinite)) return;
    this.dsHold = null;
    if (g.entities && g.entities.riding) g.entities.dismount();
    const face = () => { if (Number.isFinite(+m.yaw)) P.yaw = +m.yaw; if (Number.isFinite(+m.pitch)) P.pitch = +m.pitch; };
    if (g.dim === dim && Math.hypot(x - P.pos.x, z - P.pos.z) < 96 && g.world.loaded(x, z)) {
      P.pos.set(x, y, z); P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.fallDistance = 0; face();
      return;
    }
    const T = window.__lc2 && window.__lc2.travel, at = { x, y, z, yaw: Number.isFinite(+m.yaw) ? +m.yaw : undefined };
    // (a travel already under way, through a portal say, is waited for: the swap still happens)
    const go = n => {
      if (!this.game || this.area !== 'ds') return;
      if (!T) { this.ctx.commandCtx().goTo(dim, x, y, z, +m.yaw, +m.pitch); return; }
      T(dim, () => at, { x, z }).then(ok => { if (!ok && n < 40) setTimeout(() => go(n + 1), 250); else if (ok) face(); }, () => {});
    };
    go(0);
  }
  dsTick() {
    const g = this.game, P = g.player, sv = g.survival, H = this.dsHold;
    if (!H) return;
    P.pos.set(H.x, H.y, H.z); if (P.prev) P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.fallDistance = 0;
    sv.health = sv.maxHealth; sv.food = 20;
  }

  /* ---- Bridging on this page: the run's timer (to the tick), a fall, Reset ---- */
  brTick() {
    const g = this.game, P = g.player, sv = g.survival, R = this.br, inv = g.inv;
    this.replayTick();
    sv.health = sv.maxHealth; P.fallDistance = 0;
    // the blocks never run out
    if (this.t % 4 === 0) {
      const id = idOf(BR_BLOCK), s = inv.slots.find(x => x && x.id === id);
      if (!s) { const i = inv.slots.findIndex((x, j) => j < 9 && !x); if (i >= 0) { inv.slots[i] = stack(BR_BLOCK, 64); inv.changed(); } }
      else if (s.count < 64) { s.count = 64; inv.changed(); }
      // (and Replays and Reset are always there: put back in their slots if anything took them)
      const has = re => inv.slots.some(x => x && x.name && re.test(x.name.replace(/§./g, '')));
      if (!has(/^Replays/)) { const i = !inv.slots[4] ? 4 : inv.slots.findIndex((x, j) => j < 9 && !x); if (i >= 0) { inv.slots[i] = stack('ender_eye', 1, { name: '§bReplays §7- Right Click to watch the fastest bridges' }); inv.changed(); } }
      if (!has(/^Reset/)) { const i = !inv.slots[7] ? 7 : inv.slots.findIndex((x, j) => j < 9 && !x); if (i >= 0) { inv.slots[i] = stack('clock', 1, { name: '§cReset §7- Right Click to go back to the start' }); inv.changed(); } }
    }
    if (P.pos.y < this.floor) { this.brReset(true); return; }
    if (R.done) return;
    const onStart = P.pos.x <= R.start[2] + 1 && P.pos.y >= R.y - 0.1;
    if (!R.t0 && !onStart) { R.t0 = performance.now(); this.overlay.animates = true; this.ctx.gui.markDirty(); }
    else if (R.t0 && onStart && P.onGround) { R.t0 = 0; R.rec = null; }
    // the run's recording: where you are and look, a frame a tick, from the lane's start (watched again from Replays)
    if (R.t0 && !R.done) {
      if (!R.rec) R.rec = { o: [R.start[0], R.y, R.start[1]], f: [], b: [] };
      const o = R.rec.o, av = this.ctx.renderer.avatar, fl = (P.sneaking ? 1 : 0) | (P.onGround ? 2 : 0) | (av && av.swinging ? 4 : 0);
      if (R.rec.f.length < 2400) R.rec.f.push([Math.round((P.pos.x - o[0]) * 100), Math.round((P.pos.y - o[1]) * 100), Math.round((P.pos.z - o[2]) * 100), Math.round(P.yaw * 100), Math.round(P.pitch * 100), fl]);
    }
    // on the end island: the time, sent to be checked and kept
    if (R.t0 && P.onGround && P.pos.x >= R.end[0] && P.pos.x <= R.end[2] + 1 && P.pos.z >= R.end[1] && P.pos.z <= R.end[3] + 1 && P.pos.y >= R.y - 0.1) {
      R.last = Math.round(performance.now() - R.t0); R.done = true;
      this.send({ k: 'brun', ms: R.last, rec: R.rec || null });
      R.rec = null;
    }
  }
  /* A Bridging replay: the run's player as a ghost in your own lane (its frames from your lane's start), a tick a
     frame, the blocks it put down appearing as it did (drawn only here, nothing to stand on), gone two seconds after */
  playReplay(m) {
    this.stopReplay();
    const R = this.br;
    if (!R || !m.rec || !Array.isArray(m.rec.f) || !m.rec.f.length) return;
    const o = [R.start[0], R.y, R.start[1]];
    this.npcs.add({ id: REPLAY_ID, name: '', skin: m.skin || '', slim: !!m.slim });
    this.replay = { f: m.rec.f, b: Array.isArray(m.rec.b) ? m.rec.b : [], i: 0, bi: 0, o, meshes: [], name: m.name };
    this.holo('replay', o[0] + 2.5, o[1] + 3.4, o[2] + 2.5, ['§b§lREPLAY', '§f' + m.name + ' §7- §e' + (m.ms / 1000).toFixed(3) + 's']);
    this.ctx.chat.add('§bWatching §f' + m.name + '§b\'s run §7(' + (m.ms / 1000).toFixed(3) + 's)', 0xFFFFFF);
  }
  replayTick() {
    const Rp = this.replay;
    if (!Rp) return;
    const i = Rp.i++, o = Rp.o, now = performance.now();
    if (i < Rp.f.length) {
      const fr = Rp.f[i];
      this.npcs.state(REPLAY_ID, { ts: now, x: o[0] + fr[0] / 100, y: o[1] + fr[1] / 100, z: o[2] + fr[2] / 100, yaw: fr[3] / 100, pitch: fr[4] / 100, f: (fr[5] & 1 ? F.SNEAK : 0) | (fr[5] & 2 ? F.GROUND : 0), d: 0 }, now);
    }
    const Rn = this.ctx.renderer, w = this.game.world;
    while (Rp.bi < Rp.b.length && Rp.b[Rp.bi][0] <= i) {
      const b = Rp.b[Rp.bi++], d = BLOCKS[B[b[4]]];
      if (!d) continue;
      let geo;
      try { geo = blockGeometry(d, b[5] | 0); } catch (e) { continue; }
      const mesh = new THREE.Mesh(geo.geometry, geo.cutout ? Rn.mats.cutout : Rn.mats.opaque), x = o[0] + b[1], y = o[1] + b[2], z = o[2] + b[3];
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      // (a block mesh's own height runs 0.5 to 1.5: blockmesh.js packs y + 1 and the shader takes none of it off)
      mesh.matrix.makeTranslation(x + 0.5, y - 0.5, z + 0.5); mesh.matrixWorldNeedsUpdate = true;
      const v = lightNear(w, x, y + 1, z, !!w.noSky), lv = (Math.round((v >> 4) / 15 * 255) << 8) | Math.round((v & 15) / 15 * 255), L = mesh.geometry.attributes.aL;
      if (L) { for (let k = 0; k < L.count; k++) { L.array[k * 4] = lv >> 8; L.array[k * 4 + 1] = lv & 255; } L.needsUpdate = true; }
      this.group.add(mesh); Rp.meshes.push(mesh); this.lastGhost = [x, y, z];
    }
    if (i > Rp.f.length + 40) this.stopReplay();
  }
  stopReplay() {
    const Rp = this.replay;
    if (!Rp) return;
    this.replay = null;
    if (this.npcs) this.npcs.remove(REPLAY_ID);
    for (const m of Rp.meshes) { this.group.remove(m); m.geometry.dispose(); }
    this.dropHolo('replay');
  }
  // back at the start of your lane (told: a fall or Reset, which the server clears the blocks for)
  brReset(tell) {
    const R = this.br, g = this.game;
    if (!R || !g) return;
    R.t0 = 0; R.done = false; R.rec = null;
    if (tell) {
      this.send({ k: 'brfall' });
      const P = g.player, s = this.spawn;
      if (s) { P.pos.set(s.x, s.y, s.z); P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.fallDistance = 0; if (Number.isFinite(s.yaw)) P.yaw = s.yaw; }
    }
    this.ctx.gui.markDirty();
  }

  /* ---- the sidebar and the titles ---- */
  draw(g) {
    const B2 = this.board;
    if (B2 && B2.lines.length && !this.ctx.gui.hideHud) {
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
    if (this.area === 'wait' && (this.startable || this.watching) && !this.ctx.gui.hideHud) {
      const msg = this.watching ? '§eSpectating §7- you will play in the next round' : '§ePress §a§lK §eto start the game';
      const x = Math.floor(g.width / 2), y = g.height - 72, w = g.textWidth(msg);
      g.fill(x - Math.ceil(w / 2) - 4, y - 3, x + Math.ceil(w / 2) + 4, y + 11, 0x66000000);
      g.centered(msg, x, y, 0xFFFFFF, true);
    }
    // watching while you hide: whose eyes, and the keys
    if (this.spec && !this.ctx.gui.hideHud) {
      const r = this.spec.id !== null && this.net.players ? this.net.players.list.get(this.spec.id) : null;
      const msg = (r ? '§dWatching §f' + (r.name || 'a player') : '§dFree camera §7- fly about') + ' §7| §eLeft§7/§eRight §7players | §eL §7back to your body';
      const x = Math.floor(g.width / 2), y = g.height - 72, w = g.textWidth(msg);
      g.fill(x - Math.ceil(w / 2) - 4, y - 3, x + Math.ceil(w / 2) + 4, y + 11, 0x66000000);
      g.centered(msg, x, y, 0xFFFFFF, true);
    } else if (!this.ctx.gui.hideHud && this.deadWatch()) {
      // out of the round: how to get about (a spectator has no hotbar for Hypixel's Teleporter and bed)
      const msg = '§7Spectating §8| §eLeft§7/§eRight §7go to a player §8| §e/lobby §7to leave';
      const x = Math.floor(g.width / 2), y = g.height - 40, w = g.textWidth(msg);
      g.fill(x - Math.ceil(w / 2) - 4, y - 3, x + Math.ceil(w / 2) + 4, y + 11, 0x66000000);
      g.centered(msg, x, y, 0xFFFFFF, true);
    }
    // Bridging: the run's time over the hotbar while it runs (and the last one, still, after)
    if (this.br && this.area === 'game' && !this.ctx.gui.hideHud) {
      const R = this.br, ms = R.t0 ? (R.done ? R.last : performance.now() - R.t0) : 0;
      const msg = R.t0 ? (R.done ? '§a' : '§e') + (ms / 1000).toFixed(3) + 's' : '§7Leave the start to begin the timer';
      const x = Math.floor(g.width / 2), y = g.height - 72, w = g.textWidth(msg);
      g.fill(x - Math.ceil(w / 2) - 4, y - 3, x + Math.ceil(w / 2) + 4, y + 11, 0x66000000);
      g.centered(msg, x, y, 0xFFFFFF, true);
    }
    const whistling = !this.ctx.gui.hideHud && this.drawWhistle(g);
    const T = this.titleT;
    const timing = !!(this.br && this.br.t0 && !this.br.done);
    if (!T) this.overlay.animates = whistling || timing;
    if (T) {
      const t = (performance.now() - T.at) / 50, total = T.fi + T.st + T.fo;
      if (t >= total) { this.titleT = null; this.overlay.animates = whistling || timing; return; }
      if (this.ctx.gui.hideHud) return;
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
const onHub = (ctx, fn) => { if (!active || active.game !== ctx.game) { ctx.say('That command only works on Leonpixel.', 0xFF5555); return; } fn(active); };
register('lobby', { always: true, aliases: ['l', 'hub', 'leave'], usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'lobby' })); } });
// (admins: every lobby cosmetic at once, to try them; the server checks)
register('cosall', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'cosall' })); } });
const MODE_IDS = ['bw_solo', 'bw_doubles', 'bw_3s', 'bw_4s', 'sw_solo', 'sw_doubles', 'duels_classic', 'duels_sumo', 'duels_bridge', 'duels_bedwars', 'duels_skywars', 'tntrun', 'murder', 'buildbattle', 'spleef', 'prophunt', 'ch_classic', 'ch_infection', 'ch_double', 'pillars', 'deathswap', 'bridger'];
register('play', {
  always: true, usage: '<mode>', suggest: i => (i === 0 ? (active && active.modes && active.modes.length ? active.modes.map(m => m.id) : MODE_IDS) : []),
  run(args, ctx) { onHub(ctx, h => h.send({ k: 'play', mode: args[0] || 'bw_solo' })); },
});
register('start', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'start' })); } });
// the Map Editor's own: a name for a map made there, or the map gone
register('mapname', { always: true, usage: '<name>', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapname', name: args.join(' ') })); } });
register('mapdelete', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapdelete' })); } });
// the building team, approval, and staff's decision while looking round a map
register('mapshare', { always: true, usage: '<player>', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapshare', name: args[0] || '', on: true })); } });
register('mapunshare', { always: true, usage: '<player>', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapshare', name: args[0] || '', on: false })); } });
register('mapsubmit', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapsubmit' })); } });
register('mapapprove', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapreview', ok: true })); } });
register('mapdeny', { always: true, usage: '[reason]', run(args, ctx) { onHub(ctx, h => h.send({ k: 'mapreview', ok: false, why: args.join(' ') })); } });
register('shout', { always: true, usage: '<message>', run(args, ctx) { onHub(ctx, h => h.send({ k: 'shout', text: args.join(' ') })); } });
register('hubbuild', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'build' })); } });
// (admins: a player's record off a leaderboard, a cheated time or wins; the server checks who asks)
register('lbremove', { always: true, usage: '<game> <player>', run(args, ctx) { if (args.length < 2) { ctx.say('Usage: /lbremove <game> <player>', 0xFF5555); return; } onHub(ctx, h => h.send({ k: 'lbremove', game: args[0], name: args[1] })); } });
/* /fill: anyone with commands as before; on Leonpixel also the maker of the map open in the Map Editor (and staff),
   only inside that map's plot (the server says who may, where.fill, and takes the changes as it takes any there) */
const FILL = commandDef('fill');
const fillHere = ctx => !!(active && active.game === ctx.game && active.area === 'edit' && active.mayFill && active.bounds);
if (FILL) register('fill', Object.assign({}, FILL, {
  always: true,
  run(args, ctx) {
    if (ctx.cheats) return FILL.run(args, ctx);
    if (!fillHere(ctx)) { ctx.say('You do not have permission to use this command', 0xFF5555); return; }
    const b = active.bounds, c = Object.create(ctx);
    c.fillLimit = (x0, y0, z0, x1, y1, z1) => {
      const inX = Math.abs(x0 + 0.5 - b.x) <= b.reach && Math.abs(x1 + 0.5 - b.x) <= b.reach, inZ = Math.abs(z0 + 0.5 - b.z) <= b.reach && Math.abs(z1 + 0.5 - b.z) <= b.reach;
      return inX && inZ && y0 >= b.bottom && y1 <= b.top ? '' : 'That area is outside your map. You can only fill inside its plot';
    };
    return FILL.run(args, c);
  },
}));
// parties, as the network has them: /party invite <player> (or just /party <player>), accept, leave, list, kick, transfer, warp, disband; /pc talks to it
const PARTY_SUBS = ['invite', 'accept', 'leave', 'list', 'kick', 'transfer', 'warp', 'disband', 'help'];
register('party', {
  always: true, aliases: ['p'], usage: '<invite|accept|leave|list|kick|transfer|warp|disband> [player]',
  suggest: (i, w, ctx) => (i === 0 ? PARTY_SUBS : i === 1 && active && active.net && active.net.players ? [...active.net.players.list.values()].map(r => r.name) : []),
  run(args, ctx) { onHub(ctx, h => h.send({ k: 'party', a: args })); },
});
register('pc', { always: true, aliases: ['partychat'], usage: '<message>', run(args, ctx) { onHub(ctx, h => { if (args.length) h.send({ k: 'pchat', text: args.join(' ') }); else ctx.say('Usage: /pc <message>', 0xFF5555); }); } });

// how far along a ray it first meets a box (Infinity when it misses it)
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, a, b] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < a || o > b) return Infinity; continue; }
    let ta = (a - o) / d, tb = (b - o) / d;
    if (ta > tb) { const q = ta; ta = tb; tb = q; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
