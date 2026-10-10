'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Boxes, Check, MessageSquareText, Activity, ListTree, Globe2, FileDiff, MessagesSquare } from 'lucide-react';
import { GeneratedFiles } from './generated-files';
import { Status } from './design-system';
import { ProjectPreview } from './project-preview';
import {codeFiles} from '@/lib/code-files';
import { ChatMarkdown } from './chat-markdown';
import { AgentGraph, TaskGraph } from './desktop/AgentGraph';
import { ROLE_META } from './desktop/status';
import type { AgentRole, AgentState, Run, Task } from './desktop/types';

export type BuildEvent = { role:string; name:string; status:string; time?:number;output?:string };
const work = [
  {role:'planner' as const,title:'Plan project and files'},
  {role:'coder' as const,title:'Generate complete project code'},
  {role:'reviewer' as const,title:'Review and refine generated code'},
  {role:'finalizer' as const,title:'Package downloadable project files'},
];
export function BuildLayout({enabled,busy,events,objective,error,children,onChat,conversationId,artifactText}:{conversationId:string|null;artifactText:string;enabled:boolean;busy:boolean;events:BuildEvent[];objective:string;error:string;children:ReactNode;onChat:()=>void}) {
  const [mode,setMode]=useState<'agents'|'tasks'>('agents');
  const [selected,setSelected]=useState<AgentRole>('manager');
  const [mobileTab,setMobileTab]=useState('graph');
  const [surface,setSurface]=useState('activity');
  const [height,setHeight]=useState(460);const area=useRef<HTMLElement>(null);
  useEffect(()=>{if(!enabled||!area.current)return;const observer=new ResizeObserver(entries=>setHeight(Math.max(180,entries[0].contentRect.height-42)));observer.observe(area.current);return()=>observer.disconnect();},[enabled,mobileTab]);
  if(!enabled)return <>{children}</>;
  const finalEvent=events.filter(e=>e.role==='finalizer').at(-1);
  const status=busy?'running':error||events.some(e=>e.status==='failed')?'failed':finalEvent?.status==='completed'?'completed':events.length?'cancelled':'paused';
  const tasks:Task[]=work.map((item,i)=>{
    const event=events.filter(e=>e.role===item.role).at(-1);
    const taskStatus=event?.status==='completed'?'completed':event?.status==='failed'?'failed':event?.status==='working'?(busy?'running':'cancelled'):'waiting';
    return {id:item.role,runId:'web-build',key:item.role,title:item.title,description:item.title,role:item.role,kind:'code',status:taskStatus,deps:i?[work[i-1].role]:[],attempt:1,scope:[],output:null,error:null,modelId:null,startedAt:event?.time||null,endedAt:event?.status==='completed'?event.time||null:null,createdAt:0,filesTouched:[],tokens:0};
  });
  const agents:Partial<Record<AgentRole,AgentState>>={};
  for(const role of ['manager',...work.map(w=>w.role)] as AgentRole[]){const task=tasks.find(t=>t.role===role);agents[role]={role,status:task?.status==='completed'?'completed':task?.status==='running'?'working':task?.status==='failed'?'failed':'waiting',taskId:task?.id||null,taskTitle:task?.title||null,modelId:null,lastAction:null,tasksDone:task?.status==='completed'?1:0,errors:task?.status==='failed'?1:0,tokens:0,filesTouched:[],updatedAt:0};}
  const run:Run={id:'web-build',projectId:'web-project',objective,status,startedAt:events[0]?.time||0,endedAt:null,summary:null,brief:null,gates:[],previewUrl:null,repairCycles:0,options:{webResearch:false,autonomy:'assisted',attachments:[],pinnedModel:null},stats:{tasks:tasks.length,completed:tasks.filter(t=>t.status==='completed').length,failed:tasks.filter(t=>t.status==='failed').length,modelCalls:events.filter(e=>e.status==='working'&&e.role!=='finalizer').length,fallbacks:0,tokens:0,files:0,commands:0,sources:0}};
  const select=(role:AgentRole)=>{setSelected(role);setMobileTab('manager');};
  const Meta=ROLE_META[selected];const selectedEvent=events.filter(e=>e.role===selected).at(-1);
  return <div className="desktop-build" data-mobile-tab={mobileTab}>
    <div className="build-workspace"><div className="sw-build-phases"><Status tone={status==='completed'?'success':status==='failed'?'error':busy?'warning':'neutral'}>{status==='paused'?'Ready to build':status}</Status>{tasks.map((t,i)=><span key={t.id} data-state={t.status}>{t.status==='completed'?<Check size={12}/>:<span>{String(i+1).padStart(2,'0')}</span>}{['Plan','Generate','Review','Package'][i]}</span>)}</div>
      <div className="build-mobile-tabs" role="tablist" aria-label="Build panels">{[['graph','Graph'],['preview','Preview'],['activity','Activity'],['manager','Manager']].map(([key,label])=><button key={key} role="tab" aria-selected={mobileTab===key} onClick={()=>{setMobileTab(key);if(key==='preview')setSurface('preview');else if(key==='activity')setSurface('activity');}}>{label}</button>)}</div>
      <div className="build-control-room">
        <div className="build-main-surface">
          <div className="build-mission"><span className="mission-icon"><Boxes size={25}/></span><div className="mission-heading"><h1>Build workspace</h1><p className="mission-objective" title={objective}>{objective||'Describe the project you want SWARM to build.'}</p></div><button className="build-back-chat" onClick={onChat}><MessageSquareText size={15}/> Chat</button><div className="mission-counts"><div><strong>{run.stats.completed}</strong><span>Completed</span></div><div><strong>{tasks.filter(t=>t.status==='running').length}</strong><span>Active</span></div><div><strong>{tasks.filter(t=>t.status==='waiting').length}</strong><span>Queued</span></div></div></div>
          <section className="build-graph-surface" ref={area} style={surface!=='activity'?{flex:'0 0 32%'}:undefined}><div className="build-graph-toolbar"><div className="build-segment" role="group" aria-label="Graph mode"><button aria-pressed={mode==='agents'} onClick={()=>setMode('agents')}>Agents</button><button aria-pressed={mode==='tasks'} onClick={()=>setMode('tasks')}>Dependencies</button></div><span>5 agents · 4 tasks</span></div>{mode==='agents'?<AgentGraph run={run} tasks={tasks} agents={agents} selected={selected} onSelect={select} height={height}/>:<TaskGraph tasks={tasks} height={height} onSelect={select}/>}</section>
          <section className="build-activity-surface" style={surface!=='activity'?{height:'auto',flex:1}:undefined}><div className="build-activity-tabs" role="tablist" aria-label="Build output">{([{key:'activity',label:'Live Activity',icon:ListTree},{key:'tasks',label:'Tasks',icon:Boxes},{key:'preview',label:'Preview',icon:Globe2},{key:'files',label:'Files',icon:FileDiff},{key:'messages',label:'Messages',icon:MessagesSquare}]).map(tab=><button key={tab.key} role="tab" aria-selected={surface===tab.key} onClick={()=>{setSurface(tab.key);setMobileTab(tab.key==='preview'?'preview':'activity');}}><tab.icon size={14}/>{tab.label}</button>)}</div>{surface==='preview'?<ProjectPreview id={conversationId} version={artifactText}/>:surface==='files'?<GeneratedFiles text={artifactText}/>:surface==='messages'?<div className="build-stage-scroll">{events.filter(e=>e.output).map((e,i)=><article key={i}><strong>{e.name}</strong><ChatMarkdown text={e.output!}/></article>)}</div>:surface==='tasks'?<div className="build-task-list">{tasks.map(task=><button key={task.id} onClick={()=>select(task.role)}><Boxes size={14}/><span>{task.title}</span><small>{task.status}</small></button>)}</div>:<div className="build-activity-log">{events.length?events.map((event,i)=><p key={i}>{event.status==='completed'?<Check size={12}/>:<Activity size={12}/>}<span>{event.name} · {event.status}</span></p>):<p>Start a build to see live agent activity.</p>}</div>}</section>
        </div>
        <section className="build-agent-panel"><div className="build-panel-heading"><Meta.icon size={25}/><div><strong>{Meta.name}</strong><small>{Meta.title}</small></div><button onClick={()=>setMobileTab('graph')} className="ml-auto text-muted-foreground min-[1101px]:hidden" aria-label="Return to graph"><Boxes size={16}/></button></div>{selected==='manager'?children:<div className="agent-output"><button className="build-back-chat" onClick={()=>setSelected('manager')}><MessageSquareText size={14}/> Back to Manager</button><p className="agent-output-status">{selectedEvent?.status||'Waiting for the build to start'}</p>{selectedEvent?.output?<ChatMarkdown text={selectedEvent.output}/>:<p>The {Meta.name.toLowerCase()} output appears here when its stage completes.</p>}</div>}</section>
      </div>
    </div>
  </div>;
}

