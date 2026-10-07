"""
Leoncraft 2 - build the game's own sounds and music.

Every recording here is openly licensed (CC0, or CC BY with credit) and none
is Mojang's. They are fetched from where their authors published them
(SOURCES), and for each of the game's sound events this script:

  1. takes a pool of candidate recordings (POOLS: footsteps for footsteps,
     impacts for digging, moos for cows...), cut into one-shot pieces where a
     source holds many;
  2. shapes every candidate towards the game's own sound for that event, as
     measured from the player's local Minecraft by measure_sounds.py (only the
     numbers in sound_targets.json are used here): pitched towards the same
     spectral centroid (within a natural range), filtered towards the same
     spectrum shape (at most 10 dB either way), cut to the same length and
     set to the same loudness;
  3. measures each shaped candidate again and keeps the ones that came out
     closest (as many as the game has variants of that sound, up to six or
     eight), each from a different recording where it can.

Events the game plays from the same recordings (block.stone.hit and
block.stone.step) share them, and the many block sound types without
recordings of their own (deepslate, nylium, copper...) play the nearest
built type, by the same measurements, pitched to match (ALIAS_KINDS).
The note block's instruments are synthesised here (our own).

The clips go end to end into a few Ogg "banks" (public/leoncraft2/sounds/
<bank>.ogg) and sounds/index.json says which clips each event plays, in the
game's sounds.json form, so the game reads Leoncraft's sounds and a player's
own Minecraft sounds the same way (js/sound/packs.js). The music is one file
a track. CREDITS.txt (and js/sound/credits.js for the Credits screen) is
written from SOURCES, for what was used.

Run:  python tools/leoncraft2/build_sounds.py --src <cache folder> [--fetch] [--only ui,blocks,...] [--report]
Needs numpy, scipy and ffmpeg with libvorbis (the imageio-ffmpeg pip package's
works), and py7zr for two .7z packs.
"""
import argparse, fnmatch, json, os, sys, urllib.parse, urllib.request, zipfile
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from soundlib import SR, decode, features, distance, fades, resample, lp, hp, eq_to, segments, write_ogg, active

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'leoncraft2', 'sounds')
JS_CREDITS = os.path.join(ROOT, 'public', 'leoncraft2', 'js', 'sound', 'credits.js')
JS_TEXT = os.path.join(ROOT, 'public', 'leoncraft2', 'js', 'sound', 'subtitles.js')
rng = np.random.default_rng(20261007)

OGA = 'https://opengameart.org/sites/default/files/'
KEN = 'https://kenney.nl/media/pages/assets/'
OGAP = 'https://opengameart.org/content/'
CC0, BY3 = 'CC0 1.0', 'CC BY 3.0'
# id: (url, kind, title, author, licence, page)
SOURCES = {
    'impact': (KEN + 'impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip', 'zip', 'Impact Sounds', 'Kenney', CC0, 'https://kenney.nl/assets/impact-sounds'),
    'interface': (KEN + 'interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip', 'zip', 'Interface Sounds', 'Kenney', CC0, 'https://kenney.nl/assets/interface-sounds'),
    'rpg': (KEN + 'rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip', 'zip', 'RPG Audio', 'Kenney', CC0, 'https://kenney.nl/assets/rpg-audio'),
    'jingles': (KEN + 'music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip', 'zip', 'Music Jingles', 'Kenney', CC0, 'https://kenney.nl/assets/music-jingles'),
    'kdd': (OGA + '%5Bkdd%5DDifferentSteps_0.zip', 'zip', 'Different steps on wood, stone, leaves, gravel and mud', 'TinyWorlds', CC0, OGAP + 'different-steps-on-wood-stone-leaves-gravel-and-mud'),
    'fantozzi': (OGA + 'Fantozzi-footsteps.7z', '7z', "Fantozzi's Footsteps (Grass/Sand & Stone)", 'Fantozzi, published by qubodup', CC0, OGAP + 'fantozzis-footsteps-grasssand-stone'),
    'corsica': (OGA + 'corsica_s-walking_in_snow.7z', '7z', '42 Snow and Gravel Footsteps', 'Corsica_S, published by qubodup', CC0, OGAP + '42-snow-and-gravel-footsteps'),
    'rd100': (OGA + '100-CC0-SFX_0.zip', 'zip', '100 CC0 SFX', 'rubberduck', CC0, OGAP + '100-cc0-sfx'),
    'rd100b': (OGA + 'sfx_100_v2.zip', 'zip', '100 CC0 SFX #2', 'rubberduck', CC0, OGAP + '100-cc0-sfx-2'),
    'rdloops': (OGA + 'sfx_loops.zip', 'zip', '30 CC0 SFX loops', 'rubberduck', CC0, OGAP + '30-cc0-sfx-loops'),
    'rdwater': (OGA + 'water-splash-slime-sfx.zip', 'zip', '40 CC0 water / splash / slime SFX', 'rubberduck', CC0, OGAP + '40-cc0-water-splash-slime-sfx'),
    'rdcreature': (OGA + '80-CC0-creature-SFX_0.zip', 'zip', '80 CC0 creature SFX', 'rubberduck', CC0, OGAP + '80-cc0-creature-sfx'),
    'rdbang': (OGA + '25-CC0-bang-sfx.zip', 'zip', '25 CC0 bang / firework SFX', 'rubberduck', CC0, OGAP + '25-cc0-bang-firework-sfx'),
    'crunch': (OGA + 'crunch_-_tito.zip', 'zip', '7 Eating Crunches', 'StarNinjas', CC0, OGAP + '7-eating-crunches'),
    'applebite': (OGA + 'apple_bite_0.ogg', 'file', 'Apple Bite', 'AntumDeluge', CC0, OGAP + 'apple-bite'),
    'grunts': (OGA + 'death%20pain%20grunts.wav', 'file', 'grunts of male death and pain', 'thebardofblasphemy', CC0, OGAP + 'grunts-male-death-and-pain'),
    'zombies': (OGA + 'zombies.zip', 'zip', 'Zombies Sound Pack', 'artisticdude', CC0, OGAP + 'zombies-sound-pack'),
    'moans': (OGA + 'darsycho__zombie-moans_0.ogg', 'file', 'Zombie moans', 'Darsycho', CC0, OGAP + 'zombie-moans'),
    'voicefx': (OGA + 'Voice%20Effects%20Zombie-Skeleton-Monster%20Human%20Male.zip', 'zip', 'Zombie / Skeleton / Monster Voice Effects', 'ArcadeParty', CC0, OGAP + 'zombie-skeleton-monster-voice-effects'),
    'bones': (OGA + 'bones_rattle.zip', 'zip', 'Bones rattle', 'congusbongus', CC0, OGAP + 'bones-rattle'),
    'skeleton': (OGA + 'skeleton2sfx_0.wav', 'file', 'SkeletonSFXShortPack', 'Colodical', CC0, OGAP + 'skeletonsfxshortpack'),
    'skeleton1': (OGA + 'skeleton1sfx_0.wav', 'file', 'SkeletonSFXShortPack', 'Colodical', CC0, OGAP + 'skeletonsfxshortpack'),
    'fuse': (OGA + 'fuse_0.ogg', 'file', 'Simple Fuse Sound', 'themightyglider', CC0, OGAP + 'simple-fuse-sound'),
    'sheep': (OGA + 'sheep_baa_0.ogg', 'file', 'Sheep Baa', 'AntumDeluge', CC0, OGAP + 'sheep-baa'),
    'yak': (OGA + 'yak_0.ogg', 'file', 'Yak Imitation', 'AntumDeluge', CC0, OGAP + 'yak-imitation'),
    'cow': (OGA + 'qubodup-sci-fi-cow-alien-soundpack.zip', 'zip', 'Sci-Fi Aliens and Cows Pack', 'qubodup', CC0, OGAP + 'sci-fi-aliens-and-cows-pack'),
    'chicken': (OGA + 'chicken_sound_effect.zip', 'zip', 'Chicken Sound Effect', 'IMadeIt', BY3, OGAP + 'chicken-sound-effect'),
    'frankie1': (OGA + 'sheep1.flac', 'file', 'Sheep Sound Bleats (Yo Frankie!)', 'Blender Foundation (Yo Frankie!), published by Lamoot', BY3, OGAP + 'sheep-sound-bleats-yo-frankie'),
    'frankie2': (OGA + 'sheep2.flac', 'file', 'Sheep Sound Bleats (Yo Frankie!)', 'Blender Foundation (Yo Frankie!), published by Lamoot', BY3, OGAP + 'sheep-sound-bleats-yo-frankie'),
    'frankie3': (OGA + 'sheepBleet.flac', 'file', 'Sheep Sound Bleats (Yo Frankie!)', 'Blender Foundation (Yo Frankie!), published by Lamoot', BY3, OGAP + 'sheep-sound-bleats-yo-frankie'),
    'frankie4': (OGA + 'sheepHit.flac', 'file', 'Sheep Sound Bleats (Yo Frankie!)', 'Blender Foundation (Yo Frankie!), published by Lamoot', BY3, OGAP + 'sheep-sound-bleats-yo-frankie'),
    'pig1': (OGA + 'pig_idle.mp3', 'file', 'Pig SFX Pack', 'Vinrax', BY3, OGAP + 'pig-sfx-pack'),
    'pig2': (OGA + 'pig_idle2.mp3', 'file', 'Pig SFX Pack', 'Vinrax', BY3, OGAP + 'pig-sfx-pack'),
    'pig3': (OGA + 'pig_idle3.mp3', 'file', 'Pig SFX Pack', 'Vinrax', BY3, OGAP + 'pig-sfx-pack'),
    'pig4': (OGA + 'pig_idle4.mp3', 'file', 'Pig SFX Pack', 'Vinrax', BY3, OGAP + 'pig-sfx-pack'),
    'pig5': (OGA + 'pig_hit1.mp3', 'file', 'Pig SFX Pack', 'Vinrax', BY3, OGAP + 'pig-sfx-pack'),
    'pig6': (OGA + 'pig_hit2.mp3', 'file', 'Pig SFX Pack', 'Vinrax', BY3, OGAP + 'pig-sfx-pack'),
    'rain': (OGA + 'Rain%20OGG.zip', 'zip', 'Rain (loopable)', 'Ylmir', CC0, OGAP + 'rain-loopable'),
    'thunder': (OGA + 'rain-thunder.ogg', 'file', 'Rain + Long Thunder', 'WuxiaScrub', CC0, OGAP + 'rain-long-thunder'),
    'fire': (OGA + 'fire-1_0.ogg', 'file', 'Fire Crackling', 'AntumDeluge', CC0, OGAP + 'fire-crackling'),
    'dungeon': (OGA + 'dungeon_ambient_1_0.ogg', 'file', 'Loopable Dungeon Ambience', 'JaggedStone', CC0, OGAP + 'loopable-dungeon-ambience'),
    'basement': (OGA + 'atmosbasement.mp3_.flac', 'file', 'Dripping water loop', 'qubodup', CC0, OGAP + 'dripping-water-loop'),
    'cavein': (OGA + 'cave_in_-_starninjas_0.ogg', 'file', 'Cave In', 'StarNinjas', CC0, OGAP + 'cave-in'),
    'muffled': (OGA + 'NenadSimic%20-%20Muffled%20Distant%20Explosion.wav', 'file', 'Muffled Distant Explosion', 'NenadSimic', CC0, OGAP + 'muffled-distant-explosion'),
    'synthboom': (OGA + 'synthetic_explosion_1.flac', 'file', 'Synthesized explosion', 'qubodup', CC0, OGAP + 'synthesized-explosion'),
    'peludo1': (OGA + 'splash1_0.wav', 'file', 'Water Splash and sand footsteps', 'Peludo', CC0, OGAP + 'water-splash-and-sand-footsteps'),
    'peludo2': (OGA + 'splash2_0.wav', 'file', 'Water Splash and sand footsteps', 'Peludo', CC0, OGAP + 'water-splash-and-sand-footsteps'),
    'peludo3': (OGA + 'drowning_0.wav', 'file', 'Water Splash and sand footsteps', 'Peludo', CC0, OGAP + 'water-splash-and-sand-footsteps'),
    'peludo4': (OGA + 'sand_footsteps_0.mp3', 'file', 'Water Splash and sand footsteps', 'Peludo', CC0, OGAP + 'water-splash-and-sand-footsteps'),
    # music
    'm_firstlight': (OGA + 'first_light_particles_0.wav', 'file', 'First Light Particles', 'Yoiyami', CC0, OGAP + 'first-light-particles-%E2%80%93-cc0-atmospheric-pianoambient-track'),
    'm_budding': (OGA + 'the_budding_of_consciousness.wav', 'file', 'The Budding of Consciousness', 'Yoiyami', CC0, OGAP + 'the-budding-of-consciousness-%E2%80%93-cc0-ambient-minimalist-theme-yoiyami-blue-series-%E2%80%93-no4'),
    'm_yoiyami': (OGA + 'yoiyami_core_theme_0.wav', 'file', 'Yoiyami Core Theme', 'Yoiyami', CC0, OGAP + 'yoiyami-core-theme-%E2%80%93-deep-blue-ambient-piano'),
    'm_snowfall': (OGA + 'Snowfall_0.ogg', 'file', 'Snowfall', 'Kistol', CC0, OGAP + 'snowfall'),
    'm_august': (OGA + '013_Another_August_0.mp3', 'file', 'Another August', 'cynicmusic (The Cynic Project)', CC0, OGAP + 'another-august'),
    'm_november': (OGA + '155%20November_snow-33_tape_leveled.mp3', 'file', 'November Snow', 'cynicmusic (The Cynic Project)', CC0, OGAP + 'november-snow'),
    'm_meadow': (OGA + 'Meadow%20Thoughts.ogg', 'file', 'Meadow Thoughts', 'Ecrivain', CC0, OGAP + 'meadow-thoughts'),
    'm_crystal': (OGA + 'song18_0.mp3', 'file', 'Crystal Cave', 'cynicmusic (The Cynic Project)', CC0, OGAP + 'crystal-cave-song18'),
    'm_lullaby': (OGA + 'song17.mp3', 'file', 'Happy Lullaby', 'cynicmusic (The Cynic Project)', CC0, OGAP + 'happy-lullaby-song17'),
    'm_mystery': (OGA + 'song21_0.mp3', 'file', 'Mysterious Ambience', 'cynicmusic (The Cynic Project)', CC0, OGAP + 'mysterious-ambience-song21'),
    'm_dungeon': (OGA + 'dungeon002_0.ogg', 'file', 'Dungeon Ambience', 'yd', CC0, OGAP + 'dungeon-ambience'),
    'm_galactic': (OGA + 'GalacticTemple.zip', 'zip', 'Galactic Temple', 'yd', CC0, OGAP + 'galactic-temple'),
    'm_star': (OGA + 'ObservingTheStar.zip', 'zip', 'Another space background track (Observing The Star)', 'yd', CC0, OGAP + 'another-space-background-track'),
    'm_darkintro': (OGA + 'Dark%20Intro_0.ogg', 'file', 'Dark Intro', 'Nikke', CC0, OGAP + 'dark-intro'),
    'm_underwater': (OGA + 'underwater_theme_ii.zip', 'zip', 'Underwater Theme II', 'Cleyton Kauffman', CC0, OGAP + 'underwater-theme-ii'),
    'm_pad': (OGA + 'Underwater-Ambient-Pad-isaiah658_0.ogg', 'file', 'Underwater Ambient Pad', 'isaiah658', CC0, OGAP + 'underwater-ambient-pad'),
}

