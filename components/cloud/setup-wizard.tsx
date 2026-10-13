'use client';
// First-run setup (docs/SWARM_PLATFORM_SPEC.md §5). Six steps; progress survives Back and step changes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Loader2, RefreshCw, Rocket, Sparkles, X } from 'lucide-react';
import { INTELLIGENCE_PROFILES, ONBOARDING_COPY, ONBOARDING_VERSION, PROFILE_LABELS, PROVIDER_CATALOG, catalogEntry, type IntelligenceProfile, type ProviderStatusSummary } from '@/shared/providers';
import { freeLabel, preferencesApi, providersApi, type DiscoveredModelRow } from './provider-api';
import { ConnectForm, KeyPageLink, ProviderLogo, StatusBadge } from './provider-connect';
import { PROVIDERS_QUERY_KEY, useProviderChanged, useProviderStatuses } from './provider-keys';
import { ThemeButton } from './theme-button';

const STEPS = ['Welcome', 'Providers', 'Connect', 'Test', 'Intelligence', 'Finish'] as const;
type Step = 0 | 1 | 2 | 3 | 4 | 5;

export const PREFERENCES_QUERY_KEY = ['setup-preferences'] as const;
export function usePreferences() {
  return useQuery({ queryKey: PREFERENCES_QUERY_KEY, queryFn: () => preferencesApi.get(), staleTime: 60_000, refetchInterval: false, retry: 1 });
}

function Progress({ step, onJump, reachable }: { step: Step; onJump: (s: Step) => void; reachable: (s: Step) => boolean }) {
  return <nav className="sx-progress" aria-label="Setup progress">
    <ol>{STEPS.map((label, i) => {
      const s = i as Step; const state = s < step ? 'done' : s === step ? 'current' : 'todo';
      return <li key={label} data-state={state}>
        <button type="button" onClick={() => onJump(s)} disabled={!reachable(s) || s === step} aria-current={s === step ? 'step' : undefined}>
          <span className="sx-progress-dot">{state === 'done' ? <Check size={12} aria-hidden /> : i + 1}</span><span className="sx-progress-label">{label}</span>
        </button>
      </li>;
    })}</ol>
  </nav>;
}

