/* ---------------------------------------------------------------------------
   Leoncraft 2 - where the sounds come from.

   Two packs, each handing the engine (sound.js) the game's sounds.json (which
   recordings each sound event may play) and the recordings themselves:

   Leoncraft's own (DefaultPack)
     sounds/index.json, written by tools/leoncraft2/build_sounds.py, in the
     sounds.json form, and a few Ogg "banks", each many short recordings end
     to end (one download and one decode for a whole family of sounds), plus
     the music, one file a track, read as it plays. Every recording is openly
     licensed (CC0 or CC BY, credited in sounds/CREDITS.txt and the Credits
     screen); none is Mojang's. The banks the game needs at once (the click,
     footsteps and blocks) load with the page, the rest when a world starts.

   The player's own Minecraft (MinecraftPack)
     "Use My Minecraft Sounds" in Music & Sounds: the player picks their
     .minecraft folder (the File System Access API), and the sounds are read
     from it as the game itself reads them: assets/indexes/<n>.json maps
     minecraft/sounds.json and minecraft/sounds/... to the hashed files in
     assets/objects. Nothing leaves the computer, and nothing of it is kept
     but the folder's handle, in this browser's IndexedDB, so the next visit
     can ask for it again (the browser asks the player once a visit, on the
     first click, unless they told it to always allow). Browsers without
     folder handles (Firefox, Safari) can pick the folder each visit instead.
--------------------------------------------------------------------------- */
import { Sound } from './sound.js?v=107';
import { openZip } from '../ui/pack.js?v=107';

const V = '?v=107';

/* ---- how an entry in sounds.json is read: "name" or { name, volume, pitch, weight, stream, attenuation_distance, type } ---- */
function normalise(json) {
  const ev = {};
  for (const k in json) {
    const e = json[k];
    if (!e || !Array.isArray(e.sounds)) continue;
    ev[k] = { subtitle: e.subtitle || null, sounds: e.sounds.map(s => typeof s === 'string' ? { name: s } : s) };
  }
  return ev;
}

/* ---------------------------- Leoncraft's own ---------------------------- */
export class DefaultPack {
  constructor(base) {
    this.id = 'leoncraft';
    this.base = base;                 // the sounds/ folder's address, ending in /
    this.events = {};
    this.banks = new Map();           // name -> { file, clips, data (ArrayBuffer promise), buffer, waiting }
    this.music = {};
    this.ready = fetch(base + 'index.json' + V).then(r => r.json()).then(idx => {
      this.events = normalise(idx.events || {});
      this.music = idx.music || {};
      for (const name in idx.banks || {}) this.banks.set(name, Object.assign({ name, buffer: null, data: null, waiting: [] }, idx.banks[name]));
      // the first banks come down with the page (the click, footsteps); the rest when asked
      for (const b of this.banks.values()) if (b.load === 'now') this.fetchBank(b);
      return this;
    }).catch(e => { console.warn('sounds', e); return this; });
  }
  fetchBank(b) {
    if (!b.data) b.data = fetch(this.base + b.file + V).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
    // decoded once there is somewhere to play it (the first click), then kept: at the banks' own 32 kHz
    // (an offline context's), which plays fine through the main one and takes a third less memory
    Sound.whenReady(ctx => {
      if (b.decoding) return;
      let dec = ctx;
      try { dec = new OfflineAudioContext(1, 1, 32000); } catch (e) { /* the main context's rate, then */ }
      b.decoding = b.data.then(a => dec.decodeAudioData(a)).then(buf => {
        b.buffer = buf;
        for (const f of b.waiting.splice(0)) f();
      }).catch(e => { console.warn('sound bank ' + b.name, e); b.failed = true; for (const f of b.waiting.splice(0)) f(); });
    });
    return b;
  }
  /* When a world starts: its banks, one after another, the ones heard
     soonest first (3 MB asked for at once took a 10 Mbps line for most of
     three seconds, and a bank wanted at once, load(), waited behind it all). */
  warm(which) {
    const SOON = ['player', 'world', 'items', 'mobs', 'notes', 'ambient'];
    const rank = b => { const i = SOON.indexOf(b.name); return i < 0 ? SOON.length : i; };
    const list = [...this.banks.values()].filter(b => (!which || which(b)) && !b.data).sort((a, c) => rank(a) - rank(c));
    const next = () => {
      const b = list.shift();
      if (!b) return;
      if (b.data) { next(); return; }       // (asked for meanwhile)
      this.fetchBank(b);
      b.data.then(next, next);
    };
    next();
  }
  bankOf(name) { const i = name.indexOf('/'); return this.banks.get(name.slice(0, i)); }
  get(name) {
    const b = this.bankOf(name);
    if (!b || !b.buffer) return null;
    const c = b.clips[name.slice(name.indexOf('/') + 1)];
    return c ? { buffer: b.buffer, offset: c[0], duration: c[1] } : null;
  }
  load(name) {
    const b = this.bankOf(name);
    if (!b) return Promise.resolve(null);
    if (b.buffer || b.failed) return Promise.resolve(this.get(name));
    this.fetchBank(b);
    return new Promise(res => b.waiting.push(() => res(this.get(name))));
  }
  streamUrl(name) {
    const m = this.music[name];
    return m ? { url: this.base + m.file + V, revoke: false } : null;
  }
  trackInfo(name) { return this.music[name] || null; }
}

