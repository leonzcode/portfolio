/* ---------------------------------------------------------------------------
   Leoncraft 2 - advancements and statistics, kept per world (in the
   browser's storage under the world's id), ticked with the spawners
   (struct/spawners.js) and joined to the game the way the sound code is:
   by hooks the game already offers (manager.onDeath and breed, hands.finish,
   the interactor's onBroken, drops.onPickup, the structure loot calls) and a
   look round once a second.

   Advancements are the game's 125 (js/advdata.js, made from its data by
   tools/leoncraft2/build_advancements.py): each criterion has its trigger,
   and those Leoncraft can see are worked out here:
     inventory_changed   what you carry and wear
     location            the structure, the biome, the block under you and
                         your boots, what you ride and who rides with you,
                         a spyglass on a parrot, a ghast or the dragon
     changed_dimension, nether_travel (7000 blocks through the Nether),
     fall_from_height, levitation, enter_block (an end gateway)
     player_killed_entity, entity_killed_player, bred_animals, tame_animal,
     consume_item, player_generates_container_loot (chests and brushing),
     effects_changed, hero_of_the_village, used_totem, shot_crossbow,
     item_durability_changed and ride_entity_in_lava (a strider), filled_bucket,
     enchanted_item and brewed_potion (from what you carry), slept_in_bed,
     summoned_entity (the wither)
   The rest (crafting recipes, items used on blocks, placing blocks, trades,
   arrows' kills and the like) are not followed yet: those never complete.
   Requirements are the game's (every group, any criterion of a group). A
   new one shows a toast (Advancement Made!, Goal Reached!, Challenge
   Complete!) and a line in chat (with announceAdvancements on).

   Recipes for the recipe book (ui/recipebook.js) are unlocked here too, as
   the game's recipe advancements do it (js/recipeunlocks.js, built from its
   data by tools/leoncraft2/build_recipe_unlocks.py): carrying an item for
   the first time unlocks the recipes it is named for (planks the sticks and
   signs, a stone pickaxe the torch...), standing in water the boats, and the
   crafting table is known from the start; a recipe the table does not name
   is unlocked by any of its ingredients. Each new batch shows a New Recipes
   Unlocked! toast; /recipe gives and takes them.

   Statistics (the game's General and Mobs pages, and the Items page's mined,
   picked up and used): time played, distances by way of moving, jumps,
   deaths, kills, damage taken, animals bred, times slept, blocks mined...
--------------------------------------------------------------------------- */
import { ADVANCEMENTS } from './advdata.js?v=24';
import { BLOCKS } from './blocks.js?v=24';
import { BIOMES } from './biomes.js?v=24';
import { ITEMS, I } from './items.js?v=24';
import { CH } from './world-const.js?v=24';
import { allRecipes } from './crafting.js?v=24';
import { register } from './commands.js?v=24';
import { UNLOCKS, START } from './recipeunlocks.js?v=24';

export const TABS = [
  { id: 'story', title: 'Minecraft', icon: 'grass_block', bg: 0xFF3A3A3A },
  { id: 'nether', title: 'Nether', icon: 'red_nether_bricks', bg: 0xFF3A1414 },
  { id: 'end', title: 'The End', icon: 'end_stone', bg: 0xFF2A2A1E },
  { id: 'adventure', title: 'Adventure', icon: 'map', bg: 0xFF2E2418 },
  { id: 'husbandry', title: 'Husbandry', icon: 'hay_block', bg: 0xFF2A3018 },
];
export const BY_ID = new Map(ADVANCEMENTS.map(a => [a.id, a]));
// advancements whose criteria need more than Leoncraft follows (a cat's or a wolf's variant, a frog's,
// what killed it, a recipe...): never granted, rather than granted wrongly
const UNFOLLOWED = new Set(['husbandry/complete_catalogue', 'husbandry/whole_pack', 'husbandry/leash_all_frog_variants', 'nether/return_to_sender',
  'nether/uneasy_alliance', 'adventure/sniper_duel', 'adventure/arbalistic', 'adventure/two_birds_one_arrow', 'adventure/whos_the_pillager_now',
  'adventure/overoverkill', 'adventure/throw_trident', 'adventure/shoot_arrow', 'husbandry/kill_axolotl_target', 'nether/all_effects', 'nether/all_potions',
  'adventure/trade_at_world_height', 'adventure/spear_many_mobs']);
