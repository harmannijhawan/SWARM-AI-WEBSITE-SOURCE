// Universal Runtime Pane - Adapts to different platform targets
import { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle, Globe2, Monitor, Smartphone, Terminal as TermIcon, Server, Package } from 'lucide-react';
import { useStore } from '../lib/store';
import { Empty, cx } from './ui';
import { BrowserPane } from './BrowserPane';
import { useMotionChange } from '../lib/motion';
import { api } from '../lib/api';
import { currentRun } from '../lib/store';
import { TerminalPane } from './TerminalPane';
import type { RuntimeInfo, RuntimeType } from '../../electron/runtime/types';

interface RuntimePaneProps {
  projectId: string | null;
  runId: string | null;
  compact?: boolean;
}

export function RuntimePane({ projectId, runId, compact }: RuntimePaneProps) {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const run = useStore(currentRun);
  const previewMotion = useMotionChange<HTMLDivElement>(`${runId}:${runtimeInfo?.type}:${!!runtimeInfo}`);

  useEffect(() => {
    if (!runId) {
      setRuntimeInfo(null);
      return;
    }

    let cancelled = false;

    const fetchRuntimeInfo = async () => {
      try { const info = await api.runtime.getInfo(runId); if (!cancelled) setRuntimeInfo(info); } catch { if (!cancelled) setRuntimeInfo(null); }
    };

    fetchRuntimeInfo();
    const timer = setInterval(fetchRuntimeInfo, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runId]);

  const launch = async () => {
    if (!runId) return;
    setLaunching(true); setLaunchError(null);
    try { setRuntimeInfo(await api.runtime.launch(runId)); }
    catch (e) { setLaunchError(String(e)); }
    finally { setLaunching(false); }
  };
  // Expose real platform launch and prerequisite information.
  if (!runtimeInfo) {
    if (run?.target === 'web') return <BrowserPane url={run.previewUrl} projectId={projectId} compact={compact} />;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
      <Empty 
        icon={Activity} 
        title={`${run?.target ?? 'Application'} runtime`}
        body={launchError || run?.gates.filter(g => g.status === 'failed' || g.status === 'skipped').map(g => `${g.label}: ${g.detail ?? g.status}`).join(' · ') || 'No controlled runtime is available yet. Build results, artifacts and platform prerequisites are available in Tasks and Files.'}
      />
      {['windows', 'android', 'cli'].includes(run?.target ?? '') && <button className="px-3 py-2 rounded border border-line text-sm" onClick={launch} disabled={launching}>{launching ? 'Starting application…' : 'Launch application preview'}</button>}
      </div>
    );
  }

  // Route to appropriate pane based on runtime type
  const pane = (() => { switch (runtimeInfo.type) {
    case 'web':
      return <WebRuntimePane info={runtimeInfo} projectId={projectId} compact={compact} />;
    case 'macos':
    case 'linux':
    case 'windows':
      return <DesktopRuntimePane info={runtimeInfo} projectId={projectId} compact={compact} />;
    case 'android':
      return <AndroidRuntimePane info={runtimeInfo} projectId={projectId} compact={compact} />;
    case 'cli':
      return <CliRuntimePane info={runtimeInfo} projectId={projectId} compact={compact} />;
    case 'api':
      return <ApiRuntimePane info={runtimeInfo} projectId={projectId} compact={compact} />;
    case 'library':
      return <LibraryRuntimePane info={runtimeInfo} projectId={projectId} compact={compact} />;
    default:
      return <UnsupportedRuntimePane type={runtimeInfo.type} />;
  } })();
  return <div ref={previewMotion} className="h-full min-h-0" data-platform={runtimeInfo.type}>{pane}</div>;
}

// Web Runtime - Use existing BrowserPane
function WebRuntimePane({ info, projectId, compact }: { info: RuntimeInfo; projectId: string | null; compact?: boolean }) {
  return <BrowserPane url={info.url ?? null} projectId={projectId} compact={compact} />;
}

