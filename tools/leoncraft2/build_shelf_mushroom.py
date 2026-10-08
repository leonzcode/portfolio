"""Leoncraft 2 - the shelf mushroom's two pictures (small and large) for public/leoncraft2/js/render/shelfmushroom.js.

    python tools/leoncraft2/build_shelf_mushroom.py <Pixel-Perfection-Chorus-Eddit root>

Pixel Perfection Legacy's shelf_mushroom_stage0.png and shelf_mushroom_stage1.png (CC BY-SA 4.0, credited in
public/leoncraft2/textures/LICENSE.txt), 32 x 32 each and laid out as the game's models read them, written into the
module as a palette and one character per pixel. Checked pixel by pixel against the game's own two pictures
(October 2026): none of their pixels is the same. The module cuts each model face's piece into a layer of its own.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'leoncraft2', 'js', 'render', 'shelfmushroom.js')
ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'


def encode(path):
    im = Image.open(path).convert('RGBA')
    assert im.size == (32, 32), path
    pal, idx = [], []
    for y in range(32):
        for x in range(32):
            p = im.getpixel((x, y))
            if p[3] == 0:
                p = (0, 0, 0, 0)
            if p not in pal:
                pal.append(p)
            idx.append(ABC[pal.index(p)])
    assert len(pal) <= len(ABC)
    return ['0x%02x%02x%02x%02x' % p for p in pal], ''.join(idx)


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else 'Pixel-Perfection-Chorus-Eddit'
    block = os.path.join(root, 'assets', 'minecraft', 'textures', 'block')
    pics = [encode(os.path.join(block, 'shelf_mushroom_stage%d.png' % s)) for s in (0, 1)]
    body = ',\n'.join('  { pal: [%s],\n    px: \'%s\' }' % (', '.join(pal), px) for pal, px in pics)
    src = HEAD + 'const PICTURES = [\n' + body + ',\n];\n' + TAIL
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(src)
    print('wrote', OUT)


HEAD = '''/* ---------------------------------------------------------------------------
   Leoncraft 2 - the shelf mushroom's pictures, cut into one layer a model
   face (the models and the layer names are in ../shelfmushroom.js).

   The two pictures are Pixel Perfection Legacy's (CC BY-SA 4.0, credited in
   textures/LICENSE.txt), 32 x 32 and laid out as the game's models read
   them, kept here as a palette and one character a pixel (written by
   tools/leoncraft2/build_shelf_mushroom.py). A face's piece goes in the top
   left of its layer, and its edge pixels are carried out to the layer's
   edges, so the smaller copies a distant face is drawn from keep its colour.

     shelfLayers(add);    // dim/art.js addDimArt: the layers, filled at once
--------------------------------------------------------------------------- */
import { SHELF_MODELS, shelfLayer, shelfPiece } from '../shelfmushroom.js?v=33';

'''

TAIL = '''const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// a picture's pixels, 32 x 32 RGBA
function decode(p) {
  const out = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 1024; i++) {
    const c = p.pal[ABC.indexOf(p.px[i])];
    out[i * 4] = c >>> 24; out[i * 4 + 1] = (c >>> 16) & 255; out[i * 4 + 2] = (c >>> 8) & 255; out[i * 4 + 3] = c & 255;
  }
  return out;
}

export function shelfLayers(add) {
  PICTURES.forEach((p, s) => {
    const src = decode(p);
    SHELF_MODELS[s].forEach(([, , faces], b) => {
      for (const f in faces) {
        const [x0, y0, w, h] = shelfPiece(faces[f]);
        const rgba = new Uint8ClampedArray(16 * 16 * 4);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
          const sx = x0 + Math.min(x, w - 1), sy = y0 + Math.min(y, h - 1), o = (sy * 32 + sx) * 4, d = (y * 16 + x) * 4;
          rgba[d] = src[o]; rgba[d + 1] = src[o + 1]; rgba[d + 2] = src[o + 2]; rgba[d + 3] = src[o + 3];
        }
        add(shelfLayer(s, b, f), [rgba], 1, false);
      }
    });
  });
}
'''

if __name__ == '__main__':
    main()
