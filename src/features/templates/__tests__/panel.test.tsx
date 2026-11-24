import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipFromAsset, createProject, useEditorStore, type ImageClip } from '../../../core';
import { applyDeps } from '../apply';
import { builtinTemplates } from '../catalogue';
import TemplatesPanel from '../TemplatesPanel';
import { resetTemplatesUi, useTemplatesStore } from '../templatesStore';
import { asset } from './fixtures';

// Files are imported through the media feature; in jsdom there is no media decoding, so the
// import step is replaced by one that registers a matching asset.
vi.mock('../../media/importMedia', () => ({
  importFile: vi.fn(async (f: File) => {
    if (f.name.endsWith('.txt')) return null;
    const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image';
    const a = { ...asset(`a-${f.name}`, kind, 1080, 1920, kind === 'image' ? null : 20), name: f.name };
    useEditorStore.getState().addAsset(a);
    return a.id;
  }),
}));

const E = () => useEditorStore.getState();
const file = (name: string, type: string) => new File(['x'], name, { type });

beforeEach(() => {
  localStorage.clear();
  resetTemplatesUi();
  E().loadProject(createProject());
  vi.spyOn(applyDeps, 'renderMusic').mockImplementation(async () => ({ sampleRate: 8000, channels: [new Float32Array(80)] }));
  vi.spyOn(applyDeps, 'ensureAsset').mockImplementation((_k, _p, name) => {
    const a = { ...asset('music', 'audio', 0, 0, 120), name };
    E().addAsset(a);
    return a;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const cards = () => screen.queryAllByRole('button', { name: /^Open template / });

describe('Templates panel — gallery', () => {
  it('lists the whole catalogue with aspect, length and slot count', () => {
    render(<TemplatesPanel />);
    expect(cards().length).toBe(builtinTemplates().length);
    expect(screen.getByText(`${builtinTemplates().length} templates`)).toBeTruthy();
    const card = screen.getByRole('button', { name: 'Open template Beat Flip' });
    expect(within(card).getByText('9:16')).toBeTruthy();
    expect(within(card).getByText(/\d+ slots/)).toBeTruthy();
    expect(within(card).getByRole('img', { name: /Preview of Beat Flip/ })).toBeTruthy();
  });

  it('filters by search, aspect and category', () => {
    render(<TemplatesPanel />);
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: 'postcard' } });
    expect(cards().map((c) => c.getAttribute('aria-label'))).toEqual(expect.arrayContaining(['Open template Postcard Trail', 'Open template Old Postcard']));
    fireEvent.change(screen.getByLabelText('Search templates'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('radio', { name: '16:9' }));
    const wide = builtinTemplates().filter((t) => t.aspect === '16:9');
    expect(cards()).toHaveLength(wide.length);
    fireEvent.click(screen.getByRole('tab', { name: 'Travel' }));
    expect(cards()).toHaveLength(wide.filter((t) => t.category === 'Travel').length);
    fireEvent.click(screen.getByRole('radio', { name: 'All' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Featured' }));
    expect(cards().length).toBe(builtinTemplates().filter((t) => t.featured).length);
  });

  it('imports a template file, rejecting malformed JSON with a readable message', async () => {
    render(<TemplatesPanel />);
    const input = screen.getByTestId('template-file-input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['{"kind":"erdemcut-template","formatVersion":1,"template":{"formatVersion":1}}'], 'bad.json', { type: 'application/json' })] } });
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not a usable template/));
    expect(screen.getByRole('alert').textContent).toMatch(/template\.id/);
    const good = JSON.stringify({ kind: 'erdemcut-template', formatVersion: 1, template: builtinTemplates()[0] });
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File([good], 'good.json', { type: 'application/json' })] } });
    });
    await waitFor(() => expect(screen.getByText(/Imported “Beat Flip” into My templates/)).toBeTruthy());
    expect(useTemplatesStore.getState().category).toBe('My templates');
    expect(cards()).toHaveLength(1);
    expect(localStorage.getItem('erdemcut:templates:v1')).toContain('Beat Flip');
  });

  it('saves the current timeline as a template under My templates', () => {
    const img = asset('p', 'image', 1080, 1920);
    E().addAsset(img);
    const main = E().project.tracks.find((t) => t.kind === 'video')!.id;
    E().addClip({ ...(createClipFromAsset(img, { trackId: main, start: 0 }) as ImageClip), id: 'c' });
    render(<TemplatesPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Save as template/ }));
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'My reel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText(/Saved “My reel” with 1 slot/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open template My reel' })).toBeTruthy();
  });
});

describe('Templates panel — fill and apply', () => {
  it('auto-fills slots from picked files, cycles the rest, edits text and applies as one undo step', async () => {
    render(<TemplatesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open template Then & Now' }));
    expect(screen.getByText('Slots · 0 / 4 filled')).toBeTruthy();
    const apply = screen.getByRole('button', { name: /Apply template/ });
    expect((apply as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.change(screen.getByTestId('template-media-input'), { target: { files: [file('old.jpg', 'image/jpeg'), file('new.mp4', 'video/mp4')] } });
    });
    await waitFor(() => expect(screen.getByText('Slots · 2 / 4 filled')).toBeTruthy());
    expect(screen.getByText('2 file(s) placed into slots.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Slot 1, .*old\.jpg/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Slot 3, .*repeats old\.jpg/ })).toBeTruthy();

    // Swap slot 1 and 2 by clicking them.
    fireEvent.click(screen.getByRole('button', { name: /Slot 1,/ }));
    fireEvent.click(screen.getByRole('button', { name: /Slot 2,/ }));
    expect(screen.getByRole('button', { name: /Slot 1, .*new\.mp4/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Label “then”'), { target: { value: 'BACK THEN' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Apply template/ }));
    });
    await waitFor(() => expect(screen.getByText(/“Then & Now” applied/)).toBeTruthy());
    const clips = Object.values(E().project.clips);
    expect(E().project.aspectPreset).toBe('4:5');
    expect(clips.some((c) => c.type === 'text' && c.text === 'BACK THEN')).toBe(true);
    expect(clips.some((c) => c.type === 'audio')).toBe(true);
    E().undo();
    expect(Object.keys(E().project.clips)).toHaveLength(0);
  });

  it('says so when there are more files than slots, and reports failed files', async () => {
    render(<TemplatesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open template Words Over Water' }));
    await act(async () => {
      fireEvent.change(screen.getByTestId('template-media-input'), { target: { files: [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg'), file('c.jpg', 'image/jpeg'), file('notes.txt', 'text/plain')] } });
    });
    await waitFor(() => expect(screen.getByText(/2 file\(s\) more than empty slots/)).toBeTruthy());
    expect(screen.getByText(/Could not import: notes\.txt/)).toBeTruthy();
    expect(screen.getByText('Slots · 1 / 1 filled')).toBeTruthy();
  });

  it('fills from the media library and offers append vs replace on a non-empty timeline', () => {
    const img = asset('lib', 'image', 1080, 1920);
    E().addAsset(img);
    const main = E().project.tracks.find((t) => t.kind === 'video')!.id;
    E().addClip({ ...(createClipFromAsset(img, { trackId: main, start: 0 }) as ImageClip), id: 'c' });
    render(<TemplatesPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Open template Clean Title Reel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use lib.jpg' }));
    expect(screen.getByText(/Slots · 1 \/ 7 filled/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Append at/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Replace timeline' }));
    expect(screen.getByText(/Replaces every clip/)).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: /Switch canvas to 16:9/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /All templates/ }));
    expect(cards().length).toBeGreaterThan(100);
  });
});
