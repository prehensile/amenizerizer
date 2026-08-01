import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { simulate } from './simulate';
import { readTables } from '../gb/amenizer';
import { buildPatchedRom } from '../gb/patch';

const rom = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../../resources/amenizer.gb', import.meta.url))),
);
const tables = readTables(rom);

describe('engine simulation', () => {
  it('walks the identity table in order', () => {
    const { sliceOrder } = simulate(rom, tables, { tableSelect: 0, bars: 1 });
    expect(sliceOrder).toEqual([...Array(16).keys()]);
  });

  it('follows the Right table exactly as stored', () => {
    const { sliceOrder } = simulate(rom, tables, { tableSelect: 1, bars: 1 });
    expect(sliceOrder).toEqual(tables[1]);
  });

  it('renders one bar of the right length', () => {
    const { samples, sampleRate } = simulate(rom, tables, { bars: 1 });
    // 16 slices x 2048 samples, plus the 32-sample pre-roll frame.
    expect(samples.length).toBe(16 * 2048 + 32);
    expect(sampleRate).toBeCloseTo(25266.892, 3);
  });

  it('plays each slice from its own 1 KiB block', () => {
    // Under the identity table, the audio after the pre-roll must equal the
    // raw buffer. This is the check that the pointer maths is right.
    const { samples } = simulate(rom, tables, { tableSelect: 0, bars: 1 });
    const body = samples.subarray(32);
    for (const probe of [0, 1, 2047, 2048, 20000, 32767]) {
      const byte = rom[0x4000 + (probe >> 1)];
      const nib = probe % 2 === 0 ? byte >> 4 : byte & 0x0f;
      expect(body[probe]).toBeCloseTo((nib - 7.5) / 8, 6);
    }
  });

  it('is unity gain with the envelope off and attenuating with it on', () => {
    const plain = simulate(rom, tables, { envelope: null, bars: 1 });
    const decayed = simulate(rom, tables, { envelope: 0, bars: 1 });
    let sumPlain = 0;
    let sumDecayed = 0;
    for (let i = 0; i < plain.samples.length; i++) {
      sumPlain += Math.abs(plain.samples[i]);
      sumDecayed += Math.abs(decayed.samples[i]);
    }
    expect(sumDecayed).toBeLessThan(sumPlain);
    expect(sumDecayed).toBeGreaterThan(0);
  });

  it('folds playback back on itself every 512 << (depth-1) samples', () => {
    // Depth d clears bit d-1 of the pointer's high byte, so the read address
    // cycles every 256 << (d-1) bytes. At depths 1 and 2 that cycle fits
    // inside one 2048-sample slice, so the slice becomes exactly periodic.
    for (const depth of [1, 2]) {
      const body = simulate(rom, tables, { repeat: depth, bars: 1 }).samples.subarray(32);
      const period = 512 << (depth - 1);
      const slice = body.subarray(2048, 4096);
      for (let i = 0; i < slice.length - period; i++) {
        expect(slice[i]).toBe(slice[i + period]);
      }
    }
  });

  it('drags playback across slices at depth 3', () => {
    // The mask hits the absolute high byte, not an offset within the slice.
    // Slice 1 sits at $4400, so clearing bit 2 sends the pointer to $40xx —
    // the repeater starts pulling in *other* slices rather than looping one.
    const plain = simulate(rom, tables, { repeat: null, bars: 1 }).samples;
    const folded = simulate(rom, tables, { repeat: 3, bars: 1 }).samples;
    let differing = 0;
    for (let i = 0; i < plain.length; i++) if (plain[i] !== folded[i]) differing++;
    expect(differing).toBeGreaterThan(plain.length / 4);
  });

  it('reflects a freshly patched sample', () => {
    const packed = new Uint8Array(0x4000);
    for (let i = 0; i < packed.length; i++) packed[i] = 0xf0;
    const patched = buildPatchedRom(rom, { packed });
    const { samples } = simulate(patched, tables, { bars: 1 });
    const body = samples.subarray(32);
    expect(body[0]).toBeCloseTo((15 - 7.5) / 8, 6);
    expect(body[1]).toBeCloseTo((0 - 7.5) / 8, 6);
  });
});
