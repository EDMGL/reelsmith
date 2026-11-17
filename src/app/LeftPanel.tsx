import { Icon, Slot, openPanel, panelRegistry, useActivePanelId, useRegistry, type IconName } from '../core';

/** Shell-side icon set for the registered panels (falls back to the panel's own icon). */
const PANEL_ICONS: Record<string, IconName> = {
  media: 'media',
  record: 'record',
  text: 'text',
  subtitles: 'subtitles',
  music: 'music',
  voiceover: 'mic',
  effects: 'effects',
  silence: 'silence',
};

interface Props {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Called when a tab is clicked (expands a collapsed panel). */
  onExpand?: () => void;
}

/** Icon rail + panel body; tabs come from `registerPanel()`. */
export function LeftPanel({ collapsed = false, onToggleCollapsed, onExpand }: Props) {
  const panels = useRegistry(panelRegistry);
  const activeId = useActivePanelId();
  const active = panels.find((p) => p.id === activeId) ?? panels[0];
  if (!active) return <div className="empty-hint">No panels registered.</div>;
  return (
    <div className={collapsed ? 'left-panel collapsed' : 'left-panel'}>
      <div className="rail">
        <nav className="tabs" role="tablist" aria-label="Panels" aria-orientation="vertical">
          {panels.map((p) => {
            const icon = PANEL_ICONS[p.id];
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={p.id === active.id}
                className={p.id === active.id ? `tab active tab-${p.id}` : `tab tab-${p.id}`}
                onClick={() => {
                  openPanel(p.id);
                  onExpand?.();
                }}
                title={p.title}
              >
                <span className="tab-icon">{icon ? <Icon name={icon} size={20} /> : p.icon}</span>
                <span className="tab-title">{p.title}</span>
              </button>
            );
          })}
        </nav>
        {onToggleCollapsed && (
          <button
            type="button"
            className="rail-toggle"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Show side panel' : 'Hide side panel'}
            title={collapsed ? 'Show side panel' : 'Hide side panel'}
            aria-expanded={!collapsed}
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={16} />
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="panel-body" role="tabpanel" aria-label={active.title}>
          <div className="panel-content">
            <Slot key={active.id} name={active.id} component={active.component} props={{}} />
          </div>
        </div>
      )}
    </div>
  );
}
