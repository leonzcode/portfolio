/* ---------------------------------------------------------------------------
   Leoncraft 2 - sound, joined to the game.

   main.js calls four things:
     initSound(options, gui)   at boot: the engine, the packs, the music, the
                               subtitles, the button click
     soundWorld(game, deps)    a world started: the player's sounds
     soundParts(game)          after each game.attach (a world, or a change of
                               dimension): the blocks', the mobs', the world's
     soundTick(game)           once a game tick
     soundFrame(game, camera)  once a frame (the title screen too): the listener
                               is the camera, and the music keeps time

   Almost everything here listens through hooks the game already offers
   (survival.hooks.onHurt, drops.onPickup, sim.onClick...) or by wrapping one
   method of an object at hand, so the sound code stays in this folder.
   Everything is played with the game's own volumes and pitches (see the
   notes at each, from the Minecraft Wiki and the game's sounds.json).
--------------------------------------------------------------------------- */
import { Sound } from './sound.js?v=107';
import { SoundPacks, MinecraftPack } from './packs.js?v=107';
import { blockSound, doorSound, voice, spread } from './sfx.js?v=107';
import { COVERS, INSIDE } from './blocksounds.js?v=107';
import { Music, situation } from './music.js?v=107';
import { Ambience } from './ambient.js?v=107';
import { MobSounds } from './mobsounds.js?v=107';
import { Captions } from './captions.js?v=107';
import { MusicToast } from './toast.js?v=107';
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { ITEMS } from '../items.js?v=107';
import { BIOMES } from '../biomes.js?v=107';
import { setUiSound } from '../ui/gui.js?v=107';

const R = Math.random;
const amb = new Ambience();
const mobs = new MobSounds();
let menuAcc = 0, lastNow = 0;
let options = null;

/* ---- at boot ---- */
export function initSound(opts, gui) {
  options = opts;
  Sound.init(opts);
  SoundPacks.init(new URL('../../sounds/', import.meta.url).href);
  Music.init(opts);
  Captions.init(opts);
  if (gui) { gui.overlays.push(Captions.overlay()); gui.soundPacks = SoundPacks; MusicToast.init(opts, gui); }
  // every button, as the game's widgets do: ui.button.click, volume 0.25 on the UI slider
  setUiSound(() => Sound.near('ui.button.click', 0.25, 1, 'ui'));
  // for tests and the curious
  window.__lc2sound = { Sound, SoundPacks, Music, Captions, ambience: amb, mobs, MinecraftPack };
}

/* ---- once a frame: the listener, and the title screen's music ---- */
export function soundFrame(g, camera, now) {
  if (camera) Sound.setListener(camera);
  const dt = lastNow ? Math.min(250, now - lastNow) : 16;
  lastNow = now;
  // in a world the music keeps game time (soundTick); on the title screen, real time (and none while a world loads)
  if (!g) {
    menuAcc += dt;
    while (menuAcc >= 50) { menuAcc -= 50; Music.tick(situation(null)); }
  } else menuAcc = 0;
}

/* ---- a world started ---- */
export function soundWorld(g) {
  Music.reset();
  amb.reset();
  // the world's own banks (doors, mobs, rain...) come down now
  if (SoundPacks.own) SoundPacks.own.ready.then(p => p.warm(b => b.load === 'world'));
  const st = g._sound = { md: 0, next: 1, wasIn: false, level: g.survival ? g.survival.level : 0, lastLevelUp: -1000, t: 0, portal: 0, dim: g.dim, hurtTo: null };
  const P = g.player;
  const atP = (e, v = 1, p = 1, cat = 'player') => Sound.play(e, P.pos.x, P.pos.y, P.pos.z, v, p, cat);
  // the player's hurts, death and totem (survival.js, life.js)
  const sv = g.survival;
  if (sv && sv.hooks && !sv.hooks.__snd) {
    const h = sv.hooks, oHurt = h.onHurt, oDeath = h.onDeath, oTotem = h.onTotem;
    h.__snd = true;
    h.onHurt = src => {
      try { playerHurt(g, src, atP); } catch (e) { console.warn(e); }
      if (oHurt) return oHurt(src);
    };
    h.onDeath = (m, src) => { atP('entity.player.death', 1, voice(false)); if (oDeath) return oDeath(m, src); };
    h.onTotem = () => { atP('item.totem.use', 1, 1); if (oTotem) return oTotem(); };
  }
  // the hands: eating, drinking, a burp, a tool wearing out, a goat horn (hands.js)
  const H = g.hands;
  if (H && !H.__snd) {
    H.__snd = true;
    hook(H, 'onEat', id => {
      const it = ITEMS[id], food = it && it.food;
      const ev = food && food.drink ? (it.name === 'honey_bottle' ? 'item.honey_bottle.drink' : 'entity.generic.drink') : 'entity.generic.eat';
      // the game's: 0.5 or 1 loud, pitch 1 +- 0.2
      atP(ev, 0.5 + 0.5 * ((R() * 2) | 0), spread() * 0.2 + 1);
    });
    hook(H, 'onBurp', id => { const it = ITEMS[id]; if (it && it.food && !it.food.drink) atP('entity.player.burp', 0.5, R() * 0.1 + 0.9); });
    hook(H, 'onToolBreak', s => { const it = ITEMS[s.id]; atP(it && it.name === 'shield' ? 'item.shield.break' : 'entity.item.break', 0.8, 0.8 + R() * 0.4); });
    hook(H, 'onHorn', s => atP('item.goat_horn.sound.' + ((s && s.instrument | 0) || 0), 16, 1, 'record'));
    wrapHands(g, H, atP);
  }
}

