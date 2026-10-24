/* ---------------------------------------------------------------------------
   Leoncraft 2 - pistons and sticky pistons (Minecraft Wiki, Piston; Java
   Edition).

   A piston is powered from any side but its front, and also by whatever
   would power the block above it ("quasi-connectivity"). When its power
   changes it asks to move, and moves at the end of the tick, after the
   scheduled and random ticks (the game's block events):

     pushing    the line of blocks in front, up to 12, goes one block on.
                Slime and honey blocks carry the blocks touching them (not
                each other, and never glazed terracotta); a block that
                cannot be moved (obsidian, bedrock, an extended piston, a
                chest or anything else holding things) stops it all; a
                plant, torch, dust or door in the way breaks and drops.
                The base is extended at once; the blocks and the head take
                2 ticks to slide into place, pushing the player and mobs
                with them (a slime block launches them at a block a tick).
     pulling    a sticky piston brings the block in front of its head back
                with it (and what is stuck to that); one that only got a
                short pulse lets go instead and leaves the block behind.

   Blocks in motion are "moving_piston" in the world until they land; they
   are drawn here as meshes sliding between the two cells.
--------------------------------------------------------------------------- */
import { B, BLOCKS, FLUID } from '../blocks.js?v=107';
import { H } from '../world-const.js?v=107';
import { F6, FACE6, COND, WEAK } from './redstone.js?v=107';
import { blockGeometry } from '../render/blockmesh.js?v=107';
import { containerKind } from '../containers.js?v=107';
const THREE = window.THREE;

const LIMIT = 12;
export const NORMAL = 0, DESTROY = 1, BLOCK = 2, PUSH_ONLY = 3;
export const REACT = new Uint8Array(4096);
const IMMOVABLE = new Set(['obsidian', 'crying_obsidian', 'respawn_anchor', 'reinforced_deepslate', 'barrier', 'beacon', 'bedrock', 'command_block',
  'chain_command_block', 'repeating_command_block', 'creaking_heart', 'enchanting_table', 'end_gateway', 'end_portal', 'end_portal_frame', 'ender_chest',
  'grindstone', 'jigsaw', 'jukebox', 'light', 'lodestone', 'spawner', 'moving_piston', 'nether_portal', 'piston_head', 'structure_block',
  'sculk_sensor', 'calibrated_sculk_sensor', 'sculk_catalyst', 'sculk_shrieker', 'trial_spawner', 'vault', 'conduit', 'lc2_wet_conduit', 'lectern', 'daylight_detector',
  'chiseled_bookshelf', 'crafter', 'beehive', 'bee_nest', 'brewing_stand', 'potent_sulfur']);
const BREAKS = new Set(['pumpkin', 'carved_pumpkin', 'jack_o_lantern', 'melon', 'cobweb', 'fire', 'soul_fire', 'dragon_egg', 'bell', 'scaffolding',
  'turtle_egg', 'sniffer_egg', 'frogspawn', 'sea_pickle', 'cocoa', 'chorus_plant', 'chorus_flower', 'pointed_dripstone', 'small_amethyst_bud',
  'medium_amethyst_bud', 'large_amethyst_bud', 'amethyst_cluster', 'decorated_pot', 'repeater', 'comparator', 'tripwire', 'tripwire_hook',
  'campfire', 'soul_campfire', 'moss_carpet', 'pale_moss_carpet', 'glow_lichen', 'sculk_vein', 'structure_void', 'big_dripleaf', 'big_dripleaf_stem',
  'small_dripleaf', 'hanging_roots', 'spore_blossom', 'sugar_cane', 'bamboo', 'bamboo_sapling', 'kelp', 'kelp_plant', 'cactus', 'cactus_flower',
  'lily_pad', 'azalea', 'flowering_azalea', 'mangrove_propagule', 'snow', 'redstone_wire', 'lever', 'cake', 'resin_clump', 'pale_hanging_moss',
  'leaf_litter', 'pink_petals', 'wildflowers', 'firefly_bush', 'bush', 'nether_wart', 'sweet_berry_bush', 'cave_vines', 'cave_vines_plant',
  'twisting_vines', 'twisting_vines_plant', 'weeping_vines', 'weeping_vines_plant', 'vine', 'end_rod_x']);
