import { describe, expect, it } from 'vitest';

import { encodeSample } from './encode';
import { nibblesToFloat, packNibbles, quantizeToNibbles, unpackNibbles, type Dither } from './quantize';
import { resample } from './resample';
import { SAMPLE_BYTES, TMA_DEFAULT, TOTAL_SAMPLES, sampleRateForTma } from '../gb/amenizer';
import { peak, rms } from './process';

function sine(len: number, rate: number, hz: number, amp = 1): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

describe('nibble packing', () => {
  it('puts the earlier sample in the high nibble', () => {
    // Wave RAM plays the high nibble first; getting this backwards reverses
    // every pair of samples and sounds like harsh aliasing, not obvious error.
    expect(packNibbles(new Uint8Array([0x0a, 0x0b]))).toEqual(new Uint8Array([0xab]));
  });

  it('round-trips', () => {
    const nibbles = new Uint8Array(512);
    for (let i = 0; i < nibbles.length; i++) nibbles[i] = i & 0x0f;
    expect(unpackNibbles(packNibbles(nibbles))).toEqual(nibbles);
  });

  it('rejects an odd count instead of silently dropping a sample', () => {
    expect(() => packNibbles(new Uint8Array(3))).toThrow();
  });
});

describe('quantiser', () => {
  it('maps the extremes to the full 4-bit range', () => {
    const q = quantizeToNibbles(new Float32Array([-1, 0, 0.999]), { dither: 'none' });
    expect(q[0]).toBe(0);
    expect(q[1]).toBe(8); // 7.5 rounds up
    expect(q[2]).toBe(15);
  });

  it('stays inside 0..15 under heavy dither', () => {
    const src = sine(4096, 44100, 200);
    for (const dither of ['none', 'rectangular', 'triangular', 'shaped'] as const) {
      const q = quantizeToNibbles(src, { dither, amount: 1 });
      expect(Math.min(...q)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...q)).toBeLessThanOrEqual(15);
    }
  });

  it('scales dither with `amount`', () => {
    // At 4 bits a full-LSB TPDF floor sits only ~24 dB down and reads as hiss,
    // so the level is a control, not a constant. Less dither, less noise.
    const src = sine(8192, 25267, 200, 0.5);
    const errRms = (amount: number) => {
      const back = nibblesToFloat(quantizeToNibbles(src, { dither: 'triangular', amount }));
      let s = 0;
      for (let i = 0; i < src.length; i++) s += (back[i] - src[i]) ** 2;
      return Math.sqrt(s / src.length);
    };
    expect(errRms(1)).toBeGreaterThan(errRms(0.5));
    expect(errRms(0.5)).toBeGreaterThan(errRms(0.25));
  });

  it('shapes noise away from the low end, not into it', () => {
    // Regression: the error-feedback term used to be *added*, which inverts the
    // noise transfer function into 1 + 1.5z^-1 - 0.5z^-2 — a +6 dB boost at DC.
    // That made "noise-shaped" the noisiest option in the midrange, the exact
    // opposite of the label. The sign of the `v -=` is what this guards.
    // The NTF's zero sits at DC, so probe DC rather than a filter band: with
    // 1 - 1.5z^-1 + 0.5z^-2 the coefficients sum to zero, so the error's
    // running sum telescopes and stays bounded. Flat dither random-walks it.
    const src = sine(8192, 25267, 300, 0.5);
    const maxDrift = (dither: Dither) => {
      const back = nibblesToFloat(quantizeToNibbles(src, { dither, amount: 0.5 }));
      let acc = 0;
      let worst = 0;
      for (let i = 0; i < src.length; i++) {
        acc += back[i] - src[i];
        worst = Math.max(worst, Math.abs(acc));
      }
      return worst;
    };
    expect(maxDrift('shaped')).toBeLessThan(maxDrift('triangular') / 5);
  });

  it('is deterministic for a given seed', () => {
    const src = sine(1024, 44100, 300);
    const a = quantizeToNibbles(src, { dither: 'triangular', seed: 7 });
    const b = quantizeToNibbles(src, { dither: 'triangular', seed: 7 });
    expect(a).toEqual(b);
  });

  it('keeps quantisation error within one step', () => {
    const src = sine(4096, 44100, 200, 0.9);
    const back = nibblesToFloat(quantizeToNibbles(src, { dither: 'none' }));
    for (let i = 0; i < src.length; i++) {
      expect(Math.abs(back[i] - src[i])).toBeLessThanOrEqual(1 / 16 + 1e-6);
    }
  });
});

describe('resampler', () => {
  it('hits the requested length exactly', () => {
    for (const len of [1000, 32768, 5]) {
      expect(resample(sine(44100, 44100, 100), len).length).toBe(len);
    }
  });

  it('preserves a tone through a downsample', () => {
    const rate = sampleRateForTma(TMA_DEFAULT);
    const src = sine(44100, 44100, 440, 0.8);
    const out = resample(src, Math.round((src.length * rate) / 44100));
    // Amplitude should survive; a broken windowed-sinc typically loses gain.
    expect(peak(out)).toBeGreaterThan(0.7);
    expect(peak(out)).toBeLessThan(0.9);
    expect(rms(out)).toBeCloseTo(rms(src), 1);
  });

  it('band-limits instead of aliasing when decimating', () => {
    // 11 kHz cannot survive a drop to ~25 kHz intact, but it must not fold
    // back down as a loud low tone either.
    const src = sine(44100, 44100, 18000, 1);
    const out = resample(src, Math.round(44100 * (12000 / 44100)));
    expect(peak(out)).toBeLessThan(0.3);
  });
});

