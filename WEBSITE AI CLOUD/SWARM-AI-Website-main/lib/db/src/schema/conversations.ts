import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const conversationsTable = pgTable(
  "swarm_conversations",
  {
    id: uuid("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull().default("New chat"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerUpdatedAt: index("swarm_conversations_owner_updated_idx").on(
      table.ownerId,
      table.updatedAt,
    ),
  }),
);

export const insertConversationSchema = createInsertSchema(
  conversationsTable,
).omit({ createdAt: true, updatedAt: true });

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversationsTable.$inferSelect;
