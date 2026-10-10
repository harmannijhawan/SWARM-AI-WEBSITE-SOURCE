import { lazy, Suspense, useEffect, useState } from 'react';
import type { ApprovalRequest, AppNotification, ModelInfo, ProviderInfo, Run, SwarmEvent } from '../shared/types';
import type { Settings } from '../shared/settings';
import { useMotionChange } from './lib/motion';
import { api } from './lib/api';
import { useStore } from './lib/store';
import { useChat } from './lib/chat';
import { useWork, type WorkEvent } from './lib/workspace';
import { applyTheme, isDark, watchSystemTheme } from './lib/theme';
import { matches } from './lib/hotkeys';
import { Rail } from './components/Rail';
import { ProjectPanel } from './components/ProjectPanel';
import { TopBar } from './components/TopBar';
import { Inspector } from './components/Inspector';
import { CommandPalette } from './components/CommandPalette';
import { Toasts, NotificationPanel } from './components/Notifications';
import { ApprovalDialog } from './components/ApprovalDialog';
import { Experiments } from './components/Experiments';
import { DialogHost } from './components/Dialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Onboarding } from './views/Onboarding';
import { Home } from './views/Home';
import { Build } from './views/Build';
import { Chat, ChatSidebar } from './views/Chat';
import { Spinner, cx } from './components/ui';
import { Authentication } from './views/Authentication';
import type { AccountStatus } from './lib/api';
import { LogoMark } from './components/Logo';

const Agents = lazy(() => import('./views/Agents').then((m) => ({ default: m.Agents })));
const Models = lazy(() => import('./views/Models').then((m) => ({ default: m.Models })));
const Research = lazy(() => import('./views/Research').then((m) => ({ default: m.Research })));
const BrowserView = lazy(() => import('./views/BrowserView').then((m) => ({ default: m.BrowserView })));
const Files = lazy(() => import('./views/Files').then((m) => ({ default: m.Files })));
const Terminal = lazy(() => import('./views/Terminal').then((m) => ({ default: m.Terminal })));
const Runs = lazy(() => import('./views/Runs').then((m) => ({ default: m.Runs })));
const PhoneSetup = lazy(() => import('./views/PhoneSetup').then((m) => ({ default: m.PhoneSetup })));
const SettingsView = lazy(() => import('./views/Settings').then((m) => ({ default: m.SettingsView })));

export function App() {
  const [status,setStatus]=useState<AccountStatus|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{const off=window.swarm.on('account:changed',s=>setStatus(s as AccountStatus));void api.account.status().then(setStatus).catch(()=>setError('Account service could not start. Restart SWARM to retry.'));return off;},[]);
  if(!status?.connected)return <Authentication status={status} error={error}/>;
  return <WorkspaceApp/>;
}