// Desktop Runtime - Show process info and logs
function DesktopRuntimePane({ info, projectId }: { info: RuntimeInfo; projectId: string | null; compact?: boolean }) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const capture = async () => {
    try { setScreenshot(await api.runtime.screenshot(info.id)); setCaptureError(null); }
    catch (e) { setCaptureError(String(e)); }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-line shrink-0">
        <Monitor className="w-5 h-5 text-accent" />
        <div className="flex-1">
          <div className="text-sm font-medium text-fg">{info.type.toUpperCase()} APP</div>
          <div className="text-xs text-fg-2 mono">{info.artifact}</div>
        </div>
        <RuntimeStatusBadge state={info.state} /><RuntimeControls info={info} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-auto bg-sunken p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <p className="text-xs text-fg-2">Interact with the actual application in its native window. Captures below come from that window.</p>
          {info.supportsScreenshots && <button onClick={capture} className="px-3 py-2 border border-line rounded text-xs">Capture application window</button>}
          {screenshot && <img src={screenshot} alt="Actual desktop application window" className="max-w-full" />}
          {captureError && <p className="text-xs text-err">{captureError}</p>}
          {/* Process info */}
          <div className="p-4 bg-panel rounded-lg border border-line">
            <div className="text-sm font-medium text-fg mb-3">Process Information</div>
            <div className="space-y-2 text-xs">
              {info.pid && (
                <div className="flex justify-between">
                  <span className="text-fg-2">Process ID</span>
                  <span className="mono text-fg">{info.pid}</span>
                </div>
              )}
              {info.startedAt && (
                <div className="flex justify-between">
                  <span className="text-fg-2">Started</span>
                  <span className="mono text-fg">{new Date(info.startedAt).toLocaleTimeString()}</span>
                </div>
              )}
              {info.stoppedAt && (
                <div className="flex justify-between">
                  <span className="text-fg-2">Stopped</span>
                  <span className="mono text-fg">{new Date(info.stoppedAt).toLocaleTimeString()}</span>
                </div>
              )}
              {info.exitCode !== undefined && (
                <div className="flex justify-between">
                  <span className="text-fg-2">Exit Code</span>
                  <span className={cx('mono', info.exitCode === 0 ? 'text-success' : 'text-err')}>{info.exitCode}</span>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {info.error && (
            <div className="p-4 bg-err-soft rounded-lg border border-err/30">
              <div className="flex gap-2 items-start">
                <AlertCircle className="w-4 h-4 text-err mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-err mb-1">Error</div>
                  <div className="text-xs text-err/90 mono">{info.error}</div>
                </div>
              </div>
            </div>
          )}

          {/* Logs */}
          <RuntimeLogs stdout={info.stdout} stderr={info.stderr} />
        </div>
      </div>
    </div>
  );
}

// Android Runtime - Show device info, logs, and screenshot
function AndroidRuntimePane({ info }: { info: RuntimeInfo; projectId: string | null; compact?: boolean }) {
  const [screenshot, setScreenshot] = useState<string | null>(null);
  useEffect(() => { let live = true; const capture = async () => { if (!info.supportsScreenshots) return; const shot = await api.runtime.screenshot(info.id).catch(() => null); if (live) setScreenshot(shot); }; void capture(); const timer = setInterval(capture, 5000); return () => { live = false; clearInterval(timer); }; }, [info.id, info.supportsScreenshots]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-line shrink-0">
        <Smartphone className="w-5 h-5 text-accent" />
        <div className="flex-1">
          <div className="text-sm font-medium text-fg">Android Application</div>
          <div className="text-xs text-fg-2 mono">{info.artifact}</div>
        </div>
        <RuntimeStatusBadge state={info.state} /><RuntimeControls info={info} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-auto bg-sunken p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Device/Screenshot preview placeholder */}
          <div className="p-4 bg-panel rounded-lg border border-line">
            <div className="text-sm font-medium text-fg mb-3">Device Preview</div>
            <div className="aspect-[9/16] max-w-xs mx-auto bg-sunken rounded-lg border border-line flex items-center justify-center text-fg-3 text-sm">
              {screenshot ? (
                <img src={screenshot} alt="App screenshot" className="w-full h-full object-contain" />
              ) : (
                'Screenshot not available'
              )}
            </div>
          </div>

          {/* Error */}
          {info.error && (
            <div className="p-4 bg-err-soft rounded-lg border border-err/30">
              <div className="flex gap-2 items-start">
                <AlertCircle className="w-4 h-4 text-err mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-err mb-1">Error</div>
                  <div className="text-xs text-err/90 mono">{info.error}</div>
                </div>
              </div>
            </div>
          )}

          {/* Logs (logcat output) */}
          <RuntimeLogs stdout={info.stdout} stderr={info.stderr} title="Logcat Output" />
        </div>
      </div>
    </div>
  );
}

