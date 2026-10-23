"""Leoncraft 2's paintings: famous paintings out of copyright, at the game's own painting sizes.

    python tools/leoncraft2/build_paintings.py resolve <cache dir>   finds each painting's file on Wikimedia Commons
                                                                     (a search, then the first public-domain result
                                                                     big enough) and writes it into data/paintings.json
    python tools/leoncraft2/build_paintings.py build <cache dir>     downloads them (kept in the cache dir), crops each to
                                                                     its frame's shape round its focus, scales it to 64
                                                                     pixels a block, puts a thin wooden frame round it,
                                                                     and packs them all into one sheet

Writes public/leoncraft2/textures/famous_paintings.jpg (the sheet), famous_paintings.json (where each variant is on it,
and the credits: title, painter, year, the Commons page and its licence). Every file is checked on Commons to be in
the public domain (its extmetadata: Copyrighted False or a public domain licence) before it is used.
"""
import io, json, os, sys, time, urllib.parse, urllib.request
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, 'data', 'paintings.json')
OUT = os.path.join(HERE, '..', '..', 'public', 'leoncraft2', 'textures')
API = 'https://commons.wikimedia.org/w/api.php'
UA = 'LeoncraftPaintingBuild/1.0 (https://leonzhao.dev; one-off build of a game texture sheet)'
RES = 64  # pixels a block (the first Leoncraft's: at sixteen a photographed picture is a smudge)


def get(url, binary=False):
    # through curl: some Pythons carry an out of date certificate store, and the system's own is what curl checks with
    import subprocess
    for attempt in range(4):
        r = subprocess.run(['curl', '-sS', '-f', '-L', '--max-time', '90', '-A', UA, url], capture_output=True)
        if r.returncode == 0:
            return r.stdout if binary else json.loads(r.stdout.decode('utf-8'))
        if attempt == 3:  # rate limits and the odd timeout get three more tries
            raise SystemExit('fetch failed: ' + url + ' ' + r.stderr.decode('utf-8', 'replace')[:200])
        time.sleep(2 + attempt * 3)


def api(**params):
    params.setdefault('format', 'json')
    return get(API + '?' + urllib.parse.urlencode(params))


def info(titles, width=None):
    p = dict(action='query', titles='|'.join(titles), prop='imageinfo', iiprop='url|size|extmetadata|mime')
    if width:
        p['iiurlwidth'] = str(width)
    out = {}
    for page in api(**p)['query']['pages'].values():
        ii = (page.get('imageinfo') or [None])[0]
        if ii:
            out[page['title']] = ii
    return out


def is_pd(ii):
    m = ii.get('extmetadata', {})
    val = lambda k: (m.get(k) or {}).get('value', '')
    lic = (val('LicenseShortName') + ' ' + val('License')).lower()
    return val('Copyrighted') == 'False' or 'public domain' in lic or lic.strip().startswith('pd')


def clean(html):
    import re
    return re.sub(r'<[^>]+>', '', html or '').strip()


def resolve(cache):
    data = json.load(open(DATA, encoding='utf-8'))
    for e in data['paintings']:
        if e.get('file'):
            continue
        need = max(e['w'], e['h']) * RES
        res = api(action='query', list='search', srnamespace='6', srsearch=e['q'], srlimit='10')
        titles = [r['title'] for r in res['query']['search']]
        if not titles:
            print('NOTHING FOUND', e['v'], e['q']); continue
        inf = info(titles)
        picked = None
        for t in titles:
            ii = inf.get(t)
            if not ii or ii.get('mime') not in ('image/jpeg', 'image/png', 'image/tiff'):
                continue
            if not is_pd(ii) or min(ii['width'], ii['height']) < need:
                continue
            picked = t; break
        e['file'] = picked
        ii = inf.get(picked) if picked else None
        print(e['v'].ljust(16), (picked or 'NONE')[:110], '' if not ii else '%dx%d' % (ii['width'], ii['height']))
        for t in titles[:4]:
            if t != picked and t in inf:
                print(' ' * 18, 'also:', t[:100], '%dx%d' % (inf[t]['width'], inf[t]['height']), 'PD' if is_pd(inf[t]) else 'not PD')
        time.sleep(0.5)
    json.dump(data, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


def frame(im):
    """the first Leoncraft's frame: dark wood round the edge, a light bevel inside it"""
    W, H = im.size
    b = max(2, round(min(W, H) / 24)); l = max(1, round(b / 4))
    d = ImageDraw.Draw(im)
    D, L = (0x4a, 0x34, 0x19), (0x7b, 0x5c, 0x32)
    d.rectangle([0, 0, W - 1, b - 1], fill=D); d.rectangle([0, H - b, W - 1, H - 1], fill=D)
    d.rectangle([0, 0, b - 1, H - 1], fill=D); d.rectangle([W - b, 0, W - 1, H - 1], fill=D)
    d.rectangle([b - l, b - l, W - b + l - 1, b - 1], fill=L); d.rectangle([b - l, H - b, W - b + l - 1, H - b + l - 1], fill=L)
    d.rectangle([b - l, b - l, b - 1, H - b + l - 1], fill=L); d.rectangle([W - b, b - l, W - b + l - 1, H - b + l - 1], fill=L)
    return im


def crop_to(im, w, h, focus):
    """the largest piece of the shape w:h, centred on focus as near as the edges allow"""
    W, H = im.size
    if W * h > H * w:      # too wide: keep the height
        cw, ch = H * w / h, H
    else:
        cw, ch = W, W * h / w
    fx, fy = focus
    x0 = min(max(0, fx * W - cw / 2), W - cw); y0 = min(max(0, fy * H - ch / 2), H - ch)
    return im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch)))


