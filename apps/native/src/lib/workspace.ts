import { create } from 'zustand';
import type { AgentRole, AgentState, ApprovalRequest, FileChange, Run } from '../../shared/types';
import type { WorkspaceEvent, WorkspaceFile, WorkspaceSnapshot } from '../../shared/workspace';
import { chatApi, useChat } from './chat';
import { useStore } from './store';

export type WorkEvent = WorkspaceEvent;
export type WorkFile = WorkspaceFile;
export interface WorkScope { conversationId?: string; runId?: string; projectId?: string }
export type WorkSnapshot = WorkspaceSnapshot;
export function belongsToWork(event: WorkEvent, scope: WorkScope) {
  if (scope.runId && event.runId === scope.runId) return true;
  if (scope.conversationId && event.conversationId === scope.conversationId) return true;
  if (scope.conversationId && event.runId === scope.conversationId) return true;
  if (!scope.conversationId && !scope.runId && scope.projectId) return event.projectId === scope.projectId;
  return !scope.conversationId && !scope.runId && !scope.projectId;
}
export function mergeWorkEvents(existing: WorkEvent[], incoming: WorkEvent[]) {
  const items = new Map(existing.map(event => [event.id, event]));
  for (const event of incoming) if (!items.has(event.id) || items.get(event.id)!.sequence <= event.sequence) items.set(event.id, event);
  return [...items.values()].sort((a, b) => a.ts - b.ts || a.sequence - b.sequence).slice(-600);
}
/** Fold a tool's start and finish into one card, while preserving unrelated operations. */
export function workActivity(events: WorkEvent[]) {
  const items = new Map<string, WorkEvent>();
  for (const event of events) {
    if (['message', 'assistant_message', 'agent_status', 'agent_message'].includes(event.type)) continue;
    const group = event.type.startsWith('command_') ? 'command' : event.type.startsWith('tool_') ? 'tool' : event.type.startsWith('task_') ? 'task' : event.type.startsWith('search_') ? 'search' : '';
    const operation = event.data?.commandId ?? event.data?.activityId ?? event.taskId;
    const key = group && operation ? `${group}:${operation}` : event.id;
    items.set(key, event);
  }
  return [...items.values()].sort((a, b) => b.ts - a.ts).slice(0, 100);
}
export const workApi = {
  snapshot: (scope: WorkScope) => window.swarm.invoke<WorkSnapshot>('workspace:snapshot', { ...scope, limit: 600 }),
  file: (id: string) => window.swarm.invoke<FileChange>('workspace:file', id),
};
interface WorkState {
  scope: WorkScope; events: WorkEvent[]; agents: AgentState[]; files: WorkFile[];
  approvals: ApprovalRequest[]; run?: Run; error: string; loading: boolean;
  open: (scope: WorkScope) => Promise<void>; refresh: () => Promise<void>; ingest: (event: WorkEvent) => void;
}
let revision = 0;
export const useWork = create<WorkState>((set, get) => ({
  scope: {}, events: [], agents: [], files: [], approvals: [], error: '', loading: false,
  open: async scope => {
    const ticket = ++revision;
    set({ scope, events: [], agents: [], files: [], approvals: [], run: undefined, error: '', loading: true });
    try {
      const snapshot = await workApi.snapshot(scope);
      if (ticket !== revision) return;
      set(state => ({ ...snapshot, scope, events: mergeWorkEvents(snapshot.events, state.events), loading: false }));
    } catch (error) { if (ticket === revision) set({ error: String(error), loading: false }); }
  },
  refresh: async () => {
    const ticket = revision;
    const scope = get().scope;
    try {
      const snapshot = await workApi.snapshot(scope);
      if (ticket !== revision) return;
      set(state => ({ ...snapshot, scope, events: mergeWorkEvents(snapshot.events, state.events), error: '' }));
    } catch (error) { if (ticket === revision) set({ error: String(error) }); }
  },
  ingest: event => {
    if (!belongsToWork(event, get().scope)) return;
    set(state => ({ events: mergeWorkEvents(state.events, [event]) }));
  },
}));

export async function openAgentChat(agentRole: AgentRole, scope: WorkScope) {
  const chats = await chatApi.list();
  const existing = chats.find(chat => chat.agentRole === agentRole && chat.runId === scope.runId && chat.projectId === scope.projectId);
  if (existing) await useChat.getState().open(existing.id);
  else await useChat.getState().fresh({ agentRole, runId: scope.runId, projectId: scope.projectId });
  useStore.getState().setView('chat');
}
