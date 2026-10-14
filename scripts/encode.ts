/**
 * Command-line encoder: a WAV loop -> packed 4-bit PCM, one 16 KiB bank per bar.
 *
 * The same encodeSample the web app runs, with its defaults, in 'fit' mode: the
 * whole file is squeezed into `bars` x 32768 samples. The TMA is picked so that
 * plays back at the file's own tempo (and so its own pitch), clamped to the
 * engine's 1..$E1; a loop slower than ~60 BPM per bar comes out faster.
 *
 *   vite-node scripts/encode.ts <in.wav> <out.bin> [--bars N]
 *
 * Writes the packed bytes to <out.bin> and the TMA, as a decimal number, to
 * stdout. amenizer-gbdk's Makefile builds a ROM from the pair.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { encodeSample } from '../src/lib/audio/encode';
import { toMono } from '../src/lib/audio/process';
import { TMA_MAX, TMA_MIN, TOTAL_SAMPLES } from '../src/lib/gb/amenizer';

const CPU_HZ = 4194304;

/** PCM (8/16/24/32-bit integer) or 32-bit float WAV -> channels of floats. */
function readWav(bytes: Buffer): { channels: Float32Array[]; rate: number } {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let format = 0, channelCount = 0, rate = 0, bits = 0;
  let data: Buffer | null = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, at + 8 + size);
    if (id === 'fmt ') {
      format = body.readUInt16LE(0);
      channelCount = body.readUInt16LE(2);
      rate = body.readUInt32LE(4);
      bits = body.readUInt16LE(14);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the first two bytes of the GUID.
      if (format === 0xfffe) format = body.readUInt16LE(24);
    } else if (id === 'data') {
      data = body;
    }
    at += 8 + size + (size & 1);
  }
  if (!data || !channelCount) throw new Error('no fmt or data chunk');
  if (!(format === 1 && [8, 16, 24, 32].includes(bits)) && !(format === 3 && bits === 32)) {
    throw new Error(`unsupported WAV format ${format}, ${bits}-bit`);
  }

  const width = bits / 8;
  const frames = Math.floor(data.length / (width * channelCount));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const o = (i * channelCount + c) * width;
      let v: number;
      if (format === 3) v = data.readFloatLE(o);
      else if (bits === 8) v = (data[o] - 128) / 128;
      else v = data.readIntLE(o, width) / 2 ** (bits - 1);
      channels[c][i] = v;
    }
  }
  return { channels, rate };
}

/** The TMA whose rate fits `seconds` into `samples`, i.e. plays it at its own tempo. */
function tmaForLoop(seconds: number, samples: number): number {
  const wanted = 256 - CPU_HZ / 2 / (samples / seconds);
  return Math.min(TMA_MAX, Math.max(TMA_MIN, Math.round(wanted)));
}

function main(): void {
  const args = process.argv.slice(2);
  let bars = 1;
  const barsAt = args.indexOf('--bars');
  if (barsAt >= 0) {
    bars = Number(args[barsAt + 1]);
    args.splice(barsAt, 2);
  }
  if (args.length !== 2 || !(bars === 1 || bars === 2)) {
    console.error('usage: encode.ts <in.wav> <out.bin> [--bars 1|2]');
    process.exit(2);
  }
  const [input, output] = args;

  const { channels, rate } = readWav(readFileSync(input));
  const mono = toMono(channels);
  const seconds = mono.length / rate;
  const tma = tmaForLoop(seconds, TOTAL_SAMPLES * bars);
  const { packed, sampleRate, stats } = encodeSample(mono, rate, { tma, bars, fitMode: 'fit' });

  writeFileSync(output, packed);
  console.error(
    `${input}: ${seconds.toFixed(3)} s as ${bars} bar(s) -> TMA $${tma.toString(16).toUpperCase()}, ` +
      `${sampleRate.toFixed(0)} Hz, ${((240 * bars) / ((TOTAL_SAMPLES * bars) / sampleRate)).toFixed(1)} BPM, ` +
      `${stats.clippedSamples} samples clipped`,
  );
  console.log(tma);
}

main();
