/**
 * The bulk of the built-in catalogue: an explicit, curated list of recipe
 * choices (one row per template). Rows are stable data — ids never change
 * between builds — and every row differs from the others in something you can
 * see or hear (layout, rhythm, look, motion, text treatment, music, aspect).
 * The catalogue tests check uniqueness of ids, names and build signatures.
 */
import { findTrack } from '../../music/catalogue';
import { composeTemplate, LAYOUTS, type LayoutId, type LookId, type MotionId, type Recipe, type RhythmId, type TextCopy, type TextRecipeId, type TransitionId } from '../recipes';
import type { SlotAccepts, TemplateAspect, VideoTemplate } from '../types';

/** Short keys for the music catalogue (track id + first variation seed). */
const MUSIC = {
  lofi: ['lofi-lazy-sunday', 101],
  pop: ['pop-bright-side', 201],
  corp: ['corporate-forward-together', 301],
  epic: ['cinematic-rise-of-titans', 401],
  ambient: ['ambient-still-water', 501],
  acoustic: ['acoustic-front-porch', 601],
  club: ['electronic-night-drive-club', 701],
  hiphop: ['hiphop-corner-store', 801],
  funk: ['funk-groove-machine', 901],
  synth: ['synthwave-neon-horizon', 1001],
  piano: ['piano-quiet-letters', 1101],
  suspense: ['suspense-under-the-surface', 1201],
  playful: ['playful-bubblegum-parade', 1301],
  travel: ['travel-postcards', 1401],
  tech: ['tech-circuit', 1501],
  trailer: ['trailer-final-hour', 1601],
  jazz: ['jazzhop-morning-coffee', 1701],
} as const;

type MusicKey = keyof typeof MUSIC;
/** `[key, variation]`, variation 1..3 (A..C). */
type MusicRef = [MusicKey, 1 | 2 | 3];

const RHYTHM_TEXT: Record<RhythmId, string> = {
  beat: 'cuts on every beat',
  half: 'cuts every half bar',
  bar: 'cuts every bar',
  long: 'a new shot every two bars',
  accelerate: 'cuts that speed up toward the end',
  wave: 'slow-fast-slow cuts',
  burst: 'a held intro, then a one-beat burst',
  dotted: 'syncopated 3-3-2 cuts',
  pairs: 'two quick cuts, then a held bar',
};

const MOTION_TEXT: Record<MotionId, string> = {
  still: 'no camera moves',
  push: 'slow push-ins',
  pull: 'slow pull-backs',
  drift: 'side-to-side drifts',
  kenburns: 'Ken Burns moves',
  punch: 'alternating punch-ins',
  pulse: 'a quick push on every cut',
};

function describe(layout: LayoutId, rhythm: RhythmId, motion: MotionId, look: LookId, music: MusicRef): string {
  const def = findTrack(MUSIC[music[0]][0])!;
  const lookText = look === 'clean' ? 'no color grade' : `a ${look.replace(/([A-Z])/g, ' $1').toLowerCase()} grade`;
  return `${LAYOUTS[layout].label}, ${RHYTHM_TEXT[rhythm]} of “${def.name}” (${def.bpm} BPM), ${MOTION_TEXT[motion]} and ${lookText}.`;
}

function row(
  id: string,
  name: string,
  category: string,
  aspect: TemplateAspect,
  layout: LayoutId,
  rhythm: RhythmId,
  count: number | undefined,
  look: LookId,
  motion: MotionId,
  transition: TransitionId,
  text: TextRecipeId,
  music: MusicRef,
  copy: TextCopy,
  extra: { accepts?: SlotAccepts; tags?: string[]; volume?: number } = {},
): Recipe {
  const [trackId, seed0] = MUSIC[music[0]];
  return {
    id: `tpl-${id}`,
    name,
    category,
    description: describe(layout, rhythm, motion, look, music),
    aspect,
    layout,
    rhythm,
    count,
    look,
    motion,
    transition,
    text,
    copy,
    music: { trackId, seed: seed0 + music[1] - 1, ...(extra.volume !== undefined ? { volume: extra.volume } : {}) },
    ...(extra.accepts ? { accepts: extra.accepts } : {}),
    ...(extra.tags ? { tags: extra.tags } : {}),
  };
}

