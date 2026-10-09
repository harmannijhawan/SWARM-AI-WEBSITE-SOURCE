import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  DeleteProviderParams,
  ListProvidersResponse,
  SaveProviderBody,
  SaveProviderParams,
  SaveProviderResponse,
} from "@workspace/api-zod";
import { db, providerCredentialsTable } from "@workspace/db";
import type { Request } from "express";
import { encryptProviderKey, decryptProviderKey, maskProviderKey } from "../lib/providerCrypto";
import { getProvider, PROVIDER_CATALOG } from "../lib/providers";

const router: IRouter = Router();

function getUserId(req: Request): string {
  const userId = (req as Request & { authUserId?: string }).authUserId;
  if (!userId) throw new Error("Authenticated user context is missing.");
  return userId;
}

router.get("/providers", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  const rows = await db
    .select()
    .from(providerCredentialsTable)
    .where(eq(providerCredentialsTable.ownerId, userId));
  const byProvider = new Map(rows.map((row) => [row.providerId, row]));

  const response = {
    providers: PROVIDER_CATALOG.map((provider) => {
      const credential = byProvider.get(provider.id);
      return {
        providerId: provider.id,
        name: provider.name,
        configured: Boolean(credential),
        needsAccountId: provider.needsAccountId,
        accountId: credential?.accountId ?? null,
        keyHint: credential
          ? maskProviderKey(
              decryptProviderKey(credential),
            )
          : null,
      };
    }),
  };

  res.json(ListProvidersResponse.parse(response));
});

router.put("/providers/:providerId", async (req, res): Promise<void> => {
  const params = SaveProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Unsupported provider." });
    return;
  }
  const body = SaveProviderBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Enter a valid API key." });
    return;
  }

  const provider = getProvider(params.data.providerId);
  if (!provider) {
    res.status(400).json({ error: "Unsupported provider." });
    return;
  }

  const apiKey = body.data.apiKey.trim();
  if (!apiKey || /[\r\n\0]/.test(apiKey)) {
    res.status(400).json({ error: "Enter a valid API key." });
    return;
  }

  const accountId = body.data.accountId?.trim() || null;
  if (
    provider.needsAccountId &&
    (!accountId || !/^[a-zA-Z0-9_-]{8,160}$/.test(accountId))
  ) {
    res.status(400).json({ error: "Enter a valid Cloudflare account ID." });
    return;
  }

  const ownerId = getUserId(req);
  const encrypted = encryptProviderKey(
    ownerId,
    provider.id,
    apiKey,
  );
  const [credential] = await db
    .insert(providerCredentialsTable)
    .values({
      ownerId,
      providerId: provider.id,
      ...encrypted,
      accountId: provider.needsAccountId ? accountId : null,
    })
    .onConflictDoUpdate({
      target: [
        providerCredentialsTable.ownerId,
        providerCredentialsTable.providerId,
      ],
      set: {
        ...encrypted,
        accountId: provider.needsAccountId ? accountId : null,
        updatedAt: new Date(),
      },
    })
    .returning();

  const result = {
    provider: {
      providerId: provider.id,
      name: provider.name,
      configured: true,
      needsAccountId: provider.needsAccountId,
      accountId: credential.accountId,
      keyHint: maskProviderKey(apiKey),
    },
  };
  res.json(SaveProviderResponse.parse(result));
});

router.delete("/providers/:providerId", async (req, res): Promise<void> => {
  const params = DeleteProviderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Unsupported provider." });
    return;
  }

  await db
    .delete(providerCredentialsTable)
    .where(
      and(
        eq(
          providerCredentialsTable.ownerId,
          getUserId(req),
        ),
        eq(providerCredentialsTable.providerId, params.data.providerId),
      ),
    );
  res.sendStatus(204);
});

export default router;
