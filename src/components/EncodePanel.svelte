<script lang="ts">
  import { untrack } from 'svelte';
  import Panel from './Panel.svelte';
  import Waveform from './Waveform.svelte';
  import { app } from '../lib/state.svelte';
  import {
    SLICE_COUNT,
    TMA_MAX,
    TMA_MIN,
    bpmForTma,
    loopSecondsForTma,
    sampleRateForTma,
    tmaForBpm,
  } from '../lib/gb/amenizer';
  import * as playback from '../lib/playback';

  let bpmInput = $state(0);

  // Collapsed until there is something to encode, then opened once per upload.
  // Tracking the source identity means a manual collapse sticks, but loading
  // a different file opens it again.
  let open = $state(false);
  let openedFor: unknown = null;
  $effect(() => {
    if (app.source && app.source !== openedFor) {
      openedFor = app.source;
      open = true;
    }
  });

  // Keep the BPM box in step with TMA without fighting the user's typing.
  $effect(() => {
    bpmInput = Math.round(bpmForTma(app.effectiveTma) * 10) / 10;
  });

  function setBpm(v: number) {
    if (!Number.isFinite(v) || v <= 0) return;
    app.patchRate = true;
    app.tma = tmaForBpm(v).tma;
  }

  let resultPlaying = $state(false);

  /**
   * Identifies the sound this panel currently owns.
   *
   * `playback` fires `onEnded` whenever a source stops for *any* reason,
   * including being replaced. That is what we want when another panel steals
   * the voice — but not when we replace our own sound to follow a re-encode,
   * where the outgoing source's late `onEnded` would otherwise clear the flag
   * we just set. Comparing tokens tells the two cases apart.
   */
  let playToken = 0;

  function startResult() {
    const enc = app.encoded;
    if (!enc) return;
    const token = ++playToken;
    playback.play(enc.quantized, enc.sampleRate, {
      loop: true,
      onEnded: () => {
        if (token === playToken) resultPlaying = false;
      },
    });
    resultPlaying = true;
  }

  function toggleResult() {
    if (resultPlaying) {
      playToken++;
      playback.stop();
      resultPlaying = false;
    } else {
      startResult();
    }
  }

  /**
   * Follow the source selection. A new encode replaces whatever is looping so
   * you hear the region you just picked. Only `app.encoded` is tracked — the
   * playing flag is read untracked, or pressing Play would re-enter here and
   * immediately restart the sound it just began.
   */
  $effect(() => {
    const enc = app.encoded;
    untrack(() => {
      if (!resultPlaying) return;
      if (!enc) {
        playToken++;
        playback.stop();
        resultPlaying = false;
        return;
      }
      startResult();
    });
  });
</script>

