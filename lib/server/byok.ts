// BYOK connection testing (docs/SWARM_PLATFORM_SPEC.md §2, §3). No logging of keys or upstream bodies.
import { fetchJson } from './desktop-providers/http';
import { ProviderError, type DiscoveredModel, type ProviderAdapter, type ProviderConfig } from './desktop-providers/types';
import { catalogEntry, type ConnectionStatus, type ConnectionTestResult } from '../../shared/providers';

const KEY_SHAPED = /(AIza[0-9A-Za-z_-]{10,}|gsk_[0-9A-Za-z]{8,}|hf_[0-9A-Za-z]{8,}|nvapi-[0-9A-Za-z_-]{8,}|sk-or-[0-9A-Za-z_-]{8,}|sk-[0-9A-Za-z_-]{12,}|Bearer\s+\S+|\b[A-Za-z0-9]{32,}\b)/g;
/** Strips anything key-shaped and caps provider text at 200 characters. */
export function sanitizeMessage(text: string, secrets: (string | null | undefined)[] = []) {
  let out = String(text);
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  out = out.replace(KEY_SHAPED, '[redacted]').replace(/\s+/g, ' ').trim();
  return out.length > 200 ? out.slice(0, 199) + '…' : out;
}

/** Maps a provider failure to the shared status vocabulary (§2). */
export function statusForError(error: unknown): ConnectionStatus {
  if (!(error instanceof ProviderError)) return 'network_error';
  if (error.kind === 'auth') return 'auth_failed';
  if (error.kind === 'rate_limit' || error.kind === 'quota') return 'rate_limited';
  if (error.kind === 'not_found' || error.kind === 'unsupported' || error.kind === 'bad_request' || error.kind === 'invalid' || error.kind === 'context') return 'no_models';
  return 'network_error';
}

function messageFor(status: ConnectionStatus, provider: string, extra: { models?: number; usableModel?: string | null; latencyMs?: number | null; retryAfterMs?: number }) {
  const name = catalogEntry(provider)?.name || provider;
  switch (status) {
    case 'connected': return `Connected. ${extra.models} chat models found; ${extra.usableModel} answered a test request in ${extra.latencyMs} ms.`;
    case 'auth_failed': return provider === 'huggingface'
      ? 'Hugging Face rejected this token. Fine-grained tokens need the "Make calls to Inference Providers" permission.'
      : `${name} rejected this key. Check that it was copied completely and is still active.`;
    case 'rate_limited': return `${name} rate limited this key or its quota is used up.${extra.retryAfterMs ? ` Retry in about ${Math.ceil(extra.retryAfterMs / 1000)} s.` : ' Retry later.'}`;
    case 'no_models': return `The key works, but ${name} reported no compatible chat models for it.`;
    case 'network_error': return `Couldn't reach ${name}. Check your connection and retry.`;
    default: return '';
  }
}

const SMALL = /flash|mini|small|instant|8b|lite/i;
/** Free first (OpenRouter ":free" / verified free), then small/fast names, then everything else. */
export function probeCandidates(models: DiscoveredModel[], limit = 3) {
  const rank = (m: DiscoveredModel) => (m.freeStatus === 'free' || m.modelId.endsWith(':free') ? 0 : SMALL.test(m.modelId) ? 1 : 2);
  return [...models].map((m, i) => ({ m, i })).sort((a, b) => rank(a.m) - rank(b.m) || a.i - b.i).slice(0, limit).map(x => x.m);
}

type Fetcher = <T>(url: string, init: RequestInit & { timeoutMs?: number; signal?: AbortSignal }) => Promise<T>;
/** Auth check without spend (§1). Returns discovered models when the check doubles as discovery. */
export async function authCheck(provider: string, adapter: ProviderAdapter, config: ProviderConfig, signal: AbortSignal, fetcher: Fetcher = fetchJson): Promise<DiscoveredModel[] | null> {
  if (provider === 'openrouter') { await fetcher(`${config.baseUrl}/key`, { signal, timeoutMs: 15000, headers: { Authorization: `Bearer ${config.apiKey}` } }); return null; }
  if (provider === 'huggingface') { await fetcher('https://huggingface.co/api/whoami-v2', { signal, timeoutMs: 15000, headers: { Authorization: `Bearer ${config.apiKey}` } }); return null; }
  if (provider === 'nvidia') return null; // No public auth endpoint; the usability probe is the auth proof.
  // google, groq, mistral: authenticated GET /models is both the auth check and discovery.
  return adapter.discover(config, signal);
}

