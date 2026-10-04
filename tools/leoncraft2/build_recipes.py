"""
Leoncraft 2 - the recipe build.

Writes public/leoncraft2/js/recipedata.js: every recipe of Minecraft 26.3
that a crafting grid, a furnace, a smoker, a blast furnace, a campfire or a
stonecutter uses, from the game's own recipe data (the JSON under
data/minecraft/recipe, with the item tags under data/minecraft/tags/item
spelled out). minecraft-data, which itemdata.js's RECIPES came from, keeps
only one item of a tag in some recipes (dyeing wool took black wool only),
so the crafting grid reads this instead.

Input: a checkout of misode/mcmeta at the tag 26.3-data-json (the folder
holding data/minecraft), the same data tools/leoncraft2/build_vanilla.py
reads. Nothing is copied into the repo, only the generated module.

  python tools/leoncraft2/build_recipes.py <mcmeta data-json root>

Output (names without "minecraft:"; an ingredient is an index into SETS, a
list of the items that fit, -1 for an empty cell):

  SETS        [[item, ...], ...]
  CRAFTING    [result, count, w, h, cells, category, group]
                shaped: w x h cells, row by row; shapeless: w = h = 0 and
                cells is one ingredient per item
  TRANSMUTE   [result ('' = the input's own item), input, material, category,
               group, material min, material max, add the materials to the count]
  SPECIAL     the recipes the game works out in code: { type: {...} }
  COOKING     [kind, input, result, count, xp, ticks, category, group]
                kind: smelting, blasting, smoking, campfire_cooking
  CUTTING     [input, result, count]
  SMITHING    [template, base, addition, result] (upgrades) and
  TRIMS       [template, base, addition, pattern]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'leoncraft2', 'js', 'recipedata.js')


def strip(s):
    return s[10:] if isinstance(s, str) and s.startswith('minecraft:') else s


def main(src):
    data = os.path.join(src, 'data', 'minecraft')
    tag_dir = os.path.join(data, 'tags', 'item')
    tags = {}

    def tag(name):
        if name in tags: return tags[name]
        tags[name] = []
        p = os.path.join(tag_dir, name + '.json')
        out = []
        if os.path.exists(p):
            for v in json.load(open(p, encoding='utf-8'))['values']:
                if isinstance(v, dict): v = v['id']
                v = strip(v)
                for x in (tag(v[1:].replace('minecraft:', '')) if v.startswith('#') else [v]):
                    if x not in out: out.append(x)
        tags[name] = out
        return out

    sets, set_index = [], {}

    def ing(x):
        """An ingredient (an id, a #tag or a list of ids) as an index into SETS."""
        if x is None: return -1
        if isinstance(x, dict): x = x.get('item') or ('#' + x['tag'] if 'tag' in x else None)
        if isinstance(x, list):
            items = []
            for y in x:
                for z in ing_items(y):
                    if z not in items: items.append(z)
        else:
            items = ing_items(x)
        key = tuple(items)
        if key not in set_index:
            set_index[key] = len(sets)
            sets.append(list(items))
        return set_index[key]

    def ing_items(x):
        x = strip(x)
        if x.startswith('#'): return tag(strip(x[1:]))
        return [x]

    def result(r):
        return strip(r.get('id', '')), r.get('count', 1)

    crafting, transmute, special, cooking, cutting, smithing, trims = [], [], {}, [], [], [], []
    rdir = os.path.join(data, 'recipe')
    for fn in sorted(os.listdir(rdir)):
        if not fn.endswith('.json'): continue
        d = json.load(open(os.path.join(rdir, fn), encoding='utf-8'))
        t = strip(d['type'])
        cat, group = d.get('category', 'misc'), d.get('group', '')
        rid = fn[:-5]
        if t == 'crafting_shaped':
            pat = d['pattern']
            w, h = max(len(r) for r in pat), len(pat)
            cells = []
            for row in pat:
                for ch in row.ljust(w):
                    cells.append(-1 if ch == ' ' else ing(d['key'][ch]))
            res, n = result(d['result'])
            crafting.append([res, n, w, h, cells, cat, group])
        elif t == 'crafting_shapeless':
            res, n = result(d['result'])
            crafting.append([res, n, 0, 0, [ing(x) for x in d['ingredients']], cat, group])
        elif t == 'crafting_transmute':
            res, n = result(d['result']) if d.get('result') else ('', 1)
            mc = d.get('material_count', 1)
            lo, hi = (mc.get('min', 1), mc.get('max', 1)) if isinstance(mc, dict) else (mc, mc)
            transmute.append([res, ing(d['input']), ing(d['material']), cat, group, lo, hi, 1 if d.get('add_material_count_to_result') else 0])
        elif t in ('smelting', 'blasting', 'smoking', 'campfire_cooking'):
            res, n = result(d['result'])
            cooking.append([t, ing(d['ingredient']), res, n, d.get('experience', 0), d.get('cookingtime', 200), cat, group])
        elif t == 'stonecutting':
            res, n = result(d['result'])
            cutting.append([ing(d['ingredient']), res, n])
        elif t == 'smithing_transform':
            res, n = result(d['result'])
            smithing.append([ing(d['template']), ing(d['base']), ing(d['addition']), res])
        elif t == 'smithing_trim':
            trims.append([ing(d['template']), ing(d['base']), ing(d['addition']), strip(d.get('pattern', rid.replace('_armor_trim_smithing_template_smithing_trim', '')))])
        elif t == 'crafting_dye':
            special.setdefault('dye', []).append({'target': ing(d['target']), 'dye': ing(d['dye']), 'result': result(d['result'])[0], 'group': group})
        elif t == 'crafting_imbue':
            res, n = result(d['result'])
            special['imbue'] = {'source': ing(d['source']), 'material': ing(d['material']), 'result': res, 'count': n}
        elif t == 'crafting_decorated_pot':
            special['decorated_pot'] = {'sides': ing(d['back']), 'result': result(d['result'])[0]}
        elif t == 'crafting_special_firework_rocket':
            special['firework_rocket'] = {'shell': ing(d['shell']), 'fuel': ing(d['fuel']), 'star': ing(d['star']), 'result': result(d['result'])[0], 'count': result(d['result'])[1]}
        elif t == 'crafting_special_firework_star':
            special['firework_star'] = {'fuel': ing(d['fuel']), 'dye': ing(d['dye']), 'trail': ing(d['trail']), 'twinkle': ing(d['twinkle']),
                                        'shapes': {k: ing(v) for k, v in d['shapes'].items()}, 'result': result(d['result'])[0]}
        elif t == 'crafting_special_firework_star_fade':
            special['firework_star_fade'] = {'target': ing(d['target']), 'dye': ing(d['dye']), 'result': result(d['result'])[0]}
        elif t == 'crafting_special_bannerduplicate':
            special.setdefault('banner_duplicate', []).append(strip(d['banner']))
        elif t == 'crafting_special_bookcloning':
            special['book_cloning'] = {'source': ing(d['source']), 'material': ing(d['material']), 'result': result(d['result'])[0]}
        elif t == 'crafting_special_mapextending':
            special['map_extending'] = {'map': ing(d['map']), 'material': ing(d['material'])}
        elif t == 'crafting_special_shielddecoration':
            special['shield_decoration'] = {'banner': ing(d['banner']), 'target': ing(d['target'])}
        elif t == 'crafting_special_repairitem':
            special['repair_item'] = {}
        else:
            print('unhandled', t, fn)

    def js(x):
        return json.dumps(x, separators=(',', ':'), ensure_ascii=False)

    lines = ['/* GENERATED by tools/leoncraft2/build_recipes.py - do not edit by hand.',
             '   Every crafting, cooking and stonecutting recipe of Minecraft 26.3, from',
             "   the game's own recipe data (misode/mcmeta 26.3-data-json), item tags spelled",
             '   out. An ingredient is an index into SETS (-1: an empty cell). */',
             'export const SETS = [']
    lines += [js(s) + ',' for s in sets]
    lines += ['];', 'export const CRAFTING = [']
    lines += [js(r) + ',' for r in crafting]
    lines += ['];', 'export const TRANSMUTE = [']
    lines += [js(r) + ',' for r in transmute]
    lines += ['];', 'export const SPECIAL = ' + js(special) + ';', 'export const COOKING = [']
    lines += [js(r) + ',' for r in cooking]
    lines += ['];', 'export const CUTTING = [']
    lines += [js(r) + ',' for r in cutting]
    lines += ['];', 'export const SMITHING = ' + js(smithing) + ';', 'export const TRIMS = ' + js(trims) + ';', '']
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines))
    print('recipedata.js:', len(crafting), 'crafting,', len(transmute), 'transmute,', len(special), 'special kinds,',
          len(cooking), 'cooking,', len(cutting), 'stonecutting,', len(smithing), 'smithing,', len(trims), 'trims,', len(sets), 'ingredient sets')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1])
