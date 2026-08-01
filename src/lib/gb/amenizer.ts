/**
 * Amenizer ROM map and engine constants.
 *
 * Everything here was read out of the ROM this repo ships
 * (md5 fd6c84c0faf9c8b5ebd84b0351af9619), not from documentation.
 * The playback engine lives at ROM 0x033F..0x0406 and is copied to WRAM $C000
 * at boot; the timer ISR just does `jp $c000`. Reading the rebased listing is
 * what pins down the numbers below.
 *
 *   $c000  ld hl,$4000          <- sample buffer base (self-modified operand)
 *   $c00c  16x { ld a,[hl+] ; ld [c],a ; inc c }   <- 16 bytes -> wave RAM
 *   $c041  ldh a,[$ff06]        <- NR33 is loaded FROM TMA...
 *   $c046  ld a,$87 ; ldh [$ff1e],a   <- ...with NR34 freq-hi = 7
 *   $c058  ld hl,$c0c8 ; add $04     <- frame counter, wraps every 64 frames
 *   $c079  ld a,[de] (d=$3f)    <- slice table lookup
 *   $c07a  add a ; add a ; or $40    <- pointer hi = 0x40 | slice*4
 */

// ---------------------------------------------------------------------------
// ROM layout
// ---------------------------------------------------------------------------

export const ROM_SIZE = 32768;

/** Slice-rearrangement tables: 16 tables x 16 steps. */
export const TABLES_BASE = 0x3f00;
export const TABLE_COUNT = 16;
export const TABLE_STEPS = 16;

/** PCM buffer: the whole upper 16 KiB. `ld hl,$4000` .. wraps at $8000. */
export const SAMPLE_BASE = 0x4000;
export const SAMPLE_BYTES = 0x4000;

/** 16 slices of 1024 bytes; `or $40` after two `add a` gives 0x4000 + n*0x400. */
export const SLICE_COUNT = 16;
export const SLICE_BYTES = SAMPLE_BYTES / SLICE_COUNT; // 1024
export const SLICE_SAMPLES = SLICE_BYTES * 2; // 2048 nibbles
export const TOTAL_SAMPLES = SAMPLE_BYTES * 2; // 32768

/** Bytes pushed into wave RAM per timer interrupt (FF30..FF3F). */
export const FRAME_BYTES = 16;
export const FRAME_SAMPLES = FRAME_BYTES * 2; // 32
export const FRAMES_PER_SLICE = SLICE_BYTES / FRAME_BYTES; // 64

/** Operand of `ld a,$ad` feeding TMA at boot — the master rate control. */
export const TMA_INIT_OFFSET = 0x016a;
export const TMA_DEFAULT = 0xad;

/** The engine clamps TMA to 1..0xE1 at runtime (`cp $e2` / `dec a; jr z`). */
export const TMA_MIN = 1;
export const TMA_MAX = 0xe1;

const CPU_HZ = 4194304;

/**
 * Sample rate for a given TMA.
 *
 * The wave channel steps at 2097152/(2048-freq) Hz. The engine writes
 * NR33 = TMA and NR34 = $87, so freq = 0x700 | TMA and 2048-freq = 256-TMA.
 * The timer (TAC=$06 -> 65536 Hz) overflows every 256-TMA ticks, i.e. once
 * per 32 wave samples. Both sides use the same divisor, which is the trick
 * that keeps the reload locked to the waveform.
 */
export function sampleRateForTma(tma: number): number {
  return (CPU_HZ / 2) / (256 - tma);
}

export const DEFAULT_SAMPLE_RATE = sampleRateForTma(TMA_DEFAULT); // 25266.892 Hz

/** Loop length in seconds for a given TMA. */
export function loopSecondsForTma(tma: number): number {
  return TOTAL_SAMPLES / sampleRateForTma(tma);
}

/** The loop is 16 slices = 16 sixteenth notes = one bar. */
export function bpmForTma(tma: number): number {
  return 240 / loopSecondsForTma(tma);
}