export function SetupWizard({ onFinished }: { onFinished: () => void }) {
  const cache = useQueryClient();
  const { data, isLoading, isError, refetch } = useProviderStatuses();
  const changed = useProviderChanged();
  const providers = useMemo(() => {
    const byId = new Map((data?.providers ?? []).map(p => [p.id, p]));
    return PROVIDER_CATALOG.map(c => byId.get(c.id)).filter((p): p is ProviderStatusSummary => !!p);
  }, [data]);
  const [step, setStep] = useState<Step>(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [profile, setProfile] = useState<IntelligenceProfile>('recommended');
  const [primary, setPrimary] = useState<string>('');
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [saving, setSaving] = useState<null | 'finish' | 'later'>(null);
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const connected = providers.filter(p => p.status === 'connected');
  const configured = providers.filter(p => p.configured);

  // Pre-select providers that already have keys (re-running setup) or, on a clean start, the two quickest.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !providers.length) return;
    seeded.current = true;
    const existing = providers.filter(p => p.configured).map(p => p.id);
    setSelected(existing.length ? existing : PROVIDER_CATALOG.filter(c => c.recommended).map(c => c.id));
  }, [providers]);
  useEffect(() => { headingRef.current?.focus(); }, [step]);

  const models = useQuery({ queryKey: ['setup-models', connected.map(p => p.id).join(',')], queryFn: () => providersApi.models(), enabled: step >= 4, staleTime: 30_000, refetchInterval: false });
  const go = (s: Step) => { setError(''); setStep(s); if (s === 2 && !active) setActive(selected.find(id => providers.find(p => p.id === id)?.status !== 'connected') ?? selected[0] ?? null); };
  const reachable = (s: Step) => s <= 1 || (s === 2 ? selected.length > 0 : s === 3 ? configured.length > 0 : s >= 4 ? configured.length > 0 || step >= s : false);

  async function persist(skipped: boolean) {
    setSaving(skipped ? 'later' : 'finish'); setError('');
    try {
      await preferencesApi.update(current => {
        const next = { ...current, onboarding: { ...(current.onboarding ?? {}), completedAt: Date.now(), version: ONBOARDING_VERSION, skipped } };
        if (!skipped) {
          next.ai = { ...(current.ai ?? {}), profile, pinnedModel: profile === 'custom' && primary ? primary : null };
          next.routing = { ...(current.routing ?? {}), fallbacks: profile === 'custom' ? [primary, ...fallbacks].filter(Boolean) : [] };
        }
        return next;
      });
      await cache.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY });
      onFinished();
    } catch (e) { setError(e instanceof Error ? e.message : 'Your setup could not be saved. Try again.'); }
    finally { setSaving(null); }
  }

  const modelRows = (models.data?.models ?? []).filter(m => m.source === 'byok' || connected.some(p => p.id === m.providerId));
  return <div className="sx-wizard">
    <header className="sx-wizard-top">
      <span className="sx-brand" aria-label="SWARM"><img className="sx-brand-mark" src="/brand/swarm-mark.png" alt="" /><img className="sx-brand-word" src="/brand/swarm-wordmark.png" alt="" /></span>
      {step > 0 && <Progress step={step} onJump={go} reachable={reachable} />}
      <div className="sx-top-actions">
        <ThemeButton />
        {step > 0 && <button type="button" className="sx-button sx-ghost sx-sm" onClick={() => void persist(true)} disabled={!!saving}>{saving === 'later' ? 'Saving…' : 'Finish later'}</button>}
      </div>
    </header>
    <main className="sx-wizard-body">
      {isError && <div className="sx-error" role="alert">Providers could not load. <button type="button" className="sx-link" onClick={() => void refetch()}>Try again</button></div>}

      {step === 0 && <section className="sx-welcome" aria-labelledby="sx-step-title">
        <div>
          <div className="sx-hero-mark"><img src="/brand/swarm-mark.png" alt="SWARM" /></div>
          <span className="sx-eyebrow">Welcome to SWARM</span>
          <h1 id="sx-step-title" ref={headingRef} tabIndex={-1}>{ONBOARDING_COPY.headline}</h1>
          <p className="sx-lede">{ONBOARDING_COPY.description}</p>
          <ul className="sx-points">
            <li><span className="sx-point-icon"><Check size={14} aria-hidden /></span><span><b>About a minute.</b> Groq and Google AI Studio advertise free tiers and need no credit card to start.</span></li>
            <li><span className="sx-point-icon"><Check size={14} aria-hidden /></span><span><b>No dead ends.</b> Connect two providers and SWARM switches automatically when one is busy — and tells you.</span></li>
            <li><span className="sx-point-icon"><Check size={14} aria-hidden /></span><span><b>Private by default.</b> Keys are encrypted in your account vault and never shown again.</span></li>
          </ul>
          <div className="sx-actions">
            <button type="button" className="sx-button sx-primary sx-lg" onClick={() => go(1)}>Get Started<ArrowRight size={17} aria-hidden /></button>
            <button type="button" className="sx-button sx-ghost sx-lg" onClick={() => void persist(true)} disabled={!!saving}>{saving === 'later' ? 'Saving…' : 'Configure Later'}</button>
          </div>
          <p className="sx-later-note">Configure Later opens the workspace without a model. Run setup any time from Settings → Providers.</p>
        </div>
        <aside className="sx-preview" aria-label="What setup looks like">
          <div className="sx-preview-head"><b>Setup in three moves</b><span>~1 min</span></div>
          <ol className="sx-preview-steps">
            <li><span>1</span><div>Pick a provider<small>Groq or Google AI Studio is quickest</small></div></li>
            <li><span>2</span><div>Copy your key<small>SWARM opens the official key page for you</small></div></li>
            <li><span>3</span><div>Paste — that's it<small>SWARM tests it with one tiny request and saves it</small></div></li>
          </ol>
          <div className="sx-preview-logos" aria-hidden>{PROVIDER_CATALOG.map(p => <ProviderLogo key={p.id} id={p.id} />)}</div>
        </aside>
      </section>}

      {step === 1 && <section aria-labelledby="sx-step-title">
        <h1 id="sx-step-title" ref={headingRef} tabIndex={-1}>Choose your AI providers</h1>
        <p className="sx-lede">Pick one or more. New to this? <b>Groq</b> and <b>Google AI Studio</b> are the quickest — each takes about a minute and advertises a free tier.</p>
        {isLoading ? <div className="sx-grid">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="sx-card sx-skeleton" />)}</div> :
          <div className="sx-grid sx-choose" role="group" aria-label="Providers">{providers.map(p => {
            const entry = catalogEntry(p.id)!; const on = selected.includes(p.id);
            return <label key={p.id} className="sx-card sx-choice" data-selected={on || undefined}>
              <input type="checkbox" checked={on} onChange={() => setSelected(s => on ? s.filter(x => x !== p.id) : [...s, p.id])} />
              <header className="sx-card-head"><ProviderLogo id={p.id} /><div className="sx-card-title"><h3>{p.name}{entry.recommended && <span className="sx-pill">Recommended</span>}</h3><p>{p.description}</p></div><span className="sx-check" aria-hidden>{on && <Check size={14} />}</span></header>
              <div className="sx-choice-foot"><StatusBadge status={p.status} />{entry.tag && <span className="sx-tag">{entry.tag}</span>}</div>
            </label>;
          })}</div>}
        <div className="sx-actions sx-split">
          <button type="button" className="sx-button sx-ghost" onClick={() => go(0)}><ArrowLeft size={15} aria-hidden />Back</button>
          <button type="button" className="sx-button sx-primary" disabled={!selected.length} onClick={() => go(2)}>Continue with {selected.length || 'no'} provider{selected.length === 1 ? '' : 's'}<ArrowRight size={15} aria-hidden /></button>
        </div>
      </section>}

      {step === 2 && <section aria-labelledby="sx-step-title">
        <h1 id="sx-step-title" ref={headingRef} tabIndex={-1}>Connect {selected.length > 1 ? 'your providers' : providers.find(p => p.id === selected[0])?.name ?? 'a provider'}</h1>
        <p className="sx-lede">Open the provider page, copy the key, and paste it here. SWARM checks it for you.</p>
        <div className="sx-tabs" role="tablist" aria-label="Selected providers">{selected.map(id => {
          const p = providers.find(x => x.id === id); if (!p) return null;
          return <button key={id} role="tab" type="button" aria-selected={active === id} className="sx-tab" onClick={() => setActive(id)}>
            <ProviderLogo id={id} /><span>{p.name}</span>{p.status === 'connected' ? <Check size={14} className="sx-ok" aria-label="Connected" /> : null}
          </button>;
        })}</div>
        {(() => {
          const p = providers.find(x => x.id === active) ?? providers.find(x => x.id === selected[0]);
          if (!p) return null;
          const nextPending = selected.find(id => id !== p.id && providers.find(x => x.id === id)?.status !== 'connected');
          return <div className="sx-panel" role="tabpanel" aria-label={p.name} key={p.id}>
            <div className="sx-panel-head"><div className="sx-card-head"><ProviderLogo id={p.id} /><div className="sx-card-title"><h2>{p.name}</h2><p>{catalogEntry(p.id)?.tag}</p></div></div><StatusBadge status={p.status} /></div>
            <ConnectForm provider={p} onChanged={changed} autoFocus onConnected={() => { if (nextPending) setTimeout(() => setActive(nextPending), 900); }} />
            {p.status === 'connected' && nextPending && <div className="sx-actions"><button type="button" className="sx-button" onClick={() => setActive(nextPending)}>Next: {providers.find(x => x.id === nextPending)?.name}<ArrowRight size={15} aria-hidden /></button></div>}
          </div>;
        })()}
        <div className="sx-actions sx-split">
          <button type="button" className="sx-button sx-ghost" onClick={() => go(1)}><ArrowLeft size={15} aria-hidden />Back</button>
          <button type="button" className="sx-button sx-primary" disabled={!configured.length} onClick={() => go(3)}>{configured.length ? 'Continue' : 'Connect at least one provider'}<ArrowRight size={15} aria-hidden /></button>
        </div>
      </section>}

      {step === 3 && <TestAll providers={configured} onChanged={changed} headingRef={headingRef} onBack={() => go(2)} onNext={() => go(4)} />}

      {step === 4 && <section aria-labelledby="sx-step-title">
        <h1 id="sx-step-title" ref={headingRef} tabIndex={-1}>Choose how SWARM picks models</h1>
        <p className="sx-lede">You can change this later in Settings → Model Routing.</p>
        <div className="sx-profiles" role="radiogroup" aria-label="Intelligence configuration">{INTELLIGENCE_PROFILES.map(id => <label key={id} className="sx-card sx-choice" data-selected={profile === id || undefined}>
          <input type="radio" name="sx-profile" checked={profile === id} onChange={() => setProfile(id)} />
          <div className="sx-card-head"><span className="sx-check sx-radio" aria-hidden>{profile === id && <Check size={13} />}</span><div className="sx-card-title"><h3>{PROFILE_LABELS[id].title}{id === 'recommended' && <span className="sx-pill">Default</span>}</h3><p>{PROFILE_LABELS[id].description}</p></div></div>
        </label>)}</div>
        {profile === 'custom' && <CustomOrder models={modelRows} primary={primary} setPrimary={setPrimary} fallbacks={fallbacks} setFallbacks={setFallbacks} />}
        <ModelTable rows={modelRows} loading={models.isLoading} error={models.isError} onRetry={() => void models.refetch()} />
        <div className="sx-actions sx-split">
          <button type="button" className="sx-button sx-ghost" onClick={() => go(3)}><ArrowLeft size={15} aria-hidden />Back</button>
          <button type="button" className="sx-button sx-primary" disabled={profile === 'custom' && !primary} onClick={() => go(5)}>Continue<ArrowRight size={15} aria-hidden /></button>
        </div>
      </section>}

      {step === 5 && <section aria-labelledby="sx-step-title">
        <div className="sx-done-mark"><Rocket size={26} aria-hidden /></div>
        <h1 id="sx-step-title" ref={headingRef} tabIndex={-1}>{connected.length ? "You're ready to build" : 'Almost there'}</h1>
        <p className="sx-lede">{connected.length ? 'Here is how SWARM is set up. You can change any of this in Settings.' : 'Launch now and connect a provider when you are ready.'}</p>
        <dl className="sx-summary">
          <div><dt>Connected providers</dt><dd>{connected.length ? connected.map(p => p.name).join(', ') : 'None yet'}</dd></div>
          {configured.length > connected.length && <div><dt>Saved, not yet verified</dt><dd>{configured.filter(p => p.status !== 'connected').map(p => `${p.name} (${p.status === 'rate_limited' ? 'rate limited' : 'needs a test'})`).join(', ')}</dd></div>}
          <div><dt>Intelligence</dt><dd>{PROFILE_LABELS[profile].title}</dd></div>
          <div><dt>Primary model</dt><dd>{profile === 'custom' && primary ? primary : 'Automatic — best available for each task'}</dd></div>
          <div><dt>Fallbacks</dt><dd>{profile === 'custom' ? (fallbacks.length ? fallbacks.join(' → ') : 'Automatic after your primary') : connected.length > 1 ? 'Automatic across your connected providers' : 'Connect a second provider for automatic fallback'}</dd></div>
          <div><dt>Models available</dt><dd>{modelRows.length || '—'}</dd></div>
        </dl>
        {!connected.length && <p className="sx-hint sx-hint-warn">No provider is verified yet. You can still launch; chat will ask you to connect a provider.</p>}
        <div className="sx-actions sx-split">
          <button type="button" className="sx-button sx-ghost" onClick={() => go(4)}><ArrowLeft size={15} aria-hidden />Back</button>
          <button type="button" className="sx-button sx-primary sx-lg" onClick={() => void persist(false)} disabled={!!saving}>{saving === 'finish' ? <Loader2 size={16} className="sx-spin" aria-hidden /> : <Rocket size={16} aria-hidden />}{saving === 'finish' ? 'Launching…' : 'Launch Swarm'}</button>
        </div>
      </section>}
      {error && <p className="sx-error" role="alert">{error}</p>}
    </main>
  </div>;
}

