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

import { B, BLOCKS } from '../blocks.js?v=56';
import { I } from '../items.js?v=56';
import { POTIONS } from '../brewing.js?v=56';
import { ChestScreen } from '../ui/containers.js?v=56';
import { RemotePlayers } from './players.js?v=56';
import { register } from '../commands.js?v=56';
import { Sound } from '../sound/sound.js?v=56';

const THREE = window.THREE;
let active = null;                     // the hub on this page, for its commands
// (no advancement or recipe toasts on the network: its games are not survival)
import('../adv/toast.js?v=56').then(m => { const T = m.AdvToast, add = T.add; T.add = function (x) { if (active) return; return add.call(this, x); }; }).catch(() => {});

const idOf = name => (I[name] !== undefined ? I[name] : B[name] !== undefined ? B[name] : 0);
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
    ],
  };
}
const CATEGORIES = [
  { id: 'quick', name: 'Quick Buy', icon: 'nether_star' }, { id: 'blocks', name: 'Blocks', icon: 'terracotta' }, { id: 'melee', name: 'Melee', icon: 'golden_sword' },
  { id: 'armor', name: 'Armor', icon: 'chainmail_boots' }, { id: 'tools', name: 'Tools', icon: 'stone_pickaxe' }, { id: 'ranged', name: 'Ranged', icon: 'bow' },
  { id: 'potions', name: 'Potions', icon: 'brewing_stand' }, { id: 'utility', name: 'Utility', icon: 'tnt' },
];
const QUICK = ['wool', 'stone_sword', 'chain', 'pick', 'bow', 'speed', 'tnt', 'wood', 'iron_sword', 'ironarmor', 'shears', 'arrow', 'jump', 'water', 'clay', 'endstone', 'axe', 'gapple', 'pearl', 'glass', 'diamond_sword'];
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

