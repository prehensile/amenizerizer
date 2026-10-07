<script lang="ts">
  import { BTN, KEYS, pad, type Button } from '../lib/pad.svelte';
  import { buttonsAt, dpadMask, onDpad } from '../lib/touch';

  let { onchange }: { onchange?: () => void } = $props();

  let padEl: HTMLDivElement;
  let dpadEl: HTMLDivElement;

  /**
   * Every input source holds its own mask and the pad sees their union, so a
   * button held by two fingers, or by a finger and a key, survives either
   * letting go.
   */
  let keyMask = 0;
  /** Live pointers, keyed by pointerId: which part of the pad each one owns and what it holds. */
  const pointers = new Map<number, { dpad: boolean; mask: number }>();

  function sync() {
    let mask = keyMask;
    for (const p of pointers.values()) mask |= p.mask;
    if (mask === pad.held) return;
    pad.set(mask);
    onchange?.();
  }

  function dpadGeometry(x: number, y: number) {
    const r = dpadEl.getBoundingClientRect();
    return {
      dx: x - (r.left + r.right) / 2,
      dy: y - (r.top + r.bottom) / 2,
      radius: r.width / 2,
    };
  }

  function hitButtons(x: number, y: number): number {
    const buttons = [...padEl.querySelectorAll<HTMLElement>('.ab [data-btn], .startsel [data-btn]')].map((el) => ({
      mask: BTN[el.dataset.btn as Button],
      rect: el.getBoundingClientRect(),
    }));
    return buttonsAt(x, y, buttons);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    // Keep receiving moves wherever the pointer goes, including off the pad.
    padEl.setPointerCapture(e.pointerId);
    const { dx, dy, radius } = dpadGeometry(e.clientX, e.clientY);
    // A touch belongs to whichever side it lands on for its whole life — a
    // thumb on the d-pad stays on the d-pad however far it drifts. A touch
    // squarely on a button is that button's, even inside the d-pad's reach.
    const dpad = !hitButtons(e.clientX, e.clientY) && onDpad(dx, dy, radius);
    pointers.set(e.pointerId, { dpad, mask: 0 });
    track(e);
  }

  function track(e: PointerEvent) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (p.dpad) {
      const { dx, dy, radius } = dpadGeometry(e.clientX, e.clientY);
      p.mask = dpadMask(dx, dy, radius);
    } else {
      p.mask = hitButtons(e.clientX, e.clientY);
    }
    sync();
  }

  function onPointerEnd(e: PointerEvent) {
    if (pointers.delete(e.pointerId)) sync();
  }

  function onKeyDown(e: KeyboardEvent) {
    const b = KEYS[e.key];
    if (!b) return;
    e.preventDefault();
    keyMask |= BTN[b];
    sync();
  }

  function onKeyUp(e: KeyboardEvent) {
    const b = KEYS[e.key];
    if (!b) return;
    e.preventDefault();
    keyMask &= ~BTN[b];
    sync();
  }

  /** A pointer that leaves the window would otherwise stick a button down. */
  function onBlur() {
    keyMask = 0;
    pointers.clear();
    sync();
  }
</script>

<svelte:window on:keydown={onKeyDown} on:keyup={onKeyUp} on:blur={onBlur} />

<!-- Buttons are display only: all pointer input is hit-tested on the pad
     itself (see lib/touch.ts), which is what lets a thumb roll between
     directions and several fingers hold buttons at once. -->
{#snippet key(b: Button, cls: string, glyph: string)}
  <button
    class={cls}
    class:on={pad.is(b)}
    data-btn={b}
    tabindex="-1"
    aria-label={b}
    aria-pressed={pad.is(b)}
  >{glyph}</button>
{/snippet}

<div
  class="pad"
  bind:this={padEl}
  onpointerdown={onPointerDown}
  onpointermove={track}
  onpointerup={onPointerEnd}
  onpointercancel={onPointerEnd}
  onlostpointercapture={onPointerEnd}
  oncontextmenu={(e) => e.preventDefault()}
  role="group"
  aria-label="Game Boy controls"
>
  <div class="dpad" bind:this={dpadEl}>
    {@render key('Up', 'd up', '▲')}
    {@render key('Left', 'd left', '◀')}
    <div class="d hub"></div>
    {@render key('Right', 'd right', '▶')}
    {@render key('Down', 'd down', '▼')}
  </div>

  <div class="ab">
    {@render key('B', 'round b', 'B')}
    {@render key('A', 'round a', 'A')}
  </div>

  <div class="startsel">
    {@render key('Select', 'pill', 'SELECT')}
    {@render key('Start', 'pill', 'START')}
  </div>
</div>

<p class="keys muted">
  Arrow keys · <kbd>Z</kbd> = B · <kbd>X</kbd> = A · <kbd>⏎</kbd> = Start ·
  <kbd>⇧</kbd> = Select
</p>

<style>
  .pad {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas: 'dpad startsel ab';
    align-items: center;
    gap: 20px;
    padding: 18px 22px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    /* On touch screens a held thumb is a long-press: without these the browser
       selects the glyphs, pops the copy/lookup callout, or claims the gesture
       as a scroll and cancels the pointer mid-hold. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  @media (max-width: 560px) {
    .pad {
      grid-template-columns: auto auto;
      grid-template-areas: 'dpad ab' 'startsel startsel';
      justify-content: space-between;
    }
  }

  .dpad {
    grid-area: dpad;
    display: grid;
    grid-template-columns: repeat(3, 34px);
    grid-template-rows: repeat(3, 34px);
  }
  .dpad :global(.up) { grid-area: 1 / 2; }
  .dpad :global(.left) { grid-area: 2 / 1; }
  .hub { grid-area: 2 / 2; background: #2a323c; }
  .dpad :global(.right) { grid-area: 2 / 3; }
  .dpad :global(.down) { grid-area: 3 / 2; }

  .pad :global(.d) {
    background: #2a323c;
    border: none;
    color: #8d99a8;
    font-size: 11px;
    padding: 0;
    border-radius: 3px;
  }
  .pad :global(.d.on) { background: var(--accent); color: #0d0f12; }

  .ab {
    grid-area: ab;
    display: flex;
    gap: 14px;
    align-items: center;
  }
  .pad :global(.round) {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background: #2a323c;
    border: 1px solid var(--line-2);
    color: var(--muted);
    font-weight: 700;
    font-size: 13px;
  }
  .pad :global(.round.on) {
    background: var(--accent);
    border-color: var(--accent);
    color: #0d0f12;
  }
  .pad :global(.b) { transform: translateY(9px); }

  .startsel {
    grid-area: startsel;
    display: flex;
    gap: 10px;
    justify-content: center;
  }
  .pad :global(.pill) {
    padding: 4px 12px;
    border-radius: 10px;
    background: #2a323c;
    border: none;
    color: var(--muted);
    font-size: 10px;
    letter-spacing: 0.08em;
  }
  .pad :global(.pill.on) { background: var(--accent); color: #0d0f12; }

  .keys { margin: 10px 0 0; font-size: 12px; }
  kbd {
    font-family: var(--mono);
    background: var(--panel-2);
    border: 1px solid var(--line-2);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 5px;
    font-size: 11px;
  }
</style>
