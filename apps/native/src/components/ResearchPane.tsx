import { useEffect, useMemo, useState } from 'react';
import { BookOpenText, ExternalLink, ShieldOff } from 'lucide-react';
import type { ResearchFinding, ResearchSource } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Badge, Empty, Segmented, cx } from './ui';
import { timeAgo } from '../lib/format';

export function useResearch(projectId: string, runId?: string | null) {
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [findings, setFindings] = useState<ResearchFinding[]>([]);
  const n = useStore((s) => (runId ? (s.events[runId] ?? []).filter((e) => e.type === 'SOURCE_FOUND' || e.type === 'FINDING_ADDED' || e.type === 'SOURCE_BLOCKED').length : 0));
  useEffect(() => {
    api.research.sources(projectId, runId ?? undefined).then(setSources).catch(() => undefined);
    api.research.findings(projectId, runId ?? undefined).then(setFindings).catch(() => undefined);
  }, [projectId, runId, n]);
  return { sources, findings };
}

export function ResearchPane({ projectId, runId }: { projectId: string; runId?: string | null }) {
  const { sources, findings } = useResearch(projectId, runId);
  const [tab, setTab] = useState<'findings' | 'sources'>('findings');
  const [hl, setHl] = useState<string | null>(null);
  const citable = sources.filter((s) => s.status === 'fetched' || s.status === 'search_only');
  const skipped = sources.filter((s) => s.status === 'blocked_robots' || s.status === 'failed');
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const categories = useMemo(() => [...new Set(findings.map((f) => f.category))], [findings]);

  if (!sources.length) return <Empty icon={BookOpenText} title="No research yet" body="When the Researcher runs, every search, source and cited finding appears here." />;

  const open = (url: string) => api.openExternal(url).catch(() => undefined);
  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-10 shrink-0 flex items-center gap-3 px-3 border-b border-line">
        <Segmented size="sm" value={tab} onChange={setTab} label="Research view" options={[{ value: 'findings', label: `Findings ${findings.length}` }, { value: 'sources', label: `Sources ${citable.length}` }]} />
        <span className="text-[0.7rem] text-fg-3">{citable.filter((s) => s.status === 'fetched').length} read in full · {skipped.length} skipped</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'findings' ? (
          findings.length ? categories.map((c) => (
            <div key={c} className="px-4 pt-4">
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-fg-3 mb-1.5">{c}</div>
              <ul className="space-y-1.5">
                {findings.filter((f) => f.category === c).map((f) => (
                  <li key={f.id} className="text-[0.8rem] leading-relaxed text-fg selectable">
                    {f.claim}{' '}
                    {f.sourceIds.map((sid) => { const s = byId.get(sid); return s ? (
                      <button key={sid} onClick={() => { setTab('sources'); setHl(sid); }} onMouseEnter={() => setHl(sid)} title={`${s.title} — ${s.domain}`}
                        className="inline-flex items-center h-4 px-1 mx-0.5 rounded bg-accent-soft text-accent text-[0.62rem] font-semibold align-middle hover:opacity-80">{s.ref}</button>
                    ) : null; })}
                  </li>
                ))}
              </ul>
            </div>
          )) : <div className="p-4 text-[0.75rem] text-fg-3">Sources collected; findings appear once extraction completes.</div>
        ) : (
          <ul className="divide-y divide-line">
            {citable.map((s) => (
              <li key={s.id} className={cx('px-4 py-3 transition-colors', hl === s.id && 'bg-accent-soft/60')}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 h-5 min-w-5 px-1 rounded bg-sunken border border-line text-[0.65rem] font-semibold flex items-center justify-center tabular">{s.ref}</span>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => open(s.url)} className="text-[0.8rem] font-medium text-fg hover:underline text-left inline-flex items-center gap-1">{s.title}<ExternalLink size={11} className="text-fg-3" /></button>
                    <div className="text-[0.68rem] text-fg-3 flex items-center gap-1.5 mt-0.5">
                      {s.domain}<span>·</span>{s.engine}<span>·</span>{timeAgo(s.fetchedAt)}
                      {s.status === 'search_only' && <Badge tone="warn">snippet only</Badge>}
                    </div>
                    <p className="mt-1.5 text-[0.74rem] text-fg-2 leading-relaxed line-clamp-4 selectable">{s.excerpt ?? s.snippet}</p>
                    <div className="mt-1 text-[0.66rem] text-fg-3">Query: “{s.query}”</div>
                  </div>
                </div>
              </li>
            ))}
            {skipped.length > 0 && (
              <li className="px-4 py-3">
                <div className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-fg-3 mb-1.5">Not used</div>
                {skipped.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-[0.7rem] text-fg-3 py-0.5">
                    <ShieldOff size={11} /><span className="truncate">{s.domain}</span><span>— {s.error}</span>
                  </div>
                ))}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
