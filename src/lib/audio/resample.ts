/**
 * Sample-rate conversion.
 *
 * Deliberately pure JS rather than OfflineAudioContext: the encoder has to be
 * testable outside a browser, and we want bit-identical output across engines.
 */

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Blackman window over t in [-1, 1]. */
function blackman(t: number): number {
  const x = (t + 1) / 2;
  return 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
}

/**
 * Windowed-sinc resample of `src` to exactly `outLen` samples.
 *
 * When decimating, the sinc cutoff drops to the output Nyquist so we band-limit
 * before dropping samples. That matters a lot here: source material is usually
 * 44.1 kHz and the target is ~25 kHz, so naive interpolation would alias badly
 * into a signal we then crush to 4 bits.
 */
export function resample(src: Float32Array, outLen: number, taps = 32): Float32Array {
  const out = new Float32Array(outLen);
  if (src.length === 0 || outLen === 0) return out;
  if (src.length === 1) return out.fill(src[0]);

  const ratio = src.length / outLen;
  const cutoff = Math.min(1, 1 / ratio);
  const halfWidth = (taps / 2) * Math.max(1, ratio);

  for (let i = 0; i < outLen; i++) {
    // Centre-aligned mapping keeps the first and last samples in the right place.
    const pos = (i + 0.5) * ratio - 0.5;
    const lo = Math.ceil(pos - halfWidth);
    const hi = Math.floor(pos + halfWidth);
    let acc = 0;
    let wsum = 0;
    for (let j = lo; j <= hi; j++) {
      const d = j - pos;
      const w = blackman(d / halfWidth) * sinc(d * cutoff);
      // Clamp at the edges instead of zero-padding, so we don't fade the ends.
      const s = src[j < 0 ? 0 : j >= src.length ? src.length - 1 : j];
      acc += s * w;
      wsum += w;
    }
    out[i] = wsum !== 0 ? acc / wsum : 0;
  }
  return out;
}

/** Cheap linear interpolation, kept for previews where speed beats quality. */
export function resampleLinear(src: Float32Array, outLen: number): Float32Array {
  const out = new Float32Array(outLen);
  if (src.length === 0 || outLen === 0) return out;
  const ratio = src.length / outLen;
  for (let i = 0; i < outLen; i++) {
    const pos = (i + 0.5) * ratio - 0.5;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = src[Math.max(0, Math.min(src.length - 1, i0))];
    const b = src[Math.max(0, Math.min(src.length - 1, i0 + 1))];
    out[i] = a + (b - a) * frac;
  }
  return out;
}
