/* ---------------------------------------------------------------------------
   Leoncraft 2 - the minecarts that carry a block, as the game has them
   (Minecraft Wiki: Minecart with Chest, with Furnace, with TNT, with Hopper,
   with Command Block). Each rides the rails as a minecart does
   (entities/minecart.js), its block drawn in the tub three quarters of its
   size, nobody gets in, and broken it drops its own item (since 1.19).

     chest     27 slots, opened with a click; what it holds spills when it
               breaks; a mineshaft's keeps its loot table until first opened
     furnace   coal or charcoal adds 3600 ticks of fuel (up to 32 000); with
               fuel a click pushes it away from you, and it then drives
               itself at up to 4 blocks a second (0.8 of its speed kept a
               tick, the push added), lit and smoking while the fuel lasts
     tnt       a powered activator rail lights it (80 ticks, then it goes);
               broken while it moves, or by fire, lava or a blast (lava does
               it in two ticks, a fire block in five), it is lit with 0-38
               ticks left instead of dropping; running into a wall at speed,
               going round a curve fast with a solid block in its inner
               corner, falling 3 blocks or more (not onto a rail), or a
               burning arrow blows it at once: power 4 + up to 1.5 x its
               speed (at most 5); flint and steel and fire charges do
               nothing to it in Java Edition (that is Bedrock's)
     hopper    5 slots; every tick, one item from a container above the rail
               or what lies on it, as much of a stack as fits; a powered
               activator rail turns it off; a hopper under the rail empties
               it (containers.js finds it as it finds a chest boat)
     command   a powered activator rail runs its command, at most once
               every 4 ticks, from where the cart is (~ ~ ~ is the cart);
               an operator in creative sets the command with a click
               (ui/commandcart.js); it keeps what the command said last
--------------------------------------------------------------------------- */
import { Minecart } from './minecart.js?v=107';
import { register } from './mobs.js?v=107';
import { MODELS } from './mobmodels.js?v=107';
import { addArt } from './mobart.js?v=107';
import { B } from '../blocks.js?v=107';
import { stackToJSON, stackFromJSON, maxStack } from '../items.js?v=107';
import { spill, lootStack } from '../containers.js?v=107';
import { ChestScreen, HopperScreen } from '../ui/containers.js?v=107';
import { CommandCartScreen } from '../ui/commandcart.js?v=107';

const R = () => Math.random(), RI = n => Math.floor(Math.random() * n);

/* ---- the block in the tub: a 12 pixel cube resting on the floor, a 10 pixel
   chest with its latch, a hopper's bowl, neck and spout ---- */
const model = (name, boxes) => {
  const md = { name, size: [64, 64], parts: [{ name: 'block', pivot: [0, 0, 0], rot: [0, 0, 0], parent: -1, boxes }], animate() {} };
  md.index = { block: 0 };
  MODELS[name] = md;
};
model('cart_block', [[-6, 8, -6, 12, 12, 12, 0, 0]]);
model('cart_chest', [[-5, 10, -5, 10, 10, 10, 0, 0], [-1, 12, -6, 2, 3, 1, 0, 24]]);
model('cart_hopper', [[-6, 8, -6, 12, 4, 12, 0, 0], [-3, 12, -3, 6, 5, 6, 0, 20], [-2, 17, -2, 4, 3, 4, 0, 34]]);

