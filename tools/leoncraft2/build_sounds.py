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
from soundlib import SR, decode, features, distance, fades, resample, lp, hp, eq_to, segments, write_ogg, active, envelope

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'leoncraft2', 'sounds')
JS_CREDITS = os.path.join(ROOT, 'public', 'leoncraft2', 'js', 'sound', 'credits.js')
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
    # animals (OpenGameArt)
    'catk1': (OGA + 'cat_mewfood.wav', 'file', 'Cat Purr & Meow', 'Kerzoven', CC0, OGAP + 'cat-purr-meow'),
    'catk2': (OGA + 'cat_mewpurr.wav', 'file', 'Cat Purr & Meow', 'Kerzoven', CC0, OGAP + 'cat-purr-meow'),
    'catk3': (OGA + 'cat_mewpurr2.wav', 'file', 'Cat Purr & Meow', 'Kerzoven', CC0, OGAP + 'cat-purr-meow'),
    'catk4': (OGA + 'cat_softmew.wav', 'file', 'Cat Purr & Meow', 'Kerzoven', CC0, OGAP + 'cat-purr-meow'),
    'catk5': (OGA + 'cat_purractive_loop.wav', 'file', 'Cat Purr & Meow', 'Kerzoven', CC0, OGAP + 'cat-purr-meow'),
    'kitten': (OGA + 'kitten_mew-1_0.ogg', 'file', 'Kitten Mew', 'AntumDeluge', CC0, OGAP + 'kitten-mew'),
    'dogs': (OGA + 'dog.7z', '7z', 'Dog Sounds', 'pauliuw', CC0, OGAP + 'dog-sounds'),
    'doggrowl': (OGA + 'dog-growl.ogg', 'file', 'Dog Growl', 'bonebrah', CC0, OGAP + 'dog-growl'),
    'dogsnarl': (OGA + 'dog_0.7z', '7z', 'Dog snarl, grunt, grumble', 'qubodup', CC0, OGAP + 'dog-snarl-grunt-grumble'),
    'doggrunt': (OGA + 'dog-frieda-grunt-96khz-01.flac', 'file', 'Dog Grunt', 'qubodup', CC0, OGAP + 'dog-grunt'),
    'donkeyoga': (OGA + 'donkey_bray_-_starninjas_0.ogg', 'file', 'Donkey Bray', 'StarNinjas', CC0, OGAP + 'donkey-bray'),
    'bats': (OGA + 'bat.zip', 'zip', 'Bat Screeches', 'AntumDeluge', CC0, OGAP + 'bat-screeches'),
    'croak1': (OGA + 'croak_01_0.mp3', 'file', 'Frog Croaks', 'EZduzziteh', CC0, OGAP + 'frog-croaks'),
    'croak2': (OGA + 'croak_02.mp3', 'file', 'Frog Croaks', 'EZduzziteh', CC0, OGAP + 'frog-croaks'),
    'croak3': (OGA + 'croak_03.mp3', 'file', 'Frog Croaks', 'EZduzziteh', CC0, OGAP + 'frog-croaks'),
    'croak4': (OGA + 'croak_04.mp3', 'file', 'Frog Croaks', 'EZduzziteh', CC0, OGAP + 'frog-croaks'),
    'ribbit1': (OGA + 'ribbit_01.mp3', 'file', 'Ribbit Frog Sounds', 'EZduzziteh', CC0, OGAP + 'ribbit-frog-sounds'),
    'ribbit2': (OGA + 'ribbit_02.mp3', 'file', 'Ribbit Frog Sounds', 'EZduzziteh', CC0, OGAP + 'ribbit-frog-sounds'),
    'ribbit3': (OGA + 'ribbit_03.mp3', 'file', 'Ribbit Frog Sounds', 'EZduzziteh', CC0, OGAP + 'ribbit-frog-sounds'),
    'animalnoise': (OGA + 'some%20animal%20noise.wav', 'file', 'Some animal noise', 'mikeask', CC0, OGAP + 'some-animal-noise'),
    # the music discs' songs, one each
    'd_13': (OGA + '012_Sirens_in_Darkness_0.mp3', 'file', 'Sirens in Darkness', 'cynicmusic (The Cynic Project)', CC0, OGAP + 'sirens-in-darkness'),
    'd_11': (OGA + 'The%209th%20Circle%20V2.mp3', 'file', 'The 9th Circle', 'Joth', CC0, OGAP + 'the-9th-circle'),
    'd_5': (OGA + 'The%20Beach%20Where%20Dreams%20Die.wav', 'file', 'The Beach Where Dreams Die', 'Chloe Wolfe', CC0, OGAP + 'ambient-the-beach-where-dreams-die'),
    'd_cat': (OGA + 'Christmas%20synths.ogg', 'file', 'Happy synths loop with slight Christmas feeling', '3xBlast', CC0, OGAP + 'happy-synths-loop-with-slight-christmas-feeling'),
    'd_blocks': (OGA + 'Of%20Far%20Different%20Nature%20-%20Funky%20House%20%28CC0%29_0.mp3', 'file', 'Funky House', 'Of Far Different Nature', CC0, OGAP + 'funky-house'),
    'd_chirp': (OGA + 'TalkingCuteChiptune_0.mp3', 'file', 'Talking Cute Chiptune', 'Pro Sensory', CC0, OGAP + 'talking-cute-chiptune'),
    'd_far': (OGA + 'Mirror%20Lake.mp3', 'file', 'Mirror Lake', 'Joth', CC0, OGAP + 'mirror-lake'),
    'd_mall': (OGA + '8bit%20Bossa.mp3', 'file', 'Bossa Nova', 'Joth', CC0, OGAP + 'bossa-nova'),
    'd_mellohi': (OGA + 'Piano%20Loop.wav', 'file', 'Emotional Piano Loop', 'extenz', CC0, OGAP + 'emotional-piano-loop'),
    'd_stal': (OGA + 'blues_0.mp3', 'file', 'Jazzy Blues', 'LushoGames', CC0, OGAP + 'jazzy-blues'),
    'd_strad': (OGA + 'raspberry_jam.ogg', 'file', 'Raspberry Jam', 'congusbongus', CC0, OGAP + 'raspberry-jam'),
    'd_ward': (OGA + 'which_brand_of_mustard_shall_i_buy.ogg', 'file', 'Which brand of mustard shall I buy?', 'congusbongus', CC0, OGAP + 'which-brand-of-mustard-shall-i-buy'),
    'd_wait': (OGA + 'rhythm_garden_0.ogg', 'file', 'Rhythm Garden', 'congusbongus', CC0, OGAP + 'rhythm-garden'),
    'd_pigstep': (OGA + 'CVP701Jam_0.ogg', 'file', 'Funky Hip-Hop Lofi Jam', 'omfgdude', CC0, OGAP + 'funky-hip-hop-lofi-jam'),
    'd_otherside': (OGA + 'S31-Night%20Prowler.ogg', 'file', 'Night Prowler', 'section31', CC0, OGAP + 'night-prowler'),
    'd_relic': (OGA + 'Lament_for_a_Warriors_Soul_REUPLOAD.mp3', 'file', "Lament for a Warrior's Soul", 'RandomMind', CC0, OGAP + 'fantasy-lament-for-a-warriors-soul'),
    'd_creator': (OGA + 'magic%20space.mp3', 'file', 'Magic Space', 'CodeManu', CC0, OGAP + 'magic-space'),
    'd_music_box': (OGA + '4_music_box_tracks_ogg.zip', 'zip', '4 Music Box Tracks', 'Aureolus_Omicron', CC0, OGAP + '4-music-box-tracks'),
    'd_precipice': (OGA + 'mythica.mp3', 'file', 'Mythica', 'congusbongus', CC0, OGAP + 'mythica'),
    'd_tears': (OGA + 'Cyberpunk%20Moonlight%20Sonata%20v2.mp3', 'file', 'Cyberpunk Moonlight Sonata', 'Joth', CC0, OGAP + 'cyberpunk-moonlight-sonata'),
    'd_lava_chicken': (OGA + 'happy_adveture.mp3', 'file', 'Happy Adventure (loop)', 'TinyWorlds', CC0, OGAP + 'happy-adventure-loop'),
}