/* ---------------------------- the player's own Minecraft ---------------------------- */
const DB = 'leoncraft2-sound', STORE = 'kv';
function idb(mode, fn) {
  return new Promise((res, rej) => {
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const d = r.result, tx = d.transaction(STORE, mode), st = tx.objectStore(STORE);
      const q = fn(st);
      tx.oncomplete = () => { res(q && q.result); d.close(); };
      tx.onerror = () => { rej(tx.error); d.close(); };
    };
  });
}
export const remembered = {
  get: () => idb('readonly', st => st.get('minecraft')).catch(() => null),
  set: h => idb('readwrite', st => st.put(h, 'minecraft')).catch(e => console.warn('sound folder not kept', e)),
  clear: () => idb('readwrite', st => st.delete('minecraft')).catch(() => {}),
};

// a folder, read either through a handle (Chrome, Edge) or from the files an <input webkitdirectory> gave
class HandleDir {
  constructor(h) { this.h = h; this.kids = new Map(); }
  get name() { return this.h.name; }
  async dir(name) {
    let d = this.kids.get(name);
    if (!d) { d = this.h.getDirectoryHandle(name).then(x => new HandleDir(x)); this.kids.set(name, d); d.catch(() => this.kids.delete(name)); }
    return d;
  }
  async file(name) { return (await this.h.getFileHandle(name)).getFile(); }
  async list() { const out = []; for await (const [n, e] of this.h.entries()) out.push({ name: n, dir: e.kind === 'directory' }); return out; }
}
class FileListDir {
  constructor(map, path) { this.map = map; this.path = path; }     // map: 'a/b/c' -> File, relative to the folder picked
  get name() { const p = this.path.split('/').filter(Boolean); return p[p.length - 1] || ''; }
  async dir(name) {
    const p = this.path + name + '/';
    for (const k of this.map.keys()) if (k.startsWith(p)) return new FileListDir(this.map, p);
    throw new Error('no folder ' + name);
  }
  async file(name) { const f = this.map.get(this.path + name); if (!f) throw new Error('no file ' + name); return f; }
  async list() {
    const seen = new Map();
    for (const k of this.map.keys()) {
      if (!k.startsWith(this.path)) continue;
      const rest = k.slice(this.path.length), i = rest.indexOf('/');
      const n = i < 0 ? rest : rest.slice(0, i);
      if (n && !seen.has(n)) seen.set(n, i >= 0);
    }
    return [...seen].map(([name, dir]) => ({ name, dir }));
  }
}

