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
     - block and item textures (assets/minecraft/textures/block, item)
     - the grass and foliage colour maps
     - the GUI: the old combined sheets (widgets.png, icons.png...) or the
       1.20.2+ sprites (sprites/widget/button.png, sprites/hud/hotbar.png...),
       turned into the sheets the GUI here draws from
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
        if (blob) out.push(Object.assign({ zip: await openZip(blob) }, p));
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

/* ---- the GUI: the sheets the game draws from, made from either layout ---- */
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
