import { useMemo, useState } from 'react';
import { Check, ChevronRight, Circle, FileCode2, Globe, SquareTerminal, X, XCircle, FolderTree, Eye } from 'lucide-react';
import type { AgentRole, Task } from '../../shared/types';
import { useStore } from '../lib/store';
import { clock, duration, num, ctxLen, timeAgo } from '../lib/format';
import { ROLE_META, agentLabel, agentTone, healthLabel, healthTone, taskLabel, taskTone } from './status';
import { ActivityFeed } from './ActivityFeed';
import { Badge, Dot, IconButton, Meter, Spinner, Tabs, cx } from './ui';

const TOOLS: Record<AgentRole, ('fs' | 'terminal' | 'browser' | 'web')[]> = {
  manager: [], planner: [], researcher: ['web'], designer: ['fs'], architect: ['fs'], coder: ['fs', 'terminal'], tester: ['terminal', 'browser'],
  reviewer: ['fs'], optimizer: ['fs', 'terminal'], vision: ['browser'], finalizer: ['fs'],
};
const TOOL_META = { fs: { label: 'File system', icon: FolderTree }, terminal: { label: 'Terminal', icon: SquareTerminal }, browser: { label: 'Browser', icon: Eye }, web: { label: 'Web search', icon: Globe } };

export function Inspector() {
  const target = useStore((s) => s.inspector);
  return (
    <aside aria-label="Inspector" className="w-[340px] shrink-0 border-l border-line bg-panel flex flex-col min-h-0 anim-fade">
      {target?.type === 'agent' && <AgentInspector role={target.role} />}
      {target?.type === 'task' && <TaskInspector id={target.id} />}
      {target?.type === 'model' && <ModelInspector id={target.id} />}
    </aside>
  );
}

function Header({ icon: Icon, title, sub, badge }: { icon: typeof Globe; title: string; sub: string; badge?: React.ReactNode }) {
  return (
    <div className="px-4 pt-4 pb-3 flex items-start gap-3">
      <span className="h-10 w-10 rounded-xl border border-line flex items-center justify-center shrink-0"><Icon size={17} strokeWidth={1.8} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="text-[0.95rem] font-semibold truncate">{title}</span>{badge}</div>
        <div className="text-[0.72rem] text-fg-3 truncate">{sub}</div>
      </div>
      <IconButton icon={X} label="Close inspector" size="sm" onClick={() => useStore.setState({ inspector: null })} />
    </div>
  );
}

function Row({ label, children, onClick }: { label: string; children: React.ReactNode; onClick?: () => void }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C onClick={onClick} className={cx('w-full flex items-start justify-between gap-3 py-2 text-left', onClick && 'hover:bg-hover/50 -mx-2 px-2 rounded-md')}>
      <span className="text-[0.72rem] text-fg-3 shrink-0 pt-[1px]">{label}</span>
      <span className="text-[0.76rem] text-fg text-right min-w-0 break-words flex items-center gap-1">{children}{onClick && <ChevronRight size={12} className="text-fg-3" />}</span>
    </C>
  );
}