function TestAll({ providers, onChanged, headingRef, onBack, onNext }: { providers: ProviderStatusSummary[]; onChanged: (p: ProviderStatusSummary) => void; headingRef: React.RefObject<HTMLHeadingElement | null>; onBack: () => void; onNext: () => void }) {
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cache = useQueryClient();
  async function test(id: string) {
    setRunning(s => new Set(s).add(id)); setErrors(e => ({ ...e, [id]: '' }));
    try { const r = await providersApi.test(id); onChanged(r.provider); }
    catch (e) { setErrors(x => ({ ...x, [id]: e instanceof Error ? e.message : 'Test failed.' })); }
    finally { setRunning(s => { const n = new Set(s); n.delete(id); return n; }); }
  }
  // The server allows one test at a time per account, so run them in sequence.
  async function testAll() { for (const p of providers) await test(p.id); void cache.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY }); }
  const untested = providers.filter(p => !p.lastTest).length;
  useEffect(() => { if (untested) void testAll(); /* only on entry */ }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = providers.filter(p => p.status === 'connected').length;
  return <section aria-labelledby="sx-step-title">
    <h1 id="sx-step-title" ref={headingRef} tabIndex={-1}>Connection check</h1>
    <p className="sx-lede">{ONBOARDING_COPY.testNote}</p>
    <ul className="sx-test-list" aria-live="polite">{providers.map(p => {
      const busy = running.has(p.id);
      return <li key={p.id} className="sx-test-row">
        <ProviderLogo id={p.id} />
        <div className="sx-test-main"><b>{p.name}</b><span>{busy ? 'Sending one tiny test request…' : errors[p.id] || p.lastTest?.message || 'Not tested yet.'}</span></div>
        <StatusBadge status={busy ? 'checking' : p.status} />
        {!busy && p.status !== 'connected' && p.status === 'auth_failed' && <KeyPageLink provider={p}>New key</KeyPageLink>}
        <button type="button" className="sx-button sx-sm" disabled={busy || running.size > 0} onClick={() => void test(p.id)}><RefreshCw size={14} aria-hidden />Retry</button>
      </li>;
    })}</ul>
    <div className="sx-actions sx-split">
      <button type="button" className="sx-button sx-ghost" onClick={onBack}><ArrowLeft size={15} aria-hidden />Back</button>
      <div className="sx-actions">
        <button type="button" className="sx-button" disabled={running.size > 0} onClick={() => void testAll()}>Test all</button>
        <button type="button" className="sx-button sx-primary" disabled={running.size > 0} onClick={onNext}>{ok ? 'Continue' : 'Continue without a verified provider'}<ArrowRight size={15} aria-hidden /></button>
      </div>
    </div>
  </section>;
}

