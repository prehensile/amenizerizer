/**
 * Gain staging and shaping applied before the 4-bit crush.
 *
 * Order matters: DC first (a biased signal wastes headroom you cannot spare at
 * 16 levels), then gain, then soft clip, then the noise gate, then edge fades.
 * The gate goes after all the level stages so its threshold is measured
 * against what the quantiser will actually see.
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

export interface GateOptions {
  /** Opens when the signal's absolute level reaches this, in dBFS. */
  thresholdDb: number;
  /** Ramp-up time. Also used as lookahead, so the ramp finishes on the onset. */
  attackMs?: number;
  /** How long the gate stays fully open after the last sample above threshold. */
  holdMs?: number;
  /** Ramp-down time once the hold runs out. */
  releaseMs?: number;
}

/**
 * Noise gate: mutes everything between hits.
 *
 * At 4 bits this does more than it would at 16. Zero sits at 7.5 on the nibble
 * grid, between two levels, so any low-level signal that crosses zero toggles
 * 7/8 and comes out as a full-LSB buzz roughly 24 dB down — however quiet the
 * signal was. Exact zero always lands on 8, so a closed gate is true silence.
 * (Only without dither: dither noise around 7.5 toggles 7/8 just the same.)
 *
 * The closed state is gain 0 rather than a finite range, because attenuating a
 * sub-LSB signal by some dB still leaves it toggling across the midpoint.
 *
 * Offline, so lookahead is free: the open/closed decision is widened backwards
 * by the attack time and forwards by the hold time, and the gain then ramps
 * linearly between 0 and 1. The buffer is treated as circular, because the
 * engine loops it — a kick on the downbeat opens the gate at the end of the
 * previous bar, and a tail at the end of the bar holds it open into the start.
 */
export function noiseGate(samples: Float32Array, rate: number, options: GateOptions): Float32Array {
  const len = samples.length;
  if (len === 0) return samples.slice();
  const { thresholdDb, attackMs = 0.5, holdMs = 10, releaseMs = 40 } = options;
  const threshold = 10 ** (thresholdDb / 20);
  const attack = Math.max(1, Math.round((attackMs / 1000) * rate));
  const hold = Math.max(0, Math.round((holdMs / 1000) * rate));
  const release = Math.max(1, Math.round((releaseMs / 1000) * rate));

  // Distance (in samples, circularly) to the next and previous sample at or
  // above threshold. Two passes each way so the wrap is seen from both sides.
  const big = Infinity;
  const sinceLast = new Float64Array(len).fill(big);
  const untilNext = new Float64Array(len).fill(big);
  let d = big;
  for (let k = 0; k < 2 * len; k++) {
    const i = k % len;
    d = Math.abs(samples[i]) >= threshold ? 0 : d + 1;
    if (d < sinceLast[i]) sinceLast[i] = d;
  }
  d = big;
  for (let k = 2 * len - 1; k >= 0; k--) {
    const i = k % len;
    d = Math.abs(samples[i]) >= threshold ? 0 : d + 1;
    if (d < untilNext[i]) untilNext[i] = d;
  }

  // Nothing ever crosses the threshold: the whole loop is gated.
  if (sinceLast[0] === big) return new Float32Array(len);

  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    // Gain is the larger of the attack ramp towards the next onset and the
    // hold-then-release ramp after the last one. Both are 1 on a hit.
    const up = untilNext[i] >= attack ? 0 : 1 - untilNext[i] / attack;
    const sinceHold = sinceLast[i] - hold;
    const down = sinceHold <= 0 ? 1 : sinceHold >= release ? 0 : 1 - sinceHold / release;
    const g = Math.max(up, down);
    // Leave closed samples at +0 rather than writing -0 from a negative input.
    if (g > 0) out[i] = samples[i] * g;
  }
  return out;
}
