/* ---------------------------------------------------------------------------
   Leoncraft 2 - advancements, joined to the game.

   main.js calls:
     advInit(deps)          at boot: the toast, the screen, /advancement
     advWorld(game, saved)  a world started: your record from its save
     advParts(game)         after each game.attach (a world, or a dimension)
     advTick(game)          once a game tick, after everything else moved
     advState(game)         what goes into the save
     advLeave()             leaving the world
     openAdvancements()     L (or the game menu's button)

   Everything that happens reaches the tracker as one of the game's triggers
   (the Minecraft Wiki's "Advancement/JSON format" lists them) with a plain
   description of the event (adv/match.js): mostly through hooks the game
   already offers or by wrapping one method of an object at hand, so other
   files only gained a line or two. What the game only looks at now and then
   (where you are, every second; what you carry, when it changes) is looked
   at here in advTick.
--------------------------------------------------------------------------- */
import { Progress, ADV, TABS } from './tracker.js?v=107';
import { AdvToast } from './toast.js?v=107';
import { AdvancementsScreen } from './screen.js?v=107';
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { itemName, itemId, armorOf } from '../items.js?v=107';
import { BIOMES } from '../biomes.js?v=107';
import { Y0 } from '../world-const.js?v=107';
import { register, gameRule } from '../commands.js?v=107';
import { Living } from '../entities/entity.js?v=107';
import { TYPES } from '../entities/mobs.js?v=107';
import { AbstractHorse } from '../entities/mobs4.js?v=107';
import { Allay } from '../entities/mobs6.js?v=107';
import { Piglin } from '../entities/nether.js?v=107';
import { WindCharge } from '../entities/mobs7.js?v=107';
import { summonAt } from '../entities/summon.js?v=107';
import { hives } from '../entities/hives.js?v=107';
import { Merchant, WanderingTrader, CurableZombieVillager } from '../entities/merchant.js?v=107';
import { FishingBobber } from '../entities/items2.js?v=107';
import { EnderDragon } from '../dim/dragon.js?v=107';
import { EndFight } from '../dim/endfight.js?v=107';
import { ContainerScreen } from '../ui/inventory.js?v=107';
import { BrewingScreen } from '../ui/containers.js?v=107';
import { EnchantScreen, SmithingScreen } from '../ui/workstations.js?v=107';

let G = null;          // the game being played
let P = null;          // its player's advancements
let D = null;          // what boot handed over: { gui, chat, icons, options, name() }
let S = null;          // what the ticks keep track of

const MADE_TEXT = { task: 'has made the advancement', goal: 'has reached the goal', challenge: 'has completed the challenge' };
export const TYPE_COLOUR = { task: 0x55FF55, goal: 0x55FF55, challenge: 0xAA00AA };
const CODE = { task: '§a', goal: '§a', challenge: '§5' };

/* ======================================================= at boot ===== */
export function advInit(deps) {
  D = deps;
  if (deps.gui) deps.gui.overlays.push(AdvToast.overlay(deps.gui, deps.icons));
  // a line about someone's advancement (yours or another player's, from the server) carries the name's hover
  const chat = deps.chat;
  if (chat && chat.add && !chat.__adv) {
    chat.__adv = true;
    const add = chat.add.bind(chat);
    chat.add = (text, colour, extra) => {
      const h = extra ? null : hoverLine(text);
      return add(h ? h.text : text, colour, extra || (h ? { hover: h.hover } : undefined));
    };
  }
  // for tests and the curious: the record, the list, a trigger by hand, one tick's checks (for timing)
  window.__lc2adv = { get progress() { return P; }, ADV, TABS, fire, env: () => makeEnv(), toast: AdvToast, open: () => openAdvancements(), tick: () => G && advTick(G) };
}
export function openAdvancements() {
  if (!G || !P || !D || !D.gui) return false;
  D.gui.open(new AdvancementsScreen(P, D.icons));
  return true;
}

/* ======================================================= a world ===== */
export function advWorld(g, saved) {
  G = g;
  P = new Progress();
  try { P.fromJSON(saved); } catch (e) { console.warn('advancements', e); }
  g.advancements = P;
  S = { sig: '', dim: g.dim, t: 0, biome: null, biomeAt: null, asking: false, fx: '', ground: true, fall: null, launch: null,
    lev: null, lava: null, riding: null, tamed: new WeakMap(), beacons: new Set(), sneak: 0, sneakAt: null, gate: false, slide: 0 };
  P.onMade(made);
  wrapGame(g);
  wrapWorldwide();
  advParts(g);
}
// what the page shares between worlds: the structures (a suspicious block brushed), a crafter's craft
function wrapWorldwide() {
  const L = window.__lc2;
  if (!L || L.__adv) return;
  L.__adv = true;
  const St = L.structures;
  if (St && St.findAt) {
    const findAt = St.findAt.bind(St);
    St.findAt = (x, y, z) => {
      const e = St.chestAt ? St.chestAt(x, y, z) : null;
      if (e && e.table) fire('player_generates_container_loot', { table: e.table });
      return findAt(x, y, z);
    };
  }
  // a raid beaten by those who fought in it: hero_of_the_village (entities/raids.js)
  const R = St && St.spawners && St.spawners.raids;
  if (R && R.victory) {
    const victory = R.victory.bind(R);
    R.victory = (...a) => { const heroes = !!(R.raid && R.raid.heroes); const r = victory(...a); if (heroes) fire('hero_of_the_village', {}); return r; };
  }
  // a crafter's craft is heard by everyone within 17 blocks (Crafters Crafting Crafters)
  const obs = L.onBlockSound;
  L.onBlockSound = (kind, x, y, z, made) => {
    if (obs) obs(kind, x, y, z, made);
    if (kind === 'craft' && made && G && G.player) {
      const p = G.player.pos;
      if (Math.abs(p.x - x - 0.5) <= 17.5 && Math.abs(p.y - y - 0.5) <= 17.5 && Math.abs(p.z - z - 0.5) <= 17.5) fire('crafter_recipe_crafted', { recipe: itemName(made.id), ingredients: [] });
    }
  };
}
export function advState() { return P ? P.toJSON() : undefined; }
export function advLeave() { G = null; P = null; S = null; AdvToast.clear(); }

// one made: the toast, the line in chat, the reward
function made(a, how) {
  if (!G) return;
  if (!a.noToast) AdvToast.add(a);
  if (!a.noChat && gameRule(G, 'announceAdvancements') !== false && D && D.chat) {
    const who = D.name ? D.name() : 'Player', line = `${who} ${MADE_TEXT[a.frame] || MADE_TEXT.task} ${CODE[a.frame] || '§a'}[${a.title}]`;
    /* on a server everyone reads it, as the game's server tells them all: it goes out by the server's
       line for news about one player (the one death messages take, which reaches everyone, you too, and
       must start with your name), and comes back into your chat with the others' */
    if (G.net && G.net.send && G.net.ws && G.net.ws.readyState === 1) G.net.send({ t: 'death', text: line });
    else D.chat.add(line, 0xFFFFFF, { hover: hoverOf(a) });
  }
  if (a.xp && G.survival) G.survival.addXp(a.xp);
  void how;
}
// the chat line's hover: the name in its colour, then what it asks
export function hoverOf(a) { return { text: '[' + a.title + ']', lines: [(CODE[a.frame] || '§a') + a.title, ...a.desc.split('\n').map(l => '§f' + l)], colour: TYPE_COLOUR[a.frame] }; }
const LINE = /^\S+ (has made the advancement|has reached the goal|has completed the challenge) §[a5]\[(.+)\]$/;
const FRAME_OF = { 'has made the advancement': 'task', 'has reached the goal': 'goal', 'has completed the challenge': 'challenge' };
/* (a server's word filter can star out part of a name: Sky's the Limit comes back as S**** the Limit;
   the name is put back when it is one of the game's own, letter for letter apart from the stars, and
   only the name: whoever made it is left as the server sent it) */
