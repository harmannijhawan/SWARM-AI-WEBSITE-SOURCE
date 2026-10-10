'use client';
import { ManagedAccount, PlanUpgradeButton } from './managed-account';
import { DownloadsWorkspace } from './downloads-workspace';
import { CopyButton } from './design-system';
import { ThemeButton } from './theme-button';
import { WorkspaceCommands, ConversationDialog, type ConversationAction } from './workspace-dialogs';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type UIEvent } from 'react';
import {setAuthTokenGetter,getAuthToken} from '@/lib/cloud-api/custom-fetch';
import { SettingsWorkspace, PreferenceEffects } from './settings-workspace';
import { AccountPanel, DesktopConnect } from './account-panel';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from '@clerk/react';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown, UserRound, Activity, ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Check, CircleHelp, Clock3,
  Copy, Workflow, Smartphone, MessageSquareText, FileCode2, KeyRound, LockKeyhole, LogOut, Menu, MessageSquarePlus, MoreHorizontal, PanelLeftClose,
  PanelLeftOpen, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, X, Zap,
} from 'lucide-react';
import {
  getConversation, getGetConversationQueryKey, getListConversationsQueryKey, getListModelsQueryKey,
  getListProvidersQueryKey, useCreateConversation, useDeleteConversation,
  useGetConversation, useListConversations, useListModels, useListProviders,
  useRenameConversation,
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
  cssLayerName:'clerk',
  options:{logoPlacement:'inside' as const,logoLinkUrl:'/',logoImageUrl:'/brand/swarm-wordmark.png'},
  variables:{colorPrimary:'#216bd0',colorForeground:'#101114',colorMutedForeground:'#758195',colorDanger:'#bd4949',colorBackground:'#ffffff',colorInput:'#f5f8fc',colorInputForeground:'#101114',colorNeutral:'#758195',fontFamily:'Inter, Segoe UI, sans-serif',borderRadius:'0.625rem'},
  elements:{rootBox:'w-full flex justify-center',cardBox:'sw-auth-card w-[440px] max-w-full overflow-hidden',card:'!shadow-none !border-0 !bg-transparent',footer:'!shadow-none !border-0 !bg-transparent',logoImage:'sw-auth-logo',formButtonPrimary:'sw-auth-primary'}
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
  return <div className="sw-auth-page min-h-[100dvh] grid place-items-center px-4 py-10"><div className="w-full max-w-[440px]"><div className="mb-7 flex justify-center"><Brand /></div><SignIn fallbackRedirectUrl="/app" routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>;
}
function SignUpPage() {
  return <div className="sw-auth-page min-h-[100dvh] grid place-items-center px-4 py-10"><div className="w-full max-w-[440px]"><div className="mb-7 flex justify-center"><Brand /></div><SignUp fallbackRedirectUrl="/app" routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>;
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
  const pathname=usePathname();
  return <div className="cloud-shell desktop-web-shell flex h-[100dvh] flex-col bg-background">
    <header className="desktop-web-topbar"><Link href="/" aria-label="SWARM home" className="desktop-web-brand"><img className="sw-original-mark" src="/brand/swarm-mark.png" alt=""/><img className="sw-original-wordmark" src="/brand/swarm-wordmark.png" alt="SWARM"/></Link><nav aria-label="Workspace navigation">{onMode?<><button aria-current={mode==='chat'?'page':undefined} onClick={()=>onMode('chat')}><MessageSquareText size={16}/> Chat</button><button aria-current={mode==='swarm'?'page':undefined} onClick={()=>onMode('swarm')}><Workflow size={16}/> Build</button></>:<><Link href="/app?mode=chat"><MessageSquareText size={16}/> Chat</Link><Link href="/app?mode=build"><Workflow size={16}/> Build</Link></>}<Link href="/app/downloads" aria-current={pathname==='/app/downloads'?'page':undefined}><Smartphone size={16}/> Downloads</Link><Link href="/app/settings" aria-current={pathname==='/app/settings'?'page':undefined}><Settings2 size={16}/> Settings</Link></nav><div className="desktop-web-account"><ThemeButton/><WorkspaceCommands/><details className="sw-account-menu"><summary aria-label="Account menu"><span className="sw-account-avatar"><UserRound size={15}/></span><span>Workspace</span><ChevronDown size={12}/></summary><div className="sw-account-popover"><Link href="/app/settings"><Settings2 size={14}/>Account & preferences</Link><Link href="/pricing"><Sparkles size={14}/>Plans</Link>{clerkPubKey?<SignOutButton/>:<Link href="/sign-in">Log in <ArrowRight size={13}/></Link>}</div></details></div></header><main className="min-h-0 flex-1">{children}</main>
  </div>;
}

