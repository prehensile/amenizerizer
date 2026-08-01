/** Main-thread handle for the real-time engine worklet. */

import { audioContext } from '../audio/load';

/**
 * Vite statically analyses `new URL(..., import.meta.url)` and emits the file
 * as an asset. A plain `?url` import of a .js file does not survive the
 * production build — the module gets folded into the bundle and addModule
 * would 404. The worklet must stay import-free for this to work.
 */
const workletUrl = new URL('./engine-processor.js', import.meta.url);

export interface LiveParams {
  tableSelect: number;
  /** $C092 shift, or null when A is not held. */
  envelope: number | null;
  /** $C0CD depth 1..3, or null when B is not held. */
  repeat: number | null;
}

let modulePromise: Promise<void> | null = null;

export class LiveEngine {
  private node: AudioWorkletNode | null = null;

  /** Called with the sequencer step 0..15 as it advances, for the playhead. */
  onStep: ((step: number) => void) | null = null;

  get running(): boolean {
    return this.node !== null;
  }

  async start(rom: Uint8Array, tables: number[][], tma: number, params: LiveParams) {
    const ctx = audioContext();
    await ctx.resume();
    modulePromise ??= ctx.audioWorklet.addModule(workletUrl);
    await modulePromise;

    this.stop();
    this.node = new AudioWorkletNode(ctx, 'amenizer-engine', {
      numberOfInputs: 0,
      outputChannelCount: [1],
      processorOptions: {
        rom: rom.slice().buffer,
        tables: flatten(tables).buffer,
        tma,
      },
    });
    this.node.port.onmessage = ({ data }) => {
      if (typeof data?.step === 'number') this.onStep?.(data.step);
    };
    this.node.connect(ctx.destination);
    this.update({ params });
  }

  update(msg: { rom?: Uint8Array; tables?: number[][]; tma?: number; params?: LiveParams }) {
    if (!this.node) return;
    this.node.port.postMessage({
      rom: msg.rom ? msg.rom.slice().buffer : undefined,
      tables: msg.tables ? flatten(msg.tables).buffer : undefined,
      tma: msg.tma,
      params: msg.params,
    });
  }

  stop() {
    if (!this.node) return;
    this.node.port.postMessage({ stop: true });
    this.node.disconnect();
    this.node = null;
  }
}

function flatten(tables: number[][]): Uint8Array {
  const out = new Uint8Array(256);
  for (let t = 0; t < 16; t++) {
    for (let s = 0; s < 16; s++) out[(t << 4) | s] = tables[t]?.[s] ?? s;
  }
  return out;
}
