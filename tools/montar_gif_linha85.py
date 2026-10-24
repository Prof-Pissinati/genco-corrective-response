"""Builds the short GIF of the post (line 8-5: pre-fault, post-fault, with plan) from the frames recorded by tools/captura/video_gif_linha85.mjs.

Resamples the frames to 30 fps by their time stamps (a still screen simply holds its last frame), draws the cursor and the click rings,
adds the caption bar and writes entrega/video/gif_linha85.gif (the part from START to END, 1000 px wide, 15 fps).
Needs Pillow; ffmpeg path below.   python tools/montar_gif_linha85.py
"""
import bisect
import json
import os
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "entrega" / "video" / "gif_linha85"
OUTV = ROOT / "entrega" / "video" / "gif_linha85.gif"
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")   # path of ffmpeg (e.g. the one from the imageio-ffmpeg package)
FPS, START, END = 15, 5.0, 11.6          # only the transition part: pre-fault, post-fault, with plan
DUR = END - START
W, H = 1920, 1080
BAR_Y = 988
CAPTIONS = [(0.0, 3.0, "N-1 screening: pick line 8–5"),
            (0.0, 8.6, "Pre-fault to post-fault: 5 lines overloaded, up to 177%"),
            (8.6, 99.0, "With plan: redispatch and minimum load shedding, AC-verified")]
FONT = ImageFont.truetype("C:/Windows/Fonts/seguisb.ttf", 40)

m = json.loads((D / "manifest.json").read_text())
T0 = m["T0"]
frames = sorted(m["frames"], key=lambda f: f["ts"])
fts = [f["ts"] for f in frames]
cur = sorted(m["cursor"])
cts = [c[0] for c in cur]
clicks = m["clicks"]


def small(i):
    return np.asarray(Image.open(D / frames[i]["file"]).convert("L").resize((192, 108)), dtype=float)


def abrupt_changes():
    """Bursts of screencast frames (gaps < 80 ms) that change the screen a lot in few frames (a menu that just appears or disappears).
    A smooth animation has many frames and is left alone; an abrupt change gets a quick 0.25 s dissolve."""
    bursts, cur_b = [], [0]
    for i in range(1, len(frames)):
        if fts[i] - fts[i - 1] < 0.08:
            cur_b.append(i)
        else:
            bursts.append(cur_b)
            cur_b = [i]
    bursts.append(cur_b)
    out = []
    for b in bursts:
        if b[0] == 0:
            continue
        t0 = fts[b[0]] - T0
        if len(b) >= 8:
            continue
        if np.abs(small(b[-1]) - small(b[0] - 1)).mean() > 3.0:
            out.append((t0, b[0] - 1, b[-1]))
    return out


ABRUPT = abrupt_changes()


@lru_cache(maxsize=24)
def load(i):
    return Image.open(D / frames[i]["file"]).convert("RGB")


def frame_at(t):
    i = bisect.bisect_right(fts, T0 + t) - 1
    return load(max(0, i))


def make_cursor():
    s = 6   # supersampling
    pts = [(0, 0), (0, 17), (4.5, 13), (8, 21), (11, 19.5), (7.5, 12), (13, 12)]
    img = Image.new("RGBA", (24 * s, 28 * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(x * s + 2 * s, y * s + 2 * s) for x, y in pts], fill=(255, 255, 255, 255), outline=(0, 0, 0, 255), width=int(1.6 * s))
    return img.resize((24, 28), Image.LANCZOS)


CURSOR = make_cursor()


def caption(img, t):
    text = next((c for a, b, c in CAPTIONS if a <= t < b), None)
    if text is None:
        return
    d = ImageDraw.Draw(img)
    d.rectangle([0, BAR_Y, W, H], fill=(0, 0, 0))
    w = d.textlength(text, font=FONT)
    d.text(((W - w) / 2, BAR_Y + 14), text, font=FONT, fill=(255, 255, 255))


def render(t):
    img = frame_at(t).copy()
    for t0, ia, ib in ABRUPT:                           # abrupt change: quick dissolve instead of a jump
        if t0 <= t < t0 + 0.25:
            u = (t - t0) / 0.25
            img = Image.blend(load(ia), load(ib), u * u * (3 - 2 * u))
    # click rings
    for c in clicks:
        u = (t - c[0]) / 0.45
        if 0 <= u < 1:
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            r = 8 + 26 * u
            ImageDraw.Draw(layer).ellipse([c[1] - r, c[2] - r, c[1] + r, c[2] + r], outline=(255, 205, 50, int(255 * (1 - u))), width=3)
            img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")
    j = max(0, bisect.bisect_right(cts, t) - 1)
    _, x, y = cur[j]
    img.paste(CURSOR, (int(x) - 2, int(y) - 2), CURSOR)
    caption(img, t)
    return img


def main():
    out = D / "out"
    out.mkdir(exist_ok=True)
    n = int(DUR * FPS)
    for k in range(n):
        render(START + k / FPS).save(out / f"{k:05d}.jpg", quality=95)
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(FPS), "-i", str(out / "%05d.jpg"),
                    "-vf", "scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
                    "-loop", "0", str(OUTV)], check=True)
    print("ok", OUTV, n, "frames", round(OUTV.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
