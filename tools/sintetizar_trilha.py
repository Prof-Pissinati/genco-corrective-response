"""Synthesizes the soft background music for the contest video (original, no third-party material).

A slow ambient pad (Am - F - C - G, 10 s per chord) with a few soft plucks and a synthetic reverb, stereo, 48 kHz.
Runs in any environment with numpy and scipy:  python tools/sintetizar_trilha.py entrega/video/trilha_sintetizada.wav [seconds]
"""
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
CHORDS = [  # Hz
    [110.00, 164.81, 220.00, 261.63, 329.63],      # Am
    [87.31, 130.81, 174.61, 220.00, 261.63],       # F
    [130.81, 196.00, 261.63, 329.63, 392.00],      # C
    [98.00, 146.83, 196.00, 246.94, 293.66],       # G
]
PENTA = [440.00, 523.25, 587.33, 659.25, 783.99, 880.00]
CHORD_S = 10.0


def pad_note(freq, n, rng):
    """Warm pad voice: three detuned oscillators with a few harmonics."""
    t = np.arange(n) / SR
    y = np.zeros(n)
    for det in (-0.004, 0.0, 0.004):
        ph = rng.uniform(0, 2 * np.pi)
        for h, a in ((1, 1.0), (2, 0.35), (3, 0.18), (4, 0.08)):
            y += a * np.sin(2 * np.pi * freq * (1 + det) * h * t + ph * h)
    return y / 3.0


def envelope(n, attack, release):
    e = np.ones(n)
    a, r = int(attack * SR), int(release * SR)
    e[:a] = np.linspace(0, 1, a) ** 2
    e[-r:] = np.minimum(e[-r:], np.linspace(1, 0, r) ** 2)
    return e


def main(out, seconds=140.0):
    rng = np.random.default_rng(7)
    n_total = int(seconds * SR)
    left, right = np.zeros(n_total), np.zeros(n_total)
    n_chord = int(CHORD_S * SR)
    overlap = int(4.0 * SR)                      # chords overlap by 4 s
    k = 0
    while k * n_chord < n_total:
        freqs = CHORDS[k % len(CHORDS)]
        n = n_chord + overlap
        env = envelope(n, 3.5, 4.0)
        start = k * n_chord
        for f in freqs:
            v = pad_note(f, n, rng) * env * (0.5 if f < 150 else 0.32)
            pan = rng.uniform(0.25, 0.75)
            m = min(n, n_total - start)
            left[start:start + m] += v[:m] * (1 - pan)
            right[start:start + m] += v[:m] * pan
        k += 1
    # soft plucks, every ~2.5 s, a pentatonic note with a decaying tail
    t_pl = np.arange(int(3.0 * SR)) / SR
    pos = 6.0
    while pos < seconds - 8:
        f = PENTA[rng.integers(len(PENTA))]
        pl = (np.sin(2 * np.pi * f * t_pl) + 0.25 * np.sin(2 * np.pi * 2 * f * t_pl)) * np.exp(-t_pl * 1.8) * 0.09
        pl *= np.minimum(1, t_pl / 0.01)
        i = int(pos * SR)
        m = min(len(pl), n_total - i)
        pan = rng.uniform(0.2, 0.8)
        left[i:i + m] += pl[:m] * (1 - pan)
        right[i:i + m] += pl[:m] * pan
        pos += rng.choice([2.5, 2.5, 5.0, 7.5])
    sos = butter(2, 1800, btype="low", fs=SR, output="sos")
    left, right = sosfilt(sos, left), sosfilt(sos, right)
    # echo
    d = int(0.55 * SR)
    left_e, right_e = left.copy(), right.copy()
    left_e[d:] += 0.35 * right[:-d]
    right_e[d:] += 0.35 * left[:-d]
    # synthetic reverb: decaying noise, different for each ear
    n_ir = int(2.8 * SR)
    tt = np.arange(n_ir) / SR
    ir_l = rng.standard_normal(n_ir) * np.exp(-tt * 2.2)
    ir_r = rng.standard_normal(n_ir) * np.exp(-tt * 2.2)
    ir_l /= np.abs(ir_l).sum()
    ir_r /= np.abs(ir_r).sum()
    wet_l = fftconvolve(left_e, ir_l)[:n_total] * 14
    wet_r = fftconvolve(right_e, ir_r)[:n_total] * 14
    out_l = 0.65 * left_e + 0.35 * wet_l
    out_r = 0.65 * right_e + 0.35 * wet_r
    y = np.stack([out_l, out_r], axis=1)
    fi, fo = int(4 * SR), int(6 * SR)
    y[:fi] *= np.linspace(0, 1, fi)[:, None] ** 2
    y[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
    y = y / np.abs(y).max() * 0.7
    pcm = (y * 32767).astype("<i2")
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print("ok", out, f"{seconds:.0f}s")


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 140.0)
