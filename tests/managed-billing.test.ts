import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Storage, postgresSql } from '../lib/server/storage';
import { accountUsage, initializeAccount, planCatalog, reserveUsage, settleUsage, saveManagedPreferences } from '../lib/server/entitlements';
import { createCheckout, verifyOrder, cashfreeWebhook, validSignature } from '../lib/server/cashfree';

process.env.SWARM_PRO_BUILDS = '100'; // Test fixture values, not launch fair-use commitments.
process.env.SWARM_PRO_CHATS = '500';
process.env.CASHFREE_SANDBOX_CLIENT_ID = 'sandbox-test-id';
process.env.CASHFREE_ENV = 'sandbox';
process.env.CASHFREE_SANDBOX_CLIENT_SECRET = 'sandbox-test-secret';
process.env.SWARM_PUBLIC_URL = 'http://localhost:3000';
const fresh = () => new Storage(':memory:');

test('new accounts receive Free, launch quotas and default preferences without provider credentials', async () => {
  const db = fresh();try {
    const account = await initializeAccount(db,'new-user'), usage = await accountUsage(db,'new-user');
    assert.equal(account.profile,'swe');assert.equal(account.speed,'balanced');assert.equal(usage.plan.id,'free');
    assert.deepEqual(usage.builds,{used:0,limit:5});assert.deepEqual(usage.chats,{used:0,limit:2});
    assert.equal((await initializeAccount(db,'new-user')).created,account.created);
    assert.equal(planCatalog().pro.price,69900);assert.equal(planCatalog().pro.accessDays,30);
  } finally { await db.close(); }
});
test('atomic reservations prevent simultaneous quota and concurrency bypass; failed requests release allowance', async () => {
  const db=fresh();try {
    await initializeAccount(db,'alice');
    const results=await Promise.allSettled(Array.from({length:8},(_,i)=>reserveUsage(db,'alice','request-'+i,'chat',{i})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const first=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<string>).value;
    await settleUsage(db,'alice',first,false);assert.equal((await accountUsage(db,'alice')).chats.used,0);
    await reserveUsage(db,'alice','successful-1','chat',{});await settleUsage(db,'alice','successful-1',true);
    await reserveUsage(db,'alice','successful-2','chat',{});await settleUsage(db,'alice','successful-2',true);
    await assert.rejects(reserveUsage(db,'alice','third','chat',{}),{status:429,code:'allowance_exhausted'});
    assert.equal((await accountUsage(db,'bob')).chats.used,0);
  }finally{await db.close();}
});
test('duplicate usage IDs cannot charge twice and reset uses server time',async()=>{
  const db=fresh(),original=Date.now;try{
    await reserveUsage(db,'alice','original','build',{});await settleUsage(db,'alice','original',true);
    await assert.rejects(reserveUsage(db,'alice','original','build',{}),{status:409});
    const before=await accountUsage(db,'alice');assert.equal(before.builds.used,1);
    Date.now=()=>before.resetsAt+1;assert.equal((await accountUsage(db,'alice')).builds.used,0);
  }finally{Date.now=original;await db.close();}
});
test('Premium selection rejects Free and expired Pro while preserving account and preferences',async()=>{
  const db=fresh();try{
    const original=await initializeAccount(db,'alice');
    await assert.rejects(saveManagedPreferences(db,'alice','premium','quality'),{status:403});
    await db.prepare('UPDATE entitlements SET pro_until=? WHERE owner=?').run(Date.now()+10000,'alice');
    await saveManagedPreferences(db,'alice','premium','quality');
    await db.prepare('UPDATE entitlements SET pro_until=? WHERE owner=?').run(Date.now()-1,'alice');
    const usage=await accountUsage(db,'alice');assert.equal(usage.plan.id,'free');assert.equal(usage.account.created,original.created);assert.equal(usage.account.profile,'premium');
    await assert.rejects(saveManagedPreferences(db,'alice','premium','quality'),{status:403});
  }finally{await db.close();}
});

type Remote={id:string;owner:string;amount:number;status:string;payments:any[]};
function gateway(t:any) {
  const orders=new Map<string,Remote>(), requests:{url:string;body:any;key:string|null}[]=[];
  t.mock.method(globalThis,'fetch',async (input:string,init?:RequestInit)=>{
    const url=new URL(String(input));assert.equal(url.origin,'https://sandbox.cashfree.com');
    const body=init?.body?JSON.parse(String(init.body)):null;
    const header=new Headers(init?.headers);requests.push({url:url.href,body,key:header.get('x-idempotency-key')});
    if(body){
      orders.set(body.order_id,{id:body.order_id,owner:body.customer_details.customer_id,amount:body.order_amount,status:'ACTIVE',payments:[]});
      return Response.json({order_id:body.order_id,payment_session_id:'fixture-session-'+body.order_id});
    }
    const parts=url.pathname.split('/'),remote=orders.get(parts[3]);assert(remote);
    return Response.json(parts[4]==='payments'?remote.payments:{order_id:remote.id,customer_details:{customer_id:remote.owner},order_currency:'INR',order_amount:remote.amount,order_status:remote.status});
  });
  return {orders,requests};
}
const paid=(remote:Remote)=>{remote.status='PAID';remote.payments=[{payment_status:'SUCCESS',payment_currency:'INR',payment_amount:699,cf_payment_id:'fixture-payment'}];};
function webhook(id:string,valid=true){
  const raw=JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:id}}}),timestamp=String(Date.now());
  const signature=createHmac('sha256',process.env.CASHFREE_SANDBOX_CLIENT_SECRET!).update(timestamp+raw).digest('base64');
  return new Request('http://localhost:3000/api/billing/webhook',{method:'POST',headers:{'x-webhook-timestamp':timestamp,'x-webhook-signature':valid?signature:'invalid'},body:raw});
}
test('sandbox checkout uses server ₹699 price, same customer ID and stable order idempotency',async t=>{
  const db=fresh(),cf=gateway(t);try{
    const first=await createCheckout(db,'alice','checkout-request','9999999999'),again=await createCheckout(db,'alice','checkout-request','9999999999');
    assert.equal(first.orderId,again.orderId);assert.equal(first.mode,'sandbox');assert.equal(cf.requests.length,1);
    assert.equal(cf.requests[0].body.order_amount,699);assert.equal(cf.requests[0].body.customer_details.customer_id,'alice');assert.match(cf.requests[0].key!,/^[a-f0-9-]{36}$/);
    assert.equal((await accountUsage(db,'alice')).plan.id,'free');
  }finally{await db.close();}
});
test('verified success grants exactly 30 days; concurrent duplicate verification cannot extend entitlement',async t=>{
  const db=fresh(),cf=gateway(t);try{
    const original=await initializeAccount(db,'alice');await saveManagedPreferences(db,'alice','flash','fast');
    const order=await createCheckout(db,'alice','paid-request','9999999999');paid(cf.orders.get(order.orderId)!);
    const start=Date.now();await Promise.all([verifyOrder(db,'alice',order.orderId),verifyOrder(db,'alice',order.orderId)]);
    const usage=await accountUsage(db,'alice');assert.equal(usage.plan.id,'pro');assert.equal(usage.account.created,original.created);
    assert.equal(usage.account.profile,'flash');assert.equal(usage.account.speed,'fast');
    assert(usage.account.pro_until>=start+30*86400000&&usage.account.pro_until<=Date.now()+30*86400000);
    const expiry=usage.account.pro_until;await verifyOrder(db,'alice',order.orderId);assert.equal((await accountUsage(db,'alice')).account.pro_until,expiry);
    await assert.rejects(verifyOrder(db,'bob',order.orderId),{status:404});
  }finally{await db.close();}
});
test('signed duplicate webhooks fulfill once, reject bad signatures, and ignore out-of-order failures',async t=>{
  const db=fresh(),cf=gateway(t);try{
    const order=await createCheckout(db,'alice','webhook-request','9999999999'),remote=cf.orders.get(order.orderId)!;paid(remote);
    await assert.rejects(cashfreeWebhook(db,webhook(order.orderId,false)),{status:401});assert.equal((await accountUsage(db,'alice')).plan.id,'free');
    await cashfreeWebhook(db,webhook(order.orderId));const expiry=(await accountUsage(db,'alice')).account.pro_until;
    await cashfreeWebhook(db,webhook(order.orderId));assert.equal((await accountUsage(db,'alice')).account.pro_until,expiry);
    remote.status='ACTIVE';remote.payments=[{payment_status:'FAILED'}];await verifyOrder(db,'alice',order.orderId);
    assert.equal((await accountUsage(db,'alice')).account.pro_until,expiry);assert.equal((await db.prepare('SELECT status FROM payment_orders WHERE id=?').get(order.orderId))?.status,'paid');
  }finally{await db.close();}
});
test('pending, failed, dropped, cancelled and expired payments never grant Pro',async t=>{
  const db=fresh(),cf=gateway(t);try{
    for(const [i,orderStatus,paymentStatus,expected] of [[0,'ACTIVE','PENDING','pending'],[1,'ACTIVE','FAILED','failed'],[2,'ACTIVE','USER_DROPPED','cancelled'],[3,'TERMINATED','PENDING','cancelled'],[4,'EXPIRED','PENDING','expired']] as const){
      const owner='user-'+i,order=await createCheckout(db,owner,'request-'+i,'9999999999'),remote=cf.orders.get(order.orderId)!;
      remote.status=orderStatus;remote.payments=[{payment_status:paymentStatus}];const result=await verifyOrder(db,owner,order.orderId);
      assert.equal(result?.status,expected);assert.equal((await accountUsage(db,owner)).plan.id,'free');
    }
  }finally{await db.close();}
});
test('amount and customer mismatches reject payment fulfillment',async t=>{
  const db=fresh(),cf=gateway(t);try{
    const order=await createCheckout(db,'alice','mismatch-request','9999999999'),remote=cf.orders.get(order.orderId)!;paid(remote);
    remote.amount=1;await assert.rejects(verifyOrder(db,'alice',order.orderId),{code:'payment_mismatch'});
    remote.amount=699;remote.owner='bob';await assert.rejects(verifyOrder(db,'alice',order.orderId),{code:'payment_mismatch'});
    assert.equal((await accountUsage(db,'alice')).plan.id,'free');
  }finally{await db.close();}
});
test('missing sandbox credentials block checkout and no signature works with a different raw body',async()=>{
  const db=fresh(),secret=process.env.CASHFREE_SANDBOX_CLIENT_SECRET;try{
    delete process.env.CASHFREE_SANDBOX_CLIENT_SECRET;await assert.rejects(createCheckout(db,'alice','blocked-request','9999999999'),{status:503});
    process.env.CASHFREE_SANDBOX_CLIENT_SECRET=secret;const signed=createHmac('sha256',secret!).update('123{}').digest('base64');
    assert(validSignature('{}','123',signed));assert(!validSignature('{ }','123',signed));
  }finally{process.env.CASHFREE_SANDBOX_CLIENT_SECRET=secret;await db.close();}
});
test('success notification waits for authoritative confirmation and can be retried',async t=>{
  const db=fresh(),cf=gateway(t);try{
    const order=await createCheckout(db,'alice','delayed-confirmation','9999999999');
    await assert.rejects(cashfreeWebhook(db,webhook(order.orderId)),{status:503,code:'payment_pending'});
    assert.equal((await accountUsage(db,'alice')).plan.id,'free');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM payment_events').get())?.n,0);
    paid(cf.orders.get(order.orderId)!);await cashfreeWebhook(db,webhook(order.orderId));
    assert.equal((await accountUsage(db,'alice')).plan.id,'pro');
  }finally{await db.close();}
});
test('managed schema maps safely to existing Postgres namespace',()=>{
  assert.match(postgresSql('SELECT pro_until FROM entitlements WHERE owner=?'),/swarm_entitlements WHERE owner=\$1/);
  assert.match(postgresSql('INSERT OR IGNORE INTO payment_events VALUES(?,?,?)'),/swarm_payment_events VALUES\(\$1,\$2,\$3\) ON CONFLICT DO NOTHING/);
});
