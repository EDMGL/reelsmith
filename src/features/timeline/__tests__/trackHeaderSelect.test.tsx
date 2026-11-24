import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, createSubtitleClip, ops, useEditorStore, type Clip } from '../../../core';
import { makeAsset, videoClip } from '../../../core/__tests__/fixtures';
import { Timeline } from '../Timeline';
import { cancelActiveGesture } from '../interactions';
import { useTimelineUi } from '../timelineUi';

const S = () => useEditorStore.getState();
let sub = '';
let v = '';

beforeEach(() => {
  cancelActiveGesture();
  const r = ops.addTrack({ ...createProject(), assets: { asset1: makeAsset('asset1', 10) } }, 'subtitle');
  const p = r.project;
  sub = r.trackId;
  v = p.tracks.find((t) => t.kind === 'video')!.id;
  const clips: Clip[] = [videoClip(p, 'vb', v, 5, 0, 4), videoClip(p, 'va', v, 0, 0, 4)];
  for (let i = 0; i < 3; i++) clips.push({ ...createSubtitleClip({ trackId: sub, start: i, duration: 0.8, text: `line ${i}` }), id: `s${i}` });
  S().loadProject({ ...p, clips: Object.fromEntries(clips.map((c) => [c.id, c])) });
  useTimelineUi.setState({ drag: null, draggingIds: null, snapLine: null, menu: null });
});

const header = (c: HTMLElement, trackId: string) => c.querySelector(`[data-track-id="${trackId}"] .track-header`) as HTMLElement;

describe('track header click selects the track’s clips', () => {
  it('selects only that track (video, then subtitles)', () => {
    const { container } = render(<Timeline />);
    fireEvent.pointerDown(header(container, v), { button: 0 });
    expect(S().selectedClipIds).toEqual(['va', 'vb']);
    fireEvent.pointerDown(header(container, sub), { button: 0 });
    expect(S().selectedClipIds).toEqual(['s0', 's1', 's2']);
  });

  it('Shift / ⌘ adds the track to the current selection', () => {
    const { container } = render(<Timeline />);
    fireEvent.pointerDown(header(container, v), { button: 0 });
    fireEvent.pointerDown(header(container, sub), { button: 0, shiftKey: true });
    expect([...S().selectedClipIds].sort()).toEqual(['s0', 's1', 's2', 'va', 'vb']);
  });

  it('the header buttons (mute, lock…) do not change the clip selection', () => {
    const { container } = render(<Timeline />);
    S().selectClips(['s1']);
    fireEvent.pointerDown(header(container, v).querySelector('button')!, { button: 0 });
    expect(S().selectedClipIds).toEqual(['s1']);
  });
});
