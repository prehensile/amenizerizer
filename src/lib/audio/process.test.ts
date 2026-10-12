import { describe, expect, it } from 'vitest';

import { noiseGate } from './process';

const RATE = 25000;

/** A loud burst over a bed of low-level noise that crosses zero. */
function burstOverHiss(len: number, burstAt: number, burstLen: number): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = (i % 2 ? 1 : -1) * 0.004; // ~-48 dBFS
  for (let i = burstAt; i < burstAt + burstLen; i++) out[i] = 0.8 * Math.sin(i / 3);
  return out;
}

describe('noise gate', () => {
  const opts = { thresholdDb: -30, attackMs: 1, holdMs: 4, releaseMs: 8 };
  // In samples at RATE: attack 25, hold 100, release 200.

  it('zeroes everything well clear of a hit', () => {
    const src = burstOverHiss(4000, 1000, 500);
    const out = noiseGate(src, RATE, opts);
    for (let i = 0; i < 900; i++) expect(out[i]).toBe(0);
    for (let i = 1900; i < 4000; i++) expect(out[i]).toBe(0);
  });

  it('passes the hit itself untouched', () => {
    const src = burstOverHiss(4000, 1000, 500);
    const out = noiseGate(src, RATE, opts);
    for (let i = 1000; i < 1500; i++) expect(out[i]).toBe(src[i]);
  });

  it('opens ahead of the onset, so the attack ramp does not eat the transient', () => {
    const src = burstOverHiss(4000, 1000, 500);
    const out = noiseGate(src, RATE, opts);
    expect(out[1000 - 26]).toBe(0);
    expect(Math.abs(out[1000 - 10])).toBeGreaterThan(0);
    expect(Math.abs(out[1000 - 10])).toBeLessThan(Math.abs(src[1000 - 10]));
  });

  it('holds, then releases linearly', () => {
    const src = burstOverHiss(4000, 1000, 500);
    const out = noiseGate(src, RATE, opts);
    // Last hit sample sits at or just before 1499; hold keeps unity for 100 more.
    expect(out[1550]).toBe(src[1550]);
    const mid = out[1499 + 100 + 100] / src[1499 + 100 + 100];
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(out[1499 + 100 + 210]).toBe(0);
  });

  it('wraps round the loop seam, because the engine does', () => {
    // A hit on the downbeat opens the gate at the end of the previous bar.
    const src = burstOverHiss(4000, 0, 200);
    const out = noiseGate(src, RATE, opts);
    expect(Math.abs(out[3990])).toBeGreaterThan(0);
    // And a tail at the end of the bar holds through the start.
    const tail = burstOverHiss(4000, 3800, 200);
    expect(noiseGate(tail, RATE, opts)[50]).toBe(tail[50]);
  });

  it('silences a loop that never reaches the threshold', () => {
    const src = burstOverHiss(4000, 0, 0);
    expect(noiseGate(src, RATE, opts).every((s) => s === 0)).toBe(true);
  });
});
