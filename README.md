# AmenizerizerJs

A browser-based, fully client-side tool for putting your own breakbeat into
nitro2k01's 2013 Game Boy sample masher, [Amenizer](https://blog.gg8.se/wordpress/2013/02/11/gameboy-project-week-6-can-i-have-an-a-men/).

Drop in a loop, play it with a virtual Game Boy d-pad, and download a working
`.gb`. The ROM ships with the app; no server, no upload.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 89 tests
npm run build   # static bundle in dist/
```

## Corrections to `reference/amenizer-romhack-notes.md`

The handoff notes are wrong on three points. All three were re-verified against
`resources/amenizer.gb` (md5 `fd6c84c0faf9c8b5ebd84b0351af9619`) before any code
was written, and the checks are encoded as tests.

**1. This build is not silent.** The notes say "there is no PCM sample data
anywhere in the ROM" and call this the "silent/empty build". The scan stopped at
`0x3EFF`. There is a full 16 KiB breakbeat at **`0x4000`–`0x7FFF`** — the entire
upper half of the cartridge. Its nibble histogram is a bell curve centred on 7/8
(the 4-bit midpoint), and per-slice RMS peaks on slices 0, 4, 8 and 9 — kick and
snare on beats 1, 2-and, 3 and 3-and. There is no need to source a
"preloaded build"; open question #4 is moot.

**2. `0x0407`–`0x3EFF` is not the sample buffer.** It is unused zero padding —
~15 KiB of free space. The code ends at `0x0406`. Open question #2 is answered.

**3. The sample format is now confirmed, not inferred.** Open questions #1 and
#3 are answered below.

## What the ROM actually does

The playback engine is 200 bytes at ROM `0x033F`–`0x0406`, copied to WRAM
`$C000` at boot; the timer ISR is just `jp $c000`. Rebasing that block to
`$C000` and reading it is what pins down everything here.

| Property | Value | Evidence |
|---|---|---|
| Sample buffer | `0x4000`–`0x7FFF`, 16384 bytes | `ld hl,$4000` at `$C000` |
| Format | 4-bit unsigned PCM, 2/byte, **high nibble first** | wave RAM semantics |
| Total samples | 32768 | 16384 × 2 |
| Slices | 16 × 1024 bytes (2048 samples) | `add a` ×2, `or $40` → `0x4000 + n*0x400` |
| Reload unit | 16 bytes = 32 samples per timer IRQ | 16× `ld a,[hl+] / ld [c],a` |
| Frames per slice | 64 | counter at `$C0C8` adds 4, wraps at 256 |
| Sample rate | `2097152 / (256 − TMA)` Hz | see below |
| Stock rate | TMA `$AD` → **25266.892 Hz** | `ld a,$ad` at `0x0169` |
| Loop length | 1.2969 s = one bar at **185.06 BPM** | 32768 / 25266.892 |
| Slice length | 81.05 ms | 2048 / 25266.892 |

The rate trick is worth spelling out. `TAC = $06` runs the timer at 65536 Hz, so
it overflows every `256 − TMA` ticks. Each interrupt the engine writes
`NR33 = TMA` and `NR34 = $87`, making the wave frequency register `0x700 | TMA`
— and the wave channel steps at `2097152 / (2048 − freq)`, where
`2048 − (0x700 | TMA) = 256 − TMA`. Both sides share one divisor, which is what
keeps the wave-RAM reload locked to the waveform. Changing TMA retunes the
sample and the reload together.

### Controls (all confirmed by disassembly)

Joypad is assembled at `Call_000_0285` as `[Start Select B A | Down Up Left Right]`.

- **D-pad alone** → `table_select = held & 0x0F`, stored at `$C0CC`. The table
  index *is* the D-pad bitmask. Start forces identity.
- **Select + Up/Down** → nudges TMA (pitch), clamped to `1..$E1`.
- **A + Left/Right** → decay envelope. Self-modifies the `jr` operand at `$C092`
  to skip 0–4 `add hl,hl`, changing how fast `NR50` ramps down.
- **B + Up/Down** → the repeater. Adjusts the depth in `$C0CD` (clamped 1..3),
  which self-modifies the mask at `$C056` (the operand of `and $7F`). The
  routine builds it with `ld a,$01`, `d - 1` doublings and a `cpl`, so depth `d`
  clears **bit `d-1`** of the pointer's high byte and playback folds back every
  `256 << (d-1)` bytes. This is the granular/stutter effect.

  Worth knowing: the mask hits the *absolute* high byte, not an offset within
  the slice. At depth 3 that means slice 1 (`$4400`) gets its bit 2 cleared and
  jumps to `$40xx` — so the repeater starts dragging in *other* slices rather
  than looping the current one.

## Design

The ROM and audio code is plain TypeScript with no framework and no browser
APIs, so it runs under Vitest directly against the real ROM:

```
src/lib/gb/       rom.ts (header, checksums, md5) · amenizer.ts (map, rates) · patch.ts
src/lib/audio/    resample.ts · quantize.ts · process.ts · encode.ts · wav.ts · load.ts
src/lib/engine/   simulate.ts (offline) · engine-processor.js (AudioWorklet) · live.ts
src/lib/pad.svelte.ts   the joypad control scheme
src/components/   Svelte 5 UI
```

**Playback.** The notes proposed a WASM Game Boy core for auditioning. That is a
lot of dependency for a 200-byte routine, so the engine is reimplemented twice
over, from the same reading of the disassembly:

- `simulate.ts` renders offline, for tests and WAV export.
- `engine-processor.js` is an AudioWorklet that steps the engine one sample at
  a time, so held buttons change what you hear immediately. It stays
  import-free because Vite hands the file straight to `addModule`.

Keeping two implementations honest is a test: `live.test.ts` drives both across
six button combinations and asserts every sample is identical. Another test
asserts the simulated output equals the raw buffer bytes under the identity
table.

`pad.svelte.ts` holds the control scheme itself — which modifier gates what, the
`1..3` and `0..4` clamps, edge-vs-held triggering — as plain TypeScript, so the
hardware's semantics are unit-tested rather than buried in a component.

**Encoding.** Source audio is downmixed, windowed-sinc resampled (band-limited —
44.1 kHz into 25.3 kHz aliases badly otherwise), DC-corrected, gain-staged,
optionally soft-clipped and seam-faded, then quantised to 4 bits, with dither
available in rectangular, triangular and noise-shaped flavours at an adjustable
level.

The defaults are tuned for a 4-bit target rather than neutral: an 80 Hz
high-pass and 2× soft clip. The noise floor is fixed, so loudness *is* SNR, and
gain staging buys more than any dither setting does. Pass
`highPassHz: 0, drive: 1` for an unprocessed chain.

Dither defaults to **off**, which goes against the textbook. At 16 levels it does
kill the correlated distortion on decays, but it costs 2.3 dB of noise floor
(−27.6 dBFS dithered against −29.8 undithered), and on breakbeats — dense and
always moving — the distortion it removes is masked while the hiss it adds is
not. Sparse material with long tails is the case that wants it back on. See
[Tuning a noisy sample](#tuning-a-noisy-sample).

Two length modes:
- **Fit** — stretch the selection to exactly one bar. Slices land on sixteenths
  by construction. Changes pitch. This is what you want for a loop.
- **Rate** — resample at the true ratio to preserve pitch, then pad or truncate.

**Checksums.** Both the header checksum (`0x014D`) and global checksum
(`0x014E`–`0x014F`) are recomputed. Both algorithms are verified in tests by
reproducing the stock ROM's stored `0x8C` / `0x8474`.

**Rate patching.** Optionally rewrites the TMA operand at `0x016A`, letting you
set the loop's BPM directly. The engine clamps TMA to `1..$E1` at runtime and so
does the patcher.

## Tuning a noisy sample

The Game Boy has **16 volume steps**. Every noise problem comes from that. Think
of it as drawing with 16 shades of grey: use only the middle four and it looks
blocky and grainy — use all sixteen and it looks fine.

There is a fixed amount of noise sitting under your sample and you cannot remove
it. You get two moves: make the noise quieter, or make the sample louder so the
noise matters less. **The second works better.**

### What the defaults already do

- **High-pass at 80 Hz.** Deep bass eats those 16 steps and you cannot hear it on
  a Game Boy speaker anyway.
- **Drive at 2×.** The big one — it lifts the whole loop.
- **No dither.** Dither trades a cleaner tone for a louder hiss, and on most
  breakbeats that is a bad trade.

So the one thing left to you is to **trim tight** to the part you want looping.
If it still sounds wrong, read on.

### Work out which noise you have

| What you hear | What it is | What to do |
|---|---|---|
| A steady hiss, there even in the gaps | The sample is too quiet, or dither is on | Drive **up**, dither **off** |
| A crunchy, gritty texture on cymbal tails and fades | The 16 steps becoming audible as the sound decays | Dither **on** at 0.3–0.5, or try Noise-shaped |

Chase one too hard and you summon the other. Dense, busy loops mask the grit and
want no dither; sparse material with long tails is the case that needs it.

### Not worth reaching for

- **Normalise** only looks at the single loudest peak, so one stray snare stops
  it doing anything useful. Drive is what raises the overall level.
- **Noise-shaped** is not a "less noise" setting despite the name. Its noise
  transfer function is `1 − 1.5z⁻¹ + 0.5z⁻²`, measured at −5.4 dB below 1 kHz for
  +7.8 dB at 9–12.6 kHz — it moves noise into the treble. Good for grittiness,
  worse for hiss.
- **Loop-seam fade** only fixes the click where the loop wraps.

Short version: loud and slightly distorted beats quiet and clean. Sixteen steps
is so few that you want to use every one of them.

## Verifying by ear

`resources/amenizer-embedded-sample.wav` is the break extracted from the stock
ROM at its native 25266.892 Hz — the fastest way to confirm correction #1.
The app's **Extract ROM's current sample** button does the same for any build.
