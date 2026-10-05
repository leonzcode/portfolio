"""
Leoncraft 2 - item list, recipes and item pictures.

Writes public/leoncraft2/js/itemdata.js: every item of the game (1505, blocks
included), with its name on screen, stack size, durability, what it can be
enchanted with and repaired with, which creative tab it sits in, the food
values, which tool each block wants and how good that tool must be, and the
crafting recipes. And public/leoncraft2/textures/items.png: one 16 x 16
picture per item that is not a block (a vertical strip, in the order of
ITEM_TEX), which the game adds to the terrain texture array when it starts.

Inputs (tools/leoncraft2/data/items.json, made by --refresh so the build is
reproducible without the research folder): numbers boiled down from
PrismarineJS minecraft-data 26.1 (MIT, https://github.com/PrismarineJS/minecraft-data):
items, foods, the blocks' harvest tools and materials, and the crafting
recipes. minecraft-data writes a recipe with a tag ("any planks") once per
item of the tag; recipes for the same result with the same layout are put
back together here, so a chest can be made of mixed planks as in the game.

Pictures, from six open resource packs (all CC BY-SA 4.0, never Mojang's):
Pixel Perfection CE, Pixel Perfection Legacy, REFI Textures, Bauniclonia,
Pixel ImPerfection and Refined Textures (the last four are drawn for Luanti
games, Mineclonia and Minetest Game, so their files have those games' names;
Refined Textures is a fork of REFI Textures). Pixel ImPerfection gives the
blaze rod, the totem, the heart of the sea and magma cream; Refined Textures
bread, cooked chicken and the glistering melon slice.
data/item_sources.json says which pack's drawing each picture is, how
strongly its colours are pulled and where it sits: the drawing nearest the
game's own picture, judged on a local copy of the game's item textures
(October 2026, 26.1.2) once its colours are pulled and it is placed, with
whole families from one pack so they match (every tool, helmet, chestplate
and boots from Bauniclonia, the leggings from Pixel Perfection, all spawn eggs
from Legacy, the three ingots from one pack...). The colours are pulled towards the game's own average and spread
(data/vanilla_item_colour_stats.json, six numbers per picture, no pixels), at
the strength the sources file gives (1 full, 0.5 half, 0 not at all), the one
that comes nearest once both the per-pixel distance and the distance between
the mean colours count. The placement moves a drawing by up to two pixels,
or mirrors it, so it sits in the slot where the game's picture does (the
outlines compared; nothing is redrawn); the members of a family that share an
outline (the swords, the chestplates, the bundles...) share one placement,
unless it would cost one of them a weaker pull. The shield has no picture in
the game: the inventory draws its model, and so does this (shield_view), from
Pixel Perfection CE's shield texture. The textures the armour model wears
(textures/armor/, 64 x 32 in the game's layout) are Bauniclonia's, built the
same way. Dyed leather and wolf armour get extra layers (RAW_LAYERS): the
grey picture the dye multiplies and the parts drawn over it.

Every chosen drawing passed a copy audit against the game's own textures:
identical pixels at any shift of up to two pixels or mirrored (at most 15%),
and how closely the fine detail (each pixel minus its 3 x 3 blur) follows the
game's (at most 0.75 where it stands, 0.9 at any shift), both where the pack
drew it and where it is placed. Traces keep the detail even when recoloured;
independent drawings of the same object do not.
Earlier audits (every version from 1.16.5 to 26.3) and this one found these
pack files to be Mojang's pixels, copied or traced, so they are never used:
  CE   dried_kelp, leather_horse_armor, scute (turtle_scute),
       fish_pufferfish_raw (pufferfish), trident, turtle_helmet and the
       turtle armour model (identical to the game's)
  both compass (every frame)
  Legacy's turtle armour model and REFI's iron, gold and diamond armour
  models (traced); FamiliarCraft, another Mineclonia pack, was not used at
  all (its tools are the game's, recoloured).
  Pixel ImPerfection's book follows the game's detail (0.81), so no book is
  taken from that pack (its written book is at the limit too).
A wider audit (October 2026) compared every picture with every item picture
of every game version from 1.8.9 to 26.1.2, whatever its name: identical
pixels, and the interior detail (each pixel against its opaque neighbours)
wherever the outline is all but the same, which is how a trace shows. It
found more, never used: CE's phantom membrane and nautilus shell (the 1.13
pictures recoloured, interior 0.94 and 0.96 on the same outline) and Miner
16px's ingots (the 1.8 ingot, 0.85 and 0.87; its apple has the 1.8 outline
too), so nothing is taken from Miner 16px.
The same audit in all eight orientations (every picture turned a quarter at a
time and mirrored, as well as moved; October 2026), with every leggings,
helmet, boots, chestplate, stick, pickaxe and sword drawing of the packs put
through it for comparison: Bauniclonia's leggings were the only leggings of
more than forty to share the game's leggings outline exactly, with the inside
detail following (0.83 to 0.88, the traced ingots' signature), so the leggings
come from Pixel Perfection CE and Legacy. Still flagged, looked at and kept:
the stick (the plain corner-to-corner stick of 1.8), and tools and helmets
whose placed drawing lines up with another game picture along a handle or a
rim (the pack drawings on their own score 0.6 to 0.76, as other packs' do).
The turtle helmet (picture and model) is Bauniclonia's leather cap
recoloured. The compass and mace drawings below are used only when REFI
Textures is not given, and the shield drawing only without Pixel Perfection
CE's shield texture.

Run:  python tools/leoncraft2/build_items.py <PixelPerfectionCE root> <Pixel Perfection Legacy root> <REFI_Textures> <Bauniclonia> <pixel_imperfection> <Refined_Textures>
      (without REFI and Bauniclonia the pictures come from Pixel Perfection only and no armour textures are
      written; a picture whose pack is not given falls back to Pixel Perfection, and the build says which)
      python tools/leoncraft2/build_items.py --refresh <minecraft-data folder> <blocks.26.1.json>
"""
import json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
JS = os.path.join(HERE, '..', '..', 'public', 'leoncraft2', 'js')
TEX = os.path.join(HERE, '..', '..', 'public', 'leoncraft2', 'textures')
TIERS = {'wooden': 0, 'golden': 0, 'stone': 1, 'copper': 1, 'iron': 2, 'diamond': 3, 'netherite': 4}
KINDS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears']


