import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, QrCode, RefreshCw, Smartphone, Trash2, X } from 'lucide-react';
import type { AllowNetworksResult, PairingCode, RemoteState } from '../../electron/remote/state';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { timeAgo } from '../lib/format';
import { Badge, Button, Dot, Input, Spinner, Toggle, type Tone } from '../components/ui';
import './phone.css';

const ROUTE_NOTE: Record<string, string> = {
  lan: 'Works when your phone is on the same Wi-Fi or network as this PC.',
  ipv6: 'A public IPv6 address lets a phone connect from anywhere.',
  upnp: 'Your router forwards an outside port to this PC automatically.',
  manual: 'An address you set up yourself (for example a port you forward on your router).',
  connectivity: 'Additional connection methods.',
};
const stateTone = (s: string): Tone => (s === 'ready' ? 'ok' : s === 'pending' ? 'info' : s === 'failed' ? 'warn' : 'neutral');
const stateText = (s: string) => (s === 'ready' ? 'Available' : s === 'pending' ? 'Checking…' : s === 'failed' ? 'Failed' : s === 'unavailable' ? 'Not available' : 'Off');

export function PhoneSetup({ embedded = false }: { embedded?: boolean }) {
  const toast = useStore((s) => s.toast);
  const [st, setSt] = useState<RemoteState | null>(null);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [manualDirty, setManualDirty] = useState(false);
  const [port, setPort] = useState('');
  const [netMsg, setNetMsg] = useState<string | null>(null);

  const apply = useCallback((s: RemoteState) => {
    setSt(s);
    setManual((m) => (manualDirty ? m : s.manualHost));
    setPort((p) => p || String(s.port));
  }, [manualDirty]);

  useEffect(() => {
    let alive = true;
    const load = () => api.remote.state().then((s) => alive && apply(s)).catch(() => undefined);
    void load();
    const off = window.swarm.on('remote:changed', (p) => { if (alive) apply(p as RemoteState); });
    const poll = setInterval(load, 3000); // route status (UPnP etc.) changes without events
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => { alive = false; off(); clearInterval(poll); clearInterval(tick); };
  }, [apply]);

  const run = async <T,>(fn: () => Promise<T>, ok?: (v: T) => void) => {
    setBusy(true);
    try { const v = await fn(); ok?.(v); } catch (e) { toast({ level: 'error', title: 'Phone connection', body: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const toggle = (on: boolean) => run(() => api.remote.enable(on), (s) => { apply(s); if (!on) setCode(null); });
  const generate = () => run(() => api.remote.generatePairing(), (c) => setCode(c));

  const allowNetworks = () => run(() => api.remote.allowOtherNetworks(), (r: AllowNetworksResult) => {
    apply(r.state);
    setNetMsg(r.ok ? 'Allowed' : r.denied ? 'Permission was declined' : r.error ? "Could not allow: ${r.error}" : 'Could not allow');
  });

  if (!st) return <div className="ph-root"><Spinner /></div>;

  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  const expired = !!code && (left <= 0 || !st.running || !st.pairing.active || st.pairing.expiresAt !== code.expiresAt);
  const paired = st.devices;

  return (
    <div className={embedded ? 'ph-root ph-embedded' : 'ph-root'}>
      <div className="ph-head">
        <div className="ph-title"><Smartphone size={18} /> <h1>Set up your phone</h1></div>
        <p className="ph-sub">Control your agents from the SWARM companion app. The connection is encrypted and goes straight from your phone to this PC.</p>
      </div>

      <section className="ph-card">
        <div className="ph-row">
          <div>
            <div className="ph-label">Allow phone connections</div>
            <div className="ph-hint">{st.running ? `Listening on port ${st.port}` : 'Off. Nothing is listening until you turn this on.'}</div>
          </div>
          <Toggle checked={st.enabled && st.running} onChange={(v) => void toggle(v)} label="Allow phone connections" disabled={busy} />
        </div>
        {st.error && <div className="ph-error" role="alert">{st.error}</div>}
      </section>

      {st.pendingPair && (
        <section className="ph-card ph-confirm" role="alertdialog" aria-label="Confirm pairing">
          <div className="ph-label">Pair “{st.pendingPair.deviceName}”?</div>
          <div className="ph-hint">Check that this code is also shown on your phone.</div>
          <div className="ph-code">{st.pendingPair.code.slice(0, 3)} {st.pendingPair.code.slice(3)}</div>
          <div className="ph-actions">
            <Button variant="primary" icon={Check} onClick={() => void run(() => api.remote.confirmPair(st.pendingPair!.id, true), apply)}>Pair</Button>
            <Button variant="secondary" icon={X} onClick={() => void run(() => api.remote.confirmPair(st.pendingPair!.id, false), apply)}>Decline</Button>
          </div>
        </section>
      )}

      <section className="ph-card">
        <div className="ph-grid">
          <div className="ph-qrbox">
            {code && !expired ? <img className="ph-qr" src={code.dataUrl} alt="Pairing QR code" width={220} height={220} />
              : <div className="ph-qr ph-qr-empty"><QrCode size={48} strokeWidth={1.2} /><span>{expired ? 'Code expired' : st.running ? 'No code yet' : 'Turn on to pair'}</span></div>}
            <div className="ph-count" aria-live="polite">{code && !expired ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '\u00A0'}</div>
            <Button variant="primary" icon={RefreshCw} disabled={!st.running || busy} onClick={() => void generate()}>{code ? 'Generate new code' : 'Generate pairing code'}</Button>
          </div>
          <ol className="ph-steps">
            <li><b>Install</b> the SWARM companion app on your Android phone.</li>
            <li><b>Open</b> it and choose “Add a PC”.</li>
            <li><b>Scan</b> the QR code, or choose “Enter Manually” on your phone and paste the pairing text below. It works once and expires after 2 minutes.</li>
            <li><b>Confirm</b> the pairing here when asked.</li>
          </ol>
        </div>
        {code && !expired && (
          <div className="ph-manual-pairing">
            <label className="ph-label" htmlFor="phone-pairing-text">Manual pairing code</label>
            <div className="ph-hint">Copy the entire text and paste it into “Enter Manually” on your phone.</div>
            <textarea id="phone-pairing-text" className="ph-pairing-text" readOnly value={code.payload} rows={4} onFocus={(e) => e.currentTarget.select()} />
            <Button variant="secondary" icon={Copy} disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(code.payload), () => toast({ level: 'success', title: 'Pairing code copied' }))}>Copy pairing code</Button>
          </div>
        )}
      </section>

      <section className="ph-card">
        <div className="ph-label">Connection routes</div>
        <div className="ph-hint">Your phone tries these in order. To connect away from home, this PC must be reachable from outside: a public IPv6 address, a mapped port, or a port you forward yourself.</div>
        <ul className="ph-routes">
          {st.routes.length === 0 && <li className="ph-hint">Turn on phone connections to see routes.</li>}
          {st.routes.map((r) => (
            <li key={r.id} className="ph-route">
              <Dot tone={stateTone(r.state)} />
              <div className="ph-route-main">
                <div className="ph-route-name">{r.label} <Badge tone={stateTone(r.state)}>{stateText(r.state)}</Badge>{r.inUse && <Badge tone="accent">In use</Badge>}{!r.inUse && r.likely && <Badge tone="info">Likely</Badge>}</div>
                <div className="ph-hint">{r.detail}. {ROUTE_NOTE[r.id] ?? ''}</div>
                {r.endpoints.length > 0 && <div className="ph-mono">{r.endpoints.join('   ')}</div>}
              </div>
            </li>
          ))}
        </ul>
        <div className="ph-form">
          <label className="ph-field"><span>Manual address (host:port)</span>
            <Input value={manual} placeholder="pc.example.org:47821" onChange={(e) => { setManual(e.target.value); setManualDirty(true); }} aria-label="Manual address" /></label>
          <Button variant="secondary" disabled={busy || !manualDirty} onClick={() => void run(() => api.remote.setManualHost(manual), (s) => { setManualDirty(false); apply(s); })}>Save</Button>
          <label className="ph-field ph-port"><span>Port</span>
            <Input value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} aria-label="Port" /></label>
          <Button variant="secondary" disabled={busy || port === String(st.port)} onClick={() => void run(() => api.remote.setPort(Number(port)), (s) => { setPort(String(s.port)); apply(s); })}>Apply</Button>
        </div>
      </section>

      {st.otherNetworks.available && (
        <section className="ph-card">
          <div className="ph-row">
            <div>
              <div className="ph-label">Other networks</div>
              <div className="ph-hint">Lets phones outside your home network reach this PC by adding a one-time Windows Firewall rule for port {st.port}. Windows will ask for permission once.</div>
              <div className="ph-hint ph-status" aria-live="polite">
                {netMsg ?? (st.otherNetworks.firewall === 'allowed' ? 'Allowed' : st.otherNetworks.firewall === 'missing' ? 'Not allowed yet' : 'Status unknown')}
              </div>
            </div>
            <Button variant="secondary" disabled={busy || (st.otherNetworks.firewall === 'allowed' && !netMsg)} onClick={() => void allowNetworks()}>Allow connections from other networks</Button>
          </div>
        </section>
      )}

      <section className="ph-card">
        <div className="ph-label">Paired phones</div>
        {paired.length === 0 ? <div className="ph-hint">No phones paired yet.</div> : (
          <ul className="ph-devices">
            {paired.map((d) => (
              <li key={d.id} className="ph-device">
                <Smartphone size={16} />
                <div className="ph-route-main">
                  <div className="ph-route-name">{d.name}</div>
                  <div className="ph-hint">Paired {timeAgo(d.pairedAt)}{d.lastSeen ? ` · last seen ${timeAgo(d.lastSeen)}` : ' · not connected yet'}</div>
                </div>
                <Button variant="danger" size="sm" icon={Trash2} disabled={busy} onClick={() => void run(() => api.remote.revokeDevice(d.id), apply)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
