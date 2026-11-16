import type { SignalAnalysis, SilenceParams } from './analysis';

export type AnalysisParams = Pick<SilenceParams, 'windowMs' | 'thresholdDb' | 'autoThreshold' | 'hysteresisDb'>;

export interface WorkerRequest {
  id: number;
  samples: Float32Array;
  sampleRate: number;
  params: AnalysisParams;
}

export type WorkerResponse =
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'result'; id: number; result: SignalAnalysis }
  | { type: 'error'; id: number; message: string };