function playerHurt(g, src, atP) {
  const sv = g.survival;
  if (!sv || sv.health <= 0) return;      // the death sound instead
  const t = src && src.type;
  // a fall: small (4 and under) or big, and the block landed on
  if (t === 'fall' || t === 'stalagmite') {
    const amount = sv.lastHurt || 0, P = g.player;
    atP(amount > 4 ? 'entity.player.big_fall' : 'entity.player.small_fall', 1, 1);
    const b = g.world.get(Math.floor(P.pos.x), Math.floor(P.pos.y - 0.2), Math.floor(P.pos.z));
    if (b) blockSound('fall', b, P.pos.x, P.pos.y, P.pos.z);
  }
  const ev = t === 'drown' ? 'entity.player.hurt_drown'
    : /fire|lava|magma|hot_floor|campfire/.test(t || '') ? 'entity.player.hurt_on_fire'
    : t === 'freeze' || t === 'freezing' ? 'entity.player.hurt_freeze'
    : t === 'berry' || t === 'sweet_berry_bush' ? 'entity.player.hurt_sweet_berry_bush'
    : t === 'thorns' ? 'enchant.thorns.hit' : 'entity.player.hurt';
  atP(Sound.has(ev) ? ev : 'entity.player.hurt', 1, voice(false));
}

/* What the hands do that the game hears: placing, opening chests, tools on
   blocks, buckets, armour (wrapped on this game's Hands). */
function wrapHands(g, H, atP) {
  const at = (e, x, y, z, v = 1, p = 1, cat = 'block') => Sound.play(e, x + 0.5, y + 0.5, z + 0.5, v, p, cat);
  // a block placed from the hand: its place sound (a bucket emptied: the bucket's)
  const placed = H.placed.bind(H);
  H.placed = list => {
    try {
      if (list && list.length) {
        const [x, y, z, b] = list[0];
        if (FLUID[b] === 1) at('item.bucket.empty', x, y, z, 1, 1);
        else if (FLUID[b] === 2) at('item.bucket.empty_lava', x, y, z, 1, 1);
        else blockSound('place', b, x + 0.5, y + 0.5, z + 0.5);
      }
    } catch (e) { console.warn(e); }
    return placed(list);
  };
  // right click on a block: a chest opening, a tool changing the block
  const useOn = H.useOn.bind(H);
  H.useOn = hit => {
    const w = H.world, before = hit ? w.get(hit.x, hit.y, hit.z) : 0, held = H.held ? ITEMS[H.held.id] : null;
    const bm = hit ? w.meta(hit.x, hit.y, hit.z) : 0;
    H.__lastUse = hit ? { x: hit.x, y: hit.y, z: hit.z, b: before } : null;
    const r = useOn(hit);
    try {
      if (r && hit) {
        const after = w.get(hit.x, hit.y, hit.z), name = held ? held.name : '';
        blockUsed(hit, before, bm, after, w.meta(hit.x, hit.y, hit.z), name, at);
        if (after !== before && held) {
          const an = BLOCKS[after] ? BLOCKS[after].name : '', bn = BLOCKS[before] ? BLOCKS[before].name : '';
          if (/_hoe$/.test(name) && /farmland|dirt$/.test(an)) at('item.hoe.till', hit.x, hit.y, hit.z, 1, 1);
          else if (/_axe$/.test(name) && /^stripped_/.test(an)) at('item.axe.strip', hit.x, hit.y, hit.z, 1, 1);
          else if (/_axe$/.test(name) && /^waxed_/.test(bn)) at('item.axe.wax_off', hit.x, hit.y, hit.z, 1, 1);
          else if (/_axe$/.test(name)) at('item.axe.scrape', hit.x, hit.y, hit.z, 1, 1);
          else if (/_shovel$/.test(name) && an === 'dirt_path') at('item.shovel.flatten', hit.x, hit.y, hit.z, 1, 1);
          else if (name === 'honeycomb') at('item.honeycomb.wax_on', hit.x, hit.y, hit.z, 1, 1);
        }
      }
    } catch (e) { console.warn(e); }
    return r;
  };
  // the screens a block opens: chests, barrels, shulker boxes (the lid's sound, and the close when it shuts)
  const open = H.open;
  H.open = screen => {
    try {
      const u = H.__lastUse, d = u && BLOCKS[u.b];
      const kind = d ? (d.name === 'ender_chest' ? 'ender_chest' : /shulker_box$/.test(d.name) ? 'shulker_box' : d.name === 'barrel' ? 'barrel' : /chest$/.test(d.name) ? 'chest' : null) : null;
      if (kind && screen && 'onClosed' in screen) {
        const v = kind === 'barrel' ? 1 : 0.5;
        at('block.' + kind + '.open', u.x, u.y, u.z, v, R() * 0.1 + 0.9);
        const prev = screen.onClosed;
        screen.onClosed = () => { at('block.' + kind + '.close', u.x, u.y, u.z, v, R() * 0.1 + 0.9); if (prev) prev(); };
      }
      H.__lastUse = null;
    } catch (e) { console.warn(e); }
    return open.call(H, screen);
  };
  // a right click with the item: armour put on, a bucket filled
  const useItem = H.useItem.bind(H);
  H.useItem = hit => {
    const inv = H.inv, armor = inv.armor ? inv.armor.slice() : [];
    const held = H.held ? ITEMS[H.held.id] : null;
    const r = useItem(hit);
    try {
      if (r && inv.armor) for (let i = 0; i < inv.armor.length; i++) {
        const s = inv.armor[i];
        if (s && s !== armor[i] && (!armor[i] || armor[i].id !== s.id)) { equipSound(atP, ITEMS[s.id]); break; }
      }
      if (r && held && held.name === 'bucket') {
        const now = H.held ? ITEMS[H.held.id] : null, n = now ? now.name : '';
        // (the one filled may have gone to another slot when the stack had more than one)
        const lava = n === 'lava_bucket' || (!/water|lava|milk|powder/.test(n) && H.__filled === 'lava');
        atP(lava ? 'item.bucket.fill_lava' : /powder_snow/.test(n) ? 'item.bucket.fill_powder_snow' : 'item.bucket.fill', 1, 1);
      }
      if (r && held && held.name === 'glass_bottle') atP('item.bottle.fill', 1, 1);
    } catch (e) { console.warn(e); }
    return r;
  };
}
/* A right click that changed a block in a way with its own sound (the game's,
   at its volumes and pitches): a composter filling or emptied, a candle on a
   cake, a respawn anchor setting your spawn, dye or ink on a sign, a pumpkin
   carved, berries picked. (Changes with any cause, a charge or a candle put
   out, are heard through the world's onSet below.) */
