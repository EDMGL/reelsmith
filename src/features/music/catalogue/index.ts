import { SOUND_EFFECTS } from './sfx';
import { MUSIC_TRACKS } from './tracks';
import type { MusicTrackDef, SfxDef } from './types';

export { MUSIC_TRACKS, SOUND_EFFECTS };
export type { MusicTrackDef, SfxDef, Variation } from './types';

export type LibraryItem = { kind: 'music'; def: MusicTrackDef } | { kind: 'sfx'; def: SfxDef };

export function findTrack(id: string): MusicTrackDef | undefined {
  return MUSIC_TRACKS.find((t) => t.id === id);
}

export function findSfx(id: string): SfxDef | undefined {
  return SOUND_EFFECTS.find((t) => t.id === id);
}

/** Filter chips for music: genres first, then the most common moods. */
export function musicChips(): string[] {
  const genres = MUSIC_TRACKS.map((t) => t.genre);
  const counts = new Map<string, number>();
  for (const t of MUSIC_TRACKS) for (const m of t.moods) counts.set(m, (counts.get(m) ?? 0) + 1);
  const moods = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m);
  return [...new Set([...genres, ...moods])];
}

export function sfxChips(): string[] {
  return [...new Set(SOUND_EFFECTS.map((s) => s.category))];
}

const norm = (s: string) => s.toLowerCase();

export function filterTracks(query: string, chip: string | null): MusicTrackDef[] {
  const q = norm(query.trim());
  return MUSIC_TRACKS.filter((t) => {
    if (chip && t.genre !== chip && !t.moods.includes(chip)) return false;
    if (!q) return true;
    return [t.name, t.genre, t.description, t.key, ...t.moods].some((x) => norm(x).includes(q));
  });
}

export function filterSfx(query: string, chip: string | null): SfxDef[] {
  const q = norm(query.trim());
  return SOUND_EFFECTS.filter((s) => {
    if (chip && s.category !== chip) return false;
    if (!q) return true;
    return [s.name, s.category, ...s.tags].some((x) => norm(x).includes(q));
  });
}
