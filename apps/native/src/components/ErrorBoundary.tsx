import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui';

/** Keeps a rendering error in one view from taking down the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  componentDidCatch(error: Error) { console.error('[view error]', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <span className="h-10 w-10 rounded-xl bg-warn-soft text-warn flex items-center justify-center"><AlertTriangle size={18} /></span>
        <div className="text-[0.9rem] font-medium">This view hit a problem</div>
        <div className="text-[0.75rem] text-fg-2 max-w-md mono selectable">{this.state.error.message}</div>
        <Button onClick={() => this.setState({ error: null })}>Reload view</Button>
      </div>
    );
  }
}
