import { Slot, openPanel, panelRegistry, useActivePanelId, useRegistry } from '../core';

/** Tabbed left panel; tabs come from `registerPanel()`. */
export function LeftPanel() {
  const panels = useRegistry(panelRegistry);
  const activeId = useActivePanelId();
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  if (!active) return <div className="empty-hint">No panels registered.</div>;
  return (
    <div className="left-panel">
      <nav className="tabs" role="tablist" aria-label="Panels">
        {panels.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === active.id}
            className={p.id === active.id ? 'tab active' : 'tab'}
            onClick={() => openPanel(p.id)}
            title={p.title}
          >
            {p.icon && <span className="tab-icon">{p.icon}</span>}
            <span className="tab-title">{p.title}</span>
          </button>
        ))}
      </nav>
      <div className="panel-body" role="tabpanel">
        <Slot key={active.id} name={active.id} component={active.component} props={{}} />
      </div>
    </div>
  );
}