SRC = None
USED = set()
_files = {}
_cache = {}


def fetch():
    for sid, (url, kind, *_) in SOURCES.items():
        d = os.path.join(SRC, sid)
        os.makedirs(d, exist_ok=True)
        name = urllib.parse.unquote(os.path.basename(url))
        p = os.path.join(d, name)
        if not os.path.exists(p):
            print('fetch', sid, url)
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=300) as r, open(p, 'wb') as f:
                f.write(r.read())
        x = os.path.join(d, 'x')
        if kind == 'zip' and not os.path.isdir(x):
            zipfile.ZipFile(p).extractall(x)
        elif kind == '7z' and not os.path.isdir(x):
            import py7zr
            with py7zr.SevenZipFile(p) as z:
                z.extractall(x)


def listing(sid):
    if sid not in _files:
        m = {}
        for r, _, fs in os.walk(os.path.join(SRC, sid)):
            if '__MACOSX' in r:
                continue
            for f in fs:
                if f.lower().endswith(('.wav', '.ogg', '.mp3', '.flac')):
                    m.setdefault(f, os.path.join(r, f))
        _files[sid] = m
    return _files[sid]


def S(sid, name=None):
    """a source recording, mono 44.1 kHz; name defaults to the only one"""
    fs = listing(sid)
    if name is None:
        if not fs:
            raise SystemExit('nothing in ' + sid + ' (run with --fetch?)')
        name = sorted(fs)[0]
    key = (sid, name)
    if key not in _cache:
        if name not in fs:
            raise SystemExit('missing %s in %s (run with --fetch?)' % (name, sid))
        _cache[key] = decode(fs[name])
    return _cache[key].copy()


# ------------------------------------------------------------------ candidates
# A candidate is (label, source id, samples). Pools are lists of them.
def files(sid, pattern='*', fn=None):
    out = []
    for n in sorted(listing(sid)):
        if fnmatch.fnmatch(n.lower(), pattern.lower()):
            x = S(sid, n)
            out.append((sid + ':' + n, sid, fn(x) if fn else x))
    return out


def pieces(sid, pattern='*', lo=0.04, hi=3.0, thresh=-35, gap=0.08, fn=None, limit=40):
    """one-shot pieces cut out of longer recordings at their quiet gaps"""
    out = []
    for n in sorted(listing(sid)):
        if not fnmatch.fnmatch(n.lower(), pattern.lower()):
            continue
        x = S(sid, n)
        for k, (a, b) in enumerate(segments(x, thresh, gap)):
            y = x[a:b]
            if lo <= len(y) / SR <= hi:
                out.append(('%s:%s#%d' % (sid, n, k), sid, fn(y) if fn else y))
    return out[:limit]


def windows(sid, pattern, length, n, skip=0.5, fn=None):
    """n stretches of length seconds spread through a long recording (rain, fire, a cave's air)"""
    out = []
    for name in sorted(listing(sid)):
        if not fnmatch.fnmatch(name.lower(), pattern.lower()):
            continue
        x = S(sid, name)
        tot = len(x) / SR - length - skip
        if tot <= 0:
            continue
        for k in range(n):
            t = skip + tot * (k + 0.5) / n
            y = fades(x[int(t * SR):int((t + length) * SR)], min(0.3, length * 0.2), min(0.5, length * 0.3))
            out.append(('%s:%s@%.1f' % (sid, name, t), sid, fn(y) if fn else y))
    return out


def mixdown(*parts):
    n = max(int(d * SR) + len(c) for c, d, g in parts)
    out = np.zeros(n, np.float32)
    for c, d, g in parts:
        i = int(d * SR)
        out[i:i + len(c)] += c * g
    return out


def loop_join(x, xf=0.4):
    """a seamless loop: the end fades into the start"""
    n = int(xf * SR)
    a, tail = x[:len(x) - n].copy(), x[len(x) - n:]
    t = np.linspace(0, np.pi / 2, n)
    a[:n] = a[:n] * np.sin(t) + tail * np.cos(t)
    return a.astype(np.float32)


def onset_trim(x, pre=0.003):
    a, b = active(x)
    return x[max(0, a - int(pre * SR)):]


# ------------------------------------------------------------------ our own synthesis
def t_(dur):
    return np.arange(int(dur * SR)) / SR


def pluck(f, dur, bright=0.5, decay=3.0):
    """Karplus-Strong: a plucked string"""
    n = int(dur * SR)
    p = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, p).astype(np.float32)
    buf = lp(buf, 2000 + bright * 8000)
    out = np.zeros(n, np.float32)
    k = 0.5 * (0.9935 + 0.006 * min(1.0, decay / 6))    # the averaging filter, losing a little each pass
    for i in range(n):
        v = buf[i % p]
        out[i] = v
        buf[i % p] = k * (v + buf[(i + 1) % p])
    return fades(out, 0.001, 0.05)


