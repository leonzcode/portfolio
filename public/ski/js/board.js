// The snowboard: a downloaded board and boots on the rider (models/board/board.glb, built from two CC BY Sketchfab
// models, see CREDITS.md), and the rider's pose standing sideways on it. Registered with the rig as another ride:
// Rig.loader.board adds the gear, Rig.poser.board poses the body every frame with the rig's own IK helpers.
//   Frames: the physics' body frame (skier.q) is the board's: +Z the nose, +Y up, +X the board's left side. The rider
//   stands across it: regular (left foot forward) faces the board's -X side (the toe edge), goofy (right foot forward)
//   its +X side. The rider's own frame is the board's turned a quarter round (Ry(-90) regular, Ry(+90) goofy): there
//   +Z is where the chest faces (the toe edge), +X the rider's left, and the nose lies along +X for regular, -X for goofy.
//   So in the rider's frame a goofy rider is a regular rider riding the board's other end: everything below is worked
//   out once, with noseX (+1 regular, -1 goofy) saying which way the nose is.
// Grabs are data (BOARD_GRABS), named as snowboarders name them, written for the front and back hand (so goofy mirrors
// them by itself); every ski grab key gives the board grab mapped to it in BOARD_FOR.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rig, springBank, smooth01, wrapPi, softReach, wob } from './rig.js?v=20';
import { clamp, smoothstep } from './noise.js?v=20';
import { height } from './terrain.js?v=20';
import { LOOK } from './gear.js?v=20';
import { RIDE_KEYS, RIDE_HELP } from './input.js?v=20';

const D = Math.PI / 180;
// the board's size (the model is scaled to it), where the bindings are, and their angles (a mild duck stance)
export const BOARD = { len: 1.55, half: 0.775, top: 0.037, stance: 0.54, angF: 15 * D, angB: -9 * D, ankleUp: 0.032, ankleBack: 0.052 };

// ---- grabs ------------------------------------------------------------------------------------------------------------
// hands: [hand 'F' (front, nose side) | 'B' (back), at (-1 tail .. +1 nose), edge 'toe' | 'heel' | 'end']
// board: how the grab moves the board from under the feet, in the rider's terms:
//   [towards the nose, up, towards the toes (in front of the body), nose turned to the front, nose up, heel edge up]
//   (metres and radians; a method's board goes up behind the back: heel edge up, towards the heels)
// tuck: knees up (0..1); lean: chest forward (rad); twist: chest turned towards the nose (rad); side: the front
// shoulder dropped (rad); bone: a leg kicked straight ('F', 'B' or 'FB'); arms: the free arm ('out', 'up', 'wide')
// Definitions: the skateboarding air names they come from (Wikipedia, "Aerial (skateboarding)"), the FIS park and pipe
// tricks list (Rocket, Slob, Swiss Cheese, Bloody Dracula; Truck Driver as Indy and Melon at once) and riders' guides
// (Indy: back hand, toe edge between the feet; Mute: front hand, toe edge; Melon: front hand, heel edge; Stalefish: back
// hand round the back leg to the heel edge; Method: a melon with the board pulled up behind; Roast Beef: back hand
// between the legs to the heel edge; Japan: a mute pulled up behind, front knee down; Crail: back hand to the nose;
// Tindy: an indy slid back towards the tail).
export const BOARD_GRABS = {
  indy:      { name: 'Indy', hands: [['B', -0.02, 'toe']], board: [0, 0.04, 0.04, 0, -0.06, -0.12], tuck: 0.72, lean: 0.4, twist: -0.3, side: -0.22, arms: 'out' },
  mute:      { name: 'Mute', hands: [['F', 0.08, 'toe']], board: [0, 0.04, 0.05, 0, 0.06, -0.1], tuck: 0.7, lean: 0.48, twist: 0.25, side: 0.35, arms: 'out' },
  melon:     { name: 'Melon', hands: [['F', 0.04, 'heel']], board: [0, 0, 0.1, 0.05, 0.16, -0.3], tuck: 0.55, lean: 0.55, twist: 0.45, side: 0.45, arms: 'out' },
  stalefish: { name: 'Stalefish', hands: [['B', -0.08, 'heel']], board: [0, 0.02, -0.08, 0, -0.14, 0.32], tuck: 0.58, lean: 0.42, twist: -0.45, side: -0.42, arms: 'out' },
  method:    { name: 'Method', hands: [['F', 0.06, 'heel']], board: [0.02, 0.16, -0.2, 0, 0.3, 1.05], tuck: 0.8, lean: -0.05, twist: 0.35, side: 0.4, arms: 'up' },
  nose:      { name: 'Nose', hands: [['F', 1, 'end']], board: [0.04, -0.02, 0.06, 0.08, 0.42, -0.05], tuck: 0.45, lean: 0.7, twist: 0.4, side: 0.42, arms: 'out' },
  tail:      { name: 'Tail', hands: [['B', -1, 'end']], board: [-0.04, -0.02, 0.02, -0.08, -0.42, 0.05], tuck: 0.45, lean: 0.45, twist: -0.42, side: -0.42, arms: 'out' },
  roastbeef: { name: 'Roast Beef', hands: [['B', 0.02, 'heel']], board: [0, 0.03, 0.08, 0, 0, -0.12], tuck: 0.72, lean: 0.62, twist: 0.05, side: -0.15, arms: 'out' },
  japan:     { name: 'Japan', hands: [['F', 0.42, 'toe']], board: [0, 0.14, -0.14, 0, 0.32, 0.72], tuck: 0.82, lean: 0.5, twist: 0.45, side: 0.38, arms: 'out' },
  crail:     { name: 'Crail', hands: [['B', 0.6, 'toe']], board: [0.06, 0, 0.1, 0.3, -0.05, -0.08], tuck: 0.5, lean: 0.85, twist: 0.55, side: 0.25, bone: 'B', arms: 'out' },
  seatbelt:  { name: 'Seatbelt', hands: [['F', -1, 'end']], board: [-0.03, 0.02, 0.06, -0.12, -0.38, 0], tuck: 0.6, lean: 0.62, twist: -0.6, side: -0.25, arms: 'out' },
  truck:     { name: 'Truck Driver', hands: [['F', 0.08, 'heel'], ['B', -0.04, 'toe']], board: [0, 0.04, 0.04, 0, 0, 0], tuck: 0.72, lean: 0.55, twist: 0, side: 0 },
  tindy:     { name: 'Tindy', hands: [['B', -0.55, 'toe']], board: [0, 0, 0.04, -0.06, -0.16, -0.08], tuck: 0.55, lean: 0.55, twist: -0.4, side: -0.32, arms: 'out' },
  swiss:     { name: 'Swiss Cheese', hands: [['B', 0.45, 'heel']], board: [0, 0, 0.08, 0.05, 0.12, -0.1], tuck: 0.5, lean: 0.85, twist: 0.3, side: 0.22, bone: 'B', arms: 'out' },
  rocket:    { name: 'Rocket', hands: [['F', 1, 'end'], ['B', 0.93, 'toe']], board: [0.04, 0.04, 0.08, 0.1, 0.85, -0.05], tuck: 0.3, lean: 0.75, twist: 0.5, side: 0.45, bone: 'B' },
  slob:      { name: 'Slob', hands: [['F', 0.06, 'toe']], board: [0, -0.04, 0.06, 0, -0.04, -0.06], tuck: 0.42, lean: 0.62, twist: 0.25, side: 0.3, bone: 'B', arms: 'wide' },
  dracula:   { name: 'Bloody Dracula', hands: [['B', -1, 'end'], ['F', -0.85, 'heel']], board: [-0.04, 0.04, -0.04, -0.1, -0.5, 0.15], tuck: 0.42, lean: 0.3, twist: -0.65, side: -0.2 },
  // positions without a hand: a leg kicked straight ("boned"), or both knees tucked up
  nosebone:  { name: 'Nose Bone', pos: true, hands: [], board: [0.06, -0.12, 0.08, 0.1, -0.32, -0.05], tuck: 0.25, lean: 0.25, twist: 0.3, side: 0.1, bone: 'F', arms: 'wide' },
  tailbone:  { name: 'Tail Bone', pos: true, hands: [], board: [-0.06, -0.12, 0.08, -0.1, 0.32, -0.05], tuck: 0.25, lean: 0.25, twist: -0.3, side: -0.1, bone: 'B', arms: 'wide' },
  tuckknee:  { name: 'Tuck Knee', pos: true, hands: [], board: [0, 0.08, 0.02, 0, 0, 0], tuck: 0.98, lean: 0.55, twist: 0, side: 0, arms: 'out' },
  stiffy:    { name: 'Stiffy', pos: true, hands: [], board: [0, -0.14, 0.04, 0, 0, -0.1], tuck: 0.05, lean: 0.15, twist: 0, side: 0, bone: 'FB', arms: 'wide' },
};
// the ski grab keys (input.js, grabs.js ids) to board grabs: the common ones on the keys the ski's common ones use
export const BOARD_FOR = {
  safety: 'indy', safety_m: 'melon', mute: 'mute', mute_m: 'slob', japan: 'japan', japan_m: 'crail', tail: 'tail', tail_m: 'tindy',
  nose: 'nose', nose_m: 'nose', truck: 'truck', critical: 'roastbeef', critical_m: 'swiss', octo: 'rocket', blunt: 'method', blunt_m: 'method',
  stalefish: 'stalefish', stalefish_m: 'stalefish', bowarrow: 'swiss', dubtail: 'dracula', seatbelt: 'seatbelt', seatbelt_m: 'seatbelt',
  daffy: 'nosebone', spread: 'tailbone', backscratch: 'tuckknee', ironcross: 'stiffy',
  // (2026-11-08, the skis' new keys: 1 the spread eagle with the poles, 2 the screaming seaman)
  spreadpoles: 'stiffy', seaman: 'rocket',
};
/* (2026-11-08, for Leon's "E and R give different versions of a trick, not just a tweak (e.g. board nose grab to a
   two-handed nose grab)") each grab has two other versions laid over the plain one: E mostly kicks a leg straight and
   pulls the board further (an Indy Tail Bone: a tweaked indy with the back leg boned; a Power Method), R moves the
   hand or brings the other one in (a Tindy, a Taipan, a Lien, a two-handed nose). Both held is the R version with
   E's leg boned (or tweaked). (Not called Tweaked: tricks.js calls a plain grab held a second Tweaked.) The names and
   what each one is come from riders' guides (Snowboard Addiction's grab list, Red Bull's trick guide; B/ref/README.txt):
   Taipan (a Japan with the front hand reaching from behind through the legs to the toe edge), Lien (the front hand on
   the heel edge between the binding and the nose, leaning out over it), Canadian Bacon (the back hand from behind
   through the legs to the toe edge), Chicken Salad (a Roast Beef with the front hand: through the legs to the heel
   edge), Nuclear (the back hand across the front of the body to the heel edge by the nose), Cross Rocket (both hands on
   the nose, crossed), the Seatbelt's front leg boned. */
