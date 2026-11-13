"""Leon Clash: pick the sound effects and music and copy them into the game.

Sources (all CC0, each licence read on its own page, see public/clash/CREDITS.md):
  Kenney, Interface Sounds      https://opengameart.org/content/interface-sounds
  artisticdude, RPG Sound Pack  https://opengameart.org/content/rpg-sound-pack
  beardalaxy, Mountain Theme Loop https://opengameart.org/content/mountain-theme-loop
They sit outside the repo in D:/code/personal/texture_sources/clash/sound/.
OGG files are copied as they are. WAV files are made small: mono, 22050 Hz,
16 bit, silence trimmed, a short fade out. Writes public/clash/assets/sfx/ and
sfx.json (name -> file).

  python tools/clash/build_audio.py
"""
import json
import os
import shutil
import wave

import numpy as np

SRC = "D:/code/personal/texture_sources/clash/sound/"
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "public", "clash", "assets", "sfx"))

PICK = {
    "tap": "kenney_interfaceSounds/click_002.ogg",
    "deploy": "kenney_interfaceSounds/drop_002.ogg",
    "spell": "rpg_sound_pack/magic1.wav",
    "nope": "kenney_interfaceSounds/error_004.ogg",
    "poof": "rpg_sound_pack/cloth.wav",
    "boom": "rpg_sound_pack/wood-small.wav",
    "freeze": "kenney_interfaceSounds/glass_002.ogg",
    "whistle": "kenney_interfaceSounds/question_002.ogg",
    "tower": "kenney_interfaceSounds/bong_001.ogg",
    "lodge": "rpg_sound_pack/metal-ringing.wav",
    "emote": "kenney_interfaceSounds/pluck_002.ogg",
    "ability": "rpg_sound_pack/spell.wav",
    "melee": "rpg_sound_pack/swing.wav",
    "shot": "rpg_sound_pack/swing2.wav",
    "arrow": "rpg_sound_pack/swing3.wav",
    "snow": "kenney_interfaceSounds/drop_001.ogg",
    "win": "kenney_interfaceSounds/confirmation_002.ogg",
    "lose": "kenney_interfaceSounds/error_008.ogg",
    "flag": "kenney_interfaceSounds/confirmation_001.ogg",
}
MUSIC = "mountain_in_game.ogg"


def small_wav(src, dst, max_s=1.6):
    with wave.open(src, "rb") as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        a = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    elif sw == 1:
        a = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    elif sw == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        a = v.astype(np.float32) / (1 << 23)
    else:
        a = np.frombuffer(raw, dtype="<i4").astype(np.float32) / (1 << 31)
    a = a.reshape(-1, ch).mean(1)
    # resample to 22050 by linear steps
    if rate != 22050:
        t = np.arange(0, len(a) - 1, rate / 22050)
        i = t.astype(int)
        f = t - i
        a = a[i] * (1 - f) + a[i + 1] * f
    # trim quiet ends
    loud = np.where(np.abs(a) > 0.01)[0]
    if len(loud):
        a = a[max(0, loud[0] - 40): loud[-1] + 200]
    a = a[: int(22050 * max_s)]
    fade = min(len(a), 1500)
    a[-fade:] *= np.linspace(1, 0, fade)
    pk = np.abs(a).max() or 1
    a = a / pk * 0.89
    with wave.open(dst, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        w.writeframes((a * 32767).astype("<i2").tobytes())


def main():
    os.makedirs(OUT, exist_ok=True)
    man = {}
    for name, rel in PICK.items():
        src = SRC + rel
        if rel.endswith(".ogg"):
            dst = os.path.join(OUT, name + ".ogg")
            shutil.copyfile(src, dst)
        else:
            dst = os.path.join(OUT, name + ".wav")
            small_wav(src, dst)
        man[name] = os.path.basename(dst)
    shutil.copyfile(SRC + MUSIC, os.path.join(OUT, "music.ogg"))
    man["music"] = "music.ogg"
    with open(os.path.join(OUT, "sfx.json"), "w") as f:
        json.dump(man, f)
    tot = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
    print(len(man), "sounds,", tot // 1024, "KB")


if __name__ == "__main__":
    main()
