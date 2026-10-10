'use client';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type UIEvent } from 'react';
import {setAuthTokenGetter,getAuthToken} from '@/lib/cloud-api/custom-fetch';
import { SettingsWorkspace, PreferenceEffects } from './settings-workspace';
import { AccountPanel, DesktopConnect } from './account-panel';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from '@clerk/react';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check, CircleHelp, Clock3,
  Copy, Workflow, Smartphone, MessageSquareText, FileCode2, KeyRound, LockKeyhole, LogOut, Menu, MessageSquarePlus, MoreHorizontal, PanelLeftClose,
  PanelLeftOpen, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, X, Zap,
} from 'lucide-react';
import {
  getConversation, getGetConversationQueryKey, getListConversationsQueryKey, getListModelsQueryKey,
  getListProvidersQueryKey, useCreateConversation, useDeleteConversation, useDeleteProvider,
  useGetConversation, useListConversations, useListModels, useListProviders,
  useRenameConversation, useSaveProvider,
} from '@/lib/cloud-api';
import type { Conversation, Message, ProviderSummary, StreamConversationInput } from '@/lib/cloud-api';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
function useLocation(): [string, (to: string, options?: { replace?: boolean }) => void] { const path = usePathname(); const router = useRouter(); return [path, (to, options) => options?.replace ? router.replace(to) : router.push(to)]; }
function Redirect({ to }: { to: string }) { const router = useRouter(); useEffect(() => {const target=to==='/sign-in'?to+'?redirect_url='+encodeURIComponent(window.location.pathname+window.location.search):to;router.replace(target);}, [router, to]); return null; }

import { codeFiles } from '@/lib/code-files';
import { BuildLayout, type BuildEvent } from '@/components/cloud/build-layout';
import { ChatMarkdown } from '@/components/cloud/chat-markdown';
import { ErrorBoundary } from '@/components/cloud/error-boundary';
import { consumeChatStream, ChatStreamError, retryDisposition } from '@/lib/chat-stream';



const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchInterval: 30_000, refetchOnWindowFocus: true, retry: false } } });
const basePath = '';
const clerkPubKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
function stripBase(path: string) { return path; }

const appearance = {
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `/brand/swarm-wordmark.png` },
  variables: {
    colorPrimary: '#216bd0', colorForeground: '#101114', colorMutedForeground: '#6f6f6f',
    colorDanger: '#bd4949', colorBackground: '#ffffff', colorInput: '#f8f8f8',
    colorInputForeground: '#101114', colorNeutral: '#e0e0e0', fontFamily: 'Manrope, sans-serif', borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#101114] font-bold', headerSubtitle: 'text-[#6f6f6f]',
    socialButtonsBlockButtonText: 'text-[#101114]', formFieldLabel: 'text-[#3d3d3d]',
    footerActionLink: 'text-[#101114] font-semibold', footerActionText: 'text-[#6f6f6f]',
    dividerText: 'text-[#6f6f6f]', identityPreviewEditButton: 'text-[#101114]',
    formFieldSuccessText: 'text-[#494949]', alertText: 'text-[#943e3e]',
    logoBox: 'h-10', logoImage: 'max-h-9', socialButtonsBlockButton: 'border-[#e0e0e0] hover:bg-[#f4f4f4]',
    formButtonPrimary: 'bg-[#216bd0] hover:bg-[#1755ab]', formFieldInput: 'bg-[#f8f8f8] border-[#e0e0e0]',
    footerAction: 'border-t border-[#e9e9e9]', dividerLine: 'bg-[#e0e0e0]', alert: 'bg-[#f7f7f7]',
    otpCodeFieldInput: 'border-[#e0e0e0]', formFieldRow: 'gap-1', main: 'gap-4',
  },
};

type StreamUpdate = {
  type?: string; event?: string; token?: string; content?: string; text?: string;
  message?: string; status?: string; agent?: string; role?: string; name?: string;
  modelId?: string; providerId?: string; displayName?: string; providerName?: string; automatic?: boolean;
  output?: string; error?: string; conversation?: Conversation; data?: unknown;
};

function Brand({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  return <img className="logo-img" src="/brand/swarm-wordmark.png" alt="SWARM" style={{ width: size === 'large' ? 146 : 103, height: size === 'large' ? 27 : 20 }} />;
}

function ClerkCacheReset() {
  const { addListener } = useClerk();
  const {getToken}=useAuth();
  useEffect(()=>{setAuthTokenGetter(getToken);return()=>setAuthTokenGetter(null);},[getToken]);
  const cache = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== userId) cache.clear();
    previous.current = userId;
  }), [addListener, cache]);
  return null;
}

function SignInPage() {
  return <div className="min-h-[100dvh] grid place-items-center px-4 py-10 bg-white"><div className="w-full max-w-[440px]"><div className="mb-7 flex justify-center"><Brand /></div><SignIn fallbackRedirectUrl="/app" routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>;
}
function SignUpPage() {
  return <div className="min-h-[100dvh] grid place-items-center px-4 py-10 bg-white"><div className="w-full max-w-[440px]"><div className="mb-7 flex justify-center"><Brand /></div><SignUp fallbackRedirectUrl="/app" routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>;
}
function Protected({ children }: { children: ReactNode }) {
  return <><Show when="signed-in"><PreferenceEffects/>{children}</Show><Show when="signed-out"><Redirect to="/sign-in" /></Show></>;
}

function SignOutButton() {
  const { signOut } = useClerk();
  return <button data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-secondary"><LogOut size={14} /> Sign out</button>;
}

