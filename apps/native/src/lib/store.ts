import { create } from 'zustand';
import type {
  AgentMessage, AgentRole, AgentState, ApprovalRequest, AppNotification, GraphVersion,
  ModelInfo, Project, ProviderInfo, Run, RunChatTurn, SwarmEvent, Task,
} from '../../shared/types';
import type { Settings } from '../../shared/settings';
import { api, type Bootstrap } from './api';

export type View = 'phone' | 'chat' | 'home' | 'build' | 'agents' | 'models' | 'research' | 'browser' | 'files' | 'terminal' | 'runs' | 'settings';
export type StageTab = 'preview' | 'terminal' | 'files' | 'research' | 'messages';
export type InspectorTarget = { type: 'agent'; role: AgentRole } | { type: 'model'; id: string } | { type: 'task'; id: string } | null;
/** 'manager' = Manager conversation. AgentRole = direct agent conversation. */
export type ActiveConversation = 'manager' | AgentRole;

export interface Toast { id: string; level: 'info' | 'success' | 'warning' | 'error'; title: string; body?: string; ts: number }
export interface CommandLive { id: string; runId: string | null; projectId: string | null; command: string; status: 'running' | 'done'; exitCode: number | null; output: string; agent: AgentRole | null; ts: number }

// ─── stable empty fallback constants (prevent referential instability in selectors) ──
const EMPTY_TURNS: RunChatTurn[] = [];
const EMPTY_GRAPH_VERSIONS: GraphVersion[] = [];

// ─── in-flight fetch dedup (prevents parallel loadRunChatHistory calls for same id) ──
const chatHistoryInFlight = new Set<string>();

interface State {
  boot: Bootstrap | null;
  settings: Settings | null;
  view: View;
  mode: 'CHAT' | 'BUILD';
  setMode: (mode: 'CHAT' | 'BUILD') => void;
  settingsSection: string;
  projects: Project[];
  projectId: string | null;
  runId: string | null;
  runs: Record<string, Run>;
  /** All currently active/running runs across all projects (for global indicator) */
  activeRuns: Run[];
  tasks: Record<string, Record<string, Task>>;
  agents: Record<string, Partial<Record<AgentRole, AgentState>>>;
  messages: Record<string, AgentMessage[]>;
  events: Record<string, SwarmEvent[]>;
  globalEvents: SwarmEvent[];
  streams: Record<string, string>;
  commands: Record<string, CommandLive>;
  models: ModelInfo[];
  providers: ProviderInfo[];
  notifications: AppNotification[];
  approvals: ApprovalRequest[];
  toasts: Toast[];
  paletteOpen: boolean;
  paletteMode: 'all' | 'files' | 'projects';
  inspector: InspectorTarget;
  stageTab: StageTab;
  stageLockedUntil: number;
  selectedFile: string | null;
  selectedChangeId: string | null;
  notificationsOpen: boolean;
  previewUrl: string | null;

  // ─── Live Run Chat ──────────────────────────────────────────────────────────
  /** Per-run, per-conversation chat turns. Key: conversationId (`${runId}:manager` or `${runId}:${agentRole}`) */
  runChats: Record<string, RunChatTurn[]>;
  /** Which conversation is currently open in the right panel. Defaults to 'manager'. */
  activeConversation: ActiveConversation;
  /** Whether the right panel (live chat) is open */
  chatPanelOpen: boolean;
  /** Right panel width (px) — user-resizable */
  chatPanelWidth: number;
  /** Per-run graph versions */
  graphVersions: Record<string, GraphVersion[]>;
  
  // ─── Navigation History ──────────────────────────────────────────────────────
  /** Navigation history stack for back button behavior */
  navigationHistory: Array<{ view: View; projectId: string | null; runId: string | null }>;
  /** Current position in history stack (-1 means not navigating from history) */
  navigationIndex: number;

