'use client';
import { useEffect, useState } from 'react';
import { getAuthToken } from '@/lib/cloud-api/custom-fetch';

async function call(path: string, body?: unknown) {
  const token = await getAuthToken();
  const response = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();if (!response.ok) throw new Error(data.error || 'SWARM service is unavailable.');return data;
}
let sdk: Promise<void> | undefined;
function loadCheckout() {
  return sdk ||= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');script.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';script.onload = () => resolve();script.onerror = () => { sdk = undefined;reject(new Error('Cashfree checkout could not load.')); };document.head.append(script);
  });
}
export function ManagedAccount({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<any>(null), [history, setHistory] = useState<any[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [phone, setPhone] = useState('');
  const [requestId, setRequestId] = useState('');
  async function load() { const data = await call('account/entitlements');setState(data);if (!compact) setHistory((await call('billing/history')).transactions); }
  useEffect(() => { let live = true;const refresh = () => { if (live) void load().catch(e => setError(e.message)); };refresh();window.addEventListener('swarm:usage', refresh);window.addEventListener('focus', refresh);return () => { live = false;window.removeEventListener('swarm:usage', refresh);window.removeEventListener('focus', refresh); }; }, [compact]);
  async function action(fn: () => Promise<void>) { setBusy(true);setError('');try { await fn();await load(); } catch (e) { setError(e instanceof Error ? e.message : 'SWARM could not complete this request.'); } finally { setBusy(false); } }
  async function verify(id: string) { await call('billing/verify', { orderId: id }); }
  useEffect(() => { if (compact) return;const id = new URLSearchParams(location.search).get('order_id');if (id) void action(() => verify(id)); }, []);
  async function upgrade() {
    const id = requestId || crypto.randomUUID();setRequestId(id);
    const order = await call('billing/checkout', { plan: 'pro', phone, requestId: id });
    await loadCheckout();
    const factory = (window as any).Cashfree;
    if (!['sandbox','production'].includes(order.mode)) throw new Error('Invalid checkout environment.');
    if (!factory) throw new Error('Cashfree checkout is unavailable.');
    await factory({ mode: order.mode }).checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: '_modal' });
    await verify(order.orderId);setRequestId('');
  }
  return <section className="rounded-xl border border-border bg-card p-4 space-y-3" aria-label="SWARM plan and usage">
    {!state ? <p role="status">Loading SWARM account…</p> : <>
      <div className="flex flex-wrap justify-between gap-2"><strong>{state.plan.id === 'pro' ? 'SWARM Pro' : 'SWARM Free'}</strong><span className="text-xs">Builds {state.builds.used} / {state.builds.limit ?? 'pending configuration'} · Chats {state.chats.used} / {state.chats.limit ?? 'pending configuration'}</span></div>
      <p className="text-xs text-muted-foreground">Allowance resets {new Date(state.resetsAt).toLocaleDateString()}{state.plan.id === 'pro' ? ' · Pro expires ' + new Date(state.account.pro_until).toLocaleDateString() : ''}</p>
      <div className="flex flex-wrap gap-3"><label className="text-xs">Model profile <select disabled={busy} value={state.account.profile} onChange={e => void action(async () => { await call('account/model-preferences', { profile: e.target.value, speed: state.account.speed }); })}>{(state.profiles || []).map((p: any) => <option key={p.id} value={p.id} disabled={!p.available || !p.eligible}>{p.name}{!p.eligible ? ' · Pro required' : !p.available ? ' · unavailable' : ''}</option>)}</select></label><label className="text-xs">Generation <select disabled={busy} value={state.account.speed} onChange={e => void action(async () => { await call('account/model-preferences', { profile: state.account.profile, speed: e.target.value }); })}>{['fast','balanced','quality'].map(v => <option key={v}>{v}</option>)}</select></label></div>
      {!compact && <><p className="text-sm">SWARM manages AI access. Your account and preferences work across web and desktop without provider API keys. Prompts are processed by the configured third-party AI providers.</p>
        <h3 className="font-semibold">Pro · {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((state.catalog.pro.price || 0) / 100)} / {state.catalog.pro.accessDays} days</h3>
        <p className="text-xs">Manual renewal; no automatic recurring charges. Fair-use limits: {state.catalog.pro.builds ?? 'build allowance pending configuration'} builds and {state.catalog.pro.chats ?? 'chat allowance pending configuration'} chats per {state.catalog.pro.days} days. Premium requires a configured eligible model. </p>
        <label className="block text-sm">Mobile number for checkout <input aria-label="Checkout mobile number" type="tel" value={phone} onChange={e => setPhone(e.target.value)} maxLength={10} className="border rounded p-2" /></label>
        <button type="button" className="rounded-lg border px-4 py-2" disabled={busy || !state.checkoutAvailable || !/^[6-9][0-9]{9}$/.test(phone)} onClick={() => void action(upgrade)}>{busy ? 'Please wait…' : (state.billingMode === 'sandbox' ? 'Upgrade with Cashfree (sandbox)' : 'Upgrade with Cashfree')}</button>
        {!state.checkoutAvailable && <p role="status" className="text-xs">Checkout is awaiting SWARM merchant or fair-use configuration.</p>}
        <h3 className="font-semibold">Transaction history</h3>{!history.length && <p className="text-sm">No transactions yet.</p>}
        {history.map(t => <div key={t.id} className="border-t py-2 text-xs break-all"><p>{t.id} · ₹{(t.amount / 100).toFixed(2)} INR · {t.status}</p><p>{new Date(t.created).toLocaleString()}{t.payment ? ' · Payment ' + t.payment : ''}</p>{t.status !== 'paid' && <button type="button" disabled={busy} onClick={() => void action(() => verify(t.id))}>Check payment status</button>}</div>)}
      </>}
    </>}{error && <p role="alert" className="text-sm text-red-600">{error} <button type="button" disabled={busy} onClick={() => void action(load)}>Retry</button></p>}
  </section>;
}
