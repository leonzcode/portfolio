"""Leon Clash: write public/clash/CREDITS.md.

For every LPC layer the sprites use (read from build_sprites.PEOPLE), the
generator's CREDITS.csv gives authors and the pages the art came from. Each of
those pages is fetched (curl) and its own "License(s)" field is read, so the
credits say what each page itself says, not only what the generator lists.
The animal sheets, sounds and music are listed with their pages the same way.

  python tools/clash/credits.py
"""
import csv
import importlib.util
import json
import os
import re
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = "D:/code/personal/texture_sources/clash/"
CACHE = SRC + "pages/lpc/"
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "public", "clash", "CREDITS.md"))
ALLOWED = ("CC0", "CC-BY 3.0", "CC-BY 4.0", "CC-BY-SA 3.0", "CC-BY-SA 4.0", "CC-BY")

spec = importlib.util.spec_from_file_location("bs", os.path.join(HERE, "build_sprites.py"))
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)


def used_layers():
    used = set()
    for r in bs.PEOPLE.values():
        P = bs.body_parts(r["body"])
        paths = [P["body"], P["feet"], P["legs"], bs.HEADS[r.get("head", "male")]]
        for key in ("shirt", "overalls", "jacket", "coat", "gloves", "pack"):
            if key == "shirt" and (r.get("coat") or (r.get("jacket") and P.get("jacket") == P.get("shirt"))):
                continue
            if r.get(key) and P.get(key):
                paths.append(P[key])
        if r.get("scarf"):
            paths.append("neck/scarf/")
        if r.get("beard"):
            paths.append("beards/beard/basic/")
        if r.get("hair"):
            paths += bs.HAIRS[r["hair"]]
            if r["hair"] == "pony":
                paths.append("hair/ponytail/adult/bg/")
        if r.get("hat"):
            paths.append(bs.HATS[r["hat"]])
        w = r.get("weapon")
        paths += {"bow": ["weapon/ranged/bow/normal/universal/background/", "weapon/ranged/bow/normal/universal/foreground/"],
                  "spear": ["weapon/polearm/spear/background/", "weapon/polearm/spear/foreground/"],
                  "cane": [P["cane"]], "crossbow": ["weapon/ranged/crossbow/background/", "weapon/ranged/crossbow/foreground/"],
                  "shovel": ["tools/shovel/bg/", "tools/shovel/fg/"]}.get(w, [])
        used.update(paths)
    return sorted(used)


def page_licences(url):
    """the licences an OpenGameArt page lists, or None if it is not such a page"""
    if "opengameart.org/content/" not in url:
        return None
    os.makedirs(CACHE, exist_ok=True)
    fn = CACHE + re.sub(r"[^A-Za-z0-9_-]", "_", url.split("/content/")[1]) + ".html"
    if not os.path.exists(fn) or os.path.getsize(fn) < 1000:
        subprocess.run(["curl", "-s", "-L", "-A", "Mozilla/5.0", "-o", fn, url])
    try:
        h = open(fn, encoding="utf-8", errors="replace").read()
    except OSError:
        return []
    m = re.search(r"field-name-field-art-licenses.*?</div>\s*</div>\s*</div>", h, re.S)
    if not m:
        return []
    txt = " ".join(re.sub(r"<[^>]+>", " ", m.group(0)).split())
    txt = txt.split("License(s):")[-1].replace("&nbsp;", " ").strip()
    found = re.findall(r"(CC0|CC-BY-SA \d\.\d|CC-BY \d\.\d|OGA-BY \d\.\d|GPL \d\.\d|LGPL \d\.\d)", txt)
    return found


