import { randomUUID } from "node:crypto";
import { and, desc, eq, exists, gt, ilike, or, sql } from "drizzle-orm";
import OpenAI from "openai";
import {
  Router,
  type IRouter,
  type Request,
  type Response,
} from "express";
import {
  CreateConversationBody,
  CreateConversationResponse,
  DeleteConversationParams,
  GetConversationParams,
  GetConversationResponse,
  ListConversationsQueryParams,
  ListConversationsResponse,
  RenameConversationBody,
  RenameConversationParams,
  RenameConversationResponse,
  StreamConversationBody,
  StreamConversationParams,
} from "@workspace/api-zod";
import {
  conversationsTable,
  db,
  messagesTable,
} from "@workspace/db";
import {
  discoverProviderModels,
  getProviderCredential,
  makeProviderClient,
  type SupportedProvider,
} from "../lib/providers";

const router: IRouter = Router();

function ownerId(req: Request): string {
  const userId = (req as typeof req & { authUserId?: string }).authUserId;
  if (!userId) throw new Error("Authenticated user context is missing.");
  return userId;
}

async function findOwnedConversation(id: string, userId: string) {
  const [conversation] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.id, id),
        eq(conversationsTable.ownerId, userId),
      ),
    )
    .limit(1);

  return conversation;
}

async function getConversationWithMessages(id: string, userId: string) {
  const conversation = await findOwnedConversation(id, userId);
  if (!conversation) return undefined;

  const messages = await db
    .select({
      id: messagesTable.id,
      role: messagesTable.role,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
    })
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, id))
    .orderBy(messagesTable.createdAt, messagesTable.id);

  return { ...conversation, messages };
}

router.get("/conversations", async (req, res): Promise<void> => {
  const params = ListConversationsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation search." });
    return;
  }

  const userId = ownerId(req);
  const search = params.data.q?.trim();
  const where = search
    ? and(
        eq(conversationsTable.ownerId, userId),
        or(
          ilike(conversationsTable.title, `%${search}%`),
          exists(
            db
              .select({ found: sql`1` })
              .from(messagesTable)
              .where(
                and(
                  eq(messagesTable.conversationId, conversationsTable.id),
                  ilike(messagesTable.content, `%${search}%`),
                ),
              ),
          ),
        ),
      )
    : eq(conversationsTable.ownerId, userId);

  const conversations = await db
    .select({
      id: conversationsTable.id,
      title: conversationsTable.title,
      createdAt: conversationsTable.createdAt,
      updatedAt: conversationsTable.updatedAt,
    })
    .from(conversationsTable)
    .where(where)
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(100);

  res.json(ListConversationsResponse.parse({ conversations }));
});

router.post("/conversations", async (req, res): Promise<void> => {
  const body = CreateConversationBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: "Invalid conversation title." });
    return;
  }

  const [conversation] = await db
    .insert(conversationsTable)
    .values({
      id: randomUUID(),
      ownerId: ownerId(req),
      title: body.data.title?.trim() || "New chat",
    })
    .returning();

  const created = CreateConversationResponse.parse({
    ...conversation,
    messages: [],
  });
  res.status(201).json(created);
});

router.get("/conversations/:id", async (req, res): Promise<void> => {
  const params = GetConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation ID." });
    return;
  }

  const conversation = await getConversationWithMessages(
    params.data.id,
    ownerId(req),
  );
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }

  res.json(GetConversationResponse.parse(conversation));
});

router.patch("/conversations/:id", async (req, res): Promise<void> => {
  const params = RenameConversationParams.safeParse(req.params);
  const body = RenameConversationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter a valid conversation title." });
    return;
  }

  const userId = ownerId(req);
  const [updated] = await db
    .update(conversationsTable)
    .set({ title: body.data.title.trim(), updatedAt: new Date() })
    .where(
      and(
        eq(conversationsTable.id, params.data.id),
        eq(conversationsTable.ownerId, userId),
      ),
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }

  const conversation = await getConversationWithMessages(
    params.data.id,
    userId,
  );
  res.json(RenameConversationResponse.parse(conversation));
});

router.delete("/conversations/:id", async (req, res): Promise<void> => {
  const params = DeleteConversationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation ID." });
    return;
  }

  const [deleted] = await db
    .delete(conversationsTable)
    .where(
      and(
        eq(conversationsTable.id, params.data.id),
        eq(conversationsTable.ownerId, ownerId(req)),
      ),
    )
    .returning({ id: conversationsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }
  res.sendStatus(204);
});

