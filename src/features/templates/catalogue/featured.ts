/**
 * Hand-made "featured" templates (original designs). They use the shared
 * helpers from `recipes.ts` but have bespoke structures. All cut points are
 * whole beats of the referenced catalogue track (see `beatSeconds`).
 */
import {
  BEATS_PER_BAR,
  beatSeconds,
  blurBackground,
  card,
  gridFrames,
  LOOKS,
  splitFrames,
  text,
  TEXT_STYLES,
} from '../recipes';
import { TEMPLATE_FORMAT_VERSION, type TemplateSlot, type TemplateText, type VideoTemplate } from '../types';

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

type SlotDraft = Omit<TemplateSlot, 'id' | 'start' | 'duration'>;

/** Lays slots out back to back; lengths in beats. Returns the slots and the end (beats). */
class Seq {
  slots: TemplateSlot[] = [];
  beatsAt = 0;
  constructor(readonly beat: number) {}
  get t(): number {
    return r6(this.beatsAt * this.beat);
  }
  sec(beats: number): number {
    return r6(beats * this.beat);
  }
  /** Adds one cut of `beats` length made of one or more simultaneous slots. */
  cut(beats: number, ...drafts: (SlotDraft & { delayBeats?: number })[]): this {
    for (const { delayBeats = 0, ...d } of drafts) {
      const start = this.sec(this.beatsAt + delayBeats);
      this.slots.push({ id: `s${this.slots.length + 1}`, start, duration: r6(this.sec(this.beatsAt + beats) - start), ...d });
    }
    this.beatsAt += beats;
    return this;
  }
}

function tpl(
  t: Omit<VideoTemplate, 'formatVersion' | 'duration' | 'slots' | 'texts' | 'featured'>,
  seq: Seq,
  texts: TemplateText[],
): VideoTemplate {
  return { formatVersion: TEMPLATE_FORMAT_VERSION, ...t, duration: seq.t, slots: seq.slots, texts, featured: true };
}

const full = (extra: Partial<SlotDraft> = {}): SlotDraft => ({ accepts: 'any', layer: 1, fit: 'cover', ...extra });
const B = BEATS_PER_BAR;

// ---------------------------------------------------------------------------

function beatFlip(): VideoTemplate {
  const id = 'pop-bright-side';
  const s = new Seq(beatSeconds(id));
  const vivid = LOOKS.vivid!;
  s.cut(2 * B, full({ effects: vivid, motion: { preset: 'zoom-in', amount: 1.15 }, fadeIn: 0.2 }));
  for (let i = 0; i < 8; i++) s.cut(2, full({ effects: vivid, ...(i % 2 ? { motion: { preset: 'punch-in', amount: 1.25 } } : {}) }));
  const tilt = [-4, 3, -2, 4, -3, 2, -4, 3];
  for (let i = 0; i < 8; i++) s.cut(1, full({ effects: vivid, rotation: tilt[i], zoom: 1.12 }));
  s.cut(2 * B, full({ fit: 'contain', effects: vivid, motion: { preset: 'zoom-out', amount: 1.12 }, fadeOut: 0.8, copies: [blurBackground(0, vivid)] }));
  const end = s.t;
  return tpl(
    {
      id: 'featured-beat-flip',
      name: 'Beat Flip',
      category: 'Slideshow',
      description: 'A two-bar intro, half-bar cuts with punch-ins, a one-beat tilt burst and a held ending — all on the beat of “Bright Side”.',
      aspect: '9:16',
      music: { trackId: id, seed: 201, volume: 0.65, fadeIn: 0.1, fadeOut: 1.5 },
      tags: ['beat sync', 'photos', 'energetic'],
    },
    s,
    [
      text('title', 'Title', 'WEEKEND MODE', 0, s.sec(2 * B), 'outlined', { y: 0.5, rotation: -4 }),
      text('outro', 'Ending', 'see you next week', end - s.sec(2 * B), s.sec(2 * B), 'glow', { y: 0.84, scale: 0.6 }),
    ],
  );
}

