"""
Writes data/vanilla_colour_stats.json: for each block texture of the game's own resource folder, six numbers,
the mean and the spread of its colours in CIE Lab (mean L, a, b, spread L, a, b).

Colour averages only. No pixel, no picture is kept, so nothing of Mojang's art ships in the repo; build_textures.py
only reads these numbers and never needs the game's files. Run it once, by hand, when the targets change:

    python tools/leoncraft2/colour_stats.py <folder holding assets/minecraft/textures/block>
"""
import json, os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from labcolour import lab_stats

HERE = os.path.dirname(os.path.abspath(__file__))
root = sys.argv[1] if len(sys.argv) > 1 else '.'
block = os.path.join(root, 'assets', 'minecraft', 'textures', 'block')
stats = {}
for f in sorted(os.listdir(block)):
    if not f.endswith('.png'):
        continue
    im = Image.open(os.path.join(block, f)).convert('RGBA')
    w, h = im.size
    if w != 16:
        im = im.resize((16, max(16, round(h * 16 / w))), Image.NEAREST)
        w, h = im.size
    n = max(1, h // 16)
    frames = [np.asarray(im.crop((0, i * 16, 16, i * 16 + 16)), np.float32) / 255 for i in range(n)]
    s = lab_stats(frames)
    if s is not None:
        stats[f[:-4]] = [round(float(v), 1) for v in s]
out = {'_note': 'Mean and spread of each block texture\'s colours in CIE Lab: L, a, b, then the spread of L, a, b. '
                'Colour averages only, no pixels. Made by tools/leoncraft2/colour_stats.py.',
       'stats': stats}
with open(os.path.join(HERE, 'data', 'vanilla_colour_stats.json'), 'w', encoding='utf-8') as fh:
    json.dump(out, fh, separators=(',', ':'))
print(len(stats), 'textures')
