import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageSquarePlus, Paperclip, Search, Square, X, Monitor, Activity } from 'lucide-react';
import type { ChatAttachment, ChatTurn, Conversation } from '../../shared/chat';
import { chatApi, useChat } from '../lib/chat';
import { useStore } from '../lib/store';
import { useWork } from '../lib/workspace';
import { WorkPanel, WorkSummary } from '../components/WorkPanel';
import { ROLE_META } from '../components/status';
import { ChatMarkdown } from '../components/ChatMarkdown';
import { LogoMark } from '../components/Logo';

const fail = (e: unknown) => useChat.setState({ error: e instanceof Error ? e.message : String(e) });
function groupDate(ts: number) {
  const today = new Date(); today.setHours(0,0,0,0);
  const day = new Date(ts); day.setHours(0,0,0,0);
  const age = Math.round((today.getTime()-day.getTime())/86400000);
  return age === 0 ? 'Today' : age === 1 ? 'Yesterday' : age < 7 ? 'Previous 7 days' : 'Older';
}
export function ChatSidebar() {
  const { list, current } = useChat();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [rename, setRename] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    let live = true;
    const timer = setTimeout(() => { void chatApi.search(query).then(ids => { if (live) setResults(ids); }).catch(fail); }, 140);
    return () => { live = false; clearTimeout(timer); };
  }, [query, list]);
  return <aside className="chat-sidebar"><div className="chat-brand drag"><LogoMark size={22}/><strong>SWARM</strong></div>
    <button className="chat-new" onClick={() => { useStore.getState().setMode('CHAT'); void useChat.getState().fresh().catch(fail); }}><MessageSquarePlus size={16}/> New chat</button>
    <label className="chat-search"><Search size={14}/><input aria-label="Search chats" placeholder="Search chats" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="chat-history">{['Today','Yesterday','Previous 7 days','Older'].map(group => {
      const chats = list.filter(c=>groupDate(c.updatedAt)===group && (!query.trim() || results.includes(c.id)));
      return chats.length > 0 && <section key={group}><h2>{group}</h2>{chats.map(c=><div key={c.id} className="chat-history-row" data-selected={current?.id===c.id}>
        {rename===c.id ? <form onSubmit={e=>{ e.preventDefault(); void chatApi.rename(c.id,title).then(updated=>{useChat.getState().ingest(updated);setRename(null);}).catch(fail); }}><input aria-label="Chat name" autoFocus value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')setRename(null);}}/><button>Save</button></form> : <><button className="chat-history-title" onClick={()=>{useStore.getState().setMode('CHAT');void useChat.getState().open(c.id).catch(fail);}}>{c.title}</button><button aria-label={`Rename ${c.title}`} onClick={()=>{setRename(c.id);setTitle(c.title);}}>⋯</button><button aria-label={`Delete ${c.title}`} onClick={()=>{void chatApi.remove(c.id).then(()=>{if(current?.id===c.id)useChat.setState({current:null});return useChat.getState().refresh();}).catch(fail);}}><X size={12}/></button></>}
      </div>)}</section>;
    })}</div>
    <div className="chat-sidebar-footer"><button onClick={()=>useStore.getState().setView('agents')}>Agents</button><button onClick={()=>useStore.getState().setView('runs')}>Projects</button><button onClick={()=>useStore.getState().setView('phone')}>Connect PC / phone</button><button onClick={()=>useStore.getState().setView('models')}>Models</button><button onClick={()=>useStore.getState().setView('settings')}>Settings</button></div>
  </aside>;
}

