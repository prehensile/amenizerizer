/** Central app state. Svelte 5 runes, so plain modules can read it too. */

import {
  TMA_DEFAULT,
  bpmForTma,
  checkRom,
  decodeSample,
  loopSecondsForTma,
  readTables,
  sampleRateForTma,
  type RomCheck,
} from './gb/amenizer';
import { md5Hex, readTitle } from './gb/rom';
import { buildPatchedRom, diffRanges } from './gb/patch';
import { encodeSample, type EncodeResult, type FitMode } from './audio/encode';
import type { Dither } from './audio/quantize';
import type { LoadedAudio } from './audio/load';

class AppState {
  // --- ROM ---------------------------------------------------------------
  rom = $state<Uint8Array | null>(null);
  romName = $state('');
  romMd5 = $state('');
  romTitle = $state('');
  romCheck = $state<RomCheck | null>(null);
  tables = $state<number[][]>([]);

  // --- Source audio ------------------------------------------------------
  source = $state<LoadedAudio | null>(null);
  regionStart = $state(0);
  regionEnd = $state(0);

  // --- Encode settings ---------------------------------------------------
  fitMode = $state<FitMode>('fit');
  tma = $state(TMA_DEFAULT);
  patchRate = $state(false);
  autoNormalize = $state(true);
  normalizeTarget = $state(0.98);
  gainDb = $state(0);
  highPassHz = $state(0);
  drive = $state(1);
  fadeMs = $state(2);
  removeDcOffset = $state(true);
  dither = $state<Dither>('triangular');

  // --- Derived encode output (recomputed by an effect in App) ------------
  encoded = $state<EncodeResult | null>(null);
  encoding = $state(false);

  loaded = $derived(this.rom !== null);
  sampleRate = $derived(sampleRateForTma(this.effectiveTma));
  loopSeconds = $derived(loopSecondsForTma(this.effectiveTma));
  bpm = $derived(bpmForTma(this.effectiveTma));

  /** Only patch the rate if the user asked; otherwise honour the ROM's own TMA. */
  get effectiveTma(): number {
    if (this.patchRate) return this.tma;
    return this.rom ? this.rom[0x016a] : TMA_DEFAULT;
  }

  /**
   * The ROM as it will be downloaded.
   *
   * Derived rather than a getter so it is computed once per change instead of
   * once per read: every read copies 32 KB and rechecksums the whole image,
   * and live playback now reads it from several effects.
   */
  patched: Uint8Array | null = $derived.by(() => {
    if (!this.rom) return null;
    return buildPatchedRom(this.rom, {
      packed: this.encoded?.packed ?? null,
      tables: this.tables.length ? this.tables : null,
      tma: this.patchRate ? this.tma : null,
    });
  });

  changedBytes: number = $derived.by(() => {
    const p = this.patched;
    if (!this.rom || !p) return 0;
    return diffRanges(this.rom, p).reduce((n, r) => n + (r.end - r.start), 0);
  });

  /** What the stock ROM currently holds, for A/B against a new encode. */
  get romSample(): Float32Array | null {
    return this.rom ? decodeSample(this.rom) : null;
  }

  loadRom(bytes: Uint8Array, name: string): void {
    const title = readTitle(bytes);
    this.rom = bytes;
    this.romName = name;
    this.romTitle = title;
    this.romMd5 = md5Hex(bytes);
    this.romCheck = checkRom(bytes, title);
    this.tables = readTables(bytes);
    this.tma = bytes[0x016a] ?? TMA_DEFAULT;
  }

  loadSource(audio: LoadedAudio): void {
    this.source = audio;
    this.regionStart = 0;
    this.regionEnd = audio.samples.length;
  }

  resetTables(): void {
    if (this.rom) this.tables = readTables(this.rom);
  }

  /** Recompute the encode. Called from a debounced effect. */
  runEncode(): void {
    if (!this.source) {
      this.encoded = null;
      return;
    }
    this.encoding = true;
    try {
      this.encoded = encodeSample(this.source.samples, this.source.rate, {
        startSample: this.regionStart,
        endSample: this.regionEnd,
        fitMode: this.fitMode,
        tma: this.effectiveTma,
        removeDcOffset: this.removeDcOffset,
        highPassHz: this.highPassHz,
        gainDb: this.autoNormalize ? null : this.gainDb,
        normalizeTarget: this.normalizeTarget,
        drive: this.drive,
        fadeMs: this.fadeMs,
        dither: this.dither,
      });
    } finally {
      this.encoding = false;
    }
  }
}

export const app = new AppState();