# more CC0 recordings from Freesound, each checked on its own page (tools/leoncraft2/sound_sources.json:
# pool -> [{sid, url, title, author, licence, page, file}]); their high quality previews are used
FS = {}
try:
    for _pool, _rows in json.load(open(os.path.join(HERE, 'sound_sources.json'), encoding='utf-8')).items():
        for _r in _rows:
            if _r.get('licence') != CC0:
                continue
            SOURCES[_r['sid']] = (_r['url'], 'file', _r['title'], _r['author'], CC0, _r['page'])
            FS.setdefault(_pool, []).append(_r['sid'])
except FileNotFoundError:
    pass

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
            try:
                import requests
                r = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'}, timeout=300)
                r.raise_for_status()
                data = r.content
            except ImportError:
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=300) as r:
                    data = r.read()
            with open(p, 'wb') as f:
                f.write(data)
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


def synth_levelup_bright(octave=2.0):
    """the same three bell notes an octave up, with a glassy overtone and a breath of shimmer over them"""
    out = np.zeros(int(1.3 * SR), np.float32)
    for i, f in enumerate((1046.5 * octave / 2, 1318.5 * octave / 2, 1568.0 * octave / 2)):
        n = tone([(f, 1, 3), (f * 2, 0.45, 5), (f * 2.76, 0.25, 7), (f * 4, 0.12, 9)], 1.1, 2.6)
        a = int(i * 0.06 * SR)
        out[a:a + len(n)] += n[:len(out) - a]
    t = t_(1.3)
    out += (0.04 * hp(noise(1.3), 5000) * np.exp(-t * 3)).astype(np.float32)
    return out


def synth_crackle(dur=1.8, rate=40, bed=0.08):
    """fire as it sounds close up: sharp little cracks at random, on a soft hiss"""
    n = int(dur * SR)
    out = (bed * hp(noise(dur), 3000)).astype(np.float32)
    k = rng.poisson(rate * dur)
    for _ in range(k):
        L = int(rng.uniform(0.002, 0.012) * SR)
        a = int(rng.uniform(0, n - L - 1))
        burst = rng.uniform(-1, 1, L) * np.exp(-np.arange(L) / (L / 4)) * rng.uniform(0.2, 1.0)
        out[a:a + L] += hp(burst.astype(np.float32), rng.uniform(1500, 5000))
    t = t_(dur)
    env = np.minimum(1, t / 0.1) * np.minimum(1, (dur - t) / 0.3)
    return fades((out * env).astype(np.float32), 0.01, 0.1)


def synth_hiss(dur=1.2):
    t = t_(dur)
    return fades((hp(noise(dur), 2500) * np.minimum(1, t / 0.05) * np.exp(-t * 2.2)).astype(np.float32), 0.005, 0.2)


def synth_portal(dur, rise=False, cutoff=900):
    t = t_(dur)
    n = lp(noise(dur), cutoff)
    wob = 0.5 + 0.5 * np.sin(2 * np.pi * (0.7 + 0.5 * t) * t)
    env = (t / dur) if rise else np.sin(np.pi * t / dur)
    return fades((n * (0.4 + 0.6 * wob) * env).astype(np.float32), 0.2, 0.4)


def glide(contour, dur):
    """a pitch contour: (time share, Hz) points joined smoothly"""
    t = np.linspace(0, 1, int(dur * SR))
    ts, fs = zip(*contour)
    return np.interp(t, ts, fs)


def brass(freq, harm=14, tilt=1.15):
    """a reedy, horn-like tone following freq (Hz per sample)"""
    ph = 2 * np.pi * np.cumsum(freq) / SR
    y = np.zeros_like(ph)
    for k in range(1, harm + 1):
        y += np.sin(k * ph) / k ** tilt
    return y.astype(np.float32)


# the goat horn's eight calls, each its own shape (our own playing, nothing like a recording of the game's)
HORN_CONTOURS = [
    [(0, 196), (0.25, 220), (0.7, 220), (1, 185)],                    # ponder: a slow rise and a sinking end
    [(0, 247), (0.3, 247), (0.35, 330), (0.8, 330), (1, 311)],        # sing: two notes, up a fourth
    [(0, 165), (0.8, 262), (1, 262)],                                 # seek: a long rising glide
    [(0, 294), (0.2, 294), (1, 196)],                                 # feel: falling away
    [(0, 220), (0.2, 220), (0.25, 277), (0.45, 277), (0.5, 220), (0.7, 220), (0.75, 277), (1, 262)],   # admire: back and forth
    [(0, 208), (0.1, 233), (1, 233)],                                 # call: one long steady note
    [(0, 233), (0.3, 262), (0.55, 220), (0.8, 247), (1, 208)],        # yearn: rising and falling
    [(0, 147), (0.4, 165), (1, 156)],                                 # dream: low and soft
]


