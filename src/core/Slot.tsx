import { Component, Suspense, type ComponentType, type ErrorInfo, type ReactNode } from 'react';
import type { MaybeLazy } from './registry';

class SlotErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[slot:${this.props.name}]`, error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="slot-error" role="alert">
          <strong>{this.props.name}</strong> failed to render: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Renders a registered (possibly React.lazy) component inside Suspense and an
 * error boundary, so a broken feature never takes down the shell.
 */
export function Slot<P extends object>({ name, component, props }: { name: string; component: MaybeLazy<P>; props: P }) {
  const C = component as ComponentType<P>;
  return (
    <SlotErrorBoundary name={name}>
      <Suspense fallback={<div className="slot-loading">Loading…</div>}>
        <C {...props} />
      </Suspense>
    </SlotErrorBoundary>
  );
}
