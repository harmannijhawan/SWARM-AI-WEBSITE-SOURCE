import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenText, Boxes, FileDiff, FileText, Globe2, ListTree, MessageSquareText,
  MessagesSquare, Play, X, SquareTerminal,
} from 'lucide-react';
import type { AgentRole, AgentState, Task } from '../../shared/types';
import { api } from '../lib/api';
import { currentProject, currentRun, useStore, type StageTab } from '../lib/store';
import { useElementWidth } from '../lib/hooks';
import { Composer } from '../components/Composer';
import { AgentGraph, TaskGraph } from '../components/AgentGraph';
import { ActivityFeed } from '../components/ActivityFeed';
import { RuntimePane } from '../components/RuntimePane';
import { TerminalPane } from '../components/TerminalPane';
import { ChangesPane } from '../components/ChangesPane';
import { ResearchPane } from '../components/ResearchPane';
import { MessagesPane } from '../components/MessagesPane';
import { LiveRunChatPanel } from '../components/LiveRunChatPanel';
import { Badge, Button, Dot, Empty, Segmented, Tabs, cx } from '../components/ui';

const EMPTY_TASKS: Record<string, Task> = {};
const EMPTY_AGENTS: Partial<Record<AgentRole, AgentState>> = {};

const MIN_CHAT_W = 360;
const MAX_CHAT_W = 520;

// ─── resizable panel splitter ─────────────────────────────────────────────────
function PanelResizer({ onDelta }: { onDelta: (dx: number) => void }) {
  const lastX = useRef(0);
  return <div className="build-panel-resizer" role="separator" aria-label="Resize agent panel" aria-orientation="vertical" tabIndex={0}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onDelta(e.key === 'ArrowLeft' ? 20 : -20); } }}
    onPointerDown={e => { e.preventDefault(); lastX.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { onDelta(lastX.current - e.clientX); lastX.current = e.clientX; } }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} />;
}

