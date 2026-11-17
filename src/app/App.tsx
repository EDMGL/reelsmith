import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { useEditorStore } from '../core';
import { Timeline } from '../features/timeline/Timeline';
import { InspectorPanel } from './InspectorPanel';
import { LeftPanel } from './LeftPanel';
import { PreviewArea } from './PreviewArea';
import { ResizeHandle } from './ResizeHandle';
import { ShortcutsDialog, useShortcutsHelpKey } from './ShortcutsDialog';
import { ToolbarActions } from './ToolbarActions';
import { TooltipLayer } from './Tooltip';
import { TopBar } from './TopBar';
import { DEFAULT_LAYOUT, useLayoutSizes } from './layout';
import { useGlobalShortcuts } from './shortcuts';

export function App() {
  useGlobalShortcuts();
  const hydrated = useEditorStore((s) => s.hydrated);
  const appRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useLayoutSizes();
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleHelp = useCallback(() => setHelpOpen((v) => !v), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  useShortcutsHelpKey(toggleHelp);

  const style = {
    '--left-w': `${layout.left}px`,
    '--right-w': `${layout.right}px`,
    '--timeline-h': `${layout.timeline}px`,
  } as CSSProperties;
  const cls = ['app', layout.leftCollapsed && 'left-collapsed', layout.rightCollapsed && 'right-collapsed'].filter(Boolean).join(' ');

  return (
    <div className={cls} ref={appRef} style={style}>
      <TopBar
        onShowShortcuts={toggleHelp}
        inspectorHidden={layout.rightCollapsed}
        onToggleInspector={() => setLayout({ rightCollapsed: !layout.rightCollapsed })}
      />
      <aside className="app-left">
        <LeftPanel
          collapsed={layout.leftCollapsed}
          onToggleCollapsed={() => setLayout({ leftCollapsed: !layout.leftCollapsed })}
          onExpand={() => layout.leftCollapsed && setLayout({ leftCollapsed: false })}
        />
        {!layout.leftCollapsed && (
          <ResizeHandle
            size="left"
            value={layout.left}
            direction={1}
            defaultValue={DEFAULT_LAYOUT.left}
            label="Resize side panel"
            appRef={appRef}
            onCommit={(left) => setLayout({ left })}
          />
        )}
      </aside>
      <main className="app-center">
        <PreviewArea />
      </main>
      <aside className="app-right" aria-label="Inspector">
        {!layout.rightCollapsed && (
          <>
            <ResizeHandle
              size="right"
              value={layout.right}
              direction={-1}
              defaultValue={DEFAULT_LAYOUT.right}
              label="Resize inspector"
              appRef={appRef}
              onCommit={(right) => setLayout({ right })}
            />
            <div className="app-right-scroll">
              <InspectorPanel />
            </div>
          </>
        )}
      </aside>
      <section className="app-timeline" aria-label="Timeline">
        <ResizeHandle
          size="timeline"
          value={layout.timeline}
          direction={-1}
          defaultValue={DEFAULT_LAYOUT.timeline}
          label="Resize timeline"
          appRef={appRef}
          onCommit={(timeline) => setLayout({ timeline })}
        />
        <Timeline toolbarExtras={<ToolbarActions location="timeline" />} />
      </section>
      {!hydrated && (
        <div className="app-loading" role="status">
          <span className="spinner" aria-hidden />
          Restoring project…
        </div>
      )}
      {helpOpen && <ShortcutsDialog onClose={closeHelp} />}
      <TooltipLayer />
    </div>
  );
}
