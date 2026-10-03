"""
Leoncraft 2 - texture build.

Turns the Pixel Perfection CE resource pack (CC BY-SA 4.0, a Minecraft-style
16x pack made from scratch by XSSheep and the community, not Mojang's art)
into the three texture arrays the game's shaders read:

  terrain_albedo.png   colour + alpha, one 16x16 layer per texture, stacked
  terrain_normal.png   RG = tangent-space normal xy, B = ambient occlusion, A = height
  terrain_spec.png     R = smoothness, G = F0 (230+ = metal, albedo is F0),
                       B = subsurface scattering, A = emission

and manifest.json, which names every layer and says how animated ones run.

The normal, specular and emission maps are generated here from each texture
and the kind of material it is, the way the "LabPBR" add-on packs for
Minecraft shaders work, so stone is bumpy and dull, ores glint, metal blocks
are metal and leaves let light through.

Blocks the 1.16 pack has no texture for (deepslate, tuff, copper, cherry,
mangrove...) are derived from its own textures by recolouring, which the
licence allows; the results stay CC BY-SA 4.0.

Run:  python tools/leoncraft2/build_textures.py <path to PixelPerfectionCE-master>
"""
import json, os, sys, colorsys
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'PixelPerfectionCE-master'
BLOCK = os.path.join(SRC, 'assets', 'minecraft', 'textures', 'block')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'leoncraft2', 'textures')
os.makedirs(OUT, exist_ok=True)


def load(name, frame=0):
    """One 16x16 RGBA frame of a pack texture (float 0..1)."""
    im = Image.open(os.path.join(BLOCK, name + '.png')).convert('RGBA')
    w, h = im.size
    if w != 16:  # some flow textures are 32 wide: take one 16x16 quarter
        im = im.resize((16, int(h * 16 / w)), Image.NEAREST)
        w, h = im.size
    n = h // 16
    f = frame % n
    return np.asarray(im.crop((0, f * 16, 16, f * 16 + 16)), dtype=np.float32) / 255.0


