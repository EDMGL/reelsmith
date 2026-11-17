/**
 * Built-in music: original, procedurally composed recipes. Each `compose(seed)`
 * returns a deterministic, loopable arrangement (intro → sections → back to the
 * intro), with humanised timing/velocity, voice-led chords and drum fills at
 * phrase ends. Seeds (variations) change progressions, grooves, fills and melodies.
 */
import { arpPart, bassPart, chordPart, chordTimeline, Composer, drumPart, melodyPart, when } from '../synth/compose';
import type { BarInfo } from '../synth/sequence';
import { parseKey, parseProgression } from '../synth/theory';
import { choose, KIT, section } from './kit';
import type { MusicTrackDef } from './types';

const V = (a: number, b: number, c?: number) => [
  { label: 'A', seed: a },
  { label: 'B', seed: b },
  ...(c !== undefined ? [{ label: 'C', seed: c }] : []),
];

const P = parseProgression;

// ---------------------------------------------------------------------------

const lofi: MusicTrackDef = {
  id: 'lofi-lazy-sunday',
  name: 'Lazy Sunday',
  description: 'Dusty electric piano chords, swung boom-bap drums and vinyl crackle.',
  genre: 'Lo-fi',
  moods: ['chill', 'relaxed', 'study'],
  bpm: 78,
  key: 'F major',
  variations: V(101, 102, 103),
  compose(seed) {
    const key = parseKey('F major');
    const form = [
      section('intro', 4, 0.2, ['keys', 'vinyl']),
      section('a', 8, 0.6, ['keys', 'drums', 'bass', 'vinyl']),
      section('b', 8, 0.75, ['keys', 'drums', 'bass', 'lead', 'vinyl']),
      section('a2', 4, 0.5, ['keys', 'drums', 'bass', 'vinyl']),
    ];
    const c = new Composer(78, key, seed, form);
    const prog = choose(seed, 1, [P('ii7 V7 I7 vi7'), P('IV7 iii7 ii7 I7'), P('vi7 ii7 V7 I7')]);
    const chordAt = chordTimeline(key, { default: prog });
    const swing = 0.28;
    chordPart(c, { inst: 'keys', chordAt, lo: 53, hi: 72, style: 'broken', swing, active: when('keys'), vel: 0.55, pattern: (b) => (b.section.energy < 0.3 ? 'c-------........' : choose(seed + b.bar, 2, ['c-----c-..c-....', 'c-------..0.1.2.', 'c-----..c-..c-..'])) });
    drumPart(c, {
      swing,
      humanize: { ms: 9, vel: 0.15 },
      groove: (b) =>
        b.has('drums')
          ? { kick: b.local % 2 ? 'x......x..x.....' : 'x.........x.....', snare: '....x.......x..g', hat: 'o.g.o.g.o.g.o.gg' }
          : {},
      fills: { snare: 'snare', kick: 'kick', mute: ['hat'], when: 'big' },
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 29, swing, pattern: (b) => (b.has('bass') ? choose(seed + b.bar, 3, ['R-----...R-..A..', 'R-------..R-5...', 'R-----..5-..O.A.']) : null) });
    melodyPart(c, { inst: 'lead', chordAt, lo: 67, hi: 81, active: when('lead'), density: 0.3, swing, vel: 0.6 });
    c.note('vinyl', 0, c.totalBars * 4, seed % 97, 1);
    return c.build(
      {
        keys: { voice: 'epiano', gain: -9, reverb: 0.3, params: { cutoff: 2600 } },
        kick: { ...KIT.softKick, gain: 1 },
        snare: { ...KIT.softSnare, gain: -3 },
        hat: { ...KIT.hat, gain: -5, params: { tone: 0.2 } },
        bass: { voice: 'sub', gain: -4, params: { tone: 0.4 } },
        lead: { voice: 'lead', gain: -11, reverb: 0.35, delay: 0.25, params: { wave: 'triangle', cutoff: 1800, vibrato: 10 } },
        vinyl: { voice: 'vinyl', gain: -20 },
      },
      { reverb: { seconds: 2.2, brightness: 0.35, preDelay: 0.02, level: -6 }, delay: { beats: 0.75, feedback: 0.35, tone: 1800, level: -10 } },
    );
  },
};

const pop: MusicTrackDef = {
  id: 'pop-bright-side',
  name: 'Bright Side',
  description: 'Feel-good pop with plucky synth chords, claps and a hooky lead.',
  genre: 'Pop',
  moods: ['upbeat', 'happy', 'energetic'],
  bpm: 118,
  key: 'G major',
  variations: V(201, 202, 203),
  compose(seed) {
    const key = parseKey('G major');
    const form = [
      section('intro', 4, 0.35, ['chords', 'hats', 'kick']),
      section('verse', 8, 0.55, ['chords', 'drums', 'bass']),
      section('chorus', 8, 0.9, ['chords', 'drums', 'bass', 'lead', 'piano']),
      section('break', 4, 0.4, ['chords', 'bass', 'hats']),
      section('chorus2', 8, 0.95, ['chords', 'drums', 'bass', 'lead', 'piano']),
    ];
    const c = new Composer(118, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('I V vi IV'), P('vi IV I V'), P('I iii IV V')]), verse: choose(seed, 2, [P('vi IV I V'), P('IV I V vi')]) });
    chordPart(c, { inst: 'pluck', chordAt, lo: 60, hi: 76, style: 'stabs', vel: 0.65, pattern: () => choose(seed, 3, ['x..x..x...x..x..', 'x.x..x.x..x..x.x', '..x...x...x...xx']) });
    chordPart(c, { inst: 'piano', chordAt, lo: 55, hi: 72, style: 'stabs', active: when('piano'), vel: 0.6, pattern: () => 'x...x...x...x...' });
    drumPart(c, {
      humanize: { ms: 3, vel: 0.08 },
      groove: (b) => ({
        kick: b.has('drums') || b.has('kick') ? 'x.....x.x.....x.' : null,
        clap: b.has('drums') ? '....x.......x...' : null,
        hat: b.has('drums') || b.has('hats') ? (b.section.energy > 0.8 ? 'x.xxx.x.x.xxx.xo' : 'x.x.x.x.x.x.x.x.') : null,
        ohat: b.section.energy > 0.8 ? '..x...x...x...x.' : null,
      }),
      fills: { snare: 'clap', kick: 'kick', tom: 'tom', mute: ['hat', 'ohat'], when: 'phrase' },
      crash: 'crash',
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 31, pattern: (b) => (b.has('bass') ? (b.section.energy > 0.8 ? 'R.R.R.RoR.R.R.5.' : 'R..R..R.R..R..A.') : null), gate: 0.75 });
    melodyPart(c, { inst: 'lead', chordAt, lo: 67, hi: 83, active: when('lead'), density: 0.55, vel: 0.7 });
    return c.build(
      {
        pluck: { voice: 'synthpluck', gain: -9, reverb: 0.25, delay: 0.15, duck: 0.35, params: { cutoff: 1200, wave: 'sawtooth' } },
        piano: { voice: 'piano', gain: -9, reverb: 0.2, pan: -0.15 },
        kick: KIT.kick,
        clap: KIT.clap,
        hat: KIT.hat,
        ohat: KIT.ohat,
        tom: KIT.tom,
        crash: KIT.crash,
        bass: { voice: 'bass', gain: -5, duck: 0.3, params: { cutoff: 500, wave: 'square' } },
        lead: { voice: 'lead', gain: -13, reverb: 0.25, delay: 0.25, params: { wave: 'square', cutoff: 2200 } },
      },
      { reverb: { seconds: 1.8, brightness: 0.55, preDelay: 0.015, level: -7 }, delay: { beats: 0.75, feedback: 0.3, tone: 3000, level: -11 }, duck: { source: 'kick', release: 0.12 } },
    );
  },
};