function postcardTrail(): VideoTemplate {
  const id = 'travel-postcards';
  const s = new Seq(beatSeconds(id));
  const motions = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'] as const;
  const places = ['Day 1 · The coast', 'Day 2 · Old town', 'Day 3 · Up the hill'];
  for (let i = 0; i < 6; i++) {
    s.cut(2 * B, {
      accepts: 'any',
      layer: 1,
      fit: 'contain',
      frame: { x: 0.5, y: 0.45, w: 0.84, h: 0.62 },
      rotation: i % 2 ? 2.5 : -2.5,
      shape: card(0.01, 20, '#fbfaf5'),
      motion: { preset: motions[i % 4]!, amount: 1.12 },
      effects: LOOKS.warm,
      fadeIn: i === 0 ? 0.4 : 0.15,
      fadeOut: i === 5 ? 0.8 : 0.15,
      copies: [blurBackground(0, LOOKS.warm, 40, -15)],
    });
  }
  const bar2 = s.sec(2 * B);
  return tpl(
    {
      id: 'featured-postcard-trail',
      name: 'Postcard Trail',
      category: 'Travel',
      description: 'Six instant-photo frames drifting over a blurred copy of each shot, with a caption for every leg of the trip.',
      aspect: '9:16',
      music: { trackId: id, seed: 1401, volume: 0.6, fadeIn: 0.3, fadeOut: 2 },
      tags: ['trip', 'photos', 'warm'],
    },
    s,
    [
      text('title', 'Title', 'Postcards from the road', 0, bar2, 'elegant', { y: 0.1, scale: 0.8 }),
      ...places.map((p, i) => text(`place${i + 1}`, `Caption ${i + 1}`, p, i * 2 * bar2, 2 * bar2, 'boxed', { y: 0.86, scale: 0.75 })),
    ],
  );
}

function productSpotlight(): VideoTemplate {
  const id = 'tech-circuit';
  const s = new Seq(beatSeconds(id));
  s.cut(2 * B, full({ fit: 'contain', label: 'Hero shot', motion: { preset: 'zoom-out', amount: 1.12 }, fadeIn: 0.2, copies: [blurBackground(0, [], 45, -45)] }));
  const g = gridFrames();
  s.cut(2 * B, ...g.map((frame, i) => ({ accepts: 'any' as const, layer: i + 1, fit: 'contain' as const, frame, shape: card(0.05, 6, '#2ee6c0'), delayBeats: i, fadeIn: 0.1, label: `Detail ${i + 1}`, ...(i === 0 ? { copies: [blurBackground(0, [], 45, -55)] } : {}) })));
  for (let i = 0; i < 4; i++) s.cut(B, full({ effects: LOOKS.punchy, motion: i % 2 ? { preset: 'punch-in', amount: 1.3 } : { preset: 'zoom-in', amount: 1.1 } }));
  s.cut(2 * B, full({ fit: 'contain', label: 'Closing shot', fadeOut: 0.6, copies: [blurBackground(0, [], 45, -45)] }));
  const end = s.t;
  const bar = s.sec(B);
  return tpl(
    {
      id: 'featured-product-spotlight',
      name: 'Product Spotlight',
      category: 'Product',
      description: 'Hero shot, a 2×2 detail grid that builds on the beat, four quick close-ups and a closing shot with price and call to action.',
      aspect: '1:1',
      music: { trackId: id, seed: 1501, volume: 0.55, fadeIn: 0.1, fadeOut: 1.5 },
      tags: ['shop', 'ad', 'grid'],
    },
    s,
    [
      text('title', 'Product name', 'Aurora Lamp', 0, 2 * bar, 'boxed', { y: 0.12 }),
      text('price', 'Price', '$49', end - 2 * bar, 2 * bar, 'price', { x: 0.78, y: 0.85 }),
      text('cta', 'Call to action', 'Shop now', end - 2 * bar, 2 * bar, 'outlinedWhite', { y: 0.12, scale: 0.45 }),
    ],
  );
}

