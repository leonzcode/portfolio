"""
Leoncraft 2 - the sound measuring and shaping both sound scripts share
(measure_sounds.py and build_sounds.py).

features(x)  what a recording is like, as numbers: how long it sounds, how
             quickly it hits and dies away, how loud it is, where its energy
             sits in pitch (the spectral centroid) and the shape of its
             spectrum in 24 bands, and how noisy it is (spectral flatness).
match(...)   how far one recording's numbers are from another's.

Audio is read and written with ffmpeg (FFMPEG, or the imageio-ffmpeg pip
package's copy), as mono 44.1 kHz floats.
"""
import os, subprocess, tempfile
import numpy as np
from scipy import signal
import scipy.io.wavfile as wf

SR = 44100


def ffmpeg():
    p = os.environ.get('FFMPEG')
    if p:
        return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


FF = ffmpeg()


def decode(path, sr=SR, mono=True):
    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        cmd = [FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', path] + (['-ac', '1'] if mono else ['-ac', '2']) + ['-ar', str(sr), '-c:a', 'pcm_f32le', tmp]
        subprocess.run(cmd, check=True)
        _, d = wf.read(tmp)
    finally:
        os.remove(tmp)
    d = d.astype(np.float32)
    return d - np.mean(d, axis=0) if len(d) else d


# 24 bands, log spaced from 60 Hz to 16 kHz
EDGES = np.geomspace(60, 16000, 25)


def envelope(x, hop=0.01):
    n = max(1, int(SR * hop))
    k = len(x) // n
    if k == 0:
        return np.zeros(1, np.float32)
    return np.sqrt((x[:k * n].reshape(k, n) ** 2).mean(axis=1) + 1e-12)


def active(x):
    """the part that sounds: from the first 10 ms over -26 dB of the loudest to the last over -40 dB"""
    env = envelope(x)
    top = env.max()
    if top <= 1e-6:
        return 0, len(x)
    on = np.nonzero(env > top * 0.05)[0]
    tail = np.nonzero(env > top * 0.01)[0]
    a = int(on[0] * 0.01 * SR)
    b = int((tail[-1] + 1) * 0.01 * SR)
    return a, max(a + 1, min(len(x), b))


def bands(x):
    if len(x) < 512:
        x = np.pad(x, (0, 512 - len(x)))
    f, p = signal.welch(x, SR, nperseg=min(2048, len(x)), scaling='spectrum')
    out = np.zeros(24)
    for i in range(24):
        m = (f >= EDGES[i]) & (f < EDGES[i + 1])
        out[i] = p[m].sum() if m.any() else 0
    tot = out.sum() + 1e-20
    return 10 * np.log10(out / tot + 1e-9)          # dB, as a share of the whole


def features(x):
    a, b = active(x)
    y = x[a:b]
    env = envelope(y)
    pk = int(np.argmax(env))
    top = env[pk]
    after = np.nonzero(env[pk:] > top * 0.1)[0]
    decay = (after[-1] + 1) * 0.01 if len(after) else 0.01
    f, p = signal.welch(y if len(y) >= 512 else np.pad(y, (0, 512 - len(y))), SR, nperseg=min(2048, max(512, len(y))))
    m = (f > 80) & (f < 14000)
    cen = float((f[m] * p[m]).sum() / (p[m].sum() + 1e-20))
    flat = float(np.exp(np.mean(np.log(p[m] + 1e-20))) / (np.mean(p[m]) + 1e-20))
    return {
        'dur': round(len(y) / SR, 4),
        'attack': round(pk * 0.01, 3),
        'decay': round(decay, 3),
        'rms': float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0,
        'peak': float(np.max(np.abs(y))) if len(y) else 0.0,
        'centroid': round(cen, 1),
        'flat': round(flat, 4),
        'bands': [round(float(v), 2) for v in bands(y)],
    }


def distance(a, t):
    """how unlike target t (an event's typical numbers) recording a is; 0 is the same"""
    d = 0.0
    d += 1.2 * abs(np.log((a['dur'] + 0.02) / (t['dur'] + 0.02)))
    d += 0.6 * abs(np.log((a['decay'] + 0.02) / (t['decay'] + 0.02)))
    d += 0.3 * abs(a['attack'] - t['attack']) / 0.05
    d += 1.5 * abs(np.log((a['centroid'] + 50) / (t['centroid'] + 50)))
    d += 0.04 * float(np.mean(np.abs(np.array(a['bands']) - np.array(t['bands']))))
    d += 2.0 * abs(np.sqrt(a['flat']) - np.sqrt(t['flat']))
    return float(d)


# ---------------------------------------------------------------- shaping
def fades(y, fin=0.002, fout=0.04):
    y = y.copy()
    a = min(len(y) // 2, int(fin * SR))
    b = min(len(y) // 2, int(fout * SR))
    if a > 0:
        y[:a] *= np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if b > 0:
        y[len(y) - b:] *= np.cos(np.linspace(0, np.pi / 2, b)) ** 2
    return y


def resample(x, r):
    """play r times as fast: r > 1 is higher and shorter"""
    from fractions import Fraction
    if abs(r - 1) < 1e-3:
        return x.copy()
    f = Fraction(r).limit_denominator(64)
    return signal.resample_poly(x, f.denominator, f.numerator).astype(np.float32)


def lp(x, hz, order=2):
    return signal.sosfilt(signal.butter(order, min(hz, SR / 2 - 100) / (SR / 2), 'low', output='sos'), x).astype(np.float32)


def hp(x, hz, order=2):
    return signal.sosfilt(signal.butter(order, hz / (SR / 2), 'high', output='sos'), x).astype(np.float32)


def eq_to(x, have, want, limit=10.0):
    """a gentle filter that moves recording x's spectrum (bands, dB) towards want's, at most +-limit dB"""
    g = np.clip(np.array(want) - np.array(have), -limit, limit)
    g = np.convolve(np.pad(g, 1, mode='edge'), [0.25, 0.5, 0.25], mode='valid')   # smooth across bands
    centres = np.sqrt(EDGES[:-1] * EDGES[1:])
    freqs = np.concatenate([[0], centres, [SR / 2]])
    gains = np.concatenate([[g[0]], g, [g[-1]]])
    amp = 10 ** (gains / 20)
    taps = signal.firwin2(513, freqs / (SR / 2), amp)
    y = signal.fftconvolve(x, taps)[256:256 + len(x)]
    return y.astype(np.float32)


def segments(x, thresh_db=-35, min_gap=0.08, pad=0.01, min_len=0.04):
    """one-shot pieces of a longer recording, split at the quiet gaps"""
    env = envelope(x, 0.005)
    on = env > env.max() * 10 ** (thresh_db / 20)
    out, i, gap, k = [], 0, int(min_gap / 0.005), len(env)
    while i < k:
        if on[i]:
            j, last = i, i
            while j < k and (on[j] or j - last < gap):
                if on[j]:
                    last = j
                j += 1
            a, b = max(0, int(i * 0.005 * SR - pad * SR)), min(len(x), int((last + 1) * 0.005 * SR + pad * SR))
            if (b - a) / SR >= min_len:
                out.append((a, b))
            i = j
        else:
            i += 1
    return out


def write_ogg(pcm, path, q=3, sr=SR, stereo=False, out_sr=None):
    fd, tmp = tempfile.mkstemp(suffix='.wav')
    os.close(fd)
    try:
        wf.write(tmp, sr, (np.clip(pcm, -1, 1) * 32767).astype(np.int16))
        subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp] + (['-ar', str(out_sr)] if out_sr else []) + ['-c:a', 'libvorbis', '-q:a', str(q)] + ([] if stereo else ['-ac', '1']) + [path], check=True)
    finally:
        os.remove(tmp)
