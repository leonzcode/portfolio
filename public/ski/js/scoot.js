// The snow scooter (a snowscoot): a stunt scooter's deck, neck, fork and bars on two short boards, ridden standing,
// both hands on the bars (models/scoot/scoot.glb: "street scooter" by JamesFowler and the snowboard's board, both CC BY;
// see CREDITS.md), and the snowbike (a ski bike, models/bike/bike.glb: "BMX Bike" by erdmdgdln and the board, CC BY),
// sat on the saddle with the feet on footpegs on the frame. Registered with the rig like the board (Rig.loader.scoot,
// Rig.poser.scoot, and the same for bike).
//   Frames: the physics' body frame (skier.q) is the vehicle's: +Z forward, +Y up, +X the rider's left; the rider faces
//   forward, on the scooter the left foot in front on the deck, the back foot turned out behind it.
//   Each model has two parts: 'deck' (the scooter's deck, neck and rear board; the bike's 'frame', saddle and rear ski)
//   and 'steer' (stem, bars, fork and front board or ski) turning about the steering axis (its local +Y), so the bars
//   steer, and bar spins and tailwhips are turns about that axis.
/* Tricks (X, 2026-11-05, for "more snowscooter and snowbike tricks that actually look different from each other ...
   tailwhips, bar spins, briflips, buttercups, inwards, superman and different grabs", then "kickless" and "shifties").
   As scooter, BMX and FMX riders name them (scootering's tricktionaries: Scooter Resource's, Stuntstep's; Land The
   Trick; Pro Scooter's bri flip page; Vincent Kudrna's front bri):
     Timed, a part going all the way round (skier.js RIDE_ACTS; a key starts one, held it goes round again):
       Tailwhip      the deck kicked backwards round the bars' axis, the feet lifted while it goes round under them
       Kickless      the deck pushed out in front (the heelwhip way) and carried round by the arms swinging the bars, the
                     feet tucked up, no kick
       Barspin       the bars let go and spun a full turn while the deck stays under the feet
       Briflip       the bars turned a quarter and the whole scooter flipped backwards round them, up over the shoulder
                     (Brian Boston's, "a scooter flip and an X-up together")
       Inward Bri    the briflip the other way, the scooter flipped forwards over the shoulder (front bri)
       Finger Whip   one hand down to the deck, spinning it round
       Buttercup     a tailwhip to a briflip to a tailwhip (Raymond Warner's)
     Held, like grabs: No Hander (arms out wide), Suicide No Hander (hands behind the back), Tuck No Hander (knees up to
       the bars), No Footer (legs out to the sides), Can Can (one leg across the deck), Nac Nac (one leg kicked back over
       the tail), Superman (legs straight out behind, arms straight to the bars), X-Up (bars turned half round, arms
       crossed), Toboggan (one hand on the tail, the nose pointed down, bars turned), Table Top (the scooter laid flat)
     The snowbike adds the FMX ones: Whip (the bike thrown sideways), Heel Clicker (heels clicked over the bars),
       Cliffhanger (stood up on the bars, toes hooked under them, hands up), Lazy Boy (lying back on the saddle, feet
       under the bars, arms back), Kiss of Death (a handstand on the bars), Indian Air (legs running in the air)
     Shifties (Shift or A / D in the air, skier.shift): the vehicle turned across under the body and back. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rig, springBank, smooth01, softReach, wob } from './rig.js?v=26';
import { RIDE_GRABS, RIDE_GUIDES, seatRider, holdOnLift, liftStand } from './board.js?v=26';
import { clamp, smoothstep } from './noise.js?v=26';
import { RIDE_SPIN, RIDE_WORDS } from './tricks.js?v=26';
import { RIDE_ACTS } from './skier.js?v=26';
import { height } from './terrain.js?v=26';
import * as INPUT from './input.js?v=26';      // (P: RIDE_KEYS, the rides' own key tables)

// where things are on the model (from tools/makescoot.py's printout): the deck's top, the feet on it, the grips on the
// bars (in the steering part's own frame, up its axis), how far the boards' bases sit under the feet's frame
export const SCOOT = { half: 0.45, file: 'scoot/scoot.glb', base: 'deck', name: 'scooter', feet: 'deck', deckTop: 0.045, footF: [0.0, 0.12], footB: [-0.03, -0.2], grip: 0.255, gripUp: 0.925, gripZ: 0,
  tail: [0, 0.075, -0.4], trR: [0, 0.004, -0.11], trF: [0, -0.058, 0.06], trW: [0.12, 0.095] };
/* the snowbike: seated on the saddle, the hands on the bars, the feet on footpegs on the frame (2026-11-06, for "make it
   so that the feet on snow bike in leonski stay on the bike rather than touching the floor": they rode on two short foot
   skis on the snow beside it; ski bikes ridden without foot skis have pegs low on the frame, and so does this one now,
   made here since the model has none). peg: each peg's middle [out, up, along] in the frame's own frame, just under the
   bottom bracket; pegLen its length; the feet stand on them riding, carving, braking, in the air and on rails, and go
   back to them after any trick that takes them off */
export const BIKE = { half: 0.75, file: 'bike/bike.glb', base: 'frame', name: 'snowbike', feet: 'pegs', seat: { y: 0.5, z: -0.15 }, peg: [0.108, 0.135, 0.0], pegLen: 0.105,
  grip: 0.36, gripUp: 0.76, gripZ: 0.05, trR: [0, 0, -0.42], trF: [0, -0.204, 0.03], trW: [0.085, 0.075] };

// ---- the tricks ---------------------------------------------------------------------------------------------------------
// a timed trick has act (seconds a round) and pts (points a round); loop false: holding it does not go round again
const D = (name, guide, more) => Object.assign({ name, guide, noTweak: true }, more || {});
export const SCOOT_TRICKS = {
  tailwhip:   D('Tailwhip', 'the deck kicked round the bars, feet up', { act: 0.42, pts: 260 }),
  // (2026-11-08) the tailwhip the other way: the front foot's heel pushes the deck forward and round
  heelwhip:   D('Heelwhip', 'the front heel pushes the deck forward and round the bars', { act: 0.46, pts: 300 }),
  kickless:   D('Kickless', 'the deck pushed out in front, swung round by the bars, no kick', { act: 0.52, pts: 340 }),
  barspin:    D('Barspin', 'the bars spun a full turn, hands off', { act: 0.38, pts: 220 }),
  briflip:    D('Briflip', 'bars turned, the scooter flipped back over the shoulder', { act: 0.64, pts: 400 }),
  inward:     D('Inward Bri', 'bars turned in, the scooter flipped forward over the shoulder', { act: 0.64, pts: 420 }),
  fingerwhip: D('Finger Whip', 'one hand spins the deck round', { act: 0.52, pts: 330 }),
  buttercup:  D('Buttercup', 'tailwhip, briflip, tailwhip', { act: 1.4, pts: 1000, loop: false }),
  nohander:   D('No Hander', 'both hands off, arms out wide'),
  suicide:    D('Suicide No Hander', 'both hands off, behind the back'),
  tucknh:     D('Tuck No Hander', 'knees up to the bars, hands off'),
  nofooter:   D('No Footer', 'both feet off, legs out to the sides'),
  cancan:     D('Can Can', 'one leg across the deck to the other side'),
  nacnac:     D('Nac Nac', 'one leg kicked back over the tail'),
  superman:   D('Superman', 'legs straight out behind, arms straight'),
  xup:        D('X-Up', 'bars turned half round, arms crossed'),
  toboggan:   D('Toboggan', 'one hand on the tail, nose down, bars turned'),
  tabletop:   D('Table Top', 'the scooter laid flat beside you'),
  // (2026-11-08) a snowscoot grab as snowboarders do it: the front hand down behind the front knee to the deck's side
  melon:      D('Melon', 'front hand down behind the front leg to the deck, knees up'),
};
// the ski grab keys to scooter tricks (every scheme's keys are the ski grab ids, input.js GRAB_KEYS)
export const SCOOT_FOR = {
  mute: 'tailwhip', mute_m: 'tailwhip', safety: 'barspin', safety_m: 'inward', japan: 'nohander', japan_m: 'nohander', tail: 'superman', tail_m: 'superman',
  nose: 'cancan', nose_m: 'cancan', blunt: 'briflip', blunt_m: 'briflip', truck: 'nofooter', critical: 'xup', critical_m: 'xup', octo: 'tabletop',
  stalefish: 'nacnac', stalefish_m: 'nacnac', bowarrow: 'toboggan', seatbelt: 'kickless', seatbelt_m: 'kickless', dubtail: 'tucknh',
  daffy: 'fingerwhip', spread: 'buttercup', backscratch: 'inward', ironcross: 'suicide', spreadpoles: 'nofooter', seaman: 'superman',
};
export const BIKE_TRICKS = {
  tailwhip:   D('Tailwhip', 'the frame whipped round the bars, feet tucked', { act: 0.56, pts: 320 }),
  barspin:    D('Barspin', 'the bars spun a full turn, hands off', { act: 0.42, pts: 240 }),
  // (2026-11-08, for Leon's keys on the bike: B a heelwhip, X an inward, Z a briflip. As BMX and FMX riders name the
  // closest ones: the tailwhip the other way is an Opposite Whip; the bike twisted in towards you, the other way from
  // a table top, is an Inward Table; and the trick that goes all the way round the bars with the whole body, as a
  // briflip does on a scooter, is the Decade: the rider swung round the bars while the bike stays where it is)
  heelwhip:   D('Opposite Whip', 'the frame whipped round the other way, kicked off with the heel', { act: 0.6, pts: 360 }),
  decade:     D('Decade', 'the body swung right round the bars, the bike staying put', { act: 0.72, pts: 460 }),
  inward:     D('Inward Table', 'the bike twisted in towards you and laid flat, bars turned', { mix: ['inwardtable'] }),
  melon:      D('Melon', 'front hand down behind the front knee to the frame, knees up'),
  whip:       D('Whip', 'the bike thrown sideways under you'),
  nohander:   D('No Hander', 'both hands off, arms out wide'),
  tucknh:     D('Tuck No Hander', 'knees up to the bars, hands off'),
  nofooter:   D('No Footer', 'both feet off, legs out to the sides'),
  cancan:     D('Can Can', 'one leg over the frame to the other side'),
  nacnac:     D('Nac Nac', 'one leg kicked back over the rear ski'),
  heelclick:  D('Heel Clicker', 'both legs up over the bars, heels together'),
  superman:   D('Superman', 'off the saddle, legs straight out behind'),
  xup:        D('X-Up', 'bars turned half round, arms crossed'),
  toboggan:   D('Toboggan', 'one hand on the saddle, nose down, bars turned'),
  cliffhanger: D('Cliffhanger', 'stood up on the bars, toes under them, hands up'),
  lazyboy:    D('Lazy Boy', 'lying back on the saddle, feet under the bars, arms back'),
  kissofdeath: D('Kiss of Death', 'a handstand on the bars'),
  indian:     D('Indian Air', 'legs running in the air'),
};
export const BIKE_FOR = {
  safety: 'whip', safety_m: 'nohander', mute: 'tailwhip', mute_m: 'tailwhip', japan: 'cancan', japan_m: 'cancan', tail: 'superman', tail_m: 'superman',
  nose: 'heelclick', nose_m: 'heelclick', blunt: 'barspin', blunt_m: 'barspin', truck: 'nofooter', critical: 'xup', critical_m: 'xup', octo: 'lazyboy',
  stalefish: 'nacnac', stalefish_m: 'nacnac', bowarrow: 'toboggan', seatbelt: 'cliffhanger', seatbelt_m: 'cliffhanger', dubtail: 'tucknh',
  daffy: 'indian', spread: 'nohander', backscratch: 'kissofdeath', ironcross: 'nohander', spreadpoles: 'nofooter', seaman: 'superman',
};
/* E and R (2026-11-08, for "E and R give different versions of a trick, not just a tweak"): each trick has its own E
   version and R version (E and R together: both, where they go together), with its own name, as riders name them.
   A timed trick's version is its own trick (its own id, chosen as it starts: skier.js passes the tweak held then), so
   it is named and scored as itself, and the others in a room see it; a held one's follows the key held. Timed ones are
   the trick with mods on its round (ACT_MODS below): oneFoot (the front foot off and kicked out to the side), spread
   (both legs out wide), bars (a barspin thrown in: Tail Bar, Heel Bar), whip (a tailwhip in a briflip: Briwhip), wiper
   (round and back the other way: a rewind, a windshield wiper), tuck (the knees pulled up to the chest).
   Held ones are a mix of the held poses (mix: their names in HELD, the first one whole, the others on top of it). */
