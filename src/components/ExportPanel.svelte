<script lang="ts">
  import Panel from './Panel.svelte';
  import { app } from '../lib/state.svelte';
  import { encodeWav } from '../lib/audio/wav';
  import { simulate } from '../lib/engine/simulate';
  import { pad } from '../lib/pad.svelte';
  import { md5Hex } from '../lib/gb/rom';
  import { GLOBAL_CHECKSUM, HEADER_CHECKSUM, globalChecksum, headerChecksum } from '../lib/gb/rom';

  function download(bytes: Uint8Array, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const patched = $derived(app.patched);

  const baseName = $derived(
    (app.source?.name ?? 'amenizer').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-'),
  );

  /** Cheap self-check: the file we hand over must validate under our own reader. */
  const verified = $derived.by(() => {
    if (!patched) return null;
    return {
      size: patched.length,
      md5: md5Hex(patched),
      headerOk: headerChecksum(patched) === patched[HEADER_CHECKSUM],
      globalOk:
        globalChecksum(patched) === ((patched[GLOBAL_CHECKSUM] << 8) | patched[GLOBAL_CHECKSUM + 1]),
    };
  });

  function saveRom() {
    if (patched) download(patched, `amenizer-${baseName}.gb`, 'application/octet-stream');
  }

  function saveEncodedWav() {
    if (!app.encoded) return;
    download(
      encodeWav(app.encoded.quantized, app.encoded.sampleRate),
      `amenizer-${baseName}-4bit.wav`,
      'audio/wav',
    );
  }

  function saveEnginewav() {
    if (!patched || !app.tables.length) return;
    const r = simulate(patched, app.tables, {
      tableSelect: pad.tableSelect,
      tma: pad.tma,
      bars: 2,
      envelope: pad.envelope,
      repeat: pad.repeat,
    });
    download(encodeWav(r.samples, r.sampleRate), `amenizer-${baseName}-engine.wav`, 'audio/wav');
  }

  function saveRomSample() {
    const s = app.romSample;
    if (s) download(encodeWav(s, app.sampleRate), 'amenizer-rom-sample.wav', 'audio/wav');
  }
</script>

<Panel step="5" title="Export" disabled={!app.loaded}>
  <div class="row">
    <button class="primary" onclick={saveRom} disabled={!patched}>Download .gb</button>
    <button onclick={saveEncodedWav} disabled={!app.encoded}>Encoded sample (WAV)</button>
    <button onclick={saveEnginewav} disabled={!patched}>Engine render (WAV)</button>
    <button onclick={saveRomSample} disabled={!app.rom}>Extract ROM's current sample</button>
  </div>

  {#if verified}
    <div class="stats">
      <div><span class="lbl">Size</span><span class="mono">{verified.size} bytes</span></div>
      <div><span class="lbl">Bytes changed</span><span class="mono">{app.changedBytes.toLocaleString()}</span></div>
      <div>
        <span class="lbl">Header checksum</span>
        <span class="mono" class:accent={verified.headerOk} class:err={!verified.headerOk}>
          {verified.headerOk ? 'valid' : 'BAD'}
        </span>
      </div>
      <div>
        <span class="lbl">Global checksum</span>
        <span class="mono" class:accent={verified.globalOk} class:err={!verified.globalOk}>
          {verified.globalOk ? 'valid' : 'BAD'}
        </span>
      </div>
      <div class="wide"><span class="lbl">MD5</span><span class="mono">{verified.md5}</span></div>
    </div>
  {/if}

  {#if !app.encoded}
    <p class="muted small">
      No source loaded, so the download keeps the ROM's existing sample and only applies any
      table or rate edits.
    </p>
  {/if}
</Panel>

<style>
  .row { display: flex; gap: 10px; flex-wrap: wrap; }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px;
    margin-top: 14px;
    padding: 10px 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .stats div { display: flex; flex-direction: column; gap: 2px; }
  .wide { grid-column: 1 / -1; }
  .small { font-size: 12px; margin: 12px 0 0; }
</style>
