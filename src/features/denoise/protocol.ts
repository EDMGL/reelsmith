import type { DenoiseOptions } from './spectralGate';

export interface DenoiseRequest {
  type: 'run';
  id: number;
  blob: Blob;
  options: DenoiseOptions;
}

export type DenoiseMessage = DenoiseRequest | { type: 'cancel'; id: number };

export type DenoiseResponse =
  | { type: 'progress'; id: number; fraction: number; label: string }
  | { type: 'result'; id: number; blob: Blob; extension: string; hasVideo: boolean }
  | { type: 'error'; id: number; message: string; aborted?: boolean };
