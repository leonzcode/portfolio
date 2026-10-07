"""
Leoncraft 2 - chest loot table build.

Writes public/leoncraft2/js/struct/lootdata.js: every chest (and dispenser)
loot table of Minecraft 26.3, boiled down to what the game needs to fill a
container: pools, how many rolls, the weighted entries, the count range of each
item and a small set of flags for the things that change a stack (enchanting,
damage, potions, maps, stews and so on).

Input: a folder of loot table JSON laid out like the game's own data, that is
chests/**/*.json (and dispensers/**/*.json when there are any). Either
unpack it from a server jar yourself, or let this script read the jar:

  python tools/leoncraft2/build_loot.py <folder holding chests/ and dispensers/>
  python tools/leoncraft2/build_loot.py --jar <server.jar>
  python tools/leoncraft2/build_loot.py --jar <client or server jar> --only archaeology

--only <folder,...> keeps every table already in lootdata.js and takes from
the source only the tables under those folders (the archaeology tables, what
suspicious sand and gravel hold, were added this way from 26.1.2, the newest
jar to hand; their names keep the folder: "archaeology/desert_pyramid").
Older jars write a table's functions as "functions" with a "function" key;
both spellings are read.

--jar understands the bundler jar (the real jar sits inside at
META-INF/versions/<v>/server-<v>.jar). Nothing is copied into the repo, only
the generated module is written.

Output shape, one table per line, keyed by the path under chests/ (dispenser
tables keep their dispensers/ prefix), item ids without "minecraft:":

  "simple_dungeon": [ { "rolls": [min, max], "entries": [ ENTRY, ... ] }, ... ]

  pool    "rolls":  [min, max]     (a plain number n is written [n, n])
          "bin":    [n, p]         rolls from a binomial instead of "rolls"
          "chance": p              the pool only runs with this probability

  ENTRY   [item, weight, min, max, flags]
          item ""                  an empty entry (or a nested table, see flags)
          min, max                 the stack's count range (both left out for a
                                   plain 1 with no flags; a constant is min = max)
          flags (only when needed, keys in the order the game applies them):
            ench:   true                         enchant_randomly, default pool
                    { from: [ids] }              enchant_randomly from a list
                    { levels: [min, max], from? } enchant_with_levels
                    { set: { id: level } }       set_enchantments
            damage: [min, max]   durability left as a fraction (1 = undamaged)
            map:    "tag"        exploration map to this destination, with
                                 deco / name / zoom when the table sets them
            potion: id           set_potion
            stew:   [[effect, min, max], ...]    set_stew_effect (seconds)
            amp:    [min, max]   ominous bottle amplifier
            instrument: "tag" or [ids]           goat horn
            chance: p            the entry only exists with this probability
            biome / notBiome: [ids]              needs (or must not be) this biome
            table:  "other_table"                a nested loot table
            bin:    [n, p]       count is a binomial draw instead of min..max
            cl:     true         the count is rolled after the other flags
"""
import json, os, sys, io, zipfile, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'leoncraft2', 'js', 'struct', 'lootdata.js')
DEFAULT_TAG = 'on_random_loot'


def ns(s):
    """minecraft:thing -> thing, #minecraft:tag -> tag"""
    s = s.lstrip('#')
    return s.split(':', 1)[1] if ':' in s else s


def provider(p, label):
    """A number provider -> ('c', n) | ('u', min, max) | ('b', n, p)."""
    if isinstance(p, (int, float)):
        return ('u', p, p)
    t = ns(p.get('type', 'uniform'))
    if t == 'constant':
        return ('u', p['value'], p['value'])
    if t == 'uniform':
        lo, hi = p['min'], p['max']
        if not isinstance(lo, (int, float)) or not isinstance(hi, (int, float)):
            raise SystemExit('%s: nested number provider in uniform: %r' % (label, p))
        return ('u', lo, hi)
    if t == 'binomial':
        n, pr = p['n'], p['p']
        if not isinstance(n, (int, float)) or not isinstance(pr, (int, float)):
            raise SystemExit('%s: nested number provider in binomial: %r' % (label, p))
        return ('b', n, pr)
    raise SystemExit('%s: unknown number provider %r' % (label, p))


def options_of(o):
    """enchant options: a tag name (string) or a list of ids -> None for the default tag, else a list."""
    if isinstance(o, list):
        return [ns(x) for x in o]
    tag = ns(o)
    return None if tag == DEFAULT_TAG else '#' + tag