def synth_horn(i, dur=4.5):
    f = glide(HORN_CONTOURS[i % 8], dur)
    t = t_(dur)
    f = f * (1 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t / 0.8))   # a little vibrato once it is going
    y = brass(f)
    y = hp(lp(y, 2400), 160) * 1.0 + 0.5 * lp(hp(y, 600), 1600)                 # a horn's two broad resonances
    y = y + 0.03 * lp(hp(noise(dur), 900), 3000)                                 # breath
    env = np.minimum(1, t / 0.18) * np.minimum(1, (dur - t) / 0.9) * (0.85 + 0.15 * np.sin(np.pi * t / dur))
    return fades((y * env).astype(np.float32), 0.01, 0.2)


def synth_chord(freqs, dur, rise=None, shimmer=0.0, beat=0.0, decay=0.0):
    """sustained sines (a hum), gliding by rise (a share of the pitch over the whole sound), beating slowly"""
    t = t_(dur)
    y = np.zeros_like(t)
    for k, f in enumerate(freqs):
        fr = f * (1 + (rise or 0) * t / dur)
        ph = 2 * np.pi * np.cumsum(fr) / SR
        y += np.sin(ph) / (1 + k * 0.6)
        if beat:
            y += 0.5 * np.sin(ph * (1 + beat / f)) / (1 + k * 0.6)
    if shimmer:
        y += shimmer * hp(noise(dur), 4000) * (0.5 + 0.5 * np.sin(2 * np.pi * 7 * t))
    env = np.minimum(1, t / 0.15) * np.minimum(1, (dur - t) / 0.4) * np.exp(-t * decay)
    return fades((y * env).astype(np.float32), 0.01, 0.1)


def synth_pulse(dur=0.5, f=55):
    """a deep soft thump, like a heartbeat under water"""
    t = t_(dur)
    fr = f * (1 + 0.6 * np.exp(-t * 25))
    y = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 9) + 0.15 * lp(noise(dur), 400) * np.exp(-t * 14)
    return fades(y.astype(np.float32), 0.002, 0.05)


def synth_zap(dur=0.6):
    t = t_(dur)
    fr = 1800 * np.exp(-t * 6) + 200
    y = 0.6 * np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 6) + 0.4 * hp(noise(dur), 2500) * np.exp(-t * 12)
    return fades(y.astype(np.float32), 0.001, 0.05)


def synth_la(f0=880, dur=0.6, up=True):
    """a small sung 'la': a vowel on a gliding note, with a chime on top (the allay's kind of voice)"""
    t = t_(dur)
    f = f0 * (1 + (0.12 if up else -0.1) * np.sin(np.pi * t / dur)) * (1 + 0.01 * np.sin(2 * np.pi * 6 * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) + 0.35 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)
    y += 0.25 * np.sin(2 * np.pi * f0 * 2.76 * t) * np.exp(-t * 6)
    env = np.minimum(1, t / 0.04) * np.minimum(1, (dur - t) / 0.2)
    return fades((y * env).astype(np.float32), 0.003, 0.05)


def synth_whistle(dur=0.6, f0=3000, f1=6000, clicks=0):
    """a dolphin's kind of call: a quick whistle sweeping between two notes, with a few clicks before it"""
    t = t_(dur)
    f = f0 + (f1 - f0) * (0.5 - 0.5 * np.cos(np.pi * t / dur * 1.5))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.08)
    out = np.zeros(int((dur + 0.02 * clicks) * SR), np.float32)
    for k in range(clicks):
        a = int(k * 0.02 * SR)
        L = int(0.002 * SR)
        out[a:a + L] += (hp(noise(0.002), 3000) * 0.8)[:L]
    out[int(0.02 * clicks * SR):int(0.02 * clicks * SR) + len(y)] += 0.6 * y.astype(np.float32)
    return fades(out, 0.002, 0.05)


def synth_wind(dur=6.0, centre=500, gust=0.25):
    """wind rushing past: noise in a band that wanders, swelling and easing"""
    t = t_(dur)
    n = noise(dur)
    a = lp(hp(n, centre * 0.5), centre * 2)
    b = lp(hp(n, centre * 1.5), centre * 5)
    sw = 0.6 + gust * np.sin(2 * np.pi * 0.23 * t) + 0.15 * np.sin(2 * np.pi * 0.61 * t + 1)
    return fades(((a + 0.4 * b) * sw).astype(np.float32), 0.3, 0.5)


# ------------------------------------------------------------------ choosing and shaping
TARGETS = None
TEXT = {}


def sustain(y, want):
    """a long sound (thunder, an explosion) whose tail dies away sooner than the game's: the quieter
    part after its peak brought up, gently and no more than 24 dB, until it lasts about as long"""
    if features(y)['dur'] >= want * 0.9:
        return y
    n = int(0.01 * SR)
    env = envelope(y)
    env = np.convolve(env, np.ones(9) / 9, mode='same')
    pk = int(np.argmax(env))
    best = y
    for k in (0.12, 0.22, 0.32, 0.42, 0.52, 0.62):
        g = np.ones_like(env)
        g[pk:] = np.clip((env[pk:] / (env[pk] + 1e-9)) ** (-k), 1, 10 ** (24 / 20))
        gs = np.repeat(g, n)[:len(y)]
        gs = np.pad(gs, (0, len(y) - len(gs)), mode='edge')
        z = (y * gs).astype(np.float32)
        best = z
        if features(z)['dur'] >= want * 0.9:
            break
    return best