function SlidersIcon(){return <Settings2 size={12}/>;}

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
  const [conversationAction,setConversationAction]=useState<ConversationAction|null>(null);
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
  useEffect(() => { const media=window.matchMedia('(min-width: 768px)');const update=()=>setSidebarOpen(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update); }, []);
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
  const selectedModel = modelId === 'auto' && validModels.length ? { id:'auto', providerId:validModels[0].providerId, modelId:'auto', displayName:'SWARM SWE', providerName:'SWARM router' } : validModels.find(model => model.id === modelId) ?? validModels[0];
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
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: document.querySelector('.cloud-theme')?.getAttribute('data-motion')==='off'||matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth', block: 'end' }); }, [renderedMessages.length, streaming, agentEvents.length]);
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
      window.dispatchEvent(new Event('swarm:usage'));
      if (!response.body) throw new Error('The response stream is unavailable.');
      await consumeChatStream(response.body,controller.signal,(type,data)=>{
          const event=data as StreamUpdate;
          const nested = event.data && typeof event.data === 'object' ? event.data as StreamUpdate : undefined;
          if (type === 'model') {
            window.dispatchEvent(new Event('swarm:usage'));setActiveModel(`${event.displayName || event.modelId} · ${event.providerName || event.providerId}`);
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
    } finally { clearTimeout(timeout);requestRef.current = null; setBusy(false); window.dispatchEvent(new Event('swarm:usage')); }
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
    if (!selectedModel) { setStreamError('SWARM AI is temporarily unavailable. No provider key is needed. Please retry later.'); return; }
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
  function doRename(id:string,title:string){setConversationAction({kind:'rename',id,title});}
  function doDelete(id:string,title:string){setConversationAction({kind:'delete',id,title});}
  async function commitConversationAction(title:string){if(!conversationAction)return;const {id,kind}=conversationAction;if(kind==='rename')await renameConversation.mutateAsync({id,data:{title}});else{await deleteConversation.mutateAsync({id});if(selectedId===id){setSelectedId(null);setDraftMessages([]);}}invalidateConversation(id);}
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
                return groupItems.length ? <section key={group} className="mb-3"><h2 className="px-3 pb-1 pt-3 font-mono text-[9px] font-medium uppercase tracking-[.17em] text-muted-foreground">{group}</h2>{groupItems.map((item) => <div key={item.id} data-selected={selectedId===item.id} className={`group mb-0.5 flex items-center rounded-lg ${selectedId === item.id ? 'text-foreground' : 'text-muted-foreground hover:bg-secondary'}`}><button data-testid={`conversation-${item.id}`} disabled={busy} onClick={() => { setSelectedId(item.id); if (window.innerWidth < 768) setSidebarOpen(false); }} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-xs font-semibold">{item.title}</button><details className="relative mr-1"><summary aria-label={`Conversation actions: ${item.title}`} className="list-none rounded p-1 opacity-0 hover:bg-white group-hover:opacity-100 focus:opacity-100"><MoreHorizontal size={15} /></summary><div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-border bg-card p-1 shadow-lg"><button data-testid={`rename-conversation-${item.id}`} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary" onClick={() => void doRename(item.id,item.title)}><Pencil size={13} /> Rename</button><button data-testid={`delete-conversation-${item.id}`} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-destructive hover:bg-destructive/5" onClick={() => void doDelete(item.id,item.title)}><Trash2 size={13} /> Delete</button></div></details></div>)}</section> : null;
              })}
      </div>
      <PlanUpgradeButton/>
      <div className="border-t border-border p-3"><Link href="/app/settings" className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary"><Settings2 size={15} /> Account settings <ArrowRight className="ml-auto" size={13} /></Link></div>
    </aside>}
    {sidebarOpen && <button aria-label="Close conversation history" onClick={() => setSidebarOpen(false)} className="fixed inset-x-0 bottom-0 top-14 z-20 bg-[#10111466] md:hidden" />}
    <BuildLayout conversationId={selectedId} artifactText={[...activeMessages].reverse().find(m=>m.role==='assistant')?.content||''} onChat={()=>setMode('chat')} enabled={mode === 'swarm' && !idleBuild} busy={busy} events={buildEvents.length ? buildEvents : ((activeMessages.at(-1) as Message & {buildEvents?:BuildEvent[]})?.buildEvents || [])} objective={[...activeMessages,...draftMessages].filter(m=>m.role === 'user').at(-1)?.content || draft} error={streamError}>
    <ConversationDialog action={conversationAction} onClose={()=>setConversationAction(null)} onSubmit={commitConversationAction}/><section className={`desktop-web-conversation flex min-w-0 flex-1 flex-col ${idleBuild?'desktop-build-welcome':''}`}>
      <div className="desktop-conversation-heading"><div><button data-testid="button-toggle-history" aria-label={sidebarOpen?'Hide history':'Show history'} onClick={()=>setSidebarOpen(!sidebarOpen)}>{sidebarOpen?<PanelLeftClose size={16}/>:<PanelLeftOpen size={16}/>}</button><div><strong>{detail?.title||(mode==='swarm'?'Build':'SWARM')}</strong><p>{mode==='swarm'?'Plan, code, review, package':'Your coordinator'}</p></div></div><span className="desktop-live-pill"><Activity size={14}/>{busy?'Working':'Ready when you are'}</span></div>
      <div className="desktop-message-area relative min-h-0 flex-1">
        <div className="scroll-thin h-full overflow-y-auto" onScroll={onScroll}>
          {detailLoading && selectedId ? <div className="mx-auto max-w-[760px] space-y-6 px-6 py-12" role="status" aria-label="Loading conversation">{[1,2,3].map((i) => <div key={i} className="animate-pulse space-y-2"><div className="h-3 w-20 rounded bg-muted" /><div className="h-4 w-full rounded bg-muted" /><div className="h-4 w-4/5 rounded bg-muted" /></div>)}</div>
            : detailError && selectedId ? <div className="mx-auto mt-24 max-w-md rounded-2xl border border-destructive/20 bg-card p-7 text-center"><CircleHelp className="mx-auto text-destructive" size={24} /><h2 className="mt-3 font-bold">Couldn’t open this conversation</h2><p className="mt-2 text-sm text-muted-foreground">Try again or select another conversation.</p><button data-testid="button-retry-conversation" onClick={() => void reloadDetail()} className="mt-4 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold">Retry</button></div>
              : !renderedMessages.length && !busy ? <div className={`desktop-welcome ${idleBuild?'desktop-welcome-build':'desktop-welcome-chat'}`}>
                {idleBuild?<span className="desktop-build-eyebrow">AUTONOMOUS WORKSPACE</span>:<span className="sw-welcome-emblem"><img src="/brand/swarm-mark.png" alt="SWARM"/></span>}
                <h1>{idleBuild?'What should SWARM build?':'A thought. A possibility. A start.'}</h1><p>{idleBuild?'Describe the outcome and target platform. SWARM will plan, build, and review the code.':'Bring your question or your next big idea. We’ll work through it together.'}</p>
                {!validModels.length&&!modelsLoading&&<Link className="desktop-provider-link" href="/app/settings"><KeyRound size={15}/> AI service status</Link>}
                <div className="desktop-welcome-suggestions">{(idleBuild?[['Web','Build a website that '],['Windows','Build a Windows app that '],['Android','Build an Android app that '],['CLI','Create a CLI tool that ']]:[['Explore an idea','Help me develop an idea for '],['Explain some code','Explain this code: '],['Build a website','Build a website that ']]).map(([label,prompt])=><button key={label} onClick={()=>{if(!idleBuild&&label==='Build a website')setMode('swarm');prefill(prompt);}}>{label}{idleBuild&&<ArrowUpRight size={12}/>}</button>)}</div>
              </div>
              : <div className="mx-auto max-w-[760px] px-6 pb-12 pt-7">
                {renderedMessages.map((message, index) => <article key={`${message.id}-${index}`} data-testid={`message-${message.id}`} className={`appear ${message.role === 'user' ? 'sw-message-user' : 'sw-message-assistant'}`}>
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.12em] text-muted-foreground">{message.role === 'user' ? 'You' : <><img src="/brand/swarm-mark.png" alt="" className="h-4 w-4 object-contain" /> SWARM</>}<span className="ml-auto normal-case tracking-normal font-medium">{message.role === 'assistant' && (message as Message & { modelName?: string }).modelName && <span className="mr-2 hidden sm:inline">{(message as Message & { modelName?: string }).modelName}</span>}{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
                  <div className="message-content text-[14px] text-foreground">{message.role === 'assistant' ? <ChatMarkdown text={message.content} /> : message.content}</div>
                  {message.role === 'user' && <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground"><button data-testid={`edit-message-${message.id}`} disabled={busy || !selectedModel} onClick={() => startEdit(message)} className="hover:text-foreground disabled:opacity-40">Edit</button></div>}
                  {message.role === 'assistant' && <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground"><CopyButton text={message.content} testId={`copy-message-${message.id}`}/><button data-testid={`regenerate-message-${message.id}`} disabled={busy || !selectedModel || !renderedMessages.slice(0,index).some((entry) => entry.role === 'user')} onClick={() => { const previousUser = renderedMessages.slice(0,index).reverse().find((entry) => entry.role === 'user'); if (previousUser) respondTo('regenerate', previousUser); }} className="hover:text-foreground disabled:opacity-40">Regenerate</button><button data-testid={`continue-message-${message.id}`} disabled={busy || !selectedModel} onClick={() => respondTo('continue', message)} className="hover:text-foreground disabled:opacity-40">Continue</button></div>}
                </article>)}
                {agentEvents.map((event, index) => <div key={`${index}-${event}`} data-testid={`agent-status-${index}`} role="status" className="mb-2 flex items-center gap-2 text-xs text-[#101114]"><Activity size={13} />{event}</div>)}
                {busy && <article className="py-5" role="status" aria-label="Response streaming"><div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#101114]"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-primary" />{mode === 'swarm' ? 'Build response' : 'Response'}</div><div className="message-content text-sm">{streaming ? <ChatMarkdown text={streaming} /> : <span className="text-muted-foreground">Waiting for response…</span>}</div></article>}
                <div ref={endRef} />
              </div>}
        </div>
        {scrollDown && <button data-testid="button-scroll-bottom" onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth' })} className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card p-2 shadow-md" aria-label="Scroll to latest message"><ArrowDown size={15} /></button>}
      </div>
      <div className="desktop-composer-wrap shrink-0 bg-background px-4 pb-4 pt-3 md:px-8">
        <div className="mx-auto max-w-[760px]">
          {streamError && <div data-testid="status-stream-error" role="alert" className="mb-2 flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"><span>{streamError}</span>{retryRequest&&<button disabled={busy} className="ml-3 font-bold underline" onClick={()=>void retryFailedResponse()}>Retry</button>}<button aria-label="Dismiss error" onClick={() => setStreamError('')}><X size={14} /></button></div>}
          {/Your SWARM allowance is exhausted|Unlock SWARM SWE Fast with Pro|SWARM Premium requires Pro/.test(streamError) && <button type="button" onClick={() => window.dispatchEvent(new Event('swarm:upgrade'))} className="mb-3 rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white">View Pro plans</button>}
          {editingMessage && <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">Editing your message<button data-testid="button-cancel-edit" onClick={() => { setEditingMessage(null); setDraft(''); }} className="font-semibold text-foreground">Cancel</button></div>}
          <form data-testid="form-chat-composer" onSubmit={submit} className="rounded-2xl border border-border bg-card p-3 shadow-[0_8px_28px_rgba(16,17,20,.06)] focus-within:border-[#aaaaaa]">
            <textarea ref={inputRef} data-testid="input-chat-prompt" aria-label="Message SWARM" rows={2} maxLength={32000} value={draft} onChange={(e) => {setDraft(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,192)+'px';}} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} placeholder={validModels.length ? (mode==='swarm'?'What do you want to build?':'Ask SWARM anything…') : 'Write your message… AI service is temporarily unavailable.'} disabled={busy} className="min-h-[52px] max-h-48 w-full resize-y bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60" />
            <details className="composer-account"><summary><SlidersIcon/> Model preferences & allowance <ChevronDown size={12}/></summary><ManagedAccount compact/></details>
      <div className="flex flex-wrap items-center gap-2 pt-2">
              <label className="sr-only" htmlFor="model-select">Provider and model</label>
              <select id="model-select" data-testid="select-chat-model" value={selectedModel?.id ?? ''} onChange={(e) => setModelId(e.target.value)} disabled={busy || !validModels.length || modelsLoading} className="max-w-[min(54vw,280px)] rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-[#101114]/20">
                {!validModels.length && <option value="">{modelsLoading ? 'Loading models…' : 'No connected models'}</option>}
                {validModels.length > 0 && <option value="auto">Account model profile</option>}
                
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
    {mode==='chat'&&<aside className="desktop-live-panel"><div className="desktop-live-heading"><small>YOUR AI TEAM</small><h2>Live work <i className={busy?'working':''}/></h2></div><section><h3><Workflow size={15}/> Agents <span>{latestBuildEvents.length?new Set(latestBuildEvents.map(e=>e.role)).size:0}</span></h3><p>{busy?'SWARM is working on your request.':'Build activity appears here when you start a project.'}</p></section><section><h3><FileCode2 size={15}/> Project files <span>{generatedFiles.length}</span></h3>{generatedFiles.length?generatedFiles.map(file=><p key={file.name}>{file.name}</p>):<p>Generated files will appear with download links in your conversation.</p>}</section><section><h3><Activity size={15}/> Activity</h3>{latestBuildEvents.length?latestBuildEvents.slice(-5).map((e,i)=><p key={i}>{e.name} · {e.status}</p>):<p>{busy?'Generating a response…':'Your latest work appears here.'}</p>}</section><section><h3>Model</h3><p>{activeModel|| (modelId==='auto'?'Auto · SWARM router':selectedModel?.displayName)||'SWARM AI is awaiting backend availability'}</p></section></aside>}
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
function ProviderSettings() { return <ManagedAccount/>; }

function Router() {
  const [location] = useLocation();
  const content = location.startsWith('/sign-in') ? <SignInPage /> : location.startsWith('/sign-up') ? <SignUpPage /> : location === '/desktop/connect' ? <DesktopConnect/> : location === '/app/settings' ? <SettingsPage /> : location === '/app/downloads' ? <PrivateShell><DownloadsWorkspace/></PrivateShell> : <ChatApp />;
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
  return <div className="cloud-theme">{clerkPubKey ? <ClerkRouter /> : <QueryClientProvider client={queryClient}><PreferenceEffects/><PreviewContent /></QueryClientProvider>}</div>;
}
export default App;
