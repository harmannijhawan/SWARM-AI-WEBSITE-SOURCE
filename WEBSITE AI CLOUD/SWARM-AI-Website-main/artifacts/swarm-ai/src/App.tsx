import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type UIEvent } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDown, ArrowRight, ArrowUp, Check, CircleHelp, Clock3,
  Copy, KeyRound, LockKeyhole, LogOut, Menu, MessageSquarePlus, MoreHorizontal, PanelLeftClose,
  PanelLeftOpen, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2, X, Zap,
} from 'lucide-react';
import {
  getGetConversationQueryKey, getListConversationsQueryKey, getListModelsQueryKey,
  getListProvidersQueryKey, useCreateConversation, useDeleteConversation, useDeleteProvider,
  useGetConversation, useListConversations, useListModels, useListProviders,
  useRenameConversation, useSaveProvider,
} from '@workspace/api-client-react';
import type { Conversation, Message, ProviderSummary, StreamConversationInput } from '@workspace/api-client-react';
import { Link, Redirect, Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: true } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }

const appearance = {
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#397d67', colorForeground: '#202923', colorMutedForeground: '#69756f',
    colorDanger: '#bd4949', colorBackground: '#ffffff', colorInput: '#f7f9f7',
    colorInputForeground: '#202923', colorNeutral: '#dce4df', fontFamily: 'Manrope, sans-serif', borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#202923] font-bold', headerSubtitle: 'text-[#69756f]',
    socialButtonsBlockButtonText: 'text-[#202923]', formFieldLabel: 'text-[#38433d]',
    footerActionLink: 'text-[#397d67] font-semibold', footerActionText: 'text-[#69756f]',
    dividerText: 'text-[#69756f]', identityPreviewEditButton: 'text-[#397d67]',
    formFieldSuccessText: 'text-[#28654f]', alertText: 'text-[#943e3e]',
    logoBox: 'h-10', logoImage: 'max-h-9', socialButtonsBlockButton: 'border-[#dce4df] hover:bg-[#f2f6f3]',
    formButtonPrimary: 'bg-[#397d67] hover:bg-[#2f6b57]', formFieldInput: 'bg-[#f7f9f7] border-[#dce4df]',
    footerAction: 'border-t border-[#e7ece9]', dividerLine: 'bg-[#dce4df]', alert: 'bg-[#fff3f2]',
    otpCodeFieldInput: 'border-[#dce4df]', formFieldRow: 'gap-1', main: 'gap-4',
  },
};

type StreamUpdate = {
  type?: string; event?: string; token?: string; content?: string; text?: string;
  message?: string; status?: string; agent?: string; role?: string; name?: string;
  error?: string; conversation?: Conversation; data?: unknown;
};

function Brand({ size = 'normal' }: { size?: 'normal' | 'large' }) {
  return <img className="logo-img" src="/brand/swarm-wordmark.png" alt="SWARM" style={{ width: size === 'large' ? 146 : 103, height: size === 'large' ? 27 : 20 }} />;
}

