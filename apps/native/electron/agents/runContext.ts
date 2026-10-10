// In-memory state of an active run, with persistence + event emission on every change.
import type { AgentMessage, AgentRole, AgentState, ManagerBrief, Project, QualityGate, ResearchFinding, ResearchSource, Run, Task, TaskKind, GateId } from '../../shared/types';
import type { Settings } from '../../shared/settings';
import { db } from '../core/db';
import { bus, emit, type EventScope } from '../core/bus';
import { readyTasks } from './scheduler';
import { runtimeManager } from '../runtime/manager';
import { listLive } from '../tools/process';
import { listApprovals } from '../tools/approvals';
import { hasActiveOperations, timeOperation } from '../core/performance';
import { uid } from '../core/util';
import { ROLES } from './roles';
import { saveCheckpoint } from '../core/checkpoint';

export interface ArchitectureSpec {
  targetPlatform?: import('../../shared/types').PlatformType;
  buildSystem?: string;
  launchCommand?: string;
  previewStrategy?: string;
  testStrategy?: string;
  packagingStrategy?: string;
  stack: string;
  summary: string;
  runtime: string;
  commands: { install?: string; dev?: string; build?: string; test?: string; typecheck?: string; lint?: string };
  files: { path: string; purpose: string }[];
  api: { method: string; path: string; description: string }[];
  conventions: string[];
}

export const GATE_LABELS: Record<GateId, string> = {
  // Universal gates
  deps: 'Dependencies',
  typecheck: 'Typecheck',
  lint: 'Lint',
  build: 'Build',
  unit: 'Unit tests',
  review: 'Final review',
  // Web-specific gates
  server: 'App starts',
  browser: 'Browser test',
  console: 'Console errors',
  responsive: 'Responsive layout',
  visual: 'Visual QA',
  // CLI-specific gates
  cli_args: 'CLI arguments',
  cli_help: 'Help output',
  cli_exit_codes: 'Exit codes',
  // Desktop-specific gates
  desktop_launch: 'Desktop launch',
  desktop_package: 'Package creation',
  // Mobile-specific gates
  mobile_build: 'Mobile build',
  mobile_emulator: 'Emulator test',
  mobile_permissions: 'Permissions',
  // Backend/API-specific gates
  service_start: 'Service starts',
  endpoint_tests: 'Endpoint tests',
  api_contract: 'API contract',
};

export class RunContext {
  readonly ctrl = new AbortController();
  readonly tasks = new Map<string, Task>();
  readonly agents = new Map<AgentRole, AgentState>();
  readonly messages: AgentMessage[] = [];
  readonly suspendedAgents = new Set<AgentRole>();
  readonly taskControllers = new Map<string, AbortController>();
  sources: ResearchSource[] = [];
  findings: ResearchFinding[] = [];
  design = '';
  architecture: ArchitectureSpec | null = null;
  devServer: { commandId: string | null; url: string; port: number; stop: () => void } | null = null;
  notes = new Map<AgentRole, string[]>();
  sourceCounter = 0;
  installLock: Promise<unknown> = Promise.resolve();
  pendingChanges = 0;
  private resumeWaiters: (() => void)[] = [];

  async waitUntilResumed() {
    while (this.run.status === 'paused' && !this.signal.aborted) {
      await new Promise<void>(resolve => {
        const wake = () => { this.signal.removeEventListener('abort', wake); resolve(); };
        this.resumeWaiters.push(wake);
        this.signal.addEventListener('abort', wake, { once: true });
      });
    }
  }

  private executionWaiters = new Set<() => void>();
  executionWake() {
    let wake!: () => void;
    const promise = new Promise<void>(resolve => { wake = resolve; this.executionWaiters.add(wake); this.signal.addEventListener('abort', wake, { once: true }); });
    return { promise, dispose: () => { this.executionWaiters.delete(wake); this.signal.removeEventListener('abort', wake); } };
  }
  wakeExecution() {
    for (const wake of this.resumeWaiters.splice(0)) wake();
    for (const wake of this.executionWaiters) wake();
    this.executionWaiters.clear();
  }
  lastActivityAt = Date.now();
  lastCheckpointAt = 0;
  heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(public run: Run, public project: Project, public settings: Settings) {
    // Start heartbeat monitoring
    this.startHeartbeat();
  }