const VARY = {
  scoot: {
    tailwhip:   [['One-Foot Tailwhip', 'one foot kicked out to the side as the deck goes round', { mods: ['oneFoot'] }], ['Tail Bar', 'a tailwhip and a barspin together', { mods: ['bars'], act: 0.5, pts: 480 }]],
    heelwhip:   [['One-Foot Heelwhip', 'one foot kicked out to the side as the deck goes round', { mods: ['oneFoot'] }], ['Heel Bar', 'a heelwhip and a barspin together', { mods: ['bars'], act: 0.54, pts: 520 }]],
    kickless:   [['Kickless No Footer', 'both legs out wide while the bars carry the deck round', { mods: ['spread'] }], ['Kickless Rewind', 'the deck swung round and back the other way', { mods: ['wiper'], act: 0.74, pts: 560 }]],
    barspin:    [['One-Foot Barspin', 'one foot kicked out to the side as the bars spin', { mods: ['oneFoot'] }], ['Barspin Tuck', 'knees pulled up to the chest as the bars spin', { mods: ['tuck'], pts: 300 }]],
    briflip:    [['One-Foot Bri', 'one foot kicked out as the scooter flips', { mods: ['oneFoot'] }], ['Briwhip', 'a briflip with a tailwhip in it', { mods: ['whip'], act: 0.72, pts: 640 }]],
    inward:     [['One-Foot Inward', 'one foot kicked out as the scooter flips forward', { mods: ['oneFoot'] }], ['Inward Briwhip', 'an inward bri with a tailwhip in it', { mods: ['whip'], act: 0.72, pts: 660 }]],
    fingerwhip: [['Finger Whip No Footer', 'both legs out wide as the hand spins the deck', { mods: ['spread'] }], ['Finger Whip Rewind', 'the deck spun round and back the other way', { mods: ['wiper'], act: 0.74, pts: 540 }]],
    buttercup:  [['One-Foot Buttercup', 'one foot kicked out through the buttercup', { mods: ['oneFoot'] }], ['Bar Buttercup', 'a buttercup with a barspin in it', { mods: ['bars'], act: 1.5, pts: 1250 }]],
    nohander:   [['Can Can No Hander', 'hands off, one leg across the deck', { mix: ['nohander', 'cancan'] }], ['Nothing', 'no hands and no feet', { mix: ['nohander', 'legsWide'] }]],
    suicide:    [['Suicide Can Can', 'hands behind the back, one leg across', { mix: ['suicide', 'cancan'] }], ['Suicide Nothing', 'hands behind the back, legs out wide', { mix: ['suicide', 'legsWide'] }]],
    tucknh:     [['Suicide Tuck', 'knees up to the bars, hands behind the back', { mix: ['tucknh', 'armsBack'] }], ['One-Hand Tuck', 'knees up to the bars, one hand still on them', { mix: ['tucknh', 'handOnL'] }]],
    nofooter:   [['One-Footer', 'one leg out to the side', { mix: ['footOff'] }], ['Hart Attack', 'legs straight up over the bars', { mix: ['hart'] }]],
    cancan:     [['One-Hand Can Can', 'one leg across, the other hand off', { mix: ['cancan', 'handOff'] }], ['No-Footed Can Can', 'both legs off to the same side', { mix: ['legsSame'] }]],
    nacnac:     [['One-Hand Nac Nac', 'one leg kicked back, the other hand off', { mix: ['nacnac', 'handOff'] }], ['Nac Nac No Hander', 'one leg kicked back, both hands off', { mix: ['nacnac', 'armsOut'] }]],
    superman:   [['One-Hand Superman', 'stretched out behind, one hand off', { mix: ['superman', 'handOff'] }], ['Superman Deck Grab', 'stretched out behind, one hand on the deck', { mix: ['superman', 'handDeck'] }]],
    xup:        [['One-Foot X-Up', 'bars crossed, one foot kicked out', { mix: ['xup', 'footOff'] }], ['Turndown', 'bars crossed, the scooter turned down on its side', { mix: ['xup', 'turndown'] }]],
    toboggan:   [['One-Foot Toboggan', 'a hand on the tail, one foot kicked out', { mix: ['toboggan', 'footOff'] }], ['No-Footed Toboggan', 'a hand on the tail, both legs out wide', { mix: ['toboggan', 'legsWideLow'] }]],
    tabletop:   [['Inward Table', 'the scooter twisted in towards you, laid flat', { mix: ['inwardtable'] }], ['One-Hand Table Top', 'laid flat, one hand off', { mix: ['tabletop', 'handOff'] }]],
    melon:      [['Tweaked Melon', 'the melon pulled up, the front leg straightened', { mix: ['melon', 'melonTweak'] }], ['Indy', 'the back hand down to the deck between the feet', { mix: ['indy'] }]],
  },
  bike: {
    tailwhip:   [['One-Foot Tailwhip', 'one foot kicked out to the side as the frame goes round', { mods: ['oneFoot'] }], ['Tail Bar', 'a tailwhip and a barspin together', { mods: ['bars'], act: 0.64, pts: 560 }]],
    heelwhip:   [['One-Foot Opposite Whip', 'one foot kicked out as the frame goes round', { mods: ['oneFoot'] }], ['Windshield Wiper', 'a tailwhip and back the other way', { mods: ['wiper'], act: 0.9, pts: 640 }]],
    barspin:    [['One-Foot Barspin', 'one foot kicked out to the side as the bars spin', { mods: ['oneFoot'] }], ['Barspin Tuck', 'knees up to the bars as they spin', { mods: ['tuck'], pts: 320 }]],
    decade:     [['One-Foot Decade', 'one leg flung out as the body goes round', { mods: ['oneFoot'] }], ['No-Foot Decade', 'both legs out wide as the body goes round', { mods: ['spread'], pts: 560 }]],
    whip:       [['Flat Whip', 'the bike thrown flat sideways', { mix: ['whip', 'flatter'] }], ['Turndown', 'bars crossed, the bike turned down the other way', { mix: ['turndownB'] }]],
    nohander:   [['Can Can No Hander', 'hands off, one leg over the frame', { mix: ['nohander', 'cancan'] }], ['Nothing', 'no hands and no feet', { mix: ['nohander', 'legsWide'] }]],
    tucknh:     [['Suicide Tuck', 'knees up to the bars, hands behind the back', { mix: ['tucknhB', 'armsBack'] }], ['One-Hand Tuck', 'knees up to the bars, one hand on them', { mix: ['tucknhB', 'handOnL'] }]],
    nofooter:   [['One-Footer', 'one leg out to the side', { mix: ['footOff'] }], ['Hart Attack', 'off the saddle, legs straight up over the bars', { mix: ['hart'] }]],
    cancan:     [['One-Hand Can Can', 'one leg over, the other hand off', { mix: ['cancan', 'handOff'] }], ['No-Footed Can Can', 'both legs off to the same side', { mix: ['legsSame'] }]],
    nacnac:     [['One-Hand Nac Nac', 'one leg kicked back, the other hand off', { mix: ['nacnac', 'handOff'] }], ['Nac Nac No Hander', 'one leg kicked back, both hands off', { mix: ['nacnac', 'armsOut'] }]],
    heelclick:  [['One-Hand Heel Clicker', 'heels over the bars, one hand off', { mix: ['heelclick', 'handOff'] }], ['Saran Wrap', 'one leg wrapped round the bars, that hand off', { mix: ['saran'] }]],
    superman:   [['One-Hand Superman', 'stretched out behind, one hand off', { mix: ['supermanB', 'handOff'] }], ['Superman Seat Grab', 'stretched out behind, one hand on the saddle', { mix: ['supermanB', 'handTail'] }]],
    xup:        [['One-Foot X-Up', 'bars crossed, one foot kicked out', { mix: ['xup', 'footOff'] }], ['X-Up Can Can', 'bars crossed, one leg over the frame', { mix: ['xup', 'cancan'] }]],
    toboggan:   [['One-Foot Toboggan', 'a hand on the saddle, one foot kicked out', { mix: ['toboggan', 'footOff'] }], ['No-Footed Toboggan', 'a hand on the saddle, legs out wide', { mix: ['toboggan', 'legsWideLow'] }]],
    cliffhanger: [['One-Foot Cliffhanger', 'stood up on the bars, one foot off', { mix: ['cliffhanger', 'footOff'] }], ['Rock Solid', 'stretched out flat over the bike, hands on the bars', { mix: ['rocksolid'] }]],
    lazyboy:    [['One-Foot Lazy Boy', 'lying back, one foot off the bars', { mix: ['lazyboy', 'footOff'] }], ['Dead Body', 'lying flat over the bike, arms out wide', { mix: ['lazyboy', 'armsOut'] }]],
    kissofdeath: [['Split Kiss of Death', 'a handstand, legs split', { mix: ['kissofdeath', 'legsSplit'] }], ['Wide Kiss of Death', 'a handstand, legs out wide', { mix: ['kissofdeath', 'legsWideP'] }]],
    indian:     [['Seat Grab Indian', 'legs running, a hand on the saddle', { mix: ['indian', 'handTail'] }], ['Indian No Hander', 'legs running, hands off', { mix: ['indian', 'armsOut'] }]],
    inward:     [['One-Hand Inward Table', 'twisted in and laid flat, one hand off', { mix: ['inwardtable', 'handOff'] }], ['No-Foot Inward Table', 'twisted in and laid flat, legs out wide', { mix: ['inwardtable', 'legsWide'] }]],
    melon:      [['Tweaked Melon', 'the melon pulled up, the front leg straightened', { mix: ['melon', 'melonTweak'] }], ['Seat Grab', 'one hand on the saddle, the body out to the side', { mix: ['seatgrab'] }]],
  },
};
// mods that cannot go on one round together (the E and R versions are then not combined)
const CLASH = { oneFoot: ['spread', 'tuck'], spread: ['oneFoot', 'tuck'], tuck: ['oneFoot', 'spread'] };
for (const [T, VT] of [[SCOOT_TRICKS, VARY.scoot], [BIKE_TRICKS, VARY.bike]]) for (const id in VT) {
  const d = T[id]; if (!d) continue;
  const [e, r] = VT[id], mk = (suf, name, guide, more) => { T[id + suf] = Object.assign({}, d, { name, guide, base: id, vary: false }, more); };
  mk('_e', e[0], e[1], Object.assign({ pts: d.pts ? d.pts + 90 : undefined }, e[2]));
  mk('_r', r[0], r[1], r[2]);
  d.vary = true;
  // E and R together: both mods on one round (timed tricks, where they go together)
  const me = (e[2].mods || [])[0], mr = (r[2].mods || [])[0];
  if (d.act && me && mr && !(CLASH[me] || []).includes(mr)) {
    const name = me === 'spread' ? `${r[0]} No Footer` : `One-Foot ${r[0]}`;
    mk('_er', name, `${r[1]}, ${me === 'spread' ? 'legs out wide' : 'one foot kicked out'}`, { mods: [me, mr], act: r[2].act || d.act, pts: (r[2].pts || d.pts) + 120 });
  }
}
for (const T of [SCOOT_TRICKS, BIKE_TRICKS]) for (const k in T) { T[k].id = k; T[k].wk = 'xw_' + k; }
const HELD_S = Object.values(SCOOT_TRICKS).filter(d => !d.act), HELD_B = Object.values(BIKE_TRICKS).filter(d => !d.act);
// a trick by its key's id, and its E / R version (mod: 'E', 'R' or 'ER', the tweak held)
const pick = (T, F) => (id, mod) => {
  const d = T[F[id] || id]; if (!d) return null;
  if (!mod || !d.vary) return d;
  return (mod.includes('E') && mod.includes('R') && T[d.id + '_er']) || T[d.id + (mod.includes('R') ? '_r' : '_e')] || d;
};
export const scootTrickDef = pick(SCOOT_TRICKS, SCOOT_FOR);
export const bikeTrickDef = pick(BIKE_TRICKS, BIKE_FOR);
RIDE_GRABS.scoot = scootTrickDef; RIDE_GRABS.bike = bikeTrickDef;
RIDE_GUIDES.scoot = (id, mod) => { const d = scootTrickDef(id, mod); return d ? d.guide : ''; };
RIDE_GUIDES.bike = (id, mod) => { const d = bikeTrickDef(id, mod); return d ? d.guide : ''; };
// the physics' timed tricks (skier.js): one object per trick, so nothing is made per step (tweak: E or R held as it starts)
const actOf = def => def && def.act ? (def._a || (def._a = { id: def.id, T: def.act, loop: def.loop !== false })) : null;
RIDE_ACTS.scoot = (id, tweak) => actOf(scootTrickDef(id, tweak));
RIDE_ACTS.bike = (id, tweak) => actOf(bikeTrickDef(id, tweak));
/* the keys (2026-11-08, Leon's: V tailwhip, B heelwhip, C barspin, X inward, Z briflip, S melon grab; on the bike Z is
   the Decade and X the Inward Table, the closest real tricks), the rest on F and the number row so every trick has a
   key; in the other schemes only the new ones are added, on free keys (the rest still come through the ski grab keys).
   input.js looks a key up here before the ski table (RIDE_KEYS, P) */
export const SCOOT_KEYS = {
  shred: { KeyV: 'tailwhip', KeyB: 'heelwhip', KeyC: 'barspin', KeyX: 'inward', KeyZ: 'briflip', KeyS: 'melon', KeyF: 'kickless',
    Digit1: 'nohander', Digit2: 'suicide', Digit3: 'tucknh', Digit4: 'nofooter', Digit5: 'cancan', Digit6: 'nacnac', Digit7: 'superman',
    Digit8: 'xup', Digit9: 'toboggan', Digit0: 'tabletop', Minus: 'fingerwhip', Equal: 'buttercup' },
  keys: { Digit1: 'heelwhip', Digit2: 'melon' },
  mouse: { KeyH: 'heelwhip', KeyJ: 'melon' },
};
export const BIKE_KEYS = {
  shred: { KeyV: 'tailwhip', KeyB: 'heelwhip', KeyC: 'barspin', KeyX: 'inward', KeyZ: 'decade', KeyS: 'melon', KeyF: 'whip',
    Digit1: 'nohander', Digit2: 'tucknh', Digit3: 'nofooter', Digit4: 'cancan', Digit5: 'nacnac', Digit6: 'heelclick', Digit7: 'superman',
    Digit8: 'xup', Digit9: 'toboggan', Digit0: 'cliffhanger', Minus: 'lazyboy', Equal: 'kissofdeath', BracketLeft: 'indian' },
  keys: { Digit1: 'heelwhip', Digit2: 'melon', Digit3: 'decade', Digit4: 'inward' },
  mouse: { KeyH: 'heelwhip', KeyJ: 'melon', KeyK: 'decade', KeyL: 'inward' },
};
// (read through the module's namespace: input.js may not have RIDE_KEYS yet, or may still be running when this does;
// then once more after every module has run)
// (and what R, E, S and N do on the snow and rails on each, for the key list: RIDE_HELP, P)
export const SCOOT_HELP = {
  oneFoot: 'one-footer: the back foot off and out to the side (stood on the back foot: the front one off), pop off it',
  together: 'feet together in the middle of the deck: steadier on a rail, less forgiving of a lean',
  lazy: 'manual: weight back on the rear board, the front lifted',
  butter: 'nose manual (with ↓ a manual), turn it with ← / →; on a rail a nose or tail manual',
};
export const BIKE_HELP = {
  oneFoot: 'one-footer: a foot off its peg and out to the side, pop off it',
  together: 'knees in against the frame: steadier on a rail, less forgiving of a lean',
  lazy: 'manual: back off the saddle on the rear ski, the front ski lifted',
  butter: 'nose manual (with ↓ a manual), turn it with ← / →; on a rail a nose or tail manual',
};
{
  const reg = () => { const RK = INPUT.RIDE_KEYS, RH = INPUT.RIDE_HELP; if (RK) { RK.scoot = SCOOT_KEYS; RK.bike = BIKE_KEYS; } if (RH) { RH.scoot = SCOOT_HELP; RH.bike = BIKE_HELP; } };
  try { reg(); } catch (e) { setTimeout(() => { try { reg(); } catch (e2) {} }, 0); }
}
/* spins and flips as scooter, BMX and sled riders name them (P, 2026-11-05): 180, 360, 540; a Backflip, a Frontflip, a
   Double Backflip; a flip with a spin in it, 360 Backflip; turned over sideways, a Barrel Roll; riding backwards, Fakie */
export function rideSpin(A) {
  const spinR = Math.round(Math.abs(A.spin) / 180) * 180;
  if (!A.inv && spinR < 180) return null;
  const parts = A.sw ? ['Fakie'] : [];
  if (A.inv > 0) {
    const mult = ['', 'Double ', 'Triple ', 'Quad '][Math.min(A.inv, 4) - 1];
    const f = Math.abs(A.roll) > Math.abs(A.flip) ? 'Barrel Roll' : A.flip < 0 ? 'Backflip' : 'Frontflip';
    parts.push(spinR >= 180 ? `${spinR} ${mult}${f}` : `${mult}${f}`);
  } else parts.push(`${spinR}`);
  return parts;
}
RIDE_SPIN.scoot = RIDE_SPIN.bike = rideSpin;
// (S on the snow is a manual on these, N a nose manual: tricks.js names them so)
RIDE_WORDS.scoot = RIDE_WORDS.bike = { lazy: 'Manual', nose: 'Nose Manual', tail: 'Manual' };

// ---- the model -----------------------------------------------------------------------------------------------------------
const _gltf = {};
function loadModel(file) {
  if (_gltf[file]) return _gltf[file];
  const loader = new GLTFLoader();
  const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
  _gltf[file] = loader.loadAsync('./models/' + file + '?v=26').catch(e => { _gltf[file] = null; throw e; });
  return _gltf[file];
}
const frameLoader = cfg => async (rig) => {
  const gl = await loadModel(cfg.file);
  const src = {}; gl.scene.traverse(o => { if (o.isMesh || o.name) src[o.name] = src[o.name] || o; });
  const sc = rig.sc = { root: new THREE.Group(), cfg };
  sc.root.name = cfg.name;
  const part = n => { const o = src[n].clone(true); o.traverse(m => { if (m.isMesh) m.castShadow = true; }); return o; };
  sc.deck = part(cfg.base); sc.steer = part('steer');
  // (the snowbike's footpegs, on the frame so they go round with it in a tailwhip; its foot skis are left off now)
  if (cfg.peg) sc.deck.add(makePegs(cfg));
  sc.steerPos = sc.steer.position.clone(); sc.steerQ = sc.steer.quaternion.clone();         // the steering axis's place and tilt
  sc.axis = new THREE.Vector3(0, 1, 0).applyQuaternion(sc.steerQ);
  sc.root.add(sc.deck, sc.steer);
  rig.root.add(sc.root);
  rig.board = sc.root;
  // (snow.js: tracks where the boards (the bike's two skis) meet the snow, rig.tracks)
  const mk = hw => { const o = new THREE.Object3D(); o.userData.hw = hw; rig.root.add(o); return o; };
  sc.tr = [mk(cfg.trW[0]), mk(cfg.trW[1])];
  rig.tracks = sc.tr; rig.skiL = sc.tr[0]; rig.skiR = sc.tr[1];
  sc.pAct = null; sc.pU = 0; sc.jA = null; sc.jU = 0; sc.jRound = 0; sc.lookK = 'deck'; sc.kickK = 1; sc.ordWd = 1; sc.ordFlip = 0;
  sc.kickV = [0, -0.6, -0.2]; sc.hOff = [[0, 0.2, 0], [0, 0.2, 0]];
};
/* the snowbike's footpegs (2026-11-06): a short mount off the bottom bracket and a flat motocross style peg each side,
   teeth across its top, all one mesh in the frame's frame (one draw) */
let _pegGeo = null, _pegMat = null;
function makePegs(cfg) {
  if (!_pegGeo) {
    const parts = [], [px, py, pz] = cfg.peg, L = cfg.pegLen;
    const add = (g, x, y, z) => { g.translate(x, y, z); parts.push(g); };
    for (const s of [1, -1]) {
      add(new THREE.BoxGeometry(0.05, 0.03, 0.036), s * 0.048, py + 0.004, pz);                      // the mount, on the frame
      add(new THREE.BoxGeometry(L, 0.014, 0.05), s * px, py, pz);                                    // the peg
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(L * 0.92, 0.008, 0.005), s * px, py + 0.01, pz - 0.0195 + i * 0.013);   // its teeth
      add(new THREE.BoxGeometry(0.006, 0.02, 0.052), s * (px + L / 2), py + 0.003, pz);              // the end lip
    }
    _pegGeo = mergeGeometries(parts); for (const g of parts) g.dispose();
    _pegMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.7, roughness: 0.42 });
  }
  const m = new THREE.Mesh(_pegGeo, _pegMat); m.name = 'pegs'; m.castShadow = true;
  return m;
}
Rig.loader.scoot = frameLoader(SCOOT);
Rig.loader.bike = frameLoader(BIKE);

// ---- the pose ------------------------------------------------------------------------------------------------------------
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), ZERO = new THREE.Vector3();
const _q1 = Q(), _q2 = Q(), _q3 = Q(), _qi = Q(), _sq = Q(), _lq = Q(), _wq = Q(), _qf = Q();
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V(), _v7 = V(), _lp = V(), _acc = V(), _pv = V(), _sh = V(), _wr = V(), _el = V(), _fd = V(), _pa = V(), _cF = V(), _cL = V(), _cU = V(), _ax = V();
const TAU = Math.PI * 2;
// a track point: at pt in the part's frame, turned as the part is
function mark(o, part, pt) { o.position.set(pt[0], pt[1], pt[2]).applyMatrix4(part.matrixWorld); part.getWorldQuaternion(o.quaternion); }
// 0 -> 1 over [a, b] then back to 0 over [c, d]
const bump = (u, a, b, c, d) => smooth01((u - a) / (b - a)) * (1 - smooth01((u - c) / (d - c)));

/* What a frame's pose is made of: the trunk (the pelvis's place and turn, the chest and head relative to it) and each
   limb's target, written by the base pose and then pulled towards each trick held by its weight (a spring, so one trick
   fades into the next), then by a timed trick going round. All world space; one object, nothing made per frame. */