def condition_flags(c, flags, label):
    t = ns(c['type'])
    if t == 'random_chance':
        flags['chance'] = c['chance']
    elif t == 'location_check':
        b = c['predicate']['biomes']
        flags['biome'] = [ns(x) for x in (b if isinstance(b, list) else [b])]
    elif t == 'inverted' and ns(c['term']['type']) == 'location_check':
        b = c['term']['predicate']['biomes']
        flags['notBiome'] = [ns(x) for x in (b if isinstance(b, list) else [b])]
    else:
        raise SystemExit('%s: unsupported condition %r' % (label, c))


RNG_FLAGS = ('ench', 'damage', 'stew', 'amp', 'instrument')


def apply_modifiers(mods, flags, label):
    """Fold a modifier (or list of them) into a flags dict. Returns the count provider or None."""
    count = None
    count_pos = None
    rng_before = False
    late = False
    if mods is None:
        return None
    if isinstance(mods, dict):
        mods = [mods]
    for m in mods:
        t = ns(m.get('type') or m['function'])
        if t == 'set_count':
            if m.get('add'):
                raise SystemExit('%s: set_count with add is not handled' % label)
            count = provider(m['count'], label)
            late = rng_before
        elif t == 'enchant_randomly':
            opts = options_of(m['options']) if 'options' in m else None
            flags['ench'] = True if opts is None else {'from': opts}
            rng_before = True
        elif t == 'enchant_with_levels':
            lv = provider(m['levels'], label)
            if lv[0] != 'u':
                raise SystemExit('%s: enchant levels must be uniform' % label)
            e = {'levels': [lv[1], lv[2]]}
            opts = options_of(m['options']) if 'options' in m else None
            if opts is not None:
                e['from'] = opts
            flags['ench'] = e
            rng_before = True
        elif t == 'set_enchantments':
            flags['ench'] = {'set': {ns(k): v for k, v in m['enchantments'].items()}}
        elif t == 'set_damage':
            d = provider(m['damage'], label)
            flags['damage'] = [d[1], d[2]]
            rng_before = True
        elif t == 'exploration_map':
            flags['map'] = ns(m['destination'])
            if 'decoration' in m:
                flags['deco'] = ns(m['decoration'])
            if 'zoom' in m:
                flags['zoom'] = m['zoom']
        elif t == 'set_name':
            nm = m['name']
            flags['name'] = nm['translate'] if isinstance(nm, dict) else nm
        elif t == 'filtered':
            # a map that finds no structure is dropped; the caller handles it
            if ns(m['on_fail']['type']) != 'discard':
                raise SystemExit('%s: filtered on_fail %r' % (label, m['on_fail']))
        elif t == 'set_potion':
            flags['potion'] = ns(m['id'])
        elif t == 'set_stew_effect':
            eff = []
            for e in m['effects']:
                d = provider(e['duration'], label)
                eff.append([ns(e['type']), d[1], d[2]])
            flags['stew'] = eff
            rng_before = True
        elif t == 'set_ominous_bottle_amplifier':
            a = provider(m['amplifier'], label)
            flags['amp'] = [a[1], a[2]]
            rng_before = True
        elif t == 'set_instrument':
            o = m['options']
            flags['instrument'] = [ns(x) for x in o] if isinstance(o, list) else ns(o)
            rng_before = True
        else:
            raise SystemExit('%s: unsupported modifier %r' % (label, m))
    if count is not None and late:
        flags['cl'] = True
    return count


def build_entry(e, pool_mods, label):
    t = ns(e['type'])
    weight = e.get('weight', 1)
    if 'quality' in e:
        raise SystemExit('%s: quality is not handled' % label)
    flags = {}
    if 'condition' in e:
        condition_flags(e['condition'], flags, label)
    if 'conditions' in e:
        raise SystemExit('%s: conditions list not handled' % label)
    if t == 'empty':
        return ['', weight] if not flags else ['', weight, 1, 1, flags]
    count = None
    if t == 'item':
        item = ns(e['name'])
    elif t == 'loot_table':
        item = ''
        v = e['value']
        if not isinstance(v, str):
            raise SystemExit('%s: inline nested table not handled' % label)
        flags['table'] = re.sub(r'^chests/', '', ns(v))
    else:
        raise SystemExit('%s: unsupported entry type %r' % (label, e['type']))
    c1 = apply_modifiers(e.get('modifier', e.get('functions')), flags, label)
    c2 = apply_modifiers(pool_mods, flags, label)
    count = c2 or c1
    mn = mx = 1
    if count is not None:
        if count[0] == 'b':
            flags['bin'] = [count[1], count[2]]
        else:
            mn, mx = count[1], count[2]
    if not flags and mn == 1 and mx == 1:
        return [item, weight]
    out = [item, weight, mn, mx]
    if flags:
        out.append(flags)
    return out