def main():
    rows = list(csv.DictReader(open(SRC + "lpc_meta/CREDITS.csv", encoding="utf-8")))
    layers = used_layers()
    out = []
    problems = []
    pages = {}
    for p in layers:
        # only the animations the game uses
        anims = ("walk", "slash", "thrust", "shoot", "spellcast", "hurt")
        hits = [r for r in rows if r["filename"].strip().startswith(p) and r["filename"].strip()[len(p):].split("/")[0].split(".")[0] in anims]
        authors, lic, urls = set(), set(), set()
        for r in hits:
            authors.update(a.strip() for a in r["authors"].split(",") if a.strip())
            lic.update(a.strip() for a in r["licenses"].split(",") if a.strip())
            urls.update(a.strip() for a in r["urls"].split(",") if a.strip() and a.strip().rstrip("/") != "https://opengameart.org/content")
        pick = next((x for x in ("CC-BY-SA 3.0", "CC-BY 3.0", "CC-BY 4.0", "CC-BY", "CC0") if x in lic), None)
        if not pick:
            problems.append(p + ": no allowed licence among " + ", ".join(sorted(lic)))
        for u in urls:
            if u not in pages:
                pages[u] = page_licences(u)
        out.append((p, sorted(authors), pick, sorted(lic), sorted(urls)))
    # pages that list none of the licences we rely on
    for u, l in pages.items():
        if l is not None and not any(x in ALLOWED for x in l):
            problems.append(u + ": page lists " + (", ".join(l) or "nothing readable"))
    json.dump({"pages": pages, "problems": problems}, open(SRC + "lpc_meta/page_check.json", "w"), indent=1)

    md = []
    md.append("# Leon Clash: credits\n")
    md.append("Leon Clash is an original game. Its name, cards, numbers, rules text and interface are its own. "
              "The pictures and sounds below come from openly licensed sources. Each source page was opened and its own "
              "licence field read; where a work offers several licences we use it under the one named here.\n")
    md.append("The character sprite sheet (`assets/atlas0.webp`) is built from the parts below, recoloured and combined "
              "by `tools/clash/build_sprites.py`. Because some of its parts are CC BY-SA 3.0, the combined sprite sheet "
              "is shared under **CC BY-SA 3.0** too (https://creativecommons.org/licenses/by-sa/3.0/).\n")
    md.append("## People: Liberated Pixel Cup (LPC) character parts\n")
    md.append("Taken from the Universal LPC Spritesheet Character Generator "
              "(https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator), whose CREDITS.csv names "
              "the authors and source pages of each part.\n")
    for p, authors, pick, lic, urls in out:
        md.append("### `" + p + "`\n")
        md.append("- Authors: " + ", ".join(authors))
        md.append("- Used under: " + (pick or "NONE") + " (offered: " + ", ".join(lic) + ")")
        for u in urls:
            pl = pages.get(u)
            md.append("- " + u + ("  (page lists: " + ", ".join(pl) + ")" if pl else "  (not an OpenGameArt page)" if pl is None else ""))
        md.append("")
    md.append("## Animals\n")
    for name, url, author, lic, use in [
        ("Polar bear (the Yeti)", "https://opengameart.org/content/lpc-bears-deer-lions-and-more", "tapatilorenzo (and contributors named on the page)", "CC-BY 4.0", "recoloured, scaled"),
        ("Goat (the Mountain Goat)", "https://opengameart.org/content/lpc-goat", "bluecarrot16", "CC-BY 3.0", "tinted"),
        ("Dogs (the St. Bernard and the Huskies)", "https://opengameart.org/content/lpc-cats-and-dogs", "bluecarrot16", "CC-BY 3.0", "recoloured, scaled, attack frames made from walk frames"),
        ("Raven (the Ravens)", "https://opengameart.org/content/lpc-raven-and-seagull", "Reemax", "CC-BY 3.0", "as is"),
        ("White bird (the Snow Owl)", "https://opengameart.org/content/lpc-birds", "bluecarrot16", "CC-BY 4.0", "tinted, outlined, scaled"),
        ("Mouse (the Marmots)", "https://opengameart.org/content/lpc-bears-deer-lions-and-more", "tapatilorenzo (and contributors named on the page)", "CC-BY 4.0", "recoloured, scaled"),
    ]:
        md.append("- **" + name + "**: " + author + ", " + url + ". Used under " + lic + "; " + use + ".")
    md.append("\n## Scenery\n")
    md.append("- **Snowy pine**: WolfMountainGames, https://opengameart.org/content/lpc-snowy-tree. Used under CC-BY-SA 3.0.\n")
    md.append("## Drawn for this game\n")
    md.append("The Snow Golem and Snowlings, the Penguins, the Groomer and the Snowplow, the buildings (Snow Cannon, "
              "Flare Tower, Lift Tower, Cornice, Snow Catapult, Igloo, Snow Fence), the spell pictures, the paraglider's "
              "canopy, the lodges, huts, bridges, stream and field are drawn by code in this repository "
              "(`tools/clash/build_sprites.py`, `public/clash/js/render.js`).\n")
    md.append("## Sound\n")
    md.append("- **Interface Sounds** by Kenney (www.kenney.nl), https://opengameart.org/content/interface-sounds. CC0.")
    md.append("- **RPG Sound Pack** by artisticdude, https://opengameart.org/content/rpg-sound-pack. CC0. (Converted to small mono files.)")
    md.append("- **Mountain Theme Loop** by beardalaxy, https://opengameart.org/content/mountain-theme-loop. CC0. (The music.)\n")
    md.append("## Fonts\n")
    md.append("Alfa Slab One (JM Solé) and Atkinson Hyperlegible (Braille Institute), both SIL Open Font License, loaded from Google Fonts.\n")
    open(OUT, "w", encoding="utf-8").write("\n".join(md))
    print(len(layers), "layers,", len(pages), "pages checked")
    print("problems:", json.dumps(problems, indent=1) if problems else "none")


if __name__ == "__main__":
    main()