const C = {
  R: null, BP: null, fw: V(), up: V(), lf: V(), s: 1,
  pel: V(), pp: 0, py: 0, pr: 0, cl: 0, ct: 0, cs: 0, hp: 0, hy: 0, hr: 0,
  wy: 0, pushW: 0, pushK: 1, pushPow: 0, pushY: 0, pushZ: 0, ofW: 0, ofK: 1, tgW: 0, landL: 0, spinK: 0, tbW: 0, tbK: 1, tbP: V(),
  pq: Q(), cq: Q(), hq: Q(),
  hip: [V(), V()], sh: [V(), V()], grip: [V(), V()], grip0: [V(), V()], spot: [V(), V()], seat: V(), tail: V(), nose: V(), barMid: V(), dk: V(), look: V(), wf: 0,
  melon: V(), indy: V(), wdir: 1, decA: 0, decP: V(), decX: V(),
  foot: [V(), V()], kp: [V(), V()], ffree: [0, 0], fyaw: [0, 0], fpit: [0, 0],
  hand: [V(), V()], hoff: [0, 0], ep: [V(), V()], curl: [0, 0], hgrab: [0, 0], hgD: [V(), V()], hgP: [V(), V()],
  legLen: 0.8, armL: 0.55, u: 0, t: 0, tt: 0, lean: 0,
};
// helpers on C: a point in the body frame, in the pelvis frame from the pelvis, in the chest frame from a shoulder
const bpt = (out, x, y, z) => out.set(x, y, z).applyQuaternion(C.R).add(C.BP);
const bdir = (out, x, y, z) => out.set(x, y, z).applyQuaternion(C.R);
const ppt = (out, x, y, z) => out.set(x, y, z).applyQuaternion(C.pq).add(C.pel);
const pdir = (out, x, y, z) => out.set(x, y, z).applyQuaternion(C.pq);
const spt = (out, k, x, y, z) => out.set(x, y, z).applyQuaternion(C.cq).add(C.sh[k]);
const hpt = (out, k, x, y, z) => out.set(x, y, z).applyQuaternion(C.R).add(C.hip[k]);
// pull a limb target towards a point by w
const footTo = (k, p, w, free = 1) => { C.foot[k].lerp(p, w); C.ffree[k] += (free - C.ffree[k]) * w; };
const handTo = (k, p, w, off = 1) => { C.hand[k].lerp(p, w); C.hoff[k] += (off - C.hoff[k]) * w; };
const kneeTo = (k, d, w) => { C.kp[k].lerp(d, w); };
const elbowTo = (k, d, w) => { C.ep[k].lerp(d, w); };

/* The held tricks. v: the vehicle moved from under the rider, in the body frame [left, up, forward, nose up, nose left,
   lean right]; st: the bars turned (rad); trunk(w) and limbs(w) pull the targets on C towards the trick by w. */
const HELD = {
  // ---- both rides
  nohander: { v: [0, 0.06, -0.03, 0.06, 0, 0], crouch: 0.4,
    trunk(w) { C.cl -= 0.32 * w; C.hp -= 0.25 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, spt(_v1, k, s * 0.42, 0.36, 0.1), w); elbowTo(k, bdir(_v2, s * 0.3, -1, -0.2), w); C.curl[k] += (0.25 - C.curl[k]) * w; kneeTo(k, bdir(_v2, -s * 0.15, 0.25, 1), w); } } },
  suicide: { v: [0, 0.1, -0.04, 0.08, 0, 0], crouch: 0.42,
    trunk(w) { C.cl -= 0.4 * w; C.hp -= 0.3 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, ppt(_v1, s * 0.05, 0.18, -0.24), w); elbowTo(k, pdir(_v2, s * 1, -0.3, -0.6), w); C.curl[k] += (0.6 - C.curl[k]) * w; kneeTo(k, bdir(_v2, -s * 0.15, 0.25, 1), w); } } },
  tucknh: { v: [0, 0.34, -0.1, 0.18, 0, 0], crouch: 0.85,
    trunk(w) { C.cl += 0.3 * w; C.hp -= 0.12 * w; C.pel.addScaledVector(C.fw, 0.06 * w); },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, spt(_v1, k, s * 0.55, 0.02, 0.1), w); elbowTo(k, bdir(_v2, 0, -1, -0.3), w); C.curl[k] += (0.2 - C.curl[k]) * w; kneeTo(k, bdir(_v2, s * 0.08, 0.7, 1), w); } } },
  nofooter: { v: [0, 0.16, 0.05, 0, 0, 0], crouch: 0.3,
    trunk(w) { C.cl -= 0.12 * w; C.pel.addScaledVector(C.up, 0.03 * w).addScaledVector(C.fw, -0.03 * w); },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, hpt(_v1, k, s * 0.5, -0.6, 0.14), w); kneeTo(k, bdir(_v2, s * 0.7, 0.3, 0.6), w); C.fyaw[k] += (s * 0.5 - C.fyaw[k]) * w; } } },
  cancan: { v: [0, 0.09, 0, 0, 0.12, -0.14], crouch: 0.42,
    trunk(w) { C.py += 0.32 * w; C.ct -= 0.26 * w; C.pel.addScaledVector(C.lf, 0.04 * w); },
    limbs(w) { footTo(1, ppt(_v1, 0.5, -0.3, 0.36), w); kneeTo(1, pdir(_v2, 0.4, 0.8, 0.5), w); C.fpit[1] += (-0.4 - C.fpit[1]) * w; } },
  nacnac: { v: [0, 0.08, 0, 0, 0.28, 0.2], crouch: 0.38,
    trunk(w) { C.py -= 0.7 * w; C.ct += 0.62 * w; C.hy += 0.1 * w; C.pel.addScaledVector(C.lf, -0.06 * w); },
    limbs(w) { footTo(1, hpt(_v1, 1, 0.5, 0.12, -0.62), w); kneeTo(1, bdir(_v2, 0.3, -1, 0), w); C.fpit[1] += (-0.8 - C.fpit[1]) * w; } },
  superman: { v: [0, 0.16, 0.26, -0.2, 0, 0], crouch: 0.2,
    trunk(w) {
      // the body stretched out flat behind the bars, arms straight to them
      const sup = _v1.copy(C.barMid).addScaledVector(C.fw, -(C.armL * 0.72 + 0.42)).addScaledVector(C.up, -0.16);
      C.pel.lerp(sup, w); C.pp += 1.35 * w; C.cl += (0.12 - C.cl) * w; C.hp += (-1.0 - C.hp) * w;
    },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, ppt(_v1, s * 0.09, -C.legLen * 0.97, -0.02), w); kneeTo(k, pdir(_v2, 0, 0, 1), w); C.fpit[k] += (-1.0 - C.fpit[k]) * w; } } },
  xup: { v: [0, 0.07, 0.12, 0.04, 0, 0], st: Math.PI, crouch: 0.48,
    trunk(w) { C.cl -= 0.06 * w; C.hp += 0.15 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; elbowTo(k, bdir(_v2, s * 1, 0.15, -0.1), w); } } },
  toboggan: { v: [-0.06, 0.34, 0, -0.55, -0.42, 0.25], st: 1.25, crouch: 0.7, bikeV: [0, 0.06, 0.02, -0.4, -0.25, 0.18], bikeSt: 1.35,
    trunk(w) { C.cl += 0.42 * w; C.ct -= 0.45 * w; C.py -= 0.12 * w; C.hy -= 0.2 * w; if (C.bike) C.pel.addScaledVector(C.up, 0.2 * w).addScaledVector(C.fw, -0.05 * w); },
    limbs(w) {
      // the right hand on the deck's tail (the bike: the back of the saddle), palm down on it
      handTo(1, C.tail, w, 0.35); C.hgrab[1] += (1 - C.hgrab[1]) * w;
      if (!C.bike) for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, hpt(_v1, k, s * 0.12, -0.4, 0.2), w); kneeTo(k, bdir(_v2, 0, 0.6, 1), w); }
    } },
  tabletop: { v: [0.24, 0.42, -0.04, 0.1, 0.25, -1.25], crouch: 0.75,
    trunk(w) { C.py += 0.22 * w; C.ct -= 0.12 * w; C.cl += 0.3 * w; C.pr -= 0.15 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) kneeTo(k, bdir(_v2, 0.8, 0.2, 0.6), w); } },
  // ---- the snowbike's own
  whip: { v: [0, 0.04, 0, 0, 1.2, -0.65], crouch: 0.4, keepSeat: 1,
    trunk(w) { C.ct += 0.25 * w; C.hy -= 0.15 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) elbowTo(k, bdir(_v2, (k ? -1 : 1) * 0.8, -0.6, 0), w); } },
  heelclick: { v: [0, 0.04, 0.05, 0.1, 0, 0], crouch: 0.3,
    trunk(w) { C.cl += (-0.45 - C.cl) * w; C.pp -= 0.35 * w; C.hp += 0.25 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, _v1.copy(C.barMid).addScaledVector(C.up, 0.22).addScaledVector(C.fw, 0.24).addScaledVector(C.lf, s * 0.03), w); kneeTo(k, bdir(_v2, s * 0.2, 1, 0.3), w); C.fpit[k] += (0.3 - C.fpit[k]) * w; C.fyaw[k] += (-s * 0.3 - C.fyaw[k]) * w; } } },
  cliffhanger: { v: [0, -0.42, 0.06, 0.22, 0, 0], crouch: 0.1,
    trunk(w) {
      // stood up tall over the bars, toes hooked under them
      const p = _v1.copy(C.barMid).addScaledVector(C.up, C.legLen * 0.9 + 0.02).addScaledVector(C.fw, -0.12);
      C.pel.lerp(p, w); C.pp -= 0.12 * w; C.cl += (-0.15 - C.cl) * w; C.hp += (-0.2 - C.hp) * w;
    },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, _v1.copy(C.barMid).addScaledVector(C.up, 0.02).addScaledVector(C.lf, s * 0.11).addScaledVector(C.fw, -0.03), w); kneeTo(k, bdir(_v2, 0, 0, 1), w); C.fpit[k] += (0.5 - C.fpit[k]) * w;
      handTo(k, spt(_v1, k, s * 0.22, 0.5, 0.05), w); elbowTo(k, bdir(_v2, s * 1, 0, -0.3), w); C.curl[k] += (0.15 - C.curl[k]) * w; } } },
  lazyboy: { v: [0, 0.06, 0.08, 0.12, 0, 0], crouch: 0.3,
    trunk(w) { C.pp -= 1.15 * w; C.cl += (-0.35 - C.cl) * w; C.hp += (0.55 - C.hp) * w; C.pel.addScaledVector(C.fw, 0.02 * w).addScaledVector(C.up, 0.02 * w); },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, _v1.copy(C.barMid).addScaledVector(C.up, -0.06).addScaledVector(C.lf, s * 0.1).addScaledVector(C.fw, -0.02), w); kneeTo(k, bdir(_v2, 0, 1, 0), w); C.fpit[k] += (0.3 - C.fpit[k]) * w;
      handTo(k, spt(_v1, k, s * 0.12, 0.52, -0.06), w); elbowTo(k, bdir(_v2, s * 1, 0.2, 0), w); C.curl[k] += (0.3 - C.curl[k]) * w; } } },
  kissofdeath: { v: [0, -0.12, 0.06, -0.45, 0, 0], crouch: 0.1,
    trunk(w) {
      // pushed up into a handstand over the bars: pitched forward right over, head down by the bars, legs straight up
      const p = _v1.copy(C.barMid).addScaledVector(C.up, 0.98).addScaledVector(C.fw, -0.04);
      C.pel.lerp(p, w); C.pp += (Math.PI - 0.05) * w; C.cl += (0.05 - C.cl) * w; C.hp += (-0.5 - C.hp) * w;
    },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, ppt(_v1, s * 0.07, -C.legLen * 0.98, 0.04), w); kneeTo(k, pdir(_v2, 0, 0, -1), w); C.fpit[k] += (-1.1 - C.fpit[k]) * w; elbowTo(k, pdir(_v2, s * 1, 0, 0.3), w); } } },
  indian: { v: [0, 0.08, 0, 0.05, 0, 0], crouch: 0.35,
    trunk(w) { C.pel.addScaledVector(C.up, 0.06 * w); C.cl -= 0.05 * w; },
    limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1, ph = Math.sin(C.t * 7.5 + k * Math.PI); footTo(k, hpt(_v1, k, s * 0.13, -0.6 + 0.16 * Math.max(0, ph), 0.56 * ph), w); kneeTo(k, bdir(_v2, 0, 0.2, 1), w); C.fpit[k] += (-0.5 * ph - C.fpit[k]) * w; } } },
};
/* (2026-11-08) the new held tricks, and the pieces the E and R versions are mixed from (VARY: mix). A piece moves only
   what it is about (an arm, a leg, the vehicle a little), so it goes on top of a whole trick. */
// the front hand (the left) down behind the front knee to the deck's side (the bike: the frame's side under the saddle)
HELD.melon = { v: [0.02, 0.4, -0.06, 0.16, 0.06, 0.38], crouch: 0.86, bikeV: [0.02, 0.24, -0.02, 0.14, 0.05, 0.3],
  trunk(w) { C.cl += 0.52 * w; C.cs -= 0.38 * w; C.ct += 0.26 * w; C.py -= 0.1 * w; C.hy += 0.32 * w; C.hp += 0.25 * w; },
  limbs(w) {
    handTo(0, C.melon, w, 0.35); C.hgrab[0] += (1 - C.hgrab[0]) * w; elbowTo(0, bdir(_v2, 1, 0.1, -0.6), w);
    for (let k = 0; k < 2; k++) kneeTo(k, bdir(_v2, (k ? -1 : 1) * 0.3, 0.8, 1), w);
  } };
// the melon tweaked: the deck pushed out and turned away from the hand, the front leg straightened ("boned")
HELD.melonTweak = { v: [0.06, -0.04, 0.08, -0.2, 0.32, 0.18],
  trunk(w) { C.ct += 0.14 * w; C.cs -= 0.08 * w; },
  limbs(w) { kneeTo(0, bdir(_v2, 0.3, 0.05, 1), w); } };
// the back hand (the right) down between the feet to the deck's other side, the front hand on the bars (the bike: the
// right hand to the frame behind the right knee)
HELD.indy = { v: [-0.02, 0.4, -0.06, 0.14, -0.08, -0.36], crouch: 0.86, bikeV: [-0.02, 0.24, -0.02, 0.12, -0.05, -0.3],
  trunk(w) { C.cl += 0.54 * w; C.cs += 0.38 * w; C.ct -= 0.24 * w; C.hy -= 0.28 * w; C.hp += 0.25 * w; },
  limbs(w) {
    handTo(1, C.indy, w, 0.35); C.hgrab[1] += (1 - C.hgrab[1]) * w; elbowTo(1, bdir(_v2, -1, 0.1, -0.3), w);
    for (let k = 0; k < 2; k++) kneeTo(k, bdir(_v2, (k ? -1 : 1) * 0.3, 0.8, 1), w);
  } };
// the inward table: the vehicle twisted in towards the rider and laid flat the other way from a table top
HELD.inwardtable = { v: [-0.22, 0.4, -0.04, 0.12, -0.28, 1.2], crouch: 0.72, bikeV: [-0.12, 0.2, 0, 0.12, -0.3, 1.0], st: -0.5,
  trunk(w) { C.py -= 0.24 * w; C.ct += 0.16 * w; C.cl += 0.3 * w; C.pr += 0.18 * w; C.hy -= 0.15 * w; },
  limbs(w) { for (let k = 0; k < 2; k++) kneeTo(k, bdir(_v2, -0.8, 0.2, 0.6), w); } };
// arms: both out wide (a no hander's), both behind the back (a suicide's), the right one off and out, the left one back
// on its grip, the right hand on the deck's tail (the bike: the back of the saddle)
HELD.armsOut = { trunk(w) { C.cl -= 0.14 * w; },
  limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, spt(_v1, k, s * 0.44, 0.34, 0.08), w); elbowTo(k, bdir(_v2, s * 0.3, -1, -0.2), w); C.curl[k] += (0.25 - C.curl[k]) * w; } } };
HELD.armsBack = { v: [0, 0, 0.06, 0, 0, 0], trunk(w) { C.cl -= 0.16 * w; C.hp -= 0.1 * w; },
  limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; handTo(k, ppt(_v1, s * 0.05, 0.18, -0.24), w); elbowTo(k, pdir(_v2, s * 1, -0.3, -0.6), w); C.curl[k] += (0.6 - C.curl[k]) * w; } } };
HELD.handOff = { trunk(w) { C.cs += 0.07 * w; C.ct -= 0.08 * w; C.hy -= 0.1 * w; },
  limbs(w) { handTo(1, spt(_v1, 1, -0.5, 0.24, 0.04), w); elbowTo(1, bdir(_v2, -1, -0.25, -0.2), w); C.curl[1] += (0.2 - C.curl[1]) * w; } };
HELD.handOnL = { limbs(w) { handTo(0, _v1.copy(C.grip[0]).addScaledVector(C.up, 0.02), w, 0); C.curl[0] += (1.3 - C.curl[0]) * w; elbowTo(0, bdir(_v2, 0.8, -0.6, -0.3), w); } };
// (the right hand on the front of the deck by the stem: the scooter's superman deck grab, the deck brought up to it)
HELD.handDeck = { v: [-0.04, 0.24, -0.06, 0.1, -0.12, -0.3], trunk(w) { C.ct -= 0.16 * w; C.cs += 0.16 * w; C.cl += 0.12 * w; },
  limbs(w) { handTo(1, C.nose, w, 0.35); C.hgrab[1] += (1 - C.hgrab[1]) * w; elbowTo(1, bdir(_v2, -1, 0.2, -0.3), w); } };
HELD.handTail = { trunk(w) { C.ct -= 0.12 * w; C.cs += 0.1 * w; },
  limbs(w) { handTo(1, C.tail, w, 0.35); C.hgrab[1] += (1 - C.hgrab[1]) * w; elbowTo(1, bdir(_v2, -1, 0.2, -0.3), w); } };
