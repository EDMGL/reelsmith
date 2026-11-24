/**
 * "My templates": save the current timeline as a template, keep user
 * templates in localStorage (same mechanism as the autosaved project JSON,
 * see `core/persistence.ts`; templates hold no media, so no IndexedDB), and
 * export/import them as `.json` files (validated on the way in).
 */
import {
  ASPECT_PRESETS,
  containSize,
  createId,
  getSortedTracks,
  getTrackClips,
  type Clip,
  type ImageClip,
  type Project,
  type TextClip,
  type VideoClip,
} from '../../core';
import { MUSIC_TRACKS } from '../music/catalogue';
import { TEXT_REFERENCE_SIDE } from './builder';
import { TEMPLATE_FORMAT_VERSION, type TemplateAspect, type TemplateMusic, type TemplateSlot, type TemplateText, type VideoTemplate } from './types';
import { LIMITS, parseTemplateFile, templateToFile, validateTemplate, type ValidationResult } from './validate';

export const USER_TEMPLATES_STORAGE_KEY = 'erdemcut:templates:v1';
export const USER_CATEGORY = 'My templates';

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

function nearestAspect(project: Project): TemplateAspect {
  if (project.aspectPreset !== 'custom') return project.aspectPreset;
  const ratio = project.width / project.height;
  return [...ASPECT_PRESETS].sort((a, b) => Math.abs(a.width / a.height - ratio) - Math.abs(b.width / b.height - ratio))[0]!.id;
}

/** Catalogue music behind a generated music asset ("Name (B, 0:30).wav"), if any. */
function musicOf(project: Project, clip: Clip): TemplateMusic | null {
  if (clip.type !== 'audio') return null;
  const asset = project.assets[clip.assetId];
  if (!asset) return null;
  for (const def of MUSIC_TRACKS) {
    const m = new RegExp(`^${def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\((\\w+), `).exec(asset.name);
    const v = m && def.variations.find((x) => x.label === m[1]);
    if (v) return { trackId: def.id, seed: v.seed, volume: Math.min(1, clip.volume), ...(clip.fadeIn ? { fadeIn: clip.fadeIn } : {}), ...(clip.fadeOut ? { fadeOut: clip.fadeOut } : {}) };
  }
  return null;
}

export interface SaveAsTemplateResult {
  template: VideoTemplate | null;
  /** What could not be kept (shown to the user). */
  notes: string[];
  error?: string;
}

/**
 * Turns the timeline into a template: every video/image clip becomes a slot
 * (keeping timing, placement, motion, effects, shape, fades; its stacking
 * layer = its track's position), every text clip an editable text layer, and
 * catalogue music becomes the template's music reference.
 */
