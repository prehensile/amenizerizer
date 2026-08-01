<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { loadAudioBytes } from '../lib/audio/load';
  import * as playback from '../lib/playback';
  import {
    SORT_LABELS,
    fetchArchiveItem,
    fetchTrackBytes,
    formatBytes,
    formatSeconds,
    sortTracks,
    type ArchiveItem,
    type ArchiveTrack,
    type SortMode,
  } from '../lib/sources/archive';

  let { identifier }: { identifier: string } = $props();

  let item = $state<ArchiveItem | null>(null);
  let error = $state('');
  let loading = $state(false);
  let query = $state('');
  let sort = $state<SortMode>('title');
  let busyTrack = $state<string | null>(null);
  let selected = $state<string | null>(null);

  const visible = $derived.by(() => {
    if (!item) return [];
    const q = query.trim().toLowerCase();
    const matched = q
      ? item.tracks.filter((t) => t.title.toLowerCase().includes(q))
      : item.tracks;
    return sortTracks(matched, sort);
  });

  // Lazy: nothing is fetched until the tab is actually opened.
  $effect(() => {
    if (item || loading) return;
    load();
  });

  async function load() {
    loading = true;
    error = '';
    try {
      item = await fetchArchiveItem(identifier);
    } catch (e) {
      error =
        e instanceof Error
          ? `Could not reach archive.org — ${e.message}`
          : 'Could not reach archive.org.';
    } finally {
      loading = false;
    }
  }

  async function pick(track: ArchiveTrack) {
    busyTrack = track.name;
    error = '';
    try {
      const bytes = await fetchTrackBytes(track);
      const audio = await loadAudioBytes(bytes, `${track.title}.mp3`);
      app.loadSource(audio);
      selected = track.name;
      // Audition it straight away — one pass, not looped, so browsing a long
      // list does not leave something cycling underneath you.
      playback.play(audio.samples, audio.rate, { loop: false });
    } catch (e) {
      error = e instanceof Error ? e.message : `Could not load "${track.title}".`;
    } finally {
      busyTrack = null;
    }
  }
</script>

{#if loading}
  <p class="muted">Loading item…</p>
{:else if error && !item}
  <p class="err">{error}</p>
  <p><button onclick={load}>Retry</button></p>
{:else if item}
  <div class="head">
    <div>
      <strong>{item.title}</strong>
      {#if item.creator}<span class="muted"> · {item.creator}</span>{/if}
    </div>
    <div class="spacer"></div>
    <label class="sort">
      Sort
      <select bind:value={sort}>
        {#each Object.entries(SORT_LABELS) as [value, label]}
          <option {value}>{label}</option>
        {/each}
      </select>
    </label>
    <input
      type="search"
      placeholder="Filter {item.tracks.length} breaks…"
      bind:value={query}
      aria-label="Filter breaks"
    />
  </div>

  <ul class="list">
    {#each visible as track (track.name)}
      <li>
        <button
          onclick={() => pick(track)}
          disabled={busyTrack !== null}
          class:sel={selected === track.name}
        >
          <span class="name">{track.title}</span>
          <span class="meta mono">{formatSeconds(track.seconds)}</span>
          <span class="meta mono">{formatBytes(track.bytes)}</span>
          <span class="go">{busyTrack === track.name ? '…' : 'Load'}</span>
        </button>
      </li>
    {:else}
      <li class="empty muted">Nothing matches “{query}”.</li>
    {/each}
  </ul>

  {#if error}<p class="err">{error}</p>{/if}

  <p class="muted foot">
    Streamed from
    <a href={item.detailsUrl} target="_blank" rel="noopener noreferrer">archive.org</a>.
    Clips are short breaks — most are well under the 1.3 s the ROM holds, so the encoder will
    pad them unless you switch to <em>Fit</em>.
  </p>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 10px;
    font-size: 13px;
  }
  .spacer { flex: 1; }
  .head input { width: auto; min-width: 180px; }
  .sort { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .sort select { width: auto; }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .list li + li { border-top: 1px solid var(--line); }
  .list button {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-radius: 0;
    padding: 7px 12px;
  }
  .list button:hover:not(:disabled) { background: var(--panel-2); }
  .list button.sel { background: #18241d; }
  .list button.sel .name { color: var(--accent); }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { color: var(--muted); flex: none; width: 56px; text-align: right; }
  .go { color: var(--accent); font-size: 12px; flex: none; width: 34px; text-align: right; }
  .empty { padding: 12px; font-size: 13px; }
  .foot { margin: 10px 0 0; font-size: 12px; }
  a { color: var(--accent); }
</style>
