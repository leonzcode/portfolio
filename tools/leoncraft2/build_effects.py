"""
Leoncraft 2 - the status effect pictures, in the style the game draws them
since 1.21 (one small picture each, 18 x 18: a coloured object with a dark
outline on a clear background), on one sheet.

Every picture is our own, drawn here in code from simple shapes: the same
things the game shows (a boot for speed, a ball and chain for slowness, a
golden pickaxe for haste, a crossed-out eye for blindness...), each laid out
our own way. No pack and no game picture is read. They were checked against
the game's 26.1 pictures after drawing (October 2026, a local check only):
no picture shares more than a handful of pixels with the game's.

Each shape is filled with its colour, lit along its top and left and shaded
along its bottom and right (bevel), and the whole picture gets a one pixel
outline in a dark shade of whatever it touches.

The sheet is textures/gui/mob_effect.png, eight pictures to a row in the
order of EFFECT_SHEET in js/effects.js (keep the two lists the same).

Run:  python tools/leoncraft2/build_effects.py
"""
import math
import os
from PIL import Image

ORDER = [
    'speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost',
    'nausea', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision',
    'hunger', 'weakness', 'poison', 'wither', 'health_boost', 'absorption', 'saturation', 'glowing',
    'levitation', 'luck', 'unluck', 'slow_falling', 'conduit_power', 'dolphins_grace', 'bad_omen', 'hero_of_the_village',
    'darkness', 'trial_omen', 'raid_omen', 'wind_charged', 'weaving', 'oozing', 'infested', 'breath_of_the_nautilus',
]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'leoncraft2', 'textures', 'gui', 'mob_effect.png')
N = 18


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


WHITE, BLACK = (255, 255, 255), (0, 0, 0)


