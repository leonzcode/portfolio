"""Leon Clash: download the LPC character layers the sprites are built from.

The Universal LPC Spritesheet Character Generator repository keeps each layer as
spritesheets/<path><anim>.png, or <path><anim>/<colour>.png for layers that come
in colours. Files land in D:/code/personal/texture_sources/clash/lpc/ (outside the
repo). Nothing downloaded is ever run. Uses curl (this machine's Python has an old
certificate store).

  python tools/clash/fetch_lpc.py
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

SRC = "D:/code/personal/texture_sources/clash/lpc/"
RAW = "https://raw.githubusercontent.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator/master/spritesheets/"
ANIMS = ["walk", "slash", "thrust", "shoot", "spellcast", "hurt"]

# (path prefix, colour folders to try when there is no plain file)
LAYERS = [
    ("body/bodies/male/", []), ("body/bodies/female/", []), ("body/bodies/teen/", []),
    ("head/heads/human/male/", []), ("head/heads/human/female/", []),
    ("head/heads/human/male_small/", []), ("head/heads/human/female_small/", []),
    ("head/heads/human/male_elderly/", []), ("head/heads/human/female_elderly/", []),
    ("hair/buzzcut/adult/", []), ("hair/bangs/adult/", []), ("hair/long/adult/", []),
    ("hair/messy1/adult/", []), ("hair/ponytail/adult/fg/", []), ("hair/ponytail/adult/bg/", []),
    ("beards/beard/basic/", []),
    ("hat/holiday/christmas/adult/", ["gray", "white", "blue"]),
    ("hat/cloth/hood/adult/", ["gray", "white", "brown"]),
    ("hat/formal/tiara/adult/", ["tiara_silver", "silver"]),
    ("neck/scarf/", ["gray", "white", "red"]),
    ("torso/clothes/longsleeve/longsleeve/male/", ["white", "gray"]),
    ("torso/clothes/longsleeve/longsleeve/female/", ["white", "gray"]),
    ("torso/clothes/longsleeve/longsleeve/teen/", ["white", "gray"]),
    ("torso/jacket/collared/male/", ["gray", "blue"]),
    ("torso/aprons/overalls/male/", ["gray", "white"]),
    ("torso/aprons/overalls/female/", ["gray", "white"]),
    ("torso/aprons/overalls/teen/", ["gray", "white"]),
    ("legs/pants/male/", ["white", "gray"]), ("legs/pants/thin/", ["white", "gray"]),
    ("feet/boots/basic/male/", ["brown", "gray"]), ("feet/boots/basic/thin/", ["brown", "gray"]),
    ("arms/hands/gloves/male/", ["gray", "white", "brown"]), ("arms/hands/gloves/thin/", ["gray", "white", "brown"]),
    ("backpack/backpack/male/", ["gray", "leather"]), ("backpack/backpack/female/", ["gray", "leather"]),
    ("weapon/ranged/bow/normal/universal/background/", ["medium", "light"]),
    ("weapon/ranged/bow/normal/universal/foreground/", ["medium", "light"]),
    ("weapon/polearm/spear/foreground/", ["medium", "light"]), ("weapon/polearm/spear/background/", ["medium", "light"]),
    ("weapon/polearm/cane/male/", ["cane"]), ("weapon/polearm/cane/female/", ["cane"]),
    ("weapon/ranged/crossbow/background/", ["crossbow"]), ("weapon/ranged/crossbow/foreground/", ["crossbow"]),
    ("tools/shovel/bg/", []), ("tools/shovel/fg/", []),
    # replacements whose licences include CC BY-SA 3.0 (the beanie, overalls,
    # teen long sleeves and buzz cut are GPL / OGA-BY only, so they are not used)
    ("hat/cloth/leather_cap/adult/", ["gray", "white", "base"]),
    ("hair/plain/adult/", []),
    ("torso/armour/leather/teen/", ["gray", "white", "leather"]),
    ("torso/clothes/vest/male/", ["gray", "white", "tan"]),
    # tops whose cited pages all list an allowed licence
    ("torso/clothes/blouse_longsleeve/female/", ["white", "gray"]),
    ("torso/jacket/trench/male/", ["gray", "white", "tan"]),
]


def get(url, out):
    r = subprocess.run(["curl", "-s", "-f", "-o", out, url], capture_output=True)
    return r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0


def job(arg):
    prefix, colours, anim = arg
    out = SRC + prefix + anim + ".png"
    if os.path.exists(out):
        return (prefix, anim, "have")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if get(RAW + prefix + anim + ".png", out):
        return (prefix, anim, "plain")
    for c in colours:
        if get(RAW + prefix + anim + "/" + c + ".png", out):
            return (prefix, anim, c)
    if os.path.exists(out):
        os.remove(out)
    return (prefix, anim, None)


def main():
    jobs = [(p, c, a) for p, c in LAYERS for a in ANIMS]
    with ThreadPoolExecutor(12) as ex:
        res = list(ex.map(job, jobs))
    got = {}
    for p, a, how in res:
        got.setdefault(p, []).append(a + ("" if how else "-"))
    for p in sorted(got):
        print(p, " ".join(got[p]))
    with open(SRC + "fetched.txt", "w") as f:
        for p, a, how in res:
            f.write("%s\t%s\t%s\n" % (p, a, how))


if __name__ == "__main__":
    main()
