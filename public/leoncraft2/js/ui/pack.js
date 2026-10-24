/* ---------------------------------------------------------------------------
   Leoncraft 2 - resource packs from your own computer.

   The site itself ships only openly licensed art. But Minecraft's own look
   (its textures, menus, logo, font and the Steve skin), Programmer Art and
   packs built on it such as Programmer Art Fix belong to Mojang or to their
   authors, so they cannot be put on a public page. What a player can do is
   open their own copies: a resource pack .zip, or the game's own client
   .jar, picked with Open Pack Folder (or dropped on the window). The files
   are read here, kept in this browser's storage, and never sent anywhere.

   Packs stack like the game's Resource Packs screen: the one at the top wins,
   anything no pack has falls through to Leoncraft's own art. A pack can give
     - block and item textures (assets/minecraft/textures/block, item), the
       pictures of every item in the inventory as well (itemStripFrom)
     - chests, beds, shulker boxes and mob heads, cut from its entity
       pictures the way our own are cut (composedTextures)
     - paintings, and the skins of mobs whose boxes take the picture the way
       ours do (entities/packart.js)
     - the grass and foliage colour maps
     - the GUI: the old combined sheets (widgets.png, icons.png...) or the
       1.20.2+ sprites (sprites/widget/button.png, sprites/hud/hotbar.png...),
       turned into the sheets the GUI here draws from, the container screens
       among them
     - the font (font/ascii.png), the title logo and edition plate
     - the default player skin (entity/player/wide/steve.png or entity/steve.png)
   A change takes effect on the next load, as the game reloads its resources.
--------------------------------------------------------------------------- */