/** Nearest TMA whose one-bar loop matches `bpm`, and what you actually get. */
export function tmaForBpm(bpm: number): { tma: number; actualBpm: number } {
  const wanted = 256 - (CPU_HZ / 2) / ((TOTAL_SAMPLES / 240) * bpm);
  const tma = Math.min(TMA_MAX, Math.max(TMA_MIN, Math.round(wanted)));
  return { tma, actualBpm: bpmForTma(tma) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RomCheck {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

export function checkRom(rom: Uint8Array, title: string): RomCheck {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (rom.length !== ROM_SIZE) {
    problems.push(`Expected a ${ROM_SIZE}-byte ROM, got ${rom.length} bytes.`);
  }
  if (title !== 'AMENIZER') {
    problems.push(`Header title is "${title}", expected "AMENIZER".`);
  }
  if (rom.length >= ROM_SIZE) {
    // `ld hl,$4000` at the top of the routine that gets copied to $c000.
    const sig = [0x21, 0x00, 0x40, 0x0e, 0x30];
    const at = 0x033f;
    if (!sig.every((b, i) => rom[at + i] === b)) {
      problems.push(
        'Playback engine signature missing at 0x033F — this build addresses ' +
          'its sample buffer differently, so the offsets here do not apply.',
      );
    }
    if (rom[TMA_INIT_OFFSET - 1] !== 0x3e || rom[TMA_INIT_OFFSET + 1] !== 0xe0) {
      warnings.push('TMA init instruction not where expected; rate patching disabled.');
    }
  }
  return { ok: problems.length === 0, problems, warnings };
}

// ---------------------------------------------------------------------------
// Sample buffer access
// ---------------------------------------------------------------------------

/** Byte offset of slice `n` in the ROM. */
export function sliceOffset(n: number): number {
  return SAMPLE_BASE + n * SLICE_BYTES;
}

/**
 * Unpack the ROM's 4-bit PCM into signed floats in [-1, 1).
 *
 * Wave RAM plays the HIGH nibble of each byte first (Pandocs), so sample
 * 2k comes from the upper nibble and 2k+1 from the lower.
 */
export function decodeSample(rom: Uint8Array): Float32Array {
  const out = new Float32Array(TOTAL_SAMPLES);
  for (let i = 0; i < SAMPLE_BYTES; i++) {
    const b = rom[SAMPLE_BASE + i];
    out[i * 2] = nibbleToFloat(b >> 4);
    out[i * 2 + 1] = nibbleToFloat(b & 0x0f);
  }
  return out;
}

/** Write packed nibble data over the sample region. */
export function writeSample(rom: Uint8Array, packed: Uint8Array): void {
  if (packed.length !== SAMPLE_BYTES) {
    throw new Error(`Packed sample must be ${SAMPLE_BYTES} bytes, got ${packed.length}.`);
  }
  rom.set(packed, SAMPLE_BASE);
}

/** 0..15 -> [-1, 1). 7.5 is the DC midpoint of an unsigned 4-bit range. */
export function nibbleToFloat(n: number): number {
  return (n - 7.5) / 8;
}

// ---------------------------------------------------------------------------
// Slice tables
// ---------------------------------------------------------------------------

/** Read all 16 tables. Index math is `(table << 4) | step`. */
export function readTables(rom: Uint8Array): number[][] {
  const tables: number[][] = [];
  for (let t = 0; t < TABLE_COUNT; t++) {
    const row: number[] = [];
    for (let s = 0; s < TABLE_STEPS; s++) {
      row.push(rom[TABLES_BASE + (t << 4) + s] & 0x0f);
    }
    tables.push(row);
  }
  return tables;
}

export function writeTables(rom: Uint8Array, tables: number[][]): void {
  for (let t = 0; t < TABLE_COUNT; t++) {
    for (let s = 0; s < TABLE_STEPS; s++) {
      rom[TABLES_BASE + (t << 4) + s] = tables[t][s] & 0x0f;
    }
  }
}

export function isIdentityTable(row: number[]): boolean {
  return row.every((v, i) => v === i);
}

/**
 * Which held D-pad combination selects a table.
 *
 * `Call_000_0285` assembles the joypad as [Start Select B A | Down Up Left Right]
 * and stores `held & 0x0F` in $C0CC — so the table index IS the raw D-pad mask.
 * Holding Start zeroes it, forcing the identity table.
 */
export function dpadLabel(index: number): string {
  if (index === 0) return 'none / Start';
  const parts: string[] = [];
  if (index & 0b1000) parts.push('Down');
  if (index & 0b0100) parts.push('Up');
  if (index & 0b0010) parts.push('Left');
  if (index & 0b0001) parts.push('Right');
  return parts.join('+');
}
