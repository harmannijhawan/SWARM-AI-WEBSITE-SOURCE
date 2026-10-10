// Read-only authentication check. Never creates an order or payment, or prints secrets.
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const inherited={...process.env};
const nextEnv=createRequire(require.resolve('next/package.json'))('@next/env');
const loaded=nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){console.error('Environment loading failed (details withheld).');}});
const {cashfreeEnvironment,cashfreeHeaders,cashfreeDiagnostic,CASHFREE_API_VERSION}=await import('../lib/server/cashfree');
const {mode,url}=cashfreeEnvironment();
for(const name of mode==='production'?['CASHFREE_CLIENT_ID','CASHFREE_CLIENT_SECRET']:['CASHFREE_SANDBOX_CLIENT_ID','CASHFREE_SANDBOX_CLIENT_SECRET'])console.log(JSON.stringify({name,present:!!process.env[name],source:Object.hasOwn(inherited,name)?'inherited process':loaded.loadedEnvFiles.find((file:any)=>Object.hasOwn(file.env||{},name))?.path||'absent'}));
const requestId=randomUUID();
try{
  const response=await fetch(url+'/orders/swarm_readonly_probe_'+randomUUID().slice(0,8),{headers:{...cashfreeHeaders(),'x-request-id':requestId},redirect:'error',signal:AbortSignal.timeout(20000)});
  const data=await response.json().catch(()=>null);
  console.log(JSON.stringify({stage:'read-only-authentication',mode,method:'GET',hostname:new URL(url).hostname,apiVersion:CASHFREE_API_VERSION,status:response.status,requestId,authenticatedOrderLookup:response.status===404&&data?.type!=='authentication_error',...(!response.ok?{diagnostic:cashfreeDiagnostic(response,data,requestId)}:{})}));
  if(response.status!==404)process.exitCode=1;
}catch{console.error('Cashfree read-only authentication check failed (details withheld).');process.exitCode=1;}
