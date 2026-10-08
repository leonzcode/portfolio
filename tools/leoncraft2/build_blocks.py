"""
Leoncraft 2 - block list build.

Writes public/leoncraft2/js/blockdata.js: one entry for every vanilla block up
to Minecraft 26.3 (1286 of them), with how it is drawn, its textures, how it
behaves and where it sits in the creative inventory.

Inputs (tools/leoncraft2/data/, copied in by --refresh so the build is
reproducible without the research folder):
  classified.json         shape / group / light / collision per block (derived
                          from minecraft-data, MIT, plus 26.2 and 26.3 names)
  faces.json              texture names on each face of the cubes, slabs, stairs
  textures_by_block.json  texture names of every other block (names only)
  mcdata.json             hardness, stack size, item or not, facing count
                          (from PrismarineJS minecraft-data 26.1, MIT)
No Mojang model JSON and no textures are read here, only names and numbers.

Run:  python tools/leoncraft2/build_blocks.py
      python tools/leoncraft2/build_blocks.py --refresh <research blocks folder>
"""
import json, os, re, sys, shutil, collections

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data')
OUT = os.path.join(HERE, '..', '..', 'public', 'leoncraft2', 'js', 'blockdata.js')


def refresh(src):
    """Copy the derived inputs and boil minecraft-data down to the numbers we use."""
    os.makedirs(DATA, exist_ok=True)
    for f in ('classified.json', 'faces.json', 'textures_by_block.json'):
        shutil.copy(os.path.join(src, f), os.path.join(DATA, f))
    blocks = json.load(open(os.path.join(src, 'blocks.26.1.json'), encoding='utf-8'))
    items = {i['name']: i['stackSize'] for i in json.load(open(os.path.join(src, 'items.26.1.json'), encoding='utf-8'))}
    out = {}
    for b in blocks:
        st = {s['name']: s.get('num_values', 0) for s in b.get('states', [])}
        e = {'hardness': b['hardness'] if b['hardness'] is not None else -1}
        if b['name'] in items:
            e['stack'] = items[b['name']]
        if 'facing' in st:
            e['facing'] = st['facing']
        out[b['name']] = e
    # items that place a block under another name (seeds, redstone, string...)
    out['__items__'] = {k: items[k] for k in ('wheat_seeds', 'carrot', 'potato', 'beetroot_seeds', 'nether_wart',
                                               'cocoa_beans', 'sweet_berries', 'glow_berries', 'pumpkin_seeds',
                                               'melon_seeds', 'torchflower_seeds', 'pitcher_pod', 'redstone', 'string',
                                               'water_bucket', 'lava_bucket', 'powder_snow_bucket') if k in items}
    with open(os.path.join(DATA, 'mcdata.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'), sort_keys=True)
    print('refreshed', DATA)


if len(sys.argv) > 2 and sys.argv[1] == '--refresh':
    refresh(sys.argv[2])

C = json.load(open(os.path.join(DATA, 'classified.json'), encoding='utf-8'))
FACES = json.load(open(os.path.join(DATA, 'faces.json'), encoding='utf-8'))
TBB = json.load(open(os.path.join(DATA, 'textures_by_block.json'), encoding='utf-8'))
MC = json.load(open(os.path.join(DATA, 'mcdata.json'), encoding='utf-8'))

COLOURS = ['white', 'light_gray', 'gray', 'black', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan',
           'light_blue', 'blue', 'purple', 'magenta', 'pink']
WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'poplar',
         'bamboo', 'crimson', 'warped']
