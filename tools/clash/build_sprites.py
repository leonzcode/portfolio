"""Leon Clash: build the sprite atlas, card portraits and scenery.

Sources live outside the repo in D:/code/personal/texture_sources/clash/
(fetched by fetch_lpc.py and by hand from OpenGameArt, see public/clash/CREDITS.md).
Nothing in those folders is run; we only read pixels.

  people   LPC character layers, composited and recoloured into winter outfits
  animals  LPC animal sheets (polar bear, goat, dogs, raven, mouse, bird), recoloured
  the rest drawn here in the same pixel style (snowmen, penguins, vehicles,
           buildings, spell icons)

Writes public/clash/assets/atlas.json and atlas0.webp, atlas1.webp ...

  python tools/clash/build_sprites.py
"""
import json
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw

SRC = "D:/code/personal/texture_sources/clash/"
LPC = SRC + "lpc/"
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "public", "clash", "assets")
OUT = os.path.normpath(OUT)
DIRS = ["up", "left", "down", "right"]          # row order everywhere


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# ---------------------------------------------------------------- recolour
def ramp_colours(base):
    b = np.array(hexrgb(base), dtype=np.float32)
    dark = b * 0.32
    light = b + (255 - b) * 0.5
    return np.stack([dark, b * 0.72, b, b + (light - b) * 0.55, light])


def recolour(img, base, keep_white=False, lift=0.0):
    """map each pixel's brightness onto a ramp of the base colour"""
    a = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb, al = a[..., :3], a[..., 3]
    lum = (rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11) / 255.0
    m = al > 10
    if not m.any():
        return img
    lo, hi = np.percentile(lum[m], 2), np.percentile(lum[m], 98)
    t = np.clip((lum - lo) / max(1e-3, hi - lo) + lift, 0, 1) * 4
    ramp = ramp_colours(base)
    i0 = np.clip(np.floor(t).astype(int), 0, 3)
    f = (t - i0)[..., None]
    out = ramp[i0] * (1 - f) + ramp[i0 + 1] * f
    if keep_white:
        mx, mn = rgb.max(-1), rgb.min(-1)
        white = (mn > 200) & ((mx - mn) < 30)
        out[white] = rgb[white]
    res = np.concatenate([out, al[..., None]], -1)
    return Image.fromarray(np.clip(res, 0, 255).astype(np.uint8), "RGBA")


def skin(img, tone):
    if tone == "light":
        return img
    mul = {"medium": (0.86, 0.72, 0.6), "dark": (0.6, 0.45, 0.36), "tan": (0.95, 0.82, 0.7)}[tone]
    a = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb = a[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    keep = (mn > 200) & ((mx - mn) < 40)               # eye whites stay white
    out = rgb * np.array(mul, dtype=np.float32)
    out[keep] = rgb[keep]
    a[..., :3] = out
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def flame_tip(img):
    """grey metal (low saturation, bright) becomes fire; wood stays wood"""
    a = np.asarray(img.convert("RGBA")).astype(np.float32)
    rgb = a[..., :3]
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1)
    metal = (sat < 0.18) & (mx > 70) & (a[..., 3] > 10)
    lum = mx / 255.0
    fire = np.stack([np.full_like(lum, 255), 120 + lum * 135, lum * 80], -1)
    rgb[metal] = fire[metal]
    a[..., :3] = rgb
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


# ---------------------------------------------------------------- LPC people
ANIM_FILE = {"walk": "walk", "slash": "slash", "thrust": "thrust", "shoot": "shoot", "spell": "spellcast", "hurt": "hurt"}


def lpc_sheet(path, anim):
    f = LPC + path + ANIM_FILE[anim] + ".png"
    if not os.path.exists(f):
        return None
    return Image.open(f).convert("RGBA")


def body_parts(kind):
    """per-body folders for clothes"""
    # only layers whose source pages all list CC BY-SA 3.0, CC BY or CC0 (tools/clash/credits.py checks)
    if kind == "male":
        return dict(body="body/bodies/male/", legs="legs/pants/male/", feet="feet/boots/basic/male/", gloves="arms/hands/gloves/male/",
                    shirt="torso/jacket/collared/male/", overalls="torso/clothes/vest/male/",
                    jacket="torso/jacket/collared/male/", coat="torso/jacket/trench/male/", pack="backpack/backpack/male/", cane="weapon/polearm/cane/male/")
    return dict(body="body/bodies/female/", legs="legs/pants/thin/", feet="feet/boots/basic/thin/", gloves="arms/hands/gloves/thin/",
                shirt="torso/clothes/blouse_longsleeve/female/", overalls=None,
                jacket=None, coat=None, pack="backpack/backpack/female/", cane="weapon/polearm/cane/female/")


HEADS = {"male": "head/heads/human/male/", "female": "head/heads/human/female/", "boy": "head/heads/human/male_small/",
         "girl": "head/heads/human/female_small/", "oldman": "head/heads/human/male_elderly/", "oldwoman": "head/heads/human/female_elderly/"}
HAIRS = {"buzz": ["hair/plain/adult/"], "bangs": ["hair/bangs/adult/"], "long": ["hair/long/adult/"], "messy": ["hair/messy1/adult/"],
         "pony": ["hair/ponytail/adult/fg/"]}
# only layers that can be used under CC BY-SA 3.0 or CC BY (see CREDITS.md)
HATS = {"beanie": "hat/cloth/leather_cap/adult/", "hood": "hat/cloth/hood/adult/"}