export function Build() {
  const view = useStore((s) => s.view);
  const project = useStore(currentProject);
  const run = useStore(currentRun);
  const runId = useStore((s) => s.runId);
  const tasksMap = useStore((s) => (s.runId ? s.tasks[s.runId] ?? EMPTY_TASKS : EMPTY_TASKS));
  const agents = useStore((s) => (s.runId ? s.agents[s.runId] ?? EMPTY_AGENTS : EMPTY_AGENTS));
  const events = useStore((s) => (s.runId ? s.events[s.runId] : undefined));
  const messages = useStore((s) => (s.runId ? s.messages[s.runId] : undefined));
  const stageTab = useStore((s) => s.stageTab);
  const previewUrl = useStore((s) => s.previewUrl);
  const settings = useStore((s) => s.settings)!;
  const chatPanelWidth = useStore((s) => s.chatPanelWidth);
  const setChatPanelWidth = useStore((s) => s.setChatPanelWidth);

  // Note: This component remains mounted when navigating away (view !== 'build')
  // to preserve build state, graph positions, and subscriptions. The CSS 'hidden'
  // class hides it visually, but state and event listeners remain active.
  // This ensures users can return to the exact same view state.

  const [artifacts, setArtifacts] = useState<{ path: string; kind: string; bytes?: number }[]>([]);
  useEffect(() => {
    let current = true;
    setArtifacts([]);
    if (runId && run?.status !== 'running') api.runs.artifacts(runId).then(items => { if (current) setArtifacts(items.filter((a, i) => items.findIndex(b => b.path === a.path) === i)); }).catch(() => undefined);
    return () => { current = false; };
  }, [runId, run?.status]);

  const [graphMode, setGraphMode] = useState<'agents' | 'tasks'>('agents');
  const [logMode, setLogMode] = useState<'simple' | 'detailed'>(settings.interface.userLogDetail);
  const [narrowTab, setNarrowTab] = useState<string>('graph');
  const [surface, setSurface] = useState<string>('activity');
  const panelOpen = useStore(s => s.chatPanelOpen);
  const setPanelOpen = (open: boolean) => useStore.setState({ chatPanelOpen: open });
  const graphArea = useRef<HTMLDivElement>(null);
  const [graphHeight, setGraphHeight] = useState(480);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  useEffect(() => { const el = graphArea.current; if (!el) return; const ro = new ResizeObserver(() => setGraphHeight(el.clientHeight)); ro.observe(el); return () => ro.disconnect(); }, [project?.id, width, narrowTab]);
  useEffect(() => { if (useStore.getState().stageLockedUntil > Date.now()) setSurface(stageTab); }, [stageTab]);
  useEffect(() => { const open = () => { setPanelOpen(true); setNarrowTab('chat'); }; window.addEventListener('swarm:agent-selected', open); return () => window.removeEventListener('swarm:agent-selected', open); }, []);
  const tasks = useMemo(() => Object.values(tasksMap).sort((a, b) => a.createdAt - b.createdAt), [tasksMap]);

  const handlePanelDelta = useCallback((dx: number) => {
    setChatPanelWidth(Math.max(MIN_CHAT_W, Math.min(MAX_CHAT_W, chatPanelWidth + dx)));
  }, [chatPanelWidth, setChatPanelWidth]);

  if (!project) return (
    <div className="build-start">
      <div className="build-start-inner">
        <span className="build-eyebrow">AUTONOMOUS WORKSPACE</span>
        <h1>What should SWARM build?</h1>
        <p>Describe the outcome and target platform. SWARM will plan, build, and verify the result.</p>
        <div className="build-start-targets" aria-label="Build target examples">
          {[['Web', 'Build a website that '], ['Windows', 'Build a Windows app that '], ['Android', 'Make an Android app that '], ['CLI', 'Create a CLI tool that ']].map(([label, prompt]) => (
            <button key={label} onClick={() => window.dispatchEvent(new CustomEvent('swarm:prefill', { detail: prompt }))}>{label} <span>↗</span></button>
          ))}
        </div>
        <div className="build-start-composer"><Composer variant="hero" /></div>
        <p className="build-start-note">The agent graph, activity, files, and validation appear here when execution starts.</p>
      </div>
    </div>
  );

  // ── responsive breakpoints ────────────────────────────────────────────────
  // Switch to separate surfaces before the graph becomes an unreadable column.
  const narrow = width < 1100;

  const stageTabs: { value: StageTab; label: string; icon: typeof Globe2; count?: number; live?: boolean }[] = [
    { value: 'preview', label: 'Preview', icon: Globe2, live: !!previewUrl && run?.status === 'running' },
    { value: 'terminal', label: 'Terminal', icon: SquareTerminal },
    { value: 'files', label: 'Files', icon: FileDiff, count: run?.stats.files },
    { value: 'research', label: 'Research', icon: BookOpenText, count: run?.stats.sources },
    { value: 'messages', label: 'Messages', icon: MessagesSquare, count: messages?.length },
  ];

  const stage = (tab: StageTab) => (
    tab === 'preview' ? <RuntimePane projectId={project.id} runId={runId} /> :
    tab === 'terminal' ? <TerminalPane projectId={project.id} runId={runId} /> :
    tab === 'files' ? <ChangesPane projectId={project.id} runId={runId} /> :
    tab === 'research' ? <ResearchPane projectId={project.id} runId={runId} /> :
    <MessagesPane messages={messages ?? []} />
  );

  const graphPanel = (h: number) => run && tasks.length ? (
    graphMode === 'agents'
      ? <AgentGraph run={run} tasks={tasks} agents={agents} height={h} />
      : <TaskGraph tasks={tasks} height={h} />
  ) : (
    <div className="flex items-center justify-center text-[0.75rem] text-fg-3" style={{ height: h }}>
      {run?.status === 'running' ? 'Manager is reading the objective…' : 'The agent graph appears when a run starts.'}
    </div>
  );

  const chatPanel = run && runId ? (
    <LiveRunChatPanel
      runId={runId}
      run={run}
      tasks={tasks}
      agents={agents}
    />
  ) : null;

  const bottomTabs = [{ value: 'activity', label: 'Live Activity', icon: ListTree }, { value: 'tasks', label: 'Tasks', icon: Boxes, count: tasks.length }, ...stageTabs];
  const bottom = surface === 'activity' ? <ActivityFeed events={events ?? []} mode={logMode} showTime={settings.interface.showTimestamps} /> :
    surface === 'tasks' ? <div className="build-task-list">{tasks.map((t, i) => <button className="motion-task" data-motion-state={t.status} style={{ animationDelay: `calc(var(--motion-stagger) * ${Math.min(i, 5)})` }} key={t.id} onClick={() => { useStore.getState().setActiveConversation(t.role); useStore.setState({ inspector: { type: 'task', id: t.id } }); window.dispatchEvent(new Event('swarm:agent-selected')); }}><Dot tone={t.status === 'completed' ? 'ok' : t.status === 'failed' ? 'err' : t.status === 'running' ? 'accent' : 'neutral'} /><span>{t.title}</span><small>{t.role}</small><small>{t.status}</small></button>)}</div> : stage(surface as StageTab);
  return (
    <div ref={ref} className="build-workspace h-full flex flex-col min-h-0">
      {narrow && <div className="build-mobile-tabs"><Tabs value={narrowTab} onChange={setNarrowTab} tabs={[{ value: 'graph', label: 'Graph', icon: Boxes }, { value: 'activity', label: 'Activity', icon: ListTree }, { value: 'chat', label: 'Manager', icon: MessageSquareText }]} /></div>}
      <div className="build-control-room">
        {(!narrow || narrowTab !== 'chat') && <div className="build-main-surface">
          {run ? <Mission /> : <NoRun />}
          {(!narrow || narrowTab === 'graph') && <section className="build-graph-surface" ref={graphArea}>
            <div className="build-graph-toolbar"><Segmented size="sm" value={graphMode} onChange={setGraphMode} label="Graph mode" options={[{ value: 'agents', label: 'Agents', icon: Boxes }, { value: 'tasks', label: 'Dependencies', icon: ListTree }]} /><span>{Object.keys(agents).length} agents · {tasks.length} total tasks</span>{!panelOpen && <Button variant="ghost" icon={MessageSquareText} onClick={() => { useStore.getState().setActiveConversation('manager'); setPanelOpen(true); }}>Manager</Button>}</div>
            {graphPanel(graphHeight - 42)}
          </section>}
          {(!narrow || narrowTab === 'activity') && <section className={cx('build-activity-surface', surface !== 'activity' && surface !== 'tasks' && 'build-activity-expanded', narrow && narrowTab === 'activity' && 'build-activity-mobile')}>
            <div className="build-activity-tabs"><Tabs value={surface} onChange={setSurface} tabs={bottomTabs} /><button className="build-log-toggle" onClick={() => setLogMode(logMode === 'simple' ? 'detailed' : 'simple')}>{logMode === 'simple' ? 'Details' : 'Simple'}</button></div>
            <div key={surface} className="motion-arrive flex-1 min-h-0">{bottom}</div>
          </section>}
        </div>}
        {(!narrow && panelOpen || narrow && narrowTab === 'chat') && <>
          {!narrow && <PanelResizer onDelta={handlePanelDelta} />}
          <section className="build-agent-panel" style={{ width: narrow ? '100%' : Math.min(chatPanelWidth, Math.max(MIN_CHAT_W, width - 700)) }}>
            <button className="build-panel-close" aria-label="Close agent panel" onClick={() => { setPanelOpen(false); setNarrowTab('graph'); }}><X size={16} /></button>
            {chatPanel ?? <Empty icon={MessageSquareText} title="Manager" body="Start a build to direct the workforce." />}
          </section>
        </>}
      </div>
      {artifacts.length > 0 && <div className="build-artifacts">{artifacts.map(a => <Button key={a.path} variant="ghost" icon={FileText} onClick={() => api.projects.reveal(project.id, a.path).catch(() => {})}>{a.path.split('/').pop()}</Button>)}</div>}
      {!run && <div className="px-4 pb-3"><Composer variant="dock" /></div>}
    </div>
  );
}

