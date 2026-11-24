/**
 * Validation of template data from outside the code (imported `.json` files,
 * localStorage). Never trusts its input: checks every field, rejects with
 * readable messages, and returns a fresh object holding ONLY known fields.
 * Built-in templates go through it too (see the catalogue tests).
 */
import { ASPECT_PRESETS, type ClipShape, type MotionPreset, type TextStyle } from '../../core';
import { getEffectDefinition } from '../effects/definitions';
import { findTrack } from '../music/catalogue';
import {
  TEMPLATE_FORMAT_VERSION,
  type SlotCopy,
  type SlotFrame,
  type SlotLook,
  type TemplateAspect,
  type TemplateEffect,
  type TemplateFile,
  type TemplateMotion,
  type TemplateMusic,
  type TemplateSlot,
  type TemplateText,
  type VideoTemplate,
} from './types';

export const LIMITS = {
  duration: 600,
  slots: 200,
  texts: 100,
  copies: 4,
  effects: 12,
  tags: 12,
  layer: 32,
  name: 80,
  description: 400,
  text: 500,
  id: 80,
} as const;

export type ValidationResult = { ok: true; template: VideoTemplate } | { ok: false; errors: string[] };

const MOTION_PRESETS: readonly MotionPreset[] = ['none', 'zoom-in', 'zoom-out', 'punch-in', 'pan-left', 'pan-right'];
const ASPECTS = ASPECT_PRESETS.map((p) => p.id) as TemplateAspect[];
const EPS = 1e-3;

class Reader {
  errors: string[] = [];
  fail(path: string, msg: string): undefined {
    if (this.errors.length < 20) this.errors.push(`${path}: ${msg}`);
    return undefined;
  }
  obj(v: unknown, path: string): Record<string, unknown> | undefined {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return this.fail(path, 'must be an object');
    return v as Record<string, unknown>;
  }
  arr(v: unknown, path: string, max: number): unknown[] | undefined {
    if (!Array.isArray(v)) return this.fail(path, 'must be a list');
    if (v.length > max) return this.fail(path, `has ${v.length} entries (at most ${max})`);
    return v;
  }
  num(v: unknown, path: string, min: number, max: number): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v)) return this.fail(path, 'must be a number');
    if (v < min || v > max) return this.fail(path, `must be between ${min} and ${max} (got ${v})`);
    return v;
  }
  int(v: unknown, path: string, min: number, max: number): number | undefined {
    const n = this.num(v, path, min, max);
    if (n !== undefined && !Number.isInteger(n)) return this.fail(path, 'must be a whole number');
    return n;
  }
  str(v: unknown, path: string, max: number, opts: { empty?: boolean; pattern?: RegExp } = {}): string | undefined {
    if (typeof v !== 'string') return this.fail(path, 'must be text');
    if (!opts.empty && !v.trim()) return this.fail(path, 'must not be empty');
    if (v.length > max) return this.fail(path, `is too long (at most ${max} characters)`);
    if (opts.pattern && !opts.pattern.test(v)) return this.fail(path, 'contains characters that are not allowed');
    return v;
  }
  bool(v: unknown, path: string): boolean | undefined {
    if (typeof v !== 'boolean') return this.fail(path, 'must be true or false');
    return v;
  }
  oneOf<T extends string>(v: unknown, path: string, values: readonly T[]): T | undefined {
    if (typeof v !== 'string' || !values.includes(v as T)) return this.fail(path, `must be one of ${values.join(', ')}`);
    return v as T;
  }
  /** Optional field: undefined stays undefined, anything else is checked. */
  opt<T>(v: unknown, read: (v: unknown) => T | undefined): T | undefined {
    return v === undefined ? undefined : read(v);
  }
}