class GameMenu extends MenuScreen {
  constructor(hub) { super(hub, 'Game Menu'); }
  fillBox() {
    const hub = this.hub, beds = ['red_bed', 'blue_bed', 'lime_bed', 'yellow_bed'];
    (hub.modes || []).forEach((m, i) => {
      const st = stack(beds[i % beds.length]);
      if (!st) return;
      st.name = '§a' + m.name;
      this.put(20 + i + (i >= 2 ? 1 : 0), st, ['§a' + m.name, '§7Protect your bed and destroy', '§7the enemy beds.', '', '§eClick to play!'], () => { hub.send({ k: 'play', mode: m.id }); hub.closeScreens(); });
    });
  }
}

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
    I2.down = b => { if (b === 0 && this.clickNpc()) return; down(b); };
    I2.mayBreak = (x, y, z) => this.mayBreak(x, y, z);
    I2.mayPlace = (x, y, z) => this.mayPlace(x, y, z);
    this.unhook = () => { I2.useWith = use; I2.down = down; I2.mayBreak = null; I2.mayPlace = null; };
    // every change seen while a game is on (yours and everyone's): those may be broken again, the map may not
    const net = this.net, blocks = net.blocks.bind(net), local = net.local.bind(net);
    net.blocks = (d, e) => { if (this.area === 'game') for (let i = 0; i + 4 < e.length; i += 5) this.changed.add(e[i] + ',' + e[i + 1] + ',' + e[i + 2]); return blocks(d, e); };
    net.local = (w, x, y, z, b, m, prev) => { if (this.area === 'game') this.changed.add(x + ',' + y + ',' + z); return local(w, x, y, z, b, m, prev); };
    this.unwrapNet = () => { net.blocks = blocks; net.local = local; };
  }
  detach() {
    if (active === this) active = null;
    if (this.overlay) { const o = this.ctx.gui.overlays, i = o.indexOf(this.overlay); if (i >= 0) o.splice(i, 1); }
    if (this.npcs) { this.npcs.dispose(); this.npcs = null; }
    this.clearHolos();
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    if (this.unhook) this.unhook();
    if (this.unwrapNet) this.unwrapNet();
    this.game = null;
  }

  /* ---- what the server says ---- */
  receive(m) {
    const g = this.game;
    if (!g) return;
    switch (m.k) {
      case 'hello': this.modes = m.modes || []; return;
      case 'where': {
        this.area = m.area; this.floor = m.floor; this.spawn = m.spawn; this.bounds = m.bounds || null;
        if (m.team) this.team = m.team;
        if (m.per) this.per = m.per;
        if (m.area !== 'game') { this.team = null; this.alive = false; }
        this.setNpcs(m.npcs || []);
        this.setGens(m.gens || []);
        this.closeScreens();
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
    } else if (kind === 'wait') {
      inv.slots[8] = stack('red_bed', 1, { name: '§c§lReturn to Lobby §7(Right Click)' });
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
    if (!g || this.area !== 'game') return;
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
  mayBreak(x, y, z) {
    if (this.building) return true;
    if (this.area !== 'game' || !this.alive) return false;
    const w = this.game.world, b = w.get(x, y, z), d = BLOCKS[b];
    // another team's bed may be broken; your own never
    if (d && d.shape === 'bed') return !this.team || d.name !== this.team.wool.replace('_wool', '_bed');
    return this.changed.has(x + ',' + y + ',' + z);
  }
  mayPlace(x, y, z) {
    if (this.building) return true;
    if (this.area !== 'game' || !this.alive) return false;
    const b = this.bounds;
    if (b && (Math.abs(x + 0.5 - b.x) > b.reach || Math.abs(z + 0.5 - b.z) > b.reach || y > b.top || y < b.bottom)) {
      this.ctx.chat.add('§cYou can\'t place blocks here!', 0xFF5555);
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
      this.npcs.add({ id: n.nid, name: '', eq: n.held ? { h: n.held, o: '', a: null } : null });
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
    if (kind === 'play') this.send({ k: 'npc', id: n.id });
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
    if (!h) return false;
    if (this.area === 'lobby' && h.id === idOf('compass')) { this.openScreen(new GameMenu(this)); return true; }
    if (this.area === 'wait' && h.id === idOf('red_bed')) { this.send({ k: 'lobby' }); return true; }
    return false;
  }
  openScreen(s) { this.game.hands.open(s); }
  // (for tests: window.__lc2hub)
  openShop() { this.openScreen(new ShopScreen(this)); }
  openUpgrades() { this.openScreen(new UpgradeScreen(this)); }
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
    for (const n of this.npcList) this.feed(n);
    // no hunger anywhere on the network
    sv.food = 20;
    if (this.area !== 'game') {
      // the lobby and the waiting rooms: nothing hurts, and falling off brings you back
      sv.health = sv.maxHealth;
      if (this.spawn && P.pos.y < this.floor) this.ctx.commandCtx().goTo(g.dim, this.spawn.x, this.spawn.y, this.spawn.z, this.spawn.yaw, 0);
      return;
    }
    if (!this.alive) return;
    // the void takes you at once
    if (P.pos.y < this.floor && !sv.dead) { this.voided = true; sv.hurt(3.4e38, 'out_of_world'); return; }
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
  frame(now, dt, eye) {
    const g = this.game;
    if (!g || !this.npcs) return;
    this.npcs.frame(now, dt, g.world, 0, eye, 96, g.mode === 'spectator');
    // (their own name tags stay hidden: the words over them are the holograms)
    for (const r of this.npcs.list.values()) if (r.tag) r.tag.far.visible = r.tag.near.visible = false;
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
register('play', {
  always: true, usage: '<bw_solo|bw_doubles|bw_3s|bw_4s>', suggest: i => (i === 0 ? ['bw_solo', 'bw_doubles', 'bw_3s', 'bw_4s'] : []),
  run(args, ctx) { onHub(ctx, h => h.send({ k: 'play', mode: args[0] || 'bw_solo' })); },
});
register('start', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'start' })); } });
register('shout', { always: true, usage: '<message>', run(args, ctx) { onHub(ctx, h => h.send({ k: 'shout', text: args.join(' ') })); } });
register('hubbuild', { always: true, usage: '', run(args, ctx) { onHub(ctx, h => h.send({ k: 'build' })); } });
