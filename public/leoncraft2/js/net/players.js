/* ---------------------------------------------------------------------------
   Leoncraft 2 - the other players on a server, as you see them.

   Each one sends where it is on every game tick that something changed,
   stamped with its own clock (net/net.js). Those stamps are what the
   picture runs on: the positions are spaced exactly as they were made,
   whatever the network did to them on the way. Each player is drawn a
   tenth of a second behind the newest one that could have arrived (the
   quickest any message from them has taken, plus the delay), straight
   between the two ticks either side, so they glide as smoothly as you see
   yourself. A connection that keeps arriving late pushes that delay up
   (to a quarter of a second at most) rather than letting them stutter.

   They are drawn with the same model as you in third person
   (render/avatar.js): their own skin, what they hold and wear, the arm
   swing, sneaking, swimming and the red flash when hurt, the limbs worked
   out at 20 ticks a second from how far they moved. Above each one its
   name, as the game draws it: white on a faint dark band, the band and a
   faint copy of the name seen through walls, only the faint one (and not
   through walls) while they sneak, none past 64 blocks. Nothing is drawn of
   a player in another dimension or out of sight range.

   A rank tag goes before the name, as servers show one: [ADMIN] in red for
   an admin account, [OWNER] in gold for the server's owner (rankTag). The
   server decides it and sends it with the player (lc2.js tagOf), so nobody
   can give themselves one; it shows over their head, in the Tab list and in
   their chat lines. In a Leonpixel game with a tag of its own (a team's
   letter, [BUILDER]) the role still shows in the Tab list and in chat, and
   the game's tag alone over the head (headTag).
--------------------------------------------------------------------------- */
import { Avatar, invisLook } from '../render/avatar.js?v=116';
import { pieceLook, armorSheet } from '../render/armor.js?v=116';
import { setLight as setLightOf, loadedLook, pulledLook } from '../render/held.js?v=116';
import { DRAW, I, stackFromJSON } from '../items.js?v=116';
import { B, BLOCKS } from '../blocks.js?v=116';
import { walkers } from '../render/realism.js?v=116';
const THREE = window.THREE;

const DELAY = 100;          // ms behind the newest position, at the least
const MAX_DELAY = 250;
const KEEP = 1500;          // ms of positions kept
const PI = Math.PI;
const wrap = a => a - 2 * PI * Math.round(a / (2 * PI));
const idOf = name => !name ? 0 : (I[name] !== undefined ? I[name] : B[name] !== undefined ? B[name] : 0);
// the rank tag before a name, in colour codes (the name after it goes back to the line's own colour)
const RANKS = { netowner: '\u00a7c[OWNER] \u00a7r', admin: '\u00a7c[ADMIN] \u00a7r', mod: '\u00a72[MOD] \u00a7r', owner: '\u00a76[OWNER] \u00a7r', builder: '\u00a7b[BUILDER] \u00a7r' };   // (builder: Leon Network's, the maker of the map being played and their building team)
// (Leon Network's team tag, 'team:<colour code>:<letter>': the letter in bold and the name in the team's colour)
const baseTag = tag => RANKS[tag] || (typeof tag === 'string' && /^team:[0-9a-f]:[A-Z]$/.test(tag) ? '§' + tag[5] + '§l' + tag[7] + ' §r§' + tag[5] : '');
// a Leonpixel leaderboard title worn, after a "|" in the tag ("admin|bedwars:1"): [Bed Wars #1] in gold, #2 silver, #3 bronze
const TITLE_NAMES = { overall: 'Overall', bedwars: 'Bed Wars', skywars: 'SkyWars', duels: 'Duels', tntrun: 'TNT Run', murder: 'Murder Mystery',
  buildbattle: 'Build Battle', spleef: 'Spleef', prophunt: 'Prop Hunt', chameleon: 'Meccha Chameleon', pillars: 'Pillars of Fortune', deathswap: 'Death Swap', bridger: 'Bridging' };
function titleTag(key) {
  const m = /^([a-z0-9_]{1,30}):([123])$/.exec(key || '');
  if (!m) return '';
  const name = TITLE_NAMES[m[1]] || m[1].replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()), c = m[2] === '1' ? '§6' : m[2] === '2' ? '§h' : '§g';
  return c + '[' + name + ' #' + m[2] + '] §r';
}
/* A tag may join a Leonpixel game's (a team's letter, builder) and the role with a "+" ("team:c:R+admin", lc2.js
   tagOf): the Tab list and chat show both, the role first (a team's letter colours the name after it); over a head
   the game's alone, as before (headTag). */