describe('encode pipeline', () => {
  const rate = sampleRateForTma(TMA_DEFAULT);

  it('always produces exactly one sample buffer', () => {
    for (const srcLen of [100, 44100, 200000]) {
      const r = encodeSample(sine(srcLen, 44100, 220), 44100, { tma: TMA_DEFAULT });
      expect(r.packed.length).toBe(SAMPLE_BYTES);
      expect(r.quantized.length).toBe(TOTAL_SAMPLES);
    }
  });

  it('fits a selection to one bar regardless of its length', () => {
    const r = encodeSample(sine(88200, 44100, 220), 44100, {
      tma: TMA_DEFAULT,
      fitMode: 'fit',
    });
    expect(r.quantized.length).toBe(TOTAL_SAMPLES);
    expect(r.sampleRate).toBeCloseTo(rate, 3);
  });

  it('pads with silence in rate mode when the source is short', () => {
    const shortSrc = sine(4410, 44100, 220); // 100 ms
    const r = encodeSample(shortSrc, 44100, { tma: TMA_DEFAULT, fitMode: 'rate' });
    expect(r.quantized.length).toBe(TOTAL_SAMPLES);
    const tail = r.quantized.subarray(TOTAL_SAMPLES - 1000);
    // Silence quantises to the 7/8 midpoint, so |x| <= one step, not exactly 0.
    expect(peak(tail)).toBeLessThanOrEqual(1 / 16 + 1e-6);
  });

  // The shipped defaults deliberately high-pass and soft-clip, so gain-staging
  // assertions have to ask for a neutral chain or they measure the clipper.
  const neutral = { fadeMs: 0, dither: 'none', highPassHz: 0, drive: 1 } as const;

  it('normalises towards the requested target', () => {
    const r = encodeSample(sine(44100, 44100, 220, 0.05), 44100, {
      tma: TMA_DEFAULT,
      normalizeTarget: 0.9,
      ...neutral,
    });
    expect(r.stats.peak).toBeCloseTo(0.9, 2);
  });

  it('honours an explicit gain instead of normalising', () => {
    const r = encodeSample(sine(44100, 44100, 220, 0.5), 44100, {
      tma: TMA_DEFAULT,
      gainDb: -6,
      ...neutral,
    });
    expect(r.stats.peak).toBeCloseTo(0.25, 2);
  });

  it('defaults to the tuned chain, not a neutral one', () => {
    // 16 levels is coarse enough that an unprocessed encode is audibly noisy,
    // so the defaults trade headroom and sub for SNR. If someone "cleans these
    // up" back to neutral, the app gets quieter and hissier by default.
    const src = sine(44100, 44100, 220, 0.5);
    const implicit = encodeSample(src, 44100, { tma: TMA_DEFAULT });
    const tuned = encodeSample(src, 44100, {
      tma: TMA_DEFAULT,
      highPassHz: 80,
      drive: 2,
      dither: 'none',
    });
    const flat = encodeSample(src, 44100, { tma: TMA_DEFAULT, highPassHz: 0, drive: 1 });
    expect(implicit.packed).toEqual(tuned.packed);
    expect(implicit.packed).not.toEqual(flat.packed);
    // Dither off is a deliberate listening call, not an oversight — pin it so a
    // "always dither" cleanup shows up as a failure rather than a quiet change.
    const dithered = encodeSample(src, 44100, { tma: TMA_DEFAULT, dither: 'triangular' });
    expect(implicit.packed).not.toEqual(dithered.packed);
  });

  it('reports a noise floor consistent with 4 bits', () => {
    const r = encodeSample(sine(44100, 44100, 220), 44100, {
      tma: TMA_DEFAULT,
      dither: 'none',
      fadeMs: 0,
    });
    // One LSB is 1/16; RMS error for uniform rounding is about a third of that.
    expect(r.stats.noiseFloorDb).toBeLessThan(-25);
    expect(r.stats.noiseFloorDb).toBeGreaterThan(-45);
  });

  it('does not clip a normalised signal', () => {
    const r = encodeSample(sine(44100, 44100, 220), 44100, {
      tma: TMA_DEFAULT,
      normalizeTarget: 0.98,
      fadeMs: 0,
    });
    expect(r.stats.clippedSamples).toBe(0);
  });

  it('splits the buffer into 16 reportable slices', () => {
    const r = encodeSample(sine(44100, 44100, 220), 44100, { tma: TMA_DEFAULT });
    expect(r.stats.slicePeaks).toHaveLength(16);
  });

  it('survives an all-silent input without NaNs', () => {
    const r = encodeSample(new Float32Array(44100), 44100, { tma: TMA_DEFAULT });
    expect([...r.packed].every((b) => Number.isFinite(b))).toBe(true);
    expect(r.stats.peak).toBe(0);
  });
});
