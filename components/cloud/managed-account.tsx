'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { BillingView } from './billing-view';
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
  const [paymentNotice,setPaymentNotice]=useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const handledUpgradeLink = useRef(false);
  useEffect(() => {
    if (state && !handledUpgradeLink.current) {
      handledUpgradeLink.current = true;
      if (new URLSearchParams(window.location.search).get('upgrade') === 'pro' && !state.unlimited) setUpgradeOpen(true);
    }
  }, [state]);
  useEffect(() => {
    const open = () => { if (state && !state.unlimited && state.plan.id !== 'pro') setUpgradeOpen(true); };
    window.addEventListener('swarm:upgrade', open);
    return () => window.removeEventListener('swarm:upgrade', open);
  }, [state]);
  useEffect(() => {
    if (upgradeOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [upgradeOpen]);
  async function load() { 
    try {
      const data = await call('account/entitlements');
      setState(data);
      window.dispatchEvent(new CustomEvent('swarm:entitlements', { detail: data }));
      if (!compact) setHistory((await call('billing/history')).transactions);
      setError(''); // Clear error on success
      setRetryCount(0);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'SWARM service is unavailable.';
      setError(message);
      throw e; // Re-throw to let caller handle
    }
  }
  useEffect(() => { 
    let live = true;
    const refresh = () => { 
      if (live) {
        void load().catch(e => {
          if (live) {
            const message = e instanceof Error ? e.message : 'SWARM service is unavailable.';
            setError(message);
          }
        });
      }
    };
    refresh();
    window.addEventListener('swarm:usage', refresh);
    window.addEventListener('focus', refresh);
    return () => { 
      live = false;
      window.removeEventListener('swarm:usage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [compact, retryCount]);
  async function action(fn: () => Promise<void>) { setBusy(true);setError('');try { await fn();await load(); } catch (e) { setError(e instanceof Error ? e.message : 'SWARM could not complete this request.'); } finally { setBusy(false); } }
  async function verify(id: string) { const result=await call('billing/verify',{orderId:id});setPaymentNotice(result?.status==='paid'?'Payment verified. Your plan reflects the server-confirmed payment.':result?.status==='failed'?'Payment failed. Review this transaction before trying again.':result?.status==='cancelled'?'Checkout was cancelled. No verified upgrade was recorded.':'Payment confirmation is pending. Check this transaction again shortly.'); }
  useEffect(() => { if (compact) return;const id = new URLSearchParams(location.search).get('order_id');if (id) void action(() => verify(id)); }, []);
  async function upgrade() {
    const id = requestId || crypto.randomUUID();setRequestId(id);
    const order = await call('billing/checkout', { plan: 'pro', phone, requestId: id });
    await loadCheckout();
    const factory = (window as any).Cashfree;
    if (!['sandbox','production'].includes(order.mode)) throw new Error('Invalid checkout environment.');
    if (!factory) throw new Error('Cashfree checkout is unavailable.');
    // Native dialogs occupy the top layer and would obscure Cashfree's modal.
    dialogRef.current?.close();setUpgradeOpen(false);
    await factory({ mode: order.mode }).checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: '_modal' });
    await verify(order.orderId);setRequestId('');setUpgradeOpen(false);
    window.dispatchEvent(new Event('swarm:usage'));
  }
  return <BillingView paymentNotice={paymentNotice} state={state} history={history} error={error} busy={busy} compact={compact} phone={phone} setPhone={setPhone} setUpgradeOpen={setUpgradeOpen} dialogRef={dialogRef} retry={()=>{setRetryCount(c=>c+1);setError('');}} action={action} load={load} verify={verify} upgrade={upgrade} preferences={async(profile,speed)=>{await call('account/model-preferences',{profile,speed});}}/>;
}

export function PlanUpgradeButton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let live = true;
    void call('account/entitlements').then(state => { if(live) setVisible(!state.unlimited && state.plan.id === 'free'); }).catch(() => {});
    const update = (event: Event) => { const state = (event as CustomEvent).detail; setVisible(!state.unlimited && state.plan.id === 'free'); };
    window.addEventListener('swarm:entitlements', update);
    return () => { live = false; window.removeEventListener('swarm:entitlements', update); };
  }, []);
  if (!visible) return null;
  return <button type="button" onClick={() => window.dispatchEvent(new Event('swarm:upgrade'))} className="m-3 flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left text-blue-950"><span><strong className="block text-xs">Upgrade to Pro</strong><span className="text-[11px]">More usage · SWARM SWE Fast</span></span><Sparkles size={18}/></button>;
}
