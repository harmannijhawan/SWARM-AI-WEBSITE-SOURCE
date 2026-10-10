import { createHash } from 'node:crypto';
import { Storage, storageContext } from './storage';

export class ManagedError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const integer = (name: string, fallback: number) => {
  const n = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1) throw new ManagedError(503, 'configuration', 'SWARM plan configuration is unavailable.');
  return n;
};
export function planCatalog() {
  const days = integer('SWARM_ALLOWANCE_DAYS', 30);
  const price = Number(process.env.SWARM_PRO_PRICE_PAISE || 69900);
  const configuredLimit = (name: string) => process.env[name] ? integer(name, 1) : null;
  return {
    free: { id: 'free', builds: integer('SWARM_FREE_BUILDS', 5), chats: integer('SWARM_FREE_CHATS', 2), days, premium: false, concurrency: 1 },
    pro: { id: 'pro', builds: configuredLimit('SWARM_PRO_BUILDS'), chats: configuredLimit('SWARM_PRO_CHATS'), days, premium: true, concurrency: integer('SWARM_PRO_CONCURRENCY', 4),
      price: Number.isSafeInteger(price) && price >= 100 ? price : null, currency: 'INR', accessDays: integer('SWARM_PRO_ACCESS_DAYS', 30), renewal: 'manual' },
  };
}
export type Entitlement = { owner: string; created: number; pro_until: number; profile: 'swe' | 'flash' | 'premium'; speed: 'fast' | 'balanced' | 'quality' };
const ready = new WeakMap<Storage, Promise<void>>();
export async function managedTables(db: Storage) {
  if (!ready.has(db)) ready.set(db, db.exec(`
    CREATE TABLE IF NOT EXISTS entitlements(owner TEXT PRIMARY KEY,created INTEGER NOT NULL,pro_until INTEGER NOT NULL,profile TEXT NOT NULL,speed TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS usage_ledger(owner TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,period INTEGER NOT NULL,state TEXT NOT NULL,fingerprint TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner,id));
    CREATE INDEX IF NOT EXISTS usage_owner_period ON usage_ledger(owner,period,state);
    CREATE TABLE IF NOT EXISTS payment_orders(id TEXT PRIMARY KEY,owner TEXT NOT NULL,request_key TEXT NOT NULL,amount INTEGER NOT NULL,days INTEGER NOT NULL,status TEXT NOT NULL,session TEXT,payment TEXT,created INTEGER NOT NULL,fulfilled INTEGER NOT NULL,UNIQUE(owner,request_key));
    CREATE TABLE IF NOT EXISTS payment_events(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,created INTEGER NOT NULL);
  `));
  await ready.get(db);
}
export async function initializeAccount(db: Storage, owner: string): Promise<Entitlement> {
  await managedTables(db);
  await db.prepare("INSERT OR IGNORE INTO entitlements VALUES(?,?,0,'swe','balanced')").run(owner, Date.now());
  return await db.prepare('SELECT * FROM entitlements WHERE owner=?').get(owner) as Entitlement;
}
export async function accountUsage(db: Storage, owner: string) {
  const account = await initializeAccount(db, owner), catalog = planCatalog();
  const plan = account.pro_until > Date.now() ? catalog.pro : catalog.free;
  const duration = plan.days * 86400000;
  const period = account.created + Math.floor((Date.now() - account.created) / duration) * duration;
  const rows = await db.prepare("SELECT kind,COUNT(*) AS n FROM usage_ledger WHERE owner=? AND period=? AND state IN ('reserved','consumed') GROUP BY kind").all(owner, period);
  const count = (kind: string) => Number(rows.find(r => r.kind === kind)?.n || 0);
  return { account, plan, period, resetsAt: period + duration, builds: { used: count('build'), limit: plan.builds }, chats: { used: count('chat'), limit: plan.chats } };
}
export async function managedTransaction<T>(db: Storage, owner: string, fn: () => Promise<T>): Promise<T> {
  return storageContext(async () => {
    await db.exec('BEGIN IMMEDIATE');
    try { await db.lockOwner(owner); const result = await fn(); await db.exec('COMMIT'); return result; }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  });
}
export const fingerprint = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export async function reserveUsage(db: Storage, owner: string, id: string, kind: 'chat' | 'build', input: unknown) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new ManagedError(400, 'request_id', 'A valid request ID is required.');
  await initializeAccount(db, owner);
  return managedTransaction(db, owner, async () => {
    const previous = await db.prepare('SELECT state,fingerprint FROM usage_ledger WHERE owner=? AND id=?').get(owner, id);
    if (previous) throw new ManagedError(409, 'duplicate_request', 'This request ID was already used. Refresh your conversation before starting a new request.');
    const usage = await accountUsage(db, owner);
    const quota = kind === 'build' ? usage.builds : usage.chats;
    if (quota.limit === null) throw new ManagedError(503, 'fair_use_unconfigured', 'SWARM Pro capacity is awaiting operator configuration.');
    if (quota.used >= quota.limit) throw new ManagedError(429, 'allowance_exhausted', 'Your SWARM allowance is exhausted. Upgrade or wait for the allowance reset.');
    const inFlight = await db.prepare("SELECT COUNT(*) AS n FROM usage_ledger WHERE owner=? AND state='reserved' AND created>?").get(owner, Date.now() - 360000);
    if (Number(inFlight?.n) >= usage.plan.concurrency) throw new ManagedError(429, 'concurrency', 'Wait for your current SWARM request to finish.');
    const attempts = await db.prepare('SELECT COUNT(*) AS n FROM usage_ledger WHERE owner=? AND created>?').get(owner, Date.now() - 3600000);
    if (Number(attempts?.n) >= integer('SWARM_HOURLY_REQUESTS', 60)) throw new ManagedError(429, 'rate_limit', 'Too many requests. Please retry later.');
    await db.prepare("INSERT INTO usage_ledger VALUES(?,?,?,?,'reserved',?,?)").run(owner, id, kind, usage.period, fingerprint(input), Date.now());
    return id;
  });
}
export async function settleUsage(db: Storage, owner: string, id: string, success: boolean) {
  await db.prepare("UPDATE usage_ledger SET state=? WHERE owner=? AND id=? AND state='reserved'").run(success ? 'consumed' : 'failed', owner, id);
}
export async function saveManagedPreferences(db: Storage, owner: string, profile: unknown, speed: unknown) {
  if (!['swe','flash','premium'].includes(String(profile)) || !['fast','balanced','quality'].includes(String(speed))) throw new ManagedError(400, 'preferences', 'Choose a supported SWARM profile and speed.');
  const usage = await accountUsage(db, owner);
  if (profile === 'premium' && !usage.plan.premium) throw new ManagedError(403, 'premium_required', 'SWARM Premium requires Pro.');
  await db.prepare('UPDATE entitlements SET profile=?,speed=? WHERE owner=?').run(profile, speed, owner);
  return accountUsage(db, owner);
}
