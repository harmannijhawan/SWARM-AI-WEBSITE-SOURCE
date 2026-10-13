// Cross-platform BYOK contract (docs/SWARM_PLATFORM_SPEC.md §1, §2, §5). Client-safe: no secrets, no server imports.
export const BYOK_PROVIDER_IDS = ['google', 'groq', 'mistral', 'huggingface', 'nvidia', 'openrouter'] as const;
export type ByokProviderId = typeof BYOK_PROVIDER_IDS[number];

export type CatalogEntry = {
  id: ByokProviderId;
  name: string;
  description: string;
  /** Hard-coded allowlist. Never derive key-page URLs from user input. */
  keyUrl: string;
  /** Soft format hint only. Never blocks saving and never proves authentication. */
  keyPrefix: string | null;
  notes: string;
  /** Click-by-click guide shown next to the key field. */
  steps: readonly string[];
  /** Short tag that helps first-time users pick (advertised by the provider, never a guarantee). */
  tag: string | null;
  /** Suggested for first-time users because sign-up is quick and a free tier is advertised. */
  recommended: boolean;
};

export const PROVIDER_CATALOG: readonly CatalogEntry[] = [
  { id: 'groq', name: 'Groq', description: 'Very fast open models. Quickest way to get started.', keyUrl: 'https://console.groq.com/keys', keyPrefix: 'gsk_', notes: 'Provider advertises a free tier — limits apply.', tag: 'Free tier · fastest setup', recommended: true,
    steps: ['Sign in with Google, GitHub or email.', 'Select "Create API Key", give it any name and submit.', 'Copy the key (it starts with gsk_). Groq shows it only once.'] },
  { id: 'google', name: 'Google AI Studio', description: 'Gemini models with long context and image input.', keyUrl: 'https://aistudio.google.com/apikey', keyPrefix: 'AIza', notes: 'Provider advertises a free tier — limits apply.', tag: 'Free tier · Google account', recommended: true,
    steps: ['Sign in with your Google account and accept the terms.', 'Select "Create API key" (choose any project if asked).', 'Copy the key (it starts with AIza).'] },
  { id: 'openrouter', name: 'OpenRouter', description: 'One key for models from many providers, including free ones.', keyUrl: 'https://openrouter.ai/keys', keyPrefix: 'sk-or-', notes: 'Per-model prices are reported by OpenRouter; models priced at $0 are marked free.', tag: 'Many models · free variants', recommended: false,
    steps: ['Sign in, then select "Create Key".', 'Name it and (optionally) set a credit limit, then create it.', 'Copy the key (it starts with sk-or-).'] },
  { id: 'mistral', name: 'Mistral AI', description: 'Mistral and Codestral coding models.', keyUrl: 'https://console.mistral.ai/', keyPrefix: null, notes: 'Provider advertises a free tier — limits apply.', tag: 'Free "Experiment" plan', recommended: false,
    steps: ['Sign in and, if asked, choose the free "Experiment" plan (phone verification may be required).', 'Open "API Keys" in the left menu and select "Create new key".', 'Copy the key. Mistral shows it only once.'] },
  { id: 'nvidia', name: 'NVIDIA NIM', description: 'NVIDIA-hosted endpoints for popular open models.', keyUrl: 'https://build.nvidia.com/', keyPrefix: 'nvapi-', notes: 'Provider advertises a free tier — limits apply.', tag: 'Free developer access', recommended: false,
    steps: ['Sign in with an NVIDIA account.', 'Open any model page and select "Get API Key", then "Generate Key".', 'Copy the key (it starts with nvapi-).'] },
  { id: 'huggingface', name: 'Hugging Face', description: 'Open models served through Inference Providers.', keyUrl: 'https://huggingface.co/settings/tokens', keyPrefix: 'hf_', notes: 'Fine-grained tokens need the "Make calls to Inference Providers" permission. Write scopes are not needed.', tag: 'Monthly free credit', recommended: false,
    steps: ['Sign in, then select "Create new token".', 'Choose "Fine-grained" and tick only "Make calls to Inference Providers".', 'Create the token and copy it (it starts with hf_).'] },
];