const BOARD_VARS = {
  indy: [{ name: 'Indy Tail Bone', bone: 'B', board: [0, 0, 0.16, -0.06, -0.2, -0.32], tuck: 0.6, lean: 0.5, twist: -0.6, side: -0.42, arms: 'up' },
    { name: 'Tindy', hands: [['B', -0.55, 'toe']], board: [-0.02, 0, 0.05, -0.08, -0.22, -0.1], tuck: 0.6, lean: 0.55, twist: -0.5, side: -0.36 }],
  mute: [{ name: 'Mute Tail Bone', bone: 'B', board: [0.02, 0.1, -0.08, 0.1, 0.26, 0.42], tuck: 0.72, lean: 0.45, twist: 0.55, side: 0.48, arms: 'up' },
    { name: 'Taipan', hands: [['F', 0.02, 'toe']], board: [0, 0.12, -0.16, 0.04, 0.3, 0.62], tuck: 0.78, lean: 0.62, twist: 0.5, side: 0.42 }],
  melon: [{ name: 'Boned Melon', bone: 'F', board: [0.02, -0.06, 0.12, 0.12, 0.3, -0.42], tuck: 0.4, lean: 0.5, twist: 0.58, side: 0.52, arms: 'wide' },
    { name: 'Lien Air', hands: [['F', 0.72, 'heel']], board: [0.04, 0, 0.12, 0.16, 0.48, -0.26], tuck: 0.45, lean: 0.9, twist: 0.55, side: 0.52 }],
  stalefish: [{ name: 'Stalefish Nose Bone', bone: 'F', board: [0, 0.14, -0.2, -0.08, -0.3, 0.85], tuck: 0.75, lean: 0.15, twist: -0.58, side: -0.5, arms: 'up' },
    { name: 'Canadian Bacon', hands: [['B', -0.02, 'toe']], board: [0, 0.1, -0.18, -0.04, -0.28, 0.62], tuck: 0.78, lean: 0.45, twist: -0.5, side: -0.46 }],
  method: [{ name: 'Power Method', board: [0.04, 0.3, -0.3, 0.05, 0.42, 1.35], tuck: 0.9, lean: -0.25, twist: 0.55, side: 0.55, arms: 'up' },
    { name: 'Two-Handed Method', hands: [['F', 0.08, 'heel'], ['B', -0.08, 'heel']], board: [0, 0.2, -0.16, 0, 0.12, 0.9], tuck: 0.85, lean: 0.1, twist: 0.1, side: 0.12 }],
  nose: [{ name: 'Boned Nose', bone: 'B', board: [0.06, -0.04, 0.08, 0.14, 0.62, -0.05], tuck: 0.3, lean: 0.8, twist: 0.5, side: 0.5, arms: 'wide' },
    { name: 'Two-Handed Nose', hands: [['F', 1, 'end'], ['B', 0.86, 'heel']], board: [0.05, 0.06, 0.1, 0.12, 0.72, -0.05], tuck: 0.55, lean: 0.85, twist: 0.55, side: 0.4 }],
  tail: [{ name: 'Boned Tail', bone: 'F', board: [-0.06, -0.04, 0.04, -0.14, -0.62, 0.05], tuck: 0.3, lean: 0.45, twist: -0.5, side: -0.5, arms: 'wide' },
    { name: 'Two-Handed Tail', hands: [['B', -1, 'end'], ['F', -0.86, 'toe']], board: [-0.05, 0.06, 0.08, -0.12, -0.7, 0.05], tuck: 0.55, lean: 0.65, twist: -0.65, side: -0.36 }],
  roastbeef: [{ name: 'Roast Beef Tail Bone', bone: 'B', board: [0.02, -0.02, 0.12, 0.06, 0.2, -0.3], tuck: 0.5, lean: 0.7, twist: 0.15, side: -0.25, arms: 'up' },
    { name: 'Chicken Salad', hands: [['F', 0, 'heel']], board: [0, 0.03, 0.1, 0.04, 0.1, -0.15], tuck: 0.72, lean: 0.7, twist: 0.25, side: 0.2 }],
  japan: [{ name: 'Japan Tail Bone', bone: 'B', board: [0, 0.22, -0.24, 0.05, 0.42, 1.05], tuck: 0.8, lean: 0.55, twist: 0.6, side: 0.5, arms: 'up' },
    { name: 'Nuclear', hands: [['B', 0.62, 'heel']], board: [0.04, 0.04, 0.12, 0.2, 0.22, -0.2], tuck: 0.6, lean: 0.85, twist: 0.65, side: 0.25 }],
  crail: [{ name: 'Crail, Nose Down', bone: 'B', board: [0.08, -0.04, 0.14, 0.42, -0.2, -0.12], tuck: 0.45, lean: 0.95, twist: 0.7, side: 0.35 },
    { name: 'Two-Handed Crail', hands: [['B', 0.6, 'toe'], ['F', 0.62, 'heel']], board: [0.06, 0.04, 0.08, 0.25, 0.1, -0.05], bone: '', tuck: 0.65, lean: 0.9, twist: 0.5, side: 0.2 }],
  seatbelt: [{ name: 'Seatbelt Nose Bone', bone: 'F', board: [-0.05, -0.02, 0.1, -0.2, -0.55, 0.05], tuck: 0.4, lean: 0.55, twist: -0.75, side: -0.35, arms: 'up' },
    { name: 'Two-Handed Seatbelt', hands: [['F', -1, 'end'], ['B', -0.85, 'toe']], board: [-0.04, 0.06, 0.06, -0.14, -0.55, 0], tuck: 0.6, lean: 0.6, twist: -0.7, side: -0.3 }],
  truck: [{ name: 'Stretched Truck Driver', board: [0, 0.08, 0.1, 0.15, 0.2, -0.2], tuck: 0.82, lean: 0.75, twist: 0.3, side: 0.22 },
    { name: 'Double Mute', hands: [['F', 0.14, 'toe'], ['B', -0.08, 'toe']], board: [0, 0.06, 0.06, 0, 0, -0.15], tuck: 0.78, lean: 0.7, twist: 0, side: 0 }],
  tindy: [{ name: 'Tindy Nose Bone', bone: 'F', board: [-0.03, -0.02, 0.1, -0.12, -0.3, -0.12], tuck: 0.45, lean: 0.6, twist: -0.55, side: -0.45, arms: 'up' },
    { name: 'Two-Handed Tindy', hands: [['B', -0.55, 'toe'], ['F', -0.2, 'toe']], board: [-0.02, 0.05, 0.06, -0.08, -0.2, -0.1], tuck: 0.65, lean: 0.65, twist: -0.4, side: -0.25 }],
  swiss: [{ name: 'Stretched Swiss Cheese', board: [0, 0, 0.12, 0.08, 0.2, -0.16], tuck: 0.45, lean: 0.95, twist: 0.42, side: 0.3, arms: 'up' },
    { name: 'Swiss Cheese Nose Bone', bone: 'F', board: [0.04, -0.06, 0.1, 0.1, 0.3, -0.12], tuck: 0.35, lean: 0.85, twist: 0.4, side: 0.3 }],
  rocket: [{ name: 'Stretched Rocket', board: [0.06, 0.06, 0.1, 0.15, 1.05, -0.05], tuck: 0.25, lean: 0.9, twist: 0.6, side: 0.5 },
    { name: 'Cross Rocket', hands: [['F', 0.92, 'toe'], ['B', 0.92, 'heel']], board: [0.04, 0.04, 0.08, 0.12, 0.8, -0.05], tuck: 0.3, lean: 0.8, twist: 0.5, side: 0.45 }],
  slob: [{ name: 'Stretched Slob', board: [0, -0.06, 0.1, 0.05, -0.08, -0.12], tuck: 0.35, lean: 0.7, twist: 0.4, side: 0.4, arms: 'up' },
    { name: 'Two-Handed Slob', hands: [['F', 0.08, 'toe'], ['B', -0.08, 'toe']], board: [0, -0.02, 0.08, 0, -0.04, -0.06], tuck: 0.45, lean: 0.7, twist: 0.1, side: 0.1, arms: undefined }],
  dracula: [{ name: 'Stretched Bloody Dracula', board: [-0.06, 0.08, -0.06, -0.15, -0.72, 0.22], tuck: 0.45, lean: 0.3, twist: -0.85, side: -0.3 },
    { name: 'Bloody Dracula Nose Bone', bone: 'F', board: [-0.05, 0.02, -0.02, -0.12, -0.6, 0.15], tuck: 0.3, lean: 0.35, twist: -0.7, side: -0.25 }],
  nosebone: [{ name: 'Stretched Nose Bone', board: [0.08, -0.18, 0.12, 0.16, -0.48, -0.08], tuck: 0.2, lean: 0.3, twist: 0.45, side: 0.15 },
    { name: 'Nose Bone, Arms Up', arms: 'up', board: [0.06, -0.12, 0.08, 0.1, -0.32, -0.05], tuck: 0.25, lean: 0.1, twist: 0.3, side: 0.1 }],
  tailbone: [{ name: 'Stretched Tail Bone', board: [-0.08, -0.18, 0.12, -0.16, 0.48, -0.08], tuck: 0.2, lean: 0.3, twist: -0.45, side: -0.15 },
    { name: 'Tail Bone, Arms Up', arms: 'up', board: [-0.06, -0.12, 0.08, -0.1, 0.32, -0.05], tuck: 0.25, lean: 0.1, twist: -0.3, side: -0.1 }],
  tuckknee: [{ name: 'Deep Tuck Knee', board: [0, 0.14, -0.04, 0.12, 0.2, 0.2], tuck: 1, lean: 0.7, twist: 0.3, side: 0.15 },
    { name: 'Tuck Knee, Arms Up', arms: 'up', board: [0, 0.1, 0.02, 0, 0, 0], tuck: 0.98, lean: 0.35, twist: 0, side: 0 }],
  stiffy: [{ name: 'Stretched Stiffy', board: [0, -0.18, 0.08, 0.15, 0.15, -0.2], tuck: 0, lean: 0.3, twist: 0.3, side: 0.15 },
    { name: 'Stiffy, Arms Up', arms: 'up', board: [0, -0.14, 0.04, 0, 0, -0.1], tuck: 0.05, lean: -0.05, twist: 0, side: 0 }],
};
const _cache = new Map();
export function boardGrabDef(id, mod = '') {
  const gid = BOARD_FOR[id] || id, g = BOARD_GRABS[gid]; if (!g) return null;
  if (!mod) return g;
  // (cached by grab and version, with no string made: this is asked every frame a grab is held)
  const ci = mod === 'E' ? 0 : mod === 'R' ? 1 : 2, row = _cache.get(gid) || (_cache.set(gid, []), _cache.get(gid));
  if (row[ci]) return row[ci];
  const E = mod.includes('E'), R = mod.includes('R'), vs = BOARD_VARS[gid];
  const d = Object.assign({}, g);
  if (vs) {
    // the version itself (R's when both are held); both held: R's version pulled further, with E's boned leg
    Object.assign(d, R ? vs[1] : vs[0]);
    if (E && R) {
      d.board = d.board.map((v, i) => v * (i < 3 ? 1.25 : 1.35)); d.twist *= 1.3; d.side *= 1.3; d.lean += 0.08;
      // (named for the leg E kicks straight, or tweaked: a plain grab held a second is already called Tweaked)
      if (vs[0].bone && !d.bone) d.bone = vs[0].bone;
      d.name = vs[0].bone ? vs[1].name + (vs[0].bone === 'F' ? ' Nose Bone' : ' Tail Bone') : 'Tweaked ' + vs[1].name;
    }
  } else {
    d.board = g.board.map((v, i) => v * (i < 3 ? 1.3 : 1.5)); d.twist = g.twist * 1.45; d.side = g.side * 1.4; d.lean = g.lean + 0.12; d.name = 'Tweaked ' + g.name;
  }
  d.mod = mod;
  row[ci] = d;
  return d;
}
export const boardGrabName = (id, mod) => { const d = boardGrabDef(id, mod); return d ? d.name : id; };
// every ride other than skis names its own grabs and tricks: RIDE_GRABS[kind](id, mod) (the extra rides add theirs)
export const RIDE_GRABS = { board: boardGrabDef };
export const rideGrabDef = (kind, id, mod) => { const f = RIDE_GRABS[kind]; return f ? f(id, mod) : null; };
// what each board grab is, for the key list (as riders describe them; see BOARD_GRABS)
const BOARD_GUIDE = {
  indy: 'back hand, toe edge between the feet', mute: 'front hand, toe edge between the feet', melon: 'front hand behind the front leg, heel edge',
  stalefish: 'back hand round the back leg, heel edge', method: 'front hand, heel edge, the board pulled up behind', nose: 'front hand on the nose',
  tail: 'back hand on the tail', roastbeef: 'back hand between the legs, heel edge', japan: 'front hand, toe edge, the board pulled up behind, front knee down',
  crail: 'back hand forward to the toe edge by the nose, back leg straight', seatbelt: 'front hand across the body to the tail', truck: 'both hands: an indy and a melon',
  tindy: 'back hand, toe edge behind the back foot', swiss: 'back hand between the legs to the heel edge by the nose', rocket: 'both hands on the nose, back leg straight',
  slob: 'front hand, toe edge, back leg straight, board level', dracula: 'both hands on the tail, one round behind the back', nosebone: 'front leg kicked straight',
  tailbone: 'back leg kicked straight', tuckknee: 'both knees to the chest', stiffy: 'both legs straight',
};
// (2026-11-08) what E and R make of a grab, for the key list: the two versions' names
export const boardVarNames = id => { const v = BOARD_VARS[BOARD_FOR[id] || id]; return v ? [v[0].name, v[1].name] : null; };
/* (2026-11-08) the board's own keys in Shredsauce Controls: the skis' common grabs' keys give the board's common grabs
   (Z japan, X indy, C mute, V nose, B tail, F method, as BOARD_FOR maps the ski ids), and every other board grab on
   a key of its own (the ski table gave some of them twice and left melon and slob off the number row) */
