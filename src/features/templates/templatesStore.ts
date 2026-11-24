/** UI state of the Templates panel and the actions behind its buttons. */
import { create } from 'zustand';
import { useEditorStore, type Id, type MediaAsset } from '../../core';
import { importFile } from '../media/importMedia';
import { applyTemplate, isTimelineEmpty, type ApplyMode } from './apply';
import { autoAssign } from './builder';
import { builtinTemplates, findBuiltinTemplate } from './catalogue';
import type { TemplateAspect, VideoTemplate } from './types';
import { downloadTemplate, loadUserTemplates, readTemplateFile, storeUserTemplates, templateFromProject } from './userTemplates';

export type Message = { kind: 'info' | 'error' | 'warning' | 'success'; text: string; details?: string[] };

interface TemplatesUi {
  view: 'gallery' | 'fill';
  query: string;
  /** Category, 'Featured', 'My templates' or null (all). */
  category: string | null;
  aspect: TemplateAspect | null;
  selectedId: string | null;
  assignments: Record<string, Id | undefined>;
  texts: Record<string, string>;
  /** Slot picked for swap / library fill. */
  activeSlot: string | null;
  importing: { done: number; total: number } | null;
  applying: { label: string; fraction: number } | null;
  /** Message of the gallery view. */
  galleryMessage: Message | null;
  /** Message of the fill view. */
  message: Message | null;
  mode: ApplyMode;
  switchAspect: boolean;
  userTemplates: VideoTemplate[];
}

const loaded = loadUserTemplates();

export const useTemplatesStore = create<TemplatesUi>()(() => ({
  view: 'gallery',
  query: '',
  category: null,
  aspect: null,
  selectedId: null,
  assignments: {},
  texts: {},
  activeSlot: null,
  importing: null,
  applying: null,
  galleryMessage: loaded.skipped ? { kind: 'warning', text: `${loaded.skipped} saved template(s) could not be read and were skipped.` } : null,
  message: null,
  mode: 'append',
  switchAspect: false,
  userTemplates: loaded.templates,
}));

const set = (p: Partial<TemplatesUi>) => useTemplatesStore.setState(p);
const get = () => useTemplatesStore.getState();
const editor = () => useEditorStore.getState();

export function findTemplate(id: string | null): VideoTemplate | undefined {
  if (!id) return undefined;
  return findBuiltinTemplate(id) ?? get().userTemplates.find((t) => t.id === id);
}

export function allTemplates(): VideoTemplate[] {
  return [...builtinTemplates(), ...get().userTemplates];
}