const _ = undefined;

export const RECIPES: readonly Recipe[] = [
  // ---- Slideshow ----
  row('sunday-pages', 'Sunday Pages', 'Slideshow', '9:16', 'full', 'bar', 8, 'warm', 'kenburns', 'soft', 'headline', ['lofi', 1], { title: 'Sunday', sub: 'slow and easy' }),
  row('bright-days', 'Bright Days', 'Slideshow', '9:16', 'full', 'half', 12, 'vivid', 'punch', 'cut', 'outlined', ['pop', 2], { title: 'GOOD DAYS', outro: 'MORE SOON' }),
  row('soft-focus', 'Soft Focus', 'Slideshow', '4:5', 'blur', 'bar', 6, 'dream', 'push', 'soft', 'minimal', ['piano', 1], { title: 'little moments', outro: 'the end' }),
  row('square-story', 'Square Story', 'Slideshow', '1:1', 'framed', 'bar', 8, 'clean', 'drift', 'dip', 'caption', ['acoustic', 1], { title: 'a few favourites' }),
  row('wide-memories', 'Wide Memories', 'Slideshow', '16:9', 'full', 'long', 5, 'matte', 'kenburns', 'soft', 'titleOutro', ['piano', 2], { title: 'Memories', outro: 'Until next time' }),
  row('two-by-two', 'Two by Two', 'Slideshow', '9:16', 'full', 'pairs', 4, 'punchy', 'pulse', 'cut', 'glow', ['funk', 1], { title: 'two by two', outro: 'again!' }),

  // ---- Travel ----
  row('passport-stamps', 'Passport Stamps', 'Travel', '9:16', 'polaroid', 'bar', 6, 'warm', 'drift', 'soft', 'stamp', ['travel', 2], { title: 'ROUTE 01 · 2026' }),
  row('coastline', 'Coastline', 'Travel', '16:9', 'full', 'long', 5, 'teal', 'drift', 'soft', 'minimal', ['ambient', 2], { title: 'along the coast', outro: 'home again' }),
  row('weekend-escape', 'Weekend Escape', 'Travel', '9:16', 'full', 'accelerate', _, 'vivid', 'kenburns', 'cut', 'outlined', ['travel', 3], { title: 'ESCAPE', outro: 'BOOK IT' }),
  row('city-hop', 'City Hop', 'Travel', '4:5', 'split2', 'bar', 4, 'punchy', 'still', 'cut', 'chapters', ['tech', 2], { title: 'City hop', words: ['Morning', 'Noon', 'Night'] }),
  row('road-notes', 'Road Notes', 'Travel', '1:1', 'blur', 'half', 12, 'sunset', 'push', 'dip', 'caption', ['acoustic', 2], { title: 'notes from the road' }),
  row('summit-day', 'Summit Day', 'Travel', '9:16', 'full', 'wave', _, 'dramatic', 'push', 'cut', 'headline', ['epic', 1], { title: 'Summit', sub: '4,200 m' }),

  // ---- Photo dump ----
  row('flash-dump', 'Flash Dump', 'Photo dump', '9:16', 'full', 'beat', 16, 'punchy', 'punch', 'cut', 'stamp', ['club', 2], { title: 'FLASH · 03' }),
  row('weekly-dump', 'Weekly Dump', 'Photo dump', '4:5', 'full', 'beat', 20, 'matte', 'still', 'cut', 'minimal', ['hiphop', 1], { title: 'this week' }),
  row('burst-mode', 'Burst Mode', 'Photo dump', '9:16', 'polaroid', 'burst', _, 'vintage', 'still', 'cut', 'retro', ['funk', 2], { title: 'burst mode', sub: '24' }, { accepts: 'image' }),
  row('off-beat-dump', 'Off-Beat Dump', 'Photo dump', '1:1', 'full', 'dotted', 4, 'vivid', 'pulse', 'cut', 'caption', ['playful', 2], { title: 'random but cute' }),
  row('grid-roll', 'Grid Roll', 'Photo dump', '9:16', 'grid', 'half', 6, 'clean', 'still', 'cut', 'none', ['pop', 3], { title: '' }),
  row('mono-roll', 'Mono Roll', 'Photo dump', '9:16', 'full', 'beat', 16, 'bw', 'punch', 'cut', 'stamp', ['tech', 3], { title: 'B/W · ROLL 2' }),

  // ---- Vlog ----
  row('day-in-my-life', 'Day in My Life', 'Vlog', '9:16', 'full', 'bar', 8, 'matte', 'still', 'dip', 'chapters', ['jazz', 2], { title: '', words: ['Morning', 'Afternoon', 'Evening'] }, { accepts: 'video' }),
  row('countdown-intro', 'Countdown Intro', 'Vlog', '16:9', 'full', 'burst', _, 'punchy', 'punch', 'cut', 'countdown', ['synth', 1], { title: "LET'S GO" }),
  row('face-cam-diary', 'Face Cam Diary', 'Vlog', '9:16', 'bubble', 'long', 4, 'clean', 'still', 'soft', 'caption', ['lofi', 2], { title: 'quick update from me' }, { volume: 0.3 }),
  row('studio-update', 'Studio Update', 'Vlog', '16:9', 'bubble', 'bar', 6, 'matte', 'still', 'dip', 'lowerThird', ['corp', 2], { title: 'Studio update', sub: 'week 18' }, { volume: 0.3 }),
  row('weekend-log', 'Weekend Log', 'Vlog', '4:5', 'blur', 'half', 10, 'warm', 'push', 'cut', 'headline', ['acoustic', 3], { title: 'weekend log', sub: 'sat / sun' }, { accepts: 'video' }),
  row('night-out', 'Night Out', 'Vlog', '9:16', 'full', 'pairs', 4, 'cool', 'punch', 'cut', 'glow', ['club', 3], { title: 'night out', outro: 'gn' }),

  // ---- Celebration ----
  row('confetti-grid', 'Confetti Grid', 'Celebration', '9:16', 'gridBuild', 'bar', 3, 'punchy', 'still', 'cut', 'glow', ['playful', 3], { title: 'PARTY TIME', outro: 'thank you!' }),
  row('cheers', 'Cheers', 'Celebration', '1:1', 'full', 'half', 12, 'warm', 'punch', 'cut', 'kinetic', ['pop', 1], { title: 'CHEERS', words: ['CHEERS', 'TO', 'US'] }),
  row('cap-toss', 'Cap Toss', 'Celebration', '9:16', 'full', 'accelerate', _, 'vivid', 'push', 'cut', 'outlined', ['epic', 2], { title: 'CLASS OF 2026', outro: 'WE DID IT' }),
  row('ten-years', 'Ten Years', 'Celebration', '4:5', 'polaroid', 'bar', 6, 'dream', 'drift', 'soft', 'elegant', ['piano', 3], { title: 'Ten years', sub: '2016 — 2026', outro: 'and counting' }),
  row('countdown-night', 'Countdown Night', 'Celebration', '9:16', 'full', 'burst', _, 'punchy', 'pulse', 'cut', 'countdown', ['club', 1], { title: 'HAPPY NEW YEAR' }),
  row('hello-little-one', 'Hello Little One', 'Celebration', '4:5', 'framed', 'bar', 6, 'fade', 'push', 'soft', 'minimal', ['ambient', 3], { title: 'hello, little one', outro: 'welcome home' }),

  // ---- Product ----
  row('new-drop', 'New Drop', 'Product', '9:16', 'full', 'accelerate', _, 'punchy', 'punch', 'cut', 'product', ['tech', 1], { title: 'NEW DROP', sub: '$59', outro: 'SHOP NOW' }),
  row('unbox-it', 'Unbox It', 'Product', '1:1', 'framed', 'bar', 6, 'clean', 'push', 'dip', 'product', ['funk', 3], { title: 'Unboxing', sub: '$24', outro: 'LINK IN BIO' }),
  row('grid-sale', 'Grid Sale', 'Product', '1:1', 'grid', 'bar', 3, 'vivid', 'still', 'cut', 'product', ['pop', 2], { title: 'Weekend sale', sub: '-30%', outro: 'ENDS SUNDAY' }),
  row('three-colors', 'Three Colors', 'Product', '16:9', 'split3', 'bar', 4, 'clean', 'still', 'cut', 'product', ['corp', 3], { title: 'Three colors', sub: 'from $19' }),
  row('showroom', 'Showroom', 'Product', '16:9', 'blur', 'half', 10, 'cool', 'pulse', 'cut', 'lowerThird', ['tech', 2], { title: 'Showroom', sub: 'new collection' }),
  row('handmade', 'Handmade', 'Product', '4:5', 'polaroid', 'bar', 6, 'warm', 'push', 'soft', 'product', ['acoustic', 1], { title: 'Handmade mugs', sub: '$32', outro: 'ORDER NOW' }, { accepts: 'image' }),

  // ---- Quote ----
  row('dawn-thoughts', 'Dawn Thoughts', 'Quote', '9:16', 'full', 'long', 3, 'fade', 'push', 'soft', 'quote', ['ambient', 1], { title: 'Begin anywhere.', sub: '— morning note' }),
  row('rain-letter', 'Rain Letter', 'Quote', '4:5', 'full', 'long', 3, 'bw', 'pull', 'soft', 'quote', ['piano', 1], { title: 'Some days are for listening to the rain.', sub: '— a letter' }),
  row('loud-words', 'Loud Words', 'Quote', '9:16', 'full', 'bar', 4, 'dramatic', 'punch', 'cut', 'kinetic', ['trailer', 2], { title: 'DO IT', words: ['DO', 'IT', 'ANYWAY'] }),
  row('square-note', 'Square Note', 'Quote', '1:1', 'blur', 'long', 3, 'matte', 'push', 'soft', 'quote', ['jazz', 3], { title: 'Small steps still move you forward.', sub: '— note to self' }),
  row('screen-line', 'Screen Line', 'Quote', '16:9', 'full', 'long', 3, 'noir', 'push', 'soft', 'quote', ['suspense', 1], { title: 'Nothing is lost that can be found again.', sub: '— end credits' }),
  row('neon-mantra', 'Neon Mantra', 'Quote', '9:16', 'full', 'bar', 4, 'cool', 'drift', 'dip', 'glow', ['synth', 2], { title: 'stay curious', outro: 'stay kind' }),

  // ---- Before & After ----
  row('glow-up', 'Glow Up', 'Before & After', '9:16', 'split2', 'long', 2, 'clean', 'still', 'soft', 'beforeAfter', ['pop', 1], { title: '', words: ['BEFORE', 'AFTER'] }),
  row('room-makeover', 'Room Makeover', 'Before & After', '16:9', 'split2', 'long', 3, 'warm', 'push', 'soft', 'beforeAfter', ['acoustic', 2], { title: 'Room makeover', words: ['BEFORE', 'AFTER'] }),
  row('progress-check', 'Progress Check', 'Before & After', '4:5', 'split2', 'bar', 4, 'punchy', 'still', 'cut', 'beforeAfter', ['hiphop', 2], { title: 'Week 1 → Week 12', words: ['WEEK 1', 'WEEK 12'] }),
  row('garden-grow', 'Garden Grow', 'Before & After', '1:1', 'split2', 'long', 2, 'vivid', 'push', 'dip', 'beforeAfter', ['travel', 1], { title: '', words: ['MARCH', 'JULY'] }),
  row('raw-vs-edit', 'Raw vs Edit', 'Before & After', '9:16', 'split2', 'bar', 4, 'dramatic', 'still', 'cut', 'beforeAfter', ['tech', 3], { title: '', words: ['RAW', 'EDIT'] }),
  row('clean-sweep', 'Clean Sweep', 'Before & After', '4:5', 'split2', 'long', 2, 'cool', 'still', 'soft', 'beforeAfter', ['corp', 1], { title: '30-minute reset', words: ['MESSY', 'CLEAN'] }),

  // ---- Collage ----
  row('four-square', 'Four Square', 'Collage', '1:1', 'grid', 'bar', 4, 'clean', 'still', 'cut', 'none', ['lofi', 3], { title: '' }),
  row('build-up', 'Build Up', 'Collage', '9:16', 'gridBuild', 'bar', 4, 'warm', 'still', 'cut', 'headline', ['acoustic', 3], { title: 'our summer', sub: 'in squares' }),
  row('strips', 'Strips', 'Collage', '9:16', 'split3', 'bar', 4, 'vivid', 'still', 'cut', 'caption', ['pop', 3], { title: 'three of a kind' }),
  row('wide-triptych', 'Wide Triptych', 'Collage', '16:9', 'split3', 'long', 3, 'matte', 'still', 'soft', 'minimal', ['ambient', 2], { title: 'triptych' }),
  row('duo', 'Duo', 'Collage', '1:1', 'split2', 'half', 8, 'punchy', 'still', 'cut', 'glow', ['funk', 1], { title: 'better together' }),
  row('pinboard', 'Pinboard', 'Collage', '4:5', 'gridBuild', 'bar', 3, 'vintage', 'still', 'soft', 'retro', ['jazz', 1], { title: 'pinboard', sub: 'vol. 2' }),

  // ---- Minimal ----
  row('white-space', 'White Space', 'Minimal', '9:16', 'framed', 'long', 4, 'clean', 'still', 'soft', 'minimal', ['piano', 2], { title: 'less, but better' }),
  row('quiet-lines', 'Quiet Lines', 'Minimal', '16:9', 'full', 'long', 4, 'fade', 'drift', 'soft', 'minimal', ['ambient', 1], { title: 'quiet lines', outro: 'fin' }),
  row('plain-square', 'Plain Square', 'Minimal', '1:1', 'full', 'bar', 6, 'matte', 'still', 'dip', 'caption', ['lofi', 1], { title: 'just this' }),
  row('portfolio', 'Portfolio', 'Minimal', '4:5', 'framed', 'bar', 6, 'clean', 'push', 'soft', 'lowerThird', ['corp', 1], { title: 'Selected work', sub: '2024—2026' }),
  row('monochrome', 'Monochrome', 'Minimal', '9:16', 'full', 'bar', 6, 'bw', 'drift', 'soft', 'minimal', ['piano', 3], { title: 'in grey', outro: '—' }),
  row('simple-intro', 'Simple Intro', 'Minimal', '16:9', 'blur', 'bar', 4, 'clean', 'push', 'soft', 'titleOutro', ['corp', 2], { title: 'Welcome', outro: 'Subscribe for more' }),

  // ---- Cinematic ----
  row('epic-opening', 'Epic Opening', 'Cinematic', '16:9', 'full', 'wave', _, 'dramatic', 'push', 'dip', 'kinetic', ['epic', 1], { title: 'ONE', words: ['ONE', 'LAST', 'JOURNEY'] }),
  row('noir-streets', 'Noir Streets', 'Cinematic', '16:9', 'full', 'bar', 6, 'noir', 'drift', 'dip', 'minimal', ['suspense', 2], { title: 'the city sleeps' }),
  row('vertical-epic', 'Vertical Epic', 'Cinematic', '9:16', 'full', 'accelerate', _, 'teal', 'push', 'cut', 'headline', ['trailer', 1], { title: 'RISE', sub: 'a short film' }),
  row('slow-burn', 'Slow Burn', 'Cinematic', '16:9', 'blur', 'long', 4, 'dramatic', 'push', 'soft', 'caption', ['suspense', 3], { title: 'something is coming' }),
  row('teal-hour', 'Teal Hour', 'Cinematic', '16:9', 'full', 'half', 10, 'teal', 'kenburns', 'dip', 'titleOutro', ['synth', 3], { title: 'Teal Hour', outro: 'a film by you' }),
  row('trailer-square', 'Trailer Square', 'Cinematic', '1:1', 'full', 'burst', _, 'dramatic', 'punch', 'cut', 'outlined', ['trailer', 3], { title: 'COMING SOON', outro: '2026' }),

  // ---- Retro ----
  row('tape-memories', 'Tape Memories', 'Retro', '4:5', 'full', 'bar', 6, 'vintage', 'drift', 'cut', 'retro', ['synth', 1], { title: 'tape no. 3', sub: "'94" }),
  row('arcade-night', 'Arcade Night', 'Retro', '9:16', 'full', 'half', 12, 'sunset', 'punch', 'cut', 'retro', ['synth', 2], { title: 'ARCADE', sub: '1UP' }),
  row('film-roll', 'Film Roll', 'Retro', '9:16', 'polaroid', 'half', 10, 'sepiaSoft', 'still', 'cut', 'stamp', ['jazz', 2], { title: 'FILM 400 · 36EXP' }, { accepts: 'image' }),
  row('diner-booth', 'Diner Booth', 'Retro', '1:1', 'framed', 'bar', 6, 'vintage', 'push', 'dip', 'retro', ['funk', 3], { title: 'the diner', sub: 'est. 1962' }),
  row('old-postcard', 'Old Postcard', 'Retro', '16:9', 'polaroid', 'long', 4, 'sepiaSoft', 'drift', 'soft', 'elegant', ['travel', 2], { title: 'Greetings from', sub: 'somewhere warm' }),
  row('disco-fever', 'Disco Fever', 'Retro', '9:16', 'full', 'dotted', 4, 'sunset', 'pulse', 'cut', 'glow', ['funk', 2], { title: 'disco fever', outro: 'one more song' }),

  // ---- Food ----
  row('quick-recipe', 'Quick Recipe', 'Food', '9:16', 'full', 'bar', 8, 'warm', 'push', 'cut', 'chapters', ['jazz', 1], { title: '', words: ['Prep', 'Cook', 'Serve'] }),
  row('brunch-club', 'Brunch Club', 'Food', '1:1', 'grid', 'bar', 3, 'warm', 'still', 'cut', 'boxed', ['acoustic', 1], { title: 'Brunch club', sub: 'see you sunday' }),
  row('street-eats', 'Street Eats', 'Food', '9:16', 'full', 'beat', 16, 'vivid', 'punch', 'cut', 'outlined', ['hiphop', 3], { title: 'STREET EATS', outro: 'YUM' }),
  row('fresh-bake', 'Fresh Bake', 'Food', '4:5', 'blur', 'bar', 6, 'warm', 'push', 'soft', 'headline', ['lofi', 3], { title: 'fresh bake', sub: '6 am' }),
  row('menu-board', 'Menu Board', 'Food', '16:9', 'split3', 'bar', 3, 'vivid', 'still', 'cut', 'product', ['corp', 3], { title: "Today's menu", sub: 'from $9' }),
  row('pour-over', 'Pour Over', 'Food', '9:16', 'full', 'long', 3, 'matte', 'push', 'soft', 'minimal', ['jazz', 3], { title: 'pour over', outro: 'slowly' }),

  // ---- Fitness ----
  row('hiit-timer', 'HIIT Timer', 'Fitness', '9:16', 'full', 'beat', 20, 'punchy', 'punch', 'cut', 'kinetic', ['club', 1], { title: 'WORK', words: ['WORK', 'REST', 'REPEAT'] }),
  row('morning-run', 'Morning Run', 'Fitness', '16:9', 'full', 'half', 12, 'cool', 'drift', 'cut', 'lowerThird', ['tech', 1], { title: 'Morning run', sub: '5 km · 24:10' }),
  row('gym-split', 'Gym Split', 'Fitness', '9:16', 'split2', 'half', 6, 'dramatic', 'still', 'cut', 'chapters', ['hiphop', 1], { title: '', words: ['Push', 'Pull', 'Legs'] }),
  row('flow', 'Flow', 'Fitness', '4:5', 'full', 'long', 4, 'fade', 'push', 'soft', 'minimal', ['ambient', 3], { title: 'breathe in', outro: 'breathe out' }),
  row('match-day', 'Match Day', 'Fitness', '16:9', 'full', 'accelerate', _, 'vivid', 'punch', 'cut', 'outlined', ['epic', 3], { title: 'MATCH DAY', outro: 'GG' }),
  row('rep-count', 'Rep Count', 'Fitness', '1:1', 'full', 'pairs', 4, 'punchy', 'pulse', 'cut', 'countdown', ['pop', 2], { title: 'GO!' }),

  // ---- Business ----
  row('big-news', 'Big News', 'Business', '9:16', 'full', 'bar', 6, 'clean', 'push', 'cut', 'boxed', ['corp', 1], { title: 'Big news', sub: "We're hiring" }),
  row('meet-the-team', 'Meet the Team', 'Business', '16:9', 'grid', 'long', 2, 'clean', 'still', 'soft', 'lowerThird', ['corp', 2], { title: 'Meet the team', sub: 'Design studio' }),
  row('event-recap', 'Event Recap', 'Business', '16:9', 'full', 'half', 12, 'punchy', 'kenburns', 'cut', 'titleOutro', ['tech', 3], { title: 'Summit 2026', outro: 'See you next year' }),
  row('three-tips', 'Three Tips', 'Business', '9:16', 'blur', 'bar', 6, 'clean', 'still', 'dip', 'chapters', ['corp', 3], { title: '', words: ['Tip 1', 'Tip 2', 'Tip 3'] }),
  row('launch-teaser', 'Launch Teaser', 'Business', '1:1', 'full', 'burst', _, 'cool', 'punch', 'cut', 'glow', ['tech', 2], { title: 'launching soon', outro: '06.12' }),
  row('client-words', 'Client Words', 'Business', '4:5', 'framed', 'long', 3, 'matte', 'push', 'soft', 'quote', ['piano', 2], { title: 'They listened, then they delivered.', sub: '— a happy client' }),

  // ---- Love ----
  row('love-letter', 'Love Letter', 'Love', '9:16', 'polaroid', 'bar', 6, 'dream', 'drift', 'soft', 'elegant', ['piano', 1], { title: 'you & me', sub: 'since 2019', outro: 'always' }, { accepts: 'image' }),
  row('vows', 'Vows', 'Love', '16:9', 'blur', 'long', 4, 'fade', 'push', 'soft', 'elegant', ['ambient', 1], { title: 'Maya & Leo', sub: 'June 14', outro: 'forever starts now' }),
  row('date-night', 'Date Night', 'Love', '9:16', 'full', 'pairs', 3, 'warm', 'punch', 'cut', 'glow', ['jazz', 2], { title: 'date night', outro: 'xo' }),
  row('us-in-squares', 'Us in Squares', 'Love', '1:1', 'gridBuild', 'bar', 3, 'dream', 'still', 'soft', 'elegant', ['lofi', 2], { title: 'us', sub: 'in little squares' }),
  row('she-said-yes', 'She Said Yes', 'Love', '9:16', 'full', 'wave', _, 'warm', 'push', 'soft', 'outlined', ['acoustic', 2], { title: 'SHE SAID YES', outro: '♥' }),
  row('best-friend', 'Best Friend', 'Love', '4:5', 'split2', 'bar', 4, 'vivid', 'still', 'cut', 'caption', ['playful', 1], { title: 'my best friend' }),
];

let cache: VideoTemplate[] | null = null;

/** The generated templates (composed once, on first use). */
export function generatedTemplates(): readonly VideoTemplate[] {
  cache ??= RECIPES.map(composeTemplate);
  return cache;
}
