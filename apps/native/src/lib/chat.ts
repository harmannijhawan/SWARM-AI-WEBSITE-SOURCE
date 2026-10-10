import { create } from 'zustand';
import type { ChatInput, Conversation } from '../../shared/chat';
import type { AgentRole } from '../../shared/types';

export interface NewChatOptions { agentRole?: AgentRole; runId?: string; projectId?: string }

const invoke = <T>(channel: string, ...args: unknown[]) => window.swarm.invoke<T>(channel, ...args);
export const chatApi = {
  list: () => invoke<Conversation[]>('chat:list'), search: (query: string) => invoke<string[]>('chat:search', query), get: (id: string) => invoke<Conversation>('chat:get', id),
  create: (options?: NewChatOptions) => invoke<Conversation>('chat:new', options), rename: (id: string, title: string) => invoke<Conversation>('chat:rename', id, title),
  remove: (id: string) => invoke<boolean>('chat:delete', id), send: (input: ChatInput) => invoke<Conversation>('chat:send', input),
  stop: (id: string) => invoke<boolean>('chat:stop', id),
};
interface ChatState {
  list: Conversation[]; current: Conversation | null; error: string;
  refresh: () => Promise<void>; open: (id: string) => Promise<void>; fresh: (options?: NewChatOptions) => Promise<void>; ingest: (c: Conversation) => void;
}
export const useChat = create<ChatState>((set, get) => ({
  list: [], current: null, error: '',
  refresh: async () => { set({ list: await chatApi.list() }); },
  open: async id => { const current = await chatApi.get(id); set({ current, error: '' }); localStorage.setItem('swarm:chat', id); },
  fresh: async options => { const c = await chatApi.create(options); get().ingest(c); set({ current: c, error: '' }); localStorage.setItem('swarm:chat', c.id); },
  ingest: c => {if((c as Conversation & {deleted?:boolean}).deleted){set(s=>({list:s.list.filter(x=>x.id!==c.id),current:s.current?.id===c.id?null:s.current}));return;}set(s => ({ list: [{ ...c, turns: [] }, ...s.list.filter(x => x.id !== c.id)].sort((a,b) => b.updatedAt-a.updatedAt), current: s.current?.id === c.id ? c : s.current }));},
}));
