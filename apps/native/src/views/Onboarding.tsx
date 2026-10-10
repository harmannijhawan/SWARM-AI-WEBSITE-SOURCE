import { useEffect, useState } from 'react';
import { ArrowRight, Check, ExternalLink, X } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { LogoFull } from '../components/Logo';
import { Button, Input, Spinner, cx } from '../components/ui';

type StepState = 'pending' | 'running' | 'done' | 'warn';
const PROVIDERS_SHOWN = ['openrouter', 'groq', 'google', 'nvidia', 'huggingface', 'cerebras'];

export function Onboarding() {
  const boot = useStore((s) => s.boot)!;
  const providers = useStore((s) => s.providers);
  const [phase, setPhase] = useState<'intro' | 'setup'>('intro');
  const [steps, setSteps] = useState<Record<string, { state: StepState; detail: string }>>({
    workspace: { state: 'pending', detail: '' }, ollama: { state: 'pending', detail: '' }, providers: { state: 'pending', detail: '' },
    discover: { state: 'pending', detail: '' }, health: { state: 'pending', detail: '' },
  });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [providersDone, setProvidersDone] = useState(false);
  const set = (k: string, state: StepState, detail: string) => setSteps((s) => ({ ...s, [k]: { state, detail } }));

  useEffect(() => { const t = setTimeout(() => setPhase('setup'), 1400); return () => clearTimeout(t); }, []);

  useEffect(() => {
    if (phase !== 'setup') return;
    set('workspace', 'done', boot.paths.workspace);
    set('ollama', 'running', 'Checking…');
    api.ollamaStatus().then((o) => {
      const local = providers.find((p) => p.id === 'ollama');
      if (o.running) set('ollama', 'done', `Running${o.version ? ` (v${o.version})` : ''} · ${local?.modelCount ?? 0} local models`);
      else set('ollama', 'warn', boot.ollama.installed ? 'Installed but not running — start Ollama to use local models' : 'Not installed — optional, adds free local models');
    });
    set('providers', 'running', '');
  }, [phase]);

  const continueSetup = async () => {
    for (const [id, key] of Object.entries(keys)) if (key.trim()) await api.providers.setKey(id, key.trim()).catch(() => undefined);
    const configured = (await api.models.list()).providers.filter((p) => p.configured && p.enabled);
    set('providers', 'done', `${configured.length} connected: ${configured.map((p) => p.name).join(', ') || 'none yet'}`);
    setProvidersDone(true);
    set('discover', 'running', 'Querying provider model lists…');
    const r = await api.models.discover();
    useStore.setState({ models: r.models, providers: r.providers });
    set('discover', 'done', `${r.models.length} free models in registry across ${new Set(r.models.map((m) => m.providerId)).size} providers`);
    set('health', 'running', 'Sending tiny test requests…');
    const ms = await api.models.healthCheck();
    useStore.setState({ models: ms });
    const healthy = ms.filter((m) => m.health === 'healthy').length;
    set('health', healthy ? 'done' : 'warn', healthy ? `${healthy} models verified healthy` : 'No cloud model responded yet — add a free API key or start Ollama');
  };

  const finish = async () => {
    await api.finishOnboarding();
    const [b, projects] = await Promise.all([api.bootstrap(), api.projects.list()]);
    useStore.setState({ boot: b, projects, view: 'home' });
  };

  if (phase === 'intro') {
    return (
      <div className="h-full flex flex-col items-center justify-center drag anim-fade">
        <LogoFull height={132} />
        <p className="mt-8 text-[1.05rem] text-fg-2 tracking-[-0.01em]">Give SWARM an outcome.</p>
      </div>
    );
  }

  const envKeys = providers.filter((p) => p.keySource === 'env');
  const allDone = steps.health.state === 'done' || steps.health.state === 'warn';

  return (
    <div className="h-full overflow-y-auto">
      <div className="h-10 drag" />
      <div className="max-w-[560px] mx-auto px-6 pt-[6vh] pb-16 anim-fade">
        <LogoFull height={56} />
        <h1 className="mt-8 text-[1.5rem] font-semibold tracking-[-0.02em]">Set up SWARM</h1>
        <p className="text-[0.84rem] text-fg-2 mt-1">Free mode is on. SWARM only uses free, free-tier and local models — total API cost $0.00.</p>
        <ol className="mt-8 space-y-1">
          <Step n={1} title="Create local workspace" s={steps.workspace} />
          <Step n={2} title="Detect Ollama" s={steps.ollama} action={steps.ollama.state === 'warn' && !boot.ollama.installed ? <button className="text-[0.72rem] text-accent inline-flex items-center gap-1" onClick={() => api.openExternal('https://ollama.com/download')}>Get Ollama <ExternalLink size={11} /></button> : undefined} />
          <Step n={3} title="Connect free providers" s={steps.providers}>
            {!providersDone && (
              <div className="mt-3 space-y-2">
                {envKeys.length > 0 && <div className="text-[0.72rem] text-fg-2">Found in environment: {envKeys.map((p) => p.name).join(', ')}.</div>}
                {providers.filter((p) => PROVIDERS_SHOWN.includes(p.id)).map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="w-28 text-[0.76rem] shrink-0">{p.name}</span>
                    {p.configured ? <span className="text-[0.72rem] text-ok flex items-center gap-1"><Check size={12} /> {p.keySource === 'env' ? 'from environment' : 'connected'} {p.keyHint}</span> : (
                      <Input type="password" placeholder="API key (optional)" value={keys[p.id] ?? ''} onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))} className="flex-1 h-7" aria-label={`${p.name} API key`} />
                    )}
                    <button className="text-[0.7rem] text-fg-3 hover:text-fg shrink-0 inline-flex items-center gap-1" onClick={() => api.openExternal(p.signupUrl)}>Get key <ExternalLink size={10} /></button>
                  </div>
                ))}
                <div className="text-[0.7rem] text-fg-3 pt-1">Keys are encrypted with your OS keychain and never shown to agents or logs. You can add more in Settings › Providers.</div>
                <div className="pt-2"><Button variant="primary" onClick={continueSetup} icon={ArrowRight}>Continue</Button></div>
              </div>
            )}
          </Step>
          <Step n={4} title="Discover models" s={steps.discover} />
          <Step n={5} title="Run provider health checks" s={steps.health} />
        </ol>
        <div className="mt-8">
          <Button variant="primary" size="lg" disabled={!allDone} onClick={finish} icon={ArrowRight}>Start building</Button>
          {!allDone && <button onClick={finish} className="ml-4 text-[0.75rem] text-fg-3 hover:text-fg-2">Skip setup</button>}
        </div>
      </div>
    </div>
  );
}

function Step({ n, title, s, children, action }: { n: number; title: string; s: { state: StepState; detail: string }; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className="flex gap-3 py-2.5">
      <span className={cx('h-6 w-6 rounded-full flex items-center justify-center text-[0.7rem] font-semibold shrink-0 border',
        s.state === 'done' ? 'bg-ok text-white border-transparent' : s.state === 'warn' ? 'bg-warn-soft text-warn border-transparent' : s.state === 'running' ? 'border-accent text-accent' : 'border-line text-fg-3')}>
        {s.state === 'done' ? <Check size={12} strokeWidth={3} /> : s.state === 'warn' ? <X size={12} strokeWidth={3} /> : s.state === 'running' && !children ? <Spinner size={10} /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className={cx('text-[0.84rem] font-medium', s.state === 'pending' && 'text-fg-3')}>{title}</div>
        {s.detail && <div className="text-[0.74rem] text-fg-2 mt-0.5 break-words">{s.detail} {action}</div>}
        {children}
      </div>
    </li>
  );
}