const corporate: MusicTrackDef = {
  id: 'corporate-forward-together',
  name: 'Forward Together',
  description: 'Uplifting piano eighths, warm strings and a light, confident beat.',
  genre: 'Corporate',
  moods: ['uplifting', 'inspiring', 'positive'],
  bpm: 112,
  key: 'C major',
  variations: V(301, 302, 303),
  compose(seed) {
    const key = parseKey('C major');
    const form = [
      section('intro', 4, 0.3, ['piano']),
      section('a', 8, 0.55, ['piano', 'pad', 'kick', 'bass']),
      section('b', 8, 0.85, ['piano', 'pad', 'drums', 'bass', 'bells', 'guitar']),
      section('c', 8, 0.95, ['piano', 'pad', 'drums', 'bass', 'bells', 'guitar']),
      section('outro', 4, 0.45, ['piano', 'pad', 'bass']),
    ];
    const c = new Composer(112, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('I V vi IV'), P('IV I V vi'), P('vi IV I V')]), c: P('IV V iii vi') });
    chordPart(c, { inst: 'piano', chordAt, lo: 57, hi: 74, style: 'broken', vel: 0.6, pattern: () => choose(seed, 2, ['b.0.1.2.b.0.1.2.', 'b.1.0.2.b.1.0.2.', 'b.0.2.1.0.2.1.2.']) });
    chordPart(c, { inst: 'pad', chordAt, lo: 52, hi: 69, style: 'pad', active: when('pad'), vel: 0.6 });
    arpPart(c, { inst: 'guitar', chordAt, lo: 64, order: 'updown', octaves: 1, stepBeats: 0.5, active: when('guitar'), vel: 0.5 });
    drumPart(c, {
      groove: (b) => ({
        kick: b.has('kick') || b.has('drums') ? 'x.......x.......' : null,
        clap: b.has('drums') ? '....x.......x...' : null,
        hat: b.has('drums') ? '..x...x...x...x.' : null,
        shaker: b.has('drums') && b.section.energy > 0.9 ? 'xoxoxoxoxoxoxoxo' : null,
      }),
      fills: { snare: 'clap', tom: 'tom', mute: ['hat', 'shaker'], when: 'big' },
      crash: 'crash',
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 31, pattern: (b) => (b.has('bass') ? (b.section.energy > 0.8 ? 'R.R.R.R.R.R.R.R.' : 'R-------R-----A.') : null), gate: 0.8 });
    melodyPart(c, { inst: 'bells', chordAt, lo: 72, hi: 88, active: when('bells'), density: 0.35, vel: 0.55 });
    return c.build(
      {
        piano: { voice: 'piano', gain: -6, reverb: 0.25 },
        pad: { voice: 'strings', gain: -13, reverb: 0.4, params: { attack: 0.6, cutoff: 2200 } },
        guitar: { voice: 'pluck', gain: -13, pan: 0.35, delay: 0.2, params: { tone: 0.7 } },
        kick: KIT.softKick,
        clap: KIT.clap,
        hat: KIT.hat,
        shaker: KIT.shaker,
        tom: KIT.tom,
        crash: KIT.crash,
        bass: { voice: 'bass', gain: -6, params: { cutoff: 380, wave: 'triangle' } },
        bells: { voice: 'bell', gain: -16, reverb: 0.35, delay: 0.25, pan: -0.2 },
      },
      { reverb: { seconds: 2.4, brightness: 0.55, preDelay: 0.02, level: -6 }, delay: { beats: 0.75, feedback: 0.3, tone: 3500, level: -12 } },
    );
  },
};