function blockUsed(hit, b0, m0, b1, m1, held, at) {
  const n0 = BLOCKS[b0] ? BLOCKS[b0].name : '', n1 = BLOCKS[b1] ? BLOCKS[b1].name : '';
  const x = hit.x, y = hit.y, z = hit.z;
  if (n0 === 'composter' && n1 === 'composter') {
    const l0 = m0 & 15, l1 = m1 & 15;
    if (l1 > l0) at('block.composter.fill_success', x, y, z, 1, 1);
    else if (l0 === 8 && l1 === 0) at('block.composter.empty', x, y, z, 1, 1);
    else if (l0 < 7 && held) at('block.composter.fill', x, y, z, 0.3, 0.8);
  } else if (n0 === 'cake' && /candle_cake$/.test(n1)) at('block.cake.add_candle', x, y, z, 1, 1);
  else if (n0 === 'respawn_anchor' && n1 === 'respawn_anchor' && (m0 & 7) === (m1 & 7) && (m1 & 7) > 0) at('block.respawn_anchor.set_spawn', x, y, z, 1, 1);
  else if (/_sign$/.test(n0) && /_dye$|^ink_sac$|^glow_ink_sac$/.test(held)) at(held === 'ink_sac' ? 'item.ink_sac.use' : held === 'glow_ink_sac' ? 'item.glow_ink_sac.use' : 'item.dye.use', x, y, z, 1, 1);
  else if (n0 === 'pumpkin' && n1 === 'carved_pumpkin') at('block.pumpkin.carve', x, y, z, 1, 1);
  else if ((n0 === 'sweet_berry_bush' && b1 === b0 && (m1 & 3) < (m0 & 3)) || (/^cave_vines/.test(n0) && /^cave_vines/.test(n1) && m1 !== m0 && held !== 'bone_meal'))
    at(n0 === 'sweet_berry_bush' ? 'block.sweet_berry_bush.pick_berries' : 'block.cave_vines.pick_berries', x, y, z, 1, 0.8 + R() * 0.4);
}

function equipSound(atP, it) {
  if (!it) return;
  const n = it.name, m = (it.armor && it.armor.material) || '';
  const ev = n === 'elytra' ? 'item.armor.equip_elytra' : /^turtle/.test(n) ? 'item.armor.equip_turtle' : /^(leather|iron|gold|golden|diamond|netherite|chainmail|copper)/.test(n)
    ? 'item.armor.equip_' + ({ golden: 'gold', chainmail: 'chain' }[n.split('_')[0]] || n.split('_')[0]) : m ? 'item.armor.equip_' + m : 'item.armor.equip_generic';
  atP(Sound.has(ev) ? ev : 'item.armor.equip_generic', 1, 1);
}