function ModelTable({ rows, loading, error, onRetry }: { rows: DiscoveredModelRow[]; loading: boolean; error: boolean; onRetry: () => void }) {
  const [all, setAll] = useState(false);
  if (loading) return <p className="sx-hint" role="status"><Loader2 size={14} className="sx-spin" aria-hidden /> Loading models from your providers…</p>;
  if (error) return <p className="sx-error" role="alert">Models could not load. <button type="button" className="sx-link" onClick={onRetry}>Try again</button></p>;
  if (!rows.length) return <p className="sx-hint">Models appear here after a provider is connected.</p>;
  const shown = all ? rows : rows.slice(0, 12);
  return <div className="sx-models">
    <h2><Sparkles size={15} aria-hidden /> {rows.length} model{rows.length === 1 ? '' : 's'} discovered</h2>
    <div className="sx-table-wrap"><table>
      <thead><tr><th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Context</th><th scope="col">Price</th></tr></thead>
      <tbody>{shown.map(m => { const price = freeLabel(m.freeStatus); return <tr key={m.id}>
        <td>{m.providerName}</td><td><code>{m.modelId}</code></td>
        <td>{m.contextLength ? `${Math.round(m.contextLength / 1000)}K tokens` : <span className="sx-muted">Not reported</span>}</td>
        <td><span className={`sx-price sx-price-${price}`}>{price === 'free' ? 'Free' : price === 'paid' ? 'Paid' : m.freeStatus === 'free_tier' ? 'Free tier (limits apply)' : 'Unknown'}</span></td>
      </tr>; })}</tbody>
    </table></div>
    {rows.length > 12 && <button type="button" className="sx-link" onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
  </div>;
}

function CustomOrder({ models, primary, setPrimary, fallbacks, setFallbacks }: { models: DiscoveredModelRow[]; primary: string; setPrimary: (v: string) => void; fallbacks: string[]; setFallbacks: (v: string[]) => void }) {
  const options = models.filter(m => m.id !== primary && !fallbacks.includes(m.id));
  const label = (id: string) => { const m = models.find(x => x.id === id); return m ? `${m.displayName} · ${m.providerName}` : id; };
  const move = (i: number, d: -1 | 1) => { const n = [...fallbacks]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setFallbacks(n); };
  return <div className="sx-panel sx-custom">
    <div className="sx-field"><label htmlFor="sx-primary">Primary model</label>
      <select id="sx-primary" value={primary} onChange={e => { setPrimary(e.target.value); setFallbacks(fallbacks.filter(f => f !== e.target.value)); }}>
        <option value="">Choose a model…</option>{models.map(m => <option key={m.id} value={m.id}>{label(m.id)}</option>)}
      </select></div>
    <div className="sx-field"><span className="sx-label">Fallback order</span>
      {fallbacks.length ? <ol className="sx-order">{fallbacks.map((id, i) => <li key={id}><span>{i + 1}. {label(id)}</span>
        <button type="button" className="sx-icon-button" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
        <button type="button" className="sx-icon-button" aria-label={`Move ${label(id)} down`} disabled={i === fallbacks.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
        <button type="button" className="sx-icon-button" aria-label={`Remove ${label(id)}`} onClick={() => setFallbacks(fallbacks.filter(f => f !== id))}><X size={14} /></button>
      </li>)}</ol> : <p className="sx-hint">No fallbacks yet. SWARM picks automatically after your primary.</p>}
      {fallbacks.length < 6 && options.length > 0 && <select aria-label="Add a fallback model" value="" onChange={e => { if (e.target.value) setFallbacks([...fallbacks, e.target.value]); }}>
        <option value="">Add a fallback…</option>{options.map(m => <option key={m.id} value={m.id}>{label(m.id)}</option>)}
      </select>}
    </div>
  </div>;
}
