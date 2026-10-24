/* ---------------------------------------------------------------------------
   Leoncraft 2 - the little things blocks do when you use them, from the
   Minecraft Wiki:

   Cauldrons: a water, lava or powder snow bucket fills one (water and powder
   snow to level 3); an empty bucket takes back a full one; a glass bottle
   takes a level of water out and a water bottle puts one in.

   Composters: compostable things go in one at a time, each with its chance
   to raise the level (the first one into an empty composter always does);
   at level 7 it turns ready a second later (level 8), and a click then
   throws out bone meal and empties it.

   Campfires: raw food is laid on one (four places), cooks in 30 seconds
   (the recipe's time) and pops out on top; a shovel puts one out, flint and
   steel or a fire charge lights it again; breaking it spills what was on it.

   Signs: placing one opens the editing screen (ui/sign.js); a click edits
   the side you are looking at, unless it is waxed. A dye colours the side's
   text, a glow ink sac makes it glow, an ink sac takes the glow away, and
   honeycomb waxes the sign so it can no longer be changed. The text is drawn
   on the board with the game's font, darker away from the light, as the
   game draws it.

   Item frames (and glow item frames) go on any face of a block; a click
   puts the held item in (one of it) and then turns it an eighth at a time;
   a hit knocks the item out, the next hit takes the frame down. A glow
   frame and what it holds are drawn at full light.

   Jukeboxes: a music disc goes in (one of it) and plays for its song's
   length, "Now Playing" over the hotbar and a note rising from the top
   every second while it does; a click takes the disc back out, thrown up
   from the top; breaking the jukebox drops it. The block's meta is 1 while
   it holds a disc (a comparator reads the song's number then, sim/rsparts.js).

   Vaults (trial chambers): a trial key used on one (an ominous trial key on
   an ominous one, meta bit 8) is taken and the vault rolls its reward
   table (chests/trial_chambers/reward, or reward_ominous), then throws the
   stacks up out of its top one at a time, a second apart, after a moment
   unlocking. Each vault rewards you once; after that it takes no key. It
   lights up while you are within 4 blocks of one that has not rewarded you,
   and opens its front while it unlocks and gives (meta bits 4-5).

   Decorated pots hold one stack of one kind of thing: a click with an item
   puts one in, and breaking the pot spills it (sim/lids.js wobbles the pot).

   Chiseled bookshelves hold six books (a book, a book and quill, a written
   or enchanted book, a knowledge book), one to a slot: a click on the front
   with one puts it in the slot under the crosshair, a click on a slot that
   holds one takes it out (whatever is in your hand). Which slots are full is
   the block's state (meta bits 2-7, models.js draws them); a comparator
   reads the last slot used, 1 to 6; breaking it spills the books.

   Lecterns take a book and quill or a written book (bit 2 of the meta: the
   book drawn open on its top, entities/tablebook.js). With a book on it a
   click opens the book where it was left; each page turned sends a redstone
   pulse two ticks long (sim/rsparts.js) and a comparator reads how far
   through the book it is; Take Book takes it back, and breaking the lectern
   drops it.

   What it remembers (sign text, food on campfires, framed items, discs, vaults, what pots, shelves and lecterns
   hold) is kept per dimension (main.js saves it beside the chests, as 'details').
--------------------------------------------------------------------------- */
import { B, BLOCKS } from './blocks.js?v=107';
import { lightNear } from './lightlevel.js?v=107';
import { glints } from './render/armor.js?v=107';
import { setGlint } from './render/glint.js?v=107';
import { I, ITEMS, itemName, withCount, stackToJSON, stackFromJSON, SONGS, sameItem, maxStack } from './items.js?v=107';
import { potWobbled } from './sim/lids.js?v=107';
import { BookScreen } from './ui/book.js?v=107';
import { wantBook } from './entities/tablebook.js?v=107';
import { cookingRecipe } from './crafting.js?v=107';
import { hiveUse } from './entities/hives.js?v=107';

/* Other modules keep state of their own with a dimension's block entities (struct/trials.js: a trial
   spawner's cooldown): registerExtra(k, { save(details) -> entries with that k, load(details, entry), reset(details) }). */
const EXTRA = new Map();
export function registerExtra(k, x) { EXTRA.set(k, x); }
const THREE = window.THREE;

/* ---- the composter's chances, by item (Minecraft Wiki, Composter) ---- */
const COMPOST = new Map();
const chance = (p, list) => { for (const n of list.split(' ')) COMPOST.set(n, p); };
chance(0.3, 'beetroot_seeds dried_kelp glow_berries short_grass grass hanging_roots kelp mangrove_roots melon_seeds moss_carpet pink_petals ' +
  'pitcher_pod pumpkin_seeds seagrass small_dripleaf sweet_berries torchflower_seeds wheat_seeds pale_moss_carpet pale_hanging_moss leaf_litter ' +
  'wildflowers bush cactus_flower firefly_bush short_dry_grass tall_dry_grass');
for (const n of Object.keys(B)) if (/_leaves$|_sapling$|^mangrove_propagule$/.test(n)) COMPOST.set(n, 0.3);
chance(0.5, 'cactus dried_kelp_block flowering_azalea_leaves glow_lichen melon_slice nether_sprouts sugar_cane tall_grass twisting_vines vine weeping_vines');
chance(0.65, 'apple azalea beetroot big_dripleaf carrot cocoa_beans fern large_fern crimson_fungus warped_fungus lily_pad melon moss_block pale_moss_block ' +
  'brown_mushroom red_mushroom mushroom_stem nether_wart potato pumpkin carved_pumpkin crimson_roots warped_roots sea_pickle shroomlight spore_blossom wheat ' +
  'dandelion poppy blue_orchid allium azure_bluet red_tulip orange_tulip white_tulip pink_tulip oxeye_daisy cornflower lily_of_the_valley wither_rose ' +
  'sunflower lilac rose_bush peony open_eyeblossom closed_eyeblossom');
chance(0.85, 'baked_potato bread cookie flowering_azalea hay_block brown_mushroom_block red_mushroom_block nether_wart_block pitcher_plant torchflower warped_wart_block');
chance(1, 'cake pumpkin_pie');

/* ---- sign text colours: the dye's text colour (DyeColor) ---- */
const DYE_TEXT = { white: 0xFFFFFF, orange: 0xFF681F, magenta: 0xFF00FF, light_blue: 0x9AC0CD, yellow: 0xFFFF00, lime: 0xBFFF00, pink: 0xFF69B4,
  gray: 0x808080, light_gray: 0xD3D3D3, cyan: 0x00FFFF, purple: 0xA020F0, blue: 0x0000FF, brown: 0x8B4513, green: 0x00FF00, red: 0xFF0000, black: 0x000000 };
// unlit text is drawn at 40% of its colour; glowing text is full colour with an outline in the dark colour (black text: a pale outline)
const dark = c => (Math.round(((c >> 16) & 255) * 0.4) << 16) | (Math.round(((c >> 8) & 255) * 0.4) << 8) | Math.round((c & 255) * 0.4);

const DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
// what a chiseled bookshelf takes (the game's bookshelf_books tag)
const SHELF_BOOKS = /^(book|writable_book|written_book|enchanted_book|knowledge_book)$/;
// the simulation's sound hook (sound/game.js sets sim.onSound), for the block sounds made here
const sound = (h, e, x, y, z) => { const s = h && h.inter && h.inter.sim; if (s && s.onSound) s.onSound(e, x, y, z); };
const SIDE_FACING = { 5: 0, 0: 1, 4: 2, 1: 3 };
export const isSign = d => !!d && (d.shape === 'sign' || d.shape === 'wall_sign') && !d.banner;
const key = (x, y, z) => x + ',' + y + ',' + z;
// the kinds drawn by the block itself (or by sim/lids.js, entities/tablebook.js), not here
const NOT_DRAWN = new Set(['jukebox', 'vault', 'decorated_pot', 'shelf', 'lectern']);

/* Where a sign's board is: its middle, the way its front looks (a unit
   vector), and the board's size in blocks, from the sign's model (models.js). */
export function signBoard(d, m, x, y, z) {
  let F, out, cy, w = 1, h = 0.5, back = 0;
  if (d.shape === 'wall_sign') {
    const wall = SIDE_FACING[m & 7] || 0;
    // a wall sign looks out from its wall; a hanging one on a wall sticks out from it, so it looks along the wall
    F = d.hanging ? (wall + 1) & 3 : (wall + 2) & 3;
    // (a wall sign's board is 1.5/16 thick against the wall, so its middle is that far back from the block's: back)
    if (d.hanging) { out = 1 / 16; cy = 5 / 16; w = 14 / 16; h = 10 / 16; } else { out = 0.75 / 16; cy = 8.5 / 16; back = 0.5 - 0.75 / 16; }
  } else {
    // a standing sign built facing north: its front looks north, turned with it
    F = m & 3;
    if (d.hanging) { out = 1 / 16; cy = 5 / 16; w = 14 / 16; h = 10 / 16; } else { out = 0.67 / 16; cy = 13.33 / 16; }
  }
  let [dx, , dz] = DIRS[F];
  // a standing sign turned sixteenths past its quarter (models.js sign, bits 2-3)
  const k = d.shape === 'sign' && !d.hanging && !d.banner ? (m >> 2) & 3 : 0;
  if (k) { const t = (F * 4 + k) * Math.PI / 8; dx = Math.sin(t); dz = -Math.cos(t); }
  return { F, cx: x + 0.5 - dx * back, cy: y + cy, cz: z + 0.5 - dz * back, nx: dx, nz: dz, out, w, h, twoSided: true };
}

