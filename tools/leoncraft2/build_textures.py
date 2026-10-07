"""
Leoncraft 2 - texture build.

Turns four free resource packs into the three texture arrays the game's
shaders read:

  terrain_albedo.png   colour + alpha, one 16x16 layer per texture, stacked
  terrain_normal.png   RG = tangent-space normal xy, B = ambient occlusion, A = height
  terrain_spec.png     R = smoothness, G = F0 (230+ = metal, albedo is F0),
                       B = subsurface scattering, A = emission

and manifest.json, which names every layer and says how animated ones run.

Sources, in the order they are tried (all CC BY-SA 4.0, see textures/LICENSE.txt):
  1. REFI Textures (MysticTempest) and Bauniclonia (Mirtilo), for the textures
     listed in data/open_pack_map.json: the terrain, wood, ores, glass and
     farm blocks whose pixel patterns Pixel Perfection draws differently from
     the game (they are original drawings that follow the game's look)
  2. Pixel Perfection Legacy (Nova_Wostra), for the textures in
     data/legacy_preferred.json (its own redraws, nearer the game's than CE's)
  3. Pixel Perfection CE (XSSheep and contributors), Minecraft 1.16 names
  4. Pixel Perfection Legacy for everything else, blocks added since 1.17
  5. a logged fallback: a similar texture from the packs (never magenta)
Whatever the source, each texture is then colour-corrected: its mean colour and
its spread are moved to the game's own (data/vanilla_colour_stats.json, six
numbers per texture, colour averages only, no pixels). That is why the packs'
different palettes read as one set, and it never copies a pixel.
Chests, beds, shulker boxes, signs and mob heads are drawn by the game as
boxes, so their faces are cut out of Pixel Perfection CE's entity textures
and laid out so a box in sixteenths of a block maps 1:1 to pixels.
Flat item icons (doors, signs, seeds, buckets...) come from Pixel Perfection
CE's item folder. Nothing else from either pack is used.

The texture names are every name js/blockdata.js uses (written by
build_blocks.py), every name the older js/blocks.js used
(data/legacy_names.json), the block-breaking stages and the icons.

The normal, specular and emission maps are generated here from each texture
and the kind of material it is (the way the "LabPBR" add-on packs work), so
stone is bumpy and dull, ores glint, metal is metal and leaves let light through.

Run:  python tools/leoncraft2/build_textures.py <PixelPerfectionCE-master> <PixelPerfectionLegacy root> <REFI_Textures> <Bauniclonia>
      (the second is the folder holding assets/minecraft/textures/block; the third and fourth are the packs'
      own folders, searched for the file names in data/open_pack_map.json. The packs are not in the repo:
      keep them anywhere, for example D:\\code\\personal\\texture_sources\\. Without the last two the build
      uses Pixel Perfection only.)
"""
import json, os, re, sys, colorsys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from labcolour import correct, lab_to_srgb
SRC = sys.argv[1] if len(sys.argv) > 1 else 'PixelPerfectionCE-master'
PPL = sys.argv[2] if len(sys.argv) > 2 else 'PixelPerfectionLegacy'
REFI = sys.argv[3] if len(sys.argv) > 3 else 'REFI_Textures'
BAUN = sys.argv[4] if len(sys.argv) > 4 else 'Bauniclonia'
TEX = os.path.join(SRC, 'assets', 'minecraft', 'textures')
BLOCK = os.path.join(TEX, 'block')
ITEM = os.path.join(TEX, 'item')
ENTITY = os.path.join(TEX, 'entity')
PPL_BLOCK = os.path.join(PPL, 'assets', 'minecraft', 'textures', 'block')
GAME = os.path.join(HERE, '..', '..', 'public', 'leoncraft2')
OUT = os.path.join(GAME, 'textures')
os.makedirs(OUT, exist_ok=True)

COLOURS = ['white', 'light_gray', 'gray', 'black', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan',
           'light_blue', 'blue', 'purple', 'magenta', 'pink']

# Pixel Perfection CE is a 1.16 pack: a few files are under their old names
RENAME = {'short_grass': 'grass', 'iron_chain': 'chain', 'dirt_path_side': 'grass_path_side',
          'dirt_path_top': 'grass_path_top'}
# textures neither pack has: the nearest thing that does exist (logged)
FALLBACK = {'decorated_pot_side': 'terracotta', 'vault_top': 'vault_top_off', 'bamboo_fence': 'bamboo_fence_side',
            'pitcher_crop_top_stage_3': 'pitcher_crop_head_stage_3', 'pitcher_crop_top_stage_4': 'pitcher_crop_head_stage_4',
            'sulfur_spike_up_tip': 'sulfur_spike'}
# Pixel Perfection Legacy draws a few blocks as one small atlas: the 16x16 piece each face uses
CROPS = {'sniffer_egg_not_cracked_top': ('sniffer_egg_not_cracked', (0, 0, 16, 16)),
         'sniffer_egg_not_cracked_bottom': ('sniffer_egg_not_cracked', (0, 0, 16, 16)),
         'sniffer_egg_not_cracked_east': ('sniffer_egg_not_cracked', (0, 16, 16, 32)),
         'sniffer_egg_not_cracked_north': ('sniffer_egg_not_cracked', (0, 16, 16, 32)),
         'sniffer_egg_not_cracked_south': ('sniffer_egg_not_cracked', (0, 16, 16, 32)),
         'dried_ghast_hydration_0_top': ('dried_ghast', (0, 0, 16, 16)),
         'dried_ghast_hydration_0_bottom': ('dried_ghast', (0, 0, 16, 16)),
         'dried_ghast_hydration_0_east': ('dried_ghast', (16, 16, 32, 32)),
         'dried_ghast_hydration_0_south': ('dried_ghast', (16, 16, 32, 32)),
         'dried_ghast_hydration_0_north': ('dried_ghast', (8, 10, 24, 26)),
         'straw_bed': ('straw_bed', (16, 26, 32, 42)),
         'shelf_mushroom_stage0': ('shelf_mushroom_stage0', (0, 0, 16, 16))}
