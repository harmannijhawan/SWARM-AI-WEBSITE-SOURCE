import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { conversationsTable } from "./conversations";

export const messagesTable = pgTable(
  "swarm_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    conversationCreatedAt: index("swarm_messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  }),
);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
