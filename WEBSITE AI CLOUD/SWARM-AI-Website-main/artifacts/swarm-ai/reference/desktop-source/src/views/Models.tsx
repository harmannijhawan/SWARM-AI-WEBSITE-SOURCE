import { useEffect, useMemo, useState } from 'react';
import { Brain, Code2, Eye, Gauge, RefreshCw, Search, Stethoscope, TextQuote, Wrench, Zap, Play } from 'lucide-react';
import type { Capability, ModelInfo, UsageSummary } from '../../shared/types';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { ctxLen, num, timeAgo, usd } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { healthLabel, healthTone } from '../components/status';
import { Badge, Button, Dot, Select, Spinner, Toggle, cx } from '../components/ui';

const CAPS: { id: Capability; label: string; icon: typeof Code2 }[] = [
  { id: 'coding', label: 'Coding', icon: Code2 }, { id: 'reasoning', label: 'Reasoning', icon: Brain }, { id: 'vision', label: 'Vision', icon: Eye },
  { id: 'tools', label: 'Tools', icon: Wrench }, { id: 'long_context', label: 'Long context', icon: TextQuote }, { id: 'fast', label: 'Fast', icon: Zap },
];
const PURPOSES = [['code', 'Coding task'], ['plan', 'Planning / architecture'], ['research', 'Research synthesis'], ['vision', 'Vision QA'], ['classify', 'Fast classification'], ['review', 'Code review']] as const;