def build_table(doc, name):
    for k in doc:
        if k not in ('type', 'pools', 'random_sequence'):
            raise SystemExit('%s: table key %r not handled' % (name, k))
    pools = []
    for i, p in enumerate(doc['pools']):
        label = '%s pool %d' % (name, i)
        for k in p:
            if k not in ('rolls', 'entries', 'condition', 'modifier', 'functions', 'bonus_rolls'):
                raise SystemExit('%s: pool key %r not handled' % (label, k))
        if 'bonus_rolls' in p and p['bonus_rolls'] not in (0, 0.0):
            raise SystemExit('%s: bonus_rolls are not handled' % label)
        out = {}
        r = provider(p['rolls'], label)
        if r[0] == 'b':
            out['bin'] = [r[1], r[2]]
        else:
            out['rolls'] = [r[1], r[2]]
        if 'condition' in p:
            f = {}
            condition_flags(p['condition'], f, label)
            if list(f) != ['chance']:
                raise SystemExit('%s: pool condition %r not handled' % (label, p['condition']))
            out['chance'] = f['chance']
        out['entries'] = [build_entry(e, p.get('modifier', p.get('functions')), '%s entry %d' % (label, j))
                          for j, e in enumerate(p['entries'])]
        pools.append(out)
    return pools


def read_dir(root):
    docs = {}
    for sub in ('chests', 'dispensers', 'archaeology'):
        base = os.path.join(root, sub)
        if not os.path.isdir(base):
            continue
        for dp, _, fs in os.walk(base):
            for f in fs:
                if not f.endswith('.json'):
                    continue
                rel = os.path.relpath(os.path.join(dp, f), root).replace('\\', '/')[:-5]
                docs[rel] = json.load(open(os.path.join(dp, f), encoding='utf-8'))
    return docs


def read_jar(path):
    z = zipfile.ZipFile(path)
    inner = [n for n in z.namelist() if n.startswith('META-INF/versions/') and n.endswith('.jar')]
    if inner:
        z = zipfile.ZipFile(io.BytesIO(z.read(inner[0])))
    docs = {}
    for nm in z.namelist():
        m = re.match(r'data/minecraft/loot_table/((?:chests|dispensers|archaeology)/.+)\.json$', nm)
        if m:
            docs[m.group(1)] = json.loads(z.read(nm).decode('utf-8'))
    return docs


def kept_tables():
    """The tables lootdata.js holds now (one per line), as their JSON."""
    out = {}
    if not os.path.exists(OUT):
        return out
    for line in open(OUT, encoding='utf-8'):
        m = re.match(r'^("(?:[^"\\]|\\.)*"):(\[.*\]),?$', line.rstrip('\n'))
        if m:
            out[json.loads(m.group(1))] = json.loads(m.group(2))
    return out


def main():
    args = sys.argv[1:]
    only = None
    if '--only' in args:
        i = args.index('--only')
        only = args[i + 1].split(',')
        del args[i:i + 2]
    if len(args) == 2 and args[0] == '--jar':
        docs = read_jar(args[1])
    elif len(args) == 1:
        docs = read_dir(args[0])
    else:
        raise SystemExit(__doc__)
    if not docs:
        raise SystemExit('no loot tables found')

    tables = {}
    if only:
        tables = kept_tables()
        docs = {k: v for k, v in docs.items() if k.split('/')[0] in only}
        if not docs:
            raise SystemExit('no tables under %s' % ', '.join(only))
    for rel in sorted(docs):
        name = re.sub(r'^chests/', '', rel)
        tables[name] = build_table(docs[rel], name)

    # every nested table has to exist
    for name, pools in tables.items():
        for p in pools:
            for e in p['entries']:
                if len(e) > 4 and 'table' in e[4] and e[4]['table'] not in tables:
                    raise SystemExit('%s: nested table %s is missing' % (name, e[4]['table']))

    def js(v):
        return json.dumps(v, separators=(',', ':'), ensure_ascii=False)

    lines = []
    for name in sorted(tables):
        lines.append('%s:%s' % (js(name), js(tables[name])))
    head = (
        '/* GENERATED from the game\'s loot table data by tools/leoncraft2/build_loot.py - do not edit by hand.\n'
        '   %d chest, dispenser and archaeology tables of Minecraft 26.3: pools, rolls, weighted entries,\n'
        '   count ranges and the flags that change a stack. See the header of\n'
        '   tools/leoncraft2/build_loot.py for the shape of every field. */\n'
    ) % len(tables)
    body = 'export const LOOT = {\n' + ',\n'.join(lines) + '\n};\n'
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + body)
    n_entries = sum(len(p['entries']) for t in tables.values() for p in t)
    print('wrote %s: %d tables, %d entries, %d bytes' % (os.path.normpath(OUT), len(tables), n_entries, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
