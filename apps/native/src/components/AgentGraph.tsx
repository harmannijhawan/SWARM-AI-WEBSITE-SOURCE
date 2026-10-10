import { memo, useMemo, useState } from 'react';
import { Minus, Plus, Maximize, FileText } from 'lucide-react';
import type { AgentRole, AgentState, Run, Task } from '../../shared/types';
import { useStore } from '../lib/store';
import { useElementWidth, useNow } from '../lib/hooks';
import { ROLE_META, agentLabel, agentTone, taskTone } from './status';
import { Dot, cx } from './ui';

const ORDER: AgentRole[] = ['manager', 'planner', 'researcher', 'designer', 'architect', 'coder', 'optimizer', 'tester', 'vision', 'reviewer', 'finalizer'];

interface Node { id: string; col: number; row: number; rows: number }

function layout(nodes: Omit<Node, 'row' | 'rows'>[]): Node[] {
  const byCol = new Map<number, string[]>();
  for (const n of nodes) byCol.set(n.col, [...(byCol.get(n.col) ?? []), n.id]);
  return nodes.map((n) => { const list = byCol.get(n.col)!; return { ...n, row: list.indexOf(n.id), rows: list.length }; });
}

function edgePath(a: { x: number; y: number }, b: { x: number; y: number }, nodeW: number, nodeH: number, back: boolean) {
  if (back) {
    const x1 = a.x + nodeW / 2, y1 = a.y + nodeH, x2 = b.x + nodeW / 2, y2 = b.y + nodeH;
    const dip = Math.max(y1, y2) + 34;
    return `M ${x1} ${y1} C ${x1} ${dip}, ${x2} ${dip}, ${x2} ${y2}`;
  }
  const x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x, y2 = b.y + nodeH / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export const AgentGraph = memo(function AgentGraph({ run, tasks, agents, height }: { run: Run; tasks: Task[]; agents: Partial<Record<AgentRole, AgentState>>; height: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [zoomFactor, setZoom] = useState(1);
  const now = useNow(1000, run.status === 'running');
  const selected = useStore(s => s.activeConversation);
  const messages = useStore(s => s.messages[run.id]);
  const roles = [...new Set([...ORDER.filter(role => agents[role] || tasks.some(t => t.role === role)), ...Object.keys(agents), ...tasks.map(t => t.role)])] as AgentRole[];
  const nodeW = 210, nodeH = 106;
  const rows = Math.max(3, Math.ceil(roles.length / 3));
  const innerW = Math.max(720, Math.min(880, width));
  const innerH = rows * 184 + 12;
  const fitZoom = Math.min(1.15, width / innerW, height / innerH);
  const baseZoom = Math.max(.8, fitZoom);
  const zoom = baseZoom * zoomFactor;
  const pos = new Map<string, { x: number; y: number }>();
  const managerY = 24 + (innerH - 184 - 48) / Math.max(1, rows - 1);
  pos.set('manager', { x: (innerW - nodeW) / 2, y: managerY });
  const others = roles.filter(r => r !== 'manager');
  // A center coordinator with specialist columns; expand vertically as the workforce grows.
  const slots: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const y = 24 + row * (innerH - 184 - 48) / Math.max(1, rows - 1);
    for (const col of [0, 2, 1]) {
      if (col === 1 && Math.abs(y - managerY) < nodeH + 20) continue;
      slots.push({ x: 24 + col * (innerW - nodeW - 48) / 2, y });
    }
  }
  const preferred: Partial<Record<AgentRole, number>> = { researcher: 0, architect: 1, planner: 2, designer: 3, coder: 4, tester: 7, reviewer: 6 };
  const used = new Set<number>();
  for (const role of others) { const slot = preferred[role]; if (slot !== undefined && slots[slot]) { pos.set(role, slots[slot]); used.add(slot); } }
  for (const role of others) if (!pos.has(role)) { const slot = slots.findIndex((_, i) => !used.has(i)); pos.set(role, slots[slot]); used.add(slot); }
  const byId = new Map(tasks.map(t => [t.id, t]));
  const edges = new Map<string, { from: AgentRole; to: AgentRole; live: boolean; signal?: string }>();
  for (const t of tasks) for (const depId of t.deps) {
    const dep = byId.get(depId); if (!dep || dep.role === t.role) continue;
    const key = dep.role + ':' + t.role;
    edges.set(key, { from: dep.role, to: t.role, live: run.status === 'running' && (t.status === 'running' || !!edges.get(key)?.live) });
  }
  for (const m of messages ?? []) if (m.to !== 'all' && m.to !== m.from) {
    const key = m.from + ':' + m.to;
    const recent = Date.now() - m.ts < 1800 && Date.now() >= m.ts;
    const previous = edges.get(key);
    edges.set(key, { from: m.from, to: m.to, live: previous?.live || (recent && run.status === 'running'), signal: recent ? m.id : previous?.signal });
  }
  const path = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ax = a.x + nodeW / 2, ay = a.y + nodeH / 2, bx = b.x + nodeW / 2, by = b.y + nodeH / 2;
    if (Math.abs(ax - bx) < nodeW) { const y1 = ay + (by > ay ? nodeH / 2 : -nodeH / 2), y2 = by + (by > ay ? -nodeH / 2 : nodeH / 2); return 'M ' + ax + ' ' + y1 + ' C ' + ax + ' ' + (y1+y2)/2 + ', ' + bx + ' ' + (y1+y2)/2 + ', ' + bx + ' ' + y2; }
    const x1 = ax + (bx > ax ? nodeW / 2 : -nodeW / 2), x2 = bx + (bx > ax ? -nodeW / 2 : nodeW / 2);
    return 'M ' + x1 + ' ' + ay + ' C ' + (x1+x2)/2 + ' ' + ay + ', ' + (x1+x2)/2 + ' ' + by + ', ' + x2 + ' ' + by;
  };
  return <div className="agent-graph-shell" ref={ref} style={{ height }}>
    {roles.length <= 2 && run.status === 'running' && <div className="graph-preparing"><span>Live planning</span><h2>Shaping the work ahead</h2><p>{tasks.find(t => t.status === 'running')?.title ?? 'Preparing the next task'}. Specialists will appear here as the execution plan is created.</p></div>}
    <div className="agent-graph-scroll"><div style={{ width: innerW * zoom, height: innerH * zoom, margin: 'auto', position: 'relative', top: Math.max(0, (height - innerH * zoom) / 2) }}><div className="agent-graph-canvas" style={{ width: innerW, height: innerH, transform: 'scale(' + zoom + ')', transformOrigin: 'top left' }}>
      <svg className="absolute inset-0 pointer-events-none" width={innerW} height={innerH} aria-hidden><defs><marker id="agent-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>{[...edges.entries()].map(([key, edge]) => { const a = pos.get(edge.from), b = pos.get(edge.to); return a && b ? <g key={key}><path d={path(a,b)} fill="none" stroke={edge.live ? 'var(--accent)' : 'var(--line-strong)'} strokeWidth={edge.live ? 1.6 : 1.3} markerEnd="url(#agent-arrow)" className={edge.live ? 'edge-live' : ''} />{edge.signal && <circle key={edge.signal} r={3} className="graph-signal" style={{ offsetPath: `path('${path(a,b)}')` }} />}</g> : null; })}</svg>
      {roles.map(role => { const p = pos.get(role)!; const savedAgent = agents[role]; const agent = role === 'manager' ? { ...savedAgent, status: run.status === 'running' ? 'working' as const : run.status === 'completed' ? 'completed' as const : run.status === 'failed' ? 'failed' as const : run.status === 'attention' ? 'blocked' as const : 'waiting' as const } : savedAgent; const meta = ROLE_META[role] ?? ROLE_META.coder; const mine = tasks.filter(t => t.role === role && !['skipped','cancelled'].includes(t.status)); const done = mine.filter(t => t.status === 'completed').length; const active = mine.find(t => t.status === 'running'); const live = run.status === 'running' && (agent?.status === 'working' || agent?.status === 'planning'); const name = ROLE_META[role]?.name ?? role;
        return <div key={role} className="workforce-position" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}><button data-motion-state={agent?.status} className={cx('workforce-node', selected === role && 'workforce-node-selected', role === 'manager' && 'workforce-manager')} style={{ left: 0, top: 0, width: nodeW, height: nodeH }} aria-label={name + ': ' + (role === 'manager' && run.status === 'running' ? 'Running' : agentLabel(agent?.status)) + ' — click to chat'} onClick={() => { useStore.getState().setActiveConversation(role); useStore.setState({ inspector: null }); window.dispatchEvent(new Event('swarm:agent-selected')); }}>
          <span className={cx('workforce-icon', live && 'workforce-icon-live', agent?.status === 'completed' && 'workforce-icon-complete')}><meta.icon size={23} strokeWidth={1.7} /></span>
          <span className="workforce-node-content"><strong>{name}</strong><span className="workforce-node-status"><Dot tone={agentTone(agent?.status)} pulse={live} />{role === 'manager' ? (run.status === 'running' ? 'Running' : run.status === 'paused' ? 'Paused' : run.status === 'cancelled' ? 'Stopped' : agentLabel(agent?.status)) : agentLabel(agent?.status)}</span><span className="workforce-node-description" title={active?.title ?? agent?.taskTitle ?? ''}>{role === 'manager' ? 'Coordinating the project' : meta.title}</span><span className="workforce-progress"><i style={{ width: '100%', transform: `scaleX(${mine.length ? done / mine.length : 0})`, background: agent?.status === 'completed' ? 'var(--ok)' : 'var(--accent)' }} /><small>{mine.length ? done + '/' + mine.length : '—'}</small></span></span>
        </button>{mine.length > 0 && role !== 'manager' && <div className="workforce-task-summary" style={{ left: 12, top: nodeH, width: nodeW - 24 }}>{[...mine].sort((a,b) => Number(b.status === 'running') - Number(a.status === 'running')).slice(0, 2).map(t => <span key={t.id} title={t.title + ' · ' + t.status}><FileText size={11} /><span>{t.title}</span></span>)}{mine.length > 2 && <small>+{mine.length - 2} more tasks</small>}</div>}</div>;
      })}
    </div></div></div>
    <div className="graph-zoom"><button aria-label="Zoom in" onClick={() => setZoom(z => Math.min(2,z+.15))}><Plus size={16} /></button><button aria-label="Zoom out" onClick={() => setZoom(z => Math.max(.5,z-.15))}><Minus size={16} /></button><button aria-label="Fit graph" onClick={() => setZoom(fitZoom / baseZoom)}><Maximize size={15} /></button></div>
  </div>;
});