class Pic:
    """an 18 x 18 picture drawn from shapes"""

    def __init__(self):
        self.c = [[None] * N for _ in range(N)]   # (r, g, b, a) or None

    def put(self, x, y, col, a=255):
        if 0 <= x < N and 0 <= y < N:
            self.c[y][x] = tuple(col[:3]) + (a,)

    def get(self, x, y):
        return self.c[y][x] if 0 <= x < N and 0 <= y < N else None

    def mask(self, inside):
        return {(x, y) for y in range(N) for x in range(N) if inside(x + 0.5, y + 0.5)}

    def fill(self, m, col, bevel=0.0, a=255):
        """fill the pixels m; bevel lightens the top/left edge and darkens the bottom/right"""
        for (x, y) in m:
            c = col
            if bevel:
                if (x, y - 1) not in m or (x - 1, y) not in m:
                    c = mix(col, WHITE, bevel)
                elif (x, y + 1) not in m or (x + 1, y) not in m:
                    c = mix(col, BLACK, bevel)
            self.put(x, y, c, a)
        return m

    # shapes (pixel centres inside the shape are filled)
    def circle(self, cx, cy, r, col, bevel=0.0, a=255):
        return self.fill(self.mask(lambda x, y: (x - cx) ** 2 + (y - cy) ** 2 <= r * r), col, bevel, a)

    def ellipse(self, cx, cy, rx, ry, col, bevel=0.0, a=255):
        return self.fill(self.mask(lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1), col, bevel, a)

    def ring(self, cx, cy, r, w, col, bevel=0.0):
        return self.fill(self.mask(lambda x, y: r - w <= math.hypot(x - cx, y - cy) <= r), col, bevel)

    def rect(self, x0, y0, x1, y1, col, bevel=0.0):
        return self.fill({(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}, col, bevel)

    def poly(self, pts, col, bevel=0.0):
        def inside(x, y):
            n, ok = len(pts), False
            for i in range(n):
                (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % n]
                if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                    ok = not ok
            return ok
        return self.fill(self.mask(inside), col, bevel)

    def line(self, x0, y0, x1, y1, col, w=1.0, bevel=0.0):
        """a straight stroke w pixels wide between two points (pixel coordinates of centres)"""
        def inside(x, y):
            x -= 0.5
            y -= 0.5
            dx, dy = x1 - x0, y1 - y0
            l2 = dx * dx + dy * dy or 1
            t = max(0, min(1, ((x - x0) * dx + (y - y0) * dy) / l2))
            return math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)) <= w / 2
        return self.fill(self.mask(inside), col, bevel)

    def heart(self, cx, cy, s, col, bevel=0.0):
        """a heart s pixels across, its middle at (cx, cy)"""
        r = s * 0.27
        lobes = lambda x, y: (x - (cx - r * 0.95)) ** 2 + (y - (cy - s * 0.12)) ** 2 <= r * r or (x - (cx + r * 0.95)) ** 2 + (y - (cy - s * 0.12)) ** 2 <= r * r
        top, bot, half = cy - s * 0.05, cy + s * 0.5, s * 0.5
        tri = lambda x, y: top <= y <= bot and abs(x - cx) <= half * (bot - y) / (bot - top)
        return self.fill(self.mask(lambda x, y: lobes(x, y) or tri(x, y)), col, bevel)

    def flip(self):
        """mirrored left to right"""
        self.c = [row[::-1] for row in self.c]

    def outline(self, k=0.78):
        """every clear pixel beside the picture: a dark shade of the darkest thing it touches"""
        add = {}
        for y in range(N):
            for x in range(N):
                if self.c[y][x] is not None:
                    continue
                near = [self.get(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
                near = [p for p in near if p is not None and p[3] > 128]
                if near:
                    base = min(near, key=lambda p: p[0] + p[1] + p[2])
                    add[(x, y)] = mix(base, BLACK, k)
        for (x, y), c in add.items():
            self.put(x, y, c)

    def image(self):
        im = Image.new('RGBA', (N, N), (0, 0, 0, 0))
        for y in range(N):
            for x in range(N):
                if self.c[y][x] is not None:
                    im.putpixel((x, y), self.c[y][x])
        return im


def sparkle(p, x, y, col=WHITE, arm=1):
    p.put(x, y, col)
    for d in range(1, arm + 1):
        for dx, dy in ((d, 0), (-d, 0), (0, d), (0, -d)):
            p.put(x + dx, y + dy, mix(col, (180, 200, 255), 0.25 * d))


# ---- the pictures ----

def speed(p):
    leather, sole = (164, 60, 44), (88, 34, 26)
    p.rect(8, 2, 12, 11, leather, 0.22)                 # the shaft
    p.poly([(8, 8.5), (13, 8.5), (16.2, 11), (16.2, 14), (8, 14)], leather, 0.22)   # the foot, toe forward
    p.rect(8, 2, 12, 2, mix(leather, WHITE, 0.35))       # the cuff
    for y in (4, 6, 8):
        p.put(10, y, (226, 164, 120))                   # laces
    p.rect(8, 14, 16, 15, sole)
    for y, x0, x1, c in ((5, 2, 6, (236, 236, 236)), (8, 0, 5, (190, 190, 196)), (11, 2, 6, (236, 236, 236)), (14, 1, 5, (150, 150, 158))):
        p.rect(x0, y, x1, y, c)


def slowness(p):
    iron, chain = (82, 84, 98), (136, 138, 150)
    # the links, sagging from the ball to a cuff, each a little ring turned the other way to the last
    for i, (x, y) in enumerate(((8.0, 11.6), (6.2, 13.4), (4.3, 14.4))):
        if i % 2:
            p.ring(x, y, 1.5, 0.9, chain)
        else:
            p.ellipse(x, y, 1.5, 0.8, chain)
    p.ring(2.2, 15.0, 2.0, 1.0, mix(chain, WHITE, 0.15), 0.2)   # the cuff at the chain's end
    p.circle(11.6, 6.2, 4.9, iron, 0.0)
    p.circle(10.6, 5.2, 2.0, mix(iron, WHITE, 0.25))
    p.put(9, 4, mix(iron, WHITE, 0.6))
    p.put(10, 4, mix(iron, WHITE, 0.45))


def haste(p):
    gold, wood = (238, 190, 52), (122, 82, 40)
    p.line(15, 15, 5.5, 5.5, wood, 1.7, 0.25)
    p.fill(p.mask(lambda x, y: 7.0 <= math.hypot(x - 11.6, y - 11.6) <= 10.2 and -3.12 < math.atan2(y - 11.6, x - 11.6) < -1.59), gold, 0.3)


def mining_fatigue(p):
    steel = (156, 166, 206)
    p.line(14.5, 14.5, 7.5, 7.5, steel, 1.5, 0.25)
    p.ellipse(5.5, 5.5, 4.2, 3.4, steel, 0.25)
    p.ellipse(5.2, 5.2, 2.2, 1.6, mix(steel, BLACK, 0.35))
    p.put(4, 4, mix(steel, WHITE, 0.7))


def strength(p):
    blade, guard, grip = (226, 228, 236), (64, 64, 76), (112, 76, 42)
    p.line(6.5, 10.5, 15, 2, blade, 2.0, 0.2)
    p.line(3.5, 8, 8.5, 13, guard, 1.4)
    p.line(2.5, 14.5, 5.5, 11.5, grip, 1.4)
    p.put(1, 15, guard)


def instant_health(p):
    p.heart(7.5, 7.0, 13, (226, 30, 40), 0.3)
    p.rect(12, 14, 16, 14, WHITE)
    p.rect(14, 12, 14, 16, WHITE)


def instant_damage(p):
    dark = (132, 22, 34)
    m = p.heart(7.5, 7.0, 13, dark, 0.25)
    for x, y in ((8, 3), (7, 4), (8, 5), (9, 6), (8, 7), (7, 8), (8, 9), (8, 10)):
        p.c[y][x] = None                               # the crack
    p.rect(12, 14, 16, 14, WHITE)


def jump_boost(p):
    sky = (124, 208, 240)
    p.poly([(1.5, 9), (8.5, 1.5), (15.5, 9)], sky, 0.25)
    p.rect(6, 9, 10, 15, sky, 0.25)
    p.poly([(4.5, 13), (8.5, 9.5), (12.5, 13)], mix(sky, WHITE, 0.55))


def nausea(p):
    green = (96, 168, 60)
    p.fill(p.mask(lambda x, y: 2 <= y <= 15.5 and abs(x - (8.5 + 3.4 * math.sin((y - 2) * 0.62))) <= 2.2), green, 0.25)
    p.rect(9, 1, 10, 1, (64, 112, 40))
    p.put(11, 1, (128, 200, 84))


def regeneration(p):
    p.heart(7.5, 9.0, 13.5, (230, 34, 46), 0.3)
    p.put(4, 6, (255, 150, 150))
    sparkle(p, 14, 3, (255, 200, 220))


def shield(p, face, rim):
    p.poly([(2, 1.5), (16, 1.5), (16, 9), (9, 16.5), (2, 9)], rim)
    return p.poly([(3, 2.5), (15, 2.5), (15, 8.6), (9, 15.2), (3, 8.6)], face, 0.15)


def resistance(p):
    shield(p, (128, 140, 162), (82, 90, 110))
    p.rect(8, 4, 9, 11, (70, 76, 96))
    p.rect(6, 9, 11, 9, (70, 76, 96))


def fire_resistance(p):
    shield(p, (150, 104, 96), (98, 64, 60))
    p.poly([(6, 12.5), (6, 8), (8, 9.5), (9, 4), (11, 8), (12, 7), (12, 12.5)], (246, 140, 30))
    p.poly([(7.5, 12.5), (8.5, 9.5), (9.5, 10.5), (10.5, 12.5)], (255, 226, 90))


def water_breathing(p):
    blue = (96, 178, 232)
    for cx, cy, r in ((11.5, 11.5, 4.6), (4.5, 5.0, 3.2), (12.5, 3.2, 2.2)):
        p.circle(cx, cy, r - 1.1, (200, 232, 255), a=1)
        p.ring(cx, cy, r, 1.15, blue)
        p.put(int(cx - r * 0.45), int(cy - r * 0.45), WHITE)


def invisibility(p):
    gold, glass = (232, 182, 52), (160, 208, 244)
    p.rect(8, 11, 9, 16, gold, 0.2)
    p.rect(7, 15, 10, 16, mix(gold, BLACK, 0.2))
    p.circle(8.5, 6.5, 5.6, gold, 0.25)
    p.circle(8.5, 6.5, 4.0, glass, 0.15)
    p.line(6, 6, 8, 4, WHITE, 1.0)


def eye(p, cx, cy, w, h, white, iris, pupil):
    p.fill(p.mask(lambda x, y: abs(y - cy) <= h * (1 - ((x - cx) / w) ** 2)), white, 0.15)
    p.circle(cx, cy, h * 0.8, iris)
    p.circle(cx, cy, h * 0.38, pupil)


def blindness(p):
    eye(p, 8.5, 9.0, 7.5, 4.2, (226, 230, 236), (60, 120, 150), (20, 22, 30))
    p.line(2.5, 15.5, 15.5, 2.5, (216, 30, 30), 1.6)


def night_vision(p):
    eye(p, 8.5, 11.0, 7.5, 4.0, (52, 60, 150), (90, 120, 220), (16, 18, 60))
    # a crescent moon: a disc with a smaller one taken out of its upper right
    p.circle(13.0, 3.8, 2.8, (250, 222, 80))
    for (x, y) in p.mask(lambda x, y: (x - 14.3) ** 2 + (y - 3.0) ** 2 <= 4.4):
        p.c[y][x] = None


def drumstick(p, meat, bone=(236, 228, 210)):
    p.line(3, 14, 7, 10, bone, 1.5)
    p.circle(2.5, 15.0, 1.3, bone)
    p.circle(3.6, 15.6, 1.0, bone)
    p.ellipse(10.5, 7.0, 5.2, 4.6, meat, 0.25)


def hunger(p):
    drumstick(p, (124, 104, 52))
    for x, y in ((9, 5), (12, 8), (10, 9)):
        p.put(x, y, (86, 128, 44))


def weakness(p):
    blade, guard, grip = (178, 180, 188), (64, 64, 76), (112, 76, 42)
    p.line(6.5, 10.5, 9.5, 7.5, blade, 2.0, 0.2)
    p.line(11.5, 5.5, 14.5, 2.5, blade, 2.0, 0.2)
    p.put(12, 8, blade)
    p.put(9, 4, blade)
    p.line(3.5, 8, 8.5, 13, guard, 1.4)
    p.line(2.5, 14.5, 5.5, 11.5, grip, 1.4)


def poison(p):
    green = (112, 176, 52)
    p.circle(6.0, 11.0, 4.8, green, 0.3)
    p.circle(13.0, 4.5, 2.6, green, 0.3)
    p.circle(13.5, 11.5, 1.6, green, 0.3)
    p.circle(4.5, 3.5, 1.4, green, 0.3)
    p.put(5, 10, (60, 104, 30))
    p.put(7, 10, (60, 104, 30))
    p.rect(5, 12, 7, 12, (60, 104, 30))


def wither(p):
    m = p.heart(8.5, 9.0, 14, (96, 72, 84), 0.25)
    for x, y in ((13, 4), (14, 4), (14, 5), (13, 5), (12, 4), (15, 6)):
        p.c[y][x] = None
    for x, y in ((7, 7), (8, 8), (7, 9), (8, 10), (10, 11)):
        p.put(x, y, (52, 38, 46))
    p.put(15, 2, (70, 54, 64))
    p.put(13, 1, (70, 54, 64))


def health_boost(p):
    p.heart(6.5, 6.0, 10, (236, 110, 40), 0.25)
    p.heart(10.0, 10.0, 13, (226, 30, 40), 0.3)


def absorption(p):
    aura = (110, 220, 236)
    for k in range(12):
        a = k / 12 * math.tau
        p.put(int(round(8.5 + math.cos(a) * 8.0 - 0.5)), int(round(8.5 + math.sin(a) * 8.0 - 0.5)), aura)
    shield(p, (150, 170, 200), (96, 110, 140))


def saturation(p):
    drumstick(p, (160, 84, 40))
    sparkle(p, 3, 3, WHITE, 2)


def glowing(p):
    frame, face = (240, 240, 236), (196, 200, 204)
    p.rect(4, 4, 13, 13, frame)
    p.rect(5, 5, 12, 12, face, 0.15)
    p.rect(6, 7, 7, 8, (40, 40, 46))
    p.rect(10, 7, 11, 8, (40, 40, 46))
    p.rect(7, 10, 10, 10, (40, 40, 46))
    for x, y, dx, dy in ((8, 1, 0, 1), (8, 15, 0, 1), (1, 8, 1, 0), (15, 8, 1, 0), (2, 2, 1, 1), (14, 2, -1, 1), (2, 14, 1, -1), (14, 14, -1, -1)):
        p.put(x, y, frame)
        p.put(x + dx, y + dy, frame)
        if dx and dy:
            continue
        p.put(x + (1 if dy else 0), y + (1 if dx else 0), frame)


def levitation(p):
    cloud = (240, 246, 252)
    p.circle(6.0, 8.0, 3.4, cloud, 0.12)
    p.circle(10.0, 6.0, 4.0, cloud, 0.12)
    p.circle(13.5, 8.8, 2.6, cloud, 0.12)
    p.rect(3, 9, 14, 10, cloud)
    p.rect(3, 10, 14, 10, (196, 214, 236))
    p.rect(5, 14, 12, 15, (110, 112, 118))


def clover(p, leaf, missing=()):
    for i, (cx, cy) in enumerate(((5.3, 5.3), (11.7, 5.3), (5.3, 11.7), (11.7, 11.7))):
        if i in missing:
            continue
        p.circle(cx, cy, 3.4, leaf, 0.25)
    p.rect(7, 7, 10, 10, mix(leaf, BLACK, 0.25))
    p.line(10, 10, 14.5, 15.5, mix(leaf, BLACK, 0.35), 1.2)


def luck(p):
    clover(p, (88, 192, 52))


def unluck(p):
    clover(p, (178, 148, 64), missing=(1,))
    p.put(13, 6, (178, 148, 64))
    p.put(15, 8, (140, 112, 48))


def slow_falling(p):
    vane, quill = (246, 238, 226), (196, 178, 160)
    ax, ay, bx, by = 2.5, 15.5, 15.0, 2.0
    L = math.hypot(bx - ax, by - ay)
    ux, uy = (bx - ax) / L, (by - ay) / L

    def vane_at(x, y):
        # along the quill (t, 0 at the end you hold) and across it (s, one side wider than the other)
        t = ((x - ax) * ux + (y - ay) * uy) / L
        s = (x - ax) * -uy + (y - ay) * ux
        if not 0.22 < t < 1.0:
            return False
        w = math.sin(math.pi * (t - 0.22) / 0.78) ** 0.7
        return -2.4 * w <= s <= 3.6 * w
    p.fill(p.mask(vane_at), vane, 0.18)
    p.line(ax, ay, bx - 1, by + 1, quill, 1.0)
    for k in (8, 11):                                   # a notch or two in the vane
        p.c[18 - k - 3][k] = None


def conduit_power(p):
    p.circle(8.5, 8.5, 7.6, (36, 112, 196), 0.2)
    p.ring(8.5, 8.5, 7.6, 1.2, (76, 206, 230))
    p.circle(8.5, 8.5, 3.6, (232, 170, 50), 0.2)
    p.circle(8.5, 8.5, 2.0, (40, 26, 20))


def dolphins_grace(p):
    body, belly = (122, 150, 184), (210, 222, 236)
    p.fill(p.mask(lambda x, y: 2.2 <= math.hypot(x - 9.0, y - 13.5) <= 7.4 and y < 13.5 and x > 1.8), body, 0.2)
    p.fill(p.mask(lambda x, y: 2.2 <= math.hypot(x - 9.0, y - 13.5) <= 3.6 and y < 13.5), belly)
    p.poly([(15, 12.5), (17, 15), (13, 15)], body)       # the tail
    p.poly([(8, 6.3), (10, 3.6), (11, 6.3)], body)       # the fin
    p.poly([(1.5, 13), (3.5, 13), (1.5, 15)], body)      # the beak
    p.put(4, 11, (24, 28, 40))


def bad_omen(p):
    hood, face = (30, 40, 66), (64, 76, 104)
    p.poly([(2, 16), (3, 6), (8.5, 0.8), (14, 6), (15, 16)], hood, 0.2)
    p.poly([(5, 15), (5, 8), (12, 8), (12, 15)], face)
    p.rect(6, 10, 7, 10, (230, 40, 40))
    p.rect(10, 10, 11, 10, (230, 40, 40))
    p.rect(8, 11, 9, 13, mix(face, BLACK, 0.3))


def hero_of_the_village(p):
    gem = (60, 214, 92)
    p.poly([(8.5, 1), (13, 4.5), (13, 10), (8.5, 13), (4, 10), (4, 4.5)], gem, 0.3)
    p.poly([(8.5, 3.5), (10.5, 5.5), (10.5, 8.5), (8.5, 10.5), (6.5, 8.5), (6.5, 5.5)], mix(gem, WHITE, 0.3))
    p.rect(1, 14, 16, 15, (200, 32, 40), 0.2)
    p.poly([(1, 13.5), (3, 13.5), (1, 17)], (150, 20, 30))
    p.poly([(16, 13.5), (14, 13.5), (16, 17)], (150, 20, 30))


def darkness(p):
    ink = (28, 28, 34)
    p.fill(p.mask(lambda x, y: spiral_d(x - 8.5, y - 8.5, 3.3) <= 0.95 and math.hypot(x - 8.5, y - 8.5) < 8.4), ink, 0.35)


def spiral_d(dx, dy, step=2.6):
    """how far a point is from a spiral running out from the middle (step pixels a turn)"""
    r, a = math.hypot(dx, dy), math.atan2(dy, dx)
    t = (a + math.pi) / math.tau
    best = 99
    for k in range(-1, 5):
        best = min(best, abs(r - (t + k) * step))
    return best


def trial_omen(p):
    flame = (60, 220, 230)
    p.poly([(3, 16), (2, 9), (4, 4), (6, 7), (8.5, 0.8), (11, 7), (13, 4), (15, 9), (14, 16)], flame, 0.3)
    p.ellipse(8.5, 11.0, 4.0, 3.4, (20, 60, 70))
    p.rect(6, 10, 7, 11, (240, 40, 60))
    p.rect(10, 10, 11, 11, (240, 40, 60))


def raid_omen(p):
    hood, skin = (82, 86, 92), (150, 156, 156)
    p.poly([(2, 15), (2, 5), (8.5, 0.8), (15, 5), (15, 15)], hood, 0.2)
    p.rect(4, 6, 13, 15, skin, 0.15)
    p.rect(4, 8, 13, 8, (40, 42, 46))              # the brow
    p.rect(5, 9, 6, 9, (232, 36, 48))
    p.rect(11, 9, 12, 9, (232, 36, 48))
    p.rect(8, 9, 9, 13, mix(skin, BLACK, 0.25))     # the nose


def wind_charged(p):
    wind = (196, 204, 252)
    for cx, cy, r in ((5.5, 5.5, 4.4), (12.0, 8.5, 4.6), (6.5, 13.0, 3.6)):
        m = p.circle(cx, cy, r, wind, 0.2)
        for (x, y) in m:
            if spiral_d(x + 0.5 - cx, y + 0.5 - cy, 2.0) <= 0.5 and math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r - 0.6:
                p.put(x, y, mix(wind, BLACK, 0.3))


def weaving(p):
    silk = (232, 234, 240)
    for k in range(5):
        a = k / 4 * (math.pi / 2)
        p.line(1, 1, 1 + math.cos(a) * 16, 1 + math.sin(a) * 16, silk, 0.9)
    p.fill(p.mask(lambda x, y: any(abs(math.hypot(x - 1.5, y - 1.5) - r) <= 0.5 for r in (5, 9.5, 14)) and x < 17 and y < 17), silk)
    p.circle(12.5, 12.5, 2.2, (40, 34, 36))
    for dx, dy in ((-3, -1), (-3, 1), (3, -1), (3, 1), (-2, 3), (2, 3)):
        p.put(12 + dx, 12 + dy, (40, 34, 36))
    p.put(12, 12, (200, 30, 30))
    p.flip()                                            # the web in the top right corner, the spider low left


def oozing(p):
    slime = (124, 210, 108)
    p.rect(2, 3, 15, 15, mix(slime, WHITE, 0.25))
    p.rect(3, 4, 14, 14, slime, 0.15)
    p.rect(5, 6, 12, 12, mix(slime, BLACK, 0.2))
    p.rect(6, 8, 7, 9, (40, 70, 36))
    p.rect(10, 8, 11, 9, (40, 70, 36))
    p.put(9, 11, (40, 70, 36))


def infested(p):
    shell = (150, 154, 160)
    legs = (84, 86, 92)
    for k, (cx, cy, r) in enumerate(((13.0, 4.5, 2.3), (10.4, 7.1, 2.7), (7.7, 9.8, 2.7), (5.1, 12.4, 2.2), (3.0, 14.6, 1.5))):
        if k in (1, 2, 3):
            # a pair of legs out either side of the plate
            p.put(int(cx + 2.6), int(cy + 2.0), legs)
            p.put(int(cx - 2.2), int(cy - 2.6), legs)
        p.circle(cx, cy, r, shell if k % 2 else mix(shell, BLACK, 0.28), 0.3)
    p.put(15, 1, legs)
    p.put(16, 3, legs)
    p.put(13, 4, (30, 30, 34))


def breath_of_the_nautilus(p):
    shell, stripe = (238, 222, 200), (212, 84, 60)
    m = p.circle(10.0, 7.5, 6.6, shell, 0.15)
    for (x, y) in m:
        if spiral_d(x + 0.5 - 10.0, y + 0.5 - 7.5) <= 0.55:
            p.put(x, y, stripe)
    for k in range(4):
        p.line(4.5 - k * 0.3, 11.5 + k * 0.4, 1.0 + k * 0.5, 13.5 + k * 1.0, (230, 120, 110), 1.0)


DRAW = {name: globals()[name] for name in ORDER}


def picture(name):
    p = Pic()
    DRAW[name](p)
    p.outline()
    return p.image()


def main():
    rows = (len(ORDER) + 7) // 8
    sheet = Image.new('RGBA', (8 * 18, rows * 18), (0, 0, 0, 0))
    for i, n in enumerate(ORDER):
        sheet.paste(picture(n), ((i % 8) * 18, (i // 8) * 18))
    sheet.save(OUT, optimize=True)
    print('wrote', os.path.normpath(OUT), len(ORDER), 'pictures')


if __name__ == '__main__':
    main()
