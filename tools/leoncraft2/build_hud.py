"""
Leoncraft 2 - our own HUD icons.

Pixel Perfection's icons sheet (textures/gui/icons.png) draws the HUD its own
way: a crosshair of four dots, apples for hunger, a navy and gold experience
bar, dark red hearts. The game's HUD has a plus for a crosshair, meat shanks,
a dark bar filling with green and bright red hearts, and that is what a player
looking at the two side by side expects. This draws our own versions (our own
pixels, no game files) over those parts of icons.png, at the places in the
sheet the HUD code cuts them from (js/ui/hud.js):

  crosshair    0, 0, 15 x 15         a plus, 9 across, one pixel thick
  hearts       row y 0: 16 empty, 25 empty flashing, 52 / 61 full / half,
               70 / 79 flashing, 88.. poisoned, 124.. withered, 160 / 169 gold,
               178 / 187 frozen (fully frozen in powder snow)
  hardcore     row y 45: the same hearts again in their hardcore look (a
               spiked top to the empty heart, two dark brows on the full ones)
  air          row y 18: 16 a bubble, 25 a bubble bursting
  hunger       row y 27: 16 empty, 52 / 61 full / half, 88 / 97 with the
               hunger effect, 133 empty with it
  experience   0, 64 the empty bar, 0, 69 the full one, 182 x 5

Armour (row y 9) stays Pixel Perfection's.

Run:  python tools/leoncraft2/build_hud.py
"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'leoncraft2', 'textures', 'gui', 'icons.png')


def noise(x, y, seed=0):
    h = (x * 374761393 + y * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 255) / 255.0


def clear(px, x0, y0, w, h):
    for y in range(h):
        for x in range(w):
            px[x0 + x, y0 + y] = (0, 0, 0, 0)


def paint(px, x0, y0, rows, pal, keep=None):
    """rows of characters, one per pixel; '.' is left alone. keep(x, y) -> False skips a pixel."""
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == '.' or ch not in pal:
                continue
            if keep and not keep(x, y):
                continue
            c = pal[ch]
            px[x0 + x, y0 + y] = c + (255,) if len(c) == 3 else c


# ---- the crosshair ----
def crosshair(px):
    clear(px, 0, 0, 16, 16)
    for i in range(3, 12):
        px[7, i] = (255, 255, 255, 255)
        px[i, 7] = (255, 255, 255, 255)


# ---- hearts ----
HEART_BOX = [
    '.KK...KK.',
    'KddK.KddK',
    'KdddKdddK',
    'KdddddddK',
    'KdddddddK',
    '.KdddddK.',
    '..KdddK..',
    '...KdK...',
    '....K....',
]
HEART = [
    '.........',
    '.hR...RR.',
    '.hRR.RRR.',
    '.RRRRRRs.',
    '.RRRRRRs.',
    '..RRRRs..',
    '...RRs...',
    '....s....',
    '.........',
]
HEART_KINDS = {
    # main, shade, highlight
    'red': ((236, 28, 28), (182, 18, 18), (255, 196, 196)),
    'flash': ((246, 164, 164), (220, 160, 160), (255, 228, 228)),
    'poison': ((140, 120, 26), (102, 82, 10), (196, 178, 96)),
    'wither': ((54, 38, 38), (40, 16, 16), (200, 200, 200)),
    'gold': ((214, 174, 44), (206, 150, 6), (244, 220, 136)),
    'frozen': ((150, 210, 244), (84, 148, 212), (248, 252, 255)),
}
# a frozen heart: ice with two little white crystals in it
FROZEN = [
    '.........',
    '.hR...RR.',
    '.hRw.RwR.',
    '.RRRwRRs.',
    '.RwRRRRs.',
    '..RRwRs..',
    '...RRs...',
    '....s....',
    '.........',
]
# hardcore: the empty heart with a spike between its lobes, the full ones with two dark brows
HEART_BOX_HC = [
    '.KK.K.KK.',
    'KddKdKddK',
    'KdddddddK',
    'KdddddddK',
    'KdddddddK',
    '.KdddddK.',
    '..KdddK..',
    '...KdK...',
    '....K....',
]
BROWS = {(2, 3), (3, 4), (6, 3), (5, 4)}


def with_brows(rows):
    out = []
    for y, row in enumerate(rows):
        out.append(''.join('e' if (x, y) in BROWS and ch != '.' else ch for x, ch in enumerate(row)))
    return out


def heart_row(px, y0, hardcore):
    box = HEART_BOX_HC if hardcore else HEART_BOX
    shape = with_brows(HEART) if hardcore else HEART
    frozen = with_brows(FROZEN) if hardcore else FROZEN
    clear(px, 16, y0, 180, 9)
    # the empty heart behind each one, and its white flash
    paint(px, 16, y0, box, {'K': (0, 0, 0), 'd': (30, 30, 30)})
    paint(px, 25, y0, box, {'K': (250, 250, 250), 'd': (40, 40, 40)})
    for x0, kind in ((52, 'red'), (88, 'poison'), (124, 'wither'), (160, 'gold'), (178, 'frozen')):
        m, s, h = HEART_KINDS[kind]
        # the brows: the heart's own shade, darkened
        pal = {'R': m, 's': s, 'h': h, 'w': (255, 255, 255), 'e': tuple(int(c * 0.45) for c in s)}
        pic = frozen if kind == 'frozen' else shape
        paint(px, x0, y0, pic, pal)
        paint(px, x0 + 9, y0, pic, pal, keep=lambda x, y: x <= 4)
        if kind in ('gold', 'frozen'):
            continue
        # the flashing pair after each (lost health shows white for a moment)
        fm, fs, fh = HEART_KINDS['flash']
        fpal = {'R': fm, 's': fs, 'h': fh, 'e': tuple(int(c * 0.6) for c in fs)}
        paint(px, x0 + 18, y0, shape, fpal)
        paint(px, x0 + 27, y0, shape, fpal, keep=lambda x, y: x <= 4)


def hearts(px):
    heart_row(px, 0, False)
    heart_row(px, 45, True)


# ---- air ----
BUBBLE = [
    '..KKKKK..',
    '.KBBBBBK.',
    'KBW...BBK',
    'KBW....BK',
    'KB.....BK',
    'KB.....BK',
    'KBB...BBK',
    '.KBBBBBK.',
    '..KKKKK..',
]
BURST = [
    '...K.K...',
    '.KB...BK.',
    '.B.....B.',
    'K.......K',
    '.........',
    'K.......K',
    '.B.....B.',
    '.KB...BK.',
    '...K.K...',
]


def air(px):
    clear(px, 16, 18, 18, 9)
    pal = {'K': (0, 0, 0), 'B': (44, 112, 196), 'W': (206, 234, 255)}
    paint(px, 16, 18, BUBBLE, pal)
    paint(px, 25, 18, BURST, {'K': (0, 0, 0), 'B': (30, 120, 230)})


# ---- hunger: a meat shank, the meat up and to the right, the bone down to the left ----
SHANK_BOX = [
    '....KKK..',
    '...KdddK.',
    '..KdddddK',
    '..KdddddK',
    '..KdddddK',
    '.KdKdddK.',
    'KdddKKK..',
    'KddK.....',
    '.KK......',
]
SHANK = [
    '.........',
    '....hhm..',
    '...mhmmm.',
    '...mmmmm.',
    '...mmmmd.',
    '..b.mmd..',
    '.bbc.....',
    '.bc......',
    '.........',
]


def hunger(px):
    clear(px, 16, 27, 126, 9)
    paint(px, 16, 27, SHANK_BOX, {'K': (0, 0, 0), 'd': (26, 26, 26)})
    paint(px, 133, 27, SHANK_BOX, {'K': (14, 40, 10), 'd': (34, 62, 28)})
    meat = {'m': (176, 92, 58), 'd': (108, 50, 24), 'h': (234, 158, 108), 'b': (250, 244, 222), 'c': (204, 194, 168)}
    rotten = {'m': (112, 128, 46), 'd': (60, 72, 20), 'h': (164, 180, 84), 'b': (238, 226, 142), 'c': (196, 184, 100)}
    for x0, pal in ((52, meat), (88, rotten)):
        paint(px, x0, 27, SHANK, pal)
        # half a shank: the meat end, next to the full ones (the bar fills from the right)
        paint(px, x0 + 9, 27, SHANK, pal, keep=lambda x, y: x >= 4)


# ---- the experience bar ----
def experience(px):
    clear(px, 0, 64, 182, 10)
    for x in range(182):
        for y in range(5):
            edge = y in (0, 4) or x in (0, 181)
            n = (noise(x, y, 11) - 0.5) * 8
            if edge:
                px[x, 64 + y] = (10, 16, 12, 255)
                px[x, 69 + y] = (18, 42, 22, 255)
                continue
            # the empty bar: dark grey-green, a darker middle line, a faint joint every twenty pixels
            v = (44, 56, 50) if y != 2 else (28, 38, 32)
            if x % 20 == 0:
                v = (20, 28, 24)
            px[x, 64 + y] = tuple(max(0, min(255, int(c + n))) for c in v) + (255,)
            # the full bar: green, bright along the middle
            g = (82, 130, 46) if y == 1 else (130, 182, 88) if y == 2 else (70, 116, 38)
            px[x, 69 + y] = tuple(max(0, min(255, int(c + n * 1.5))) for c in g) + (255,)


def main():
    img = Image.open(OUT).convert('RGBA')
    px = img.load()
    crosshair(px)
    hearts(px)
    air(px)
    hunger(px)
    experience(px)
    img.save(OUT, optimize=True)
    print('wrote', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