function hoverLine(text) {
  if (typeof text !== 'string' || text.indexOf(' has ') < 0) return undefined;
  const m = LINE.exec(text);
  if (!m) return undefined;
  const frame = FRAME_OF[m[1]], title = m[2];
  const starred = title.indexOf('*') >= 0 ? new RegExp('^' + title.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.') + '$') : null;
  for (const a of ADV.values()) {
    if (a.frame !== frame || !(a.title === title || (starred && starred.test(a.title)))) continue;
    return { text: starred ? text.slice(0, text.length - title.length - 1) + a.title + ']' : text, hover: hoverOf(a) };
  }
  return undefined;
}

/* ======================================================= events ===== */
// something happened: the criteria of that trigger are tried (nothing is built while none is wanted)
export function fire(type, ev, over) {
  if (!P || !G || !P.wants(type)) return 0;
  const e = makeEnv(over);
  return P.trigger(type, typeof ev === 'function' ? ev() : ev, e);
}

/* ---- what the conditions look at ---- */
function makeEnv(over) {
  const g = G, p = g.player;
  const e = {
    dim: g.dim,
    origin: { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z },
    block: (x, y, z) => blockView(x, y, z),
    biome: at => biomeName(at),
    inStructure: (kind, at) => inStructure(kind, at),
    smokey: at => smokey(at),
  };
  e.player = playerView();
  return over ? Object.assign(e, over) : e;
}
export function stackView(s) {
  if (!s) return null;
  const n = itemName(s.id);
  return { name: n, count: s.count || 1, damage: s.dmg | 0, ench: s.ench || null, jukebox: /^music_disc_/.test(n), ominous: !!(s.ominous || (n === 'white_banner' && s.patterns && s.patterns.length >= 8)) };
}
// the four armour slots by where each piece goes (head, chest, legs, feet)
const SLOTS = ['head', 'chest', 'legs', 'feet'];
function armourIndex(name) {
  const a = itemId(name) ? armorOf(itemId(name)) : null;
  return a && a.slot !== undefined ? a.slot : -1;
}
let ARMOUR_AT = null;
function equipOf(inv) {
  if (!ARMOUR_AT) {
    ARMOUR_AT = {};
    const probe = { head: 'iron_helmet', chest: 'iron_chestplate', legs: 'iron_leggings', feet: 'iron_boots' };
    for (const k of SLOTS) { const i = armourIndex(probe[k]); ARMOUR_AT[k] = i >= 0 ? i : SLOTS.indexOf(k); }
  }
  const out = {};
  for (const k of SLOTS) out[k] = stackView(inv.armor ? inv.armor[ARMOUR_AT[k]] : null);
  out.mainhand = stackView(inv.slots[inv.selected]);
  out.offhand = stackView(inv.offhand);
  return out;
}
function playerView(depth = 0) {
  const g = G, p = g.player, E = g.entities;
  const v = { type: 'player', isPlayer: true, x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z, dim: g.dim, sneaking: !!p.sneaking, sprinting: !!p.sprinting,
    swimming: !!p.swimming, flying: !!p.flying, onFire: !!(g.survival && g.survival.fire > 0), equipment: equipOf(g.inv) };
  const r = E && E.riding;
  // (seen from what you ride, you are among its passengers: the depth keeps the two from asking each other forever)
  if (r && depth < 2) v.vehicle = entityView(r, depth + 1);
  // the block under the feet (stepping_on)
  const fx = Math.floor(p.pos.x), fy = Math.floor(p.pos.y - 0.2), fz = Math.floor(p.pos.z);
  v.stepping = { x: fx + 0.5, y: fy + Y0, z: fz + 0.5 };
  return v;
}
export function entityView(e, depth = 0) {
  if (!e) return null;
  if (e.isPlayer) return G ? playerView(depth) : null;
  // (a boat is one kind here; the game names it by its wood, and a raft and a chest boat their own)
  const type = e.type === 'boat' ? (e.raft ? (e.chest ? 'bamboo_chest_raft' : 'bamboo_raft') : (e.wood || 'oak') + (e.chest ? '_chest_boat' : '_boat')) : e.type;
  const v = { type, x: e.pos.x, y: e.pos.y + Y0, z: e.pos.z, dim: G ? G.dim : 'overworld',
    baby: !!(e.baby || e.isBaby || (e.ageT !== undefined && e.ageT < 0)), onFire: e.fire > 0, sneaking: !!e.sneaking };
  const eq = {};
  const st = s => (s && typeof s === 'object' ? stackView(s) : typeof s === 'string' ? { name: s, count: 1 } : null);
  if (e.equip) for (const k in e.equip) eq[k] = st(e.equip[k]);
  if (e.body) eq.body = st(e.body);
  if (e.captain) eq.head = { name: 'white_banner', count: 1, ominous: true };
  v.equipment = eq;
  v.variant = {};
  if (e.type === 'cat') v.variant['cat/variant'] = e.coat;
  if (e.type === 'wolf') v.variant['wolf/variant'] = e.variant;
  if (e.type === 'frog') v.variant['frog/variant'] = e.kind;
  if (depth < 2) {
    if (e.vehicle) v.vehicle = entityView(e.vehicle, depth + 1);
    if (e.passengers) v.passengers = e.passengers.filter(Boolean).map(o => entityView(o, depth + 1));
  }
  return v;
}
function blockView(x, y, z) {
  const w = G.world, iy = y - Y0;
  const b = w.get(x, iy, z), d = BLOCKS[b];
  if (!d) return { name: 'air', meta: 0, x, y, z };
  const v = { name: d.name, meta: w.meta(x, iy, z), x, y, z };
  if (d.name === 'creaking_heart') v.heartState = heartState(x, iy, z, v.meta);
  return v;
}
// a creaking heart between two pale oak logs on its own axis is awake by night, dormant by day; otherwise uprooted
const PALE_LOGS = new Set(['pale_oak_log', 'pale_oak_wood', 'stripped_pale_oak_log', 'stripped_pale_oak_wood']);
function heartState(x, y, z, m) {
  const w = G.world, axis = m % 3, d = axis === 0 ? [0, 1, 0] : axis === 1 ? [1, 0, 0] : [0, 0, 1];
  const ok = s => { const b = BLOCKS[w.get(x + d[0] * s, y + d[1] * s, z + d[2] * s)]; return b && PALE_LOGS.has(b.name) && w.meta(x + d[0] * s, y + d[1] * s, z + d[2] * s) % 3 === axis; };
  if (!ok(1) || !ok(-1)) return 'uprooted';
  const t = (((G.time | 0) % 24000) + 24000) % 24000;
  return t >= 13000 && t < 23000 ? 'awake' : 'dormant';
}
/* smoke under a hive, as the game looks for it: down five blocks, a lit campfire (bit 4 is a campfire
   put out); the first block in the way ends the search, and counts only with a lit campfire under it */
function smokey(at) {
  const w = G.world, x = Math.floor(at.x), y = Math.floor(at.y) - Y0, z = Math.floor(at.z);
  const lit = yy => { const d = BLOCKS[w.get(x, yy, z)]; return !!(d && /campfire$/.test(d.name) && !(w.meta(x, yy, z) & 4)); };
  for (let k = 1; k <= 5; k++) {
    if (lit(y - k)) return true;
    const d = BLOCKS[w.get(x, y - k, z)];
    if (d && d.solid) return lit(y - k - 1);
  }
  return false;
}
/* the biome where you are: the game reads it in three dimensions (the caves have their own), so the
   generator is asked once a second; anywhere else, or before it has answered, the column's own */
function biomeName(at) {
  const w = G.world, x = Math.floor(at.x), z = Math.floor(at.z);
  const c = S && S.biomeAt;
  if (c && S.biome && Math.abs(c.x - at.x) < 3 && Math.abs(c.y - at.y) < 3 && Math.abs(c.z - at.z) < 3) return S.biome;
  const b = BIOMES[w.biomeAt(x, z)];
  return b ? b.name : null;
}
// inside a structure: within one of its pieces' boxes (the chunk keeps them; an older chunk without them counts as in)
const KINDS = { stronghold: ['stronghold'], fortress: ['fortress'], bastion_remnant: ['bastion_remnant'], end_city: ['end_city'], trial_chambers: ['trial_chambers'] };
function inStructure(kind, at) {
  const w = G.world, x = Math.floor(at.x), y = Math.floor(at.y), z = Math.floor(at.z);
  const c = w.chunks.get(Math.floor(x / 16) + ',' + Math.floor(z / 16));
  const list = c && c.structs && c.structs.structures;
  if (!list) return false;
  const want = KINDS[kind] || [kind];
  for (const s of list) {
    if (!want.includes(s.type)) continue;
    if (!s.boxes) return true;
    for (const b of s.boxes) if (x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5]) return true;
  }
  return false;
}

