/**
 * Types for the worklet's engine core. The implementation stays plain JS so
 * Vite can hand the file straight to `audioWorklet.addModule`.
 */

export interface EngineParams {
  tableSelect: number;
  envelope: number | null;
  repeat: number | null;
}

export interface Engine {
  rom: Uint8Array;
  tables: Uint8Array;
  params: EngineParams;
  ptr: number;
  counter: number;
  step: number;
  sliceStart: boolean;
  startFrame(): void;
  next(): number;
  syncPulse(): boolean;
}

export function createEngine(rom: Uint8Array, tables: Uint8Array): Engine;
export function nr50Gain(step: number, counter: number, envelope: number | null): number;
