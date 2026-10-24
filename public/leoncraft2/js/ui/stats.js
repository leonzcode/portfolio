/* ---------------------------------------------------------------------------
   Leoncraft 2 - the Statistics screen of the game menu (the counts are
   js/stats.js), laid out as the game's: the title, a list, then General,
   Items and Mobs along the bottom with Done under them (Items and Mobs
   greyed out while there is nothing on them).

     General   every statistic the game has, by name, its value on the
               right in the game's units (0.00 s / min / h / d / y, cm, m,
               km; damage in tenths), alternate rows white and grey
     Items     a row for each item with any count: its icon in a slot, then
               Times Mined, Broken, Crafted, Used, Picked Up and Dropped (a
               dash for none); click a column's head to sort by it
     Mobs      a mob you killed or that killed you: its name, then "You
               killed 3 Zombie" and "Zombie killed you 1 time(s)", or the
               "never" lines in a darker grey

   The column heads are item icons of our own choosing (the game draws its
   own little pictures there); their tooltips are the game's names.
--------------------------------------------------------------------------- */
import { Screen, Button, ScrollList, WHITE } from './gui.js?v=107';
import { B, BLOCKS } from '../blocks.js?v=107';
import { itemId, displayName } from '../items.js?v=107';
import { drawStack } from './inventory.js?v=107';
import { entityName } from '../damage.js?v=107';

const ROW_GREY = 0xBABABA, DARK = 0x808080;
// the game's General page: its names, sorted as it sorts them
const GENERAL = Object.entries({
  animals_bred: 'Animals Bred', aviate_one_cm: 'Distance by Elytra', bell_ring: 'Bells Rung', boat_one_cm: 'Distance by Boat',
  clean_armor: 'Armor Pieces Cleaned', clean_banner: 'Banners Cleaned', clean_shulker_box: 'Shulker Boxes Cleaned', climb_one_cm: 'Distance Climbed',
  crouch_one_cm: 'Distance Crouched', damage_absorbed: 'Damage Absorbed', damage_blocked_by_shield: 'Damage Blocked by Shield', damage_dealt: 'Damage Dealt',
  damage_dealt_absorbed: 'Damage Dealt (Absorbed)', damage_dealt_resisted: 'Damage Dealt (Resisted)', damage_resisted: 'Damage Resisted',
  damage_taken: 'Damage Taken', deaths: 'Number of Deaths', drop: 'Items Dropped', eat_cake_slice: 'Cake Slices Eaten', enchant_item: 'Items Enchanted',
  fall_one_cm: 'Distance Fallen', fill_cauldron: 'Cauldrons Filled', fish_caught: 'Fish Caught', fly_one_cm: 'Distance Flown',
  happy_ghast_one_cm: 'Distance by Happy Ghast', horse_one_cm: 'Distance by Horse', inspect_dispenser: 'Dispensers Searched',
  inspect_dropper: 'Droppers Searched', inspect_hopper: 'Hoppers Searched', interact_with_anvil: 'Interactions with Anvil',
  interact_with_beacon: 'Interactions with Beacon', interact_with_blast_furnace: 'Interactions with Blast Furnace',
  interact_with_brewingstand: 'Interactions with Brewing Stand', interact_with_campfire: 'Interactions with Campfire',
  interact_with_cartography_table: 'Interactions with Cartography Table', interact_with_crafting_table: 'Interactions with Crafting Table',
  interact_with_furnace: 'Interactions with Furnace', interact_with_grindstone: 'Interactions with Grindstone', interact_with_lectern: 'Interactions with Lectern',
  interact_with_loom: 'Interactions with Loom', interact_with_smithing_table: 'Interactions with Smithing Table', interact_with_smoker: 'Interactions with Smoker',
  interact_with_stonecutter: 'Interactions with Stonecutter', jump: 'Jumps', leave_game: 'Games Quit', minecart_one_cm: 'Distance by Minecart',
  mob_kills: 'Mob Kills', nautilus_one_cm: 'Distance by Nautilus', open_barrel: 'Barrels Opened', open_chest: 'Chests Opened',
  open_enderchest: 'Ender Chests Opened', open_shulker_box: 'Shulker Boxes Opened', pig_one_cm: 'Distance by Pig', play_noteblock: 'Note Blocks Played',
  play_record: 'Music Discs Played', play_time: 'Time Played', player_kills: 'Player Kills', pot_flower: 'Plants Potted', raid_trigger: 'Raids Triggered',
  raid_win: 'Raids Won', sleep_in_bed: 'Times Slept in a Bed', sneak_time: 'Sneak Time', sprint_one_cm: 'Distance Sprinted', strider_one_cm: 'Distance by Strider',
  swim_one_cm: 'Distance Swum', talked_to_villager: 'Talked to Villagers', target_hit: 'Targets Hit', time_since_death: 'Time Since Last Death',
  time_since_rest: 'Time Since Last Rest', total_world_time: 'Time with World Open', traded_with_villager: 'Traded with Villagers',
  trigger_trapped_chest: 'Trapped Chests Triggered', tune_noteblock: 'Note Blocks Tuned', use_cauldron: 'Water Taken from Cauldron',
  walk_on_water_one_cm: 'Distance Walked on Water', walk_one_cm: 'Distance Walked', walk_under_water_one_cm: 'Distance Walked under Water',
}).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
const TIME = new Set(['play_time', 'sneak_time', 'time_since_death', 'time_since_rest', 'total_world_time']);

