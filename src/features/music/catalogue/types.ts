import type { SfxBuild } from '../synth/render';
import type { Arrangement } from '../synth/types';

export interface Variation {
  label: string;
  seed: number;
}

export interface MusicTrackDef {
  id: string;
  name: string;
  description: string;
  genre: string;
  moods: string[];
  bpm: number;
  /** Display key, e.g. 'A minor'. */
  key: string;
  variations: Variation[];
  /** Deterministic: same seed -> identical arrangement. */
  compose(seed: number): Arrangement;
}

export interface SfxDef {
  id: string;
  name: string;
  category: string;
  tags: string[];
  variations: Variation[];
  make(seed: number): SfxBuild;
}
