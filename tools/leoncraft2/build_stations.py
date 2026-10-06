"""
Leoncraft 2 - the work block screens in the classic light grey.

build_gui.py draws the container screens; this draws the screens of the
work blocks the same way (the panel, bevels and sunken slots are its
functions), with everything else on each sheet our own pixels too:

  enchanting_table  176 x 166; the offer slots (108 x 19: enabled 0,166,
                    disabled 0,185, under the mouse 0,204) and the level
                    marks (16 x 16, enabled 16 i,223, disabled 16 i,239)
  anvil             176 x 166; a hammer, the plus and arrow; the name box
                    (110 x 16 at 0,166, disabled at 0,182); the red cross
                    (28 x 21 at 176,0)
  grindstone        176 x 166; a grindstone, the arrow; the red cross at 176,0
  smithing          176 x 166 (the 1.20 layout: template, base, addition);
                    the red cross at 176,0
  stonecutter       176 x 166; the recipe buttons (16 x 18 at 0,166 / 184 /
                    202) and the scroller (12 x 15 at 176,0, disabled 188,0)
  brewing_stand     176 x 166; the pipes, the empty fuel bar and the bottles'
                    outlines; the brewing arrow (9 x 28 at 176,0), the
                    bubbles (12 x 29 at 185,0) and the fuel (18 x 4 at 176,29)
  villager          276 x 166 on a 512 x 256 sheet; the trade list, the
                    payment and result slots, the arrow; at 280,0 the small
                    arrow (10 x 9, sold out at 292,0), the red cross (28 x 21
                    at 280,12), the experience bar (102 x 5: empty 280,40,
                    filled 280,46, what a trade adds 280,52), the scroller
                    (6 x 27 at 400,0, disabled 408,0)
  loom              176 x 166; the pattern buttons (14 x 14 at 0,166 / 180 /
                    194), the scroller (12 x 15 at 176,0 / 188,0), the red
                    cross (28 x 21 at 176,16)
  cartography_table 176 x 166; the red cross at 176,0, and the marks for
                    what the table does (a copy, zoomed out, locked: 28 x 28
                    at 176,24 / 204,24 / 176,52)

Slot positions are where the game's screens put them. Run with build_gui.py
(which calls this), or on its own:  python tools/leoncraft2/build_stations.py
"""
import os
from PIL import Image
from build_gui import OUT, panel, sunken, arrow, ROWS_INV, FILL, WHITE, SHADE, LINE, SLOT, SLOT_DARK

GHOST = (158, 158, 158, 255)
CLEAR = (0, 0, 0, 0)


def rect(img, x, y, w, h, c):
    px = img.load()
    for j in range(h):
        for i in range(w):
            px[x + i, y + j] = c


def shape(img, x, y, rows, c, ch='#'):
    px = img.load()
    for j, row in enumerate(rows):
        for i, k in enumerate(row):
            if k == ch:
                px[x + i, y + j] = c


def bevel(img, x, y, w, h, base, light, dark, outline=None):
    """A raised box: light along the top and left, dark along the bottom and right."""
    o = 0
    if outline:
        rect(img, x, y, w, 1, outline); rect(img, x, y + h - 1, w, 1, outline)
        rect(img, x, y, 1, h, outline); rect(img, x + w - 1, y, 1, h, outline)
        o = 1
    rect(img, x + o, y + o, w - 2 * o, h - 2 * o, base)
    rect(img, x + o, y + o, w - 2 * o, 1, light); rect(img, x + o, y + o, 1, h - 2 * o, light)
    rect(img, x + o, y + h - 1 - o, w - 2 * o, 1, dark); rect(img, x + w - 1 - o, y + o, 1, h - 2 * o, dark)


def inventory(img, x0=8, y0=84):
    for (x, y, n) in [(x0, y0, 9), (x0, y0 + 18, 9), (x0, y0 + 36, 9), (x0, y0 + 58, 9)]:
        for k in range(n):
            sunken(img, x + 18 * k - 1, y - 1, 18, 18, SLOT)


def slot(img, x, y):
    sunken(img, x - 1, y - 1, 18, 18, SLOT)


def big(img, x, y):
    """A result slot the game draws large (the item at x, y)."""
    sunken(img, x - 5, y - 5, 26, 26, SLOT)


