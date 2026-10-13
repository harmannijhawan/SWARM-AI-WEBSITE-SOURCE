import { writeCredential, readCredential, readCredentialMeta, credentialProviders, keyTag, validateKeyInput } from './user-credentials';
import {cooldownMs,fallbackOrder,providerWideFailure,runFallbackChain,FallbackStop,DEFAULT_MAX_FALLBACKS,downgradeReason} from './routing-reliability';
import { testConnection, TestLimiter } from './byok';
import { PROVIDER_CATALOG, catalogEntry, isByokProvider, keyFormatWarning, type ProviderStatusSummary, type ConnectionTestResult } from '../../shared/providers';
import type { ChatResult } from './desktop-providers/types';
import { accountUsage, fingerprint, managedTransaction, initializeAccount, ManagedError, planCatalog, reserveUsage, settleUsage, saveManagedPreferences } from './entitlements';
import { cashfreeWebhook, checkoutAvailable, createCheckout, verifyOrder, cashfreeEnvironment } from './cashfree';
import { managedCredentials, modelPolicy, routingPolicy, safeProviderFailure, validateManagedMessages } from './managed-providers';
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
import { logAuthAttempt, logApiError, logAuthSuccess } from './safe-logger';
import { performanceTracker, formatMetricsForLog } from './performance-instrumentation';
import { getSystemPrompt } from './improved-prompts';