// legs: the right one off and kicked out to the side; both out wide (a no footer's); both off to the same side (a
// no-footed can can); split, one forward and one back (in the pelvis's frame: a handstand's legs)
HELD.footOff = { v: [0, 0.04, 0, 0, 0, 0],
  trunk(w) { C.cs -= 0.06 * w; C.pr += 0.08 * w; },
  limbs(w) { footTo(1, hpt(_v1, 1, -0.56, -0.5, 0.06), w); kneeTo(1, bdir(_v2, -0.85, 0.3, 0.5), w); C.fpit[1] += (-0.6 - C.fpit[1]) * w; C.fyaw[1] += (-0.45 - C.fyaw[1]) * w; } };
HELD.legsWide = { v: [0, 0.1, 0.04, 0, 0, 0], crouch: 0.3,
  trunk(w) { C.pel.addScaledVector(C.up, 0.03 * w); },
  limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, hpt(_v1, k, s * 0.5, -0.6, 0.14), w); kneeTo(k, bdir(_v2, s * 0.7, 0.3, 0.6), w); C.fyaw[k] += (s * 0.5 - C.fyaw[k]) * w; } } };
// (the same, the vehicle kept down and out in front, for tricks that hold it near the body: the toboggan)
HELD.legsWideLow = Object.assign({}, HELD.legsWide, { v: [0, -0.03, 0.09, 0, 0, 0] });
HELD.legsSame = { v: [0, 0.12, 0, 0, 0.16, -0.22], crouch: 0.4,
  trunk(w) { C.py += 0.34 * w; C.ct -= 0.28 * w; C.pel.addScaledVector(C.lf, 0.05 * w); C.cs += 0.08 * w; },
  limbs(w) {
    footTo(0, hpt(_v1, 0, 0.62, -0.5, 0.12), w); kneeTo(0, bdir(_v2, 0.9, 0.4, 0.5), w); C.fyaw[0] += (0.5 - C.fyaw[0]) * w;
    footTo(1, ppt(_v1, 0.48, -0.32, 0.34), w); kneeTo(1, pdir(_v2, 0.4, 0.8, 0.5), w); C.fpit[1] += (-0.4 - C.fpit[1]) * w;
  } };
// (out wide in the pelvis's own frame, for a handstand: straight up and apart)
HELD.legsWideP = { limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, ppt(_v1, s * 0.42, -C.legLen * 0.86, 0.02), w); kneeTo(k, pdir(_v2, s * 0.6, 0.2, 0.8), w); C.fpit[k] += (-1.0 - C.fpit[k]) * w; } } };
HELD.legsSplit = { limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, ppt(_v1, s * 0.06, -C.legLen * 0.86, s * 0.42), w); kneeTo(k, pdir(_v2, 0, 0.3, s), w); } } };
// the vehicle: turned down on its side (the scooter's turndown, with the bars crossed); laid flatter in a whip
HELD.turndown = { v: [0.06, 0.08, 0, 0.08, -0.32, 1.0],
  trunk(w) { C.py -= 0.38 * w; C.ct += 0.3 * w; C.cs -= 0.16 * w; C.hy += 0.2 * w; } };
HELD.flatter = { v: [0, 0.03, 0, 0, 0.24, -0.4], trunk(w) { C.ct += 0.16 * w; C.cs += 0.08 * w; } };
// the snowbike's turndown: the front pulled up, the bike turned the other way from a whip with the bars crossed, the
// rider turned with it
HELD.turndownB = { v: [0.06, 0.06, 0, 0.45, -0.75, 0.95], st: -1.15, crouch: 0.45,
  trunk(w) { C.py -= 0.42 * w; C.ct += 0.34 * w; C.cl += 0.18 * w; C.hy += 0.25 * w; },
  limbs(w) { for (let k = 0; k < 2; k++) elbowTo(k, bdir(_v2, k ? -1 : 1, -0.2, -0.3), w); } };
// a hart attack: hands on the bars, the body pushed up over them and the legs straight up in the air
HELD.hart = { v: [0, -0.04, 0.08, -0.12, 0, 0], crouch: 0.1,
  trunk(w) {
    const p = _v1.copy(C.barMid).addScaledVector(C.up, C.bike ? 0.56 : 0.5).addScaledVector(C.fw, C.bike ? -0.44 : -0.3);
    C.pel.lerp(p, w); C.pp += (C.bike ? 1.95 : 2.15) * w; C.cl += (0.25 - C.cl) * w; C.hp += (-0.9 - C.hp) * w;
  },
  limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, ppt(_v1, s * 0.08, -C.legLen * 0.97, 0), w); kneeTo(k, pdir(_v2, 0, 0, 1), w); C.fpit[k] += (-1.0 - C.fpit[k]) * w; } } };
// the snowbike's saran wrap: the left leg swung up and round over the bars, the left hand off to let it by
HELD.saran = { v: [0, 0.06, 0.04, 0.14, 0, 0], crouch: 0.35,
  trunk(w) { C.pel.addScaledVector(C.up, 0.1 * w).addScaledVector(C.lf, -0.04 * w); C.cl -= 0.18 * w; C.cs -= 0.12 * w; C.hy += 0.15 * w; },
  limbs(w) {
    footTo(0, _v1.copy(C.barMid).addScaledVector(C.fw, 0.24).addScaledVector(C.up, 0.06).addScaledVector(C.lf, -0.02), w); kneeTo(0, bdir(_v2, 0.15, 1, 0.5), w); C.fpit[0] += (0.2 - C.fpit[0]) * w;
    handTo(0, spt(_v1, 0, 0.42, 0.42, 0.05), w); elbowTo(0, bdir(_v2, 1, 0, -0.3), w); C.curl[0] += (0.2 - C.curl[0]) * w;
  } };
// the snowbike's rock solid: stretched out flat over the bike, high, hands on the bars, legs straight back
HELD.rocksolid = { v: [0, -0.02, 0.12, -0.06, 0, 0], crouch: 0.15,
  trunk(w) {
    const p = _v1.copy(C.barMid).addScaledVector(C.fw, -(C.armL * 0.6 + 0.36)).addScaledVector(C.up, 0.24);
    C.pel.lerp(p, w); C.pp += 1.45 * w; C.cl += (0.1 - C.cl) * w; C.hp += (-1.05 - C.hp) * w;
  },
  limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, ppt(_v1, s * 0.09, -C.legLen * 0.97, -0.02), w); kneeTo(k, pdir(_v2, 0, 0, 1), w); C.fpit[k] += (-1.0 - C.fpit[k]) * w; } } };
// the snowbike's seat grab: off the saddle out to the right, the right hand on the saddle, legs out behind that side
HELD.seatgrab = { v: [0.04, 0.08, 0, 0.04, 0.1, 0.36], crouch: 0.3,
  trunk(w) {
    const p = _v1.copy(C.seat).addScaledVector(C.lf, -0.16).addScaledVector(C.up, 0.1).addScaledVector(C.fw, -0.02);
    C.pel.lerp(p, w); C.pp += 0.55 * w; C.pr += 0.45 * w; C.ct -= 0.3 * w; C.cs -= 0.42 * w; C.cl += 0.3 * w; C.hy += 0.25 * w;
  },
  limbs(w) {
    for (let k = 0; k < 2; k++) { footTo(k, ppt(_v1, (k ? -0.16 : 0.02), -C.legLen * 0.94, -0.12), w); kneeTo(k, pdir(_v2, 0, 0, 1), w); C.fpit[k] += (-0.8 - C.fpit[k]) * w; }
    handTo(1, _v1.copy(C.seat).addScaledVector(C.lf, -0.07).addScaledVector(C.up, 0.04), w, 0.35); C.hgrab[1] += (1 - C.hgrab[1]) * w; elbowTo(1, bdir(_v2, -1, 0.2, -0.3), w);
  } };
// (the snowbike's tuck no hander: off the saddle, knees up against the bars)
HELD.tucknhB = { v: [0, 0.12, -0.05, 0.1, 0, 0], crouch: 0.6,
  trunk(w) { C.pel.addScaledVector(C.up, 0.16 * w).addScaledVector(C.fw, 0.1 * w); C.cl += 0.35 * w; C.hp -= 0.15 * w; },
  limbs(w) { for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, _v1.copy(C.seat).addScaledVector(C.lf, s * 0.12).addScaledVector(C.fw, 0.18).addScaledVector(C.up, 0.06), w); kneeTo(k, bdir(_v2, s * 0.05, 0.8, 1), w);
    handTo(k, spt(_v1, k, s * 0.55, 0.02, 0.1), w); elbowTo(k, bdir(_v2, 0, -1, -0.3), w); C.curl[k] += (0.2 - C.curl[k]) * w; } } };
// the snowbike's superman: off the saddle, body flat behind the bars over the rear ski
HELD.supermanB = Object.assign({}, HELD.superman, { v: [0, 0.04, 0.12, 0.1, 0, 0] });
// a held trick's poses: its own (the bike's own where it has one), or its E / R version's mix of them (made once)
const heldList = (def, bike) => {
  if (!def || def.act) return null;
  const key = bike ? '_hlB' : '_hlS';
  if (def[key]) return def[key];
  const L = []; for (const id of def.mix || [def.id]) { const h = (bike && HELD[id + 'B']) || HELD[id]; if (h) L.push(h); }
  return (def[key] = L);
};

/* The timed tricks, thrown with the whole body (2026-11-06, for "make it so that the wips/barspins/other tricks similar
   are not like roboticy and are more jibbery with the whole body moving in response to like the direction of movement
   to throw the object around more exaggerated", then "get the entire body to move for the tailwhip and other motions to
   make it seem more like real life"). Each round goes through the beats riders describe for a whip or a barspin (B
   below): a wind-up the other way (the hips coiled against the throw, the shoulders against the hips, the knees loaded,
   the part dipped back a little), the throw (the hips and legs scooping the deck round and the back foot kicking it on,
   or the shoulders and arms pushing and pulling the bars round, the body popping up, the chest and shoulders turning
   against whatever throws), the quick middle (the part at its fastest, the knees tucked up out of its way, the arms
   pushing the bars out to let it by, the head spotting it), the catch (the back foot first, then the front, or the
   hands, the knees and elbows taking it) and a settle. The part follows those beats exactly (spinE); the body's moves
   are targets (J) for underdamped springs in rig.p (throwPose), so the body lags the throw a touch, swings past it,
   carries on a little after the round and settles, and one trick runs into the next. A round keeps its length (skier.js
   actDur), so landings and scoring are as they were.
   Chains (2026-11-06, for "make it so that like tailwhips briflips barspins etc can all be continuable like after each
   tailwhip if you do another one the feet dont have to stay back onto the board"): skier.js says when another round of
   the same trick follows (S.actNext: the key held, or pressed again in the round) and how many are done (S.actN). A round
   that goes on into another has no catch (k.outK 0: the part keeps its speed, the feet stay tucked, a barspin's hands
   stay off), and one that follows another starts from the middle of the trick (k.inK 0: no wind-up, the feet still up),
   with a smaller drive of the hips and arms again (B.r), so a double or a triple reads as one motion and the feet only
   come back on the last.
   part(u, k) sets C.whipA (the deck round the bars' axis), C.barA (the bars round), C.flip (the whole vehicle round the
   grips' line), C.v* (the vehicle moved); j(u, f, k) adds the body's targets to J (u the round, f how far the part is
   round, k the round's flags inK, outK, bike). */
const sigm = (x, p) => { const a = Math.pow(x, p), b = Math.pow(1 - x, p); return a / (a + b); };
// the part's turn through a round, in turns (0 -> 1): back the other way a little first (wd, the wind-up), slow off the
// foot or hand, quickest through the middle, a touch past at the catch (ov) and back; between the rounds of a chain it
// goes on at a steady 1.25 turns a round instead of stopping. q under 1 brings the quickest part earlier (a part thrown
// hard, a barspin's bars, is at its fastest just after the hand lets go)
function spinE(u, wd, ov, inK, outK, q = 1) {
  q = 1 - (1 - q) * inK;     // (a round carried on from the last goes round evenly, not thrown again)
  const a = 0.08 * inK, b = 1 - 0.16 * outK, x = clamp((u - a) / (b - a), 0, 1), v = 1.25 * (b - a);
  let f = sigm(q === 1 ? x : Math.pow(x, q), 1.9) + (1 - inK) * v * x * (1 - x) * (1 - x) + (1 - outK) * v * x * x * (x - 1);
  if (u < 0.2) f -= wd * inK * Math.sin(Math.PI * u / 0.2) ** 2;
  if (u > 0.74) f += ov * outK * Math.sin(Math.PI * (u - 0.74) / 0.26) ** 2;
  return f;
}
// how much of a vehicle move a round has on: in over [a, a + b] from the start and out by the end, or held through a chain
const envK = (u, k, a, b) => (1 - k.inK * (1 - smooth01((u - a) / b))) * (1 - k.outK * (1 - smooth01((1 - u - a) / b)));
// the beats of a round, each 0 -> 1 -> 0 (w to 1.8): w the wind-up, t the throw, m the quick middle, c the catch, on the whole of it,
// r the drive again at the start of a round that follows another in a chain
const B = { w: 0, t: 0, m: 0, c: 0, on: 0, r: 0 };
// (uw: the round as it is, for the wind-up, which starts with the round; u: a little ahead, for the rest)
function beats(u, inK, outK, uw = u) {
  B.w = 1.8 * bump(uw, 0, 0.06, 0.08, 0.22) * inK;     // (taller than the others: it is short, and the springs only get part way)
  B.t = bump(u, 0.1, 0.2, 0.26, 0.44) * inK;
  B.m = (1 - inK * (1 - smooth01((u - 0.2) / 0.16))) * (1 - outK * smooth01((u - 0.6) / 0.16));
  B.c = bump(u, 0.64, 0.78, 0.86, 1) * outK;
  B.on = (1 - inK * (1 - smooth01((u - 0.02) / 0.12))) * (1 - outK * smooth01((u - 0.8) / 0.16));
  B.r = bump(u, 0, 0.14, 0.22, 0.5) * (1 - inK);
}
// a foot off the deck (or pegs) from u0 on, and back down from c0 for the catch: how much it is off (the catch late in the
// round, so another press up to about four fifths of the way round still finds the feet up)
const footOff = (u, k, u0, c0 = 0.76) => (1 - k.inK * (1 - smooth01((u - u0) / 0.08))) * (1 - k.outK * smooth01((u - c0) / 0.1));

/* The body's targets and their springs: [rest value, natural frequency rad/s, damping ratio]. The trunk loose and quick
   (under half damped, so it swings past and comes back), the feet and hands quicker and firmer, the head's look slower.
   py/ct/cl/cs/pr/pp: the pelvis's yaw, the chest's twist from it, lean and side bend, the pelvis's roll and pitch (as on
   C); ph/px/pz the pelvis moved up, left, forward (m); tk0/tk1 each foot tucked up off the deck, tUp/tOut/tFwd where to
   (from its hip, body frame); kick the kicking foot flicked out (sc.kickK, sc.kickV); ef the elbows out; v* the vehicle
   moved as C.v* (the arms pulling, pushing and twisting the bars); look how much the head follows the part (sc.lookK);
   rel the hands off the bars (sc.hOff); fh the right hand down on the deck; kw the knees opened out wide */
const JF = {
  py: [0, 34, 0.42], ct: [0, 36, 0.42], cl: [0, 32, 0.45], cs: [0, 32, 0.45], pr: [0, 32, 0.45], pp: [0, 26, 0.5],
  ph: [0, 32, 0.45], px: [0, 28, 0.5], pz: [0, 28, 0.5],
  tk0: [0, 30, 0.7], tk1: [0, 30, 0.7], tUp: [-0.3, 26, 0.8], tOut: [0.16, 26, 0.8], tFwd: [-0.1, 26, 0.8],
  kick: [0, 34, 0.6], ef: [0, 22, 0.55],
  vx: [0, 30, 0.5], vy: [0, 30, 0.5], vz: [0, 30, 0.5], vyaw: [0, 30, 0.5], vroll: [0, 30, 0.5], vpit: [0, 30, 0.5],
  look: [0, 14, 0.9], rel: [0, 30, 0.85], fh: [0, 30, 0.8], kw: [0, 28, 0.7],
  of: [0, 30, 0.6], sw: [0, 30, 0.6],
};
const JK = Object.keys(JF), J = {}, JS = {}, SPN = {};
for (const k of JK) { J[k] = 0; JS[k] = 0; SPN[k] = 'xj_' + k; }
const KF = { inK: 1, outK: 1, wd: 1, ov: 1, bike: false };
// the body's lead on the round, in seconds: its springs lag a few hundredths, so it is asked a little ahead of the part
const LEAD = 0.035;
// the rig being posed (the tricks' j set where its head looks, which foot kicks and where the hands go)
let sc_ = null;
// the chest's turn in the world (the pelvis's plus its own twist) asked of the trunk: py the hips, cw the shoulders
const trunkYaw = (py, cw) => { J.py += py; J.ct += cw - py; };

