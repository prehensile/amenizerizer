#!/usr/bin/env python3
"""Play the original and the rebuilt ROM side by side in PyBoy and compare.

Both cartridges get the same scripted button presses, one VBlank at a time,
and their emulated audio is aligned and compared window by window. This is a
behavioural check, not a byte one: the two programs share no code, so what
has to match is what comes out of the speaker.

usage: compare.py <original.gb> <rebuilt.gb> [--wav out_prefix]
needs: pip install pyboy numpy
"""

import argparse
import sys
import wave

import numpy as np
from pyboy import PyBoy

# (start frame, buttons held from then on, label). ~59.7 frames per second.
SCRIPT = [
    (0, (), "idle: identity table"),
    (240, ("right",), "Right: table 1"),
    (420, ("down", "left"), "Down+Left: table 10"),
    (600, ("down",), "Down: table 8"),
    (780, (), "release"),
    (840, ("a",), "A: envelope, skip 4"),
    (960, ("a", "right"), "A, Right x1 -> skip 3"),
    (1080, ("a",), "A held"),
    (1090, ("a", "right"), "A, Right x2 -> skip 2"),
    (1200, (), "release"),
    (1260, ("b",), "B: repeat depth 1"),
    (1380, ("b", "down"), "B, Down -> depth 2 (and table 8)"),
    (1500, ("b",), "B held"),
    (1510, ("b", "down"), "B, Down -> depth 3"),
    (1630, (), "release"),
    (1690, ("select", "up"), "Select+Up: TMA rising"),
    (1750, ("select",), "Select"),
    (1760, (), "release, faster"),
    (1880, ("select", "down"), "Select+Down: TMA falling"),
    (2000, (), "release, slower"),
    (2120, ("start",), "Start: pause"),
    (2130, (), "paused"),
    (2250, ("start",), "Start: resume"),
    (2260, (), "playing"),
    (2380, ("select",), "Select"),
    (2390, ("select", "start"), "Select+Start: invert NR33"),
    (2400, (), "inverted"),
    (2580, ("select",), "Select"),
    (2590, ("select", "start"), "Select+Start: back"),
    (2600, (), "normal"),
    (2780, None, "end"),
]


# PyBoy point-samples the APU. The two programs retrigger the wave channel at
# slightly different cycle offsets, so every edge lands up to one output
# sample apart: at 48 kHz that alone caps the correlation near 0.95. A high
# output rate (PyBoy drops samples above this one) plus a short moving average
# before scoring takes that phase jitter out without hiding real differences,
# which last at least a whole 32-sample frame.
RATE = 262144
SMOOTH = 16


def smooth(x: np.ndarray) -> np.ndarray:
    return np.convolve(x.astype(np.float64), np.ones(SMOOTH) / SMOOTH, "same")


def run(rom: str) -> tuple[np.ndarray, list[int]]:
    """Mono audio at RATE, plus TMA as it stands at the end of each segment."""
    pb = PyBoy(rom, window="null", sound_emulated=True, sound_sample_rate=RATE)
    held: set[str] = set()
    chunks, tmas = [], []
    frame = 0
    for (start, buttons, _), (end, _, _) in zip(SCRIPT, SCRIPT[1:]):
        want = set(buttons)
        for b in held - want:
            pb.button_release(b)
        for b in want - held:
            pb.button_press(b)
        held = want
        while frame < end:
            pb.tick()
            chunks.append(pb.sound.ndarray.astype(np.float32).mean(axis=1))
            frame += 1
        tmas.append(pb.memory[0xFF06])
    pb.stop(save=False)
    return np.concatenate(chunks), tmas


