import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, createTextClip, setEngine, useEditorStore, type PlaybackEngine } from '../../../core';
import { createMockTranscriptionProvider } from '../mockProvider';
import SubtitlesPanel from '../SubtitlesPanel';
import { registerTranscriptionProvider } from '../transcription';

const S = () => useEditorStore.getState();
const SRT = '1\r\n00:00:01,000 --> 00:00:02,000\r\nFirst\r\n\r\n2\r\n00:00:01,500 --> 00:00:03,000\r\nSecond overlaps\r\n';

beforeEach(() => S().loadProject(createProject()));
afterEach(() => {
  cleanup();
  setEngine(null);
});

async function importFile(content: string, name: string) {
  const input = screen.getByTestId('subtitle-file-input') as HTMLInputElement;
  const file = new File([content], name, { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Imported/));
}

describe('SubtitlesPanel', () => {
  it('imports SRT (reporting trims), edits a cue, shifts all, highlights the current cue', async () => {
    render(<SubtitlesPanel />);
    await importFile(SRT, 'movie.srt');
    expect(screen.getByRole('status').textContent).toBe('Imported 2 cues, 1 trimmed to avoid overlaps.');
    let rows = screen.getAllByTestId('cue-row');
    expect(rows).toHaveLength(2);

    const text = screen.getAllByLabelText('Cue text')[0] as HTMLTextAreaElement;
    fireEvent.focus(text);
    fireEvent.change(text, { target: { value: 'First edited' } });
    fireEvent.change(text, { target: { value: 'First edited!' } });
    fireEvent.blur(text);
    const pastAfterEdit = S().past.length;
    expect(pastAfterEdit).toBe(2); // import + one text edit
    expect(Object.values(S().project.clips).some((c) => c.type === 'subtitle' && c.text === 'First edited!')).toBe(true);

    const start = screen.getAllByLabelText('Start')[1] as HTMLInputElement;
    expect(start.value).toBe('00:02.000');

    fireEvent.click(screen.getAllByRole('button', { name: '+ Later' })[0]!);
    rows = screen.getAllByTestId('cue-row');
    expect((screen.getAllByLabelText('Start')[0] as HTMLInputElement).value).toBe('00:01.100');

    act(() => S().setCurrentTime(1.5));
    expect(screen.getAllByTestId('cue-row')[0]!.getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getAllByTestId('cue-row')[1]!);
    expect(S().currentTime).toBeCloseTo(2.1);
  });

  it('Auto captions is disabled without a provider and runs one when registered', async () => {
    render(<SubtitlesPanel />);
    const btn = screen.getByRole('button', { name: 'Auto captions' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.parentElement!.getAttribute('title')).toMatch(/provider/);

    let off = () => {};
    act(() => void (off = registerTranscriptionProvider(createMockTranscriptionProvider())));
    const engine = { mixAudio: async () => ({ duration: 4 }) as AudioBuffer, dispose: () => {} } as unknown as PlaybackEngine;
    setEngine(engine);
    act(() => void S().insertClip(createTextClip({ trackId: '', start: 0, duration: 4 }))); // project duration 4 s
    const enabled = screen.getByRole('button', { name: 'Auto captions' }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Imported 2 cues.'));
    expect(screen.getAllByTestId('cue-row')).toHaveLength(2);
    act(() => off());
  });
});
