/* ---------------------------------------------------------------------------
   Leoncraft 2 - pictures for the atlas of mobs and things that come from
   files rather than being painted (entities/mobart.js setArtImage).

   The paintings: our own art draws every one (entities/items2.js). Where
   Pixel Perfection CE has a painting of its own under the game's name and
   at its size, that is used instead (textures/paintings.png, packed by the
   texture build; CC BY-SA 4.0, credited in textures/LICENSE.txt and on the
   Credits screen). The newer paintings it does not have keep our art.

   A player's own copy of the game (or any resource pack) opened on the
   Resource Packs screen (ui/pack.js) gives:
     - its paintings (textures/painting/<name>.png) and their back
     - the skins of the mobs and things, where the picture lays out over the
       same parts as our model of that mob uses: at least nine in ten of our
       pixels covered, and little of it outside them. A model of ours that is
       built differently keeps its own picture rather than wearing one cut for
       another shape.
--------------------------------------------------------------------------- */
import { setArtImage, artSize, artMask, artNames } from './mobart.js?v=24';
import { PAINTING_VARIANTS } from '../items.js?v=24';
import { resolver, packFiles } from '../ui/pack.js?v=24';

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

export async function loadEntityArt(base, ver, packs) {
  // our paintings
  try {
    const [where, sheet] = await Promise.all([
      fetch(base + 'paintings.json' + ver).then(r => r.json()),
      fetch(base + 'paintings.png' + ver).then(r => r.blob()).then(decode),
    ]);
    if (sheet) for (const [n, [x, y, w, h]] of Object.entries(where)) if (n !== 'back') setArtImage('painting_' + n, pixels(sheet, x, y, w, h, w, h));
  } catch (e) { console.warn('paintings', e); }
  if (!packs || !packs.length) return;
  const find = resolver(packs);
  // the pack's paintings, at sixteen pixels a block whatever size they are drawn at, and the back tiled a block at a time
  await Promise.all(PAINTING_VARIANTS.map(async ([n, w, h]) => {
    const b = await find('assets/minecraft/textures/painting/' + n + '.png'), bmp = b && await decode(b);
    if (bmp) setArtImage('painting_' + n, pixels(bmp, 0, 0, bmp.width, bmp.height, w * 16, h * 16));
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
  for (const name of artNames()) {
    if (name.startsWith('painting_')) continue;
    const path = byName.get(name) || byName.get(name + '_temperate');
    if (!path) continue;
    const [w, h] = artSize(name);
    const blob = await find(path), bmp = blob && await decode(blob);
    if (!bmp || bmp.width * h !== bmp.height * w) continue;
    const img = pixels(bmp, 0, 0, bmp.width, bmp.height, w, h), mask = artMask(name);
    if (!mask) continue;
    let ours = 0, both = 0, theirs = 0;
    for (let i = 0; i < w * h; i++) {
      const t = img.data[i * 4 + 3] > 0;
      if (mask[i]) { ours++; if (t) both++; } else if (t) theirs++;
    }
    if (ours && both / ours >= 0.9 && theirs <= 0.2 * (both + theirs)) { setArtImage(name, img); took++; }
  }
  if (took) console.info('resource packs: ' + took + ' mob skins');
}
