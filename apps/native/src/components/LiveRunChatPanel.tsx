// LiveRunChatPanel — right-side control plane for active builds.
// Provides: agent selector, streaming chat, run status, graph update events.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp, Brain, Check, CheckCircle2, ChevronDown, Circle, Code2, Compass,
  Eye, FlaskConical, Gauge, GitBranch, Globe, LayoutTemplate, Loader2,
  MessageSquare, Network, PackageCheck, ShieldCheck, Square, X,
} from 'lucide-react';
import type { AgentRole, AgentState, GraphVersion, LiveRunSnapshot, Run, RunChatEvent, RunChatTurn, Task } from '../../shared/types';
import { useMotionChange, scrollBehavior } from '../lib/motion';
import { api } from '../lib/api';
import { currentRunChats, useStore, type ActiveConversation } from '../lib/store';
import { ROLE_META, agentTone } from './status';
import { Dot, Spinner, Working, cx } from './ui';

// ─── agent role ordering ──────────────────────────────────────────────────────
const AGENT_ORDER: AgentRole[] = [
  'manager', 'planner', 'researcher', 'designer', 'architect',
  'coder', 'optimizer', 'tester', 'vision', 'reviewer', 'finalizer',
];

// ─── agent status label ───────────────────────────────────────────────────────
function agentStatusLabel(s: AgentState['status'] | undefined): string {
  if (!s) return 'Not started';
  return ({ idle: 'Idle', available: 'Ready', waiting: 'Waiting', planning: 'Planning', working: 'Working', blocked: 'Blocked', failed: 'Failed', completed: 'Done' } as const)[s] ?? s;
}

function agentStatusIcon(s: AgentState['status'] | undefined) {
  if (s === 'working' || s === 'planning') return <Loader2 size={11} className="animate-spin text-accent" />;
  if (s === 'completed') return <Check size={11} className="text-ok" />;
  if (s === 'failed') return <X size={11} className="text-err" />;
  if (s === 'blocked') return <Circle size={11} className="text-warn" />;
  return <Circle size={11} className="text-fg-3" />;
}

// ─── agent selector dropdown ──────────────────────────────────────────────────
interface AgentSelectorProps {
  activeConversation: ActiveConversation;
  agents: Partial<Record<AgentRole, AgentState>>;
  presentRoles: AgentRole[];
  run: Run | null;
  onChange: (conv: ActiveConversation) => void;
}