// our own pictures of the blocks (the game's are not used)
addArt('cart_chest', [64, 64], p => {
  p.box(0, 0, 10, 10, 10, { all: 0x9a6a2c, top: 0xa8763a }, 0.08);
  p.fill(0, 10 + 3, 40, 1, 0x4a3214);
  p.box(0, 24, 2, 3, 1, 0xc8c8c8, 0.05);
});
const cobble = (p, x, y, w, h) => { p.fill(x, y, w, h, 0x7a7a7a, 0.1); p.speckle(x, y, w, h, 0x5a5a5a, 0.25); p.speckle(x, y, w, h, 0x9a9a9a, 0.15); };
for (const lit of [false, true]) {
  addArt(lit ? 'cart_furnace_lit' : 'cart_furnace', [64, 64], p => {
    p.box(0, 0, 12, 12, 12, { all: (x, y, w, h) => cobble(p, x, y, w, h), front: (x, y, w, h) => {
      cobble(p, x, y, w, h);
      p.fill(x + 2, y + 2, w - 4, 2, 0x4a4a4a, 0.05);
      p.fill(x + 3, y + 6, w - 6, 4, lit ? 0xf0a030 : 0x1e1e1e, lit ? 0.2 : 0.05);
      if (lit) p.speckle(x + 3, y + 6, w - 6, 4, 0xfff070, 0.35);
    } });
  });
}
addArt('cart_tnt', [64, 64], p => {
  p.box(0, 0, 12, 12, 12, {
    sides: (x, y, w, h) => {
      p.fill(x, y, w, h, 0xc8382c, 0.1);
      p.fill(x, y + 4, w, 4, 0xe8e4dc, 0.04);
      // T N T in the band, two pixels apart
      const dark = 0x2a2a2a;
      p.fill(x + 1, y + 4, 3, 1, dark, 0); p.fill(x + 2, y + 5, 1, 3, dark, 0);
      p.fill(x + 5, y + 4, 1, 4, dark, 0); p.px(x + 6, y + 5, dark); p.fill(x + 7, y + 4, 1, 4, dark, 0);
      p.fill(x + 8, y + 4, 3, 1, dark, 0); p.fill(x + 9, y + 5, 1, 3, dark, 0);
    },
    top: (x, y, w, h) => { p.fill(x, y, w, h, 0xd8d0c4, 0.06); p.fill(x + 4, y + 4, w - 8, h - 8, 0x5a5048, 0.08); },
    bottom: (x, y, w, h) => p.fill(x, y, w, h, 0xb0a898, 0.06),
  });
});
addArt('cart_tnt_flash', [64, 64], p => p.box(0, 0, 12, 12, 12, 0xffffff, 0.02));
addArt('cart_hopper', [64, 64], p => {
  p.box(0, 0, 12, 4, 12, { all: 0x4c4c4c, top: (x, y, w, h) => { p.fill(x, y, w, h, 0x5a5a5a, 0.06); p.fill(x + 2, y + 2, w - 4, h - 4, 0x262626, 0.05); } }, 0.08);
  p.box(0, 20, 6, 5, 6, 0x444444, 0.08);
  p.box(0, 34, 4, 3, 4, 0x3a3a3a, 0.08);
});
addArt('cart_command', [64, 64], p => {
  p.box(0, 0, 12, 12, 12, { all: (x, y, w, h) => {
    p.fill(x, y, w, h, 0xb9764a, 0.08);
    for (let i = 0; i < w; i += 3) p.fill(x + i, y, 1, h, 0x8a5434, 0.05);
    p.fill(x + 3, y + 3, w - 6, h - 6, 0x6a6a72, 0.06); p.fill(x + 4, y + 5, 3, 1, 0xe8e8e8, 0);
  } });
});

// what lies on the rail under a cart: an activator rail's power
function activator(c) {
  const T = c.m.t, x = Math.floor(c.pos.x), z = Math.floor(c.pos.z);
  let y = Math.floor(c.pos.y);
  if (T.get(x, y, z) !== B.activator_rail) y--;
  return T.get(x, y, z) === B.activator_rail && (T.meta(x, y, z) & 8) !== 0;
}

class BlockCart extends Minecart {
  static NO_RIDE = true;
  interact() { return false; }
  layers(out) { out.push([this.constructor.LAYER || 'cart_block', this.layerTex(), null, false, false]); }
  layerTex() { return this.constructor.LAYER_TEX; }
  pickItem() { return this.constructor.ITEM; }
}