def tool_of(name):
    if name == 'shears': return ('shears', 0)
    m = re.match(r'^(wooden|golden|stone|copper|iron|diamond|netherite)_(pickaxe|axe|shovel|hoe|sword)$', name)
    return (m.group(2), TIERS[m.group(1)]) if m else None


def refresh(src, blocks_file):
    """Boil minecraft-data down to what the game uses."""
    items = json.load(open(os.path.join(src, 'pc_26.1_items.json'), encoding='utf-8'))
    foods = json.load(open(os.path.join(src, 'pc_26.1_foods.json'), encoding='utf-8'))
    recipes = json.load(open(os.path.join(src, 'pc_26.1_recipes.json'), encoding='utf-8'))
    enchants = json.load(open(os.path.join(src, 'pc_26.1_enchantments.json'), encoding='utf-8'))
    blocks = json.load(open(blocks_file, encoding='utf-8'))
    name = {i['id']: i['name'] for i in items}
    out = {'items': [], 'foods': {}, 'blocks': {}, 'recipes': [], 'enchants': []}
    for e in enchants:
        out['enchants'].append([e['name'], e['displayName'], e['maxLevel'], e['minCost']['a'], e['minCost']['b'], e['maxCost']['a'], e['maxCost']['b'],
                                e['weight'], 1 if e['treasureOnly'] else 0, 1 if e['curse'] else 0, e['exclude'], e['category'], 1 if e.get('discoverable', True) else 0])
    for i in items:
        if i['name'] == 'air': continue
        e = {'n': i['name'], 'd': i['displayName'], 's': i['stackSize']}
        if i.get('maxDurability'): e['dur'] = i['maxDurability']
        if i.get('enchantCategories'): e['ench'] = i['enchantCategories']
        if i.get('repairWith'): e['rep'] = i['repairWith']
        out['items'].append(e)
    for f in foods:
        out['foods'][f['name']] = [f['foodPoints'], round(f['saturation'], 2)]
    for b in blocks:
        mat = b.get('material', 'default').replace('incorrect_for_wooden_tool', 'mineable/pickaxe')
        kinds, tier = set(), 9
        for t in (b.get('harvestTools') or {}):
            tt = tool_of(name[int(t)])
            if not tt: continue
            kinds.add(tt[0])
            if tt[0] in ('pickaxe', 'axe', 'shovel', 'hoe'): tier = min(tier, tt[1])
        mask = sum(1 << KINDS.index(k) for k in kinds)
        out['blocks'][b['name']] = [mat, mask, 0 if tier == 9 else tier]
    for rid, lst in recipes.items():
        for r in lst:
            res = [name[r['result']['id']], r['result']['count']]
            if 'inShape' in r:
                shape = [[name[c] if c is not None else None for c in row] for row in r['inShape']]
                out['recipes'].append({'r': res, 'shape': shape})
            else:
                out['recipes'].append({'r': res, 'ing': [name[c] for c in r['ingredients']]})
    with open(os.path.join(DATA, 'items.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'), sort_keys=True)
    print('refreshed', os.path.join(DATA, 'items.json'))


# ------------------------------------------------------------------ recipes
def merge_recipes(recipes):
    """Put tag recipes back together: same result, count and layout, the
    varying cells hold the same item within each variant (a tag filling
    several cells) or only one cell varies. Anything else stays apart."""
    groups = collections.OrderedDict()
    for r in recipes:
        if 'shape' in r:
            key = ('s', r['r'][0], r['r'][1], len(r['shape']), len(r['shape'][0]),
                   tuple(tuple(c is None for c in row) for row in r['shape']))
        else:
            key = ('l', r['r'][0], r['r'][1], len(r['ing']))
        groups.setdefault(key, []).append(r)
    out = []
    for key, rs in groups.items():
        if key[0] == 's':
            cells = [[c for row in r['shape'] for c in row] for r in rs]
            n = len(cells[0])
            vary = [i for i in range(n) if len({c[i] for c in cells}) > 1]
            ok = len(vary) <= 1 or all(len({c[i] for i in vary}) == 1 for c in cells)
            if not ok:
                for r in rs: out.append({'r': r['r'], 'w': key[4], 'h': key[3], 'cells': [[c] if c else None for row in r['shape'] for c in row]})
                continue
            merged = []
            for i in range(n):
                if cells[0][i] is None: merged.append(None); continue
                seen = []
                for c in cells:
                    if c[i] not in seen: seen.append(c[i])
                merged.append(seen)
            out.append({'r': rs[0]['r'], 'w': key[4], 'h': key[3], 'cells': merged})
        else:
            # shapeless: merge when the variants differ in one ingredient only
            sets = [collections.Counter(r['ing']) for r in rs]
            common = sets[0]
            for s in sets[1:]: common = common & s
            rest = [list((s - common).elements()) for s in sets]
            if len(rs) > 1 and all(len(x) == 1 for x in rest):
                ing = [[i] for i in sorted(common.elements())]
                alts = []
                for x in rest:
                    if x[0] not in alts: alts.append(x[0])
                out.append({'r': rs[0]['r'], 'ing': ing + [alts]})
            else:
                for r in rs: out.append({'r': r['r'], 'ing': [[i] for i in r['ing']]})
    return out


