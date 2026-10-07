# What the Amenizer ROM actually does

Everything here was read out of `resources/amenizer.gb`
(32768 bytes, md5 `fd6c84c0faf9c8b5ebd84b0351af9619`, header title `AMENIZER`,
no MBC). The constants live in [../src/lib/gb/amenizer.ts](../src/lib/gb/amenizer.ts);
this file is the reasoning behind them.

The playback engine is 200 bytes at ROM `0x033F`–`0x0406`, copied to WRAM
`$C000` at boot; the timer ISR is just `jp $c000`. Rebasing that block to
`$C000` and reading it is what pins down everything below.

| Property | Value | Evidence |
|---|---|---|
| Sample buffer | `0x4000`–`0x7FFF`, 16384 bytes | `ld hl,$4000` at `$C000` |
| Format | 4-bit unsigned PCM, 2/byte, **high nibble first** | wave RAM semantics |
| Total samples | 32768 | 16384 × 2 |
| Slices | 16 × 1024 bytes (2048 samples) | `add a` ×2, `or $40` → `0x4000 + n*0x400` |
| Reload unit | 16 bytes = 32 samples per timer IRQ | 16× `ld a,[hl+] / ld [c],a` |
| Frames per slice | 64 | counter at `$C0C8` adds 4, wraps at 256 |
| Slice tables | `0x3F00`–`0x3FFF`, 16 × 16 steps | `ld d,$3f; ld a,[de]`, index `(table << 4) \| step` |
| Sample rate | `2097152 / (256 − TMA)` Hz | see below |
| Stock rate | TMA `$AD` → **25266.892 Hz** | `ld a,$ad` at `0x0169`, operand at `0x016A` |
| Loop length | 1.2969 s = one bar at **185.06 BPM** | 32768 / 25266.892 |
| Slice length | 81.05 ms | 2048 / 25266.892 |

## The rate trick

`TAC = $06` runs the timer at 65536 Hz, so it overflows every `256 − TMA` ticks.
Each interrupt the engine writes `NR33 = TMA` and `NR34 = $87`, making the wave
frequency register `0x700 | TMA` — and the wave channel steps at
`2097152 / (2048 − freq)`, where `2048 − (0x700 | TMA) = 256 − TMA`. Both sides
share one divisor, which is what keeps the wave-RAM reload locked to the
waveform. Changing TMA retunes the sample and the reload together, which is why
the app can expose it as a single BPM control.

## Controls

Joypad is assembled at `Call_000_0285` as `[Start Select B A | Down Up Left Right]`,
1 = pressed.

- **D-pad alone** → `table_select = held & 0x0F`, stored at `$C0CC`. The table
  index *is* the d-pad bitmask (bit 3 Down, 2 Up, 1 Left, 0 Right). Start forces
  identity.
- **Select + Up/Down** → nudges TMA (pitch), clamped to `1..$E1`.
- **A + Left/Right** → decay envelope. Self-modifies the `jr` operand at `$C092`
  to skip 0–4 `add hl,hl`, changing how fast `NR50` ramps down.
- **B + Up/Down** → the repeater. Adjusts the depth in `$C0CD` (clamped 1..3),
  which self-modifies the mask at `$C056` (the operand of `and $7F`). The
  routine builds it with `ld a,$01`, `d - 1` doublings and a `cpl`, so depth `d`
  clears **bit `d-1`** of the pointer's high byte and playback folds back every
  `256 << (d-1)` bytes. This is the granular/stutter effect.

  The mask hits the *absolute* high byte, not an offset within the slice. At
  depth 3 that means slice 1 (`$4400`) gets its bit 2 cleared and jumps to
  `$40xx` — so the repeater starts dragging in *other* slices rather than
  looping the current one. Faithful, not a bug.

### Things the web app does not model

These came out of reimplementing the whole ROM ([../rom/](../rom/)), not just
the engine. They are real behaviour, but none of them reaches the patched
sample.

- **Start** (pressed with nothing else held, `0x0262`) toggles playback. Stop
  (`0x01B0`) turns the wave DAC off and drops IE to VBlank only. Resume re-runs
  the init at `0x0175`, which resets the counter to `$FC`, the step to `$0F`
  and the repeat depth to 1, but not the pointer or TMA. So after a resume the
  pre-roll frame plays from wherever the pointer was left, not from `$4000`.
