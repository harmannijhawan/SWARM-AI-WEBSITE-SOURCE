import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eraser, RotateCw, Square, SquareTerminal } from 'lucide-react';
import type { CommandExecution } from '../../shared/types';
import { api } from '../lib/api';
import { useStore, type CommandLive } from '../lib/store';
import { clock, duration } from '../lib/format';
import { ROLE_META } from './status';
import { Dot, Empty, IconButton, Spinner, cx } from './ui';

type Row = { id: string; command: string; status: 'running' | 'done'; exitCode: number | null; output: string; agent: string | null; ts: number; state?: CommandExecution['status'] };

export function TerminalPane({ projectId, runId, allowInput = true }: { projectId: string; runId?: string | null; allowInput?: boolean }) {
  const live = useStore((s) => s.commands);
  const toast = useStore((s) => s.toast);
  const [history, setHistory] = useState<CommandExecution[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [cleared, setCleared] = useState<number>(0);
  const [histIdx, setHistIdx] = useState(-1);
  const outRef = useRef<HTMLPreElement>(null);

  useEffect(() => { api.terminal.history(projectId).then(setHistory).catch(() => undefined); }, [projectId, runId]);

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    for (const h of history) {
      if (runId && h.runId !== runId) continue;
      map.set(h.id, { id: h.id, command: h.command, status: h.status === 'running' ? 'running' : 'done', exitCode: h.exitCode, output: h.output, agent: h.agent, ts: h.startedAt, state: h.status });
    }
    for (const c of Object.values(live) as CommandLive[]) {
      if (c.projectId !== projectId || (runId && c.runId !== runId)) continue;
      const prev = map.get(c.id);
      map.set(c.id, { id: c.id, command: c.command, status: c.status, exitCode: c.exitCode, output: c.output || prev?.output || '', agent: c.agent ?? (prev?.agent ?? null), ts: c.ts });
    }
    return [...map.values()].filter((r) => r.ts > cleared).sort((a, b) => a.ts - b.ts);
  }, [history, live, projectId, runId, cleared]);

  const active = rows.find((r) => r.id === selected) ?? rows[rows.length - 1];
  useEffect(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight; }, [active?.output.length, active?.id]);

  const userHistory = rows.filter((r) => r.agent === 'user' || !r.agent).map((r) => r.command).reverse();
  const run = async (cmd: string) => {
    if (!cmd.trim()) return;
    setInput(''); setHistIdx(-1);
    try {
      const r = await api.terminal.run(projectId, cmd);
      setHistory((h) => [...h.filter((x) => x.id !== r.id), r]);
      setSelected(r.id);
      if (r.status === 'denied') toast({ level: 'warning', title: 'Command not run', body: r.output });
    } catch (e) { toast({ level: 'error', title: 'Command failed to start', body: String((e as Error).message) }); }
  };

  return (
    <div className="h-full flex min-h-0">
      <div className="w-[230px] shrink-0 border-r border-line overflow-y-auto py-1">
        {rows.length === 0 && <div className="p-4 text-[0.72rem] text-fg-3">No commands yet.</div>}
        {rows.map((r) => (
          <button key={r.id} onClick={() => setSelected(r.id)} className={cx('w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-hover/60', active?.id === r.id && 'bg-hover')}>
            <span className="pt-1">{r.status === 'running' ? <Dot tone="accent" pulse /> : <Dot tone={r.state === 'denied' ? 'warn' : r.exitCode === 0 ? 'ok' : 'err'} />}</span>
            <span className="min-w-0">
              <span className="block mono text-[0.7rem] text-fg truncate">{r.command}</span>
              <span className="block text-[0.65rem] text-fg-3">{r.agent && r.agent !== 'user' ? ROLE_META[r.agent as keyof typeof ROLE_META]?.name : 'You'} · {clock(r.ts)}{r.status === 'done' && r.state !== 'denied' ? ` · exit ${r.exitCode ?? '—'}` : r.state === 'denied' ? ' · not run' : ''}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {active ? (
          <>
            <div className="h-9 flex items-center gap-2 px-3 border-b border-line shrink-0">
              <span className="mono text-[0.72rem] text-fg truncate flex-1">$ {active.command}</span>
              {active.status === 'running' ? <span className="flex items-center gap-1.5 text-[0.7rem] text-accent"><Spinner size={11} /> running {duration(Date.now() - active.ts)}</span> : null}
              {active.status === 'running' && <IconButton icon={Square} label="Stop process" size="sm" onClick={() => api.terminal.stop(active.id)} />}
              {active.status === 'done' && <IconButton icon={RotateCw} label="Run again" size="sm" onClick={() => run(active.command)} />}
              <IconButton icon={Copy} label="Copy output" size="sm" onClick={() => { void navigator.clipboard.writeText(active.output); toast({ level: 'success', title: 'Output copied' }); }} />
              <IconButton icon={Eraser} label="Clear" size="sm" onClick={() => { setCleared(Date.now()); setSelected(null); }} />
            </div>
            <pre ref={outRef} className="flex-1 min-h-0 overflow-auto p-3 mono text-[0.72rem] leading-[1.55] text-fg-2 whitespace-pre-wrap break-words selectable bg-sunken">{active.output || (active.status === 'running' ? 'Waiting for output…' : '(no output)')}</pre>
          </>
        ) : <Empty icon={SquareTerminal} title="Terminal" body="Commands run by agents and by you appear here with live output." />}
        {allowInput && (
          <form onSubmit={(e) => { e.preventDefault(); void run(input); }} className="h-10 shrink-0 border-t border-line flex items-center gap-2 px-3">
            <span className="mono text-[0.75rem] text-fg-3">$</span>
            <input aria-label="Run a command in the project directory" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Run a command in the project folder"
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' && userHistory.length) { e.preventDefault(); const i = Math.min(histIdx + 1, userHistory.length - 1); setHistIdx(i); setInput(userHistory[i]); }
                if (e.key === 'ArrowDown') { e.preventDefault(); const i = histIdx - 1; setHistIdx(i); setInput(i >= 0 ? userHistory[i] : ''); }
              }}
              className="flex-1 bg-transparent mono text-[0.75rem] text-fg placeholder:text-fg-3" />
          </form>
        )}
      </div>
    </div>
  );
}