RIDE_KEYS.board = { shred: { KeyZ: 'japan', KeyX: 'indy', KeyC: 'mute', KeyV: 'nose', KeyB: 'tail', KeyF: 'method',
  Digit1: 'stiffy', Digit2: 'rocket', Digit3: 'crail', Digit4: 'tindy', Digit5: 'roastbeef', Digit6: 'swiss', Digit7: 'stalefish', Digit8: 'slob',
  Digit9: 'seatbelt', Digit0: 'dracula', Minus: 'nosebone', Equal: 'tailbone', BracketLeft: 'tuckknee', BracketRight: 'truck', Backslash: 'melon',
  Semicolon: null, Quote: null } };
// (and the board's words for the snow and rail keys in the key list, input.js)
RIDE_HELP.board = { oneFoot: 'one-footer: the back foot out of its binding, held up off the tail', together: 'knees pinched in over a flat board: a tighter, steadier 50-50',
  lazy: 'hand drag: sat down on the heel edge, the back hand in the snow; held as you land, you land into it' };
export const RIDE_GUIDES = { board: id => BOARD_GUIDE[BOARD_FOR[id] || id] || '' };
export const rideGuide = (kind, id) => { const f = RIDE_GUIDES[kind]; return f ? f(id) : ''; };

// ---- trick names (tricks.js asks these for a board) ---------------------------------------------------------------------
// Spins are frontside or backside by the way the rider turns: frontside first turns the chest down the way you go
// (a regular rider turning left, goofy right, either the other way riding switch). A switch frontside spin is a cab
// (a switch frontside 180 a half cab). Flips: the board end over end is a wildcat (back) or a tamedog (front); the
// rider over their heels or toes (the roll here) is a backflip or a front flip; spun upside down, a cork (led by the
// spin), a rodeo (a back flip led) or a misty (a front flip led).
export function boardSpinParts(A, goofy) {
  const spinAbs = Math.abs(A.spin), spinR = Math.round(spinAbs / 180) * 180;
  const fs = ((A.spin > 0) !== !!goofy) !== !!A.sw;
  if (A.inv > 0) {
    const MULT = ['', 'Double ', 'Triple ', 'Quad ', 'Quint '];
    if (spinR < 180) {
      const n = MULT[Math.min(A.inv, 4) - 1];
      if (Math.abs(A.roll) > Math.abs(A.flip)) { const back = (A.roll > 0) === !!goofy; return [(A.sw ? 'Switch ' : '') + n + (back ? 'Backflip' : 'Front Flip')]; }
      return [(A.sw ? 'Switch ' : '') + n + (A.flip < 0 ? 'Wildcat' : 'Tamedog')];
    }
    const off = Math.max(Math.abs(A.flip), Math.abs(A.roll)) < spinAbs * 1.9, back = A.flip < 0 || (Math.abs(A.roll) > Math.abs(A.flip) && (A.roll > 0) === !!goofy);
    const kind = off ? 'Cork' : back ? 'Rodeo' : 'Misty';
    const deg = Math.max(spinR, Math.round(A.total / 180) * 180), invN = Math.max(1, Math.min(A.inv, Math.round(deg / 360) - 1));
    return [A.sw ? (fs ? 'Cab' : 'Switch Backside') : (fs ? 'Frontside' : 'Backside'), `${MULT[Math.min(invN, 4) - 1]}${kind} ${deg}`];
  }
  if (spinR < 180) return null;
  if (A.sw) return fs ? [spinR === 180 ? 'Half Cab' : `Cab ${spinR}`] : ['Switch Backside', `${spinR}`];
  return [fs ? 'Frontside' : 'Backside', `${spinR}`];
}
// on a rail: the board across it is a boardslide, frontside when the chest faces down the rail, backside when it faces
// back up it; along it a 50-50
export function boardRailName(mode, lockAng, goofy, kind) {
  if (mode !== 'slide') return null;
  const fb = goofy ? 1 : -1, fs = fb * -Math.sin(lockAng) > 0;
  return `${fs ? 'Frontside' : 'Backside'} Boardslide`;
}

// ---- the model ---------------------------------------------------------------------------------------------------------
let _gltf = null;
function loadModel() {
  if (_gltf) return _gltf;
  const loader = new GLTFLoader();
  const draco = new DRACOLoader(); draco.setDecoderPath('/car/vendor/three/addons/libs/draco/'); loader.setDRACOLoader(draco);
  _gltf = loader.loadAsync('./models/board/board.glb?v=20').catch(e => { _gltf = null; throw e; });
  return _gltf;
}
// the board's half width along it (at -1 tail .. +1 nose), measured from the model once
let HW = null;
function measureWidth(geo) {
  const P = geo.attributes.position, N = 24, w = new Float32Array(N + 1);
  for (let i = 0; i < P.count; i++) { const k = Math.round((P.getZ(i) / BOARD.half + 1) / 2 * N); if (k >= 0 && k <= N) w[k] = Math.max(w[k], Math.abs(P.getX(i))); }
  for (let k = 0; k <= N; k++) if (!w[k]) w[k] = w[k - 1] || 0.12;
  return w;
}
const halfWidth = at => { if (!HW) return 0.125; const N = HW.length - 1, f = clamp((at + 1) / 2, 0, 1) * N, i = Math.min(N - 1, Math.floor(f)); return HW[i] + (HW[i + 1] - HW[i]) * (f - i); };
// the top's rise towards the tips (the model's rocker), for grab points
const riseAt = at => { const a = Math.abs(at); return a > 0.8 ? ((a - 0.8) / 0.2) ** 2 * 0.03 : 0; };

Rig.loader.board = async (rig, opts) => {
  const gl = await loadModel();
  const src = {}; gl.scene.traverse(o => { if (o.isMesh) src[o.name] = o; });
  if (!HW && src.board) HW = measureWidth(src.board.geometry);
  rig.goofy = !!opts.goofy;
  const bd = rig.bd = { root: new THREE.Group(), bend: { value: 0 } };
  bd.root.name = 'snowboard';
  // the board flexes: a bend along its length (ends up from the middle, uBend metres at the tips) for presses and butters
  // (the locker's colours recolour the board and boots only once changed from its defaults: the downloaded board's own
  // picture is the default)
  const chosen = k => opts.look && opts.look[k] && opts.look[k] !== LOOK[k] ? opts.look[k] : null;
  const bm = tinted(src.board.material, chosen('skiB'), bd.bend);
  const board = new THREE.Mesh(src.board.geometry, bm); board.castShadow = true; board.name = 'board';
  bd.root.add(board);
  // the boots stand on the board in their bindings (the back one leaves it to push, and on the lift)
  const front = rig.goofy ? 'bootR' : 'bootL', back = rig.goofy ? 'bootL' : 'bootR';
  const btm = tinted(src[front].material, chosen('boots'), null);
  bd.bootF = new THREE.Mesh(src[front].geometry, btm); bd.bootB = new THREE.Mesh(src[back].geometry, btm);
  for (const m of [bd.bootF, bd.bootB]) { m.castShadow = true; m.matrixAutoUpdate = true; rig.root.add(m); }
  // the bindings (made here: no openly licensed snowboard binding model was found), both in one mesh on the board
  const bnd = new THREE.Mesh(bindingsGeometry(rig.goofy ? 1 : -1), BIND_MAT || (BIND_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 })));
  bnd.castShadow = true; bnd.name = 'bindings'; bd.root.add(bnd);
  rig.root.add(bd.root);
  rig.board = bd.root;
  // (snow.js stamps tracks and throws spray from rig.skiL / rig.skiR: the board stands in for both)
  rig.skiL = rig.skiR = bd.root;
  bd.lastPress = 0;
};

/* the board's and the boots' materials: the downloaded pictures, recoloured towards the colour chosen in the locker (the
   skis' second top sheet colour for the board, the boots' colour for the boots) keeping their light and shade; the
   board also flexes (uBend metres at the tips, for presses). One program for every board and boot (the uniforms differ). */
function tinted(src, colour, bend) {
  const m = src.clone(), tint = { value: new THREE.Color(colour || '#ffffff') }, k = { value: colour ? 0.8 : 0 }, b = bend || { value: 0 }, half = BOARD.half.toFixed(4);
  m.onBeforeCompile = s => {
    s.uniforms.uBend = b; s.uniforms.uTint = tint; s.uniforms.uTintK = k;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uBend;').replace('#include <begin_vertex>', `#include <begin_vertex>\n{ float t = position.z / ${half}; transformed.y += uBend * t * t; }`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uTintK;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(diffuseColor.rgb, uTint * min(1.6, l * 2.4), uTintK); }');
  };
  m.customProgramCacheKey = () => 'board-tint';
  m.userData.sharedMaps = true;           // (its picture is the loaded model's, shared by every board: rig.dispose leaves it)
  return m;
}

// ---- the bindings -----------------------------------------------------------------------------------------------------
/* Two snowboard bindings in the board's own frame (fb: the toe edge's side along x), each a baseplate under the boot, a
   heel cup, a highback behind the calf leaning forward, an ankle strap over the instep and a toe strap over the toes,
   in a dark plastic with coloured straps; one geometry with vertex colours (one draw call for both) */
let BIND_MAT = null;
const _bm = new THREE.Matrix4(), _bq2 = new THREE.Quaternion(), _bs = new THREE.Vector3(1, 1, 1);
function bindingsGeometry(fb) {
  const parts = [], dark = new THREE.Color(0x1c1e23), strap = new THREE.Color(0xd8462a), pad = new THREE.Color(0x2c2f36);
  const add = (g, col, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.applyMatrix4(_bm.compose(_v1.set(x, y, z), _bq2.setFromEuler(_eu.set(rx, ry, rz)), _bs.set(sx, sy, sz)));
    const c = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g);
  };
  const one = [];
  // a binding in its own frame: the boot's toes towards +z, its sole at y 0
  add(new THREE.BoxGeometry(0.15, 0.014, 0.27), dark, 0, 0.007, 0.0);                                         // baseplate
  add(new THREE.CylinderGeometry(0.078, 0.078, 0.07, 14, 1, true, Math.PI * 0.5, Math.PI), dark, 0, 0.05, -0.075);   // heel cup
  add(new THREE.CylinderGeometry(0.086, 0.082, 0.21, 14, 1, true, Math.PI * 0.55, Math.PI * 0.9), dark, 0, 0.19, -0.1, 0.22);   // highback
  add(new THREE.TorusGeometry(0.072, 0.014, 5, 14, Math.PI), strap, 0, 0.13, 0.0, 0.55, 0, 0, 1, 1, 1.6);     // ankle strap
  add(new THREE.TorusGeometry(0.06, 0.011, 5, 12, Math.PI), strap, 0, 0.055, 0.105, 0.35, 0, 0, 1.05, 0.8, 1.3); // toe strap
  add(new THREE.BoxGeometry(0.012, 0.05, 0.16), pad, 0.074, 0.03, -0.01); add(new THREE.BoxGeometry(0.012, 0.05, 0.16), pad, -0.074, 0.03, -0.01);   // side rails
  const single = mergeGeometries(parts, false); parts.length = 0;
  for (let j = 0; j < 2; j++) {
    const ang = j ? BOARD.angB : BOARD.angF, yaw = Math.atan2(fb * Math.cos(ang), Math.sin(ang));
    const g = single.clone(); g.applyMatrix4(_bm.compose(_v1.set(0, BOARD.top, j ? -BOARD.stance / 2 : BOARD.stance / 2), _bq2.setFromAxisAngle(Y, yaw), _bs.set(1, 1, 1)));
    one.push(g);
  }
  return mergeGeometries(one, false);
}