const epic: MusicTrackDef = {
  id: 'cinematic-rise-of-titans',
  name: 'Rise of Titans',
  description: 'Driving string ostinato, brass swells, taiko-like toms and deep booms.',
  genre: 'Cinematic',
  moods: ['epic', 'powerful', 'heroic'],
  bpm: 90,
  key: 'D minor',
  variations: V(401, 402, 403),
  compose(seed) {
    const key = parseKey('D minor');
    const form = [
      section('intro', 4, 0.3, ['ostinato', 'pad']),
      section('build', 8, 0.6, ['ostinato', 'pad', 'toms', 'bass']),
      section('full', 8, 1, ['ostinato', 'pad', 'toms', 'bass', 'brass', 'boom', 'lead']),
      section('calm', 4, 0.35, ['pad', 'ostinato']),
    ];
    const c = new Composer(90, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('i VI III VII'), P('i iv VI V'), P('i VII VI VII')]) });
    // Low string ostinato: root/fifth/octave sixteenths.
    arpPart(c, { inst: 'ostinato', chordAt, lo: 45, order: choose(seed, 2, ['up', 'converge', 'updown'] as const), octaves: 1, stepBeats: 0.25, gate: 0.6, vel: 0.6, active: when('ostinato'), rhythm: () => 'xxoxxxoxxxoxxxox' });
    chordPart(c, { inst: 'pad', chordAt, lo: 50, hi: 69, style: 'pad', active: when('pad'), vel: 0.7 });
    chordPart(c, { inst: 'brass', chordAt, lo: 48, hi: 64, style: 'stabs', active: when('brass'), vel: 0.8, pattern: (b) => (b.local % 2 === 0 ? 'x-------....x---' : 'x-----------....') });
    drumPart(c, {
      humanize: { ms: 5, vel: 0.1 },
      groove: (b) => ({
        tom: b.has('toms') ? (b.section.energy > 0.9 ? 'x..xx.x.x..x.xx.' : 'x.....x.x.......') : null,
        snare: b.section.energy > 0.9 ? '....x.......x...' : null,
      }),
      fills: { snare: 'snare', tom: 'tom', when: 'phrase' },
      crash: 'crash',
    });
    for (const b of c.bars) if (b.has('boom') && b.local % 2 === 0) c.note('boom', c.barStart(b.bar), 3, 0, 0.9);
    bassPart(c, { inst: 'bass', chordAt, lo: 26, pattern: (b) => (b.has('bass') ? 'R-------R-------' : null) });
    melodyPart(c, { inst: 'lead', chordAt, lo: 62, hi: 77, active: when('lead'), density: 0.15, vel: 0.75, breathe: true });
    return c.build(
      {
        ostinato: { voice: 'strings', gain: -8, reverb: 0.3, params: { attack: 0.01, release: 0.1, cutoff: 3000, vibrato: 0 } },
        pad: { voice: 'strings', gain: -12, reverb: 0.5, params: { attack: 0.8, cutoff: 1800 } },
        brass: { voice: 'brass', gain: -9, reverb: 0.4, params: { cutoff: 900 } },
        tom: { ...KIT.tom, gain: -5, reverb: 0.35, params: { decay: 0.45 } },
        snare: { ...KIT.snare, gain: -7, reverb: 0.5 },
        crash: KIT.crash,
        boom: { voice: 'boom', gain: -5, reverb: 0.4 },
        bass: { voice: 'sub', gain: -6 },
        lead: { voice: 'strings', gain: -10, reverb: 0.5, params: { attack: 0.2, cutoff: 3500, vibrato: 14 } },
      },
      { reverb: { seconds: 3.2, brightness: 0.45, preDelay: 0.03, level: -4 } },
    );
  },
};

const ambient: MusicTrackDef = {
  id: 'ambient-still-water',
  name: 'Still Water',
  description: 'Slow-breathing pads, soft bells drifting through echoes. No drums.',
  genre: 'Ambient',
  moods: ['calm', 'peaceful', 'meditative'],
  bpm: 70,
  key: 'E major',
  variations: V(501, 502, 503),
  compose(seed) {
    const key = parseKey('E major');
    const form = [section('a', 8, 0.3, ['pad', 'bells', 'sub']), section('b', 8, 0.4, ['pad', 'bells', 'sub', 'arp'])];
    const c = new Composer(70, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [[{ degree: 0, add9: true }, { degree: 3, add9: true }, { degree: 5, size: 4 }, { degree: 3, add9: true }], P('I IV I V'), P('vi7 IV I V')]) }, 2);
    chordPart(c, { inst: 'pad', chordAt, lo: 52, hi: 71, style: 'pad', vel: 0.75 });
    bassPart(c, { inst: 'sub', chordAt, lo: 28, pattern: () => 'R---------------' });
    arpPart(c, { inst: 'arp', chordAt, lo: 64, order: 'random', octaves: 2, stepBeats: 1, gate: 2, active: when('arp'), vel: 0.4, rhythm: () => 'x...x.......x...' });
    melodyPart(c, { inst: 'bells', chordAt, lo: 71, hi: 88, active: (b: BarInfo) => b.local % 2 === 0, density: 0.1, vel: 0.45 });
    return c.build(
      {
        pad: { voice: 'pad', gain: -6, reverb: 0.6, params: { attack: 2.5, release: 3, cutoff: 1100, wave: 'sawtooth', detune: 12, vibrato: 4 } },
        sub: { voice: 'sub', gain: -12, params: { attack: 1, release: 2 } },
        arp: { voice: 'mallet', gain: -14, reverb: 0.6, delay: 0.5, pan: 0.3, params: { tone: 0.2 } },
        bells: { voice: 'bell', gain: -13, reverb: 0.7, delay: 0.5, pan: -0.25 },
      },
      { reverb: { seconds: 4.5, brightness: 0.4, preDelay: 0.04, level: -3 }, delay: { beats: 1.5, feedback: 0.45, tone: 2500, level: -8 } },
    );
  },
};

const acoustic: MusicTrackDef = {
  id: 'acoustic-front-porch',
  name: 'Front Porch',
  description: 'Warm strummed guitar, shaker and a gentle marimba tune.',
  genre: 'Acoustic',
  moods: ['warm', 'happy', 'organic'],
  bpm: 96,
  key: 'G major',
  variations: V(601, 602, 603),
  compose(seed) {
    const key = parseKey('G major');
    const form = [
      section('intro', 4, 0.3, ['guitar']),
      section('verse', 8, 0.55, ['guitar', 'perc', 'bass']),
      section('chorus', 8, 0.8, ['guitar', 'perc', 'bass', 'melody', 'kick']),
      section('verse2', 8, 0.6, ['guitar', 'perc', 'bass', 'kick']),
    ];
    const c = new Composer(96, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('I V vi IV'), P('I IV vi V'), P('IV I V vi')]), chorus: P('IV I V vi') });
    const swing = 0.12;
    chordPart(c, { inst: 'guitar', chordAt, lo: 52, hi: 71, style: 'strum', swing, vel: 0.75, pattern: () => choose(seed, 2, ['x.x..xx.x.x..x.x', 'x..x..x.x.xx.x..', 'x.x.x.xxx.x.x.xx']) });
    drumPart(c, {
      swing,
      humanize: { ms: 6, vel: 0.15 },
      groove: (b) => ({
        shaker: b.has('perc') ? 'xoxoxoxoxoxoxoxo' : null,
        kick: b.has('kick') ? 'x.......x.....x.' : null,
        rim: b.has('perc') ? '....x.......x...' : null,
      }),
      fills: { snare: 'rim', mute: ['shaker'], when: 'big' },
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 31, swing, pattern: (b) => (b.has('bass') ? 'R-----..5-....A.' : null), gate: 0.85 });
    melodyPart(c, { inst: 'marimba', chordAt, lo: 67, hi: 84, active: when('melody'), density: 0.5, swing, vel: 0.7 });
    return c.build(
      {
        guitar: { voice: 'guitar', gain: -6, reverb: 0.25, pan: -0.1, params: { tone: 0.55 } },
        shaker: KIT.shaker,
        kick: KIT.softKick,
        rim: { ...KIT.rim, params: { pitch: 1300 } },
        bass: { voice: 'bass', gain: -7, params: { wave: 'triangle', cutoff: 320 } },
        marimba: { voice: 'mallet', gain: -8, reverb: 0.3, pan: 0.2, params: { tone: 0.6 } },
      },
      { reverb: { seconds: 1.6, brightness: 0.45, preDelay: 0.015, level: -7 } },
    );
  },
};