  set: (patch: Partial<State>) => void;
  setView: (v: View) => void;
  openProject: (id: string | null, view?: View) => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshActiveRuns: () => Promise<void>;
  loadRun: (runId: string) => Promise<void>;
  ingest: (events: SwarmEvent[]) => void;
  toast: (t: Omit<Toast, 'id' | 'ts'>) => void;
  focusStage: (tab: StageTab, auto?: boolean) => void;
  saveSettings: (patch: unknown) => Promise<void>;
  // Live chat actions
  ingestRunChatTurn: (conversationId: string, turn: RunChatTurn) => void;
  setActiveConversation: (conv: ActiveConversation) => void;
  loadRunChatHistory: (conversationId: string) => Promise<void>;
  setChatPanelWidth: (w: number) => void;
  // Navigation history
  navigateBack: () => void;
  canNavigateBack: () => boolean;
}

const MAX_STREAM = 8000;
const DEFAULT_CHAT_PANEL_WIDTH = 400;
const MIN_CHAT_PANEL_WIDTH = 360;
const MAX_CHAT_PANEL_WIDTH = 520;

function clampPanelWidth(w: number) {
  return Math.max(MIN_CHAT_PANEL_WIDTH, Math.min(MAX_CHAT_PANEL_WIDTH, w));
}

