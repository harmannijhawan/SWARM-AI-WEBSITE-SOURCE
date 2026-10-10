import { linkedController } from './desktop-providers/http';

// Leave 60 seconds for preflight/response delivery below the route's 300s limit.
export const CHAT_BUDGET_MS = 240_000;
export function chatBudget(parent: AbortSignal, durationMs = CHAT_BUDGET_MS) {
  const deadline = Date.now() + durationMs;
  const controller = linkedController(parent, durationMs);
  return { ...controller, get timedOut() { return controller.timedOut; }, remaining: () => Math.max(1, deadline - Date.now()) };
}