def cross(img, x, y):
    """The red cross over an arrow that has nothing to give (28 x 21)."""
    px = img.load()
    dark, red, light = (60, 0, 0, 255), (200, 20, 20, 255), (255, 90, 90, 255)
    cx, cy = x + 14, y + 10
    for j in range(-7, 8):
        for i in range(-8, 9):
            for s in (1, -1):
                d = i - s * j
                if abs(d) <= 1 and abs(j) <= 7:
                    px[cx + i, cy + j] = red if d != -1 else light
                elif abs(d) == 2 and abs(j) <= 7 and px[cx + i, cy + j] != red and px[cx + i, cy + j] != light:
                    px[cx + i, cy + j] = dark


def hammer(img, x, y):
    """A smith's hammer, head up and to the left (26 x 26)."""
    head = ['....########......', '...##########.....', '..############....', '..############....', '...##########.....', '....###..###......']
    shape(img, x, y + 2, head, (110, 110, 110, 255))
    shape(img, x, y + 2, ['....########......'], (160, 160, 160, 255))
    shape(img, x, y + 2, ['', '', '', '', '...##########.....', '....###..###......'], (70, 70, 70, 255))
    px = img.load()
    for k in range(15):
        hx, hy = x + 8 + k // 2 * 0 + (k * 2) // 3, y + 8 + k
        for d in range(3):
            px[hx + d, hy] = (124, 84, 48, 255) if d < 2 else (82, 54, 30, 255)


def ghost(img, x, y, rows):
    shape(img, x, y, rows, GHOST)


LAPIS = ['', '', '', '.......##.......', '......####......', '.....##..##.....', '....##....##....', '...##......##...', '...##......##...', '....##....##....', '.....##..##.....', '......####......', '.......##.......']
BLAZE = ['', '', '', '......##', '.....####', '....##.##', '....##..##', '...##...##', '...##....##', '..##.....##', '..##......##', '.##.......##', '.###########']
BOTTLE = ['', '.....######', '......#..#', '......#..#', '.....##..##', '....##....##', '...##......##', '...#........#', '...#........#', '...#........#', '...##......##', '....########']


def enchanting_table():
    img = Image.new('RGBA', (256, 256), CLEAR)
    panel(img, 176, 166)
    slot(img, 15, 47); slot(img, 35, 47)
    ghost(img, 35, 47, LAPIS)
    inventory(img)
    # the offers sit in a sunken frame
    sunken(img, 59, 13, 110, 59, SLOT_DARK)
    for y, base, light, dark in [(166, (198, 186, 158, 255), (222, 212, 188, 255), (148, 136, 110, 255)),
                                 (185, (82, 74, 62, 255), (98, 90, 76, 255), (60, 54, 44, 255)),
                                 (204, (150, 104, 138, 255), (182, 140, 170, 255), (110, 72, 100, 255))]:
        bevel(img, 0, y, 108, 19, base, light, dark, (52, 46, 36, 255))
    # the level marks: a green orb with one, two or three strokes; dark when it cannot be taken
    for i in range(3):
        for row, (ring, inner, mark) in ((223, ((40, 96, 10, 255), (128, 230, 40, 255), (230, 255, 200, 255))),
                                         (239, ((40, 40, 36, 255), (92, 92, 84, 255), (150, 150, 140, 255)))):
            ox, oy = 16 * i, row
            for j in range(16):
                for k in range(16):
                    d = ((k - 7.5) ** 2 + (j - 7.5) ** 2) ** 0.5
                    if d <= 6.6:
                        img.putpixel((ox + k, oy + j), ring if d > 5.4 else inner)
            for s in range(i + 1):
                sx = ox + 8 - (i + 1) + s * 2
                for j in range(4, 12):
                    img.putpixel((sx, oy + j), mark)
    save(img, 'enchanting_table')


