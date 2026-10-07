"""
Leoncraft 2 - advancements data build.

Writes public/leoncraft2/js/advdata.js: the game's advancements (Java 26.1)
as the game's own data describes them, boiled down to what Leoncraft's
advancement code (js/advancements.js) needs: each one's tab, parent, icon,
frame, whether it is hidden, its title and description (the game's names
and one-line labels, from the jar's en_us.json), and for each criterion its
trigger and the few conditions read here (the items, entity types,
structures, biomes, dimensions, loot tables, effects and the like), with item
and entity tags opened into names. Requirements are kept as the game has
them (a list of "any of" groups that must all be met).

Input: the player's own Minecraft client jar, read locally. Nothing else of
the jar is copied.

  python tools/leoncraft2/build_advancements.py <client jar>
"""
import json, os, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'leoncraft2', 'js', 'advdata.js')
strip = lambda s: s.replace('minecraft:', '') if isinstance(s, str) else s


def main():
    z = zipfile.ZipFile(sys.argv[1])
    lang = json.loads(z.read('assets/minecraft/lang/en_us.json'))
    names = set(z.namelist())

    def tag(kind, name, depth=0):
        p = 'data/minecraft/tags/%s/%s.json' % (kind, strip(name).lstrip('#'))
        if p not in names or depth > 6:
            return []
        out = []
        for v in json.loads(z.read(p))['values']:
            v = v if isinstance(v, str) else v['id']
            out += tag(kind, v, depth + 1) if v.startswith('#') else [strip(v)]
        return out

    def expand(kind, v):
        vs = v if isinstance(v, list) else [v]
        out = []
        for x in vs:
            out += tag(kind, x) if x.startswith('#') else [strip(x)]
        return out

    def items_of(p):
        if not p or 'items' not in p:
            return None
        return expand('item', p['items'])

    def player_pred(c):
        out = {}
        for cond in (c or {}).get('player', []) or []:
            pr = cond.get('predicate', {}) if isinstance(cond, dict) else {}
            loc = pr.get('location', {})
            if 'structures' in loc: out['structure'] = strip(loc['structures'])
            if 'biomes' in loc: out['biome'] = strip(loc['biomes'])
            if 'dimension' in loc: out['dim'] = strip(loc['dimension'])
            if 'position' in loc and 'y' in loc['position']: out['y'] = loc['position']['y']
            if 'stepping_on' in pr: out['on'] = expand('block', pr['stepping_on']['block']['blocks'])
            if 'equipment' in pr: out['wear'] = {k: items_of(v) for k, v in pr['equipment'].items()}
            if 'vehicle' in pr:
                v = pr['vehicle']
                out['vehicle'] = expand('entity_type', v.get('type', [])) if v.get('type') else []
                if 'passenger' in v: out['passenger'] = expand('entity_type', v['passenger'].get('type', []))
            ts = pr.get('type_specific', {})
            if ts.get('looking_at'): out['looking'] = expand('entity_type', ts['looking_at'].get('type', []))
        return out

    def entity_types(c, key='entity'):
        for cond in (c or {}).get(key, []) or []:
            pr = cond.get('predicate', {}) if isinstance(cond, dict) else {}
            if 'type' in pr:
                return expand('entity_type', pr['type'])
        return None

    out = []
    for n in sorted(names):
        if not n.startswith('data/minecraft/advancement/') or not n.endswith('.json') or '/recipes/' in n:
            continue
        d = json.loads(z.read(n))
        disp = d.get('display')
        if not disp:
            continue
        aid = n[len('data/minecraft/advancement/'):-5]
        t, de = disp.get('title', {}), disp.get('description', {})
        a = {
            'id': aid, 'parent': strip(d.get('parent') or ''), 'icon': strip(disp['icon'].get('id', '')),
            'frame': disp.get('frame', 'task'), 'title': lang.get(t.get('translate', ''), ''), 'desc': lang.get(de.get('translate', ''), ''),
        }
        if disp.get('hidden'): a['hidden'] = 1
        crit = {}
        for k, v in d.get('criteria', {}).items():
            c = v.get('conditions') or {}
            e = {'t': strip(v.get('trigger', ''))}
            if 'items' in c and isinstance(c['items'], list): e['items'] = [items_of(x) or [] for x in c['items']]
            if 'item' in c and isinstance(c['item'], dict): e['item'] = items_of(c['item'])
            et = entity_types(c)
            if et: e['entity'] = et
            if 'to' in c: e['to'] = strip(c['to'])
            if 'from' in c: e['from'] = strip(c['from'])
            if 'loot_table' in c: e['loot'] = strip(c['loot_table'])
            if 'block' in c and isinstance(c['block'], str): e['block'] = strip(c['block'])
            if 'effects' in c: e['effects'] = [strip(x) for x in c['effects']]
            if 'distance' in c: e['distance'] = c['distance']
            p = player_pred(c)
            if p: e['player'] = p
            crit[k] = e
        a['crit'] = crit
        if d.get('requirements'): a['req'] = d['requirements']
        out.append(a)
    js = ',\n'.join(json.dumps(a, separators=(',', ':'), ensure_ascii=False) for a in out)
    head = ('/* GENERATED by tools/leoncraft2/build_advancements.py from the game\'s advancement data - do not edit by hand.\n'
            '   %d advancements of Minecraft 26.1: tab and parent, icon, frame, the game\'s names and one-line labels,\n'
            '   criteria (trigger and the conditions js/advancements.js reads) and requirements. */\n') % len(out)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + 'export const ADVANCEMENTS = [\n' + js + '\n];\n')
    print('wrote', OUT, len(out))


if __name__ == '__main__':
    main()