export function Chat() {
  const current = useChat(state => state.current);
  const error = useChat(state => state.error);
  const models = useStore(s=>s.models);
  const [text,setText] = useState('');
  const [attachments,setAttachments] = useState<ChatAttachment[]>([]);
  const [model,setModel] = useState('');
  const [copied,setCopied] = useState<string | null>(null);
  const [sending,setSending] = useState(false);
  const [editing,setEditing] = useState<string | undefined>();
  const [drawer,setDrawer] = useState(false);
  const [away,setAway] = useState<{ files: number; tasks: number; approvals: number } | null>(null);
  const view = useStore(state => state.view);
  const absentSince = useRef<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<{ id?: string; ids: Set<string> }>({ ids: new Set() });
  if (history.current.id !== current?.id) history.current = { id: current?.id, ids: new Set(current?.turns.map(t => t.id) ?? []) };
  const running = current?.turns.some(t=>t.status==='streaming') ?? false;
  useEffect(()=>{
    const off=window.swarm.on('chat:updated',c=>useChat.getState().ingest(c as Conversation));
    void useChat.getState().refresh().then(async()=>{const id=localStorage.getItem('swarm:chat');if(id && useChat.getState().list.some(c=>c.id===id))await useChat.getState().open(id);}).catch(fail);
    const prefill=(e:Event)=>{setText((e as CustomEvent<string>).detail); input.current?.focus();};
    window.addEventListener('swarm:chat-prefill',prefill);
    return ()=>{off();window.removeEventListener('swarm:chat-prefill',prefill);};
  },[]);
  useEffect(()=>{if(stick.current && scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[current]);
  useEffect(()=>{stick.current=true;setEditing(undefined);setText('');setAttachments([]);},[current?.id]);
  useEffect(() => {
    const id = current?.id;
    const seen = id ? Number(localStorage.getItem(`swarm:seen:${id}`) ?? 0) : 0;
    void useWork.getState().open({ conversationId: id, runId: current?.runId, projectId: current?.projectId }).then(() => {
      if (!id || useWork.getState().scope.conversationId !== id) return;
      if (seen) {
        const state = useWork.getState();
        const recent = state.events.filter(event => event.ts > seen);
        const files = new Set(recent.filter(event => event.type.startsWith('file_')).map(event => event.data?.path ?? event.id)).size;
        const tasks = recent.filter(event => event.type === 'task_completed').length;
        if (files || tasks || state.approvals.length) setAway({ files, tasks, approvals: state.approvals.length });
      }
      if (!document.hidden) localStorage.setItem(`swarm:seen:${id}`, String(Date.now()));
    });
  }, [current?.id, current?.runId, current?.projectId]);
  useEffect(() => {
    const returnToChat = () => {
      if (absentSince.current === null) return;
      const since = absentSince.current;
      absentSince.current = null;
      void useWork.getState().refresh().then(() => {
        const state = useWork.getState();
        const recent = state.events.filter(event => event.ts > since);
        const files = new Set(recent.filter(event => event.type.startsWith('file_')).map(event => event.data?.path ?? event.id)).size;
        const tasks = recent.filter(event => event.type === 'task_completed').length;
        if (files || tasks || state.approvals.length) setAway({ files, tasks, approvals: state.approvals.length });
      });
    };
    if (view !== 'chat') absentSince.current ??= Date.now(); else returnToChat();
    const visibility = () => {
      if (document.hidden) { absentSince.current ??= Date.now(); if (current?.id) localStorage.setItem(`swarm:seen:${current.id}`, String(absentSince.current)); }
      else if (view === 'chat') returnToChat();
    };
    const closing = () => { if (current?.id) localStorage.setItem(`swarm:seen:${current.id}`, String(absentSince.current ?? Date.now())); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('beforeunload', closing);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('beforeunload', closing); };
  }, [view, current?.id]);
  const send=async(value=text,retryFrom=editing,files=attachments)=>{
    if(!value.trim()||sending)return;
    setSending(true);useChat.setState({error:''});stick.current=true;
    try {
      if(!useChat.getState().current)await useChat.getState().fresh();
      const id=useChat.getState().current!.id;
      const updated = await chatApi.send({id,text:value,attachments:files,model:model||undefined,retryFrom});
      useChat.getState().ingest(updated);
      setText('');setAttachments([]);setEditing(undefined);
    } catch(e){fail(e);} finally {setSending(false);}
  };
  const retry=(index:number)=>{const user=current?.turns.slice(0,index).reverse().find(t=>t.role==='user');if(user)void send(user.text,user.id,user.attachments??[]);};
  const edit=(t:ChatTurn)=>{setText(t.text);setAttachments(t.attachments??[]);setEditing(t.id);input.current?.focus();};
  const speaker = current?.agentRole && current.agentRole !== 'manager' ? ROLE_META[current.agentRole].name : 'SWARM';
  return <div className="chat-workspace">
    <div className="chat-conversation-area">
    <div className="chat-context-header"><div><strong>{speaker}</strong><span>{current?.agentRole ? ROLE_META[current.agentRole].title : 'Your coordinator'}</span></div><WorkSummary onOpen={() => setDrawer(true)} /></div>
    <div className="chat-scroll" ref={scroll} onScroll={()=>{const el=scroll.current!;stick.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;}}>
      <div className="chat-messages">{away && <div className="chat-away"><Activity size={16}/><div><strong>While you were away</strong><p>{[away.files ? `${away.files} file${away.files === 1 ? '' : 's'} changed` : '', away.tasks ? `${away.tasks} task${away.tasks === 1 ? '' : 's'} completed` : '', away.approvals ? `${away.approvals} approval${away.approvals === 1 ? '' : 's'} waiting` : ''].filter(Boolean).join(' · ')}</p></div><button aria-label="Dismiss away summary" onClick={() => setAway(null)}><X size={14}/></button></div>}{!current?.turns.length ? <div className="chat-empty"><LogoMark size={38}/><h1>What shall we work on?</h1><p>Talk to SWARM. Your team can investigate, build, test, and work on your PC.</p><div>{['Check my PC and tell me what’s open','Check the project','Build a website'].map(s=><button key={s} onClick={()=>{setText(s);input.current?.focus();}}>{s}</button>)}</div></div> : current.turns.map((t,i)=><article data-status={t.status} className={`chat-message ${history.current.ids.has(t.id) ? '' : 'motion-arrive'} ${t.role}`} key={t.id}>
        <div className="chat-message-label">{t.role==='user'?'You':speaker}{t.model&&<span key={t.model} className="motion-arrive">{t.model}</span>}</div>
        <ChatMarkdown text={t.text}/>
        {t.attachments?.map((a,j)=><span className="chat-file" key={j}>{a.name}</span>)}
        {t.activities?.length ? <div className="chat-tool-cards">{t.activities.map(activity => <details key={activity.id} className="chat-tool-card" data-status={activity.status}><summary>{activity.tool.startsWith('computer') ? <Monitor size={14}/> : <Activity size={14}/>}<span>{activity.label}</span><small>{activity.status === 'complete' ? '✓ Complete' : activity.status === 'approval' ? 'Approval required' : activity.status === 'error' ? 'Failed' : 'Working…'}</small></summary>{activity.detail && <pre>{activity.detail}</pre>}{activity.preview && <img src={activity.preview} alt="Observed PC screen"/>}{activity.tool.startsWith('computer') && <button type="button" onClick={() => useStore.getState().setView('phone')}>View PC connection</button>}</details>)}</div> : null}
        {t.status==='streaming'&&<div className="chat-stream" role="status">{t.routing??'Thinking'}<span> ▍</span></div>}
        {t.status==='error'&&<div className="chat-error" role="alert">{t.error}</div>}
        {t.status==='stopped'&&<p className="chat-meta">Response stopped</p>}
        {t.omitted ? <p className="chat-meta">{t.omitted} older messages are outside this model’s context. They remain in this chat.</p> : null}
        <div className="chat-actions"><button onClick={()=>void navigator.clipboard.writeText(t.text).then(()=>setCopied(t.id)).catch(fail)}>{copied===t.id?'Copied':'Copy'}</button>
          {t.role==='user'?<button disabled={running||sending} onClick={()=>edit(t)}>Edit</button>:<><button disabled={running||sending} onClick={()=>retry(i)}>{t.status==='error'?'Retry':'Regenerate'}</button><button disabled={running||sending} onClick={()=>void send('Continue your previous response.',undefined,[])}>Continue</button><span>{t.status==='complete'&&t.routing}</span></>}
        </div>
      </article>)}</div>
    </div>
    <div className="chat-composer-wrap">
      {error&&<div className="chat-error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>useChat.setState({error:''})}><X size={14}/></button></div>}
      {editing&&<div className="chat-meta">Editing message · later replies will be replaced <button onClick={()=>{setEditing(undefined);setText('');}}>Cancel</button></div>}
      <form className={`chat-composer ${sending ? "motion-sent" : ""}`} aria-busy={sending} onSubmit={e=>{e.preventDefault();void send();}}>
        <textarea ref={input} id="chat-input" aria-label="Ask SWARM anything" placeholder="Ask SWARM anything…" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/>
        <div className="chat-attachments">{attachments.map((a,i)=><button type="button" key={i} onClick={()=>setAttachments(attachments.filter((_,j)=>i!==j))}>{a.name} ×</button>)}</div>
        <div className="chat-composer-controls"><label className="chat-attach" title="Attach text or code files"><Paperclip size={16}/><input type="file" multiple aria-label="Attach files" onChange={e=>{const files=Array.from(e.target.files??[]);void Promise.all(files.map(async f=>{if(f.size>200_000)throw new Error('Files must be under 200 KB.');const text=await f.text();if(text.includes('\u0000'))throw new Error('Choose text or code files.');return {name:f.name,text};})).then(a=>{if(attachments.length+a.length>5)throw new Error('Attach up to five files.');setAttachments([...attachments,...a]);}).catch(fail);e.target.value='';}}/></label>
          <select aria-label="Chat model" value={model} onChange={e=>setModel(e.target.value)}><option value="">Auto</option>{models.filter(m=>m.enabled).map(m=><option value={m.id} key={m.id}>{m.displayName} · {m.providerId}</option>)}</select>
          {running && <button type="button" className="chat-stop" aria-label="Stop generation" onClick={()=>{if(current)void chatApi.stop(current.id).catch(fail);}}><Square size={14}/></button>}<button className="chat-send" aria-label="Send message" disabled={!text.trim()||sending}><ArrowUp size={17}/></button>
        </div>
      </form><p className="chat-footnote">Work continues in the background. SWARM will keep you updated here.</p>
    </div>
    </div>
    <div className="work-desktop"><WorkPanel/></div>
    {drawer && <div className="work-drawer-backdrop" onClick={() => setDrawer(false)}><div role="dialog" aria-modal="true" aria-label="Live work drawer" onClick={event => event.stopPropagation()}><WorkPanel drawer onClose={() => setDrawer(false)}/></div></div>}
  </div>;
}