/* ======================================================= the hooks ===== */
// once a game: the hands, survival, the clicks
function wrapGame(g) {
  const H = g.hands, sv = g.survival, I = g.inter;
  // eating and drinking: consume_item
  if (H && !H.__adv) {
    H.__adv = true;
    // a bee nest or beehive broken: bee_nest_destroyed, with how many bees were in it (entities/hives.js)
    const broke = H.broke.bind(H);
    H.broke = (hit, cells) => {
      let ev = null;
      const w = G && G.world, b = w ? w.get(hit.x, hit.y, hit.z) : 0;
      if (b && (b === B.bee_nest || b === B.beehive) && !H.creative) {
        const m = w.meta(hit.x, hit.y, hit.z), list = hives().inside.get(hit.x + ',' + hit.y + ',' + hit.z);
        ev = { block: blockView(hit.x, hit.y + Y0, hit.z), item: H.held ? stackView(H.held) : null, num_bees_inside: (list ? list.length : 0) + ((m >> 5) & 3) };
      }
      const r = broke(hit, cells);
      if (ev) fire('bee_nest_destroyed', ev);
      return r;
    };
    const finish = H.finish.bind(H);
    H.finish = id => {
      const s = H.usedStack ? H.usedStack(H.using) : null, view = s ? stackView(s) : { name: itemName(id), count: 1 };
      const r = finish(id);
      fire('consume_item', { item: view });
      return r;
    };
    // a bucket filled from a mob (milk, and the rest through the entities): filled_bucket
    const fillHeld = H.fillHeld.bind(H);
    H.fillHeld = name => { const r = fillHeld(name); if (r) fire('filled_bucket', { item: { name, count: 1 } }); return r; };
    // a block put down from the hand: placed_block
    const placed = H.placed.bind(H);
    H.placed = list => {
      const tool = H.held ? stackView(H.held) : null;
      const r = placed(list);
      try { if (list && list.length) placedBlock(list, tool); } catch (e) { console.warn(e); }
      return r;
    };
    // a water or lava bucket filled from the world
    const useItem = H.useItem.bind(H);
    H.useItem = hit => {
      const before = H.held ? itemName(H.held.id) : '';
      const r = useItem(hit);
      if (r && before === 'bucket' && H.held) { const n = itemName(H.held.id); if (n !== 'bucket') fire('filled_bucket', { item: { name: n, count: 1 } }); }
      return r;
    };
  }
  // the player's death by a mob (entity_killed_player) and the totem (used_totem)
  if (sv && sv.hooks && !sv.hooks.__adv) {
    const h = sv.hooks;
    h.__adv = true;
    hookBefore(h, 'onDeath', (m, src) => {
      const k = sv.attacker && sv.age - sv.attackerAge <= 100 ? sv.attacker : null;
      if (k && !k.isPlayer) fire('entity_killed_player', () => ({ entity: entityView(k), killingBlow: damageOf(src) }));
    });
    hookBefore(h, 'onTotem', () => fire('used_totem', { item: { name: 'totem_of_undying', count: 1 } }));
  }
  // a right click on a block with something in the hand: item_used_on_block (both before and after, as the game
  // checks some uses before the block changes and some after); placing a block is not a use
  if (I && !I.__adv) {
    I.__adv = true;
    const useWith = I.useWith.bind(I);
    I.useWith = () => {
      const h = I.target && I.target.face ? I.target : null;
      if (!h || !P) return useWith();
      const tool = H && H.held ? stackView(H.held) : null;
      const before = blockView(h.x, h.y + Y0, h.z);
      // what was in the cell a block would go into (a dried ghast put into water)
      S.wet = new Map();
      for (const [x, y, z] of [[h.x, h.y, h.z], [h.x + h.face[0], h.y + h.face[1], h.z + h.face[2]]]) S.wet.set(x + ',' + y + ',' + z, FLUID[G.world.get(x, y, z)] === 1);
      S.placedNow = false;
      const sig = useSig(g, H, h);
      const r = useWith();
      // the item had to do something: the block became another, or changed (a door or a lever only swinging aside),
      // or what the block keeps changed (a disc, a sign's glow), or the stack in the hand or the inventory did (used up, filled, linked)
      const after = blockView(h.x, h.y + Y0, h.z);
      const moved = after.name !== before.name || (after.meta !== before.meta && !SWINGS.test(after.name)) || useSig(g, H, h) !== sig;
      /* The game looks at the block as it was when the item turns it into another (honeycomb waxing, an
         axe scraping: it asks before the change) and as it is after anything else (glowstone charging an
         anchor); a block the click destroyed (an anchor going off) was not used with the item at all. */
      const gone = !BLOCKS[G.world.get(h.x, h.y, h.z)] || after.name === 'air' || /fire$/.test(after.name) || FLUID[G.world.get(h.x, h.y, h.z)];
      if (r === true && !S.placedNow && tool && moved && !gone) {
        const ev = { x: h.x, y: h.y + Y0, z: h.z, tool };
        const env = makeEnv();
        if (after.name !== before.name) {
          const live = env.block;
          env.block = (x, y, z) => (x === h.x && y === h.y + Y0 && z === h.z ? before : live(x, y, z));
        }
        P.trigger('item_used_on_block', ev, env);
      }
      S.wet = null;
      return r;
    };
  }
}
/* Our look first, then whatever hook is set there, now or later: a server sets its own death hook
   once you join (net/net.js), which would otherwise take the place of this one. */
function hookBefore(obj, name, before) {
  let inner = obj[name];
  const outer = function (...a) { try { before(...a); } catch (e) { console.warn(e); } return inner ? inner.apply(this, a) : undefined; };
  Object.defineProperty(obj, name, { configurable: true, enumerable: true, get: () => outer, set: v => { if (v !== outer) inner = v; } });
}
const SWINGS = /(_door|_trapdoor|_fence_gate|^lever|_button|_pressure_plate|^note_block|^repeater|^comparator|^daylight_detector)$/;
function useSig(g, H, h) {
  const det = g.details && g.details.map ? g.details.map.get(h.x + ',' + h.y + ',' + h.z) : null;
  // (its plain fields only: what it holds and how it is written, not the meshes that draw it)
  let d = '';
  if (det) for (const k of Object.keys(det)) {
    const v = det[k];
    if (v === null || typeof v !== 'object') d += k + '=' + v + ';';
    else if (!v.isObject3D && (k === 'disc' || k === 'front' || k === 'back' || k === 'item' || k === 'book')) { try { d += k + '=' + JSON.stringify(v) + ';'; } catch (e) { /* not plain */ } }
  }
  return (H && H.held ? JSON.stringify(H.held) : '') + '|' + invSig(g.inv) + '|' + d;
}
function placedBlock(list, tool) {
  if (!S) return;
  S.placedNow = true;
  const [x, y, z] = list[0];
  const wet = S.wet && S.wet.get(x + ',' + y + ',' + z);
  fire('placed_block', { x, y: y + Y0, z, tool }, {
    block: (bx, by, bz) => { const v = blockView(bx, by, bz); if (bx === x && by === y + Y0 && bz === z) v.waterlogged = !!wet; return v; },
  });
  // the last block of a golem or the wither: it comes to life (entities/summon.js), and you saw it made (summoned_entity)
  const mob = summonAt(G, x, y, z);
  if (mob) fire('summoned_entity', { entity: entityView(mob) });
}
// a damage source as the conditions see it: its tags and who did it
const PROJECTILE = new Set(['arrow', 'trident', 'fireball', 'small_fireball', 'wind_charge', 'breeze_wind_charge', 'thrown', 'snowball', 'egg', 'wither_skull', 'shulker_bullet', 'llama_spit', 'projectile']);
function damageOf(src) {
  if (!src || typeof src !== 'object') return { tags: [] };
  const tags = [];
  const direct = src.direct || null;
  if (direct || PROJECTILE.has(src.type)) tags.push('is_projectile');
  if (src.type === 'explosion' || src.explosion) tags.push('is_explosion');
  if (src.smash) tags.push('mace_smash');
  const dv = direct ? entityView(direct) : null;
  if (dv && direct.type === 'fireball') dv.type = 'fireball';
  if (dv && direct.type === 'wind_charge' && direct.fromBreeze) dv.type = 'breeze_wind_charge';
  const by = src.attacker ? (src.attacker.isPlayer ? playerView() : entityView(src.attacker)) : null;
  return { tags, direct: dv || (src.player && !direct ? by : null), source: by };
}
const byPlayer = (e, src) => !!(src && (src.player || (src.attacker && src.attacker.isPlayer))) || (e.lastHurtByPlayer !== undefined && e.m && e.m.age - e.lastHurtByPlayer < 100);

