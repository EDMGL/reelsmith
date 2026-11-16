import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_STYLE_ID,
  createProject,
  createSubtitleClip,
  drawClip,
  resetRegistries,
  useEditorStore,
  type Project,
  type SubtitleClip,
  type WordHighlight,
} from '../../../core';
import { FakeContext, makeEnv } from '../../text/__tests__/fakeCanvas';
import { clipsToCues, cueClips, importCues, mergeWithNext, setCueTiming, splitCueAt } from '../cueActions';
import { register } from '../index';
import { spreadAroundActive } from '../renderSubtitle';
import { normalizeCues, wordsToCues } from '../whisper/segmenting';
import { activeWordIndex, estimateWordTimes, mapLinePieces, resolveWordTimes, tokenize, wordProgress } from '../wordTiming';

const S = () => useEditorStore.getState();
const words3 = [
  { text: 'Merhaba', start: 0, end: 0.5 },
  { text: 'güzel', start: 0.6, end: 0.9 },
  { text: 'insanlar', start: 1.2, end: 1.8 },
];

describe('word timing', () => {
  it('uses real timings when they match the text, else estimates by length', () => {
    const clip = { text: 'Merhaba güzel insanlar', duration: 2, words: words3 };
    expect(resolveWordTimes(clip)).toEqual(words3);
    // typo fix with the same word count keeps the real timings
    expect(resolveWordTimes({ ...clip, text: 'Merhaba güzel insanlar!' })[2]).toEqual({ text: 'insanlar!', start: 1.2, end: 1.8 });
    // different word count -> estimate covering the whole clip
    const est = resolveWordTimes({ ...clip, text: 'Merhaba dünya' });
    expect(est.map((w) => w.text)).toEqual(['Merhaba', 'dünya']);
    expect(est[0]!.start).toBe(0);
    expect(est[1]!.end).toBeCloseTo(2);
    expect(est[0]!.end - est[0]!.start).toBeGreaterThan(est[1]!.end - est[1]!.start);
  });

  it('estimateWordTimes is contiguous', () => {
    const t = estimateWordTimes(['a', 'bbb', 'cc'], 3);
    expect(t[0]!.start).toBe(0);
    for (let i = 1; i < t.length; i++) expect(t[i]!.start).toBeCloseTo(t[i - 1]!.end);
    expect(t[2]!.end).toBeCloseTo(3);
  });

  it('active word stays lit through pauses; progress fills each word', () => {
    expect(activeWordIndex(words3, -0.1)).toBe(-1);
    expect(activeWordIndex(words3, 0)).toBe(0);
    expect(activeWordIndex(words3, 1.0)).toBe(1); // pause after "güzel"
    expect(activeWordIndex(words3, 5)).toBe(2);
    expect(wordProgress(words3[2]!, 1.5)).toBeCloseTo(0.5);
    expect(wordProgress(words3[2]!, 9)).toBe(1);
  });

  it('maps wrapped line pieces (incl. char-broken long words) back to words', () => {
    expect(mapLinePieces(['bir iki', 'üç'], tokenize('bir iki üç'))).toEqual([[0, 1], [2]]);
    expect(mapLinePieces(['a uzunkel', 'ime b'], tokenize('a uzunkelime b'))).toEqual([[0, 1], [1, 2]]);
  });
});

describe('wordsToCues (Whisper word timestamps)', () => {
  const w = (text: string, start: number, end: number | null) => ({ text, start, end });

  it('groups words into short cues at pauses and sentence ends, keeping absolute word times', () => {
    const cues = wordsToCues(
      [w(' Merhaba', 0, 0.4), w(' arkadaşlar.', 0.45, 1.0), w(' Bugün', 1.1, 1.4), w(' size', 1.45, 1.6), w(' bir', 2.6, 2.7), w(' şey', 2.75, 3.0), w(' göstereceğim', 3.05, 3.6)],
      10,
      38,
    );
    expect(cues.map((c) => c.text)).toEqual(['Merhaba arkadaşlar.', 'Bugün size', 'bir şey göstereceğim']);
    expect(cues[0]).toMatchObject({ start: 10, end: 11 });
    expect(cues[2]!.words).toEqual([
      { text: 'bir', start: 12.6, end: 12.7 },
      { text: 'şey', start: 12.75, end: 13 },
      { text: 'göstereceğim', start: 13.05, end: 13.6 },
    ]);
  });

  it('respects maxChars, glues punctuation tokens and closes open word ends', () => {
    const cues = wordsToCues([w('aaaa', 0, 0.2), w('bbbb', 0.2, 0.4), w('cccc', 0.4, 0.6), w(',', 0.6, 0.6), w('dddd', 0.7, null)], 0, 5, { maxChars: 10 });
    expect(cues.map((c) => c.text)).toEqual(['aaaa bbbb', 'cccc, dddd']);
    expect(cues[1]!.words!.map((x) => x.text)).toEqual(['cccc,', 'dddd']);
    expect(cues[1]!.end).toBeCloseTo(1.1); // open end -> +0.4 s
  });

  it('drops hallucinations and survives normalizeCues', () => {
    const cues = normalizeCues(wordsToCues([w('Altyazı', 0, 0.5), w('M.K.', 0.5, 1)], 0, 5));
    expect(cues).toEqual([]);
    const kept = normalizeCues(wordsToCues([w('Selam', 0, 0.5)], 0, 5));
    expect(kept[0]!.words).toEqual([{ text: 'Selam', start: 0, end: 0.5 }]);
  });
});