/* ---- after each attach: the parts of one dimension ---- */
export function soundParts(g) {
  const w = g.world, sim = g.sim, E = g.entities, D = g.drops;
  const P = g.player;
  const atP = (e, v = 1, p = 1, cat = 'player') => Sound.play(e, P.pos.x, P.pos.y, P.pos.z, v, p, cat);
  // picking things up (drops.js): an item's pop, an orb's ding
  if (D) {
    hook(D, 'onPickup', () => atP('entity.item.pickup', 0.2, Math.min(2, spread() * 1.4 + 2)));
    hook(D, 'onXp', () => atP('entity.experience_orb.pickup', 0.1, spread() * 0.35 + 0.9));
  }
  // blocks breaking (the game's level event 2001: the pieces and the sound, for every cause)
  const R3 = g.renderer || (g.inter && g.inter.renderer) || (g.hands && g.hands.renderer);
  const parts = R3 && R3.particles;
  if (parts && !parts.__snd) {
    parts.__snd = true;
    const bb = parts.blockBreak.bind(parts);
    parts.blockBreak = (x, y, z, b, boxes) => { try { blockSound('brk', b, x + 0.5, y + 0.5, z + 0.5); } catch (e) {} return bb(x, y, z, b, boxes); };
  }
  // mining: the hit sound every fourth tick of wearing a block down (survival)
  const I = g.inter;
  if (I && !I.__snd) {
    I.__snd = true;
    const oh = I.onHit;
    I.onHit = (x, y, z, face, b, box) => {
      const m = I.mining;
      if (!I.creative && m && I.breakDelay === 0 && m.ticks > 0 && (m.ticks - 1) % 4 === 0 && m.x === x && m.y === y && m.z === z) blockSound('hit', b, x + 0.5, y + 0.5, z + 0.5);
      if (oh) return oh(x, y, z, face, b, box);
    };
  }
  if (sim) {
    // levers, buttons and pressure plates (sim/rsparts.js)
    hook(sim, 'onClick', (x, y, z, kind, on) => {
      const n = BLOCKS[w.get(x, y, z)] ? BLOCKS[w.get(x, y, z)].name : '';
      if (kind === 'lever') Sound.play('block.lever.click', x + 0.5, y + 0.5, z + 0.5, 0.3, on ? 0.6 : 0.5, 'block');
      else Sound.play(clickEvent(n, kind, on), x + 0.5, y + 0.5, z + 0.5, 1, 1, 'block');
    });
    hook(sim, 'onPiston', (x, y, z, out) => Sound.play(out ? 'block.piston.extend' : 'block.piston.contract', x + 0.5, y + 0.5, z + 0.5, 0.5, R() * (out ? 0.25 : 0.15) + 0.6, 'block'));
    // a note: 2^((note - 12) / 12), loud (3: heard 48 blocks away), on the Jukebox/Note Blocks slider
    hook(sim, 'onNote', (x, y, z, inst, note) => Sound.play('block.note_block.' + inst, x + 0.5, y + 0.5, z + 0.5, 3, Math.pow(2, (note - 12) / 12), 'record'));
    // any other block's sound by its event (conduits, sculk sensors and shriekers, trial spawners...)
    hook(sim, 'onSound', (ev, x, y, z, v = 1, p = 1) => Sound.play(ev, x + 0.5, y + 0.5, z + 0.5, v, p, 'block'));
    hook(sim, 'onBell', (x, y, z) => Sound.play('block.bell.use', x + 0.5, y + 0.5, z + 0.5, 2, 1, 'block'));
    hook(sim, 'onDispense', (x, y, z, ok) => Sound.play(ok ? 'block.dispenser.dispense' : 'block.dispenser.fail', x + 0.5, y + 0.5, z + 0.5, 1, ok ? 1 : 1.2, 'block'));
    hook(sim, 'onBurnout', (x, y, z) => Sound.play('block.redstone_torch.burnout', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6 + spread() * 0.8, 'block'));
    // lightning: the thunder heard everywhere (volume 10000), the strike near it
    hook(sim, 'onLightning', (x, y, z) => {
      Sound.play('entity.lightning_bolt.thunder', x + 0.5, y, z + 0.5, 10000, 0.8 + R() * 0.2, 'weather');
      Sound.play('entity.lightning_bolt.impact', x + 0.5, y, z + 0.5, 2, 0.5 + R() * 0.2, 'weather');
    });
    if (sim.primeTnt && !sim.primeTnt.__snd) {
      const pt = sim.primeTnt;
      sim.primeTnt = (x, y, z, by, fuse) => { Sound.play('entity.tnt.primed', x + 0.5, y, z + 0.5, 1, 1, 'block'); return pt(x, y, z, by, fuse); };
      sim.primeTnt.__snd = true;
    }
    if (!sim.__snd) {
      sim.__snd = true;
      const ex = sim.explode.bind(sim);
      sim.explode = (x, y, z, power, o) => { explodeSound(x, y, z); return ex(x, y, z, power, o); };
      // the held item used on a block through the simulation: flint and steel, fire charges, bone meal, shears
      const use = sim.use.bind(sim);
      sim.use = (hit, id, sneak) => {
        const held = g.inv && g.inv.heldId() ? ITEMS[g.inv.heldId()] : null, n = held ? held.name : '';
        const r = use(hit, id, sneak);
        if (r && hit) {
          if (n === 'flint_and_steel' && sim.wornHeld) Sound.play('item.flintandsteel.use', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, R() * 0.4 + 0.8, 'block');
          else if (n === 'fire_charge' && sim.usedHeld) Sound.play('item.firecharge.use', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, (R() - R()) * 0.2 + 1, 'block');
          else if (n === 'bone_meal' && sim.usedHeld) Sound.play('item.bone_meal.use', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, 1, 'block');
          else if (n === 'shears' && sim.wornHeld) Sound.play('block.beehive.shear', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, 1, 'block');
        }
        return r;
      };
    }
  }
  // doors, trapdoors and gates swinging, for any reason (a click, redstone, a villager)
  // (the simulation sets the world's listener each time it is made: ours goes on after it)
  if (w && !(w.onSet && w.onSet.__snd)) {
    const os = w.onSet;
    const f = function (x, y, z, ob, om, nb, nm) {
      if (os) os.call(this, x, y, z, ob, om, nb, nm);
      if (ob === nb && SWING[nb] && ((om ^ nm) & 4) && !(SWING[nb] === 1 && (nm & 8))) doorSound(nb, !!(nm & 4), x, y, z);
      else if (WATCH[ob] || WATCH[nb]) changed(x, y, z, ob, om, nb, nm);
    };
    f.__snd = true;
    w.onSet = f;
  }
  if (E && !E.__snd) {
    E.__snd = true;
    // creepers: the hiss as they swell
    hook(E, 'fuseSound', e => Sound.play('entity.creeper.primed', e.pos.x, e.pos.y + 1, e.pos.z, 1, 0.5, 'hostile'));
    hook(E, 'onExplode', (x, y, z) => explodeSound(x, y, z));
    // a TNT cart lit (entities/carts.js): TNT's own fizz
    hook(E, 'primedSound', e => Sound.play('entity.tnt.primed', e.pos.x, e.pos.y + 0.5, e.pos.z, 1, 1, 'block'));
    if (E.interact) {
      const ia = E.interact.bind(E);
      E.interact = e => {
        const held = E.heldName ? E.heldName() : '', type = e && e.type;
        const r = ia(e);
        try { if (r && type) interactSound(e, type, held); } catch (err) { console.warn(err); }
        return r;
      };
    }
    wrapCombat(g, E, atP);
  }
  const RL = g.realms;
  if (RL && !RL.__snd) {
    RL.__snd = true;
    const ex = RL.explode.bind(RL);
    RL.explode = (x, y, z, power, o) => { explodeSound(x, y, z); return ex(x, y, z, power, o); };
    const use = RL.use.bind(RL);
    RL.use = (hit, id) => {
      const n = ITEMS[id] ? ITEMS[id].name : '';
      const r = use(hit, id);
      if (r && hit && n === 'ender_eye') Sound.play('block.end_portal_frame.fill', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 1, 1, 'block');
      return r;
    };
  }
  // the world's loops belong to the dimension they were in
  amb.stopLoops();
}
/* Adds fn to one of the hooks the game offers (drops.onPickup, sim.onClick...),
   keeping whatever another part of the game set there: both run, the game's
   own first, and the sound's failure never stops it. Once per object and hook,
   however often the parts are joined up again. */