def person_layers(r, anim):
    """list of (z, image) for one animation sheet of a recipe"""
    P = body_parts(r["body"])
    L = []

    def add(z, path, colour=None, fn=None, **kw):
        if not path:
            return
        im = lpc_sheet(path, anim)
        if im is None:
            return
        if colour:
            im = recolour(im, colour, **kw)
        if fn:
            im = fn(im)
        L.append((z, im))

    tone = r.get("skin", "light")
    add(10, P["body"], fn=lambda im: skin(im, tone))
    add(25, P["feet"], r.get("boots", "#3a2a20"))
    add(20, P["legs"], r.get("pants", "#3a3f47"))
    if r.get("shirt") and not (r.get("jacket") and P["jacket"] == P["shirt"]) and not (r.get("coat") and P["coat"]):
        add(35, P["shirt"], r["shirt"])
    if r.get("coat") and P["coat"]:
        add(55, P["coat"], r["coat"])
    if r.get("overalls") and P["overalls"]:
        add(45, P["overalls"], r["overalls"])
    if r.get("jacket") and P["jacket"]:
        add(55, P["jacket"], r["jacket"])
    if r.get("gloves"):
        add(70, P["gloves"], r["gloves"])
    if r.get("scarf"):
        add(90, "neck/scarf/", r["scarf"])
    add(100, HEADS[r.get("head", "male")], fn=lambda im: skin(im, tone))
    if r.get("beard"):
        add(110, "beards/beard/basic/", r["beard"])
    if r.get("pack"):
        add(110, P["pack"], r["pack"])
    if r.get("hair"):
        for p in HAIRS[r["hair"]]:
            add(120, p, r.get("hairc", "#5a3a22"))
        if r["hair"] == "pony":
            add(9, "hair/ponytail/adult/bg/", r.get("hairc", "#5a3a22"))
    if r.get("hat"):
        add(130, HATS[r["hat"]], r.get("hatc"))
    w = r.get("weapon")
    if w == "bow":
        add(-1, "weapon/ranged/bow/normal/universal/background/")
        add(140, "weapon/ranged/bow/normal/universal/foreground/")
    elif w == "spear":
        add(9, "weapon/polearm/spear/background/", fn=r.get("wfn"))
        add(140, "weapon/polearm/spear/foreground/", fn=r.get("wfn"))
    elif w == "cane":
        add(140, P["cane"], r.get("wcol"))
    elif w == "crossbow":
        add(-1, "weapon/ranged/crossbow/background/")
        add(140, "weapon/ranged/crossbow/foreground/")
    elif w == "shovel":
        add(9, "tools/shovel/bg/", r.get("wcol"))
        add(150, "tools/shovel/fg/", r.get("wcol"))
    L.sort(key=lambda t: t[0])
    return L


def compose_sheet(r, anim):
    L = person_layers(r, anim)
    if not L:
        return None
    base = L[0][1]
    out = Image.new("RGBA", base.size, (0, 0, 0, 0))
    for _, im in L:
        if im.size != base.size:
            continue
        out.alpha_composite(im)
    return out


def cut(sheet, fw, fh, row, cols):
    return [sheet.crop((c * fw, row * fh, c * fw + fw, row * fh + fh)) for c in cols]


def even(n, k):
    """k frame indices spread over n"""
    if n <= k:
        return list(range(n))
    return [round(i * (n - 1) / (k - 1)) for i in range(k)]


def person(r):
    """frames for walk / attack / death in our row order"""
    out = {}
    walk = compose_sheet(r, "walk")
    out["walk"] = [cut(walk, 64, 64, row, range(1, 9)) for row in range(4)]
    atk = r.get("attack", "slash")
    sh = compose_sheet(r, atk)
    n = sh.size[0] // 64
    cols = even(n, 8)
    out["attack"] = [cut(sh, 64, 64, row, cols) for row in range(4)]
    hurt = compose_sheet(r, "hurt")
    out["death"] = [cut(hurt, 64, 64, 0, range(6))]
    return out, (32, 60)


PEOPLE = {
    "skipatrol": dict(body="male", head="male", hair="buzz", hairc="#4a3020", hat="beanie", hatc="#c62f28", jacket="#c8322b",
                      pants="#2f343c", boots="#1e1e22", gloves="#1e1e22", weapon="shovel", wcol="#9aa4ad", attack="thrust"),
    "kid": dict(body="female", head="girl", hair="pony", hairc="#c98a3a", hat="beanie", hatc="#e85b9a", shirt="#25b0a0",
                pants="#5b3d8f", boots="#40281c", gloves="#f2c94c", scarf="#f2c94c", attack="spell"),
    "biathlete": dict(body="female", head="female", hair="pony", hairc="#e6c36a", hat="beanie", hatc="#f0b429", shirt="#2259b8",
                      pants="#1f2430", boots="#2a1f18", gloves="#1f2430", weapon="bow", attack="shoot"),
    "torch": dict(body="male", head="male", hair="messy", hairc="#2a1c12", hat="hood", hatc="#e07b24", jacket="#e07b24",
                  pants="#3b3029", boots="#2a1f18", gloves="#5a3a22", weapon="spear", wfn=flame_tip, attack="thrust"),
    "porter": dict(body="male", head="male", beard="#6b4423", hair="buzz", hairc="#6b4423", hat="beanie", hatc="#7a5a3a",
                   shirt="#e9e2d0", overalls="#6b4a2e", pants="#4b3a2a", boots="#2a1f18", pack="#8a5a33", attack="slash"),
    "halfpipe": dict(body="female", head="female", hair="bangs", hairc="#1d1b22", hat="beanie", hatc="#a6e22e", shirt="#d6338a",
                     overalls="#24252b", boots="#24252b", gloves="#a6e22e", attack="slash"),
    "glider": dict(body="male", head="male", hair="buzz", hairc="#3a2a1a", hat="beanie", hatc="#3fb3e8", shirt="#f2c230",
                   pants="#2b3a55", boots="#2a1f18", gloves="#2b3a55", attack="spell"),
    "coach": dict(body="male", head="male", hair="buzz", hairc="#1a1410", hat="beanie", hatc="#203a7a", shirt="#d23a32",
                  pants="#203a7a", boots="#e8e8e8", scarf="#ffffff", attack="slash"),
    "keeper": dict(body="male", head="oldman", beard="#9a9a9a", hat="hood", hatc="#7a4a2a", shirt="#b33a2a", overalls="#5a4030",
                   pants="#4a3a2a", boots="#2a1f18", gloves="#7a4a2a", attack="slash"),
    "fisher": dict(body="male", head="male", beard="#b0542a", hair="messy", hairc="#b0542a", hat="beanie", hatc="#2f6b3a",
                   shirt="#8a9096", overalls="#a08a5a", pants="#5a4d3a", boots="#2f6b3a", weapon="cane", wcol="#6b7178", attack="thrust"),
    "sage": dict(body="female", head="oldwoman", hair="long", hairc="#f2f5f8", hat="hood", hatc="#9fd3f2", shirt="#7fb9e0",
                 pants="#dfeef8", boots="#9fd3f2", gloves="#dfeef8", attack="spell"),
    "musher": dict(body="male", head="male", beard="#3a2a1a", hat="hood", hatc="#e9e4dc", coat="#2f5e3e", pants="#3a3530",
                   boots="#2a1f18", gloves="#7a5a3a", attack="slash"),
    "liftie": dict(body="male", head="boy", hair="messy", hairc="#6b4423", hat="beanie", hatc="#ef7d22", shirt="#5d7f9e",
                   pants="#2f343c", boots="#2a1f18", gloves="#ef7d22", attack="slash"),
    "guide": dict(body="male", head="oldman", beard="#e8e8e8", hat="hood", hatc="#2f5e3e", coat="#7a5032", pants="#3b3029",
                  boots="#2a1f18", gloves="#3b3029", weapon="cane", wcol="#8a5a33", attack="thrust"),
    "matriarch": dict(body="female", head="oldwoman", hair="long", hairc="#eef6ff", hat="hood", hatc="#eaf6ff", shirt="#d9ecf8",
                      pants="#b7d9f0", boots="#7fb9e0", gloves="#b7d9f0", scarf="#7fb9e0", attack="spell"),
    "rider": dict(body="female", head="female", hair="bangs", hairc="#d0582a", hat="beanie", hatc="#1d1b22", shirt="#7ad13a",
                  overalls="#6a3fa0", boots="#1d1b22", gloves="#1d1b22", attack="slash"),
    "ranger": dict(body="female", head="female", hair="pony", hairc="#6b4423", hat="hood", hatc="#3f6b3a", shirt="#5a7a3a",
                   pants="#4a3a2a", boots="#2a1f18", gloves="#4a3a2a", weapon="crossbow", attack="thrust"),
    "guard": dict(body="male", head="male", hair="buzz", hairc="#3a2a1a", hat="hood", hatc="#4c5866", shirt="#6b7684",
                  pants="#3b3f47", boots="#2a1f18", gloves="#3b3f47", weapon="bow", attack="shoot"),
}


