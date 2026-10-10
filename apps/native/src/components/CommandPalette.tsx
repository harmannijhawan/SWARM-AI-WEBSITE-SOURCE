import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, BookOpenText, Boxes, Cpu, FileCode2, FolderOpen, Globe2, History, Home, Moon, Play, Plus, RefreshCw, RotateCcw, Search, Settings, Square, SquareTerminal, Stethoscope, Workflow,
} from 'lucide-react';
import type { FileNode } from '../../shared/types';
import { api } from '../lib/api';
import { useChat } from '../lib/chat';
import { useStore, currentRun } from '../lib/store';
import { comboLabel } from '../lib/hotkeys';
import { isDark } from '../lib/theme';
import { Kbd, cx } from './ui';

interface Item { id: string; label: string; hint?: string; icon: typeof Home; group: string; keys?: string; run: () => void | Promise<void> }

function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase(); const s = q.toLowerCase();
  if (t.includes(s)) return 100 - t.indexOf(s);
  let i = 0, sc = 0;
  for (const ch of t) { if (ch === s[i]) { i++; sc += 2; } if (i === s.length) return sc; }
  return 0;
}

function flatten(nodes: FileNode[], out: string[] = []) { for (const n of nodes) { if (n.dir) { if (n.children) flatten(n.children, out); } else out.push(n.path); } return out; }

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const mode = useStore((s) => s.paletteMode);
  const projects = useStore((s) => s.projects);
  const projectId = useStore((s) => s.projectId);
  const settings = useStore((s) => s.settings);
  const run = useStore(currentRun);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(''); setIdx(0);
    setTimeout(() => inputRef.current?.focus(), 10);
    if (projectId) api.projects.tree(projectId).then((t) => setFiles(flatten(t))).catch(() => setFiles([]));
  }, [open, projectId]);

  const close = () => useStore.setState({ paletteOpen: false });
  const go = (view: Parameters<ReturnType<typeof useStore.getState>['setView']>[0]) => () => useStore.getState().setView(view);

  const items = useMemo<Item[]>(() => {
    if (!settings) return [];
    const k = settings.keyboard;
    const prefill = (text: string) => { useStore.getState().setMode('BUILD'); setTimeout(() => window.dispatchEvent(new CustomEvent('swarm:prefill', { detail: text })), 100); };
    const cmds: Item[] = [
      { id: 'experiments', label: 'Routing Experiments', hint: 'Controlled benchmark; no production changes', icon: Stethoscope, group: 'Advanced', run: () => { window.dispatchEvent(new Event('swarm:experiments')); } },
      { id: 'new-chat', label: 'New Chat', icon: Plus, group: 'Actions', run: async () => { useStore.getState().setMode('CHAT'); await useChat.getState().fresh(); } },
      { id: 'new-build', label: 'New Build', icon: Workflow, group: 'Actions', run: () => { useStore.getState().setMode('BUILD'); void useStore.getState().openProject(null, 'build'); } },
      { id: 'fix-this', label: 'Fix This', hint: 'Inspect, reproduce, patch and verify', icon: Stethoscope, group: 'Actions', run: async () => { if (!projectId) { const d = await api.pickFolder(); if (!d) return; const p = await api.projects.create({ path: d }); await useStore.getState().refreshProjects(); await useStore.getState().openProject(p.id, 'build'); } prefill('Fix this project.'); } },
      { id: 'build-apk', label: 'Build APK', icon: Boxes, group: 'Actions', run: () => prefill('Build an Android app that ') },
      { id: 'build-windows', label: 'Build Windows App', icon: Boxes, group: 'Actions', run: () => prefill('Build a Windows app that ') },
      { id: 'new', label: 'Create project', icon: Plus, group: 'Actions', keys: k.newProject, run: () => { useStore.getState().openProject(null, 'home'); setTimeout(() => document.getElementById('composer-input')?.focus(), 60); } },
      { id: 'open-folder', label: 'Open existing folder as project', icon: FolderOpen, group: 'Actions', run: async () => { const d = await api.pickFolder(); if (d) { const p = await api.projects.create({ path: d, name: d.split(/[\\/]/).pop() }); await useStore.getState().refreshProjects(); await useStore.getState().openProject(p.id, 'build'); } } },
      { id: 'run', label: 'Run SWARM', hint: 'Focus the prompt', icon: Play, group: 'Actions', keys: k.run, run: () => { if (!projectId) useStore.getState().setView('home'); else useStore.getState().setView('build'); setTimeout(() => document.getElementById('composer-input')?.focus(), 60); } },
      ...(run?.status === 'cancelled' ? [{ id: 'resume', label: 'Resume Run', hint: 'Continue unfinished work', icon: Play, group: 'Actions', run: async () => { await api.runs.resume(run.id); useStore.getState().setView('build'); } }] : []),
      ...(run?.status === 'running' ? [{ id: 'stop', label: 'Stop SWARM', hint: 'Cancel the active run', icon: Square, group: 'Actions', run: () => { void api.runs.cancel(run.id); } }] : []),
      ...(run && run.status !== 'running' ? [{ id: 'restart', label: 'Restart run', hint: run.objective.slice(0, 60), icon: RotateCcw, group: 'Actions', run: async () => { const r = await api.runs.start(run.projectId, run.objective, run.options); useStore.setState({ runId: r.id, view: 'build' }); } }] : []),
      { id: 'theme', label: 'Toggle theme', icon: Moon, group: 'Actions', keys: k.toggleTheme, run: () => { void useStore.getState().saveSettings({ appearance: { theme: isDark(settings) ? 'light' : 'dark' } }); } },
      { id: 'discover', label: 'Discover models', hint: 'Refresh all provider registries', icon: RefreshCw, group: 'Models', run: async () => { useStore.getState().toast({ level: 'info', title: 'Discovering models…' }); const r = await api.models.discover(); useStore.setState({ models: r.models, providers: r.providers }); useStore.getState().toast({ level: 'success', title: `${r.models.length} models in registry` }); } },
      { id: 'health', label: 'Run model health checks', icon: Stethoscope, group: 'Models', run: async () => { useStore.getState().toast({ level: 'info', title: 'Health checks running…' }); await api.models.healthCheck(); useStore.getState().toast({ level: 'success', title: 'Health checks complete' }); } },
      { id: 'change-model', label: 'Change model', hint: 'Pin a model or use Auto routing', icon: Cpu, group: 'Models', run: () => useStore.setState({ view: 'settings', settingsSection: 'ai' }) },
      { id: 'v-home', label: 'Home', icon: Home, group: 'Go to', run: go('home') },
      ...(projectId ? [
        { id: 'v-build', label: 'Build workspace', icon: Workflow, group: 'Go to', run: go('build') },
        { id: 'v-browser', label: 'Open browser', icon: Globe2, group: 'Go to', run: go('browser') },
        { id: 'v-terminal', label: 'Open terminal', icon: SquareTerminal, group: 'Go to', keys: k.terminal, run: go('terminal') },
        { id: 'v-files', label: 'Search files', icon: FileCode2, group: 'Go to', keys: k.search, run: () => useStore.setState({ paletteMode: 'files', paletteOpen: true }) },
        { id: 'v-research', label: 'Open research', icon: BookOpenText, group: 'Go to', run: go('research') },
      ] : []),
      { id: 'v-agents', label: 'Show agents', icon: Boxes, group: 'Go to', run: go('agents') },
      { id: 'v-models', label: 'Show models', icon: Cpu, group: 'Go to', run: go('models') },
      { id: 'v-runs', label: 'Runs & logs', icon: History, group: 'Go to', run: go('runs') },
      { id: 'v-settings', label: 'Open settings', icon: Settings, group: 'Go to', keys: k.settings, run: go('settings') },
      { id: 'v-perf', label: 'Usage & cost', icon: Activity, group: 'Go to', run: () => useStore.setState({ view: 'models' }) },
    ];
    const proj: Item[] = projects.filter((p) => !p.archived).map((p) => ({ id: `p-${p.id}`, label: p.name, hint: p.objective.slice(0, 70), icon: FolderOpen, group: 'Projects', run: () => useStore.getState().openProject(p.id, 'build') }));
    const fileItems: Item[] = files.slice(0, 2000).map((f) => ({ id: `f-${f}`, label: f, icon: FileCode2, group: 'Files', run: () => useStore.setState({ view: 'files', selectedFile: f }) }));
    const pool = mode === 'files' ? fileItems : mode === 'projects' ? proj : [...cmds, ...proj, ...(q ? fileItems : [])];
    return pool.map((it) => ({ it, s: score(q, `${it.label} ${it.hint ?? ''}`) })).filter((x) => x.s > 0).sort((a, b) => (q ? b.s - a.s : 0)).slice(0, 60).map((x) => x.it);
  }, [settings, projects, files, mode, q, projectId, run]);

  useEffect(() => { setIdx(0); }, [q, mode]);
  useEffect(() => { listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' }); }, [idx]);

  if (!open) return null;
  const exec = async (it: Item) => { close(); try { await it.run(); } catch (e) { useStore.getState().toast({ level: 'error', title: it.label, body: String((e as Error).message) }); } };
  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[14vh] bg-black/15 dark:bg-black/45 anim-fade" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} className="w-[620px] max-w-[92vw] rounded-2xl border border-line bg-raised shadow-float overflow-hidden anim-pop">
        <div className="flex items-center gap-3 px-4 h-12 border-b border-line">
          <Search size={16} className="text-fg-3" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search commands"
            placeholder={mode === 'files' ? 'Search files in this project' : mode === 'projects' ? 'Search projects' : 'Type a command, project or file'}
            className="flex-1 bg-transparent text-[0.9rem] text-fg placeholder:text-fg-3"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === 'Enter' && items[idx]) { e.preventDefault(); void exec(items[idx]); }
              if (e.key === 'Escape') { e.preventDefault(); close(); }
              if (e.key === 'Backspace' && !q && mode !== 'all') useStore.setState({ paletteMode: 'all' });
            }} />
          {mode !== 'all' && <span className="text-[0.68rem] text-fg-3 capitalize">{mode}</span>}
        </div>
        <div ref={listRef} role="listbox" className="max-h-[420px] overflow-y-auto py-1.5">
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <div key={it.id}>
                {header && <div className="px-4 pt-2 pb-1 text-[0.66rem] font-medium text-fg-3">{header}</div>}
                <button data-idx={i} role="option" aria-selected={i === idx} onMouseMove={() => setIdx(i)} onClick={() => exec(it)}
                  className={cx('w-full h-9 px-4 flex items-center gap-3 text-left', i === idx && 'bg-hover')}>
                  <it.icon size={15} strokeWidth={1.8} className="text-fg-2 shrink-0" />
                  <span className={cx('text-[0.82rem] truncate', it.group === 'Files' && 'mono text-[0.74rem]')}>{it.label}</span>
                  {it.hint && <span className="text-[0.72rem] text-fg-3 truncate">{it.hint}</span>}
                  {it.keys && <span className="ml-auto"><Kbd keys={comboLabel(it.keys)} /></span>}
                </button>
              </div>
            );
          })}
          {!items.length && <div className="px-4 py-8 text-center text-[0.8rem] text-fg-3">No results</div>}
        </div>
      </div>
    </div>
  );
}
