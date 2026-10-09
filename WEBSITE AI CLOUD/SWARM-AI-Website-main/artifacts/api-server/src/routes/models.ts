import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { ListModelsResponse } from "@workspace/api-zod";
import { db, providerCredentialsTable } from "@workspace/db";
import type { Request } from "express";
import { decryptProviderKey } from "../lib/providerCrypto";
import {
  discoverProviderModels,
  getProvider,
  type SupportedProvider,
} from "../lib/providers";

const router: IRouter = Router();

router.get("/models", async (req, res): Promise<void> => {
  const ownerId = (req as Request & { authUserId?: string }).authUserId;
  if (!ownerId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const credentials = await db
    .select()
    .from(providerCredentialsTable)
    .where(eq(providerCredentialsTable.ownerId, ownerId));

  const results = await Promise.allSettled(
    credentials.map(async (credential) => {
      const provider = getProvider(credential.providerId);
      if (!provider) return [];

      return discoverProviderModels(
        provider.id as SupportedProvider,
        decryptProviderKey(credential),
        credential.accountId,
      );
    }),
  );

  const models = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );

  if (results.length > 0 && models.length === 0) {
    req.log.warn(
      { configuredProviderCount: results.length },
      "No models could be discovered for the signed-in user",
    );
    res.status(502).json({
      error:
        "No models were returned by the connected providers. Check the keys and account settings in Settings.",
    });
    return;
  }

  for (const result of results) {
    if (result.status === "rejected") {
      req.log.warn(
        { errorType: result.reason instanceof Error ? result.reason.name : "unknown" },
        "A provider model discovery request failed",
      );
    }
  }

  res.json(ListModelsResponse.parse({ models }));
});

export default router;
