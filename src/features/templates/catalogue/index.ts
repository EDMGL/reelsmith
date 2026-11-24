/** Built-in template catalogue: hand-made featured templates + recipe-generated ones. */
import type { TemplateAspect, VideoTemplate } from '../types';
import { FEATURED_TEMPLATES } from './featured';
import { generatedTemplates } from './generated';

export { FEATURED_TEMPLATES } from './featured';
export { RECIPES, generatedTemplates } from './generated';

let all: VideoTemplate[] | null = null;

export function builtinTemplates(): readonly VideoTemplate[] {
  all ??= [...FEATURED_TEMPLATES, ...generatedTemplates()];
  return all;
}

export function findBuiltinTemplate(id: string): VideoTemplate | undefined {
  return builtinTemplates().find((t) => t.id === id);
}

/** Categories in a stable display order (featured first, then by first appearance). */
export function templateCategories(list: readonly VideoTemplate[] = builtinTemplates()): string[] {
  return [...new Set(list.map((t) => t.category))];
}

export interface TemplateFilter {
  query?: string;
  /** Category name, 'Featured', or null for all. */
  category?: string | null;
  aspect?: TemplateAspect | null;
}

export const FEATURED_CATEGORY = 'Featured';

export function filterTemplates(list: readonly VideoTemplate[], f: TemplateFilter): VideoTemplate[] {
  const q = (f.query ?? '').trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  return list.filter((t) => {
    if (f.category === FEATURED_CATEGORY ? !t.featured : f.category && t.category !== f.category) return false;
    if (f.aspect && t.aspect !== f.aspect) return false;
    if (!words.length) return true;
    const hay = [t.name, t.category, t.description, t.aspect, ...(t.tags ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