// CLI Runtime - Show terminal output
function CliRuntimePane({ info }: { info: RuntimeInfo; projectId: string | null; compact?: boolean }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    try { if (!await api.runtime.input(info.id, input + '\n')) throw new Error('CLI is not accepting input'); setInput(''); setError(null); }
    catch (e) { setError(String(e)); }
  };
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-line shrink-0">
        <TermIcon className="w-5 h-5 text-accent" />
        <div className="flex-1">
          <div className="text-sm font-medium text-fg">CLI Application</div>
          <div className="text-xs text-fg-2 mono">{info.artifact}</div>
        </div>
        <RuntimeStatusBadge state={info.state} /><RuntimeControls info={info} />
      </div>

      {/* Terminal output - full screen */}
      <form onSubmit={e => { e.preventDefault(); void send(); }} className="flex gap-2 p-3 border-b border-line">
        <input aria-label="CLI input" value={input} onChange={e => setInput(e.target.value)} className="flex-1 bg-sunken rounded px-2 text-sm" disabled={info.state !== 'running'} />
        <button type="submit" disabled={info.state !== 'running'}>Send</button>
      </form>
      {error && <p className="text-xs text-err px-3">{error}</p>}
      <div className="flex-1 min-h-0 bg-[#1e1e1e] text-[#d4d4d4] font-mono text-xs p-4 overflow-auto">
        <pre className="whitespace-pre-wrap selectable">
          {info.stdout || 'No output yet...'}
        </pre>
        {info.stderr && (
          <pre className="whitespace-pre-wrap text-[#f48771] mt-2 selectable">
            {info.stderr}
          </pre>
        )}
      </div>
    </div>
  );
}

// API Runtime - Show server info and request inspector
function ApiRuntimePane({ info }: { info: RuntimeInfo; projectId: string | null; compact?: boolean }) {
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-line shrink-0">
        <Server className="w-5 h-5 text-accent" />
        <div className="flex-1">
          <div className="text-sm font-medium text-fg">API Server</div>
          {info.url && (
            <a 
              href={info.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline mono"
            >
              {info.url}
            </a>
          )}
        </div>
        <RuntimeStatusBadge state={info.state} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-auto bg-sunken p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Server info */}
          <div className="p-4 bg-panel rounded-lg border border-line">
            <div className="text-sm font-medium text-fg mb-3">Server Information</div>
            <div className="space-y-2 text-xs">
              {info.url && (
                <div className="flex justify-between">
                  <span className="text-fg-2">URL</span>
                  <a href={info.url} target="_blank" rel="noopener noreferrer" className="mono text-accent hover:underline">
                    {info.url}
                  </a>
                </div>
              )}
              {info.port && (
                <div className="flex justify-between">
                  <span className="text-fg-2">Port</span>
                  <span className="mono text-fg">{info.port}</span>
                </div>
              )}
              {info.pid && (
                <div className="flex justify-between">
                  <span className="text-fg-2">Process ID</span>
                  <span className="mono text-fg">{info.pid}</span>
                </div>
              )}
              {info.startedAt && (
                <div className="flex justify-between">
                  <span className="text-fg-2">Started</span>
                  <span className="mono text-fg">{new Date(info.startedAt).toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {info.error && (
            <div className="p-4 bg-err-soft rounded-lg border border-err/30">
              <div className="flex gap-2 items-start">
                <AlertCircle className="w-4 h-4 text-err mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-err mb-1">Error</div>
                  <div className="text-xs text-err/90 mono">{info.error}</div>
                </div>
              </div>
            </div>
          )}

          {/* Server logs */}
          <RuntimeLogs stdout={info.stdout} stderr={info.stderr} title="Server Logs" />
        </div>
      </div>
    </div>
  );
}

// Library Runtime - Show test results
function LibraryRuntimePane({ info }: { info: RuntimeInfo; projectId: string | null; compact?: boolean }) {
  const isPassing = info.state === 'stopped' && info.exitCode === 0;
  const isFailing = info.state === 'crashed' || (info.state === 'stopped' && info.exitCode !== 0);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-line shrink-0">
        <Package className="w-5 h-5 text-accent" />
        <div className="flex-1">
          <div className="text-sm font-medium text-fg">Library Tests</div>
          <div className="text-xs text-fg-2 mono">{info.artifact || 'Running tests...'}</div>
        </div>
        <RuntimeStatusBadge state={info.state} exitCode={info.exitCode} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-auto bg-sunken p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Status banner */}
          {isPassing && (
            <div className="p-4 bg-success-soft rounded-lg border border-success/30">
              <div className="flex gap-2 items-center">
                <CheckCircle className="w-5 h-5 text-success shrink-0" />
                <div className="text-sm font-medium text-success">All tests passed</div>
              </div>
            </div>
          )}

          {isFailing && (
            <div className="p-4 bg-err-soft rounded-lg border border-err/30">
              <div className="flex gap-2 items-start">
                <AlertCircle className="w-4 h-4 text-err mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-err mb-1">Tests failed</div>
                  {info.error && <div className="text-xs text-err/90 mono">{info.error}</div>}
                </div>
              </div>
            </div>
          )}

          {/* Test output */}
          <RuntimeLogs stdout={info.stdout} stderr={info.stderr} title="Test Output" />
        </div>
      </div>
    </div>
  );
}