<Panel step="2" title="Encode" collapsible bind:open disabled={!app.source}>
  {#snippet actions()}
    <button onclick={toggleResult} disabled={!app.encoded}>
      {resultPlaying ? 'Stop' : 'Play result'}
    </button>
  {/snippet}

  <div class="cols">
    <div class="controls">
      <div class="field">
        <label for="fit">Length</label>
        <select id="fit" bind:value={app.fitMode}>
          <option value="fit">Fit selection to one bar (changes pitch)</option>
          <option value="rate">Keep pitch, pad or truncate</option>
        </select>
      </div>

      <fieldset>
        <legend>Playback rate</legend>
        <label class="check">
          <input type="checkbox" bind:checked={app.patchRate} />
          Patch the ROM's boot rate (TMA at <code>0x016A</code>)
        </label>
        <div class="pair">
          <div class="field">
            <label for="tma">TMA</label>
            <input
              id="tma"
              type="number"
              min={TMA_MIN}
              max={TMA_MAX}
              disabled={!app.patchRate}
              bind:value={app.tma}
            />
          </div>
          <div class="field">
            <label for="bpm">Bar BPM</label>
            <input
              id="bpm"
              type="number"
              step="0.1"
              value={bpmInput}
              onchange={(e) => setBpm(e.currentTarget.valueAsNumber)}
            />
          </div>
        </div>
        <p class="readout mono">
          {sampleRateForTma(app.effectiveTma).toFixed(1)} Hz &middot;
          {loopSecondsForTma(app.effectiveTma).toFixed(4)}s per bar &middot;
          {(loopSecondsForTma(app.effectiveTma) / SLICE_COUNT * 1000).toFixed(1)} ms per slice
        </p>
      </fieldset>

      <fieldset>
        <legend>Level</legend>
        <label class="check">
          <input type="checkbox" bind:checked={app.autoNormalize} /> Normalise
        </label>
        {#if app.autoNormalize}
          <div class="field">
            <label for="tgt">Target peak {app.normalizeTarget.toFixed(2)}</label>
            <input id="tgt" type="range" min="0.3" max="1" step="0.01" bind:value={app.normalizeTarget} />
          </div>
        {:else}
          <div class="field">
            <label for="gain">Gain {app.gainDb.toFixed(1)} dB</label>
            <input id="gain" type="range" min="-24" max="24" step="0.5" bind:value={app.gainDb} />
          </div>
        {/if}
        <div class="field">
          <label for="drive">Soft clip drive {app.drive.toFixed(2)}×</label>
          <input id="drive" type="range" min="1" max="6" step="0.05" bind:value={app.drive} />
        </div>
      </fieldset>

      <fieldset>
        <legend>Conditioning</legend>
        <label class="check">
          <input type="checkbox" bind:checked={app.removeDcOffset} /> Remove DC offset
        </label>
        <div class="field">
          <label for="hp">High-pass {app.highPassHz === 0 ? 'off' : `${app.highPassHz} Hz`}</label>
          <input id="hp" type="range" min="0" max="400" step="10" bind:value={app.highPassHz} />
        </div>
        <div class="field">
          <label for="fade">Loop-seam fade {app.fadeMs.toFixed(1)} ms</label>
          <input id="fade" type="range" min="0" max="20" step="0.5" bind:value={app.fadeMs} />
        </div>
        <div class="field">
          <label for="dither">Dither</label>
          <select id="dither" bind:value={app.dither}>
            <option value="triangular">Triangular (default)</option>
            <option value="shaped">Noise-shaped</option>
            <option value="rectangular">Rectangular</option>
            <option value="none">None</option>
          </select>
        </div>
        {#if app.dither !== 'none'}
          <div class="field">
            <label for="dither-amt">Dither level {app.ditherAmount.toFixed(2)} LSB</label>
            <input
              id="dither-amt"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              bind:value={app.ditherAmount}
            />
          </div>
        {/if}
      </fieldset>

      <!-- Troubleshooting lives next to the controls it talks about, collapsed
           so it costs nothing until someone has the problem. -->
      <details class="help">
        <summary>Sounds noisy? Start here</summary>
        <p>
          The Game Boy has <strong>16 volume steps</strong>. Every noise problem comes from
          that. Think of it as drawing with 16 shades of grey: use only the middle four and
          it looks blocky and grainy — use all sixteen and it looks fine.
        </p>
        <p>
          There is a fixed amount of noise sitting under your sample and you cannot remove
          it. You get two moves: make the noise quieter, or make the sample louder so the
          noise matters less. <strong>The second works better.</strong>
        </p>
        <p class="lead">What the defaults already do</p>
        <ul>
          <li>
            <strong>High-pass at 80 Hz.</strong> Deep bass eats those 16 steps and you
            cannot hear it on a Game Boy speaker anyway.
          </li>
          <li><strong>Drive at 2×.</strong> The big one — it lifts the whole loop.</li>
          <li><strong>Dither level 0.35.</strong></li>
        </ul>
        <p>
          So the one thing left to you is to <strong>trim tight</strong> to the part you
          want looping. If it still sounds wrong, read on.
        </p>
        <p class="lead">Work out which noise you have</p>
        <p>
          <strong>A steady hiss, there even in the gaps</strong> — too much dither, or the
          sample is too quiet. Dither level <em>down</em>, drive <em>up</em>.
        </p>
        <p>
          <strong>A crunchy, gritty texture on cymbal tails and fades</strong> — the
          opposite: too little dither, so the 16 steps become audible as the sound decays.
          Dither level <em>up</em>, or try Noise-shaped.
        </p>
        <p>
          Chase one too hard and you summon the other. Dither around 0.3–0.5 with drive at
          2–3× is usually the sweet spot.
        </p>
        <p class="lead">Not worth reaching for</p>
        <ul>
          <li>
            <strong>Normalise</strong> only looks at the single loudest peak, so one stray
            snare stops it doing anything useful. Drive is what raises the overall level.
          </li>
          <li>
            <strong>Noise-shaped</strong> is not a "less noise" setting despite the name — it
            moves noise up into the treble. Good for grittiness, worse for hiss.
          </li>
          <li><strong>Loop-seam fade</strong> only fixes the click where the loop wraps.</li>
        </ul>
        <p>
          Short version: loud and slightly distorted beats quiet and clean. Sixteen steps is
          so few that you want to use every one of them.
        </p>
      </details>
    </div>

    <div class="preview">
      <Waveform samples={app.encoded?.quantized ?? null} height={130} divisions={SLICE_COUNT} />
      <p class="muted grid-note">16 slice boundaries — the engine can only cut on these lines.</p>

      {#if app.encoded}
        {@const s = app.encoded.stats}
        <div class="stats">
          <div><span class="lbl">Peak</span><span class="mono">{(20 * Math.log10(s.peak || 1e-9)).toFixed(1)} dB</span></div>
          <div><span class="lbl">RMS</span><span class="mono">{(20 * Math.log10(s.rms || 1e-9)).toFixed(1)} dB</span></div>
          <div><span class="lbl">Quant. noise</span><span class="mono">{s.noiseFloorDb.toFixed(1)} dB</span></div>
          <div>
            <span class="lbl">Clipped</span>
            <span class="mono" class:warn={s.clippedSamples > 0}>{s.clippedSamples}</span>
          </div>
        </div>
        {#if s.clippedSamples > 0}
          <p class="warn small">
            {s.clippedSamples} samples are hitting the rails. Lower the target peak or use the soft clipper.
          </p>
        {/if}
      {:else}
        <p class="muted">Load a source to see the encoded result.</p>
      {/if}
    </div>
  </div>
</Panel>

<style>
  .cols {
    display: grid;
    grid-template-columns: minmax(260px, 340px) 1fr;
    gap: 18px;
  }
  @media (max-width: 860px) {
    .cols { grid-template-columns: 1fr; }
  }
  .controls { display: flex; flex-direction: column; gap: 12px; }
  fieldset {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px 12px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  legend { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding: 0 4px; }
  .field { display: flex; flex-direction: column; gap: 3px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .check { display: flex; align-items: center; gap: 7px; color: var(--text); font-size: 13px; }
  .check input { accent-color: var(--accent); }
  .readout { color: var(--muted); margin: 0; }
  .grid-note { font-size: 12px; margin: 6px 0 12px; }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 10px;
    padding: 10px 12px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .stats div { display: flex; flex-direction: column; gap: 2px; }
  .small { font-size: 12px; }

  .help {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel-2);
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--muted);
  }
  .help summary {
    padding: 9px 12px;
    cursor: pointer;
    color: var(--text);
    font-size: 13px;
    /* Keep the native disclosure triangle: this is a plain text block, not a
       panel, and it should not read like the Panel caret. */
  }
  .help summary:hover { color: var(--accent); }
  .help > :not(summary) { margin: 0 12px 9px; }
  .help > p:first-of-type { margin-top: 2px; }
  .help strong { color: var(--text); font-weight: 600; }
  .help em { color: var(--accent); font-style: normal; font-weight: 600; }
  .help .lead {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 12px;
  }
  .help ul { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
</style>