function WorkspaceApp() {
  const [ready, setReady] = useState(false);
  const [bootError,setBootError]=useState(false);
  const boot = useStore((s) => s.boot);
  const view = useStore((s) => s.view);
  const pageMotion = useMotionChange<HTMLDivElement>(`${view}:${ready}`);
  const mode = useStore((s) => s.mode);
  const inspector = useStore((s) => s.inspector);
  const settings = useStore((s) => s.settings);

  useEffect(() => {
    const st = useStore.getState();
    st.set({view:'chat',mode:'CHAT'});
    let workRefresh: ReturnType<typeof setTimeout> | undefined;
    const offs = [
      window.swarm.on('workspace:event', payload => {
        const event = payload as WorkEvent;
        useWork.getState().ingest(event);
        if (['run_started', 'run_completed', 'run_failed', 'run_paused', 'run_resumed', 'run_stopped', 'agent_started', 'agent_status', 'file_created', 'file_modified', 'file_deleted', 'approval_required', 'approval_resolved', 'task_completed', 'task_failed'].includes(event.type)) {
          if (!workRefresh) workRefresh = setTimeout(() => { workRefresh = undefined; void useWork.getState().refresh(); }, 250);
        }
      }),
      window.swarm.on('events', (p) => useStore.getState().ingest(p as SwarmEvent[])),
      window.swarm.on('run:updated', (p) => {
        const run = p as Run;
        useStore.setState((s) => ({ runs: { ...s.runs, [run.id]: run }, previewUrl: run.id === s.runId && run.previewUrl ? run.previewUrl : s.previewUrl }));
      }),
      window.swarm.on('models:changed', (p) => { const v = p as { models: ModelInfo[]; providers: ProviderInfo[] }; useStore.setState({ models: v.models, providers: v.providers }); }),
      window.swarm.on('settings:changed', (p) => { useStore.setState({ settings: p as Settings }); applyTheme(p as Settings); }),
      window.swarm.on('notification', (p) => {
        const n = p as AppNotification;
        useStore.setState((s) => ({ notifications: [n, ...s.notifications].slice(0, 200) }));
        useStore.getState().toast({ level: n.level === 'debug' ? 'info' : n.level, title: n.title, body: n.body });
      }),
      window.swarm.on('approvals:changed', (p) => useStore.setState({ approvals: p as ApprovalRequest[] })),
      window.swarm.on('run:chat:updated', (p) => {
        const { conversationId, turn } = p as { conversationId: string; turn: import('../shared/types').RunChatTurn };
        useStore.getState().ingestRunChatTurn(conversationId, turn);
      }),
    ];
    offs.push(watchSystemTheme(() => useStore.getState().settings));
    (async () => {
      const [b, s, projects, models, notifications, approvals, active] = await Promise.all([
        api.bootstrap(), api.getSettings(), api.projects.list(), api.models.list(), api.notifications.list(), api.approvals.list(), api.runs.active(),
      ]);
      applyTheme(s);
      st.set({ boot: b, settings: s, projects, models: models.models, providers: models.providers, notifications, approvals, activeRuns: active });
      // Launch into Chat. Opening a project is an explicit navigation action.
      setReady(true);
    })().catch((e) => { setBootError(true); setReady(true); });
    return () => { offs.forEach((o) => o()); if (workRefresh) clearTimeout(workRefresh); };
  }, []);

  // Global keyboard shortcuts (configurable in Settings › Keyboard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (e.altKey && (e.key === '1' || e.key === '2')) { e.preventDefault(); s.setMode(e.key === '1' ? 'CHAT' : 'BUILD'); return; }
      if (matches(e, 'Mod+Shift+B')) { e.preventDefault(); s.setMode('BUILD'); return; }
      // Browser-style back navigation (Alt+Left on Windows/Linux, Cmd+[ on Mac)
      if ((e.altKey && e.key === 'ArrowLeft') || (e.metaKey && e.key === '[')) {
        if (s.canNavigateBack()) {
          e.preventDefault();
          s.navigateBack();
          return;
        }
      }
      const k = s.settings?.keyboard;
      if (!k) return;
      if (matches(e, k.palette)) { e.preventDefault(); s.set({ paletteOpen: !s.paletteOpen, paletteMode: 'all' }); return; }
      if (matches(e, k.search)) { e.preventDefault(); s.set({ paletteOpen: true, paletteMode: s.projectId ? 'files' : 'projects' }); return; }
      if (matches(e, k.newProject)) { e.preventDefault(); if (s.mode === 'CHAT') { void useChat.getState().fresh().catch(e => useChat.setState({ error: String(e) })); return; } s.openProject(null, 'build'); setTimeout(() => document.getElementById('composer-input')?.focus(), 50); return; }
      if (matches(e, k.settings)) { e.preventDefault(); s.setView('settings'); return; }
      if (matches(e, k.toggleTheme)) {
        e.preventDefault();
        if (s.settings) void s.saveSettings({ appearance: { theme: isDark(s.settings) ? 'light' : 'dark' } });
        return;
      }
      if (matches(e, k.toggleInspector)) { e.preventDefault(); if (s.settings) void s.saveSettings({ interface: { showInspector: !s.settings.interface.showInspector } }); return; }
      if (matches(e, k.terminal)) { e.preventDefault(); if (s.projectId) s.setView('terminal'); return; }
      if (e.key === 'Escape') {
        if (s.paletteOpen) s.set({ paletteOpen: false });
        else if (s.notificationsOpen) s.set({ notificationsOpen: false });
        else if (s.inspector) s.set({ inspector: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if(bootError)return <main className="authentication"><h1>SWARM could not load your workspace</h1><p>Your data has been preserved.</p><button onClick={()=>location.reload()}>Retry</button></main>;
  if (!ready || !settings) {
    return <div className="h-full flex items-center justify-center drag"><div className="swarm-wake"><LogoMark size={36} /></div></div>;
  }
  // Account authentication is the first-run flow; signed-in users enter Chat.

  const showInspector = !!inspector && settings.interface.showInspector && (view === 'agents' || view === 'models');

  return (
    <div className={cx('swarm-startup h-full flex bg-bg text-fg')}>
      {mode === 'BUILD' && <Rail />}
      {mode === 'CHAT' ? <ChatSidebar /> : view !== 'build' && !settings.interface.sidebarCollapsed && <ProjectPanel />}
      <main className="flex-1 min-w-0 flex flex-col">
        <TopBar />
        <div className="flex-1 min-h-0 flex">
          <div ref={pageMotion} className="flex-1 min-w-0 relative">
            <ErrorBoundary resetKey={view}>
            <Suspense fallback={<div className="h-full flex items-center justify-center text-fg-3"><Spinner /></div>}>
              {view === 'home' && <Home />}
              <div className={view === 'chat' ? 'h-full' : 'hidden'}><Chat /></div>
              {/* Build view remains mounted to preserve state when navigating away */}
              <div className={view === 'build' ? 'h-full' : 'hidden'}><Build /></div>
              {view === 'agents' && <Agents />}
              {view === 'models' && <Models />}
              {view === 'research' && <Research />}
              {view === 'browser' && <BrowserView />}
              {view === 'files' && <Files />}
              {view === 'terminal' && <Terminal />}
              {view === 'runs' && <Runs />}
              {view === 'settings' && <SettingsView />}
              {view === 'phone' && <PhoneSetup />}
            </Suspense>
            </ErrorBoundary>
          </div>
          {showInspector && <Inspector />}
        </div>
      </main>
      <CommandPalette />
      <DialogHost />
      <NotificationPanel />
      <ApprovalDialog /><Experiments />
      <Toasts />
    </div>
  );
}