# kept animated (all frames); everything else uses its first frame
ANIMATED = {'water_still', 'water_flow', 'lava_still', 'lava_flow', 'sea_lantern', 'magma', 'prismarine', 'fire_0',
            'soul_fire_0', 'nether_portal', 'seagrass', 'kelp', 'kelp_plant', 'tall_seagrass_bottom',
            'tall_seagrass_top', 'sculk', 'sculk_vein', 'sculk_catalyst_top', 'sculk_catalyst_side'}
# extra random-looking copies of a texture (the world picks one per block)
VARIANTS = {'stone': ['stone1', 'stone2', 'stone3'], 'granite': ['granite1'], 'diorite': ['diorite1'],
            'andesite': ['andesite1'], 'dirt': ['dirt1', 'dirt2'], 'grass_block_top': ['grass_block_top1', 'grass_block_top2'],
            'sand': ['sand1', 'sand2'], 'red_sand': ['red_sand1'], 'cobblestone': ['cobblestone1'],
            'stone_bricks': ['stone_bricks1']}

log_fallback, log_ppl, log_resized = [], [], []


# ---------------------------------------------------------------- loading
def to_f(im):
    return np.asarray(im.convert('RGBA'), dtype=np.float32) / 255.0


def norm16(im):
    """Width 16 (nearest), height a multiple of 16."""
    w, h = im.size
    if w != 16:
        nh = max(16, int(round(h * 16 / w)))
        im = im.resize((16, nh), Image.NEAREST)
        w, h = im.size
    if h % 16:
        im = im.resize((16, max(16, (h // 16) * 16)), Image.NEAREST)
    return im


# ---------------------------------------------------------------- provenance
# A pixel audit against the game's own files (2026-10-03) found that a few
# textures in the packs are Mojang's pixels, copied or traced, despite the
# packs' licence. None of them ship. They come from the other pack when its
# version is original, from our own drawings in art/, or from an original
# texture recoloured. Re-run the audit before adding anything from a pack.
ART = os.path.join(HERE, 'art')
NOT_FROM_CE = {'conduit', 'debug', 'debug2', 'jigsaw_top', 'jigsaw_side', 'jigsaw_bottom', 'jigsaw_lock', 'nether_portal',
               'portal', 'structure_block', 'structure_block_load', 'structure_block_save', 'structure_block_corner',
               'structure_block_data', 'tripwire', 'trip_wire', 'wither_rose'}
NOT_FROM_PPL = {'bamboo_stage0', 'pitcher_crop_bottom', 'debug', 'trip_wire'}
# The same audit, run on every texture REFI and Bauniclonia supply (2026-10-03): none shares even a quarter of its
# pixels with the game's, and the few layouts that follow the game's (TNT's lettering, brick rows) are drawn in
# other pixels and other colours.


def _walk(root, sub):
    """{file name without .png: path} of every png under root/sub (or root); {} if the folder is not there."""
    base = os.path.join(root, sub)
    if not os.path.isdir(base):
        base = root
    idx = {}
    if os.path.isdir(base):
        for dp, dn, fn in os.walk(base):
            for f in sorted(fn):
                if f.endswith('.png'):
                    idx.setdefault(f[:-4], os.path.join(dp, f))
    return idx


OPEN = json.load(open(os.path.join(HERE, 'data', 'open_pack_map.json'), encoding='utf-8'))
OPEN_IDX = {'refi': _walk(REFI, 'textures'), 'baun': _walk(BAUN, 'mineclonia')}
for _k, _p in (('refi', REFI), ('baun', BAUN)):
    if not OPEN_IDX[_k]:
        print('NOTE: no %s pack found at %s, the build uses Pixel Perfection for its textures' % (_k, _p))
LEGACY_FIRST = set(json.load(open(os.path.join(HERE, 'data', 'legacy_preferred.json'), encoding='utf-8'))['names'])
# six colour numbers per game texture: mean and spread of its Lab colours. Averages only, no pixels.
STATS = json.load(open(os.path.join(HERE, 'data', 'vanilla_colour_stats.json'), encoding='utf-8'))['stats']
SRC_OF = {}              # texture -> 'refi' | 'baun' | 'legacy' | 'ce'
NO_CORRECT = set()       # textures that keep the colours they are drawn in (filled in below)
n_corrected = [0]


def find_pp(name):
    """Path of a block texture in Pixel Perfection, or None: CE first, then Legacy."""
    if name not in NOT_FROM_CE and name not in LEGACY_FIRST:
        for n in (RENAME.get(name, name), name):
            p = os.path.join(BLOCK, n + '.png')
            if os.path.exists(p):
                return p, 'ce'
    p = os.path.join(PPL_BLOCK, name + '.png')
    if os.path.exists(p) and name not in NOT_FROM_PPL:
        return p, 'legacy'
    if name not in NOT_FROM_CE:
        for n in (RENAME.get(name, name), name):
            p = os.path.join(BLOCK, n + '.png')
            if os.path.exists(p):
                return p, 'ce'
    return None, None


def find(name):
    """Path of a block texture, or None: REFI / Bauniclonia for the textures in the map, then Legacy's own redraws,
    then Pixel Perfection CE, then Legacy."""
    for key in ('refi', 'baun'):
        n = OPEN[key].get(name)
        if n and n in OPEN_IDX[key]:
            return OPEN_IDX[key][n], key
    return find_pp(name)


def frames_of(path, animated):
    """List of 16x16 float frames (one unless the texture is kept animated) and its frametime."""
    im = Image.open(path).convert('RGBA')
    if im.size[0] != 16:
        log_resized.append('%s %dx%d' % (os.path.basename(path), im.size[0], im.size[1]))
    im = norm16(im)
    n = im.size[1] // 16
    tiles = [to_f(im.crop((0, i * 16, 16, i * 16 + 16))) for i in range(n)]
    meta = path + '.mcmeta'
    ft, order, interp = 1, list(range(n)), False
    if os.path.exists(meta):
        try:
            a = json.load(open(meta, encoding='utf-8')).get('animation', {})
            ft = a.get('frametime', 1)
            interp = bool(a.get('interpolate'))
            fr = a.get('frames')
            if fr:
                order = [f if isinstance(f, int) else f.get('index', 0) for f in fr]
                order = [i for i in order if i < n] or [0]
        except Exception:
            pass
    if not animated or n == 1:
        return [tiles[order[0] if order else 0]], None
    return [tiles[i] for i in order], dict(frametime=ft, interpolate=interp)


def finish(name, frames):
    """Colour-correct a texture's frames to the game's mean colour and spread (alpha stays as drawn).
    Textures the game tints at run time (grass, leaves, water...) are grey in the game: corrected the same way, and the
    colour channels flattened, so the biome tint lands on them as it does there."""
    t = STATS.get(name)
    if t is None or name in NO_CORRECT:
        return frames
    n_corrected[0] += 1
    return correct(frames, t, name in TINTED and abs(t[1]) < 3 and abs(t[2]) < 3)


def block_tex(name, raw=False):
    if name in CROPS:
        f, box = CROPS[name]
        log_ppl.append(name)
        return [to_f(Image.open(os.path.join(PPL_BLOCK, f + '.png')).convert('RGBA').crop(box))], None
    p, src = find(name)
    if p is None:
        return None
    if src == 'legacy':
        log_ppl.append(name)
    SRC_OF[name] = src
    frames, anim = frames_of(p, name in ANIMATED)
    return (frames if raw else finish(name, frames)), anim


def ent(path):
    return Image.open(os.path.join(ENTITY, path)).convert('RGBA')


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def palette_map(a, dark, light, contrast=1.0):
    """Recolour by luminance onto a two-colour ramp (keeps the pack's shading)."""
    l = lum(a)
    m = l[a[..., 3] > 0.5].mean() if (a[..., 3] > 0.5).any() else 0.5
    l = np.clip((l - m) * contrast + 0.5, 0, 1)
    d = np.array(dark, np.float32) / 255.0
    li = np.array(light, np.float32) / 255.0
    out = a.copy()
    out[..., :3] = d + (li - d) * l[..., None]
    return out


def ramp_of(a):
    """Dark and light colours of a texture (10th and 90th luminance percentile)."""
    l = lum(a)
    m = a[..., 3] > 0.5
    px, ll = a[m][:, :3], l[m]
    lo = px[ll <= np.percentile(ll, 15)].mean(0) * 255
    hi = px[ll >= np.percentile(ll, 85)].mean(0) * 255
    return tuple(lo), tuple(hi)


def blank():
    return np.zeros((16, 16, 4), np.float32)


def paste(dst, img, x, y):
    a = to_f(img)
    h, w = a.shape[:2]
    m = a[..., 3:4] > 0.01
    region = dst[y:y + h, x:x + w]
    region[:] = np.where(m, a, region)
    return dst


# --------------------------------------------- composed entity faces
# Minecraft's box UV layout: a box w x h x d at (u, v) has its two big faces at
# (u+d, v) and (u+d+w, v), and its four sides along v+d. For chests the y axis
# points up, so the side strips are upside down in the file.
#
# Each composed layer is a list of cuts from one 64 x 64 entity picture: (sx, sy,
# w, h, dx, dy, flip), the piece at (sx, sy) pasted at (dx, dy) over what is
# there (where it is not clear), flip 1 turning it top to bottom first. The same
# lists go out as textures/composed.json, so a player's own copy of the game
# (ui/pack.js) is cut up the same way and its chests, beds and shulker boxes
# look like the game's.
CUTS = {}           # layer name -> [entity picture (under textures/entity/), [cuts]]


def cut(img, pieces):
    t = blank()
    for sx, sy, w, h, dx, dy, fl in pieces:
        c = img.crop((sx, sy, sx + w, sy + h))
        if fl:
            c = c.transpose(Image.FLIP_TOP_BOTTOM)
        paste(t, c, dx, dy)
    return t


def chest_cuts(file):
    # the box is x 1..15, y 0..14: rows 2..16 of the layer; the lid (y 9..14) over the base (y 0..9); the front
    # carries the latch's picture where the latch sits (y 7..11, x 7..9)
    side = lambda u: [(u, 33, 14, 9, 1, 7, 1), (u, 14, 14, 5, 1, 2, 1)]
    return {'top': ['chest/' + file, [(28, 0, 14, 14, 1, 1, 0)]],
            'bottom': ['chest/' + file, [(14, 19, 14, 14, 1, 1, 0)]],
            'front': ['chest/' + file, side(42) + [(1, 1, 2, 4, 7, 5, 1)]],
            'side': ['chest/' + file, side(0)]}


def bed_cuts(colour):
    """The pieces of a bed (models.js bed lays them on with these positions):
       head_top, foot_top   each half's top as it is, the pillow at row 0 of the head's
       head_side, foot_side the half's west side (x 0-5) and east side (x 6-11), as they are in the picture
       head_end             the head's end (rows 0-5), the foot's end (rows 6-11), a leg's four sides
                            (x 0-11, rows 12-14) and its foot (x 12-14)
       foot_end             the underside"""
    f = 'bed/' + colour + '.png'
    return {'head_top': [f, [(6, 6, 16, 16, 0, 0, 0)]], 'foot_top': [f, [(6, 28, 16, 16, 0, 0, 0)]],
            'head_side': [f, [(0, 6, 6, 16, 0, 0, 0), (22, 6, 6, 16, 6, 0, 0)]],
            'foot_side': [f, [(0, 28, 6, 16, 0, 0, 0), (22, 28, 6, 16, 6, 0, 0)]],
            'head_end': [f, [(6, 0, 16, 6, 0, 0, 0), (22, 22, 16, 6, 0, 6, 0), (50, 3, 12, 3, 0, 12, 0), (56, 0, 3, 3, 12, 12, 0)]],
            'foot_end': [f, [(28, 6, 16, 16, 0, 0, 0)]]}


def shulker_cuts(file):
    f = 'shulker/' + file
    # the side: the lid, 12 tall, over the base's lower four rows
    return {'top': [f, [(16, 0, 16, 16, 0, 0, 0)]], 'bottom': [f, [(32, 28, 16, 16, 0, 0, 0)]],
            'side': [f, [(16, 48, 16, 4, 0, 12, 0), (16, 16, 16, 12, 0, 0, 0)]]}


def sign_faces(img):
    """sign_<wood>: the board (y 8..16) on its post (y 0..8); wall_sign_<wood>: the board at y 4..12."""
    board = img.crop((2, 2, 26, 14)).resize((16, 8), Image.NEAREST)
    post = img.crop((2, 16, 4, 30)).resize((2, 8), Image.NEAREST)
    s = blank(); paste(s, board, 0, 0); paste(s, post, 7, 8)
    w = blank(); paste(w, board, 0, 4)
    return s, w


def head_faces(img, kind):
    """The 8x8x8 head of a mob texture, placed where a head box (x 4..12, y 0..8) samples it."""
    if kind == 'piglin':   # piglin heads are 10 wide: take the middle 8
        r = {'top': (9, 0, 17, 8), 'front': (9, 8, 17, 16), 'side': (0, 8, 8, 16), 'back': (27, 8, 35, 16)}
    else:
        r = {'top': (8, 0, 16, 8), 'front': (8, 8, 16, 16), 'side': (0, 8, 8, 16), 'back': (24, 8, 32, 16)}
    out = {}
    for k, box in r.items():
        t = blank()
        paste(t, img.crop(box), 4, 4 if k == 'top' else 8)
        out[k] = t
    return out


COMPOSED = {}


def compose_cuts(name, spec):
    CUTS[name] = spec
    COMPOSED[name] = cut(ent(spec[0]), spec[1])


def compose_all():
    chests = {'chest': 'normal.png', 'trapped_chest': 'trapped.png', 'ender_chest': 'ender.png'}
    for k, f in chests.items():
        for face, spec in chest_cuts(f).items():
            compose_cuts(k + '_' + face, spec)
    # copper chests: the wooden chest recoloured to each copper stage (the game's own copper chests, when a player
    # opens their copy of the game, are cut from its pictures: the entries in composed.json)
    for age, file in (('', 'copper.png'), ('exposed_', 'copper_exposed.png'), ('weathered_', 'copper_weathered.png'), ('oxidized_', 'copper_oxidized.png')):
        base = block_tex(age + 'copper' if age else 'copper_block')[0][0]
        dark, light = ramp_of(base)
        for face, spec in chest_cuts(file).items():
            a = palette_map(COMPOSED['chest_' + face], dark, light, 1.2)
            a[..., 3] = COMPOSED['chest_' + face][..., 3]
            COMPOSED[age + 'copper_chest_' + face] = a
            CUTS[age + 'copper_chest_' + face] = spec
    for c in COLOURS:
        for k, spec in bed_cuts(c).items():
            compose_cuts('bed_%s_%s' % (c, k), spec)
        for k, spec in shulker_cuts('shulker_%s.png' % c).items():
            compose_cuts('shulker_box_%s_%s' % (c, k), spec)
    for k, spec in shulker_cuts('shulker.png').items():
        compose_cuts('shulker_box_' + k, spec)
    # signs: the eight woods Pixel Perfection CE has; the newer woods are the oak sign recoloured to their planks
    oak = ent('signs/oak.png')
    for w in ('oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped', 'mangrove', 'cherry',
              'pale_oak', 'poplar', 'bamboo'):
        p = os.path.join(ENTITY, 'signs', w + '.png')
        if os.path.exists(p):
            img = Image.open(p).convert('RGBA')
        else:
            planks = block_tex(w + '_planks')[0][0]
            dark, light = ramp_of(planks)
            a = palette_map(to_f(oak), dark, light, 1.1)
            a[..., 3] = to_f(oak)[..., 3]
            img = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')
            log_fallback.append('sign_%s: oak sign recoloured to %s_planks' % (w, w))
        s, wl = sign_faces(img)
        COMPOSED['sign_' + w], COMPOSED['wall_sign_' + w] = s, wl
    heads = {'skeleton': 'skeleton/skeleton.png', 'wither_skeleton': 'skeleton/wither_skeleton.png',
             'zombie': 'zombie/zombie.png', 'creeper': 'creeper/creeper.png',
             'piglin': 'piglin/piglin.png'}
    for k, f in heads.items():
        for face, a in head_faces(ent(f), k).items():
            COMPOSED['head_%s_%s' % (k, face)] = a
        r = {'top': (9, 0), 'front': (9, 8), 'side': (0, 8), 'back': (27, 8)} if k == 'piglin' else \
            {'top': (8, 0), 'front': (8, 8), 'side': (0, 8), 'back': (24, 8)}
        for face, (sx, sy) in r.items():
            CUTS['head_%s_%s' % (k, face)] = [f, [(sx, sy, 8, 8, 4, 4 if face == 'top' else 8, 0)]]
    # the player head is the game's own default skin (original art), not the pack's
    skin = Image.open(os.path.join(GAME, 'textures', 'skin', 'default.png')).convert('RGBA')
    for face, a in head_faces(skin, 'player').items():
        COMPOSED['head_player_' + face] = a
    # the dragon head is a stand-in: obsidian with the dragon's purple eyes
    ob = block_tex('obsidian')[0][0]
    for face in ('top', 'side', 'back', 'front'):
        t = blank(); t[4 if face == 'top' else 8:12 if face == 'top' else 16, 4:12] = ob[0:8, 0:8]
        if face == 'front':
            t[10:12, 5:7, :3] = (0.8, 0.3, 0.95); t[10:12, 9:11, :3] = (0.8, 0.3, 0.95)
        COMPOSED['head_dragon_' + face] = t
    log_fallback.append('head_dragon_*: stand-in (obsidian with purple eyes)')
    # pointed dripstone: Legacy has no spike of its own, so its sulfur spike recoloured to dripstone
    spike = block_tex('sulfur_spike')[0][0]
    dark, light = ramp_of(block_tex('dripstone_block')[0][0])
    a = palette_map(spike, dark, light, 1.2); a[..., 3] = spike[..., 3]
    COMPOSED['pointed_dripstone_up_tip'] = a
    log_fallback.append('pointed_dripstone_up_tip: sulfur_spike recoloured to dripstone_block')
    # the end portal: our own star field (the pack's is a copy of the game's)
    COMPOSED['end_portal'] = to_f(Image.open(os.path.join(ART, 'end_portal.png')).convert('RGBA'))


def item_tex(name):
    """item_<x>: a flat icon. Pixel Perfection CE's item folder, else a door made from its block halves."""
    x = name[5:]
    p = os.path.join(ITEM, x + '.png')
    if os.path.exists(p):
        return [to_f(norm16(Image.open(p).convert('RGBA')).crop((0, 0, 16, 16)))]
    if x.endswith('_door'):
        top, bot = block_tex(x + '_top'), block_tex(x + '_bottom')
        if top and bot:
            t = blank()
            t[0:8, 4:12] = top[0][0][::2, ::2]
            t[8:16, 4:12] = bot[0][0][::2, ::2]
            return [t]
    return None


# ---------------------------------------------------------------- names
def names_from_blockdata():
    src = open(os.path.join(GAME, 'js', 'blockdata.js'), encoding='utf-8').read()
    body = src.split('export const DATA = [', 1)[1].rsplit('];', 1)[0]
    data = json.loads('[' + body + ']')
    out = {}
    def add(n, d, role):
        if isinstance(n, str) and n:
            out.setdefault(n, (d, role))
    for d in data:
        t = d.get('tex')
        if isinstance(t, dict):
            for k, v in t.items():
                add(v, d, k)
        else:
            add(t, d, 'all')
        for k in ('texUpper', 'texLit', 'texFlow', 'texLine', 'texFire', 'texBase', 'texLever', 'plant', 'candle',
                  'content'):
            add(d.get(k), d, k)
        add(d.get('icon'), d, 'icon')
    return data, out


DATA, USED = names_from_blockdata()
LEGACY = json.load(open(os.path.join(HERE, 'data', 'legacy_names.json'), encoding='utf-8'))
# textures the game multiplies by a biome colour (grass, leaves, water, vines, lily pads, stems...)
TINTED = set()
for _d in DATA:
    if _d.get('tint'):
        _t = _d.get('tex')
        for _n in (list(_t.values()) if isinstance(_t, dict) else [_t]) + [_d.get('overlay'), _d.get('texUpper'), _d.get('plant')]:
            if isinstance(_n, str):
                TINTED.add(_n)


# ---------------------------------------------------------------- materials
def cls_of(name):
    """Material class for the generated normal and specular maps, by name (and the block using it)."""
    n = name
    d, role = USED.get(n, (None, None))
    shape = d['shape'] if d else None
    if n.startswith('item_') or n.startswith('destroy_stage'):
        return 'item'
    if n in ('water_still', 'water_flow'):
        return 'water'
    if n.startswith('lava'):
        return 'lava'
    if n == 'magma':
        return 'magma'
    if n == 'jack_o_lantern':
        return 'pumpkin_lit'
    if re.search(r'(^fire_|soul_fire|campfire_fire|nether_portal|end_portal$|glowstone|sea_lantern|froglight|shroomlight|'
                 r'redstone_lamp_on|copper_bulb_lit|respawn_anchor_top$|beacon|end_rod|_lit$|lit_log|log_lit)', n):
        return 'emissive'
    if re.search(r'torch', n) and 'torchflower' not in n:
        return 'torch'
    if re.search(r'lantern', n):
        return 'lantern'
    if re.search(r'(_ore$|ancient_debris|gilded_blackstone)', n):
        return 'ore'
    if re.search(r'(^iron_|^gold_block|copper|netherite_block|^chain$|iron_chain|anvil|rail|hopper|cauldron|heavy_core|'
                 r'lightning_rod|^bell_|smithing_table|lodestone)', n) and 'raw_' not in n and 'ore' not in n:
        return 'metal'
    if re.search(r'(diamond_block|emerald_block|lapis_block|amethyst|redstone_block|_bud$|crying_obsidian_x)', n):
        return 'gem'
    if re.search(r'(glass|^ice$|honey_block|slime_block)', n):
        return 'glass' if 'glass' in n else 'ice'
    if re.search(r'(packed_ice|blue_ice|frosted_ice)', n):
        return 'ice'
    if re.search(r'(^snow$|powder_snow|grass_block_snow)', n):
        return 'snow'
    if re.search(r'(obsidian)', n):
        return 'glassy'
    if re.search(r'(_leaves|azalea_top|azalea_side|^vine$|_vines|hanging_moss|hanging_roots|leaf_litter)', n):
        return 'leaves'
    if shape in ('cross', 'crop', 'pad') or role in ('texUpper', 'plant') or re.search(
            r'(sapling|_tulip|^poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily|_rose$|^rose_bush|peony|lilac|'
            r'sunflower|fern|short_grass|tall_grass|dead_bush|_coral$|_coral_fan|seagrass|^kelp|sugar_cane|_stage\d|'
            r'_stem$|fungus|_roots$|sprouts|mushroom$|petals|wildflowers|dripleaf|spore_blossom|eyeblossom|propagule|'
            r'bush|_shrub|cobweb|glow_lichen|sculk_vein|lily_pad|cactus_flower|pitcher|torchflower)', n):
        return 'plant'
    if re.search(r'(_wool$|^bed_|carpet)', n):
        return 'cloth'
    if re.search(r'(^sand|red_sand|suspicious_sand|concrete_powder|soul_sand)', n):
        return 'sand'
    if re.search(r'(gravel)', n):
        return 'gravel'
    if re.search(r'(grass_block_top|grass_block_side_overlay|moss_block|pale_moss|moss_carpet|nylium$|_nylium_top)', n):
        return 'grass_top'
    if re.search(r'(^mud$|^clay$|muddy|sculk)', n):
        return 'soil_wet'
    if re.search(r'(dirt|podzol|mycelium|farmland|grass_block_side|soul_soil|packed_mud|grass_path|dirt_path|nylium)', n):
        return 'soil'
    if re.search(r'(_log$|_stem$|_hyphae$|^mushroom_stem|_log\d$|bamboo_block$)', n) and 'stripped' not in n:
        return 'bark'
    if re.search(r'(planks|_log_top|stripped|bookshelf|crafting_table|barrel|composter|ladder|_door_|_trapdoor$|^chest_|'
                 r'trapped_chest|_sign|lectern|loom|beehive|bee_nest|note_block|jukebox|scaffolding|cartography|'
                 r'fletching|_shelf$|bamboo|campfire_log$|mosaic|^lever$|tripwire_hook)', n):
        return 'wood'
    if re.search(r'(bricks|tiles|brick$)', n):
        return 'brick'
    if re.search(r'(pumpkin|melon|hay_block|cactus|dried_kelp|sponge|wart_block|honeycomb|mushroom_block|target|'
                 r'cake|chorus|turtle_egg|sniffer_egg|dried_ghast|creaking_heart|resin)', n):
        return 'plant_solid'
    if re.search(r'(smooth|polished|terracotta|concrete|quartz|sandstone|purpur|calcite|chiseled|cut_|shulker|'
                 r'head_|decorated_pot|wall_sign|flower_pot)', n):
        return 'stone_smooth'
    return 'stone'


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
    'item':         dict(n=0.0, s=(0.20, 0.0), f0=9, sss=0.0),
}

ORE_MASK = {}


def ore_mask(name, a):
    """Which pixels of an ore are ore and not rock: the difference from the plain stone the same pack draws it on
    (compared before the colour correction, so a texture moved to another palette still lines up). a: the finished texture,
    used when the texture is a stand-in with no source of its own."""
    b = 'deepslate' if name.startswith('deepslate_') else 'netherrack' if name.startswith('nether_') else 'stone'
    src = SRC_OF.get(name)
    if src in OPEN_IDX:
        n = OPEN['bases'][src].get(b)
        path = OPEN_IDX[src].get(n) if n else None
    else:
        path = find_pp(b)[0]
    r = block_tex(name, raw=True) if path else None
    if r is None:
        return np.abs(a[..., :3] - block_tex(b)[0][0][..., :3]).sum(-1) > 0.12
    base = frames_of(path, False)[0][0]
    return np.abs(r[0][0][..., :3] - base[..., :3]).sum(-1) > 0.12


def gen_maps(a, name, cls):
    m = MAT[cls]
    l = lum(a)
    alpha = a[..., 3]
    h = l.copy()
    if cls == 'brick':
        h = np.where(l < l.mean() * 0.85, 0.15, 0.85) * 0.6 + l * 0.4
    if cls == 'bark':
        h = l ** 0.8
    hmin, hmax = h.min(), h.max()
    h = (h - hmin) / max(1e-4, hmax - hmin)
    dx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    dy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    s = m['n']
    nx, ny, nz = -dx * s, -dy * s, np.ones_like(h) * 2.0
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny = nx / ln, ny / ln
    ao = np.clip(0.55 + 0.45 * h + 0.15, 0, 1)
    if cls == 'item':
        h = np.full_like(h, 0.5); ao = np.ones_like(h)
    normal = np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, ao, h], -1)
    base, var = m['s']
    smooth = np.clip(base + (l - l.mean()) * var * 2.0, 0, 1)
    f0 = np.full_like(l, m['f0'] / 255.0)
    sss = np.full_like(l, m['sss'])
    emit = np.zeros_like(l)
    if cls == 'ore':
        mask = ORE_MASK.get(name)
        if mask is None:
            mask = ORE_MASK[name] = ore_mask(name, a)
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
        if 'soul' in name:
            emit = np.where((a[..., 2] > 0.6) & (a[..., 3] > 0.5) & (a[..., 2] > a[..., 0]), 1.0, emit)
    if cls == 'lantern':
        emit = np.where((a[..., 0] > 0.75) & (a[..., 1] > 0.55), 1.0, 0)
        if 'soul' in name:
            emit = np.where((a[..., 2] > 0.7) & (a[..., 1] > 0.6), 1.0, emit)
        f0 = np.where(emit > 0, 10 / 255.0, f0)
    if cls == 'magma':
        emit = np.clip((a[..., 0] - a[..., 2] - 0.35) * 2.2, 0, 1)
    if cls == 'lava':
        emit = np.clip(l * 1.4, 0.6, 1.0)
    if cls in ('leaves', 'plant'):
        smooth = np.where(alpha < 0.5, 0, smooth)
    spec = np.stack([smooth, f0, sss, emit], -1)
    return normal, spec


# ------------------------------------------------------------------ assemble
compose_all()

names = []
# the looks a block takes on with its state (crop stages, lit lamps, powered repeaters...), read by js/sim/states.js;
# each was checked against the game's textures with the same copy audit as the rest (2026-10-04)
STATES = json.load(open(os.path.join(HERE, 'data', 'state_textures.json'), encoding='utf-8'))
for n in list(LEGACY) + sorted(USED) + ['destroy_stage_%d' % i for i in range(10)] + STATES:
    if n not in names:
        names.append(n)


def similar(name):
    """A stand-in for a texture neither pack has: strip suffixes until something exists."""
    cands = []
    if name in FALLBACK:
        cands.append(FALLBACK[name])
    n = name
    for pat, rep in [(r'_lit$', ''), (r'_on$', ''), (r'_top$', ''), (r'_side$', ''), (r'_bottom$', ''),
                     (r'_front$', ''), (r'_end$', ''), (r'_up_tip$', ''), (r'_stage_?\d+$', ''), (r'\d+$', '')]:
        n2 = re.sub(pat, rep, n)
        if n2 != n:
            cands.append(n2)
            n = n2
    cands += [name + '_side', name + '_top', name.replace('waxed_', ''), re.sub(r'^(exposed|weathered|oxidized)_', '', name)]
    for c in cands:
        if c in COMPOSED:
            return c, [COMPOSED[c]], None
        r = block_tex(c)
        if r:
            return c, r[0], r[1]
    return None, None, None


layers_a, layers_n, layers_s = [], [], []
manifest = {}


def push(name, arr, cls):
    n, s = gen_maps(arr, name, cls)
    layers_a.append(arr); layers_n.append(n); layers_s.append(s)
    return len(layers_a) - 1


def recoloured(src, ramp=None, dark=None, light=None, contrast=1.1):
    a = block_tex(src)[0][0]
    if ramp:
        dark, light = ramp_of(block_tex(ramp)[0][0])
    out = palette_map(a, dark, light, contrast)
    out[..., 3] = a[..., 3]
    return [out]


def art(f):
    return [to_f(Image.open(os.path.join(ART, f)).convert('RGBA'))]


def ppl(name, animated=False):
    return frames_of(os.path.join(PPL_BLOCK, name + '.png'), animated)


# glazed terracottas whose design traced the game's: each takes one of the pack's own designs, in its colour
GLAZED = {'green': 'white', 'light_blue': 'magenta', 'purple': 'orange', 'red': 'black', 'yellow': 'light_gray',
          'lime': 'cyan', 'pink': 'gray'}
REPLACE = {
    'tripwire': lambda: (art('tripwire.png'), None),
    'nether_portal': lambda: ppl('nether_portal', True),
    'wither_rose': lambda: ppl('wither_rose'),
    'conduit': lambda: (recoloured('prismarine_bricks', dark=(70, 52, 30), light=(200, 170, 120)), None),
    'bamboo_stage0': lambda: (recoloured('sugar_cane', dark=(50, 92, 22), light=(150, 190, 70)), None),
    'bamboo_stalk': lambda: (recoloured('sugar_cane', dark=(60, 100, 24), light=(170, 200, 80)), None),
    'honey_block_top': lambda: (recoloured('slime_block', dark=(190, 110, 20), light=(252, 196, 70)), None),
    'honey_block_side': lambda: (recoloured('slime_block', dark=(180, 104, 18), light=(246, 186, 60)), None),
    'honey_block_bottom': lambda: (recoloured('slime_block', dark=(170, 98, 16), light=(240, 176, 52)), None),
    'loom_side': lambda: (block_tex('spruce_planks')[0], None),
    'loom_bottom': lambda: (block_tex('oak_planks')[0], None),
    'grindstone_side': lambda: (block_tex('smooth_stone')[0], None),
    'grindstone_pivot': lambda: (block_tex('spruce_planks')[0], None),
    'lectern_sides': lambda: (block_tex('oak_planks')[0], None),
    'cherry_log_top': lambda: (recoloured('oak_log_top', ramp='cherry_log'), None),
    'bee_nest_top': lambda: (recoloured('hay_block_top', dark=(150, 96, 30), light=(236, 196, 92)), None),
    'bee_nest_side': lambda: (recoloured('hay_block_side', dark=(150, 96, 30), light=(236, 196, 92)), None),
    'bee_nest_front': lambda: (recoloured('hay_block_side', dark=(120, 74, 24), light=(226, 184, 84)), None),
    'beehive_front': lambda: (block_tex('beehive_side')[0], None),
    'bell_bottom': lambda: (block_tex('gold_block')[0], None),
    'smithing_table_front': lambda: (recoloured('dark_oak_planks', dark=(30, 30, 36), light=(110, 96, 90)), None),
    'smithing_table_side': lambda: (recoloured('dark_oak_planks', dark=(34, 32, 36), light=(116, 100, 92)), None),
    'chiseled_bookshelf_empty': lambda: (block_tex('chiseled_bookshelf_side')[0], None),
    'tnt_bottom': lambda: (block_tex('tnt_top')[0], None),
}
def glazed_like(c, design):
    """A glazed terracotta drawn in another one's pattern: only the pattern's lightness, laid on a ramp round the
    game's mean colour for it and pulled to the game's spread (colour statistics, no pixels). The concrete's ramp
    it used before is nearly one colour, so these seven came out flat."""
    a = block_tex(design + '_glazed_terracotta')[0][0]
    t = STATS[c + '_glazed_terracotta']
    lo = lab_to_srgb(np.array([t[0] - 1.6 * t[3], t[1], t[2]])) * 255
    hi = lab_to_srgb(np.array([t[0] + 1.6 * t[3], t[1], t[2]])) * 255
    out = palette_map(a, lo, hi, contrast=1.25)
    out[..., 3] = a[..., 3]
    return correct([out], t)


for c, design in GLAZED.items():
    REPLACE[c + '_glazed_terracotta'] = (lambda c=c, design=design: (glazed_like(c, design), None))
for n in ('jigsaw_top', 'jigsaw_side', 'jigsaw_bottom', 'jigsaw_lock', 'structure_block', 'structure_block_load',
          'structure_block_save', 'structure_block_corner', 'structure_block_data'):
    REPLACE[n] = lambda: (art('tech_block.png'), None)
# the dried ghast was partly copied: the soul soil it is found on stands in
for f in ('top', 'bottom', 'north', 'south', 'east', 'west'):
    REPLACE['dried_ghast_hydration_0_' + f] = lambda: (recoloured('soul_soil', dark=(56, 50, 48), light=(150, 140, 132)), None)

NO_CORRECT |= set(REPLACE)          # these are already recoloured by hand
NO_CORRECT.add('grass_block_side')   # the side of a grass block is built from the finished dirt below
# the side of a grass block: the finished dirt, with the tinted grass fringe laid over it in the shader (as MineClone does).
# Pixel Perfection's own side carries its fringe baked in, and no colour correction suits a texture that is half dirt and
# half grass
DIRT_OPEN = bool(block_tex('dirt')) and SRC_OF.get('dirt') in OPEN_IDX

missing = []
for name in names:
    cls = cls_of(name)
    frames, anim = None, None
    if name in REPLACE:
        frames, anim = REPLACE[name]()
        log_fallback.append('%s: audited copy, replaced' % name)
    elif name == 'grass_block_side' and DIRT_OPEN:
        frames, anim = block_tex('dirt')
        log_fallback.append('grass_block_side: the finished dirt (the tinted fringe is the overlay)')
    elif name in COMPOSED:
        frames = [COMPOSED[name]]
    elif name.startswith('item_'):
        frames = item_tex(name)
        if frames is None:
            # no icon in the pack: the block's own texture stands in
            base = name[5:]
            sub, fr, _ = similar(base)
            if fr:
                frames = [fr[0]]
                log_fallback.append('%s: no item sprite, uses %s' % (name, sub))
    else:
        r = block_tex(name)
        if r:
            frames, anim = r
        else:
            sub, fr, an = similar(name)
            if fr:
                frames, anim = fr, an
                log_fallback.append('%s: missing, uses %s' % (name, sub))
    if frames is None:
        missing.append(name)
        frames = [block_tex('stone')[0][0]]
        log_fallback.append('%s: NOTHING found, uses stone' % name)
    first = None
    for f in frames:
        i = push(name, f, cls)
        first = i if first is None else first
    e = dict(layer=first)
    if len(frames) > 1:
        e['frames'] = len(frames)
        e['frametime'] = anim['frametime'] if anim else 2
        if anim and anim.get('interpolate'):
            e['interpolate'] = True
    if name in VARIANTS:
        e['variants'] = []
        # a texture from REFI or Bauniclonia has no alternates of its own: the game still turns it at random (an empty list
        # is enough to switch that on)
        if SRC_OF.get(name) not in OPEN_IDX:
            for v in VARIANTS[name]:
                p, _ = find(v)
                if p:
                    e['variants'].append(push(v, finish(name, frames_of(p, False)[0])[0], cls))
    manifest[name] = e

N = len(layers_a)


def save(layers, fname):
    strip = np.concatenate(layers, 0)
    img = Image.fromarray(np.clip(strip * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')
    img.save(os.path.join(OUT, fname), optimize=True)


save(layers_a, 'terrain_albedo.png')
save(layers_n, 'terrain_normal.png')
save(layers_s, 'terrain_spec.png')

for f, sub in [('foliage.png', 'colormap'), ('sun.png', 'environment'), ('moon_phases.png', 'environment')]:
    Image.open(os.path.join(TEX, sub, f)).convert('RGBA').save(os.path.join(OUT, sub + '_' + f))
# the grass colour map is our own (the pack's shares too many pixels with the game's)
Image.open(os.path.join(ART, 'colormap_grass.png')).convert('RGBA').save(os.path.join(OUT, 'colormap_grass.png'))

with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as fh:
    json.dump(dict(size=16, layers=N, textures=manifest), fh, separators=(',', ':'))

# how each composed layer is cut from an entity picture, for ui/pack.js (only the layers that are in the strip)
with open(os.path.join(OUT, 'composed.json'), 'w', encoding='utf-8') as fh:
    json.dump({k: v for k, v in sorted(CUTS.items()) if k in manifest}, fh, separators=(',', ':'))

# ---------------------------------------------------------------- paintings
# Pixel Perfection CE's own paintings, under the game's names and at its sizes (16 pixels a block). They are the
# pack's own pictures: a pixel audit against the game's paintings (2026-10-07) found no pixel in common and no
# likeness in their layout. (Pixel Perfection Legacy's paintings are the game's own, so none of those is used.)
# Packed into one picture for entities/items2.js; the paintings the pack does not have are drawn by the game.
PAINT_DIR = os.path.join(TEX, 'painting')
if os.path.isdir(PAINT_DIR):
    pics = []
    for f in sorted(os.listdir(PAINT_DIR)):
        if f.endswith('.png') and not f.startswith('paintings_'):
            pics.append((f[:-4], Image.open(os.path.join(PAINT_DIR, f)).convert('RGBA')))
    pics.sort(key=lambda p: (-p[1].size[1], p[0]))
    W, x, y, row, where = 256, 0, 0, 0, {}
    for n, im in pics:
        w, h = im.size
        if x + w > W:
            x, y, row = 0, y + row, 0
        where[n] = [x, y, w, h]
        x += w
        row = max(row, h)
    sheet = Image.new('RGBA', (W, y + row), (0, 0, 0, 0))
    for n, im in pics:
        sheet.paste(im, tuple(where[n][:2]))
    sheet.save(os.path.join(OUT, 'paintings.png'), optimize=True)
    with open(os.path.join(OUT, 'paintings.json'), 'w', encoding='utf-8') as fh:
        json.dump(where, fh, separators=(',', ':'))
    print('paintings:', len(where))

print('textures:', len(manifest), 'layers:', N, '(the game checks MAX_ARRAY_TEXTURE_LAYERS)')
print('from Pixel Perfection Legacy:', len(set(log_ppl)))
print('from REFI:', sum(1 for s in SRC_OF.values() if s == 'refi'), ' from Bauniclonia:', sum(1 for s in SRC_OF.values() if s == 'baun'),
      ' colour-corrected:', n_corrected[0], 'calls')
print('downscaled (%d):' % len(log_resized), ', '.join(log_resized))
print('fallbacks (%d):' % len(log_fallback))
for l in log_fallback:
    print('  ', l)
if missing:
    print('MISSING:', missing)
for f in ('terrain_albedo.png', 'terrain_normal.png', 'terrain_spec.png', 'manifest.json'):
    print(f, os.path.getsize(os.path.join(OUT, f)), 'bytes')