function hook(o, k, fn) {
  const done = o.__sndHooks || (o.__sndHooks = {});
  if (done[k]) return;
  done[k] = true;
  const prev = o[k];
  o[k] = function (...a) {
    const r = prev ? prev.apply(this, a) : undefined;
    try { fn.apply(this, a); } catch (e) { console.warn(e); }
    return r;
  };
}
// redstone doors/trapdoors/gates (1: a door, whose upper half is left out)
const SWING = new Uint8Array(4096);
for (const d of BLOCKS) if (d) SWING[d.id] = d.shape === 'door' ? 1 : (d.shape === 'trapdoor' || d.shape === 'gate') ? 2 : 0;

// blocks whose changes make a sound whatever made them: 1 sponge, 2 wet sponge, 3 composter, 4 respawn anchor, 5 a candle or candle cake, 6 end gateway
const WATCH = new Uint8Array(4096);
for (const d of BLOCKS) if (d) WATCH[d.id] = d.name === 'sponge' ? 1 : d.name === 'wet_sponge' ? 2 : d.name === 'composter' ? 3 : d.name === 'respawn_anchor' ? 4
  : (d.shape === 'candle' || /candle_cake$/.test(d.name)) ? 5 : d.name === 'end_gateway' ? 6 : 0;
function changed(x, y, z, ob, om, nb, nm) {
  const a = (e, v = 1, p = 1) => Sound.play(e, x + 0.5, y + 0.5, z + 0.5, v, p, 'block');
  const wo = WATCH[ob], wn = WATCH[nb];
  if (wo === 1 && wn === 2) a('block.sponge.absorb', 0.8, 1);
  else if (wo === 2 && wn === 1) a('block.wet_sponge.dries', 1, 0.7 + R() * 0.14);
  else if (wo === 3 && wn === 3 && (nm & 15) === 8 && (om & 15) === 7) a('block.composter.ready', 1, 1);
  else if (wo === 4 && wn === 4 && (nm & 7) !== (om & 7)) a((nm & 7) > (om & 7) ? 'block.respawn_anchor.charge' : 'block.respawn_anchor.deplete', 1, 1);
  else if (wo === 5 && wn === 5 && ob === nb && (om & 4) && !(nm & 4)) a('block.candle.extinguish', 1, 1);
  else if (wn === 6 && wo !== 6) a('block.end_gateway.spawn', 1, 0.5 + R() * 0.4);
}

function clickEvent(n, kind, on) {
  const set = /^(stone|polished_blackstone)_/.test(n) ? 'stone' : /weighted/.test(n) ? 'metal' : /^cherry_/.test(n) ? 'cherry_wood' : /^bamboo_/.test(n) ? 'bamboo_wood'
    : /^(crimson|warped)_/.test(n) ? 'nether_wood' : 'wooden';
  const e = 'block.' + set + '_' + (kind === 'plate' ? 'pressure_plate' : 'button') + (on ? '.click_on' : '.click_off');
  return Sound.has(e) ? e : 'block.' + (set === 'stone' || set === 'metal' ? 'stone' : 'wooden') + '_' + (kind === 'plate' ? 'pressure_plate' : 'button') + (on ? '.click_on' : '.click_off');
}
// the game's explosion: volume 4 (heard 64 blocks away), pitch 0.56-0.84
function explodeSound(x, y, z) { Sound.play('entity.generic.explode', x, y, z, 4, (1 + spread() * 0.2) * 0.7, 'block'); }

// a right click on a mob that did something with a sound of its own (the game's, volume 1)
function interactSound(e, type, held) {
  const at = ev => Sound.play(ev, e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, 1, 1, 'player');
  if (held === 'shears' && /^(sheep|mooshroom|snow_golem|bogged)$/.test(type)) at('entity.' + type + '.shear');
  else if (held === 'bucket' && (type === 'cow' || type === 'mooshroom' || type === 'goat')) at(type === 'goat' ? 'entity.goat.milk' : 'entity.cow.milk');
  else if (held === 'water_bucket' && /^(cod|salmon|tropical_fish|pufferfish|axolotl|tadpole)$/.test(type)) at(type === 'axolotl' ? 'item.bucket.fill_axolotl' : type === 'tadpole' ? 'item.bucket.fill_tadpole' : 'item.bucket.fill_fish');
  else if (/_dye$/.test(held) && type === 'sheep') at('item.dye.use');
  else if (type === 'creeper' && held === 'flint_and_steel') at('item.flintandsteel.use');
  else if (type === 'creeper' && held === 'fire_charge') at('item.firecharge.use');
}

