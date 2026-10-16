/* ---------------------------------------------------------------------------
   Leoncraft 2 - the fight in the End.

   Keeps what the game keeps about the End (in the End's own save record):
   whether the dragon has ever been killed, whether one is alive and how
   hurt, which pillars still have their crystal, which gateways are left,
   whether the exit portal is lit, and a respawn in progress.

     the start    the first time the centre is loaded: a crystal on every
                  pillar, the dragon circling high over the portal
     the bar      "Ender Dragon", pink, while you are within 192 blocks of
                  (0, 128, 0) and it lives; the world's fog thickens
     its death    the exit portal lights, the dragon egg on its pillar the
                  first time, and one of the twenty end gateways (96 blocks
                  out, y 75, in a seeded order) opens
     respawning   four end crystals on the exit portal, one each side: their
                  beams go up, each pillar is rebuilt in turn with its crystal
                  (and its top blown clear), the dragon comes back and the
                  four crystals explode; about 30 seconds in all
--------------------------------------------------------------------------- */
import { B, BLOCKS } from '../blocks.js?v=62';
import { endSpikes, podiumBlocks } from '../gen/end.js?v=62';
import { rng, mix32 } from '../noise.js?v=62';
import { EndCrystal, XpOrb, splitXp } from './entities.js?v=62';
import { EnderDragon } from './dragon.js?v=62';

const E = y => y + 64;                 // world y -> the engine's index

// the twenty gateway spots, in the seed's order
export function gatewayOrder(seed) {
  const r = rng(mix32((seed | 0) ^ 0x6a7e));
  const o = []; for (let i = 0; i < 20; i++) o.push(i);
  for (let i = 19; i > 0; i--) { const j = r.int(i + 1); const t = o[i]; o[i] = o[j]; o[j] = t; }
  return o;
}
export function gatewayPos(i) {
  const a = 2 * (-Math.PI + 0.15707963267948966 * i);
  return { x: Math.floor(96 * Math.cos(a)), y: E(75), z: Math.floor(96 * Math.sin(a)) };
}
// an end gateway: the block, bedrock above and below it and round those, and a cap two away
export function gatewayBlocks(x, y, z) {
  const out = [[x, y, z, B.end_gateway]];
  for (const s of [-1, 1]) {
    out.push([x, y + s, z, B.bedrock], [x, y + 2 * s, z, B.bedrock]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push([x + dx, y + s, z + dz, B.bedrock]);
  }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) out.push([x + dx, y, z + dz, 0]);
  return out;
}

export class EndFight {
  constructor(R, state, seed) {
    this.R = R;
    this.seed = seed;
    this.s = Object.assign({ fresh: true, killed: false, alive: false, health: 200, crystals: new Array(10).fill(true),
      gateways: gatewayOrder(seed), portalLit: false, links: {}, respawn: null }, state || {});
    this.spikes = endSpikes(seed);
    this.started = false;
    this.dragon = null;
    this.crystals = [];              // the pillars' crystals (entities), by pillar
    this.respawners = [];
    this.podiumY = 0;
  }
  state() { if (this.dragon) this.s.health = this.dragon.health; return this.s; }

  /* ---- what the world looks like here ---- */
  topAt(x, z) {
    const w = this.R.world;
    if (!w.loaded(x, z)) return E(60);
    for (let y = 320; y > 0; y--) { const b = w.get(x, y, z); if (b && BLOCKS[b].solid) return y + 1; }
    return E(40);
  }
  groundBelow(x, y, z) {
    const w = this.R.world;
    for (let yy = Math.floor(y); yy > Math.floor(y) - 20; yy--) { const b = w.get(Math.floor(x), yy - 1, Math.floor(z)); if (b && BLOCKS[b].solid) return yy + 0.05; }
    return y - 4;
  }
  // the podium's floor: three below the top of its bedrock pillar at 0, 0
  findPodium() {
    const w = this.R.world;
    for (let y = 300; y > 64; y--) if (w.get(0, y, 0) === B.bedrock && w.get(0, y - 3, 0) === B.bedrock) return y - 3;
    return 0;
  }

