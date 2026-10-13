import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHttp } from '../lib/server/desktop-providers/http';
import { ProviderError, type DiscoveredModel, type ProviderAdapter } from '../lib/server/desktop-providers/types';
import { probeCandidates, sanitizeMessage, statusForError, testConnection, TestLimiter } from '../lib/server/byok';
import { runFallbackChain, FallbackStop } from '../lib/server/routing-reliability';
import { PROVIDER_CATALOG, STATUS_LABELS, keyFormatWarning } from '../shared/providers';
import { validatePreferences } from '../shared/preferences';

const model = (modelId: string, freeStatus: DiscoveredModel['freeStatus'] = 'unknown'): DiscoveredModel => ({ modelId, displayName: modelId, capabilities: ['chat'], contextLength: 8192, maxOutput: null, freeStatus });
const ok = { text: 'OK', promptTokens: 1, completionTokens: 1, finishReason: 'stop', latencyMs: 5, ttftMs: 5, usageEstimated: false };
function fakeAdapter(id: string, discover: () => Promise<DiscoveredModel[]>, chat: (modelId: string) => Promise<typeof ok>): ProviderAdapter {
  return { id, name: id, requiresKey: true, needsAccountId: false, defaultBaseUrl: 'https://example.invalid/v1', signupUrl: '', freeNotes: '', publicDiscovery: false,
    discover: async () => discover(), chat: async (_cfg: unknown, modelId: string) => chat(modelId) } as unknown as ProviderAdapter;
}
const cfg = { apiKey: 'gsk_secretvalue1234567890', accountId: null, baseUrl: 'https://example.invalid/v1' };

test('classification maps every provider failure to the shared status vocabulary', () => {
  const gemini = classifyHttp(400, JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }));
  assert.equal(gemini.kind, 'auth'); assert.equal(statusForError(gemini), 'auth_failed');
  assert.equal(statusForError(classifyHttp(401, '')), 'auth_failed');
  assert.equal(statusForError(classifyHttp(429, 'slow down')), 'rate_limited');
  assert.equal(statusForError(classifyHttp(429, '{"error":"insufficient_quota"}')), 'rate_limited');
  assert.equal(statusForError(classifyHttp(402, '')), 'rate_limited');
  assert.equal(statusForError(classifyHttp(503, '')), 'network_error');
  assert.equal(statusForError(new ProviderError('network', 'down')), 'network_error');
  assert.equal(statusForError(new Error('boom')), 'network_error');
  assert.equal(classifyHttp(400, 'bad field').kind, 'bad_request', 'an ordinary 400 is not an auth failure');
});

test('connection test stops at the auth check and never probes with a rejected key', async () => {
  let chats = 0;
  const a = fakeAdapter('groq', async () => { throw new ProviderError('auth', 'Authentication failed (401)', 401); }, async () => { chats++; return ok; });
  const r = await testConnection('groq', a, cfg);
  assert.equal(r.status, 'auth_failed'); assert.equal(chats, 0); assert(!r.message.includes(cfg.apiKey));
});

test('zero discovered models is reported as no compatible models', async () => {
  const r = await testConnection('groq', fakeAdapter('groq', async () => [], async () => ok), cfg);
  assert.equal(r.status, 'no_models'); assert.equal(r.message.length > 0, true);
});

test('usability probe tries at most three candidates and reports the model that answered', async () => {
  const tried: string[] = [];
  const models = ['big-70b', 'other-1', 'other-2', 'other-3', 'tiny-mini'].map(m => model(m));
  const a = fakeAdapter('groq', async () => models, async id => { tried.push(id); throw new ProviderError('not_found', 'gone', 404); });
  const r = await testConnection('groq', a, cfg);
  assert.equal(tried.length, 3); assert.equal(tried[0], 'tiny-mini', 'small models are probed first'); assert.equal(r.status, 'no_models');
  const b = fakeAdapter('groq', async () => models, async id => { if (id === 'tiny-mini') throw new ProviderError('unsupported', 'no'); return ok; });
  const s = await testConnection('groq', b, cfg);
  assert.equal(s.status, 'connected'); assert.equal(s.models, 5); assert(s.usableModel && s.usableModel !== 'tiny-mini');
});

test('rate limits during the probe end the test without trying other models', async () => {
  let chats = 0;
  const a = fakeAdapter('groq', async () => [model('a-mini'), model('b-mini')], async () => { chats++; throw new ProviderError('rate_limit', 'slow', 429, 1500); });
  const r = await testConnection('groq', a, cfg);
  assert.equal(r.status, 'rate_limited'); assert.equal(chats, 1); assert.equal(r.retryAfterMs, 1500);
});

test('OpenRouter and Hugging Face use their no-spend auth endpoints before discovery', async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string) => { urls.push(url); throw new ProviderError('auth', 'no', 401); }) as never;
  const a = fakeAdapter('openrouter', async () => [model('x:free', 'free')], async () => ok);
  assert.equal((await testConnection('openrouter', a, cfg, { fetcher })).status, 'auth_failed');
  assert.equal((await testConnection('huggingface', a, cfg, { fetcher })).status, 'auth_failed');
  assert.deepEqual(urls, ['https://example.invalid/v1/key', 'https://huggingface.co/api/whoami-v2']);
});

