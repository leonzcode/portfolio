"""
Leoncraft 2 - measure the game's own sounds, as numbers only.

Reads the vanilla sounds from your own Minecraft installation (the hashed
files under .minecraft/assets/objects, found through the newest asset index)
and writes, for every sound event that plays short recordings, what those
recordings are like as it plays them (at each one's own pitch): how long they sound, how fast they rise and fall, how
loud they are, where their energy sits in pitch and the shape of their
spectrum (soundlib.features), averaged over the event's recordings with the
volume sounds.json plays each at. Also each event's attenuation distance,
where sounds.json sets one, and a short signature of its recordings' names
so events that play the same ones can share them, and the key of the
caption each event shows (not its words).

Nothing of Mojang's is copied: the output (tools/leoncraft2/sound_targets.json)
is a table of measurements that build_sounds.py uses to choose openly licensed
recordings and shape them towards the same length, pitch and loudness.

Run:  python tools/leoncraft2/measure_sounds.py [--mc <.minecraft folder>] [--index 30]
"""
import argparse, hashlib, json, os, sys
from concurrent.futures import ThreadPoolExecutor
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from soundlib import decode, features, resample

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'sound_targets.json')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mc', default=os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), '.minecraft'))
    ap.add_argument('--index', default=None)
    a = ap.parse_args()
    idir = os.path.join(a.mc, 'assets', 'indexes')
    names = [n[:-5] for n in os.listdir(idir) if n.endswith('.json')]
    num = sorted((n for n in names if n.isdigit()), key=int, reverse=True)
    index = a.index or num[0]
    objs = json.load(open(os.path.join(idir, index + '.json')))['objects']

    def path(name):
        h = objs[name]['hash']
        return os.path.join(a.mc, 'assets', 'objects', h[:2], h)

    sj = json.load(open(path('minecraft/sounds.json'), encoding='utf-8'))
    files = {}
    plan = {}
    for ev, e in sj.items():
        out = []
        for s in e.get('sounds', []):
            s = {'name': s} if isinstance(s, str) else s
            if s.get('type') == 'event' or s.get('stream'):
                continue
            k = 'minecraft/sounds/' + s['name'] + '.ogg'
            if k not in objs:
                continue
            files[s['name']] = path(k)
            out.append(s)
        if out:
            plan[ev] = out
    print('index', index, ':', len(plan), 'events,', len(files), 'recordings')

    # each recording as sounds.json plays it: at its own pitch (a file can be listed at several)
    pitches = {}
    for entries in plan.values():
        for s in entries:
            pitches.setdefault(s['name'], set()).add(round(float(s.get('pitch', 1.0)), 3))
    feats = {}

    def one(n):
        try:
            x = decode(files[n])
            return n, {p: features(resample(x, p) if abs(p - 1) > 1e-3 else x) for p in pitches[n]}
        except Exception as ex:
            return n, None

    with ThreadPoolExecutor(8) as ex:
        for i, (n, f) in enumerate(ex.map(one, list(files))):
            feats[n] = f
            if i % 500 == 0:
                print(' ', i)

    out = {'index': index, 'events': {}}
    for ev, entries in plan.items():
        fs = [(feats[s['name']][round(float(s.get('pitch', 1.0)), 3)], s) for s in entries if feats.get(s['name'])]
        if not fs:
            continue
        med = lambda k: float(np.median([f[k] for f, s in fs]))
        rms = float(np.median([f['rms'] * s.get('volume', 1.0) for f, s in fs]))
        row = {
            'n': len(fs),
            'dur': round(med('dur'), 3), 'attack': round(med('attack'), 3), 'decay': round(med('decay'), 3),
            'rms': round(rms, 5), 'centroid': round(med('centroid'), 1), 'flat': round(med('flat'), 4),
            'bands': [round(float(v), 1) for v in np.mean([f['bands'] for f, s in fs], axis=0)],
            'durs': sorted(round(f['dur'], 2) for f, s in fs),
        }
        # events that play the very same recordings share a signature (block.stone.hit and .step...)
        row['sig'] = hashlib.md5('|'.join(sorted(s['name'] for f, s in fs)).encode()).hexdigest()[:8]
        att = [s.get('attenuation_distance') for s in entries if s.get('attenuation_distance')]
        if att:
            row['range'] = att[0]
        out['events'][ev] = row
    # the subtitle key each event shows (the words themselves are not taken: js/sound/subtitles.js has our own)
    out['subtitles'] = {}
    for ev, e in sj.items():
        k = e.get('subtitle')
        if k:
            out['subtitles'][ev] = k
    # the music events by name, and how loud the game's music is (a few tracks of music.game)
    out['music_events'] = sorted(e for e in sj if e.startswith('music'))
    tracks = [s if isinstance(s, dict) else {'name': s} for s in sj.get('music.game', {}).get('sounds', [])]
    levels = []
    for s in tracks[:8]:
        k = 'minecraft/sounds/' + s['name'] + '.ogg'
        if k in objs and os.path.exists(path(k)):
            x = decode(path(k), 22050)
            levels.append(float(np.sqrt(np.mean(x ** 2))) * s.get('volume', 1.0))
    if levels:
        out['music_rms'] = round(float(np.median(levels)), 4)
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, len(out['events']), 'events', os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
