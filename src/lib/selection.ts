/**
 * Selection maths for the waveform's clickable divisions.
 *
 * Divisions subdivide a *basis* range rather than the whole sample, so the
 * source editor can quarter whatever is currently selected. Clicking then
 * narrows by 4x each time, which is how you walk down from a whole file to a
 * bar to a beat. Kept out of the component so the arithmetic can be tested —
 * an off-by-one here silently selects the wrong beat of a break.
 */

export interface Range {
  start: number;
  end: number;
}

export interface Selection extends Range {
  /** Division the next shift-click extends from; -1 when there is none. */
  anchor: number;
}

export function rangeLength(r: Range): number {
  return Math.max(0, r.end - r.start);
}

/** Which division of `basis` contains `pos`, clamped to the valid range. */
export function divisionAt(pos: number, basis: Range, divisions: number): number {
  const len = rangeLength(basis);
  if (len <= 0 || divisions <= 0) return 0;
  const idx = Math.floor(((pos - basis.start) / len) * divisions);
  return Math.max(0, Math.min(divisions - 1, idx));
}

/** Sample bounds of divisions `from`..`to` inclusive, within `basis`. */
export function divisionBounds(
  from: number,
  to: number,
  basis: Range,
  divisions: number,
): Range {
  const len = rangeLength(basis);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return {
    start: Math.round(basis.start + (lo * len) / divisions),
    end: Math.round(basis.start + ((hi + 1) * len) / divisions),
  };
}

/**
 * Resolve a click into a new selection.
 *
 * A plain click takes one division of `basis` and anchors there. A shift-click
 * spans anchor to clicked division, in either direction — the caller passes the
 * basis the anchor was set against, so extending still works at the scale you
 * were looking at rather than the narrowed one.
 */
export function selectDivision(
  pos: number,
  basis: Range,
  divisions: number,
  shift: boolean,
  anchor: number,
): Selection {
  const idx = divisionAt(pos, basis, divisions);
  if (!shift || anchor < 0) {
    return { ...divisionBounds(idx, idx, basis, divisions), anchor: idx };
  }
  return { ...divisionBounds(anchor, idx, basis, divisions), anchor };
}

/** Too small to divide meaningfully — stop narrowing rather than collapse. */
export function canSubdivide(basis: Range, divisions: number): boolean {
  return rangeLength(basis) >= divisions * 2;
}