// the player's swings, bows, crossbows, tridents and shield (combat/combat.js)
function wrapCombat(g, E, atP) {
  const C = E.combat;
  if (!C) return;
  const attack = C.attack.bind(C);
  C.attack = (e, spin) => {
    const before = C.lastHit;
    const r = attack(e, spin);
    const h = C.lastHit;
    if (h && h !== before) {
      const ev = h.missed || !(h.dmg > 0) ? 'entity.player.attack.nodamage' : h.knock > 0 && h.cooldown > 0.9 ? 'entity.player.attack.knockback'
        : h.crit ? 'entity.player.attack.crit' : h.sweep ? 'entity.player.attack.sweep' : h.cooldown > 0.9 ? 'entity.player.attack.strong' : 'entity.player.attack.weak';
      atP(ev, 1, 1);
      if (h.crit && h.sweep) atP('entity.player.attack.sweep', 1, 1);
    }
    return r;
  };
  if (C.fireBow) {
    const fb = C.fireBow.bind(C);
    C.fireBow = (bow, ticks) => {
      const r = fb(bow, ticks);
      let f = (ticks || 0) / 20; f = Math.min(1, (f * f + f * 2) / 3);
      if (f >= 0.1) atP('entity.arrow.shoot', 1, 1 / (R() * 0.4 + 1.2) + f * 0.5);
      return r;
    };
  }
  if (C.fireCrossbow) { const fc = C.fireCrossbow.bind(C); C.fireCrossbow = s => { const r = fc(s); atP('item.crossbow.shoot', 1, 1 / (R() * 0.5 + 1.8) + 0.63); return r; }; }
  if (C.loadCrossbow) { const lc = C.loadCrossbow.bind(C); C.loadCrossbow = s => { const r = lc(s); atP('item.crossbow.loading_end', 1, 1 / (R() * 0.5 + 1) + 0.2); return r; }; }
  if (C.throwTrident) {
    const tt = C.throwTrident.bind(C);
    C.throwTrident = s => {
      const spin = C.spin;
      const r = tt(s);
      // riptide: the level's own whoosh (III and up share the third), where it did fling you
      const lvl = s && s.ench ? (s.ench.riptide | 0) : 0;
      if (lvl > 0) { if (C.spin === 20 && C.spin !== spin) atP('item.trident.riptide_' + Math.min(3, lvl), 1, 1); }
      else atP('item.trident.throw', 1, 1);
      return r;
    };
  }
  if (C.lunge) { const lu = C.lunge.bind(C); C.lunge = s => { const r = lu(s); if (r) atP('item.spear.lunge_' + r, 1, 1); return r; }; }
  if (C.blocked) { const bl = C.blocked.bind(C); C.blocked = (amount, src) => { const r = bl(amount, src); atP(src && src.axe ? 'item.shield.break' : 'item.shield.block', src && src.axe ? 0.8 : 1, 0.8 + R() * 0.4); return r; }; }  // an axe putting the shield down: the break sound (the game's entity event 30)
  // thrown things: snowballs, eggs, pearls (the game: 0.5, 0.4 / (0.8-1.2))
  if (E.useHeld) {
    const uh = E.useHeld.bind(E);
    E.useHeld = target => {
      const it = g.inv && g.inv.heldId() ? ITEMS[g.inv.heldId()] : null, n = it ? it.name : '';
      const r = uh(target);
      if (r && THROWN[n]) atP(THROWN[n], 0.5, 0.4 / (R() * 0.4 + 0.8), n === 'ender_pearl' ? 'neutral' : 'neutral');
      return r;
    };
  }
}
const THROWN = { snowball: 'entity.snowball.throw', egg: 'entity.egg.throw', ender_pearl: 'entity.ender_pearl.throw', splash_potion: 'entity.splash_potion.throw', lingering_potion: 'entity.lingering_potion.throw', experience_bottle: 'entity.experience_bottle.throw', ender_eye: 'entity.ender_eye.launch' };

/* ---- once a game tick ---- */
/* Minecarts rolling (the game's minecart sound): a held loop on each cart that moves, louder and higher the
   faster it goes (from nothing at rest to 0.7 and pitch 0.7 to 1.2 at half a block a tick and over); riding,
   the sound from inside it (entity.minecart.inside, under water .inside.underwater, when the sounds have them). */
const CART_RANGE = 24;
function carts(E, st, eye) {
  const list = st.carts || (st.carts = new Map());
  const seen = new Set();
  for (const e of E.list) {
    if (!/minecart$/.test(e.type) || e.removed || e.dead) continue;
    if (eye && (e.pos.x - eye.x) ** 2 + (e.pos.y - eye.y) ** 2 + (e.pos.z - eye.z) ** 2 > CART_RANGE * CART_RANGE) continue;
    seen.add(e);
    const sp = Math.min(0.5, Math.hypot(e.vel.x, e.vel.z)), k = sp >= 0.01 ? sp / 0.5 : 0;
    const inside = E.riding === e;
    const want = inside ? (e.inWater && Sound.has('entity.minecart.inside.underwater') ? 'entity.minecart.inside.underwater'
      : Sound.has('entity.minecart.inside') ? 'entity.minecart.inside' : 'entity.minecart.riding') : 'entity.minecart.riding';
    let c = list.get(e);
    if (c && (c.ev !== want || c.h.stopped)) { c.h.stop(); c = null; list.delete(e); }
    if (!c) {
      if (k <= 0) continue;
      const h = Sound.loop(want, 'neutral', { at: inside ? null : [e.pos.x, e.pos.y, e.pos.z], volume: 0.01 });
      if (!h) continue;
      c = { h, ev: want };
      list.set(e, c);
    }
    c.h.setVolume(0.7 * k, 0.1);
    c.h.pitch(0.7 + 0.5 * k);
    if (!inside) c.h.pos(e.pos.x, e.pos.y, e.pos.z);
  }
  for (const [e, c] of list) if (!seen.has(e)) { c.h.stop(); list.delete(e); }
}