// after each attach: the parts of one dimension (mobs, the simulation, chests)
export function advParts(g) {
  if (!P) return;
  const E = g.entities, sim = g.sim, C = g.containers;
  if (E && !E.__adv) {
    E.__adv = true;
    // a death: player_killed_entity, killed_by_arrow, kill_mob_near_sculk_catalyst, the axolotl's help
    const onDeath = E.onDeath.bind(E);
    E.onDeath = (e, src) => {
      const r = onDeath(e, src);
      try { if (byPlayer(e, src)) killed(e, src); } catch (err) { console.warn(err); }
      return r;
    };
    // a right click on a mob: player_interacted_with_entity (and the fish, the axolotl or the tadpole in a bucket)
    const interact = E.interact.bind(E);
    E.interact = e => {
      if (!e || e.removed || e.dead) return interact(e);
      const held = g.inv && g.inv.slots[g.inv.selected] ? stackView(g.inv.slots[g.inv.selected]) : null;
      const type = e.type, body = e.body ? Object.assign({}, e.body) : null, wild = !e.tamed;
      const r = interact(e);
      if (r) {
        try {
          // tamed by hand (a wolf's bone, a cat's fish, a parrot's seeds)
          if (wild && e.tamed) tamed(e);
          if (held && held.name === 'water_bucket' && /^(cod|salmon|tropical_fish|pufferfish|axolotl|tadpole)$/.test(type)) fire('filled_bucket', { item: { name: type + '_bucket', count: 1 } });
          if (held && held.name === 'shears' && body && !e.body && type === 'wolf') fire('player_sheared_equipment', { entity: entityView(e), item: stackView(body) });
          fire('player_interacted_with_entity', () => ({ entity: entityView(e), item: held }));
        } catch (err) { console.warn(err); }
      }
      return r;
    };
    wrapCombat(g, E);
    // lightning: channeled_lightning (a trident's) and lightning_strike (seen from near)
  }
  if (sim && !sim.__adv) {
    sim.__adv = true;
    if (sim.sleep) { const sleep = sim.sleep; sim.sleep = (...a) => { const r = sleep(...a); fire('slept_in_bed', {}); return r; }; }
    // a target struck by your arrow or trident: target_hit, with its signal and how far away you stood
    const RS = sim.redstone;
    if (RS && RS.targetHit && !RS.__adv) {
      RS.__adv = true;
      const th = RS.targetHit;
      RS.targetHit = (x, y, z, hx, hy, hz, f, isArrow) => {
        const pw = th(x, y, z, hx, hy, hz, f, isArrow);
        if (pw > 0 && E && E.list) {
          const mine = E.list.find(e => (e.type === 'arrow' || e.type === 'spectral_arrow' || e.type === 'trident' || e.type === 'snowball' || e.type === 'egg') && e.owner && e.owner.isPlayer && Math.abs(e.pos.x - hx) < 2 && Math.abs(e.pos.y - hy) < 2 && Math.abs(e.pos.z - hz) < 2);
          if (mine) fire('target_hit', { signal_strength: pw, projectile: { type: mine.type, x: hx, y: hy + Y0, z: hz, equipment: {} } });
        }
        return pw;
      };
    }
    const W = sim.weather;
    if (W && W.strike && !W.__adv) {
      W.__adv = true;
      const strike = W.strike.bind(W);
      W.strike = (x, y, z) => lightning(strike, x, y, z);
    }
  }
  // a structure's chest opened: player_generates_container_loot
  if (C && !C.__adv) {
    C.__adv = true;
    const roll = C.rollLoot.bind(C);
    C.rollLoot = (c, asStacks) => {
      const k = C.key(c.x, c.y, c.z), fresh = !C.looted.has(k);
      const r = roll(c, asStacks);
      if (fresh && C.looted.has(k) && !asStacks) {
        const L = window.__lc2, e = L && L.structures && L.structures.chestAt ? L.structures.chestAt(c.x, c.y, c.z) : null;
        if (e && e.table) fire('player_generates_container_loot', { table: e.table });
      }
      return r;
    };
  }
}
// the player's swings, shots and blocks (combat/combat.js)
function wrapCombat(g, E) {
  const C = E.combat;
  if (!C || C.__adv) return;
  C.__adv = true;
  // a projectile stopped by the shield: entity_hurt_player, blocked
  if (C.blocked) {
    const bl = C.blocked.bind(C);
    C.blocked = (amount, src) => { const r = bl(amount, src); fire('entity_hurt_player', () => ({ damage: { type: damageOf(src), blocked: true, dealt: amount, taken: 0 } })); return r; };
  }
  if (C.fireCrossbow) {
    const fc = C.fireCrossbow.bind(C);
    C.fireCrossbow = s => { const view = stackView(s); const r = fc(s); fire('shot_crossbow', { item: view }); return r; };
  }
  // the mace's smash: the hit's damage before armour (player_hurt_entity, Over-Overkill)
  const attack = C.attack.bind(C);
  C.attack = (e, spin) => {
    const before = C.lastHit;
    const held = g.inv ? stackView(g.inv.slots[g.inv.selected]) : null;
    const r = attack(e, spin);
    const h = C.lastHit;
    if (r && h && h !== before && h.smash) {
      fire('player_hurt_entity', () => ({ entity: entityView(e), damage: { type: { tags: ['mace_smash'], direct: Object.assign(playerView(), { equipment: Object.assign(playerView().equipment, { mainhand: held }) }), source: playerView() }, dealt: h.dmg, taken: Math.max(0, (h.before || 0) - Math.max(0, h.after || 0)) } }));
    }
    return r;
  };
  // a spear's charge: how many it has hit in this one charge (spear_mobs), counted up one at a time
  if (C.chargeTick) {
    const ct = C.chargeTick.bind(C);
    C.chargeTick = (s, u) => {
      const n0 = u && u.hits ? u.hits.size : 0;
      const r = ct(s, u);
      const n1 = u && u.hits ? u.hits.size : 0;
      for (let k = n0 + 1; k <= n1; k++) fire('spear_mobs', { count: k });
      return r;
    };
  }
}
function killed(e, src) {
  const dmg = damageOf(src);
  const ev = () => ({ entity: entityView(e), killingBlow: dmg });
  fire('player_killed_entity', ev);
  // an arrow from a crossbow: the mobs it has killed (Arbalistic, Two Birds, the Pillager)
  const a = src && src.direct;
  if (a && a.fromCrossbow && (a.type === 'arrow' || a.type === 'spectral_arrow')) {
    a.__advKills = a.__advKills || [];
    a.__advKills.push(entityView(e));
    fire('killed_by_arrow', { victims: a.__advKills.slice(), fired_from_weapon: { name: 'crossbow', count: 1 } });
  }
  // a sculk catalyst within 8 blocks blooms for a mob that gives experience (It Spreads)
  const XP = e.xp !== undefined ? e.xp : e.constructor && e.constructor.XP;
  if (XP > 0 && P.wants('kill_mob_near_sculk_catalyst') && B.sculk_catalyst !== undefined) {
    const w = G.world, x = Math.floor(e.pos.x), y = Math.floor(e.pos.y), z = Math.floor(e.pos.z);
    let found = false;
    for (let dy = -8; dy <= 8 && !found; dy++) for (let dz = -8; dz <= 8 && !found; dz++) for (let dx = -8; dx <= 8; dx++) if (w.get(x + dx, y + dy, z + dz) === B.sculk_catalyst) { found = true; break; }
    if (found) fire('kill_mob_near_sculk_catalyst', { entity: entityView(e) });
  }
  // an axolotl fighting it, with you within 20 blocks of it: Regeneration for you, and Mining Fatigue gone (the game's supporting effects)
  const E = G.entities, pp = G.player.pos;
  if (E && E.list) {
    const ax = E.list.find(o => o.type === 'axolotl' && !o.dead && o.target === e && Math.abs(o.pos.x - pp.x) <= 20.3 && Math.abs(o.pos.y - pp.y) <= 21 && Math.abs(o.pos.z - pp.z) <= 20.3);
    if (ax && G.survival) {
      const sv = G.survival, cur = sv.effects.regeneration;
      if (!cur || (cur.ticks >= 0 && cur.ticks <= 2399)) sv.addEffect('regeneration', 1, Math.min(2400, 100 + (cur && cur.ticks > 0 ? cur.ticks : 0)));
      if (sv.effects.mining_fatigue) delete sv.effects.mining_fatigue;
      fire('effects_changed', () => ({ effects: new Set(Object.keys(sv.effects)), source: entityView(ax) }));
    }
  }
}
// lightning: who it struck (the trident's channeling), who stood near and was spared, and the fire it lit
let channelling = false;
function lightning(strike, x, y, z) {
  const E = G && G.entities, sim = G && G.sim;
  const hit = [], near = [];
  if (E && E.list) for (const e of E.list) {
    if (e.removed || e.dead || !(e instanceof Living)) continue;
    const dx = e.pos.x - x - 0.5, dz = e.pos.z - z - 0.5, dy = e.pos.y - y;
    if (dx * dx + dz * dz <= 9 && Math.abs(dy) <= 6) hit.push(e);
    else if (Math.abs(dx) <= 15 && Math.abs(dz) <= 15 && dy >= -15 && dy <= 21) near.push(e);
  }
  const views = hit.map(e => entityView(e)), spared = near.map(e => entityView(e));
  let fires = 0;
  const lf = sim && sim.lightFire;
  // (a fire counts once it is really there: none takes on top of a lightning rod)
  if (lf) sim.lightFire = (...a) => { const before = sim.get(a[0], a[1], a[2]); const r = lf.apply(sim, a); const now = sim.get(a[0], a[1], a[2]); if (now !== before && BLOCKS[now] && /fire$/.test(BLOCKS[now].name)) fires++; return r; };
  let r;
  try { r = strike(x, y, z); } finally { if (lf) sim.lightFire = lf; }
  if (channelling) fire('channeled_lightning', { victims: views });
  fire('lightning_strike', { lightning: { type: 'lightning_bolt', x: x + 0.5, y: y + Y0, z: z + 0.5, fires }, bystanders: spared });
  return r;
}

