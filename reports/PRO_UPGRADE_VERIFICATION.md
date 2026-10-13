# SWARM Pro upgrade flow — 10 October 2026

Added Free/Pro plan comparison and checkout summary using the existing server prices, allowances and verified Cashfree flow. Pro is currently ₹699 for 30 days, manually renewed. No tax breakdown or recurring payment claims are fabricated.

Relevant prompts appear in the conversation sidebar, usage card, exhausted-allowance error and gated Fast selector. Free accounts see upgrade prompts. Pro and unlimited accounts do not see free-plan promotions. The unlimited account display now shows Unlimited for both chats and builds and hides irrelevant reset dates.

SWARM SWE Fast is backed by the existing speed-first routing policy and low reasoning effort. Paid access is checked by the server; expired Pro falls back to balanced routing. Actual latency is not guaranteed. Unavailable premium models are not advertised as included capabilities.

The assistant introduces itself as SWARM SWE while explicitly preserving truthful answers about third-party providers and unknown model information. It does not insert ads into ordinary answers.

Validation:
- 41 focused tests passed (billing, entitlements, speed access, prompt identity and unlimited isolation).
- Website production build passed; temporary UI fixture was removed before building.
- Desktop and mobile upgrade UI verified with controlled fixtures. Escape closes the native dialog; mobile content scrolls; phone validation gates checkout; the Fast selector opens the upgrade dialog; exhausted Free state shows the allowance prompt; unlimited state suppresses promotions.
- No payment was initiated or account charged during this work.

Screenshots: .screenshots/pro-upgrade-desktop.png, .screenshots/pro-upgrade-mobile.png, .screenshots/pro-pricing.png.
The UI verification script requires the local development server on port 3000 and creates/removes its temporary preview route.
