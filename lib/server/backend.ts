import {projectPreview} from './project-preview';
import { accountApi, accountTables, deviceOwner } from './accounts';
import { codeFiles } from '../code-files';
import { zipSync, strToU8 } from 'fflate';
import {Storage,storageContext} from './storage';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Conversation, StreamConversationInput } from '../cloud-api/generated/api.schemas';
import { adapters, envNames } from './providers';
import type { ChatMessage, ProviderConfig } from './desktop-providers/types';
import { rankAutomatic, type RouteHealth, type Purpose } from './auto-router';
import type { Capability } from './desktop-providers/domain-types';
import { ProviderError } from './desktop-providers/types';

type Model = { id:string; modelId:string; displayName:string; providerId:string; providerName:string; capabilities?:Capability[]; contextLength?:number|null };
type State = { db:Storage; secret:Buffer; active:Set<string>; models:Map<string,{time:number; value:{models:Model[];errors:{providerId:string;error:string}[]}}> };
const globalState = globalThis as typeof globalThis & { swarmWeb?:State };
function state():State {
  if (globalState.swarmWeb) return globalState.swarmWeb;
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
const json = (data:unknown,status=200) => Response.json(data,{status});
const now = () => new Date().toISOString();
async function ownerFor(request:Request):Promise<string> {
  const url = new URL(request.url); const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) throw new HttpError(403,'Cross-origin requests are not allowed.');
  if (process.env.CLERK_SECRET_KEY) {
    const token = request.headers.get('authorization')?.replace(/^Bearer /,'') || request.headers.get('cookie')?.match(/(?:^|;\s*)__session=([^;]+)/)?.[1];
    if(token?.startsWith('swarm_device_')) {const owner=await deviceOwner(state().db,token);if(owner)return owner;throw new HttpError(401,'Desktop session expired. Sign in again.');}
    if (!token) throw new HttpError(401,'Sign in to continue.');
    try { const {verifyToken} = await import('@clerk/backend'); return (await verifyToken(token,{secretKey:process.env.CLERK_SECRET_KEY,authorizedParties:[url.origin]})).sub; }
    catch {throw new HttpError(401,'Your session expired. Sign in again.');}
  }
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || (request.headers.get('x-forwarded-host') && !['localhost','127.0.0.1','[::1]'].includes(new URL('http://' + request.headers.get('x-forwarded-host')).hostname))) throw new HttpError(403,'Local workspace is available only on this computer. Configure Clerk before hosting publicly.');
  return 'local-workspace';
}
async function accountPreferences(owner:string):Promise<any>{await accountTables(state().db);const row=await state().db.prepare('SELECT data FROM account_documents WHERE owner=? AND id=?').get(owner,'preferences') as {data:string}|undefined;return row?JSON.parse(row.data):{};}
async function credentials(owner:string,provider:string,respectSettings=true):Promise<ProviderConfig|null> {
  const adapter = adapters.find(a=>a.id===provider); if (!adapter) return null;
  const row = await state().db.prepare('SELECT data FROM credentials WHERE owner=? AND provider=?').get(owner,provider) as {data:string}|undefined;
  let apiKey:string|null=null; let accountId:string|null=null;
  if (row) {
    const value = JSON.parse(row.data); if (value.disabled) return null;
    const decipher = createDecipheriv('aes-256-gcm',state().secret,Buffer.from(value.iv,'base64'));
    decipher.setAAD(Buffer.from(`${owner}:${provider}`));decipher.setAuthTag(Buffer.from(value.tag,'base64'));
    apiKey=Buffer.concat([decipher.update(Buffer.from(value.encrypted,'base64')),decipher.final()]).toString('utf8');accountId=value.accountId;
  } else if (owner==='local-workspace') {
    apiKey=(envNames[provider]||[]).map(name=>process.env[name]).find(Boolean)||null;accountId=process.env.CLOUDFLARE_ACCOUNT_ID||null;
  }
  if (!apiKey || (adapter.needsAccountId && !accountId)) return null;
  const settings=respectSettings?await accountPreferences(owner):{};if(settings.providers?.enabled?.[provider]===false)return null;const custom=settings.providers?.baseUrls?.[provider];let baseUrl=adapter.defaultBaseUrl;if(typeof custom==='string'){try{const url=new URL(custom);if(url.protocol==='https:')baseUrl=custom.replace(/\/+$/,'');}catch{}}return {apiKey,accountId,baseUrl};
}
export async function storeAccountKey(owner:string,provider:string,apiKey:string|null,accountId:string|null=null) {
  if(!apiKey){await state().db.prepare('INSERT OR REPLACE INTO credentials VALUES(?,?,?)').run(owner,provider,JSON.stringify({disabled:true}));state().models.delete(owner);return;}
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',state().secret,iv);cipher.setAAD(Buffer.from(owner+':'+provider));
  const encrypted=Buffer.concat([cipher.update(apiKey,'utf8'),cipher.final()]);
  await state().db.prepare('INSERT OR REPLACE INTO credentials VALUES(?,?,?)').run(owner,provider,JSON.stringify({encrypted:encrypted.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),accountId}));state().models.delete(owner);
}
export async function claimLocalAccount(id:string,email:string) {
  const st=state();await accountTables(st.db);await st.db.exec('BEGIN IMMEDIATE');
  try {
    await st.db.prepare('INSERT OR REPLACE INTO accounts VALUES(?,?,?)').run(id,email,'owner');
    const count=(await st.db.prepare('UPDATE conversations SET owner=? WHERE owner=?').run(id,'local-workspace')).changes;
    let keys=0;for(const adapter of adapters){if(await credentials(id,adapter.id))continue;const config=await credentials('local-workspace',adapter.id);if(config){await storeAccountKey(id,adapter.id,config.apiKey,config.accountId||null);keys++;}}
    await st.db.prepare('DELETE FROM credentials WHERE owner=?').run('local-workspace');await st.db.exec('COMMIT');return {conversations:Number(count),providers:keys};
  }catch(e){await st.db.exec('ROLLBACK');throw e;}
}
export function accountDatabase(){return state().db;}
export function accountEncryptionKey(){return state().secret.toString('base64');}
async function summary(owner:string,provider:string) {
  const adapter=adapters.find(a=>a.id===provider)!;const config=await credentials(owner,provider);
  return {providerId:provider,name:adapter.name,configured:!!config,needsAccountId:adapter.needsAccountId,accountId:config?.accountId||null,keyHint:config?.apiKey?`â€¢â€¢â€¢â€¢${config.apiKey.slice(-4)}`:null};
}
async function modelList(owner:string) {
  const cache=state().models.get(owner);if(cache && Date.now()-cache.time<60000)return cache.value;
  const models:Model[]=[];const errors:{providerId:string;error:string}[]=[];
  await Promise.all(adapters.map(async adapter=>{
    const config=await credentials(owner,adapter.id);if(!config)return;
    try {const found=await adapter.discover(config,AbortSignal.timeout(18000));models.push(...found.map(m=>({id:`${adapter.id}:${m.modelId}`,modelId:m.modelId,displayName:m.displayName,providerId:adapter.id,providerName:adapter.name,capabilities:m.capabilities,contextLength:m.contextLength})));}
    catch {errors.push({providerId:adapter.id,error:'Provider discovery failed. Check its key or retry.'});}
  }));
  models.sort((a,b)=>adapters.findIndex(p=>p.id===a.providerId)-adapters.findIndex(p=>p.id===b.providerId)||a.modelId.localeCompare(b.modelId));
  const value={models,errors};state().models.set(owner,{time:Date.now(),value});return value;
}
async function getConversation(owner:string,id:string):Promise<Conversation> {
  const row=await state().db.prepare('SELECT data FROM conversations WHERE id=? AND owner=?').get(id,owner) as {data:string}|undefined;
  if(!row)throw new HttpError(404,'Conversation not found.');return JSON.parse(row.data);
}
async function saveConversation(owner:string,c:Conversation) {
  c.updatedAt=now();await state().db.prepare('INSERT INTO conversations(id,owner,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE owner=excluded.owner').run(c.id,owner,JSON.stringify(c));
}
async function bodyFor(request:Request):Promise<Record<string,unknown>> {
  const text=await request.text();if(text.length>100000)throw new HttpError(413,'Request is too large.');
  try {const value=JSON.parse(text||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new HttpError(400,'Invalid JSON request.');}
}
async function routeHealth(owner:string,id:string):Promise<RouteHealth|undefined> {
  
  const row=await state().db.prepare('SELECT data FROM routing_health WHERE owner=? AND id=?').get(owner,id) as {data:string}|undefined;
  return row?JSON.parse(row.data):undefined;
}
async function recordRoute(owner:string,id:string,ok:boolean,latency:number,tokens=0,error?:unknown) {
  const old=(await routeHealth(owner,id))||{calls:0,successes:0,consecutiveFailures:0,latencyMs:null,cooldownUntil:0,tokensPerSec:null};
  const value:RouteHealth={calls:old.calls+1,successes:old.successes+(ok?1:0),consecutiveFailures:ok?0:old.consecutiveFailures+1,latencyMs:ok?latency:old.latencyMs,tokensPerSec:ok&&latency?tokens/(latency/1000):old.tokensPerSec,cooldownUntil:ok?0:Date.now()+(error instanceof ProviderError&&['auth','quota'].includes(error.kind)?300000:60000)};
  await state().db.prepare('INSERT OR REPLACE INTO routing_health(owner,id,data) VALUES(?,?,?)').run(owner,id,JSON.stringify(value));
}
function providerError(error:unknown) {
  if(error instanceof ProviderError) {
    if(error.kind==='auth')return 'The provider rejected its API key. Replace it in Settings.';
    if(['quota','rate_limit'].includes(error.kind))return 'This provider has reached its usage limit. Choose another provider or try later.';
    if(error.kind==='timeout')return 'The model took too long. Try another model.';
  }
  return 'The model request failed. Choose another available model or check provider settings.';
}
async function streamChat(request:Request,owner:string,id:string,raw:Record<string,unknown>):Promise<Response> {
  const input=raw as unknown as StreamConversationInput;
  if(!['send','edit','regenerate','continue'].includes(input.action)||!['chat','swarm'].includes(input.mode)||typeof input.modelId!=='string'||input.modelId.length>200)throw new HttpError(400,'Invalid chat request.');
  const automatic=input.modelId==='auto';
  const adapter=adapters.find(a=>a.id===input.providerId);const config=adapter&&await credentials(owner,adapter.id);
  if(!automatic&&(!adapter||!config))throw new HttpError(412,'Connect a provider in Settings.');
  const c=await getConversation(owner,id);const lock=`${owner}:${id}`;
  if(state().active.has(lock))throw new HttpError(409,'This conversation is already responding.');const lease=randomUUID();const acquired=await state().db.prepare('INSERT INTO active_runs(owner,id,lease,expires) VALUES(?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET lease=excluded.lease,expires=excluded.expires WHERE active_runs.expires<? RETURNING lease').get(owner,id,lease,Date.now()+360000,Date.now());if(!acquired)throw new HttpError(409,'This conversation is already responding.');state().active.add(lock);
  try {
    const available=await modelList(owner);
    if(automatic?!available.models.length:!available.models.some(m=>m.providerId===input.providerId&&m.modelId===input.modelId))throw new HttpError(412,'Choose a currently available model.');
    const prompt=typeof input.prompt==='string'?input.prompt.trim():'';
    if(['send','edit'].includes(input.action)&&(!prompt||prompt.length>32000))throw new HttpError(400,'Enter a message of up to 32,000 characters.');
    const target=c.messages.findIndex(m=>m.id===input.messageId&&m.role==='user');
    if(input.action==='edit'||input.action==='regenerate'){
      if(target<0)throw new HttpError(400,'Choose a user message to edit or regenerate.');c.messages=c.messages.slice(0,target+1);
      if(input.action==='edit')c.messages[target].content=prompt;
    }else if(input.action==='continue'&&c.messages.at(-1)?.role!=='assistant')throw new HttpError(400,'There is no response to continue.');
    if(input.action==='send')c.messages.push({id:Date.now(),role:'user',content:prompt,createdAt:now()});
    if(['New chat','New conversation'].includes(c.title))c.title=prompt.replace(/\s+/g,' ').slice(0,80)||c.title;await saveConversation(owner,c);
  }catch(error){state().active.delete(lock);await state().db.prepare('DELETE FROM active_runs WHERE owner=? AND id=? AND lease=?').run(owner,id,lease);throw error;}
  const abort=new AbortController();const cancel=()=>abort.abort();request.signal.addEventListener('abort',cancel,{once:true});
  const encoder=new TextEncoder();let content='';let routedModel:Model|undefined;const buildEvents:{role:string;name:string;status:string;time:number;output?:string}[]=[];
  const stream=new ReadableStream<Uint8Array>({
    async start(controller){
      const event=(type:string,data:unknown)=>{if(type==='agent')buildEvents.push({...data as {role:string;name:string;status:string},time:Date.now()});if(!abort.signal.aborted)controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));};
      const heartbeat=setInterval(()=>{if(!abort.signal.aborted)controller.enqueue(encoder.encode(': keepalive\n\n'));},15000);
      const system='You are SWARM AI. Be accurate and useful. For code requests, provide complete runnable files in fenced code blocks labeled with language and filename, for example ```python filename=main.py. The website turns these into downloadable files and a ZIP. Never claim you ran tools or changed files unless actually performed.';
      const history:ChatMessage[]=c.messages.slice(-40).map(m=>({role:m.role,content:m.content}));
      if(input.action==='continue')history.push({role:'system',content:'Continue the previous answer without repeating it.'});
      const complete=async(messages:ChatMessage[],streaming:boolean,stage?:Purpose)=>{
        const available=(await modelList(owner)).models;
        const text=c.messages.filter(m=>m.role==='user').at(-1)?.content||'';
        const promptTokens=messages.reduce((total,m)=>total+(typeof m.content==='string'?Math.ceil(m.content.length/4):800),0);
        const healthRows=await state().db.prepare('SELECT id,data FROM routing_health WHERE owner=?').all(owner) as {id:string;data:string}[];const health=new Map(healthRows.map(r=>[r.id,JSON.parse(r.data) as RouteHealth]));
        const preferences=await accountPreferences(owner);
        const ranked=automatic?rankAutomatic(available,text,id=>health.get(id),promptTokens,stage,preferences):available.filter(m=>m.providerId===input.providerId&&m.modelId===input.modelId);
        let lastError:unknown;const skip=new Set<string>();let attempts=0;
        for(const pick of ranked){
          if(skip.has(pick.providerId))continue;if(attempts++>=Math.min(8,Math.max(1,(Number(preferences.routing?.maxFallbacks)||3)+1)))break;
          const candidate=adapters.find(a=>a.id===pick.providerId)!;const cfg=await credentials(owner,pick.providerId);if(!cfg)continue;
          const started=Date.now();routedModel=pick;event('model',{modelId:pick.modelId,providerId:pick.providerId,displayName:pick.displayName,providerName:pick.providerName,automatic});
          try {
            const result=await candidate.chat(cfg,pick.modelId,{messages,signal:abort.signal,maxTokens:streaming?4096:1800,temperature:0.4,stream:streaming,firstTokenTimeoutMs:60000,totalTimeoutMs:180000,onToken:streaming?token=>{content+=token;event('delta',{token});}:undefined});
            if(!result.text.trim())throw new ProviderError('invalid','Empty response');
            await recordRoute(owner,pick.id,true,result.latencyMs,result.completionTokens);return result;
          }catch(error){
            if(abort.signal.aborted)throw error;lastError=error;await recordRoute(owner,pick.id,false,Date.now()-started,0,error);
            if(!automatic)throw error;if(error instanceof ProviderError&&['auth','quota','network'].includes(error.kind))skip.add(pick.providerId);
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
        const message={buildEvents:input.mode==='swarm'?buildEvents:undefined,id:Date.now(),role:'assistant' as const,content,createdAt:now(),modelName:routedModel?`${routedModel.displayName} · ${routedModel.providerName}`:undefined};c.messages.push(message);await saveConversation(owner,c);event('done',{message,conversation:c});
      }catch(error){
        if(input.mode==='swarm'){const latest=buildEvents.filter(e=>e.status==='working').at(-1);if(latest)event('agent',{role:latest.role,name:latest.name,status:'failed'});}
        if(abort.signal.aborted&&content.trim()){c.messages.push({id:Date.now(),role:'assistant',content:content+'\n\n*Response stopped.*',createdAt:now()});await saveConversation(owner,c);}
        else event('error',{error:providerError(error)});
      }finally{clearInterval(heartbeat);state().active.delete(lock);await state().db.prepare('DELETE FROM active_runs WHERE owner=? AND id=? AND lease=?').run(owner,id,lease).catch(()=>{});request.signal.removeEventListener('abort',cancel);try{controller.close();}catch{}}
    },cancel(){abort.abort();},
  });
  return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
}
export async function handleApi(request:Request,path:string[]):Promise<Response> {return storageContext(()=>handleApiInner(request,path));}
async function handleApiInner(request:Request,path:string[]):Promise<Response> {
  try {
    const exchange=path.join('/')==='account/desktop-token';
    const owner=exchange?null:await ownerFor(request);const method=request.method;
    const account=await accountApi(request,path,owner,{db:state().db,readKey:async(o,p)=>{const c=await credentials(o,p,false);return c?.apiKey?{apiKey:c.apiKey,accountId:c.accountId||null}:null;},writeKey:storeAccountKey,providers:adapters.map(a=>a.id),active:state().active});if(account)return account;
    if(!owner)throw new HttpError(401,'Sign in to continue.');
    if(path[0]==='health'&&method==='GET')return json({status:'ok',mode:process.env.CLERK_SECRET_KEY?'account':'local'});
    if(path[0]==='models'&&method==='GET')return json(await modelList(owner));
    if(path[0]==='providers'){
      if(path.length===1&&method==='GET')return json({providers:await Promise.all(adapters.map(a=>summary(owner,a.id)))});
      const provider=path[1];const adapter=adapters.find(a=>a.id===provider);if(!adapter)throw new HttpError(400,'Unsupported provider.');
      if(method==='PUT'){
        const body=await bodyFor(request);const apiKey=typeof body.apiKey==='string'?body.apiKey.trim():'';
        if(apiKey.length<8||apiKey.length>4096||/[\r\n\0]/.test(apiKey))throw new HttpError(400,'Enter a valid API key.');
        const accountId=typeof body.accountId==='string'?body.accountId.trim():null;
        if(adapter.needsAccountId&&(!accountId||!/^[a-zA-Z0-9_-]{8,160}$/.test(accountId)))throw new HttpError(400,'Enter a valid Cloudflare account ID.');
        const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',state().secret,iv);cipher.setAAD(Buffer.from(`${owner}:${provider}`));
        const encrypted=Buffer.concat([cipher.update(apiKey,'utf8'),cipher.final()]);
        await state().db.prepare('INSERT OR REPLACE INTO credentials(owner,provider,data) VALUES(?,?,?)').run(owner,provider,JSON.stringify({encrypted:encrypted.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),accountId}));
        state().models.delete(owner);return json({provider:await summary(owner,provider)});
      }
      if(method==='DELETE'){await state().db.prepare('INSERT OR REPLACE INTO credentials(owner,provider,data) VALUES(?,?,?)').run(owner,provider,JSON.stringify({disabled:true}));state().models.delete(owner);return new Response(null,{status:204});}
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
  }catch(error){return json({error:error instanceof HttpError?error.message:'The server could not complete this request.'},error instanceof HttpError?error.status:500);}
}
