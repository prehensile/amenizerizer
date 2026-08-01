/** Assemble a patched ROM from a base image plus whatever the user changed. */

import { fixChecksums } from './rom';
import {
  TMA_INIT_OFFSET,
  TMA_MAX,
  TMA_MIN,
  writeSample,
  writeTables,
} from './amenizer';

export interface PatchOptions {
  /** 16384 bytes for 0x4000..0x7FFF. Omit to keep the existing sample. */
  packed?: Uint8Array | null;
  /** 16x16 slice tables for 0x3F00. Omit to keep the existing ones. */
  tables?: number[][] | null;
  /** New boot TMA, which sets the playback rate. Omit to keep the existing one. */
  tma?: number | null;
}

export function buildPatchedRom(base: Uint8Array, options: PatchOptions = {}): Uint8Array {
  const rom = base.slice();
  const { packed = null, tables = null, tma = null } = options;

  if (packed) writeSample(rom, packed);
  if (tables) writeTables(rom, tables);
  if (tma !== null) {
    if (tma < TMA_MIN || tma > TMA_MAX) {
      throw new Error(`TMA must be ${TMA_MIN}..${TMA_MAX}, got ${tma}.`);
    }
    rom[TMA_INIT_OFFSET] = tma;
  }

  fixChecksums(rom);
  return rom;
}

/** Byte ranges that differ, for the "what changed" readout. */
export function diffRanges(a: Uint8Array, b: Uint8Array): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i <= len; i++) {
    const differs = i < len && a[i] !== b[i];
    if (differs && start < 0) start = i;
    else if (!differs && start >= 0) {
      ranges.push({ start, end: i });
      start = -1;
    }
  }
  return ranges;
}
