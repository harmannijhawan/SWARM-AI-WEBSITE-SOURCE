'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import type { ProviderStatusSummary } from '@/shared/providers';
import { providersApi } from './provider-api';
import { ProviderCard } from './provider-connect';

export const PROVIDERS_QUERY_KEY = ['byok-providers'] as const;
export function useProviderStatuses() {
  return useQuery({ queryKey: PROVIDERS_QUERY_KEY, queryFn: () => providersApi.list(), refetchInterval: false, staleTime: 10_000 });
}
/** Applies one provider update locally and refreshes everything that depends on available models. */
export function useProviderChanged() {
  const cache = useQueryClient();
  return (next: ProviderStatusSummary) => {
    cache.setQueryData<{ providers: ProviderStatusSummary[] }>(PROVIDERS_QUERY_KEY, current => current ? { ...current, providers: current.providers.map(p => p.id === next.id ? next : p) } : current);
    void cache.invalidateQueries({ predicate: q => q.queryKey[0] !== PROVIDERS_QUERY_KEY[0] && q.queryKey[0] !== 'preferences' });
  };
}

export function ProviderKeys() {
  const { data, isLoading, isError, error, refetch } = useProviderStatuses();
  const changed = useProviderChanged();
  return <section className="sx-panel" aria-labelledby="providers-heading">
    <div className="sx-panel-head">
      <div>
        <h2 id="providers-heading">AI providers</h2>
        <p>Bring your own keys. Saved keys are encrypted in your account vault and are never sent back to this browser. When you have no key for a provider, SWARM-managed access is used if the operator provides it.</p>
      </div>
      <Link className="sx-button" href="/app?setup=1"><RotateCcw size={15} aria-hidden />Run setup again</Link>
    </div>
    {isLoading ? <div className="sx-grid" role="status" aria-label="Loading providers">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="sx-card sx-skeleton" />)}</div>
      : isError ? <div className="sx-error" role="alert">{error instanceof Error ? error.message : 'Providers could not load.'} <button type="button" className="sx-link" onClick={() => void refetch()}>Try again</button></div>
        : <div className="sx-grid">{data!.providers.map(provider => <ProviderCard key={provider.id} provider={provider} onChanged={changed} />)}</div>}
  </section>;
}
