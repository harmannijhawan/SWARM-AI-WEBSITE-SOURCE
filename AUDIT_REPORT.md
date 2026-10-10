# SWARM AI Platform Audit Report

## Phase 1: Architecture Audit

### Project Structure

**Website (Next.js)**: `C:\Users\user\Documents\SWARM---ai\swarm-ai-website-design`
- Framework: Next.js 16.4.0 with App Router
- Backend: Integrated API routes in `app/api/[...path]/route.ts`
- Database: SQLite (local) or PostgreSQL (cloud) via `lib/server/storage.ts`
- Authentication: Clerk (optional) or local workspace mode
- AI Providers: Server-side managed credentials from environment variables
- Payment: Cashfree sandbox integration

**Desktop (Electron)**: `C:\Users\user\Documents\SWARM---ai`
- Main process: `electron/main.ts`
- Provider adapters: `electron/providers/`
- Features: PC control, terminal execution, IPC, account sync

**Android**: `C:\Users\user\Documents\SWARM---ai\app`
- Gradle-based Android project
- Development APK: `public/downloads/SWARM-AI.apk`

### Backend Architecture

**API Handler**: `lib/server/backend.ts`
- Routes: `/api/health`, `/api/models`, `/api/providers`, `/api/conversations`, `/api/billing/*`
- Authentication: `ownerFor()` function - Clerk tokens or local workspace
- Model Discovery: `modelList()` - discovers from provider adapters
- Chat Streaming: `streamChat()` - handles requests with routing and fallback
- Provider Registry: `lib/server/providers.ts` - lists available adapters

**Provider Adapters**: `lib/server/desktop-providers/`
- OpenAI-compatible: Groq, NVIDIA, Cerebras, Mistral, Hugging Face, OpenAI
- Specialized: OpenRouter, Google (Gemini), Cloudflare
- Credential loading: `managedCredentials()` from environment variables

**Entitlements & Usage**: `lib/server/entitlements.ts`
- Plans: Free (5 builds, 2 chats), Pro (configurable)
- Allowance tracking: `usage_ledger` table
- Reset period: 30 days by default

**Payment**: `lib/server/cashfree.ts`
- Environment: Sandbox (default) or Production
- Order creation: `createCheckout()`
- Verification: `verifyOrder()`
- Webhook: `cashfreeWebhook()`

### Frontend Architecture

**Main App**: `components/cloud/cloud-app.tsx`
- React with TanStack Query for API calls
- Clerk integration for authentication
- Custom fetch wrapper in `lib/cloud-api/custom-fetch.ts`
- Generated API client in `lib/cloud-api/generated/api.ts`

**Components**:
- `managed-account.tsx`: Account settings, usage display, billing
- `build-layout.tsx`: Build workspace UI
- `chat-markdown.tsx`: Markdown rendering with code blocks

### Identified Issues

#### 1. Backend Health Check
**Symptom**: UI shows "SWARM AI is awaiting backend availability..."
**Root Cause**: 
- Health endpoint `/api/health` requires authentication when `CLERK_SECRET_KEY` is set
- When Clerk is not configured, it should allow local workspace access but may have CORS or origin validation issues
- Frontend may be calling health check without proper authentication for local mode

**Fix Required**: 
- Ensure health check works for both authenticated and local workspace modes
- Verify CORS and origin validation for local development
- Add frontend polling logic with proper error handling

#### 2. AI Provider Discovery
**Symptom**: UI shows "No connected models" and "SWARM SWE unavailable"
**Root Cause**:
- Environment variables for provider credentials (GROQ_API_KEY, etc.) are empty
- `managedCredentials()` returns null when no credentials found
- Model discovery requires both credentials AND allowlist match
- `SWARM_STANDARD_MODELS=groq:openai/gpt-oss-20b` but GROQ_API_KEY is empty

**Fix Required**:
- Configure actual provider credentials in `.env.local`
- Verify credential loading path in backend
- Add better error messages when credentials are missing
- Ensure allowlist matches actual available models

#### 3. Usage Allowance Date Rendering
**Symptom**: UI shows "Allowance resets Invalid Date"
**Root Cause**:
- Backend calculates `resetsAt` based on account creation time and period
- If `account.created` is 0 or invalid, `resetsAt` becomes invalid
- Frontend uses `new Date(state.resetsAt).toLocaleDateString()` without validation
- Invalid dates render as "Invalid Date" in browser

**Fix Required**:
- Add validation in backend to ensure `account.created` is valid
- Add fallback in frontend for invalid dates
- Display "Reset schedule unavailable" when date is invalid

#### 4. Cashfree Payment Authentication
**Symptom**: HTTP 401 Unauthorized errors during checkout
**Root Cause**:
- Need to verify which environment variables are being loaded
- Sandbox vs production URL selection
- Cashfree API version compatibility
- Request signature or header validation

**Fix Required**:
- Verify credential loading from environment
- Check sandbox vs production base URL
- Validate request headers and API version
- Add diagnostic logging (sanitized)

### Environment Variables Required

**Provider Credentials**:
- `GROQ_API_KEY` - Groq API key
- `OPENROUTER_API_KEY` - OpenRouter API key
- `GEMINI_API_KEY` - Google Gemini API key
- `NVIDIA_API_KEY` - NVIDIA NIM API key
- `OPENAI_API_KEY` - OpenAI API key

**Model Allowlists**:
- `SWARM_STANDARD_MODELS=groq:openai/gpt-oss-20b` (or other configured models)
- `SWARM_PREMIUM_MODELS=` (empty for now)

**Cashfree**:
- `CASHFREE_ENV=sandbox`
- `CASHFREE_SANDBOX_CLIENT_ID`
- `CASHFREE_SANDBOX_CLIENT_SECRET`
- `SWARM_PUBLIC_URL=http://127.0.0.1:3000`

**Authentication (Optional)**:
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `SESSION_SECRET`

**Plan Configuration**:
- `SWARM_PRO_PRICE_PAISE=69900`
- `SWARM_PRO_ACCESS_DAYS=30`
- `SWARM_ALLOWANCE_DAYS=30`
- `SWARM_FREE_BUILDS=5`
- `SWARM_FREE_CHATS=2`
- `SWARM_PRO_BUILDS=` (configure for Pro)
- `SWARM_PRO_CHATS=` (configure for Pro)

### Test Coverage

**Backend Tests**:
- `tests/backend.test.ts` - Health check, provider management, conversation persistence
- `tests/managed-api.test.ts` - Managed operations, billing verification
- `tests/managed-billing.test.ts` - Usage tracking, reset periods
- `tests/cashfree-auth.test.ts` - Cashfree authentication

**Build Commands**:
- `pnpm typecheck` - TypeScript type checking
- `pnpm test` - Run test suite
- `pnpm build` - Production build
- `pnpm dev` - Development server

### Next Steps

1. Fix backend health check for local workspace mode
2. Configure provider credentials and verify model discovery
3. Fix allowance date rendering with validation
4. Test Cashfree sandbox checkout flow
5. Verify automatic routing with real provider
6. Redesign UI for premium experience
7. Add animations and polish
8. Test cross-platform consistency
9. Run full test suite
10. Document deployment requirements
