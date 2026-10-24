/* ---------------------------------------------------------------------------
   Leoncraft 2 - Leonpixel's lobby cosmetics at play (what they are:
   net/cosdata.js; who has found what: mlhub apps/mc/hubcos.js).

   Hidden chests: a right click on any chest in the lobby asks the server
   (cosegg); a hidden one opens as a menu of what is in it that you have not
   taken yet, and a click takes it (costake). Each chest's cosmetics stay
   there for everyone else. What you take is yours on your account, an item
   in your lobby inventory (or the Backpack, once you have found it), and
   where you keep it all is saved whenever you move things (cosinv), so the
   lobby gives it back the same way every time.

   Wearing: a right click on a hat, an aura or a trail wears it (again takes
   it off); the server tells everyone in the lobby (worn) and every page
   draws everyone's: hats on the head (render/hats.js through
   avatar.setHat), auras and trails as particles, mounts under the rider,
   the Secret Service's guards round them, the Double Jump Boots on the feet.
   Gadgets do what they do at once on your page; what the others should see
   goes through the server (cosgad -> gfx) and their pages play it the same
   way (a throw is worked out from where it started on every page, so it
   lands in the same place). Nothing is ever used up; each has a short wait.

   Made by net/hub.js with its own pieces (makeLobbyCos(K)), as the Profile
   menus are, so this file imports nothing of hub.js.
--------------------------------------------------------------------------- */
import { COS, COSMETICS, HATS, AURAS, TRAILS, GADGETS, RARITY, CATS } from './cosdata.js?v=107';
import { B, BLOCKS, SOLID } from '../blocks.js?v=107';
import { Sound } from '../sound/sound.js?v=107';
import { F } from './players.js?v=107';
import { blockGeometry } from '../render/blockmesh.js?v=107';

const THREE = window.THREE;
const FIXED = ['compass', 'temp', 'profile'];
const PACK_PAGE = 45, PACK_PAGES = 3;
const R = Math.random;
const r3 = v => Math.round(v * 1000) / 1000;
const HUES = [[1, 0.2, 0.2], [1, 0.6, 0.1], [1, 0.95, 0.2], [0.3, 1, 0.3], [0.2, 0.8, 1], [0.35, 0.4, 1], [0.8, 0.3, 1], [1, 0.4, 0.8]];
// a colour of an aura or trail: a fixed one, or one of a set picked each time
function colour(c, t) {
  if (!c) return undefined;
  if (Array.isArray(c)) return c;
  if (c === 'rainbow') return HUES[Math.floor(t / 3) % HUES.length];
  if (c === 'confetti') return HUES[(R() * HUES.length) | 0];
  if (c === 'galaxy') return R() < 0.5 ? [0.6, 0.35, 1] : R() < 0.5 ? [0.3, 0.5, 1] : [1, 1, 1];
  if (c === 'redblue') return t % 2 ? [1, 0.2, 0.25] : [0.25, 0.45, 1];
  if (c === 'autumn') return [[0.9, 0.35, 0.1], [0.95, 0.65, 0.15], [0.7, 0.2, 0.05]][(R() * 3) | 0];
  if (c === 'ocean') return R() < 0.5 ? [0.2, 0.6, 1] : [0.3, 0.95, 0.9];
  return undefined;
}

