/**
 * Font choices. The app is cross-origin isolated, so only system fonts (with
 * fallback stacks) and fonts imported from a local file are available.
 */
import { useSyncExternalStore } from 'react';

export interface FontChoice {
  label: string;
  /** CSS font-family value (a stack with fallbacks). */
  family: string;
}

export const SYSTEM_FONTS: readonly FontChoice[] = [
  { label: 'System Sans', family: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { label: 'Inter / UI', family: 'Inter, system-ui, sans-serif' },
  { label: 'Helvetica / Arial', family: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Verdana', family: 'Verdana, Geneva, "DejaVu Sans", sans-serif' },
  { label: 'Trebuchet', family: '"Trebuchet MS", "Lucida Grande", "Lucida Sans", sans-serif' },
  { label: 'Impact', family: 'Impact, Haettenschweiler, "Arial Narrow Bold", "Franklin Gothic Bold", sans-serif' },
  { label: 'Georgia', family: 'Georgia, "Times New Roman", Times, serif' },
  { label: 'Times', family: '"Times New Roman", Times, "Liberation Serif", serif' },
  { label: 'Palatino', family: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
  { label: 'Courier', family: '"Courier New", Courier, "Liberation Mono", monospace' },
  { label: 'Monospace', family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { label: 'Rounded', family: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif' },
  { label: 'Comic', family: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' },
];

// ---- user-imported fonts (runtime only; not persisted) ----

let imported: FontChoice[] = [];
const listeners = new Set<() => void>();

export function getImportedFonts(): readonly FontChoice[] {
  return imported;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useImportedFonts(): readonly FontChoice[] {
  return useSyncExternalStore(subscribe, getImportedFonts, getImportedFonts);
}

/** Family name derived from a font file name: "My-Font_Bold.ttf" -> "My Font Bold". */
export function familyFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  return base || 'Imported font';
}

/**
 * Loads a local font file with the FontFace API and adds it to `document.fonts`.
 * Returns the new choice. Note: imported fonts live for this session only.
 */
export async function importFontFile(file: File): Promise<FontChoice> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    throw new Error('This browser cannot load font files.');
  }
  const name = familyFromFileName(file.name);
  const face = new FontFace(name, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  const choice: FontChoice = { label: `${name} (imported)`, family: `"${name}", system-ui, sans-serif` };
  imported = [...imported.filter((f) => f.family !== choice.family), choice];
  listeners.forEach((l) => l());
  return choice;
}
