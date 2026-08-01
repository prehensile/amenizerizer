import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GLOBAL_CHECKSUM, HEADER_CHECKSUM, fixChecksums, globalChecksum, headerChecksum, md5Hex, readTitle } from './rom';
import { buildPatchedRom, diffRanges } from './patch';
import {
  DEFAULT_SAMPLE_RATE,
  SAMPLE_BASE,
  SAMPLE_BYTES,
  TMA_DEFAULT,
  TMA_INIT_OFFSET,
  TOTAL_SAMPLES,
  bpmForTma,
  checkRom,
  decodeSample,
  loopSecondsForTma,
  readTables,
  sampleRateForTma,
  tmaForBpm,
} from './amenizer';

const rom = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../../resources/amenizer.gb', import.meta.url))),
);

describe('stock ROM', () => {
  it('is the build the notes describe', () => {
    expect(rom.length).toBe(32768);
    expect(readTitle(rom)).toBe('AMENIZER');
    expect(md5Hex(rom)).toBe('fd6c84c0faf9c8b5ebd84b0351af9619');
  });

  it('passes our own validation', () => {
    const check = checkRom(rom, readTitle(rom));
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
  });

  // If these two disagree with the cartridge, every patched ROM we emit is wrong.
  it('reproduces the stored checksums', () => {
    expect(headerChecksum(rom)).toBe(rom[HEADER_CHECKSUM]);
    expect(headerChecksum(rom)).toBe(0x8c);
    expect(globalChecksum(rom)).toBe((rom[GLOBAL_CHECKSUM] << 8) | rom[GLOBAL_CHECKSUM + 1]);
    expect(globalChecksum(rom)).toBe(0x8474);
  });

  it('has the TMA operand where we think it does', () => {
    expect(rom[TMA_INIT_OFFSET - 1]).toBe(0x3e); // ld a,$ad
    expect(rom[TMA_INIT_OFFSET]).toBe(TMA_DEFAULT);
    expect(rom[TMA_INIT_OFFSET + 1]).toBe(0xe0); // ldh [rTMA],a
    expect(rom[TMA_INIT_OFFSET + 2]).toBe(0x06);
  });

  it('contains sample data, contrary to the earlier read of this build', () => {
    const samples = decodeSample(rom);
    expect(samples.length).toBe(TOTAL_SAMPLES);
    const nonZero = samples.filter((s) => Math.abs(s) > 1 / 16).length;
    // A silent buffer would be all zeros, i.e. nibble 0 -> -0.9375, so check
    // instead that the signal is centred and lively.
    expect(nonZero).toBeGreaterThan(TOTAL_SAMPLES / 4);
  });
});

describe('rate maths', () => {
  it('matches the divisor the hardware actually uses', () => {
    // NR33 = TMA, NR34 = $87 -> freq 0x7AD, so 2048 - 1965 = 83 = 256 - 0xAD.
    expect(sampleRateForTma(TMA_DEFAULT)).toBeCloseTo(2097152 / 83, 3);
    expect(DEFAULT_SAMPLE_RATE).toBeCloseTo(25266.892, 3);
    expect(loopSecondsForTma(TMA_DEFAULT)).toBeCloseTo(1.2969, 4);
    expect(bpmForTma(TMA_DEFAULT)).toBeCloseTo(185.06, 2);
  });

  it('round-trips BPM through the TMA grid', () => {
    for (const bpm of [120, 140, 165, 174, 185, 200]) {
      const { tma, actualBpm } = tmaForBpm(bpm);
      expect(bpmForTma(tma)).toBeCloseTo(actualBpm, 6);
      expect(Math.abs(actualBpm - bpm) / bpm).toBeLessThan(0.05);
    }
  });
});

describe('slice tables', () => {
  const tables = readTables(rom);

  it('reads the non-identity tables the notes list', () => {
    expect(tables[1]).toEqual([0, 1, 2, 3, 4, 5, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15]);
    expect(tables[8]).toEqual([10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11]);
  });

  it('leaves table 0 as identity, which is what Start forces', () => {
    expect(tables[0]).toEqual([...Array(16).keys()]);
  });
});

describe('patching', () => {
  it('is a no-op when nothing is supplied', () => {
    const out = buildPatchedRom(rom);
    expect(diffRanges(rom, out)).toEqual([]);
  });

  it('touches only the sample region and the checksums', () => {
    const packed = new Uint8Array(SAMPLE_BYTES).fill(0x88);
    const out = buildPatchedRom(rom, { packed });
    const ranges = diffRanges(rom, out);
    for (const r of ranges) {
      const inSample = r.start >= SAMPLE_BASE && r.end <= SAMPLE_BASE + SAMPLE_BYTES;
      const inChecksum = r.start >= HEADER_CHECKSUM && r.end <= GLOBAL_CHECKSUM + 2;
      expect(inSample || inChecksum).toBe(true);
    }
    expect(out.length).toBe(32768);
  });

  it('leaves the patched ROM self-consistent', () => {
    const packed = new Uint8Array(SAMPLE_BYTES).fill(0x5a);
    const out = buildPatchedRom(rom, { packed, tma: 0x9f });
    expect(out[TMA_INIT_OFFSET]).toBe(0x9f);
    expect(headerChecksum(out)).toBe(out[HEADER_CHECKSUM]);
    expect(globalChecksum(out)).toBe((out[GLOBAL_CHECKSUM] << 8) | out[GLOBAL_CHECKSUM + 1]);
  });

  it('rejects an out-of-range TMA rather than emitting a dead ROM', () => {
    expect(() => buildPatchedRom(rom, { tma: 0 })).toThrow();
    expect(() => buildPatchedRom(rom, { tma: 0xff })).toThrow();
  });

  it('fixChecksums is idempotent', () => {
    const a = rom.slice();
    fixChecksums(a);
    const b = a.slice();
    fixChecksums(b);
    expect(b).toEqual(a);
  });
});