const nameOf = id => (ITEMS[id] ? ITEMS[id].name : BLOCKS[id] ? BLOCKS[id].name : '');
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);
const KEY = id => 'lc2_adv_' + id;

export class Progress {
  constructor() { this.g = null; this.n = 0; this.toasts = []; this.overlaid = false; }
  // a world (or a dimension of it) started: its record, and the hooks
  attach(g) {
    this.g = g;
    const id = g.entry && g.entry.id;
    if (this.id !== id) {
      this.id = id;
      let st = null;
      try { st = JSON.parse(localStorage.getItem(KEY(id)) || 'null'); } catch (e) { st = null; }
      this.done = (st && st.done) || {};
      this.crit = (st && st.crit) || {};
      this.stats = (st && st.stats) || {};
      // the recipe book: items ever carried (by name) and the recipes unlocked (by recipeKey)
      this.seen = new Set((st && st.seen) || []);
      this.rkeys = new Set((st && st.recipes) || []);
      this.unlocked = null;
      if (!st || !st.recipes) this.unlock(allRecipes().filter(r => START.includes(nameOf(r.id))), true);
      this.dim = null; this.track = {};
    }
    this.hook(g);
    if (!this.overlaid) { const L = lc2(); if (L && L.gui) { L.gui.overlays.push(toastOverlay(this)); this.overlaid = true; } }
  }
  save() {
    const o = { done: this.done, crit: this.crit, stats: this.stats, seen: [...(this.seen || [])], recipes: [...(this.rkeys || [])] };
    try { localStorage.setItem(KEY(this.id), JSON.stringify(o)); } catch (e) { /* storage full */ }
    this.dirty = false;
  }

  /* ---- the recipe book's recipes ---- */
  // every recipe unlocked in this world (a Set of crafting.js recipes), or null before a world
  unlockedRecipes() {
    if (!this.rkeys) return null;
    if (!this.unlocked) { const K = recipeKeys(); this.unlocked = new Set([...this.rkeys].map(k => K.byKey.get(k)).filter(Boolean)); }
    return this.unlocked;
  }
  recipeCount() { const u = this.unlockedRecipes(); return u ? u.size : 0; }
  // recipes unlocked (a toast for those that are new); returns how many were
  unlock(list, quiet) {
    const u = this.unlockedRecipes(), K = recipeKeys(), fresh = [];
    for (const r of list) if (!u.has(r)) { u.add(r); this.rkeys.add(K.keyOf.get(r)); fresh.push(r.id); }
    if (fresh.length) { this.dirty = true; if (!quiet) this.recipeToast(fresh); }
    return fresh.length;
  }
  lock(list) {
    const u = this.unlockedRecipes(), K = recipeKeys();
    let n = 0;
    for (const r of list) if (u.delete(r)) { this.rkeys.delete(K.keyOf.get(r)); n++; }
    if (n) this.dirty = true;
    return n;
  }
  // an item carried for the first time (or '@water', first in water): the recipes it unlocks
  see(name) {
    this.seen.add(name);
    this.dirty = true;
    this.unlock(recipesWith(name));
  }
  recipeToast(ids) {
    const last = this.toasts[this.toasts.length - 1];
    if (last && last.recipe && (!last.t0 || performance.now() - last.t0 < SHOW)) { for (const id of ids) if (last.ids.length < 64) last.ids.push(id); return; }
    this.toasts.push({ recipe: true, ids: ids.slice(0, 64), t0: 0 });
    const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound;
    if (S) try { S.near('ui.toast.in', 1, 1, 'ui'); } catch (e) { /* no sound */ }
  }
  stat(k, n = 1) { this.stats[k] = (this.stats[k] || 0) + n; this.dirty = true; }
  statOf(kind, name, n = 1) { const t = this.stats[kind] || (this.stats[kind] = {}); t[name] = (t[name] || 0) + n; this.dirty = true; }

