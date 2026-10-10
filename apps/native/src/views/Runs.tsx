import { useEffect, useMemo, useState } from 'react';
import { Download, History, Search } from 'lucide-react';
import type { LogLevel, Run, SwarmEvent } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { clock, duration, num, timeAgo } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { ActivityFeed } from '../components/ActivityFeed';
import { GateTable } from '../components/Gates';
import { Badge, Button, Dot, Empty, Segmented, Select, cx } from '../components/ui';

export function Runs() {
  const projects = useStore((s) => s.projects);
  const projectId = useStore((s) => s.projectId);
  const liveRuns = useStore((s) => s.runs);
  const [scope, setScope] = useState<'project' | 'all'>(projectId ? 'project' : 'all');
  const [runs, setRuns] = useState<Run[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  const [agent, setAgent] = useState('all');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const [view, setView] = useState<'dev' | 'user'>('dev');

  useEffect(() => { api.runs.list(scope === 'project' && projectId ? projectId : undefined).then((r) => { setRuns(r); if (!sel && r[0]) setSel(r[0].id); }); }, [scope, projectId]);
  useEffect(() => { if (sel) api.runs.events({ runId: sel, limit: 20000 }).then(setEvents); }, [sel, liveRuns[sel ?? '']?.stats.tasks]);

  const run = runs.find((r) => r.id === sel) ? { ...runs.find((r) => r.id === sel)!, ...(liveRuns[sel!] ?? {}) } as Run : null;
  const filtered = useMemo(() => events.filter((e) => (level === 'all' || e.level === level) && (agent === 'all' || e.agent === agent) && (!dq || `${e.type} ${e.message}`.toLowerCase().includes(dq.toLowerCase()))), [events, level, agent, dq]);
  const agents = [...new Set(events.map((e) => e.agent).filter(Boolean))] as string[];

  const exportLogs = () => {
    const blob = new Blob([JSON.stringify({ run, events: filtered }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `swarm-run-${sel}.json`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="h-full flex min-h-0 p-4 gap-3">
      <aside className="w-[300px] shrink-0 rounded-2xl border border-line bg-panel flex flex-col min-h-0">
        <div className="p-2 border-b border-line"><Segmented size="sm" value={scope} onChange={setScope} label="Scope" options={[{ value: 'project', label: 'This project' }, { value: 'all', label: 'All runs' }]} /></div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {runs.map((r) => {
            const live = liveRuns[r.id] ?? r;
            const p = projects.find((x) => x.id === r.projectId);
            return (
              <button key={r.id} onClick={() => setSel(r.id)} className={cx('w-full text-left px-2.5 py-2 rounded-lg', sel === r.id ? 'bg-hover' : 'hover:bg-hover/60')}>
                <div className="flex items-center gap-1.5"><Dot tone={live.status === 'running' ? 'accent' : live.status === 'completed' ? 'ok' : live.status === 'attention' ? 'warn' : live.status === 'cancelled' ? 'neutral' : 'err'} pulse={live.status === 'running'} /><span className="text-[0.78rem] truncate">{live.brief?.title ?? r.objective}</span></div>
                <div className="pl-3 text-[0.66rem] text-fg-3 truncate">{scope === 'all' && p ? `${p.name} · ` : ''}{timeAgo(r.startedAt)} · {live.endedAt ? duration(live.endedAt - live.startedAt) : 'running'} · {live.stats.tasks} tasks</div>
              </button>
            );
          })}
          {!runs.length && <div className="p-4 text-[0.74rem] text-fg-3">No runs yet.</div>}
        </div>
      </aside>
      {run ? (
        <section className="flex-1 min-w-0 flex gap-3 min-h-0">
          <div className="flex-1 min-w-0 rounded-2xl border border-line bg-panel flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 px-3 h-11 border-b border-line shrink-0">
              <Segmented size="sm" value={view} onChange={setView} label="Log type" options={[{ value: 'dev', label: 'Developer log' }, { value: 'user', label: 'Activity' }]} />
              {view === 'dev' && (
                <>
                  <Select value={level} onChange={(e) => setLevel(e.target.value as never)} aria-label="Level" className="h-7 text-[0.72rem]"><option value="all">All levels</option>{['debug', 'info', 'success', 'warning', 'error'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</Select>
                  <Select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent" className="h-7 text-[0.72rem]"><option value="all">All agents</option>{agents.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
                  <label className="flex items-center gap-1.5 h-7 px-2 rounded-lg bg-sunken border border-line flex-1 max-w-[260px]"><Search size={12} className="text-fg-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter log" className="flex-1 min-w-0 bg-transparent text-[0.74rem]" /></label>
                </>
              )}
              <span className="ml-auto text-[0.68rem] text-fg-3 tabular">{filtered.length} events</span>
              <Button size="sm" variant="ghost" icon={Download} onClick={exportLogs}>Export</Button>
            </div>
            <div className="flex-1 min-h-0">
              {view === 'user' ? <ActivityFeed events={events} mode="simple" /> : <DevLog events={filtered} />}
            </div>
          </div>
          <aside className="w-[300px] shrink-0 rounded-2xl border border-line bg-panel overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-[0.9rem] font-semibold">{run.brief?.title ?? 'Run'}</div>
              <div className="text-[0.72rem] text-fg-2 mt-1 line-clamp-4">{run.objective}</div>
              <div className="mt-2 flex flex-wrap gap-1"><Badge tone={run.status === 'completed' ? 'ok' : run.status === 'running' ? 'accent' : run.status === 'attention' ? 'warn' : run.status === 'cancelled' ? 'neutral' : 'err'}>{run.status}</Badge><Badge>{run.options.autonomy}</Badge>{run.options.webResearch && <Badge>web research</Badge>}</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Tasks', run.stats.tasks], ['Model calls', run.stats.modelCalls], ['Fallbacks', run.stats.fallbacks], ['Files', run.stats.files], ['Commands', run.stats.commands], ['Sources', run.stats.sources]].map(([l, v]) => (
                <div key={l as string} className="rounded-lg border border-line py-2"><div className="text-[0.9rem] font-semibold tabular">{num(v as number)}</div><div className="text-[0.62rem] text-fg-3">{l}</div></div>
              ))}
            </div>
            <div className="text-[0.72rem] text-fg-2 space-y-1">
              <div className="flex justify-between"><span className="text-fg-3">Started</span><span>{new Date(run.startedAt).toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-fg-3">Duration</span><span>{run.endedAt ? duration(run.endedAt - run.startedAt) : 'running'}</span></div>
              <div className="flex justify-between"><span className="text-fg-3">Tokens</span><span className="tabular">{num(run.stats.tokens)}</span></div>
              <div className="flex justify-between"><span className="text-fg-3">Repair cycles</span><span>{run.repairCycles}</span></div>
              <div className="flex justify-between"><span className="text-fg-3">Cost</span><span>$0.00</span></div>
            </div>
            {run.gates.length > 0 && <div><div className="text-[0.72rem] font-medium mb-1">Quality gates</div><GateTable gates={run.gates} /></div>}
            {run.summary && <div><div className="text-[0.72rem] font-medium mb-1">Summary</div><p className="text-[0.74rem] text-fg-2 leading-relaxed selectable">{run.summary}</p></div>}
            <Button variant="secondary" className="w-full" onClick={async () => { await useStore.getState().openProject(run.projectId, 'build'); await useStore.getState().loadRun(run.id); }}>Open in Build</Button>
          </aside>
        </section>
      ) : <div className="flex-1"><Empty icon={History} title="No run selected" body="Run history, quality gates and structured logs for every run are kept here." /></div>}
    </div>
  );
}

function DevLog({ events }: { events: SwarmEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="h-full overflow-y-auto mono text-[0.7rem]">
      {events.slice(-3000).map((e) => (
        <div key={e.id} className="border-b border-line/50">
          <button onClick={() => setOpen(open === e.id ? null : e.id)} className="w-full flex gap-3 px-3 py-1 text-left hover:bg-hover/50">
            <span className="text-fg-3 tabular shrink-0">{clock(e.ts)}</span>
            <span className={cx('w-14 shrink-0 uppercase', e.level === 'error' ? 'text-err' : e.level === 'warning' ? 'text-warn' : e.level === 'success' ? 'text-ok' : e.level === 'debug' ? 'text-fg-3' : 'text-info')}>{e.level}</span>
            <span className="w-40 shrink-0 text-fg-2 truncate">{e.type}</span>
            <span className="w-20 shrink-0 text-fg-3 truncate">{e.agent ?? '—'}</span>
            <span className="text-fg-2 min-w-0 truncate">{e.message}</span>
          </button>
          {open === e.id && <pre className="px-3 pb-2 pl-[4.5rem] text-fg-3 whitespace-pre-wrap break-all selectable">{JSON.stringify({ id: e.id, taskId: e.taskId, runId: e.runId, data: e.data }, null, 2)}</pre>}
        </div>
      ))}
      {!events.length && <div className="p-4 text-fg-3 font-sans">No events match.</div>}
    </div>
  );
}
