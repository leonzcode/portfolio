"""
sRGB <-> CIE Lab in numpy, and the colour correction build_textures.py applies.

The correction pulls a texture's colours toward a target: it shifts the mean of
each Lab channel to the target mean and scales the spread around that mean to the
target spread. A texture is described by six numbers (mean L, a, b and spread
L, a, b), nothing else: no pixels, so no picture can be recovered from them.
"""
import numpy as np

_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_MI = np.linalg.inv(_M)
_WHITE = np.array([0.95047, 1.0, 1.08883])


def srgb_to_lab(rgb):
    """rgb: (..., 3) floats 0..1 -> Lab (L 0..100)."""
    c = np.asarray(rgb, np.float64)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = (lin @ _M.T) / _WHITE
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_srgb(lab):
    lab = np.asarray(lab, np.float64)
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * _WHITE
    lin = np.clip(xyz @ _MI.T, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)


def lab_stats(frames):
    """[mean L, a, b, spread L, a, b] over the pixels of float RGBA frames that are mostly opaque; None if there are none."""
    px = []
    for f in frames:
        m = f[..., 3] > 0.5
        if m.any():
            px.append(srgb_to_lab(f[..., :3][m]))
    if not px:
        return None
    px = np.concatenate(px, 0)
    return [*px.mean(0), *px.std(0)]


def correct(frames, target, neutral=False):
    """Shift/scale the Lab statistics of float RGBA frames to target (six numbers). Alpha is left alone.
    neutral: the texture is tinted at run time (grass, leaves, water...), so the target is the grey the game tints:
    the colour channels are flattened onto the target mean."""
    cur = lab_stats(frames)
    if cur is None or target is None:
        return frames
    out = []
    k = []
    for c in range(3):
        s, t = cur[3 + c], target[3 + c]
        if s < 0.4:
            k.append(1.0)
        elif c == 0:
            k.append(float(np.clip(t / s, 0.5, 2.0)))
        elif neutral:
            k.append(0.0)
        else:
            k.append(float(np.clip(t / s, 0.35, 2.0)))
    for f in frames:
        lab = srgb_to_lab(f[..., :3])
        for c in range(3):
            lab[..., c] = (lab[..., c] - cur[c]) * k[c] + target[c]
        lab[..., 0] = np.clip(lab[..., 0], 0, 100)
        g = f.copy()
        g[..., :3] = np.clip(lab_to_srgb(lab), 0, 1)
        out.append(g.astype(np.float32))
    return out
