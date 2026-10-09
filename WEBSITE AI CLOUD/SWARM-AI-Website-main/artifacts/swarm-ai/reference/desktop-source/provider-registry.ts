// Dynamic model registry: discovers models from every provider adapter, keeps
// normalized metadata, and tracks measured runtime health/latency/success.
import type { ModelHealth, ModelInfo, ProviderInfo } from '../../shared/types';
import { db } from '../core/db';
import { bus, emit } from '../core/bus';
import { getSettings } from '../core/settings';
import { getSecret, mask } from '../core/secrets';
import { errMsg, limitConcurrency } from '../core/util';
import { estimateParamsB } from './heuristics';
import { openrouter } from './openrouter';
import { cerebras, groq, huggingface, mistral, nvidia } from './openaiCompatible';
import { google } from './google';
import { cloudflare } from './cloudflare';
import { ollama } from './ollama';
import { ProviderError, type ProviderAdapter, type ProviderConfig, type ProviderErrorKind } from './types';

export const ADAPTERS: ProviderAdapter[] = [openrouter, nvidia, groq, google, cloudflare, huggingface, cerebras, mistral, ollama];
export const adapter = (id: string) => ADAPTERS.find((a) => a.id === id);

let registryRevision = 0;
export const getRegistryRevision = () => registryRevision;
const models = new Map<string, ModelInfo>();
const providers = new Map<string, ProviderInfo>();
let broadcastTimer: NodeJS.Timeout | null = null;

export function providerConfig(id: string): ProviderConfig {
  const a = adapter(id)!;
  const s = getSettings();
  const secret = a.requiresKey ? getSecret(id, s.providers.useEnvKeys) : null;
  const baseUrl = (id === 'ollama' ? s.advanced.ollamaUrl : s.providers.baseUrls[id]) || a.defaultBaseUrl;
  return { apiKey: secret?.value ?? null, baseUrl: baseUrl.replace(/\/+$/, ''), accountId: s.providers.accountIds[id] || null };
}

export function isProviderEnabled(id: string) {
  const v = getSettings().providers.enabled[id];
  return v === undefined ? true : v;
}

function providerInfo(a: ProviderAdapter): ProviderInfo {
  const prev = providers.get(a.id) ?? db().get<ProviderInfo>('providers', a.id);
  const s = getSettings();
  const secret = a.requiresKey ? getSecret(a.id, s.providers.useEnvKeys) : null;
  const cfg = providerConfig(a.id);
  const configured = (!a.requiresKey || !!secret) && (!a.needsAccountId || !!cfg.accountId);
  const ms = [...models.values()].filter((m) => m.providerId === a.id);
  return {
    id: a.id, name: a.name, kind: a.kind, requiresKey: a.requiresKey, needsAccountId: a.needsAccountId,
    configured, enabled: isProviderEnabled(a.id),
    keyHint: mask(secret?.value), keySource: secret?.source ?? null,
    baseUrl: cfg.baseUrl,
    health: prev?.health ?? 'unknown',
    modelCount: ms.length,
    freeModelCount: ms.filter((m) => m.freeStatus !== 'paid' && m.freeStatus !== 'unknown').length,
    lastDiscoveryAt: prev?.lastDiscoveryAt ?? null,
    lastError: prev?.lastError ?? null,
    latencyMs: prev?.latencyMs ?? null,
    signupUrl: a.signupUrl,
    freeNotes: a.freeNotes,
  };
}

export function loadRegistry() {
  registryRevision++;
  for (const m of db().list<ModelInfo>('models')) models.set(m.id, m);
  for (const a of ADAPTERS) {
    const p = providerInfo(a);
    providers.set(a.id, p);
  }
}

function saveProvider(p: ProviderInfo) { registryRevision++; providers.set(p.id, p); db().put('providers', p.id, p); }
function saveModel(m: ModelInfo) { registryRevision++; models.set(m.id, m); db().put('models', m.id, m, { provider_id: m.providerId }); }

