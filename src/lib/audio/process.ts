/**
 * Gain staging and shaping applied before the 4-bit crush.
 *
 * Order matters: DC first (a biased signal wastes headroom you cannot spare at
 * 16 levels), then gain, then soft clip, then edge fades.
 */

export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0].slice();
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (const ch of channels) {
    for (let i = 0; i < len; i++) out[i] += ch[i];
  }
  const inv = 1 / channels.length;
  for (let i = 0; i < len; i++) out[i] *= inv;
  return out;
}

/** Subtract the mean. Cheap, and always worth doing before quantising. */
export function removeDC(samples: Float32Array): Float32Array {
  if (samples.length === 0) return samples;
  let sum = 0;
  for (const s of samples) sum += s;
  const mean = sum / samples.length;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - mean;
  return out;
}

export function peak(samples: Float32Array): number {
  let p = 0;
  for (const s of samples) {
    const a = Math.abs(s);
    if (a > p) p = a;
  }
  return p;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** Scale so the loudest sample sits at `target`. No-op on silence. */
export function normalize(samples: Float32Array, target = 0.98): Float32Array {
  const p = peak(samples);
  if (p === 0) return samples.slice();
  return applyGain(samples, target / p);
}

export function applyGain(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/**
 * tanh soft clip, normalised so the curve passes through +/-1 unchanged in
 * slope terms. Driving into this beats hard clipping when a breakbeat's
 * transients overshoot after normalisation.
 */
export function softClip(samples: Float32Array, drive: number): Float32Array {
  if (drive <= 1) return samples.slice();
  const out = new Float32Array(samples.length);
  const k = Math.tanh(drive);
  for (let i = 0; i < samples.length; i++) out[i] = Math.tanh(samples[i] * drive) / k;
  return out;
}

/** Hard clamp to [-1, 1). Applied last as a safety net. */
export function clamp(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] > 0.999 ? 0.999 : samples[i] < -1 ? -1 : samples[i];
  }
  return out;
}

/**
 * Short equal-power-ish fades at the loop seam.
 *
 * The engine restarts slice 0 immediately after slice 15, so a mismatch at the
 * boundary clicks once per bar. A couple of milliseconds is enough to kill it
 * without audibly softening a kick on beat 1.
 */
export function fadeEdges(samples: Float32Array, fadeSamples: number): Float32Array {
  const out = samples.slice();
  const n = Math.min(fadeSamples, Math.floor(out.length / 2));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return out;
}

/** One-pole high-pass; useful for shedding sub energy that 4 bits cannot carry. */
export function highPass(samples: Float32Array, cutoffHz: number, rate: number): Float32Array {
  if (cutoffHz <= 0) return samples.slice();
  const dt = 1 / rate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const alpha = rc / (rc + dt);
  const out = new Float32Array(samples.length);
  let prevIn = samples[0] ?? 0;
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    prevOut = alpha * (prevOut + samples[i] - prevIn);
    prevIn = samples[i];
    out[i] = prevOut;
  }
  return out;
}
