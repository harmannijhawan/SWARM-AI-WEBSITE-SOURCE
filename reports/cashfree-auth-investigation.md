# Cashfree authentication investigation — 2026-10-10

The root cause was an environment mismatch: production Payment Gateway credentials were supplied while SWARM deliberately used the sandbox endpoint and sandbox browser checkout. The earlier user decision required sandbox-only payments; the latest instruction changes that decision to production integration. Credential values were preserved, not regenerated.

## Trace and evidence

The desktop/Android upgrade button opens SWARM website account settings. `components/cloud/managed-account.tsx` sends authenticated `POST /api/billing/checkout` with plan, request ID and phone. `app/api/[...path]/route.ts` calls `handleApi`; `lib/server/backend.ts` verifies SWARM identity, initializes entitlement, validates the plan and calls `createCheckout`. `lib/server/cashfree.ts` persists the order before calling Cashfree with a stable idempotency key. Provider credentials are added only in the server HTTP client.

Before correction, both `CASHFREE_SANDBOX_CLIENT_ID` and `CASHFREE_SANDBOX_CLIENT_SECRET` were present in `.env.local`. Next.js and Node loaded identical values. There were no inherited Cashfree values, duplicate assignments, edge whitespace, retained quotes or placeholder values. No website API rewrite was configured, and no listening Next.js server was found on local ports 3000–3002 during inspection. A fresh process reproduced the failure, ruling out a stale running server for the probe.

The official merchant authentication format is `x-client-id`, `x-client-secret`, and `x-api-version`; no Authorization/Bearer provider header is used. The installed implementation used these correctly. The latest Create Order documentation specifies version `2026-01-01`. Redirects are rejected. No custom Cashfree host override is permitted.

Authenticated checkout was traced using an isolated database and temporary diagnostic-only Pro allowance/return URL fixtures because the real configuration is incomplete. Actual outgoing request: `POST https://sandbox.cashfree.com/pg/orders`, API version `2026-01-01`. Cashfree returned HTTP 401, code `request_failed`, type `authentication_error`, message `authentication Failed`, correlation ID `9dfb80cc-fbf0-4811-be9b-963de4c9cc7f`. SWARM correctly returned HTTP 502 for that upstream failure, with code `billing_authentication`. No order/session was created and the account remained Free. A control GET with documented older version `2025-01-01` also returned the same authentication error, so changing API versions did not resolve it.

After the user identified the saved pair as production credentials, the same values were moved to production-specific variable names, with `CASHFREE_ENV=production`. A read-only `GET` for a deliberately nonexistent order at `https://api.cashfree.com/pg/orders/...` returned HTTP 404 and `invalid_request_error`, rather than 401. Request/correlation ID: `ea7ee3a3-acd8-4a62-be5e-814529b3b41c`. This confirms that switching to the matching environment removed the observed authentication rejection. No production order, checkout or charge was initiated.

Official documentation: [Authentication](https://www.cashfree.com/docs/api-reference/authentication), [Create Order](https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order), [Cashfree JS](https://github.com/cashfree/cashfree-js).

## Changes

- `lib/server/cashfree.ts`: explicit sandbox/production mode, separate credential variables, fixed official endpoints, shared header construction, correlation IDs, safe upstream error diagnostics, environment-bound orders and production HTTPS return-origin validation. Signature and server payment verification remain mandatory.
- `lib/server/backend.ts`: exposes the nonsecret billing mode and typed backend error code; SWARM login 401 remains distinct from Cashfree authentication failure 502.
- `lib/server/entitlements.ts`, `lib/server/storage.ts`: additive `payment_environments` schema and Postgres namespace mapping. Existing orders without environment metadata are treated as sandbox orders.
- `components/cloud/managed-account.tsx`: Cashfree JS checkout uses the mode returned by the backend; labels no longer assume sandbox.
- `app/pricing/page.tsx`: removed sandbox-only claims.
- `.env.local`: preserved credential values under `CASHFREE_CLIENT_ID` and `CASHFREE_CLIENT_SECRET`; selected `CASHFREE_ENV=production`. This file is Git-ignored and remains server-only.
- `.env.example`: documents explicit environments and separate pairs.
- `scripts/cashfree-auth-probe.mts`: reproducible read-only probe using the real Next.js env loader and shared client configuration.
- `scripts/cashfree-trace.mts`: reproducible isolated sandbox route trace; refuses to create orders when production is selected.
- `tests/cashfree-auth.test.ts`, `tests/managed-billing.test.ts`: regression coverage for loading/precedence, headers, endpoints, 401 handling, production mode, return origin, environment isolation and credential separation.
- Android `AccountApp.kt`: payment instructions now refer to verified payment instead of sandbox payment.

## Verification and remaining blockers

Backend typecheck passed; all 47 backend tests passed; Next.js production build passed. Production authentication was checked read-only with the existing credentials. Production Create Order and actual checkout/payment were intentionally not tested. Desktop code was not changed by the environment correction, so its build was not repeated.

`SWARM_PUBLIC_URL`, `SWARM_PRO_BUILDS` and `SWARM_PRO_CHATS` remain unset. Checkout remains unavailable until configured. Production needs an HTTPS public origin serving this updated backend; assigning the existing live website URL without updating its backend would send customers back to an unrelated backend. No deployment was performed. Pro price remains ₹699 and duration 30 days; fair-use capacities were not invented or silently configured. The production merchant checkout domain/webhook configuration and full verified-payment acceptance test remain unverified.

No secrets, session tokens, full payment payloads or customer details were printed. No Nextera changes, weakened authentication, unverified Pro grants, real charges or deployment occurred.
