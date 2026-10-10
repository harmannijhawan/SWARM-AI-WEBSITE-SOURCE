import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {handleApi,accountDatabase} from '../lib/server/backend';
import {issueDevice} from '../lib/server/accounts';
import {adapters,envNames} from '../lib/server/providers';

process.env.SWARM_DATA_DIR=mkdtempSync(join(tmpdir(),'swarm-managed-api-'));
delete process.env.SWARM_DATABASE_URL;delete process.env.DATABASE_URL;
for(const names of Object.values(envNames))for(const name of names)delete process.env[name];
process.env.CLERK_SECRET_KEY='test-only-device-auth-fixture';
process.env.GROQ_API_KEY='server-only-fixture-key';
process.env.SWARM_STANDARD_MODELS='groq:fixture-small';
process.env.SWARM_PREMIUM_MODELS='groq:fixture-premium';
const adapter=adapters.find(a=>a.id==='groq')!;
adapter.discover=async()=>['fixture-small','fixture-premium','not-allowed'].map(modelId=>({modelId,displayName:modelId,capabilities:['chat','coding'],contextLength:32000,maxOutput:4096,freeStatus:'free_tier'}));
let calls=0;
adapter.chat=async(config,model,input)=>{assert.equal(config.apiKey,'server-only-fixture-key');calls++;const text='Managed '+model;input.onToken?.(text);return {text,promptTokens:1,completionTokens:1,finishReason:'stop',latencyMs:1,ttftMs:1,usageEstimated:false};};
const request=(path:string,token:string,body?:unknown)=>handleApi(new Request('http://localhost:3000/api/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),path.split('/'));

test('authenticated new users get managed Free access; models are allowlisted and credentials never cross the API',async()=>{
  const alice=await issueDevice(accountDatabase(),'alice','test'),bob=await issueDevice(accountDatabase(),'bob','test');
  const response=await request('account/entitlements',alice),envelope=await response.json();assert.equal(response.status,200);assert.equal(envelope.plan.id,'free');assert.equal(envelope.chats.limit,2);
  assert.equal((await request('account/model-preferences',alice,{profile:'premium',speed:'quality'})).status,403);
  const inventory=await(await request('models',alice)).json();assert.deepEqual(inventory.models.map((m:any)=>m.id),['groq:fixture-small']);
  const safe=await(await request('providers',alice)).text();assert(!safe.includes('server-only-fixture-key'));assert(!safe.includes('fixture-key'));
  const created=await(await request('conversations',alice,{title:'Managed user request'})).json();
  const payload={action:'send',prompt:'Hello',providerId:'auto',modelId:'auto',mode:'chat',requestId:'same-user-request'};
  const answer=await request('conversations/'+created.id+'/stream',alice,payload);assert.equal(answer.status,200);assert((await answer.text()).includes('event: done'));
  assert.equal((await(await request('account/entitlements',alice)).json()).chats.used,1);
  assert.equal((await request('conversations/'+created.id+'/stream',alice,payload)).status,409);
  assert.equal((await request('conversations/'+created.id,bob)).status,404);
  assert.equal((await(await request('account/entitlements',bob)).json()).chats.used,0);
  assert.equal((await request('billing/verify',bob,{orderId:'unknown'})).status,404);
  // Health check is now public and works without authentication
  assert.equal((await request('health','invalid')).status,200);
});
test('native internal inference calls consume one bounded build allowance and duplicate results are safely cached',async()=>{
  const token=await issueDevice(accountDatabase(),'native-user','test');
  assert.equal((await request('managed/operation',token,{id:'native-build',kind:'build'})).status,200);
  const input={operationId:'native-build',requestId:'native-inference',messages:[{role:'user',content:'Write code'}]};
  const before=calls;
  const result=await request('managed/complete',token,input);assert.equal(result.status,200);assert(!(await result.text()).includes('server-only-fixture-key'));
  assert.equal((await request('managed/complete',token,input)).status,200);assert.equal(calls,before+1);
  assert.equal((await request('managed/complete',token,{...input,requestId:'native-second'})).status,200);
  const usage=await(await request('account/entitlements',token)).json();assert.equal(usage.builds.used,1);assert.equal(usage.chats.used,0);
  assert.equal((await request('managed/complete',token,{...input,requestId:'native-forbidden',pinned:'groq:fixture-premium'})).status,503);
  await request('managed/finish',token,{id:'native-build'});
  assert.equal((await request('managed/complete',token,{...input,requestId:'after-finish'})).status,403);
});
test('unavailable managed providers return an honest status without asking for a user key or consuming quota',async()=>{
  const token=await issueDevice(accountDatabase(),'unavailable-user','test');delete process.env.GROQ_API_KEY;(globalThis as any).swarmWeb.models.clear();
  const result=await request('managed/operation',token,{id:'unavailable-build',kind:'build'});assert.equal(result.status,503);assert((await result.text()).includes('No API-key setup is required'));
  assert.equal((await(await request('account/entitlements',token)).json()).builds.used,0);
});
