import { memo, useState } from 'react';
import { Activity, Check, ChevronDown, FileCode2, Globe, Loader2, MessageSquare, Monitor, ShieldAlert, Terminal, X } from 'lucide-react';
import type { FileChange } from '../../shared/types';
import { useWork, workApi, openAgentChat, workActivity, type WorkEvent } from '../lib/workspace';
import { useStore } from '../lib/store';
import { api } from '../lib/api';
import { ROLE_META, agentLabel } from './status';
import { DiffView } from './DiffView';

function WorkIcon({ type }: { type: string }) {
  const Icon = type.startsWith('computer') ? Monitor : type.startsWith('file') ? FileCode2 : type.startsWith('command') ? Terminal : type.startsWith('search') ? Globe : type.startsWith('approval') ? ShieldAlert : Activity;
  return <Icon size={15} />;
}
const EventCard = memo(function EventCard({ event }: { event: WorkEvent }) {
  const [open, setOpen] = useState(false);
  const commandId = typeof event.data?.commandId === 'string' ? event.data.commandId : '';
  const output = useStore(state => state.commands[commandId]?.output);
  const who = event.agent ? ROLE_META[event.agent]?.name ?? event.agent : 'SWARM';
  const running = event.status === 'running';
  const summary = typeof event.data?.detail === 'string' ? event.data.detail : typeof event.data?.command === 'string' ? event.data.command : undefined;
  const details = output ?? (typeof event.data?.output === 'string' ? event.data.output : undefined);
  return <article className="work-event" data-status={event.status}>
    <button className="work-event-main" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span className="work-event-icon"><WorkIcon type={event.type} /></span>
      <span><strong>{who}<small>{event.type.split('_')[0]}</small></strong><span className="work-event-message">{event.message}</span></span>
      {running ? <Loader2 size={12} className="animate-spin" /> : event.status === 'error' ? <X size={12} /> : <ChevronDown size={12} />}
    </button>
    {open && <div className="work-event-detail"><time>{new Date(event.ts).toLocaleTimeString()}</time>{summary && <pre>{summary}</pre>}{details && <pre>{details.slice(-12000)}</pre>}{typeof event.data?.exitCode === 'number' && <p>Exit code: {event.data.exitCode}</p>}{!summary && !details && <p>{event.message}</p>}</div>}
    {event.type.startsWith('computer') && <button className="work-link" onClick={() => useStore.getState().setView('phone')}><Monitor size={12} /> View PC connection</button>}
  </article>;
});

export const WorkPanel = memo(function WorkPanel({ drawer = false, onClose }: { drawer?: boolean; onClose?: () => void }) {
  const events = useWork(state => state.events);
  const agents = useWork(state => state.agents);
  const files = useWork(state => state.files);
  const approvals = useWork(state => state.approvals);
  const scope = useWork(state => state.scope);
  const run = useWork(state => state.run);
  const error = useWork(state => state.error);
  const loading = useWork(state => state.loading);
  const [preview, setPreview] = useState<FileChange | null>(null);
  const [fileError, setFileError] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const latestFiles = [...new Map([...files].sort((a, b) => a.ts - b.ts).map(file => [file.path, file])).values()].sort((a, b) => b.ts - a.ts);
  const activity = workActivity(events);
  const resolve = async (id: string, approved: boolean) => {
    setResolving(id);
    try { await api.approvals.resolve(id, approved); await useWork.getState().refresh(); }
    catch (error) { setFileError(String(error)); } finally { setResolving(null); }
  };
  return <aside className={`work-panel ${drawer ? 'work-drawer-panel' : ''}`} aria-label="Live work">
    <header><div><span className="work-eyebrow">YOUR AI TEAM</span><h2>Live work <span className="work-live-dot" /></h2></div>{onClose && <button aria-label="Close live work" onClick={onClose}><X size={18} /></button>}</header>
    <div className="work-panel-scroll">
      {run && <div className="work-run"><strong>{run.brief?.title ?? run.objective}</strong><span>{run.status}</span></div>}
      {loading && <p className="work-muted">Loading activity…</p>}
      {error && <p role="alert" className="work-error">{error}<button onClick={() => void useWork.getState().refresh()}>Retry</button></p>}
      {approvals.length > 0 && <section className="work-approvals"><h3><ShieldAlert size={14} /> Needs your approval</h3>{approvals.map(approval => <article key={approval.id}><strong>{approval.title}</strong><pre>{approval.detail}</pre><div><button disabled={resolving === approval.id} onClick={() => void resolve(approval.id, false)}>Deny</button><button disabled={resolving === approval.id} onClick={() => void resolve(approval.id, true)}>Allow once</button></div></article>)}</section>}
      <section><h3>Agents <span>{agents.length}</span></h3>{agents.length ? agents.map(agent => {
        const meta = ROLE_META[agent.role];
        const task = events.findLast(event => event.agent === agent.role && ['task_started', 'task_progress'].includes(event.type));
        return <button key={agent.role} className="work-agent" onClick={() => void openAgentChat(agent.role, scope).catch(error => setFileError(String(error)))}>
          <span className="work-avatar"><meta.icon size={17} /></span><span><strong>{agent.role === 'manager' ? 'SWARM' : meta.name}</strong><small>{task?.message ?? meta.title}</small></span><span className="work-agent-status" data-live={['working', 'planning'].includes(agent.status)}>{agentLabel(agent.status)}<MessageSquare size={12} /></span>
        </button>;
      }) : <p className="work-muted">Agents appear here when SWARM assigns work.</p>}</section>
      <section><h3><FileCode2 size={14} /> Files changed <span>{latestFiles.length}</span></h3>{latestFiles.length ? latestFiles.map(file => <button className="work-file" key={file.id} onClick={() => { setFileError(''); void workApi.file(file.id).then(setPreview).catch(error => setFileError(String(error))); }}><span data-kind={file.kind}>{file.kind === 'deleted' ? '−' : file.kind === 'created' ? '+' : '↻'}</span><span><strong>{file.path}</strong><small>{file.kind}</small></span><small className="work-counts"><b>+{file.additions}</b> −{file.deletions}</small></button>) : <p className="work-muted">Actual edits will appear with their diffs.</p>}</section>
      <section><h3><Activity size={14} /> Activity</h3>{activity.length ? activity.map(event => <EventCard key={event.id} event={event} />) : <p className="work-muted">Tools, commands, research, and PC actions appear as they happen.</p>}</section>
      {fileError && <p className="work-error" role="alert">{fileError}</p>}
    </div>
    {preview && <div className="work-diff-overlay"><div className="work-diff-dialog" role="dialog" aria-modal="true" aria-label={`Changes to ${preview.path}`}><button className="work-diff-close" onClick={() => setPreview(null)} aria-label="Close diff"><X size={18} /></button><DiffView change={preview} /></div></div>}
  </aside>;
});

export const WorkSummary = memo(function WorkSummary({ onOpen }: { onOpen: () => void }) {
  const count = useWork(state => state.agents.filter(agent => ['working', 'planning'].includes(agent.status)).length);
  const files = useWork(state => state.files);
  const approvals = useWork(state => state.approvals.length);
  const fileCount = new Set(files.map(file => file.path)).size;
  return <button className="work-summary" onClick={onOpen}><Activity size={15} /><span>{approvals ? `${approvals} approval${approvals === 1 ? '' : 's'} waiting` : count ? `${count} agent${count === 1 ? '' : 's'} working` : 'Live work'}{fileCount > 0 && ` · ${fileCount} file${fileCount === 1 ? '' : 's'} changed`}</span><ChevronDown size={14} /></button>;
});
