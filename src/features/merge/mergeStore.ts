/** Merge job state for the toolbar button (one merge at a time). */
import { create } from 'zustand';
import { isAbortError } from '../export/pipeline';
import { mergeSelection } from './merge';

interface MergeState {
  running: boolean;
  fraction: number;
  /** Last result message (cleared on the next run). */
  message: { kind: 'info' | 'error'; text: string } | null;
}

export const useMergeStore = create<MergeState>()(() => ({ running: false, fraction: 0, message: null }));

let controller: AbortController | null = null;

export async function startMerge(): Promise<void> {
  if (useMergeStore.getState().running) return;
  controller = new AbortController();
  useMergeStore.setState({ running: true, fraction: 0, message: null });
  try {
    await mergeSelection({ signal: controller.signal, onProgress: (p) => useMergeStore.setState({ fraction: p.fraction }) });
    useMergeStore.setState({ message: { kind: 'info', text: 'Clips merged into one. Undo to get the pieces back.' } });
  } catch (e) {
    useMergeStore.setState({
      message: isAbortError(e) ? { kind: 'info', text: 'Merge cancelled.' } : { kind: 'error', text: e instanceof Error ? e.message : String(e) },
    });
  } finally {
    controller = null;
    useMergeStore.setState({ running: false });
  }
}

export function cancelMerge(): void {
  controller?.abort();
}
