/** Shared instrument presets and form helpers for the track recipes. */
import type { Section } from '../synth/sequence';
import type { InstrumentSpec } from '../synth/types';

export const KIT = {
  kick: { voice: 'kick', gain: 0, params: { pitch: 50, decay: 0.42, tone: 0.45 } },
  softKick: { voice: 'kick', gain: -2, params: { pitch: 55, decay: 0.3, tone: 0.2 } },
  snare: { voice: 'snare', gain: -5, reverb: 0.22, pan: 0.04 },
  softSnare: { voice: 'snare', gain: -8, reverb: 0.28, params: { tone: 0.2, decay: 0.14 } },
  clap: { voice: 'clap', gain: -2, reverb: 0.3, pan: -0.04 },
  hat: { voice: 'hat', gain: -6, pan: 0.22 },
  ohat: { voice: 'openhat', gain: -13, pan: 0.22 },
  shaker: { voice: 'shaker', gain: -13, pan: -0.3 },
  rim: { voice: 'rim', gain: -12, pan: -0.15, reverb: 0.2 },
  tom: { voice: 'tom', gain: -10, reverb: 0.25 },
  crash: { voice: 'crash', gain: -17, pan: -0.25, reverb: 0.15 },
} satisfies Record<string, InstrumentSpec>;

export const section = (name: string, bars: number, energy: number, parts: string[]): Section => ({ name, bars, energy, parts });

/** Picks one of several items by seed (stable per seed). */
export function choose<T>(seed: number, salt: number, items: readonly T[]): T {
  const x = Math.abs(Math.imul(seed ^ (salt * 2654435761), 1597334677)) >>> 0;
  return items[x % items.length]!;
}
