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

and textures/gui/accessibility.png (20 x 40, a figure on a button).

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


def main():
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


if __name__ == '__main__':
    main()