/* ---- with a chest ---- */
class ChestCart extends BlockCart {
  static ITEM = 'chest_minecart'; static LAYER = 'cart_chest'; static LAYER_TEX = 'cart_chest';
  constructor(m, type) { super(m, type); this.slots = new Array(27).fill(null); this.chest = true; this.loot = null; }
  // from a structure (a mineshaft): its loot table and seed, rolled when first opened
  // (the seed a long, kept as text; carts saved before kept a number, which rolls the same way)
  spawnData(o) { if (o && o.loot) this.loot = { table: o.loot, seed: o.seed === undefined ? 0 : o.seed }; }
  title() { return 'Minecart with Chest'; }
  // friction: 0.98 a tick, and a thousandth more for each step a comparator would read below 15, so a full cart
  // slows soonest (one with its loot not yet rolled, 0.98)
  drag() {
    if (this.loot) return 0.98;
    let f = 0;
    for (const st of this.slots) if (st) f += st.count / maxStack(st.id);
    f /= this.slots.length;
    return 0.98 + (15 - (f > 0 ? Math.floor(f * 14) + 1 : 0)) * 0.001;
  }
  interact(held, player) {
    if (!player || !player.isPlayer) return false;
    this.fill().then(() => this.open());
    return 'swing';
  }
  open() {
    const H = this.m.hooks.hands;
    if (!H || !H.open || this.removed) return;
    H.open(this.constructor === HopperCart ? new HopperScreen(H.inv, H.icons, this.slots, null) : new ChestScreen(H.inv, H.icons, this.slots, this.title(), null));
    if (this.constructor === HopperCart && H.gui && H.gui.screen) H.gui.screen.title = this.title();
  }
  // the loot, once: its stacks into their slots
  fill() {
    const L = this.loot;
    if (!L) return Promise.resolve();
    this.loot = null;
    return import('../struct/loot.js?v=107').then(mod => {
      for (const e of mod.rollLoot(L.table, L.seed, { size: this.slots.length })) {
        const st = lootStack(e);
        if (st && e.slot >= 0 && e.slot < this.slots.length && !this.slots[e.slot]) this.slots[e.slot] = st;
      }
    }, () => {});
  }
  // broken: what it held thrown out as a broken chest's is (a mineshaft's loot too)
  broken() {
    const go = () => {
      const H = this.m.hooks.hands, D = H && H.drops, p = this.pos, left = this.slots.filter(Boolean);
      this.slots.fill(null);
      if (D && D.spawn) spill(D, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), left);
    };
    if (this.loot) this.fill().then(go); else go();
  }
  toJSON() {
    const o = super.toJSON();
    if (this.slots.some(Boolean)) o.items = this.slots.map(s => (s ? stackToJSON(s) : null));
    if (this.loot) o.loot = this.loot;
    return o;
  }
  fromJSON(o) {
    super.fromJSON(o);
    if (Array.isArray(o.items)) for (let i = 0; i < this.slots.length; i++) this.slots[i] = o.items[i] ? stackFromJSON(o.items[i]) : null;
    if (o.loot) this.loot = o.loot;
  }
}

