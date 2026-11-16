import {
  createTextClip,
  getTrack,
  ops,
  trackAccepts,
  useEditorStore,
  type Id,
  type Project,
  type TextClip,
  type TextStyle,
} from '../../core';
import { SYSTEM_FONTS } from './fonts';

export interface TextPreset {
  id: string;
  label: string;
  text: string;
  style: Partial<TextStyle>;
}

const SANS = SYSTEM_FONTS[0]!.family;
const IMPACT = SYSTEM_FONTS.find((f) => f.label === 'Impact')!.family;
const SERIF = SYSTEM_FONTS.find((f) => f.label === 'Georgia')!.family;
const MONO = SYSTEM_FONTS.find((f) => f.label === 'Monospace')!.family;

/** Original Reelsmith text presets. */
export const TEXT_PRESETS: readonly TextPreset[] = [
  {
    id: 'headline',
    label: 'Headline',
    text: 'Headline',
    style: { fontFamily: SANS, fontSize: 132, fontWeight: 800, shadow: { color: 'rgba(0,0,0,0.55)', blur: 12, offsetX: 0, offsetY: 6 } },
  },
  {
    id: 'subheading',
    label: 'Subheading',
    text: 'A short subheading',
    style: { fontFamily: SANS, fontSize: 72, fontWeight: 600, color: '#e8ecf5', shadow: { color: 'rgba(0,0,0,0.45)', blur: 8, offsetX: 0, offsetY: 3 } },
  },
  {
    id: 'caption',
    label: 'Caption',
    text: 'Caption text goes here',
    style: { fontFamily: SANS, fontSize: 52, fontWeight: 500, shadow: null, stroke: { color: '#000000', width: 4 } },
  },
  {
    id: 'outlined',
    label: 'Outlined',
    text: 'OUTLINE',
    style: { fontFamily: IMPACT, fontSize: 140, fontWeight: 400, color: '#ffd23f', shadow: null, stroke: { color: '#111111', width: 10 } },
  },
  {
    id: 'boxed',
    label: 'Boxed',
    text: 'Boxed label',
    style: {
      fontFamily: SANS,
      fontSize: 64,
      fontWeight: 700,
      color: '#101114',
      shadow: null,
      background: { color: '#ffffff', padding: 24, radius: 16 },
    },
  },
  {
    id: 'glow',
    label: 'Glow',
    text: 'Glow',
    style: { fontFamily: SANS, fontSize: 120, fontWeight: 700, color: '#bff8ff', shadow: { color: '#27d3ff', blur: 28, offsetX: 0, offsetY: 0 } },
  },
  {
    id: 'serif-quote',
    label: 'Quote',
    text: '“A quote worth sharing”',
    style: { fontFamily: SERIF, fontSize: 76, fontWeight: 400, italic: true, shadow: { color: 'rgba(0,0,0,0.5)', blur: 6, offsetX: 0, offsetY: 2 } },
  },
  {
    id: 'terminal',
    label: 'Terminal',
    text: '> hello world_',
    style: {
      fontFamily: MONO,
      fontSize: 56,
      fontWeight: 500,
      color: '#4dff9a',
      shadow: null,
      align: 'left',
      background: { color: 'rgba(0,0,0,0.75)', padding: 20, radius: 6 },
    },
  },
];

export const PLAIN_PRESET: TextPreset = { id: 'plain', label: 'Text', text: 'Your text', style: {} };

/** A text clip built from a preset (trackId/start are placeholders, set on insertion). */
export function clipFromPreset(preset: TextPreset): TextClip {
  return createTextClip({ trackId: '', start: 0, text: preset.text, style: preset.style, name: preset.label });
}

/** Text-capable track to prefer: the selected track if it accepts text, is unlocked and is free at [start, start+dur). */
export function preferredTextTrack(project: Project, selectedTrackId: Id | null, start: number, duration: number): Id | undefined {
  if (!selectedTrackId) return undefined;
  const t = getTrack(project, selectedTrackId);
  if (!t || t.locked || !trackAccepts(t, 'text')) return undefined;
  return ops.hasOverlap(project, t.id, start, start + duration) ? undefined : t.id;
}

/**
 * Adds a preset at the playhead: on the selected text/overlay track if free,
 * else on the first free text track, else on a new text track. Returns the id.
 */
export function addTextAtPlayhead(preset: TextPreset = PLAIN_PRESET): Id | null {
  const s = useEditorStore.getState();
  const clip = clipFromPreset(preset);
  const start = s.currentTime;
  const trackId = preferredTextTrack(s.project, s.selectedTrackId, start, clip.duration);
  return (trackId && s.insertClip(clip, { trackId, start })) || s.insertClip(clip, { start });
}
