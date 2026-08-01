/** A single-voice looping player, so previews replace each other cleanly. */

import { audioContext } from './audio/load';

let current: AudioBufferSourceNode | null = null;

export function stop(): void {
  if (current) {
    try {
      current.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    current.disconnect();
    current = null;
  }
}

export function isPlaying(): boolean {
  return current !== null;
}

/** Play `samples` at `rate`, optionally looping. Resolves when playback ends. */
export function play(
  samples: Float32Array,
  rate: number,
  { loop = false, onEnded }: { loop?: boolean; onEnded?: () => void } = {},
): void {
  stop();
  const ctx = audioContext();
  void ctx.resume();

  const buffer = ctx.createBuffer(1, samples.length, Math.max(3000, Math.round(rate)));
  // copyToChannel wants a Float32Array backed by a plain ArrayBuffer; a subarray
  // view (as returned by the simulator) is not one, so copy through the channel.
  buffer.getChannelData(0).set(samples);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  src.connect(ctx.destination);
  src.onended = () => {
    if (current === src) current = null;
    onEnded?.();
  };
  src.start();
  current = src;
}
