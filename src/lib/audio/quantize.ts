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
}

/**
 * Float [-1, 1) -> nibbles 0..15.
 *
 * `shaped` uses second-order error feedback, which pushes the quantisation
 * noise up towards Nyquist where the GB's own output filtering hides it.
 */
export function quantizeToNibbles(
  samples: Float32Array,
  { dither = 'triangular', seed = 0x1234 }: QuantizeOptions = {},
): Uint8Array {
  const out = new Uint8Array(samples.length);
  const rand = rng(seed);
  let e1 = 0;
  let e2 = 0;

  for (let i = 0; i < samples.length; i++) {
    // Map [-1, 1) onto the 0..15 grid centred on 7.5.
    let v = samples[i] * 8 + 7.5;

    if (dither === 'shaped') v += 1.5 * e1 - 0.5 * e2;
    else if (dither === 'rectangular') v += rand() - 0.5;
    else if (dither === 'triangular') v += rand() - rand();

    let n = Math.round(v);
    if (n < 0) n = 0;
    else if (n > 15) n = 15;

    if (dither === 'shaped') {
      e2 = e1;
      e1 = n - v;
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
