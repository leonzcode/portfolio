"""Leoncraft 2 - packs the vanilla worldgen data the vanilla generator needs.

    python tools/leoncraft2/build_vanilla.py <mcmeta data-json root> <biome_parameters overworld.json>

<mcmeta data-json root> is a checkout of misode/mcmeta at the tag
`26.3-data-json` (the folder holding data/minecraft/worldgen). The biome
parameter list is not in the data (it is built in code), so it comes from
the game's own report: run the 26.3 server jar's data generator
(java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports)
and pass reports/biome_parameters/minecraft/overworld.json.

Writes public/leoncraft2/js/gen/vdata.js: functional numeric data only
(density functions, noise parameters, material rules, the biome table and
the feature lists), as one minified JSON object.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'leoncraft2', 'js', 'gen', 'vdata.js')


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def strip(s):
    return s[10:] if isinstance(s, str) and s.startswith('minecraft:') else s


def walk(folder, sub=''):
    out = {}
    base = os.path.join(folder, sub)
    for dirpath, _, files in os.walk(base):
        for fn in files:
            if fn.endswith('.json'):
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, folder).replace('\\', '/')[:-5]
                out[rel] = load(full)
    return out


def main():
    mc, report = sys.argv[1], sys.argv[2]
    wg = os.path.join(mc, 'data', 'minecraft', 'worldgen')
    data = {'version': '26.3'}

    # density functions: the overworld ones and the few at the top level
    dfs = walk(os.path.join(wg, 'density_function'))
    data['density_function'] = {k: v for k, v in dfs.items()
                                if k.startswith('overworld/') or '/' not in k}
    data['noise'] = walk(os.path.join(wg, 'noise'))
    ns = load(os.path.join(wg, 'noise_settings', 'overworld.json'))
    ns.pop('debug_functions', None)
    data['noise_settings'] = ns
    data['material_rule'] = {k: v for k, v in walk(os.path.join(wg, 'material_rule')).items()
                             if k.startswith('overworld') or k.startswith('bedrock')}
    data['material_condition'] = walk(os.path.join(wg, 'material_condition'))

    # the biome table: each entry is a biome and seven parameter ranges, the
    # values drawn from a short list of distinct numbers
    entries = load(report)['biomes']
    names = sorted({strip(e['biome']) for e in entries})
    values = sorted({v for e in entries for p in e['parameters'].values()
                     for v in (p if isinstance(p, list) else [p])})
    assert len(values) < 64 and len(names) < 64
    alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    keys = ['temperature', 'humidity', 'continentalness', 'erosion', 'depth', 'weirdness']
    enc = []
    for e in entries:
        p = e['parameters']
        s = alpha[names.index(strip(e['biome']))]
        for k in keys:
            v = p[k] if isinstance(p[k], list) else [p[k], p[k]]
            s += alpha[values.index(v[0])] + alpha[values.index(v[1])]
        s += alpha[values.index(p['offset'])]
        enc.append(s)
    data['biome_params'] = {'names': names, 'values': values, 'entries': ''.join(enc), 'width': 14}

    # biomes: climate and the feature and carver lists (for decoration)
    biomes = {}
    for k, v in walk(os.path.join(wg, 'biome')).items():
        biomes[k] = {
            'temperature': v.get('temperature'), 'downfall': v.get('downfall'),
            'temperature_modifier': v.get('temperature_modifier', 'none'),
            'has_precipitation': v.get('has_precipitation'),
            'features': [[strip(f) for f in step] for step in v.get('features', [])],
            'carvers': [strip(c) for c in (v.get('carvers') or [])] if isinstance(v.get('carvers'), list) else v.get('carvers'),
        }
    data['biome'] = {k: v for k, v in biomes.items() if k in names}
    data['configured_carver'] = walk(os.path.join(wg, 'carver'))
    placed = walk(os.path.join(wg, 'placed_feature'))
    configured = walk(os.path.join(wg, 'feature'))
    # only the features the overworld's biomes can reach
    keep_p, keep_c = set(), set()
    REFKEYS = {'feature', 'default', 'feature_true', 'feature_false', 'placed_feature', 'vegetation_feature', 'data'}

    def ref(name, configured_first=False):
        n = strip(name)
        if not isinstance(n, str):
            return
        if not configured_first and n in placed:
            if n not in keep_p:
                keep_p.add(n)
                visit(placed[n], True)
        elif n in configured:
            if n not in keep_c:
                keep_c.add(n)
                visit(configured[n], False)
        elif n in placed and n not in keep_p:
            keep_p.add(n)
            visit(placed[n], True)

    def visit(o, is_placed):
        if isinstance(o, list):
            for e in o:
                if isinstance(e, str):
                    ref(e)
                else:
                    visit(e, False)
            return
        if not isinstance(o, dict):
            return
        inline_placed = 'placement' in o
        for k, v in o.items():
            if isinstance(v, str) and k in REFKEYS:
                ref(v, configured_first=inline_placed or is_placed)
            elif k == 'features' and isinstance(v, list):
                visit(v, False)
            elif isinstance(v, (dict, list)):
                visit(v, False)

    for b in data['biome'].values():
        for step in b['features']:
            for f in step:
                ref(f)
    data['placed_feature'] = {k: placed[k] for k in sorted(keep_p)}
    data['configured_feature'] = {k: configured[k] for k in sorted(keep_c)}
    # block tags (lists of block names and other tags)
    data['block_tags'] = {k: v.get('values', []) for k, v in walk(os.path.join(mc, 'data', 'minecraft', 'tags', 'block')).items()}

    js = ('/* GENERATED by tools/leoncraft2/build_vanilla.py - do not edit by hand.\n'
          '   Minecraft 26.3 worldgen data (density functions, noises, material rules,\n'
          '   the overworld biome table, biome feature lists, carvers and features),\n'
          '   from misode/mcmeta (26.3-data-json) and the game\'s biome_parameters report.\n'
          '   Functional numeric data only. */\n'
          'export const VDATA = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(js)
    print('wrote', OUT, len(js) // 1024, 'KB')


if __name__ == '__main__':
    main()