const GAME_TAG = t => t === 'builder' || /^team:/.test(t);
function split(tag) {
  let base = typeof tag === 'string' ? tag : '', title = '';
  const i = base.indexOf('|');
  if (i >= 0) { title = titleTag(base.slice(i + 1)); base = base.slice(0, i); }
  const parts = base.split('+').filter(Boolean);
  return { title, roles: parts.filter(t => !GAME_TAG(t)), game: parts.filter(GAME_TAG) };
}
export const rankTag = tag => { const t = split(tag); return t.title + t.roles.map(baseTag).join('') + t.game.map(baseTag).join(''); };
export const headTag = tag => { const t = split(tag); return t.title + (t.game.length ? t.game : t.roles).map(baseTag).join(''); };

// the flags each position carries (net/net.js sends them)
export const F = { SNEAK: 1, SPRINT: 2, FLY: 4, SWIM: 8, GROUND: 32, SLEEP: 64, DEAD: 128, GLIDE: 256, RIDE: 512, SLEPT: 1024, SPEC: 2048, INVIS: 4096, FIRE: 8192, SPIN: 16384, GLOW: 32768 };
// what the use button can be doing with a hand (render/avatar.js useNow kinds), by number in a position
export const USE_KINDS = ['eat', 'drink', 'horn', 'bow', 'aim', 'crossbow', 'block', 'trident', 'spear', 'spyglass'];
// sitting on something this machine does not have (a horse): the legs sit
const SEAT = { yaw: 0 };
// a bed's facing bits (sim/beds.js): north, east, south, west, the way from its foot to its head
const BED_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// everyone else's size here (Leon Network's Chameleon plays at half size: net/hub.js sets it; its seekers, in full, stay full size)
export const playerSize = { k: 1, full: new Set(), of(id) { return this.full.has(id) ? 1 : this.k; } };
// F1 hides the names over heads as it does the HUD (the game's renderNames is !hideGui); net.js sets it every frame
export const nameRule = { hidden: false };

