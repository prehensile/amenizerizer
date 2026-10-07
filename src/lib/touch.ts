/**
 * Touch geometry for the on-screen pad.
 *
 * Per-element pointer handlers can't behave like a real pad: a touch is
 * captured by the element it lands on, so a thumb can't roll from Up into
 * Right, and the gaps between the d-pad arms make diagonals nearly unreachable.
 * Diagonals matter here — the slice table index is the raw d-pad bitmask, so
 * Up+Right, Down+Left etc. are tables of their own. Instead, every pointer is
 * hit-tested here against the pad's geometry on each move, and the held state
 * is the union of all of them.
 */

import { BTN } from './pad.svelte';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Inside this fraction of the d-pad's radius nothing is pressed, like the pivot. */
export const DPAD_DEAD_ZONE = 0.2;

/** How far outside the drawn d-pad a touch still claims it, as a multiple of its radius. */
export const DPAD_REACH = 1.6;

/**
 * Off-axis component, relative to distance, beyond which the neighbouring
 * direction joins in. sin 25° gives each cardinal a 50° sector and each
 * diagonal 40°: diagonals are easy to rock into without a straight press
 * wandering into one.
 */
export const DPAD_DIAGONAL = Math.sin((25 * Math.PI) / 180);

/** Extra hit area around A/B/Start/Select, in CSS pixels. */
export const BUTTON_SLOP = 8;

/**
 * D-pad bits for a point at (dx, dy) from the d-pad centre, screen
 * coordinates (y grows downward). `radius` is half the d-pad's width.
 */
export function dpadMask(dx: number, dy: number, radius: number): number {
  const d = Math.hypot(dx, dy);
  if (d < radius * DPAD_DEAD_ZONE) return 0;
  const t = d * DPAD_DIAGONAL;
  let mask = 0;
  if (dx > t) mask |= BTN.Right;
  if (dx < -t) mask |= BTN.Left;
  if (dy < -t) mask |= BTN.Up;
  if (dy > t) mask |= BTN.Down;
  return mask;
}

/** Whether a touch at (dx, dy) from the d-pad centre belongs to the d-pad. */
export function onDpad(dx: number, dy: number, radius: number): boolean {
  return Math.hypot(dx, dy) <= radius * DPAD_REACH;
}

/**
 * Union of every button whose rect, grown by `slop`, contains the point. The
 * slop deliberately overlaps between A and B, so a thumb laid across the gap
 * presses both, as it does on the hardware.
 */
export function buttonsAt(
  x: number,
  y: number,
  buttons: readonly { mask: number; rect: Rect }[],
  slop = BUTTON_SLOP,
): number {
  let mask = 0;
  for (const { mask: m, rect: r } of buttons) {
    if (x >= r.left - slop && x <= r.right + slop && y >= r.top - slop && y <= r.bottom + slop) {
      mask |= m;
    }
  }
  return mask;
}