export class Details {
  constructor({ world, drops, renderer, gui }) {
    this.world = world; this.drops = drops; this.R = renderer; this.gui = gui;
    this.map = new Map();          // "x,y,z" -> { k: 'sign' | 'campfire', ... }
    this.dirty = false;
    this.ticks = 0;
    this.ripen = [];               // composters at level 7, and when they turn ready
    this.group = new THREE.Group(); this.group.name = 'details';
    if (renderer && renderer.scene) renderer.scene.add(this.group);
    this.onEdit = null;            // (x, y, z, front) opens the sign screen (main.js)
  }
  dispose() {
    for (const e of this.map.values()) this._unshow(e);
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  /* ---- right click on a block; h is the hands (hands.js). True if it did something ---- */
  use(h, hit) {
    const w = this.world, b = w.get(hit.x, hit.y, hit.z), d = BLOCKS[b];
    if (!d) return false;
    const s = h.held, n = s ? itemName(s.id) : '';
    if (d.frame) return this.frameUse(h, hit, s);
    if (/^(cod|salmon|tropical_fish|pufferfish|axolotl|tadpole)_bucket$/.test(n) && hit.face) return this.emptyCreature(h, hit, n);
    if ((n === 'item_frame' || n === 'glow_item_frame') && hit.face) return this.hangFrame(h, hit, n);
    if (d.shape === 'cauldron') return this.cauldron(h, hit, d, s, n);
    if (d.name === 'composter') return this.composter(h, hit, s, n);
    if (d.shape === 'campfire') return this.campfire(h, hit, d, s, n);
    if (d.shape === 'cake') return this.cake(h, hit, d, s, n);
    if (d.shape === 'pot') return this.pot(h, hit, d, s, n);
    if (d.shape === 'candle') return this.candle(h, hit, d, s, n);
    if (isSign(d)) return this.sign(h, hit, d, s, n);
    if (d.name === 'jukebox') return this.jukebox(h, hit, s, n);
    if (d.name === 'vault') return this.vault(h, hit, s, n);
    if (d.name === 'decorated_pot') return this.decoratedPot(h, hit, s);
    if (d.name === 'beehive' || d.name === 'bee_nest') return hiveUse(this, h, hit, d, s, n);
    if (d.name === 'chiseled_bookshelf') return this.shelf(h, hit, s, n);
    if (d.name === 'lectern') return this.lectern(h, hit, s, n);
    return false;
  }
  /* A chiseled bookshelf: the slot under the crosshair on its front (two rows of three, six, five and five
     pixels wide from the left as you face it). */
  shelf(h, hit, s, n) {
    const w = this.world, { x, y, z } = hit, b = w.get(x, y, z), m = w.meta(x, y, z), F = DIRS[m & 3], f = hit.face;
    if (!f || f[0] !== F[0] || f[1] !== 0 || f[2] !== F[2]) return false;
    const p = hit.hit || [x + 0.5, y + 0.5, z + 0.5], fx = p[0] - x, fz = p[2] - z;
    const u = [1 - fx, 1 - fz, fx, fz][m & 3];
    const slot = (p[1] - y >= 0.5 ? 0 : 3) + (u < 6 / 16 ? 0 : u < 11 / 16 ? 1 : 2), bit = 4 << slot;
    const e = this.entry(x, y, z, 'shelf');
    if (m & bit) {
      // taken out, into the inventory (or dropped when there is no room)
      const st = e.items[slot] || (I.book !== undefined ? { id: I.book, count: 1 } : null);
      e.items[slot] = null; e.last = slot;
      if (st) h.inv.placeBack(st);
      w.set(x, y, z, b, m & ~bit);
      sound(h, st && st.enchants ? 'block.chiseled_bookshelf.pickup.enchanted' : 'block.chiseled_bookshelf.pickup', x, y, z);
      this.dirty = true;
      return true;
    }
    if (!s || !SHELF_BOOKS.test(n)) return false;
    e.items[slot] = withCount(s, 1); e.last = slot;
    if (!h.creative) h.inv.takeSelected(1);
    w.set(x, y, z, b, m | bit);
    sound(h, n === 'enchanted_book' ? 'block.chiseled_bookshelf.insert.enchanted' : 'block.chiseled_bookshelf.insert', x, y, z);
    this.dirty = true;
    return true;
  }
  // what a comparator reads from a chiseled bookshelf: the last slot used, 1 to 6 (0 before any)
  shelfSignal(x, y, z) { const e = this.map.get(key(x, y, z)); return e && e.k === 'shelf' && e.last >= 0 ? e.last + 1 : 0; }
  /* A lectern: a book goes on it, or the one on it opens to read (and to take back). */
  lectern(h, hit, s, n) {
    const w = this.world, { x, y, z } = hit, b = w.get(x, y, z), m = w.meta(x, y, z);
    if (!(m & 4)) {
      if (n !== 'writable_book' && n !== 'written_book') return false;
      const e = this.entry(x, y, z, 'lectern');
      e.book = withCount(s, 1); e.page = 0;
      if (!h.creative) h.inv.takeSelected(1);
      w.set(x, y, z, b, m | 4);
      wantBook(x, y, z);
      sound(h, 'item.book.put', x, y, z);
      this.dirty = true;
      return true;
    }
    const e = this.entry(x, y, z, 'lectern'), bk = e.book || {}, sim = h.inter && h.inter.sim;
    const here = () => w.get(x, y, z) === b && (w.meta(x, y, z) & 4) && this.map.get(key(x, y, z)) === e;
    h.open(new BookScreen({
      pages: bk.pages || [], title: bk.title, author: bk.author, written: true, page: e.page,
      onPage: p => { if (!here()) return; e.page = p; this.dirty = true; if (sim && sim.lecternPulse) sim.lecternPulse(x, y, z); sound(h, 'item.book.page_turn', x, y, z); },
      take: () => {
        if (!here()) return;
        if (e.book) h.inv.placeBack(e.book);
        e.book = null; e.page = 0;
        w.set(x, y, z, b, w.meta(x, y, z) & ~4);
        this.dirty = true;
      },
    }));
    return true;
  }
  // what a comparator reads from a lectern with a book: how far through it the open page is, 1 to 15
  lecternSignal(x, y, z) {
    const e = this.map.get(key(x, y, z));
    if (!e || e.k !== 'lectern' || !e.book) return 0;
    const pages = Math.max(1, (e.book.pages || []).length);
    return pages > 1 ? Math.floor(1 + 14 * e.page / (pages - 1)) : 15;
  }
  /* A decorated pot holds one stack of one kind of thing: a click with an item puts one in and the pot wobbles;
     when it cannot take it (another kind, or full) it shakes instead. Breaking it spills what it held (the
     game's DecoratedPotBlock; the wobble is drawn by sim/lids.js). */
  decoratedPot(h, hit, s) {
    if (!s) return false;
    const { x, y, z } = hit, e = this.entry(x, y, z, 'decorated_pot');
    const ok = !e.item || (sameItem(e.item, s) && e.item.count < maxStack(s.id));
    if (ok) {
      if (e.item) e.item.count++; else e.item = withCount(s, 1);
      if (!h.creative) h.inv.takeSelected(1);
      this.dirty = true;
    }
    potWobbled(x, y, z, ok);
    return true;
  }
  vault(h, hit, s, n) {
    const w = this.world, x = hit.x, y = hit.y, z = hit.z, ominous = (w.meta(x, y, z) & 8) !== 0;
    if (n !== (ominous ? 'ominous_trial_key' : 'trial_key')) return false;
    const e = this.entry(x, y, z, 'vault');
    if (e.rewarded || e.queue.length) return false;
    e.rewarded = true; e.at = this.ticks + 14; e.unlockUntil = e.at;
    if (!h.creative) h.inv.takeSelected(1);
    import('./struct/loot.js?v=107').then(L => import('./containers.js?v=107').then(C => {
      const table = 'trial_chambers/' + (ominous ? 'reward_ominous' : 'reward');
      // (the game's getRandomItems: the stacks as drawn, one thrown out at a time, never shuffled or split as a chest's are)
      for (const r of L.rollItems(table, (Math.random() * 2147483647) | 0)) { const st = C.lootStack(r); if (st) e.queue.push(st); }
      this.dirty = true;
    }));
    this.dirty = true;
    return true;
  }
  jukebox(h, hit, s, n) {
    const w = this.world, x = hit.x, y = hit.y, z = hit.z, e = this.map.get(key(x, y, z));
    if (e && e.k === 'jukebox' && e.disc) {
      this.ejectDisc(e);
      return true;
    }
    if (!SONGS[n]) return false;
    const j = this.entry(x, y, z, 'jukebox');
    j.disc = withCount(s, 1); j.t = 0;
    w.set(x, y, z, B.jukebox, 1);
    if (!h.creative) h.inv.takeSelected(1);
    const msg = h.inter && h.inter.sim && h.inter.sim.msg;
    if (msg) msg.show('Now Playing: ' + SONGS[n][0], 60);
    this.dirty = true;
    return true;
  }
  // the disc thrown up out of the top, as the game pops it
  ejectDisc(e) {
    const w = this.world;
    if (e.disc && this.drops) this.drops.spawn(e.x + 0.5 + (Math.random() - 0.5) * 0.7, e.y + 1.01, e.z + 0.5 + (Math.random() - 0.5) * 0.7, e.disc, { vel: [0, 0.1, 0] });
    e.disc = null; e.t = 0;
    if (w.get(e.x, e.y, e.z) === B.jukebox) w.set(e.x, e.y, e.z, B.jukebox, 0);
    this.map.delete(key(e.x, e.y, e.z));
    this.dirty = true;
  }
  // what a comparator reads from a jukebox: its song's number while it holds a disc
  jukeboxSignal(x, y, z) {
    const e = this.map.get(key(x, y, z)), song = e && e.k === 'jukebox' && e.disc ? SONGS[itemName(e.disc.id)] : null;
    return song ? song[2] : 0;
  }
  // an item frame on the face clicked: the face of its own cell that touches the block (models.js 'on a face')
  hangFrame(h, hit, n) {
    const w = this.world, f = hit.face, x = hit.x + f[0], y = hit.y + f[1], z = hit.z + f[2];
    const cur = w.get(x, y, z);
    if (cur && !BLOCKS[cur].replaceable) return false;
    const b = B[n === 'glow_item_frame' ? 'lc2_glow_item_frame' : 'lc2_item_frame'];
    if (b === undefined) return false;
    const face = f[0] === 1 ? 1 : f[0] === -1 ? 0 : f[1] === 1 ? 3 : f[1] === -1 ? 2 : f[2] === 1 ? 5 : 4;
    w.set(x, y, z, b, face);
    const e = this.entry(x, y, z, 'frame');
    e.item = null; e.rot = 0; this.changed(e);
    if (!h.creative) h.inv.takeSelected(1);
    return true;
  }
  frameUse(h, hit, s) {
    const e = this.entry(hit.x, hit.y, hit.z, 'frame');
    if (e.item) e.rot = (e.rot + 1) & 7;
    else if (s) { e.item = withCount(s, 1); e.rot = 0; if (!h.creative) h.inv.takeSelected(1); }
    else return false;
    this.changed(e);
    return true;
  }
  // a hit on a frame that holds something takes the item out (it drops in survival); true when it did
  punch(x, y, z) {
    const e = this.map.get(key(x, y, z));
    if (!e || e.k !== 'frame' || !e.item) return false;
    if (!(this.creative && this.creative()) && this.drops) this.drops.spawn(x + 0.5, y + 0.4, z + 0.5, e.item);
    e.item = null; e.rot = 0;
    this.changed(e);
    return true;
  }
  /* A flower pot: a plant that has a potted kind goes into an empty one; any other click on a full one takes
     the plant back out into your hands (the game's FlowerPotBlock). */
  pot(h, hit, d, s, n) {
    const w = this.world, { x, y, z } = hit;
    const potted = s ? (B['potted_' + n] !== undefined ? B['potted_' + n] : B['potted_' + n + '_bush']) : undefined;
    if (potted !== undefined) {
      if (d.name === 'flower_pot') { w.set(x, y, z, potted, 0); if (!h.creative) h.inv.takeSelected(1); }
      return true;
    }
    if (d.name === 'flower_pot' || !/^potted_/.test(d.name)) return true;
    let plant = d.name.slice(7);
    if (I[plant] === undefined && B[plant] === undefined) plant = plant.replace(/_bush$/, '');
    const id = I[plant] !== undefined ? I[plant] : B[plant];
    if (id !== undefined) h.inv.add(id, 1);
    w.set(x, y, z, B.flower_pot, 0);
    return true;
  }
  // a bucket of a fish (an axolotl, a tadpole): its water goes where the click lands, and the creature into it, for good
  emptyCreature(h, hit, n) {
    const w = this.world, f = hit.face, b = w.get(hit.x, hit.y, hit.z);
    const into = BLOCKS[b] && BLOCKS[b].replaceable && !BLOCKS[b].fluid ? [hit.x, hit.y, hit.z] : [hit.x + f[0], hit.y + f[1], hit.z + f[2]];
    const [x, y, z] = into, cur = w.get(x, y, z);
    if (cur && !BLOCKS[cur].replaceable) return false;
    if (cur !== B.water || w.meta(x, y, z) !== 0) { w.set(x, y, z, B.water, 0); if (h.fluids) h.fluids.around(x, y, z); }
    const E = this.entities && this.entities();
    if (E) E.spawn(n.slice(0, -7), x + 0.5, y + 0.1, z + 0.5, { persistent: true });
    if (!h.creative) { h.inv.slots[h.inv.selected] = { id: I.bucket, count: 1 }; h.inv.changed(); }
    return true;
  }
  // flint and steel wears, a fire charge is used up
  lighter(h, n) { if (h.creative) return; if (n === 'flint_and_steel') h.inv.damageSelected(1); else h.inv.takeSelected(1); }
  candle(h, hit, d, s, n) {
    const w = this.world, { x, y, z } = hit, m = w.meta(x, y, z), b = w.get(x, y, z);
    if (!(m & 4) && (n === 'flint_and_steel' || n === 'fire_charge')) { w.set(x, y, z, b, m | 4); this.lighter(h, n); return true; }
    // an empty hand blows them out
    if ((m & 4) && !s) { w.set(x, y, z, b, m & ~4); return true; }
    return false;
  }
  /* A cake: a slice for 2 hunger and 0.4 saturation each click (seven slices), when you can eat (always in
     creative); a candle goes on an uncut one. A candle cake lights like a candle, an empty hand blows it out,
     and eating from it drops the candle and leaves a cake with a slice gone. */
  cake(h, hit, d, s, n) {
    const w = this.world, { x, y, z } = hit, m = w.meta(x, y, z), b = w.get(x, y, z);
    const candleCake = /candle_cake$/.test(d.name);
    if (candleCake) {
      if (!(m & 4) && (n === 'flint_and_steel' || n === 'fire_charge')) { w.set(x, y, z, b, m | 4); this.lighter(h, n); return true; }
      if ((m & 4) && !s) { w.set(x, y, z, b, m & ~4); return true; }
    } else if (s && /candle$/.test(n) && (m & 7) === 0 && B[n + '_cake'] !== undefined) {
      w.set(x, y, z, B[n + '_cake'], 0);
      if (!h.creative) h.inv.takeSelected(1);
      return true;
    }
    const sv = h.survival;
    if (!h.creative && sv && !sv.wantsFood(false)) return false;
    if (sv && !h.creative) sv.eat(2, 0.4);
    if (candleCake) {
      w.set(x, y, z, B.cake, 1);
      const c = I[d.candle] !== undefined ? I[d.candle] : B[d.candle];
      if (c !== undefined && this.drops) this.drops.popFrom(x, y, z, { id: c, count: 1 });
      return true;
    }
    const bites = (m & 7) + 1;
    if (bites > 6) w.set(x, y, z, 0, 0); else w.set(x, y, z, b, bites);
    return true;
  }
  // the held stack becomes `to` (one of them), the rest stays; creative keeps what it held
  swap(h, to) {
    if (h.creative) return;
    const s = h.held, inv = h.inv;
    if (s.count <= 1) inv.slots[inv.selected] = to;
    else { s.count--; if (to) inv.placeBack(to); }
    inv.changed();
  }
  cauldron(h, hit, d, s, n) {
    if (!s) return false;
    const w = this.world, { x, y, z } = hit, m = w.meta(x, y, z);
    const lv = d.name === 'cauldron' ? 0 : (m & 3) || 3;
    const set = (name, l) => { w.set(x, y, z, B[name], l); this.dirty = true; };
    const bucket = { id: I.bucket, count: 1 };
    if (n === 'water_bucket' || n === 'lava_bucket' || n === 'powder_snow_bucket') {
      const into = { water_bucket: 'water_cauldron', lava_bucket: 'lava_cauldron', powder_snow_bucket: 'powder_snow_cauldron' }[n];
      if (B[into] === undefined) return false;
      set(into, into === 'lava_cauldron' ? 0 : 3);
      this.swap(h, bucket);
      return true;
    }
    if (n === 'bucket' && d.name !== 'cauldron') {
      if (d.name !== 'lava_cauldron' && lv < 3) return false;
      const full = { water_cauldron: 'water_bucket', lava_cauldron: 'lava_bucket', powder_snow_cauldron: 'powder_snow_bucket' }[d.name];
      if (!full || I[full] === undefined) return false;
      set('cauldron', 0);
      this.swap(h, { id: I[full], count: 1 });
      return true;
    }
    if (n === 'glass_bottle' && d.name === 'water_cauldron') {
      if (lv <= 1) set('cauldron', 0); else set('water_cauldron', lv - 1);
      const water = { id: I.potion, count: 1, potion: 'water' };
      if (h.creative) h.inv.placeBack(water); else this.swap(h, water);
      return true;
    }
    /* washing in water (the game's cauldron interactions): dyed leather loses its colour, a banner its last
       pattern, a dyed shulker box its dye (keeping what it holds); each takes a level of water */
    if (d.name === 'water_cauldron' && lv > 0) {
      let done = false;
      if (s.color !== undefined && /^leather_|^leather_horse_armor$|^wolf_armor$/.test(n)) { delete s.color; done = true; }
      else if (/_banner$/.test(n) && Array.isArray(s.patterns) && s.patterns.length) { s.patterns = s.patterns.slice(0, -1); if (!s.patterns.length) delete s.patterns; done = true; }
      else if (/_shulker_box$/.test(n) && I.shulker_box !== undefined) {
        const plain = Object.assign({}, s, { id: I.shulker_box, count: 1 });
        if (h.creative) h.inv.placeBack(plain); else this.swap(h, plain);
        done = true;
      }
      if (done) {
        if (lv <= 1) set('cauldron', 0); else set('water_cauldron', lv - 1);
        h.inv.changed();
        return true;
      }
    }
    if (n === 'potion' && s.potion === 'water' && (d.name === 'cauldron' || (d.name === 'water_cauldron' && lv < 3))) {
      set('water_cauldron', lv + 1);
      this.swap(h, { id: I.glass_bottle, count: 1 });
      return true;
    }
    return false;
  }
  composter(h, hit, s, n) {
    const w = this.world, { x, y, z } = hit, lv = Math.min(8, w.meta(x, y, z) & 15);
    // ready: out comes the bone meal, just above it
    if (lv === 8) {
      w.set(x, y, z, B.composter, 0);
      if (this.drops && I.bone_meal !== undefined) this.drops.spawn(x + 0.5, y + 1.05, z + 0.5, { id: I.bone_meal, count: 1 });
      return true;
    }
    const p = s ? COMPOST.get(n) : undefined;
    if (p === undefined || lv >= 7) return false;
    if (!h.creative) { s.count--; if (s.count <= 0) h.inv.slots[h.inv.selected] = null; h.inv.changed(); }
    if ((lv === 0 && p > 0) || Math.random() < p) {
      w.set(x, y, z, B.composter, lv + 1);
      if (lv + 1 === 7) this.ripen.push({ x, y, z, at: this.ticks + 20 });
    }
    if (this.R && this.R.particles && this.R.particles.burst) try { this.R.particles.burst('composter', x + 0.5, y + 0.9, z + 0.5); } catch (e) {}
    return true;
  }
  campfire(h, hit, d, s, n) {
    const w = this.world, { x, y, z } = hit, m = w.meta(x, y, z), lit = !(m & 4);
    if (!s) return false;
    const it = ITEMS[s.id], tool = it && it.tool;
    // a shovel puts it out; flint and steel or a fire charge lights it
    if (tool && tool.kind === 'shovel' && lit) { w.set(x, y, z, BLOCKS[w.get(x, y, z)].id, m | 4); if (!h.creative) h.inv.damageSelected(1); return true; }
    if (!lit && (n === 'flint_and_steel' || n === 'fire_charge')) {
      w.set(x, y, z, BLOCKS[w.get(x, y, z)].id, m & ~4);
      if (!h.creative) { if (n === 'flint_and_steel') h.inv.damageSelected(1); else h.inv.takeSelected(1); }
      return true;
    }
    const r = cookingRecipe(s.id, d.name);
    if (!r) return false;
    const e = this.entry(x, y, z, 'campfire');
    const i = e.items.findIndex(v => !v);
    if (i < 0) return false;
    e.items[i] = withCount(s, 1); e.t[i] = 0; e.total[i] = r.ticks || 600;
    if (!h.creative) { s.count--; if (s.count <= 0) h.inv.slots[h.inv.selected] = null; h.inv.changed(); }
    this.dirty = true;
    this._show(e);
    return true;
  }
  sign(h, hit, d, s, n) {
    const w = this.world, { x, y, z } = hit, m = w.meta(x, y, z);
    const e = this.entry(x, y, z, 'sign');
    const P = h.player.pos, bd = signBoard(d, m, x, y, z);
    const front = (P.x - bd.cx) * bd.nx + (P.z - bd.cz) * bd.nz >= 0;
    const side = front ? e.front : e.back;
    if (e.waxed) return true;
    const dye = /_dye$/.test(n) ? n.slice(0, -4) : null;
    if (dye && DYE_TEXT[dye] !== undefined) {
      if (side.colour === dye || !side.lines.some(Boolean)) return true;
      side.colour = dye; this.changed(e);
      if (!h.creative) h.inv.takeSelected(1);
      return true;
    }
    if (n === 'glow_ink_sac' || n === 'ink_sac') {
      const glow = n === 'glow_ink_sac';
      if (side.glow === glow || !side.lines.some(Boolean)) return true;
      side.glow = glow; this.changed(e);
      if (!h.creative) h.inv.takeSelected(1);
      return true;
    }
    if (n === 'honeycomb') { e.waxed = true; this.changed(e); if (!h.creative) h.inv.takeSelected(1); return true; }
    if (this.onEdit) this.onEdit(x, y, z, front);
    return true;
  }
  // a sign was just placed: write on its front
  placed(x, y, z) {
    const d = BLOCKS[this.world.get(x, y, z)];
    if (!isSign(d)) return;
    this.entry(x, y, z, 'sign');
    if (this.onEdit) this.onEdit(x, y, z, true);
  }
  // the editing screen finished: the four lines of one side
  setText(x, y, z, front, lines) {
    const d = BLOCKS[this.world.get(x, y, z)];
    if (!isSign(d)) return;
    const e = this.entry(x, y, z, 'sign');
    (front ? e.front : e.back).lines = lines.slice(0, 4).map(v => String(v || '').slice(0, 384));
    this.changed(e);
  }
  textOf(x, y, z, front) { const e = this.map.get(key(x, y, z)); return e && e.k === 'sign' ? (front ? e.front : e.back) : null; }

  entry(x, y, z, k) {
    const id = key(x, y, z);
    let e = this.map.get(id);
    if (!e || e.k !== k) {
      if (e) this._unshow(e);
      e = k === 'sign' ? { k, x, y, z, front: { lines: ['', '', '', ''], colour: 'black', glow: false }, back: { lines: ['', '', '', ''], colour: 'black', glow: false }, waxed: false }
        : k === 'frame' ? { k, x, y, z, item: null, rot: 0 }
        : k === 'jukebox' ? { k, x, y, z, disc: null, t: 0 }
        : k === 'vault' ? { k, x, y, z, rewarded: false, queue: [], at: 0 }
        : k === 'decorated_pot' ? { k, x, y, z, item: null }
        : k === 'shelf' ? { k, x, y, z, items: [null, null, null, null, null, null], last: -1 }
        : k === 'lectern' ? { k, x, y, z, book: null, page: 0 }
        : { k, x, y, z, items: [null, null, null, null], t: [0, 0, 0, 0], total: [600, 600, 600, 600] };
      this.map.set(id, e);
    }
    return e;
  }
  changed(e) { this.dirty = true; this._show(e); }

  /* ---- a block went: what a campfire held spills, a sign's words go with it ---- */
  broken(x, y, z) {
    const id = key(x, y, z), e = this.map.get(id);
    if (!e) return;
    this.map.delete(id);
    this._unshow(e);
    this.dirty = true;
    if (e.k === 'campfire' && this.drops) for (const s of e.items) if (s) this.drops.spawn(x + 0.5, y + 0.5, z + 0.5, s);
    if (e.k === 'jukebox' && e.disc && this.drops) this.drops.spawn(x + 0.5, y + 0.5, z + 0.5, e.disc);
    if (e.k === 'decorated_pot' && e.item && this.drops) this.drops.spawn(x + 0.5, y + 0.5, z + 0.5, e.item);
    if (e.k === 'shelf' && this.drops) for (const s of e.items) if (s) this.drops.spawn(x + 0.5, y + 0.5, z + 0.5, s);
    if (e.k === 'lectern' && e.book && this.drops) this.drops.spawn(x + 0.5, y + 1, z + 0.5, e.book);
    // a frame comes down as its item, with what it held (nothing in creative)
    if (e.k === 'frame' && this.drops && !(this.creative && this.creative())) {
      if (e.item) this.drops.spawn(x + 0.5, y + 0.4, z + 0.5, e.item);
      const fi = I[e.glow ? 'glow_item_frame' : 'item_frame'];
      if (fi !== undefined) this.drops.spawn(x + 0.5, y + 0.4, z + 0.5, { id: fi, count: 1 });
    }
  }

  /* The look of the vaults near the player (every half second): lit up while one that has not rewarded you is
     within 4 blocks, unlocking for the moment after a key goes in, then throwing out the reward. */
  vaultLooks() {
    const w = this.world, E = this.entities && this.entities(), P = E && E.player;
    if (!P || B.vault === undefined) return;
    const px = Math.floor(P.pos.x), py = Math.floor(P.pos.y), pz = Math.floor(P.pos.z), ey = P.pos.y + 1.62;
    for (let y = py - 4; y <= py + 6; y++) for (let z = pz - 5; z <= pz + 5; z++) for (let x = px - 5; x <= px + 5; x++) {
      if (w.get(x, y, z) !== B.vault) continue;
      const e = this.map.get(key(x, y, z)), m = w.meta(x, y, z);
      const near = (P.pos.x - x - 0.5) ** 2 + (ey - y - 0.5) ** 2 + (P.pos.z - z - 0.5) ** 2 <= 16;
      const unlocking = e && e.k === 'vault' && this.ticks < (e.unlockUntil || 0), giving = e && e.k === 'vault' && e.queue.length > 0;
      const st = unlocking ? 2 : giving ? 3 : near && !(e && e.k === 'vault' && e.rewarded) ? 1 : 0;
      if (((m >> 4) & 3) !== st) w.set(x, y, z, B.vault, (m & ~48) | (st << 4));
    }
  }

  /* ---- 20 times a second ---- */
  tick() {
    this.ticks++;
    const w = this.world;
    if (this.ticks % 10 === 0) this.vaultLooks();
    // composters at 7 turn ready after a second
    if (this.ripen.length) {
      this.ripen = this.ripen.filter(r => {
        if (this.ticks < r.at) return true;
        if (w.get(r.x, r.y, r.z) === B.composter && (w.meta(r.x, r.y, r.z) & 15) === 7) w.set(r.x, r.y, r.z, B.composter, 8);
        return false;
      });
    }
    for (const e of this.map.values()) {
      // now and then: a block that has gone (an explosion, a piston, its support) lets go of what it held
      if ((this.ticks + e.x + e.z) % 20 === 0) {
        const d = BLOCKS[w.get(e.x, e.y, e.z)];
        if (!d || (e.k === 'sign' ? !isSign(d) : e.k === 'frame' ? !d.frame : e.k === 'jukebox' ? d.name !== 'jukebox' : e.k === 'vault' ? d.name !== 'vault'
          : e.k === 'decorated_pot' ? d.name !== 'decorated_pot' : e.k === 'shelf' ? d.name !== 'chiseled_bookshelf'
            : e.k === 'lectern' ? d.name !== 'lectern' : d.shape !== 'campfire')) { if (w.loaded(e.x, e.z)) this.broken(e.x, e.y, e.z); continue; }
        // loaded from the save before its chunk was there: drawn now
        if (!e.meshes && !NOT_DRAWN.has(e.k)) this._show(e);
      }
      if (e.k === 'shelf' || e.k === 'lectern' || e.k === 'decorated_pot') continue;
      if (e.k === 'vault') {
        // unlocking, then a stack thrown up out of the top each second
        if (e.queue.length && this.ticks >= e.at) {
          const st = e.queue.shift();
          if (this.drops) this.drops.spawn(e.x + 0.5, e.y + 1.2, e.z + 0.5, st, { vel: [(Math.random() - 0.5) * 0.1, 0.25, (Math.random() - 0.5) * 0.1] });
          const P = this.R && this.R.particles;
          if (P && P.spawn) for (let i = 0; i < 6; i++) P.spawn(e.x + 0.5 + (Math.random() - 0.5) * 0.6, e.y + 1.1, e.z + 0.5 + (Math.random() - 0.5) * 0.6, 0, 0.04, 0, { colour: 0xffd070, size: 0.1, life: 10, gravity: 0, physics: false });
          e.at = this.ticks + 20;
          this.dirty = true;
        }
        continue;
      }
      if (e.k === 'jukebox') {
        // playing: a note rises from the top each second, until the song is over (the disc stays in)
        const song = e.disc && SONGS[itemName(e.disc.id)];
        if (!song || e.t >= song[1] * 20) continue;
        if (++e.t % 20 === 0) {
          const P = this.R && this.R.particles, f = Math.random();
          const c = v => Math.max(0, Math.min(255, Math.round((Math.max(0, Math.sin((f + v) * Math.PI * 2) * 0.65 + 0.35)) * 255)));
          if (P && P.spawn) P.spawn(e.x + 0.5, e.y + 1.2, e.z + 0.5, 0, 0.06, 0, { colour: (c(0) << 16) | (c(1 / 3) << 8) | c(2 / 3), size: 0.18, life: 6, gravity: 0, physics: false });
        }
        continue;
      }
      if (e.k !== 'campfire') continue;
      const lit = !(w.meta(e.x, e.y, e.z) & 4);
      for (let i = 0; i < 4; i++) {
        const s = e.items[i];
        if (!s) continue;
        // an unlit campfire lets its food cool back down, two ticks at a time
        if (!lit) { if (e.t[i] > 0) e.t[i] = Math.max(0, e.t[i] - 2); continue; }
        if (++e.t[i] < e.total[i]) continue;
        const r = cookingRecipe(s.id, BLOCKS[w.get(e.x, e.y, e.z)].name);
        e.items[i] = null; e.t[i] = 0;
        if (r && this.drops) this.drops.spawn(e.x + 0.5, e.y + 1, e.z + 0.5, { id: r.id, count: r.count || 1 }, { vel: [0, 0.1, 0] });
        this.dirty = true;
        this._show(e);
      }
    }
  }
  // every frame: sign text follows the light (looked at a few times a second, not every frame)
  update() {
    if (!this.map.size || (this.frames = (this.frames || 0) + 1) % 12) return;
    const day = this.daylight ? this.daylight() : 1;
    for (const e of this.map.values()) {
      if (!e.meshes) continue;
      // a frame's item takes the light again when it changes (a torch put down or broken nearby)
      if (e.k === 'frame' && !e.glow) {
        const lv = this._lightPacked(e);
        if (lv !== e.lv) {
          e.lv = lv;
          for (const mesh of e.meshes) { const L = mesh.geometry.attributes.aL; for (let k = 0; k < L.count; k++) { L.array[k * 4] = lv >> 8; L.array[k * 4 + 1] = lv & 255; } L.needsUpdate = true; }
        }
        continue;
      }
      for (const mesh of e.meshes) {
        if (!mesh.userData.text) continue;
        const v = mesh.userData.glow ? 1 : this._bright(e, day);
        mesh.material.color.setRGB(v, v, v);
      }
    }
  }
  _bright(e, day) {
    // the sign's own light (js/lightlevel.js: sky light by the time of day, or the block light there), as the game lights
    // its text; it used to count only the blocks straight over the sign and borrow the player's torch light
    const w = this.world, v = lightNear(w, e.x, e.y, e.z, !!w.noSky);
    const l = Math.max((v >> 4) * day, v & 15) / 15;
    return 0.12 + 0.88 * l * l;
  }

  /* ---- drawing ---- */
  _unshow(e) {
    if (!e.meshes) return;
    for (const m of e.meshes) {
      if (m.userData.text) { this.group.remove(m); m.geometry.dispose(); m.material.map.dispose(); m.material.dispose(); }
      else if (this.drops) { this.drops.group.remove(m); m.geometry.dispose(); }
    }
    e.meshes = null;
  }
  _show(e) {
    this._unshow(e);
    // not drawn until its chunk is in (tick tries again)
    const d = BLOCKS[this.world.get(e.x, e.y, e.z)];
    if (!d || !this.world.loaded(e.x, e.z)) return;
    e.meshes = [];
    if (e.k === 'campfire') this._showFood(e);
    else if (e.k === 'frame') this._showFrame(e);
    else if (NOT_DRAWN.has(e.k)) return;
    else this._showText(e);
  }
  // the food lies flat on the logs, one item to each side, as the game's campfire renderer lays it
  _showFood(e) {
    const D = this.drops;
    if (!D) return;
    const facing = this.world.meta(e.x, e.y, e.z) & 3;
    const M = new THREE.Matrix4(), T = new THREE.Matrix4();
    for (let i = 0; i < 4; i++) {
      const s = e.items[i];
      if (!s) continue;
      const g = D._base(s.id);
      if (!g) continue;
      const mesh = D._makeMesh(g.geometry, g.cutout);
      const dir = (i + facing) & 3;
      M.makeTranslation(e.x + 0.5, e.y + 0.44921875, e.z + 0.5);
      M.multiply(T.makeRotationY(-dir * Math.PI / 2)).multiply(T.makeRotationX(Math.PI / 2));
      // (item geometry sits a block up, the way drops.js lifts it back)
      M.multiply(T.makeTranslation(-0.3125, -0.3125, 0)).multiply(T.makeScale(0.375, 0.375, 0.375)).multiply(T.makeTranslation(0, -1, 0));
      mesh.matrix.copy(M); mesh.matrixWorld.copy(M);
      // lit by the fire beneath it
      const L = mesh.geometry.attributes.aL;
      for (let k = 0; k < L.count; k++) { L.array[k * 4] = 15 * 17; L.array[k * 4 + 1] = 15 * 17; }
      L.needsUpdate = true;
      e.meshes.push(mesh);
    }
  }
  /* A frame: its picture (the item's own, 14 pixels of 16, drawn to the game's 12) flat against the face, and
     what it holds in front, half size (a block a quarter), turned an eighth a step about the frame's middle. */
  _showFrame(e) {
    const D = this.drops, w = this.world, d = BLOCKS[w.get(e.x, e.y, e.z)];
    if (!D || !d || !d.frame) return;
    e.glow = !!d.glow;
    const face = w.meta(e.x, e.y, e.z) & 7;
    // out of the face: the opposite of the face's own direction
    const N = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][face];
    const n = new THREE.Vector3(N[0], N[1], N[2]), up = Math.abs(N[1]) ? new THREE.Vector3(0, 0, -N[1]) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, n);
    const basis = new THREE.Matrix4().makeBasis(right, up, n);
    const c = new THREE.Vector3(e.x + 0.5, e.y + 0.5, e.z + 0.5);
    const light = e.glow ? (15 * 17 << 8) | (15 * 17) : (e.lv = this._lightPacked(e));
    const put = (id, depth, scale, spin) => {
      const g = D._base(id);
      if (!g) return;
      const mesh = D._makeMesh(g.geometry, g.cutout);
      const M = new THREE.Matrix4().makeTranslation(c.x + n.x * depth, c.y + n.y * depth, c.z + n.z * depth);
      M.multiply(basis);
      if (spin) M.multiply(new THREE.Matrix4().makeRotationZ(-spin * Math.PI / 4));
      M.multiply(new THREE.Matrix4().makeScale(scale, scale, scale)).multiply(new THREE.Matrix4().makeTranslation(0, -1, 0));
      mesh.matrix.copy(M); mesh.matrixWorld.copy(M);
      const L = mesh.geometry.attributes.aL;
      for (let k = 0; k < L.count; k++) { L.array[k * 4] = light >> 8; L.array[k * 4 + 1] = light & 255; }
      L.needsUpdate = true;
      e.meshes.push(mesh);
      return g;
    };
    const fid = I[e.glow ? 'glow_item_frame' : 'item_frame'];
    if (fid !== undefined) put(fid, -0.5 + 0.5 / 16, 12 / 14, 0);
    if (e.item) {
      const g = D._base(e.item.id);
      if (g) put(e.item.id, g.flat ? -0.5 + 1.5 / 16 : -0.5 + 1 / 16 + 0.125, g.flat ? 0.5 : 0.25, e.rot);
      // an enchanted one shimmers in its frame too, as the game draws it (render/glint.js)
      const m = e.meshes[e.meshes.length - 1];
      if (g && m && D.R && glints(e.item)) { setGlint(m, true, D.R); m.matrixWorldNeedsUpdate = true; }
    }
  }
  // the frame's own light, sky and block (js/lightlevel.js); it counted only the blocks straight over it, so a frame
  // under an overhang or by a torch in a cave showed its item black
  _lightPacked(e) {
    const w = this.world, v = lightNear(w, e.x, e.y, e.z, !!w.noSky);
    return ((v >> 4) * 17 << 8) | ((v & 15) * 17);
  }
  _showText(e) {
    const font = this.gui && this.gui.font;
    if (!font) return;
    const w = this.world, d = BLOCKS[w.get(e.x, e.y, e.z)];
    if (!isSign(d)) return;
    const bd = signBoard(d, w.meta(e.x, e.y, e.z), e.x, e.y, e.z);
    for (const front of [true, false]) {
      const side = front ? e.front : e.back;
      if (!side.lines.some(Boolean)) continue;
      // 9 of the font's pixels to a pixel of the board (the game's text scale), 10 to a line
      const PX = 9, cw = Math.round(16 * bd.w * PX), ch = Math.round(16 * bd.h * PX);
      const S = 2, cv = document.createElement('canvas');
      cv.width = cw * S; cv.height = ch * S;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.scale(S, S);
      const col = DYE_TEXT[side.colour] !== undefined ? DYE_TEXT[side.colour] : 0;
      const fill = side.glow ? col : dark(col), outline = side.glow ? (col === 0 ? 0xF0EBCC : dark(col)) : -1;
      const lh = 10, top = Math.round(ch / 2 - 2 * lh) + 1;
      side.lines.forEach((t, i) => {
        if (!t) return;
        const tw = font.width(t), tx = Math.round((cw - tw) / 2), ty = top + i * lh;
        if (outline >= 0) for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) font.draw(g, t, tx + ox, ty + oy, outline, false);
        font.draw(g, t, tx, ty, fill, false);
      });
      const tex = new THREE.CanvasTexture(cv);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      if ('colorSpace' in tex) tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(bd.w, bd.h), mat);
      // the plane faces +z; turn it to look out of this side of the board
      const sgn = front ? 1 : -1, nx = bd.nx * sgn, nz = bd.nz * sgn;
      mesh.position.set(bd.cx + nx * (bd.out + 0.003), bd.cy, bd.cz + nz * (bd.out + 0.003));
      mesh.rotation.y = Math.atan2(nx, nz);
      mesh.userData.text = true; mesh.userData.glow = side.glow;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      e.meshes.push(mesh);
    }
  }

  /* ---- saving ---- */
  toJSON() {
    const out = [];
    for (const e of this.map.values()) {
      if (e.k === 'sign') out.push({ k: 's', p: [e.x, e.y, e.z], f: e.front, b: e.back, w: e.waxed ? 1 : 0 });
      else if (e.k === 'frame') out.push({ k: 'f', p: [e.x, e.y, e.z], i: e.item ? stackToJSON(e.item) : null, r: e.rot });
      else if (e.k === 'jukebox') { if (e.disc) out.push({ k: 'j', p: [e.x, e.y, e.z], i: stackToJSON(e.disc), t: e.t }); }
      else if (e.k === 'vault') out.push({ k: 'v', p: [e.x, e.y, e.z], r: e.rewarded ? 1 : 0, q: e.queue.map(stackToJSON) });
      else if (e.k === 'decorated_pot') { if (e.item) out.push({ k: 'p', p: [e.x, e.y, e.z], i: stackToJSON(e.item) }); }
      else if (e.k === 'shelf') out.push({ k: 'cb', p: [e.x, e.y, e.z], i: e.items.map(s => (s ? stackToJSON(s) : null)), l: e.last });
      else if (e.k === 'lectern') { if (e.book) out.push({ k: 'le', p: [e.x, e.y, e.z], i: stackToJSON(e.book), g: e.page }); }
      else if (e.items.some(Boolean)) out.push({ k: 'c', p: [e.x, e.y, e.z], i: e.items.map(s => (s ? stackToJSON(s) : null)), t: e.t, n: e.total });
    }
    for (const x of EXTRA.values()) for (const o of x.save(this) || []) out.push(o);
    return out;
  }
  // one entry another module keeps (a beacon's powers), come from a server (net/net.js): true if it was one
  loadExtra(o) { const x = o && EXTRA.get(o.k); if (x) x.load(this, o); return !!x; }
  fromJSON(list) {
    for (const e of this.map.values()) this._unshow(e);
    this.map.clear();
    for (const x of EXTRA.values()) if (x.reset) x.reset(this);
    if (!Array.isArray(list)) return;
    for (const o of list) {
      const [x, y, z] = o.p || [0, 0, 0];
      if (o.k === 's') {
        const e = this.entry(x, y, z, 'sign');
        const side = v => ({ lines: (v && Array.isArray(v.lines) ? v.lines : []).concat(['', '', '', '']).slice(0, 4).map(String), colour: (v && v.colour) || 'black', glow: !!(v && v.glow) });
        e.front = side(o.f); e.back = side(o.b); e.waxed = !!o.w;
      } else if (o.k === 'f') {
        const e = this.entry(x, y, z, 'frame');
        e.item = o.i ? stackFromJSON(o.i) : null; e.rot = (o.r | 0) & 7;
      } else if (o.k === 'v') {
        const e = this.entry(x, y, z, 'vault');
        e.rewarded = !!o.r; e.queue = (o.q || []).map(stackFromJSON).filter(Boolean);
      } else if (o.k === 'cb') {
        const e = this.entry(x, y, z, 'shelf');
        e.items = [0, 1, 2, 3, 4, 5].map(i => (o.i && o.i[i] ? stackFromJSON(o.i[i]) : null)); e.last = o.l === undefined ? -1 : o.l | 0;
      } else if (o.k === 'le') {
        const e = this.entry(x, y, z, 'lectern');
        e.book = o.i ? stackFromJSON(o.i) : null; e.page = o.g | 0;
      } else if (o.k === 'p') {
        const e = this.entry(x, y, z, 'decorated_pot');
        e.item = o.i ? stackFromJSON(o.i) : null;
      } else if (o.k === 'j') {
        const e = this.entry(x, y, z, 'jukebox');
        e.disc = o.i ? stackFromJSON(o.i) : null; e.t = o.t | 0;
      } else if (EXTRA.has(o.k)) {
        EXTRA.get(o.k).load(this, o);
      } else if (o.k === 'c') {
        const e = this.entry(x, y, z, 'campfire');
        e.items = (o.i || []).concat([null, null, null, null]).slice(0, 4).map(a => (a ? stackFromJSON(a) : null));
        e.t = (o.t || [0, 0, 0, 0]).slice(0, 4); e.total = (o.n || [600, 600, 600, 600]).slice(0, 4);
      }
    }
  }
  // draw what was loaded, once the font is there (main.js calls this after attaching)
  showAll() { for (const e of this.map.values()) this._show(e); }
}
