/**
 * The Amenizer control scheme, as the ROM implements it.
 *
 * `Call_000_0285` packs the joypad into one byte as
 * [Start Select B A | Down Up Left Right] and stores `held & 0x0F` in $C0CC,
 * so the slice table index literally *is* the D-pad bitmask. The modifier
 * buttons each gate a different piece of persistent state, adjusted in VBlank:
 *
 *   Select + Up/Down   TMA, i.e. pitch      (held, ramps every frame; 1..$E1)
 *   B      + Up/Down   $C0CD repeat depth   (on press; 1..3)
 *   A      + Left/Right $C092 decay shift   (on press; 0..4)
 *   Start              forces table 0
 *
 * Repeat and decay only *sound* while their modifier is held — VBlank resets
 * $C056 to $FF and $C090 to $0E on every frame where B / A are up.
 */

import { TMA_MAX, TMA_MIN } from './gb/amenizer';

export const BTN = {
  Right: 0x01,
  Left: 0x02,
  Up: 0x04,
  Down: 0x08,
  A: 0x10,
  B: 0x20,
  Select: 0x40,
  Start: 0x80,
} as const;

export type Button = keyof typeof BTN;

/** Keyboard mapping. X/Z follow the usual emulator convention. */
export const KEYS: Record<string, Button> = {
  ArrowRight: 'Right',
  ArrowLeft: 'Left',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  x: 'A',
  z: 'B',
  Enter: 'Start',
  Shift: 'Select',
};

/** How fast VBlank ramps TMA while Select + Up/Down is held. */
const VBLANK_HZ = 59.7;

export class Pad {
  held = $state(0);
  /** $C0CD — repeat depth. Boot value is 1 (`ld a,$01; ld [$c0cd],a`). */
  repeatDepth = $state(1);
  /** $C092 — decay shift. Boot value is 4, the `jr +4` operand in the ROM copy. */
  envShift = $state(4);
  /** Runtime TMA, seeded from the ROM and nudged by Select + Up/Down. */
  tma = $state(0xad);

  private ramp: ReturnType<typeof setInterval> | undefined;

  is(b: Button): boolean {
    return (this.held & BTN[b]) !== 0;
  }

  /** Start zeroes $C0CC, which is why holding it restores the identity order. */
  get tableSelect(): number {
    return this.is('Start') ? 0 : this.held & 0x0f;
  }

  get envelope(): number | null {
    return this.is('A') ? this.envShift : null;
  }

  get repeat(): number | null {
    return this.is('B') ? this.repeatDepth : null;
  }

  /** Human-readable list of what is physically held, in Game Boy order. */
  get label(): string {
    const order: Button[] = ['Up', 'Down', 'Left', 'Right', 'A', 'B', 'Select', 'Start'];
    const on = order.filter((b) => this.is(b));
    return on.length ? on.join(' + ') : '—';
  }

  press(b: Button): void {
    if (this.is(b)) return; // ignore auto-repeat; the ROM sees one edge
    this.held |= BTN[b];

    // Edge-triggered adjustments read $C0CA (newly pressed), not $C0CB.
    if (this.is('B')) {
      if (b === 'Down' && this.repeatDepth < 3) this.repeatDepth++;
      if (b === 'Up' && this.repeatDepth > 1) this.repeatDepth--;
    }
    if (this.is('A')) {
      if (b === 'Left' && this.envShift < 3) this.envShift++;
      if (b === 'Right' && this.envShift > 0) this.envShift--;
    }
    this.syncRamp();
  }

  release(b: Button): void {
    this.held &= ~BTN[b];
    this.syncRamp();
  }

  releaseAll(): void {
    this.held = 0;
    this.syncRamp();
  }

  /** Select + Up/Down retunes continuously, so mirror VBlank with a timer. */
  private syncRamp(): void {
    const active = this.is('Select') && (this.is('Up') || this.is('Down'));
    if (active && this.ramp === undefined) {
      this.ramp = setInterval(() => {
        if (this.is('Up') && this.tma < TMA_MAX) this.tma++;
        if (this.is('Down') && this.tma > TMA_MIN) this.tma--;
      }, 1000 / VBLANK_HZ);
    } else if (!active && this.ramp !== undefined) {
      clearInterval(this.ramp);
      this.ramp = undefined;
    }
  }
}

export const pad = new Pad();
