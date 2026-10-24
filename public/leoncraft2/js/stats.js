/* ---------------------------------------------------------------------------
   Leoncraft 2 - statistics, one world's worth, kept with the world's save
   and shown by the game menu's Statistics button (ui/stats.js).

   main.js calls:
     statsWorld(game, saved)   a world started: its counts from the save
     statsTick(game)           once a game tick, after everything else moved
     statsState()              what goes into the save
     statsQuit()               Save and Quit (Games Quit), before the last save
     statsLeave()              leaving the world
     openStatistics(gui, icons)

   Counted as the game counts them (the Minecraft Wiki's Statistics page):
   time played and since the last death and rest, sneak time; distances by
   way of moving, measured each tick from where you were (riding by what you
   ride, swimming, walking under or on water, climbing, walking, sprinting,
   crouching, gliding, and flown for more than 25 cm a tick in the air);
   jumps, falls of 2 blocks or more; damage dealt, taken and absorbed; deaths,
   mob kills, animals bred, times slept; chests, barrels, ender chests and
   shulker boxes opened, dispensers, droppers and hoppers searched, and the
   work blocks used; villagers talked to and traded with; note blocks
   tuned, discs played, plants potted, cauldrons filled and taken from,
   armour, banners and shulker boxes cleaned, cake eaten, bells rung; raids
   triggered and won. The Items page counts blocks mined, items crafted,
   used, broken, picked up and dropped; the Mobs page what you killed and
   what killed you.

   Like the sound and advancement code, it joins the game by wrapping a
   method or hook of objects at hand (looked at each tick, so a new
   dimension's mobs and drops are joined as soon as they exist).
--------------------------------------------------------------------------- */
import { BLOCKS } from './blocks.js?v=107';
import { ITEMS, itemId, maxDamage } from './items.js?v=107';

const nameOf = id => (ITEMS[id] ? ITEMS[id].name : BLOCKS[id] ? BLOCKS[id].name : '');
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);

// opening a block's screen: the statistic it counts
const OPENS = {
  chest: 'open_chest', trapped_chest: 'open_chest', barrel: 'open_barrel', ender_chest: 'open_enderchest',
  dispenser: 'inspect_dispenser', dropper: 'inspect_dropper', hopper: 'inspect_hopper',
  anvil: 'interact_with_anvil', chipped_anvil: 'interact_with_anvil', damaged_anvil: 'interact_with_anvil',
  beacon: 'interact_with_beacon', blast_furnace: 'interact_with_blast_furnace', brewing_stand: 'interact_with_brewingstand',
  cartography_table: 'interact_with_cartography_table', crafting_table: 'interact_with_crafting_table', furnace: 'interact_with_furnace',
  grindstone: 'interact_with_grindstone', lectern: 'interact_with_lectern', loom: 'interact_with_loom',
  smithing_table: 'interact_with_smithing_table', smoker: 'interact_with_smoker', stonecutter: 'interact_with_stonecutter',
};
const openStat = n => OPENS[n] || (/shulker_box$/.test(n) ? 'open_shulker_box' : /copper_chest$/.test(n) ? 'open_chest' : null);
const RIDE = [[/minecart/, 'minecart_one_cm'], [/boat|raft/, 'boat_one_cm'], [/^pig$/, 'pig_one_cm'], [/^strider$/, 'strider_one_cm'],
  [/^happy_ghast$/, 'happy_ghast_one_cm'], [/nautilus$/, 'nautilus_one_cm'], [/horse|donkey|mule|camel|llama/, 'horse_one_cm']];

export class Stats {
  constructor(saved) {
    const s = saved || {};
    this.custom = Object.assign({}, s.custom);
    for (const k of ['mined', 'crafted', 'used', 'broken', 'picked_up', 'dropped', 'killed', 'killed_by']) this[k] = Object.assign({}, s[k]);
    this.t = { last: null, dead: false, sleeping: false };
  }
  toJSON() {
    const o = { custom: this.custom };
    for (const k of ['mined', 'crafted', 'used', 'broken', 'picked_up', 'dropped', 'killed', 'killed_by']) o[k] = this[k];
    return o;
  }
  add(k, n = 1) { if (n > 0) this.custom[k] = (this.custom[k] || 0) + n; }
  of(kind, name, n = 1) { if (name && n > 0) { const t = this[kind]; t[name] = (t[name] || 0) + n; } }