- **Start + Select** (Start pressed while Select is the only other button
  held) XORs `$2F` into `$C043`, toggling it between `nop` and `cpl`. That byte
  sits between `ldh a,[rTMA]` and `ldh [rNR33],a`, so as `cpl` the wave
  channel gets `0x700 | ~TMA` and steps at `2097152 / (TMA + 1)` while the
  reload still runs at `2097152 / (256 − TMA)`. At stock TMA the wave is
  slowed to about half speed and retriggered before it finishes each frame —
  lower and grainier, same tempo.
- **Link-port sync.** Each slice writes `SB = 0, SC = $83` six times (internal
  clock, start transfer): on the slice boundary (`$C061`) and at counter values
  `$14 $28 $3C $50 $64` (`$C0A1`–`$C0B5`). Six per sixteenth is 24 per
  quarter note, MIDI clock's rate. They are not evenly spaced: the counter
  runs to 252 in steps of 4, so all six land in the first 25 of the 64 frames.
  Whether a slave device copes with that has not been tested.
- **The screen is a CPU meter.** Nothing touches LCDC; the timer ISR sets
  `BGP = $FF` on entry (`0x027E`) and `$00` on exit (`$C0B9`), so the boot
  screen turns white with black bands wherever the ISR is running.
- **D-pad edges.** After building the newly-pressed byte, `0x02C8` clears its
  d-pad bits if any direction was already held. A direction press only counts
  as a press when no other direction was down — which matters for B + Up/Down
  and A + Left/Right.
- **Decay skip clamp.** A + Left increments `$C092` only while the result is
  below 4 (`cp $04` at `0x023C`), so the boot value 4 (no doublings) cannot be
  returned to once A + Right has lowered it.
- **Zero-then-store races.** The VBlank handler re-enables interrupts at
  `0x01C2` and then writes three engine inputs in two steps: `$C0CC` gets 0
  then the d-pad (`0x02B8`, `0x02C5`), `$C056` gets `$FF` then the repeater
  mask (`0x01EC`, `0x021F`), `$C090` gets `$0E` then `$00` (`0x0222`,
  `0x022F`). A timer IRQ landing between the two writes sees the first value.
  For the table select that means one slice played from the identity table;
  it was caught in emulation at frame 1442 of the comparison run, where a
  slice-boundary IRQ fired at LY 145 and loaded slice 12 under table 8. The
  window is ~50 cycles a frame, so it is rare, but it is the original's
  behaviour and the reimplementation keeps it.
- The copy's 16th byte is `ld a,[hl+] ; nop ; nop ; ld [c],a` (`0x0378`) —
  two spare cycles inside the muted window. Init also writes `$01` to `$2000`
  (an MBC register, on a cart with no MBC) and triggers channel 1 with its DAC
  off; both are inert.

## Frame order

Boot state is `$C0C8 = $FC`, `$C0C9 = $0F`, pointer operand `$4000`. The first
frame therefore plays 32 samples from `0x4000` *before* the sequencer picks a
slice — the "pre-roll frame".

Per frame the order is: copy 16 bytes using the **previous** pointer, advance
and mask the pointer, *then* tick the sequencer. Reordering changes the output,
so both engine implementations follow it exactly.

## Corrections to the handoff brief

[../reference/amenizer-romhack-notes.md](../reference/amenizer-romhack-notes.md)
is the original project brief. It is wrong on three points, all re-verified
against the ROM before any code was written, and all now encoded as tests in
[../src/lib/gb/rom.test.ts](../src/lib/gb/rom.test.ts). Read the brief for
history, not for facts.

**1. This build is not silent.** The brief says "there is no PCM sample data
anywhere in the ROM" and calls this the "silent/empty build". Its scan stopped
at `0x3EFF`. There is a full 16 KiB breakbeat at `0x4000`–`0x7FFF` — the entire
upper half of the cartridge. Its nibble histogram is a bell curve centred on 7/8
(the 4-bit midpoint), and per-slice RMS peaks on slices 0, 4, 8 and 9 — kick and
snare on beats 1, 2-and, 3 and 3-and. There was never any need to source a
"preloaded build".

**2. `0x0407`–`0x3EFF` is not the sample buffer.** It is unused zero padding,
about 15 KiB of free space. The code ends at `0x0406`.

**3. The sample format is confirmed, not inferred.** The brief flagged 4-bit
nibble PCM as a guess to check before writing an encoder. It is correct, and the
nibble order (high first) is now pinned by test.

[../resources/amenizer-embedded-sample.wav](../resources/amenizer-embedded-sample.wav)
is the stock break extracted at its native rate — the fastest way to hear
correction #1, and a useful ear-check for any encoder change.