function wordsOverWater(): VideoTemplate {
  const id = 'ambient-still-water';
  const s = new Seq(beatSeconds(id));
  s.cut(6 * B, full({ label: 'Background', motion: { preset: 'zoom-in', amount: 1.18 }, effects: [...LOOKS.fade!, { effectType: 'brightness', params: { amount: -25 } }], fadeIn: 1, fadeOut: 1.5 }));
  const bar = s.sec(B);
  return tpl(
    {
      id: 'featured-words-over-water',
      name: 'Words Over Water',
      category: 'Quote',
      description: 'One calm shot, slowly pushing in and dimmed so a serif quote and its author read clearly.',
      aspect: '9:16',
      music: { trackId: id, seed: 501, volume: 0.6, fadeIn: 1, fadeOut: 2.5 },
      tags: ['quote', 'calm', 'single shot'],
    },
    s,
    [
      text('quote', 'Quote', 'Slow is smooth,\nand smooth is fast.', bar, s.t - 2 * bar, 'quote', { y: 0.45 }, { fadeIn: 1, fadeOut: 1 }),
      text('author', 'Author', '— a patient friend', 2 * bar, s.t - 3 * bar, 'author', { y: 0.58 }, { fadeIn: 1, fadeOut: 1 }),
    ],
  );
}

function thenAndNow(): VideoTemplate {
  const id = 'acoustic-front-porch';
  const s = new Seq(beatSeconds(id));
  s.cut(2 * B, full({ label: 'Then', effects: LOOKS.bw, motion: { preset: 'zoom-in', amount: 1.1 }, fadeIn: 0.3 }));
  s.cut(2 * B, full({ label: 'Now', effects: LOOKS.vivid, motion: { preset: 'zoom-in', amount: 1.1 } }));
  const f = splitFrames('4:5', 2);
  s.cut(
    4 * B,
    { accepts: 'any', layer: 1, fit: 'contain', frame: f[0]!, shape: card(0.04), label: 'Then (repeat)', effects: LOOKS.bw, copies: [blurBackground(0, [], 40, -50)] },
    { accepts: 'any', layer: 2, fit: 'contain', frame: f[1]!, shape: card(0.04), label: 'Now (repeat)', effects: LOOKS.vivid, fadeOut: 0.8 },
  );
  const bar = s.sec(B);
  return tpl(
    {
      id: 'featured-then-and-now',
      name: 'Then & Now',
      category: 'Before & After',
      description: 'The “then” shot in black and white, the “now” shot in color, then both stacked with labels. Add two photos — slots 3 and 4 repeat them.',
      aspect: '4:5',
      music: { trackId: id, seed: 601, volume: 0.55, fadeIn: 0.3, fadeOut: 2 },
      tags: ['comparison', 'transformation'],
    },
    s,
    [
      text('then1', 'Label “then”', 'THEN', 0, 2 * bar, 'label', { x: 0.16, y: 0.08 }),
      text('now1', 'Label “now”', 'NOW', 2 * bar, 2 * bar, 'label', { x: 0.16, y: 0.08 }),
      text('then2', 'Top label', 'THEN', 4 * bar, 4 * bar, 'label', { x: 0.16, y: r6(f[0]!.y - f[0]!.h / 2 + 0.035) }),
      text('now2', 'Bottom label', 'NOW', 4 * bar, 4 * bar, 'label', { x: 0.16, y: r6(f[1]!.y - f[1]!.h / 2 + 0.035) }),
    ],
  );
}