// Unsupported runtime type fallback
function UnsupportedRuntimePane({ type }: { type: RuntimeType }) {
  return (
    <Empty 
      icon={AlertCircle} 
      title={`Unsupported runtime: ${type}`} 
      body="This runtime type is not yet implemented."
    />
  );
}

// Shared components

function RuntimeStatusBadge({ state, exitCode }: { state: string; exitCode?: number }) {
  const colors = {
    not_started: 'bg-fg-3/10 text-fg-3',
    starting: 'bg-accent/10 text-accent',
    running: 'bg-success/10 text-success',
    stopping: 'bg-warn/10 text-warn',
    stopped: exitCode === 0 ? 'bg-success/10 text-success' : 'bg-fg-3/10 text-fg-3',
    crashed: 'bg-err/10 text-err',
    failed: 'bg-err/10 text-err',
    unavailable: 'bg-warn/10 text-warn',
  };

  const labels = {
    not_started: 'Not Started',
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    stopped: exitCode === 0 ? 'Completed' : 'Stopped',
    crashed: 'Crashed',
    failed: 'Failed',
    unavailable: 'Unavailable',
  };

  return (
    <div data-state={state} className={cx('motion-runtime px-2 py-1 rounded text-xs font-medium', colors[state as keyof typeof colors] || 'bg-fg-3/10 text-fg-3')}>
      <Activity size={11} aria-hidden />{labels[state as keyof typeof labels] || state}
    </div>
  );
}

function RuntimeLogs({ stdout, stderr, title }: { stdout?: string; stderr?: string; title?: string }) {
  const [expanded, setExpanded] = useState(true);

  const hasLogs = !!stdout || !!stderr;

  return (
    <div className="p-4 bg-panel rounded-lg border border-line">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-sm font-medium text-fg mb-3 hover:text-accent transition-colors"
      >
        <span>{title || 'Logs'}</span>
        <span className="text-xs text-fg-3">{expanded ? '▼' : '▶'}</span>
      </button>
      
      {expanded && (
        <div className="space-y-2">
          {!hasLogs && (
            <div className="text-xs text-fg-3 py-2">No logs yet...</div>
          )}
          
          {stdout && (
            <div className="bg-sunken rounded p-3 max-h-60 overflow-auto">
              <pre className="text-xs mono text-fg-2 whitespace-pre-wrap selectable">{stdout}</pre>
            </div>
          )}
          
          {stderr && (
            <div className="bg-err-soft/20 rounded p-3 max-h-60 overflow-auto">
              <div className="text-xs font-medium text-err mb-2">Errors</div>
              <pre className="text-xs mono text-err/90 whitespace-pre-wrap selectable">{stderr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RuntimeControls({ info }: { info: RuntimeInfo }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); setError(null); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  return <div className="flex gap-2 text-xs">
    <button disabled={busy || info.state === 'starting'} onClick={() => void action(() => api.runtime.restart(info.id))}>Restart</button>
    <button disabled={busy || info.state !== 'running'} onClick={() => void action(() => api.runtime.stop(info.id))}>Stop</button>
    <button disabled={busy} onClick={() => void action(() => api.runtime.clear(info.id))}>Clear logs</button>
    {error && <span className="text-err" role="alert">{error}</span>}
  </div>;
}