def shape(x, T, r, i=0, eq=True, cut=True):
    y = onset_trim(x)
    y = resample(y, r)
    durs = T.get('durs') or [T['dur']]
    want = durs[i % len(durs)] if i is not None else T['dur']
    if cut:
        # cut so the part that sounds lasts as long as the game's: the fade at the end eats into it, so the
        # cut is moved until the sounding part comes out right (or the recording runs out)
        L = want * 1.1 + 0.03
        z = y
        for _ in range(4):
            n = int(L * SR)
            if len(y) <= n:
                z = y
                break
            z = fades(y[:n], 0.001, min(0.12, want * 0.2))
            d = features(z)['dur']
            if abs(d - want) <= 0.08 * want + 0.01:
                break
            L = max(0.03, L * (want + 0.02) / (d + 0.02))
        y = z
    elif want > 0.5:
        y = sustain(y, want)
    y = fades(y, 0.001, 0.008)
    if eq:
        # towards the game's spectrum in up to three passes of at most 8 dB each, stopping once close
        for _ in range(3):
            b = features(y)['bands']
            if float(np.mean(np.abs(np.array(b) - np.array(T['bands'])))) < 1.5:
                break
            y = eq_to(y, b, T['bands'], 8.0)
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
    P['levelup'] = lambda: [('synth:levelup', 'synth', synth_levelup()), ('synth:levelup2', 'synth', synth_levelup_bright()), ('synth:levelup3', 'synth', synth_levelup_bright(2.5))] + files('jingles', '*steel*') + files('jingles', '*pizzi*') + files('jingles', '*hit*') + KU('confirmation_*') + KU('maximize_*')
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
    P['fire'] = lambda: windows('fire', '*', 1.8, 10) + windows('fire', '*', 2.8, 6) + windows('fire', '*', 2.2, 6) + [('synth:crackle%d' % i, 'synth', synth_crackle(1.8 + 0.4 * i, 25 + 12 * i, 0.05 + 0.02 * i)) for i in range(5)]
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
    # more mobs: Freesound's CC0 recordings (FS), OpenGameArt's, and our own synthesis where nothing came close
    F = lambda pool, fn=None: [c for sid in FS.get(pool, []) for c in files(sid, '*', fn)]
    FP = lambda pool, lo=0.08, hi=2.5, fn=None: [c for sid in FS.get(pool, []) for c in pieces(sid, '*', lo, hi, -32, 0.08, fn)]
    P['villager'] = lambda: FP('villager', 0.15, 1.6) + F('villager')
    P['witch'] = lambda: FP('witch', 0.2, 2.5) + F('witch')
    P['illager'] = lambda: FP('illager', 0.15, 1.6) + F('illager') + FP('villager', 0.15, 1.6)
    P['horse'] = lambda: FP('horse', 0.2, 3.5) + F('horse')
    P['donkey'] = lambda: files('donkeyoga') + FP('donkey', 0.3, 4.5) + F('donkey')
    P['camel'] = lambda: FP('camel', 0.2, 3.5) + F('camel') + files('yak') + [('yak:r', 'yak', resample(S('yak'), 0.8))]
    P['cat'] = lambda: files('catk1') + files('catk2') + files('catk3') + files('catk4') + files('kitten') + FP('cat', 0.15, 1.8)
    P['cat_hiss'] = lambda: [c for sid in FS.get('cat', []) if 'hiss' in SOURCES[sid][2].lower() for c in files(sid)] + [('synth:hiss', 'synth', synth_hiss(0.9))]
    P['cat_purr'] = lambda: windows('catk5', '*', 1.6, 4) + [c for sid in FS.get('cat', []) if 'purr' in SOURCES[sid][2].lower() for c in windows(sid, '*', 1.6, 2)]
    P['dog_bark'] = lambda: files('dogs', 'dog bark*') + files('dogs', 'dog*.wav') + FP('dog', 0.08, 1.0)
    P['dog_pant'] = lambda: [c for sid in FS.get('dog', []) if 'pant' in SOURCES[sid][2].lower() for c in windows(sid, '*', 1.4, 2)] + files('dogsnarl', 'dog-grumble*')
    P['dog_whine'] = lambda: files('dogs', 'sad dog*') + [c for sid in FS.get('dog', []) if 'whin' in SOURCES[sid][2].lower() for c in pieces(sid, '*', 0.2, 2.0)]
    P['dog_growl'] = lambda: files('doggrowl') + files('dogsnarl') + [c for sid in FS.get('dog', []) if 'growl' in SOURCES[sid][2].lower() for c in files(sid)]
    P['dog_hurt'] = lambda: [c for sid in FS.get('dog', []) if 'yelp' in SOURCES[sid][2].lower() for c in pieces(sid, '*', 0.08, 1.0)] + files('doggrunt') + files('dogs', 'sad dog*')
    P['fox'] = lambda: FP('fox', 0.1, 1.5) + F('fox')
    P['rabbit'] = lambda: FP('rabbit', 0.05, 0.8) + FP('squeak', 0.05, 0.8)
    P['bat'] = lambda: files('bats', '*.ogg') + pieces('bats', '*.ogg', 0.05, 0.8) + FP('bat', 0.05, 0.8)
    P['parrot'] = lambda: FP('parrot', 0.1, 1.5) + F('parrot')
    P['bee'] = lambda: [c for sid in FS.get('bee', []) for c in windows(sid, '*', 0.5, 3)]
    P['bee_loop'] = lambda: [c for sid in FS.get('bee', []) for c in windows(sid, '*', 2.5, 2)]
    P['frog'] = lambda: files('croak1') + files('croak2') + files('croak3') + files('croak4') + files('ribbit1') + files('ribbit2') + files('ribbit3') + FP('frog', 0.1, 1.5)
    P['dolphin'] = lambda: FP('dolphin', 0.1, 2.0) + F('dolphin') + files('animalnoise') + [('synth:dolphin%d' % i, 'synth', synth_whistle(0.4 + 0.15 * i, f0, f1, c)) for i, (f0, f1, c) in enumerate(((2500, 6000, 0), (5000, 2200, 6), (3000, 7000, 3), (4000, 3000, 10), (2000, 5000, 0)))]
    P['fish_flop'] = lambda: FP('fishflop', 0.05, 0.6) + files('rdwater', 'splash_*', lambda x: hp(x, 400))
    P['squid'] = lambda: FP('squid', 0.08, 1.2) + files('rdwater', 'slime_*')
    P['bear'] = lambda: FP('bear', 0.2, 3.0) + F('bear') + files('rdcreature', 'grunt_*') + files('rdcreature', 'roar_*')
    P['snort'] = lambda: FP('snort', 0.1, 2.0) + F('snort') + files('rdcreature', 'nose*')
    P['squeak'] = lambda: FP('squeak', 0.05, 1.0) + FP('rabbit', 0.05, 1.0) + files('rdcreature', 'cute_*')
    P['boar'] = lambda: FP('boar', 0.1, 2.0) + F('boar') + P['pig']() + [('pig:low%d' % i, 'pig1', resample(S('pig%d' % (i + 1)), 0.75)) for i in range(4)]
    P['wail'] = lambda: FP('wail', 0.3, 3.5) + F('wail') + files('rdcreature', 'scream_*')
    P['breath'] = lambda: FP('breath', 0.2, 3.0) + F('breath') + files('rdcreature', 'breath*') + files('rdcreature', 'snore*')
    P['screech'] = lambda: FP('screech', 0.15, 2.5) + F('screech') + files('rdcreature', 'scream_*')
    P['shriek'] = lambda: FP('shriek', 0.1, 2.0) + F('shriek') + files('rdcreature', 'cute_*', lambda x: resample(x, 1.3))
    P['roar'] = lambda: FP('roar', 0.3, 4.0) + F('roar') + files('rdcreature', 'roar_*') + files('rdcreature', 'monster_*') + files('rdcreature', 'troll_*')
    P['insect'] = lambda: FP('insect', 0.05, 1.5) + files('rdcreature', 'bug_*')
    P['chirp'] = lambda: FP('chirp', 0.05, 1.5) + files('rdcreature', 'cute_*') + files('rdcreature', 'alien_*')
    P['guardian'] = lambda: files('rdcreature', 'alien_*') + FP('chirp', 0.1, 1.5) + files('rdcreature', 'weird_*')
    P['trill'] = lambda: FP('trill', 0.1, 2.5) + F('trill') + files('rdcreature', 'burble_*')
    P['llama'] = lambda: FP('llama', 0.2, 2.5) + F('llama') + P['sheep']()
    P['goat'] = lambda: FP('goat', 0.2, 2.5) + F('goat') + P['sheep']()
    P['creak'] = lambda: KR('creak*') + KR('doorOpen*')
    P['metal_hurt'] = lambda: K('impactMetal_heavy_*') + K('impactPlate_heavy_*') + K('impactBell_heavy_*')
    P['metal_step'] = lambda: K('impactMetal_heavy_*', ) + K('impactPlate_heavy_*') + K('impactMetal_medium_*')
    P['allay'] = lambda: [('synth:la%d' % i, 'synth', synth_la(f, d, i % 2 == 0)) for i, (f, d) in enumerate(((880, 0.5), (988, 0.6), (784, 0.7), (1047, 0.45), (932, 0.55)))]
    P['ender'] = lambda: [('mix:ender%d' % i, 'grunts', mixdown(*[(resample(c[2][::-1].copy(), r), 0, 0.5) for r in (0.55, 0.6, 0.66)])) for i, c in enumerate(pieces('grunts', '*', 0.2, 0.8, -35, 0.15)[:6])]
    P['teleport'] = lambda: [('synth:tp%d' % i, 'synth', synth_portal(0.9 + 0.3 * i, i % 2 == 0, 900 + 300 * i)) for i in range(3)] + files('rd100b', '*air_*')
    P['bubbles'] = lambda: FP('bubbles', 0.2, 3.0) + files('rdwater', 'bubble_*') + windows('rdwater', 'loop_bubbles*', 1.5, 3)
    P['drip'] = lambda: FP('drip', 0.03, 0.6) + pieces('basement', '*', 0.03, 0.6, -30, 0.05) + files('rdwater', 'bubble_*', lambda x: x[:int(0.25 * SR)])
    P['wind_loop'] = lambda: [c for sid in FS.get('wind', []) for c in windows(sid, '*', 6.0, 1)] + [('synth:wind', 'synth', synth_wind(6.0))]
    P['wind'] = lambda: FP('wind', 0.3, 3.0) + [c for sid in FS.get('wind', []) for c in windows(sid, '*', 1.5, 2)] + [('synth:gust%d' % i, 'synth', synth_wind(1.2 + 0.4 * i, 700 + 200 * i, 0.4)) for i in range(3)]
    P['brush'] = lambda: FP('brush', 0.1, 1.5) + [c for sid in FS.get('brush', []) for c in windows(sid, '*', 0.6, 3)] + K('footstep_snow_*')
    P['rope'] = lambda: FP('rope', 0.05, 1.0) + KR('cloth*') + KR('beltHandle*')
    P['slide'] = lambda: FP('slide', 0.05, 1.2) + KR('metalLatch*') + KR('drawKnife*') + KU('scratch_*')
    P['pouch'] = lambda: FP('pouch', 0.05, 1.0) + KR('cloth*') + KR('dropLeather*') + KR('handleSmallLeather*')
    P['crank'] = lambda: FP('crank', 0.05, 1.5) + KR('creak*') + KR('drawKnife*') + KR('metalClick*')
    P['sponge'] = lambda: FP('sponge', 0.1, 1.5) + P['drink']()
    P['beacon_on'] = lambda: [('synth:beacon_on%d' % i, 'synth', synth_chord((220 * k, 330 * k, 440 * k), 2.6, 0.25, 0.05)) for i, k in enumerate((1, 1.12, 0.9))]
    P['beacon_off'] = lambda: [('synth:beacon_off%d' % i, 'synth', synth_chord((440 * k, 330 * k, 220 * k), 2.2, -0.3, 0.03, decay=0.8)) for i, k in enumerate((1, 1.12, 0.9))]
    P['beacon_hum'] = lambda: [('synth:beacon_hum%d' % i, 'synth', synth_chord((110 * k, 220 * k, 330 * k), 4.0, 0, 0.02, beat=1.5)) for i, k in enumerate((1, 1.06, 0.94))]
    P['conduit_on'] = lambda: [('synth:conduit_on%d' % i, 'synth', mixdown((synth_portal(3.0, True, 600 + 200 * i), 0, 0.8), (synth_chord((165, 247, 330), 3.0, 0.2, 0.08), 0.2, 0.5))) for i in range(3)]
    P['conduit_off'] = lambda: [('synth:conduit_off%d' % i, 'synth', mixdown((synth_portal(2.5, False, 500 + 200 * i), 0, 0.8), (synth_chord((330, 247, 165), 2.5, -0.3, 0.04, decay=1), 0, 0.5))) for i in range(3)]
    P['conduit_pulse'] = lambda: [('synth:pulse%d' % i, 'synth', synth_pulse(0.5 + 0.1 * i, 50 + 8 * i)) for i in range(4)] + [('synth:pulses%d' % i, 'synth', mixdown((synth_pulse(0.5, 55), 0, 1), (synth_pulse(0.5, 52), 0.42 + 0.05 * i, 0.8))) for i in range(3)]
    P['zap'] = lambda: [('synth:zap%d' % i, 'synth', synth_zap(0.4 + 0.15 * i)) for i in range(4)]
    P['riptide'] = lambda: [('mix:riptide%d' % i, 'rdwater', mixdown((c[2], 0, 1.0), (synth_wind(1.4, 900, 0.5), 0.05, 0.6))) for i, c in enumerate(files('rdwater', 'splash_*')[:5])]
    P['horn'] = lambda: F('horn')
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
    'giant': ('zombie', 0.6), 'parched': ('skeleton', 1.05),
    'stray': ('skeleton', 0.9), 'wither_skeleton': ('skeleton', 0.8), 'bogged': ('skeleton', 1.05), 'skeleton_horse': ('skeleton', 1.2),
    'cave_spider': ('spider', 1.2), 'mooshroom': ('cow', 1.0),
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