// the game's number formats
const dec = v => v.toFixed(2);
export function formatStat(k, v) {
  v = v || 0;
  if (TIME.has(k)) {
    const s = v / 20, m = s / 60, h = m / 60, d = h / 24, y = d / 365;
    return y > 0.5 ? dec(y) + ' y' : d > 0.5 ? dec(d) + ' d' : h > 0.5 ? dec(h) + ' h' : m > 0.5 ? dec(m) + ' min' : dec(s) + ' s';
  }
  if (/_one_cm$/.test(k)) { const m = v / 100, km = m / 1000; return km > 0.5 ? dec(km) + ' km' : m > 0.5 ? dec(m) + ' m' : v + ' cm'; }
  if (/^damage_/.test(k)) return dec(v * 0.1);
  return v.toLocaleString('en-US');
}

// an item's stack to draw, by name (an item, or a block that is its own item)
const stackOf = n => { const id = itemId(n) || (B[n] !== undefined && BLOCKS[B[n]] && BLOCKS[B[n]].item !== false ? B[n] : 0); return id ? { id, count: 1 } : null; };
const COLS = [['mined', 'Times Mined', 'iron_pickaxe'], ['broken', 'Times Broken', 'cracked_stone_bricks'], ['crafted', 'Times Crafted', 'crafting_table'],
  ['used', 'Times Used', 'stick'], ['picked_up', 'Picked Up', 'hopper'], ['dropped', 'Dropped', 'dropper']];
const colX = i => 75 + 40 * i;

class GeneralRow {
  constructor(k, name, v) { this.k = k; this.name = name; this.v = formatStat(k, v); }
  render(g, list, i, y, x, w) {
    const c = i % 2 === 0 ? WHITE : ROW_GREY;
    g.text(this.name, x + 2, y + 1, c);
    g.text(this.v, x + w - 6 - g.textWidth(this.v), y + 1, c);
  }
}
class ItemHead {
  constructor(screen) { this.s = screen; }
  render(g, list, i, y, x, w, h, mx, my) {
    const icons = this.s.icons;
    COLS.forEach(([k, label, icon], c) => {
      const hx = x + colX(c) - 18, st = stackOf(icon);
      g.fill(hx, y, hx + 18, y + 18, this.s.sort === k ? 0xFF8B8B8B : 0xFF555555);
      if (st && icons) drawStack(g, icons, st, hx + 1, y + 1);
      if (mx >= hx && mx < hx + 18 && my >= y && my < y + 18) g.setTooltip([label]);
    });
  }
  mouseClicked(mx, my, button, list) {
    const x = list.rowLeft;
    for (let c = 0; c < COLS.length; c++) {
      const hx = x + colX(c) - 18;
      if (mx >= hx && mx < hx + 18) { this.s.sortBy(COLS[c][0]); return true; }
    }
    return true;
  }
}
class ItemRow {
  constructor(screen, name, vals) { this.s = screen; this.name = name; this.vals = vals; this.st = stackOf(name); }
  render(g, list, i, y, x, w, h, mx, my) {
    // the slot, the icon in it
    g.fill(x, y, x + 18, y + 18, 0xFF8B8B8B); g.fill(x, y, x + 17, y + 1, 0xFF373737); g.fill(x, y, x + 1, y + 17, 0xFF373737);
    g.fill(x + 1, y + 17, x + 18, y + 18, 0xFFFFFFFF); g.fill(x + 17, y + 1, x + 18, y + 18, 0xFFFFFFFF);
    if (this.st && this.s.icons) drawStack(g, this.s.icons, this.st, x + 1, y + 1);
    if (mx >= x && mx < x + 18 && my >= y && my < y + 18) g.setTooltip([this.st ? displayName(this.st) : this.name]);
    const c = i % 2 === 1 ? WHITE : ROW_GREY;
    this.vals.forEach((v, k) => { const t = v ? v.toLocaleString('en-US') : '-'; g.text(t, x + colX(k) - g.textWidth(t), y + 5, c); });
  }
}
class MobRow {
  constructor(type, kills, by) {
    const name = entityName({ type });
    this.name = name;
    this.kills = kills ? `You killed ${kills} ${name}` : `You have never killed ${name}`;
    this.by = by ? `${name} killed you ${by} time(s)` : `You have never been killed by ${name}`;
    this.k = !!kills; this.b = !!by;
  }
  render(g, list, i, y, x) {
    g.text(this.name, x + 2, y + 1, WHITE);
    g.text(this.kills, x + 12, y + 10, this.k ? ROW_GREY : DARK);
    g.text(this.by, x + 12, y + 19, this.b ? ROW_GREY : DARK);
  }
}

