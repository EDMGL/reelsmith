/** One-click silence-removal styles (the raw parameters stay available under "Advanced"). */
import { DEFAULT_SILENCE_PARAMS, type SilenceParams } from './analysis';

export interface SilencePreset {
  id: string;
  label: string;
  hint: string;
  params: Pick<SilenceParams, 'autoThreshold' | 'minSilenceMs' | 'paddingMs' | 'minKeepMs'>;
}

export const SILENCE_PRESETS: readonly SilencePreset[] = [
  {
    id: 'natural',
    label: 'Natural',
    hint: 'Removes only clear pauses (0.7 s+) and keeps breathing room around speech.',
    params: { autoThreshold: true, minSilenceMs: 700, paddingMs: 150, minKeepMs: 0 },
  },
  {
    id: 'tight',
    label: 'Tight',
    hint: 'Removes pauses from 0.4 s with little padding: faster pacing that still sounds natural.',
    params: { autoThreshold: true, minSilenceMs: 400, paddingMs: 80, minKeepMs: 0 },
  },
  {
    id: 'jumpcut',
    label: 'Jump cut',
    hint: 'Reels/Shorts style: cuts almost every gap (0.25 s+) and drops tiny noises between words.',
    params: { autoThreshold: true, minSilenceMs: 250, paddingMs: 40, minKeepMs: 120 },
  },
];

export const DEFAULT_PRESET_ID = 'natural';

export function presetParams(id: string): SilenceParams {
  const p = SILENCE_PRESETS.find((x) => x.id === id) ?? SILENCE_PRESETS[0]!;
  return { ...DEFAULT_SILENCE_PARAMS, ...p.params };
}

/** The preset whose values `params` currently match, or null ("Custom"). */
export function matchPreset(params: SilenceParams): SilencePreset | null {
  return (
    SILENCE_PRESETS.find((p) =>
      (Object.keys(p.params) as (keyof SilencePreset['params'])[]).every((k) => params[k] === p.params[k]),
    ) ?? null
  );
}
