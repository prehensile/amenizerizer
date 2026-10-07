/**
 * Real-time Amenizer engine, as an AudioWorklet.
 *
 * Same routine as simulate.ts, but stepped one sample at a time so held
 * buttons change what you hear immediately. Deliberately dependency-free:
 * Vite serves this file to `audioWorklet.addModule` as-is, so it must not
 * import anything.
 *
 * Button semantics live on the main thread (see pad.svelte.ts) — this only
 * receives the resulting parameters.
 */

const SAMPLE_BASE = 0x4000;
const SLICE_BYTES = 1024;
const FRAME_BYTES = 16;
const FRAME_SAMPLES = 32;

/**
 * Sync out, Pocket Operator / Volca style: two pulses per quarter note, i.e.
 * one on every even slice of the 16-slice bar. 15 ms is Korg's pulse width.
 */
const SYNC_PULSE_SECONDS = 0.015;

/**
 * The engine as a plain object so tests can drive it without an AudioContext.
 * `params` is mutated from outside between calls to `next()`.
 */
export function createEngine(rom, tables) {
  return {
    rom,
    tables,
    params: { tableSelect: 0, envelope: null, repeat: null },

    // Boot state: $C0C8 = $FC, $C0C9 = $0F, `ld hl,nn` operand = $4000.
    ptr: SAMPLE_BASE,
    counter: 0xfc,
    step: 0x0f,
    base: SAMPLE_BASE,
    gain: 1,
    frameIdx: FRAME_SAMPLES, // forces a frame load on the first sample
    /** The sequencer ticked during the last frame load. */
    ticked: false,
    /** The current frame is the first of a slice. */
    sliceStart: false,

    /** One frame boundary: 16 bytes to wave RAM, advance, then sequence. */
    startFrame() {
      this.base = this.ptr;
      // A tick only repoints `ptr`; the new slice starts sounding one frame
      // later, when that pointer becomes `base`.
      this.sliceStart = this.ticked;
      this.ticked = false;
      this.gain = nr50Gain(this.step, this.counter, this.params.envelope);

      const mask =
        this.params.repeat === null ? 0xff : ~(1 << (this.params.repeat - 1)) & 0xff;
      let p = this.ptr + FRAME_BYTES;
      p = (((p >> 8) & mask) << 8) | (p & 0xff);
      this.ptr = p & 0xffff;

      this.counter = (this.counter + 4) & 0xff;
      if (this.counter === 0) {
        this.step = (this.step + 1) & 0x0f;
        const slice = this.tables[((this.params.tableSelect & 0x0f) << 4) | this.step] & 0x0f;
        this.ptr = SAMPLE_BASE + slice * SLICE_BYTES;
        this.ticked = true;
      }
    },

    /** Next engine sample, in [-1, 1). */
    next() {
      if (this.frameIdx >= FRAME_SAMPLES) {
        this.startFrame();
        this.frameIdx = 0;
      }
      const i = this.frameIdx++;
      const b = this.rom[(this.base + (i >> 1)) & 0xffff];
      const nib = i & 1 ? b & 0x0f : b >> 4;
      return ((nib - 7.5) / 8) * this.gain;
    },

    /**
     * Whether the sample `next()` just returned should start a sync pulse: the
     * first sample of an even step's slice. Reads the sequencer, not the
     * pointer, so the repeater never disturbs the clock, and a retune moves
     * the pulses with the tempo.
     */
    syncPulse() {
      return this.frameIdx === 1 && this.sliceStart && (this.step & 1) === 0;
    },
  };
}

/** NR50: default $77, or a descending ramp built from HL = (step << 8) | counter. */
export function nr50Gain(step, counter, envelope) {
  if (envelope === null) return 1;
  const shifts = 4 - Math.max(0, Math.min(4, envelope));
  let hl = ((step << 8) | counter) & 0xffff;
  for (let i = 0; i < shifts; i++) hl = (hl << 1) & 0xffff;
  return ((~(hl >> 8) & 0x07) + 1) / 8;
}

// The processor half only exists inside an AudioWorkletGlobalScope.
if (typeof registerProcessor === 'function') {
  class AmenizerProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const { rom, tables, tma } = options.processorOptions;
      this.engine = createEngine(new Uint8Array(rom), new Uint8Array(tables));
      this.tma = tma;
      this.phase = 0;
      this.cur = 0;
      this.running = true;
      this.reportedStep = -1;
      this.sync = false;
      this.pulseLeft = 0;
      this.pulseLen = Math.round(SYNC_PULSE_SECONDS * sampleRate);

      this.port.onmessage = ({ data }) => {
        if (data.rom) this.engine.rom = new Uint8Array(data.rom);
        if (data.tables) this.engine.tables = new Uint8Array(data.tables);
        if (data.tma !== undefined) this.tma = data.tma;
        if (data.params) this.engine.params = data.params;
        if (data.sync !== undefined) this.sync = data.sync;
        if (data.stop) this.running = false;
      };
    }

    /**
     * Stereo out. Normally both channels carry the music; with sync on, the
     * left carries the clock pulse and the right the music, which is what a
     * Pocket Operator's sync-in modes expect on the tip and ring.
     */
    process(_inputs, outputs) {
      const [left, right] = outputs[0];
      if (!left || !right) return this.running;

      // Zero-order hold from the engine rate up to the context rate, which is
      // also what the hardware does before its own analogue filtering.
      const engineRate = 2097152 / (256 - this.tma);
      const inc = engineRate / sampleRate;

      for (let i = 0; i < right.length; i++) {
        right[i] = this.cur;
        if (this.sync) {
          left[i] = this.pulseLeft > 0 ? 1 : 0;
          if (this.pulseLeft > 0) this.pulseLeft--;
        } else {
          left[i] = this.cur;
        }
        this.phase += inc;
        while (this.phase >= 1) {
          this.phase -= 1;
          this.cur = this.engine.next();
          if (this.engine.syncPulse()) this.pulseLeft = this.pulseLen;
        }
      }

      // Drive the playhead. Once per slice, so ~12 messages a second.
      if (this.engine.step !== this.reportedStep) {
        this.reportedStep = this.engine.step;
        this.port.postMessage({ step: this.engine.step });
      }
      return this.running;
    }
  }

  registerProcessor('amenizer-engine', AmenizerProcessor);
}
