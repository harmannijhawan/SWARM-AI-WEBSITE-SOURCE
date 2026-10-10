import type {
  AgentMessage, AgentRole, AgentState, ApprovalRequest, AppNotification, CommandExecution, ConversationalResponse, FileChange, FileNode, GraphVersion, IntentClassification, IntentType, LiveRunSnapshot, ModelInfo,
  Project, ProviderInfo, ResearchFinding, ResearchSource, Run, RunChatTurn, RunOptions, Screenshot, SwarmEvent, Task, UsageSummary, VisualIssue,
} from '../../shared/types';
import type { Settings } from '../../shared/settings';
import type { RuntimeInfo, RuntimeCapabilities } from '../../electron/runtime/types';
import type { AllowNetworksResult, PairingCode, RemoteState } from '../../electron/remote/state';

declare global {
  interface Window {
    swarm: {
      invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
      on(channel: string, fn: (payload: unknown) => void): () => void;
      platform: string;
    };
  }
}

const inv = <T>(channel: string, ...args: unknown[]) => window.swarm.invoke<T>(channel, ...args);

export interface Bootstrap {
  firstRun: boolean; version: string; platform: string;
  paths: { data: string; workspace: string };
  ollama: { installed: boolean; running: boolean; url: string; version: string | null };
  lastProjectId: string | null;
  fullWebSearch: boolean;
  interruptedRuns?: Array<{
    runId: string;
    projectId: string;
    projectName: string;
    objective: string;
    startedAt: number;
    interruptedAt: number;
    completedTasks: number;
    totalTasks: number;
  }>;
}

export interface RunSnapshot { run: Run; tasks: Task[]; agents: AgentState[]; messages: AgentMessage[]; live: boolean }