export function selectedTemplate(): VideoTemplate | undefined {
  return findTemplate(get().selectedId);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export function openTemplate(id: string): void {
  const t = findTemplate(id);
  if (!t) return;
  const sameAspect = editor().project.aspectPreset === t.aspect;
  set({
    view: 'fill',
    selectedId: id,
    assignments: {},
    texts: Object.fromEntries(t.texts.filter((x) => x.editable).map((x) => [x.id, x.text])),
    activeSlot: null,
    message: null,
    mode: isTimelineEmpty() ? 'replace' : 'append',
    switchAspect: !sameAspect && isTimelineEmpty(),
  });
}

export function backToGallery(): void {
  set({ view: 'gallery', activeSlot: null, message: null });
}

// ---------------------------------------------------------------------------
// Filling slots
// ---------------------------------------------------------------------------

const isPicture = (a: MediaAsset | undefined): a is MediaAsset => !!a && a.status === 'ready' && (a.kind === 'image' || a.kind === 'video');

function slotCount(): number {
  return selectedTemplate()?.slots.length ?? 0;
}

/** Imports files (media library import path) and assigns them to empty slots in order. */
export async function importIntoSlots(files: FileList | File[] | null): Promise<void> {
  const t = selectedTemplate();
  if (!t || !files || files.length === 0 || get().importing) return;
  const list = Array.from(files);
  set({ importing: { done: 0, total: list.length }, message: null });
  const imported: Id[] = [];
  const failed: string[] = [];
  for (const f of list) {
    try {
      const id = await importFile(f);
      if (id) imported.push(id);
      else failed.push(f.name);
    } catch {
      failed.push(f.name);
    }
    set({ importing: { done: imported.length + failed.length, total: list.length } });
  }
  const assets = imported.map((id) => editor().project.assets[id]).filter(isPicture);
  const audio = imported.length - assets.length;
  const r = autoAssign(t, get().assignments, assets);
  const details: string[] = [];
  if (failed.length) details.push(`Could not import: ${failed.join(', ')}`);
  if (audio) details.push(`${audio} audio file(s) went to the media library (slots take photos and videos).`);
  const extra = r.unused.length;
  if (extra > 0) details.push(`${extra} file(s) more than empty slots: they are in your media library but not used (this template has ${slotCount()} slots).`);
  set({
    importing: null,
    assignments: r.assignments,
    message:
      failed.length && assets.length === 0
        ? { kind: 'error', text: 'None of the files could be imported. Use photos (JPG, PNG, WebP…) or videos (MP4, MOV, WebM…).', details }
        : { kind: details.length ? 'warning' : 'success', text: `${assets.length - extra} file(s) placed into slots.`, details },
  });
}

/** Library asset → the active slot, else the next empty slot. */
export function assignFromLibrary(assetId: Id): void {
  const t = selectedTemplate();
  const a = editor().project.assets[assetId];
  if (!t || !isPicture(a)) return;
  const { activeSlot, assignments } = get();
  const target = activeSlot ?? t.slots.find((s) => !assignments[s.id])?.id;
  if (!target) {
    set({ message: { kind: 'info', text: 'All slots are filled. Select a slot first to replace its media.' } });
    return;
  }
  const next = { ...assignments, [target]: assetId };
  const idx = t.slots.findIndex((s) => s.id === target);
  // Move the selection on so repeated clicks fill slots one after another.
  const following = activeSlot ? (t.slots.slice(idx + 1).find((s) => !next[s.id])?.id ?? null) : null;
  set({ assignments: next, activeSlot: following, message: null });
}

/** Fills empty slots with every picture in the media library (in library order). */
export function fillFromLibrary(): void {
  const t = selectedTemplate();
  if (!t) return;
  const assets = Object.values(editor().project.assets).filter(isPicture);
  if (assets.length === 0) {
    set({ message: { kind: 'info', text: 'Your media library has no photos or videos yet.' } });
    return;
  }
  const used = new Set(Object.values(get().assignments));
  const r = autoAssign(t, get().assignments, assets.filter((a) => !used.has(a.id)));
  set({
    assignments: r.assignments,
    message: r.unused.length ? { kind: 'info', text: `${r.unused.length} library item(s) did not fit: all slots are filled.` } : null,
  });
}

/** Click on a slot: select it, or swap it with the selected one. */
export function clickSlot(slotId: string): void {
  const { activeSlot, assignments } = get();
  if (!activeSlot) return set({ activeSlot: slotId });
  if (activeSlot === slotId) return set({ activeSlot: null });
  set({ assignments: { ...assignments, [activeSlot]: assignments[slotId], [slotId]: assignments[activeSlot] }, activeSlot: null });
}

export function clearSlot(slotId: string): void {
  set({ assignments: { ...get().assignments, [slotId]: undefined }, activeSlot: get().activeSlot === slotId ? null : get().activeSlot });
}

export function clearAllSlots(): void {
  set({ assignments: {}, activeSlot: null, message: null });
}

/** Moves a slot's media one slot earlier/later (swapping with the neighbour). */
export function moveSlot(slotId: string, dir: -1 | 1): void {
  const t = selectedTemplate();
  if (!t) return;
  const i = t.slots.findIndex((s) => s.id === slotId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= t.slots.length) return;
  const other = t.slots[j]!.id;
  const a = get().assignments;
  set({ assignments: { ...a, [slotId]: a[other], [other]: a[slotId] } });
}

export function setTextValue(id: string, value: string): void {
  set({ texts: { ...get().texts, [id]: value } });
}

export function setApplyOptions(p: Partial<Pick<TemplatesUi, 'mode' | 'switchAspect'>>): void {
  set(p);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export async function applySelected(): Promise<boolean> {
  const t = selectedTemplate();
  if (!t || get().applying) return false;
  set({ applying: { label: 'Preparing', fraction: 0 }, message: null });
  const s = get();
  const r = await applyTemplate(t, s.assignments, s.texts, {
    mode: s.mode,
    switchAspect: s.switchAspect,
    onProgress: (label, fraction) => set({ applying: { label, fraction } }),
  });
  set({
    applying: null,
    message: { kind: r.ok ? (r.warnings.length ? 'warning' : 'success') : 'error', text: r.message, details: r.warnings },
    ...(r.ok ? { mode: 'append' as const, switchAspect: false } : {}),
  });
  return r.ok;
}

// ---------------------------------------------------------------------------
// My templates
// ---------------------------------------------------------------------------

function persist(list: VideoTemplate[]): boolean {
  set({ userTemplates: list });
  return storeUserTemplates(list);
}

export function saveTimelineAsTemplate(name: string): boolean {
  const r = templateFromProject(editor().project, { name });
  if (!r.template) {
    set({ galleryMessage: { kind: 'error', text: r.error ?? 'Could not save the template.' } });
    return false;
  }
  const ok = persist([...get().userTemplates, r.template]);
  set({
    category: 'My templates',
    galleryMessage: ok
      ? { kind: r.notes.length ? 'warning' : 'success', text: `Saved “${r.template.name}” with ${r.template.slots.length} slot(s) to My templates.`, details: r.notes }
      : { kind: 'error', text: 'The template was created but could not be stored (browser storage is full or blocked).' },
  });
  return ok;
}

export function deleteUserTemplate(id: string): void {
  persist(get().userTemplates.filter((t) => t.id !== id));
  if (get().selectedId === id) backToGallery();
}

export function exportTemplate(t: VideoTemplate): void {
  try {
    downloadTemplate(t);
  } catch (e) {
    set({ galleryMessage: { kind: 'error', text: `Could not export: ${e instanceof Error ? e.message : String(e)}` } });
  }
}

export async function importTemplateFile(file: File | undefined): Promise<boolean> {
  if (!file) return false;
  const r = await readTemplateFile(file);
  if (!r.ok) {
    set({ galleryMessage: { kind: 'error', text: `“${file.name}” is not a usable template.`, details: r.errors.slice(0, 6) } });
    return false;
  }
  const ok = persist([...get().userTemplates, r.template]);
  set({ category: 'My templates', galleryMessage: ok ? { kind: 'success', text: `Imported “${r.template.name}” into My templates.` } : { kind: 'error', text: 'Could not store the imported template.' } });
  return ok;
}

/** Test helper. */
export function resetTemplatesUi(): void {
  set({ view: 'gallery', query: '', category: null, aspect: null, selectedId: null, assignments: {}, texts: {}, activeSlot: null, importing: null, applying: null, galleryMessage: null, message: null, userTemplates: [] });
}
