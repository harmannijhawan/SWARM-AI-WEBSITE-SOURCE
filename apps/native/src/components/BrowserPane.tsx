import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bug, Camera, ExternalLink, Globe2, Monitor, RotateCw, Smartphone, Tablet, Terminal as TermIcon } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Empty, IconButton, Segmented, cx } from './ui';

type Vp = 'desktop' | 'tablet' | 'mobile';
interface WebviewEl extends HTMLElement {
  src: string;
  reload(): void; goBack(): void; goForward(): void; canGoBack(): boolean; canGoForward(): boolean;
  getURL(): string; loadURL(url: string): Promise<void>; openDevTools(): void; capturePage(): Promise<{ toDataURL(): string }>;
}
interface ConsoleLine { level: number; message: string; source: string; line: number; ts: number }

export function BrowserPane({ url, projectId, compact }: { url: string | null; projectId: string | null; compact?: boolean }) {
  const settings = useStore((s) => s.settings)!;
  const toast = useStore((s) => s.toast);
  const ref = useRef<WebviewEl | null>(null);
  const [addr, setAddr] = useState(url ?? '');
  const [current, setCurrent] = useState(url ?? '');
  const [vp, setVp] = useState<Vp>('desktop');
  const [loading, setLoading] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (url) { setAddr(url); setCurrent(url); } }, [url]);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const onStart = () => { setLoading(true); setError(null); };
    const onStop = () => { setLoading(false); try { setAddr(wv.getURL()); } catch { /* not ready */ } };
    const onFail = (e: Event) => { const ev = e as unknown as { errorCode: number; errorDescription: string; isMainFrame: boolean }; if (ev.isMainFrame && ev.errorCode !== -3) setError(`${ev.errorDescription} (${ev.errorCode})`); };
    const onConsole = (e: Event) => {
      // Electron has used both numeric (0-3) and string levels for this event; normalize.
      const ev = e as unknown as { level: number | string; message?: string; sourceId?: string; source?: string; line?: number; lineNumber?: number };
      const lvl = typeof ev.level === 'number' ? ev.level : ({ debug: 0, verbose: 0, info: 1, warning: 2, error: 3 } as Record<string, number>)[String(ev.level)] ?? 1;
      setLines((l) => [...l, { level: lvl, message: String(ev.message ?? ''), source: String(ev.sourceId ?? ev.source ?? ''), line: Number(ev.line ?? ev.lineNumber ?? 0), ts: Date.now() }].slice(-300));
    };
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-stop-loading', onStop);
    wv.addEventListener('did-fail-load', onFail);
    wv.addEventListener('console-message', onConsole);
    return () => {
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-stop-loading', onStop);
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('console-message', onConsole);
    };
  }, [current]);

  const go = (u: string) => {
    let next = u.trim();
    if (!next) return;
    if (!/^https?:\/\//.test(next)) next = (/^(localhost|127\.)/.test(next) ? 'http://' : 'https://') + next;
    setCurrent(next); setAddr(next); setLines([]);
    ref.current?.loadURL(next).catch(() => undefined);
  };

  const shot = async () => {
    if (!ref.current || !projectId) return;
    const img = await ref.current.capturePage();
    const s = await api.runs.saveScreenshot(projectId, img.toDataURL(), addr);
    toast({ level: 'success', title: 'Screenshot saved', body: s.path });
  };

  const widths: Record<Vp, number | null> = { desktop: null, tablet: settings.browser.tablet[0], mobile: settings.browser.mobile[0] };
  const errors = lines.filter((l) => l.level >= 3).length;

  if (!current) {
    return <Empty icon={Globe2} title="Nothing to preview yet" body="When the Tester starts the app, the live preview appears here automatically." />;
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-2 h-10 border-b border-line shrink-0">
        <IconButton icon={ArrowLeft} label="Back" size="sm" onClick={() => ref.current?.canGoBack() && ref.current.goBack()} />
        <IconButton icon={ArrowRight} label="Forward" size="sm" onClick={() => ref.current?.canGoForward() && ref.current.goForward()} />
        <IconButton icon={RotateCw} label="Reload" size="sm" onClick={() => ref.current?.reload()} className={loading ? 'anim-spin' : ''} />
        <form className="flex-1 min-w-0" onSubmit={(e) => { e.preventDefault(); go(addr); }}>
          <input aria-label="Address" value={addr} onChange={(e) => setAddr(e.target.value)} className="w-full h-7 px-2.5 rounded-md bg-sunken border border-line text-[0.74rem] mono text-fg-2 focus:text-fg focus:border-accent" />
        </form>
        {!compact && <Segmented size="sm" value={vp} onChange={setVp} label="Viewport" options={[{ value: 'desktop', label: '', icon: Monitor }, { value: 'tablet', label: '', icon: Tablet }, { value: 'mobile', label: '', icon: Smartphone }]} />}
        <IconButton icon={Camera} label="Screenshot" size="sm" onClick={shot} />
        <IconButton icon={TermIcon} label={`Console${errors ? ` (${errors} errors)` : ''}`} size="sm" active={consoleOpen} onClick={() => setConsoleOpen((v) => !v)} className={errors ? 'text-err' : ''} />
        <IconButton icon={Bug} label="Open DevTools" size="sm" onClick={() => ref.current?.openDevTools()} />
        <IconButton icon={ExternalLink} label="Open in system browser" size="sm" onClick={() => api.openExternal(addr).catch((e) => toast({ level: 'error', title: 'Cannot open', body: String(e.message) }))} />
      </div>
      <div className="flex-1 min-h-0 bg-sunken flex justify-center overflow-auto relative">
        <div className={cx('h-full bg-white ', !!widths[vp] && 'border-x border-line shadow-soft')} style={{ width: widths[vp] ?? '100%' }}>
          <webview ref={ref as never} src={current} partition="persist:swarm-preview" style={{ width: '100%', height: '100%', display: 'flex' }} />
        </div>
        {error && <div className="absolute inset-x-0 top-0 m-3 p-3 rounded-lg bg-err-soft text-err text-[0.75rem] border border-err/30">Could not load {addr}: {error}</div>}
      </div>
      {consoleOpen && (
        <div className="h-40 border-t border-line overflow-y-auto bg-panel shrink-0">
          {lines.length ? lines.map((l, i) => (
            <div key={i} className={cx('px-3 py-1 border-b border-line/60 mono text-[0.7rem] selectable', l.level >= 3 ? 'text-err' : l.level === 2 ? 'text-warn' : 'text-fg-2')}>
              {l.message}<span className="text-fg-3"> — {l.source.split('/').pop()}:{l.line}</span>
            </div>
          )) : <div className="p-3 text-[0.72rem] text-fg-3">No console output from this page.</div>}
        </div>
      )}
    </div>
  );
}
