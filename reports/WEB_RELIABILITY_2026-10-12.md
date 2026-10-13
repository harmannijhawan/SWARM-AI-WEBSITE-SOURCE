# Web reliability and mobile layout — 12 October 2026

Source of truth: `C:\Users\user\Documents\SWARM---ai\swarm-ai-website-design`, branch `codex/web-reliability-mobile-20261012`, commit `6c454cbf8938f79afbd1ae6e86f73bd97c943b5c`.

The active account API now uses owner-scoped encrypted BYOK credentials, discovered model metadata, shared database health/cooldowns, provider-diverse fallback, stream reset on partial failure, cancellation, and successful-only usage settlement. A provider rate limit or outage is never reported as an exhausted SWARM plan. Real plan caps remain enforced. A failed model-discovery request no longer poisons the model list cache or disables a configured chat composer.

The mobile web chat, history drawer, provider settings, and build welcome surface were checked at 390px and 320px. The narrow build welcome surface now scrolls so the send control is reachable. Existing design work in `app/workspace-design.css`, `app/desktop-build.css`, and `app/desktop-web.css` was retained.

An incomplete, untracked BYOK prototype had spoofable `x-user-id` authentication and a fabricated assistant result. Its route and helper files were preserved locally with a `.disabled` suffix. They are absent from the committed, deployed source. The authenticated `/api/[...path]` route is the active implementation.

Validation: 142/142 tests passed; `npm run typecheck` passed; `npm run build -- --webpack` passed; local Playwright checks for BYOK save/remove, mobile chat, drawer, and build passed. Vercel preview `https://swarmai-5omqlxve3-nxtraa.vercel.app` built from the clean commit, reports `/api/health` 200, and rejects unauthenticated `/api/models` with 401. Authenticated provider generation and billing were not exercised on the preview. Production was not promoted; the Windows hosted workspace therefore still loads the current production web version.

Rollout: use a signed-in test account with a provider key on the preview; confirm streaming, cancellation, fallback, plan accounting, and builder output. Then deploy the same commit to production, verify `www.swarmgpt.online` and the Windows hosted view, and monitor routing/usage diagnostics. Roll back to the previous Vercel production deployment if errors or allowance counters regress. Do not publish the debug Android APK or unsigned Windows installer as production releases.

Git push of this branch was rejected by GitHub because the repository's earlier history contains tracked installers over 100 MB. The local commit and Vercel preview are intact; resolving the remote history/artifact storage is separate from this code fix.
