/* ---------------------------------------------------------------------------
   Leoncraft 2 - creaking hearts at work (the game's CreakingHeartBlock, from
   the Minecraft Wiki), ticked with the spawners (struct/spawners.js).

   A heart is awake when a pale oak log lies on either side of it along its
   own axis and it is night (day time 12600 to 23400); by day it is dormant,
   and with its logs gone, uprooted. Awake, a heart without a creaking of its
   own brings one out a second after it can, somewhere in the 33 x 17 x 33
   box round it: on a solid block that is not leaves, with three free blocks
   above and no water or lava. Its creaking is bound to it:
     - nothing hurts it while its heart stands; a hit instead makes the heart
       grow one to three resin clumps on the pale oak logs round it (at most
       once in 5 seconds), and an orange trail runs from the heart to it
     - breaking the heart kills it at once (the kill is the player's)
     - it goes at daybreak (unless named) and when it strays more than 34
       blocks from its heart, and the heart brings out another when it can
   Not in Peaceful, the Nether or the End. Broken without Silk Touch a heart
   gives 1 to 3 resin clumps (loot.js), and a natural one (meta 3 and up:
   placed by the trees, gen/trees.js) 20 to 24 experience.
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=107';
import { BIO } from '../biomes.js?v=107';
import { CH } from '../world-const.js?v=107';

const R = Math.random;
const AXIS = [[0, 1, 0], [1, 0, 0], [0, 0, 1]];
const DIRS = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];      // north, east, south, west (a wall resin clump's facing)
const lc2 = () => (typeof window !== 'undefined' ? window.__lc2 : null);
const isNight = t => { const d = ((t % 24000) + 24000) % 24000; return d >= 12600 && d <= 23400; };

export class Hearts {
  constructor() { this.found = new WeakMap(); this.recs = new Map(); this.n = 0; }
  // the hearts in a chunk with pale garden in it (looked for once, and again when its edits change)
  heartsIn(world, c, key) {
    const ed = world.edits && world.edits.get(key), size = ed ? ed.size : 0;
    let f = this.found.get(c);
    if (f && f.ed === size) return f.list;
    const list = [];
    if (B.creaking_heart !== undefined && (c.biome && c.biome.indexOf(BIO.pale_garden) >= 0 || size)) {
      const bl = c.blocks, T = B.creaking_heart;
      for (let i = bl.indexOf(T); i >= 0; i = bl.indexOf(T, i + 1)) list.push([c.cx * CH + (i & 15), i >> 8, c.cz * CH + ((i >> 4) & 15)]);
    }
    this.found.set(c, { list, ed: size });
    return list;
  }
  tick(world, player) {
    const L = lc2(), g = L && L.game;
    if (!g || !world || !player || g.dim !== 'overworld' || B.creaking_heart === undefined) return;
    const E = g.entities;
    if (!E) return;
    this.n++;
    // a creaking whose heart has gone dies with it; one too far away or caught by daybreak goes
    for (const [k, r] of this.recs) {
      const e = r.creaking;
      if (world.get(r.x, r.y, r.z) !== B.creaking_heart) {
        if (e && !e.dead && !e.removed) { e.heartGuard = null; e.hurt(1000, { type: 'generic', byPlayer: true }); }
        this.recs.delete(k);
        continue;
      }
      if (!e) continue;
      if (e.dead || e.removed) { r.creaking = null; r.wait = 20; continue; }
      const far = (e.pos.x - r.x - 0.5) ** 2 + (e.pos.y - r.y) ** 2 + (e.pos.z - r.z - 0.5) ** 2 > 34 * 34;
      if (far || (!isNight(g.time) && !e.customName)) { if (E.poof) E.poof(e); e.remove(); r.creaking = null; r.wait = 20; }
    }
    if (this.n % 10) return;
    const ccx = Math.floor(player.pos.x / CH), ccz = Math.floor(player.pos.z / CH);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const key = (ccx + dx) + ',' + (ccz + dz), c = world.chunks.get(key);
      if (!c) continue;
      for (const h of this.heartsIn(world, c, key)) this.one(world, g, E, h);
    }
  }
  one(world, g, E, [x, y, z]) {
    if (world.get(x, y, z) !== B.creaking_heart) return;
    const k = x + ',' + y + ',' + z, m = world.meta(x, y, z), a = AXIS[m % 3];
    const log = (xx, yy, zz) => world.get(xx, yy, zz) === B.pale_oak_log && world.meta(xx, yy, zz) % 3 === m % 3;
    const rooted = log(x + a[0], y + a[1], z + a[2]) && log(x - a[0], y - a[1], z - a[2]);
    let r = this.recs.get(k);
    if (!rooted || !isNight(g.time) || E.difficulty === 'peaceful') return;
    if (!r) { r = { x, y, z, creaking: null, wait: 20, cool: 0 }; this.recs.set(k, r); }
    if (r.creaking) return;
    // (looked at every 10 ticks: the second's wait is two looks)
    if ((r.wait -= 10) > 0) return;
    for (let i = 0; i < 16; i++) {
      const sx = x + Math.floor(R() * 33) - 16, sy = y + Math.floor(R() * 17) - 8, sz = z + Math.floor(R() * 33) - 16;
      const below = world.get(sx, sy - 1, sz), bd = BLOCKS[below];
      if (!below || !bd.solid || bd.leaves || bd.fluid) continue;
      let room = true;
      for (let h = 0; h < 3 && room; h++) { const b = world.get(sx, sy + h, sz); if (b && (BLOCKS[b].solid || BLOCKS[b].fluid || BLOCKS[b].waterlogged)) room = false; }
      if (!room) continue;
      const e = E.spawn('creaking', sx + 0.5, sy, sz + 0.5, { natural: true });
      if (!e) return;
      this.bind(world, E, r, e);
      return;
    }
  }
  // the bond: what a hit on the creaking does while its heart stands
  bind(world, E, r, e) {
    r.creaking = e;
    e.persistent = true;
    e.heartGuard = () => {
      if (world.get(r.x, r.y, r.z) !== B.creaking_heart) return false;
      this.trail(E, r, e);
      if (this.n >= r.cool) { r.cool = this.n + 100; this.resin(world, r); }
      return true;
    };
  }
  trail(E, r, e) {
    const L = lc2(), P = L && L.renderer && L.renderer.particles;
    if (!P || !P.spawn) return;
    const x0 = r.x + 0.5, y0 = r.y + 0.5, z0 = r.z + 0.5, x1 = e.pos.x, y1 = e.pos.y + 1.4, z1 = e.pos.z;
    const n = Math.min(40, Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) * 2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      P.spawn(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, 0, 0, 0, { colour: 0xff8a1c, size: 0.07, life: 14, gravity: 0, physics: false });
    }
  }
  // one to three resin clumps on the open sides of pale oak logs near the heart
  resin(world, r) {
    if (B.resin_clump === undefined) return;
    const logs = [];
    for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
      if (world.get(r.x + dx, r.y + dy, r.z + dz) === B.pale_oak_log) logs.push([r.x + dx, r.y + dy, r.z + dz]);
    let want = 1 + Math.floor(R() * 3);
    for (let tries = 0; tries < 24 && want > 0 && logs.length; tries++) {
      const [lx, ly, lz] = logs[Math.floor(R() * logs.length)];
      const f = Math.floor(R() * 4), d = DIRS[f], cx = lx + d[0], cz = lz + d[2];
      if (world.get(cx, ly, cz) !== 0) continue;
      // on its face towards the log it grows on (meta bits as models.js draws them: 8 south, 16 west, 4 north, 32 east)
      world.set(cx, ly, cz, B.resin_clump, [8, 16, 4, 32][f]);
      want--;
    }
  }
}