const dance: MusicTrackDef = {
  id: 'electronic-night-drive-club',
  name: 'After Hours',
  description: 'Four-on-the-floor house groove with pumping pads and a rolling arp.',
  genre: 'Electronic',
  moods: ['energetic', 'dance', 'night'],
  bpm: 124,
  key: 'F minor',
  variations: V(701, 702, 703),
  compose(seed) {
    const key = parseKey('F minor');
    const form = [
      section('intro', 8, 0.4, ['kick', 'hats', 'pad']),
      section('a', 8, 0.75, ['drums', 'pad', 'bass', 'arp']),
      section('b', 8, 0.95, ['drums', 'pad', 'bass', 'arp', 'lead']),
      section('break', 4, 0.3, ['pad', 'arp']),
      section('c', 4, 0.9, ['drums', 'pad', 'bass', 'arp']),
    ];
    const c = new Composer(124, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('i VI III VII'), P('i VII VI VII'), P('vi7 iv7 i7 v7')]) });
    chordPart(c, { inst: 'pad', chordAt, lo: 53, hi: 72, style: 'pad', vel: 0.7 });
    arpPart(c, { inst: 'arp', chordAt, lo: 65, order: choose(seed, 2, ['up', 'updown', 'converge'] as const), octaves: 2, stepBeats: 0.25, gate: 0.5, active: when('arp'), vel: 0.6 });
    drumPart(c, {
      humanize: { ms: 1.5, vel: 0.06 },
      groove: (b) => ({
        kick: b.has('drums') || b.has('kick') ? 'x...x...x...x...' : null,
        clap: b.has('drums') ? '....x.......x...' : null,
        hat: b.has('drums') || b.has('hats') ? 'gxgxgxgxgxgxgxgx' : null,
        ohat: b.has('drums') ? '..x...x...x...x.' : null,
      }),
      fills: { snare: 'clap', mute: ['hat', 'ohat'], when: 'big' },
      crash: 'crash',
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 29, pattern: (b) => (b.has('bass') ? '..R...R...R...R.' : null), gate: 0.7 });
    melodyPart(c, { inst: 'lead', chordAt, lo: 72, hi: 86, active: when('lead'), density: 0.4, vel: 0.6 });
    for (const b of c.bars) if (b.sectionEnd && b.section.name !== 'c') c.note('riser', c.barStart(b.bar), 4, 0, 0.6);
    return c.build(
      {
        pad: { voice: 'pad', gain: -12, reverb: 0.4, duck: 0.6, params: { cutoff: 1600, attack: 0.15, release: 0.6 } },
        arp: { voice: 'synthpluck', gain: -13, delay: 0.3, reverb: 0.2, duck: 0.35, pan: 0.15, params: { cutoff: 1500, env: 4 } },
        kick: KIT.kick,
        clap: KIT.clap,
        hat: KIT.hat,
        ohat: { ...KIT.ohat, gain: -16 },
        crash: KIT.crash,
        bass: { voice: 'bass', gain: -5, duck: 0.5, params: { cutoff: 600, wave: 'sawtooth', reso: 3 } },
        lead: { voice: 'lead', gain: -12, delay: 0.35, reverb: 0.3, params: { wave: 'sawtooth', cutoff: 2600 } },
        riser: { voice: 'riser', gain: -14, reverb: 0.3 },
      },
      { reverb: { seconds: 2, brightness: 0.5, preDelay: 0.02, level: -7 }, delay: { beats: 0.75, feedback: 0.4, tone: 2800, level: -10 }, duck: { source: 'kick', release: 0.14 } },
    );
  },
};

const hiphop: MusicTrackDef = {
  id: 'hiphop-corner-store',
  name: 'Corner Store',
  description: 'Head-nodding boom-bap with a dark piano loop and deep sub bass.',
  genre: 'Hip-hop',
  moods: ['cool', 'urban', 'confident'],
  bpm: 88,
  key: 'C minor',
  variations: V(801, 802, 803),
  compose(seed) {
    const key = parseKey('C minor');
    const form = [
      section('intro', 4, 0.3, ['piano', 'hats']),
      section('a', 8, 0.8, ['piano', 'drums', 'bass']),
      section('b', 8, 0.85, ['piano', 'drums', 'bass', 'bells']),
      section('a2', 4, 0.75, ['piano', 'drums', 'bass']),
    ];
    const c = new Composer(88, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('i VI iv v'), P('i iv VI v'), P('i VII VI v')]) });
    const swing = 0.22;
    chordPart(c, { inst: 'piano', chordAt, lo: 55, hi: 72, style: 'broken', swing, vel: 0.6, pattern: () => choose(seed, 2, ['c-----..2.1.0...', 'c-....c-..c-....', 'c-------0.1.2.1.']) });
    drumPart(c, {
      swing,
      humanize: { ms: 7, vel: 0.12 },
      groove: (b) => ({
        kick: b.has('drums') ? choose(seed + b.local, 3, ['x.....x...x.....', 'x......xx.x.....', 'x.....x..x....x.']) : null,
        snare: b.has('drums') ? '....x.......x...' : null,
        hat: b.has('drums') || b.has('hats') ? 'x.o.x.o.x.o.x.oo' : null,
        rim: b.section.name === 'b' ? '...........g..g.' : null,
      }),
      fills: { snare: 'snare', kick: 'kick', mute: ['hat'], when: 'big' },
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 24, swing, pattern: (b) => (b.has('bass') ? 'R-----R-..R-----' : null), gate: 0.95 });
    melodyPart(c, { inst: 'bells', chordAt, lo: 72, hi: 84, active: when('bells'), density: 0.25, swing, vel: 0.5 });
    return c.build(
      {
        piano: { voice: 'piano', gain: -6, reverb: 0.25, params: { cutoff: 2200 } },
        kick: { ...KIT.kick, params: { pitch: 48, decay: 0.5, tone: 0.6 } },
        snare: { ...KIT.snare, gain: -1, params: { tone: 0.35 } },
        hat: { ...KIT.hat, gain: -10 },
        rim: KIT.rim,
        bass: { voice: 'sub', gain: -3, params: { tone: 0.5, release: 0.15 } },
        bells: { voice: 'bell', gain: -16, reverb: 0.4, delay: 0.3, pan: 0.25 },
      },
      { reverb: { seconds: 1.6, brightness: 0.4, preDelay: 0.01, level: -8 }, delay: { beats: 0.5, feedback: 0.35, tone: 2200, level: -11 } },
    );
  },
};

