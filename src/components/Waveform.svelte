<script lang="ts">
  import { canSubdivide, selectDivision, type Range } from '../lib/selection';

  /** Min/max peak waveform on a canvas, with optional region dragging. */
  let {
    samples,
    height = 96,
    color = '#59d99a',
    /**
     * Selection handles. Deliberately NOT `color` — drawn in the waveform's own
     * green they disappear into it exactly where you need to grab them.
     */
    selectionColor = '#e7b64b',
    /** Draw N evenly spaced dividers — 16 gives the engine's slice grid. */
    divisions = 0,
    selectable = false,
    start = $bindable(0),
    end = $bindable(0),
    /** Highlight one division, e.g. the slice currently playing. */
    activeDivision = -1,
  }: {
    samples: Float32Array | null;
    height?: number;
    color?: string;
    selectionColor?: string;
    divisions?: number;
    selectable?: boolean;
    start?: number;
    end?: number;
    activeDivision?: number;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let width = $state(800);
  let dragging = $state<'start' | 'end' | 'new' | null>(null);

  /** Anchor sample for a fresh drag, so it can run either direction. */
  let dragAnchor = 0;
  /** Division a shift-click extends from; -1 until something is clicked. */
  let anchorDivision = -1;
  /**
   * Range the last plain click subdivided.
   *
   * Clicking narrows the selection to a quarter of itself, so by the time a
   * shift-click arrives the drawn divisions are 4x finer than the ones the
   * anchor refers to. Keeping the earlier range means shift still extends at
   * the scale you were looking at when you set the anchor.
   */
  let clickBasis: Range | null = null;
  /**
   * A press that has not yet moved far enough to count as a drag. Held here so
   * the same gesture can resolve into either a click or a selection drag.
   */
  let pending: { x: number; pos: number; shift: boolean } | null = null;
  const DRAG_THRESHOLD_PX = 4;

  function draw() {
    const el = canvas;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = width * dpr;
    el.height = height * dpr;
    const g = el.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);

    g.fillStyle = '#0d0f12';
    g.fillRect(0, 0, width, height);

    const mid = height / 2;

    // Where the divisions span. When there is a selection they subdivide it,
    // so the grid shows the beats of whatever you have picked; otherwise they
    // run the full width (the ROM's 16 fixed slices in the other panels).
    const hasSel = selectable && samples !== null && samples.length > 0;
    const dLeft = hasSel ? (start / samples!.length) * width : 0;
    const dRight = hasSel ? (end / samples!.length) * width : width;
    const dSpan = dRight - dLeft;

    // Only the active-division wash goes behind the waveform; the divider
    // lines are drawn last so they stay legible over waveform and dimming.
    if (activeDivision >= 0 && divisions > 0) {
      g.fillStyle = 'rgba(89,217,154,0.13)';
      g.fillRect(dLeft + (activeDivision / divisions) * dSpan, 0, dSpan / divisions, height);
    }

    g.strokeStyle = '#2c343e';
    g.beginPath();
    g.moveTo(0, mid + 0.5);
    g.lineTo(width, mid + 0.5);
    g.stroke();

    if (samples && samples.length > 0) {
      // Peak envelope: one min/max column per device pixel column.
      g.fillStyle = color;
      const per = samples.length / width;
      for (let x = 0; x < width; x++) {
        const from = Math.floor(x * per);
        const to = Math.min(samples.length, Math.max(from + 1, Math.floor((x + 1) * per)));
        let lo = 1;
        let hi = -1;
        for (let i = from; i < to; i++) {
          const v = samples[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const y0 = mid - hi * mid;
        const y1 = mid - lo * mid;
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
      }

      if (selectable) {
        const sx = (start / samples.length) * width;
        const ex = (end / samples.length) * width;
        g.fillStyle = 'rgba(13,15,18,0.68)';
        g.fillRect(0, 0, sx, height);
        g.fillRect(ex, 0, width - ex, height);
      }
    }

    // Dividers on top. i = 0 is skipped: it coincides with the range's edge.
    for (let i = 1; i < divisions; i++) {
      g.strokeStyle =
        divisions <= 4 || i % 4 === 0 ? 'rgba(196,214,232,0.34)' : 'rgba(196,214,232,0.15)';
      const x = Math.round(dLeft + (i / divisions) * dSpan) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, height);
      g.stroke();
    }

    // Handles last of all, so neither the waveform nor a divider can cut
    // through the one thing on the canvas you are meant to grab.
    if (selectable && samples && samples.length > 0) {
      const CAP_W = 7;
      const CAP_H = 6;
      // Nudged inside the canvas: at a full selection the handles land on x=0
      // and x=width, where half of a 2px stroke is clipped away and the pair
      // vanishes into the border — the default state, so the one most seen.
      const inset = (x: number) => Math.max(1, Math.min(width - 1, x));
      const sx = inset((start / samples.length) * width);
      const ex = inset((end / samples.length) * width);

      g.strokeStyle = selectionColor;
      g.fillStyle = selectionColor;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(sx, 0);
      g.lineTo(sx, height);
      g.moveTo(ex, 0);
      g.lineTo(ex, height);
      g.stroke();
      g.lineWidth = 1;

      // Caps point inwards from each end, so the pair reads as a bracket around
      // the selection rather than as two more grid lines.
      for (const [x, dir] of [
        [sx, 1],
        [ex, -1],
      ] as const) {
        g.fillRect(x, 0, dir * CAP_W, CAP_H);
        g.fillRect(x, height - CAP_H, dir * CAP_W, CAP_H);
      }
    }
  }

  $effect(() => {
    // Touch the reactive inputs so the effect re-runs when any of them change.
    void samples;
    void start;
    void end;
    void width;
    void activeDivision;
    void divisions;
    void color;
    void selectionColor;
    draw();
  });

  function posToSample(e: PointerEvent): number {
    const el = canvas;
    if (!el || !samples) return 0;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return Math.round(frac * samples.length);
  }

  function onPointerDown(e: PointerEvent) {
    if (!selectable || !samples) return;
    const el = canvas!;
    el.setPointerCapture(e.pointerId);
    const pos = posToSample(e);
    const tol = samples.length * 0.02;
    if (Math.abs(pos - start) < tol) {
      dragging = 'start';
    } else if (Math.abs(pos - end) < tol) {
      dragging = 'end';
    } else {
      // Do not commit yet — this may turn out to be a click on a division.
      pending = { x: e.clientX, pos, shift: e.shiftKey };
      dragging = null;
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!samples) return;

    if (pending && Math.abs(e.clientX - pending.x) > DRAG_THRESHOLD_PX) {
      dragging = 'new';
      dragAnchor = pending.pos;
      start = pending.pos;
      end = pending.pos;
      pending = null;
    }
    if (!dragging) return;

    const pos = posToSample(e);
    if (dragging === 'start') start = Math.min(pos, end - 1);
    else if (dragging === 'end') end = Math.max(pos, start + 1);
    else {
      // Freehand drags run either way from where the press landed.
      start = Math.min(dragAnchor, pos);
      end = Math.max(dragAnchor, pos) + 1;
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (pending) {
      const { pos, shift } = pending;
      pending = null;
      if (!samples) return;
      if (divisions > 0) {
        // Something outside the remembered range changed the selection (Select
        // all, a new file); that basis no longer describes anything on screen.
        if (clickBasis && (start < clickBasis.start || end > clickBasis.end)) clickBasis = null;

        // Shift extends within the range the anchor was set against; a plain
        // click subdivides whatever is selected right now.
        const basis = shift && clickBasis ? clickBasis : { start, end };
        if (canSubdivide(basis, divisions)) {
          if (!shift) clickBasis = basis;
          const sel = selectDivision(pos, basis, divisions, shift, anchorDivision);
          start = sel.start;
          end = sel.end;
          anchorDivision = sel.anchor;
        }
      } else {
        // No divisions to snap to, so a bare click just clears the selection.
        start = 0;
        end = samples.length;
      }
      return;
    }

    if (!dragging) return;
    dragging = null;
    // A drag too small to be deliberate resets rather than leaving a sliver.
    if (samples && end - start < samples.length * 0.001) {
      start = 0;
      end = samples.length;
    }
    // A freehand selection is not a division of anything, so forget the grid.
    anchorDivision = -1;
    clickBasis = null;
  }
</script>

<div class="wrap" bind:clientWidth={width}>
  <canvas
    bind:this={canvas}
    style:height="{height}px"
    class:selectable
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
  ></canvas>
</div>

<style>
  .wrap { width: 100%; }
  canvas {
    display: block;
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 6px;
    touch-action: none;
  }
  canvas.selectable { cursor: ew-resize; }
</style>
