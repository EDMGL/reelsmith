import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getActivePanelId, openPanel, registerPanel, resetActivePanel, resetRegistries } from '../../core';
import { LeftPanel } from '../LeftPanel';

afterEach(() => {
  resetRegistries();
  resetActivePanel();
});

function setup() {
  registerPanel({ id: 'one', title: 'One', order: 0, component: () => <div>panel one body</div> });
  registerPanel({ id: 'two', title: 'Two', order: 10, component: () => <div>panel two body</div> });
  render(<LeftPanel />);
}

describe('active left panel API', () => {
  it('defaults to the first registered panel', () => {
    setup();
    expect(getActivePanelId()).toBe('one');
    expect(screen.getByText('panel one body')).toBeTruthy();
  });

  it('openPanel switches the rendered panel', () => {
    setup();
    act(() => openPanel('two'));
    expect(getActivePanelId()).toBe('two');
    expect(screen.getByText('panel two body')).toBeTruthy();
    expect(screen.queryByText('panel one body')).toBeNull();
    expect(screen.getByRole('tab', { name: /Two/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('unknown ids are a no-op', () => {
    setup();
    act(() => openPanel('two'));
    act(() => openPanel('does-not-exist'));
    expect(getActivePanelId()).toBe('two');
    expect(screen.getByText('panel two body')).toBeTruthy();
  });

  it('clicking a tab goes through the same API (keeps role=tab and title markup)', () => {
    setup();
    const tab = screen.getByRole('tab', { name: /Two/ });
    expect(tab.getAttribute('title')).toBe('Two');
    fireEvent.click(tab);
    expect(getActivePanelId()).toBe('two');
    expect(screen.getByText('panel two body')).toBeTruthy();
  });
});