function AgentSelector({ activeConversation, agents, presentRoles, run, onChange }: AgentSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOut = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onOut);
    return () => document.removeEventListener('mousedown', onOut);
  }, [open]);

  const currentRole: AgentRole = activeConversation === 'manager' ? 'manager' : activeConversation;
  const currentAgent = agents[currentRole];
  const Meta = ROLE_META[currentRole];
  const Icon = Meta?.icon ?? Brain;
  const tone = currentRole === 'manager' ? (run?.status === 'running' ? 'ok' : run?.status === 'completed' ? 'ok' : run?.status === 'failed' ? 'err' : 'neutral') : agentTone(currentAgent?.status);
  const isLive = currentAgent?.status === 'working' || currentAgent?.status === 'planning';

  // All roles that appear in this run, always include manager
  const visibleRoles = ['manager', ...AGENT_ORDER.filter(r => r !== 'manager' && presentRoles.includes(r))] as AgentRole[];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-3 py-2 w-full hover:bg-hover transition-colors text-left"
        aria-label="Select agent conversation"
      >
        <span className={cx('h-7 w-7 rounded-lg border flex items-center justify-center shrink-0',
          isLive ? 'border-accent/50 text-accent bg-accent-soft' : 'border-line text-fg-2')}>
          <Icon size={14} strokeWidth={1.8} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[0.78rem] font-semibold truncate">{Meta?.name ?? currentRole}</span>
          <span className="flex items-center gap-1 text-[0.66rem] text-fg-3">
            <Dot tone={tone} pulse={isLive} />
            {currentRole === 'manager' ? ({ running: 'Running', paused: 'Paused', cancelled: 'Stopped', completed: 'Completed', attention: 'Needs attention', failed: 'Failed' }[run?.status ?? 'running']) : agentStatusLabel(currentAgent?.status)}
          </span>
          <span className="block text-[11px] text-fg-3 mt-1">{currentRole === 'manager' ? 'Coordinating the project' : Meta?.title}</span>
        </span>
        <ChevronDown size={13} className={cx('text-fg-3 transition-transform duration-[var(--motion-fast)]', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-0.5 mx-1 rounded-xl border border-line bg-raised shadow-float overflow-hidden">
          {visibleRoles.map(role => {
            const a = agents[role];
            const M = ROLE_META[role];
            const RIcon = M?.icon ?? Brain;
            const isActive = (activeConversation === 'manager' ? 'manager' : activeConversation) === role;
            const live = a?.status === 'working' || a?.status === 'planning';
            return (
              <button
                key={role}
                onClick={() => { onChange(role === 'manager' ? 'manager' : role); setOpen(false); }}
                className={cx('flex items-center gap-2.5 px-3 py-2 w-full text-left transition-colors',
                  isActive ? 'bg-hover' : 'hover:bg-hover/60')}
              >
                <span className={cx('h-6 w-6 rounded-md border flex items-center justify-center shrink-0 text-[11px]',
                  live ? 'border-accent/40 text-accent bg-accent-soft' :
                  a?.status === 'completed' ? 'border-ok/40 text-ok' :
                  a?.status === 'failed' ? 'border-err/40 text-err' : 'border-line text-fg-3')}>
                  <RIcon size={11} strokeWidth={1.8} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[0.74rem] font-medium truncate">
                    {M?.name ?? role}
                  </span>
                </span>
                <span className="shrink-0">{agentStatusIcon(a?.status)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── inline chat event chip ───────────────────────────────────────────────────
function ChatEventChip({ event }: { event: RunChatEvent }) {
  const icons = {
    graph_updated: <GitBranch size={10} />,
    task_invalidated: <Circle size={10} className="text-warn" />,
    task_added: <CheckCircle2 size={10} className="text-ok" />,
    file_changed: <Code2 size={10} />,
    agent_notified: <MessageSquare size={10} />,
    priority_changed: <Globe size={10} />,
    decision: <Brain size={10} />,
  };
  return (
    <span className="run-chat-event" data-kind={event.kind}>
      {icons[event.kind] ?? null}
      {event.label}
    </span>
  );
}

// ─── single message bubble ─────────────────────────────────────────────────────
function ChatBubble({ turn, run }: { turn: RunChatTurn; run: Run | null }) {
  const isUser = turn.senderType === 'user';
  const isSystem = turn.senderType === 'system';
  const isStreaming = turn.status === 'streaming';

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[0.66rem] text-fg-3 bg-sunken border border-line px-2 py-0.5 rounded-full">{turn.text}</span>
      </div>
    );
  }

  return (
    <div className={cx(Date.now() - turn.ts < 1200 && 'motion-arrive', 'flex gap-2 px-3 py-1.5', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <span className="h-6 w-6 rounded-lg border border-line bg-raised flex items-center justify-center shrink-0 mt-0.5 text-fg-3">
          {turn.senderId === 'manager'
            ? <Brain size={12} strokeWidth={1.8} />
            : (() => { const M = ROLE_META[turn.senderId as AgentRole]; return M ? <M.icon size={12} strokeWidth={1.8} /> : <Brain size={12} />; })()
          }
        </span>
      )}
      <div className={cx('max-w-[88%] flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
        {!isUser && (
          <span className="text-[0.65rem] text-fg-3 px-0.5">
            {turn.senderId === 'manager' ? 'Manager' : ROLE_META[turn.senderId as AgentRole]?.name ?? turn.senderId}
            <span className="ml-2" title={turn.model}>{new Date(turn.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </span>
        )}
        <div className={cx(
          'run-chat-bubble px-3 py-2 rounded-xl text-[0.88rem] leading-relaxed',
          isUser
            ? 'bg-accent-soft text-fg rounded-br-sm'
            : 'bg-raised border border-line text-fg rounded-bl-sm',
          turn.status === 'error' && 'border-err/50 text-err',
        )}>
          {turn.text.replace(/```(?:decision|escalate)[\s\S]*?(?:```|$)/g, '').trim() || (isStreaming ? <span className="inline-flex gap-0.5 items-center"><span className="w-1 h-1 rounded-full bg-current anim-pulse" /><span className="w-1 h-1 rounded-full bg-current anim-pulse" style={{ animationDelay: 'var(--motion-fast)' }} /><span className="w-1 h-1 rounded-full bg-current anim-pulse" style={{ animationDelay: 'calc(var(--motion-fast) * 2)' }} /></span> : '')}
          {isStreaming && turn.text && <span className="inline-block w-0.5 h-3.5 bg-current opacity-60 anim-pulse ml-0.5 translate-y-0.5" />}
        </div>
        {turn.events && turn.events.length > 0 && (
          <div className="flex flex-col gap-1 w-full px-0.5">
            {turn.events.map((ev, i) => <ChatEventChip key={i} event={ev} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── chat input ───────────────────────────────────────────────────────────────
interface ChatInputProps {
  runId: string;
  activeConversation: ActiveConversation;
  disabled?: boolean;
  onSent: () => void;
}

function ChatInput({ runId, activeConversation, disabled, onSent }: ChatInputProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const toast = useStore(s => s.toast);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [text]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true);
    setText('');
    try {
      if (activeConversation === 'manager') {
        await api.runChat.send(runId, t);
      } else {
        await api.runChat.sendToAgent(runId, activeConversation, t);
      }
      onSent();
    } catch (e) {
      toast({ level: 'error', title: 'Could not send message', body: String(e) });
      setText(t); // restore on error
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
    if (e.key === 'Escape') ref.current?.blur();
  };

  const isManager = activeConversation === 'manager';
  const placeholder = isManager
    ? 'Message Manager… (e.g. "add feature", "change design")'
    : `Message ${ROLE_META[activeConversation as AgentRole]?.name ?? activeConversation}…`;

  return (
    <div className={`run-chat-composer shrink-0 ${busy ? "motion-sent" : ""}`} aria-busy={busy}>
      <div className="flex items-end gap-1.5 rounded-xl border border-line-strong bg-raised px-2 py-1.5 focus-within:border-fg-3 transition-colors">
        <textarea
          ref={ref}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={placeholder}
          disabled={disabled || busy}
          className="flex-1 resize-none bg-transparent text-[0.82rem] text-fg placeholder:text-fg-3 leading-relaxed disabled:opacity-50 max-h-[120px] py-0.5"
        />
        <button
          onClick={() => void send()}
          disabled={disabled || !text.trim() || busy}
          aria-label="Send"
          className="h-7 w-7 rounded-lg bg-fg text-bg flex items-center justify-center shrink-0 transition-opacity disabled:opacity-30 hover:opacity-80"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={13} />}
        </button>
      </div>
    </div>
  );
}

// ─── current task strip for agent panel ──────────────────────────────────────
function AgentTaskStrip({ role, tasks }: { role: AgentRole; tasks: Task[] }) {
  const mine = tasks.filter(t => t.role === role);
  const current = mine.find(t => t.status === 'running');
  const done = mine.filter(t => t.status === 'completed').length;
  if (mine.length === 0) return null;
  return (
    <div className="px-3 py-2 border-b border-line bg-sunken/30 shrink-0">
      <div className="text-[0.68rem] text-fg-3 mb-0.5 font-medium uppercase tracking-wide">Current task</div>
      <div className="text-[0.76rem] text-fg font-medium truncate">{current?.title ?? (done === mine.length ? 'All tasks complete' : 'Waiting…')}</div>
      {mine.length > 1 && (
        <div className="text-[0.66rem] text-fg-3 mt-0.5">{done} / {mine.length} tasks</div>
      )}
    </div>
  );
}

// ─── main panel ───────────────────────────────────────────────────────────────
interface LiveRunChatPanelProps {
  runId: string;
  run: Run | null;
  tasks: Task[];
  agents: Partial<Record<AgentRole, AgentState>>;
}

export const LiveRunChatPanel = memo(function LiveRunChatPanel({ runId, run, tasks, agents }: LiveRunChatPanelProps) {
  const activeConversation = useStore(s => s.activeConversation);
  const conversationMotion = useMotionChange<HTMLDivElement>(activeConversation);
  const setActiveConversation = useStore(s => s.setActiveConversation);
  const turns = useStore(useMemo(() => currentRunChats(runId, activeConversation), [runId, activeConversation]));
  const agentMessages = useStore(s => s.messages[runId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [tab, setTab] = useState('Chat');
  const [snapshot, setSnapshot] = useState<LiveRunSnapshot | null>(null);
  const [versions, setVersions] = useState<GraphVersion[]>([]);
  const events = useStore(s => s.events[runId]);
  const inspector = useStore(s => s.inspector);
  const graphVersions = useStore(s => s.graphVersions[runId]);
  useEffect(() => { if (inspector?.type === 'task') setTab('Tasks'); }, [inspector]);
  useEffect(() => { setTab('Chat'); }, [activeConversation, runId]);
  useEffect(() => {
    let current = true;
    if (tab === 'Architecture' || tab === 'Overview') api.runChat.snapshot(runId).then(s => { if (current) setSnapshot(s); }).catch(() => undefined);
    if (tab === 'Decisions') api.runChat.graphVersions(runId).then(v => { if (current) setVersions(v); }).catch(() => undefined);
    return () => { current = false; };
  }, [runId, tab, run?.stats.tasks, run?.stats.completed, graphVersions]);

  // Which roles actually appear in this run
  const presentRoles = useMemo(() => {
    const fromTasks = [...new Set(tasks.map(t => t.role))] as AgentRole[];
    const fromAgents = Object.keys(agents) as AgentRole[];
    return [...new Set([...fromTasks, ...fromAgents])];
  }, [tasks, agents]);

  // Auto-scroll to bottom when new turns arrive
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) { el.scrollTo({ top: el.scrollHeight, behavior: scrollBehavior() }); setAutoScroll(true); }
  };

  const currentRole = activeConversation === 'manager' ? 'manager' : activeConversation as AgentRole;
  const isStreaming = turns.some(t => t.status === 'streaming');
  const currentTask = tasks.find(t => t.status === 'running' && (currentRole === 'manager' || t.role === currentRole));
  const coordination = (agentMessages ?? []).filter(m => m.from === 'manager' && m.to === 'all' && m.content.startsWith('Plan:'));

  return (
    <div className="flex flex-col h-full min-h-0 bg-panel">
      {/* Agent selector */}
      <div className="shrink-0 border-b border-line">
        <AgentSelector
          activeConversation={activeConversation}
          agents={agents}
          presentRoles={presentRoles}
          run={run}
          onChange={setActiveConversation}
        />
      </div>

      <div className="agent-panel-tabs" role="tablist" aria-label="Agent details">
        {(activeConversation === 'manager' ? ['Chat', 'Overview', 'Tasks', 'Architecture', 'Decisions'] : ['Chat', 'Overview', 'Tasks', 'Output', 'Files', 'Logs']).map(name => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
      </div>
      {tab !== 'Chat' && <div className="agent-panel-detail" role="tabpanel">
        {tab === 'Overview' && <><h3>{ROLE_META[currentRole]?.title}</h3><p>{run?.objective}</p><p>{(currentRole === 'manager' ? snapshot?.currentTaskTitle : agents[currentRole]?.taskTitle) ?? 'No active task.'}</p><p>{agents[currentRole]?.modelId ? `Model: ${agents[currentRole]?.modelId}` : ''}</p><h3>Verification</h3>{run?.gates.map(g => <article key={g.id}><strong>{g.label} · {g.status}</strong><p>{g.detail}</p></article>)}</>}
        {tab === 'Tasks' && tasks.filter(t => currentRole === 'manager' || t.role === currentRole).map(t => <article className="motion-task" data-motion-state={t.status} key={t.id}><strong>{t.title}</strong><small> · {t.status}</small><p>{t.description}</p>{t.error && <p>{t.error}</p>}</article>)}
        {tab === 'Architecture' && <><h3>Architecture · {run?.target ?? 'Unspecified target'}</h3><p>{snapshot?.architectureSummary || 'The architecture has not been recorded yet.'}</p><h3>Design</h3><p>{snapshot?.designSummary || 'No design recorded yet.'}</p></>}
        {tab === 'Decisions' && (versions.length ? versions.map(v => <article key={v.version}><strong>v{v.version} · {v.reason}</strong><p>{v.userInstruction}</p><small>{v.tasksAdded.length} added · {v.tasksInvalidated.length} affected · {v.agentsNotified.join(', ')}</small></article>) : <p>No requirement changes recorded.</p>)}
        {tab === 'Output' && tasks.filter(t => t.role === currentRole && t.output).map(t => <article key={t.id}><strong>{t.title}</strong><p>{t.output}</p></article>)}
        {tab === 'Files' && [...new Set(tasks.filter(t => t.role === currentRole).flatMap(t => t.filesTouched))].map(file => <article key={file}><button onClick={() => run && api.projects.reveal(run.projectId, file)}>{file}</button></article>)}
        {tab === 'Logs' && (events ?? []).filter(e => e.agent === currentRole && e.type !== 'AGENT_STREAM').map(e => <article key={e.id}><small>{new Date(e.ts).toLocaleTimeString()}</small><p>{e.message}</p></article>)}
      </div>}

      {/* Run status bar */}


      {/* Agent task strip (non-manager) */}
      {tab === 'Chat' && activeConversation !== 'manager' && (
        <AgentTaskStrip role={currentRole} tasks={tasks} />
      )}

      {/* Messages */}
      <div
        ref={el => { scrollRef.current = el; conversationMotion.current = el; }}
        onScroll={handleScroll}
        className={cx('flex-1 min-h-0 overflow-y-auto py-2', tab !== 'Chat' && 'hidden')}
      >
        {activeConversation === 'manager' && coordination.map(m => <div className="agent-run-context" key={m.id}><strong><Brain size={16} />Manager <small className="text-fg-3 font-normal">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></strong><p className="selectable">{m.content.replace(/^Plan:\s*/, '')}</p></div>)}
        {activeConversation === 'manager' && turns.length === 0 && <div className="agent-run-context"><strong><Dot tone={run?.status === 'running' ? 'accent' : 'neutral'} />{currentTask?.title ?? 'Ready for your direction'}</strong><p>{run?.status === 'running' ? 'The current task is executing. You can change requirements here while the build continues.' : 'Ask about this run, inspect its work, or resume execution using the controls above.'}</p></div>}
        {activeConversation !== 'manager' && (agentMessages ?? []).filter(m => m.to === currentRole || m.from === currentRole || m.to === 'all').map(m => <div className="mx-3 mb-3 p-3 rounded-lg border border-line bg-sunken/30 text-[12px]" key={m.id}><strong>{ROLE_META[m.from]?.name ?? m.from} → {m.to === 'all' ? 'All agents' : ROLE_META[m.to]?.name ?? m.to}</strong><p className="mt-1 text-fg-2 selectable whitespace-pre-wrap">{m.content}</p></div>)}
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4 py-8">
            <span className="h-10 w-10 rounded-xl border border-line flex items-center justify-center text-fg-3">
              {activeConversation === 'manager'
                ? <Brain size={18} strokeWidth={1.6} />
                : (() => { const M = ROLE_META[activeConversation as AgentRole]; return M ? <M.icon size={18} strokeWidth={1.6} /> : <MessageSquare size={18} />; })()
              }
            </span>
            <p className="text-[0.78rem] text-fg-2 leading-relaxed max-w-[200px]">
              {activeConversation === 'manager'
                ? 'Message the Manager to change the plan, update requirements, or ask for status.'
                : `Ask ${ROLE_META[activeConversation as AgentRole]?.name ?? activeConversation} about their work, or give specific guidance.`}
            </p>
          </div>
        ) : (
          turns.map(turn => <ChatBubble key={turn.id} turn={turn} run={run} />)
        )}
      </div>

      {/* Scroll-to-bottom button */}
      {!autoScroll && (
        <div className="absolute bottom-[60px] right-4 z-10">
          <button
            onClick={scrollToBottom}
            className="h-7 w-7 rounded-full bg-raised border border-line shadow-float flex items-center justify-center text-fg-2 hover:text-fg transition-colors"
            aria-label="Scroll to bottom"
          >
            <ChevronDown size={14} />
          </button>
        </div>
      )}

      {/* Streaming indicator */}
      {isStreaming && (
        <div className="shrink-0 px-3 py-1 flex items-center gap-1.5 text-[0.68rem] text-fg-3 border-t border-line">
          <Working icon={ROLE_META[currentRole]?.icon ?? Brain} label={activeConversation === 'manager' ? 'Manager is responding…' : `${ROLE_META[currentRole]?.name ?? activeConversation} is responding…`} />
        </div>
      )}

      {/* Input */}
      {tab === 'Chat' && <ChatInput
        runId={runId}
        activeConversation={activeConversation}
        disabled={isStreaming}
        onSent={scrollToBottom}
      />}
    </div>
  );
});