export type ConnectionTestDeps = { fetcher?: Fetcher; now?: () => number; signal?: AbortSignal };
/** Spec §3: auth check → discovery → at most 3 tiny usability probes. */
export async function testConnection(provider: string, adapter: ProviderAdapter, config: ProviderConfig, deps: ConnectionTestDeps = {}): Promise<ConnectionTestResult & { discovered: DiscoveredModel[] }> {
  const now = deps.now || Date.now;
  const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(75000)]) : AbortSignal.timeout(75000);
  const done = (status: ConnectionStatus, extra: { models?: number; usableModel?: string | null; latencyMs?: number | null; retryAfterMs?: number; discovered?: DiscoveredModel[] } = {}) => ({
    status, models: extra.models ?? 0, usableModel: extra.usableModel ?? null, latencyMs: extra.latencyMs ?? null, checkedAt: now(),
    message: sanitizeMessage(messageFor(status, provider, extra), [config.apiKey]),
    ...(extra.retryAfterMs ? { retryAfterMs: extra.retryAfterMs } : {}),
    discovered: extra.discovered ?? [],
  });
  const fail = (error: unknown, models = 0) => {
    const status = statusForError(error);
    // During auth/discovery a 404/400 means the endpoint, not the models, is unusable.
    return done(status === 'no_models' ? 'network_error' : status, { models, retryAfterMs: error instanceof ProviderError ? error.retryAfterMs : undefined });
  };
  let discovered: DiscoveredModel[] | null;
  try { discovered = await authCheck(provider, adapter, config, signal, deps.fetcher); }
  catch (error) { return fail(error); }
  try { if (!discovered) discovered = await adapter.discover(config, signal); }
  catch (error) { return fail(error); }
  if (!discovered.length) return done('no_models');
  let lastError: unknown;
  for (const candidate of probeCandidates(discovered)) {
    const started = now();
    try {
      await adapter.chat(config, candidate.modelId, { messages: [{ role: 'user', content: 'Reply with OK.' }], maxTokens: 8, temperature: 0, stream: false, signal, firstTokenTimeoutMs: 20000, totalTimeoutMs: 20000 });
      return done('connected', { models: discovered.length, usableModel: candidate.modelId, latencyMs: Math.max(0, now() - started), discovered });
    } catch (error) {
      lastError = error;
      const kind = error instanceof ProviderError ? error.kind : 'network';
      if (!['not_found', 'unsupported', 'bad_request', 'invalid'].includes(kind)) {
        const status = statusForError(error);
        return done(status, { models: discovered.length, retryAfterMs: error instanceof ProviderError ? error.retryAfterMs : undefined, discovered });
      }
    }
  }
  void lastError;
  return done('no_models', { models: discovered.length, discovered });
}

/** Per-owner limiter: at most 1 concurrent test and 10 per rolling minute. */
export class TestLimiter {
  private active = new Set<string>();
  private history = new Map<string, number[]>();
  constructor(private perMinute = 10, private now: () => number = Date.now) {}
  acquire(owner: string): (() => void) | null {
    const t = this.now();
    const recent = (this.history.get(owner) || []).filter(x => t - x < 60000);
    if (this.active.has(owner) || recent.length >= this.perMinute) { this.history.set(owner, recent); return null; }
    recent.push(t); this.history.set(owner, recent); this.active.add(owner);
    if (this.history.size > 10000) for (const [k, v] of this.history) if (!v.some(x => t - x < 60000)) this.history.delete(k);
    let released = false;
    return () => { if (!released) { released = true; this.active.delete(owner); } };
  }
  isActive(owner: string) { return this.active.has(owner); }
}
