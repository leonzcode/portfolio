"""
Leoncraft 2 - the grey widgets.

Pixel Perfection's GUI sheet has gold-framed buttons; the classic block game's
are grey, with a black outline that turns white under the mouse. This draws
our own grey set (our own pixels, no game files) over the parts of
textures/gui/widgets.png the game uses, keeping the sheet's layout so the
GUI code cuts them the same way:

  hotbar      0, 0, 182 x 22      selector   0, 22, 24 x 24
  buttons     0, 46 disabled / 66 normal / 86 hover, 200 x 20
  language    0, 106 normal / 126 hover, 20 x 20 (a globe on a button)

and textures/gui/accessibility.png (20 x 40, a figure on a button), then the
work blocks' screens (build_stations.py).

It also draws the container screens (inventory, crafting table, furnaces,
chests, dispenser, hopper, shulker box, crafter, a mount's) in the classic light grey: a panel
of 198 grey with a black rounded outline, a two-pixel white bevel along the
top and left and a dark one along the bottom and right, and sunken slots.
Only the slot positions follow the game's screens (they are where its
screens put them, the same layout every inventory mod expects); the pixels
are drawn here. Everything to the right of and below the panel in each
sheet (the progress arrows and flames, the recipe book button) is kept.

Run:  python tools/leoncraft2/build_gui.py
"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'leoncraft2', 'textures', 'gui')


def noise(x, y, seed=0):
    h = (x * 374761393 + y * 668265263 + seed * 2147483647) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 255) / 255.0


def button(img, ox, oy, w, h, state):
    """state 0 disabled, 1 normal, 2 hover"""
    px = img.load()
    for y in range(h):
        for x in range(w):
            edge = x == 0 or y == 0 or x == w - 1 or y == h - 1
            if edge:
                c = (255, 255, 255) if state == 2 else (0, 0, 0)
                # the corners stay dark, as on the game's buttons
                if (x in (0, w - 1)) and (y in (0, h - 1)):
                    c = (0, 0, 0) if state != 2 else (160, 160, 160)
                px[ox + x, oy + y] = c + (255,)
                continue
            if state == 0:
                v = 44 + int(noise(x, y, 3) * 6)
                px[ox + x, oy + y] = (v, v, v, 255)
                continue
            base = 112 if state == 1 else 120
            v = base + int((noise(x, y, 7) - 0.5) * 14)
            if y == 1: v = 168 + int(noise(x, y, 5) * 8)                  # the lit top edge
            elif x == 1: v = 140
            elif y >= h - 3: v = 76 if y == h - 3 else 58                  # the shaded bottom
            elif x == w - 2: v = 84
            px[ox + x, oy + y] = (v, v, v, 255)


def globe(img, ox, oy, light):
    px = img.load()
    c = (230, 230, 230, 255) if light else (205, 205, 205, 255)
    d = (90, 90, 90, 255)
    cx, cy, r = 9.5, 9.5, 5.6
    for y in range(20):
        for x in range(20):
            dx, dy = x - cx, y - cy
            dd = (dx * dx + dy * dy) ** 0.5
            if abs(dd - r) < 0.55:
                px[ox + x, oy + y] = c
            elif dd < r - 0.5:
                # the lines of longitude and latitude
                if abs(dx) < 0.6 or abs(dy) < 0.6 or abs(abs(dx) - r * 0.55) < 0.5 and abs(dy) < r * 0.8:
                    px[ox + x, oy + y] = c
                else:
                    px[ox + x, oy + y] = d


def figure(img, ox, oy, light):
    px = img.load()
    c = (230, 230, 230, 255) if light else (205, 205, 205, 255)
    pts = set()
    for x in range(9, 11):
        for y in range(4, 6): pts.add((x, y))           # head
    for x in range(5, 15): pts.add((x, 7))               # arms
    for x in range(9, 11):
        for y in range(7, 12): pts.add((x, y))           # body
    for i in range(4):
        pts.add((8 - i // 2, 12 + i)); pts.add((11 + i // 2, 12 + i))   # legs
    for (x, y) in pts: px[ox + x, oy + y] = c


def hotbar(img):
    px = img.load()
    for y in range(22):
        for x in range(182):
            px[x, y] = (0, 0, 0, 0)
    for y in range(22):
        for x in range(182):
            if x == 0 or y == 0 or x == 181 or y == 21:
                px[x, y] = (0, 0, 0, 200)
                continue
            i = (x - 1) // 20
            sx, sy = (x - 1) - i * 20, y - 1
            if sx in (0, 19) or sy in (0, 19):
                light = sx == 0 or sy == 0
                px[x, y] = (150, 150, 150, 220) if light else (52, 52, 52, 220)
            else:
                px[x, y] = (24, 24, 24, 120)


def selector(img):
    px = img.load()
    for y in range(24):
        for x in range(24):
            px[x, 22 + y] = (0, 0, 0, 0)
            ring = min(x, y, 23 - x, 23 - y)
            if ring == 0: px[x, 22 + y] = (0, 0, 0, 255)
            elif ring in (1, 2): px[x, 22 + y] = (232, 232, 232, 255) if ring == 1 else (198, 198, 198, 255)
            elif ring == 3: px[x, 22 + y] = (0, 0, 0, 150)


FILL, WHITE, SHADE, LINE = (198, 198, 198, 255), (255, 255, 255, 255), (85, 85, 85, 255), (0, 0, 0, 255)
SLOT, SLOT_DARK = (139, 139, 139, 255), (55, 55, 55, 255)
# per screen: panel size, rows of slots (x of the first, y, how many; x and y where the item sits),
# big result slots, dark boxes (the player's picture), and arrows/flame outlines
ROWS_INV = [(8, 84, 9), (8, 102, 9), (8, 120, 9), (8, 142, 9)]
CONTAINERS = {
    'inventory': ((176, 166), [(8, 8, 1), (8, 26, 1), (8, 44, 1), (8, 62, 1), (77, 62, 1), (98, 18, 2), (98, 36, 2), (154, 28, 1)] + ROWS_INV,
                  [], [(26, 8, 49, 70)], [('arrow', 135, 29, 16, 13)]),
    'crafting_table': ((176, 166), [(30, 17, 3), (30, 35, 3), (30, 53, 3)] + ROWS_INV, [(120, 31)], [], [('arrow', 90, 35, 22, 15)]),
    'furnace': ((176, 166), [(56, 17, 1), (56, 53, 1)] + ROWS_INV, [(112, 31)], [], [('arrow', 80, 35, 22, 15), ('flame', 56, 36, 14, 14)]),
    'generic_54': ((176, 222), [(8, 18 + 18 * r, 9) for r in range(6)] + [(8, 140, 9), (8, 158, 9), (8, 176, 9), (8, 198, 9)], [], [], []),
    'dispenser': ((176, 166), [(62, 17, 3), (62, 35, 3), (62, 53, 3)] + ROWS_INV, [], [], []),
    'hopper': ((176, 133), [(44, 20, 5), (8, 51, 9), (8, 69, 9), (8, 87, 9), (8, 109, 9)], [], [], []),
    'shulker_box': ((176, 166), [(8, 18, 9), (8, 36, 9), (8, 54, 9)] + ROWS_INV, [], [], []),
    'crafter': ((176, 166), [(26, 17, 3), (26, 35, 3), (26, 53, 3)] + ROWS_INV, [(130, 31)], [], [('arrow', 93, 35, 22, 15)]),
}
CONTAINERS['blast_furnace'] = CONTAINERS['smoker'] = CONTAINERS['furnace']


def panel(img, w, h):
    """The rounded light grey panel with its bevels, at 0, 0."""
    px = img.load()
    cut = lambda x, y: (x + y < 2) or ((w - 1 - x) + y < 3) or (x + (h - 1 - y) < 3) or ((w - 1 - x) + (h - 1 - y) < 3)
    for y in range(h):
        for x in range(w):
            if cut(x, y):
                px[x, y] = (0, 0, 0, 0)
                continue
            edge = any(cut(x + dx, y + dy) or not (0 <= x + dx < w and 0 <= y + dy < h) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge:
                px[x, y] = LINE
                continue
            top = y <= 2 or x <= 2 or (x == 3 and y == 3)
            bot = y >= h - 3 or x >= w - 3 or (x == w - 4 and y == h - 4)
            px[x, y] = FILL if (top and bot) else WHITE if top else SHADE if bot else FILL


def sunken(img, x, y, w, h, inside):
    """A sunken box (a slot is 18 x 18): dark top and left, white bottom and right."""
    px = img.load()
    for j in range(h):
        for i in range(w):
            if (i == w - 1 and j == 0) or (i == 0 and j == h - 1):
                c = SLOT
            elif j == 0 or i == 0:
                c = SLOT_DARK
            elif j == h - 1 or i == w - 1:
                c = WHITE
            else:
                c = inside
            px[x + i, y + j] = c


def arrow(img, x, y, w, h):
    """An empty progress arrow pointing right, in slot grey."""
    px = img.load()
    head = (h + 1) // 2
    shaft = max(3, h // 3)
    for j in range(h):
        for i in range(w):
            in_shaft = i < w - head and abs(j - (h - 1) / 2) <= shaft / 2
            k = i - (w - head)
            in_head = k >= 0 and abs(j - (h - 1) / 2) <= (head - k) * (h / 2) / head
            if in_shaft or in_head:
                px[x + i, y + j] = SLOT


def flame(img, x, y, w, h):
    """The empty fuel flame's outline, in slot grey."""
    px = img.load()
    shape = ['......##......', '.....####.....', '.....####.....', '....######....', '...##.##.##...', '..##..##..##..', '..##.####.##..',
             '.##.##..##.##.', '.##.#....#.##.', '.##.#....#.##.', '.##..#..#..##.', '..##..##..##..', '...##....##...', '....######....']
    for j, row in enumerate(shape[:h]):
        for i, ch in enumerate(row[:w]):
            if ch == '#':
                px[x + i, y + j] = SLOT