/* ---- the things every game shares, wrapped once on their classes ---- */
function wrapProto(cls, name, fn) {
  if (!cls || !cls.prototype || typeof cls.prototype[name] !== 'function' || cls.prototype[name].__adv) return;
  const orig = cls.prototype[name];
  const w = function (...a) { return fn.call(this, orig, a); };
  w.__adv = true;
  cls.prototype[name] = w;
}
// arrows and tridents hitting a mob: player_hurt_entity (Take Aim, A Throwaway Joke)
wrapProto(Living, 'hurt', function (orig, a) {
  const [amount, src] = a;
  const hp = this.health;
  const r = orig.apply(this, a);
  if (r && G && src && src.direct && (src.player || (src.attacker && src.attacker.isPlayer))) {
    const e = this;
    fire('player_hurt_entity', () => ({ entity: entityView(e), damage: { type: damageOf(src), dealt: amount, taken: Math.max(0, hp - Math.max(0, e.health)) } }));
  }
  return r;
});
// a wind charge's burst that throws you: remembered until you land (fall_after_explosion)
wrapProto(WindCharge, 'burst', function (orig, a) {
  const P = this.m && this.m.P, v0 = P ? [P.vel.x, P.vel.y, P.vel.z] : null, type = this.type;
  const r = orig.apply(this, a);
  if (P && G && G.player === P && (P.vel.x !== v0[0] || P.vel.y !== v0[1] || P.vel.z !== v0[2])) launched(type);
  return r;
});
/* an allay bringing what it collected to your feet (thrown_item_picked_up_by_player), or leaving it on
   the note block it likes (allay_drop_item_on_block, for you, who gave it the item) */
wrapProto(Allay, 'aiStep', function (orig, a) {
  const n = this.carry | 0, item = this.equip && this.equip.mainhand;
  const r = orig.apply(this, a);
  if (n > 0 && !(this.carry | 0) && G) {
    const v = this, st = { name: typeof item === 'string' ? item : itemName(item && item.id), count: n }, at = this.gaveAt;
    if (at) fire('allay_drop_item_on_block', { x: at[0], y: at[1] + Y0, z: at[2], tool: st });
    else fire('thrown_item_picked_up_by_player', () => ({ entity: entityView(v), item: st }));
  }
  return r;
});
// a piglin picking up gold you threw (thrown_item_picked_up_by_entity: Oh Shiny)
wrapProto(Piglin, 'pickUp', function (orig, a) {
  const e = a[0], st = e && e.stack ? Object.assign(stackView(e.stack), { count: 1 }) : null, mine = !!(e && e.thrown);
  const r = orig.apply(this, a);
  if (r && mine && st && G) { const v = this; fire('thrown_item_picked_up_by_entity', () => ({ entity: entityView(v), item: st })); }
  return r;
});
// a horse, donkey, mule or llama giving in to its rider: tame_animal
wrapProto(AbstractHorse, 'tameHorse', function (orig, a) {
  const wild = !this.tamed;
  const r = orig.apply(this, a);
  if (wild && this.tamed) tamed(this);
  return r;
});
// a trade made: villager_trade
for (const cls of [Merchant, WanderingTrader]) wrapProto(cls, 'traded', function (orig, a) {
  const r = orig.apply(this, a);
  const o = a[0], v = this;
  fire('villager_trade', () => ({ villager: entityView(v), item: o && o.out ? stackView(o.out) : null }));
  return r;
});
// a zombie villager cured by you: cured_zombie_villager
wrapProto(CurableZombieVillager, 'cured', function (orig, a) {
  const curer = this.curer, z = entityView(this);
  const r = orig.apply(this, a);
  if (curer && curer.isPlayer) fire('cured_zombie_villager', { zombie: z });
  return r;
});
// a fish reeled in: fishing_rod_hooked with what came up
wrapProto(FishingBobber, 'reel', function (orig, a) {
  const m = this.m, caught = [];
  const drop = m.dropItemAt;
  m.dropItemAt = function (x, y, z, name, n, ...rest) { caught.push(name); return drop.call(this, x, y, z, name, n, ...rest); };
  let r;
  try { r = orig.apply(this, a); } finally { m.dropItemAt = drop; }
  for (const n of caught) fire('fishing_rod_hooked', { item: { name: n, count: 1 }, rod: { name: 'fishing_rod', count: 1 } });
  if (this.hooked && !caught.length) fire('fishing_rod_hooked', { entity: entityView(this.hooked), rod: { name: 'fishing_rod', count: 1 } });
  return r;
});
// the dragon falling: Free the End (and Monsters Hunted's dragon); one made again from crystals: The End... Again...
wrapProto(EnderDragon, 'setPhase', function (orig, a) {
  const was = this.phase;
  const r = orig.apply(this, a);
  if (a[0] === 'dying' && was !== 'dying' && G && G.dim === 'the_end') {
    const d = this;
    fire('player_killed_entity', () => ({ entity: { type: 'ender_dragon', x: d.pos.x, y: d.pos.y + Y0, z: d.pos.z, dim: 'the_end', equipment: {} }, killingBlow: { tags: [] } }));
  }
  return r;
});
// the dragon brought back by four crystals (summoned_entity): the respawn's last tick clears the respawn and
// then spawns it, so it is seen after that tick (a respawn cut short is cleared elsewhere, never in it)
wrapProto(EndFight, 'respawnTick', function (orig, a) {
  const r = orig.apply(this, a);
  if (!this.s.respawn && this.dragon) fire('summoned_entity', { entity: { type: 'ender_dragon', equipment: {} } });
  return r;
});
// a trident's channeling: what its bolt strikes (channeled_lightning)
{
  const T = TYPES.trident;
  wrapProto(T, 'channel', function (orig, a) {
    channelling = !!(this.owner && this.owner.isPlayer);
    try { return orig.apply(this, a); } finally { channelling = false; }
  });
}
// the enchanting table: enchanted_item
wrapProto(EnchantScreen, 'extraClick', function (orig, a) {
  const before = this.grid && this.grid[0];
  const r = orig.apply(this, a);
  const after = this.grid && this.grid[0];
  if (after && after !== before && after.ench) fire('enchanted_item', { item: stackView(after), levels: 0 });
  return r;
});
// a smithing table's trim: recipe_crafted (the game's recipe is the template's name and _smithing_trim)
wrapProto(SmithingScreen, 'craftOnce', function (orig, a) {
  const t = this.grid && this.grid[0] ? itemName(this.grid[0].id) : '';
  const r = orig.apply(this, a);
  if (r && r.trim && t) fire('recipe_crafted', { recipe: t + '_smithing_trim', ingredients: [] });
  else if (r && t === 'netherite_upgrade_smithing_template') fire('recipe_crafted', { recipe: itemName(r.id) + '_smithing', ingredients: [] });
  return r;
});
// a crafting grid's result taken: recipe_crafted (a decorated pot from sherds is the game's decorated_pot recipe)
wrapProto(ContainerScreen, 'craftOnce', function (orig, a) {
  const grid = this.grid ? this.grid.filter(Boolean).map(s => stackView(s)) : [];
  const r = orig.apply(this, a);
  if (r && G) {
    const n = itemName(r.id);
    const recipe = n === 'decorated_pot' ? (grid.some(s => /_pottery_sherd$/.test(s.name)) ? 'decorated_pot' : 'decorated_pot_simple') : n;
    fire('recipe_crafted', { recipe, ingredients: grid });
  }
  return r;
});
// a potion taken out of a brewing stand: brewed_potion
for (const name of ['click', 'quickMove']) wrapProto(BrewingScreen, name, function (orig, a) {
  const s = a[0];
  const box = s && s.kind === 'box' && s.i <= 2 ? this.box : null, before = box ? box[s.i] : null;
  const r = orig.apply(this, a);
  if (box && before && before.potion && box[s.i] !== before) fire('brewed_potion', { item: stackView(before) });
  return r;
});