function ClerkCacheReset() {
  const { addListener } = useClerk();
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
  return <div className="min-h-[100dvh] grid place-items-center px-4 py-10 bg-[#f3f6f3]"><div className="w-full max-w-[440px]"><div className="mb-7 flex justify-center"><Brand /></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>;
}
function SignUpPage() {
  return <div className="min-h-[100dvh] grid place-items-center px-4 py-10 bg-[#f3f6f3]"><div className="w-full max-w-[440px]"><div className="mb-7 flex justify-center"><Brand /></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div></div>;
}
function PublicHome() {
  return <main className="swarm-shell overflow-hidden">
    <nav className="mx-auto flex max-w-[1260px] items-center justify-between px-6 py-6 lg:px-10">
      <Link href="/" className="inline-flex items-center gap-3"><img src="/brand/swarm-mark.png" alt="" className="h-8 w-8 object-contain" /><Brand /></Link>
      <div className="flex items-center gap-3"><Link href="/sign-in" className="rounded-lg px-4 py-2 text-sm font-semibold text-[#4f5e56] hover:bg-white">Sign in</Link><Link href="/sign-up" className="rounded-lg bg-[#263a32] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#385448]">Create account <ArrowRight className="ml-2 inline" size={15} /></Link></div>
    </nav>
    <section className="brand-grid relative mx-auto max-w-[1260px] px-6 pb-24 pt-12 lg:px-10 lg:pb-32 lg:pt-20">
      <div className="pointer-events-none absolute right-[9%] top-[10%] hidden h-[390px] w-[390px] items-center justify-center rounded-full border border-[#397d67]/15 lg:flex">
        <div className="absolute h-[290px] w-[290px] rounded-full border border-[#397d67]/20" /><div className="absolute h-[195px] w-[195px] rounded-full border border-[#397d67]/25" />
        <div className="absolute h-4 w-4 rounded-full bg-[#397d67] shadow-[0_0_0_12px_rgba(57,125,103,.1)]" />
        <span className="absolute right-10 top-[15%] h-2 w-2 rounded-full bg-[#c1a363]" /><span className="absolute bottom-[18%] left-[16%] h-2.5 w-2.5 rounded-full bg-[#397d67]/50" />
        <div className="absolute right-[9%] top-[44%] rounded-xl border border-[#dce4df] bg-white/90 px-4 py-3 text-xs shadow-sm"><span className="mb-1 block font-mono text-[10px] uppercase tracking-[.18em] text-[#83928a]">Private by design</span>Your keys. Your models.</div>
      </div>
      <div className="relative max-w-[730px]">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#397d67]/20 bg-white/80 px-3.5 py-2 text-[11px] font-bold uppercase tracking-[.16em] text-[#397d67]"><span className="h-1.5 w-1.5 rounded-full bg-[#397d67]" />A workspace for your intelligence</div>
        <h1 className="max-w-[720px] text-[clamp(3.4rem,9vw,7.5rem)] font-extrabold leading-[.91] tracking-[-.085em] text-[#202923]">One mind.<br /><span className="text-[#397d67]">Many models.</span></h1>
        <p className="mt-8 max-w-[540px] text-lg leading-8 text-[#647168]">SWARM is your personal AI workspace. Bring your own provider keys, keep conversations persistent, and switch on SWARM mode when a task deserves more than one step.</p>
        <div className="mt-9 flex flex-wrap gap-3"><Link href="/sign-up" className="rounded-xl bg-[#263a32] px-6 py-4 text-sm font-bold text-white shadow-lg shadow-[#263a32]/10 transition-transform hover:-translate-y-0.5">Open your workspace <ArrowRight className="ml-3 inline" size={16} /></Link><Link href="/sign-in" className="rounded-xl border border-[#d5dfd9] bg-white/75 px-6 py-4 text-sm font-bold text-[#394a41] hover:bg-white">I already have an account</Link></div>
        <div className="mt-9 flex items-center gap-3 text-xs text-[#748178]"><ShieldCheck size={15} className="text-[#397d67]" /> API credentials encrypted server-side and never shown again.</div>
      </div>
    </section>
    <section className="mx-auto max-w-[1260px] px-6 pb-20 lg:px-10">
      <div className="grid gap-4 md:grid-cols-12">
        <article className="relative overflow-hidden rounded-[1.6rem] bg-[#263a32] p-8 text-white md:col-span-7 md:p-10">
          <p className="font-mono text-[10px] uppercase tracking-[.22em] text-[#a8c8b9]">01 / Make it yours</p><h2 className="mt-7 max-w-[420px] text-3xl font-bold tracking-[-.05em]">Your keys connect your world.</h2><p className="mt-3 max-w-[430px] text-sm leading-6 text-[#c4d4cc]">Choose a provider in Settings. Save once; SWARM masks the credential and the server keeps it encrypted.</p>
          <div className="mt-10 flex flex-wrap gap-2">{['OpenAI','Anthropic-compatible','Google','Cloudflare','Mistral'].map((name,i)=><span key={name} className="rounded-full border border-white/15 bg-white/[.06] px-3 py-2 text-xs text-[#d8e3dd]">{name}</span>)}</div>
          <div className="absolute -bottom-16 -right-12 h-56 w-56 rounded-full border border-white/10" /><div className="absolute -bottom-8 -right-4 h-36 w-36 rounded-full border border-white/10" />
        </article>
        <article className="rounded-[1.6rem] border border-[#dce4df] bg-white p-8 md:col-span-5 md:p-10"><p className="font-mono text-[10px] uppercase tracking-[.22em] text-[#809087]">02 / Keep the thread</p><h2 className="mt-7 text-3xl font-bold tracking-[-.05em]">Persistent, private chat.</h2><p className="mt-3 text-sm leading-6 text-[#647168]">Conversations stay in your account. Search your history, edit a prompt, regenerate a response, or pick up where you left off.</p><div className="mt-8 flex items-center gap-3 rounded-xl bg-[#f3f6f3] p-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-white text-[#397d67]"><LockKeyhole size={17} /></span><span className="text-xs font-semibold text-[#43534a]">Private to your account</span><Check className="ml-auto text-[#397d67]" size={16} /></div></article>
        <article className="rounded-[1.6rem] border border-[#dce4df] bg-[#e8f0eb] p-8 md:col-span-5 md:p-10"><p className="font-mono text-[10px] uppercase tracking-[.22em] text-[#628170]">03 / Ask for more</p><h2 className="mt-7 text-3xl font-bold tracking-[-.05em] text-[#20352b]">A true multi-step response.</h2><p className="mt-3 text-sm leading-6 text-[#52665b]">SWARM mode routes the task through the actual multi-step response flow. Follow real agent status events as the response unfolds.</p><div className="mt-8 inline-flex items-center gap-2 rounded-lg border border-[#b4cbbd] bg-white/70 px-3 py-2 text-xs font-semibold text-[#397d67]"><Sparkles size={14} /> SWARM mode</div></article>
        <article className="flex flex-col justify-between rounded-[1.6rem] border border-[#dce4df] bg-white p-8 md:col-span-7 md:p-10"><div><p className="font-mono text-[10px] uppercase tracking-[.22em] text-[#809087]">Start with one connection</p><h2 className="mt-7 max-w-[420px] text-3xl font-bold tracking-[-.05em]">No platform key required.</h2><p className="mt-3 max-w-[480px] text-sm leading-6 text-[#647168]">Bring credentials for a supported model provider. Select from the live models available to your account.</p></div><Link href="/sign-up" className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#397d67]">Create a private workspace <ArrowRight size={15} /></Link></article>
      </div>
    </section>
    <footer className="border-t border-[#dce4df] px-6 py-8 text-center text-xs text-[#829087]">SWARM — your personal AI workspace. Your keys stay yours.</footer>
  </main>;
}

