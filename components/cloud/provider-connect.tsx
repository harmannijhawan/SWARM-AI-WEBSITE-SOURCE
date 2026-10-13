'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, ClipboardPaste, ExternalLink, Eye, EyeOff, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { ONBOARDING_COPY, STATUS_LABELS, catalogEntry, keyFormatWarning, statusTone, type ConnectionStatus, type ProviderStatusSummary } from '@/shared/providers';
import { ApiError, providersApi, type TestResponse } from './provider-api';

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  return <span className={`sx-badge sx-tone-${statusTone(status)}`}>{status === 'checking' ? <Loader2 size={12} className="sx-spin" aria-hidden /> : <i aria-hidden />}{STATUS_LABELS[status]}</span>;
}

/** Opens the hard-coded, allowlisted key page in a new tab. */
export function KeyPageLink({ provider, children, primary, onOpen }: { provider: ProviderStatusSummary; children?: ReactNode; primary?: boolean; onOpen?: () => void }) {
  return <a className={primary ? 'sx-button sx-primary' : 'sx-link'} href={provider.keyUrl} target="_blank" rel="noopener noreferrer" onClick={onOpen}>
    {children ?? 'Get API Key'}<ExternalLink size={14} aria-hidden /><span className="sr-only"> (opens {provider.name} in a new tab)</span>
  </a>;
}

function SecretInput({ id, label, value, onChange, onPasted, disabled, placeholder, inputRef }: {
  id: string; label: string; value: string; onChange: (v: string) => void; onPasted?: (v: string) => void;
  disabled?: boolean; placeholder?: string; inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [visible, setVisible] = useState(false);
  const [pasteError, setPasteError] = useState('');
  async function paste() {
    setPasteError('');
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) { setPasteError('Your clipboard is empty. Copy the key on the provider page first.'); return; }
      onChange(text); onPasted?.(text);
    } catch { setPasteError('Your browser blocked clipboard access. Click the field and press Ctrl+V (⌘V on Mac).'); }
  }
  return <div className="sx-field">
    <label htmlFor={id}>{label}</label>
    <div className="sx-secret">
      <input ref={inputRef} id={id} type={visible ? 'text' : 'password'} value={value} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        onPaste={e => { const text = e.clipboardData.getData('text').trim(); if (text) { e.preventDefault(); onChange(text); onPasted?.(text); } }}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder={placeholder} data-1p-ignore data-lpignore="true" />
      <button type="button" className="sx-icon-button" aria-pressed={visible} aria-label={visible ? 'Hide key' : 'Show key'} title={visible ? 'Hide key' : 'Show key'} onClick={() => setVisible(v => !v)} disabled={disabled || !value}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
      <button type="button" className="sx-icon-button" aria-label="Clear key" title="Clear" onClick={() => onChange('')} disabled={disabled || !value}><X size={16} /></button>
      <button type="button" className="sx-paste" onClick={() => void paste()} disabled={disabled}><ClipboardPaste size={15} aria-hidden />Paste</button>
    </div>
    {pasteError && <p className="sx-hint sx-hint-warn" role="alert">{pasteError}</p>}
  </div>;
}

type Busy = null | 'connect' | 'test' | 'save' | 'remove';
/** Statuses where the key itself is likely valid, so keeping it is reasonable. */
const SAVEABLE: ConnectionStatus[] = ['connected', 'rate_limited', 'network_error'];

/**
 * One-step connect: paste a key and press Connect. SWARM tests it with one tiny request and,
 * when it works, saves it to the encrypted account vault. Saved keys can be re-tested, replaced or removed.
 */
