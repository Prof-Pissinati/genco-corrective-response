"""Re-records the narration of the contest video, sentence by sentence, with the Microsoft Ryan voice (en-GB-RyanNeural),
and puts a short breathing pause after each sentence. Each scene keeps the start time of the previous recording, so the video is not touched.

Needs the `edge-tts` package (it sends only the text of each sentence to Microsoft's online voice service) and numpy:
    python tools/regravar_narracao.py <folder with edge_tts (optional)>
Output: entrega/video/frases/*.wav (one file per sentence) and entrega/video/narracao_regravada.wav (mono, 48 kHz, 16 bits).
"""
import asyncio
import os
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
VOICE = "en-GB-RyanNeural"
PAUSE_SENTENCE = 0.55      # seconds of silence after a full stop (a breath); a scene can use another value
TARGET_RMS = 0.16          # speech level, as in the first recording
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")   # path of ffmpeg (e.g. the one from the imageio-ffmpeg package)
TOTAL_S = 135.5            # length of the video: the original 131.99 s plus a held end card (the last scene needs it)

# (scene start in seconds, [sentences]); the starts are those of the first recording, except the last scene (+0.56 s, after the end card appears)
PAUSE_BY_SCENE = {8: 0.42}    # scene 9 is long and must end when the end card appears (123.25 s)

SCENES = [
    (0.30, ["An operator tool for transmission grids: mark a fault and get a plan.",
            "We opened the IEEE 118 bus system."]),
    (10.41, ["The layout adapts to the screen: the left menu can be full, compact or hidden, and the element directory on the right opens and closes on demand."]),
    (24.41, ["The N-1 screening evaluates every line and bus: 303 single contingencies, 210 need a plan.",
             "We pick line 8 to 5."]),
    (37.91, ["When line 8 to 5 trips: five lines are overloaded, up to 177 percent.",
             "The plan first redispatches generation, then sheds the minimum load, 136 megawatts.",
             "The AC power flow confirms that no overload remains."]),
    (56.23, ["GENCO verifies the plan before the exact solver.",
             "It never saw load shedding in training, yet it rejects the plans that fail and approves the plan with margin."]),
    (66.68, ["GENCO-OPF then takes the generator voltages: one bus out of range goes to zero, and the AC confirms."]),
    (74.52, ["On a typical line outage, 76 to 77, the demo only replays precomputed results.",
             "We switch between the AC and GENCO views.",
             "It is the same state, and GENCO follows the AC with a mean error of 0.06 points."]),
    (91.52, ["The repair tool gives the repair order and the block-by-block reconnection of the load.",
             "Repair and switching times are synthetic.",
             "The network is restored in 2.83 hours, with 367 megawatt-hours not supplied."]),
    (108.90, ["What we do not claim: on a CPU, GENCO is not faster than the AC, 20 milliseconds against 15.",
              "It improves on the DC approximation.",
              "It works as a ranking tool, not a verdict.",
              "The AC has the last word."]),
    (124.0, ["From fault to plan.",
              "Links to the demo and the code are on screen.",
              "Built on GENCO and OpenGridFM.",
              "Code and text developed with Claude Code, reviewed by the authors."]),
]


def read_wav(path):
    with wave.open(str(path)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float) / 32768


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def trim(x, thr=10 ** (-45 / 20), lead=0.02, tail=0.06):
    idx = np.nonzero(np.abs(x) > thr)[0]
    a = max(0, idx[0] - int(lead * SR))
    b = min(len(x), idx[-1] + int(tail * SR))
    return x[a:b]


async def synth(texts, out_dir):
    import edge_tts
    files = []
    for i, text in enumerate(texts):
        mp3 = out_dir / f"s{i:02d}.mp3"
        wav = out_dir / f"s{i:02d}.wav"
        if not wav.exists():
            await edge_tts.Communicate(text, VOICE).save(str(mp3))
            subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(mp3), "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", str(wav)], check=True)
            mp3.unlink()
        files.append(wav)
    return files


def main():
    if len(sys.argv) > 1:
        sys.path.insert(0, sys.argv[1])
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "entrega" / "video" / "frases"
    out_dir.mkdir(parents=True, exist_ok=True)
    texts = [t for _, ss in SCENES for t in ss]
    files = asyncio.run(synth(texts, out_dir))
    clips = [trim(read_wav(f)) for f in files]
    rms = [np.sqrt(np.mean(c ** 2)) for c in clips]
    gains = [TARGET_RMS / r for r in rms]
    out = np.zeros(int(TOTAL_S * SR))
    k = 0
    print("scene  start   end   next-start  slack")
    for si, (start, sentences) in enumerate(SCENES):
        t = start
        for _ in sentences:
            c = clips[k] * gains[k]
            pk = np.abs(c).max()
            if pk > 0.89:
                c *= 0.89 / pk
            fi = int(0.008 * SR)
            c[:fi] *= np.linspace(0, 1, fi)
            fo = int(0.03 * SR)
            c[-fo:] *= np.linspace(1, 0, fo)
            i = int(t * SR)
            out[i:i + len(c)] += c[: len(out) - i]
            t += len(c) / SR + PAUSE_BY_SCENE.get(si, PAUSE_SENTENCE)
            k += 1
        end = t - PAUSE_BY_SCENE.get(si, PAUSE_SENTENCE)
        nxt = SCENES[si + 1][0] if si + 1 < len(SCENES) else TOTAL_S
        print(f"{si + 1:>3}  {start:7.2f} {end:7.2f}  {nxt:7.2f}  {nxt - end:6.2f}")
    write_wav(root / "entrega" / "video" / "narracao_regravada.wav", out)
    print("ok")


if __name__ == "__main__":
    main()
