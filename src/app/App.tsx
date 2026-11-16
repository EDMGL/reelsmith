import { useEditorStore } from '../core';
import { Timeline } from '../features/timeline/Timeline';
import { InspectorPanel } from './InspectorPanel';
import { LeftPanel } from './LeftPanel';
import { PreviewArea } from './PreviewArea';
import { ToolbarActions } from './ToolbarActions';
import { TopBar } from './TopBar';
import { useGlobalShortcuts } from './shortcuts';

export function App() {
  useGlobalShortcuts();
  const hydrated = useEditorStore((s) => s.hydrated);
  return (
    <div className="app">
      <TopBar />
      <aside className="app-left">
        <LeftPanel />
      </aside>
      <main className="app-center">
        <PreviewArea />
      </main>
      <aside className="app-right">
        <InspectorPanel />
      </aside>
      <section className="app-timeline" aria-label="Timeline">
        <Timeline toolbarExtras={<ToolbarActions location="timeline" />} />
      </section>
      {!hydrated && <div className="app-loading">Restoring project…</div>}
    </div>
  );
}