function HomeRedirect() {
  return <><Show when="signed-in"><Redirect to="/app" /></Show><Show when="signed-out"><PublicHome /></Show></>;
}

function Protected({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/" /></Show></>;
}

function SignOutButton() {
  const { signOut } = useClerk();
  return <button data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-secondary"><LogOut size={14} /> Sign out</button>;
}

function PrivateShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const settings = location === '/settings';
  return <div className="flex min-h-[100dvh] bg-background">
    <aside className={`${mobileNav ? 'fixed inset-y-0 left-0 z-40 flex' : 'hidden'} w-[262px] shrink-0 flex-col border-r border-border bg-sidebar px-3 py-4 md:flex`}>
      <div className="mb-7 flex h-8 items-center justify-between px-2"><Link href="/app" className="flex items-center gap-2.5"><img src="/brand/swarm-mark.png" alt="" className="h-7 w-7 object-contain" /><Brand /></Link><button data-testid="button-close-navigation" className="rounded p-1 text-muted-foreground md:hidden" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={16} /></button></div>
      <button data-testid="button-new-conversation" onClick={() => { setLocation('/app'); setMobileNav(false); window.dispatchEvent(new Event('swarm:new-chat')); }} className="mb-4 flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:border-[#b6c9bd]"><MessageSquarePlus size={16} /> New chat <span className="ml-auto text-xs text-muted-foreground">⌘ K</span></button>
      <nav className="space-y-1">
        <Link href="/app" onClick={() => setMobileNav(false)} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold ${!settings ? 'bg-[#e1eee7] text-[#28634d]' : 'text-muted-foreground hover:bg-secondary'}`}><Sparkles size={15} /> Workspace</Link>
        <Link href="/settings" onClick={() => setMobileNav(false)} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold ${settings ? 'bg-[#e1eee7] text-[#28634d]' : 'text-muted-foreground hover:bg-secondary'}`}><Settings2 size={15} /> Settings</Link>
      </nav>
      <div className="mt-auto space-y-2 border-t border-border pt-4"><div className="px-3 text-[10px] font-bold uppercase tracking-[.17em] text-muted-foreground">Private workspace</div><p className="px-3 text-[11px] leading-5 text-muted-foreground">Your provider credentials are encrypted on the server.</p><SignOutButton /></div>
    </aside>
    {mobileNav && <button className="fixed inset-0 z-30 bg-[#18231dcc] md:hidden" aria-label="Close navigation overlay" onClick={() => setMobileNav(false)} />}
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/90 px-4 md:px-7">
        <div className="flex items-center gap-3"><button data-testid="button-open-navigation" aria-label="Open navigation" className="rounded-md p-2 text-muted-foreground hover:bg-secondary md:hidden" onClick={() => setMobileNav(true)}><Menu size={17} /></button><div className="text-xs font-semibold text-muted-foreground">{settings ? 'Workspace settings' : 'Personal workspace'}</div></div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#47866c]" /><span className="text-[11px] font-semibold text-muted-foreground">Private session</span></div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  </div>;
}

function dateGroup(iso: string) {
  const today = new Date(); today.setHours(0,0,0,0);
  const day = new Date(iso); day.setHours(0,0,0,0);
  const age = Math.round((today.getTime() - day.getTime()) / 86400000);
  return age === 0 ? 'Today' : age === 1 ? 'Yesterday' : age < 7 ? 'Previous 7 days' : 'Older';
}
function ChatApp() { return <PrivateShell><Workspace /></PrivateShell>; }