# ---------------------------------------------------------------- LPC animals
def animal_rows(sheet, fw, fh, spec):
    """spec: {anim: [(row, cols) for up, left, down, right]}"""
    out = {}
    for anim, rows in spec.items():
        out[anim] = []
        for rc in rows:
            if rc is None:
                out[anim].append([])
                continue
            row, cols, *flip = rc
            fr = cut(sheet, fw, fh, row, cols)
            if flip and flip[0]:
                fr = [f.transpose(Image.FLIP_LEFT_RIGHT) for f in fr]
            out[anim].append(fr)
    return out


def tint_rgb(img, mul, add=(0, 0, 0)):
    a = np.asarray(img.convert("RGBA")).astype(np.float32)
    a[..., :3] = a[..., :3] * np.array(mul, dtype=np.float32) + np.array(add, dtype=np.float32)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def map_frames(fr, fn):
    return {k: [[fn(f) for f in row] for row in v] for k, v in fr.items()}


def lunge(row, dx, dy):
    """attack frames from walk frames: lean in on the middle ones"""
    out = []
    n = len(row)
    for i, f in enumerate(row):
        k = math.sin(math.pi * i / max(1, n - 1))
        g = Image.new("RGBA", f.size, (0, 0, 0, 0))
        g.alpha_composite(f, (int(round(dx * k)), int(round(dy * k))))
        out.append(g)
    return out


