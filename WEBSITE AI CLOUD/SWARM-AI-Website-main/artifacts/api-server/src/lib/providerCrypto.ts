import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { ProviderCredential } from "@workspace/db";

function encryptionKey(): Buffer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required to protect saved provider keys.");
  }

  return createHash("sha256")
    .update("swarm-provider-credentials:v1:")
    .update(sessionSecret)
    .digest();
}

export function encryptProviderKey(
  ownerId: string,
  providerId: string,
  value: string,
): Pick<ProviderCredential, "encryptedKey" | "iv" | "authTag"> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${ownerId}:${providerId}`, "utf8"));
  const encryptedKey = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedKey: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptProviderKey(credential: ProviderCredential): string {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(credential.iv, "base64"),
    );
    decipher.setAAD(
      Buffer.from(`${credential.ownerId}:${credential.providerId}`, "utf8"),
    );
    decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(credential.encryptedKey, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "This saved provider key could not be decrypted. Replace it in Settings.",
    );
  }
}

export function maskProviderKey(value: string): string {
  return `••••${value.slice(-4)}`;
}