def frames_of(name):
    im = Image.open(os.path.join(BLOCK, name + '.png'))
    w, h = im.size
    return max(1, h // w)


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def palette_map(a, dark, light, gamma=1.0, contrast=1.0):
    """Recolour by luminance onto a two-colour ramp (keeps the pack's shading)."""
    l = lum(a)
    m = l.mean()
    l = np.clip((l - m) * contrast + 0.5, 0, 1) ** gamma
    d = np.array(dark, np.float32) / 255.0
    li = np.array(light, np.float32) / 255.0
    out = a.copy()
    out[..., :3] = d + (li - d) * l[..., None]
    return out


def hue_shift(a, mask, target_rgb, keep_light=True):
    """Recolour the masked pixels towards a hue, keeping their lightness."""
    out = a.copy()
    t = np.array(target_rgb, np.float32) / 255.0
    th, ts, tv = colorsys.rgb_to_hsv(*t)
    for y in range(16):
        for x in range(16):
            if not mask[y, x]:
                continue
            r, g, b = a[y, x, :3]
            h, s, v = colorsys.rgb_to_hsv(r, g, b)
            nr, ng, nb = colorsys.hsv_to_rgb(th, max(ts * 0.85, s), v if keep_light else tv)
            out[y, x, :3] = (nr, ng, nb)
    return out


def ore_mask(ore, base):
    d = np.abs(ore[..., :3] - base[..., :3]).sum(-1)
    return d > 0.12


# ---------------------------------------------------------------- derived art
def deepslate():
    s = np.rot90(load('stone'), 1).copy()
    return palette_map(s, (38, 38, 44), (110, 110, 120), 1.0, 1.35)


def deepslate_top():
    return palette_map(load('stone', 0)[::-1].copy(), (40, 40, 46), (106, 106, 116), 1.0, 1.3)


def tuff():
    return palette_map(load('andesite'), (70, 72, 64), (138, 140, 128), 1.0, 1.1)


def calcite():
    return palette_map(load('diorite'), (196, 198, 194), (240, 241, 238), 1.0, 0.75)


def copper_ore():
    ore, st = load('iron_ore'), load('stone')
    m = ore_mask(ore, st)
    out = hue_shift(ore, m, (224, 128, 80))
    # a few greenish (oxidised) pixels, the way copper ore reads
    ys, xs = np.nonzero(m)
    for i in range(0, len(ys), 5):
        out[ys[i], xs[i], :3] = np.array((96, 168, 140)) / 255.0
    return out


def deep_ore(ore_name):
    ore, st = load(ore_name), load('stone')
    m = ore_mask(ore, st)
    base = deepslate()
    out = base.copy()
    out[m] = ore[m]
    return out


def deep_copper():
    ore, st = copper_ore(), load('stone')
    m = ore_mask(load('iron_ore'), st)
    out = deepslate().copy()
    out[m] = ore[m]
    return out


def cherry_log():
    return palette_map(load('dark_oak_log'), (40, 22, 28), (92, 60, 66), 1.0, 1.1)


def cherry_log_top():
    return palette_map(load('dark_oak_log_top'), (80, 48, 52), (190, 140, 140), 1.0, 1.0)


def cherry_leaves():
    a = load('oak_leaves')
    out = palette_map(a, (200, 110, 150), (255, 196, 220), 1.0, 1.2)
    out[..., 3] = a[..., 3]
    return out


def cherry_planks():
    return palette_map(load('birch_planks'), (170, 110, 110), (232, 190, 180), 1.0, 1.1)


def mangrove_log():
    return palette_map(load('jungle_log'), (60, 30, 22), (124, 70, 52), 1.0, 1.1)


def mangrove_log_top():
    return palette_map(load('jungle_log_top'), (90, 40, 34), (160, 80, 64), 1.0, 1.0)


def mangrove_planks():
    return palette_map(load('acacia_planks'), (100, 40, 36), (170, 80, 66), 1.0, 1.0)


def moss_block():
    return palette_map(load('grass_block_top'), (70, 96, 34), (120, 150, 56), 1.0, 1.2)


def mud():
    return palette_map(load('dirt'), (40, 36, 38), (78, 72, 74), 1.0, 1.0)


def packed_mud():
    return palette_map(load('dirt'), (120, 88, 66), (160, 122, 92), 1.0, 0.9)


def powder_snow():
    return palette_map(load('snow'), (226, 236, 244), (250, 252, 255), 1.0, 0.7)


def smooth_basalt():
    return palette_map(load('stone'), (52, 50, 54), (84, 82, 86), 1.0, 0.8)


DERIVED = {
    'deepslate': deepslate, 'deepslate_top': deepslate_top, 'tuff': tuff, 'calcite': calcite,
    'copper_ore': copper_ore, 'deepslate_copper_ore': deep_copper,
    'deepslate_coal_ore': lambda: deep_ore('coal_ore'), 'deepslate_iron_ore': lambda: deep_ore('iron_ore'),
    'deepslate_gold_ore': lambda: deep_ore('gold_ore'), 'deepslate_redstone_ore': lambda: deep_ore('redstone_ore'),
    'deepslate_lapis_ore': lambda: deep_ore('lapis_ore'), 'deepslate_diamond_ore': lambda: deep_ore('diamond_ore'),
    'deepslate_emerald_ore': lambda: deep_ore('emerald_ore'),
    'cherry_log': cherry_log, 'cherry_log_top': cherry_log_top, 'cherry_leaves': cherry_leaves, 'cherry_planks': cherry_planks,
    'mangrove_log': mangrove_log, 'mangrove_log_top': mangrove_log_top, 'mangrove_planks': mangrove_planks,
    'moss_block': moss_block, 'mud': mud, 'packed_mud': packed_mud, 'powder_snow': powder_snow, 'smooth_basalt': smooth_basalt,
}

# ------------------------------------------------------------------ the list
# name -> (source or None for derived, material class, variants, frames)
# Classes drive the generated PBR maps (see MAT below).
T = []
def add(name, cls, src=None, variants=(), anim=None):
    T.append(dict(name=name, cls=cls, src=src or name, variants=list(variants), anim=anim))

# terrain
add('stone', 'stone', variants=['stone1', 'stone2', 'stone3'])
add('deepslate', 'stone'); add('deepslate_top', 'stone')
add('granite', 'stone', variants=['granite1']); add('diorite', 'stone', variants=['diorite1']); add('andesite', 'stone', variants=['andesite1'])
add('tuff', 'stone'); add('calcite', 'stone_smooth'); add('smooth_basalt', 'stone_smooth')
add('bedrock', 'stone'); add('obsidian', 'glassy')
add('dirt', 'soil', variants=['dirt1', 'dirt2']); add('coarse_dirt', 'soil')
add('grass_block_top', 'grass_top', variants=['grass_block_top1', 'grass_block_top2'])
add('grass_block_side', 'soil'); add('grass_block_side_overlay', 'grass_top'); add('grass_block_snow', 'snow')
add('podzol_top', 'soil'); add('podzol_side', 'soil'); add('mycelium_top', 'soil'); add('mycelium_side', 'soil')
add('moss_block', 'grass_top'); add('mud', 'soil_wet'); add('packed_mud', 'soil')
add('sand', 'sand', variants=['sand1', 'sand2']); add('red_sand', 'sand', variants=['red_sand1'])
add('sandstone', 'stone_smooth'); add('sandstone_top', 'stone_smooth'); add('sandstone_bottom', 'stone_smooth')
add('red_sandstone', 'stone_smooth'); add('red_sandstone_top', 'stone_smooth'); add('red_sandstone_bottom', 'stone_smooth')
add('gravel', 'gravel'); add('clay', 'soil_wet')
for c in ['terracotta', 'white_terracotta', 'orange_terracotta', 'yellow_terracotta', 'brown_terracotta', 'red_terracotta', 'light_gray_terracotta']:
    add(c, 'stone_smooth')
add('snow', 'snow'); add('powder_snow', 'snow'); add('ice', 'ice'); add('packed_ice', 'ice'); add('blue_ice', 'ice')
# ores
for o in ['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald']:
    add(o + '_ore', 'ore'); add('deepslate_' + o + '_ore', 'ore')
# wood
for w in ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove']:
    add(w + '_log', 'bark'); add(w + '_log_top', 'wood'); add(w + '_planks', 'wood')
for w in ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry']:
    add(w + '_leaves', 'leaves')
add('mangrove_leaves', 'leaves', src='jungle_leaves')
# plants
add('short_grass', 'plant', src='grass'); add('fern', 'plant')
add('tall_grass_bottom', 'plant'); add('tall_grass_top', 'plant')
add('large_fern_bottom', 'plant'); add('large_fern_top', 'plant')
for f in ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip',
          'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'dead_bush', 'brown_mushroom', 'red_mushroom',
          'sugar_cane', 'sweet_berry_bush_stage3', 'oak_sapling', 'vine', 'lily_pad']:
    add(f, 'plant')
