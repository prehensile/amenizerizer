# Amenizer ROM hacking — project brief & handoff notes

## What this project is

Build a **browser-based (JS, client-side) tool** to insert new audio samples into the
Amenizer Game Boy ROM, so a user can load their own loop in place of the (absent or
Amen) sample and get a working, sound-producing `.gb` file back.

Amenizer is a 2013 homebrew GB "sample masher" by nitro2k01 — a GUI-less loop
processor on the wave channel that applies live effects (stutter, granular/repeater)
and canned slice rearrangements to a short loop, while emitting an LSDj-compatible
sync signal on the link port. Original blog post:
`blog.gg8.se/wordpress/2013/02/11/gameboy-project-week-6-can-i-have-an-a-men/`

## Facts established this session (verified against the ROM, not memory)

**File analysed:** `amenizer.gb`
- Size: 32768 bytes (32 KB), ROM-only, single bank, no MBC.
- Header title: `AMENIZER`, Rev.00.
- **MD5: `fd6c84c0faf9c8b5ebd84b0351af9619`** — this identifies the *silent/empty*
  build. The user has separately used an Amen-preloaded build with a (presumed)
  different hash — NOT yet analysed. Do not assume the two are byte-identical
  anywhere except by verification.

**Sample buffer:** region `0x0407`–`0x3EFF` is **all zeros** in this build.
There is no PCM sample data anywhere in the ROM. So this file ships silent; the
Amen is not baked in. (Matches the blog's never-delivered "replace the sample with
your own sounds will follow shortly.")
- Sample format is expected to be **4-bit nibble PCM** (GB wave channel is 4-bit).
  This is inferred from the hardware + the wave-buffer reload playback technique
  nitro2k01 describes; it was NOT confirmed by tracing the playback pointer math.
  **Confirm before writing any encoder.**

**Slice rearrangement tables:** 16 contiguous 16-byte tables at **`0x3F00`–`0x3FFF`**.
- Each table maps playback step (0–15) → slice index (0–15).
- Index math (confirmed by disassembly at ~`0x03A0`–`0x03B8`):
  `effective_index = (table_select << 4) | step`, then
  `A = [0x3F00 + effective_index]` via `ld d,$3f; ld a,[de]`.
- `table_select` lives in RAM at `$c0cc`.

**D-pad → table mapping** (confirmed at `Call_000_0285`, ~`0x0285`–`0x02D5`):
- Joypad byte assembled as `[Start Select B A | Down Up Left Right]` (1=pressed).
- `table_select = held_buttons & 0x0F` = the **raw D-pad bitmask**
  (bit3=Down, bit2=Up, bit1=Left, bit0=Right).
- Holding **Start** forces identity (disables remap).
- Hence 16 tables = one per direction-bit combination. Only 6 are non-identity;
  the rest (all Down+Up combos + three-way presses) are identity placeholders.

Non-identity tables in THIS build:
| idx | D-pad          | table (step0..15, hex slice) |
|-----|----------------|------------------------------|
| 1   | Right          | 0 1 2 3 4 5 3 4 5 9 a b c d e f |
| 2   | Left           | 0 1 0 1 4 5 6 7 8 c d e c d e f |
| 3   | Left+Right     | 0 1 2 3 4 5 6 7 8 9 a 8 9 a 8 9 |
| 4   | Up             | 0 1 0 0 4 5 4 4 8 9 9 9 c d c c |
| 5   | Up+Right       | 0 1 2 3 4 5 6 7 8 9 a b c a b c |
| 6   | Up+Left        | 0 1 0 1 4 5 6 7 8 9 a b c a b c |
| 8   | Down           | a b a b a b a b a b a b a b a b |

These are nitro2k01's hand-chosen remaps. They are NOT known/named Amen chops —
no such canonical catalogue exists; Amen reuse is ad-hoc per track. The specific
slice choices (e.g. Right swaps 6-7-8→3-4-5; Down collapses to a-b) appear
Amen-fitted, but the remap *mechanism* is content-agnostic and works on any
dense, evenly-spaced breakbeat.

## Open questions to resolve before/while building

1. **Sample encoding, definitively.** Trace the playback routine past the table
   read to the wave-buffer reload. Confirm: 4-bit nibble packing, byte order
   (which nibble is first sample), sample rate / playback clock, total sample
   length the engine expects, and where slice boundaries fall (the 16 slices must
   map to fixed offsets in the buffer — find that arithmetic).
2. **Buffer bounds.** Is the whole `0x0407`–`0x3EFF` the sample region, or is part
   of it code/data? Verify the start/end the engine actually reads. (0x0407 was
   just where the zero-run began; the true buffer start may differ.)
3. **Loop length constraint.** A commenter asked about max loop size / required
   sample rate and got no answer. Derive it from the engine (buffer size ÷ bytes
   per sample), don't guess.
4. **Get the preloaded build.** Ask the user to upload their Amen-loaded ROM.
   Extracting its sample = ground-truth for the encoding, and re-reading its
   `0x3F00` tables tells us whether builds differ (which would change the
   "what patterns" answer). This is the single highest-value next input.

## How to work (environment notes for future me)

- **Disassembler:** `mgbdis` (`github.com/mattcurrie/mattdis` → actually
  `github.com/mattcurrie/mgbdis`). Clone, then
  `python3 mgbdis/mgbdis.py amenizer.gb --output-dir disasm`.
  It over-classifies data as code on this ROM; for data tables, raw byte analysis
  (Python `open(...,'rb').read()`) is faster than reading the `.asm`.
- **No `xxd`** in this environment — use `od -A x -t x1z -v` or Python.
- **Network allowlist** does NOT include `blog.gg8.se` or `dlhb.gamebrew.org`,
  so ROMs can't be fetched server-side — the user must upload them. GitHub, npm,
  and pypi ARE reachable.
- Re-verify the MD5 of any ROM handed to you before assuming these offsets apply.

## Build approach (proposed, for the JS tool)

Pure client-side; no server needed. Rough shape:
1. **Load** `.gb` as `ArrayBuffer` (`<input type=file>` → `FileReader` /
   `arrayBuffer()`). Sanity-check size (32768) and header title `AMENIZER`.
2. **Ingest user audio** (WAV via `AudioContext.decodeAudioData`, or raw). Resample
   to the engine's rate, mono, trim/pad to the required loop length.
3. **Encode** to the GB wave format (4-bit nibbles per confirmed spec), respecting
   slice-boundary alignment so the 16 slices land correctly.
4. **Patch** the sample region of the ArrayBuffer at the verified buffer offset.
   (Optional stretch: also let the user edit the 6+ rearrangement tables at
   `0x3F00`.)
5. **Fix-ups:** GB header checksums — recompute the header checksum byte at
   `0x014D` and the global ROM checksum at `0x014E`–`0x014F`. Emulators mostly
   ignore these but real hardware / strict flashers may not; do it properly.
   (Algorithm: header checksum = running `x = x - byte - 1` over `0x0134`–`0x014C`;
   global checksum = 16-bit sum of all bytes except the two checksum bytes
   themselves. Verify against pandocs.)
6. **Output** a downloadable patched `.gb` (`Blob` → object URL).
7. **Preview (stretch):** run in a WASM GB emulator (e.g. a compiled core) in-page
   so the user can audition without leaving the browser.

Keep the patcher and the audio encoder as separate, individually-testable modules.
Test the encoder round-trip (encode a known WAV, decode it back) before trusting it
against the ROM.

## Correction log (things I got wrong this session — don't repeat)

- Initially claimed there was "no public record" of Amenizer WITHOUT searching.
  Wrong and avoidable. Search/verify first.
- Initially argued the D-pad likely did live scrubbing rather than discrete canned
  orders. User (who has used it) said canned orders; disassembly confirmed the user.
  Weight hands-on user testimony accordingly.
