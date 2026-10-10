# Provider Discovery Diagnosis Report

## Configuration Status (from /api/config/diagnostics)

### ✅ Provider Credentials: PRESENT
**Detected**: 5 providers have credentials configured
- openai
- openrouter
- nvidia
- groq
- google

**Status**: Provider API keys are available in the environment.

### ❌ Model Allowlist: MISSING
**Issue**: `SWARM_STANDARD_MODELS` is not configured
**Impact**: Even though provider credentials exist, no models are discoverable because the allowlist is empty
**Required**: Set `SWARM_STANDARD_MODELS` to at least one provider:model pair

**Example configuration**:
```bash
SWARM_STANDARD_MODELS=groq:openai/gpt-oss-20b
```

**Current state**: Without this environment variable, the backend cannot match discovered models to the allowlist, so all models are filtered out.

### ⚠️ Cashfree: PRODUCTION MODE
**Current**: `CASHFREE_ENV=production`
**Required**: Should be `sandbox` for testing
**Impact**: Live payments would be enabled if credentials are present

### ❌ SWARM_PUBLIC_URL: MISSING
**Required**: For webhooks and payment redirects
**Impact**: Cashfree checkout cannot create valid return URLs

### ⚠️ Pro Plan Limits: NOT CONFIGURED
**Missing**: `SWARM_PRO_BUILDS` and `SWARM_PRO_CHATS`
**Impact**: Pro tier has no fair-use limits configured

## Root Cause Analysis

### Why "No connected models" appears:

1. **Provider credentials exist** (5 providers configured)
2. **Model discovery would succeed** if allowlist were present
3. **Allowlist filtering blocks all models** because `SWARM_STANDARD_MODELS` is empty
4. **Frontend sees empty model list** → displays "No connected models"

### Why SWARM SWE shows "unavailable":

1. **Profile checks for available models in allowlist**
2. **Allowlist is empty** → no models pass the filter
3. **Profile marked as unavailable** even though providers are configured

## Required Fixes

### 1. Set Model Allowlist (CRITICAL for AI functionality)

Add to `.env.local`:
```bash
SWARM_STANDARD_MODELS=groq:openai/gpt-oss-20b
```

Or use multiple providers:
```bash
SWARM_STANDARD_MODELS=groq:openai/gpt-oss-20b,openrouter:anthropic/claude-3-haiku
```

### 2. Set Cashfree to Sandbox Mode

Change in `.env.local`:
```bash
CASHFREE_ENV=sandbox
```

### 3. Set Public URL

Add to `.env.local`:
```bash
SWARM_PUBLIC_URL=http://127.0.0.1:3000
```

### 4. Configure Pro Limits (Optional)

Add to `.env.local`:
```bash
SWARM_PRO_BUILDS=100
SWARM_PRO_CHATS=500
```

## Verification Steps

After making changes:

1. Restart the development server
2. Check diagnostics: `curl http://127.0.0.1:3000/api/config/diagnostics`
3. Sign in to the app and check Settings → AI service status
4. Verify models appear in the model selector
5. Test a chat request

## Security Note

The diagnostics endpoint does NOT expose secret values. It only reports:
- Which providers have credentials (presence/absence, not the keys)
- Which environment variables are missing
- Configuration category and severity

Secret values are never logged or returned in diagnostics.