const ACT = {
  tailwhip: {
    part(u, k) { C.whipA += TAU * (C.wf = spinE(u, 0.035 * k.wd, 0.02 * k.ov, k.inK, k.outK, 0.8)); C.wdir = 1; C.vy += 0.1 * envK(u, k, 0, 0.5); },
    j(u, f, k) {
      // the deck goes round anticlockwise seen from above, its tail out to the rider's right first. The hips and legs
      // coil the other way, then scoop it round (the back foot rides the tail round and kicks it on) and swing back a
      // little as it flies round under them; the shoulders turn against the hips all the way, and against the deck
      trunkYaw(-0.42 * B.w + 0.66 * B.t - 0.24 * B.m + 0.3 * B.r, 0.16 * B.w - 0.32 * B.t + 0.1 * B.m - 0.16 * B.r);
      J.cl += 0.34 * B.w - 0.2 * B.t + 0.24 * B.m + 0.4 * B.c + 0.06 * B.r;
      J.cs += 0.12 * B.w - 0.28 * B.t + 0.08 * B.m - 0.12 * B.r;
      J.pr += 0.06 * B.w - 0.12 * B.t - 0.05 * B.r;
      // the body bobs: down to load, up with the pop, a little up in the middle, down to take the catch; the weight
      // over the front foot to load, then away from the kick
      J.ph += -0.1 * B.w + 0.12 * B.t + 0.05 * B.m - 0.13 * B.c + 0.05 * B.r;
      J.px += 0.06 * B.t - 0.02 * B.m + 0.03 * B.r;
      J.pz += 0.03 * B.w - 0.03 * B.t;
      // the front foot up at the throw; the back one rides the tail round until the deck is well on its way, kicks out
      // after it and tucks; at the catch the back foot comes down first, then the front
      J.tk0 += footOff(u, k, 0.06, 0.8);
      J.tk1 += (1 - k.inK * (1 - smoothstep(0.08, 0.17, f))) * (1 - k.outK * smooth01((u - 0.77) / 0.1));
      J.kick += k.inK * k.wd * bump(f, 0.07, 0.14, 0.2, 0.42); sc_.kickK = 1; sc_.kickV = k.bike ? KICK_B : KICK_S;
      // the arms: the bars pulled in and down to load, lifted at the pop and twisted with the shoulders, pushed out and
      // down to let the deck by, pulled back to meet the feet at the catch
      J.ef += 0.7 * B.t + 0.4 * B.m + 0.3 * B.r;
      J.vy += -0.03 * B.w + 0.08 * B.t - 0.02 * B.m - 0.05 * B.c + 0.03 * B.r;
      J.vz += -0.04 * B.w + 0.06 * B.m - 0.03 * B.c;
      J.vpit += -0.06 * B.w + 0.1 * B.t + 0.02 * B.m - 0.06 * B.c + 0.05 * B.r;
      J.vyaw += 0.08 * B.w - 0.16 * B.t + 0.05 * B.m - 0.08 * B.r;
      J.vroll += -0.1 * B.t + 0.07 * B.m;
      J.tUp = -0.27; J.tOut = 0.17; J.tFwd = -0.12;
      if (k.bike) {
        // (the snowbike's frame sweeps round under the seat: up off the saddle, knees up high and wide, the bike pushed
        // down away under the bars)
        J.ph += 0.14 * B.w + 0.22 * B.t + 0.24 * B.m - 0.05 * B.c + 0.04 * B.r;
        J.cl += 0.12 * B.t + 0.1 * B.m; J.vy += -0.12 * B.t - 0.14 * B.m;
        J.tUp = -0.14; J.tOut = 0.3; J.tFwd = 0.02;
      }
      J.look += 0.85 * B.on; sc_.lookK = 'deck';
    },
  },
  /* (2026-11-08) the heelwhip: the tailwhip's mirror. The deck goes round clockwise seen from above, the front foot's
     heel pushing it forward and round (riders: "the deck kicked forward with the heel", the scoop the other way); the
     back foot lifts first, the front one rides the deck until it is going and kicks it on, the hips coil and scoop the
     other way from a tailwhip, the shoulders against them */
  heelwhip: {
    part(u, k) { C.whipA -= TAU * (C.wf = spinE(u, 0.035 * k.wd, 0.02 * k.ov, k.inK, k.outK, 0.8)); C.wdir = -1; C.vy += 0.1 * envK(u, k, 0, 0.5); C.vz += 0.06 * envK(u, k, 0, 0.4); },
    j(u, f, k) {
      trunkYaw(0.42 * B.w - 0.62 * B.t + 0.22 * B.m - 0.3 * B.r, -0.16 * B.w + 0.32 * B.t - 0.1 * B.m + 0.16 * B.r);
      J.cl += 0.28 * B.w - 0.26 * B.t + 0.2 * B.m + 0.4 * B.c + 0.06 * B.r;
      J.cs += -0.12 * B.w + 0.28 * B.t - 0.08 * B.m + 0.12 * B.r;
      J.pr += -0.06 * B.w + 0.12 * B.t + 0.05 * B.r;
      // (the heel pushes forward: the body sits back off it, then over the deck again for the catch)
      J.ph += -0.1 * B.w + 0.12 * B.t + 0.05 * B.m - 0.13 * B.c + 0.05 * B.r;
      J.px += -0.06 * B.t + 0.02 * B.m - 0.03 * B.r;
      J.pz += -0.04 * B.w - 0.06 * B.t + 0.03 * B.c;
      J.tk1 += footOff(u, k, 0.06, 0.8);
      J.tk0 += (1 - k.inK * (1 - smoothstep(0.08, 0.17, f))) * (1 - k.outK * smooth01((u - 0.77) / 0.1));
      J.kick += k.inK * k.wd * bump(f, 0.07, 0.14, 0.2, 0.42); sc_.kickK = 0; sc_.kickV = k.bike ? HKICK_B : HKICK_S;
      J.ef += 0.7 * B.t + 0.4 * B.m + 0.3 * B.r;
      J.vy += -0.03 * B.w + 0.08 * B.t - 0.02 * B.m - 0.05 * B.c + 0.03 * B.r;
      J.vz += 0.04 * B.w + 0.06 * B.m - 0.03 * B.c;
      J.vpit += -0.06 * B.w + 0.1 * B.t + 0.02 * B.m - 0.06 * B.c + 0.05 * B.r;
      J.vyaw += -0.08 * B.w + 0.16 * B.t - 0.05 * B.m + 0.08 * B.r;
      J.vroll += 0.1 * B.t - 0.07 * B.m;
      J.tUp = -0.27; J.tOut = 0.17; J.tFwd = -0.08;
      if (k.bike) {
        J.ph += 0.14 * B.w + 0.22 * B.t + 0.24 * B.m - 0.05 * B.c + 0.04 * B.r;
        J.cl += 0.12 * B.t + 0.1 * B.m; J.vy += -0.12 * B.t - 0.14 * B.m;
        J.tUp = -0.14; J.tOut = 0.3; J.tFwd = 0.04;
      }
      J.look += 0.85 * B.on; sc_.lookK = 'deck';
    },
  },
  /* (2026-11-08) the snowbike's decade: the rider swings right round the bars, holding them, while the bike stays where
     it is. Round the rider it is a whip (the frame round the head tube, the bars held), so it is posed as one, and then
     the whole of it, rider and bike, is turned back round the head tube by the same (C.decA, finishPose): the bike ends
     up still and the rider and the bars go round it. Off the pegs, up over the bars, legs swung out round the front. */
  decade: {
    part(u, k) { C.whipA -= TAU * (C.wf = spinE(u, 0.03 * k.wd, 0.02 * k.ov, k.inK, k.outK, 0.9)); C.wdir = -1; C.decA = C.whipA; C.vy -= 0.06 * envK(u, k, 0, 0.4); },
    j(u, f, k) {
      trunkYaw(-0.2 * B.w + 0.3 * B.t + 0.1 * B.m, 0.1 * B.w - 0.2 * B.t);
      J.cl += 0.2 * B.w + 0.3 * B.t + 0.42 * B.m + 0.3 * B.c;
      J.cs += 0.1 * B.t + 0.08 * B.m;
      J.ph += -0.08 * B.w + 0.2 * B.t + 0.24 * B.m - 0.1 * B.c + 0.06 * B.r;
      J.pz += 0.12 * B.t + 0.14 * B.m;
      J.tk0 += footOff(u, k, 0.06, 0.8); J.tk1 += footOff(u, k, 0.04, 0.82);
      J.tUp = -0.22; J.tOut = 0.26; J.tFwd = 0.1;
      J.ef += 0.5 * (B.t + B.m) + 0.2 * B.r;
      J.look += 0.6 * B.on; sc_.lookK = 'bars';
    },
  },
  kickless: {
    // the deck pushed out in front the other way round, and the bars swung in a circle so the arms carry it round
    // (the circle leans the bars less on its way back past the chest)
    part(u, k) { C.whipA -= TAU * (C.wf = spinE(u, 0.03, 0.02, k.inK, k.outK)); C.wdir = -1; const e = envK(u, k, 0, 0.45); C.circA = -TAU * u; C.circ = 0.32 * e * (1 - 0.55 * Math.max(0, -Math.cos(C.circA))); C.vy += 0.12 * e; },
    j(u, f, k) {
      // clockwise seen from above (its tail out to the left first): the body coils the other way, both feet shove the
      // deck out in front and come off it, then the shoulders and chest go round with the bars the arms are swinging in
      // a circle, the hips against them
      const e = envK(u, k, 0, 0.45), A = -TAU * u, sx = -Math.sin(A), cz = Math.cos(A);
      trunkYaw(0.3 * B.w - 0.42 * B.t + 0.12 * B.m - 0.14 * sx * e * B.m - 0.2 * B.r, 0.12 * B.w - 0.2 * B.t + 0.22 * sx * e * B.m + 0.1 * B.r);
      J.cl += 0.3 * B.w - 0.3 * B.t + 0.28 * cz * e * B.m + 0.42 * B.c + 0.08 * B.r;
      J.cs += -0.3 * sx * e * B.m;
      J.ph += -0.09 * B.w + 0.1 * B.t + 0.05 * B.m - 0.12 * B.c + 0.04 * B.r;
      J.pz += 0.03 * B.w - 0.07 * B.t; J.px += -0.05 * sx * e * B.m;
      J.tk0 += (1 - k.inK * (1 - smoothstep(0.06, 0.14, f))) * (1 - k.outK * smooth01((u - 0.74) / 0.1));
      J.tk1 += (1 - k.inK * (1 - smoothstep(0.05, 0.12, f))) * (1 - k.outK * smooth01((u - 0.76) / 0.1));
      J.tUp = -0.24; J.tOut = 0.17; J.tFwd = -0.14;
      J.ef += 0.45 * B.w + 0.85 * (B.t + B.m);
      J.vz += -0.04 * B.w + 0.08 * B.t - 0.04 * B.c;
      J.vy += -0.03 * B.w - 0.04 * B.c;
      J.look += 0.85 * B.on; sc_.lookK = 'deck';
    },
  },
  barspin: {
    part(u, k) { C.barA += TAU * (C.wf = spinE(u, 0.045, 0.025, k.inK, k.outK, 0.6)); C.vy += 0.05 * envK(u, k, 0, 0.5); },
    j(u, f, k) {
      // the bars thrown round anticlockwise seen from above (the right hand pushes its grip forward, the left pulls it
      // back), let go, spun and caught: the shoulders coil, throw them with the arms and turn back as they spin, the
      // hips against the shoulders, the head watching the bars round
      trunkYaw(0.14 * B.w - 0.2 * B.t + 0.08 * B.m - 0.08 * B.r, -0.3 * B.w + 0.42 * B.t - 0.14 * B.m + 0.14 * B.r);
      J.cl += 0.3 * B.w - 0.18 * B.t + 0.08 * B.m + 0.38 * B.c + 0.06 * B.r;
      J.cs += 0.12 * B.w - 0.18 * B.t + 0.05 * B.m;
      J.ph += -0.08 * B.w + 0.08 * B.t + 0.04 * B.m - 0.1 * B.c + 0.04 * B.r + (k.bike ? 0.04 * B.m : 0);
      // the hands go round with the grips for the first part of the turn, are let go and fly on the way they were going,
      // out and up, open, and come back to take the grips again as they come round (not between the rounds of a chain)
      J.rel += (1 - k.inK * (1 - smoothstep(0.03, 0.1, f))) * (1 - k.outK * smoothstep(0.74, 0.86, u));
      sc_.hOff[0] = HOFF_L; sc_.hOff[1] = HOFF_R;
      J.ef += 0.5 * B.t + 0.35 * B.m;
      // the scooter pulled up to the feet as the knees bring it up (the bike: the knees grip the frame), then pushed down
      // again for the catch
      J.vy += 0.03 * B.w + 0.11 * B.t + 0.07 * B.m - 0.04 * B.c + 0.03 * B.r;
      J.vpit += (k.bike ? 0.1 : -0.12) * B.t + (k.bike ? 0.04 : -0.06) * B.m;
      // (the snowbike's knees are up by the bars, on its pegs: they open out wide while the bars spin, so the bar ends go
      // round between them)
      if (k.bike) J.kw += Math.max(B.t, B.m) + B.r;
      // (the scooter's bars are low and close: pushed out in front as they go, the hips back and the chest up, so the
      // grip coming back past the rider clears the belly)
      else { J.vz += 0.12 * B.on + 0.04 * B.r; J.pz -= 0.04 * B.on; J.cl -= 0.28 * (B.t + B.m) + 0.1 * B.r; J.vy -= 0.05 * (B.t + B.m); }
      J.look += 0.75 * B.on; sc_.lookK = 'bars';
    },
  },
  briflip: { part(u, k) { briPart(u, 1, k); }, j(u, f, k) { briJ(u, f, 1, k); } },
  inward: { part(u, k) { briPart(u, -1, k); }, j(u, f, k) { briJ(u, f, -1, k); } },
  fingerwhip: {
    // (the scooter pulled up high so the deck comes up to the hand, as it always was, and down again under the feet
    // before they come back onto it)
    part(u, k) { const e = envK(u, k, 0, 0.15) * (1 - k.outK * smooth01((u - 0.7) / 0.2)); C.whipA += TAU * (C.wf = spinE(u, 0.03, 0.02, k.inK, k.outK)); C.wdir = 1; C.vy += 0.46 * e; C.vz -= 0.06 * e; },
    j(u, f, k) {
      // the right hand down to the deck and the deck spun round by it: the right shoulder drops into the reach, the chest
      // folds over and turns with the deck as the hand drives it round (the hips against it), then comes back up to the
      // bars; in a chain the hand stays on it, driving it round again
      J.fh += (1 - k.inK * (1 - smooth01((u - 0.02) / 0.1))) * (1 - k.outK * smooth01((u - 0.5) / 0.3));
      const sw = 0.3 * Math.sin(TAU * f) * B.m;
      trunkYaw(-0.2 * B.w + 0.24 * B.t - 0.1 * B.m - 0.5 * sw - 0.1 * B.r, -0.06 * B.w - 0.06 * B.t + sw + 0.1 * B.r);
      // (the chest held back while the scooter comes up past it, then folded down to the deck; the feet tucked high and
      // wide, out of the way of the deck going round under them up at that height)
      J.cl += -0.06 * B.w + 0.62 * B.t + 0.66 * B.m + 0.3 * B.c;
      J.cs += -0.08 * B.w + 0.3 * B.t + 0.22 * B.m;
      J.ph += -0.04 * B.w + 0.03 * B.t - 0.1 * B.c + 0.03 * B.r;
      J.vz += 0.05 * B.w;
      J.tk0 += footOff(u, k, 0.02, 0.86); J.tk1 += footOff(u, k, 0.04, 0.84);
      J.tUp = -0.12; J.tOut = 0.24; J.tFwd = -0.18;
      J.look += 0.85 * B.on; sc_.lookK = 'deck';
    },
  },
  // a tailwhip, a briflip and a tailwhip, one after the other, the feet off from the first kick to the last catch
  buttercup: {
    part(u, k) {
      if (u < 0.27) ACT.tailwhip.part(u / 0.27, subK(k.inK, 1, 1, 0, k.bike));
      else if (u < 0.73) briPart((u - 0.27) / 0.46, 1, subK(1, 1, 0, 0, k.bike));
      else ACT.tailwhip.part((u - 0.73) / 0.27, subK(1, k.outK, 0, 1, k.bike));
    },
    j(u, f, k) {
      if (u < 0.27) { const v = u / 0.27, kk = subK(k.inK, 0, 1, 0, k.bike); beats(v, kk.inK, kk.outK); ACT.tailwhip.j(v, f, kk); }
      else if (u < 0.73) { const v = (u - 0.27) / 0.46, kk = subK(0, 0, 0, 0, k.bike); beats(v, 0.35, 0.35); briJ(v, f, 1, kk, true); }
      else { const v = (u - 0.73) / 0.27, kk = subK(0, k.outK, 0, 1, k.bike); beats(v, kk.inK, kk.outK); ACT.tailwhip.j(v, f, kk); }
    },
  },
};
/* the mods on a timed trick's round (its E and R versions, VARY): what they add to the part going round (modPart) and
   to the body's targets (modJ), on top of the trick's own */