# the banks the rest of the mobs' voices go in, by where they are met (sound.js fetches one as its first mob comes near)
MOB_BANKS = {
    'village': ('villager', 'wandering_trader', 'witch', 'pillager', 'vindicator', 'evoker', 'illusioner', 'iron_golem', 'cat', 'ocelot', 'copper_golem', 'snow_golem', 'allay'),
    'animals': ('horse', 'zombie_horse', 'donkey', 'mule', 'camel', 'camel_husk', 'wolf', 'fox', 'rabbit', 'parrot', 'bee', 'frog', 'tadpole', 'polar_bear',
                'panda', 'sniffer', 'armadillo', 'llama', 'goat', 'turtle'),
    'water': ('dolphin', 'cod', 'salmon', 'tropical_fish', 'puffer_fish', 'squid', 'glow_squid', 'guardian', 'elder_guardian', 'axolotl', 'nautilus', 'zombie_nautilus'),
    'cave': ('bat', 'silverfish', 'endermite', 'enderman', 'creaking', 'warden'),
    'nether': ('ghast', 'happy_ghast', 'blaze', 'hoglin', 'zoglin', 'piglin', 'piglin_brute', 'strider', 'wither'),
    'end': ('shulker', 'phantom', 'vex', 'ravager', 'ender_dragon', 'breeze'),
}


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