const funk: MusicTrackDef = {
  id: 'funk-groove-machine',
  name: 'Groove Machine',
  description: 'Syncopated slap-style bass, clav-like stabs and tight ghost-note drums.',
  genre: 'Funk',
  moods: ['groovy', 'fun', 'energetic'],
  bpm: 104,
  key: 'E dorian',
  variations: V(901, 902, 903),
  compose(seed) {
    const key = parseKey('E dorian');
    const form = [
      section('intro', 4, 0.5, ['drums', 'bass']),
      section('a', 8, 0.8, ['drums', 'bass', 'clav']),
      section('b', 8, 0.9, ['drums', 'bass', 'clav', 'brass']),
      section('a2', 4, 0.75, ['drums', 'bass', 'clav']),
    ];
    const c = new Composer(104, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('i7 IV7'), P('i7 i7 IV7 v7'), P('i7 IV7 i7 VII')]), b: P('III7 IV7 v7 i7') });
    const swing = 0.08;
    chordPart(c, { inst: 'clav', chordAt, lo: 60, hi: 74, style: 'stabs', swing, active: when('clav'), vel: 0.65, pattern: () => choose(seed, 2, ['..x..x.x..x..x.x', '.x.x..x..x.x..x.', '..xx..x...x.x..x']) });
    chordPart(c, { inst: 'brass', chordAt, lo: 60, hi: 76, style: 'stabs', active: when('brass'), vel: 0.8, pattern: (b) => (b.local % 2 === 1 ? '..........x.x---' : null) });
    drumPart(c, {
      swing,
      humanize: { ms: 4, vel: 0.15 },
      groove: () => ({
        kick: choose(seed, 3, ['x.....x...x..x..', 'x..x......x..x..', 'x.....xx..x.....']),
        snare: '....x..g.g..x..g',
        hat: 'xoxoxoxoxoxoxoxo',
        ohat: '..............x.',
      }),
      fills: { snare: 'snare', kick: 'kick', tom: 'tom', mute: ['hat', 'ohat'], when: 'phrase' },
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 28, swing, gate: 0.55, pattern: (b) => (b.local % 2 === 0 ? 'R..O.R..R.5.O.r.' : 'R..O..R.RO..5.A.') });
    return c.build(
      {
        clav: { voice: 'synthpluck', gain: -11, pan: -0.25, reverb: 0.1, params: { wave: 'square', cutoff: 1800, reso: 5, env: 2, decay: 0.12, sustain: 0.1 } },
        brass: { voice: 'brass', gain: -11, pan: 0.2, reverb: 0.2, params: { cutoff: 1600 } },
        kick: KIT.kick,
        snare: KIT.snare,
        hat: { ...KIT.hat, gain: -11 },
        ohat: KIT.ohat,
        tom: KIT.tom,
        bass: { voice: 'bass', gain: -3, params: { wave: 'sawtooth', cutoff: 700, env: 4, decay: 0.12, sustain: 0.4, reso: 4 } },
      },
      { reverb: { seconds: 1.3, brightness: 0.5, preDelay: 0.01, level: -9 } },
    );
  },
};

const synthwave: MusicTrackDef = {
  id: 'synthwave-neon-horizon',
  name: 'Neon Horizon',
  description: 'Retro pulsing octave bass, wide saw pads, big reverb snare and a singing lead.',
  genre: 'Synthwave',
  moods: ['retro', 'nostalgic', 'driving'],
  bpm: 100,
  key: 'A minor',
  variations: V(1001, 1002, 1003),
  compose(seed) {
    const key = parseKey('A minor');
    const form = [
      section('intro', 4, 0.35, ['pad', 'bass']),
      section('a', 8, 0.7, ['pad', 'bass', 'drums', 'arp']),
      section('b', 8, 0.9, ['pad', 'bass', 'drums', 'arp', 'lead']),
      section('a2', 8, 0.75, ['pad', 'bass', 'drums', 'lead']),
    ];
    const c = new Composer(100, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('i VI III VII'), P('VI VII i i'), P('i iv VI VII')]) });
    chordPart(c, { inst: 'pad', chordAt, lo: 55, hi: 72, style: 'pad', vel: 0.7 });
    bassPart(c, { inst: 'bass', chordAt, lo: 33, pattern: () => 'RORORORORORORORO', gate: 0.6 });
    arpPart(c, { inst: 'arp', chordAt, lo: 69, order: 'up', octaves: 2, stepBeats: 0.25, gate: 0.45, active: when('arp'), vel: 0.5 });
    drumPart(c, {
      humanize: { ms: 2, vel: 0.06 },
      groove: (b) => ({
        kick: b.has('drums') ? 'x.......x.......' : null,
        snare: b.has('drums') ? '....x.......x...' : null,
        hat: b.has('drums') ? 'x.x.x.x.x.x.x.x.' : null,
      }),
      fills: { snare: 'snare', tom: 'tom', mute: ['hat'], when: 'big' },
      crash: 'crash',
    });
    melodyPart(c, { inst: 'lead', chordAt, lo: 69, hi: 84, active: when('lead'), density: 0.35, vel: 0.7 });
    return c.build(
      {
        pad: { voice: 'pad', gain: -9, reverb: 0.4, duck: 0.25, params: { cutoff: 2000, attack: 0.3, detune: 14 } },
        bass: { voice: 'bass', gain: -6, duck: 0.2, params: { wave: 'sawtooth', cutoff: 550, env: 3, decay: 0.12 } },
        arp: { voice: 'synthpluck', gain: -11, delay: 0.35, pan: 0.2, params: { wave: 'square', cutoff: 1400 } },
        kick: { ...KIT.kick, gain: 3 },
        snare: { ...KIT.snare, gain: -6, reverb: 0.6, params: { decay: 0.22 } },
        hat: KIT.hat,
        tom: { ...KIT.tom, reverb: 0.5 },
        crash: KIT.crash,
        lead: { voice: 'lead', gain: -10, reverb: 0.35, delay: 0.4, params: { wave: 'sawtooth', cutoff: 2000, vibrato: 18 } },
      },
      { reverb: { seconds: 2.8, brightness: 0.5, preDelay: 0.02, level: -5 }, delay: { beats: 0.75, feedback: 0.45, tone: 2400, level: -9 }, duck: { source: 'kick', release: 0.2 } },
    );
  },
};