def containers():
    for name, ((w, h), rows, big, dark, marks) in CONTAINERS.items():
        path = os.path.join(OUT, 'container', name + '.png')
        img = Image.open(path).convert('RGBA') if os.path.exists(path) else Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        if img.size != (256, 256):
            full = Image.new('RGBA', (256, 256), (0, 0, 0, 0)); full.paste(img, (0, 0)); img = full
        # the panel's own area is drawn fresh; the sprites beside and below it stay
        for yy in range(h):
            for xx in range(w):
                img.putpixel((xx, yy), (0, 0, 0, 0))
        panel(img, w, h)
        for (x0, y, n) in rows:
            for k in range(n):
                sunken(img, x0 + 18 * k - 1, y - 1, 18, 18, SLOT)
        for (x, y) in big:
            sunken(img, x - 1, y - 1, 26, 26, SLOT)
        for (x, y, bw, bh) in dark:
            sunken(img, x - 1, y - 1, bw + 2, bh + 2, LINE)
        for kind, x, y, bw, bh in marks:
            (arrow if kind == 'arrow' else flame)(img, x, y, bw, bh)
        img.save(path, optimize=True)
        print('wrote', path)


def horse():
    """The screen of a horse, donkey, mule, llama or camel: the saddle and armour slots, the black box the
    animal stands in, the player's rows, and one slot below the panel (0, 166) that the screen draws for
    each of a chest's slots (a llama's chest has as many columns as its strength)."""
    path = os.path.join(OUT, 'container', 'horse.png')
    img = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    panel(img, 176, 166)
    for (x0, y, n) in [(8, 18, 1), (8, 36, 1)] + ROWS_INV:
        for k in range(n):
            sunken(img, x0 + 18 * k - 1, y - 1, 18, 18, SLOT)
    sunken(img, 25, 17, 54, 54, LINE)
    sunken(img, 0, 166, 18, 18, SLOT)
    img.save(path, optimize=True)
    print('wrote', path)


def main():
    containers()
    horse()
    path = os.path.join(OUT, 'widgets.png')
    img = Image.open(path).convert('RGBA')
    # clear what we redraw, then draw it
    for y in range(0, 146):
        for x in range(0, 200 if y >= 46 else 182 if y < 22 else 24):
            img.putpixel((x, y), (0, 0, 0, 0))
    hotbar(img)
    selector(img)
    for s in range(3):
        button(img, 0, 46 + s * 20, 200, 20, s)
    for s in range(2):
        button(img, 0, 106 + s * 20, 20, 20, 1 + s)
        globe(img, 0, 106 + s * 20, s == 1)
    img.save(path, optimize=True)
    acc = Image.new('RGBA', (20, 40), (0, 0, 0, 0))
    for s in range(2):
        button(acc, 0, s * 20, 20, 20, 1 + s)
        figure(acc, 0, s * 20, s == 1)
    acc.save(os.path.join(OUT, 'accessibility.png'), optimize=True)
    print('wrote', path)
    # the work blocks' screens (enchanting table, anvil, villager...)
    from build_stations import stations
    stations()


if __name__ == '__main__':
    main()
