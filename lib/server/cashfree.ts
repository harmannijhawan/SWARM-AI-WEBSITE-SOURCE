import { createHmac, timingSafeEqual, randomUUID, createHash } from 'node:crypto';
import { Storage } from './storage';
import { initializeAccount, managedTables, managedTransaction, ManagedError, planCatalog } from './entitlements';

type Order = { id: string; owner: string; request_key: string; amount: number; days: number; status: string; session: string | null; payment: string | null; created: number; fulfilled: number };
export function checkoutAvailable() {
  const pro = planCatalog().pro;
  return !!(process.env.CASHFREE_SANDBOX_CLIENT_ID && process.env.CASHFREE_SANDBOX_CLIENT_SECRET && pro.price && pro.builds && pro.chats && process.env.SWARM_PUBLIC_URL);
}
function headers() {
  if (!process.env.CASHFREE_SANDBOX_CLIENT_ID || !process.env.CASHFREE_SANDBOX_CLIENT_SECRET) throw new ManagedError(503, 'billing_unavailable', 'Sandbox checkout is not configured yet.');
  return { 'Content-Type': 'application/json', 'x-client-id': process.env.CASHFREE_SANDBOX_CLIENT_ID, 'x-client-secret': process.env.CASHFREE_SANDBOX_CLIENT_SECRET, 'x-api-version': '2026-01-01' };
}
async function cashfree(path: string, body?: unknown, key?: string) {
  // Intentionally no production URL or mode override. These builds cannot charge live accounts.
  let response: Response;
  try { response = await fetch('https://sandbox.cashfree.com/pg' + path, { method: body ? 'POST' : 'GET', headers: { ...headers(), ...(key ? { 'x-idempotency-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000), redirect: 'error' }); }
  catch (error) { if (error instanceof ManagedError) throw error; throw new ManagedError(503, 'billing_network', 'Cashfree sandbox is temporarily unavailable. Retry using the same order.'); }
  if (!response.ok) throw new ManagedError(502, 'billing_provider', 'Cashfree sandbox could not complete this request. Retry using the same order.');
  return response.json();
}
export async function createCheckout(db: Storage, owner: string, key: unknown, phone: unknown) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(key) || typeof phone !== 'string' || !/^[6-9][0-9]{9}$/.test(phone)) throw new ManagedError(400, 'checkout_input', 'Enter a valid Indian mobile number and request ID.');
  if (!checkoutAvailable()) throw new ManagedError(503, 'billing_unavailable', 'Sandbox checkout is awaiting merchant credentials and fair-use configuration.');
  const origin = new URL(process.env.SWARM_PUBLIC_URL!);
  if (origin.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(origin.hostname)) throw new ManagedError(503, 'billing_configuration', 'Checkout return URL is unavailable.');
  await initializeAccount(db, owner);
  const order = await managedTransaction(db, owner, async () => {
    const existing = await db.prepare('SELECT * FROM payment_orders WHERE owner=? AND request_key=?').get(owner, key) as Order | undefined;
    if (existing) return existing;
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM payment_orders WHERE owner=? AND created>?').get(owner, Date.now() - 3600000);
    if (Number(recent?.n) >= 5) throw new ManagedError(429, 'checkout_limit', 'Too many checkout attempts. Reuse an existing pending order.');
    const pro = planCatalog().pro;
    const next: Order = { id: 'swarm_' + randomUUID().replaceAll('-',''), owner, request_key: key, amount: pro.price!, days: pro.accessDays, status: 'pending', session: null, payment: null, created: Date.now(), fulfilled: 0 };
    await db.prepare('INSERT INTO payment_orders VALUES(?,?,?,?,?,?,?,?,?,?)').run(next.id, owner, key, next.amount, next.days, next.status, null, null, next.created, 0);
    return next;
  });
  if (!order.session && order.status === 'pending') {
    const keyHash = createHash('sha256').update(order.id).digest('hex');
    const idempotencyKey = `${keyHash.slice(0,8)}-${keyHash.slice(8,12)}-4${keyHash.slice(13,16)}-a${keyHash.slice(17,20)}-${keyHash.slice(20,32)}`;
    const result = await cashfree('/orders', { order_id: order.id, order_amount: order.amount / 100, order_currency: 'INR', customer_details: { customer_id: owner, customer_phone: phone }, order_meta: { return_url: origin.origin + '/app/settings?order_id=' + order.id } }, idempotencyKey);
    if (result.order_id !== order.id || typeof result.payment_session_id !== 'string') throw new ManagedError(502, 'billing_response', 'Sandbox checkout returned an invalid order.');
    order.session = result.payment_session_id;
    await db.prepare('UPDATE payment_orders SET session=? WHERE id=?').run(order.session, order.id);
  }
  return { orderId: order.id, paymentSessionId: order.session, status: order.status, mode: 'sandbox' };
}
export async function verifyOrder(db: Storage, owner: string, id: string) {
  await managedTables(db);
  const order = await db.prepare('SELECT * FROM payment_orders WHERE id=? AND owner=?').get(id, owner) as Order | undefined;
  if (!order) throw new ManagedError(404, 'order_missing', 'Payment order not found.');
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
  const secret = process.env.CASHFREE_SANDBOX_CLIENT_SECRET;
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
  if (await db.prepare('SELECT id FROM payment_events WHERE id=?').get(eventId)) return { received: true };
  const order = await db.prepare('SELECT owner FROM payment_orders WHERE id=?').get(id);
  if (!order) throw new ManagedError(404, 'webhook_order', 'Unknown payment order.');
  await verifyOrder(db, String(order.owner), id); // A signed notification alone never grants Pro.
  await db.prepare('INSERT OR IGNORE INTO payment_events VALUES(?,?,?)').run(eventId, id, Date.now());
  return { received: true };
}
