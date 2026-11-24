/**
 * Original building blocks the built-in templates are composed from:
 * layouts (where pictures go), rhythms (cut lengths in BEATS of the chosen
 * music track), looks (effect stacks), motion patterns, transitions and text
 * treatments. `composeTemplate` combines one choice of each into a template.
 *
 * Cut points come from the music catalogue's real tempo (`MusicTrackDef.bpm`;
 * every arrangement is in 4/4 and starts on a downbeat at 0 s — checked by the
 * catalogue tests against `compose(seed)`), so cuts land on beats.
 */
import type { ClipShape, TextStyle } from '../../core';
import { FILTER_PRESETS } from '../effects/definitions';
import { findTrack } from '../music/catalogue';
import { SYSTEM_FONTS } from '../text/fonts';
import {
  TEMPLATE_FORMAT_VERSION,
  type SlotAccepts,
  type SlotFrame,
  type TemplateAspect,
  type TemplateEffect,
  type TemplateMotion,
  type TemplateSlot,
  type TemplateText,
  type VideoTemplate,
} from './types';

export const BEATS_PER_BAR = 4;

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Seconds per beat of a catalogue track (its arrangement tempo). */
export function beatSeconds(trackId: string): number {
  const def = findTrack(trackId);
  if (!def) throw new Error(`Unknown music track ${trackId}`);
  return 60 / def.bpm;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const font = (label: string) => SYSTEM_FONTS.find((f) => f.label === label)!.family;
export const FONTS = {
  sans: font('System Sans'),
  inter: font('Inter / UI'),
  impact: font('Impact'),
  serif: font('Georgia'),
  palatino: font('Palatino'),
  mono: font('Monospace'),
  rounded: font('Rounded'),
  trebuchet: font('Trebuchet'),
  courier: font('Courier'),
} as const;

const SOFT_SHADOW = { color: 'rgba(0,0,0,0.55)', blur: 14, offsetX: 0, offsetY: 5 };

export const TEXT_STYLES = {
  headline: { fontFamily: FONTS.sans, fontSize: 128, fontWeight: 800, shadow: SOFT_SHADOW },
  sub: { fontFamily: FONTS.sans, fontSize: 60, fontWeight: 600, color: '#eef1f7', shadow: { color: 'rgba(0,0,0,0.5)', blur: 8, offsetX: 0, offsetY: 3 } },
  outlined: { fontFamily: FONTS.impact, fontSize: 150, fontWeight: 400, color: '#ffd23f', shadow: null, stroke: { color: '#111111', width: 10 } },
  outlinedWhite: { fontFamily: FONTS.impact, fontSize: 170, fontWeight: 400, color: '#ffffff', shadow: null, stroke: { color: '#000000', width: 12 } },
  boxed: { fontFamily: FONTS.sans, fontSize: 60, fontWeight: 700, color: '#101114', shadow: null, background: { color: '#ffffff', padding: 22, radius: 14 } },
  boxedDark: { fontFamily: FONTS.sans, fontSize: 54, fontWeight: 700, color: '#ffffff', shadow: null, align: 'left', background: { color: 'rgba(8,10,14,0.72)', padding: 20, radius: 10 } },
  quote: { fontFamily: FONTS.serif, fontSize: 80, fontWeight: 400, italic: true, lineHeight: 1.3, shadow: { color: 'rgba(0,0,0,0.6)', blur: 10, offsetX: 0, offsetY: 3 } },
  author: { fontFamily: FONTS.serif, fontSize: 44, fontWeight: 400, color: '#d9dde6', shadow: null },
  glow: { fontFamily: FONTS.sans, fontSize: 118, fontWeight: 700, color: '#d9fbff', shadow: { color: '#2ee6c0', blur: 30, offsetX: 0, offsetY: 0 } },
  glowPink: { fontFamily: FONTS.rounded, fontSize: 120, fontWeight: 800, color: '#ffe3f1', shadow: { color: '#ff4fa3', blur: 32, offsetX: 0, offsetY: 0 } },
  stamp: { fontFamily: FONTS.mono, fontSize: 44, fontWeight: 600, color: '#ffcf6b', shadow: { color: 'rgba(0,0,0,0.6)', blur: 4, offsetX: 0, offsetY: 2 }, align: 'left' },
  caption: { fontFamily: FONTS.sans, fontSize: 52, fontWeight: 600, shadow: null, stroke: { color: '#000000', width: 5 } },
  minimal: { fontFamily: FONTS.inter, fontSize: 64, fontWeight: 300, color: '#ffffff', shadow: { color: 'rgba(0,0,0,0.35)', blur: 10, offsetX: 0, offsetY: 2 }, lineHeight: 1.25 },
  label: { fontFamily: FONTS.sans, fontSize: 40, fontWeight: 800, color: '#ffffff', shadow: null, background: { color: 'rgba(0,0,0,0.6)', padding: 14, radius: 40 } },
  price: { fontFamily: FONTS.sans, fontSize: 64, fontWeight: 800, color: '#032019', shadow: null, background: { color: '#2ee6c0', padding: 20, radius: 16 } },
  big: { fontFamily: FONTS.impact, fontSize: 300, fontWeight: 400, color: '#ffffff', shadow: { color: 'rgba(0,0,0,0.5)', blur: 20, offsetX: 0, offsetY: 8 } },
  retro: { fontFamily: FONTS.courier, fontSize: 70, fontWeight: 700, color: '#ffe9c4', shadow: { color: '#d2491f', blur: 0, offsetX: 5, offsetY: 5 } },
  elegant: { fontFamily: FONTS.palatino, fontSize: 96, fontWeight: 400, italic: true, color: '#fff6ea', shadow: { color: 'rgba(0,0,0,0.45)', blur: 12, offsetX: 0, offsetY: 3 } },
} satisfies Record<string, Partial<TextStyle>>;

export type TextStyleId = keyof typeof TEXT_STYLES;

// ---------------------------------------------------------------------------
// Low-level helpers (also used by the hand-made featured templates)
// ---------------------------------------------------------------------------

export const FULL: SlotFrame = { x: 0.5, y: 0.5, w: 1, h: 1 };

export function isPortrait(a: TemplateAspect): boolean {
  return a === '9:16' || a === '4:5';
}

export function blurBackground(layer = 0, extra: TemplateEffect[] = [], strength = 30, darken = -30): NonNullable<TemplateSlot['copies']>[number] {
  return {
    layer,
    fit: 'cover',
    zoom: 1.08,
    effects: [...extra, { effectType: 'blur', params: { amount: strength } }, { effectType: 'brightness', params: { amount: darken } }],
  };
}

export const card = (radius = 0.04, border = 0, borderColor = '#ffffff'): ClipShape => ({ kind: 'rounded', radius, border, borderColor });

export function text(
  id: string,
  label: string,
  value: string,
  start: number,
  duration: number,
  style: TextStyleId | Partial<TextStyle>,
  pos: { x?: number; y: number; scale?: number; rotation?: number },
  extra: Partial<Pick<TemplateText, 'editable' | 'fadeIn' | 'fadeOut' | 'opacity'>> = {},
): TemplateText {
  return {
    id,
    label,
    text: value,
    start: r6(start),
    duration: r6(duration),
    style: typeof style === 'string' ? { ...TEXT_STYLES[style] } : style,
    x: pos.x ?? 0.5,
    y: pos.y,
    ...(pos.scale !== undefined ? { scale: pos.scale } : {}),
    ...(pos.rotation !== undefined ? { rotation: pos.rotation } : {}),
    editable: extra.editable ?? true,
    fadeIn: extra.fadeIn ?? 0.25,
    fadeOut: extra.fadeOut ?? 0.25,
    ...(extra.opacity !== undefined ? { opacity: extra.opacity } : {}),
  };
}

// ---------------------------------------------------------------------------
// Rhythms: cut lengths in beats
// ---------------------------------------------------------------------------

const rep = (n: number, v: number) => Array.from({ length: n }, () => v);

export const RHYTHMS = {
  /** Every beat (fast photo dumps). */
  beat: (n = 16) => rep(n, 1),
  /** Every half bar. */
  half: (n = 12) => rep(n, 2),
  /** Every bar. */
  bar: (n = 8) => rep(n, 4),
  /** Every two bars (calm). */
  long: (n = 5) => rep(n, 8),
  /** Starts slow, cuts get faster, ends on a held shot. */
  accelerate: () => [8, 4, 4, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 8],
  /** Slow - fast - slow. */
  wave: () => [8, 4, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 4, 8],
  /** Two-bar intro hold, then a one-beat burst, then a held ending. */
  burst: () => [8, 1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 8],
  /** Syncopated 3+3+2 pattern. */
  dotted: (n = 4) => Array.from({ length: n }, () => [3, 3, 2]).flat(),
  /** Two quick cuts then a held bar, repeated. */
  pairs: (n = 4) => Array.from({ length: n }, () => [2, 2, 4]).flat(),
} satisfies Record<string, (n?: number) => number[]>;

export type RhythmId = keyof typeof RHYTHMS;

// ---------------------------------------------------------------------------
// Looks (effect stacks)
// ---------------------------------------------------------------------------

const preset = (id: string): TemplateEffect[] =>
  (FILTER_PRESETS.find((p) => p.id === id)?.effects ?? []).map((e) => ({ effectType: e.effectType, params: { ...e.params } }));

export const LOOKS: Record<string, TemplateEffect[]> = {
  clean: [],
  vivid: preset('vivid'),
  warm: preset('warm'),
  cool: preset('cool'),
  bw: preset('bw'),
  vintage: preset('vintage'),
  fade: preset('fade'),
  noir: preset('noir'),
  dramatic: preset('dramatic'),
  sunset: preset('sunset'),
  dream: preset('dream'),
  punchy: [
    { effectType: 'contrast', params: { amount: 25 } },
    { effectType: 'saturation', params: { amount: 30 } },
  ],
  matte: [
    { effectType: 'contrast', params: { amount: -20 } },
    { effectType: 'brightness', params: { amount: 5 } },
    { effectType: 'temperature', params: { amount: 15 } },
  ],
  teal: [
    { effectType: 'temperature', params: { amount: -35 } },
    { effectType: 'hue', params: { amount: -10 } },
    { effectType: 'contrast', params: { amount: 15 } },
  ],
  sepiaSoft: [
    { effectType: 'sepia', params: { amount: 30 } },
    { effectType: 'vignette', params: { amount: 35, size: 60 } },
  ],
};

export type LookId = keyof typeof LOOKS;

// ---------------------------------------------------------------------------
// Motion patterns
// ---------------------------------------------------------------------------

export const MOTIONS = {
  still: () => undefined,
  push: () => ({ preset: 'zoom-in', amount: 1.12 }),
  pull: () => ({ preset: 'zoom-out', amount: 1.15 }),
  drift: (i: number) => ({ preset: i % 2 ? 'pan-left' : 'pan-right', amount: 1.15 }),
  kenburns: (i: number) => ({ preset: (['zoom-in', 'pan-right', 'zoom-out', 'pan-left'] as const)[i % 4], amount: 1.15 }),
  punch: (i: number) => (i % 2 ? { preset: 'punch-in', amount: 1.22 } : undefined),
  /** A quick push during the first beat of each cut. */
  pulse: (_i: number, beat: number) => ({ preset: 'zoom-in', amount: 1.08, duration: r6(beat) }),
} satisfies Record<string, (i: number, beat: number) => TemplateMotion | undefined>;

export type MotionId = keyof typeof MOTIONS;

// ---------------------------------------------------------------------------
// Transitions (fades on each cut)
// ---------------------------------------------------------------------------

export const TRANSITIONS = {
  /** Hard cuts; the very first shot fades in, the last fades out. */
  cut: { each: [0, 0], ends: [0.3, 0.6] },
  /** Quick dip to black between shots. */
  dip: { each: [0.12, 0.12], ends: [0.3, 0.6] },
  /** Every shot fades up from black. */
  soft: { each: [0.35, 0], ends: [0.35, 0.8] },
} as const satisfies Record<string, { each: readonly [number, number]; ends: readonly [number, number] }>;

export type TransitionId = keyof typeof TRANSITIONS;

// ---------------------------------------------------------------------------
// Layouts: which slots one cut creates
// ---------------------------------------------------------------------------

export interface CutContext {
  aspect: TemplateAspect;
  index: number;
  start: number;
  duration: number;
  beat: number;
  look: TemplateEffect[];
  motion: TemplateMotion | undefined;
  fadeIn: number;
  fadeOut: number;
  accepts: SlotAccepts;
}

type SlotDraft = Omit<TemplateSlot, 'id'>;

function base(c: CutContext, extra: Partial<SlotDraft> = {}): SlotDraft {
  return {
    start: r6(c.start),
    duration: r6(c.duration),
    accepts: c.accepts,
    layer: 1,
    fit: 'cover',
    ...(c.look.length ? { effects: c.look.map((e) => ({ ...e, params: { ...e.params } })) } : {}),
    ...(c.motion ? { motion: c.motion } : {}),
    ...(c.fadeIn ? { fadeIn: c.fadeIn } : {}),
    ...(c.fadeOut ? { fadeOut: c.fadeOut } : {}),
    ...extra,
  };
}

/** Frames for n pictures side by side (landscape/square) or stacked (portrait). */
export function splitFrames(aspect: TemplateAspect, n: number, gap = 0.03): SlotFrame[] {
  const stacked = isPortrait(aspect);
  const size = (1 - gap * (n + 1)) / n;
  return Array.from({ length: n }, (_, i) => {
    const c = gap + size / 2 + i * (size + gap);
    return stacked ? { x: 0.5, y: r6(c), w: 1 - 2 * gap, h: r6(size) } : { x: r6(c), y: 0.5, w: r6(size), h: r6(1 - 4 * gap) };
  });
}

export function gridFrames(gap = 0.03): SlotFrame[] {
  const s = (1 - 3 * gap) / 2;
  const a = gap + s / 2;
  const b = 1 - a;
  return [
    { x: a, y: a, w: s, h: s },
    { x: b, y: a, w: s, h: s },
    { x: a, y: b, w: s, h: s },
    { x: b, y: b, w: s, h: s },
  ].map((f) => ({ x: r6(f.x), y: r6(f.y), w: r6(f.w), h: r6(f.h) }));
}

export interface Layout {
  label: string;
  /** Slots created per cut. */
  perCut: number;
  cut(c: CutContext): SlotDraft[];
  /** Slots spanning the whole template (e.g. a picture-in-picture bubble). */
  persistent?(aspect: TemplateAspect, total: number): SlotDraft[];
}

const bubbleFrame = (aspect: TemplateAspect): SlotFrame => {
  const portrait = isPortrait(aspect);
  const square = aspect === '1:1';
  // Square frame in canvas fractions: same pixel width and height.
  const side = 0.34;
  const ratio = portrait ? (aspect === '9:16' ? 9 / 16 : 4 / 5) : square ? 1 : 16 / 9;
  const w = portrait || square ? side : side / ratio;
  const h = portrait ? side * ratio : side;
  return { x: r6(1 - w / 2 - 0.04), y: r6(portrait ? 0.78 : 1 - h / 2 - 0.06), w: r6(w), h: r6(h) };
};

export const LAYOUTS = {
  full: { label: 'Full frame', perCut: 1, cut: (c) => [base(c)] },
  blur: {
    label: 'Blurred background',
    perCut: 1,
    cut: (c) => [base(c, { fit: 'contain', copies: [blurBackground(0, c.look)] })],
  },
  polaroid: {
    label: 'Instant photo',
    perCut: 1,
    cut: (c) => [
      base(c, {
        fit: 'contain',
        frame: isPortrait(c.aspect) ? { x: 0.5, y: 0.47, w: 0.84, h: 0.66 } : { x: 0.5, y: 0.48, w: 0.7, h: 0.8 },
        rotation: c.index % 2 ? 3 : -3,
        shape: card(0.012, 18, '#fbfaf5'),
        copies: [blurBackground(0, [], 40, -20)],
      }),
    ],
  },
  framed: {
    label: 'Framed',
    perCut: 1,
    cut: (c) => [base(c, { fit: 'contain', frame: { x: 0.5, y: 0.5, w: 0.9, h: 0.9 }, shape: card(0.05), copies: [blurBackground(0, [], 50, -55)] })],
  },
  split2: {
    label: 'Split screen',
    perCut: 2,
    cut: (c) =>
      splitFrames(c.aspect, 2).map((frame, i) =>
        base(c, { layer: i + 1, fit: 'contain', frame, shape: card(0.04), ...(i === 0 ? { copies: [blurBackground(0, [], 40, -45)] } : {}) }),
      ),
  },
  split3: {
    label: 'Three-up',
    perCut: 3,
    cut: (c) =>
      splitFrames(c.aspect, 3, 0.025).map((frame, i) =>
        base(c, { layer: i + 1, fit: 'contain', frame, shape: card(0.04), ...(i === 0 ? { copies: [blurBackground(0, [], 40, -50)] } : {}) }),
      ),
  },
  grid: {
    label: '2×2 grid',
    perCut: 4,
    cut: (c) =>
      gridFrames().map((frame, i) =>
        base(c, { layer: i + 1, fit: 'contain', frame, shape: card(0.05), ...(i === 0 ? { copies: [blurBackground(0, [], 45, -50)] } : {}) }),
      ),
  },
  /** Grid whose tiles pop in one beat after another. */
  gridBuild: {
    label: 'Grid build-up',
    perCut: 4,
    cut: (c) =>
      gridFrames().map((frame, i) => {
        const delay = Math.min(i, Math.max(0, Math.round(c.duration / c.beat) - 1)) * c.beat;
        const start = r6(c.start + delay);
        return base(
          { ...c, start, duration: r6(r6(c.start + c.duration) - start), motion: undefined },
          { layer: i + 1, fit: 'contain', frame, shape: card(0.05, 6), fadeIn: 0.1, ...(i === 0 ? { copies: [blurBackground(0, [], 45, -50)] } : {}) },
        );
      }),
  },
  /** Full-frame cuts plus one round bubble (e.g. your face) for the whole video. */
  bubble: {
    label: 'Picture-in-picture',
    perCut: 1,
    cut: (c) => [base(c, { layer: 0 })],
    persistent: (aspect, total) => [
      { start: 0, duration: r6(total), accepts: 'any', layer: 5, fit: 'cover', frame: bubbleFrame(aspect), shape: { kind: 'circle', radius: 0.5, border: 8, borderColor: '#ffffff' }, label: 'Bubble', fadeIn: 0.3, fadeOut: 0.3 },
    ],
  },
} satisfies Record<string, Layout>;

export type LayoutId = keyof typeof LAYOUTS;

// ---------------------------------------------------------------------------
// Text treatments
// ---------------------------------------------------------------------------

export interface TextCopy {
  title: string;
  sub?: string;
  outro?: string;
  words?: string[];
}

export interface TextContext {
  aspect: TemplateAspect;
  total: number;
  beat: number;
  copy: TextCopy;
  /** Start times of the cuts (for chapter captions). */
  cuts: number[];
}

const bar = (c: TextContext) => c.beat * BEATS_PER_BAR;
const intro = (c: TextContext) => Math.min(2 * bar(c), c.total / 3);

export const TEXTS = {
  none: () => [],
  headline: (c) => [
    text('title', 'Title', c.copy.title, 0, intro(c), 'headline', { y: 0.42 }),
    ...(c.copy.sub ? [text('sub', 'Subtitle', c.copy.sub, 0, intro(c), 'sub', { y: 0.51 })] : []),
  ],
  outlined: (c) => [
    text('title', 'Title', c.copy.title, 0, intro(c), 'outlined', { y: 0.5, rotation: -4 }),
    ...(c.copy.outro ? [text('outro', 'Ending', c.copy.outro, c.total - bar(c), bar(c), 'outlined', { y: 0.5 })] : []),
  ],
  boxed: (c) => [
    text('title', 'Label', c.copy.title, 0, c.total, 'boxed', { y: 0.12 }),
    ...(c.copy.sub ? [text('sub', 'Caption', c.copy.sub, c.total - 2 * bar(c), 2 * bar(c), 'boxed', { y: 0.86, scale: 0.8 })] : []),
  ],
  quote: (c) => [
    text('title', 'Quote', c.copy.title, c.beat, c.total - c.beat, 'quote', { y: 0.46 }, { fadeIn: 0.8, fadeOut: 0.8 }),
    ...(c.copy.sub ? [text('sub', 'Author', c.copy.sub, 2 * bar(c), c.total - 2 * bar(c), 'author', { y: 0.62 }, { fadeIn: 0.6, fadeOut: 0.8 })] : []),
  ],
  glow: (c) => [
    text('title', 'Title', c.copy.title, 0, intro(c), 'glow', { y: 0.45 }),
    ...(c.copy.outro ? [text('outro', 'Ending', c.copy.outro, c.total - bar(c), bar(c), 'glow', { y: 0.5, scale: 0.8 })] : []),
  ],
  stamp: (c) => [text('title', 'Date stamp', c.copy.title, 0, c.total, 'stamp', { x: isPortrait(c.aspect) ? 0.3 : 0.2, y: 0.93 }, { fadeIn: 0, fadeOut: 0.3 })],
  lowerThird: (c) => [
    text('title', 'Name', c.copy.title, bar(c), Math.min(3 * bar(c), c.total - bar(c)), 'boxedDark', { x: isPortrait(c.aspect) ? 0.36 : 0.22, y: 0.8 }),
    ...(c.copy.sub ? [text('sub', 'Detail', c.copy.sub, bar(c), Math.min(3 * bar(c), c.total - bar(c)), { ...TEXT_STYLES.sub, fontSize: 42, align: 'left' }, { x: isPortrait(c.aspect) ? 0.36 : 0.22, y: 0.86 })] : []),
  ],
  titleOutro: (c) => [
    text('title', 'Title', c.copy.title, 0, intro(c), { ...TEXT_STYLES.headline, fontSize: 110 }, { y: 0.5 }),
    text('outro', 'Ending', c.copy.outro ?? 'Thanks for watching', c.total - 2 * bar(c), 2 * bar(c), 'sub', { y: 0.5 }),
  ],
  kinetic: (c) => {
    const words = (c.copy.words ?? [c.copy.title]).slice(0, 4);
    return words.map((w, i) => text(`word${i + 1}`, `Word ${i + 1}`, w, i * bar(c), bar(c), 'outlinedWhite', { y: 0.5 }, { fadeIn: 0.05, fadeOut: 0.1 }));
  },
  countdown: (c) => [
    ...['3', '2', '1'].map((n, i) => text(`count${n}`, `Count ${n}`, n, i * c.beat, c.beat, 'big', { y: 0.5 }, { editable: false, fadeIn: 0, fadeOut: 0.05 })),
    text('title', 'Title', c.copy.title, 3 * c.beat, Math.min(2 * bar(c), c.total - 3 * c.beat), 'outlinedWhite', { y: 0.5, scale: 0.7 }),
  ],
  chapters: (c) => {
    const words = c.copy.words ?? ['Part 1', 'Part 2', 'Part 3'];
    const n = Math.min(words.length, c.cuts.length);
    const step = Math.max(1, Math.floor(c.cuts.length / n));
    return words.slice(0, n).map((w, i) => {
      const s = c.cuts[i * step]!;
      const e = i === n - 1 ? c.total : c.cuts[(i + 1) * step] ?? c.total;
      return text(`chapter${i + 1}`, `Chapter ${i + 1}`, w, s, Math.min(e - s, 2 * bar(c)), 'label', { x: isPortrait(c.aspect) ? 0.26 : 0.14, y: 0.09 });
    });
  },
  beforeAfter: (c) => {
    const f = splitFrames(c.aspect, 2);
    const at = (fr: SlotFrame) => (isPortrait(c.aspect) ? { x: 0.16, y: r6(fr.y - fr.h / 2 + 0.035) } : { x: r6(fr.x - fr.w / 2 + 0.08), y: 0.1 });
    return [
      text('before', 'Left/top label', c.copy.words?.[0] ?? 'BEFORE', 0, c.total, 'label', at(f[0]!)),
      text('after', 'Right/bottom label', c.copy.words?.[1] ?? 'AFTER', 0, c.total, 'label', at(f[1]!)),
      ...(c.copy.title ? [text('title', 'Title', c.copy.title, c.total - 2 * bar(c), 2 * bar(c), 'boxed', { y: 0.5 })] : []),
    ];
  },
  caption: (c) => [text('title', 'Caption', c.copy.title, 0, c.total, 'caption', { y: 0.84 })],
  minimal: (c) => [
    text('title', 'Title', c.copy.title, 0, intro(c), 'minimal', { y: 0.5 }, { fadeIn: 0.6, fadeOut: 0.6 }),
    ...(c.copy.outro ? [text('outro', 'Ending', c.copy.outro, c.total - 2 * bar(c), 2 * bar(c), 'minimal', { y: 0.5, scale: 0.8 }, { fadeIn: 0.6, fadeOut: 0.6 })] : []),
  ],
  product: (c) => [
    text('title', 'Product name', c.copy.title, 0, c.total, 'boxed', { y: 0.12 }),
    text('price', 'Price', c.copy.sub ?? '$29', bar(c), c.total - bar(c), 'price', { x: isPortrait(c.aspect) ? 0.5 : 0.82, y: isPortrait(c.aspect) ? 0.86 : 0.82 }),
    ...(c.copy.outro ? [text('cta', 'Call to action', c.copy.outro, c.total - bar(c), bar(c), 'outlinedWhite', { y: 0.5, scale: 0.55 })] : []),
  ],
  elegant: (c) => [
    text('title', 'Names', c.copy.title, 0, intro(c), 'elegant', { y: 0.46 }, { fadeIn: 0.8, fadeOut: 0.8 }),
    ...(c.copy.sub ? [text('sub', 'Date', c.copy.sub, 0, intro(c), { ...TEXT_STYLES.author, fontSize: 40 }, { y: 0.55 }, { fadeIn: 0.8, fadeOut: 0.8 })] : []),
    ...(c.copy.outro ? [text('outro', 'Ending', c.copy.outro, c.total - 2 * bar(c), 2 * bar(c), 'elegant', { y: 0.5, scale: 0.75 }, { fadeIn: 0.8, fadeOut: 1 })] : []),
  ],
  retro: (c) => [
    text('title', 'Title', c.copy.title, 0, intro(c), 'retro', { y: 0.2 }),
    text('stamp', 'Date stamp', c.copy.sub ?? "'98", 0, c.total, 'stamp', { x: isPortrait(c.aspect) ? 0.84 : 0.9, y: 0.93 }),
  ],
} satisfies Record<string, (c: TextContext) => TemplateText[]>;

export type TextRecipeId = keyof typeof TEXTS;

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

export interface Recipe {
  id: string;
  name: string;
  category: string;
  description: string;
  aspect: TemplateAspect;
  layout: LayoutId;
  rhythm: RhythmId;
  /** Argument of the rhythm (number of cuts / repeats). */
  count?: number;
  look: LookId;
  motion: MotionId;
  transition: TransitionId;
  text: TextRecipeId;
  copy: TextCopy;
  music: { trackId: string; seed: number; volume?: number };
  accepts?: SlotAccepts;
  tags?: string[];
  featured?: boolean;
}

/** Builds a template from one choice of each building block (deterministic). */
export function composeTemplate(r: Recipe): VideoTemplate {
  const beat = beatSeconds(r.music.trackId);
  const beats = RHYTHMS[r.rhythm](r.count);
  const layout: Layout = LAYOUTS[r.layout];
  const tr = TRANSITIONS[r.transition];
  const look = LOOKS[r.look] ?? [];
  const slots: TemplateSlot[] = [];
  const cuts: number[] = [];
  let at = 0;
  beats.forEach((b, i) => {
    // Rounded ends (not rounded lengths) so neighbours share exact cut times.
    const start = r6(at * beat);
    const duration = r6(r6((at + b) * beat) - start);
    cuts.push(r6(start));
    const first = i === 0;
    const last = i === beats.length - 1;
    const drafts = layout.cut({
      aspect: r.aspect,
      index: i,
      start,
      duration,
      beat,
      look,
      motion: MOTIONS[r.motion](i, beat),
      fadeIn: first ? tr.ends[0] : tr.each[0],
      fadeOut: last ? tr.ends[1] : tr.each[1],
      accepts: r.accepts ?? 'any',
    });
    for (const d of drafts) slots.push({ id: `s${slots.length + 1}`, ...d });
    at += b;
  });
  const total = r6(at * beat);
  for (const d of layout.persistent?.(r.aspect, total) ?? []) slots.push({ id: `s${slots.length + 1}`, ...d });
  const texts = TEXTS[r.text]({ aspect: r.aspect, total, beat, copy: r.copy, cuts });
  return {
    formatVersion: TEMPLATE_FORMAT_VERSION,
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    aspect: r.aspect,
    duration: total,
    slots,
    texts,
    music: { trackId: r.music.trackId, seed: r.music.seed, volume: r.music.volume ?? 0.6, fadeIn: 0.2, fadeOut: Math.min(2, total / 4) },
    tags: [...(r.tags ?? []), LAYOUTS[r.layout].label.toLowerCase(), r.rhythm, r.look],
    ...(r.featured ? { featured: true } : {}),
  };
}
