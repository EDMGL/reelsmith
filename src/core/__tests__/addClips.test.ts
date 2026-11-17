import { beforeEach, describe, expect, it } from 'vitest';
import { createSubtitleClip, createTextClip } from '../model';
import * as ops from '../ops';
import { useEditorStore } from '../store';
import type { Project } from '../types';
import { makeProject, videoClip, withClips } from './fixtures';

const S = () => useEditorStore.getState();

function setup(): { project: Project; v: string; a: string; sub: string } {
  const { project, v, a } = makeProject();
  const r = ops.addTrack(withClips(project, videoClip(project, 'x', v, 2, 0, 2)), 'subtitle');
  return { project: r.project, v, a, sub: r.trackId };
}

describe('ops.addClips', () => {
  it('adds valid clips and skips rejected ones (same rules as addClip)', () => {
    const { project, v, a, sub } = setup();
    const cues = [0, 1, 2].map((i) => ({ ...createSubtitleClip({ trackId: sub, start: i, duration: 1, text: `c${i}` }), id: `c${i}` }));
    const r = ops.addClips(project, [
      ...cues,
      { ...createSubtitleClip({ trackId: sub, start: 0.5, duration: 1, text: 'overlaps c0/c1 (same batch)' }), id: 'dup-overlap' },
      { ...videoClip(project, 'ov', v, 3, 0, 2) }, // overlaps existing x [2,4)
      { ...videoClip(project, 'ok', v, 4, 0, 2) }, // touches x: fine
      { ...createTextClip({ trackId: a, start: 0 }), id: 'wrong-track' }, // audio track does not accept text
      { ...createTextClip({ trackId: 'nope', start: 0 }), id: 'no-track' },
      { ...createSubtitleClip({ trackId: sub, start: 9, duration: 0, text: 'zero' }), id: 'zero' },
      { ...cues[0]!, start: 20 }, // duplicate id within batch
      { ...videoClip(project, 'x', v, 30, 0, 2) }, // id already in project
    ])!;
    expect(r.added).toEqual(['c0', 'c1', 'c2', 'ok']);
    expect(Object.keys(r.project.clips).sort()).toEqual(['c0', 'c1', 'c2', 'ok', 'x']);
    expect(r.project.clips.c0!.start).toBe(0);
  });

  it('skips clips on locked tracks and returns null when nothing is added', () => {
    const { project, sub } = setup();
    const locked = ops.updateTrack(project, sub, { locked: true })!;
    expect(ops.addClips(locked, [{ ...createSubtitleClip({ trackId: sub, start: 0, duration: 1, text: 'a' }), id: 'a' }])).toBeNull();
    expect(ops.addClips(project, [])).toBeNull();
  });
});

describe('store.addClips', () => {
  beforeEach(() => S().loadProject(setup().project));

  it('400 cues = ONE store update and ONE undo step', () => {
    const sub = S().project.tracks.find((t) => t.kind === 'subtitle')!.id;
    const cues = Array.from({ length: 400 }, (_, i) => createSubtitleClip({ trackId: sub, start: i * 0.5, duration: 0.4, text: `cue ${i}` }));
    let updates = 0;
    const unsub = useEditorStore.subscribe(() => updates++);
    const past = S().past.length;
    const ids = S().addClips(cues);
    unsub();
    expect(ids).toHaveLength(400);
    expect(updates).toBe(1);
    expect(S().past.length).toBe(past + 1);
    S().undo();
    expect(ids.every((id) => !S().project.clips[id])).toBe(true);
  });

  it('is transaction-aware and returns [] (no history) when everything is rejected', () => {
    const sub = S().project.tracks.find((t) => t.kind === 'subtitle')!.id;
    const past = S().past.length;
    S().transact('Import', () => {
      S().addClips([createSubtitleClip({ trackId: sub, start: 0, duration: 1, text: 'a' })]);
      S().addClips([createSubtitleClip({ trackId: sub, start: 1, duration: 1, text: 'b' })]);
    });
    expect(S().past.length).toBe(past + 1);
    expect(S().addClips([createSubtitleClip({ trackId: sub, start: 0.5, duration: 1, text: 'overlap' })])).toEqual([]);
    expect(S().past.length).toBe(past + 1);
  });
});
