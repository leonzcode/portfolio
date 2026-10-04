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

Pictures: Pixel Perfection CE first, then Pixel Perfection Legacy (both
CC BY-SA 4.0), never Mojang's. A pixel audit of both packs' item folders
against the game's own item textures (every version from 1.16.5 to 26.3,
October 2026; local comparison only) found these to be Mojang's pixels,
copied or traced, so they are taken from the other pack or drawn here:
  CE  dried_kelp, leather_horse_armor, scute (turtle_scute),
      fish_pufferfish_raw (pufferfish)
  both compass (every frame): our own drawing
(The music discs scored as "close" to the 26.3 black cushion only because
both are mostly black; no pixel is equal, they are not copies.)
Items neither pack has (the shield, the mace) are drawn here too.

Run:  python tools/leoncraft2/build_items.py <PixelPerfectionCE root> <Pixel Perfection Legacy root>
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
    blocks = json.load(open(blocks_file, encoding='utf-8'))
    name = {i['id']: i['name'] for i in items}
    out = {'items': [], 'foods': {}, 'blocks': {}, 'recipes': []}
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


ALIASES = {'compass': None, 'recovery_compass': 'recovery_compass_16', 'clock': 'clock_00', 'crossbow': 'crossbow_standby',
           'debug_stick': 'stick', 'turtle_scute': 'turtle_scute', 'pufferfish': 'pufferfish'}
# taken from the other pack (see the audit above)
NOT_FROM_CE = {'dried_kelp', 'leather_horse_armor', 'scute', 'turtle_scute', 'compass_16', 'fish_pufferfish_raw'}
NOT_FROM_PPL = {'compass_16'}
DRAWN = {'compass', 'shield', 'mace'}
# pictures made of a grey base tinted (as the game does) with an overlay on top
TINTED = {
    'leather_helmet': (0xA06540, 'leather_helmet', 'leather_helmet_overlay'),
    'leather_chestplate': (0xA06540, 'leather_chestplate', 'leather_chestplate_overlay'),
    'leather_leggings': (0xA06540, 'leather_leggings', 'leather_leggings_overlay'),
    'leather_boots': (0xA06540, 'leather_boots', 'leather_boots_overlay'),
    'leather_horse_armor': (0xA06540, 'leather_horse_armor', 'leather_horse_armor_overlay'),
    'potion': (0x385DC6, 'potion_overlay', 'potion', True),
    'splash_potion': (0x385DC6, 'potion_overlay', 'splash_potion', True),
    'lingering_potion': (0x385DC6, 'potion_overlay', 'lingering_potion', True),
    'tipped_arrow': (0x385DC6, 'tipped_arrow_head', 'tipped_arrow_base', True),
    'firework_star': (0x8A8A8A, 'firework_star_overlay', 'firework_star', True),
    'filled_map': (0x46402E, 'filled_map_markings', 'filled_map', True),
}


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


def picture(name, ce, ppl):
    from PIL import Image
    if name in DRAWN: return own_art(name)
    if name in TINTED:
        t = TINTED[name]
        col, base, over = t[0], t[1], t[2]
        tint_first = len(t) > 3          # potions: the tinted liquid goes under the bottle
        pb, po = find(base, ce, ppl), find(over, ce, ppl)
        if pb and po:
            b, o = load16(pb), load16(po)
            r, g, bb = col >> 16 & 255, col >> 8 & 255, col & 255
            bp = b.load()
            for y in range(16):
                for x in range(16):
                    c = bp[x, y]
                    bp[x, y] = (c[0] * r // 255, c[1] * g // 255, c[2] * bb // 255, c[3])
            out = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
            out.alpha_composite(b)
            out.alpha_composite(o)
            return out
    alias = ALIASES.get(name, name)
    p = find(alias, ce, ppl) if alias else None
    return load16(p) if p else None


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
    # the pictures
    if ce:
        from PIL import Image
        strip = Image.new('RGBA', (16, 16 * len(tex)), (0, 0, 0, 0))
        missing = []
        orbs = Image.open(os.path.join(sys.argv[1], 'assets', 'minecraft', 'textures', 'entity', 'experience_orb.png')).convert('RGBA')
        for i, n in enumerate(tex):
            if n.startswith('xp_orb_'):
                k = int(n[7:])
                strip.paste(orbs.crop(((k % 4) * 16, (k // 4) * 16, (k % 4) * 16 + 16, (k // 4) * 16 + 16)), (0, i * 16))
                continue
            im = picture(n, ce, ppl)
            if im is None:
                missing.append(n)
                im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
                for y in range(4, 12):
                    for x in range(4, 12): im.putpixel((x, y), (200, 0, 200, 255) if (x // 2 + y // 2) % 2 else (20, 20, 20, 255))
            strip.paste(im, (0, i * 16))
        strip.save(os.path.join(TEX, 'items.png'), optimize=True)
        print('items.png:', len(tex), 'pictures', ('missing ' + ', '.join(missing)) if missing else '')
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
                 '   order of ITEM_TEX (Pixel Perfection CE and Legacy, CC BY-SA 4.0). */\n')
        fh.write('export const ITEM_LIST = [\n' + ',\n'.join(json.dumps(e, separators=(',', ':')) for e in items) + '\n];\n')
        fh.write('export const ITEM_TEX = ' + json.dumps(tex, separators=(',', ':')) + ';\n')
        fh.write('// name: [hunger, saturation]\nexport const FOODS = ' + json.dumps(D['foods'], separators=(',', ':')) + ';\n')
        fh.write('// block: [material, tools that can harvest it (bits: pickaxe, axe, shovel, hoe, sword, shears; 0 = anything), lowest tier]\n')
        fh.write('export const BLOCK_TOOLS = ' + json.dumps(D['blocks'], separators=(',', ':')) + ';\n')
        fh.write('// ingredient sets (any one of the names)\nexport const ING = ' + json.dumps(ing, separators=(',', ':')) + ';\n')
        fh.write('// [result, count, width, height, cells (ING index, -1 empty)]; width 0 = shapeless\n')
        fh.write('export const RECIPES = [\n' + ',\n'.join(json.dumps(r, separators=(',', ':')) for r in rec) + '\n];\n')
    print('itemdata.js:', len(items), 'items,', len(rec), 'recipes (from', len(D['recipes']), '),', len(ing), 'ingredient sets')


if __name__ == '__main__':
    main()
