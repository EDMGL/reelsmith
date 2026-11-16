import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_STYLE_ID,
  createProject,
  createSubtitleClip,
  drawClip,
  getClipRenderer,
  resetRegistries,
  useEditorStore,
  type SubtitleClip,
} from '../../../core';
import { FakeContext, apply, makeEnv } from '../../text/__tests__/fakeCanvas';
import {
  addCueAt,
  clipsToCues,
  cueClips,
  importCues,
  mergeWithNext,
  setCueTiming,
  shiftCueClips,
  splitCueAt,
  subtitleTracks,
  syncFromCue,
  updateSubtitleStyle,
} from '../cueActions';
import { clampShift, mergeCues, resolveOverlaps, shiftCues, splitCue, splitCueText } from '../cueMath';
import { describeImport } from '../SubtitlesPanel';
import { createMockTranscriptionProvider } from '../mockProvider';
import { getTranscriptionProviders, registerTranscriptionProvider } from '../transcription';
import { register } from '../index';
import { SUBTITLE_SAFE_MARGIN } from '../renderSubtitle';

const S = () => useEditorStore.getState();

describe('cue math', () => {
  const cues = [
    { start: 1, end: 2, text: 'a' },
    { start: 3, end: 4, text: 'b' },
  ];
  it('shifts all or selected cues, clamped at 0', () => {
    expect(shiftCues(cues, 0.25)).toEqual([
      { start: 1.25, end: 2.25, text: 'a' },
      { start: 3.25, end: 4.25, text: 'b' },
    ]);
    expect(shiftCues(cues, -5)).toEqual([
      { start: 0, end: 1, text: 'a' },
      { start: 2, end: 3, text: 'b' },
    ]);
    expect(shiftCues(cues, -5, [1])[1]).toEqual({ start: 0, end: 1, text: 'b' });
    expect(shiftCues(cues, 0.1, [1])[0]).toBe(cues[0]);
    expect(clampShift([], 3)).toBe(0);
  });
  it('splits text at the word boundary nearest the time ratio', () => {
    expect(splitCueText('one two three four', 0.5)).toEqual(['one two', 'three four']);
    expect(splitCueText('one two three four', 0.1)).toEqual(['one', 'two three four']);
    expect(splitCueText('one two three four', 1)).toEqual(['one two three', 'four']);
    expect(splitCueText('single', 0.5)).toEqual(['single', 'single']);
    expect(splitCueText('line one\nline two', 0.5)).toEqual(['line one', 'line two']);
  });
  it('splitCue respects the minimum duration', () => {
    expect(splitCue({ start: 0, end: 2, text: 'a b' }, 0.5)).toEqual([
      { start: 0, end: 0.5, text: 'a' },
      { start: 0.5, end: 2, text: 'b' },
    ]);
    expect(splitCue({ start: 0, end: 2, text: 'a b' }, 0.01)).toBeNull();
    expect(splitCue({ start: 0, end: 2, text: 'a b' }, 2)).toBeNull();
  });
  it('merge spans both cues, earlier text first', () => {
    expect(mergeCues({ start: 3, end: 4, text: 'b' }, { start: 1, end: 2, text: 'a' })).toEqual({ start: 1, end: 4, text: 'a\nb' });
  });
  it('resolveOverlaps trims or skips deterministically', () => {
    const r = resolveOverlaps(
      [
        { start: 5, end: 7, text: 'late' },
        { start: 0, end: 2, text: 'first' },
        { start: 1, end: 3, text: 'overlaps first → start trimmed to 2' },
        { start: 1.5, end: 2.5, text: 'inside → start 3? no: occupied until 3 → skipped' },
        { start: 9, end: 12, text: 'existing at 10 cuts end' },
        { start: 10.2, end: 10.8, text: 'fully inside existing → skipped' },
      ],
      [{ start: 10, end: 11 }],
      0.05,
    );
    expect(r.placed).toEqual([
      { start: 0, end: 2, text: 'first' },
      { start: 2, end: 3, text: 'overlaps first → start trimmed to 2' },
      { start: 5, end: 7, text: 'late' },
      { start: 9, end: 10, text: 'existing at 10 cuts end' },
    ]);
    expect(r.trimmed).toBe(2);
    expect(r.skipped).toBe(2);
  });
});

