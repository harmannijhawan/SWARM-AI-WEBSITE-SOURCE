import { accountUsage, fingerprint, managedTransaction, initializeAccount, ManagedError, planCatalog, reserveUsage, settleUsage, saveManagedPreferences } from './entitlements';
import { cashfreeWebhook, checkoutAvailable, createCheckout, verifyOrder, cashfreeEnvironment } from './cashfree';
import { modelPolicy, managedCredentials, eligibleModelIds, routingPolicy, safeProviderFailure, validateManagedMessages } from './managed-providers';
import {projectPreview} from './project-preview';
import { accountApi, accountTables, deviceOwner } from './accounts';
import { codeFiles } from '../code-files';
import { zipSync, strToU8 } from 'fflate';
import {Storage,storageContext} from './storage';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Conversation, StreamConversationInput } from '../cloud-api/generated/api.schemas';
import { adapters } from './providers';
import type { ChatMessage, ProviderConfig } from './desktop-providers/types';
import { rankAutomatic, type RouteHealth, type Purpose } from './auto-router';
import type { Capability } from './desktop-providers/domain-types';
import { ProviderError } from './desktop-providers/types';
import { chatBudget } from './chat-budget';
import { validateConfiguration, logConfigurationIssues, throwIfConfigurationInvalid } from './config-validator';

