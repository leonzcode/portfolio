"""
Leoncraft 2 - advancements build.

Writes public/leoncraft2/js/adv/advdata.js: every advancement of Minecraft
26.3 (the five tabs, recipes left out), boiled down to what the game needs:
its name and description, icon, frame, parent, whether it is hidden, its
experience reward, its criteria (the trigger and the conditions, with the
"minecraft:" taken off, the entity_properties wrappers unwrapped and every
item, block and entity tag written out as its list) and the requirements,
plus the place it takes in its tab's tree (x is the depth, y the row).

  python tools/leoncraft2/build_advancements.py <client or server jar>

The jar is read in place; nothing from it is copied into the repo except
the facts in the generated module (names and descriptions are the short
labels the game shows). The bundler server jar is understood too (the real
jar sits inside it at META-INF/versions/<v>/server-<v>.jar, without the
language file: then pass a client jar).

The tree layout is a tidy tree (Walker's algorithm, in Buchheim, Juenger
and Leipert's linear-time form): each advancement one column right of its
parent, siblings a row apart, a parent centred on its first and last
child. The order of siblings, top to bottom, is the order the Minecraft
Wiki's advancement table lists them in (DISPLAY_ORDER below), which follows
the game's screen; any not in that list go after the rest, by name.
"""
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'leoncraft2', 'js', 'adv', 'advdata.js')
TABS = ['story', 'nether', 'end', 'adventure', 'husbandry']

# top to bottom on the game's screen, by title, as the wiki's table lists them
DISPLAY_ORDER = {
    'story': ['Minecraft', 'Stone Age', 'Getting an Upgrade', 'Acquire Hardware', 'Suit Up', 'Hot Stuff', "Isn't It Iron Pick?",
              'Not Today, Thank You', 'Ice Bucket Challenge', 'Diamonds!', 'We Need to Go Deeper', 'Cover Me with Diamonds', 'Enchanter',
              'Zombie Doctor', 'Eye Spy', 'The End?'],
    'nether': ['Nether', 'Return to Sender', 'Those Were the Days', 'Hidden in the Depths', 'Subspace Bubble', 'A Terrible Fortress',
               'Who is Cutting Onions?', 'Oh Shiny', 'This Boat Has Legs', 'Uneasy Alliance', 'War Pigs', 'Cover Me in Debris',
               'Spooky Scary Skeleton', 'Into Fire', 'Not Quite "Nine" Lives', 'Feels Like Home', 'Hot Tourist Destinations',
               'Withering Heights', 'Local Brewery', 'Bring Home the Beacon', 'A Furious Cocktail', 'Beaconator', 'How Did We Get Here?'],
    'end': ['The End', 'Free the End', 'The Next Generation', 'Remote Getaway', 'The End... Again...', 'You Need a Mint',
            'The City at the End of the Game', "Sky's the Limit", 'Great View From Up Here'],
    'adventure': ['Adventure', 'Heart Transplanter', 'Voluntary Exile', 'Country Lode, Take Me Home', 'Is It a Bird?', 'Monster Hunter',
                  'The Power of Books', 'What a Deal!', 'Crafting a New Look', 'Sticky Situation', "Ol' Betsy", 'Surge Protector',
                  'Caves & Cliffs', 'Respecting the Remnants', 'Sneak 100', 'Sweet Dreams', 'Hero of the Village', 'Is It a Balloon?',
                  'A Throwaway Joke', 'It Spreads', 'Take Aim', 'Monsters Hunted', 'Postmortal', 'Mob Kabob', 'Hired Help', 'Star Trader',
                  'Smithing with Style', 'Two Birds, One Arrow', "Who's the Pillager Now?", 'Arbalistic', 'Careful Restoration',
                  'Adventuring Time', 'Sound of Music', 'Light as a Rabbit', 'Is It a Plane?', 'Very Very Frightening', 'Sniper Duel',
                  'Bullseye', "Isn't It Scute?", 'Minecraft: Trial(s) Edition', 'Crafters Crafting Crafters', 'Lighten Up',
                  'Who Needs Rockets?', 'Under Lock and Key', 'Revaulting', 'Blowback', 'Over-Overkill'],
    'husbandry': ['Husbandry', 'Stay Hydrated!', 'Bee Our Guest', 'The Parrots and the Bats', "You've Got a Friend in Me",
                  'Whatever Floats Your Goat!', 'Best Friends Forever', 'Glow and Behold!', 'Fishy Business', 'Total Beelocation',
                  'Bukkit Bukkit', 'Uh Oh', 'Smells Interesting', 'A Seedy Place', 'Wax On', 'Two by Two', 'Birthday Song',
                  'A Complete Catalogue', 'The Whole Pack', 'Good as New', 'Shear Brilliance', 'Tactical Fishing', 'The Cutest Predator',
                  'The Healing Power of Friendship!', 'When the Squad Hops into Town', 'With Our Powers Combined!', 'Little Sniffs',
                  'Planting the Past', 'A Balanced Diet', 'Serious Dedication', 'Wax Off'],
}