  /* ---- each tick ---- */
  tick() {
    const w = this.R.world;
    if (!this.started) {
      if (!w.loaded(0, 0) || !w.loaded(-16, -16) || !w.loaded(15, 15)) return;
      this.podiumY = this.findPodium();
      if (!this.podiumY) return;
      this.started = true;
      // after the first loss the portal stays lit until a respawn begins
      if (this.s.portalLit) this.setPodium(true, false);
      if (this.s.fresh) { this.s.fresh = false; this.s.alive = true; this.s.health = 200; this.s.crystals.fill(true); }
      this.spikes.forEach((sp, i) => { if (this.s.crystals[i] && (this.s.alive || this.s.respawn)) this.spawnCrystal(i); });
      if (this.s.alive) this.spawnDragon(this.s.health);
      if (this.s.respawn) this.resumeRespawn();
    }
    // beams: the dragon's healing crystal points at it
    for (const c of this.crystals) if (c && !c.dead) c.beamTo = null;
    if (this.dragon && !this.dragon.dead && this.dragon.crystal && !this.dragon.crystal.dead) {
      const b = this.dragon.partBoxes()[2].box;
      this.dragon.crystal.beamTo = new window.THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    }
    if (this.s.respawn) this.respawnTick();
  }
  bossBar(player) {
    const d = this.dragon;
    if (!d || d.dead || !player) return null;
    const dx = player.x - 0, dy = player.y - E(128), dz = player.z - 0;
    if (dx * dx + dy * dy + dz * dz > 192 * 192) return null;
    return { name: 'Ender Dragon', progress: d.health / d.maxHealth, colour: 'pink' };
  }

