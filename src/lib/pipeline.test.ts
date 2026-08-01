import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { encodeSample } from './audio/encode';
import { buildPatchedRom } from './gb/patch';
import { simulate } from './engine/simulate';
import {
  readTables,
  SLICE_SAMPLES,
  TMA_DEFAULT,
  loopSecondsForTma,
  sampleRateForTma,
} from './gb/amenizer';
import { GLOBAL_CHECKSUM, HEADER_CHECKSUM, globalChecksum, headerChecksum, readTitle } from './gb/rom';
import { encodeWav } from './audio/wav';

const rom = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../resources/amenizer.gb', import.meta.url))),
);
const tables = readTables(rom);

/** Sixteen distinct tones, one per slice, so slice identity is audible in the data. */
function slicedTestTone(rate: number, seconds: number): Float32Array {
  const len = Math.round(rate * seconds);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const slice = Math.min(15, Math.floor((i / len) * 16));
    const hz = 200 + slice * 120;
    out[i] = 0.8 * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return out;
}

/** Dominant frequency via a coarse Goertzel sweep. */
function dominantHz(samples: Float32Array, rate: number): number {
  let best = 0;
  let bestPower = -1;
  for (let hz = 100; hz <= 2200; hz += 5) {
    const w = (2 * Math.PI * hz) / rate;
    const coeff = 2 * Math.cos(w);
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < samples.length; i++) {
      s0 = samples[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    if (power > bestPower) {
      bestPower = power;
      best = hz;
    }
  }
  return best;
}

describe('end to end', () => {
  // Exactly one bar long, so 'fit' resamples without shifting pitch and the
  // slice tones come back at the frequencies we put in.
  const BAR = loopSecondsForTma(TMA_DEFAULT);
  const src = slicedTestTone(44100, BAR);

  it('carries audio from source file to patched ROM to engine output', () => {
    const encoded = encodeSample(src, 44100, { tma: TMA_DEFAULT, fitMode: 'fit', fadeMs: 0 });
    const patched = buildPatchedRom(rom, { packed: encoded.packed });

    // The patched image must still be a valid cartridge.
    expect(patched.length).toBe(32768);
    expect(readTitle(patched)).toBe('AMENIZER');
    expect(headerChecksum(patched)).toBe(patched[HEADER_CHECKSUM]);
    expect(globalChecksum(patched)).toBe(
      (patched[GLOBAL_CHECKSUM] << 8) | patched[GLOBAL_CHECKSUM + 1],
    );

    // Under the identity table each slice must come back at its own pitch.
    const { samples } = simulate(patched, tables, { tableSelect: 0, bars: 1 });
    const body = samples.subarray(32);
    for (const slice of [2, 7, 13]) {
      const chunk = body.subarray(
        slice * SLICE_SAMPLES + 256,
        (slice + 1) * SLICE_SAMPLES - 256,
      );
      const expected = 200 + slice * 120;
      expect(Math.abs(dominantHz(chunk, sampleRateForTma(TMA_DEFAULT)) - expected)).toBeLessThan(30);
    }
  });

  it('rearranges audio according to the selected table', () => {
    const encoded = encodeSample(src, 44100, { tma: TMA_DEFAULT, fitMode: 'fit', fadeMs: 0 });
    const patched = buildPatchedRom(rom, { packed: encoded.packed });
    const rate = sampleRateForTma(TMA_DEFAULT);

    // Table 8 (Down) is `a b a b ...` — every step must be slice 10 or 11.
    const { samples, sliceOrder } = simulate(patched, tables, { tableSelect: 8, bars: 1 });
    expect(new Set(sliceOrder)).toEqual(new Set([10, 11]));

    const body = samples.subarray(32);
    for (let step = 0; step < 16; step++) {
      const chunk = body.subarray(step * SLICE_SAMPLES + 256, (step + 1) * SLICE_SAMPLES - 256);
      const expected = 200 + (step % 2 === 0 ? 10 : 11) * 120;
      expect(Math.abs(dominantHz(chunk, rate) - expected)).toBeLessThan(30);
    }
  });

  it('changes the rate when TMA is patched, and the ROM reports it', () => {
    const fast = buildPatchedRom(rom, { tma: 0xc0 });
    expect(fast[0x016a]).toBe(0xc0);
    const { sampleRate } = simulate(fast, tables, { tma: fast[0x016a], bars: 1 });
    expect(sampleRate).toBeCloseTo(2097152 / (256 - 0xc0), 3);
    expect(sampleRate).toBeGreaterThan(sampleRateForTma(TMA_DEFAULT));
  });

  it("fit mode trades pitch for length, by exactly the selection's ratio", () => {
    // A two-bar selection squeezed into one bar must come out 2x higher.
    const twoBars = slicedTestTone(44100, BAR * 2);
    const enc = encodeSample(twoBars, 44100, { tma: TMA_DEFAULT, fitMode: 'fit', fadeMs: 0 });
    const rate = sampleRateForTma(TMA_DEFAULT);
    // Slice 0 of a two-bar tone covers source slices 0 and 1; sample its start.
    const chunk = enc.quantized.subarray(256, 1024);
    expect(Math.abs(dominantHz(chunk, rate) - 200 * 2)).toBeLessThan(40);
  });

  it('rate mode preserves pitch and truncates the overflow', () => {
    const twoBars = slicedTestTone(44100, BAR * 2);
    const enc = encodeSample(twoBars, 44100, { tma: TMA_DEFAULT, fitMode: 'rate', fadeMs: 0 });
    const rate = sampleRateForTma(TMA_DEFAULT);

    // Pitch unchanged at the start...
    expect(Math.abs(dominantHz(enc.quantized.subarray(256, 1024), rate) - 200)).toBeLessThan(30);

    // ...and the buffer stops halfway through the source, so the last slice
    // holds the tone from the source's midpoint (slice 7), not its end.
    const last = enc.quantized.subarray(15 * SLICE_SAMPLES + 256, 16 * SLICE_SAMPLES - 256);
    expect(Math.abs(dominantHz(last, rate) - (200 + 7 * 120))).toBeLessThan(40);
  });

  it('produces a WAV that plays back at the engine rate', () => {
    const { samples, sampleRate } = simulate(rom, tables, { bars: 1 });
    const wav = encodeWav(samples, sampleRate);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(25267); // rounded engine rate
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });
});
