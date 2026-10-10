import { useMemo } from 'react';
import { AGENT_ROLES, type AgentRole } from '../../shared/types';
import { useStore, currentRun } from '../lib/store';
import { ROLE_META, agentLabel, agentTone } from '../components/status';
import { openAgentChat } from '../lib/workspace';
import { useChat } from '../lib/chat';
import { Dot, Select, Toggle, cx } from '../components/ui';

const DESCRIPTIONS: Record<AgentRole, string> = {
  manager: 'Understands the objective, writes the brief, decides which agents are needed and integrates results.',
  planner: 'Turns the brief into an executable task graph and maximizes parallel work.',
  researcher: 'Searches the web, reads sources (robots.txt respected) and extracts cited findings.',
  designer: 'Produces the design system: palette, typography, layouts, components and responsive rules.',
  architect: 'Chooses the stack, file layout, API contract and commands; writes the package manifest.',
  coder: 'Writes and edits real files and runs project commands. Also performs self-repair.',
  tester: 'Installs, typechecks, builds, runs tests, starts the app and tests it in a real browser.',
  reviewer: 'Reviews the implementation for defects and requirement gaps.',
  optimizer: 'Improves performance and code quality without changing behavior (experimental).',
  vision: 'Captures screenshots and inspects them with a vision model plus measured DOM checks.',
  finalizer: 'Verifies completion against real gate results and writes the report.',
};
const PERMS: { key: 'fs' | 'terminal' | 'browser' | 'web'; label: string }[] = [{ key: 'fs', label: 'Files' }, { key: 'terminal', label: 'Terminal' }, { key: 'browser', label: 'Browser' }, { key: 'web', label: 'Web' }];

export function Agents() {
  const settings = useStore((s) => s.settings)!;
  const save = useStore((s) => s.saveSettings);
  const run = useStore(currentRun);
  const tasksMap = useStore((s) => (s.runId ? s.tasks[s.runId] : undefined));
  const agents = useStore((s) => (s.runId ? s.agents[s.runId] : undefined));
  const models = useStore((s) => s.models);
  const tasks = useMemo(() => Object.values(tasksMap ?? {}), [tasksMap]);
  const selectable = models.filter((m) => m.enabled && m.health !== 'auth_required' && m.health !== 'unsupported').sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1100px] mx-auto px-8 py-7">
        <h1 className="text-[1.35rem] font-semibold tracking-[-0.015em]">Agents</h1>
        <p className="text-[0.8rem] text-fg-2 mt-1">Talk directly with a specialist. SWARM coordinates the team and keeps the overall conversation up to date.</p>
        <div className="mt-6 rounded-2xl border border-line bg-panel divide-y divide-line">
          {AGENT_ROLES.map((role) => {
            const M = ROLE_META[role];
            const a = agents?.[role];
            const enabled = settings.agents.enabled[role] !== false;
            const locked = role === 'manager' || role === 'planner' || role === 'finalizer';
            const perms = settings.agents.permissions[role] ?? { fs: true, terminal: true, browser: true, web: true };
            return (
              <div key={role} className={cx('flex items-start gap-4 px-5 py-4', !enabled && 'opacity-60')}>
                <button onClick={() => void openAgentChat(role, { runId: useChat.getState().current?.runId ?? run?.id, projectId: useChat.getState().current?.projectId ?? run?.projectId }).catch(error => useStore.getState().toast({ level: 'error', title: 'Could not open agent chat', body: String(error) }))} className="h-10 w-10 rounded-xl border border-line flex items-center justify-center shrink-0 hover:bg-hover" aria-label={`Chat with ${M.name}`}><M.icon size={17} strokeWidth={1.8} /></button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.88rem] font-semibold">{M.name}</span>
                    <span className="text-[0.72rem] text-fg-3">{M.title}</span>
                    {a && <span className="flex items-center gap-1 text-[0.7rem] text-fg-2"><Dot tone={agentTone(a.status)} pulse={a.status === 'working'} />{agentLabel(a.status)}</span>}
                  </div>
                  <p className="text-[0.76rem] text-fg-2 mt-0.5 max-w-[560px]">{DESCRIPTIONS[role]}</p>
                  <button className="text-[0.75rem] text-accent mt-2" onClick={() => void openAgentChat(role, { runId: useChat.getState().current?.runId ?? run?.id, projectId: useChat.getState().current?.projectId ?? run?.projectId }).catch(error => useStore.getState().toast({ level: 'error', title: 'Could not open agent chat', body: String(error) }))}>Open conversation →</button>
                  <div className="flex flex-wrap items-center gap-4 mt-2.5">
                    {PERMS.map((p) => (
                      <label key={p.key} className="flex items-center gap-1.5 text-[0.72rem] text-fg-2">
                        <input type="checkbox" className="accent-[var(--accent)]" checked={perms[p.key]} onChange={(e) => save({ agents: { permissions: { ...settings.agents.permissions, [role]: { ...perms, [p.key]: e.target.checked } } } })} />{p.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Select aria-label={`${M.name} preferred model`} value={settings.agents.modelPreference[role] ?? ''} onChange={(e) => save({ agents: { modelPreference: { ...settings.agents.modelPreference, [role]: e.target.value || null } } })} className="w-52">
                    <option value="">Auto (router)</option>
                    {selectable.map((m) => <option key={m.id} value={m.id}>{m.displayName} · {m.providerId}</option>)}
                  </Select>
                  <Toggle label={`Enable ${M.name}`} checked={enabled} disabled={locked} onChange={(v) => save({ agents: { enabled: { ...settings.agents.enabled, [role]: v } } })} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
