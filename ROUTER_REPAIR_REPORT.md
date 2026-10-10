# Router repair and deployment report — 10 October 2026

## Proven findings
- The public production `swarm-ai-website-source.vercel.app/api/config/diagnostics` reports missing provider credentials, SWARM_STANDARD_MODELS, Cashfree sandbox credentials and SWARM_PUBLIC_URL. /api/plans confirms checkout disabled. These are external production configuration failures; a code push cannot create credentials.
- `lib/server/backend.ts:state` previously threw for all configuration errors, including optional Cashfree configuration, blocking unrelated account/history/model APIs. Removed this global disablement; feature endpoints retain their own validation.
- `recordRoute` ignored Retry-After, cached stale health, and tracked provider-wide errors only against individual models. Native `managedComplete` ignored health entirely. Fixed provider/model cooldown recording, immediate cache invalidation and native health-aware selection.
- Fallback capped the original ranked list before reaching independent providers. Provider-diverse ordering now visits independent services first, then remaining models, with at most 16 attempts and bounded request/attempt deadlines. Auth/quota/rate limits bypass that provider; model-specific and transient faults allow other models. No same-model retries multiply requests.
- The default free plan is genuinely two successful chats and five builds per 30 days. Its exhaustion is a user allowance, distinct from upstream availability. No live incident log was available to prove which condition caused the reported one-to-two-minute incident.

## Implemented and tested
- Server-authoritative Free, Pro (existing ₹699 configuration), Max (fixed ₹2,000/30 days), separate verified Max expiry, persisted order tier and idempotent payment verification. Legacy orders remain Pro. No new merchant product is assumed: Cashfree receives the server-created order amount.
- Atomic reservations and successful-request settlement retained. Failed native inference refunds its reservation and expires that operation; stale web reservations are released after the six-minute lease when no active native operation owns them. Failed upstream work is not successful-message usage.
- Explicit standard / premium / fast / max model allowlists. Max profile never falls back into a lower-tier pool. Required native JSON and image capabilities are filtered. Unknown or undiscovered models are not fabricated.
- Checkout, account profile selector and public pricing expose Max. Allowance exhaustion invokes upgrade UI; provider failures do not. Paid allowances remain disabled until funded limits are configured.
- Provider authentication alerts contain provider ID and safe error code only. HTTP error bodies are withheld. Performance metrics/export require SWARM_OPERATOR_IDS.
- Existing stream reset boundary is retained: failed partial output is cleared before another provider starts. This is an explicit restart, not seamless stream continuation.

## Verification
128 deterministic tests passed before the final operator-access guard. Final verification is recorded below after the guard.
Type-check passed. `next build --webpack` passed; local default Turbopack rejects the reused node_modules junction outside its project root. Deployment installs normal dependencies and uses the existing build setup.
No lint script exists. No live paid purchase or authenticated provider inference was run. No objective Fast/Pro/Max quality or latency superiority is claimed. Existing evaluation tooling remains available; real response capture must use configured providers. Proposed Fast first-token objective: p95 <= 10 seconds on a fixed representative evaluation set; currently unmeasured. Model scores remain heuristics, not measured quality.

## Production configuration still required
Set backend secrets directly in Vercel, never in chat or source:
- At least two independent provider credentials already supported by the central adapter registry, with verified active model IDs in SWARM_STANDARD_MODELS, SWARM_PREMIUM_MODELS, SWARM_FAST_MODELS and SWARM_MAX_MODELS. No extra keys are treated as independent account quota.
- Funded SWARM_PRO_BUILDS/CHATS and SWARM_MAX_BUILDS/CHATS; limits are intentionally unset rather than making unsupported capacity promises.
- SWARM_PUBLIC_URL and correct Cashfree production/sandbox credentials and mode. Verify webhook and a legitimate live checkout before claiming purchasing works.
- Persistent SWARM_DATABASE_URL (Postgres) and SWARM_ENCRYPTION_KEY (base64 32 bytes) for Vercel. Local SQLite is not persistent serverless storage.
- SWARM_OPERATOR_IDS for metrics access. Existing Clerk credentials retained.
Allowance periods are rolling 30-day windows anchored to account creation in UTC epoch milliseconds; renewal extends the verified access expiry without resetting successful-message usage.

## Remaining limitations
Production configuration and an authenticated end-to-end test are still required. Distributed health updates use existing shared DB but rolling metrics can lose concurrent increments; no distributed provider concurrency semaphore or recovery-probe lease is implemented. Existing token instrumentation estimates usage where upstream omits it; actual cost/margin accounting and resources consumed by interrupted upstream responses are not complete. No new provider pricing claims, large load tests, fabricated evaluation results, or unlimited-capacity promises were added. The full requested performance/observability program is therefore not complete.

Verified documentation: https://console.groq.com/docs/rate-limits (429 and Retry-After), https://console.groq.com/docs/models (active model discovery), https://www.cashfree.com/devstudio/preview/pg/web/checkout (server orders and payment confirmation).

Changed modules: lib/server/backend.ts, entitlements.ts, cashfree.ts, managed-providers.ts, routing-reliability.ts, desktop-providers/http.ts and model-score.source.json; components/cloud/billing-view.tsx, managed-account.tsx, cloud-app.tsx; app/pricing/page.tsx; .env.example; tests/auth-flow, backend, concurrency-stress, managed-billing and router-repair.

Final checks: 128/128 automated tests pass; tightened cross-provider 429 test and all 8 backend tests pass; final type-check passes. Production webpack build passed before the final telemetry guard (type-checked). No lint script configured. GitHub main push triggers the existing Vercel deployments.
