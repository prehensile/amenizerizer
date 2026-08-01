<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    step,
    title,
    disabled = false,
    collapsible = false,
    open = $bindable(true),
    actions,
    children,
  }: {
    step: number | string;
    title: string;
    disabled?: boolean;
    collapsible?: boolean;
    open?: boolean;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class:disabled>
  <header>
    <span class="step">{step}</span>
    {#if collapsible}
      <button
        class="title"
        onclick={() => (open = !open)}
        aria-expanded={open}
        aria-label="{open ? 'Collapse' : 'Expand'} {title}"
      >
        <span class="caret" class:open>
          <!-- Stroked chevron, not a filled triangle: the Play panel has a real
               play button and the two must not read the same. -->
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.5"
              stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <h2>{title}</h2>
      </button>
    {:else}
      <h2>{title}</h2>
    {/if}
    <div class="spacer"></div>
    {#if actions}{@render actions()}{/if}
  </header>
  {#if open}
    <div class="body">{@render children()}</div>
  {/if}
</section>

<style>
  section {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  section.disabled { opacity: 0.45; pointer-events: none; }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
    background: var(--panel-2);
  }
  .step {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--line-2);
    color: var(--text);
    font-size: 11px;
    font-weight: 700;
    flex: none;
  }
  h2 { font-size: 14px; }

  /* Generous hit area — this is the control for the whole panel. */
  .title {
    display: flex;
    align-items: center;
    gap: 10px;
    background: none;
    border: none;
    padding: 4px 10px 4px 4px;
    margin: -4px 0;
    border-radius: 7px;
    color: inherit;
  }
  .title:hover { background: #202730; border-color: transparent; }
  .title:hover .caret { border-color: var(--accent-dim); color: var(--text); }

  .caret {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border: 1px solid var(--line-2);
    border-radius: 6px;
    background: var(--panel);
    color: var(--muted);
    transition: transform 140ms ease, color 140ms ease, border-color 140ms ease;
  }
  .caret svg { width: 15px; height: 15px; display: block; }
  .caret.open {
    transform: rotate(90deg);
    color: var(--accent);
    border-color: var(--accent-dim);
  }

  .spacer { flex: 1; }
  .body { padding: 14px; }
</style>