export const useStore = create<State>()((set, get) => ({
  boot: null, settings: null, view: 'chat', mode: 'CHAT', settingsSection: 'general', projects: [], projectId: null, runId: null,
  setMode: (mode) => { localStorage.setItem('swarm:mode', mode); set({ mode, view: mode === 'CHAT' ? 'chat' : 'build', inspector: null }); },
  runs: {}, activeRuns: [], tasks: {}, agents: {}, messages: {}, events: {}, globalEvents: [], streams: {}, commands: {},
  models: [], providers: [], notifications: [], approvals: [], toasts: [], paletteOpen: false, paletteMode: 'all',
  inspector: null, stageTab: 'preview', stageLockedUntil: 0, selectedFile: null, selectedChangeId: null, notificationsOpen: false, previewUrl: null,
  // Live chat defaults
  runChats: {},
  activeConversation: 'manager',
  chatPanelOpen: true,
  chatPanelWidth: (() => {
    try { return clampPanelWidth(Number(localStorage.getItem('swarm:chatPanelWidth') ?? DEFAULT_CHAT_PANEL_WIDTH)); } catch { return DEFAULT_CHAT_PANEL_WIDTH; }
  })(),
  graphVersions: {},
  navigationHistory: [],
  navigationIndex: -1,

  set: (patch) => set(patch),
  setView: (view) => {
    const s = get();
    const currentState = { view: s.view, projectId: s.projectId, runId: s.runId };
    const newState = { 
      view, 
      projectId: s.projectId, 
      runId: s.runId,
      ...(view === 'chat' ? { mode: 'CHAT' as const } : ['home', 'build', 'agents', 'research', 'browser', 'files', 'terminal', 'runs'].includes(view) ? { mode: 'BUILD' as const } : {}), 
      paletteOpen: false 
    };
    
    // Only push to history if this is a user-initiated navigation (not from back button)
    if (s.navigationIndex === -1) {
      // Push current state to history before navigating
      const newHistory = [...s.navigationHistory, currentState];
      // Limit history size to prevent memory issues
      const trimmedHistory = newHistory.slice(-50);
      set({ ...newState, navigationHistory: trimmedHistory, navigationIndex: -1 });
    } else {
      // Navigating from history, just update the view
      set({ ...newState, navigationIndex: -1 });
    }
  },

  refreshProjects: async () => set({ projects: await api.projects.list() }),

  refreshActiveRuns: async () => {
    try {
      const active = await api.runs.active();
      set({ activeRuns: active });
    } catch (e) {
      console.error('Failed to refresh active runs:', e);
    }
  },

  openProject: async (id, view) => {
    const s = get();
    const currentState = { view: s.view, projectId: s.projectId, runId: s.runId };
    
    // Only push to history if this is a user-initiated navigation
    if (s.navigationIndex === -1 && s.projectId !== id) {
      const newHistory = [...s.navigationHistory, currentState];
      const trimmedHistory = newHistory.slice(-50);
      set({ navigationHistory: trimmedHistory });
    }
    
    get().setMode('BUILD');
    if (!id) { set({ projectId: null, runId: null, view: view ?? 'home', navigationIndex: -1 }); void api.setLastProject(null); return; }
    const p = await api.projects.open(id);
    set((st) => ({ projectId: id, projects: st.projects.map((x) => (x.id === id ? p : x)), view: view ?? (st.view === 'home' ? 'build' : st.view), inspector: null, selectedFile: null, selectedChangeId: null, previewUrl: p.memory.previewUrl ?? null, activeConversation: 'manager', navigationIndex: -1 }));
    
    // Load the user's last viewed run for this project (prioritizes lastViewedRunId over lastRunId)
    // This ensures returning to a project shows the run the user was actually looking at
    const preferredRunId = p.memory.lastViewedRunId || p.lastRunId;
    if (preferredRunId) {
      await get().loadRun(preferredRunId);
    } else {
      set({ runId: null });
    }
  },

  loadRun: async (runId) => {
    const snap = await api.runs.snapshot(runId);
    if (!snap) { set({ runId: null }); return; }
    const maxEvents = get().settings?.performance.maxEventsInView ?? 5000;
    const events = await api.runs.events({ runId, limit: maxEvents, compact: maxEvents < 1000 });
    set((s) => ({
      runId,
      runs: { ...s.runs, [runId]: snap.run },
      tasks: { ...s.tasks, [runId]: Object.fromEntries(snap.tasks.map((t) => [t.id, t])) },
      agents: { ...s.agents, [runId]: Object.fromEntries(snap.agents.map((a) => [a.role, a])) },
      messages: { ...s.messages, [runId]: snap.messages },
      events: { ...s.events, [runId]: events },
      previewUrl: snap.run.previewUrl ?? s.previewUrl,
      activeConversation: 'manager',
    }));
    // Save this as the last viewed run for the project
    if (snap.run.projectId) {
      const project = get().projects.find(p => p.id === snap.run.projectId);
      if (project && project.memory.lastViewedRunId !== runId) {
        void api.projects.update(project.id, { 
          memory: { ...project.memory, lastViewedRunId: runId } 
        }).catch(() => undefined);
      }
    }
    // Pre-load manager chat history for the run
    const convId = `${runId}:manager`;
    void get().loadRunChatHistory(convId);
  },

  ingest: (batch) => {
    const s = get();
    const max = s.settings?.performance.maxEventsInView ?? 5000;
    const events = { ...s.events };
    const tasks = { ...s.tasks };
    const agents = { ...s.agents };
    const messages = { ...s.messages };
    const streams = { ...s.streams };
    const commands = { ...s.commands };
    let globalEvents = s.globalEvents;
    let projectsDirty = false;
    let stage: StageTab | null = null;
    let previewUrl = s.previewUrl;
    for (const e of batch) {
      if (e.type === 'AGENT_STREAM') {
        const tid = e.taskId ?? '';
        const next = (streams[tid] ?? '') + e.message;
        streams[tid] = next.length > MAX_STREAM ? next.slice(next.length - MAX_STREAM) : next;
        continue;
      }
      const cid = e.data?.commandId as string | undefined;
      if (e.type === 'RUN_CHAT_USER' || e.type === 'RUN_CHAT_AGENT_USER') {
        const turn = e.data?.turn as RunChatTurn | undefined;
        if (turn) get().ingestRunChatTurn(turn.conversationId, turn);
      }
      if (e.type === 'COMMAND_OUTPUT' && cid) {
        const c = commands[cid];
        if (c) { const out = c.output + e.message; commands[cid] = { ...c, output: out.length > 200_000 ? out.slice(out.length - 200_000) : out }; }
        continue;
      }
      if (e.type === 'COMMAND_STARTED' && cid) {
        commands[cid] = { id: cid, runId: e.runId, projectId: e.projectId, command: e.message.replace(/^\$ /, ''), status: 'running', exitCode: null, output: '', agent: e.agent, ts: e.ts };
        if (e.runId && e.runId === s.runId) stage = 'terminal';
      }
      if (e.type === 'COMMAND_COMPLETED' && cid && commands[cid]) commands[cid] = { ...commands[cid], status: 'done', exitCode: (e.data?.exitCode as number) ?? null };
      if (e.runId) {
        const list = events[e.runId] ? [...events[e.runId]] : [];
        list.push(e);
        if (list.length > max) list.splice(0, list.length - max);
        events[e.runId] = list;
        const task = e.data?.task as Task | undefined;
        if (task) tasks[e.runId] = { ...(tasks[e.runId] ?? {}), [task.id]: task };
        const agent = e.data?.agent as AgentState | undefined;
        if (e.type === 'AGENT_STATUS' && agent) agents[e.runId] = { ...(agents[e.runId] ?? {}), [agent.role]: agent };
        const msg = e.data?.message as AgentMessage | undefined;
        if (e.type === 'AGENT_MESSAGE' && msg) messages[e.runId] = [...(messages[e.runId] ?? []), msg].slice(-500);
        if (e.runId === s.runId) {
          if (e.type === 'SOURCE_FOUND' && s.stageTab !== 'research') stage = stage ?? 'research';
          if (e.type === 'FILE_CREATED' || e.type === 'FILE_MODIFIED') stage = stage ?? 'files';
          if (e.type === 'TEST_PASSED' && e.data?.gate === 'server' && s.settings?.general.openPreviewOnSuccess !== false) stage = 'preview';
          if (e.type === 'SCREENSHOT_CAPTURED') stage = 'preview';
          // Live run chat — graph version created
          if (e.type === 'GRAPH_VERSION_CREATED') {
            const gv = e.data?.graphVersion as GraphVersion | undefined;
            if (gv) {
              set((st) => ({
                graphVersions: {
                  ...st.graphVersions,
                  [e.runId!]: [...(st.graphVersions[e.runId!] ?? []), gv].slice(-50),
                },
              }));
            }
          }
        }
      } else {
        globalEvents = [...globalEvents, e].slice(-1000);
      }
      if (e.type.startsWith('PROJECT_') || e.type === 'RUN_STARTED' || e.type === 'RUN_COMPLETED' || e.type === 'RUN_FAILED' || e.type === 'RUN_CANCELLED') projectsDirty = true;
    }
    const runs = { ...s.runs };
    if (s.runId && runs[s.runId]?.previewUrl) previewUrl = runs[s.runId].previewUrl;
    set({ events, tasks, agents, messages, streams, commands, globalEvents, runs, previewUrl });
    if (stage) get().focusStage(stage, true);
    if (projectsDirty) {
      void get().refreshProjects();
      void get().refreshActiveRuns();
    }
  },

  toast: (t) => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { ...t, id, ts: Date.now() }].slice(-4) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.level === 'error' ? 7000 : 4200);
  },

  focusStage: (tab, auto = false) => {
    const s = get();
    if (auto) {
      if (!s.settings?.interface.autoFocus) return;
      if (Date.now() < s.stageLockedUntil) return;
      if (s.stageTab === 'preview' && s.previewUrl && tab !== 'preview') return;
      set({ stageTab: tab });
    } else set({ stageTab: tab, stageLockedUntil: Date.now() + 30_000 });
  },

  saveSettings: async (patch) => {
    const next = await api.updateSettings(patch);
    set({ settings: next });
  },

  // ─── Live Run Chat ──────────────────────────────────────────────────────────
  ingestRunChatTurn: (conversationId, turn) => {
    set((s) => {
      const existing = s.runChats[conversationId] ?? EMPTY_TURNS;
      // Replace if streaming (same id), otherwise append
      const idx = existing.findIndex(t => t.id === turn.id);
      const next = idx >= 0
        ? existing.map((t, i) => i === idx ? turn : t)
        : [...existing, turn];
      // User events are batched; streaming replies arrive immediately. Keep
      // chronological order even when both turns share a millisecond.
      next.sort((a, b) => a.ts - b.ts || Number(a.senderType !== 'user') - Number(b.senderType !== 'user'));
      return { runChats: { ...s.runChats, [conversationId]: next.slice(-300) } };
    });
  },

  setActiveConversation: (conv) => {
    set({ activeConversation: conv, chatPanelOpen: true });
    // Lazy-load history when switching conversations
    const runId = get().runId;
    if (!runId) return;
    const convId = conv === 'manager' ? `${runId}:manager` : `${runId}:${conv}`;
    const existing = get().runChats[convId];
    if (!existing || existing.length === 0) {
      void get().loadRunChatHistory(convId);
    }
  },

  loadRunChatHistory: async (conversationId) => {
    if (chatHistoryInFlight.has(conversationId)) return;
    chatHistoryInFlight.add(conversationId);
    try {
      const turns = await api.runChat.history(conversationId);
      if (turns.length > 0) {
        set((s) => ({
          runChats: { ...s.runChats, [conversationId]: [...new Map([...turns, ...(s.runChats[conversationId] ?? [])].map(t => [t.id, t])).values()].sort((a, b) => a.ts - b.ts || Number(a.senderType !== 'user') - Number(b.senderType !== 'user')) },
        }));
      }
    } catch {
      // silently ignore — history is optional
    } finally {
      chatHistoryInFlight.delete(conversationId);
    }
  },

  setChatPanelWidth: (w) => {
    const clamped = clampPanelWidth(w);
    try { localStorage.setItem('swarm:chatPanelWidth', String(clamped)); } catch { /* ignore */ }
    set({ chatPanelWidth: clamped });
  },

  // ─── Navigation History ──────────────────────────────────────────────────────
  canNavigateBack: () => {
    return get().navigationHistory.length > 0;
  },

  navigateBack: () => {
    const s = get();
    if (s.navigationHistory.length === 0) return;
    
    // Pop the last navigation state
    const history = [...s.navigationHistory];
    const previousState = history.pop();
    
    if (!previousState) return;
    
    // Set navigationIndex to indicate we're navigating from history (prevents adding to history)
    set({ navigationIndex: 0 });
    
    // Restore the previous state
    if (previousState.projectId !== s.projectId && previousState.projectId) {
      void get().openProject(previousState.projectId, previousState.view);
    } else if (previousState.runId !== s.runId && previousState.runId) {
      void get().loadRun(previousState.runId);
      get().setView(previousState.view);
    } else {
      get().setView(previousState.view);
    }
    
    // Update history without the popped state
    set({ navigationHistory: history });
  },
}));