# ---------------------------------------------------------------- creative tabs
TOOLS_RE = re.compile(r'_(shovel|pickaxe|axe|hoe)$|^(shears|flint_and_steel|fire_charge|bone_meal|brush|fishing_rod|carrot_on_a_stick|'
                      r'warped_fungus_on_a_stick|compass|recovery_compass|clock|spyglass|lead|name_tag|saddle|map|writable_book|'
                      r'written_book|ender_pearl|ender_eye|elytra|bucket|water_bucket|lava_bucket|milk_bucket|powder_snow_bucket|'
                      r'goat_horn|wind_charge|bundle|.*_bundle|.*_boat|.*_raft|.*minecart|music_disc_.*|.*_bucket|experience_bottle|'
                      r'firework_rocket|knowledge_book|debug_stick)$')
COMBAT_RE = re.compile(r'_(sword|spear|helmet|chestplate|leggings|boots|horse_armor|nautilus_armor)$|^(bow|crossbow|arrow|spectral_arrow|'
                       r'tipped_arrow|trident|shield|mace|totem_of_undying|snowball|egg|blue_egg|brown_egg|turtle_helmet|wolf_armor)$')


def tab_of(e, foods):
    n = e['n']
    if n.endswith('_spawn_egg'): return 'spawn_eggs'
    if COMBAT_RE.search(n) or n.endswith('_axe'): return 'combat' if not n.endswith('_axe') else 'tools'
    if TOOLS_RE.search(n): return 'tools'
    if n in foods or n in ('potion', 'splash_potion', 'lingering_potion', 'honey_bottle', 'milk_bucket', 'suspicious_stew', 'ominous_bottle'): return 'food'
    return 'ingredients'


