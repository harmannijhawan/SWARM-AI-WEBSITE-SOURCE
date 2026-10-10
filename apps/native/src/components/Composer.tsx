import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Cpu, Globe, Paperclip, ShieldCheck, Square, X } from 'lucide-react';
import type { AutonomyMode } from '../../shared/types';
import { api } from '../lib/api';
import { currentProject, currentRun, useStore } from '../lib/store';
import { comboLabel, matches } from '../lib/hotkeys';
import { Kbd, Spinner, cx } from './ui';
import { healthLabel } from './status';

const AUTONOMY: { value: AutonomyMode; label: string; hint: string }[] = [
  { value: 'manual', label: 'Manual', hint: 'Ask before every command and file deletion' },
  { value: 'assisted', label: 'Assisted', hint: 'Ask only for high-risk actions' },
  { value: 'autonomous', label: 'Autonomous', hint: 'Allow routine operations; installs and high-risk actions require approval' },
];

export function Composer({ variant }: { variant: 'hero' | 'dock' }) {
  const settings = useStore((s) => s.settings)!;
  const project = useStore(currentProject);
  const run = useStore(currentRun);
  const models = useStore((s) => s.models);
  const toast = useStore((s) => s.toast);
  const [text, setText] = useState('');
  const [web, setWeb] = useState(settings.research.defaultOn);
  const [autonomy, setAutonomy] = useState<AutonomyMode>(settings.behavior.autonomy);
  const [pinned, setPinned] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<'models' | 'autonomy' | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const running = run?.status === 'running' && variant === 'dock';

  useEffect(() => { if (project && variant === 'dock') setWeb(project.settings.webResearch); }, [project?.id]);
  useEffect(() => {
    const h = (e: Event) => { setText((e as CustomEvent<string>).detail); setTimeout(() => { ref.current?.focus(); ref.current?.setSelectionRange(9999, 9999); }, 0); };
    window.addEventListener('swarm:prefill', h);
    return () => window.removeEventListener('swarm:prefill', h);
  }, []);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, variant === 'hero' ? 260 : 180) + 'px';
  }, [text, variant]);

  const usable = useMemo(() => models.filter((m) => m.enabled && ['healthy', 'unknown', 'degraded'].includes(m.health) && m.health !== 'auth_required')
    .filter((m) => !modelQuery || m.displayName.toLowerCase().includes(modelQuery.toLowerCase()) || m.providerId.includes(modelQuery.toLowerCase()))
    .sort((a, b) => Number(b.health === 'healthy') - Number(a.health === 'healthy') || (b.paramsB ?? 0) - (a.paramsB ?? 0)).slice(0, 60), [models, modelQuery]);
  const healthyCount = models.filter((m) => m.health === 'healthy').length;
  const pinnedModel = models.find((m) => m.id === pinned);

  const submit = async () => {
    const objective = text.trim();
    if (!objective || busy) return;
    setBusy(true);

    try {
      // ── Mid-run: route message to Live Run Chat (Manager), not a new build ──
      if (running && run && variant === 'dock') {
        await api.runChat.send(run.id, objective);
        setText('');
        setFiles([]);
        // Switch active conversation to manager so the user sees the response
        useStore.getState().setActiveConversation('manager');
        return;
      }

      // CRITICAL: Intent Gateway - classify before executing
      const classification = await api.runs.classifyIntent(objective, variant === 'dock' ? project?.id : undefined);

      // Handle non-build intents conversationally
      if (!classification.shouldStartRun) {
        useStore.getState().setMode('CHAT');
        window.dispatchEvent(new CustomEvent('swarm:chat-prefill', { detail: objective }));
        setBusy(false);
        return;
      }

      // Check if project is required but not available
      if (classification.requiresProject && !project) {
        toast({
          level: 'warning',
          title: 'Project required',
          body: 'This operation requires an open project. Please open or create a project first.',
        });
        setBusy(false);
        return;
      }

      await window.swarm.invoke('runs:resolveTarget', objective, variant === 'dock' ? project?.id : undefined);
      // Proceed with build/execution pipeline
      let pid = variant === 'dock' ? project?.id : undefined;
      if (!pid) {
        const p = await api.projects.create({ objective });
        pid = p.id;
        await useStore.getState().refreshProjects();
      }

      const r = await api.runs.start(pid, objective, { webResearch: web, autonomy, attachments: files, pinnedModel: pinned });
      setText('');
      setFiles([]);
      useStore.setState({ runId: r.id, projectId: pid, mode: 'BUILD', view: 'build', runs: { ...useStore.getState().runs, [r.id]: r }, previewUrl: null, stageTab: 'preview', inspector: null, activeConversation: 'manager' });
      await useStore.getState().refreshProjects();
    } catch (e) {
      toast({ level: 'error', title: 'Could not start', body: String((e as Error).message) });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => { if (run) { await api.runs.cancel(run.id); toast({ level: 'info', title: 'Stopping run', body: 'Cancelling agents, requests, processes and browser sessions' }); } };

  const onKey = (e: React.KeyboardEvent) => {
    if (matches(e.nativeEvent, settings.keyboard.run) || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); void submit(); }
    if (e.key === 'Escape') { if (menu) setMenu(null); else (e.target as HTMLElement).blur(); }
  };

  const hero = variant === 'hero';
  
  return (
    <>
      <div className={cx(busy && 'motion-sent', 'motion-composer relative rounded-2xl border bg-raised transition-shadow duration-[var(--motion-normal)]', hero ? 'border-line-strong shadow-soft focus-within:shadow-float' : 'border-line-strong shadow-soft', 'focus-within:border-fg-3')}>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {files.map((f) => (
            <span key={f} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-sunken border border-line text-[0.7rem] text-fg-2">
              <Paperclip size={11} />{f.split(/[\\/]/).pop()}
              <button aria-label="Remove attachment" onClick={() => setFiles((x) => x.filter((y) => y !== f))} className="h-4 w-4 flex items-center justify-center rounded hover:bg-hover"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      <textarea id="composer-input" ref={ref} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={hero ? 3 : 1}
        aria-label={hero ? 'What do you want to build?' : running ? 'Message Manager or start a new task…' : 'Tell SWARM what to do next'}
        placeholder={running ? 'Message Manager… or describe a change' : hero ? 'What do you want to build?' : 'Tell SWARM what to do next…'}
        className={cx('w-full resize-none bg-transparent px-4 text-fg placeholder:text-fg-3 leading-relaxed', hero ? 'pt-4 pb-1 text-[1.05rem]' : 'pt-3 pb-1 text-[0.9rem]')} />
      <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
        <ChipButton icon={Paperclip} label="Files" onClick={async () => { const f = await api.pickFiles(); if (f.length) setFiles((x) => [...new Set([...x, ...f])]); }} />
        <ChipButton icon={Globe} label="Web research" active={web} onClick={() => setWeb((w) => !w)} title={web ? 'Web research on' : 'Web research off'} />
        <div className="relative">
          <ChipButton icon={Cpu} label={pinnedModel ? pinnedModel.displayName : 'Auto'} onClick={() => setMenu(menu === 'models' ? null : 'models')} active={!!pinned} />
          {menu === 'models' && (
            <Popover onClose={() => setMenu(null)} className="w-[340px]">
              <div className="p-2 border-b border-line"><input autoFocus value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} placeholder="Filter models" className="w-full h-7 px-2 rounded-md bg-sunken text-[0.78rem]" /></div>
              <div className="max-h-[300px] overflow-y-auto py-1">
                <PopItem selected={!pinned} onClick={() => { setPinned(null); setMenu(null); }} title="Auto routing" sub="Router picks the best free model per task, with fallback" />
                {usable.map((m) => (
                  <PopItem key={m.id} selected={pinned === m.id} onClick={() => { setPinned(m.id); setMenu(null); }} title={m.displayName} sub={`${m.providerId} · ${healthLabel(m.health)}${m.latencyMs ? ` · ${(m.latencyMs / 1000).toFixed(1)}s` : ''}`} />
                ))}
                {!usable.length && <div className="px-3 py-4 text-xs text-fg-3">No usable models yet. Connect a provider in Settings › Providers or start Ollama.</div>}
              </div>
            </Popover>
          )}
        </div>
        <div className="relative">
          <ChipButton icon={ShieldCheck} label={AUTONOMY.find((a) => a.value === autonomy)!.label} onClick={() => setMenu(menu === 'autonomy' ? null : 'autonomy')} />
          {menu === 'autonomy' && (
            <Popover onClose={() => setMenu(null)} className="w-[300px]">
              <div className="py-1">{AUTONOMY.map((a) => <PopItem key={a.value} selected={autonomy === a.value} onClick={() => { setAutonomy(a.value); setMenu(null); }} title={a.label} sub={a.hint} />)}</div>
            </Popover>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hero && <span className="hidden md:inline-flex text-[0.7rem] text-fg-3 items-center gap-1.5"><Kbd keys={['↵']} /> to run</span>}
          {running ? (
            <button onClick={() => void stop()} className="h-8 pl-2.5 pr-3 rounded-lg bg-raised border border-line text-fg text-[0.8rem] font-medium inline-flex items-center gap-1.5 hover:bg-hover transition-colors" aria-label="Send to Manager">
              {busy ? <Spinner size={12} /> : <ArrowUp size={14} strokeWidth={2.2} />} {busy ? 'Sending…' : 'Send'}
            </button>
          ) : (
            <button onClick={submit} disabled={!text.trim() || busy} aria-label="Run" title={`Run (${comboLabel(settings.keyboard.run).join('+')})`}
              className="h-8 pl-3 pr-3 rounded-lg bg-fg text-bg text-[0.8rem] font-medium inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-30 transition-opacity">
              {busy ? <Spinner size={12} /> : <ArrowUp size={14} strokeWidth={2.2} />} Run
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function ChipButton({ icon: Icon, label, active, onClick, title }: { icon: typeof Globe; label: string; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button onClick={onClick} title={title ?? label} aria-pressed={active}
      className={cx('h-7 px-2 rounded-lg inline-flex items-center gap-1.5 text-[0.72rem] font-medium border transition-colors max-w-[220px]',
        active ? 'border-line-strong bg-sunken text-fg' : 'border-transparent text-fg-2 hover:text-fg hover:bg-hover')}>
      <Icon size={13} strokeWidth={1.8} className="shrink-0" /><span className="truncate">{label}</span>
    </button>
  );
}

function Popover({ children, onClose, className }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    setTimeout(() => window.addEventListener('mousedown', h), 0);
    return () => window.removeEventListener('mousedown', h);
  }, [onClose]);
  return <div ref={ref} className={cx('absolute bottom-9 left-0 z-50 rounded-xl border border-line bg-raised shadow-float anim-pop overflow-hidden', className)}>{children}</div>;
}

function PopItem({ title, sub, selected, onClick }: { title: string; sub?: string; selected?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-2 hover:bg-hover flex items-start gap-2">
      <span className="w-3.5 pt-0.5 text-accent">{selected && <Check size={13} />}</span>
      <span className="min-w-0">
        <span className="block text-[0.8rem] text-fg truncate">{title}</span>
        {sub && <span className="block text-[0.7rem] text-fg-3 truncate">{sub}</span>}
      </span>
    </button>
  );
}