SIGN_ENTITY = {'oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'crimson', 'warped'}   # Pixel Perfection CE has these
# the Pixel Perfection CE item sprites this list points icons at (anything else is drawn as a 3D box)
PPCE_ITEMS = {'acacia_door', 'acacia_sign', 'bamboo', 'barrier', 'beetroot_seeds', 'bell', 'birch_door', 'birch_sign',
              'brewing_stand', 'cake', 'campfire', 'carrot', 'cauldron', 'chain', 'cocoa_beans', 'comparator',
              'crimson_door', 'dark_oak_door', 'dark_oak_sign', 'flower_pot', 'hopper', 'iron_door', 'jungle_door',
              'jungle_sign', 'kelp', 'lantern', 'lava_bucket', 'melon_seeds', 'nether_sprouts', 'nether_wart',
              'oak_door', 'oak_sign', 'potato', 'pumpkin_seeds', 'redstone', 'repeater', 'sea_pickle', 'seagrass',
              'soul_campfire', 'soul_lantern', 'spruce_door', 'spruce_sign', 'string', 'structure_void', 'sugar_cane',
              'sweet_berries', 'turtle_egg', 'warped_door', 'water_bucket', 'wheat_seeds'}


def mc(name):
    return MC.get(name, {})


# ------------------------------------------------------------- facts by name
# 26.2 / 26.3 blocks are not in minecraft-data yet: borrow the numbers of the
# nearest older block (poplar from oak, wool stairs from wool...).
def like(name):
    if name in MC:
        return name
    n = name.replace('poplar', 'oak')
    if n.startswith(('orange_', 'red_', 'yellow_')) and n.endswith('oak_leaves'):
        n = 'oak_leaves'
    n = re.sub(r'^(\w+?)_(wool|concrete)_(stairs|slab)$', r'\1_\2', n)
    for a, b in (('sulfur_spike', 'pointed_dripstone'), ('potent_sulfur', 'tuff'), ('sulfur_brick', 'tuff_brick'),
                 ('sulfur', 'tuff'), ('cinnabar_brick', 'tuff_brick'), ('cinnabar', 'tuff'), ('red_shrub', 'dead_bush'),
                 ('shelf_mushroom', 'brown_mushroom'), ('straw_bed', 'white_bed')):
        n = n.replace(a, b)
    return n if n in MC else None


def hardness(name):
    l = like(name)
    return MC[l]['hardness'] if l else 1.5


def stack(name):
    l = like(name)
    return MC[l].get('stack', 64) if l else 64


def has_item(name):
    l = like(name)
    if name not in MC:   # new blocks: technical variants have no item, the rest do
        return not re.search(r'(wall_sign|wall_hanging_sign|^potted_)', name)
    return 'stack' in MC[l]


# ---------------------------------------------------------------- textures
def cube_tex(name, f, column=False):
    top, bot, side = f.get('top'), f.get('bottom'), f.get('side')
    sides = f.get('sides')
    t = {}
    if sides:
        t['front'] = sides['north']
        side = sides['east']
        if sides['south'] != side:
            t['back'] = sides['south']
        if sides['west'] != side and sides['west'] != sides['north']:
            t['west'] = sides['west']
    if f.get('front'):
        t['front'] = f['front']
    if f.get('overlay'):
        t['overlay'] = f['overlay']
    if column:
        t['end'] = top
        t['side'] = side
        if bot != top:
            t['bottom'] = bot
        return t
    if not t and top == bot == side:
        return top
    t.update(top=top, bottom=bot, side=side)
    return t


def simplify(t):
    if isinstance(t, dict):
        vals = set(t.values())
        if set(t) <= {'top', 'bottom', 'side'} and len(vals) == 1:
            return vals.pop()
    return t


def dt(name):
    return TBB.get(name, {}).get('defaultTextures', {}) or {}


def particle(name):
    p = TBB.get(name, {}).get('particle')
    if p and '/' not in p and p != 'missingno':
        return p
    a = [t for t in TBB.get(name, {}).get('allTextures') or [] if '/' not in t and t != 'missingno']
    return a[0] if a else None


def wood_of(name):
    for w in sorted(WOODS, key=len, reverse=True):
        if name.startswith(w + '_'):
            return w
    return None


# ---------------------------------------------------------------- the build
LEAF_TINT = {'oak_leaves': 'foliage', 'jungle_leaves': 'foliage', 'acacia_leaves': 'foliage', 'dark_oak_leaves': 'foliage',
             'mangrove_leaves': 'foliage', 'spruce_leaves': 'spruce', 'birch_leaves': 'birch'}
REPLACEABLE = {'air', 'cave_air', 'void_air', 'water', 'lava', 'short_grass', 'fern', 'dead_bush', 'seagrass',
               'tall_seagrass', 'fire', 'soul_fire', 'snow', 'vine', 'glow_lichen', 'light', 'tall_grass', 'large_fern',
               'structure_void', 'bubble_column', 'warped_roots', 'nether_sprouts', 'crimson_roots', 'hanging_roots',
               'leaf_litter', 'short_dry_grass', 'tall_dry_grass', 'bush', 'sculk_vein', 'resin_clump'}
FALLS = re.compile(r'^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|\w+_concrete_powder|anvil|chipped_anvil|damaged_anvil|dragon_egg)$')
SLIPPERY = {'ice': 0.98, 'packed_ice': 0.98, 'frosted_ice': 0.98, 'blue_ice': 0.989, 'slime_block': 0.8}
TRANSLUCENT = re.compile(r'(stained_glass$|^ice$|^frosted_ice$|^slime_block$|^honey_block$|^tinted_glass$)')
OPERATOR = re.compile(r'^(command_block|chain_command_block|repeating_command_block|structure_block|jigsaw|barrier|light|'
                      r'structure_void|test_block|test_instance_block|debug_stick|petrified_oak_slab|spawner|trial_spawner|'
                      r'reinforced_deepslate|budding_amethyst_x)$')
# seeds and the like: the block a crop grows from is placed by this item
SEED = {'wheat': ('wheat_seeds', 'Wheat Seeds'), 'carrots': ('carrot', 'Carrot'), 'potatoes': ('potato', 'Potato'),
        'beetroots': ('beetroot_seeds', 'Beetroot Seeds'), 'nether_wart': ('nether_wart', 'Nether Wart'),
        'cocoa': ('cocoa_beans', 'Cocoa Beans'), 'sweet_berry_bush': ('sweet_berries', 'Sweet Berries'),
        'cave_vines': ('glow_berries', 'Glow Berries'), 'pumpkin_stem': ('pumpkin_seeds', 'Pumpkin Seeds'),
        'melon_stem': ('melon_seeds', 'Melon Seeds'), 'torchflower_crop': ('torchflower_seeds', 'Torchflower Seeds'),
        'pitcher_crop': ('pitcher_pod', 'Pitcher Pod'), 'redstone_wire': ('redstone', 'Redstone Dust'),
        'tripwire': ('string', 'String'), 'water': ('water_bucket', 'Water Bucket'),
        'lava': ('lava_bucket', 'Lava Bucket'), 'powder_snow': ('powder_snow_bucket', 'Powder Snow Bucket')}
UNDERWATER = {'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant'}
OFFSET_GROUPS = {('cross', 'flower'), ('cross', 'grass'), ('tall_plant', 'tall_plant'), ('cross', 'bush')}
WAVE2 = {'vine', 'weeping_vines', 'weeping_vines_plant', 'cave_vines', 'cave_vines_plant', 'hanging_roots',
         'pale_hanging_moss', 'spore_blossom'}

issues = []


def build(name, c):
    sh, gr = c['shape'], c['group']
    d = {'name': name, 'display': c.get('displayName') or name.replace('_', ' ').title()}
    f = FACES.get(name)
    D = dt(name)
    p = particle(name)
    shape, tex, pas = 'cube', None, 'opaque'
    solid = c.get('collision') != 'none'
    if c.get('collision') == 'unknown':
        solid = sh not in ('cross', 'tall_plant', 'torch') and gr not in ('sign', 'wall_sign', 'hanging_sign',
                                                                            'wall_hanging_sign', 'button', 'wall_mushroom')
    opacity = c.get('filterLight')
    extra = {}

    if sh == 'air':
        shape, pas, solid = 'none', 'none', False
    elif sh == 'cube':
        tex = cube_tex(name, f, column=(gr == 'column'))
        if gr == 'column':
            extra['orient'] = 'axis'
        elif 'facing' in c.get('states', []):
            extra['orient'] = 'facing' if mc(name).get('facing') == 6 else 'horizontal'
        if name in ('brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem'):
            tex = {'top': tex, 'bottom': tex, 'side': tex, 'inside': 'mushroom_block_inside'} if isinstance(tex, str) else tex
    elif sh == 'cube_transparent':
        tex = cube_tex(name, f)
        pas = 'translucent' if TRANSLUCENT.search(name) else 'cutout'
        if gr == 'leaves':
            extra.update(leaves=True, wave=2)
            if name in LEAF_TINT:
                extra['tint'] = LEAF_TINT[name]
            opacity = 1
        elif gr == 'beacon':
            tex = {'top': 'beacon', 'bottom': 'obsidian', 'side': 'glass'}
        elif gr == 'other_transparent' and f.get('front'):
            extra['orient'] = 'horizontal'
        if gr == 'powder_snow':
            solid = False
    elif sh == 'slab':
        shape, tex = 'slab', simplify(cube_tex(name, f))
        extra['iconMeta'] = 0
    elif sh == 'stairs':
        shape, tex = 'stairs', simplify(cube_tex(name, f))
        extra['iconMeta'] = 1
    elif sh in ('fence', 'fence_gate', 'wall'):
        shape = {'fence': 'fence', 'fence_gate': 'gate', 'wall': 'wall'}[sh]
        tex = D.get('texture') or D.get('wall') or p
    elif sh == 'pane':
        shape, pas = 'pane', 'cutout'
        side = D.get('pane') or D.get('bars') or p
        edge = D.get('edge') or side
        tex = {'top': edge, 'bottom': edge, 'side': side} if edge != side else side
        if 'stained' in name:
            pas = 'translucent'
        extra['icon'] = side
    elif sh == 'door':
        shape, pas = 'door', 'cutout'
        tex, extra['texUpper'] = D['bottom'], D['top']
        extra['icon'] = 'item_' + name.replace('waxed_', '')
    elif sh == 'trapdoor':
        shape, pas, tex = 'trapdoor', 'cutout', D.get('texture') or p
    elif sh == 'carpet':
        if gr == 'carpet':
            shape, tex = 'thin', D.get('wool') or p
        elif gr == 'pressure_plate':
            shape, tex = 'plate', D.get('texture') or p
        elif gr == 'snow_layer':
            shape, tex = 'layer', 'snow'
        elif gr == 'lily_pad':
            shape, pas, tex = 'pad', 'cutout', 'lily_pad'
            extra.update(tint='grass', icon='lily_pad')
        elif gr == 'water_surface':
            shape, pas, tex, solid = 'pad', 'cutout', D.get('texture') or p, False
        else:   # pink petals, wildflowers, leaf litter: flat on the ground
            shape, pas, tex, solid = 'thin', 'cutout', D.get('flowerbed') or D.get('texture') or p, False
            extra['icon'] = tex
            if name == 'leaf_litter':
                extra['tint'] = 'foliage'
        if gr in ('carpet',) and name.startswith(('moss', 'pale_moss')):
            pas = 'cutout' if name.startswith('pale') else 'opaque'
    elif sh == 'cross':
        shape, pas, solid = 'cross', 'cutout', False
        tex = D.get('cross') or D.get('texture') or D.get('fan') or D.get('sapling') or D.get('crop') or D.get('stem') or D.get('flower') or p
        if gr == 'crop':
            shape = 'crop'
            if name == 'torchflower_crop':
                tex = 'torchflower_crop_stage0'
        if gr == 'stem':
            tex = D.get('upperstem') or D.get('stem')
            extra['tint'] = 'foliage'
        if gr in ('cross',) or (sh, gr) in OFFSET_GROUPS:
            extra['offset'] = True
        if gr == 'reeds':
            extra['tint'] = 'grass'
        if name in ('short_grass', 'fern', 'bush'):
            extra['tint'] = 'grass'
        if name in UNDERWATER:
            extra.update(wave=4, waterlogged=True)
        elif name in WAVE2:
            extra['wave'] = 2
        elif gr in ('grass', 'flower', 'sapling', 'crop', 'bush', 'propagule', 'plant', 'stem', 'roots', 'fungus'):
            extra['wave'] = 1
        if gr == 'coral_fan' or gr == 'coral':
            pass
        extra['icon'] = tex
        if name == 'cave_vines':
            extra['icon'] = 'cave_vines'
    elif sh == 'tall_plant':
        shape, pas, solid = 'cross', 'cutout', False
        extra['tall'] = True
        if gr == 'tall_seagrass':
            tex, extra['texUpper'] = 'tall_seagrass_bottom', 'tall_seagrass_top'
            extra.update(wave=4, waterlogged=True)
        elif gr == 'pitcher':
            if name == 'pitcher_crop':
                shape = 'crop'
                tex, extra['texUpper'] = 'pitcher_crop_bottom_stage_1', 'pitcher_crop_top_stage_3'
            else:
                tex, extra['texUpper'] = 'pitcher_crop_bottom_stage_4', 'pitcher_crop_top_stage_4'
                extra['icon'] = 'pitcher_crop_top_stage_4'
            extra['wave'] = 1
        elif gr == 'dripleaf':
            tex, extra['texUpper'] = 'small_dripleaf_stem_bottom', 'small_dripleaf_top'
            extra.update(wave=1, icon='small_dripleaf_top')
        else:
            base = D.get('cross') or p
            tex = base
            up = base.replace('_bottom', '_top')
            if name == 'sunflower':
                up = 'sunflower_front'
            extra['texUpper'] = up
            extra.update(wave=1, offset=True, icon=up)
            if name in ('tall_grass', 'large_fern'):
                extra['tint'] = 'grass'
    elif sh == 'torch':
        pas, solid = 'cutout', gr in ('lantern', 'candle', 'rod')
        if gr == 'torch':
            shape, tex = 'torch', D['torch']
            extra['icon'] = tex
        elif gr == 'wall_torch':
            shape, tex = 'wall_torch', D['torch']
            extra['orient'] = 'wall'
        elif gr == 'lantern':
            shape, tex = 'lantern', D['lantern']
            if name in ('lantern', 'soul_lantern'):
                extra['icon'] = 'item_' + name
        elif gr == 'candle':
            shape, tex = 'candle', D['all']
            extra['texLit'] = D['all'] + '_lit'
        elif gr == 'rod':
            shape, tex = 'rod', D.get('end_rod') or D.get('texture') or p
            extra['orient'] = 'facing'
    elif sh == 'liquid':
        shape, pas, solid = 'fluid', 'fluid', False
        if name == 'lava':
            tex, extra['texFlow'] = 'lava_still', 'lava_flow'
            extra.update(icon='item_lava_bucket')
        else:
            tex, extra['texFlow'] = 'water_still', 'water_flow'
            extra['tint'] = 'water'
            if name == 'water':
                extra['icon'] = 'item_water_bucket'
        opacity = 1 if name != 'lava' else 15
    elif sh == 'special':
        shape, tex, pas, more = special(name, gr, c, D, p)
        extra.update(more)
    else:
        issues.append('unmapped ' + name)

    d['shape'] = shape
    if pas != 'opaque':
        d['pass'] = pas
    if tex is None and shape != 'none':
        tex = p
    if tex is not None:
        d['tex'] = tex
    for k in ('texUpper', 'texLit', 'texFlow', 'icon', 'iconMeta', 'plant'):
        if k in extra:
            d[k] = extra.pop(k)
    # tint
    tint = extra.pop('tint', None)
    if tint is None and c.get('tint') in ('grass', 'foliage', 'water', 'redstone') and shape not in ('pot',):
        tint = c['tint']
    if name in ('spruce_leaves', 'birch_leaves'):
        tint = LEAF_TINT[name]
    if tint:
        d['tint'] = tint
    if c.get('light'):
        d['light'] = c['light']
    # sky light it takes away
    if opacity is None:
        opacity = 15 if (shape == 'cube' and pas == 'opaque') else 0
    if shape == 'cube' and pas == 'opaque' and opacity != 15:
        opacity = 15
    if pas == 'translucent' and shape == 'cube' and opacity < 1:
        opacity = 1 if 'glass' in name else opacity
    if name in ('ice', 'frosted_ice'):
        opacity = 2
    if opacity != 15:
        d['opacity'] = opacity
    if not solid:
        d['solid'] = False
    if name in REPLACEABLE:
        d['replaceable'] = True
    d['hardness'] = hardness(name)
    for k, v in extra.items():
        d[k] = v
    if FALLS.match(name):
        d['falls'] = True
    if name in SLIPPERY:
        d['slippery'] = SLIPPERY[name]
    # items
    item = (has_item(name) or name in SEED) and shape != 'none' or name in ('barrier', 'light', 'structure_void')
    if name in SEED:
        it, disp = SEED[name]
        d['display'] = disp
        d['itemOf'] = it
        if name not in ('water', 'lava'):
            d['icon'] = ('item_' + it) if it in PPCE_ITEMS else d.get('icon', tex if isinstance(tex, str) else None)
        if name == 'redstone_wire':
            d['icon'] = 'item_redstone'
        if name == 'tripwire':
            d['icon'] = 'item_string'
        if name == 'powder_snow':
            d.pop('icon', None)
        st = MC.get('__items__', {}).get(it, 64)
    else:
        st = stack(name)
    if not item:
        d['item'] = False
    else:
        if st != 64:
            d['stack'] = st
    return d


def special(name, gr, c, D, p):
    """The block-entity and odd-model blocks: an engine shape and the textures for it."""
    ex = {}
    w = wood_of(name)
    colour = next((k for k in sorted(COLOURS, key=len, reverse=True) if name.startswith(k + '_')), None)
    if gr == 'bed':
        if name == 'straw_bed':
            return 'bed', {'top': 'straw_bed', 'side': 'straw_bed', 'end': 'straw_bed'}, 'cutout', {'orient': 'horizontal'}
        b = 'bed_' + colour
        return 'bed', {'top': b + '_head_top', 'side': b + '_head_side', 'end': b + '_head_end',
                       'footTop': b + '_foot_top', 'footSide': b + '_foot_side', 'footEnd': b + '_foot_end'}, 'cutout', \
            {'orient': 'horizontal'}
    if gr == 'chest':
        k = 'trapped_chest' if name == 'trapped_chest' else 'ender_chest' if name == 'ender_chest' else \
            name.replace('waxed_', '') if 'copper' in name else 'chest'
        return 'chest', {'top': k + '_top', 'bottom': k + '_bottom', 'side': k + '_side', 'front': k + '_front'}, \
            'cutout', {'orient': 'horizontal'}
    if gr == 'shulker_box':
        k = 'shulker_box' if name == 'shulker_box' else 'shulker_box_' + colour
        return 'cube', {'top': k + '_top', 'bottom': k + '_bottom', 'side': k + '_side'}, 'opaque', {'orient': 'facing'}
    if gr in ('sign', 'wall_sign'):
        t = 'sign_' + w if gr == 'sign' else 'wall_sign_' + w
        ex = {'orient': 'wall'} if gr == 'wall_sign' else {}
        if gr == 'sign':
            ex['icon'] = ('item_' + w + '_sign') if (w + '_sign') in PPCE_ITEMS else 'sign_' + w
        return gr, t, 'cutout', ex
    if gr in ('hanging_sign', 'wall_hanging_sign'):
        t = p   # the stripped log the board is made of
        ex = {'hanging': True}
        if gr.startswith('wall'):
            ex['orient'] = 'wall'
        return ('sign' if gr == 'hanging_sign' else 'wall_sign'), t, 'cutout', ex
    if gr in ('banner', 'wall_banner'):
        ex = {'banner': True}
        if gr == 'wall_banner':
            ex['orient'] = 'wall'
        return ('sign' if gr == 'banner' else 'wall_sign'), colour + '_wool', 'cutout', ex
    if gr in ('head', 'wall_head'):
        kind = name.replace('_wall', '').replace('_skull', '').replace('_head', '')
        h = 'head_' + kind
        ex = {'orient': 'wall' if gr == 'wall_head' else 'rotation'}
        if gr == 'wall_head':
            ex['wall'] = True
        return 'head', {'top': h + '_top', 'bottom': h + '_top', 'side': h + '_side', 'front': h + '_front',
                        'back': h + '_back'}, 'cutout', ex
    if gr == 'flower_pot':
        plant = D.get('plant') or D.get('sapling') or D.get('bamboo')
        if name == 'potted_cactus':
            plant = 'cactus_side'
        if plant:
            ex['plant'] = plant
        if name == 'flower_pot':
            ex['icon'] = 'item_flower_pot'
        return 'pot', 'flower_pot', 'cutout', ex
    if gr == 'anvil':
        return 'anvil', {'top': D['top'], 'bottom': D['body'], 'side': D['body']}, 'opaque', {'orient': 'horizontal'}
    if gr == 'rail':
        return 'rail', D['rail'], 'cutout', {'icon': D['rail']}
    if gr == 'redstone_wire':
        return 'wire', 'redstone_dust_dot', 'cutout', {'texLine': 'redstone_dust_line0'}
    if gr == 'tripwire':
        if name == 'tripwire':
            return 'wire', 'tripwire', 'cutout', {}
        return 'button', 'tripwire_hook', 'cutout', {'orient': 'wall', 'icon': 'tripwire_hook'}
    if gr == 'button':
        return 'button', D.get('texture') or p, 'opaque', {'orient': 'wall'}
    if gr == 'lever':
        return 'button', 'cobblestone', 'cutout', {'orient': 'wall', 'icon': 'lever', 'texLever': 'lever'}
    if gr == 'ladder':
        return 'ladder', 'ladder', 'cutout', {'orient': 'wall', 'icon': 'ladder'}
    if gr == 'chain':
        t = D.get('texture') or p
        ex = {'orient': 'axis'}
        if name == 'iron_chain':
            ex['icon'] = 'item_chain'
        return 'chain', t, 'cutout', ex
    if gr == 'cake':
        ex = {}
        if D.get('candle'):
            ex['candle'] = D['candle']
        else:
            ex['icon'] = 'item_cake'
        return 'cake', {'top': 'cake_top', 'bottom': 'cake_bottom', 'side': 'cake_side'}, 'opaque', ex
    if gr == 'cactus':
        return 'cactus', {'top': 'cactus_top', 'bottom': 'cactus_bottom', 'side': 'cactus_side'}, 'cutout', {}
    if gr == 'fire':
        return 'cross', D['fire'], 'cutout', {}
    if gr == 'portal':
        return 'cube', 'nether_portal', 'translucent', {'orient': 'axis'}
    if gr == 'end_portal':
        return ('thin' if name == 'end_portal' else 'cube'), 'end_portal', 'opaque', {}
    if gr == 'invisible':
        ex = {}
        if name in ('barrier', 'structure_void'):
            ex['icon'] = 'item_' + name
        return 'none', None, 'none', ex
    if gr == 'piston':
        if name in ('piston', 'sticky_piston'):
            return 'cube', {'front': D['platform'], 'back': D['bottom'], 'side': D['side'], 'top': D['side'],
                            'bottom': D['side']}, 'opaque', {'orient': 'facing'}
        if name == 'piston_head':
            return 'thin', {'top': 'piston_top', 'bottom': 'piston_top', 'side': 'piston_side'}, 'opaque', {'orient': 'facing', 'h': 4}
        return 'none', 'piston_side', 'none', {}
    if gr == 'redstone_diode':
        return 'thin', {'top': D['top'], 'bottom': 'smooth_stone', 'side': 'smooth_stone_slab_side'}, 'opaque', \
            {'h': 2, 'orient': 'horizontal', 'icon': 'item_' + name}
    if gr == 'multiface':
        t = D.get('vine') or D.get('glow_lichen') or D.get('sculk_vein') or D.get('texture') or p
        ex = {'orient': 'wall', 'icon': t}
        if name == 'vine':
            ex.update(tint='foliage', wave=2)
        return 'thin', t, 'cutout', ex
    if gr == 'cauldron':
        ex = {}
        if name == 'cauldron':
            ex['icon'] = 'item_cauldron'
        else:
            ex['content'] = D.get('content')
        return 'cube', {'top': 'cauldron_top', 'bottom': 'cauldron_bottom', 'side': 'cauldron_side',
                        'inside': 'cauldron_inner'}, 'cutout', ex
    if gr == 'campfire':
        return 'slab', {'top': D['lit_log'], 'bottom': D['log'], 'side': D['log']}, 'cutout', \
            {'icon': 'item_' + name, 'texFire': D['fire'], 'orient': 'horizontal'}
    if gr == 'bell':
        return 'lantern', {'top': 'bell_top', 'bottom': 'bell_bottom', 'side': 'bell_side'}, 'opaque', {'icon': 'item_bell'}
    if gr == 'brewing_stand':
        return 'cross', 'brewing_stand', 'cutout', {'icon': 'item_brewing_stand', 'texBase': 'brewing_stand_base'}
    if gr == 'hopper':
        return 'cube', {'top': 'hopper_top', 'bottom': 'hopper_outside', 'side': 'hopper_outside', 'inside': 'hopper_inside'}, \
            'cutout', {'icon': 'item_hopper', 'orient': 'facing'}
    if gr == 'lectern':
        return 'cube', {'top': 'lectern_top', 'bottom': 'oak_planks', 'side': 'lectern_sides', 'front': 'lectern_front'}, \
            'opaque', {'orient': 'horizontal'}
    if gr == 'grindstone':
        return 'cube', {'top': 'grindstone_round', 'bottom': 'grindstone_round', 'side': 'grindstone_side',
                        'front': 'grindstone_pivot'}, 'cutout', {'orient': 'horizontal'}
    if gr in ('stonecutter',):
        return 'slab', {'top': 'stonecutter_top', 'bottom': 'stonecutter_bottom', 'side': 'stonecutter_side'}, 'opaque', {'orient': 'horizontal'}
    if gr == 'daylight_detector':
        return 'slab', {'top': 'daylight_detector_top', 'bottom': 'daylight_detector_side', 'side': 'daylight_detector_side'}, 'opaque', {}
    if gr == 'enchanting_table':
        return 'slab', {'top': 'enchanting_table_top', 'bottom': 'enchanting_table_bottom', 'side': 'enchanting_table_side'}, 'opaque', {}
    if gr == 'sculk_sensor':
        if name == 'sculk_shrieker':
            return 'slab', {'top': 'sculk_shrieker_top', 'bottom': 'sculk_shrieker_bottom', 'side': 'sculk_shrieker_side'}, 'opaque', {}
        top = 'calibrated_sculk_sensor_top' if name.startswith('calibrated') else 'sculk_sensor_top'
        return 'slab', {'top': top, 'bottom': 'sculk_sensor_bottom', 'side': 'sculk_sensor_side'}, 'opaque', {}
    if gr == 'end_portal_frame':
        return 'cube', {'top': 'end_portal_frame_top', 'bottom': 'end_stone', 'side': 'end_portal_frame_side'}, 'opaque', {'orient': 'horizontal'}
    if gr == 'partial_cube':
        return 'cube', {'top': D['top'], 'bottom': 'dirt', 'side': D.get('side', 'dirt')}, 'opaque', {}
    if gr == 'composter':
        return 'cube', {'top': 'composter_top', 'bottom': 'composter_bottom', 'side': 'composter_side', 'inside': 'composter_bottom'}, 'cutout', {}
    if gr == 'honey_block':
        return 'cube', {'top': 'honey_block_top', 'bottom': 'honey_block_bottom', 'side': 'honey_block_side'}, 'translucent', {}
    if gr == 'scaffolding':
        return 'cube', {'top': 'scaffolding_top', 'bottom': 'scaffolding_bottom', 'side': 'scaffolding_side'}, 'cutout', {}
    if gr == 'chorus':
        if name == 'chorus_flower':
            return 'cube', 'chorus_flower', 'cutout', {}
        return 'cube', 'chorus_plant', 'cutout', {}
    if gr == 'dragon_egg':
        return 'cube', 'dragon_egg', 'opaque', {'falls': True}
    if gr == 'egg':
        if name == 'turtle_egg':
            return 'head', 'turtle_egg', 'cutout', {'icon': 'item_turtle_egg'}
        k = 'sniffer_egg_not_cracked' if name == 'sniffer_egg' else 'dried_ghast_hydration_0'
        return 'head' if name == 'dried_ghast' else 'cube', {'top': k + '_top', 'bottom': k + '_bottom', 'side': k + '_east',
                                                             'front': k + '_north', 'back': k + '_south'}, 'cutout', {'orient': 'horizontal'}
    if gr == 'heavy_core':
        return 'head', 'heavy_core', 'opaque', {}
    if gr == 'statue':
        k = name.replace('waxed_', '').replace('_golem_statue', '')
        k = {'copper': 'copper_block'}.get(k, k)
        return 'head', k, 'opaque', {'orient': 'rotation'}
    if gr == 'decorated_pot':
        return 'head', 'decorated_pot_side', 'opaque', {'orient': 'horizontal'}
    if gr == 'conduit':
        return 'head', 'conduit', 'cutout', {}
    if gr == 'shelf':
        return 'cube', D.get('all') or p, 'cutout', {'orient': 'horizontal'}
    if gr == 'bamboo':
        return 'rod', 'bamboo_stalk', 'cutout', {'icon': 'item_bamboo', 'offset': True}
    if gr == 'azalea':
        return 'cube', {'top': D['top'], 'bottom': D['top'], 'side': D['side']}, 'cutout', {}
    if gr == 'big_dripleaf':
        return 'thin', {'top': 'big_dripleaf_top', 'bottom': 'big_dripleaf_top', 'side': 'big_dripleaf_side'}, 'cutout', {'orient': 'horizontal'}
    if gr == 'big_dripleaf_stem':
        return 'cross', 'big_dripleaf_stem', 'cutout', {}
    if gr == 'cocoa':
        return 'cross', 'cocoa_stage2', 'cutout', {'orient': 'wall'}
    if gr == 'coral_wall_fan':
        return 'cross', D['fan'], 'cutout', {'orient': 'wall'}
    if gr == 'crystal':
        return 'cross', D['cross'], 'cutout', {'orient': 'facing', 'icon': D['cross']}
    if gr == 'pointed_dripstone':
        t = D['cross']
        return 'cross', t, 'cutout', {'icon': t, 'offset': True}
    if gr == 'sea_pickle':
        return 'cross', 'sea_pickle', 'cutout', {'icon': 'item_sea_pickle'}
    if gr == 'wall_mushroom':
        # (its item is the small model, js/ui/icons.js, not a flat picture)
        return 'button', 'shelf_mushroom_stage0', 'cutout', {'orient': 'wall'}
    issues.append('special fallback ' + name + ' ' + gr)
    fb = c.get('fallback') or 'cube'
    return {'carpet': 'thin', 'none': 'none'}.get(fb, fb), p, 'cutout', {}


blocks = [build(n, c) for n, c in C.items()]
byname = {d['name']: d for d in blocks}

# ------------------------------------------------------------ creative tabs
def suffix_rank(n):
    for i, s in enumerate(['', '_stairs', '_slab', '_wall', '_fence', '_fence_gate', '_door', '_trapdoor',
                           '_pressure_plate', '_button']):
        if s and n.endswith(s):
            return n[: -len(s)], i
    return n, 0


def family(n):
    b, r = suffix_rank(n)
    for cand in (b, b + 's', b + '_block', b.replace('_block', ''), b + '_bricks'):
        if cand in byname and cand != n or (cand == n and r == 0):
            return cand, r
    return b, r


WOOD_ROW = ['{w}_log', '{w}_wood', 'stripped_{w}_log', 'stripped_{w}_wood', '{w}_planks', '{w}_stairs', '{w}_slab',
            '{w}_fence', '{w}_fence_gate', '{w}_door', '{w}_trapdoor', '{w}_pressure_plate', '{w}_button']
BUILDING = []
for w in WOODS:
    row = [s.format(w=w) for s in WOOD_ROW]
    if w in ('crimson', 'warped'):
        row = [r.replace('_log', '_stem').replace('_wood', '_hyphae') for r in row]
    if w == 'bamboo':
        row = ['bamboo_block', 'stripped_bamboo_block', 'bamboo_planks', 'bamboo_mosaic', 'bamboo_stairs',
               'bamboo_mosaic_stairs', 'bamboo_slab', 'bamboo_mosaic_slab', 'bamboo_fence', 'bamboo_fence_gate',
               'bamboo_door', 'bamboo_trapdoor', 'bamboo_pressure_plate', 'bamboo_button']
    BUILDING += row
STONE_BASES = ('stone cobblestone mossy_cobblestone smooth_stone stone_bricks cracked_stone_bricks chiseled_stone_bricks '
               'mossy_stone_bricks granite polished_granite diorite polished_diorite andesite polished_andesite '
               'cobbled_deepslate chiseled_deepslate polished_deepslate deepslate_bricks cracked_deepslate_bricks '
               'deepslate_tiles cracked_deepslate_tiles reinforced_deepslate tuff chiseled_tuff polished_tuff tuff_bricks '
               'chiseled_tuff_bricks bricks packed_mud mud_bricks resin_bricks chiseled_resin_bricks sandstone '
               'chiseled_sandstone smooth_sandstone cut_sandstone red_sandstone chiseled_red_sandstone '
               'smooth_red_sandstone cut_red_sandstone sea_lantern prismarine prismarine_bricks dark_prismarine '
               'netherrack nether_bricks cracked_nether_bricks chiseled_nether_bricks red_nether_bricks basalt '
               'smooth_basalt polished_basalt blackstone gilded_blackstone chiseled_polished_blackstone '
               'polished_blackstone polished_blackstone_bricks cracked_polished_blackstone_bricks end_stone '
               'end_stone_bricks purpur_block purpur_pillar sulfur polished_sulfur sulfur_bricks chiseled_sulfur '
               'potent_sulfur cinnabar polished_cinnabar cinnabar_bricks chiseled_cinnabar coal_block iron_block '
               'iron_bars iron_door iron_trapdoor heavy_weighted_pressure_plate iron_chain gold_block '
               'light_weighted_pressure_plate redstone_block emerald_block lapis_block diamond_block netherite_block '
               'quartz_block chiseled_quartz_block quartz_pillar quartz_bricks smooth_quartz amethyst_block').split()
COPPER = []
for wax in ('', 'waxed_'):
    for age in ('', 'exposed_', 'weathered_', 'oxidized_'):
        blk = wax + (age + 'copper' if age else 'copper_block')
        a = wax + age
        COPPER += [blk, a + 'chiseled_copper', a + 'copper_grate', a + 'cut_copper', a + 'copper_door',
                   a + 'copper_trapdoor', a + 'copper_bulb', a + 'copper_chain', a + 'copper_bars']
STONE_BASES += COPPER

COLORED_FAMS = ['wool', 'wool_stairs', 'wool_slab', 'carpet', 'terracotta', 'concrete', 'concrete_stairs', 'concrete_slab',
                'concrete_powder', 'glazed_terracotta', 'stained_glass', 'stained_glass_pane', 'shulker_box', 'bed',
                'candle', 'banner']
COLORED = ['terracotta', 'glass', 'tinted_glass', 'glass_pane']
for fam in COLORED_FAMS:
    if fam == 'shulker_box':
        COLORED.append('shulker_box')
    if fam == 'candle':
        COLORED.append('candle')
    COLORED += [c + '_' + fam for c in COLOURS]
    if fam == 'bed':
        COLORED.append('straw_bed')

NATURAL = ('grass_block podzol mycelium dirt_path dirt coarse_dirt rooted_dirt farmland mud muddy_mangrove_roots clay '
           'gravel sand suspicious_sand red_sand suspicious_gravel ice packed_ice blue_ice snow_block snow moss_block '
           'moss_carpet pale_moss_block pale_moss_carpet pale_hanging_moss deepslate bedrock calcite dripstone_block '
           'pointed_dripstone sulfur_spike magma_block obsidian crying_obsidian crimson_nylium warped_nylium soul_sand '
           'soul_soil bone_block coal_ore deepslate_coal_ore iron_ore deepslate_iron_ore copper_ore '
           'deepslate_copper_ore gold_ore deepslate_gold_ore redstone_ore deepslate_redstone_ore emerald_ore '
           'deepslate_emerald_ore lapis_ore deepslate_lapis_ore diamond_ore deepslate_diamond_ore nether_gold_ore '
           'nether_quartz_ore ancient_debris raw_iron_block raw_copper_block raw_gold_block glowstone budding_amethyst '
           'small_amethyst_bud medium_amethyst_bud large_amethyst_bud amethyst_cluster').split()
NATURAL += [w + '_leaves' for w in ('oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry',
                                    'pale_oak', 'azalea', 'flowering_azalea', 'orange_poplar', 'red_poplar', 'yellow_poplar')]
NATURAL += ('mushroom_stem brown_mushroom_block red_mushroom_block nether_wart_block warped_wart_block shroomlight').split()
NATURAL += [w + '_sapling' for w in ('oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'pale_oak', 'poplar')]
NATURAL += ('mangrove_propagule crimson_fungus warped_fungus short_grass fern short_dry_grass tall_dry_grass bush '
            'dead_bush red_shrub dandelion golden_dandelion poppy blue_orchid allium azure_bluet red_tulip orange_tulip '
            'white_tulip pink_tulip oxeye_daisy cornflower lily_of_the_valley torchflower cactus_flower '
            'closed_eyeblossom open_eyeblossom wither_rose pink_petals wildflowers leaf_litter spore_blossom bamboo '
            'sugar_cane cactus crimson_roots warped_roots nether_sprouts weeping_vines twisting_vines vine tall_grass '
            'large_fern sunflower lilac rose_bush peony pitcher_plant big_dripleaf small_dripleaf chorus_plant '
            'chorus_flower glow_lichen hanging_roots firefly_bush frogspawn turtle_egg sniffer_egg dried_ghast '
            'wheat cocoa pumpkin_stem melon_stem torchflower_crop pitcher_crop beetroots nether_wart sweet_berry_bush '
            'carrots potatoes cave_vines brown_mushroom red_mushroom shelf_mushroom pumpkin carved_pumpkin '
            'jack_o_lantern hay_block bee_nest honeycomb_block melon dried_kelp_block azalea flowering_azalea '
            'mangrove_roots sponge wet_sponge cobweb resin_block resin_clump creaking_heart lily_pad seagrass kelp '
            'sea_pickle').split()
for dead in ('', 'dead_'):
    for k in ('tube', 'brain', 'bubble', 'fire', 'horn'):
        NATURAL += [dead + k + '_coral_block']
for dead in ('', 'dead_'):
    for k in ('tube', 'brain', 'bubble', 'fire', 'horn'):
        NATURAL += [dead + k + '_coral', dead + k + '_coral_fan']
NATURAL += ('sculk sculk_vein sculk_catalyst sculk_shrieker sculk_sensor infested_stone infested_cobblestone '
            'infested_stone_bricks infested_mossy_stone_bricks infested_cracked_stone_bricks '
            'infested_chiseled_stone_bricks infested_deepslate water lava powder_snow').split()

FUNCTIONAL = ('torch soul_torch copper_torch lantern soul_lantern copper_lantern exposed_copper_lantern '
              'weathered_copper_lantern oxidized_copper_lantern waxed_copper_lantern waxed_exposed_copper_lantern '
              'waxed_weathered_copper_lantern waxed_oxidized_copper_lantern end_rod sea_lantern_x ochre_froglight '
              'verdant_froglight pearlescent_froglight crafting_table stonecutter cartography_table fletching_table '
              'smithing_table grindstone loom furnace smoker blast_furnace campfire soul_campfire anvil chipped_anvil '
              'damaged_anvil composter jukebox enchanting_table end_crystal brewing_stand cauldron bell beacon conduit '
              'lodestone ladder scaffolding beehive suspicious_x chest barrel ender_chest copper_chest exposed_copper_chest '
              'weathered_copper_chest oxidized_copper_chest waxed_copper_chest waxed_exposed_copper_chest '
              'waxed_weathered_copper_chest waxed_oxidized_copper_chest respawn_anchor bookshelf chiseled_bookshelf '
              'lectern flower_pot decorated_pot cake').split()
for w in WOODS:
    FUNCTIONAL += [w + '_shelf']
for w in WOODS:
    FUNCTIONAL += [w + '_sign', w + '_hanging_sign']
FUNCTIONAL += ('skeleton_skull wither_skeleton_skull player_head zombie_head creeper_head piglin_head dragon_head '
               'dragon_egg end_portal_frame vault heavy_core copper_golem_statue exposed_copper_golem_statue '
               'weathered_copper_golem_statue oxidized_copper_golem_statue waxed_copper_golem_statue '
               'waxed_exposed_copper_golem_statue waxed_weathered_copper_golem_statue waxed_oxidized_copper_golem_statue '
               'infested_x').split()
REDSTONE = ('redstone_wire redstone_torch redstone_block repeater comparator target lever stone_button polished_blackstone_button '
            'stone_pressure_plate polished_blackstone_pressure_plate light_weighted_pressure_plate heavy_weighted_pressure_plate sculk_sensor_x calibrated_sculk_sensor '
            'amethyst_x lightning_rod exposed_lightning_rod weathered_lightning_rod oxidized_lightning_rod '
            'waxed_lightning_rod waxed_exposed_lightning_rod waxed_weathered_lightning_rod waxed_oxidized_lightning_rod '
            'daylight_detector piston sticky_piston slime_block honey_block dispenser dropper crafter hopper '
            'trapped_chest observer tripwire_hook tripwire note_block rail powered_rail detector_rail activator_rail '
            'tnt redstone_lamp').split()

TAB_LISTS = [('functional', FUNCTIONAL), ('redstone', REDSTONE), ('colored', COLORED), ('natural', NATURAL)]
assigned = {}
for tab, lst in TAB_LISTS:
    for i, n in enumerate(lst):
        if n in byname and n not in assigned:
            assigned[n] = (tab, i)

# building: the wood rows, then stone and metal families with their stairs, slabs and walls
order_b = []
seen = set()
for n in BUILDING:
    if n in byname and n not in assigned:
        order_b.append(n); seen.add(n)
fam = collections.defaultdict(list)
for d in blocks:
    n = d['name']
    if n in assigned or n in seen:
        continue
    fb, r = family(n)
    fam[fb].append((r, n))
for b in STONE_BASES:
    for r, n in sorted(fam.pop(b, []) + ([(0, b)] if False else [])):
        if n not in seen:
            order_b.append(n); seen.add(n)
leftover = []
for b, mem in sorted(fam.items()):
    for r, n in sorted(mem):
        leftover.append(n)

tabcount = collections.Counter()
for d in blocks:
    n = d['name']
    if d.get('item') is False or OPERATOR.match(n):
        d['tab'] = None
        continue
    if n in assigned:
        d['tab'], d['order'] = assigned[n]
        continue
    if n in seen:
        d['tab'], d['order'] = 'building', order_b.index(n)
        continue
    # anything else: plants and ground cover to natural, shaped blocks to building
    if d['shape'] in ('cross', 'crop', 'pad') or n.startswith('infested_'):
        d['tab'] = 'natural'
        d['order'] = 1000 + leftover.index(n) if n in leftover else 1000
    elif d['shape'] in ('chest', 'sign', 'wall_sign', 'head', 'lantern', 'torch', 'candle', 'pot'):
        d['tab'] = 'functional'
        d['order'] = 1000 + leftover.index(n) if n in leftover else 1000
    else:
        d['tab'] = 'building'
        d['order'] = 1000 + leftover.index(n) if n in leftover else 1000
for d in blocks:
    if d.get('tab'):
        tabcount[d['tab']] += 1
# renumber orders densely inside each tab
for tab in ('building', 'colored', 'natural', 'functional', 'redstone'):
    mem = sorted([d for d in blocks if d.get('tab') == tab], key=lambda d: (d['order'], d['name']))
    for i, d in enumerate(mem):
        d['order'] = i
for d in blocks:
    if d.get('tab') is None:
        d.pop('order', None)

# ------------------------------------------------------------------ write
KEYS = ['name', 'display', 'shape', 'pass', 'tex', 'texUpper', 'texLit', 'texFlow', 'icon', 'iconMeta', 'plant', 'tint',
        'light', 'opacity', 'solid', 'replaceable', 'hardness', 'tab', 'order', 'item', 'itemOf', 'stack', 'orient',
        'falls', 'slippery', 'leaves', 'wave', 'offset', 'tall', 'waterlogged']


def emit(d):
    keys = [k for k in KEYS if k in d] + sorted(k for k in d if k not in KEYS)
    o = {}
    for k in keys:
        v = d[k]
        if k == 'tab' and v is None:
            o[k] = None
            continue
        o[k] = v
    return json.dumps(o, separators=(',', ':'), ensure_ascii=False)


lines = [emit(d) for d in blocks]
hdr = ('/* GENERATED by tools/leoncraft2/build_blocks.py - do not edit by hand.\n'
       '   Every vanilla block up to 26.3 (%d): shape, textures, behaviour, creative tab.\n'
       '   Block facts (hardness, stack size, light, collision) come from PrismarineJS\n'
       '   minecraft-data 26.1 (MIT, https://github.com/PrismarineJS/minecraft-data);\n'
       '   26.2 and 26.3 blocks borrow the numbers of their nearest older block.\n'
       '   Texture names refer to layers in textures/manifest.json (Pixel Perfection,\n'
       '   CC BY-SA 4.0, see textures/LICENSE.txt). One JSON object per line. */\n') % len(blocks)
with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write(hdr + 'export const DATA = [\n' + ',\n'.join(lines) + '\n];\n')

# ------------------------------------------------------------------ summary
print('wrote', os.path.normpath(OUT), len(blocks), 'blocks', os.path.getsize(OUT), 'bytes')
print('shapes:', dict(collections.Counter(d['shape'] for d in blocks).most_common()))
print('tabs:', dict(collections.Counter(d.get('tab') for d in blocks).most_common()))
notex = [d['name'] for d in blocks if d.get('tex') is None and d['shape'] != 'none']
print('no icon (drawn as a 3D box):', sum(1 for d in blocks if d.get('tab') and not d.get('icon')), 'flat icons:', sum(1 for d in blocks if d.get('icon')))
print('no texture:', notex)
for i in issues:
    print('note:', i)
