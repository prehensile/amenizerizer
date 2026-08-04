<script lang="ts">
  import SourcePanel from './components/SourcePanel.svelte';
  import EncodePanel from './components/EncodePanel.svelte';
  import TablesPanel from './components/TablesPanel.svelte';
  import PlayPanel from './components/PlayPanel.svelte';
  import ExportPanel from './components/ExportPanel.svelte';
  import { app } from './lib/state.svelte';
  import romUrl from '../resources/amenizer.gb?url';

  let loadError = $state('');

  // The ROM ships with the app; there is nothing to choose, so just load it.
  $effect(() => {
    if (app.rom) return;
    fetch(romUrl)
      .then((r) => r.arrayBuffer())
      .then((b) => app.loadRom(new Uint8Array(b), 'amenizer.gb'))
      .catch((e) => (loadError = `Could not load amenizer.gb — ${e}`));
  });

  // Re-encode when anything upstream changes. Debounced because a long
  // selection in 'fit' mode is a few hundred milliseconds of sinc filtering.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Read every input so Svelte tracks them.
    void app.source;
    void app.regionStart;
    void app.regionEnd;
    void app.fitMode;
    void app.effectiveTma;
    void app.removeDcOffset;
    void app.highPassHz;
    void app.autoNormalize;
    void app.gainDb;
    void app.normalizeTarget;
    void app.drive;
    void app.fadeMs;
    void app.dither;
    void app.ditherAmount;

    clearTimeout(timer);
    timer = setTimeout(() => app.runEncode(), 90);
    return () => clearTimeout(timer);
  });
</script>

<main>
  <header class="top">
    <div>
      <h1>Amenizerizer</h1>
      <p class="muted">
        Inject a sample into
        <a
          href="https://blog.gg8.se/wordpress/2013/02/11/gameboy-project-week-6-can-i-have-an-a-men/"
          target="_blank"
          rel="noopener noreferrer"
        >nitro2k01's Amenizer</a>
        Game Boy sample masher. Source available
        <a
          href="https://github.com/prehensile/amenizerizer"
          target="_blank"
          rel="noopener noreferrer"
        >here</a>.
      </p>
    </div>
    {#if app.encoding}<span class="muted mono">encoding…</span>{/if}
  </header>

  {#if loadError}<p class="err">{loadError}</p>{/if}

  <div class="panels">
    <SourcePanel />
    <EncodePanel />
    <TablesPanel />
    <PlayPanel />
    <ExportPanel />
  </div>
</main>

<style>
  main {
    max-width: 1080px;
    margin: 0 auto;
    padding: 28px 20px 60px;
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 22px;
  }
  /* Fill the row so the header spans main's width and 'encoding…' lands right. */
  .top > div { flex: 1; }
  h1 { font-size: 22px; }
  .top p { margin: 6px 0 0; font-size: 13px; }
  .panels { display: flex; flex-direction: column; gap: 14px; }
</style>
