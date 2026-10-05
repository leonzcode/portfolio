"""
Writes data/vanilla_colour_stats.json: for each block texture of the game's own resource folder, six numbers,
the mean and the spread of its colours in CIE Lab (mean L, a, b, spread L, a, b).

With --items, writes data/vanilla_item_colour_stats.json instead: the same six numbers for every item picture
(the pictures the game tints, like leather armour and potions, as the game shows them by default: the grey base
tinted, the overlay on top), for the untinted layers of potions and tipped arrows ("layer_" + name), and for the
armour model textures ("<material>_layer_1" and "_layer_2"; leather's grey base before tinting is "_dye").

Colour averages only. No pixel, no picture is kept, so nothing of Mojang's art ships in the repo; build_textures.py
and build_items.py only read these numbers and never need the game's files. Run it once, by hand, when the targets
change:

    python tools/leoncraft2/colour_stats.py <folder holding assets/minecraft/textures/block>
    python tools/leoncraft2/colour_stats.py --items <folder holding assets/minecraft/textures/item>
"""
import json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labcolour import lab_stats

HERE = os.path.dirname(os.path.abspath(__file__))
NOTE = ('Mean and spread of each %s\'s colours in CIE Lab: L, a, b, then the spread of L, a, b. '
        'Colour averages only, no pixels. Made by tools/leoncraft2/colour_stats.py.')


def frames16(im):
    """16 x 16 float frames of a texture (a strip of frames, or a wider texture scaled down, nearest)."""
    im = im.convert('RGBA')
    w, h = im.size
    if w != 16:
        im = im.resize((16, max(16, round(h * 16 / w))), Image.NEAREST)
        w, h = im.size
    n = max(1, h // 16)
    return [np.asarray(im.crop((0, i * 16, 16, i * 16 + 16)), np.float32) / 255 for i in range(n)]


def rounded(s):
    return [round(float(v), 1) for v in s] if s is not None else None


def blocks(root):
    block = os.path.join(root, 'assets', 'minecraft', 'textures', 'block')
    stats = {}
    for f in sorted(os.listdir(block)):
        if not f.endswith('.png'):
            continue
        s = lab_stats(frames16(Image.open(os.path.join(block, f))))
        if s is not None:
            stats[f[:-4]] = rounded(s)
    out = {'_note': NOTE % 'block texture', 'stats': stats}
    with open(os.path.join(HERE, 'data', 'vanilla_colour_stats.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'))
    print(len(stats), 'textures')


def tinted(base, over, col):
    """A tinted picture as the game shows it: the base multiplied by the colour, the overlay on top (uint8 RGBA)."""
    r, g, b = col >> 16 & 255, col >> 8 & 255, col & 255
    x = np.asarray(base.convert('RGBA')).astype(np.int32).copy()
    x[..., 0] = x[..., 0] * r // 255
    x[..., 1] = x[..., 1] * g // 255
    x[..., 2] = x[..., 2] * b // 255
    out = Image.new('RGBA', base.size, (0, 0, 0, 0))
    out.alpha_composite(Image.fromarray(x.astype(np.uint8), 'RGBA'))
    out.alpha_composite(over.convert('RGBA'))
    return out


def items(root):
    from build_items import TINTED, RAW_LAYERS, LEATHER
    tex = os.path.join(root, 'assets', 'minecraft', 'textures')
    item = os.path.join(tex, 'item')

    def first(p):
        # the first frame, 16 x 16 (as build_items.py loads pictures)
        return Image.fromarray(np.round(frames16(Image.open(p))[0] * 255).astype(np.uint8), 'RGBA')
    stats = {}
    for f in sorted(os.listdir(item)):
        if f.endswith('.png'):
            stats[f[:-4]] = rounded(lab_stats([np.asarray(first(os.path.join(item, f)), np.float32) / 255]))
    for name, t in TINTED.items():
        pb, po = os.path.join(item, t[1] + '.png'), os.path.join(item, t[2] + '.png')
        if os.path.exists(pb) and os.path.exists(po):
            im = tinted(first(pb), first(po), t[0])
            stats[name] = rounded(lab_stats([np.asarray(im, np.float32) / 255]))
    for name in RAW_LAYERS:
        p = os.path.join(item, name + '.png')
        if os.path.exists(p):
            stats['layer_' + name] = rounded(lab_stats([np.asarray(first(p), np.float32) / 255]))
    stats = {k: v for k, v in stats.items() if v is not None}
    armor = {}
    eq = os.path.join(tex, 'entity', 'equipment')
    for layer, folder in ((1, 'humanoid'), (2, 'humanoid_leggings')):
        d = os.path.join(eq, folder)
        for f in sorted(os.listdir(d)):
            if not f.endswith('.png') or f.endswith('_overlay.png'):
                continue
            mat = {'turtle_scute': 'turtle'}.get(f[:-4], f[:-4])
            im = Image.open(os.path.join(d, f)).convert('RGBA')
            key = '%s_layer_%d' % (mat, layer)
            if mat == 'leather':
                armor[key + '_dye'] = rounded(lab_stats([np.asarray(im, np.float32) / 255]))
                ov = os.path.join(d, 'leather_overlay.png')
                if os.path.exists(ov):
                    im = tinted(im, Image.open(ov), LEATHER)
            armor[key] = rounded(lab_stats([np.asarray(im, np.float32) / 255]))
    out = {'_note': NOTE % 'item picture and armour texture', 'items': stats, 'armor': armor}
    with open(os.path.join(HERE, 'data', 'vanilla_item_colour_stats.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'), sort_keys=True)
    print(len(stats), 'item pictures,', len(armor), 'armour textures')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--items':
        items(sys.argv[2])
    else:
        blocks(sys.argv[1] if len(sys.argv) > 1 else '.')