// ---- the pose ----------------------------------------------------------------------------------------------------------
const V = () => new THREE.Vector3(), Q = () => new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), NZ = new THREE.Vector3(0, 0, -1), ZERO = new THREE.Vector3();
const _q1 = Q(), _q2 = Q(), _q3 = Q(), _qi = Q(), _Rr = Q(), _bq = Q(), _bw = Q(), _pelQ = Q(), _chQ = Q(), _hdQ = Q(), _ry = Q(), _ryi = Q(), _qr = Q(), _lq = Q();
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _v5 = V(), _v6 = V(), _acc = V(), _vb = V(), _ub = V(), _bp = V(), _bpw = V(), _pull = V(), _hip = V(), _ank = [V(), V()], _toe = [V(), V()];
const _pf = V(), _cF = V(), _cL = V(), _cFl = V(), _sh = V(), _wr = V(), _fd = V(), _pa = V(), _el = V(), _gpt = V(), _gpa = V(), _gfi = V(), _kp = V();
// first person on the snow (2026-11-06): how much more upright the chest is (rad), how far the hips sit towards the
// trailing end (m), and how much further towards the nose, up and towards the toes the front hand rides (m)
// (2026-11-08: the front hand a little lower and further out over the toes, and the view's own aim FPV.board: measured
// with R's fpview.cjs (4 s of S-turns), the front hand in view 1.00 of the frames, the nose 1.00, the snow 25 m ahead
// 1.00; the sleeve no longer fills the bottom left)
const BFP = { lean: 0.25, hips: 0.3, lat: 0.06, up: -0.04, fwd: 0.12 };
// first person: how far down the view looks (tan of the angle under the level), for the board and the sled
export const FPV = { board: 0.7, sled: 0.62 };
Rig.BFP = BFP;
const _eu = new THREE.Euler(), _m4 = new THREE.Matrix4();
const gp = { pt: V(), palm: V(), fingers: V() }, gp2 = { pt: V(), palm: V(), fingers: V() };
const HAND_W = ['bhL', 'bhR'], ARMN = [['baLx', 'baLy', 'baLz'], ['baRx', 'baRy', 'baRz']], BSH = ['bs0', 'bs1', 'bs2', 'bs3', 'bs4', 'bs5'];
// (a grab's free arm out to the side at about shoulder height, as riders hold it in photos of grabs: Commons, "Snowboard
// IndyGrab2.jpg", "Snowboard.jpg", B/ref/; up: raised over the head, for a method)
const ARM_MODE = { out: [0.36, -0.02, -0.04], up: [0.22, 0.3, -0.1], wide: [0.42, -0.06, 0.0] };
const TG = new Float64Array(6), SH = new Float64Array(6);

// a point on the board (board-local) and the hand's palm and fingers there, all in the world (into out)
function boardPoint(bd, at, edge, fb, out) {
  const bq = bd.root.quaternion, bp = bd.root.position;
  const z = edge === 'end' ? Math.sign(at) * BOARD.half * 0.97 : at * BOARD.half * 0.97, hw = halfWidth(clamp(z / BOARD.half, -1, 1));
  const o = edge === 'toe' ? fb : edge === 'heel' ? -fb : 0;
  out.pt.set(o * (hw + 0.004), BOARD.top * 0.6 + riseAt(z / BOARD.half), z).applyQuaternion(bq).add(bp);
  const sx = _v5.set(1, 0, 0).applyQuaternion(bq), sy = _v6.set(0, 1, 0).applyQuaternion(bq);
  if (edge === 'end') { out.palm.copy(sy).negate(); out.fingers.set(0, 0, Math.sign(at) || 1).applyQuaternion(bq).addScaledVector(sy, -0.7).normalize(); }
  else { out.palm.copy(sx).multiplyScalar(-o); out.fingers.copy(sy).negate().addScaledVector(sx, -o * 0.35).normalize(); }
  return out;
}

/* on the lift's load and unload lines (S.state 'lift', S.liftSit under a half, S.liftFeet the snow under the feet) the
   rider stands on what they ride, as on the snow (a board rider with the back foot out, pushing along): a stand-in
   state for the posers, one object reused */
const _stand = {};
export function liftStand(S, skate = 0) {
  if (S.state !== 'lift' || !S.liftFeet || (S.liftSit ?? 1) >= 0.5) return S;
  Object.assign(_stand, S);
  _stand.state = 'ground'; _stand.p = S.liftFeet; _stand.vel = ZERO; _stand.speed = 0; _stand.edge = 0; _stand.skate = skate; _stand.press = 0; _stand.brake = 0; _stand.sink = 0;
  return _stand;
}
/* (2026-11-08) on a T-bar (J's tbar.js: S.liftKind 'tbar', S.tbar { bar, axis, stem }, the feet on the snow of the track
   and S.q up it): stood on the board as when riding it slowly up the track, the front foot strapped in and the back
   foot on the board by its binding, the bar behind the front thigh, leaning back against its pull a little, the chest
   turned up the track and the hand nearer the stem holding it. A stand-in state for the rest of the pose. */