/* ---- with a hopper ---- */
class HopperCart extends ChestCart {
  static ITEM = 'hopper_minecart'; static LAYER = 'cart_hopper'; static LAYER_TEX = 'cart_hopper';
  constructor(m, type) { super(m, type); this.slots = new Array(5).fill(null); this.enabled = true; }
  title() { return 'Minecart with Hopper'; }
  tick() {
    super.tick();
    if (this.removed) return;
    this.enabled = !activator(this);
    if (this.enabled) this.suck();
  }
  // one item from a container over the rail, else as much as fits of something lying on it
  suck() {
    const H = this.m.hooks.hands, C = H && H.containers, p = this.pos;
    if (!C) return;
    const self = { refs: this.slots.map((_, k) => [this, k]), kind: 'hopper_minecart', c: this };
    const from = C.slotRefs(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
    if (from) {
      for (const [c, i] of from.refs) {
        const s = c.slots[i];
        if (!s || !C.canExtract(c, i, s)) continue;
        if (C.insertOne(self, s, 'up')) { s.count--; if (s.count <= 0) c.slots[i] = null; C.changed(c); return; }
      }
      return;
    }
    const D = H.drops;
    if (!D || !D.items) return;
    const x0 = p.x - this.hw - 0.25, x1 = p.x + this.hw + 0.25, z0 = p.z - this.hw - 0.25, z1 = p.z + this.hw + 0.25, y0 = p.y, y1 = p.y + this.h + 0.5;
    for (const e of D.items) {
      if (e.gone || e.fly > 0) continue;
      const q = e.pos;
      if (q.x < x0 || q.x > x1 || q.z < z0 || q.z > z1 || q.y < y0 || q.y > y1) continue;
      let took = 0;
      while (e.stack.count > 0 && C.insertOne(self, e.stack, 'up')) { e.stack.count--; took++; }
      if (took) { if (e.stack.count <= 0) D._remove(e, -1); return; }
    }
  }
}

/* ---- with a furnace ---- */
const FUEL = new Set(['coal', 'charcoal']);
class FurnaceCart extends BlockCart {
  static ITEM = 'furnace_minecart'; static LAYER_TEX = 'cart_furnace'; static FURNACE = true;
  constructor(m, type) { super(m, type); this.fuel = 0; this.px = 0; this.pz = 0; }
  layerTex() { return this.fuel > 0 ? 'cart_furnace_lit' : 'cart_furnace'; }
  // 4 blocks a second, 3 in water
  maxSpeed(inWater) { return inWater ? 0.15 : 0.2; }
  interact(held, player) {
    if (!player || !player.isPlayer) return false;
    if (FUEL.has(held) && this.fuel + 3600 <= 32000) {
      this.fuel += 3600;
      if (this.m.mode !== 'creative' && this.m.inv) this.m.inv.takeSelected(1);
    }
    if (this.fuel > 0) { const P = this.m.P; this.px = this.pos.x - P.pos.x; this.pz = this.pos.z - P.pos.z; }
    return 'swing';
  }
  // the push along the rail (minecart.js calls this before friction): 0.8 of the speed kept and the push added
  drive(s, hx, hz) {
    if (this.fuel <= 0 || (!this.px && !this.pz)) return s * 0.98;
    const d = this.px * hx + this.pz * hz;
    s = s * 0.8 + (d > 0 ? 1 : d < 0 ? -1 : 0);
    // the push turns with the track
    if (Math.abs(s) > 0.001) { const k = Math.sign(s); this.px = hx * k; this.pz = hz * k; }
    return s;
  }
  tick() {
    if (this.fuel > 0) this.fuel--;
    if (this.fuel <= 0) { this.px = 0; this.pz = 0; }
    super.tick();
    if (this.fuel > 0 && RI(4) === 0) this.m.particles('smoke', this.pos.x, this.pos.y + 0.8, this.pos.z, 1, 0.1);
  }
  toJSON() { const o = super.toJSON(); if (this.fuel > 0) { o.fuel = this.fuel; o.push = [this.px, this.pz]; } return o; }
  fromJSON(o) { super.fromJSON(o); this.fuel = o.fuel | 0; if (Array.isArray(o.push)) { this.px = +o.push[0] || 0; this.pz = +o.push[1] || 0; } }
}

/* ---- with TNT ---- */
class TntCart extends BlockCart {
  static ITEM = 'tnt_minecart'; static LAYER_TEX = 'cart_tnt';
  constructor(m, type) { super(m, type); this.fuse = -1; }
  // white every other quarter second for the last half second, as the game flashes it
  layerTex() { return this.fuse > -1 && this.fuse < 10 && Math.floor(this.fuse / 5) % 2 === 0 ? 'cart_tnt_flash' : 'cart_tnt'; }
  prime(t) { if (this.fuse < 0) { this.fuse = t === undefined ? 80 : t; if (this.m.primedSound) this.m.primedSound(this); } }
  tick() {
    const sp = this.vel.x * this.vel.x + this.vel.z * this.vel.z;
    super.tick();
    if (this.removed) return;
    if (activator(this)) this.prime();
    // into a block at speed: the end of its rail, or a wall it runs into off the rails
    if ((this.hitEnd || (!this.onRail && this.hCollide)) && sp >= 0.01) { this.blow(sp); return; }
    // round a curve with a solid block in its inner corner: the cart's box runs into that block, and the half of its
    // speed that is not stopped sets it off from a tenth of a block a tick (the game's "turns on a curved track too fast")
    if (sp >= 0.02 && this.cornered()) { this.blow(sp / 2); return; }
    if (this.fuse > 0) {
      this.fuse--;
      this.m.particles('smoke', this.pos.x, this.pos.y + 1, this.pos.z, 1, 0.05);
    } else if (this.fuse === 0) this.blow(this.vel.x * this.vel.x + this.vel.z * this.vel.z);
  }
  // on a flat curve, past its ends (where the 0.98 wide box reaches over the corner), with a solid block in that corner
  cornered() {
    if (!this.onRail) return false;
    const T = this.m.t, p = this.pos, bx = Math.floor(p.x), bz = Math.floor(p.z);
    let by = Math.floor(p.y), r = this.rail(bx, by, bz);
    if (!r) r = this.rail(bx, --by, bz);
    if (!r) return false;
    const [a, e] = r;
    if (a[2] || e[2] || a[0] * e[0] + a[1] * e[1] !== 0) return false;
    const dx = a[0] + e[0], dz = a[1] + e[1];
    if ((p.x - bx - 0.5) * dx <= 0.01 || (p.z - bz - 0.5) * dz <= 0.01) return false;
    return T.solid(bx + dx, by, bz + dz);
  }
  // (a fall onto a rail never sets it off: the rail takes the fall, "unless landing on any form of rail")
  landed(dist) { if (dist >= 3) this.blow((dist / 10) * (dist / 10)); }
  blow(sp) {
    if (this.removed) return;
    const d = Math.min(5, Math.sqrt(sp));
    this.remove();
    this.m.explode(this.pos.x, this.pos.y, this.pos.z, 4 + R() * 1.5 * d, { type: 'explosion', attacker: this, tnt: true });
  }
  hurt(amount, src) {
    if (this.removed) return false;
    // a burning arrow sets it off at once
    if (src && src.direct && src.direct.fire > 0) { this.blow(src.direct.vel ? src.direct.vel.lengthSq() : 0); return true; }
    return super.hurt(amount, src);
  }
  // broken by fire, lava or a blast, or while it moves: lit, a second or two from going, rather than dropped
  destroyed(src) {
    const fiery = src && /fire|lava|explosion/.test(src.type || '');
    const moving = this.vel.x * this.vel.x + this.vel.z * this.vel.z >= 0.01;
    if (!fiery && !moving) { super.destroyed(src); return; }
    if (this.fuse < 0) this.prime(RI(20) + RI(20));
  }
  toJSON() { const o = super.toJSON(); if (this.fuse >= 0) o.fuse = this.fuse; return o; }
  fromJSON(o) { super.fromJSON(o); if (o.fuse >= 0) this.fuse = o.fuse; }
}

/* ---- with a command block ---- */
class CommandCart extends BlockCart {
  static ITEM = 'command_block_minecart'; static LAYER_TEX = 'cart_command';
  constructor(m, type) { super(m, type); this.command = ''; this.lastOut = ''; this.track = true; this.t = 0; this.lastRun = -4; }
  title() { return 'Minecart with Command Block'; }
  interact(held, player) {
    if (!player || !player.isPlayer) return false;
    const H = this.m.hooks.hands, ctx = this.m.hooks.commandCtx ? this.m.hooks.commandCtx() : null;
    if (!H || !H.open || !ctx) return false;
    // (the game's rule: an operator, that is a player who may use commands, in creative)
    if (H.mode !== 'creative' || !ctx.cheats) { ctx.say('Must be an opped player in creative mode', 0xFFFFFF); return 'swing'; }
    H.open(new CommandCartScreen(this, ctx.say));
    return 'swing';
  }
  tick() {
    super.tick();
    if (this.removed) return;
    this.t++;
    if (this.command && activator(this) && this.t - this.lastRun >= 4) { this.lastRun = this.t; this.run(); }
  }
  /* its command, as the game runs it: with every permission, from the cart (so ~ and ^ are its place),
     what it says kept as its Previous Output and, when it worked, shown to the player in grey */
  run() {
    const ctx = this.m.hooks.commandCtx ? this.m.hooks.commandCtx() : null, P = ctx && ctx.game && ctx.game.player;
    if (!ctx || !P) return;
    const said = [];
    ctx.cheats = true;
    ctx.say = (t, c) => said.push([String(t), c]);
    ctx.playerName = '@';
    import('../commands.js?v=107').then(mod => {
      if (this.removed) return;
      // the player stands where the cart is for the command, and back after (unless it moved them)
      const was = P.pos.clone(), at = this.pos.clone();
      P.pos.copy(at);
      let ok = false;
      try { ok = mod.execute(this.command, ctx); } finally { if (P.pos.equals(at)) P.pos.copy(was); }
      if (this.track) this.lastOut = said.length ? said[said.length - 1][0] : '';
      const chat = this.m.hooks.commandCtx();
      if (ok) for (const [t, c] of said) if (c !== 0xFF5555) chat.say('[' + this.title() + ': ' + t + ']', 0xAAAAAA);
    }, () => {});
  }
  toJSON() {
    const o = super.toJSON();
    if (this.command) o.cmd = this.command;
    if (this.lastOut) o.out = this.lastOut;
    if (!this.track) o.trk = 0;
    return o;
  }
  fromJSON(o) { super.fromJSON(o); this.command = o.cmd || ''; this.lastOut = o.out || ''; this.track = o.trk !== 0; }
}

register('chest_minecart', ChestCart);
register('hopper_minecart', HopperCart);
register('furnace_minecart', FurnaceCart);
register('tnt_minecart', TntCart);
register('command_block_minecart', CommandCart);
// the items that put a cart on a rail, and the kind each makes
export const CART_ITEMS = { minecart: 'minecart', chest_minecart: 'chest_minecart', hopper_minecart: 'hopper_minecart', furnace_minecart: 'furnace_minecart', tnt_minecart: 'tnt_minecart', command_block_minecart: 'command_block_minecart' };