def tone(partials, dur, env_decay, attack=0.002):
    t = t_(dur)
    y = np.zeros_like(t)
    for f, a, d in partials:
        y += a * np.sin(2 * np.pi * f * t) * np.exp(-t * d)
    env = np.minimum(1, t / attack) * np.exp(-t * env_decay)
    return fades((y * env).astype(np.float32), 0.0005, 0.03)


def noise(dur):
    return rng.uniform(-1, 1, int(dur * SR)).astype(np.float32)


# note block instruments at F#3 (the game's note 0 is F#3 = 185 Hz, its 12 is F#4; each recording is the middle note, played 0.5-2x)
F_MID = 369.99


def note_instrument(name):
    f = F_MID
    if name == 'harp':
        return pluck(f, 1.0, 0.6, 4)
    if name == 'bass':
        return lp(pluck(f / 4, 0.9, 0.3, 3), 1200)
    if name == 'guitar':
        return pluck(f / 2, 1.0, 0.8, 5)
    if name == 'banjo':
        return hp(pluck(f, 0.7, 1.0, 2), 300)
    if name == 'bell':
        return tone([(f * 2, 1, 1.5), (f * 2 * 2.76, 0.5, 3), (f * 2 * 5.4, 0.25, 5)], 1.6, 0.8)
    if name == 'chime':
        return tone([(f * 4, 1, 2), (f * 4 * 2.76, 0.35, 4)], 1.4, 1.2)
    if name == 'flute':
        t = t_(0.9)
        y = np.sin(2 * np.pi * f * 2 * t) + 0.15 * np.sin(2 * np.pi * f * 4 * t) + 0.05 * lp(noise(0.9), 3000)
        return fades((y * np.minimum(1, t / 0.05) * np.exp(-t * 1.5)).astype(np.float32), 0.02, 0.2)
    if name == 'xylophone':
        return tone([(f * 2, 1, 9), (f * 2 * 3.9, 0.3, 20)], 0.5, 8)
    if name == 'iron_xylophone':
        return tone([(f, 1, 3), (f * 2.0, 0.6, 4), (f * 3.0, 0.3, 6)], 0.9, 3)
    if name == 'cow_bell':
        return tone([(f * 1.5, 1, 6), (f * 1.5 * 1.48, 0.8, 6)], 0.6, 5)
    if name == 'didgeridoo':
        t = t_(1.0)
        saw = 2 * ((f / 4 * t) % 1) - 1
        return fades(lp((saw * np.minimum(1, t / 0.03) * np.exp(-t * 1.2)).astype(np.float32), 900), 0.005, 0.2)
    if name == 'bit':
        t = t_(0.6)
        sq = np.sign(np.sin(2 * np.pi * f * t))
        return fades((0.6 * sq * np.exp(-t * 3)).astype(np.float32), 0.001, 0.05)
    if name == 'pling':
        return tone([(f, 1, 2.5), (f * 2, 0.5, 3), (f * 3, 0.2, 5), (f * 4, 0.1, 6)], 1.2, 2)
    if name == 'basedrum':
        t = t_(0.35)
        fr = 50 + 120 * np.exp(-t * 30)
        return fades((np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 12)).astype(np.float32), 0.0005, 0.05)
    if name == 'snare':
        t = t_(0.3)
        y = 0.7 * hp(noise(0.3), 1500) * np.exp(-t * 18) + 0.4 * np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25)
        return fades(y.astype(np.float32), 0.0005, 0.05)
    if name == 'hat':
        t = t_(0.12)
        return fades((hp(noise(0.12), 6000) * np.exp(-t * 45)).astype(np.float32), 0.0005, 0.02)
    raise KeyError(name)


def synth_pop():
    t = t_(0.06)
    fr = 900 + 1800 * np.exp(-t * 90)
    return fades((np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 60)).astype(np.float32), 0.0005, 0.01)


def synth_ding(f):
    return tone([(f, 1, 7), (f * 2.01, 0.2, 12), (f * 3.02, 0.06, 18)], 0.45, 7)


def synth_fizz(dur=0.6):
    t = t_(dur)
    return fades((hp(noise(dur), 2500) * (np.minimum(1, t / 0.01) * np.exp(-t * 5))).astype(np.float32), 0.002, 0.1)


def synth_fuse(dur=2.6):
    """a lit fuse: bright hiss that sputters"""
    t = t_(dur)
    sputter = 0.6 + 0.4 * np.abs(lp(noise(dur), 30) * 6).clip(0, 1)
    env = np.minimum(1, t / 0.25) * np.minimum(1, (dur - t) / 0.6)
    return fades((hp(noise(dur), 4000) * sputter * env).astype(np.float32), 0.01, 0.2)


def synth_levelup():
    """three bright bell notes rising quickly, ringing together"""
    out = np.zeros(int(1.3 * SR), np.float32)
    for i, f in enumerate((1046.5, 1318.5, 1568.0)):
        n = tone([(f, 1, 3), (f * 2, 0.35, 5), (f * 3, 0.12, 8)], 1.1, 2.6)
        a = int(i * 0.06 * SR)
        out[a:a + len(n)] += n[:len(out) - a]
    return out


def synth_hiss(dur=1.2):
    t = t_(dur)
    return fades((hp(noise(dur), 2500) * np.minimum(1, t / 0.05) * np.exp(-t * 2.2)).astype(np.float32), 0.005, 0.2)


def synth_portal(dur, rise=False, cutoff=900):
    t = t_(dur)
    n = lp(noise(dur), cutoff)
    wob = 0.5 + 0.5 * np.sin(2 * np.pi * (0.7 + 0.5 * t) * t)
    env = (t / dur) if rise else np.sin(np.pi * t / dur)
    return fades((n * (0.4 + 0.6 * wob) * env).astype(np.float32), 0.2, 0.4)


# ------------------------------------------------------------------ choosing and shaping
TARGETS = None
TEXT = {}


def shape(x, T, r, i=0, eq=True, cut=True):
    y = onset_trim(x)
    y = resample(y, r)
    if cut:
        durs = T.get('durs') or [T['dur']]
        want = durs[i % len(durs)] if i is not None else T['dur']
        n = int((want * 1.08 + 0.03) * SR)
        if len(y) > n:
            y = fades(y[:n], 0.001, min(0.25, want * 0.35))
    y = fades(y, 0.001, 0.008)
    if eq:
        y = eq_to(y, features(y)['bands'], T['bands'], 10.0)
    f = features(y)
    if f['rms'] > 0:
        y = y * (T['rms'] / f['rms'])
    pk = float(np.max(np.abs(y))) if len(y) else 0
    if pk > 0.97:
        # a gentle limiter rather than turning the whole clip down
        y = (np.tanh(y / 0.97 * 1.1) / np.tanh(1.1) * 0.97).astype(np.float32)
    return y.astype(np.float32)


def choose(event, pool, n=None, rr=(0.7, 1.45), eq=True, cut=True, maxn=6, report=False):
    T = TARGETS[event]
    n = n or int(min(max(T['n'], 2), maxn))
    scored = []
    for label, sid, x in pool:
        if len(x) < SR * 0.01:
            continue
        f0 = features(onset_trim(x))
        r = float(np.clip(((T['centroid'] + 50) / (f0['centroid'] + 50)) ** 0.6, rr[0], rr[1]))
        y = shape(x, T, r, None, eq, cut)
        d = distance(features(y), T)
        scored.append((d, label, sid, x, r))
    scored.sort(key=lambda s: s[0])
    picked, files_used = [], set()
    for s in scored:
        base = s[1].split('#')[0].split('@')[0]
        if base in files_used and len(scored) - len(picked) > n - len(picked):
            continue
        picked.append(s)
        files_used.add(base)
        if len(picked) >= n:
            break
    for s in scored:
        if len(picked) >= n:
            break
        if s not in picked:
            picked.append(s)
    out = []
    for k, (d, label, sid, x, r) in enumerate(picked):
        USED.add(sid)
        out.append((shape(x, T, r, k, eq, cut), label, d))
    if report:
        print('  %-36s %s' % (event, '  '.join('%.2f %s' % (d, l.split(':')[1][:22]) for _, l, d in out)))
    return [c for c, _, _ in out]