  private startHeartbeat() {
    // Check for stalls every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.checkForStall();
    }, 30000);
  }

  private checkForStall() {
    if (this.run.status !== 'running') return;
    
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivityAt;
    const stallThreshold = 5 * 60 * 1000; // 5 minutes
    
    // Check if we have any running tasks
    const runningTasks = [...this.tasks.values()].filter(t => t.status === 'running');
    
    const busy = hasActiveOperations(this.run.id) || this.pendingChanges > 0 ||
      runtimeManager.getActiveRuntimes().some(r => r.runId === this.run.id) ||
      listLive(this.project.id).some(p => p.runId === this.run.id) ||
      listApprovals().some(a => a.runId === this.run.id) || readyTasks(this.tasks, ['test', 'review', 'visual_qa', 'finalize']).length > 0;
    if (!busy && timeSinceActivity > stallThreshold && [...this.tasks.values()].some(t => t.status === 'waiting' || t.status === 'running')) {
      // Execution appears stalled
      emit('RUN_STALLED', `No progress for ${Math.round(timeSinceActivity / 60000)} minutes. Investigating...`, 
        this.scope(), 'warning', {
          timeSinceActivity,
          runningTasks: runningTasks.map(t => ({ id: t.id, title: t.title, role: t.role })),
        });
      
      // Mark stalled tasks
      for (const task of runningTasks) {
        if (now - (task.startedAt ?? now) > stallThreshold) {
          emit('TASK_STALLED', `${ROLES[task.role].name}: ${task.title} — no progress detected`, 
            this.scope(task), 'warning', { task });
        }
      }
    }
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  get signal() { return this.ctrl.signal; }
  get root() { return this.project.path; }

  scope(taskOrAgent?: Task | AgentRole | null): EventScope {
    if (!taskOrAgent) return { projectId: this.project.id, runId: this.run.id };
    if (typeof taskOrAgent === 'string') return { projectId: this.project.id, runId: this.run.id, agent: taskOrAgent };
    return { projectId: this.project.id, runId: this.run.id, taskId: taskOrAgent.id, agent: taskOrAgent.role };
  }

  saveRun() {
    // Enhanced checkpoint with full state persistence
    saveCheckpoint(
      this.run.id,
      this.project.id,
      this.architecture,
      this.design,
      this.notes,
      this.agents,
      this.tasks,
      this.root,
      this.sourceCounter,
    );
    
    this.lastCheckpointAt = Date.now();
    db().put('runs', this.run.id, this.run, { project_id: this.run.projectId, started_at: this.run.startedAt });
    bus.send('run:updated', this.run);
  }

  setBrief(b: ManagerBrief) { this.run.brief = b; this.saveRun(); }

  addTask(t: Omit<Task, 'id' | 'runId' | 'status' | 'attempt' | 'output' | 'error' | 'modelId' | 'startedAt' | 'endedAt' | 'createdAt' | 'filesTouched' | 'tokens'> & { id?: string }): Task {
    const endGraph = timeOperation('graph', this.run.id);
    const task: Task = {
      id: t.id ?? uid('tk_'), runId: this.run.id, key: t.key, title: t.title, description: t.description, role: t.role, kind: t.kind,
      priority: t.priority ?? 0, requiredCapabilities: t.requiredCapabilities ?? [], producedArtifacts: t.producedArtifacts ?? [], consumedArtifacts: t.consumedArtifacts ?? [],
      status: 'waiting', deps: t.deps, attempt: 1, scope: t.scope, output: null, error: null, modelId: null,
      startedAt: null, endedAt: null, createdAt: Date.now(), filesTouched: [], tokens: 0,
    };
    this.tasks.set(task.id, task);
    this.wakeExecution();
    this.persistTask(task);
    this.run.stats.tasks = this.tasks.size;
    this.saveRun();
    emit('TASK_CREATED', `${ROLES[task.role].name}: ${task.title}`, this.scope(task), 'debug', { task });
    this.touchAgent(task.role, { status: this.agents.get(task.role)?.status === 'working' ? 'working' : 'waiting' });
    endGraph();
    return task;
  }

  persistTask(t: Task) { db().put('tasks', t.id, t, { run_id: t.runId, created_at: t.createdAt }); }

  updateTask(t: Task, patch: Partial<Task>, event?: { type: 'TASK_STARTED' | 'TASK_COMPLETED' | 'TASK_FAILED' | 'TASK_UPDATED'; message: string; level?: 'info' | 'success' | 'warning' | 'error' }) {
    Object.assign(t, patch);
    this.wakeExecution();
    this.persistTask(t);
    this.lastActivityAt = Date.now();
    
    if (event) emit(event.type, event.message, this.scope(t), event.level ?? 'info', { task: t });
    else emit('TASK_UPDATED', t.title, this.scope(t), 'debug', { task: t });
    const done = [...this.tasks.values()];
    this.run.stats.completed = done.filter((x) => x.status === 'completed').length;
    this.run.stats.failed = done.filter((x) => x.status === 'failed').length;
    
    // Checkpoint after significant task state changes
    if (t.status === 'completed' || t.status === 'failed') {
      this.saveRun();
    }
  }

  /** Replace dependency edges old -> new for tasks that have not started (graph rewiring for repair loops). */
  rewire(oldId: string, newId: string) {
    for (const t of this.tasks.values()) {
      if (t.status !== 'waiting' || t.id === newId) continue;
      if (t.deps.includes(oldId)) this.updateTask(t, { deps: t.deps.map((d) => (d === oldId ? newId : d)) });
    }
    emit('GRAPH_UPDATED', 'Task graph updated', this.scope('manager'), 'debug', {});
  }

  touchAgent(role: AgentRole, patch: Partial<AgentState>) {
    const prev = this.agents.get(role) ?? {
      role, status: 'idle', taskId: null, taskTitle: null, modelId: null, lastAction: null, tasksDone: 0, errors: 0, tokens: 0, filesTouched: [], updatedAt: Date.now(),
    } as AgentState;
    
    // Determine actual status based on run state and tasks
    let actualStatus = patch.status ?? prev.status;
    
    // If run is active, no agent should be truly "idle"
    if (this.run.status === 'running') {
      const agentTasks = [...this.tasks.values()].filter(t => t.role === role);
      const hasWaitingTasks = agentTasks.some(t => t.status === 'waiting');
      const hasRunningTasks = agentTasks.some(t => t.status === 'running');
      const hasCompletedTasks = agentTasks.some(t => t.status === 'completed');
      const allTasksComplete = hasCompletedTasks && agentTasks.every(t => t.status === 'completed' || t.status === 'skipped' || t.status === 'cancelled');
      
      // Override "idle" with more accurate status during active run
      if (actualStatus === 'idle' && hasWaitingTasks) {
        actualStatus = 'available'; // Has tasks but not currently executing
      } else if (actualStatus === 'idle' && hasRunningTasks) {
        actualStatus = 'working'; // Should be working
      } else if (actualStatus === 'idle' && allTasksComplete) {
        actualStatus = 'completed'; // All work done
      } else if (actualStatus === 'idle' && hasCompletedTasks) {
        actualStatus = 'available'; // Some work done, may have more
      }
    }
    
    const activeTask = [...this.tasks.values()].find(t => t.role === role && t.status === 'running');
    if (activeTask && actualStatus === 'completed') actualStatus = 'working';
    const next = { ...prev, ...patch, ...(activeTask ? { taskId: activeTask.id, taskTitle: activeTask.title } : {}), status: actualStatus, updatedAt: Date.now() };
    this.agents.set(role, next);
    emit('AGENT_STATUS', `${ROLES[role].name}: ${next.status}`, this.scope(role), 'debug', { agent: next });
  }

  message(from: AgentRole, to: AgentRole | 'all', content: string, taskId: string | null = null, type: import('../../shared/types').AgentMessageType = 'STATUS', payload?: Record<string, unknown>) {
    const end = timeOperation('message', this.run.id);
    const m: AgentMessage = { id: uid('msg_'), ts: Date.now(), runId: this.run.id, from, to, content, taskId, type, payload, priority: ['ERROR', 'BLOCKED', 'ESCALATION', 'TEST_FAILURE'].includes(type) ? 'high' : 'normal', relatedTaskIds: taskId ? [taskId] : [], relatedArtifactIds: [] };
    this.messages.push(m);
    db().put('messages', m.id, m, { run_id: m.runId, ts: m.ts });
    emit('AGENT_MESSAGE', content, { ...this.scope(from), taskId }, 'info', { message: m });
    this.lastActivityAt = Date.now();
    this.wakeExecution();
    end();
    return m;
  }

  inbox(role: AgentRole, limit = 6): AgentMessage[] {
    return this.messages.filter((m) => m.to === role || m.to === 'all').slice(-limit);
  }

  note(role: AgentRole, text: string) {
    const list = this.notes.get(role) ?? [];
    list.push(text); this.notes.set(role, list.slice(-8));
  }

  setGate(id: GateId, status: QualityGate['status'], detail: string | null = null) {
    let g = this.run.gates.find((x) => x.id === id);
    if (!g) { g = { id, label: GATE_LABELS[id], status, detail, ts: Date.now(), attempt: 1 }; this.run.gates.push(g); }
    else { if (status === 'running' && g.status !== 'pending' && g.status !== 'running') g.attempt++; g.status = status; g.detail = detail; g.ts = Date.now(); }
    const type = status === 'running' ? 'TEST_STARTED' : status === 'passed' ? 'TEST_PASSED' : status === 'failed' ? 'TEST_FAILED' : status === 'skipped' ? 'TEST_SKIPPED' : 'TEST_STARTED';
    if (status !== 'pending') emit(type, `${GATE_LABELS[id]}: ${status === 'running' ? 'running' : status}${detail && status !== 'running' ? ` — ${detail.split('\n')[0].slice(0, 160)}` : ''}`, this.scope('tester'), status === 'passed' ? 'success' : status === 'failed' ? 'error' : 'info', { gate: id, status });
    this.saveRun();
  }

  newTaskKey(kind: TaskKind) { return `${kind}-${[...this.tasks.values()].filter((t) => t.kind === kind).length + 1}`; }
}
