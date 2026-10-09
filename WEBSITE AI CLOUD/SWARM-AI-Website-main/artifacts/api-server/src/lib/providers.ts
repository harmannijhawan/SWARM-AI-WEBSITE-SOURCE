import OpenAI from "openai";
import type { ProviderId } from "@workspace/api-zod";
import type { ProviderCredential } from "@workspace/db";
import { db, providerCredentialsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { decryptProviderKey } from "./providerCrypto";

export const PROVIDER_CATALOG = [
  {
    id: "openai",
    name: "OpenAI",
    needsAccountId: false,
    baseUrl: "https://api.openai.com/v1",
    keyHelpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    needsAccountId: false,
    baseUrl: "https://openrouter.ai/api/v1",
    keyHelpUrl: "https://openrouter.ai/keys",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    needsAccountId: false,
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyHelpUrl: "https://build.nvidia.com",
  },
  {
    id: "groq",
    name: "Groq",
    needsAccountId: false,
    baseUrl: "https://api.groq.com/openai/v1",
    keyHelpUrl: "https://console.groq.com/keys",
  },
  {
    id: "google",
    name: "Google Gemini",
    needsAccountId: false,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyHelpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    needsAccountId: true,
    baseUrl: "https://api.cloudflare.com/client/v4",
    keyHelpUrl: "https://dash.cloudflare.com/profile/api-tokens",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    needsAccountId: false,
    baseUrl: "https://router.huggingface.co/v1",
    keyHelpUrl: "https://huggingface.co/settings/tokens",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    needsAccountId: false,
    baseUrl: "https://api.cerebras.ai/v1",
    keyHelpUrl: "https://cloud.cerebras.ai",
  },
  {
    id: "mistral",
    name: "Mistral",
    needsAccountId: false,
    baseUrl: "https://api.mistral.ai/v1",
    keyHelpUrl: "https://console.mistral.ai/api-keys",
  },
] as const satisfies ReadonlyArray<{
  id: ProviderId;
  name: string;
  needsAccountId: boolean;
  baseUrl: string;
  keyHelpUrl: string;
}>;

export type SupportedProvider = (typeof PROVIDER_CATALOG)[number]["id"];

export function getProvider(providerId: string) {
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId);
}

export async function getProviderCredential(
  ownerId: string,
  providerId: SupportedProvider,
): Promise<(ProviderCredential & { apiKey: string }) | null> {
  const [stored] = await db
    .select()
    .from(providerCredentialsTable)
    .where(
      and(
        eq(providerCredentialsTable.ownerId, ownerId),
        eq(providerCredentialsTable.providerId, providerId),
      ),
    )
    .limit(1);

  if (!stored) return null;
  return { ...stored, apiKey: decryptProviderKey(stored) };
}

export function makeProviderClient(
  providerId: SupportedProvider,
  apiKey: string,
  accountId?: string | null,
): OpenAI {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unsupported provider.");

  let baseURL: string = provider.baseUrl;
  if (providerId === "google") {
    baseURL = `${baseURL}/openai`;
  } else if (providerId === "cloudflare") {
    if (!accountId || !/^[a-zA-Z0-9_-]{8,160}$/.test(accountId)) {
      throw new Error("A valid Cloudflare account ID is required.");
    }
    baseURL = `${baseURL}/accounts/${encodeURIComponent(accountId)}/ai/v1`;
  }

  return new OpenAI({
    apiKey,
    baseURL,
    timeout: 60_000,
    maxRetries: 0,
    ...(providerId === "openrouter"
      ? { defaultHeaders: { "X-Title": "SWARM AI" } }
      : {}),
  });
}

export interface DiscoveredModel {
  id: string;
  modelId: string;
  providerId: SupportedProvider;
  providerName: string;
  displayName: string;
}

function isTextChatModel(id: string): boolean {
  return !/(embed|whisper|tts|text-embedding|moderation|dall-e|image|realtime|audio|transcri|rerank|search)/i.test(
    id,
  );
}

async function discoverGoogleModels(apiKey: string): Promise<string[]> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) throw new Error("Google model discovery failed.");
  const body = (await response.json()) as {
    models?: Array<{
      name?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  return (body.models ?? [])
    .filter((model) =>
      model.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((model) => model.name?.replace(/^models\//, "") ?? "")
    .filter((id) => id && isTextChatModel(id));
}

async function discoverCloudflareModels(
  apiKey: string,
  accountId: string | null,
): Promise<string[]> {
  if (!accountId || !/^[a-zA-Z0-9_-]{8,160}$/.test(accountId)) {
    throw new Error("A valid Cloudflare account ID is required.");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/models/search?task=Text%20Generation&per_page=100`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error("Cloudflare model discovery failed.");
  const body = (await response.json()) as {
    result?: Array<{ name?: string }>;
  };
  return (body.result ?? [])
    .map((model) => model.name ?? "")
    .filter((id) => id && isTextChatModel(id));
}

export async function discoverProviderModels(
  providerId: SupportedProvider,
  apiKey: string,
  accountId?: string | null,
): Promise<DiscoveredModel[]> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error("Unsupported provider.");

  let modelIds: string[];
  if (providerId === "google") {
    modelIds = await discoverGoogleModels(apiKey);
  } else if (providerId === "cloudflare") {
    modelIds = await discoverCloudflareModels(apiKey, accountId ?? null);
  } else {
    const client = makeProviderClient(providerId, apiKey, accountId);
    const response = await client.models.list();
    modelIds = response.data
      .map((model) => model.id)
      .filter((id) => isTextChatModel(id));
  }

  return modelIds.map((modelId) => ({
    id: `${providerId}:${modelId}`,
    modelId,
    providerId,
    providerName: provider.name,
    displayName: modelId,
  }));
}