const _tbS = {}, _tbV = new THREE.Vector3();
function tbarStand(S) {
  Object.assign(_tbS, S);
  _tbS.state = 'ground'; _tbS.p = S.liftFeet || S.p;
  _tbV.set(0, 0, 1).applyQuaternion(S.q).multiplyScalar(2.5);
  _tbS.vel = S.vel && S.vel.lengthSq() > 0.25 ? S.vel : _tbV; _tbS.speed = _tbS.vel.length();
  _tbS.edge = 0; _tbS.skate = 0; _tbS.pushing = 0; _tbS.press = 0; _tbS.brake = 0; _tbS.sink = 0; _tbS.lazy = 0; _tbS.crouch = 0.24; _tbS.tuck = 0; _tbS.sw = false;
  _tbS.oneFoot = 0; _tbS.together = 0; _tbS.landHit = 0;
  return _tbS;
}
Rig.poser.board = (rig, S0, dt) => {
  const bd = rig.bd; if (!bd) return;
  const tb = S0.state === 'lift' && S0.liftKind === 'tbar' && S0.tbar ? S0.tbar : null;
  const S = tb ? tbarStand(S0) : liftStand(S0, 1);
  const P = rig.p, sp = springBank(P, dt), b = rig.b;
  const st = S.state || 'ground', air = st === 'air', rail = st === 'rail', crash = st === 'crash', ground = st === 'ground', lift = st === 'lift';
  const t = S.t !== undefined ? S.t : (rig._t = (rig._t || 0) + dt);
  const vel = S.vel || ZERO, speed = S.speed !== undefined ? S.speed : vel.length();
  if (!P.bcrouch) { rig._pq = null; rig._pvOk = false; rig._pst = st; }
  const goofy = !!rig.goofy, noseX = goofy ? -1 : 1, fb = goofy ? 1 : -1;     // the nose along the rider's x; the toe edge along the board's x
  const th = goofy ? Math.PI / 2 : -Math.PI / 2;
  _ry.setFromAxisAngle(Y, th); _ryi.copy(_ry).invert();
  // the body's frame at the feet, and the rider's own frame (turned to face the toe edge)
  const R = rig.placeBody(S), BP = rig.body.position, qi = _qi.copy(R).invert();
  const Rr = _Rr.copy(R).multiply(_ry);
  if (lift) { poseLift(rig, S, dt, sp, R, Rr, noseX, fb, t); return; }
  // ---- how the body turns, and the snow's push on it (as for skis)
  const changed = rig._pst !== st;
  let wx = 0, wy = 0, wz = 0;
  if (rig._pq && dt > 0 && !changed) {
    const d = _q1.copy(rig._pq).invert().multiply(R), g = (d.w < 0 ? -2 : 2) / dt;
    wx = d.x * g; wy = d.y * g; wz = d.z * g;
    if (wx * wx + wy * wy + wz * wz > 450) wx = wy = wz = 0;
  }
  (rig._pq || (rig._pq = new THREE.Quaternion())).copy(R);
  const Wx = sp('bwx', wx, 14), Wy = sp('bwy', wy, 14), Wz = sp('bwz', wz, 14);       // board frame: + nose down, + left, + roll right
  const open = sp('bopen', air && dt > 0 ? clamp((Math.abs(rig._pWy || 0) - Math.abs(Wy)) / dt * 0.12, 0, 1) : 0, 10);
  rig._pWy = Wy;
  const ub = _ub.set(0, 1, 0).applyQuaternion(R);
  rig._gT = ground && !changed ? (rig._gT || 0) + dt : 0;
  let sx = 0, sz = 0, an = 0;
  if (ground && rig._gT > 0.06 && dt > 0 && rig._pvOk) {
    const a = _acc.subVectors(vel, rig._pv || vel).divideScalar(dt);
    an = clamp(a.dot(ub), -15, 30);
    a.y += 9.81; a.addScaledVector(vel, 0.0042 * speed); a.applyQuaternion(qi);
    sx = clamp(a.x, -13, 13); sz = clamp(a.z, -9, 9);
  }
  (rig._pv || (rig._pv = new THREE.Vector3())).copy(vel); rig._pvOk = true; rig._pst = st;
  const Sx = sp('bsx', sx, 10), An = sp('ban', an, 10);
  const vb = _vb.copy(vel).applyQuaternion(qi);
  // the lean into a turn (about the board's long axis): + leans the body to the board's +x side
  /* (2026-11-08, for "the snowboard leans too far at high speed") the lean into a turn as riders carve: it grows with the
     turn's push but eases off towards a cap (0.7 rad slow, 0.48 from 20 m/s), the knees and hips taking the rest
     (angulation, below). It went straight to 0.8 rad, the rider nearly lying on the snow in a fast carve. */
  const fastK = smoothstep(8, 20, speed), phiCap = 0.7 - 0.22 * fastK, phi = phiCap * Math.tanh(Math.atan2(-Sx, 9.81) / phiCap);
  const toeK = clamp(fb * -Math.sin(phi) * 2.4, -1, 1);                      // + on the toe edge, - on the heel edge
  const brake = sp('bbrake', ground ? S.brake || 0 : 0, 10), tuck = sp('btuck', S.tuck || 0, 9);
  // (a butter goes in and out over about a tenth of a second: 14/s jerked the board round as one ended, 2026-11-08)
  // (P's landInto: N or S held in the air to land straight into a press or a hand drag; the board and body get ready over
  // the last moments before the snow, from last frame's nearness to it)
  const into = air ? S.landInto || null : null, preL = air ? rig._prepL || 0 : 0;
  const press = sp('bpress', (rail ? S.railPress : ground ? S.press : into === 'nose' ? 0.7 * preL : into === 'tail' ? -0.7 * preL : 0) || 0, 10);
  if (ground) bd.lastPress = S.press || 0;
  const lazy = sp('blazy', ground ? S.lazy || 0 : into === 'lazy' ? 0.6 * preL : 0, 8);
  // (P's push, 2026-11-08: S.pushing 0..1 and its stroke's phase S.pushT, for every ride; S.skate before it)
  const skate = sp('bskate', ground ? Math.max(S.skate || 0, S.pushing || 0) : 0, 9);
  /* (2026-11-08) R held on a rail or the snow: a one-footer, the back foot out of its binding and held up behind the
     tail; E held: the knees pinched in towards each other over a flat board, a tight, steady 50-50 */
  const one1 = sp('bone1', ground || rail ? clamp(S.oneFoot || 0, 0, 1) : 0, 9), tog = sp('btog', ground || rail ? clamp(S.together || 0, 0, 1) : 0, 9);
  /* (2026-11-08) how the body takes what just happened (P's state: S.takeoff, S.landHit, S.landOff, S.trickSeq): a hard
     pop opens the body up more, a soft roll-off keeps it low with the arms out for balance; a hard landing folds
     deeper, chest and head down; one landed off to the side throws the chest and arms that way; out of a spin the upper
     body follows on round and comes back, out of a flip the chest rebounds; a butter let go settles as a sideways
     landing does (knees giving, arms out) */
  const tko = S.takeoff, popAmp = tko ? 0.45 + 0.9 * clamp(tko.pop ?? 1, 0, 1) : 1;
  const rollOff = air && tko ? (1 - smoothstep(0.12, 0.4, tko.pop ?? 1)) * (1 - smoothstep(0.35, 0.7, rig._airT || 0)) : 0;
  const landK = ground ? Math.exp(-(S.landT ?? 9) * 3.2) : 0, hardL = clamp(S.landHit || 0, 0, 1) * landK;
  const offL = clamp((S.landOff || 0) / 0.6, -1, 1) * landK;
  if (air) { rig._lastWy = rig._pWy || 0; const sq = S.trickSeq; rig._lastTrick = sq && sq.length ? sq[sq.length - 1] : ''; }
  const landBump = landK * (1 - landK) * 4, lastT = ground ? rig._lastTrick || '' : '';
  const unwind = lastT.startsWith('spin') ? clamp((rig._lastWy || 0) * 0.06, -0.45, 0.45) * landBump : 0;
  const rebound = lastT.startsWith('flip') || lastT.startsWith('roll') ? 0.25 * landBump : 0;
  const prNow = Math.abs((ground ? S.press : 0) || 0);
  if ((rig._prMax || 0) > 0.3 && prNow < 0.12) { rig._unb = 1; rig._prMax = 0; } else if (prNow > (rig._prMax || 0)) rig._prMax = prNow;
  rig._unb = Math.max(0, (rig._unb || 0) - dt / 0.7);
  const unb = sp('bunb', ground ? smooth01(rig._unb) : 0, 12);
  const crashW = sp('bcrash', crash ? 1 : 0, 6), airW = sp('bairW', air ? 1 : 0, air ? 10 : 9), railW = sp('brailW', rail ? 1 : 0, 12);
  const absorb = S.absorb || 0, tt = t + rig.ph;
  rig._airT = air ? (changed ? 0 : (rig._airT || 0) + dt) : 0;
  const popK = (air ? smooth01(rig._airT / 0.05) * (1 - smoothstep(0.12, 0.34, rig._airT)) : 0) * Math.min(1.2, popAmp);
  const nollie = sp('bnollie', air && rig._airT < 0.4 && bd.lastPress > 0.3 ? 1 : 0, 12);
  // the travel along the rider's x: +1 to the left, -1 to the right (the nose's way, or the tail's riding switch)
  const travelX = noseX * (S.sw ? -1 : 1);
  // ---- the board's roll onto its edges: the turn's, or in a skid the edge the slide asks for (the uphill one)
  const slipX = ground ? vb.x : 0;
  if (Math.abs(slipX) > 0.6) rig._slip = slipX > 0 ? 1 : -1;
  const slipK = smoothstep(0.7, 2.8, Math.abs(slipX));
  let eT = 0;
  if (ground) {
    const eIn = (S.edge || 0) * (0.5 + 0.4 * smoothstep(1, 10, speed));
    eT = eIn + (clamp(slipX / 3.5, -1, 1) * 0.75 - eIn) * slipK + brake * 0.3 * (rig._slip || 1) * (1 - slipK);
    if (phi * eT >= 0) { if (Math.abs(eT) < Math.abs(phi) * 1.05) eT = phi * 1.05; }
    else eT += (phi * 1.05 - eT) * smoothstep(0.06, 0.3, Math.abs(phi));
  }
  // (the board's own edge eased off in a fast carve as well, towards 0.75 rad from 20 m/s: it went over 0.9, 2026-11-08)
  const eCap = 0.95 - 0.2 * fastK, edge = sp('bedge', eCap * Math.tanh(eT / eCap), 14);
  // ---- crouch: a board rider rides lower than a skier, knees bent over the toes
  const comp = ground ? clamp(An * 0.006, -0.05, 0.08) : 0, landX = ground ? absorb * 0.7 : 0;
  const settled = smoothstep(0.8, 2.0, S.landT ?? 9);
  const bob = (ground ? 0.035 * settled : rail ? 0.04 : 0) * wob(tt * (rail ? 4.2 : 3.1), 1.3);
  const heel = Math.max(0, -toeK);
  // meeting a rail or swapping on it: the knees take it (a quick dip), the arms snap out (S.railHitT, P's rail events)
  const hitK = rail || (S.railHitT ?? 9) < 0.3 ? Math.max(0, 1 - (S.railHitT ?? 9) / 0.3) : 0;
  let cT = (S.crouch ?? 0.3) + 0.1 + comp + landX + bob + 0.08 * heel + 0.1 * brake + 0.55 * lazy + 0.16 * hitK + 0.1 * tog + 0.38 * hardL + 0.08 * landBump + 0.12 * unb + 0.1 * rollOff;
  if (air && (S.grab || S.pose)) cT = Math.max(cT, 0.72);
  if (air) cT += (0.08 - cT) * popK;
  const crouch = sp('bcrouch', clamp(cT, 0, 1), popK > 0.2 || landX > 0.03 ? 30 : 20);
  // ---- grabs and positions
  const gid = air ? (S.grab || S.pose || null) : null;
  const gd = gid ? boardGrabDef(gid, S.tweak || '') : null;
  rig.grabHeld = gid && gid === rig.gid ? (rig.grabHeld || 0) + dt : 0; rig.gid = gid;
  const gW = sp('bgw', gd ? 1 : 0, gd ? 13 : 9);
  const prep = air ? 1 - smoothstep(0.09, 0.36, rig.timeToGround(S.p, vel)) : 0;
  rig._prepL = prep;
  const ext = sp('bext', air ? 1 - prep : 0, air ? 28 : 32);
  const twk = 1 + 0.18 * smooth01((rig.grabHeld - 0.45) / 0.75) + 0.04 * Math.sin(rig.grabHeld * 3.4) * smooth01(rig.grabHeld / 0.6);
  const flF = sp('bflF', air ? smoothstep(0.7, 4.2, Wx) : 0, 7, 0.75), flB = sp('bflB', air ? smoothstep(0.7, 4.2, -Wx) : 0, 7, 0.75);
  // the rider's own flips (the roll here, about the board's length): heels first is a backflip, toes first a front flip
  const rs = goofy ? -1 : 1, rlB = sp('brlB', air ? smoothstep(0.7, 4, -Wz * rs) : 0, 7, 0.75), rlF = sp('brlF', air ? smoothstep(0.7, 4, Wz * rs) : 0, 7, 0.75);
  // a back flip of either kind is laid out (long body, arched, arms out, head back), a front flip tucked (knees to the
  // chest, hands to the shins, chin in), unless a grab is held
  const lay = Math.max(flB, rlB) * (1 - (gd ? 1 : 0)), tkF = Math.max(flF, rlF) * (1 - (gd ? 1 : 0));
  const spinning = air ? smoothstep(2.2, 5, Math.abs(Wy)) * (1 - gW) : 0;
  const flow = air ? (1 - gW) * (1 - smoothstep(1.2, 3.5, Math.abs(Wx) + Math.abs(Wy) + Math.abs(Wz))) : 0;
  // the board's shape in the air (rider's terms, see BOARD_GRABS), springs so a grab comes and goes smoothly
  if (gd) for (let i = 0; i < 6; i++) TG[i] = gd.board[i] * (i < 3 ? twk : 1 + (twk - 1) * 0.8);
  else if (air) {
    TG[0] = 0.02 * flow * wob(tt * 0.8, 21); TG[1] = 0.04 * flow * wob(tt * 1.3, 3); TG[2] = 0.03 * flow * wob(tt * 1.05, 7);
    TG[3] = 0.06 * flow * wob(tt * 0.9, 2); TG[4] = 0.08 * flow * wob(tt * 1.2, 5) + 0.3 * popK * (1 - 2 * nollie); TG[5] = -0.05 + 0.06 * flow * wob(tt * 1.0, 9);
  } else for (let i = 0; i < 6; i++) TG[i] = 0;
  // the board trails a rotation thrown and swings past when it stops
  if (air) { const Ax = clamp((Wx - (rig._pWx ?? Wx)) / Math.max(dt, 1e-3), -40, 40); TG[4] += clamp(Ax * 0.01 * noseX, -0.25, 0.25) * (gd ? 0.5 : 1); }
  rig._pWx = Wx;
  for (let i = 0; i < 6; i++) SH[i] = sp(BSH[i], TG[i], gd ? 14 : 11, air ? (gd ? 0.74 : 0.72) : 1);
  const kneeUp = sp('bkneeUp', (gd ? 0.05 + 0.32 * gd.tuck : air ? (0.05 + 0.1 * crouch + 0.05 * spinning) * (1 - lay) + 0.34 * tkF - 0.06 * lay : 0) * (1 - popK), gd ? 15 : 12, air ? 0.8 : 1);
  const boneF = sp('bboneF', gd && gd.bone && gd.bone.includes('F') ? 1 : 0, 12), boneB = sp('bboneB', gd && gd.bone && gd.bone.includes('B') ? 1 : 0, 12);
  // ---- the board, in the body's frame
  const lp = _bp.set(0, 0, 0), lq = _lq.identity();
  lq.setFromAxisAngle(Z, edge);
  lp.y += Math.abs(Math.sin(edge)) * halfWidth(0) - (S.sink || 0);
  // a press or butter: pitched about the pressed end (which stays down), the board bending; a lazy boy sits on the tail
  const pr = clamp(press - 0.6 * lazy, -1, 1);
  if (Math.abs(pr) > 0.002) {
    const pa = pr * 0.3, zp = (pr > 0 ? 1 : -1) * BOARD.half * 0.62;
    lq.multiply(_q1.setFromAxisAngle(X, pa));
    lp.y += zp * Math.sin(pa); lp.z += zp * (1 - Math.cos(pa));
  }
  // loading the pop: weight on the tail (an ollie) or the nose (a nollie)
  if (ground && S.loading) { const pa = (bd.lastPress > 0.3 ? 1 : -1) * 0.07; lq.multiply(_q1.setFromAxisAngle(X, pa)); lp.y += BOARD.half * 0.6 * Math.abs(Math.sin(pa)); }
  if (ext > 0.001) {
    // the air: the board comes up under the hips by kneeUp, then the grab's (or a loose air's) shape on top, in the
    // rider's terms turned into the board's
    const e = ext;
    lp.y += (kneeUp + SH[1] - 0.1 * (boneF + boneB)) * e;
    lp.x += SH[2] * fb * e; lp.z += SH[0] * e;          // towards the toes is the board's fb side; towards the nose +z
    // rotations about the rider's axes: nose turned to the front (yaw), nose up (about the rider's z), heel edge up (about x)
    _qr.setFromAxisAngle(Y, -SH[3] * noseX * e).multiply(_q1.setFromAxisAngle(Z, SH[4] * noseX * e)).multiply(_q2.setFromAxisAngle(X, SH[5] * e));
    _q3.copy(_ry).multiply(_qr).multiply(_ryi);           // into the board's frame
    lq.premultiply(_q3);
  }
  // a shifty: the board turned across under the body (the chest turned the other way)
  const lowYaw = sp('blowYaw', air ? -(S.shift || 0) * 1.0 : 0, air ? 15 : 20, air ? 0.8 : 1) * smooth01(ext * 1.6);
  if (Math.abs(lowYaw) > 1e-4) { _q1.setFromAxisAngle(Y, lowYaw); lp.applyQuaternion(_q1); lq.premultiply(_q1); }
  if (crashW > 0.01) { lp.y += 0.2 * crashW; lq.multiply(_q1.setFromAxisAngle(Y, 0.5 * crashW * Math.sin(t * 2.3))); }
  // ---- the pelvis: over the middle of the stance at the crouch's height, leaning with the snow's push
  const A0 = rig.ankleH + BOARD.top + BOARD.ankleUp;
  let H = A0 + rig.legLen * 0.97 * (0.95 - (0.5 * crouch + 0.15 * tuck)) + (rig.pelvisY - rig.hipY);
  H += (0.92 * (1 - crouch * 0.35) + (rig.pelvisY - rig.hipY) * 0.5 - H) * airW;
  const colL = H - A0;
  // in the board's frame: across the board into the turn; along it towards a press, a pop's loaded end, a pushing foot
  let pelX = -Math.sin(phi) * colL + (0.016 + 0.014 * railW) * wob(tt * (1.7 + 0.9 * railW), 4.4) * (1 - airW);
  let pelY = A0 + colL * Math.cos(phi);
  let pelZ = 0.14 * pr + (ground && S.loading ? (bd.lastPress > 0.3 ? 0.06 : -0.06) : 0) + 0.12 * skate + 0.08 * one1 - (tb ? 0.05 : 0);
  // (first person: the hips a little towards the trailing end, the head over the middle of the board, 2026-11-06)
  pelZ -= BFP.hips * (S.sw ? -1 : 1) * sp('bfpW0', rig.fp ? 1 : 0, 6) * (1 - airW);
  // heel side: hips back over the heels (sitting down a little); toe side: knees and hips forward
  pelX += fb * (0.05 * toeK - 0.03 - 0.16 * lazy) * (1 - airW);      // (a hand drag sits down low over the heel edge)
  pelY -= 0.22 * lazy;
  // ---- the upper body, in the rider's frame
  // (where it looks: along the travel, from the velocity in the rider's frame; slow, the way the board points)
  _v1.copy(vb).applyQuaternion(_ryi);
  const faceV = Math.atan2(_v1.x, _v1.z), fast = smoothstep(0.8, 2.5, speed);
  const look = (ground || rail) ? clamp(faceV * fast + travelX * 1.35 * (1 - fast), -1.75, 1.75) : travelX * 1.2;
  const openT = 0.28 * travelX;                                            // the hips open a little towards the way you go
  const gl = rig._gl;
  if (t > gl.next || t < gl.next - 30) { gl.yaw = (Math.random() - 0.5) * 0.7; gl.pitch = (Math.random() - 0.35) * 0.2; gl.until = t + 0.6 + Math.random() * 0.8; gl.next = gl.until + 2.5 + Math.random() * 4; }
  const glance = t < gl.until && ground && Math.abs(S.edge || 0) < 0.5 && brake < 0.2;
  const spinLead = sp('bspinLead', air ? clamp(Wy * 0.09, -0.8, 0.8) : 0, 16);
  let twT, sdT, lnT, hyT, hpT;
  if (air) {
    const sway = 0.08 * gW + 0.18 * flow;
    twT = (gd ? gd.twist * noseX : 0.38 * travelX) + sway * wob(tt * 1.25, 8.8);
    sdT = (gd ? -gd.side * noseX : clamp(Wz * 0.03, -0.2, 0.2)) + (0.05 * gW + 0.08 * flow) * wob(tt * 1.05, 6.1);
    lnT = (gd ? gd.lean : 0.22 + 0.12 * prep + 0.25 * spinning + 0.75 * tkF - 0.5 * lay) + 0.25 * popK + 0.08 * flow * wob(tt * 0.85, 4.4) + 0.15 * rollOff;
    hyT = travelX * 1.0 + clamp(Wy * 0.08, -0.55, 0.55);
    hpT = 0.1 + 0.3 * prep + 0.35 * tkF - 0.45 * lay;
  } else if (rail) {
    // on a rail the chest turns down it, the head looks along it, the arms out for balance
    twT = clamp(look * 0.45, -0.9, 0.9);
    sdT = (S.balance || 0) * 0.3 * -noseX + 0.05 * wob(tt * 2.2, 7.7);
    lnT = 0.32 + 0.3 * Math.abs(press) + 0.1 * tog - 0.06 * one1;
    hyT = look; hpT = 0.18;
  } else {
    twT = openT + 0.2 * travelX * Math.abs(toeK) + clamp(Wy * 0.05, -0.2, 0.2) + 0.55 * skate * noseX;
    sdT = -0.25 * pr * noseX;                                            // a press: the shoulders drop towards the pressed end
    lnT = 0.3 + 0.32 * Math.max(0, toeK) + 0.12 * heel + 0.35 * tuck + 0.15 * (S.loading ? 1 : 0) - 0.15 * lazy + 0.2 * Math.abs(pr) - 0.1 * brake;
    twT -= 0.4 * lazy * noseX; sdT += 1.15 * lazy * noseX; lnT -= 0.85 * lazy;   // a hand drag: turned, leaned back and dropped towards the back hand
    // (2026-11-08) the landing's and the butter's reactions (above); on a T-bar turned up the track, leaning back a little
    twT += unwind + 0.25 * unb * travelX; sdT += 0.45 * offL; lnT += 0.55 * hardL + 0.12 * landBump - rebound + 0.08 * tog;
    if (tb) { const on = tb.on ?? 1; twT += 0.5 * noseX * on; lnT -= 0.1 * on; }
    hyT = look + (glance ? gl.yaw : 0);
    hpT = 0.06 + (glance ? gl.pitch : 0) + 0.25 * lazy;
  }
  const wB = air && gd ? 13 : 9, zA = air ? 0.75 : 1;
  const tw = sp('btw', twT, air && gd ? 13 : 8, zA), sd = sp('bsd', sdT, wB, zA), ln = sp('bln', lnT, air ? (popK > 0.1 ? 20 : wB + 2) : 9, zA), hy = sp('bhy', hyT, rail ? 7 : 8), hp = sp('bhp', hpT, 7, air ? 0.8 : 1);
  const onSnow = 1 - airW;
  /* (seen in first person, 2026-11-06: on the snow the chest a little more upright and the front hand out over the nose,
     so the nose and the front hand are in view from the eyes as a rider sees them; leaning as the rest of the pose has
     it, the eyes were over the nose and the hands under the chin. Only this rider's own eyes see it.) */
  const fpW = sp('bfpW', rig.fp ? 1 : 0, 6);
  const lean = ln + (0.38 * crouch * (1 - gW) - 0.4 * (landX + absorb) + 0.1 * absorb + 1.2 * Math.max(0, comp) - BFP.lean * fpW) * onSnow + 0.02 * wob(tt * 1.1, 9.1);
  const idleY = 0.03 * wob(tt * 0.9, 3.7) * onSnow * (1 - railW);
  const hipK = gd ? (gd.hips ?? 0.4) : 0.45;
  const chYaw = tw + spinLead + idleY - lowYaw * 0.4, pelYaw = tw * hipK - spinLead * 0.15 + lowYaw * 0.5;
  // the lean into a turn is fore and aft for the rider: across the board is the rider's forward
  const chRoll = sd * 0.7 + 0.02 * wob(tt * 1.3, 5.2) * onSnow, pelRoll = sd * 0.25;
  const pelPitch = 0.3 * Math.max(0, toeK) * onSnow - 0.15 * heel * onSnow + lean * 0.35 * gW;
  // ---- place the board (needed before the pelvis's reach check)
  const bw = bd.root;
  bw.position.copy(lp).applyQuaternion(R).add(BP); bw.quaternion.copy(R).multiply(lq);
  // the bindings' ankles in the world
  const pullW = _pull.set(0, 0, 0);
  bindingAnkles(rig, bd, fb);
  // on the snow the legs must still reach the boots: the pelvis comes down rather than lifting the board
  const pelQ = _pelQ.copy(Rr).multiply(_q1.setFromAxisAngle(Y, pelYaw)).multiply(_q1.setFromAxisAngle(Z, pelRoll)).multiply(_q1.setFromAxisAngle(X, pelPitch));
  const pelW = _v2.set(pelX, pelY, pelZ).applyQuaternion(R).add(BP);
  if (airW < 0.5) {
    for (let k = 0; k < 2; k++) {
      const hipW = _v3.set(k ? -rig.hipHalf : rig.hipHalf, rig.hipY - rig.pelvisY, 0).applyQuaternion(pelQ).add(pelW);
      const an = _ank[k], dxz = Math.hypot(hipW.x - an.x, hipW.z - an.z), dy = hipW.y - an.y, d0 = Math.hypot(dxz, dy);
      const d1 = softReach(d0, rig.legLen, 0.86, 0.96);
      if (d1 < d0 && d1 > dxz) pelW.y -= dy - Math.sqrt(d1 * d1 - dxz * dxz);
    }
  }
  const chQ = _chQ.copy(Rr).multiply(_q1.setFromAxisAngle(Y, chYaw)).multiply(_q1.setFromAxisAngle(Z, chRoll)).multiply(_q1.setFromAxisAngle(X, lean));
  if (crashW > 0.01) chQ.multiply(_q1.setFromEuler(_eu.set(Math.sin(t * 3.1) * 0.6 * crashW, Math.sin(t * 2.3) * 0.5 * crashW, Math.cos(t * 2.7) * 0.6 * crashW)));
  rig.setWorldQ(b.root, _q2.copy(pelQ).multiply(rig.rest.root.q));
  b.pelvis.updateWorldMatrix(false, false);
  const off = _v4.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v5.setFromMatrixPosition(b.root.matrixWorld));
  rig.setWorldPos(b.root, _v6.copy(pelW).sub(off));
  rig.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
  rig.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); rig.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); rig.blendBone(b.chest, 'chest', pelQ, chQ, 1);
  const hdYaw = clamp(hy - tw * (1 - 0.3 * airW), -1.45, 1.45);
  const hdQ = _hdQ.copy(chQ).multiply(_q1.setFromAxisAngle(Y, hdYaw)).multiply(_q1.setFromAxisAngle(Z, -chRoll * 0.5)).multiply(_q1.setFromAxisAngle(X, hp - lean * 0.6 + 0.2 * hardL));
  rig.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); rig.blendBone(b.head, 'head', hdQ, hdQ, 0);
  rig.blendBone(b.clL, 'clL', chQ, chQ, 0); rig.blendBone(b.clR, 'clR', chQ, chQ, 0);
  // ---- grabs: the hand to its point; the board brought up to a hand that cannot reach it (at most 55 cm)
  const holdOK = ext > 0.55;
  for (let k = 0; k < 2; k++) {
    const side = k ? 'R' : 'L', isFront = (k === 0) === (noseX > 0);
    let want = null; if (gd) for (const h of gd.hands) if ((h[0] === 'F') === isFront) want = h;
    const w = sp(HAND_W[k], want && holdOK ? 1 : 0, want && holdOK ? 22 : 12);
    const Hs = rig.hs[k];
    if (want && want !== Hs.cur) { Hs.prev = Hs.cur && w > 0.05 ? Hs.cur : null; Hs.f.set(Hs.prev ? 0 : 1); Hs.cur = want; }
    Hs.fx = Hs.f.to(1, 13, dt); Hs.w = Hs.cur ? w : 0;
    if (Hs.w > 0.02) {
      const ua = k ? b.uaR : b.uaL; ua.updateWorldMatrix(false, false);
      const sh = _v3.setFromMatrixPosition(ua.matrixWorld), reach = (rig.len.ua + rig.len.fa) * 0.92;
      const g = boardPoint(bd, Hs.cur[1], Hs.cur[2], fb, gp);
      const wp = _v4.copy(g.pt).addScaledVector(g.fingers, -0.07).addScaledVector(g.palm, -0.03), dd = wp.distanceTo(sh);
      if (dd > reach) pullW.addScaledVector(_v5.subVectors(sh, wp).normalize(), Math.min(0.55, dd - reach) * Hs.w);
    }
  }
  // (two hands on the board: the pull is their average, not their sum, or a truck driver jammed the board into the body)
  if (gd && gd.hands.length > 1) pullW.multiplyScalar(1 / gd.hands.length);
  const pl = _v3.copy(pullW).applyQuaternion(qi);
  _v4.set(sp('bpx', pl.x, 20), sp('bpy', pl.y, 20), sp('bpz', pl.z, 20));
  if (_v4.lengthSq() > 1e-8) { lp.add(_v4); bw.position.copy(lp).applyQuaternion(R).add(BP); }
  // keep both bindings within their legs' reach (pulled towards the hips, a boned leg nearly straight)
  for (let it = 0; it < 2; it++) {
    bindingAnkles(rig, bd, fb);
    let worst = 0; _v5.set(0, 0, 0);
    for (let k = 0; k < 2; k++) {
      const thb = rigLegThigh(rig, k, noseX); thb.updateWorldMatrix(false, false);
      const hip = _hip.setFromMatrixPosition(thb.matrixWorld), an = _ank[legBinding(k, noseX)];
      const dd = an.distanceTo(hip), boned = legBinding(k, noseX) === 0 ? boneF : boneB, L = rig.legLen;
      const lim = (0.975 - (0.975 - 0.995) * boned) * L, lim2 = Math.min(dd, lim) + (softReach(dd, L, 0.86 + 0.1 * boned, 0.975 + 0.015 * boned) - Math.min(dd, lim)) * airW;
      if (dd > lim2) { const ex = dd - lim2; if (ex > worst) worst = ex; _v5.addScaledVector(_v6.subVectors(hip, an).normalize(), ex); }
    }
    if (worst > 0) { _v5.normalize().multiplyScalar(worst); bw.position.add(_v5); }
  }
  bindingAnkles(rig, bd, fb);
  bd.bend.value = 0.028 * Math.abs(pr) + 0.01 * lazy;           // (a press bows the board: 2.8 cm at the tips)
  // pushing on the flat (a skate): the back foot leaves its binding, steps onto the snow on the toe side beside the
  // board, pushes back along it, then lifts and comes forward again; the front foot stays in
  const out = sp('bout', ground && skate > 0.15 && speed < 7 ? 1 : 0, 9), dirT = S.sw ? -1 : 1;     // (nobody pushes at speed)
  if (out > 0.01) {
    let u = (S.pushing || 0) > 0.05 && S.pushT !== undefined ? S.pushT : S.skateT !== undefined ? S.skateT : (rig._skT = (rig._skT || 0) + dt * 1.3);
    u -= Math.floor(u);
    // (P's stroke: the push over 0..0.45 of it, the recovery after; the old skate's over 0..0.6)
    const sp0 = (S.pushing || 0) > 0.05 && S.pushT !== undefined ? 0.45 : 0.6;
    const push = u < sp0, w = push ? u / sp0 : (u - sp0) / (1 - sp0);
    const zf = push ? 0.16 - 0.5 * w : -0.34 + 0.5 * smooth01(w), yf = push ? 0 : 0.09 * Math.sin(Math.PI * w);
    _pf.set(fb * (halfWidth(0) + 0.12), yf + 0.03 + rig.ankleH - (S.sink || 0), dirT * (zf - BOARD.ankleBack)).applyQuaternion(R).add(BP);
    _ank[1].lerp(_pf, out);
  }
  // (2026-11-08) a one-footer: the back foot lifted off the board just behind the tail, a little out over the toe edge,
  // paddling a touch for balance
  if (one1 > 0.01) {
    _pf.set(fb * (halfWidth(-0.6) + 0.04), BOARD.top + rig.ankleH + 0.2 + 0.03 * wob(tt * 2.6, 13), -BOARD.stance / 2 - 0.2).applyQuaternion(bw.quaternion).add(bw.position);
    _ank[1].lerp(_pf, one1);
  }
  // ---- the legs: to the boots, the knees over the toes (out a little, the duck stance), pushed in a turn
  for (let k = 0; k < 2; k++) {
    const j = legBinding(k, noseX), toe = _toe[j];
    const th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
    const kp = _kp.copy(toe).addScaledVector(ub, 0.35);
    kp.addScaledVector(_v3.set(fb, 0, 0).applyQuaternion(R), 0.4 * toeK);
    if (j === 1 && out > 0.01) kp.lerp(_v3.set(0, 0, dirT).applyQuaternion(R).addScaledVector(ub, 0.3), out);
    // (the lifted foot's knee forward and out over the toes; pinched in, the knees towards each other)
    if (j === 1 && one1 > 0.01) kp.lerp(_v3.set(fb * 0.7, 0, 0.3).applyQuaternion(bw.quaternion).addScaledVector(ub, 0.4), one1);
    if (tog > 0.01) kp.addScaledVector(_v3.set(0, 0, j === 0 ? -1 : 1).applyQuaternion(bw.quaternion), 0.8 * tog);
    rig.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', _ank[j], kp, Z);
    _q3.copy(bw.quaternion).multiply(_q1.setFromAxisAngle(Y, j === 0 ? bd.yawF : bd.yawB));
    if (j === 1 && out > 0.01) _q3.slerp(_q2.copy(R).multiply(_q1.setFromAxisAngle(Y, dirT > 0 ? 0.25 * fb : Math.PI - 0.25 * fb)), out);
    rig.setWorldQ(ft, _q3.multiply(rig.rest[k ? 'ftR' : 'ftL'].q));
    if (j === 1) { bd.backFoot = ft; (bd.backFootRest || (bd.backFootRest = new THREE.Quaternion())).copy(rig.rest[k ? 'ftR' : 'ftL'].q).invert(); }
  }
  bd.backOut = out > 0.01 || one1 > 0.01;
  placeBoots(rig, bd, skate, t, S);
  bd.backOut = false;
  // ---- arms
  const cF = _cF.set(0, 0, 1).applyQuaternion(chQ), cL = _cL.set(1, 0, 0).applyQuaternion(chQ);
  const cFl = _cFl.copy(cF).addScaledVector(ub, -cF.dot(ub)); if (cFl.lengthSq() < 1e-4) cFl.copy(cF); cFl.normalize();
  const armL = rig.len.ua + rig.len.fa;
  // (the T-bar: the hand that holds the stem, tbar.hand, as far as the bar is taken, tbar.on)
  const tbK = tb ? (tb.hand === 'L' ? 0 : 1) : -1, tbOn = tb ? smooth01(tb.on ?? 1) : 0;
  for (let k = 0; k < 2; k++) {
    const side = k ? 'R' : 'L', s = k ? -1 : 1, Hs = rig.hs[k], front = s === noseX;
    let lat, up, fwd;
    if (air) {
      // relaxed and a little out; in to the chest spinning without a grab (tighter the faster), out to stop it
      lat = front ? 0.2 : 0.14; up = -0.36; fwd = 0.12;
      lat += (0.36 - lat) * lay; up += (0.05 - up) * lay; fwd += (-0.02 - fwd) * lay;            // laid out: arms out wide
      lat += (0.12 - lat) * tkF; up += (-0.5 - up) * tkF; fwd += (0.32 - fwd) * tkF;              // tucked: hands to the shins
      lat += (0.04 - lat) * spinning; up += (-0.2 - up) * spinning; fwd += (0.2 - fwd) * spinning;
      lat += 0.14 * open; up += 0.06 * open;
      fwd += 0.12 * popK; up += 0.12 * popK;
      fwd += 0.12 * prep; lat += 0.04 * prep;
      lat += 0.2 * rollOff; up += 0.16 * rollOff;                                              // (rolled off soft: out for balance)
      if (gd && gd.arms) { const m = ARM_MODE[gd.arms]; lat = m[0]; up = m[1]; fwd = m[2]; lat += 0.05 * wob(tt * 1.3, 31 + k * 4); up += 0.06 * wob(tt * 1.6, 33 + k * 3); }
    } else if (rail) {
      const bal = S.balance || 0;
      // out for balance, the front one a little higher (a boardslide's arms, B/ref/ "Frontside Boardslide")
      lat = 0.32 + 0.08 * Math.abs(bal) + 0.08 * hitK; up = (front ? -0.08 : -0.18) + s * bal * 0.15 + 0.06 * hitK; fwd = 0.06;
      lat += 0.1 * one1 - 0.14 * tog; up += 0.08 * one1; fwd += 0.1 * tog;
    } else {
      // riding: the front hand ahead over the front knee, the back one by the back hip; on the heels the arms reach
      // forward for balance; pushing, the arms swing
      lat = front ? 0.16 : 0.06; up = front ? -0.32 : -0.4; fwd = front ? 0.16 : 0.06;
      fwd += 0.18 * heel; up += 0.06 * heel;
      fwd += 0.08 * Math.max(0, toeK) * (front ? 1 : -0.5);
      // a hard toe side carve: the front hand reaches down towards the snow (B/ref/ "Carving (3416531800).jpg")
      const reach = front ? smoothstep(0.45, 0.9, toeK) * smoothstep(5, 10, speed) : 0; up -= 0.22 * reach; fwd += 0.2 * reach; lat += 0.05 * reach;
      lat += 0.06 * Math.abs(pr) + 0.12 * brake * (front ? 1 : 0.4); up += 0.06 * Math.abs(pr);
      if (S.loading) { fwd -= 0.12; up += 0.04; }
      fwd += 0.15 * lazy; up += 0.1 * lazy;
      const land = clamp(absorb * 2.2, 0, 1); fwd += 0.14 * land; lat += 0.06 * land;
      if (skate > 0.05) { const ph = Math.sin((S.skateT || t) * 2 * Math.PI); fwd += 0.12 * skate * ph * s * noseX; }
      if (front) { lat += BFP.lat * fpW; up += BFP.up * fpW; fwd += BFP.fwd * fpW; }
      // (2026-11-08) a hard landing: the hands down and forward; off to the side or out of a butter: out for balance
      fwd += 0.12 * hardL; up -= 0.08 * hardL; lat += 0.14 * unb + 0.16 * Math.abs(offL) + 0.08 * one1 - 0.1 * tog; up += 0.08 * unb + 0.1 * Math.abs(offL) + 0.06 * one1;
    }
    if (crashW > 0.5) {
      // (2026-11-08) a fall by its kind (P's S.fallKind): into something, the arms out in front to take it; on the head or
      // the back, flung up and out; otherwise out to the sides
      const fk = S.fallKind || '';
      if (fk === 'wall' || fk === 'tree' || fk === 'rail') { lat = 0.2; up = 0.05; fwd = 0.38; }
      else if (fk === 'head' || fk === 'back') { lat = 0.42; up = 0.32; fwd = -0.05; }
      else { lat = 0.36; up = 0.2; fwd = 0; }
    }
    const AN = ARMN[k], zArm = air ? 0.6 : 0.72;
    lat = sp(AN[0], lat, 10, zArm); up = sp(AN[1], up, 10, zArm); fwd = sp(AN[2], fwd, 10, zArm);
    const hm = (0.6 + 0.6 * railW + 1.4 * flow) * (1 - 0.7 * (Hs.w || 0)), ak = 11 + k * 4;
    lat += 0.03 * hm * wob(tt * (1.6 + railW), ak); up += 0.04 * hm * wob(tt * (1.9 + railW), ak + 2); fwd += 0.05 * hm * wob(tt * (1.4 + railW), ak + 6);
    if (crashW > 0.5) up += Math.sin(t * 9 + s) * 0.2;
    const ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
    ua.updateWorldMatrix(false, false);
    const sh = _sh.setFromMatrixPosition(ua.matrixWorld);
    const wr = _wr.copy(sh).addScaledVector(cL, s * lat).addScaledVector(ub, up).addScaledVector(cFl, fwd);
    // a hand drag (the lazy boy key on a board): the back hand trails in the snow beside the heel edge, behind the back foot
    const drag = !front && ground ? lazy : 0;
    if (drag > 0.01) wr.lerp(_v2.set(-fb * (halfWidth(-0.35) + 0.14), 0.04 - (S.sink || 0), -BOARD.stance / 2 - 0.05).applyQuaternion(R).add(BP), drag);
    { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.78 + 0.14 * drag, 0.93 + 0.065 * drag); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
    const fd = _fd.copy(cF).addScaledVector(ub, -0.35).normalize(), pa = _pa.copy(cL).multiplyScalar(-s);
    if (drag > 0.01) { fd.lerp(_v2.set(0, 0, -1).applyQuaternion(R), drag).normalize(); pa.lerp(_v6.copy(ub).negate(), drag).normalize(); }
    let curl = 0.6 - 0.3 * drag;
    if (Hs.w > 0.02) {
      const g = boardPoint(bd, Hs.cur[1], Hs.cur[2], fb, gp);
      if (Hs.prev && Hs.fx < 0.999) {
        const g0 = boardPoint(bd, Hs.prev[1], Hs.prev[2], fb, gp2), f = smooth01(Hs.fx);
        g.pt.lerpVectors(g0.pt, g.pt, f); g.fingers.lerpVectors(g0.fingers, g.fingers, f).normalize(); g.palm.lerpVectors(g0.palm, g.palm, f).normalize();
      }
      const gw = _v2.copy(g.pt).addScaledVector(g.fingers, -0.07).addScaledVector(g.palm, -0.03);
      wr.lerp(gw, Hs.w); fd.lerp(g.fingers, Hs.w).normalize(); pa.lerp(g.palm, Hs.w).normalize(); curl += (1.35 - curl) * Hs.w;
    }
    // (2026-11-08) on a T-bar the hand nearer the stem holds it, the palm towards it, the fingers round it
    if (tb && k === tbK && tbOn > 0.01) {
      const to = _v6.subVectors(tb.stem, sh); to.addScaledVector(ub, -to.dot(ub)); if (to.lengthSq() < 1e-6) to.copy(cFl); to.normalize();
      wr.lerp(_v2.copy(tb.stem).addScaledVector(to, -0.035), tbOn); pa.lerp(to, tbOn).normalize(); fd.lerp(_v2.crossVectors(ub, to).multiplyScalar(s), tbOn).normalize(); curl += (1.4 - curl) * tbOn;
    }
    { const d = wr.distanceTo(sh), m = softReach(d, armL, 0.84 + 0.02 * Hs.w, 0.965 + 0.02 * Hs.w); if (m < d) wr.sub(sh).multiplyScalar(m / d).add(sh); }
    const upK = smoothstep(-0.05, 0.2, up) * (1 - Hs.w);
    const el = _el.set(0, 0, -1).applyQuaternion(chQ).addScaledVector(cL, s * (0.25 + 0.35 * Hs.w)).addScaledVector(ub, -1.1).normalize();
    if (upK > 0.01) el.lerp(_v6.copy(cL).multiplyScalar(s).addScaledVector(cFl, 0.3).addScaledVector(ub, 0.15).normalize(), upK).normalize();
    rig.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, el, NZ);
    const HH = rig.hands[side];
    rig.aim(ha, rig.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, fd, pa);
    rig.curl(HH, curl);
  }
  rig.placeHead(hdQ);
  // (in the air the camera's own way: the body's turn, looking down at a grab)
  if (!air) firstPersonEyes(rig, R, S.vel || ZERO, speed, S.sw ? -1 : 1, FPV.board, 0.12);
  rig.flushTree(rig.body);
};
/* (2026-11-08, R's first person for every ride: rig.fpEye, rig.fpLook, set after placeHead) the eyes (placeHead's own,
   moved `fwd` m forward along the way they look, to keep the shoulders out of the lens), and the way they look when
   not looking round: where you go (or, slow, the way the ride points: dirZ along its +Z), tipped `down` (tan of the
   angle under the level of the snow: 0.72, about 36 degrees, for a board, so the nose and the front hand are in the
   lower third with the way ahead above them). Shared by the board and the sled. */