function Workspace() {
  const cache = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [agentEvents, setAgentEvents] = useState<string[]>([]);
  const [streamError, setStreamError] = useState('');
  const [mode, setMode] = useState<'chat'|'swarm'>('chat');
  const [modelId, setModelId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingMessage, setEditingMessage] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [scrollDown, setScrollDown] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
  const selectedModel = validModels.find((model) => model.id === modelId) ?? validModels[0];
  const activeMessages = (detail?.messages ?? []) as Message[];
  const [draftMessages, setDraftMessages] = useState<Message[]>([]);
  const renderedMessages = [...activeMessages, ...draftMessages];

  useEffect(() => {
    if (!selectedId && conversations[0]?.id && !search) setSelectedId(conversations[0].id);
  }, [conversations, selectedId, search]);
  useEffect(() => { setDraftMessages([]); setStreaming(''); setAgentEvents([]); setStreamError(''); setEditingMessage(null); }, [selectedId]);
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
    setBusy(true); setStreamError(''); setStreaming(''); setAgentEvents([]);
    try {
      let id = selectedId;
      if (!id) {
        const created = await createConversation.mutateAsync({ data: { title: promptLabel?.slice(0, 72) || 'New conversation' } });
        id = created.id; setSelectedId(id);
        void cache.invalidateQueries({ queryKey: getListConversationsQueryKey() });
      }
      if (payload.action === 'send' && payload.prompt) {
        setDraftMessages((current) => [...current, { id: Date.now(), role: 'user', content: payload.prompt!, createdAt: new Date().toISOString() }]);
      }
      const response = await fetch(`/api/conversations/${id}/stream`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${response.status})`);
      }
      if (!response.body) throw new Error('The response stream is unavailable.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        const completeBlocks = done && buffer.trim() ? [...blocks, buffer] : blocks;
        if (done) buffer = '';
        for (const block of completeBlocks) {
          const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
          if (!dataLine) continue;
          const eventName = block.split(/\r?\n/).find((line) => line.startsWith('event:'))?.slice(6).trim() ?? '';
          const raw = dataLine.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          let event: StreamUpdate;
          try { event = JSON.parse(raw) as StreamUpdate; } catch { event = { type: eventName || 'token', token: raw }; }
          const nested = event.data && typeof event.data === 'object' ? event.data as StreamUpdate : undefined;
          const type = eventName || event.type || event.event || '';
          if (type === 'error') throw new Error(event.error ?? nested?.error ?? 'The provider request failed.');
          if (type === 'delta') {
            const token = event.token ?? nested?.token;
            if (typeof token === 'string') setStreaming((current) => current + token);
          } else if (type === 'agent') {
            const role = event.role ?? nested?.role;
            const name = event.name ?? nested?.name;
            const status = event.status ?? nested?.status;
            if (role && name && status) setAgentEvents((current) => [...current, `${role} · ${name} · ${status}`]);
          } else if (type === 'done') {
            const finalMessage = event.message ?? nested?.message;
            if (typeof finalMessage === 'string') setStreaming(finalMessage);
            const finalConversation = event.conversation ?? nested?.conversation;
            if (finalConversation && typeof finalConversation === 'object') cache.setQueryData(getGetConversationQueryKey(id), finalConversation);
          } else if (!type && (event.token || event.content || event.text)) {
            setStreaming((current) => current + (event.token ?? event.content ?? event.text ?? ''));
          }
        }
      }
      setDraftMessages([]);
      invalidateConversation(id);
      await cache.invalidateQueries({ queryKey: getGetConversationQueryKey(id) });
      await cache.refetchQueries({ queryKey: getGetConversationQueryKey(id), type: 'active' });
      await cache.invalidateQueries({ queryKey: getListModelsQueryKey() });
      setStreaming('');
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : 'Unable to complete the response.');
    } finally { setBusy(false); }
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

  return <div className="flex h-[calc(100dvh-3.5rem)] min-h-[530px] overflow-hidden">
    {sidebarOpen && <aside className="fixed inset-y-14 left-0 z-30 flex h-[calc(100dvh-3.5rem)] w-[270px] shrink-0 flex-col border-r border-border bg-sidebar shadow-xl md:static md:z-auto md:h-auto md:shadow-none">
      <div className="px-4 pb-3 pt-4"><label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-[#397d67]/20"><Search size={14} /><input data-testid="input-search-conversations" className="w-full bg-transparent text-xs text-foreground outline-none" placeholder="Search conversations" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-4">
        {isLoading ? <div className="space-y-2 p-2" role="status" aria-label="Loading conversations">{[0,1,2,3].map((i) => <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />)}</div>
          : isError ? <div className="m-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">Conversation history couldn’t load.<button className="mt-2 block font-bold underline" onClick={() => void refetch()}>Try again</button></div>
            : !conversations.length ? <div className="m-3 rounded-xl border border-dashed border-border px-3 py-5 text-center"><Clock3 className="mx-auto mb-2 text-muted-foreground" size={17} /><p className="text-xs font-semibold">{search ? 'No matches' : 'Nothing here yet'}</p><p className="mt-1 text-[11px] text-muted-foreground">{search ? 'Try another search term.' : 'Your saved conversations will appear here.'}</p></div>
              : ['Today','Yesterday','Previous 7 days','Older'].map((group) => {
                const groupItems = conversations.filter((item) => dateGroup(item.updatedAt) === group);
                return groupItems.length ? <section key={group} className="mb-3"><h2 className="px-3 pb-1 pt-3 font-mono text-[9px] font-medium uppercase tracking-[.17em] text-muted-foreground">{group}</h2>{groupItems.map((item) => <div key={item.id} className={`group mb-0.5 flex items-center rounded-lg ${selectedId === item.id ? 'bg-[#e3eee8] text-[#285d49]' : 'text-muted-foreground hover:bg-secondary'}`}><button data-testid={`conversation-${item.id}`} onClick={() => { setSelectedId(item.id); if (window.innerWidth < 768) setSidebarOpen(false); }} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-xs font-semibold">{item.title}</button><details className="relative mr-1"><summary aria-label={`Conversation actions: ${item.title}`} className="list-none rounded p-1 opacity-0 hover:bg-white group-hover:opacity-100 focus:opacity-100"><MoreHorizontal size={15} /></summary><div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-border bg-card p-1 shadow-lg"><button data-testid={`rename-conversation-${item.id}`} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary" onClick={() => void doRename(item.id,item.title)}><Pencil size={13} /> Rename</button><button data-testid={`delete-conversation-${item.id}`} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-destructive hover:bg-destructive/5" onClick={() => void doDelete(item.id,item.title)}><Trash2 size={13} /> Delete</button></div></details></div>)}</section> : null;
              })}
      </div>
      <div className="border-t border-border p-3"><Link href="/settings" className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold text-muted-foreground hover:bg-secondary"><Settings2 size={15} /> Provider settings <ArrowRight className="ml-auto" size={13} /></Link></div>
    </aside>}
    {sidebarOpen && <button aria-label="Close conversation history" onClick={() => setSidebarOpen(false)} className="fixed inset-x-0 bottom-0 top-14 z-20 bg-[#1b2a2299] md:hidden" />}
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2"><button data-testid="button-toggle-history" aria-label={sidebarOpen ? 'Hide history' : 'Show history'} onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded p-1.5 text-muted-foreground hover:bg-secondary">{sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button><span className="truncate text-xs font-bold">{detail?.title || 'New conversation'}</span>{busy && <span className="pulse-dot ml-1 h-1.5 w-1.5 rounded-full bg-[#397d67]" />}</div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end">
            <div className="flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Response mode"><button data-testid="button-mode-chat" aria-pressed={mode === 'chat'} onClick={() => setMode('chat')} className={`rounded-md px-3 py-1.5 text-[11px] font-bold ${mode === 'chat' ? 'bg-[#263a32] text-white' : 'text-muted-foreground'}`}>Chat</button><button data-testid="button-mode-swarm" aria-pressed={mode === 'swarm'} onClick={() => setMode('swarm')} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-bold ${mode === 'swarm' ? 'bg-[#263a32] text-white' : 'text-muted-foreground'}`}><Sparkles size={12} /> SWARM</button></div>
            <p data-testid="text-mode-cost-note" className={`max-w-[245px] text-right text-[9px] leading-3 ${mode === 'swarm' ? 'text-[#397d67]' : 'text-muted-foreground'}`}>{mode === 'swarm' ? '3 sequential provider requests · pricing and free quotas apply' : 'Chat uses one model request'}</p>
          </div>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="scroll-thin h-full overflow-y-auto" onScroll={onScroll}>
          {detailLoading && selectedId ? <div className="mx-auto max-w-[760px] space-y-6 px-6 py-12" role="status" aria-label="Loading conversation">{[1,2,3].map((i) => <div key={i} className="animate-pulse space-y-2"><div className="h-3 w-20 rounded bg-muted" /><div className="h-4 w-full rounded bg-muted" /><div className="h-4 w-4/5 rounded bg-muted" /></div>)}</div>
            : detailError && selectedId ? <div className="mx-auto mt-24 max-w-md rounded-2xl border border-destructive/20 bg-card p-7 text-center"><CircleHelp className="mx-auto text-destructive" size={24} /><h2 className="mt-3 font-bold">Couldn’t open this conversation</h2><p className="mt-2 text-sm text-muted-foreground">Try again or select another conversation.</p><button data-testid="button-retry-conversation" onClick={() => void reloadDetail()} className="mt-4 rounded-lg bg-secondary px-4 py-2 text-sm font-semibold">Retry</button></div>
              : !renderedMessages.length && !busy ? <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-center px-6 py-14">
                <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-[#e0eee6] text-[#397d67]"><img src="/brand/swarm-mark.png" alt="" className="h-7 w-7 object-contain" /></div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-[.2em] text-[#397d67]">Your private workspace</p><h1 className="mt-3 max-w-lg text-4xl font-extrabold tracking-[-.065em] md:text-5xl">What are we thinking through?</h1><p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">Choose a connected model and start a conversation. Use SWARM mode for a multi-step response.</p>
                {!validModels.length && <Link href="/settings" className="mt-7 inline-flex w-fit items-center gap-2 rounded-xl border border-[#c8d9cf] bg-white px-4 py-3 text-sm font-bold text-[#28634d] hover:bg-[#f5faf6]"><KeyRound size={15} /> Connect a provider in Settings <ArrowRight size={14} /></Link>}
                <div className="mt-10 grid max-w-[630px] gap-2 sm:grid-cols-2">{['Chat with a model you choose','Compare ideas in SWARM mode'].map((idea) => <div key={idea} className="rounded-xl border border-border bg-card/70 px-4 py-3 text-xs text-muted-foreground"><Sparkles className="mr-2 inline text-[#397d67]" size={13} />{idea}</div>)}</div>
              </div>
              : <div className="mx-auto max-w-[760px] px-6 pb-12 pt-7">
                {renderedMessages.map((message, index) => <article key={`${message.id}-${index}`} data-testid={`message-${message.id}`} className={`appear py-6 ${message.role === 'user' ? 'border-t border-border' : ''}`}>
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.12em] text-muted-foreground">{message.role === 'user' ? 'You' : <><img src="/brand/swarm-mark.png" alt="" className="h-4 w-4 object-contain" /> SWARM</>}<span className="ml-auto normal-case tracking-normal font-medium">{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
                  <div className="message-content text-[14px] text-foreground">{message.content}</div>
                  {message.role === 'user' && <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground"><button data-testid={`edit-message-${message.id}`} disabled={busy || !selectedModel} onClick={() => startEdit(message)} className="hover:text-foreground disabled:opacity-40">Edit</button></div>}
                  {message.role === 'assistant' && <div className="mt-3 flex gap-3 text-[11px] text-muted-foreground"><button data-testid={`copy-message-${message.id}`} onClick={() => void navigator.clipboard.writeText(message.content)} className="inline-flex items-center gap-1 hover:text-foreground"><Copy size={12} /> Copy</button><button data-testid={`regenerate-message-${message.id}`} disabled={busy || !selectedModel || !renderedMessages.slice(0,index).some((entry) => entry.role === 'user')} onClick={() => { const previousUser = renderedMessages.slice(0,index).reverse().find((entry) => entry.role === 'user'); if (previousUser) respondTo('regenerate', previousUser); }} className="hover:text-foreground disabled:opacity-40">Regenerate</button><button data-testid={`continue-message-${message.id}`} disabled={busy || !selectedModel} onClick={() => respondTo('continue', message)} className="hover:text-foreground disabled:opacity-40">Continue</button></div>}
                </article>)}
                {agentEvents.map((event, index) => <div key={`${index}-${event}`} data-testid={`agent-status-${index}`} role="status" className="mb-2 flex items-center gap-2 text-xs text-[#397d67]"><Activity size={13} />{event}</div>)}
                {busy && <article className="py-5" role="status" aria-label="Response streaming"><div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.12em] text-[#397d67]"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#397d67]" />{mode === 'swarm' ? 'SWARM response' : 'Response'}</div><div className="message-content text-sm">{streaming || <span className="text-muted-foreground">Waiting for response…</span>}</div></article>}
                <div ref={endRef} />
              </div>}
        </div>
        {scrollDown && <button data-testid="button-scroll-bottom" onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth' })} className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card p-2 shadow-md" aria-label="Scroll to latest message"><ArrowDown size={15} /></button>}
      </div>
      <div className="shrink-0 bg-background px-4 pb-4 pt-3 md:px-8">
        <div className="mx-auto max-w-[760px]">
          {streamError && <div data-testid="status-stream-error" role="alert" className="mb-2 flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{streamError}<button aria-label="Dismiss error" onClick={() => setStreamError('')}><X size={14} /></button></div>}
          {editingMessage && <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">Editing your message<button data-testid="button-cancel-edit" onClick={() => { setEditingMessage(null); setDraft(''); }} className="font-semibold text-foreground">Cancel</button></div>}
          <form data-testid="form-chat-composer" onSubmit={submit} className="rounded-2xl border border-border bg-card p-3 shadow-[0_8px_28px_rgba(30,52,42,.06)] focus-within:border-[#9fb8a8]">
            <textarea ref={inputRef} data-testid="input-chat-prompt" aria-label="Message SWARM" rows={2} maxLength={32000} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} placeholder={validModels.length ? 'Ask SWARM anything…' : 'Connect a provider to start a conversation…'} disabled={!validModels.length || busy} className="min-h-[52px] max-h-48 w-full resize-y bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60" />
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <label className="sr-only" htmlFor="model-select">Provider and model</label>
              <select id="model-select" data-testid="select-chat-model" value={selectedModel?.id ?? ''} onChange={(e) => setModelId(e.target.value)} disabled={!validModels.length || modelsLoading} className="max-w-[min(54vw,280px)] rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-[#397d67]/20">
                {!validModels.length && <option value="">{modelsLoading ? 'Loading models…' : 'No connected models'}</option>}
                {validModels.map((model) => <option key={model.id} value={model.id}>{model.displayName} · {model.providerName}</option>)}
              </select>
              {selectedModel && <span className="hidden text-[10px] text-muted-foreground sm:inline">{selectedModel.modelId}</span>}
              {!validModels.length && <Link href="/settings" className="inline-flex items-center gap-1 text-[11px] font-bold text-[#397d67]"><Plus size={13} /> Settings</Link>}
              <span className="ml-auto text-[10px] text-muted-foreground">{mode === 'swarm' ? 'Multi-step response' : 'Chat'} · Enter to send</span>
              <button data-testid="button-send-message" type="submit" disabled={busy || !draft.trim() || !selectedModel} aria-label="Send message" className="grid h-9 w-9 place-items-center rounded-xl bg-[#263a32] text-white transition-colors hover:bg-[#397d67] disabled:opacity-40">{busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <ArrowUp size={17} />}</button>
            </div>
          </form>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">SWARM uses your selected provider. Provider billing and limits apply.</p>
        </div>
      </div>
    </section>
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

function SettingsPage() { return <PrivateShell><ProviderSettings /></PrivateShell>; }
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
      <div className="mb-8 flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] font-medium uppercase tracking-[.19em] text-[#397d67]">Workspace / configuration</p><h1 className="mt-2 text-3xl font-extrabold tracking-[-.055em]">Providers</h1><p className="mt-2 max-w-[600px] text-sm leading-6 text-muted-foreground">Connect your own model-provider credentials. Saved keys are encrypted server-side, masked in this workspace, and never fetched back in raw form.</p></div><div className="hidden rounded-xl border border-[#cbdcd1] bg-[#f0f7f2] p-3 text-[#397d67] sm:block"><ShieldCheck size={22} /></div></div>
      {error && <div data-testid="status-provider-error" role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
      {notice && <div data-testid="status-provider-success" role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-[#bdd5c5] bg-[#eff8f1] p-3 text-sm text-[#28634d]"><Check size={15} />{notice}</div>}
      <div className="mb-9 rounded-2xl border border-[#cedcd2] bg-[#eaf2ec] p-5 md:flex md:items-center md:gap-4"><div className="mb-3 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-[#397d67] md:mb-0"><LockKeyhole size={18} /></div><div><h2 className="text-sm font-extrabold">Credentials stay private</h2><p className="mt-1 text-xs leading-5 text-[#5f7066]">SWARM sends a key only to its encrypted save endpoint. After saving, you’ll see a masked hint — never the original value. Keys are not stored in your browser.</p></div></div>
      <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">Connected providers</h2><span className="font-mono text-[10px] text-muted-foreground">{providers.filter((p) => p.configured).length} connected</span></div>
      {isLoading ? <div role="status" aria-label="Loading providers" className="space-y-3">{[1,2,3].map((n) => <div key={n} className="h-40 animate-pulse rounded-2xl bg-muted" />)}</div>
        : isError ? <div className="rounded-2xl border border-destructive/20 bg-card p-8 text-center"><p className="text-sm font-bold">Provider list unavailable</p><p className="mt-1 text-xs text-muted-foreground">Your credentials have not been changed.</p><button data-testid="button-retry-providers" onClick={() => void refetch()} className="mt-4 rounded-lg bg-secondary px-4 py-2 text-xs font-bold">Try again</button></div>
          : <div className="space-y-3">{providers.map((provider) => <form key={provider.providerId} data-testid={`form-provider-${provider.providerId}`} onSubmit={(e) => void onSave(e,provider)} className="rounded-2xl border border-border bg-card p-5 md:p-6">
            <div className="flex flex-wrap items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eff4f0] text-[#397d67]"><KeyRound size={17} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-extrabold">{provider.name}</h3>{provider.configured ? <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f4ec] px-2 py-1 text-[10px] font-bold text-[#347453]"><Check size={11} /> Connected</span> : <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">Not connected</span>}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{providerDescriptions[provider.providerId] || `Connect your ${provider.name} credential.`}</p></div></div>
            {provider.configured && <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-[#f4f7f5] px-3 py-2 text-xs"><span className="font-mono tracking-[.1em] text-muted-foreground">{provider.keyHint || '••••••••'}</span><span className="text-[10px] text-muted-foreground">Key saved · masked</span>{provider.accountId && <span className="ml-auto text-[10px] text-muted-foreground">Account {provider.accountId}</span>}</div>}
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                {provider.needsAccountId && <label className="block"><span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">Cloudflare account ID <span className="text-destructive">*</span></span><input data-testid={`input-account-${provider.providerId}`} value={accounts[provider.providerId] ?? provider.accountId ?? ''} onChange={(e) => setAccounts((current) => ({ ...current, [provider.providerId]: e.target.value }))} autoComplete="off" spellCheck={false} placeholder="Enter your Cloudflare account ID" className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs outline-none focus:border-[#7ca48d] focus:ring-2 focus:ring-[#397d67]/10" /></label>}
                <label className="block"><span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">{provider.configured ? 'Replace API key' : 'API key'} <span className="text-destructive">*</span></span><div className="relative"><input data-testid={`input-key-${provider.providerId}`} type={reveal[provider.providerId] ? 'text' : 'password'} value={secrets[provider.providerId] ?? ''} onChange={(e) => setSecrets((current) => ({ ...current, [provider.providerId]: e.target.value }))} autoComplete="new-password" spellCheck={false} placeholder={provider.configured ? 'Enter a new key to rotate credentials' : `Paste your ${provider.name} API key`} className="h-10 w-full rounded-lg border border-input bg-background px-3 pr-16 font-mono text-xs outline-none focus:border-[#7ca48d] focus:ring-2 focus:ring-[#397d67]/10" /><button data-testid={`button-reveal-${provider.providerId}`} type="button" onClick={() => setReveal((current) => ({ ...current, [provider.providerId]: !current[provider.providerId] }))} className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-secondary">{reveal[provider.providerId] ? 'Hide' : 'Show'}</button></div></label>
              </div>
              <div className="flex items-end gap-2 md:flex-col md:items-stretch md:justify-end"><button data-testid={`button-save-${provider.providerId}`} type="submit" disabled={saveProvider.isPending || !secrets[provider.providerId]?.trim()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#263a32] px-4 text-xs font-bold text-white hover:bg-[#397d67] disabled:opacity-40">{saveProvider.isPending && saveProvider.variables?.providerId === provider.providerId ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Check size={14} />}Save key</button>{provider.configured && <button data-testid={`button-remove-${provider.providerId}`} type="button" disabled={deleteProvider.isPending} onClick={() => void remove(provider)} className="h-10 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-destructive/30 hover:text-destructive">Remove</button>}</div>
            </div>
            {provider.needsAccountId && <p className="mt-2 text-[10px] leading-5 text-muted-foreground">Find this ID in your Cloudflare dashboard under the account overview. It is sent with the key when you save.</p>}
          </form>)}</div>}
      <section className="mt-12">
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-lg font-extrabold tracking-tight">Available models</h2><p className="mt-1 text-xs text-muted-foreground">Live API inventory for your connected providers.</p></div><span className="font-mono text-[10px] text-muted-foreground">{models.length} models</span></div>
        {modelsLoading ? <div role="status" aria-label="Loading models" className="grid gap-2 sm:grid-cols-2">{[1,2,3,4].map((n) => <div key={n} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
          : modelsError ? <div className="rounded-xl border border-border bg-card p-5 text-xs text-muted-foreground">Model inventory couldn’t load.<button onClick={() => void reloadModels()} className="ml-2 font-bold text-foreground underline">Retry</button></div>
            : !models.length ? <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center"><Zap size={20} className="mx-auto text-[#397d67]" /><p className="mt-3 text-sm font-bold">No models available yet</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Save a provider key above. SWARM will show the models returned for your account here.</p></div>
              : <div className="space-y-3">{groupedModels.filter((group) => group.models.length).map(({ provider, models: list }) => <div key={provider.providerId} className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-4 py-3"><span className="text-xs font-bold">{provider.name}</span><span className="font-mono text-[10px] text-muted-foreground">{list.length} models</span></div><div className="divide-y divide-border sm:grid sm:grid-cols-2 sm:divide-y-0">{list.map((model) => <div key={model.id} data-testid={`model-${model.id}`} className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3 last:border-0 sm:border-r sm:odd:border-r sm:even:border-r-0"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#4a8b6b]" /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{model.displayName}</span><span className="max-w-[42%] truncate font-mono text-[9px] text-muted-foreground">{model.modelId}</span></div>)}</div></div>)}</div>}
      </section>
    </div>
  </div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={HomeRedirect} />
    <Route path="/landing"><Redirect to="/" /></Route>
    <Route path="/login"><Redirect to="/sign-in" /></Route>
    <Route path="/signup"><Redirect to="/sign-up" /></Route>
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/app"><Protected><ChatApp /></Protected></Route>
    <Route path="/settings"><Protected><SettingsPage /></Protected></Route>
    <Route component={NotFound} />
  </Switch></ErrorBoundary>;
}
function ClerkRouter() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your SWARM workspace' } }, signUp: { start: { title: 'Create your account', subtitle: 'Start your private AI workspace' } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkCacheReset /><Router /></QueryClientProvider>
  </ClerkProvider>;
}
function App() {
  return <TooltipProvider><WouterRouter base={basePath}><ClerkRouter /></WouterRouter><Toaster /></TooltipProvider>;
}
export default App;