/* ======================================================= every tick ===== */
export function advTick(g) {
  if (!P || !S || g !== G || !g.player) return;
  const p = g.player, t = ++S.t;
  // (a spectator, or a player lying dead, counts for nothing)
  if (g.mode === 'spectator' || (g.survival && g.survival.dead)) { S.fall = S.launch = S.lev = S.lava = null; return; }
  // what you carry: inventory_changed whenever it changes
  if (P.wants('inventory_changed')) {
    const sig = invSig(g.inv);
    if (sig !== S.sig) { S.sig = sig; fire('inventory_changed', { stacks: stacksOf(g.inv) }); }
  }
  // a change of dimension: changed_dimension, and the Nether's shortcut (nether_travel)
  if (S.dim !== g.dim) {
    const from = S.dim, to = g.dim;
    S.dim = to;
    S.biome = null; S.biomeAt = null; S.fall = null; S.launch = null;
    fire('changed_dimension', { from, to });
    const x = P.extra;
    if (from === 'overworld' && to === 'the_nether') x.netherFrom = { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z };
    else if (from === 'the_nether' && to === 'overworld' && x.netherFrom) {
      fire('nether_travel', { start: x.netherFrom, end: { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z } });
      delete x.netherFrom;
    }
  }
  // where you are, once a second: location (biomes, structures, what you walk on)
  if (t % 20 === 0) {
    askBiome(g);
    if (P.wants('location')) fire('location', {});
  }
  effectsTick(g);
  fallTick(g, p);
  rideTick(g, p);
  if (t % 5 === 0) tameTick(g);
  breedTick(g);
  if (t % 20 === 10) beaconTick(g, p);
  spyglassTick(g, p);
  blockTick(g, p);
  sneakTick(g, p);
}
function invSig(inv) {
  let h = 0;
  const add = s => { h = (h * 31 + (s ? s.id * 97 + (s.count | 0) : 7)) | 0; };
  for (let i = 0; i < inv.slots.length; i++) add(inv.slots[i]);
  if (inv.armor) for (const s of inv.armor) add(s);
  add(inv.offhand);
  return h;
}
function stacksOf(inv) {
  const out = [];
  for (const s of inv.slots) if (s) out.push(stackView(s));
  if (inv.armor) for (const s of inv.armor) if (s) out.push(stackView(s));
  if (inv.offhand) out.push(stackView(inv.offhand));
  return out;
}
// the generator's biome at the player (asked in the background; the answer is used for the next second)
function askBiome(g) {
  const w = g.world, p = g.player;
  if (S.asking || !w || !w.ask || g.dim !== 'overworld' || w.generator !== 'vanilla') { S.biome = null; return; }
  const at = { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z }, st = S;
  st.asking = true;
  w.ask({ type: 'structures', op: 'biome', x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) }).then(m => {
    st.asking = false;
    if (!G || G.world !== w || S !== st) return;
    if (m && m.biome) { st.biome = m.biome; st.biomeAt = at; if (P.wants('location')) fire('location', {}); }
  }, () => { st.asking = false; });
}
// effects: effects_changed when the set changes; levitation, measured from where it began
function effectsTick(g) {
  const sv = g.survival;
  if (!sv || !sv.effects) return;
  const keys = Object.keys(sv.effects).sort().join(',');
  if (keys !== S.fx) { S.fx = keys; fire('effects_changed', () => ({ effects: new Set(Object.keys(sv.effects)) })); }
  const p = g.player;
  if (sv.effects.levitation) {
    if (!S.lev) S.lev = { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z, t: S.t };
    fire('levitation', { start: S.lev, end: { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z }, duration: S.t - S.lev.t });
  } else S.lev = null;
}
/* Falls: from where you began to fall to where it ended, if you live (fall_from_height). A wind
   charge's launch counts as the game counts it (fall_after_explosion): once, the moment you start
   to fall after it, from where it hit you to where the fall begins, and only when that is no lower
   than where it hit you (a charge that knocks you off a ledge is not a launch) */
function fallTick(g, p) {
  const sv = g.survival;
  // a teleport (a command, a portal, an ender pearl's long throw) starts every fall afresh
  const lp = S.lastPos;
  if (lp && Math.abs(p.pos.x - lp[0]) + Math.abs(p.pos.y - lp[1]) + Math.abs(p.pos.z - lp[2]) > 12) S.fall = S.launch = null;
  S.lastPos = [p.pos.x, p.pos.y, p.pos.z];
  const settled = p.onGround || p.inWater || p.climbing || p.flying || (g.entities && g.entities.riding);
  const L = S.launch;
  if (!settled) {
    if (!S.fall && p.vel.y < 0) {
      S.fall = { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z };
      if (L && L.start.y <= S.fall.y) fire('fall_after_explosion', { start: L.start, end: S.fall, cause: L.cause });
    }
  } else if (S.fall) {
    if (!(sv && sv.dead)) fire('fall_from_height', { start: S.fall, end: { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z } });
    S.fall = null;
  }
  // (the launch is forgotten once you are down again, after the few ticks the push takes to lift you)
  if (L && settled && S.t - L.t >= 3) S.launch = null;
}
// a wind charge's burst that moves you: where it hit you, until you land (a fall under way starts again from the top)
export function launched(cause) {
  if (!S || !G) return;
  const p = G.player;
  S.launch = { start: { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z }, cause: { type: cause, equipment: {} }, t: S.t };
  S.fall = null;
}
/* riding: started_riding as you get on, and as anything else gets on what you ride (a goat into
   your boat); a strider in the Overworld's lava (ride_entity_in_lava); the fungus on a stick
   (item_durability_changed) */