export function refreshProviderInfo(id: string) {
  const a = adapter(id); if (!a) return;
  saveProvider(providerInfo(a));
  scheduleBroadcast();
}

export function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    bus.send('models:changed', { models: listModels(), providers: listProviders() });
  }, 250);
}

export function listModels(): ModelInfo[] {
  const now = Date.now();
  return [...models.values()].map((m) => (m.health === 'rate_limited' && m.rateLimitedUntil && m.rateLimitedUntil < now ? { ...m, health: 'degraded' as ModelHealth } : m));
}
export function listProviders(): ProviderInfo[] {
  return ADAPTERS.map((a) => providers.get(a.id) ?? providerInfo(a));
}
export function getModel(id: string) { return models.get(id) ?? null; }

export async function discoverProvider(id: string, signal = new AbortController().signal): Promise<number> {
  const a = adapter(id);
  if (!a) throw new Error(`Unknown provider ${id}`);
  const info = providerInfo(a);
  if (!info.enabled) { saveProvider({ ...info }); return 0; }
  if (!info.configured && !a.publicDiscovery) {
    saveProvider({ ...info, health: a.requiresKey ? 'auth_required' : 'unknown', lastError: a.needsAccountId && !providerConfig(id).accountId ? 'Account ID and API token required' : 'API key not configured' });
    return 0;
  }
  const started = Date.now();
  try {
    const found = await a.discover(providerConfig(id), signal);
    const seen = new Set<string>();
    for (const d of found) {
      const key = `${a.id}::${d.modelId}`;
      seen.add(key);
      const prev = models.get(key);
      const m: ModelInfo = {
        id: key, providerId: a.id, modelId: d.modelId, displayName: d.displayName,
        capabilities: d.capabilities, contextLength: d.contextLength ?? prev?.contextLength ?? 32_768,
        maxOutput: d.maxOutput, freeStatus: d.freeStatus,
        health: prev?.health ?? (info.configured ? 'unknown' : 'auth_required'),
        streaming: true, enabled: prev?.enabled ?? true,
        paramsB: estimateParamsB(d.modelId) ?? prev?.paramsB ?? null,
        latencyMs: prev?.latencyMs ?? null, tokensPerSec: prev?.tokensPerSec ?? null,
        calls: prev?.calls ?? 0, successes: prev?.successes ?? 0, failures: prev?.failures ?? 0,
        consecutiveFailures: prev?.consecutiveFailures ?? 0,
        lastError: prev?.lastError ?? null, lastErrorAt: prev?.lastErrorAt ?? null, lastSuccessAt: prev?.lastSuccessAt ?? null,
        lastCheckedAt: prev?.lastCheckedAt ?? null, rateLimitedUntil: prev?.rateLimitedUntil ?? null,
        discoveredAt: prev?.discoveredAt ?? Date.now(), notes: d.notes ?? prev?.notes ?? null,
      };
      if (!info.configured && a.requiresKey) m.health = 'auth_required';
      else if (prev?.health === 'auth_required') m.health = 'unknown';
      if (m.notes === 'No longer listed by provider') m.notes = null;
      if (prev?.health === 'offline' && prev.notes === 'No longer listed by provider') m.health = 'unknown';
      saveModel(m);
    }
    // Models that disappeared from the provider listing are marked offline, not deleted (history is kept).
    for (const m of models.values()) {
      if (m.providerId === a.id && !seen.has(m.id) && m.health !== 'offline') saveModel({ ...m, health: 'offline', notes: 'No longer listed by provider' });
    }
    const p = providerInfo(a);
    saveProvider({ ...p, health: info.configured ? (p.health === 'auth_required' || p.health === 'offline' ? 'unknown' : p.health) : 'auth_required', lastDiscoveryAt: Date.now(), lastError: info.configured ? null : 'Models listed publicly; API key needed to run them', latencyMs: Date.now() - started });
    emit('PROVIDER_UPDATED', `${a.name}: discovered ${found.length} eligible models`, {}, 'info', { providerId: a.id, count: found.length });
    scheduleBroadcast();
    return found.length;
  } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : 'network';
    const health: ModelHealth = kind === 'auth' ? 'auth_required' : 'offline';
    saveProvider({ ...providerInfo(a), health, lastError: errMsg(e), lastDiscoveryAt: Date.now() });
    if (a.id === 'ollama') {
      for (const m of models.values()) if (m.providerId === 'ollama') saveModel({ ...m, health: 'offline', notes: 'Ollama server not reachable' });
    }
    emit('PROVIDER_UPDATED', `${a.name}: discovery failed (${errMsg(e)})`, {}, 'warning', { providerId: a.id });
    scheduleBroadcast();
    return 0;
  }
}