export function ConnectForm({ provider, onChanged, onConnected, autoFocus }: {
  provider: ProviderStatusSummary; onChanged: (next: ProviderStatusSummary) => void; onConnected?: (next: ProviderStatusSummary) => void; autoFocus?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const entry = catalogEntry(provider.id);
  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(!provider.configured);
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [openedKeyPage, setOpenedKeyPage] = useState(false);
  const trimmed = key.trim();
  const warning = trimmed ? keyFormatWarning(provider.id, trimmed) : null;

  useEffect(() => { setReplacing(!provider.configured); }, [provider.configured]);
  useEffect(() => { if (autoFocus && !provider.configured) inputRef.current?.focus(); }, [autoFocus, provider.configured]);
  // When the user comes back from the provider's key page, put the cursor in the key field.
  useEffect(() => {
    if (!openedKeyPage) return;
    const back = () => { if (document.visibilityState === 'visible') { inputRef.current?.focus(); setOpenedKeyPage(false); } };
    window.addEventListener('focus', back); document.addEventListener('visibilitychange', back);
    return () => { window.removeEventListener('focus', back); document.removeEventListener('visibilitychange', back); };
  }, [openedKeyPage]);

  const message = (e: unknown) => e instanceof ApiError || e instanceof Error ? e.message : 'The request failed. Try again.';

  async function connect(candidate = trimmed) {
    if (!candidate || busy) return;
    setBusy('connect'); setError(''); setNotice(''); setResult(null);
    try {
      const tested = await providersApi.test(provider.id, candidate);
      setResult(tested);
      if (SAVEABLE.includes(tested.status)) {
        const saved = await providersApi.save(provider.id, candidate);
        setKey(''); setReplacing(false);
        // The saved summary only carries the test if it matched this exact key; reuse the result we just got.
        const next = { ...saved, status: tested.status, lastTest: saved.lastTest ?? tested, models: tested.models };
        onChanged(next);
        if (tested.status === 'connected') { setNotice(`${provider.name} is connected and your key is saved.`); onConnected?.(next); }
        else setNotice('Your key is saved. SWARM will use it as soon as the provider responds normally.');
      }
    } catch (e) { setError(message(e)); }
    finally { setBusy(null); }
  }
  async function retest() {
    setBusy('test'); setError(''); setNotice('');
    try { const tested = await providersApi.test(provider.id); setResult(tested); onChanged(tested.provider); if (tested.status === 'connected') onConnected?.(tested.provider); }
    catch (e) { setError(message(e)); }
    finally { setBusy(null); }
  }
  async function saveAnyway() {
    setBusy('save'); setError('');
    try { const saved = await providersApi.save(provider.id, trimmed); setKey(''); setReplacing(false); onChanged(saved); setNotice('Key saved without a successful test. Run the test again later.'); }
    catch (e) { setError(message(e)); }
    finally { setBusy(null); }
  }
  async function remove() {
    if (!window.confirm(`Remove your ${provider.name} key from SWARM? You can add it again at any time.`)) return;
    setBusy('remove'); setError(''); setNotice('');
    try { const removed = await providersApi.remove(provider.id); setResult(null); setReplacing(true); onChanged(removed.provider); setNotice('Key removed from your account vault.'); }
    catch (e) { setError(message(e)); }
    finally { setBusy(null); }
  }

  const shown = result ?? (provider.lastTest ? { ...provider.lastTest, provider } : null);
  const failedNewKey = result && trimmed && !SAVEABLE.includes(result.status);
  return <div className="sx-connect">
    {replacing ? <>
      <ol className="sx-guide">
        <li>
          <div><b>Get your key</b><span>Opens {provider.name} in a new tab. Your SWARM progress stays here.</span></div>
          <KeyPageLink provider={provider} primary={!trimmed} onOpen={() => setOpenedKeyPage(true)}>Open {provider.name}</KeyPageLink>
          {entry && <ul className="sx-substeps">{entry.steps.map(step => <li key={step}>{step}</li>)}</ul>}
          {provider.notes && provider.id === 'huggingface' && <p className="sx-hint">{provider.notes}</p>}
        </li>
        <li>
          <div><b>Paste it here</b><span>Pasting connects automatically.</span></div>
          <SecretInput id={inputId} inputRef={inputRef} label={`${provider.name} API key`} value={key} onChange={v => { setKey(v); setResult(null); }} onPasted={v => void connect(v)} disabled={!!busy}
            placeholder={entry?.keyPrefix ? `${entry.keyPrefix}…` : 'Paste your API key'} />
          {warning && <p className="sx-hint sx-hint-warn">{warning}</p>}
        </li>
      </ol>
      <div className="sx-actions">
        <button type="button" className="sx-button sx-primary" disabled={!!busy || !trimmed} onClick={() => void connect()}>
          {busy === 'connect' ? <Loader2 size={15} className="sx-spin" aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}{busy === 'connect' ? 'Connecting…' : `Connect ${provider.name}`}
        </button>
        {failedNewKey && result!.status !== 'auth_failed' && <button type="button" className="sx-button" disabled={!!busy} onClick={() => void saveAnyway()}>Save anyway</button>}
        {provider.configured && <button type="button" className="sx-button sx-ghost" disabled={!!busy} onClick={() => { setReplacing(false); setKey(''); setResult(null); }}>Keep saved key</button>}
      </div>
      <p className="sx-hint">{ONBOARDING_COPY.testNote} Your key is encrypted in your account vault and never shown again — only its last 4 characters.</p>
    </> : <>
      <div className="sx-saved">
        <div><span className="sx-saved-label">Saved key</span><code>{provider.hint}</code></div>
        <div className="sx-actions">
          <button type="button" className="sx-button" disabled={!!busy} onClick={() => void retest()}>{busy === 'test' ? <Loader2 size={15} className="sx-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}{busy === 'test' ? 'Testing…' : 'Test again'}</button>
          <button type="button" className="sx-button" disabled={!!busy} onClick={() => { setReplacing(true); setResult(null); }}>Replace key</button>
          <button type="button" className="sx-button sx-danger" disabled={!!busy} onClick={() => void remove()}>{busy === 'remove' ? <Loader2 size={15} className="sx-spin" aria-hidden /> : <Trash2 size={15} aria-hidden />}Remove</button>
        </div>
      </div>
    </>}
    <div className="sx-result" role="status" aria-live="polite" aria-busy={busy === 'connect' || busy === 'test'}>
      {busy === 'connect' || busy === 'test' ? <><StatusBadge status="checking" /><span>Checking your key and sending one tiny test request…</span></>
        : shown ? <><StatusBadge status={shown.status} /><span>{shown.message}</span></> : null}
      {!busy && notice && <span className="sx-notice">{notice}</span>}
      {!busy && result?.status === 'auth_failed' && <span className="sx-hint">Copy the key again from the {provider.name} page — the most common cause is a missing character.</span>}
    </div>
    {error && <p className="sx-error" role="alert">{error}</p>}
  </div>;
}

export function ProviderCard({ provider, onChanged, defaultOpen = false }: { provider: ProviderStatusSummary; onChanged: (next: ProviderStatusSummary) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const entry = catalogEntry(provider.id);
  return <article className="sx-card" data-status={provider.status} data-open={open || undefined}>
    <header className="sx-card-head">
      <ProviderLogo id={provider.id} />
      <div className="sx-card-title"><h3>{provider.name}</h3><p>{provider.description}</p></div>
      <StatusBadge status={provider.status} />
    </header>
    <dl className="sx-meta">
      {entry?.tag && <div><dt>Plan</dt><dd>{entry.tag}</dd></div>}
      {provider.configured && <div><dt>Key</dt><dd><code>{provider.hint}</code></dd></div>}
      {provider.lastTest && <div><dt>Models</dt><dd>{provider.lastTest.models}</dd></div>}
      {provider.lastTest?.latencyMs != null && <div><dt>Latency</dt><dd>{provider.lastTest.latencyMs} ms</dd></div>}
      {!provider.configured && provider.managed && <div><dt>Access</dt><dd>SWARM-managed fallback</dd></div>}
    </dl>
    <div className="sx-actions">
      <button type="button" className={provider.configured ? 'sx-button' : 'sx-button sx-primary'} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}>{open ? 'Close' : provider.configured ? 'Manage' : 'Connect'}</button>
      {!open && <KeyPageLink provider={provider} />}
    </div>
    {open && <div id={panelId} className="sx-card-body"><ConnectForm provider={provider} onChanged={onChanged} autoFocus /></div>}
  </article>;
}

/** Text monogram in the provider's own brand colour; we do not ship third-party logo files. */
export function ProviderLogo({ id }: { id: string }) {
  const letters: Record<string, string> = { google: 'G', groq: 'gq', mistral: 'M', huggingface: 'HF', nvidia: 'NV', openrouter: 'OR' };
  return <span className={`sx-logo sx-logo-${id}`} aria-hidden>{letters[id] ?? id.slice(0, 2).toUpperCase()}</span>;
}
