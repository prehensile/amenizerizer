/**
 * The encode pipeline: arbitrary source audio -> 16 KiB of packed 4-bit PCM
 * laid out so the engine's 16 slices land on musical sixteenth notes.
 *
 * The defaults are deliberately *opinionated* rather than neutral: at 16 levels
 * an unprocessed encode is audibly noisy, and the fix is mostly gain staging,
 * not dither. So the chain defaults to an 80 Hz high-pass (sub energy only eats
 * headroom), 2x soft clip (the single biggest win — the noise floor is fixed, so
 * loudness *is* SNR) and 0.35 LSB of dither. Pass `highPassHz: 0, drive: 1` for
 * a neutral chain. `state.svelte.ts` mirrors these; keep the two in step.
 */

import {
  SAMPLE_BYTES,
  SLICE_SAMPLES,
  TOTAL_SAMPLES,
  sampleRateForTma,
} from '../gb/amenizer';
import { resample } from './resample';
import { nibblesToFloat, packNibbles, quantizeToNibbles, type Dither } from './quantize';
import {
  applyGain,
  clamp,
  fadeEdges,
  highPass,
  normalize,
  peak,
  removeDC,
  rms,
  softClip,
} from './process';

/**
 * `fit` — squeeze the selection into exactly one bar, whatever that costs in
 * pitch. This is what you want for a loop: slices land on sixteenths by
 * construction.
 *
 * `rate` — resample at the true ratio so pitch is preserved, then pad with
 * silence or truncate. Use when the source is a one-shot, not a loop.
 */
export type FitMode = 'fit' | 'rate';

export interface EncodeOptions {
  /** Selection within the source, in source samples. Defaults to the whole file. */
  startSample?: number;
  endSample?: number;
  fitMode?: FitMode;
  /** TMA the ROM will be patched with; sets the playback rate. */
  tma: number;
  removeDcOffset?: boolean;
  highPassHz?: number;
  /** null normalises to `normalizeTarget`; a number is a literal dB trim. */
  gainDb?: number | null;
  normalizeTarget?: number;
  /** >1 engages the soft clipper. */
  drive?: number;
  fadeMs?: number;
  dither?: Dither;
  /** Dither amplitude in LSBs. See {@link quantizeToNibbles}. */
  ditherAmount?: number;
  ditherSeed?: number;
}

export interface EncodeResult {
  /** 16384 bytes, ready to drop at ROM 0x4000. */
  packed: Uint8Array;
  /** Exactly what the hardware will reconstruct, for preview and export. */
  quantized: Float32Array;
  /** Pre-quantisation signal, for comparing waveforms. */
  preQuantize: Float32Array;
  sampleRate: number;
  stats: {
    peak: number;
    rms: number;
    clippedSamples: number;
    /** Quantisation error as dB relative to full scale. */
    noiseFloorDb: number;
    slicePeaks: number[];
  };
}

export function encodeSample(
  source: Float32Array,
  sourceRate: number,
  options: EncodeOptions,
): EncodeResult {
  const {
    startSample = 0,
    endSample = source.length,
    fitMode = 'fit',
    tma,
    removeDcOffset = true,
    highPassHz = 80,
    gainDb = null,
    normalizeTarget = 0.98,
    drive = 2,
    fadeMs = 2,
    dither = 'triangular',
    ditherAmount = 0.35,
    ditherSeed = 0x1234,
  } = options;

  const rate = sampleRateForTma(tma);

  const from = Math.max(0, Math.min(source.length, Math.floor(startSample)));
  const to = Math.max(from, Math.min(source.length, Math.floor(endSample)));
  let region = source.subarray(from, to);

  // How many output samples the selection is worth.
  let targetLen: number;
  if (fitMode === 'fit') {
    targetLen = TOTAL_SAMPLES;
  } else {
    const natural = Math.round((region.length * rate) / sourceRate);
    if (natural > TOTAL_SAMPLES) {
      // Keeping pitch means dropping the overflow, not squeezing it in — so
      // shorten the source to what the buffer holds and resample 1:1 in rate.
      region = region.subarray(0, Math.floor((TOTAL_SAMPLES * sourceRate) / rate));
      targetLen = TOTAL_SAMPLES;
    } else {
      targetLen = Math.max(1, natural);
    }
  }

  let buf = region.length > 0 ? resample(region, targetLen) : new Float32Array(targetLen);

  // Pad with silence when the source is shorter than the buffer.
  if (buf.length < TOTAL_SAMPLES) {
    const padded = new Float32Array(TOTAL_SAMPLES);
    padded.set(buf);
    buf = padded;
  }

  if (removeDcOffset) buf = removeDC(buf);
  if (highPassHz > 0) buf = highPass(buf, highPassHz, rate);
  buf = gainDb === null ? normalize(buf, normalizeTarget) : applyGain(buf, 10 ** (gainDb / 20));
  if (drive > 1) buf = softClip(buf, drive);
  if (fadeMs > 0) buf = fadeEdges(buf, Math.round((fadeMs / 1000) * rate));

  const preClip = buf;
  buf = clamp(buf);
  let clippedSamples = 0;
  for (let i = 0; i < preClip.length; i++) {
    if (Math.abs(preClip[i]) > 0.999) clippedSamples++;
  }

  const nibbles = quantizeToNibbles(buf, { dither, seed: ditherSeed, amount: ditherAmount });
  const packed = packNibbles(nibbles);
  const quantized = nibblesToFloat(nibbles);

  if (packed.length !== SAMPLE_BYTES) {
    throw new Error(`Encoder produced ${packed.length} bytes, expected ${SAMPLE_BYTES}.`);
  }

  let errSq = 0;
  for (let i = 0; i < quantized.length; i++) {
    const d = quantized[i] - buf[i];
    errSq += d * d;
  }
  const errRms = Math.sqrt(errSq / quantized.length);

  const slicePeaks: number[] = [];
  for (let s = 0; s < TOTAL_SAMPLES / SLICE_SAMPLES; s++) {
    slicePeaks.push(peak(quantized.subarray(s * SLICE_SAMPLES, (s + 1) * SLICE_SAMPLES)));
  }

  return {
    packed,
    quantized,
    preQuantize: buf,
    sampleRate: rate,
    stats: {
      peak: peak(buf),
      rms: rms(buf),
      clippedSamples,
      noiseFloorDb: errRms > 0 ? 20 * Math.log10(errRms) : -Infinity,
      slicePeaks,
    },
  };
}
