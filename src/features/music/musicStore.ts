/** UI state of the Music panel + the actions behind its buttons. */
import { create } from 'zustand';
import type { MusicTrackDef, SfxDef } from './catalogue';
import { getLoop, getMusic, getSfx } from './library';
import { stopPreview, togglePreview } from './preview';
import { addMusicToTimeline, addSfxToTimeline, DEFAULT_MUSIC_OPTIONS, DEFAULT_SFX_VOLUME, musicDragSeconds, type MusicAddOptions } from './timeline';

export type MusicTab = 'music' | 'sfx';

interface MusicUiState {
  tab: MusicTab;
  query: string;
  chip: string | null;
  /** Selected variation seed per item id. */
  seeds: Record<string, number>;
  options: MusicAddOptions;
  sfxVolume: number;
  /** Item id -> add progress 0..1 while rendering/adding. */
  adding: Record<string, number>;
  message: { kind: 'info' | 'error'; text: string } | null;
}

export const useMusicStore = create<MusicUiState>()(() => ({
  tab: 'music',
  query: '',
  chip: null,
  seeds: {},
  options: { ...DEFAULT_MUSIC_OPTIONS },
  sfxVolume: DEFAULT_SFX_VOLUME,
  adding: {},
  message: null,
}));

const set = (p: Partial<MusicUiState>) => useMusicStore.setState(p);
const get = () => useMusicStore.getState();

export const previewKey = (kind: 'music' | 'sfx', id: string, seed: number) => `${kind}:${id}:${seed}`;

export function seedOf(def: { id: string; variations: { seed: number }[] }): number {
  return get().seeds[def.id] ?? def.variations[0]!.seed;
}

/** Selects a variation (stops a running preview of the old one). */
export function setVariation(def: { id: string; variations: { seed: number }[] }, seed: number): void {
  stopPreview();
  set({ seeds: { ...get().seeds, [def.id]: seed } });
}

/** Reroll: cycles to the next variation. */
export function rerollVariation(def: { id: string; variations: { seed: number }[] }): void {
  const cur = seedOf(def);
  const i = def.variations.findIndex((v) => v.seed === cur);
  setVariation(def, def.variations[(i + 1) % def.variations.length]!.seed);
}

export function previewMusic(def: MusicTrackDef): Promise<void> {
  const seed = seedOf(def);
  return togglePreview(previewKey('music', def.id, seed), (p) => getLoop(def, seed, p));
}

export function previewSfx(def: SfxDef): Promise<void> {
  const seed = seedOf(def);
  return togglePreview(previewKey('sfx', def.id, seed), (p) => getSfx(def, seed, p));
}

function setAdding(id: string, v: number | null): void {
  const next = { ...get().adding };
  if (v === null) delete next[id];
  else next[id] = v;
  set({ adding: next });
}

export async function addMusic(def: MusicTrackDef): Promise<boolean> {
  if (get().adding[def.id] !== undefined) return false;
  setAdding(def.id, 0);
  const r = await addMusicToTimeline(def, seedOf(def), get().options, (f) => setAdding(def.id, f));
  setAdding(def.id, null);
  set({ message: { kind: r.ok ? 'info' : 'error', text: r.message } });
  return r.ok;
}

export async function addSfx(def: SfxDef): Promise<boolean> {
  if (get().adding[def.id] !== undefined) return false;
  setAdding(def.id, 0);
  const r = await addSfxToTimeline(def, seedOf(def), get().sfxVolume, (f) => setAdding(def.id, f));
  setAdding(def.id, null);
  set({ message: { kind: r.ok ? 'info' : 'error', text: r.message } });
  return r.ok;
}

/** Warms the cache so a drag can start synchronously. */
export function prepareDrag(item: { kind: 'music'; def: MusicTrackDef } | { kind: 'sfx'; def: SfxDef }): Promise<unknown> {
  const seed = seedOf(item.def);
  if (item.kind === 'sfx') return getSfx(item.def, seed).catch(() => undefined);
  return getMusic(item.def, seed, musicDragSeconds(get().options)).catch(() => undefined);
}

export function setOptions(patch: Partial<MusicAddOptions>): void {
  set({ options: { ...get().options, ...patch } });
}
