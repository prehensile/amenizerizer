import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The worklet file guards its registerProcessor call, so its engine core is
// importable here. That is the point: the live path and the offline path must
// not drift apart.
import { createEngine, nr50Gain } from './engine-processor.js';
import { simulate } from './simulate';
import { readTables } from '../gb/amenizer';
import { BTN, Pad } from '../pad.svelte';

const rom = new Uint8Array(
  readFileSync(fileURLToPath(new URL('../../../resources/amenizer.gb', import.meta.url))),
);
const tables = readTables(rom);
const flat = new Uint8Array(256);
for (let t = 0; t < 16; t++) for (let s = 0; s < 16; s++) flat[(t << 4) | s] = tables[t][s];

function runLive(params: Record<string, unknown>, count: number): Float32Array {
  const engine = createEngine(rom, flat);
  Object.assign(engine.params, params);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = engine.next();
  return out;
}

describe('live engine matches the offline simulator', () => {
  for (const params of [
    { tableSelect: 0, envelope: null, repeat: null },
    { tableSelect: 1, envelope: null, repeat: null },
    { tableSelect: 8, envelope: null, repeat: null },
    { tableSelect: 0, envelope: 2, repeat: null },
    { tableSelect: 0, envelope: null, repeat: 2 },
    { tableSelect: 5, envelope: 0, repeat: 3 },
  ]) {
    it(`agrees for ${JSON.stringify(params)}`, () => {
      const n = 16 * 2048;
      const live = runLive(params, n);
      const offline = simulate(rom, tables, {
        tableSelect: params.tableSelect,
        envelope: params.envelope,
        repeat: params.repeat,
        bars: 1,
      }).samples;
      for (let i = 0; i < n; i++) {
        expect(live[i]).toBe(offline[i]);
      }
    });
  }

  it('shares one gain function with the same behaviour', () => {
    expect(nr50Gain(0, 0, null)).toBe(1);
    // (~0 & 7) = 7 -> (7+1)/8 = 1 at the top of a ramp.
    expect(nr50Gain(0, 0, 4)).toBeCloseTo(1, 6);
    expect(nr50Gain(7, 0, 0)).toBeGreaterThan(0);
    expect(nr50Gain(7, 0, 0)).toBeLessThanOrEqual(1);
  });
});

describe('sync out', () => {
  function pulses(params: Record<string, unknown>, count: number): number[] {
    const engine = createEngine(rom, flat);
    Object.assign(engine.params, params);
    const at: number[] = [];
    for (let i = 0; i < count; i++) {
      engine.next();
      if (engine.syncPulse()) at.push(i);
    }
    return at;
  }

  // Two bars: after the 32-sample pre-roll, one pulse every two slices.
  const expected = Array.from({ length: 16 }, (_, k) => 32 + k * 2 * 2048);

  it('pulses on every even slice, two per quarter note', () => {
    expect(pulses({}, 2 * 16 * 2048 + 32)).toEqual(expected);
  });

  it('keeps time whatever the table, repeater or decay are doing', () => {
    expect(pulses({ tableSelect: 5, envelope: 0, repeat: 3 }, 2 * 16 * 2048 + 32)).toEqual(
      expected,
    );
  });

  it('lands on the first sample of the slice the sequencer picked', () => {
    const engine = createEngine(rom, flat);
    engine.params.tableSelect = 9;
    for (let i = 0; i < 32 + 3 * 2 * 2048; i++) engine.next();
    const b = engine.next();
    expect(engine.syncPulse()).toBe(true);
    const slice = flat[(9 << 4) | engine.step];
    expect(b).toBe((rom[0x4000 + slice * 1024] >> 4) / 8 - 7.5 / 8);
  });
});

describe('pad control scheme', () => {
  it('uses the raw D-pad bitmask as the table index', () => {
    const p = new Pad();
    p.press('Right');
    expect(p.tableSelect).toBe(1);
    p.press('Up');
    expect(p.tableSelect).toBe(5); // Up+Right
    p.release('Right');
    expect(p.tableSelect).toBe(4);
  });

  it('forces identity while Start is held', () => {
    const p = new Pad();
    p.press('Left');
    p.press('Start');
    expect(p.tableSelect).toBe(0);
    p.release('Start');
    expect(p.tableSelect).toBe(2);
  });

  it('only sounds the decay while A is held, and steps it 0..4', () => {
    const p = new Pad();
    expect(p.envelope).toBeNull();
    p.press('A');
    expect(p.envelope).toBe(4); // boot value of $C092
    p.press('Right');
    p.release('Right');
    expect(p.envShift).toBe(3);
    for (let i = 0; i < 8; i++) {
      p.press('Right');
      p.release('Right');
    }
    expect(p.envShift).toBe(0); // clamped by `sub 1; jr c`
    p.release('A');
    expect(p.envelope).toBeNull();
  });

  it('only sounds the repeater while B is held, and clamps depth to 1..3', () => {
    const p = new Pad();
    expect(p.repeat).toBeNull();
    p.press('B');
    expect(p.repeat).toBe(1);
    for (let i = 0; i < 8; i++) {
      p.press('Down');
      p.release('Down');
    }
    expect(p.repeatDepth).toBe(3); // clamped by `cp $04; jr nc`
    for (let i = 0; i < 8; i++) {
      p.press('Up');
      p.release('Up');
    }
    expect(p.repeatDepth).toBe(1);
  });

  it('treats a roll between directions as one change, not fresh presses', () => {
    const p = new Pad();
    p.press('B');
    p.set(BTN.B | BTN.Down);
    expect(p.repeatDepth).toBe(2);
    // Rolling Down -> Down+Right -> Right -> Down+Right: Down stays held, so
    // it only edges again after it has actually been let go.
    p.set(BTN.B | BTN.Down | BTN.Right);
    expect(p.repeatDepth).toBe(2);
    p.set(BTN.B | BTN.Right);
    p.set(BTN.B | BTN.Down | BTN.Right);
    expect(p.repeatDepth).toBe(3);
  });

  it('ignores auto-repeat so one physical press is one edge', () => {
    const p = new Pad();
    p.press('B');
    p.press('Down');
    p.press('Down'); // key repeat
    p.press('Down');
    expect(p.repeatDepth).toBe(2);
  });
});
