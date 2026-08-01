/**
 * A faithful re-implementation of the Amenizer playback routine.
 *
 * The notes proposed a WASM Game Boy core for auditioning. That is a lot of
 * dependency for very little: the whole engine is the 200-byte routine copied
 * to $C000, and reproducing it directly gives an exact preview that renders
 * instantly and lets us expose each D-pad mode as a UI control.
 *
 * Per timer interrupt ("frame") the routine:
 *   1. copies 16 bytes from the pointer into wave RAM  -> 32 output samples
 *   2. writes the advanced pointer back over its own `ld hl,nn` operand,
 *      ANDing the high byte with the mask at $C056
 *   3. adds 4 to the counter at $C0C8; on wrap to zero it steps the sequencer,
 *      looks up a slice and reloads the pointer to 0x4000 + slice*0x400
 *   4. derives NR50 from the counter/step and writes it
 *
 * Reproducing that order matters — the copy uses the *previous* frame's
 * pointer, which is why the very first frame plays 32 samples from 0x4000
 * before the sequencer takes over.
 */

import {
  FRAME_BYTES,
  FRAME_SAMPLES,
  SAMPLE_BASE,
  SLICE_BYTES,
  nibbleToFloat,
  sampleRateForTma,
} from '../gb/amenizer';

export interface SimulateOptions {
  /** Table index = the raw D-pad bitmask (bit3 Down, bit2 Up, bit1 Left, bit0 Right). */
  tableSelect?: number;
  tma?: number;
  /** How many 16-step bars to render. */
  bars?: number;
  /**
   * Decay envelope (the A-button mode). 0..4 selects how many `add hl,hl`
   * doublings run, i.e. how fast the ramp repeats; null leaves NR50 at $77.
   */
  envelope?: number | null;
  /**
   * Repeater (the B-button mode), i.e. the depth held in $C0CD.
   *
   * The routine builds its mask with `ld a,$01` then `b - 1` doublings and a
   * `cpl`, so depth d clears bit d-1 of the pointer's high byte and playback
   * folds back every 256 << (d-1) bytes. $C0CD is clamped to 1..3, so the
   * usable range is 256, 512 or 1024 bytes. null leaves the mask at $FF.
   */
  repeat?: number | null;
}

export interface SimulateResult {
  samples: Float32Array;
  sampleRate: number;
  /** Slice index in effect for each 16-step position, in order of playback. */
  sliceOrder: number[];
}

export function simulate(
  rom: Uint8Array,
  tables: number[][],
  options: SimulateOptions = {},
): SimulateResult {
  const {
    tableSelect = 0,
    tma = rom[0x016a],
    bars = 1,
    envelope = null,
    repeat = null,
  } = options;

  const table = tables[tableSelect & 0x0f];
  // $C056 is the operand of `and $7f`; VBlank rewrites it to $FF unless B is held.
  const ptrMask = repeat === null ? 0xff : (~(1 << (repeat - 1))) & 0xff;

  // Boot state: $C0C8 = $FC, $C0C9 = $0F, and the `ld hl,nn` operand is $4000.
  let ptr = SAMPLE_BASE;
  let counter = 0xfc;
  let step = 0x0f;

  const framesPerBar = (SLICE_BYTES / FRAME_BYTES) * 16;
  const totalFrames = framesPerBar * bars + 1; // +1 for the pre-roll frame
  const out = new Float32Array(totalFrames * FRAME_SAMPLES);
  const sliceOrder: number[] = [];

  let w = 0;
  for (let f = 0; f < totalFrames; f++) {
    // 1. Sixteen bytes into wave RAM, high nibble of each byte plays first.
    const gain = nr50Gain(step, counter, envelope);
    for (let i = 0; i < FRAME_BYTES; i++) {
      const b = rom[(ptr + i) & 0xffff];
      out[w++] = nibbleToFloat(b >> 4) * gain;
      out[w++] = nibbleToFloat(b & 0x0f) * gain;
    }

    // 2. Advance and write back, masking the high byte.
    ptr = ptr + FRAME_BYTES;
    ptr = ((((ptr >> 8) & ptrMask) << 8) | (ptr & 0xff)) & 0xffff;

    // 3. Sequencer tick.
    counter = (counter + 4) & 0xff;
    if (counter === 0) {
      step = (step + 1) & 0x0f;
      const slice = table[step] & 0x0f;
      // The final frame of the render also arms the *next* bar; that reload is
      // real but its slice is never heard, so keep it out of the reported order.
      if (sliceOrder.length < 16 * bars) sliceOrder.push(slice);
      ptr = SAMPLE_BASE + slice * SLICE_BYTES;
    }
  }

  return { samples: out.subarray(0, w), sampleRate: sampleRateForTma(tma), sliceOrder };
}

/**
 * NR50 -> linear gain.
 *
 * Default is $77 (volume 7 both sides). With the envelope engaged the routine
 * builds HL = (step << 8) | counter, doubles it `4 - shift` times, then takes
 * `(~H) & 7` — a descending ramp whose repeat rate depends on the shift.
 * Hardware maps master volume v to (v + 1) / 8.
 */
function nr50Gain(step: number, counter: number, envelope: number | null): number {
  if (envelope === null) return 1;
  const shifts = 4 - Math.max(0, Math.min(4, envelope));
  let hl = ((step << 8) | counter) & 0xffff;
  for (let i = 0; i < shifts; i++) hl = (hl << 1) & 0xffff;
  const v = ~(hl >> 8) & 0x07;
  return (v + 1) / 8;
}
