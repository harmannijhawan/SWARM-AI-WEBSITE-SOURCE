import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleApi, accountDatabase, storeAccountKey } from '../lib/server/backend';
import { issueDevice } from '../lib/server/accounts';
import { adapters, envNames } from '../lib/server/providers';
import { ProviderError, type ProviderErrorKind } from '../lib/server/desktop-providers/types';
import { accountUsage, reserveUsage, settleUsage } from '../lib/server/entitlements';
import { readCredential } from '../lib/server/user-credentials';
import { accountEncryptionKey } from '../lib/server/backend';

process.env.SWARM_DATA_DIR=mkdtempSync(join(tmpdir(),'swarm-byok-'));
delete process.env.SWARM_DATABASE_URL;delete process.env.DATABASE_URL;
process.env.CLERK_SECRET_KEY='fixture-only';
for(const names of Object.values(envNames))for(const name of names)delete process.env[name];
process.env.GROQ_API_KEY='server-primary-key';
process.env.NVIDIA_API_KEY='server-secondary-key';
process.env.SWARM_STANDARD_MODELS='groq:primary,nvidia:secondary';
beforeEach(async()=>{await accountDatabase().prepare('DELETE FROM routing_health').run();await accountDatabase().prepare('DELETE FROM model_metadata').run();(globalThis as any).swarmWeb.models.clear();primary.discover=async()=>model('primary');secondary.discover=async()=>model('secondary');});
const primary=adapters.find(a=>a.id==='groq')!,secondary=adapters.find(a=>a.id==='nvidia')!;
const model=(id:string)=>[{modelId:id,displayName:id,capabilities:['chat' as const],contextLength:32000,maxOutput:4096,freeStatus:'unknown' as const}];
primary.discover=async()=>model('primary');secondary.discover=async()=>model('secondary');
const result=(text:string)=>({text,promptTokens:1,completionTokens:1,finishReason:'stop',latencyMs:1,ttftMs:1,usageEstimated:false});
const api=(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST')=>handleApi(new Request('http://localhost:3000/api/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),path.split('/'));
async function user(owner:string){return issueDevice(accountDatabase(),owner,'test');}
async function chat(token:string,id:string){const c=await(await api(token,'conversations',{})).json();return api(token,'conversations/'+c.id+'/stream',{action:'send',prompt:'fixture context',providerId:'auto',modelId:'auto',mode:'chat',requestId:id});}

for(const kind of ['rate_limit','quota','network','timeout','auth','server'] as ProviderErrorKind[])test(`${kind}: explicit primary fails, independent provider succeeds, one allowance committed`,async()=>{
  const owner='fallback-'+kind,token=await user(owner);let attempts=0;
  primary.chat=async cfg=>{assert.equal(cfg.apiKey,'server-primary-key');attempts++;throw new ProviderError(kind,'PRIVATE-UPSTREAM-KEY',kind==='rate_limit'?429:503,90000);};
  secondary.chat=async(cfg,_id,req)=>{assert.equal(cfg.apiKey,'server-secondary-key');assert(req.messages.some(m=>m.content==='fixture context'));attempts++;req.onToken?.('Recovered answer');return result('Recovered answer');};
  // Transient network/timeout/server failures get one bounded retry on the same model before switching.
  const response=await chat(token,'op-'+kind);const events=await response.text();assert(events.includes('event: done'));assert(events.includes('Recovered answer'));assert(!events.includes('PRIVATE-UPSTREAM-KEY'));assert.equal(attempts,['network','timeout','server'].includes(kind)?3:2);
  assert(events.includes('Switched from'),'the downgrade must be shown to the user');assert.equal((await accountUsage(accountDatabase(),owner)).chats.used,1);
  if(kind==='rate_limit') {await(await chat(token,'next')).text();assert.equal(attempts,3,'cooling primary must not be called');}
});

test('all routes exhausted release allowance and do not emit a plan error; malformed request is not replayed',async()=>{
  const token=await user('exhausted');let calls=0;
  primary.chat=secondary.chat=async()=>{calls++;throw new ProviderError('network','secret');};
  const events=await(await chat(token,'fail')).text();assert(events.includes('event: error'));assert(!events.includes('event: done'));assert(!events.includes('allowance_exhausted'));assert.equal(calls,4,'each model gets exactly one bounded retry');assert.equal((await accountUsage(accountDatabase(),'exhausted')).chats.used,0);
  await accountDatabase().prepare('DELETE FROM routing_health').run();const invalid=await user('invalid');calls=0;primary.chat=secondary.chat=async()=>{calls++;throw new ProviderError('bad_request','secret');};
  assert((await(await chat(invalid,'bad')).text()).includes('event: error'));assert.equal(calls,1);
});

test('a transient model-discovery failure does not cache an empty provider list',async()=>{
  const owner='discovery-recovers',token=await user(owner);
  primary.discover=secondary.discover=async()=>{throw new ProviderError('network','offline');};
  assert.equal((await(await api(token,'models')).json()).models.length,0);
  primary.discover=async()=>model('primary');secondary.discover=async()=>model('secondary');
  assert.equal((await(await api(token,'models')).json()).models.length,2);
});

test('partial output is reset before fallback and only the replacement is saved',async()=>{
  const token=await user('partial');primary.chat=async(_c,_m,r)=>{r.onToken?.('BROKEN CODE');throw new ProviderError('network','EOF');};secondary.chat=async(_c,_m,r)=>{r.onToken?.('complete code');return result('complete code');};
  const c=await(await api(token,'conversations',{})).json();const events=await(await api(token,'conversations/'+c.id+'/stream',{action:'send',prompt:'code',providerId:'groq',modelId:'primary',mode:'chat',requestId:'partial-op'})).text();
  assert(events.indexOf('event: reset')>events.indexOf('BROKEN CODE'));const saved=await(await api(token,'conversations/'+c.id)).json();assert.equal(saved.messages.at(-1).content,'complete code');
});

test('pending capacity is not consumed usage or exhausted allowance; real cap remains enforced',async()=>{
  const db=accountDatabase(),owner='reservation';await reserveUsage(db,owner,'r1','chat',{});
  assert.equal((await accountUsage(db,owner)).chats.used,0);
  await assert.rejects(reserveUsage(db,owner,'r2','chat',{}),{code:'concurrency'});
  await settleUsage(db,owner,'r1',true);await reserveUsage(db,owner,'r2','chat',{});
  await assert.rejects(reserveUsage(db,owner,'r3','chat',{}),{code:'allowance_reserved'});
  await settleUsage(db,owner,'r2',true);await settleUsage(db,owner,'r2',true);
  await assert.rejects(reserveUsage(db,owner,'r3','chat',{}),{code:'allowance_exhausted'});assert.equal((await accountUsage(db,owner)).chats.used,2);
});

test('personal keys are owner-scoped, never cross the API, and never replace server credentials for others',async()=>{
  const token=await user('security'), outsider=await user('another-account');
  assert.equal((await(await api(outsider,'models')).json()).models.length,2);
  assert(!(await(await api(token,'providers')).text()).includes('server-primary-key'));
  const saved=await api(token,'providers/groq',{apiKey:'gsk_personal-replacement-key'},'PUT');
  assert.equal(saved.status,200);const body=await saved.text();
  assert(!body.includes('gsk_personal-replacement-key'),'a saved key is never echoed');assert(JSON.parse(body).hint.endsWith('-key'));
  const mine=(await(await api(token,'providers')).json()).providers.find((p:any)=>p.providerId==='groq');
  assert.equal(mine.configured,true);assert.equal(mine.status,'needs_configuration');
  const theirs=(await(await api(outsider,'providers')).json()).providers.find((p:any)=>p.providerId==='groq');
  assert.equal(theirs.configured,false,'another account never sees my key');assert.equal(theirs.managed,true);
  let usedKey='';primary.chat=async(cfg,_id,req)=>{usedKey=cfg.apiKey!;req.onToken?.('ok');return result('ok');};secondary.chat=primary.chat;
  await(await chat(outsider,'outsider-uses-server')).text();assert.notEqual(usedKey,'gsk_personal-replacement-key');
  assert.equal((await api(token,'providers/groq',undefined,'DELETE')).status,200);
  assert.equal((await(await api(token,'providers')).json()).providers.find((p:any)=>p.providerId==='groq').configured,false);
});
test('provider cooldown applies to other accounts sharing the server key',async()=>{
  let primaryCalls=0;primary.chat=async()=>{primaryCalls++;throw new ProviderError('rate_limit','private',429,90000);};
  secondary.chat=async(_c,_m,r)=>{r.onToken?.('ok');return result('ok');};
  await(await chat(await user('shared-a'),'shared-a')).text();
  await(await chat(await user('shared-b'),'shared-b')).text();
  assert.equal(primaryCalls,1);
});

test('native failed or cancelled build releases reservation after a successful subcall',async()=>{
  const owner='failed-native',token=await user(owner);primary.chat=secondary.chat=async()=>result('draft');
  await api(token,'managed/operation',{id:'build',kind:'build'});
  assert.equal((await api(token,'managed/complete',{operationId:'build',requestId:'draft',messages:[{role:'user',content:'draft'}]})).status,200);
  assert.equal((await accountUsage(accountDatabase(),owner)).builds.used,0);
  await api(token,'managed/finish',{id:'build',success:false});assert.equal((await accountUsage(accountDatabase(),owner)).builds.used,0);
});

 test('routing recovers within the bounded fallback chain (primary + 6 fallbacks, one retry each)',async()=>{
  const original=process.env.SWARM_STANDARD_MODELS;
  const models=Array.from({length:17},(_,i)=>'candidate-'+i);
  process.env.SWARM_STANDARD_MODELS=models.map(m=>'groq:'+m).join(',');
  primary.discover=async()=>models.flatMap(model);
  let attempts=0;
  // Six models fail (each retried once = 12 calls); the seventh model answers.
  primary.chat=async(_c,_m,r)=>{if(++attempts<=12)throw new ProviderError('server','unavailable');r.onToken?.('recovered');return result('recovered');};
  try {const events=await(await chat(await user('many-models'),'many-models')).text();assert(events.includes('event: done'));assert.equal(attempts,13);}
  finally {process.env.SWARM_STANDARD_MODELS=original;}
 });
 test('routing never exceeds the fallback cap even when more models are listed',async()=>{
  const original=process.env.SWARM_STANDARD_MODELS;
  const models=Array.from({length:17},(_,i)=>'capped-'+i);
  process.env.SWARM_STANDARD_MODELS=models.map(m=>'groq:'+m).join(',');
  primary.discover=async()=>models.flatMap(model);
  let attempts=0;primary.chat=async()=>{attempts++;throw new ProviderError('server','unavailable');};
  try {const events=await(await chat(await user('capped-models'),'capped-models')).text();assert(events.includes('event: error'));assert.equal(attempts,14);}
  finally {process.env.SWARM_STANDARD_MODELS=original;}
 });