def open_jar(path):
    z = zipfile.ZipFile(path)
    inner = [n for n in z.namelist() if re.match(r'META-INF/versions/[^/]+/server-[^/]+\.jar$', n)]
    if inner and not any(n.startswith('data/minecraft/advancement/') for n in z.namelist()):
        z = zipfile.ZipFile(io.BytesIO(z.read(inner[0])))
    return z


def ns(s):
    return s[10:] if isinstance(s, str) and s.startswith('minecraft:') else s


class Tags:
    def __init__(self, z):
        self.z = z
        self.cache = {}

    def get(self, kind, name):
        key = kind + '/' + name
        if key in self.cache:
            return self.cache[key]
        out = []
        try:
            values = json.loads(self.z.read('data/minecraft/tags/' + key + '.json'))['values']
        except KeyError:
            values = []
        for v in values:
            if isinstance(v, dict):
                v = v.get('id', '')
            v = ns(v)
            if v.startswith('#'):
                out += self.get(kind, ns(v[1:]))
            else:
                out.append(v)
        self.cache[key] = out
        return out


def clean(o, tags, kind=None):
    """The conditions with minecraft: off, wrappers unwrapped and tags written out."""
    if isinstance(o, list):
        return [clean(v, tags, kind) for v in o]
    if not isinstance(o, dict):
        return ns(o) if isinstance(o, str) else o
    if o.get('type') == 'minecraft:entity_properties' and 'predicate' in o:
        return clean(o['predicate'], tags)
    out = {}
    for k, v in o.items():
        k = ns(k)
        if k in ('items', 'blocks', 'entity_type') and (isinstance(v, str) or (isinstance(v, list) and all(isinstance(x, str) for x in v))):
            tk = {'items': 'item', 'blocks': 'block', 'entity_type': 'entity_type'}[k]
            vals = v if isinstance(v, list) else [v]
            lst = []
            for x in vals:
                x = ns(x)
                lst += tags.get(tk, ns(x[1:])) if x.startswith('#') else [x]
            out[k] = lst
        elif k == 'tags' and isinstance(v, list) and v and isinstance(v[0], dict) and 'id' in v[0]:
            # a damage type's tags: just their names (all expected true in the game's own)
            out[k] = [ns(t['id'].lstrip('#')) for t in v if t.get('expected', True)]
        elif k == 'components' and isinstance(v, dict) and 'minecraft:banner_patterns' in v:
            out['ominous'] = True
        else:
            out[k] = clean(v, tags)
    if out.get('type') and isinstance(out['type'], str):
        out['type'] = ns(out['type'])
    return out


def text(t, lang):
    if isinstance(t, dict):
        if 'translate' in t:
            return lang.get(t['translate'], t['translate'])
        return t.get('text', '')
    return t or ''


# ---- the tidy tree (Buchheim, Juenger, Leipert 2002) ----
class Node:
    def __init__(self, key, parent=None, number=1):
        self.key = key
        self.children = []
        self.parent = parent
        self.number = number            # 1-based place among its siblings
        self.thread = None
        self.ancestor = self
        self.prelim = 0.0
        self.mod = 0.0
        self.change = 0.0
        self.shift = 0.0
        self.depth = 0
        self.y = 0.0

    def left(self):
        return self.thread or (self.children[0] if self.children else None)

    def right(self):
        return self.thread or (self.children[-1] if self.children else None)

    def left_sibling(self):
        if self.parent and self.number > 1:
            return self.parent.children[self.number - 2]
        return None

    def leftmost_sibling(self):
        if self.parent and self.number > 1:
            return self.parent.children[0]
        return None


def first_walk(v, dist=1.0):
    if not v.children:
        w = v.left_sibling()
        v.prelim = w.prelim + dist if w else 0.0
    else:
        default = v.children[0]
        for c in v.children:
            first_walk(c, dist)
            default = apportion(c, default, dist)
        execute_shifts(v)
        mid = (v.children[0].prelim + v.children[-1].prelim) / 2
        w = v.left_sibling()
        if w:
            v.prelim = w.prelim + dist
            v.mod = v.prelim - mid
        else:
            v.prelim = mid


def apportion(v, default, dist):
    w = v.left_sibling()
    if w is None:
        return default
    vir = vor = v
    vil = w
    vol = v.leftmost_sibling()
    sir = sor = v.mod
    sil = vil.mod
    sol = vol.mod
    while vil.right() and vir.left():
        vil = vil.right()
        vir = vir.left()
        vol = vol.left()
        vor = vor.right()
        vor.ancestor = v
        shift = (vil.prelim + sil) - (vir.prelim + sir) + dist
        if shift > 0:
            a = vil.ancestor if vil.ancestor.parent is v.parent else default
            move_subtree(a, v, shift)
            sir += shift
            sor += shift
        sil += vil.mod
        sir += vir.mod
        sol += vol.mod
        sor += vor.mod
    if vil.right() and not vor.right():
        vor.thread = vil.right()
        vor.mod += sil - sor
    elif vir.left() and not vol.left():
        vol.thread = vir.left()
        vol.mod += sir - sol
        default = v
    return default