export class RemotePlayers {
  constructor(renderer, font) {
    this.R = renderer; this.font = font;
    this.list = new Map();          // id -> remote player
    this.group = new THREE.Group(); this.group.name = 'players';
    renderer.scene.add(this.group);
    // the name tags' shader built now, in the background, not in the frame the first player comes into view
    try {
      const sc = new THREE.Scene(), c = document.createElement('canvas');
      c.width = c.height = 1;
      sc.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false })));
      renderer.r.compileAsync(sc, renderer.camera).catch(() => {});
    } catch (e) { /* built when first drawn instead */ }
  }
  dispose() {
    for (const r of this.list.values()) this.drop(r);
    this.list.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  /* ---- what the server says ---- */
  add(p) {
    if (this.list.has(p.id)) this.remove(p.id);
    const r = { id: p.id, name: p.name, rank: p.tag || '', buf: [], est: null, estS: null, win: Infinity, winPrev: Infinity, winAt: 0, late: 0, lateMax: 0, delay: DELAY,
      av: null, P: null, acc: 0, eq: null, tag: null, hurtUntil: 0, st: null, lat: p.lat | 0,
      // (another admin who joined hidden: the server tells only the other hidden players of them, marked so)
      hid: !!p.hid };
    this.list.set(p.id, r);
    if (p.st) this.state(p.id, p.st, null);
    // (dead already when you came: no dying to watch)
    if (p.st && (p.st.f & F.DEAD)) r.deadAt = -1e9;
    r.skinUrl = p.skin || ''; r.slim = !!p.slim; r.capeUrl = p.cape || '';
    if (p.eq) r.eq = p.eq;
    return r;
  }
  remove(id) { const r = this.list.get(id); if (r) { this.drop(r); this.list.delete(id); } }
  drop(r) {
    if (r.av) {
      const av = r.av, R = this.R;
      for (const m of [av.mesh, av.armor, av.glowRim, av.glowBehind]) { R.scene.remove(m); }
      av.dropSwirl();
      av.mesh.geometry.dispose(); av.arm.geometry.dispose(); av.glowRim.geometry.dispose(); av.glowBehind.geometry.dispose();
      av.glowRim.material.dispose(); av.glowBehind.material.dispose();
      R.scene.remove(av.capeMesh); av.capeMesh.geometry.dispose(); av.capeMat.dispose(); av.capeShadowMat.dispose(); av.capeTex.dispose();
      R.scene.remove(av.hatMesh); av.hatMesh.geometry.dispose(); av.hatMat.dispose(); av.hatShadowMat.dispose(); av.hatTex.dispose();
      for (let s = 0; s < 2; s++) av.setHeld(s, null);
      av.setHeadItem(null);
      av.tex.dispose(); av.armorTex.dispose();
      for (const m of [av.mat, av.armMat, av.shadowMat, av.armorMat, av.armorShadowMat]) m.dispose();
      r.av = null;
    }
    if (r.tag) this.dropTag(r);
  }
  dropTag(r) {
    const t = r.tag;
    this.group.remove(t.far, t.near);
    for (const s of [t.far, t.near]) { s.material.map.dispose(); s.material.dispose(); }
    r.tag = null;
  }
  // a position, with the sender's clock (ts) and when it got here (at, this page's clock)
  state(id, s, at) {
    const r = this.list.get(id);
    if (!r) return;
    r.st = s;
    const b = r.buf, now = at === null ? performance.now() : at;
    if (b.length && s.ts <= b[b.length - 1].ts) { if (s.ts < b[b.length - 1].ts - 5000) b.length = 0; else return; }
    // nothing is sent while nothing changes: the last position held until a tick before this one
    if (b.length && s.ts - b[b.length - 1].ts > 75) { const h = Object.assign({}, b[b.length - 1]); h.ts = s.ts - 50; b.push(h); }
    b.push(s);
    // the quickest any message has taken (with the two clocks' difference in it): the lowest of the last two to four seconds
    const off = now - s.ts;
    if (now - r.winAt > 2000) { r.winPrev = r.win; r.win = Infinity; r.winAt = now; r.lateMax = r.late; r.late = 0; }
    if (off < r.win) r.win = off;
    r.est = Math.min(r.win, r.winPrev);
    if (r.estS === null) r.estS = r.est;
    // how late this one was against the quickest: a jittery connection gets a longer delay
    const late = off - r.est;
    if (late > r.late) r.late = late;
  }
  setSkin(id, skin, slim, cape) { const r = this.list.get(id); if (!r) return; r.skinUrl = skin || ''; r.slim = !!slim; r.capeUrl = cape || ''; if (r.av) this.skinOf(r); }
  setEquip(id, eq) { const r = this.list.get(id); if (!r) return; r.eq = eq; if (r.av) this.equip(r); }
  swing(id, hand) { const r = this.list.get(id); if (r && r.av && !hand) r.av.startSwing(); }
  hurt(id) { const r = this.list.get(id); if (r) r.hurtUntil = performance.now() + 500; }
  rename(id, name) { const r = this.list.get(id); if (r && r.name !== name) { r.name = name; if (r.tag) this.dropTag(r); } }
  setTag(id, tag) { const r = this.list.get(id); if (r && r.rank !== tag) { r.rank = tag; if (r.tag) this.dropTag(r); } }

  /* ---- the model ---- */
  avatarOf(r) {
    if (r.av) return r.av;
    const av = r.av = new Avatar(this.R, true);
    av.started = false;
    r.P = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, sneaking: false, flying: false, gliding: false, pose: 'stand', riding: null, w: null, bed: null };
    /* Asleep, they lie in the bed as the game draws a sleeper: on their back,
       the head straight on the pillow, the feet in the foot of the bed, a
       pixel or two over the mattress (the game's 0.6875 against the bed's 0.5625). */
    const lay = av.layDown;
    av.layDown = function (root, P, a, pitch) {
      const f = P.bed;
      // dying: tipped onto its side about the feet, as the game's renderer does
      if (P.dying > 0) root.multiply(this.t.makeRotationZ(P.dying * PI / 2));
      if (!f) return lay.call(this, root, P, a, pitch);
      const fx = f[0], fz = f[1], o = P.pos;
      root.set(-fz, fx, 0, o.x - fx * 1.52, 0, 0, 1, o.y + 0.125, fx, fz, 0, o.z - fz * 1.52, 0, 0, 0, 1);
      this.pose[0].rx = this.pose[0].ry = 0;
    };
    this.skinOf(r);
    this.equip(r);
    return av;
  }
  skinOf(r) {
    const av = r.av;
    const url = r.skinUrl || new URL('../../textures/skin/default.png?v=116', import.meta.url).href;
    av.setSkin(url, r.skinUrl ? r.slim : false).catch(() => {});
    av.setCape(r.capeUrl || '').catch(() => {});
  }
  equip(r) {
    const av = r.av, eq = r.eq || {}, R = this.R;
    const h = idOf(eq.h), o = idOf(eq.o);
    // (a loaded crossbow in its loaded picture, as held.js shows yours)
    const hk = h + (eq.hc || ''), ok = o + (eq.oc || '');
    if (r.heldKey !== hk) { r.heldKey = hk; r.heldId = h; r.pullK = r.pullSide = undefined; av.setHeld(0, loadedLook(DRAW[h], eq.hc) || null); }
    if (r.offKey !== ok) { r.offKey = ok; r.offId = o; r.pullK = r.pullSide = undefined; av.setHeld(1, loadedLook(DRAW[o], eq.oc) || null); }
    av.glintHeld(0, !!eq.hg); av.glintHeld(1, !!eq.og);
    const armor = [0, 1, 2, 3].map(i => (eq.a && eq.a[i] ? stackFromJSON(eq.a[i]) : null));
    av.setArmor(armor);
    // a block on the head that is not armour (a carved pumpkin, a mob head): the block itself
    const head = armor[0] && !pieceLook(armor[0]) ? DRAW[armor[0].id] : null;
    av.setHeadItem(head || null);
    void R;
  }

  /* ---- the name over their head ---- */
  tagOf(r) {
    if (r.tag) return r.tag;
    const f = this.font, name = headTag(r.rank) + (r.name || '') + (r.hid ? ' §3(hidden)' : '');
    const w = (f ? f.width(name) : name.length * 6) + 2, h = 10, k = 4;
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    if (f) f.draw(t.getContext('2d'), name, 1, 1, 0xFFFFFF, false);
    /* Two layers, as the game draws a name: the band (black at a quarter, a
       pixel round the text) with the words faint on it (an eighth), seen
       through walls; and the words in white, only where nothing is in front. */
    const layer = band => {
      const c = document.createElement('canvas');
      c.width = w * k; c.height = h * k;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      if (band) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, c.width, c.height); g.globalAlpha = 32 / 255; }
      g.drawImage(t, 0, 0, w, h, 0, 0, c.width, c.height);
      const tex = new THREE.CanvasTexture(c);
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };
    const mk = (tex, depth) => {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: depth, depthWrite: false, fog: false, toneMapped: false });
      const s = new THREE.Sprite(m);
      s.scale.set(w * 0.025, h * 0.025, 1);
      s.renderOrder = depth ? 10 : 9;
      s.frustumCulled = false;
      return s;
    };
    const far = mk(layer(true), false), near = mk(layer(false), true);
    this.group.add(far, near);
    return (r.tag = { far, near, w, h });
  }

  /* ---- every frame: where each one is now, posed and named ---- */
  frame(now, dt, world, dimCode, eye, maxDist, spectator) {
    for (const r of this.list.values()) {
      const s = r.st;
      // (a spectator is seen only by other spectators, as in the game)
      const show = !!s && s.d === dimCode && r.buf.length > 0 && (!(s.f & F.SPEC) || spectator);
      if (!show) { if (r.av) this.hide(r); continue; }
      const p = this.sample(r, now, dt);
      if (!p) { if (r.av) this.hide(r); continue; }
      // sitting in a boat or minecart this machine has too: in its seat there, moving with it (net/vehicles.js)
      const seat = p.f & F.RIDE && this.seatOf ? this.seatOf(r) : null;
      if (seat) { p.x = seat.x; p.y = seat.y; p.z = seat.z; }
      /* Dying, as the game shows it: tipped over onto its side over the first
         two thirds of a second, red, and gone in a puff at one second (20 ticks). */
      if (p.f & F.DEAD) {
        if (!r.deadAt) r.deadAt = now;
        const ticks = (now - r.deadAt) / 50;
        if (ticks >= 20) {
          if (!r.poofed && r.av && r.av.mesh.visible && this.onPoof) { r.poofed = true; this.onPoof(p.x, p.y, p.z); }
          if (r.av) this.hide(r);
          continue;
        }
        r.dying = Math.min(1, Math.sqrt(Math.max(0, ticks / 20 * 1.6)));
      } else { r.deadAt = 0; r.dying = 0; r.poofed = false; }
      const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > maxDist * maxDist) { if (r.av) this.hide(r); continue; }
      const av = this.avatarOf(r), P = r.P;
      P.w = world;
      P.dying = r.dying || 0;
      r.invis = !!(p.f & F.INVIS); r.glow = !!(p.f & F.GLOW);
      P.sneaking = !!(p.f & F.SNEAK); P.flying = !!(p.f & F.FLY); P.gliding = !!(p.f & F.GLIDE); P.spinning = !!(p.f & F.SPIN);
      P.riding = p.f & F.RIDE ? (seat ? seat.v : SEAT) : null;
      P.bed = null;
      if (p.f & F.SLEEP) {
        const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z), b = world && world.get(bx, by, bz);
        if (b && BLOCKS[b] && BLOCKS[b].shape === 'bed') P.bed = BED_DIRS[world.meta(bx, by, bz) & 3];
      }
      P.pose = p.f & F.SWIM ? 'swim' : 'stand';
      P.pitch = p.pitch;
      // a bow drawn, food eaten, a shield up: the pose for it, as for you
      const U = p.u ? (r.use || (r.use = {})) : null;
      if (U) { U.kind = USE_KINDS[(p.u & 15) - 1] || 'eat'; U.side = p.u & 16 ? 1 : 0; U.t = p.ut || 0; U.total = p.uT || 0; }
      r.useNow = U;
      // a bow being drawn shows its drawn-back picture in their hand, as held.js shows yours
      const bs = U && U.kind === 'bow' ? U.side : -1, bid = bs === 1 ? r.offId : r.heldId;
      const pull = bs >= 0 && DRAW[bid] && DRAW[bid].name === 'bow' ? (U.t / 20 >= 0.9 ? 2 : U.t / 20 >= 0.65 ? 1 : 0) : -1;
      if (pull !== (r.pullK === undefined ? -1 : r.pullK) || (pull >= 0 && bs !== r.pullSide)) {
        const eq = r.eq || {};
        if (r.pullSide !== undefined && r.pullSide !== bs) av.setHeld(r.pullSide, loadedLook(DRAW[r.pullSide ? r.offId : r.heldId], r.pullSide ? eq.oc : eq.hc) || null);
        if (pull >= 0) av.setHeld(bs, pulledLook(DRAW[bid], pull));
        else if (r.pullSide !== undefined) av.setHeld(r.pullSide, loadedLook(DRAW[r.pullSide ? r.offId : r.heldId], r.pullSide ? eq.oc : eq.hc) || null);
        r.pullK = pull; r.pullSide = pull >= 0 ? bs : undefined;
      }
      // the limbs: a game tick of movement at a time, as for you
      if (!av.started) { av.started = true; P.pos.set(p.x, p.y, p.z); P.prev.copy(P.pos); P.yaw = p.yaw; av.body = av.oBody = p.yaw; r.acc = 0; }
      av.size = this.sized ? playerSize.of(r.id) : 1;
      r.acc += dt;
      let n = 0;
      while (r.acc >= 0.05 && n++ < 5) {
        r.acc -= 0.05;
        P.prev.copy(P.pos);
        // (into a record of its own: p is this frame's position and must not move)
        const q = this.at(r, r.rt - r.acc * 1000, r.tmpT || (r.tmpT = {}));
        if (q) { P.pos.set(q.x, q.y, q.z); P.yaw = q.yaw; }
        P.vel.subVectors(P.pos, P.prev);
        av.tick(P);
      }
      if (r.acc > 0.05) r.acc = 0;
      P.yaw = p.yaw;
      const feet = r.feet || (r.feet = new THREE.Vector3());
      feet.set(p.x, p.y, p.z);
      // (RIP Computer: walking through the grass parts it: render/realism.js)
      if (!(p.f & (F.FLY | F.DEAD))) walkers.add(p.x, p.y, p.z, av.size || 1, true);
      this.draw(r, av, P, feet, Math.min(1, r.acc / 0.05), dt, now);
      /* the name, its top half a block over the head (lower when they sneak),
         within 64 blocks; a player sneaking shows only the faint layer, and
         not through walls */
      const tag = this.tagOf(r), top = (P.bed ? 0.2 : P.sneaking ? 1.5 : P.pose === 'swim' ? 0.6 : 1.8) + 0.5 + 0.025 - tag.h * 0.0125;
      tag.far.position.set(p.x, p.y + top, p.z); tag.near.position.copy(tag.far.position);
      // (nor over someone invisible, or dying)
      const close = d2 < 64 * 64 && !r.invis && !(p.f & F.DEAD) && !nameRule.hidden;
      tag.far.visible = close;
      tag.near.visible = close && !P.sneaking;
      if (tag.far.material.depthTest !== P.sneaking) tag.far.material.depthTest = P.sneaking;
    }
  }
  hide(r) {
    const av = r.av;
    av.mesh.visible = av.armor.visible = av.glowRim.visible = av.glowBehind.visible = av.capeMesh.visible = av.hatMesh.visible = false;
    for (const h of av.held) if (h) h.mesh.visible = false;
    if (av.headItem) av.headItem.mesh.visible = false;
    if (r.tag) r.tag.far.visible = r.tag.near.visible = false;
    av.started = false;
  }
  // the position to draw now: a tenth of a second (or more) behind the newest
  sample(r, now, dt) {
    if (r.est === null) return null;
    // the estimate moves gently, so a quick message leaving the window never jerks them back
    // (a big change, a tab that slept or a clock that jumped, is taken at once: they would crawl for seconds)
    if (Math.abs(r.est - r.estS) > 250) r.estS = r.est;
    else r.estS += Math.max(-dt * 50, Math.min(dt * 50, (r.est - r.estS) * Math.min(1, dt * 2)));
    /* So does the delay. The picture's clock may run at most a tenth fast or
       slow while either changes: a late message makes them drift back a
       little, never stop and start. */
    const want = Math.max(DELAY, Math.min(MAX_DELAY, Math.max(r.late, r.lateMax) + 20));
    const step = (want - r.delay) * Math.min(1, dt * (want > r.delay ? 4 : 0.5)), most = dt * 100;
    r.delay += Math.max(-most, Math.min(most, step));
    r.rt = now - r.estS - r.delay;
    // forget what is long past
    const b = r.buf;
    let k = 0;
    while (k < b.length - 2 && b[k + 1].ts < r.rt - KEEP) k++;
    if (k) b.splice(0, k);
    return this.at(r, r.rt);
  }
  at(r, t, out) {
    const b = r.buf;
    if (!b.length) return null;
    if (t <= b[0].ts) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      const a = b[i - 1], c = b[i];
      if (t >= a.ts) {
        if (t >= c.ts) return c;
        const k = (t - a.ts) / (c.ts - a.ts), o = out || r.tmp || (r.tmp = {});
        o.x = a.x + (c.x - a.x) * k; o.y = a.y + (c.y - a.y) * k; o.z = a.z + (c.z - a.z) * k;
        o.yaw = a.yaw + wrap(c.yaw - a.yaw) * k; o.pitch = a.pitch + (c.pitch - a.pitch) * k;
        o.f = k < 0.5 ? a.f : c.f;
        o.u = k < 0.5 ? a.u : c.u; o.uT = c.uT; o.ut = a.u === c.u ? (a.ut || 0) + ((c.ut || 0) - (a.ut || 0)) * k : c.ut;
        // a jump of more than 8 blocks in a tick is a teleport: no gliding across the world
        if (Math.abs(c.x - a.x) + Math.abs(c.y - a.y) + Math.abs(c.z - a.z) > 8) return k < 0.5 ? a : c;
        return o;
      }
    }
    return b[b.length - 1];
  }
  // the model for this frame: its light, its pose, what it holds and wears (render/avatar.js update, for someone else)
  draw(r, av, P, feet, a, dt, now) {
    av.world = P.w;
    av.uHurt.value = now < r.hurtUntil || P.dying > 0 ? 1 : 0;
    av.useNow = r.useNow || null;
    av.lightT -= dt;
    if (av.lightT <= 0) { av.lightT = 0.25 + Math.random() * 0.05; av.refreshCache(feet.x, feet.z); av.sampleLight(feet); }
    const k = Math.min(1, dt * 6);
    av.sky += (av.skyLv / 15 - av.sky) * k; av.block += (av.blockLv / 15 - av.block) * k;
    av.uLight.value.set(av.sky, av.block);
    av.posed(P, a, feet);
    const on = av.ready;
    // invisible: only what they wear and hold shows, as in the game
    av.mesh.visible = on && !r.invis;
    av.armor.visible = on && av.wearing && !(r.invis && invisLook.hideArmor);
    // Glowing: the outline, through walls too (shown even on someone invisible, as in the game)
    av.glowRim.visible = av.glowBehind.visible = on && !!r.glow;
    // their cape (they send none while it is switched off), not while invisible or in an elytra
    av.invisible = !!r.invis;
    av.capeMesh.visible = av.capeShows(on);
    // a lobby hat (net/lobbycos.js sets it), not while invisible
    av.hatMesh.visible = on && av.hatOn && !r.invis;
    // the armour's pictures taken up again whenever another file has landed in the sheet
    if (av.wearing) { const sh = armorSheet(); if (sh.version !== av.armorV) { av.armorV = sh.version; av.armorTex.needsUpdate = true; } }
    av.uPiece.value[0].y = av.headWorn ? 1 : 0;
    const lv = (Math.round(av.sky * 255) << 8) | Math.round(av.block * 255);
    for (const h of av.held) {
      if (!h) continue;
      h.mesh.visible = on;
      if (lv !== h.light) { h.light = lv; setLightOf(h.mesh.geometry, lv); }
    }
    const hi = av.headItem;
    if (hi) { hi.mesh.visible = on; if (lv !== hi.light) { hi.light = lv; setLightOf(hi.mesh.geometry, lv); } }
  }
}
/* ---- Tab: who is on the server ----
   The game's player list: a box across the top, a row for each player (a
   column for every 20), their face from their skin, their name, and the
   signal bars for how long the server takes to hear from them. */
