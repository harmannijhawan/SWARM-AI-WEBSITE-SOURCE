import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {Storage} from '../lib/server/storage';
import {CASHFREE_API_VERSION,cashfreeHeaders,cashfreeDiagnostic,cashfreeEnvironment,createCheckout,verifyOrder,CashfreeError} from '../lib/server/cashfree';
import {accountUsage} from '../lib/server/entitlements';

// Set test data directory before importing backend
process.env.SWARM_DATA_DIR = mkdtempSync(join(tmpdir(),'swarm-cashfree-auth-'));

test('Next server env loading reads quoted local credentials and preserves inherited precedence',()=>{
  const dir=mkdtempSync(join(tmpdir(),'swarm-env-regression-'));
  const require=createRequire(import.meta.url),envModule=createRequire(require.resolve('next/package.json')).resolve('@next/env');
  try{
    writeFileSync(join(dir,'.env.local'),'CASHFREE_SANDBOX_CLIENT_ID="fixture-app"\nCASHFREE_SANDBOX_CLIENT_SECRET=\'fixture-secret\'\n');
    const childEnv:NodeJS.ProcessEnv={...process.env,NODE_ENV:'development'};
    delete childEnv.CASHFREE_SANDBOX_CLIENT_ID;delete childEnv.CASHFREE_SANDBOX_CLIENT_SECRET;delete childEnv.__NEXT_PROCESSED_ENV;
    const code=`const loader=require(${JSON.stringify(envModule)});const inherited=process.env.CASHFREE_SANDBOX_CLIENT_ID;loader.loadEnvConfig(process.cwd(),true,{info(){},error(){}});console.log(JSON.stringify({idCorrect:process.env.CASHFREE_SANDBOX_CLIENT_ID===(inherited||'fixture-app'),secretCorrect:process.env.CASHFREE_SANDBOX_CLIENT_SECRET==='fixture-secret'}));`;
    for(const env of [childEnv,{...childEnv,CASHFREE_SANDBOX_CLIENT_ID:'inherited-fixture'}]){
      const result=spawnSync(process.execPath,['-e',code],{cwd:dir,env,encoding:'utf8'});assert.equal(result.status,0);assert.deepEqual(JSON.parse(result.stdout),{idCorrect:true,secretCorrect:true});
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('sandbox client builds exact authentication headers; empty values fail before fetch',()=>{
  const id=process.env.CASHFREE_SANDBOX_CLIENT_ID,secret=process.env.CASHFREE_SANDBOX_CLIENT_SECRET;
  try{
    process.env.CASHFREE_SANDBOX_CLIENT_ID='fixture-app';process.env.CASHFREE_SANDBOX_CLIENT_SECRET='fixture-secret';
    const headers=new Headers(cashfreeHeaders());assert.equal(headers.get('x-client-id'),'fixture-app');assert.equal(headers.get('x-client-secret'),'fixture-secret');assert.equal(headers.get('x-api-version'),CASHFREE_API_VERSION);assert.equal(headers.get('authorization'),null);
    process.env.CASHFREE_SANDBOX_CLIENT_SECRET='';assert.throws(cashfreeHeaders,{status:503});
  }finally{if(id===undefined)delete process.env.CASHFREE_SANDBOX_CLIENT_ID;else process.env.CASHFREE_SANDBOX_CLIENT_ID=id;if(secret===undefined)delete process.env.CASHFREE_SANDBOX_CLIENT_SECRET;else process.env.CASHFREE_SANDBOX_CLIENT_SECRET=secret;}
});
test('Cashfree 401 is a sanitized upstream failure, never a SWARM login failure or Pro grant',async t=>{
  const db=new Storage(':memory:'),saved={...process.env};
  try{
    Object.assign(process.env,{CASHFREE_SANDBOX_CLIENT_ID:'fixture-app',CASHFREE_SANDBOX_CLIENT_SECRET:'fixture-secret',SWARM_PUBLIC_URL:'http://127.0.0.1:3000',SWARM_PRO_BUILDS:'1',SWARM_PRO_CHATS:'1',CASHFREE_ENV:'sandbox',CASHFREE_BASE_URL:'https://api.cashfree.com/pg'});
    t.mock.method(console,'warn',()=>{});
    t.mock.method(globalThis,'fetch',async(input:string,init:RequestInit)=>{
      assert.equal(input,'https://sandbox.cashfree.com/pg/orders');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
      const headers=new Headers(init.headers);assert.equal(headers.get('x-client-id'),'fixture-app');assert.equal(headers.get('x-client-secret'),'fixture-secret');assert.equal(headers.get('x-api-version'),'2026-01-01');assert.match(headers.get('x-request-id')!,/^[a-f0-9-]{36}$/);
      assert.equal(headers.get('authorization'),null);
      return Response.json({code:'request_failed',type:'authentication_error',message:'authentication Failed'},{status:401,headers:{'x-request-id':headers.get('x-request-id')!}});
    });
    await assert.rejects(createCheckout(db,'fixture-user','fixture-request','9876543210'),(error:CashfreeError)=>{
      assert(error instanceof CashfreeError);assert.equal(error.status,502);assert.equal(error.code,'billing_authentication');assert.equal(error.diagnostic.status,401);assert.equal(error.diagnostic.message,'authentication Failed');assert.equal(error.diagnostic.hostname,'sandbox.cashfree.com');assert(!JSON.stringify(error).includes('fixture-secret'));return true;
    });
    assert.equal((await accountUsage(db,'fixture-user')).plan.id,'free');
  }finally{await db.close();for(const name of ['CASHFREE_SANDBOX_CLIENT_ID','CASHFREE_SANDBOX_CLIENT_SECRET','SWARM_PUBLIC_URL','SWARM_PRO_BUILDS','SWARM_PRO_CHATS','CASHFREE_ENV','CASHFREE_BASE_URL']){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});
test('production selection uses production credentials and fixed endpoint; environments cannot share orders',async t=>{
  const db=new Storage(':memory:'),saved={...process.env};
  const names=['CASHFREE_ENV','CASHFREE_CLIENT_ID','CASHFREE_CLIENT_SECRET','CASHFREE_SANDBOX_CLIENT_ID','CASHFREE_SANDBOX_CLIENT_SECRET','SWARM_PUBLIC_URL','SWARM_PRO_BUILDS','SWARM_PRO_CHATS'];
  try{
    Object.assign(process.env,{CASHFREE_ENV:'production',CASHFREE_CLIENT_ID:'production-fixture-app',CASHFREE_CLIENT_SECRET:'production-fixture-secret',CASHFREE_SANDBOX_CLIENT_ID:'sandbox-fixture-app',CASHFREE_SANDBOX_CLIENT_SECRET:'sandbox-fixture-secret',SWARM_PUBLIC_URL:'https://swarm.example',SWARM_PRO_BUILDS:'1',SWARM_PRO_CHATS:'1'});
    assert.equal(cashfreeEnvironment().url,'https://api.cashfree.com/pg');
    assert.equal(cashfreeHeaders()['x-client-id'],'production-fixture-app');assert.equal(cashfreeHeaders()['x-client-secret'],'production-fixture-secret');
    const fetch=t.mock.method(globalThis,'fetch',async(input:string,init:RequestInit)=>{
      assert.equal(input,'https://api.cashfree.com/pg/orders');const headers=new Headers(init.headers);assert.equal(headers.get('x-client-id'),'production-fixture-app');assert.equal(headers.get('x-client-secret'),'production-fixture-secret');
      return Response.json({order_id:JSON.parse(String(init.body)).order_id,payment_session_id:'production-fixture-session'});
    });
    const order=await createCheckout(db,'production-fixture-owner','production-fixture-request','9876543210');assert.equal(order.mode,'production');assert.equal(fetch.mock.callCount(),1);
    process.env.SWARM_PUBLIC_URL='http://localhost:3000';await assert.rejects(createCheckout(db,'production-fixture-owner','invalid-return-request','9876543210'),{code:'billing_configuration'});
    process.env.CASHFREE_ENV='sandbox';process.env.SWARM_PUBLIC_URL='http://localhost:3000';
    await assert.rejects(verifyOrder(db,'production-fixture-owner',order.orderId),{code:'billing_environment'});
    await assert.rejects(createCheckout(db,'production-fixture-owner','production-fixture-request','9876543210'),{code:'billing_environment'});assert.equal(fetch.mock.callCount(),1);
    process.env.CASHFREE_ENV='production';delete process.env.CASHFREE_CLIENT_SECRET;assert.throws(cashfreeHeaders,{status:503});
    process.env.CASHFREE_ENV='typo';assert.throws(cashfreeEnvironment,{status:503});
  }finally{await db.close();for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});
test('diagnostics never log arbitrary echoed secrets, customer values or payloads',()=>{
  const data=cashfreeDiagnostic(new Response('',{status:401,headers:{'x-request-id':'9876543210'}}),{code:'9876543210',type:'customer-name',message:'fixture-secret customer@example.com 9876543210'},'safe-request-id');
  assert.equal(data.code,null);assert.equal(data.type,null);assert.equal(data.correlationId,null);assert(!JSON.stringify(data).includes('fixture-secret'));assert(!JSON.stringify(data).includes('9876543210'));assert(!JSON.stringify(data).includes('customer@example.com'));
});
test('checkout route distinguishes SWARM unauthenticated 401 from Cashfree authentication 502',async t=>{
  const saved={...process.env};
  try{
    const testDir=mkdtempSync(join(tmpdir(),'swarm-route-auth-'));
    Object.assign(process.env,{CLERK_SECRET_KEY:'fixture-device-only',SWARM_DATA_DIR:testDir,CASHFREE_SANDBOX_CLIENT_ID:'fixture-app',CASHFREE_SANDBOX_CLIENT_SECRET:'fixture-secret',SWARM_PUBLIC_URL:'http://127.0.0.1:3000',SWARM_PRO_BUILDS:'1',SWARM_PRO_CHATS:'1'});
    delete process.env.DATABASE_URL;delete process.env.SWARM_DATABASE_URL;
    // Clear module cache to reload with new environment
    delete require.cache[require.resolve('../lib/server/backend')];
    const {handleApi,accountDatabase}=await import('../lib/server/backend');const {issueDevice}=await import('../lib/server/accounts');
    t.mock.method(console,'warn',()=>{});
    t.mock.method(globalThis,'fetch',async()=>Response.json({code:'request_failed',type:'authentication_error',message:'authentication Failed'},{status:401}));
    const payload=JSON.stringify({plan:'pro',requestId:'route-fixture-order',phone:'9876543210'});
    const unauthorized=await handleApi(new Request('http://localhost/api/billing/checkout',{method:'POST',body:payload}),['billing','checkout']);
    assert.equal(unauthorized.status,401);
    const token=await issueDevice(accountDatabase(),'route-fixture-owner','fixture');
    const upstream=await handleApi(new Request('http://localhost/api/billing/checkout',{method:'POST',body:payload,headers:{Authorization:'Bearer '+token}}),['billing','checkout']);
    assert.equal(upstream.status,502);assert.equal((await upstream.json()).code,'billing_authentication');
    await accountDatabase().close();
  }finally{for(const name of ['CLERK_SECRET_KEY','SWARM_DATA_DIR','DATABASE_URL','SWARM_DATABASE_URL','CASHFREE_SANDBOX_CLIENT_ID','CASHFREE_SANDBOX_CLIENT_SECRET','SWARM_PUBLIC_URL','SWARM_PRO_BUILDS','SWARM_PRO_CHATS']){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}}
});
