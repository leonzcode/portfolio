"""Leonpixel's lobby people: one skin per game, drawn here in code.

Every pixel comes from this script (no Mojang skin, no pack, no download).
Each skin is the 64 x 64 layout with its second layer (hat, jacket, sleeves,
trousers), written to public/leoncraft2/textures/skin/npc/<game>.png.

    python tools/leoncraft2/build_npc_skins.py [out_dir] [--preview sheet.png]
"""
import os
import random
import sys

from PIL import Image

# (u, v, w, h, d) of every box in the 64 x 64 layout
PARTS = {
    'head': (0, 0, 8, 8, 8), 'head2': (32, 0, 8, 8, 8),
    'body': (16, 16, 8, 12, 4), 'body2': (16, 32, 8, 12, 4),
    'rarm': (40, 16, 4, 12, 4), 'rarm2': (40, 32, 4, 12, 4),
    'larm': (32, 48, 4, 12, 4), 'larm2': (48, 48, 4, 12, 4),
    'rleg': (0, 16, 4, 12, 4), 'rleg2': (0, 32, 4, 12, 4),
    'lleg': (16, 48, 4, 12, 4), 'lleg2': (0, 48, 4, 12, 4),
}
SIDES = ['right', 'front', 'left', 'back']
ALL = ['top', 'bottom'] + SIDES
# a little light per face, so the cloth has form before the game lights it
FACE_K = {'top': 1.05, 'bottom': 0.84, 'front': 1.0, 'right': 0.95, 'left': 0.95, 'back': 0.92}


def rect(part, face):
    u, v, w, h, d = PARTS[part]
    return {'top': (u + d, v, w, d), 'bottom': (u + d + w, v, w, d),
            'right': (u, v + d, d, h), 'front': (u + d, v + d, w, h),
            'left': (u + d + w, v + d, d, h), 'back': (u + 2 * d + w, v + d, w, h)}[face]


def hexc(s):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def mul(c, k):
    return tuple(max(0, min(255, int(round(ch * k)))) for ch in c[:3])