export async function discoverAll(): Promise<void> {
  await limitConcurrency(ADAPTERS, 4, async a => { await discoverProvider(a.id).catch(() => 0); });
  emit('MODELS_UPDATED', `Model registry updated: ${listModels().filter((m) => usable(m)).length} usable models`, {}, 'info');
}

/** A model is usable for routing (free-eligible, configured, not known-bad). */
export function usable(m: ModelInfo): boolean {
  const s = getSettings();
  if (!m.enabled || s.routing.excluded.includes(m.id)) return false;
  if (!isProviderEnabled(m.providerId)) return false;
  const p = providers.get(m.providerId);
  if (!p?.configured) return false;
  if (s.ai.freeMode && !['free', 'free_tier', 'local'].includes(m.freeStatus)) return false;
  if (m.health === 'auth_required' || m.health === 'unsupported') return false;
  if (m.health === 'offline') {
    // Allow periodic re-probe of offline models after 10 minutes, unless delisted.
    if (m.notes === 'No longer listed by provider') return false;
    if (m.lastErrorAt && Date.now() - m.lastErrorAt < 10 * 60_000) return false;
  }
  if (m.rateLimitedUntil && m.rateLimitedUntil > Date.now()) return false;
  return true;
}

export function recordSuccess(id: string, latencyMs: number, ttftMs: number | null, completionTokens: number) {
  const m = models.get(id); if (!m) return;
  const lat = ttftMs ?? latencyMs;
  const tps = latencyMs > 0 && completionTokens > 50 ? (completionTokens / Math.max(0.2, (latencyMs - (ttftMs ?? 0)) / 1000)) : null;
  saveModel({
    ...m, calls: m.calls + 1, successes: m.successes + 1, consecutiveFailures: 0,
    latencyMs: m.latencyMs === null ? lat : Math.round(m.latencyMs * 0.7 + lat * 0.3),
    tokensPerSec: tps === null ? m.tokensPerSec : m.tokensPerSec === null ? Math.round(tps) : Math.round(m.tokensPerSec * 0.7 + tps * 0.3),
    health: 'healthy', lastSuccessAt: Date.now(), lastCheckedAt: Date.now(), rateLimitedUntil: null,
    notes: m.notes === 'Ollama server not reachable' ? null : m.notes,
  });
  const p = providers.get(m.providerId);
  if (p && p.health !== 'healthy') saveProvider({ ...p, health: 'healthy', lastError: null });
  scheduleBroadcast();
}

