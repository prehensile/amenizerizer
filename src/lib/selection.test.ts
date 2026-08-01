import { describe, expect, it } from 'vitest';

import {
  canSubdivide,
  divisionAt,
  divisionBounds,
  rangeLength,
  selectDivision,
  type Range,
} from './selection';

const LEN = 44100;
const N = 4;
const WHOLE: Range = { start: 0, end: LEN };

describe('divisionAt', () => {
  it('maps offsets to quarters of the whole sample', () => {
    expect(divisionAt(0, WHOLE, N)).toBe(0);
    expect(divisionAt(LEN * 0.24, WHOLE, N)).toBe(0);
    expect(divisionAt(LEN * 0.26, WHOLE, N)).toBe(1);
    expect(divisionAt(LEN * 0.99, WHOLE, N)).toBe(3);
  });

  it('maps relative to the basis, not the sample', () => {
    // Second half of the file, quartered: 0.50-0.625 is its first quarter.
    const half: Range = { start: LEN / 2, end: LEN };
    expect(divisionAt(LEN * 0.51, half, N)).toBe(0);
    expect(divisionAt(LEN * 0.7, half, N)).toBe(1);
    expect(divisionAt(LEN * 0.99, half, N)).toBe(3);
  });

  it('clamps outside the basis instead of overflowing', () => {
    const half: Range = { start: LEN / 2, end: LEN };
    expect(divisionAt(0, half, N)).toBe(0);
    expect(divisionAt(LEN * 2, half, N)).toBe(N - 1);
  });

  it('survives degenerate inputs', () => {
    expect(divisionAt(10, { start: 0, end: 0 }, N)).toBe(0);
    expect(divisionAt(10, WHOLE, 0)).toBe(0);
  });
});

describe('divisionBounds', () => {
  it('covers exactly one quarter of the whole', () => {
    expect(divisionBounds(0, 0, WHOLE, N)).toEqual({ start: 0, end: 11025 });
    expect(divisionBounds(3, 3, WHOLE, N)).toEqual({ start: 33075, end: LEN });
  });

  it('is offset by the basis start', () => {
    const half: Range = { start: LEN / 2, end: LEN };
    // Quarters of a 22050-sample basis are 5512.5 long, so ends land on .5.
    expect(divisionBounds(0, 0, half, N)).toEqual({ start: 22050, end: 27563 });
    expect(divisionBounds(3, 3, half, N)).toEqual({ start: 38588, end: LEN });
  });

  it('is inclusive of both ends and order-independent', () => {
    expect(divisionBounds(1, 2, WHOLE, N)).toEqual({ start: 11025, end: 33075 });
    expect(divisionBounds(2, 1, WHOLE, N)).toEqual(divisionBounds(1, 2, WHOLE, N));
  });

  it('tiles the basis without gaps', () => {
    const basis: Range = { start: 1000, end: 9000 };
    for (let i = 0; i < N - 1; i++) {
      expect(divisionBounds(i, i, basis, N).end).toBe(divisionBounds(i + 1, i + 1, basis, N).start);
    }
    expect(divisionBounds(0, N - 1, basis, N)).toEqual(basis);
  });
});

describe('selectDivision', () => {
  it('selects the clicked quarter and anchors there', () => {
    expect(selectDivision(LEN * 0.6, WHOLE, N, false, -1)).toEqual({
      start: 22050,
      end: 33075,
      anchor: 2,
    });
  });

  it('narrows progressively when the basis is the previous selection', () => {
    // Click quarter 1 of the file, then quarter 0 of that quarter.
    const first = selectDivision(LEN * 0.3, WHOLE, N, false, -1);
    expect(first).toMatchObject({ start: 11025, end: 22050 });
    const second = selectDivision(11500, first, N, false, -1);
    expect(second).toMatchObject({ start: 11025, end: 13781 });
    expect(rangeLength(second)).toBeCloseTo(rangeLength(first) / 4, 0);
  });

  it('extends in both directions from the anchor', () => {
    const fwd = selectDivision(LEN * 0.8, WHOLE, N, true, 0);
    expect(fwd).toEqual({ start: 0, end: LEN, anchor: 0 });
    const back = selectDivision(LEN * 0.1, WHOLE, N, true, 3);
    expect(back).toEqual({ start: 0, end: LEN, anchor: 3 });
  });

  it('keeps the anchor put across repeated shift-clicks', () => {
    let sel = selectDivision(LEN * 0.3, WHOLE, N, false, -1); // anchor 1
    sel = selectDivision(LEN * 0.9, WHOLE, N, true, sel.anchor);
    expect(sel).toEqual({ start: 11025, end: LEN, anchor: 1 });
    sel = selectDivision(LEN * 0.6, WHOLE, N, true, sel.anchor);
    expect(sel).toEqual({ start: 11025, end: 33075, anchor: 1 });
  });

  it('treats a shift-click with no anchor as a plain click', () => {
    expect(selectDivision(LEN * 0.9, WHOLE, N, true, -1)).toEqual({
      start: 33075,
      end: LEN,
      anchor: 3,
    });
  });
});

describe('canSubdivide', () => {
  it('stops once a range is too short to quarter', () => {
    expect(canSubdivide({ start: 0, end: LEN }, N)).toBe(true);
    expect(canSubdivide({ start: 0, end: 8 }, N)).toBe(true);
    expect(canSubdivide({ start: 0, end: 4 }, N)).toBe(false);
    expect(canSubdivide({ start: 0, end: 0 }, N)).toBe(false);
  });
});