type CredentialSource = 'byok'|'managed';
type Model = { id:string; modelId:string; displayName:string; providerId:string; providerName:string; capabilities?:Capability[]; contextLength?:number|null; freeStatus?:string; source?:CredentialSource };
type State = { db:Storage; secret:Buffer; active:Set<string>; models:Map<string,{time:number; value:{models:Model[];errors:{providerId:string;error:string}[]}}>; testLimiter?:TestLimiter; testing?:Map<string,string> };
/** Routing failure that should be shown to the user verbatim (no provider data inside). */
class RoutingPolicyError extends Error { constructor(message:string,public code:string){super(message);} }
const globalState = globalThis as typeof globalThis & { swarmWeb?:State };
function state():State {
  if (globalState.swarmWeb) return globalState.swarmWeb;
  // Validate configuration at startup
  const configIssues = validateConfiguration();
  logConfigurationIssues(configIssues);
  // Optional provider/billing configuration must never disable account/history APIs.
  
  const cloud=process.env.SWARM_DATABASE_URL||process.env.DATABASE_URL;
  const dir=process.env.SWARM_DATA_DIR||join(process.cwd(),'.swarm-web');
  let secret:Buffer;
  if(cloud){if(!process.env.SWARM_ENCRYPTION_KEY)throw new Error('Cloud encryption key is required.');secret=Buffer.from(process.env.SWARM_ENCRYPTION_KEY,'base64');if(secret.length!==32)throw new Error('Invalid encryption key.');}
  else{mkdirSync(dir,{recursive:true,mode:0o700});const keyPath=join(dir,'encryption.key');if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});secret=process.env.SESSION_SECRET?createHash('sha256').update(process.env.SESSION_SECRET).digest():readFileSync(keyPath);}
  const db=new Storage(join(dir,'chat.sqlite'),cloud);
  void db.initialize(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS model_metadata(owner TEXT NOT NULL,provider TEXT NOT NULL,fingerprint TEXT NOT NULL,data TEXT NOT NULL,checked INTEGER NOT NULL,PRIMARY KEY(owner,provider)); CREATE TABLE IF NOT EXISTS route_leases(owner TEXT NOT NULL,provider TEXT NOT NULL,lease TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,provider,lease)); CREATE TABLE IF NOT EXISTS active_runs(owner TEXT NOT NULL,id TEXT NOT NULL,lease TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS credentials (owner TEXT NOT NULL, provider TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(owner,provider)); CREATE TABLE IF NOT EXISTS routing_health (owner TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS provider_status (owner TEXT NOT NULL,provider TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,provider));`);
  return globalState.swarmWeb = {db,secret,active:new Set(),models:new Map(),testLimiter:new TestLimiter(),testing:new Map()};
}
function testLimiter(){const st=state();return st.testLimiter??=new TestLimiter();}
function activeTests(){const st=state();return st.testing??=new Map();}
class HttpError extends Error { constructor(public status:number,message:string) {super(message);} }
const json = (data:unknown,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const now = () => new Date().toISOString();
async function ownerFor(request:Request):Promise<string> {
  const url = new URL(request.url); const origin = request.headers.get('origin');
  const path = url.pathname;
  const method = request.method;
  const timestamp = new Date().toISOString();
  const hasAuthHeader = !!request.headers.get('authorization');
  const hasCookie = !!request.headers.get('cookie')?.includes('__session=');
  
  const allowedOrigins=new Set([url.origin,'https://www.swarmgpt.online','https://swarmgpt.online']);
  if(['localhost','127.0.0.1','[::1]'].includes(url.hostname)){allowedOrigins.add(`${url.protocol}//localhost:${url.port}`);allowedOrigins.add(`${url.protocol}//127.0.0.1:${url.port}`);}
  
  if (origin && !allowedOrigins.has(origin)) {
    logAuthAttempt({ path, method, status: 403, origin, hasAuthHeader, hasCookie, tokenType: 'none', error: 'Cross-origin request denied', timestamp });
    throw new HttpError(403,'Cross-origin requests are not allowed.');
  }
  
  if (process.env.CLERK_SECRET_KEY) {
    const token = request.headers.get('authorization')?.replace(/^Bearer /,'') || request.headers.get('cookie')?.match(/(?:^|;\s*)__session=([^;]+)/)?.[1];
    
    if(token?.startsWith('swarm_device_')) {
      const owner=await deviceOwner(state().db,token);
      if(owner) {
        logAuthSuccess(path, method, 'device', owner);
        return owner;
      }
      logAuthAttempt({ path, method, status: 401, origin: origin || undefined, hasAuthHeader, hasCookie, tokenType: 'device', error: 'Device token expired or invalid', timestamp });
      throw new HttpError(401,'Desktop session expired. Sign in again.');
    }
    
    if (!token) {
      logAuthAttempt({ path, method, status: 401, origin: origin || undefined, hasAuthHeader, hasCookie, tokenType: 'none', error: 'No authentication token provided', timestamp });
      throw new HttpError(401,'Sign in to continue.');
    }
    
    try { 
      const {verifyToken} = await import('@clerk/backend'); 
      const verified = await verifyToken(token,{secretKey:process.env.CLERK_SECRET_KEY,authorizedParties:[...allowedOrigins]});
      logAuthSuccess(path, method, 'clerk', verified.sub);
      return verified.sub;
    }
    catch (error) {
      logAuthAttempt({ path, method, status: 401, origin: origin || undefined, hasAuthHeader, hasCookie, tokenType: 'clerk', error: 'Token verification failed', timestamp });
      throw new HttpError(401,'Your session expired. Sign in again.');
    }
  }
  
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || (request.headers.get('x-forwarded-host') && !['localhost','127.0.0.1','[::1]'].includes(new URL('http://' + request.headers.get('x-forwarded-host')).hostname))) {
    logAuthAttempt({ path, method, status: 403, origin: origin || undefined, hasAuthHeader, hasCookie, tokenType: 'none', error: 'Clerk not configured, remote access denied', timestamp });
    throw new HttpError(403,'Local workspace is available only on this computer. Configure Clerk before hosting publicly.');
  }
  
  logAuthSuccess(path, method, 'device', 'local-workspace');
  return 'local-workspace';
}
async function accountPreferences(owner:string):Promise<any>{await accountTables(state().db);const row=await state().db.prepare('SELECT data FROM account_documents WHERE owner=? AND id=?').get(owner,'preferences') as {data:string}|undefined;return row?JSON.parse(row.data):{};}
/** Hybrid credentials: the owner's encrypted BYOK key wins; server-managed env keys are the fallback. */
async function resolveCredential(owner:string,provider:string):Promise<{config:ProviderConfig;source:CredentialSource}|null> {
  if(isByokProvider(provider)){
    try{const config=await readCredential(state().db,state().secret,owner,provider);if(config)return {config,source:'byok'};}
    catch(error){if(error instanceof ManagedError&&error.code==='credential_storage')return null;throw error;}
  }
  const managed=managedCredentials(provider);return managed?{config:managed,source:'managed'}:null;
}
async function credentials(owner:string,provider:string,_respectSettings=true):Promise<ProviderConfig|null> { return (await resolveCredential(owner,provider))?.config??null; }
async function byokProviders(owner:string):Promise<Set<string>>{return new Set([...await credentialProviders(state().db,owner)].filter(p=>isByokProvider(p)));}
/** BYOK health/cooldowns are private to the owner; managed keys share health across all users of that key set. */
function healthScope(owner:string,source:CredentialSource|undefined){return source==='byok'?'byok:'+owner:providerScope();}
async function forgetProviderState(owner:string,provider:string){
  state().models.clear();
  const scope=healthScope(owner,'byok');
  await state().db.prepare('DELETE FROM model_metadata WHERE owner=? AND provider=?').run(scope,provider);
  await state().db.prepare('DELETE FROM routing_health WHERE owner=? AND id LIKE ?').run(scope,provider+':%');
}
/** Saves (or with null removes) an owner's BYOK key. Providers outside the BYOK catalog stay server-managed. */
export async function storeAccountKey(owner:string,provider:string,key:unknown,accountId?:unknown) {
  if(key!==null&&!isByokProvider(provider))throw new ManagedError(405,'managed_credentials','This provider is managed by the server operator.');
  if(key!==null)validateKeyInput(provider,key,accountId);
  await writeCredential(state().db,state().secret,owner,provider,key,accountId);
  if(key===null)await state().db.prepare('DELETE FROM provider_status WHERE owner=? AND provider=?').run(owner,provider);
  await forgetProviderState(owner,provider);
}
async function providerSummary(owner:string,id:string):Promise<ProviderStatusSummary> {
  const entry=catalogEntry(id)!;const meta=await readCredentialMeta(state().db,owner,id);
  const row=await state().db.prepare('SELECT data FROM provider_status WHERE owner=? AND provider=?').get(owner,id);
  let saved:{keyTag?:string;result?:ConnectionTestResult}|null=null;try{saved=row?JSON.parse(String(row.data)):null;}catch{saved=null;}
  const lastTest=meta&&saved?.result&&saved.keyTag&&saved.keyTag===meta.keyTag?saved.result:null;
  const status=!meta?'not_connected':activeTests().get(owner)===id?'checking':lastTest?lastTest.status:'needs_configuration';
  return {id:entry.id,providerId:entry.id,name:entry.name,description:entry.description,keyUrl:entry.keyUrl,notes:entry.notes,configured:!!meta,managed:!!managedCredentials(id),hint:meta?.hint??null,status,lastTest,models:lastTest?.models??0};
}
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
/** Server-managed providers outside the BYOK catalog. Never includes key material. */
function managedSummary(provider:string) {
  const adapter=adapters.find(a=>a.id===provider)!;
  return {providerId:provider,name:adapter.name,configured:!!managedCredentials(provider),needsAccountId:adapter.needsAccountId,accountId:null,keyHint:null,managed:true};
}
async function modelList(owner:string,signal?:AbortSignal) {
  const resolved=new Map(await Promise.all(adapters.map(async a=>[a.id,await resolveCredential(owner,a.id)] as const)));
  const cacheKey=JSON.stringify(adapters.map(a=>{const r=resolved.get(a.id);return r?[a.id,r.source,healthScope(owner,r.source),fingerprint([a.id,r.config.apiKey,r.config.accountId])]:a.id+':unconfigured';}));
  const cache=state().models.get(cacheKey);
  // Reduced cache time from 60s to 30s for better freshness, but still avoids redundant discovery
  if(cache && Date.now()-cache.time<300000)return cache.value;
  
  const models:Model[]=[];const errors:{providerId:string;error:string}[]=[];
  const routingHealth=await getRoutingHealthBatch(owner);
  
  // Parallel discovery with reduced timeout (18s -> 12s) and Promise.allSettled to not block on slow providers
  const discoveries = adapters.map(async adapter=>{
    const credential=resolved.get(adapter.id);
    if(!credential)return null;
    const {config,source}=credential;const scope=healthScope(owner,source);
    if((routingHealth.get(adapter.id+':*')?.cooldownUntil||0)>Date.now())return null;
    try {
      const signature=fingerprint([config.apiKey,config.accountId]);
      const cached=await state().db.prepare('SELECT fingerprint,data,checked FROM model_metadata WHERE owner=? AND provider=?').get(scope,adapter.id);
      const verified=cached&&cached.fingerprint===signature?JSON.parse(String(cached.data)) as Awaited<ReturnType<typeof adapter.discover>>:null;
      let found=verified&&Date.now()-Number(cached!.checked)<300000?verified:null;
      if(!found){
        try { found=await adapter.discover(config,signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)); }
        catch(error){if(!verified)throw error;found=verified;}
        if(found!==verified)await state().db.prepare('INSERT OR REPLACE INTO model_metadata VALUES(?,?,?,?,?)').run(scope,adapter.id,signature,JSON.stringify(found),Date.now());
      }
      return found.map(m=>({
        id:`${adapter.id}:${m.modelId}`,
        modelId:m.modelId,
        displayName:m.displayName,
        providerId:adapter.id,
        providerName:catalogEntry(adapter.id)?.name||adapter.name,
        capabilities:m.capabilities,
        contextLength:m.contextLength,
        freeStatus:m.freeStatus,
        source
      } satisfies Model));
    }
    catch(error) {
      errors.push({providerId:adapter.id,error:'SWARM provider discovery is temporarily unavailable.'});
      return null;
    }
  });
  
  const results = await Promise.allSettled(discoveries);
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      models.push(...result.value);
    }
  }
  
  models.sort((a,b)=>adapters.findIndex(p=>p.id===a.providerId)-adapters.findIndex(p=>p.id===b.providerId)||a.modelId.localeCompare(b.modelId));
  const value={models,errors};if(state().models.size>=500)state().models.clear();if(!errors.length&&models.length)state().models.set(cacheKey,{time:Date.now(),value});return value;
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
// Shared provider health follows the server credential set, including key rotation.
function providerScope(){return 'service:'+fingerprint(adapters.map(a=>managedCredentials(a.id)));}
async function healthRows(scope:string):Promise<Map<string,RouteHealth>> {
  const rows=await state().db.prepare('SELECT id,data FROM routing_health WHERE owner=?').all(scope);
  return new Map(rows.map(r=>[String(r.id),JSON.parse(String(r.data)) as RouteHealth]));
}
/** Merged view: BYOK providers read the owner's private health, everything else reads the shared managed health. */
async function getRoutingHealthBatch(owner:string):Promise<Map<string,RouteHealth>> {
  const own=await byokProviders(owner);
  const shared=await healthRows(providerScope());
  if(!own.size)return shared;
  const merged=new Map([...shared].filter(([id])=>!own.has(id.split(':')[0])));
  for(const [id,value] of await healthRows(healthScope(owner,'byok')))if(own.has(id.split(':')[0]))merged.set(id,value);
  return merged;
}
async function recordRoute(owner:string,model:{id:string;source?:CredentialSource},ok:boolean,latency:number,tokens=0,error?:unknown,ttftMs?:number|null) {
  const id=model.id;owner=healthScope(owner,model.source);
  if(error instanceof ProviderError && ['cancelled','bad_request','context'].includes(error.kind))return;
  await managedTransaction(state().db,'health:'+owner,async()=>{
    const row=await state().db.prepare('SELECT data FROM routing_health WHERE owner=? AND id=?').get(owner,id);
    const old:RouteHealth=row?JSON.parse(String(row.data)):{calls:0,successes:0,consecutiveFailures:0,latencyMs:null,cooldownUntil:0,tokensPerSec:null};
    const value:RouteHealth={lastCheckedAt:Date.now(),lastSuccessAt:ok?Date.now():old.lastSuccessAt,timeoutCount:(old.timeoutCount||0)+(error instanceof ProviderError&&error.kind==='timeout'?1:0),ttftMs:ok?ttftMs??null:old.ttftMs,failureCategory:ok?null:error instanceof ProviderError?error.kind:'server',calls:old.calls+1,successes:old.successes+(ok?1:0),consecutiveFailures:ok?0:old.consecutiveFailures+1,latencyMs:ok?(old.latencyMs===null?latency:old.latencyMs*0.7+latency*0.3):old.latencyMs,tokensPerSec:ok&&latency?tokens/(latency/1000):old.tokensPerSec,cooldownUntil:ok?old.cooldownUntil:Math.max(old.cooldownUntil,Date.now()+cooldownMs(error))};
    await state().db.prepare('INSERT OR REPLACE INTO routing_health(owner,id,data) VALUES(?,?,?)').run(owner,id,JSON.stringify(value));
    if(ok){const providerId=id.split(':')[0]+':*';const provider=await state().db.prepare('SELECT data FROM routing_health WHERE owner=? AND id=?').get(owner,providerId);if(provider&&JSON.parse(String(provider.data)).cooldownUntil<=Date.now())await state().db.prepare('DELETE FROM routing_health WHERE owner=? AND id=?').run(owner,providerId);}
    if(providerWideFailure(error))await state().db.prepare('INSERT OR REPLACE INTO routing_health(owner,id,data) VALUES(?,?,?)').run(owner,id.split(':')[0]+':*',JSON.stringify(value));
  });
}
function routeAvailable(health:Map<string,RouteHealth>,model:Model) { return (health.get(model.id)?.cooldownUntil||0)<=Date.now() && (health.get(model.providerId+':*')?.cooldownUntil||0)<=Date.now(); }
async function userRoutingPolicy(owner:string) {
  const policy=await routingPolicy(state().db,owner);
  return policy;
}
async function acquireRoute(owner:string,model:Model) {
  owner=healthScope(owner,model.source);
  return managedTransaction(state().db,'health:'+owner,async()=>{
    const health=await healthRows(owner);if(!routeAvailable(health,model))return null;
    await state().db.prepare('DELETE FROM route_leases WHERE expires<?').run(Date.now());
    const count=await state().db.prepare('SELECT COUNT(*) AS n FROM route_leases WHERE owner=? AND provider=?').get(owner,model.providerId);
    // Only one recovery probe after a failure; two healthy requests per account/provider.
    const recovering=(health.get(model.id)?.consecutiveFailures||0)>0||(health.get(model.providerId+':*')?.consecutiveFailures||0)>0;
    if(Number(count?.n||0)>=(recovering?1:2))return null;
    const lease=randomUUID();await state().db.prepare('INSERT INTO route_leases VALUES(?,?,?,?)').run(owner,model.providerId,lease,Date.now()+65000);return lease;
  });
}
async function releaseRoute(owner:string,model:Model,lease:string){owner=healthScope(owner,model.source);await state().db.prepare('DELETE FROM route_leases WHERE owner=? AND provider=? AND lease=?').run(owner,model.providerId,lease);}
/** Allowed for this owner: personal BYOK models are never filtered by the managed allowlist. */
function allowedModel(model:Model,ids:string[]){return model.source==='byok'||ids.includes(model.id);}
function maxFallbacksFor(preferences:any){const n=preferences?.routing?.maxFallbacks;return Number.isInteger(n)&&n>=0&&n<=12?n:DEFAULT_MAX_FALLBACKS;}
function routingPreferences(preferences:any,policyRouting:'auto'|'fastest'|'quality'){
  return {ai:{routing:policyRouting,freeMode:false,profile:preferences?.ai?.profile,pinnedModel:preferences?.ai?.pinnedModel??null},agents:{modelPreference:preferences?.agents?.modelPreference||{}},routing:{excluded:preferences?.routing?.excluded,fallbacks:preferences?.routing?.fallbacks}};
}
/** Ranked candidates per spec §6; free_first asks before using unknown-price models. */
function routeCandidates(models:Model[],health:Map<string,RouteHealth>,text:string,promptTokens:number,purpose:Purpose|undefined,prefs:ReturnType<typeof routingPreferences>){
  const usable=models.filter(m=>routeAvailable(health,m));
  const ranked=rankAutomatic(usable,text,id=>health.get(id),promptTokens,purpose,prefs);
  if(!ranked.length&&prefs.ai.profile==='free_first'&&rankAutomatic(usable,text,id=>health.get(id),promptTokens,purpose,{...prefs,ai:{...prefs.ai,profile:'recommended'}}).length)
    throw new RoutingPolicyError('No model with a verified free status is available right now. To use models with unknown or paid pricing, choose another intelligence profile in Settings → Model Routing.','free_models_unavailable');
  return prefs.ai.profile==='custom'?ranked:fallbackOrder(ranked);
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
  
  // Start performance tracking
  const perfId = clientRequestId || requestId;
  performanceTracker.startRequest(perfId, owner, input.mode as 'chat'|'swarm', input.modelId, input.modelId === 'auto');
  
  if(!['send','edit','regenerate','continue'].includes(input.action)||!['chat','swarm'].includes(input.mode)||typeof input.modelId!=='string'||input.modelId.length>200)throw new HttpError(400,'Invalid chat request.');
  const automatic=input.modelId==='auto';
  const adapter=adapters.find(a=>a.id===input.providerId);const config=adapter&&await credentials(owner,adapter.id);
  if(!automatic&&(!adapter||!config))throw new HttpError(412,'SWARM has no configured provider for this model. Please retry later.');
  
  performanceTracker.recordTimestamp(perfId, 'authCompleted');
  
  const c=await getConversation(owner,id);let reservation:string|undefined;let succeeded=false;const lock=`${owner}:${id}`;
  if(state().active.has(lock))throw new HttpError(409,'This conversation is already responding.');const lease=randomUUID();const acquired=await state().db.prepare('INSERT INTO active_runs(owner,id,lease,expires) VALUES(?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET lease=excluded.lease,expires=excluded.expires WHERE active_runs.expires<? RETURNING lease').get(owner,id,lease,Date.now()+360000,Date.now());if(!acquired)throw new HttpError(409,'This conversation is already responding.');state().active.add(lock);
  try {
    // Parallel execution: model discovery and input validation don't depend on each other
    performanceTracker.recordTimestamp(perfId, 'modelDiscoveryStarted');
    const [available] = await Promise.all([
      modelList(owner,budget.signal),
      // Validate prompt in parallel
      Promise.resolve().then(() => {
        const prompt=typeof input.prompt==='string'?input.prompt.trim():'';
        if(['send','edit'].includes(input.action)&&(!prompt||prompt.length>32000))throw new HttpError(400,'Enter a message of up to 32,000 characters.');
        return prompt;
      })
    ]);
    performanceTracker.recordTimestamp(perfId, 'modelDiscoveryCompleted');
    
    if(budget.signal.aborted)throw new HttpError(budget.timedOut?504:499,budget.timedOut?'The request exceeded its time limit. Try again.':'Request cancelled.');
    if(automatic&&!available.models.length)throw new HttpError(503,(await Promise.all(adapters.map(a=>credentials(owner,a.id)))).some(Boolean)?'All configured providers are currently unavailable. Your SWARM allowance was not consumed.':'No AI model is configured. Connect a provider in Settings → Providers to start.');
    if(!automatic&&!available.models.some(m=>m.providerId===input.providerId&&m.modelId===input.modelId))throw new HttpError(412,'Choose a currently available model.');
    const prompt=typeof input.prompt==='string'?input.prompt.trim():'';
    const target=c.messages.findIndex(m=>m.id===input.messageId&&m.role==='user');
    if(input.action==='edit'||input.action==='regenerate'){
      if(target<0)throw new HttpError(400,'Choose a user message to edit or regenerate.');c.messages=c.messages.slice(0,target+1);
      if(input.action==='edit')c.messages[target].content=prompt;
    }else if(input.action==='continue'&&c.messages.at(-1)?.role!=='assistant')throw new HttpError(400,'There is no response to continue.');
    reservation=await reserveUsage(state().db,owner,clientRequestId||requestId,input.mode==='swarm'?'build':'chat',{id,raw});
    performanceTracker.recordTimestamp(perfId, 'usageReserved');
    
    if(input.action==='send'){const message={id:Date.now(),role:'user' as const,content:prompt,createdAt:now(),requestId:clientRequestId};c.messages.push(message);}
    if(['New chat','New conversation'].includes(c.title))c.title=prompt.replace(/\s+/g,' ').slice(0,80)||c.title;await saveConversation(owner,c);
  }catch(error){
    performanceTracker.recordError(perfId, error instanceof HttpError && error.status === 429 ? 'rate_limit' : 'server');
    if(reservation)await settleUsage(state().db,owner,reservation,false);state().active.delete(lock);await state().db.prepare('DELETE FROM active_runs WHERE owner=? AND id=? AND lease=?').run(owner,id,lease);throw error;
  }
  const abort=budget;let disconnected=request.signal.aborted;const cancel=()=>{disconnected=true;abort.abort();};request.signal.addEventListener('abort',cancel,{once:true});
  const encoder=new TextEncoder();let content='';let routedModel:Model|undefined;const routingNotices:string[]=[];const buildEvents:{role:string;name:string;status:string;time:number;output?:string}[]=[];
  const stream=new ReadableStream<Uint8Array>({
    async start(controller){
      const enqueue=(data:string)=>{if(!disconnected){try{controller.enqueue(encoder.encode(data));}catch{cancel();}}};
      const event=(type:string,data:unknown)=>{if(type==='agent')buildEvents.push({...data as {role:string;name:string;status:string},time:Date.now()});enqueue(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
      const heartbeat=setInterval(()=>enqueue(': keepalive\n\n'),15000);
      const system=getSystemPrompt('chat');
      const history:ChatMessage[]=c.messages.map(m=>({role:m.role,content:m.content}));
      if(input.action==='continue')history.push({role:'system',content:getSystemPrompt('continue')});
      const complete=async(messages:ChatMessage[],streaming:boolean,purpose?:Purpose)=>{
        stage=purpose||'chat';abort.signal.throwIfAborted();
        performanceTracker.recordTimestamp(perfId, 'routingStarted');
        
        // Parallel execution: fetch policy and health data simultaneously
        const [policy, health] = await Promise.all([
          userRoutingPolicy(owner),
          getRoutingHealthBatch(owner)
        ]);
        
        const preferences=await accountPreferences(owner);const prefs=routingPreferences(preferences,policy.routing);
        const available=(await modelList(owner)).models.filter(m=>allowedModel(m,policy.ids));
        const text=c.messages.filter(m=>m.role==='user').at(-1)?.content||'';
        const promptTokens=messages.reduce((total,m)=>total+(typeof m.content==='string'?Math.ceil(m.content.length/4):800),0);
        const ranked=routeCandidates(available,health,text,promptTokens,purpose,prefs);
        if(!automatic){const selected=ranked.findIndex(m=>m.providerId===input.providerId&&m.modelId===input.modelId);if(selected>0)ranked.unshift(...ranked.splice(selected,1));}
        performanceTracker.recordTimestamp(perfId, 'routingCompleted');
        const configs=new Map<string,ProviderConfig>();let started=Date.now();
        try {
          const {result}=await runFallbackChain<Model,ChatResult>({
            candidates:ranked,maxFallbacks:maxFallbacksFor(preferences),signal:abort.signal,
            acquire:async pick=>{const cfg=await credentials(owner,pick.providerId);if(!cfg)return null;const routeLease=await acquireRoute(owner,pick);if(!routeLease)return null;configs.set(pick.id,cfg);return ()=>releaseRoute(owner,pick,routeLease);},
            run:async pick=>{
              const candidate=adapters.find(a=>a.id===pick.providerId)!;
              attempt++;started=Date.now();routedModel=pick;event('model',{modelId:pick.modelId,providerId:pick.providerId,displayName:pick.displayName,providerName:pick.providerName,automatic});
              performanceTracker.recordTimestamp(perfId, 'providerRequestStarted');
              const result=await candidate.chat(configs.get(pick.id)!,pick.modelId,{messages,reasoningEffort:policy.reasoningEffort,signal:abort.signal,maxTokens:streaming?Math.min(preferences.ai?.maxOutputTokens??4096,4096):1800,temperature:preferences.ai?.temperature??0.4,stream:streaming,firstTokenTimeoutMs:Math.min(policy.routing==='fastest'?10000:20000,budget.remaining()),totalTimeoutMs:Math.min(60000,budget.remaining()),onToken:streaming?token=>{
                if (!performanceTracker.getMetrics(perfId)?.firstTokenReceived) {
                  performanceTracker.recordTimestamp(perfId, 'firstTokenReceived');
                }
                content+=token;event('delta',{token});
              }:undefined});
              if(!result.text.trim())throw new ProviderError('invalid','Empty response');
              performanceTracker.recordTimestamp(perfId, 'streamingCompleted');
              performanceTracker.recordProviderMetrics(perfId, result.promptTokens || promptTokens, result.completionTokens || 0, pick.providerId);
              return result;
            },
            record:async(pick,ok,value)=>{if(ok){const result=value as ChatResult;await recordRoute(owner,pick,true,result.latencyMs,result.completionTokens,undefined,result.ttftMs);}else await recordRoute(owner,pick,false,Date.now()-started,0,value);},
            onFailure:(_pick,_error,next)=>{
              if(streaming){content='';event('reset',{message:next==='retry'?'The incomplete response was discarded. Retrying once.':'The incomplete response was discarded. Restarting with another provider.'});}
              event('routing',{status:next==='retry'?'retry':'fallback',message:next==='retry'?'Retrying the same model once…':'Trying another available model…'});
            },
            onSwitch:(from,to,error,notice)=>{routingNotices.push(notice);event('routing',{status:'downgrade',from:from.id,to:to.id,reason:downgradeReason(error),message:notice});},
          });
          return result;
        }catch(error){if(error instanceof FallbackStop)throw error.cause;throw error;}
      };
      try {
        if(input.mode==='swarm'){
          event('agent',{role:'planner',name:'Planner',status:'working'});
          const plan=await complete([{role:'system',content:getSystemPrompt('plan')},...history],false,'plan');
          event('agent',{role:'planner',name:'Planner',status:'completed',output:plan.text});event('agent',{role:'coder',name:'Coder',status:'working'});
          const draft=await complete([{role:'system',content:getSystemPrompt('code', {strategy: plan.text})},...history],false,'code');
          event('agent',{role:'coder',name:'Coder',status:'completed',output:draft.text});event('agent',{role:'reviewer',name:'Reviewer',status:'working'});
          content=(await complete([{role:'system',content:getSystemPrompt('review', {draft: draft.text})},...history],true,'review')).text;
          event('agent',{role:'reviewer',name:'Reviewer',status:'completed',output:content});
        }else content=(await complete([{role:'system',content:system},...history],true)).text;
        if(!content.trim())throw new Error('Empty response');
        if(input.mode==='swarm'){event('agent',{role:'finalizer',name:'Finalizer',status:'working'});const files=codeFiles(content);if(!files.length)throw new ProviderError('invalid','No generated source files were produced. The build allowance was released.');if(files.length)zipSync(Object.fromEntries(files.map(f=>[f.name,strToU8(f.content)])));event('agent',{role:'finalizer',name:'Finalizer',status:'completed',output:files.length?`Packaged ${files.length} files for download:\n${files.map(f=>f.name).join('\n')}`:'No code files were returned for this request.'});}
        const message={buildEvents:input.mode==='swarm'?buildEvents:undefined,id:Date.now(),role:'assistant' as const,content,createdAt:now(),modelName:routedModel?`${routedModel.displayName} · ${routedModel.providerName}`:undefined,routingNotices:routingNotices.length?[...routingNotices]:undefined};abort.signal.throwIfAborted();c.messages.push(message);await managedTransaction(state().db,owner,async()=>{await saveConversation(owner,c);await settleUsage(state().db,owner,reservation!,true);});
        performanceTracker.recordTimestamp(perfId, 'usageSettled');
        performanceTracker.recordSuccess(perfId);
        succeeded=true;event('done',{message,conversation:c});
        
        // Log performance metrics
        const metrics = performanceTracker.finalizeRequest(perfId);
        if (metrics) {
          console.log('swarm.perf', formatMetricsForLog(metrics));
        }
      }catch(error){
        const category=budget.timedOut?'timeout':abort.signal.aborted?'cancelled':error instanceof ProviderError?error.kind:'server';
        performanceTracker.recordError(perfId, category);
        const diagnostic={requestId,durationMs:Date.now()-requestStarted,stage,category,status:error instanceof ProviderError?error.status:undefined,attempt,retryCount:Math.max(0,attempt-1),timedOut:category==='timeout',aborted:category==='cancelled',connectionLost:category==='network'};
        console.warn('swarm.chat.failure',diagnostic);
        if(input.mode==='swarm'){const latest=buildEvents.filter(e=>e.status==='working').at(-1);if(latest)event('agent',{role:latest.role,name:latest.name,status:'failed'});}
        if(disconnected&&content.trim()){c.messages.push({id:Date.now(),role:'assistant',content:content+'\n\n*Response stopped.*',createdAt:now()});await saveConversation(owner,c);}
        else event('error',{error:budget.timedOut?'This project reached its time limit. Your message is saved; try a smaller task.':error instanceof RoutingPolicyError?error.message:providerError(error),...(error instanceof RoutingPolicyError?{code:error.code}:{}),...diagnostic,retryable:['network','timeout','rate_limit','server'].includes(category)});
        
        // Finalize failed request metrics
        performanceTracker.finalizeRequest(perfId);
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
  if(!(await modelList(owner)).models.length)throw new ManagedError(503,'no_provider','No server provider is available. Contact the operator or retry later.');
  await reserveUsage(db,owner,raw.id,kind,{kind});
  const expires=Date.now()+3600000;
  await db.prepare('INSERT INTO managed_operations VALUES(?,?,?,0,0,?)').run(owner,raw.id,kind,expires);
  return {id:raw.id,kind,expires};
}
async function managedComplete(request:Request,owner:string,raw:Record<string,unknown>) {
  const db=state().db;const messages=validateManagedMessages(raw.messages);
  if(typeof raw.operationId!=='string'||typeof raw.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(raw.requestId))throw new ManagedError(400,'request','Invalid inference request.');
  const operationId=raw.operationId,requestId=raw.requestId,hash=fingerprint(raw);
  const replay=await db.prepare('SELECT fingerprint,result FROM inference_requests WHERE owner=? AND id=?').get(owner,requestId);if(replay){if(replay.fingerprint!==hash||!replay.result)throw new ManagedError(409,'inference_duplicate','This inference request is already running or cannot be replayed.');return JSON.parse(String(replay.result));}
  const policy=await userRoutingPolicy(owner),usage=await accountUsage(db,owner);
  if(raw.needs!==undefined&&(!Array.isArray(raw.needs)||raw.needs.some(n=>!['chat','coding','reasoning','vision','fast','long_context','tools'].includes(String(n)))))throw new ManagedError(400,'capabilities','Invalid model capabilities.');
  const needs=[...(raw.needs as string[]||[]),...(raw.json===true?['json']:[]),...(messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image'))?['vision']:[])];
  const purpose=['plan','research','design','architecture','code','review','vision','classify','summarize','test'].includes(String(raw.purpose))?raw.purpose as Purpose:'code';
  const models=(await modelList(owner)).models.filter(m=>allowedModel(m,policy.ids)&&needs.every(n=>m.capabilities?.includes(n as Capability)));
  const health=await getRoutingHealthBatch(owner);const preferences=await accountPreferences(owner);
  let ranks:Model[];
  try{ranks=routeCandidates(models,health,'',messages.reduce((n,m)=>n+(typeof m.content==='string'?Math.ceil(m.content.length/4):m.content.reduce((total,p)=>total+(p.type==='text'?Math.ceil(p.text.length/4):800),0)),0),purpose,routingPreferences(preferences,policy.routing));}
  catch(error){if(error instanceof RoutingPolicyError)throw new ManagedError(412,error.code,error.message);throw error;}
  if(raw.pinned){const preferred=ranks.findIndex(m=>m.id===raw.pinned);if(preferred>0)ranks.unshift(...ranks.splice(preferred,1));}
  if(!ranks.length)throw new ManagedError(503,'no_provider','No eligible SWARM backend model is available.');
  const cached=await managedTransaction(db,owner,async()=>{
    const previous=await db.prepare('SELECT fingerprint,result FROM inference_requests WHERE owner=? AND id=?').get(owner,requestId);
    if(previous){if(previous.fingerprint!==hash||!previous.result)throw new ManagedError(409,'inference_duplicate','This inference request is already running or cannot be replayed.');return JSON.parse(String(previous.result));}
    const op=await db.prepare('SELECT * FROM managed_operations WHERE owner=? AND id=?').get(owner,operationId);
    if(!op||Number(op.expires)<Date.now())throw new ManagedError(403,'operation_expired','Start a new SWARM operation.');
    const maxCalls=Number(process.env[op.kind==='build'?'SWARM_NATIVE_BUILD_CALLS':'SWARM_NATIVE_CHAT_CALLS']|| (op.kind==='build'?32:8));
    if(!usage.unlimited&&(!Number.isSafeInteger(maxCalls)||maxCalls<1||Number(op.calls)>=maxCalls))throw new ManagedError(429,'operation_budget','This operation reached its inference budget.');
    const active=await db.prepare('SELECT SUM(active) AS n FROM managed_operations WHERE owner=? AND expires>?').get(owner,Date.now());
    if(Number(active?.n||0)>=usage.plan.concurrency)throw new ManagedError(429,'concurrency','Wait for the current inference request to finish.');
    await db.prepare('UPDATE managed_operations SET calls=calls+1,active=active+1 WHERE owner=? AND id=?').run(owner,operationId);
    await db.prepare('INSERT INTO inference_requests VALUES(?,?,?,?,NULL)').run(owner,requestId,operationId,hash);
    return null;
  });
  if(cached)return cached;
  try {
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(180000)]);const configs=new Map<string,ProviderConfig>();
    try{
      const {result,model,notices}=await runFallbackChain<Model,ChatResult>({
        candidates:ranks,maxFallbacks:maxFallbacksFor(preferences),signal,
        acquire:async pick=>{const config=await credentials(owner,pick.providerId);if(!config)return null;const routeLease=await acquireRoute(owner,pick);if(!routeLease)return null;configs.set(pick.id,config);return ()=>releaseRoute(owner,pick,routeLease);},
        run:async pick=>{
          const adapter=adapters.find(a=>a.id===pick.providerId)!;
          const result=await adapter.chat(configs.get(pick.id)!,pick.modelId,{messages,reasoningEffort:policy.reasoningEffort,maxTokens:Math.min(4096,Math.max(128,Number(raw.maxTokens)||4096)),temperature:0.3,signal,stream:false,json:raw.json===true,firstTokenTimeoutMs:20000,totalTimeoutMs:45000});
          if(!result.text.trim())throw new ProviderError('invalid','Empty response');
          return result;
        },
        record:async(pick,ok,value)=>{if(ok){const result=value as ChatResult;await recordRoute(owner,pick,true,result.latencyMs,result.completionTokens);}else await recordRoute(owner,pick,false,0,0,value);},
      });
      const response={result,model,...(notices.length?{notices}:{})};
      await managedTransaction(db,owner,async()=>{signal.throwIfAborted();await db.prepare('UPDATE inference_requests SET result=? WHERE owner=? AND id=?').run(JSON.stringify(response),owner,requestId);});
      return response;
    }catch(error){
      const cause=error instanceof FallbackStop?error.cause:error;
      if(cause instanceof ProviderError&&cause.kind==='bad_request')throw new ManagedError(400,'request_invalid','The provider rejected this request. Review its input and options.');
      if(signal.aborted)throw new ManagedError(request.signal.aborted?499:504,request.signal.aborted?'cancelled':'timeout',request.signal.aborted?'Request cancelled.':'The inference deadline expired.');
      if(cause instanceof ManagedError)throw cause;
      throw new ManagedError(503,'routes_exhausted',safeProviderFailure(cause));
    }
  }finally{await db.prepare('UPDATE managed_operations SET active=active-1 WHERE owner=? AND id=?').run(owner,operationId);}
}
/** BYOK provider API (spec §1–§4). Keys are accepted, never returned; responses carry only the masked hint. */
async function providersApi(request:Request,owner:string,path:string[],method:string):Promise<Response> {
  if(path.length===1&&method==='GET'){
    const providers=await Promise.all(PROVIDER_CATALOG.map(p=>providerSummary(owner,p.id)));
    return json({providers,managedProviders:adapters.filter(a=>!isByokProvider(a.id)).map(a=>managedSummary(a.id))});
  }
  const id=String(path[1]||'');const adapter=adapters.find(a=>a.id===id);
  if(!adapter||path.length>3)throw new ManagedError(400,'provider','Choose a supported provider.');
  if(!isByokProvider(id)){
    // Providers outside the BYOK catalog stay server-managed.
    if(path.length===2&&method==='DELETE')return json({ok:true});
    if(path.length===2&&method==='GET')return json(managedSummary(id));
    throw new ManagedError(405,'managed_credentials','This provider is managed by the server operator.');
  }
  if(path.length===2&&method==='GET')return json(await providerSummary(owner,id));
  if(path.length===2&&method==='PUT'){
    const b=await bodyFor(request);
    if(typeof b.apiKey==='string')b.apiKey=b.apiKey.trim();
    await storeAccountKey(owner,id,b.apiKey,b.accountId);
    const warning=keyFormatWarning(id,String(b.apiKey));
    return json({...await providerSummary(owner,id),...(warning?{warning}:{})});
  }
  if(path.length===2&&method==='DELETE'){await storeAccountKey(owner,id,null);return json({ok:true,provider:await providerSummary(owner,id)});}
  if(path.length===3&&path[2]==='test'&&method==='POST'){
    const b=await bodyFor(request);
    let config:ProviderConfig|null;let tag:string;
    if(b.apiKey!==undefined){
      // Test-before-save: the candidate key is used for this request only and never stored.
      const key=typeof b.apiKey==='string'?b.apiKey.trim():b.apiKey;validateKeyInput(id,key);
      config={apiKey:key as string,accountId:null,baseUrl:adapter.defaultBaseUrl};tag=keyTag(state().secret,owner,id,key as string);
    }else{
      try{config=await readCredential(state().db,state().secret,owner,id);}catch(error){if(error instanceof ManagedError&&error.code==='credential_storage')config=null;else throw error;}
      if(!config)throw new ManagedError(412,'credential_missing','Save a provider key first, or include one to test.');
      tag=(await readCredentialMeta(state().db,owner,id))?.keyTag||'';
    }
    const release=testLimiter().acquire(owner);
    if(!release)throw new ManagedError(429,'test_rate_limited','Wait for the current connection test to finish. You can run up to 10 tests per minute.');
    activeTests().set(owner,id);
    try{
      const {discovered:_discovered,...result}=await testConnection(id,adapter,config,{signal:request.signal});
      await state().db.prepare('INSERT OR REPLACE INTO provider_status(owner,provider,data) VALUES(?,?,?)').run(owner,id,JSON.stringify({keyTag:tag,result}));
      if(result.status==='connected')state().models.clear();
      activeTests().delete(owner);
      return json({...result,provider:await providerSummary(owner,id)});
    }finally{activeTests().delete(owner);release();}
  }
  throw new ManagedError(405,'method','Unsupported provider operation.');
}
export async function handleApi(request:Request,path:string[]):Promise<Response> {return storageContext(()=>handleApiInner(request,path));}
async function handleApiInner(request:Request,path:string[]):Promise<Response> {
  let owner: string | null = null; // Declare outside try block for error logging
  try {
    // Health check is public to allow frontend to verify backend availability without authentication
    if(path.join('/')==='health'&&request.method==='GET')return json({status:'ok',mode:process.env.CLERK_SECRET_KEY?'account':'local',timestamp:Date.now()});
    // Performance metrics endpoint (requires authentication)
    if(path.join('/')==='performance/metrics'&&request.method==='GET'){
      owner=await ownerFor(request);
      if(!(process.env.SWARM_OPERATOR_IDS||'').split(',').map(s=>s.trim()).includes(owner))throw new ManagedError(403,'operator_required','Operator access required.');
      const windowMs = Number(new URL(request.url).searchParams.get('window')) || 600000;
      const aggregate = performanceTracker.getAggregateMetrics(windowMs);
      return json({ aggregate, timestamp: Date.now() });
    }
    if(path.join('/')==='performance/export'&&request.method==='GET'){
      owner=await ownerFor(request);
      if(!(process.env.SWARM_OPERATOR_IDS||'').split(',').map(s=>s.trim()).includes(owner))throw new ManagedError(403,'operator_required','Operator access required.');
      return new Response(performanceTracker.exportMetrics(), {
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="swarm-performance-${Date.now()}.json"` }
      });
    }
    if(path.join('/')==='routing/diagnostics'&&request.method==='GET'){
      owner=await ownerFor(request);if(!(process.env.SWARM_OPERATOR_IDS||'').split(',').includes(owner))throw new ManagedError(403,'operator_required','Operator access required.');
      return json({health:Object.fromEntries(await getRoutingHealthBatch(owner)),timestamp:Date.now()});
    }
    // Configuration diagnostics - public for setup guidance
    if(path.join('/')==='config/diagnostics'&&request.method==='GET')return json({issues:validateConfiguration()});
    if(path.join('/')==='plans'&&request.method==='GET')return json({catalog:planCatalog(),checkoutAvailable:checkoutAvailable(),billingMode:cashfreeEnvironment().mode});
    if(path.join('/')==='billing/webhook'&&request.method==='POST')return json(await cashfreeWebhook(state().db,request));
    const exchange=path.join('/')==='account/desktop-token';
    owner=exchange?null:await ownerFor(request);const method=request.method;
    if(owner)await initializeAccount(state().db,owner);
    if(owner&&path.join('/')==='account/entitlements'&&method==='GET'){
      const usage=await accountUsage(state().db,owner),policy=modelPolicy(),models=(await modelList(owner)).models;
      const available=(ids:string[])=>models.some(m=>ids.includes(m.id));
      return json({...usage,catalog:planCatalog(),checkoutAvailable:checkoutAvailable(),billingMode:cashfreeEnvironment().mode,profiles:[{id:'swe',name:'SWARM SWE',eligible:true,available:available(policy.standard)},{id:'flash',name:'SWARM SWE Fast',eligible:usage.plan.premium,available:available(policy.standard)},{id:'premium',name:'SWARM Premium',eligible:usage.plan.premium,available:available(policy.premium)}]});
    }
    if(owner&&path.join('/')==='account/model-preferences'&&method==='POST'){const b=await bodyFor(request);
      if(typeof b.profile!=='string'||typeof b.speed!=='string'||!['swe','flash','premium'].includes(b.profile)||!['fast','balanced','quality'].includes(b.speed))throw new ManagedError(400,'preferences','Choose a supported model profile and generation mode.');
      if(b.profile==='premium'&&!(await accountUsage(state().db,owner)).plan.premium)throw new ManagedError(403,'premium_required','SWARM Premium requires Pro.');
if(!(await modelList(owner)).models.length)throw new ManagedError(503,'model_unavailable','This SWARM profile is not currently configured.');return json(await saveManagedPreferences(state().db,owner,b.profile,b.speed));}
    if(owner&&path[0]==='billing'){
      if(path[1]==='checkout'&&method==='POST'){const b=await bodyFor(request);if(b.plan!=='pro'||b.amount!==undefined)throw new ManagedError(400,'plan','Choose the configured Pro plan.');return json(await createCheckout(state().db,owner,b.requestId,b.phone));}
      if(path[1]==='verify'&&method==='POST'){const b=await bodyFor(request);if(typeof b.orderId!=='string')throw new ManagedError(400,'order','Choose a payment order.');return json(await verifyOrder(state().db,owner,b.orderId));}
      if(path[1]==='history'&&method==='GET')return json({transactions:await state().db.prepare('SELECT id,amount,days,status,payment,created,fulfilled FROM payment_orders WHERE owner=? ORDER BY created DESC').all(owner)});
    }
    if(owner&&path.join('/')==='managed/finish'&&method==='POST'){
      const b=await bodyFor(request);if(typeof b.id!=='string')throw new ManagedError(400,'operation','Invalid operation.');
      await managedTransaction(state().db,owner!,async()=>{
        const op=await state().db.prepare('SELECT active FROM managed_operations WHERE owner=? AND id=?').get(owner!,b.id);
        if(op&&Number(op.active)===0){const completed=await state().db.prepare('SELECT COUNT(*) AS n FROM inference_requests WHERE owner=? AND operation=? AND result IS NOT NULL').get(owner!,b.id);await settleUsage(state().db,owner!,b.id as string,b.success===true&&Number(completed?.n)>0);await state().db.prepare('UPDATE managed_operations SET expires=0 WHERE owner=? AND id=?').run(owner!,b.id);}
      });return json({ok:true});
    }
    if(owner&&path.join('/')==='managed/operation'&&method==='POST')return json(await startManagedOperation(owner,await bodyFor(request)));
    if(owner&&path.join('/')==='managed/complete'&&method==='POST')return json(await managedComplete(request,owner,await bodyFor(request)));
    // Account sync never moves provider keys: the web vault is managed only through /api/providers.
    const syncWriteKey=async(_owner:string,_provider:string,key:string|null)=>{if(key!==null)throw new ManagedError(405,'managed_credentials','Provider keys are not synchronized. Save them in Settings → Providers.');};
    const account=await accountApi(request,path,owner,{db:state().db,readKey:async()=>null,writeKey:syncWriteKey,providers:adapters.map(a=>a.id),active:state().active});if(account)return account;
    if(!owner)throw new HttpError(401,'Sign in to continue.');
    if(path[0]==='models'&&method==='GET'){const inventory=await modelList(owner),policy=await userRoutingPolicy(owner);return json({...inventory,models:inventory.models.filter(m=>allowedModel(m,policy.ids))});}
    if(path[0]==='providers')return await providersApi(request,owner,path,method);
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
  }catch(error){
    const url = new URL(request.url);
    const status = error instanceof HttpError || error instanceof ManagedError ? error.status : 500;
    
    // Log API errors with safe redaction
    logApiError(
      url.pathname,
      request.method,
      status,
      error,
      owner || undefined
    );
    
    return json({
      error:error instanceof HttpError||error instanceof ManagedError?error.message:'The server could not complete this request.',
      ...(error instanceof ManagedError?{code:error.code}:{})
    },status);
  }
}