def move_subtree(wl, wr, shift):
    n = wr.number - wl.number
    wr.change -= shift / n
    wr.shift += shift
    wl.change += shift / n
    wr.prelim += shift
    wr.mod += shift


def execute_shifts(v):
    shift = change = 0.0
    for w in reversed(v.children):
        w.prelim += shift
        w.mod += shift
        change += w.change
        shift += w.shift + change


def second_walk(v, m=0.0, depth=0):
    v.y = v.prelim + m
    v.depth = depth
    for c in v.children:
        second_walk(c, m + v.mod, depth + 1)


def layout(tab, advs):
    order = {t: i for i, t in enumerate(DISPLAY_ORDER.get(tab, []))}
    ids = [a for a in advs if a.startswith(tab + '/')]
    kids = {}
    for a in ids:
        p = advs[a]['parent']
        if p:
            kids.setdefault(p, []).append(a)
    for p in kids:
        kids[p].sort(key=lambda a: (order.get(advs[a]['title'], 10000), a))
    nodes = {}

    def build(key, parent=None, number=1):
        n = Node(key, parent, number)
        nodes[key] = n
        for i, c in enumerate(kids.get(key, [])):
            n.children.append(build(c, n, i + 1))
        return n
    root = build(tab + '/root')
    first_walk(root)
    second_walk(root)
    top = min(n.y for n in nodes.values())
    for k, n in nodes.items():
        advs[k]['x'] = n.depth
        advs[k]['y'] = round(n.y - top, 4)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    z = open_jar(sys.argv[1])
    lang = {}
    try:
        lang = json.loads(z.read('assets/minecraft/lang/en_us.json'))
    except KeyError:
        print('no en_us.json in this jar: pass a client jar for the names')
        sys.exit(1)
    tags = Tags(z)
    advs = {}
    for n in sorted(z.namelist()):
        m = re.match(r'data/minecraft/advancement/((' + '|'.join(TABS) + r')/[^/]+)\.json$', n)
        if not m:
            continue
        j = json.loads(z.read(n))
        d = j.get('display') or {}
        ic = d.get('icon') or {}
        icon = ns(ic.get('id', 'stone'))
        comps = ic.get('components') or {}
        a = {
            'id': m.group(1),
            'parent': ns(j.get('parent')) if j.get('parent') else None,
            'title': text(d.get('title'), lang),
            'desc': text(d.get('description'), lang),
            'icon': icon,
            'frame': d.get('frame', 'task'),
        }
        if 'minecraft:banner_patterns' in comps:
            a['iconKind'] = 'ominous_banner'
        if 'minecraft:pot_decorations' in comps:
            a['iconPot'] = [ns(v) for v in comps['minecraft:pot_decorations']]
        if d.get('hidden'):
            a['hidden'] = 1
        if d.get('show_toast', True) is False:
            a['noToast'] = 1
        if d.get('announce_to_chat', True) is False:
            a['noChat'] = 1
        if d.get('background'):
            a['bg'] = ns(d['background']).split('/')[-1]
        xp = (j.get('rewards') or {}).get('experience')
        if xp:
            a['xp'] = xp
        crit = []
        for cn, c in (j.get('criteria') or {}).items():
            cond = clean(c.get('conditions') or {}, tags)
            crit.append([ns(cn), ns(c['trigger']), cond])
        a['crit'] = crit
        req = j.get('requirements')
        a['req'] = [[ns(x) for x in g] for g in req] if req else [[c[0]] for c in crit]
        advs[a['id']] = a
    for t in TABS:
        layout(t, advs)
    keys = ['id', 'parent', 'title', 'desc', 'icon', 'iconKind', 'iconPot', 'frame', 'hidden', 'noToast', 'noChat', 'bg', 'xp', 'x', 'y', 'crit', 'req']
    lines = []
    for t in TABS:
        # each tab's advancements, root first, then in the tree's order (depth, then row)
        tab = sorted((a for a in advs.values() if a['id'].startswith(t + '/')), key=lambda a: (a['x'], a['y']))
        for a in tab:
            o = {k: a[k] for k in keys if k in a}
            lines.append(json.dumps(o, separators=(',', ':'), ensure_ascii=False))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/* GENERATED from the game\'s advancement data by tools/leoncraft2/build_advancements.py - do not edit by hand.\n')
        f.write('   The %d advancements of Minecraft 26.3 in its five tabs: names, descriptions, icons, frames, parents,\n' % len(lines))
        f.write('   experience, criteria (trigger + conditions, tags written out) and requirements, and each one\'s place in\n')
        f.write('   its tab\'s tree (x the depth, y the row). See the header of the build script for the details. */\n')
        f.write('export const ADVANCEMENTS = [\n' + ',\n'.join(lines) + '\n];\n')
    print('wrote', OUT, len(lines), 'advancements', os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