// a rewind: round and back the other way, the part at the same place at the start and end of the round
const wiper = f => 0.5 * (1 - Math.cos(TAU * f));
function modPart(A, u, k) {
  const m = A.mods;
  for (let i = 0; i < m.length; i++) {
    const id = m[i];
    if (id === 'bars') {
      // (a barspin thrown in a little after the round starts; in a buttercup, in its first tailwhip)
      const ub = A.base === 'buttercup' ? clamp(u / 0.27, 0, 1) : u;
      C.barA += TAU * spinE(clamp((ub - 0.05) / 0.9, 0, 1), 0.03, 0.02, k.inK, A.base === 'buttercup' ? 1 : k.outK, 0.6);
    } else if (id === 'whip') C.whipA += TAU * spinE(clamp((u - 0.12) / 0.76, 0, 1), 0.02, 0.02, k.inK, k.outK, 0.85);
    else if (id === 'wiper') C.whipA += C.wdir * TAU * (wiper(C.wf) - C.wf);
  }
}
function modJ(A, u, f, k) {
  const m = A.mods;
  for (let i = 0; i < m.length; i++) {
    const id = m[i];
    if (id === 'oneFoot') J.of += footOff(u, k, 0.1, 0.72) * (k.inK ? smoothstep(0.08, 0.2, u) : 1);
    else if (id === 'spread') J.sw += footOff(u, k, 0.08, 0.74) * (k.inK ? smoothstep(0.06, 0.18, u) : 1);
    else if (id === 'bars') {
      const ub = A.base === 'buttercup' ? clamp(u / 0.27, 0, 1) : u, outK = A.base === 'buttercup' ? 1 : k.outK;
      J.rel += (1 - k.inK * (1 - smoothstep(0.08, 0.16, ub))) * (1 - outK * smoothstep(0.74, 0.86, ub));
      sc_.hOff[0] = HOFF_L; sc_.hOff[1] = HOFF_R; J.ef += 0.25 * B.m;
    } else if (id === 'tuck') {
      J.tk0 += footOff(u, k, 0.06, 0.78); J.tk1 += footOff(u, k, 0.06, 0.78);
      J.tUp = -0.1; J.tOut = 0.12; J.tFwd = 0.14; J.vy += 0.12 * B.on; J.cl += 0.22 * B.m;
    }
  }
}
const _sk = { inK: 1, outK: 1, wd: 1, ov: 1, bike: false };
const subK = (inK, outK, wd, ov, bike) => { _sk.inK = inK; _sk.outK = outK; _sk.wd = wd; _sk.ov = ov; _sk.bike = bike; return _sk; };
// where a tailwhip's kicking foot flicks to, from its hip [left, up, forward] (body frame): out after the tail, back
const KICK_S = [-0.56, -0.5, -0.22], KICK_B = [-0.5, -0.4, -0.26];
// a heelwhip's: the front foot's heel pushed forward and out, after the deck it sent round
const HKICK_S = [0.3, -0.5, 0.42], HKICK_B = [0.28, -0.4, 0.4];
// where the hands go in a barspin once let go [out, up, forward] from where their grip would be: the left hand back and
// out, the right one on forward and up (the way each was going when it let go)
const HOFF_L = [0.3, 0.26, -0.12], HOFF_R = [0.04, 0.32, 0.14];
/* a briflip: the scooter pushed out to the rider's right and turned a quarter (the deck pointing out to the right, the
   bars still across), flipped a whole turn round the line through the grips (dir 1: the deck forwards and up first, a
   backflip of the scooter; -1: backwards and up first, the inward), then straightened back under the feet */
function briPart(u, dir, k) {
  const e = envK(u, k, 0, 0.16);
  C.vx -= 0.38 * e; C.vy += 0.1 * e; C.byaw += Math.PI / 2 * e; C.steerX -= Math.PI / 2 * e;
  C.flip -= dir * TAU * (C.wf = spinE(u, 0.03 * k.wd, 0.02 * k.ov, k.inK, k.outK));
}
// the body in a briflip: the arms throw the scooter out to the right and over, the chest and shoulders turn to it and
// lean back with it (an inward: over it), the hips go the other way, the legs tuck up and away, the head follows it round
function briJ(u, f, dir, k, inner) {
  const back = dir > 0;
  trunkYaw(0.12 * B.w - 0.18 * B.t - 0.1 * B.m + 0.1 * B.r, 0.32 * B.w - 0.6 * B.t - 0.4 * B.m - 0.12 * B.r);
  J.cl += 0.3 * B.w + (back ? -0.34 : 0.26) * B.t + (back ? -0.2 : 0.3) * B.m + 0.42 * B.c + (back ? -0.08 : 0.08) * B.r;
  J.cs += -0.1 * B.w + 0.22 * B.t + 0.14 * B.m + 0.06 * B.r;
  J.pr += -0.1 * B.t - 0.06 * B.m;
  J.px += 0.04 * B.w + 0.1 * B.t + 0.09 * B.m;
  J.ph += -0.09 * B.w + 0.1 * B.t + 0.05 * B.m - 0.12 * B.c + 0.04 * B.r;
  if (inner) { J.tk0 += 1; J.tk1 += 1; } else { J.tk0 += footOff(u, k, 0.08); J.tk1 += footOff(u, k, 0.1, 0.73); }
  J.tUp = -0.28; J.tOut = 0.17; J.tFwd = back ? 0.02 : -0.16;
  J.ef += 0.3 * B.t + 0.3 * B.m;
  J.vz += -0.04 * B.w - 0.04 * B.c;
  J.look += 0.85 * B.on; sc_.lookK = 'scoot';
}

/* this frame's round: whether it follows another of the same trick (KF.inK 0: skier.js's actN, or the round seen to wrap
   for a replay or test that does not say), whether another follows it (KF.outK 0: skier.js's actNext, else the same
   trick's key still held; a spring, so a press late in a round eases the catch out and letting go late eases it in) */
function actFlags(sc, A, u, td, sp, bike, seq, trDef) {
  sc_ = sc;
  if (A) {
    if (sc.jA !== A) { sc.jRound = 0; actOrder(sc, A, seq, trDef); } else if (u < sc.jU - 0.5) sc.jRound++;
    sc.jA = A; sc.jU = u;
    const next = sc.pNext !== undefined ? sc.pNext : A.loop !== false && !!td && td.id === A.id;
    KF.inK = (sc.pN !== undefined ? sc.pN > 0 : sc.jRound > 0) ? 0 : 1;
    KF.outK = clamp(sp('xj_out', next ? 0 : 1, 60), 0, 1);
  } else { sc.jA = null; sp('xj_out', 1, 60); KF.inK = 1; KF.outK = 1; }
  KF.bike = bike; KF.ov = 1; KF.wd = A ? sc.ordWd : 1; KF.flipB = A ? sc.ordFlip : 0;
}
/* (2026-11-08, for "the whole body reacts to ... the order of tricks") a trick thrown after something else in the same
   air (P's S.airSeq: a spin, a flip, a grab, another trick; not its own key) starts from a body already moving: a
   smaller wind-up, and after a flip the knees and chest still tucked into the throw. Worked out once as it starts. */
function actOrder(sc, A, seq, trDef) {
  sc.ordWd = 1; sc.ordFlip = 0;
  if (!seq || !seq.length) return;
  const base = A.base || A.id;
  let end = seq.length; for (let j = seq.length - 1; j >= 0; j--) if (seq[j] === 'act:' + A.id) { end = j; break; }
  for (let j = 0; j < end; j++) {
    const tk = seq[j];
    if (tk.startsWith('act:') && tk.slice(4).split('_')[0] === base) continue;       // (the same trick, a chain)
    if (tk.startsWith('grab:')) { const d = trDef(tk.slice(5)); if (d && (d.base || d.id) === base) continue; }   // (its own key)
    sc.ordWd = 0.45; if (tk === 'flip' || tk === 'cork') sc.ordFlip = 1;
  }
}
// the body's targets for this frame's round (from its beats, a little ahead of the part) through the springs; with nothing
// going round they are at rest, and the springs settle the last throw
function throwPose(sc, A, u, sp) {
  for (let i = 0; i < JK.length; i++) J[JK[i]] = JF[JK[i]][0];
  if (A) {
    const uB = Math.min(1, u + LEAD / A.act);
    beats(uB, KF.inK, KF.outK, u); B.w *= KF.wd;
    ACT[A.base || A.id].j(uB, C.wf, KF);
    if (KF.flipB) { J.cl += 0.18 * B.t + 0.1 * B.m; J.tk0 += 0.3 * B.t; J.tk1 += 0.3 * B.t; }
    if (A.mods) modJ(A, uB, C.wf, KF);
  }
  for (let i = 0; i < JK.length; i++) { const k = JK[i], f = JF[k]; JS[k] = sp(SPN[k], J[k], f[1], f[2]); }
}
// (test handle: the targets, the sprung values and the beats, for tests that trace a round)
export const throwState = { J, JS, B, KF };
// the legs, elbows and hands the timed trick moves (after the base pose and any held trick)
function throwLimbs(sc) {
  // the legs tucked up out of the part's way (each foot on its own: the back one leaves a whip last), knees up and out
  for (let k = 0; k < 2; k++) {
    const w = clamp(k ? JS.tk1 : JS.tk0, 0, 1); if (w < 0.002) continue;
    const s = k ? -1 : 1;
    footTo(k, hpt(_v1, k, s * JS.tOut, JS.tUp, JS.tFwd), w);
    kneeTo(k, bdir(_v2, s * 0.32, 0.8, 1), w); C.fpit[k] += (-0.55 - C.fpit[k]) * w;
  }
  // (a version with one foot off: the front foot kicked out to the side; both legs out wide, as high as the trick tucks
  // them, out of the way of the part going round)
  const ow = clamp(JS.of, 0, 1);
  if (ow > 0.002) { footTo(0, hpt(_v1, 0, 0.62, -0.4, 0.14), ow); kneeTo(0, bdir(_v2, 0.9, 0.25, 0.45), ow); C.fpit[0] += (-0.75 - C.fpit[0]) * ow; C.fyaw[0] += (0.5 - C.fyaw[0]) * ow; }
  const sw = clamp(JS.sw, 0, 1);
  if (sw > 0.002) for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; footTo(k, hpt(_v1, k, s * 0.62, Math.min(-0.12, JS.tUp) - 0.05, 0.1), sw); kneeTo(k, bdir(_v2, s * 0.9, 0.2, 0.45), sw); C.fpit[k] += (-0.7 - C.fpit[k]) * sw; C.fyaw[k] += (s * 0.5 - C.fyaw[k]) * sw; }
  // the knees opened out wide, the feet where they are (out of the way of the bike's bars going round)
  const kn = clamp(JS.kw, 0, 1);
  if (kn > 0.002) for (let k = 0; k < 2; k++) kneeTo(k, bdir(_v2, k ? -1 : 1, 0.25, 0.45), 0.8 * kn);
  // the kick: one foot flicked out after the part, the way it was sent
  const kw = clamp(JS.kick, 0, 1);
  if (kw > 0.002) { const k = sc.kickK, s = k ? -1 : 1, K = sc.kickV; footTo(k, hpt(_v1, k, K[0], K[1], K[2]), kw); kneeTo(k, bdir(_v2, s * 0.3 + K[0], 0.3, 0.5), kw); C.fpit[k] += (-1.0 - C.fpit[k]) * kw; }
  // the elbows out to the sides and a little down, driving the bars
  const ew = clamp(JS.ef, 0, 1);
  if (ew > 0.002) for (let k = 0; k < 2; k++) elbowTo(k, bdir(_v2, k ? -1 : 1, -0.15, -0.25), 0.7 * ew);
  // the hands let go of the bars (a barspin), flying on the way they went, open, then back to take the grips again
  const rw = clamp(JS.rel, 0, 1);
  if (rw > 0.002) for (let k = 0; k < 2; k++) {
    const H = sc.hOff[k], s = k ? -1 : 1;
    handTo(k, _v1.copy(C.grip0[k]).addScaledVector(C.lf, s * H[0]).addScaledVector(C.up, H[1]).addScaledVector(C.fw, H[2]), rw, 0.85);
    C.curl[k] += (0.2 - C.curl[k]) * rw; elbowTo(k, bdir(_v2, s, -0.2, -0.3), 0.5 * rw);
  }
  // the right hand down on the deck (a finger whip), going round with it, then back to the bars
  const hw = clamp(JS.fh, 0, 1);
  if (hw > 0.002) { handTo(1, C.nose, hw, 0.4); C.hgrab[1] += (1 - C.hgrab[1]) * hw; elbowTo(1, bdir(_v2, -1, 0.3, -0.2), hw); }
}

