// Run only against an isolated local database. Never prints any credential or session token.
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {handleApi,accountDatabase} from '../lib/server/backend';
import {adapters} from '../lib/server/providers';
import {modelPolicy,managedCredentials} from '../lib/server/managed-providers';
import {issueDevice} from '../lib/server/accounts';

process.env.SWARM_DATA_DIR=mkdtempSync(join(tmpdir(),'swarm-real-managed-smoke-'));
delete process.env.SWARM_DATABASE_URL;delete process.env.DATABASE_URL;
// Device authentication is real, but this synthetic smoke identity is not a Clerk signup.
process.env.CLERK_SECRET_KEY ||= 'device-auth-only-local-smoke';
process.env.SWARM_STANDARD_MODELS ||= 'groq:openai/gpt-oss-20b';
console.log(JSON.stringify({stage:'configuration',policy:modelPolicy(),groqConfigured:!!managedCredentials('groq')}));
const found=await adapters.find(a=>a.id==='groq')!.discover(managedCredentials('groq')!,AbortSignal.timeout(20000));console.log(JSON.stringify({stage:'discovery',count:found.length,models:found.slice(0,12).map(m=>m.modelId)}));
const owner='managed-smoke-'+randomUUID(),token=await issueDevice(accountDatabase(),owner,'isolated local smoke');
const call=(path:string,body?:unknown)=>handleApi(new Request('http://localhost:3000/api/'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),path.split('/'));
try{
  const entitlement=await(await call('account/entitlements')).json();
  console.log(JSON.stringify({stage:'account',plan:entitlement.plan?.id,builds:entitlement.builds,chats:entitlement.chats,checkoutAvailable:entitlement.checkoutAvailable}));
  const inventory=await(await call('models')).json();console.log(JSON.stringify({stage:'models',models:inventory.models?.map((m:any)=>m.id),errors:inventory.errors}));
  const operation=await call('managed/operation',{id:'real-provider-smoke',kind:'chat'});
  if(!operation.ok){console.log(JSON.stringify({stage:'operation',status:operation.status}));process.exitCode=1;}
  else{
    const answer=await call('managed/complete',{operationId:'real-provider-smoke',requestId:'smoke-single-inference',messages:[{role:'user',content:'Reply with exactly the word ready.'}],maxTokens:16});
    const data=await answer.json();console.log(JSON.stringify({stage:'inference',status:answer.status,model:data.model?.id,response:data.result?.text,promptTokens:data.result?.promptTokens,completionTokens:data.result?.completionTokens}));
    if(!answer.ok||!data.result?.text)process.exitCode=1;
    await call('managed/finish',{id:'real-provider-smoke'});
    const usage=await(await call('account/entitlements')).json();console.log(JSON.stringify({stage:'usage',chats:usage.chats}));
  }
}finally{await accountDatabase().close();}
