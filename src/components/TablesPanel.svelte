<script lang="ts">
  import Panel from './Panel.svelte';
  import { app } from '../lib/state.svelte';
  import { TABLE_STEPS, dpadLabel, isIdentityTable } from '../lib/gb/amenizer';

  let selected = $state(1);
  let open = $state(false);

  const HEX = '0123456789abcdef';

  function setStep(step: number, value: number) {
    const next = app.tables.map((row) => [...row]);
    next[selected][step] = ((value % 16) + 16) % 16;
    app.tables = next;
  }

  function makeIdentity() {
    const next = app.tables.map((row) => [...row]);
    next[selected] = [...Array(16).keys()];
    app.tables = next;
  }
</script>

<Panel step="3" title="Slice tables" collapsible bind:open disabled={!app.loaded}>
  {#snippet actions()}
    <button onclick={() => app.resetTables()}>Revert all to ROM</button>
  {/snippet}

  <div class="cols">
    <ul class="list">
      {#each app.tables as row, i}
        <li>
          <button class:sel={selected === i} onclick={() => (selected = i)}>
            <span class="idx mono">{HEX[i]}</span>
            <span class="dpad">{dpadLabel(i)}</span>
            {#if isIdentityTable(row)}<span class="badge">identity</span>{/if}
          </button>
        </li>
      {/each}
    </ul>

    <div class="editor">
      <h3>Table {HEX[selected]} <span class="muted">— hold {dpadLabel(selected)}</span></h3>
      <p class="muted small">
        Each column is one sixteenth of the bar; the value is which slice plays there.
        Holding Start always forces the identity order.
      </p>

      <div class="steps">
        {#each app.tables[selected] ?? [] as value, step}
          <div class="cell" class:moved={value !== step}>
            <span class="stepno">{step + 1}</span>
            <input
              type="number"
              min="0"
              max="15"
              {value}
              onchange={(e) => setStep(step, e.currentTarget.valueAsNumber)}
            />
          </div>
        {/each}
      </div>

      <div class="bar">
        {#each app.tables[selected] ?? [] as value, step}
          <div
            class="chip"
            class:moved={value !== step}
            style:left="{(step / TABLE_STEPS) * 100}%"
            style:width="{100 / TABLE_STEPS}%"
            style:--y="{(value / 15) * 100}%"
            title="step {step + 1} → slice {value}"
          ></div>
        {/each}
      </div>

      <div class="row">
        <button onclick={makeIdentity}>Make identity</button>
        <span class="muted small">
          Sequence: <code>{(app.tables[selected] ?? []).map((v) => HEX[v]).join(' ')}</code>
        </span>
      </div>
    </div>
  </div>
</Panel>

<style>
  .cols { display: grid; grid-template-columns: 190px 1fr; gap: 18px; }
  @media (max-width: 780px) { .cols { grid-template-columns: 1fr; } }

  /* All 16 combinations fit without scrolling — the list is a fixed size. */
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .list button {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    background: none; border: 1px solid transparent; padding: 5px 8px; border-radius: 5px;
  }
  .list button.sel { background: var(--panel-2); border-color: var(--accent-dim); }
  .idx { color: var(--accent); width: 10px; }
  .dpad { flex: 1; font-size: 12px; }
  .badge { font-size: 10px; color: var(--muted); border: 1px solid var(--line-2); border-radius: 3px; padding: 0 4px; }

  .editor h3 { font-size: 13px; margin-bottom: 4px; }
  .small { font-size: 12px; }
  .editor p { margin: 0 0 12px; }

  .steps { display: grid; grid-template-columns: repeat(16, 1fr); gap: 3px; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .stepno { font-size: 9px; color: var(--muted); }
  .cell input {
    text-align: center; padding: 4px 0; font-family: var(--mono);
    appearance: textfield; -moz-appearance: textfield;
  }
  .cell.moved input { border-color: var(--accent); color: var(--accent); }

  .bar { position: relative; height: 54px; margin: 12px 0; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .chip { position: absolute; top: var(--y); height: 4px; background: var(--line-2); border-radius: 2px; transform: translateY(2px); }
  .chip.moved { background: var(--accent); }

  .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
</style>