  /* ---- the crystals ---- */
  spawnCrystal(i) {
    const sp = this.spikes[i];
    const c = new EndCrystal(this.R, { pillar: i });
    c.at(sp.x + 0.5, E(sp.h) + 1, sp.z + 0.5);
    this.crystals[i] = c;
    this.R.add(c);
    return c;
  }
  crystalsAlive() { let n = 0; for (const c of this.crystals) if (c && !c.dead) n++; return n; }
  nearestCrystal(pos, r) {
    let best = null, bd = 1e9;
    for (const c of this.crystals) {
      if (!c || c.dead) continue;
      if (Math.abs(c.pos.x - pos.x) > r || Math.abs(c.pos.y - pos.y) > r || Math.abs(c.pos.z - pos.z) > r) continue;
      const d = c.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  // a crystal was hit: it explodes (power 6); the dragon loses 10 if it was healing from it
  crystalDestroyed(c, source) {
    if (c.pillar >= 0) this.s.crystals[c.pillar] = false;
    if (this.dragon && this.dragon.crystal === c) { this.dragon.crystal = null; this.dragon.hurt(10, 'head', 'explosion'); }
    if (c.respawner && this.s.respawn) this.cancelRespawn();
    this.R.explode(c.pos.x, c.pos.y + 1, c.pos.z, 6, { fire: false, source: 'end_crystal', by: source });
  }

  /* ---- the dragon ---- */
  spawnDragon(health) {
    const d = new EnderDragon(this.R, this);
    d.at(0.5, E(128), 0.5);
    d.health = Math.max(1, Math.min(200, health || 200));
    this.dragon = d;
    this.R.add(d);
    this.s.alive = true;
  }
  xpForKill() { return this.s.killed ? 500 : 12000; }
  dropXp(pos, n) {
    for (const v of splitXp(n)) this.R.add(new XpOrb(this.R, v).at(pos.x + (Math.random() - 0.5) * 2, pos.y + 1, pos.z + (Math.random() - 0.5) * 2));
  }
  dragonDied() {
    const first = !this.s.killed;
    this.s.alive = false; this.s.killed = true; this.s.portalLit = true; this.s.health = 200;
    this.dragon = null;
    this.setPodium(true, first);
    this.spawnGateway();
  }
  setPodium(lit, egg) {
    if (!this.podiumY) this.podiumY = this.findPodium();
    if (!this.podiumY) return;
    const w = this.R.world;
    const keepEgg = w.get(0, this.podiumY + 4, 0) === B.dragon_egg;
    for (const [dx, y, dz, b, m] of podiumBlocks(this.podiumY, lit, egg || keepEgg)) w.set(dx, y, dz, b, m);
  }
  spawnGateway() {
    const i = this.s.gateways.shift();
    if (i === undefined) return;
    const g = gatewayPos(i);
    const w = this.R.world;
    for (const [x, y, z, b] of gatewayBlocks(g.x, g.y, g.z)) w.set(x, y, z, b, 0);
  }

  /* ---- respawning: four crystals on the exit portal ---- */
  respawnSpots() {
    const y = this.podiumY;
    // the cells two out from the centre, one above the portal: a crystal on the rim beside each overlaps one
    return [[0.5, y, -2], [0.5, y, 3], [-2, y, 0.5], [3, y, 0.5]];
  }
  tryRespawn() {
    if (this.s.alive || this.s.respawn || !this.started) return false;
    const spots = this.respawnSpots(), found = [];
    for (const [x, y, z] of spots) {
      const c = this.R.entities.find(e => e instanceof EndCrystal && !e.dead && e.pillar < 0 && Math.abs(e.pos.x - x) < 1.6 && Math.abs(e.pos.z - z) < 1.6 && e.pos.y >= y - 0.5 && e.pos.y <= y + 2.5);
      if (!c) return false;
      found.push(c);
    }
    for (const c of found) c.respawner = true;
    this.respawners = found;
    this.s.respawn = { t: 0 };
    this.s.portalLit = false;
    this.setPodium(false, false);
    return true;
  }
  resumeRespawn() {
    // the four crystals are not kept between visits: a respawn in progress starts again from its pillars
    this.respawners = [];
  }
  cancelRespawn() {
    this.s.respawn = null;
    for (const c of this.respawners) c.respawner = false;
    this.respawners = [];
    this.s.portalLit = true;
    this.setPodium(true, false);
  }
  respawnTick() {
    const r = this.s.respawn, t = ++r.t;
    const sky = new window.THREE.Vector3(0.5, this.podiumY + 60, 0.5);
    for (const c of this.respawners) if (!c.dead) c.beamTo = sky;
    // 150 ticks of beams; then the pillars, one every 40 ticks; then the dragon at 604
    if (t >= 150 && t < 550 && (t - 150) % 40 === 0) {
      const i = (t - 150) / 40, sp = this.spikes[i];
      const w = this.R.world;
      this.R.explode(sp.x + 0.5, E(sp.h) + 1, sp.z + 0.5, 5, { fire: false, source: 'respawn' });
      // the pillar itself, put back block by block
      const put = (x, y, z, b) => w.set(x, E(y), z, b, 0);
      const r2 = sp.r * sp.r + 1;
      for (let dz = -sp.r; dz <= sp.r; dz++) for (let dx = -sp.r; dx <= sp.r; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        for (let y = 50; y < sp.h; y++) { const cur = w.get(sp.x + dx, E(y), sp.z + dz); if (cur !== B.obsidian) put(sp.x + dx, y, sp.z + dz, B.obsidian); }
      }
      put(sp.x, sp.h, sp.z, B.bedrock);
      if (sp.caged) for (let dy = 0; dy <= 3; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === 3) put(sp.x + dx, sp.h + dy, sp.z + dz, B.iron_bars);
      if (this.crystals[i] && !this.crystals[i].dead) { this.crystals[i].dead = true; }
      this.s.crystals[i] = true;
      this.spawnCrystal(i);
    }
    if (t >= 604) {
      this.s.respawn = null;
      this.spawnDragon(200);
      for (const c of this.respawners) if (!c.dead) c.hurt(1, 'respawn');
      this.respawners = [];
    }
  }
}
