import { createHmac, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { Storage } from './storage';
import { initializeAccount, managedTables, managedTransaction, ManagedError, planCatalog } from './entitlements';

type Order = { id: string; owner: string; request_key: string; amount: number; days: number; status: string; session: string | null; payment: string | null; created: number; fulfilled: number };
export function checkoutAvailable() {
  const pro = planCatalog().pro;
  try { const credentials=cashfreeCredentials();return !!(credentials.id && credentials.secret && pro.price && pro.builds && pro.chats && process.env.SWARM_PUBLIC_URL); } catch { return false; }
}
export const CASHFREE_SANDBOX_URL = 'https://sandbox.cashfree.com/pg';
export const CASHFREE_API_VERSION = '2026-01-01';
export function cashfreeEnvironment() {
  const mode=process.env.CASHFREE_ENV || 'sandbox';
  if(mode!=='sandbox'&&mode!=='production')throw new ManagedError(503,'billing_configuration','CASHFREE_ENV must be sandbox or production.');
  return {mode,url:mode==='production'?'https://api.cashfree.com/pg':CASHFREE_SANDBOX_URL} as const;
}
function cashfreeCredentials() {
  const {mode}=cashfreeEnvironment();
  return mode==='production'
    ? {id:process.env.CASHFREE_CLIENT_ID,secret:process.env.CASHFREE_CLIENT_SECRET}
    : {id:process.env.CASHFREE_SANDBOX_CLIENT_ID,secret:process.env.CASHFREE_SANDBOX_CLIENT_SECRET};
}
export function cashfreeHeaders() {
  const {id,secret}=cashfreeCredentials();
  if (!id || !secret) throw new ManagedError(503, 'billing_unavailable', 'Cashfree credentials for the selected environment are not configured.');
  return { 'Content-Type': 'application/json', 'x-client-id': id, 'x-client-secret': secret, 'x-api-version': CASHFREE_API_VERSION };
}
export type CashfreeDiagnostic = { source: 'cashfree'; status: number; hostname: string; apiVersion: string; requestId: string; correlationId: string | null; code: string | null; type: string | null; message: string };
export class CashfreeError extends ManagedError {
  constructor(public diagnostic: CashfreeDiagnostic) {
    super(502, diagnostic.status === 401 ? 'billing_authentication' : 'billing_provider', diagnostic.status === 401 ? 'Cashfree rejected backend authentication. Contact the SWARM operator with request ID ' + diagnostic.requestId + '.' : 'Cashfree could not complete this request. Retry using the same order. Request ID: ' + diagnostic.requestId);
  }
}
export function cashfreeDiagnostic(response: Response, data: any, requestId: string): CashfreeDiagnostic {
  // Do not log arbitrary provider text: it may echo credentials or customer fields.
  const correlation = response.headers.get('x-request-id');
  const credentials=cashfreeCredentials();
  const safeCorrelation = correlation && /^[a-f0-9-]{32,36}$/i.test(correlation) && ![credentials.id,credentials.secret].includes(correlation) ? correlation : null;
  const codes=['request_failed','something_not_found','order_already_exists','request_invalid','internal_error'];
  const types=['authentication_error','invalid_request_error','idempotency_error','rate_limit_error','api_error'];
  return {source:'cashfree',status:response.status,hostname:new URL(cashfreeEnvironment().url).hostname,apiVersion:CASHFREE_API_VERSION,requestId,correlationId:safeCorrelation,code:codes.includes(data?.code)?data.code:null,type:types.includes(data?.type)?data.type:null,message:data?.message === 'authentication Failed' ? 'authentication Failed' : 'Cashfree rejected the request (response details withheld).'};
}
async function cashfree(path: string, body?: unknown, key?: string) {
  // Only fixed official endpoints are permitted; mode is selected by the server.
  let response: Response;const requestId=randomUUID();
  try { response = await fetch(cashfreeEnvironment().url + path, { method: body ? 'POST' : 'GET', headers: { ...cashfreeHeaders(), 'x-request-id':requestId, ...(key ? { 'x-idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
  catch (error) { if (error instanceof ManagedError) throw error; throw new ManagedError(503, 'billing_network', 'Cashfree is temporarily unavailable. Retry using the same order.'); }
  if (!response.ok) {
    const diagnostic=cashfreeDiagnostic(response,await response.json().catch(()=>null),requestId);
    console.warn('swarm.cashfree.failure',diagnostic);throw new CashfreeError(diagnostic);
  }
  return response.json();
}
export async function createCheckout(db: Storage, owner: string, key: unknown, phone: unknown) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(key) || typeof phone !== 'string' || !/^[6-9][0-9]{9}$/.test(phone)) throw new ManagedError(400, 'checkout_input', 'Enter a valid Indian mobile number and request ID.');
  if (!checkoutAvailable()) throw new ManagedError(503, 'billing_unavailable', 'Checkout is awaiting merchant credentials and fair-use configuration.');
  const {mode}=cashfreeEnvironment();
  const origin = new URL(process.env.SWARM_PUBLIC_URL!);
  if (origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||(origin.protocol!=='https:'&&!(mode==='sandbox'&&origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname)))) throw new ManagedError(503, 'billing_configuration', 'Checkout requires a valid public HTTPS origin (local HTTP is allowed only in sandbox).');
  await initializeAccount(db, owner);
  const order = await managedTransaction(db, owner, async () => {
    const existing = await db.prepare('SELECT * FROM payment_orders WHERE owner=? AND request_key=?').get(owner, key) as Order | undefined;
    if (existing) { await assertOrderEnvironment(db,existing.id);return existing; }
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM payment_orders WHERE owner=? AND created>?').get(owner, Date.now() - 3600000);
    if (Number(recent?.n) >= 5) throw new ManagedError(429, 'checkout_limit', 'Too many checkout attempts. Reuse an existing pending order.');
    const pro = planCatalog().pro;
    const next: Order = { id: 'swarm_' + randomUUID().replaceAll('-',''), owner, request_key: key, amount: pro.price!, days: pro.accessDays, status: 'pending', session: null, payment: null, created: Date.now(), fulfilled: 0 };
    await db.prepare('INSERT INTO payment_orders VALUES(?,?,?,?,?,?,?,?,?,?)').run(next.id, owner, key, next.amount, next.days, next.status, null, null, next.created, 0);
    await db.prepare('INSERT INTO payment_environments VALUES(?,?)').run(next.id,mode);
    return next;
  });
  if (!order.session && order.status === 'pending') {
    const keyHash = createHash('sha256').update(order.id).digest('hex');
    const idempotencyKey = `${keyHash.slice(0,8)}-${keyHash.slice(8,12)}-4${keyHash.slice(13,16)}-a${keyHash.slice(17,20)}-${keyHash.slice(20,32)}`;
    const result = await cashfree('/orders', { order_id: order.id, order_amount: order.amount / 100, order_currency: 'INR', customer_details: { customer_id: owner, customer_phone: phone }, order_meta: { return_url: origin.origin + '/app/settings?order_id=' + order.id } }, idempotencyKey);
    if (result.order_id !== order.id || typeof result.payment_session_id !== 'string') throw new ManagedError(502, 'billing_response', 'Cashfree checkout returned an invalid order.');
    order.session = result.payment_session_id;
    await db.prepare('UPDATE payment_orders SET session=? WHERE id=?').run(order.session, order.id);
  }
  return { orderId: order.id, paymentSessionId: order.session, status: order.status, mode };
}
async function assertOrderEnvironment(db:Storage,id:string) {
  const row=await db.prepare('SELECT mode FROM payment_environments WHERE id=?').get(id);
  // All orders created before explicit environment support were sandbox orders.
  if((row?.mode||'sandbox')!==cashfreeEnvironment().mode)throw new ManagedError(409,'billing_environment','This order belongs to a different payment environment.');
}
export async function verifyOrder(db: Storage, owner: string, id: string) {
  await managedTables(db);
  const order = await db.prepare('SELECT * FROM payment_orders WHERE id=? AND owner=?').get(id, owner) as Order | undefined;
  if (!order) throw new ManagedError(404, 'order_missing', 'Payment order not found.');
  await assertOrderEnvironment(db,id);
  const remote = await cashfree('/orders/' + encodeURIComponent(id));
  if (remote.order_id !== id || remote.customer_details?.customer_id !== owner || remote.order_currency !== 'INR' || Math.round(Number(remote.order_amount) * 100) !== order.amount) throw new ManagedError(502, 'payment_mismatch', 'Payment verification did not match this order.');
  const payments = await cashfree('/orders/' + encodeURIComponent(id) + '/payments');
  if (!Array.isArray(payments)) throw new ManagedError(502, 'payment_response', 'Payment status is unavailable.');
  const paid = payments.find(p => p.payment_status === 'SUCCESS' && p.payment_currency === 'INR' && Math.round(Number(p.payment_amount) * 100) === order.amount && p.cf_payment_id);
  const status = remote.order_status === 'PAID' && paid ? 'paid' : remote.order_status === 'TERMINATED' ? 'cancelled' : remote.order_status === 'EXPIRED' ? 'expired' : payments.some(p => p.payment_status === 'FAILED') ? 'failed' : payments.some(p => p.payment_status === 'USER_DROPPED') ? 'cancelled' : 'pending';
  await managedTransaction(db, owner, async () => {
    const current = await db.prepare('SELECT fulfilled FROM payment_orders WHERE id=?').get(id);
    if (current?.fulfilled) return; // Late failures and duplicate notifications cannot undo or extend a grant.
    if (status === 'paid') {
      const account = await initializeAccount(db, owner);
      const expires = Math.max(Date.now(), Number(account.pro_until)) + order.days * 86400000;
      await db.prepare('UPDATE entitlements SET pro_until=? WHERE owner=?').run(expires, owner);
      await db.prepare("UPDATE payment_orders SET status='paid',payment=?,fulfilled=? WHERE id=?").run(String(paid.cf_payment_id), Date.now(), id);
    } else await db.prepare('UPDATE payment_orders SET status=? WHERE id=?').run(status, id);
  });
  return db.prepare('SELECT id,amount,days,status,payment,created,fulfilled FROM payment_orders WHERE id=? AND owner=?').get(id, owner);
}
export function validSignature(raw: string, timestamp: string | null, signature: string | null) {
  const secret = cashfreeCredentials().secret;
  if (!secret || !timestamp || !signature) return false;
  const expected = createHmac('sha256', secret).update(timestamp + raw).digest('base64');
  const actual = Buffer.from(signature), correct = Buffer.from(expected);
  return actual.length === correct.length && timingSafeEqual(actual, correct);
}
export async function cashfreeWebhook(db: Storage, request: Request) {
  const raw = await request.text();
  if (raw.length > 100000 || !validSignature(raw, request.headers.get('x-webhook-timestamp'), request.headers.get('x-webhook-signature'))) throw new ManagedError(401, 'webhook_signature', 'Invalid webhook signature.');
  let event: any; try { event = JSON.parse(raw); } catch { throw new ManagedError(400, 'webhook_body', 'Invalid webhook body.'); }
  await managedTables(db);
  const id = event.data?.order?.order_id;
  if (typeof id !== 'string') throw new ManagedError(400, 'webhook_order', 'Missing payment order.');
  const eventId = createHash('sha256').update(raw).digest('hex');
  const order = await db.prepare('SELECT owner,status FROM payment_orders WHERE id=?').get(id);
  if (!order) throw new ManagedError(404, 'webhook_order', 'Unknown payment order.');
  if (order.status === 'paid' && await db.prepare('SELECT id FROM payment_events WHERE id=?').get(eventId)) return { received: true };
  const result = await verifyOrder(db, String(order.owner), id); // A signed notification alone never grants Pro.
  if (event.type === 'PAYMENT_SUCCESS_WEBHOOK' && result?.status !== 'paid') throw new ManagedError(503,'payment_pending','Authoritative payment confirmation is pending. Retry this notification.');
  await db.prepare('INSERT OR IGNORE INTO payment_events VALUES(?,?,?)').run(eventId, id, Date.now());
  return { received: true };
}
