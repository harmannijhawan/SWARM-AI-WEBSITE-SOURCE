import { AccountSettings } from './AccountSettings';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Bell, Bot, Brain, Braces, Database, FlaskConical, FolderCog, Gauge, Globe, Keyboard, LayoutPanelLeft, Lock, MemoryStick, MonitorSmartphone,
  MousePointerClick, Palette, Plug, Route, ScrollText, Search, Settings2, Shield, SlidersHorizontal, SquareTerminal, Workflow, ExternalLink, Check, RotateCcw,
} from 'lucide-react';
import type { Settings } from '../../shared/settings';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { comboFromEvent, comboLabel } from '../lib/hotkeys';
import { bytes, timeAgo } from '../lib/format';
import { ask } from '../components/Dialog';
import { healthLabel, healthTone } from '../components/status';
import { Badge, Button, Dot, Input, Kbd, Segmented, Select, Toggle, cx } from '../components/ui';
import { Smartphone } from 'lucide-react';
import { PhoneSetup } from './PhoneSetup';

type Get = (path: string) => unknown;
type SetFn = (path: string, value: unknown) => void;
interface RowDef { label: string; desc?: string; keywords?: string; render: (get: Get, set: SetFn) => ReactNode; full?: boolean }
interface Section { title?: string; rows: RowDef[] }
interface Page { id: string; label: string; icon: typeof Bell; group: string; desc: string; sections: Section[]; custom?: () => ReactNode }

const patch = (path: string, value: unknown) => path.split('.').reduceRight<unknown>((acc, k) => ({ [k]: acc }), value);
const getPath = (s: Settings, path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], s);