const piano: MusicTrackDef = {
  id: 'piano-quiet-letters',
  name: 'Quiet Letters',
  description: 'Tender solo piano with flowing arpeggios and soft strings underneath.',
  genre: 'Piano',
  moods: ['emotional', 'sad', 'reflective'],
  bpm: 72,
  key: 'C major',
  variations: V(1101, 1102, 1103),
  compose(seed) {
    const key = parseKey('C major');
    const form = [
      section('a', 8, 0.35, ['piano', 'melody']),
      section('b', 8, 0.55, ['piano', 'melody', 'strings']),
    ];
    const c = new Composer(72, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('vi IV I V'), P('I V/3 vi IV'), P('IV I/3 ii V')]) });
    chordPart(c, { inst: 'piano', chordAt, lo: 55, hi: 70, style: 'broken', vel: 0.45, bassLo: 36, pattern: () => choose(seed, 2, ['b.0.1.2.1.0.1.2.', 'b.1.2.0.2.1.2.0.', 'b.0.2.1.2.0.2.1.']) });
    melodyPart(c, { inst: 'melody', chordAt, lo: 67, hi: 81, active: when('melody'), density: 0.2, vel: 0.65 });
    chordPart(c, { inst: 'strings', chordAt, lo: 52, hi: 67, style: 'pad', active: when('strings'), vel: 0.55 });
    return c.build(
      {
        piano: { voice: 'piano', gain: -4, reverb: 0.4, params: { cutoff: 2600, release: 0.6 } },
        melody: { voice: 'piano', gain: -3, reverb: 0.4, pan: 0.1, params: { cutoff: 4000, release: 0.5 } },
        strings: { voice: 'strings', gain: -15, reverb: 0.6, params: { attack: 1.2, release: 1.5, cutoff: 1600 } },
      },
      { reverb: { seconds: 3, brightness: 0.4, preDelay: 0.025, level: -4 } },
    );
  },
};

const suspense: MusicTrackDef = {
  id: 'suspense-under-the-surface',
  name: 'Under the Surface',
  description: 'Low pulsing synth, ticking percussion, dissonant pads and slow risers.',
  genre: 'Suspense',
  moods: ['tense', 'dark', 'mysterious'],
  bpm: 84,
  key: 'D phrygian',
  variations: V(1201, 1202, 1203),
  compose(seed) {
    const key = parseKey('D phrygian');
    const form = [
      section('a', 8, 0.35, ['pulse', 'pad', 'tick']),
      section('b', 8, 0.65, ['pulse', 'pad', 'tick', 'heart', 'bell']),
    ];
    const c = new Composer(84, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('i II i VII'), P('i i II i'), P('i VI II i')]) }, 2);
    bassPart(c, { inst: 'pulse', chordAt, lo: 26, pattern: () => 'R.R.R.R.R.R.R.R.', gate: 0.5 });
    chordPart(c, { inst: 'pad', chordAt, lo: 50, hi: 66, style: 'pad', vel: 0.6 });
    drumPart(c, {
      humanize: { ms: 2, vel: 0.1 },
      groove: (b) => ({
        rim: b.has('tick') ? 'x...x...x...x...' : null,
        kick: b.has('heart') ? 'x..x............' : null,
      }),
    });
    melodyPart(c, { inst: 'bell', chordAt, lo: 74, hi: 86, active: when('bell'), density: 0.1, vel: 0.4 });
    for (const b of c.bars) if (b.sectionEnd) c.note('riser', c.barStart(b.bar) - 4, 8, 0, 0.5);
    return c.build(
      {
        pulse: { voice: 'bass', gain: -6, params: { wave: 'sawtooth', cutoff: 260, env: 1.5, decay: 0.1, sustain: 0.3 } },
        pad: { voice: 'pad', gain: -10, reverb: 0.6, params: { attack: 2, release: 2, cutoff: 900, detune: 18, vibrato: 8 } },
        rim: { ...KIT.rim, gain: -16, params: { pitch: 2400, decay: 0.02 } },
        kick: { ...KIT.softKick, gain: -2, params: { pitch: 45, decay: 0.35, tone: 0.1 } },
        bell: { voice: 'bell', gain: -16, reverb: 0.7, delay: 0.5, pan: 0.3 },
        riser: { voice: 'riser', gain: -16, reverb: 0.5 },
      },
      { reverb: { seconds: 4, brightness: 0.35, preDelay: 0.03, level: -4 }, delay: { beats: 1.5, feedback: 0.5, tone: 1800, level: -9 } },
    );
  },
};

const playful: MusicTrackDef = {
  id: 'playful-bubblegum-parade',
  name: 'Bubblegum Parade',
  description: 'Bouncy marimba, plucky strings, hand claps and a whistle-like tune.',
  genre: 'Playful',
  moods: ['happy', 'playful', 'kids'],
  bpm: 122,
  key: 'F major',
  variations: V(1301, 1302, 1303),
  compose(seed) {
    const key = parseKey('F major');
    const form = [
      section('intro', 4, 0.4, ['marimba', 'claps']),
      section('a', 8, 0.7, ['marimba', 'claps', 'bass', 'pizz', 'kick']),
      section('b', 8, 0.85, ['marimba', 'claps', 'bass', 'pizz', 'kick', 'whistle']),
      section('a2', 4, 0.7, ['marimba', 'bass', 'pizz', 'kick']),
    ];
    const c = new Composer(122, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('I vi IV V'), P('I IV V I'), P('I V IV V')]) });
    chordPart(c, { inst: 'marimba', chordAt, lo: 60, hi: 76, style: 'stabs', vel: 0.6, pattern: () => choose(seed, 2, ['..x...x...x...x.', '..x.x...x.x...x.', 'x.x...x.x.x...x.']) });
    arpPart(c, { inst: 'pizz', chordAt, lo: 55, order: 'updown', octaves: 1, stepBeats: 0.5, gate: 0.3, active: when('pizz'), vel: 0.6 });
    drumPart(c, {
      groove: (b) => ({
        kick: b.has('kick') ? 'x.......x.......' : null,
        clap: b.has('claps') ? '....x.......x...' : null,
        shaker: b.has('kick') ? 'x.x.x.x.x.x.x.x.' : null,
      }),
      fills: { snare: 'clap', mute: ['shaker'], when: 'big' },
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 33, pattern: (b) => (b.has('bass') ? 'R...5...R...5.A.' : null), gate: 0.4 });
    melodyPart(c, { inst: 'whistle', chordAt, lo: 72, hi: 88, active: when('whistle'), density: 0.6, vel: 0.65 });
    return c.build(
      {
        marimba: { voice: 'mallet', gain: -7, reverb: 0.2, pan: -0.15, params: { tone: 0.8 } },
        pizz: { voice: 'pluck', gain: -11, reverb: 0.25, pan: 0.25, params: { tone: 0.9, release: 0.08 } },
        kick: KIT.softKick,
        clap: KIT.clap,
        shaker: KIT.shaker,
        bass: { voice: 'bass', gain: -6, params: { wave: 'triangle', cutoff: 500, decay: 0.15, sustain: 0.3 } },
        whistle: { voice: 'lead', gain: -11, reverb: 0.3, params: { wave: 'sine', vibrato: 20, cutoff: 4000 } },
      },
      { reverb: { seconds: 1.5, brightness: 0.6, preDelay: 0.01, level: -8 } },
    );
  },
};