const BREAK_SHAPES = new Set(['cross', 'fire', 'crop', 'torch', 'wall_torch', 'button', 'plate', 'wire', 'ladder', 'door', 'bed', 'head', 'sign', 'wall_sign',
  'hanging_sign', 'candle', 'lantern', 'pot', 'cake', 'snow', 'vine', 'pad', 'fluid', 'layer']);
for (const d of BLOCKS) {
  if (!d) continue;
  const n = d.name;
  if (d.fluid || BREAKS.has(n) || BREAK_SHAPES.has(d.shape) || /shulker_box$|_banner$|candle_cake$|_carpet_x$/.test(n)) REACT[d.id] = DESTROY;
  else if (IMMOVABLE.has(n) || d.hardness < 0 || containerKind(d.id)) REACT[d.id] = BLOCK;
  else if (/glazed_terracotta$/.test(n)) REACT[d.id] = PUSH_ONLY;
  if (n === 'piston_head' || n === 'moving_piston') REACT[d.id] = BLOCK;
}
const SLIME = B.slime_block, HONEY = B.honey_block;
const sticky = b => b === SLIME || b === HONEY;
const canStick = (a, b) => !((a === HONEY && b === SLIME) || (a === SLIME && b === HONEY)) && (sticky(a) || sticky(b));