  /* ---- each tick ---- */
  tick(g) {
    const P = g.player, sv = g.survival, t = this.t, E = g.entities;
    if (!P) return;
    hook(g, this);
    const alive = !(sv && sv.dead);
    this.add('play_time'); this.add('total_world_time');
    if (alive) this.add('time_since_death');
    if (P.sneaking) this.add('sneak_time');
    if (!P.sleeping) this.add('time_since_rest');
    else if (!t.sleeping) { this.add('sleep_in_bed'); this.custom.time_since_rest = 0; }
    t.sleeping = !!P.sleeping;
    // a death: the count, and what did it (survival.js keeps the last attacker for 5 seconds)
    if (sv && sv.dead && !t.dead) {
      this.add('deaths');
      this.custom.time_since_death = 0; this.custom.time_since_rest = 0;
      const k = sv.attacker && sv.age - sv.attackerAge <= 100 ? sv.attacker : null;
      if (k && !k.isPlayer && k.type) this.of('killed_by', k.type);
    }
    t.dead = !!(sv && sv.dead);
    // how you moved this tick: your own step (player.js keeps where it started, so a teleport is no distance),
    // or, riding, how far what you ride carried you since the last tick
    const l = t.last || (t.last = { x: P.pos.x, y: P.pos.y, z: P.pos.z });
    const rv = E && E.riding, from = rv ? l : P.prev;
    const dx = P.pos.x - from.x, dy = P.pos.y - from.y, dz = P.pos.z - from.z;
    l.x = P.pos.x; l.y = P.pos.y; l.z = P.pos.z;
    if (alive && Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 10) {
      const h = Math.round(Math.hypot(dx, dz) * 100), d3 = Math.round(Math.hypot(dx, dy, dz) * 100);
      if (rv) {
        const r = RIDE.find(([re]) => re.test(rv.type || ''));
        if (r) this.add(r[1], d3);
      } else if (P.swimming) this.add('swim_one_cm', d3);
      else if (P.eyeInWater) this.add('walk_under_water_one_cm', d3);
      else if (P.inWater) this.add('walk_on_water_one_cm', h);
      else if (P.climbing) { if (dy > 0) this.add('climb_one_cm', Math.round(dy * 100)); }
      else if (P.onGround) this.add(P.sprinting ? 'sprint_one_cm' : P.sneaking ? 'crouch_one_cm' : 'walk_one_cm', h);
      else if (P.gliding) this.add('aviate_one_cm', d3);
      else if (h > 25) this.add('fly_one_cm', h);
    }
  }
}

/* ---- the hooks ---- */
// obj[k] runs f(orig, args) instead, once; done again if something else has since been put there
function wrap(o, k, f) {
  if (!o) return;
  const cur = o[k];
  if (cur && cur.__stats) return;
  const orig = cur ? (...b) => cur.apply(o, b) : null;
  const w = (...a) => f(orig, a);
  w.__stats = true;
  o[k] = w;
}
const survivalMode = g => g.mode === 'survival' || g.mode === 'adventure';
const heldName = g => { const inv = g.inv, s = inv && inv.slots[inv.selected]; return s ? nameOf(s.id) : ''; };
const damageable = name => { const id = name ? itemId(name) : 0; return !!(id && maxDamage(id) > 0); };
let using = null;      // the block (or mob) a right click is on, while it is being handled