test('free models are probed first and secrets are stripped from messages', () => {
  assert.equal(probeCandidates([model('paid-large'), model('free-one:free', 'free')])[0].modelId, 'free-one:free');
  const clean = sanitizeMessage('failed for gsk_abcdefghijklmnop and Bearer sk-or-v1-123456789012 plus ' + 'x'.repeat(300), ['gsk_abcdefghijklmnop']);
  assert(!clean.includes('gsk_abcdefghijklmnop')); assert(!clean.includes('sk-or-v1')); assert(clean.length <= 200);
});

test('test limiter allows one concurrent test and ten per minute per owner', () => {
  let t = 0; const l = new TestLimiter(10, () => t);
  const first = l.acquire('a')!; assert.equal(l.acquire('a'), null, 'second concurrent test is refused'); assert(l.acquire('b'), 'other owners are independent');
  first(); for (let i = 1; i < 10; i++) l.acquire('a')!();
  assert.equal(l.acquire('a'), null, 'eleventh test within a minute is refused'); t = 61_000; assert(l.acquire('a'));
});

test('catalog uses only the official key pages and the spec labels', () => {
  assert.deepEqual(Object.fromEntries(PROVIDER_CATALOG.map(p => [p.id, p.keyUrl])), {
    groq: 'https://console.groq.com/keys', google: 'https://aistudio.google.com/apikey', openrouter: 'https://openrouter.ai/keys',
    mistral: 'https://console.mistral.ai/', nvidia: 'https://build.nvidia.com/', huggingface: 'https://huggingface.co/settings/tokens',
  });
  for (const p of PROVIDER_CATALOG) assert(p.steps.length >= 2, p.id + ' has a click-by-click guide');
  assert.equal(STATUS_LABELS.no_models, 'No compatible models available');
  assert.equal(keyFormatWarning('groq', 'gsk_valid-looking-key'), null);
  assert.match(keyFormatWarning('groq', 'AIza-wrong') ?? '', /usually start with "gsk_"/);
  assert.equal(keyFormatWarning('mistral', 'anything'), null, 'providers without a fixed prefix never warn');
});

test('preferences accept the onboarding and routing fields and reject malformed ones', () => {
  const v = validatePreferences({ ai: { profile: 'custom', pinnedModel: 'groq:llama' }, routing: { fallbacks: ['groq:a', 'google:gemini-flash'], maxFallbacks: 4 }, onboarding: { completedAt: 1_700_000_000_000, version: 1, skipped: false } });
  assert.equal(v.routing?.fallbacks?.length, 2);
  assert.throws(() => validatePreferences({ ai: { profile: 'turbo' } }));
  assert.throws(() => validatePreferences({ routing: { fallbacks: ['no spaces allowed'] } }));
  assert.throws(() => validatePreferences({ routing: { fallbacks: ['groq:a', 'groq:a'] } }), 'duplicates are rejected');
  assert.throws(() => validatePreferences({ routing: { maxFallbacks: 13 } }));
  assert.throws(() => validatePreferences({ onboarding: { completedAt: -1 } }));
});

type M = { id: string; modelId: string; providerId: string; displayName: string };
const m = (provider: string, id: string): M => ({ id: provider + ':' + id, modelId: id, providerId: provider, displayName: id });
const chain = (candidates: M[], run: (x: M) => Promise<string>, maxFallbacks = 6) => {
  const calls: string[] = []; const notices: string[] = [];
  const done = runFallbackChain<M, string>({ candidates, maxFallbacks, signal: new AbortController().signal, acquire: async () => async () => {}, run: async x => { calls.push(x.id); return run(x); }, record: async () => {}, onSwitch: (_f, _t, _e, n) => notices.push(n), sleep: async () => {} });
  return { done, calls, notices };
};

test('fallback chain: auth skips the provider, transient errors retry once, the switch is announced', async () => {
  const c = chain([m('groq', 'a'), m('groq', 'b'), m('google', 'g')], async x => { if (x.providerId === 'groq') throw new ProviderError('auth', 'no', 401); return 'answer'; });
  const r = await c.done; assert.equal(r.result, 'answer'); assert.deepEqual(c.calls, ['groq:a', 'google:g']);
  assert.equal(c.notices[0], 'Switched from a to g because a rejected the API key.');
  const t = chain([m('groq', 'a'), m('google', 'g')], async x => { if (x.id === 'groq:a') throw new ProviderError('server', 'down', 503); return 'ok'; });
  await t.done; assert.deepEqual(t.calls, ['groq:a', 'groq:a', 'google:g']);
});

test('fallback chain never replays a rejected request and respects the cap', async () => {
  const bad = chain([m('groq', 'a'), m('google', 'g')], async () => { throw new ProviderError('bad_request', 'invalid'); });
  await assert.rejects(bad.done, (e: unknown) => e instanceof FallbackStop); assert.deepEqual(bad.calls, ['groq:a']);
  const capped = chain(Array.from({ length: 10 }, (_, i) => m('p' + i, 'x')), async () => { throw new ProviderError('not_found', 'gone', 404); }, 2);
  await assert.rejects(capped.done); assert.equal(capped.calls.length, 3, 'primary + 2 fallbacks');
});
