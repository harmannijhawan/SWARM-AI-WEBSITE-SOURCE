'use client';
import { getAuthToken } from '@/lib/cloud-api/custom-fetch';
import type { Preferences } from '@/shared/preferences';
import type { ConnectionTestResult, ProviderStatusSummary } from '@/shared/providers';

export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); } }
async function request<T>(path: string, method = 'GET', body?: unknown, timeoutMs = 20000): Promise<T> {
  const token = await getAuthToken();
  const response = await fetch(path, {
    method, credentials: 'include',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`, response.status, data.code);
  return data as T;
}

export type ProviderList = { providers: ProviderStatusSummary[] };
export type TestResponse = ConnectionTestResult & { provider: ProviderStatusSummary };
export type DiscoveredModelRow = { id: string; modelId: string; displayName: string; providerId: string; providerName: string; contextLength?: number | null; freeStatus?: string; source?: 'byok' | 'managed' };

export const providersApi = {
  list: () => request<ProviderList>('/api/providers'),
  save: (id: string, apiKey: string) => request<ProviderStatusSummary & { warning?: string }>(`/api/providers/${encodeURIComponent(id)}`, 'PUT', { apiKey }),
  remove: (id: string) => request<{ ok: boolean; provider: ProviderStatusSummary }>(`/api/providers/${encodeURIComponent(id)}`, 'DELETE'),
  /** Omit apiKey to test the saved key. The test sends one tiny request. */
  test: (id: string, apiKey?: string) => request<TestResponse>(`/api/providers/${encodeURIComponent(id)}/test`, 'POST', apiKey ? { apiKey } : {}, 90000),
  models: () => request<{ models: DiscoveredModelRow[] }>('/api/models', 'GET', undefined, 30000),
};

type PreferenceDocument = { preferences: Preferences; version: string | null };
export const preferencesApi = {
  get: () => request<PreferenceDocument>('/api/account/preferences'),
  /** Read-modify-write with the server's optimistic version check; retries once on a concurrent change. */
  async update(change: (current: Preferences) => Preferences): Promise<PreferenceDocument> {
    for (let attempt = 0; ; attempt++) {
      const current = await preferencesApi.get();
      try { return await request<PreferenceDocument>('/api/account/preferences', 'POST', { preferences: change(structuredClone(current.preferences)), version: current.version }); }
      catch (error) { if (attempt === 0 && error instanceof ApiError && error.status === 409) continue; throw error; }
    }
  },
};

/** Display mapping for spec §5 step 5: only provider-reported prices are shown as free or paid. */
export function freeLabel(status?: string): 'free' | 'paid' | 'unknown' {
  return status === 'free' || status === 'local' ? 'free' : status === 'paid' ? 'paid' : 'unknown';
}