# the music discs: each its own song (disc, source, file), none of them the game's background music
DISCS = [('13', 'd_13', '*'), ('11', 'd_11', '*'), ('5', 'd_5', '*'), ('cat', 'd_cat', '*'), ('blocks', 'd_blocks', '*'),
         ('chirp', 'd_chirp', '*'), ('far', 'd_far', '*'), ('mall', 'd_mall', '*'), ('mellohi', 'd_mellohi', '*'), ('stal', 'd_stal', '*'),
         ('strad', 'd_strad', '*'), ('ward', 'd_ward', '*'), ('wait', 'd_wait', '*'), ('pigstep', 'd_pigstep', '*'),
         ('otherside', 'd_otherside', '*'), ('relic', 'd_relic', '*'), ('creator', 'd_creator', '*'),
         ('creator_music_box', 'd_music_box', 'musicbox2*'), ('precipice', 'd_precipice', '*'), ('tears', 'd_tears', '*'),
         ('lava_chicken', 'd_lava_chicken', '*')]


def build_discs(q):
    """One mono file a disc (a jukebox is one point in the world, as the game's records are): a short loop
    played round until it lasts a minute and a half, anything longer than two and a half minutes faded out
    there, at the game's music loudness."""
    sr = 32000
    os.makedirs(os.path.join(OUT, 'discs'), exist_ok=True)
    out = {}
    for disc, sid, pat in DISCS:
        fs = [n for n in sorted(listing(sid)) if fnmatch.fnmatch(n.lower(), pat.lower())]
        if not fs:
            print('  (no file for disc %s)' % disc)
            continue
        x = decode(listing(sid)[fs[0]], sr)
        a, b = active(x)
        x = x[a:]
        if len(x) < 90 * sr:
            x = np.tile(x, int(np.ceil(90 * sr / len(x))))[:max(len(x), 90 * sr)]
        x = x[:150 * sr]
        x = x * min(4.0, MUSIC_RMS / (float(np.sqrt(np.mean(x ** 2))) + 1e-9))
        n = len(x)
        fade = np.ones(n, np.float32)
        k = min(n // 4, 4 * sr)
        fade[n - k:] = np.linspace(1, 0, k)
        fade[:int(0.03 * sr)] = np.linspace(0, 1, int(0.03 * sr))
        x = np.clip(x * fade, -0.98, 0.98).astype(np.float32)
        dst = os.path.join(OUT, 'discs', disc + '.ogg')
        write_ogg(x, dst, q, sr=sr)
        USED.add(sid)
        _, _, title, author, lic, page = SOURCES[sid][:6]
        out['discs/' + disc] = {'file': 'discs/' + disc + '.ogg', 'title': title, 'by': author, 'licence': lic, 'where': ['disc'], 'seconds': round(n / sr, 1)}
        print('disc  %-20s %6.1f s %7.1f KB' % (disc, n / sr, os.path.getsize(dst) / 1024))
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
    # music discs: each its own song (build_discs), or, for one without, one of the tracks
    names = sorted(n for n in music if not n.startswith('discs/'))
    for i, ev in enumerate(sorted(e for e in TARGETS['music'] if e.startswith('music_disc.'))):
        d = 'discs/' + ev.split('.', 1)[1]
        EVENTS[ev] = {'sounds': st([d if d in music else names[i % len(names)]]), 'subtitle': 'subtitles.jukebox_song'}


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


# ------------------------------------------------------------------ main
def main():
    global SRC, TARGETS, MUSIC_RMS
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--report', action='store_true')
    ap.add_argument('--q', default='3')
    ap.add_argument('--music-q', default='2')
    ap.add_argument('--disc-q', default='0')
    ap.add_argument('--no-music', action='store_true')
    a = ap.parse_args()
    SRC = os.path.abspath(a.src)
    if a.fetch:
        fetch()
    raw = json.load(open(os.path.join(HERE, 'sound_targets.json')))
    TARGETS = dict(raw['events'])
    TARGETS['subs'] = raw.get('subtitles', {})
    TARGETS['music'] = raw.get('music_events', [])
    MUSIC_RMS = raw.get('music_rms', 0.06)
    # (the mobs past the first few come in banks by where they live, each fetched when one of them first comes near: 'lazy')
    for name, load in (('ui', 'now'), ('blocks', 'now'), ('player', 'world'), ('world', 'world'), ('ambient', 'world'), ('mobs', 'world'), ('notes', 'world'),
                       ('items', 'world'), ('m_village', 'lazy'), ('m_animals', 'lazy'), ('m_water', 'lazy'), ('m_cave', 'lazy'), ('m_nether', 'lazy'), ('m_end', 'lazy')):
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
    # the rest of the mobs: each its own voice where the game gives it one
    def mob(m, pools, maxn=3):
        bank = 'm_' + next((f for f, ms in MOB_BANKS.items() if m in ms), 'animals')
        for kind, pool in pools.items():
            ev = 'entity.%s.%s' % (m, kind)
            if ev in EVENTS or ev not in TARGETS:
                continue
            if isinstance(pool, tuple):            # ('like', other event): another's, pitched and levelled to this one
                like(ev, pool[1])
            else:
                B(bank, ev, pool, maxn=maxn)
    voice3 = lambda amb, hurt=None, death=None: {'ambient': amb, 'hurt': hurt or amb, 'death': death or hurt or amb}
    mob('villager', dict(voice3('villager'), trade='villager', yes='villager', no='villager'))
    mob('wandering_trader', {k: ('like', 'entity.villager.' + k) for k in ('ambient', 'hurt', 'death', 'trade', 'yes', 'no')})
    mob('witch', voice3('witch'))
    for m in ('pillager', 'vindicator', 'evoker', 'illusioner'):
        mob(m, voice3('illager'))
    mob('horse', dict(voice3('horse'), angry='horse', breathe='snort'))
    mob('zombie_horse', {k: ('like', 'entity.horse.' + k) for k in ('ambient', 'hurt', 'death', 'angry')})
    mob('donkey', dict(voice3('donkey'), angry='donkey'))
    mob('mule', {k: ('like', 'entity.donkey.' + k) for k in ('ambient', 'hurt', 'death', 'angry')})
    mob('camel', voice3('camel'))
    mob('camel_husk', {k: ('like', 'entity.camel.' + k) for k in ('ambient', 'hurt', 'death')})
    mob('cat', dict(voice3('cat'), stray_ambient='cat', purreow='cat', hiss='cat_hiss', purr='cat_purr', beg_for_food='cat', eat='eat'))
    mob('ocelot', {k: ('like', 'entity.cat.' + k) for k in ('ambient', 'hurt', 'death')})
    mob('wolf', {'ambient': 'dog_bark', 'pant': 'dog_pant', 'whine': 'dog_whine', 'growl': 'dog_growl', 'hurt': 'dog_hurt', 'death': 'dog_whine'})
    mob('fox', dict(voice3('fox'), sleep='breath', screech='fox', aggro='fox'))
    mob('rabbit', voice3('rabbit'))
    mob('bat', voice3('bat'))
    mob('parrot', voice3('parrot'))
    mob('bee', {'hurt': 'bee', 'death': 'bee'})
    mob('frog', voice3('frog'))
    mob('tadpole', {'hurt': 'fish_flop', 'death': 'fish_flop', 'flop': 'fish_flop'})
    mob('dolphin', dict(voice3('dolphin'), ambient_water='dolphin'))
    for m in ('cod', 'salmon', 'tropical_fish', 'puffer_fish'):
        mob(m, {'ambient': 'squid', 'flop': 'fish_flop', 'hurt': 'fish_flop', 'death': 'fish_flop'})
    mob('squid', voice3('squid'))
    mob('glow_squid', voice3('squid'))
    mob('polar_bear', dict(voice3('bear'), ambient_baby='bear', warning='bear'))
    mob('panda', dict(voice3('snort', 'bear'), worried_ambient='snort', aggressive_ambient='bear'))
    mob('sniffer', {'idle': 'snort', 'hurt': 'snort', 'death': 'bear'})
    mob('armadillo', voice3('squeak'))
    mob('hoglin', dict(voice3('boar'), angry='boar'))
    mob('zoglin', {k: ('like', 'entity.hoglin.' + k) for k in ('ambient', 'hurt', 'death', 'angry')})
    mob('piglin', dict(voice3('boar'), angry='boar', admiring_item='boar', jealous='boar', celebrate='boar', retreat='boar'))
    mob('piglin_brute', {k: ('like', 'entity.piglin.' + k) for k in ('ambient', 'hurt', 'death', 'angry')})
    mob('ghast', dict(voice3('wail'), scream='wail', warn='wail'))
    mob('happy_ghast', {k: ('like', 'entity.ghast.' + k) for k in ('ambient', 'hurt', 'death')})
    mob('blaze', voice3('breath'))
    mob('shulker', dict(voice3('creak', 'squeak'), hurt_closed='metal_hurt'))
    mob('phantom', voice3('screech'))
    mob('vex', voice3('shriek'))
    mob('ravager', voice3('roar'))
    mob('warden', dict(voice3('roar'), angry='roar'))
    mob('wither', voice3('roar'))
    mob('ender_dragon', dict(voice3('roar'), growl='roar'))
    mob('silverfish', voice3('insect'))
    mob('endermite', voice3('insect'))
    mob('guardian', dict(voice3('guardian'), ambient_land='guardian', hurt_land='guardian', death_land='guardian'))
    mob('elder_guardian', {k: ('like', 'entity.guardian.' + k) for k in ('ambient', 'ambient_land', 'hurt', 'hurt_land', 'death', 'death_land')})
    mob('turtle', {'ambient_land': 'chirp', 'hurt': 'chirp', 'death': 'chirp', 'hurt_baby': 'chirp', 'death_baby': 'chirp'})
    mob('axolotl', {'idle_air': 'chirp', 'idle_water': 'chirp', 'hurt': 'chirp', 'death': 'chirp'})
    mob('strider', voice3('trill'))
    mob('breeze', {'idle_ground': 'wind', 'idle_air': 'wind', 'hurt': 'wind', 'death': 'wind'})
    mob('creaking', {'ambient': 'creak', 'death': 'creak'})
    mob('iron_golem', {'hurt': 'metal_hurt', 'death': 'metal_hurt', 'step': 'metal_step'})
    mob('copper_golem', {'hurt': 'metal_hurt', 'death': 'metal_hurt', 'step': 'metal_step'})
    mob('snow_golem', {'ambient': 'snow_dig', 'hurt': 'snow_dig', 'death': 'snow_dig'})
    mob('allay', {'ambient_with_item': 'allay', 'ambient_without_item': 'allay', 'hurt': 'allay', 'death': 'allay'})
    mob('nautilus', voice3('bubbles'))
    mob('zombie_nautilus', {k: ('like', 'entity.nautilus.' + k) for k in ('ambient', 'hurt', 'death')})
    mob('enderman', dict(voice3('ender'), scream='ender', stare='ender', teleport='teleport'))
    mob('llama', voice3('llama'))
    mob('goat', voice3('goat'))
    for e, to in (('entity.mooshroom.shear', 'entity.sheep.shear'), ('entity.snow_golem.shear', 'entity.sheep.shear'), ('entity.bogged.shear', 'entity.sheep.shear'),
                  ('entity.goat.milk', 'entity.cow.milk'), ('entity.mooshroom.milk', 'entity.cow.milk'), ('entity.shulker.teleport', 'entity.enderman.teleport'),
                  ('entity.endermite.step', 'entity.spider.step'), ('entity.silverfish.step', 'entity.spider.step')):
        if to in EVENTS and e not in EVENTS:
            like(e, to)
    # bees: the buzz, held while one flies near (a loop)
    if 'entity.bee.loop' in TARGETS and FS.get('bee'):
        c = P['bee_loop']()[0][2]
        put('m_animals', 'entity.bee.loop', [loop_join(c * (TARGETS['entity.bee.loop']['rms'] / max(1e-6, float(np.sqrt(np.mean(c ** 2))))))])
        ref('entity.bee.loop_aggressive', 'entity.bee.loop', 1.15, 1.2)
    # items and blocks the game plays and nothing above gave a sound
    for k in range(8):
        ev = 'item.goat_horn.sound.%d' % k
        if ev in TARGETS:
            put('items', ev, choose(ev, [('synth:horn%d' % k, 'synth', synth_horn(k, max(2.5, TARGETS[ev]['dur'])))], n=1, cut=False))
    for ev, pool in (('item.spyglass.use', 'slide'), ('item.spyglass.stop_using', 'slide'),
                     ('item.crossbow.loading_start', 'crank'), ('item.crossbow.loading_middle', 'crank'), ('item.crossbow.quick_charge_1', 'crank'),
                     ('item.crossbow.quick_charge_2', 'crank'), ('item.crossbow.quick_charge_3', 'crank'), ('item.crossbow.hit', 'arrow_hit'),
                     ('item.trident.riptide_1', 'riptide'), ('item.trident.riptide_2', 'riptide'), ('item.trident.riptide_3', 'riptide'),
                     ('item.trident.return', 'teleport'), ('item.trident.hit', 'arrow_hit'), ('item.trident.hit_ground', 'arrow_hit'),
                     ('item.brush.brushing.sand', 'brush'), ('item.brush.brushing.gravel', 'brush'), ('item.brush.brushing.generic', 'brush'),
                     ('item.brush.brushing.sand.complete', 'sand_dig'), ('item.brush.brushing.gravel.complete', 'gravel_dig'),
                     ('item.lead.tied', 'rope'), ('item.lead.untied', 'rope'), ('item.lead.break', 'rope'),
                     ('item.bundle.insert', 'pouch'), ('item.bundle.remove_one', 'pouch'), ('item.bundle.drop_contents', 'pouch'), ('item.bundle.insert_fail', 'pouch'),
                     ('item.dye.use', 'squid'), ('item.ink_sac.use', 'squid'), ('item.glow_ink_sac.use', 'squid'),
                     ('ui.hud.bubble_pop', 'pop'), ('ui.loom.select_pattern', 'click'), ('ui.stonecutter.select_recipe', 'click'),
                     ('block.composter.empty', 'gravel_dig'), ('block.composter.ready', 'plant'), ('block.cake.add_candle', 'plant'),
                     ('block.candle.ambient', 'fire'), ('block.candle.extinguish', 'fizz'), ('block.pumpkin.carve', 'strip'),
                     ('block.sponge.absorb', 'sponge'), ('block.wet_sponge.dries', 'fizz'), ('block.end_gateway.spawn', 'explode'),
                     ('block.respawn_anchor.ambient', 'portal'), ('block.respawn_anchor.set_spawn', 'portal_trigger'), ('block.respawn_anchor.deplete', 'portal_trigger'),
                     ('block.bubble_column.upwards_ambient', 'bubbles'), ('block.bubble_column.whirlpool_ambient', 'bubbles'),
                     ('block.bubble_column.upwards_inside', 'bubbles'), ('block.bubble_column.whirlpool_inside', 'bubbles'), ('block.bubble_column.bubble_pop', 'pop'),
                     ('block.pointed_dripstone.drip_water', 'drip'), ('block.pointed_dripstone.drip_lava', 'drip'),
                     ('block.pointed_dripstone.drip_water_into_cauldron', 'drip'), ('block.pointed_dripstone.drip_lava_into_cauldron', 'drip'),
                     ('block.beacon.activate', 'beacon_on'), ('block.beacon.deactivate', 'beacon_off'), ('block.beacon.ambient', 'beacon_hum'), ('block.beacon.power_select', 'levelup'),
                     ('block.conduit.activate', 'conduit_on'), ('block.conduit.deactivate', 'conduit_off'), ('block.conduit.ambient', 'conduit_pulse'),
                     ('block.conduit.ambient.short', 'conduit_pulse'), ('block.conduit.attack.target', 'zap')):
        if ev not in EVENTS:
            B('items' if not ev.startswith('ui.') else 'ui', ev, pool, maxn=2, cut=pool not in ('beacon_on', 'beacon_off', 'beacon_hum', 'conduit_on', 'conduit_off'))
    for ev in ('item.bucket.fill_fish', 'item.bucket.fill_axolotl', 'item.bucket.fill_tadpole', 'item.bucket.empty_fish', 'item.bucket.empty_axolotl', 'item.bucket.empty_tadpole'):
        if ev not in EVENTS:
            like(ev, 'item.bucket.' + ('fill' if '.fill' in ev else 'empty'))
    if 'entity.boat.paddle_land' not in EVENTS:
        B('items', 'entity.boat.paddle_land', 'gravel_step', maxn=2)
    if 'item.trident.thunder' not in EVENTS and 'entity.lightning_bolt.thunder' in EVENTS:
        like('item.trident.thunder', 'entity.lightning_bolt.thunder')
    # gliding: the wind as it rushes past, a held loop (game.js sets how loud by speed)
    if 'item.elytra.flying' in TARGETS:
        c = P['wind_loop']()[0][2]
        put('items', 'item.elytra.flying', [loop_join(c * (TARGETS['item.elytra.flying']['rms'] / max(1e-6, float(np.sqrt(np.mean(c ** 2))))))])
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
        music.update(build_discs(a.disc_q))
    if music:
        music_events(music)
    index = {'v': 1, 'banks': {}, 'music': music, 'events': EVENTS}
    for name, b in BANKS.items():
        index['banks'][name] = b.write(a.q)
    os.makedirs(OUT, exist_ok=True)
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
    write_credits()
    tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(OUT) for f in fs)
    print('%d events, total %.2f MB' % (len(EVENTS), tot / 1048576))


if __name__ == '__main__':
    main()