function hook(g, S) {
  const E = g.entities, H = g.hands, I = g.inter, D = g.drops, sv = g.survival, gui = lc2() && lc2().gui, P = g.player;
  // a jump: the player marks its own (player.js `jumped`, which survival.js reads for the exhaustion and clears)
  if (P && !P.__statsJump) {
    P.__statsJump = true;
    let j = !!P.jumped;
    Object.defineProperty(P, 'jumped', { configurable: true, get: () => j, set: v => { if (v && !j && ONE) ONE.add('jump'); j = !!v; } });
  }
  // a landing: counted as player.js records it (survival.js spends it for the fall damage before this tick runs),
  // after a fall of 2 blocks or more, and not where you could fly
  if (P && !P.__statsLand) {
    P.__statsLand = true;
    let l = P.landed;
    Object.defineProperty(P, 'landed', { configurable: true, get: () => l, set: v => {
      if (v && v !== l && v.dist >= 2 && !P.canFly && ONE) ONE.add('fall_one_cm', Math.round(v.dist * 100));
      l = v;
    } });
  }
  if (E) {
    // a kill: mob kills (or player kills) and the mob's own count
    wrap(E, 'onDeath', (orig, [e, src]) => {
      const r = orig(e, src);
      const by = !!(src && (src.player || (src.attacker && src.attacker.isPlayer))) || (e.lastHurtByPlayer !== undefined && e.m && e.m.age - e.lastHurtByPlayer < 100);
      if (by && e && !e.isPlayer && e.type) { S.add(e.type === 'player' ? 'player_kills' : 'mob_kills'); S.of('killed', e.type); }
      return r;
    });
    wrap(E, 'breed', (orig, [a, b]) => { const was = a && b && a.inLove > 0 && b.inLove > 0; const r = orig(a, b); if (was) S.add('animals_bred'); return r; });
    // a right click on a mob: a villager's or a wandering trader's screen is talking to them
    wrap(E, 'interact', (orig, [e]) => { using = e ? { mob: e.type } : null; try { return orig(e); } finally { using = null; } });
    const C = E.combat;
    if (C) wrap(C, 'attack', (orig, a) => {
      const before = C.lastHit, held = heldName(g);
      const r = orig(...a);
      const h = C.lastHit;
      if (h && h !== before && !h.missed) {
        S.add('damage_dealt', Math.round(Math.max(0, (h.before || 0) - Math.max(0, h.after || 0)) * 10));
        if (survivalMode(g) && damageable(held)) S.of('used', held);
      }
      return r;
    });
  }
  if (sv) wrap(sv, 'actuallyHurt', (orig, [src, amount]) => {
    const hp = sv.health, ab = sv.absorption;
    const r = orig(src, amount);
    S.add('damage_taken', Math.round(Math.max(0, hp - sv.health) * 10));
    S.add('damage_absorbed', Math.round(Math.max(0, ab - sv.absorption) * 10));
    return r;
  });
  if (H) {
    // blocks put down, things eaten and drunk: used
    wrap(H, 'placed', (orig, [list]) => { const n = heldName(g); const r = orig(list); if (n) S.of('used', n); return r; });
    wrap(H, 'finish', (orig, [id]) => { const r = orig(id); S.of('used', nameOf(id)); return r; });
  }
  if (I) {
    // a block broken in survival: mined, and the tool used
    wrap(I, 'onBroken', (orig, [x, y, z, b]) => {
      if (survivalMode(g) && BLOCKS[b]) { S.of('mined', BLOCKS[b].name); const n = heldName(g); if (damageable(n)) S.of('used', n); }
      return orig ? orig(x, y, z, b) : undefined;
    });
    // a right click on a block: the screen it opens, and what it did to the block
    wrap(I, 'useWith', (orig) => {
      const h = I.target && I.target.face ? I.target : null, w = g.world;
      if (!h || !w) return orig();
      const b0 = w.get(h.x, h.y, h.z), m0 = w.meta(h.x, h.y, h.z), n0 = BLOCKS[b0] ? BLOCKS[b0].name : '', held = heldName(g);
      const st0 = g.inv && g.inv.slots[g.inv.selected], sig0 = st0 ? JSON.stringify(st0) : '';
      using = { block: n0 };
      let r;
      try { r = orig(); } finally { using = null; }
      if (!r) return r;
      const b1 = w.get(h.x, h.y, h.z), m1 = w.meta(h.x, h.y, h.z), n1 = BLOCKS[b1] ? BLOCKS[b1].name : '';
      const st1 = g.inv && g.inv.slots[g.inv.selected], changed = (st1 ? JSON.stringify(st1) : '') !== sig0;
      if (n0 === 'note_block' && m1 !== m0) S.add('tune_noteblock');
      else if (n0 === 'jukebox' && /^music_disc_/.test(held) && changed) S.add('play_record');
      else if (n0 === 'flower_pot' && n1 !== n0) S.add('pot_flower');
      else if (n0 === 'cauldron' && n1 === 'water_cauldron') S.add('fill_cauldron');
      else if (n0 === 'water_cauldron') {
        if (/^(bucket|glass_bottle)$/.test(held) && changed) S.add('use_cauldron');
        else if (changed && /^leather_|_horse_armor$/.test(held)) S.add('clean_armor');
        else if (changed && /_banner$/.test(held)) S.add('clean_banner');
        else if (changed && /shulker_box$/.test(held)) S.add('clean_shulker_box');
      } else if (/(^|_)cake$/.test(n0) && (n1 !== n0 || m1 !== m0)) S.add('eat_cake_slice');
      else if (n0 === 'bell') S.add('bell_ring');
      return r;
    });
  }
  if (D) {
    wrap(D, 'onPickup', (orig, [st]) => { if (st) S.of('picked_up', nameOf(st.id), st.count || 1); return orig ? orig(st) : undefined; });
    wrap(D, 'throwFrom', (orig, [who, st, ...rest]) => {
      if (who === g.player && st) { S.add('drop'); S.of('dropped', nameOf(st.id), st.count || 1); }
      return orig(who, st, ...rest);
    });
  }
  if (g.inv && !g.inv.__stats) { g.inv.__stats = true; g.inv.on('broke', s => { if (ONE && s) ONE.of('broken', nameOf(s.id)); }); }
  // a screen opened by a right click: the block's or the villager's statistic; anything made in it, crafted
  if (gui) wrap(gui, 'open', (orig, [screen]) => {
    const u = using, r = orig(screen);
    if (ONE && screen && lc2().game) {
      if (u && u.block) { const k = openStat(u.block); if (k) ONE.add(k); }
      if (u && u.mob && /^(villager|wandering_trader)$/.test(u.mob)) ONE.add('talked_to_villager');
      if (screen.craftOnce && !screen.craftOnce.__stats) wrap(screen, 'craftOnce', (o, a) => {
        const out = o(...a);
        if (out && ONE) { ONE.of('crafted', nameOf(out.id), out.count || 1); if (screen.offers && screen.v) ONE.add('traded_with_villager'); }
        return out;
      });
    }
    return r;
  });
  // raids triggered and won (entities/raids.js)
  const R = lc2() && lc2().structures && lc2().structures.spawners && lc2().structures.spawners.raids;
  if (R) {
    wrap(R, 'start', (orig, a) => { const was = R.raid; const r = orig(...a); if (ONE && R.raid && R.raid !== was) ONE.add('raid_trigger'); return r; });
    wrap(R, 'victory', (orig, a) => { const heroes = R.raid && R.raid.heroes; const r = orig(...a); if (ONE && heroes) ONE.add('raid_win'); return r; });
  }
}

let ONE = null;
export function stats() { return ONE; }
export function statsWorld(g, saved) { ONE = new Stats(saved); g.stats = ONE; }
export function statsTick(g) { if (ONE && g) ONE.tick(g); }
export function statsState() { return ONE ? ONE.toJSON() : undefined; }
export function statsQuit() { if (ONE) ONE.add('leave_game'); }
export function statsLeave() { ONE = null; }
export function openStatistics(gui, icons) {
  if (!ONE || !gui) return false;
  import('./ui/stats.js?v=107').then(m => gui.open(new m.StatisticsScreen(ONE, icons))).catch(e => console.warn('statistics', e));
  return true;
}
