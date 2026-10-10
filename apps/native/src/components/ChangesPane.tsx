import { useEffect, useMemo, useState } from 'react';
import { FileDiff } from 'lucide-react';
import type { FileChange } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { ROLE_META } from './status';
import { DiffView } from './DiffView';
import { Empty, cx } from './ui';

export function useChanges(projectId: string, runId?: string | null) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const fileEvents = useStore((s) => (runId ? (s.events[runId] ?? []).filter((e) => e.type.startsWith('FILE_')).length : s.globalEvents.length));
  useEffect(() => { api.projects.changes(projectId, runId ? { runId } : undefined).then(setChanges).catch(() => undefined); }, [projectId, runId, fileEvents]);
  return [changes, setChanges] as const;
}

export function ChangesPane({ projectId, runId }: { projectId: string; runId?: string | null }) {
  const [changes, setChanges] = useChanges(projectId, runId);
  const [sel, setSel] = useState<string | null>(null);
  const toast = useStore((s) => s.toast);
  const latestPerPath = useMemo(() => {
    const seen = new Set<string>();
    return changes.filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true)));
  }, [changes]);
  const active = changes.find((c) => c.id === sel) ?? latestPerPath[0];
  const history = active ? changes.filter((c) => c.path === active.path) : [];

  if (!changes.length) return <Empty icon={FileDiff} title="No file changes yet" body="Every file an agent creates or edits is tracked here with a before/after diff you can revert." />;

  const revert = async (c: FileChange) => {
    try { await api.projects.revertChange(projectId, c.id); toast({ level: 'success', title: `Reverted ${c.path}` }); setChanges(await api.projects.changes(projectId, runId ? { runId } : undefined)); }
    catch (e) { toast({ level: 'error', title: 'Revert failed', body: String((e as Error).message) }); }
  };
  const accept = async (c: FileChange) => { await api.projects.acceptChange(c.id); setChanges(await api.projects.changes(projectId, runId ? { runId } : undefined)); };

  return (
    <div className="h-full flex min-h-0">
      <div className="w-[240px] shrink-0 border-r border-line overflow-y-auto py-1">
        {latestPerPath.map((c) => (
          <button key={c.id} onClick={() => setSel(c.id)} className={cx('w-full text-left px-3 py-1.5 hover:bg-hover/60', active?.path === c.path && 'bg-hover')}>
            <div className="flex items-center gap-2">
              <span className={cx('text-[0.62rem] font-semibold w-3', c.kind === 'created' ? 'text-ok' : c.kind === 'deleted' ? 'text-err' : 'text-warn')}>{c.kind === 'created' ? 'A' : c.kind === 'deleted' ? 'D' : c.kind === 'renamed' ? 'R' : 'M'}</span>
              <span className="mono text-[0.7rem] truncate flex-1">{c.path}</span>
            </div>
            <div className="pl-5 text-[0.64rem] text-fg-3">{c.agent === 'user' ? 'You' : c.agent ? ROLE_META[c.agent].name : ''} · +{c.additions} −{c.deletions}{changes.filter((x) => x.path === c.path).length > 1 ? ` · ${changes.filter((x) => x.path === c.path).length} edits` : ''}</div>
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        {history.length > 1 && (
          <div className="flex gap-1 px-3 py-1.5 border-b border-line overflow-x-auto shrink-0">
            {history.map((h, i) => (
              <button key={h.id} onClick={() => setSel(h.id)} className={cx('h-6 px-2 rounded-md text-[0.66rem] whitespace-nowrap', active?.id === h.id ? 'bg-hover text-fg' : 'text-fg-3 hover:text-fg')}>
                Edit {history.length - i} · {h.agent === 'user' ? 'You' : h.agent ? ROLE_META[h.agent].name : ''}
              </button>
            ))}
          </div>
        )}
        {active && <div className="flex-1 min-h-0"><DiffView change={active} onRevert={() => revert(active)} onAccept={() => accept(active)} /></div>}
      </div>
    </div>
  );
}