const travel: MusicTrackDef = {
  id: 'travel-postcards',
  name: 'Postcards',
  description: 'Sunny tropical-tinged groove for vlogs: offbeat plucks, shakers and a light kick.',
  genre: 'Travel',
  moods: ['sunny', 'adventure', 'vlog'],
  bpm: 106,
  key: 'D major',
  variations: V(1401, 1402, 1403),
  compose(seed) {
    const key = parseKey('D major');
    const form = [
      section('intro', 4, 0.35, ['plucks', 'shaker']),
      section('a', 8, 0.7, ['plucks', 'shaker', 'drums', 'bass']),
      section('b', 8, 0.85, ['plucks', 'shaker', 'drums', 'bass', 'lead', 'pad']),
      section('a2', 8, 0.7, ['plucks', 'shaker', 'drums', 'bass', 'pad']),
    ];
    const c = new Composer(106, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('I V vi IV'), P('IV V iii vi'), P('vi IV I V')]) });
    const swing = 0.1;
    chordPart(c, { inst: 'plucks', chordAt, lo: 62, hi: 77, style: 'stabs', swing, vel: 0.6, pattern: () => choose(seed, 2, ['..x...x...x...x.', '..x..x.x..x..x.x', '..x.x.x...x.x.x.']) });
    chordPart(c, { inst: 'pad', chordAt, lo: 54, hi: 69, style: 'pad', active: when('pad'), vel: 0.5 });
    drumPart(c, {
      swing,
      humanize: { ms: 4, vel: 0.12 },
      groove: (b) => ({
        kick: b.has('drums') ? 'x.......x..x....' : null,
        clap: b.has('drums') ? '....x.......x...' : null,
        shaker: b.has('shaker') ? 'xoxoxoxoxoxoxoxo' : null,
        rim: b.has('drums') ? '...x..x.......x.' : null,
      }),
      fills: { snare: 'clap', tom: 'tom', mute: ['shaker', 'rim'], when: 'big' },
      crash: 'crash',
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 33, swing, pattern: (b) => (b.has('bass') ? 'R..R..R...R.5.A.' : null), gate: 0.6 });
    melodyPart(c, { inst: 'lead', chordAt, lo: 69, hi: 86, active: when('lead'), density: 0.5, swing, vel: 0.65 });
    return c.build(
      {
        plucks: { voice: 'mallet', gain: -7, reverb: 0.2, delay: 0.2, params: { tone: 0.5 } },
        pad: { voice: 'pad', gain: -15, reverb: 0.5, params: { cutoff: 1500, wave: 'triangle', attack: 0.5 } },
        kick: KIT.softKick,
        clap: KIT.clap,
        shaker: KIT.shaker,
        rim: KIT.rim,
        tom: KIT.tom,
        crash: KIT.crash,
        bass: { voice: 'bass', gain: -6, params: { wave: 'triangle', cutoff: 450 } },
        lead: { voice: 'pluck', gain: -8, reverb: 0.3, delay: 0.3, pan: 0.2, params: { tone: 0.8 } },
      },
      { reverb: { seconds: 1.8, brightness: 0.55, preDelay: 0.015, level: -7 }, delay: { beats: 0.75, feedback: 0.3, tone: 3000, level: -11 } },
    );
  },
};

const tech: MusicTrackDef = {
  id: 'tech-circuit',
  name: 'Circuit',
  description: 'Clean minimal pulse: tight kick, ticking rims, a filtered sequence and a dark pad.',
  genre: 'Tech',
  moods: ['minimal', 'modern', 'focused'],
  bpm: 120,
  key: 'A minor',
  variations: V(1501, 1502, 1503),
  compose(seed) {
    const key = parseKey('A minor');
    const form = [
      section('a', 8, 0.5, ['kick', 'hats', 'seq', 'pad']),
      section('b', 8, 0.75, ['kick', 'hats', 'seq', 'pad', 'bass', 'rim']),
      section('c', 8, 0.85, ['kick', 'hats', 'seq', 'pad', 'bass', 'rim', 'bell']),
      section('d', 8, 0.6, ['kick', 'hats', 'seq', 'pad', 'bass']),
    ];
    const c = new Composer(120, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('i i VI VII'), P('i v VI iv'), P('i7 i7 iv7 v7')]) }, 2);
    arpPart(c, { inst: 'seq', chordAt, lo: 57, order: choose(seed, 2, ['up', 'converge', 'random'] as const), octaves: 2, stepBeats: 0.25, gate: 0.35, vel: 0.55, rhythm: () => choose(seed, 3, ['x.xxx.x.x.xxx.x.', 'xx.x.xx.xx.x.xx.', 'x.x.xx.xx.x.xx.x']) });
    chordPart(c, { inst: 'pad', chordAt, lo: 50, hi: 64, style: 'pad', vel: 0.5 });
    drumPart(c, {
      humanize: { ms: 1, vel: 0.05 },
      groove: (b) => ({
        kick: 'x...x...x...x...',
        hat: '..x...x...x...x.',
        rim: b.has('rim') ? '.......x..x....x' : null,
      }),
      fills: { snare: 'rim', mute: ['hat'], when: 'big' },
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 33, pattern: (b) => (b.has('bass') ? '..R...R...R...RR' : null), gate: 0.5 });
    melodyPart(c, { inst: 'bell', chordAt, lo: 76, hi: 88, active: when('bell'), density: 0.15, vel: 0.4 });
    return c.build(
      {
        seq: { voice: 'synthpluck', gain: -12, delay: 0.3, pan: -0.1, duck: 0.3, params: { wave: 'square', cutoff: 800, env: 3, reso: 4 } },
        pad: { voice: 'pad', gain: -14, reverb: 0.5, duck: 0.4, params: { cutoff: 900, attack: 1 } },
        kick: { ...KIT.kick, params: { pitch: 52, decay: 0.3, tone: 0.5 } },
        hat: KIT.hat,
        rim: KIT.rim,
        bass: { voice: 'sub', gain: -6, duck: 0.4 },
        bell: { voice: 'bell', gain: -18, delay: 0.5, reverb: 0.5, pan: 0.3 },
      },
      { reverb: { seconds: 2.2, brightness: 0.45, preDelay: 0.02, level: -7 }, delay: { beats: 0.75, feedback: 0.42, tone: 2600, level: -10 }, duck: { source: 'kick', release: 0.1 } },
    );
  },
};