export function catalogEntry(id: string): CatalogEntry | undefined {
  return PROVIDER_CATALOG.find(p => p.id === id);
}
export function isByokProvider(id: string): id is ByokProviderId {
  return (BYOK_PROVIDER_IDS as readonly string[]).includes(id);
}

export const CONNECTION_STATUSES = ['not_connected', 'needs_configuration', 'checking', 'connected', 'auth_failed', 'rate_limited', 'no_models', 'network_error'] as const;
export type ConnectionStatus = typeof CONNECTION_STATUSES[number];
export const STATUS_LABELS: Record<ConnectionStatus, string> = {
  not_connected: 'Not connected',
  needs_configuration: 'Needs configuration',
  checking: 'Checking connection',
  connected: 'Connected',
  auth_failed: 'Authentication failed',
  rate_limited: 'Rate limited',
  no_models: 'No compatible models available',
  network_error: 'Network error',
};
export type StatusTone = 'neutral' | 'ok' | 'warn' | 'err' | 'info';
export function statusTone(status: ConnectionStatus): StatusTone {
  if (status === 'connected') return 'ok';
  if (status === 'checking') return 'info';
  if (status === 'rate_limited' || status === 'needs_configuration' || status === 'no_models') return 'warn';
  if (status === 'auth_failed' || status === 'network_error') return 'err';
  return 'neutral';
}

/** Soft warning for an unexpected key shape. Returns null when the shape looks plausible or is unknown. */
export function keyFormatWarning(provider: string, key: string): string | null {
  const entry = catalogEntry(provider);
  if (!entry?.keyPrefix) return null;
  return key.trim().startsWith(entry.keyPrefix) ? null : `${entry.name} keys usually start with "${entry.keyPrefix}". You can still save it; the connection test will confirm whether it works.`;
}

export type ConnectionTestResult = {
  status: ConnectionStatus;
  models: number;
  usableModel: string | null;
  latencyMs: number | null;
  checkedAt: number;
  message: string;
  retryAfterMs?: number;
};

export type ProviderStatusSummary = {
  id: ByokProviderId;
  providerId: ByokProviderId;
  name: string;
  description: string;
  keyUrl: string;
  notes: string;
  configured: boolean;
  /** Server-managed access is available as a fallback when no personal key is stored. */
  managed: boolean;
  hint: string | null;
  status: ConnectionStatus;
  lastTest: ConnectionTestResult | null;
  models: number;
};

export const INTELLIGENCE_PROFILES = ['recommended', 'best_coding', 'fast', 'free_first', 'custom'] as const;
export type IntelligenceProfile = typeof INTELLIGENCE_PROFILES[number];
export const PROFILE_LABELS: Record<IntelligenceProfile, { title: string; description: string }> = {
  recommended: { title: 'Recommended', description: 'Quality-weighted routing across every connected provider.' },
  best_coding: { title: 'Best for coding', description: 'Prefers models with strong coding capability.' },
  fast: { title: 'Fastest', description: 'Prefers the lowest measured response latency.' },
  free_first: { title: 'Free first', description: 'Only uses models with a verified free status. Asks before using anything else.' },
  custom: { title: 'Custom', description: 'You choose the primary model and the fallback order.' },
};
export const ROUTING_ROLES = ['planner', 'coder', 'fast', 'reviewer', 'summarizer'] as const;
export type RoutingRole = typeof ROUTING_ROLES[number];
export const ROLE_LABELS: Record<RoutingRole, string> = { planner: 'Planner', coder: 'Coder', fast: 'Fast (classification)', reviewer: 'Reviewer', summarizer: 'Summarizer' };

export const ONBOARDING_VERSION = 1;
export const ONBOARDING_COPY = {
  headline: 'Meet Your New AI Development Partner.',
  description: 'Swarm plans, edits, runs and verifies real software projects using the AI providers you choose. Your keys stay on this device (or in your encrypted account vault on the web).',
  testNote: 'Testing sends one tiny request (about 10 tokens). It may count toward your provider quota.',
} as const;
