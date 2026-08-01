<script lang="ts">
  import Panel from './Panel.svelte';
  import Gamepad from './Gamepad.svelte';
  import Waveform from './Waveform.svelte';
  import { app } from '../lib/state.svelte';
  import { pad } from '../lib/pad.svelte';
  import { LiveEngine } from '../lib/engine/live';
  import { simulate } from '../lib/engine/simulate';
  import { SLICE_COUNT, dpadLabel, sampleRateForTma } from '../lib/gb/amenizer';
  import * as playback from '../lib/playback';

  const engine = new LiveEngine();
  let running = $state(false);
  let starting = $state(false);
  let step = $state(-1);

  engine.onStep = (s) => (step = s);

  const HEX = '0123456789abcdef';

  /**
   * One bar rendered offline, so the arrangement is visible whether or not the
   * engine is running. Drops the 32-sample pre-roll frame so the 16 slice
   * divisions line up exactly with the drawn waveform.
   */
  const render = $derived.by(() => {
    const rom = app.patched;
    if (!rom || !app.tables.length) return null;
    return simulate(rom, app.tables, {
      tableSelect: pad.tableSelect,
      tma: pad.tma,
      bars: 1,
      envelope: pad.envelope,
      repeat: pad.repeat,
    }).samples.subarray(32);
  });

  async function toggle() {
    if (running) {
      engine.stop();
      running = false;
      step = -1;
      return;
    }
    const rom = app.patched;
    if (!rom) return;
    starting = true;
    try {
      // Any pre-rendered preview would fight the live node for the output.
      playback.stop();
      await engine.start(rom, app.tables, pad.tma, {
        tableSelect: pad.tableSelect,
        envelope: pad.envelope,
        repeat: pad.repeat,
      });
      running = true;
    } finally {
      starting = false;
    }
  }

  // Button state and pitch: tiny messages, sent on every press.
  $effect(() => {
    const params = {
      tableSelect: pad.tableSelect,
      envelope: pad.envelope,
      repeat: pad.repeat,
    };
    const tma = pad.tma;
    if (running) engine.update({ params, tma });
  });

  /**
   * Sample data: a fresh 32 KB copy each time, so it is kept in its own effect
   * and only re-sent when a re-encode or a table edit actually changes the ROM
   * — not on every d-pad press. Swapping the buffer under the running engine
   * is deliberate: it picks the new audio up within a frame with no gap, where
   * tearing the node down and rebuilding it would drop out audibly.
   */
  $effect(() => {
    const rom = app.patched ?? undefined;
    const tables = app.tables;
    if (running) engine.update({ rom, tables });
  });

  // Seed pitch from whatever the ROM boots with.
  $effect(() => {
    pad.tma = app.effectiveTma;
  });

  $effect(() => () => engine.stop());
</script>

<Panel step="4" title="Play">
  {#snippet actions()}
    <button class="primary" onclick={toggle} disabled={starting || !app.loaded}>
      {running ? 'Stop' : starting ? 'Starting…' : 'Play'}
    </button>
  {/snippet}

  <Gamepad />

  <div class="scope">
    <Waveform
      samples={render}
      height={120}
      divisions={SLICE_COUNT}
      activeDivision={running ? step : -1}
    />
  </div>

  <div class="readout">
    <div class="wide">
      <span class="lbl">Slice order</span>
      <span class="mono">{(app.tables[pad.tableSelect] ?? []).map((v) => HEX[v]).join(' ')}</span>
    </div>
    <div>
      <span class="lbl">Holding</span>
      <span class="mono">{pad.label}</span>
    </div>
    <div>
      <span class="lbl">Table</span>
      <span class="mono">{HEX[pad.tableSelect]} — {dpadLabel(pad.tableSelect)}</span>
    </div>
    <div>
      <span class="lbl">Pitch</span>
      <span class="mono">{sampleRateForTma(pad.tma).toFixed(0)} Hz</span>
    </div>
    <div>
      <span class="lbl">Decay</span>
      <span class="mono" class:accent={pad.envelope !== null}>
        {pad.envelope === null ? 'off' : `shift ${pad.envShift}`}
      </span>
    </div>
    <div>
      <span class="lbl">Repeat</span>
      <span class="mono" class:accent={pad.repeat !== null}>
        {pad.repeat === null ? 'off' : `${256 << (pad.repeatDepth - 1)} bytes`}
      </span>
    </div>
  </div>

  <p class="muted tip">
    Hold a direction to rearrange the slices. Hold <b>B</b> with Up/Down for the repeater,
    <b>A</b> with Left/Right for the decay, <b>Select</b> with Up/Down to retune.
  </p>
</Panel>

<style>
  .scope { margin-top: 14px; }
  .readout {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px;
    margin-top: 14px;
    padding: 10px 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .readout div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  /* The slice order is the point of the panel — never truncate it. */
  .readout .wide { grid-column: span 2; }
  .readout .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .readout .wide .mono { overflow: visible; white-space: normal; }
  .tip { margin: 12px 0 0; font-size: 12px; }
  b { color: var(--text); }
</style>
