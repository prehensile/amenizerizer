# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

**AmenizerizerJs** — a fully client-side browser tool that injects a user's breakbeat
into nitro2k01's 2013 Game Boy sample masher, *Amenizer*. Load a loop, audition it
through a re-implementation of the ROM's playback engine driven by a virtual d-pad,
download a working `.gb`. No server, no upload; the stock ROM ships as an app asset
([resources/amenizer.gb](resources/amenizer.gb), md5 `fd6c84c0faf9c8b5ebd84b0351af9619`).

Svelte 5 + TypeScript + Vite, tested with Vitest.

```bash
npm run dev      # http://localhost:5173
npm test         # 89 tests, ~1.4s, no browser needed
npm run check    # svelte-check
npm run build    # svelte-check + static bundle into dist/
```

`dist/` is gitignored. Deployment is
[.github/workflows/pages.yml](.github/workflows/pages.yml): a push to `main` runs
`npm ci`, `npm test` and `npm run build`, then publishes `dist/` to GitHub Pages.
Nothing built is ever committed, so a failing test or type error blocks the deploy
rather than shipping. `base: './'` in [vite.config.ts](vite.config.ts) is what makes
the bundle work from a project-pages subpath — don't change it to `/`.

## Ground truth about the ROM

Every constant lives in [src/lib/gb/amenizer.ts](src/lib/gb/amenizer.ts), with the
disassembly evidence in its header comment. Do not hardcode these elsewhere.

| Thing | Value |
|---|---|
| ROM | 32768 bytes, no MBC, title `AMENIZER` |
| Playback engine | ROM `0x033F`–`0x0406`, copied to WRAM `$C000` at boot; timer ISR is `jp $c000` |
| Sample buffer | `0x4000`–`0x7FFF` (16384 bytes) |
| Format | 4-bit unsigned PCM, 2/byte, **high nibble plays first**, 7.5 = DC midpoint |
| Slices | 16 × 1024 bytes = 2048 samples each |
| Slice tables | `0x3F00`–`0x3FFF`, 16 tables × 16 steps; index = `(table << 4) \| step` |
| Table select | raw d-pad bitmask in `$C0CC` (bit3 Down, 2 Up, 1 Left, 0 Right); Start forces identity |
| Rate | `2097152 / (256 − TMA)`; TMA operand at `0x016A`, stock `$AD` → 25266.892 Hz |
| Loop | 32768 samples = 1.2969 s = one bar at 185.06 BPM |
| TMA range | clamped `1..0xE1`, in the ROM *and* in the patcher |

[reference/amenizer-romhack-notes.md](reference/amenizer-romhack-notes.md) is the
original handoff brief and is **wrong on three points** — this build is not silent,
`0x0407`–`0x3EFF` is unused padding not the sample buffer, and the format is now
confirmed rather than inferred. Read it for history, not for facts. The corrections
and the full engine write-up (rate trick, all four button modes) are in
[README.md](README.md); the corrections are also encoded as tests in
[src/lib/gb/rom.test.ts](src/lib/gb/rom.test.ts).

If you make a new claim about ROM behaviour, cite the address you read it from in a
comment, the way the existing code does — that convention is what keeps this
maintainable.

## Layout and the layering rule

```
src/lib/gb/        rom.ts (header, checksums, md5) · amenizer.ts (map, rate maths) · patch.ts
src/lib/audio/     resample · quantize · process · encode · wav   (pure)
                   load.ts                                        (browser: AudioContext)
src/lib/engine/    simulate.ts (offline) · engine-processor.js (worklet) · live.ts (main-thread handle)
src/lib/           state.svelte.ts (the `app` singleton) · pad.svelte.ts (the `pad` singleton)
                   selection.ts · playback.ts
src/lib/sources/   archive.ts (archive.org browsing)
src/components/    Svelte 5 UI
```

**Everything under `src/lib` except `load.ts`, `playback.ts`, `live.ts` and the
`.svelte.ts` files is plain, browser-free TypeScript.** That is deliberate: it lets
Vitest run the encoder, patcher and engine directly against the real ROM with no DOM
and no jsdom. Keep it that way — if you need a browser API, put it behind one of the
adapter modules above rather than importing it into a testable module.

Non-trivial arithmetic belongs in `src/lib`, not in a component. `selection.ts` and
`pad.svelte.ts` exist purely because click-division maths and joypad semantics were
worth unit-testing.

## Invariants that tests enforce — don't break these silently

1. **The two engines must agree sample-for-sample.** `simulate.ts` (offline, for tests
   and WAV export) and `engine-processor.js` (AudioWorklet, real-time) are independent
   implementations of the same 200-byte routine.
   [live.test.ts](src/lib/engine/live.test.ts) drives both over six button combinations
   and asserts every sample is identical. **Any change to one requires the same change
   to the other.**
2. **Identity table = raw buffer.** Under table 0 the simulated output must equal the
   ROM bytes unpacked, after the 32-sample pre-roll frame.
3. **Checksums reproduce the stock cartridge.** `headerChecksum` → `0x8C`,
   `globalChecksum` → `0x8474`. Both are recomputed on every patch.
4. **Patching touches only the sample region, the tables, `0x016A` and the checksums.**

