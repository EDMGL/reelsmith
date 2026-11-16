import { Slot, useEditorStore, useRegistry, toolbarRegistry, type ToolbarAction, type ToolbarLocation } from '../core';

function ActionButton({ action }: { action: ToolbarAction }) {
  const enabled = useEditorStore((s) => (action.isEnabled ? action.isEnabled(s) : true));
  if (action.component) return <Slot name={action.id} component={action.component} props={{}} />;
  return (
    <button
      type="button"
      className={action.variant === 'primary' ? 'btn btn-primary' : 'btn'}
      data-action={action.id}
      title={action.title ?? action.label}
      disabled={!enabled}
      onClick={() => {
        try {
          const r = action.run?.();
          if (r instanceof Promise) r.catch((e) => console.error(`[action:${action.id}]`, e));
        } catch (e) {
          console.error(`[action:${action.id}]`, e);
        }
      }}
    >
      {action.icon && <span className="btn-icon">{action.icon}</span>}
      {action.label}
    </button>
  );
}

/** Renders the registered toolbar actions of one location. */
export function ToolbarActions({ location }: { location: ToolbarLocation }) {
  const actions = useRegistry(toolbarRegistry).filter((a) => a.location === location);
  if (actions.length === 0) return null;
  return (
    <div className={`toolbar-actions toolbar-actions-${location}`}>
      {actions.map((a) => (
        <ActionButton key={a.id} action={a} />
      ))}
    </div>
  );
}