export class StatisticsScreen extends Screen {
  constructor(stats, icons) { super('Statistics'); this.S = stats; this.icons = icons; this.page = 0; this.sort = null; this.desc = true; }
  init() {
    const W = this.width, H = this.height, S = this.S;
    const items = this.itemRows(), mobs = this.mobRows();
    const page = this.page;
    this.list = this.add(new ScrollList(0, 32, W, H - 96, page === 1 ? 20 : page === 2 ? 36 : 14, { rowWidth: page === 1 ? 280 : 220 }));
    if (page === 0) this.list.entries = GENERAL.map(([k, name]) => new GeneralRow(k, name, S.custom[k]));
    else if (page === 1) this.list.entries = [new ItemHead(this), ...items];
    else this.list.entries = mobs;
    const bw = W >= 380 ? 120 : 98, gap = 5, x0 = Math.floor(W / 2 - (bw * 3 + gap * 2) / 2);
    ['General', 'Items', 'Mobs'].forEach((label, i) => {
      const b = this.add(new Button(x0 + i * (bw + gap), H - 52, bw, 20, label, () => { this.page = i; this.gui._initScreen(this); }));
      b.active = this.page !== i && (i === 0 || (i === 1 ? items.length > 0 : mobs.length > 0));
    });
    this.add(new Button(W / 2 - 100, H - 28, 200, 20, 'Done', () => this.gui.back()));
  }
  itemRows() {
    const S = this.S, names = new Set();
    for (const [k] of COLS) for (const n in S[k]) if (S[k][n] > 0) names.add(n);
    const rows = [...names].map(n => new ItemRow(this, n, COLS.map(([k]) => S[k][n] || 0)));
    // the game's order (as the items are listed) until a column is chosen
    const order = n => { const st = stackOf(n); return st ? st.id : 1e9; };
    if (this.sort) { const c = COLS.findIndex(x => x[0] === this.sort); rows.sort((a, b) => (this.desc ? b.vals[c] - a.vals[c] : a.vals[c] - b.vals[c]) || order(a.name) - order(b.name)); }
    else rows.sort((a, b) => order(a.name) - order(b.name));
    return rows;
  }
  sortBy(k) {
    if (this.sort === k) this.desc = !this.desc; else { this.sort = k; this.desc = true; }
    const sc = this.list.scroll;
    this.gui._initScreen(this);
    this.list.setScroll(sc);
  }
  mobRows() {
    const S = this.S, types = new Set([...Object.keys(S.killed), ...Object.keys(S.killed_by)]);
    return [...types].map(t => new MobRow(t, S.killed[t] || 0, S.killed_by[t] || 0)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  render(g, mx, my, dt) {
    super.render(g, mx, my, dt);
    this.drawTitle(g, 12);
  }
}