export function soundTick(g) {
  const st = g._sound;
  if (!st || !g.player) return;
  st.t++;
  const P = g.player, w = g.world;
  const playing = g.mode !== 'spectator';
  if (playing) playerSteps(g, st, P, w);
  try { playerThings(g, st, P); } catch (e) { console.warn(e); }
  // the level up: every fifth level, at most once in 5 seconds, louder up to level 30
  const sv = g.survival;
  if (sv) {
    if (sv.level > st.level && sv.level % 5 === 0 && st.t - st.lastLevelUp > 100) {
      Sound.play('entity.player.levelup', P.pos.x, P.pos.y, P.pos.z, Math.min(1, sv.level / 30) * 0.75, 1, 'player');
      st.lastLevelUp = st.t;
    }
    st.level = sv.level;
  }
  // a portal: the whoosh as its swirl starts, and the arrival on the other side (heard where you are, quietly)
  const RL = g.realms;
  if (RL) {
    if (RL.portalTime > 0 && st.portal === 0) Sound.near('block.portal.trigger', 0.25, R() * 0.4 + 0.8, 'ambient');
    st.portal = RL.portalTime || 0;
  }
  if (st.dim !== g.dim) {
    if (st.dim && (st.dim === 'the_nether' || g.dim === 'the_nether')) Sound.near('block.portal.travel', 0.25, R() * 0.4 + 0.8, 'ambient');
    st.dim = g.dim;
    amb.reset();
  }
  if (g.details) jukeboxes(g.details);
  const eye = Sound.listener;
  amb.tick(g, eye);
  if (g.entities) mobs.tick(g.entities, eye);
  if (g.entities) carts(g.entities, st, eye);
  // the music for where you are
  const bm = BIOMES[w.biomeAt(Math.floor(P.pos.x), Math.floor(P.pos.z))];
  Music.tick(situation({
    creative: g.mode === 'creative' && P.canFly, dim: g.dim, biome: bm ? bm.name : '',
    eyeInWater: !!P.eyeInWater, waterBiome: !!(bm && /ocean|river/.test(bm.name)),
    dragonAlive: !!(RL && RL.boss),
  }));
}

/* What the player is doing that sounds while it lasts: the breath meter's
   bubbles popping, the wind of gliding, a spyglass going up and down, a
   crossbow being wound, a bundle tipped out. */
function playerThings(g, st, P) {
  const sv = g.survival, H = g.hands, C = g.entities && g.entities.combat;
  // the breath meter: a pop for each bubble that goes, 0.5 loud for the first three then 0.1 more a bubble, pitch 1 for five then 0.1 higher a bubble
  if (sv && typeof sv.air === 'number') {
    const left = Math.max(0, Math.ceil(sv.air / 30)), was = st.bubbles ?? left;
    if (left < was && !sv.dead && g.mode !== 'creative') {
      const k = 10 - left;
      Sound.near('ui.hud.bubble_pop', 0.5 + 0.1 * Math.max(0, k - 3), 1 + 0.1 * Math.max(0, k - 5), 'player');
    }
    st.bubbles = left;
  }
  // gliding: the wind, louder the faster (by the speed squared, as the game does), coming in over the first two seconds
  if (P.gliding) {
    st.glideT = (st.glideT || 0) + 1;
    if (!st.glide || st.glide.stopped) st.glide = Sound.loop('item.elytra.flying', 'player', { volume: 0.01 });
    const v2 = P.vel.x * P.vel.x + P.vel.y * P.vel.y + P.vel.z * P.vel.z;
    let vol = v2 >= 1e-7 ? Math.min(1, v2 / 4) : 0;
    if (st.glideT < 20) vol = 0; else if (st.glideT < 40) vol *= (st.glideT - 20) / 20;
    if (st.glide) { st.glide.setVolume(Math.max(0.0001, vol), 0.05); st.glide.pitch(vol > 0.8 ? 1 + (vol - 0.8) : 1); }
  } else if (st.glide) { st.glide.stop(); st.glide = null; st.glideT = 0; }
  // a spyglass up to the eye and down again
  const scoped = !!(H && H.inter && H.inter.useHeld && H.spyglassSide && H.spyglassSide() >= 0);
  if (scoped !== !!st.scoped) Sound.play(scoped ? 'item.spyglass.use' : 'item.spyglass.stop_using', P.pos.x, P.pos.y, P.pos.z, 1, 1, 'player');
  st.scoped = scoped;
  // a crossbow winding: the start a fifth of the way (Quick Charge's own sound for one with it), the middle at half, 0.5 loud
  const u = C && C.use;
  if (u && u.kind === 'crossbow') {
    const s = g.inv && g.inv.slots[u.slot], total = s && C.crossbowTicks ? C.crossbowTicks(s) : 25;
    const f0 = (u.t - 1) / Math.max(1, total), f1 = u.t / Math.max(1, total), q = Math.round((25 - total) / 5);
    if (f0 < 0.2 && f1 >= 0.2) Sound.play(q > 0 ? 'item.crossbow.quick_charge_' + Math.min(3, q) : 'item.crossbow.loading_start', P.pos.x, P.pos.y, P.pos.z, 0.5, 1, 'player');
    if (f0 < 0.5 && f1 >= 0.5) Sound.play('item.crossbow.loading_middle', P.pos.x, P.pos.y, P.pos.z, 0.5, 1, 'player');
  }
  // a bundle tipped out: the first throw of what is in it
  const bu = H && H.using && H.using.bundle;
  if (bu && !st.bundle) Sound.play('item.bundle.drop_contents', P.pos.x, P.pos.y, P.pos.z, 0.8, 0.8 + R() * 0.4, 'player');
  st.bundle = !!bu;
}