## Engine subtleties that are easy to get wrong

- Boot state is `$C0C8 = $FC`, `$C0C9 = $0F`, pointer operand `$4000`. The first frame
  therefore plays 32 samples from `0x4000` *before* the sequencer picks a slice — the
  "pre-roll frame". Callers strip it with `.subarray(32)`.
- Per frame the order is: copy 16 bytes using the **previous** pointer, advance and
  mask the pointer, *then* tick the sequencer. Reordering changes the output.
- The repeater's mask hits the pointer's **absolute** high byte, not an offset within
  the slice, so at depth 3 it drags in neighbouring slices rather than looping the
  current one. That is faithful, not a bug.
- `nr50Gain` is duplicated in both engines; it must stay identical.

## AudioWorklet constraints

[engine-processor.js](src/lib/engine/engine-processor.js) is deliberately plain JS and
**must stay import-free** — Vite hands the file straight to `addModule`. Types live in
a sibling `.d.ts`. Two build settings depend on this and should not be "cleaned up":

- `assetsInlineLimit: 0` in [vite.config.ts](vite.config.ts) — otherwise Vite inlines
  the worklet as a base64 `data:` URL, which `addModule` rejects under a strict CSP.
- `new URL('./engine-processor.js', import.meta.url)` in [live.ts](src/lib/engine/live.ts)
  — a `?url` import does not survive the production build.

Its `registerProcessor` call is guarded by a `typeof` check so the engine core can be
imported by Node tests.

## Svelte 5 conventions

- Runes only (`$state`, `$derived`, `$derived.by`, `$props`, `$bindable`, `$effect`).
  No stores, no legacy syntax.
- Two module-level singletons: `app` in [state.svelte.ts](src/lib/state.svelte.ts)
  (ROM, source audio, encode settings, derived `patched` image) and `pad` in
  [pad.svelte.ts](src/lib/pad.svelte.ts) (button state). Components read them directly.
- `app.patched` is `$derived.by`, not a getter — every evaluation copies 32 KB and
  rechecksums, and several effects read it.
- Re-encoding is a single debounced (90 ms) `$effect` in [App.svelte](src/App.svelte)
  that explicitly `void`s each input so Svelte tracks it. Adding an encode option means
  adding it to that list.
- Panels are numbered steps 1–5 wrapped in [Panel.svelte](src/components/Panel.svelte);
  styling is CSS custom properties from [src/app.css](src/app.css), dark only.

## Other things worth knowing

- **archive.org is the only remote source that works.** `archive.org/metadata/<id>` and
  `/download/` send `Access-Control-Allow-Origin: *` and keep it across the 302. Sample
  hosts without CORS cannot be added client-side, whatever the app does.
- The encoder is intentionally pure JS (windowed-sinc resampling, mulberry32-seeded
  dither) rather than `OfflineAudioContext`, so output is deterministic and testable.
  **Dither defaults to `none`, deliberately.** This contradicts the textbook and an
  earlier version of this file, so do not "fix" it: it is a listening call the repo
  owner made after A/B-ing real material. Dither does remove correlated distortion
  on decays, but it costs 2.3 dB of noise floor (−27.6 dBFS at 0.35 LSB TPDF vs
  −29.8 undithered), and on breakbeats the distortion is masked while the hiss is
  not. `ditherAmount` (0.35) is what it comes back at when switched on; one full
  LSB puts the floor at −24 dBFS, which reads as hiss.
  Noise shaping is a trade, not a free win: the NTF is `1 − 1.5z⁻¹ + 0.5z⁻²`,
  measured at −5.4 dB below 1 kHz for +7.8 dB at 9–12.6 kHz. At a 25 kHz sample
  rate that band is still plainly audible, so `shaped` cures graininess, not hiss.
  The fed-back error must be measured pre-dither or the dither leaks through
  unshaped — [encode.test.ts](src/lib/audio/encode.test.ts) pins both the sign
  and the DC null.
- `fit` mode stretches a selection to exactly one bar (slices land on sixteenths,
  pitch changes); `rate` mode preserves pitch and pads/truncates.
- [resources/amenizer-embedded-sample.wav](resources/amenizer-embedded-sample.wav) is
  the stock break extracted at its native rate — handy for ear-checking a change.
- [reference/gb-amenizer-flask](reference/gb-amenizer-flask) is a git submodule
  (someone else's Python take on the same problem), kept for reference only.
- **The encode defaults are opinionated, not neutral**: 80 Hz high-pass, 2x soft clip,
  no dither. At 16 levels the noise floor is fixed, so loudness *is* SNR and gain
  staging beats anything in the dither settings — drive alone is worth ~8 dB. Do not
  "clean these up" back to a neutral chain. They are declared twice, in
  [encode.ts](src/lib/audio/encode.ts) and [state.svelte.ts](src/lib/state.svelte.ts),
  and must stay in step; a test pins the encoder's set. Tests that assert gain staging
  pass `highPassHz: 0, drive: 1` to get a neutral chain.
- README has a **Tuning a noisy sample** section aimed at users, mirrored as a
  collapsed `<details>` block in [EncodePanel.svelte](src/components/EncodePanel.svelte).
  If the encode defaults change, all four places need updating.