export function Models() {
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const inspector = useStore((s) => s.inspector);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const [provider, setProvider] = useState('all');
  const [health, setHealth] = useState('all');
  const [caps, setCaps] = useState<Capability[]>([]);
  const [sort, setSort] = useState<'health' | 'latency' | 'context' | 'size' | 'name'>('health');
  const [busy, setBusy] = useState<string | null>(null);
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [purpose, setPurpose] = useState<string>('code');
  const [ranking, setRanking] = useState<{ id: string; score: number }[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => { api.models.rank(purpose).then(setRanking).catch(() => setRanking([])); }, [purpose, models]);
  useEffect(() => { api.models.usage().then(setUsage).catch(() => undefined); }, [models]);

  const now = Date.now();
  const configured = new Set(providers.filter((p) => p.configured && p.enabled).map((p) => p.id));
  const usable = models.filter((m) => configured.has(m.providerId) && m.enabled && !['auth_required', 'unsupported', 'offline'].includes(m.health) && !(m.health === 'rate_limited' && (m.rateLimitedUntil ?? 0) > now));
  const stats = {
    available: usable.length,
    healthy: models.filter((m) => m.health === 'healthy').length,
    limited: models.filter((m) => m.health === 'rate_limited' && (m.rateLimitedUntil ?? 0) > now).length,
    offline: models.filter((m) => m.health === 'offline').length,
    key: models.filter((m) => m.health === 'auth_required').length,
  };

  const list = useMemo(() => {
    const order: Record<string, number> = { healthy: 0, degraded: 1, unknown: 2, rate_limited: 3, auth_required: 4, offline: 5, unsupported: 6 };
    return models.filter((m) => (provider === 'all' || m.providerId === provider) && (health === 'all' || m.health === health)
      && caps.every((c) => m.capabilities.includes(c)) && (!dq || `${m.displayName} ${m.modelId}`.toLowerCase().includes(dq.toLowerCase())))
      .sort((a, b) => sort === 'latency' ? (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9) : sort === 'context' ? b.contextLength - a.contextLength : sort === 'size' ? (b.paramsB ?? 0) - (a.paramsB ?? 0) : sort === 'name' ? a.displayName.localeCompare(b.displayName) : (order[a.health] - order[b.health]) || ((a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9)));
  }, [models, provider, health, caps, dq, sort]);

  const discover = async () => { setBusy('discover'); try { const r = await api.models.discover(); useStore.setState({ models: r.models, providers: r.providers }); toast({ level: 'success', title: 'Registry refreshed', body: `${r.models.length} free models` }); } finally { setBusy(null); } };
  const check = async () => { setBusy('health'); try { await api.models.healthCheck(); toast({ level: 'success', title: 'Health checks complete' }); } finally { setBusy(null); } };
  const test = async (m: ModelInfo) => {
    setTesting((s) => new Set(s).add(m.id));
    const r = await api.models.probe(m.id).finally(() => setTesting((s) => { const n = new Set(s); n.delete(m.id); return n; }));
    toast({ level: r.ok ? 'success' : 'error', title: r.ok ? `${m.displayName} responded` : `${m.displayName} failed`, body: r.ok ? `${(r.latencyMs / 1000).toFixed(2)}s round trip` : r.error });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1180px] mx-auto px-8 py-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5"><h1 className="text-[1.35rem] font-semibold tracking-[-0.015em]">Model Center</h1><span className="flex items-center gap-1.5 h-6 px-2 rounded-md border border-line text-[0.68rem] font-semibold"><Dot tone="ok" /> FREE MODE · ON</span></div>
            <p className="text-[0.8rem] text-fg-2 mt-1">A live registry of free, free-tier and local models. Health, latency and success rates are measured from real requests.</p>
          </div>
          <div className="flex gap-2">
            <Button icon={RefreshCw} loading={busy === 'discover'} onClick={discover}>Discover</Button>
            <Button icon={Stethoscope} loading={busy === 'health'} onClick={check}>Health check</Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-5 border border-line rounded-2xl bg-panel divide-x divide-line">
          <Stat label="Available" value={stats.available} hint="Usable by the router now" />
          <Stat label="Healthy" value={stats.healthy} tone="ok" hint="Succeeded on last request" />
          <Stat label="Rate limited" value={stats.limited} tone="warn" hint="Cooling down" />
          <Stat label="Offline" value={stats.offline} tone="err" hint="Repeated failures or delisted" />
          <Stat label="Key required" value={stats.key} hint="Listed but provider not connected" />
        </div>

        <div className="mt-6 grid grid-cols-[1fr_320px] gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <label className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-raised border border-line-strong w-60 focus-within:border-accent">
                <Search size={13} className="text-fg-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" aria-label="Search models" className="flex-1 bg-transparent text-[0.8rem]" />
              </label>
              <Select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider"><option value="all">All providers</option>{providers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.modelCount})</option>)}</Select>
              <Select value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Health"><option value="all">Any health</option>{['healthy', 'degraded', 'unknown', 'rate_limited', 'offline', 'auth_required', 'unsupported'].map((h) => <option key={h} value={h}>{healthLabel(h as never)}</option>)}</Select>
              <Select value={sort} onChange={(e) => setSort(e.target.value as never)} aria-label="Sort"><option value="health">Sort: health</option><option value="latency">Sort: latency</option><option value="context">Sort: context</option><option value="size">Sort: size</option><option value="name">Sort: name</option></Select>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {CAPS.map((c) => { const on = caps.includes(c.id); return (
                <button key={c.id} aria-pressed={on} onClick={() => setCaps((x) => on ? x.filter((y) => y !== c.id) : [...x, c.id])} className={cx('h-7 px-2.5 rounded-lg border text-[0.72rem] inline-flex items-center gap-1.5 transition-colors', on ? 'border-fg text-fg bg-raised' : 'border-line text-fg-2 hover:text-fg')}><c.icon size={12} />{c.label}</button>
              ); })}
              <span className="ml-auto text-[0.72rem] text-fg-3 self-center tabular">{list.length} of {models.length}</span>
            </div>
            <div className="rounded-2xl border border-line bg-panel overflow-hidden">
              <table className="w-full text-[0.76rem]">
                <thead className="text-[0.66rem] text-fg-3 text-left">
                  <tr className="border-b border-line"><th className="font-medium px-4 py-2.5">Model</th><th className="font-medium px-2">Capabilities</th><th className="font-medium px-2 text-right">Context</th><th className="font-medium px-2 text-right">Latency</th><th className="font-medium px-2 text-right">Success</th><th className="font-medium px-2">Health</th><th className="px-2" /></tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr data-health={m.health} key={m.id} onClick={() => useStore.setState({ inspector: { type: 'model', id: m.id } })} className={cx('motion-model border-b border-line/70 last:border-0 cursor-pointer hover:bg-hover/50', inspector?.type === 'model' && inspector.id === m.id && 'bg-hover', !m.enabled && 'opacity-50')}>
                      <td className="px-4 py-2 max-w-[260px]">
                        <div className="font-medium truncate">{m.displayName}</div>
                        <div className="text-[0.66rem] text-fg-3 truncate">{providers.find((p) => p.id === m.providerId)?.name} · {m.freeStatus === 'local' ? 'local' : m.freeStatus === 'free' ? 'free' : 'free tier'}{m.paramsB ? ` · ${m.paramsB}B` : ''}</div>
                      </td>
                      <td className="px-2"><div className="flex gap-1 text-fg-3">{CAPS.filter((c) => m.capabilities.includes(c.id)).map((c) => <span key={c.id} title={c.label} aria-label={c.label}><c.icon size={12} /></span>)}</div></td>
                      <td className="px-2 text-right tabular text-fg-2">{ctxLen(m.contextLength)}</td>
                      <td className="px-2 text-right tabular text-fg-2">{m.latencyMs !== null ? `${(m.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
                      <td className="px-2 text-right tabular text-fg-2">{m.calls ? `${Math.round((m.successes / m.calls) * 100)}%` : '—'}</td>
                      <td className="px-2"><span className="inline-flex items-center gap-1.5 text-fg-2 whitespace-nowrap"><Dot tone={healthTone(m.health)} />{healthLabel(m.health)}</span></td>
                      <td className="px-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2 justify-end">
                          <button aria-label={`Test ${m.displayName}`} title="Send a real test request" disabled={testing.has(m.id) || !configured.has(m.providerId)} onClick={() => test(m)} className="h-6 w-6 rounded-md flex items-center justify-center text-fg-3 hover:text-fg hover:bg-hover disabled:opacity-30">{testing.has(m.id) ? <Spinner size={11} /> : <Play size={12} />}</button>
                          <Toggle checked={m.enabled} label={`Enable ${m.displayName}`} onChange={(v) => api.models.setEnabled(m.id, v)} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.length && <div className="p-8 text-center text-[0.8rem] text-fg-3">{models.length ? 'No models match these filters.' : 'No models discovered yet. Connect a provider in Settings › Providers, or start Ollama, then press Discover.'}</div>}
            </div>
          </div>

          <aside className="space-y-6">
            <section>
              <div className="text-[0.72rem] font-medium text-fg-3 mb-2">Providers</div>
              <div className="rounded-2xl border border-line bg-panel divide-y divide-line">
                {providers.map((p) => (
                  <button key={p.id} onClick={() => useStore.setState({ view: 'settings', settingsSection: 'providers' })} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover/50">
                    <Dot tone={!p.enabled ? 'neutral' : !p.configured ? 'neutral' : p.health === 'healthy' ? 'ok' : p.health === 'offline' ? 'err' : p.health === 'auth_required' ? 'warn' : 'neutral'} />
                    <span className="text-[0.78rem] flex-1 truncate">{p.name}</span>
                    <span className="text-[0.68rem] text-fg-3 tabular">{!p.enabled ? 'disabled' : !p.configured ? (p.modelCount ? `${p.modelCount} listed · no key` : 'not connected') : `${p.modelCount} models`}</span>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between mb-2"><span className="text-[0.72rem] font-medium text-fg-3">Router ranking</span>
                <Select value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Task type" className="h-7 text-[0.72rem]">{PURPOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></div>
              <div className="rounded-2xl border border-line bg-panel p-1.5">
                {ranking.length ? ranking.slice(0, 8).map((r, i) => { const m = models.find((x) => x.id === r.id); return m ? (
                  <button key={r.id} onClick={() => useStore.setState({ inspector: { type: 'model', id: m.id } })} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hover text-left">
                    <span className="w-4 text-[0.68rem] text-fg-3 tabular">{i + 1}</span><span className="flex-1 text-[0.76rem] truncate">{m.displayName}</span><span className="text-[0.66rem] text-fg-3 tabular">{r.score}</span>
                  </button>
                ) : null; }) : <div className="p-3 text-[0.72rem] text-fg-3">No eligible model for this task type yet.</div>}
                <div className="px-2 pt-1 pb-1.5 text-[0.65rem] text-fg-3">Scores combine capability fit, size, measured reliability and latency. First choice is tried first; the rest form the fallback chain.</div>
              </div>
            </section>
            <section>
              <div className="text-[0.72rem] font-medium text-fg-3 mb-2">Usage & cost</div>
              <div className="rounded-2xl border border-line bg-panel p-4">
                <div className="space-y-1.5 text-[0.78rem]">
                  <div className="flex justify-between"><span className="text-fg-2">Cloud API</span><span className="tabular">{usd(usage?.cloudUsd ?? 0)}</span></div>
                  <div className="flex justify-between"><span className="text-fg-2">Local compute</span><span className="tabular">{usd(usage?.localUsd ?? 0)}</span></div>
                  <div className="flex justify-between pt-1.5 border-t border-line font-semibold"><span>Total</span><span className="tabular">{usd(usage?.totalUsd ?? 0)}</span></div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[0.7rem] text-fg-3">
                  <div><div className="text-[0.95rem] text-fg font-semibold tabular">{num(usage?.calls ?? 0)}</div>model calls</div>
                  <div><div className="text-[0.95rem] text-fg font-semibold tabular">{num((usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0))}</div>tokens</div>
                </div>
                {usage && usage.byProvider.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-line space-y-1">
                    {usage.byProvider.map((p) => <div key={p.providerId} className="flex justify-between text-[0.7rem]"><span className="text-fg-2">{p.providerId}</span><span className="text-fg-3 tabular">{p.calls} calls · {p.failures} failed · {(p.avgLatencyMs / 1000).toFixed(1)}s</span></div>)}
                  </div>
                )}
              </div>
            </section>
            <p className="text-[0.66rem] text-fg-3 leading-relaxed"><Gauge size={11} className="inline mr-1" />Registry refreshed {timeAgo(Math.max(0, ...providers.map((p) => p.lastDiscoveryAt ?? 0)))}. Free availability changes; SWARM re-discovers periodically and never bypasses provider limits.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: number; tone?: 'ok' | 'warn' | 'err'; hint: string }) {
  return (
    <div className="px-5 py-4" title={hint}>
      <div className="text-[0.7rem] text-fg-3 flex items-center gap-1.5">{tone && <Dot tone={tone} />}{label}</div>
      <div className="text-[1.5rem] font-semibold tabular tracking-tight mt-0.5">{value}</div>
    </div>
  );
}

export { Badge };