const pingBars = ms => (ms < 0 ? 5 : ms < 150 ? 0 : ms < 300 ? 1 : ms < 600 ? 2 : ms < 1000 ? 3 : 4);
// a face for someone whose model is not loaded here (far off, or in another of Leon Network's games): their skin as the server sent it
const FACES = new Map();
function faceOf(url) {
  const key = url || new URL('../../textures/skin/default.png?v=116', import.meta.url).href;
  let im = FACES.get(key);
  if (!im) { if (FACES.size > 200) FACES.clear(); im = new Image(); im.src = key; FACES.set(key, im); }
  return im.complete && im.naturalWidth >= 64 ? im : null;
}
export class PlayerList {
  constructor(net) { this.net = net; this.shown = false; this.animates = false; }
  draw(g) {
    if (!this.shown || g.hideHud) return;
    const net = this.net, lat = net.lat || {};
    const rows = [{ name: net.name, rank: net.tag, ping: Math.round(net.rtt), face: net.ctx ? net.ctx.renderer.avatar.canvas : null, hidden: !!net.hidden }];
    if (net.players) for (const r of net.players.list.values()) rows.push({ name: r.name, rank: r.rank, ping: lat[r.id] !== undefined ? lat[r.id] : -1, face: r.av && r.av.ready ? r.av.canvas : faceOf(r.skinUrl), hidden: r.hid });
    rows.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
    // (each shown with its rank tag before it)
    for (const r of rows) r.shown = rankTag(r.rank) + r.name + (r.hidden ? ' §3(hidden)' : '');
    const n = rows.length, cols = Math.ceil(n / 20), per = Math.ceil(n / cols);
    let nw = 0;
    for (const r of rows) nw = Math.max(nw, g.textWidth(r.shown));
    const sw = Math.min(nw + 9 + 13 + 4, Math.floor((g.width - 50) / cols));
    const total = sw * cols + (cols - 1) * 5;
    const left = Math.floor(g.width / 2 - total / 2), top = 10;
    g.fill(left - 1, top - 1, left + total + 1, top + per * 9, 0x80000000);
    for (let i = 0; i < n; i++) {
      const r = rows[i], x = left + Math.floor(i / per) * (sw + 5), y = top + (i % per) * 9;
      g.fill(x, y, x + sw, y + 8, 0x20FFFFFF);
      if (r.face) { g.blit(r.face, 8, 8, 8, 8, x, y, 8, 8); g.blit(r.face, 40, 8, 8, 8, x, y, 8, 8); }
      g.text(g.font.trim(r.shown, sw - 9 - 13), x + 9, y, 0xFFFFFF);
      g.blit('icons', 0, 176 + pingBars(r.ping) * 8, 10, 8, x + sw - 11, y);
    }
  }
}