function sendEvent(
  res: Response,
  event: string,
  data: unknown,
): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function clientErrorMessage(error: unknown): string {
  const status =
    error instanceof OpenAI.APIError ? error.status : undefined;
  if (status === 401 || status === 403) {
    return "The provider rejected this key. Check it in Settings > Providers.";
  }
  if (status === 429) {
    return "The provider rate limit was reached. Wait a moment or choose another model.";
  }
  if (status === 400 || status === 404) {
    return "The provider could not run this model. Choose another available model.";
  }
  return "The provider request failed. Check the provider connection and try again.";
}

async function createCompletion(
  client: OpenAI,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  signal: AbortSignal,
): Promise<string> {
  const response = await client.chat.completions.create(
    {
      model,
      messages,
      max_completion_tokens: 1800,
      stream: false,
    },
    { signal },
  );
  const content = response.choices[0]?.message.content;
  return typeof content === "string" ? content : "";
}

async function streamCompletion(
  client: OpenAI,
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  signal: AbortSignal,
  onToken: (token: string) => void,
): Promise<string> {
  const stream = await client.chat.completions.create(
    {
      model,
      messages,
      max_completion_tokens: 4096,
      stream: true,
    },
    { signal },
  );

  let response = "";
  for await (const part of stream) {
    const delta = part.choices[0]?.delta.content;
    if (typeof delta === "string" && delta) {
      response += delta;
      onToken(delta);
    }
  }
  return response;
}

