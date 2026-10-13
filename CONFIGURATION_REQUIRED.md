# SWARM Backend Configuration Required

## Critical Configuration Issue

The SWARM backend requires specific environment variables to be configured before it can start. If these are missing, you'll see authentication errors with HTTP 503 status codes.

## Required Configuration Steps

### 1. Configure AI Provider Credentials

**The backend REQUIRES at least one AI provider API key.** Add your API key to `.env.local`:

```bash
# Choose at least ONE provider and add your API key:

# Groq (Recommended - Fast and free tier available)
# Get key from: https://console.groq.com/keys
GROQ_API_KEY=gsk_your_actual_key_here

# OR OpenRouter (Multiple models, pay-as-you-go)
# Get key from: https://openrouter.ai/keys
OPENROUTER_API_KEY=sk-or-your_key_here

# OR Google Gemini
GEMINI_API_KEY=your_key_here

# OR NVIDIA
NVIDIA_API_KEY=nvapi-your_key_here

# OR OpenAI
OPENAI_API_KEY=sk-your_key_here
```

### 2. Configure Model Allowlist

**CRITICAL:** You must specify which models are available:

```bash
# Format: provider:model-id,provider:model-id
# Get Groq model IDs from: https://console.groq.com/docs/models

SWARM_STANDARD_MODELS=groq:llama-3.3-70b-versatile,groq:llama-3.1-70b-versatile
SWARM_PREMIUM_MODELS=groq:llama-3.1-405b-reasoning
```

**Common Groq Models:**
- `groq:llama-3.3-70b-versatile` - Latest, balanced
- `groq:llama-3.1-70b-versatile` - Fast, reliable
- `groq:llama-3.1-8b-instant` - Ultra fast
- `groq:mixtral-8x7b-32768` - Good for reasoning
- `groq:llama-3.1-405b-reasoning` - Most capable (Pro only)

### 3. Configure Public URL

```bash
# For local development:
SWARM_PUBLIC_URL=http://localhost:3000

# For production deployment:
SWARM_PUBLIC_URL=https://www.swarmgpt.online
```

### 4. Configure Pro Plan Limits (Optional)

```bash
SWARM_PRO_BUILDS=100
SWARM_PRO_CHATS=200
```

## Symptoms of Missing Configuration

### Desktop App Shows:
```
Account service could not complete the request (503).
Sign out before reconnecting.
```

### Website Shows:
```
Loading SWARM account…
(stuck forever)
```

Or:
```
SWARM AI is not properly configured. See server logs for details.
No connected models
```

## How to Fix

1. **Copy the example** `.env.example` to `.env.local`
2. **Add at least one AI provider key** (Groq recommended)
3. **Set SWARM_STANDARD_MODELS** with your provider:model pairs
4. **Set SWARM_PUBLIC_URL** to your deployment URL
5. **Restart the Next.js server**

```bash
cd swarm-ai-website-design
# Edit .env.local and add your configuration
pnpm dev
```

## Verification

After configuration, the server should log:

```
✓ Configuration validation passed
⚠ [PROVIDER] 1 provider(s) configured: groq. AI functionality is available.
```

If you see errors, check the server logs for specific missing variables.

## Security Notes

- **NEVER** commit API keys to git
- **NEVER** use `NEXT_PUBLIC_` prefix for secrets
- Keep `.env.local` in `.gitignore`
- Use different keys for development and production

## Need Help?

1. Check server logs for specific configuration errors
2. Verify your API key is valid at the provider's dashboard
3. Confirm model IDs match your provider's documentation
4. Test API key with a simple curl request first

## Quick Start for Development

```bash
# Minimum viable .env.local:
GROQ_API_KEY=gsk_your_key_from_groq_console
SWARM_STANDARD_MODELS=groq:llama-3.3-70b-versatile
SWARM_PUBLIC_URL=http://localhost:3000
SWARM_FREE_BUILDS=5
SWARM_FREE_CHATS=20
```

This will get the backend running for local development.