for f in ['sunflower_bottom', 'sunflower_front', 'sunflower_top', 'lilac_bottom', 'lilac_top', 'rose_bush_bottom',
          'rose_bush_top', 'peony_bottom', 'peony_top']:
    add(f, 'plant')
add('cactus_side', 'plant_solid'); add('cactus_top', 'plant_solid'); add('cactus_bottom', 'plant_solid')
add('seagrass', 'plant', anim=dict(frametime=2, frames=1))
add('tall_seagrass_bottom', 'plant'); add('tall_seagrass_top', 'plant')
add('kelp', 'plant'); add('kelp_plant', 'plant')
add('pumpkin_side', 'plant_solid'); add('pumpkin_top', 'plant_solid'); add('melon_side', 'plant_solid'); add('melon_top', 'plant_solid')
# building blocks
add('cobblestone', 'stone', variants=['cobblestone1']); add('mossy_cobblestone', 'stone')
add('stone_bricks', 'stone', variants=['stone_bricks1']); add('mossy_stone_bricks', 'stone'); add('cracked_stone_bricks', 'stone')
add('bricks', 'brick'); add('smooth_stone', 'stone_smooth')
add('glass', 'glass'); add('white_stained_glass', 'glass'); add('blue_stained_glass', 'glass'); add('red_stained_glass', 'glass')
add('glowstone', 'emissive'); add('sea_lantern', 'emissive', anim=dict(frametime=5)); add('jack_o_lantern', 'pumpkin_lit')
add('torch', 'torch'); add('lantern', 'lantern', anim=dict(frametime=8))
add('bookshelf', 'wood'); add('crafting_table_top', 'wood'); add('crafting_table_side', 'wood'); add('crafting_table_front', 'wood')
add('iron_block', 'metal'); add('gold_block', 'metal'); add('diamond_block', 'gem'); add('emerald_block', 'gem')
add('quartz_block_side', 'stone_smooth'); add('quartz_block_top', 'stone_smooth')
for c in ['white', 'red', 'blue', 'yellow', 'green', 'black']:
    add(c + '_wool', 'cloth')
