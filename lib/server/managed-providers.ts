import { adapters, envNames } from './providers';
import { ManagedError, accountUsage } from './entitlements';
import type { Storage } from './storage';
import type { ProviderConfig, ChatMessage } from './desktop-providers/types';
import { ProviderError } from './desktop-providers/types';

// Explicit operator allowlists are also the cost boundary. Discovery alone grants no access.
export function modelPolicy() {
  const read = (name: string) => (process.env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
  return { standard: read('SWARM_STANDARD_MODELS'), premium: read('SWARM_PREMIUM_MODELS') };
}
export function managedCredentials(provider: string): ProviderConfig | null {
  const adapter = adapters.find(a => a.id === provider);
  if (!adapter) return null;
  const apiKey = (envNames[provider] || []).map(name => process.env[name]).find(Boolean) || null;
  const accountId = provider === 'cloudflare' ? process.env.CLOUDFLARE_ACCOUNT_ID || null : null;
  return apiKey && (!adapter.needsAccountId || accountId) ? { apiKey, accountId, baseUrl: adapter.defaultBaseUrl } : null;
}
export async function eligibleModelIds(db: Storage, owner: string) {
  const usage = await accountUsage(db, owner), policy = modelPolicy();
  return usage.plan.premium ? [...policy.standard, ...policy.premium] : policy.standard;
}
export async function routingPolicy(db: Storage, owner: string) {
  const { account, plan } = await accountUsage(db, owner);
  if (account.profile === 'premium' && !plan.premium) throw new ManagedError(403, 'premium_required', 'Choose SWARM SWE or renew Pro to use Premium.');
  const policy = modelPolicy();
  const ids = account.profile === 'premium' ? policy.premium : policy.standard;
  const fast = plan.premium && (account.profile === 'flash' || account.speed === 'fast');
  const quality = account.profile === 'premium' || account.speed === 'quality';
  return { ids, routing: fast ? 'fastest' as const : quality ? 'quality' as const : 'auto' as const, reasoningEffort: fast ? 'low' as const : quality ? 'high' as const : 'medium' as const };
}
export function validateManagedMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || !value.length || value.length > 80) throw new ManagedError(400, 'messages', 'Invalid message list.');
  let length = 0, images = 0;
  for (const item of value) {
    if (!item || !['system','user','assistant'].includes(item.role)) throw new ManagedError(400, 'messages', 'Invalid message role.');
    if(typeof item.content==='string')length+=item.content.length;
    else if(Array.isArray(item.content)&&item.content.length<=10){
      for(const part of item.content){
        if(part?.type==='text'&&typeof part.text==='string')length+=part.text.length;
        else if(part?.type==='image'&&typeof part.dataUrl==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(part.dataUrl)&&part.dataUrl.length<=2000000){images++;}
        else throw new ManagedError(400,'messages','Unsupported message content.');
      }
    }else throw new ManagedError(400,'messages','Invalid message content.');
  }
  if (length > 100000 || images > 3) throw new ManagedError(413, 'context', 'The request exceeds the managed context allowance.');
  return value;
}
export function safeProviderFailure(error: unknown) {
  if (error instanceof ProviderError && ['quota','rate_limit'].includes(error.kind)) return 'SWARM provider capacity is temporarily limited. Please retry later.';
  return 'SWARM could not reach an eligible AI service. Your input is saved; please retry later.';
}
