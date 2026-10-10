import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './build-workspace.css';
import './polish.css';
import './motion.css';
import './workspace.css';
import { App } from './App';

// ─── Top-level startup error screen ──────────────────────────────────────────
// If the renderer crashes before React mounts (or during mount), show a
// diagnostic screen instead of a blank white window.

class StartupErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; detail: string }
> {
  state = { error: null as Error | null, detail: '' };

  static getDerivedStateFromError(error: Error) {
    return { error, detail: error?.stack ?? error?.message ?? String(error) };
  }

  componentDidCatch(error: Error) {
    console.error('[startup] Renderer crashed:', error);
  }

  private copy() {
    const text = `SWARM renderer error\n\n${this.state.detail}`;
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        position: 'fixed', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '16px', padding: '40px',
        background: '#0d0d0f', color: '#e8e8ea',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        <div style={{ fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' }}>SWARM</div>
        <div style={{ fontSize: '14px', color: '#888', maxWidth: '400px', textAlign: 'center', lineHeight: '1.5' }}>
          Unable to start the interface. This is likely a configuration or packaging issue.
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              height: '32px', padding: '0 14px', borderRadius: '8px',
              background: '#e8e8ea', color: '#0d0d0f', border: 'none',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Retry
          </button>
          <button
            onClick={() => this.setState(s => ({ detail: s.detail ? '' : (s.error?.stack ?? s.error?.message ?? '') }))}
            style={{
              height: '32px', padding: '0 14px', borderRadius: '8px',
              background: 'transparent', color: '#888',
              border: '1px solid #333', fontSize: '13px', cursor: 'pointer',
            }}
          >
            Diagnostics
          </button>
          <button
            onClick={() => this.copy()}
            style={{
              height: '32px', padding: '0 14px', borderRadius: '8px',
              background: 'transparent', color: '#888',
              border: '1px solid #333', fontSize: '13px', cursor: 'pointer',
            }}
          >
            Copy error
          </button>
        </div>
        {this.state.detail && (
          <pre style={{
            marginTop: '16px', padding: '16px', borderRadius: '8px',
            background: '#111', border: '1px solid #222',
            fontSize: '11px', color: '#e87070', maxWidth: '700px', width: '100%',
            overflow: 'auto', maxHeight: '260px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {this.state.detail}
          </pre>
        )}
      </div>
    );
  }
}

// ─── Global unhandled error capture (catches errors outside React tree) ───────
window.addEventListener('error', (e) => {
  console.error('[unhandled error]', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled rejection]', e.reason);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartupErrorBoundary>
      <App />
    </StartupErrorBoundary>
  </StrictMode>,
);