const trailer: MusicTrackDef = {
  id: 'trailer-final-hour',
  name: 'Final Hour',
  description: 'Trailer build: ticking strings, rising tension, huge booms and brass hits.',
  genre: 'Trailer',
  moods: ['dramatic', 'intense', 'epic'],
  bpm: 80,
  key: 'C minor',
  variations: V(1601, 1602, 1603),
  compose(seed) {
    const key = parseKey('C minor');
    const form = [
      section('rise', 8, 0.4, ['ostinato', 'pad', 'boom']),
      section('hit', 8, 1, ['ostinato', 'pad', 'boom', 'brass', 'toms', 'bass']),
    ];
    const c = new Composer(80, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('i VI III VII'), P('i i VI VII'), P('i iv VI V')]) }, 2);
    arpPart(c, { inst: 'ostinato', chordAt, lo: 48, order: 'up', octaves: 1, stepBeats: 0.25, gate: 0.5, vel: 0.65, active: when('ostinato'), rhythm: (b) => (b.section.energy > 0.9 ? 'xxxxxxxxxxxxxxxx' : 'x.x.x.x.x.x.x.x.') });
    chordPart(c, { inst: 'pad', chordAt, lo: 48, hi: 67, style: 'pad', vel: 0.65 });
    chordPart(c, { inst: 'brass', chordAt, lo: 48, hi: 63, style: 'stabs', active: when('brass'), vel: 0.9, pattern: () => 'x-------x---x---' });
    drumPart(c, {
      humanize: { ms: 3, vel: 0.08 },
      groove: (b) => ({ tom: b.has('toms') ? 'x..x..x.x.x.x..x' : b.local >= 6 ? 'x.x.x.x.xxxxxxxx' : null }),
      fills: { snare: 'tom', when: 'phrase' },
    });
    for (const b of c.bars) {
      if (b.has('boom') && (b.section.energy > 0.9 ? b.local % 2 === 0 : b.local % 4 === 0)) c.note('boom', c.barStart(b.bar), 4, 0, 1);
      if (b.section.name === 'rise' && b.local === 6) c.note('riser', c.barStart(b.bar), 8, 0, 0.8);
    }
    bassPart(c, { inst: 'bass', chordAt, lo: 24, pattern: (b) => (b.has('bass') ? 'R-------R-------' : null) });
    return c.build(
      {
        ostinato: { voice: 'strings', gain: -8, reverb: 0.35, params: { attack: 0.01, release: 0.08, cutoff: 3200, vibrato: 0 } },
        pad: { voice: 'strings', gain: -13, reverb: 0.6, params: { attack: 1, cutoff: 1500 } },
        brass: { voice: 'brass', gain: -8, reverb: 0.45, params: { cutoff: 800 } },
        tom: { ...KIT.tom, gain: -5, reverb: 0.4, params: { decay: 0.5 } },
        boom: { voice: 'boom', gain: -3, reverb: 0.5, params: { decay: 2.5 } },
        riser: { voice: 'riser', gain: -12, reverb: 0.5 },
        bass: { voice: 'sub', gain: -6 },
      },
      { reverb: { seconds: 3.5, brightness: 0.4, preDelay: 0.03, level: -4 } },
    );
  },
};

const jazzy: MusicTrackDef = {
  id: 'jazzhop-morning-coffee',
  name: 'Morning Coffee',
  description: 'Mellow jazzy keys over brushed drums and a walking-style bass.',
  genre: 'Jazz',
  moods: ['cozy', 'relaxed', 'cafe'],
  bpm: 92,
  key: 'Bb major',
  variations: V(1701, 1702, 1703),
  compose(seed) {
    const key = parseKey('A# major');
    const form = [
      section('intro', 4, 0.3, ['keys']),
      section('a', 8, 0.6, ['keys', 'drums', 'bass']),
      section('b', 8, 0.7, ['keys', 'drums', 'bass', 'lead']),
    ];
    const c = new Composer(92, key, seed, form);
    const chordAt = chordTimeline(key, { default: choose(seed, 1, [P('ii7 V7 I7 vi7'), P('I7 vi7 ii7 V7'), P('iii7 vi7 ii7 V7')]) });
    const swing = 0.33;
    chordPart(c, { inst: 'keys', chordAt, lo: 55, hi: 72, style: 'stabs', swing, vel: 0.55, pattern: () => choose(seed, 2, ['x--.....x-.x....', 'x-..x-......x-..', '...x-.....x-....']) });
    drumPart(c, {
      swing,
      humanize: { ms: 8, vel: 0.2 },
      groove: (b) => (b.has('drums') ? { kick: 'x.......x.......', snare: '....g.......g...', hat: 'x..xx..xx..xx..x' } : {}),
      fills: { snare: 'snare', mute: ['hat'], when: 'big' },
    });
    bassPart(c, { inst: 'bass', chordAt, lo: 29, swing, pattern: (b) => (b.has('bass') ? 'R...3...5...A...' : null), gate: 0.85 });
    melodyPart(c, { inst: 'lead', chordAt, lo: 65, hi: 79, active: when('lead'), density: 0.45, swing, vel: 0.55 });
    return c.build(
      {
        keys: { voice: 'epiano', gain: -5, reverb: 0.3, pan: -0.1 },
        kick: { ...KIT.softKick, gain: -4 },
        snare: { ...KIT.softSnare, gain: -6, params: { tone: 0.1, decay: 0.25 } },
        hat: { ...KIT.shaker, gain: -12, params: { pitch: 5000, decay: 0.08 } },
        bass: { voice: 'bass', gain: -5, params: { wave: 'triangle', cutoff: 380, sustain: 0.5 } },
        lead: { voice: 'piano', gain: -6, reverb: 0.3, pan: 0.15, params: { cutoff: 3000 } },
      },
      { reverb: { seconds: 1.8, brightness: 0.4, preDelay: 0.015, level: -7 } },
    );
  },
};

export const MUSIC_TRACKS: readonly MusicTrackDef[] = [lofi, pop, corporate, epic, ambient, acoustic, dance, hiphop, funk, synthwave, piano, suspense, playful, travel, tech, trailer, jazzy];