# ----------------------------------------------------------------- pictures
def own_art(name):
    """The few item pictures drawn here, our own pixels."""
    from PIL import Image
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    px = im.load()
    if name == 'compass':
        # a round iron case, a glass face, a needle pointing up (red) and down (white)
        for y in range(16):
            for x in range(16):
                dx, dy = x - 7.5, y - 7.5
                r = (dx * dx + dy * dy) ** 0.5
                if r <= 6.6:
                    if r > 5.4:
                        g = 96 if (x + y) % 3 else 110
                        if dy < -2 and dx < 0: g = 150
                        if dy > 2: g = 72
                        px[x, y] = (g, g, g + 4, 255)
                    elif r > 4.6:
                        px[x, y] = (54, 54, 58, 255)
                    else:
                        v = 200 - int(r * 9)
                        px[x, y] = (v, v - 6, v - 22, 255)
        for y in range(3, 8): px[7, y] = (200, 30, 30, 255); px[8, y] = (150, 20, 20, 255)
        for y in range(8, 13): px[7, y] = (235, 235, 235, 255); px[8, y] = (180, 180, 186, 255)
        px[7, 7] = px[8, 8] = (60, 60, 60, 255)
    elif name == 'shield':
        # oak boards in an iron rim, slightly tapered at the bottom
        for y in range(1, 15):
            inset = 0 if y < 11 else (y - 10)
            for x in range(3 + inset, 13 - inset):
                rim = x == 3 + inset or x == 12 - inset or y == 1 or y == 14 or (y >= 11 and (x == 3 + inset + 1 or x == 12 - inset - 1) and False)
                if rim:
                    v = 150 if (x + y) % 2 else 128
                    px[x, y] = (v, v, v + 6, 255)
                else:
                    plank = ((x - 3) // 3) % 2
                    b = 150 + (8 if plank else -6) - (y * 2 if y > 10 else 0)
                    if (x - 3) % 3 == 0: b -= 26
                    px[x, y] = (b, int(b * 0.72), int(b * 0.42), 255)
        for x in range(6, 10): px[x, 7] = (120, 120, 126, 255)
    elif name == 'mace':
        # a heavy iron head with knobs on a dark handle, drawn diagonally
        for i in range(9):
            x, y = 2 + i, 13 - i
            px[x, y] = (92, 64, 40, 255)
            if i < 8: px[x + 1, y] = (64, 44, 28, 255)
        for y in range(1, 8):
            for x in range(8, 15):
                dx, dy = x - 11, y - 4
                if dx * dx + dy * dy <= 9:
                    v = 120 + (30 if dx + dy < -1 else -20 if dx + dy > 1 else 0)
                    px[x, y] = (v, v, v + 8, 255)
        for (x, y) in ((11, 0), (15, 4), (11, 8), (7, 4)):
            if 0 <= x < 16 and 0 <= y < 16: px[x, y] = (170, 170, 178, 255)
    return im


def shield_view(tex):
    """The shield as the inventory shows it, from a 64 x 64 shield texture (RGBA array): the game draws the shield's
    model there, not a flat picture, so this draws it the same way. The model is a 12 x 22 x 1 plate on a 2 x 6 x 6
    handle (boxes in the usual entity texture layout, the plate at 0,0 and the handle at 26,0), turned over by the
    item's own (1, -1, -1) scale, moved by the item's -0.5 offset, then put through the GUI display of the shield's
    item model: scale 0.65, turned 15, -25 and -5 degrees about X, Y and Z (Z first), moved 2, 3, 0 pixels. One
    sample at each pixel's centre of the 16 x 16 slot, the nearest face winning; the faces towards the slot are lit
    fully and the edges 0.8. Returns a 16 x 16 RGBA array."""
    import numpy as np
    tex = np.asarray(tex)
    k = tex.shape[1] / 64.0
    a, b, c = np.radians([15, -25, -5])
    RX = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
    RY = np.array([[np.cos(b), 0, np.sin(b)], [0, 1, 0], [-np.sin(b), 0, np.cos(b)]])
    RZ = np.array([[np.cos(c), -np.sin(c), 0], [np.sin(c), np.cos(c), 0], [0, 0, 1]])
    R = RX @ RY @ RZ

    def slot(p):
        q = np.array([p[0], -p[1], -p[2]]) / 16.0 - 0.5
        return R @ (0.65 * q) + np.array([2, 3, 0]) / 16.0

    def faces(x0, y0, z0, w, h, d, u, v):
        x1, y1, z1 = x0 + w, y0 + h, z0 + d
        P = np.array
        return [(P([x1, y0, z0]), P([-w, 0, 0]), P([0, h, 0]), (u + d, v + d, w, h)),
                (P([x0, y0, z1]), P([w, 0, 0]), P([0, h, 0]), (u + d + w + d, v + d, w, h)),
                (P([x1, y0, z1]), P([0, 0, -d]), P([0, h, 0]), (u, v + d, d, h)),
                (P([x0, y0, z0]), P([0, 0, d]), P([0, h, 0]), (u + d + w, v + d, d, h)),
                (P([x0, y0, z1]), P([w, 0, 0]), P([0, 0, -d]), (u + d, v, w, d)),
                (P([x0, y1, z0]), P([w, 0, 0]), P([0, 0, d]), (u + d + w, v, w, d))]
    out = np.zeros((16, 16, 4), np.uint8)
    depth = np.full((16, 16), -1e9)
    py, px = np.mgrid[0:16, 0:16]
    sx, sy = (px + 0.5 - 8) / 16, (8 - (py + 0.5)) / 16
    for corner, eu, ev, (tu, tv, tw, th) in faces(-6, -11, -2, 12, 22, 1, 0, 0) + faces(-1, -3, -1, 2, 6, 6, 26, 0):
        o = slot(corner)
        du, dv = slot(corner + eu) - o, slot(corner + ev) - o
        n = np.cross(du, dv)
        det = du[0] * dv[1] - du[1] * dv[0]
        if abs(det) < 1e-12:
            continue
        light = 1.0 if abs(n[2]) / np.linalg.norm(n) > 0.8 else 0.8
        # where each pixel centre meets the face's plane, in the face's own 0..1 coordinates
        rx, ry = sx - o[0], sy - o[1]
        s = (rx * dv[1] - ry * dv[0]) / det
        t = (du[0] * ry - du[1] * rx) / det
        z = o[2] + s * du[2] + t * dv[2]
        tx = np.minimum((tu + s * tw) * k, tex.shape[1] - 1).astype(int)
        ty = np.minimum((tv + t * th) * k, tex.shape[0] - 1).astype(int)
        hit = (s >= 0) & (s < 1) & (t >= 0) & (t < 1) & (z > depth)
        col = tex[np.clip(ty, 0, None), np.clip(tx, 0, None)]
        hit &= col[..., 3] >= 8
        out[hit, :3] = np.clip(np.round(col[hit, :3] * light), 0, 255)
        out[hit, 3] = 255
        depth[hit] = z[hit]
    return out


def place(im, dx, dy, flip=False):
    """The picture moved by dx, dy pixels (right, down), mirrored first if asked; nothing is pushed off it."""
    from PIL import Image, ImageOps
    if flip:
        im = ImageOps.mirror(im)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (dx, dy))
    return out


ALIASES = {'compass': None, 'recovery_compass': 'recovery_compass_16', 'clock': 'clock_00', 'crossbow': 'crossbow_standby',
           'debug_stick': 'stick', 'turtle_scute': 'turtle_scute', 'pufferfish': 'pufferfish'}
# never taken from that pack (see the audit above)
NOT_FROM_CE = {'dried_kelp', 'leather_horse_armor', 'scute', 'turtle_scute', 'compass_16', 'fish_pufferfish_raw', 'trident',
               'turtle_helmet'}