def fall(f, n=5):
    """a simple fall-over for sheets without a death row"""
    out = []
    for i in range(n):
        k = i / (n - 1)
        g = f.rotate(-80 * k, resample=Image.NEAREST, center=(f.size[0] // 2, f.size[1] - 6))
        a = np.asarray(g).astype(np.float32)
        a[..., 3] *= (1 - 0.5 * k)
        out.append(Image.fromarray(a.astype(np.uint8), "RGBA"))
    return out


def animals():
    S = {}
    bear = Image.open(SRC + "animals2022/unz/bear, polar.png").convert("RGBA")
    fr = animal_rows(bear, 64, 64, {
        "walk": [(0, range(4)), (2, range(5)), (3, range(4)), (1, range(5))],
        "attack": [(4, range(4)), (6, range(3)), (7, range(4)), (5, range(3))],
        "death": [(11, range(4))],
    })
    yeti = lambda im: tint_rgb(im, (0.86, 0.95, 1.06), (0, 4, 14))
    S["yeti"] = (map_frames(fr, lambda im: outline(yeti(im))), (32, 58), 1.55)

    goat = Image.open(SRC + "goat/goat.png").convert("RGBA")
    fr = animal_rows(goat, 128, 128, {
        "walk": [(0, range(4)), (1, range(4)), (2, range(4)), (3, range(4))],
        "attack": [(4, range(4)), (5, range(4)), (6, range(4)), (7, range(4))],
    })
    fr["death"] = [fall(fr["walk"][2][0])]
    S["goat"] = (map_frames(fr, lambda im: tint_rgb(im, (0.95, 0.93, 0.9))), (64, 100), 0.75)

    dog = Image.open(SRC + "dogs/dog_2.png").convert("RGBA")
    def dogset(c0, fn, name, scale):
        fr = animal_rows(dog, 32, 32, {"walk": [(1, range(c0, c0 + 3)), (3, range(c0, c0 + 3)), (2, range(c0, c0 + 3)), (0, range(c0, c0 + 3))]})
        fr["attack"] = [lunge(fr["walk"][0], 0, -3), lunge(fr["walk"][1], -4, 0), lunge(fr["walk"][2], 0, 3), lunge(fr["walk"][3], 4, 0)]
        fr["death"] = [[dog.crop(((c0 + 3) * 32, 0, (c0 + 4) * 32, 32))] * 3]
        S[name] = (map_frames(fr, fn), (16, 29), scale)
    # St. Bernard: the brown dog with a white blaze, bigger
    def bernard(im):
        a = np.asarray(im).astype(np.float32)
        rgb = a[..., :3]
        lum = rgb.mean(-1)
        rgb[...] = np.where((lum > 150)[..., None], rgb, rgb * np.array([1.05, 0.85, 0.7]))
        a[..., :3] = rgb
        return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    dogset(4, bernard, "stbernard", 1.7)
    dogset(0, lambda im: tint_rgb(im, (0.78, 0.84, 0.92)), "husky", 1.25)

    birds = Image.open(SRC + "raven/birds_0.png").convert("RGBA")
    fr = animal_rows(birds, 32, 64, {"walk": [(3, range(3, 6)), (1, range(3, 6)), (0, range(3, 6)), (2, range(3, 6))]})
    fr["attack"] = [lunge(r, 0, 0) for r in fr["walk"]]
    fr["death"] = [fall(fr["walk"][2][0], 4)]
    S["raven"] = (fr, (16, 46), 1.15)

    owl = Image.open(SRC + "birds/bird_1_white.png").convert("RGBA")
    fr = animal_rows(owl, 32, 32, {"walk": [(2, range(3)), (3, range(3)), (1, range(3)), (0, range(3))]})
    fr["attack"] = fr["walk"]
    fr["death"] = [fall(fr["walk"][2][1], 4)]
    owlc = lambda im: outline(tint_rgb(im, (0.97, 0.95, 0.9), (0, 0, 0)))
    S["owl"] = (map_frames(fr, owlc), (16, 26), 2.3)

    mouse = Image.open(SRC + "animals2022/unz/mouse, gray.png").convert("RGBA")
    fr = animal_rows(mouse, 32, 32, {"walk": [(2, range(4)), (1, range(3), True), (3, range(4)), (1, range(3))]})
    fr["attack"] = [lunge(fr["walk"][0], 0, -2), lunge(fr["walk"][1], -3, 0), lunge(fr["walk"][2], 0, 2), lunge(fr["walk"][3], 3, 0)]
    fr["death"] = [fall(fr["walk"][2][0], 4)]
    marmot = lambda im: tint_rgb(im, (1.25, 0.95, 0.62), (14, 4, 0))
    S["marmot"] = (map_frames(fr, marmot), (16, 28), 1.45)
    return S


# ---------------------------------------------------------------- drawn here
OUTL = (28, 34, 44, 255)


def outline(img):
    a = np.asarray(img).copy()
    al = a[..., 3] > 0
    grow = al.copy()
    grow[1:, :] |= al[:-1, :]; grow[:-1, :] |= al[1:, :]; grow[:, 1:] |= al[:, :-1]; grow[:, :-1] |= al[:, 1:]
    edge = grow & ~al
    a[edge] = OUTL
    return Image.fromarray(a, "RGBA")


def canvas(w=64, h=64):
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def ball(d, cx, cy, r, col, shade=None, hi=None):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    if shade:
        d.chord([cx - r, cy - r, cx + r, cy + r], 20, 160, fill=shade)
    if hi:
        d.ellipse([cx - r * 0.55, cy - r * 0.65, cx - r * 0.05, cy - r * 0.2], fill=hi)


SNOW, SNOWS, SNOWH = (236, 244, 250, 255), (180, 204, 224, 255), (255, 255, 255, 255)


def snowman(big, face_dir, bob=0, arm=0.0, crumble=0.0, scarf=(200, 60, 50, 255)):
    im, d = canvas()
    s = 1.0 if big else 0.72
    base = 58
    r1, r2, r3 = 11 * s, 8.5 * s, 6.5 * s
    sq = 1 + 0.06 * bob
    y1 = base - r1 * sq
    y2 = y1 - r1 * 0.75 - r2 + bob * -0.6
    y3 = y2 - r2 * 0.8 - r3 + bob * -1.0
    cx = 32
    off = crumble * 6
    ball(d, cx - off, y1, r1, SNOW, SNOWS, SNOWH)
    if not big:
        y3 = y2 - r2 * 0.75 - r3
        ball(d, cx + off * 0.5, y2, r2, SNOW, SNOWS, SNOWH)
        head_y, hr = y2 - 1, r2
    else:
        ball(d, cx + off * 0.5, y2, r2, SNOW, SNOWS, SNOWH)
        ball(d, cx - off * 0.2, y3 - off, r3, SNOW, SNOWS, SNOWH)
        head_y, hr = y3 - off, r3
    # stick arms
    arm_y = (y2 if big else y1 - r1 * 0.3)
    for side in (-1, 1):
        ang = math.radians(-30 + arm * 60 * (1 if side > 0 else 0.4))
        ax = cx + side * r2 * 0.9
        ex = ax + side * math.cos(ang) * 12 * s
        ey = arm_y - math.sin(ang) * 12 * s
        d.line([ax, arm_y, ex, ey], fill=(110, 72, 40, 255), width=2)
        d.line([ex, ey, ex + side * 3, ey - 3], fill=(110, 72, 40, 255), width=1)
    # scarf
    d.rectangle([cx - hr * 0.9, head_y + hr * 0.75, cx + hr * 0.9, head_y + hr * 0.75 + 2], fill=scarf)
    # face by direction
    if face_dir != "up":
        fx = {"down": 0, "left": -hr * 0.45, "right": hr * 0.45}[face_dir]
        ey = head_y - hr * 0.2
        for ex in ((-2.2, 2.2) if face_dir == "down" else (-1.0, 1.6) if face_dir == "right" else (-1.6, 1.0)):
            d.rectangle([cx + fx + ex - 0.5, ey - 0.5, cx + fx + ex + 0.6, ey + 0.6], fill=(25, 25, 30, 255))
        nx = cx + fx + (0 if face_dir == "down" else (4 if face_dir == "right" else -4))
        d.polygon([(cx + fx, head_y + 0.5), (nx + (0 if face_dir == "down" else 0), head_y + (3 if face_dir == "down" else 1.5)), (cx + fx + 1, head_y + 1.5)], fill=(236, 120, 40, 255))
    if crumble > 0:
        a = np.asarray(im).astype(np.float32)
        a[..., 3] *= (1 - crumble * 0.7)
        im = Image.fromarray(a.astype(np.uint8), "RGBA")
    return outline(im)


def snowmen(big):
    fr = {"walk": [], "attack": [], "death": []}
    for dn in DIRS:
        fr["walk"].append([snowman(big, dn, bob=b) for b in (0, 1, 2, 1, 0, -1, -2, -1)])
        fr["attack"].append([snowman(big, dn, arm=a) for a in (0, 0.3, 0.7, 1.0, 0.6, 0.2)])
    fr["death"].append([snowman(big, "down", crumble=c) for c in (0.1, 0.3, 0.5, 0.7, 0.9)])
    return fr


def penguin_frame(dn, tilt=0.0, slide=0.0, flap=0.0):
    im, d = canvas()
    black, belly, beak = (34, 38, 48, 255), (246, 246, 240, 255), (240, 150, 40, 255)
    if slide > 0:
        # belly slide: lying long
        cy = 52
        if dn in ("left", "right"):
            d.ellipse([18, cy - 6, 46, cy + 6], fill=black)
            d.ellipse([20, cy - 2, 44, cy + 6], fill=belly)
            hx = 46 if dn == "right" else 18
            d.polygon([(hx, cy - 2), (hx + (5 if dn == "right" else -5), cy), (hx, cy + 1)], fill=beak)
        else:
            d.ellipse([24, cy - 12, 40, cy + 8], fill=black)
            d.ellipse([26, cy - 8, 38, cy + 6], fill=belly if dn == "down" else black)
        return outline(im)
    cx, top, bot = 32, 34, 58
    pts = [(cx - 8, bot - 2), (cx - 9, bot - 12), (cx - 6, top + 4), (cx, top), (cx + 6, top + 4), (cx + 9, bot - 12), (cx + 8, bot - 2), (cx, bot)]
    ang = math.radians(tilt * 10)
    rot = lambda p: (cx + (p[0] - cx) * math.cos(ang) - (p[1] - bot) * math.sin(ang), bot + (p[0] - cx) * math.sin(ang) + (p[1] - bot) * math.cos(ang))
    d.polygon([rot(p) for p in pts], fill=black)
    if dn == "down":
        d.ellipse([cx - 6, top + 8, cx + 6, bot - 1], fill=belly)
        d.rectangle([cx - 3, top + 5, cx - 2, top + 6], fill=belly); d.rectangle([cx + 2, top + 5, cx + 3, top + 6], fill=belly)
        d.polygon([(cx - 1.5, top + 8), (cx + 1.5, top + 8), (cx, top + 11)], fill=beak)
    elif dn in ("left", "right"):
        sgn = 1 if dn == "right" else -1
        d.ellipse([cx - 2 + sgn * 2, top + 8, cx + 6 + sgn * 2, bot - 2], fill=belly)
        d.polygon([(cx + sgn * 5, top + 6), (cx + sgn * 11, top + 8), (cx + sgn * 5, top + 9)], fill=beak)
        d.rectangle([cx + sgn * 3, top + 4, cx + sgn * 3 + 1, top + 5], fill=belly)
    for fx in (-4, 3):
        d.rectangle([cx + fx, bot - 1, cx + fx + 2, bot + 1], fill=beak)
    for side in (-1, 1):
        fl = flap * 4
        d.line([cx + side * 8, top + 10, cx + side * (11 + fl), top + 18 - fl], fill=black, width=2)
    return outline(im)


def penguins():
    fr = {"walk": [], "attack": [], "death": []}
    for dn in DIRS:
        fr["walk"].append([penguin_frame(dn, tilt=t, flap=abs(t) * 0.3) for t in (-1, -0.5, 0, 0.5, 1, 0.5, 0, -0.5)])
        fr["attack"].append([penguin_frame(dn, slide=1 if i in (2, 3, 4) else 0, flap=0.6) for i in range(6)])
    fr["death"].append([penguin_frame("down", tilt=k * 6) for k in (0, 0.3, 0.6, 0.8, 1.0)])
    return fr


def vehicle_frame(kind, dn, tread=0, push=0.0):
    im, d = canvas(80, 72)
    body = (214, 64, 40, 255) if kind == "groomer" else (238, 186, 40, 255)
    dark = (40, 40, 46, 255)
    glass = (150, 200, 230, 255)
    blade = (190, 196, 204, 255) if kind == "groomer" else (60, 66, 76, 255)
    cx, by = 40, 62
    if dn in ("left", "right"):
        s = 1 if dn == "right" else -1
        # tracks
        d.rounded_rectangle([cx - 24, by - 12, cx + 24, by], 5, fill=dark)
        for i in range(7):
            x = cx - 22 + ((i * 7 + tread * 3) % 46)
            d.rectangle([x, by - 11, x + 1, by - 1], fill=(80, 80, 88, 255))
        # body and cab
        d.rectangle([cx - 20, by - 26, cx + 18, by - 12], fill=body)
        d.rectangle([cx - 8 * s - 8, by - 40, cx - 8 * s + 10, by - 26], fill=body)
        d.rectangle([cx - 8 * s - 5, by - 37, cx - 8 * s + 7, by - 30], fill=glass)
        # blade at the front
        bx = cx + s * (26 + push * 4)
        d.rectangle([min(bx, bx + s * 4), by - 20, max(bx, bx + s * 4), by - 2], fill=blade)
        d.line([cx + s * 18, by - 14, bx, by - 10], fill=dark, width=2)
        if kind == "groomer":
            tx = cx - s * 26
            d.rectangle([min(tx, tx - s * 6), by - 14, max(tx, tx - s * 6), by - 4], fill=(120, 120, 128, 255))
        d.rectangle([cx - 20, by - 26, cx + 18, by - 24], fill=(255, 255, 255, 120))
    else:
        up = dn == "up"
        d.rectangle([cx - 22, by - 30, cx - 14, by], fill=dark)
        d.rectangle([cx + 14, by - 30, cx + 22, by], fill=dark)
        for i in range(5):
            y = by - 28 + ((i * 6 + tread * 3) % 28)
            d.line([cx - 22, y, cx - 14, y], fill=(80, 80, 88, 255)); d.line([cx + 14, y, cx + 22, y], fill=(80, 80, 88, 255))
        d.rectangle([cx - 14, by - 34, cx + 14, by - 6], fill=body)
        d.rectangle([cx - 10, by - 44, cx + 10, by - 28], fill=body)
        if not up:
            d.rectangle([cx - 8, by - 41, cx + 8, by - 32], fill=glass)
            d.rectangle([cx - 24, by - 6 + push * 3, cx + 24, by + 0 + push * 3], fill=blade)
        else:
            d.rectangle([cx - 7, by - 41, cx + 7, by - 36], fill=(120, 40, 30, 255) if kind == "groomer" else (160, 120, 20, 255))
            if kind == "groomer":
                d.rectangle([cx - 16, by - 2, cx + 16, by + 2], fill=(120, 120, 128, 255))
    # light on the roof
    d.rectangle([cx - 2, by - (46 if dn in ("up", "down") else 42), cx + 2, by - (44 if dn in ("up", "down") else 40)], fill=(255, 190, 60, 255))
    return outline(im)


def vehicles(kind):
    fr = {"walk": [], "attack": [], "death": []}
    for dn in DIRS:
        fr["walk"].append([vehicle_frame(kind, dn, tread=t) for t in range(4)])
        fr["attack"].append([vehicle_frame(kind, dn, tread=t % 4, push=p) for t, p in enumerate((0, 0.4, 1, 1, 0.5, 0))])
    fr["death"].append([vehicle_frame(kind, "down", push=0) for _ in range(3)])
    return fr


def glider():
    """the Paraglider: a person under a canopy"""
    fr, anchor = person(PEOPLE["glider"])
    def canopy(f, t):
        g = Image.new("RGBA", (64, 96), (0, 0, 0, 0))
        g.alpha_composite(f, (0, 32))
        d = ImageDraw.Draw(g)
        cols = [(230, 70, 60, 255), (250, 200, 50, 255), (60, 150, 230, 255)]
        sway = math.sin(t) * 2
        for i in range(3):
            d.pieslice([6 + sway, 2 + i * 0, 58 + sway, 40], 200 + i * 47, 247 + i * 47, fill=cols[i])
        d.chord([6 + sway, 2, 58 + sway, 40], 180, 360, outline=OUTL)
        for lx in (12, 32, 52):
            d.line([lx + sway, 21, 32, 54], fill=(80, 80, 90, 255), width=1)
        return outline(g)
    out = {}
    for k, rows in fr.items():
        out[k] = [[canopy(f, i * 0.8) for i, f in enumerate(row)] for row in rows]
    return out, (32, 92)


# buildings, one direction (cannon gets four)
def building(kind, frame=0, dn="down", fire=0.0):
    im, d = canvas(96, 96)
    cx, by = 48, 86
    wood, wood2, stone = (138, 90, 51, 255), (100, 62, 33, 255), (125, 135, 146, 255)
    if kind == "cannon":
        d.rectangle([cx - 14, by - 12, cx + 14, by], fill=wood2)
        d.rectangle([cx - 12, by - 22, cx + 12, by - 12], fill=stone)
        vec = {"down": (0, 1), "up": (0, -1), "left": (-1, 0), "right": (1, 0)}[dn]
        ln = 20 - fire * 6
        x0, y0 = cx, by - 24
        x1, y1 = x0 + vec[0] * ln, y0 + vec[1] * ln * 0.7 - 6
        d.line([x0, y0, x1, y1], fill=(80, 86, 96, 255), width=9)
        d.line([x0, y0, x1, y1], fill=(170, 178, 188, 255), width=5)
        d.ellipse([cx - 10, by - 34, cx + 10, by - 16], fill=(214, 64, 40, 255))
        if fire > 0.5:
            d.ellipse([x1 - 5, y1 - 5, x1 + 5, y1 + 5], fill=(255, 255, 255, 255))
    elif kind == "flaretower":
        for x in (cx - 12, cx + 10):
            d.rectangle([x, by - 46, x + 2, by], fill=wood2)
        d.line([cx - 12, by - 10, cx + 12, by - 30], fill=wood, width=2); d.line([cx - 12, by - 30, cx + 12, by - 10], fill=wood, width=2)
        d.rectangle([cx - 16, by - 52, cx + 16, by - 44], fill=wood)
        fl = 6 + (frame % 3) * 2 + fire * 6
        d.polygon([(cx - 8, by - 52), (cx, by - 52 - fl * 2), (cx + 8, by - 52)], fill=(255, 150, 50, 255))
        d.polygon([(cx - 4, by - 52), (cx, by - 52 - fl), (cx + 4, by - 52)], fill=(255, 230, 120, 255))
    elif kind == "lifttower":
        d.rectangle([cx - 4, by - 70, cx + 4, by], fill=(110, 118, 130, 255))
        d.rectangle([cx - 26, by - 74, cx + 26, by - 68], fill=(80, 86, 96, 255))
        for wx in (cx - 24, cx + 22):
            d.ellipse([wx - 3, by - 77, wx + 3, by - 71], fill=(50, 50, 56, 255))
        swing = math.sin(frame * 1.2) * 2
        d.line([cx + 20, by - 71, cx + 20 + swing, by - 50], fill=(50, 50, 56, 255), width=1)
        d.rectangle([cx + 13 + swing, by - 50, cx + 27 + swing, by - 44], fill=(60, 120, 200, 255))
        d.rectangle([cx - 14, by - 6, cx + 14, by], fill=stone)
    elif kind == "cornice":
        crack = frame / 3.0
        d.polygon([(cx - 34, by), (cx - 30, by - 22), (cx - 10, by - 38), (cx + 18, by - 42), (cx + 36, by - 30), (cx + 30, by - 18), (cx + 34, by)], fill=SNOW)
        d.polygon([(cx - 30, by - 22), (cx - 10, by - 38), (cx + 18, by - 42), (cx + 36, by - 30), (cx + 10, by - 30)], fill=SNOWH)
        d.polygon([(cx - 34, by), (cx + 34, by), (cx + 30, by - 10), (cx - 30, by - 10)], fill=SNOWS)
        if crack:
            d.line([cx - 6, by - 36, cx, by - 24, cx - 4, by - 14], fill=(120, 150, 180, 255), width=1)
    elif kind == "catapult":
        d.rectangle([cx - 22, by - 14, cx + 22, by - 6], fill=wood2)
        for wx in (cx - 18, cx + 14):
            d.ellipse([wx - 5, by - 10, wx + 5, by], fill=(70, 46, 26, 255))
        d.polygon([(cx - 6, by - 14), (cx, by - 30), (cx + 6, by - 14)], fill=wood)
        ang = math.radians(-120 + fire * 100)
        ex, ey = cx + math.cos(ang) * 30, by - 28 + math.sin(ang) * 30
        d.line([cx, by - 28, ex, ey], fill=wood, width=4)
        if fire < 0.6:
            d.ellipse([ex - 6, ey - 6, ex + 6, ey + 6], fill=SNOW, outline=SNOWS)
    elif kind == "igloo":
        d.pieslice([cx - 34, by - 52, cx + 34, by + 14], 180, 360, fill=SNOW)
        for i, yy in enumerate((by - 12, by - 24, by - 36)):
            w = [34, 30, 20][i]
            d.line([cx - w, yy, cx + w, yy], fill=SNOWS, width=1)
            for k in range(-3, 4):
                x = cx + k * 11 + (5 if i % 2 else 0)
                if abs(x - cx) < w:
                    d.line([x, yy, x, yy + 12], fill=SNOWS, width=1)
        d.pieslice([cx - 10, by - 20, cx + 10, by + 4], 180, 360, fill=(48, 70, 92, 255))
        d.chord([cx - 34, by - 52, cx + 34, by + 14], 200, 260, fill=SNOWH)
    elif kind == "fence":
        for i in range(5):
            x = cx - 32 + i * 16
            d.rectangle([x, by - 30, x + 2, by], fill=(110, 80, 50, 255))
        d.rectangle([cx - 34, by - 26, cx + 34, by - 8], fill=(240, 120, 30, 255))
        for gx in range(cx - 34, cx + 34, 4):
            d.line([gx, by - 26, gx, by - 8], fill=(200, 90, 20, 255))
        for gy in range(by - 26, by - 8, 4):
            d.line([cx - 34, gy, cx + 34, gy], fill=(200, 90, 20, 255))
        d.rectangle([cx - 34, by - 30, cx + 34, by - 26], fill=SNOW)
    return outline(im)


def buildings():
    S = {}
    fr = {"walk": [], "attack": []}
    for dn in DIRS:
        fr["walk"].append([building("cannon", dn=dn)])
        fr["attack"].append([building("cannon", dn=dn, fire=f) for f in (0, 0.2, 0.6, 1.0)])
    S["cannon"] = (fr, (48, 86), 0.9)
    for k, n in (("flaretower", 3), ("lifttower", 4), ("cornice", 1), ("catapult", 1), ("igloo", 1), ("fence", 1)):
        fr = {"walk": [[building(k, frame=i) for i in range(n)]]}
        if k in ("flaretower", "catapult"):
            fr["attack"] = [[building(k, frame=i, fire=f) for i, f in enumerate((0, 0.3, 0.7, 1.0))]]
        S[k] = (fr, (48, 86), {"igloo": 0.95, "fence": 0.8, "cornice": 0.85}.get(k, 0.9))
    return S


# ---------------------------------------------------------------- spell icons (card art)
def spell_icon(sid):
    im, d = canvas(48, 48)
    if sid == "volley":
        for (x, y, r) in ((14, 30, 7), (28, 20, 8), (34, 34, 6), (20, 14, 5)):
            ball(d, x, y, r, SNOW, SNOWS, SNOWH)
    elif sid == "icicles":
        for x, h in ((12, 24), (20, 32), (28, 20), (36, 28)):
            d.polygon([(x - 4, 6), (x + 4, 6), (x, 6 + h)], fill=(190, 230, 250, 255))
            d.line([x - 1, 8, x - 1, 4 + h * 0.6], fill=(255, 255, 255, 255))
        d.rectangle([4, 3, 44, 7], fill=SNOW)
    elif sid == "avalanche":
        d.polygon([(2, 44), (14, 16), (24, 22), (34, 8), (46, 44)], fill=(120, 130, 145, 255))
        d.polygon([(2, 44), (10, 30), (22, 34), (32, 24), (46, 40), (46, 46), (2, 46)], fill=SNOW)
        for (x, y, r) in ((12, 36, 5), (26, 38, 6), (38, 36, 4)):
            ball(d, x, y, r, SNOWH, SNOWS)
    elif sid == "blizzard":
        for i in range(4):
            y = 10 + i * 9
            d.arc([4 + i * 2, y - 6, 40 + i * 2, y + 6], 200, 340, fill=(160, 210, 240, 255), width=3)
        for (x, y) in ((10, 38), (24, 42), (36, 36), (16, 22), (34, 16)):
            d.text((x - 3, y - 6), "*", fill=(255, 255, 255, 255))
    elif sid == "hotsprings":
        d.ellipse([6, 26, 42, 44], fill=(90, 170, 200, 255))
        d.ellipse([10, 28, 38, 40], fill=(140, 210, 230, 255))
        for x in (14, 24, 34):
            d.arc([x - 4, 6, x + 4, 26], 100, 260, fill=(255, 255, 255, 255), width=2)
    elif sid == "freeze":
        d.polygon([(24, 2), (44, 14), (44, 34), (24, 46), (4, 34), (4, 14)], fill=(170, 225, 250, 255))
        d.polygon([(24, 8), (38, 16), (24, 24), (10, 16)], fill=(225, 246, 255, 255))
        for a in range(6):
            r = math.radians(a * 60)
            d.line([24, 26, 24 + math.cos(r) * 12, 26 + math.sin(r) * 12], fill=(255, 255, 255, 255), width=2)
    elif sid == "drop":
        d.ellipse([10, 4, 38, 22], fill=(230, 70, 60, 255)); d.line([24, 22, 24, 30], fill=OUTL)
        ball(d, 24, 38, 7, SNOW, SNOWS, SNOWH); ball(d, 24, 30, 5, SNOW, SNOWS, SNOWH)
    elif sid == "roll":
        ball(d, 28, 26, 16, SNOW, SNOWS, SNOWH)
        d.arc([16, 14, 40, 38], 30, 150, fill=SNOWS, width=2)
        for y in (18, 26, 34):
            d.line([2, y, 10, y], fill=(255, 255, 255, 255), width=2)
    elif sid == "chinook":
        for i, y in enumerate((12, 22, 32)):
            d.arc([4, y - 8, 30 + i * 4, y + 8], 270, 90, fill=(250, 220, 170, 255), width=3)
            d.line([4, y + 8, 44 - i * 4, y + 8], fill=(250, 220, 170, 255), width=3)
    elif sid == "rush":
        d.rectangle([12, 14, 32, 40], fill=(245, 236, 224, 255)); d.arc([28, 18, 40, 32], 270, 90, fill=(245, 236, 224, 255), width=3)
        d.rectangle([14, 16, 30, 22], fill=(110, 60, 34, 255))
        for x in (16, 22, 28):
            d.arc([x - 3, 2, x + 3, 14], 100, 260, fill=(255, 200, 120, 255), width=2)
    elif sid == "icebridge":
        d.rectangle([0, 18, 48, 34], fill=(70, 130, 180, 255))
        d.polygon([(6, 34), (12, 16), (36, 16), (42, 34)], fill=(200, 238, 255, 255))
        for x in (16, 24, 32):
            d.line([x, 18, x - 2, 32], fill=(150, 200, 230, 255))
    elif sid == "rockfall":
        for (x, y, r) in ((14, 30, 9), (30, 18, 8), (34, 36, 7)):
            d.ellipse([x - r, y - r, x + r, y + r], fill=(110, 118, 128, 255))
            d.ellipse([x - r * 0.6, y - r * 0.7, x, y - r * 0.1], fill=(150, 158, 168, 255))
        d.line([6, 4, 12, 16], fill=(255, 255, 255, 255), width=2); d.line([22, 2, 26, 10], fill=(255, 255, 255, 255), width=2)
    return outline(im).resize((96, 96), Image.NEAREST)


# ---------------------------------------------------------------- packing
def trim(f):
    bb = f.getbbox()
    if not bb:
        return f.crop((0, 0, 1, 1)), 0, 0
    return f.crop(bb), bb[0], bb[1]


class Packer:
    def __init__(self, size=2048):
        self.size = size
        self.pages = []
        self.new()

    def new(self):
        self.pages.append(Image.new("RGBA", (self.size, self.size), (0, 0, 0, 0)))
        self.x, self.y, self.row = 1, 1, 0

    def put(self, im):
        w, h = im.size
        if self.x + w + 1 > self.size:
            self.x, self.y, self.row = 1, self.y + self.row + 1, 0
        if self.y + h + 1 > self.size:
            self.new()
        p = len(self.pages) - 1
        self.pages[p].paste(im, (self.x, self.y))
        r = (p, self.x, self.y, w, h)
        self.x += w + 1
        self.row = max(self.row, h)
        return r


def main():
    os.makedirs(OUT, exist_ok=True)
    sprites = {}
    for k, r in PEOPLE.items():
        if k == "glider":
            continue
        fr, anc = person(r)
        sprites[k] = (fr, anc, {"kid": 0.8, "liftie": 0.86}.get(k, 1.0))
    fr, anc = glider()
    sprites["glider"] = (fr, anc, 1.0)
    sprites.update(animals())
    sprites["golem"] = (snowmen(True), (32, 58), 1.6)
    sprites["snowling"] = (snowmen(False), (32, 58), 1.05)
    sprites["penguin"] = (penguins(), (32, 58), 0.9)
    sprites["groomer"] = (vehicles("groomer"), (40, 64), 1.15)
    sprites["plow"] = (vehicles("plow"), (40, 64), 1.05)
    sprites.update(buildings())

    # all frames, tallest first so shelves pack tight
    items = []
    for name, (fr, anc, sc) in sprites.items():
        for anim, rows in fr.items():
            for ri, row in enumerate(rows):
                for fi, f in enumerate(row):
                    t, ox, oy = trim(f)
                    items.append((t.size[1], name, anim, ri, fi, t, ox, oy))
    # card portraits and scenery go in too
    cells = {}
    for c in json.loads(CARDS_JSON):
        cells[c["id"]] = portrait(c, sprites)
    env = scenery()
    items.sort(key=lambda t: -t[0])
    pk = Packer(2048)
    meta = {"images": [], "sprites": {}}
    for _, name, anim, ri, fi, t, ox, oy in items:
        p, x, y, w, h = pk.put(t)
        fr, anc, sc = sprites[name]
        S = meta["sprites"].setdefault(name, {"ax": anc[0], "ay": anc[1], "scale": sc, "img": 0, "anims": {}})
        A = S["anims"].setdefault(anim, {"f": [[] for _ in fr[anim]]})
        A["f"][ri].append([x, y, w, h, ox, oy, p])
    # sprites must sit on one page each: check
    for name, S in meta["sprites"].items():
        pass
    cmeta = {}
    for cid, im in cells.items():
        p, x, y, w, h = pk.put(im)
        cmeta[cid] = [x, y, w, h, p]
    emeta = {}
    for en, im in env.items():
        p, x, y, w, h = pk.put(im)
        emeta[en] = [x, y, w, h, p]
    npages = len(pk.pages)
    for i, pg in enumerate(pk.pages):
        bb = pg.getbbox()
        if bb:
            pg = pg.crop((0, 0, 2048, bb[3] + 1))
        fn = "atlas%d.webp" % i
        pg.save(os.path.join(OUT, fn), "WEBP", lossless=True, method=6, quality=100)
        meta["images"].append(fn)
    meta["cards"] = {"cells": cmeta}
    meta["env"] = {"cells": emeta}
    # height of each sprite standing, for bars
    for name, S in meta["sprites"].items():
        w = S["anims"]["walk"]["f"]
        row = w[2] if len(w) > 2 and w[2] else w[0]
        f = row[0]
        S["h"] = S["ay"] - f[5]
    # every sprite on one page? (renderer assumes it)
    pages = {}
    for _, name, anim, ri, fi, t, ox, oy in items:
        pass
    with open(os.path.join(OUT, "atlas.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    print("pages", npages, "sprites", len(meta["sprites"]), "cards", len(cmeta))


def portrait(c, sprites):
    """96 x 96 card art: the body scaled up, or a drawn icon for spells"""
    if c["type"] == "spell":
        return spell_icon(c["id"])
    key = c["unit"]
    fr, anc, sc = sprites[key]
    rows = fr["walk"]
    side = key in ("yeti", "goat", "stbernard", "husky", "marmot", "groomer", "plow", "musher", "cannon")
    f = (rows[3] if side and len(rows) > 3 and rows[3] else rows[2] if len(rows) > 2 and rows[2] else rows[0])[0]
    t, _, _ = trim(f)
    w, h = t.size
    k = min(84 / h, 84 / w)
    k = max(1, int(k)) if k >= 1 else k
    im = t.resize((max(1, int(w * k)), max(1, int(h * k))), Image.NEAREST)
    out = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    out.alpha_composite(im, ((96 - im.size[0]) // 2, 94 - im.size[1]))
    if c.get("count", 1) > 1:
        # a second one behind, smaller, so groups read as groups
        sm = t.resize((max(1, int(w * k * 0.7)), max(1, int(h * k * 0.7))), Image.NEAREST)
        a = np.asarray(sm).astype(np.float32); a[..., :3] *= 0.85
        sm = Image.fromarray(a.astype(np.uint8), "RGBA")
        back = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
        back.alpha_composite(sm, (max(0, 96 - sm.size[0] - 2), 90 - sm.size[1]))
        back.alpha_composite(out)
        out = back
    return out


def scenery():
    env = {}
    trees = Image.open(SRC + "snowtrees/LPCsnowTrees.png").convert("RGBA")
    t = trees.crop((0, 0, 96, 128)).getbbox()
    env["pine"] = trees.crop((0, 0, 96, 128)).crop(t)
    seas = Image.open(SRC + "seasoned/LPCSeasonedTrees.png").convert("RGBA")
    return env


CARDS_JSON = "[]"

if __name__ == "__main__":
    import subprocess
    # card list from cards.js through node, so the two never drift
    js = os.path.join(os.path.dirname(__file__), "..", "..", "public", "clash", "js", "cards.js")
    code = "require(process.argv[1]); const D = globalThis.LeonClashCards; console.log(JSON.stringify(D.CARDS.map(c => ({id: c.id, type: c.type, unit: c.unit, count: c.count || 1}))));"
    CARDS_JSON = subprocess.run(["node", "-e", code, os.path.normpath(js)], capture_output=True, text=True).stdout
    main()
