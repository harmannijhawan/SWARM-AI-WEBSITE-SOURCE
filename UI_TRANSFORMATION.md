# SWARM interface transformation

## Repository map and scope
The hosted application is Next.js App Router in this directory. The repository root is a separate Electron renderer and Android companion; neither is the requested web UI. App routes mount `components/cloud/cloud-app.tsx`. React Query manages conversations/models; Clerk gates authenticated routes. Chat streams use the existing generated client and `/api/conversations/:id/stream`. Build reuses those streams, actual agent events, parsed generated files and sandboxed previews. Settings persist validated portable preferences with optimistic version checks. Cashfree checkout, verification, history and entitlements are server-owned.

## Implementation order
1. Establish original white/blue design tokens (per user correction), original SWARM artwork and optional dark mode, theme variables, shared controls and motion with reduced-motion support.
2. Improve shell navigation, account disclosure, conversation states, composer and message code actions.
3. Rebuild grouped settings navigation; expose existing portable model/agent fields previously hidden by the managed-account branch.
4. Present real subscription allowances, plan comparison, secure checkout and responsive transaction details.
5. Improve Build phases, generated-file selection, code surfaces and unsupported previews; add a Downloads destination using existing artifact routes.
6. Run typecheck, existing tests and production build. Inspect actual browser renders at desktop/tablet/mobile in both themes and document external-service limits.

## Guardrails
Do not modify backend requests, authentication gates, payment fulfillment, model routing, secrets or existing user work. Missing usage/price/date values must remain unavailable. Previewed test data must be isolated to browser testing, never shipped as product data.

## Production payment repair
The local visual QA fixture deliberately disables checkout; it is never a production API. Live /api/plans reports production checkout available. Cashfree production credentials authenticated in a read-only missing-order probe, and the merchant dashboard shows swarmgpt.online approved. Orders now supply the canonical /api/billing/webhook notify URL. Native upgrade dialogs close before opening the Cashfree SDK modal. PostgreSQL BIGINT results are converted only within the safe integer range, matching SQLite and preserving numeric billing verification, fulfillment and allowance arithmetic. Signature checks, authoritative remote verification and atomic fulfillment remain unchanged.

## Validation
Production build and TypeScript passed. Focused billing, signatures, entitlements, preferences, stream, formatting and PostgreSQL regression tests passed. The broader suite has existing auth/configuration and concurrency failures. Actual UI was exercised at desktop, tablet and mobile sizes with isolated fixtures, followed by production checks after deployment. No live payment was charged.