add('hay_block_side', 'plant_solid'); add('hay_block_top', 'plant_solid')
add('magma', 'magma', anim=dict(frametime=8))
# fluids (the shaders draw most of the look; the texture adds a little detail)
add('water_still', 'water', anim=dict(frametime=2))
add('lava_still', 'lava', anim=dict(frametime=3))

# ------------------------------------------------------------ material maps
# per class: normal strength, smoothness (base, from-luminance), F0 byte, SSS, emission rule
MAT = {
    'stone':        dict(n=2.4, s=(0.10, 0.18), f0=10, sss=0.0),
    'stone_smooth': dict(n=1.2, s=(0.25, 0.15), f0=10, sss=0.0),
    'glassy':       dict(n=0.8, s=(0.75, 0.15), f0=14, sss=0.0),
    'soil':         dict(n=1.8, s=(0.04, 0.08), f0=8, sss=0.0),
    'soil_wet':     dict(n=1.2, s=(0.35, 0.10), f0=10, sss=0.0),
    'grass_top':    dict(n=1.6, s=(0.10, 0.10), f0=8, sss=0.35),
    'sand':         dict(n=1.0, s=(0.06, 0.06), f0=9, sss=0.0),
    'gravel':       dict(n=2.6, s=(0.10, 0.20), f0=10, sss=0.0),
    'snow':         dict(n=0.8, s=(0.30, 0.20), f0=9, sss=0.45),
    'ice':          dict(n=0.6, s=(0.88, 0.05), f0=12, sss=0.25),
    'ore':          dict(n=2.4, s=(0.10, 0.18), f0=10, sss=0.0),
    'bark':         dict(n=2.6, s=(0.08, 0.10), f0=9, sss=0.0),
    'wood':         dict(n=1.6, s=(0.22, 0.12), f0=9, sss=0.0),
    'leaves':       dict(n=1.2, s=(0.30, 0.15), f0=9, sss=0.85),
    'plant':        dict(n=0.8, s=(0.22, 0.10), f0=9, sss=0.9),
    'plant_solid':  dict(n=1.4, s=(0.25, 0.15), f0=9, sss=0.35),
    'brick':        dict(n=2.6, s=(0.12, 0.10), f0=10, sss=0.0),
    'glass':        dict(n=0.3, s=(0.95, 0.0), f0=10, sss=0.0),
    'emissive':     dict(n=1.4, s=(0.40, 0.20), f0=10, sss=0.0),
    'pumpkin_lit':  dict(n=1.4, s=(0.30, 0.10), f0=9, sss=0.3),
    'torch':        dict(n=0.6, s=(0.20, 0.10), f0=9, sss=0.0),
    'lantern':      dict(n=1.0, s=(0.60, 0.20), f0=230, sss=0.0),
    'metal':        dict(n=1.0, s=(0.72, 0.18), f0=230, sss=0.0),
    'gem':          dict(n=1.2, s=(0.82, 0.12), f0=40, sss=0.0),
    'cloth':        dict(n=1.4, s=(0.02, 0.05), f0=8, sss=0.25),
    'magma':        dict(n=2.0, s=(0.30, 0.20), f0=10, sss=0.0),
    'water':        dict(n=0.6, s=(0.95, 0.0), f0=5, sss=0.0),
    'lava':         dict(n=1.0, s=(0.40, 0.10), f0=10, sss=0.0),
}