def best_lag(a: np.ndarray, b: np.ndarray, lo: int, hi: int, span: int) -> int:
    """Offset k in [-span, span] such that b[lo+k:hi+k] best matches a[lo:hi]."""
    span = min(span, lo, len(b) - hi)
    ref = (a[lo:hi] - a[lo:hi].mean()).astype(np.float64)
    seg = b[lo - span : hi + span].astype(np.float64)
    n = 1 << int(np.ceil(np.log2(len(seg) + len(ref))))
    xc = np.fft.irfft(np.fft.rfft(seg, n) * np.conj(np.fft.rfft(ref, n)), n)
    return int(np.argmax(xc[: 2 * span + 1])) - span


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("original")
    ap.add_argument("rebuilt")
    ap.add_argument("--wav", help="write <prefix>-original.wav and <prefix>-rebuilt.wav")
    args = ap.parse_args()

    (a, tma_a), (b, tma_b) = run(args.original), run(args.rebuilt)
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    spf = n / SCRIPT[-1][0]

    # The two programs start playback at different points after boot (GBDK's
    # crt0 does more work than the original's init), so the rebuilt stream
    # runs a fixed number of *samples* behind. In seconds that offset scales
    # with TMA, so each segment is aligned on its own. Each segment also skips
    # its first slice (~5 frames): a button change landing between the two
    # programs' slice boundaries legitimately takes effect one slice apart.
    print(" frames        lag(ms)  corr    rms ratio  TMA")
    worst = 1.0
    tma_ok = tma_a == tma_b
    prev_tma = tma_a[0]
    segments = zip(SCRIPT, SCRIPT[1:], tma_a, tma_b)
    for (start, _, label), (end, _, _), ta, tb in segments:
        ramp, prev_tma = ta != prev_tma, ta
        tma = f"${ta:02X}" + ("" if ta == tb else f" vs ${tb:02X} MISMATCH")
        # Segment 0 also holds PyBoy's boot chime and the two different
        # start-up times; score it from 1.5 s in.
        # The last segment stops short of the end so the lag search has room.
        lo, hi = int(max(start + 6, 90) * spf), min(int(end * spf), n - RATE // 20)
        if hi - lo < RATE // 10:
            continue
        x = smooth(a[lo:hi] - a[lo:hi].mean())
        if np.dot(x, x) < 1e-6:
            y = b[lo:hi]
            silent = np.abs(y - y.mean()).max() < 1e-3
            print(f"{start:5d}-{end:5d}      -      -       -       {tma:4s} {label}"
                  f" ({'both silent' if silent else 'REBUILT NOT SILENT'})")
            worst = min(worst, 1.0 if silent else 0.0)
            continue
        k = best_lag(a, b, lo, hi, RATE // 20)
        y = smooth(b[lo + k : hi + k] - b[lo + k : hi + k].mean())
        corr = float(np.dot(x, y) / np.sqrt(np.dot(x, x) * np.dot(y, y)))
        ratio = float(np.sqrt(np.dot(y, y) / np.dot(x, x)))
        # While TMA is ramping the two programs are at different points of
        # the ramp for any one lag, so those segments are shown, not scored.
        if not ramp:
            worst = min(worst, corr)
        note = "  (ramp, not scored)" if ramp else ""
        print(f"{start:5d}-{end:5d}  {k * 1000 / RATE:7.2f}  {corr:6.4f}  {ratio:6.3f}"
              f"   {tma:4s} {label}{note}")

    if args.wav:
        step = RATE // 48000  # plain decimation; this is for ear-checking only
        for name, x in (("original", a), ("rebuilt", b)):
            x = x[::step]
            pcm = np.clip(x / max(1.0, np.abs(x).max()) * 32767, -32768, 32767).astype("<i2")
            with wave.open(f"{args.wav}-{name}.wav", "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(RATE // step)
                w.writeframes(pcm.tobytes())

    # Not 0.99+: the original's VBlank handler zeroes the table select, the
    # repeater mask and the envelope switch before storing their real values,
    # with interrupts on, and the rebuild keeps that. When a timer IRQ lands
    # in one of those windows a frame or a slice plays wrong. The windows sit
    # at different cycles in the two programs, so those glitches never line
    # up, and one bad slice in a 2 s segment costs about 0.02.
    print(f"worst segment correlation {worst:.4f}; TMA {'matches' if tma_ok else 'DIFFERS'}")
    sys.exit(0 if worst > 0.97 and tma_ok else 1)


if __name__ == "__main__":
    main()
