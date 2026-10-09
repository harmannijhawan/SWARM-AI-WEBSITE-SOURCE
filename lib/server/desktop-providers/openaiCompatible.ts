// Adapted from SWARM desktop electron/providers/openaiCompatible.ts
// Factory for providers exposing an OpenAI-compatible `/models` + `/chat/completions` API.
import { fetchJson, openAIChat } from './http';
import { inferCapabilities, inferContext, isChatModel, prettyName } from './heuristics';
import type { DiscoveredModel, ProviderAdapter } from './types';
import type { FreeStatus } from './domain-types';

interface Options {
  id: string; name: string; baseUrl: string; signupUrl: string; freeNotes: string;
  freeStatus: FreeStatus;
  filter?: (id: string, raw: Record<string, unknown>) => boolean;
  context?: (raw: Record<string, unknown>) => number | null;
  extraBody?: Record<string, unknown>;
}

export function openAICompatible(o: Options): ProviderAdapter {
  return {
    id: o.id,
    name: o.name,
    kind: 'cloud',
    requiresKey: true,
    needsAccountId: false,
    defaultBaseUrl: o.baseUrl,
    signupUrl: o.signupUrl,
    freeNotes: o.freeNotes,
    publicDiscovery: false,
    async discover(cfg, signal) {
      const res = await fetchJson<{ data: Record<string, unknown>[] }>(`${cfg.baseUrl}/models`, {
        signal, headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      });
      const out: DiscoveredModel[] = [];
      for (const raw of res.data ?? []) {
        const id = String(raw.id);
        if (!isChatModel(id)) continue;
        if (o.filter && !o.filter(id, raw)) continue;
        const ctx = o.context?.(raw) ?? null;
        out.push({
          modelId: id,
          displayName: prettyName(id),
          capabilities: inferCapabilities(id, { long_context: ctx ? ctx >= 100_000 : undefined }),
          contextLength: ctx ?? inferContext(id),
          maxOutput: null,
          freeStatus: o.freeStatus,
        });
      }
      return out;
    },
    chat(cfg, modelId, req) {
      return openAIChat(`${cfg.baseUrl}/chat/completions`, { Authorization: `Bearer ${cfg.apiKey}` }, modelId, req, o.extraBody ?? {}, o.id);
    },
  };
}

export const nvidia = openAICompatible({
  id: 'nvidia',
  name: 'NVIDIA NIM',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  signupUrl: 'https://build.nvidia.com',
  freeNotes: 'Free developer access to hosted NIM endpoints with per-minute rate limits.',
  freeStatus: 'free_tier',
});

export const groq = openAICompatible({
  id: 'groq',
  name: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  signupUrl: 'https://console.groq.com/keys',
  freeNotes: 'Free plan with per-model request and token limits.',
  freeStatus: 'free_tier',
  filter: (_id, raw) => raw.active !== false,
  context: (raw) => (typeof raw.context_window === 'number' ? raw.context_window : null),
});

export const cerebras = openAICompatible({
  id: 'cerebras',
  name: 'Cerebras',
  baseUrl: 'https://api.cerebras.ai/v1',
  signupUrl: 'https://cloud.cerebras.ai',
  freeNotes: 'Free tier with daily token limits.',
  freeStatus: 'free_tier',
});

export const mistral = openAICompatible({
  id: 'mistral',
  name: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  signupUrl: 'https://console.mistral.ai/api-keys',
  freeNotes: 'Free "Experiment" plan with rate limits.',
  freeStatus: 'free_tier',
  filter: (_id, raw) => {
    const caps = raw.capabilities as { completion_chat?: boolean } | undefined;
    return caps ? caps.completion_chat !== false : true;
  },
  context: (raw) => (typeof raw.max_context_length === 'number' ? raw.max_context_length : null),
});

export const huggingface = openAICompatible({
  id: 'huggingface',
  name: 'Hugging Face',
  baseUrl: 'https://router.huggingface.co/v1',
  signupUrl: 'https://huggingface.co/settings/tokens',
  freeNotes: 'Inference Providers include monthly free credits for free accounts.',
  freeStatus: 'free_tier',
  context: (raw) => {
    const providers = raw.providers as { context_length?: number }[] | undefined;
    const c = providers?.map((p) => p.context_length ?? 0).filter(Boolean);
    return c?.length ? Math.max(...c) : null;
  },
});