const tog = (path: string, label: string, desc?: string): RowDef => ({ label, desc, render: (g, s) => <Toggle label={label} checked={!!g(path)} onChange={(v) => s(path, v)} /> });
const sel = (path: string, label: string, options: [string, string][], desc?: string): RowDef => ({ label, desc, render: (g, s) => <Select aria-label={label} value={String(g(path))} onChange={(e) => s(path, e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select> });
const seg = (path: string, label: string, options: [string, string][], desc?: string): RowDef => ({ label, desc, render: (g, s) => <Segmented label={label} value={String(g(path))} onChange={(v) => s(path, v)} options={options.map(([value, l]) => ({ value, label: l }))} /> });
const numIn = (path: string, label: string, desc: string, min: number, max: number, step = 1, suffix = ''): RowDef => ({
  label, desc, render: (g, s) => (
    <div className="flex items-center gap-2">
      <input type="range" aria-label={label} min={min} max={max} step={step} value={Number(g(path))} onChange={(e) => s(path, Number(e.target.value))} className="w-36 accent-[var(--accent)]" />
      <span className="w-16 text-right text-[0.76rem] tabular text-fg-2">{Number(g(path))}{suffix}</span>
    </div>
  ),
});
const text = (path: string, label: string, desc: string, placeholder = ''): RowDef => ({ label, desc, render: (g, s) => <DebouncedInput value={String(g(path) ?? '')} placeholder={placeholder} onCommit={(v) => s(path, v)} label={label} /> });
const list = (path: string, label: string, desc: string): RowDef => ({ label, desc, full: true, render: (g, s) => <ListEditor value={(g(path) as string[]) ?? []} onChange={(v) => s(path, v)} label={label} /> });

const PAGES: Page[] = [
  {id:'account',group:'Basics',label:'Account & sync',icon:Shield,desc:'Your account, ownership and cloud sync.',sections:[],custom:()=> <AccountSettings/>},
  { id: 'general', group: 'Basics', label: 'General', icon: Settings2, desc: 'Startup and everyday behavior.', sections: [{ rows: [
    seg('general.startup', 'On startup', [['home', 'Home'], ['last_project', 'Last project']], 'What SWARM opens when it launches.'),
    tog('general.confirmDestructive', 'Confirm destructive actions', 'Ask before deleting projects or clearing data.'),
    tog('general.openPreviewOnSuccess', 'Focus preview when the app starts', 'Switch the Build stage to the live preview once the Tester has the app running.'),
  ] }] },
  { id: 'appearance', group: 'Basics', label: 'Appearance', icon: Palette, desc: 'Theme, accent and density.', sections: [
    { rows: [
      { label: 'Theme', desc: 'Light, dark, or follow the system.', render: (g, s) => <Segmented label="Theme" value={String(g('appearance.theme'))} onChange={(v) => s('appearance.theme', v)} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /> },
      { label: 'Accent', desc: 'Used sparingly for focus, live state and selection.', render: (g, s) => (
        <div className="flex gap-1.5" role="radiogroup" aria-label="Accent">{(['graphite', 'blue', 'violet', 'green', 'amber', 'rose'] as const).map((a) => (
          <button key={a} role="radio" aria-checked={g('appearance.accent') === a} aria-label={a} title={a} onClick={() => s('appearance.accent', a)} data-accent={a}
            className={cx('h-6 w-6 rounded-full border-2 transition-transform', g('appearance.accent') === a ? 'border-fg scale-110' : 'border-transparent')}><span className="block h-full w-full rounded-full" style={{ background: 'var(--accent)' }} /></button>
        ))}</div>) },
      seg('appearance.density', 'Density', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']], 'Scales spacing and text across the app.'),
      numIn('appearance.fontScale', 'Text size', 'Fine-tune the base text size.', 0.85, 1.25, 0.05, '×'),
    ] },
    { title: 'Motion', rows: [tog('appearance.animations', 'Animations', 'Subtle transitions that communicate state.'), seg('appearance.reducedMotion', 'Reduce motion', [['system', 'System'], ['on', 'On'], ['off', 'Off']])] },
  ] },
  { id: 'interface', group: 'Basics', label: 'Interface', icon: LayoutPanelLeft, desc: 'Layout and information density.', sections: [{ rows: [
    tog('interface.showInspector', 'Show inspector panel', 'The contextual panel for agents, tasks and models.'),
    tog('interface.sidebarCollapsed', 'Collapse project sidebar'),
    tog('interface.autoFocus', 'Auto-focus the stage', 'Switch between Preview, Terminal, Files and Research as work happens.'),
    tog('interface.showTimestamps', 'Show timestamps in activity'),
    seg('interface.userLogDetail', 'Default activity detail', [['simple', 'Simple'], ['detailed', 'Detailed']]),
  ] }] },
  { id: 'ai', group: 'Intelligence', label: 'AI & Models', icon: Brain, desc: 'How SWARM chooses and uses models.', sections: [{ rows: [
    { label: 'Free mode', desc: 'SWARM only routes to models that are free, free-tier or local. Paid routing is not available in this version.', render: () => <span className="flex items-center gap-2 text-[0.76rem]"><Badge tone="ok">ON</Badge><span className="text-fg-3">locked</span></span> },
    sel('ai.routing', 'Routing strategy', [['auto', 'Auto (balanced)'], ['local_first', 'Local first'], ['cloud_first', 'Cloud first'], ['fastest', 'Fastest'], ['quality', 'Highest quality']], 'Weights used when scoring models for each task.'),
    { label: 'Default model', desc: 'Pin a model for every task, or let the router choose per task.', render: (g, s) => <ModelSelect value={(g('ai.pinnedModel') as string) ?? ''} onChange={(v) => s('ai.pinnedModel', v || null)} /> },
    numIn('ai.temperature', 'Temperature', 'Lower is more deterministic.', 0, 1.5, 0.05),
    numIn('ai.maxOutputTokens', 'Max output tokens', 'Upper bound per model response.', 1024, 32768, 512),
  ] }] },
  { id: 'providers', group: 'Intelligence', label: 'Providers', icon: Plug, desc: 'Connect free providers. Keys are encrypted with your OS keychain and never reach agents, logs or this window.', sections: [], custom: () => <ProvidersPage /> },
  { id: 'routing', group: 'Intelligence', label: 'Model Routing', icon: Route, desc: 'Fallback, timeouts and discovery.', sections: [{ rows: [
    numIn('routing.maxFallbacks', 'Max fallbacks per request', 'How many alternative models to try when one fails.', 0, 12),
    numIn('routing.firstTokenTimeoutSec', 'First-token timeout', 'Give up on a model that has not started responding.', 5, 180, 5, 's'),
    numIn('routing.requestTimeoutSec', 'Total request timeout', '', 10, 600, 10, 's'),
    tog('routing.healthCheckOnStartup', 'Health checks on startup', 'Send tiny test requests to a sample of models per provider.'),
    numIn('routing.discoveryIntervalMin', 'Re-discover models every', '0 disables periodic discovery.', 0, 1440, 15, ' min'),
    list('routing.excluded', 'Excluded models', 'Model IDs the router must never use (provider::model).'),
  ] }] },
  { id: 'agents', group: 'Intelligence', label: 'Agents', icon: Bot, desc: 'Concurrency, step limits and per-agent controls.', sections: [{ rows: [
    numIn('agents.maxConcurrent', 'Max concurrent agents', 'Independent tasks run in parallel up to this limit.', 1, 16),
    { label: 'Enabled agents, permissions and model preferences', desc: 'Configure each specialist individually.', render: () => <Button size="sm" onClick={() => useStore.getState().setView('agents')}>Open Agents</Button> },
  ] }] },
  { id: 'behavior', group: 'Intelligence', label: 'Swarm Behavior', icon: Workflow, desc: 'Autonomy, verification and recovery.', sections: [{ rows: [
    seg('behavior.autonomy', 'Default autonomy', [['manual', 'Manual'], ['assisted', 'Assisted'], ['autonomous', 'Autonomous']], 'Manual asks before every command; Assisted asks for high-risk actions; Autonomous allows normal operations. Dangerous commands are always blocked.'),
    tog('behavior.parallel', 'Parallel execution', 'Run independent tasks concurrently.'),
    numIn('behavior.maxRetries', 'Task retries', 'Retries for a failed coding/design task (model fallback happens separately).', 0, 6),
    seg('behavior.verification', 'Verification strictness', [['basic', 'Basic'], ['standard', 'Standard'], ['strict', 'Strict']], 'Strict also runs lint and fails on medium layout issues.'),
    seg('behavior.context', 'Context strategy', [['minimal', 'Minimal'], ['balanced', 'Balanced'], ['rich', 'Rich']], 'How much design/research context each agent receives.'),
  ] }] },
  { id: 'memory', group: 'Intelligence', label: 'Memory', icon: MemoryStick, desc: 'What SWARM remembers between runs.', sections: [{ rows: [
    tog('memory.project', 'Project memory', 'Objective, decisions, architecture, unresolved issues and outcomes per project.'),
    tog('memory.agent', 'Agent memory', 'Scoped notes each agent keeps from earlier tasks.'),
    numIn('memory.retentionDays', 'Usage & notification retention', '', 1, 3650, 1, ' days'),
    { label: 'Reset memory', desc: 'Clear project memory for the open project.', render: () => <ResetMemory /> },
  ] }] },
  { id: 'research', group: 'Capabilities', label: 'Web Research', icon: Globe, desc: 'Search engines, sources and citations.', sections: [], custom: () => <ResearchPage /> },
  { id: 'browser', group: 'Capabilities', label: 'Browser', icon: MonitorSmartphone, desc: 'Automation browser and viewports.', sections: [{ rows: [
    sel('browser.channel', 'Browser', [['msedge', 'Microsoft Edge'], ['chrome', 'Google Chrome'], ['custom', 'Custom executable']], 'Installed Chromium browser driven by Playwright.'),
    text('browser.executablePath', 'Custom executable', 'Used when Browser is set to custom.', 'C:\\path\\to\\chrome.exe'),
    tog('browser.headless', 'Headless', 'Run automation without a visible window.'),
    numIn('browser.navigationTimeoutSec', 'Navigation timeout', '', 5, 120, 5, 's'),
    numIn('browser.maxPagesToCrawl', 'Pages to crawl per test', 'Internal links visited during the browser test.', 1, 20),
    { label: 'Viewports', desc: 'Desktop, tablet and mobile sizes used for testing.', render: (g, s) => (
      <div className="flex gap-2 text-[0.72rem]">{(['desktop', 'tablet', 'mobile'] as const).map((k) => { const v = g(`browser.${k}`) as [number, number]; return (
        <label key={k} className="flex items-center gap-1 capitalize text-fg-2">{k}
          <input aria-label={`${k} width`} className="w-14 h-7 px-1.5 rounded-md border border-line-strong bg-raised tabular" value={v[0]} onChange={(e) => s(`browser.${k}`, [Number(e.target.value) || v[0], v[1]])} />×
          <input aria-label={`${k} height`} className="w-14 h-7 px-1.5 rounded-md border border-line-strong bg-raised tabular" value={v[1]} onChange={(e) => s(`browser.${k}`, [v[0], Number(e.target.value) || v[1]])} />
        </label>); })}</div>) },
  ] }] },
  { id: 'computer', group: 'Capabilities', label: 'Computer Use', icon: MousePointerClick, desc: 'Which tools agents may use at all.', sections: [{ rows: [
    tog('computer.filesystem', 'File system', 'Create and edit files inside the project.'),
    tog('computer.native', 'Windows computer interaction', 'Inspect and interact with accessible Windows controls. Every action requires approval.'),
    tog('computer.terminal', 'Terminal', 'Run commands in the project folder.'),
    tog('computer.packageInstall', 'Dependency installs', 'npm/pnpm installs from the public registry.'),
    tog('computer.browser', 'Browser automation', 'Open the app, click, type, screenshot.'),
    tog('computer.web', 'Web access', 'Search the web and fetch pages.'),
    tog('computer.openExternal', 'Open links in system browser'),
  ] }] },
  { id: 'execution', group: 'Capabilities', label: 'Code Execution', icon: SquareTerminal, desc: 'Timeouts, approvals and command policy.', sections: [{ rows: [
    numIn('execution.timeoutSec', 'Command timeout', 'Processes are killed (with their child tree) after this.', 10, 3600, 10, 's'),
    numIn('execution.devServerTimeoutSec', 'Dev server start timeout', '', 10, 600, 5, 's'),
    seg('execution.packageManager', 'Package manager', [['npm', 'npm'], ['pnpm', 'pnpm']]),
    tog('execution.scrubEnv', 'Scrub secrets from child environments', 'Removes *_KEY / *_TOKEN / *_SECRET variables from commands agents run.'),
    numIn('execution.maxOutputKb', 'Output buffer', '', 16, 4096, 16, ' KB'),
    list('execution.autoApprove', 'Auto-approved command prefixes', 'In Manual mode, low-risk commands starting with these run without asking.'),
    list('execution.blocked', 'Additional blocked patterns', 'Commands containing any of these are never run.'),
  ] }] },
  { id: 'security', group: 'Trust', label: 'Security', icon: Shield, desc: 'Scopes and restrictions.', sections: [{ rows: [
    seg('security.fsScope', 'Filesystem scope', [['project', 'Active project'], ['workspace', 'Workspace']], 'Agents can never read or write outside this scope.'),
    tog('security.blockDangerous', 'Block dangerous commands', 'Disk formatting, recursive root deletes, piping downloads into shells, registry edits, force pushes, publishing…'),
    tog('security.allowDeletes', 'Allow agents to delete files', 'Deletions are recorded and revertible.'),
    tog('security.allowAgentNetwork', 'Allow agent network access', 'Needed for web research.'),
    { label: 'Secret handling', desc: 'API keys are encrypted with Windows DPAPI via Electron safeStorage, redacted from logs and never sent to the renderer.', render: () => <Badge tone="ok"><Lock size={10} /> Enforced</Badge> },
  ] }] },
  { id: 'privacy', group: 'Trust', label: 'Privacy', icon: Lock, desc: 'Local data and telemetry.', sections: [{ rows: [
    { label: 'Telemetry', desc: 'SWARM sends no telemetry or analytics. Network traffic goes only to the providers and websites you use.', render: () => <Badge>None</Badge> },
    tog('privacy.storeLogs', 'Store event logs', 'Persist the structured event log locally.'),
    tog('privacy.storeScreenshots', 'Store screenshots', 'Keep browser captures in the project’s .swarm folder.'),
    { label: 'Delete data', desc: 'Manage stored data in Data.', render: () => <Button size="sm" onClick={() => useStore.setState({ settingsSection: 'data' })}>Open Data</Button> },
  ] }] },
  { id: 'projects', group: 'Workspace', label: 'Projects', icon: FolderCog, desc: 'Defaults for new projects.', sections: [{ rows: [
    sel('projects.defaultStack', 'Default stack', [['auto', 'Auto (fast, dependency-light)'], ['node-express', 'Node.js + Express'], ['static', 'Static HTML/CSS/JS'], ['vite-react', 'Vite + React']], 'Guidance for the Architect when the objective does not specify a stack.'),
    tog('research.defaultOn', 'Web research on by default'),
  ] }] },
  { id: 'workspace', group: 'Workspace', label: 'Workspace', icon: Braces, desc: 'Where projects live.', sections: [{ rows: [
    { label: 'Workspace folder', desc: 'New projects are created here.', render: (g, s) => (
      <div className="flex items-center gap-2"><span className="mono text-[0.7rem] text-fg-2 max-w-[260px] truncate">{String(g('workspace.root'))}</span>
        <Button size="sm" onClick={async () => { const d = await api.pickFolder(); if (d) s('workspace.root', d); }}>Change…</Button>
        <Button size="sm" variant="ghost" onClick={() => api.openPath(String(g('workspace.root')))}>Open</Button></div>) },
  ] }] },
  { id: 'keyboard', group: 'Workspace', label: 'Keyboard', icon: Keyboard, desc: 'Click a shortcut, then press the new key combination.', sections: [{ rows: ([
    ['palette', 'Command palette'], ['newProject', 'New project'], ['search', 'Search files / projects'], ['run', 'Run'], ['toggleTheme', 'Toggle theme'], ['toggleInspector', 'Toggle inspector'], ['terminal', 'Open terminal'], ['settings', 'Open settings'],
  ] as const).map(([k, l]): RowDef => ({ label: l, render: (g: Get, s: SetFn) => <ShortcutRecorder value={String(g(`keyboard.${k}`))} onChange={(v) => s(`keyboard.${k}`, v)} /> })).concat([{ label: 'Close / cancel', render: () => <Kbd keys={['Esc']} /> }]) }] },
  { id: 'phone', group: 'Workspace', label: 'Phone', icon: Smartphone, desc: 'Pair the SWARM companion app on your phone.', sections: [], custom: () => <PhoneSetup embedded /> },
  { id: 'notifications', group: 'Workspace', label: 'Notifications', icon: Bell, desc: 'Subtle alerts when SWARM needs you.', sections: [
    { rows: [tog('notifications.enabled', 'Notifications'), tog('notifications.desktop', 'Desktop notifications', 'Shown by Windows when SWARM is not focused.')] },
    { title: 'Notify me when', rows: [tog('notifications.onComplete', 'A run completes'), tog('notifications.onFail', 'A run fails'), tog('notifications.onApproval', 'Approval is required'), tog('notifications.onBrowserFail', 'A browser test fails'), tog('notifications.onBlocked', 'An agent is blocked or the project needs attention'), tog('notifications.onFallback', 'A model fallback happens')] },
  ] },
  { id: 'performance', group: 'System', label: 'Performance', icon: Gauge, desc: 'Streaming, caching and limits.', sections: [{ rows: [
    tog('performance.streaming', 'Stream model responses', 'Shows output as it is generated and detects stalls early.'),
    tog('performance.cacheModelResults', 'Cache safe model results', 'Reuses results for identical deterministic requests (e.g. research extraction).'),
    tog('performance.cacheResearch', 'Cache search results', 'Avoids repeating identical searches.'),
    numIn('performance.maxEventsInView', 'Events kept in view', '', 200, 20000, 200),
    numIn('performance.streamThrottleMs', 'Stream update interval', 'Lower is smoother, higher uses less CPU.', 16, 1000, 8, ' ms'),
  ] }] },
  { id: 'logs', group: 'System', label: 'Logs', icon: ScrollText, desc: 'Developer and activity logs.', sections: [{ rows: [
    seg('logs.level', 'Log level', [['info', 'Info'], ['debug', 'Debug']], 'Debug records model selection details, stream timings and more.'),
    numIn('logs.retentionDays', 'Keep logs for', '', 1, 365, 1, ' days'),
    { label: 'Browse logs', render: () => <Button size="sm" onClick={() => useStore.getState().setView('runs')}>Open Runs & logs</Button> },
  ] }] },
  { id: 'data', group: 'System', label: 'Data', icon: Database, desc: 'Export and delete local data.', sections: [], custom: () => <DataPage /> },
  { id: 'advanced', group: 'System', label: 'Advanced', icon: SlidersHorizontal, desc: 'Endpoints and identifiers.', sections: [{ rows: [
    text('advanced.ollamaUrl', 'Ollama URL', 'Local Ollama server.', 'http://127.0.0.1:11434'),
    text('advanced.userAgent', 'Research user agent', 'Identifies SWARM to websites (checked against robots.txt).'),
  ] }] },
  { id: 'experimental', group: 'System', label: 'Experimental', icon: FlaskConical, desc: 'Features still being tuned.', sections: [{ rows: [
    tog('experimental.visionQA', 'Vision QA', 'Send screenshots to a vision-capable free model for visual inspection.'),
    tog('experimental.optimizer', 'Optimizer agent', 'Let the Manager add a performance pass.'),
    tog('experimental.crawlLinks', 'Crawl internal links in browser tests'),
  ] }] },
];

export function SettingsView() {
  const settings = useStore((s) => s.settings)!;
  const section = useStore((s) => s.settingsSection);
  const save = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const [q, setQ] = useState('');
  const page = PAGES.find((p) => p.id === section) ?? PAGES[0];
  const get: Get = (p) => getPath(settings, p);
  const set: SetFn = (p, v) => { void save(patch(p, v)).catch((e) => toast({ level: 'error', title: 'Setting not saved', body: String(e.message) })); };
  const groups = [...new Set(PAGES.map((p) => p.group))];
  const results = useMemo(() => {
    if (!q.trim()) return null;
    const s = q.toLowerCase();
    return PAGES.flatMap((p) => [
      ...(p.label.toLowerCase().includes(s) || p.desc.toLowerCase().includes(s) ? [{ page: p, row: null as RowDef | null }] : []),
      ...p.sections.flatMap((sec) => sec.rows.filter((r) => `${r.label} ${r.desc ?? ''} ${r.keywords ?? ''}`.toLowerCase().includes(s)).map((row) => ({ page: p, row }))),
    ]);
  }, [q]);

  return (
    <div className="h-full flex min-h-0">
      <nav aria-label="Settings sections" className="w-[228px] shrink-0 border-r border-line overflow-y-auto py-4 px-3">
        <label className="flex items-center gap-2 h-8 px-2.5 mb-3 rounded-lg bg-sunken border border-line focus-within:border-accent"><Search size={13} className="text-fg-3" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" aria-label="Search settings" className="flex-1 min-w-0 bg-transparent text-[0.78rem]" /></label>
        {groups.map((g) => (
          <div key={g} className="mb-3">
            <div className="px-2 pb-1 text-[0.66rem] font-medium text-fg-3">{g}</div>
            {PAGES.filter((p) => p.group === g).map((p) => (
              <button key={p.id} onClick={() => { useStore.setState({ settingsSection: p.id }); setQ(''); }} aria-current={page.id === p.id && !results ? 'page' : undefined}
                className={cx('w-full h-8 px-2 flex items-center gap-2.5 rounded-lg text-[0.8rem] transition-colors', page.id === p.id && !results ? 'bg-hover text-fg font-medium' : 'text-fg-2 hover:text-fg hover:bg-hover/60')}>
                <p.icon size={14} strokeWidth={1.8} />{p.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[760px] px-10 py-8 anim-fade" key={results ? 'search' : page.id}>
          {results ? (
            <>
              <h1 className="text-[1.3rem] font-semibold tracking-[-0.015em]">Results for “{q}”</h1>
              <div className="mt-6 rounded-2xl border border-line bg-panel divide-y divide-line">
                {results.map((r, i) => r.row ? <SettingRow key={i} row={r.row} get={get} set={set} crumb={r.page.label} /> : (
                  <button key={i} onClick={() => { useStore.setState({ settingsSection: r.page.id }); setQ(''); }} className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-hover/50"><r.page.icon size={15} className="text-fg-2" /><span className="text-[0.82rem]">{r.page.label}</span><span className="text-[0.74rem] text-fg-3">{r.page.desc}</span></button>
                ))}
                {!results.length && <div className="p-6 text-[0.8rem] text-fg-3">No settings match.</div>}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-[1.3rem] font-semibold tracking-[-0.015em] flex items-center gap-2.5"><page.icon size={18} strokeWidth={1.8} className="text-fg-2" />{page.label}</h1>
                  <p className="text-[0.8rem] text-fg-2 mt-1">{page.desc}</p>
                </div>
                {page.sections.length > 0 && (
                  <Button size="sm" variant="ghost" icon={RotateCcw} onClick={async () => {
                    const key = page.sections[0].rows.map((r) => r.render).length ? page.id : page.id;
                    const sectionKey = ({ ai: 'ai', routing: 'routing', agents: 'agents', behavior: 'behavior', memory: 'memory', browser: 'browser', computer: 'computer', execution: 'execution', security: 'security', privacy: 'privacy', projects: 'projects', keyboard: 'keyboard', notifications: 'notifications', performance: 'performance', logs: 'logs', advanced: 'advanced', experimental: 'experimental', general: 'general', appearance: 'appearance', interface: 'interface' } as Record<string, string>)[key];
                    if (!sectionKey) return;
                    const r = await ask({ title: `Reset ${page.label} settings?`, confirmLabel: 'Reset' });
                    if (r.ok) useStore.setState({ settings: await api.resetSettings(sectionKey) });
                  }}>Reset</Button>
                )}
              </div>
              {page.custom ? <div className="mt-6">{page.custom()}</div> : page.sections.map((sec, i) => (
                <div key={i} className="mt-6">
                  {sec.title && <div className="text-[0.72rem] font-medium text-fg-3 mb-2">{sec.title}</div>}
                  <div className="rounded-2xl border border-line bg-panel divide-y divide-line">{sec.rows.map((row, j) => <SettingRow key={j} row={row} get={get} set={set} />)}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingRow({ row, get, set, crumb }: { row: RowDef; get: Get; set: SetFn; crumb?: string }) {
  return (
    <div className={cx('px-5 py-3.5', row.full ? 'space-y-2.5' : 'flex items-center justify-between gap-6')}>
      <div className="min-w-0">
        {crumb && <div className="text-[0.66rem] text-fg-3">{crumb}</div>}
        <div className="text-[0.82rem] font-medium">{row.label}</div>
        {row.desc && <div className="text-[0.74rem] text-fg-2 mt-0.5 leading-relaxed">{row.desc}</div>}
      </div>
      <div className={cx(!row.full && 'shrink-0')}>{row.render(get, set)}</div>
    </div>
  );
}

function DebouncedInput({ value, onCommit, placeholder, label }: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <Input aria-label={label} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="w-72" />;
}

function ListEditor({ value, onChange, label }: { value: string[]; onChange: (v: string[]) => void; label: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => <span key={v} className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-md bg-sunken border border-line mono text-[0.68rem]">{v}<button aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))} className="h-4 w-4 rounded hover:bg-hover text-fg-3">×</button></span>)}
        {!value.length && <span className="text-[0.72rem] text-fg-3">None</span>}
      </div>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim() && !value.includes(draft)) onChange([...value, draft]); setDraft(''); }}>
        <Input aria-label={`Add to ${label}`} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add…" className="w-72 h-7" />
        <Button size="sm" type="submit">Add</Button>
      </form>
    </div>
  );
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!rec) return;
    const h = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { setRec(false); return; } const c = comboFromEvent(e); if (c) { onChange(c); setRec(false); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [rec, onChange]);
  return (
    <button onClick={() => setRec(true)} className={cx('h-8 px-2 rounded-lg border min-w-[120px] flex items-center justify-center', rec ? 'border-accent text-accent text-[0.72rem]' : 'border-line hover:border-line-strong')}>
      {rec ? 'Press keys… (Esc to cancel)' : <Kbd keys={comboLabel(value)} />}
    </button>
  );
}

function ModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const models = useStore((s) => s.models).filter((m) => m.enabled && m.health !== 'auth_required' && m.health !== 'unsupported');
  return (
    <Select aria-label="Default model" value={value} onChange={(e) => onChange(e.target.value)} className="w-64">
      <option value="">Auto (router decides per task)</option>
      {models.sort((a, b) => a.displayName.localeCompare(b.displayName)).map((m) => <option key={m.id} value={m.id}>{m.displayName} · {m.providerId}</option>)}
    </Select>
  );
}

function ResetMemory() {
  const projectId = useStore((s) => s.projectId);
  const toast = useStore((s) => s.toast);
  return <Button size="sm" disabled={!projectId} onClick={async () => {
    const r = await ask({ title: 'Reset project memory?', body: 'Decisions, summaries and unresolved items for this project are cleared. Files and history stay.', confirmLabel: 'Reset', danger: true });
    if (!r.ok || !projectId) return;
    await api.projects.update(projectId, { memory: { objective: '', summary: '', completedTasks: [], unresolved: [], decisions: [], architecture: '', lastRunOutcome: '', commands: {} } } as never);
    toast({ level: 'success', title: 'Project memory reset' });
  }}>Reset</Button>;
}

function ProvidersPage() {
  const providers = useStore((s) => s.providers);
  const settings = useStore((s) => s.settings)!;
  const save = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const saveKey = async (id: string, key: string | null) => {
    setBusy(id);
    try { const r = await api.providers.setKey(id, key); toast({ level: 'success', title: key ? 'Key saved' : 'Key removed', body: r.hint ?? undefined }); setKeys((k) => ({ ...k, [id]: '' })); const m = await api.models.list(); useStore.setState({ models: m.models, providers: m.providers }); }
    catch (e) { toast({ level: 'error', title: 'Could not save key', body: String((e as Error).message) }); }
    finally { setBusy(null); }
  };
  const test = async (id: string) => {
    setBusy(id);
    try { await api.models.discover(id); await api.models.healthCheck(id); const m = await api.models.list(); useStore.setState({ models: m.models, providers: m.providers }); const p = m.providers.find((x) => x.id === id); toast({ level: p?.health === 'healthy' ? 'success' : 'warning', title: `${p?.name}: ${healthLabel(p?.health ?? 'unknown')}`, body: p?.lastError ?? `${p?.modelCount} models` }); }
    finally { setBusy(null); }
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl bg-sunken border border-line px-4 py-3">
        <div className="text-[0.76rem] text-fg-2">Use API keys from environment variables (e.g. <span className="mono">NVIDIA_API_KEY</span>, <span className="mono">GROQ_API_KEY</span>)</div>
        <Toggle label="Use environment keys" checked={settings.providers.useEnvKeys} onChange={(v) => save({ providers: { useEnvKeys: v } })} />
      </div>
      {providers.map((p) => (
        <div key={p.id} className="rounded-2xl border border-line bg-panel p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[0.88rem] font-semibold">{p.name}</span>
                <span className="flex items-center gap-1 text-[0.7rem] text-fg-2"><Dot tone={!p.enabled ? 'neutral' : healthTone(p.health)} />{!p.enabled ? 'Disabled' : !p.configured ? (p.requiresKey ? 'Not connected' : 'Not detected') : healthLabel(p.health)}</span>
                {p.kind === 'local' && <Badge>local</Badge>}
              </div>
              <div className="text-[0.72rem] text-fg-3 mt-0.5">{p.freeNotes}</div>
              <div className="text-[0.7rem] text-fg-3 mt-1 tabular">{p.modelCount} models{p.lastDiscoveryAt ? ` · discovered ${timeAgo(p.lastDiscoveryAt)}` : ''}{p.latencyMs ? ` · ${p.latencyMs} ms` : ''}</div>
              {p.lastError && p.enabled && <div className="text-[0.7rem] text-warn mt-1 break-words">{p.lastError.slice(0, 200)}</div>}
            </div>
            <Toggle label={`Enable ${p.name}`} checked={p.enabled} onChange={async (v) => { useStore.setState({ providers: await api.providers.configure(p.id, { enabled: v }) }); }} />
          </div>
          {p.enabled && (
            <div className="mt-3 pt-3 border-t border-line space-y-2">
              {p.requiresKey && (
                <div className="flex items-center gap-2">
                  <span className="w-24 text-[0.74rem] text-fg-2 shrink-0">API key</span>
                  {p.keyHint ? <span className="mono text-[0.72rem] text-fg-2 flex items-center gap-1.5"><Check size={12} className="text-ok" />{p.keyHint}{p.keySource === 'env' && <Badge>env</Badge>}</span> : null}
                  <Input type="password" aria-label={`${p.name} API key`} placeholder={p.keyHint ? 'Replace key' : 'Paste key'} value={keys[p.id] ?? ''} onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))} className="flex-1 h-7" />
                  <Button size="sm" variant="primary" disabled={!keys[p.id]?.trim()} loading={busy === p.id} onClick={() => saveKey(p.id, keys[p.id])}>Save</Button>
                  {p.keySource === 'settings' && <Button size="sm" variant="ghost" onClick={() => saveKey(p.id, null)}>Remove</Button>}
                </div>
              )}
              {p.needsAccountId && (
                <div className="flex items-center gap-2"><span className="w-24 text-[0.74rem] text-fg-2 shrink-0">Account ID</span>
                  <DebouncedInput label="Cloudflare account ID" value={settings.providers.accountIds[p.id] ?? ''} onCommit={async (v) => { useStore.setState({ providers: await api.providers.configure(p.id, { accountId: v }) }); }} /></div>
              )}
              <div className="flex items-center gap-2"><span className="w-24 text-[0.74rem] text-fg-2 shrink-0">Base URL</span><span className="mono text-[0.7rem] text-fg-3 truncate flex-1">{p.baseUrl}</span>
                <Button size="sm" variant="ghost" onClick={async () => { const r = await ask({ title: `${p.name} base URL`, input: { initial: p.baseUrl }, confirmLabel: 'Save' }); if (r.ok) { if (p.id === 'ollama') await save({ advanced: { ollamaUrl: r.value } }); useStore.setState({ providers: await api.providers.configure(p.id, { baseUrl: r.value }) }); } }}>Edit</Button></div>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" loading={busy === p.id} disabled={!p.configured && !['openrouter', 'ollama'].includes(p.id)} onClick={() => test(p.id)}>Test connection</Button>
                <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => api.openExternal(p.signupUrl)}>{p.kind === 'local' ? 'Download' : 'Get a free key'}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ResearchPage() {
  const settings = useStore((s) => s.settings)!;
  const save = useStore((s) => s.saveSettings);
  const toast = useStore((s) => s.toast);
  const [keys, setKeys] = useState<{ id: string; hint: string | null; source: string | null }[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { api.providers.searchKeys().then(setKeys); }, []);
  const get: Get = (p) => getPath(settings, p);
  const set: SetFn = (p, v) => void save(patch(p, v));
  const rows: RowDef[] = [
    sel('research.engine', 'Search engine', [['auto', 'Auto (best available)'], ['tavily', 'Tavily'], ['brave', 'Brave Search API'], ['searxng', 'SearXNG'], ['duckduckgo', 'DuckDuckGo'], ['wikipedia', 'Wikipedia']], 'Auto prefers keyed engines, then keyless ones.'),
    text('research.searxngUrl', 'SearXNG URL', 'Your own SearXNG instance with JSON output enabled.', 'http://localhost:8080'),
    numIn('research.maxSources', 'Max sources per task', '', 1, 30),
    numIn('research.maxQueries', 'Max queries per task', '', 1, 10),
    tog('research.fetchPages', 'Read full pages', 'Open and extract each source instead of relying on search snippets (verification).'),
    { label: 'Respect robots.txt', desc: 'SWARM always honors robots.txt, access restrictions and anti-bot challenges.', render: () => <Badge tone="ok">Always</Badge> },
    numIn('research.requestsPerSecond', 'Requests per second per site', 'Politeness limit.', 0.2, 5, 0.1),
    numIn('research.cacheHours', 'Cache search results for', '', 0, 720, 1, ' h'),
    seg('research.citationStyle', 'Citation style', [['numeric', '[1] Numeric'], ['domain', 'Domain']]),
  ];
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-panel divide-y divide-line">{rows.map((r, i) => <SettingRow key={i} row={r} get={get} set={set} />)}</div>
      <div>
        <div className="text-[0.72rem] font-medium text-fg-3 mb-2">Search API keys (optional, free tiers)</div>
        <div className="rounded-2xl border border-line bg-panel divide-y divide-line">
          {keys.map((k) => (
            <div key={k.id} className="px-5 py-3.5 flex items-center gap-3">
              <span className="w-24 text-[0.82rem] font-medium capitalize">{k.id}</span>
              {k.hint && <span className="mono text-[0.72rem] text-fg-2 flex items-center gap-1"><Check size={12} className="text-ok" />{k.hint}</span>}
              <Input type="password" aria-label={`${k.id} key`} placeholder={k.hint ? 'Replace key' : 'Paste key'} value={draft[k.id] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [k.id]: e.target.value }))} className="flex-1 h-7" />
              <Button size="sm" variant="primary" disabled={!draft[k.id]?.trim()} onClick={async () => { await api.providers.setKey(k.id, draft[k.id]); setDraft((d) => ({ ...d, [k.id]: '' })); setKeys(await api.providers.searchKeys()); toast({ level: 'success', title: 'Search key saved' }); }}>Save</Button>
              <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => api.openExternal(k.id === 'tavily' ? 'https://app.tavily.com' : 'https://api-dashboard.search.brave.com')}>Get key</Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DataPage() {
  const toast = useStore((s) => s.toast);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.dataStats>> | null>(null);
  const load = () => api.dataStats().then(setStats);
  useEffect(() => { void load(); }, []);
  const clear = async (what: 'logs' | 'cache' | 'history' | 'all', label: string) => {
    if (useStore.getState().settings?.general.confirmDestructive !== false || what === 'all') {
      const r = await ask({ title: `Delete ${label}?`, body: what === 'all' ? 'Removes logs, caches, run history and preferences stored by SWARM. Project folders on disk are not touched.' : 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
      if (!r.ok) return;
    }
    await api.clearData(what); toast({ level: 'success', title: `${label} deleted` }); void load();
  };
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-panel p-5 grid grid-cols-3 gap-4 text-center">
        {stats && [['Database', bytes(stats.dbBytes)], ['Events', stats.events], ['Runs', stats.runs], ['Model calls', stats.usage], ['Sources', stats.sources], ['Cache entries', stats.cache]].map(([l, v]) => (
          <div key={l as string}><div className="text-[1.1rem] font-semibold tabular">{v}</div><div className="text-[0.7rem] text-fg-3">{l}</div></div>
        ))}
      </div>
      {stats && <div className="text-[0.72rem] text-fg-3 mono">{stats.dbPath}</div>}
      <div className="rounded-2xl border border-line bg-panel divide-y divide-line">
        <Action title="Export data" desc="Settings, projects, runs and research as JSON." button={<Button size="sm" onClick={async () => { const f = await api.exportData(); if (f) toast({ level: 'success', title: 'Exported', body: f }); }}>Export…</Button>} />
        <Action title="Clear logs" desc="Delete the structured event log." button={<Button size="sm" onClick={() => clear('logs', 'Logs')}>Clear</Button>} />
        <Action title="Clear caches" desc="Search and model result caches." button={<Button size="sm" onClick={() => clear('cache', 'Caches')}>Clear</Button>} />
        <Action title="Clear run history" desc="Runs, tasks, messages, usage, screenshots metadata." button={<Button size="sm" onClick={() => clear('history', 'Run history')}>Clear</Button>} />
        <Action title="Delete all SWARM data" desc="Everything above plus onboarding state." button={<Button size="sm" variant="danger" onClick={() => clear('all', 'All data')}>Delete</Button>} />
      </div>
    </div>
  );
}

function Action({ title, desc, button }: { title: string; desc: string; button: ReactNode }) {
  return <div className="px-5 py-3.5 flex items-center justify-between gap-6"><div><div className="text-[0.82rem] font-medium">{title}</div><div className="text-[0.74rem] text-fg-2">{desc}</div></div>{button}</div>;
}