export function recordFailure(id: string, kind: ProviderErrorKind, message: string, retryAfterMs?: number) {
  const m = models.get(id); if (!m) return;
  if (kind === 'cancelled') return;
  const consecutive = m.consecutiveFailures + 1;
  let health: ModelHealth = m.health;
  let until: number | null = m.rateLimitedUntil;
  switch (kind) {
    case 'rate_limit': health = 'rate_limited'; until = Date.now() + Math.min(Math.max(retryAfterMs ?? 60_000, 5_000), 15 * 60_000); break;
    case 'quota': health = 'rate_limited'; until = Date.now() + 60 * 60_000; break;
    case 'auth': health = 'auth_required'; break;
    case 'not_found': case 'unsupported': health = 'unsupported'; break;
    case 'timeout': case 'network': case 'server': health = consecutive >= 3 ? 'offline' : 'degraded'; until = Date.now() + Math.min(120000, 15000 * consecutive); break;
    case 'context': health = m.health; break; // request-specific, not a health problem
    case 'bad_request': health = consecutive >= 3 ? 'unsupported' : 'degraded'; break;
    default: health = consecutive >= 3 ? 'offline' : 'degraded';
  }
  saveModel({
    ...m, calls: m.calls + 1, failures: m.failures + 1, consecutiveFailures: kind === 'context' ? m.consecutiveFailures : consecutive,
    health, rateLimitedUntil: until, lastError: message.slice(0, 400), lastErrorAt: Date.now(), lastCheckedAt: Date.now(),
  });
  if (kind === 'auth') {
    const p = providers.get(m.providerId);
    if (p) saveProvider({ ...p, health: 'auth_required', lastError: message.slice(0, 300) });
  }
  scheduleBroadcast();
}

export function setModelEnabled(id: string, enabled: boolean) {
  const m = models.get(id); if (!m) return;
  saveModel({ ...m, enabled });
  scheduleBroadcast();
}

/** Health probe: a tiny real completion request. */
export async function probeModel(id: string, signal?: AbortSignal): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const m = models.get(id);
  if (!m) return { ok: false, latencyMs: 0, error: 'Unknown model' };
  const a = adapter(m.providerId)!;
  const ctrl = new AbortController();
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  const started = Date.now();
  try {
    const r = await a.chat(providerConfig(m.providerId), m.modelId, {
      messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      maxTokens: 16, temperature: 0, signal: ctrl.signal, stream: true,
      firstTokenTimeoutMs: a.kind === 'local' ? 120_000 : 25_000, totalTimeoutMs: a.kind === 'local' ? 150_000 : 40_000,
    });
    recordSuccess(id, r.latencyMs, r.ttftMs, r.completionTokens);
    db().put('usage', `probe_${id}_${started}`, {
      id: `probe_${id}_${started}`, ts: started, projectId: null, runId: null, agent: null, providerId: m.providerId, modelId: m.modelId,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens, latencyMs: r.latencyMs, ok: true, error: null, costUsd: 0, local: a.kind === 'local',
    }, { project_id: null, run_id: null, ts: started, provider_id: m.providerId, model_id: m.modelId });
    return { ok: true, latencyMs: r.latencyMs };
  } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : 'network';
    recordFailure(id, kind, errMsg(e), e instanceof ProviderError ? e.retryAfterMs : undefined);
    return { ok: false, latencyMs: Date.now() - started, error: errMsg(e) };
  }
}

/**
 * Startup health checks. Probes a bounded sample per provider (largest/most capable
 * first) with low concurrency to respect provider rate limits. Local models are not
 * probed automatically because a probe loads multi-GB weights into memory.
 */
export async function healthCheckSample(perProvider = 5, only?: string): Promise<void> {
  const byProvider = new Map<string, ModelInfo[]>();
  for (const m of listModels()) {
    if (m.providerId === 'ollama' && !only) continue;
    if (only && m.providerId !== only) continue;
    if (!usable(m)) continue;
    const list = byProvider.get(m.providerId) ?? [];
    list.push(m); byProvider.set(m.providerId, list);
  }
  await Promise.all([...byProvider.entries()].map(async ([, list]) => {
    const sample = list
      .sort((a, b) => (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0) || (b.capabilities.length - a.capabilities.length) || ((b.paramsB ?? 0) - (a.paramsB ?? 0)))
      .slice(0, perProvider);
    await limitConcurrency(sample, 2, async (m) => { await probeModel(m.id); });
  }));
  emit('MODELS_UPDATED', 'Health checks completed', {}, 'info', { healthy: listModels().filter((m) => m.health === 'healthy').length });
}
