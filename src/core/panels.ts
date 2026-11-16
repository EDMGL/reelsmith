/**
 * Active left-panel tab API. Single source of truth for which panel the shell
 * shows; feature packages call `openPanel(id)` (e.g. "open the Text panel"
 * after an action) instead of touching the DOM.
 */
import { useSyncExternalStore } from 'react';
import { panelRegistry } from './registry';

let requestedId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/**
 * Shows the left panel with this id. Unknown (unregistered) ids are ignored.
 */
export function openPanel(id: string): void {
  if (!panelRegistry.get(id) || requestedId === id) return;
  requestedId = id;
  emit();
}

/**
 * Id of the panel currently shown: the last one opened via `openPanel` if it
 * is still registered, otherwise the first registered panel (by order), or
 * null when no panel is registered.
 */
export function getActivePanelId(): string | null {
  if (requestedId && panelRegistry.get(requestedId)) return requestedId;
  return panelRegistry.list()[0]?.id ?? null;
}

/** Subscribes to active-panel changes (including registry changes that affect the fallback). */
export function subscribeActivePanel(listener: () => void): () => void {
  listeners.add(listener);
  const offRegistry = panelRegistry.subscribe(listener);
  return () => {
    listeners.delete(listener);
    offRegistry();
  };
}

/** React hook: the active panel id (re-renders on change). */
export function useActivePanelId(): string | null {
  return useSyncExternalStore(subscribeActivePanel, getActivePanelId, getActivePanelId);
}

/** Resets the active panel to the default (tests only). */
export function resetActivePanel(): void {
  requestedId = null;
  emit();
}
