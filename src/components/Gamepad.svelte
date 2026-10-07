<script lang="ts">
  import { KEYS, pad, type Button } from '../lib/pad.svelte';

  let { onchange }: { onchange?: () => void } = $props();

  function down(b: Button) {
    pad.press(b);
    onchange?.();
  }
  function up(b: Button) {
    pad.release(b);
    onchange?.();
  }

  function onKeyDown(e: KeyboardEvent) {
    const b = KEYS[e.key];
    if (!b) return;
    e.preventDefault();
    if (!e.repeat) down(b);
  }

  function onKeyUp(e: KeyboardEvent) {
    const b = KEYS[e.key];
    if (!b) return;
    e.preventDefault();
    up(b);
  }

  /** A pointer that leaves the window would otherwise stick a button down. */
  function onBlur() {
    pad.releaseAll();
    onchange?.();
  }
</script>

<svelte:window on:keydown={onKeyDown} on:keyup={onKeyUp} on:blur={onBlur} />

{#snippet key(b: Button, cls: string, glyph: string)}
  <button
    class={cls}
    class:on={pad.is(b)}
    onpointerdown={(e) => {
      e.preventDefault();
      down(b);
    }}
    onpointerup={() => up(b)}
    onpointerleave={() => pad.is(b) && up(b)}
    onpointercancel={() => pad.is(b) && up(b)}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label={b}
    aria-pressed={pad.is(b)}
  >{glyph}</button>
{/snippet}

<div class="pad">
  <div class="dpad">
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
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  .pad :global(button) { touch-action: none; }
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