/* The player's footsteps and swimming (the game's Entity.move): every
   1/0.6 blocks travelled (3D on a ladder), a step on the block under the
   feet, or swimming where the feet are in water and off the ground.
   Sneaking on the ground and flying make no steps. */
function playerSteps(g, st, P, w) {
  const riding = g.entities && g.entities.riding;
  const dx = P.pos.x - P.prev.x, dy = P.pos.y - P.prev.y, dz = P.pos.z - P.prev.z;
  // entering water: a splash, louder for a faster fall
  if (P.inWater && !st.wasIn && st.t > 2 && !riding) {
    const f = Math.min(1, Math.sqrt(P.vel.x * P.vel.x * 0.2 + P.vel.y * P.vel.y + P.vel.z * P.vel.z * 0.2) * 0.2);
    Sound.play(f < 0.25 ? 'entity.player.splash' : 'entity.player.splash.high_speed', P.pos.x, P.pos.y, P.pos.z, Math.max(0.05, f), 1 + spread() * 0.4, 'player');
  }
  st.wasIn = P.inWater;
  if (riding || P.flying || P.noclip) return;
  const climbing = P.climbing;
  st.md += (climbing ? Math.sqrt(dx * dx + dy * dy + dz * dz) : Math.sqrt(dx * dx + dz * dz)) * 0.6;
  if (st.md <= st.next) return;
  const fx = Math.floor(P.pos.x), fz = Math.floor(P.pos.z);
  const under = w.get(fx, Math.floor(P.pos.y - 0.2), fz);
  const feet = w.get(fx, Math.floor(P.pos.y + 0.001), fz);
  if (!under && !(climbing && feet)) return;
  if ((P.onGround || climbing) && !P.swimming) {
    st.next = Math.floor(st.md) + 1;
    if (P.onGround && P.sneaking) return;           // creeping makes no sound
    if (climbing && feet) { blockSound('step', feet, P.pos.x, P.pos.y, P.pos.z); return; }
    const above = w.get(fx, Math.floor(P.pos.y - 0.2) + 1, fz);
    if (COVERS[above] && !FLUID[above]) {
      // a carpet or a snow layer heard over the floor under it
      blockSound('step', above, P.pos.x, P.pos.y, P.pos.z);
      if (under) blockSound('step', under, P.pos.x, P.pos.y, P.pos.z, 0.05 / 0.15, 0.8);
    } else if (INSIDE[feet]) blockSound('step', feet, P.pos.x, P.pos.y, P.pos.z);
    else if (under && !FLUID[under]) blockSound('step', under, P.pos.x, P.pos.y, P.pos.z);
    return;
  }
  if (P.inWater) {
    st.next = Math.floor(st.md) + 1;
    const f = Math.min(1, Math.sqrt(P.vel.x * P.vel.x * 0.2 + P.vel.y * P.vel.y + P.vel.z * P.vel.z * 0.2) * 0.35);
    Sound.play('entity.player.swim', P.pos.x, P.pos.y, P.pos.z, f, 1 + spread() * 0.4, 'player');
  }
}

/* Jukeboxes: a disc going in plays its song from the jukebox (volume 4, so
   heard 64 blocks away, on the Jukebox/Note Blocks slider); taking it out,
   or breaking the jukebox, stops it. (details.js keeps the discs.) */
const records = new Map();     // "x,y,z" -> { voice, disc }
function jukeboxes(D) {
  const seen = new Set();
  for (const e of D.map.values()) {
    if (e.k !== 'jukebox') continue;
    const k = e.x + ',' + e.y + ',' + e.z;
    const id = e.disc ? e.disc.id : 0, r = records.get(k);
    if (r && r.disc !== id) { Sound.stop(r.voice); records.delete(k); }
    if (id && !records.has(k) && (e.t | 0) <= 2) {
      const it = ITEMS[id], ev = it ? it.name.replace(/^music_disc_/, 'music_disc.') : '';
      const voice = ev && Sound.stream(ev, 'record', { at: [e.x + 0.5, e.y + 0.5, e.z + 0.5], volume: 4 });
      if (voice) records.set(k, { voice, disc: id });
    }
    if (records.has(k)) seen.add(k);
  }
  for (const [k, r] of records) if (!seen.has(k)) { Sound.stop(r.voice); records.delete(k); }
}

/* ---- leaving a world ---- */
export function soundLeave() {
  mobs.reset();
  for (const r of records.values()) Sound.stop(r.voice);
  records.clear();
  amb.reset();
  Sound.stopAll();
  Music.reset();
}
export { Sound, SoundPacks, Music };