# ------------------------------------------------------------------ banks and the index
class Bank:
    def __init__(self, name, load):
        self.name, self.load = name, load
        self.clips, self.parts, self.n = {}, [], 0

    def add(self, cid, clip, gap=0.03):
        clip = np.clip(clip, -0.99, 0.99).astype(np.float32)
        self.clips[cid] = [round(self.n / SR, 5), round(len(clip) / SR, 5)]
        self.parts += [clip, np.zeros(int(gap * SR), np.float32)]
        self.n += len(clip) + int(gap * SR)
        return self.name + '/' + cid

    def write(self, q):
        os.makedirs(OUT, exist_ok=True)
        dst = os.path.join(OUT, self.name + '.ogg')
        # 32 kHz: everything a game sound needs (to 16 kHz), and a third less to download and to keep decoded
        write_ogg(np.concatenate(self.parts) if self.parts else np.zeros(SR // 10, np.float32), dst, q, out_sr=32000)
        print('%-8s %6.1f s %7.1f KB  %d clips' % (self.name, self.n / SR, os.path.getsize(dst) / 1024, len(self.clips)))
        return {'file': self.name + '.ogg', 'load': self.load, 'clips': self.clips}


EVENTS = {}       # event -> {'sounds': [...], 'subtitle': key}
BANKS = {}
BUILT_SIG = {}    # recordings' signature -> event built for it


def sub(event):
    return TARGETS['subs'].get(event)


def put(bank, event, clips, volume=None):
    """the event plays these clips (from the given bank)"""
    T = TARGETS.get(event) or {}
    names = []
    for i, c in enumerate(clips):
        names.append(BANKS[bank].add(event.replace('.', '_') + '_' + str(i), c))
    sounds = []
    for nm in names:
        s = {'name': nm}
        if T.get('range'):
            s['attenuation_distance'] = T['range']
        if volume:
            s['volume'] = volume
        sounds.append(s)
    EVENTS[event] = {'sounds': sounds, 'subtitle': sub(event)}
    if T.get('sig'):
        BUILT_SIG.setdefault(T['sig'], event)


def ref(event, to, pitch=1.0, volume=1.0):
    """the event plays another's recordings (as the game's own sounds.json does with "type": "event")"""
    s = {'name': to, 'type': 'event'}
    if abs(pitch - 1) > 1e-3:
        s['pitch'] = round(pitch, 3)
    if abs(volume - 1) > 1e-3:
        s['volume'] = round(volume, 3)
    T = TARGETS.get(event) or {}
    if T.get('range'):
        s['attenuation_distance'] = T['range']
    EVENTS[event] = {'sounds': [s], 'subtitle': sub(event) or (EVENTS.get(to) or {}).get('subtitle')}


def like(event, to):
    """the event plays another's recordings, pitched towards its own spectral centroid and set to its own loudness"""
    if to not in EVENTS:
        return
    T, C = TARGETS.get(event), TARGETS.get(to)
    if not T or not C:
        ref(event, to)
        return
    pitch = float(np.clip(((T['centroid'] + 50) / (C['centroid'] + 50)) ** 0.5, 0.75, 1.35))
    vol = float(np.clip(T['rms'] / max(C['rms'], 1e-5), 0.3, 2.0))
    ref(event, to, pitch, vol)


def build(bank, event, pool, report=False, **kw):
    """an event from a pool, unless the game plays the same recordings for an event built already"""
    if event not in TARGETS:
        print('  (no measurement for %s: skipped)' % event)
        return
    T = TARGETS[event]
    same = BUILT_SIG.get(T.get('sig'))
    if same:
        ref(event, same)
        return
    put(bank, event, choose(event, pool() if callable(pool) else pool, report=report, **kw))


# ------------------------------------------------------------------ the pools
K = lambda pat: files('impact', pat)
KU = lambda pat: files('interface', pat)
KR = lambda pat: files('rpg', pat)


def pools():
    P = {}
    P['click'] = lambda: KU('click_*') + KU('switch_*') + KU('tick_*') + KU('select_*') + KR('metalClick*')
    # blocks
    P['stone_step'] = lambda: K('footstep_concrete_*') + files('fantozzi', '*stone*') + files('kdd', 'stone*') + files('rd100b', '*footstep_0*') + K('impactSoft_medium_*') + K('impactGeneric_light_*')
    P['stone_dig'] = lambda: K('impactMining_*') + K('impactSoft_heavy_*') + K('impactGeneric_light_*') + K('impactPunch_heavy_*') + files('rd100b', '*stones*') + files('rd100', 'hit_*') + files('rd100b', '*_hit_0*') + K('impactPlate_heavy_*')
    P['wood_step'] = lambda: K('footstep_wood_*') + files('kdd', 'wood*') + files('rd100b', '*footstep_wood*') + K('impactWood_light_*') + K('impactPlank_medium_*')
    P['wood_dig'] = lambda: K('impactWood_*') + K('impactPlank_medium_*') + files('rd100b', '*wood_hit*') + files('rd100b', '*_wood_0*') + files('rd100', 'wooden_*')
    P['grass_step'] = lambda: K('footstep_grass_*') + files('kdd', 'leaves*') + KR('cloth*') + files('fantozzi', '*sand*')
    P['grass_dig'] = lambda: files('kdd', 'leaves*') + K('footstep_grass_*') + KR('cloth*') + KR('clothBelt*') + files('rd100', 'paper_*')
    P['gravel_step'] = lambda: files('corsica', '*gravel_0*') + files('kdd', 'gravel*') + files('kdd', 'mud*') + K('footstep_snow_*')
    P['gravel_dig'] = lambda: files('corsica', '*') + files('kdd', 'gravel*') + files('kdd', 'mud*') + files('rd100b', '*stones*')
    P['sand_step'] = lambda: files('fantozzi', '*sand*') + pieces('peludo4', '*', 0.08, 0.8) + K('footstep_snow_*')
    P['sand_dig'] = lambda: files('fantozzi', '*sand*') + pieces('peludo4', '*', 0.08, 0.8) + files('corsica', '*ice*')
    P['snow_step'] = lambda: K('footstep_snow_*') + files('corsica', '*gravel_0*')
    P['snow_dig'] = lambda: K('footstep_snow_*') + files('corsica', '*')
    P['cloth_step'] = lambda: K('footstep_carpet_*') + KR('cloth*') + KR('clothBelt*')
    P['cloth_dig'] = lambda: KR('cloth*') + KR('clothBelt*') + K('footstep_carpet_*') + KR('dropLeather*') + KR('handleSmallLeather*')
    P['glass_break'] = lambda: K('impactGlass_*') + files('rd100', 'glass_*') + files('rd100b', '*glass*') + files('rd100', 'dishes_*')
    P['metal'] = lambda: K('impactMetal_*') + files('rd100', 'metal_*') + files('rd100b', '*metal*') + K('impactPlate_*') + K('impactTin_*') + K('impactBell_heavy_*')
    # player
    P['hurt'] = lambda: pieces('grunts', '*', 0.06, 0.8, -35, 0.15) + K('impactPunch_medium_*') + files('voicefx', 'human*')
    P['fall'] = lambda: K('impactSoft_heavy_*') + K('impactPunch_heavy_*') + K('impactGeneric_light_*') + K('impactSoft_medium_*') + files('rd100b', '*_hit_0*')
    P['splash'] = lambda: files('rdwater', 'splash_*') + files('peludo1') + files('peludo2') + files('rd100', 'splash_*')
    P['swim'] = lambda: files('rdwater', 'splash_*', lambda x: lp(x, 4500)) + windows('rdwater', 'loop_water_0*', 1.2, 4) + pieces('peludo3', '*', 0.3, 2.0)
    P['eat'] = lambda: pieces('crunch', '*', 0.06, 0.6, -30, 0.05) + pieces('applebite', '*', 0.06, 0.6, -30, 0.05) + files('rdcreature', 'eat_*')
    P['drink'] = lambda: files('rdwater', 'bubble_*') + files('rdwater', 'slime_*', lambda x: lp(x, 3000)) + pieces('peludo3', '*', 0.2, 2.0) + windows('rdwater', 'loop_bubbles*', 1.2, 4)
    P['burp'] = lambda: files('rdcreature', 'burp_*') + files('rdcreature', 'burble_*')
    P['levelup'] = lambda: [('synth:levelup', 'synth', synth_levelup())] + files('jingles', '*steel*') + files('jingles', '*pizzi*') + files('jingles', '*hit*') + KU('confirmation_*') + KU('maximize_*')
    P['orb'] = lambda: KU('glass_*') + KU('bong_*') + [('synth:ding%d' % f, 'synth', synth_ding(f)) for f in (1400, 1700, 2100, 2600, 3100)]
    P['pop'] = lambda: files('rd100', 'plop_*') + KU('drop_*') + KU('pluck_*') + [('synth:pop', 'synth', synth_pop())]
    P['itembreak'] = lambda: K('impactWood_light_*') + K('impactPlate_light_*') + files('rd100', 'hit_*') + K('impactGlass_light_*') + files('rd100', 'tools_*')
    P['attack'] = lambda: K('impactPunch_*') + files('rd100b', '*_hit_0*') + files('rd100', 'hit_*') + KR('knifeSlice*') + KR('drawKnife*') + files('rd100b', '*air_*')
    P['whoosh'] = lambda: files('rd100b', '*air_*') + KR('drawKnife*') + KR('knifeSlice*') + KR('cloth*')
    P['fire_hurt'] = lambda: windows('fire', '*', 0.4, 6) + [('synth:fizz', 'synth', synth_fizz(0.4))]
    # world
    P['door'] = lambda: KR('door*') + files('rd100', 'door*') + files('rd100b', '*door*') + KR('creak*')
    P['metal_door'] = lambda: [('mix:latch%d' % i, 'rpg', mixdown((S('rpg', 'metalLatch.ogg'), 0, 1.0), (S('impact', 'impactMetal_medium_00%d.ogg' % i), 0.05, 0.7))) for i in range(5)] + K('impactMetal_heavy_*') + files('rd100', 'metal_*')
    P['trapdoor'] = lambda: [('mix:trap%d' % i, 'rpg', mixdown((S('rpg', 'creak3.ogg'), 0, 0.7), (S('impact', 'impactWood_light_00%d.ogg' % i), 0.05, 1.0))) for i in range(5)] + K('impactWood_medium_*') + K('impactPlank_medium_*')
    P['gate'] = lambda: [('mix:gate%d' % i, 'rpg', mixdown((S('rpg', 'creak%d.ogg' % (1 + i % 3)), 0, 1.0), (S('impact', 'impactWood_light_00%d.ogg' % i), 0.0, 0.6))) for i in range(5)] + K('impactWood_heavy_*') + KR('creak*')
    P['chest_open'] = lambda: files('rd100', 'wooded_box_open*') + [('mix:chest%d' % i, 'rpg', mixdown((S('rpg', 'creak%d.ogg' % (1 + i % 3)), 0, 1.0), (S('rpg', 'bookPlace%d.ogg' % (1 + i % 3)), 0.3, 0.5))) for i in range(3)] + KR('creak*') + KR('doorOpen*')
    P['chest_close'] = lambda: [('mix:shut%d' % i, 'rpg', mixdown((S('impact', 'impactWood_heavy_00%d.ogg' % i), 0, 1.0), (S('rpg', 'bookClose.ogg'), 0.0, 0.5))) for i in range(5)] + KR('doorClose*') + KR('bookClose*')
    P['button'] = lambda: KU('click_*') + KU('switch_*') + KU('toggle_*') + KR('metalClick*') + files('rd100b', '*switch*')
    P['lever'] = lambda: files('rd100b', '*switch*') + KU('switch_*') + KU('toggle_*') + files('rd100', 'switch_*') + KR('metalClick*')
    P['plate'] = lambda: KU('tick_*') + KU('click_*') + KU('toggle_*') + K('impactWood_light_*')
    P['piston'] = lambda: files('rd100', 'machine_*') + files('rd100', 'slam_*') + [('mix:piston%d' % i, 'impact', mixdown((S('impact', 'impactPlank_medium_00%d.ogg' % i), 0, 1.0), (S('impact', 'impactMetal_light_00%d.ogg' % i), 0.02, 0.5))) for i in range(5)] + files('rd100b', '*misc_*')
    P['explode'] = lambda: files('synthboom') + files('rd100', 'explosion*') + files('muffled') + files('rdbang', 'bang_*') + files('rdbang', 'cannon_*')
    P['fuse'] = lambda: files('fuse') + [('synth:fuse%d' % i, 'synth', synth_fuse(2.6)) for i in range(3)]
    P['fire'] = lambda: windows('fire', '*', 1.8, 10) + windows('fire', '*', 2.8, 6) + windows('fire', '*', 2.2, 6)
    P['fizz'] = lambda: [('synth:fizz%d' % i, 'synth', synth_fizz(0.3 + 0.15 * i)) for i in range(5)] + files('rd100b', '*air_*') + files('rdloops', 'noise_*', lambda x: x[:int(0.8 * SR)])
    P['ignite'] = lambda: [('mix:flint%d' % i, 'rpg', mixdown((S('rpg', 'metalClick.ogg'), 0, 1.0), (synth_fizz(0.35), 0.03, 0.4))) for i in range(3)] + KR('metalClick*') + files('rd100', 'key_open*') + KR('drawKnife*')
    P['lava_pop'] = lambda: files('rdwater', 'bubble_*', lambda x: lp(x, 3000)) + files('rd100', 'plop_*', lambda x: lp(x, 2500)) + files('rdwater', 'slime_*', lambda x: lp(x, 2000))
    P['lava'] = lambda: windows('rdloops', 'water_boiling*', 6.8, 4, fn=lambda x: lp(resample(x, 0.8), 700)) + windows('rdloops', 'water_boiling*', 1.6, 6, fn=lambda x: lp(x, 1500)) + windows('rdloops', 'water_boiling*', 0.8, 4, fn=lambda x: lp(x, 2000))
    P['water'] = lambda: windows('rdwater', 'loop_water_0*', 1.8, 6) + windows('rdloops', 'water_flowing*', 1.8, 4)
    P['rain'] = lambda: windows('rain', '*', 2.2, 12) + windows('rdloops', 'rain*', 2.2, 4) + windows('rdwater', 'loop_rain*', 2.2, 4)
    P['thunder'] = lambda: [('thunder:long@%d' % t, 'thunder', fades(S('thunder')[int(t * SR):int((t + 9) * SR)], 0.05, 3.0)) for t in (18.5, 40, 61)] + files('rd100b', '*thunder*') + files('muffled')
    P['cave'] = lambda: windows('dungeon', '*', 6.0, 10) + windows('basement', '*', 5.0, 4) + files('cavein') + windows('rdloops', 'ambient_*', 6.0, 2) + windows('rdloops', 'weird_*', 5.0, 2) + windows('rd100b', '*loop_ambient*', 5.0, 2)
    P['underwater_loop'] = lambda: windows('rd100b', '*loop_water_0*', 8, 2, fn=lambda x: lp(resample(x, 0.7), 600)) + windows('rdwater', 'loop_bubbles*', 8, 2, fn=lambda x: lp(x, 700))
    P['underwater_add'] = lambda: (files('rdwater', 'bubble_*', lambda x: lp(x, 1200)) + files('rdwater', 'slime_*', lambda x: lp(x, 900)) + pieces('peludo3', '*', 0.3, 2.5, fn=lambda x: lp(x, 1000))
                                    + windows('rdwater', 'loop_bubbles*', 3.0, 3, fn=lambda x: lp(resample(x, 0.7), 700)) + windows('rdwater', 'loop_bubbles*', 9.0, 2, fn=lambda x: lp(resample(x, 0.5), 400))
                                    + windows('rd100b', '*loop_water_0*', 9.0, 2, fn=lambda x: lp(resample(x, 0.5), 300)))
    P['underwater_move'] = lambda: files('rdwater', 'splash_*', lambda x: lp(x, 800)) + files('peludo1', '*', lambda x: lp(x, 800)) + files('peludo2', '*', lambda x: lp(x, 800))
    P['nether_loop'] = lambda: windows('dungeon', '*', 10, 1, fn=lambda x: lp(resample(x, 0.8), 900))
    P['portal'] = lambda: [('synth:portal%d' % i, 'synth', synth_portal(3.5 + i, False, c)) for i, c in enumerate((350, 500, 700))] + windows('rdloops', 'weird_*', 4.5, 3)
    P['portal_trigger'] = lambda: [('synth:trigger%d' % i, 'synth', synth_portal(d, True, c)) for i, (d, c) in enumerate(((3.1, 900), (4.2, 1200), (8.5, 1400)))] + windows('rdloops', 'weird_*', 4, 2)
    P['bucket'] = lambda: files('rdwater', 'splash_*') + files('rdwater', 'slime_*') + files('peludo1') + files('peludo2')
    P['bucket_lava'] = lambda: files('rdwater', 'slime_*', lambda x: lp(resample(x, 0.8), 2000)) + files('rdwater', 'splash_*', lambda x: lp(resample(x, 0.75), 1500))
    P['bell'] = lambda: files('rd100', 'bell_*') + files('rd100', 'gong_*') + K('impactBell_heavy_*')
    P['anvil'] = lambda: [('mix:clang%d' % i, 'impact', mixdown((S('impact', 'impactMetal_heavy_00%d.ogg' % i), 0, 1.0), (S('impact', 'impactBell_heavy_00%d.ogg' % i), 0.0, 0.6), (S('impact', 'impactMetal_medium_00%d.ogg' % ((i + 1) % 5)), 0.75, 0.8))) for i in range(5)] + K('impactMetal_heavy_*') + files('rd100', 'metal_*') + K('impactBell_heavy_*') + K('impactPlate_heavy_*')
    P['dispense'] = lambda: KU('click_*') + KR('metalClick*') + KU('switch_*') + KU('tick_*')
    P['totem'] = lambda: [('synth:totem%d' % i, 'synth', mixdown((synth_portal(3.2, False, 700 + 300 * i), 0, 1.0), (synth_levelup(), 0.4, 0.25))) for i in range(3)] + files('jingles', '*hit*') + files('jingles', '*steel*') + KU('maximize_*')
    P['bow'] = lambda: files('rd100', 'spring_*') + KR('drawKnife*') + files('rd100b', '*air_*')
    P['arrow_hit'] = lambda: K('impactWood_light_*') + files('rd100', 'hit_*') + K('impactPlank_medium_*') + files('rd100b', '*wood_hit*')
    P['equip'] = lambda: KR('cloth*') + KR('beltHandle*') + KR('clothBelt*') + KR('metalClick*') + KR('metalLatch*') + KR('handleSmallLeather*')
    P['equip_metal'] = lambda: KR('metalLatch*') + KR('beltHandle*') + KR('metalClick*') + K('impactMetal_light_*') + KR('metalPot*')
    P['shield'] = lambda: K('impactWood_heavy_*') + K('impactPlank_medium_*') + K('impactPunch_heavy_*')
    P['till'] = lambda: K('footstep_grass_*') + files('kdd', 'mud*') + files('kdd', 'gravel*') + K('footstep_snow_*')
    P['strip'] = lambda: KR('knifeSlice*') + KR('drawKnife*') + K('impactWood_light_*') + KR('chop*')
    P['shear'] = lambda: KR('knifeSlice*') + KR('drawKnife*') + files('rd100', 'tools_*')
    P['plant'] = lambda: K('footstep_grass_*') + files('kdd', 'leaves*') + files('kdd', 'mud*')
    # mobs
    P['zombie'] = lambda: files('zombies') + pieces('moans', '*', 0.4, 3.0, -35, 0.2) + files('voicefx', 'zombie*')
    P['zombie_hurt'] = lambda: files('zombies') + files('voicefx', 'zombieyell*') + pieces('moans', '*', 0.2, 1.5, -35, 0.15)
    P['zombie_death'] = lambda: files('zombies') + files('voicefx', 'zombiedeath*') + pieces('moans', '*', 0.6, 3.0, -35, 0.2)
    P['heavy_step'] = lambda: K('impactSoft_medium_*', ) + K('footstep_concrete_*') + files('rpg', 'footstep*') + K('impactSoft_heavy_*')
    P['bones'] = lambda: files('bones') + [('mix:rattle%d' % k, 'bones', np.concatenate([fades(S('bones', '%d.ogg' % i)[:int(0.16 * SR)], 0.001, 0.04) for i in rng.permutation(10)[:4]])) for k in range(5)]
    P['skeleton_death'] = lambda: files('skeleton1') + files('skeleton') + [('mix:collapse%d' % k, 'bones', np.concatenate([fades(S('bones', '%d.ogg' % i)[:int(0.2 * SR)], 0.001, 0.05) for i in rng.permutation(10)[:6]])) for k in range(3)]
    P['creeper'] = lambda: files('rdcreature', 'hurt_*') + files('rdcreature', 'grunt_*') + files('rdcreature', 'monster_*') + files('rdcreature', 'breath*')
    P['spider'] = lambda: [('synth:hiss%d' % i, 'synth', synth_hiss(1.0 + 0.2 * i)) for i in range(3)] + files('rdcreature', 'bug_*') + files('rdcreature', 'misc_*') + files('rdcreature', 'spit_*') + files('rdcreature', 'weird_*')
    P['spider_step'] = lambda: files('bones', '*', lambda x: resample(x, 1.5)) + KU('tick_*') + KU('scratch_*')
    P['cow'] = lambda: files('cow', 'moo*') + [('cow:moo-r%d' % i, 'cow', resample(S('cow', 'moo-notification.wav'), r)) for i, r in enumerate((0.9, 1.1, 0.95))] + files('yak') + [('yak:r', 'yak', resample(S('yak'), 0.9))]
    P['cow_hurt'] = lambda: files('yak') + [('yak:r%d' % i, 'yak', resample(S('yak'), r)) for i, r in enumerate((0.85, 1.1))] + files('cow', 'moo*')
    P['animal_step'] = lambda: files('rpg', 'footstep*', lambda x: lp(x, 1800)) + K('footstep_grass_*') + K('impactSoft_medium_*')
    P['pig'] = lambda: files('pig1') + files('pig2') + files('pig3') + files('pig4') + files('pig5') + files('pig6')
    P['pig_hurt'] = lambda: files('pig5') + files('pig6') + files('pig1') + files('pig2')
    P['sheep'] = lambda: files('sheep') + files('frankie1') + files('frankie2') + files('frankie3') + files('frankie4')
    P['chicken'] = lambda: pieces('chicken', '*.ogg', 0.05, 1.5, -30, 0.06) + pieces('chicken', '*.mp3', 0.05, 1.5, -30, 0.06)
    P['generic_hurt'] = lambda: pieces('grunts', '*', 0.06, 0.8, -35, 0.15) + K('impactPunch_medium_*') + K('impactSoft_medium_*')
    P['slime'] = lambda: files('rdwater', 'slime_*')
    return P


# vanilla events with no recordings of their own here: the nearest built one by measurement
ALIAS_KINDS = ('step', 'break', 'place', 'hit', 'fall')


def alias_blocks():
    """every block sound type the game has, played from the nearest type built here, pitched to match"""
    built = {}
    for ev in EVENTS:
        p = ev.split('.')
        if p[0] == 'block' and len(p) == 3 and p[2] in ALIAS_KINDS:
            built.setdefault(p[2], []).append(ev)
    for ev, T in TARGETS.items():
        if ev in EVENTS or not ev.startswith('block.'):
            continue
        p = ev.split('.')
        if len(p) != 3 or p[2] not in ALIAS_KINDS:
            continue
        same = BUILT_SIG.get(T.get('sig'))
        if same:
            ref(ev, same)
            continue
        best = None
        for cand in built.get(p[2], []):
            C = TARGETS[cand]
            d = distance(C, T)
            if best is None or d < best[0]:
                best = (d, cand)
        if not best:
            continue
        C = TARGETS[best[1]]
        pitch = float(np.clip(((T['centroid'] + 50) / (C['centroid'] + 50)) ** 0.5, 0.75, 1.35))
        vol = float(np.clip(T['rms'] / max(C['rms'], 1e-5), 0.3, 2.0))
        ref(ev, best[1], pitch, vol)


# the mobs Leoncraft has recordings for, and the ones that borrow them (name, pitch)
MOB_ALIASES = {
    'husk': ('zombie', 0.85), 'drowned': ('zombie', 0.95), 'zombie_villager': ('zombie', 1.1), 'zombified_piglin': ('zombie', 0.8),
    'zoglin': ('zombie', 0.7), 'giant': ('zombie', 0.6),
    'stray': ('skeleton', 0.9), 'wither_skeleton': ('skeleton', 0.8), 'bogged': ('skeleton', 1.05), 'skeleton_horse': ('skeleton', 1.2),
    'cave_spider': ('spider', 1.2), 'mooshroom': ('cow', 1.0), 'goat': ('sheep', 0.9), 'llama': ('sheep', 0.8),
}
MOB_KINDS = ('ambient', 'hurt', 'death', 'step')


def alias_mobs():
    for m, (to, p) in MOB_ALIASES.items():
        for k in MOB_KINDS:
            if 'entity.%s.%s' % (to, k) in EVENTS and 'entity.%s.%s' % (m, k) in TARGETS:
                ref('entity.%s.%s' % (m, k), 'entity.%s.%s' % (to, k), p)
    # any other mob is heard when hurt and killed (the generic sounds), and silent otherwise
    for ev in TARGETS:
        p = ev.split('.')
        if p[0] != 'entity' or len(p) != 3 or ev in EVENTS:
            continue
        if p[2] == 'hurt' and 'entity.generic.hurt' in EVENTS:
            ref(ev, 'entity.generic.hurt', 1.0)
        elif p[2] == 'death' and 'entity.generic.hurt' in EVENTS:
            ref(ev, 'entity.generic.hurt', 0.85)


# ------------------------------------------------------------------ the music
# (id, source, file pattern, where it plays)
MUSIC = [
    ('first_light', 'm_firstlight', '*', ['menu', 'game']),
    ('budding', 'm_budding', '*', ['menu', 'game', 'creative']),
    ('deep_blue', 'm_yoiyami', '*', ['game', 'creative']),
    ('snowfall', 'm_snowfall', '*', ['game', 'menu']),
    ('another_august', 'm_august', '*', ['game', 'creative']),
    ('november_snow', 'm_november', '*', ['game', 'creative']),
    ('meadow_thoughts', 'm_meadow', '*', ['game', 'menu']),
    ('happy_lullaby', 'm_lullaby', '*', ['creative']),
    ('crystal_cave', 'm_crystal', '*', ['game', 'under_water']),
    ('mysterious', 'm_mystery', '*', ['nether', 'game']),
    ('dungeon', 'm_dungeon', '*', ['nether']),
    ('galactic_temple', 'm_galactic', '*.ogg', ['end', 'credits']),
    ('observing_the_star', 'm_star', '*.ogg', ['end']),
    ('dark_intro', 'm_darkintro', '*', ['dragon']),
    ('underwater', 'm_underwater', '*.ogg', ['under_water']),
    ('underwater_pad', 'm_pad', '*', ['under_water']),
]
MUSIC_RMS = None    # the game's music loudness, measured (set in main)


def build_music(q):
    os.makedirs(os.path.join(OUT, 'music'), exist_ok=True)
    out = {}
    for tid, sid, pat, where in MUSIC:
        fs = [n for n in sorted(listing(sid)) if fnmatch.fnmatch(n.lower(), pat.lower())]
        pcm = decode(listing(sid)[fs[0]], 32000, mono=False)
        if pcm.ndim == 1:
            pcm = np.stack([pcm, pcm], 1)
        r = float(np.sqrt(np.mean(pcm ** 2)))
        gain = min(MUSIC_RMS / (r + 1e-9), 4.0)
        pcm = np.clip(pcm * gain, -0.98, 0.98)
        n = pcm.shape[0]
        fade = np.ones(n, np.float32)
        k = min(n // 4, int(2.5 * 32000))
        fade[n - k:] = np.linspace(1, 0, k)
        fade[:int(0.05 * 32000)] = np.linspace(0, 1, int(0.05 * 32000))
        pcm = pcm * fade[:, None]
        import tempfile, subprocess, scipy.io.wavfile as wf
        from soundlib import FF
        fd, tmp = tempfile.mkstemp(suffix='.wav')
        os.close(fd)
        wf.write(tmp, 32000, (pcm * 32767).astype(np.int16))
        dst = os.path.join(OUT, 'music', tid + '.ogg')
        subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-c:a', 'libvorbis', '-q:a', str(q), dst], check=True)
        os.remove(tmp)
        USED.add(sid)
        _, _, title, author, lic, page = SOURCES[sid][:6]
        out['music/' + tid] = {'file': 'music/' + tid + '.ogg', 'title': title, 'by': author, 'licence': lic, 'where': where, 'seconds': round(n / 32000, 1)}
        print('music %-20s %6.1f s %7.1f KB' % (tid, n / 32000, os.path.getsize(dst) / 1024))
    return out


def music_events(music):
    """music.menu, music.game... as the game names them, each a list of our tracks"""
    by = {}
    for name, m in music.items():
        for w in m['where']:
            by.setdefault(w, []).append(name)
    st = lambda names: [{'name': n, 'stream': True} for n in names]
    EVENTS['music.menu'] = {'sounds': st(by['menu'])}
    EVENTS['music.game'] = {'sounds': st(by['game'])}
    EVENTS['music.creative'] = {'sounds': [{'name': 'music.game', 'type': 'event'}] + st(by['creative'])}
    EVENTS['music.under_water'] = {'sounds': st(by['under_water'])}
    EVENTS['music.end'] = {'sounds': st(by['end'])}
    EVENTS['music.dragon'] = {'sounds': st(by['dragon'])}
    EVENTS['music.credits'] = {'sounds': st(by['credits'])}
    for b in ('basalt_deltas', 'crimson_forest', 'nether_wastes', 'soul_sand_valley', 'warped_forest'):
        EVENTS['music.nether.' + b] = {'sounds': st(by['nether'])}
    for ev in TARGETS['music']:
        if ev.startswith('music.overworld.'):
            EVENTS[ev] = {'sounds': [{'name': 'music.game', 'type': 'event'}]}
    # music discs play our tracks (one each, the same every time)
    names = sorted(music)
    for i, ev in enumerate(sorted(e for e in TARGETS['music'] if e.startswith('music_disc.'))):
        EVENTS[ev] = {'sounds': st([names[i % len(names)]]), 'subtitle': 'subtitles.jukebox_song'}


# ------------------------------------------------------------------ credits
def write_credits():
    lines = ['Leoncraft 2 - sound and music credits', '',
             'Every sound and track Leoncraft plays by default is one of these openly',
             'licensed recordings (cut, pitched, filtered and levelled for the game by',
             'tools/leoncraft2/build_sounds.py), or made by that script itself (the',
             'note block instruments and a few small tones). None is Mojang\'s.', '',
             'CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/',
             'CC BY 3.0: https://creativecommons.org/licenses/by/3.0/ (credit required; changed for the game)', '']
    seen = {}
    for sid in sorted(USED):
        if sid not in SOURCES:
            continue
        url, kind, title, author, lic, page = SOURCES[sid]
        seen.setdefault((title, author, lic, page), True)
    rows = sorted(seen, key=lambda r: (r[2] != BY3, r[1].lower(), r[0].lower()))
    for title, author, lic, page in rows:
        lines.append('"%s" by %s, %s' % (title, author, lic))
        lines.append('    ' + page)
    open(os.path.join(OUT, 'CREDITS.txt'), 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
    js = ['/* GENERATED by tools/leoncraft2/build_sounds.py - do not edit by hand.',
          '   The recordings Leoncraft\'s own sounds and music are made from, for the',
          '   Credits screen: [title, author, licence, page]. */',
          'export const SOUND_CREDITS = ' + json.dumps([list(r) for r in rows], indent=0).replace('\n', '') + ';', '']
    open(JS_CREDITS, 'w', encoding='utf-8', newline='\n').write('\n'.join(js))


def write_subtitle_text():
    keys = sorted({e['subtitle'] for e in EVENTS.values() if e.get('subtitle')} | set(EXTRA_SUBS))
    text = {k: TARGETS['text'][k] for k in keys if k in TARGETS['text']}
    js = ['/* GENERATED by tools/leoncraft2/build_sounds.py - do not edit by hand.',
          '   The subtitle lines (Closed Captions) for the sounds Leoncraft plays, in',
          '   English, keyed as the game keys them. A player\'s own Minecraft brings its',
          '   own (js/sound/packs.js reads its en_us.json). */',
          'export const SUBTITLES = ' + json.dumps(text, indent=0, ensure_ascii=False) + ';', '']
    open(JS_TEXT, 'w', encoding='utf-8', newline='\n').write('\n'.join(js))


# subtitle lines the game shows for events it plays from a player's own Minecraft sounds that are not built here
EXTRA_SUBS = []


# ------------------------------------------------------------------ main
def main():
    global SRC, TARGETS, MUSIC_RMS
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--q', default='3')
    ap.add_argument('--music-q', default='2')
    ap.add_argument('--no-music', action='store_true')
    a = ap.parse_args()
    SRC = os.path.abspath(a.src)
    if a.fetch:
        fetch()
    raw = json.load(open(os.path.join(HERE, 'sound_targets.json')))
    TARGETS = dict(raw['events'])
    TARGETS['subs'] = raw.get('subtitles', {})
    TARGETS['text'] = raw.get('text', {})
    TARGETS['music'] = [e for e in raw.get('subtitles', {})] + [e for e in raw.get('music_events', [])]
    TARGETS['music'] = raw.get('music_events', [])
    MUSIC_RMS = raw.get('music_rms', 0.06)
    for name, load in (('ui', 'now'), ('blocks', 'now'), ('player', 'world'), ('world', 'world'), ('ambient', 'world'), ('mobs', 'world'), ('notes', 'world')):
        BANKS[name] = Bank(name, load)
    P = pools()
    rep = a.report
    B = lambda bank, ev, pool, **kw: build(bank, ev, P[pool], report=rep, **kw)

    B('ui', 'ui.button.click', 'click', maxn=1)
    # blocks: the families with recordings of their own
    for fam, step, dig, kw in (('stone', 'stone_step', 'stone_dig', {}), ('wood', 'wood_step', 'wood_dig', {}),
                               ('grass', 'grass_step', 'grass_dig', {}), ('gravel', 'gravel_step', 'gravel_dig', {}),
                               ('sand', 'sand_step', 'sand_dig', {}), ('snow', 'snow_step', 'snow_dig', {}),
                               ('wool', 'cloth_step', 'cloth_dig', {}), ('metal', 'metal', 'metal', {}), ('glass', 'stone_step', 'glass_break', {}),
                               ('ladder', 'wood_step', 'wood_dig', {}), ('iron', 'metal', 'metal', {}), ('anvil', 'metal', 'anvil', {})):
        B('blocks', 'block.%s.break' % fam, dig, **kw)
        B('blocks', 'block.%s.step' % fam, step, **kw)
        for k in ('place', 'hit', 'fall'):
            B('blocks', 'block.%s.%s' % (fam, k), step if k != 'place' else dig, **kw)
    # player
    B('player', 'entity.player.hurt', 'hurt', maxn=4)
    B('player', 'entity.player.death', 'hurt')
    B('player', 'entity.player.hurt_drown', 'drink')
    B('player', 'entity.player.hurt_on_fire', 'fire_hurt')
    B('player', 'entity.player.small_fall', 'fall')
    B('player', 'entity.player.big_fall', 'fall')
    B('player', 'entity.player.splash', 'splash')
    B('player', 'entity.player.splash.high_speed', 'splash')
    B('player', 'entity.player.swim', 'swim', maxn=5)
    B('player', 'entity.generic.eat', 'eat')
    B('player', 'entity.generic.drink', 'drink')
    B('player', 'entity.player.burp', 'burp')
    B('player', 'entity.player.levelup', 'levelup', cut=False)
    B('player', 'entity.experience_orb.pickup', 'orb')
    B('player', 'entity.item.pickup', 'pop')
    B('player', 'entity.item.break', 'itembreak')
    for k in ('strong', 'weak', 'crit', 'sweep', 'knockback', 'nodamage'):
        B('player', 'entity.player.attack.' + k, 'attack' if k != 'sweep' else 'whoosh')
    B('player', 'entity.generic.hurt', 'generic_hurt')
    B('player', 'entity.generic.small_fall', 'fall')
    B('player', 'entity.generic.big_fall', 'fall')
    B('player', 'item.totem.use', 'totem', cut=False)
    B('player', 'entity.arrow.shoot', 'bow')
    B('player', 'entity.arrow.hit', 'arrow_hit')
    B('player', 'entity.arrow.hit_player', 'orb', maxn=1)
    B('player', 'entity.snowball.throw', 'whoosh')
    B('player', 'entity.egg.throw', 'whoosh')
    B('player', 'entity.ender_pearl.throw', 'whoosh')
    B('player', 'item.armor.equip_generic', 'equip', maxn=3)
    ref('item.armor.equip_leather', 'item.armor.equip_generic', 0.95)
    ref('item.armor.equip_elytra', 'item.armor.equip_generic', 1.1)
    B('player', 'item.armor.equip_iron', 'equip_metal', maxn=3)
    for m, pt in (('gold', 1.15), ('diamond', 1.05), ('netherite', 0.85), ('chain', 1.2), ('turtle', 0.9), ('copper', 1.0)):
        ref('item.armor.equip_' + m, 'item.armor.equip_iron', pt)
    B('player', 'item.shield.block', 'shield')
    B('player', 'item.shield.break', 'itembreak')
    B('player', 'item.hoe.till', 'till')
    B('player', 'item.axe.strip', 'strip')
    B('player', 'item.shovel.flatten', 'till')
    B('player', 'item.crop.plant', 'plant', maxn=3)
    ref('item.bone_meal.use', 'item.crop.plant', 1.2)
    ref('item.nether_wart.plant', 'item.crop.plant', 0.8)
    B('player', 'entity.sheep.shear', 'shear')
    # world
    # doors, trapdoors, gates, chests, buttons and plates: the plain wooden and iron ones get recordings,
    # the other woods and metals play those, pitched and levelled to their own by measurement (like())
    for k in ('open', 'close'):
        B('world', 'block.wooden_door.' + k, 'door', maxn=3)
        B('world', 'block.iron_door.' + k, 'metal_door', maxn=2)
        B('world', 'block.wooden_trapdoor.' + k, 'trapdoor', maxn=3)
        B('world', 'block.iron_trapdoor.' + k, 'metal_door', maxn=2)
        B('world', 'block.fence_gate.' + k, 'gate', maxn=3)
        for w in ('cherry_wood', 'bamboo_wood', 'nether_wood'):
            like('block.%s_door.%s' % (w, k), 'block.wooden_door.' + k)
            like('block.%s_trapdoor.%s' % (w, k), 'block.wooden_trapdoor.' + k)
            like('block.%s_fence_gate.%s' % (w, k), 'block.fence_gate.' + k)
        like('block.copper_door.' + k, 'block.iron_door.' + k)
        like('block.copper_trapdoor.' + k, 'block.iron_trapdoor.' + k)
    B('world', 'block.chest.open', 'chest_open', maxn=2)
    B('world', 'block.chest.close', 'chest_close', maxn=3)
    for c in ('ender_chest', 'barrel', 'shulker_box', 'copper_chest'):
        for k in ('open', 'close'):
            like('block.%s.%s' % (c, k), 'block.chest.' + k)
    for k in ('click_on', 'click_off'):
        B('world', 'block.stone_button.' + k, 'button', maxn=1)
        B('world', 'block.wooden_button.' + k, 'button', maxn=1)
        B('world', 'block.stone_pressure_plate.' + k, 'plate', maxn=1)
        B('world', 'block.wooden_pressure_plate.' + k, 'plate', maxn=1)
        like('block.metal_pressure_plate.' + k, 'block.stone_pressure_plate.' + k)
        for w in ('cherry_wood', 'bamboo_wood', 'nether_wood'):
            like('block.%s_button.%s' % (w, k), 'block.wooden_button.' + k)
            like('block.%s_pressure_plate.%s' % (w, k), 'block.wooden_pressure_plate.' + k)
    B('world', 'block.lever.click', 'lever')
    B('world', 'block.comparator.click', 'lever')
    B('world', 'block.tripwire.click_on', 'button')
    B('world', 'block.tripwire.click_off', 'button')
    B('world', 'block.tripwire.attach', 'button')
    B('world', 'block.tripwire.detach', 'button')
    B('world', 'block.piston.extend', 'piston')
    B('world', 'block.piston.contract', 'piston')
    B('world', 'entity.generic.explode', 'explode', cut=False, maxn=3)
    B('world', 'entity.tnt.primed', 'fuse', cut=False)
    B('world', 'entity.creeper.primed', 'fuse', cut=False)
    B('ambient', 'block.fire.ambient', 'fire', maxn=3)
    B('world', 'block.fire.extinguish', 'fizz', maxn=2)
    B('world', 'item.flintandsteel.use', 'ignite')
    B('world', 'item.firecharge.use', 'ignite')
    B('world', 'block.lava.pop', 'lava_pop')
    B('ambient', 'block.lava.ambient', 'lava', n=1)
    B('world', 'block.lava.extinguish', 'fizz')
    B('ambient', 'block.water.ambient', 'water', maxn=3)
    B('ambient', 'weather.rain', 'rain', maxn=6)
    B('ambient', 'weather.rain.above', 'rain', maxn=3)
    B('ambient', 'entity.lightning_bolt.thunder', 'thunder', cut=False, maxn=3)
    B('ambient', 'entity.lightning_bolt.impact', 'explode', maxn=2)
    B('ambient', 'ambient.cave', 'cave', maxn=6)
    B('ambient', 'ambient.underwater.enter', 'underwater_move')
    B('ambient', 'ambient.underwater.exit', 'underwater_move')
    B('ambient', 'ambient.underwater.loop.additions', 'underwater_add', maxn=4)
    B('ambient', 'ambient.underwater.loop.additions.rare', 'underwater_add', maxn=2)
    B('ambient', 'ambient.underwater.loop.additions.ultra_rare', 'underwater_add', n=1)
    B('ambient', 'block.portal.ambient', 'portal', n=1)
    B('ambient', 'block.portal.trigger', 'portal_trigger', n=1)
    B('ambient', 'block.portal.travel', 'portal_trigger', n=1)
    B('world', 'item.bucket.fill', 'bucket', maxn=2)
    B('world', 'item.bucket.empty', 'bucket', maxn=2)
    B('world', 'item.bucket.fill_lava', 'bucket_lava', maxn=2)
    B('world', 'item.bucket.empty_lava', 'bucket_lava', maxn=2)
    B('world', 'item.bottle.fill', 'bucket', maxn=2)
    B('world', 'block.bell.use', 'bell', maxn=1)
    B('world', 'block.anvil.use', 'anvil')
    B('world', 'block.anvil.land', 'anvil')
    B('world', 'block.anvil.destroy', 'anvil')
    B('ambient', 'block.furnace.fire_crackle', 'fire', maxn=3)
    ref('block.smoker.smoke', 'block.furnace.fire_crackle', 0.9)
    ref('block.blastfurnace.fire_crackle', 'block.furnace.fire_crackle', 1.1)
    B('ambient', 'block.campfire.crackle', 'fire', maxn=3)
    B('world', 'block.dispenser.dispense', 'dispense')
    B('world', 'block.dispenser.fail', 'dispense')
    B('world', 'block.dispenser.launch', 'whoosh')
    B('world', 'block.redstone_torch.burnout', 'fizz')
    B('world', 'block.composter.fill', 'plant', maxn=2)
    B('world', 'block.composter.fill_success', 'plant')
    B('world', 'block.end_portal_frame.fill', 'anvil', maxn=2)
    B('world', 'block.respawn_anchor.charge', 'portal_trigger', n=1)
    B('world', 'block.enchantment_table.use', 'levelup', maxn=1)
    B('world', 'block.brewing_stand.brew', 'lava_pop')
    B('world', 'block.grindstone.use', 'strip')
    B('world', 'block.smithing_table.use', 'anvil')
    B('world', 'ui.stonecutter.take_result', 'strip')
    like('ui.loom.take_result', 'block.wool.break')
    like('ui.cartography_table.take_result', 'block.wool.break')
    B('world', 'entity.item_frame.add_item', 'equip')
    B('world', 'entity.item_frame.remove_item', 'equip')
    B('world', 'entity.boat.paddle_water', 'swim', maxn=2)
    B('world', 'entity.minecart.riding', 'piston', maxn=1)
    B('world', 'block.sweet_berry_bush.pick_berries', 'plant')
    # mobs
    for k in ('ambient', 'hurt', 'death'):
        B('mobs', 'entity.zombie.' + k, {'ambient': 'zombie', 'hurt': 'zombie_hurt', 'death': 'zombie_death'}[k])
    B('mobs', 'entity.zombie.step', 'heavy_step')
    B('mobs', 'entity.skeleton.ambient', 'bones')
    B('mobs', 'entity.skeleton.hurt', 'bones')
    B('mobs', 'entity.skeleton.death', 'skeleton_death')
    B('mobs', 'entity.skeleton.step', 'bones')
    B('mobs', 'entity.skeleton.shoot', 'bow')
    B('mobs', 'entity.creeper.hurt', 'creeper')
    B('mobs', 'entity.creeper.death', 'creeper')
    for k in ('ambient', 'hurt', 'death'):
        B('mobs', 'entity.spider.' + k, 'spider')
    B('mobs', 'entity.spider.step', 'spider_step')
    B('mobs', 'entity.cow.ambient', 'cow')
    B('mobs', 'entity.cow.hurt', 'cow_hurt')
    B('mobs', 'entity.cow.death', 'cow')
    B('mobs', 'entity.cow.step', 'animal_step')
    B('mobs', 'entity.cow.milk', 'bucket')
    B('mobs', 'entity.pig.ambient', 'pig')
    B('mobs', 'entity.pig.hurt', 'pig_hurt')
    B('mobs', 'entity.pig.death', 'pig_hurt')
    B('mobs', 'entity.pig.step', 'animal_step')
    B('mobs', 'entity.sheep.ambient', 'sheep')
    B('mobs', 'entity.sheep.hurt', 'sheep')
    B('mobs', 'entity.sheep.death', 'sheep')
    B('mobs', 'entity.sheep.step', 'animal_step')
    B('mobs', 'entity.chicken.ambient', 'chicken')
    B('mobs', 'entity.chicken.hurt', 'chicken')
    B('mobs', 'entity.chicken.death', 'chicken')
    B('mobs', 'entity.chicken.step', 'animal_step')
    B('mobs', 'entity.chicken.egg', 'pop')
    B('mobs', 'entity.slime.squish', 'slime')
    B('mobs', 'entity.slime.jump', 'slime')
    B('mobs', 'entity.slime.hurt', 'slime')
    B('mobs', 'entity.slime.death', 'slime')
    # the note block's sixteen instruments (our own synthesis), each played 0.5-2x from F#4
    for inst in ('harp', 'bass', 'basedrum', 'snare', 'hat', 'bell', 'flute', 'chime', 'guitar', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling'):
        ev = 'block.note_block.' + inst
        T = TARGETS.get(ev)
        c = note_instrument(inst)
        if T:
            f = features(c)
            c = c * (T['rms'] / max(f['rms'], 1e-6))
        put('notes', ev, [np.clip(c, -0.98, 0.98).astype(np.float32)])
    # more of what the game plays, from the nearest sound built here
    for ev, to, pt, vo in (('item.honey_bottle.drink', 'entity.generic.drink', 0.9, 1), ('entity.player.hurt_freeze', 'entity.player.hurt', 1.1, 1),
                           ('entity.player.hurt_sweet_berry_bush', 'entity.player.hurt', 1.0, 1), ('enchant.thorns.hit', 'entity.player.attack.crit', 1.2, 1),
                           ('item.axe.scrape', 'item.axe.strip', 1.2, 1), ('item.axe.wax_off', 'item.axe.strip', 1.3, 1), ('item.honeycomb.wax_on', 'item.axe.strip', 1.4, 1),
                           ('item.bucket.fill_powder_snow', 'block.snow.break', 1.0, 1), ('item.bucket.empty_powder_snow', 'block.snow.break', 0.9, 1),
                           ('block.beehive.shear', 'entity.sheep.shear', 1.0, 1), ('item.crossbow.shoot', 'entity.arrow.shoot', 1.1, 1),
                           ('item.crossbow.loading_end', 'item.armor.equip_iron', 1.3, 1), ('item.trident.throw', 'entity.player.attack.sweep', 0.9, 1),
                           ('entity.splash_potion.throw', 'entity.snowball.throw', 1, 1), ('entity.lingering_potion.throw', 'entity.snowball.throw', 1, 1),
                           ('entity.experience_bottle.throw', 'entity.snowball.throw', 1, 1), ('entity.ender_eye.launch', 'entity.snowball.throw', 0.9, 1),
                           ('entity.husk.step', 'entity.zombie.step', 1, 1), ('entity.drowned.step', 'entity.zombie.step', 1, 1),
                           ('entity.stray.step', 'entity.skeleton.step', 1, 1), ('entity.wither_skeleton.step', 'entity.skeleton.step', 0.8, 1),
                           ('entity.stray.shoot', 'entity.skeleton.shoot', 1, 1), ('entity.bogged.shoot', 'entity.skeleton.shoot', 1, 1)):
        if to in EVENTS:
            ref(ev, to, pt, vo)
    # the Nether: each biome's held loop (one drone of our own, pitched per biome), its mood and its additions
    drone = loop_join(P['nether_loop']()[0][2][:int(8 * SR)])
    drone = drone * (0.04 / max(1e-6, float(np.sqrt(np.mean(drone ** 2)))))
    put('ambient', 'ambient.nether_wastes.loop', [drone.astype(np.float32)])
    EVENTS['ambient.nether_wastes.loop']['subtitle'] = None
    for b, pt in (('nether_wastes', 1.0), ('crimson_forest', 1.1), ('warped_forest', 0.9), ('soul_sand_valley', 0.8), ('basalt_deltas', 0.75)):
        if b != 'nether_wastes':
            ref('ambient.%s.loop' % b, 'ambient.nether_wastes.loop', pt)
            EVENTS['ambient.%s.loop' % b]['subtitle'] = None
        ref('ambient.%s.mood' % b, 'ambient.cave', 0.8 * pt)
        ref('ambient.%s.additions' % b, 'ambient.cave', 1.15 * pt, 0.5)
    # everything else that has a measurement and the nearest built sound
    alias_blocks()
    alias_mobs()
    # the held loops (not measured: set by ear against the others)
    uw = P['underwater_loop']()[0][2][:int(6 * SR)]
    put('ambient', 'ambient.underwater.loop', [loop_join(uw * (0.05 / max(1e-6, float(np.sqrt(np.mean(uw ** 2))))))])
    EVENTS['ambient.underwater.loop']['subtitle'] = None
    if a.no_music:
        # the tracks as they were last built (their files are left as they are)
        try:
            music = json.load(open(os.path.join(OUT, 'index.json'))).get('music', {})
            for m in music.values():
                for sid, (url, kind, title, author, lic, page) in SOURCES.items():
                    if title == m['title'] and author == m['by']:
                        USED.add(sid)
        except Exception:
            music = {}
    else:
        music = build_music(a.music_q)
    if music:
        music_events(music)
    index = {'v': 1, 'banks': {}, 'music': music, 'events': EVENTS}
    for name, b in BANKS.items():
        index['banks'][name] = b.write(a.q)
    os.makedirs(OUT, exist_ok=True)
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
    write_credits()
    write_subtitle_text()
    tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(OUT) for f in fs)
    print('%d events, total %.2f MB' % (len(EVENTS), tot / 1048576))


if __name__ == '__main__':
    main()
