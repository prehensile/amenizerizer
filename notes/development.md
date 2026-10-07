# How this got built

A record of the decisions, in roughly the order they were made, and why. The
point of writing them down is that several look wrong from the outside and get
"fixed" back to the obvious thing by anyone who doesn't know the reasoning.

## Starting point

The project began from a handoff brief
([../reference/amenizer-romhack-notes.md](../reference/amenizer-romhack-notes.md))
written after a first session of poking at the ROM. Its factual claims turned
out to be wrong in three places — see the corrections in
[rom-behaviour.md](rom-behaviour.md) — so the first real work was re-deriving
everything from the disassembly and pinning each finding as a test. That set the
convention the codebase still follows: any claim about ROM behaviour cites the
address it was read from.

[../reference/gb-amenizer-flask](../reference/gb-amenizer-flask) is a submodule
pointing at Chiptune-Anamnesis's Flask app, which solves the same problem
server-side: upload a headerless 8-bit raw loop, get a patched ROM back. It
ships a byte-identical `amenizer.gb`, which independently confirmed we are both
patching the same build. Kept for reference; nothing in our build reads it.

## Playback: two engines instead of an emulator

The brief proposed embedding a WASM Game Boy core so users could audition the
patched ROM. That is a large dependency for a 200-byte interrupt routine, and it
would have made the engine's behaviour untestable in the terms we care about.

Instead the routine is re-implemented twice, from the same reading of the
disassembly:

- `simulate.ts` renders offline, for tests and WAV export.
- `engine-processor.js` is an AudioWorklet stepping the engine one sample at a
  time, so held buttons change what you hear immediately.

Two implementations of the same thing is normally a smell. Here it buys
something: `live.test.ts` drives both across six button combinations and asserts
every sample is identical, which catches a mistake in either. The cost is that
**a change to one always requires the same change to the other** — including
`nr50Gain`, which is duplicated deliberately.

A second test asserts the simulated output equals the raw buffer bytes under the
identity table, which is what would break first if the nibble order or the
pre-roll frame were ever got wrong.

## The encoder is pure JS, not OfflineAudioContext

Resampling through the browser's own audio graph would have been less code, but
the output would vary by browser and could not be tested in Node. The chain is
therefore hand-written: windowed-sinc resampling (44.1 kHz into 25.3 kHz aliases
badly without band-limiting), DC correction, gain staging, soft clip, seam fade,
then 4-bit quantisation with optional dither seeded by mulberry32. Deterministic,
and testable directly against the real ROM with no DOM.

## Encode defaults are opinionated

80 Hz high-pass, 2× soft clip, no dither. This is not a neutral chain and it is
not meant to be.

At sixteen levels the noise floor is fixed, so loudness *is* SNR — gain staging
beats anything in the dither settings, and drive alone is worth about 8 dB. The
high-pass is there because deep bass consumes those sixteen steps and is
inaudible on the target hardware anyway.

**Dither off is the one that looks like a bug.** It contradicts the textbook.
It was a listening call made after A/B-ing real material: dither does remove the
correlated distortion on decays, but it costs 2.3 dB of noise floor (−27.6 dBFS
at 0.35 LSB TPDF against −29.8 undithered), and on breakbeats — dense, always
moving — the distortion is masked while the hiss is not. Sparse material with
long tails is the case that wants it back on, which is why the control is still
there and `ditherAmount` still defaults to 0.35 for when it is switched on. One
full LSB puts the floor at −24 dBFS, which reads as hiss.

Noise shaping is a trade, not a free win. The NTF is `1 − 1.5z⁻¹ + 0.5z⁻²`,
measured at −5.4 dB below 1 kHz for +7.8 dB at 9–12.6 kHz. At a 25 kHz sample
rate that band is still plainly audible, so `shaped` cures graininess, not hiss.
The fed-back error has to be measured pre-dither or the dither leaks through
unshaped; a test pins both the sign and the DC null.

Because these defaults are a judgement call rather than a derivation, they are
explained to users in the README and in a collapsed block in the encode panel,
and they are declared in two places in code that must stay in step.

## Length modes

`fit` stretches a selection to exactly one bar, so slices land on sixteenths by
construction — pitch changes, and this is what a loop wants. `rate` resamples at
the true ratio to preserve pitch, then pads or truncates. Both were needed; the
first is right for breaks, the second for anything tonal.

## Selection maths lives outside the components

Click-division ("dividers quarter the current selection, click again to go
finer") and joypad semantics (which modifier gates what, the `1..3` and `0..4`
clamps, edge-versus-held triggering) both ended up in plain modules —
`selection.ts` and `pad.svelte.ts` — rather than inside Svelte components. Both
are fiddly enough to be worth unit-testing, and neither needs a DOM. The general
rule that fell out: non-trivial arithmetic goes in `src/lib`, and anything
browser-only goes behind a named adapter module so the rest stays testable.