function rideTick(g, p) {
  const E = g.entities, r = E && E.riding;
  const crew = r && r.passengers ? r.passengers.length : 0;
  if (r !== S.riding) { S.riding = r; S.lava = null; if (r) fire('started_riding', {}); }
  else if (r && crew > S.crew) fire('started_riding', {});
  S.crew = crew;
  // (a strider walking on the lava's top half counts as in it, as the game's box in the lava does;
  // entities/nether.js keeps its inLava off there so it does not swim)
  if (r && r.type === 'strider' && (r.inLava || r.onLava)) {
    if (!S.lava) S.lava = { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z };
    fire('ride_entity_in_lava', { start: S.lava, end: { x: p.pos.x, y: p.pos.y + Y0, z: p.pos.z } });
  } else S.lava = null;
  // the stick wears as the strider is urged on
  if (r && r.type === 'strider') {
    const held = g.inv.slots[g.inv.selected], off = g.inv.offhand;
    const s = held && itemName(held.id) === 'warped_fungus_on_a_stick' ? held : off && itemName(off.id) === 'warped_fungus_on_a_stick' ? off : null;
    const d = s ? s.dmg | 0 : -1;
    if (S.stick !== undefined && s && d !== S.stick && S.stick >= 0) fire('item_durability_changed', { item: stackView(s) });
    S.stick = d;
  } else S.stick = undefined;
}
/* A pet tamed: tame_animal. Taming by hand is seen as it happens (the right click), a horse's or a
   llama's as it gives in (tameHorse); anything else tamed is noticed here (a mob first seen
   untamed that is tamed now). */
function tamed(e) {
  if (!S || S.tamed.get(e) === true) return;
  S.tamed.set(e, true);
  fire('tame_animal', { entity: entityView(e) });
}
function tameTick(g) {
  const E = g.entities;
  if (!E || !E.list || !P.wants('tame_animal')) return;
  for (const e of E.list) {
    if (e.tamed === undefined || e.dead || e.removed) continue;
    const was = S.tamed.get(e);
    if (was === undefined) { S.tamed.set(e, !!e.tamed); continue; }
    if (!was && e.tamed) tamed(e);
    else if (was && !e.tamed) S.tamed.set(e, false);
  }
}
/* Two animals bred: bred_animals. Every way the mobs breed (a baby of their own kind, a mule, a
   frog's tadpoles, a turtle's or a sniffer's eggs) ends the pair's love and starts their 5 minute
   wait (ageT 6000) in the same tick: a pair seen doing that is a breeding, and the child is the
   baby just born beside them, or for those that lay eggs or spawn, one of their own kind (as the
   game counts a frog or a turtle for Two by Two). */
function breedTick(g) {
  const E = g.entities;
  if (!E || !E.list) return;
  const was = S.loving || new Set(), now = new Set(), bred = [];
  for (const e of E.list) {
    if (e.inLove > 0 && !e.dead) now.add(e);
    else if (was.has(e) && !e.dead && e.ageT >= 5990) bred.push(e);
  }
  S.loving = now;
  if (!bred.length || !P.wants('bred_animals')) return;
  const used = new Set();
  for (const a of bred) {
    if (used.has(a)) continue;
    let b = null, bd = 64;
    for (const o of bred) { if (o === a || used.has(o)) continue; const d = (o.pos.x - a.pos.x) ** 2 + (o.pos.z - a.pos.z) ** 2; if (d < bd) { bd = d; b = o; } }
    if (!b) continue;
    used.add(a); used.add(b);
    let baby = null;
    for (const o of E.list) if (!o.dead && o.ageT !== undefined && o.ageT <= -23990 && (o.pos.x - a.pos.x) ** 2 + (o.pos.z - a.pos.z) ** 2 < 25) { baby = o; break; }
    const child = baby && baby.type !== 'tadpole' ? entityView(baby) : Object.assign(entityView(a), { baby: true });
    fire('bred_animals', { child, parent: entityView(a), partner: entityView(b) });
  }
}
/* Beacons: one that comes alive (a pyramid under it and the sky over it) counts for everyone within
   10 blocks across and a few up and down, with its level then (construct_beacon) */
function beaconTick(g, p) {
  const bm = g.sim && g.sim.beams;
  if (!bm || !bm.list) return;
  const now = new Set(bm.list.keys());
  for (const k of now) {
    if (S.beacons.has(k)) continue;
    const [x, y, z] = k.split(',').map(Number);
    if (Math.abs(p.pos.x - x - 0.5) <= 10.5 && Math.abs(p.pos.z - z - 0.5) <= 10.5 && p.pos.y >= y - 9 && p.pos.y <= y + 6) fire('construct_beacon', { level: beaconLevel(g.world, x, y, z) });
  }
  S.beacons = now;
}
const BASE = new Set(['iron_block', 'gold_block', 'emerald_block', 'diamond_block', 'netherite_block']);
export function beaconLevel(w, x, y, z) {
  let n = 0;
  for (let lv = 1; lv <= 4; lv++) {
    for (let dx = -lv; dx <= lv; dx++) for (let dz = -lv; dz <= lv; dz++) { const d = BLOCKS[w.get(x + dx, y - lv, z + dz)]; if (!d || !BASE.has(d.name)) return n; }
    n = lv;
  }
  return n;
}
/* The spyglass at your eye: using_item, and the first thing your look meets within 100 blocks
   (if you can see it): a parrot, a ghast, the dragon */
function spyglassTick(g, p) {
  const I = g.inter;
  if (!I || !I.useHeld || (D && D.gui && D.gui.isOpen())) return;
  const main = g.inv.slots[g.inv.selected], off = g.inv.offhand;
  const s = main && itemName(main.id) === 'spyglass' ? main : !main && off && itemName(off.id) === 'spyglass' ? off : null;
  if (!s || !P.wants('using_item')) return;
  const look = lookingAt(g, p);
  fire('using_item', { item: stackView(s) }, { player: Object.assign(playerView(), { lookingAt: look }) });
}
function lookingAt(g, p) {
  const eye = g.eye || p.view(0).eye;
  const dx = -Math.sin(p.yaw) * Math.cos(p.pitch), dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * Math.cos(p.pitch);
  let best = null, bt = 100;
  const test = (cx, cy0, cz, hw, h, view) => {
    // the ray against the box
    let t0 = 0, t1 = bt;
    const lo = [cx - hw, cy0, cz - hw], hi = [cx + hw, cy0 + h, cz + hw], o = [eye.x, eye.y, eye.z], d = [dx, dy, dz];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return; continue; }
      let a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
      if (a > b) { const q = a; a = b; b = q; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return;
    }
    if (t0 < bt) { bt = t0; best = view; }
  };
  const E = g.entities;
  if (E && E.list) for (const e of E.list) {
    if (e.removed || e.dead || !(e instanceof Living)) continue;
    if (Math.abs(e.pos.x - eye.x) > 101 || Math.abs(e.pos.z - eye.z) > 101) continue;
    test(e.pos.x, e.pos.y, e.pos.z, e.hw || 0.3, e.h || 1, e);
  }
  const dr = g.realms && g.realms.fight && g.realms.fight.dragon;
  if (dr && !dr.dead) test(dr.pos.x, dr.pos.y, dr.pos.z, 4, 4, { type: 'ender_dragon', pos: dr.pos, dragon: true });
  if (!best) return null;
  // nothing solid between
  const w = g.world;
  for (let s = 0.5; s < bt; s += 0.5) {
    const b = w.get(Math.floor(eye.x + dx * s), Math.floor(eye.y + dy * s), Math.floor(eye.z + dz * s));
    const d = BLOCKS[b];
    if (d && d.solid && d.opacity >= 15) return null;
  }
  return best.dragon ? { type: 'ender_dragon', x: best.pos.x, y: best.pos.y + Y0, z: best.pos.z, equipment: {} } : entityView(best);
}
/* Blocks you are in or against: an end gateway (enter_block), the side of a honey block on the way
   down (slide_down_block), powder snow under leather boots is location's own */