export function installPistons(sim) {
  const rs = sim.redstone, S = sim, w = sim.w;
  const P = B.piston, SP = B.sticky_piston, HEAD = B.piston_head, MOV = B.moving_piston;
  if (P === undefined || MOV === undefined) return;
  const isPiston = b => b === P || b === SP;
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const moving = rs.moving = new Map();      // "x,y,z" -> { x, y, z, b, m, facing, ext, src, p, po }

  /* ---- what may move ---- */
  // the game's isPushable: b at (x, y, z) moved along face mv, by a piston facing face pf
  const pushable = (b, m, x, y, z, mv, allowDestroy, pf) => {
    if (y < 0 || y >= H) return false;
    if (!b) return true;
    if (mv === 3 && y === 0) return false;
    if (mv === 2 && y === H - 1) return false;
    if (isPiston(b)) return !(m & 8);
    const r = REACT[b];
    if (r === BLOCK) return false;
    if (r === DESTROY) return allowDestroy;
    if (r === PUSH_ONLY) return mv === pf;
    return true;
  };
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  /* ---- which blocks a move takes (the game's PistonStructureResolver) ---- */
  function resolve(px, py, pz, facing, extending) {
    const ff = FACE6[facing], fv = F6[ff];
    const mv = extending ? ff : ff ^ 1, mvv = F6[mv], back = F6[mv ^ 1];
    const piston = [px, py, pz];
    const start = extending ? [px + fv[0], py + fv[1], pz + fv[2]] : [px + 2 * fv[0], py + 2 * fv[1], pz + 2 * fv[2]];
    const toPush = [], toDestroy = [];
    const has = p => toPush.some(q => same(p, q));
    const idxOf = p => toPush.findIndex(q => same(p, q));
    const get = p => w.get(p[0], p[1], p[2]), meta = p => w.meta(p[0], p[1], p[2]);
    const addLine = (from, dir) => {
      let b = get(from);
      if (!b) return true;
      if (!pushable(b, meta(from), from[0], from[1], from[2], mv, false, dir)) return true;
      if (same(from, piston)) return true;
      if (has(from)) return true;
      let i = 1;
      if (i + toPush.length > LIMIT) return false;
      // what is stuck on behind it comes too
      while (sticky(b)) {
        const bp = [from[0] + back[0] * i, from[1] + back[1] * i, from[2] + back[2] * i];
        const b1 = b;
        b = get(bp);
        if (!b || !canStick(b1, b) || !pushable(b, meta(bp), bp[0], bp[1], bp[2], mv, false, mv ^ 1) || same(bp, piston)) break;
        i++;
        if (i + toPush.length > LIMIT) return false;
      }
      let l = 0;
      for (let j = i - 1; j >= 0; j--) { toPush.push([from[0] + back[0] * j, from[1] + back[1] * j, from[2] + back[2] * j]); l++; }
      // and the line ahead of it
      for (let i1 = 1; ; i1++) {
        const bp1 = [from[0] + mvv[0] * i1, from[1] + mvv[1] * i1, from[2] + mvv[2] * i1];
        const k = idxOf(bp1);
        if (k > -1) {
          reorder(l, k);
          for (let l1 = 0; l1 <= k + l; l1++) { const q = toPush[l1]; if (sticky(get(q)) && !branch(q)) return false; }
          return true;
        }
        b = get(bp1);
        if (!b) return true;
        if (!pushable(b, meta(bp1), bp1[0], bp1[1], bp1[2], mv, true, mv) || same(bp1, piston)) return false;
        if (REACT[b] === DESTROY) { toDestroy.push(bp1); return true; }
        if (toPush.length >= LIMIT) return false;
        toPush.push(bp1); l++;
      }
    };
    const reorder = (i, j) => {
      const a = toPush.slice(0, j), b = toPush.slice(toPush.length - i), c = toPush.slice(j, toPush.length - i);
      toPush.length = 0; toPush.push(...a, ...b, ...c);
    };
    const branch = from => {
      const b = get(from);
      for (let d = 0; d < 6; d++) {
        if ((d >> 1) === (mv >> 1)) continue;
        const v = F6[d], bp = [from[0] + v[0], from[1] + v[1], from[2] + v[2]];
        if (canStick(get(bp), b) && !addLine(bp, d)) return false;
      }
      return true;
    };
    const b0 = get(start);
    if (!pushable(b0, meta(start), start[0], start[1], start[2], mv, false, ff)) {
      if (extending && REACT[b0] === DESTROY) { toDestroy.push(start); return { toPush, toDestroy }; }
      return null;
    }
    if (!addLine(start, mv)) return null;
    for (let i = 0; i < toPush.length; i++) if (sticky(get(toPush[i])) && !branch(toPush[i])) return null;
    return { toPush, toDestroy };
  }
  rs.resolvePiston = resolve;

  /* ---- moving them ---- */
  function moveBlocks(px, py, pz, facing, extending, stickyP) {
    const ff = FACE6[facing], fv = F6[ff];
    const head = [px + fv[0], py + fv[1], pz + fv[2]];
    if (!extending && w.get(head[0], head[1], head[2]) === HEAD) S.silentSet(head[0], head[1], head[2], 0, 0);
    const r = resolve(px, py, pz, facing, extending);
    if (!r) return false;
    const { toPush, toDestroy } = r;
    const mv = extending ? ff : ff ^ 1, mvv = F6[mv];
    const left = new Map();
    const states = toPush.map(p => [w.get(p[0], p[1], p[2]), w.meta(p[0], p[1], p[2])]);
    toPush.forEach((p, i) => left.set(key(p[0], p[1], p[2]), [p[0], p[1], p[2], states[i][0]]));
    // what breaks drops, and is gone
    for (let k = toDestroy.length - 1; k >= 0; k--) {
      const [x, y, z] = toDestroy[k], b = w.get(x, y, z);
      if (!FLUID[b]) S.dropLoot(x, y, z, b, w.meta(x, y, z), 1);
      if (S.renderer && S.renderer.particles && !FLUID[b] && b !== B.fire) S.renderer.particles.blockBreak(x, y, z, b, null);
      S.silentSet(x, y, z, 0, 0);
    }
    // each block a cell on, as a block in motion
    for (let l = toPush.length - 1; l >= 0; l--) {
      const p = toPush[l], d = [p[0] + mvv[0], p[1] + mvv[1], p[2] + mvv[2]];
      left.delete(key(d[0], d[1], d[2]));
      S.silentSet(d[0], d[1], d[2], MOV, facing);
      start(d[0], d[1], d[2], states[l][0], states[l][1], facing, extending, false);
    }
    if (extending) {
      left.delete(key(head[0], head[1], head[2]));
      S.silentSet(head[0], head[1], head[2], MOV, facing);
      start(head[0], head[1], head[2], HEAD, facing | (stickyP ? 8 : 0), facing, true, true);
    }
    // the cells left behind are air; then the neighbours hear of it all
    for (const [, [x, y, z]] of left) S.silentSet(x, y, z, 0, 0);
    for (const [, [x, y, z]] of left) rs.shapes(x, y, z);
    for (let k = toDestroy.length - 1; k >= 0; k--) { const [x, y, z] = toDestroy[k]; rs.shapes(x, y, z); rs.around(x, y, z); }
    for (let j = toPush.length - 1; j >= 0; j--) { const [x, y, z] = toPush[j]; rs.around(x, y, z); }
    if (extending) rs.around(head[0], head[1], head[2]);
    if (S.fluids) for (const [, [x, y, z]] of left) S.fluids.around(x, y, z);
    rs.go();
    return true;
  }
  function start(x, y, z, b, m, facing, ext, src) {
    const e = { x, y, z, b, m, facing, ext, src, p: 0, po: 0, born: S.n };
    moving.set(key(x, y, z), e);
    view.add(e);
    return e;
  }
  // a block in motion lands: it is the block again, and it and its neighbours hear of it
  function finish(e) {
    const k = key(e.x, e.y, e.z);
    if (moving.get(k) !== e) return;
    moving.delete(k);
    view.done(e);
    if (w.get(e.x, e.y, e.z) !== MOV) return;
    let b = e.b, m = e.m;
    if (e.src && !e.ext) { b = e.b; m = e.m & 7; }
    S.set(e.x, e.y, e.z, b, m);
    rs.update(e.x, e.y, e.z, e.x, e.y, e.z, 1);
    rs.go();
  }
  rs.finishMoving = () => { for (const e of [...moving.values()]) finish(e); };

  /* ---- power ---- */
  const powered = (x, y, z, facing) => {
    const ff = FACE6[facing];
    for (let f = 0; f < 6; f++) if (f !== ff && rs.signalFrom(x, y, z, f) > 0) return true;
    // what would power the block above it powers it too
    for (let f = 0; f < 6; f++) if (f !== 3 && rs.signalFrom(x, y + 1, z, f) > 0) return true;
    return false;
  };
  rs.pistonPowered = (x, y, z) => powered(x, y, z, w.meta(x, y, z) & 7);
  const check = (s, x, y, z, m) => {
    const b = w.get(x, y, z), facing = Math.min(5, m & 7), ext = !!(m & 8);
    const p = powered(x, y, z, facing);
    if (p && !ext) { if (resolve(x, y, z, facing, true)) s.blockEvent(x, y, z, b, 0, facing); }
    else if (!p && ext) {
      const fv = F6[FACE6[facing]], tx = x + 2 * fv[0], ty = y + 2 * fv[1], tz = z + 2 * fv[2];
      let id = 1;
      if (w.get(tx, ty, tz) === MOV) {
        const e = moving.get(key(tx, ty, tz));
        if (e && e.facing === facing && e.ext && (e.p < 0.5 || e.ticked === s.n)) id = 2;
      }
      s.blockEvent(x, y, z, b, id, facing);
    }
  };
  for (const id of [P, SP]) {
    if (id === undefined) continue;
    const isSticky = id === SP;
    sim.on(id, {
      neighbor(s, x, y, z, m, fx, fy, fz, kind) { if (kind !== 2) check(s, x, y, z, m); },
      onPlace(s, x, y, z, m) { check(s, x, y, z, m); },
      event(s, x, y, z, m, id2) {
        const facing = Math.min(5, m & 7), ff = FACE6[facing], fv = F6[ff];
        const p = powered(x, y, z, facing);
        if (p && (id2 === 1 || id2 === 2)) { rs.setState(x, y, z, id, m | 8); rs.go(); return; }
        if (!p && id2 === 0) return;
        if (id2 === 0) {
          if (!moveBlocks(x, y, z, facing, true, isSticky)) return;
          s.set(x, y, z, id, m | 8);
          if (s.onPiston) s.onPiston(x, y, z, true);
          return;
        }
        // pulling back: an extension still under way lands first
        const hx = x + fv[0], hy = y + fv[1], hz = z + fv[2];
        const he = moving.get(key(hx, hy, hz));
        if (he) finish(he);
        // the base slides back as a block in motion itself
        s.silentSet(x, y, z, MOV, facing);
        start(x, y, z, id, facing, facing, false, true);
        rs.around(x, y, z); rs.shapes(x, y, z);
        if (isSticky) {
          const tx = x + 2 * fv[0], ty = y + 2 * fv[1], tz = z + 2 * fv[2], b2 = w.get(tx, ty, tz), m2 = w.meta(tx, ty, tz);
          let snapped = false;
          if (b2 === MOV) { const e2 = moving.get(key(tx, ty, tz)); if (e2 && e2.facing === facing && e2.ext) { finish(e2); snapped = true; } }
          if (!snapped) {
            const b3 = w.get(tx, ty, tz), m3 = w.meta(tx, ty, tz);
            if (id2 !== 1 || !b3 || !pushable(b3, m3, tx, ty, tz, ff ^ 1, false, ff) || (REACT[b3] !== NORMAL && !isPiston(b3))) s.set(hx, hy, hz, 0, 0);
            else moveBlocks(x, y, z, facing, false, true);
          }
        } else s.set(hx, hy, hz, 0, 0);
        rs.go();
        if (s.onPiston) s.onPiston(x, y, z, false);
      },
    });
  }
  if (HEAD !== undefined) sim.on(HEAD, {
    // the head goes when its base does
    neighbor(s, x, y, z, m) {
      const fv = F6[FACE6[Math.min(5, m & 7)]], bx = x - fv[0], by = y - fv[1], bz = z - fv[2], b = w.get(bx, by, bz);
      const fits = (isPiston(b) && (w.meta(bx, by, bz) & 8) && (w.meta(bx, by, bz) & 7) === (m & 7)) || b === MOV;
      if (!fits) s.set(x, y, z, 0, 0);
    },
    // broken by the player: the base breaks too (and drops, out of creative)
    broken(s, x, y, z, m) {
      const fv = F6[FACE6[Math.min(5, m & 7)]], bx = x - fv[0], by = y - fv[1], bz = z - fv[2], b = w.get(bx, by, bz);
      if (isPiston(b) && (w.meta(bx, by, bz) & 8)) { if (s.creative) s.set(bx, by, bz, 0, 0); else s.destroy(bx, by, bz); }
    },
  });

  /* ---- each tick: blocks in motion move on half a block, pushing what is in the way ---- */
  rs.tickers.push(() => {
    if (!moving.size) return;
    for (const e of [...moving.values()]) {
      e.po = e.p; e.ticked = S.n;
      if (e.po >= 1) { finish(e); continue; }
      const np = Math.min(1, e.p + 0.5);
      pushEntities(e, e.p, np);
      e.p = np;
    }
  });
  // what a moving block's box sweeps over this tick moves the same way (slime throws it at a block a tick)
  function pushEntities(e, p0, p1) {
    const d = BLOCKS[e.b];
    if (!d || (!d.solid && e.b !== HEAD)) return;
    const ff = FACE6[e.facing], mv = e.ext ? ff : ff ^ 1, v = F6[mv];
    const at = t => [e.x - v[0] * (1 - t), e.y - v[1] * (1 - t), e.z - v[2] * (1 - t)];
    const [ax, ay, az] = at(p1);
    const box = [ax, ay, az, ax + 1, ay + 1, az + 1];
    const step = p1 - p0;
    const hit = (b) => b[0] < box[3] && b[3] > box[0] && b[1] < box[4] && b[4] > box[1] && b[2] < box[5] && b[5] > box[2];
    // how far the box has to go along v to clear the moving block
    const overlap = b => Math.min(step, v[0] > 0 ? box[3] - b[0] : v[0] < 0 ? b[3] - box[0] : v[1] > 0 ? box[4] - b[1] : v[1] < 0 ? b[4] - box[1] : v[2] > 0 ? box[5] - b[2] : b[5] - box[2]);
    const slime = e.b === SLIME;
    const Pl = S.player;
    if (Pl && !(S.game && S.game.survival && S.game.survival.dead)) {
      const h = Pl.h || 1.8, pb = [Pl.pos.x - 0.3, Pl.pos.y, Pl.pos.z - 0.3, Pl.pos.x + 0.3, Pl.pos.y + h, Pl.pos.z + 0.3];
      if (hit(pb)) {
        const a = overlap(pb);
        if (a > 0) {
          if (slime) { if (v[0]) Pl.vel.x = v[0]; if (v[1]) Pl.vel.y = v[1]; if (v[2]) Pl.vel.z = v[2]; }
          const dd = a + 0.01;
          if (Pl.move) Pl.move(v[0] * dd, v[1] * dd, v[2] * dd); else { Pl.pos.x += v[0] * dd; Pl.pos.y += v[1] * dd; Pl.pos.z += v[2] * dd; }
          if (v[1] > 0) { Pl.fallDistance = 0; }
        }
      }
    }
    const E = S.game && S.game.entities;
    if (E && E.list) for (const m of E.list) {
      if (m.removed || m.vehicle) continue;
      const hw = m.hw !== undefined ? m.hw : 0.3, h = m.h || 1;
      const mb = [m.pos.x - hw, m.pos.y, m.pos.z - hw, m.pos.x + hw, m.pos.y + h, m.pos.z + hw];
      if (!hit(mb)) continue;
      const a = overlap(mb);
      if (a <= 0) continue;
      if (slime && m.vel) { if (v[0]) m.vel.x = v[0]; if (v[1]) m.vel.y = v[1]; if (v[2]) m.vel.z = v[2]; }
      const dd = a + 0.01;
      if (E.t && E.t.move) E.t.move(m, v[0] * dd, v[1] * dd, v[2] * dd); else { m.pos.x += v[0] * dd; m.pos.y += v[1] * dd; m.pos.z += v[2] * dd; }
    }
  }

  /* ---- drawing the blocks in motion ---- */
  const view = {
    list: new Set(),
    geo: new Map(),
    group: null,
    add(e) {
      const r = S.renderer;
      if (!r || !r.scene || !r.mats || !S.bodies) return;
      if (!this.group) { this.group = new THREE.Group(); r.scene.add(this.group); this.frame(); }
      const parts = [];
      const mk = (b, m) => {
        let g = this.geo.get(b * 256 + m);
        if (!g) { try { g = blockGeometry(BLOCKS[b], m); } catch (err) { return null; } this.geo.set(b * 256 + m, g); }
        // (the world's block material, lit by the light where the block starts: sim/bodies.js)
        const mesh = S.bodies.litMesh(r, g, e.x + 0.5, e.y + 0.5, e.z + 0.5);
        mesh.frustumCulled = false;
        const o = new THREE.Group(); o.add(mesh); mesh.position.set(0, -0.5, 0);
        this.group.add(o);
        return o;
      };
      if (e.src && !e.ext) {
        // the base, extended, stays put while the head slides back into it
        const base = mk(e.b, (e.m & 7) | 8); if (base) { base.position.set(e.x + 0.5, e.y, e.z + 0.5); parts.push({ o: base, still: true }); }
        const head = mk(HEAD, (e.m & 7) | (e.b === SP ? 8 : 0)); if (head) parts.push({ o: head, still: false, off: 1 });
      } else { const o = mk(e.b, e.m); if (o) parts.push({ o, still: false, off: 0 }); }
      e.view = parts;
      this.list.add(e);
    },
    done(e) {
      if (!e.view) return;
      // kept a moment, until the chunk is drawn again with the block in place
      e.doneAt = performance.now();
    },
    drop(e) { for (const p of e.view || []) { if (p.o.parent) p.o.parent.remove(p.o); for (const c of p.o.children) if (c.geometry) c.geometry.dispose(); } e.view = null; this.list.delete(e); },
    frame() {
      const loop = () => {
        if (this.dead) return;
        const now = performance.now();
        const alpha = Math.min(1, (now - (S.bodies ? S.bodies.lastTick : now)) / 50);
        for (const e of this.list) {
          if (e.doneAt && now - e.doneAt > 160) { this.drop(e); continue; }
          if (!e.view) continue;
          const ff = FACE6[e.facing], fv = F6[ff];
          const t = e.doneAt ? 1 : Math.min(1, e.po + (e.p - e.po) * alpha);
          for (const part of e.view) {
            if (part.still) continue;
            // extending: from a cell back to its own; pulled: from a cell ahead; the retracting head from its old place to the base
            const k = e.src && !e.ext ? 1 - t : e.ext ? t - 1 : 1 - t;
            part.o.position.set(e.x + 0.5 + fv[0] * k, e.y + fv[1] * k, e.z + 0.5 + fv[2] * k);
            if (e.src && !e.ext && t >= 1) part.o.visible = false;
          }
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
  };
  // (on a server, another player's pistons are drawn moving with this: net/events.js)
  rs.pistonView = view;
  rs.disposers = rs.disposers || [];
  rs.disposers.push(() => { view.dead = true; for (const e of [...view.list]) view.drop(e); if (view.group && view.group.parent) view.group.parent.remove(view.group); });

  /* ---- kept with the world ---- */
  rs.saveMoving = () => [...moving.values()].map(e => [e.x, e.y, e.z, e.b, e.m, e.facing, e.ext ? 1 : 0, e.src ? 1 : 0, e.p]);
  rs.loadMoving = list => {
    for (const [x, y, z, b, m, facing, ext, src, p] of list || []) {
      const e = { x, y, z, b, m, facing, ext: !!ext, src: !!src, p, po: p, born: 0 };
      moving.set(key(x, y, z), e);
    }
  };
}
