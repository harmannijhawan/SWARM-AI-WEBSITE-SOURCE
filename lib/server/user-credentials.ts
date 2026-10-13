import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { ManagedError } from './entitlements';
import type { Storage } from './storage';
import { adapters } from './providers';
import type { ProviderConfig } from './desktop-providers/types';
// The service decrypts keys only to call the chosen provider. Keys are never returned
// to clients; all signed-in devices use this account-scoped service over TLS.
export type CredentialMeta = { hint: string; keyTag: string; updatedAt: number };
/** Masked hint stored beside the ciphertext at write time. Never contains more than the last 4 characters. */
export function maskKey(apiKey: string) { return '••••' + apiKey.slice(-4); }
/** Keyed, non-reversible tag used to match a stored key with a previous connection test. */
export function keyTag(secret: Buffer, owner: string, provider: string, apiKey: string) {
  return createHmac('sha256', secret).update(JSON.stringify([owner, provider, apiKey])).digest('base64url').slice(0, 32);
}
export function validateKeyInput(provider: string, apiKey: unknown, accountId?: unknown) {
  const adapter = adapters.find(a => a.id === provider);
  if (!adapter) throw new ManagedError(400, 'provider', 'Choose a supported provider.');
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 4096 || /[\s\x00-\x1f\x7f]/.test(apiKey)) throw new ManagedError(400, 'credential', 'Enter a valid provider key without whitespace.');
  if (adapter.needsAccountId && (typeof accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(accountId))) throw new ManagedError(400, 'account_id', 'This provider requires an account ID.');
  return adapter;
}
export async function writeCredential(db: Storage, secret: Buffer, owner: string, provider: string, apiKey: unknown, accountId?: unknown) {
  const adapter = adapters.find(a => a.id === provider);
  if (!adapter) throw new ManagedError(400, 'provider', 'Choose a supported provider.');
  if (apiKey === null) { await db.prepare('DELETE FROM credentials WHERE owner=? AND provider=?').run(owner, provider); return; }
  validateKeyInput(provider, apiKey, accountId);
  const key = apiKey as string;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([owner, provider])));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ apiKey: key, accountId: adapter.needsAccountId ? accountId : null })), cipher.final()]);
  const data = JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64'), hint: maskKey(key), keyTag: keyTag(secret, owner, provider, key), updatedAt: Date.now() });
  await db.prepare('INSERT OR REPLACE INTO credentials(owner,provider,data) VALUES(?,?,?)').run(owner, provider, data);
}
export async function readCredential(db: Storage, secret: Buffer, owner: string, provider: string): Promise<ProviderConfig | null> {
  const adapter = adapters.find(a => a.id === provider);
  if (!adapter) return null;
  const row = await db.prepare('SELECT data FROM credentials WHERE owner=? AND provider=?').get(owner, provider);
  if (!row) return null;
  try {
    const data = JSON.parse(String(row.data));
    if (data.v !== 1) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', secret, Buffer.from(data.iv, 'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify([owner, provider])));
    decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
    const config = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.ciphertext, 'base64')), decipher.final()]).toString());
    return { ...config, baseUrl: adapter.defaultBaseUrl };
  } catch { throw new ManagedError(503, 'credential_storage', 'A saved provider key could not be decrypted. Save that key again in settings.'); }
}
/** Non-secret metadata only; never decrypts. */
export async function readCredentialMeta(db: Storage, owner: string, provider: string): Promise<CredentialMeta | null> {
  const row = await db.prepare('SELECT data FROM credentials WHERE owner=? AND provider=?').get(owner, provider);
  if (!row) return null;
  try {
    const data = JSON.parse(String(row.data));
    return { hint: typeof data.hint === 'string' ? data.hint : '••••', keyTag: typeof data.keyTag === 'string' ? data.keyTag : '', updatedAt: Number(data.updatedAt) || 0 };
  } catch { return { hint: '••••', keyTag: '', updatedAt: 0 }; }
}
export async function credentialProviders(db: Storage, owner: string): Promise<Set<string>> {
  const rows = await db.prepare('SELECT provider FROM credentials WHERE owner=?').all(owner);
  return new Set(rows.map(r => String(r.provider)));
}
