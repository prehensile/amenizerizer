/**
 * 4-bit quantisation and nibble packing for the Game Boy wave channel.
 *
 * The channel is 4-bit unsigned (0..15) with 7.5 as the DC midpoint, and wave
 * RAM plays the HIGH nibble of each byte first. Sixteen levels is brutal, so
 * dithering is not cosmetic here — undithered material develops obvious
 * quantisation buzz on decays and reverb tails.
 */

export type Dither = 'none' | 'rectangular' | 'triangular' | 'shaped';

/** Deterministic PRNG so encodes are reproducible (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface QuantizeOptions {
  dither?: Dither;
  seed?: number;
  /**
   * Dither amplitude in LSBs. 1 is textbook TPDF — enough to fully decorrelate
   * the error, but at 4 bits one LSB of noise is only 24 dB down, which reads
   * as hiss. Below ~0.5 a little noise modulation creeps back in; that is
   * usually the better trade here. Ignored when `dither` is 'none'.
   */
  amount?: number;
}

/**
 * Float [-1, 1) -> nibbles 0..15.
 *
 * `shaped` is TPDF dither plus second-order error feedback, which puts a null
 * at DC and tilts the noise up towards Nyquist. The noise transfer function is
 * `1 - 1.5z^-1 + 0.5z^-2`: unity at DC minus 1.5 plus 0.5 = 0, and 3x (+9.5 dB)
 * at Nyquist. Total noise power goes *up* by 5.4 dB — the win is only that it
 * moves out of the midrange, so it is a trade, not a free improvement.
 */
export function quantizeToNibbles(
  samples: Float32Array,
  { dither = 'triangular', seed = 0x1234, amount = 0.5 }: QuantizeOptions = {},
): Uint8Array {
  const out = new Uint8Array(samples.length);
  const rand = rng(seed);
  const amp = dither === 'none' ? 0 : Math.max(0, amount);
  let e1 = 0;
  let e2 = 0;

  for (let i = 0; i < samples.length; i++) {
    // Map [-1, 1) onto the 0..15 grid centred on 7.5.
    const v = samples[i] * 8 + 7.5;

    // Subtract the weighted past error — the sign is what makes this a
    // high-pass. Adding it (as this once did) inverts the NTF into a +6 dB
    // *boost* at DC, which is audibly worse than no shaping at all.
    const corrected = dither === 'shaped' ? v - (1.5 * e1 - 0.5 * e2) : v;

    let w = corrected;
    if (dither === 'rectangular') w += (rand() - 0.5) * amp;
    else if (dither === 'triangular' || dither === 'shaped') w += (rand() - rand()) * amp;

    let n = Math.round(w);
    if (n < 0) n = 0;
    else if (n > 15) n = 15;

    if (dither === 'shaped') {
      e2 = e1;
      // Measured against the corrected signal *before* dither, so the dither
      // noise goes round the loop too and gets shaped with everything else.
      // Against the post-dither value it would leak through flat and put a
      // random walk back at DC, undoing the point of the null.
      // Clamped because a clipped sample produces an arbitrarily large error,
      // and at a loop gain of 1.5 that rings instead of decaying.
      e1 = Math.max(-1, Math.min(1, n - corrected));
    }
    out[i] = n;
  }
  return out;
}

/** Pack nibbles two per byte, high nibble = earlier sample. Length must be even. */
export function packNibbles(nibbles: Uint8Array): Uint8Array {
  if (nibbles.length % 2 !== 0) {
    throw new Error(`Nibble count must be even, got ${nibbles.length}.`);
  }
  const out = new Uint8Array(nibbles.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = ((nibbles[i * 2] & 0x0f) << 4) | (nibbles[i * 2 + 1] & 0x0f);
  }
  return out;
}

/** Inverse of {@link packNibbles}. */
export function unpackNibbles(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[i * 2] = bytes[i] >> 4;
    out[i * 2 + 1] = bytes[i] & 0x0f;
  }
  return out;
}

/** Nibbles 0..15 back to floats, for round-trip checks and waveform previews. */
export function nibblesToFloat(nibbles: Uint8Array): Float32Array {
  const out = new Float32Array(nibbles.length);
  for (let i = 0; i < nibbles.length; i++) out[i] = (nibbles[i] - 7.5) / 8;
  return out;
}