describe('store-level cue actions', () => {
  beforeEach(() => S().loadProject(createProject()));

  it('import creates a subtitle track, resolves overlaps and is ONE undo step', () => {
    const r = importCues([
      { start: 0, end: 2, text: 'a' },
      { start: 1, end: 3, text: 'b' },
      { start: 1.2, end: 1.8, text: 'c' },
    ]);
    expect(r).toMatchObject({ added: 2, trimmed: 1, skipped: 1 });
    expect(describeImport(r)!.text).toBe('Imported 2 cues, 1 trimmed to avoid overlaps, 1 skipped (no room).');
    const tracks = subtitleTracks(S().project);
    expect(tracks).toHaveLength(1);
    expect(clipsToCues(cueClips(S().project, tracks[0]!.id))).toEqual([
      { start: 0, end: 2, text: 'a' },
      { start: 2, end: 3, text: 'b' },
    ]);
    expect(S().past).toHaveLength(1);
    S().undo();
    expect(subtitleTracks(S().project)).toHaveLength(0);
  });

  it('import into a track with cues: merge (trim) or replace', () => {
    const first = importCues([{ start: 0, end: 4, text: 'old' }]);
    const merged = importCues([{ start: 3, end: 6, text: 'new' }], { trackId: first.trackId });
    expect(merged).toMatchObject({ added: 1, trimmed: 1, trackId: first.trackId });
    expect(clipsToCues(cueClips(S().project, first.trackId))[1]).toEqual({ start: 4, end: 6, text: 'new' });
    const replaced = importCues([{ start: 1, end: 2, text: 'only' }], { trackId: first.trackId, replace: true });
    expect(replaced).toMatchObject({ added: 1, replaced: 2 });
    expect(cueClips(S().project, first.trackId).map((c) => c.text)).toEqual(['only']);
  });

  it('import refuses a locked track', () => {
    const t = S().addTrack('subtitle');
    S().updateTrack(t, { locked: true });
    const r = importCues([{ start: 0, end: 1, text: 'x' }], { trackId: t });
    expect(r.error).toMatch(/locked/);
    expect(cueClips(S().project, t)).toHaveLength(0);
  });

  it('add at playhead, edit timing, split, merge', () => {
    S().setCurrentTime(1);
    const id = addCueAt(null, 1, 'one two three four')!;
    const track = S().project.clips[id]!.trackId;
    expect(S().project.clips[id]).toMatchObject({ start: 1, duration: 2 });
    expect(setCueTiming(id, 1, 5)).toBe(true);
    const right = splitCueAt(id, 3)!;
    let cues = cueClips(S().project, track);
    expect(clipsToCues(cues)).toEqual([
      { start: 1, end: 3, text: 'one two' },
      { start: 3, end: 5, text: 'three four' },
    ]);
    expect(cues[1]!.id).toBe(right);
    const before = S().past.length;
    expect(mergeWithNext(id)).toBe(true);
    expect(S().past.length).toBe(before + 1);
    cues = cueClips(S().project, track);
    expect(clipsToCues(cues)).toEqual([{ start: 1, end: 5, text: 'one two\nthree four' }]);
    expect(mergeWithNext(id)).toBe(false);
    // a second cue at a playhead inside the first goes after it
    const id2 = addCueAt(track, 2, 'later')!;
    expect(S().project.clips[id2]!.start).toBe(5);
  });

  it('shift all / selected and sync-from-cue', () => {
    const { trackId } = importCues([
      { start: 1, end: 2, text: 'a' },
      { start: 3, end: 4, text: 'b' },
      { start: 5, end: 6, text: 'c' },
    ]);
    const ids = () => cueClips(S().project, trackId).map((c) => c.id);
    const starts = () => cueClips(S().project, trackId).map((c) => c.start);
    expect(shiftCueClips(ids(), 0.5)).toBe(true);
    expect(starts()).toEqual([1.5, 3.5, 5.5]);
    expect(shiftCueClips(ids(), -10)).toBe(true); // clamped at 0
    expect(starts()).toEqual([0, 2, 4]);
    expect(shiftCueClips([ids()[1]!], 2)).toBe(false); // would overlap c
    expect(syncFromCue(ids()[1]!, 2.25)).toBe(true);
    expect(starts()).toEqual([0, 2.25, 4.25]);
    expect(syncFromCue(ids()[1]!, 0.5)).toBe(false); // would overlap a
  });

  it('updates the shared style as one undoable step', () => {
    const before = S().project.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]!.fontSize;
    expect(updateSubtitleStyle(DEFAULT_SUBTITLE_STYLE_ID, { fontSize: 80, bottomMargin: 0.2 })).toBe(true);
    expect(S().project.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]).toMatchObject({ fontSize: 80, bottomMargin: 0.2, id: DEFAULT_SUBTITLE_STYLE_ID });
    expect(S().past).toHaveLength(1);
    expect(S().past[0]!.label).toBe('Edit subtitle style'); // recorded by the core action
    S().undo();
    expect(S().project.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]!.fontSize).toBe(before);
  });

  it('unknown style ids fall back to the default style; an id in the patch is ignored; no-ops add no history', () => {
    expect(updateSubtitleStyle('does-not-exist', { color: '#ff0000', id: 'hijack' })).toBe(true);
    const styles = S().project.subtitleStyles;
    expect(Object.keys(styles)).toEqual([DEFAULT_SUBTITLE_STYLE_ID]);
    expect(styles[DEFAULT_SUBTITLE_STYLE_ID]).toMatchObject({ color: '#ff0000', id: DEFAULT_SUBTITLE_STYLE_ID });
    expect(S().past).toHaveLength(1);
    expect(updateSubtitleStyle(DEFAULT_SUBTITLE_STYLE_ID, { color: '#ff0000' })).toBe(false);
    expect(S().past).toHaveLength(1);
  });

  it('a slider drag of style changes is one undo step', () => {
    S().beginTransaction('Font size');
    for (const fontSize of [60, 64, 70]) updateSubtitleStyle(DEFAULT_SUBTITLE_STYLE_ID, { fontSize });
    S().commitTransaction();
    expect(S().project.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]!.fontSize).toBe(70);
    expect(S().past).toHaveLength(1);
  });
});