router.post("/conversations/:id/stream", async (req, res): Promise<void> => {
  const params = StreamConversationParams.safeParse(req.params);
  const body = StreamConversationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid chat request." });
    return;
  }

  const input = body.data;
  const prompt = input.prompt?.trim() ?? "";
  if (
    (input.action === "send" || input.action === "edit") &&
    (!prompt || prompt.length > 32_000)
  ) {
    res.status(400).json({ error: "Enter a message before sending." });
    return;
  }
  if (input.action === "edit" && input.messageId === undefined) {
    res.status(400).json({ error: "Choose a message to edit." });
    return;
  }

  const userId = ownerId(req);
  const conversation = await findOwnedConversation(params.data.id, userId);
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found." });
    return;
  }

  const credential = await getProviderCredential(userId, input.providerId);
  if (!credential) {
    res.status(412).json({
      error: "Connect this provider in Settings before sending a message.",
    });
    return;
  }

  try {
    const availableModels = await discoverProviderModels(
      input.providerId,
      credential.apiKey,
      credential.accountId,
    );
    if (!availableModels.some((model) => model.modelId === input.modelId)) {
      res.status(412).json({
        error:
          "This model is not currently available from the selected provider. Refresh the model list and choose another.",
      });
      return;
    }
  } catch {
    res.status(502).json({
      error:
        "Could not verify the selected provider. Check its key and account settings in Settings.",
    });
    return;
  }

  const priorMessages = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversation.id))
    .orderBy(messagesTable.createdAt, messagesTable.id);

  if (input.action === "continue") {
    if (priorMessages.at(-1)?.role !== "assistant") {
      res.status(400).json({
        error: "There is no assistant response to continue yet.",
      });
      return;
    }
  }
  if (input.action === "edit") {
    const target = priorMessages.find((message) => message.id === input.messageId);
    if (!target || target.role !== "user") {
      res.status(404).json({ error: "User message not found." });
      return;
    }
  }
  if (
    input.action === "regenerate" &&
    priorMessages.length > 0 &&
    priorMessages.at(-1)?.role === "assistant"
  ) {
    // The previous assistant reply is replaced by the new generation.
  } else if (
    input.action === "regenerate" &&
    priorMessages.at(-1)?.role !== "user"
  ) {
    res.status(400).json({
      error: "There is no user message to regenerate a response for.",
    });
    return;
  }

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  try {
    if (input.action === "send") {
      await db.insert(messagesTable).values({
        conversationId: conversation.id,
        role: "user",
        content: prompt,
      });
      if (conversation.title === "New chat") {
        const title = prompt.replace(/\s+/g, " ").slice(0, 80) || "New chat";
        await db
          .update(conversationsTable)
          .set({ title, updatedAt: new Date() })
          .where(eq(conversationsTable.id, conversation.id));
      }
    } else if (input.action === "edit") {
      const messageId = input.messageId!;
      await db.transaction(async (tx) => {
        await tx
          .delete(messagesTable)
          .where(
            and(
              eq(messagesTable.conversationId, conversation.id),
              gt(messagesTable.id, messageId),
            ),
          );
        await tx
          .update(messagesTable)
          .set({ content: prompt })
          .where(
            and(
              eq(messagesTable.conversationId, conversation.id),
              eq(messagesTable.id, messageId),
            ),
          );
      });
    } else if (
      input.action === "regenerate" &&
      priorMessages.at(-1)?.role === "assistant"
    ) {
      const latest = priorMessages.at(-1)!;
      await db
        .delete(messagesTable)
        .where(
          and(
            eq(messagesTable.conversationId, conversation.id),
            eq(messagesTable.id, latest.id),
          ),
        );
    }

    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversation.id));

    const savedMessages = await db
      .select({
        role: messagesTable.role,
        content: messagesTable.content,
      })
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversation.id))
      .orderBy(messagesTable.createdAt, messagesTable.id);

    const history: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = savedMessages.slice(-40).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    if (input.action === "continue") {
      history.push({
        role: "system",
        content: "Continue the previous answer with useful detail. Do not repeat what was already said.",
      });
    }

    const client = makeProviderClient(
      input.providerId,
      credential.apiKey,
      credential.accountId,
    );
    let assistantContent = "";
    if (input.mode === "swarm") {
      sendEvent(res, "agent", {
        role: "strategist",
        name: "Strategist",
        status: "working",
      });
      const plan = await createCompletion(
        client,
        input.modelId,
        [
          {
            role: "system",
            content:
              "You are the SWARM Strategist. Analyze the user's request and conversation context, then write a concise plan for a useful answer. Do not answer the user yet.",
          },
          ...history,
        ],
        abortController.signal,
      );
      sendEvent(res, "agent", {
        role: "strategist",
        name: "Strategist",
        status: "completed",
      });

      sendEvent(res, "agent", {
        role: "builder",
        name: "Builder",
        status: "working",
      });
      const draft = await createCompletion(
        client,
        input.modelId,
        [
          {
            role: "system",
            content: `You are the SWARM Builder. Follow this strategy and draft the clearest complete response to the user's latest message:\n\n${plan}`,
          },
          ...history,
        ],
        abortController.signal,
      );
      sendEvent(res, "agent", {
        role: "builder",
        name: "Builder",
        status: "completed",
      });

      sendEvent(res, "agent", {
        role: "reviewer",
        name: "Reviewer",
        status: "working",
      });
      assistantContent = await streamCompletion(
        client,
        input.modelId,
        [
          {
            role: "system",
            content: `You are the SWARM Reviewer. Improve this draft for accuracy, clarity, and completeness. Return the finished answer only:\n\n${draft}`,
          },
          ...history,
        ],
        abortController.signal,
        (token) => sendEvent(res, "delta", { token }),
      );
      sendEvent(res, "agent", {
        role: "reviewer",
        name: "Reviewer",
        status: "completed",
      });
    } else {
      assistantContent = await streamCompletion(
        client,
        input.modelId,
        [
          {
            role: "system",
            content:
              "You are SWARM AI, a helpful and clear assistant. Be direct, accurate, and transparent when uncertain.",
          },
          ...history,
        ],
        abortController.signal,
        (token) => sendEvent(res, "delta", { token }),
      );
    }

    if (!assistantContent.trim()) {
      throw new Error("The provider returned an empty response.");
    }

    const [assistantMessage] = await db
      .insert(messagesTable)
      .values({
        conversationId: conversation.id,
        role: "assistant",
        content: assistantContent,
      })
      .returning({
        id: messagesTable.id,
        role: messagesTable.role,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
      });
    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversation.id));
    const updatedConversation = await getConversationWithMessages(
      conversation.id,
      userId,
    );

    sendEvent(res, "done", {
      message: assistantMessage,
      conversation: GetConversationResponse.parse(updatedConversation),
    });
    res.end();
  } catch (error) {
    if (abortController.signal.aborted) return;
    const status =
      error instanceof OpenAI.APIError ? error.status : undefined;
    req.log.warn(
      { providerId: input.providerId, modelId: input.modelId, providerStatus: status },
      "SWARM provider request failed",
    );
    sendEvent(res, "error", { error: clientErrorMessage(error) });
    res.end();
  }
});

export default router;