const ID = /^[A-Za-z0-9_.:-]+$/;
const COLOR = /^[#a-zA-Z0-9(),.\s%-]+$/;
const FONT = /^[^;{}<>\\]+$/;

/** Drops undefined values so validated objects only carry what was given. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function readFrame(r: Reader, v: unknown, path: string): SlotFrame | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const x = r.num(o.x, `${path}.x`, -1, 2);
  const y = r.num(o.y, `${path}.y`, -1, 2);
  const w = r.num(o.w, `${path}.w`, 0.01, 4);
  const h = r.num(o.h, `${path}.h`, 0.01, 4);
  return x === undefined || y === undefined || w === undefined || h === undefined ? undefined : { x, y, w, h };
}

function readMotion(r: Reader, v: unknown, path: string): TemplateMotion | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const preset = r.oneOf(o.preset, `${path}.preset`, MOTION_PRESETS);
  if (!preset) return undefined;
  return clean({
    preset,
    amount: r.opt(o.amount, (x) => r.num(x, `${path}.amount`, 1, 4)),
    duration: r.opt(o.duration, (x) => r.num(x, `${path}.duration`, 0, LIMITS.duration)),
    focusX: r.opt(o.focusX, (x) => r.num(x, `${path}.focusX`, 0, 1)),
    focusY: r.opt(o.focusY, (x) => r.num(x, `${path}.focusY`, 0, 1)),
  });
}

function readEffect(r: Reader, v: unknown, path: string): TemplateEffect | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const effectType = r.str(o.effectType, `${path}.effectType`, 40, { pattern: ID });
  if (effectType === undefined) return undefined;
  if (!getEffectDefinition(effectType)) return r.fail(`${path}.effectType`, `unknown effect “${effectType}”`);
  const p = r.obj(o.params ?? {}, `${path}.params`);
  if (!p) return undefined;
  const entries = Object.entries(p);
  if (entries.length > 16) return r.fail(`${path}.params`, 'has too many entries');
  const params: TemplateEffect['params'] = {};
  for (const [k, val] of entries) {
    if (!ID.test(k) || k.length > 40) return r.fail(`${path}.params`, `bad parameter name “${k.slice(0, 40)}”`);
    if (typeof val === 'number' && Number.isFinite(val) && Math.abs(val) <= 1e4) params[k] = val;
    else if (typeof val === 'boolean') params[k] = val;
    else if (typeof val === 'string' && val.length <= 64) params[k] = val;
    else return r.fail(`${path}.params.${k}`, 'must be a number, text or true/false');
  }
  return { effectType, params };
}

function readShape(r: Reader, v: unknown, path: string): ClipShape | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const kind = r.oneOf(o.kind, `${path}.kind`, ['rect', 'rounded', 'circle'] as const);
  const radius = r.num(o.radius, `${path}.radius`, 0, 0.5);
  const border = r.num(o.border, `${path}.border`, 0, 200);
  const borderColor = r.str(o.borderColor, `${path}.borderColor`, 64, { pattern: COLOR });
  if (kind === undefined || radius === undefined || border === undefined || borderColor === undefined) return undefined;
  return { kind, radius, border, borderColor };
}

function readLook(r: Reader, o: Record<string, unknown>, path: string): SlotLook | undefined {
  const fit = r.oneOf(o.fit, `${path}.fit`, ['cover', 'contain'] as const);
  const effects = r.opt(o.effects, (x) => r.arr(x, `${path}.effects`, LIMITS.effects)?.map((e, i) => readEffect(r, e, `${path}.effects[${i}]`)));
  if (fit === undefined || (effects && effects.some((e) => !e))) return undefined;
  return clean({
    fit,
    frame: r.opt(o.frame, (x) => readFrame(r, x, `${path}.frame`)),
    zoom: r.opt(o.zoom, (x) => r.num(x, `${path}.zoom`, 0.05, 10)),
    rotation: r.opt(o.rotation, (x) => r.num(x, `${path}.rotation`, -360, 360)),
    opacity: r.opt(o.opacity, (x) => r.num(x, `${path}.opacity`, 0, 1)),
    motion: r.opt(o.motion, (x) => readMotion(r, x, `${path}.motion`)),
    effects: effects as TemplateEffect[] | undefined,
    shape: r.opt(o.shape, (x) => readShape(r, x, `${path}.shape`)),
    fadeIn: r.opt(o.fadeIn, (x) => r.num(x, `${path}.fadeIn`, 0, 30)),
    fadeOut: r.opt(o.fadeOut, (x) => r.num(x, `${path}.fadeOut`, 0, 30)),
  });
}

function readCopy(r: Reader, v: unknown, path: string): SlotCopy | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const look = readLook(r, o, path);
  const layer = r.int(o.layer, `${path}.layer`, -LIMITS.layer, LIMITS.layer);
  return look && layer !== undefined ? { ...look, layer } : undefined;
}

function readSlot(r: Reader, v: unknown, path: string): TemplateSlot | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const id = r.str(o.id, `${path}.id`, LIMITS.id, { pattern: ID });
  const start = r.num(o.start, `${path}.start`, 0, LIMITS.duration);
  const duration = r.num(o.duration, `${path}.duration`, 0.1, LIMITS.duration);
  const accepts = r.oneOf(o.accepts, `${path}.accepts`, ['image', 'video', 'any'] as const);
  const layer = r.int(o.layer, `${path}.layer`, -LIMITS.layer, LIMITS.layer);
  const look = readLook(r, o, path);
  const copies = r.opt(o.copies, (x) => r.arr(x, `${path}.copies`, LIMITS.copies)?.map((c, i) => readCopy(r, c, `${path}.copies[${i}]`)));
  if (id === undefined || start === undefined || duration === undefined || accepts === undefined || layer === undefined || !look) return undefined;
  if (copies && copies.some((c) => !c)) return undefined;
  return clean({
    ...look,
    id,
    label: r.opt(o.label, (x) => r.str(x, `${path}.label`, 40)),
    start,
    duration,
    accepts,
    layer,
    volume: r.opt(o.volume, (x) => r.num(x, `${path}.volume`, 0, 4)),
    copies: copies as SlotCopy[] | undefined,
  });
}

function readStyle(r: Reader, v: unknown, path: string): Partial<TextStyle> | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const color = (x: unknown, p: string) => r.str(x, p, 64, { pattern: COLOR });
  const style = clean<Partial<TextStyle>>({
    fontFamily: r.opt(o.fontFamily, (x) => r.str(x, `${path}.fontFamily`, 200, { pattern: FONT })),
    fontSize: r.opt(o.fontSize, (x) => r.num(x, `${path}.fontSize`, 4, 1000)),
    fontWeight: r.opt(o.fontWeight, (x) => r.num(x, `${path}.fontWeight`, 100, 1000)),
    italic: r.opt(o.italic, (x) => r.bool(x, `${path}.italic`)),
    color: r.opt(o.color, (x) => color(x, `${path}.color`)),
    align: r.opt(o.align, (x) => r.oneOf(x, `${path}.align`, ['left', 'center', 'right'] as const)),
    lineHeight: r.opt(o.lineHeight, (x) => r.num(x, `${path}.lineHeight`, 0.5, 4)),
  });
  if (o.stroke !== undefined) {
    if (o.stroke === null) style.stroke = null;
    else {
      const s = r.obj(o.stroke, `${path}.stroke`);
      const c = s && color(s.color, `${path}.stroke.color`);
      const w = s && r.num(s.width, `${path}.stroke.width`, 0, 200);
      if (c !== undefined && w !== undefined) style.stroke = { color: c, width: w };
    }
  }
  if (o.shadow !== undefined) {
    if (o.shadow === null) style.shadow = null;
    else {
      const s = r.obj(o.shadow, `${path}.shadow`);
      if (s) {
        const c = color(s.color, `${path}.shadow.color`);
        const blur = r.num(s.blur, `${path}.shadow.blur`, 0, 200);
        const offsetX = r.num(s.offsetX, `${path}.shadow.offsetX`, -500, 500);
        const offsetY = r.num(s.offsetY, `${path}.shadow.offsetY`, -500, 500);
        if (c !== undefined && blur !== undefined && offsetX !== undefined && offsetY !== undefined) style.shadow = { color: c, blur, offsetX, offsetY };
      }
    }
  }
  if (o.background !== undefined) {
    if (o.background === null) style.background = null;
    else {
      const s = r.obj(o.background, `${path}.background`);
      if (s) {
        const c = color(s.color, `${path}.background.color`);
        const padding = r.num(s.padding, `${path}.background.padding`, 0, 400);
        const radius = r.num(s.radius, `${path}.background.radius`, 0, 400);
        if (c !== undefined && padding !== undefined && radius !== undefined) style.background = { color: c, padding, radius };
      }
    }
  }
  return style;
}

function readText(r: Reader, v: unknown, path: string): TemplateText | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const t = {
    id: r.str(o.id, `${path}.id`, LIMITS.id, { pattern: ID }),
    label: r.str(o.label, `${path}.label`, 60),
    text: r.str(o.text, `${path}.text`, LIMITS.text),
    start: r.num(o.start, `${path}.start`, 0, LIMITS.duration),
    duration: r.num(o.duration, `${path}.duration`, 0.1, LIMITS.duration),
    style: readStyle(r, o.style ?? {}, `${path}.style`),
    x: r.num(o.x, `${path}.x`, -1, 2),
    y: r.num(o.y, `${path}.y`, -1, 2),
    editable: r.bool(o.editable, `${path}.editable`),
  };
  if (Object.values(t).some((x) => x === undefined)) return undefined;
  const ok = t as { [K in keyof typeof t]-?: NonNullable<(typeof t)[K]> };
  return clean<TemplateText>({
    ...ok,
    scale: r.opt(o.scale, (x) => r.num(x, `${path}.scale`, 0.05, 10)),
    rotation: r.opt(o.rotation, (x) => r.num(x, `${path}.rotation`, -360, 360)),
    opacity: r.opt(o.opacity, (x) => r.num(x, `${path}.opacity`, 0, 1)),
    fadeIn: r.opt(o.fadeIn, (x) => r.num(x, `${path}.fadeIn`, 0, 30)),
    fadeOut: r.opt(o.fadeOut, (x) => r.num(x, `${path}.fadeOut`, 0, 30)),
  });
}

function readMusic(r: Reader, v: unknown, path: string): TemplateMusic | undefined {
  const o = r.obj(v, path);
  if (!o) return undefined;
  const trackId = r.str(o.trackId, `${path}.trackId`, LIMITS.id, { pattern: ID });
  if (trackId !== undefined && !findTrack(trackId)) return r.fail(`${path}.trackId`, `unknown music track “${trackId}”`);
  const seed = r.int(o.seed, `${path}.seed`, 0, 2 ** 31);
  const volume = r.num(o.volume, `${path}.volume`, 0, 1);
  if (trackId === undefined || seed === undefined || volume === undefined) return undefined;
  return clean({
    trackId,
    seed,
    volume,
    fadeIn: r.opt(o.fadeIn, (x) => r.num(x, `${path}.fadeIn`, 0, 30)),
    fadeOut: r.opt(o.fadeOut, (x) => r.num(x, `${path}.fadeOut`, 0, 30)),
  });
}

/** Checks a template object. On success returns a sanitized copy. */
export function validateTemplate(data: unknown): ValidationResult {
  const r = new Reader();
  const o = r.obj(data, 'template');
  if (!o) return { ok: false, errors: r.errors };
  if (o.formatVersion !== TEMPLATE_FORMAT_VERSION) {
    return { ok: false, errors: [`template.formatVersion: unsupported version ${JSON.stringify(o.formatVersion)?.slice(0, 20)} (expected ${TEMPLATE_FORMAT_VERSION})`] };
  }
  const id = r.str(o.id, 'template.id', LIMITS.id, { pattern: ID });
  const name = r.str(o.name, 'template.name', LIMITS.name);
  const category = r.str(o.category, 'template.category', 40);
  const description = r.str(o.description ?? '', 'template.description', LIMITS.description, { empty: true });
  const aspect = r.oneOf(o.aspect, 'template.aspect', ASPECTS);
  const duration = r.num(o.duration, 'template.duration', 0.1, LIMITS.duration);
  const slotList = r.arr(o.slots, 'template.slots', LIMITS.slots);
  const textList = r.arr(o.texts ?? [], 'template.texts', LIMITS.texts);
  const slots = slotList?.map((s, i) => readSlot(r, s, `slots[${i}]`));
  const texts = textList?.map((t, i) => readText(r, t, `texts[${i}]`));
  const music = r.opt(o.music, (x) => readMusic(r, x, 'template.music'));
  const tags = r.opt(o.tags, (x) => r.arr(x, 'template.tags', LIMITS.tags)?.map((t, i) => r.str(t, `template.tags[${i}]`, 30)));
  const featured = r.opt(o.featured, (x) => r.bool(x, 'template.featured'));
  if (slotList && slotList.length === 0) r.fail('template.slots', 'needs at least one media slot');
  if (r.errors.length) return { ok: false, errors: r.errors };

  const tpl = clean<VideoTemplate>({
    formatVersion: TEMPLATE_FORMAT_VERSION,
    id: id!,
    name: name!.trim(),
    category: category!.trim(),
    description: description!,
    aspect: aspect!,
    duration: duration!,
    slots: slots as TemplateSlot[],
    texts: texts as TemplateText[],
    music,
    tags: tags as string[] | undefined,
    featured,
  });

  // Cross-field rules.
  const ids = new Set<string>();
  for (const s of tpl.slots) {
    if (ids.has(s.id)) r.fail(`slot “${s.id}”`, 'id is used twice');
    ids.add(s.id);
    if (s.start + s.duration > tpl.duration + EPS) r.fail(`slot “${s.id}”`, `ends at ${(s.start + s.duration).toFixed(2)} s, after the template end (${tpl.duration} s)`);
  }
  const textIds = new Set<string>();
  for (const t of tpl.texts) {
    if (textIds.has(t.id)) r.fail(`text “${t.id}”`, 'id is used twice');
    textIds.add(t.id);
    if (t.start + t.duration > tpl.duration + EPS) r.fail(`text “${t.id}”`, `ends after the template end (${tpl.duration} s)`);
  }
  // Same layer = same track: no overlaps (copies count on their own layer).
  const byLayer = new Map<number, { start: number; end: number; id: string }[]>();
  for (const s of tpl.slots) {
    for (const layer of [s.layer, ...(s.copies ?? []).map((c) => c.layer)]) {
      const list = byLayer.get(layer) ?? [];
      list.push({ start: s.start, end: s.start + s.duration, id: s.id });
      byLayer.set(layer, list);
    }
  }
  for (const [layer, list] of byLayer) {
    list.sort((a, b) => a.start - b.start);
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.start < list[i - 1]!.end - EPS) r.fail(`layer ${layer}`, `slots “${list[i - 1]!.id}” and “${list[i]!.id}” overlap in time`);
    }
  }
  for (const s of tpl.slots) {
    if ((s.copies ?? []).some((c) => c.layer === s.layer)) r.fail(`slot “${s.id}”`, 'a copy cannot be on the same layer as its slot');
  }
  return r.errors.length ? { ok: false, errors: r.errors } : { ok: true, template: tpl };
}

/** Parses the text of an exported template file (or a bare template object). */
export function parseTemplateFile(text: string): ValidationResult {
  if (text.length > 2_000_000) return { ok: false, errors: ['The file is too large to be a template (over 2 MB).'] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && 'kind' in data) {
    const f = data as Partial<TemplateFile>;
    if (f.kind !== 'erdemcut-template') return { ok: false, errors: ['This JSON file is not an Erdemcut template.'] };
    return validateTemplate(f.template);
  }
  return validateTemplate(data);
}

export function templateToFile(template: VideoTemplate): TemplateFile {
  return { kind: 'erdemcut-template', formatVersion: TEMPLATE_FORMAT_VERSION, template };
}