/** Task-level DAG: columns by dependency depth. */
export const TaskGraph = memo(function TaskGraph({ tasks, height }: { tasks: Task[]; height: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const { nodes, depthCount } = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const depth = new Map<string, number>();
    const d = (t: Task, seen = new Set<string>()): number => {
      if (depth.has(t.id)) return depth.get(t.id)!;
      if (seen.has(t.id)) return 0;
      seen.add(t.id);
      const v = t.deps.length ? Math.max(...t.deps.map((x) => (byId.get(x) ? d(byId.get(x)!, seen) + 1 : 0))) : 0;
      depth.set(t.id, v); return v;
    };
    tasks.forEach((t) => d(t));
    return { nodes: layout(tasks.map((t) => ({ id: t.id, col: depth.get(t.id)! }))), depthCount: Math.max(0, ...depth.values()) + 1 };
  }, [tasks]);
  const nodeW = 150, nodeH = 34;
  const colW = nodeW + 44;
  const innerW = Math.max(width, depthCount * colW + 16);
  const maxRows = Math.max(1, ...nodes.map((n) => n.rows));
  const innerH = Math.max(height, maxRows * (nodeH + 12) + 24);
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of nodes) {
      const gapY = nodeH + 12;
      const total = gapY * (n.rows - 1);
      m.set(n.id, { x: 12 + n.col * colW, y: innerH / 2 - total / 2 + n.row * gapY - nodeH / 2 });
    }
    return m;
  }, [nodes, innerH, colW]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return (
    <div ref={ref} className="w-full overflow-auto" style={{ height }}>
      <div className="relative" style={{ width: innerW, height: innerH }}>
        <svg className="absolute inset-0 pointer-events-none" width={innerW} height={innerH} aria-hidden>
          {tasks.flatMap((t) => t.deps.map((d) => {
            const a = pos.get(d), b = pos.get(t.id); if (!a || !b) return null;
            const live = t.status === 'running';
            return <path key={`${d}-${t.id}`} d={edgePath(a, b, nodeW, nodeH, false)} fill="none"
              stroke={live ? 'var(--accent)' : 'var(--line-strong)'} strokeWidth={live ? 1.5 : 1}
              className={cx(live && 'edge-live')} />;
          }))}
        </svg>
        {nodes.map((n) => {
          const t = byId.get(n.id)!;
          const p = pos.get(n.id)!;
          const M = ROLE_META[t.role];
          return (
            <button data-motion-state={t.status} key={n.id} title={`${M.name}: ${t.title} (${t.status})`}
              onClick={() => { useStore.getState().setActiveConversation(t.role); useStore.setState({ inspector: { type: 'task', id: t.id } }); window.dispatchEvent(new Event('swarm:agent-selected')); }}
              className={cx(
                'motion-task absolute flex items-center gap-1.5 px-2 rounded-lg border bg-raised text-[0.7rem] text-left shadow-soft transition-colors',
                t.status === 'running' ? 'border-accent/60' :
                t.status === 'failed' ? 'border-err/50' :
                'border-line hover:border-line-strong',
                (t.status === 'skipped' || t.status === 'cancelled') && 'opacity-50',
              )}
              style={{ left: p.x, top: p.y, width: nodeW, height: nodeH }}>
              <Dot tone={taskTone(t.status)} pulse={t.status === 'running'} />
              <M.icon size={12} className="text-fg-3 shrink-0" />
              <span className="truncate">{t.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