export const currentProject = (s: State) => s.projects.find((p) => p.id === s.projectId) ?? null;
export const currentRun = (s: State) => (s.runId ? s.runs[s.runId] ?? null : null);

/**
 * Get the preferred run ID for a project.
 * Prefers lastViewedRunId (user's last viewed run) over lastRunId (most recent run).
 * This ensures returning to a project shows the run the user was actually looking at.
 */
export const getPreferredRunId = (project: import('../../shared/types').Project | null): string | null => {
  if (!project) return null;
  return project.memory.lastViewedRunId || project.lastRunId;
};

// ─── Stable selector factory for run chat turns ───────────────────────────────
// IMPORTANT: Call this inside useMemo in components, never inline in useStore().
// Returning EMPTY_TURNS (not []) ensures referential stability when the key is absent.
export function runChatConversationId(runId: string | null, conv: ActiveConversation): string | null {
  if (!runId) return null;
  return conv === 'manager' ? `${runId}:manager` : `${runId}:${conv}`;
}

export const currentRunChats = (runId: string | null, conv: ActiveConversation) => (s: State): RunChatTurn[] => {
  const convId = runChatConversationId(runId, conv);
  if (!convId) return EMPTY_TURNS;
  return s.runChats[convId] ?? EMPTY_TURNS;
};