export function firstPersonEyes(rig, R, vel, speed, dirZ, down, fwd = 0) {
  const d = rig.fpDir || (rig.fpDir = new THREE.Vector3());
  const up = _v1.set(0, 1, 0).applyQuaternion(R);
  d.set(0, 0, dirZ).applyQuaternion(R);
  if (speed > 0.8) { _v2.copy(vel).multiplyScalar(1 / speed); d.lerp(_v2, smoothstep(0.8, 2.5, speed)); }
  d.addScaledVector(up, -d.dot(up)); if (d.lengthSq() < 1e-6) d.set(0, 0, dirZ).applyQuaternion(R);
  d.normalize().addScaledVector(up, -down).normalize();
  rig.fpLook = d;
  (rig.fpEye || (rig.fpEye = new THREE.Vector3())).copy(rig.eye).addScaledVector(d, fwd);
}

// which binding a leg is in: the front one (0) is the left leg for regular, the right for goofy
const legBinding = (k, noseX) => ((k === 0) === (noseX > 0)) ? 0 : 1;
const rigLegThigh = (rig, k) => k ? rig.b.thR : rig.b.thL;
// each binding's ankle point and the boot's toe direction, in the world, from where the board is now
function bindingAnkles(rig, bd, fb) {
  const bq = bd.root.quaternion, bp = bd.root.position, s2 = BOARD.stance / 2;
  bd.yawF = Math.atan2(fb * Math.cos(BOARD.angF), Math.sin(BOARD.angF));
  bd.yawB = Math.atan2(fb * Math.cos(BOARD.angB), Math.sin(BOARD.angB));
  for (let j = 0; j < 2; j++) {
    const yaw = j ? bd.yawB : bd.yawF, zc = j ? -s2 : s2, sx = Math.sin(yaw), cz = Math.cos(yaw);
    _toe[j].set(sx, 0, cz).applyQuaternion(bq);
    _ank[j].set(-sx * BOARD.ankleBack, BOARD.top + BOARD.ankleUp + rig.ankleH, zc - cz * BOARD.ankleBack).applyQuaternion(bq).add(bp);
  }
}
// the boots: in their bindings on the board; the back one on the back foot when it is out (pushing, on the lift)
function placeBoots(rig, bd, skate, t, S) {
  const bq = bd.root.quaternion, bp = bd.root.position, s2 = BOARD.stance / 2;
  bd.bootF.position.set(0, BOARD.top, s2).applyQuaternion(bq).add(bp);
  bd.bootF.quaternion.copy(bq).multiply(_q1.setFromAxisAngle(Y, bd.yawF));
  if (bd.backOut) {
    // on the back foot: the boot's sole under the ankle bone
    const ft = bd.backFoot; ft.updateWorldMatrix(false, false);
    const fq = _q2; ft.matrixWorld.decompose(_v1, fq, _v2);
    bd.bootB.quaternion.copy(fq).multiply(bd.backFootRest);
    bd.bootB.position.copy(_v1).addScaledVector(_v3.set(0, 1, 0).applyQuaternion(bd.bootB.quaternion), -(rig.ankleH + 0.02)).addScaledVector(_v4.set(0, 0, 1).applyQuaternion(bd.bootB.quaternion), BOARD.ankleBack);
  } else {
    bd.bootB.position.set(0, BOARD.top, -s2).applyQuaternion(bq).add(bp);
    bd.bootB.quaternion.copy(bq).multiply(_q1.setFromAxisAngle(Y, bd.yawB));
  }
}