type ResponseMode = 'chat'|'swarm';
function PrivateShell({ children, mode, onMode }: { children: ReactNode; mode?:ResponseMode;onMode?:(mode:ResponseMode)=>void }) {
  return <div className="cloud-shell desktop-web-shell flex h-[100dvh] flex-col bg-background">
    <header className="desktop-web-topbar"><Link href="/" aria-label="SWARM home" className="desktop-web-brand"><img src="/swarm-icon.png" alt=""/><span>SWARM</span></Link><nav aria-label="Workspace navigation">{onMode?<><button aria-current={mode==='chat'?'page':undefined} onClick={()=>onMode('chat')}><MessageSquareText size={16}/> Chat</button><button aria-current={mode==='swarm'?'page':undefined} onClick={()=>onMode('swarm')}><Workflow size={16}/> Build</button></>:<><Link href="/app?mode=chat"><MessageSquareText size={16}/> Chat</Link><Link href="/app?mode=build"><Workflow size={16}/> Build</Link></>}<Link href="/#download"><Smartphone size={16}/> Downloads</Link><Link href="/app/settings"><Settings2 size={16}/> Settings</Link></nav><div className="desktop-web-account">{clerkPubKey?<SignOutButton/>:<Link href="/sign-in">Log in <ArrowRight size={13}/></Link>}</div></header><main className="min-h-0 flex-1">{children}</main>
  </div>;
}

function dateGroup(iso: string) {
  const today = new Date(); today.setHours(0,0,0,0);
  const day = new Date(iso); day.setHours(0,0,0,0);
  const age = Math.round((today.getTime() - day.getTime()) / 86400000);
  return age === 0 ? 'Today' : age === 1 ? 'Yesterday' : age < 7 ? 'Previous 7 days' : 'Older';
}
function ChatApp() { const [mode,setMode]=useState<ResponseMode>('chat');return <PrivateShell mode={mode} onMode={setMode}><Workspace mode={mode} setMode={setMode}/></PrivateShell>; }