function AgentInspector({ role }: { role: AgentRole }) {
  const runId = useStore((s) => s.runId);
  const agent = useStore((s) => (s.runId ? s.agents[s.runId]?.[role] : undefined));
  const tasksMap = useStore((s) => (s.runId ? s.tasks[s.runId] : undefined));
  const events = useStore((s) => (s.runId ? s.events[s.runId] : undefined));
  const messages = useStore((s) => (s.runId ? s.messages[s.runId] : undefined));
  const models = useStore((s) => s.models);
  const settings = useStore((s) => s.settings)!;
  const [tab, setTab] = useState<'overview' | 'output' | 'logs' | 'files'>('overview');
  const tasks = useMemo(() => Object.values(tasksMap ?? {}).filter((t) => t.role === role).sort((a, b) => a.createdAt - b.createdAt), [tasksMap, role]);
  const current = tasks.find((t) => t.status === 'running') ?? tasks[tasks.length - 1];
  const stream = useStore((s) => (current ? s.streams[current.id] : undefined));
  const M = ROLE_META[role];
  const model = models.find((m) => m.id === (current?.modelId ?? agent?.modelId));
  const myMsgs = (messages ?? []).filter((m) => m.from === role || m.to === role).slice(-6);
  const done = tasks.filter((t) => t.status === 'completed').length;
  const perms = settings.agents.permissions[role];
  const toolOn = (t: 'fs' | 'terminal' | 'browser' | 'web') => (perms ? perms[t] : true) && (t === 'fs' ? settings.computer.filesystem : t === 'terminal' ? settings.computer.terminal : t === 'browser' ? settings.computer.browser : settings.computer.web);
  const failures = (events ?? []).filter((e) => e.agent === role && (e.level === 'error' || e.type === 'MODEL_FALLBACK')).slice(-4);

  return (
    <>
      <Header icon={M.icon} title={M.name} sub={M.title} badge={<span className="flex items-center gap-1 text-[0.7rem] text-fg-2"><Dot tone={agentTone(agent?.status)} pulse={agent?.status === 'working' || agent?.status === 'planning'} />{agentLabel(agent?.status)}</span>} />
      <div className="px-3 border-b border-line"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'output', label: 'Output', live: !!current && current.status === 'running' }, { value: 'logs', label: 'Logs' }, { value: 'files', label: 'Files', count: agent?.filesTouched.length ?? new Set(tasks.flatMap((t) => t.filesTouched)).size }]} /></div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'overview' && (
          <div className="px-4 py-3 space-y-5">
            <div className="divide-y divide-line">
              <Row label="Model" onClick={model ? () => useStore.setState({ view: 'models', inspector: { type: 'model', id: model.id } }) : undefined}>{model ? model.displayName : <span className="text-fg-3">Not assigned yet</span>}</Row>
              {model && <Row label="Provider">{model.providerId}{model.freeStatus === 'local' ? ' · local' : ' · free'}</Row>}
              <Row label="Current task">{current ? current.title : <span className="text-fg-3">—</span>}</Row>
              {agent?.lastAction && <Row label="Last action"><span className="text-fg-2">{agent.lastAction}</span></Row>}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5"><span className="text-[0.72rem] font-medium">Progress</span><span className="text-[0.7rem] text-fg-3 tabular">{done}/{tasks.length}</span></div>
              <Meter value={tasks.length ? done / tasks.length : 0} />
              <ul className="mt-2.5 space-y-1.5">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <button onClick={() => useStore.setState({ inspector: { type: 'task', id: t.id } })} className="w-full flex items-center gap-2 text-left text-[0.76rem] hover:text-fg">
                      <TaskIcon t={t} /><span className={cx('truncate', t.status === 'completed' ? 'text-fg-2' : 'text-fg')}>{t.title}</span>
                      {t.endedAt && t.startedAt && <span className="ml-auto text-[0.66rem] text-fg-3 tabular">{duration(t.endedAt - t.startedAt)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[0.72rem] font-medium mb-1.5">Tools</div>
              {TOOLS[role].length ? TOOLS[role].map((t) => { const T = TOOL_META[t]; const on = toolOn(t); return (
                <div key={t} className="flex items-center gap-2 py-1 text-[0.76rem]"><T.icon size={13} className="text-fg-3" /><span className="flex-1">{T.label}</span><Dot tone={on ? 'ok' : 'neutral'} /><span className="text-[0.66rem] text-fg-3">{on ? 'allowed' : 'disabled'}</span></div>
              ); }) : <div className="text-[0.74rem] text-fg-3">Reasoning only — no tools</div>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Tokens" value={num(agent?.tokens ?? tasks.reduce((n, t) => n + t.tokens, 0))} />
              <Stat label="Tasks done" value={String(done)} />
              <Stat label="Errors" value={String(agent?.errors ?? tasks.filter((t) => t.status === 'failed').length)} />
            </div>
            {failures.length > 0 && (
              <div>
                <div className="text-[0.72rem] font-medium mb-1.5">Recoveries & errors</div>
                {failures.map((e) => <div key={e.id} className="text-[0.72rem] text-fg-2 py-1 flex gap-2"><span className="text-fg-3 tabular mono text-[0.66rem] pt-px">{clock(e.ts)}</span><span className={e.level === 'error' ? 'text-err' : ''}>{e.message}</span></div>)}
              </div>
            )}
            {myMsgs.length > 0 && (
              <div>
                <div className="text-[0.72rem] font-medium mb-1.5">Messages</div>
                <div className="space-y-2">
                  {myMsgs.map((m) => (
                    <div key={m.id} className="rounded-lg bg-sunken px-3 py-2">
                      <div className="text-[0.66rem] text-fg-3 mb-0.5">{ROLE_META[m.from].name} → {m.to === 'all' ? 'Team' : ROLE_META[m.to].name} · {timeAgo(m.ts)}</div>
                      <div className="text-[0.74rem] text-fg-2 leading-relaxed">{m.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {tab === 'output' && (
          <div className="p-3">
            {current ? (
              <>
                <div className="text-[0.7rem] text-fg-3 mb-2 flex items-center gap-1.5">{current.status === 'running' && <Spinner size={10} />} Live model output · {current.title}</div>
                <pre className="mono text-[0.68rem] leading-[1.5] whitespace-pre-wrap break-words text-fg-2 bg-sunken rounded-lg p-3 selectable max-h-[70vh] overflow-auto">{stream || current.output || 'No output streamed yet.'}</pre>
              </>
            ) : <div className="text-[0.75rem] text-fg-3 p-2">No tasks yet.</div>}
          </div>
        )}
        {tab === 'logs' && <div className="h-[calc(100vh-220px)]"><ActivityFeed events={events ?? []} mode="detailed" agent={role} showTime /></div>}
        {tab === 'files' && (
          <ul className="p-2">
            {[...new Set(tasks.flatMap((t) => t.filesTouched))].map((f) => (
              <li key={f}><button onClick={() => useStore.setState({ view: 'files', selectedFile: f })} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-hover text-left"><FileCode2 size={13} className="text-fg-3" /><span className="mono text-[0.72rem] truncate">{f}</span></button></li>
            ))}
            {!tasks.some((t) => t.filesTouched.length) && <li className="p-2 text-[0.74rem] text-fg-3">No files touched.</li>}
          </ul>
        )}
      </div>
      {runId && null}
    </>
  );
}

function TaskIcon({ t }: { t: Task }) {
  if (t.status === 'completed') return <span className="h-3.5 w-3.5 rounded-[4px] bg-ok text-white flex items-center justify-center shrink-0"><Check size={9} strokeWidth={3} /></span>;
  if (t.status === 'failed') return <XCircle size={14} className="text-err shrink-0" />;
  if (t.status === 'running') return <Spinner size={13} className="text-accent shrink-0" />;
  return <Circle size={14} className="text-fg-3 shrink-0" />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line px-2.5 py-2"><div className="text-[0.64rem] text-fg-3">{label}</div><div className="text-[0.9rem] font-semibold tabular">{value}</div></div>;
}

function TaskInspector({ id }: { id: string }) {
  const task = useStore((s) => (s.runId ? s.tasks[s.runId]?.[id] : undefined));
  const all = useStore((s) => (s.runId ? s.tasks[s.runId] : undefined));
  const events = useStore((s) => (s.runId ? s.events[s.runId] : undefined));
  const stream = useStore((s) => s.streams[id]);
  const models = useStore((s) => s.models);
  if (!task) return <div className="p-4 text-[0.75rem] text-fg-3">Task not found.</div>;
  const M = ROLE_META[task.role];
  const model = models.find((m) => m.id === task.modelId);
  const taskEvents = (events ?? []).filter((e) => e.taskId === id);
  return (
    <>
      <Header icon={M.icon} title={task.title} sub={`${M.name} · ${task.kind}`} badge={<Badge tone={taskTone(task.status)}>{taskLabel(task.status)}</Badge>} />
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-4">
        <div className="divide-y divide-line">
          <Row label="Agent" onClick={() => useStore.setState({ inspector: { type: 'agent', role: task.role } })}>{M.name}</Row>
          <Row label="Model">{model?.displayName ?? '—'}</Row>
          <Row label="Duration">{task.startedAt ? duration((task.endedAt ?? Date.now()) - task.startedAt) : 'Not started'}</Row>
          <Row label="Attempt">{task.attempt}</Row>
          <Row label="Tokens">{num(task.tokens)}</Row>
          <Row label="Depends on">{task.deps.length ? task.deps.map((d) => all?.[d]?.title ?? d).join(', ') : 'None'}</Row>
          {task.scope.length > 0 && <Row label={task.role === 'researcher' ? 'Queries' : 'Scope'}><span className="mono text-[0.68rem]">{task.scope.join(', ')}</span></Row>}
        </div>
        {task.description && task.description !== task.title && <div><div className="text-[0.72rem] font-medium mb-1">Description</div><p className="text-[0.74rem] text-fg-2 whitespace-pre-wrap break-words selectable max-h-60 overflow-auto">{task.description}</p></div>}
        {task.error && <div className="rounded-lg bg-err-soft text-err text-[0.74rem] p-3 break-words selectable">{task.error}</div>}
        {(stream || task.output) && <div><div className="text-[0.72rem] font-medium mb-1">{task.status === 'running' ? 'Live output' : 'Result'}</div><pre className="mono text-[0.68rem] whitespace-pre-wrap break-words bg-sunken rounded-lg p-3 max-h-80 overflow-auto text-fg-2 selectable">{task.status === 'running' ? stream : task.output}</pre></div>}
        <div><div className="text-[0.72rem] font-medium mb-1">Events</div><div className="h-72 -mx-3"><ActivityFeed events={taskEvents} mode="detailed" /></div></div>
      </div>
    </>
  );
}

export function ModelInspector({ id }: { id: string }) {
  const m = useStore((s) => s.models.find((x) => x.id === id));
  if (!m) return <div className="p-4 text-[0.75rem] text-fg-3">Model not found.</div>;
  const rate = m.calls ? m.successes / m.calls : null;
  return (
    <>
      <Header icon={Globe} title={m.displayName} sub={`${m.providerId} · ${m.modelId}`} badge={<Badge tone={healthTone(m.health)}>{healthLabel(m.health)}</Badge>} />
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        <div className="flex flex-wrap gap-1">{m.capabilities.map((c) => <Badge key={c}>{c.replace('_', ' ')}</Badge>)}</div>
        <div className="divide-y divide-line">
          <Row label="Cost">{m.freeStatus === 'local' ? 'Local · $0.00' : m.freeStatus === 'free' ? 'Free · $0.00' : m.freeStatus === 'free_tier' ? 'Free tier · $0.00' : m.freeStatus}</Row>
          <Row label="Context">{ctxLen(m.contextLength)} tokens</Row>
          {m.paramsB && <Row label="Size">{m.paramsB}B parameters (from id)</Row>}
          <Row label="Latency (EWMA)">{m.latencyMs !== null ? `${(m.latencyMs / 1000).toFixed(2)}s to first token` : 'Not measured'}</Row>
          <Row label="Throughput">{m.tokensPerSec ? `${m.tokensPerSec} tok/s` : 'Not measured'}</Row>
          <Row label="Success rate">{rate !== null ? `${Math.round(rate * 100)}% of ${m.calls} calls` : 'No calls yet'}</Row>
          <Row label="Last success">{timeAgo(m.lastSuccessAt)}</Row>
          <Row label="Last checked">{timeAgo(m.lastCheckedAt)}</Row>
          {m.rateLimitedUntil && m.rateLimitedUntil > Date.now() && <Row label="Rate limited until">{clock(m.rateLimitedUntil)}</Row>}
          {m.notes && <Row label="Notes">{m.notes}</Row>}
        </div>
        {m.lastError && <div><div className="text-[0.72rem] font-medium mb-1">Last error · {timeAgo(m.lastErrorAt)}</div><div className="rounded-lg bg-sunken text-[0.7rem] text-fg-2 p-3 mono break-words selectable">{m.lastError}</div></div>}
      </div>
    </>
  );
}
