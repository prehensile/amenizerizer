/** Browser-side audio ingest. Kept apart from the encoder so that stays testable. */

import { toMono } from './process';

export interface LoadedAudio {
  samples: Float32Array;
  rate: number;
  name: string;
  channels: number;
  duration: number;
}

let ctx: AudioContext | null = null;

/** Lazily created; browsers refuse to start one before a user gesture. */
export function audioContext(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

export async function loadAudioFile(file: File): Promise<LoadedAudio> {
  return loadAudioBytes(await file.arrayBuffer(), file.name);
}

/** Same as {@link loadAudioFile} for audio that did not come from a file input. */
export async function loadAudioBytes(bytes: ArrayBuffer, name: string): Promise<LoadedAudio> {
  // decodeAudioData detaches the buffer, so hand it a copy we do not need back.
  const decoded = await audioContext().decodeAudioData(bytes);
  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    channels.push(decoded.getChannelData(c));
  }
  return {
    samples: toMono(channels),
    rate: decoded.sampleRate,
    name,
    channels: decoded.numberOfChannels,
    duration: decoded.duration,
  };
}