// ---- on the chairlift: sitting facing the chair's way, the board hanging off the front foot ---------------------------
function poseLift(rig, S, dt, sp, R, Rr, noseX, fb, t) {
  const bd = rig.bd, kf = noseX > 0 ? 0 : 1;
  seatRider(rig, S, t, kf);
  const fw = _v1.set(0, 0, 1).applyQuaternion(R), up = _ub.set(0, 1, 0).applyQuaternion(R), lf = _cL.set(1, 0, 0).applyQuaternion(R);
  // the board hangs from the front ankle: its nose forward and down, its top towards the rider
  const ca2 = 60 * D, zb = _v5.copy(fw).multiplyScalar(Math.cos(ca2)).addScaledVector(up, -Math.sin(ca2)).addScaledVector(lf, 0.15 * noseX).normalize();
  const yb = _v6.copy(fw).multiplyScalar(-Math.sin(ca2)).addScaledVector(up, -Math.cos(ca2));
  yb.addScaledVector(zb, -yb.dot(zb)).normalize();
  const xb = _v4.crossVectors(yb, zb).normalize();
  bd.root.quaternion.setFromRotationMatrix(_m4.makeBasis(xb, yb, zb));
  // the front binding's ankle point on the front ankle
  bd.yawF = Math.atan2(fb * Math.cos(BOARD.angF), Math.sin(BOARD.angF)); bd.yawB = Math.atan2(fb * Math.cos(BOARD.angB), Math.sin(BOARD.angB));
  const sx = Math.sin(bd.yawF), cz = Math.cos(bd.yawF);
  const local = _v1.set(-sx * BOARD.ankleBack, BOARD.top + BOARD.ankleUp + rig.ankleH, BOARD.stance / 2 - cz * BOARD.ankleBack).applyQuaternion(bd.root.quaternion);
  bd.root.position.copy(_gpt).sub(local);
  bd.backOut = true; bd.backFoot = kf ? rig.b.ftL : rig.b.ftR;
  if (!bd.backFootRest) bd.backFootRest = new THREE.Quaternion();
  bd.backFootRest.copy(rig.rest[kf ? 'ftL' : 'ftR'].q).invert();
  placeBoots(rig, bd, 0, t, S);
  bd.backOut = false;
  bd.bend.value = 0;
}
/* sitting on a chair of the lift (S.p the seat under the hips, S.q the chair's way): thighs along the seat, shins
   hanging, hands on the thighs, looking about; footOut (0 left, 1 right, -1 none) is a foot turned out, carrying a
   board. Shared by every ride but skis (the scooter, snowbike and sled hold theirs in front). The front foot's ankle is
   left in _gpt. */