NOT_FROM_PPL = {'compass_16'}
NOT_FROM_LUANTI = {'pimp': {'default_book', 'mcl_books_book_written', 'mcl_books_book_writable', 'mcl_enchanting_book_enchanted'}}
DRAWN = {'shield'}                          # drawn from a model, not a picture (shield_view)
OWN_ART = {'compass', 'shield', 'mace'}     # drawn here, used when the chosen drawing cannot be loaded
LEATHER = 0xA06540                          # undyed leather
# pictures made of a grey base tinted (as the game does) with an overlay on top
TINTED = {
    'leather_helmet': (LEATHER, 'leather_helmet', 'leather_helmet_overlay'),
    'leather_chestplate': (LEATHER, 'leather_chestplate', 'leather_chestplate_overlay'),
    'leather_leggings': (LEATHER, 'leather_leggings', 'leather_leggings_overlay'),
    'leather_boots': (LEATHER, 'leather_boots', 'leather_boots_overlay'),
    'leather_horse_armor': (LEATHER, 'leather_horse_armor', 'leather_horse_armor_overlay'),
    'potion': (0x385DC6, 'potion_overlay', 'potion'),          # the tinted liquid goes under the bottle
    'splash_potion': (0x385DC6, 'potion_overlay', 'splash_potion'),
    'lingering_potion': (0x385DC6, 'potion_overlay', 'lingering_potion'),
    'tipped_arrow': (0x385DC6, 'tipped_arrow_head', 'tipped_arrow_base'),
    'firework_star': (0x8A8A8A, 'firework_star_overlay', 'firework_star'),
    'filled_map': (0x46402E, 'filled_map_markings', 'filled_map'),
}
# the untinted layers of pictures the game colours per item (a potion's liquid, an arrow's tip), and the item whose
# drawing they come from
# drawing they come from. Dyed leather and wolf armour too: the grey base the dye multiplies (GREY_LAYERS, pulled to
# the game's grey) and the parts drawn over it, untinted for leather, tinted for the wolf armour's dyed part.
RAW_LAYERS = {'potion_overlay': 'potion', 'potion': 'potion', 'splash_potion': 'splash_potion',
              'lingering_potion': 'lingering_potion', 'tipped_arrow_head': 'tipped_arrow', 'tipped_arrow_base': 'tipped_arrow',
              'leather_helmet': 'leather_helmet', 'leather_helmet_overlay': 'leather_helmet',
              'leather_chestplate': 'leather_chestplate', 'leather_chestplate_overlay': 'leather_chestplate',
              'leather_leggings': 'leather_leggings', 'leather_leggings_overlay': 'leather_leggings',
              'leather_boots': 'leather_boots', 'leather_boots_overlay': 'leather_boots',
              'leather_horse_armor': 'leather_horse_armor', 'leather_horse_armor_overlay': 'leather_horse_armor',
              'wolf_armor_overlay': 'wolf_armor'}
GREY_LAYERS = {'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots', 'leather_horse_armor'}


def _json(name, key):
    p = os.path.join(DATA, name)
    return json.load(open(p, encoding='utf-8'))[key] if os.path.exists(p) else {}


SOURCES = _json('item_sources.json', 'sources')               # item -> [pack, file, strength(, dx, dy(, mirrored))]
ITEM_STATS = _json('vanilla_item_colour_stats.json', 'items')  # picture -> six Lab numbers of the game's own
ARMOR_STATS = _json('vanilla_item_colour_stats.json', 'armor')
# items whose picture in the game's files has another name: the frame the inventory shows, or the picture used
STATS_ALIAS = {'clock': 'clock_00', 'crossbow': 'crossbow_standby', 'recovery_compass': 'recovery_compass_16',
               'compass': 'compass_16', 'debug_stick': 'stick', 'enchanted_golden_apple': 'golden_apple'}


def stats_of(name):
    return ITEM_STATS.get(STATS_ALIAS.get(name, name))


# the packs' alternative, menu and other-game folders, never searched
SKIP_DIRS = {'alternate_textures', 'GUI_themes', 'main_menu', 'menu', 'character_player_skin_templates', '.git',
             'custom_edition', 'skyfactory', 'mcimport', 'mcimport_mods', 'screenshots', 'HUD', 'hud'}


def pack_index(root, sub):
    """{file name without .png: path} of every png under root/sub, first found wins; the packs' alternative and
    menu folders are skipped. {} when there is no such folder."""
    base = os.path.join(root, sub) if root else ''
    idx = {}
    if base and os.path.isdir(base):
        for dp, dn, fn in os.walk(base):
            dn[:] = sorted(d for d in dn if d not in SKIP_DIRS)
            for f in sorted(fn):
                if f.endswith('.png'):
                    idx.setdefault(f[:-4], os.path.join(dp, f))
    return idx


def find(name, ce, ppl):
    for root, skip in ((ce, NOT_FROM_CE), (ppl, NOT_FROM_PPL)):
        if name in skip: continue
        p = os.path.join(root, name + '.png')
        if os.path.exists(p): return p
    return None


def load16(p):
    from PIL import Image
    im = Image.open(p).convert('RGBA')
    w = im.size[0]
    if im.size[1] != w: im = im.crop((0, 0, w, w))
    if w != 16: im = im.resize((16, 16), Image.NEAREST)
    return im