function blockTick(g, p) {
  const w = g.world;
  if (B.end_gateway !== undefined && g.dim === 'the_end') {
    let inGate = false;
    for (let y = Math.floor(p.pos.y); y <= Math.floor(p.pos.y + 1.8); y++) if (w.get(Math.floor(p.pos.x), y, Math.floor(p.pos.z)) === B.end_gateway) inGate = true;
    if (inGate && !S.gate) fire('enter_block', { block: { name: 'end_gateway', meta: 0 } });
    S.gate = inGate;
  }
  // sliding down a honey block's side (player.js honeySlide, the game's rule)
  if (p.slidingOn) fire('slide_down_block', { block: { name: 'honey_block', meta: 0 } });
}
/* Sneaking where a sculk sensor (8 blocks; a calibrated one 16) or a warden (16) would have heard
   your steps: avoid_vibration, once a step's worth of creeping */
function sneakTick(g, p) {
  if (!p.sneaking || !p.onGround || p.flying || !P.wants('avoid_vibration')) { S.sneakAt = null; return; }
  const at = [p.pos.x, p.pos.z];
  if (S.sneakAt) S.sneak += Math.hypot(at[0] - S.sneakAt[0], at[1] - S.sneakAt[1]);
  S.sneakAt = at;
  if (S.sneak < 5 / 3) return;
  S.sneak = 0;
  const sc = g.sim && g.sim.sculk;
  let heard = false;
  if (sc && sc.near) for (const s of sc.near.values()) {
    const d = BLOCKS[g.world.get(s[0], s[1], s[2])], r = d && d.name === 'calibrated_sculk_sensor' ? 16 : 8;
    if ((s[0] + 0.5 - p.pos.x) ** 2 + (s[1] + 0.5 - p.pos.y) ** 2 + (s[2] + 0.5 - p.pos.z) ** 2 <= r * r) { heard = true; break; }
  }
  if (!heard && g.entities && g.entities.list) heard = g.entities.list.some(e => e.type === 'warden' && !e.dead && e.dist2 && e.dist2(p.pos.x, p.pos.y, p.pos.z) <= 256);
  if (heard) fire('avoid_vibration', {});
}

/* ======================================================= /advancement ===== */
const ID = s => (s || '').replace(/^minecraft:/, '');
function descendants(a, out = []) { out.push(a); for (const c of a.children) descendants(c, out); return out; }
function ancestors(a) { const out = []; let p = a; while (p) { out.unshift(p); p = p.parent ? ADV.get(p.parent) : null; } return out; }
const nameOf = a => (CODE[a.frame] || '§a') + '[' + a.title + ']§r';
register('advancement', {
  usage: '(grant|revoke) <targets> (everything|only|from|through|until) [advancement] [criterion]',
  suggest: (i, w) => i === 0 ? ['grant', 'revoke', 'test'] : i === 1 ? ['@s'] : i === 2 && w[0] !== 'test' ? ['everything', 'only', 'from', 'through', 'until']
    : (i === 3 && w[0] !== 'test') || (i === 2 && w[0] === 'test') ? [...ADV.keys()].map(k => 'minecraft:' + k).filter(k => k.startsWith(w[i] || '')).slice(0, 40)
      : (() => { const a = ADV.get(ID(w[i - 1])); return a ? a.crit.map(c => c[0]) : []; })(),
  run(args, ctx) {
    try { advancementCommand(args, ctx); } catch (e) { if (e && e.advCommand) ctx.say(e.message, 0xFF5555); else throw e; }
  },
});
function advancementCommand(args, ctx) {
    const RED = 0xFF5555;
    const action = args[0];
    if (action !== 'grant' && action !== 'revoke' && action !== 'test') throw err('Incorrect argument for command');
    const who = args[1];
    if (who === undefined) throw err('Incomplete command');
    if (!(who === '@s' || who === '@p' || who === '@a' || who.toLowerCase() === String(ctx.playerName).toLowerCase())) throw err('No player was found');
    const pr = ctx.game && ctx.game.advancements;
    if (!pr) throw err('No player was found');
    const player = ctx.playerName;
    if (action === 'test') {
      // (the old game's /advancement test, kept for checking: Java's own is execute if entity @s[advancements=...])
      const a = ADV.get(ID(args[2]));
      if (!a) throw err(`Unknown advancement: ${args[2] || ''}`);
      const crit = args[3];
      if (crit !== undefined) {
        if (!a.crit.some(c => c[0] === crit)) throw err(`The advancement ${nameOf(a)} does not contain the criterion '${crit}'`);
        if (pr.has(a.id, crit)) ctx.say(`${player} has the criterion '${crit}' of the advancement ${nameOf(a)}`);
        else ctx.say(`${player} does not have the criterion '${crit}' of the advancement ${nameOf(a)}`, RED);
      } else if (pr.isMade(a.id)) ctx.say(`${player} has completed the advancement ${nameOf(a)}`);
      else ctx.say(`${player} does not have the advancement ${nameOf(a)}`, RED);
      return;
    }
    const mode = args[2];
    let list;
    if (mode === 'everything') list = [...ADV.values()];
    else if (mode === 'only' || mode === 'from' || mode === 'through' || mode === 'until') {
      const a = ADV.get(ID(args[3]));
      if (!a) throw err(`Unknown advancement: ${args[3] || ''}`);
      if (mode === 'only' && args[4] !== undefined) {
        const crit = args[4];
        if (!a.crit.some(c => c[0] === crit)) throw err(`The advancement ${nameOf(a)} does not contain the criterion '${crit}'`);
        const ok = action === 'grant' ? (!pr.has(a.id, crit) && (pr.award(a.id, crit, 'command') || true)) : pr.revoke(a.id, crit);
        if (!ok) throw err(action === 'grant' ? `Couldn't grant criterion '${crit}' of advancement ${nameOf(a)} to ${player} as they already have it` : `Couldn't revoke criterion '${crit}' of advancement ${nameOf(a)} from ${player} as they don't have it`);
        ctx.say(action === 'grant' ? `Granted criterion '${crit}' of advancement ${nameOf(a)} to ${player}` : `Revoked criterion '${crit}' of advancement ${nameOf(a)} from ${player}`);
        return;
      }
      list = mode === 'only' ? [a] : mode === 'from' ? descendants(a) : mode === 'until' ? ancestors(a) : [...new Set(ancestors(a).concat(descendants(a)))];
    } else throw err(mode === undefined ? 'Incomplete command' : 'Incorrect argument for command');
    let n = 0;
    for (const a of list) {
      if (action === 'grant') { if (!pr.isMade(a.id)) { pr.grant(a.id, 'command'); n++; } }
      else if (pr.revoke(a.id)) n++;
    }
    const one = list.length === 1, a0 = list[0];
    if (!n) {
      if (action === 'grant') throw err(one ? `Couldn't grant advancement ${nameOf(a0)} to ${player} as they already have it` : `Couldn't grant ${list.length} advancements to ${player} as they already have them`);
      throw err(one ? `Couldn't revoke advancement ${nameOf(a0)} from ${player} as they don't have it` : `Couldn't revoke ${list.length} advancements from ${player} as they don't have them`);
    }
    if (action === 'grant') ctx.say(one ? `Granted the advancement ${nameOf(a0)} to ${player}` : `Granted ${list.length} advancements to ${player}`);
    else ctx.say(one ? `Revoked the advancement ${nameOf(a0)} from ${player}` : `Revoked ${list.length} advancements from ${player}`);
}
// a failure the command system shows in red (its own error class is not exported: any Error with the message will do)
function err(msg) { const e = new Error(msg); e.advCommand = true; return e; }
export { ADV, TABS };