export function seatRider(rig, S, t, footOut = -1) {
  const b = rig.b, BP = rig.body.position, R = rig.body.quaternion;
  const pelQ = _pelQ.copy(R).multiply(_q1.setFromAxisAngle(X, -0.05));
  const pelW = _v2.set(0, rig.pelvisY - rig.hipY + 0.1, -0.02).applyQuaternion(R).add(BP);
  rig.setWorldQ(b.root, _q2.copy(pelQ).multiply(rig.rest.root.q));
  b.pelvis.updateWorldMatrix(false, false);
  const off = _v4.setFromMatrixPosition(b.pelvis.matrixWorld).sub(_v5.setFromMatrixPosition(b.root.matrixWorld));
  rig.setWorldPos(b.root, _v6.copy(pelW).sub(off));
  const tt = t + rig.ph;
  const chQ = _chQ.copy(R).multiply(_q1.setFromAxisAngle(Y, 0.1 * wob(tt * 0.3, 2))).multiply(_q1.setFromAxisAngle(X, 0.05));
  rig.blendBone(b.pelvis, 'pelvis', pelQ, chQ, 0);
  rig.blendBone(b.spine, 'spine', pelQ, chQ, 0.35); rig.blendBone(b.spine1, 'spine1', pelQ, chQ, 0.7); rig.blendBone(b.chest, 'chest', pelQ, chQ, 1);
  const hdQ = _hdQ.copy(chQ).multiply(_q1.setFromAxisAngle(Y, 0.5 * wob(tt * 0.25, 7))).multiply(_q1.setFromAxisAngle(X, 0.05));
  rig.blendBone(b.neck, 'neck', chQ, hdQ, 0.5); rig.blendBone(b.head, 'head', hdQ, hdQ, 0);
  rig.blendBone(b.clL, 'clL', chQ, chQ, 0); rig.blendBone(b.clR, 'clR', chQ, chQ, 0);
  const fw = _v1.set(0, 0, 1).applyQuaternion(R), up = _ub.set(0, 1, 0).applyQuaternion(R), lf = _cL.set(1, 0, 0).applyQuaternion(R);
  // legs: thighs along the seat, shins hanging; a foot turned out carries a board
  const kf = footOut;
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, th = k ? b.thR : b.thL, ca = k ? b.caR : b.caL, ft = k ? b.ftR : b.ftL;
    th.updateWorldMatrix(false, false);
    const hip = _hip.setFromMatrixPosition(th.matrixWorld);
    const sway = 0.05 * Math.sin(tt * 1.3 + k * 1.7);
    const an = _v3.copy(hip).addScaledVector(fw, rig.len.th * 0.95 + 0.08 + sway).addScaledVector(up, -rig.len.ca * 0.95).addScaledVector(lf, s * 0.06);
    rig.twoBone(th, ca, k ? 'thR' : 'thL', k ? 'caR' : 'caL', an, _v4.copy(fw).addScaledVector(up, 0.3), Z);
    // the foot: pointing forward and down, the front one turned out with the board on it
    const out = k === kf ? s * 0.9 : s * 0.15;
    rig.setWorldQ(ft, _q3.copy(R).multiply(_q1.setFromAxisAngle(Y, out)).multiply(_q2.setFromAxisAngle(X, 0.35)).multiply(rig.rest[k ? 'ftR' : 'ftL'].q));
    if (k === kf || (kf < 0 && k === 0)) { ca.updateWorldMatrix(false, false); ft.updateWorldMatrix(false, false); _gpt.setFromMatrixPosition(ft.matrixWorld); }
  }
  // hands resting on the thighs
  for (let k = 0; k < 2; k++) {
    const s = k ? -1 : 1, ua = k ? b.uaR : b.uaL, fa = k ? b.faR : b.faL, ha = k ? b.haR : b.haL;
    ua.updateWorldMatrix(false, false);
    const sh = _sh.setFromMatrixPosition(ua.matrixWorld);
    const wr = _wr.copy(sh).addScaledVector(fw, 0.32).addScaledVector(up, -0.42).addScaledVector(lf, s * 0.02);
    rig.twoBone(ua, fa, k ? 'uaR' : 'uaL', k ? 'faR' : 'faL', wr, _el.copy(fw).negate().addScaledVector(lf, s * 0.4).addScaledVector(up, -0.5).normalize(), NZ);
    const HH = rig.hands[k ? 'R' : 'L'];
    rig.aim(ha, rig.rest[k ? 'haR' : 'haL'].q, HH.fd, HH.palm, _fd.copy(fw), _pa.copy(up).negate());
    rig.curl(HH, 0.5);
  }
  rig.placeHead(hdQ);
  rig.flushTree(rig.body);
}
/* the vehicle (a scooter, snowbike or sled: its root group, its middle about its origin, half its length half) held
   hanging nose down in front of the shins on the lift, its back end at the knees */
export function holdOnLift(rig, root, half) {
  const R = rig.body.quaternion;
  root.quaternion.copy(R).multiply(_q1.setFromAxisAngle(X, 1.25));
  root.position.copy(_gpt).addScaledVector(_v1.set(0, 0, 1).applyQuaternion(R), 0.2).addScaledVector(_v2.set(1, 0, 0).applyQuaternion(R), -0.2).addScaledVector(_v3.set(0, 1, 0).applyQuaternion(R), 0.3)
    .addScaledVector(_v4.set(0, 0, 1).applyQuaternion(root.quaternion), half);
}