function cameraRollDump(): VideoTemplate {
  const id = 'electronic-night-drive-club';
  const s = new Seq(beatSeconds(id));
  const tilts = [-6, 4, -2, 5, -4, 2, -5, 3, -3, 6, -2, 4, -6, 3, -4, 5, -3, 2, -5, 4];
  s.cut(2 * B, full({ motion: { preset: 'zoom-in', amount: 1.1 }, effects: LOOKS.matte, fadeIn: 0.2 }));
  for (const r of tilts) {
    s.cut(1, { accepts: 'any', layer: 1, fit: 'contain', frame: { x: 0.5, y: 0.48, w: 0.82, h: 0.6 }, rotation: r, shape: card(0.01, 16, '#ffffff'), effects: LOOKS.matte, copies: [blurBackground(0, [], 50, -40)] });
  }
  s.cut(2 * B, full({ effects: LOOKS.matte, motion: { preset: 'zoom-out', amount: 1.12 }, fadeOut: 0.8 }));
  return tpl(
    {
      id: 'featured-camera-roll-dump',
      name: 'Camera Roll Dump',
      category: 'Photo dump',
      description: 'Twenty tilted photo cards flicking past on every beat, bookended by two full-frame holds and a date stamp.',
      aspect: '9:16',
      music: { trackId: id, seed: 701, volume: 0.6, fadeIn: 0.1, fadeOut: 1.5 },
      tags: ['dump', 'fast', 'beat sync'],
    },
    s,
    [
      text('stamp', 'Date stamp', 'ROLL 07 · SUMMER', 0, s.t, 'stamp', { x: 0.3, y: 0.92 }, { fadeIn: 0, fadeOut: 0.5 }),
      text('title', 'Title', 'recent dump', 0, s.sec(2 * B), 'minimal', { y: 0.5 }),
    ],
  );
}

function morningRoutine(): VideoTemplate {
  const id = 'jazzhop-morning-coffee';
  const s = new Seq(beatSeconds(id));
  const steps = ['wake up', 'coffee first', 'pages & plans', 'a short walk', 'deep work', 'golden hour'];
  for (let i = 0; i < steps.length; i++) {
    s.cut(2 * B, full({ accepts: 'video', label: steps[i], effects: LOOKS.matte, motion: i === 0 ? { preset: 'zoom-in', amount: 1.1 } : undefined, fadeIn: i === 0 ? 0.4 : 0.12, fadeOut: i === steps.length - 1 ? 0.8 : 0.12 }));
  }
  const two = s.sec(2 * B);
  return tpl(
    {
      id: 'featured-morning-routine',
      name: 'Slow Morning Vlog',
      category: 'Vlog',
      description: 'Six two-bar video moments with soft dips, a muted film look and a caption for each step of the routine.',
      aspect: '9:16',
      music: { trackId: id, seed: 1701, volume: 0.45, fadeIn: 0.5, fadeOut: 2 },
      tags: ['routine', 'day in the life'],
    },
    s,
    [
      text('title', 'Title', 'my slow morning', 0, two, 'minimal', { y: 0.45 }, { fadeIn: 0.6, fadeOut: 0.6 }),
      ...steps.map((st, i) => text(`step${i + 1}`, `Caption ${i + 1}`, st, i * two + s.sec(1), two - s.sec(1), 'caption', { y: 0.84 })),
    ],
  );
}