export class MinecraftPack {
  constructor() {
    this.id = 'minecraft';
    this.events = {};
    this.objects = new Map();         // 'minecraft/sounds/dig/stone1.ogg' -> hash
    this.buffers = new Map();         // name -> AudioBuffer (most recently used last)
    this.loading = new Map();
    this.bytes = 0;
    this.lang = null;                 // en_us.json from their game, for the subtitles and the music's names
    this.version = '';
  }
  /* root: the .minecraft folder, or its assets folder (a HandleDir or FileListDir) */
  async open(root) {
    let assets = root, top = null;
    if (root.name !== 'assets') {
      try { assets = await root.dir('assets'); top = root; } catch (e) { throw new Error('That folder has no "assets" folder in it. Pick your .minecraft folder.'); }
    }
    const indexes = await assets.dir('indexes').catch(() => { throw new Error('No sound index found. Start Minecraft once so it downloads its sounds.'); });
    // the newest index: numbered ones from the highest, then the old named ones
    const names = (await indexes.list()).filter(e => !e.dir && e.name.endsWith('.json')).map(e => e.name.slice(0, -5));
    names.sort((a, b) => {
      const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
      if (na && nb) return +b - +a;
      if (na !== nb) return na ? -1 : 1;
      return b.localeCompare(a, undefined, { numeric: true });
    });
    const objects = await assets.dir('objects');
    let found = null;
    for (const n of names) {
      let idx;
      try { idx = JSON.parse(await (await indexes.file(n + '.json')).text()); } catch (e) { continue; }
      const sj = idx && idx.objects && idx.objects['minecraft/sounds.json'];
      if (!sj) continue;
      try { await (await objects.dir(sj.hash.slice(0, 2))).file(sj.hash); } catch (e) { continue; }   // listed but not downloaded
      found = { n, idx };
      break;
    }
    if (!found) throw new Error('No sounds were found in that folder. Start Minecraft once so it downloads them.');
    this.objectsDir = objects;
    this.objects.clear();
    for (const k in found.idx.objects) if (k.startsWith('minecraft/')) this.objects.set(k, found.idx.objects[k].hash);
    this.events = normalise(JSON.parse(await (await this.obj('minecraft/sounds.json')).text()));
    this.index = found.n;
    if (top) this.readLang(top, found.n).catch(() => {});
    return this;
  }
  // the game's English names (subtitles, music) from the version that uses this index: its .jar
  async readLang(top, index) {
    const versions = await top.dir('versions');
    // the newest first (26.1.2 before 1.21), so the one that uses this index is found after a few reads
    const list = (await versions.list()).filter(e => e.dir).map(e => e.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).slice(0, 60);
    let best = null;
    for (const v of list) {
      try {
        const j = JSON.parse(await (await (await versions.dir(v)).file(v + '.json')).text());
        if (j.assetIndex && String(j.assetIndex.id) === String(index) && !j.inheritsFrom) { best = v; if (!/-|w/.test(v)) break; }
      } catch (e) { /* not a version folder */ }
    }
    if (!best) return;
    const jar = await (await versions.dir(best)).file(best + '.jar');
    const z = await openZip(jar);
    const b = await z.read('assets/minecraft/lang/en_us.json');
    if (b) { this.lang = JSON.parse(await b.text()); this.version = best; }
  }
  async obj(path) {
    const h = this.objects.get(path);
    if (!h) throw new Error('missing ' + path);
    return (await this.objectsDir.dir(h.slice(0, 2))).file(h);
  }
  get(name) {
    const b = this.buffers.get(name);
    if (!b) return null;
    // most recently used goes to the end, so the oldest is the first dropped
    this.buffers.delete(name); this.buffers.set(name, b);
    return { buffer: b };
  }
  load(name) {
    if (this.buffers.has(name)) return Promise.resolve(this.get(name));
    let p = this.loading.get(name);
    if (!p) {
      p = this.obj('minecraft/sounds/' + name + '.ogg').then(f => f.arrayBuffer()).then(a => new Promise((res, rej) => {
        if (!Sound.ctx) { rej(new Error('no audio')); return; }
        Sound.ctx.decodeAudioData(a, res, rej);
      })).then(buf => {
        this.loading.delete(name);
        this.buffers.set(name, buf);
        this.bytes += buf.length * buf.numberOfChannels * 4;
        // decoded sound is kept up to about 96 MB, the least used dropped first
        for (const [k, v] of this.buffers) { if (this.bytes < 96e6) break; this.bytes -= v.length * v.numberOfChannels * 4; this.buffers.delete(k); }
        return { buffer: buf };
      }).catch(e => { this.loading.delete(name); return null; });
      this.loading.set(name, p);
    }
    return p;
  }
  async streamUrl(name) {
    const f = await this.obj('minecraft/sounds/' + name + '.ogg');
    return { url: URL.createObjectURL(f), revoke: true };
  }
  trackInfo(name) {
    // the music toast's words, as the game finds them: the file's id with dots
    if (!this.lang) return null;
    const key = name.replace(/\//g, '.');
    const t = this.lang[key];
    return t ? { title: t, by: '' } : null;
  }
}

/* The sounds the game plays: the player's Minecraft (when chosen) over Leoncraft's own.
   state: 'leoncraft' | 'minecraft' | 'waiting' (chosen, but the browser has to ask again first). */
export const SoundPacks = {
  base: null, own: null, mc: null, state: 'leoncraft', listeners: [],
  error: '',
  init(base) {
    this.base = base;
    this.own = new DefaultPack(base);
    Sound.setPacks([this.own]);
    this.restore();
    return this.own.ready;
  },
  onChange(fn) { this.listeners.push(fn); },
  changed() { for (const f of this.listeners) { try { f(this.state); } catch (e) { console.warn(e); } } },
  use(pack) {
    this.mc = pack;
    Sound.setPacks(pack ? [pack, this.own] : [this.own]);
    this.state = pack ? 'minecraft' : 'leoncraft';
    this.changed();
  },
  // a folder kept from last time: opened at once if the browser still allows it, else on the first click
  async restore() {
    if (!('showDirectoryPicker' in window)) return;
    const h = await remembered.get();
    if (!h) return;
    const go = async () => {
      try {
        let perm = await h.queryPermission({ mode: 'read' });
        if (perm !== 'granted') perm = await h.requestPermission({ mode: 'read' });
        if (perm !== 'granted') { this.state = 'leoncraft'; this.changed(); return; }
        this.use(await new MinecraftPack().open(new HandleDir(h)));
      } catch (e) { console.warn('your Minecraft sounds', e); this.error = e.message || String(e); this.state = 'leoncraft'; this.changed(); }
    };
    try {
      if (await h.queryPermission({ mode: 'read' }) === 'granted') { await go(); return; }
    } catch (e) { return; }
    this.state = 'waiting';
    this.changed();
    Sound.onGesture(go);
  },
  /* Use My Minecraft Sounds: pick the folder (call from a click). done(error or null). */
  async choose(done) {
    this.error = '';
    try {
      let root;
      if ('showDirectoryPicker' in window) {
        const h = await window.showDirectoryPicker({ id: 'leoncraft-minecraft', mode: 'read' });
        root = new HandleDir(h);
        const pack = await new MinecraftPack().open(root);
        await remembered.set(h);
        this.use(pack);
      } else {
        // no folder handles here: the folder's files, for this visit only
        const files = await new Promise((res, rej) => {
          const inp = document.createElement('input');
          inp.type = 'file'; inp.webkitdirectory = true; inp.multiple = true;
          inp.onchange = () => res(inp.files);
          inp.oncancel = () => rej(new DOMException('cancelled', 'AbortError'));
          inp.click();
        });
        const map = new Map();
        let top = '';
        for (const f of files) {
          const p = f.webkitRelativePath || f.name;
          if (!top) top = p.split('/')[0] + '/';
          map.set(p.slice(top.length), f);
        }
        root = new FileListDir(map, '');
        root.topName = top.slice(0, -1);
        Object.defineProperty(root, 'name', { value: top.slice(0, -1) });
        this.use(await new MinecraftPack().open(root));
      }
      done && done(null);
    } catch (e) {
      if (e && e.name === 'AbortError') { done && done(null); return; }
      this.error = (e && e.message) || String(e);
      done && done(this.error);
    }
  },
  // back to Leoncraft's own sounds, and the folder forgotten
  async forget() { await remembered.clear(); this.use(null); },
  get supported() { return 'showDirectoryPicker' in window || 'webkitdirectory' in document.createElement('input'); },
};
