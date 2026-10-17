/* Leoncraft 2 - Leonpixel's Profile item (the lobby's hotbar): your stats, the titles your leaderboard places give
   (Bed Wars #1 in gold, #2 in silver, #3 in bronze, and the same for Overall and every game), and your item layouts:
   where each game's kit puts its items, Bed Wars' Quick Buy page and its Hotbar Manager (which slot each kind of item
   you buy goes to). Layouts are kept on your account by the server (mlhub hub.js, hubstats.js) and sent on joining.

   Made by net/hub.js with its own pieces (makeProfile({ MenuScreen, stack, ... })), so this file imports nothing of
   it and the menus can extend its MenuScreen. */

// the kits a layout can be made for: [the kit's kind (hub.giveKit), its name, an icon]
export const LAYOUT_KITS = [
  ['game', 'Bed Wars', 'red_bed'], ['sw', 'SkyWars (your kit)', 'ender_eye'], ['duel_classic', 'Classic Duel', 'iron_sword'],
  ['bridge', 'The Bridge', 'blue_terracotta'], ['mm_murderer', 'Murder Mystery: Murderer', 'iron_sword'], ['mm_detective', 'Murder Mystery: Detective', 'bow'],
  ['spleef', 'Spleef', 'diamond_shovel'], ['tntrun', 'TNT Run', 'tnt'], ['ph_hider', 'Prop Hunt: Hider', 'oak_leaves'], ['ph_seeker', 'Prop Hunt: Seeker', 'iron_sword'],
  ['ch_hider', 'Chameleon: Hider', 'brush'], ['ch_seeker', 'Chameleon: Seeker', 'crossbow'], ['lobby', 'Lobby', 'compass'],
];
// Bed Wars' Hotbar Manager: the kinds of item a hotbar slot may be kept for (the shop's own categories)
export const HOTBAR_CATS = [['', 'None', 'light_gray_stained_glass_pane'], ['melee', 'Melee', 'golden_sword'], ['blocks', 'Blocks', 'terracotta'],
  ['tools', 'Tools', 'stone_pickaxe'], ['ranged', 'Ranged', 'bow'], ['potions', 'Potions', 'brewing_stand'], ['utility', 'Utility', 'tnt']];

// an item's place in a layout: its kind without the material (any sword is "sword", so a better one keeps the place)
// and its own name
export function itemKey(st, ITEMS) {
  if (!st) return '';
  const it = ITEMS[st.id], n = it ? it.name : String(st.id);
  return n.replace(/^(wooden|stone|iron|golden|diamond|netherite|leather|chainmail)_/, '') + '|' + (st.name || '');
}
export const layoutKey = (kind, swKit) => 'kit:' + kind + (kind === 'sw' ? ':' + (swKit || 'default') : '');

/* Put a kit's items where the layout says: each place in the layout takes the first item of its kind still unplaced;
   whatever is left keeps its own place if free, else the first free one. inv.slots is changed in place. */
export function applyLayout(inv, lay, ITEMS) {
  if (!lay || !Array.isArray(lay.s)) return false;
  const items = [];
  for (let i = 0; i < 36; i++) if (inv.slots[i]) items.push({ st: inv.slots[i], from: i, key: itemKey(inv.slots[i], ITEMS), used: false });
  if (!items.length) return false;
  const out = new Array(36).fill(null);
  lay.s.forEach((k, i) => {
    if (!k || i >= 36) return;
    const e = items.find(q => !q.used && q.key === k);
    if (e) { e.used = true; out[i] = e.st; }
  });
  for (const e of items) if (!e.used) { e.used = true; const at = out[e.from] ? out.findIndex(x => !x) : e.from; if (at >= 0) out[at] = e.st; }
  for (let i = 0; i < 36; i++) inv.slots[i] = out[i];
  return true;
}