function partyStarter(): VideoTemplate {
  const id = 'playful-bubblegum-parade';
  const s = new Seq(beatSeconds(id));
  for (let i = 0; i < 3; i++) s.cut(B, full({ effects: LOOKS.punchy, motion: { preset: 'punch-in', amount: 1.15 + i * 0.05 } }));
  const g = gridFrames();
  s.cut(2 * B, ...g.map((frame, i) => ({ accepts: 'any' as const, layer: i + 1, fit: 'contain' as const, frame, rotation: i % 2 ? 3 : -3, shape: card(0.06, 10, '#ffd23f'), delayBeats: i, fadeIn: 0.1, ...(i === 0 ? { copies: [blurBackground(0, LOOKS.punchy, 40, -35)] } : {}) })));
  for (let i = 0; i < 8; i++) s.cut(2, full({ effects: LOOKS.punchy, ...(i % 2 ? { motion: { preset: 'punch-in', amount: 1.25 } } : {}) }));
  s.cut(2 * B, full({ fit: 'contain', effects: LOOKS.punchy, motion: { preset: 'zoom-in', amount: 1.1 }, fadeOut: 0.8, copies: [blurBackground(0, LOOKS.punchy)] }));
  const bar = s.sec(B);
  return tpl(
    {
      id: 'featured-party-starter',
      name: 'Party Starter',
      category: 'Celebration',
      description: 'Three big words on three bars, a confetti-colored photo grid that builds on the beat, quick cuts and a wish at the end.',
      aspect: '9:16',
      music: { trackId: id, seed: 1301, volume: 0.6, fadeIn: 0.1, fadeOut: 1.5 },
      tags: ['birthday', 'party', 'friends'],
    },
    s,
    [
      text('w1', 'Word 1', 'HAPPY', 0, bar, 'outlined', { y: 0.5, rotation: -4 }, { fadeIn: 0.05 }),
      text('w2', 'Word 2', 'BIRTHDAY', bar, bar, 'outlined', { y: 0.5, rotation: 3 }, { fadeIn: 0.05 }),
      text('w3', 'Name', 'SAM!', 2 * bar, bar, 'outlined', { y: 0.5, rotation: -2, scale: 1.3 }, { fadeIn: 0.05 }),
      text('outro', 'Ending', 'make a wish ✨', s.t - 2 * bar, 2 * bar, 'glowPink', { y: 0.84, scale: 0.7 }),
    ],
  );
}

function cleanTitleReel(): VideoTemplate {
  const id = 'corporate-forward-together';
  const s = new Seq(beatSeconds(id));
  s.cut(2 * B, full({ fit: 'contain', label: 'Opening', motion: { preset: 'zoom-in', amount: 1.08 }, fadeIn: 0.5, copies: [blurBackground(0, [], 40, -50)] }));
  for (let i = 0; i < 5; i++) s.cut(2 * B, full({ motion: { preset: i % 2 ? 'pan-left' : 'pan-right', amount: 1.12 }, fadeIn: 0.12, fadeOut: 0.12 }));
  s.cut(2 * B, full({ fit: 'contain', label: 'Closing', fadeOut: 1, copies: [blurBackground(0, [], 40, -50)] }));
  const two = s.sec(2 * B);
  return tpl(
    {
      id: 'featured-clean-title-reel',
      name: 'Clean Title Reel',
      category: 'Minimal',
      description: 'Widescreen: a title card over a blurred opening shot, five gently drifting clips with a lower third, and a closing card.',
      aspect: '16:9',
      music: { trackId: id, seed: 301, volume: 0.5, fadeIn: 0.5, fadeOut: 2 },
      tags: ['youtube', 'company', 'title'],
    },
    s,
    [
      text('title', 'Title', 'Studio Notes', 0, two, { ...TEXT_STYLES.headline, fontSize: 120 }, { y: 0.46 }, { fadeIn: 0.6 }),
      text('sub', 'Subtitle', 'Episode 12 — building in public', 0, two, { ...TEXT_STYLES.sub, fontSize: 52 }, { y: 0.57 }, { fadeIn: 0.8 }),
      text('name', 'Lower third', 'Alex Rivera', two + s.sec(1), two - s.sec(1), 'boxedDark', { x: 0.2, y: 0.82 }),
      text('outro', 'Closing', 'Thanks for watching', s.t - two, two, 'minimal', { y: 0.5 }, { fadeIn: 0.6, fadeOut: 1 }),
    ],
  );
}