type Model = { id:string; modelId:string; displayName:string; providerId:string; providerName:string; capabilities?:Capability[]; contextLength?:number|null };
type State = { db:Storage; secret:Buffer; active:Set<string>; models:Map<string,{time:number; value:{models:Model[];errors:{providerId:string;error:string}[]}}> };
const globalState = globalThis as typeof globalThis & { swarmWeb?:State };
function state():State {
  if (globalState.swarmWeb) return globalState.swarmWeb;
  // Validate configuration at startup
  const configIssues = validateConfiguration();
  logConfigurationIssues(configIssues);
  throwIfConfigurationInvalid(configIssues);
  
  const cloud=process.env.SWARM_DATABASE_URL||process.env.DATABASE_URL;
  const dir=process.env.SWARM_DATA_DIR||join(process.cwd(),'.swarm-web');
  let secret:Buffer;
  if(cloud){if(!process.env.SWARM_ENCRYPTION_KEY)throw new Error('Cloud encryption key is required.');secret=Buffer.from(process.env.SWARM_ENCRYPTION_KEY,'base64');if(secret.length!==32)throw new Error('Invalid encryption key.');}
  else{mkdirSync(dir,{recursive:true,mode:0o700});const keyPath=join(dir,'encryption.key');if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});secret=process.env.SESSION_SECRET?createHash('sha256').update(process.env.SESSION_SECRET).digest():readFileSync(keyPath);}
  const db=new Storage(join(dir,'chat.sqlite'),cloud);
  void db.initialize(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS active_runs(owner TEXT NOT NULL,id TEXT NOT NULL,lease TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS credentials (owner TEXT NOT NULL, provider TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,provider)); CREATE TABLE IF NOT EXISTS routing_health (owner TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,id));`);
  return globalState.swarmWeb = {db,secret,active:new Set(),models:new Map()};
}
class HttpError extends Error { constructor(public status:number,message:string) {super(message);} }
const json = (data:unknown,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const now = () => new Date().toISOString();
async function ownerFor(request:Request):Promise<string> {
  const url = new URL(request.url); const origin = request.headers.get('origin');
  const allowedOrigins=new Set([url.origin,'https://www.swarmgpt.online','https://swarmgpt.online']);
  if(['localhost','127.0.0.1','[::1]'].includes(url.hostname)){allowedOrigins.add(`${url.protocol}//localhost:${url.port}`);allowedOrigins.add(`${url.protocol}//127.0.0.1:${url.port}`);}
  if (origin && !allowedOrigins.has(origin)) throw new HttpError(403,'Cross-origin requests are not allowed.');
  if (process.env.CLERK_SECRET_KEY) {
    const token = request.headers.get('authorization')?.replace(/^Bearer /,'') || request.headers.get('cookie')?.match(/(?:^|;\s*)__session=([^;]+)/)?.[1];
    if(token?.startsWith('swarm_device_')) {const owner=await deviceOwner(state().db,token);if(owner)return owner;throw new HttpError(401,'Desktop session expired. Sign in again.');}
    if (!token) throw new HttpError(401,'Sign in to continue.');
    try { const {verifyToken} = await import('@clerk/backend'); return (await verifyToken(token,{secretKey:process.env.CLERK_SECRET_KEY,authorizedParties:[...allowedOrigins]})).sub; }
    catch {throw new HttpError(401,'Your session expired. Sign in again.');}
  }
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || (request.headers.get('x-forwarded-host') && !['localhost','127.0.0.1','[::1]'].includes(new URL('http://' + request.headers.get('x-forwarded-host')).hostname))) throw new HttpError(403,'Local workspace is available only on this computer. Configure Clerk before hosting publicly.');
  return 'local-workspace';
}
async function accountPreferences(owner:string):Promise<any>{await accountTables(state().db);const row=await state().db.prepare('SELECT data FROM account_documents WHERE owner=? AND id=?').get(owner,'preferences') as {data:string}|undefined;return row?JSON.parse(row.data):{};}
async function credentials(_owner:string,provider:string,_respectSettings=true):Promise<ProviderConfig|null> { return managedCredentials(provider); }
export async function storeAccountKey() { throw new ManagedError(403,'managed_credentials','Provider credentials are managed exclusively by SWARM.'); }
export async function claimLocalAccount(id:string,email:string) {
  const st=state();await accountTables(st.db);await st.db.exec('BEGIN IMMEDIATE');
  try {
    await st.db.prepare('INSERT OR REPLACE INTO accounts VALUES(?,?,?)').run(id,email,'owner');
    const count=(await st.db.prepare('UPDATE conversations SET owner=? WHERE owner=?').run(id,'local-workspace')).changes;
    const keys=0;
    await st.db.exec('COMMIT');return {conversations:Number(count),providers:keys};
  }catch(e){await st.db.exec('ROLLBACK');throw e;}
}
export function accountDatabase(){return state().db;}
export function accountEncryptionKey(){return state().secret.toString('base64');}
async function summary(owner:string,provider:string) {
  const adapter=adapters.find(a=>a.id===provider)!;const config=await credentials(owner,provider);
  return {providerId:provider,name:adapter.name,configured:!!config,needsAccountId:false,accountId:null,keyHint:null,managed:true};
}
async function modelList(owner:string) {
  const eligible=new Set(await eligibleModelIds(state().db,owner));
  const cacheKey=JSON.stringify([[...eligible],adapters.map(a=>{const c=managedCredentials(a.id);return c?fingerprint([a.id,c.apiKey,c.accountId]):a.id+':unconfigured';})]);const cache=state().models.get(cacheKey);if(cache && Date.now()-cache.time<60000)return cache.value;
  const models:Model[]=[];const errors:{providerId:string;error:string}[]=[];
  await Promise.all(adapters.map(async adapter=>{
    const config=await credentials(owner,adapter.id);if(!config||![...eligible].some(id=>id.startsWith(adapter.id+':')))return;
    try {const found=await adapter.discover(config,AbortSignal.timeout(18000));models.push(...found.filter(m=>eligible.has(adapter.id+':'+m.modelId)).map(m=>({id:`${adapter.id}:${m.modelId}`,modelId:m.modelId,displayName:m.displayName,providerId:adapter.id,providerName:adapter.name,capabilities:m.capabilities,contextLength:m.contextLength})));}
    catch {errors.push({providerId:adapter.id,error:'SWARM provider discovery is temporarily unavailable.'});}
  }));
  models.sort((a,b)=>adapters.findIndex(p=>p.id===a.providerId)-adapters.findIndex(p=>p.id===b.providerId)||a.modelId.localeCompare(b.modelId));
  const value={models,errors};state().models.set(cacheKey,{time:Date.now(),value});return value;
}
async function getConversation(owner:string,id:string):Promise<Conversation> {
  const row=await state().db.prepare('SELECT data FROM conversations WHERE id=? AND owner=?').get(id,owner) as {data:string}|undefined;
  if(!row)throw new HttpError(404,'Conversation not found.');return JSON.parse(row.data);
}
async function saveConversation(owner:string,c:Conversation) {
  c.updatedAt=now();await state().db.prepare('INSERT INTO conversations(id,owner,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE owner=excluded.owner').run(c.id,owner,JSON.stringify(c));
}
async function bodyFor(request:Request):Promise<Record<string,unknown>> {
  const text=await request.text();if(text.length>(new URL(request.url).pathname==='/api/managed/complete'?6500000:100000))throw new HttpError(413,'Request is too large.');
  try {const value=JSON.parse(text||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new HttpError(400,'Invalid JSON request.');}
}
async function routeHealth(owner:string,id:string):Promise<RouteHealth|undefined> {
  owner='swarm-managed';
  
  const row=await state().db.prepare('SELECT data FROM routing_health WHERE owner=? AND id=?').get(owner,id) as {data:string}|undefined;
  return row?JSON.parse(row.data):undefined;
}
async function recordRoute(owner:string,id:string,ok:boolean,latency:number,tokens=0,error?:unknown) {
  owner='swarm-managed';
  const old=(await routeHealth(owner,id))||{calls:0,successes:0,consecutiveFailures:0,latencyMs:null,cooldownUntil:0,tokensPerSec:null};
  const value:RouteHealth={calls:old.calls+1,successes:old.successes+(ok?1:0),consecutiveFailures:ok?0:old.consecutiveFailures+1,latencyMs:ok?latency:old.latencyMs,tokensPerSec:ok&&latency?tokens/(latency/1000):old.tokensPerSec,cooldownUntil:ok?0:Date.now()+(error instanceof ProviderError&&['auth','quota'].includes(error.kind)?300000:60000)};
  await state().db.prepare('INSERT OR REPLACE INTO routing_health(owner,id,data) VALUES(?,?,?)').run(owner,id,JSON.stringify(value));
}
const providerError = safeProviderFailure;
async function streamChat(request:Request,owner:string,id:string,raw:Record<string,unknown>):Promise<Response> {
  const budget=chatBudget(request.signal);
  try { return await streamChatWithBudget(request,owner,id,raw,budget); }
  catch(error) { budget.dispose(); throw error; }
}
async function streamChatWithBudget(request:Request,owner:string,id:string,raw:Record<string,unknown>,budget:ReturnType<typeof chatBudget>):Promise<Response> {
  const requestId=randomUUID();const requestStarted=Date.now();let stage='preflight';let attempt=0;
  const input=raw as unknown as StreamConversationInput;
  const clientRequestId=typeof raw.requestId==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(raw.requestId)?raw.requestId:undefined;
  if(!['send','edit','regenerate','continue'].includes(input.action)||!['chat','swarm'].includes(input.mode)||typeof input.modelId!=='string'||input.modelId.length>200)throw new HttpError(400,'Invalid chat request.');
  const automatic=input.modelId==='auto';
  const adapter=adapters.find(a=>a.id===input.providerId);const config=adapter&&await credentials(owner,adapter.id);
  if(!automatic&&(!adapter||!config))throw new HttpError(412,'SWARM has no configured provider for this model. Please retry later.');
  const c=await getConversation(owner,id);let reservation:string|undefined;let succeeded=false;const lock=`${owner}:${id}`;
  if(state().active.has(lock))throw new HttpError(409,'This conversation is already responding.');const lease=randomUUID();const acquired=await state().db.prepare('INSERT INTO active_runs(owner,id,lease,expires) VALUES(?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET lease=excluded.lease,expires=excluded.expires WHERE active_runs.expires<? RETURNING lease').get(owner,id,lease,Date.now()+360000,Date.now());if(!acquired)throw new HttpError(409,'This conversation is already responding.');state().active.add(lock);
  try {
    const available=await modelList(owner);
    if(budget.signal.aborted)throw new HttpError(budget.timedOut?504:499,budget.timedOut?'The request exceeded its time limit. Try again.':'Request cancelled.');
    if(automatic?!available.models.length:!available.models.some(m=>m.providerId===input.providerId&&m.modelId===input.modelId))throw new HttpError(412,'Choose a currently available model.');
    const prompt=typeof input.prompt==='string'?input.prompt.trim():'';
    if(['send','edit'].includes(input.action)&&(!prompt||prompt.length>32000))throw new HttpError(400,'Enter a message of up to 32,000 characters.');
    const target=c.messages.findIndex(m=>m.id===input.messageId&&m.role==='user');
    if(input.action==='edit'||input.action==='regenerate'){
      if(target<0)throw new HttpError(400,'Choose a user message to edit or regenerate.');c.messages=c.messages.slice(0,target+1);
      if(input.action==='edit')c.messages[target].content=prompt;
    }else if(input.action==='continue'&&c.messages.at(-1)?.role!=='assistant')throw new HttpError(400,'There is no response to continue.');
    reservation=await reserveUsage(state().db,owner,clientRequestId||requestId,input.mode==='swarm'?'build':'chat',{id,raw});
    if(input.action==='send'){const message={id:Date.now(),role:'user' as const,content:prompt,createdAt:now(),requestId:clientRequestId};c.messages.push(message);}
    if(['New chat','New conversation'].includes(c.title))c.title=prompt.replace(/\s+/g,' ').slice(0,80)||c.title;await saveConversation(owner,c);
  }catch(error){if(reservation)await settleUsage(state().db,owner,reservation,false);state().active.delete(lock);await state().db.prepare('DELETE FROM active_runs WHERE owner=? AND id=? AND lease=?').run(owner,id,lease);throw error;}
  const abort=budget;let disconnected=request.signal.aborted;const cancel=()=>{disconnected=true;abort.abort();};request.signal.addEventListener('abort',cancel,{once:true});
  const encoder=new TextEncoder();let content='';let routedModel:Model|undefined;const buildEvents:{role:string;name:string;status:string;time:number;output?:string}[]=[];
  const stream=new ReadableStream<Uint8Array>({
    async start(controller){
      const enqueue=(data:string)=>{if(!disconnected){try{controller.enqueue(encoder.encode(data));}catch{cancel();}}};
      const event=(type:string,data:unknown)=>{if(type==='agent')buildEvents.push({...data as {role:string;name:string;status:string},time:Date.now()});enqueue(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
      const heartbeat=setInterval(()=>enqueue(': keepalive\n\n'),15000);
      const system='You are SWARM AI. Be accurate and useful. For code requests, provide complete runnable files in fenced code blocks labeled with language and filename, for example ```python filename=main.py. The website turns these into downloadable files and a ZIP. Never claim you ran tools or changed files unless actually performed.';
      const history:ChatMessage[]=c.messages.slice(-40).map(m=>({role:m.role,content:m.content}));
      if(input.action==='continue')history.push({role:'system',content:'Continue the previous answer without repeating it.'});
      const complete=async(messages:ChatMessage[],streaming:boolean,purpose?:Purpose)=>{
        stage=purpose||'chat';abort.signal.throwIfAborted();
        const policy=await routingPolicy(state().db,owner);
        const available=(await modelList(owner)).models.filter(m=>policy.ids.includes(m.id));
        const text=c.messages.filter(m=>m.role==='user').at(-1)?.content||'';
        const promptTokens=messages.reduce((total,m)=>total+(typeof m.content==='string'?Math.ceil(m.content.length/4):800),0);
        const healthRows=await state().db.prepare('SELECT id,data FROM routing_health WHERE owner=?').all('swarm-managed') as {id:string;data:string}[];const health=new Map(healthRows.map(r=>[r.id,JSON.parse(r.data) as RouteHealth]));
        const preferences=await accountPreferences(owner);preferences.ai={...preferences.ai,freeMode:false,routing:policy.routing};
        const ranked=automatic?rankAutomatic(available,text,id=>health.get(id),promptTokens,purpose,preferences):available.filter(m=>m.providerId===input.providerId&&m.modelId===input.modelId);
        let lastError:unknown;const skip=new Set<string>();let attempts=0;
        for(const pick of ranked){
          if(skip.has(pick.providerId))continue;if(attempts++>=Math.min(8,Math.max(1,(preferences.routing?.maxFallbacks??3)+1)))break;
          const candidate=adapters.find(a=>a.id===pick.providerId)!;const cfg=await credentials(owner,pick.providerId);if(!cfg)continue;
          abort.signal.throwIfAborted();attempt++;const started=Date.now();routedModel=pick;event('model',{modelId:pick.modelId,providerId:pick.providerId,displayName:pick.displayName,providerName:pick.providerName,automatic});
          try {
            const result=await candidate.chat(cfg,pick.modelId,{messages,reasoningEffort:policy.reasoningEffort,signal:abort.signal,maxTokens:streaming?Math.min(preferences.ai?.maxOutputTokens??4096,4096):1800,temperature:preferences.ai?.temperature??0.4,stream:streaming,firstTokenTimeoutMs:Math.min(60000,budget.remaining()),totalTimeoutMs:Math.min(180000,budget.remaining()),onToken:streaming?token=>{content+=token;event('delta',{token});}:undefined});
            if(!result.text.trim())throw new ProviderError('invalid','Empty response');
            await recordRoute(owner,pick.id,true,result.latencyMs,result.completionTokens);return result;
          }catch(error){
            if(abort.signal.aborted)throw error;lastError=error;await recordRoute(owner,pick.id,false,Date.now()-started,0,error);
            if(!automatic)throw error;if(error instanceof ProviderError&&['auth','quota','network','rate_limit'].includes(error.kind))skip.add(pick.providerId);
            if(streaming){content='';event('reset',{});}event('routing',{status:'fallback',message:'Trying another available model…'});
          }
        }
        throw lastError||new ProviderError('invalid','No eligible model is currently available.');
      };
      try {
        if(input.mode==='swarm'){
          event('agent',{role:'planner',name:'Planner',status:'working'});
          const plan=await complete([{role:'system',content:'Plan an accurate complete response. Return a concise strategy.'},...history],false,'plan');
          event('agent',{role:'planner',name:'Planner',status:'completed',output:plan.text});event('agent',{role:'coder',name:'Coder',status:'working'});
          const draft=await complete([{role:'system',content:`${system}\nFollow this strategy: ${plan.text}`},...history],false,'code');
          event('agent',{role:'coder',name:'Coder',status:'completed',output:draft.text});event('agent',{role:'reviewer',name:'Reviewer',status:'working'});
          content=(await complete([{role:'system',content:`${system}\nReview this draft and output the improved final answer: ${draft.text}`},...history],true,'review')).text;
          event('agent',{role:'reviewer',name:'Reviewer',status:'completed',output:content});
        }else content=(await complete([{role:'system',content:system},...history],true)).text;
        if(!content.trim())throw new Error('Empty response');
        if(input.mode==='swarm'){event('agent',{role:'finalizer',name:'Finalizer',status:'working'});const files=codeFiles(content);if(files.length)zipSync(Object.fromEntries(files.map(f=>[f.name,strToU8(f.content)])));event('agent',{role:'finalizer',name:'Finalizer',status:'completed',output:files.length?`Packaged ${files.length} files for download:\n${files.map(f=>f.name).join('\n')}`:'No code files were returned for this request.'});}
        const message={buildEvents:input.mode==='swarm'?buildEvents:undefined,id:Date.now(),role:'assistant' as const,content,createdAt:now(),modelName:routedModel?`${routedModel.displayName} · ${routedModel.providerName}`:undefined};c.messages.push(message);await saveConversation(owner,c);await settleUsage(state().db,owner,reservation!,true);succeeded=true;event('done',{message,conversation:c});
      }catch(error){
        const category=budget.timedOut?'timeout':abort.signal.aborted?'cancelled':error instanceof ProviderError?error.kind:'server';
        const diagnostic={requestId,durationMs:Date.now()-requestStarted,stage,category,status:error instanceof ProviderError?error.status:undefined,attempt,retryCount:Math.max(0,attempt-1),timedOut:category==='timeout',aborted:category==='cancelled',connectionLost:category==='network'};
        console.warn('swarm.chat.failure',diagnostic);
        if(input.mode==='swarm'){const latest=buildEvents.filter(e=>e.status==='working').at(-1);if(latest)event('agent',{role:latest.role,name:latest.name,status:'failed'});}
        if(disconnected&&content.trim()){c.messages.push({id:Date.now(),role:'assistant',content:content+'\n\n*Response stopped.*',createdAt:now()});await saveConversation(owner,c);}
        else event('error',{error:budget.timedOut?'This project reached its time limit. Your message is saved; try a smaller task.':providerError(error),...diagnostic,retryable:['network','timeout','rate_limit','server'].includes(category)});
      }finally{if(reservation&&!succeeded)await settleUsage(state().db,owner,reservation,false);clearInterval(heartbeat);budget.dispose();state().active.delete(lock);await state().db.prepare('DELETE FROM active_runs WHERE owner=? AND id=? AND lease=?').run(owner,id,lease).catch(()=>{});request.signal.removeEventListener('abort',cancel);try{controller.close();}catch{}}
    },cancel(){cancel();},
  });
  return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','X-Request-Id':requestId}});
}
async function startManagedOperation(owner:string,raw:Record<string,unknown>) {
  const kind=raw.kind==='build'?'build':raw.kind==='chat'?'chat':null;
  if(!kind||typeof raw.id!=='string')throw new ManagedError(400,'operation','Invalid SWARM operation.');
  const db=state().db;
  const previous=await db.prepare('SELECT id,kind,expires FROM managed_operations WHERE owner=? AND id=?').get(owner,raw.id);
  if(previous){if(previous.kind!==kind||Number(previous.expires)<Date.now())throw new ManagedError(409,'operation_expired','Start a new SWARM operation.');return previous;}
  if(!(await modelList(owner)).models.length)throw new ManagedError(503,'no_provider','SWARM AI is awaiting an available backend provider. No API-key setup is required.');
  await reserveUsage(db,owner,raw.id,kind,{kind});
  const expires=Date.now()+3600000;
  await db.prepare('INSERT INTO managed_operations VALUES(?,?,?,0,0,?)').run(owner,raw.id,kind,expires);
  return {id:raw.id,kind,expires};
}
async function managedComplete(request:Request,owner:string,raw:Record<string,unknown>) {
  const db=state().db;const messages=validateManagedMessages(raw.messages);
  if(typeof raw.operationId!=='string'||typeof raw.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(raw.requestId))throw new ManagedError(400,'request','Invalid inference request.');
  const operationId=raw.operationId,requestId=raw.requestId,hash=fingerprint(raw);
  const policy=await routingPolicy(db,owner),usage=await accountUsage(db,owner);
  if(raw.needs!==undefined&&(!Array.isArray(raw.needs)||raw.needs.some(n=>!['chat','coding','reasoning','vision','fast','long_context','tools'].includes(String(n)))))throw new ManagedError(400,'capabilities','Invalid model capabilities.');
  const needs=[...(raw.needs as string[]||[]),...(messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image'))?['vision']:[])];
  const purpose=['plan','research','design','architecture','code','review','vision','classify','summarize','test'].includes(String(raw.purpose))?raw.purpose as Purpose:'code';
  const models=(await modelList(owner)).models.filter(m=>policy.ids.includes(m.id)&&needs.every(n=>m.capabilities?.includes(n as Capability))&&(!raw.pinned||raw.pinned===m.id));
  const ranks=rankAutomatic(models,'',()=>undefined,messages.reduce((n,m)=>n+(typeof m.content==='string'?Math.ceil(m.content.length/4):m.content.reduce((total,p)=>total+(p.type==='text'?Math.ceil(p.text.length/4):800),0)),0),purpose,{ai:{routing:policy.routing,freeMode:false}});
  if(!ranks.length)throw new ManagedError(503,'no_provider','No eligible SWARM backend model is available.');
  const cached=await managedTransaction(db,owner,async()=>{
    const previous=await db.prepare('SELECT fingerprint,result FROM inference_requests WHERE owner=? AND id=?').get(owner,requestId);
    if(previous){if(previous.fingerprint!==hash||!previous.result)throw new ManagedError(409,'inference_duplicate','This inference request is already running or cannot be replayed.');return JSON.parse(String(previous.result));}
    const op=await db.prepare('SELECT * FROM managed_operations WHERE owner=? AND id=?').get(owner,operationId);
    if(!op||Number(op.expires)<Date.now())throw new ManagedError(403,'operation_expired','Start a new SWARM operation.');
    const maxCalls=Number(process.env[op.kind==='build'?'SWARM_NATIVE_BUILD_CALLS':'SWARM_NATIVE_CHAT_CALLS']|| (op.kind==='build'?32:8));
    if(!Number.isSafeInteger(maxCalls)||maxCalls<1||Number(op.calls)>=maxCalls)throw new ManagedError(429,'operation_budget','This operation reached its inference budget.');
    const active=await db.prepare('SELECT SUM(active) AS n FROM managed_operations WHERE owner=? AND expires>?').get(owner,Date.now());
    if(Number(active?.n||0)>=usage.plan.concurrency)throw new ManagedError(429,'concurrency','Wait for the current inference request to finish.');
    await db.prepare('UPDATE managed_operations SET calls=calls+1,active=active+1 WHERE owner=? AND id=?').run(owner,operationId);
    await db.prepare('INSERT INTO inference_requests VALUES(?,?,?,?,NULL)').run(owner,requestId,operationId,hash);
    return null;
  });
  if(cached)return cached;
  try {
    const skip=new Set<string>();let last:unknown;const signal=AbortSignal.any([request.signal,AbortSignal.timeout(180000)]);
    for(const pick of ranks.slice(0,3)){
      if(skip.has(pick.providerId))continue;const adapter=adapters.find(a=>a.id===pick.providerId)!;const config=managedCredentials(pick.providerId);if(!config)continue;
      try{
        const result=await adapter.chat(config,pick.modelId,{messages,reasoningEffort:policy.reasoningEffort,maxTokens:Math.min(4096,Math.max(128,Number(raw.maxTokens)||4096)),temperature:0.3,signal,stream:false,json:raw.json===true,firstTokenTimeoutMs:45000,totalTimeoutMs:180000});
        if(!result.text.trim())throw new ProviderError('invalid','Empty response');
        const response={result,model:pick};
        await managedTransaction(db,owner,async()=>{await settleUsage(db,owner,operationId,true);await db.prepare('UPDATE inference_requests SET result=? WHERE owner=? AND id=?').run(JSON.stringify(response),owner,requestId);});
        return response;
      }catch(error){last=error;if(signal.aborted)break;if(error instanceof ProviderError&&['auth','quota','rate_limit'].includes(error.kind))skip.add(pick.providerId);}
    }
    throw new ManagedError(503,'provider_unavailable',safeProviderFailure(last));
  }finally{await db.prepare('UPDATE managed_operations SET active=active-1 WHERE owner=? AND id=?').run(owner,operationId);}
}
export async function handleApi(request:Request,path:string[]):Promise<Response> {return storageContext(()=>handleApiInner(request,path));}
async function handleApiInner(request:Request,path:string[]):Promise<Response> {
  try {
    // Health check is public to allow frontend to verify backend availability without authentication
    if(path.join('/')==='health'&&request.method==='GET')return json({status:'ok',mode:process.env.CLERK_SECRET_KEY?'account':'local',timestamp:Date.now()});
    // Configuration diagnostics - public for setup guidance
    if(path.join('/')==='config/diagnostics'&&request.method==='GET')return json({issues:validateConfiguration()});
    if(path.join('/')==='plans'&&request.method==='GET')return json({catalog:planCatalog(),checkoutAvailable:checkoutAvailable(),billingMode:cashfreeEnvironment().mode});
    if(path.join('/')==='billing/webhook'&&request.method==='POST')return json(await cashfreeWebhook(state().db,request));
    const exchange=path.join('/')==='account/desktop-token';
    const owner=exchange?null:await ownerFor(request);const method=request.method;
    if(owner)await initializeAccount(state().db,owner);
    if(owner&&path.join('/')==='account/entitlements'&&method==='GET'){
      const usage=await accountUsage(state().db,owner),policy=modelPolicy(),models=(await modelList(owner)).models;
      const available=(ids:string[])=>models.some(m=>ids.includes(m.id));
      return json({...usage,catalog:planCatalog(),checkoutAvailable:checkoutAvailable(),billingMode:cashfreeEnvironment().mode,profiles:[{id:'swe',name:'SWARM SWE',eligible:true,available:available(policy.standard)},{id:'flash',name:'SWARM Flash',eligible:true,available:available(policy.standard)},{id:'premium',name:'SWARM Premium',eligible:usage.plan.premium,available:available(policy.premium)}]});
    }
    if(owner&&path.join('/')==='account/model-preferences'&&method==='POST'){const b=await bodyFor(request);
      if(typeof b.profile!=='string'||typeof b.speed!=='string'||!['swe','flash','premium'].includes(b.profile)||!['fast','balanced','quality'].includes(b.speed))throw new ManagedError(400,'preferences','Choose a supported model profile and generation mode.');
      if(b.profile==='premium'&&!(await accountUsage(state().db,owner)).plan.premium)throw new ManagedError(403,'premium_required','SWARM Premium requires Pro.');
const policy=modelPolicy();const ids=b.profile==='premium'?policy.premium:policy.standard;if(!(await modelList(owner)).models.some(m=>ids.includes(m.id)))throw new ManagedError(503,'model_unavailable','This SWARM profile is not currently configured.');return json(await saveManagedPreferences(state().db,owner,b.profile,b.speed));}
    if(owner&&path[0]==='billing'){
      if(path[1]==='checkout'&&method==='POST'){const b=await bodyFor(request);if(b.plan!=='pro'||b.amount!==undefined)throw new ManagedError(400,'plan','Choose the configured Pro plan.');return json(await createCheckout(state().db,owner,b.requestId,b.phone));}
      if(path[1]==='verify'&&method==='POST'){const b=await bodyFor(request);if(typeof b.orderId!=='string')throw new ManagedError(400,'order','Choose a payment order.');return json(await verifyOrder(state().db,owner,b.orderId));}
      if(path[1]==='history'&&method==='GET')return json({transactions:await state().db.prepare('SELECT id,amount,days,status,payment,created,fulfilled FROM payment_orders WHERE owner=? ORDER BY created DESC').all(owner)});
    }
    if(owner&&path.join('/')==='managed/finish'&&method==='POST'){
      const b=await bodyFor(request);if(typeof b.id!=='string')throw new ManagedError(400,'operation','Invalid operation.');
      await managedTransaction(state().db,owner,async()=>{
        const op=await state().db.prepare('SELECT active FROM managed_operations WHERE owner=? AND id=?').get(owner,b.id);
        if(op&&Number(op.active)===0){await settleUsage(state().db,owner,b.id as string,false);await state().db.prepare('UPDATE managed_operations SET expires=0 WHERE owner=? AND id=?').run(owner,b.id);}
      });return json({ok:true});
    }
    if(owner&&path.join('/')==='managed/operation'&&method==='POST')return json(await startManagedOperation(owner,await bodyFor(request)));
    if(owner&&path.join('/')==='managed/complete'&&method==='POST')return json(await managedComplete(request,owner,await bodyFor(request)));
    const account=await accountApi(request,path,owner,{db:state().db,readKey:async()=>null,writeKey:storeAccountKey,providers:adapters.map(a=>a.id),active:state().active});if(account)return account;
    if(!owner)throw new HttpError(401,'Sign in to continue.');
    if(path[0]==='models'&&method==='GET')return json(await modelList(owner));
    if(path[0]==='providers'){
      if(path.length===1&&method==='GET')return json({providers:await Promise.all(adapters.map(a=>summary(owner,a.id)))});
      throw new ManagedError(403,'managed_credentials','AI providers are managed by SWARM; no provider keys are accepted from clients.');
    }
    if(path[0]==='conversations'){
      if(path.length===1&&method==='GET'){
        const q=new URL(request.url).searchParams.get('q')?.toLowerCase()||'';
        const rows=await state().db.prepare('SELECT data FROM conversations WHERE owner=?').all(owner) as {data:string}[];
        return json({conversations:rows.map(r=>JSON.parse(r.data) as Conversation).filter(c=>!q||c.title.toLowerCase().includes(q)||c.messages.some(m=>m.content.toLowerCase().includes(q))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,100).map(({messages,...c})=>c)});
      }
      if(path.length===1&&method==='POST'){
        const body=await bodyFor(request);if(body.title!==undefined&&(typeof body.title!=='string'||body.title.length>120))throw new HttpError(400,'Invalid title.');
        const c:Conversation={id:randomUUID(),title:typeof body.title==='string'&&body.title.trim()||'New chat',createdAt:now(),updatedAt:now(),messages:[]};await saveConversation(owner,c);return json(c,201);
      }
      const id=path[1];const c=await getConversation(owner,id);
      if(path[2]==='preview'&&method==='POST') {const output=c.messages.filter(m=>m.role==='assistant').at(-1)?.content||'';const files=codeFiles(output);if(!files.length)throw new HttpError(412,'No generated files are ready yet.');try{return json(await projectPreview(files));}catch(error){return json({error:error instanceof Error&&error.message&&!error.message.startsWith('Build failed')?error.message:'This project needs its full development environment. Download the ZIP to run it in the desktop app.'},412);}}
      if(path[2]==='stream'&&method==='POST')return await streamChat(request,owner,id,await bodyFor(request));
      if(path.length===2&&method==='GET')return json(c);
      if(state().active.has(`${owner}:${id}`)||await state().db.prepare('SELECT id FROM active_runs WHERE owner=? AND id=? AND expires>?').get(owner,id,Date.now()))throw new HttpError(409,'Stop the current response first.');
      if(path.length===2&&method==='PATCH'){const body=await bodyFor(request);if(typeof body.title!=='string'||!body.title.trim()||body.title.length>120)throw new HttpError(400,'Enter a valid title.');c.title=body.title.trim();await saveConversation(owner,c);return json(c);}
      if(path.length===2&&method==='DELETE'){await accountTables(state().db);await state().db.prepare('INSERT OR IGNORE INTO sync_deleted VALUES(?,?)').run(owner,id);await state().db.prepare('DELETE FROM conversations WHERE owner=? AND id=?').run(owner,id);return new Response(null,{status:204});}
    }
    return json({error:'Endpoint not found.'},404);
  }catch(error){return json({error:error instanceof HttpError||error instanceof ManagedError?error.message:'The server could not complete this request.',...(error instanceof ManagedError?{code:error.code}:{})},error instanceof HttpError||error instanceof ManagedError?error.status:500);}
}