  /* ---- hooks on what the game already has ---- */
  hook(g) {
    const E = g.entities, self = this;
    if (E && !E.__adv) {
      E.__adv = true;
      const od = E.onDeath.bind(E);
      E.onDeath = (e, src) => { const r = od(e, src); try { self.died(e, src); } catch (err) { console.warn(err); } return r; };
      const ob = E.breed.bind(E);
      E.breed = (a, b) => { const was = a.inLove > 0 && b.inLove > 0; const r = ob(a, b); if (was) { self.event('bred_animals', { entity: a.type }); self.stat('animals_bred'); } return r; };
    }
    const H = g.hands;
    if (H && !H.__adv && H.finish) {
      H.__adv = true;
      const of = H.finish.bind(H);
      H.finish = id => { const n = nameOf(id); const r = of(id); self.event('consume_item', { item: n }); self.statOf('used', n); return r; };
    }
    const I = g.inter;
    if (I && !I.__adv) {
      I.__adv = true;
      const ob = I.onBroken;
      I.onBroken = (x, y, z, b) => { if (BLOCKS[b]) self.statOf('mined', BLOCKS[b].name); return ob ? ob(x, y, z, b) : undefined; };
    }
    const D = g.drops;
    if (D && !D.__adv) {
      D.__adv = true;
      const op = D.onPickup;
      D.onPickup = st => { if (st) self.statOf('picked_up', nameOf(st.id), st.count || 1); if (op) op(st); };
    }
    const L = lc2(), S = L && L.structures;
    if (S && !S.__adv) {
      S.__adv = true;
      const tableOf = (x, y, z) => { const e = S.chestAt && S.chestAt(x, y, z); return e ? e.table : null; };
      for (const k of ['lootAt', 'lootNow', 'findAt']) {
        const f = S[k];
        if (!f) continue;
        S[k] = (x, y, z, ...rest) => { const t = tableOf(x, y, z); if (t) self.event('player_generates_container_loot', { loot: t }); return f(x, y, z, ...rest); };
      }
    }
  }
  died(e, src) {
    if (!e.byPlayer) return;
    this.event('player_killed_entity', { entity: e.type, captain: !!e.captain });
    this.statOf('killed', e.type); this.stat('mob_kills');
  }