export function templateFromProject(project: Project, meta: { name: string; category?: string; description?: string }): SaveAsTemplateResult {
  const notes: string[] = [];
  const tracks = getSortedTracks(project).filter((t) => !t.hidden);
  const pictures: { clip: VideoClip | ImageClip; layer: number }[] = [];
  const texts: TextClip[] = [];
  let music: TemplateMusic | null = null;
  let droppedAudio = 0;
  let droppedSubs = 0;
  let layer = 0;
  for (const t of tracks) {
    const clips = getTrackClips(project, t.id);
    const pics = clips.filter((c): c is VideoClip | ImageClip => c.type === 'video' || c.type === 'image');
    if (pics.length) {
      for (const c of pics) pictures.push({ clip: c, layer });
      layer++;
    }
    for (const c of clips) {
      if (c.type === 'text') texts.push(c);
      else if (c.type === 'subtitle') droppedSubs++;
      else if (c.type === 'audio') {
        const m: TemplateMusic | null = !music ? musicOf(project, c) : null;
        if (m) music = m;
        else droppedAudio++;
      }
    }
  }
  if (pictures.length === 0) return { template: null, notes, error: 'The timeline has no video or photo clips to turn into slots.' };
  if (pictures.length > LIMITS.slots) return { template: null, notes, error: `Too many clips for one template (${pictures.length}, at most ${LIMITS.slots}).` };
  if (droppedAudio) notes.push(`${droppedAudio} audio clip(s) were not saved — templates only reference built-in music.`);
  if (droppedSubs) notes.push(`${droppedSubs} subtitle(s) were not saved.`);
  if (pictures.some((p) => p.clip.type === 'video' && (p.clip.speed !== 1 || p.clip.sourceIn > 0))) notes.push('Video trims and speed are not kept: each slot takes a fresh part of whatever media fills it.');

  const all = [...pictures.map((p) => p.clip), ...texts];
  const offset = Math.min(...all.map((c) => c.start));
  const W = project.width;
  const H = project.height;
  const slots: TemplateSlot[] = pictures
    .sort((a, b) => a.clip.start - b.clip.start || a.layer - b.layer)
    .map(({ clip, layer }, i) => {
      const asset = project.assets[clip.assetId];
      const tr = clip.transform;
      const c = asset ? containSize(asset.width, asset.height, W, H) : { width: 0, height: 0 };
      const cover = c.width > 0 && c.height > 0 ? Math.max(W / c.width, H / c.height) : 1;
      const centered = near(tr.x, 0.5) && near(tr.y, 0.5);
      const isCover = centered && near(tr.scale, cover);
      const slot: TemplateSlot = {
        id: `s${i + 1}`,
        start: r6(clip.start - offset),
        duration: r6(clip.duration),
        accepts: 'any',
        layer,
        fit: isCover ? 'cover' : 'contain',
        ...(!isCover && !centered ? { frame: { x: tr.x, y: tr.y, w: 1, h: 1 } } : {}),
        ...(!isCover && !near(tr.scale, 1, 1e-6) ? { zoom: tr.scale } : {}),
        ...(tr.rotation ? { rotation: tr.rotation } : {}),
        ...(tr.opacity !== 1 ? { opacity: tr.opacity } : {}),
        ...(clip.motion && clip.motion.preset !== 'none' ? { motion: { ...clip.motion } } : {}),
        ...(clip.effects.some((e) => e.enabled) ? { effects: clip.effects.filter((e) => e.enabled).map((e) => ({ effectType: e.effectType, params: { ...e.params } })) } : {}),
        ...(clip.shape ? { shape: { ...clip.shape } } : {}),
        ...(clip.fadeIn ? { fadeIn: clip.fadeIn } : {}),
        ...(clip.fadeOut ? { fadeOut: clip.fadeOut } : {}),
        ...(clip.type === 'video' ? { volume: clip.volume } : {}),
      };
      return slot;
    });
  const unit = Math.min(W, H) / TEXT_REFERENCE_SIDE;
  const tTexts: TemplateText[] = texts
    .sort((a, b) => a.start - b.start)
    .map((c, i) => ({
      id: `t${i + 1}`,
      label: c.name && c.name !== 'Text' ? c.name.slice(0, 60) : `Text ${i + 1}`,
      text: c.text.slice(0, LIMITS.text),
      start: r6(c.start - offset),
      duration: r6(c.duration),
      style: { ...c.style },
      x: c.transform.x,
      y: c.transform.y,
      ...(near(c.transform.scale / unit, 1, 1e-6) ? {} : { scale: r6(c.transform.scale / unit) }),
      ...(c.transform.rotation ? { rotation: c.transform.rotation } : {}),
      ...(c.transform.opacity !== 1 ? { opacity: c.transform.opacity } : {}),
      ...(c.fadeIn ? { fadeIn: c.fadeIn } : {}),
      ...(c.fadeOut ? { fadeOut: c.fadeOut } : {}),
      editable: true,
    }));
  const duration = r6(Math.max(...all.map((c) => c.start + c.duration)) - offset);
  const template: VideoTemplate = {
    formatVersion: TEMPLATE_FORMAT_VERSION,
    id: `user-${createId('tpl')}`.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, LIMITS.id),
    name: meta.name.trim().slice(0, LIMITS.name) || 'My template',
    category: USER_CATEGORY,
    description: (meta.description ?? `Saved from “${project.name}”.`).slice(0, LIMITS.description),
    aspect: nearestAspect(project),
    duration,
    slots,
    texts: tTexts.slice(0, LIMITS.texts),
    ...(music ? { music } : {}),
  };
  const v = validateTemplate(template);
  if (!v.ok) return { template: null, notes, error: `This timeline cannot be saved as a template: ${v.errors[0]}` };
  return { template: v.template, notes };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Loads the stored user templates; invalid entries are skipped (and reported). */
export function loadUserTemplates(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): { templates: VideoTemplate[]; skipped: number } {
  try {
    const raw = storage?.getItem(USER_TEMPLATES_STORAGE_KEY);
    if (!raw) return { templates: [], skipped: 0 };
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return { templates: [], skipped: 1 };
    const templates: VideoTemplate[] = [];
    let skipped = 0;
    for (const item of data) {
      const v = validateTemplate(item);
      if (v.ok) {
        const { featured: _f, ...t } = v.template;
        templates.push({ ...t, category: USER_CATEGORY });
      } else skipped++;
    }
    return { templates, skipped };
  } catch {
    return { templates: [], skipped: 1 };
  }
}

export function storeUserTemplates(list: readonly VideoTemplate[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): boolean {
  try {
    storage?.setItem(USER_TEMPLATES_STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn('[templates] could not store user templates', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export function templateFileName(t: Pick<VideoTemplate, 'name'>): string {
  const slug = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template';
  return `${slug}.template.json`;
}

export function templateJson(t: VideoTemplate): string {
  return JSON.stringify(templateToFile(t), null, 2);
}

/** Triggers a browser download of the template as JSON. */
export function downloadTemplate(t: VideoTemplate): void {
  const blob = new Blob([templateJson(t)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = templateFileName(t);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Reads an imported file. The template gets a fresh user id (so it can never
 * shadow a built-in or another user template) and lands in "My templates".
 */
export async function readTemplateFile(file: Pick<File, 'text' | 'size' | 'name'>): Promise<ValidationResult> {
  if (file.size > 2_000_000) return { ok: false, errors: ['The file is too large to be a template (over 2 MB).'] };
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, errors: ['The file could not be read.'] };
  }
  const v = parseTemplateFile(text);
  if (!v.ok) return v;
  const { featured: _f, ...rest } = v.template;
  return { ok: true, template: { ...rest, id: `user-${createId('tpl')}`.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, LIMITS.id), category: USER_CATEGORY } };
}
