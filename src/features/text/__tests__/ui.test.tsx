import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIP_TEMPLATE_DRAG_MIME, createProject, useEditorStore, type TextClip } from '../../../core';
import TextInspector from '../TextInspector';
import TextPanel from '../TextPanel';

const S = () => useEditorStore.getState();
beforeEach(() => S().loadProject(createProject()));
afterEach(cleanup);

describe('TextPanel', () => {
  it('adds text by click and exposes a clip template for drag', () => {
    render(<TextPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Boxed text' }));
    const clip = Object.values(S().project.clips)[0] as TextClip;
    expect(clip.type).toBe('text');
    expect(clip.style.background).not.toBeNull();
    const data: Record<string, string> = {};
    fireEvent.dragStart(screen.getByRole('button', { name: 'Add Headline text' }), {
      dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' },
    });
    expect(JSON.parse(data[CLIP_TEMPLATE_DRAG_MIME]!).type).toBe('text');
  });
});

describe('TextInspector', () => {
  it('typing is one undo step; style toggles update the clip', () => {
    render(<TextPanel />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add text' }));
    const id = S().selectedClipIds[0]!;
    const view = () => {
      const clip = S().project.clips[id] as TextClip;
      const track = S().project.tracks.find((t) => t.id === clip.trackId)!;
      return <TextInspector clip={clip} track={track} project={S().project} />;
    };
    const { rerender } = render(view());
    const ta = screen.getByLabelText('Text content');
    const before = S().past.length;
    fireEvent.focus(ta);
    fireEvent.change(ta, { target: { value: 'Hel' } });
    fireEvent.change(ta, { target: { value: 'Hello\nworld' } });
    fireEvent.blur(ta);
    expect((S().project.clips[id] as TextClip).text).toBe('Hello\nworld');
    expect(S().past.length).toBe(before + 1);
    // A burst without blur (focus stays in the textarea) still closes after the idle delay.
    vi.useFakeTimers();
    fireEvent.change(ta, { target: { value: 'Hello\nworld!' } });
    expect(S().transaction?.label).toBe('Edit text');
    vi.advanceTimersByTime(1000);
    expect(S().transaction).toBeNull();
    expect(S().past.length).toBe(before + 2);
    vi.useRealTimers();
    rerender(view());
    fireEvent.click(screen.getByLabelText('Outline'));
    expect((S().project.clips[id] as TextClip).style.stroke).toEqual({ color: '#000000', width: 4 });
    rerender(view());
    fireEvent.click(screen.getByRole('button', { name: 'Right' }));
    expect((S().project.clips[id] as TextClip).style.align).toBe('right');
  });
});