describe('subtitle renderer via core registry', () => {
  beforeEach(() => {
    resetRegistries();
    register();
  });
  afterEach(() => resetRegistries());

  const project = () => {
    const p = { ...createProject(), width: 1000, height: 500 };
    p.subtitleStyles = {
      [DEFAULT_SUBTITLE_STYLE_ID]: { ...p.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]!, fontSize: 20, lineHeight: 1, maxWidth: 0.5, bottomMargin: 0.1, shadow: null },
    };
    return p;
  };

  it('bottom-centered, wrapped at maxWidth, outlined', () => {
    const p = project();
    const clip: SubtitleClip = createSubtitleClip({ trackId: 'x', start: 0, duration: 2, text: 'word '.repeat(60).trim() });
    const ctx = new FakeContext();
    expect(drawClip(ctx.asCanvas(), clip, makeEnv(p, { time: 1 }))).toBe(true);
    const fills = ctx.ops('fillText');
    expect(fills.length).toBeGreaterThan(1);
    for (const f of fills) expect((f.args[0] as string).length * 10).toBeLessThanOrEqual(500);
    expect(ctx.ops('strokeText')).toHaveLength(fills.length); // default style has an outline
    const last = fills[fills.length - 1]!;
    const p0 = apply(last.matrix, last.args[1] as number, last.args[2] as number);
    expect(p0.x).toBeCloseTo(500); // centered
    expect(p0.y).toBeCloseTo(450 - 10); // block bottom at 90% height, last line center half a line above
  });

  it('style overrides apply and the block stays inside the safe area', () => {
    const p = project();
    p.subtitleStyles[DEFAULT_SUBTITLE_STYLE_ID]!.bottomMargin = -1; // nonsense → clamped
    const clip: SubtitleClip = { ...createSubtitleClip({ trackId: 'x', start: 0, duration: 2, text: 'Hi' }), styleOverride: { color: '#ff0000', stroke: null } };
    const ctx = new FakeContext();
    getClipRenderer('subtitle')!(ctx.asCanvas(), clip, 0, makeEnv(p));
    const f = ctx.ops('fillText')[0]!;
    expect(f.state.fillStyle).toBe('#ff0000');
    expect(ctx.ops('strokeText')).toHaveLength(0);
    const y = apply(f.matrix, 0, f.args[2] as number).y;
    expect(y + 10).toBeLessThanOrEqual(500 - 500 * SUBTITLE_SAFE_MARGIN + 1e-9);
  });

  it('blank text draws nothing', () => {
    const ctx = new FakeContext();
    getClipRenderer('subtitle')!(ctx.asCanvas(), createSubtitleClip({ trackId: 'x', start: 0, duration: 1, text: '  ' }), 0, makeEnv(project()));
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('transcription providers', () => {
  it('registry add/replace/remove', () => {
    const p = createMockTranscriptionProvider();
    const off = registerTranscriptionProvider(p);
    registerTranscriptionProvider(createMockTranscriptionProvider({ id: 'other' }));
    expect(getTranscriptionProviders().map((x) => x.id)).toEqual(['mock', 'other']);
    off();
    expect(getTranscriptionProviders().map((x) => x.id)).toEqual(['other']);
    registerTranscriptionProvider(createMockTranscriptionProvider({ id: 'other' }))();
    expect(getTranscriptionProviders()).toHaveLength(0);
  });

  it('mock provider is deterministic, reports progress and honours abort', async () => {
    const p = createMockTranscriptionProvider({ cueLength: 2 });
    const audio = { duration: 7 } as AudioBuffer;
    const progress: number[] = [];
    const cues = await p.transcribe(audio, { onProgress: (f) => progress.push(f) });
    expect(cues).toEqual([
      { start: 0, end: 1.9, text: 'Line 1' },
      { start: 2, end: 3.9, text: 'Line 2' },
      { start: 4, end: 5.9, text: 'Line 3' },
    ]);
    expect(progress[progress.length - 1]).toBe(1);
    const ac = new AbortController();
    ac.abort();
    await expect(p.transcribe(audio, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