Rig.poser.scoot = Rig.poser.bike = (rig, S0, dt) => {
  const sc = rig.sc; if (!sc) return;
  const S = liftStand(S0);
  // (stood at a lift's line or towed up the T-bar the stand-in has no velocity of its own: first person takes the place
  // as it is, rig.fpEase; eased, the body lagged 0.68 m behind on the T-bar, the bar and the stem in front of the eyes)
  if (S !== S0) S.onLift = true;
  // (2026-11-08, J's T-bar: stood on the deck or sat on the saddle on the snow (liftStand), the bar behind the thighs,
  // one hand on the stem as the bar comes in (tbar.on), the other on the bars)
  const TB = S0.liftKind === 'tbar' ? S0.tbar : null;
  C.tbW = TB ? clamp(TB.on ?? 1, 0, 1) : 0;
  if (TB) { C.tbK = TB.hand === 'L' ? 0 : 1; C.tbP.copy(TB.stem); }
  const cfg = sc.cfg, seat = cfg.seat, bike = cfg === BIKE, TR = bike ? BIKE_TRICKS : SCOOT_TRICKS, trDef = bike ? bikeTrickDef : scootTrickDef;
  const P = rig.p, sp = springBank(P, dt), b = rig.b;
  const st = S.state || 'ground', air = st === 'air', crash = st === 'crash', ground = st === 'ground', lift = st === 'lift';
  const t = S.t !== undefined ? S.t : (rig._t = (rig._t || 0) + dt);
  const vel = S.vel || ZERO, speed = S.speed !== undefined ? S.speed : vel.length();
  const R = rig.placeBody(S), BP = rig.body.position, qi = _qi.copy(R).invert();
  // on the chairlift: sat on the chair, the scooter or bike held hanging in front
  if (lift) {
    seatRider(rig, S, t); sc.steer.position.copy(sc.steerPos); sc.steer.quaternion.copy(sc.steerQ); sc.deck.position.set(0, 0, 0); sc.deck.quaternion.identity();
    holdOnLift(rig, sc.root, cfg.half || 0.5);
    rig._pst = st; sc.pAct = null; sc.jA = null; return;
  }
  const changed = rig._pst !== st;
  // how the body turns, and the snow's push sideways (for the lean into a turn)
  let wy = 0, wx = 0;
  if (rig._pq && dt > 0 && !changed) { const d = _q1.copy(rig._pq).invert().multiply(R), g = (d.w < 0 ? -2 : 2) / dt; wy = d.y * g; wx = d.x * g; if (Math.abs(wy) > 20 || Math.abs(wx) > 20) wy = wx = 0; }
  (rig._pq || (rig._pq = new THREE.Quaternion())).copy(R);
  const Wy = sp('swy', wy, 14), Wx = sp('swx', wx, 12);
  let sx = 0, sy = 0;
  rig._gT = ground && !changed ? (rig._gT || 0) + dt : 0;
  if (ground && rig._gT > 0.06 && dt > 0 && rig._pvOk) { const a = _acc.subVectors(vel, rig._pv).divideScalar(dt); a.y += 9.81; a.applyQuaternion(qi); sx = clamp(a.x, -13, 13); sy = clamp(a.y, -10, 40); }
  (rig._pv || (rig._pv = new THREE.Vector3())).copy(vel); rig._pvOk = true; rig._pst = st;
  const Sx = sp('ssx', sx, 10), phi = clamp(Math.atan2(-Sx, 9.81), -0.7, 0.7);
  /* (2026-11-08) on the snow and rails: one foot off (R, S.oneFoot: the foot on the other side from S.oneSide lifted), the
     feet together (E), a manual on the back of the deck (S, or N with Down: S.press under 0; the bike on its rear ski) or a
     nose manual (N: over 0; on a rail S.railPress), the push on the forward key (S.pushT, S.pushing: the scooter kicks
     with the back foot, the bike's rider kicks off the snow with each foot in turn and pumps the bars); the snow's bumps
     (the push up through the boards: the knees and arms give, a little underdamped); a landing (how hard and how far off
     the travel: the body folds into it and rings back, twisted towards the travel) and a takeoff (a hard pop, a roll-off,
     a late pop, a steep lip). All through springs. */
  const rail = st === 'rail', snow = ground || rail;
  const ofW = sp('sof', snow ? S.oneFoot || 0 : 0, 12), tgW = sp('stg', snow && !(S.oneFoot > 0.3) ? S.together || 0 : 0, 12);
  const prs = snow ? (rail ? (S.railPress || S.press || 0) : (S.press || 0)) : 0;
  const manW = sp('sman', clamp(-prs, 0, 1), 9), noseW = sp('snose', clamp(prs, 0, 1), 9);
  const puW = sp('spu', ground ? S.pushing || 0 : 0, 9), pt = S.pushT || 0;
  const syAvg = sp('say', sy, 1.5), bob = sp('sbob', ground ? clamp((sy - syAvg) * 0.006, -0.07, 0.07) : 0, 11, 0.4);   // (+: pressed down, the knees give)
  const lt = S.landT ?? 9, landL = sp('sland', snow && lt < 0.1 ? S.landHit || 0 : 0, 13, 0.4), landO = sp('slo', snow && lt < 0.6 ? clamp(S.landOff || 0, -0.9, 0.9) : 0, 9, 0.6);
  const TK = air ? S.takeoff : null, tkT = TK ? 1 - smoothstep(0.12, 0.5, TK.t) : 0, tkPop = TK ? TK.pop || 0 : 0;
  const flipB = air ? clamp(-Wx / 5, 0, 1) : 0, flipF = air ? clamp(Wx / 5, 0, 1) : 0, spinK = air ? clamp(Math.abs(Wy) / 6, 0, 1) : 0;
  // the push's stroke: the kicking foot (the scooter's back foot; the bike's each in turn), the power part, where it is
  C.pushW = 0;
  if (puW > 0.01) {
    if (pt < (sc.ptPrev ?? 0) - 0.5) sc.pushN = (sc.pushN || 0) + 1;
    C.pushK = bike ? (sc.pushN || 0) % 2 : 1;
    C.pushPow = pt < 0.45 ? Math.sin(Math.PI * pt / 0.45) : 0;
    // (planted ahead, swept back along the snow, lifted and brought forward again, and onto the deck at the end)
    C.pushZ = pt < 0.45 ? 0.28 - 0.86 * (pt / 0.45) : -0.58 + 0.86 * smooth01((pt - 0.45) / 0.55);
    C.pushY = pt < 0.45 ? 0 : 0.2 * Math.sin(Math.PI * (pt - 0.45) / 0.55);
    C.pushW = puW * smooth01(pt / 0.06) * (bike ? 1 : 1 - smooth01((pt - 0.86) / 0.14));
  } else C.pushPow = 0;
  sc.ptPrev = pt;
  // (stood on the left: the right foot lifted; the physics keeps oneSide while a one-foot lasts)
  C.ofW = ofW; C.ofK = (S.oneSide || 1) < 0 ? 1 : 0; C.tgW = tgW; C.wy = Wy; C.landL = landL; C.spinK = spinK;
  const airW = sp('sairW', air ? 1 : 0, air ? 10 : 9), crashW = sp('scrash', crash ? 1 : 0, 6);
  const tt = t + rig.ph, absorb = S.absorb || 0;
  rig._airT = air ? (changed ? 0 : (rig._airT || 0) + dt) : 0;
  const popK = air ? smooth01(rig._airT / 0.05) * (1 - smoothstep(0.12, 0.34, rig._airT)) : 0;
  // ---- the timed trick going round (from the physics, or a network rider's), finished off quickly if the state
  // stopped telling it before it was round (a landing at the very end of one)
  // (in a chain, skier.js's actN rounds are done and actNext says another follows; another rider's actT is carried on
  // past the round's length while one follows, so it is wrapped into the next round here)
  const ad = S.act ? TR[S.act] : null;
  if (ad && ad.act) {
    let aT = S.actT || 0, n = S.actN;
    if (aT >= ad.act && S.actNext) { const w = Math.floor(aT / ad.act); aT -= w * ad.act; if (n !== undefined) n += w; }
    sc.pAct = ad; sc.pU = clamp(aT / ad.act, 0, 1); sc.pN = n; sc.pNext = S.actNext;
  }
  else if (sc.pAct) { sc.pNext = false; sc.pU += dt / (sc.pAct.act * 0.5); if (sc.pU >= 1 || crash) sc.pAct = null; }
  const A = sc.pAct, u = A ? Math.min(1, sc.pU) : 0, actOn = A ? 1 : 0;
  // ---- the held trick, and how much of each (springs, so one fades into the next); none while a part goes round
  const gid = air ? (S.grab || S.pose || null) : null, td = gid ? trDef(gid, S.tweak || '') : null;
  const prep = air ? 1 - smoothstep(0.09, 0.36, rig.timeToGround(S.p, vel)) : 0;
  const want = td && !td.act && prep < 0.6 && !actOn ? td : null;
  let crouchT = 0, sumW = 0;
  const ws = rig._ws || (rig._ws = []); ws.length = 0;
  const HL = bike ? HELD_B : HELD_S;
  for (let i = 0; i < HL.length; i++) {
    const d = HL[i];
    // (a trick at rest and not asked for is skipped: three times as many with their E and R versions)
    if (d !== want) { const r = P[d.wk]; if (!r || (r.x < 1e-4 && r.v > -1e-3 && r.v < 1e-3)) continue; }
    const w = sp(d.wk, d === want ? 1 : 0, d === want ? 11 : 9);
    if (w > 0.002) {
      const L = heldList(d, bike); if (!L || !L.length) continue;
      // (a mix crouches as deep as its deepest piece that says)
      let cr = -1; for (let j = 0; j < L.length; j++) { ws.push(L[j], w); if (L[j].crouch !== undefined && L[j].crouch > cr) cr = L[j].crouch; }
      crouchT += (cr < 0 ? 0.45 : cr) * w; sumW += w;
    }
  }
  // ---- the vehicle, in the body's frame: leaning with the turn, the bars turned with it; in the air brought up under
  // the rider, tipped back a little at the pop; moved and turned by the trick held and by a part going round
  // (the legs reach for the snow as it comes, the knees then take the landing)
  const crouchA = air ? (actOn ? 0.5 : 0.36 + 0.25 * popK - 0.14 * prep) * (1 - Math.min(1, sumW)) + crouchT + (TK && TK.how === 'late' ? 0.15 * tkT : 0) + 0.2 * Math.max(flipB, flipF) : 0;
  const crouch = sp('scrouch', clamp(air ? crouchA : (S.crouch ?? 0.3) + 0.05 + absorb * 0.7 + 0.12 * tgW + 0.4 * landL + 0.08 * C.pushPow * puW, 0, 1), 18);
  C.vx = 0; C.vy = -(S.sink || 0); C.vz = 0; C.vpit = 0; C.vyaw = 0; C.vroll = 0; C.byaw = 0; C.steerX = 0; C.whipA = 0; C.barA = 0; C.flip = 0; C.circ = 0; C.circA = 0; C.wf = 0; C.wdir = 1; C.decA = 0;
  // the timed trick: the round's flags, what the part does, then the body's targets through their springs
  actFlags(sc, A, u, td, sp, bike, air ? S.airSeq : null, trDef);
  if (A) { ACT[A.base || A.id].part(u, KF); if (A.mods) modPart(A, u, KF); }
  throwPose(sc, A, u, sp);
  const lift_ = sp('slift', air ? 0.03 + 0.05 * crouch : 0, 12, air ? 0.8 : 1);
  C.vy += lift_; C.vroll += phi * 0.9;
  C.vpit += 0.25 * popK - 0.06 * Math.sin(tt * 1.1) * airW;
  if (tkT > 0.001) { C.vy += 0.05 * tkPop * tkT; C.vpit += 0.1 * (tkPop - 0.5) * tkT - 0.08 * clamp(TK.pitch - 0.3, 0, 0.6) * tkT; }
  C.vy += 0.06 * flipB;
  // (2026-11-08, for "less robotic": in a straight air the machine drifts a little under the rider, never still, and the
  // hips answer it)
  const loose = airW * (1 - Math.min(1, sumW)) * (1 - actOn) * (1 - prep);
  if (loose > 0.01) { C.vyaw += 0.08 * wob(tt * 0.8, 5.1) * loose; C.vroll += 0.07 * wob(tt * 0.65, 2.3) * loose; C.vpit += 0.04 * wob(tt * 0.9, 8.7) * loose; }
  // (a manual: the front lifted off the snow, turned about the back of the deck or the rear ski; a nose manual about the front)
  const mA = 0.3 * manW - (bike ? 0.16 : 0.2) * noseW;
  if (Math.abs(mA) > 1e-4) { const zp = mA > 0 ? (bike ? -0.62 : -0.36) : (bike ? 0.5 : 0.28); C.vpit += mA; C.vy -= zp * Math.sin(mA); C.vz += zp * (1 - Math.cos(mA)); }
  for (let i = 0; i < ws.length; i += 2) {
    const h = ws[i], w = ws[i + 1], v = bike && h.bikeV ? h.bikeV : h.v;
    if (v) { C.vx += v[0] * w; C.vy += v[1] * w; C.vz += v[2] * w; C.vpit += v[3] * w; C.vyaw += v[4] * w; C.vroll += v[5] * w; }
    const stw = bike && h.bikeSt !== undefined ? h.bikeSt : h.st; if (stw) C.steerX += stw * w;
  }
  // (the arms throwing the vehicle about in a timed trick, and settling after)
  C.vx += JS.vx; C.vy += JS.vy; C.vz += JS.vz; C.vpit += JS.vpit; C.vyaw += JS.vyaw; C.vroll += JS.vroll;
  // (a trick that drops the vehicle under the rider, a cliffhanger's, only as far as the snow under it allows)
  if (C.vy < 0) C.vy *= air ? smoothstep(0.15, 1.1, S.p.y - height(S.p.x, S.p.z)) : 1;
  // a shifty: the vehicle turned across under the body (Shift or A / D in the air, skier.shift)
  const shift = S.shift || 0;
  C.vyaw -= 0.85 * shift;
  if (crashW > 0.01) { C.vy += 0.15 * crashW; C.vyaw += 0.6 * crashW * Math.sin(t * 2.1); }
  const root = sc.root;
  // (the saddle where it is before a whip turns the bike away under the rider, who stays sat facing the way they go)
  _lq.setFromAxisAngle(Y, C.vyaw).multiply(_q1.setFromAxisAngle(X, -C.vpit)).multiply(_q1.setFromAxisAngle(Z, C.vroll));
  if (C.circ > 0.001) _lq.premultiply(_q1.setFromAxisAngle(_ax.set(Math.cos(C.circA), 0, Math.sin(C.circA)), C.circ));
  _lp.set(C.vx, C.vy, C.vz);
  root.position.copy(_lp).applyQuaternion(R).add(BP); root.quaternion.copy(R).multiply(_lq);
  // (a briflip's quarter turn is about the stem, so the bars stay in front of the rider and the deck swings out)
  if (C.byaw) {
    const piv = _v3.copy(sc.steerPos).applyQuaternion(root.quaternion).add(root.position);
    _qf.setFromAxisAngle(_ax.set(0, 1, 0).applyQuaternion(root.quaternion), C.byaw);
    root.position.sub(piv).applyQuaternion(_qf).add(piv); root.quaternion.premultiply(_qf);
  }
  // the steering: the bars turned with the turn on the snow, a trick's turn and a bar spin's in the air
  // (as much as the turn needs at this speed, the boards' length apart: a few degrees fast, more slow)
  const steerT = ground ? clamp(Math.atan(cfg.half * 1.3 * Wy / Math.max(speed, 1.5)) * 1.4, -0.5, 0.5) : 0;
  const steerA = sp('ssteer', steerT, 10) + C.barA + C.steerX;
  if (C.decA) { C.decP.copy(sc.steerPos).applyQuaternion(root.quaternion).add(root.position); C.decX.copy(sc.axis).applyQuaternion(root.quaternion); }
  sc.steer.position.copy(sc.steerPos); sc.steer.quaternion.copy(sc.steerQ).multiply(_q1.setFromAxisAngle(Y, steerA));
  // the deck (the frame) round the steering axis in a whip, the bars held still
  sc.deck.position.set(0, 0, 0); sc.deck.quaternion.identity();
  if (C.whipA) { _q2.setFromAxisAngle(sc.axis, C.whipA); sc.deck.position.copy(sc.steerPos).negate().applyQuaternion(_q2).add(sc.steerPos); sc.deck.quaternion.copy(_q2); }
  root.updateMatrixWorld(true);
  // a briflip: the whole of it turned round the line through the grips
  if (C.flip) {
    _v1.set(cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(sc.steer.matrixWorld); _v2.set(-cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(sc.steer.matrixWorld);
    const piv = _v3.addVectors(_v1, _v2).multiplyScalar(0.5);
    _qf.setFromAxisAngle(_ax.set(1, 0, 0).applyQuaternion(R), C.flip);
    root.position.sub(piv).applyQuaternion(_qf).add(piv); root.quaternion.premultiply(_qf);
    root.updateMatrixWorld(true);
  }
  // where the boards meet the snow, for the tracks
  if (sc.tr) { mark(sc.tr[0], sc.deck, cfg.trR); mark(sc.tr[1], sc.steer, cfg.trF); }
  // ---- the points the rider uses: the feet's spots on the deck, the grips, the saddle, the tail
  const deckW = sc.deck.matrixWorld, steerW = sc.steer.matrixWorld;
  C.R = R; C.BP = BP; C.t = t; C.tt = tt; C.bike = bike; C.lean = phi * 0.9; C.legLen = rig.legLen; C.armL = rig.len.ua + rig.len.fa;
  const fw = C.fw.set(0, 0, 1).applyQuaternion(R), ub = C.up.set(0, 1, 0).applyQuaternion(R), lf = C.lf.set(1, 0, 0).applyQuaternion(R);
  C.grip[0].set(cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(steerW); C.grip[1].set(-cfg.grip, cfg.gripUp, cfg.gripZ).applyMatrix4(steerW);
  C.barMid.addVectors(C.grip[0], C.grip[1]).multiplyScalar(0.5);
  // (where the grips would be without a bar spin: a barspin's let-go hands fly from there, not round with the bars)
  if (JS.rel > 0.002) {
    _q2.copy(sc.steerQ).multiply(_q1.setFromAxisAngle(Y, steerA - C.barA));
    for (let k = 0; k < 2; k++) C.grip0[k].set(k ? -cfg.grip : cfg.grip, cfg.gripUp, cfg.gripZ).applyQuaternion(_q2).add(sc.steerPos).applyMatrix4(root.matrixWorld);
  }
  if (!bike) {
    C.spot[0].set(cfg.footF[0], cfg.deckTop + 0.03 + rig.ankleH, cfg.footF[1] - 0.05).applyMatrix4(deckW);
    C.spot[1].set(cfg.footB[0], cfg.deckTop + 0.03 + rig.ankleH, cfg.footB[1] - 0.04).applyMatrix4(deckW);
    C.tail.set(cfg.tail[0], cfg.tail[1] + 0.04, cfg.tail[2]).applyMatrix4(deckW);
    C.nose.set(-0.1, cfg.deckTop + 0.07, 0.16).applyMatrix4(deckW);
    C.dk.set(0, cfg.deckTop, -0.05).applyMatrix4(deckW);
    C.melon.set(0.085, cfg.deckTop + 0.01, -0.06).applyMatrix4(deckW); C.indy.set(-0.085, cfg.deckTop + 0.01, -0.1).applyMatrix4(deckW);
  } else {
    // the snowbike: the feet on the pegs in every state (the arch of the boot over the peg, the sole on its teeth), so
    // they go where the frame goes, round with it in a tailwhip and back onto them after any trick that takes them off
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1;
      C.spot[k].set(s * (cfg.peg[0] + 0.012), cfg.peg[1] + 0.014 + rig.ankleH, cfg.peg[2] - 0.06).applyMatrix4(deckW);
    }
    // (the saddle from the bike as a whole, not the frame part: in a tailwhip the frame goes round, the rider does not)
    C.seat.set(0, seat.y, seat.z).applyMatrix4(root.matrixWorld);
    C.tail.set(0, seat.y + 0.06, seat.z + 0.1).applyMatrix4(deckW);
    C.dk.set(0, 0.28, -0.3).applyMatrix4(deckW);
    C.melon.set(0.07, 0.42, -0.04).applyMatrix4(deckW); C.indy.set(-0.07, 0.42, -0.04).applyMatrix4(deckW);
  }
  // what the head follows in a timed trick: the deck (the bike's frame), the bars, or the whole of it in a briflip
  if (sc.lookK === 'bars') C.look.copy(C.barMid); else if (sc.lookK === 'scoot') C.look.addVectors(C.dk, C.barMid).multiplyScalar(0.5); else C.look.copy(C.dk);
  // (seen in first person, 2026-11-06: on the snow the hips further back and the chest more upright, so the bars, the
  // hands on the grips and the deck are ahead of and below the eyes, as a rider sees them; only this rider's own eyes;
  // not the hips on the T-bar, where the bar is behind them)
  const fpS = sp('sfpW', rig.fp ? 1 : 0, 6) * (1 - airW);
  // ---- the trunk: over the deck, crouched to the bars (the scooter); on the saddle (the bike)
  const A0 = rig.ankleH + (cfg.deckTop || 0) + 0.03;
  /* the body leans with the machine in a turn (2026-11-08, for "bike and scooter riders lean with the machine": the
     machine leaned up to 36 degrees in a carve and the rider stayed upright over it, the pelvis rolled the other way):
     the whole rider tips over with it about where it meets the snow, the chest a touch more upright than the machine
     and the head held nearer level, as riders do */
  const bl = phi * 0.9;
  if (!bike) {
    const H = A0 + lift_ + rig.legLen * 0.97 * (0.95 - 0.45 * crouch) + (rig.pelvisY - rig.hipY) - bob - 0.03 * manW + 0.03 * noseW;
    _v5.set(0.015 * wob(tt * 1.7, 4.4) * (1 - airW), H, -0.06 - 0.1 * crouch - 0.2 * fpS * (1 - C.tbW) - 0.12 * manW + 0.08 * noseW - 0.04 * tgW).applyAxisAngle(Z, bl);
    bpt(C.pel, _v5.x, _v5.y, _v5.z);
  } else {
    // (in a whip the rider stays where the saddle was before the bike went round under them)
    let keep = 0; for (let i = 0; i < ws.length; i += 2) keep += (ws[i].keepSeat || 0) * ws[i + 1];
    if (keep > 0.001) { _lq.setFromAxisAngle(Z, bl); _v5.set(0, seat.y, seat.z).applyQuaternion(_lq).add(_v6.set(0, lift_, 0)).applyQuaternion(R).add(BP); C.seat.lerp(_v5, Math.min(1, keep)); }
    // (on the saddle, along the machine's own up; off its back in a manual, up over the bars in a nose manual)
    _v5.set(0, 0.09 + (rig.pelvisY - rig.hipY) + 0.06 * manW + 0.1 * noseW - 0.5 * bob, -0.04 - 0.16 * manW + 0.12 * noseW).applyAxisAngle(Z, bl).applyQuaternion(R);
    C.pel.copy(C.seat).add(_v5);
  }
  // (in first person the bike's rider sits up more, so the bars are ahead of the eyes, not under them: R's fpview.cjs had
  // the lower grip 72 to 79 degrees under the eyes in a lean, out of the bottom of the view)
  const lean = sp('slean', (air ? 0.3 : 0.3 + 0.2 * crouch) - 0.3 * absorb + 0.15 * popK - (bike ? 0.45 : 0.22) * fpS - 0.18 * manW + 0.24 * noseW + 0.2 * puW + 0.1 * C.pushPow * puW
    + (bike ? 0.12 * Math.sin(TAU * pt) * puW : 0) + 2.5 * bob, air ? 12 : 9, air ? 0.8 : 1);
  const twist = sp('stw', clamp(-Wy * 0.04, -0.2, 0.2) + 0.05 * wob(tt * 0.9, 3.7) * (1 - airW), 9);
  C.pp = 0; C.py = twist * 0.4 - 0.3 * shift; C.pr = bl; C.cl = lean; C.ct = twist * 0.6 + 0.55 * shift; C.cs = -0.08 * bl; C.hp = 0; C.hr = -0.45 * bl; C.hy = clamp(-twist + Wy * 0.06, -1, 1) - 0.25 * shift;
  // (the push: the hips turn to the kicking side, the shoulders against them; the bike's chest pumps the bars)
  if (C.pushW > 0.002) { const ks = C.pushK ? -1 : 1; C.py += ks * 0.12 * C.pushPow * puW; C.ct -= ks * 0.08 * C.pushPow * puW; if (bike) C.pel.addScaledVector(fw, 0.04 * Math.sin(TAU * pt) * puW); }
  // (one foot: the weight over the foot stood on; the free arm out a little for balance)
  if (ofW > 0.002) { const ks = C.ofK ? -1 : 1; C.pel.addScaledVector(lf, -ks * (bike ? 0.05 : 0.025) * ofW); C.cs += ks * 0.1 * ofW; C.pr += ks * 0.06 * ofW; }   // (the lifted leg's hip up)
  // (a landing: the chest folds into it and rings back, the head nods; landed across the travel, the hips and shoulders
  // turned towards it, the head looking where it goes, the body leant against the skid)
  // (landOff over 0: the travel to the right of the machine; a turn about the body's up over 0 is to the left)
  C.cl += 0.45 * landL; C.hp += 0.25 * landL; C.py -= 0.35 * landO; C.ct -= 0.1 * landO; C.cs -= 0.12 * landO; C.hy -= 0.25 * landO;
  // (a takeoff: a hard pop stands the chest up, a roll-off off a lip throws it a little forward, a steep lip back)
  if (tkT > 0.001) C.cl += (-0.12 * tkPop + 0.14 * (1 - tkPop) - 0.25 * clamp(TK.pitch - 0.35, 0, 0.6)) * tkT;
  // (a backflip: the bars pulled in to the chest, the head back looking for the snow; a front flip tucked over the bars;
  // a fast spin: the head spots it)
  C.cl += -0.1 * flipB + 0.25 * flipF; C.hp += -0.32 * flipB + 0.2 * flipF; C.hy += clamp(Wy * 0.05, -0.4, 0.4) * airW;
  // (the eyes on the landing as it comes; the hips against the machine's drift)
  C.hp += 0.3 * prep * airW; if (loose > 0.01) { C.py -= 0.5 * 0.08 * wob(tt * 0.8, 5.1) * loose; C.pr -= 0.4 * 0.07 * wob(tt * 0.65, 2.3) * loose; }
  for (let i = 0; i < ws.length; i += 2) if (ws[i].trunk) ws[i].trunk(ws[i + 1]);
  // (a timed trick's throw through the trunk: the hips and chest wound up, thrown round and settling, the pelvis popped up
  // off the deck or saddle and down again for the catch)
  C.py += JS.py; C.ct += JS.ct; C.cl += JS.cl; C.cs += JS.cs; C.pr += JS.pr; C.pp += JS.pp;
  // (on the bike the saddle is under the pelvis: it rises off it, but never sinks into it; the catch is taken by the chest
  // and arms there)
  C.pel.addScaledVector(ub, bike ? Math.max(JS.ph, -0.01) : JS.ph).addScaledVector(lf, JS.px).addScaledVector(fw, JS.pz);
  if (crashW > 0.01) C.cl += Math.sin(t * 3.1) * 0.5 * crashW;
  const pelQ = C.pq.copy(R).multiply(_q1.setFromAxisAngle(Y, C.py)).multiply(_q1.setFromAxisAngle(X, C.pp)).multiply(_q1.setFromAxisAngle(Z, C.pr));
  rig.setWorldQ(b.root, _q2.copy(pelQ).multiply(rig.rest.root.q));
  b.pelvis.updateWorldMatrix(false, false);
  const off = _v5.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v6.setFromMatrixPosition(b.root.matrixWorld));
  rig.setWorldPos(b.root, _v6.copy(C.pel).sub(off));
  return finishPose(rig, S, dt, sp, A, u, ws, crashW, air, ground, bike, steerW, deckW, A0);
};

// the rest of a frame's pose, once the vehicle and the pelvis are placed: chest, head, legs, arms
function finishPose(rig, S, dt, sp, A, u, ws, crashW, air, ground, bike, steerW, deckW, A0) {
  const b = rig.b, R = C.R, sc = rig.sc, t = C.t, tt = C.tt;
  const fw = C.fw, ub = C.up, lf = C.lf;
  const pelQ = C.pq;
  const chQ = C.cq.copy(pelQ).multiply(_q1.setFromAxisAngle(Y, C.ct)).multiply(_q1.setFromAxisAngle(X, C.cl)).multiply(_q1.setFromAxisAngle(Z, C.cs));
  rig.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
  rig.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); rig.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); rig.blendBone(b.chest, 'chest', pelQ, chQ, 1);
  // the head: forward, a little over the bars, looking where it goes; the chest's lean taken back off it
  let hy = C.hy, hx = 0.15 - (C.cl + C.pp) * 0.75 + C.hp;
  // (in a timed trick it follows the deck or the bars round, eyes on it to spot the catch: turned towards it from the
  // chest, as far as a neck goes, letting go as it passes behind; through a spring, so it chases it a little behind)
  let dy = 0, dx = 0;
  if (JS.look > 0.01) {
    b.neck.updateWorldMatrix(false, false);
    const d = _v5.copy(C.look).sub(_v6.setFromMatrixPosition(b.neck.matrixWorld)).applyQuaternion(_q2.copy(chQ).invert());
    const yaw = Math.atan2(d.x, d.z), pit = Math.atan2(-d.y, Math.hypot(d.x, d.z));
    const w = clamp(JS.look, 0, 1) * (1 - smoothstep(1.7, 2.6, Math.abs(yaw)));
    dy = w * (clamp(yaw, -1.2, 1.2) - hy); dx = w * (clamp(pit, -0.7, 1.05) - hx);
  }
  hy += sp('xlook_y', dy, 18, 0.75); hx += sp('xlook_x', dx, 18, 0.75);
  const hdQ = C.hq.copy(chQ).multiply(_q1.setFromAxisAngle(Y, hy)).multiply(_q1.setFromAxisAngle(X, hx));
  if (C.hr) hdQ.multiply(_q1.setFromAxisAngle(Z, C.hr));
  rig.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); rig.blendBone(b.head, 'head', hdQ, hdQ, 0);
  rig.blendBone(b.clL, 'clL', chQ, chQ, 0); rig.blendBone(b.clR, 'clR', chQ, chQ, 0);
  b.uaL.updateWorldMatrix(false, false); b.uaR.updateWorldMatrix(false, false);
  C.sh[0].setFromMatrixPosition(b.uaL.matrixWorld); C.sh[1].setFromMatrixPosition(b.uaR.matrixWorld);
  b.thL.updateWorldMatrix(false, false); b.thR.updateWorldMatrix(false, false);
  C.hip[0].setFromMatrixPosition(b.thL.matrixWorld); C.hip[1].setFromMatrixPosition(b.thR.matrixWorld);
  // ---- the limbs: the base pose (feet on their spots, hands on the grips), then the trick held, then a timed one
  for (let k = 0; k < 2; k++) {
    C.foot[k].copy(C.spot[k]); C.ffree[k] = 0; C.fyaw[k] = 0; C.fpit[k] = 0;
    C.kp[k].copy(fw).addScaledVector(lf, (k ? -1 : 1) * 0.15).addScaledVector(ub, 0.2);
    C.hand[k].copy(C.grip[k]).addScaledVector(ub, 0.02); C.hoff[k] = 0; C.hgrab[k] = 0; C.curl[k] = 1.3;
    C.ep[k].set(0, 0, 0);
  }
  // (the feet together: the scooter's front foot slid back by the back one, the knees together; the bike's knees pressed
  // in against the frame)
  if (C.tgW > 0.002) for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1;
    if (!bike && k === 0) C.foot[0].lerp(_v1.set(sc.cfg.footF[0], sc.cfg.deckTop + 0.03 + rig.ankleH, -0.11).applyMatrix4(deckW), C.tgW);
    kneeTo(k, bdir(_v2, bike ? -s * 0.28 : -s * 0.04, 0.22, 1), C.tgW);
  }
  // (one foot off: the scooter's back foot out to the side and behind the deck, or its front one out ahead; the bike's
  // off its peg and out to the side)
  if (C.ofW > 0.002) {
    const k = C.ofK, s = k ? -1 : 1;
    if (bike) footTo(k, hpt(_v1, k, s * 0.5, -0.3, 0.14), C.ofW);
    else if (k) footTo(1, hpt(_v1, 1, -0.32, -0.52, -0.3), C.ofW);
    else footTo(0, hpt(_v1, 0, 0.3, -0.48, 0.3), C.ofW);
    kneeTo(k, bdir(_v2, s * 0.7, 0.3, 0.6), C.ofW); C.fpit[k] += (-0.5 - C.fpit[k]) * C.ofW; C.fyaw[k] += (s * 0.3 - C.fyaw[k]) * C.ofW;
  }
  // (the push: the kicking foot down to the snow beside, swept back, lifted and brought forward)
  if (C.pushW > 0.002) {
    const k = C.pushK, s = k ? -1 : 1;
    footTo(k, bpt(_v1, bike ? s * 0.32 : -0.27, rig.ankleH + C.pushY, C.pushZ), C.pushW);
    kneeTo(k, bdir(_v2, s * 0.15, 0.25, 1), C.pushW); C.fpit[k] += (0.15 * C.pushPow - C.fpit[k]) * C.pushW;
  }
  // (the T-bar: one hand on the stem, the other on the bars)
  if (C.tbW > 0.002) { handTo(C.tbK, C.tbP, C.tbW, 0.3); C.curl[C.tbK] += (1.2 - C.curl[C.tbK]) * C.tbW; elbowTo(C.tbK, bdir(_v2, C.tbK ? -1 : 1, -0.4, -0.5), C.tbW); }
  for (let i = 0; i < ws.length; i += 2) if (ws[i].limbs) ws[i].limbs(ws[i + 1]);
  throwLimbs(sc);
  // (a hard landing: the elbows out as the arms take it; a fast spin: the elbows in)
  if (C.landL > 0.01 || C.spinK > 0.01) for (let k = 0; k < 2; k++) { const s = k ? -1 : 1; elbowTo(k, bdir(_v2, s * (1 - 0.7 * C.spinK), -0.3, -0.2), clamp(0.6 * C.landL + 0.4 * C.spinK, 0, 1)); }
  // ---- legs: knees forward over the feet
  for (let k = 0; k < 2; k++) {
    const th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
    const hip = C.hip[k], an = C.foot[k];
    const d = an.distanceTo(hip), m = softReach(d, rig.legLen, 0.88, 0.975); if (m < d) an.sub(hip).multiplyScalar(m / d).add(hip);
    rig.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', an, C.kp[k].normalize(), Z);
    // on the deck: the front foot points forward, the back one turned out across it (as riders stand); on the bike's
    // pegs along the frame, toes turned out a little; off them, along the body, pointed as the trick asks
    // (the scooter's back foot turned less across the deck as the deck leans towards its toes, so they stay over the snow)
    const yaw = (bike ? (k ? -0.12 : 0.12) : k ? -0.55 * (1 - 0.7 * clamp(C.lean / 0.5, 0, 1)) : -0.1) * (1 - C.ffree[k]) + C.fyaw[k];
    // (leant over in a carve, a foot on a bike peg rolls back a little towards level, the inside one's toes lifted, so
    // they stay off the snow at full lean)
    let fr = 0, fp = C.fpit[k];
    if (bike) { const on = 1 - C.ffree[k]; fr = -0.45 * C.lean * on; fp -= 0.35 * clamp((k ? 1 : -1) * C.lean / 0.63, 0, 1) * on; }
    _q3.copy(sc.deck.getWorldQuaternion(_wq)).slerp(_q2.copy(C.pq), C.ffree[k]).multiply(_q1.setFromAxisAngle(Y, yaw)).multiply(_q2.setFromAxisAngle(X, fp));
    if (fr) _q3.multiply(_q1.setFromAxisAngle(Z, fr));
    rig.setWorldQ(ft, _q3.multiply(rig.rest[k ? 'ftR' : 'ftL'].q));
  }
  // ---- arms: to the grips (fingers round them, palms down), or where the trick puts them
  const chQ2 = C.cq, cF = _cF.set(0, 0, 1).applyQuaternion(chQ2), cL = _cL.set(1, 0, 0).applyQuaternion(chQ2), cU = _cU.set(0, 1, 0).applyQuaternion(chQ2);
  const armL = C.armL, barX = _v6.set(1, 0, 0).applyQuaternion(sc.steer.getWorldQuaternion(_sq));
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
    const sh = C.sh[k], off1 = C.hoff[k];
    const wr = _wr.copy(C.hand[k]);
    if (crashW > 0.5) {
      const fk = S.fallKind || '', fT = S.fallT || 0;
      // (2026-11-08, how you fall: into the snow head or body first, the hands reach out to break it; into a tree, a
      // wall or a rail, the arms come up in front of the face; else they flail)
      if (fk === 'land' || fk === 'head' || fk === 'lost') wr.copy(sh).addScaledVector(fw, 0.32).addScaledVector(ub, -0.3 + 0.08 * Math.sin(t * 7 + s)).addScaledVector(cL, s * 0.18);
      else if (fk === 'tree' || fk === 'wall' || fk === 'rail') wr.copy(sh).addScaledVector(cF, 0.26).addScaledVector(cU, 0.22 - 0.1 * smoothstep(0.6, 1.4, fT)).addScaledVector(cL, -s * 0.04);
      else wr.copy(sh).addScaledVector(cL, s * 0.35).addScaledVector(ub, 0.2 + Math.sin(t * 9 + s) * 0.2);
    }
    { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.8, 0.97); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
    const el = _el.copy(cL).multiplyScalar(s * 0.8).addScaledVector(ub, -0.6).addScaledVector(cF, -0.3);
    if (C.ep[k].lengthSq() > 1e-6) el.lerp(_v5.copy(C.ep[k]).normalize(), Math.min(1, C.ep[k].length()));
    rig.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el.normalize(), NZ);
    const HH = rig.hands[k ? 'R' : 'L'];
    // on the grip: fingers wrapped forward over the bar, palm down; free: relaxed; on a deck or saddle: palm down on it
    const fd = _fd.copy(cF).addScaledVector(ub, -0.3).normalize().lerp(_v5.copy(barX).multiplyScalar(-s).lerp(cF, 0.5).normalize(), 1 - off1).normalize();
    const pa = _pa.copy(ub).negate().lerp(_v5.copy(cL).multiplyScalar(-s), off1).normalize();
    if (C.hgrab[k] > 0.01) { fd.lerp(_v5.copy(fw).negate(), C.hgrab[k]).normalize(); pa.lerp(_v7.copy(ub).negate(), C.hgrab[k]).normalize(); }
    rig.aim(ha, rig.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, fd, pa);
    rig.curl(HH, C.curl[k]);
  }
  // (a decade: the whole of it, rider and bike, turned back round the head tube by the frame's turn, so the bike stays
  // still and the rider and the bars go round it)
  if (C.decA) {
    _qf.setFromAxisAngle(C.decX, -C.decA);
    const turn = o => { o.position.sub(C.decP).applyQuaternion(_qf).add(C.decP); o.quaternion.premultiply(_qf); o.updateMatrixWorld(true); };
    turn(rig.body); turn(sc.root);
    C.hq.premultiply(_qf);
  }
  rig.placeHead(C.hq);
  /* first person (2026-11-08, R's contract, ski8/R/NOTES.md): the eyes are the head's (placeHead); on the snow, rails and
     the T-bar the view is aimed between the hands on the bars and the snow 18 m ahead along the travel, so both hands,
     the bars and the deck (the bike's front ski) are in the bottom of the view and the way ahead at the top, whatever the
     slope, the lean or the bars' turn (a fixed angle under the slope put the snow ahead at the top edge on the run's 10
     degrees; leant over, the bars tilt across the view while the camera holds the horizon, so the lower grip dropped out
     of the bottom); in the air and in a crash the camera's own rule (the head's gaze) */
  if (rig.fp && !air && S.state !== 'crash') {
    const E = rig.fpEye;
    b.haL.updateWorldMatrix(false, false); b.haR.updateWorldMatrix(false, false);
    const hL = _v1.setFromMatrixPosition(b.haL.matrixWorld).sub(E).normalize(), hR = _v2.setFromMatrixPosition(b.haR.matrixWorld).sub(E).normalize();
    const tv = _v3.copy(S.vel || ZERO); tv.y = 0; if (tv.lengthSq() < 1) { tv.copy(C.fw); tv.y = 0; } tv.normalize();
    const ax = C.BP.x + tv.x * 18, az = C.BP.z + tv.z * 18;
    const ah = _v4.set(ax, height(ax, az) + 0.3, az).sub(E).normalize();
    // (up and down: half way between the lower hand's angle and the snow ahead's; across: between the bars' middle and
    // the way ahead)
    const pit = 0.5 * (Math.asin(clamp(Math.min(hL.y, hR.y), -1, 1)) + Math.asin(clamp(ah.y, -1, 1)));
    const hx = hL.x + hR.x, hz = hL.z + hR.z, hn = Math.hypot(hx, hz) || 1, an = Math.hypot(ah.x, ah.z) || 1;
    let dx = hx / hn + ah.x / an, dz = hz / hn + ah.z / an; const dn = Math.hypot(dx, dz) || 1;
    rig.fpLook = rig.fpDir.set(dx / dn * Math.cos(pit), Math.sin(pit), dz / dn * Math.cos(pit));
  }
  rig.flushTree(rig.body);
}