## Remote sources: archive.org and nothing else

The source panel can browse archive.org because `archive.org/metadata/<id>` and
`/download/` send `Access-Control-Allow-Origin: *` and keep it across the 302.
Other sample hosts were tried; without CORS headers a purely client-side app
cannot read them, and no amount of app-side cleverness changes that. Adding more
sources means finding more hosts that send the header.

## Deployment: build in CI, never commit `dist/`

An early version committed the built bundle. That was replaced with a GitHub
Actions workflow that runs `npm ci`, `npm test` and `npm run build` on every
push to `main` and publishes `dist/` to Pages. Because `npm run build` runs
`svelte-check` first, a failing test or a type error now blocks the deploy
instead of shipping. `base: './'` in the Vite config is what lets the bundle
work from a project-pages subpath.

`assetsInlineLimit: 0` is also load-bearing: without it Vite inlines the
AudioWorklet as a base64 `data:` URL, which `addModule` rejects under a strict
CSP. For the same reason the worklet file is import-free plain JS and is
referenced with `new URL(..., import.meta.url)` — a `?url` import does not
survive the production build.

## The ROM, rebuilt from source

[../rom/](../rom/) is a GBDK-2020 reimplementation of the whole cartridge, not
just the engine the web app models: init, the VBlank control handler,
pause/resume, the NR33 inversion, the link-port sync bytes and the BGP CPU
meter. It is a reconstruction for reading and building on, not a byte match —
GBDK's crt0 owns the low ROM, so nothing lands at the original's code
addresses and the web app cannot patch the result. Instead the break, slice
tables and boot TMA are lifted from a source cartridge at build time and the
break and tables go back at `0x4000` and `0x3F00`, so any ROM the app has
produced rebuilds from source with its own break.

Choices that look odd:

- **The wave-RAM reload is inline assembly.** The channel outputs nothing
  between `NR51 = $BB` and `NR51 = $FF`, and that gap, ~790 times a second, is
  part of the original's sound. SDCC's unrolled C copy made it about twice as
  long, which the emulator comparison caught as a 25% louder buzz before a
  single sample of the break differed. Everything around the reload is C.
- **The control logic runs in the main loop after `wait_vbl_done()`**, not in
  a VBlank ISR. The original's VBlank handler re-enables interrupts at once
  so the timer can preempt it. GBDK's crt0 owns the VBlank vector (`ISR_VECTOR`
  refuses it), and running the logic from the main loop gets the same
  preemption without depending on how crt0 dispatches. OAM DMA is switched
  off to keep crt0's own VBlank ISR short, since it delays the timer IRQ.
- **The original's races are kept.** Three VBlank writes go zero-then-value
  with interrupts on, and a timer IRQ in between plays a frame or a slice
  wrong (see [rom-behaviour.md](rom-behaviour.md)). The rebuild writes in the
  same order, so the same glitches can happen, though not at the same moments.
- **The assets are generated as assembly, not C.** SDCC puts every `__at`
  constant in one `_CABS` area and the linker concatenates those across
  modules, which silently moved the tables to `0x3F03` on the first attempt.
  An `ABS` area of our own with `.org`s does not.

`rom/tools/compare.py` is the evidence it behaves the same. It runs both
cartridges in PyBoy under one scripted 46-second session covering every
button mode, aligns the audio per segment and correlates it. Three things
about the method matter:

- PyBoy point-samples the APU, so at 48 kHz the two programs' slightly
  different trigger phases show up as one-sample jitter on every gap edge and
  cap the correlation near 0.95 even when the content is identical. It runs at
  262144 Hz (higher rates drop samples) and smooths over 16 samples first.
- The rebuild starts playback ~29 ms later (crt0 does more than the
  original's init), a fixed offset in *samples*, so in seconds it scales with
  TMA. Segments are aligned one at a time, and those where TMA is ramping are
  shown but not scored; TMA itself is compared directly instead.
- Scored segments come out at 0.996–0.9997 apart from one at 0.9785: the
  original's table-select race firing in that segment and not in the
  rebuild's. The pass mark is 0.97 for that reason.

Not covered by the comparison: real hardware, CGB, and whether the link-port
bytes actually drive anything.

## Documentation split

This repo previously had one README carrying all of the above: user
instructions, disassembly evidence, corrections to a brief no reader had seen,
and internal conventions. It has since been split three ways —
[../README.md](../README.md) for people who want to use the tool,
`notes/` for how it works and how it got here, and
[../CLAUDE.md](../CLAUDE.md) for the rules an AI coding agent needs to not break
things.