def anvil():
    img = Image.new('RGBA', (256, 256), CLEAR)
    panel(img, 176, 166)
    hammer(img, 18, 10)
    slot(img, 27, 47); slot(img, 76, 47); slot(img, 134, 47)
    # the plus between the two inputs, the arrow to the result
    shape(img, 54, 49, ['....##....', '....##....', '....##....', '##########', '##########', '....##....', '....##....', '....##....'], SLOT)
    arrow(img, 102, 48, 22, 15)
    inventory(img)
    # the name box: bright edge when it can be typed in, dull when there is nothing to name
    bevel(img, 0, 166, 110, 16, (0, 0, 0, 255), (0, 0, 0, 255), (0, 0, 0, 255), (160, 160, 160, 255))
    bevel(img, 0, 182, 110, 16, (48, 48, 48, 255), (48, 48, 48, 255), (48, 48, 48, 255), (100, 100, 100, 255))
    cross(img, 176, 0)
    save(img, 'anvil')


def grindstone():
    img = Image.new('RGBA', (256, 256), CLEAR)
    panel(img, 176, 166)
    # the stone on its frame, left of the inputs
    px = img.load()
    cx, cy = 28, 36
    for j in range(-12, 13):
        for i in range(-12, 13):
            d = (i * i + j * j) ** 0.5
            if d <= 11.5:
                px[cx + i, cy + j] = (110, 110, 110, 255) if d > 10 else (150, 150, 150, 255) if (i + j) % 5 else (138, 138, 138, 255)
    rect(img, cx - 2, cy - 2, 4, 4, (90, 70, 46, 255))
    for k in range(12):
        px[cx - 9 + k // 3, cy + 10 + k] = (124, 84, 48, 255)
        px[cx + 9 - k // 3, cy + 10 + k] = (124, 84, 48, 255)
    slot(img, 49, 19); slot(img, 49, 40)
    # the two inputs joined, then on to the arrow
    rect(img, 67, 26, 8, 2, SLOT); rect(img, 67, 47, 8, 2, SLOT); rect(img, 73, 26, 2, 23, SLOT); rect(img, 75, 41, 16, 2, SLOT)
    arrow(img, 95, 34, 22, 15)
    slot(img, 129, 34)
    inventory(img)
    cross(img, 176, 0)
    save(img, 'grindstone')


def smithing():
    img = Image.new('RGBA', (256, 256), CLEAR)
    panel(img, 176, 166)
    hammer(img, 12, 12)
    slot(img, 8, 48); slot(img, 26, 48); slot(img, 44, 48); slot(img, 98, 48)
    arrow(img, 68, 49, 22, 15)
    inventory(img)
    cross(img, 176, 0)
    save(img, 'smithing')


def stonecutter():
    img = Image.new('RGBA', (256, 256), CLEAR)
    panel(img, 176, 166)
    slot(img, 20, 33)
    big(img, 143, 33)
    sunken(img, 51, 14, 66, 56, SLOT)
    sunken(img, 118, 14, 14, 56, SLOT_DARK)
    inventory(img)
    # the recipe buttons: plain, chosen, under the mouse
    bevel(img, 0, 166, 16, 18, (198, 198, 198, 255), (255, 255, 255, 255), (120, 120, 120, 255), (0, 0, 0, 255))
    bevel(img, 0, 184, 16, 18, (98, 140, 98, 255), (60, 96, 60, 255), (150, 190, 150, 255), (0, 0, 0, 255))
    bevel(img, 0, 202, 16, 18, (220, 220, 236, 255), (255, 255, 255, 255), (140, 140, 160, 255), (255, 255, 255, 255))
    scrollers(img, 176, 0)
    save(img, 'stonecutter')


def scrollers(img, x, y):
    bevel(img, x, y, 12, 15, (198, 198, 198, 255), (255, 255, 255, 255), (120, 120, 120, 255), (0, 0, 0, 255))
    bevel(img, x + 12, y, 12, 15, (140, 140, 140, 255), (170, 170, 170, 255), (100, 100, 100, 255), (60, 60, 60, 255))


def brewing_stand():
    img = Image.new('RGBA', (256, 256), CLEAR)
    panel(img, 176, 166)
    PIPE, EDGE = (170, 170, 170, 255), (100, 100, 100, 255)

    def pipe(x, y, w, h):
        rect(img, x - 1, y - 1, w + 2, h + 2, EDGE)
        rect(img, x, y, w, h, PIPE)
    # the fuel goes down and along into the bar; the middle pipe down to the bottles
    pipe(24, 35, 2, 12); pipe(24, 45, 34, 2)
    pipe(86, 35, 2, 22)
    pipe(64, 49, 2, 1); pipe(110, 47, 2, 3); pipe(88, 46, 22, 2)
    sunken(img, 59, 43, 20, 6, SLOT_DARK)
    # where the bubbles rise and the arrow fills
    shape(img, 63, 14, ['....##......', '...#..#.....', '....##..##..', '.......#..#.', '..##....##..', '.#..#.......', '..##...##...', '......#..#..', '.......##...'] * 3, GHOST)
    arrow_down(img, 97, 16, 9, 28, SLOT)
    slot(img, 17, 17); slot(img, 79, 17)
    ghost(img, 17, 17, BLAZE)
    for (x, y) in [(56, 51), (79, 58), (102, 51)]:
        slot(img, x, y)
        ghost(img, x, y, BOTTLE)
    inventory(img)
    # the sprites: the arrow filling, the bubbles, the fuel
    arrow_down(img, 176, 0, 9, 28, (255, 255, 255, 255))
    shape(img, 185, 0, ['....##......', '...#..#.....', '....##..##..', '.......#..#.', '..##....##..', '.#..#.......', '..##...##...', '......#..#..', '.......##...'] * 3 + ['..##........', '.#..#.......'], (215, 235, 255, 255))
    for i in range(18):
        t = i / 17
        c = (int(255 - 40 * t), int(200 - 90 * t), int(40 - 20 * t), 255)
        rect(img, 176 + i, 29, 1, 4, c)
    save(img, 'brewing_stand')


def arrow_down(img, x, y, w, h, c):
    px = img.load()
    head = 6
    for j in range(h):
        for i in range(w):
            if j < h - head:
                if 2 <= i <= w - 3:
                    px[x + i, y + j] = c
            else:
                k = j - (h - head)
                if abs(i - (w - 1) / 2) <= (head - k) * (w / 2) / head:
                    px[x + i, y + j] = c


def villager():
    img = Image.new('RGBA', (512, 256), CLEAR)
    panel(img, 276, 166)
    # the trade list (seven buttons of 88 x 20) and its scroll bar
    sunken(img, 4, 17, 90, 142, SLOT)
    sunken(img, 93, 17, 8, 142, SLOT_DARK)
    # paying and getting
    slot(img, 136, 37); slot(img, 162, 37)
    big(img, 220, 37)
    arrow(img, 188, 40, 22, 15)
    inventory(img, 108, 84)
    # the small arrow on each trade, and the sold-out one
    shape(img, 280, 0, ['...#......', '...##.....', '#######...', '########..', '#########.', '########..', '#######...', '...##.....', '...#......'], (230, 230, 230, 255))
    shape(img, 292, 0, ['...#......', '...##.....', '#######...', '########..', '#########.', '########..', '#######...', '...##.....', '...#......'], (110, 110, 110, 255))
    shape(img, 292, 0, ['#.......#.', '.#.....#..', '..#...#...', '...#.#....', '....#.....', '...#.#....', '..#...#...', '.#.....#..', '#.......#.'], (220, 30, 30, 255))
    cross(img, 280, 12)
    # the experience bar: empty, filled, and the part one trade would add
    bevel(img, 280, 40, 102, 5, (40, 40, 40, 255), (24, 24, 24, 255), (64, 64, 64, 255), (0, 0, 0, 255))
    bevel(img, 280, 46, 102, 5, (128, 255, 32, 255), (176, 255, 110, 255), (70, 170, 10, 255), (0, 0, 0, 255))
    bevel(img, 280, 52, 102, 5, (190, 255, 150, 255), (230, 255, 210, 255), (130, 200, 90, 255), (0, 0, 0, 255))
    bevel(img, 400, 0, 6, 27, (198, 198, 198, 255), (255, 255, 255, 255), (120, 120, 120, 255), (0, 0, 0, 255))
    bevel(img, 408, 0, 6, 27, (140, 140, 140, 255), (170, 170, 170, 255), (100, 100, 100, 255), (60, 60, 60, 255))
    save(img, 'villager')


BANNER = ['', '..############', '..############', '...##########', '...##########', '...##########', '...##########', '...##########', '...##########', '...##########', '...##########', '...##########', '...##########', '...##########', '..############', '.......##']
DYE = ['', '', '', '.....####', '....######', '...########', '...########', '...########', '....######', '.....####', '......##', '.....####', '.....####']
PATTERN = ['', '', '...#########', '...#.......#', '...#.#####.#', '...#.#...#.#', '...#.#.#.#.#', '...#.#...#.#', '...#.#####.#', '...#.......#', '...#########']


def loom():
    img = Image.new('RGBA', (256, 256), CLEAR)
    panel(img, 176, 166)
    slot(img, 13, 26); slot(img, 33, 26); slot(img, 23, 45)
    ghost(img, 13, 26, BANNER); ghost(img, 33, 26, DYE); ghost(img, 23, 45, PATTERN)
    big(img, 143, 58)
    # the patterns (4 x 4 of 14 x 14), their scroll bar, the banner's picture
    sunken(img, 59, 12, 58, 58, SLOT)
    sunken(img, 118, 12, 14, 58, SLOT_DARK)
    sunken(img, 138, 7, 26, 46, SLOT_DARK)
    inventory(img)
    bevel(img, 0, 166, 14, 14, (198, 198, 198, 255), (255, 255, 255, 255), (120, 120, 120, 255), (0, 0, 0, 255))
    bevel(img, 0, 180, 14, 14, (98, 140, 98, 255), (60, 96, 60, 255), (150, 190, 150, 255), (0, 0, 0, 255))
    bevel(img, 0, 194, 14, 14, (220, 220, 236, 255), (255, 255, 255, 255), (140, 140, 160, 255), (255, 255, 255, 255))
    scrollers(img, 176, 0)
    cross(img, 176, 16)
    save(img, 'loom')


MAP = ['', '', '..############', '..#..........#', '..#.##..##...#', '..#....##....#', '..#..##...##.#', '..#.....##...#', '..#.##.......#', '..#....###...#', '..#..........#', '..############']
PAPER = ['', '', '...#########', '...#.......#', '...#.#####.#', '...#.......#', '...#.####..#', '...#.......#', '...#.#####.#', '...#.......#', '...#########']


def cartography_table():
    img = Image.new('RGBA', (256, 256), CLEAR)
    panel(img, 176, 166)
    slot(img, 15, 15); slot(img, 15, 52)
    ghost(img, 15, 15, MAP); ghost(img, 15, 52, PAPER)
    big(img, 145, 39)
    # where the map is shown
    sunken(img, 66, 12, 68, 68, SLOT_DARK)
    arrow(img, 37, 38, 22, 15)
    inventory(img)
    cross(img, 176, 0)
    # what it will do: two maps (a copy), a map with a bigger frame (zoomed out), a lock
    px = img.load()
    paper, ink, edge = (232, 224, 196, 255), (120, 100, 70, 255), (70, 56, 40, 255)
    for (ox, oy) in [(176, 24)]:
        for (dx, dy) in [(2, 2), (8, 8)]:
            bevel(img, ox + dx, oy + dy, 18, 18, paper, paper, paper, edge)
            shape(img, ox + dx + 3, oy + dy + 4, ['##..###', '..##...', '#...##.', '.##....'], ink)
    bevel(img, 204 + 1, 24 + 1, 26, 26, paper, paper, paper, edge)
    bevel(img, 204 + 7, 24 + 7, 14, 14, (210, 200, 170, 255), (210, 200, 170, 255), (210, 200, 170, 255), ink)
    bevel(img, 176 + 4, 52 + 4, 20, 20, paper, paper, paper, edge)
    shape(img, 176 + 13, 52 + 9, ['..####..', '.##..##.', '.#....#.', '.#....#.'], (90, 90, 90, 255))
    rect(img, 176 + 12, 52 + 13, 10, 8, (200, 160, 40, 255)); rect(img, 176 + 16, 52 + 15, 2, 3, (80, 60, 10, 255))
    save(img, 'cartography_table')


def save(img, name):
    path = os.path.join(OUT, 'container', name + '.png')
    img.save(path, optimize=True)
    print('wrote', path)


def stations():
    enchanting_table(); anvil(); grindstone(); smithing(); stonecutter(); brewing_stand(); villager(); loom(); cartography_table()


if __name__ == '__main__':
    stations()
