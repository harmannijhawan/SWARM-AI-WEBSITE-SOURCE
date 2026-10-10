// Sandbox-only checkout route trace. Never logs keys, tokens, customer data or checkout sessions.
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const inherited={...process.env};
const require=createRequire(import.meta.url);
const nextEnv=createRequire(require.resolve('next/package.json'))('@next/env');
const loaded=nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){console.error('Environment loading failed (details withheld).');}});
const local=parseEnv(readFileSync('.env.local','utf8'));
if(process.env.CASHFREE_ENV==='production')throw new Error('This order-creation diagnostic is sandbox-only. Use cashfree-auth-probe.mts for a read-only production check.');
for(const name of ['CASHFREE_SANDBOX_CLIENT_ID','CASHFREE_SANDBOX_CLIENT_SECRET'])console.log(JSON.stringify({stage:'environment',name,present:!!process.env[name],source:Object.hasOwn(inherited,name)?'inherited process':loaded.loadedEnvFiles.find((file:any)=>Object.hasOwn(file.env||{},name))?.path||'absent',matchesLocal:process.env[name]===local[name]}));
// Report real configuration before adding isolated diagnostic-only fixtures.
console.log(JSON.stringify({stage:'configuration',returnUrlConfigured:!!process.env.SWARM_PUBLIC_URL,proBuildsConfigured:!!process.env.SWARM_PRO_BUILDS,proChatsConfigured:!!process.env.SWARM_PRO_CHATS,apiRewriteConfigured:!!process.env.SWARM_API_URL}));
process.env.SWARM_DATA_DIR=mkdtempSync(join(tmpdir(),'swarm-cashfree-trace-'));
delete process.env.DATABASE_URL;delete process.env.SWARM_DATABASE_URL;
process.env.SWARM_PUBLIC_URL ||= 'http://127.0.0.1:3000';
process.env.SWARM_PRO_BUILDS ||= '1';process.env.SWARM_PRO_CHATS ||= '1'; // Isolated fixture, never a launch quota.
process.env.CLERK_SECRET_KEY ||= 'isolated-device-auth-fixture';
const {handleApi,accountDatabase}=await import('../lib/server/backend');
const {issueDevice}=await import('../lib/server/accounts');
const owner='sandbox-trace-'+randomUUID(),token=await issueDevice(accountDatabase(),owner,'isolated cashfree diagnostics');
const transport=globalThis.fetch;
globalThis.fetch=async(input:any,init?:RequestInit)=>{
  const url=new URL(String(input));
  if(url.hostname==='sandbox.cashfree.com'){
    const headers=new Headers(init?.headers);
    console.log(JSON.stringify({stage:'outgoing-http',method:init?.method,hostname:url.hostname,path:url.pathname,apiVersion:headers.get('x-api-version'),redirect:init?.redirect,clientIdPresent:!!headers.get('x-client-id'),clientSecretPresent:!!headers.get('x-client-secret'),authorizationHeaderPresent:headers.has('authorization')}));
  }
  return transport(input,init);
};
try{
  const response=await handleApi(new Request('http://127.0.0.1:3000/api/billing/checkout',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({plan:'pro',requestId:randomUUID(),phone:'9876543210'})}),['billing','checkout']);
  const result=await response.json();
  console.log(JSON.stringify({stage:'checkout-route',appStatus:response.status,code:result.code||null,orderCreated:response.ok&&!!result.orderId,sessionCreated:response.ok&&!!result.paymentSessionId,mode:result.mode||null}));
  const {accountUsage}=await import('../lib/server/entitlements');
  console.log(JSON.stringify({stage:'entitlement',plan:(await accountUsage(accountDatabase(),owner)).plan.id}));
  if(!response.ok)process.exitCode=1;
}finally{globalThis.fetch=transport;await accountDatabase().close();}
