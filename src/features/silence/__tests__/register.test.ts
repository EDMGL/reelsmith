import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProject,
  getActivePanelId,
  panelRegistry,
  registerPanel,
  resetActivePanel,
  resetRegistries,
  toolbarRegistry,
  useEditorStore,
} from '../../../core';
import { register, runSilenceAction, SILENCE_PANEL_ID } from '../index';
import { useSilenceStore } from '../silenceStore';

describe('silence register() / toolbar action', () => {
  afterEach(() => {
    resetRegistries();
    resetActivePanel();
    vi.restoreAllMocks();
  });

  it('registers the panel and the timeline action', () => {
    register();
    expect(panelRegistry.get(SILENCE_PANEL_ID)?.title).toBe('Silence');
    const action = toolbarRegistry.get('silence:detect');
    expect(action?.location).toBe('timeline');
  });

  it('the action opens the Silence panel through openPanel and starts detection', async () => {
    registerPanel({ id: 'media', title: 'Media', order: 0, component: () => null });
    register();
    expect(getActivePanelId()).toBe('media');
    useEditorStore.getState().loadProject(createProject());
    const detect = vi.spyOn(useSilenceStore.getState(), 'detect').mockResolvedValue();
    await runSilenceAction();
    expect(getActivePanelId()).toBe(SILENCE_PANEL_ID);
    expect(detect).toHaveBeenCalledTimes(1);
    expect(useSilenceStore.getState().scope).toBe('timeline');
  });
});