def gen_maps(a, name, cls):
    m = MAT[cls]
    l = lum(a)
    alpha = a[..., 3]
    # height: brightness, with the mortar and the cracks (darker) lower
    h = l.copy()
    if cls in ('brick',):
        h = np.where(l < l.mean() * 0.85, 0.15, 0.85) * 0.6 + l * 0.4
    if cls in ('bark',):
        h = l ** 0.8
    hmin, hmax = h.min(), h.max()
    h = (h - hmin) / max(1e-4, hmax - hmin)
    # normals from the height (wrapping: every tile tiles)
    dx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    dy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    s = m['n']
    nx, ny, nz = -dx * s, -dy * s, np.ones_like(h) * 2.0
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny = nx / ln, ny / ln
    # occlusion: the low spots a little darker
    ao = np.clip(0.55 + 0.45 * h + 0.15, 0, 1)
    normal = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, ao, h], -1)
    # specular
    base, var = m['s']
    smooth = np.clip(base + (l - l.mean()) * var * 2.0, 0, 1)
    f0 = np.full_like(l, m['f0'] / 255.0)
    sss = np.full_like(l, m['sss'])
    emit = np.zeros_like(l)
    if cls == 'ore':
        st = load('stone') if not name.startswith('deepslate') else DERIVED['deepslate']()
        mask = ore_mask(a, st)
        smooth = np.where(mask, 0.82, smooth)
        f0 = np.where(mask, 60 / 255.0, f0)
        if 'redstone' in name:
            emit = np.where(mask, 0.25, 0)
    if cls == 'emissive':
        emit = np.clip((l - 0.25) / 0.75, 0, 1) ** 1.2
    if cls == 'pumpkin_lit':
        hsv = np.array([colorsys.rgb_to_hsv(*a[y, x, :3]) for y in range(16) for x in range(16)]).reshape(16, 16, 3)
        emit = np.where((hsv[..., 1] > 0.5) & (hsv[..., 2] > 0.7) & (hsv[..., 0] < 0.18), 0.9, 0)
    if cls == 'torch':
        emit = np.where((a[..., 0] > 0.6) & (a[..., 0] > a[..., 1] * 1.25) & (a[..., 3] > 0.5), 1.0, 0)
    if cls == 'lantern':
        emit = np.where((a[..., 0] > 0.75) & (a[..., 1] > 0.55), 1.0, 0)
        f0 = np.where(emit > 0, 10 / 255.0, f0)
    if cls == 'magma':
        emit = np.clip((a[..., 0] - a[..., 2] - 0.35) * 2.2, 0, 1)
    if cls == 'lava':
        emit = np.clip(l * 1.4, 0.6, 1.0)
    if cls == 'leaves' or cls == 'plant':
        smooth = np.where(alpha < 0.5, 0, smooth)
    spec = np.stack([smooth, f0, sss, emit], -1)
    return normal, spec


# ------------------------------------------------------------------ assemble
layers_a, layers_n, layers_s = [], [], []
manifest = {}

def push(name, arr, cls):
    n, s = gen_maps(arr, name, cls)
    idx = len(layers_a)
    layers_a.append(arr); layers_n.append(n); layers_s.append(s)
    return idx

for t in T:
    name, cls = t['name'], t['cls']
    if name in DERIVED:
        arr = DERIVED[name]()
        manifest[name] = dict(layer=push(name, arr, cls))
        continue
    src = t['src']
    anim = t['anim']
    if anim and anim.get('frames', 0) != 1:
        nf = frames_of(src)
        first = None
        for f in range(nf):
            i = push(name, load(src, f), cls)
            first = i if first is None else first
        manifest[name] = dict(layer=first, frames=nf, frametime=anim.get('frametime', 2))
    else:
        manifest[name] = dict(layer=push(name, load(src, 0), cls))
    if t['variants']:
        manifest[name]['variants'] = [push(v, load(v, 0), cls) for v in t['variants']]

N = len(layers_a)
print('layers:', N)
assert N <= 256, 'too many layers for a guaranteed WebGL2 texture array'

def save(layers, fname):
    strip = np.concatenate(layers, 0)
    img = Image.fromarray(np.clip(strip * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')
    img.save(os.path.join(OUT, fname), optimize=True)

save(layers_a, 'terrain_albedo.png')
save(layers_n, 'terrain_normal.png')
save(layers_s, 'terrain_spec.png')

# the colour maps for grass and foliage, and the sun and the moon
for f, sub in [('grass.png', 'colormap'), ('foliage.png', 'colormap'), ('sun.png', 'environment'), ('moon_phases.png', 'environment')]:
    Image.open(os.path.join(SRC, 'assets', 'minecraft', 'textures', sub, f)).convert('RGBA').save(os.path.join(OUT, sub + '_' + f))

with open(os.path.join(OUT, 'manifest.json'), 'w') as fh:
    json.dump(dict(size=16, layers=N, textures=manifest), fh, separators=(',', ':'))
print('wrote', OUT)
