<script lang="ts">
  import Panel from './Panel.svelte';
  import DropZone from './DropZone.svelte';
  import Waveform from './Waveform.svelte';
  import ArchiveBrowser from './ArchiveBrowser.svelte';
  import { app } from '../lib/state.svelte';
  import { loadAudioFile } from '../lib/audio/load';
  import * as playback from '../lib/playback';

  const ARCHIVE_ID = 'bag-of-items-all-the-breaks-1-2-3';

  type Tab = 'upload' | 'archive';
  let tab = $state<Tab>('upload');

  const TABS: { id: Tab; label: string }[] = [
    { id: 'upload', label: 'Upload' },
    { id: 'archive', label: 'archive.org' },
  ];

  let error = $state('');
  let busy = $state(false);

  async function onFile(file: File) {
    error = '';
    busy = true;
    try {
      app.loadSource(await loadAudioFile(file));
    } catch (e) {
      error = `Could not decode ${file.name}. ${e instanceof Error ? e.message : ''}`;
    } finally {
      busy = false;
    }
  }

  const selectedSeconds = $derived(
    app.source ? (app.regionEnd - app.regionStart) / app.source.rate : 0,
  );

  function playSelection() {
    if (!app.source) return;
    playback.play(
      app.source.samples.slice(app.regionStart, app.regionEnd),
      app.source.rate,
      { loop: true },
    );
  }
</script>

<Panel step="1" title="Source audio" disabled={!app.loaded}>
  <div class="tabs" role="tablist">
    {#each TABS as t}
      <button
        role="tab"
        aria-selected={tab === t.id}
        class:sel={tab === t.id}
        onclick={() => (tab = t.id)}
      >{t.label}</button>
    {/each}
  </div>

  <div class="tabpanel">
    {#if tab === 'upload'}
      <DropZone
        accept="audio/*"
        label={busy ? 'Decoding…' : 'Drop a loop'}
        sublabel="one bar works best — it maps onto the 16 slices"
        onfile={onFile}
      />
    {:else}
      <ArchiveBrowser identifier={ARCHIVE_ID} />
    {/if}
  </div>

  {#if error}<p class="err">{error}</p>{/if}

  {#if app.source}
    <div class="loaded">
      <Waveform
        samples={app.source.samples}
        height={110}
        divisions={4}
        selectable
        bind:start={app.regionStart}
        bind:end={app.regionEnd}
      />

      <div class="row">
        <div class="meta mono">
          {app.source.name} &middot; {app.source.rate} Hz &middot;
          {app.source.channels === 1 ? 'mono' : `${app.source.channels}ch → mono`} &middot;
          {app.source.duration.toFixed(2)}s
        </div>
        <div class="spacer"></div>
        <div class="meta">
          Selection <span class="accent mono">{selectedSeconds.toFixed(3)}s</span>
          {#if app.fitMode === 'fit'}
            → stretched to <span class="mono">{app.loopSeconds.toFixed(3)}s</span>
            ({((selectedSeconds / app.loopSeconds) * 100).toFixed(1)}% speed)
          {/if}
        </div>
      </div>

      <p class="muted hint">
        Dividers quarter the current selection. Click one to narrow to it, again to go finer;
        shift-click to span several. Drag for a freehand selection, or an edge to nudge it.
        <b>Select all</b> starts over.
      </p>

      <div class="controls">
        <button onclick={playSelection}>Play selection</button>
        <button onclick={() => playback.stop()}>Stop</button>
        <div class="spacer"></div>
        <button onclick={() => { app.regionStart = 0; app.regionEnd = app.source!.samples.length; }}>
          Select all
        </button>
        <button onclick={() => (app.source = null)}>Clear</button>
      </div>
    </div>
  {/if}
</Panel>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--line);
    margin-bottom: 14px;
  }
  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 6px 6px 0 0;
    padding: 7px 14px;
    color: var(--muted);
    font-size: 13px;
  }
  .tabs button:hover { background: var(--panel-2); color: var(--text); }
  .tabs button.sel { color: var(--accent); border-bottom-color: var(--accent); }

  .tabpanel { min-height: 96px; }

  .loaded { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 10px;
  }
  .spacer { flex: 1; }
  .meta { font-size: 12px; color: var(--muted); }
  .hint { margin: 8px 0 0; font-size: 12px; }

  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
</style>