export interface AccountStatus {account:{id:string;email:string|null;role:string;name?:string|null;avatar?:string|null}|null;connected:boolean;origin:string;syncing:boolean;connecting:boolean;lastSync:number|null;error:string|null}
export const api = {
  account:{openWebsite:()=>inv<void>('account:openWebsite'),status:()=>inv<AccountStatus>('account:status'),signIn:(origin:string)=>inv<AccountStatus>('account:signIn',origin),signOut:()=>inv<AccountStatus>('account:signOut'),sync:()=>inv<AccountStatus>('account:sync')},
  bootstrap: () => inv<Bootstrap>('app:bootstrap'),
  finishOnboarding: () => inv<boolean>('app:finishOnboarding'),
  setLastProject: (id: string | null) => inv<boolean>('app:setLastProject', id),
  getSettings: () => inv<Settings>('settings:get'),
  updateSettings: (patch: unknown) => inv<Settings>('settings:update', patch),
  resetSettings: (section?: string) => inv<Settings>('settings:reset', section),
  openExternal: (url: string) => inv<void>('app:openExternal', url),
  showInFolder: (p: string) => inv<boolean>('app:showInFolder', p),
  openPath: (p: string) => inv<string>('app:openPath', p),
  pickFolder: () => inv<string | null>('app:pickFolder'),
  pickFiles: () => inv<string[]>('app:pickFiles'),
  setTitleBar: (color: string, symbolColor: string) => inv<boolean>('app:setTitleBar', { color, symbolColor }),
  exportData: () => inv<string | null>('app:exportData'),
  clearData: (what: 'logs' | 'cache' | 'history' | 'all') => inv<boolean>('app:clearData', what),
  dataStats: () => inv<{ events: number; runs: number; cache: number; usage: number; sources: number; dbBytes: number; dbPath: string }>('app:dataStats'),

  projects: {
    list: (opts?: { archived?: boolean; query?: string }) => inv<Project[]>('projects:list', opts),
    get: (id: string) => inv<Project>('projects:get', id),
    create: (input: { name?: string; objective?: string; path?: string }) => inv<Project>('projects:create', input),
    update: (id: string, patch: Partial<Project>) => inv<Project>('projects:update', id, patch),
    remove: (id: string, keepFiles: boolean) => inv<boolean>('projects:delete', id, keepFiles),
    duplicate: (id: string) => inv<Project>('projects:duplicate', id),
    open: (id: string) => inv<Project>('projects:open', id),
    tree: (id: string) => inv<FileNode[]>('projects:tree', id),
    readFile: (id: string, rel: string) => inv<string>('projects:readFile', id, rel),
    writeFile: (id: string, rel: string, content: string) => inv<FileChange | null>('projects:writeFile', id, rel, content),
    deleteFile: (id: string, rel: string) => inv<FileChange | null>('projects:deleteFile', id, rel),
    renameFile: (id: string, from: string, to: string) => inv<FileChange>('projects:renameFile', id, from, to),
    mkdir: (id: string, rel: string) => inv<boolean>('projects:mkdir', id, rel),
    changes: (id: string, opts?: { runId?: string; path?: string }) => inv<FileChange[]>('projects:changes', id, opts),
    revertChange: (id: string, changeId: string) => inv<FileChange | null>('projects:revertChange', id, changeId),
    acceptChange: (changeId: string) => inv<boolean>('projects:acceptChange', changeId),
    exportZip: (id: string) => inv<string | null>('projects:export', id),
    reveal: (id: string, rel?: string) => inv<boolean>('projects:revealPath', id, rel),
  },
  runs: {
    resume: (runId: string) => inv<Run>('runs:resume', runId),
    artifacts: (runId: string) => inv<{ path: string; kind: string; bytes?: number }[]>('runs:artifacts', runId),
    isResumable: (runId: string) => inv<{ resumable: boolean; reason: string }>('runs:isResumable', runId),
    classifyIntent: (input: string, projectId?: string) => inv<IntentClassification>('runs:classifyIntent', input, projectId),
    conversationalResponse: (intent: IntentType, input: string) => inv<ConversationalResponse>('runs:conversationalResponse', intent, input),
    start: (projectId: string, objective: string, options?: Partial<RunOptions>) => inv<Run>('runs:start', projectId, objective, options),
    cancel: (runId: string) => inv<boolean>('runs:cancel', runId),
    pause: (runId: string) => inv<boolean>('runs:pause', runId),
    snapshot: (runId: string) => inv<RunSnapshot | null>('runs:snapshot', runId),
    list: (projectId?: string) => inv<Run[]>('runs:list', projectId),
    active: () => inv<Run[]>('runs:active'),
    events: (opts: { runId?: string; projectId?: string; limit?: number; before?: number; types?: string[]; compact?: boolean }) => inv<SwarmEvent[]>('runs:events', opts),
    screenshots: (opts: { runId?: string; projectId?: string }) => inv<Screenshot[]>('runs:screenshots', opts),
    visualIssues: (runId: string) => inv<VisualIssue[]>('runs:visualIssues', runId),
    readImage: (p: string) => inv<string>('runs:readImage', p),
    saveScreenshot: (projectId: string, dataUrl: string, url: string) => inv<Screenshot>('runs:saveScreenshot', projectId, dataUrl, url),
  },
  runtime: {
    tap: (runtimeId: string, x: number, y: number) => inv<boolean>('runtime:tap', runtimeId, x, y),
    launch: (runId: string) => inv<RuntimeInfo>('runtime:launch', runId),
    input: (runtimeId: string, input: string) => inv<boolean>('runtime:input', runtimeId, input),
    clear: (runtimeId: string) => inv<boolean>('runtime:clear', runtimeId),
    getInfo: (runId: string) => inv<RuntimeInfo | null>('runtime:getInfo', runId),
    getCapabilities: (runtimeId: string) => inv<RuntimeCapabilities | null>('runtime:getCapabilities', runtimeId),
    restart: (runtimeId: string) => inv<boolean>('runtime:restart', runtimeId),
    stop: (runtimeId: string) => inv<boolean>('runtime:stop', runtimeId),
    screenshot: (runtimeId: string) => inv<string | null>('runtime:screenshot', runtimeId),
    getLogs: (runtimeId: string) => inv<{ stdout: string; stderr: string } | null>('runtime:getLogs', runtimeId),
  },
  models: {
    list: () => inv<{ models: ModelInfo[]; providers: ProviderInfo[] }>('models:list'),
    discover: (providerId?: string) => inv<{ models: ModelInfo[]; providers: ProviderInfo[] }>('models:discover', providerId),
    healthCheck: (providerId?: string) => inv<ModelInfo[]>('models:healthCheck', providerId),
    probe: (modelId: string) => inv<{ ok: boolean; latencyMs: number; error?: string }>('models:probe', modelId),
    setEnabled: (modelId: string, enabled: boolean) => inv<boolean>('models:setEnabled', modelId, enabled),
    rank: (purpose: string, role?: AgentRole) => inv<{ id: string; score: number }[]>('models:rank', purpose, role),
    usage: (projectId?: string) => inv<UsageSummary>('models:usage', projectId),
  },
  providers: {
    setKey: (providerId: string, key: string | null) => inv<{ hint: string | null }>('providers:setKey', providerId, key),
    configure: (providerId: string, cfg: { baseUrl?: string; accountId?: string; enabled?: boolean }) => inv<ProviderInfo[]>('providers:configure', providerId, cfg),
    searchKeys: () => inv<{ id: string; hint: string | null; source: string | null }[]>('providers:searchKeys'),
  },
  ollamaStatus: () => inv<{ running: boolean; version: string | null }>('ollama:status'),
  research: {
    sources: (projectId: string, runId?: string) => inv<ResearchSource[]>('research:sources', projectId, runId),
    findings: (projectId: string, runId?: string) => inv<ResearchFinding[]>('research:findings', projectId, runId),
  },
  terminal: {
    run: (projectId: string, command: string) => inv<CommandExecution>('terminal:run', projectId, command),
    stop: (id: string) => inv<boolean>('terminal:stop', id),
    history: (projectId: string) => inv<CommandExecution[]>('terminal:history', projectId),
    live: (projectId?: string) => inv<CommandExecution[]>('terminal:live', projectId),
  },
  approvals: {
    list: () => inv<ApprovalRequest[]>('approvals:list'),
    resolve: (id: string, approved: boolean, always?: boolean) => inv<boolean>('approvals:resolve', id, approved, always),
  },
  remote: {
    state: () => inv<RemoteState>('remote:state'),
    enable: (on: boolean) => inv<RemoteState>('remote:enable', on),
    generatePairing: () => inv<PairingCode>('remote:generatePairing'),
    revokeDevice: (id: string) => inv<RemoteState>('remote:revokeDevice', id),
    confirmPair: (id: string, accept: boolean) => inv<RemoteState>('remote:confirmPair', id, accept),
    setManualHost: (host: string) => inv<RemoteState>('remote:setManualHost', host),
    setPort: (port: number) => inv<RemoteState>('remote:setPort', port),
    allowOtherNetworks: () => inv<AllowNetworksResult>('remote:allowOtherNetworks'),
  },
  notifications: {
    list: () => inv<AppNotification[]>('notifications:list'),
    markRead: () => inv<boolean>('notifications:markRead'),
    clear: () => inv<boolean>('notifications:clear'),
  },
  // ─── Live Run Chat ─────────────────────────────────────────────────────────
  runChat: {
    send: (runId: string, text: string) => inv<RunChatTurn>('run:chat:send', { runId, text }),
    sendToAgent: (runId: string, agentRole: AgentRole, text: string) => inv<RunChatTurn>('run:chat:agent:send', { runId, agentRole, text }),
    history: (conversationId: string, limit?: number) => inv<RunChatTurn[]>('run:chat:history', conversationId, limit),
    stop: (conversationId: string) => inv<boolean>('run:chat:stop', conversationId),
    snapshot: (runId: string) => inv<LiveRunSnapshot>('run:chat:snapshot', runId),
    graphVersions: (runId: string) => inv<GraphVersion[]>('run:chat:graphVersions', runId),
  },
};