def mix(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


class Mat:
    """A colour with three tones and a little grain: hi and lo pixels scattered in a mid tone."""

    def __init__(self, base, hi=1.12, lo=0.86, p_hi=0.14, p_lo=0.16, grain=0.04, shade=True):
        self.base, self.hi, self.lo, self.p_hi, self.p_lo, self.grain, self.shade = base, hi, lo, p_hi, p_lo, grain, shade

    def at(self, rng, face, x, y, fh):
        r = rng.random()
        k = self.hi if r < self.p_hi else (self.lo if r > 1 - self.p_lo else 1.0)
        k *= 1 + rng.uniform(-self.grain, self.grain)
        if self.shade:
            k *= FACE_K[face]
            if face in SIDES and y == fh - 1 and fh > 4:
                k *= 0.93
        return mul(self.base, k)


def M(c, **kw):
    return Mat(hexc(c) if isinstance(c, str) else c, **kw)


def skin_mat(c):
    return M(c, hi=1.04, lo=0.95, p_hi=0.1, p_lo=0.1, grain=0.015)


def hair_mat(c):
    return M(c, hi=1.2, lo=0.78, p_hi=0.2, p_lo=0.22, grain=0.05)


class Skin:
    def __init__(self, seed):
        self.img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
        self.px = self.img.load()
        self.rng = random.Random(seed)

    # ---- pixels by part, face and the face's own x, y ----
    def xy(self, part, face, x, y):
        fx, fy, fw, fh = rect(part, face)
        if not (0 <= x < fw and 0 <= y < fh):
            return None
        return fx + x, fy + y

    def set(self, part, face, x, y, c):
        p = self.xy(part, face, x, y)
        if p is None:
            return
        if c is None:
            self.px[p] = (0, 0, 0, 0)
        elif isinstance(c, Mat):
            self.px[p] = c.at(self.rng, face, x, y, rect(part, face)[3]) + (255,)
        else:
            self.px[p] = tuple(c[:3]) + (255,)

    def get(self, part, face, x, y):
        p = self.xy(part, face, x, y)
        return self.px[p] if p else None

    def paint(self, part, fn, faces=ALL):
        """fn(face, x, y, fw, fh) gives a colour, a Mat, or False to leave the pixel alone"""
        for f in faces:
            _, _, fw, fh = rect(part, f)
            for y in range(fh):
                for x in range(fw):
                    c = fn(f, x, y, fw, fh)
                    if c is not False:
                        self.set(part, f, x, y, c)

    def fill(self, part, mat, faces=ALL, rows=None):
        """the whole box (or side rows y0..y1-1; top and bottom only when rows is None)"""
        if rows is None:
            self.paint(part, lambda f, x, y, fw, fh: mat, faces)
        else:
            y0, y1 = rows
            self.paint(part, lambda f, x, y, fw, fh: mat if y0 <= y < y1 else False, [f for f in faces if f in SIDES])

    def strip(self, part, fn):
        """the four sides as one band round the box: fn(s, y) with s from the right side's back edge round"""
        u, v, w, h, d = PARTS[part]
        off = {'right': 0, 'front': d, 'left': d + w, 'back': 2 * d + w}
        for f in SIDES:
            _, _, fw, fh = rect(part, f)
            for y in range(fh):
                for x in range(fw):
                    c = fn(off[f] + x, y, f, x)
                    if c is not False:
                        self.set(part, f, x, y, c)

    def pattern(self, part, face, x0, y0, rows, cmap):
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch in cmap:
                    self.set(part, face, x0 + i, y0 + j, cmap[ch])

    def scatter(self, part, faces, n, cols, rows=None, avoid=None):
        for _ in range(n):
            f = self.rng.choice(faces)
            _, _, fw, fh = rect(part, f)
            x = self.rng.randrange(fw)
            y = self.rng.randrange(rows[0], rows[1]) if rows else self.rng.randrange(fh)
            if avoid and avoid(f, x, y):
                continue
            self.set(part, f, x, y, self.rng.choice(cols))

    def both(self, side, fn):
        """run fn for the right and the left of a pair (arm or leg)"""
        fn('r' + side)
        fn('l' + side)


# ---------------------------------------------------------------- shared bits
def head_skin(S, tone):
    S.fill('head', skin_mat(tone))


def face(S, tone, iris, brow=None, white=(242, 242, 238), mouth=True, nose=True, blush=None, row=4):
    """eyes (white outside, iris inside), brows, nose shadow and mouth on the head's front"""
    for x, c in ((1, white), (2, iris), (5, iris), (6, white)):
        S.set('head', 'front', x, row, c)
    S.set('head', 'front', 2, row, iris)
    if brow:
        for x in (1, 2, 5, 6):
            S.set('head', 'front', x, row - 1, brow)
    if nose:
        for x in (3, 4):
            S.set('head', 'front', x, row + 1, mul(tone, 0.9))
    if mouth:
        mc = mix(mul(tone, 0.62), (150, 60, 60), 0.35)
        for x in (3, 4):
            S.set('head', 'front', x, row + 2, mc)
        S.set('head', 'front', 2, row + 2, mul(tone, 0.85))
        S.set('head', 'front', 5, row + 2, mul(tone, 0.85))
    if blush:
        S.set('head', 'front', 1, row + 1, blush)
        S.set('head', 'front', 6, row + 1, blush)
    # a shade under the chin all round
    for f in SIDES:
        for x in range(8):
            p = S.get('head', f, x, 7)
            if f != 'front' or x in (0, 7):
                S.set('head', f, x, 7, mul(p, 0.92))


def hair(S, col, front=1, side=3, back=6, fringe=None, part='head'):
    """hair on top, down the sides (longer behind), the back and a fringe"""
    m = hair_mat(hexc(col) if isinstance(col, str) else col)
    S.fill(part, m, ['top'])
    for y in range(back):
        for x in range(8):
            S.set(part, 'back', x, y, m)
    for f in ('right', 'left'):
        for x in range(8):
            # the side's x runs from the back (right side) or from the front (left side)
            behind = (7 - x) if f == 'right' else x
            n = side + (1 if behind < 4 else 0) + (1 if behind < 2 else 0)
            n = min(n, back)
            for y in range(n):
                S.set(part, f, x, y, m)
    fr = fringe or [0] * 8
    for x in range(8):
        for y in range(front + fr[x]):
            S.set(part, 'front', x, y, m)


def arms(S, sleeve, hand, sleeve_rows=10, cuff=None, cuff_rows=None, top=None):
    for a in ('rarm', 'larm'):
        S.fill(a, sleeve, ['top'] if top is None else [])
        if top is not None:
            S.fill(a, top, ['top'])
        S.fill(a, sleeve, rows=(0, sleeve_rows))
        S.fill(a, hand, rows=(sleeve_rows, 12))
        S.fill(a, hand, ['bottom'])
        if cuff:
            S.fill(a, cuff, rows=cuff_rows)


def legs(S, trousers, shoes, shoe_rows=2, sole=None):
    for l in ('rleg', 'lleg'):
        S.fill(l, trousers, ['top'])
        S.fill(l, trousers, rows=(0, 12 - shoe_rows))
        S.fill(l, shoes, rows=(12 - shoe_rows, 12))
        S.fill(l, sole or shoes, ['bottom'])


def body(S, mat):
    S.fill('body', mat)


# ---------------------------------------------------------------- the people
def bedwars(S):
    """a red team's fighter in red leather, a bed on the badge"""
    tone = hexc('e2aa82')
    red, red_d, leather = M('b8322a'), M('8f241f'), M('7a4a2a')
    head_skin(S, tone)
    hair(S, '4a2e1c', front=1, side=3, back=5, fringe=[1, 1, 0, 0, 0, 0, 1, 1])
    face(S, tone, hexc('3f7a3a'), brow=hexc('3a2416'))
    # red leather cap over the hair, a stitched rim
    cap, rim = M('b8322a', hi=1.15, lo=0.82), M('7d1f1a', p_hi=0.05, p_lo=0.05)
    S.fill('head2', cap, ['top'])
    S.paint('head2', lambda f, x, y, fw, fh: cap if y < 2 else (rim if y == 2 else False), ['right', 'left', 'back'])
    S.paint('head2', lambda f, x, y, fw, fh: cap if y == 0 else (rim if y == 1 else False), ['front'])
    for x in (0, 2, 4, 6):
        for f in ('right', 'left', 'back'):
            S.set('head2', f, x, 2, hexc('d8a070'))
    # tunic
    body(S, red)
    S.pattern('body', 'front', 0, 0, ["dd.ss.dd", "..d..d.."], {'d': red_d, 's': skin_mat(tone)})
    S.pattern('body', 'front', 0, 3, [
        ".cccccc.",
        "cbcccccc",
        "cbwrrrrc",
        "cbbbbbbc",
        "cbccccbc",
        ".cccccc.",
    ], {'c': M('ece2c8', p_hi=0.05, p_lo=0.1), 'b': hexc('6e4426'), 'w': hexc('fbfbfb'), 'r': hexc('d23a30')})
    S.fill('body', leather, rows=(10, 11))
    S.set('body', 'front', 3, 10, hexc('e6c050'))
    S.set('body', 'front', 4, 10, hexc('e6c050'))
    S.fill('body', red_d, rows=(11, 12))
    # a strap across the back
    for y in range(9):
        S.set('body', 'back', 7 - int(y * 7 / 8), y, leather)
    arms(S, red, skin_mat(tone), sleeve_rows=10, cuff=leather, cuff_rows=(7, 9))
    legs(S, M('8a2420'), M('5e3a22'), shoe_rows=3, sole=M('3a2414'))
    for l in ('rleg', 'lleg'):
        S.fill(l, M('7a4a2a'), rows=(9, 10))


def skywars(S):
    """a sky pilot: sky blue suit, goggles up on the cap, wings and clouds"""
    tone = hexc('f0c8aa')
    blue, white = M('5fb4ea'), M('f6f8fb', hi=1.0, lo=0.94, p_hi=0, p_lo=0.25)
    head_skin(S, tone)
    hair(S, 'e4c06a', front=1, side=3, back=6, fringe=[2, 1, 1, 0, 1, 1, 2, 2])
    face(S, tone, hexc('3a7fd0'), brow=hexc('b08a40'))
    # leather flying cap, ear flaps, goggles on the forehead
    cap = M('7a4e2c', hi=1.15, lo=0.85)
    S.fill('head2', cap, ['top'])
    S.paint('head2', lambda f, x, y, fw, fh: cap if (y < 4 or (y < 7 and 2 <= x <= 5)) else False, ['right', 'left'])
    S.paint('head2', lambda f, x, y, fw, fh: cap if y < 5 else False, ['back'])
    S.paint('head2', lambda f, x, y, fw, fh: cap if y < 2 else False, ['front'])
    band = hexc('34343a')
    for f in ('right', 'left', 'back'):
        for x in range(8):
            S.set('head2', f, x, 2, band)
    S.pattern('head2', 'front', 0, 2, ["mlhmmlhm", "mllmmllm"],
              {'m': hexc('a8aab4'), 'l': hexc('f0a832'), 'h': hexc('fff0c0')})
    # flight suit with a white scarf
    body(S, blue)
    S.fill('body', white, rows=(0, 1))
    S.pattern('body', 'front', 0, 3, ["ww....ww", ".wwggww.", "..w..w.."],
              {'w': white, 'g': hexc('e8c34a')})
    S.fill('body', M('6a4a30'), rows=(7, 8))
    S.set('body', 'front', 3, 7, hexc('c8ccd4'))
    S.set('body', 'front', 4, 7, hexc('c8ccd4'))
    cloud = ["...www......www....wwww",
             ".wwwwww...wwwwww.wwwwwww",
             "wwwwwwww.wwwwwwwwwwwwwww"]

    def clouds(s, y, f, x):
        j = y - 9
        if 0 <= j < 3:
            row = cloud[j]
            return white if row[s % len(row)] == 'w' else False
        return False
    S.strip('body', clouds)
    # scarf tail and feathered wings on the back
    S.fill('body2', white, rows=(0, 1))
    S.pattern('body2', 'back', 0, 1, [
        "w......w",
        "ww....ww",
        "wfw..wfw",
        ".wfw.wf.",
        "..ww.w..",
    ], {'w': white, 'f': hexc('cfd8e4')})
    S.pattern('body2', 'back', 3, 1, ["s", "s", "s"], {'s': M('e9edf2')})
    arms(S, blue, M('7a4e2c'), sleeve_rows=9)
    S.both('arm', lambda a: S.fill(a, white, rows=(3, 4)))
    legs(S, M('4a96d0'), M('f2f2f2', hi=1.0, lo=0.9), shoe_rows=2, sole=M('8a8a90'))
    S.both('leg', lambda l: S.fill(l, white, rows=(9, 10)))


def duels(S):
    """a duelling knight in iron, an open helm with a red plume, a red sash"""
    tone = hexc('966446')
    iron = M('b2b5bc', hi=1.18, lo=0.78, p_hi=0.18, p_lo=0.18)
    chain = M('8c8f98', hi=1.25, lo=0.7, p_hi=0.3, p_lo=0.3)
    red = M('c22a26', hi=1.15, lo=0.82)
    head_skin(S, tone)
    hair(S, '1c1a1a', front=1, side=3, back=6)
    face(S, tone, hexc('5a3820'), brow=hexc('1c1a1a'))
    # helm: open face, nose guard, cheek guards, rivets
    S.fill('head2', iron, ['top', 'right', 'left', 'back'])
    S.paint('head2', lambda f, x, y, fw, fh: iron if (y < 3 or (x in (3, 4) and y < 6) or x in (0, 7)) else False, ['front'])
    for x in (1, 6):
        S.set('head2', 'front', x, 2, hexc('5a5c62'))
    for x in range(8):
        S.set('head2', 'front', x, 0, hexc('d8dbe2'))
    for y in range(8):
        for x in (3, 4):
            S.set('head2', 'top', x, y, red)
    for y in range(4):
        for x in (3, 4):
            S.set('head2', 'back', x, y, red)
    # breastplate over mail, the sash from the right shoulder to the left hip
    body(S, chain)
    S.fill('body', iron, ['front', 'top'])
    for y in range(12):
        S.set('body', 'front', 3, y, hexc('d6d9e0'))
        S.set('body', 'front', 4, y, M('c4c7ce'))
    S.fill('body', M('5c3a22'), rows=(10, 11))
    S.set('body', 'front', 3, 10, hexc('d8b84a'))
    S.set('body', 'front', 4, 10, hexc('d8b84a'))
    for y in range(12):
        x = round(y * 7 / 11)
        for dx in (0, 1):
            if 0 <= x + dx < 8:
                S.set('body2', 'front', x + dx, y, red)
                S.set('body2', 'back', 7 - x - dx, y, red)
    for x in range(2):
        for y in range(4):
            S.set('body2', 'top', x, y, red)
    S.set('body2', 'front', 1, 1, hexc('e2c45a'))
    # arms: pauldrons, mail, gauntlets
    arms(S, chain, M('80838c'), sleeve_rows=9)
    S.both('arm', lambda a: (S.fill(a, iron, rows=(0, 3)), S.fill(a, iron, ['top'])))
    S.both('arm', lambda a: S.fill(a, M('6a6d76'), rows=(3, 4)))
    legs(S, M('5a5c66'), M('7c7f88'), shoe_rows=2, sole=M('3e3f44'))
    S.both('leg', lambda l: S.fill(l, iron, rows=(5, 10)))
    S.both('leg', lambda l: S.fill(l, M('dcdfe6', p_hi=0, p_lo=0.2), rows=(6, 7)))


def tntrun(S):
    """a TNT runner: red sticks, a white band reading T N T across the arms and chest, scorch"""
    tone = hexc('e2ae86')
    red = M('d23a26', hi=1.1, lo=0.88)
    groove = M('962618', p_hi=0.05, p_lo=0.1)
    band = M('ececea', hi=1.02, lo=0.92, p_hi=0.05, p_lo=0.2)
    ink = hexc('1e1e22')
    head_skin(S, tone)
    hair(S, '22201e', front=1, side=3, back=6, fringe=[2, 1, 2, 1, 0, 2, 1, 2])
    face(S, tone, hexc('4a3220'), brow=hexc('22201e'))
    S.set('head', 'front', 6, 6, hexc('6a5a50'))
    S.set('head', 'front', 0, 2, hexc('7a6a5e'))
    # spiky hair sticking out of the second layer, one fuse with a spark on top
    for x in range(0, 8, 2):
        S.set('head2', 'front', x, 0, hair_mat(hexc('22201e')))
    S.set('head2', 'top', 4, 3, hexc('3a3a3a'))
    S.set('head2', 'top', 4, 2, hexc('ffd040'))
    S.set('head2', 'top', 5, 2, hexc('ff7a20'))

    def sticks(part):
        def fn(s, y, f, x):
            if 4 <= y <= 7:
                return band
            return groove if s % 3 == 2 else red
        S.strip(part, fn)
        S.fill(part, M('b8a07a', hi=1.1, lo=0.85), ['top'])
        S.fill(part, groove, ['bottom'])
    sticks('body')
    S.fill('body', M('2c2c30'), rows=(11, 12))
    S.pattern('body', 'front', 2, 4, ["#..#", "##.#", "#.##", "#..#"], {'#': ink})
    for a in ('rarm', 'larm'):
        sticks(a)
        S.fill(a, skin_mat(tone), rows=(10, 12))
        S.fill(a, skin_mat(tone), ['bottom'])
    S.pattern('rarm', 'front', 1, 4, ["###", ".#.", ".#.", ".#."], {'#': ink})
    S.pattern('larm', 'front', 0, 4, ["###", ".#.", ".#.", ".#."], {'#': ink})
    # red and white hoops on the legs, black shoes
    for l in ('rleg', 'lleg'):
        S.strip(l, lambda s, y, f, x: (red if (y // 2) % 2 == 0 else band) if y < 10 else M('2a2a2e'))
        S.fill(l, red, ['top'])
        S.fill(l, M('5a5a5e'), ['bottom'])
    # scorch marks
    soot = [hexc('3a302c'), hexc('4e403a'), hexc('2a2422')]
    S.scatter('body', ['back', 'right', 'left'], 10, soot, rows=(0, 11))
    S.scatter('body', ['front'], 3, soot, rows=(9, 11))
    S.scatter('rleg', SIDES, 4, soot, rows=(0, 10))
    S.scatter('lleg', SIDES, 4, soot, rows=(0, 10))
    S.scatter('rarm', ['right', 'back'], 2, soot, rows=(0, 4))
    S.scatter('larm', ['left', 'back'], 2, soot, rows=(8, 10))


def murder(S):
    """a detective in a trench coat and fedora, a magnifying glass in the breast pocket"""
    tone = hexc('ecc0a0')
    coat, coat_d = M('b08a58', hi=1.1, lo=0.86), M('8a6a40')
    shirt, tie = M('f0eee6', hi=1.0, lo=0.94, p_hi=0, p_lo=0.2), hexc('7a1e2a')
    head_skin(S, tone)
    hair(S, '7a3c22', front=1, side=3, back=6)
    face(S, tone, hexc('5a7890'), brow=hexc('6a3018'), mouth=False)
    for x in range(2, 6):
        S.set('head', 'front', x, 6, hair_mat(hexc('7a3c22')))
    # fedora: crown with a crease, a black band, a brim
    felt, band, brim = M('5a4030', hi=1.15, lo=0.85), M('1e1a18', p_hi=0.05, p_lo=0.05), M('4a3426')
    S.fill('head2', felt, ['top'])
    for y in range(1, 7):
        S.set('head2', 'top', 3, y, hexc('3e2c20'))
        S.set('head2', 'top', 4, y, hexc('3e2c20'))
    S.paint('head2', lambda f, x, y, fw, fh: felt if y < 2 else (band if y == 2 else (brim if y == 3 else False)), SIDES)
    S.set('head2', 'right', 5, 2, hexc('8a2a2a'))
    # trench coat, double breasted, belted
    body(S, coat)
    S.pattern('body', 'front', 0, 0, [
        "LLsttsLL",
        "cLLttLLc",
        "ccLtLLcc",
    ], {'L': coat_d, 's': shirt, 't': tie, 'c': coat})
    for x, y in ((2, 4), (5, 4), (2, 6), (5, 6)):
        S.set('body', 'front', x, y, hexc('3e2c1e'))
    S.fill('body', coat_d, rows=(8, 9))
    S.set('body', 'front', 3, 8, hexc('c8b070'))
    for y in range(9, 12):
        S.set('body', 'front', 3, y, coat_d)
    # magnifying glass: brass ring, a lens catching the light, a handle
    S.pattern('body', 'front', 5, 1, ["rrr", "rbr", "rrr"],
              {'r': hexc('c8a040'), 'b': hexc('bfe6ff')})
    S.set('body', 'front', 4, 4, hexc('4a2c18'))
    S.set('body', 'front', 6, 2, hexc('bfe6ff'))
    S.set('body', 'front', 5, 2, hexc('ffffff'))
    # a turned up collar on the second layer
    S.paint('body2', lambda f, x, y, fw, fh: coat_d if y == 0 else False, ['right', 'left', 'back'])
    S.pattern('body2', 'front', 0, 0, ["L......L"], {'L': coat_d})
    arms(S, coat, skin_mat(tone), sleeve_rows=10, cuff=coat_d, cuff_rows=(8, 9))
    legs(S, M('3c3c46'), M('2a201a'), shoe_rows=2, sole=M('1a1410'))
    # the coat's skirt over the thighs, open in the middle
    for l in ('rleg', 'lleg'):
        S.fill(l, coat, rows=(0, 5))
        S.fill(l, coat_d, rows=(5, 6))
    for y in range(6):
        S.set('rleg', 'front', 3, y, coat_d)
        S.set('lleg', 'front', 0, y, coat_d)


def prophunt(S):
    """someone hiding inside a hay bale costume, eyes peeking out of the slot"""
    tone = hexc('be8764')
    straw = M('d4a832', hi=1.16, lo=0.8, p_hi=0.22, p_lo=0.22, grain=0.06)
    tie = M('8e3a22', hi=1.1, lo=0.85)
    dark = hexc('2a2014')

    def bale(part, ties):
        # straw runs up and down in streaks, two red-brown ties round it
        streak = {}

        def fn(s, y, f, x):
            if y in ties:
                return tie
            k = streak.setdefault(s, S.rng.choice([1.0, 1.0, 1.12, 0.86]))
            c = straw.at(S.rng, f, x, y, 12)
            return mul(c, k)
        S.strip(part, fn)
        S.paint(part, lambda f, x, y, fw, fh: straw if ((x + y) % 3) else M('a88028'), ['top', 'bottom'])
    bale('head', (1, 6))
    S.pattern('head', 'front', 1, 3, [
        "dddddd",
        "WIddIW",
        "dddddd",
    ], {'d': dark, 'W': hexc('f2f2ee'), 'I': hexc('3a6a2a')})
    # the top of a bale: a spiral
    for x, y in ((2, 2), (3, 2), (4, 2), (5, 3), (5, 4), (4, 5), (3, 5), (2, 4), (3, 3), (4, 4)):
        S.set('head', 'top', x, y, hexc('a07a20'))
    bale('body', (2, 9))
    # loose straws poking out of the second layer
    gold = [hexc('e8c050'), hexc('c8981e'), hexc('f0d070')]
    S.scatter('head2', SIDES, 18, gold, avoid=lambda f, x, y: f == 'front' and 2 <= y <= 6)
    S.scatter('head2', ['top'], 6, gold)
    S.scatter('body2', SIDES, 16, gold, avoid=lambda f, x, y: f == 'front' and 3 <= y <= 8)
    # the person inside: dark sleeves and tights, gloves, boots
    arms(S, M('3a3a44'), M('5a3e2a'), sleeve_rows=9)
    legs(S, M('34343c'), M('6a4228'), shoe_rows=3, sole=M('3a2414'))
    S.both('leg', lambda l: S.fill(l, M('7a4e30'), rows=(9, 10)))


def chameleon(S):
    """a chameleon: green scales with patches of other colours coming through, turret eyes, a curled tail"""
    green, green_d = M('5ab43c', hi=1.1, lo=0.88, p_hi=0.1, p_lo=0.12), M('3c8a2a')
    belly = M('c8dc64', hi=1.08, lo=0.9)
    spots = [hexc('2aa89c'), hexc('e8d040'), hexc('ec8a2c'), hexc('c84aa0'), hexc('4a74d4')]
    S.fill('head', green)
    # scale bands on the sides
    for f in ('right', 'left', 'back'):
        for x in range(8):
            if (x + 1) % 3 == 0:
                for y in range(0, 7):
                    if (y + x) % 2 == 0:
                        S.set('head', f, x, y, green_d)
    # turret eyes looking two ways, a long smile
    ring = hexc('e0b830')
    S.pattern('head', 'front', 0, 2, ["rrr..rrr", "rpr..rrp", "rrr..rrr"], {'r': ring, 'p': hexc('101010')})
    S.set('head', 'front', 1, 2, hexc('f0d870'))
    S.set('head', 'front', 6, 2, hexc('f0d870'))
    S.pattern('head', 'front', 0, 5, ["m......m", ".mmmmmm."], {'m': hexc('2a5a1e')})
    S.set('head', 'front', 3, 6, hexc('d86a7a'))
    S.pattern('head', 'front', 2, 7, ["bbbb"], {'b': belly})
    # a casque: a ridge over the top and down the back
    for y in range(8):
        S.set('head2', 'top', 3, y, green_d)
        S.set('head2', 'top', 4, y, M('6cc84a'))
    for y in range(3):
        S.set('head2', 'back', 3, y, green_d)
        S.set('head2', 'back', 4, y, green_d)
    S.set('head2', 'front', 3, 0, green_d)
    S.set('head2', 'front', 4, 0, green_d)
    # body: green with a pale belly and diagonal stripes, colour patches
    body(S, green)
    for y in range(12):
        for x in range(2, 6):
            S.set('body', 'front', x, y, belly)
    for f in ('right', 'left'):
        for y in range(12):
            for x in range(4):
                if (x + y) % 4 == 0:
                    S.set('body', f, x, y, green_d)

    def blob(part, f, x, y, c):
        for dx, dy in ((0, 0), (1, 0), (0, 1)):
            S.set(part, f, x + dx, y + dy, c)
    for part, f, x, y, i in (('body', 'right', 1, 2, 0), ('body', 'left', 1, 7, 2), ('body', 'back', 1, 1, 3),
                             ('body', 'back', 5, 4, 1), ('body', 'front', 0, 8, 4), ('body', 'front', 6, 2, 0),
                             ('head', 'right', 2, 4, 1), ('head', 'left', 4, 3, 3), ('head', 'back', 5, 5, 4),
                             ('head', 'back', 1, 3, 2)):
        blob(part, f, x, y, spots[i])
    # the curled tail on the back
    S.pattern('body2', 'back', 1, 5, [
        ".dddd.",
        "d....d",
        "d.dd.d",
        "d.d..d",
        "d..dd.",
        ".d....",
        "..d...",
    ], {'d': hexc('24601a')})
    # arms and legs with bands, two toed hands and feet
    for part in ('rarm', 'larm', 'rleg', 'lleg'):
        S.fill(part, green)
        S.strip(part, lambda s, y, f, x: green_d if y % 4 == 3 else False)
        S.fill(part, M('8ac850'), rows=(10, 12))
        S.set(part, 'front', 1, 11, hexc('2a5a1e'))
        S.set(part, 'front', 2, 11, hexc('2a5a1e'))
        S.fill(part, M('8ac850'), ['bottom'])
    blob('rarm', 'right', 1, 2, spots[2])
    blob('larm', 'left', 1, 5, spots[0])
    blob('rleg', 'front', 0, 3, spots[3])
    blob('lleg', 'back', 1, 6, spots[1])
    blob('lleg', 'left', 2, 2, spots[4])


def pillars(S):
    """a fortune king: a bedrock robe, gold trim, a gold crown with gems, a coin on a chain"""
    tone = hexc('6a4430')
    rock = [hexc('565656'), hexc('3a3a3a'), hexc('767676'), hexc('2a2a2a'), hexc('4a4a4a'), hexc('8a8a8a')]
    gold, gold_d = M('e8b828', hi=1.15, lo=0.82, p_hi=0.25), M('b0841c')

    def bedrock(part, faces=ALL, rows=None):
        def fn(f, x, y, fw, fh):
            if rows and f in SIDES and not (rows[0] <= y < rows[1]):
                return False
            if rows and f not in SIDES:
                return False
            w = [5, 6, 3, 2, 5, 1]
            return mul(S.rng.choices(rock, w)[0], FACE_K[f])
        S.paint(part, fn, faces)
    head_skin(S, tone)
    hair(S, '161412', front=1, side=3, back=6)
    face(S, tone, hexc('c88a20'), brow=hexc('161412'))
    for x in range(2, 6):
        S.set('head', 'front', x, 7, hexc('1e1a18'))
    # the crown: a gold band with points, a ruby and two sapphires
    S.paint('head2', lambda f, x, y, fw, fh: gold if (y in (1, 2) or (y == 0 and x % 2 == 0)) else False, SIDES)
    S.paint('head2', lambda f, x, y, fw, fh: gold_d if y == 2 else False, SIDES)
    S.set('head2', 'front', 3, 1, hexc('d02040'))
    S.set('head2', 'front', 4, 1, hexc('e83a5a'))
    S.set('head2', 'front', 1, 1, hexc('3060d8'))
    S.set('head2', 'front', 6, 1, hexc('3060d8'))
    for f in ('right', 'left', 'back'):
        S.set('head2', f, 3, 1, hexc('2a9a5a'))
    # robe of bedrock with gold edges
    bedrock('body')
    S.fill('body', gold, ['top'], rows=None)
    S.fill('body', gold, rows=(0, 1))
    for y in range(12):
        S.set('body', 'front', 3, y, gold)
        S.set('body', 'front', 4, y, gold_d)
    S.pattern('body', 'front', 1, 1, ["c....c", ".c..c.", "..oo..", "..oO.."],
              {'c': gold_d, 'o': gold, 'O': hexc('fff0a0')})
    S.fill('body', gold_d, rows=(8, 9))
    S.set('body', 'front', 3, 8, hexc('fff0a0'))
    # a gold star on the back
    S.pattern('body', 'back', 2, 3, ["..g.", "gggg", ".gg.", "g..g"], {'g': gold})
    # sleeves, cuffs, a ring
    for a in ('rarm', 'larm'):
        bedrock(a, ['top'])
        bedrock(a, SIDES, rows=(0, 9))
        S.fill(a, gold, rows=(8, 9))
        S.fill(a, skin_mat(tone), rows=(9, 12))
        S.fill(a, skin_mat(tone), ['bottom'])
    S.set('rarm', 'front', 1, 10, hexc('f0c840'))
    # the robe to the shins, a gold hem, dark boots with gold toes
    for l in ('rleg', 'lleg'):
        bedrock(l, ['top'])
        bedrock(l, SIDES, rows=(0, 8))
        S.fill(l, gold, rows=(8, 9))
        S.fill(l, M('24201e'), rows=(9, 12))
        S.fill(l, M('181412'), ['bottom'])
        for x in range(4):
            S.set(l, 'front', x, 11, gold_d)


def deathswap(S):
    """split down the middle: ender purple on the right, blaze orange on the left, swapped at the legs"""
    tone = hexc('d8a47e')
    purple, orange = M('6e32a0', hi=1.18, lo=0.82), M('e4741e', hi=1.12, lo=0.85)
    hp, ho = hair_mat(hexc('5a2486')), hair_mat(hexc('f08a20'))
    speck_p, speck_o = [hexc('d070f0'), hexc('40d0b8')], [hexc('ffd040'), hexc('b83a10')]

    def side_of(f, x, w):
        """'r' for the character's right half of a face, 'l' for the left"""
        if f == 'right':
            return 'r'
        if f == 'left':
            return 'l'
        if f in ('front', 'top', 'bottom'):
            return 'r' if x < w // 2 else 'l'
        return 'l' if x < w // 2 else 'r'
    head_skin(S, tone)
    hair(S, (0, 0, 0), front=1, side=3, back=6, fringe=[1, 1, 0, 0, 0, 0, 1, 2])
    # repaint the hair half and half
    for f in ALL:
        _, _, fw, fh = rect('head', f)
        for y in range(fh):
            for x in range(fw):
                if S.get('head', f, x, y)[:3] == (0, 0, 0) or (S.get('head', f, x, y)[0] < 2 and S.get('head', f, x, y)[1] < 2):
                    S.set('head', f, x, y, hp if side_of(f, x, fw) == 'r' else ho)
    face(S, tone, hexc('30c8b0'), brow=hexc('5a2486'))
    S.set('head', 'front', 5, 4, hexc('f8c020'))
    S.set('head', 'front', 5, 3, hexc('c86410'))
    S.set('head', 'front', 6, 3, hexc('c86410'))

    def split(part, swap=False):
        def fn(f, x, y, fw, fh):
            s = side_of(f, x, fw)
            if swap:
                s = 'l' if s == 'r' else 'r'
            return purple if s == 'r' else orange
        S.paint(part, fn)
        for f in ALL:
            _, _, fw, fh = rect(part, f)
            for _ in range(3 if f in SIDES else 1):
                x, y = S.rng.randrange(fw), S.rng.randrange(fh)
                s = side_of(f, x, fw)
                if swap:
                    s = 'l' if s == 'r' else 'r'
                S.set(part, f, x, y, S.rng.choice(speck_p if s == 'r' else speck_o))
    split('body')
    # two arrows round each other, each in the other half's colour
    arrows = [".#......", "#######.", ".#......", "........", "......#.", ".#######", "......#."]
    for j, row in enumerate(arrows):
        for i, ch in enumerate(row):
            if ch == '#':
                S.set('body', 'front', i, 3 + j, hexc('f8a040') if i < 4 else hexc('9a50d8'))
    S.fill('body', M('2a2030'), rows=(10, 11))
    S.set('body', 'front', 3, 10, hexc('40d0b8'))
    S.set('body', 'front', 4, 10, hexc('ffd040'))
    S.fill('rarm', purple)
    S.fill('larm', orange)
    for a in ('rarm', 'larm'):
        S.fill(a, skin_mat(tone), rows=(10, 12))
        S.fill(a, skin_mat(tone), ['bottom'])
        S.scatter(a, SIDES, 3, speck_p if a == 'rarm' else speck_o, rows=(0, 10))
    S.fill('rleg', orange)
    S.fill('lleg', purple)
    for l in ('rleg', 'lleg'):
        S.fill(l, M('2a2030'), rows=(10, 12))
        S.fill(l, M('1a141e'), ['bottom'])
        S.scatter(l, SIDES, 3, speck_o if l == 'rleg' else speck_p, rows=(0, 10))
    # an ender pearl and an ember on the sleeves' second layer
    S.pattern('rarm2', 'right', 1, 2, ["tt", "tT"], {'t': hexc('1e7a6a'), 'T': hexc('50e0c8')})
    S.pattern('larm2', 'left', 1, 2, ["ff", "fF"], {'f': hexc('d04a10'), 'F': hexc('ffd040')})


def bridger(S):
    """a speed bridger: a sandstone shirt, a white and red headband, shorts and trainers"""
    tone = hexc('af7854')
    sand_lt, sand, sand_d = M('e8d8a8', hi=1.04, lo=0.95), M('d8c290', hi=1.06, lo=0.92), M('bca46c')
    head_skin(S, tone)
    hair(S, '2e2018', front=1, side=2, back=5, fringe=[1, 0, 1, 1, 0, 1, 0, 1])
    face(S, tone, hexc('4a3020'), brow=hexc('2e2018'))
    # headband on the second layer, its two tails behind
    S.paint('head2', lambda f, x, y, fw, fh: hexc('f2f2f2') if y == 2 else (M('d02a2a') if y == 3 else False), SIDES)
    S.set('head2', 'back', 5, 4, hexc('d02a2a'))
    S.set('head2', 'back', 6, 5, hexc('f2f2f2'))
    S.set('head2', 'back', 5, 5, hexc('d02a2a'))
    S.set('head2', 'back', 6, 6, hexc('d02a2a'))
    # a shirt layered like sandstone: smooth top band, layers, a darker foot

    def layers(s, y, f, x):
        if y < 2:
            return sand_lt
        if y >= 10:
            return sand_d
        return sand_d if y in (4, 7) else sand
    S.strip('body', layers)
    S.fill('body', sand_lt, ['top'])
    S.fill('body', sand_d, ['bottom'])
    S.pattern('body', 'front', 1, 4, ["r..r..", ".r..r.", "r..r.."], {'r': hexc('d02a2a')})
    S.set('body', 'front', 3, 0, skin_mat(tone))
    S.set('body', 'front', 4, 0, skin_mat(tone))
    # short sleeves, red wristbands
    arms(S, sand, skin_mat(tone), sleeve_rows=4, top=sand_lt)
    S.both('arm', lambda a: S.fill(a, sand_d, rows=(3, 4)))
    S.both('arm', lambda a: S.fill(a, M('d02a2a'), rows=(8, 9)))
    # black shorts with a white stripe on the outside, socks, red trainers
    for l in ('rleg', 'lleg'):
        S.fill(l, M('26262c'), ['top'])
        S.fill(l, M('26262c'), rows=(0, 5))
        S.fill(l, skin_mat(tone), rows=(5, 8))
        S.fill(l, M('f0f0f0', hi=1.0, lo=0.92), rows=(8, 10))
        S.fill(l, M('d02a2a'), rows=(10, 11))
        S.fill(l, M('f4f4f4', hi=1.0, lo=0.9), rows=(11, 12))
        S.fill(l, M('dcdcdc'), ['bottom'])
    for y in range(5):
        S.set('rleg', 'right', 1, y, hexc('f0f0f0'))
        S.set('rleg', 'right', 2, y, hexc('f0f0f0'))
        S.set('lleg', 'left', 1, y, hexc('f0f0f0'))
        S.set('lleg', 'left', 2, y, hexc('f0f0f0'))


def spleef(S):
    """dressed for snow: a white puffer, an icy blue beanie with a pompom, scarf, mittens, snow trousers"""
    tone = hexc('f4d4bc')
    puff = M('f2f5f9', hi=1.0, lo=0.95, p_hi=0, p_lo=0.15)
    quilt = M('c4d4e4', p_hi=0.05, p_lo=0.05)
    ice, ice_d = M('7ec0ea', hi=1.12, lo=0.88), M('5a9ccc')
    head_skin(S, tone)
    hair(S, '9a6a3e', front=1, side=4, back=6, fringe=[1, 2, 1, 1, 1, 1, 2, 1])
    face(S, tone, hexc('3a8ad0'), brow=hexc('7a4e2a'), blush=hexc('f0a49a'))
    # the beanie: ribbed, a white cuff with a snowflake, a pompom on top
    def beanie(f, x, y, fw, fh):
        if y < 3:
            return ice if x % 2 else ice_d
        if y == 3:
            return puff
        if y == 4 and f == 'back':
            return puff
        return False
    S.paint('head2', beanie, ['right', 'left', 'back'])
    S.paint('head2', lambda f, x, y, fw, fh: (ice if x % 2 else ice_d) if y < 2 else (puff if y == 2 else False), ['front'])
    S.set('head2', 'front', 3, 2, hexc('7ec0ea'))
    S.set('head2', 'front', 4, 2, hexc('7ec0ea'))
    S.paint('head2', lambda f, x, y, fw, fh: puff if 2 <= x <= 5 and 2 <= y <= 5 else ice, ['top'])
    # puffer jacket: quilted rows, an icy zip, scarf round the neck
    body(S, puff)
    S.strip('body', lambda s, y, f, x: quilt if y in (5, 8) else False)
    for y in range(2, 12):
        S.set('body', 'front', 3, y, ice_d)
        S.set('body', 'front', 4, y, M('9cd0f0'))
    S.fill('body', ice, rows=(0, 2))
    S.strip('body', lambda s, y, f, x: ice_d if y < 2 and s % 2 == 0 else False)
    S.pattern('body', 'front', 1, 2, ["s", "s", "S", "s"], {'s': ice, 'S': ice_d})
    S.pattern('body', 'front', 5, 3, ["b.b", ".w.", "b.b"], {'b': hexc('6aaee0'), 'w': hexc('6aaee0')})
    S.fill('body', ice_d, rows=(11, 12))
    # sleeves and mittens
    arms(S, puff, ice, sleeve_rows=9)
    S.both('arm', lambda a: S.strip(a, lambda s, y, f, x: quilt if y in (3, 6) else False))
    S.both('arm', lambda a: S.fill(a, ice_d, rows=(11, 12)))
    # snow trousers, fur topped boots
    legs(S, M('6aa6d8'), M('7a7e88'), shoe_rows=2, sole=M('4a4c54'))
    S.both('leg', lambda l: S.fill(l, puff, rows=(9, 10)))
    S.both('leg', lambda l: S.strip(l, lambda s, y, f, x: M('5a92c4') if y == 4 else False))
    # a little snow sitting on the boots and the pompom
    S.scatter('rleg2', ['front'], 2, [hexc('ffffff')], rows=(10, 11))
    S.scatter('lleg2', ['front'], 2, [hexc('ffffff')], rows=(10, 11))


def buildbattle(S):
    """an artist builder: a magenta beret, a striped shirt, denim dungarees splashed with paint"""
    tone = hexc('cd9670')
    stripe_w, stripe_n = M('f2f0ea', hi=1.0, lo=0.94, p_hi=0, p_lo=0.15), M('263256')
    denim, denim_d = M('4a76b0', hi=1.14, lo=0.84), M('34588a')
    paint = [hexc('e83030'), hexc('f4d020'), hexc('30b848'), hexc('20c0e0'), hexc('f070c0'), hexc('ffffff')]
    head_skin(S, tone)
    hair(S, '3a2418', front=1, side=3, back=6, fringe=[1, 2, 1, 1, 1, 0, 1, 1])
    face(S, tone, hexc('3a8a5a'), brow=hexc('3a2418'))
    S.set('head', 'front', 6, 6, hexc('2a8ad8'))
    S.set('head', 'front', 7, 5, hexc('2a8ad8'))
    # the beret, worn low on the right, a nub on top, a pencil behind the left ear
    beret = M('c02a78', hi=1.15, lo=0.84)
    S.fill('head2', beret, ['top'])
    S.set('head2', 'top', 3, 3, hexc('7a1448'))
    S.set('head2', 'top', 4, 4, hexc('7a1448'))
    S.paint('head2', lambda f, x, y, fw, fh: beret if y < 3 else False, ['right'])
    S.paint('head2', lambda f, x, y, fw, fh: beret if y < (3 if x < 4 else 1) else False, ['front', 'back'])
    S.paint('head2', lambda f, x, y, fw, fh: beret if y < 1 else False, ['left'])
    S.pattern('head2', 'left', 2, 2, ["yyyp"], {'y': hexc('f4c020'), 'p': hexc('3a3a3a')})
    # Breton stripes everywhere the dungarees do not reach
    S.strip('body', lambda s, y, f, x: stripe_n if y % 2 else stripe_w)
    S.fill('body', stripe_w, ['top'])
    S.fill('body', denim, rows=(8, 12))
    S.fill('body', denim, ['bottom'])
    S.pattern('body', 'front', 0, 0, [
        ".d....d.",
        ".d....d.",
        ".d....d.",
        ".d....d.",
        ".dddddd.",
        ".ddppdd.",
        ".ddppdd.",
        ".dddddd.",
    ], {'d': denim, 'p': denim_d})
    S.set('body', 'front', 4, 4, hexc('f4c020'))
    S.set('body', 'front', 4, 3, hexc('f4c020'))
    S.set('body', 'front', 1, 0, hexc('d8b040'))
    S.set('body', 'front', 6, 0, hexc('d8b040'))
    S.pattern('body', 'back', 0, 0, [
        ".d....d.",
        "..d..d..",
        "...dd...",
        "..d..d..",
        ".d....d.",
        "d......d",
    ], {'d': denim})
    for y in range(4):
        S.set('body', 'top', 1, y, denim)
        S.set('body', 'top', 6, y, denim)
    S.scatter('body', ['front'], 4, paint, rows=(4, 12), avoid=lambda f, x, y: x in (0, 7))
    S.scatter('body', ['back', 'right', 'left'], 5, paint, rows=(8, 12))
    for a in ('rarm', 'larm'):
        S.strip(a, lambda s, y, f, x: (stripe_n if y % 2 else stripe_w) if y < 10 else skin_mat(tone))
        S.fill(a, stripe_w, ['top'])
        S.fill(a, skin_mat(tone), ['bottom'])
    S.set('rarm', 'front', 1, 11, hexc('e83030'))
    S.set('rarm', 'front', 2, 10, hexc('f4d020'))
    legs(S, denim, M('6a4428'), shoe_rows=2, sole=M('3a2414'))
    for l in ('rleg', 'lleg'):
        S.scatter(l, SIDES, 6, paint, rows=(0, 11))
    # drips of paint on the dungarees' second layer
    S.pattern('rleg2', 'front', 1, 0, ["e", "e", ".", "."], {'e': hexc('e83030')})
    S.pattern('lleg2', 'front', 2, 0, ["g", "g", "g"], {'g': hexc('30b848')})


SKINS = [('chameleon', chameleon), ('pillars', pillars), ('bedwars', bedwars), ('skywars', skywars),
         ('deathswap', deathswap), ('duels', duels), ('prophunt', prophunt), ('murder', murder),
         ('tntrun', tntrun), ('spleef', spleef), ('bridger', bridger), ('buildbattle', buildbattle)]


# ---------------------------------------------------------------- preview
def flat_views(img):
    """front, back and right side views, each with the second layer over the first"""
    def crop(part, face):
        x, y, w, h = rect(part, face)
        return img.crop((x, y, x + w, y + h))

    def put(canvas, part, face, at):
        for p in (part, part + '2'):
            t = crop(p, face)
            canvas.alpha_composite(t, at)
    front = Image.new('RGBA', (16, 32), (0, 0, 0, 0))
    put(front, 'head', 'front', (4, 0)); put(front, 'body', 'front', (4, 8))
    put(front, 'rarm', 'front', (0, 8)); put(front, 'larm', 'front', (12, 8))
    put(front, 'rleg', 'front', (4, 20)); put(front, 'lleg', 'front', (8, 20))
    back = Image.new('RGBA', (16, 32), (0, 0, 0, 0))
    put(back, 'head', 'back', (4, 0)); put(back, 'body', 'back', (4, 8))
    put(back, 'larm', 'back', (0, 8)); put(back, 'rarm', 'back', (12, 8))
    put(back, 'lleg', 'back', (4, 20)); put(back, 'rleg', 'back', (8, 20))
    side = Image.new('RGBA', (8, 32), (0, 0, 0, 0))
    put(side, 'head', 'right', (0, 0)); put(side, 'rleg', 'right', (2, 20)); put(side, 'rarm', 'right', (2, 8))
    top = Image.new('RGBA', (8, 8), (0, 0, 0, 0))
    put(top, 'head', 'top', (0, 0))
    return front, back, side, top


def preview(skins, path, k=6):
    cw, ch = (16 + 16 + 8 + 8) * k + 5 * 8 + 64 * 3, 32 * k + 30
    cols = 3
    rows = (len(skins) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cw, rows * ch), (120, 128, 136, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, (name, img) in enumerate(skins):
        cx, cy = (i % cols) * cw + 8, (i // cols) * ch + 20
        d.text((cx, cy - 16), name, fill=(255, 255, 255, 255))
        x = cx
        for v in flat_views(img):
            big = v.resize((v.width * k, v.height * k), Image.NEAREST)
            sheet.alpha_composite(big, (x, cy))
            x += big.width + 8
        raw = img.resize((192, 192), Image.NEAREST)
        bg = Image.new('RGBA', raw.size, (60, 60, 66, 255))
        bg.alpha_composite(raw)
        sheet.alpha_composite(bg, (x, cy))
    sheet.save(path)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', '..', 'public', 'leoncraft2', 'textures', 'skin', 'npc')
    sheet = None
    args = sys.argv[1:]
    if '--preview' in args:
        i = args.index('--preview')
        sheet = args[i + 1]
        del args[i:i + 2]
    if args:
        out = args[0]
    os.makedirs(out, exist_ok=True)
    made = []
    for n, (name, fn) in enumerate(SKINS):
        S = Skin(1000 + n)
        fn(S)
        S.img.save(os.path.join(out, name + '.png'))
        made.append((name, S.img))
    if sheet:
        preview(made, sheet)
    print('wrote', len(made), 'skins to', os.path.normpath(out))


if __name__ == '__main__':
    main()