function Workspace({mode,setMode}:{mode:ResponseMode;setMode:(mode:ResponseMode)=>void}) {
  const cache = useQueryClient();
  const pathname=usePathname();
  useEffect(()=>{const params=new URLSearchParams(window.location.search);setMode(params.get('mode')==='build'?'swarm':'chat');if(params.get('prompt'))setDraft(params.get('prompt')!);if(params.get('conversation'))setSelectedId(params.get('conversation'));},[pathname]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [agentEvents, setAgentEvents] = useState<string[]>([]);
  const [buildEvents, setBuildEvents] = useState<BuildEvent[]>([]);
  const [streamError, setStreamError] = useState('');
  const [retryRequest, setRetryRequest] = useState<{id:string;payload:StreamConversationInput;requestId:string}|null>(null);
  const [modelId, setModelId] = useState('auto');
  const [activeModel, setActiveModel] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => { setSidebarOpen(window.matchMedia('(min-width: 768px)').matches); }, []);
  const [editingMessage, setEditingMessage] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [scrollDown, setScrollDown] = useState(false);
  const idForRefresh = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const { data: conversationsResult, isLoading, isError, refetch } = useListConversations(search.trim() ? { q: search.trim() } : undefined);
  const { data: detail, isLoading: detailLoading, isError: detailError, refetch: reloadDetail } = useGetConversation(selectedId ?? '', { query: { enabled: !!selectedId, queryKey: getGetConversationQueryKey(selectedId ?? '') } });
  const { data: modelsResult, isLoading: modelsLoading } = useListModels();
  const { data: providersResult } = useListProviders();
  const createConversation = useCreateConversation();
  const renameConversation = useRenameConversation();
  const deleteConversation = useDeleteConversation();
  const conversations = conversationsResult?.conversations ?? [];
  const models = modelsResult?.models ?? [];
  const providers = providersResult?.providers ?? [];
  const validModels = models.filter((model) => providers.find((p) => p.providerId === model.providerId)?.configured);
  const selectedModel = modelId === 'auto' && validModels.length ? { id:'auto', providerId:validModels[0].providerId, modelId:'auto', displayName:'Auto', providerName:'SWARM router' } : validModels.find(model => model.id === modelId) ?? validModels[0];
  const activeMessages = (detail?.messages ?? []) as Message[];
  const [draftMessages, setDraftMessages] = useState<Message[]>([]);
  const renderedMessages = [...activeMessages, ...draftMessages];
  const idleBuild=mode==='swarm'&&!renderedMessages.length&&!busy;
  const latestBuildEvents=buildEvents.length?buildEvents:((activeMessages.at(-1) as Message & {buildEvents?:BuildEvent[]})?.buildEvents||[]);
  const generatedFiles=codeFiles([...activeMessages].reverse().find(m=>m.role==='assistant')?.content||streaming);
  const prefill=(value:string)=>{setDraft(value);inputRef.current?.focus();};


  useEffect(() => { setDraftMessages([]); setStreaming(''); setAgentEvents([]); setBuildEvents([]); setStreamError(''); setRetryRequest(null); setEditingMessage(null); }, [selectedId]);
  useEffect(() => {
    const start = () => { setSelectedId(null); setDraft(''); setDraftMessages([]); setStreaming(''); inputRef.current?.focus(); };
    window.addEventListener('swarm:new-chat', start);
    return () => window.removeEventListener('swarm:new-chat', start);
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [renderedMessages.length, streaming, agentEvents.length]);
  const invalidateConversation = (id?: string) => {
    void cache.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    if (id) void cache.invalidateQueries({ queryKey: getGetConversationQueryKey(id) });
  };

  async function streamRequest(payload: StreamConversationInput, promptLabel?: string) {
    if(requestRef.current)return;
    setBusy(true); setStreamError(''); setRetryRequest(null); setStreaming(''); setAgentEvents([]); setBuildEvents([]); setActiveModel('');
    const controller = new AbortController(); requestRef.current = controller;
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;controller.abort();},270_000);
    let streamId:string|undefined;
    const clientRequestId=crypto.randomUUID();
    try {
      let id = selectedId;
      if (!id) {
        const created = await createConversation.mutateAsync({ data: { title: promptLabel?.slice(0, 72) || 'New conversation' } });
        id = created.id; setSelectedId(id);
        void cache.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      }
      idForRefresh.current = id;
      streamId=id;
      if (payload.action === 'send' && payload.prompt) {
        setDraftMessages((current) => [...current, { id: Date.now(), role: 'user', content: payload.prompt!, createdAt: new Date().toISOString() }]);
      }
      const authToken=await getAuthToken();
      const response = await fetch(`/api/conversations/${id}/stream`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream',...(authToken?{Authorization:'Bearer '+authToken}:{}) },
        body: JSON.stringify({...payload,requestId:clientRequestId}), signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ChatStreamError(body?.error || `Request failed (${response.status})`, response.status===401?'auth':'server',response.status===429||response.status>=500);
      }
      if (!response.body) throw new Error('The response stream is unavailable.');
      await consumeChatStream(response.body,controller.signal,(type,data)=>{
          const event=data as StreamUpdate;
          const nested = event.data && typeof event.data === 'object' ? event.data as StreamUpdate : undefined;
          if (type === 'model') {
            setActiveModel(`${event.displayName || event.modelId} · ${event.providerName || event.providerId}`);
          } else if (type === 'reset') { setStreaming('');
          } else if (type === 'routing') { setActiveModel(event.message || 'Trying another model…');
          } else if (type === 'delta') {
            const token = event.token ?? nested?.token;
            if (typeof token === 'string') setStreaming((current) => current + token);
          } else if (type === 'agent') {
            const role = event.role ?? nested?.role;
            const name = event.name ?? nested?.name;
            const status = event.status ?? nested?.status;
            if (role && name && status) { setAgentEvents((current) => [...current, `${role} · ${name} · ${status}`]); setBuildEvents(current => [...current, {role,name,status,time:Date.now(),output:event.output ?? nested?.output}]); }
          } else if (type === 'done') {
            const finalMessage = event.message ?? nested?.message;
            if (typeof finalMessage === 'string') setStreaming(finalMessage);
            const finalConversation = event.conversation ?? nested?.conversation;
            if (finalConversation && typeof finalConversation === 'object') cache.setQueryData(getGetConversationQueryKey(id), finalConversation);
          } else if (!type && (event.token || event.content || event.text)) {
            setStreaming((current) => current + (event.token ?? event.content ?? event.text ?? ''));
          }
      });
      setDraftMessages([]);
      invalidateConversation(id);
      await cache.invalidateQueries({ queryKey: getGetConversationQueryKey(id) });
      await cache.refetchQueries({ queryKey: getGetConversationQueryKey(id), type: 'active' });
      await cache.invalidateQueries({ queryKey: getListModelsQueryKey() });
      setStreaming('');
    } catch (error) {
      if (!controller.signal.aborted||timedOut) {
        setStreamError(timedOut?'This request reached its time limit. Your message is saved.':error instanceof ChatStreamError?error.message:'The connection was lost. Reconnect and try again.');
        if(payload.prompt)setDraft(current=>current||payload.prompt!);
        if(streamId&&payload.action!=='continue'&&(!(error instanceof ChatStreamError)||error.retryable))setRetryRequest({id:streamId,payload,requestId:clientRequestId});
      }
      if (idForRefresh.current) invalidateConversation(idForRefresh.current);
      setDraftMessages([]);
    } finally { clearTimeout(timeout);requestRef.current = null; setBusy(false); }
  }

  async function retryFailedResponse() {
    if(!retryRequest||busy)return;
    const {id,payload,requestId}=retryRequest;
    try {
      const conversation=await cache.fetchQuery({queryKey:getGetConversationQueryKey(id),queryFn:({signal})=>getConversation(id,{signal}),staleTime:0});
      const saved=conversation as Conversation;
      const disposition=retryDisposition(saved.messages,payload.action,requestId,payload.messageId);
      if(disposition.type==='restore'){setStreamError('Your message is in the input. Send it when you are connected.');setRetryRequest(null);return;}
      if(disposition.type==='complete'){cache.setQueryData(getGetConversationQueryKey(id),saved);setStreamError('');setRetryRequest(null);setStreaming('');setDraft(current=>current===payload.prompt?'':current);return;}
      setDraft(current=>current===payload.prompt?'':current);
      void streamRequest({...payload,action:'regenerate',messageId:disposition.messageId});
    }catch {setStreamError('Still unable to reconnect. Your message and history are preserved.');}
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !draft.trim()) return;
    if (!selectedModel) { setStreamError('Connect a provider and choose an available model in Settings before sending.'); return; }
    const prompt = draft.trim();
    setDraft('');
    void streamRequest({ action: editingMessage ? 'edit' : 'send', prompt, ...(editingMessage ? { messageId: editingMessage } : {}), providerId: selectedModel.providerId, modelId: selectedModel.modelId, mode }, prompt);
    setEditingMessage(null);
  }
  function startEdit(message: Message) { setEditingMessage(message.id); setDraft(message.content); inputRef.current?.focus(); }
  function respondTo(action: 'regenerate'|'continue', message?: Message) {
    if (!selectedModel || busy) return;
    void streamRequest({ action, ...(message ? { messageId: message.id } : {}), providerId: selectedModel.providerId, modelId: selectedModel.modelId, mode });
  }
  async function doRename(id: string, title: string) {
    const next = window.prompt('Rename conversation', title);
    if (!next?.trim() || next.trim() === title) return;
    await renameConversation.mutateAsync({ id, data: { title: next.trim() } });
    invalidateConversation(id);
  }
  async function doDelete(id: string, title: string) {
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return;
    await deleteConversation.mutateAsync({ id });
    if (selectedId === id) { setSelectedId(null); setDraftMessages([]); }
    invalidateConversation(id);
  }
  function onScroll(event: UIEvent<HTMLDivElement>) { const el = event.currentTarget; setScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 140); }

  return <div className={`desktop-web-workspace flex h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden ${idleBuild?'build-welcome':''}`}>
    {sidebarOpen && <aside className="desktop-web-history fixed inset-y-14 left-0 z-30 flex h-[calc(100dvh-3.5rem)] w-[270px] shrink-0 flex-col border-r border-border bg-sidebar shadow-xl md:static md:z-auto md:h-auto md:shadow-none">
      <div className="px-4 pb-3 pt-4"><button onClick={() => { setSelectedId(null); setDraftMessages([]); setDraft(''); setStreamError(''); }} disabled={busy} className="mb-3 flex w-full items-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-40"><Plus size={15} /> New chat</button><label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-[#101114]/20"><Search size={14} /><input data-testid="input-search-conversations" className="w-full bg-transparent text-xs text-foreground outline-none" placeholder="Search chats" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-4">
        {isLoading ? <div className="space-y-2 p-2" role="status" aria-label="Loading conversations">{[0,1,2,3].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />)}</div>
          : isError ? <div className="m-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">Conversation history couldn’t load.<button className="mt-2 block font-bold underline" onClick={() => void refetch()}>Try again</button></div>
            : !conversations.length ? <div className="m-3 rounded-xl border border-dashed border-border px-3 py-5 text-center"><Clock3 className="mx-auto mb-2 text-muted-foreground" size={17} /><p className="text-xs font-semibold">{search ? 'No matches' : 'Nothing here yet'}</p><p className="mt-1 text-[11px] text-muted-foreground">{search ? 'Try another search term.' : 'Your saved conversations will appear here.'}</p></div>
              : ['Today','Yesterday','Previous 7 days','Older'].map((group) => {
                const groupItems = conversations.filter((item) => dateGroup(item.updatedAt) === group);
                return groupItems.length ? <section key={group} className="mb-3"><h2 className="px-3 pb-1 pt-3 font-mono text-[9px] font-medium uppercase tracking-[.17em] text-muted-foreground">{group}</h2>{groupItems.map((item) => <div key={item.id} className={`group mb-0.5 flex items-center rounded-lg ${selectedId === item.id ? 'bg-[#e8e8e8] text-[#454545]' : 'text-muted-foreground hover:bg-secondary'}`}><button data-testid={`conversation-${item.id}`} disabled={busy} onClick={() => { setSelectedId(item.id); if (window.innerWidth < 768) setSidebarOpen(false); }} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-xs font-semibold">{item.title}</button><details className="relative mr-1"><summary aria-label={`Conversation actions: ${item.title}`} className="list-none rounded p-1 opacity-0 hover:bg-white group-hover:opacity-100 focus:opacity-100"><MoreHorizontal size={15} /></summary><div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-border bg-card p-1 shadow-lg"><button data-testid={`rename-conversation-${item.id}`} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary" onClick={() => void doRename(item.id,item.title)}><Pencil size={13} /> Rename</button><button data-testid={`delete-conversation-${item.id}`} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-destructive hover:bg-destructive/5" onClick={() => void doDelete(item.id,item.title)}><Trash2 size={13} /> Delete</button></div></details></div>)}</section> : null;
              })}
      </div>
      <div className="border-t border-border p-3"><Link href="/app/settings" className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary"><Settings2 size={15} /> Provider settings <ArrowRight className="ml-auto" size={13} /></Link></div>
    </aside>}
    {sidebarOpen && <button aria-label="Close conversation history" onClick={() => setSidebarOpen(false)} className="fixed inset-x-0 bottom-0 top-14 z-20 bg-[#10111466] md:hidden" />}
    <BuildLayout conversationId={selectedId} artifactText={[...activeMessages].reverse().find(m=>m.role==='assistant')?.content||''} onChat={()=>setMode('chat')} enabled={mode === 'swarm' && !idleBuild} busy={busy} events={buildEvents.length ? buildEvents : ((activeMessages.at(-1) as Message & {buildEvents?:BuildEvent[]})?.buildEvents || [])} objective={[...activeMessages,...draftMessages].filter(m=>m.role === 'user').at(-1)?.content || draft} error={streamError}>
    <section className={`desktop-web-conversation flex min-w-0 flex-1 flex-col ${idleBuild?'desktop-build-welcome':''}`}>
      <div className="desktop-conversation-heading"><div><button data-testid="button-toggle-history" aria-label={sidebarOpen?'Hide history':'Show history'} onClick={()=>setSidebarOpen(!sidebarOpen)}>{sidebarOpen?<PanelLeftClose size={16}/>:<PanelLeftOpen size={16}/>}</button><div><strong>{detail?.title||(mode==='swarm'?'Build':'SWARM')}</strong><p>{mode==='swarm'?'Plan, code, review, package':'Your coordinator'}</p></div></div><span className="desktop-live-pill"><Activity size={14}/>{busy?'Working':'Live work'}</span></div>
      <div className="desktop-message-area relative min-h-0 flex-1">
        <div className="scroll-thin h-full overflow-y-auto" onScroll={onScroll}>
          {detailLoading && selectedId ? <div className="mx-auto max-w-[760px] space-y-6 px-6 py-12" role="status" aria-label="Loading conversation">{[1,2,3].map((i) => <div key={i} className="animate-pulse space-y-2"><div className="h-3 w-20 rounded bg-muted" /><div className="h-4 w-full rounded bg-muted" /><div className="h-4 w-4/5 rounded bg-muted" /></div>)}</div>
            : detailError && selectedId ? <div className="mx-auto mt-24 max-w-md rounded-2xl border border-destructive/20 bg-card p-7 text-center"><CircleHelp className="mx-auto text-destructive" size={24} /><h2 className="mt-3 font-bold">Couldn’t open this conversation</h2><p className="mt-2 text-sm text-muted-foreground">Try again or select another conversation.</p><button data-testid="button-retry-conversation" onClick={() => void reloadDetail()} className="mt-4 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold">Retry</button></div>
              : !renderedMessages.length && !busy ? <div className={`desktop-welcome ${idleBuild?'desktop-welcome-build':'desktop-welcome-chat'}`}>
                {idleBuild?<span className="desktop-build-eyebrow">AUTONOMOUS WORKSPACE</span>:<img src="/swarm-icon.png" alt="" className="desktop-welcome-mark"/>}
                <h1>{idleBuild?'What should SWARM build?':'What shall we work on?'}</h1><p>{idleBuild?'Describe the outcome and target platform. SWARM will plan, build, and review the code.':'Talk to SWARM. Explore an idea, work through a problem, or create your next project.'}</p>
                {!validModels.length&&!modelsLoading&&<Link className="desktop-provider-link" href="/app/settings"><KeyRound size={15}/> Connect providers</Link>}
                <div className="desktop-welcome-suggestions">{(idleBuild?[['Web','Build a website that '],['Windows','Build a Windows app that '],['Android','Build an Android app that '],['CLI','Create a CLI tool that ']]:[['Explore an idea','Help me develop an idea for '],['Explain some code','Explain this code: '],['Build a website','Build a website that ']]).map(([label,prompt])=><button key={label} onClick={()=>{if(!idleBuild&&label==='Build a website')setMode('swarm');prefill(prompt);}}>{label}{idleBuild&&<ArrowUpRight size={12}/>}</button>)}</div>
              </div>
              : <div className="mx-auto max-w-[760px] px-6 pb-12 pt-7">
                {renderedMessages.map((message, index) => <article key={`${message.id}-${index}`} data-testid={`message-${message.id}`} className={`appear py-6 ${message.role === 'user' ? 'border-t border-border' : ''}`}>
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.12em] text-muted-foreground">{message.role === 'user' ? 'You' : <><img src="/brand/swarm-mark.png" alt="" className="h-4 w-4 object-contain" /> SWARM</>}<span className="ml-auto normal-case tracking-normal font-medium">{message.role === 'assistant' && (message as Message & { modelName?: string }).modelName && <span className="mr-2 hidden sm:inline">{(message as Message & { modelName?: string }).modelName}</span>}{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
                  <div className="message-content text-[14px] text-foreground">{message.role === 'assistant' ? <ChatMarkdown text={message.content} /> : message.content}</div>
                  {message.role === 'user' && <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground"><button data-testid={`edit-message-${message.id}`} disabled={busy || !selectedModel} onClick={() => startEdit(message)} className="hover:text-foreground disabled:opacity-40">Edit</button></div>}
                  {message.role === 'assistant' && <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground"><button data-testid={`copy-message-${message.id}`} onClick={() => void navigator.clipboard.writeText(message.content)} className="inline-flex items-center gap-1 hover:text-foreground"><Copy size={12} /> Copy</button><button data-testid={`regenerate-message-${message.id}`} disabled={busy || !selectedModel || !renderedMessages.slice(0,index).some((entry) => entry.role === 'user')} onClick={() => { const previousUser = renderedMessages.slice(0,index).reverse().find((entry) => entry.role === 'user'); if (previousUser) respondTo('regenerate', previousUser); }} className="hover:text-foreground disabled:opacity-40">Regenerate</button><button data-testid={`continue-message-${message.id}`} disabled={busy || !selectedModel} onClick={() => respondTo('continue', message)} className="hover:text-foreground disabled:opacity-40">Continue</button></div>}
                </article>)}
                {agentEvents.map((event, index) => <div key={`${index}-${event}`} data-testid={`agent-status-${index}`} role="status" className="mb-2 flex items-center gap-2 text-xs text-[#101114]"><Activity size={13} />{event}</div>)}
                {busy && <article className="py-5" role="status" aria-label="Response streaming"><div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#101114]"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#101114]" />{mode === 'swarm' ? 'Build response' : 'Response'}</div><div className="message-content text-sm">{streaming ? <ChatMarkdown text={streaming} /> : <span className="text-muted-foreground">Waiting for response…</span>}</div></article>}
                <div ref={endRef} />
              </div>}
        </div>
        {scrollDown && <button data-testid="button-scroll-bottom" onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth' })} className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card p-2 shadow-md" aria-label="Scroll to latest message"><ArrowDown size={15} /></button>}
      </div>
      <div className="desktop-composer-wrap shrink-0 bg-background px-4 pb-4 pt-3 md:px-8">
        <div className="mx-auto max-w-[760px]">
          {streamError && <div data-testid="status-stream-error" role="alert" className="mb-2 flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"><span>{streamError}</span>{retryRequest&&<button disabled={busy} className="ml-3 font-bold underline" onClick={()=>void retryFailedResponse()}>Retry</button>}<button aria-label="Dismiss error" onClick={() => setStreamError('')}><X size={14} /></button></div>}
          {editingMessage && <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">Editing your message<button data-testid="button-cancel-edit" onClick={() => { setEditingMessage(null); setDraft(''); }} className="font-semibold text-foreground">Cancel</button></div>}
          <form data-testid="form-chat-composer" onSubmit={submit} className="rounded-2xl border border-border bg-card p-3 shadow-[0_8px_28px_rgba(16,17,20,.06)] focus-within:border-[#aaaaaa]">
            <textarea ref={inputRef} data-testid="input-chat-prompt" aria-label="Message SWARM" rows={2} maxLength={32000} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} placeholder={validModels.length ? (mode==='swarm'?'What do you want to build?':'Ask SWARM anything…') : 'Connect a provider to start a conversation…'} disabled={!validModels.length || busy} className="min-h-[52px] max-h-48 w-full resize-y bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60" />
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <label className="sr-only" htmlFor="model-select">Provider and model</label>
              <select id="model-select" data-testid="select-chat-model" value={selectedModel?.id ?? ''} onChange={(e) => setModelId(e.target.value)} disabled={busy || !validModels.length || modelsLoading} className="max-w-[min(54vw,280px)] rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-[#101114]/20">
                {!validModels.length && <option value="">{modelsLoading ? 'Loading models…' : 'No connected models'}</option>}
                {validModels.length > 0 && <option value="auto">Auto · SWARM main router</option>}
                {validModels.map((model) => <option key={model.id} value={model.id}>{model.displayName} · {model.providerName}</option>)}
              </select>
              {selectedModel && <span className="hidden text-[10px] text-muted-foreground sm:inline">{modelId === 'auto' ? activeModel || 'Chooses the best available model' : selectedModel.modelId}</span>}
              {!validModels.length && <Link href="/app/settings" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#101114]"><Plus size={13} /> Settings</Link>}
              <span className="ml-auto text-[10px] text-muted-foreground">{mode === 'swarm' ? 'Enter to run' : 'Enter to send'}</span>
              <>{busy && <button type="button" data-testid="button-stop-response" onClick={() => requestRef.current?.abort()} className="rounded-full border border-border px-3 py-2 text-xs font-semibold">Stop</button>}</><button data-testid="button-send-message" type="submit" disabled={busy || !draft.trim() || !selectedModel} aria-label="Send message" className="grid h-9 w-9 place-items-center rounded-xl bg-[#101114] text-white transition-colors hover:bg-[#101114] disabled:opacity-40">{busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <><ArrowUp size={17}/>{mode==='swarm'&&<span>Run</span>}</>}</button>
            </div>
          </form>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">{idleBuild?'The agent graph, activity, and project files appear here when your build starts.':'Review generated code before using it. Your provider’s limits apply.'}</p>
        </div>
      </div>
    </section>
    </BuildLayout>
    {mode==='chat'&&<aside className="desktop-live-panel"><div className="desktop-live-heading"><small>YOUR AI TEAM</small><h2>Live work <i className={busy?'working':''}/></h2></div><section><h3><Workflow size={15}/> Agents <span>{latestBuildEvents.length?new Set(latestBuildEvents.map(e=>e.role)).size:0}</span></h3><p>{busy?'SWARM is working on your request.':'Build activity appears here when you start a project.'}</p></section><section><h3><FileCode2 size={15}/> Project files <span>{generatedFiles.length}</span></h3>{generatedFiles.length?generatedFiles.map(file=><p key={file.name}>{file.name}</p>):<p>Generated files will appear with download links in your conversation.</p>}</section><section><h3><Activity size={15}/> Activity</h3>{latestBuildEvents.length?latestBuildEvents.slice(-5).map((e,i)=><p key={i}>{e.name} · {e.status}</p>):<p>{busy?'Generating a response…':'Your latest work appears here.'}</p>}</section><section><h3>Model</h3><p>{activeModel|| (modelId==='auto'?'Auto · SWARM router':selectedModel?.displayName)||'Connect a provider to begin'}</p></section></aside>}
  </div>;
}

const providerDescriptions: Record<string,string> = {
  openai: 'Access GPT models with your OpenAI API key.',
  openrouter: 'Connect a range of models through OpenRouter.',
  nvidia: 'Use models available from NVIDIA NIM.',
  groq: 'Connect fast inference with Groq.',
  google: 'Use Gemini models with a Google AI key.',
  cloudflare: 'Cloudflare Workers AI requires your account ID and API token.',
  huggingface: 'Connect inference providers through Hugging Face.',
  cerebras: 'Connect Cerebras inference.',
  mistral: 'Use Mistral models with your API key.',
};

function SettingsPage() { return <PrivateShell><SettingsWorkspace providers={<ProviderSettings/>}/></PrivateShell>; }
function ProviderSettings() {
  const cache = useQueryClient();
  const { data: providerResponse, isLoading, isError, refetch } = useListProviders();
  const { data: modelResponse, isLoading: modelsLoading, isError: modelsError, refetch: reloadModels } = useListModels();
  const saveProvider = useSaveProvider({ mutation: { gcTime: 0 } });
  const deleteProvider = useDeleteProvider();
  const [secrets, setSecrets] = useState<Record<string,string>>({});
  const [accounts, setAccounts] = useState<Record<string,string>>({});
  const [reveal, setReveal] = useState<Record<string,boolean>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const providers = providerResponse?.providers ?? [];
  const models = modelResponse?.models ?? [];
  const groupedModels = useMemo(() => providers.map((provider) => ({ provider, models: models.filter((model) => model.providerId === provider.providerId) })), [providers, models]);
  async function onSave(event: FormEvent, provider: ProviderSummary) {
    event.preventDefault();
    const apiKey = secrets[provider.providerId] ?? '';
    const accountId = (accounts[provider.providerId] ?? provider.accountId ?? '').trim();
    if (apiKey.length < 8) { setError(`${provider.name}: enter a valid key (at least 8 characters).`); return; }
    if (provider.needsAccountId && !accountId) { setError('Cloudflare requires an account ID as well as an API token.'); return; }
    setError(''); setNotice('');
    try {
      await saveProvider.mutateAsync({ providerId: provider.providerId, data: { apiKey, ...(accountId ? { accountId } : {}) } });
      setSecrets((current) => ({ ...current, [provider.providerId]: '' }));
      saveProvider.reset();
      await Promise.all([
        cache.invalidateQueries({ queryKey: getListProvidersQueryKey() }),
        cache.invalidateQueries({ queryKey: getListModelsQueryKey() }),
      ]);
      setNotice(`${provider.name} credentials saved. Your key is masked and will not be shown again.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Provider key could not be saved.'); }
  }
  async function remove(provider: ProviderSummary) {
    if (!window.confirm(`Remove the saved ${provider.name} key?`)) return;
    setError(''); setNotice('');
    try {
      await deleteProvider.mutateAsync({ providerId: provider.providerId });
      await Promise.all([cache.invalidateQueries({ queryKey: getListProvidersQueryKey() }), cache.invalidateQueries({ queryKey: getListModelsQueryKey() })]);
      setNotice(`${provider.name} credentials removed.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove this key.'); }
  }
  return <div className="scroll-thin h-full overflow-y-auto">
    <div className="mx-auto max-w-[980px] px-5 py-8 md:px-9 md:py-10">
      <div className="mb-8 flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] font-medium uppercase tracking-[.19em] text-[#101114]">Workspace / configuration</p><h1 className="mt-2 text-3xl font-extrabold tracking-[-.055em]">Providers</h1><p className="mt-2 max-w-[600px] text-sm leading-6 text-muted-foreground">Connect your own model-provider credentials. Saved keys are encrypted server-side, masked in this workspace, and never fetched back in raw form.</p></div><div className="hidden rounded-xl border border-[#d3d3d3] bg-[#f3f3f3] p-3 text-[#101114] sm:block"><ShieldCheck size={22} /></div></div>
      {error && <div data-testid="status-provider-error" role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
      {notice && <div data-testid="status-provider-success" role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-[#c8c8c8] bg-[#f3f3f3] p-3 text-sm text-[#101114]"><Check size={15} />{notice}</div>}
      <div className="mb-9 rounded-2xl border border-[#d4d4d4] bg-[#ededed] p-5 md:flex md:items-center md:gap-4"><div className="mb-3 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#101114] md:mb-0"><LockKeyhole size={18} /></div><div><h2 className="text-sm font-extrabold">Credentials stay private</h2><p className="mt-1 text-xs leading-5 text-[#676767]">SWARM sends a key only to its encrypted save endpoint. After saving, you’ll see a masked hint — never the original value. Keys are not stored in your browser.</p></div></div>
      <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">Connected providers</h2><span className="font-mono text-[10px] text-muted-foreground">{providers.filter((p) => p.configured).length} connected</span></div>
      {isLoading ? <div role="status" aria-label="Loading providers" className="space-y-3">{[1,2,3].map((n) => <div key={n} className="h-40 animate-pulse rounded-2xl bg-muted" />)}</div>
        : isError ? <div className="rounded-2xl border border-destructive/20 bg-card p-8 text-center"><p className="text-sm font-bold">Provider list unavailable</p><p className="mt-1 text-xs text-muted-foreground">Your credentials have not been changed.</p><button data-testid="button-retry-providers" onClick={() => void refetch()} className="mt-4 rounded-lg bg-secondary px-4 py-2 text-xs font-bold">Try again</button></div>
          : <div className="space-y-3">{providers.map((provider) => <form key={provider.providerId} data-testid={`form-provider-${provider.providerId}`} onSubmit={(e) => void onSave(e,provider)} className="rounded-2xl border border-border bg-card p-5 md:p-6">
            <div className="flex flex-wrap items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f1f1f1] text-[#101114]"><KeyRound size={17} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-extrabold">{provider.name}</h3>{provider.configured ? <span className="inline-flex items-center gap-1 rounded-full bg-[#ededed] px-2 py-1 text-[10px] font-bold text-[#545454]"><Check size={11} /> Connected</span> : <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">Not connected</span>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{providerDescriptions[provider.providerId] || `Connect your ${provider.name} credential.`}</p></div></div>
            {provider.configured && <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-[#f5f5f5] px-3 py-2 text-xs"><span className="font-mono tracking-[.1em] text-muted-foreground">{provider.keyHint || '••••••••'}</span><span className="text-[10px] text-muted-foreground">Credential connected · masked</span>{provider.accountId && <span className="ml-auto text-[10px] text-muted-foreground">Account {provider.accountId}</span>}</div>}
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                {provider.needsAccountId && <label className="block"><span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">Cloudflare account ID <span className="text-destructive">*</span></span><input data-testid={`input-account-${provider.providerId}`} value={accounts[provider.providerId] ?? provider.accountId ?? ''} onChange={(e) => setAccounts((current) => ({ ...current, [provider.providerId]: e.target.value }))} autoComplete="off" spellCheck={false} placeholder="Enter your Cloudflare account ID" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none focus:border-[#8f8f8f] focus:ring-2 focus:ring-[#101114]/10" /></label>}
                <label className="block"><span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">{provider.configured ? 'Replace API key' : 'API key'} <span className="text-destructive">*</span></span><div className="relative"><input data-testid={`input-key-${provider.providerId}`} type={reveal[provider.providerId] ? 'text' : 'password'} value={secrets[provider.providerId] ?? ''} onChange={(e) => setSecrets((current) => ({ ...current, [provider.providerId]: e.target.value }))} autoComplete="new-password" spellCheck={false} placeholder={provider.configured ? 'Enter a new key to rotate credentials' : `Paste your ${provider.name} API key`} className="h-10 w-full rounded-lg border border-input bg-background px-3 pr-16 font-mono text-xs outline-none focus:border-[#8f8f8f] focus:ring-2 focus:ring-[#101114]/10" /><button data-testid={`button-reveal-${provider.providerId}`} type="button" onClick={() => setReveal((current) => ({ ...current, [provider.providerId]: !current[provider.providerId] }))} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-secondary">{reveal[provider.providerId] ? 'Hide' : 'Show'}</button></div></label>
              </div>
              <div className="flex items-end gap-2 md:flex-col md:items-stretch md:justify-end"><button data-testid={`button-save-${provider.providerId}`} type="submit" disabled={saveProvider.isPending || !secrets[provider.providerId]?.trim()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#101114] px-4 text-xs font-bold text-white hover:bg-[#101114] disabled:opacity-40">{saveProvider.isPending && saveProvider.variables?.providerId === provider.providerId ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Check size={14} />}Save key</button>{provider.configured && <button data-testid={`button-remove-${provider.providerId}`} type="button" disabled={deleteProvider.isPending} onClick={() => void remove(provider)} className="h-10 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-destructive/30 hover:text-destructive">Remove</button>}</div>
            </div>
            {provider.needsAccountId && <p className="mt-2 text-[10px] leading-5 text-muted-foreground">Find this ID in your Cloudflare dashboard under the account overview. It is sent with the key when you save.</p>}
          </form>)}</div>}
      <section className="mt-12">
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-lg font-extrabold tracking-tight">Available models</h2><p className="mt-1 text-xs text-muted-foreground">Live API inventory for your connected providers.</p></div><span className="font-mono text-[10px] text-muted-foreground">{models.length} models</span></div>
        {modelsLoading ? <div role="status" aria-label="Loading models" className="grid gap-2 sm:grid-cols-2">{[1,2,3,4].map((n) => <div key={n} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
          : modelsError ? <div className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">Model inventory couldn’t load.<button onClick={() => void reloadModels()} className="ml-2 font-bold text-foreground underline">Retry</button></div>
            : !models.length ? <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center"><Zap size={20} className="mx-auto text-[#101114]" /><p className="mt-3 text-sm font-bold">No models available yet</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Save a provider key above. SWARM will show the models returned for your account here.</p></div>
              : <div className="space-y-3">{groupedModels.filter((group) => group.models.length).map(({ provider, models: list }) => <div key={provider.providerId} className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="text-xs font-bold">{provider.name}</span><span className="font-mono text-[10px] text-muted-foreground">{list.length} models</span></div><div className="divide-y divide-border sm:grid sm:grid-cols-2 sm:divide-y-0">{list.map((model) => <div key={model.id} data-testid={`model-${model.id}`} className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:border-r sm:odd:border-r sm:even:border-r-0"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#6b6b6b]" /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{model.displayName}</span><span className="max-w-[42%] truncate font-mono text-[9px] text-muted-foreground">{model.modelId}</span></div>)}</div></div>)}</div>}
      </section>
    </div>
  </div>;
}

function Router() {
  const [location] = useLocation();
  const content = location.startsWith('/sign-in') ? <SignInPage /> : location.startsWith('/sign-up') ? <SignUpPage /> : location === '/desktop/connect' ? <DesktopConnect/> : location === '/app/settings' ? <SettingsPage /> : <ChatApp />;
  return <ErrorBoundary resetKey={location}>{location.startsWith('/sign-') || !clerkPubKey ? content : <Protected>{content}</Protected>}</ErrorBoundary>;
}
function ClerkRouter() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInFallbackRedirectUrl="/app" signUpFallbackRedirectUrl="/app" signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your SWARM workspace' } }, signUp: { start: { title: 'Create your account', subtitle: 'Start your private AI workspace' } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkCacheReset /><Router /></QueryClientProvider>
  </ClerkProvider>;
}
function PreviewContent() {
  const path = usePathname();
  if (path.startsWith('/sign-')) return <div className="desktop-login"><div className="desktop-login-card"><Link href="/" aria-label="SWARM home"><Brand/></Link><h1>{path.startsWith('/sign-up')?'Create your account':'Welcome back'}</h1><p>Sign in to your SWARM workspace</p><div role="status" className="desktop-login-status">Account sign-in is not connected yet. The original Google and email login will be available when this site's Clerk configuration is restored.</div><Link className="desktop-login-guest" href="/app">Continue as guest <ArrowRight size={15}/></Link><Link className="desktop-login-home" href="/">Back to SWARM</Link></div></div>;
  return <Router />;
}
function App() {
  return <div className="cloud-theme">{clerkPubKey ? <ClerkRouter /> : <QueryClientProvider client={queryClient}><PreviewContent /></QueryClientProvider>}</div>;
}
export default App;