function talkingReview(): VideoTemplate {
  const id = 'hiphop-corner-store';
  const s = new Seq(beatSeconds(id));
  for (let i = 0; i < 4; i++) s.cut(4 * B, full({ layer: 0, label: `Scene ${i + 1}`, accepts: 'any', fadeIn: i === 0 ? 0.3 : 0.1, fadeOut: i === 3 ? 0.6 : 0.1 }));
  s.slots.push({
    id: `s${s.slots.length + 1}`,
    label: 'Your face (bubble)',
    start: 0,
    duration: s.t,
    accepts: 'video',
    layer: 5,
    fit: 'cover',
    volume: 1,
    frame: { x: 0.86, y: 0.76, w: r6(0.32 * (9 / 16)), h: 0.32 },
    shape: { kind: 'circle', radius: 0.5, border: 8, borderColor: '#2ee6c0' },
    fadeIn: 0.3,
    fadeOut: 0.3,
  });
  const four = s.sec(4 * B);
  return tpl(
    {
      id: 'featured-talking-review',
      name: 'Talking Review',
      category: 'Vlog',
      description: 'Widescreen review: four scenes full frame with your camera in a round bubble the whole time (its sound stays on) and chapter labels.',
      aspect: '16:9',
      music: { trackId: id, seed: 801, volume: 0.22, fadeIn: 0.5, fadeOut: 2 },
      tags: ['picture in picture', 'reaction', 'review', 'facecam'],
    },
    s,
    ['Unboxing', 'First look', 'The good', 'Verdict'].map((w, i) => text(`chapter${i + 1}`, `Chapter ${i + 1}`, w, i * four, Math.min(four, s.sec(2 * B)), 'label', { x: 0.12, y: 0.09 })),
  );
}

function finalHourTrailer(): VideoTemplate {
  const id = 'trailer-final-hour';
  const s = new Seq(beatSeconds(id));
  const pattern = [8, 4, 4, 2, 2, 1, 1, 1, 1, 8];
  pattern.forEach((b, i) => s.cut(b, full({ effects: LOOKS.dramatic, motion: b >= 4 ? { preset: 'zoom-in', amount: 1.1 } : { preset: 'punch-in', amount: 1.2 }, fadeIn: i === 0 ? 1 : 0.15, fadeOut: i === pattern.length - 1 ? 1.2 : 0.15 })));
  const bar = s.sec(B);
  return tpl(
    {
      id: 'featured-final-hour-trailer',
      name: 'Final Hour Trailer',
      category: 'Cinematic',
      description: 'Widescreen trailer: long dramatic holds that tighten into one-beat flashes, with three title cards and a closing title.',
      aspect: '16:9',
      music: { trackId: id, seed: 1601, volume: 0.7, fadeIn: 0.5, fadeOut: 2 },
      tags: ['trailer', 'dramatic', 'epic'],
    },
    s,
    [
      text('w1', 'Line 1', 'THIS SUMMER', bar, bar, { ...TEXT_STYLES.headline, fontFamily: TEXT_STYLES.outlined.fontFamily, fontWeight: 400, fontSize: 120 }, { y: 0.5 }, { fadeIn: 0.4, fadeOut: 0.4 }),
      text('w2', 'Line 2', 'ONE CHOICE', 2 * bar, bar, { ...TEXT_STYLES.headline, fontFamily: TEXT_STYLES.outlined.fontFamily, fontWeight: 400, fontSize: 120 }, { y: 0.5 }, { fadeIn: 0.3, fadeOut: 0.3 }),
      text('w3', 'Line 3', 'CHANGES EVERYTHING', 3 * bar, bar, { ...TEXT_STYLES.headline, fontFamily: TEXT_STYLES.outlined.fontFamily, fontWeight: 400, fontSize: 120 }, { y: 0.5 }, { fadeIn: 0.3, fadeOut: 0.3 }),
      text('title', 'Title', 'THE LAST LIGHT', s.t - 2 * bar, 2 * bar, { ...TEXT_STYLES.headline, fontSize: 150, color: '#f3e7d0' }, { y: 0.5 }, { fadeIn: 0.8, fadeOut: 1 }),
    ],
  );
}

export const FEATURED_TEMPLATES: readonly VideoTemplate[] = [
  beatFlip(),
  postcardTrail(),
  productSpotlight(),
  wordsOverWater(),
  thenAndNow(),
  cameraRollDump(),
  morningRoutine(),
  partyStarter(),
  cleanTitleReel(),
  talkingReview(),
  finalHourTrailer(),
];