describe('word timings through cue editing', () => {
  beforeEach(() => S().loadProject(createProject()));

  it('import keeps words relative to the clip; split, merge and start edits keep them on the audio', () => {
    importCues([{ start: 5, end: 7, text: 'Merhaba güzel insanlar', words: words3.map((x) => ({ ...x, start: x.start + 5, end: x.end + 5 })) }]);
    const tracks = S().project.tracks.filter((t) => t.kind === 'subtitle');
    const [clip] = cueClips(S().project, tracks[0]!.id);
    expect(clip!.words).toEqual(words3);
    expect(clipsToCues([clip!])[0]!.words![2]).toEqual({ text: 'insanlar', start: 6.2, end: 6.8 });

    // split at 6.0 s: the text follows the real word positions
    const right = splitCueAt(clip!.id, 6.0)!;
    const a = S().project.clips[clip!.id] as SubtitleClip;
    const b = S().project.clips[right] as SubtitleClip;
    expect([a.text, b.text]).toEqual(['Merhaba güzel', 'insanlar']);
    expect(b.words).toEqual([{ text: 'insanlar', start: 0.2, end: 0.8 }]);

    // merge back
    expect(mergeWithNext(clip!.id)).toBe(true);
    const m = S().project.clips[clip!.id] as SubtitleClip;
    expect(resolveWordTimes(m).map((x) => [x.text, +x.start.toFixed(3)])).toEqual([
      ['Merhaba', 0],
      ['güzel', 0.6],
      ['insanlar', 1.2],
    ]);

    // moving the start edge later keeps words on the same audio
    expect(setCueTiming(clip!.id, 5.5, 7)).toBe(true);
    expect((S().project.clips[clip!.id] as SubtitleClip).words![1]).toEqual({ text: 'güzel', start: 0.1, end: 0.4 });
  });
});

describe('highlight renderer', () => {
  beforeEach(() => {
    resetRegistries();
    register();
  });
  afterEach(() => resetRegistries());

  function setup(hl: WordHighlight): { project: Project; clip: SubtitleClip } {
    const p = { ...createProject(), width: 1000, height: 500 };
    p.subtitleStyles = {
      [DEFAULT_SUBTITLE_STYLE_ID]: { ...p.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]!, fontSize: 20, shadow: null, color: '#ffffff', highlight: hl },
    };
    const clip = { ...createSubtitleClip({ trackId: 'x', start: 0, duration: 2, text: 'Merhaba güzel insanlar' }), words: words3 };
    return { project: p, clip };
  }

  const fillsAt = (hl: WordHighlight, t: number) => {
    const { project, clip } = setup(hl);
    const ctx = new FakeContext();
    expect(drawClip(ctx.asCanvas(), clip, makeEnv(project, { time: t }))).toBe(true);
    return ctx;
  };

  it('color: only the active word gets the highlight color, drawn word by word', () => {
    const ctx = fillsAt({ mode: 'color', color: '#ffe600', pop: 1 }, 1.0);
    const fills = ctx.ops('fillText');
    expect(fills.map((f) => [f.args[0], f.state.fillStyle])).toEqual([
      ['Merhaba', '#ffffff'],
      ['güzel', '#ffe600'],
      ['insanlar', '#ffffff'],
    ]);
    expect(ctx.ops('strokeText')).toHaveLength(3);
    // words are laid out left to right
    const xs = fills.map((f) => f.args[1] as number);
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
  });

  it('box: a box is filled behind the active word only', () => {
    const ctx = fillsAt({ mode: 'box', color: '#7c3aed', pop: 1 }, 0.1);
    const boxFills = ctx.ops('fill').filter((f) => f.state.fillStyle === '#7c3aed');
    expect(boxFills).toHaveLength(1);
    expect(ctx.ops('fillText').every((f) => f.state.fillStyle === '#ffffff')).toBe(true);
  });

  it('karaoke: spoken words colored, active word partially filled (clipped)', () => {
    const ctx = fillsAt({ mode: 'karaoke', color: '#22d3ee', pop: 1 }, 1.5);
    const fills = ctx.ops('fillText').map((f) => [f.args[0], f.state.fillStyle]);
    expect(fills).toEqual([
      ['Merhaba', '#22d3ee'],
      ['güzel', '#22d3ee'],
      ['insanlar', '#ffffff'],
      ['insanlar', '#22d3ee'], // clipped overlay
    ]);
    expect(ctx.ops('clip')).toHaveLength(1);
  });

  it('pop scales only the active word; none mode draws whole lines as before', () => {
    const ctx = fillsAt({ mode: 'color', color: '#ffe600', pop: 1.15 }, 0.1);
    const [first, second] = ctx.ops('fillText');
    expect(first!.matrix.a).toBeCloseTo(1.15);
    expect(second!.matrix.a).toBeCloseTo(1);
    const plain = fillsAt({ mode: 'none', color: '#ffe600', pop: 1 }, 0.1);
    expect(plain.ops('fillText').map((f) => f.args[0])).toEqual(['Merhaba güzel insanlar']);
  });
});

describe('spreadAroundActive', () => {
  it('moves the other words of the active line apart by the pop + box room; other lines stay', () => {
    const pieces = [
      { text: 'a', word: 0, x: 0, w: 10, y: 0 },
      { text: 'bb', word: 1, x: 15, w: 20, y: 0 },
      { text: 'c', word: 2, x: 40, w: 10, y: 0 },
      { text: 'd', word: 3, x: 0, w: 10, y: 30 },
    ];
    const out = spreadAroundActive(pieces, 1, 1.5, 2);
    const extra = (0.5 * 20) / 2 + 2 * 1.5;
    expect(out.map((p) => p.x)).toEqual([0 - extra, 15, 40 + extra, 0]);
    expect(spreadAroundActive(pieces, 1, 1, 0)).toBe(pieces);
    expect(spreadAroundActive(pieces, -1, 1.5, 2)).toBe(pieces);
  });
});