  /* ---- criteria ---- */
  // an event: every criterion of that trigger whose conditions it meets
  event(trigger, o) {
    for (const a of ADVANCEMENTS) {
      if (this.done[a.id] || UNFOLLOWED.has(a.id)) continue;
      for (const k in a.crit) {
        const c = a.crit[k];
        if (c.t !== trigger || this.has(a.id, k)) continue;
        if (this.meets(a, c, o)) this.grant(a, k);
      }
    }
  }
  meets(a, c, o) {
    if (c.entity && !(o.entity && c.entity.includes(o.entity))) return false;
    if (a.id === 'adventure/voluntary_exile' && !o.captain) return false;
    if (c.item && !(o.item && c.item.includes(o.item))) return false;
    if (c.loot && !(o.loot && c.loot.replace(/^chests\//, '') === String(o.loot).replace(/^chests\//, ''))) return false;
    if (c.to && o.to !== c.to) return false;
    if (c.from && o.from !== c.from) return false;
    if (c.block && o.block !== c.block) return false;
    if (c.distance && o.distance) {
      for (const ax of ['y', 'horizontal', 'absolute']) if (c.distance[ax] && c.distance[ax].min !== undefined && !(o.distance[ax] >= c.distance[ax].min)) return false;
    }
    if (c.player && !this.playerMeets(c.player, o)) return false;
    return true;
  }
  has(id, k) { return !!(this.crit[id] && this.crit[id][k]); }
  grant(a, k) {
    (this.crit[a.id] || (this.crit[a.id] = {}))[k] = 1;
    this.dirty = true;
    const req = a.req || Object.keys(a.crit).map(x => [x]);
    if (req.every(group => group.some(x => this.has(a.id, x)))) this.complete(a);
  }
  complete(a) {
    if (this.done[a.id]) return;
    this.done[a.id] = Date.now();
    this.save();
    this.toasts.push({ a, t0: 0 });
    const L = lc2(), g = this.g, chat = L && L.chat;
    const rules = g && g.rules, announce = !(rules && rules.announceAdvancements === false);
    const who = g && g.net ? g.net.name : 'Player';
    const verb = a.frame === 'challenge' ? 'has completed the challenge' : a.frame === 'goal' ? 'has reached the goal' : 'has made the advancement';
    if (chat && chat.add && announce) chat.add(who + ' ' + verb + ' [' + a.title + ']', a.frame === 'challenge' ? 0xAA00AA : 0x55FF55);
    const S = typeof window !== 'undefined' && window.__lc2sound && window.__lc2sound.Sound;
    if (S) try { S.near(a.frame === 'challenge' ? 'ui.toast.challenge_complete' : 'ui.toast.in', 1, 1, 'ui'); } catch (e) { /* no sound */ }
  }
  // what the player is, against a criterion's player conditions
  playerMeets(p, o) {
    const s = o.state || this.state;
    if (!s) return false;
    if (p.structure && !(s.structures && s.structures.includes(p.structure))) return false;
    if (p.biome && s.biome !== p.biome) return false;
    if (p.dim && s.dim !== p.dim) return false;
    if (p.y && ((p.y.max !== undefined && !(s.y <= p.y.max)) || (p.y.min !== undefined && !(s.y >= p.y.min)))) return false;
    if (p.on && !p.on.includes(s.on)) return false;
    if (p.wear) for (const slot in p.wear) if (p.wear[slot] && !p.wear[slot].includes(s.wear[slot])) return false;
    if (p.vehicle && !(s.vehicle && (p.vehicle.length === 0 || p.vehicle.includes(s.vehicle)))) return false;
    if (p.passenger && !(s.passengers && s.passengers.some(x => p.passenger.includes(x)))) return false;
    if (p.looking && !(s.looking && p.looking.includes(s.looking))) return false;
    return true;
  }

  /* ---- once a tick ---- */
  tick() {
    const L = lc2(), g = L && L.game;
    if (!g || !g.player) return;
    if (g !== this.g) this.attach(g);
    this.n++;
    const P = g.player, sv = g.survival;
    // statistics that count as you go
    if (!this.track.last) this.track.last = { x: P.pos.x, y: P.pos.y, z: P.pos.z, ground: P.onGround };
    const t = this.track, l = t.last, dx = P.pos.x - l.x, dy = P.pos.y - l.y, dz = P.pos.z - l.z, h = Math.hypot(dx, dz);
    this.stat('play_time');
    if (h < 10 && Math.abs(dy) < 10) {
      const E = g.entities, rv = E && E.riding;
      if (rv) this.stat(/boat|raft/.test(rv.type) ? 'boat_one_cm' : /minecart/.test(rv.type) ? 'minecart_one_cm' : rv.type === 'pig' ? 'pig_one_cm' : rv.type === 'strider' ? 'strider_one_cm' : 'horse_one_cm', Math.round(h * 100));
      else if (P.flying) this.stat('fly_one_cm', Math.round(Math.hypot(h, dy) * 100));
      else if (P.inWater) this.stat(P.swimming ? 'swim_one_cm' : 'walk_under_water_one_cm', Math.round(h * 100));
      else if (P.onGround) this.stat(P.sneaking ? 'crouch_one_cm' : P.sprinting ? 'sprint_one_cm' : 'walk_one_cm', Math.round(h * 100));
      else if (dy < 0) this.stat('fall_one_cm', Math.round(-dy * 100));
      if (l.ground && !P.onGround && dy > 0 && !P.flying && !P.inWater) this.stat('jump');
    }
    l.x = P.pos.x; l.y = P.pos.y; l.z = P.pos.z; l.ground = P.onGround;
    if (sv) {
      if (sv.dead && !t.dead) { this.stat('deaths'); this.event('entity_killed_player', {}); }
      t.dead = sv.dead;
      if (t.hp !== undefined && sv.health < t.hp && !sv.dead) this.stat('damage_taken', Math.round((t.hp - sv.health) * 10));
      t.hp = sv.health;
    }
    if (this.n % 20 === 0) { try { this.look(g); } catch (e) { console.warn('advancements', e); } }
    if (this.dirty && this.n % 200 === 0) this.save();
  }
  // a look round, once a second: where you are, what you carry, what you are doing
  look(g) {
    const P = g.player, W = g.world, E = g.entities, inv = g.inv, sv = g.survival;
    const x = Math.floor(P.pos.x), z = Math.floor(P.pos.z), y = P.pos.y - 64;
    const c = W.chunks.get(Math.floor(x / CH) + ',' + Math.floor(z / CH));
    const structures = c && c.structs && c.structs.structures ? c.structs.structures.map(s => s.type) : [];
    const b = W.biomeAt ? BIOMES[W.biomeAt(x, z)] : null;
    const under = W.get(x, Math.floor(P.pos.y - 0.2), z), feet = W.get(x, Math.floor(P.pos.y), z);
    const rv = E && E.riding;
    const s = this.state = {
      dim: g.dim, structures, biome: b ? b.name : '', y, on: BLOCKS[under] ? BLOCKS[under].name : (BLOCKS[feet] ? BLOCKS[feet].name : ''),
      wear: { head: inv && inv.armor[0] ? nameOf(inv.armor[0].id) : '', chest: inv && inv.armor[1] ? nameOf(inv.armor[1].id) : '',
        legs: inv && inv.armor[2] ? nameOf(inv.armor[2].id) : '', feet: inv && inv.armor[3] ? nameOf(inv.armor[3].id) : '' },
      vehicle: rv ? rv.type : null, passengers: rv ? rv.passengers.filter(p => p !== E.player && p.type).map(p => p.type) : [], looking: null,
    };
    // a spyglass: the mob nearest the middle of the view, if it is in it
    const hand = inv && inv.slots[inv.selected] ? nameOf(inv.slots[inv.selected].id) : '', off = inv && inv.offhand ? nameOf(inv.offhand.id) : '';
    if (g.inter && g.inter.useHeld && (hand === 'spyglass' || (!hand && off === 'spyglass'))) s.looking = this.lookingAt(g);
    this.event('location', { state: s });
    this.event('using_item', { item: s.looking ? 'spyglass' : '', state: s });
    // the dimension changed: entering a dimension, and a trip through the Nether
    const t = this.track;
    if (this.dim !== g.dim) {
      if (this.dim) {
        this.event('changed_dimension', { from: this.dim, to: g.dim });
        if (g.dim === 'the_nether' && this.dim === 'overworld') t.netherFrom = { x: P.pos.x, z: P.pos.z };
        if (g.dim === 'overworld' && this.dim === 'the_nether' && t.netherFrom) {
          this.event('nether_travel', { distance: { horizontal: Math.hypot(P.pos.x - t.netherFrom.x, P.pos.z - t.netherFrom.z) } });
          t.netherFrom = null;
        }
      }
      this.dim = g.dim;
    }
    // what you carry and wear
    const have = new Set(), stacks = [];
    if (inv) for (const st of [...inv.slots, ...inv.armor, inv.offhand]) if (st) { have.add(nameOf(st.id)); stacks.push(st); }
    if (this.seen) {
      if (P.inWater) have.add('@water');
      for (const n of have) if (n && !this.seen.has(n)) this.see(n);
    }
    for (const a of ADVANCEMENTS) {
      if (this.done[a.id] || UNFOLLOWED.has(a.id)) continue;
      for (const k in a.crit) {
        const cr = a.crit[k];
        if (this.has(a.id, k)) continue;
        if (cr.t === 'inventory_changed' && cr.items && cr.items.every(list => list.some(n => have.has(n)))) this.grant(a, k);
        else if (cr.t === 'filled_bucket' && cr.item && cr.item.some(n => have.has(n))) this.grant(a, k);
      }
    }
    if (stacks.some(st => st.ench && nameOf(st.id) !== 'enchanted_book')) this.event('enchanted_item', {});
    if (stacks.some(st => st.potion && !/^(water|awkward|mundane|thick)$/.test(st.potion))) this.event('brewed_potion', {});
    // effects
    if (sv && sv.effects) {
      const ef = Object.keys(sv.effects);
      if (ef.length) this.event('effects_changed', { effects: ef });
      if (sv.effects.hero_of_the_village) this.event('hero_of_the_village', {});
      // a totem: its three effects all at once, freshly
      const tot = sv.effects.regeneration && sv.effects.absorption && sv.effects.fire_resistance && sv.effects.fire_resistance.ticks > 780;
      if (tot && !t.totem) this.event('used_totem', {});
      t.totem = !!tot;
      // levitation: how far up since it began
      if (sv.effects.levitation) { if (t.levFrom === undefined) t.levFrom = P.pos.y; this.event('levitation', { distance: { y: P.pos.y - t.levFrom } }); }
      else t.levFrom = undefined;
    }
    // falling from the top of the world to the bottom
    if (P.onGround || P.inWater || P.flying) { if (t.fallFrom !== undefined && t.fallFrom - 64 >= 319 && y <= -59) this.event('fall_from_height', { distance: { y: t.fallFrom - P.pos.y }, state: s }); t.fallFrom = undefined; }
    else if (t.fallFrom === undefined || P.pos.y > t.fallFrom) t.fallFrom = P.pos.y;
    // an end gateway where you stand
    if (BLOCKS[feet] && BLOCKS[feet].name === 'end_gateway') this.event('enter_block', { block: 'end_gateway' });
    // sleeping
    if (P.sleeping && !t.slept) { this.event('slept_in_bed', {}); this.stat('sleep_in_bed'); }
    t.slept = !!P.sleeping;
    // a crossbow shot
    const shot = E && E.combat && E.combat.lastShot;
    if (shot && shot !== t.shot && shot.kind === 'crossbow') this.event('shot_crossbow', { item: 'crossbow' });
    t.shot = shot;
    // riding a strider with a warped fungus on a stick; a long ride on lava in the Overworld
    if (rv && rv.type === 'strider') {
      const held = inv && inv.slots[inv.selected] ? nameOf(inv.slots[inv.selected].id) : '';
      if (held === 'warped_fungus_on_a_stick') this.event('item_durability_changed', { item: held, state: s });
      if (rv.inLava) { if (!t.lavaFrom) t.lavaFrom = { x: P.pos.x, z: P.pos.z }; this.event('ride_entity_in_lava', { distance: { horizontal: Math.hypot(P.pos.x - t.lavaFrom.x, P.pos.z - t.lavaFrom.z) }, state: s }); }
      else t.lavaFrom = null;
    } else t.lavaFrom = null;
    // tamed animals near you that were not before; a wither come into being
    const seen = t.tamed || (t.tamed = new Set()), wither = t.withers || (t.withers = new Set());
    if (E) E.forNear(P.pos.x, P.pos.z, 16, e => {
      if (e.tamed && !seen.has(e)) { seen.add(e); if (t.tamedReady) this.event('tame_animal', { entity: e.type }); }
      if (e.type === 'wither' && !wither.has(e)) { wither.add(e); if (t.tamedReady) this.event('summoned_entity', { entity: 'wither' }); }
      if (e.type === 'iron_golem' && e.playerMade && !wither.has(e)) { wither.add(e); this.event('summoned_entity', { entity: 'iron_golem' }); }
    });
    t.tamedReady = true;
  }
  lookingAt(g) {
    const P = g.player, E = g.entities;
    if (!E) return null;
    const ex = P.pos.x, ey = P.pos.y + 1.62, ez = P.pos.z;
    const lx = -Math.sin(P.yaw) * Math.cos(P.pitch), ly = Math.sin(P.pitch), lz = -Math.cos(P.yaw) * Math.cos(P.pitch);
    let best = null, bd = 0.9995;
    for (const e of E.list) {
      if (e.removed || e.dead) continue;
      const dx = e.pos.x - ex, dy = e.pos.y + (e.h || 1) / 2 - ey, dz = e.pos.z - ez, d = Math.hypot(dx, dy, dz);
      if (d < 1 || d > 160) continue;
      const dot = (dx * lx + dy * ly + dz * lz) / d;
      if (dot > bd) { bd = dot; best = e.type; }
    }
    return best;
  }
  // shown or not on the screen: done, or its parent (or the parent's parent) done; hidden ones only when done
  visible(a) {
    if (this.done[a.id]) return true;
    if (a.hidden) return false;
    if (!a.parent) return true;
    const p = BY_ID.get(a.parent);
    if (!p) return true;
    if (this.done[p.id]) return true;
    return !!(p.parent && this.done[p.parent]);
  }
  progress(a) {
    const req = a.req || Object.keys(a.crit).map(x => [x]);
    return [req.filter(group => group.some(x => this.has(a.id, x))).length, req.length];
  }
}

/* ---- the toasts: Advancement Made! (Goal Reached!, Challenge Complete!) sliding in at the top right ---- */
const SHOW = 5000, SLIDE = 300;
function toastOverlay(p) {
  let sig = '';
  return {
    get animates() {
      const s = p.toasts.length ? p.toasts.length + ':' + Math.floor(performance.now() / 33) : '';
      if (s === sig) return false;
      sig = s;
      return true;
    },
    draw(g) {
      const now = performance.now();
      while (p.toasts.length && p.toasts[0].t0 && now - p.toasts[0].t0 > SHOW + SLIDE * 2) p.toasts.shift();
      const shown = p.toasts.slice(0, 5);
      shown.forEach((t, i) => {
        if (!t.t0) t.t0 = now;
        const age = now - t.t0;
        const slide = age < SLIDE ? age / SLIDE : age > SHOW + SLIDE ? Math.max(0, 1 - (age - SHOW - SLIDE) / SLIDE) : 1;
        const w = 160, h = 32, x = Math.round(g.width - w * slide), y = i * h;
        const L = lc2(), icons = L && L.hands && L.hands.icons;
        if (t.recipe) {
          // New Recipes Unlocked!, the new ones' results in turn
          g.fill(x, y, x + w, y + h, 0xFF555555);
          g.fill(x + 1, y + 1, x + w - 1, y + h - 1, 0xFFE0E0E0);
          g.fill(x + 2, y + 2, x + w - 2, y + h - 2, 0xFFC6C6C6);
          const id = t.ids[Math.floor(age / 1000) % t.ids.length];
          if (icons && id) icons.draw(g, id, x + 8, y + 8);
          g.text('New Recipes Unlocked!', x + 30, y + 7, 0x500050, false);
          g.text('Check your recipe book', x + 30, y + 18, 0x000000, false);
          return;
        }
        const a = t.a, challenge = a.frame === 'challenge';
        g.fill(x, y, x + w, y + h, 0xFF202020);
        g.fill(x + 1, y + 1, x + w - 1, y + h - 1, 0xFF3C3C3C);
        g.fill(x + 2, y + 2, x + w - 2, y + h - 2, 0xFF202020);
        const id = itemIdOf(a.icon);
        if (icons && id) icons.draw(g, id, x + 8, y + 8);
        g.text(challenge ? 'Challenge Complete!' : a.frame === 'goal' ? 'Goal Reached!' : 'Advancement Made!', x + 30, y + 7, challenge ? 0xFF88FF : 0xFFFF00, false);
        g.text(g.font && g.font.trim ? g.font.trim(a.title, w - 36) : a.title, x + 30, y + 18, 0xFFFFFF, false);
      });
    },
  };
}
// an item's id by its name (an item, or a block that is its own item)
export const itemIdOf = name => (I[name] !== undefined ? I[name] : 0);

let ONE = null;
export function progress() { return ONE || (ONE = new Progress()); }

/* A recipe's key, kept in the save: what it makes, and which of the recipes making that it is
   (the order they are in the game's data), so a key still means the same recipe after a rebuild. */
let KEYS = null;
function recipeKeys() {
  if (!KEYS) {
    KEYS = { byKey: new Map(), keyOf: new Map() };
    const n = new Map();
    for (const r of allRecipes()) {
      const base = nameOf(r.id) + (r.kind === 'transmute' ? '~' : ''), k = (n.get(base) || 0);
      n.set(base, k + 1);
      const key = base + (k ? '#' + k : '');
      KEYS.byKey.set(key, r); KEYS.keyOf.set(r, key);
    }
  }
  return KEYS;
}
// the recipes each item (by name) unlocks: the game's list for what the recipe makes, else its ingredients
let BY_ITEM = null;
function recipesWith(name) {
  if (!BY_ITEM) {
    BY_ITEM = new Map();
    const add = (n, r) => { let a = BY_ITEM.get(n); if (!a) BY_ITEM.set(n, a = []); if (a[a.length - 1] !== r) a.push(r); };
    for (const r of allRecipes()) {
      const list = UNLOCKS[nameOf(r.id)];
      if (list) for (const n of list) add(n, r);
      else for (const c of r.cells) if (c) for (const i of c) add(nameOf(i), r);
    }
  }
  return BY_ITEM.get(name) || [];
}

/* /recipe (give|take) <targets> (*|<recipe>), the game's replies; a recipe is named by what it makes */
register('recipe', {
  usage: '(give|take) <targets> (*|<recipe>)',
  suggest: i => (i === 0 ? ['give', 'take'] : i === 1 ? ['@s'] : i === 2 ? ['*'] : []),
  run(args, ctx) {
    const op = args[0], P = progress(), who = ctx.playerName || 'Player';
    if ((op !== 'give' && op !== 'take') || args[2] === undefined) { ctx.say('Incomplete command', 0xFF5555); return; }
    if (!/^(@s|@p|@a)$/.test(args[1]) && args[1] !== who) { ctx.say('No player was found', 0xFF5555); return; }
    if (!P.rkeys) { ctx.say('No player was found', 0xFF5555); return; }
    let list = allRecipes();
    if (args[2] !== '*') {
      const n = args[2].replace(/^minecraft:/, '');
      list = list.filter(r => nameOf(r.id) === n);
      if (!list.length) { ctx.say('Unknown recipe: ' + args[2], 0xFF5555); return; }
    }
    const k = op === 'give' ? P.unlock(list) : P.lock(list);
    P.save();
    if (!k) ctx.say(op === 'give' ? 'No recipes could be learned' : 'No recipes could be forgotten', 0xFF5555);
    else ctx.say(op === 'give' ? `Unlocked ${k} recipes for ${who}` : `Took ${k} recipes from ${who}`);
  },
});