export function makeProfile(K) {
  const { MenuScreen, stack, ITEMS } = K;
  const named = (names, name) => { for (const n of names) { const s = stack(n, 1, { name }); if (s) return s; } return null; };
  const back = (menu, slot, to) => { const st = named(['arrow'], '§aGo Back'); if (st) menu.put(slot, st, ['§aGo Back', '§7To ' + to.title], () => { const hub = menu.hub; hub.ctx.gui.replace(to.make(hub)); }); };

  class ProfileMenu extends MenuScreen {
    constructor(hub) { super(hub, 'Your Profile'); }
    fillBox() {
      const hub = this.hub, P = hub.profile || {}, T = P.totals || {}, o = T.overall || { w: 0, l: 0, d: 0 };
      const head = named(['player_head', 'name_tag'], '§a' + (hub.ctx.account && hub.ctx.account.name || 'Your Profile'));
      const lines = ['§a' + (head ? head.name.replace(/§./g, '') : 'Profile'), '', '§7Overall: §a' + o.w + ' wins §7- §c' + o.l + ' losses'];
      for (const [g, name] of P.games || []) if (g !== 'overall' && T[g]) lines.push('§7' + name + ': §a' + T[g].w + 'W §c' + T[g].l + 'L');
      if (P.best > 0) lines.push('§7Bridging best: §e' + (P.best / 1000).toFixed(3) + 's');
      if (P.guest) lines.push('', '§cLog in to keep stats and titles.');
      if (head) this.put(13, head, lines, null);
      const t = named(['name_tag'], '§aTitles');
      if (t) this.put(29, t, ['§aTitles', '§7Wear a title before your name.', '§7The top three of every', '§7leaderboard get one.', '', '§7Yours: §e' + (P.titles || []).length, '', '§eClick to choose!'], () => hub.ctx.gui.replace(new TitlesMenu(hub)));
      const l = named(['chest'], '§aItem Layouts');
      if (l) this.put(31, l, ['§aItem Layouts', '§7Choose where each game puts', '§7its items in your inventory.', '', '§eClick to edit!'], () => hub.ctx.gui.replace(new LayoutsMenu(hub)));
      const q = named(['nether_star'], '§aBed Wars Quick Buy');
      if (q) this.put(33, q, ['§aBed Wars Quick Buy', '§7Choose what the Quick Buy', '§7page of the Item Shop sells.', '', '§eClick to edit!'], () => hub.ctx.gui.replace(new QuickBuyEditor(hub)));
      const h = named(['blaze_rod', 'stick'], '§aBed Wars Hotbar Manager');
      if (h) this.put(35, h, ['§aBed Wars Hotbar Manager', '§7Choose which hotbar slot each', '§7kind of item you buy goes to.', '', '§eClick to edit!'], () => hub.ctx.gui.replace(new HotbarManager(hub)));
    }
  }
  const PROFILE = { title: 'Your Profile', make: hub => new ProfileMenu(hub) };

  class TitlesMenu extends MenuScreen {
    constructor(hub) { super(hub, 'Titles'); }
    fillBox() {
      const hub = this.hub, P = hub.profile || {}, list = P.titles || [];
      if (!list.length && !P.rank) {
        const st = named(['barrier'], '§cNo titles yet');
        if (st) this.put(22, st, ['§cNo titles yet', '§7Get into the top three of a', '§7leaderboard in the lobby to', '§7earn its title.'], null);
      }
      list.slice(0, 28).forEach((t, i) => {
        const on = P.chosen === t.key, st = named([t.place === 1 ? 'gold_ingot' : t.place === 2 ? 'iron_ingot' : 'copper_ingot', 'brick'], t.text);
        if (!st) return;
        if (on) st.ench = { unbreaking: 1 };
        this.put(10 + (i % 7) + Math.floor(i / 7) * 9, st, [t.text, '§7Shown before your name', '§7in chat and over your head' + (P.rank ? ',' : '.'), ...(P.rank ? ['§7instead of your rank.'] : []), '', on ? '§aYou are wearing this title!' : '§eClick to wear it!'], () => hub.send({ k: 'title', key: on ? '' : t.key }));
      });
      // a rank counts as one of the choices: shown when no title is worn (one or the other, never both)
      const RANK = { admin: '§c[ADMIN]', mod: '§2[MOD]' }[P.rank];
      if (RANK) {
        const st = named(['nether_star', 'name_tag'], '§fShow Your Rank: ' + RANK);
        if (st) { if (!P.chosen) st.ench = { unbreaking: 1 }; this.put(49, st, ['§fShow Your Rank: ' + RANK, '§7Your rank before your name', '§7instead of a title.', '', !P.chosen ? '§aYou are showing your rank!' : '§eClick to show it!'], () => hub.send({ k: 'title', key: '' })); }
      } else {
        const off = named(['barrier'], '§cWear No Title');
        if (off && list.length) this.put(49, off, ['§cWear No Title', '§7Take your title off.', '', P.chosen ? '§eClick to take it off!' : '§aYou wear no title.'], () => hub.send({ k: 'title', key: '' }));
      }
      back(this, 45, PROFILE);
    }
  }

  // the kit's items as giveKit would put them, without touching your own inventory (a stand-in inventory for the call)
  function previewKit(hub, kind) {
    const g = hub.game, real = g.inv, chat = hub.ctx.chat.add, keep = { alive: hub.alive, kit: hub.kit && Object.assign({}, hub.kit) };
    const fake = { slots: new Array(36).fill(null), armor: new Array(4).fill(null), offhand: null, carried: null, selected: 0,
      select(i) { this.selected = i; }, changed() {}, emit() {},
      addStack(st) { for (const r of [[0, 9], [9, 36]]) for (let i = r[0]; i < r[1]; i++) if (!this.slots[i]) { this.slots[i] = st; return 0; } return st.count; },
      add(id, n) { return this.addStack({ id, count: n }); } };
    try {
      g.inv = fake; hub.ctx.chat.add = () => {}; hub.previewing = true;
      hub.giveKit(kind, true);
    } catch (e) { /* a kit that needs a game going: shown as far as it got */ }
    finally { g.inv = real; hub.ctx.chat.add = chat; hub.previewing = false; hub.alive = keep.alive; if (keep.kit) hub.kit = keep.kit; }
    return fake.slots;
  }

  class LayoutsMenu extends MenuScreen {
    constructor(hub) { super(hub, 'Item Layouts'); }
    fillBox() {
      const hub = this.hub;
      LAYOUT_KITS.forEach(([kind, name, icon], i) => {
        const st = named([icon, 'chest'], '§a' + name);
        if (!st) return;
        const has = !!(hub.layouts && hub.layouts[layoutKey(kind, hub.swKit)]);
        if (has) st.ench = { unbreaking: 1 };
        this.put(10 + (i % 7) + Math.floor(i / 7) * 9, st, ['§a' + name, has ? '§7Your own layout.' : '§7The default layout.', '', '§eClick to edit!'], () => hub.ctx.gui.replace(new LayoutEditor(hub, kind, name)));
      });
      back(this, 45, PROFILE);
    }
  }
  const LAYOUTS = { title: 'Item Layouts', make: hub => new LayoutsMenu(hub) };

  /* One kit's layout: its items in a copy of your inventory (the top three rows, then the hotbar), click one and then
     another to swap them, Save keeps it on your account. */
  class LayoutEditor extends MenuScreen {
    constructor(hub, kind, name) {
      super(hub, name + ' Layout');
      this.kind = kind; this.kname = name; this.picked = -1;
      this.kitSlots = previewKit(hub, kind).slice(0, 36);
      const lay = hub.layouts && hub.layouts[layoutKey(kind, hub.swKit)];
      if (lay) applyLayout({ slots: this.kitSlots }, lay, ITEMS);
      this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox();
    }
    fillBox() {
      if (!this.kitSlots) return;
      // box 0..26: inventory 9..35; box 27..35: the hotbar 0..8
      for (let b = 0; b < 36; b++) {
        const i = b < 27 ? b + 9 : b - 27, st = this.kitSlots[i];
        const shown = st ? Object.assign({}, st, this.picked === i ? { ench: { unbreaking: 1 } } : {}) : (this.picked >= 0 ? stack('light_gray_stained_glass_pane') : null);
        const tip = st ? [st.name ? st.name : '§f' + ((ITEMS[st.id] || {}).display || 'Item'), '', this.picked === i ? '§aPicked: click another slot' : this.picked >= 0 ? '§eClick to swap here!' : '§eClick to move it!'] : this.picked >= 0 ? ['§7Empty slot', '§eClick to move it here!'] : null;
        this.put(b, shown, tip, () => {
          if (this.picked < 0) { if (st) this.picked = i; return; }
          const a = this.picked; this.picked = -1;
          if (a === i) return;
          const t = this.kitSlots[a]; this.kitSlots[a] = this.kitSlots[i]; this.kitSlots[i] = t;
        });
      }
      for (let b = 36; b < 45; b++) this.put(b, stack('black_stained_glass_pane'), ['§8↑ Inventory', '§8↓ Hotbar is the bottom row above'], null);
      const save = named(['emerald'], '§aSave Layout');
      if (save) this.put(50, save, ['§aSave Layout', '§7Every ' + this.kname + ' kit will', '§7put its items like this.', '', '§eClick to save!'], () => {
        this.hub.send({ k: 'layout', key: layoutKey(this.kind, this.hub.swKit), v: { s: this.kitSlots.map(st => itemKey(st, ITEMS)) } });
        this.hub.layouts = this.hub.layouts || {}; this.hub.layouts[layoutKey(this.kind, this.hub.swKit)] = { s: this.kitSlots.map(st => itemKey(st, ITEMS)) };
      });
      const reset = named(['barrier'], '§cReset to Default');
      if (reset) this.put(48, reset, ['§cReset to Default', '§7Go back to the game\'s own layout.', '', '§eClick to reset!'], () => {
        this.hub.send({ k: 'layout', key: layoutKey(this.kind, this.hub.swKit), v: null });
        if (this.hub.layouts) delete this.hub.layouts[layoutKey(this.kind, this.hub.swKit)];
        this.kitSlots = previewKit(this.hub, this.kind).slice(0, 36); this.picked = -1;
      });
      back(this, 45, LAYOUTS);
    }
  }

  // Bed Wars' Quick Buy page: 21 places, each one of the shop's items or empty
  class QuickBuyEditor extends MenuScreen {
    constructor(hub) {
      super(hub, 'Edit Quick Buy');
      const lay = hub.layouts && hub.layouts['bw:quick'];
      this.qbList = (lay && Array.isArray(lay.s) ? lay.s : K.QUICK).slice(0, 21);
      while (this.qbList.length < 21) this.qbList.push('');
      this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox();
    }
    fillBox() {
      if (!this.qbList) return;
      const all = K.allShopItems(this.hub);
      this.qbList.forEach((id, n) => {
        const it = all[id], st = it ? stack(it.icon || 'barrier', it.n || 1) : stack('light_gray_stained_glass_pane');
        if (!st) return;
        st.name = it ? '§a' + it.name : '§7Empty Slot';
        this.put(K.GRID[n], st, [st.name, '', '§eClick to choose what goes here!'], () => this.hub.ctx.gui.replace(new ShopPicker(this.hub, this, n)));
      });
      const save = named(['emerald'], '§aSave Quick Buy');
      if (save) this.put(50, save, ['§aSave Quick Buy', '', '§eClick to save!'], () => { const v = { s: this.qbList.slice() }; this.hub.send({ k: 'layout', key: 'bw:quick', v }); this.hub.layouts = this.hub.layouts || {}; this.hub.layouts['bw:quick'] = v; });
      const reset = named(['barrier'], '§cReset to Default');
      if (reset) this.put(48, reset, ['§cReset to Default', '', '§eClick to reset!'], () => { this.qbList = K.QUICK.slice(0, 21); while (this.qbList.length < 21) this.qbList.push(''); this.hub.send({ k: 'layout', key: 'bw:quick', v: null }); if (this.hub.layouts) delete this.hub.layouts['bw:quick']; });
      back(this, 45, PROFILE);
    }
  }
  class ShopPicker extends MenuScreen {
    constructor(hub, editor, n) { super(hub, 'Choose an Item'); this.editor = editor; this.pickN = n; this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox(); }
    fillBox() {
      if (!this.editor) return;
      const all = K.allShopItems(this.hub), ids = Object.keys(all);
      ids.slice(0, 44).forEach((id, i) => {
        const it = all[id], st = stack(it.icon || 'barrier', it.n || 1);
        if (!st) return;
        st.name = '§a' + it.name;
        this.put(i, st, [st.name, '', '§eClick to put it in Quick Buy!'], () => { this.editor.qbList[this.pickN] = id; this.hub.ctx.gui.replace(this.editor); });
      });
      const none = named(['barrier'], '§cEmpty Slot');
      if (none) this.put(49, none, ['§cEmpty Slot', '§7Leave this place empty.'], () => { this.editor.qbList[this.pickN] = ''; this.hub.ctx.gui.replace(this.editor); });
    }
  }

  // Bed Wars' Hotbar Manager: each of the nine hotbar slots kept for a kind of item (click to change)
  class HotbarManager extends MenuScreen {
    constructor(hub) {
      super(hub, 'Hotbar Manager');
      const lay = hub.layouts && hub.layouts['bw:hotbar'];
      this.hbCats = lay && Array.isArray(lay.s) ? lay.s.slice(0, 9) : ['melee', 'blocks', 'tools', 'ranged', '', '', 'potions', 'utility', ''];
      while (this.hbCats.length < 9) this.hbCats.push('');
      this.box.fill(null); this.tips.fill(null); this.acts.fill(null); this.fillBox();
    }
    fillBox() {
      if (!this.hbCats) return;
      for (let i = 0; i < 9; i++) {
        const c = HOTBAR_CATS.find(q => q[0] === this.hbCats[i]) || HOTBAR_CATS[0], st = named([c[2]], '§a' + c[1]);
        if (!st) continue;
        this.put(27 + i, st, ['§aSlot ' + (i + 1) + ': §f' + c[1], '§7What you buy of this kind', '§7goes to this slot first.', '', '§eClick to change!'], () => {
          const k = HOTBAR_CATS.findIndex(q => q[0] === this.hbCats[i]);
          this.hbCats[i] = HOTBAR_CATS[(k + 1) % HOTBAR_CATS.length][0];
        });
        this.put(18 + i, stack('gray_stained_glass_pane'), ['§8Slot ' + (i + 1)], null);
      }
      const save = named(['emerald'], '§aSave Hotbar');
      if (save) this.put(50, save, ['§aSave Hotbar', '', '§eClick to save!'], () => { const v = { s: this.hbCats.slice() }; this.hub.send({ k: 'layout', key: 'bw:hotbar', v }); this.hub.layouts = this.hub.layouts || {}; this.hub.layouts['bw:hotbar'] = v; });
      const reset = named(['barrier'], '§cReset to Default');
      if (reset) this.put(48, reset, ['§cReset to Default', '', '§eClick to reset!'], () => { this.hbCats = ['melee', 'blocks', 'tools', 'ranged', '', '', 'potions', 'utility', '']; this.hub.send({ k: 'layout', key: 'bw:hotbar', v: null }); if (this.hub.layouts) delete this.hub.layouts['bw:hotbar']; });
      back(this, 45, PROFILE);
    }
  }
  return { ProfileMenu, TitlesMenu, LayoutsMenu, LayoutEditor, QuickBuyEditor, HotbarManager };
}