def pack(items, width):
    """shelves, tallest first: [(key, w, h)] -> {key: (x, y)} and the sheet's height"""
    order = sorted(items, key=lambda t: (-t[2], -t[1], t[0]))
    at, x, y, shelf = {}, 0, 0, 0
    for k, w, h in order:
        if x + w > width:
            x, y, shelf = 0, y + shelf, 0
        at[k] = (x, y); x += w; shelf = max(shelf, h)
    return at, y + shelf


def build(cache):
    data = json.load(open(DATA, encoding='utf-8'))
    os.makedirs(cache, exist_ok=True)
    pics, credits = {}, {}
    for e in data['paintings']:
        if not e.get('file'):
            raise SystemExit('no file for ' + e['v'] + ': run resolve first')
        W, H = e['w'] * RES, e['h'] * RES
        ii = info([e['file']], width=max(1200, 3 * max(W, H)))[e['file']]
        if not is_pd(ii):
            raise SystemExit('not public domain on Commons: ' + e['file'])
        src = os.path.join(cache, e['v'] + os.path.splitext(ii.get('thumburl') or ii['url'])[1].split('?')[0][:5])
        if not os.path.exists(src):
            open(src, 'wb').write(get(ii.get('thumburl') or ii['url'], binary=True))
            time.sleep(0.5)
        im = Image.open(src).convert('RGB')
        im = crop_to(im, e['w'], e['h'], e.get('focus', [0.5, 0.5])).resize((W, H), Image.LANCZOS)
        pics[e['v']] = frame(im)
        m = ii.get('extmetadata', {})
        credits[e['v']] = {
            'title': e['title'], 'artist': e['artist'], 'year': e['year'],
            'source': ii.get('descriptionurl') or ('https://commons.wikimedia.org/wiki/' + urllib.parse.quote(e['file'].replace(' ', '_'))),
            'licence': clean((m.get('LicenseShortName') or {}).get('value', 'Public domain')),
        }
        print(e['v'].ljust(16), W, 'x', H, credits[e['v']]['licence'])
    at, height = pack([(k, im.size[0], im.size[1]) for k, im in pics.items()], 1024)
    sheet = Image.new('RGB', (1024, height), (0, 0, 0))
    for k, (x, y) in at.items():
        sheet.paste(pics[k], (x, y))
    sheet.save(os.path.join(OUT, 'famous_paintings.jpg'), quality=88, subsampling=0, optimize=True)
    out = {'res': RES, 'where': {k: [x, y, pics[k].size[0], pics[k].size[1]] for k, (x, y) in at.items()}, 'credits': credits}
    json.dump(out, open(os.path.join(OUT, 'famous_paintings.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # the titles for the game's own code (a painting's tooltip, the Credits screen), and the credits in full
    js = ["/* Generated by tools/leoncraft2/build_paintings.py from tools/leoncraft2/data/paintings.json: do not edit.",
          "   Each of the game's paintings: [title, painter, year] of the famous painting it shows (all out of copyright;",
          "   textures/PAINTINGS.txt has where each picture came from). */", "export const PAINTING_ART = {"]
    for e in data['paintings']:
        js.append('  %s: %s,' % (e['v'], json.dumps([e['title'], e['artist'], e['year']], ensure_ascii=False)))
    js.append('};')
    with open(os.path.join(HERE, '..', '..', 'public', 'leoncraft2', 'js', 'paintingdata.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(js) + '\n')
    txt = ['The paintings (famous_paintings.jpg)', '',
           "Each of the game's paintings shows a famous painting that is in the public domain. The photographs are",
           'from Wikimedia Commons, where each is marked public domain (a faithful photograph of a two-dimensional work',
           "out of copyright is itself in the public domain); each was cropped to its frame's shape, reduced to 64 pixels",
           'a block and given a thin wooden frame by tools/leoncraft2/build_paintings.py.', '']
    for e in data['paintings']:
        c = credits[e['v']]
        txt.append('%s (%dx%d): %s, %s, %s. %s. %s' % (e['v'], e['w'], e['h'], c['title'], c['artist'], c['year'], c['licence'], c['source']))
    with open(os.path.join(OUT, 'PAINTINGS.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(txt) + '\n')
    print('sheet 1024 x', height, os.path.getsize(os.path.join(OUT, 'famous_paintings.jpg')), 'bytes')


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] not in ('resolve', 'build'):
        raise SystemExit(__doc__)
    (resolve if sys.argv[1] == 'resolve' else build)(sys.argv[2])
