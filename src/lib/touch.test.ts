import { describe, expect, it } from 'vitest';

import { BTN } from './pad.svelte';
import { buttonsAt, dpadMask, onDpad, type Rect } from './touch';

const R = 50;
/** Point at `deg` (0 = right, 90 = up, screen-space) and `dist` from centre. */
const at = (deg: number, dist = R) => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * dist, -Math.sin(a) * dist] as const;
};
const mask = (deg: number, dist = R) => dpadMask(...at(deg, dist), R);

describe('dpadMask', () => {
  it('presses nothing in the dead zone', () => {
    expect(mask(0, R * 0.1)).toBe(0);
    expect(mask(135, R * 0.19)).toBe(0);
  });

  it('maps the four axes to single directions', () => {
    expect(mask(0)).toBe(BTN.Right);
    expect(mask(90)).toBe(BTN.Up);
    expect(mask(180)).toBe(BTN.Left);
    expect(mask(270)).toBe(BTN.Down);
  });

  it('maps the four diagonals to two directions', () => {
    expect(mask(45)).toBe(BTN.Up | BTN.Right);
    expect(mask(135)).toBe(BTN.Up | BTN.Left);
    expect(mask(225)).toBe(BTN.Down | BTN.Left);
    expect(mask(315)).toBe(BTN.Down | BTN.Right);
  });

  it('gives cardinals 50° and diagonals 40°', () => {
    expect(mask(24)).toBe(BTN.Right);
    expect(mask(26)).toBe(BTN.Up | BTN.Right);
    expect(mask(64)).toBe(BTN.Up | BTN.Right);
    expect(mask(66)).toBe(BTN.Up);
  });

  it('never presses opposite directions together', () => {
    for (let deg = 0; deg < 360; deg += 1) {
      const m = mask(deg);
      expect(m & (BTN.Up | BTN.Down)).not.toBe(BTN.Up | BTN.Down);
      expect(m & (BTN.Left | BTN.Right)).not.toBe(BTN.Left | BTN.Right);
    }
  });

  it('keeps reading direction beyond the drawn pad', () => {
    expect(mask(90, R * 3)).toBe(BTN.Up);
  });
});

describe('onDpad', () => {
  it('claims touches up to 1.6 radii out', () => {
    expect(onDpad(...at(45, R * 1.5), R)).toBe(true);
    expect(onDpad(...at(45, R * 1.7), R)).toBe(false);
  });
});

describe('buttonsAt', () => {
  // A and B as laid out: 46px circles, 14px apart.
  const b: Rect = { left: 0, top: 0, right: 46, bottom: 46 };
  const a: Rect = { left: 60, top: 0, right: 106, bottom: 46 };
  const buttons = [
    { mask: BTN.B, rect: b },
    { mask: BTN.A, rect: a },
  ];

  it('hits a single button', () => {
    expect(buttonsAt(20, 20, buttons)).toBe(BTN.B);
    expect(buttonsAt(80, 20, buttons)).toBe(BTN.A);
  });

  it('presses both from the middle of the gap', () => {
    expect(buttonsAt(53, 20, buttons)).toBe(BTN.A | BTN.B);
  });

  it('honours the slop margin and nothing beyond it', () => {
    expect(buttonsAt(-7, 20, buttons)).toBe(BTN.B);
    expect(buttonsAt(-9, 20, buttons)).toBe(0);
    expect(buttonsAt(20, 60, buttons, 0)).toBe(0);
  });
});