def tint_over(b, o, col):
    """The base tinted by the colour (as the game multiplies it), the overlay on top."""
    from PIL import Image
    r, g, bb = col >> 16 & 255, col >> 8 & 255, col & 255
    b = b.copy()
    bp = b.load()
    for y in range(b.size[1]):
        for x in range(b.size[0]):
            c = bp[x, y]
            bp[x, y] = (c[0] * r // 255, c[1] * g // 255, c[2] * bb // 255, c[3])
    out = Image.new('RGBA', b.size, (0, 0, 0, 0))
    out.alpha_composite(b)
    out.alpha_composite(o)
    return out


def pull(im, target, strength=1.0, neutral=False):
    """The picture's colours pulled towards the game's mean and spread (labcolour.correct), blended by strength."""
    if target is None or strength <= 0:
        return im
    import numpy as np
    from PIL import Image
    from labcolour import correct
    a = np.asarray(im.convert('RGBA'), np.float32) / 255
    c = correct([a], target, neutral)[0]
    out = a * (1 - strength) + c * strength
    out[..., 3] = a[..., 3]
    return Image.fromarray(np.clip(np.round(out * 255), 0, 255).astype(np.uint8), 'RGBA')


def from_pack(pack, file, packs):
    """A 16 x 16 picture from one pack: a file name, or 'base+overlay' for a tinted picture (Pixel Perfection)."""
    if pack in ('ce', 'ppl'):
        skip = NOT_FROM_CE if pack == 'ce' else NOT_FROM_PPL
        paths = [None if f in skip else os.path.join(packs[pack], f + '.png') for f in file.split('+')]
    else:
        skip = NOT_FROM_LUANTI.get(pack, ())
        paths = [None if f in skip else packs.get(pack, {}).get(f) for f in file.split('+')]
    if not all(p and os.path.exists(p) for p in paths):
        return None
    return [load16(p) for p in paths]


FELL_BACK = []      # pictures whose chosen pack was not given


def shield_picture(ce):
    """The shield's inventory picture from Pixel Perfection CE's shield texture (its entity folder), or None."""
    from PIL import Image
    p = os.path.join(ce, '..', 'entity', 'shield_base_nopattern.png') if ce else None
    if not p or not os.path.exists(p):
        return None
    import numpy as np
    return Image.fromarray(shield_view(np.asarray(Image.open(p).convert('RGBA'))), 'RGBA')


def picture(name, ce, ppl, packs=None):
    if name in DRAWN:
        im = shield_picture(ce)
        if im is None: return own_art(name)
        return pull(im, stats_of(name)) if packs else im
    src = SOURCES.get(name)
    if src and packs:
        got = from_pack(src[0], src[1], packs)
        if got:
            im = tint_over(got[0], got[1], TINTED[name][0]) if len(got) == 2 else got[0]
            im = pull(im, stats_of(name), src[2])
            # where it sits in the slot: moved (and mirrored) to sit where the game's picture does
            return place(im, src[3], src[4], len(src) > 5 and src[5]) if len(src) > 3 else im
        FELL_BACK.append(name)
    if name in OWN_ART: return own_art(name)
    im = None
    if name in TINTED:
        col, base, over = TINTED[name]
        pb, po = find(base, ce, ppl), find(over, ce, ppl)
        if pb and po:
            im = tint_over(load16(pb), load16(po), col)
    if im is None:
        alias = ALIASES.get(name, name)
        p = find(alias, ce, ppl) if alias else None
        im = load16(p) if p else None
    return pull(im, stats_of(name)) if im is not None and packs else im


def layer_picture(name, ce, ppl, packs=None):
    """An untinted layer, from the pack the item it belongs to was drawn from, pulled and placed as that item was.
    A grey base comes from Pixel Perfection's own grey file, or Bauniclonia's grey ("_desat") drawing of the piece;
    a pack with no separate parts to draw over the base gives an empty layer."""
    from PIL import Image
    src = SOURCES.get(RAW_LAYERS[name])
    if src and packs:
        if src[0] in ('ce', 'ppl'):
            got = from_pack(src[0], name, packs)
        elif name in GREY_LAYERS:
            got = from_pack(src[0], src[1] + '_desat', packs)
        else:
            got = [Image.new('RGBA', (16, 16), (0, 0, 0, 0))]
        if got:
            im = pull(got[0], ITEM_STATS.get('layer_' + name), src[2], name in GREY_LAYERS)
            return place(im, src[3], src[4], len(src) > 5 and src[5]) if len(src) > 3 else im
    p = find(name, ce, ppl)
    return load16(p) if p else Image.new('RGBA', (16, 16), (0, 0, 0, 0))


# The pictures that move in the game: the compass needle (towards the world spawn), the recovery compass (towards the
# last death) and the clock face (the sun). Every frame, from the pack the item's own picture is drawn from (which
# numbers its frames as the game does), pulled and placed as the item is. Without that pack, the item's one picture.
DIAL_FRAMES = {'compass': 32, 'recovery_compass': 32, 'clock': 64}


def frame_picture(name, k, ce, ppl, packs=None):
    from PIL import Image
    src = SOURCES.get(name)
    if src and packs and re.search(r'\d\d$', src[1]):
        got = from_pack(src[0], src[1][:-2] + '%02d' % k, packs)
        if got:
            im = pull(got[0], stats_of(name), src[2])
            return place(im, src[3], src[4], len(src) > 5 and src[5]) if len(src) > 3 else im
    im = picture(name, ce, ppl, packs)
    return im if im is not None else Image.new('RGBA', (16, 16), (0, 0, 0, 0))


# ----------------------------------------------------------------- armour
# The textures the armour model wears, 64 x 32 in the game's layout (the head box at 0,0, the body at 16,16, the
# arms at 40,16, the legs at 0,16): layer 1 is the helmet, chestplate and boots, layer 2 the leggings. Named as the
# game names its armour materials (gold, chainmail, turtle...). Bauniclonia draws each piece on its own 64 x 32
# sheet, and the helmet on the hat box (32,0) because that is where the Luanti armour model puts it; the pieces are
# laid together and the helmet moved to the head box. leather_layer_N is grey, as the game's own leather file is:
# the game multiplies it by the dye colour, or by 0xA06540 (undyed leather) when there is none. It is Bauniclonia's
# grey leather, pulled to the game's grey (the "_dye" numbers). The turtle shell is Bauniclonia's leather cap
# recoloured to the game's turtle shell (no open pack has a turtle shell that is not the game's own).
ARMOR_MATS = {'leather': 'leather_desat', 'chainmail': 'chain', 'iron': 'iron', 'gold': 'gold', 'diamond': 'diamond',
              'netherite': 'netherite', 'copper': 'copper'}


def armour_sheet(idx, mat, layer):
    import numpy as np
    from PIL import Image
    pieces = ['helmet', 'chestplate', 'boots'] if layer == 1 else ['leggings']
    out = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
    for pc in pieces:
        p = idx.get('mcl_armor_%s_%s' % (pc, mat))
        if not p:
            return None
        im = Image.open(p).convert('RGBA')
        if im.size != (64, 32):
            im = im.resize((64, 32), Image.NEAREST)
        if pc == 'helmet':
            a = np.asarray(im).copy()
            a[0:16, 0:32], a[0:16, 32:64] = a[0:16, 32:64].copy(), a[0:16, 0:32].copy()
            im = Image.fromarray(a, 'RGBA')
        out.alpha_composite(im)
    return out


def build_armour(baun):
    """Writes textures/armor/*.png from Bauniclonia's armour; returns the files written."""
    out_dir = os.path.join(TEX, 'armor')
    os.makedirs(out_dir, exist_ok=True)
    done = []
    jobs = []
    for mat, mcl in ARMOR_MATS.items():
        for layer in (1, 2):
            jobs.append(('%s_layer_%d' % (mat, layer), mcl, layer, mat == 'leather'))
    jobs.append(('turtle_layer_1', 'turtle', 1, False))
    # the files of an earlier build that are no longer made (undyed leather as its own file)
    for old in ('leather_layer_1_dye', 'leather_layer_2_dye'):
        if os.path.exists(os.path.join(out_dir, old + '.png')):
            os.remove(os.path.join(out_dir, old + '.png'))
    for key, mcl, layer, neutral in jobs:
        if mcl == 'turtle':
            im = armour_sheet(baun, 'leather_desat', 1)
            if im is not None:
                # only the cap: the chestplate and boots of the sheet are dropped
                from PIL import Image
                cap = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
                cap.paste(im.crop((0, 0, 64, 16)), (0, 0))
                im = cap
        else:
            im = armour_sheet(baun, mcl, layer)
        if im is None:
            print('armour: no Bauniclonia texture for', key)
            continue
        im = pull(im, ARMOR_STATS.get(key + '_dye' if neutral else key), 1.0, neutral)
        im.save(os.path.join(out_dir, key + '.png'), optimize=True)
        done.append(key)
    # The leggings' waist band stays leather brown whatever the dye, as in the game: leather_layer_2_overlay is
    # drawn untinted over the dyed leggings. It is Bauniclonia's undyed leggings where they sit on the body box,
    # in Bauniclonia's own brown: pulled to the game's colours, the band alone follows the game's band too closely
    # for the copy audit (0.77; 0.67 as drawn). Without it, blue leggings come out blue all over.
    im = armour_sheet(baun, 'leather', 2)
    if im is not None:
        from PIL import Image
        band = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
        band.paste(im.crop((16, 16, 40, 32)), (16, 16))
        band.save(os.path.join(out_dir, 'leather_layer_2_overlay.png'), optimize=True)
        done.append('leather_layer_2_overlay')
    return done


def main():
    if len(sys.argv) > 3 and sys.argv[1] == '--refresh':
        refresh(sys.argv[2], sys.argv[3])
        return
    ce = os.path.join(sys.argv[1], 'assets', 'minecraft', 'textures', 'item') if len(sys.argv) > 2 else None
    ppl = os.path.join(sys.argv[2], 'assets', 'minecraft', 'textures', 'item') if len(sys.argv) > 2 else None
    D = json.load(open(os.path.join(DATA, 'items.json'), encoding='utf-8'))
    # which items are blocks: the block list says (a block item, or a block placed by an item of another name)
    blocks, item_of = {}, {}
    for line in open(os.path.join(JS, 'blockdata.js'), encoding='utf-8'):
        if not line.startswith('{'): continue
        b = json.loads(line.rstrip().rstrip(','))
        blocks[b['name']] = b
        if b.get('itemOf'): item_of[b['itemOf']] = b['name']
    is_block = lambda n: n in item_of or (n in blocks and blocks[n].get('item') is not False and not blocks[n].get('itemOf'))
    items = []
    for e in D['items']:
        e = dict(e)
        if not is_block(e['n']): e['tab'] = tab_of(e, D['foods'])
        items.append(e)
    tex = [e['n'] for e in items if not is_block(e['n'])]
    # and the experience orb's eleven sizes (Pixel Perfection CE's entity texture, black is clear)
    tex += ['xp_orb_%d' % i for i in range(11)]
    # the untinted layers of pictures the game colours per item (a potion's liquid, an arrow's tip)
    tex += ['layer_' + n for n in RAW_LAYERS]
    # and the frames of the pictures that move (js/dials.js picks one)
    tex += ['frame_%s_%02d' % (n, k) for n, count in DIAL_FRAMES.items() for k in range(count)]
    # the pictures
    if ce:
        from PIL import Image
        sys.path.insert(0, HERE)
        refi = pack_index(sys.argv[3], 'textures') if len(sys.argv) > 3 else {}
        baun = pack_index(sys.argv[4], 'mineclonia') if len(sys.argv) > 4 else {}
        pimp = pack_index(sys.argv[5], 'textures') if len(sys.argv) > 5 else {}
        rfd = pack_index(sys.argv[6], 'textures') if len(sys.argv) > 6 else {}
        packs = {'ce': ce, 'ppl': ppl, 'refi': refi, 'baun': baun, 'pimp': pimp, 'rfd': rfd} if refi and baun else None
        if not packs:
            print('NOTE: REFI Textures and Bauniclonia not given: pictures from Pixel Perfection only, no armour textures')
        strip = Image.new('RGBA', (16, 16 * len(tex)), (0, 0, 0, 0))
        missing = []
        orbs = Image.open(os.path.join(sys.argv[1], 'assets', 'minecraft', 'textures', 'entity', 'experience_orb.png')).convert('RGBA')
        for i, n in enumerate(tex):
            if n.startswith('xp_orb_'):
                k = int(n[7:])
                strip.paste(orbs.crop(((k % 4) * 16, (k // 4) * 16, (k % 4) * 16 + 16, (k // 4) * 16 + 16)), (0, i * 16))
                continue
            if n.startswith('frame_'):
                strip.paste(frame_picture(n[6:-3], int(n[-2:]), ce, ppl, packs), (0, i * 16))
                continue
            if n.startswith('layer_'):
                strip.paste(layer_picture(n[6:], ce, ppl, packs), (0, i * 16))
                continue
            im = picture(n, ce, ppl, packs)
            if im is None:
                missing.append(n)
                im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
                for y in range(4, 12):
                    for x in range(4, 12): im.putpixel((x, y), (200, 0, 200, 255) if (x // 2 + y // 2) % 2 else (20, 20, 20, 255))
            strip.paste(im, (0, i * 16))
        strip.save(os.path.join(TEX, 'items.png'), optimize=True)
        print('items.png:', len(tex), 'pictures', ('missing ' + ', '.join(missing)) if missing else '')
        if FELL_BACK:
            print('NOTE: from Pixel Perfection instead, as their pack was not given:', ', '.join(FELL_BACK))
        if packs:
            print('armor/:', ', '.join(build_armour(baun)))
    recipes = merge_recipes(D['recipes'])
    # ingredient sets, each once
    ing, ing_ix = [], {}
    def ix(alts):
        if alts is None: return -1
        k = tuple(alts)
        if k not in ing_ix: ing_ix[k] = len(ing); ing.append(list(alts))
        return ing_ix[k]
    rec = []
    for r in recipes:
        if 'cells' in r: rec.append([r['r'][0], r['r'][1], r['w'], r['h'], [ix(c) for c in r['cells']]])
        else: rec.append([r['r'][0], r['r'][1], 0, 0, [ix(c) for c in r['ing']]])
    with open(os.path.join(JS, 'itemdata.js'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('/* GENERATED by tools/leoncraft2/build_items.py - do not edit by hand.\n'
                 '   Every item of the game (from PrismarineJS minecraft-data 26.1, MIT,\n'
                 '   https://github.com/PrismarineJS/minecraft-data): name on screen, stack\n'
                 '   size, durability, enchantment categories, repair material, creative tab;\n'
                 '   food values; the tool each block wants; the crafting recipes. The\n'
                 '   pictures of the items that are not blocks are textures/items.png, in the\n'
                 '   order of ITEM_TEX (open resource packs, CC BY-SA 4.0: textures/LICENSE.txt). */\n')
        fh.write('export const ITEM_LIST = [\n' + ',\n'.join(json.dumps(e, separators=(',', ':')) for e in items) + '\n];\n')
        fh.write('export const ITEM_TEX = ' + json.dumps(tex, separators=(',', ':')) + ';\n')
        fh.write('// name: [hunger, saturation]\nexport const FOODS = ' + json.dumps(D['foods'], separators=(',', ':')) + ';\n')
        fh.write('// block: [material, tools that can harvest it (bits: pickaxe, axe, shovel, hoe, sword, shears; 0 = anything), lowest tier]\n')
        fh.write('export const BLOCK_TOOLS = ' + json.dumps(D['blocks'], separators=(',', ':')) + ';\n')
        fh.write('// ingredient sets (any one of the names)\nexport const ING = ' + json.dumps(ing, separators=(',', ':')) + ';\n')
        fh.write('// [name, on screen, max level, min cost a, b, max cost a, b (a * level + b), weight, treasure, curse, excludes, category, discoverable]\n')
        fh.write('export const ENCHANTS = [\n' + ',\n'.join(json.dumps(e, separators=(',', ':')) for e in D['enchants']) + '\n];\n')
        fh.write('// [result, count, width, height, cells (ING index, -1 empty)]; width 0 = shapeless\n')
        fh.write('export const RECIPES = [\n' + ',\n'.join(json.dumps(r, separators=(',', ':')) for r in rec) + '\n];\n')
    print('itemdata.js:', len(items), 'items,', len(rec), 'recipes (from', len(D['recipes']), '),', len(ing), 'ingredient sets')


if __name__ == '__main__':
    main()