/* ---- reading a zip (a .jar is a zip): only what is asked for is inflated ---- */
export async function openZip(blob) {
  const size = blob.size, tailLen = Math.min(size, 65557);
  const tail = new DataView(await blob.slice(size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('That file is not a .zip or .jar');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const dec = new TextDecoder();
  const files = new Map();
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true);
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true), off = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    if (!name.endsWith('/')) files.set(name, { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  // a pack zipped as a folder keeps everything under one top folder
  let prefix = '';
  for (const n of files.keys()) {
    const k = n.indexOf('assets/minecraft/');
    if (k >= 0) { prefix = n.slice(0, k); break; }
  }
  return {
    files, prefix,
    has(path) { return files.has(prefix + path); },
    async read(path) {
      const e = files.get(prefix + path);
      if (!e) return null;
      const h = new DataView(await blob.slice(e.off, e.off + 30).arrayBuffer());
      const start = e.off + 30 + h.getUint16(26, true) + h.getUint16(28, true);
      const data = blob.slice(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      return null;
    },
  };
}

/* ---- where the packs are kept: the files in IndexedDB, the list in localStorage ---- */
const DB = 'leoncraft2-packs', STORE = 'files', LIST = 'lc2_packs';
function db() {
  return new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode), st = tx.objectStore(STORE);
    const req = fn(st);
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
export const Packs = {
  // [{ id, name, desc, size, enabled }], top of the list first (the top one wins)
  list() { try { const a = JSON.parse(localStorage.getItem(LIST) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } },
  save(list) { try { localStorage.setItem(LIST, JSON.stringify(list)); } catch (e) {} },
  async add(file) {
    const zip = await openZip(file);
    if (![...zip.files.keys()].some(n => n.includes('assets/minecraft/'))) throw new Error('No Minecraft assets in ' + file.name);
    let desc = /\.jar$/i.test(file.name) ? 'Your own game files' : '';
    try {
      const m = await zip.read('pack.mcmeta');
      if (m) { const j = JSON.parse(await m.text()); const d = j.pack && j.pack.description; desc = typeof d === 'string' ? d : (d && (d.text || d.translate)) || desc; }
    } catch (e) {}
    const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await idb('readwrite', st => st.put(file, id));
    const list = this.list();
    list.unshift({ id, name: file.name.replace(/\.(zip|jar)$/i, ''), desc: String(desc).replace(/§./g, '').slice(0, 80), size: file.size, enabled: true });
    this.save(list);
    return id;
  },
  async remove(id) {
    try { await idb('readwrite', st => st.delete(id)); } catch (e) {}
    this.save(this.list().filter(p => p.id !== id));
  },
  // the enabled packs, opened, top first
  async active() {
    const out = [];
    for (const p of this.list()) {
      if (!p.enabled) continue;
      try {
        const blob = await idb('readonly', st => st.get(p.id));
        // read into memory once: thousands of small reads from the stored file each wait on the disk (seconds for a game .jar)
        if (blob) out.push(Object.assign({ zip: await openZip(blob.size < 256e6 ? new Blob([await blob.arrayBuffer()]) : blob) }, p));
      } catch (e) { console.warn('pack', p.name, e); }
    }
    return out;
  },
  async icon(id) {
    try {
      const blob = await idb('readonly', st => st.get(id));
      const zip = await openZip(blob);
      const png = await zip.read('pack.png');
      return png ? await createImageBitmap(png) : null;
    } catch (e) { return null; }
  },
};

/* ---- the first pack (from the top) that has a file ---- */
export function resolver(packs) {
  return async function find(path) {
    for (const p of packs) if (p.zip.has(path)) { const b = await p.zip.read(path); if (b) return b; }
    return null;
  };
}
const RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
async function bitmap(blob, opts) { try { return await createImageBitmap(blob, Object.assign({}, RAW, opts || {})); } catch (e) { return null; } }

/* ---- block and item textures, as 16 x 16 frames per manifest name ----
   Returns Map(name -> [ImageBitmap frames]). */
const RENAMED = { short_grass: ['short_grass', 'grass'], dirt_path_top: ['dirt_path_top', 'grass_path_top'], dirt_path_side: ['dirt_path_side', 'grass_path_side'], iron_chain: ['iron_chain', 'chain'] };
export async function blockTextures(find, manifest) {
  const out = new Map();
  const names = Object.keys(manifest.textures);
  await Promise.all(names.map(async name => {
    const item = name.startsWith('item_');
    const cands = item ? ['item/' + name.slice(5)] : (RENAMED[name] || [name]).map(n => 'block/' + n);
    let blob = null;
    for (const c of cands) { blob = await find('assets/minecraft/textures/' + c + '.png'); if (blob) break; }
    if (!blob) return;
    const full = await bitmap(blob);
    if (!full) return;
    const w = full.width, n = Math.max(1, Math.floor(full.height / w));
    const want = manifest.textures[name].frames || 1;
    const frames = [];
    for (let f = 0; f < want; f++) {
      const k = f % n;
      frames.push(await createImageBitmap(full, 0, k * w, w, w, Object.assign({ resizeWidth: 16, resizeHeight: 16, resizeQuality: 'pixelated' }, RAW)));
    }
    out.set(name, frames);
  }));
  return out;
}

/* ---- chests, beds, shulker boxes and mob heads: drawn by the game from entity pictures, which our texture
   build cuts into layers of their own (bed_red_head_top, chest_front...). textures/composed.json says how each
   layer was cut; a pack's own entity pictures are cut the same way here. Returns Map(name -> [frame]). ---- */
export async function composedTextures(find) {
  const out = new Map();
  let spec;
  try { spec = await (await fetch(new URL('../../textures/composed.json?v=107', import.meta.url))).json(); } catch (e) { return out; }
  const pics = new Map();
  for (const [name, [file, cuts, size]] of Object.entries(spec)) {
    if (!pics.has(file)) { const b = await find('assets/minecraft/textures/entity/' + file); pics.set(file, b ? await bitmap(b) : null); }
    const bmp = pics.get(file);
    if (!bmp) continue;
    const k = bmp.width / (size || 64);          // (a pack drawn at more pixels: cut to the same sixteenths)
    const [c, g] = canvas(16, 16);
    for (const [sx, sy, w, h, dx, dy, flip] of cuts) {
      g.save();
      if (flip) { g.translate(0, 2 * dy + h); g.scale(1, -1); }
      g.drawImage(bmp, sx * k, sy * k, w * k, h * k, dx, dy, w, h);
      g.restore();
    }
    out.set(name, [await createImageBitmap(c, RAW)]);
  }
  return out;
}

/* ---- the files a pack has under a folder of assets/minecraft/textures/ (the top pack's first) ---- */
export function packFiles(packs, dir) {
  const out = new Map(), root = 'assets/minecraft/textures/' + dir;
  for (const p of packs) for (const n of p.zip.files.keys()) {
    const path = n.slice(p.zip.prefix.length);
    if (path.startsWith(root) && path.endsWith('.png') && !out.has(path)) out.set(path, p);
  }
  return [...out.keys()];
}

/* ---- item pictures: the pack's (textures/item/<name>.png) in place of ours in the strip of item pictures
   (js/itemtex.js), cell for cell by name. Returns a new strip, or null when the pack has none. ---- */
export async function itemStripFrom(find, strip, names) {
  if (!strip || !strip.bmp) return null;
  // (an animated picture is a column of frames: its first, already 16 x 16 as it is decoded)
  const pics = await Promise.all(names.map(async name => {
    if (!name || name.startsWith('frame_')) return null;
    const b = await find('assets/minecraft/textures/item/' + name + '.png');
    if (!b) return null;
    try {
      const full = await createImageBitmap(b, RAW);
      return await createImageBitmap(full, 0, 0, full.width, full.width, Object.assign({ resizeWidth: 16, resizeHeight: 16, resizeQuality: 'pixelated' }, RAW));
    } catch (e) { return null; }
  }));
  if (!pics.some(Boolean)) return null;
  // drawn in one go on a canvas kept in memory (thousands of little draws on a drawing surface on the graphics card are slow)
  const c = document.createElement('canvas');
  c.width = 16; c.height = strip.bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(strip.bmp, 0, 0);
  pics.forEach((p, i) => { if (p) { g.clearRect(0, i * 16, 16, 16); g.drawImage(p, 0, i * 16); } });
  return createImageBitmap(c, RAW);
}

/* ---- the GUI: the sheets the game draws from, made from either layout ---- */
/* The container screens: since 1.20.2 the game's container pictures hold only the background, and the bits
   that move (a furnace's flame and arrow, the brewing bubbles...) are sprites of their own. Each sheet here is
   ours with the pack's background drawn over it (its clear parts leave ours showing), and the pack's sprites
   put where the classic sheet keeps them, which is where the screens here draw them from. */
const CONTAINERS = ['crafting_table', 'generic_54', 'shulker_box', 'dispenser', 'crafter', 'hopper', 'brewing_stand', 'furnace', 'smoker',
  'blast_furnace', 'enchanting_table', 'anvil', 'grindstone', 'smithing', 'stonecutter', 'loom', 'cartography_table', 'villager', 'horse'];
const SPRITES = {
  furnace: [['lit_progress', 176, 0], ['burn_progress', 176, 14]],
  smoker: [['lit_progress', 176, 0], ['burn_progress', 176, 14]],
  blast_furnace: [['lit_progress', 176, 0], ['burn_progress', 176, 14]],
  brewing_stand: [['brew_progress', 176, 0], ['bubbles', 185, 0], ['fuel_length', 176, 29]],
  anvil: [['error', 176, 0], ['text_field', 0, 166], ['text_field_disabled', 0, 182]],
  grindstone: [['error', 176, 0]], smithing: [['error', 176, 0]],
  stonecutter: [['scroller', 176, 0], ['scroller_disabled', 188, 0], ['recipe', 0, 166], ['recipe_selected', 0, 184], ['recipe_highlighted', 0, 202]],
  enchanting_table: [['enchantment_slot', 0, 166], ['enchantment_slot_disabled', 0, 185], ['enchantment_slot_highlighted', 0, 204],
    ['level_1', 0, 223], ['level_2', 16, 223], ['level_3', 32, 223], ['level_1_disabled', 0, 239], ['level_2_disabled', 16, 239], ['level_3_disabled', 32, 239]],
};
async function containerSheets(find, load, img, sheets) {
  for (const name of CONTAINERS) {
    const key = 'container/' + name;
    if (sheets[key]) continue;
    const bg = await img('gui/' + key + '.png');
    const sp = SPRITES[name] || [];
    const parts = await Promise.all(sp.map(([s]) => img('gui/sprites/' + key + '/' + s + '.png')));
    if (!bg && !parts.some(Boolean)) continue;
    let ours = null;
    try { ours = load ? await load(key) : null; } catch (e) {}
    const k = bg ? bg.width / 256 : 1;
    const [c, g] = canvas(256, 256);
    if (ours) g.drawImage(ours, 0, 0, 256, 256);
    if (bg) g.drawImage(bg, 0, 0, bg.width, bg.height, 0, 0, bg.width / k, bg.height / k);
    sp.forEach(([, x, y], i) => { const p = parts[i]; if (p) { g.clearRect(x, y, p.width / k, p.height / k); g.drawImage(p, 0, 0, p.width, p.height, x, y, p.width / k, p.height / k); } });
    sheets[key] = c;
  }
}
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; };
export async function guiSheets(find, base) {
  const T = 'assets/minecraft/textures/';
  const img = async p => { const b = await find(T + p); return b ? bitmap(b) : null; };
  const sheets = {};
  // the combined sheets older packs carry are drawn the way the GUI here reads them already
  for (const [name, path] of [['widgets', 'gui/widgets.png'], ['icons', 'gui/icons.png'], ['checkbox', 'gui/checkbox.png'],
    ['options_background', 'gui/options_background.png'], ['container/inventory', 'gui/container/inventory.png'],
    ['container/creative_inventory/tab_items', 'gui/container/creative_inventory/tab_items.png'],
    ['container/creative_inventory/tab_inventory', 'gui/container/creative_inventory/tab_inventory.png'],
    ['container/creative_inventory/tab_item_search', 'gui/container/creative_inventory/tab_item_search.png'],
    ['container/creative_inventory/tabs', 'gui/container/creative_inventory/tabs.png'], ['font_ascii', 'font/ascii.png']]) {
    const i = await img(path);
    if (i) sheets[name] = i;
  }
  const S = 'gui/sprites/';
  // 1.20.2 and later: one file a sprite, put back into the classic layouts
  const btn = await Promise.all(['widget/button_disabled', 'widget/button', 'widget/button_highlighted'].map(n => img(S + n + '.png')));
  const hot = await img(S + 'hud/hotbar.png');
  if (!sheets.widgets && (btn[1] || hot)) {
    const [c, g] = canvas(256, 256);
    if (base.widgets) g.drawImage(base.widgets, 0, 0);
    if (hot) { g.clearRect(0, 0, 182, 22); g.drawImage(hot, 0, 0); }
    const sel = await img(S + 'hud/hotbar_selection.png');
    if (sel) { g.clearRect(0, 22, 24, 24); g.drawImage(sel, 0, 22); }
    const off = await img(S + 'hud/hotbar_offhand_left.png');
    if (off) { g.clearRect(24, 22, 22, 24); g.drawImage(off, 0, 0, 22, 24, 24, 22, 22, 24); }
    btn.forEach((b, s) => { if (b) { g.clearRect(0, 46 + s * 20, 200, 20); g.drawImage(b, 0, 0, 200, 20, 0, 46 + s * 20, 200, 20); } });
    // the language button: a 20 x 20 button with the globe on it
    const globe = await img(S + 'icon/language.png');
    for (let s = 0; s < 2; s++) {
      const b = btn[1 + s];
      if (!b) continue;
      g.clearRect(0, 106 + s * 20, 20, 20);
      g.drawImage(b, 0, 0, 10, 20, 0, 106 + s * 20, 10, 20); g.drawImage(b, 190, 0, 10, 20, 10, 106 + s * 20, 10, 20);
      if (globe) g.drawImage(globe, 2, 108 + s * 20);
    }
    sheets.widgets = c;
    const acc = await img(S + 'icon/accessibility.png');
    if (btn[1]) {
      const [a, ag] = canvas(20, 40);
      for (let s = 0; s < 2; s++) {
        const b = btn[1 + s];
        if (!b) continue;
        ag.drawImage(b, 0, 0, 10, 20, 0, s * 20, 10, 20); ag.drawImage(b, 190, 0, 10, 20, 10, s * 20, 10, 20);
        if (acc) ag.drawImage(acc, 2, s * 20 + 2);
      }
      sheets.accessibility = a;
    }
  }
  const heart = await img(S + 'hud/heart/full.png');
  if (!sheets.icons && heart) {
    const [c, g] = canvas(256, 256);
    if (base.icons) g.drawImage(base.icons, 0, 0);
    const put = async (n, x, y, w, h) => { const i = await img(S + n + '.png'); if (i) { g.clearRect(x, y, w || i.width, h || i.height); g.drawImage(i, x, y); } };
    await put('hud/crosshair', 0, 0, 15, 15);
    await put('hud/heart/container', 16, 0); await put('hud/heart/container_blinking', 25, 0);
    await put('hud/heart/full', 52, 0); await put('hud/heart/half', 61, 0);
    await put('hud/heart/full_blinking', 70, 0); await put('hud/heart/half_blinking', 79, 0);
    await put('hud/heart/absorbing_full', 160, 0); await put('hud/heart/absorbing_half', 169, 0);
    await put('hud/armor_empty', 16, 9); await put('hud/armor_half', 25, 9); await put('hud/armor_full', 34, 9);
    await put('hud/air', 16, 18); await put('hud/air_bursting', 25, 18);
    await put('hud/food_empty', 16, 27); await put('hud/food_full', 52, 27); await put('hud/food_half', 61, 27);
    await put('hud/experience_bar_background', 0, 64, 182, 5); await put('hud/experience_bar_progress', 0, 69, 182, 5);
    sheets.icons = c;
  }
  const cb = await img(S + 'widget/checkbox.png'), cbs = await img(S + 'widget/checkbox_selected.png');
  if (!sheets.checkbox && cb) {
    const [c, g] = canvas(64, 64);
    g.drawImage(cb, 0, 0); if (cbs) g.drawImage(cbs, 0, 20);
    sheets.checkbox = c;
  }
  // the creative tabs and scroll bar
  const tab1 = await img(S + 'container/creative_inventory/tab_top_unselected_1.png');
  if (!sheets['container/creative_inventory/tabs'] && tab1) {
    const [c, g] = canvas(256, 256);
    if (base.tabs) g.drawImage(base.tabs, 0, 0);
    const rows = [['top_unselected', 0], ['top_selected', 32], ['bottom_unselected', 64], ['bottom_selected', 96]];
    for (const [r, y] of rows) for (let i = 1; i <= 7; i++) {
      const t = await img(S + 'container/creative_inventory/tab_' + r + '_' + i + '.png');
      if (t) { g.clearRect((i - 1) * 28, y, 28, 32); g.drawImage(t, (i - 1) * 28 + 1, y); }
    }
    const sc = await img(S + 'container/creative_inventory/scroller.png'), scd = await img(S + 'container/creative_inventory/scroller_disabled.png');
    if (sc) { g.clearRect(232, 0, 12, 15); g.drawImage(sc, 232, 0); }
    if (scd) { g.clearRect(244, 0, 12, 15); g.drawImage(scd, 244, 0); }
    sheets['container/creative_inventory/tabs'] = c;
  }
  // every other container screen: the pack's background over ours, and its sprites
  await containerSheets(find, base.load, img, sheets);
  // the recipe book button moved out of inventory.png into sprites
  const rb = await img(S + 'recipe_book/button.png');
  if (sheets['container/inventory'] && rb) {
    const [c, g] = canvas(256, 256);
    g.drawImage(sheets['container/inventory'], 0, 0);
    g.clearRect(178, 0, 20, 37);
    g.drawImage(rb, 178, 0);
    const rbh = await img(S + 'recipe_book/button_highlighted.png');
    if (rbh) g.drawImage(rbh, 178, 19);
    sheets['container/inventory'] = c;
  }
  return sheets;
}

/* ---- the title logo and its edition plate: canvases the title screen draws at 256 x 44 and 128 x 14 ---- */
export async function logoArt(find) {
  const T = 'assets/minecraft/textures/gui/title/';
  const lb = await find(T + 'minecraft.png');
  if (!lb) return null;
  const l = await bitmap(lb);
  const eb = await find(T + 'edition.png'), e = eb ? await bitmap(eb) : null;
  let logo;
  if (l.width === l.height) {
    // before 1.20 the logo came in two halves, one above the other
    const k = l.width / 256;
    const [c, g] = canvas(274 * k, 44 * k);
    g.drawImage(l, 0, 0, 155 * k, 44 * k, 0, 0, 155 * k, 44 * k);
    g.drawImage(l, 0, 45 * k, 119 * k, 44 * k, 155 * k, 0, 119 * k, 44 * k);
    logo = c;
  } else {
    const h = Math.round(l.width * 44 / 256);
    const [c, g] = canvas(l.width, h);
    g.drawImage(l, 0, 0, l.width, h, 0, 0, l.width, h);
    logo = c;
  }
  let edition = null;
  if (e) {
    const h = Math.round(e.width * 14 / 128);
    const [c, g] = canvas(e.width, h);
    g.drawImage(e, 0, 0, e.width, h, 0, 0, e.width, h);
    edition = c;
  }
  return { logo, edition };
}

/* ---- the default player skin ---- */
export async function skinUrl(find) {
  for (const p of ['entity/player/wide/steve.png', 'entity/steve.png']) {
    const b = await find('assets/minecraft/textures/' + p);
    if (b) return URL.createObjectURL(b);
  }
  return null;
}
export async function colormaps(find) {
  const g = await find('assets/minecraft/textures/colormap/grass.png'), f = await find('assets/minecraft/textures/colormap/foliage.png');
  return { grass: g ? await bitmap(g) : null, foliage: f ? await bitmap(f) : null };
}