// the first solid block along a ray (a tenth of a block at a time): { x, y, z, t } or null
function rayHit(w, ex, ey, ez, dx, dy, dz, max) {
  for (let t = 0.3; t < max; t += 0.1) {
    const x = Math.floor(ex + dx * t), y = Math.floor(ey + dy * t), z = Math.floor(ez + dz * t), b = w.get(x, y, z);
    if (b && SOLID[b]) return { x, y, z, t, px: ex + dx * (t - 0.1), py: ey + dy * (t - 0.1), pz: ez + dz * (t - 0.1) };
  }
  return null;
}
// where a ray first enters a box, or Infinity
function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = Infinity;
  for (const [o, d, lo, hi] of [[ox, dx, x0, x1], [oy, dy, y0, y1], [oz, dz, z0, z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
    let a = (lo - o) / d, b = (hi - o) / d;
    if (a > b) { const s = a; a = b; b = s; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/* The Secret Service's look, drawn here: a black suit, white shirt, black tie, dark glasses (64 x 64, our own) */
let GUARD_SKIN = '';
function guardSkin() {
  if (GUARD_SKIN) return GUARD_SKIN;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const box = (u, v, w, h, d, col) => { g.fillStyle = col; g.fillRect(u, v + d, 2 * (w + d), h); g.fillRect(u + d, v, 2 * w, d); };
  box(0, 0, 8, 8, 8, '#c8956d');                       // head: skin
  g.fillStyle = '#2b1d14'; g.fillRect(8, 0, 8, 8); g.fillRect(0, 8, 32, 2);   // hair on top and round the head
  g.fillStyle = '#0b0b0e'; g.fillRect(9, 11, 6, 2);    // the glasses
  g.fillStyle = '#9a6a4a'; g.fillRect(11, 14, 2, 1);   // the mouth
  box(16, 16, 8, 12, 4, '#15151a');                    // body: the suit
  g.fillStyle = '#f2f2f2'; g.fillRect(22, 20, 4, 6);   // shirt
  g.fillStyle = '#0b0b0e'; g.fillRect(23, 20, 2, 8);   // tie
  box(40, 16, 4, 12, 4, '#15151a'); box(32, 48, 4, 12, 4, '#15151a');   // arms
  g.fillStyle = '#c8956d'; g.fillRect(44, 30, 4, 2); g.fillRect(36, 62, 4, 2);   // hands
  box(0, 16, 4, 12, 4, '#1c1c22'); box(16, 48, 4, 12, 4, '#1c1c22');   // legs
  g.fillStyle = '#050507'; g.fillRect(4, 29, 4, 3); g.fillRect(20, 61, 4, 3);   // shoes
  GUARD_SKIN = c.toDataURL('image/png');
  return GUARD_SKIN;
}
// riding: the legs forward and apart, the body lifted onto the mount's back (in the model's pixels)
function ridePose(h) {
  const lift = h * 16 - 10;
  return S => {
    for (const q of S) q.y -= lift;
    S[4].rx = -1.35; S[4].rz = 0.3; S[5].rx = -1.35; S[5].rz = -0.3;
  };
}

let BY_NAME = null;                 // a cosmetic's item name -> its id (for repair)

export function makeLobbyCos(K) {
  const { MenuScreen, ChestScreen, stack, idOf } = K;

  // a cosmetic as an item: its rarity's colour, what kind it is, what it does, and how to use it
  function cosStack(id, worn) {
    const c = COS.get(id);
    if (!c) return null;
    const st = stack(c.icon, 1, c.color !== undefined ? { color: c.color } : null);
    if (!st) return null;
    const rar = RARITY[c.rarity] || RARITY.c, cat = CATS.find(q => q[0] === c.cat) || CATS[0];
    st.name = rar[1] + c.name;
    st.plain = true;
    const how = c.cat === 'gadget' ? (GADGETS[id] && GADGETS[id].how ? '§e' + GADGETS[id].how : GADGETS[id] && GADGETS[id].toggle ? '§eRight Click to turn on or off' : GADGETS[id] && GADGETS[id].hold ? '§eHold Right Click to use' : '§eRight Click to use')
      : c.cat === 'special' ? '§eRight Click to open' : worn ? '§eRight Click to take off' : '§eRight Click to wear';
    st.lore = [cat[2] + cat[1].replace(/s$/, '') + ' §8- ' + rar[1] + rar[0], '§7' + c.what, worn ? '§a✔ Wearing' : '', how].filter(Boolean);
    if (worn) st.ench = { unbreaking: 1 };
    st.cos = id;
    return st;
  }

  /* ---- a hidden chest ---- */
  class EggMenu extends MenuScreen {
    constructor(cos, m) { super(cos.hub, 'Hidden Chest'); this.cos = cos; this.m = m; this.box.fill(null); this.fillBox(); }
    fillBox() {
      const m = this.m, cos = this.cos;
      if (!m || !cos) return;
      const items = (m.items || []).filter(id => COS.has(id));
      const start = 13 - Math.floor(items.length / 2);
      items.forEach((id, i) => {
        const st = cosStack(id, false);
        if (!st) return;
        this.put(start + i + (items.length % 2 ? 0 : i >= items.length / 2 ? 1 : 0), st, [st.name, ...st.lore.slice(0, 2), '', '§eClick to take it!'], () => cos.take(m, id));
      });
      if (!items.length) { const st = stack('barrier'); if (st) this.put(13, st, ['§cEmpty for you', '§7You have taken everything in this chest.', '§7The others can still find it here.'], null); }
      const book = stack('book');
      if (book) this.put(49, book, ['§6Hidden Chests', '§7Found: §e' + (m.found | 0) + '§7 of §e' + (m.total | 0), '§7Cosmetics: §e' + cos.own.size + '§7 of §e' + COSMETICS.length], null);
    }
  }

  /* ---- the Backpack: pages of 45, things moved in and out as in any chest (cosmetics only) ---- */
  class BackpackMenu extends MenuScreen {
    constructor(cos) { super(cos.hub, 'Backpack'); this.cos = cos; this.page = 0; this.load(); }
    load() {
      const cos = this.cos, p = this.page;
      if (!cos) return;
      this.box.fill(null); this.tips.fill(null); this.acts.fill(null);
      cos.freeBackpack();
      for (let i = 0; i < PACK_PAGE; i++) { const id = cos.pack[p * PACK_PAGE + i]; this.box[i] = id && id !== 'backpack' ? cosStack(id, cos.isWorn(id)) : null; }
      this.bar();
    }
    store() {
      const cos = this.cos, p = this.page;
      for (let i = 0; i < PACK_PAGE; i++) { const st = this.box[i]; cos.pack[p * PACK_PAGE + i] = st && st.cos && st.cos !== 'backpack' ? st.cos : ''; }
    }
    bar() {
      const cos = this.cos, p = this.page;
      for (let i = PACK_PAGE; i < 54; i++) { const g = stack('black_stained_glass_pane'); if (g) { g.name = ' '; this.box[i] = g; } }
      const prev = stack('arrow'), next = stack('arrow'), info = stack('book');
      if (prev && p > 0) this.put(45, prev, ['§aPrevious Page', '§7Page ' + p], () => this.turn(-1));
      if (next && p < PACK_PAGES - 1) this.put(53, next, ['§aNext Page', '§7Page ' + (p + 2)], () => this.turn(1));
      if (info) this.put(49, info, ['§6Backpack §7(page ' + (p + 1) + ' of ' + PACK_PAGES + ')', '§7Keep the cosmetics you are not', '§7carrying here.', '', '§7Found: §e' + cos.own.size + '§7 of §e' + COSMETICS.length], null);
    }
    turn(d) { this.store(); this.page = Math.max(0, Math.min(PACK_PAGES - 1, this.page + d)); this.load(); }
    // (the menu's own refill after a click on the bar would wipe the page: the page is put back instead)
    fillBox() { if (this.cos) this.load(); }
    mouseClicked(mx, my, button) {
      const s = this.slotAt(mx, my);
      if (s && s.kind === 'box' && s.i >= PACK_PAGE) { if (this.acts[s.i]) { this.store(); this.acts[s.i](); } return true; }
      const out = ChestScreen.prototype.mouseClicked.call(this, mx, my, button);
      this.store(); this.cos.dirty = true;
      return out;
    }
    // (a stack carried onto a place lands on the release, so the page is taken down again then)
    mouseReleased(mx, my, button) { const out = ChestScreen.prototype.mouseReleased.call(this, mx, my, button); this.store(); this.cos.dirty = true; return out; }
    // (cosmetics only, and never the Backpack inside itself)
    mayPlace(s, st) { if (s.kind === 'box') return s.i < PACK_PAGE && !!(st && st.cos) && st.cos !== 'backpack'; return ChestScreen.prototype.mayPlace.call(this, s, st); }
    quickMove(s) {
      const st = this.getStack(s);
      if (!st) return;
      if (s.kind === 'box') { if (s.i < PACK_PAGE) ChestScreen.prototype.quickMove.call(this, s); }
      else if (st.cos && st.cos !== 'backpack') {
        // (into this page if it has room, else the first page that does)
        const i = this.box.findIndex((x, k) => k < PACK_PAGE && !x);
        if (i >= 0) { this.box[i] = st; this.setStack(s, null); }
        else {
          this.store();
          const cos = this.cos, at = cos.pack.findIndex((x, k) => !x && k < PACK_PAGE * PACK_PAGES);
          const j = at >= 0 ? at : cos.pack.length < PACK_PAGE * PACK_PAGES ? cos.pack.length : -1;
          if (j >= 0) { cos.pack[j] = st.cos; this.setStack(s, null); this.load(); this.cos.dirty = true; return; }
        }
      }
      this.store(); this.cos.dirty = true;
    }
    numberKey() {}
    throwFrom() {}
    onClose() { this.store(); this.cos.dirty = true; this.cos.save(true); super.onClose(); }
  }

  /* ---- the Collection (from the Profile): every cosmetic of a kind, the found ones as themselves, the rest unknown ---- */
  class CollectionMenu extends MenuScreen {
    constructor(cos, cat) { super(cos.hub, 'Lobby Collection'); this.cos = cos; this.cat = cat || 'hat'; this.box.fill(null); this.fillBox(); }
    fillBox() {
      const cos = this.cos;
      if (!cos) return;
      const list = COSMETICS.filter(c => c[1] === this.cat || (this.cat === 'gadget' && c[1] === 'special'));
      list.forEach((c, i) => {
        if (i >= 36) return;
        const id = c[0], rar = RARITY[c[3]] || RARITY.c;
        if (cos.own.has(id)) { const st = cosStack(id, cos.isWorn(id)); if (st) this.put(9 + i, st, [st.name, ...st.lore.slice(0, 2), '', '§aFound!'], null); }
        else { const st = stack('gray_dye'); if (st) { st.name = '§8???'; this.put(9 + i, st, ['§8???', rar[1] + rar[0] + ' ' + (CATS.find(q => q[0] === c[1]) || CATS[0])[1].replace(/s$/, ''), '', '§7Not found yet: it is hidden', '§7in a chest somewhere in the lobby.'], null); } }
      });
      const n = (cat) => COSMETICS.filter(c => (c[1] === cat || (cat === 'gadget' && c[1] === 'special')) && cos.own.has(c[0])).length;
      const all = (cat) => COSMETICS.filter(c => c[1] === cat || (cat === 'gadget' && c[1] === 'special')).length;
      [['hat', 'leather_helmet', 'Hats'], ['aura', 'blaze_powder', 'Auras'], ['trail', 'redstone', 'Trails'], ['gadget', 'carrot_on_a_stick', 'Gadgets']].forEach(([cat, icon, name], i) => {
        const st = stack(icon);
        if (!st) return;
        st.name = (cat === this.cat ? '§a' : '§7') + name;
        if (cat === this.cat) st.ench = { unbreaking: 1 };
        this.put(46 + i * 2, st, [st.name, '§7Found: §e' + n(cat) + '§7 of §e' + all(cat), '', cat === this.cat ? '§aShowing these' : '§eClick to see them!'], () => { this.cat = cat; });
      });
      const info = stack('book');
      if (info) this.put(4, info, ['§6Lobby Collection', '§7Found: §e' + cos.own.size + '§7 of §e' + COSMETICS.length, '§7Hidden chests: §e' + (cos.eggCount || '?'), '', '§7Look in the chests round the lobby:', '§7houses, towers, walls and the', '§7secret places in between.'], null);
    }
  }

  class LobbyCos {
    constructor(hub) {
      this.hub = hub;
      this.own = new Set(); this.wear = {}; this.layout = null; this.pack = []; this.loaded = false;
      this.worn = new Map();        // name -> what they wear (everyone else in the lobby)
      this.cd = {}; this.t = 0; this.dirty = false; this.savedSig = ''; this.saveAt = 0;
      this.mounts = new Map();      // name ('' for you) -> the mount drawn under them
      this.guards = new Map();      // name ('' for you) -> { ids, at: [[x, z]...], until }
      this.fx = [];                 // effects playing: { kind, ... , until }
      this.painted = new Map();     // "x,y,z" -> { b, m, until }
      this.meshes = [];             // thrown blocks drawn in the world
      this.inLobby = false;
    }
    get game() { return this.hub.game; }
    chat(s) { this.hub.ctx.chat.add(s, 0xFFFFFF); }
    say(s) { this.hub.titleT = { t: '', s, fi: 0, st: 30, fo: 8, at: performance.now() }; if (this.hub.overlay) this.hub.overlay.animates = true; }
    sound(n, x, y, z, v = 1, p = 1) { try { if (x === undefined) { const L = Sound.listener; Sound.play(n, L.x, L.y, L.z, v, p, 'player'); } else Sound.play(n, x, y, z, v, p, 'player'); } catch (e) { /* no sound yet */ } }
    get E() { return this.game.entities; }
    puff(kind, x, y, z, n, s, col) { const E = this.E; if (E && E.particles) E.particles(kind, x, y, z, n, s, col); }
    spark(kind, x, y, z, vx, vy, vz, col, life) { const E = this.E, P = E && E.particlesP; if (P && P.addV) P.addV(kind, x, y, z, vx, vy, vz, col, life); }
    total() { return COSMETICS.length; }
    collection(cat) { return new CollectionMenu(this, cat); }
    isWorn(id) { const w = this.wear; return !!id && (w.hat === id || w.aura === id || w.trail === id || w.mount === id || w.boots === id || w.moon === id || w.speed === id || w.glow === id || w.guards === id); }

    /* ---- what the server says ---- */
    receive(m) {
      switch (m.k) {
        case 'cos': {
          const had = new Set(this.own);
          this.own = new Set((m.own || []).filter(id => COS.has(id)));
          this.wear = m.wear && typeof m.wear === 'object' ? m.wear : {};
          if (Array.isArray(m.inv)) this.layout = m.inv.slice(0, 36);
          if (Array.isArray(m.pack)) this.pack = m.pack.slice(0, PACK_PAGE * PACK_PAGES);
          this.loaded = true;
          if (m.eggs) this.eggCount = m.eggs | 0;
          // something new: into the inventory now (or the Backpack), where it stays
          const fresh = [...this.own].filter(id => !had.has(id));
          if (this.hub.area === 'lobby' && had.size + fresh.length === this.own.size && fresh.length && m.got) this.place(m.got);
          if (m.got) this.found(m.got);
          this.markWorn();
          return true;
        }
        case 'worn': {
          if (m.all && typeof m.all === 'object') { this.worn.clear(); for (const n in m.all) this.worn.set(n, m.all[n] || {}); }
          else if (typeof m.who === 'string') { if (m.w) this.worn.set(m.who, m.w); else this.worn.delete(m.who); }
          return true;
        }
        case 'egg': {
          const S = this.hub.ctx.gui.screen;
          if (S instanceof EggMenu && S.m && S.m.x === m.x && S.m.y === m.y && S.m.z === m.z) { S.m = m; S.box.fill(null); S.tips.fill(null); S.acts.fill(null); S.fillBox(); return true; }
          if (!m.egg) { this.say('§7Nothing in here.'); return true; }
          this.hub.openScreen(new EggMenu(this, m));
          this.sound('block.chest.open');
          return true;
        }
        case 'gfx': this.play(m, false); return true;
        // something another player's gadget did to you: knocked back, frozen
        case 'gadhit': this.hitBy(m); return true;
      }
      return false;
    }

    /* ---- the lobby's inventory ---- */
    keyOf(st) {
      if (!st) return '';
      if (st.cos) return 'c:' + st.cos;
      const n = st.name ? st.name.replace(/§./g, '') : '';
      if (st.id === idOf('compass')) return 'compass';
      if (st.id === idOf('player_head') || /^Profile/.test(n)) return 'profile';
      if (st.id === idOf('white_wool') || st.id === idOf('yellow_wool') || st.id === idOf('red_wool')) return 'temp';
      return '';
    }
    // give the lobby kit back as it was kept: the fixed things and every cosmetic in its place
    lobbyKit(inv, fixed) {
      const slots = new Array(36).fill(null), placed = new Set(), lay = this.layout;
      if (lay) lay.forEach((k, i) => {
        if (!k || i >= 36) return;
        if (fixed[k] && !placed.has(k)) { slots[i] = fixed[k]; placed.add(k); return; }
        const id = k.startsWith('c:') ? k.slice(2) : '';
        if (id && this.own.has(id) && !placed.has(k)) { slots[i] = cosStack(id, this.isWorn(id)); placed.add(k); }
      });
      // the fixed things not placed go where they always were, or the first free place
      FIXED.forEach((k, i) => { if (!placed.has(k) && fixed[k]) { const at = !slots[i] ? i : slots.findIndex(x => !x); if (at >= 0) slots[at] = fixed[k]; placed.add(k); } });
      // the Backpack goes in the hotbar's last place by default (never inside itself: one put there before that was
      // refused comes out, in place of a cosmetic that goes into the Backpack if the inventory is full)
      this.pack = this.pack.map(id => (id === 'backpack' ? '' : id));
      const inPack = new Set(this.pack.filter(Boolean));
      if (this.own.has('backpack') && !placed.has('c:backpack')) {
        const at = this.backpackSpot(slots);
        if (at >= 0) {
          const old = slots[at];
          if (old && old.cos) { placed.delete('c:' + old.cos); this.toPack(old.cos); inPack.add(old.cos); }
          slots[at] = cosStack('backpack'); placed.add('c:backpack');
        }
      }
      // anything owned and nowhere: the first free place, else the Backpack
      for (const c of COSMETICS) {
        const id = c[0], k = 'c:' + id;
        if (!this.own.has(id) || placed.has(k) || inPack.has(id)) continue;
        const at = slots.findIndex(x => !x);
        if (at >= 0) { slots[at] = cosStack(id, this.isWorn(id)); placed.add(k); } else if (this.own.has('backpack')) this.toPack(id);
      }
      for (let i = 0; i < 36; i++) inv.slots[i] = slots[i];
      // the Backpack only holds what is owned and not carried
      this.pack = this.pack.map(id => (id && this.own.has(id) && !placed.has('c:' + id) ? id : ''));
      this.savedSig = this.sig(inv);
    }
    /* A cosmetic copied by a move before items.js withCount kept its id (taking one out of the Backpack did that) is
       a plain item with the cosmetic's name that does nothing: made the cosmetic again, or taken away if the real one
       is somewhere else too */
    repair() {
      const inv = this.game.inv;
      if (!BY_NAME) { BY_NAME = new Map(); for (const c of COSMETICS) { const st = cosStack(c[0], false); if (st) BY_NAME.set(st.name, c[0]); } }
      let ch = false;
      const has = id => inv.slots.some(x => x && x.cos === id) || this.pack.includes(id);
      for (let i = 0; i < 36; i++) {
        const s = inv.slots[i];
        if (!s || s.cos || !s.name) continue;
        const id = BY_NAME.get(s.name);
        if (!id) continue;
        inv.slots[i] = this.own.has(id) && !has(id) ? cosStack(id, this.isWorn(id)) : null;
        ch = true;
      }
      if (ch) { inv.changed(); this.dirty = true; }
      if (this.loaded && this.hub.area === 'lobby' && this.freeBackpack()) ch = true;
      return ch;
    }
    toPack(id) { const i = this.pack.findIndex(x => !x); if (i >= 0) this.pack[i] = id; else if (this.pack.length < PACK_PAGE * PACK_PAGES) this.pack.push(id); }
    // where the Backpack goes: the hotbar's last place if free, else the first free place, else in place of a
    // cosmetic (that last place first, then from the inventory's end), -1 if there is none
    backpackSpot(slots) {
      if (!slots[8]) return 8;
      const free = slots.findIndex((x, i) => i < 36 && !x);
      if (free >= 0) return free;
      if (slots[8] && slots[8].cos) return 8;
      for (let i = 35; i >= 0; i--) if (slots[i] && slots[i].cos) return i;
      return -1;
    }
    /* The Backpack inside the Backpack (it could be put there before that was refused, and then could not be opened):
       taken out into the inventory, a cosmetic going into the Backpack in its place if the inventory is full */
    freeBackpack() {
      const bi = this.pack.indexOf('backpack');
      if (bi < 0) return false;
      while (this.pack.indexOf('backpack') >= 0) this.pack[this.pack.indexOf('backpack')] = '';
      const inv = this.game.inv;
      if (this.own.has('backpack') && !inv.slots.some(x => x && x.cos === 'backpack')) {
        const at = this.backpackSpot(inv.slots);
        if (at >= 0) { const old = inv.slots[at]; if (old && old.cos) this.toPack(old.cos); inv.slots[at] = cosStack('backpack'); inv.changed(); }
      }
      this.dirty = true;
      return true;
    }
    // a cosmetic just found: into the first free place, else the Backpack
    place(id) {
      const inv = this.game.inv;
      if (inv.slots.some(s => s && s.cos === id) || this.pack.includes(id)) return;
      if (id === 'backpack') {
        if (!inv.slots[8]) inv.slots[8] = cosStack(id);
        else { const old = inv.slots[8]; const at = inv.slots.findIndex((x, i) => i > 8 && !x); if (at >= 0) inv.slots[at] = old; else if (old.cos) this.toPack(old.cos); inv.slots[8] = cosStack(id); }
      } else {
        const at = inv.slots.findIndex(x => !x);
        if (at >= 0) inv.slots[at] = cosStack(id, this.isWorn(id)); else this.toPack(id);
      }
      inv.changed(); this.dirty = true;
    }
    room() { return this.game.inv.slots.some(x => !x) || this.own.has('backpack'); }
    sig(inv) { return inv.slots.map(s => this.keyOf(s)).join('|') + '#' + this.pack.join('|'); }
    // where everything is, sent a little after the last change (and at once when the Backpack closes)
    save(now) {
      if (!this.loaded || this.hub.area !== 'lobby') return;
      const inv = this.game.inv, s = this.sig(inv);
      if (s === this.savedSig) { this.dirty = false; return; }
      if (!now && this.t < this.saveAt) return;
      this.savedSig = s; this.dirty = false;
      this.hub.send({ k: 'cosinv', inv: inv.slots.map(x => this.keyOf(x)), pack: this.pack.slice() });
    }
    // the glint and "Wearing" line on what you wear, wherever it is
    markWorn() {
      if (this.hub.area !== 'lobby') return;
      const inv = this.game.inv;
      let ch = false;
      for (let i = 0; i < 36; i++) {
        const s = inv.slots[i];
        if (!s || !s.cos) continue;
        const w = this.isWorn(s.cos);
        if (!!s.ench !== w) { inv.slots[i] = cosStack(s.cos, w); ch = true; }
      }
      if (ch) inv.changed();
    }

    /* ---- a right click ---- */
    // a chest in the lobby: is it a hidden one?
    useTarget() {
      const T = this.game.inter.target;
      if (!T) return false;
      const d = BLOCKS[this.game.world.get(T.x, T.y, T.z)];
      if (!d || !/^(chest|trapped_chest|barrel|ender_chest)$/.test(d.name)) return false;
      this.hub.send({ k: 'cosegg', x: T.x, y: T.y, z: T.z });
      return true;
    }
    take(m, id) {
      if (!this.room() && id !== 'backpack') { this.say('§cYour inventory is full!'); this.chat('§cYour inventory is full! §7The §6Backpack §7is hidden somewhere in the lobby: find it to carry more.'); return; }
      this.hub.send({ k: 'costake', x: m.x, y: m.y, z: m.z, id });
    }
    found(id) {
      const c = COS.get(id);
      if (!c) return;
      const rar = RARITY[c.rarity] || RARITY.c;
      this.hub.titleT = { t: '§6§lFOUND!', s: rar[1] + c.name, fi: 5, st: 40, fo: 10, at: performance.now() };
      if (this.hub.overlay) this.hub.overlay.animates = true;
      this.chat('§6§lFOUND! §r' + rar[1] + c.name + ' §7(' + rar[0] + ') §8- §e' + this.own.size + '§7/§e' + COSMETICS.length + ' §7cosmetics' + (c.cat === 'special' ? '' : '. §eRight Click it to ' + (c.cat === 'gadget' ? 'use it!' : 'wear it!')));
      this.sound('entity.player.levelup', undefined, undefined, undefined, 0.8, 1.2);
      const P = this.game.player;
      this.puff('sparkle', P.pos.x, P.pos.y + 1, P.pos.z, 20, 0.6, [1, 0.85, 0.3]);
    }
    // a cosmetic in the hand
    use(st) {
      const id = st.cos, c = COS.get(id);
      if (!c || !this.own.has(id) || !this.inLobby) return true;
      // one press, one use: the game repeats a held right click every four ticks, which put a hat on and took it off again
      // in a single press (only what is meant to be held, the Jetpack and the Bubble Blower, goes on with the button)
      const G = GADGETS[id], n = this.hub.pressN | 0;
      if (!(G && G.hold)) { if (n === this.usedPress && this.game.inter.useHeld) return true; this.usedPress = n; }
      if (c.cat === 'special') { this.hub.openScreen(new BackpackMenu(this)); this.sound('item.armor.equip_leather'); return true; }
      if (c.cat === 'hat' || c.cat === 'aura' || c.cat === 'trail') { this.setWear(c.cat, this.wear[c.cat] === id ? null : id); return true; }
      this.gadget(id);
      return true;
    }
    setWear(slot, id) {
      this.wear = Object.assign({}, this.wear, { [slot]: id || null });
      if (!id) delete this.wear[slot];
      this.hub.send({ k: 'coswear', slot, id: id || null });
      const c = id && COS.get(id);
      if (c && (slot === 'hat' || slot === 'aura' || slot === 'trail')) this.say('§aYou are wearing ' + (RARITY[c.rarity] || RARITY.c)[1] + c.name);
      else if (!id && (slot === 'hat' || slot === 'aura' || slot === 'trail')) this.say('§7Taken off.');
      this.sound(id ? 'item.armor.equip_generic' : 'item.armor.equip_leather');
      this.markWorn();
    }

    /* ---- gadgets ---- */
    gadget(id) {
      const G = GADGETS[id];
      // (a gadget is the lobby's only: nothing of one may reach a game, however it was called)
      if (!G || !this.inLobby) return;
      if (id === 'gad_grapple') { this.grapple(); return; }
      const t = this.t, held = !!G.hold;
      if (!held && (this.cd[id] || 0) > t) { const s = Math.ceil((this.cd[id] - t) / 20); this.say('§cYou can use this again in ' + s + ' second' + (s === 1 ? '' : 's')); return; }
      this.cd[id] = t + (G.cd || 0);
      const P = this.game.player, eye = { x: P.pos.x, y: P.pos.y + 1.62, z: P.pos.z };
      const dx = -Math.sin(P.yaw) * Math.cos(P.pitch), dy = Math.sin(P.pitch), dz = -Math.cos(P.yaw) * Math.cos(P.pitch);
      const look = [r3(dx), r3(dy), r3(dz)], at = [r3(eye.x), r3(eye.y), r3(eye.z)];
      const send = o => this.hub.send(Object.assign({ k: 'cosgad', id }, o));
      if (G.toggle) {
        const on = this.wear[G.toggle] !== id;
        this.setWear(G.toggle, on ? id : null);
        const c = COS.get(id);
        this.say((on ? '§a' : '§7') + c.name + (on ? ' on' : ' off'));
        if (G.toggle === 'guards' && on) this.guardsUntil = t + (G.time || 1200);
        return;
      }
      const w = this.game.world;
      switch (id) {
        case 'gad_cannon': {
          P.vel.x = dx * 2.4; P.vel.y = Math.max(0.6, dy * 2.4 + 0.5); P.vel.z = dz * 2.4; P.onGround = false;
          this.play({ id, at }, true); send({ at });
          return;
        }
        case 'gad_rocket': {
          P.vel.y = 2.4; P.vel.x *= 0.3; P.vel.z *= 0.3; P.onGround = false;
          this.slowFallAt = t + 22;
          this.play({ id, at }, true); send({ at });
          return;
        }
        case 'gad_wand': {
          this.floatUntil = t + 30;
          this.play({ id, at, look }, true); send({ at, look });
          return;
        }
        case 'gad_blink': {
          let best = null;
          for (let s = 8; s >= 1; s -= 0.5) {
            const x = P.pos.x + -Math.sin(P.yaw) * s, z = P.pos.z + -Math.cos(P.yaw) * s, y = P.pos.y;
            if (this.free(x, y, z) && !rayHit(w, eye.x, eye.y, eye.z, -Math.sin(P.yaw), 0, -Math.cos(P.yaw), s)) { best = [x, y, z]; break; }
          }
          if (!best) { this.say('§cNo room ahead.'); this.cd[id] = t + 4; return; }
          const from = [r3(P.pos.x), r3(P.pos.y), r3(P.pos.z)];
          P.pos.x = best[0]; P.pos.z = best[2]; if (P.prev) { P.prev.x = P.pos.x; P.prev.z = P.pos.z; }
          const to = best.map(r3);
          this.play({ id, from, to }, true); send({ from, to });
          return;
        }
        case 'gad_jetpack': {
          this.jetUntil = t + 6;
          return;
        }
        case 'gad_bubble': {
          if ((this.cd.bub || 0) > t) return;
          this.cd.bub = t + 3;
          this.play({ id, at, look }, true); send({ at, look });
          return;
        }
        case 'gad_smoke': case 'gad_cloak': {
          const sv = this.game.survival;
          sv.addEffect('invisibility', 1, id === 'gad_smoke' ? 60 : 160, { ambient: true });
          this.play({ id, at: [r3(P.pos.x), r3(P.pos.y), r3(P.pos.z)] }, true); send({ at: [r3(P.pos.x), r3(P.pos.y), r3(P.pos.z)] });
          return;
        }
        case 'gad_lightning': case 'gad_paintball': case 'gad_freeze': {
          const max = id === 'gad_freeze' ? 30 : 60, h = rayHit(w, eye.x, eye.y, eye.z, dx, dy, dz, max);
          let lim = h ? h.t : max, who = null;
          if (id === 'gad_freeze') for (const [n, r] of this.others()) {
            const f = r.feet, tt = rayBox(eye.x, eye.y, eye.z, dx, dy, dz, f.x - 0.4, f.y, f.z - 0.4, f.x + 0.4, f.y + 1.9, f.z + 0.4);
            if (tt < lim) { lim = tt; who = n; }
          }
          if (!h && id !== 'gad_freeze') { this.say('§cAim at a block.'); this.cd[id] = t + 4; return; }
          const to = [r3(eye.x + dx * lim), r3(eye.y + dy * lim), r3(eye.z + dz * lim)], o = { from: at, to, c: (R() * 8) | 0 };
          if (h) o.b = [h.x, h.y, h.z];
          if (who) o.hit = who;
          this.play(Object.assign({ id }, o), true); send(o);
          return;
        }
        case 'gad_snowball': case 'gad_tnt': case 'gad_pearl': case 'gad_melon': case 'gad_water': case 'gad_chicken': {
          const sp = id === 'gad_snowball' ? 1.6 : id === 'gad_pearl' ? 1.5 : 1.0;
          const o = { from: [r3(eye.x + dx * 0.6), r3(eye.y + dy * 0.6 - 0.1), r3(eye.z + dz * 0.6)], v: [r3(dx * sp + P.vel.x * 0.5), r3(dy * sp + 0.1), r3(dz * sp + P.vel.z * 0.5)] };
          this.play(Object.assign({ id }, o), true); send(o);
          this.sound(id === 'gad_pearl' ? 'entity.ender_pearl.throw' : 'entity.snowball.throw', eye.x, eye.y, eye.z, 0.6, 0.6);
          return;
        }
        case 'gad_trampoline': {
          send({ at: [Math.floor(P.pos.x), Math.floor(P.pos.y - 0.2), Math.floor(P.pos.z)] });
          return;
        }
        default: {
          // the bursts: where you stand (or a little over it)
          const o = { at: [r3(P.pos.x), r3(P.pos.y), r3(P.pos.z)], look, c: (R() * 6) | 0 };
          this.play(Object.assign({ id }, o), true); send(o);
        }
      }
    }
    free(x, y, z) {
      const w = this.game.world;
      for (let yy = Math.floor(y); yy <= Math.floor(y + 1.79); yy++) for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { const b = w.get(Math.floor(x + ox), yy, Math.floor(z + oz)); if (b && SOLID[b]) return false; }
      return true;
    }
    // the other players in the lobby you can see: [name, remote player]
    *others() {
      const L = this.hub.net && this.hub.net.players;
      if (!L) return;
      for (const r of L.list.values()) if (r.name && r.feet && r.st && !(r.st.f & (F.DEAD | F.SPEC))) yield [r.name, r];
    }
    feetOf(name) {
      if (!name || name === this.myName()) { const P = this.game.player; return P.pos; }
      for (const [n, r] of this.others()) if (n === name) return r.feet;
      return null;
    }
    myName() { return this.hub.ctx.account && this.hub.ctx.account.name || ''; }
    // something another player's gadget did to you
    hitBy(m) {
      if (this.hub.area !== 'lobby') return;
      const P = this.game.player, d = Array.isArray(m.dir) ? m.dir : [0, 0, 0];
      if (m.id === 'gad_snowball' || m.id === 'gad_tnt') { P.vel.x += +d[0] || 0; P.vel.y = Math.max(P.vel.y, (+d[1] || 0) + 0.25); P.vel.z += +d[2] || 0; P.onGround = false; }
      if (m.id === 'gad_freeze') { this.game.survival.addEffect('slowness', 3, 60, { ambient: true }); this.frozenUntil = this.t + 60; this.say('§bYou were frozen by §f' + (m.by || 'someone') + '§b!'); }
    }

    /* The Grappling Hook, as Hypixel's: a right click casts the line (the game's own bobber, which the others see on the
       end of your rod), the next reels it in, and a hook that landed on a block flings you there in an arc, across
       towards it and always up, harder the further it is, worked out from the game's own drag and gravity so you come
       down where the hook was. A hook still in the air, in water or on someone only comes back. Two seconds between
       pulls. */
    grapple() {
      const E = this.E, P = this.game.player, id = 'gad_grapple', t = this.t, b = E && E.bobber;
      if (!E || !P) return;
      if (b && !b.removed) {
        const landed = b.stuckBlock && !b.hooked, bx = b.pos.x, by = b.pos.y, bz = b.pos.z;
        b.gone(); E.bobber = null;
        this.sound('entity.fishing_bobber.retrieve', P.pos.x, P.pos.y, P.pos.z, 1, 0.9 + R() * 0.2);
        if (!landed) return;
        const dx = bx - P.pos.x, dy = by - P.pos.y, dz = bz - P.pos.z, d = Math.hypot(dx, dy, dz), h = Math.hypot(dx, dz);
        // in the air for longer the further it is (so the arc rises with the distance); up and down a tick is
        // (v - 0.08) * 0.98, which rises (v + 3.92)(1 - 0.98^n) / 0.02 - 3.92 n in n ticks; across a tick keeps 0.91,
        // and what is left at the landing slides on about 2.2 times as far
        const n = Math.max(6, Math.min(30, Math.round(4 + d * 0.75)));
        const vy = (dy + 0.25 + 3.92 * n) * 0.02 / (1 - Math.pow(0.98, n)) - 3.92;
        const vh = h / ((1 - Math.pow(0.91, n)) / 0.09 + 2.2 * Math.pow(0.91, n));
        P.vel.x = h > 1e-6 ? dx / h * Math.min(3.5, vh) : 0; P.vel.z = h > 1e-6 ? dz / h * Math.min(3.5, vh) : 0;
        P.vel.y = Math.max(0.1, Math.min(2.5, vy));
        P.onGround = false; P.fallDistance = 0;
        this.cd[id] = t + 40;
        const to = [r3(bx), r3(by), r3(bz)];
        this.puff('poof', bx, by, bz, 6, 0.2);
        this.hub.send({ k: 'cosgad', id, to });
        return;
      }
      if ((this.cd[id] || 0) > t) { const s = Math.ceil((this.cd[id] - t) / 20); this.say('§cYou can use this again in ' + s + ' second' + (s === 1 ? '' : 's')); return; }
      const eye = { x: P.pos.x, y: P.pos.y + 1.62, z: P.pos.z };
      const dx = -Math.sin(P.yaw) * Math.cos(P.pitch), dy = Math.sin(P.pitch), dz = -Math.cos(P.yaw) * Math.cos(P.pitch);
      const e = E.spawn('fishing_bobber', eye.x, eye.y - 0.1, eye.z, { natural: false });
      if (!e) return;
      // (it goes past people: the hook is for blocks)
      e.owner = E.player; e.grapple = true;
      e.shoot(dx, dy, dz, 1.1 + R() * 0.2, 1);
      e.vel.x += P.vel.x; e.vel.z += P.vel.z; if (!P.onGround) e.vel.y += P.vel.y;
      E.bobber = e;
      this.sound('entity.fishing_bobber.throw', P.pos.x, P.pos.y, P.pos.z, 0.5, 0.4 / (R() * 0.4 + 0.8));
    }

    /* ---- what a gadget looks like, on every page (mine: true on the page that used it) ---- */
    play(m, mine) {
      if (!this.inLobby) return;
      const id = m.id, E = this.E, w = this.game.world;
      const v3 = a => (Array.isArray(a) && a.length === 3 ? [+a[0] || 0, +a[1] || 0, +a[2] || 0] : null);
      const at = v3(m.at), from = v3(m.from), to = v3(m.to), look = v3(m.look) || [0, 0, -1];
      const line = (a, b, kind, step, col) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.min(120, Math.ceil(d / step)); for (let i = 0; i <= n; i++) { const f = i / n; this.puff(kind, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, 1, 0.02, col); } };
      switch (id) {
        // (the line and the hook are the game's bobber, seen as any rod's: here only the pull)
        case 'gad_grapple': if (to) { this.puff('poof', to[0], to[1], to[2], 6, 0.2); const o = this.feetOf(m.who); if (o) this.sound('entity.fishing_bobber.retrieve', o.x, o.y, o.z, 1, 1); } break;
        case 'gad_cannon': if (at) { this.puff('explosion', at[0], at[1] - 1, at[2], 3, 0.6); this.puff('large_smoke', at[0], at[1] - 1, at[2], 12, 0.7); this.sound('entity.generic.explode', at[0], at[1], at[2], 0.7, 1.4); this.follow(m.who, 'smoke', 30, [0.6, 0.6, 0.6]); } break;
        case 'gad_rocket': if (at) { this.puff('large_smoke', at[0], at[1] - 1.4, at[2], 14, 0.6); this.sound('entity.firework_rocket.launch', at[0], at[1], at[2], 1.2, 0.8); this.follow(m.who, 'sparkle', 26, [1, 0.8, 0.4]); this.fx.push({ kind: 'burstAt', who: m.who, t: this.t + 24, until: this.t + 25 }); } break;
        case 'gad_wand': if (at) { for (let i = 0; i < 40; i++) this.spark('sparkle', at[0] + look[0], at[1] + look[1], at[2] + look[2], look[0] * 0.6 + (R() - 0.5) * 0.3, look[1] * 0.6 + (R() - 0.3) * 0.3, look[2] * 0.6 + (R() - 0.5) * 0.3, colour('confetti'), 20 + R() * 10); this.follow(m.who, 'glowdust', 30, [0.8, 0.6, 1]); this.sound('entity.illusioner.cast_spell', at[0], at[1], at[2], 0.8, 1.4); } break;
        case 'gad_blink': if (from && to) { this.puff('portal', from[0], from[1] + 1, from[2], 30, 0.5); this.puff('portal', to[0], to[1] + 1, to[2], 30, 0.5); this.sound('entity.enderman.teleport', to[0], to[1], to[2], 1, 1); } break;
        case 'gad_bubble': if (at) { for (let i = 0; i < 8; i++) this.spark('airbubble', at[0] + look[0] * 0.8, at[1] - 0.2 + look[1] * 0.8, at[2] + look[2] * 0.8, look[0] * 0.25 + (R() - 0.5) * 0.12, look[1] * 0.25 + 0.03 + (R() - 0.5) * 0.08, look[2] * 0.25 + (R() - 0.5) * 0.12, undefined, 40 + R() * 30); if (R() < 0.3) this.sound('block.bubble_column.bubble_pop', at[0], at[1], at[2], 0.6, 1.2); } break;
        case 'gad_smoke': if (at) { this.puff('large_smoke', at[0], at[1] + 1, at[2], 40, 1.2); this.puff('smoke', at[0], at[1] + 0.5, at[2], 30, 1.2); this.sound('entity.generic.extinguish_fire', at[0], at[1], at[2], 1, 0.7); } break;
        case 'gad_cloak': if (at) { this.puff('poof', at[0], at[1] + 1, at[2], 20, 0.5); this.puff('portal', at[0], at[1] + 1, at[2], 20, 0.5); this.sound('entity.illusioner.mirror_move', at[0], at[1], at[2], 1, 1); } break;
        case 'gad_lightning': if (to) {
          const S = this.game.sim, W = S && S.weather;
          if (W && W.fx && W.fx.bolt) { try { W.fx.bolt(to[0], to[1], to[2]); W.flash = 2; } catch (e) { /* no bolt here */ } }
          this.puff('explosion', to[0], to[1] + 0.5, to[2], 2, 0.3); this.puff('crit', to[0], to[1] + 0.5, to[2], 30, 1, [0.6, 0.8, 1]);
          this.sound('entity.lightning_bolt.thunder', to[0], to[1], to[2], 3, 1); this.sound('entity.lightning_bolt.impact', to[0], to[1], to[2], 1, 1);
        } break;
        case 'gad_paintball': if (from && to) {
          line(from, to, 'glowdust', 0.6, HUES[(m.c | 0) % HUES.length]);
          this.paint(to, m.c | 0);
          this.sound('entity.slime.squish', to[0], to[1], to[2], 1, 1.5);
        } break;
        case 'gad_freeze': if (from && to) {
          line(from, to, 'sparkle', 0.3, [0.6, 0.85, 1]);
          this.puff('snowflake', to[0], to[1], to[2], 20, 0.5);
          this.sound('block.glass.break', to[0], to[1], to[2], 0.8, 1.6);
          if (m.hit) { const f = this.feetOf(m.hit); if (f) this.follow(m.hit, 'snowflake', 60, [0.8, 0.95, 1]); }
        } break;
        case 'gad_snowball': case 'gad_tnt': case 'gad_pearl': case 'gad_melon': case 'gad_water': case 'gad_chicken': {
          const v = v3(m.v);
          if (from && v) this.throwIt(id, from, v, m.who, mine);
          break;
        }
        case 'gad_firework': if (at) this.fx.push({ kind: 'firework', x: at[0], y: at[1] + 1, z: at[2], t0: this.t, until: this.t + 40, c: (R() * 8) | 0 }); this.sound('entity.firework_rocket.launch', at ? at[0] : 0, at ? at[1] : 0, at ? at[2] : 0, 1.5, 1); break;
        case 'gad_popper': if (at) { for (let i = 0; i < 70; i++) this.spark('glowdust', at[0], at[1] + 1.6, at[2], (R() - 0.5) * 0.5, 0.25 + R() * 0.35, (R() - 0.5) * 0.5, colour('confetti'), 30 + R() * 20); this.sound('entity.firework_rocket.twinkle', at[0], at[1], at[2], 1.5, 1.4); } break;
        case 'gad_disco': if (at) { this.fx.push({ kind: 'disco', x: at[0], y: at[1] + 3.2, z: at[2], t0: this.t, until: this.t + 300 }); this.stream('music_disc.creator_music_box', at, 300); } break;
        case 'gad_jukebox': if (at) { const songs = ['cat', 'chirp', 'far', 'blocks', 'creator', 'lava_chicken']; const s = songs[(m.c | 0) % songs.length] || 'cat'; this.stream('music_disc.' + s, at, 600); this.fx.push({ kind: 'notes', who: m.who, until: this.t + 600 }); } break;
        case 'gad_trampoline': if (at) { this.puff('slime', at[0] + 0.5, at[1] + 1.2, at[2] + 0.5, 30, 1.2); this.sound('block.slime_block.place', at[0], at[1], at[2], 1, 1); } break;
      }
    }
    // a song from a spot, stopped after a while
    stream(ev, at, ticks) {
      try {
        const v = Sound.stream && Sound.stream(ev, 'record', { at: [at[0], at[1] + 1, at[2]], volume: 3 });
        if (v) this.fx.push({ kind: 'voice', v, until: this.t + ticks });
      } catch (e) { /* no sound yet */ }
    }
    // particles following a player for a while (a rocket's sparks, a frozen player's frost)
    follow(who, kind, ticks, col) { this.fx.push({ kind: 'follow', who: who || '', p: kind, col, until: this.t + ticks }); }
    // a thrown thing: worked out the same on every page from where it started
    throwIt(id, from, v, who, mine) {
      const o = { kind: 'throw', id, p: from.slice(), v: v.slice(), who: who || '', mine, until: this.t + 80, age: 0 };
      if (id === 'gad_tnt' || id === 'gad_melon') o.mesh = this.blockMesh(id === 'gad_tnt' ? 'tnt' : 'melon');
      this.fx.push(o);
    }
    blockMesh(name) {
      const R2 = this.hub.ctx.renderer, d = BLOCKS[B[name]];
      if (!d) return null;
      try {
        const geo = blockGeometry(d, 0), mesh = new THREE.Mesh(geo.geometry, geo.cutout ? R2.mats.cutout : R2.mats.opaque);
        mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
        this.hub.group.add(mesh);
        this.meshes.push(mesh);
        return mesh;
      } catch (e) { return null; }
    }
    dropMesh(mesh) { if (!mesh) return; this.hub.group.remove(mesh); mesh.geometry.dispose(); const i = this.meshes.indexOf(mesh); if (i >= 0) this.meshes.splice(i, 1); }
    // a paintball's splat: the full blocks round where it hit turn a colour for five seconds, on this page only
    paint(to, c) {
      const w = this.game.world, net = this.hub.net, wool = ['red_wool', 'orange_wool', 'yellow_wool', 'lime_wool', 'light_blue_wool', 'blue_wool', 'purple_wool', 'pink_wool'];
      const id = B[wool[c % wool.length]], cx = Math.floor(to[0]), cy = Math.floor(to[1]), cz = Math.floor(to[2]);
      for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) for (let z = cz - 2; z <= cz + 2; z++) {
        if ((x - to[0] + 0.5) ** 2 + (y - to[1] + 0.5) ** 2 + (z - to[2] + 0.5) ** 2 > 5.5) continue;
        const b = w.get(x, y, z), d = BLOCKS[b];
        if (!d || d.shape !== 'cube' || !SOLID[b] || d.pass !== 'opaque' || /chest|barrel/.test(d.name)) continue;
        // (a block already painted keeps what it really was)
        const k = x + ',' + y + ',' + z, had = this.painted.get(k);
        this.painted.set(k, { b: had ? had.b : b, m: had ? had.m : w.meta(x, y, z), until: this.t + 100, id });
        const was = net.applying; net.applying = true;
        try { w.set(x, y, z, id, 0); } finally { net.applying = was; }
      }
    }
    unpaint(all) {
      const w = this.game.world, net = this.hub.net;
      for (const [k, p] of this.painted) {
        if (!all && p.until > this.t) continue;
        this.painted.delete(k);
        const q = k.split(',').map(Number);
        if (w.get(q[0], q[1], q[2]) !== p.id) continue;
        const was = net.applying; net.applying = true;
        try { w.set(q[0], q[1], q[2], p.b, p.m); } finally { net.applying = was; }
      }
    }

    /* ---- every tick in the lobby ---- */
    areaChanged(area) {
      const was = this.inLobby;
      this.inLobby = area === 'lobby';
      if (was && !this.inLobby) this.leaveLobby();
    }
    leaveLobby() {
      for (const k of [...this.mounts.keys()]) this.dropMount(k);
      for (const k of [...this.guards.keys()]) this.dropGuards(k);
      for (const f of this.fx) { if (f.kind === 'voice') { try { Sound.stop(f.v); } catch (e) { /* gone */ } } if (f.mesh) this.dropMesh(f.mesh); }
      this.fx.length = 0;
      this.unpaint(true);
      const A = this.hub.ctx.renderer && this.hub.ctx.renderer.avatar;
      if (A && A.setHat) A.setHat(null);
      const L = this.hub.net && this.hub.net.players;
      if (L) for (const r of L.list.values()) if (r.av && r.av.setHat) r.av.setHat(null);
      const P = this.game && this.game.player;
      if (P) P.gravityScale = 1;
      // (a gadget's lift or slow fall still to come stays in the lobby)
      this.slowFallAt = 0; this.jetUntil = 0; this.floatUntil = 0;
    }
    tick() {
      this.t++;
      if (!this.inLobby) return;
      const g = this.game, P = g.player, inv = g.inv, sv = g.survival, t = this.t;
      // cosmetics stay out of the armour slots (the boots worn are the plain gold ones put there)
      let moved = false;
      for (let i = 0; i < 4; i++) { const a = inv.armor[i]; if (a && a.cos) { inv.armor[i] = null; const at = inv.slots.findIndex(x => !x); if (at >= 0) inv.slots[at] = a; else this.toPack(a.cos); moved = true; } }
      const wantBoots = this.wear.boots === 'gad_boots';
      const hasBoots = inv.armor[3] && inv.armor[3].cosBoots;
      if (wantBoots && !hasBoots) { const b = stack('golden_boots', 1, { name: '§6Double Jump Boots' }); if (b) { b.cosBoots = true; inv.armor[3] = b; moved = true; } }
      else if (!wantBoots && hasBoots) { inv.armor[3] = null; moved = true; }
      if (moved) inv.changed();
      if (t % 20 === 0) this.repair();
      // (the save of where things are: two seconds after the last change)
      const sig = this.sig(inv);
      if (sig !== this.savedSig) { if (!this.dirty) { this.dirty = true; this.saveAt = t + 40; } else if (t >= this.saveAt) this.save(false); }
      // the Double Jump Boots: space again in the air, once until you land
      if (wantBoots) {
        const down = !!P.keys[' '], pressed = down && !this.jumpHeld;
        if (P.onGround) this.airJump = true;
        if (pressed && !P.onGround && !P.flying && this.airJump && P.vel.y < 0.3) {
          this.airJump = false;
          P.vel.y = 0.72; P.vel.x += -Math.sin(P.yaw) * 0.35; P.vel.z += -Math.cos(P.yaw) * 0.35; P.fallDistance = 0;
          this.puff('poof', P.pos.x, P.pos.y, P.pos.z, 10, 0.3);
          this.sound('entity.bat.takeoff', undefined, undefined, undefined, 0.6, 1.2);
          this.hub.send({ k: 'cosgad', id: 'gad_boots', at: [r3(P.pos.x), r3(P.pos.y), r3(P.pos.z)] });
        }
        this.jumpHeld = down;
      }
      // the Jetpack: thrust while the button is held (the game repeats a held right click every four ticks)
      if (this.jetUntil > t) {
        P.vel.y = Math.min(0.5, Math.max(P.vel.y, 0) + 0.14); P.onGround = false; P.fallDistance = 0;
        const bx = P.pos.x + Math.sin(P.yaw) * 0.3, bz = P.pos.z + Math.cos(P.yaw) * 0.3;
        this.spark('flame', bx, P.pos.y + 0.6, bz, (R() - 0.5) * 0.04, -0.15, (R() - 0.5) * 0.04);
        this.spark('smoke', bx, P.pos.y + 0.4, bz, (R() - 0.5) * 0.04, -0.1, (R() - 0.5) * 0.04);
        if (t % 4 === 0) { this.sound('block.fire.extinguish', P.pos.x, P.pos.y, P.pos.z, 0.25, 1.8); this.hub.send({ k: 'cosgad', id: 'gad_jetpack', at: [r3(P.pos.x), r3(P.pos.y), r3(P.pos.z)] }); }
      }
      // the Magic Wand's float, the Rocket's slow way down
      if (this.floatUntil > t) { P.vel.y = Math.max(P.vel.y, 0.12); P.fallDistance = 0; }
      if (this.slowFallAt && t >= this.slowFallAt) { this.slowFallAt = 0; sv.addEffect('slow_falling', 1, 140, { ambient: true }); }
      // Moon Boots: gravity at a third; Speed Shoes; the Glow Stick (refreshed while on)
      P.gravityScale = this.wear.moon === 'gad_moon' ? 0.35 : 1;
      if (this.wear.moon === 'gad_moon') P.fallDistance = 0;
      if (t % 40 === 0) {
        if (this.wear.speed === 'gad_speed') sv.addEffect('speed', 3, 60, { ambient: true });
        if (this.wear.glow === 'gad_glow') sv.addEffect('glowing', 1, 60, { ambient: true });
        if (this.wear.mount) sv.addEffect('speed', this.wear.mount === 'gad_horse' ? 4 : 2, 60, { ambient: true });
      }
      // the guards go home after their minute
      if (this.wear.guards && this.guardsUntil && t >= this.guardsUntil) { this.guardsUntil = 0; this.setWear('guards', null); this.say('§7Your Secret Service went home.'); }
      this.everyone();
      this.effects();
      this.unpaint(false);
    }
    // everyone's auras, trails, mounts and guards (yours included)
    everyone() {
      const me = this.myName(), P = this.game.player, t = this.t;
      const list = [[me, P.pos, this.wear, P.yaw, P]];
      for (const [n, r] of this.others()) {
        const w = this.worn.get(n);
        if (!w) continue;
        const d = (r.feet.x - P.pos.x) ** 2 + (r.feet.z - P.pos.z) ** 2;
        if (d > 48 * 48) continue;
        list.push([n, r.feet, w, r.st ? r.st.yaw || 0 : 0, null, r]);
      }
      const seenM = new Set(), seenG = new Set();
      const budget = list.length > 8 ? 0.5 : 1;
      for (const [n, f, w, yaw, own, r] of list) {
        const key = n === me ? '' : n;
        const invis = own ? this.game.survival.effectLevel('invisibility') > 0 : !!(r && r.av && r.av.invisible);
        if (w.aura && AURAS[w.aura] && !invis) this.aura(AURAS[w.aura], f, t, budget, key);
        if (w.trail && TRAILS[w.trail] && !invis) this.trail(TRAILS[w.trail], f, t, budget, key);
        if (w.mount) { seenM.add(key); this.mount(key, w.mount, f, yaw); }
        if (w.guards) { seenG.add(key); this.guardTick(key, f, yaw); }
      }
      for (const k of [...this.mounts.keys()]) if (!seenM.has(k)) this.dropMount(k);
      for (const k of [...this.guards.keys()]) if (!seenG.has(k)) this.dropGuards(k);
    }
    aura(A, f, t, budget, key) {
      let n = A.n * budget;
      if (A.every) { if ((t + key.length * 7) % A.every !== 0) return; n = A.n; }
      const cnt = Math.floor(n) + (R() < n - Math.floor(n) ? 1 : 0);
      for (let i = 0; i < cnt; i++) {
        const col = colour(A.col, t + i), ph = t * (A.speed || 0.1) + i * Math.PI * 2 / Math.max(1, cnt) + key.length;
        let x = f.x, y = f.y + (A.y || 0), z = f.z, vx = 0, vy = 0, vz = 0, life;
        switch (A.shape) {
          case 'ring': case 'halo': x += Math.cos(ph) * A.r; z += Math.sin(ph) * A.r; if (A.wave) y += Math.sin(ph * 3) * 0.15; vy = A.kind === 'lava' ? -0.05 : 0.005; life = 14; break;
          case 'helix': { const h = (t * 0.06 + i * 0.5) % 2.2, s = i % 2 ? Math.PI : 0; x += Math.cos(t * A.speed * 2 + s) * A.r; z += Math.sin(t * A.speed * 2 + s) * A.r; y = f.y + h; life = 10; break; }
          case 'sphere': { const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u); x += Math.cos(a) * s * A.r; y += u * A.r * 0.8; z += Math.sin(a) * s * A.r; if (A.inward) { vx = (f.x - x) * 0.06; vy = (f.y + 1 - y) * 0.06; vz = (f.z - z) * 0.06; life = 18; } else if (A.orbit) { vx = -Math.sin(a) * 0.04; vz = Math.cos(a) * 0.04; life = 16; } else if (A.drift) { vx = (R() - 0.5) * 0.02; vy = (R() - 0.5) * 0.02; vz = (R() - 0.5) * 0.02; life = 40; } break; }
          case 'rain': x += (R() - 0.5) * 2 * A.r; z += (R() - 0.5) * 2 * A.r; vy = -0.06; vx = (R() - 0.5) * 0.02; vz = (R() - 0.5) * 0.02; life = 36; break;
          case 'rise': x += (R() - 0.5) * 2 * A.r; z += (R() - 0.5) * 2 * A.r; vy = 0.06; life = 24; break;
          case 'cloud': x += (R() - 0.5) * 2 * A.r; z += (R() - 0.5) * 2 * A.r; y += (R() - 0.5) * 0.25; life = 12;
            if (A.drop && R() < 0.5) this.spark(A.drop, x, y - 0.2, z, 0, -0.2, A.drop === 'crit' ? [0.7, 0.85, 1] : undefined, 12);
            break;
          case 'wings': { const side = i % 2 ? 1 : -1, s = R(), back = 0.35;
            const yaw = this.yawOf(key), bx = Math.sin(yaw) * back, bz = Math.cos(yaw) * back, rx = Math.cos(yaw) * side, rz = -Math.sin(yaw) * side;
            const span = s * A.r * 1.2, lift = Math.sin(s * Math.PI) * 0.5 + (1 - s) * 0.2 + Math.sin(t * 0.2) * 0.08 * s;
            x = f.x + bx + rx * span; z = f.z + bz + rz * span; y = f.y + A.y + lift - s * 0.3; life = 8; break; }
          case 'burst': { const u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u); vx = Math.cos(a) * s * 0.18; vy = u * 0.12 + 0.08; vz = Math.sin(a) * s * 0.18; y = f.y + 1.2; life = 22; break; }
        }
        this.spark(A.kind, x, y, z, vx, vy, vz, col, life);
      }
    }
    yawOf(key) {
      if (!key) return this.game.player.yaw;
      for (const [n, r] of this.others()) if (n === key) return r.st ? r.st.yaw || 0 : 0;
      return 0;
    }
    trail(T, f, t, budget, key) {
      const last = this.trailAt || (this.trailAt = new Map()), p = last.get(key), moving = p && ((f.x - p[0]) ** 2 + (f.z - p[1]) ** 2) > 0.0004;
      last.set(key, [f.x, f.z]);
      if (!moving) return;
      if (T.steps) { if (t % 6 === 0) this.spark('dust', f.x + (R() - 0.5) * 0.2, f.y + 0.05, f.z + (R() - 0.5) * 0.2, 0, 0, 0, T.col, 40); return; }
      const n = T.n * budget, cnt = Math.floor(n) + (R() < n - Math.floor(n) ? 1 : 0);
      for (let i = 0; i < cnt; i++) {
        const col = colour(T.col, t + i);
        this.spark(T.kind, f.x + (R() - 0.5) * 0.35, f.y + 0.1 + R() * 0.15, f.z + (R() - 0.5) * 0.35, (R() - 0.5) * 0.02, T.kind === 'splash' ? 0.12 : 0.01, (R() - 0.5) * 0.02, col, T.twinkle ? 12 + R() * 10 : undefined);
        if (T.also) this.spark(T.also, f.x + (R() - 0.5) * 0.3, f.y + 0.3, f.z + (R() - 0.5) * 0.3, 0, 0.03, 0);
      }
    }

    /* ---- mounts: the game's own mob drawn under the rider, on this page only (never sent: the rider's place is) ---- */
    mount(key, id, f, yaw) {
      const G = GADGETS[id];
      if (!G) return;
      let m = this.mounts.get(key);
      if (m && m.id !== id) { this.dropMount(key); m = null; }
      if (!m) {
        const E = this.E, M = this.hub.net && this.hub.net.mobs;
        if (!E || !E.spawn) return;
        const was = M ? M.applying : false;
        if (M) M.applying = true;
        let e = null;
        try { e = E.spawn(G.mount, f.x, f.y, f.z, { natural: false }); } catch (err) { e = null; } finally { if (M) M.applying = was; }
        if (!e) return;
        if ('saddled' in e) e.saddled = true;
        if ('tame' in e) e.tame = true;
        if ('tamed' in e) e.tamed = true;
        e.persistent = true;
        e.cosMount = true;
        const cos = this;
        e.tick = function () {
          this.prev.copy(this.pos); this.prevYaw = this.yaw;
          if (this.prevBodyYaw !== undefined) { this.prevBodyYaw = this.bodyYaw; this.prevHeadYaw = this.headYaw; }
          const q = cos.mounts.get(key);
          if (q && q.f) { this.pos.set(q.f.x, q.f.y, q.f.z); this.yaw = q.yaw; if (this.bodyYaw !== undefined) { this.bodyYaw = q.yaw; this.headYaw = q.yaw; } }
          this.vel.set(0, 0, 0); this.age++;
          if (this.animTick) this.animTick();
        };
        e.hurt = () => false; e.interact = () => null; e.toJSON = () => null;
        m = { id, e, f, yaw };
        this.mounts.set(key, m);
      }
      m.f = f; m.yaw = yaw;
    }
    dropMount(key) { const m = this.mounts.get(key); if (!m) return; this.mounts.delete(key); try { m.e.remove(); } catch (e) { /* gone */ } }
    // the pose of someone riding (the hub's applyPoses asks for it), or null
    poseOf(name) {
      const w = !name || name === this.myName() ? this.wear : this.worn.get(name);
      const G = w && w.mount && GADGETS[w.mount];
      if (!this.inLobby || !G) return null;
      return G.pose || (G.pose = ridePose(G.h));
    }

    /* ---- the Secret Service: four guards round you, walking where you walk ---- */
    guardTick(key, f, yaw) {
      let G = this.guards.get(key);
      const hub = this.hub;
      if (!G) {
        const base = -6000 - ((this.guardSeq = ((this.guardSeq | 0) + 1) % 200) * 4);
        G = { ids: [0, 1, 2, 3].map(i => base - i), at: [0, 1, 2, 3].map(() => [f.x, f.y, f.z]), y: [0, 0, 0, 0] };
        for (const id of G.ids) hub.npcs.add({ id, name: '', skin: guardSkin() });
        this.guards.set(key, G);
        this.puff('poof', f.x, f.y + 1, f.z, 16, 1.2);
      }
      const slots = [[1.4, 1.6], [-1.4, 1.6], [1.6, -1.4], [-1.6, -1.4]];
      G.ids.forEach((id, i) => {
        const [sr, sf] = slots[i], fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
        const tx = f.x + rx * sr + fx * sf, tz = f.z + rz * sr + fz * sf, a = G.at[i];
        const dx = tx - a[0], dz = tz - a[2], d = Math.hypot(dx, dz), step = Math.min(d, d > 6 ? d : 0.24);
        if (d > 0.05) { a[0] += dx / d * step; a[2] += dz / d * step; }
        a[1] += (f.y - a[1]) * 0.35;
        const face = d > 0.3 ? Math.atan2(-dx, -dz) : yaw;
        hub.feed({ nid: id, x: a[0], y: a[1], z: a[2], yaw: face });
      });
    }
    dropGuards(key) {
      const G = this.guards.get(key);
      if (!G) return;
      this.guards.delete(key);
      for (const id of G.ids) this.hub.npcs.remove(id);
    }

    /* ---- effects playing ---- */
    effects() {
      const t = this.t, w = this.game.world;
      for (let i = this.fx.length - 1; i >= 0; i--) {
        const f = this.fx[i];
        if (f.kind === 'follow') { const p = this.feetOf(f.who); if (p) this.spark(f.p, p.x + (R() - 0.5) * 0.4, p.y + R() * 1.6, p.z + (R() - 0.5) * 0.4, 0, -0.02, 0, f.col, 16); }
        else if (f.kind === 'notes') { const p = this.feetOf(f.who); if (p && t % 5 === 0) this.spark('note', p.x + (R() - 0.5), p.y + 2 + R() * 0.4, p.z + (R() - 0.5), 0, 0.02, 0, colour('rainbow', t), 20); }
        else if (f.kind === 'burstAt' && t >= f.t) { const p = this.feetOf(f.who); if (p) { for (let k = 0; k < 60; k++) { const u = R() * 2 - 1, a = R() * 6.28, s = Math.sqrt(1 - u * u); this.spark('glowdust', p.x, p.y + 1, p.z, Math.cos(a) * s * 0.35, u * 0.35, Math.sin(a) * s * 0.35, colour('confetti'), 30); } this.sound('entity.firework_rocket.large_blast', p.x, p.y, p.z, 2, 1); } f.until = t; }
        else if (f.kind === 'firework') {
          const age = t - f.t0;
          if (age < 18) this.spark('sparkle', f.x + (R() - 0.5) * 0.1, f.y + age * 0.7, f.z + (R() - 0.5) * 0.1, 0, -0.05, 0, [1, 0.85, 0.5], 10);
          else if (age === 18) {
            const c = HUES[f.c % HUES.length], c2 = HUES[(f.c + 3) % HUES.length];
            for (let k = 0; k < 90; k++) { const u = R() * 2 - 1, a = R() * 6.28, s = Math.sqrt(1 - u * u), sp = 0.3 + R() * 0.15; this.spark('glowdust', f.x, f.y + 18 * 0.7, f.z, Math.cos(a) * s * sp, u * sp, Math.sin(a) * s * sp, k % 3 ? c : c2, 30 + R() * 15); }
            this.sound('entity.firework_rocket.large_blast', f.x, f.y + 12, f.z, 3, 1); this.sound('entity.firework_rocket.twinkle', f.x, f.y + 12, f.z, 2, 1);
          }
        } else if (f.kind === 'disco') {
          // a turning ball of light: beams of colour all round, sparkles falling from it
          const a = (t - f.t0) * 0.12;
          this.spark('sparkle', f.x + (R() - 0.5) * 0.6, f.y + (R() - 0.5) * 0.6, f.z + (R() - 0.5) * 0.6, 0, 0, 0, [1, 1, 1], 6);
          for (let k = 0; k < 4; k++) { const b = a + k * Math.PI / 2, c = HUES[(k + Math.floor((t - f.t0) / 10)) % HUES.length]; this.spark('glowdust', f.x, f.y, f.z, Math.cos(b) * 0.35, -0.12, Math.sin(b) * 0.35, c, 18); }
          if ((t - f.t0) % 10 === 0) this.spark('note', f.x + (R() - 0.5) * 3, f.y - 1.5, f.z + (R() - 0.5) * 3, 0, 0.02, 0, colour('rainbow', t), 20);
        } else if (f.kind === 'throw') this.throwTick(f, w);
        if (t >= f.until) {
          if (f.kind === 'voice') { try { Sound.stop(f.v); } catch (e) { /* gone */ } }
          if (f.mesh) this.dropMesh(f.mesh);
          this.fx.splice(i, 1);
        }
      }
    }
    throwTick(f, w) {
      const p = f.p, v = f.v, id = f.id;
      f.age++;
      const g = id === 'gad_snowball' || id === 'gad_pearl' ? 0.03 : 0.04;
      v[1] -= g; v[0] *= 0.99; v[1] *= 0.99; v[2] *= 0.99;
      const nx = p[0] + v[0], ny = p[1] + v[1], nz = p[2] + v[2];
      const b = w.get(Math.floor(nx), Math.floor(ny), Math.floor(nz));
      let hit = b && SOLID[b];
      // (a snowball that passes a player hits them: worked out on the thrower's page, which tells the server)
      let who = null;
      if (!hit && f.mine && (id === 'gad_snowball' || id === 'gad_water' || id === 'gad_melon')) for (const [n, r] of this.others()) {
        const e = r.feet;
        if (Math.abs(e.x - nx) < 0.6 && Math.abs(e.z - nz) < 0.6 && ny > e.y - 0.1 && ny < e.y + 2.0) { who = n; hit = true; break; }
      }
      if (id === 'gad_tnt' && hit) {
        // TNT bounces off what it hits and goes off on its fuse
        const fy = Math.floor(ny) !== Math.floor(p[1]);
        if (fy) { v[1] = -v[1] * 0.4; v[0] *= 0.7; v[2] *= 0.7; } else { v[0] = -v[0] * 0.4; v[2] = -v[2] * 0.4; }
        hit = false;
      } else if (!hit) { p[0] = nx; p[1] = ny; p[2] = nz; }
      if (f.mesh) { f.mesh.matrix.makeScale(0.6, 0.6, 0.6).setPosition(p[0], p[1] - 0.3 + 0.3, p[2]); f.mesh.matrixWorldNeedsUpdate = true; }
      // a trail
      const trail = id === 'gad_pearl' ? ['portal', [0.6, 0.2, 0.9]] : id === 'gad_snowball' ? ['snowflake', undefined] : id === 'gad_water' ? ['splash', undefined] : id === 'gad_chicken' ? ['poof', [1, 1, 1]] : id === 'gad_tnt' ? ['smoke', undefined] : ['petal', [0.4, 0.8, 0.3]];
      this.spark(trail[0], p[0], p[1], p[2], 0, 0, 0, trail[1], 10);
      const boom = id === 'gad_tnt' ? f.age >= 40 : hit || f.age >= 70;
      if (!boom) return;
      f.until = this.t;
      const [x, y, z] = p;
      if (id === 'gad_snowball') { this.puff('snowflake', x, y, z, 12, 0.2); if (who) { const hv = Math.hypot(v[0], v[2]) || 1; this.hub.send({ k: 'cosgad', id, hit: who, dir: [r3(v[0] / hv * 0.42), 0.28, r3(v[2] / hv * 0.42)] }); } }
      else if (id === 'gad_pearl') {
        this.puff('portal', x, y, z, 30, 0.5);
        this.sound('entity.enderman.teleport', x, y, z, 1, 1);
        if (f.mine) {
          const P = this.game.player;
          // onto the top of what it hit, if there is room
          let ty = y; for (let k = 0; k < 3 && !this.free(x, ty, z); k++) ty = Math.floor(ty) + 1;
          if (this.free(x, ty, z)) { P.pos.x = x; P.pos.y = ty; P.pos.z = z; if (P.prev) P.prev.copy(P.pos); P.vel.set(0, 0, 0); P.fallDistance = 0; }
        }
      } else if (id === 'gad_tnt') {
        this.puff('explosion_big', x, y, z, 1, 0); this.puff('explosion', x, y, z, 8, 1.5); this.puff('large_smoke', x, y, z, 16, 1.5);
        this.sound('entity.generic.explode', x, y, z, 2, 1);
        // everyone near is thrown (each page throws its own player)
        const P = this.game.player, dx = P.pos.x - x, dy = P.pos.y + 0.9 - y, dz = P.pos.z - z, d = Math.hypot(dx, dy, dz);
        if (d < 6) { const k = (1 - d / 6) * 1.6; P.vel.x += dx / (d || 1) * k; P.vel.y = Math.max(P.vel.y, 0.5 + k * 0.4); P.vel.z += dz / (d || 1) * k; P.onGround = false; P.fallDistance = 0; }
      } else if (id === 'gad_melon') { this.puff('petal', x, y, z, 30, 0.6, [0.9, 0.2, 0.2]); this.puff('petal', x, y, z, 20, 0.6, [0.35, 0.7, 0.25]); this.sound('block.wood.break', x, y, z, 1, 1.4); }
      else if (id === 'gad_water') { this.puff('splash', x, y + 0.5, z, 40, 0.8); this.sound('entity.generic.splash', x, y, z, 1, 1); }
      else if (id === 'gad_chicken') { this.puff('poof', x, y, z, 20, 0.5); this.puff('petal', x, y, z, 24, 0.6, [1, 1, 1]); this.sound('entity.chicken.hurt', x, y, z, 1, 1); this.sound('entity.generic.explode', x, y, z, 0.4, 1.8); }
    }

    /* ---- every frame: hats on the heads ---- */
    frame() {
      if (!this.inLobby) return;
      const A = this.hub.ctx.renderer && this.hub.ctx.renderer.avatar;
      if (A && A.setHat) A.setHat(this.wear.hat ? HATS[this.wear.hat] || null : null);
      const L = this.hub.net && this.hub.net.players;
      if (L) for (const r of L.list.values()) {
        if (!r.av || !r.av.setHat) continue;
        const w = this.worn.get(r.name);
        r.av.setHat(w && w.hat ? HATS[w.hat] || null : null);
      }
    }
  }
  return { LobbyCos, cosStack, EggMenu, BackpackMenu, CollectionMenu };
}
