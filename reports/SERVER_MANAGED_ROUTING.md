# Server-managed routing — 12 October 2026

Implemented in the active `swarm-ai-website-design` backend and root desktop/Android sources.

- Signed-in accounts now use server environment credentials. User credential uploads are rejected; legacy stored credentials can still be removed and are not used for inference.
- Provider discovery is shared between users. Routing health, cooldowns and concurrency leases are shared for the server credential set; rotating credentials creates a fresh health scope.
- Standard and premium model allowlists constrain access. Discovery alone does not authorize a paid model.
- Removed the fixed 16-attempt cutoff from chat and native completion. Finite model lists, request deadlines, cancellation, provider cooldowns and account allowances remain enforced.
- Replaced web key-entry controls and desktop/Android BYOK copy with managed-access information.
- Android already loads the shared web workspace and retains Connect PC/native companion tools. Updated native blue, background and foreground colors to match the web palette.

## Verification

- Full web suite: 143/143 passed.
- Added a seventeenth-attempt recovery regression afterward; all 14 tests in the routing reliability suite passed.
- Web and desktop TypeScript checks passed.
- Web production build and desktop production build passed.
- Android `:app:compileDebugKotlin` passed.
- Existing local Groq credential: tiny live request returned HTTP 200 with complete text in 607 ms. This is a smoke check, not a load benchmark.

## Deployment and limits

These are local source/build changes; the hosted service and downloadable installers have not been published or replaced. Android and desktop hosted web views show the new web settings after backend deployment. No Gmail accounts were accessed and no extra provider accounts or API keys were created.

Configure provider secrets in backend deployment variables or ignored `.env.local`, using `.env.example` as the template. Keep `SWARM_STANDARD_MODELS` and `SWARM_PREMIUM_MODELS` aligned with models the operator has approved. Never ship these keys in Electron, Android, or public web variables. Existing local Groq configuration was verified without changing or displaying its key.

Multiple keys do not make provider quotas unlimited. Additional capacity must come from provider-approved quota or independent authorized providers. Requests can still fail when every eligible provider is unavailable; failures release their usage reservation.

## Provider credentials added on 12 October 2026

Created one backend key each in GroqCloud, OpenRouter, NVIDIA NIM, and Hugging Face, and stored them in ignored `swarm-ai-website-design/.env.local`. The NVIDIA key expires 12 October 2027. OpenRouter has a $0 credit cap. No key values are included in this report or committed files.

Live generation verified Groq `openai/gpt-oss-20b` (HTTP 200), NVIDIA `nvidia/nemotron-3-super-120b-a12b` (HTTP 200), and OpenRouter `nvidia/nemotron-3.5-lightning:free` (HTTP 200). The NVIDIA and OpenRouter models were added to `SWARM_STANDARD_MODELS`. Hugging Face model discovery returned HTTP 200, but completion returned HTTP 402; it has no approved model route.

The NVIDIA account already had 16 keys while its dashboard showed a shared 40 requests/minute limit. Additional keys within that account do not raise that limit. The new keys are local to this checkout; deployment environment variables still need to be set when publishing the backend.
