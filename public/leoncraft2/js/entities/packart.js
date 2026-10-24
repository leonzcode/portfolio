/* ---------------------------------------------------------------------------
   Leoncraft 2 - pictures for the atlas of mobs and things that come from
   files rather than being painted (entities/mobart.js setArtImage).

   The paintings: each of the game's paintings is a famous painting out of
   copyright, at the game's size for it (textures/famous_paintings.jpg and
   .json, from Wikimedia Commons by tools/leoncraft2/build_paintings.py; the
   list, with each painter, is on the Credits screen and in
   textures/LICENSE.txt), at sixty-four pixels a block. Our own drawn scenes
   (entities/items2.js) show until the sheet is in.

   A player's own copy of the game (or any resource pack) opened on the
   Resource Packs screen (ui/pack.js) gives:
     - its paintings (textures/painting/<name>.png) and their back
     - the skins of the mobs and things, where the picture lays out over the
       same parts as our model of that mob uses: at least nine in ten of our
       pixels covered and little of it outside them, or six in ten covered
       with nearly none outside (a layer the game leaves clear). A model of ours that is
       built differently keeps its own picture rather than wearing one cut for
       another shape (packArtSummary says which, for the Resource Packs
       screen's Mob Skins list).
     - a villager's clothes with its skin: the biome's, the profession's and
       the level's badge, all from the pack once its villager skin fits, so
       a villager never wears our clothes over the game's skin.
--------------------------------------------------------------------------- */
import { setArtImage, artSize, artMask, artNames } from './mobart.js?v=107';
import { PAINTING_VARIANTS, PAINTING_PX } from '../items.js?v=107';
import { resolver, packFiles } from '../ui/pack.js?v=107';

const RAW = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
function pixels(src, sx, sy, sw, sh, w, h, tile) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  if (tile) for (let y = 0; y < h; y += tile) for (let x = 0; x < w; x += tile) g.drawImage(src, sx, sy, sw, sh, x, y, tile, tile);
  else g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}
const decode = async blob => { try { return await createImageBitmap(blob, RAW); } catch (e) { return null; } };

// what the packs gave: the skins taken from them and the ones that kept our own look (null with no pack)
let SUMMARY = null;
export const packArtSummary = () => SUMMARY;
const LEVELS = ['stone', 'iron', 'gold', 'emerald', 'diamond'];

export async function loadEntityArt(base, ver, packs) {
  SUMMARY = null;
  // our paintings: the famous ones
  try {
    const [info, sheet] = await Promise.all([
      fetch(base + 'famous_paintings.json' + ver).then(r => r.json()),
      fetch(base + 'famous_paintings.jpg' + ver).then(r => r.blob()).then(decode),
    ]);
    // (each already at its size, PAINTING_PX a block; the paintings' textures may not be registered yet: setArtImage keeps them)
    if (sheet) for (const [n, [x, y, w, h]] of Object.entries(info.where || {})) setArtImage('painting_' + n, pixels(sheet, x, y, w, h, w, h));
  } catch (e) { console.warn('paintings', e); }
  if (!packs || !packs.length) return;
  const find = resolver(packs);
  // the pack's paintings over ours (a pixel of a sixteen-a-block one is four of ours across), and the back tiled a block at a time
  await Promise.all(PAINTING_VARIANTS.map(async ([n, w, h]) => {
    const b = await find('assets/minecraft/textures/painting/' + n + '.png'), bmp = b && await decode(b);
    if (!bmp) return;
    setArtImage('painting_' + n, pixels(bmp, 0, 0, bmp.width, bmp.height, w * PAINTING_PX, h * PAINTING_PX));
  }));
  const back = await find('assets/minecraft/textures/painting/back.png'), bb = back && await decode(back);
  if (bb) setArtImage('painting_back', pixels(bb, 0, 0, bb.width, bb.width, 64, 64, 16));
  // the skins: each of ours that has a picture of the same name in the pack's entity folder
  const byName = new Map();
  for (const path of packFiles(packs, 'entity/')) {
    const n = path.slice(path.lastIndexOf('/') + 1, -4);
    if (!byName.has(n)) byName.set(n, path);
  }
  let took = 0;
  const taken = [], kept = [], why = {};
  const layer = n => /^villager_(type|prof|level)_/.test(n);
  for (const name of artNames()) {
    if (name.startsWith('painting_') || layer(name)) continue;
    const path = byName.get(name) || byName.get(name + '_temperate');
    if (!path) { kept.push(name); why[name] = 'no picture'; continue; }
    const [w, h] = artSize(name);
    const blob = await find(path), bmp = blob && await decode(blob);
    if (!bmp || bmp.width * h !== bmp.height * w) { kept.push(name); why[name] = 'size ' + (bmp ? bmp.width + 'x' + bmp.height : '?'); continue; }
    const img = pixels(bmp, 0, 0, bmp.width, bmp.height, w, h), mask = artMask(name);
    if (!mask) { kept.push(name); continue; }
    let ours = 0, both = 0, theirs = 0;
    for (let i = 0; i < w * h; i++) {
      const t = img.data[i * 4 + 3] > 0;
      if (mask[i]) { ours++; if (t) both++; } else if (t) theirs++;
    }
    // (nine in ten of ours covered; or six in ten, when all but a few of theirs fall on our model: the game leaves
    // a layer clear that we paint, a zombie's hat, and the picture still fits)
    if (ours && ((both / ours >= 0.9 && theirs <= 0.2 * (both + theirs)) || (both / ours >= 0.6 && theirs <= 0.05 * (both + theirs)))) { setArtImage(name, img); took++; taken.push(name); }
    else { kept.push(name); why[name] = [ours, both, theirs]; }
  }
  // the villager's clothes go with its skin: the pack's biome, profession and badge pictures (the game's own layout,
  // which our villager shares), so the game's skin never wears our clothes
  if (taken.includes('villager')) {
    await Promise.all(artNames().filter(layer).map(async name => {
      const [, kind, v] = /^villager_(type|prof|level)_(.+)$/.exec(name);
      const file = kind === 'type' ? 'type/' + v : kind === 'prof' ? 'profession/' + v : 'profession_level/' + LEVELS[(+v || 1) - 1];
      const blob = await find('assets/minecraft/textures/entity/villager/' + file + '.png'), bmp = blob && await decode(blob);
      if (!bmp) return;
      const [w, h] = artSize(name);
      // (an animated picture, a farmer's hat: its first frame)
      setArtImage(name, pixels(bmp, 0, 0, bmp.width, Math.min(bmp.height, bmp.width * h / w), w, h));
    }));
  }
  SUMMARY = { took: taken.sort(), kept: kept.sort(), why };
  if (took) console.info('resource packs: ' + took + ' mob skins');
}