// ─── Mission header ───────────────────────────────────────────────────────────
function Mission() {
  const run = useStore(currentRun)!;
  const project = useStore(currentProject)!;
  const tasksMap = useStore(s => s.runId ? s.tasks[s.runId] ?? EMPTY_TASKS : EMPTY_TASKS);
  const tasks = Object.values(tasksMap).filter(t => !['skipped', 'cancelled'].includes(t.status));
  const counts = [
    { label: 'Completed', count: tasks.filter(t => t.status === 'completed').length, tone: 'ok' },
    { label: 'Active', count: tasks.filter(t => t.status === 'running').length, tone: 'accent' },
    { label: 'Queued', count: tasks.filter(t => t.status === 'waiting' || t.status === 'ready').length, tone: 'warn' },
    { label: 'Blocked', count: tasks.filter(t => t.status === 'blocked' || t.status === 'failed').length, tone: 'err' },
  ];
  return <div className="build-mission">
    <span className="mission-icon"><Boxes size={25} strokeWidth={1.6} /></span>
    <div className="mission-heading">
      <h1 title={run.brief?.title ?? project.name}>{run.brief?.title ?? 'Planning your build'}</h1>
      <p className="mission-objective selectable" title={run.objective}>{run.objective.split('\n')[0]}</p>
      {['failed','attention'].includes(run.status) && run.summary && <p className="mission-warning">{run.summary}</p>}
    </div>
    <div className="mission-counts" aria-label="Live task counts"><div><strong>{run.stats.modelCalls}</strong><span>Model calls</span></div><div><strong>{run.stats.fallbacks}</strong><span>Recovery</span></div>{counts.map(c => <div key={c.label}><strong style={{ color: 'var(--' + c.tone + ')' }}>{c.count}</strong><span>{c.label}</span></div>)}</div>
  </div>;
}

function NoRun() {
  const project = useStore(currentProject)!;
  const toast = useStore((s) => s.toast);
  const settings = useStore((s) => s.settings)!;
  const start = async () => {
    try {
      const r = await api.runs.start(project.id, project.objective, { webResearch: project.settings.webResearch, autonomy: settings.behavior.autonomy });
      useStore.setState({ runId: r.id, runs: { ...useStore.getState().runs, [r.id]: r } });
    } catch (e) { toast({ level: 'error', title: 'Could not start', body: String((e as Error).message) }); }
  };
  return (
    <div className="px-6 pt-6 pb-4 shrink-0 anim-fade">
      <div className="flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[0.72rem] text-fg-3 mb-1.5">
            {project.isDemo ? <Badge tone="accent">Demo</Badge> : null}
            <span className="mono truncate">{project.path}</span>
          </div>
          <h1 className="text-[1.3rem] font-semibold tracking-[-0.015em]">{project.name}</h1>
          <p className="text-[0.84rem] text-fg-2 leading-relaxed line-clamp-3 mt-0.5">{project.objective || 'Describe what SWARM should do with this project below.'}</p>
        </div>
        {project.objective && <Button variant="primary" icon={Play} className="mt-4" onClick={start}>{project.isDemo ? 'Run demo' : 'Run'}</Button>}
      </div>
    </div>
  );
}
