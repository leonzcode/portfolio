"""
Leoncraft 2 - the status effect pictures, in the newer style the game draws
them (one small picture each, 18 x 18, a coloured shape with a dark outline
on a clear background), on one sheet.

The shapes are Pixel Perfection Legacy's (Nova_Wostra, CC BY-SA 4.0: the
mob_effect folder of https://github.com/NovaWostra/Pixel-Perfection-Chorus-Eddit),
checked against the game's 26.1 pictures before use (October 2026): none of
them shares a pixel with the game's, and the fine detail of none follows the
game's (high-pass correlation at most 0.27, a copy or a trace is near 1).
Pixel Perfection CE's conduit power, instant health, instant damage and
saturation pictures are the game's own, so CE's set is not used at all.

The pack draws each one as a dark sign on a coloured tile, the older look.
Here the tile goes: the sign is taken out of it (the pixels that differ from
the tile's own colour, and the holes it closes round), filled with the
effect's own colour from js/effects.js (lightened when it is too dark to read),
lit along its top and left, shaded along its bottom and right, its holes a
pale tint, and given a one pixel outline in a dark shade of the same colour.

The sheet is textures/gui/mob_effect.png, eight pictures to a row in the
order of EFFECT_SHEET in js/effects.js (keep the two lists the same).

Run:  python tools/leoncraft2/build_effects.py <Pixel-Perfection-Chorus-Eddit root>
"""
import os
import sys
from PIL import Image

ORDER = [
    'speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost',
    'nausea', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision',
    'hunger', 'weakness', 'poison', 'wither', 'health_boost', 'absorption', 'saturation', 'glowing',
    'levitation', 'luck', 'unluck', 'slow_falling', 'conduit_power', 'dolphins_grace', 'bad_omen', 'hero_of_the_village',
    'darkness', 'trial_omen', 'raid_omen', 'wind_charged', 'weaving', 'oozing', 'infested', 'breath_of_the_nautilus',
]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'leoncraft2', 'textures', 'gui', 'mob_effect.png')


# the game's effect colours (js/effects.js EFFECTS), for the fill
COLOUR = {
    'speed': 0x33EBFF, 'slowness': 0x8BAFE0, 'haste': 0xD9C043, 'mining_fatigue': 0x4A4217, 'strength': 0xFFC700,
    'instant_health': 0xF82423, 'instant_damage': 0xA9656A, 'jump_boost': 0xFDFF84, 'nausea': 0x551D4A,
    'regeneration': 0xCD5CAB, 'resistance': 0x9146F0, 'fire_resistance': 0xFF9900, 'water_breathing': 0x98DAC0,
    'invisibility': 0xF6F6F6, 'blindness': 0x1F1F23, 'night_vision': 0xC2FF66, 'hunger': 0x587653, 'weakness': 0x484D48,
    'poison': 0x87A363, 'wither': 0x736156, 'health_boost': 0xF87D23, 'absorption': 0x2552A5, 'saturation': 0xF82423,
    'glowing': 0x94A061, 'levitation': 0xCEFFFF, 'luck': 0x59C106, 'unluck': 0xC0A44D, 'slow_falling': 0xF3CFB9,
    'conduit_power': 0x1DC2D1, 'dolphins_grace': 0x88A3BE, 'bad_omen': 0x0B6138, 'hero_of_the_village': 0x44FF44,
    'darkness': 0x292721, 'trial_omen': 0x16A6A6, 'raid_omen': 0xDE4058, 'wind_charged': 0xBDC9FF, 'weaving': 0x78695A,
    'oozing': 0x99FFA3, 'infested': 0x8C9B8C, 'breath_of_the_nautilus': 0x1DC2D1,
}


def rgb(c):
    return ((c >> 16) & 255, (c >> 8) & 255, c & 255)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def lum(c):
    return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255


def glyph(tile, colour):
    """the sign on a pack tile (16 x 16, a frame round a coloured square) as an 18 x 18 picture of ours"""
    px = tile.load()
    inner = [(x, y) for y in range(1, 15) for x in range(1, 15)]
    # the tile's colour: the commonest inside the frame
    count = {}
    for p in inner:
        c = px[p][:3]
        count[c] = count.get(c, 0) + 1
    bg = max(count, key=count.get)
    far = lambda c: sum(abs(c[i] - bg[i]) for i in range(3)) > 36
    sign = {p for p in inner if far(px[p][:3])}
    # holes: tile-coloured pixels the sign closes round (not reachable from the frame)
    seen, todo = set(), [p for p in inner if (p[0] in (1, 14) or p[1] in (1, 14)) and p not in sign]
    while todo:
        p = todo.pop()
        if p in seen or p in sign or not (1 <= p[0] <= 14 and 1 <= p[1] <= 14):
            continue
        seen.add(p)
        todo += [(p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1)]
    holes = {p for p in inner if p not in sign and p not in seen}
    fill = rgb(colour)
    # too dark to read on the screen's dark box: lifted towards white
    if lum(fill) < 0.42:
        fill = mix(fill, (255, 255, 255), min(0.75, (0.42 - lum(fill)) / 0.42 + 0.25))
    light, shade, pale = mix(fill, (255, 255, 255), 0.4), mix(fill, (0, 0, 0), 0.28), mix(fill, (255, 255, 255), 0.72)
    line = mix(fill, (0, 0, 0), 0.78)
    out = Image.new('RGBA', (18, 18), (0, 0, 0, 0))
    o = out.load()
    body = sign | holes
    for (x, y) in body:
        if (x, y) in holes:
            c = pale
        elif (x, y - 1) not in body or (x - 1, y) not in body:
            c = light
        elif (x, y + 1) not in body or (x + 1, y) not in body:
            c = shade
        else:
            c = fill
        o[x + 1, y + 1] = c + (255,)
    # the outline: every clear pixel beside the shape
    for y in range(18):
        for x in range(18):
            if o[x, y][3]:
                continue
            if any((x - 1 + dx, y - 1 + dy) in body for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                o[x, y] = line + (255,)
    return out


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else r'D:/code/personal/texture_sources/Pixel-Perfection-Chorus-Eddit'
    src = os.path.join(root, 'assets', 'minecraft', 'textures', 'mob_effect')
    rows = (len(ORDER) + 7) // 8
    sheet = Image.new('RGBA', (8 * 18, rows * 18), (0, 0, 0, 0))
    for i, n in enumerate(ORDER):
        f = os.path.join(src, n + '.png')
        if not os.path.exists(f):
            print('missing', n)
            continue
        im = Image.open(f).convert('RGBA')
        # the pack's pictures are a 16 pixel tile in the middle of 18
        tile = im.crop((1, 1, 17, 17)) if im.size == (18, 18) else im.resize((16, 16), Image.NEAREST)
        sheet.paste(glyph(tile, COLOUR[n]), ((i % 8) * 18, (i // 8) * 18))
    sheet.save(OUT, optimize=True)
    print('wrote', os.path.normpath(OUT), len(ORDER), 'pictures')


if __name__ == '__main__':
    main()
