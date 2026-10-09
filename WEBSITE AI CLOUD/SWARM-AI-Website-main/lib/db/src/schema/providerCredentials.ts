import { createInsertSchema } from "drizzle-zod";
import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const providerCredentialsTable = pgTable(
  "swarm_provider_credentials",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    providerId: text("provider_id").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    accountId: text("account_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerProviderUnique: uniqueIndex(
      "swarm_provider_credentials_owner_provider_unique",
    ).on(table.ownerId, table.providerId),
    ownerIndex: index("swarm_provider_credentials_owner_idx").on(table.ownerId),
  }),
);

export const insertProviderCredentialSchema = createInsertSchema(
  providerCredentialsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertProviderCredential = z.infer<
  typeof insertProviderCredentialSchema
>;
export type ProviderCredential =
  typeof providerCredentialsTable.$inferSelect;
